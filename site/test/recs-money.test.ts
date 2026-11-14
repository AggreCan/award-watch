// Three approved changes to the money path after the hardening pass of
// 2026-11-14, one describe each: a payment that lands on a deleted account
// is refunded; a Checkout Session expires an hour after it is made; a
// cancellation set in Stripe's portal shows on the site. Stripe is a fake
// fetch answering from tables (subscriptions, invoices, charges, checkout
// sessions, refunds) under Stripe's documented idempotency (the first
// answer under a key, a 500 included, is given again to the same request;
// the same key with other parameters is an idempotency_error), as the
// other money files fake it; notices are signed here with WebCrypto.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refundKey } from "../src/account/admin_stripe";
import { STRIPE_VERSION } from "../src/account/stripe";
import { app } from "../src/index";
import { collectAlerts, gatherInputs } from "../src/watchdog";
import { testEnv } from "./assets";
import {
  ACCOUNTS, PRO_SALE, csrf, decode, get, nbsp, newEmail, nextIp, onEnv, post, signIn, ultraEnv, useAccountsDb, userId,
} from "./accounts-helpers";

useAccountsDb();

const payEnv = (extra: Record<string, unknown> = {}) => onEnv({ ...PRO_SALE, ...extra });
const watchEnv = () => ({ ...testEnv(), ACCOUNTS, SEARCH: undefined }) as never;

const DAY_S = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const fr = (html: string) => nbsp(html).replace(/&#39;|’/g, "'");

// -- Stripe, faked -----------------------------------------------------------------------

type Obj = Record<string, unknown>;
type Reply = { status?: number; body?: unknown };
type Sent = { method: string; url: URL; form: URLSearchParams; idempotencyKey: string | null };

let sent: Sent[] = [];
let subs = new Map<string, Obj>();
let invoices = new Map<string, Obj>();
let charges = new Map<string, Obj>();
let sessions = new Map<string, Obj>();
let made = 0;
let failing = new Set<string>();
let keyed = new Map<string, { form: string; reply: Reply }>();
// Refunds the fake made, by charge; a refund taken whose answer is lost (500);
// a refusal Stripe gives to the next refunds asked.
let refundsMade: string[] = [];
let lostAnswer = false;
let refusal: { status: number; type: string; code?: string } | null = null;

const routeOf = (method: string, path: string) => `${method} ${path.replace(/\/(sub|ch|cs|in)_[A-Za-z0-9_]+/, "/:id")}`;
const subOf = (i: Obj) => ((i.parent as Obj | undefined)?.subscription_details as Obj | undefined)?.subscription;

function answer(method: string, url: URL, form: URLSearchParams): Reply {
  const route = routeOf(method, url.pathname);
  const id = url.pathname.split("/")[route.includes("/checkout/") ? 4 : 3] ?? "";
  if (failing.has(route)) return { status: 500, body: { error: { type: "api_error", message: "down" } } };
  if (route === "POST /v1/checkout/sessions") {
    made++;
    const session: Obj = {
      id: `cs_r${made}`, object: "checkout.session", mode: "subscription", status: "open", payment_status: "unpaid",
      client_reference_id: form.get("client_reference_id"), customer: form.get("customer"), subscription: null,
      expires_at: form.get("expires_at") ? Number(form.get("expires_at")) : nowS() + DAY_S,
      url: `https://checkout.stripe.com/c/pay/cs_r${made}`, created: nowS(),
    };
    sessions.set(session.id as string, session);
    return { body: session };
  }
  if (route === "GET /v1/checkout/sessions") {
    const cus = url.searchParams.get("customer");
    const data = [...sessions.values()].filter((s) => (!cus || s.customer === cus) && s.status === (url.searchParams.get("status") ?? s.status));
    return { body: { object: "list", data, has_more: false } };
  }
  if (route === "POST /v1/checkout/sessions/:id/expire") {
    const s = sessions.get(id);
    if (!s || s.status !== "open") return { status: 400, body: { error: { type: "invalid_request_error" } } };
    s.status = "expired";
    return { body: s };
  }
  if (route === "POST /v1/billing_portal/sessions") return { body: { id: "bps_r", url: "https://billing.stripe.com/p/session/r" } };
  if (route === "GET /v1/subscriptions/:id") return subs.has(id) ? { body: subs.get(id) } : { status: 404, body: {} };
  if (route === "DELETE /v1/subscriptions/:id") {
    const s = subs.get(id);
    if (!s) return { status: 404, body: {} };
    if (s.status === "canceled") return { status: 400, body: { error: { type: "invalid_request_error" } } };
    s.status = "canceled";
    return { body: s };
  }
  if (route === "GET /v1/invoices/:id") return invoices.has(id) ? { body: invoices.get(id) } : { status: 404, body: {} };
  if (route === "GET /v1/invoices") {
    const sub = url.searchParams.get("subscription");
    const cus = url.searchParams.get("customer");
    const data = [...invoices.values()].filter((i) => (!sub || subOf(i) === sub) && (!cus || i.customer === cus))
      .sort((a, b) => (b.created as number) - (a.created as number));
    return { body: { object: "list", data, has_more: false } };
  }
  if (route === "GET /v1/charges/:id") return charges.has(id) ? { body: charges.get(id) } : { status: 404, body: {} };
  if (route === "GET /v1/charges") {
    const pi = url.searchParams.get("payment_intent");
    return { body: { object: "list", data: [...charges.values()].filter((c) => !pi || c.payment_intent === pi), has_more: false } };
  }
  if (route === "POST /v1/refunds") {
    if (refusal) return { status: refusal.status, body: { error: { type: refusal.type, ...(refusal.code ? { code: refusal.code } : {}) } } };
    const ch = charges.get(form.get("charge") ?? "");
    if (!ch) return { status: 400, body: { error: { type: "invalid_request_error", code: "resource_missing" } } };
    if (ch.disputed === true) return { status: 400, body: { error: { type: "invalid_request_error", code: "charge_disputed" } } };
    if ((ch.amount_refunded as number) >= (ch.amount as number)) {
      return { status: 400, body: { error: { type: "invalid_request_error", code: "charge_already_refunded" } } };
    }
    ch.amount_refunded = ch.amount;
    ch.refunded = true;
    refundsMade.push(ch.id as string);
    if (lostAnswer) return { status: 500, body: { error: { type: "api_error", message: "lost" } } };
    return { body: { id: `re_${ch.id}`, object: "refund", status: "succeeded", charge: ch.id } };
  }
  return { status: 400, body: { error: { message: `unexpected ${route}` } } };
}

// Every console line the code under test wrote in the current test.
let logged: string[] = [];

beforeEach(() => {
  sent = [];
  subs = new Map();
  invoices = new Map();
  charges = new Map();
  sessions = new Map();
  made = 0;
  failing = new Set();
  keyed = new Map();
  refundsMade = [];
  lostAnswer = false;
  refusal = null;
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname !== "api.stripe.com") return real(input, init);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const idempotencyKey = headers["idempotency-key"] ?? null;
    const body = typeof init?.body === "string" ? init.body : "";
    const form = new URLSearchParams(body);
    sent.push({ method, url, form, idempotencyKey });
    let reply: Reply;
    const kept = idempotencyKey ? keyed.get(idempotencyKey) : undefined;
    if (kept && kept.form !== body) {
      reply = { status: 400, body: { error: { type: "idempotency_error", message: "other parameters" } } };
    } else if (kept) {
      reply = kept.reply;
    } else {
      reply = answer(method, url, form);
      if (idempotencyKey) keyed.set(idempotencyKey, { form: body, reply });
    }
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  });
  logged = [];
  for (const m of ["log", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function subscriptionObject(
  id: string, customer: string, status: string, periodEnd: number, user: string | null, o: { cancelAtPeriodEnd?: boolean; cancelAt?: number | null } = {},
) {
  return {
    id, object: "subscription", customer, status, created: nowS() - 60,
    cancel_at_period_end: o.cancelAtPeriodEnd ?? false, cancel_at: o.cancelAt ?? null,
    items: {
      object: "list",
      data: [{
        id: `si_${id}`, object: "subscription_item", current_period_end: periodEnd, quantity: 1,
        price: { id: PRO_SALE.STRIPE_PRICE_MONTHLY, object: "price", product: "prod_proTEST", recurring: { interval: "month", interval_count: 1 } },
      }],
    },
    metadata: user ? { user_id: user } : {},
  };
}

// A paid invoice of the subscription and the charge behind it, as Stripe
// holds them in current API versions: the charge reached through the
// invoice's payments and its PaymentIntent.
function payment(sub: string, cus: string, o: { disputed?: boolean } = {}) {
  const id = `${sub.slice(4)}`;
  const created = nowS() - 30;
  invoices.set(`in_${id}`, {
    id: `in_${id}`, object: "invoice", customer: cus, status: "paid", amount_paid: 1900, currency: "cad", created,
    parent: { type: "subscription_details", subscription_details: { subscription: sub } },
    payments: { object: "list", data: [{ id: `inpay_${id}`, status: "paid", payment: { type: "payment_intent", payment_intent: `pi_${id}` } }] },
  });
  charges.set(`ch_${id}`, {
    id: `ch_${id}`, object: "charge", customer: cus, payment_intent: `pi_${id}`, amount: 1900, amount_refunded: 0, refunded: false,
    currency: "cad", status: "succeeded", paid: true, created, disputed: o.disputed ?? false,
  });
  return { invoice: `in_${id}`, charge: `ch_${id}` };
}

// -- notices ---------------------------------------------------------------------------

const enc = new TextEncoder();
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let n = 0;
const tag = () => `${Date.now().toString(36)}${n++}`;
const ids = () => {
  const t = tag();
  return { sub: `sub_r${t}`, cus: `cus_r${t}` };
};
const event = (type: string, object: object) => ({ id: `evt_r${tag()}`, object: "event", type, api_version: STRIPE_VERSION, created: nowS(), data: { object } });

async function deliver(e: object, env: object = payEnv()): Promise<Response> {
  const body = JSON.stringify(e);
  const t = nowS();
  return app.request("/account/billing/webhook", {
    method: "POST", body,
    headers: { "content-type": "application/json", "cf-connecting-ip": nextIp(), "stripe-signature": `t=${t},v1=${await hmacHex(PRO_SALE.STRIPE_WEBHOOK_SECRET, `${t}.${body}`)}` },
  }, env);
}

const checkoutCompleted = (user: string, sub: string, cus: string, o: { invoice?: string; paid?: boolean } = {}) => event("checkout.session.completed", {
  id: `cs_${sub}`, object: "checkout.session", mode: "subscription", client_reference_id: user, customer: cus, subscription: sub,
  payment_status: o.paid === false ? "unpaid" : "paid", status: "complete", created: nowS() - 60, ...(o.invoice ? { invoice: o.invoice } : {}),
});
// A snapshot invoice.paid: current API versions leave the invoice's payments out unless asked for.
const invoicePaid = (sub: string, cus: string, periodEnd: number, user: string | null, invoice = `in_${sub}_${periodEnd}`) => event("invoice.paid", {
  id: invoice, object: "invoice", customer: cus, status: "paid", status_transitions: { paid_at: nowS() - 30 },
  parent: { type: "subscription_details", subscription_details: { subscription: sub, metadata: user ? { user_id: user } : {} } },
  lines: { object: "list", data: [{ id: "il_1", object: "line_item", period: { start: periodEnd - 30 * DAY_S, end: periodEnd } }] },
});
const updated = (s: object, type: "updated" | "deleted" = "updated") => event(`customer.subscription.${type}`, s);
const chargeRefunded = (ch: string, cus: string) => event("charge.refunded", {
  id: ch, object: "charge", customer: cus, amount: 1900, amount_refunded: 1900, refunded: true, currency: "cad",
});
const refundFailed = (ch: string) => event("refund.failed", {
  id: `re_${ch}`, object: "refund", amount: 1900, currency: "cad", charge: ch, status: "failed", failure_reason: "expired_or_canceled_card",
});

// -- the accounts --------------------------------------------------------------------------

async function buyer(label: string, env = payEnv()) {
  const email = newEmail(label);
  const cookie = await signIn(email, { env });
  return { email, cookie, user: await userId(email), token: await csrf(cookie, "/account/billing", { env }) };
}

async function subscriber(label: string, o: { periodEnd?: number } = {}) {
  const b = await buyer(label);
  const { sub, cus } = ids();
  const periodEnd = o.periodEnd ?? nowS() + 30 * DAY_S;
  subs.set(sub, subscriptionObject(sub, cus, "active", periodEnd, b.user));
  expect((await deliver(checkoutCompleted(b.user, sub, cus))).status).toBe(200);
  return { ...b, sub, cus, periodEnd };
}

// A reader who deleted the account while Stripe's page was open (or before
// the payment's notices landed), with the payment Stripe took.
async function deletedPayer(label: string, o: { disputed?: boolean } = {}) {
  const b = await buyer(label);
  const { sub, cus } = ids();
  const periodEnd = nowS() + 30 * DAY_S;
  subs.set(sub, subscriptionObject(sub, cus, "active", periodEnd, b.user));
  const p = payment(sub, cus, o);
  const res = await post("/account/delete", { csrf: await csrf(b.cookie, "/account", { env: payEnv() }), confirm: "yes" }, { cookie: b.cookie, env: payEnv() });
  expect(res.status).toBe(200);
  sent = [];
  return { ...b, sub, cus, periodEnd, ...p };
}

const checkout = (b: { cookie: string; token: string }, interval: string, o: { lang?: string; plan?: string; env?: object } = {}) =>
  post("/account/billing/checkout", { csrf: b.token, interval, lang: o.lang ?? "en", ...(o.plan ? { plan: o.plan } : {}) }, { cookie: b.cookie, env: o.env ?? payEnv() });

const stripeRows = async (user: string) =>
  ((await ACCOUNTS.prepare("SELECT reference FROM entitlements WHERE user_id = ? AND source = 'stripe'").bind(user).all()).results ?? []);
const binding = (user: string) =>
  ACCOUNTS.prepare("SELECT customer_id, subscription_id, status FROM payment_customers WHERE user_id = ?").bind(user).first();
const flagOf = async (user: string) =>
  (await ACCOUNTS.prepare("SELECT cancel_at_period_end AS f FROM payment_customers WHERE user_id = ?").bind(user).first<{ f: number }>())?.f;
const audits = async (user: string) =>
  ((await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE user_id = ? ORDER BY id").bind(user).all<{ event: string; detail: string | null }>()).results ?? [])
    .map((r) => `${r.event} ${r.detail ?? ""}`.trim());
const calls = () => sent.map((s) => `${s.method} ${s.url.pathname}`);
const refundCalls = () => sent.filter((s) => s.method === "POST" && s.url.pathname === "/v1/refunds");
const page = async (path: string, who: { cookie: string }, env: object = payEnv()) => decode(await (await get(path, { cookie: who.cookie, env })).text());
const alertsFor = async (user: string) => collectAlerts(await gatherInputs(watchEnv(), new Date())).filter((a) => a.includes(`account ${user}`));

const LANDED = (user: string, sub: string) => `A payment landed on a deleted account: account ${user}, subscription ${sub}.`;
const REFUNDED = (user: string, sub: string) =>
  `${LANDED(user, sub)} The subscription is cancelled, nothing was granted, and the payment was refunded in full. No action is needed; a refund that fails later has a line of its own.`;
const NOT_REFUNDED = (user: string, sub: string, reason: string) =>
  `${LANDED(user, sub)} The subscription is cancelled and nothing was granted, but the payment could not be refunded (${reason}). Look at the payment in Stripe's dashboard. A disputed payment is settled through its dispute; for any other reason, refund the person another way.`;
const UNCONFIRMED = (user: string, sub: string) =>
  `${LANDED(user, sub)} The subscription is cancelled and nothing was granted. The refund of the payment is not confirmed yet; the site asks again each time Stripe resends the notice, for up to three days. If this line is still here after that, refund the payment in Stripe's dashboard.`;

// =========================================================================================

describe("1. a payment that lands on a deleted account", () => {
  it("is refunded in full after the cancellation, under the charge's own key, and the audit and the daily check say so", async () => {
    const d = await deletedPayer("landed-invoice");
    expect((await deliver(invoicePaid(d.sub, d.cus, d.periodEnd, d.user, d.invoice))).status).toBe(200);
    const order = calls();
    expect(order.indexOf(`DELETE /v1/subscriptions/${d.sub}`)).toBeGreaterThanOrEqual(0);
    expect(order).toContain(`GET /v1/invoices/${d.invoice}`);
    expect(order.indexOf("POST /v1/refunds")).toBeGreaterThan(order.indexOf(`DELETE /v1/subscriptions/${d.sub}`));
    // The console's own refund: the charge, no amount (the whole of what is left), the charge's key.
    const [refund] = refundCalls();
    expect([...refund.form.entries()]).toEqual([["charge", d.charge]]);
    expect(refund.idempotencyKey).toBe(refundKey(d.charge));
    expect(refundsMade).toEqual([d.charge]);
    expect(subs.get(d.sub)!.status).toBe("canceled");
    expect(await stripeRows(d.user)).toEqual([]);
    expect(await audits(d.user)).toContain(`plan_changed stripe paid on a deleted account, cancelled ${d.sub} refunded`);
    // The customer is bound to the deleted account, so the refund's own notices find it.
    expect(await binding(d.user)).toEqual({ customer_id: d.cus, subscription_id: d.sub, status: "canceled" });
    const lines = await alertsFor(d.user);
    expect(lines).toEqual([REFUNDED(d.user, d.sub)]);
    for (const l of logged) for (const secret of [d.user, d.email, d.charge, d.cus, d.sub]) expect(l).not.toContain(secret);
  });

  it("refunds once when the paid checkout and its invoice.paid both land, in either order, and a notice delivered twice changes nothing", async () => {
    for (const first of ["checkout", "invoice"] as const) {
      const d = await deletedPayer(`landed-both-${first}`);
      const checkoutNotice = checkoutCompleted(d.user, d.sub, d.cus, { invoice: d.invoice });
      const invoiceNotice = invoicePaid(d.sub, d.cus, d.periodEnd, d.user, d.invoice);
      const [a, b] = first === "checkout" ? [checkoutNotice, invoiceNotice] : [invoiceNotice, checkoutNotice];
      expect((await deliver(a)).status).toBe(200);
      expect((await deliver(b)).status).toBe(200);
      expect((await deliver(a)).status).toBe(200);
      expect(refundsMade, first).toEqual([d.charge]);
      expect(new Set(refundCalls().map((s) => s.idempotencyKey))).toEqual(new Set([refundKey(d.charge)]));
      expect((await audits(d.user)).filter((a) => a.endsWith(" refunded"))).toHaveLength(1);
      expect(await alertsFor(d.user)).toEqual([REFUNDED(d.user, d.sub)]);
      refundsMade = [];
    }
  });

  it("finds the payment through the subscription's paid invoices when the checkout names no invoice", async () => {
    const d = await deletedPayer("landed-no-invoice");
    expect((await deliver(checkoutCompleted(d.user, d.sub, d.cus))).status).toBe(200);
    const list = sent.find((s) => s.method === "GET" && s.url.pathname === "/v1/invoices")!;
    expect([list.url.searchParams.get("subscription"), list.url.searchParams.get("status")]).toEqual([d.sub, "paid"]);
    expect(refundsMade).toEqual([d.charge]);
  });

  it("reads a lost answer back from the charge and counts the refund once", async () => {
    const d = await deletedPayer("landed-lost");
    lostAnswer = true;
    expect((await deliver(invoicePaid(d.sub, d.cus, d.periodEnd, d.user, d.invoice))).status).toBe(200);
    expect(refundsMade).toEqual([d.charge]);
    expect(calls().slice(-1)).toEqual([`GET /v1/charges/${d.charge}`]);
    expect(await audits(d.user)).toContain(`plan_changed stripe paid on a deleted account, cancelled ${d.sub} refunded`);
  });

  it("answers 500 when Stripe cannot confirm the refund, names it as not confirmed meanwhile, and refunds when the notice comes again", async () => {
    const d = await deletedPayer("landed-down");
    failing.add("POST /v1/refunds");
    const notice = invoicePaid(d.sub, d.cus, d.periodEnd, d.user, d.invoice);
    expect((await deliver(notice)).status).toBe(500);
    expect(refundsMade).toEqual([]);
    expect(await audits(d.user)).not.toContain(`plan_changed stripe paid on a deleted account, cancelled ${d.sub} refunded`);
    expect(await alertsFor(d.user)).toEqual([UNCONFIRMED(d.user, d.sub)]);
    // Stripe gives the same 500 again under the key while it keeps it (at least 24 hours).
    failing.clear();
    expect((await deliver(notice)).status).toBe(500);
    // Once the key is pruned, the notice Stripe resends makes the refund.
    keyed.delete(refundKey(d.charge));
    expect((await deliver(notice)).status).toBe(200);
    expect(refundsMade).toEqual([d.charge]);
    expect(await alertsFor(d.user)).toEqual([REFUNDED(d.user, d.sub)]);
  });

  it("records a refusal Stripe gives as final, with its code, answers 200 and names it for the operator", async () => {
    // A disputed charge: Stripe allows no refund outside the dispute, so none is asked.
    const d = await deletedPayer("landed-disputed", { disputed: true });
    expect((await deliver(invoicePaid(d.sub, d.cus, d.periodEnd, d.user, d.invoice))).status).toBe(200);
    expect(refundCalls()).toEqual([]);
    expect(await audits(d.user)).toContain(`plan_changed stripe paid on a deleted account, cancelled ${d.sub} unrefunded charge_disputed`);
    expect(await alertsFor(d.user)).toEqual([NOT_REFUNDED(d.user, d.sub, "charge_disputed")]);
    // Stripe refuses the refund itself (a 400 with its code): recorded, not asked again for ever.
    const e = await deletedPayer("landed-refused");
    refusal = { status: 400, type: "invalid_request_error", code: "refund_disputed_payment" };
    const notice = invoicePaid(e.sub, e.cus, e.periodEnd, e.user, e.invoice);
    expect((await deliver(notice)).status).toBe(200);
    expect(await audits(e.user)).toContain(`plan_changed stripe paid on a deleted account, cancelled ${e.sub} unrefunded refund_disputed_payment`);
    expect(await alertsFor(e.user)).toEqual([NOT_REFUNDED(e.user, e.sub, "refund_disputed_payment")]);
    // A refusal that asking again can change is not final: the notice answers 500.
    for (const r of [{ status: 429, type: "rate_limit_error" }, { status: 409, type: "idempotency_error" }, { status: 400, type: "idempotency_error" }]) {
      const f = await deletedPayer(`landed-retry-${r.status}`);
      refusal = r;
      expect((await deliver(invoicePaid(f.sub, f.cus, f.periodEnd, f.user, f.invoice))).status, `${r.status} ${r.type}`).toBe(500);
      expect(await alertsFor(f.user)).toEqual([UNCONFIRMED(f.user, f.sub)]);
    }
  });

  it("takes the refund's own charge.refunded once and changes nothing, and refund.failed for it names the account", async () => {
    const d = await deletedPayer("landed-after");
    expect((await deliver(invoicePaid(d.sub, d.cus, d.periodEnd, d.user, d.invoice))).status).toBe(200);
    logged = [];
    expect((await deliver(chargeRefunded(d.charge, d.cus))).status).toBe(200);
    expect((await deliver(chargeRefunded(d.charge, d.cus))).status).toBe(200);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM payment_reversals WHERE charge_id = ?").bind(d.charge).first()).toEqual({ n: 1 });
    expect(await stripeRows(d.user)).toEqual([]);
    expect((await audits(d.user)).filter((a) => a.startsWith("plan_changed stripe ended"))).toEqual([]);
    expect(logged.filter((l) => l.includes("names no known account"))).toEqual([]);
    // The refund fails later at the card: the account is found through the bound customer.
    expect((await deliver(refundFailed(d.charge))).status).toBe(200);
    expect(await audits(d.user)).toContain(`refund_failed ${d.charge} expired_or_canceled_card`);
    expect(await alertsFor(d.user)).toContain(`A refund failed after Stripe took it: account ${d.user}, charge ${d.charge} (expired_or_canceled_card). ` +
      "The site changed no plan; the money is back in the Stripe balance. Refund the person another way, or grant the plan by hand.");
  });

  it("keeps today's behaviour for a subscription that could still bill and reports no payment", async () => {
    const d = await deletedPayer("landed-live");
    expect((await deliver(updated(subs.get(d.sub)!))).status).toBe(200);
    expect(calls()).toContain(`DELETE /v1/subscriptions/${d.sub}`);
    expect(refundCalls()).toEqual([]);
    expect(await audits(d.user)).toContain(`plan_changed stripe live on a deleted account, cancelled ${d.sub}`);
    expect(await alertsFor(d.user)).toEqual([`A subscription that could still bill reached a deleted account: account ${d.user}, subscription ${d.sub}. ` +
      "It is cancelled and nothing was granted. Check in Stripe's dashboard whether it took a payment after the deletion."]);
    // An unpaid checkout (a debit still clearing) refunds nothing either.
    const u = await deletedPayer("landed-unpaid");
    expect((await deliver(checkoutCompleted(u.user, u.sub, u.cus, { paid: false }))).status).toBe(200);
    expect(refundCalls()).toEqual([]);
  });

  it("is written in the docs: Deletion, the notice table and Known limits", async () => {
    const docs = ((await import("../../docs/accounts.md?raw")).default as string).replace(/\s+/g, " ");
    expect(docs).not.toContain("whether to refund it is the operator's decision");
    expect(docs).not.toContain("Whether to refund the payment is the operator's decision");
    expect(docs).toContain("refunded in full through Stripe");
    expect(docs).toContain("Idempotency-Key: operator-refund-<charge id>");
    for (const p of [docs]) {
      expect(p).not.toContain(EM_DASH);
      expect(p).not.toContain(EN_DASH);
    }
  });
});

describe("2. a Checkout Session's own expiry", () => {
  it("is sent on every session, 60 minutes after the start of its key's ten minutes, so two presses of one choice stay one session", async () => {
    const window = Math.floor(Date.now() / 600_000) + 1;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(window * 600_000 + 7 * 60_000);
    const expected = (window * 600_000 + 60 * 60_000) / 1000;
    const b = await buyer("expires");
    expect((await checkout(b, "monthly")).headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_r1");
    const first = sent.find((s) => s.method === "POST" && s.url.pathname === "/v1/checkout/sessions")!;
    expect(first.form.get("expires_at")).toBe(String(expected));
    // Stripe takes 30 minutes to 24 hours after creation; this is 53 minutes after it.
    expect(expected - nowS()).toBeGreaterThanOrEqual(30 * 60);
    expect(expected - nowS()).toBeLessThanOrEqual(60 * 60);
    // Pressed again two minutes later: the same key and the same parameters, so Stripe gives back the one session.
    vi.setSystemTime(window * 600_000 + 9 * 60_000);
    expect((await checkout(b, "monthly")).headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_r1");
    expect(made).toBe(1);
    // The next ten minutes start a session of their own, which expires ten minutes later.
    vi.setSystemTime((window + 1) * 600_000 + 60_000);
    sent = [];
    await checkout(b, "yearly");
    expect(sent.find((s) => s.url.pathname === "/v1/checkout/sessions")!.form.get("expires_at")).toBe(String(expected + 600));
  });

  it("is sent for a returning customer and for Ultra too", async () => {
    const s = await subscriber("expires-returning");
    subs.get(s.sub)!.status = "canceled";
    expect((await deliver(updated(subs.get(s.sub)!, "deleted"))).status).toBe(200);
    sent = [];
    await checkout(s, "monthly");
    const create = sent.find((x) => x.method === "POST" && x.url.pathname === "/v1/checkout/sessions")!;
    expect(create.form.get("customer")).toBe(s.cus);
    expect(Number(create.form.get("expires_at"))).toBeGreaterThan(nowS() + 49 * 60);
    const u = await buyer("expires-ultra", ultraEnv());
    sent = [];
    await checkout(u, "monthly", { env: ultraEnv(), plan: "ultra" });
    expect(Number(sent.find((x) => x.url.pathname === "/v1/checkout/sessions")!.form.get("expires_at"))).toBeLessThanOrEqual(nowS() + 60 * 60);
  });

  it("is written in the docs", async () => {
    const docs = ((await import("../../docs/accounts.md?raw")).default as string).replace(/\s+/g, " ");
    expect(docs).toContain("`expires_at`");
    expect(docs).not.toContain("Its earlier session stays open until its own `expires_at` (\"By default, this value is 24 hours from creation\"");
    expect(docs).toContain("CHECKOUT_EXPIRES_MS");
  });
});

describe("3. a cancellation set in Stripe's portal", () => {
  const PERIOD_ROW = (end: number) => `<dt>Current period ends</dt><dd class="mono">${day(end)}</dd>`;
  const ENDS_ROW = (end: number) => `<dt>Ends, does not renew</dt><dd class="mono">${day(end)}</dd>`;
  const ENDS_NOTE = (end: number) => `The subscription was cancelled and is not charged again. Pro continues until ${day(end)}, and Stripe's page can undo the cancellation until then.`;

  it("shows on the billing page and the overview, and undoing it puts the usual lines back", async () => {
    const s = await subscriber("portal-cancel");
    const cancelled = subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user, { cancelAtPeriodEnd: true, cancelAt: s.periodEnd });
    expect((await deliver(updated(cancelled))).status).toBe(200);
    expect(await flagOf(s.user)).toBe(1);
    const html = await page("/account/billing", s);
    expect(html).toContain(ENDS_ROW(s.periodEnd));
    expect(html).not.toContain("Current period ends");
    expect(html).toContain(ENDS_NOTE(s.periodEnd));
    expect(html).toContain(`Your plan today: Pro, ends on ${day(s.periodEnd)}.`);
    expect(html.match(/btn-primary/g)).toHaveLength(1);
    expect(await page("/account", s)).toContain(`<dd>Pro, ends on ${day(s.periodEnd)}</dd>`);
    const french = fr(await page("/account/billing?lang=fr", s));
    expect(french).toContain(`<dt>Prend fin, sans renouvellement</dt><dd class="mono">${day(s.periodEnd)}</dd>`);
    expect(french).toContain(`L'abonnement a été annulé et ne sera plus facturé. Pro continue jusqu'au ${day(s.periodEnd)}, et la page de Stripe permet de revenir sur l'annulation d'ici là.`);
    expect(fr(await page("/account?lang=fr", s))).toContain(`<dd>Pro, prend fin le ${day(s.periodEnd)}</dd>`);
    for (const p of [html, french]) {
      expect(p).not.toContain(EM_DASH);
      expect(p).not.toContain(EN_DASH);
    }
    // Undone in the portal: the usual lines again.
    expect((await deliver(updated(subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user)))).status).toBe(200);
    expect(await flagOf(s.user)).toBe(0);
    const back = await page("/account/billing", s);
    expect(back).toContain(PERIOD_ROW(s.periodEnd));
    expect(back).not.toContain("Ends, does not renew");
    expect(await page("/account", s)).toContain(`<dd>Pro, paid until ${day(s.periodEnd)}</dd>`);
  });

  it("shows a cancellation set by cancel_at at the period's end without the flag, as the portal sets it under flexible billing; a later date renews first", async () => {
    const s = await subscriber("portal-cancel-at");
    expect((await deliver(updated(subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user, { cancelAt: s.periodEnd })))).status).toBe(200);
    expect(await page("/account/billing", s)).toContain(ENDS_ROW(s.periodEnd));
    expect(await page("/account", s)).toContain(`<dd>Pro, ends on ${day(s.periodEnd)}</dd>`);
    // A date past the current period: the subscription renews into it first, so the page says nothing yet.
    expect((await deliver(updated(subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user, { cancelAt: s.periodEnd + 30 * DAY_S })))).status).toBe(200);
    expect(await page("/account/billing", s)).toContain(PERIOD_ROW(s.periodEnd));
  });

  it("is written from the checkout read and the paid invoice's read too", async () => {
    const b = await buyer("portal-reads");
    const { sub, cus } = ids();
    const end = nowS() + 30 * DAY_S;
    subs.set(sub, subscriptionObject(sub, cus, "active", end, b.user, { cancelAtPeriodEnd: true, cancelAt: end }));
    expect((await deliver(checkoutCompleted(b.user, sub, cus))).status).toBe(200);
    expect(await flagOf(b.user)).toBe(1);
    subs.set(sub, subscriptionObject(sub, cus, "active", end, b.user));
    expect((await deliver(invoicePaid(sub, cus, end, b.user))).status).toBe(200);
    expect(await flagOf(b.user)).toBe(0);
    subs.set(sub, subscriptionObject(sub, cus, "active", end, b.user, { cancelAtPeriodEnd: true, cancelAt: end }));
    expect((await deliver(invoicePaid(sub, cus, end, b.user))).status).toBe(200);
    expect(await flagOf(b.user)).toBe(1);
  });

  it("works on a database without the column: every notice is taken and every page shows the usual lines", async () => {
    const s = await subscriber("portal-no-column");
    await ACCOUNTS.prepare("ALTER TABLE payment_customers DROP COLUMN cancel_at_period_end").run();
    try {
      const cancelled = subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user, { cancelAtPeriodEnd: true, cancelAt: s.periodEnd });
      expect((await deliver(updated(cancelled))).status).toBe(200);
      expect(await binding(s.user)).toEqual({ customer_id: s.cus, subscription_id: s.sub, status: "active" });
      const html = await page("/account/billing", s);
      expect(html).toContain(PERIOD_ROW(s.periodEnd));
      expect(html).toContain("Manage the subscription");
      expect(await page("/account", s)).toContain(`<dd>Pro, paid until ${day(s.periodEnd)}</dd>`);
      // A first checkout binds and grants as before.
      const t = await subscriber("portal-no-column-2");
      expect(await binding(t.user)).toMatchObject({ subscription_id: t.sub, status: "active" });
      expect(await stripeRows(t.user)).toHaveLength(1);
      // A payment on a deleted account is refunded, the binding written without the column.
      const d = await deletedPayer("portal-no-column-3");
      expect((await deliver(invoicePaid(d.sub, d.cus, d.periodEnd, d.user, d.invoice))).status).toBe(200);
      expect(await binding(d.user)).toEqual({ customer_id: d.cus, subscription_id: d.sub, status: "canceled" });
    } finally {
      await ACCOUNTS.prepare("ALTER TABLE payment_customers ADD COLUMN cancel_at_period_end INTEGER NOT NULL DEFAULT 0").run();
    }
  });
});
