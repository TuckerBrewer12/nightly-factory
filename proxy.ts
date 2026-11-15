import { NextResponse, type NextRequest } from "next/server";
import { grantTimes, refreshGrant } from "@/lib/github-token";
import { seal, unseal } from "@/lib/seal";
import type { Viewer } from "@/lib/session";

// Keeps the viewer's GitHub token alive. A GitHub App's user token lasts 8 hours;
// within 10 minutes of that this swaps it for a new one with the refresh token,
// for this request and in the cookie. If it can't, the viewer signs in again.

const COOKIE = "factory_session";
const MARGIN_MS = 10 * 60_000;

export async function proxy(req: NextRequest) {
  const viewer = await unseal<Viewer>(req.cookies.get(COOKIE)?.value);
  if (!viewer?.tokenExp || viewer.tokenExp - Date.now() > MARGIN_MS) return NextResponse.next();

  const usable = viewer.refresh && (!viewer.refreshExp || viewer.refreshExp > Date.now());
  const grant = usable ? await refreshGrant(viewer.refresh!).catch(() => null) : null;

  if (!grant) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Your GitHub sign-in expired. Reload the page to sign in again." }, { status: 401 });
    }
    const login = new URL("/api/auth/login", req.nextUrl.origin);
    login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    const res = NextResponse.redirect(login);
    res.cookies.delete(COOKIE);
    return res;
  }

  const sealed = await seal({ ...viewer, token: grant.access_token, ...grantTimes(grant) });
  req.cookies.set(COOKIE, sealed);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(COOKIE, sealed, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.floor((viewer.exp - Date.now()) / 1000)),
  });
  return res;
}

export const config = {
  matcher: ["/((?!api/auth|api/cron|_next|favicon|local-agent).*)"],
};
