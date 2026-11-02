// Random values, hashes and comparisons for the accounts module. Every
// secret comes from crypto.getRandomValues; every stored form is SHA-256 in
// hex; every comparison of two hashes runs in time that does not depend on
// where they differ.
//
// Nothing here imports a page or the views counter: the shell (layout.tsx)
// reads the session through session.ts, which imports this file, and a page
// import from here would close a loop back to the shell.

const encoder = new TextEncoder();

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return [...(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// n random bytes as 2n hex characters.
export function randomHex(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// A row id: 16 random bytes.
export const newId = (): string => randomHex(16);

export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

// Whether two hex hashes are equal, looking at every character whatever the
// first difference. Different lengths are unequal at once: a length is not a
// secret here, since every hash is 64 characters.
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// A 6-digit code, uniform over 000000 to 999999: a 32-bit draw at or above
// the last whole multiple of a million is drawn again, so no code is likelier
// than another.
const CODE_SPAN = 1_000_000;
const CODE_LIMIT = Math.floor(0x1_0000_0000 / CODE_SPAN) * CODE_SPAN;

export function newCode(): string {
  const word = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(word);
    if (word[0] < CODE_LIMIT) return String(word[0] % CODE_SPAN).padStart(6, "0");
  }
}

// The address a sign-in request came from, hashed the way views.ts makes its
// visitor code: the day's salt is HMAC-SHA-256 of "account" and the UTC date
// under VIEWS_SALT_KEY, so it changes at midnight UTC and differs from the
// counter's; the hash is cut to 16 hex characters. Null without the secret.
// Never the address.
export async function ipHash(secret: string | undefined, ip: string | undefined, now: Date): Promise<string | null> {
  if (!secret || !ip) return null;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const salt = toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(`account\n${now.toISOString().slice(0, 10)}`)));
  return (await sha256Hex(`${salt}\n${ip}`)).slice(0, 16);
}

// ISO time n minutes or days after a moment.
export const plusMinutes = (now: Date, n: number): string => new Date(now.getTime() + n * 60_000).toISOString();
export const plusDays = (now: Date, n: number): string => new Date(now.getTime() + n * 86_400_000).toISOString();
