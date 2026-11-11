// The refund of the first payment, pressed on the billing page (the Terms,
// Refund of the First Payment): POST /account/billing/refund, behind the
// Origin check, the session and the CSRF value (routes.tsx). The page offers
// it from the site's own rows (billing.tsx refundState); the press asks those
// rows again, then reads Stripe and decides from Stripe's own figures
// (refundVerdict), refunds the first payment's charge in full and cancels the
// subscription at once. Nothing the page sends is trusted but the ticked box:
// the subscription, the customer and the charge are the ones bound to the
// signed-in account, read back from Stripe.
//
// The refund comes first: a refund that fails leaves the subscription and Pro
// as they were, while a cancellation that fails after a refund leaves only a
// subscription to cancel by hand, which the daily check names (watchdog.ts).
//
// No entitlement is written here. Stripe's charge.refunded and
// customer.subscription.deleted notices end the account's Stripe Pro through
// the webhook (billing.tsx), as for a refund made anywhere else; until one
// arrives the page says Pro ends within a minute.
//
// Each step writes an audit row: refund_requested with the subscription's id
// once the press is confirmed, refund_refused with a fixed reason,
// refund_made with the refund's status, then plan_changed "stripe cancelled
// with the refund" or refund_cancel_failed with the subscription's id. No
// amount and no address.

import type { Context } from "hono";
import type { AppEnv } from "../env";
import type { Key } from "../i18n";
import { type FirstPayment, operatorStripe } from "./admin_stripe";
import { audit } from "./audit";
import { REFUND_DAYS, billingLine, billingPage, langQuery, paymentRow, refundState } from "./billing";
import { paymentSource } from "./payments";
import type { Account } from "./session";

const DAY_MS = 24 * 60 * 60 * 1000;

// A refund Stripe took: done at once, or on its way to the card.
const TAKEN = new Set(["succeeded", "pending"]);

export type RefundRefusal = "refunded" | "not first" | "disputed" | "figures" | "window";

// Stripe's figures against what the site binds to the account. null when the
// payment may be refunded: the customer's only payment ever (one paid invoice
// that took money, one charge that succeeded, both lists read to their end),
// for the bound subscription, never refunded or disputed in any part, its
// charge naming the bound customer, the charge's amount and currency those of
// the invoice (so the refund, the charge in full, is the first payment and no
// more), and made at most REFUND_DAYS before now by the charge's own time.
export function refundVerdict(
  p: FirstPayment, bound: { subscriptionId: string; customerId: string }, now: Date,
): RefundRefusal | null {
  if (p.refunded > 0 || p.refundedCharges > 0) return "refunded";
  if (
    !p.complete || p.paidInvoices !== 1 || p.paidCharges.length !== 1 || p.paidCharges[0] !== p.chargeId ||
    p.subscriptionId !== bound.subscriptionId
  ) return "not first";
  if (p.disputed || p.disputedCharges > 0) return "disputed";
  if (p.customerId !== bound.customerId || p.amount <= 0 || p.amount !== p.invoiceAmount || p.currency !== p.invoiceCurrency) return "figures";
  const paid = p.paidAt ? Date.parse(p.paidAt) : NaN;
  if (!Number.isFinite(paid) || now.getTime() - paid > REFUND_DAYS * DAY_MS) return "window";
  return null;
}

const REFUSAL_ERROR: Record<RefundRefusal, Key> = {
  refunded: "billing.refund_err_refunded",
  window: "billing.refund_err_window",
  "not first": "billing.refund_err_unavailable",
  disputed: "billing.refund_err_unavailable",
  figures: "billing.refund_err_unavailable",
};

export async function pressRefund(c: Context<AppEnv>, who: Account, fields: Record<string, string>): Promise<Response> {
  const env = c.env;
  const lang = c.get("lang");
  const now = new Date();
  const source = paymentSource(env);
  const stripe = operatorStripe(env);
  if (source.kind === "stub" || !stripe) return c.redirect(`/account/billing${langQuery(lang, "?")}`, 303);
  // Refused: said on the page, recorded with its reason, nothing cancelled and nothing recorded as refunded.
  const refuse = async (why: string, error: Key, status = 409): Promise<Response> => {
    await audit(env, who.userId, "refund_refused", why, now);
    return billingPage(c, who, { errors: [error], status });
  };

  // The site's own rows first, as the page read them: a press from a page
  // left open past the window, or after a refund, stops here.
  const row = await paymentRow(env, who.userId);
  const state = await refundState(env, who.userId, row, await billingLine(env, who.userId, now), now);
  if (state === "refunded") return refuse("refunded already", "billing.refund_err_refunded");
  if (state === "window") return refuse("window", "billing.refund_err_window");
  if (state !== "offer" || !row?.subscription_id) return refuse("not offered", "billing.refund_err_unavailable");
  if (fields.confirm !== "yes") return billingPage(c, who, { errors: ["account.err_confirm"], status: 400, confirm: true });
  const subscriptionId = row.subscription_id;
  const customerId = row.customer_id;
  await audit(env, who.userId, "refund_requested", subscriptionId, now);

  // The subscription as Stripe holds it: active, of the bound customer, and
  // naming no other account in its metadata.
  const live = await source.subscription(subscriptionId);
  if (live === null) return refuse("stripe unreachable", "billing.refund_err_failed", 503);
  if (live === "missing" || live.status !== "active") return refuse("subscription", "billing.refund_err_unavailable");
  if (live.customerId !== customerId || (live.userId !== null && live.userId !== who.userId)) {
    console.error("billing refund: the subscription does not match the account");
    return refuse("another account", "billing.refund_err_unavailable");
  }

  // The first payment as Stripe holds it, judged on Stripe's figures.
  const first = await stripe.firstPayment(customerId);
  if (first === null) return refuse("stripe unreachable", "billing.refund_err_failed", 503);
  if (first === "none") return refuse("no payment", "billing.refund_err_unavailable");
  const verdict = refundVerdict(first, { subscriptionId, customerId }, now);
  if (verdict) return refuse(verdict, REFUSAL_ERROR[verdict]);

  // The refund, under the charge's idempotency key: a double submit or a
  // retry gets the first refund back from Stripe, never a second one. When
  // no refund comes back, the charge is read again: an answer lost on the
  // way back shows there as the charge refunded in full.
  const made = await stripe.refund(first.chargeId);
  let status = made && TAKEN.has(made.status) ? made.status : null;
  if (!status) {
    const after = await stripe.charge(first.chargeId);
    if (after && after.amount > 0 && after.refunded >= after.amount) status = "confirmed";
    else return refuse(made ? `stripe refused, ${made.status.slice(0, 20)}` : "stripe refused", "billing.refund_err_failed", 503);
  }
  await audit(env, who.userId, "refund_made", `refund ${status}`, now);

  // Then the subscription, at once: nothing more is billed. The stored row
  // reads canceled now, as the operator's cancellation does, so the page
  // stops offering the portal and the refund; the notice records the rest.
  const cancelled = await source.cancel(subscriptionId);
  if (cancelled) {
    try {
      await env.ACCOUNTS!.prepare("UPDATE payment_customers SET status = 'canceled', updated_at = ? WHERE user_id = ? AND subscription_id = ?")
        .bind(now.toISOString(), who.userId, subscriptionId).run();
    } catch {
      console.error("billing refund: the stored status not updated");
    }
    await audit(env, who.userId, "plan_changed", "stripe cancelled with the refund", now);
  } else {
    await audit(env, who.userId, "refund_cancel_failed", subscriptionId, now);
  }
  return c.redirect(`/account/billing?refund=${cancelled ? "done" : "sent"}${langQuery(lang, "&")}`, 303);
}
