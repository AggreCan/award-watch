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
  CheckoutInput, Interval, Notice, NoticeResult, PaymentSource, PortalInput, ReadSubscription, SubscriptionState,
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
// Checkout sessions are created under an Idempotency-Key naming the user and
// the ten minutes the request falls in: two checkouts started together (two
// tabs, a double click) get the one session Stripe made for the first, so
// they cannot start two subscriptions. A second request in the same minutes
// with other parameters (the other interval, the other language) is refused
// by Stripe and answered "busy"; one still in flight at Stripe answers 409
// and is asked again shortly.
export const CHECKOUT_WINDOW_MS = 10 * 60_000;
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
export function readSubscription(o: J): SubscriptionState | null {
  const id = str(o.id);
  const customerId = idOf(o.customer);
  const status = str(o.status);
  if (!id || !customerId || !status) return null;
  const items = listData(o.items);
  const periodEnd = latest([secs(o.current_period_end), ...items.map((i) => secs(i.current_period_end))]);
  const only = items.length === 1 ? items[0] : null;
  const itemId = only ? str(only.id) : null;
  const every = only ? obj(obj(only.price)?.recurring)?.interval : null;
  const interval = every === "month" ? "monthly" : every === "year" ? "yearly" : null;
  const item = only && itemId && ITEM_RE.test(itemId) ? { id: itemId, interval, ...priceOf(only) } as const : null;
  const update = obj(o.pending_update);
  const pendingItems = update && Array.isArray(update.subscription_items) ? update.subscription_items.map(obj).filter((x): x is J => x !== null) : [];
  const pending = update ? pendingItems.map(priceOf) : null;
  return { id, customerId, status, periodEnd, userId: userHint(o.metadata), item, pending };
}

const isoOf = (v: unknown): string | null => {
  const s = secs(v);
  return s === null ? null : new Date(s * 1000).toISOString();
};

function readCheckout(o: J): Notice {
  const userId = str(o.client_reference_id);
  const customerId = idOf(o.customer);
  const subscriptionId = idOf(o.subscription);
  if (o.mode !== "subscription" || !userId || !USER_RE.test(userId) || !customerId || !subscriptionId) return { kind: "other" };
  // An unpaid session (a bank debit still clearing) binds the customer and
  // grants nothing; the invoice.paid that follows grants.
  const paid = o.payment_status === "paid" || o.payment_status === "no_payment_required";
  return { kind: "checkout", userId, customerId, subscriptionId, paid, createdAt: isoOf(o.created) };
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
  return { kind: "period_paid", subscriptionId, customerId, userId, periodEnd, chargeId, paidAt };
}

// A Charge refunded in full: refunded true, or the amount refunded reaching
// the amount charged. A partial refund changes nothing. The charge names its
// customer; it no longer names its invoice in current versions.
function readRefund(o: J): Notice {
  const chargeId = str(o.id);
  const amount = typeof o.amount === "number" ? o.amount : null;
  const back = typeof o.amount_refunded === "number" ? o.amount_refunded : null;
  const full = o.refunded === true || (amount !== null && amount > 0 && back !== null && back >= amount);
  if (!chargeId || !full) return { kind: "other" };
  return { kind: "reversed", chargeId, customerId: idOf(o.customer), why: "refunded" };
}

// A Dispute names its charge but not the customer, which billing.tsx reads
// from the charge.
function readDispute(o: J): Notice {
  const chargeId = idOf(o.charge);
  return chargeId ? { kind: "reversed", chargeId, customerId: null, why: "disputed" } : { kind: "other" };
}

export function readEvent(event: unknown): NoticeResult {
  const e = obj(event);
  const id = str(e?.id);
  const type = str(e?.type);
  if (!e || !id || !/^evt_[A-Za-z0-9_]+$/.test(id) || !type) return { ok: false };
  const o = obj(obj(e.data)?.object);
  let notice: Notice = { kind: "other" };
  if (o) {
    if (type === "checkout.session.completed") notice = readCheckout(o);
    else if (type === "invoice.paid") notice = readInvoice(o);
    else if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      const subscription = readSubscription(o);
      if (subscription) notice = { kind: "subscription", subscription, deleted: type === "customer.subscription.deleted" };
    } else if (type === "charge.refunded") notice = readRefund(o);
    else if (type === "charge.dispute.created") notice = readDispute(o);
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
  if (!header || !secret) return false;
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
  if (!t || !/^[0-9]{1,12}$/.test(t) || !v1.length) return false;
  if (Math.abs(nowSeconds - Number(t)) > tolerance) return false;
  const prefix = encoder.encode(`${t}.`);
  const signed = new Uint8Array(prefix.byteLength + body.byteLength);
  signed.set(prefix, 0);
  signed.set(body, prefix.byteLength);
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, signed));
  let match = false;
  for (const s of v1) match = sameHash(s, expected) || match;
  return match;
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
      const idempotencyKey = `checkout-${input.userId}-${Math.floor(Date.now() / CHECKOUT_WINDOW_MS)}`;
      let res = await call<J>(key, "POST", "/checkout/sessions", "checkout session", form, idempotencyKey);
      for (let tries = 1; !res.ok && res.status === 409 && tries < IN_FLIGHT_TRIES; tries++) {
        await new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_WAIT_MS));
        res = await call<J>(key, "POST", "/checkout/sessions", "checkout session", form, idempotencyKey);
      }
      if (!res.ok) return res.errorType === "idempotency_error" ? "busy" : null;
      return onHost(res.body.url, CHECKOUT_HOST);
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
      if (!body) return { ok: false };
      const signature = request.headers.get("stripe-signature");
      if (!(await signatureValid(body, signature, keys.webhookSecret, Math.floor(now.getTime() / 1000)))) return { ok: false };
      try {
        return readEvent(JSON.parse(new TextDecoder().decode(body)));
      } catch {
        return { ok: false };
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
