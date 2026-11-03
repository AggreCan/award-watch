// Adversarial checks of phases 2 and 3: the stop link of a delivery, the
// payment notices, the delivery job, and the paid view, key and caching
// attempts of test/hardening.test.ts again with entitlement rows of source
// 'stripe' written by the webhook itself. Stripe is a fake fetch answering
// from tables; notices are signed here with WebCrypto, apart from the code
// under test.
//
// Other test files share the accounts database. A delivery run here is held
// to this file's own accounts (scoped(), which narrows the job's one
// candidate statement to them), and its searches carry a last delivery after
// the other files' data date, so their runs never take them either.
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "../public/closing.js";
import { apiKeyOf, forgetKeys, requireApiKey } from "../src/account/api_keys";
import { runDeliveries } from "../src/account/deliveries";
import { account } from "../src/account/routes";
import { forgetSessions } from "../src/account/session";
import { STRIPE_VERSION } from "../src/account/stripe";
import type { ExpiringRow, TenderRow } from "../src/data";
import type { AppEnv } from "../src/env";
import { app } from "../src/index";
import { INTRADAY_SQL } from "../src/intraday";
import { bucketFor, throttle } from "../src/limits";
import { WINDOW_DAYS } from "../src/pages/expiring";
import wranglerConfig from "../wrangler.jsonc?raw";
import { ACCOUNTS, csrf, get, nbsp, newEmail, nextIp, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { makeFakeAssets } from "./assets";
import stats from "./fixtures/stats.json";
import { applySql } from "./setup";

useAccountsDb();

const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const INTRADAY_SCHEMA = (env as unknown as { INTRADAY_SCHEMA_SQL: string }).INTRADAY_SCHEMA_SQL;

// A same-day notice with strings no published file holds.
const PAID = { reference: "cb-778-77800001", title: "Wombat burrow census, paid view only" };
const BAND = /<section class="panel intraday">[\s\S]*?<\/section>/;
const RAIL_ACCOUNT = /<li><a class="rail-item rail-account"[^>]*><span class="rail-label">[^<]*<\/span><\/a><\/li>/;
const PLAN_MARK = /<span class="brand-plan brand-plan-(?:free|pro)">[^<]*<\/span>/;

beforeAll(async () => {
  await applySql(SEARCH, INTRADAY_SCHEMA);
  await SEARCH.prepare(
    "INSERT OR REPLACE INTO intraday_tenders (reference, amendment, seen_at, published, closing, title_en, title_fr, buyer_name, category, " +
    "segments, provinces, codes) VALUES (?, 0, '2026-10-31T15:45:10Z', '2026-10-31', '2026-11-20T14:00:00', ?, ?, 'Paid View Office', " +
    "'[\"SRV\"]', '[\"72\"]', '[\"MB\"]', '[]')",
  ).bind(PAID.reference, PAID.title, PAID.title).run();
});

// -- Stripe, faked ----------------------------------------------------------------------

const SECRET_KEY = "sk_test_hardening0000";
const WEBHOOK_SECRET = "whsec_hardening0000";
const KEYS = {
  STRIPE_SECRET_KEY: SECRET_KEY, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PRICE_MONTHLY: "price_monthlyHARD", STRIPE_PRICE_YEARLY: "price_yearlyHARD",
  PRICE_MONTHLY_CAD: "12", PRICE_YEARLY_CAD: "120",
};
const payEnv = (extra: Record<string, unknown> = {}) => onEnv({ ...KEYS, ...extra });

type Sent = { method: string; path: string; form: URLSearchParams };
let sent: Sent[] = [];
let subs = new Map<string, Record<string, unknown>>();
let charges = new Map<string, Record<string, unknown>>();
let failing = new Set<string>();

const DAY_S = 86_400;
const nowS = () => Math.floor(Date.now() / 1000);

function subscriptionObject(id: string, customer: string, status: string, periodEnd: number, user: string | null) {
  return {
    id, object: "subscription", customer, status,
    items: { object: "list", data: [{ id: `si_${id}`, object: "subscription_item", current_period_end: periodEnd }] },
    metadata: user ? { user_id: user } : {},
  };
}

function answer(method: string, path: string): { status?: number; body?: unknown } {
  const last = path.split("/").pop() ?? "";
  const key = `${method} ${/^(sub|ch)_/.test(last) ? path.replace(/[^/]+$/, ":id") : path}`;
  if (failing.has(key)) return { status: 500, body: {} };
  if (key === "POST /v1/checkout/sessions") return { body: { id: "cs_h", url: "https://checkout.stripe.com/c/pay/cs_h" } };
  if (key === "POST /v1/billing_portal/sessions") return { body: { id: "bps_h", url: "https://billing.stripe.com/p/session/h" } };
  if (key === "GET /v1/subscriptions/:id") return subs.has(last) ? { body: subs.get(last) } : { status: 404, body: {} };
  if (key === "GET /v1/charges/:id") return charges.has(last) ? { body: charges.get(last) } : { status: 404, body: {} };
  if (key === "DELETE /v1/subscriptions/:id") {
    const s = subs.get(last);
    if (!s) return { status: 404, body: {} };
    s.status = "canceled";
    return { body: s };
  }
  return { status: 400, body: {} };
}

beforeEach(() => {
  sent = [];
  subs = new Map();
  charges = new Map();
  failing = new Set();
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.stripe.com/")) return real(input, init);
    const method = init?.method ?? "GET";
    const path = new URL(url).pathname;
    sent.push({ method, path, form: new URLSearchParams(typeof init?.body === "string" ? init.body : "") });
    const reply = answer(method, path);
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A notice as Stripe sends it: the raw text, signed over its own bytes.
async function deliverRaw(body: string, o: { t?: number; signedBody?: string; env?: object; header?: string } = {}): Promise<Response> {
  const t = o.t ?? nowS();
  const header = o.header ?? `t=${t},v1=${await hmacHex(WEBHOOK_SECRET, `${t}.${o.signedBody ?? body}`)}`;
  return app.request("/account/billing/webhook", {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": header, "cf-connecting-ip": nextIp() }, body,
  }, o.env ?? payEnv());
}
const deliver = (event: object, o: { t?: number; env?: object } = {}) => deliverRaw(JSON.stringify(event), o);

let n = 0;
const eventId = () => `evt_hard${Date.now().toString(36)}${n++}`;
const event = (type: string, object: object, id = eventId()) => ({ id, object: "event", type, api_version: STRIPE_VERSION, data: { object } });
const tag = () => `${Date.now().toString(36)}${n++}`;

const checkoutCompleted = (user: string | null, sub: string, cus: string, extra: object = {}) => event("checkout.session.completed", {
  id: `cs_${sub}`, object: "checkout.session", mode: "subscription", ...(user ? { client_reference_id: user } : {}), customer: cus,
  subscription: sub, payment_status: "paid", status: "complete", ...extra,
});
const invoicePaid = (sub: string, cus: string, periodEnd: number, user: string | null, extra: object = {}) => event("invoice.paid", {
  id: `in_${sub}_${periodEnd}`, object: "invoice", customer: cus, status: "paid",
  parent: { type: "subscription_details", subscription_details: { subscription: sub, metadata: user ? { user_id: user } : {} } },
  lines: { object: "list", data: [{ id: "il_1", object: "line_item", period: { start: periodEnd - 30 * DAY_S, end: periodEnd } }] },
  ...extra,
});
const subscriptionEvent = (type: "updated" | "deleted", sub: string, cus: string, status: string, periodEnd: number, user: string) =>
  event(`customer.subscription.${type}`, subscriptionObject(sub, cus, status, periodEnd, user));
const chargeRefunded = (ch: string, cus: string, amount: number, back: number) => event("charge.refunded", {
  id: ch, object: "charge", customer: cus, amount, amount_refunded: back, refunded: back >= amount, currency: "cad",
});
const disputeCreated = (ch: string) => event("charge.dispute.created", {
  id: `dp_${ch}`, object: "dispute", charge: ch, amount: 1200, currency: "cad", reason: "fraudulent", status: "needs_response",
});

const stripeRows = async (user: string) =>
  ((await ACCOUNTS.prepare("SELECT plan, source, ends_at, reference, revoked_at FROM entitlements WHERE user_id = ? AND source = 'stripe'")
    .bind(user).all<{ plan: string; source: string; ends_at: string | null; reference: string; revoked_at: string | null }>()).results ?? []);
const liveStripe = async (user: string) => (await stripeRows(user)).filter((r) => !r.revoked_at && (r.ends_at === null || r.ends_at > new Date().toISOString()));
const audits = async (user: string) =>
  ((await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = 'plan_changed' ORDER BY id").bind(user).all<{ detail: string }>()).results ?? [])
    .map((r) => r.detail);

// A signed-in user subscribed through the webhook, as Stripe's checkout leaves one.
async function subscriber(label: string, periodEnd = nowS() + 30 * DAY_S) {
  const email = newEmail(label);
  const cookie = await signIn(email, { env: payEnv() });
  const user = await userId(email);
  const t = tag();
  const sub = `sub_h${t}`;
  const cus = `cus_h${t}`;
  subs.set(sub, subscriptionObject(sub, cus, "active", periodEnd, user));
  expect((await deliver(checkoutCompleted(user, sub, cus))).status).toBe(200);
  expect(await liveStripe(user)).toHaveLength(1);
  return { email, cookie, user, sub, cus, periodEnd };
}

// -- recording and scoping a binding ---------------------------------------------------------

type Recorder = { db: D1Database; sql: string[] };

// Runs everything on the real binding, recording each statement's text;
// rewrite may change a statement's text before it is prepared.
function recording(real: D1Database, rewrite: (sql: string) => string = (s) => s): Recorder {
  const sql: string[] = [];
  const db = {
    prepare: (q: string) => {
      const text = rewrite(q);
      sql.push(text);
      return real.prepare(text);
    },
    batch: (stmts: D1PreparedStatement[]) => real.batch(stmts),
    exec: (q: string) => real.exec(q),
  } as unknown as D1Database;
  return { db, sql };
}

function trap<T>(what: string): { used: string[]; binding: T } {
  const used: string[] = [];
  const binding = new Proxy({}, { get(_t, prop) { used.push(String(prop)); throw new Error(`${what} was used`); } }) as T;
  return { used, binding };
}

const broken = {
  prepare: () => { throw new Error("D1_ERROR: database unavailable"); },
  batch: () => { throw new Error("D1_ERROR: database unavailable"); },
} as unknown as D1Database;

// Every console line a block writes, joined, with nothing printed.
async function consoleOf(run: () => Promise<unknown>): Promise<string> {
  const lines: unknown[][] = [];
  const spies = (["log", "error", "warn", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a); }));
  try {
    await run();
  } finally {
    for (const s of spies) s.mockRestore();
  }
  return lines.map((a) => a.map((x) => (typeof x === "string" ? x : x instanceof Error ? `${x.message} ${x.stack ?? ""}` : JSON.stringify(x))).join(" ")).join("\n");
}

// =========================================================================================
// The webhook
// =========================================================================================

describe("the webhook", () => {
  it("checks the bytes as sent: a body spaced differently from the one signed is refused, and any spacing that was signed is taken", async () => {
    const email = newEmail("raw");
    await signIn(email, { env: payEnv() });
    const user = await userId(email);
    const t = tag();
    subs.set(`sub_r${t}`, subscriptionObject(`sub_r${t}`, `cus_r${t}`, "active", nowS() + 30 * DAY_S, user));
    const notice = checkoutCompleted(user, `sub_r${t}`, `cus_r${t}`);
    const spaced = JSON.stringify(notice, null, 2);
    // Signed over the spaced text, sent compact: the same JSON, other bytes.
    expect((await deliverRaw(JSON.stringify(notice), { signedBody: spaced })).status).toBe(400);
    expect(await stripeRows(user)).toEqual([]);
    expect((await deliverRaw(spaced)).status).toBe(200);
    expect(await liveStripe(user)).toHaveLength(1);
  });

  it("refuses a signature more than five minutes old or ahead at the route, and a taken notice signed again changes nothing", async () => {
    const { user, sub, cus } = await subscriber("tolerance");
    const renewal = invoicePaid(sub, cus, nowS() + 60 * DAY_S, user);
    for (const t of [nowS() - 301, nowS() + 301, 0, 9_999_999_999]) expect((await deliver(renewal, { t })).status, String(t)).toBe(400);
    expect((await deliver(renewal)).status).toBe(200);
    const after = await stripeRows(user);
    const again = await deliver(renewal);
    expect([again.status, await again.text()]).toEqual([200, "Already received."]);
    expect(await stripeRows(user)).toEqual(after);
  });

  it("applies a notice once when it arrives several times at once", async () => {
    const email = newEmail("burst-notice");
    await signIn(email, { env: payEnv() });
    const user = await userId(email);
    const t = tag();
    subs.set(`sub_b${t}`, subscriptionObject(`sub_b${t}`, `cus_b${t}`, "active", nowS() + 30 * DAY_S, user));
    const notice = checkoutCompleted(user, `sub_b${t}`, `cus_b${t}`);
    const res = await Promise.all(Array.from({ length: 6 }, () => deliver(notice)));
    expect(res.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(await stripeRows(user)).toHaveLength(1);
    expect((await audits(user)).filter((d) => d === "stripe checkout, granted")).toHaveLength(1);
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE id = ?").bind(notice.id).first<{ n: number }>())?.n).toBe(1);
  });

  it("refuses a body past the cap, and anything unsigned, writing nothing", async () => {
    const before = (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM payment_events").first<{ n: number }>())?.n ?? 0;
    const big = JSON.stringify(event("invoice.paid", { pad: "x".repeat(1024 * 1024) }));
    expect((await deliverRaw(big)).status).toBe(400);
    for (const header of ["", "t=1", `t=${nowS()}`, `t=${nowS()},v1=`, `t=${nowS()},v0=${"0".repeat(64)}`, `v1=${"0".repeat(64)}`]) {
      expect((await deliverRaw(JSON.stringify(event("invoice.paid", {})), { header })).status, header).toBe(400);
    }
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM payment_events").first<{ n: number }>())?.n ?? 0).toBe(before);
  });

  it("finds the account by client_reference_id or the ids already bound, never by an address", async () => {
    const victim = newEmail("victim");
    await signIn(victim, { env: payEnv() });
    const victimId = await userId(victim);
    const t = tag();
    subs.set(`sub_v${t}`, subscriptionObject(`sub_v${t}`, `cus_v${t}`, "active", nowS() + 30 * DAY_S, null));
    // A paid checkout naming the victim's address everywhere but client_reference_id.
    const byAddress = checkoutCompleted(null, `sub_v${t}`, `cus_v${t}`, {
      customer_email: victim, customer_details: { email: victim, name: "Someone" }, metadata: { email: victim },
    });
    expect((await deliver(byAddress)).status).toBe(200);
    expect((await deliver(checkoutCompleted("not-a-user-id", `sub_v${t}`, `cus_v${t}`))).status).toBe(200);
    expect((await deliver(invoicePaid(`sub_v${t}`, `cus_v${t}`, nowS() + 40 * DAY_S, null, { customer_email: victim }))).status).toBe(200);
    expect(await stripeRows(victimId)).toEqual([]);
    // A subscription bound to A whose metadata names B extends A and grants B nothing.
    const a = await subscriber("bound-a");
    const bEmail = newEmail("hint-b");
    await signIn(bEmail, { env: payEnv() });
    const b = await userId(bEmail);
    expect((await deliver(invoicePaid(a.sub, a.cus, nowS() + 70 * DAY_S, b))).status).toBe(200);
    expect(await stripeRows(b)).toEqual([]);
    expect((await liveStripe(a.user))[0].ends_at! > new Date((nowS() + 60 * DAY_S) * 1000).toISOString()).toBe(true);
  });

  it("logs no payload: no id, address, key or secret, whatever the notice does", async () => {
    const s = await subscriber("quiet");
    charges.set(`ch_q${s.sub}`, { id: `ch_q${s.sub}`, object: "charge", customer: s.cus });
    const out = await consoleOf(async () => {
      await deliver(invoicePaid(s.sub, s.cus, nowS() + 60 * DAY_S, s.user));
      await deliverRaw(JSON.stringify(invoicePaid(s.sub, s.cus, nowS() + 61 * DAY_S, s.user)), { header: `t=${nowS()},v1=${"0".repeat(64)}` });
      failing.add("GET /v1/subscriptions/:id");
      await deliver(checkoutCompleted(s.user, `sub_x${s.sub}`, s.cus));
      failing.add("GET /v1/charges/:id");
      await deliver(disputeCreated(`ch_q${s.sub}`));
      await deliver(chargeRefunded(`ch_none${s.sub}`, "cus_nobody", 1200, 1200));
      await deliver(subscriptionEvent("deleted", "sub_nobody", "cus_nobody", "canceled", nowS(), s.user.replace(/./, "f")));
      await deliver(chargeRefunded(`ch_q${s.sub}`, s.cus, 1200, 1200));
    });
    expect(out).toContain("billing webhook");
    for (const secret of [s.user, s.email, s.sub, s.cus, `ch_q${s.sub}`, "cus_nobody", "sub_nobody", "evt_", WEBHOOK_SECRET, SECRET_KEY, "1200"]) {
      expect(out, secret).not.toContain(secret);
    }
  });

  it("is the site's 404 while the switch is off, reading nothing; with the switch on and no keys it refuses every notice (400)", async () => {
    expect(account.routes.some((r) => r.method === "POST" && r.path === "/billing/webhook")).toBe(true);
    const db = trap<D1Database>("the accounts database");
    const off = { ...payEnv({ ACCOUNTS: db.binding }), ACCOUNTS_ENABLED: "false" };
    const notice = event("invoice.paid", {});
    expect((await deliver(notice, { env: off })).status).toBe(404);
    expect(db.used).toEqual([]);
    const noKeys = onEnv();
    const before = (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM payment_events").first<{ n: number }>())?.n ?? 0;
    expect((await deliver(notice, { env: noKeys })).status).toBe(400);
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM payment_events").first<{ n: number }>())?.n ?? 0).toBe(before);
    expect(sent).toEqual([]);
  });
});

// =========================================================================================
// Refunds and disputes
// =========================================================================================

describe("a full refund or a dispute", () => {
  it("a full refund ends the live Stripe Pro at once; a partial one, or one for no bound customer, changes nothing", async () => {
    const s = await subscriber("refund");
    const ch = `ch_r${s.sub}`;
    expect((await deliver(chargeRefunded(ch, s.cus, 1200, 600))).status).toBe(200);
    expect(await liveStripe(s.user)).toHaveLength(1);
    expect((await deliver(chargeRefunded(`ch_o${s.sub}`, "cus_unbound", 1200, 1200))).status).toBe(200);
    expect(await liveStripe(s.user)).toHaveLength(1);
    // A manual grant of the same account is not Stripe's to end.
    await ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (lower(hex(randomblob(16))), ?, 'pro', 'manual', ?, NULL, 'kept', ?)",
    ).bind(s.user, new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() - 60_000).toISOString()).run();
    const res = await deliver(chargeRefunded(ch, s.cus, 1200, 1200));
    expect(res.status).toBe(200);
    expect(await liveStripe(s.user)).toEqual([]);
    expect(await audits(s.user)).toContain("stripe ended, refunded");
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ? AND source = 'manual' AND ends_at IS NULL").bind(s.user).first<{ n: number }>())?.n).toBe(1);
    // No call to Stripe was needed: the charge names its customer.
    expect(sent.filter((x) => x.path.startsWith("/v1/charges"))).toEqual([]);
  });

  it("a dispute ends it at once, reading the charge for its customer; a failed read answers 500 and the retry applies it", async () => {
    const s = await subscriber("dispute");
    const ch = `ch_d${s.sub}`;
    charges.set(ch, { id: ch, object: "charge", customer: s.cus, amount: 1200 });
    const notice = disputeCreated(ch);
    failing.add("GET /v1/charges/:id");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await deliver(notice)).status).toBe(500);
    quiet.mockRestore();
    expect(await liveStripe(s.user)).toHaveLength(1);
    failing.delete("GET /v1/charges/:id");
    expect((await deliver(notice)).status).toBe(200);
    expect(await liveStripe(s.user)).toEqual([]);
    expect(await audits(s.user)).toContain("stripe ended, disputed");
    expect(sent.filter((x) => x.method === "GET" && x.path === `/v1/charges/${ch}`)).toHaveLength(2);
    // A dispute on a charge Stripe does not know changes nothing.
    const other = await subscriber("dispute-unknown");
    const quiet2 = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await deliver(disputeCreated(`ch_missing${other.sub}`))).status).toBe(200);
    quiet2.mockRestore();
    expect(await liveStripe(other.user)).toHaveLength(1);
  });

  it("leaves the subscription billing: a later paid invoice grants Pro again", async () => {
    const s = await subscriber("refund-renew");
    expect((await deliver(chargeRefunded(`ch_rr${s.sub}`, s.cus, 1200, 1200))).status).toBe(200);
    expect(await liveStripe(s.user)).toEqual([]);
    expect((await deliver(invoicePaid(s.sub, s.cus, nowS() + 60 * DAY_S, s.user))).status).toBe(200);
    expect(await liveStripe(s.user)).toHaveLength(1);
  });

  it("are read from the notice: refunded true, or the amount refunded reaching the amount", async () => {
    const { readEvent } = await import("../src/account/stripe");
    const kind = (o: object, type = "charge.refunded") => {
      const r = readEvent({ id: "evt_x", type, data: { object: o } });
      return r.ok ? r.notice : null;
    };
    expect(kind({ id: "ch_1", customer: "cus_1", amount: 1200, amount_refunded: 1200 })).toEqual({ kind: "reversed", chargeId: "ch_1", customerId: "cus_1", why: "refunded" });
    expect(kind({ id: "ch_1", customer: { id: "cus_1" }, refunded: true })).toEqual({ kind: "reversed", chargeId: "ch_1", customerId: "cus_1", why: "refunded" });
    expect(kind({ id: "ch_1", customer: "cus_1", amount: 1200, amount_refunded: 1199, refunded: false })).toEqual({ kind: "other" });
    expect(kind({ id: "ch_1", customer: "cus_1", amount: 0, amount_refunded: 0 })).toEqual({ kind: "other" });
    expect(kind({ id: "dp_1", charge: "ch_9" }, "charge.dispute.created")).toEqual({ kind: "reversed", chargeId: "ch_9", customerId: null, why: "disputed" });
    expect(kind({ id: "dp_1", charge: { id: "ch_9" } }, "charge.dispute.created")).toEqual({ kind: "reversed", chargeId: "ch_9", customerId: null, why: "disputed" });
    expect(kind({ id: "dp_1" }, "charge.dispute.created")).toEqual({ kind: "other" });
  });

  it("are both in the operator's list of events, and documented as ending Pro", async () => {
    const docs = (await import("../../docs/accounts.md?raw")).default;
    const step = docs.slice(docs.indexOf("5. **The webhook endpoint**"), docs.indexOf("6. **The two secrets**"));
    for (const type of ["checkout.session.completed", "invoice.paid", "customer.subscription.updated", "customer.subscription.deleted",
      "charge.refunded", "charge.dispute.created"]) expect(step, type).toContain(`\`${type}\``);
    expect(docs).toContain("| `charge.refunded` |");
    expect(docs).toContain("| `charge.dispute.created` |");
    expect(docs).not.toContain("A refund or a dispute is not\n  read from Stripe");
  });
});

// =========================================================================================
// Checkout, the portal and deletion
// =========================================================================================

describe("checkout for a subscriber, and the delete page", () => {
  it("sends a user whose subscription can still bill to the portal, never to a second checkout", async () => {
    const s = await subscriber("second");
    for (const interval of ["monthly", "yearly"]) {
      sent = [];
      const token = await csrf(s.cookie, "/account/billing", { env: payEnv() });
      const res = await post("/account/billing/checkout", { csrf: token, interval }, { cookie: s.cookie, env: payEnv() });
      expect(res.status, interval).toBe(303);
      expect(res.headers.get("location"), interval).toBe("https://billing.stripe.com/p/session/h");
      expect(sent.map((x) => `${x.method} ${x.path}`), interval).toEqual(["POST /v1/billing_portal/sessions"]);
    }
    // Ended: checkout again.
    expect((await deliver(subscriptionEvent("deleted", s.sub, s.cus, "canceled", s.periodEnd, s.user))).status).toBe(200);
    sent = [];
    const token = await csrf(s.cookie, "/account/billing", { env: payEnv() });
    const res = await post("/account/billing/checkout", { csrf: token, interval: "monthly" }, { cookie: s.cookie, env: payEnv() });
    expect(res.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_h");
    expect(sent.map((x) => `${x.method} ${x.path}`)).toEqual(["POST /v1/checkout/sessions"]);
  });

  it("the delete page says a subscription is cancelled first, in both languages", async () => {
    const cookie = await signIn(newEmail("delete-page"), { env: payEnv() });
    const en = await (await get("/account/delete", { cookie, env: payEnv() })).text();
    expect(en).toContain("A Pro subscription, if there is one, is cancelled first, at once: it is not charged again, and the period already paid is not refunded.");
    // The site sets French apostrophes curly, and the space before a colon unbreakable, on the way out.
    const fr = nbsp(await (await get("/account/delete?lang=fr", { cookie, env: payEnv() })).text()).replace(/&#39;|’/g, "'");
    expect(fr).toContain("Un abonnement Pro, s'il y en a un, est d'abord annulé, immédiatement : il n'est plus facturé, et la période déjà payée n'est pas remboursée.");
    for (const page of [en, fr]) expect(page).not.toContain(String.fromCharCode(0x2014));
  });
});

// =========================================================================================
// The stop link
// =========================================================================================

const hex32 = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

// A Pro user with one daily search and its stop secret, as the job leaves them.
async function stoppable(label: string) {
  const email = newEmail(label);
  const cookie = await signIn(email);
  const user = await userId(email);
  const search = hex32();
  const secret = hex32();
  await ACCOUNTS.batch([
    ACCOUNTS.prepare(
      "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, last_delivered_at, deliver) " +
      "VALUES (?, ?, 'tenders', '/tenders?segment=72', 'Stop test list', 'en', ?, '2026-11-01T00:00:00.000Z', 'daily')",
    ).bind(search, user, new Date().toISOString()),
    ACCOUNTS.prepare("INSERT INTO delivery_tokens (search_id, secret, created_at) VALUES (?, ?, ?)").bind(search, secret, new Date().toISOString()),
  ]);
  return { email, cookie, user, search, secret };
}

const deliverOf = async (search: string) =>
  (await ACCOUNTS.prepare("SELECT deliver FROM saved_searches WHERE id = ?").bind(search).first<{ deliver: string }>())?.deliver ?? null;

describe("the stop link", () => {
  it("is on the account router, so the switch test over the router covers it, with every billing route", () => {
    const routes = account.routes.map((r) => `${r.method} ${r.path}`);
    for (const r of ["GET /stop", "POST /stop", "GET /billing", "POST /billing/checkout", "POST /billing/portal", "POST /billing/webhook"]) {
      expect(routes, r).toContain(r);
    }
  });

  it("changes nothing on GET, and every answer is no-store and noindex", async () => {
    const s = await stoppable("stop-get");
    for (const method of ["GET", "HEAD"]) {
      const res = await app.request(`/account/stop?s=${s.search}&t=${s.secret}`, { method, headers: { "cf-connecting-ip": nextIp() } }, onEnv());
      expect(res.status, method).toBe(200);
      expect(res.headers.get("cache-control"), method).toBe("no-store");
      expect(res.headers.get("x-robots-tag"), method).toBe("noindex, nofollow");
    }
    expect(await deliverOf(s.search)).toBe("daily");
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM audit WHERE user_id = ? AND event = 'delivery_stopped'").bind(s.user).first<{ n: number }>())?.n).toBe(0);
  });

  it("answers a wrong secret exactly as a search that does not exist, a malformed link, a deleted search or a deleted account", async () => {
    const s = await stoppable("stop-alike");
    const gone = await stoppable("stop-gone-search");
    const token = await csrf(gone.cookie);
    await post(`/account/searches/${gone.search}/delete`, { csrf: token }, { cookie: gone.cookie });
    const left = await stoppable("stop-gone-account");
    await post("/account/delete", { csrf: await csrf(left.cookie), confirm: "yes" }, { cookie: left.cookie });
    const links = [
      `s=${s.search}&t=${hex32()}`, `s=${hex32()}&t=${s.secret}`, `s=${hex32()}&t=${hex32()}`, `s=${s.search}&t=${s.secret.toUpperCase()}`,
      `s=${s.search}&t=${s.secret}0`, `s=${s.search}`, `t=${s.secret}`, "", `s=${gone.search}&t=${gone.secret}`, `s=${left.search}&t=${left.secret}`,
    ];
    const answers: string[] = [];
    for (const q of links) {
      for (const method of ["GET", "POST"]) {
        const init: RequestInit = { method, headers: { "cf-connecting-ip": nextIp() } };
        if (method === "POST") {
          init.headers = { ...(init.headers as Record<string, string>), "content-type": "application/x-www-form-urlencoded" };
          init.body = "List-Unsubscribe=One-Click";
        }
        const res = await app.request(`/account/stop${q ? `?${q}` : ""}`, init, onEnv());
        answers.push(JSON.stringify([res.status, res.headers.get("cache-control"), res.headers.get("x-robots-tag"), await res.text()]));
      }
    }
    expect(new Set(answers).size).toBe(1);
    expect(JSON.parse(answers[0])[0]).toBe(404);
    expect(await deliverOf(s.search)).toBe("daily");
    // The tokens went with the search and with the account.
    for (const id of [gone.search, left.search]) {
      expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM delivery_tokens WHERE search_id = ?").bind(id).first<{ n: number }>())?.n).toBe(0);
    }
  });

  it("takes the secret as the only proof: a one-click post from anywhere stops that search, and no other", async () => {
    const a = await stoppable("stop-a");
    const b = await stoppable("stop-b");
    // B's search with A's secret: nothing.
    const cross = await app.request(`/account/stop?s=${b.search}&t=${a.secret}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://mail.example", "cf-connecting-ip": nextIp() },
      body: "List-Unsubscribe=One-Click",
    }, onEnv());
    expect(cross.status).toBe(404);
    // The body's values win over the address's, and must still pair.
    const mixed = await app.request(`/account/stop?s=${a.search}&t=${a.secret}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp() },
      body: new URLSearchParams({ s: b.search, t: a.secret }).toString(),
    }, onEnv());
    expect(mixed.status).toBe(404);
    expect([await deliverOf(a.search), await deliverOf(b.search)]).toEqual(["daily", "daily"]);
    const ok = await app.request(`/account/stop?s=${a.search}&t=${a.secret}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://mail.example", "cf-connecting-ip": nextIp() },
      body: "List-Unsubscribe=One-Click",
    }, onEnv());
    expect(ok.status).toBe(200);
    expect([await deliverOf(a.search), await deliverOf(b.search)]).toEqual(["off", "daily"]);
  });

  it("keeps the secret off every log line and every page but its own", async () => {
    const s = await stoppable("stop-quiet");
    const out = await consoleOf(async () => {
      await get(`/account/stop?s=${s.search}&t=${s.secret}`);
      await post(`/account/stop?s=${s.search}&t=${s.secret}`, {}, { origin: null });
      await get(`/account/stop?s=${s.search}&t=${s.secret}`, { env: onEnv({ ACCOUNTS: broken }) });
    });
    expect(out).not.toContain(s.secret);
    for (const path of ["/account", "/account/searches", "/account/billing", "/tenders"]) {
      expect(await (await get(path, { cookie: s.cookie })).text(), path).not.toContain(s.secret);
    }
  });

  it("has a rate-limit bucket of its own while the switch is on, on both methods, and counts as a page while it is off", async () => {
    expect(bucketFor("GET", "/account/stop")).toBe("stop");
    expect(bucketFor("POST", "/account/stop")).toBe("stop");
    expect(bucketFor("GET", "/account/stopx")).toBe("page");
    expect(wranglerConfig).toContain('{ "name": "STOP_LIMIT", "namespace_id": "2007", "simple": { "limit": 20, "period": 60 } }');
    const keys: string[] = [];
    const keeper = (ok: boolean) => ({ limit: async ({ key }: { key: string }) => (keys.push(key), { success: ok }) }) as unknown as RateLimit;
    const probe = new Hono<AppEnv>();
    probe.use("*", async (c, next) => { c.set("lang", "en"); await next(); });
    probe.use("*", throttle);
    probe.all("/account/stop", (c) => c.text("through"));
    const ip = "203.0.113.77";
    const call = (e: object, method = "GET") => probe.request("/account/stop", { method, headers: { "cf-connecting-ip": ip } }, e);
    await call({ ...onEnv(), PAGE_LIMIT: keeper(true), STOP_LIMIT: keeper(true) });
    await call({ ...onEnv(), PAGE_LIMIT: keeper(true), STOP_LIMIT: keeper(true) }, "POST");
    await call({ ...onEnv(), ACCOUNTS_ENABLED: "false", PAGE_LIMIT: keeper(true), STOP_LIMIT: keeper(true) });
    expect(keys).toEqual([`stop:${ip}`, `stop:${ip}`, `page:${ip}`]);
    const refused = await call({ ...onEnv(), STOP_LIMIT: keeper(false) }, "POST");
    expect([refused.status, refused.headers.get("cache-control")]).toEqual([429, "no-store"]);
  });
});

// =========================================================================================
// The delivery job
// =========================================================================================

const SITE = "https://awardwatch.ca";
const RUN_DAY = "2026-11-15";
const RUN_NOW = `${RUN_DAY}T16:00:00Z`;
const LAST = "2026-11-01T00:00:00.000Z";

function tender(reference: string): TenderRow {
  return {
    reference, amendment: 0, title_en: `Notice ${reference}`, title_fr: `Avis ${reference}`, buyer_id: "dfo-mpo",
    buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada", published: RUN_DAY, closing: "2026-12-20T14:00:00",
    category: ["SRV"], notice_type_en: "Request for Proposal", notice_type_fr: "Demande de propositions", method_en: null, method_fr: null,
    segments: ["72"], provinces: ["BC"], first_seen: RUN_DAY, status: "open",
  };
}

function contract(reference: string, end: string): ExpiringRow {
  return {
    kind: "award", reference, title_en: `Contract ${reference}`, title_fr: `Contrat ${reference}`, organization_id: "org-b000000001",
    organization: "Marathon Targets Inc.", buyer_id: "dnd-mdn", buyer_en: "National Defence", buyer_fr: "Défense nationale",
    start: "2025-01-01", end, days_left: 0, value: 188345, currency: "CAD", competitive: 1, method_en: null, method_fr: null,
    instrument_en: "Contract", instrument_fr: "Contrat", n_amendments: 0, value_growth: 0, tender_reference: null,
    segments: ["46"], provinces: ["ON"],
  };
}

// The published files of the run's week: one new notice on the run's day,
// one contract entering the 3-month window.
function runFiles(without: string[] = []): Record<string, unknown> {
  const files: Record<string, unknown> = { "stats.json": { ...stats, data_as_of: RUN_DAY } };
  for (let i = 0; i <= 8; i++) files[`tenders/new/${addDays(RUN_DAY, -i)}.json`] = i === 0 ? [tender("cb-900-90000777")] : [];
  files["expiring/3m/index.json"] = { window: "3m", pages: 1, rows: 1, total: 1 };
  files["expiring/3m/1.json"] = [contract("cb-500-50000777", addDays(RUN_DAY, WINDOW_DAYS["3m"]))];
  for (const p of without) files[p] = undefined;
  return files;
}

type Handed = { to: string; subject: string; text?: string; html?: string; headers?: Record<string, string> };
function fakeMail() {
  const handed: Handed[] = [];
  const binding = { async send(m: Handed) { handed.push(m); return { messageId: "<h@awardwatch.ca>" }; } } as unknown as SendEmail;
  return { handed, binding };
}

// The job's candidate statement held to these users; every other statement as written.
function scoped(users: string[]): Recorder {
  const list = users.map((u) => `'${u.replace(/[^0-9a-f]/g, "")}'`).join(", ");
  return recording(ACCOUNTS, (q) => (q.includes("LEFT JOIN delivery_tokens k ON k.search_id = s.id")
    ? q.replace("WHERE u.status = 'active'", `WHERE u.status = 'active' AND s.user_id IN (${list})`)
    : q));
}

function runEnv(mail: SendEmail, users: string[], o: { files?: Record<string, unknown>; extra?: Record<string, unknown> } = {}) {
  return payEnv({
    ACCOUNTS: scoped(users).db, ASSETS: makeFakeAssets({}, o.files ?? runFiles()), MAIL: mail, MAIL_FROM: "alerts@awardwatch.ca",
    MAIL_SENDER: undefined, NOW: RUN_NOW, ...o.extra,
  });
}

async function savedSearch(user: string, params: string, o: { deliver?: string; lang?: "en" | "fr" } = {}): Promise<string> {
  const id = hex32();
  await ACCOUNTS.prepare(
    "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, last_delivered_at, deliver) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, user, params.startsWith("/expiring") ? "expiring" : "tenders", params, `Hardening ${params}`, o.lang ?? "en",
    `2001-01-01T00:00:00.${String(n++ % 1000).padStart(3, "0")}Z`, LAST, o.deliver ?? "daily").run();
  return id;
}

async function plainUser(label: string, o: { status?: string; cachedPlan?: string } = {}): Promise<string> {
  const id = hex32();
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', ?, ?)")
    .bind(id, newEmail(label), o.status ?? "active", o.cachedPlan ?? "free").run();
  return id;
}

const run = (e: object) => runDeliveries(e as never);

describe("the delivery job", () => {
  it("decides each account with the entitlements at send time: Stripe Pro is sent; a cached plan, Free, a refunded plan or a deleted account is not", async () => {
    const mail = fakeMail();
    const paid = await subscriber("job-paid", nowS() + 60 * DAY_S);
    const paidSearch = await savedSearch(paid.user, "/tenders?segment=72");
    const cached = await plainUser("job-cached", { cachedPlan: "pro" });
    await savedSearch(cached, "/tenders?segment=72");
    const free = await plainUser("job-free");
    await savedSearch(free, "/tenders?segment=72");
    const refunded = await subscriber("job-refunded", nowS() + 60 * DAY_S);
    await savedSearch(refunded.user, "/tenders?segment=72");
    expect((await deliver(chargeRefunded(`ch_j${refunded.sub}`, refunded.cus, 1900, 1900))).status).toBe(200);
    const deleted = await plainUser("job-deleted", { status: "deleted", cachedPlan: "pro" });
    await savedSearch(deleted, "/tenders?segment=72");
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    const report = await run(runEnv(mail.binding, [paid.user, cached, free, refunded.user, deleted]));
    quiet.mockRestore();
    expect(report).toMatchObject({ outcome: "done", dataDate: RUN_DAY, sent: 1, failed: 0, skipped: 3 });
    expect(mail.handed.map((m) => m.to)).toEqual([paid.email]);
    expect((await ACCOUNTS.prepare("SELECT status FROM deliveries WHERE saved_search_id = ?").bind(paidSearch).first<{ status: string }>())?.status).toBe("sent");
  });

  it("reads the published files only: the search database is never touched and no same-day notice reaches a message", async () => {
    const mail = fakeMail();
    const s = await subscriber("job-files", nowS() + 60 * DAY_S);
    await savedSearch(s.user, "/tenders?segment=72");
    await savedSearch(s.user, "/expiring/3m", { deliver: "weekly" });
    const search = trap<D1Database>("the search database");
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    const report = await run(runEnv(mail.binding, [s.user], { extra: { SEARCH: search.binding } }));
    quiet.mockRestore();
    expect(report.sent).toBe(2);
    expect(search.used).toEqual([]);
    for (const m of mail.handed) for (const part of [m.subject, m.text ?? "", m.html ?? ""]) expect(part).not.toContain(PAID.title);
    const sources = import.meta.glob("../src/account/{deliveries,digests}.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.keys(sources)).toHaveLength(2);
    for (const [file, text] of Object.entries(sources)) {
      expect(text, file).not.toMatch(/intraday|env\.SEARCH|\bSEARCH\b/);
    }
  });

  it("sends one message per search per data date, through retried runs and a run cut short by a fault", async () => {
    const mail = fakeMail();
    const s = await subscriber("job-retry", nowS() + 60 * DAY_S);
    const tenders = await savedSearch(s.user, "/tenders?segment=72");
    const radar = await savedSearch(s.user, "/expiring/3m", { deliver: "weekly" });
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // The radar's files do not read: the tender digest goes, then the run ends.
      const cut = await run(runEnv(mail.binding, [s.user], { files: runFiles(["expiring/3m/index.json"]) }));
      expect([cut.outcome, cut.sent]).toEqual(["fault", 1]);
      for (let i = 0; i < 3; i++) await run(runEnv(mail.binding, [s.user]));
    } finally {
      quiet.mockRestore();
    }
    expect(mail.handed.map((m) => m.subject.split(":")[0]).sort()).toEqual(["1 contract entering the 3-month window", "1 new tender notice"]);
    for (const id of [tenders, radar]) {
      expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE saved_search_id = ? AND status = 'sent'").bind(id).first<{ n: number }>())?.n).toBe(1);
    }
  });

  it("puts the List-Unsubscribe pair on every digest, both kinds and both languages, naming a stop link that works", async () => {
    const mail = fakeMail();
    const s = await subscriber("job-headers", nowS() + 60 * DAY_S);
    const ids = [
      await savedSearch(s.user, "/tenders?segment=72"), await savedSearch(s.user, "/expiring/3m", { deliver: "weekly" }),
      await savedSearch(s.user, "/tenders?segment=72&province=BC", { lang: "fr" }), await savedSearch(s.user, "/expiring/3m?buyer=dnd-mdn", { lang: "fr", deliver: "weekly" }),
    ];
    const quiet = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(runEnv(mail.binding, [s.user]));
    quiet.mockRestore();
    expect(mail.handed).toHaveLength(4);
    for (const m of mail.handed) {
      const list = m.headers?.["List-Unsubscribe"] ?? "";
      const stop = /<(https:\/\/awardwatch\.ca\/account\/stop\?s=([0-9a-f]{32})&t=([0-9a-f]{32})(?:&lang=fr)?)>$/.exec(list);
      expect(list, m.subject).toMatch(/^<mailto:contact@awardwatch\.ca>, </);
      expect(stop, m.subject).not.toBeNull();
      expect(m.headers?.["List-Unsubscribe-Post"], m.subject).toBe("List-Unsubscribe=One-Click");
      expect(ids).toContain(stop![2]);
      const stored = await ACCOUNTS.prepare("SELECT secret FROM delivery_tokens WHERE search_id = ?").bind(stop![2]).first<{ secret: string }>();
      expect(stored?.secret).toBe(stop![3]);
      // The body carries the same link.
      expect(m.text ?? "", m.subject).toContain(`${SITE}/account/stop?s=${stop![2]}&amp;t=`.replace("&amp;", "&"));
    }
    // A mail client's one-click post to a header's link turns that search off.
    const first = /<(https:[^>]+)>$/.exec(mail.handed[0].headers!["List-Unsubscribe"])![1].replace(SITE, "");
    const res = await app.request(first, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp() }, body: "List-Unsubscribe=One-Click",
    }, onEnv());
    expect(res.status).toBe(200);
  });
});

// =========================================================================================
// The paid view, keys and caching with Stripe's rows
// =========================================================================================

type Rendered = { status: number; cache: string | null; etag: string | null; body: string; intraday: number };

async function render(path: string, cookie?: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Rendered> {
  const search = recording(SEARCH);
  const res = await get(path, { cookie, env: payEnv({ SEARCH: search.db, ...extra }), headers });
  return {
    status: res.status, cache: res.headers.get("cache-control"), etag: res.headers.get("etag"), body: await res.text(),
    intraday: search.sql.filter((q) => q === INTRADAY_SQL).length,
  };
}

const normal = (body: string) => body.replace(RAIL_ACCOUNT, "<li>[account]</li>").replace(PLAN_MARK, "");

const keyProbe = new Hono<AppEnv>();
keyProbe.get("/probe", requireApiKey(), (c) => c.json({ holder: apiKeyOf(c) ?? null }));
const callKey = (key: string, e: object = payEnv()) => keyProbe.request("/probe", { headers: { authorization: `Bearer ${key}` } }, e);

async function keyFor(cookie: string): Promise<string> {
  const html = await (await post("/account/keys", { csrf: await csrf(cookie, "/account", { env: payEnv() }), name: "stripe" }, { cookie, env: payEnv() })).text();
  return /(aw_[0-9a-f]{8}_[0-9a-f]{64})/.exec(html)![1];
}

describe("the paid view, keys and caching, with the rows the webhook writes", () => {
  it("draws the band and passes the key for a Stripe subscriber, private and never stored, with no 304 across plans", async () => {
    const s = await subscriber("stripe-band");
    const paid = await render("/tenders", s.cookie);
    expect(BAND.exec(paid.body)?.[0] ?? "").toContain(PAID.title);
    expect(paid.cache).toBe("private, no-store");
    expect(paid.intraday).toBe(1);
    const anonymous = await render("/tenders");
    const cross = await render("/tenders", undefined, {}, { "if-none-match": paid.etag! });
    expect([cross.status, cross.body]).toEqual([200, anonymous.body]);
    const key = await keyFor(s.cookie);
    const res = await callKey(key);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "private, no-store"]);
  });

  it("ends the band and the key on each ending notice: deletion, unpaid, a full refund, a dispute", async () => {
    const endings: [string, (s: Awaited<ReturnType<typeof subscriber>>) => object][] = [
      ["deleted", (s) => subscriptionEvent("deleted", s.sub, s.cus, "canceled", s.periodEnd, s.user)],
      ["unpaid", (s) => subscriptionEvent("updated", s.sub, s.cus, "unpaid", s.periodEnd, s.user)],
      ["refunded", (s) => chargeRefunded(`ch_e${s.sub}`, s.cus, 1900, 1900)],
      ["disputed", (s) => {
        charges.set(`ch_e${s.sub}`, { id: `ch_e${s.sub}`, object: "charge", customer: s.cus });
        return disputeCreated(`ch_e${s.sub}`);
      }],
    ];
    for (const [what, notice] of endings) {
      const s = await subscriber(`stripe-${what}`);
      const key = await keyFor(s.cookie);
      expect(BAND.test((await render("/tenders", s.cookie)).body), what).toBe(true);
      expect((await callKey(key)).status, what).toBe(200);
      expect((await deliver(notice(s))).status, what).toBe(200);
      for (const path of ["/tenders", "/tenders/new"]) {
        const after = await render(path, s.cookie);
        expect(BAND.test(after.body), `${what} ${path}`).toBe(false);
        expect(after.intraday, `${what} ${path}`).toBe(0);
        expect(normal(after.body), `${what} ${path}`).toBe(normal((await render(path)).body));
      }
      expect((await callKey(key)).status, what).toBe(403);
      // The ending read once is not undone by an outage after it.
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(BAND.test((await render("/tenders", s.cookie, { ACCOUNTS: broken })).body), what).toBe(false);
      expect((await callKey(key, payEnv({ ACCOUNTS: broken }))).status, what).toBe(403);
      quiet.mockRestore();
    }
  });

  it("keeps Pro through past_due until the grace ends, and grants nothing for an unpaid checkout", async () => {
    const s = await subscriber("stripe-past-due");
    expect((await deliver(subscriptionEvent("updated", s.sub, s.cus, "past_due", s.periodEnd, s.user))).status).toBe(200);
    expect(BAND.test((await render("/tenders", s.cookie)).body)).toBe(true);
    const email = newEmail("stripe-unpaid-checkout");
    const cookie = await signIn(email, { env: payEnv() });
    const user = await userId(email);
    const t = tag();
    subs.set(`sub_u${t}`, subscriptionObject(`sub_u${t}`, `cus_u${t}`, "incomplete", nowS() + 30 * DAY_S, user));
    expect((await deliver(checkoutCompleted(user, `sub_u${t}`, `cus_u${t}`, { payment_status: "unpaid" }))).status).toBe(200);
    const page = await render("/tenders", cookie);
    expect(BAND.test(page.body)).toBe(false);
    expect(page.intraday).toBe(0);
  });

  it("holds a Stripe plan to its own end through an outage, for the session and for the key", async () => {
    forgetSessions();
    forgetKeys();
    // A period that ended three days ago less half an hour: Pro runs to the
    // end of its grace, half an hour from now, inside the hour a remembered
    // session or key is trusted through an outage.
    const s = await subscriber("stripe-outage", nowS() - 3 * DAY_S + 1800);
    const key = await keyFor(s.cookie);
    expect(BAND.test((await render("/tenders", s.cookie)).body)).toBe(true);
    expect((await callKey(key)).status).toBe(200);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(BAND.test((await render("/tenders", s.cookie, { ACCOUNTS: broken })).body)).toBe(true);
      expect((await callKey(key, payEnv({ ACCOUNTS: broken }))).status).toBe(200);
      // Past the period end and its grace, known here without the database.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime((s.periodEnd + 3 * DAY_S + 60) * 1000);
      expect(BAND.test((await render("/tenders", s.cookie, { ACCOUNTS: broken })).body)).toBe(false);
      expect((await callKey(key, payEnv({ ACCOUNTS: broken }))).status).toBe(403);
    } finally {
      vi.useRealTimers();
      quiet.mockRestore();
    }
  });
});
