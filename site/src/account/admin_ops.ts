// The operator console's side of the accounts database (admin.tsx holds the
// routes and the pages): the reads behind the overview and the user page,
// and the operations each action runs. Also isBlocked, which sign-in
// (signin.ts) and API keys (api_keys.ts) ask, so this file imports nothing
// that imports either of them: no page, no route, no billing code.
//
// Every operation writes an audit row whose detail names the operator by
// user id ("by <id>"), never by address, as every audit detail must.
// Blocking is a row in account_blocks; while it stands the account's
// sessions are revoked, its codes and links answer as stale ones do
// (signin.ts), its API keys answer 401 (api_keys.ts), and its saved searches'
// email delivery is turned off and remembered, to be turned back on when
// the block is lifted, so the delivery job, which reads only the searches
// that are on, skips the account without a change of its own.

import { watchDetail } from "./watches";
import type { Env } from "../env";
import { type PaidPlan, entitlementWrites, missingSeats, missingTiers, planFor, seatsReady, withTiers } from "./entitlements";
import { GRANT_ENDS_SEAT_SQL, SEAT_WINDOW_DAYS } from "./seats";
import { newId, plusDays } from "./secrets";
import { revokeAllSessions } from "./session";

// -- who may use the console ----------------------------------------------------------

// OPERATOR_EMAILS, a secret: comma-separated addresses, read lower-cased.
export function operatorEmails(env: Pick<Env, "OPERATOR_EMAILS">): Set<string> {
  return new Set((env.OPERATOR_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// -- the audit trail ----------------------------------------------------------------------

export type OperatorEvent =
  | "operator_granted" | "operator_revoked" | "operator_cancelled" | "operator_refunded" | "operator_blocked"
  | "operator_unblocked" | "operator_email_changed" | "operator_signed_out" | "operator_deleted" | "operator_announced"
  | "operator_announced_ultra" | "operator_mail_check"
  // The console's actions on seats (admin.tsx): a seat ended (on the holder's row and the member's) or an
  // invitation cancelled (on the holder's), the detail the operator alone, never the seat's id or an address.
  | "operator_seat_ended" | "operator_invite_cancelled";

// The audit table of audit.ts, with its rule: a failure to write is logged
// without detail and never fails the action that was taken. note is a short
// fixed phrase chosen by the code. userId is null for an action on no one
// account (the accounts-open message).
export async function operatorAudit(
  env: Env, userId: string | null, event: OperatorEvent, operatorId: string, note: string | null = null, now = new Date(),
): Promise<void> {
  const detail = `by ${operatorId}${note ? `, ${note}` : ""}`.slice(0, 120);
  try {
    await env.ACCOUNTS!.prepare("INSERT INTO audit (user_id, event, at, detail) VALUES (?, ?, ?, ?)")
      .bind(userId, event, now.toISOString(), detail).run();
  } catch {
    console.error(`operator audit: ${event} not recorded`);
  }
}

// -- tables applied by hand ---------------------------------------------------------------

// account_blocks is applied with the rest of accounts_schema.sql, and
// bug_reports comes with the bug report page; either may be missing from a
// database the schema has not been applied to again. A missing table reads
// as empty (no account can be blocked without the table); any other fault
// is passed on.
const missingTable = (e: unknown) => /no such table/i.test(String((e as { message?: unknown })?.message ?? e));

async function optional<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// -- blocking -----------------------------------------------------------------------------

// Whether the account is blocked, by its id or by its address (sign-in knows
// only the address). False without the database binding or the table.
export async function isBlocked(env: Env, who: { id: string } | { email: string }): Promise<boolean> {
  const db = env.ACCOUNTS;
  if (!db) return false;
  const row = await optional(() =>
    "id" in who
      ? db.prepare("SELECT 1 AS b FROM account_blocks WHERE user_id = ?").bind(who.id).first()
      : db.prepare("SELECT 1 AS b FROM account_blocks k JOIN users u ON u.id = k.user_id WHERE u.email = ?").bind(who.email).first(),
  );
  return !!row;
}

export type BlockRow = { reason: string | null; created_at: string; by_user_id: string; paused: string | null };

const PAUSED_RE = /^([0-9a-f]{32}):(daily|weekly)$/;

// The searches a block turned off, as "<id>:<daily|weekly>" items.
export function pausedSearches(paused: string | null): [string, "daily" | "weekly"][] {
  const out: [string, "daily" | "weekly"][] = [];
  for (const item of (paused ?? "").split(",")) {
    const m = PAUSED_RE.exec(item.trim());
    if (m) out.push([m[1], m[2] as "daily" | "weekly"]);
  }
  return out;
}

// In one batch: the block row (with the searches whose delivery is on), the
// delivery turned off, every session revoked. revokeAllSessions then runs
// again, which also forgets the sessions this isolate remembers for an
// outage and ends any session a sign-in started while the batch ran.
// "already" when the account was blocked before; nothing changes then.
export async function blockAccount(env: Env, userId: string, operatorId: string, reason: string, now = new Date()): Promise<"blocked" | "already"> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const [inserted] = await db.batch([
    db.prepare(
      "INSERT INTO account_blocks (user_id, reason, created_at, by_user_id, paused) " +
      "SELECT ?1, ?2, ?3, ?4, (SELECT group_concat(id || ':' || deliver, ',') FROM saved_searches WHERE user_id = ?1 AND deliver != 'off') " +
      "WHERE NOT EXISTS (SELECT 1 FROM account_blocks WHERE user_id = ?1)",
    ).bind(userId, reason, at, operatorId),
    db.prepare("UPDATE saved_searches SET deliver = 'off' WHERE user_id = ? AND deliver != 'off'").bind(userId),
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, userId),
  ]);
  await revokeAllSessions(env, userId, now);
  if (!inserted.meta?.changes) return "already";
  await operatorAudit(env, userId, "operator_blocked", operatorId, null, now);
  return "blocked";
}

// Lifts the block and turns delivery back on for the searches it turned
// off that are still off. Null when the account was not blocked.
export async function unblockAccount(env: Env, userId: string, operatorId: string, now = new Date()): Promise<{ restored: number } | null> {
  const db = env.ACCOUNTS!;
  const row = await db.prepare("SELECT paused FROM account_blocks WHERE user_id = ?").bind(userId).first<{ paused: string | null }>();
  if (!row) return null;
  const restore = pausedSearches(row.paused);
  const results = await db.batch([
    db.prepare("DELETE FROM account_blocks WHERE user_id = ?").bind(userId),
    ...restore.map(([id, deliver]) =>
      db.prepare("UPDATE saved_searches SET deliver = ? WHERE id = ? AND user_id = ? AND deliver = 'off'").bind(deliver, id, userId)),
  ]);
  if (!results[0].meta?.changes) return null;
  const restored = results.slice(1).reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
  await operatorAudit(env, userId, "operator_unblocked", operatorId, null, now);
  return { restored };
}

// -- plans --------------------------------------------------------------------------------

type Holder = { id: string; plan: string; plan_until: string | null };

async function refreshPlan(env: Env, userId: string, now: Date): Promise<void> {
  const user = await env.ACCOUNTS!.prepare("SELECT id, plan, plan_until FROM users WHERE id = ?").bind(userId).first<Holder>();
  if (user) await planFor(env, user, now);
}

// A manual row of the plan from now to endsAt (null for no end), as the
// documented insert writes it, in one batch with its tier row for Ultra
// (entitlementWrites); then the cached plan on users is brought up to date.
// "no_tiers": an Ultra grant on a database without entitlement_tiers, which
// writes nothing (the batch is one transaction) and says which file to apply.
// A grant of Ultra by hand works whether or not Ultra is on sale.
//
// seats: the seats table is on the database (the caller read the account's seat,
// seats.ts memberSeatOf). The batch then also ends every live seat the account
// holds (GRANT_ENDS_SEAT_SQL), so the grant and the seat's end are written
// together or not at all; each seat ended writes the audit rows the console's End
// this seat writes, on its holder and on the account, naming the operator alone.
// ended: how many seats the grant ended (0 or 1).
export async function grantPlan(
  env: Env, userId: string, operatorId: string, plan: PaidPlan, endsAt: string | null, reference: string, now = new Date(), seats = false,
): Promise<{ result: "granted"; ended: number } | { result: "no_tiers" }> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const writes = entitlementWrites(db, { id: newId(), userId, plan, source: "manual", startsAt: at, endsAt, reference, createdAt: at });
  let done: D1Result[];
  try {
    done = await db.batch(seats ? [...writes, db.prepare(GRANT_ENDS_SEAT_SQL).bind(at, userId)] : writes);
  } catch (e) {
    if (plan === "ultra" && missingTiers(e)) return { result: "no_tiers" };
    throw e;
  }
  const ended = seats ? ((done[done.length - 1]?.results ?? []) as { id: string; holder_id: string }[]) : [];
  await refreshPlan(env, userId, now);
  const end = endsAt ? `until ${endsAt.slice(0, 10)}` : "no end";
  await operatorAudit(env, userId, "operator_granted", operatorId, plan === "ultra" ? `ultra, ${end}` : end, now);
  for (const seat of ended) {
    await operatorAudit(env, seat.holder_id, "operator_seat_ended", operatorId, null, now);
    await operatorAudit(env, userId, "operator_seat_ended", operatorId, null, now);
  }
  return { result: "granted", ended: ended.length };
}

// Pro by hand, as before Ultra.
export async function grantPro(env: Env, userId: string, operatorId: string, endsAt: string | null, reference: string, now = new Date()): Promise<void> {
  await grantPlan(env, userId, operatorId, "pro", endsAt, reference, now);
}

// Revokes one row of the account that is not revoked or ended yet. False
// when there is none such.
export async function revokeEntitlement(env: Env, userId: string, entitlementId: string, operatorId: string, now = new Date()): Promise<boolean> {
  const at = now.toISOString();
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE entitlements SET revoked_at = ?1 WHERE id = ?2 AND user_id = ?3 AND revoked_at IS NULL AND (ends_at IS NULL OR ends_at > ?1)",
  ).bind(at, entitlementId, userId).run();
  if (!res.meta?.changes) return false;
  await refreshPlan(env, userId, now);
  await operatorAudit(env, userId, "operator_revoked", operatorId, null, now);
  return true;
}

// -- the address ----------------------------------------------------------------------------

// The account's address becomes newEmail (already normalized), unless any
// row holds it; the old address's open sign-in requests and wrong tries go,
// and every session is revoked. "taken" covers a row written by another
// request between the check and the update too (the column is UNIQUE).
export async function changeAddress(env: Env, userId: string, oldEmail: string, newEmail: string, now = new Date()): Promise<"changed" | "taken" | "missing"> {
  const db = env.ACCOUNTS!;
  if (await db.prepare("SELECT 1 AS x FROM users WHERE email = ?").bind(newEmail).first()) return "taken";
  let changed: D1Result[];
  try {
    changed = await db.batch([
      db.prepare("UPDATE users SET email = ? WHERE id = ? AND email = ? AND status = 'active'").bind(newEmail, userId, oldEmail),
      db.prepare("DELETE FROM magic_codes WHERE user_id = ? OR email = ?").bind(userId, oldEmail),
      db.prepare("DELETE FROM code_misses WHERE email = ?").bind(oldEmail),
    ]);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String((e as { message?: unknown })?.message ?? e))) return "taken";
    throw e;
  }
  if (!changed[0].meta?.changes) return "missing";
  await revokeAllSessions(env, userId, now);
  return "changed";
}

// -- reads: the overview ------------------------------------------------------------------

export type AuditRow = { id: number; user_id: string | null; event: string; at: string; detail: string | null };
export type BugRow = { id: string; user_id: string; page: string; text: string; created_at: string };
export type UserHit = { id: string; email: string; status: string; plan: string; plan_until: string | null; created_at: string };

export type Overview = {
  active: number; deleted: number; blocked: number | null; sessions: number; codesToday: number;
  // Accounts on Pro and on Ultra now, by the source of the deciding row; Ultra's null before entitlement_tiers exists.
  proManual: number; proStripe: number; ultraManual: number | null; ultraStripe: number | null; subscriptions: { status: string; n: number }[];
  // sent and failed count deliveries rows, one a saved search (a grouped message's searches each count); messages
  // is the run log's sends over the same days, one a message (the delivery job's and the console's), null before
  // delivery_runs exists.
  sent: number; failed: number; messages: number | null; bugs: { all: number; week: number } | null;
  audit: AuditRow[]; latestBugs: BugRow[] | null;
  // The seats' signals, null while the seats table is not on the database.
  seats?: SeatSignals | null;
};

// The seats' signals on the overview (the seats design's 5.7, slice E), counts
// alone and no address: the live seats and the holders that give them, the
// invitations open now, the joins of the last SEAT_WINDOW_DAYS (ended seats
// counted, as the joins allowance counts them), and the browsers the browser
// cap signed out in the last CAPPED_DAYS (the audit's "signed_out" rows of
// detail "cap <n>", session.ts SESSIONS_MAX) with the accounts it signed out
// CAPPED_ACCOUNT_MIN or more of, the design's mark of one sign-in shared by a
// team, for the operator to read. Read whenever the seats table is on the
// database, the seats' switch on or off; while it is not, nothing more is read.
export type SeatSignals = { seats: number; holders: number; open: number; joins: number; capped: number; cappedAccounts: number };
export const CAPPED_DAYS = 30;
export const CAPPED_ACCOUNT_MIN = 10;

// ?1 now, ?2 SEAT_WINDOW_DAYS ago. The live seats through idx_seats_member_live,
// the open invitations through idx_seats_email (an open invitation keeps its
// address); the joins read the table's rows, which the sweep holds to the live
// ones and those of its last SEAT_KEEP_DAYS.
export const SEAT_SIGNALS_SQL =
  "SELECT (SELECT COUNT(*) FROM seats WHERE member_id IS NOT NULL AND ended_at IS NULL) AS seats, " +
  "(SELECT COUNT(DISTINCT holder_id) FROM seats WHERE member_id IS NOT NULL AND ended_at IS NULL) AS holders, " +
  "(SELECT COUNT(*) FROM seats WHERE email IS NOT NULL AND member_id IS NULL AND ended_at IS NULL AND expires_at > ?1) AS open, " +
  "(SELECT COUNT(*) FROM seats WHERE joined_at > ?2) AS joins";

// ?1 CAPPED_DAYS ago, ?2 CAPPED_ACCOUNT_MIN: the window's rows through idx_audit_at,
// summed by account.
export const CAP_SIGNALS_SQL =
  "SELECT COALESCE(SUM(n), 0) AS capped, COALESCE(SUM(n >= ?2), 0) AS accounts FROM (" +
  "SELECT user_id, SUM(CAST(substr(detail, 5) AS INTEGER)) AS n FROM audit " +
  "WHERE at >= ?1 AND event = 'signed_out' AND detail LIKE 'cap %' GROUP BY user_id)";

export const WEEK_DAYS = 7;
export const OVERVIEW_AUDIT_ROWS = 20;
export const OVERVIEW_BUG_ROWS = 10;

export async function overview(env: Env, now = new Date()): Promise<Overview> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const today = `${at.slice(0, 10)}T00:00:00.000Z`;
  const week = new Date(now.getTime() - WEEK_DAYS * 86_400_000).toISOString();
  // The session read that admitted the operator has asked planFor, which knows by now whether the table is there.
  const seats = await seatsReady(env, now);
  const signals = () => (seats ? [
    db.prepare(SEAT_SIGNALS_SQL).bind(at, plusDays(now, -SEAT_WINDOW_DAYS)),
    db.prepare(CAP_SIGNALS_SQL).bind(plusDays(now, -CAPPED_DAYS), CAPPED_ACCOUNT_MIN),
  ] : []);
  const { results: [counts, pro, subs, audit, seatRow, capRow], tiers } = await withTiers(async (tiers) => ({ tiers, results: await db.batch([
    db.prepare(
      "SELECT (SELECT COUNT(*) FROM users WHERE status = 'active') AS active, (SELECT COUNT(*) FROM users WHERE status = 'deleted') AS deleted, " +
      "(SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > ?1) AS sessions, " +
      "(SELECT COUNT(*) FROM magic_codes WHERE created_at >= ?2) AS codes, " +
      "(SELECT COUNT(*) FROM deliveries WHERE status = 'sent' AND sent_at >= ?3) AS sent, " +
      "(SELECT COUNT(*) FROM deliveries WHERE status = 'failed' AND sent_at >= ?3) AS failed",
    ).bind(at, today, week),
    // Accounts whose plan is Pro or Ultra now, by the plan and the source of
    // the row that decides it: the latest live row per active account, as
    // planFromRows picks it, its plan read through its tier (Ultra is a pro
    // row with a tier row beside it).
    db.prepare(
      `SELECT plan, source, COUNT(*) AS n FROM (SELECT ${tiers ? "COALESCE(t.tier, e.plan)" : "e.plan"} AS plan, e.source, ` +
      "ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.created_at DESC, e.id DESC) AS r " +
      "FROM entitlements e JOIN users u ON u.id = e.user_id AND u.status = 'active' " +
      (tiers ? "LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id " : "") +
      "WHERE e.revoked_at IS NULL AND e.starts_at <= ?1 AND (e.ends_at IS NULL OR e.ends_at > ?1)) WHERE r = 1 AND plan IN ('pro', 'ultra') " +
      "GROUP BY plan, source",
    ).bind(at),
    db.prepare("SELECT COALESCE(status, 'none') AS status, COUNT(*) AS n FROM payment_customers GROUP BY 1 ORDER BY n DESC, status"),
    db.prepare("SELECT id, user_id, event, at, detail FROM audit ORDER BY id DESC LIMIT ?").bind(OVERVIEW_AUDIT_ROWS),
    ...signals(),
  ]) }));
  const c = (counts.results?.[0] ?? {}) as Record<string, number>;
  const s = (seatRow?.results?.[0] ?? {}) as Record<string, number>;
  const k = (capRow?.results?.[0] ?? {}) as Record<string, number>;
  const num = (v: unknown) => Number(v ?? 0) || 0;
  const byPlan = new Map(((pro.results ?? []) as { plan: string; source: string; n: number }[]).map((r) => [`${r.plan} ${r.source}`, r.n]));
  const blocked = await optional(async () => (await db.prepare("SELECT COUNT(*) AS n FROM account_blocks").first<{ n: number }>())?.n ?? 0);
  const messages = await optional(async () =>
    (await db.prepare("SELECT COALESCE(SUM(sent), 0) AS n FROM delivery_runs WHERE at >= ?").bind(week).first<{ n: number }>())?.n ?? 0);
  const bugs = await optional(async () => {
    const r = await db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week FROM bug_reports").bind(week)
      .first<{ n: number; week: number | null }>();
    return { all: r?.n ?? 0, week: r?.week ?? 0 };
  });
  const latestBugs = bugs === null ? null : await optional(async () => (await db.prepare(
    "SELECT id, user_id, page, text, created_at FROM bug_reports ORDER BY created_at DESC, id DESC LIMIT ?",
  ).bind(OVERVIEW_BUG_ROWS).all<BugRow>()).results ?? []);
  return {
    active: c.active ?? 0, deleted: c.deleted ?? 0, blocked, sessions: c.sessions ?? 0, codesToday: c.codes ?? 0,
    proManual: byPlan.get("pro manual") ?? 0, proStripe: byPlan.get("pro stripe") ?? 0,
    ultraManual: tiers ? byPlan.get("ultra manual") ?? 0 : null, ultraStripe: tiers ? byPlan.get("ultra stripe") ?? 0 : null,
    subscriptions: (subs.results ?? []) as { status: string; n: number }[],
    sent: c.sent ?? 0, failed: c.failed ?? 0, messages, bugs, audit: (audit.results ?? []) as AuditRow[], latestBugs,
    seats: seats ? {
      seats: num(s.seats), holders: num(s.holders), open: num(s.open), joins: num(s.joins), capped: num(k.capped), cappedAccounts: num(k.accounts),
    } : null,
  };
}

export const SEARCH_HITS = 20;
export const ID_RE = /^[0-9a-f]{32}$/;

// A LIKE pattern for an address's start, read with ESCAPE '\': the
// wildcards an address may hold (% and _) match only themselves.
const likePrefix = (q: string) => `${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

// The search box: a user id, or an address, exact or by its start.
export async function findUsers(env: Env, raw: string): Promise<UserHit[]> {
  const q = raw.trim().toLowerCase().slice(0, 254);
  if (!q) return [];
  const db = env.ACCOUNTS!;
  const cols = "SELECT id, email, status, plan, plan_until, created_at FROM users";
  if (ID_RE.test(q)) return (await db.prepare(`${cols} WHERE id = ?`).bind(q).all<UserHit>()).results ?? [];
  return (await db.prepare(`${cols} WHERE email = ?1 OR email LIKE ?2 ESCAPE '\\' ORDER BY email = ?1 DESC, email LIMIT ?3`)
    .bind(q, likePrefix(q), SEARCH_HITS).all<UserHit>()).results ?? [];
}

// -- reads: the accounts table -------------------------------------------------------------

export const ACCOUNT_PAGE_SIZE = 50;
export const ACCOUNT_MAX_PAGE = 200;
export const ACCOUNT_CSV_ROWS = 10_000;

// The values each filter takes; anything else, "any" included, sets no
// filter. subscription is Stripe's status as payment_customers stores it,
// or none for an account with no row or no status. seat: the account holds a
// live seat (member), gives a live seat or an open invitation (holder, the
// seats in use as the Seats page counts them), or neither (none); an account
// that both holds a seat and gives one reads member, the side its plan is read
// from. Offered only while the seats table is on the database (SEAT_ONLY).
export const ACCOUNT_FILTERS = {
  plan: ["free", "pro", "ultra"],
  status: ["active", "deleted"],
  blocked: ["yes", "no"],
  delivery: ["on", "off"],
  subscription: ["active", "trialing", "past_due", "unpaid", "incomplete", "incomplete_expired", "canceled", "paused", "none"],
  language: ["en", "fr"],
  seat: ["holder", "member", "none"],
} as const;

export type AccountFilter = keyof typeof ACCOUNT_FILTERS;
export const ACCOUNT_FILTER_NAMES = Object.keys(ACCOUNT_FILTERS) as AccountFilter[];

export const ACCOUNT_SORTS = [
  "address", "plan", "seat", "status", "blocked", "created", "sign_in", "searches", "delivery", "keys", "subscription", "language",
] as const;
export type AccountSort = (typeof ACCOUNT_SORTS)[number];
export type SortDir = "asc" | "desc";
export const DEFAULT_SORT: AccountSort = "created";

// Each sort key's ORDER BY, written out in full: a request picks a key and a
// direction from these lists, and its own text never reaches the SQL. The id
// comes last so rows with equal values keep one order from page to page.
const ORDER_BY: Record<AccountSort, Record<SortDir, string>> = {
  address: { asc: "email ASC, id ASC", desc: "email DESC, id DESC" },
  plan: { asc: "plan ASC, plan_until ASC, id ASC", desc: "plan DESC, plan_until DESC, id DESC" },
  seat: { asc: "seat ASC, id ASC", desc: "seat DESC, id DESC" },
  status: { asc: "status ASC, id ASC", desc: "status DESC, id DESC" },
  blocked: { asc: "blocked_at ASC, id ASC", desc: "blocked_at DESC, id DESC" },
  created: { asc: "created_at ASC, id ASC", desc: "created_at DESC, id DESC" },
  sign_in: { asc: "last_sign_in ASC, id ASC", desc: "last_sign_in DESC, id DESC" },
  searches: { asc: "searches ASC, id ASC", desc: "searches DESC, id DESC" },
  delivery: { asc: "delivering ASC, id ASC", desc: "delivering DESC, id DESC" },
  keys: { asc: "live_keys ASC, id ASC", desc: "live_keys DESC, id DESC" },
  subscription: { asc: "sub_status ASC, id ASC", desc: "sub_status DESC, id DESC" },
  language: { asc: "lang ASC, id ASC", desc: "lang DESC, id DESC" },
};

export type AccountQuery = {
  q: string;
  filters: { [K in AccountFilter]: (typeof ACCOUNT_FILTERS)[K][number] | null };
  sort: AccountSort;
  dir: SortDir;
  page: number;
};

const oneOf = <T extends string>(list: readonly T[], v: string | undefined): T | null =>
  v !== undefined && (list as readonly string[]).includes(v) ? (v as T) : null;

// The direction a key sorts in until its heading is clicked again: the
// default key newest first, every other key ascending.
export const firstDir = (sort: AccountSort): SortDir => (sort === DEFAULT_SORT ? "desc" : "asc");

// The filter and the sort key that exist only while the seats table is on the database.
export const SEAT_ONLY = { filter: "seat", sort: "seat" } as const;

// The table's parameters from the request's query. Every value is checked
// against the lists above, and one that is not on them reads as unset. q, an
// address's start, is the only text, and it is bound as a LIKE pattern. seats:
// the seats table is on the database; without it the seat filter and sort read
// as unset, as a value off the lists does.
export function readAccountQuery(get: (name: string) => string | undefined, seats = true): AccountQuery {
  const filters = {} as Record<AccountFilter, string | null>;
  for (const name of ACCOUNT_FILTER_NAMES) filters[name] = !seats && name === SEAT_ONLY.filter ? null : oneOf(ACCOUNT_FILTERS[name], get(name));
  const asked = oneOf(ACCOUNT_SORTS, get("sort"));
  const sort = (asked === SEAT_ONLY.sort && !seats ? null : asked) ?? DEFAULT_SORT;
  const rawPage = get("page") ?? "";
  return {
    q: (get("q") ?? "").trim().toLowerCase().slice(0, 254),
    filters: filters as AccountQuery["filters"],
    sort,
    dir: oneOf(["asc", "desc"] as const, get("dir")) ?? firstDir(sort),
    page: /^[0-9]{1,6}$/.test(rawPage) ? Math.min(Math.max(1, Number(rawPage)), ACCOUNT_MAX_PAGE) : 1,
  };
}

export type AccountListRow = {
  id: string; email: string; created_at: string; lang: string; status: string; plan: string; plan_until: string | null;
  blocked_at: string | null; last_sign_in: string | null; searches: number; delivering: number; live_keys: number; sub_status: string | null;
  // holder, member or none (ACCOUNT_FILTERS.seat); none for every account while the seats table is not on the database.
  seat: string;
};

// The account's side of a seat, as ACCOUNT_FILTERS.seat says it: a live seat it holds through
// idx_seats_member_live, else a live seat or open invitation it gives through idx_seats_holder (?1 now).
const SEAT_SIDE =
  "CASE WHEN EXISTS (SELECT 1 FROM seats sm WHERE sm.member_id = u.id AND sm.ended_at IS NULL) THEN 'member' " +
  "WHEN EXISTS (SELECT 1 FROM seats sh WHERE sh.holder_id = u.id AND sh.ended_at IS NULL AND (sh.member_id IS NOT NULL OR sh.expires_at > ?1)) " +
  "THEN 'holder' ELSE 'none' END";

// One row per account, ?1 the moment. The plan is the deciding entitlement
// row's, as planFromRows picks it, under the overview's rule for Pro now (an
// active account only), read through its tier (ultra for a pro row with an
// Ultra tier). The last sign-in is the newest session's start, so an account
// whose sessions have all been swept (90 days after they end) shows none. A
// database without account_blocks reads every account as not blocked, as the
// rest of the console does; one without entitlement_tiers reads Ultra as Pro;
// one without seats reads every account's seat as none, reading nothing for it.
const accountsWith = (blocks: boolean, tiers: boolean, seats: boolean) =>
  "WITH a AS (SELECT u.id, u.email, u.created_at, u.lang, u.status, " +
  `CASE WHEN u.status = 'active' AND e.plan = 'pro' THEN ${tiers ? "COALESCE(t.tier, 'pro')" : "'pro'"} ELSE 'free' END AS plan, ` +
  "CASE WHEN u.status = 'active' AND e.plan = 'pro' THEN e.ends_at END AS plan_until, " +
  `${seats ? SEAT_SIDE : "'none'"} AS seat, ` +
  "b.created_at AS blocked_at, p.status AS sub_status, " +
  "(SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_sign_in, " +
  "(SELECT COUNT(*) FROM saved_searches q WHERE q.user_id = u.id) AS searches, " +
  "(SELECT COUNT(*) FROM saved_searches q WHERE q.user_id = u.id AND q.deliver != 'off') AS delivering, " +
  "(SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS live_keys " +
  "FROM users u " +
  "LEFT JOIN entitlements e ON e.id = (SELECT x.id FROM entitlements x WHERE x.user_id = u.id AND x.revoked_at IS NULL " +
  "AND x.starts_at <= ?1 AND (x.ends_at IS NULL OR x.ends_at > ?1) ORDER BY x.created_at DESC, x.id DESC LIMIT 1) " +
  (tiers ? "LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id " : "") +
  (blocks ? "LEFT JOIN account_blocks b ON b.user_id = u.id " : "LEFT JOIN (SELECT NULL AS user_id, NULL AS created_at WHERE 0) b ON b.user_id = u.id ") +
  "LEFT JOIN payment_customers p ON p.user_id = u.id) ";

// Every filter is in the text, and an unset one is bound as NULL and passes
// every row, so the statement's text is the same whatever the request.
const ACCOUNT_WHERE =
  "WHERE (?2 IS NULL OR email LIKE ?2 ESCAPE '\\') AND (?3 IS NULL OR plan = ?3) AND (?4 IS NULL OR status = ?4) " +
  "AND (?5 IS NULL OR (blocked_at IS NOT NULL) = (?5 = 'yes')) AND (?6 IS NULL OR (delivering > 0) = (?6 = 'on')) " +
  "AND (?7 IS NULL OR COALESCE(sub_status, 'none') = ?7) AND (?8 IS NULL OR lang = ?8) AND (?9 IS NULL OR seat = ?9) ";

const accountBinds = (a: AccountQuery, now: Date) => {
  const f = a.filters;
  return [now.toISOString(), a.q ? likePrefix(a.q) : null, f.plan, f.status, f.blocked, f.delivery, f.subscription, f.language, f.seat];
};

// The accounts statements with every optional table, then without whichever
// the database lacks (entitlement_tiers through withTiers, account_blocks here;
// seats as the caller found it, seatsReady).
async function withBlocks<T>(seats: boolean, run: (head: string) => Promise<T>): Promise<T> {
  return withTiers(async (tiers) => {
    try {
      return await run(accountsWith(true, tiers, seats));
    } catch (e) {
      if (missingTable(e) && !missingTiers(e) && !missingSeats(e)) return run(accountsWith(false, tiers, seats));
      throw e;
    }
  });
}

// seats: the seats table is on the database (seatsReady): the Seat column and its filter.
export type AccountsPage = { rows: AccountListRow[]; total: number; page: number; pages: number; seats: boolean };

// The page asked for, in one batch with the count. A page past the last (an
// old link, a hand-edited number) shows the last, as the search page does.
// seats: the seats table is on the database; read by the caller, whose query
// already holds no seat filter or sort without it (readAccountQuery).
export async function accountsPage(env: Env, a: AccountQuery, now = new Date(), seats = false): Promise<AccountsPage> {
  const db = env.ACCOUNTS!;
  const binds = accountBinds(a, now);
  return withBlocks(seats, async (head) => {
    const select = (page: number) =>
      db.prepare(`${head}SELECT * FROM a ${ACCOUNT_WHERE}ORDER BY ${ORDER_BY[a.sort][a.dir]} LIMIT ?10 OFFSET ?11`)
        .bind(...binds, ACCOUNT_PAGE_SIZE, (page - 1) * ACCOUNT_PAGE_SIZE);
    const [count, first] = await db.batch([db.prepare(`${head}SELECT COUNT(*) AS n FROM a ${ACCOUNT_WHERE}`).bind(...binds), select(a.page)]);
    const total = (count.results?.[0] as { n: number } | undefined)?.n ?? 0;
    const pages = Math.max(1, Math.min(Math.ceil(total / ACCOUNT_PAGE_SIZE), ACCOUNT_MAX_PAGE));
    const page = Math.min(a.page, pages);
    const rows = page === a.page ? first.results ?? [] : (await select(page).all()).results ?? [];
    return { rows: rows as AccountListRow[], total, page, pages, seats };
  });
}

// The same rows for the CSV, from the first, at most ACCOUNT_CSV_ROWS. Its
// columns are ACCOUNT_CSV_HEAD's (admin.tsx); the seat filter narrows its rows
// as it narrows the page's.
export async function accountsForCsv(env: Env, a: AccountQuery, now = new Date(), seats = false): Promise<AccountListRow[]> {
  const db = env.ACCOUNTS!;
  return withBlocks(seats, async (head) =>
    (await db.prepare(`${head}SELECT * FROM a ${ACCOUNT_WHERE}ORDER BY ${ORDER_BY[a.sort][a.dir]} LIMIT ?10`)
      .bind(...accountBinds(a, now), ACCOUNT_CSV_ROWS).all<AccountListRow>()).results ?? []);
}

// -- reads: one account ---------------------------------------------------------------------

export type UserRow = {
  id: string; email: string; created_at: string; last_seen_at: string | null; lang: string; status: string;
  plan: string; plan_until: string | null; deleted_at: string | null;
};
export type EntitlementView = {
  id: string; plan: string; source: string; starts_at: string; ends_at: string | null; reference: string | null;
  created_at: string; revoked_at: string | null;
};
export type PaymentView = {
  customer_id: string; subscription_id: string | null; status: string | null; current_period_end: string | null; updated_at: string;
};
export type SearchView = {
  id: string; kind: string; params: string; label: string; deliver: string; created_at: string;
  last_status: string | null; last_at: string | null; last_items: number | null;
};
export type KeyView = { id: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
export type DeliveryView = { sent_at: string; items: number; status: string; label: string };

export type UserDetail = {
  user: UserRow; entitlements: EntitlementView[]; payment: PaymentView | null;
  sessions: { live: number; newest: string | null; classes: { ua_class: string | null; n: number }[] };
  searches: SearchView[]; keys: KeyView[]; deliveries: DeliveryView[]; bugs: BugRow[] | null; audit: AuditRow[]; block: BlockRow | null;
  // How many watches the account holds and its watch mail (on, off, or none yet); null before the tables exist.
  watches?: { n: number; mail: string | null } | null;
  // The account's watches, its watch mail and its newest runs (watches.ts watchDetail).
  watchDetail?: Awaited<ReturnType<typeof watchDetail>>;
};

export const USER_DELIVERY_ROWS = 20;
export const USER_AUDIT_ROWS = 50;
export const USER_BUG_ROWS = 20;

export async function userDetail(env: Env, userId: string, now = new Date()): Promise<UserDetail | null> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  // The entitlements with their plan read through the tier (ultra for a pro row with an Ultra tier row).
  const [user, ents, pay, live, newest, classes, searches, keys, deliveries, audit] = await withTiers((tiers) => db.batch([
    db.prepare("SELECT id, email, created_at, last_seen_at, lang, status, plan, plan_until, deleted_at FROM users WHERE id = ?").bind(userId),
    db.prepare(
      `SELECT e.id, ${tiers ? "COALESCE(t.tier, e.plan)" : "e.plan"} AS plan, e.source, e.starts_at, e.ends_at, e.reference, e.created_at, e.revoked_at ` +
      `FROM entitlements e ${tiers ? "LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id " : ""}` +
      "WHERE e.user_id = ? ORDER BY e.created_at DESC, e.id DESC",
    ).bind(userId),
    db.prepare("SELECT customer_id, subscription_id, status, current_period_end, updated_at FROM payment_customers WHERE user_id = ?").bind(userId),
    db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?").bind(userId, at),
    db.prepare("SELECT MAX(last_seen_at) AS at FROM sessions WHERE user_id = ?").bind(userId),
    db.prepare(
      "SELECT ua_class, COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? GROUP BY ua_class ORDER BY n DESC, ua_class",
    ).bind(userId, at),
    db.prepare(
      "SELECT s.id, s.kind, s.params, s.label, s.deliver, s.created_at, " +
      "(SELECT d.status FROM deliveries d WHERE d.saved_search_id = s.id ORDER BY d.id DESC LIMIT 1) AS last_status, " +
      "(SELECT d.sent_at FROM deliveries d WHERE d.saved_search_id = s.id ORDER BY d.id DESC LIMIT 1) AS last_at, " +
      "(SELECT d.items FROM deliveries d WHERE d.saved_search_id = s.id ORDER BY d.id DESC LIMIT 1) AS last_items " +
      "FROM saved_searches s WHERE s.user_id = ? ORDER BY s.created_at, s.id",
    ).bind(userId),
    db.prepare("SELECT id, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC, id").bind(userId),
    db.prepare(
      "SELECT d.sent_at, d.items, d.status, s.label FROM deliveries d JOIN saved_searches s ON s.id = d.saved_search_id " +
      "WHERE s.user_id = ? ORDER BY d.id DESC LIMIT ?",
    ).bind(userId, USER_DELIVERY_ROWS),
    db.prepare("SELECT id, user_id, event, at, detail FROM audit WHERE user_id = ? ORDER BY id DESC LIMIT ?").bind(userId, USER_AUDIT_ROWS),
  ]));
  const row = (user.results?.[0] ?? null) as UserRow | null;
  if (!row) return null;
  const block = await optional(() =>
    db.prepare("SELECT reason, created_at, by_user_id, paused FROM account_blocks WHERE user_id = ?").bind(userId).first<BlockRow>());
  const watches = await optional(async () => (await db.prepare(
    "SELECT (SELECT COUNT(*) FROM watches WHERE user_id = ?1) AS n, (SELECT mail FROM watch_mail WHERE user_id = ?1) AS mail",
  ).bind(userId).first<{ n: number; mail: string | null }>()) ?? { n: 0, mail: null });
  const bugs = await optional(async () => (await db.prepare(
    "SELECT id, user_id, page, text, created_at FROM bug_reports WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
  ).bind(userId, USER_BUG_ROWS).all<BugRow>()).results ?? []);
  return {
    user: row,
    entitlements: (ents.results ?? []) as EntitlementView[],
    payment: (pay.results?.[0] ?? null) as PaymentView | null,
    sessions: {
      live: (live.results?.[0] as { n: number } | undefined)?.n ?? 0,
      newest: (newest.results?.[0] as { at: string | null } | undefined)?.at ?? null,
      classes: (classes.results ?? []) as { ua_class: string | null; n: number }[],
    },
    searches: (searches.results ?? []) as SearchView[],
    keys: (keys.results ?? []) as KeyView[],
    deliveries: (deliveries.results ?? []) as DeliveryView[],
    bugs,
    audit: (audit.results ?? []) as AuditRow[],
    block,
    watches,
    watchDetail: await watchDetail(env, userId),
  };
}

// An entitlement row the console may revoke: not revoked and not ended,
// started or still to start.
export const revocable = (e: Pick<EntitlementView, "revoked_at" | "ends_at">, now: Date): boolean =>
  !e.revoked_at && (e.ends_at === null || e.ends_at > now.toISOString());
