// The money path's second hardening pass: the regressions behind each
// finding the review of 2026-11-14 ruled to build, one describe a finding.
// Stripe is a fake fetch answering from tables (checkout sessions,
// subscriptions, charges) under Stripe's documented idempotency, as
// test/hardening-paid.test.ts fakes it; notices are signed here with
// WebCrypto, apart from the code under test, and carry the event's own
// created time where a finding turns on it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_VERSION } from "../src/account/stripe";
import { app } from "../src/index";
import { collectAlerts, gatherInputs } from "../src/watchdog";
import { testEnv } from "./assets";
import {
  ACCOUNTS, PRO_SALE, csrf, decode, get, nbsp, newEmail, nextIp, onEnv, post, signIn, ultraEnv, ULTRA_VARS, useAccountsDb, userId,
} from "./accounts-helpers";

useAccountsDb();

const payEnv = (extra: Record<string, unknown> = {}) => onEnv({ ...PRO_SALE, ...extra });
const saleEnv = (extra: Record<string, unknown> = {}) => ultraEnv(extra);
const watchEnv = () => ({ ...testEnv(), ACCOUNTS, SEARCH: undefined }) as never;

const DAY_S = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);
const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

// -- Stripe, faked -----------------------------------------------------------------------

type Obj = Record<string, unknown>;
type Reply = { status?: number; body?: unknown };
type Sent = { method: string; url: URL; form: URLSearchParams; idempotencyKey: string | null };

let sent: Sent[] = [];
let subs = new Map<string, Obj>();
let charges = new Map<string, Obj>();
let sessions = new Map<string, Obj>();
let made = 0;
let failing = new Set<string>();
let keyed = new Map<string, { form: string; reply: Reply }>();
let inFlight = new Map<string, number>();
// Subscriptions whose cancellation and read Stripe cannot answer (500).
let refusing = new Set<string>();
// The next subscription read is held here until the test releases it.
let hold: { reached: () => void; released: Promise<void> } | null = null;

const routeOf = (method: string, path: string) => `${method} ${path.replace(/\/(sub|ch|cs)_[A-Za-z0-9_]+/, "/:id")}`;

function answer(method: string, url: URL, form: URLSearchParams): Reply {
  const route = routeOf(method, url.pathname);
  const id = url.pathname.split("/")[route.includes("/checkout/") ? 4 : 3] ?? "";
  if (failing.has(route) || refusing.has(id)) return { status: 500, body: { error: { message: "down" } } };
  if (route === "POST /v1/checkout/sessions") {
    made++;
    const session: Obj = {
      id: `cs_m${made}`, object: "checkout.session", mode: "subscription", status: "open", payment_status: "unpaid",
      client_reference_id: form.get("client_reference_id"), customer: form.get("customer"), subscription: null,
      success_url: form.get("success_url"), url: `https://checkout.stripe.com/c/pay/cs_m${made}`, created: nowS(), metadata: {},
    };
    sessions.set(session.id as string, session);
    return { body: session };
  }
  if (route === "GET /v1/checkout/sessions") {
    const cus = url.searchParams.get("customer");
    const status = url.searchParams.get("status");
    const data = [...sessions.values()].filter((s) => (!cus || s.customer === cus) && (!status || s.status === status));
    return { body: { object: "list", data, has_more: false } };
  }
  if (route === "GET /v1/checkout/sessions/:id") return sessions.has(id) ? { body: sessions.get(id) } : { status: 404, body: {} };
  if (route === "POST /v1/checkout/sessions/:id/expire") {
    const s = sessions.get(id);
    if (!s || s.status !== "open") return { status: 400, body: { error: { type: "invalid_request_error", message: "not open" } } };
    s.status = "expired";
    s.url = null;
    return { body: s };
  }
  if (route === "POST /v1/billing_portal/sessions") return { body: { id: "bps_m", url: "https://billing.stripe.com/p/session/m" } };
  if (route === "GET /v1/subscriptions/:id") return subs.has(id) ? { body: subs.get(id) } : { status: 404, body: {} };
  if (route === "DELETE /v1/subscriptions/:id") {
    const s = subs.get(id);
    if (!s) return { status: 404, body: {} };
    if (s.status === "canceled") return { status: 400, body: { error: { type: "invalid_request_error" } } };
    s.status = "canceled";
    return { body: s };
  }
  if (route === "GET /v1/charges/:id") return charges.has(id) ? { body: charges.get(id) } : { status: 404, body: {} };
  return { status: 400, body: { error: { message: `unexpected ${route}` } } };
}

beforeEach(() => {
  sent = [];
  subs = new Map();
  charges = new Map();
  sessions = new Map();
  made = 0;
  failing = new Set();
  keyed = new Map();
  inFlight = new Map();
  refusing = new Set();
  hold = null;
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
    if (hold && routeOf(method, url.pathname) === "GET /v1/subscriptions/:id") {
      const h = hold;
      hold = null;
      h.reached();
      await h.released;
    }
    let reply: Reply;
    const kept = idempotencyKey ? keyed.get(idempotencyKey) : undefined;
    const busy = idempotencyKey ? inFlight.get(idempotencyKey) ?? 0 : 0;
    if (idempotencyKey && busy > 0) {
      inFlight.set(idempotencyKey, busy - 1);
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
  logged = [];
  for (const m of ["log", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(" ")); });
});

// Every console line the code under test wrote in the current test.
let logged: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Holds the next subscription read until release() is called; reached resolves once it is asked.
function holdNextRead(): { reached: Promise<void>; release: () => void } {
  let reached!: () => void;
  let release!: () => void;
  const r = new Promise<void>((resolve) => { reached = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  hold = { reached, released };
  return { reached: r, release };
}

// Stripe completes a session: the person paid on its page.
function complete(id: string, sub: string, cus: string) {
  const s = sessions.get(id)!;
  Object.assign(s, { status: "complete", payment_status: "paid", customer: cus, subscription: sub });
}

function subscriptionObject(id: string, customer: string, status: string, periodEnd: number, user: string | null, o: { plan?: "pro" | "ultra"; created?: number } = {}) {
  const ultra = o.plan === "ultra";
  return {
    id, object: "subscription", customer, status, cancel_at_period_end: false, created: o.created ?? nowS(),
    items: {
      object: "list",
      data: [{
        id: `si_${id}`, object: "subscription_item", current_period_end: periodEnd, quantity: 1,
        price: {
          id: ultra ? ULTRA_VARS.STRIPE_PRICE_ULTRA_MONTHLY : PRO_SALE.STRIPE_PRICE_MONTHLY, object: "price",
          product: ultra ? ULTRA_VARS.STRIPE_PRODUCT_ULTRA : "prod_proTEST", recurring: { interval: "month", interval_count: 1 },
        },
      }],
    },
    metadata: user ? { user_id: user } : {},
  };
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
  return { sub: `sub_m${t}`, cus: `cus_m${t}` };
};
// created: the event's own time (Stripe's seconds), left out as the other files leave it.
const event = (type: string, object: object, created?: number) =>
  ({ id: `evt_m${tag()}`, object: "event", type, api_version: STRIPE_VERSION, ...(created ? { created } : {}), data: { object } });

async function deliver(e: object, env: object = payEnv()): Promise<Response> {
  const body = JSON.stringify(e);
  const t = nowS();
  return app.request("/account/billing/webhook", {
    method: "POST", body,
    headers: { "content-type": "application/json", "cf-connecting-ip": nextIp(), "stripe-signature": `t=${t},v1=${await hmacHex(PRO_SALE.STRIPE_WEBHOOK_SECRET, `${t}.${body}`)}` },
  }, env);
}

const checkoutCompleted = (user: string, sub: string, cus: string, o: { created?: number; session?: string } = {}) => event("checkout.session.completed", {
  id: o.session ?? `cs_${sub}`, object: "checkout.session", mode: "subscription", client_reference_id: user, customer: cus, subscription: sub,
  payment_status: "paid", status: "complete", ...(o.created ? { created: o.created } : {}),
});
const invoicePaid = (sub: string, cus: string, periodEnd: number, user: string | null, extra: object = {}) => event("invoice.paid", {
  id: `in_${sub}_${periodEnd}_${n++}`, object: "invoice", customer: cus, status: "paid",
  parent: { type: "subscription_details", subscription_details: { subscription: sub, metadata: user ? { user_id: user } : {} } },
  lines: { object: "list", data: [{ id: "il_1", object: "line_item", period: { start: periodEnd - 30 * DAY_S, end: periodEnd } }] },
  ...extra,
});
const updated = (s: object, type: "updated" | "deleted" = "updated") => event(`customer.subscription.${type}`, s);
const chargeRefunded = (ch: string, cus: string, created?: number) => event("charge.refunded", {
  id: ch, object: "charge", customer: cus, amount: 1900, amount_refunded: 1900, refunded: true, currency: "cad",
}, created);
const refundFailed = (ch: string, o: { customer?: string; reason?: string } = {}) => event("refund.failed", {
  id: `re_${ch.slice(3)}`, object: "refund", amount: 1900, currency: "cad", charge: ch, status: "failed",
  failure_reason: o.reason ?? "insufficient_funds", ...(o.customer ? { customer: o.customer } : {}),
});

// -- the accounts --------------------------------------------------------------------------

async function buyer(label: string, env = payEnv()) {
  const email = newEmail(label);
  const cookie = await signIn(email, { env });
  return { email, cookie, user: await userId(email), token: await csrf(cookie, "/account/billing", { env }) };
}

// A signed-in user subscribed through the webhook, as Stripe's checkout leaves one.
async function subscriber(label: string, o: { periodEnd?: number; plan?: "pro" | "ultra"; env?: object } = {}) {
  const env = o.env ?? payEnv();
  const b = await buyer(label, env as ReturnType<typeof payEnv>);
  const { sub, cus } = ids();
  const periodEnd = o.periodEnd ?? nowS() + 30 * DAY_S;
  subs.set(sub, subscriptionObject(sub, cus, "active", periodEnd, b.user, { plan: o.plan, created: nowS() - 60 }));
  expect((await deliver(checkoutCompleted(b.user, sub, cus), env)).status).toBe(200);
  expect(await liveStripe(b.user)).toHaveLength(1);
  return { ...b, sub, cus, periodEnd };
}

const checkout = (b: { cookie: string; token: string }, interval: string, o: { lang?: string; plan?: string; env?: object } = {}) =>
  post("/account/billing/checkout", { csrf: b.token, interval, lang: o.lang ?? "en", ...(o.plan ? { plan: o.plan } : {}) }, { cookie: b.cookie, env: o.env ?? payEnv() });

const stripeRows = async (user: string) =>
  ((await ACCOUNTS.prepare("SELECT reference, ends_at, created_at FROM entitlements WHERE user_id = ? AND source = 'stripe' ORDER BY created_at")
    .bind(user).all<{ reference: string; ends_at: string | null; created_at: string }>()).results ?? []);
const liveStripe = async (user: string) => (await stripeRows(user)).filter((r) => r.ends_at === null || r.ends_at > new Date().toISOString());
const binding = (user: string) =>
  ACCOUNTS.prepare("SELECT customer_id, subscription_id, status FROM payment_customers WHERE user_id = ?").bind(user).first();
const audits = async (user: string) =>
  ((await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE user_id = ? ORDER BY id").bind(user).all<{ event: string; detail: string | null }>()).results ?? [])
    .map((r) => `${r.event} ${r.detail ?? ""}`.trim());
const calls = () => sent.map((s) => `${s.method} ${s.url.pathname}`);
const page = async (path: string, who: { cookie: string }, env: object = payEnv()) => decode(await (await get(path, { cookie: who.cookie, env })).text());
const alertsFor = async (user: string) => collectAlerts(await gatherInputs(watchEnv(), new Date())).filter((a) => a.includes(`account ${user}`));

// =========================================================================================

describe("1. a payer whose first notices fail", () => {
  it("is bound on the way back from checkout, so Subscribe opens the portal and no second checkout starts ten minutes later", async () => {
    const b = await buyer("return-bind");
    expect((await checkout(b, "monthly")).status).toBe(303);
    const create = sent.find((s) => s.method === "POST" && s.url.pathname === "/v1/checkout/sessions")!;
    expect(create.form.get("success_url")).toBe("http://localhost/account?billing=done&session={CHECKOUT_SESSION_ID}");
    const { sub, cus } = ids();
    subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, b.user));
    complete("cs_m1", sub, cus);
    // Both first notices fail: Stripe's read of the subscription times out.
    failing.add("GET /v1/subscriptions/:id");
    expect((await deliver(checkoutCompleted(b.user, sub, cus, { session: "cs_m1" }))).status).toBe(500);
    expect((await deliver(invoicePaid(sub, cus, nowS() + 30 * DAY_S, b.user))).status).toBe(500);
    failing.delete("GET /v1/subscriptions/:id");
    // Stripe sends the payer back with the session's id in place of the template.
    const back = await page("/account?billing=done&session=cs_m1", b);
    expect(back).toContain("Thank you. Pro starts once Stripe confirms the payment");
    expect(await binding(b.user)).toEqual({ customer_id: cus, subscription_id: sub, status: "active" });
    // The return grants nothing: the plan waits for the signed notices.
    expect(await stripeRows(b.user)).toEqual([]);
    expect(back).toContain("<dd>Free</dd>");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    const billing = await page("/account/billing", b);
    expect(billing).not.toContain('id="subscribe"');
    expect(billing).toContain("Manage the subscription");
    const again = await checkout(b, "monthly");
    expect(again.headers.get("location")).toBe("https://billing.stripe.com/p/session/m");
    expect(made).toBe(1);
  });

  it("binds nothing for another account's session, a session not paid yet, a read that fails or an id of another shape", async () => {
    const a = await buyer("return-a");
    await checkout(a, "monthly");
    const { sub, cus } = ids();
    subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, a.user));
    complete("cs_m1", sub, cus);
    const other = await buyer("return-other");
    expect((await get("/account?billing=done&session=cs_m1", { cookie: other.cookie, env: payEnv() })).status).toBe(200);
    expect(await binding(other.user)).toBeNull();
    const open = await buyer("return-open");
    await checkout(open, "yearly");
    await page("/account?billing=done&session=cs_m2", open);
    expect(await binding(open.user)).toBeNull();
    failing.add("GET /v1/checkout/sessions/:id");
    expect(await page("/account?billing=done&session=cs_m1", a)).toContain("Thank you. Pro starts once Stripe confirms the payment");
    expect(await binding(a.user)).toBeNull();
    failing.clear();
    sent = [];
    await page("/account?billing=done&session=..%2Fcustomers", a);
    await page("/account?session=cs_m1", a);
    expect(calls()).toEqual([]);
    expect(await binding(a.user)).toBeNull();
  });

  it("the daily check names an account billed by two Stripe subscriptions, by its id and theirs, until one ends", async () => {
    const s = await subscriber("second-sub");
    const extra = ids();
    subs.set(extra.sub, subscriptionObject(extra.sub, extra.cus, "active", nowS() + 30 * DAY_S, s.user));
    expect((await deliver(checkoutCompleted(s.user, extra.sub, extra.cus))).status).toBe(200);
    expect(await audits(s.user)).toContain("plan_changed stripe second subscription");
    const lines = await alertsFor(s.user);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^An account is billed by more than one Stripe subscription: account [0-9a-f]{32}, subscriptions /);
    expect(lines[0]).toContain(s.sub);
    expect(lines[0]).toContain(extra.sub);
    expect(lines[0]).not.toContain(s.email);
    // Cancelling the extra one in Stripe's dashboard ends its row, and the item with it.
    subs.get(extra.sub)!.status = "canceled";
    expect((await deliver(updated(subs.get(extra.sub)!, "deleted"))).status).toBe(200);
    expect(await alertsFor(s.user)).toEqual([]);
  });
});

describe("2. a deleted account", () => {
  it("has every subscription with a live Stripe row cancelled at deletion, the bound one first", async () => {
    const s = await subscriber("delete-two");
    const extra = ids();
    subs.set(extra.sub, subscriptionObject(extra.sub, extra.cus, "active", nowS() + 30 * DAY_S, s.user));
    expect((await deliver(checkoutCompleted(s.user, extra.sub, extra.cus))).status).toBe(200);
    sent = [];
    const res = await post("/account/delete", { csrf: await csrf(s.cookie, "/account", { env: payEnv() }), confirm: "yes" }, { cookie: s.cookie, env: payEnv() });
    expect(res.status).toBe(200);
    expect(calls().filter((c) => c.startsWith("DELETE"))).toEqual([`DELETE /v1/subscriptions/${s.sub}`, `DELETE /v1/subscriptions/${extra.sub}`]);
    expect([subs.get(s.sub)!.status, subs.get(extra.sub)!.status]).toEqual(["canceled", "canceled"]);
  });

  it("keeps the account when Stripe cannot confirm the second cancellation", async () => {
    const s = await subscriber("delete-two-fails");
    const extra = ids();
    subs.set(extra.sub, subscriptionObject(extra.sub, extra.cus, "active", nowS() + 30 * DAY_S, s.user));
    expect((await deliver(checkoutCompleted(s.user, extra.sub, extra.cus))).status).toBe(200);
    // The second one's cancellation fails, and a read cannot confirm it ended.
    refusing.add(extra.sub);
    const res = await post("/account/delete", { csrf: await csrf(s.cookie, "/account", { env: payEnv() }), confirm: "yes" }, { cookie: s.cookie, env: payEnv() });
    expect(res.status).toBe(503);
    expect(decode(await res.text())).toContain("could not be cancelled, so the account was not deleted");
    expect(subs.get(extra.sub)!.status).toBe("active");
    expect(await ACCOUNTS.prepare("SELECT status FROM users WHERE id = ?").bind(s.user).first()).toEqual({ status: "active" });
    // Asked again once Stripe answers, the account goes.
    refusing.clear();
    const again = await post("/account/delete", { csrf: await csrf(s.cookie, "/account", { env: payEnv() }), confirm: "yes" }, { cookie: s.cookie, env: payEnv() });
    expect(again.status).toBe(200);
    expect([subs.get(s.sub)!.status, subs.get(extra.sub)!.status]).toEqual(["canceled", "canceled"]);
  });

  it("a payment or a live subscription that lands after deletion is cancelled, grants nothing, and the daily check says so", async () => {
    // The person pays, the notices are delayed, and the account is deleted before they land.
    const b = await buyer("late-delete");
    const paid = ids();
    subs.set(paid.sub, subscriptionObject(paid.sub, paid.cus, "active", nowS() + 30 * DAY_S, b.user));
    expect((await post("/account/delete", { csrf: await csrf(b.cookie, "/account", { env: payEnv() }), confirm: "yes" }, { cookie: b.cookie, env: payEnv() })).status).toBe(200);
    sent = [];
    expect((await deliver(invoicePaid(paid.sub, paid.cus, nowS() + 30 * DAY_S, b.user))).status).toBe(200);
    expect(calls()).toContain(`DELETE /v1/subscriptions/${paid.sub}`);
    expect(subs.get(paid.sub)!.status).toBe("canceled");
    expect(await stripeRows(b.user)).toEqual([]);
    expect(await audits(b.user)).toContain(`plan_changed stripe paid on a deleted account, cancelled ${paid.sub}`);
    // A subscription notice with a status that can still bill does the same.
    const live = ids();
    subs.set(live.sub, subscriptionObject(live.sub, live.cus, "active", nowS() + 30 * DAY_S, b.user));
    sent = [];
    expect((await deliver(updated(subs.get(live.sub)!))).status).toBe(200);
    expect(calls()).toContain(`DELETE /v1/subscriptions/${live.sub}`);
    expect(await stripeRows(b.user)).toEqual([]);
    expect(await audits(b.user)).toContain(`plan_changed stripe live on a deleted account, cancelled ${live.sub}`);
    // The cancellation's own notice changes nothing more and asks Stripe nothing.
    sent = [];
    expect((await deliver(updated(subs.get(live.sub)!, "deleted"))).status).toBe(200);
    expect(calls().filter((c) => c.startsWith("DELETE"))).toEqual([]);
    const lines = await alertsFor(b.user);
    expect(lines).toContain(`A payment landed on a deleted account: account ${b.user}, subscription ${paid.sub}. ` +
      "The subscription is cancelled and nothing was granted. Whether to refund the payment is the operator's decision (Stripe's dashboard).");
    expect(lines).toContain(`A subscription that could still bill reached a deleted account: account ${b.user}, subscription ${live.sub}. ` +
      "It is cancelled and nothing was granted. Check in Stripe's dashboard whether it took a payment after the deletion.");
  });

  it("a paid checkout that lands after deletion is on the daily check too; a cancellation that fails answers 500", async () => {
    const b = await buyer("late-checkout-delete");
    const t = ids();
    subs.set(t.sub, subscriptionObject(t.sub, t.cus, "active", nowS() + 30 * DAY_S, b.user));
    expect((await post("/account/delete", { csrf: await csrf(b.cookie, "/account", { env: payEnv() }), confirm: "yes" }, { cookie: b.cookie, env: payEnv() })).status).toBe(200);
    failing.add("DELETE /v1/subscriptions/:id");
    failing.add("GET /v1/subscriptions/:id");
    expect((await deliver(checkoutCompleted(b.user, t.sub, t.cus))).status).toBe(500);
    failing.clear();
    expect((await deliver(checkoutCompleted(b.user, t.sub, t.cus))).status).toBe(200);
    expect(subs.get(t.sub)!.status).toBe("canceled");
    expect(await stripeRows(b.user)).toEqual([]);
    expect((await alertsFor(b.user)).some((l) => l.startsWith(`A payment landed on a deleted account: account ${b.user}, subscription ${t.sub}.`))).toBe(true);
  });
});

describe("3. a refund's or dispute's late notice", () => {
  it("does not take away a subscription bought after the refund, in either order", async () => {
    // Refund now on day 3, then Yearly within a minute on the same customer.
    const s = await subscriber("refund-rebuy");
    const ch = `ch_r${s.sub}`;
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0 + 60_000);
    const refundedAt = nowS();
    subs.get(s.sub)!.status = "canceled";
    await ACCOUNTS.prepare("UPDATE payment_customers SET status = 'canceled' WHERE user_id = ?").bind(s.user).run();
    vi.setSystemTime(t0 + 120_000);
    const sub2 = `sub_y${s.sub.slice(5)}`;
    subs.set(sub2, subscriptionObject(sub2, s.cus, "active", nowS() + 365 * DAY_S, s.user, { created: nowS() - 10 }));
    expect((await deliver(checkoutCompleted(s.user, sub2, s.cus, { created: nowS() - 20 }))).status).toBe(200);
    expect((await liveStripe(s.user)).map((r) => r.reference)).toEqual([s.sub, sub2]);
    // The refund's notice, made at the refund, taken after the new purchase.
    vi.setSystemTime(t0 + 130_000);
    expect((await deliver(chargeRefunded(ch, s.cus, refundedAt))).status).toBe(200);
    expect((await liveStripe(s.user)).map((r) => r.reference)).toEqual([sub2]);
    expect(await ACCOUNTS.prepare("SELECT at FROM payment_reversals WHERE charge_id = ?").bind(ch).first()).toEqual({ at: new Date(refundedAt * 1000).toISOString() });

    // The other order: the refund's notice first, the new purchase's checkout after it.
    const r = await subscriber("refund-rebuy-2");
    const ch2 = `ch_r${r.sub}`;
    vi.setSystemTime(Date.now() + 60_000);
    const refundedAt2 = nowS();
    subs.get(r.sub)!.status = "canceled";
    await ACCOUNTS.prepare("UPDATE payment_customers SET status = 'canceled' WHERE user_id = ?").bind(r.user).run();
    vi.setSystemTime(Date.now() + 60_000);
    const sub3 = `sub_z${r.sub.slice(5)}`;
    subs.set(sub3, subscriptionObject(sub3, r.cus, "active", nowS() + 365 * DAY_S, r.user, { created: nowS() - 10 }));
    expect((await deliver(chargeRefunded(ch2, r.cus, refundedAt2))).status).toBe(200);
    expect(await liveStripe(r.user)).toEqual([]);
    expect((await deliver(checkoutCompleted(r.user, sub3, r.cus, { created: nowS() - 20 }))).status).toBe(200);
    expect((await liveStripe(r.user)).map((x) => x.reference)).toEqual([sub3]);
    // invoice.paid for the new subscription, paid after the refund, grants too.
    expect((await deliver(invoicePaid(sub3, r.cus, nowS() + 366 * DAY_S, r.user, { status_transitions: { paid_at: nowS() - 15 } }))).status).toBe(200);
    expect(await audits(r.user)).not.toContain("plan_changed stripe payment reversed, not granted");
  });

  it("still ends a row its own payment's notice wrote after the refund, when that notice was delayed past it", async () => {
    const b = await buyer("refund-delayed-payment");
    const { sub, cus } = ids();
    const t0 = Date.now();
    subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, b.user, { created: nowS() }));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0 + 60_000);
    const refundedAt = nowS();
    // The checkout's notice lands after the refund but before the refund's own notice.
    vi.setSystemTime(t0 + 120_000);
    expect((await deliver(checkoutCompleted(b.user, sub, cus, { created: Math.floor(t0 / 1000) }))).status).toBe(200);
    expect(await liveStripe(b.user)).toHaveLength(1);
    expect((await deliver(chargeRefunded(`ch_d${sub}`, cus, refundedAt))).status).toBe(200);
    expect(await liveStripe(b.user)).toEqual([]);
  });

  it("names the rule in the docs: rows that existed at the reversal's own time end", async () => {
    const docs = ((await import("../../docs/accounts.md?raw")).default as string).replace(/\s+/g, " ");
    expect(docs).not.toContain("sets the end of every live Stripe row of the account bound to the charge's customer to now");
    expect(docs).toContain("at the reversal's own time");
  });
});

describe("4. a refund that fails after it was taken", () => {
  it("leaves an audit row and a daily-check item naming the account by its id, and changes no plan", async () => {
    const s = await subscriber("refund-failed");
    const ch = `ch_f${s.sub.slice(4)}`;
    charges.set(ch, { id: ch, object: "charge", customer: s.cus });
    expect((await deliver(chargeRefunded(ch, s.cus))).status).toBe(200);
    const rowsBefore = await stripeRows(s.user);
    const bindingBefore = await binding(s.user);
    logged = [];
    // The refund names its charge and not its customer: the charge is read for it.
    expect((await deliver(refundFailed(ch))).status).toBe(200);
    expect(calls()).toContain(`GET /v1/charges/${ch}`);
    expect(await audits(s.user)).toContain(`refund_failed ${ch} insufficient_funds`);
    expect(await stripeRows(s.user)).toEqual(rowsBefore);
    expect(await binding(s.user)).toEqual(bindingBefore);
    const lines = await alertsFor(s.user);
    expect(lines).toContain(`A refund failed after Stripe took it: account ${s.user}, charge ${ch} (insufficient_funds). ` +
      "The site changed no plan; the money is back in the Stripe balance. Refund the person another way, or grant the plan by hand.");
    for (const l of lines) expect(l).not.toContain(s.email);
    for (const l of logged) for (const secret of [s.user, s.email, ch, s.cus]) expect(l).not.toContain(secret);
  });

  it("reads the customer from the refund when it names one, and a charge it cannot read answers 500 and is asked again", async () => {
    const s = await subscriber("refund-failed-2");
    const ch = `ch_g${s.sub.slice(4)}`;
    sent = [];
    expect((await deliver(refundFailed(ch, { customer: s.cus, reason: "expired_or_canceled_card" }))).status).toBe(200);
    expect(calls()).toEqual([]);
    expect(await audits(s.user)).toContain(`refund_failed ${ch} expired_or_canceled_card`);
    const t = await subscriber("refund-failed-3");
    const ch3 = `ch_h${t.sub.slice(4)}`;
    charges.set(ch3, { id: ch3, object: "charge", customer: t.cus });
    failing.add("GET /v1/charges/:id");
    const notice = refundFailed(ch3);
    expect((await deliver(notice)).status).toBe(500);
    failing.clear();
    expect((await deliver(notice)).status).toBe(200);
    expect(await audits(t.user)).toContain(`refund_failed ${ch3} insufficient_funds`);
  });

  it("is in the operator's list of events and steps", async () => {
    const docs = (await import("../../docs/accounts.md?raw")).default as string;
    const step = docs.slice(docs.indexOf("5. **The webhook endpoint**"), docs.indexOf("6. **The two secrets**"));
    expect(step).toContain("`refund.failed`");
    expect(docs).toContain("| `refund.failed` |");
  });
});

describe("5. invoice.paid and a subscription's status", () => {
  it("writes the status Stripe gives, never the one read before it: a first purchase whose two notices cross is Active with Refund now", async () => {
    const b = await buyer("cross");
    const { sub, cus } = ids();
    subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, b.user));
    const held = holdNextRead();
    const paid = deliver(invoicePaid(sub, cus, nowS() + 30 * DAY_S, b.user));
    await held.reached;
    expect((await deliver(checkoutCompleted(b.user, sub, cus))).status).toBe(200);
    expect(await binding(b.user)).toMatchObject({ status: "active" });
    held.release();
    expect((await paid).status).toBe(200);
    expect(await binding(b.user)).toMatchObject({ status: "active" });
    const html = await page("/account/billing", b);
    expect(html).toContain("<dd>Active</dd>");
    expect(html).toContain('id="refund"');
  });

  it("a renewal that recovers after past_due reads Active, not overdue", async () => {
    const s = await subscriber("recovered");
    expect((await deliver(updated(subscriptionObject(s.sub, s.cus, "past_due", s.periodEnd, s.user)))).status).toBe(200);
    subs.get(s.sub)!.status = "active";
    const held = holdNextRead();
    const paid = deliver(invoicePaid(s.sub, s.cus, s.periodEnd + 30 * DAY_S, s.user));
    await held.reached;
    expect((await deliver(updated(subscriptionObject(s.sub, s.cus, "active", s.periodEnd + 30 * DAY_S, s.user)))).status).toBe(200);
    held.release();
    expect((await paid).status).toBe(200);
    expect(await binding(s.user)).toMatchObject({ status: "active" });
    expect(await page("/account/billing", s)).not.toContain("Renewal payment overdue");
  });

  it("never replaces a canceled subscription's status: a retried active update after .deleted changes nothing", async () => {
    const s = await subscriber("terminal");
    expect((await deliver(updated(subscriptionObject(s.sub, s.cus, "canceled", s.periodEnd, s.user), "deleted"))).status).toBe(200);
    expect((await deliver(updated(subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user)))).status).toBe(200);
    expect(await binding(s.user)).toMatchObject({ status: "canceled" });
    expect(await page("/account/billing", s)).toContain('id="subscribe"');
  });
});

describe("6. a bound subscription and a Free plan", () => {
  const linksTo = (html: string, id: string) => (html.match(new RegExp(`href="[^"]*#${id}"`, "g")) ?? []).length;

  it("draws no Subscribe link that leads nowhere, and says how to get the plan back once it has ended", async () => {
    const s = await subscriber("unpaid");
    expect((await deliver(updated(subscriptionObject(s.sub, s.cus, "unpaid", s.periodEnd, s.user)))).status).toBe(200);
    for (const env of [payEnv(), saleEnv()]) {
      const html = await page("/account/billing", s, env);
      expect(html).toContain("Your plan today: Free.");
      if (!html.includes('id="subscribe"')) expect(linksTo(html, "subscribe")).toBe(0);
      expect(linksTo(html, "subscription")).toBeGreaterThan(0);
      expect(html).toContain('id="subscription"');
      expect(html).toContain("The last renewal payment did not go through, so Pro has ended. Update the card on Stripe's page to get Pro back.");
      expect(html).not.toContain("to keep Pro");
      expect(html.match(/btn-primary/g)).toHaveLength(1);
      expect(html).not.toContain(EM_DASH);
    }
    const fr = nbsp(await page("/account/billing?lang=fr", s)).replace(/&#39;|’/g, "'");
    expect(fr).toContain("Le dernier paiement de renouvellement n'est pas passé, donc Pro a pris fin. Mettez la carte à jour sur la page de Stripe pour retrouver Pro.");
  });

  it("names Ultra in the note for an Ultra subscription past its grace", async () => {
    const s = await subscriber("past-grace-ultra", { plan: "ultra", env: saleEnv(), periodEnd: nowS() + DAY_S });
    expect((await deliver(updated(subscriptionObject(s.sub, s.cus, "past_due", s.periodEnd, s.user, { plan: "ultra" })), saleEnv())).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((s.periodEnd + 4 * DAY_S) * 1000);
    const html = await page("/account/billing", s, saleEnv());
    expect(html).toContain("Your plan today: Free.");
    expect(html).toContain("The last renewal payment did not go through, so Ultra has ended. Update the card on Stripe's page to get Ultra back.");
    expect(linksTo(html, "subscribe")).toBe(0);
  });
});

describe("7. leaving Stripe's checkout by its back link", () => {
  it("lets the other interval, the other plan or the other language start a checkout at once; the same choice twice is one session", async () => {
    const b = await buyer("back-link", saleEnv());
    expect((await checkout(b, "monthly", { env: saleEnv() })).headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_m1");
    const yearly = await checkout(b, "yearly", { env: saleEnv() });
    expect([yearly.status, yearly.headers.get("location")]).toEqual([303, "https://checkout.stripe.com/c/pay/cs_m2"]);
    const ultra = await checkout(b, "monthly", { env: saleEnv(), plan: "ultra" });
    expect([ultra.status, ultra.headers.get("location")]).toEqual([303, "https://checkout.stripe.com/c/pay/cs_m3"]);
    const french = await checkout(b, "monthly", { env: saleEnv(), lang: "fr" });
    expect([french.status, french.headers.get("location")]).toEqual([303, "https://checkout.stripe.com/c/pay/cs_m4"]);
    // Two tabs, the same choice: the one session.
    const [one, two] = await Promise.all([checkout(b, "yearly", { env: saleEnv() }), checkout(b, "yearly", { env: saleEnv() })]);
    expect([one.headers.get("location"), two.headers.get("location")]).toEqual(["https://checkout.stripe.com/c/pay/cs_m2", "https://checkout.stripe.com/c/pay/cs_m2"]);
    expect(made).toBe(4);
  });

  it("expires a returning customer's open checkout of another choice, so only the new one can be paid", async () => {
    const s = await subscriber("back-link-returning");
    subs.get(s.sub)!.status = "canceled";
    expect((await deliver(updated(subs.get(s.sub)!, "deleted"))).status).toBe(200);
    expect((await checkout(s, "monthly")).status).toBe(303);
    expect(sessions.get("cs_m1")).toMatchObject({ customer: s.cus, status: "open" });
    sent = [];
    expect((await checkout(s, "yearly")).headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_m2");
    expect(calls()).toEqual(["POST /v1/checkout/sessions", "GET /v1/checkout/sessions", "POST /v1/checkout/sessions/cs_m1/expire"]);
    const list = sent[1].url.searchParams;
    expect([list.get("customer"), list.get("status")]).toEqual([s.cus, "open"]);
    expect([sessions.get("cs_m1")!.status, sessions.get("cs_m2")!.status]).toEqual(["expired", "open"]);
    // The same choice again keeps its session open.
    sent = [];
    expect((await checkout(s, "yearly")).headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_m2");
    expect(calls().filter((c) => c.endsWith("/expire"))).toEqual([]);
    expect(sessions.get("cs_m2")!.status).toBe("open");
    // An expiry Stripe refuses starts nothing the reader is sent to.
    expect((await checkout(s, "monthly", { lang: "fr" })).status).toBe(303);
    failing.add("POST /v1/checkout/sessions/:id/expire");
    const refused = await checkout(s, "yearly", { lang: "fr" });
    expect(refused.status).toBe(503);
  });

  it("says busy only while Stripe is still preparing the same checkout, in words that are true, in both languages", async () => {
    const b = await buyer("busy");
    const key = `checkout-${b.user}-pro-monthly-en-${Math.floor(Date.now() / (10 * 60_000))}`;
    inFlight.set(key, 9);
    const res = await checkout(b, "monthly");
    expect(res.status).toBe(409);
    const en = decode(await res.text());
    expect(en).toContain("A checkout started from this account a moment ago is still being prepared at Stripe. Try again in a minute, or in ten minutes if this message comes back.");
    expect(en).not.toContain("in another page or tab");
    const frKey = `checkout-${b.user}-pro-monthly-fr-${Math.floor(Date.now() / (10 * 60_000))}`;
    inFlight.set(frKey, 9);
    const fr = nbsp(decode(await (await checkout(b, "monthly", { lang: "fr" })).text())).replace(/&#39;|’/g, "'");
    expect(fr).toContain("Un paiement commencé depuis ce compte il y a un instant est encore en préparation chez Stripe. Réessayez dans une minute, ou dans dix minutes si ce message revient.");
  });
});

describe("8. Paid until", () => {
  it("never shows a period that has not been paid: a renewal gone past_due keeps the date that was paid", async () => {
    const s = await subscriber("paid-until", { periodEnd: nowS() - DAY_S });
    const next = nowS() + 29 * DAY_S;
    expect((await deliver(updated(subscriptionObject(s.sub, s.cus, "past_due", next, s.user)))).status).toBe(200);
    const overview = await page("/account", s);
    expect(overview).toContain(`<dd>Pro, paid until ${day(s.periodEnd)}</dd>`);
    expect(overview).not.toContain(`paid until ${day(next)}`);
    expect(await page("/account/billing", s)).toContain(`Your plan today: Pro, paid until ${day(s.periodEnd)}.`);
    // The renewal's payment moves it on.
    expect((await deliver(invoicePaid(s.sub, s.cus, next, s.user))).status).toBe(200);
    expect(await page("/account", s)).toContain(`<dd>Pro, paid until ${day(next)}</dd>`);
  });
});

describe("9. the delete page", () => {
  it("points a subscriber inside the 14 days to Refund now, and names the plan, in both languages", async () => {
    const s = await subscriber("delete-refund");
    const en = await page("/account/delete", s);
    expect(en).toContain("A subscription to Pro, if there is one, is cancelled first, at once: it is not charged again, and the period already paid is not refunded.");
    expect(en).toContain('Refund now, on the <a href="/account/billing#refund">Plan and Billing page</a>, still returns your first payment in full. Deleting the account refunds nothing.');
    expect(en.match(/btn-primary/g)).toHaveLength(1);
    const fr = nbsp(await page("/account/delete?lang=fr", s)).replace(/&#39;|’/g, "'");
    expect(fr).toContain("Un abonnement à Pro, s'il y en a un, est d'abord annulé, immédiatement : il n'est plus facturé, et la période déjà payée n'est pas remboursée.");
    expect(fr).toContain('Rembourser maintenant, sur la <a href="/account/billing?lang=fr#refund">page Forfait et facturation</a>, vous rend encore votre premier paiement en entier. La suppression du compte ne rembourse rien.');
    for (const p of [en, fr]) {
      expect(p).not.toContain(EM_DASH);
      expect(p).not.toContain(EN_DASH);
    }
  });

  it("names Ultra for an Ultra subscriber, and a Free account reads the general line with no refund pointer", async () => {
    const u = await subscriber("delete-ultra", { plan: "ultra", env: saleEnv() });
    const ultra = await page("/account/delete", u, saleEnv());
    expect(ultra).toContain("A subscription to Ultra, if there is one, is cancelled first");
    expect(ultra).toContain("Refund now, on the");
    const free = await buyer("delete-free");
    const plain = await page("/account/delete", free);
    expect(plain).toContain("A paid subscription, if there is one, is cancelled first, at once: it is not charged again, and the period already paid is not refunded.");
    expect(plain).not.toContain("Refund now");
    // Past the window: no pointer.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 15 * DAY_S * 1000);
    expect(await page("/account/delete", u, saleEnv())).not.toContain("Refund now");
  });
});
