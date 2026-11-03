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
import { stripeSource } from "./stripe";

export const INTERVALS = ["monthly", "yearly"] as const;
export type Interval = (typeof INTERVALS)[number];

export const isInterval = (v: unknown): v is Interval => v === "monthly" || v === "yearly";

export type CheckoutInput = {
  userId: string;
  email: string;
  interval: Interval;
  lang: Lang;
  // The service's customer from an earlier subscription, so a returning
  // subscriber keeps one record of receipts; null for a first one.
  customerId: string | null;
  successUrl: string;
  cancelUrl: string;
};

export type PortalInput = { customerId: string; returnUrl: string; lang: Lang };

// A subscription as the service reports it. periodEnd is ISO, null when the
// service gave none.
export type SubscriptionState = { id: string; customerId: string; status: string; periodEnd: string | null; userId: string | null };

// What a verified notice asks for. userId on the last two is the hint the
// subscription carries in its metadata (set at checkout), used only when the
// stored binding does not name the user already.
export type Notice =
  | { kind: "checkout"; userId: string; customerId: string; subscriptionId: string; paid: boolean }
  | { kind: "period_paid"; subscriptionId: string; customerId: string; userId: string | null; periodEnd: string | null }
  | { kind: "subscription"; subscription: SubscriptionState; deleted: boolean }
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
  checkoutUrl(input: CheckoutInput): Promise<string | null>;
  portalUrl(input: PortalInput): Promise<string | null>;
  // A notice from the service, checked against its signature before
  // anything in it is read. Never trusts an unsigned body.
  readNotice(request: Request, now?: Date): Promise<NoticeResult>;
  // "missing" when the service has no such subscription; null when it could
  // not be asked.
  subscription(id: string): Promise<ReadSubscription>;
  // Ends a subscription at once; true when it is ended (or already was).
  cancel(id: string): Promise<boolean>;
}

export const stubPayments: PaymentSource = {
  kind: "stub",
  available: () => false,
  offer: () => null,
  checkoutUrl: async () => null,
  portalUrl: async () => null,
  readNotice: async () => ({ ok: false }),
  subscription: async () => null,
  cancel: async () => false,
};

export function paymentSource(env: Env): PaymentSource {
  return stripeSource(env) ?? stubPayments;
}
