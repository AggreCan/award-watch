// The Stripe calls of the operator console (admin.tsx): read a subscription
// as Stripe holds it now, cancel one at the period end or at once, find the
// charge behind the latest paid invoice, and refund that charge in full. The
// billing page's own refund (refund.ts) uses the same refund, and reads the
// account's first payment here too; so does the webhook's refund of a
// payment that lands on a deleted account (billing.tsx cancelForDeleted),
// which reads the invoice the notice names. The same plain fetch as stripe.ts (a
// Bearer key, form-encoded bodies, the pinned API version), written again
// here because stripe.ts keeps its request helper to itself.
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
// Invoices and charges of a customer read for its first payment: a customer
// with more than this many of either has paid more than once, which the
// lists' has_more says without reading further.
const FIRST_READ = 10;
// A refund asked again under its key: Stripe answers 409 while the first
// request under that key is still being handled (a double submit) and the
// first one's answer once it is done; a call that got no answer at all is
// asked once more, which the key also makes safe.
const REFUND_TRIES = 3;
const REFUND_WAIT_MS = 400;

type J = Record<string, unknown>;
// On a refusal, Stripe's error.code and error.type when its body names them
// (a fixed word, read for the caller and never logged).
type Call = { ok: true; body: J } | { ok: false; status: number; code: string | null; type: string | null };

const WORD_RE = /^[a-z_]{1,40}$/;
const word = (v: unknown): string | null => (typeof v === "string" && WORD_RE.test(v) ? v : null);

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
      const error = res.status >= 400 && res.status < 500 ? obj(obj(await res.json().catch(() => null))?.error) : null;
      if (!error) await res.body?.cancel().catch(() => undefined);
      return { ok: false, status: res.status, code: word(error?.code), type: word(error?.type) };
    }
    const parsed = obj(await res.json());
    return parsed ? { ok: true, body: parsed } : { ok: false, status: 0, code: null, type: null };
  } catch {
    console.error(`stripe (operator): ${label} unreachable`);
    return { ok: false, status: 0, code: null, type: null };
  }
}

// A subscription as Stripe holds it now. periodEnd is ISO; cancelAtPeriodEnd
// says a cancellation is already set for the period's end.
export type LiveSubscription = { status: string; periodEnd: string | null; cancelAtPeriodEnd: boolean };

// The charge behind a paid invoice: what the refund page shows and the
// refund names. amount and refunded are in the currency's smallest unit.
// customerId and disputed are read for the billing page's refund only.
export type PaidCharge = {
  invoiceId: string; chargeId: string; amount: number; refunded: number; currency: string; paidAt: string | null;
  customerId: string | null; disputed: boolean;
};
export type ChargeState = Omit<PaidCharge, "invoiceId">;

// An account's first payment as Stripe holds it (firstPayment): the oldest
// paid invoice of the customer that took money, the charge behind it, and
// what the customer's two lists say around it. The refund decides from these
// (refund.ts refundVerdict); nothing here judges them.
export type FirstPayment = ChargeState & {
  invoiceId: string;
  // The subscription the invoice was for; null when the invoice names none.
  subscriptionId: string | null;
  invoiceAmount: number;
  invoiceCurrency: string;
  // The customer's paid invoices that took money.
  paidInvoices: number;
  // The customer's charges that succeeded and took money, by id.
  paidCharges: string[];
  // The customer's charges with anything refunded, and those disputed.
  refundedCharges: number;
  disputedCharges: number;
  // Both lists were read to their end.
  complete: boolean;
};

export interface OperatorStripe {
  // "missing" when Stripe has no such subscription; null when it could not be asked.
  subscription(id: string): Promise<LiveSubscription | "missing" | null>;
  // True when Stripe confirmed it (or, at once, when the subscription is already gone).
  cancel(id: string, when: "period_end" | "now"): Promise<boolean>;
  // "none" when no paid invoice of the subscription took money through a charge; null when Stripe could not be asked.
  latestPaidCharge(subscriptionId: string): Promise<PaidCharge | "none" | null>;
  // "none" when no paid invoice of the customer took money through a charge; null when Stripe could not be asked.
  firstPayment(customerId: string): Promise<FirstPayment | "none" | null>;
  // One charge as Stripe holds it now; null when it could not be read.
  charge(id: string): Promise<ChargeState | null>;
  // The charge that paid one invoice: "none" when Stripe has no such invoice
  // or it took no money through a charge; null when Stripe could not be asked.
  invoicePayment(invoiceId: string): Promise<ChargeState | "none" | null>;
  // The refund's id and status, or null when Stripe refused or could not be reached.
  refund(chargeId: string): Promise<{ id: string; status: string } | null>;
  // The same refund with Stripe's whole answer: the refund taken (its status,
  // and its failure_reason when it failed at once), or the refusal's status
  // with Stripe's error code and type (0: no answer).
  refundAnswer(chargeId: string): Promise<RefundAnswer>;
}

export type RefundAnswer =
  | { ok: true; id: string; status: string; failureReason: string | null }
  | { ok: false; status: number; code: string | null; type: string | null };

// The idempotency key of a refund: the charge's own id, so a second press, a
// reload of the post or a retry after a timeout (within Stripe's 24 hours)
// returns the first refund instead of asking for a second one. The billing
// page's refund and the webhook's refund on a deleted account use the same
// key with the same parameters, so any two of them on one charge are one
// refund too.
export const refundKey = (chargeId: string) => `operator-refund-${chargeId}`;

function chargeOf(o: J): ChargeState | null {
  const chargeId = str(o.id);
  const amount = int(o.amount);
  const currency = str(o.currency);
  if (!chargeId || amount === null || !currency) return null;
  const created = int(o.created);
  return {
    chargeId, amount, refunded: int(o.amount_refunded) ?? 0, currency: currency.toLowerCase(),
    paidAt: created ? new Date(created * 1000).toISOString() : null,
    customerId: idOf(o.customer), disputed: o.disputed === true,
  };
}

// The subscription an invoice was for: under parent.subscription_details in
// current API versions, at the top in older ones (as stripe.ts reads it).
const invoiceSubscription = (o: J): string | null =>
  idOf(obj(obj(o.parent)?.subscription_details)?.subscription) ?? idOf(o.subscription);

// Null without the two Stripe secrets: the console then shows the stored
// row only and offers no cancellation or refund.
export function operatorStripe(env: Env): OperatorStripe | null {
  const keys = stripeKeys(env);
  if (!keys) return null;
  const key = keys.secretKey;

  async function charge(id: string): Promise<ChargeState | null> {
    const res = await call(key, "GET", `/charges/${encodeURIComponent(id)}`, "charge read");
    return res.ok ? chargeOf(res.body) : null;
  }

  // The charge that paid one invoice, read from the invoice's payments (the
  // field current API versions use instead of the invoice's own charge,
  // which older versions return and is read too). A payment made through a
  // PaymentIntent names no charge, so the PaymentIntent's charges are listed
  // and the one that succeeded is taken; listing charges needs only the
  // Charges read permission. "none" when the invoice leads to no charge;
  // null when Stripe could not be asked.
  async function invoiceCharge(invoice: J): Promise<ChargeState | "none" | null> {
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
    if (chargeId) return charge(chargeId);
    if (intentId) {
      const listed = await call(key, "GET", "/charges", "charge list", { query: [["payment_intent", intentId], ["limit", "10"]] });
      if (!listed.ok) return null;
      const paid = listData(listed.body).find((ch) => ch.status === "succeeded" && ch.paid !== false);
      const found = paid ? chargeOf(paid) : null;
      if (found) return found;
    }
    return "none";
  }

  async function subscription(id: string): Promise<LiveSubscription | "missing" | null> {
    const res = await call(key, "GET", `/subscriptions/${encodeURIComponent(id)}`, "subscription read");
    if (!res.ok) return res.status === 404 ? "missing" : null;
    const state = readSubscription(res.body);
    if (!state) return null;
    // The flag, or a cancel_at at the period's end, as the customer portal sets it under flexible billing (stripe.ts readSubscription).
    return { status: state.status, periodEnd: state.periodEnd, cancelAtPeriodEnd: state.cancelAtPeriodEnd === true };
  }

  // A full refund of the charge (no amount given: whatever has not been
  // refunded yet, which Stripe never lets exceed the charge), under the
  // charge's idempotency key, asked again while Stripe answers that the
  // same key is in flight or does not answer at all.
  async function refundAnswer(chargeId: string): Promise<RefundAnswer> {
    const ask = () => call(key, "POST", "/refunds", "refund", { form: [["charge", chargeId]], idempotencyKey: refundKey(chargeId) });
    let res = await ask();
    for (let tries = 1; !res.ok && tries < REFUND_TRIES && (res.status === 409 || (res.status === 0 && tries < 2)); tries++) {
      await new Promise((resolve) => setTimeout(resolve, REFUND_WAIT_MS));
      res = await ask();
    }
    if (!res.ok) return res;
    const id = str(res.body.id);
    if (!id) return { ok: false, status: 0, code: null, type: null };
    return { ok: true, id, status: str(res.body.status) ?? "pending", failureReason: word(res.body.failure_reason) };
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
    // payments; the newest that took money through a charge wins.
    async latestPaidCharge(subscriptionId) {
      const res = await call(key, "GET", "/invoices", "invoice list", {
        query: [["subscription", subscriptionId], ["status", "paid"], ["limit", String(INVOICES_READ)], ["expand[]", "data.payments"]],
      });
      if (!res.ok) return null;
      for (const invoice of listData(res.body)) {
        const invoiceId = str(invoice.id);
        if (!invoiceId || (int(invoice.amount_paid) ?? 0) === 0) continue;
        const found = await invoiceCharge(invoice);
        if (found === null) return null;
        if (found !== "none") return { invoiceId, ...found };
      }
      return "none";
    },

    // The customer's paid invoices (every subscription of the account shares
    // the customer: a returning subscriber's checkout names it) and its
    // charges, each list read whole up to FIRST_READ; the charge of the
    // oldest invoice that took money, by its created time. A zero invoice
    // (a credit, a free period) took no money and is not a payment.
    async firstPayment(customerId) {
      const invoices = await call(key, "GET", "/invoices", "invoice list", {
        query: [["customer", customerId], ["status", "paid"], ["limit", String(FIRST_READ)], ["expand[]", "data.payments"]],
      });
      if (!invoices.ok) return null;
      const paid = listData(invoices.body)
        .filter((i) => str(i.id) !== null && (int(i.amount_paid) ?? 0) > 0)
        .sort((a, b) => (int(a.created) ?? 0) - (int(b.created) ?? 0));
      if (!paid.length) return "none";
      const charges = await call(key, "GET", "/charges", "charge list", { query: [["customer", customerId], ["limit", String(FIRST_READ)]] });
      if (!charges.ok) return null;
      const all = listData(charges.body);
      const first = paid[0];
      const found = await invoiceCharge(first);
      if (found === null) return null;
      if (found === "none") return "none";
      return {
        ...found,
        invoiceId: str(first.id)!,
        subscriptionId: invoiceSubscription(first),
        invoiceAmount: int(first.amount_paid) ?? 0,
        invoiceCurrency: (str(first.currency) ?? "").toLowerCase(),
        paidInvoices: paid.length,
        paidCharges: all.filter((ch) => ch.status === "succeeded" && ch.paid !== false && (int(ch.amount) ?? 0) > 0)
          .map((ch) => str(ch.id)).filter((id): id is string => id !== null),
        refundedCharges: all.filter((ch) => ch.refunded === true || (int(ch.amount_refunded) ?? 0) > 0).length,
        disputedCharges: all.filter((ch) => ch.disputed === true).length,
        complete: invoices.body.has_more !== true && charges.body.has_more !== true,
      };
    },

    charge,

    // One invoice with its payments (GET /v1/invoices/<id>, Invoices read),
    // and the charge behind it as invoiceCharge finds it. A zero invoice
    // took no money.
    async invoicePayment(invoiceId) {
      const res = await call(key, "GET", `/invoices/${encodeURIComponent(invoiceId)}`, "invoice read", { query: [["expand[]", "payments"]] });
      if (!res.ok) return res.status === 404 ? "none" : null;
      if ((int(res.body.amount_paid) ?? 0) === 0) return "none";
      return invoiceCharge(res.body);
    },

    async refund(chargeId) {
      const answer = await refundAnswer(chargeId);
      return answer.ok ? { id: answer.id, status: answer.status } : null;
    },

    refundAnswer,
  };
}
