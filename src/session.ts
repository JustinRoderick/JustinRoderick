// The owner session is "<expiresAtMs>.<base64url HMAC-SHA256 of expiresAtMs>". It carries no identity:
// only the owner can ever obtain one, so a valid signature means "this is the owner".
const encoder = new TextEncoder();

const key = (secret: string) =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

export async function signSession(secret: string, expiresAt: number): Promise<string> {
  const payload = String(expiresAt);
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

export async function verifySession(secret: string, value: string, now: number): Promise<boolean> {
  const match = /^(\d+)\.([A-Za-z0-9_-]+)$/.exec(value);
  if (!match) return false;
  const [, payload, signature] = match as unknown as [string, string, string];
  if (Number(payload) <= now) return false;
  const bytes = fromBase64Url(signature);
  if (!bytes) return false;
  return crypto.subtle.verify("HMAC", await key(secret), bytes, encoder.encode(payload));
}
