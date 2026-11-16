// Who has the dashboard and where it is offered (docs/accounts.md,
// Dashboard), apart from the page itself (dashboard.tsx) so the shell
// (src/layout.tsx) can ask without importing the page.

import type { Env } from "../env";
import { type Plan, RULES } from "./entitlements";
import { ultraOnSale } from "./payments";

export const DASHBOARD_PATH = "/account/dashboard";
// Add a Tile's Analytics door (dashboard_doors.tsx): the find page, a subject's checklist of tables (the view's
// base, buyers, organizations or segments, then its id), and a starter's post.
export const FIND_PATH = `${DASHBOARD_PATH}/find`;
export const TABLES_PATH = `${DASHBOARD_PATH}/tables`;
export const STARTER_PATH = `${DASHBOARD_PATH}/starter`;

// The ceilings whatever the plan, as SAVED_SEARCH_MAX is for searches: the
// dashboards an account keeps, and the tiles one dashboard holds. A plan's
// own figures are RULES[plan].dashboards and RULES[plan].dashboard_tiles.
export const DASHBOARDS_MAX = 5;
export const TILES_MAX = 24;

// How many dashboards a plan keeps, and how many tiles each holds: none on Free and Pro.
export const boardCap = (plan: Plan | null | undefined): number => Math.min(RULES[plan ?? "free"].dashboards, DASHBOARDS_MAX);
export const tileCap = (plan: Plan | null | undefined): number => Math.min(RULES[plan ?? "free"].dashboard_tiles, TILES_MAX);

export const holdsDashboard = (plan: Plan | null | undefined): boolean => boardCap(plan) > 0 && tileCap(plan) > 0;

// A fault that names either of the grid's tables missing: the schema not applied since the grid.
export const missingTiles = (e: unknown): boolean =>
  /no such table:?\s*(?:main\.)?(?:dashboards|dashboard_tiles)\b/i.test(String((e as { message?: unknown })?.message ?? e));

// A dashboard's own address: the first one's is the bare path (which shows
// whichever dashboard is first), every other one's carries its id.
export const boardPath = (id: string | null, first = false): string => (id && !first ? `${DASHBOARD_PATH}/${id}` : DASHBOARD_PATH);

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
