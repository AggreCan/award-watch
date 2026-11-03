// Browser sessions. The cookie aw_session carries "<id>.<secret>": 16 random
// bytes naming the row and 32 more that prove it, both hex. The row holds the
// id and SHA-256 of the secret; the secret itself is never stored, so a copy
// of the database signs no one in. A lookup reads the row by id and compares
// the hashes in constant time.
//
// The cookie is HttpOnly (no script reads it), Secure, SameSite=Lax (another
// site's form post does not carry it) and lasts 30 days, extended on use (at
// most once an hour, so a page view is not a write). Every form a session
// posts also carries a CSRF value derived from the cookie's secret, which a
// page on another site cannot read.
//
// Fail open to outages, closed to revocation: a session the database says is
// revoked, expired or unknown is signed out on that request; a database that
// cannot answer leaves a session this isolate has already seen on its last
// known state (plan included) until the session's own end.

import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env } from "../env";
import type { Lang } from "../i18n";
import { type Plan, planFor } from "./entitlements";
import { newId, plusDays, randomHex, sameHash, sha256Hex } from "./secrets";
import { accountsEnabled } from "./switch";

export const SESSION_COOKIE = "aw_session";
export const SESSION_DAYS = 30;
const TOUCH_MS = 60 * 60 * 1000;

export type UaClass = "desktop" | "mobile" | "tablet";

export type Account = {
  userId: string;
  email: string;
  lang: Lang;
  createdAt: string;
  plan: Plan;
  planUntil: string | null;
  sessionId: string;
  // The value every form of a signed-in page carries (csrfValid).
  csrf: string;
  // True when the database could not be read and the last known state answered.
  stale: boolean;
};

export type SessionRead = { state: "none" } | { state: "ok"; account: Account } | { state: "unavailable" };

const COOKIE_RE = /^([0-9a-f]{32})\.([0-9a-f]{64})$/;

const cookieOptions = (maxAge: number) =>
  ({ path: "/", httpOnly: true, secure: true, sameSite: "Lax", maxAge }) as const;

export async function csrfFor(secret: string): Promise<string> {
  return (await sha256Hex(`csrf\n${secret}`)).slice(0, 32);
}

export function csrfValid(account: Account, value: string | undefined): boolean {
  return typeof value === "string" && sameHash(value, account.csrf);
}

// A new session for a user who has just proved the address: the row, then
// the cookie.
export async function startSession(c: Context<AppEnv>, userId: string, uaClass: UaClass | null, now = new Date()): Promise<void> {
  const id = newId();
  const secret = randomHex(32);
  const at = now.toISOString();
  await c.env.ACCOUNTS!.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, ua_class) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, userId, await sha256Hex(secret), at, at, plusDays(now, SESSION_DAYS), uaClass).run();
  setCookie(c, SESSION_COOKIE, `${id}.${secret}`, cookieOptions(SESSION_DAYS * 86_400));
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "Lax" });
}

export async function revokeSession(env: Env, sessionId: string, now = new Date()): Promise<void> {
  lastKnown.delete(sessionId);
  await env.ACCOUNTS!.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(now.toISOString(), sessionId).run();
}

// Sign out everywhere: every live session of the user, this one included.
export async function revokeAllSessions(env: Env, userId: string, now = new Date()): Promise<number> {
  for (const [id, known] of lastKnown) if (known.account.userId === userId) lastKnown.delete(id);
  const res = await env.ACCOUNTS!.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(now.toISOString(), userId).run();
  return res.meta?.changes ?? 0;
}

// -- reading the cookie ---------------------------------------------------------

// What this isolate last read for each session it has seen, for the outage
// case only. Bounded; the oldest entries go first.
type Known = { account: Omit<Account, "stale">; tokenHash: string; expiresAt: string };
const lastKnown = new Map<string, Known>();
const LAST_KNOWN_MAX = 500;

function remember(id: string, known: Known): void {
  lastKnown.delete(id);
  lastKnown.set(id, known);
  if (lastKnown.size > LAST_KNOWN_MAX) lastKnown.delete(lastKnown.keys().next().value as string);
}

// For tests: forget what this isolate has seen.
export function forgetSessions(): void {
  lastKnown.clear();
}

type Row = {
  id: string; token_hash: string; expires_at: string; revoked_at: string | null; last_seen_at: string;
  user_id: string; email: string; lang: string; status: string; plan: string; plan_until: string | null; created_at: string;
};

// One read per request: the shell and the page share it.
const perRequest = new WeakMap<Request, Promise<SessionRead>>();

export function readSession(c: Context<AppEnv>, opts: { touch?: boolean } = {}): Promise<SessionRead> {
  let read = perRequest.get(c.req.raw);
  if (!read) {
    read = lookup(c, !!opts.touch);
    perRequest.set(c.req.raw, read);
  }
  return read;
}

// After a sign-out or a deletion, the page this request renders reads as
// signed out (the rail shows "Sign in", not the address just removed).
export function markSignedOut(c: Context<AppEnv>): void {
  perRequest.set(c.req.raw, Promise.resolve({ state: "none" }));
}

async function lookup(c: Context<AppEnv>, touch: boolean): Promise<SessionRead> {
  const db = c.env.ACCOUNTS;
  const raw = getCookie(c, SESSION_COOKIE);
  if (!db || !raw) return { state: "none" };
  const m = COOKIE_RE.exec(raw);
  if (!m) return { state: "none" };
  const [, id, secret] = m;
  const tokenHash = await sha256Hex(secret);
  const now = new Date();
  const at = now.toISOString();
  let row: Row | null;
  try {
    row = await db.prepare(
      "SELECT s.id, s.token_hash, s.expires_at, s.revoked_at, s.last_seen_at, u.id AS user_id, u.email, u.lang, u.status, " +
      "u.plan, u.plan_until, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?",
    ).bind(id).first<Row>();
  } catch {
    const known = lastKnown.get(id);
    if (known && sameHash(known.tokenHash, tokenHash) && known.expiresAt > at) {
      return { state: "ok", account: { ...known.account, stale: true } };
    }
    console.error("account session: database unreadable");
    return { state: "unavailable" };
  }
  if (!row || !sameHash(row.token_hash, tokenHash) || row.revoked_at || row.expires_at <= at || row.status !== "active") {
    lastKnown.delete(id);
    return { state: "none" };
  }
  const plan = await planFor(c.env, { id: row.user_id, plan: row.plan, plan_until: row.plan_until }, now);
  const account: Account = {
    userId: row.user_id, email: row.email, lang: row.lang === "fr" ? "fr" : "en", createdAt: row.created_at,
    plan: plan.plan, planUntil: plan.until, sessionId: id, csrf: await csrfFor(secret), stale: false,
  };
  let expiresAt = row.expires_at;
  if (touch && now.getTime() - Date.parse(row.last_seen_at) > TOUCH_MS) {
    expiresAt = plusDays(now, SESSION_DAYS);
    try {
      await db.batch([
        db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").bind(at, expiresAt, id),
        db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(at, row.user_id),
      ]);
      setCookie(c, SESSION_COOKIE, raw, cookieOptions(SESSION_DAYS * 86_400));
    } catch {
      expiresAt = row.expires_at; // the session keeps its old end; nothing else changes
    }
  }
  const { stale: _stale, ...kept } = account;
  remember(id, { account: kept, tokenHash, expiresAt });
  return { state: "ok", account };
}

// -- the shell's account item -----------------------------------------------------

// What the rail shows in "Your lists": undefined while the switch is off (the
// rail shows nothing and nothing is read); signed out without a cookie or
// with one that does not stand; the email when signed in.
// The plan rides along for the badge after the wordmark (layout.tsx).
export type RailAccount = { email: string | null; plan: Plan | null };

export async function railAccount(c: Context<AppEnv>): Promise<RailAccount | undefined> {
  if (!accountsEnabled(c.env)) return undefined;
  if (!getCookie(c, SESSION_COOKIE)) return { email: null, plan: null };
  try {
    const read = await readSession(c);
    return read.state === "ok" ? { email: read.account.email, plan: read.account.plan } : { email: null, plan: null };
  } catch {
    return { email: null, plan: null };
  }
}

// -- the request's plan, for any page ------------------------------------------------

// The plan of the request's session, for a page that gates a feature
// (allowed({ plan }, "intraday")) without knowing about sessions. "free"
// while the switch is off (nothing is read: no cookie lookup, no database),
// without a session cookie, with one that does not stand, and when the
// accounts database cannot say and this instance has not already verified
// the session. A session this instance verified before an outage keeps its
// last known plan, the rule of readSession. Never throws.
export async function planOfRequest(c: Context<AppEnv>): Promise<Plan> {
  if (!accountsEnabled(c.env)) return "free";
  if (!getCookie(c, SESSION_COOKIE)) return "free";
  try {
    const read = await readSession(c);
    return read.state === "ok" ? read.account.plan : "free";
  } catch {
    return "free";
  }
}
