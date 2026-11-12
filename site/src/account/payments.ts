// The payments source. Stripe when its two secrets are set (stripe.ts),
// the stub otherwise: the stub takes nothing, and the billing page says Pro
// is not available yet. Callers (billing.tsx) see only this interface, so a
// second processor would be a second implementation and nothing else.
//
// What a source does: hand back an address where the user pays for a plan
// and one where they manage what they pay for; read a signed notice from the
// service into one of a few changes (a checkout completed, a period paid, a
// subscription's state); and read or cancel a subscription. It never writes:
// billing.tsx turns each change into entitlement rows, the reference the
// service's own subscription id, never a card or an address.

import type { Env } from "../env";
import type { Lang } from "../i18n";
import { type PaidPlan, tiersReady } from "./entitlements";
import { stripeOffers, stripeSource } from "./stripe";
import { accountsEnabled } from "./switch";

export const INTERVALS = ["monthly", "yearly"] as const;
export type Interval = (typeof INTERVALS)[number];

export const isInterval = (v: unknown): v is Interval => v === "monthly" || v === "yearly";

export type CheckoutInput = {
  userId: string;
  email: string;
  // The plan bought: Pro, or Ultra while it is on sale (ultraOnSale).
  plan: PaidPlan;
  interval: Interval;
  lang: Lang;
  // The service's customer from an earlier subscription, so a returning
  // subscriber keeps one record of receipts; null for a first one.
  customerId: string | null;
  successUrl: string;
  cancelUrl: string;
};

// flow: open the portal at one change of the subscription's one item, its
// price moved to priceId (a move between plans, billing.tsx moveBetweenPlans),
// returning to doneUrl once confirmed.
export type PortalFlow = { subscriptionId: string; itemId: string; priceId: string; doneUrl: string };
export type PortalInput = { customerId: string; returnUrl: string; lang: Lang; flow?: PortalFlow };

// One item's price and product, as the service names them.
export type ItemPrice = { price: string | null; product: string | null };

// A subscription as the service reports it. periodEnd is ISO, null when the
// service gave none. item is its one item (null when it has none or
// several), with the interval its price bills at (null for any other than
// a month or a year); pending the items of a pending update, null when there
// is none.
export type SubscriptionState = {
  id: string; customerId: string; status: string; periodEnd: string | null; userId: string | null;
  item: ({ id: string; interval: Interval | null } & ItemPrice) | null; pending: ItemPrice[] | null;
};

// What a verified notice asks for. userId on the last two is the hint the
// subscription carries in its metadata (set at checkout), used only when the
// stored binding does not name the user already.
export type Notice =
  // createdAt: when the session was made; paidAt: when the invoice was paid;
  // chargeId: the charge that paid it, when the invoice names one. Read
  // against the reversals already taken (billing.tsx).
  | { kind: "checkout"; userId: string; customerId: string; subscriptionId: string; paid: boolean; createdAt: string | null }
  | {
    kind: "period_paid"; subscriptionId: string; customerId: string; userId: string | null; periodEnd: string | null;
    chargeId: string | null; paidAt: string | null;
  }
  | { kind: "subscription"; subscription: SubscriptionState; deleted: boolean }
  // A charge refunded in full, or disputed: the money for a period went back
  // or is being taken back. customerId is null when the notice does not name
  // it (a dispute), and the charge is read for it.
  | { kind: "reversed"; chargeId: string; customerId: string | null; why: "refunded" | "disputed" }
  | { kind: "other" };

export type NoticeResult = { ok: true; id: string; type: string; notice: Notice } | { ok: false };

export type ReadSubscription = SubscriptionState | "missing" | null;

export interface PaymentSource {
  readonly kind: "stub" | "stripe";
  // Whether the billing page can offer a checkout: the source exists and
  // both prices and the figures shown beside them are configured.
  available(): boolean;
  // The two prices as the page shows them (text in Canadian dollars), or
  // null while not available.
  offer(): Readonly<Record<Interval, string>> | null;
  // The same for either plan: Pro's is offer(); Ultra's is null unless its
  // five variables are set and in form (whether it is on sale is ultraOnSale's).
  offerFor(plan: PaidPlan): Readonly<Record<Interval, string>> | null;
  // The service's price id for a plan and interval, null when not configured.
  priceFor(plan: PaidPlan, interval: Interval): string | null;
  // "busy": a checkout with other choices was started for the user moments
  // ago, and a second subscription is not started beside it.
  checkoutUrl(input: CheckoutInput): Promise<string | null | "busy">;
  portalUrl(input: PortalInput): Promise<string | null>;
  // A notice from the service, checked against its signature before
  // anything in it is read. Never trusts an unsigned body.
  readNotice(request: Request, now?: Date): Promise<NoticeResult>;
  // "missing" when the service has no such subscription; null when it could
  // not be asked.
  subscription(id: string): Promise<ReadSubscription>;
  // The customer a charge was made to: "missing" when the service has no
  // such charge or it names no customer; null when it could not be asked.
  chargeCustomer(id: string): Promise<string | "missing" | null>;
  // Ends a subscription at once; true when it is ended (or already was).
  cancel(id: string): Promise<boolean>;
}

export const stubPayments: PaymentSource = {
  kind: "stub",
  available: () => false,
  offer: () => null,
  offerFor: () => null,
  priceFor: () => null,
  checkoutUrl: async () => null,
  portalUrl: async () => null,
  readNotice: async () => ({ ok: false }),
  subscription: async () => null,
  chargeCustomer: async () => null,
  cancel: async () => false,
};

export function paymentSource(env: Env): PaymentSource {
  return stripeSource(env) ?? stubPayments;
}

// Whether Ultra can be bought: the accounts switch is on, the payment source
// offers Pro, all five Ultra variables are set and in form, and the
// entitlement_tiers table is on the accounts database (entitlements.ts
// tiersReady, a true answer kept for the isolate's life). It decides the
// third plan card, the Ultra section of /pro, the landing page's Ultra card,
// Ultra's offers in the Product markup, the Ultra checkout and moves, and
// whether the Ultra message may be sent. The cheap checks come first, so a
// site without the Ultra variables never reads the database for it. An
// account the operator granted Ultra uses its features and sees its labels
// whatever this answers.
export async function ultraOnSale(env: Env): Promise<boolean> {
  if (!accountsEnabled(env)) return false;
  if (!paymentSource(env).available()) return false;
  if (!stripeOffers(env).ultra) return false;
  return tiersReady(env);
}
