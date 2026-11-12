// Who has the dashboard and where it is offered (docs/accounts.md,
// Dashboard), apart from the page itself (dashboard.tsx) so the shell
// (src/layout.tsx) can ask without importing the page.

import type { Env } from "../env";
import { type Plan, RULES } from "./entitlements";
import { ultraOnSale } from "./payments";

export const DASHBOARD_PATH = "/account/dashboard";

// The ceiling on panels whatever the plan, as SAVED_SEARCH_MAX is for
// searches; a plan's own figure is RULES[plan].dashboard.
export const DASHBOARD_MAX = 12;

// How many panels a plan's dashboard holds: none on Free and Pro.
export const dashboardCap = (plan: Plan | null | undefined): number => Math.min(RULES[plan ?? "free"].dashboard, DASHBOARD_MAX);

export const holdsDashboard = (plan: Plan | null | undefined): boolean => dashboardCap(plan) > 0;

// The rail's Dashboard item: for a reader the rail shows an account to
// (signed in or not; the caller asks only then), while Ultra is on sale or
// the account holds it. The account's plan answers first, so an account
// granted Ultra by hand sees the item without the database being asked;
// ultraOnSale reads nothing while Ultra's variables are not set.
export async function dashboardInRail(env: Env, plan: Plan | null): Promise<boolean> {
  if (holdsDashboard(plan)) return true;
  try {
    return await ultraOnSale(env);
  } catch {
    return false;
  }
}
