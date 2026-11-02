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

import type { Env } from "../env";

export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];

// intraday: same-day tender notices, refreshed every two hours through the
// Ottawa business day and merged into /tenders and /tenders/new for a
// session whose plan allows it (rendered by the pages that use it, not here).
export const FEATURES = ["saved_searches", "delivery", "api", "export_filtered", "intraday"] as const;
export type Feature = (typeof FEATURES)[number];

// The ceiling on saved searches whatever the plan (accounts_schema.sql says
// the same).
export const SAVED_SEARCH_MAX = 25;

type Rules = { saved_searches: number; delivery: boolean; api: boolean; export_filtered: boolean; intraday: boolean };

export const RULES: Readonly<Record<Plan, Rules>> = {
  free: { saved_searches: 3, delivery: false, api: false, export_filtered: false, intraday: false },
  pro: { saved_searches: SAVED_SEARCH_MAX, delivery: true, api: true, export_filtered: true, intraday: true },
};

export const isPlan = (v: unknown): v is Plan => v === "free" || v === "pro";

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

export type PlanHolder = { id: string; plan: string; plan_until: string | null };

// The last known plan from the cache columns: still the plan while its end
// is ahead (or it has none), free once its end has passed.
export function lastKnownPlan(user: PlanHolder, now: Date): { plan: Plan; until: string | null } {
  if (!isPlan(user.plan) || user.plan === "free") return { plan: "free", until: null };
  if (user.plan_until !== null && user.plan_until <= now.toISOString()) return { plan: "free", until: null };
  return { plan: user.plan, until: user.plan_until };
}

// planFor(user, now): the plan from the entitlements rows, with the cache on
// users brought up to date when it differs. A read that fails answers the
// last known plan instead.
export async function planFor(env: Env, user: PlanHolder, now: Date = new Date()): Promise<PlanState> {
  const db = env.ACCOUNTS;
  if (!db) return { ...lastKnownPlan(user, now), source: "last_known" };
  let rows: EntitlementRow[];
  try {
    const res = await db.prepare(
      "SELECT id, plan, starts_at, ends_at, created_at, revoked_at FROM entitlements WHERE user_id = ?",
    ).bind(user.id).all<EntitlementRow>();
    rows = res.results ?? [];
  } catch {
    console.error("account plan: entitlements unreadable, last known plan used");
    return { ...lastKnownPlan(user, now), source: "last_known" };
  }
  const state = planFromRows(rows, now);
  if (state.plan !== user.plan || state.until !== user.plan_until) {
    try {
      await db.prepare("UPDATE users SET plan = ?, plan_until = ? WHERE id = ?").bind(state.plan, state.until, user.id).run();
    } catch {
      // The cache is behind for now; the rows still decided this answer.
    }
  }
  return { ...state, source: "entitlements" };
}

// allowed(user, feature): whether the user's plan allows a feature. For
// saved_searches, `used` is how many the user holds, and the answer is
// whether one more fits.
export function allowed(who: { plan: Plan } | null | undefined, feature: Feature, used = 0): boolean {
  const rules = RULES[who?.plan ?? "free"];
  if (feature === "saved_searches") return used < rules.saved_searches;
  return rules[feature];
}

export function savedSearchCap(plan: Plan): number {
  return RULES[plan].saved_searches;
}
