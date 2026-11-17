/** Small Web Crypto helpers (Workers runtime and Bun both provide crypto.subtle). */

const enc = new TextEncoder();

function base64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

/** Constant-time string comparison (the length difference is still observable, which is fine here). */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Returns "<value>.<signature>". `value` must not be trusted to contain no dots; we split on the last one. */
export async function signValue(value: string, secret: string): Promise<string> {
  return `${value}.${await hmac(value, secret)}`;
}

/** Returns the original value if the signature is valid, otherwise null. */
export async function verifyValue(signed: string, secret: string): Promise<string | null> {
  const i = signed.lastIndexOf(".");
  if (i <= 0) return null;
  const value = signed.slice(0, i);
  const expected = await hmac(value, secret);
  return safeEqual(signed.slice(i + 1), expected) ? value : null;
}

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i: easy to read aloud

/** Short random id for public URLs (/v/<slug>). */
export function randomSlug(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let s = "";
  for (const b of bytes) s += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
  return s;
}
