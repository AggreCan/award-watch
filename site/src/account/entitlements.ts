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
// the watches page: 3 on Free, WATCH_MAX on Pro. watch_mail: those events by
// email, daily or weekly per watch (src/account/watch_mail.ts).
// matches: how many matching notices /account/matches lists for the claimed
// organization, closest first (src/account/fit_pages.tsx), MATCH_PAGE a page.
// match_mail: how many of the week's new matching notices one message a week
// lists (src/account/fit_mail.ts): the weekly email, or Pro's watch mail.
export const FEATURES = [
  "saved_searches", "delivery", "api", "export_filtered", "intraday", "radar_depth", "bug_reports", "analytics", "watchlists",
  "watch_mail", "matches", "match_mail",
] as const;
export type Feature = (typeof FEATURES)[number];

// The ceiling on saved searches whatever the plan (accounts_schema.sql says
// the same).
export const SAVED_SEARCH_MAX = 25;
// The ceiling on watches whatever the plan (accounts_schema.sql says the same);
// the claimed organization's watch is held beside it (watches.ts).
export const WATCH_MAX = 25;
// The matching notices on one page of /account/matches.
export const MATCH_PAGE = 50;

type Rules = {
  saved_searches: number; delivery: boolean; api: boolean; export_filtered: boolean; intraday: boolean; radar_depth: boolean;
  bug_reports: boolean; analytics: boolean; watchlists: number; watch_mail: boolean; matches: number; match_mail: number;
};

const PRO_RULES: Rules = {
  saved_searches: SAVED_SEARCH_MAX, delivery: true, api: true, export_filtered: true, intraday: true, radar_depth: true, bug_reports: true,
  analytics: true, watchlists: WATCH_MAX, watch_mail: true, matches: 200, match_mail: 10,
};

// Ultra holds every Pro feature, and for now Pro's figures: its own figures
// come with the code that serves them (the watch statements cut into groups
// under D1's bound values, the API's count by plan, the longer analytics
// period), raised together, so no figure is promised before it works.
export const RULES: Readonly<Record<Plan, Rules>> = {
  free: {
    saved_searches: 3, delivery: false, api: false, export_filtered: false, intraday: false, radar_depth: false, bug_reports: false,
    analytics: false, watchlists: 3, watch_mail: false, matches: 5, match_mail: 3,
  },
  pro: PRO_RULES,
  ultra: { ...PRO_RULES },
};

// The figures a plan gives as counts rather than as yes or no.
export const COUNTED_FEATURES = ["saved_searches", "watchlists", "matches", "match_mail"] as const satisfies readonly Feature[];
export type CountedFeature = (typeof COUNTED_FEATURES)[number];
export const isCounted = (f: Feature): f is CountedFeature => (COUNTED_FEATURES as readonly Feature[]).includes(f);

export const isPlan = (v: unknown): v is Plan => (PLANS as readonly unknown[]).includes(v);

export type EntitlementRow = {
  id: string; plan: string; starts_at: string; ends_at: string | null; created_at: string; revoked_at: string | null;
};

export type PlanState = { plan: Plan; until: string | null; source: "entitlements" | "last_known" };

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
// unchanged.
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

// planFor(user, now): the plan from the entitlements rows, with the cache on
// users brought up to date when it differs. The cache holds Ultra as pro
// (cachedPlanOf), and is compared the same way, so an Ultra account's cache
// is not rewritten on every request. A read that fails answers the last
// known plan instead; through such an outage an Ultra account is served as
// Pro, and nothing is granted that was not paid for.
export async function planFor(env: Env, user: PlanHolder, now: Date = new Date()): Promise<PlanState> {
  const db = env.ACCOUNTS;
  if (!db) return { ...lastKnownPlan(user, now), source: "last_known" };
  let rows: EntitlementRow[];
  try {
    rows = await withTiers(async (tiers) =>
      (await db.prepare(tiers ? ENTITLEMENTS_SQL : ENTITLEMENTS_SQL_NO_TIERS).bind(user.id).all<EntitlementRow>()).results ?? []);
  } catch {
    console.error("account plan: entitlements unreadable, last known plan used");
    return { ...lastKnownPlan(user, now), source: "last_known" };
  }
  const state = planFromRows(rows, now);
  const cached = cachedPlanOf(state.plan);
  if (cached !== user.plan || state.until !== user.plan_until) {
    try {
      await db.prepare("UPDATE users SET plan = ?, plan_until = ? WHERE id = ?").bind(cached, state.until, user.id).run();
    } catch {
      // The cache is behind for now; the rows still decided this answer.
    }
  }
  return { ...state, source: "entitlements" };
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
