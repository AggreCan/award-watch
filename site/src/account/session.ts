// Browser sessions. The cookie __Host-aw_session carries "<id>.<secret>": 16 random
// bytes naming the row and 32 more that prove it, both hex. The row holds the
// id and SHA-256 of the secret; the secret itself is never stored, so a copy
// of the database signs no one in. A lookup reads the row by id and compares
// the hashes in constant time.
//
// The cookie is HttpOnly (no script reads it), Secure, SameSite=Lax (another
// site's form post does not carry it) and lasts 30 days, extended by any
// request that reads it (at most once an hour, so a page view is not a
// write; refreshSessionCookie sends it back). The __Host- prefix makes
// a browser refuse it unless it is Secure, on Path=/ and without a Domain, so
// no other host under the domain can set or shadow it. Every form a session
// posts also carries a CSRF value derived from the cookie's secret, which a
// page on another site cannot read.
//
// Fail open to outages, closed to revocation: a session the database says is
// revoked, expired or unknown is signed out on that request; a database that
// cannot answer leaves a session this isolate has verified within the last
// hour on its last known state, its plan until the plan's own end. Past that
// hour the request is treated as one the database cannot answer: a
// revocation made through another isolate stands at most an hour unseen.
//
// An account stays signed in on at most SESSIONS_MAX browsers, on every plan:
// a sign-in past that ends the sessions used least recently (startSession).
// Why a session ended is not stored; the browser that holds one ended by
// another browser is told only that it was (lookup's ended).

import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Env } from "../env";
import type { Lang } from "../i18n";
import { type Plan, isPaidPlan, lastKnownPlan, planFor } from "./entitlements";
import { newId, plusDays, randomHex, sameHash, sha256Hex } from "./secrets";
import { accountsEnabled } from "./switch";

export const SESSION_COOKIE = "__Host-aw_session";
export const SESSION_DAYS = 30;
const TOUCH_MS = 60 * 60 * 1000;
// Live sessions an account keeps, any plan (docs/accounts.md, Sign-in flow):
// a desk computer, a laptop and a phone. The overview's row and panel, the
// sign-in page's line and the privacy page read the figure from here.
export const SESSIONS_MAX = 3;

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

// ended: the cookie's own session, revoked elsewhere while the account stands
// (the cap, a sign-out everywhere, the overview's Sign out on its row, the
// operator's console); the account pages send the reader to sign in with a
// line saying so.
export type SessionRead = { state: "none"; ended?: true } | { state: "ok"; account: Account } | { state: "unavailable" };

const COOKIE_RE = /^([0-9a-f]{32})\.([0-9a-f]{64})$/;
const SESSION_ID_RE = /^[0-9a-f]{32}$/;

const cookieOptions = (maxAge: number) =>
  ({ path: "/", httpOnly: true, secure: true, sameSite: "Lax", maxAge }) as const;

export async function csrfFor(secret: string): Promise<string> {
  return (await sha256Hex(`csrf\n${secret}`)).slice(0, 32);
}

export function csrfValid(account: Account, value: string | undefined): boolean {
  return typeof value === "string" && sameHash(value, account.csrf);
}

// The cap, the second statement of startSession's batch: every live session
// of the account outside the SESSIONS_MAX used most recently ends. ?1 the
// time, ?2 the account, ?3 SESSIONS_MAX, ?4 the new session's id, which the
// order puts first: its last_seen_at is the request's clock, and another
// browser's touch stamped a moment later by another isolate (or a sign-in of
// the same millisecond whose id sorts higher) must not end the session this
// sign-in is handing out. idx_sessions_user serves both reads.
export const SESSION_CAP_SQL =
  "UPDATE sessions SET revoked_at = ?1 WHERE user_id = ?2 AND revoked_at IS NULL AND expires_at > ?1 " +
  "AND id NOT IN (SELECT id FROM sessions WHERE user_id = ?2 AND revoked_at IS NULL AND expires_at > ?1 " +
  "ORDER BY id = ?4 DESC, last_seen_at DESC, created_at DESC, id DESC LIMIT ?3)";

// A new session for a user who has just proved the address: the row and the
// cap in one batch, which D1 runs as one transaction, then the cookie. The
// cap keeps the new row and ends the sessions used least recently; a second
// sign-in at the same moment runs after this one and sees its row, so two
// at once still leave SESSIONS_MAX. Answers how many sessions the cap ended.
export async function startSession(c: Context<AppEnv>, userId: string, uaClass: UaClass | null, now = new Date()): Promise<number> {
  const db = c.env.ACCOUNTS!;
  const id = newId();
  const secret = randomHex(32);
  const at = now.toISOString();
  const [, cap] = await db.batch([
    db.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, ua_class) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, userId, await sha256Hex(secret), at, at, plusDays(now, SESSION_DAYS), uaClass),
    db.prepare(SESSION_CAP_SQL).bind(at, userId, SESSIONS_MAX, id),
  ]);
  const ended = cap?.meta?.changes ?? 0;
  // The statement names no session, so this isolate forgets every one of the
  // account it remembered for an outage: those still live are read again.
  if (ended) forgetUser(userId);
  setCookie(c, SESSION_COOKIE, `${id}.${secret}`, cookieOptions(SESSION_DAYS * 86_400));
  return ended;
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
  forgetUser(userId);
  const res = await env.ACCOUNTS!.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(now.toISOString(), userId).run();
  return res.meta?.changes ?? 0;
}

// The overview's Sign out on another browser's row: one live session of the
// account, never the one making the request (that browser signs out with the
// Sign Out panel's button). Bound to the account's id, so an id of another
// account changes nothing, exactly as an id that does not exist; the route
// answers both alike. True when a session ended.
export async function revokeOtherSession(env: Env, account: Pick<Account, "userId" | "sessionId">, id: string, now = new Date()): Promise<boolean> {
  if (!SESSION_ID_RE.test(id) || id === account.sessionId) return false;
  const at = now.toISOString();
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE sessions SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND id <> ?4 AND revoked_at IS NULL AND expires_at > ?1",
  ).bind(at, id, account.userId, account.sessionId).run();
  if ((res.meta?.changes ?? 0) !== 1) return false;
  lastKnown.delete(id);
  return true;
}

// The account's live sessions for the overview's panel, the one used most
// recently first: never the secret's hash, never another account's row.
export type LiveSession = { id: string; ua_class: UaClass | null; created_at: string; last_seen_at: string };

export async function liveSessions(env: Env, userId: string, now = new Date()): Promise<LiveSession[]> {
  const res = await env.ACCOUNTS!.prepare(
    "SELECT id, ua_class, created_at, last_seen_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? " +
    "ORDER BY last_seen_at DESC, created_at DESC, id DESC",
  ).bind(userId, now.toISOString()).all<LiveSession>();
  return res.results ?? [];
}

// -- reading the cookie ---------------------------------------------------------

// What this isolate last read for each session it has seen, for the outage
// case only, and when (verifiedAt, ms). Bounded; the oldest entries go first.
type Known = { account: Omit<Account, "stale">; tokenHash: string; expiresAt: string; verifiedAt: number };
// How long after its last verification a remembered session still answers
// through an outage.
export const OUTAGE_TRUST_MS = 60 * 60 * 1000;
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

function forgetUser(userId: string): void {
  for (const [id, known] of lastKnown) if (known.account.userId === userId) lastKnown.delete(id);
}

type Row = {
  id: string; token_hash: string; expires_at: string; revoked_at: string | null; last_seen_at: string;
  user_id: string; email: string; lang: string; status: string; plan: string; plan_until: string | null; created_at: string;
};

// One read per request: the shell and the page share it.
const perRequest = new WeakMap<Request, Promise<SessionRead>>();

// The cookie of a session this request extended, to send back once the
// answer is made (refreshSessionCookie).
const extended = new WeakMap<Request, string>();

// Whoever reads first, the shell, a control or an account route, the read
// extends a session that stands and was last extended over an hour ago: any
// page a signed-in reader opens counts as use (docs/accounts.md, Sign-in flow).
export function readSession(c: Context<AppEnv>): Promise<SessionRead> {
  let read = perRequest.get(c.req.raw);
  if (!read) {
    read = lookup(c);
    perRequest.set(c.req.raw, read);
  }
  return read;
}

// After a sign-out or a deletion, the page this request renders reads as
// signed out (the rail shows "Sign in", not the address just removed).
export function markSignedOut(c: Context<AppEnv>): void {
  perRequest.set(c.req.raw, Promise.resolve({ state: "none" }));
  extended.delete(c.req.raw);
}

// The extended session's cookie goes out on the answer, whatever made it (a
// page, a redirect, a file, a 304), once it is made: an answer that already
// sets the cookie (a new sign-in's, or a sign-out's that clears it) keeps
// its own. The cookie carries the session's secret, so that answer is
// private and no-store: no shared cache may keep it and hand it to another
// reader. A page that names the signed-in address is already that (layout.tsx
// page()); a 304 keeps its tag, which is taken from the body alone
// (conditional.ts), and a browser takes a cookie from a 304 as from a 200.
export async function refreshSessionCookie(c: Context<AppEnv>, next: Next): Promise<void> {
  await next();
  const raw = extended.get(c.req.raw);
  if (!raw) return;
  if (c.res.headers.getSetCookie().some((s) => s.startsWith(`${SESSION_COOKIE}=`))) return;
  setCookie(c, SESSION_COOKIE, raw, cookieOptions(SESSION_DAYS * 86_400));
  c.header("Cache-Control", "private, no-store");
}

async function lookup(c: Context<AppEnv>): Promise<SessionRead> {
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
    if (known && sameHash(known.tokenHash, tokenHash) && known.expiresAt > at && now.getTime() - known.verifiedAt <= OUTAGE_TRUST_MS) {
      // The plan this isolate read still stands only until its own end, which
      // is known here without the database (lastKnownPlan, as planFor uses on
      // an outage): an entitlement that has ended is closed, outage or not.
      const held = lastKnownPlan({ id: known.account.userId, plan: known.account.plan, plan_until: known.account.planUntil }, now);
      return { state: "ok", account: { ...known.account, plan: held.plan, planUntil: held.until, stale: true } };
    }
    console.error("account session: database unreadable");
    return { state: "unavailable" };
  }
  if (!row || !sameHash(row.token_hash, tokenHash) || row.revoked_at || row.expires_at <= at || row.status !== "active") {
    lastKnown.delete(id);
    // Ended by another browser: only for the cookie's own secret, so an id
    // alone learns nothing, and only while the account stands (a deleted
    // account's browsers read as signed out, nothing more).
    const ended = !!row && !!row.revoked_at && row.status === "active" && sameHash(row.token_hash, tokenHash);
    return ended ? { state: "none", ended: true } : { state: "none" };
  }
  const plan = await planFor(c.env, { id: row.user_id, plan: row.plan, plan_until: row.plan_until }, now);
  const account: Account = {
    userId: row.user_id, email: row.email, lang: row.lang === "fr" ? "fr" : "en", createdAt: row.created_at,
    plan: plan.plan, planUntil: plan.until, sessionId: id, csrf: await csrfFor(secret), stale: false,
  };
  let expiresAt = row.expires_at;
  if (accountsEnabled(c.env) && now.getTime() - Date.parse(row.last_seen_at) > TOUCH_MS) {
    expiresAt = plusDays(now, SESSION_DAYS);
    try {
      await db.batch([
        db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?").bind(at, expiresAt, id),
        db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(at, row.user_id),
      ]);
      extended.set(c.req.raw, raw);
    } catch {
      expiresAt = row.expires_at; // the session keeps its old end; nothing else changes
    }
  }
  const { stale: _stale, ...kept } = account;
  remember(id, { account: kept, tokenHash, expiresAt, verifiedAt: now.getTime() });
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

// -- the paying account of a download, for the limiter ----------------------------------

// The user id of the request's session when the database has just answered
// for it and its plan is paid (Pro or Ultra): the key of that account's own
// download cap (limits.ts throttle, PAID_DOWNLOAD_LIMIT). This is the
// request's one read (readSession above), which the route then reuses, so a
// download that reads the plan anyway costs nothing more. null, and nothing
// read, while the switch is off or without a session cookie; null for a
// session that does not stand, a free plan, a database that cannot answer,
// and a session answered from this isolate's memory through an outage
// (stale): each of those is counted by address. Never throws.
export async function paidAccountOf(c: Context<AppEnv>): Promise<string | null> {
  if (!accountsEnabled(c.env)) return null;
  if (!getCookie(c, SESSION_COOKIE)) return null;
  try {
    const read = await readSession(c);
    return read.state === "ok" && !read.account.stale && isPaidPlan(read.account.plan) ? read.account.userId : null;
  } catch {
    return null;
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
