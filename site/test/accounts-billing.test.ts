// Phase 3, payments: the Stripe source (src/account/stripe.ts) and the
// billing pages and webhook (src/account/billing.tsx), against the local
// accounts database with the switch on. Stripe itself is a fake fetch that
// records every request and answers from a table; the webhook's notices are
// signed here with WebCrypto, independently of the code under test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_DAYS, GRACE_DAYS } from "../src/account/billing";
import { planFor } from "../src/account/entitlements";
import { STRIPE_VERSION, readEvent, signatureValid } from "../src/account/stripe";
import { app } from "../src/index";
import { testEnv } from "./assets";
import { ACCOUNTS, csrf, decode, get, newEmail, nbsp, nextIp, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";

useAccountsDb();

const SECRET_KEY = "sk_test_fake0000";
const WEBHOOK_SECRET = "whsec_fake0000";
// Test figures, not the site's prices: the code holds none.
const KEYS = {
  STRIPE_SECRET_KEY: SECRET_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PRICE_MONTHLY: "price_monthlyTEST", STRIPE_PRICE_YEARLY: "price_yearlyTEST",
  PRICE_MONTHLY_CAD: "12", PRICE_YEARLY_CAD: "120.50",
};
const payEnv = (extra: Record<string, unknown> = {}) => onEnv({ ...KEYS, ...extra });

// The billing page's plan cards (src/pro.tsx PlanCards): Free, then Pro to the panel's end.
const cardsOf = (html: string): string[] => {
  const at = html.indexOf('<div class="plan-cards"');
  return html.slice(at, html.indexOf("</section>", at)).split(/(?=<div class="plan-card[ "])/).slice(1);
};

// -- a fake Stripe ------------------------------------------------------------------

type Sent = { method: string; url: string; headers: Record<string, string>; form: URLSearchParams };
type Reply = { status?: number; body?: unknown };

const DAY_S = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);
const iso = (s: number) => new Date(s * 1000).toISOString();

let sent: Sent[] = [];
// Subscriptions the fake knows, by id; GET answers from here.
let subs: Map<string, Record<string, unknown>> = new Map();
let failing: Set<string> = new Set();

function subscriptionObject(id: string, customer: string, status: string, periodEnd: number, user: string | null) {
  return {
    id, object: "subscription", customer, status, cancel_at_period_end: false,
    items: { object: "list", data: [{ id: `si_${id}`, object: "subscription_item", current_period_end: periodEnd, current_period_start: periodEnd - 30 * DAY_S }] },
    metadata: user ? { user_id: user } : {},
  };
}

function answer(method: string, path: string): Reply {
  const key = `${method} ${path.replace(/\/sub_[A-Za-z0-9_]+$/, "/:id")}`;
  if (failing.has(key)) return { status: 500, body: { error: { message: "down" } } };
  if (key === "POST /v1/checkout/sessions") return { body: { id: "cs_test_1", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_test_1#fragment" } };
  if (key === "POST /v1/billing_portal/sessions") return { body: { id: "bps_1", object: "billing_portal.session", url: "https://billing.stripe.com/p/session/test_1" } };
  const id = path.split("/").pop() ?? "";
  if (key === "GET /v1/subscriptions/:id") return subs.has(id) ? { body: subs.get(id) } : { status: 404, body: { error: { code: "resource_missing" } } };
  if (key === "DELETE /v1/subscriptions/:id") {
    const s = subs.get(id);
    if (!s) return { status: 404, body: {} };
    s.status = "canceled";
    return { body: s };
  }
  return { status: 400, body: { error: { message: `unexpected ${key}` } } };
}

beforeEach(() => {
  sent = [];
  subs = new Map();
  failing = new Set();
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.stripe.com/")) return real(input, init);
    const method = init?.method ?? "GET";
    sent.push({
      method, url, headers: { ...(init?.headers as Record<string, string>) },
      form: new URLSearchParams(typeof init?.body === "string" ? init.body : ""),
    });
    const reply = answer(method, new URL(url).pathname);
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -- signing and sending notices -----------------------------------------------------

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signatureFor(body: string, o: { secret?: string; t?: number } = {}): Promise<string> {
  const t = o.t ?? nowS();
  return `t=${t},v1=${await hmacHex(o.secret ?? WEBHOOK_SECRET, `${t}.${body}`)}`;
}

let eventN = 0;
const eventId = () => `evt_test${Date.now().toString(36)}${eventN++}`;

async function deliver(event: object, o: { header?: string | null; secret?: string; t?: number; env?: object } = {}): Promise<Response> {
  const body = JSON.stringify(event);
  const headers: Record<string, string> = { "content-type": "application/json", "cf-connecting-ip": nextIp() };
  const header = o.header === undefined ? await signatureFor(body, o) : o.header;
  if (header !== null) headers["stripe-signature"] = header;
  return app.request("/account/billing/webhook", { method: "POST", headers, body }, o.env ?? payEnv());
}

const event = (type: string, object: object, id = eventId()) => ({ id, object: "event", type, api_version: STRIPE_VERSION, data: { object } });

const checkoutCompleted = (user: string, sub: string, cus: string, paymentStatus = "paid") => event("checkout.session.completed", {
  id: `cs_test_${sub}`, object: "checkout.session", mode: "subscription", client_reference_id: user, customer: cus, subscription: sub,
  payment_status: paymentStatus, status: "complete",
});

// An invoice in the current shape (the subscription under parent), or the
// older one (the subscription at the top) with older: true.
const invoicePaid = (sub: string, cus: string, periodEnd: number, user: string | null, older = false) => event("invoice.paid", {
  id: `in_${sub}_${periodEnd}`, object: "invoice", customer: cus, status: "paid", billing_reason: "subscription_cycle",
  period_end: periodEnd - 30 * DAY_S,
  ...(older
    ? { subscription: sub, subscription_details: { metadata: user ? { user_id: user } : {} } }
    : { parent: { type: "subscription_details", subscription_details: { subscription: sub, metadata: user ? { user_id: user } : {} } } }),
  lines: { object: "list", data: [{ id: "il_1", object: "line_item", period: { start: periodEnd - 30 * DAY_S, end: periodEnd } }] },
});

const subscriptionEvent = (type: "updated" | "deleted", sub: string, cus: string, status: string, periodEnd: number, user: string | null) =>
  event(`customer.subscription.${type}`, subscriptionObject(sub, cus, status, periodEnd, user));

// -- reading state ---------------------------------------------------------------------

async function planOf(email: string) {
  const id = await userId(email);
  const holder = await ACCOUNTS.prepare("SELECT id, plan, plan_until FROM users WHERE id = ?").bind(id).first<{ id: string; plan: string; plan_until: string | null }>();
  return planFor(payEnv() as never, holder!);
}

const rows = async (email: string) =>
  ((await ACCOUNTS.prepare("SELECT plan, source, starts_at, ends_at, reference, revoked_at FROM entitlements WHERE user_id = ? ORDER BY created_at, id")
    .bind(await userId(email)).all<Record<string, string | null>>()).results ?? []);

const binding = async (email: string) =>
  ACCOUNTS.prepare("SELECT customer_id, subscription_id, status, current_period_end FROM payment_customers WHERE user_id = ?")
    .bind(await userId(email)).first<Record<string, string | null>>();

const eventsNamed = async (id: string) =>
  (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE id = ?").bind(id).first<{ n: number }>())?.n ?? 0;

let serial = 0;
const ids = () => {
  serial++;
  const tag = `${Date.now().toString(36)}${serial}`;
  return { sub: `sub_${tag}`, cus: `cus_${tag}` };
};

// A signed-in user with a paid checkout behind them: Pro to periodEnd plus the grace.
async function subscriber(tag = "pro", periodEnd = nowS() + 30 * DAY_S) {
  const email = newEmail(tag);
  const cookie = await signIn(email, { env: payEnv() });
  const user = await userId(email);
  const { sub, cus } = ids();
  subs.set(sub, subscriptionObject(sub, cus, "active", periodEnd, user));
  expect((await deliver(checkoutCompleted(user, sub, cus))).status).toBe(200);
  return { email, cookie, user, sub, cus, periodEnd };
}

// =====================================================================================

describe("the webhook's signature", () => {
  const body = enc.encode('{"id":"evt_1","type":"invoice.paid"}');
  const text = '{"id":"evt_1","type":"invoice.paid"}';

  it("is good when an HMAC-SHA256 of t.payload under the endpoint secret matches a v1", async () => {
    const t = nowS();
    expect(await signatureValid(body, await signatureFor(text, { t }), WEBHOOK_SECRET, t)).toBe(true);
    // Several v1 (a secret being rolled) and a v0 test signature: one v1 match is enough, v0 is ignored.
    const header = `t=${t},v1=${"0".repeat(64)},v1=${await hmacHex(WEBHOOK_SECRET, `${t}.${text}`)},v0=${"f".repeat(64)}`;
    expect(await signatureValid(body, header, WEBHOOK_SECRET, t)).toBe(true);
  });

  it("is bad under another secret, over another body, with only a v0, or without a header", async () => {
    const t = nowS();
    expect(await signatureValid(body, await signatureFor(text, { t, secret: "whsec_other" }), WEBHOOK_SECRET, t)).toBe(false);
    expect(await signatureValid(enc.encode(`${text} `), await signatureFor(text, { t }), WEBHOOK_SECRET, t)).toBe(false);
    expect(await signatureValid(body, `t=${t},v0=${await hmacHex(WEBHOOK_SECRET, `${t}.${text}`)}`, WEBHOOK_SECRET, t)).toBe(false);
    expect(await signatureValid(body, null, WEBHOOK_SECRET, t)).toBe(false);
    expect(await signatureValid(body, "garbage", WEBHOOK_SECRET, t)).toBe(false);
  });

  it("is stale past five minutes either way, and good inside them", async () => {
    const t = nowS();
    const header = await signatureFor(text, { t });
    expect(await signatureValid(body, header, WEBHOOK_SECRET, t + 300)).toBe(true);
    expect(await signatureValid(body, header, WEBHOOK_SECRET, t + 301)).toBe(false);
    expect(await signatureValid(body, header, WEBHOOK_SECRET, t - 301)).toBe(false);
  });

  it("at the route: an unverified post answers 400 and writes nothing", async () => {
    const email = newEmail("unverified");
    await signIn(email, { env: payEnv() });
    const user = await userId(email);
    const { sub, cus } = ids();
    subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, user));
    const count = async () => (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM payment_events").first<{ n: number }>())?.n ?? 0;
    const before = await count();
    const notice = checkoutCompleted(user, sub, cus);
    for (const o of [{ secret: "whsec_other" }, { t: nowS() - 600 }, { header: null }, { header: "t=1,v1=00" }]) {
      const res = await deliver(notice, o);
      expect(res.status, JSON.stringify(o)).toBe(400);
    }
    expect(await count()).toBe(before);
    expect(await rows(email)).toEqual([]);
    expect(await binding(email)).toBeNull();
    expect(sent).toEqual([]);
    // The same notice, signed, goes through.
    expect((await deliver(notice)).status).toBe(200);
    expect(await rows(email)).toHaveLength(1);
  });

  it("at the route: without Stripe's keys every notice is unverified", async () => {
    const res = await deliver(event("invoice.paid", {}), { env: onEnv() });
    expect(res.status).toBe(400);
  });
});

describe("the webhook's notices", () => {
  it("take each event once: a second delivery answers 200 and changes nothing", async () => {
    const { email, user, sub, cus } = await subscriber("twice");
    const later = nowS() + 60 * DAY_S;
    const renewal = invoicePaid(sub, cus, later, user);
    expect((await deliver(renewal)).status).toBe(200);
    const after = await rows(email);
    const again = await deliver(renewal);
    expect(again.status).toBe(200);
    expect(await again.text()).toBe("Already received.");
    expect(await rows(email)).toEqual(after);
    expect(await eventsNamed(renewal.id)).toBe(1);
  });

  it("record an unknown type and answer 200", async () => {
    const unknown = event("payment_intent.created", { id: "pi_1", object: "payment_intent" });
    const res = await deliver(unknown);
    expect(res.status).toBe(200);
    expect(await eventsNamed(unknown.id)).toBe(1);
    expect(await ACCOUNTS.prepare("SELECT type FROM payment_events WHERE id = ?").bind(unknown.id).first()).toEqual({ type: "payment_intent.created" });
  });

  it("checkout.session.completed: binds the customer and grants Pro to the period end plus the grace", async () => {
    const email = newEmail("checkout");
    await signIn(email, { env: payEnv() });
    const user = await userId(email);
    expect(await planOf(email)).toMatchObject({ plan: "free", until: null });
    const { sub, cus } = ids();
    const periodEnd = nowS() + 30 * DAY_S;
    subs.set(sub, subscriptionObject(sub, cus, "active", periodEnd, user));
    expect((await deliver(checkoutCompleted(user, sub, cus))).status).toBe(200);
    // The session names the subscription; its period comes from reading it.
    expect(sent.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([`GET /v1/subscriptions/${sub}`]);
    expect(sent[0].headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(sent[0].headers["stripe-version"]).toBe(STRIPE_VERSION);
    expect(GRACE_DAYS).toBe(3);
    const until = iso(periodEnd + GRACE_DAYS * DAY_S);
    expect(await rows(email)).toEqual([expect.objectContaining({ plan: "pro", source: "stripe", ends_at: until, reference: sub, revoked_at: null })]);
    expect(await binding(email)).toEqual({ customer_id: cus, subscription_id: sub, status: "active", current_period_end: iso(periodEnd) });
    expect(await planOf(email)).toMatchObject({ plan: "pro", until });
    // The users cache followed.
    expect(await ACCOUNTS.prepare("SELECT plan, plan_until FROM users WHERE id = ?").bind(user).first()).toEqual({ plan: "pro", plan_until: until });
    // The audit names the change, no address and no amount.
    const audit = (await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE user_id = ? AND event = 'plan_changed'").bind(user).all<{ detail: string }>()).results ?? [];
    expect(audit.map((a) => a.detail)).toEqual(["stripe checkout, granted"]);
  });

  it("checkout.session.completed while a bank debit clears: binds, grants nothing until invoice.paid", async () => {
    const email = newEmail("unpaid");
    await signIn(email, { env: payEnv() });
    const user = await userId(email);
    const { sub, cus } = ids();
    const periodEnd = nowS() + 30 * DAY_S;
    subs.set(sub, subscriptionObject(sub, cus, "active", periodEnd, user));
    expect((await deliver(checkoutCompleted(user, sub, cus, "unpaid"))).status).toBe(200);
    expect(await rows(email)).toEqual([]);
    expect((await binding(email))?.subscription_id).toBe(sub);
    expect(await planOf(email)).toMatchObject({ plan: "free" });
    expect((await deliver(invoicePaid(sub, cus, periodEnd, user))).status).toBe(200);
    expect(await planOf(email)).toMatchObject({ plan: "pro", until: iso(periodEnd + GRACE_DAYS * DAY_S) });
  });

  it("checkout.session.completed answers 500 and keeps no record when the subscription cannot be read, so Stripe's retry applies it", async () => {
    const email = newEmail("retry");
    await signIn(email, { env: payEnv() });
    const user = await userId(email);
    const { sub, cus } = ids();
    subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, user));
    const notice = checkoutCompleted(user, sub, cus);
    failing.add("GET /v1/subscriptions/:id");
    expect((await deliver(notice)).status).toBe(500);
    expect(await eventsNamed(notice.id)).toBe(0);
    expect(await rows(email)).toEqual([]);
    failing.clear();
    expect((await deliver(notice)).status).toBe(200);
    expect(await planOf(email)).toMatchObject({ plan: "pro" });
  });

  it("checkout.session.completed for an account deleted meanwhile cancels the subscription and grants nothing", async () => {
    const email = newEmail("gone");
    await signIn(email, { env: payEnv() });
    const user = await userId(email);
    await ACCOUNTS.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").bind(user).run();
    const { sub, cus } = ids();
    subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, user));
    expect((await deliver(checkoutCompleted(user, sub, cus))).status).toBe(200);
    expect(sent.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([`DELETE /v1/subscriptions/${sub}`]);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?").bind(user).first()).toEqual({ n: 0 });
  });

  it("invoice.paid extends the live row to the new period end plus the grace, never shortening it", async () => {
    const { email, user, sub, cus } = await subscriber("renew");
    const next = nowS() + 61 * DAY_S;
    expect((await deliver(invoicePaid(sub, cus, next, user))).status).toBe(200);
    const after = await rows(email);
    expect(after).toHaveLength(1);
    expect(after[0].ends_at).toBe(iso(next + GRACE_DAYS * DAY_S));
    expect(await planOf(email)).toMatchObject({ plan: "pro", until: iso(next + GRACE_DAYS * DAY_S) });
    expect((await binding(email))?.current_period_end).toBe(iso(next));
    // An older invoice delivered late changes nothing.
    expect((await deliver(invoicePaid(sub, cus, next - 30 * DAY_S, user))).status).toBe(200);
    expect((await rows(email))[0].ends_at).toBe(iso(next + GRACE_DAYS * DAY_S));
  });

  it("invoice.paid writes a row when none is live, finding the user by the subscription's metadata (either invoice shape)", async () => {
    for (const older of [false, true]) {
      const email = newEmail(older ? "older-shape" : "first-invoice");
      await signIn(email, { env: payEnv() });
      const user = await userId(email);
      const { sub, cus } = ids();
      const periodEnd = nowS() + 30 * DAY_S;
      expect(await planOf(email)).toMatchObject({ plan: "free" });
      expect((await deliver(invoicePaid(sub, cus, periodEnd, user, older))).status).toBe(200);
      expect(await rows(email)).toEqual([expect.objectContaining({ plan: "pro", source: "stripe", reference: sub, ends_at: iso(periodEnd + GRACE_DAYS * DAY_S) })]);
      expect(await planOf(email)).toMatchObject({ plan: "pro" });
      expect((await binding(email))?.customer_id).toBe(cus);
    }
  });

  it("invoice.paid for no known account, or for a subscription already ended, grants nothing", async () => {
    const stray = invoicePaid("sub_nobody", "cus_nobody", nowS() + 30 * DAY_S, null);
    expect((await deliver(stray)).status).toBe(200);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE reference = 'sub_nobody'").first()).toEqual({ n: 0 });
    const { email, user, sub, cus } = await subscriber("ended-late");
    expect((await deliver(subscriptionEvent("deleted", sub, cus, "canceled", nowS() + 30 * DAY_S, user))).status).toBe(200);
    expect(await planOf(email)).toMatchObject({ plan: "free" });
    expect((await deliver(invoicePaid(sub, cus, nowS() + 60 * DAY_S, user))).status).toBe(200);
    expect(await planOf(email)).toMatchObject({ plan: "free" });
  });

  it("customer.subscription.updated records the status; past_due keeps Pro through the grace", async () => {
    const { email, user, sub, cus, periodEnd } = await subscriber("past-due");
    expect((await deliver(subscriptionEvent("updated", sub, cus, "past_due", periodEnd, user))).status).toBe(200);
    expect((await binding(email))?.status).toBe("past_due");
    expect(await planOf(email)).toMatchObject({ plan: "pro", until: iso(periodEnd + GRACE_DAYS * DAY_S) });
  });

  it("customer.subscription.updated to canceled, unpaid or incomplete_expired ends Pro now", async () => {
    for (const status of ["canceled", "unpaid", "incomplete_expired"]) {
      const { email, user, sub, cus, periodEnd } = await subscriber(`to-${status}`);
      expect(await planOf(email)).toMatchObject({ plan: "pro" });
      const before = new Date().toISOString();
      expect((await deliver(subscriptionEvent("updated", sub, cus, status, periodEnd, user))).status).toBe(200);
      const [row] = await rows(email);
      expect(row.ends_at! >= before && row.ends_at! <= new Date().toISOString(), status).toBe(true);
      expect(await planOf(email), status).toMatchObject({ plan: "free", until: null });
      expect((await binding(email))?.status).toBe(status);
    }
  });

  it("customer.subscription.deleted ends Pro now, and the overview says Free again", async () => {
    const { email, cookie, user, sub, cus, periodEnd } = await subscriber("deleted");
    expect(decode(await (await get("/account", { cookie, env: payEnv() })).text())).toContain("<dd>Pro, paid until");
    expect((await deliver(subscriptionEvent("deleted", sub, cus, "canceled", periodEnd, user))).status).toBe(200);
    expect(await planOf(email)).toMatchObject({ plan: "free" });
    expect(await (await get("/account", { cookie, env: payEnv() })).text()).toContain("<dd>Free</dd>");
  });

  it("are read from either API shape: the period end on the items or on the subscription", () => {
    const end = nowS() + 30 * DAY_S;
    const current = readEvent(event("customer.subscription.updated", subscriptionObject("sub_a", "cus_a", "active", end, null)));
    const older = readEvent(event("customer.subscription.updated", { id: "sub_b", customer: "cus_b", status: "active", current_period_end: end, metadata: {} }));
    for (const r of [current, older]) {
      expect(r.ok && r.notice.kind === "subscription" && r.notice.subscription.periodEnd).toBe(iso(end));
    }
    expect(readEvent({ id: "nope", type: "invoice.paid" })).toEqual({ ok: false });
    expect(readEvent(event("checkout.session.completed", { mode: "payment", client_reference_id: "a".repeat(32), customer: "cus", subscription: "sub" }))).toMatchObject({ ok: true, notice: { kind: "other" } });
  });
});

describe("checkout and the portal", () => {
  it("POST /account/billing/checkout creates a subscription-mode Checkout Session and redirects to it", async () => {
    const email = newEmail("buyer");
    const cookie = await signIn(email, { env: payEnv() });
    const token = await csrf(cookie, "/account/billing", { env: payEnv() });
    const res = await post("/account/billing/checkout", { csrf: token, interval: "yearly", lang: "en" }, { cookie, env: payEnv() });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_test_1#fragment");
    expect(sent).toHaveLength(1);
    const [req] = sent;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(req.headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(req.headers["stripe-version"]).toBe(STRIPE_VERSION);
    expect(req.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(req.form)).toEqual({
      mode: "subscription",
      "line_items[0][price]": "price_yearlyTEST",
      "line_items[0][quantity]": "1",
      client_reference_id: await userId(email),
      "subscription_data[metadata][user_id]": await userId(email),
      "managed_payments[enabled]": "true",
      success_url: "http://localhost/account?billing=done",
      cancel_url: "http://localhost/account/billing",
      locale: "en",
      customer_email: email,
    });
  });

  it("in French: the French locale, and the return addresses keep the language; a returning customer is named, not their address", async () => {
    const { email, cookie, sub, cus, user, periodEnd } = await subscriber("again");
    await deliver(subscriptionEvent("deleted", sub, cus, "canceled", periodEnd, user));
    sent = [];
    const token = await csrf(cookie, "/account/billing", { env: payEnv() });
    const res = await post("/account/billing/checkout", { csrf: token, interval: "monthly", lang: "fr" }, { cookie, env: payEnv() });
    expect(res.status).toBe(303);
    const form = Object.fromEntries(sent[0].form);
    expect(form).toMatchObject({
      "line_items[0][price]": "price_monthlyTEST", locale: "fr-CA", customer: cus,
      success_url: "http://localhost/account?billing=done&lang=fr", cancel_url: "http://localhost/account/billing?lang=fr",
    });
    expect(form.customer_email).toBeUndefined();
    // Managed Payments is asked for on every session (it applies only to a
    // session that asks); it computes the tax itself, so the two parameters
    // it has no use for are never sent.
    expect(form["managed_payments[enabled]"]).toBe("true");
    expect(form["automatic_tax[enabled]"]).toBeUndefined();
    expect(form["customer_update[address]"]).toBeUndefined();
    expect(JSON.stringify(form)).not.toContain(email);
  });

  it("refuses without the CSRF value, from another site, or with an unknown interval, and asks Stripe nothing", async () => {
    const cookie = await signIn(newEmail("csrf"), { env: payEnv() });
    const token = await csrf(cookie, "/account/billing", { env: payEnv() });
    expect((await post("/account/billing/checkout", { interval: "monthly" }, { cookie, env: payEnv() })).status).toBe(403);
    expect((await post("/account/billing/checkout", { csrf: "0".repeat(32), interval: "monthly" }, { cookie, env: payEnv() })).status).toBe(403);
    expect((await post("/account/billing/checkout", { csrf: token, interval: "monthly" }, { cookie, env: payEnv(), origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/account/billing/checkout", { csrf: token, interval: "weekly" }, { cookie, env: payEnv() })).status).toBe(400);
    expect((await post("/account/billing/portal", { csrf: "0".repeat(32) }, { cookie, env: payEnv() })).status).toBe(403);
    expect((await post("/account/billing/portal", { csrf: token }, { cookie, env: payEnv(), origin: "https://evil.example" })).status).toBe(403);
    // Signed out: to sign-in, as every account page.
    expect((await post("/account/billing/checkout", { csrf: token, interval: "monthly" }, { env: payEnv() })).headers.get("location")).toBe("/account/sign-in");
    expect(sent).toEqual([]);
  });

  it("sends a subscriber to the portal instead of starting a second subscription", async () => {
    const { cookie, cus } = await subscriber("no-second");
    sent = [];
    const token = await csrf(cookie, "/account/billing", { env: payEnv() });
    const res = await post("/account/billing/checkout", { csrf: token, interval: "monthly" }, { cookie, env: payEnv() });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://billing.stripe.com/p/session/test_1");
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual(["POST https://api.stripe.com/v1/billing_portal/sessions"]);
    expect(sent[0].form.get("customer")).toBe(cus);
  });

  it("says the payment service could not be reached when Stripe fails, and offers no checkout without the prices", async () => {
    const cookie = await signIn(newEmail("down"), { env: payEnv() });
    const token = await csrf(cookie, "/account/billing", { env: payEnv() });
    failing.add("POST /v1/checkout/sessions");
    const res = await post("/account/billing/checkout", { csrf: token, interval: "monthly" }, { cookie, env: payEnv() });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("The payment service could not be reached. Nothing was charged.");
    sent = [];
    const noPrices = payEnv({ STRIPE_PRICE_YEARLY: "" });
    expect((await post("/account/billing/checkout", { csrf: token, interval: "monthly" }, { cookie, env: noPrices })).headers.get("location")).toBe("/account/billing");
    expect(sent).toEqual([]);
  });

  it("POST /account/billing/portal opens a portal session for the stored customer", async () => {
    const { cookie, cus } = await subscriber("portal");
    sent = [];
    const token = await csrf(cookie, "/account/billing", { env: payEnv() });
    const res = await post("/account/billing/portal", { csrf: token, lang: "fr" }, { cookie, env: payEnv() });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://billing.stripe.com/p/session/test_1");
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual(["POST https://api.stripe.com/v1/billing_portal/sessions"]);
    expect(Object.fromEntries(sent[0].form)).toEqual({ customer: cus, return_url: "http://localhost/account/billing?lang=fr", locale: "fr-CA" });
    // No customer stored: back to the page, nothing asked.
    const other = await signIn(newEmail("no-customer"), { env: payEnv() });
    sent = [];
    const theirs = await csrf(other, "/account/billing", { env: payEnv() });
    expect((await post("/account/billing/portal", { csrf: theirs }, { cookie: other, env: payEnv() })).headers.get("location")).toBe("/account/billing");
    expect(sent).toEqual([]);
  });
});

describe("the billing page", () => {
  it("is the site's 404 with the switch off, every billing route, reading nothing", async () => {
    const used: string[] = [];
    const db = new Proxy({}, { get(_t, prop) { used.push(String(prop)); throw new Error("read"); } }) as D1Database;
    const env = { ...testEnv(), ...KEYS, ACCOUNTS: db };
    const notFound = await (await app.request("/nothing-here", { headers: { "cf-connecting-ip": nextIp() } }, env)).text();
    for (const [method, path] of [["GET", "/account/billing"], ["POST", "/account/billing/checkout"], ["POST", "/account/billing/portal"], ["POST", "/account/billing/webhook"]]) {
      const res = await app.request(path, {
        method, headers: { "cf-connecting-ip": nextIp(), "content-type": "application/x-www-form-urlencoded", origin: "http://localhost", "stripe-signature": "t=1,v1=00" },
        body: method === "POST" ? "interval=monthly" : undefined,
      }, env);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.text(), path).toBe(notFound);
    }
    expect(used).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("sends a signed-out visitor to sign in", async () => {
    const res = await get("/account/billing", { env: payEnv() });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/sign-in");
  });

  it("says Pro is not available yet without the keys or the prices, in both languages, and reads no payment table", async () => {
    const cookie = await signIn(newEmail("soon"));
    const envs = [onEnv(), payEnv({ STRIPE_WEBHOOK_SECRET: "" }), payEnv({ PRICE_MONTHLY_CAD: "" }), payEnv({ PRICE_YEARLY_CAD: "about 120" }), payEnv({ STRIPE_PRICE_MONTHLY: "monthly" })];
    for (const env of envs) {
      const en = await get("/account/billing", { cookie, env });
      expect(en.status).toBe(200);
      const html = decode(await en.text());
      expect(html).toContain("<h1>Plan and Billing</h1>");
      expect(html).toContain("Your plan today: Free.");
      expect(html).toContain("Paying for Pro is not available yet.");
      expect(html).not.toContain('action="/account/billing/checkout"');
      const fr = nbsp(decode(await (await get("/account/billing?lang=fr", { cookie, env })).text()));
      expect(fr).toContain("<h1>Forfait et facturation</h1>");
      expect(fr).toContain("Le paiement du forfait Pro n’est pas encore offert.");
    }
    // With the stub the payment tables are not touched: a database without them still answers.
    expect(sent).toEqual([]);
  });

  it("offers the two intervals at the configured prices with taxes added at checkout, in both languages", async () => {
    const cookie = await signIn(newEmail("prices"), { env: payEnv() });
    const res = await get("/account/billing", { cookie, env: payEnv() });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = decode(await res.text());
    expect(html).toContain("Monthly, CA$12 a month");
    expect(html).toContain("Yearly, CA$120.50 a year (CA$10.04 a month)");
    expect(html).toContain("Prices in Canadian dollars. Taxes added at checkout.");
    expect(html).toContain("Allwater Software Inc.");
    expect(html.match(/action="\/account\/billing\/checkout"/g)).toHaveLength(2);
    expect(html).toContain('name="interval" value="monthly"');
    expect(html).toContain('name="interval" value="yearly"');
    expect(html).toMatch(/name="csrf" value="[0-9a-f]{32}"/);
    // What Pro includes, as the plan cards: the Free card is the account's
    // own plan, with no link (the head links the account); the Pro card names
    // the price and leads to the Subscribe panel below.
    const [free, pro] = cardsOf(html);
    expect(free).toContain('<h3>Free</h3><span class="plan-current">Your plan</span>');
    expect(free).not.toContain("<a ");
    expect(free).toContain("<span>3 saved searches, on the site</span>");
    expect(pro).toContain("<span>25 saved searches, by email</span>");
    expect(pro).toContain('<strong class="plan-amount">CA$12</strong> a month or CA$120.50 a year');
    expect(pro).toContain('<a href="#subscribe" class="btn btn-primary">Subscribe to Pro</a> <a href="/pro" class="btn">About Pro</a>');
    expect(pro).not.toContain("plan-current");
    expect(html).toContain('<h2 id="subscribe">Subscribe to Pro</h2>');
    const fr = nbsp(decode(await (await get("/account/billing?lang=fr", { cookie, env: payEnv() })).text()));
    expect(fr).toContain("Mensuel, 12 $ CA par mois");
    expect(fr).toContain("Annuel, 120,50 $ CA par année (10,04 $ CA par mois)");
    expect(fr).toContain("Prix en dollars canadiens. Taxes ajoutées au paiement.");
    const [freeFr, proFr] = cardsOf(fr);
    expect(freeFr).toContain('<h3>Gratuit</h3><span class="plan-current">Votre forfait</span>');
    expect(proFr).toContain('<strong class="plan-amount">12 $ CA</strong> par mois ou 120,50 $ CA par année');
  });

  it("shows a Pro account its own card as the current plan, with no way to buy it", async () => {
    const { cookie } = await subscriber("cards");
    const html = decode(await (await get("/account/billing", { cookie, env: payEnv() })).text());
    const [free, pro] = cardsOf(html);
    expect(pro).toContain('<span class="plan-current">Your plan</span>');
    expect(free).not.toContain("plan-current");
    // No link on either card: nothing to buy, and the head already links the account.
    expect(html.slice(html.indexOf('<div class="plan-cards"'), html.indexOf("</section>", html.indexOf('<div class="plan-cards"')))).not.toContain("<a ");
    expect(html).not.toContain('href="#subscribe"');
    expect(html).not.toContain('id="subscribe"');
  });

  it("shows a subscriber the status, the period end and the portal button instead of the prices", async () => {
    const { cookie, periodEnd } = await subscriber("page");
    const html = decode(await (await get("/account/billing", { cookie, env: payEnv() })).text());
    // The same date as the overview's: the end of the period paid, not of the grace.
    expect(html).toContain(`Your plan today: Pro, paid until ${iso(periodEnd).slice(0, 10)}.`);
    expect(html).toContain("<dd>Active</dd>");
    expect(html).toContain(`<dd class="mono">${iso(periodEnd).slice(0, 10)}</dd>`);
    expect(html).toContain('action="/account/billing/portal"');
    expect(html).not.toContain('action="/account/billing/checkout"');
    const fr = nbsp(decode(await (await get("/account/billing?lang=fr", { cookie, env: payEnv() })).text()));
    expect(fr).toContain("Gérer l’abonnement");
    expect(fr).toContain("Fin de la période en cours");
  });

  it("lets the billing page's forms reach Stripe's hosts, and no other page's", async () => {
    const cookie = await signIn(newEmail("csp"), { env: payEnv() });
    const csp = async (path: string, env: object) => (await get(path, { cookie, env })).headers.get("content-security-policy") ?? "";
    expect(await csp("/account/billing", payEnv())).toContain("form-action 'self' https://checkout.stripe.com https://billing.stripe.com;");
    for (const [path, env] of [["/account", payEnv()], ["/tenders", payEnv()], ["/account/billing", onEnv()], ["/account/billing", { ...testEnv(), ...KEYS }]] as const) {
      expect(await csp(path, env), path).toContain("form-action 'self';");
    }
  });
});

describe("the privacy page's Payments section", () => {
  it("names Stripe, Link as the merchant of record and Allwater, and what a paid plan keeps, in both languages, only while the switch is on", async () => {
    const EM_DASH = String.fromCharCode(0x2014);
    const html = decode(await (await get("/privacy")).text());
    const section = html.slice(html.indexOf('<h2 id="payments">'), html.indexOf("<h2", html.indexOf('<h2 id="payments">') + 4));
    // Right after what an account keeps.
    expect(html.indexOf('<h2 id="accounts">Accounts</h2>')).toBeLessThan(html.indexOf('<h2 id="payments">Payments</h2>'));
    expect(section).toContain("Card details go to Stripe and never reach this site.");
    expect(section).toContain("Pro is sold through Link, the merchant of record operated by Stripe, on behalf of Allwater Software Inc., and Link sends the receipts.");
    expect(section).toContain("the site gives Stripe the account's id and, the first time, its email address");
    expect(section).toContain("the plan with its start and end dates, Stripe's customer and subscription identifiers, and the subscription's status");
    expect(section).toContain(`Stripe's identifier for the charge for ${EVENT_DAYS} days`);
    expect(section).toContain("It keeps no card details, billing address, tax number or amount.");
    expect(section).toContain("Deleting the account cancels the subscription at Stripe first, without refund.");
    expect(html).not.toContain(EM_DASH);
    const fr = nbsp(decode(await (await get("/privacy?lang=fr")).text()));
    expect(fr).toContain('<h2 id="payments">Paiements</h2>');
    expect(fr).toContain("Link, le marchand officiel exploité par Stripe, pour le compte d’Allwater Software Inc.");
    expect(fr).toContain(`pendant ${EVENT_DAYS} jours`);
    expect(fr).not.toContain(EM_DASH);
    const off = await (await get("/privacy", { env: testEnv() })).text();
    expect(off).not.toContain('id="payments"');
    expect(off).toContain("Allwater Software Inc.");
  });
});

describe("the overview's plan line", () => {
  it("says Pro, paid until the period end for a live Stripe row, and links the billing page", async () => {
    const { cookie, periodEnd } = await subscriber("overview");
    const html = decode(await (await get("/account", { cookie, env: payEnv() })).text());
    expect(html).toContain(`<dd>Pro, paid until ${iso(periodEnd).slice(0, 10)}</dd>`);
    expect(html).toContain('<dd><a href="/account/billing">Manage the subscription</a></dd>');
    const fr = nbsp(decode(await (await get("/account?lang=fr", { cookie, env: payEnv() })).text()));
    expect(fr).toContain(`<dd>Pro, payé jusqu’au ${iso(periodEnd).slice(0, 10)}</dd>`);
  });

  it("keeps the plan as before for Free and for a manual grant, with a link to the plans", async () => {
    const email = newEmail("plain");
    const cookie = await signIn(email);
    const html = decode(await (await get("/account", { cookie })).text());
    expect(html).toContain("<dd>Free</dd>");
    expect(html).toContain('<dd><a href="/account/billing">Plans and prices</a></dd>');
  });

  it("thanks the user on the way back from checkout", async () => {
    const cookie = await signIn(newEmail("thanks"), { env: payEnv() });
    const html = decode(await (await get("/account?billing=done", { cookie, env: payEnv() })).text());
    expect(html).toContain('<p class="account-notice" role="status">Thank you. Pro starts once Stripe confirms the payment');
    expect(decode(await (await get("/account", { cookie, env: payEnv() })).text())).not.toContain("Thank you.");
  });
});

describe("deleting an account with a subscription", () => {
  it("cancels the subscription at Stripe first, then deletes", async () => {
    const { email, cookie, sub } = await subscriber("leaving");
    sent = [];
    const res = await post("/account/delete", { csrf: await csrf(cookie, "/account", { env: payEnv() }), confirm: "yes" }, { cookie, env: payEnv() });
    expect(res.status).toBe(200);
    expect(sent.map((s) => `${s.method} ${new URL(s.url).pathname}`)).toEqual([`DELETE /v1/subscriptions/${sub}`]);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").bind(email).first()).toEqual({ n: 0 });
  });

  it("keeps the account when Stripe cannot confirm the cancellation", async () => {
    const { email, cookie } = await subscriber("staying");
    failing.add("DELETE /v1/subscriptions/:id");
    failing.add("GET /v1/subscriptions/:id");
    const res = await post("/account/delete", { csrf: await csrf(cookie, "/account", { env: payEnv() }), confirm: "yes" }, { cookie, env: payEnv() });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("could not be cancelled, so the account was not deleted");
    expect(await ACCOUNTS.prepare("SELECT status FROM users WHERE email = ?").bind(email).first()).toEqual({ status: "active" });
  });
});
