import { factory } from "@/factory.config";

// A thin REST client. Reads are cached in memory for a short while so a
// handful of viewers clicking around doesn't burn the rate limit.

const API = "https://api.github.com";
const TTL_MS = 45_000;
const cache = new Map<string, { at: number; value: unknown }>();

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function headers(token: string | undefined, extra?: Record<string, string>) {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nightly-factory",
    ...extra,
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// The server's own token (GITHUB_TOKEN), unless GitHub has already rejected it.
// Pasted values often carry spaces, quotes or a newline, so those are stripped.
let serverTokenRejected = false;

export function serverToken(): string | undefined {
  const raw = process.env.GITHUB_TOKEN?.trim().replace(/^["']|["']$/g, "");
  return raw && !serverTokenRejected ? raw : undefined;
}

export function serverTokenStatus(): "ok" | "missing" | "rejected" {
  if (!process.env.GITHUB_TOKEN?.trim()) return "missing";
  return serverTokenRejected ? "rejected" : "ok";
}

// Reads prefer the server token (shared cache), else the viewer's.
export function readToken(viewerToken?: string) {
  return serverToken() || viewerToken || undefined;
}

export async function ghGet<T>(path: string, viewerToken?: string, opts: { fresh?: boolean; raw?: boolean } = {}): Promise<T> {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  const hit = cache.get(url);
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value as T;

  const token = readToken(viewerToken);
  let res = await fetch(url, {
    headers: headers(token, opts.raw ? { Accept: "application/vnd.github.raw" } : undefined),
    cache: "no-store",
  });
  // A bad GITHUB_TOKEN shouldn't take the site down: drop it and read as the viewer.
  if (res.status === 401 && token && token === serverToken() && viewerToken && viewerToken !== token) {
    serverTokenRejected = true;
    console.warn("GITHUB_TOKEN was rejected by GitHub (401). Reading with the signed-in viewer's token instead.");
    res = await fetch(url, {
      headers: headers(viewerToken, opts.raw ? { Accept: "application/vnd.github.raw" } : undefined),
      cache: "no-store",
    });
  }
  if (!res.ok) {
    const body = await res.text();
    throw new GitHubError(res.status, `GET ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  const value = (opts.raw ? await res.text() : await res.json()) as T;
  cache.set(url, { at: Date.now(), value });
  return value;
}

// Writes always go out as the signed-in viewer.
export async function ghSend<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  token: string,
  body?: unknown,
  opts: { allow404?: boolean } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok && !(opts.allow404 && res.status === 404)) {
    const text = await res.text();
    let message = text;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {}
    throw new GitHubError(res.status, message);
  }
  cache.clear();
  return (res.status === 204 || res.status === 404 ? null : await res.json()) as T;
}

export const repoPath = () => `/repos/${factory.repo.owner}/${factory.repo.name}`;

// Run several async jobs with a ceiling on how many are in flight.
export async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
