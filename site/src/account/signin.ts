// Sign-in by a code sent to the address: no password exists anywhere. A
// request makes a 6-digit code and a link token together; both are random,
// both are stored only as SHA-256 hashes, either one works once, and both
// end 15 minutes after the request. Five wrong codes in an hour lock the
// address for the rest of the hour, whatever requests it holds: a new
// request is made and sent as usual, and does not reset the count.
//
// Nothing here tells a known address from an unknown one: a request for any
// address makes the same row and the same message, and the user row is
// created only when a code is used.

import type { Env } from "../env";
import type { Lang } from "../i18n";
import { isBlocked } from "./admin_ops";
import { USAGE_KEEP_DAYS, USAGE_SWEEP_SQL, dayPlus, utcDay } from "./api_usage";
import { AUDIT_DAYS, audit } from "./audit";
import { newCode, newId, plusDays, plusMinutes, randomHex, sameHash, sha256Hex } from "./secrets";

export const CODE_MINUTES = 15;
// How long a bug report is kept (bugs.tsx); sweep() removes it after.
export const BUG_REPORT_DAYS = 180;
// Wrong codes (or wrong link secrets) an address may have in an hour, across
// all its requests.
export const CODE_TRIES = 5;
export const CODES_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

// The hour's ceiling, over the whole site, on sign-in messages asked for
// through a public page's Follow form (watch_pages.tsx). The form sits on
// every page with the control, where a script that sends a browser's headers
// could post it for address after address, and each post is a message from
// the site's own sender; the caps per address and per client do not bound
// that. Counted from the audit trail (code_requested with the detail
// "follow", read through idx_audit_at). Past the ceiling a Follow post is
// answered with the sign-in page, whose own post carries no follow and is
// not counted here, so no reader is kept from signing in. A count that
// cannot be read lets the post through, as a limiter fault does
// (src/limits.ts). Real demand is a few requests a week.
export const FOLLOW_CODES_PER_HOUR = 200;
export const FOLLOW_CODE_DETAIL = "follow";
export const FOLLOW_CODES_SQL = "SELECT COUNT(*) AS n FROM audit WHERE at >= ?1 AND event = 'code_requested' AND detail = ?2";

export async function followCodesInHour(env: Env, now: Date): Promise<number> {
  try {
    const row = await env.ACCOUNTS!.prepare(FOLLOW_CODES_SQL).bind(new Date(now.getTime() - HOUR_MS).toISOString(), FOLLOW_CODE_DETAIL)
      .first<{ n: number }>();
    return row?.n ?? 0;
  } catch {
    console.error("account sign-in: the hour's Follow requests not counted, let through");
    return 0;
  }
}
const CODE_RE = /^[0-9]{6}$/;
const TOKEN_RE = /^([0-9a-f]{32})\.([0-9a-f]{64})$/;

export const codeHash = (id: string, code: string) => sha256Hex(`${id}\n${code}`);

export type Issued = { code: string; token: string; userId: string | null };

// A new code and link for an address, or "limited" when the address has had
// CODES_PER_HOUR of them in the last hour (whether or not it has an account,
// so the answer says nothing about one). The count is taken inside the
// insert: a count read first and an insert after let a burst of posts that
// all counted before any inserted make many more codes (and messages) than
// the cap, and each extra live code is one more target for every guess.
export async function issueCode(env: Env, email: string, ip: string | null, now = new Date()): Promise<Issued | "limited"> {
  const db = env.ACCOUNTS!;
  const since = new Date(now.getTime() - 3_600_000).toISOString();
  const user = await db.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").bind(email).first<{ id: string }>();
  const id = newId();
  const code = newCode();
  const secret = randomHex(32);
  const res = await db.prepare(
    "INSERT INTO magic_codes (id, user_id, email, code_hash, link_hash, created_at, expires_at, ip_hash) " +
    "SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM magic_codes WHERE email = ? AND created_at > ?) < ?",
  ).bind(
    id, user?.id ?? null, email, await codeHash(id, code), await sha256Hex(secret), now.toISOString(), plusMinutes(now, CODE_MINUTES), ip,
    email, since, CODES_PER_HOUR,
  ).run();
  if ((res.meta?.changes ?? 0) !== 1) return "limited";
  return { code, token: `${id}.${secret}`, userId: user?.id ?? null };
}

// left: the wrong tries the address has left this hour, after this one.
export type Checked =
  | { ok: true; email: string }
  | { ok: false; reason: "wrong"; left: number }
  | { ok: false; reason: "locked" | "stale" };

type Live = { id: string; email: string; code_hash: string; link_hash: string; attempts: number };

// Uses a request: marks it used only if it is still live, so two posts of
// the same code cannot both sign in. Every other open request for the
// address is closed with it.
async function consume(env: Env, row: Live, now: Date): Promise<Checked> {
  // A blocked account (admin_ops.ts) gets what a used or expired code gets,
  // so the page says nothing about the block.
  if (await isBlocked(env, { email: row.email })) return { ok: false, reason: "stale" };
  const at = now.toISOString();
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE magic_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?",
  ).bind(at, row.id, at, CODE_TRIES).run();
  if ((res.meta?.changes ?? 0) !== 1) return { ok: false, reason: "stale" };
  await env.ACCOUNTS!.prepare("UPDATE magic_codes SET used_at = ? WHERE email = ? AND used_at IS NULL").bind(at, row.email).run();
  return { ok: true, email: row.email };
}

// -- the hour's wrong tries per address -----------------------------------------------

// A try is claimed before it is compared: a row in code_misses, written only
// while the address has fewer than CODE_TRIES rows in the last hour, in one
// statement, so tries sent at the same moment cannot pass the cap together.
// The row stays as the miss when the try is wrong, and goes when it matches
// or finds nothing live to compare. Null: the address is locked.
async function claimTry(env: Env, email: string, now: Date): Promise<string | null> {
  const id = newId();
  const res = await env.ACCOUNTS!.prepare(
    "INSERT INTO code_misses (id, email, at) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM code_misses WHERE email = ? AND at > ?) < ?",
  ).bind(id, email, now.toISOString(), email, new Date(now.getTime() - HOUR_MS).toISOString(), CODE_TRIES).run();
  return (res.meta?.changes ?? 0) === 1 ? id : null;
}

async function release(env: Env, claim: string): Promise<void> {
  await env.ACCOUNTS!.prepare("DELETE FROM code_misses WHERE id = ?").bind(claim).run();
}

async function triesLeft(env: Env, email: string, now: Date): Promise<number> {
  const row = await env.ACCOUNTS!.prepare("SELECT COUNT(*) AS n FROM code_misses WHERE email = ? AND at > ?")
    .bind(email, new Date(now.getTime() - HOUR_MS).toISOString()).first<{ n: number }>();
  return Math.max(0, CODE_TRIES - (row?.n ?? 0));
}

// A typed code against every live request for the address (at most
// CODES_PER_HOUR). Each hash is compared in full, whatever matched before. A
// wrong code is one of the address's CODE_TRIES for the hour, whichever
// request it aimed at; it also counts against each live request.
export async function checkCode(env: Env, email: string, code: string, now = new Date()): Promise<Checked> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const claim = await claimTry(env, email, now);
  if (!claim) return { ok: false, reason: "locked" };
  const res = await db.prepare(
    "SELECT id, email, code_hash, link_hash, attempts FROM magic_codes " +
    "WHERE email = ? AND used_at IS NULL AND expires_at > ? AND attempts < ? ORDER BY created_at DESC LIMIT ?",
  ).bind(email, at, CODE_TRIES, CODES_PER_HOUR).all<Live>();
  const live = res.results ?? [];
  if (!live.length) {
    await release(env, claim);
    return { ok: false, reason: "stale" };
  }
  let match: Live | null = null;
  if (CODE_RE.test(code)) {
    for (const row of live) {
      const same = sameHash(await codeHash(row.id, code), row.code_hash);
      if (same && !match) match = row;
    }
  }
  if (match) {
    const done = await consume(env, match, now);
    await release(env, claim);
    return done;
  }
  await db.batch(live.map((row) => db.prepare("UPDATE magic_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id)));
  const left = await triesLeft(env, email, now);
  await audit(env, null, left === 0 ? "code_locked" : "code_wrong", null, now);
  return left === 0 ? { ok: false, reason: "locked" } : { ok: false, reason: "wrong", left };
}

// The link's token: the request's id and its secret. While the address is
// locked a link answers locked too; a wrong secret for a live request is one
// of the address's wrong tries, and answers as a stale link does.
export async function checkLink(env: Env, token: string, now = new Date()): Promise<Checked> {
  const m = TOKEN_RE.exec(token);
  if (!m) return { ok: false, reason: "stale" };
  const [, id, secret] = m;
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const row = await db.prepare(
    "SELECT id, email, code_hash, link_hash, attempts FROM magic_codes WHERE id = ? AND used_at IS NULL AND expires_at > ?",
  ).bind(id, at).first<Live>();
  if (!row) return { ok: false, reason: "stale" };
  const claim = await claimTry(env, row.email, now);
  if (!claim) return { ok: false, reason: "locked" };
  if (row.attempts >= CODE_TRIES) {
    await release(env, claim);
    return { ok: false, reason: "locked" };
  }
  if (!sameHash(await sha256Hex(secret), row.link_hash)) {
    await db.prepare("UPDATE magic_codes SET attempts = attempts + 1 WHERE id = ?").bind(id).run();
    return { ok: false, reason: "stale" };
  }
  const done = await consume(env, row, now);
  await release(env, claim);
  return done;
}

// The user for an address that has just proved it: the existing active row,
// or a new one. created says which, for the audit trail.
export async function findOrCreateUser(env: Env, email: string, lang: Lang, now = new Date()): Promise<{ id: string; created: boolean }> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const res = await db.prepare(
    "INSERT INTO users (id, email, created_at, last_seen_at, lang, status, plan) VALUES (?, ?, ?, ?, ?, 'active', 'free') " +
    "ON CONFLICT (email) DO NOTHING",
  ).bind(newId(), email, at, at, lang).run();
  const user = await db.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'").bind(email).first<{ id: string }>();
  if (!user) throw new Error("user row missing after insert");
  await db.batch([
    db.prepare("UPDATE users SET last_seen_at = ?, lang = ? WHERE id = ?").bind(at, lang, user.id),
    db.prepare("UPDATE magic_codes SET user_id = ? WHERE email = ? AND user_id IS NULL").bind(user.id, email),
  ]);
  return { id: user.id, created: (res.meta?.changes ?? 0) === 1 };
}

// Rows past their keeping: sign-in requests and wrong tries after a day, sessions 90 days
// after they ended, the audit trail after 90 days, bug reports after
// BUG_REPORT_DAYS, the keyed API's daily counts after USAGE_KEEP_DAYS. Run
// with each sign-in request, so the tables stay small without a schedule of
// their own.
export async function sweep(env: Env, now = new Date()): Promise<void> {
  const db = env.ACCOUNTS!;
  const day = plusDays(now, -1);
  const old = plusDays(now, -AUDIT_DAYS);
  try {
    await db.batch([
      db.prepare("DELETE FROM magic_codes WHERE created_at < ?").bind(day),
      db.prepare("DELETE FROM code_misses WHERE at < ?").bind(day),
      db.prepare("DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)").bind(old, old),
      db.prepare("DELETE FROM audit WHERE at < ?").bind(old),
    ]);
  } catch {
    console.error("account sweep: not run");
  }
  // Apart from the batch: a database the bug_reports table has not reached
  // yet must not stop the sweeps above.
  try {
    await db.prepare("DELETE FROM bug_reports WHERE created_at < ?").bind(plusDays(now, -BUG_REPORT_DAYS)).run();
  } catch {
    console.error("account sweep: bug reports not swept");
  }
  // Apart again, for the same reason: api_usage arrived with the keyed API.
  try {
    await db.prepare(USAGE_SWEEP_SQL).bind(dayPlus(utcDay(now), -USAGE_KEEP_DAYS)).run();
  } catch {
    console.error("account sweep: api usage not swept");
  }
}
