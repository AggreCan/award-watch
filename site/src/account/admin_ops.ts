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
import { planFor } from "./entitlements";
import { newId } from "./secrets";
import { revokeAllSessions } from "./session";

// -- who may use the console ----------------------------------------------------------

// OPERATOR_EMAILS, a secret: comma-separated addresses, read lower-cased.
export function operatorEmails(env: Pick<Env, "OPERATOR_EMAILS">): Set<string> {
  return new Set((env.OPERATOR_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

// -- the audit trail ----------------------------------------------------------------------

export type OperatorEvent =
  | "operator_granted" | "operator_revoked" | "operator_cancelled" | "operator_refunded" | "operator_blocked"
  | "operator_unblocked" | "operator_email_changed" | "operator_signed_out" | "operator_deleted" | "operator_announced";

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

// A manual Pro row from now to endsAt (null for no end), as the documented
// insert writes it; then the cached plan on users is brought up to date.
export async function grantPro(env: Env, userId: string, operatorId: string, endsAt: string | null, reference: string, now = new Date()): Promise<void> {
  const at = now.toISOString();
  await env.ACCOUNTS!.prepare(
    "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'manual', ?, ?, ?, ?)",
  ).bind(newId(), userId, at, endsAt, reference, at).run();
  await refreshPlan(env, userId, now);
  await operatorAudit(env, userId, "operator_granted", operatorId, endsAt ? `until ${endsAt.slice(0, 10)}` : "no end", now);
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
  proManual: number; proStripe: number; subscriptions: { status: string; n: number }[];
  sent: number; failed: number; bugs: { all: number; week: number } | null;
  audit: AuditRow[]; latestBugs: BugRow[] | null;
};

export const WEEK_DAYS = 7;
export const OVERVIEW_AUDIT_ROWS = 20;
export const OVERVIEW_BUG_ROWS = 10;

export async function overview(env: Env, now = new Date()): Promise<Overview> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const today = `${at.slice(0, 10)}T00:00:00.000Z`;
  const week = new Date(now.getTime() - WEEK_DAYS * 86_400_000).toISOString();
  const [counts, pro, subs, audit] = await db.batch([
    db.prepare(
      "SELECT (SELECT COUNT(*) FROM users WHERE status = 'active') AS active, (SELECT COUNT(*) FROM users WHERE status = 'deleted') AS deleted, " +
      "(SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > ?1) AS sessions, " +
      "(SELECT COUNT(*) FROM magic_codes WHERE created_at >= ?2) AS codes, " +
      "(SELECT COUNT(*) FROM deliveries WHERE status = 'sent' AND sent_at >= ?3) AS sent, " +
      "(SELECT COUNT(*) FROM deliveries WHERE status = 'failed' AND sent_at >= ?3) AS failed",
    ).bind(at, today, week),
    // Accounts whose plan is Pro now, by the source of the row that decides
    // it: the latest live row per active account, as planFromRows picks it.
    db.prepare(
      "SELECT source, COUNT(*) AS n FROM (SELECT e.plan, e.source, ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.created_at DESC, e.id DESC) AS r " +
      "FROM entitlements e JOIN users u ON u.id = e.user_id AND u.status = 'active' " +
      "WHERE e.revoked_at IS NULL AND e.starts_at <= ?1 AND (e.ends_at IS NULL OR e.ends_at > ?1)) WHERE r = 1 AND plan = 'pro' GROUP BY source",
    ).bind(at),
    db.prepare("SELECT COALESCE(status, 'none') AS status, COUNT(*) AS n FROM payment_customers GROUP BY 1 ORDER BY n DESC, status"),
    db.prepare("SELECT id, user_id, event, at, detail FROM audit ORDER BY id DESC LIMIT ?").bind(OVERVIEW_AUDIT_ROWS),
  ]);
  const c = (counts.results?.[0] ?? {}) as Record<string, number>;
  const bySource = new Map(((pro.results ?? []) as { source: string; n: number }[]).map((r) => [r.source, r.n]));
  const blocked = await optional(async () => (await db.prepare("SELECT COUNT(*) AS n FROM account_blocks").first<{ n: number }>())?.n ?? 0);
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
    proManual: bySource.get("manual") ?? 0, proStripe: bySource.get("stripe") ?? 0,
    subscriptions: (subs.results ?? []) as { status: string; n: number }[],
    sent: c.sent ?? 0, failed: c.failed ?? 0, bugs, audit: (audit.results ?? []) as AuditRow[], latestBugs,
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
// or none for an account with no row or no status.
export const ACCOUNT_FILTERS = {
  plan: ["free", "pro"],
  status: ["active", "deleted"],
  blocked: ["yes", "no"],
  delivery: ["on", "off"],
  subscription: ["active", "trialing", "past_due", "unpaid", "incomplete", "incomplete_expired", "canceled", "paused", "none"],
  language: ["en", "fr"],
} as const;

export type AccountFilter = keyof typeof ACCOUNT_FILTERS;
export const ACCOUNT_FILTER_NAMES = Object.keys(ACCOUNT_FILTERS) as AccountFilter[];

export const ACCOUNT_SORTS = [
  "address", "plan", "status", "blocked", "created", "sign_in", "searches", "delivery", "keys", "subscription", "language",
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

// The table's parameters from the request's query. Every value is checked
// against the lists above, and one that is not on them reads as unset. q, an
// address's start, is the only text, and it is bound as a LIKE pattern.
export function readAccountQuery(get: (name: string) => string | undefined): AccountQuery {
  const filters = {} as Record<AccountFilter, string | null>;
  for (const name of ACCOUNT_FILTER_NAMES) filters[name] = oneOf(ACCOUNT_FILTERS[name], get(name));
  const sort = oneOf(ACCOUNT_SORTS, get("sort")) ?? DEFAULT_SORT;
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
};

// One row per account, ?1 the moment. The plan is the deciding entitlement
// row's, as planFromRows picks it, under the overview's rule for Pro now (an
// active account only). The last sign-in is the newest session's start, so
// an account whose sessions have all been swept (90 days after they end)
// shows none. A database without account_blocks reads every account as not
// blocked, as the rest of the console does.
const accountsWith = (blocks: boolean) =>
  "WITH a AS (SELECT u.id, u.email, u.created_at, u.lang, u.status, " +
  "CASE WHEN u.status = 'active' AND e.plan = 'pro' THEN 'pro' ELSE 'free' END AS plan, " +
  "CASE WHEN u.status = 'active' AND e.plan = 'pro' THEN e.ends_at END AS plan_until, " +
  "b.created_at AS blocked_at, p.status AS sub_status, " +
  "(SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_sign_in, " +
  "(SELECT COUNT(*) FROM saved_searches q WHERE q.user_id = u.id) AS searches, " +
  "(SELECT COUNT(*) FROM saved_searches q WHERE q.user_id = u.id AND q.deliver != 'off') AS delivering, " +
  "(SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS live_keys " +
  "FROM users u " +
  "LEFT JOIN entitlements e ON e.id = (SELECT x.id FROM entitlements x WHERE x.user_id = u.id AND x.revoked_at IS NULL " +
  "AND x.starts_at <= ?1 AND (x.ends_at IS NULL OR x.ends_at > ?1) ORDER BY x.created_at DESC, x.id DESC LIMIT 1) " +
  (blocks ? "LEFT JOIN account_blocks b ON b.user_id = u.id " : "LEFT JOIN (SELECT NULL AS user_id, NULL AS created_at WHERE 0) b ON b.user_id = u.id ") +
  "LEFT JOIN payment_customers p ON p.user_id = u.id) ";

// Every filter is in the text, and an unset one is bound as NULL and passes
// every row, so the statement's text is the same whatever the request.
const ACCOUNT_WHERE =
  "WHERE (?2 IS NULL OR email LIKE ?2 ESCAPE '\\') AND (?3 IS NULL OR plan = ?3) AND (?4 IS NULL OR status = ?4) " +
  "AND (?5 IS NULL OR (blocked_at IS NOT NULL) = (?5 = 'yes')) AND (?6 IS NULL OR (delivering > 0) = (?6 = 'on')) " +
  "AND (?7 IS NULL OR COALESCE(sub_status, 'none') = ?7) AND (?8 IS NULL OR lang = ?8) ";

const accountBinds = (a: AccountQuery, now: Date) => {
  const f = a.filters;
  return [now.toISOString(), a.q ? likePrefix(a.q) : null, f.plan, f.status, f.blocked, f.delivery, f.subscription, f.language];
};

async function withBlocks<T>(run: (blocks: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(true);
  } catch (e) {
    if (missingTable(e)) return run(false);
    throw e;
  }
}

export type AccountsPage = { rows: AccountListRow[]; total: number; page: number; pages: number };

// The page asked for, in one batch with the count. A page past the last (an
// old link, a hand-edited number) shows the last, as the search page does.
export async function accountsPage(env: Env, a: AccountQuery, now = new Date()): Promise<AccountsPage> {
  const db = env.ACCOUNTS!;
  const binds = accountBinds(a, now);
  return withBlocks(async (blocks) => {
    const head = accountsWith(blocks);
    const select = (page: number) =>
      db.prepare(`${head}SELECT * FROM a ${ACCOUNT_WHERE}ORDER BY ${ORDER_BY[a.sort][a.dir]} LIMIT ?9 OFFSET ?10`)
        .bind(...binds, ACCOUNT_PAGE_SIZE, (page - 1) * ACCOUNT_PAGE_SIZE);
    const [count, first] = await db.batch([db.prepare(`${head}SELECT COUNT(*) AS n FROM a ${ACCOUNT_WHERE}`).bind(...binds), select(a.page)]);
    const total = (count.results?.[0] as { n: number } | undefined)?.n ?? 0;
    const pages = Math.max(1, Math.min(Math.ceil(total / ACCOUNT_PAGE_SIZE), ACCOUNT_MAX_PAGE));
    const page = Math.min(a.page, pages);
    const rows = page === a.page ? first.results ?? [] : (await select(page).all()).results ?? [];
    return { rows: rows as AccountListRow[], total, page, pages };
  });
}

// The same rows for the CSV, from the first, at most ACCOUNT_CSV_ROWS.
export async function accountsForCsv(env: Env, a: AccountQuery, now = new Date()): Promise<AccountListRow[]> {
  const db = env.ACCOUNTS!;
  return withBlocks(async (blocks) =>
    (await db.prepare(`${accountsWith(blocks)}SELECT * FROM a ${ACCOUNT_WHERE}ORDER BY ${ORDER_BY[a.sort][a.dir]} LIMIT ?9`)
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
  const [user, ents, pay, live, newest, classes, searches, keys, deliveries, audit] = await db.batch([
    db.prepare("SELECT id, email, created_at, last_seen_at, lang, status, plan, plan_until, deleted_at FROM users WHERE id = ?").bind(userId),
    db.prepare(
      "SELECT id, plan, source, starts_at, ends_at, reference, created_at, revoked_at FROM entitlements WHERE user_id = ? ORDER BY created_at DESC, id DESC",
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
  ]);
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
