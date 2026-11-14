import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// The session is an AES-GCM sealed cookie: { login, avatar, token, exp }.
// The token is the viewer's GitHub OAuth token, so feedback posts as them.

export type Viewer = { login: string; avatar: string; token: string; exp: number; dev?: boolean };

const COOKIE = "factory_session";
const enc = new TextEncoder();
const dec = new TextDecoder();

async function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

export async function seal(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), enc.encode(JSON.stringify(value)));
  return `${b64(iv)}.${b64(new Uint8Array(data))}`;
}

export async function unseal<T>(sealed: string | undefined): Promise<T | null> {
  if (!sealed) return null;
  const [iv, data] = sealed.split(".");
  if (!iv || !data) return null;
  try {
    const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(data));
    return JSON.parse(dec.decode(out)) as T;
  } catch {
    return null;
  }
}

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
