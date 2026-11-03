// The plan a request is served under, for the features the paid tier adds.
// Every page works on the free plan; a paid feature is drawn only when the
// request's plan allows it, and the free page is exactly the page without
// it. A page asks requestPlan first and reads nothing a paid feature needs
// (no D1 query, no asset) unless allowed() says the feature is on.
//
// The answer comes from the accounts module: planOfRequest reads the session
// cookie against the entitlements, answers "free" without reading anything
// while the accounts switch is off or without a cookie, and never throws
// (src/account/session.ts); allowed() holds which plan carries which feature
// (src/account/entitlements.ts).

import type { Context } from "hono";
import type { ExpiringWindow } from "./data";
import type { AppEnv } from "./env";
import { type Plan, allowed } from "./account/entitlements";
import { planOfRequest } from "./account/session";
import { accountsEnabled } from "./account/switch";

export type { Plan };

// The same-day tender notices band on /tenders and /tenders/new
// (src/intraday.ts, src/pages/intraday.tsx; docs/intraday.md).
export const INTRADAY = "intraday";

export function requestPlan(c: Context<AppEnv>): Promise<Plan> {
  return planOfRequest(c);
}

export function allowsIntraday(plan: Plan): boolean {
  return allowed({ plan }, INTRADAY);
}

// The full 6- and 12-month windows of contracts ending: their pages and their
// files under /data/expiring/ (src/pages/expiring.tsx). The 3-month window,
// the overview and every window's count and total stay free.
export const RADAR_DEPTH = "radar_depth";
export const DEEP_WINDOWS: readonly ExpiringWindow[] = ["6m", "12m"];

export function allowsRadarDepth(plan: Plan): boolean {
  return allowed({ plan }, RADAR_DEPTH);
}

// Whether a request gets the free view of a window. Never while the accounts
// switch is off: the gate starts with the switch, so until then every window
// is served as it always was, and planOfRequest's "free" for a switched-off
// site must not close anything. The plan is read only for a deep window.
export async function radarWindowLocked(c: Context<AppEnv>, window: string): Promise<boolean> {
  if (!(DEEP_WINDOWS as readonly string[]).includes(window) || !accountsEnabled(c.env)) return false;
  return !allowsRadarDepth(await requestPlan(c));
}
