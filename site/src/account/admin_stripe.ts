// The Stripe calls of the operator console (admin.tsx): read a subscription
// as Stripe holds it now, cancel one at the period end or at once, find the
// charge behind the latest paid invoice, and refund that charge in full. The
// same plain fetch as stripe.ts (a Bearer key, form-encoded bodies, the
// pinned API version), written again here because stripe.ts keeps its
// request helper to itself.
//
// Nothing here writes to the database. A refund changes no entitlement row
// directly: Stripe's charge.refunded notice reaches the webhook
// (billing.tsx), which ends the account's Stripe Pro, the same path a refund
// made in Stripe's dashboard takes.
//
// What is read from Stripe is shown to the operator and dropped: ids, a
// status, dates, an amount and its currency. A charge also names the card
// used and its holder; none of that is read into anything here, so the
// console never shows card data. Log lines name the call and the status,
// never an id or an amount.

import type { Env } from "../env";
import { STRIPE_API, STRIPE_VERSION, readSubscription, stripeKeys } from "./stripe";

const CALL_TIMEOUT_MS = 10_000;
// Invoices read when looking for the latest one that took money: a zero
// invoice (a credit, a free period) has no charge to refund, so the first
// with an amount paid wins among the latest few.
const INVOICES_READ = 5;

type J = Record<string, unknown>;
type Call = { ok: true; body: J } | { ok: false; status: number };

const obj = (v: unknown): J | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as J) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 255 ? v : null);
const idOf = (v: unknown): string | null => str(v) ?? str(obj(v)?.id);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);
const listData = (v: unknown): J[] => {
  const d = obj(v)?.data;
  return Array.isArray(d) ? d.map(obj).filter((x): x is J => x !== null) : [];
};

async function call(
  key: string, method: "GET" | "POST" | "DELETE", path: string, label: string,
  opts: { form?: [string, string][]; query?: [string, string][]; idempotencyKey?: string } = {},
): Promise<Call> {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "stripe-version": STRIPE_VERSION };
  let body: string | undefined;
  if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const query = opts.query?.length ? `?${new URLSearchParams(opts.query).toString()}` : "";
  try {
    const res = await fetch(`${STRIPE_API}${path}${query}`, { method, headers, body, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`stripe (operator): ${label} answered ${res.status}`);
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, status: res.status };
    }
    const parsed = obj(await res.json());
    return parsed ? { ok: true, body: parsed } : { ok: false, status: 0 };
  } catch {
    console.error(`stripe (operator): ${label} unreachable`);
    return { ok: false, status: 0 };
  }
}

// A subscription as Stripe holds it now. periodEnd is ISO; cancelAtPeriodEnd
// says a cancellation is already set for the period's end.
export type LiveSubscription = { status: string; periodEnd: string | null; cancelAtPeriodEnd: boolean };

// The charge behind a paid invoice: what the refund page shows and the
// refund names. amount and refunded are in the currency's smallest unit.
export type PaidCharge = {
  invoiceId: string; chargeId: string; amount: number; refunded: number; currency: string; paidAt: string | null;
};

export interface OperatorStripe {
  // "missing" when Stripe has no such subscription; null when it could not be asked.
  subscription(id: string): Promise<LiveSubscription | "missing" | null>;
  // True when Stripe confirmed it (or, at once, when the subscription is already gone).
  cancel(id: string, when: "period_end" | "now"): Promise<boolean>;
  // "none" when no paid invoice of the subscription took money through a charge; null when Stripe could not be asked.
  latestPaidCharge(subscriptionId: string): Promise<PaidCharge | "none" | null>;
  // The refund's id and status, or null when Stripe refused or could not be reached.
  refund(chargeId: string): Promise<{ id: string; status: string } | null>;
}

// The idempotency key of a refund: the charge's own id, so a second press, a
// reload of the post or a retry after a timeout (within Stripe's 24 hours)
// returns the first refund instead of asking for a second one.
export const refundKey = (chargeId: string) => `operator-refund-${chargeId}`;

function chargeOf(o: J): Omit<PaidCharge, "invoiceId"> | null {
  const chargeId = str(o.id);
  const amount = int(o.amount);
  const currency = str(o.currency);
  if (!chargeId || amount === null || !currency) return null;
  const created = int(o.created);
  return {
    chargeId, amount, refunded: int(o.amount_refunded) ?? 0, currency: currency.toLowerCase(),
    paidAt: created ? new Date(created * 1000).toISOString() : null,
  };
}

// Null without the two Stripe secrets: the console then shows the stored
// row only and offers no cancellation or refund.
export function operatorStripe(env: Env): OperatorStripe | null {
  const keys = stripeKeys(env);
  if (!keys) return null;
  const key = keys.secretKey;

  async function charge(id: string): Promise<Omit<PaidCharge, "invoiceId"> | null> {
    const res = await call(key, "GET", `/charges/${encodeURIComponent(id)}`, "charge read");
    return res.ok ? chargeOf(res.body) : null;
  }

  async function subscription(id: string): Promise<LiveSubscription | "missing" | null> {
    const res = await call(key, "GET", `/subscriptions/${encodeURIComponent(id)}`, "subscription read");
    if (!res.ok) return res.status === 404 ? "missing" : null;
    const state = readSubscription(res.body);
    if (!state) return null;
    return { status: state.status, periodEnd: state.periodEnd, cancelAtPeriodEnd: res.body.cancel_at_period_end === true };
  }

  return {
    subscription,

    // At the period end: the subscription runs to the end of what was paid,
    // then Stripe ends it and its customer.subscription.deleted notice ends
    // Pro. At once: Stripe ends it now, bills nothing more and refunds
    // nothing; the same notice ends Pro.
    async cancel(id, when) {
      const path = `/subscriptions/${encodeURIComponent(id)}`;
      if (when === "period_end") {
        const res = await call(key, "POST", path, "subscription cancel at period end", { form: [["cancel_at_period_end", "true"]] });
        return res.ok;
      }
      const res = await call(key, "DELETE", path, "subscription cancel");
      if (res.ok || res.status === 404) return true;
      const state = await subscription(id);
      return state === "missing" || (state !== null && (state.status === "canceled" || state.status === "incomplete_expired"));
    },

    // The latest paid invoices of the subscription, newest first, with their
    // payments (the field current API versions use instead of the invoice's
    // own charge, which older versions return and is read too). A payment
    // made through a PaymentIntent names no charge, so the PaymentIntent's
    // charges are listed and the one that succeeded is taken; listing
    // charges needs only the Charges read permission.
    async latestPaidCharge(subscriptionId) {
      const res = await call(key, "GET", "/invoices", "invoice list", {
        query: [["subscription", subscriptionId], ["status", "paid"], ["limit", String(INVOICES_READ)], ["expand[]", "data.payments"]],
      });
      if (!res.ok) return null;
      for (const invoice of listData(res.body)) {
        const invoiceId = str(invoice.id);
        if (!invoiceId || (int(invoice.amount_paid) ?? 0) === 0) continue;
        let chargeId = idOf(invoice.charge);
        let intentId: string | null = null;
        if (!chargeId) {
          for (const p of listData(invoice.payments)) {
            if (p.status !== undefined && p.status !== "paid") continue;
            const payment = obj(p.payment);
            chargeId = idOf(payment?.charge);
            intentId = idOf(payment?.payment_intent);
            if (chargeId || intentId) break;
          }
        }
        if (chargeId) {
          const found = await charge(chargeId);
          return found ? { invoiceId, ...found } : null;
        }
        if (intentId) {
          const listed = await call(key, "GET", "/charges", "charge list", { query: [["payment_intent", intentId], ["limit", "10"]] });
          if (!listed.ok) return null;
          const paid = listData(listed.body).find((ch) => ch.status === "succeeded" && ch.paid !== false);
          const found = paid ? chargeOf(paid) : null;
          if (found) return { invoiceId, ...found };
        }
      }
      return "none";
    },

    // A full refund of the charge (no amount given: whatever has not been
    // refunded yet), under the charge's idempotency key.
    async refund(chargeId) {
      const res = await call(key, "POST", "/refunds", "refund", { form: [["charge", chargeId]], idempotencyKey: refundKey(chargeId) });
      if (!res.ok) return null;
      const id = str(res.body.id);
      return id ? { id, status: str(res.body.status) ?? "pending" } : null;
    },
  };
}
