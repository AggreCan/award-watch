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
import type { AppEnv } from "./env";
import { type Plan, allowed } from "./account/entitlements";
import { planOfRequest } from "./account/session";

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
