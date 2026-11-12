// Ultra, the plan above Pro, where money moves (src/account/billing.tsx,
// stripe.ts, payments.ts; docs/accounts.md, Ultra): checkout of either plan,
// the webhook's plan rules (only a paid notice raises a plan, an update notice
// only lowers one once Stripe confirms it, an unknown product never grants
// Ultra, a notice that cannot be confirmed changes nothing and answers 500),
// the move between the plans on Stripe's portal with its fallback, the
// billing page with Ultra on sale and off it, and the refund of the first
// payment, which a move takes away. Stripe is a fake fetch that records every
// request and answers from a table; notices are signed here with WebCrypto.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRACE_DAYS, refundState } from "../src/account/billing";
import { planFor } from "../src/account/entitlements";
import { STRIPE_VERSION, planOfSubscription, readEvent } from "../src/account/stripe";
import { app } from "../src/index";
import {
  ACCOUNTS, PRO_SALE, ULTRA_VARS, csrf, decode, get, nbsp, newEmail, nextIp, onEnv, post, signIn, ultraEnv, useAccountsDb, userId,
  withoutTiers,
} from "./accounts-helpers";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const WEBHOOK_SECRET = PRO_SALE.STRIPE_WEBHOOK_SECRET;
const payEnv = (extra: Record<string, unknown> = {}) => onEnv({ ...PRO_SALE, ...extra });
const saleEnv = (extra: Record<string, unknown> = {}) => ultraEnv(extra);

// The four prices, by plan and interval, and the two products.
const PRICE = {
  pro: { monthly: PRO_SALE.STRIPE_PRICE_MONTHLY, yearly: PRO_SALE.STRIPE_PRICE_YEARLY },
  ultra: { monthly: ULTRA_VARS.STRIPE_PRICE_ULTRA_MONTHLY, yearly: ULTRA_VARS.STRIPE_PRICE_ULTRA_YEARLY },
} as const;
const PRODUCT = { pro: "prod_proTEST", ultra: ULTRA_VARS.STRIPE_PRODUCT_ULTRA } as const;

// -- a fake Stripe ------------------------------------------------------------------

type Sent = { method: string; url: string; form: URLSearchParams };
type Reply = { status?: number; body?: unknown };

const DAY_S = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);
const iso = (s: number) => new Date(s * 1000).toISOString();

let sent: Sent[] = [];
let subs: Map<string, Record<string, unknown>> = new Map();
let failing: Map<string, number> = new Map();

type Item = { plan: "pro" | "ultra"; interval?: "monthly" | "yearly"; product?: string; price?: string };

// A subscription with one item on a plan's price (or the product and price given).
function subscriptionObject(id: string, customer: string, status: string, periodEnd: number, user: string | null, item: Item, pending?: Item) {
  const interval = item.interval ?? "monthly";
  const priceOf = (i: Item) => ({
    id: i.price ?? PRICE[i.plan][i.interval ?? "monthly"], object: "price", product: i.product ?? PRODUCT[i.plan],
    recurring: { interval: (i.interval ?? "monthly") === "monthly" ? "month" : "year", interval_count: 1 },
  });
  return {
    id, object: "subscription", customer, status, cancel_at_period_end: false,
    items: {
      object: "list",
      data: [{ id: `si_${id}`, object: "subscription_item", price: priceOf({ ...item, interval }), quantity: 1, current_period_end: periodEnd }],
    },
    pending_update: pending ? { expires_at: periodEnd, subscription_items: [{ id: `si_${id}`, object: "subscription_item", price: priceOf(pending) }] } : null,
    metadata: user ? { user_id: user } : {},
  };
}

function answer(method: string, path: string): Reply {
  const key = `${method} ${path.replace(/\/sub_[A-Za-z0-9_]+$/, "/:id")}`;
  const fail = failing.get(key);
  if (fail) return { status: fail, body: { error: { type: "invalid_request_error", message: "refused" } } };
  if (key === "POST /v1/checkout/sessions") return { body: { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" } };
  if (key === "POST /v1/billing_portal/sessions") return { body: { id: "bps_1", url: "https://billing.stripe.com/p/session/test_1" } };
  const id = path.split("/").pop() ?? "";
  if (key === "GET /v1/subscriptions/:id") return subs.has(id) ? { body: subs.get(id) } : { status: 404, body: { error: { code: "resource_missing" } } };
  return { status: 400, body: { error: { message: `unexpected ${key}` } } };
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  sent = [];
  subs = new Map();
  failing = new Map();
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.stripe.com/")) return realFetch(input, init);
    const method = init?.method ?? "GET";
    sent.push({ method, url, form: new URLSearchParams(typeof init?.body === "string" ? init.body : "") });
    const reply = answer(method, new URL(url).pathname);
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const calls = () => sent.map((s) => `${s.method} ${new URL(s.url).pathname}`);

// -- notices ---------------------------------------------------------------------------

const enc = new TextEncoder();
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let eventN = 0;
const eventId = () => `evt_ultra${Date.now().toString(36)}${eventN++}`;
const event = (type: string, object: object) => ({ id: eventId(), object: "event", type, api_version: STRIPE_VERSION, data: { object } });

async function deliver(notice: object, env: object = saleEnv()): Promise<Response> {
  const body = JSON.stringify(notice);
  const t = nowS();
  const headers = { "content-type": "application/json", "cf-connecting-ip": nextIp(), "stripe-signature": `t=${t},v1=${await hmacHex(WEBHOOK_SECRET, `${t}.${body}`)}` };
  return app.request("/account/billing/webhook", { method: "POST", headers, body }, env);
}

const checkoutCompleted = (user: string, sub: string, cus: string, paymentStatus = "paid") => event("checkout.session.completed", {
  id: `cs_${sub}`, object: "checkout.session", mode: "subscription", client_reference_id: user, customer: cus, subscription: sub,
  payment_status: paymentStatus, status: "complete",
});

const invoicePaid = (sub: string, cus: string, periodEnd: number, user: string | null) => event("invoice.paid", {
  id: `in_${sub}_${periodEnd}_${eventN}`, object: "invoice", customer: cus, status: "paid", billing_reason: "subscription_update",
  parent: { type: "subscription_details", subscription_details: { subscription: sub, metadata: user ? { user_id: user } : {} } },
  lines: { object: "list", data: [{ id: "il_1", object: "line_item", period: { start: periodEnd - 30 * DAY_S, end: periodEnd } }] },
});

const updated = (s: Record<string, unknown>) => event("customer.subscription.updated", s);

// -- reading state ---------------------------------------------------------------------

type Row = { plan: string; tier: string | null; source: string; starts_at: string; ends_at: string | null; reference: string | null };
const rows = async (email: string): Promise<Row[]> =>
  ((await ACCOUNTS.prepare(
    "SELECT e.plan, t.tier, e.source, e.starts_at, e.ends_at, e.reference FROM entitlements e LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id " +
    "WHERE e.user_id = ? ORDER BY e.created_at, e.id",
  ).bind(await userId(email)).all<Row>()).results ?? []);

async function planOf(email: string) {
  const id = await userId(email);
  const holder = await ACCOUNTS.prepare("SELECT id, plan, plan_until FROM users WHERE id = ?").bind(id).first<{ id: string; plan: string; plan_until: string | null }>();
  return planFor(saleEnv() as never, holder!);
}

const audits = async (email: string) =>
  ((await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = 'plan_changed' ORDER BY id").bind(await userId(email))
    .all<{ detail: string }>()).results ?? []).map((r) => r.detail);

let serial = 0;
const ids = () => {
  serial++;
  const tag = `${Date.now().toString(36)}u${serial}`;
  return { sub: `sub_${tag}`, cus: `cus_${tag}` };
};

// A signed-in account with a paid checkout of a plan behind it.
async function subscriber(plan: "pro" | "ultra", tag: string = plan, periodEnd = nowS() + 30 * DAY_S) {
  const email = newEmail(`u-${tag}`);
  const cookie = await signIn(email, { env: saleEnv() });
  const user = await userId(email);
  const { sub, cus } = ids();
  subs.set(sub, subscriptionObject(sub, cus, "active", periodEnd, user, { plan }));
  expect((await deliver(checkoutCompleted(user, sub, cus))).status).toBe(200);
  return { email, cookie, user, sub, cus, periodEnd };
}

const text = async (res: Response) => nbsp(decode(await res.text())).replace(/’/g, "'");

// =====================================================================================

describe("which plan a subscription pays for", () => {
  it("is Ultra on the Ultra product or one of its prices, Pro for anything else, and never Ultra without the variables", () => {
    const env = saleEnv() as never;
    const s = (item: Item) => readEvent(updated(subscriptionObject("sub_x", "cus_x", "active", nowS() + DAY_S, null, item)));
    const state = (item: Item) => {
      const r = s(item);
      if (!r.ok || r.notice.kind !== "subscription") throw new Error("not read");
      return r.notice.subscription;
    };
    expect(planOfSubscription(env, state({ plan: "ultra" }))).toBe("ultra");
    expect(planOfSubscription(env, state({ plan: "ultra", interval: "yearly" }))).toBe("ultra");
    // An older Ultra price on the Ultra product stays Ultra; an Ultra price on another product too.
    expect(planOfSubscription(env, state({ plan: "ultra", price: "price_ultraOLD" }))).toBe("ultra");
    expect(planOfSubscription(env, state({ plan: "pro", price: PRICE.ultra.monthly }))).toBe("ultra");
    expect(planOfSubscription(env, state({ plan: "pro" }))).toBe("pro");
    // A product the site does not know grants Pro, never Ultra.
    expect(planOfSubscription(env, state({ plan: "pro", product: "prod_unknown", price: "price_unknown" }))).toBe("pro");
    // Without Ultra's variables nothing is Ultra.
    expect(planOfSubscription(payEnv() as never, state({ plan: "ultra" }))).toBe("pro");
    // The item, its price, product and interval, and the pending update are read.
    expect(state({ plan: "ultra", interval: "yearly" }).item).toEqual({
      id: "si_sub_x", interval: "yearly", price: PRICE.ultra.yearly, product: PRODUCT.ultra,
    });
    expect(state({ plan: "pro" }).pending).toBeNull();
  });
});

describe("checkout of either plan", () => {
  it("buys Ultra at its price while it is on sale, Pro by default, and refuses another plan", async () => {
    const email = newEmail("u-checkout");
    const cookie = await signIn(email, { env: saleEnv() });
    const token = await csrf(cookie, "/account", { env: saleEnv() });
    const ultra = await post("/account/billing/checkout", { csrf: token, interval: "yearly", plan: "ultra" }, { cookie, env: saleEnv() });
    expect(ultra.status).toBe(303);
    expect(ultra.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    const session = sent.find((s) => new URL(s.url).pathname === "/v1/checkout/sessions")!;
    expect(session.form.get("line_items[0][price]")).toBe(PRICE.ultra.yearly);
    expect(session.form.get("success_url")).toBe("http://localhost/account?billing=done_ultra");
    expect(session.form.get("cancel_url")).toBe("http://localhost/account/billing?plan=ultra");
    // A form without a plan buys Pro, as before Ultra.
    sent = [];
    const other = newEmail("u-checkout-pro");
    const proCookie = await signIn(other, { env: saleEnv() });
    const proToken = await csrf(proCookie, "/account", { env: saleEnv() });
    expect((await post("/account/billing/checkout", { csrf: proToken, interval: "monthly" }, { cookie: proCookie, env: saleEnv() })).status).toBe(303);
    expect(sent.find((s) => new URL(s.url).pathname === "/v1/checkout/sessions")!.form.get("line_items[0][price]")).toBe(PRICE.pro.monthly);
    // Any other plan is refused before Stripe is asked.
    sent = [];
    expect((await post("/account/billing/checkout", { csrf: proToken, interval: "monthly", plan: "gold" }, { cookie: proCookie, env: saleEnv() })).status).toBe(400);
    expect(sent).toEqual([]);
  });

  it("does not sell Ultra while it is off sale: no variables, or no tier table, sends the reader back to the billing page", async () => {
    const email = newEmail("u-checkout-off");
    const cookie = await signIn(email, { env: payEnv() });
    const token = await csrf(cookie, "/account", { env: payEnv() });
    const off = await post("/account/billing/checkout", { csrf: token, interval: "monthly", plan: "ultra" }, { cookie, env: payEnv() });
    expect(off.status).toBe(303);
    expect(off.headers.get("location")).toBe("/account/billing");
    await withoutTiers(async () => {
      const res = await post("/account/billing/checkout", { csrf: token, interval: "monthly", plan: "ultra" }, { cookie, env: saleEnv() });
      expect(res.headers.get("location")).toBe("/account/billing");
    });
    expect(sent).toEqual([]);
  });

  it("checkout.session.completed for the Ultra product, paid, writes a pro row and its tier row in one go; unpaid writes nothing", async () => {
    const { email, user, periodEnd } = await subscriber("ultra", "bought");
    const until = iso(periodEnd + GRACE_DAYS * DAY_S);
    expect(await rows(email)).toEqual([expect.objectContaining({ plan: "pro", tier: "ultra", source: "stripe", ends_at: until })]);
    expect(await planOf(email)).toMatchObject({ plan: "ultra", until });
    // The users cache holds Ultra as pro.
    expect(await ACCOUNTS.prepare("SELECT plan FROM users WHERE id = ?").bind(user).first()).toEqual({ plan: "pro" });
    expect(await audits(email)).toEqual(["stripe checkout, granted"]);
    // Unpaid: bound, nothing granted.
    const other = newEmail("u-unpaid");
    await signIn(other, { env: saleEnv() });
    const otherUser = await userId(other);
    const { sub, cus } = ids();
    subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, otherUser, { plan: "ultra" }));
    expect((await deliver(checkoutCompleted(otherUser, sub, cus, "unpaid"))).status).toBe(200);
    expect(await rows(other)).toEqual([]);
    expect(await planOf(other)).toMatchObject({ plan: "free" });
  });

  it("an unknown product grants Pro, never Ultra", async () => {
    const email = newEmail("u-unknown");
    await signIn(email, { env: saleEnv() });
    const user = await userId(email);
    const { sub, cus } = ids();
    subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, user, { plan: "pro", product: "prod_other", price: "price_other" }));
    expect((await deliver(checkoutCompleted(user, sub, cus))).status).toBe(200);
    expect(await rows(email)).toEqual([expect.objectContaining({ plan: "pro", tier: null })]);
    expect(await planOf(email)).toMatchObject({ plan: "pro" });
  });

  it("an Ultra checkout on a database without the tier table answers 500 and writes no bare Pro row", async () => {
    const email = newEmail("u-no-tiers");
    await signIn(email, { env: saleEnv() });
    const user = await userId(email);
    const { sub, cus } = ids();
    subs.set(sub, subscriptionObject(sub, cus, "active", nowS() + 30 * DAY_S, user, { plan: "ultra" }));
    const notice = checkoutCompleted(user, sub, cus);
    await withoutTiers(async () => {
      expect((await deliver(notice)).status).toBe(500);
      expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?").bind(user).first()).toEqual({ n: 0 });
    });
    // Stripe sends it again once the table is there.
    expect((await deliver(notice)).status).toBe(200);
    expect(await planOf(email)).toMatchObject({ plan: "ultra" });
  });
});

describe("moving between the plans, as the webhook sees it", () => {
  it("an update naming Ultra raises nothing; the paid invoice that follows switches the live row to Ultra, keeping its end", async () => {
    const s = await subscriber("pro", "up");
    // The portal moves the item to Ultra: the update arrives before the payment.
    subs.set(s.sub, subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user, { plan: "ultra" }));
    expect((await deliver(updated(subs.get(s.sub)!))).status).toBe(200);
    expect(await planOf(s.email)).toMatchObject({ plan: "pro" });
    expect((await rows(s.email)).map((r) => r.tier)).toEqual([null]);
    // The proration invoice is paid: Stripe is asked for the subscription, and Ultra starts.
    sent = [];
    const before = new Date().toISOString();
    expect((await deliver(invoicePaid(s.sub, s.cus, s.periodEnd, s.user))).status).toBe(200);
    expect(calls()).toEqual([`GET /v1/subscriptions/${s.sub}`]);
    const [pro, ultra] = await rows(s.email);
    const until = iso(s.periodEnd + GRACE_DAYS * DAY_S);
    expect(pro.tier).toBeNull();
    expect(pro.ends_at! >= before).toBe(true);
    expect(ultra).toMatchObject({ plan: "pro", tier: "ultra", source: "stripe", reference: s.sub, ends_at: until });
    expect(pro.ends_at).toBe(ultra.starts_at);
    expect(await planOf(s.email)).toMatchObject({ plan: "ultra", until });
    expect(await audits(s.email)).toEqual(["stripe checkout, granted", "stripe moved to ultra"]);
  });

  it("a move up to a longer interval takes the paid period's later end", async () => {
    const s = await subscriber("pro", "up-yearly");
    const yearEnd = nowS() + 365 * DAY_S;
    subs.set(s.sub, subscriptionObject(s.sub, s.cus, "active", yearEnd, s.user, { plan: "ultra", interval: "yearly" }));
    expect((await deliver(invoicePaid(s.sub, s.cus, yearEnd, s.user))).status).toBe(200);
    expect(await planOf(s.email)).toMatchObject({ plan: "ultra", until: iso(yearEnd + GRACE_DAYS * DAY_S) });
  });

  it("a pending update naming Ultra answers 500 and changes nothing, and so does Stripe unreachable", async () => {
    const s = await subscriber("pro", "pending");
    const before = await rows(s.email);
    const binding = () => ACCOUNTS.prepare("SELECT status, current_period_end FROM payment_customers WHERE user_id = ?").bind(s.user).first();
    const bound = await binding();
    subs.set(s.sub, subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user, { plan: "pro" }, { plan: "ultra" }));
    const paid = invoicePaid(s.sub, s.cus, s.periodEnd + 30 * DAY_S, s.user);
    expect((await deliver(paid)).status).toBe(500);
    expect(await rows(s.email)).toEqual(before);
    expect(await planOf(s.email)).toMatchObject({ plan: "pro" });
    // The claim was given back: the notice is taken once the update is settled.
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE id = ?").bind(paid.id).first()).toEqual({ n: 0 });
    subs.set(s.sub, subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user, { plan: "pro" }));
    failing.set("GET /v1/subscriptions/:id", 503);
    const later = invoicePaid(s.sub, s.cus, s.periodEnd + 30 * DAY_S, s.user);
    expect((await deliver(later)).status).toBe(500);
    expect(await rows(s.email)).toEqual(before);
    expect(await binding()).toEqual(bound);
    failing.clear();
    expect((await deliver(later)).status).toBe(200);
    expect(await planOf(s.email)).toMatchObject({ plan: "pro", until: iso(s.periodEnd + 30 * DAY_S + GRACE_DAYS * DAY_S) });
  });

  it("a failed move up leaves Pro: the update and a past_due status raise nothing, and Pro runs to its end", async () => {
    const s = await subscriber("pro", "failed");
    subs.set(s.sub, subscriptionObject(s.sub, s.cus, "past_due", s.periodEnd, s.user, { plan: "ultra" }));
    expect((await deliver(updated(subs.get(s.sub)!))).status).toBe(200);
    expect(await planOf(s.email)).toMatchObject({ plan: "pro", until: iso(s.periodEnd + GRACE_DAYS * DAY_S) });
  });

  it("an update naming Pro while Ultra is live lowers it at once, keeping its end, once Stripe confirms; a late one does not", async () => {
    const s = await subscriber("ultra", "down");
    const until = iso(s.periodEnd + GRACE_DAYS * DAY_S);
    // A late notice from before the move up: Stripe still says Ultra, so nothing changes.
    const late = subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user, { plan: "pro" });
    expect((await deliver(updated(late))).status).toBe(200);
    expect(await planOf(s.email)).toMatchObject({ plan: "ultra" });
    // Stripe applies the move down at the renewal: the update names Pro and Stripe agrees.
    subs.set(s.sub, subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user, { plan: "pro" }));
    expect((await deliver(updated(subs.get(s.sub)!))).status).toBe(200);
    const after = await rows(s.email);
    expect(after.map((r) => r.tier)).toEqual(["ultra", null]);
    expect(after[1].ends_at).toBe(until);
    expect(await planOf(s.email)).toMatchObject({ plan: "pro", until });
    expect((await audits(s.email)).at(-1)).toBe("stripe moved to pro");
    // Stripe unreachable while a move down is to be confirmed: 500, and nothing changes.
    const t = await subscriber("ultra", "down-down");
    failing.set("GET /v1/subscriptions/:id", 503);
    expect((await deliver(updated(subscriptionObject(t.sub, t.cus, "active", t.periodEnd, t.user, { plan: "pro" })))).status).toBe(500);
    expect(await planOf(t.email)).toMatchObject({ plan: "ultra" });
  });

  it("a full refund ends either plan's Stripe rows, as before", async () => {
    const s = await subscriber("ultra", "refunded");
    const refund = event("charge.refunded", { id: `ch_${s.sub}`, object: "charge", customer: s.cus, amount: 3000, amount_refunded: 3000, refunded: true });
    expect((await deliver(refund)).status).toBe(200);
    expect(await planOf(s.email)).toMatchObject({ plan: "free" });
  });
});

describe("the move from the billing page", () => {
  it("opens Stripe's portal at the move: the subscription's item to the other plan's price of the same interval", async () => {
    const s = await subscriber("pro", "move", nowS() + 30 * DAY_S);
    subs.set(s.sub, subscriptionObject(s.sub, s.cus, "active", s.periodEnd, s.user, { plan: "pro", interval: "yearly" }));
    const token = await csrf(s.cookie, "/account", { env: saleEnv() });
    sent = [];
    const res = await post("/account/billing/change", { csrf: token, plan: "ultra" }, { cookie: s.cookie, env: saleEnv() });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://billing.stripe.com/p/session/test_1");
    expect(calls()).toEqual([`GET /v1/subscriptions/${s.sub}`, "POST /v1/billing_portal/sessions"]);
    const form = sent[1].form;
    expect(form.get("customer")).toBe(s.cus);
    expect(form.get("flow_data[type]")).toBe("subscription_update_confirm");
    expect(form.get("flow_data[subscription_update_confirm][subscription]")).toBe(s.sub);
    expect(form.get("flow_data[subscription_update_confirm][items][0][id]")).toBe(`si_${s.sub}`);
    expect(form.get("flow_data[subscription_update_confirm][items][0][price]")).toBe(PRICE.ultra.yearly);
    expect(form.get("flow_data[subscription_update_confirm][items][0][quantity]")).toBe("1");
    expect(form.get("flow_data[after_completion][type]")).toBe("redirect");
    expect(form.get("flow_data[after_completion][redirect][return_url]")).toBe("http://localhost/account/billing?move=sent");
    expect(form.get("return_url")).toBe("http://localhost/account/billing");
    // Nothing is written by the move: the webhook decides.
    expect(await planOf(s.email)).toMatchObject({ plan: "pro" });
  });

  it("falls back to the plain portal when Stripe refuses the flow, and is refused while Ultra is off sale", async () => {
    const s = await subscriber("pro", "move-refused");
    const token = await csrf(s.cookie, "/account", { env: saleEnv() });
    sent = [];
    let first = true;
    // The first portal session (the flow) is refused with a 400, the second (plain) answers.
    vi.mocked(globalThis.fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://api.stripe.com/")) return realFetch(input, init);
      const path = new URL(url).pathname;
      sent.push({ method: init?.method ?? "GET", url, form: new URLSearchParams(typeof init?.body === "string" ? init.body : "") });
      if (path === "/v1/billing_portal/sessions" && first) {
        first = false;
        return new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status: 400 });
      }
      const reply = answer(init?.method ?? "GET", path);
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
    });
    const res = await post("/account/billing/change", { csrf: token, plan: "ultra" }, { cookie: s.cookie, env: saleEnv() });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://billing.stripe.com/p/session/test_1");
    const portals = sent.filter((x) => new URL(x.url).pathname === "/v1/billing_portal/sessions");
    expect(portals).toHaveLength(2);
    expect(portals[0].form.get("flow_data[type]")).toBe("subscription_update_confirm");
    expect(portals[1].form.has("flow_data[type]")).toBe(false);
    // Off sale: back to the billing page, nothing asked of Stripe.
    sent = [];
    const off = await post("/account/billing/change", { csrf: token, plan: "ultra" }, { cookie: s.cookie, env: payEnv() });
    expect(off.status).toBe(303);
    expect(off.headers.get("location")).toBe("/account/billing");
    expect(sent).toEqual([]);
    expect((await post("/account/billing/change", { csrf: token, plan: "gold" }, { cookie: s.cookie, env: saleEnv() })).status).toBe(400);
  });

  it("takes an Ultra subscriber down to Pro's price, returning to ?move=down", async () => {
    const s = await subscriber("ultra", "move-down");
    const token = await csrf(s.cookie, "/account", { env: saleEnv() });
    sent = [];
    expect((await post("/account/billing/change", { csrf: token, plan: "pro" }, { cookie: s.cookie, env: saleEnv() })).status).toBe(303);
    const form = sent.find((x) => new URL(x.url).pathname === "/v1/billing_portal/sessions")!.form;
    expect(form.get("flow_data[subscription_update_confirm][items][0][price]")).toBe(PRICE.pro.monthly);
    expect(form.get("flow_data[after_completion][redirect][return_url]")).toBe("http://localhost/account/billing?move=down");
  });
});

describe("the billing page", () => {
  const cardsOf = (html: string): string[] => {
    const at = html.indexOf('<div class="plan-cards"');
    return html.slice(at, html.indexOf("</section>", at)).split(/(?=<div class="plan-card[ "])/).slice(1);
  };
  const filled = (html: string) => (html.match(/class="btn btn-primary"/g) ?? []).length;

  it("is byte for byte the page without Ultra's variables while Ultra is off sale, for Free and Pro readers", async () => {
    const free = newEmail("u-page-free");
    const freeCookie = await signIn(free, { env: payEnv() });
    const s = await subscriber("pro", "page-pro");
    for (const cookie of [freeCookie, s.cookie]) {
      for (const lang of ["en", "fr"]) {
        const path = `/account/billing?lang=${lang}`;
        const plain = await (await get(path, { cookie, env: payEnv() })).text();
        await withoutTiers(async () => {
          expect(await (await get(path, { cookie, env: saleEnv() })).text(), path).toBe(plain);
          expect(await (await get(`${path}&plan=ultra&move=sent`, { cookie, env: saleEnv() })).text(), path)
            .toBe(await (await get(`${path}&plan=ultra&move=sent`, { cookie, env: payEnv() })).text());
        });
        expect(plain).not.toContain("Ultra");
      }
    }
  });

  it("offers Ultra beside Pro while it is on sale: three cards, Ultra's Subscribe panel at ?plan=ultra, the line to the other plan", async () => {
    const email = newEmail("u-page-sale");
    const cookie = await signIn(email, { env: saleEnv() });
    const html = await text(await get("/account/billing", { cookie, env: saleEnv() }));
    expect(html).toContain('<div class="panel-head"><h2>Plans</h2></div>');
    expect(html).not.toContain("What Pro Includes");
    const cards = cardsOf(html);
    expect(cards).toHaveLength(3);
    expect(cards[2]).toMatch(/^<div class="plan-card plan-card-ultra"><div class="plan-card-head"><h3>Ultra<\/h3><span class="ultra-tag">/);
    expect(cards[2]).toContain('<strong class="plan-amount">CA$30</strong> a month or CA$301.50 a year');
    expect(cards[2]).toContain('<a href="/account/billing?plan=ultra#subscribe" class="btn">Subscribe to Ultra</a>');
    expect(html).toContain("Subscribe to Ultra instead");
    const ultra = await text(await get("/account/billing?plan=ultra", { cookie, env: saleEnv() }));
    const panel = ultra.slice(ultra.indexOf('id="subscribe"'));
    expect(panel).toContain("Subscribe to Ultra");
    expect(panel).toContain('<input type="hidden" name="plan" value="ultra"/>');
    expect(panel).toContain("Monthly, CA$30 a month");
    expect(panel).toContain("Yearly, CA$301.50 a year (CA$25.13 a month)");
    expect(panel).toContain("Ultra is sold through Link");
    expect(panel).toContain('<a href="/account/billing#subscribe">Subscribe to Pro instead</a>');
    // The chosen plan's link is the filled one; Pro's leads back to Pro's panel.
    expect(cardsOf(ultra)[1]).toContain('<a href="/account/billing#subscribe" class="btn">Subscribe to Pro</a>');
    for (const page of [html, ultra]) {
      expect(page).not.toContain(EM_DASH);
      expect(page).not.toContain(EN_DASH);
    }
  });

  it("offers a Stripe Pro subscriber the move up, plain, the Manage button staying the filled one", async () => {
    const s = await subscriber("pro", "page-move");
    const html = await text(await get("/account/billing", { cookie: s.cookie, env: saleEnv() }));
    const move = html.slice(html.indexOf('id="move"'), html.indexOf("</section>", html.indexOf('id="move"')));
    expect(move).toContain("Move to Ultra");
    expect(move).toContain("Ultra is CA$30 a month or CA$301.50 a year. Moving now charges the price of Ultra for the rest of the current period");
    expect(move).toContain('<input type="hidden" name="plan" value="ultra"/>');
    expect(move).toContain('<button type="submit" class="btn">Move to Ultra</button>');
    expect(html).toContain("switches between monthly and yearly and between Pro and Ultra");
    expect(filled(html.slice(html.indexOf("<main"), html.indexOf("</main>")))).toBe(1);
    expect(cardsOf(html)[2]).toContain('<a href="#move" class="btn">Move to Ultra</a>');
    // After Stripe's page: the line saying Ultra starts with the payment.
    expect(await text(await get("/account/billing?move=sent", { cookie: s.cookie, env: saleEnv() })))
      .toContain("Ultra starts once Stripe confirms the payment, usually within a minute.");
  });

  it("shows an Ultra subscriber its plan, the move down and Ultra in the refund's lines", async () => {
    const s = await subscriber("ultra", "page-ultra");
    const html = await text(await get("/account/billing", { cookie: s.cookie, env: saleEnv() }));
    expect(html).toContain(`Your plan today: Ultra, paid until ${iso(s.periodEnd).slice(0, 10)}.`);
    expect(html).toContain('<button type="submit" class="btn">Move to Pro</button>');
    expect(html).toContain("Moving to Pro takes effect at the end of the period already paid; Ultra continues until then.");
    expect(html).toContain("Refund now returns your first payment in full, taxes included, and ends Ultra at once.");
    const overview = await text(await get("/account", { cookie: s.cookie, env: saleEnv() }));
    expect(overview).toContain(`<dd>Ultra, paid until ${iso(s.periodEnd).slice(0, 10)}</dd>`);
    expect(overview).toContain('<span class="brand-plan brand-plan-ultra">ultra</span>');
    const fr = await text(await get("/account/billing?lang=fr", { cookie: s.cookie, env: saleEnv() }));
    expect(fr).toContain("et met fin à Ultra immédiatement.");
    const confirm = await text(await get("/account/billing?refund=confirm", { cookie: s.cookie, env: saleEnv() }));
    expect(confirm).toContain('<a href="/account/billing" class="btn">Keep Ultra</a>');
    expect(confirm).toContain("I want my first payment refunded and Ultra ended now.");
  });
});

describe("the refund of the first payment", () => {
  it("is offered for an Ultra first payment, and taken away by a move", async () => {
    const s = await subscriber("ultra", "refund-ultra");
    const facts = async () => {
      const row = await ACCOUNTS.prepare("SELECT user_id, customer_id, subscription_id, status, current_period_end FROM payment_customers WHERE user_id = ?")
        .bind(s.user).first<never>();
      return refundState(saleEnv() as never, s.user, row, { stripe: true, periodEnd: null });
    };
    expect(await facts()).toBe("offer");
    const page = await text(await get("/account/billing", { cookie: s.cookie, env: saleEnv() }));
    expect(page).toContain("Refund of the First Payment");
    // A move up from Pro: no refund on the page, and a press is refused.
    const p = await subscriber("pro", "refund-moved");
    subs.set(p.sub, subscriptionObject(p.sub, p.cus, "active", p.periodEnd, p.user, { plan: "ultra" }));
    expect((await deliver(invoicePaid(p.sub, p.cus, p.periodEnd, p.user))).status).toBe(200);
    expect(await planOf(p.email)).toMatchObject({ plan: "ultra" });
    const moved = await text(await get("/account/billing", { cookie: p.cookie, env: saleEnv() }));
    expect(moved).not.toContain('id="refund"');
    const token = await csrf(p.cookie, "/account", { env: saleEnv() });
    sent = [];
    const press = await post("/account/billing/refund", { csrf: token, confirm: "yes" }, { cookie: p.cookie, env: saleEnv() });
    expect(press.status).toBe(409);
    expect(await text(press)).toContain("cannot be refunded from this page");
    expect(sent).toEqual([]);
  });
});
