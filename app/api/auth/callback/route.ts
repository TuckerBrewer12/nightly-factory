import { NextResponse, type NextRequest } from "next/server";
import { allowedUsers, seal, SESSION_COOKIE, SESSION_DAYS } from "@/lib/session";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("factory_oauth_state")?.value) {
    return NextResponse.redirect(new URL("/login?error=state", req.nextUrl.origin));
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL("/api/auth/callback", req.nextUrl.origin).toString(),
    }),
  });
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return NextResponse.redirect(new URL("/login?error=token", req.nextUrl.origin));

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${access_token}`, Accept: "application/vnd.github+json", "User-Agent": "nightly-factory" },
  });
  const user = (await userRes.json()) as { login?: string; avatar_url?: string };
  if (!user.login || !allowedUsers().includes(user.login.toLowerCase())) {
    return NextResponse.redirect(new URL(`/login?error=denied&who=${encodeURIComponent(user.login ?? "")}`, req.nextUrl.origin));
  }

  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const sealed = await seal({ login: user.login, avatar: user.avatar_url ?? "", token: access_token, exp });
  const next = req.cookies.get("factory_next")?.value ?? "/";
  const res = NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", req.nextUrl.origin));
  res.cookies.set(SESSION_COOKIE, sealed, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  res.cookies.delete("factory_oauth_state");
  res.cookies.delete("factory_next");
  return res;
}
