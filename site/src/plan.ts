// The plan a request is served under, for the features the paid tier adds.
// Every page works on the free plan; a paid feature is drawn only when the
// request's plan allows it, and the free page is exactly the page without
// it. A page asks requestPlan first and reads nothing a paid feature needs
// (no D1 query, no asset) unless the answer allows that feature.
//
// For now every request is free. When the accounts module lands, its
// planOfRequest replaces the body of requestPlan (the session cookie read
// against the entitlements, failing open to the free plan when the accounts
// database cannot be read), and its allowed(plan, feature) holds which plan
// carries which feature. That table will carry INTRADAY for the paid plan
// only.

import type { Context } from "hono";
import type { AppEnv } from "./env";

export type Plan = "free" | "pro";

// The same-day tender notices band on /tenders and /tenders/new
// (src/intraday.ts, src/pages/intraday.tsx; docs/intraday.md).
export const INTRADAY = "intraday";

export async function requestPlan(_c: Context<AppEnv>): Promise<Plan> {
  return "free";
}
