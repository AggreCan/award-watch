// Stripe, the payments source (payments.ts), by plain fetch: a Bearer key,
// form-encoded bodies, a pinned API version, and WebCrypto for the webhook's
// signature. No SDK, so nothing here runs that the repository does not hold.
//
// The source exists only while both secrets are set (STRIPE_SECRET_KEY and
// STRIPE_WEBHOOK_SECRET); it offers a checkout only while both price ids and
// the two figures the billing page shows are set too. The figures are the
// operator's text in wrangler.jsonc, never a number in this file.
//
// Nothing here writes to the database. It reads a notice into a change
// (payments.ts) and billing.tsx decides what that change does to the
// entitlements. Log lines name the call and the status, never an id, an
// address or an amount.

import type { Context } from "hono";
import type { Env } from "../env";
import type { Lang } from "../i18n";
import type {
  CheckoutInput, CheckoutSession, Interval, Notice, NoticeResult, PaymentSource, PortalInput, ReadSubscription, SubscriptionState,
} from "./payments";
import { sameHash, toHex } from "./secrets";
import { accountsEnabled } from "./switch";

export const STRIPE_API = "https://api.stripe.com/v1";
// Pinned so the shapes read below do not move when the account's default
// version does. The webhook endpoint is created with the same version
// (docs/accounts.md); the readers also accept the older shapes, where the
// subscription sat on the invoice and the period end on the subscription.
export const STRIPE_VERSION = "2026-10-28.endive";
// Stripe's libraries default to five minutes; a signed notice older (or
// newer) than this is refused, so a captured one cannot be replayed later.
export const SIGNATURE_TOLERANCE_S = 300;
// A notice is a few kilobytes; the cap keeps an unsigned post from making the
// Worker hold a large body before the signature is checked.
export const NOTICE_MAX_BYTES = 1024 * 1024;
const CALL_TIMEOUT_MS = 10_000;
// Checkout sessions are created under an Idempotency-Key naming the user, the
// choice (the plan, the interval and the page's language) and the ten
// minutes the request falls in: two checkouts of one choice started together
// (two tabs, a double click) get the one session Stripe made for the first,
// so they cannot start two subscriptions, and another choice (back from
// Stripe's page by its back link, then the other interval) starts its own.
// One still in flight at Stripe answers 409 and is asked again shortly;
// still in flight after that, or the same key with other details (Stripe's
// idempotency layer "compares incoming parameters to those of the original
// request and errors if they're not the same",
// docs.stripe.com/api/idempotent_requests), it is answered "busy".
export const CHECKOUT_WINDOW_MS = 10 * 60_000;
// How long a Checkout Session stays payable. Stripe's default is a day
// ("expires_at ... The Epoch time in seconds at which the Checkout Session
// will expire. It can be anywhere from 30 minutes to 24 hours after Checkout
// Session creation. By default, this value is 24 hours from creation",
// docs.stripe.com/api/checkout/sessions/create), which kept a first buyer's
// earlier open session payable for that long. The value sent is this long
// after the start of the ten minutes the session's idempotency key names, so
// 50 to 60 minutes after the session is made: two requests under one key
// must carry the same parameters (Stripe "compares incoming parameters to
// those of the original request and errors if they're not the same",
// docs.stripe.com/api/idempotent_requests), and a press repeated inside the
// ten minutes is given back the first session with its original expiry.
export const CHECKOUT_EXPIRES_MS = 60 * 60_000;
// A Checkout Session's id as Stripe gives it ("cs_test_..." or "cs_live_...";
// the retrieve call takes at most 66 characters).
export const SESSION_RE = /^cs_[A-Za-z0-9_]{1,63}$/;
// Open sessions of a returning customer read before one is expired: a
// customer has a session or two open at most.
const OPEN_READ = 10;
const IN_FLIGHT_TRIES = 3;
const IN_FLIGHT_WAIT_MS = 400;

// Where checkout and the portal live. The billing page's forms redirect
// there, so the page's Content-Security-Policy names them (billingFormAction);
// a session URL on any other host is refused rather than sent to a redirect
// the browser would block.
export const CHECKOUT_HOST = "checkout.stripe.com";
export const PORTAL_HOST = "billing.stripe.com";

const CHECKOUT_LOCALE: Record<Lang, string> = { en: "en", fr: "fr-CA" };
const PORTAL_LOCALE: Record<Lang, string> = { en: "en-CA", fr: "fr-CA" };

const PRICE_RE = /^price_[A-Za-z0-9]{1,100}$/;
const PRODUCT_RE = /^prod_[A-Za-z0-9]{1,100}$/;
// Whole dollars, or dollars and two digits of cents: the figure in Canadian
// dollars as the page prints it.
const FIGURE_RE = /^[0-9]{1,6}(\.[0-9]{2})?$/;
const USER_RE = /^[0-9a-f]{32}$/;
const ITEM_RE = /^si_[A-Za-z0-9_]{1,100}$/;

const set = (v: string | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function stripeKeys(env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SECRET">): { secretKey: string; webhookSecret: string } | null {
  const secretKey = set(env.STRIPE_SECRET_KEY);
  const webhookSecret = set(env.STRIPE_WEBHOOK_SECRET);
  return secretKey && webhookSecret ? { secretKey, webhookSecret } : null;
}

export type Offer = Record<Interval, { price: string; figure: string }>;
export type Offers = { pro: Offer | null; ultra: (Offer & { product: string }) | null };

function offerOf(monthlyPrice: string | undefined, monthlyFigure: string | undefined, yearlyPrice: string | undefined, yearlyFigure: string | undefined): Offer | null {
  const monthly = { price: set(monthlyPrice), figure: set(monthlyFigure) };
  const yearly = { price: set(yearlyPrice), figure: set(yearlyFigure) };
  for (const o of [monthly, yearly]) {
    if (!o.price || !PRICE_RE.test(o.price) || !o.figure || !FIGURE_RE.test(o.figure)) return null;
  }
  return { monthly: monthly as Offer["monthly"], yearly: yearly as Offer["yearly"] };
}

// Each plan's two prices. Pro's is null when any of its four values is
// missing or not in its expected form (the page then says Pro is not
// available yet rather than show a button without its price); Ultra's when
// any of its five is (the product id with them). The figures must match the
// prices in Stripe; nothing checks that.
export function stripeOffers(env: Env): Offers {
  const pro = offerOf(env.STRIPE_PRICE_MONTHLY, env.PRICE_MONTHLY_CAD, env.STRIPE_PRICE_YEARLY, env.PRICE_YEARLY_CAD);
  const product = set(env.STRIPE_PRODUCT_ULTRA);
  const ultra = product && PRODUCT_RE.test(product)
    ? offerOf(env.STRIPE_PRICE_ULTRA_MONTHLY, env.PRICE_ULTRA_MONTHLY_CAD, env.STRIPE_PRICE_ULTRA_YEARLY, env.PRICE_ULTRA_YEARLY_CAD)
    : null;
  return { pro, ultra: ultra && product ? { ...ultra, product } : null };
}

// Ultra's two figures alone, set and in form, whatever its product and price ids are: what Ultra will cost,
// for the landing page's card before Ultra is on sale. Nothing is offered for sale by them: an offer needs
// all five variables (stripeOffers above).
export function ultraFigures(env: Pick<Env, "PRICE_ULTRA_MONTHLY_CAD" | "PRICE_ULTRA_YEARLY_CAD">): Record<Interval, string> | null {
  const monthly = set(env.PRICE_ULTRA_MONTHLY_CAD);
  const yearly = set(env.PRICE_ULTRA_YEARLY_CAD);
  return monthly && yearly && FIGURE_RE.test(monthly) && FIGURE_RE.test(yearly) ? { monthly, yearly } : null;
}

// Pro's two prices, as before Ultra.
export function stripeOffer(env: Env): Offer | null {
  return stripeOffers(env).pro;
}

// -- which plan a subscription pays for ----------------------------------------------

// The ids that name Ultra: its product, and its two prices, each read on its
// own (a figure left out of form does not make a paid Ultra subscription read
// as Pro). Mapping by product keeps a subscriber on an older Ultra price on
// Ultra after a price change.
function ultraIds(env: Env): { product: string | null; prices: Set<string> } {
  const product = set(env.STRIPE_PRODUCT_ULTRA);
  const prices = [set(env.STRIPE_PRICE_ULTRA_MONTHLY), set(env.STRIPE_PRICE_ULTRA_YEARLY)]
    .filter((p): p is string => p !== null && PRICE_RE.test(p));
  return { product: product && PRODUCT_RE.test(product) ? product : null, prices: new Set(prices) };
}

const namesUltra = (ids: ReturnType<typeof ultraIds>, item: { price: string | null; product: string | null }): boolean =>
  (!!ids.product && item.product === ids.product) || (!!item.price && ids.prices.has(item.price));

// The plan a subscription pays for: Ultra when its one item is on the Ultra
// product (or one of the Ultra prices), else Pro, as before Ultra. A
// subscription with no item read, or several, is Pro: an unknown product
// never grants Ultra.
export function planOfSubscription(env: Env, s: Pick<SubscriptionState, "item">): "pro" | "ultra" {
  return s.item && namesUltra(ultraIds(env), s.item) ? "ultra" : "pro";
}

// Whether the subscription carries a pending update (a change Stripe applies
// only once its invoice is paid) that names Ultra: the change is not paid for
// yet, so a notice that sees it grants nothing and is answered 5xx.
export function pendingUltra(env: Env, s: Pick<SubscriptionState, "pending">): boolean {
  if (!s.pending) return false;
  const ids = ultraIds(env);
  return s.pending.some((item) => namesUltra(ids, item));
}

// The form-action directive of the Content-Security-Policy (index.tsx). Every
// page keeps 'self'; the billing pages, while the switch is on and the keys
// are set, also allow the two Stripe hosts, because a browser applies
// form-action to the redirect that follows a form post too.
export function billingFormAction(c: Context): string {
  const env = c.env as Env | undefined;
  if (env && c.req.path.startsWith("/account/billing") && accountsEnabled(env) && stripeKeys(env)) {
    return `'self' https://${CHECKOUT_HOST} https://${PORTAL_HOST}`;
  }
  return "'self'";
}

// -- the API ------------------------------------------------------------------------

// errorType: Stripe's error.type on a refusal (idempotency_error and the
// like), read for the caller and never logged.
type Call<T> = { ok: true; body: T } | { ok: false; status: number; errorType: string | null };

async function call<T>(
  key: string, method: "GET" | "POST" | "DELETE", path: string, label: string, form?: [string, string][], idempotencyKey?: string,
): Promise<Call<T>> {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, "stripe-version": STRIPE_VERSION };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  let body: string | undefined;
  if (form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(form).toString();
  }
  try {
    const res = await fetch(`${STRIPE_API}${path}`, { method, headers, body, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`stripe: ${label} answered ${res.status}`);
      const refusal = res.status === 400 || res.status === 409 ? await res.json().catch(() => null) : null;
      if (!refusal) await res.body?.cancel().catch(() => undefined);
      const type = obj(obj(refusal)?.error)?.type;
      return { ok: false, status: res.status, errorType: typeof type === "string" && /^[a-z_]{1,64}$/.test(type) ? type : null };
    }
    return { ok: true, body: (await res.json()) as T };
  } catch {
    console.error(`stripe: ${label} unreachable`);
    return { ok: false, status: 0, errorType: null };
  }
}

// A redirect target from Stripe, kept only when it is https on the host
// expected for it.
function onHost(url: unknown, host: string): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === host ? u.toString() : null;
  } catch {
    return null;
  }
}

// -- reading notices ---------------------------------------------------------------

type J = Record<string, unknown>;
const obj = (v: unknown): J | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as J) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 && v.length <= 255 ? v : null);
// An expandable field: an id, or the expanded object's id.
const idOf = (v: unknown): string | null => str(v) ?? str(obj(v)?.id);
const secs = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const listData = (v: unknown): J[] => {
  const d = obj(v)?.data;
  return Array.isArray(d) ? d.map(obj).filter((x): x is J => x !== null) : [];
};
const latest = (values: (number | null)[]): string | null => {
  const n = values.filter((v): v is number => v !== null);
  return n.length ? new Date(Math.max(...n) * 1000).toISOString() : null;
};
const userHint = (meta: unknown): string | null => {
  const u = str(obj(meta)?.user_id);
  return u && USER_RE.test(u) ? u : null;
};

// An item's price and its product (a string id, or the expanded object's).
const priceOf = (item: J): { price: string | null; product: string | null } => {
  const price = obj(item.price);
  return { price: str(price?.id) ?? str(item.price), product: idOf(price?.product) };
};

// A Subscription object. The period end is on each item in current
// versions and on the subscription itself in older ones; the latest wins.
// item: the subscription's one item (its id, price, product and the
// interval it bills at), null when it has none or several, which the site
// never makes. pending: the items of
// a pending update (pending_update.subscription_items), null when there is none.
//
// cancelAtPeriodEnd: the subscription ends when its current period does and
// is not charged again. Stripe sets it two ways. cancel_at_period_end is
// "Whether this subscription will (if status=active) or did (if
// status=canceled) cancel at the end of the current billing period";
// cancel_at is "A date in the future at which the subscription will
// automatically get canceled" (docs.stripe.com/api/subscriptions/object).
// The customer portal sets the first under classic billing mode and only the
// second under flexible billing mode, the default for subscriptions made
// through API versions from 2025-09-30.clover on, STRIPE_VERSION among them
// ("flexible billing mode uses cancel_at directly rather than
// cancel_at_period_end ... cancel_at_period_end is set to false and
// cancel_at is set to the maximum current_period_end across all subscription
// items", docs.stripe.com/billing/subscriptions/billing-mode/compare and
// docs.stripe.com/billing/subscriptions/billing-mode). So either the flag, or a
// cancel_at no later than the period's end, reads as the same thing. A
// cancel_at further off is not: the subscription renews into the period
// that holds it first ("the subscription's cycle remains unaffected until
// the subscription renews into the period that contains the cancel_at
// date", docs.stripe.com/billing/subscriptions/cancel), and its update
// notice then reads as ending.
export function readSubscription(o: J): SubscriptionState | null {
  const id = str(o.id);
  const customerId = idOf(o.customer);
  const status = str(o.status);
  if (!id || !customerId || !status) return null;
  const items = listData(o.items);
  const ends = [secs(o.current_period_end), ...items.map((i) => secs(i.current_period_end))].filter((v): v is number => v !== null);
  const periodEnd = latest(ends);
  const cancelAt = secs(o.cancel_at);
  const cancelAtPeriodEnd = o.cancel_at_period_end === true || (cancelAt !== null && ends.length > 0 && cancelAt <= Math.max(...ends));
  const only = items.length === 1 ? items[0] : null;
  const itemId = only ? str(only.id) : null;
  const every = only ? obj(obj(only.price)?.recurring)?.interval : null;
  const interval = every === "month" ? "monthly" : every === "year" ? "yearly" : null;
  const item = only && itemId && ITEM_RE.test(itemId) ? { id: itemId, interval, ...priceOf(only) } as const : null;
  const update = obj(o.pending_update);
  const pendingItems = update && Array.isArray(update.subscription_items) ? update.subscription_items.map(obj).filter((x): x is J => x !== null) : [];
  const pending = update ? pendingItems.map(priceOf) : null;
  return { id, customerId, status, periodEnd, userId: userHint(o.metadata), item, pending, createdAt: isoOf(o.created), cancelAtPeriodEnd };
}

function isoOf(v: unknown): string | null {
  const s = secs(v);
  return s === null ? null : new Date(s * 1000).toISOString();
}

function readCheckout(o: J): Notice {
  const userId = str(o.client_reference_id);
  const customerId = idOf(o.customer);
  const subscriptionId = idOf(o.subscription);
  if (o.mode !== "subscription" || !userId || !USER_RE.test(userId) || !customerId || !subscriptionId) return { kind: "other" };
  // An unpaid session (a bank debit still clearing) binds the customer and
  // grants nothing; the invoice.paid that follows grants. invoiceId: "ID of
  // the invoice created by the Checkout Session, if it exists"
  // (docs.stripe.com/api/checkout/sessions/object), the payment a deleted
  // account's refund looks for (billing.tsx cancelForDeleted).
  const paid = o.payment_status === "paid" || o.payment_status === "no_payment_required";
  return { kind: "checkout", userId, customerId, subscriptionId, paid, createdAt: isoOf(o.created), invoiceId: idOf(o.invoice) };
}

// An Invoice: the subscription under parent.subscription_details in current
// versions, at the top in older ones; the service period from its lines,
// since the invoice's own period_end is not the subscription's.
function readInvoice(o: J): Notice {
  const parent = obj(obj(o.parent)?.subscription_details);
  const subscriptionId = idOf(parent?.subscription) ?? idOf(o.subscription);
  const customerId = idOf(o.customer);
  if (!subscriptionId || !customerId) return { kind: "other" };
  const lines = listData(o.lines);
  const userId = userHint(parent?.metadata) ?? userHint(obj(o.subscription_details)?.metadata) ??
    lines.map((l) => userHint(l.metadata)).find((u) => u !== null) ?? null;
  const periodEnd = latest(lines.map((l) => secs(obj(l.period)?.end)));
  // The charge that paid it: named on the invoice in older versions, in its
  // payments list when Stripe includes it; often neither in current ones,
  // where the time it was paid stands in (billing.tsx, reversed).
  const chargeId = idOf(o.charge) ?? listData(o.payments).map((p) => idOf(obj(p.payment)?.charge)).find((c) => c !== null) ?? null;
  const paidAt = isoOf(obj(o.status_transitions)?.paid_at);
  return { kind: "period_paid", subscriptionId, customerId, userId, periodEnd, chargeId, paidAt, invoiceId: str(o.id) };
}

// A Charge refunded in full: refunded true, or the amount refunded reaching
// the amount charged. A partial refund changes nothing. The charge names its
// customer; it no longer names its invoice in current versions. at is the
// event's own time (below).
function readRefund(o: J, at: string | null): Notice {
  const chargeId = str(o.id);
  const amount = typeof o.amount === "number" ? o.amount : null;
  const back = typeof o.amount_refunded === "number" ? o.amount_refunded : null;
  const full = o.refunded === true || (amount !== null && amount > 0 && back !== null && back >= amount);
  if (!chargeId || !full) return { kind: "other" };
  return { kind: "reversed", chargeId, customerId: idOf(o.customer), why: "refunded", ...(at ? { at } : {}) };
}

// A Dispute names its charge but not the customer, which billing.tsx reads
// from the charge.
function readDispute(o: J, at: string | null): Notice {
  const chargeId = idOf(o.charge);
  return chargeId ? { kind: "reversed", chargeId, customerId: null, why: "disputed", ...(at ? { at } : {}) } : { kind: "other" };
}

// refund.failed, whose object is the Refund (docs.stripe.com/api/events/types:
// "Occurs whenever a refund has failed"): its charge and its customer, both
// nullable on a Refund, and its failure_reason, one of Stripe's fixed words
// (lost_or_stolen_card, expired_or_canceled_card, insufficient_funds and so
// on; docs.stripe.com/api/refunds/object). A refund naming neither a charge
// nor a customer cannot be tied to an account.
const REASON_RE = /^[a-z_]{1,40}$/;
function readRefundFailed(o: J): Notice {
  const chargeId = idOf(o.charge);
  const customerId = idOf(o.customer);
  const reason = str(o.failure_reason);
  if (!chargeId && !customerId) return { kind: "other" };
  return { kind: "refund_failed", chargeId, refundId: str(o.id), customerId, reason: reason && REASON_RE.test(reason) ? reason : "unknown" };
}

// The event's own created time, ISO: "Time at which the object was created.
// Measured in seconds since the Unix epoch" (docs.stripe.com/api/events/object).
// It is when the refund or dispute happened, whenever the notice is taken;
// Stripe keeps it whole seconds, and "doesn't guarantee the delivery of
// events in the order that they're generated" (docs.stripe.com/webhooks), so
// it is read as that moment and never as an order of notices.
export function readEvent(event: unknown): NoticeResult {
  const e = obj(event);
  const id = str(e?.id);
  const type = str(e?.type);
  if (!e || !id || !/^evt_[A-Za-z0-9_]+$/.test(id) || !type) return { ok: false, why: "unreadable" };
  const o = obj(obj(e.data)?.object);
  const at = isoOf(e.created);
  let notice: Notice = { kind: "other" };
  if (o) {
    if (type === "checkout.session.completed") notice = readCheckout(o);
    else if (type === "invoice.paid") notice = readInvoice(o);
    else if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      const subscription = readSubscription(o);
      if (subscription) notice = { kind: "subscription", subscription, deleted: type === "customer.subscription.deleted" };
    } else if (type === "charge.refunded") notice = readRefund(o, at);
    else if (type === "charge.dispute.created") notice = readDispute(o, at);
    else if (type === "refund.failed") notice = readRefundFailed(o);
  }
  return { ok: true, id, type, notice };
}

// -- the signature ----------------------------------------------------------------

const encoder = new TextEncoder();

// The Stripe-Signature header: "t=<unix seconds>,v1=<hex>[,v1=<hex>...]",
// with a v0 on test events that is ignored, as is every scheme but v1. The
// signed bytes are "<t>." followed by the raw body; the key is the
// endpoint's secret as written (whsec_...). Each v1 is compared in constant
// time, all of them every time; while a secret is being rolled there is one
// per secret.
export async function signatureValid(
  body: Uint8Array, header: string | null | undefined, secret: string, nowSeconds: number, tolerance = SIGNATURE_TOLERANCE_S,
): Promise<boolean> {
  return (await signatureCheck(body, header, secret, nowSeconds, tolerance)) === "ok";
}

// The same checks in the same order, answering which one refused, for the
// webhook's log line (payments.ts NoticeRefusal); "ok" exactly when
// signatureValid is true.
export type SignatureCheck = "ok" | "no_signature" | "bad_header" | "stale" | "bad_signature";

export async function signatureCheck(
  body: Uint8Array, header: string | null | undefined, secret: string, nowSeconds: number, tolerance = SIGNATURE_TOLERANCE_S,
): Promise<SignatureCheck> {
  if (!header) return "no_signature";
  // Nothing can match without a secret (the source is never made without one).
  if (!secret) return "bad_signature";
  let t: string | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const at = part.indexOf("=");
    if (at < 1) continue;
    const name = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (name === "t") t = value;
    else if (name === "v1") v1.push(value.toLowerCase());
  }
  if (!t || !/^[0-9]{1,12}$/.test(t) || !v1.length) return "bad_header";
  if (Math.abs(nowSeconds - Number(t)) > tolerance) return "stale";
  const prefix = encoder.encode(`${t}.`);
  const signed = new Uint8Array(prefix.byteLength + body.byteLength);
  signed.set(prefix, 0);
  signed.set(body, prefix.byteLength);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, signed));
  let match = false;
  for (const s of v1) match = sameHash(s, expected) || match;
  return match ? "ok" : "bad_signature";
}

// The body as sent, up to the cap; null past it.
export async function rawBody(request: Request, max = NOTICE_MAX_BYTES): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

// -- the source ---------------------------------------------------------------------

export function stripeSource(env: Env): PaymentSource | null {
  const keys = stripeKeys(env);
  if (!keys) return null;
  const offers = stripeOffers(env);
  const offer = offers.pro;
  const key = keys.secretKey;

  async function subscription(id: string): Promise<ReadSubscription> {
    const res = await call<J>(key, "GET", `/subscriptions/${encodeURIComponent(id)}`, "subscription read");
    if (!res.ok) return res.status === 404 ? "missing" : null;
    return readSubscription(res.body);
  }

  return {
    kind: "stripe",
    available: () => offer !== null,
    offer: () => (offer ? { monthly: offer.monthly.figure, yearly: offer.yearly.figure } : null),
    offerFor: (plan) => {
      const o = offers[plan];
      return o ? { monthly: o.monthly.figure, yearly: o.yearly.figure } : null;
    },
    priceFor: (plan, interval) => offers[plan]?.[interval].price ?? null,

    // A Checkout Session in subscription mode for the chosen price. The
    // user id rides as client_reference_id (checkout.session.completed) and
    // in the subscription's metadata (every later invoice and subscription
    // notice), so a notice that arrives before the checkout's still finds
    // its user. The account sells under Managed Payments, which applies to
    // a session only when the request asks for it (a session without the
    // flag is sold by the account itself, with no tax collected): the flag
    // goes on every request. The service then computes and collects the tax
    // from the address Checkout asks for, so automatic_tax and
    // customer_update[address], which it lists among the parameters it has
    // no use for, are not sent.
    async checkoutUrl(input: CheckoutInput): Promise<string | null | "busy"> {
      const chosen = offers[input.plan];
      if (!offer || !chosen) return null;
      const form: [string, string][] = [
        ["mode", "subscription"],
        ["line_items[0][price]", chosen[input.interval].price],
        ["line_items[0][quantity]", "1"],
        ["client_reference_id", input.userId],
        ["subscription_data[metadata][user_id]", input.userId],
        ["managed_payments[enabled]", "true"],
        ["success_url", input.successUrl],
        ["cancel_url", input.cancelUrl],
        ["locale", CHECKOUT_LOCALE[input.lang]],
      ];
      if (input.customerId) form.push(["customer", input.customerId]);
      else form.push(["customer_email", input.email]);
      // The ten minutes the request falls in name the key and set the expiry (CHECKOUT_EXPIRES_MS).
      const slot = Math.floor(Date.now() / CHECKOUT_WINDOW_MS);
      form.push(["expires_at", String(Math.floor((slot * CHECKOUT_WINDOW_MS + CHECKOUT_EXPIRES_MS) / 1000))]);
      const idempotencyKey = `checkout-${input.userId}-${input.plan}-${input.interval}-${input.lang}-${slot}`;
      let res = await call<J>(key, "POST", "/checkout/sessions", "checkout session", form, idempotencyKey);
      for (let tries = 1; !res.ok && res.status === 409 && tries < IN_FLIGHT_TRIES; tries++) {
        await new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_WAIT_MS));
        res = await call<J>(key, "POST", "/checkout/sessions", "checkout session", form, idempotencyKey);
      }
      if (!res.ok) return res.errorType === "idempotency_error" ? "busy" : null;
      const url = onHost(res.body.url, CHECKOUT_HOST);
      if (!url || !input.customerId) return url;
      // A returning customer's other open sessions (another choice left by
      // Stripe's back link) are expired before the reader is sent on, so
      // only this one can be paid. Sessions are listed by the customer
      // they were made for ("Only return the Checkout Sessions for the
      // Customer specified", status "open": "Payment processing has not
      // started", docs.stripe.com/api/checkout/sessions/list) and expired
      // by POST .../expire ("A Checkout Session can be expired when it is in
      // one of these statuses: open. After it expires, a customer can't
      // complete a Checkout Session", docs.stripe.com/api/checkout/sessions/expire).
      // The session just made (or given back under the key) is kept, so the
      // same choice pressed twice keeps its one session. A first checkout
      // names no customer, and a session made with customer_email has none
      // until it completes ("Checkout will create a new customer object
      // based on information provided during the payment flow",
      // docs.stripe.com/api/checkout/sessions/object), so a first buyer's
      // open session cannot be found this way; its key keeps two of one
      // choice to one, and its own expires_at ends it within the hour
      // (CHECKOUT_EXPIRES_MS). A list that cannot be read leaves the others
      // as they are; an expiry Stripe refuses sends the reader nowhere.
      const own = str(res.body.id);
      const query = new URLSearchParams([["customer", input.customerId], ["status", "open"], ["limit", String(OPEN_READ)]]);
      const open = await call<J>(key, "GET", `/checkout/sessions?${query}`, "checkout session list");
      if (!open.ok) return url;
      for (const s of listData(open.body)) {
        const id = str(s.id);
        if (!id || id === own || s.status !== "open" || !SESSION_RE.test(id)) continue;
        const ended = await call<J>(key, "POST", `/checkout/sessions/${encodeURIComponent(id)}/expire`, "checkout session expire");
        if (!ended.ok) return null;
      }
      return url;
    },

    async checkoutSession(id: string): Promise<CheckoutSession | "missing" | null> {
      if (!SESSION_RE.test(id)) return "missing";
      const res = await call<J>(key, "GET", `/checkout/sessions/${encodeURIComponent(id)}`, "checkout session read");
      if (!res.ok) return res.status === 404 ? "missing" : null;
      const o = res.body;
      const userId = str(o.client_reference_id);
      return {
        userId: userId && USER_RE.test(userId) ? userId : null,
        customerId: o.mode === "subscription" ? idOf(o.customer) : null,
        subscriptionId: o.mode === "subscription" ? idOf(o.subscription) : null,
        complete: o.status === "complete",
      };
    },

    // The portal for the stored customer. With a flow, the session opens at
    // one change of the subscription's one item (flow_data of type
    // subscription_update_confirm: the subscription, the item and the price
    // to move it to), where Stripe's page shows the amount due before the
    // reader confirms and handles the card's authentication, then returns to
    // the flow's own address. Stripe refuses such a session (a 4xx) when the
    // portal's configuration does not list the price, or the subscription
    // cannot take the change; the plain portal is then opened in its place,
    // so the reader is never left on an error.
    async portalUrl(input: PortalInput): Promise<string | null> {
      const base: [string, string][] = [
        ["customer", input.customerId],
        ["return_url", input.returnUrl],
        ["locale", PORTAL_LOCALE[input.lang]],
      ];
      if (input.flow) {
        const f = input.flow;
        const res = await call<J>(key, "POST", "/billing_portal/sessions", "portal flow session", [
          ...base,
          ["flow_data[type]", "subscription_update_confirm"],
          ["flow_data[subscription_update_confirm][subscription]", f.subscriptionId],
          ["flow_data[subscription_update_confirm][items][0][id]", f.itemId],
          ["flow_data[subscription_update_confirm][items][0][price]", f.priceId],
          ["flow_data[subscription_update_confirm][items][0][quantity]", "1"],
          ["flow_data[after_completion][type]", "redirect"],
          ["flow_data[after_completion][redirect][return_url]", f.doneUrl],
        ]);
        if (res.ok) return onHost(res.body.url, PORTAL_HOST);
        if (res.status < 400 || res.status >= 500) return null;
      }
      const res = await call<J>(key, "POST", "/billing_portal/sessions", "portal session", base);
      return res.ok ? onHost(res.body.url, PORTAL_HOST) : null;
    },

    async readNotice(request: Request, now: Date = new Date()): Promise<NoticeResult> {
      const body = await rawBody(request);
      if (!body) return { ok: false, why: "too_large" };
      const signature = request.headers.get("stripe-signature");
      const check = await signatureCheck(body, signature, keys.webhookSecret, Math.floor(now.getTime() / 1000));
      if (check !== "ok") return { ok: false, why: check };
      try {
        return readEvent(JSON.parse(new TextDecoder().decode(body)));
      } catch {
        return { ok: false, why: "unreadable" };
      }
    },

    subscription,

    async chargeCustomer(id: string): Promise<string | "missing" | null> {
      const res = await call<J>(key, "GET", `/charges/${encodeURIComponent(id)}`, "charge read");
      if (!res.ok) return res.status === 404 ? "missing" : null;
      return idOf(res.body.customer) ?? "missing";
    },

    // An immediate cancellation: no further charge, no refund (Stripe
    // prorates nothing unless asked). When the call fails, the subscription
    // is read: one already ended, or unknown to Stripe, counts as cancelled.
    async cancel(id: string): Promise<boolean> {
      const res = await call<J>(key, "DELETE", `/subscriptions/${encodeURIComponent(id)}`, "subscription cancel");
      if (res.ok || res.status === 404) return true;
      const state = await subscription(id);
      return state === "missing" || (state !== null && (state.status === "canceled" || state.status === "incomplete_expired"));
    },
  };
}
