// The refund of the first payment from the billing page: who is offered
// Refund now (src/account/billing.tsx refundState), the confirmation step,
// the press (src/account/refund.ts) on each of its paths, the audit rows, the
// daily check's item (src/watchdog.ts) and the words on the public pages.
// Stripe is a fake fetch that keeps invoices, charges and refunds in tables
// and answers under Stripe's documented idempotency (as
// test/hardening-paid.test.ts does); notices are signed here with WebCrypto.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refundKey } from "../src/account/admin_stripe";
import { REFUND_DAYS } from "../src/account/billing";
import { refundVerdict } from "../src/account/refund";
import { STRIPE_VERSION } from "../src/account/stripe";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { REFUNDS_TO_CANCEL_SQL, collectAlerts, gatherInputs, readRefundsToCancel } from "../src/watchdog";
import { testEnv } from "./assets";
import { ACCOUNTS, csrf, decode, get, grantPro, nbsp, newEmail, nextIp, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";

useAccountsDb();

const KEYS = {
  STRIPE_SECRET_KEY: "sk_test_refund0000", STRIPE_WEBHOOK_SECRET: "whsec_refund0000",
  STRIPE_PRICE_MONTHLY: "price_monthlyREFUND", STRIPE_PRICE_YEARLY: "price_yearlyREFUND",
  PRICE_MONTHLY_CAD: "12", PRICE_YEARLY_CAD: "120",
};
const payEnv = (extra: Record<string, unknown> = {}) => onEnv({ ...KEYS, ...extra });

const DAY_S = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

// -- a fake Stripe ---------------------------------------------------------------------

type Obj = Record<string, unknown>;
type Reply = { status?: number; body?: unknown };
type Sent = { method: string; url: URL; form: URLSearchParams; idempotencyKey: string | null };

let sent: Sent[] = [];
let subs = new Map<string, Obj>();
let invoices: Obj[] = [];
let charges = new Map<string, Obj>();
let failing = new Set<string>();
// Stripe's idempotency: the first answer under a key is given again to the
// same request; the same key with other parameters is an idempotency_error;
// a key named here answers 409 once, as one still in flight does.
let keyed = new Map<string, { form: string; reply: Reply }>();
let inFlightOnce = new Set<string>();
// Refunds the fake made, by charge; and a refund taken whose answer is lost (500).
let refundsMade: string[] = [];
let lostAnswer = false;

const stripeSent = () => sent.map((s) => `${s.method} ${s.url.pathname}`);
const posts = () => sent.filter((s) => s.method !== "GET");

const invoiceSub = (i: Obj) => ((i.parent as Obj | undefined)?.subscription_details as Obj | undefined)?.subscription;

function answer(method: string, url: URL, form: URLSearchParams): Reply {
  const path = url.pathname;
  const last = path.split("/").pop() ?? "";
  const key = `${method} ${/^(sub|ch)_/.test(last) ? path.replace(/[^/]+$/, ":id") : path}`;
  if (failing.has(key)) return { status: 500, body: { error: { message: "down" } } };
  if (key === "GET /v1/subscriptions/:id") return subs.has(last) ? { body: subs.get(last) } : { status: 404, body: {} };
  if (key === "DELETE /v1/subscriptions/:id") {
    const s = subs.get(last);
    if (!s) return { status: 404, body: {} };
    s.status = "canceled";
    return { body: s };
  }
  if (key === "GET /v1/invoices") {
    const cus = url.searchParams.get("customer");
    const sub = url.searchParams.get("subscription");
    const data = invoices.filter((i) => (!cus || i.customer === cus) && (!sub || invoiceSub(i) === sub))
      .sort((a, b) => (b.created as number) - (a.created as number));
    return { body: { object: "list", data, has_more: false } };
  }
  if (key === "GET /v1/charges") {
    const cus = url.searchParams.get("customer");
    const pi = url.searchParams.get("payment_intent");
    const data = [...charges.values()].filter((ch) => (!cus || ch.customer === cus) && (!pi || ch.payment_intent === pi));
    return { body: { object: "list", data, has_more: false } };
  }
  if (key === "GET /v1/charges/:id") return charges.has(last) ? { body: charges.get(last) } : { status: 404, body: {} };
  if (key === "POST /v1/refunds") {
    const ch = charges.get(form.get("charge") ?? "");
    if (!ch) return { status: 400, body: { error: { type: "invalid_request_error", code: "resource_missing" } } };
    if ((ch.amount_refunded as number) >= (ch.amount as number)) {
      return { status: 400, body: { error: { type: "invalid_request_error", code: "charge_already_refunded" } } };
    }
    ch.amount_refunded = ch.amount;
    ch.refunded = true;
    refundsMade.push(ch.id as string);
    if (lostAnswer) return { status: 500, body: { error: { message: "lost" } } };
    return { body: { id: `re_${ch.id}`, object: "refund", status: "succeeded", charge: ch.id } };
  }
  return { status: 400, body: { error: { message: `unexpected ${key}` } } };
}

beforeEach(() => {
  sent = [];
  subs = new Map();
  invoices = [];
  charges = new Map();
  failing = new Set();
  keyed = new Map();
  inFlightOnce = new Set();
  refundsMade = [];
  lostAnswer = false;
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
    if (idempotencyKey && inFlightOnce.delete(idempotencyKey)) {
      reply = { status: 409, body: { error: { type: "idempotency_error", message: "in flight" } } };
    } else if (kept && kept.form !== body) {
      reply = { status: 400, body: { error: { type: "idempotency_error", message: "other parameters" } } };
    } else if (kept) {
      reply = kept.reply;
    } else {
      reply = answer(method, url, form);
      if (idempotencyKey) keyed.set(idempotencyKey, { form: body, reply });
    }
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -- notices --------------------------------------------------------------------------

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let n = 0;
const tag = () => `${Date.now().toString(36)}${n++}`;
const event = (type: string, object: object) => ({ id: `evt_rf${tag()}`, object: "event", type, api_version: STRIPE_VERSION, data: { object } });

async function deliver(e: object): Promise<Response> {
  const body = JSON.stringify(e);
  const t = nowS();
  const header = `t=${t},v1=${await hmacHex(KEYS.STRIPE_WEBHOOK_SECRET, `${t}.${body}`)}`;
  return app.request("/account/billing/webhook", {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": header, "cf-connecting-ip": nextIp() }, body,
  }, payEnv());
}

function subscriptionObject(id: string, customer: string, status: string, periodEnd: number, user: string | null) {
  return {
    id, object: "subscription", customer, status, cancel_at_period_end: false,
    items: { object: "list", data: [{ id: `si_${id}`, object: "subscription_item", current_period_end: periodEnd }] },
    metadata: user ? { user_id: user } : {},
  };
}

const checkoutCompleted = (user: string, sub: string, cus: string) => event("checkout.session.completed", {
  id: `cs_${sub}`, object: "checkout.session", mode: "subscription", client_reference_id: user, customer: cus, subscription: sub,
  payment_status: "paid", status: "complete",
});
const invoicePaid = (sub: string, cus: string, periodEnd: number, user: string) => event("invoice.paid", {
  id: `in_${sub}_${periodEnd}`, object: "invoice", customer: cus, status: "paid",
  parent: { type: "subscription_details", subscription_details: { subscription: sub, metadata: { user_id: user } } },
  lines: { object: "list", data: [{ id: "il_1", object: "line_item", period: { start: periodEnd - 30 * DAY_S, end: periodEnd } }] },
});
const chargeRefunded = (ch: string, cus: string) => event("charge.refunded", {
  id: ch, object: "charge", customer: cus, amount: 1900, amount_refunded: 1900, refunded: true, currency: "cad",
});
const subscriptionDeleted = (sub: string, cus: string, user: string) =>
  event("customer.subscription.deleted", subscriptionObject(sub, cus, "canceled", nowS() + 30 * DAY_S, user));

// A paid invoice of the customer and its charge, as Stripe holds them: the
// charge through a PaymentIntent (current API versions), with card data the
// site must never read.
function payment(sub: string, cus: string, o: { ago?: number; amount?: number; invoiceAmount?: number; suffix?: string } = {}) {
  const id = `${sub.slice(4)}${o.suffix ?? ""}`;
  const created = nowS() - Math.round((o.ago ?? 0) * DAY_S);
  invoices.push({
    id: `in_${id}`, object: "invoice", customer: cus, status: "paid", amount_paid: o.invoiceAmount ?? o.amount ?? 1900, currency: "cad", created,
    parent: { type: "subscription_details", subscription_details: { subscription: sub } },
    payments: { object: "list", data: [{ id: `inpay_${id}`, status: "paid", payment: { type: "payment_intent", payment_intent: `pi_${id}` } }] },
  });
  charges.set(`ch_${id}`, {
    id: `ch_${id}`, object: "charge", customer: cus, payment_intent: `pi_${id}`, amount: o.amount ?? 1900, amount_refunded: 0, refunded: false,
    currency: "cad", status: "succeeded", paid: true, created, disputed: false,
    billing_details: { email: "cardholder@example.com", name: "Card Holder" },
    payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } },
  });
  return `ch_${id}`;
}

// A signed-in reader whose first payment was made `ago` days back: the
// checkout notice wrote the Stripe row (dated back to the payment here), and
// Stripe holds the paid invoice and its charge.
async function subscriber(name: string, ago = 0) {
  const email = newEmail(name);
  const cookie = await signIn(email, { env: payEnv() });
  const user = await userId(email);
  const t = tag();
  const sub = `sub_rf${t}`;
  const cus = `cus_rf${t}`;
  subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, user));
  expect((await deliver(checkoutCompleted(user, sub, cus))).status).toBe(200);
  const at = new Date(Date.now() - ago * DAY_S * 1000).toISOString();
  await ACCOUNTS.prepare("UPDATE entitlements SET created_at = ?, starts_at = ? WHERE user_id = ?").bind(at, at, user).run();
  const charge = payment(sub, cus, { ago });
  sent = [];
  return { email, cookie, user, sub, cus, charge };
}

type Who = Awaited<ReturnType<typeof subscriber>>;

const billing = async (who: { cookie: string }, query = "") => decode(await (await get(`/account/billing${query}`, { cookie: who.cookie, env: payEnv() })).text());
const press = async (who: { cookie: string }, fields: Record<string, string> = {}) => {
  const token = await csrf(who.cookie, "/account/billing", { env: payEnv() });
  sent = [];
  return post("/account/billing/refund", { csrf: token, confirm: "yes", ...fields }, { cookie: who.cookie, env: payEnv() });
};

const auditOf = async (user: string) =>
  ((await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE user_id = ? AND (event LIKE 'refund%' OR detail LIKE '%refund%') ORDER BY id")
    .bind(user).all<{ event: string; detail: string | null }>()).results ?? []).map((r) => `${r.event} ${r.detail ?? ""}`.trim());
const statusOf = async (user: string) =>
  (await ACCOUNTS.prepare("SELECT status FROM payment_customers WHERE user_id = ?").bind(user).first<{ status: string }>())?.status;

const REFUND_LINK = '<a href="/account/billing?refund=confirm#refund" class="btn">Refund now</a>';
const PANEL_HEAD = '<h2 id="refund">Refund of the First Payment</h2>';

// =====================================================================================

describe("who is offered Refund now", () => {
  it("a Stripe subscriber within the 14 days: the panel, its one line and the link, not the filled button, asking Stripe nothing", async () => {
    for (const ago of [0, REFUND_DAYS - 1 / 24]) {
      const s = await subscriber("offered", ago);
      const html = await billing(s);
      expect(html, String(ago)).toContain(PANEL_HEAD);
      expect(html).toContain("<p>Refund now returns your first payment in full, taxes included, and ends Pro at once.</p>");
      expect(html).toContain(REFUND_LINK);
      // The page's one filled button is still Manage the subscription.
      expect(html.match(/btn-primary/g)).toHaveLength(1);
      expect(html).toContain('<button type="submit" class="btn btn-primary">Manage the subscription</button>');
      // The panel follows the subscription's and has no form of its own until the confirmation.
      expect(html.indexOf("Your Subscription")).toBeLessThan(html.indexOf(PANEL_HEAD));
      expect(html).not.toContain('action="/account/billing/refund"');
      expect(sent).toEqual([]);
    }
  });

  it("says the same in French, the link keeping the language", async () => {
    const s = await subscriber("offered-fr");
    const fr = nbsp(await billing(s, "?lang=fr"));
    expect(fr).toContain('<h2 id="refund">Remboursement du premier paiement</h2>');
    expect(fr).toContain("Rembourser maintenant vous rend votre premier paiement en entier, taxes comprises, et met fin à Pro immédiatement.");
    expect(fr).toContain('<a href="/account/billing?refund=confirm&lang=fr#refund" class="btn">Rembourser maintenant</a>');
    expect(fr).not.toContain(EM_DASH);
  });

  it("not past the 14 days: day 15, or 14 days and a minute", async () => {
    for (const ago of [15, REFUND_DAYS + 1 / 1440]) {
      const s = await subscriber("late", ago);
      const html = await billing(s);
      expect(html, String(ago)).not.toContain(PANEL_HEAD);
      expect(html).not.toContain("Refund now");
      // The subscription itself is shown as before.
      expect(html).toContain("Manage the subscription");
    }
  });

  it("not after a second payment, even within the 14 days", async () => {
    const s = await subscriber("second");
    expect(await billing(s)).toContain(PANEL_HEAD);
    expect((await deliver(invoicePaid(s.sub, s.cus, nowS() + 61 * DAY_S, s.user))).status).toBe(200);
    expect(await billing(s)).not.toContain(PANEL_HEAD);
  });

  it("not once a payment was refunded, nor for a later subscription of the same account", async () => {
    const s = await subscriber("refunded");
    expect((await deliver(chargeRefunded(s.charge, s.cus))).status).toBe(200);
    expect(await billing(s)).not.toContain(PANEL_HEAD);
    // The first subscription ends; a second one starts a day later: its first payment is not the account's.
    expect((await deliver(subscriptionDeleted(s.sub, s.cus, s.user))).status).toBe(200);
    const again = `sub_rf${tag()}`;
    subs.set(again, subscriptionObject(again, s.cus, "active", nowS() + 30 * DAY_S, s.user));
    expect((await deliver(checkoutCompleted(s.user, again, s.cus))).status).toBe(200);
    const html = await billing(s);
    expect(html).toContain("Manage the subscription");
    expect(html).not.toContain(PANEL_HEAD);
  });

  it("not for Pro granted by hand, Free, or a stub source", async () => {
    const manual = newEmail("by-hand");
    const cookie = await signIn(manual, { env: payEnv() });
    await grantPro(manual);
    const byHand = await billing({ cookie });
    expect(byHand).toContain("Your plan today: Pro");
    expect(byHand).not.toContain(PANEL_HEAD);
    const free = await billing({ cookie: await signIn(newEmail("free"), { env: payEnv() }) });
    expect(free).toContain("Your plan today: Free.");
    expect(free).not.toContain(PANEL_HEAD);
    // A Stripe subscriber, with the keys removed: no payments at all, so no refund either.
    const s = await subscriber("no-keys");
    const stub = decode(await (await get("/account/billing", { cookie: s.cookie, env: onEnv() })).text());
    expect(stub).not.toContain(PANEL_HEAD);
    expect(sent).toEqual([]);
  });

  it("not when the stored subscription is no longer active, or Pro comes from a manual grant written after it", async () => {
    const s = await subscriber("past-due");
    await ACCOUNTS.prepare("UPDATE payment_customers SET status = 'past_due' WHERE user_id = ?").bind(s.user).run();
    expect(await billing(s)).not.toContain(PANEL_HEAD);
    // Paid a minute before the grant: while another test file keeps the runtime busy its clock can stand still
    // across both writes, and two rows written in the same instant leave the newer one to chance.
    const t = await subscriber("topped", 60 / DAY_S);
    await grantPro(t.email);
    expect(await billing(t)).not.toContain(PANEL_HEAD);
  });

  it("signed out: to sign-in, from the page and from the post", async () => {
    const res = await get("/account/billing?refund=confirm", { env: payEnv() });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/sign-in?next=%2Faccount%2Fbilling%3Frefund%3Dconfirm");
    const posted = await post("/account/billing/refund", { csrf: "0".repeat(32), confirm: "yes" }, { env: payEnv() });
    expect(posted.status).toBe(303);
    expect(posted.headers.get("location")).toBe("/account/sign-in");
    expect(sent).toEqual([]);
  });

  it("accounts off: both addresses are the site's 404, reading nothing", async () => {
    const used: string[] = [];
    const db = new Proxy({}, { get(_t, prop) { used.push(String(prop)); throw new Error("read"); } }) as D1Database;
    const env = { ...testEnv(), ...KEYS, ACCOUNTS: db };
    const notFound = await (await app.request("/nothing-here", { headers: { "cf-connecting-ip": nextIp() } }, env)).text();
    for (const [method, path] of [["GET", "/account/billing?refund=confirm"], ["POST", "/account/billing/refund"]]) {
      const res = await app.request(path, {
        method, headers: { "cf-connecting-ip": nextIp(), "content-type": "application/x-www-form-urlencoded", origin: "http://localhost" },
        body: method === "POST" ? "confirm=yes" : undefined,
      }, env);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe(notFound);
    }
    expect(used).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("counts the press with the forms, as the other billing posts", () => {
    expect(bucketFor("POST", "/account/billing/refund")).toBe("form");
    expect(bucketFor("POST", "/account/billing/checkout")).toBe("form");
    expect(bucketFor("GET", "/account/billing/refund")).toBe("page");
    expect(bucketFor("POST", "/account/billing/webhook")).toBe("hook");
  });
});

describe("the confirmation step", () => {
  it("says what cannot be undone and posts only with its box ticked, in both languages", async () => {
    const s = await subscriber("confirm");
    const html = await billing(s, "?refund=confirm");
    const panel = html.slice(html.indexOf(PANEL_HEAD), html.indexOf("</section>", html.indexOf(PANEL_HEAD)));
    expect(panel).toContain('<form method="post" action="/account/billing/refund" class="stack">');
    expect(panel).toMatch(/name="csrf" value="[0-9a-f]{32}"/);
    expect(panel).toContain("This cannot be undone. Your first payment is refunded in full, taxes included, to the payment method used, " +
      "and the subscription is cancelled at once. Pro ends when Stripe confirms the refund, usually within a minute.");
    expect(panel).toContain('<input type="checkbox" name="confirm" value="yes" required=""/><span>I want my first payment refunded and Pro ended now.</span>');
    expect(panel).toContain('<button type="submit" class="btn">Refund my first payment</button>');
    expect(panel).toContain('<a href="/account/billing" class="btn">Keep Pro</a>');
    expect(panel).not.toContain("btn-primary");
    expect(panel).not.toContain(REFUND_LINK);
    expect(sent).toEqual([]);
    const fr = nbsp(await billing(s, "?refund=confirm&lang=fr"));
    expect(fr).toContain("Cette action est irréversible. Votre premier paiement est remboursé en entier, taxes comprises, au mode de paiement utilisé");
    expect(fr).toContain("Je veux que mon premier paiement soit remboursé et que Pro prenne fin maintenant.");
    expect(fr).toContain('<button type="submit" class="btn">Rembourser mon premier paiement</button>');
    expect(fr).toContain('<a href="/account/billing?lang=fr" class="btn">Garder Pro</a>');
    expect(fr).toContain('<input type="hidden" name="lang" value="fr"/>');
  });

  it("is not shown to an account not offered the refund", async () => {
    const s = await subscriber("confirm-late", 20);
    const html = await billing(s, "?refund=confirm");
    expect(html).not.toContain('action="/account/billing/refund"');
    expect(html).not.toContain(PANEL_HEAD);
  });

  it("a press without the box ticked shows the step again and asks Stripe nothing; without CSRF or from another site it is refused", async () => {
    const s = await subscriber("unticked");
    const token = await csrf(s.cookie, "/account/billing", { env: payEnv() });
    sent = [];
    const res = await post("/account/billing/refund", { csrf: token }, { cookie: s.cookie, env: payEnv() });
    expect(res.status).toBe(400);
    const html = decode(await res.text());
    expect(html).toContain("Tick the box to confirm.");
    expect(html).toContain('action="/account/billing/refund"');
    const fr = nbsp(decode(await (await post("/account/billing/refund", { csrf: token, lang: "fr" }, { cookie: s.cookie, env: payEnv() })).text()));
    expect(fr).toContain("Cochez la case pour confirmer.");
    expect((await post("/account/billing/refund", { confirm: "yes" }, { cookie: s.cookie, env: payEnv() })).status).toBe(403);
    expect((await post("/account/billing/refund", { csrf: "0".repeat(32), confirm: "yes" }, { cookie: s.cookie, env: payEnv() })).status).toBe(403);
    expect((await post("/account/billing/refund", { csrf: token, confirm: "yes" }, { cookie: s.cookie, env: payEnv(), origin: "https://evil.example" })).status).toBe(403);
    expect(sent).toEqual([]);
    expect(await auditOf(s.user)).toEqual([]);
    expect(await statusOf(s.user)).toBe("active");
  });
});

describe("the press", () => {
  it("reads Stripe, refunds the first payment's charge in full under its key, cancels at once, and records each step", async () => {
    const s = await subscriber("success", 3);
    const res = await press(s);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/billing?refund=done");
    // In order: the subscription, the customer's invoices and charges, the charge behind the first invoice, the refund, the cancellation.
    const pi = `pi_${s.sub.slice(4)}`;
    expect(stripeSent()).toEqual([
      `GET /v1/subscriptions/${s.sub}`, "GET /v1/invoices", "GET /v1/charges", "GET /v1/charges", "POST /v1/refunds", `DELETE /v1/subscriptions/${s.sub}`,
    ]);
    const [, invoiceList, chargeList, intentList, refund] = sent;
    expect(invoiceList.url.searchParams.get("customer")).toBe(s.cus);
    expect(invoiceList.url.searchParams.get("status")).toBe("paid");
    expect(chargeList.url.searchParams.get("customer")).toBe(s.cus);
    expect(intentList.url.searchParams.get("payment_intent")).toBe(pi);
    // No amount: the refund is the charge in full, which Stripe never lets exceed it.
    expect([...refund.form]).toEqual([["charge", s.charge]]);
    expect(refund.idempotencyKey).toBe(refundKey(s.charge));
    expect(refundsMade).toEqual([s.charge]);
    expect(subs.get(s.sub)?.status).toBe("canceled");
    expect(await statusOf(s.user)).toBe("canceled");
    expect(await auditOf(s.user)).toEqual([
      `refund_requested ${s.sub}`, "refund_made refund succeeded", "plan_changed stripe cancelled with the refund",
    ]);
  });

  it("in the seconds before Stripe's notice, the page says the refund is on its way and Pro still shows; the notices then end it", async () => {
    const s = await subscriber("before-notice");
    expect((await press(s)).status).toBe(303);
    const html = await billing(s, "?refund=done");
    expect(html).toContain('<p class="account-notice" role="status">Your first payment is being refunded in full, taxes included, and the subscription is cancelled. ' +
      "Pro ends when Stripe confirms the refund, usually within a minute. Reload this page to see it.</p>");
    expect(html).toContain("Your plan today: Pro, paid until");
    expect(html).not.toContain("Manage the subscription");
    expect(html).not.toContain(PANEL_HEAD);
    // The entitlement is the webhook's: the refund's notice, then the cancellation's.
    expect((await deliver(chargeRefunded(s.charge, s.cus))).status).toBe(200);
    expect((await deliver(subscriptionDeleted(s.sub, s.cus, s.user))).status).toBe(200);
    expect(await billing(s)).toContain("Your plan today: Free.");
    const after = await auditOf(s.user);
    expect(after).toContain("plan_changed stripe ended, refunded");
  });

  it("keeps the language: a French press returns to the French page", async () => {
    const s = await subscriber("press-fr");
    const res = await press(s, { lang: "fr" });
    expect(res.headers.get("location")).toBe("/account/billing?refund=done&lang=fr");
    const fr = nbsp(await billing(s, "?refund=done&lang=fr"));
    expect(fr).toContain("Votre premier paiement est en voie d’être remboursé en entier, taxes comprises, et l’abonnement est annulé.");
  });

  it("when Stripe refuses the refund: nothing cancelled, nothing recorded as refunded, the reader told to write", async () => {
    const s = await subscriber("refused");
    failing.add("POST /v1/refunds");
    const res = await press(s);
    expect(res.status).toBe(503);
    const html = decode(await res.text());
    expect(html).toContain("The refund did not go through, so nothing was changed: Pro and the subscription continue. " +
      "Write to contact@awardwatch.ca from your account's address to ask for the refund.");
    expect(stripeSent().filter((x) => x.startsWith("DELETE"))).toEqual([]);
    expect(refundsMade).toEqual([]);
    expect(await statusOf(s.user)).toBe("active");
    expect(await auditOf(s.user)).toEqual([`refund_requested ${s.sub}`, "refund_refused stripe refused"]);
    // The offer stands, so the reader may press again.
    expect(html).toContain(REFUND_LINK);
    // And in French.
    const fr = nbsp(decode(await (await press(s, { lang: "fr" })).text()));
    expect(fr).toContain("Le remboursement n’a pas abouti, donc rien n’a changé : Pro et l’abonnement continuent. Écrivez à contact@awardwatch.ca");
  });

  it("when Stripe cannot be reached before the refund: the same, and no refund asked", async () => {
    const s = await subscriber("unreachable");
    failing.add("GET /v1/subscriptions/:id");
    const res = await press(s);
    expect(res.status).toBe(503);
    expect(decode(await res.text())).toContain("The refund did not go through");
    expect(posts()).toEqual([]);
    failing.clear();
    failing.add("GET /v1/invoices");
    expect((await press(s)).status).toBe(503);
    expect(posts()).toEqual([]);
    expect(await auditOf(s.user)).toEqual([
      `refund_requested ${s.sub}`, "refund_refused stripe unreachable", `refund_requested ${s.sub}`, "refund_refused stripe unreachable",
    ]);
  });

  it("a refund whose answer is lost is read back from the charge, and the press goes on", async () => {
    const s = await subscriber("lost");
    lostAnswer = true;
    const res = await press(s);
    expect(res.headers.get("location")).toBe("/account/billing?refund=done");
    expect(refundsMade).toEqual([s.charge]);
    expect(stripeSent().slice(-3)).toEqual(["POST /v1/refunds", `GET /v1/charges/${s.charge}`, `DELETE /v1/subscriptions/${s.sub}`]);
    expect(await auditOf(s.user)).toContain("refund_made refund confirmed");
  });

  it("a refund asked while the same key is in flight is asked again and gets the one refund", async () => {
    const s = await subscriber("in-flight");
    inFlightOnce.add(refundKey(s.charge));
    const res = await press(s);
    expect(res.headers.get("location")).toBe("/account/billing?refund=done");
    const asks = sent.filter((x) => x.url.pathname === "/v1/refunds");
    expect(asks).toHaveLength(2);
    expect(new Set(asks.map((a) => a.idempotencyKey))).toEqual(new Set([refundKey(s.charge)]));
    expect(refundsMade).toEqual([s.charge]);
  });

  it("when the cancellation fails after the refund: the refund is on its way, and the daily check names the account and the subscription until it is cancelled", async () => {
    const s = await subscriber("cancel-fails");
    failing.add("DELETE /v1/subscriptions/:id");
    const res = await press(s);
    expect(res.headers.get("location")).toBe("/account/billing?refund=sent");
    expect(refundsMade).toEqual([s.charge]);
    expect(subs.get(s.sub)?.status).toBe("active");
    expect(await statusOf(s.user)).toBe("active");
    expect(await auditOf(s.user)).toEqual([`refund_requested ${s.sub}`, "refund_made refund succeeded", `refund_cancel_failed ${s.sub}`]);
    const html = await billing(s, "?refund=sent");
    expect(html).toContain("Your first payment is being refunded in full, taxes included. The subscription could not be cancelled at Stripe just now; " +
      "the site's operator is told and cancels it by hand.");
    expect(html).not.toContain(PANEL_HEAD);
    const fr = nbsp(await billing(s, "?refund=sent&lang=fr"));
    expect(fr).toContain("l’exploitant du site en est informé et l’annule lui-même.");

    const line = `A refund of a first payment pressed on the billing page went through, but its subscription can still bill: account ${s.user}, ` +
      `subscription ${s.sub}. Cancel it at once in the operator console (the account's page, Cancel the subscription, At once) or in Stripe's dashboard.`;
    const inputs = await gatherInputs({ ...testEnv(), ACCOUNTS, SEARCH: undefined } as never, new Date());
    expect(inputs.refundsToCancel).toContainEqual({ userId: s.user, subscriptionId: s.sub });
    // Word for word: the two ids are the line's only variables, so it holds no address and no amount.
    expect(collectAlerts(inputs)).toContain(line);
    // Stripe's refund notice changes nothing about the item; the cancellation's clears it.
    expect((await deliver(chargeRefunded(s.charge, s.cus))).status).toBe(200);
    expect(collectAlerts(await gatherInputs({ ...testEnv(), ACCOUNTS, SEARCH: undefined } as never, new Date()))).toContain(line);
    expect((await deliver(subscriptionDeleted(s.sub, s.cus, s.user))).status).toBe(200);
    const cleared = await gatherInputs({ ...testEnv(), ACCOUNTS, SEARCH: undefined } as never, new Date());
    expect(cleared.refundsToCancel).not.toContainEqual({ userId: s.user, subscriptionId: s.sub });
  });

  it("a refund taken whose answer never came back: the reader is told it did not go through, and Stripe's notice puts it on the daily check", async () => {
    const s = await subscriber("never-back");
    lostAnswer = true;
    failing.add("GET /v1/charges/:id");
    const res = await press(s);
    expect(res.status).toBe(503);
    expect(stripeSent().filter((x) => x.startsWith("DELETE"))).toEqual([]);
    expect(await auditOf(s.user)).toEqual([`refund_requested ${s.sub}`, "refund_refused stripe refused"]);
    const item = { userId: s.user, subscriptionId: s.sub };
    expect((await gatherInputs({ ...testEnv(), ACCOUNTS, SEARCH: undefined } as never, new Date())).refundsToCancel).not.toContainEqual(item);
    expect((await deliver(chargeRefunded(s.charge, s.cus))).status).toBe(200);
    expect((await gatherInputs({ ...testEnv(), ACCOUNTS, SEARCH: undefined } as never, new Date())).refundsToCancel).toContainEqual(item);
  });

  it("a double submit makes one refund; a later press is told it is refunded already and asks Stripe nothing", async () => {
    const s = await subscriber("double");
    const token = await csrf(s.cookie, "/account/billing", { env: payEnv() });
    sent = [];
    const both = await Promise.all([1, 2].map(() => post("/account/billing/refund", { csrf: token, confirm: "yes" }, { cookie: s.cookie, env: payEnv() })));
    // Each is the refund made (the second given the first's refund back under the key) or, when the
    // first finished before the second read the rows, told it is refunded already.
    const outcomes = both.map((r) => (r.status === 303 ? r.headers.get("location") : String(r.status)));
    expect(outcomes).toContain("/account/billing?refund=done");
    for (const o of outcomes) expect(["/account/billing?refund=done", "409"]).toContain(o);
    expect(refundsMade).toEqual([s.charge]);
    expect(new Set(sent.filter((x) => x.url.pathname === "/v1/refunds").map((x) => x.idempotencyKey))).toEqual(new Set([refundKey(s.charge)]));
    const again = await press(s);
    expect(again.status).toBe(409);
    expect(decode(await again.text())).toContain("A payment of this account has been refunded already, so nothing more was refunded.");
    expect(sent).toEqual([]);
    expect((await auditOf(s.user)).at(-1)).toBe("refund_refused refunded already");
  });

  it("past the window: refused from the site's rows, and from Stripe's own time when the rows still offer it", async () => {
    const late = await subscriber("past-window", 16);
    const res = await press(late);
    expect(res.status).toBe(409);
    expect(decode(await res.text())).toContain("The 14 days after your first payment have passed, so nothing was refunded. Write to contact@awardwatch.ca");
    expect(sent).toEqual([]);
    expect(await auditOf(late.user)).toEqual(["refund_refused window"]);
    // The row says 13 days, Stripe's charge 15: Stripe's figure decides.
    const s = await subscriber("stripe-window", 13);
    const ch = charges.get(s.charge)!;
    ch.created = nowS() - 15 * DAY_S;
    const r = await press(s);
    expect(r.status).toBe(409);
    expect(decode(await r.text())).toContain("The 14 days after your first payment have passed");
    expect(posts()).toEqual([]);
    expect(await auditOf(s.user)).toEqual([`refund_requested ${s.sub}`, "refund_refused window"]);
    const fr = nbsp(decode(await (await press(late, { lang: "fr" })).text()));
    expect(fr).toContain("Les 14 jours suivant votre premier paiement sont écoulés, donc rien n’a été remboursé.");
  });

  it("a charge Stripe already refunded, whose notice has not arrived: refused, no second refund", async () => {
    const s = await subscriber("already");
    const ch = charges.get(s.charge)!;
    ch.amount_refunded = ch.amount;
    ch.refunded = true;
    const res = await press(s);
    expect(res.status).toBe(409);
    expect(decode(await res.text())).toContain("A payment of this account has been refunded already");
    expect(posts()).toEqual([]);
    expect(await auditOf(s.user)).toEqual([`refund_requested ${s.sub}`, "refund_refused refunded"]);
  });

  it("a second payment Stripe holds that the site has not heard of: refused, the first never refunded", async () => {
    const s = await subscriber("second-at-stripe");
    payment(s.sub, s.cus, { suffix: "b" });
    const res = await press(s);
    expect(res.status).toBe(409);
    expect(decode(await res.text())).toContain("This account's first payment cannot be refunded from this page, so nothing was refunded. Write to contact@awardwatch.ca");
    expect(posts()).toEqual([]);
    expect(await auditOf(s.user)).toEqual([`refund_requested ${s.sub}`, "refund_refused not first"]);
  });

  it("acts on the account's own subscription only: the form's fields are ignored, and a subscription naming another account is refused", async () => {
    const a = await subscriber("own-a");
    const b = await subscriber("own-b");
    const res = await press(a, { subscription: b.sub, charge: b.charge, customer: b.cus, user: b.user });
    expect(res.headers.get("location")).toBe("/account/billing?refund=done");
    expect(refundsMade).toEqual([a.charge]);
    expect(subs.get(b.sub)?.status).toBe("active");
    expect(stripeSent().join(" ")).not.toContain(b.sub);
    // The subscription's metadata names someone else: nothing is refunded.
    const c = await subscriber("own-c");
    (subs.get(c.sub)!.metadata as Obj).user_id = b.user;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const other = await press(c);
    quiet.mockRestore();
    expect(other.status).toBe(409);
    expect(posts()).toEqual([]);
    expect(await auditOf(c.user)).toEqual([`refund_requested ${c.sub}`, "refund_refused another account"]);
  });

  it("refuses a charge whose figures are not the invoice's, and never reads card data into the page or the audit", async () => {
    const s = await subscriber("figures");
    invoices.find((i) => i.customer === s.cus)!.amount_paid = 1800;
    const res = await press(s);
    expect(res.status).toBe(409);
    const html = await res.text();
    expect(posts()).toEqual([]);
    expect(await auditOf(s.user)).toEqual([`refund_requested ${s.sub}`, "refund_refused figures"]);
    for (const secret of ["4242", "cardholder@example.com", "Card Holder", "19.00", "18.00"]) expect(html, secret).not.toContain(secret);
  });
});

describe("the rules the press decides by", () => {
  const base = {
    invoiceId: "in_1", subscriptionId: "sub_1", invoiceAmount: 1900, invoiceCurrency: "cad", paidInvoices: 1, paidCharges: ["ch_1"],
    refundedCharges: 0, disputedCharges: 0, complete: true,
    chargeId: "ch_1", amount: 1900, refunded: 0, currency: "cad", paidAt: new Date().toISOString(), customerId: "cus_1", disputed: false,
  };
  const bound = { subscriptionId: "sub_1", customerId: "cus_1" };
  const at = (days: number) => new Date(Date.now() - days * DAY_S * 1000).toISOString();

  it("allow the customer's only payment within the 14 days, and nothing else", () => {
    const now = new Date();
    expect(refundVerdict(base, bound, now)).toBeNull();
    expect(refundVerdict({ ...base, paidAt: at(REFUND_DAYS - 1 / 1440) }, bound, now)).toBeNull();
    expect(refundVerdict({ ...base, paidAt: at(REFUND_DAYS + 1 / 1440) }, bound, now)).toBe("window");
    expect(refundVerdict({ ...base, paidAt: null }, bound, now)).toBe("window");
    expect(refundVerdict({ ...base, paidInvoices: 2 }, bound, now)).toBe("not first");
    expect(refundVerdict({ ...base, paidCharges: ["ch_1", "ch_2"] }, bound, now)).toBe("not first");
    expect(refundVerdict({ ...base, paidCharges: ["ch_0"] }, bound, now)).toBe("not first");
    expect(refundVerdict({ ...base, complete: false }, bound, now)).toBe("not first");
    expect(refundVerdict({ ...base, subscriptionId: "sub_0" }, bound, now)).toBe("not first");
    expect(refundVerdict({ ...base, subscriptionId: null }, bound, now)).toBe("not first");
    expect(refundVerdict({ ...base, refunded: 1 }, bound, now)).toBe("refunded");
    expect(refundVerdict({ ...base, refundedCharges: 1 }, bound, now)).toBe("refunded");
    expect(refundVerdict({ ...base, disputed: true }, bound, now)).toBe("disputed");
    expect(refundVerdict({ ...base, customerId: "cus_0" }, bound, now)).toBe("figures");
    expect(refundVerdict({ ...base, customerId: null }, bound, now)).toBe("figures");
    expect(refundVerdict({ ...base, amount: 2000 }, bound, now)).toBe("figures");
    expect(refundVerdict({ ...base, currency: "usd" }, bound, now)).toBe("figures");
  });

  it("the daily check reads its items in their own shapes only", () => {
    const u = "a".repeat(32);
    expect(readRefundsToCancel({ items: `${u} sub_A1,${u} sub_B2` })).toEqual([{ userId: u, subscriptionId: "sub_A1" }, { userId: u, subscriptionId: "sub_B2" }]);
    expect(readRefundsToCancel({ items: null })).toEqual([]);
    expect(readRefundsToCancel({ n: 1 })).toEqual([]);
    expect(readRefundsToCancel({ items: `${u} sub_A1 extra,someone@example.com sub_A1,${u} cus_1` })).toEqual([]);
    expect(REFUNDS_TO_CANCEL_SQL).toContain("refund_cancel_failed");
  });
});

describe("the words", () => {
  const TERMS_EN = "To ask, press Refund now on the account's billing page; if the button is not there or the refund does not go through, " +
    "write to contact@awardwatch.ca from the account's address.";
  const TERMS_FR = "Pour le demander, appuyez sur Rembourser maintenant à la page de facturation du compte; si le bouton n’y figure pas ou si le " +
    "remboursement n’aboutit pas, écrivez à contact@awardwatch.ca depuis l’adresse du compte.";

  it("the Terms name the button first and keep the address, in both languages, with the switch off as on", async () => {
    for (const env of [testEnv(), payEnv()]) {
      const en = decode(await (await get("/terms", { env })).text());
      expect(en).toContain(TERMS_EN);
      expect(en).not.toContain("Write to contact@awardwatch.ca from the account's address.");
      const fr = nbsp(decode(await (await get("/terms?lang=fr", { env })).text()));
      expect(fr).toContain(TERMS_FR);
      for (const page of [en, fr]) {
        expect(page).not.toContain(EM_DASH);
        expect(page).not.toContain(EN_DASH);
      }
    }
  });

  it("the Pro page's answer says the same, in both languages; with the switch off the page is the 404 it was", async () => {
    const en = decode(await (await get("/pro", { env: payEnv() })).text());
    expect(en).toContain("<h3>Can I get a refund?</h3><p>Yes, of your first payment: press Refund now under Plan and Billing in your account within 14 days of it. " +
      "If the button is not there or the refund does not go through, write to contact@awardwatch.ca from your account's address. " +
      "It is refunded in full, taxes included, and the subscription ends. This applies once per account; later payments are not refunded.</p>");
    const fr = nbsp(decode(await (await get("/pro?lang=fr", { env: payEnv() })).text()));
    expect(fr).toContain("Oui, pour votre premier paiement : appuyez sur Rembourser maintenant sous Forfait et facturation, dans votre compte, " +
      "dans les 14 jours qui le suivent. Si le bouton n’y figure pas ou si le remboursement n’aboutit pas, écrivez à contact@awardwatch.ca");
    expect((await get("/pro", { env: testEnv() })).status).toBe(404);
  });
});

describe("the docs", () => {
  it("say how the refund works, what the operator sees and what to check after the first real one", async () => {
    const docs = ((await import("../../docs/accounts.md?raw")).default as string).replace(/\s+/g, " ");
    for (const s of [
      "`POST /account/billing/refund`", "Refund now", `${REFUND_DAYS} days`, "refund_requested", "refund_refused", "refund_made",
      "refund_cancel_failed", "stripe cancelled with the refund", "can still bill", "After the first real refund",
    ]) expect(docs, s).toContain(s);
    expect(docs).not.toContain(EM_DASH);
  });
});
