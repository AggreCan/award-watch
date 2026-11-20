// Plans and what they allow. A plan is computed, never stored as the
// authority: the entitlements table holds the record (who, which plan, from
// when to when, granted by hand or by a payment source), and planFor reads
// it on every request that needs it. The plan columns on users are a cache
// of the last answer, used only while the entitlements cannot be read.
//
// The posture is the same as the operator's other service: fail open to
// outages (a database fault leaves a signed-in user on their last known
// plan), fail closed to revocation (a row revoked or ended stops counting on
// the next request). Nothing here names a price; the plans are names.
//
// Ultra, the plan above Pro, is kept without changing either CHECK that names
// the plans (users.plan, entitlements.plan; D1 cannot change a CHECK without
// rebuilding the table): an Ultra entitlement is a 'pro' row of entitlements,
// which Ultra includes, with a row of its own in entitlement_tiers naming it
// Ultra, the two written in one batch (entitlementWrites). Every reader that
// asks whether a paid plan is live (LIVE_PRO_SQL) counts it unchanged, and
// planFor reads the tier beside the row. Until entitlement_tiers is on the
// database an Ultra row reads as Pro (docs/accounts.md, Ultra).
//
// A seat (docs/accounts.md, Seats) gives an account the plan of the account
// that holds the subscription, read here in the same statement as the
// account's own rows: planFor answers the plan, the seat and the group. An
// account with no seat and no member reads exactly as before, from the one
// statement it always sent. Until the seats table is on the database that
// statement is sent without it (withSeats).

import type { Env } from "../env";

// In rank order: a plan includes everything of the plans before it.
export const PLANS = ["free", "pro", "ultra"] as const;
export type Plan = (typeof PLANS)[number];
export type PaidPlan = Exclude<Plan, "free">;
export const PAID_PLANS = ["pro", "ultra"] as const satisfies readonly PaidPlan[];
export const isPaidPlan = (v: unknown): v is PaidPlan => v === "pro" || v === "ultra";
export const planRank = (p: Plan): number => PLANS.indexOf(p);
// users.plan holds free or pro (its CHECK); an Ultra plan is kept there as pro.
export const cachedPlanOf = (p: Plan): "free" | "pro" => (p === "ultra" ? "pro" : p);

// intraday: same-day tender notices, refreshed every two hours through the
// Ottawa business day and merged into /tenders and /tenders/new for a
// session whose plan allows it (rendered by the pages that use it, not here).
// radar_depth: the full 6- and 12-month windows of contracts ending, their
// pages and their files, once the switch is on; the 3-month window, the
// overview and each window's count and total stay free (src/plan.ts).
// bug_reports: the form under the account that stores a report and sends it
// to the operator's inbox (src/account/bugs.tsx).
// analytics: the buyer, organization and segment views over the records
// database in full, and their CSV files; a request without it sees each
// view's first chart for three fiscal years and what the rest holds
// (src/pages/analytics.tsx, docs/analytics.md).
// watchlists: how many organizations, buyers, published contracts and tender
// notices an account follows (src/account/watches.ts), with their events on
// the watches page: 3 on Free, 25 on Pro, WATCH_MAX on Ultra. watch_mail: those
// events by email, daily or weekly per watch (src/account/watch_mail.ts).
// matches: how many matching notices /account/matches lists for the claimed
// organization, closest first (src/account/fit_pages.tsx), MATCH_PAGE a page.
// match_mail: how many of the week's new matching notices one message a week
// lists (src/account/fit_mail.ts): the weekly email, or Pro's watch mail.
// dashboards: how many dashboards an account keeps under /account/dashboard,
// and dashboard_tiles: how many tiles each one holds (src/account/dashboard.tsx).
// saved_views: how many analytics views an account keeps with their source,
// period and choices (src/account/saved_views.ts, /account/views); view_mail:
// those views by email, weekly or monthly (src/account/view_mail.ts).
// follows: how many earlier contracts an open notice's page shows a reader
// (src/pages/follows.tsx, while FOLLOWS_PANEL is "on"), the closest first;
// Free's without their holders' records.
// builder: the analytics builder (src/pages/builder.tsx, /analytics/build)
// and its CSV file, while its switch (BUILDER) is on.
export const FEATURES = [
  "saved_searches", "delivery", "api", "export_filtered", "intraday", "radar_depth", "bug_reports", "analytics", "watchlists",
  "watch_mail", "matches", "match_mail",
  "dashboards", "dashboard_tiles", "saved_views", "view_mail", "follows", "builder",
] as const;
export type Feature = (typeof FEATURES)[number];

// The ceiling on saved searches whatever the plan, Ultra's figure (accounts_schema.sql
// says the same). A line naming a plan's own figure reads RULES, never this.
export const SAVED_SEARCH_MAX = 100;
// The ceiling on watches whatever the plan, Ultra's figure (accounts_schema.sql says
// the same); the claimed organization's watch is held beside it (watches.ts).
export const WATCH_MAX = 100;
// The ceiling on saved analytics views whatever the plan, Ultra's figure
// (accounts_schema.sql says the same); a plan's own figure is RULES[plan].saved_views.
export const SAVED_VIEW_MAX = 50;
// The matching notices on one page of /account/matches.
export const MATCH_PAGE = 50;

type Rules = {
  saved_searches: number; delivery: boolean; api: boolean; export_filtered: boolean; intraday: boolean; radar_depth: boolean;
  bug_reports: boolean; analytics: boolean; watchlists: number; watch_mail: boolean; matches: number; match_mail: number;
  dashboards: number; dashboard_tiles: number; saved_views: number; view_mail: boolean; follows: number; builder: boolean;
};

const PRO_RULES: Rules = {
  saved_searches: 25, delivery: true, api: true, export_filtered: true, intraday: true, radar_depth: true, bug_reports: true,
  analytics: true, watchlists: 25, watch_mail: true, matches: 200, match_mail: 10,
  dashboards: 0, dashboard_tiles: 0, saved_views: 10, view_mail: false, follows: 3, builder: false,
};

// Ultra holds every Pro feature, with figures of its own on the counted ones:
// the ceilings above, which the watch statements serve in groups under D1's
// bound values (watch_events.ts, feeds.ts). Its other figures are named where
// they are served: the keyed API's day (api_keyed_spec.ts KEY_PER_DAY_ULTRA)
// and the analytics years (records_db.ts ULTRA_YEARS).
export const RULES: Readonly<Record<Plan, Rules>> = {
  free: {
    saved_searches: 3, delivery: false, api: false, export_filtered: false, intraday: false, radar_depth: false, bug_reports: false,
    analytics: false, watchlists: 3, watch_mail: false, matches: 5, match_mail: 3,
    dashboards: 0, dashboard_tiles: 0, saved_views: 0, view_mail: false, follows: 1, builder: false,
  },
  pro: PRO_RULES,
  ultra: {
    ...PRO_RULES,
    saved_searches: SAVED_SEARCH_MAX,
    watchlists: WATCH_MAX,
    matches: 500,
    match_mail: 25,
    // The operator's figures of 2026-11-15: five dashboards of 24 tiles each (dashboard_rule.ts holds the ceilings).
    dashboards: 5,
    dashboard_tiles: 24,
    saved_views: SAVED_VIEW_MAX,
    view_mail: true,
    builder: true,
  },
};

// The figures a plan gives as counts rather than as yes or no.
export const COUNTED_FEATURES = [
  "saved_searches", "watchlists", "matches", "match_mail", "dashboards", "dashboard_tiles", "saved_views", "follows",
] as const satisfies readonly Feature[];
export type CountedFeature = (typeof COUNTED_FEATURES)[number];
export const isCounted = (f: Feature): f is CountedFeature => (COUNTED_FEATURES as readonly Feature[]).includes(f);

export const isPlan = (v: unknown): v is Plan => (PLANS as readonly unknown[]).includes(v);

export type EntitlementRow = {
  id: string; plan: string; starts_at: string; ends_at: string | null; created_at: string; revoked_at: string | null;
};

// The seats each plan holds, the subscriber's own included (the operator's
// ruling of 2026-11-16): a plan with 1 has no member seats. Read by planFor
// for the group; kept apart from RULES while no card, page or Terms states it.
export const PLAN_SEATS: Readonly<Record<Plan, number>> = { free: 1, pro: 1, ultra: 5 };
export const memberSeats = (plan: Plan): number => Math.max(0, PLAN_SEATS[plan] - 1);

// An account's live seat on another account's subscription: the seat's id, the
// holder's id and address, and whether the seat gives this account its plan
// now (the holder active and not blocked, the seat among the first
// memberSeats(plan) the holder's own plan holds by join order, and the
// account's own plan below the one it gives). Nothing else of the holder is read.
export type SeatState = { id: string; holderId: string; holderEmail: string; covered: boolean };
// The holder and the members whose seats its plan covers, the holder first,
// then the members by join order; position is this account's place in ids
// (0 for the holder). An account in no group has none.
export type Group = { holderId: string; ids: string[]; position: number };

// seat and group are present only for an account that holds a seat or whose
// plan covers one, so every other account's answer is the three fields it
// always was.
export type PlanState = {
  plan: Plan; until: string | null; source: "entitlements" | "last_known"; seat?: SeatState; group?: Group;
};

// The plan the rows give at a moment: of the rows not revoked whose window
// holds it (starts_at at or before, ends_at after or none), the latest
// recorded wins (created_at, then id, so two rows written in the same
// instant still order); none means free. A later row can lower a plan as
// well as raise it: the newest decision stands.
export function planFromRows(rows: readonly EntitlementRow[], now: Date): { plan: Plan; until: string | null } {
  const at = now.toISOString();
  const live = rows.filter((r) => !r.revoked_at && isPlan(r.plan) && r.starts_at <= at && (r.ends_at === null || at < r.ends_at));
  live.sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1));
  const top = live[0];
  return top ? { plan: top.plan as Plan, until: top.ends_at } : { plan: "free", until: null };
}

// How many pro rows are live at an instant (?1, written as toISOString
// writes it): the window rule of planFromRows above (not revoked, started,
// not ended), counted over the pro rows. The same-day refresh runs only while
// this is above zero: the gate in .github/workflows/intraday.yml sends this
// exact text through the D1 REST API (pipeline/tests/test_intraday.py holds
// the two equal), and the daily check (src/watchdog.ts) prepares it on the
// ACCOUNTS binding. Change the window rule and this changes with it, in both
// places. It does not apply the "latest row wins" half: a user
// whose newest live row is free but who holds an older live pro row is
// counted, and the refresh then runs for a user the site serves as free (a
// minute of runner time; the opposite mistake would skip a paying user). An
// Ultra entitlement is a pro row with its tier beside it, so it counts here
// unchanged. A seat writes no entitlement row (its member's plan is read
// through the holder's), so a subscription with seats counts once, its holder.
export const LIVE_PRO_SQL =
  "SELECT COUNT(*) AS n FROM entitlements WHERE plan = 'pro' AND revoked_at IS NULL AND starts_at <= ?1 AND (ends_at IS NULL OR ends_at > ?1)";

export type PlanHolder = { id: string; plan: string; plan_until: string | null };

// The last known plan from the cache columns: still the plan while its end
// is ahead (or it has none), free once its end has passed. The cache holds
// an Ultra account as pro, so this answers Pro for it.
export function lastKnownPlan(user: PlanHolder, now: Date): { plan: Plan; until: string | null } {
  if (!isPlan(user.plan) || user.plan === "free") return { plan: "free", until: null };
  if (user.plan_until !== null && user.plan_until <= now.toISOString()) return { plan: "free", until: null };
  return { plan: user.plan, until: user.plan_until };
}

// -- the tier table ------------------------------------------------------------------

// A fault that names entitlement_tiers missing: the database the schema has
// not been applied to again since Ultra. Any other fault is not this.
export const missingTiers = (e: unknown): boolean =>
  /no such table:?\s*entitlement_tiers/i.test(String((e as { message?: unknown })?.message ?? e));

// One line per isolate the first time a read falls back for want of the
// table, so the log says why Ultra reads as Pro without repeating it on every
// request until the schema is applied.
let tiersMissingSaid = false;
function sayTiersMissing(): void {
  if (tiersMissingSaid) return;
  tiersMissingSaid = true;
  console.error("account plan: entitlement_tiers missing, Ultra rows read as Pro until accounts_schema.sql is applied");
}

// run(true) reads with the tier table; when the table is missing, run(false)
// reads without it. Any other fault is passed on.
export async function withTiers<T>(run: (tiers: boolean) => Promise<T>): Promise<T> {
  try {
    return await run(true);
  } catch (e) {
    if (!missingTiers(e)) throw e;
    sayTiersMissing();
    return run(false);
  }
}

// The rows planFromRows reads: an entitlements row says pro for Ultra (Ultra
// includes Pro); its tier row names Ultra. Without the table, the row's own plan.
export const ENTITLEMENTS_SQL =
  "SELECT e.id, COALESCE(t.tier, e.plan) AS plan, e.starts_at, e.ends_at, e.created_at, e.revoked_at " +
  "FROM entitlements e LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id WHERE e.user_id = ?";
export const ENTITLEMENTS_SQL_NO_TIERS =
  "SELECT id, plan, starts_at, ends_at, created_at, revoked_at FROM entitlements WHERE user_id = ?";

// Whether entitlement_tiers is on the database. A true answer is kept for the
// isolate's life, per database binding: the table is never dropped once
// applied. A missing table, or any fault, answers false and is asked again
// next time. forgetTiers is for the tests, which drop the table: it forgets
// the table seen and the log line said.
let tiersSeen = new WeakSet<D1Database>();
export function forgetTiers(): void {
  tiersSeen = new WeakSet<D1Database>();
  tiersMissingSaid = false;
}
export async function tiersReady(env: Pick<Env, "ACCOUNTS">): Promise<boolean> {
  const db = env.ACCOUNTS;
  if (!db) return false;
  if (tiersSeen.has(db)) return true;
  try {
    await db.prepare("SELECT 1 AS x FROM entitlement_tiers LIMIT 1").first();
    tiersSeen.add(db);
    return true;
  } catch {
    return false;
  }
}

// -- the seats table -----------------------------------------------------------------

// A fault that names the seats table missing: the database the schema has not
// been applied to again since seats. Any other fault is not this.
export const missingSeats = (e: unknown): boolean =>
  /no such table:?\s*seats\b/i.test(String((e as { message?: unknown })?.message ?? e));

// How long a missing seats table is taken as missing before it is asked about
// again. Without it every planFor would send a failed statement before today's,
// and the delivery run, which reads one plan an account inside a query budget,
// would spend two queries an account while the schema waits.
export const SEATS_RECHECK_MS = 10 * 60 * 1000;

// Per database binding: when the table was last found missing (ms), and
// whether it has been seen (kept for the isolate's life, as tiersSeen is: the
// table is never dropped once applied).
let seatsMissingAt = new WeakMap<D1Database, number>();
let seatsSeen = new WeakSet<D1Database>();
let seatsMissingSaid = false;

function saySeatsMissing(): void {
  if (seatsMissingSaid) return;
  seatsMissingSaid = true;
  console.error("account plan: seats missing, every account read without a seat until accounts_schema.sql is applied");
}

const seatsRecentlyMissing = (db: D1Database, now: Date): boolean => {
  const at = seatsMissingAt.get(db);
  return at !== undefined && now.getTime() - at < SEATS_RECHECK_MS;
};

// For the tests, which drop the table: forgets the table seen or missing and the log line said.
export function forgetSeats(): void {
  seatsMissingAt = new WeakMap<D1Database, number>();
  seatsSeen = new WeakSet<D1Database>();
  seatsMissingSaid = false;
}

// run(true) reads with the seats table; when the table is missing, run(false)
// reads without it, and for SEATS_RECHECK_MS after that run(false) is all that
// is sent. Any other fault is passed on, a missing entitlement_tiers among
// them, so withTiers outside it answers that one as before.
export async function withSeats<T>(db: D1Database, run: (seats: boolean) => Promise<T>, now: Date = new Date()): Promise<T> {
  if (seatsRecentlyMissing(db, now)) return run(false);
  try {
    const out = await run(true);
    seatsSeen.add(db);
    return out;
  } catch (e) {
    if (!missingSeats(e)) throw e;
    seatsMissingAt.set(db, now.getTime());
    saySeatsMissing();
    return run(false);
  }
}

// Whether the seats table is on the database. A true answer is kept for the
// isolate's life; a missing table is remembered as withSeats remembers it, so
// a page that has just read a plan asks nothing more either way.
export async function seatsReady(env: Pick<Env, "ACCOUNTS">, now: Date = new Date()): Promise<boolean> {
  const db = env.ACCOUNTS;
  if (!db) return false;
  if (seatsSeen.has(db)) return true;
  if (seatsRecentlyMissing(db, now)) return false;
  try {
    await db.prepare("SELECT 1 AS x FROM seats LIMIT 1").first();
    seatsSeen.add(db);
    return true;
  } catch (e) {
    if (missingSeats(e)) seatsMissingAt.set(db, now.getTime());
    return false;
  }
}

// An entitlement as the statements of one batch (a D1 batch is one
// transaction): the entitlements row, which says pro for Ultra, and for Ultra
// its tier row. So a tier row never exists without its entitlement, and an
// Ultra grant never lands as a bare Pro row: without the tier table the whole
// batch fails. plan is pro or ultra; a free row is never written.
export type EntitlementWrite = {
  id: string; userId: string; plan: PaidPlan; source: "manual" | "stripe"; startsAt: string; endsAt: string | null;
  reference: string | null; createdAt: string;
};

export function entitlementWrites(db: D1Database, r: EntitlementWrite): D1PreparedStatement[] {
  const row = db.prepare(
    "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(r.id, r.userId, cachedPlanOf(r.plan), r.source, r.startsAt, r.endsAt, r.reference, r.createdAt);
  return r.plan === "ultra"
    ? [row, db.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(r.id)]
    : [row];
}

// The plan and the group in one statement (PLAN_ROWS_SQL, ?1 the account's id,
// one bound value), three halves told apart by via:
// - own: the account's own entitlements, as ENTITLEMENTS_SQL reads them;
// - held: the holder's own entitlements when this account holds a live seat,
//   with the holder's id and address, whether the holder is active and not
//   blocked (holder_ok, 1 or 0), and the seat's id. The LEFT JOIN keeps one row
//   for a holder with no entitlement, whose plan is NULL and so no plan;
// - seat: the group's live seats, the holder's when this account holds one,
//   else this account's own as a holder.
// For an account with no seat and no member the second half is one probe of
// idx_seats_member_live and the third two (that index, then idx_seats_holder),
// and neither returns a row.
const planRowsSql = (tiers: boolean): string => {
  const plan = tiers ? "COALESCE(t.tier, e.plan)" : "e.plan";
  const tier = tiers ? " LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id" : "";
  return (
    `SELECT 'own' AS via, e.id, ${plan} AS plan, e.starts_at, e.ends_at, e.created_at, e.revoked_at, ` +
    "NULL AS holder_id, NULL AS holder_email, NULL AS holder_ok, NULL AS member_id, NULL AS joined_at, NULL AS seat_id " +
    `FROM entitlements e${tier} WHERE e.user_id = ?1 ` +
    "UNION ALL " +
    `SELECT 'held', e.id, ${plan}, e.starts_at, e.ends_at, e.created_at, e.revoked_at, ` +
    "s.holder_id, h.email, h.status = 'active' AND NOT EXISTS (SELECT 1 FROM account_blocks b WHERE b.user_id = s.holder_id), " +
    "NULL, NULL, s.id " +
    `FROM seats s JOIN users h ON h.id = s.holder_id LEFT JOIN entitlements e ON e.user_id = s.holder_id${tier} ` +
    "WHERE s.member_id = ?1 AND s.ended_at IS NULL " +
    "UNION ALL " +
    "SELECT 'seat', NULL, NULL, NULL, NULL, NULL, NULL, g.holder_id, NULL, NULL, g.member_id, g.joined_at, g.id " +
    "FROM seats g " +
    "WHERE g.holder_id = COALESCE((SELECT holder_id FROM seats WHERE member_id = ?1 AND ended_at IS NULL), ?1) " +
    "AND g.member_id IS NOT NULL AND g.ended_at IS NULL"
  );
};
export const PLAN_ROWS_SQL = planRowsSql(true);
export const PLAN_ROWS_SQL_NO_TIERS = planRowsSql(false);

type PlanRow = EntitlementRow & {
  via?: "own" | "held" | "seat"; holder_id?: string | null; holder_email?: string | null; holder_ok?: number | null;
  member_id?: string | null; joined_at?: string | null; seat_id?: string | null;
};

// The holder's live seats in the order they were joined, then by id: the
// order the plan covers them in.
const byJoinThenId = (a: PlanRow, b: PlanRow): number =>
  (a.joined_at ?? "") === (b.joined_at ?? "") ? ((a.seat_id ?? "") < (b.seat_id ?? "") ? -1 : 1) : (a.joined_at ?? "") < (b.joined_at ?? "") ? -1 : 1;

// The plan, the seat and the group from the rows of PLAN_ROWS_SQL. A member
// takes the plan the holder's own rows give while the seat is covered; its own
// plan wins when it is as high (the operator's grant: no plan is above Ultra,
// the one plan with member seats), and the account is then in no group. A
// holder whose plan covers at least one seat leads a group.
type SeatPlan = { state: { plan: Plan; until: string | null }; seat?: SeatState; group?: Group };

function seatPlan(userId: string, rows: readonly PlanRow[], now: Date): SeatPlan {
  const own = planFromRows(rows.filter((r) => r.via === "own"), now);
  const held = rows.filter((r) => r.via === "held");
  const live = rows.filter((r) => r.via === "seat" && r.member_id).sort(byJoinThenId);
  if (held.length) {
    const h = held[0];
    const given = planFromRows(held, now);
    const covered = live.slice(0, memberSeats(given.plan)).map((r) => r.member_id as string);
    const ok = !!h.holder_ok && covered.includes(userId) && planRank(given.plan) > planRank(own.plan);
    const seat: SeatState = { id: h.seat_id as string, holderId: h.holder_id as string, holderEmail: h.holder_email ?? "", covered: ok };
    if (!ok) return { state: own, seat };
    const holderId = h.holder_id as string;
    return { state: given, seat, group: { holderId, ids: [holderId, ...covered], position: 1 + covered.indexOf(userId) } };
  }
  const covered = live.slice(0, memberSeats(own.plan)).map((r) => r.member_id as string);
  return covered.length ? { state: own, group: { holderId: userId, ids: [userId, ...covered], position: 0 } } : { state: own };
}

// planFor(user, now): the plan from the entitlements rows, with the cache on
// users brought up to date when it differs. The cache holds Ultra as pro
// (cachedPlanOf), and is compared the same way, so an Ultra account's cache
// is not rewritten on every request. A read that fails answers the last
// known plan instead; through such an outage an Ultra account is served as
// Pro, and nothing is granted that was not paid for.
//
// One statement whatever the account: PLAN_ROWS_SQL, or today's
// ENTITLEMENTS_SQL while the seats table is missing. A covered member's cache
// says pro with the holder's end, as an Ultra holder's does.
export async function planFor(env: Env, user: PlanHolder, now: Date = new Date()): Promise<PlanState> {
  const db = env.ACCOUNTS;
  if (!db) return { ...lastKnownPlan(user, now), source: "last_known" };
  let read: { rows: PlanRow[]; seats: boolean };
  try {
    read = await withTiers((tiers) => withSeats(db, async (seats) => {
      const sql = seats ? (tiers ? PLAN_ROWS_SQL : PLAN_ROWS_SQL_NO_TIERS) : tiers ? ENTITLEMENTS_SQL : ENTITLEMENTS_SQL_NO_TIERS;
      return { seats, rows: (await db.prepare(sql).bind(user.id).all<PlanRow>()).results ?? [] };
    }, now));
  } catch {
    console.error("account plan: entitlements unreadable, last known plan used");
    return { ...lastKnownPlan(user, now), source: "last_known" };
  }
  // Without the seats table every row is the account's own.
  const { state, seat, group }: SeatPlan = read.seats ? seatPlan(user.id, read.rows, now) : { state: planFromRows(read.rows, now) };
  const cached = cachedPlanOf(state.plan);
  if (cached !== user.plan || state.until !== user.plan_until) {
    try {
      await db.prepare("UPDATE users SET plan = ?, plan_until = ? WHERE id = ?").bind(cached, state.until, user.id).run();
    } catch {
      // The cache is behind for now; the rows still decided this answer.
    }
  }
  return { ...state, source: "entitlements", ...(seat ? { seat } : {}), ...(group ? { group } : {}) };
}

// allowed(user, feature): whether the user's plan allows a feature. For a
// counted feature (saved_searches, watchlists, matches, match_mail), `used` is how many
// the user holds or is shown, and the answer is whether one more fits.
export function allowed(who: { plan: Plan } | null | undefined, feature: Feature, used = 0): boolean {
  const rules = RULES[who?.plan ?? "free"];
  if (isCounted(feature)) return used < rules[feature];
  return rules[feature];
}

export function savedSearchCap(plan: Plan): number {
  return RULES[plan].saved_searches;
}

export function watchCap(plan: Plan): number {
  return Math.min(RULES[plan].watchlists, WATCH_MAX);
}

// How many matching notices a plan lists.
export function matchCap(plan: Plan): number {
  return RULES[plan].matches;
}

// How many of the week's new matching notices a plan's weekly message lists.
export function matchMailCap(plan: Plan): number {
  return RULES[plan].match_mail;
}

// How many earlier contracts an open notice's page shows a plan: the pipeline keeps FOLLOW_MAX (src/lines.ts).
export function followCap(plan: Plan): number {
  return RULES[plan].follows;
}

// How many analytics views a plan keeps: none on Free.
export function savedViewCap(plan: Plan): number {
  return Math.min(RULES[plan].saved_views, SAVED_VIEW_MAX);
}
