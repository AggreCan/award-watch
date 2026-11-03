// The Cloudflare Access check in front of the operator console (admin.tsx).
// Access, set up as a self-hosted application on the site's /admin path,
// stops every request that has not passed its own sign-in (a one-time PIN to
// the operator's address) before the Worker runs, and hands the Worker a
// signed token in the Cf-Access-Jwt-Assertion header. The Worker checks that
// token itself rather than trusting the header's presence: a request that
// reached the Worker some other way (a route left out of the application, a
// policy changed by mistake) carries no token Access signed.
//
// The token is an RS256 JWT. Its signing keys are the team's, published at
// https://<team>.cloudflareaccess.com/cdn-cgi/access/certs and fetched at
// most once an hour (Access announces a new key well before it signs with
// it); a token naming a key the cached set lacks fetches the set again, at
// most once a minute, so a stream of made-up key ids cannot turn into a
// stream of fetches. Checked: the signature (WebCrypto, no dependency), the
// issuer (the team's address), the audience (the application's AUD tag),
// the expiry, and the email claim, which admin.tsx compares with the
// session's address. Anything missing, malformed or unverifiable answers
// null, and the console answers the site's 404.

import type { Env } from "../env";

export const ACCESS_HEADER = "cf-access-jwt-assertion";
export const CERTS_TTL_MS = 60 * 60 * 1000;
const REFETCH_MIN_MS = 60 * 1000;
// Room for the two clocks to differ on nbf and iat; exp is taken as written.
const SKEW_S = 60;
const FETCH_TIMEOUT_MS = 5_000;
// A token is about a kilobyte; anything far past that is not one.
const TOKEN_MAX = 8_192;

const TEAM_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;

// The team's host from ACCESS_TEAM_DOMAIN, written as "<team>",
// "<team>.cloudflareaccess.com" or "https://<team>.cloudflareaccess.com".
// Null for anything else, so a value set by mistake can never point the
// certificate fetch at another host.
export function teamHost(raw: string | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase().replace(/^https:\/\//, "").replace(/\/+$/, "");
  if (!v) return null;
  const host = v.includes(".") ? v : `${v}.cloudflareaccess.com`;
  return TEAM_RE.test(host) ? host : null;
}

// Whether the console asks for an Access token at all: only once ACCESS_AUD
// is set. Until then the session alone admits (docs/accounts.md says this is
// for the first days only).
export function accessRequired(env: Pick<Env, "ACCESS_AUD">): boolean {
  return !!env.ACCESS_AUD?.trim();
}

// -- the team's keys ------------------------------------------------------------------

type Certs = { host: string; fetchedAt: number; keys: Map<string, CryptoKey> };
let cache: Certs | null = null;

// For tests: forget the keys this isolate has fetched.
export function forgetAccessCerts(): void {
  cache = null;
}

const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

async function fetchCerts(host: string): Promise<Map<string, CryptoKey> | null> {
  try {
    const res = await fetch(`https://${host}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`access: certs answered ${res.status}`);
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const body = (await res.json()) as { keys?: unknown };
    const keys = new Map<string, CryptoKey>();
    for (const item of Array.isArray(body.keys) ? body.keys : []) {
      const k = item as Record<string, unknown> | null;
      if (!k || typeof k.kid !== "string" || k.kty !== "RSA" || typeof k.n !== "string" || typeof k.e !== "string") continue;
      if (k.alg !== undefined && k.alg !== "RS256") continue;
      try {
        keys.set(k.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true }, RSA, false, ["verify"]));
      } catch {
        // A key that does not import is left out; the others still serve.
      }
    }
    return keys.size ? keys : null;
  } catch {
    console.error("access: certs unreachable");
    return null;
  }
}

// The key a token names. A fetch that fails leaves no key: the console is
// closed rather than checked against keys of unknown age.
async function keyFor(host: string, kid: string, nowMs: number): Promise<CryptoKey | null> {
  if (cache && cache.host === host && nowMs - cache.fetchedAt < CERTS_TTL_MS) {
    const known = cache.keys.get(kid);
    if (known) return known;
    if (nowMs - cache.fetchedAt < REFETCH_MIN_MS) return null;
  }
  const keys = await fetchCerts(host);
  if (!keys) return null;
  cache = { host, fetchedAt: nowMs, keys };
  return keys.get(kid) ?? null;
}

// -- the token ----------------------------------------------------------------------------

function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function jsonPart(s: string): Record<string, unknown> | null {
  const bytes = fromBase64Url(s);
  if (!bytes) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// The address in a request's Access token, lower-cased, once every check
// above holds; null otherwise (and always while ACCESS_AUD or the team is
// not set).
export async function accessEmail(env: Pick<Env, "ACCESS_AUD" | "ACCESS_TEAM_DOMAIN">, headers: Headers, now: Date = new Date()): Promise<string | null> {
  const aud = env.ACCESS_AUD?.trim();
  const host = teamHost(env.ACCESS_TEAM_DOMAIN);
  const token = headers.get(ACCESS_HEADER)?.trim();
  if (!aud || !host || !token || token.length > TOKEN_MAX) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const head = jsonPart(h);
  const claims = jsonPart(p);
  const signature = fromBase64Url(s);
  if (!head || !claims || !signature) return null;
  if (head.alg !== "RS256" || typeof head.kid !== "string" || !head.kid) return null;
  const key = await keyFor(host, head.kid, now.getTime());
  if (!key) return null;
  const signed = new TextEncoder().encode(`${h}.${p}`);
  let good = false;
  try {
    good = await crypto.subtle.verify(RSA, key, signature, signed);
  } catch {
    good = false;
  }
  if (!good) return null;
  const nowS = now.getTime() / 1000;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== `https://${host}` || !audiences.includes(aud)) return null;
  const exp = num(claims.exp);
  if (exp === null || exp <= nowS) return null;
  const nbf = num(claims.nbf);
  if (nbf !== null && nbf > nowS + SKEW_S) return null;
  const iat = num(claims.iat);
  if (iat !== null && iat > nowS + SKEW_S) return null;
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  return email && email.length <= 254 ? email : null;
}
