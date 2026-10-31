// Every figure on the Support page. The page computes its bars, totals, tier
// coverage and the card-fee split from these constants, so a change here is
// the whole change. Amounts are Canadian dollars unless the name says USD.
// Derived amounts are rounded to whole cents before they are summed, so the
// rows a reader sees always add up to the totals shown. The words (tier
// names, what each tier pays for) are in i18n.ts.
//
// PLACEHOLDER FIGURES: the site has not launched. Each figure below is a
// planning estimate to be replaced with the real one (the domain's renewal
// price, the first month's usage reports) before the page goes public.

import { decimal, t, type Lang } from "./i18n";

// ---------------------------------------------------------------------------
// What the site holds and the free-tier limits

// Hour of the daily refresh, UTC. Matches the nightly workflow's schedule
// (0 0 * * *). Revisit if the schedule changes.
export const REFRESH_HOUR_UTC = 0;

// The Workers Paid plan the site runs on, already in place on the project
// account. Placeholder date: the site's own first month.
export const WORKERS_PAID_SINCE = "2026-11-01";

// Worker requests included each month on the Workers Paid plan, with no daily
// ceiling. Host's published allowance. Revisit with the pricing page.
export const PAID_REQUESTS_PER_MONTH = 10_000_000;

// R2 storage that is free each month, in GB. Host's published free allowance.
// Revisit with the pricing page.
export const STORAGE_FREE_GB = 10;

// ---------------------------------------------------------------------------
// Costs and upgrade tiers

// Domain registration, CAD per year. Placeholder until the registrar's
// renewal price is known.
export const DOMAIN_CAD_PER_YEAR = 20;

// Hosting today, CAD per month, beyond the Workers Paid plan: D1, R2 and the
// scheduled runs fit inside the allowances. Revisit against the first invoice.
export const HOSTING_CAD_PER_MONTH = 0;

// Exchange rate used to convert USD list prices to CAD. Rounded up from the
// market rate so the estimates err high. Revisit each quarter.
export const USD_TO_CAD = 1.4;

// Workers Paid plan, USD per month. Host's published list price. The plan is
// shared with other projects on the same account; this is the whole price, a
// figure that errs high for this site.
export const WORKERS_PAID_USD_PER_MONTH = 5;

// Allowance on top of the Workers Paid list price, CAD per month, for usage
// above the plan's included requests and CPU time and for sales tax.
// Placeholder.
export const WORKERS_USAGE_ALLOWANCE_CAD_PER_MONTH = 2.5;

// Hosted search (the next slice), CAD per month on top of the Workers Paid
// plan. Placeholder: expected inside D1's included allowances.
export const HOSTED_SEARCH_CAD_PER_MONTH = 0;

// R2 storage above the free allowance, USD per GB per month. Host's published
// standard storage rate. Revisit with the pricing page.
export const STORAGE_USD_PER_GB_MONTH = 0.015;

// Storage reserve, CAD per month, for files past the free allowance (the
// database backups are larger than the free allowance's share). Placeholder.
export const STORAGE_RESERVE_CAD_PER_MONTH = 2;

// Nights a month, averaged over the year: one refresh a night.
export const NIGHTS_PER_MONTH = 365 / 12;

// The nightly refresh runs as a scheduled task on GitHub; a public
// repository's runner minutes are not billed. Minutes a night is a planning
// figure. Placeholder.
export const ACTIONS_MINUTES_PER_NIGHT = 60;

// Runner minutes included each month for a public repository: no cap, so
// the figure only has to exceed the nightly need.
export const ACTIONS_FREE_MINUTES_PER_MONTH = 1_000_000;

// USD per runner minute past the allowance, standard Linux runner. Host's
// published rate. Revisit with the pricing page.
export const ACTIONS_USD_PER_MINUTE = 0.006;

// How many months of the full monthly cost the reserve should hold before the
// page states that nothing further is needed. Fixed by policy.
export const RESERVE_GOAL_MONTHS = 12;

// ---------------------------------------------------------------------------
// Support received (computed in support_data.ts from stored payment notices)

// The site's first month. Spending accrues from here, one monthly cost per
// month started, and the transparency table lists every quarter since.
// Placeholder until launch.
export const SITE_START = "2026-10-01";

// ---------------------------------------------------------------------------
// Card fee

// Card processing fee: percentage part in basis points (290 = 2.9 percent)
// and fixed part in cents. Standard domestic card rate of common payment
// processors. Revisit when the payment page is chosen and use its exact rate.
export const CARD_FEE_BASIS_POINTS = 290;
export const CARD_FEE_FIXED_CENTS = 30;

// The gift used to illustrate the fee split, CAD. A round example amount.
export const EXAMPLE_GIFT_CAD = 10;

// ---------------------------------------------------------------------------
// Derived values and helpers

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function fmtCents(cents: number, lang: Lang = "en"): string {
  return t(lang, "money", { amount: decimal(lang, (cents / 100).toFixed(2)) });
}

// A US dollar list price as written in running text ("US$5", "5 $ US").
export function fmtUsd(amount: number, lang: Lang = "en"): string {
  return t(lang, "money.usd", { amount: decimal(lang, String(amount)) });
}

// Bar length as a whole percentage of the largest bar in its group. Zero
// stays zero so an unfunded or free item draws no bar at all.
export function barWidth(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(100, Math.max(1, Math.round((value / max) * 100)));
}

export function refreshTimeText(hour: number = REFRESH_HOUR_UTC, lang: Lang = "en"): string {
  return hour === 0
    ? t(lang, "support.refresh_midnight")
    : t(lang, "support.refresh_hour", { hh: String(hour).padStart(2, "0") });
}

export const DOMAIN_CENTS_PER_MONTH = toCents(DOMAIN_CAD_PER_YEAR / 12);
export const HOSTING_CENTS_PER_MONTH = toCents(HOSTING_CAD_PER_MONTH);
export const ACTIONS_CAD_PER_MONTH =
  Math.max(0, ACTIONS_MINUTES_PER_NIGHT * NIGHTS_PER_MONTH - ACTIONS_FREE_MINUTES_PER_MONTH) * ACTIONS_USD_PER_MINUTE * USD_TO_CAD;
export const ACTIONS_CENTS_PER_MONTH = toCents(ACTIONS_CAD_PER_MONTH);
// The Workers Paid plan as the site pays for it today: the list price plus the
// allowance for tax and usage, the same estimate as its tier below.
export const WORKERS_PLAN_CAD_PER_MONTH = WORKERS_PAID_USD_PER_MONTH * USD_TO_CAD + WORKERS_USAGE_ALLOWANCE_CAD_PER_MONTH;
export const WORKERS_PLAN_CENTS_PER_MONTH = toCents(WORKERS_PLAN_CAD_PER_MONTH);
export const COSTS_TODAY_CENTS = DOMAIN_CENTS_PER_MONTH + HOSTING_CENTS_PER_MONTH + ACTIONS_CENTS_PER_MONTH + WORKERS_PLAN_CENTS_PER_MONTH;
export const WORKERS_PAID_LIST_CENTS = toCents(WORKERS_PAID_USD_PER_MONTH * USD_TO_CAD);
export const STORAGE_CENTS_PER_GB_MONTH = toCents(STORAGE_USD_PER_GB_MONTH * USD_TO_CAD);
export const STORAGE_RESERVE_GB = Math.floor(STORAGE_RESERVE_CAD_PER_MONTH / (STORAGE_USD_PER_GB_MONTH * USD_TO_CAD));

export type TierId = "baseline" | "workers_paid" | "hosted_search" | "storage";
// inPlace: the site already runs on this tier, paid by the operator until
// monthly support covers it.
export type Tier = { id: TierId; name: string; monthlyCost: number; unlocks: string; inPlace?: boolean };

const TIER_VARS = { free: STORAGE_FREE_GB, gb: STORAGE_RESERVE_GB };

export function tierName(lang: Lang, id: TierId): string {
  return t(lang, `support.tier.${id}.name`);
}

export function tierUnlocks(lang: Lang, id: TierId): string {
  return t(lang, `support.tier.${id}.unlocks`, TIER_VARS);
}

// In order: each tier assumes the ones before it.
export const TIERS: readonly Tier[] = [
  {
    id: "baseline",
    name: tierName("en", "baseline"),
    monthlyCost: DOMAIN_CAD_PER_YEAR / 12 + HOSTING_CAD_PER_MONTH + ACTIONS_CAD_PER_MONTH,
    unlocks: tierUnlocks("en", "baseline"),
  },
  {
    id: "workers_paid",
    name: tierName("en", "workers_paid"),
    monthlyCost: WORKERS_PLAN_CAD_PER_MONTH,
    unlocks: tierUnlocks("en", "workers_paid"),
    inPlace: true,
  },
  {
    id: "hosted_search",
    name: tierName("en", "hosted_search"),
    monthlyCost: HOSTED_SEARCH_CAD_PER_MONTH,
    unlocks: tierUnlocks("en", "hosted_search"),
  },
  {
    id: "storage",
    name: tierName("en", "storage"),
    monthlyCost: STORAGE_RESERVE_CAD_PER_MONTH,
    unlocks: tierUnlocks("en", "storage"),
  },
];

export type TierStatus = "Funded" | "Partly funded" | "Not yet funded" | "In place";
export type TierCoverage = Tier & { costCents: number; cumulativeCents: number; width: number; status: TierStatus };

// Compares monthly support with the cumulative monthly cost through each tier,
// in order. The bar and the status word come from that one comparison: full
// at or above the cumulative cost, partial below it, empty with no support.
export function tierCoverage(supportCents: number, tiers: readonly Tier[] = TIERS): TierCoverage[] {
  const support = Number.isFinite(supportCents) && supportCents > 0 ? Math.round(supportCents) : 0;
  let cumulative = 0;
  return tiers.map((tier) => {
    const costCents = toCents(tier.monthlyCost);
    cumulative += costCents;
    // A tier the site already runs on reads "In place" until support covers it.
    const status: TierStatus =
      support >= cumulative ? "Funded" : tier.inPlace ? "In place" : support > 0 ? "Partly funded" : "Not yet funded";
    return { ...tier, costCents, cumulativeCents: cumulative, width: barWidth(Math.min(support, cumulative), cumulative), status };
  });
}

// The monthly target is the monthly cost of every tier together.
export const TARGET_CENTS_PER_MONTH = TIERS.reduce((sum, t) => sum + toCents(t.monthlyCost), 0);
export const RESERVE_GOAL_CENTS = TARGET_CENTS_PER_MONTH * RESERVE_GOAL_MONTHS;

// True once monthly support covers every tier and the reserve holds the goal,
// the point at which the page states that nothing further is needed.
export function budgetMet(
  supportCents: number,
  reserveMonths: number,
  targetCents: number = TARGET_CENTS_PER_MONTH,
): boolean {
  return supportCents >= targetCents && reserveMonths >= RESERVE_GOAL_MONTHS;
}

export type FeeSplit = {
  giftCents: number;
  feeCents: number;
  netCents: number;
  // Shares of the gift in tenths of a percent; they always sum to 1000.
  feeTenths: number;
  netTenths: number;
};

// Splits a gift into the card fee and what is left for the site's costs. The
// fee is rounded to the nearest cent and never exceeds the gift.
export function feeSplit(giftCents: number): FeeSplit {
  if (!Number.isFinite(giftCents) || giftCents <= 0) {
    return { giftCents: 0, feeCents: 0, netCents: 0, feeTenths: 0, netTenths: 0 };
  }
  const gift = Math.round(giftCents);
  const fee = Math.min(gift, Math.round((gift * CARD_FEE_BASIS_POINTS) / 10000) + CARD_FEE_FIXED_CENTS);
  const feeTenths = Math.round((fee * 1000) / gift);
  return { giftCents: gift, feeCents: fee, netCents: gift - fee, feeTenths, netTenths: 1000 - feeTenths };
}

// "2.9 percent plus 30 cents", from the two fee constants.
export function cardFeeText(lang: Lang = "en"): string {
  return t(lang, "support.fee_rate", { pct: decimal(lang, String(CARD_FEE_BASIS_POINTS / 100)), cents: CARD_FEE_FIXED_CENTS });
}
