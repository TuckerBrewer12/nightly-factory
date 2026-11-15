// AES-GCM sealing for the session cookie. No Next imports, so proxy.ts can use it.

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

