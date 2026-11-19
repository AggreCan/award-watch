// The pool (docs/accounts.md, Seats, The pool): every counted figure of a
// subscription with seats is the subscription's, counted over its group (the
// holder and the members its plan covers, entitlements.ts planFor) inside the
// insert that holds it, so two people of one group posting at once cannot pass
// it together: D1 writes one statement at a time, and each counts the rows the
// other committed.
//
// An account in no group, which is every account until a seat is taken, sends
// the statement it always sent, word for word, with the values it always
// bound. An account in a group sends the statement's twin: the same text with
// the count that holds the figure read as user_id IN over POOL_SLOTS places
// numbered after the statement's own, the group's ids bound there and NULL in
// the places left over (NULL equals nothing, so it matches no row). The ids
// are the ones the request's session read gave (Account.group), never a value
// from the request, and no more than POOL_SLOTS of them are bound.
//
// The pool is counts only: a twin counts the group's rows and selects, returns
// or changes nothing of another account. Whatever else the statement checks
// (the same name, the same report, the same filter) stays the account's own.
//
// In service (slice P2, the second half of this file): when a group holds more
// than a figure, the holder's items are served first, then each member's in the
// order its seat was joined, each account's own oldest first (created_at, then
// id); the rest are saved and unavailable, and nothing is deleted. An account's
// allowance is the figure less what the accounts ahead of it hold: the holder's
// is the whole figure and needs no count; a member's needs the counts of the
// accounts ahead, which POOL_COUNTS_SQL reads for the whole group in one
// statement. An account in no group has the plan's figure, as before, and reads
// nothing more: every "first N" rule keeps its statement and compares with the
// allowance in place of the plan's figure.

import type { Env } from "../env";
import { type Group, PLAN_SEATS, type Plan, type PlanHolder, planFor } from "./entitlements";

// The places a twin's count holds: the most people any plan's group holds,
// the holder and its member seats (PLAN_SEATS), 5 on Ultra.
export const POOL_SLOTS = Math.max(...Object.values(PLAN_SEATS));

// The group's places in a twin, numbered from first: "(?9, ?10, ?11, ?12, ?13)" for 9.
export const groupIn = (first: number): string =>
  `(${Array.from({ length: POOL_SLOTS }, (_, i) => `?${first + i}`).join(", ")})`;

// The values for those places: the group's ids in its order, then NULL. planFor
// never lists more than the plan's seats, so none is left out.
export const groupIds = (group: Group): (string | null)[] =>
  Array.from({ length: POOL_SLOTS }, (_, i) => group.ids[i] ?? null);

// The ids of the accounts ahead of a member in its group, in the group's places
// (the holder, then each member joined before it), NULL in the rest: what a
// check of one item counts besides the account's own items made before it.
export const aheadIds = (group: Group): (string | null)[] =>
  Array.from({ length: POOL_SLOTS }, (_, i) => (i < group.position ? group.ids[i] ?? null : null));

// Who a counted figure is held for: an account and the group the session read
// put it in, absent for an account in no group.
export type InGroup = { group?: Group };

// The statement an account sends and what it binds after the statement's own
// values: in no group, sql and nothing more; in a group, groupSql, then
// groupOnly (a value only the twin reads, as the figure the first dashboard's
// twin holds), then the group's ids. The one place a statement's form is
// chosen, so no caller spells the group.
export function pooled(who: InGroup, sql: string, groupSql: string, groupOnly: readonly unknown[] = []): { sql: string; binds: unknown[] } {
  return who.group ? { sql: groupSql, binds: [...groupOnly, ...groupIds(who.group)] } : { sql, binds: [] };
}

// -- in service ------------------------------------------------------------------------

// The pooled figures something is served to, each counted as its insert counts
// it: the saved searches with the briefings (one shared figure), the watches
// less each person's own claimed organization's, the saved views, the
// dashboards, the live keys and the live calendar feeds. The downloads a minute
// and the bug reports a day are held at their inserts and serve nothing.
export const POOL_FIGURES = ["searches", "watches", "views", "dashboards", "keys", "feeds"] as const;
export type PoolFigure = (typeof POOL_FIGURES)[number];
export type PoolCounts = Readonly<Record<PoolFigure, number>>;

// Each account's counts in a group, in one statement (?1 to ?5, the group's ids
// in its places, NULL in the rest): numbers by account id and nothing else, each
// through the table's own index on user_id (users by its key). Sent only for an
// account in a group, with the ids the session read or planFor gave; no group
// exists before the seats table, so every table it names is on the database by then.
export const POOL_COUNTS_SQL =
  "SELECT u.id, " +
  "(SELECT COUNT(*) FROM saved_searches s WHERE s.user_id = u.id) + (SELECT COUNT(*) FROM briefings b WHERE b.user_id = u.id) AS searches, " +
  "(SELECT COUNT(*) FROM watches w WHERE w.user_id = u.id " +
  "AND NOT (w.kind = 'organization' AND w.target IS (SELECT c.organization_id FROM org_claims c WHERE c.user_id = u.id))) AS watches, " +
  "(SELECT COUNT(*) FROM saved_views v WHERE v.user_id = u.id) AS views, " +
  "(SELECT COUNT(*) FROM dashboards d WHERE d.user_id = u.id) AS dashboards, " +
  "(SELECT COUNT(*) FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS keys, " +
  "(SELECT COUNT(*) FROM feeds f WHERE f.user_id = u.id AND f.revoked_at IS NULL) AS feeds " +
  `FROM users u WHERE u.id IN ${groupIn(1)}`;

// A group's counts as one read gave them, by account id. An id the read did not
// return (an account gone since the session read) holds nothing.
export type Pool = { group: Group; counts: ReadonlyMap<string, PoolCounts> };

const NONE: PoolCounts = { searches: 0, watches: 0, views: 0, dashboards: 0, keys: 0, feeds: 0 };

export async function readPool(db: D1Database, group: Group): Promise<Pool> {
  const res = await db.prepare(POOL_COUNTS_SQL).bind(...groupIds(group)).all<{ id: string } & PoolCounts>();
  const counts = new Map<string, PoolCounts>();
  for (const r of res.results ?? []) {
    counts.set(r.id, Object.fromEntries(POOL_FIGURES.map((f) => [f, Number(r[f]) || 0])) as PoolCounts);
  }
  return { group, counts };
}

// The pool a page states: read once a page view for an account in a group, its
// holder included; null, and nothing read, for an account in no group.
export async function poolOf(env: Pick<Env, "ACCOUNTS">, who: InGroup): Promise<Pool | null> {
  return who.group ? readPool(env.ACCOUNTS!, who.group) : null;
}

const countOf = (pool: Pool, id: string, figure: PoolFigure): number => (pool.counts.get(id) ?? NONE)[figure];

// The group's total of a figure, and one account's own.
export const poolTotal = (pool: Pool, figure: PoolFigure): number => pool.group.ids.reduce((n, id) => n + countOf(pool, id, figure), 0);
export const poolOwn = (pool: Pool, figure: PoolFigure, userId: string): number => countOf(pool, userId, figure);

// An account's allowance of a figure (cap, the plan's): the whole figure for
// the holder; for a member, the figure less what the accounts ahead of it in
// its group hold, never below none. The member's own group gives the order, the
// pool the counts. An account in no group is never asked here: its allowance is
// the plan's figure, with nothing read.
export function allowanceIn(pool: Pool, group: Group, figure: PoolFigure, cap: number): number {
  if (group.position <= 0) return cap;
  const ahead = group.ids.slice(0, group.position).reduce((n, id) => n + countOf(pool, id, figure), 0);
  return Math.max(0, cap - ahead);
}

// What a page says of a figure: the group's total, the account's own, the
// figure and the account's allowance of it.
export type PoolLine = { total: number; own: number; cap: number; allowance: number };
export function poolLine(pool: Pool, who: { userId: string; group?: Group }, figure: PoolFigure, cap: number): PoolLine {
  return {
    total: poolTotal(pool, figure), own: poolOwn(pool, figure, who.userId), cap,
    allowance: who.group ? allowanceIn(pool, who.group, figure, cap) : cap,
  };
}

// The ids of an account's own items past its allowance: its items in the order
// they were made (created_at, then id), the first `allowance` in service and the
// rest saved and unavailable. The order every "first N" rule reads.
export function pastAllowance(items: readonly { id: string; created_at: string }[], allowance: number): Set<string> {
  const order = [...items].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.created_at < b.created_at ? -1 : 1));
  return new Set(order.slice(Math.max(0, allowance)).map((x) => x.id));
}

// -- the delivery run ---------------------------------------------------------------

// What a delivery run keeps of the groups it meets (deliveries.ts deliver hands
// one to every part): the group planFor gave each account it read, and each
// group's counts, read with POOL_COUNTS_SQL once a group a run, kept by holder,
// on the run's counted binding (so inside its query budget). Only a member's
// allowance reads them; the holder's is the whole figure. An account in no group
// has no entry, and its allowance is the plan's figure with nothing read.
export class RunPool {
  private readonly groups = new Map<string, Group>();
  private readonly reads = new Map<string, Promise<Pool>>();

  // The account's plan for the run: planFor once an account a run, kept in
  // plans as the parts always kept it, with its group kept here beside it.
  async plan(env: Env, plans: Map<string, Plan>, user: PlanHolder, now: Date): Promise<Plan> {
    const known = plans.get(user.id);
    if (known) return known;
    const read = await planFor(env, user, now);
    plans.set(user.id, read.plan);
    if (read.group) this.groups.set(user.id, read.group);
    return read.plan;
  }

  // The figure an account's items are served to this run: cap for an account in
  // no group and for a holder; a member's allowance otherwise.
  async allowance(env: Env, userId: string, figure: PoolFigure, cap: number): Promise<number> {
    const group = this.groups.get(userId);
    if (!group || group.position <= 0) return cap;
    let read = this.reads.get(group.holderId);
    if (!read) {
      read = readPool(env.ACCOUNTS!, group);
      this.reads.set(group.holderId, read);
    }
    return allowanceIn(await read, group, figure, cap);
  }
}
