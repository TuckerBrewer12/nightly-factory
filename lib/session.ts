import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// The session is an AES-GCM sealed cookie: { login, avatar, token, exp }.
// The token is the viewer's GitHub OAuth token, so feedback posts as them.

// tokenExp / refresh are set when sign-in goes through a GitHub App, whose user
// tokens expire after 8 hours; proxy.ts refreshes them before they lapse.
export type Viewer = {
  login: string;
  avatar: string;
  token: string;
  exp: number;
  tokenExp?: number;
  refresh?: string;
  refreshExp?: number;
  dev?: boolean;
};

const COOKIE = "factory_session";
export { seal, unseal } from "@/lib/seal";
import { unseal } from "@/lib/seal";

export function allowedUsers() {
  return (process.env.ALLOWED_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Local development without OAuth: FACTORY_DEV_LOGIN names who you are,
// and reads go out unauthenticated (or with GITHUB_TOKEN). A dev viewer can never write.
function devViewer(): Viewer | null {
  if (process.env.NODE_ENV === "production" || !process.env.FACTORY_DEV_LOGIN) return null;
  return { login: process.env.FACTORY_DEV_LOGIN, avatar: "", token: "", exp: Infinity, dev: true };
}

export async function getViewer(): Promise<Viewer | null> {
  const dev = devViewer();
  if (dev) return dev;
  const jar = await cookies();
  const v = await unseal<Viewer>(jar.get(COOKIE)?.value);
  if (!v || v.exp < Date.now()) return null;
  if (v.tokenExp && v.tokenExp < Date.now()) return null;
  if (!allowedUsers().includes(v.login.toLowerCase())) return null;
  return v;
}

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect("/login");
  return v;
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_DAYS = 30;
