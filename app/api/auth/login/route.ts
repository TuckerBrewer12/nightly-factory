import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return new NextResponse("GITHUB_CLIENT_ID is not set", { status: 500 });

  const state = crypto.randomUUID();
  const next = req.nextUrl.searchParams.get("next") ?? "/";
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "repo");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", new URL("/api/auth/callback", req.nextUrl.origin).toString());

  const res = NextResponse.redirect(url);
  const cookie = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 600 };
  res.cookies.set("factory_oauth_state", state, cookie);
  res.cookies.set("factory_next", next.startsWith("/") ? next : "/", cookie);
  return res;
}
