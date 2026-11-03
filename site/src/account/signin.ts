// Sign-in by a code sent to the address: no password exists anywhere. A
// request makes a 6-digit code and a link token together; both are random,
// both are stored only as SHA-256 hashes, either one works once, and both
// end 15 minutes after the request. Five wrong codes lock the request.
//
// Nothing here tells a known address from an unknown one: a request for any
// address makes the same row and the same message, and the user row is
// created only when a code is used.

import type { Env } from "../env";
import type { Lang } from "../i18n";
import { AUDIT_DAYS, audit } from "./audit";
import { newCode, newId, plusDays, plusMinutes, randomHex, sameHash, sha256Hex } from "./secrets";

export const CODE_MINUTES = 15;
export const CODE_TRIES = 5;
export const CODES_PER_HOUR = 5;
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

export type Checked =
  | { ok: true; email: string }
  | { ok: false; reason: "wrong" | "locked" | "stale" };

type Live = { id: string; email: string; code_hash: string; link_hash: string; attempts: number };

// Uses a request: marks it used only if it is still live, so two posts of
// the same code cannot both sign in. Every other open request for the
// address is closed with it.
async function consume(env: Env, row: Live, now: Date): Promise<Checked> {
  const at = now.toISOString();
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE magic_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? AND attempts < ?",
  ).bind(at, row.id, at, CODE_TRIES).run();
  if ((res.meta?.changes ?? 0) !== 1) return { ok: false, reason: "stale" };
  await env.ACCOUNTS!.prepare("UPDATE magic_codes SET used_at = ? WHERE email = ? AND used_at IS NULL").bind(at, row.email).run();
  return { ok: true, email: row.email };
}

// A typed code against every live request for the address (at most
// CODES_PER_HOUR). Each hash is compared in full, whatever matched before. A
// wrong code counts against every live request, so the guesses an address
// can take are CODE_TRIES per request, whichever request they aim at.
export async function checkCode(env: Env, email: string, code: string, now = new Date()): Promise<Checked> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const res = await db.prepare(
    "SELECT id, email, code_hash, link_hash, attempts FROM magic_codes " +
    "WHERE email = ? AND used_at IS NULL AND expires_at > ? AND attempts < ? ORDER BY created_at DESC LIMIT ?",
  ).bind(email, at, CODE_TRIES, CODES_PER_HOUR).all<Live>();
  const live = res.results ?? [];
  if (!live.length) return { ok: false, reason: "stale" };
  let match: Live | null = null;
  if (CODE_RE.test(code)) {
    for (const row of live) {
      const same = sameHash(await codeHash(row.id, code), row.code_hash);
      if (same && !match) match = row;
    }
  }
  if (match) return consume(env, match, now);
  await db.batch(live.map((row) => db.prepare("UPDATE magic_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id)));
  const locked = live.every((row) => row.attempts + 1 >= CODE_TRIES);
  await audit(env, null, locked ? "code_locked" : "code_wrong", null, now);
  return { ok: false, reason: locked ? "locked" : "wrong" };
}

// The link's token: the request's id and its secret. A token that names a
// live request with the wrong secret counts as a wrong try against it.
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
  if (row.attempts >= CODE_TRIES) return { ok: false, reason: "locked" };
  if (!sameHash(await sha256Hex(secret), row.link_hash)) {
    await db.prepare("UPDATE magic_codes SET attempts = attempts + 1 WHERE id = ?").bind(id).run();
    return { ok: false, reason: "stale" };
  }
  return consume(env, row, now);
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

// Rows past their keeping: sign-in requests after a day, sessions 90 days
// after they ended, the audit trail after 90 days. Run with each sign-in
// request, so the tables stay small without a schedule of their own.
export async function sweep(env: Env, now = new Date()): Promise<void> {
  const db = env.ACCOUNTS!;
  const day = plusDays(now, -1);
  const old = plusDays(now, -AUDIT_DAYS);
  try {
    await db.batch([
      db.prepare("DELETE FROM magic_codes WHERE created_at < ?").bind(day),
      db.prepare("DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)").bind(old, old),
      db.prepare("DELETE FROM audit WHERE at < ?").bind(old),
    ]);
  } catch {
    console.error("account sweep: not run");
  }
}
