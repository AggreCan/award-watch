// The operator console (src/account/admin.tsx, admin_ops.ts, admin_stripe.ts,
// admin_access.ts) against the local accounts database with the switch on.
// Stripe and Cloudflare Access's key set are a fake fetch that records every
// request; the Access tokens are signed here with a key pair made for the
// test, by code written apart from the code under test. Each test signs in
// an operator of its own (a fresh address listed in OPERATOR_EMAILS), since
// an address may ask for five codes an hour.
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_CSV_HEAD, REASON_MAX, REFERENCE_MAX, addressNotice } from "../src/account/admin";
import { CERTS_TTL_MS, accessEmail, forgetAccessCerts, teamHost } from "../src/account/admin_access";
import { ACCOUNT_CSV_ROWS, ACCOUNT_MAX_PAGE, ACCOUNT_PAGE_SIZE, isBlocked, pausedSearches } from "../src/account/admin_ops";
import { refundKey } from "../src/account/admin_stripe";
import { requireApiKey } from "../src/account/api_keys";
import { runDeliveries } from "../src/account/deliveries";
import { planOfRequest } from "../src/account/session";
import { STRIPE_VERSION } from "../src/account/stripe";
import type { AppEnv } from "../src/env";
import { app } from "../src/index";
import robotsTxt from "../public/robots.txt?raw";
import {
  ACCOUNTS, csrf, decode, get, grantPro, lastMail, nbsp, newEmail, offEnv, onEnv, post, requestCode, sessionCookie, signIn, useAccountsDb,
  userId,
} from "./accounts-helpers";
import { makeFakeAssets } from "./assets";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const TEAM = "awtest.cloudflareaccess.com";
const AUD = "a".repeat(64);
const KID = "test-key-1";
const STRIPE = { STRIPE_SECRET_KEY: "sk_test_admin0000", STRIPE_WEBHOOK_SECRET: "whsec_admin0000" };

// -- the people ---------------------------------------------------------------------------

type Operator = { email: string; id: string; cookie: string; csrf: string; env: Record<string, unknown> };

// A fresh operator: listed (upper-cased, beside another address, to prove the
// list is read lower-cased and split), signed in, with the CSRF value its
// forms carry.
async function operator(extra: Record<string, unknown> = {}): Promise<Operator> {
  const email = newEmail("op");
  const env = onEnv({ OPERATOR_EMAILS: ` someone-else@example.com , ${email.toUpperCase()} `, ...extra });
  const cookie = await signIn(email, { env });
  return { email, id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env }), env };
}

async function reader(env: object, tag = "reader", headers: Record<string, string> = {}) {
  const email = newEmail(tag);
  const cookie = await signIn(email, { env, headers });
  return { email, cookie, id: await userId(email) };
}

const adminGet = (op: Operator, path: string, headers: Record<string, string> = {}) => get(path, { cookie: op.cookie, env: op.env, headers });
const adminPost = (op: Operator, path: string, fields: Record<string, string> = {}, o: { origin?: string | null; csrf?: string } = {}) =>
  post(path, { csrf: o.csrf ?? op.csrf, ...fields }, { cookie: op.cookie, env: op.env, origin: o.origin });

const text = async (res: Response) => nbsp(decode(await res.text()));

const auditOf = async (user: string, event: string) =>
  ((await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = ? ORDER BY id").bind(user, event)
    .all<{ detail: string | null }>()).results ?? []).map((r) => r.detail);

const userRow = (id: string) =>
  ACCOUNTS.prepare("SELECT email, status, plan, plan_until FROM users WHERE id = ?").bind(id)
    .first<{ email: string; status: string; plan: string; plan_until: string | null }>();

const liveSessions = async (id: string) =>
  (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL").bind(id).first<{ n: number }>())?.n ?? 0;

let seq = 0;
const hexId = () => (0xa0000000 + ++seq).toString(16).padStart(32, "0");

async function addSearch(user: string, deliver = "daily", params = "/tenders?segment=72"): Promise<string> {
  const id = hexId();
  await ACCOUNTS.prepare(
    "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, ?)",
  ).bind(id, user, params, `Tender notices ${id.slice(-4)}`, new Date().toISOString(), deliver).run();
  return id;
}

// -- a fake Stripe and a fake Access key set ------------------------------------------------

type Sent = { method: string; url: URL; headers: Record<string, string>; form: URLSearchParams };

let sent: Sent[] = [];
let failing = new Set<string>();
let subs = new Map<string, Record<string, unknown>>();
let invoices: Record<string, unknown>[] = [];
let charges = new Map<string, Record<string, unknown>>();
let certFetches = 0;
let certKeys: JsonWebKey[] = [];

const stripeSent = () => sent.filter((s) => s.url.hostname === "api.stripe.com");

function stripeAnswer(method: string, url: URL, form: URLSearchParams): { status?: number; body: unknown } {
  const key = `${method} ${url.pathname.replace(/\/(sub|ch)_[A-Za-z0-9_]+$/, "/:id")}`;
  if (failing.has(key)) return { status: 500, body: { error: { message: "down" } } };
  const id = url.pathname.split("/").pop() ?? "";
  if (key === "GET /v1/subscriptions/:id") return subs.has(id) ? { body: subs.get(id) } : { status: 404, body: {} };
  if (key === "POST /v1/subscriptions/:id") {
    const s = subs.get(id);
    if (!s) return { status: 404, body: {} };
    if (form.get("cancel_at_period_end") === "true") s.cancel_at_period_end = true;
    return { body: s };
  }
  if (key === "DELETE /v1/subscriptions/:id") {
    const s = subs.get(id);
    if (!s) return { status: 404, body: {} };
    s.status = "canceled";
    return { body: s };
  }
  if (key === "GET /v1/invoices") return { body: { object: "list", data: invoices } };
  if (key === "GET /v1/charges") {
    const pi = url.searchParams.get("payment_intent");
    return { body: { object: "list", data: [...charges.values()].filter((ch) => ch.payment_intent === pi) } };
  }
  if (key === "GET /v1/charges/:id") return charges.has(id) ? { body: charges.get(id) } : { status: 404, body: {} };
  if (key === "POST /v1/refunds") {
    const ch = charges.get(form.get("charge") ?? "");
    if (!ch) return { status: 400, body: {} };
    ch.amount_refunded = ch.amount;
    ch.refunded = true;
    return { body: { id: "re_test_1", object: "refund", status: "succeeded", charge: ch.id } };
  }
  return { status: 400, body: { error: { message: `unexpected ${key}` } } };
}

beforeEach(() => {
  sent = [];
  failing = new Set();
  subs = new Map();
  invoices = [];
  charges = new Map();
  certFetches = 0;
  forgetAccessCerts();
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? "GET";
    if (url.hostname === TEAM && url.pathname === "/cdn-cgi/access/certs") {
      certFetches++;
      return Response.json({ keys: certKeys, public_cert: {}, public_certs: [] });
    }
    if (url.hostname !== "api.stripe.com") return real(input, init);
    const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    sent.push({ method, url, headers: { ...(init?.headers as Record<string, string>) }, form });
    const reply = stripeAnswer(method, url, form);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// -- Access tokens, made here --------------------------------------------------------------

let good: CryptoKeyPair;
let stranger: CryptoKeyPair;

const RSA = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };

beforeAll(async () => {
  good = (await crypto.subtle.generateKey(RSA, true, ["sign", "verify"])) as CryptoKeyPair;
  stranger = (await crypto.subtle.generateKey(RSA, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", good.publicKey)) as JsonWebKey;
  certKeys = [{ kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", kid: KID, use: "sig" } as JsonWebKey];
});

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const part = (o: object) => b64u(new TextEncoder().encode(JSON.stringify(o)));
const nowS = () => Math.floor(Date.now() / 1000);

async function token(claims: Record<string, unknown>, o: { key?: CryptoKey; kid?: string; alg?: string } = {}): Promise<string> {
  const head = part({ alg: o.alg ?? "RS256", kid: o.kid ?? KID, typ: "JWT" });
  const body = part(claims);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", o.key ?? good.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64u(sig)}`;
}

const claimsFor = (email: string, over: Record<string, unknown> = {}) => ({
  aud: [AUD], email, exp: nowS() + 600, iat: nowS(), nbf: nowS(), iss: `https://${TEAM}`, type: "app", sub: "x", ...over,
});

const accessEnv = { ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: TEAM };
const withToken = (jwt: string) => ({ "cf-access-jwt-assertion": jwt });

// =========================================================================================
// Who gets in
// =========================================================================================

const getPaths = (id: string) => [
  "/admin", "/admin?q=example", "/admin/accounts", "/admin/accounts?plan=pro&sort=address&page=2", "/admin/accounts.csv",
  `/admin/users/${id}`, `/admin/users/${id}/block`, `/admin/users/${id}/email`, `/admin/users/${id}/cancel`,
  `/admin/users/${id}/refund`, `/admin/users/${id}/delete`, "/admin/nothing",
];
const postPaths = (id: string) => [
  `/admin/users/${id}/grant`, `/admin/users/${id}/entitlements/${id}/revoke`, `/admin/users/${id}/sign-out`, `/admin/users/${id}/unblock`,
  `/admin/users/${id}/block`, `/admin/users/${id}/email`, `/admin/users/${id}/cancel`, `/admin/users/${id}/refund`, `/admin/users/${id}/delete`,
];

// Every console address answers exactly as an unknown address does for the
// same request: the site's 404 page, byte for byte, without the console's
// own headers.
async function expectSite404(o: { cookie?: string; env: object; headers?: Record<string, string>; csrf?: string }, id: string, why: string) {
  const plain = await get("/no-such-page", { cookie: o.cookie, env: o.env, headers: o.headers });
  const plainBody = await plain.text();
  expect(plain.status).toBe(404);
  for (const path of getPaths(id)) {
    const res = await get(path, { cookie: o.cookie, env: o.env, headers: o.headers });
    expect(res.status, `${why}: GET ${path}`).toBe(404);
    expect(res.headers.get("x-robots-tag"), `${why}: GET ${path}`).toBeNull();
    expect(await res.text(), `${why}: GET ${path}`).toBe(plainBody);
  }
  const plainPost = await (await post("/no-such-page", { csrf: o.csrf ?? "" }, { cookie: o.cookie, env: o.env, headers: o.headers })).text();
  for (const path of postPaths(id)) {
    const res = await post(path, { csrf: o.csrf ?? "", confirm: "yes", reason: "r", reference: "r", at: "now" }, { cookie: o.cookie, env: o.env, headers: o.headers });
    expect(res.status, `${why}: POST ${path}`).toBe(404);
    expect(await res.text(), `${why}: POST ${path}`).toBe(plainPost);
  }
}

describe("who gets in", () => {
  it("nobody while the switch is off, the operator's session and list included", async () => {
    const op = await operator();
    const target = await reader(op.env);
    await expectSite404({ cookie: op.cookie, env: { ...offEnv(), OPERATOR_EMAILS: op.email }, csrf: op.csrf }, target.id, "switch off");
  });

  it("nobody signed out, and no session that is not on the list", async () => {
    const op = await operator();
    const target = await reader(op.env);
    await expectSite404({ env: op.env }, target.id, "signed out");
    await expectSite404({ cookie: target.cookie, env: op.env, csrf: await csrf(target.cookie, "/account", { env: op.env }) }, target.id, "not listed");
    // A cookie that does not stand, and the operator's own session once revoked.
    await expectSite404({ cookie: "__Host-aw_session=" + "0".repeat(32) + "." + "0".repeat(64), env: op.env }, target.id, "unknown cookie");
    await ACCOUNTS.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), op.id).run();
    await expectSite404({ cookie: op.cookie, env: op.env, csrf: op.csrf }, target.id, "revoked operator session");
  });

  it("nobody while OPERATOR_EMAILS is unset or empty", async () => {
    const op = await operator();
    const target = await reader(op.env);
    await expectSite404({ cookie: op.cookie, env: onEnv(), csrf: op.csrf }, target.id, "no list");
    await expectSite404({ cookie: op.cookie, env: onEnv({ OPERATOR_EMAILS: " , " }), csrf: op.csrf }, target.id, "empty list");
  });

  it("the listed session, whatever the case of the list, with every answer no-store and noindex", async () => {
    const op = await operator();
    const target = await reader(op.env);
    for (const path of getPaths(target.id).filter((p) => p !== "/admin/nothing")) {
      const res = await adminGet(op, path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
      expect(res.headers.get("content-security-policy"), path).toContain("default-src 'self'");
      expect(res.headers.get("x-frame-options"), path).toBe("DENY");
      expect(await res.text(), path).toContain(path.includes(".csv") ? `${ACCOUNT_CSV_HEAD.join(",")}\r\n` : '<meta name="robots" content="noindex"/>');
    }
    // An address under /admin with no route is the site's 404, past the guard as before it.
    const none = await adminGet(op, "/admin/nothing");
    expect(none.status).toBe(404);
    expect(await none.text()).toContain("<h1>Page Not Found</h1>");
  });

  it("with ACCESS_AUD set: nobody without a token, or with a forged, foreign, stale or misdirected one", async () => {
    const op = await operator(accessEnv);
    const target = await reader(op.env);
    const base = { cookie: op.cookie, env: op.env, csrf: op.csrf };
    await expectSite404(base, target.id, "no token");
    const bad: [string, string][] = [
      ["signed by another key", await token(claimsFor(op.email), { key: stranger.privateKey })],
      ["another audience", await token(claimsFor(op.email, { aud: ["b".repeat(64)] }))],
      ["another issuer", await token(claimsFor(op.email, { iss: "https://other.cloudflareaccess.com" }))],
      ["expired", await token(claimsFor(op.email, { exp: nowS() - 5 }))],
      ["not yet valid", await token(claimsFor(op.email, { nbf: nowS() + 3600 }))],
      ["an unknown key id", await token(claimsFor(op.email), { kid: "nobody" })],
      ["alg none", (await token(claimsFor(op.email), { alg: "none" })).split(".").slice(0, 2).join(".") + "."],
      ["HS256 header", await token(claimsFor(op.email), { alg: "HS256" })],
      ["no email", await token(claimsFor(op.email, { email: undefined }))],
      ["garbage", "not.a.token"],
    ];
    for (const [why, jwt] of bad) await expectSite404({ ...base, headers: withToken(jwt) }, target.id, why);
  });

  it("with ACCESS_AUD set: nobody whose token names another address than the session, even a listed one", async () => {
    const op = await operator(accessEnv);
    const other = newEmail("op-other");
    const env = { ...op.env, OPERATOR_EMAILS: `${op.email},${other}` };
    const target = await reader(env);
    const base = { cookie: op.cookie, env, csrf: op.csrf };
    await expectSite404({ ...base, headers: withToken(await token(claimsFor(other))) }, target.id, "another listed address");
    await expectSite404({ ...base, headers: withToken(await token(claimsFor(target.email))) }, target.id, "an unlisted address");
    // The token right, the session a reader's.
    const readerCsrf = await csrf(target.cookie, "/account", { env });
    await expectSite404({ cookie: target.cookie, env, csrf: readerCsrf, headers: withToken(await token(claimsFor(op.email))) }, target.id, "reader session");
  });

  it("with ACCESS_AUD set: the listed session with its own valid token, the key set fetched once", async () => {
    const op = await operator(accessEnv);
    const target = await reader(op.env);
    const jwt = await token(claimsFor(op.email.toUpperCase()));
    for (const path of ["/admin", `/admin/users/${target.id}`]) {
      const res = await adminGet(op, path, withToken(jwt));
      expect(res.status, path).toBe(200);
    }
    const res = await post(`/admin/users/${target.id}/sign-out`, { csrf: op.csrf }, { cookie: op.cookie, env: op.env, headers: withToken(jwt) });
    expect(res.status).toBe(303);
    expect(certFetches).toBe(1);
    // The team written bare or as an address works the same; a team unset, or on another host, closes the console.
    for (const team of ["awtest", `https://${TEAM}/`]) {
      expect((await get("/admin", { cookie: op.cookie, env: { ...op.env, ACCESS_TEAM_DOMAIN: team }, headers: withToken(jwt) })).status, team).toBe(200);
    }
    for (const team of [undefined, "", "awtest.example.com", "evil.com/awtest.cloudflareaccess.com"]) {
      expect((await get("/admin", { cookie: op.cookie, env: { ...op.env, ACCESS_TEAM_DOMAIN: team }, headers: withToken(jwt) })).status, String(team)).toBe(404);
    }
  });
});

describe("the Access check", () => {
  it("reads the team's host strictly", () => {
    expect(teamHost("awtest")).toBe(TEAM);
    expect(teamHost(` https://${TEAM.toUpperCase()}/ `)).toBe(TEAM);
    expect(teamHost("awtest.example.com")).toBeNull();
    expect(teamHost("a/b.cloudflareaccess.com")).toBeNull();
    expect(teamHost("")).toBeNull();
    expect(teamHost(undefined)).toBeNull();
  });

  it("keeps the key set an hour, and fetches it again for an unknown key at most once a minute", async () => {
    const env = { ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: TEAM };
    const t0 = new Date();
    const far = { exp: nowS() + 10 * 86_400 };
    const ok = new Headers(withToken(await token(claimsFor("op@example.com", far))));
    const unknown = new Headers(withToken(await token(claimsFor("op@example.com", far), { kid: "rotated" })));
    const at = (ms: number) => new Date(t0.getTime() + ms);
    expect(await accessEmail(env, ok, t0)).toBe("op@example.com");
    expect(await accessEmail(env, ok, at(CERTS_TTL_MS - 1000))).toBe("op@example.com");
    expect(certFetches).toBe(1);
    expect(await accessEmail(env, unknown, at(10_000))).toBeNull();
    expect(certFetches).toBe(1);
    expect(await accessEmail(env, unknown, at(61_000))).toBeNull();
    expect(certFetches).toBe(2);
    expect(await accessEmail(env, ok, at(CERTS_TTL_MS + 62_000))).toBe("op@example.com");
    expect(certFetches).toBe(3);
    expect(CERTS_TTL_MS).toBe(3_600_000);
  });

  it("closes the console when the key set cannot be fetched", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("down", { status: 503 }));
    const env = { ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: TEAM };
    expect(await accessEmail(env, new Headers(withToken(await token(claimsFor("op@example.com"))))))
      .toBeNull();
  });
});

// =========================================================================================
// The overview
// =========================================================================================

const countOf = (html: string, label: string): number => {
  const m = new RegExp(`<dt>${label}</dt>\\s*<dd>([0-9,]+)</dd>`).exec(html);
  if (!m) throw new Error(`no count for ${label}`);
  return Number(m[1].replace(/,/g, ""));
};

const LABELS = {
  active: "Active accounts", deleted: "Deleted accounts", blocked: "Blocked accounts", sessions: "Signed-in browsers",
  manual: "On Pro now, granted by hand", stripe: "On Pro now, paid through Stripe", sent: "Deliveries sent, last 7 days",
  failed: "Deliveries not sent, last 7 days", codes: "Sign-in codes issued today \\(UTC\\)",
};

async function counts(op: Operator): Promise<Record<keyof typeof LABELS, number>> {
  const html = await text(await adminGet(op, "/admin"));
  return Object.fromEntries(Object.entries(LABELS).map(([k, label]) => [k, countOf(html, label)])) as Record<keyof typeof LABELS, number>;
}

async function entitle(user: string, o: { plan?: string; source?: string; ends?: string | null; revoked?: boolean; created?: string } = {}) {
  const at = o.created ?? new Date(Date.now() - 1000).toISOString();
  await ACCOUNTS.prepare(
    "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, 'test', ?, ?)",
  ).bind(hexId(), user, o.plan ?? "pro", o.source ?? "manual", "2026-01-01T00:00:00.000Z", o.ends ?? null, at, o.revoked ? at : null).run();
}

describe("the overview", () => {
  it("counts accounts, sessions, Pro by the deciding row's source, deliveries, codes and blocks", async () => {
    const op = await operator();
    const before = await counts(op);
    const env = op.env;
    const manual = await reader(env, "c-manual");
    const stripe = await reader(env, "c-stripe");
    const lowered = await reader(env, "c-lowered");
    const revoked = await reader(env, "c-revoked");
    const ended = await reader(env, "c-ended");
    await entitle(manual.id);
    await entitle(stripe.id, { source: "stripe", ends: "2099-01-01T00:00:00.000Z" });
    // An older Pro row under a newer Free one decides Free, as planFromRows does.
    await entitle(lowered.id, { created: "2026-02-01T00:00:00.000Z" });
    await entitle(lowered.id, { plan: "free", created: "2026-03-01T00:00:00.000Z" });
    await entitle(revoked.id, { revoked: true });
    await entitle(ended.id, { ends: "2026-02-01T00:00:00.000Z" });
    const search = await addSearch(manual.id);
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    for (const [status, days] of [["sent", 1], ["sent", 6], ["failed", 2], ["empty", 1], ["sent", 8], ["failed", 9]] as const) {
      await ACCOUNTS.prepare("INSERT INTO deliveries (saved_search_id, sent_at, items, status) VALUES (?, ?, 3, ?)").bind(search, at(days), status).run();
    }
    await requestCode(newEmail("c-code"), { env });
    const after = await counts(op);
    expect(after.active - before.active).toBe(5);
    expect(after.sessions - before.sessions).toBe(5);
    expect(after.manual - before.manual).toBe(1);
    expect(after.stripe - before.stripe).toBe(1);
    expect(after.sent - before.sent).toBe(2);
    expect(after.failed - before.failed).toBe(1);
    // Five sign-ins and one code alone.
    expect(after.codes - before.codes).toBe(6);
    // A deletion moves an account from one count to the other; a block is counted.
    await ACCOUNTS.prepare("UPDATE users SET status = 'deleted', email = ? WHERE id = ?").bind(`deleted:${hexId()}`, ended.id).run();
    await adminPost(op, `/admin/users/${revoked.id}/block`, { confirm: "yes", reason: "count test" });
    const last = await counts(op);
    expect(last.active - after.active).toBe(-1);
    expect(last.deleted - after.deleted).toBe(1);
    expect(last.blocked - after.blocked).toBe(1);
  });

  it("lists subscriptions by status and the last 20 audit events, newest first, linked to their accounts", async () => {
    const op = await operator();
    const a = await reader(op.env, "sub-a");
    for (let i = 0; i < 25; i++) {
      await ACCOUNTS.prepare("INSERT INTO audit (user_id, event, at, detail) VALUES (?, ?, ?, 'test')").bind(a.id, `test_event_${i}`, new Date().toISOString()).run();
    }
    await ACCOUNTS.prepare(
      "INSERT INTO payment_customers (user_id, customer_id, subscription_id, status, current_period_end, updated_at) VALUES (?, 'cus_o1', 'sub_o1', 'past_due', NULL, ?)",
    ).bind(a.id, new Date().toISOString()).run();
    const html = await text(await adminGet(op, "/admin"));
    expect(html).toMatch(/<dt>Subscriptions by status<\/dt>\s*<dd>[^<]*past_due [0-9]+/);
    const audit = html.slice(html.indexOf("Latest Audit Events"));
    const rows = audit.slice(0, audit.indexOf("</table>")).split("<tr>").length - 2;
    expect(rows).toBe(20);
    expect(audit).toContain(`href="/admin/users/${a.id}"`);
    const shown = [...audit.slice(0, audit.indexOf("</table>")).matchAll(/test_event_([0-9]+)/g)].map((m) => Number(m[1]));
    expect(shown).toEqual([24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  });

  it("finds an account by its whole address, the address's start or its id; wildcards are plain characters", async () => {
    const op = await operator();
    const a = await reader(op.env, "find-me");
    const hits = async (q: string) => {
      const html = await text(await adminGet(op, `/admin?q=${encodeURIComponent(q)}`));
      return [...html.matchAll(/<a href="\/admin\/users\/([0-9a-f]{32})">/g)].map((m) => m[1]);
    };
    expect(await hits(a.email)).toEqual([a.id]);
    expect(await hits(a.email.toUpperCase())).toEqual([a.id]);
    expect(await hits(a.email.slice(0, a.email.indexOf("@") - 1))).toContain(a.id);
    expect(await hits(a.id)).toEqual([a.id]);
    expect(await hits("%")).toEqual([]);
    expect(await hits("_")).toEqual([]);
    expect(await hits("nobody-at-all@example.com")).toEqual([]);
    expect(await text(await adminGet(op, "/admin?q=nobody-at-all"))).toContain("No account matches.");
    // A plain overview runs no search.
    expect(await text(await adminGet(op, "/admin"))).not.toContain("Accounts Found");
  });

  it("shows bug reports only once their table exists", async () => {
    const op = await operator();
    await ACCOUNTS.prepare("DROP TABLE IF EXISTS bug_reports").run();
    let html = await text(await adminGet(op, "/admin"));
    expect(html).not.toContain("Bug reports");
    expect(html).not.toContain("Bug Reports");
    await ACCOUNTS.prepare("CREATE TABLE IF NOT EXISTS bug_reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, page TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    const r = await reader(op.env, "bug");
    await ACCOUNTS.prepare("INSERT INTO bug_reports (id, user_id, page, text, created_at) VALUES (?, ?, '/tenders?segment=72', ?, ?)")
      .bind(hexId(), r.id, "The <filter> did nothing", new Date().toISOString()).run();
    await ACCOUNTS.prepare("INSERT INTO bug_reports (id, user_id, page, text, created_at) VALUES (?, ?, '/awards', 'Old one', '2026-01-01T00:00:00.000Z')")
      .bind(hexId(), r.id).run();
    const res = await adminGet(op, "/admin");
    html = await res.text();
    expect(countOf(html, "Bug reports, last 7 days")).toBeGreaterThanOrEqual(1);
    expect(countOf(html, "Bug reports, all")).toBeGreaterThanOrEqual(2);
    // The reader's text is escaped, never markup.
    expect(html).toContain("The &lt;filter&gt; did nothing");
    const page = await text(await adminGet(op, `/admin/users/${r.id}`));
    expect(page).toContain("Bug Reports");
    expect(page).toContain("Old one");
  });

  it("speaks French", async () => {
    const op = await operator();
    const html = nbsp(await (await adminGet(op, "/admin?lang=fr")).text());
    expect(html).toContain("Console de l’exploitant");
    expect(html).toContain("Trouver un compte");
    expect(html).not.toContain("Operator Console");
  });
});

// =========================================================================================
// The accounts table
// =========================================================================================

let tagSeq = 0;
// An address start no other test's accounts share, so ?q= holds a test to its own.
const newTag = () => `tbl${++tagSeq}x${Date.now().toString(36)}`;

async function addUser(email: string, created: string, o: { lang?: string; status?: string } = {}): Promise<string> {
  const id = hexId();
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, ?, ?, 'free')")
    .bind(id, email, created, o.lang ?? "en", o.status ?? "active").run();
  return id;
}

const addSession = (user: string, created: string) =>
  ACCOUNTS.prepare("INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at) VALUES (?, ?, 'x', ?, ?, '2099-01-01T00:00:00.000Z')")
    .bind(hexId(), user, created, created).run();

const addKey = (user: string, revoked: string | null = null) =>
  ACCOUNTS.prepare("INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at, revoked_at) VALUES (?, ?, 'k', 'h', 'abcd0123', ?, ?)")
    .bind(hexId(), user, "2026-06-01T00:00:00.000Z", revoked).run();

const addPayment = (user: string, status: string) =>
  ACCOUNTS.prepare("INSERT INTO payment_customers (user_id, customer_id, subscription_id, status, current_period_end, updated_at) VALUES (?, ?, ?, ?, NULL, ?)")
    .bind(user, `cus_${user.slice(-6)}`, `sub_${user.slice(-6)}`, status, new Date().toISOString()).run();

// Five accounts under one tag, signed up a month apart (a oldest), so the
// default order is e, d, c, b, a:
//   a  free, English, nothing else
//   b  Pro by hand to 2099-01-01, French, 2 searches (1 delivering), 1 live key and 1 revoked, subscription active
//   c  blocked since 2026-10-01, 1 search (off), subscription past_due
//   d  deleted, holding a live Pro row (a deleted account reads as free)
//   e  a Stripe Pro row that ended, 3 searches (2 delivering), 2 live keys, subscription canceled
async function seedAccounts(op: Operator) {
  const tag = newTag();
  const mail = (k: string) => `${tag}-${k}@example.com`;
  const a = await addUser(mail("a"), "2026-01-01T00:00:00.000Z");
  const b = await addUser(mail("b"), "2026-02-01T00:00:00.000Z", { lang: "fr" });
  const c = await addUser(mail("c"), "2026-03-01T00:00:00.000Z");
  const d = await addUser(mail("d"), "2026-04-01T00:00:00.000Z", { status: "deleted" });
  const e = await addUser(mail("e"), "2026-05-01T00:00:00.000Z");
  await entitle(b, { ends: "2099-01-01T00:00:00.000Z" });
  await entitle(d);
  await entitle(e, { source: "stripe", ends: "2026-02-01T00:00:00.000Z" });
  await addSearch(b, "daily", "/tenders?segment=72");
  await addSearch(b, "off", "/tenders?segment=43");
  await addSearch(c, "off");
  await addSearch(e, "weekly", "/tenders?segment=72");
  await addSearch(e, "daily", "/tenders?segment=43");
  await addSearch(e, "off", "/tenders?segment=10");
  await addKey(b);
  await addKey(b, "2026-07-01T00:00:00.000Z");
  await addKey(e);
  await addKey(e);
  await addPayment(b, "active");
  await addPayment(c, "past_due");
  await addPayment(e, "canceled");
  await addSession(b, "2026-10-30T09:00:00.000Z");
  await addSession(b, "2026-08-01T09:00:00.000Z");
  await addSession(c, "2026-09-15T09:00:00.000Z");
  await addSession(e, "2026-11-01T09:00:00.000Z");
  await ACCOUNTS.prepare("INSERT INTO account_blocks (user_id, reason, created_at, by_user_id) VALUES (?, 'test', '2026-10-01T12:00:00.000Z', ?)")
    .bind(c, op.id).run();
  return { tag, mail, a, b, c, d, e };
}

// The accounts the table lists, in its order.
const listed = (html: string) => [...html.matchAll(/<a href="\/admin\/users\/([0-9a-f]{32})">/g)].map((m) => m[1]);

// One account's row, as its labels and the text of its cells.
function cells(html: string, id: string): Record<string, string> {
  const at = html.indexOf(`<a href="/admin/users/${id}">`);
  const row = html.slice(html.lastIndexOf("<tr>", at), html.indexOf("</tr>", at));
  return Object.fromEntries([...row.matchAll(/<td data-label="([^"]*)">(.*?)<\/td>/g)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, "")]));
}

describe("the accounts table", () => {
  it("is linked from the overview and lists every account with its columns, newest sign-up first", async () => {
    const op = await operator();
    expect(await text(await adminGet(op, "/admin"))).toContain('href="/admin/accounts"');
    const s = await seedAccounts(op);
    const res = await adminGet(op, `/admin/accounts?q=${s.tag}`);
    expect(res.status).toBe(200);
    const html = await text(res);
    expect(listed(html)).toEqual([s.e, s.d, s.c, s.b, s.a]);
    expect(html).toContain("5 accounts, showing 1 to 5");
    for (const head of ["Address", "Plan", "Status", "Blocked", "Signed up", "Last sign-in", "Saved searches", "Delivery on", "API keys", "Subscription", "Language"]) {
      expect(html, head).toContain(`>${head}<`);
    }
    expect(cells(html, s.b)).toEqual({
      Address: s.mail("b"), Plan: "Pro, until 2099-01-01", Status: "Active", Blocked: "No", "Signed up": "2026-02-01", "Last sign-in": "2026-10-30",
      "Saved searches": "2", "Delivery on": "1", "API keys": "1", Subscription: "active", Language: "French",
    });
    expect(cells(html, s.c)).toMatchObject({ Blocked: "Yes, since 2026-10-01", Subscription: "past_due", "Saved searches": "1", "Delivery on": "0" });
    expect(cells(html, s.d)).toMatchObject({ Plan: "Free", Status: "Deleted", "Last sign-in": "-", Subscription: "-" });
    expect(cells(html, s.e)).toMatchObject({ Plan: "Free", "Saved searches": "3", "Delivery on": "2", "API keys": "2", Subscription: "canceled" });
    expect(cells(html, s.a)).toMatchObject({ Plan: "Free", Blocked: "No", "Saved searches": "0", Language: "English" });
    // The default column says so, and its heading reverses it with the filters kept.
    expect(html).toMatch(/<th aria-sort="descending"><a href="\/admin\/accounts\?q=[a-z0-9]+&dir=asc">Signed up/);
    expect(html).not.toContain(EM_DASH);
  });

  it("narrows by each filter, and by several at once", async () => {
    const op = await operator();
    const s = await seedAccounts(op);
    const ids = async (query: string) => listed(await text(await adminGet(op, `/admin/accounts?q=${s.tag}&${query}`)));
    const cases: [string, string[]][] = [
      ["plan=pro", [s.b]], ["plan=free", [s.e, s.d, s.c, s.a]], ["plan=any", [s.e, s.d, s.c, s.b, s.a]],
      ["status=deleted", [s.d]], ["status=active", [s.e, s.c, s.b, s.a]],
      ["blocked=yes", [s.c]], ["blocked=no", [s.e, s.d, s.b, s.a]],
      ["delivery=on", [s.e, s.b]], ["delivery=off", [s.d, s.c, s.a]],
      ["subscription=active", [s.b]], ["subscription=past_due", [s.c]], ["subscription=canceled", [s.e]], ["subscription=none", [s.d, s.a]],
      ["subscription=trialing", []],
      ["language=fr", [s.b]], ["language=en", [s.e, s.d, s.c, s.a]],
      ["plan=free&language=en&delivery=off", [s.d, s.c, s.a]], ["status=active&blocked=no&subscription=none", [s.a]],
    ];
    for (const [query, want] of cases) expect(await ids(query), query).toEqual(want);
    // The address's start alone, and an address in full.
    expect(listed(await text(await adminGet(op, `/admin/accounts?q=${encodeURIComponent(s.mail("c"))}`)))).toEqual([s.c]);
    const none = await text(await adminGet(op, `/admin/accounts?q=${s.tag}&subscription=trialing`));
    expect(none).toContain("No account matches.");
    // Each filter's select shows the value in force.
    expect(await text(await adminGet(op, `/admin/accounts?q=${s.tag}&plan=pro`))).toContain('<option value="pro" selected="">Pro now</option>');
  });

  it("sorts by any column both ways, its heading links keeping the filters", async () => {
    const op = await operator();
    const s = await seedAccounts(op);
    const ids = async (query: string) => listed(await text(await adminGet(op, `/admin/accounts?q=${s.tag}&${query}`)));
    expect(await ids("sort=address")).toEqual([s.a, s.b, s.c, s.d, s.e]);
    expect(await ids("sort=address&dir=desc")).toEqual([s.e, s.d, s.c, s.b, s.a]);
    // Saved searches: a and d hold none, and tie on the id, in the same direction.
    expect(await ids("sort=searches&dir=asc")).toEqual([s.a, s.d, s.c, s.b, s.e]);
    expect(await ids("sort=searches&dir=desc")).toEqual([s.e, s.b, s.c, s.d, s.a]);
    expect(await ids("sort=created&dir=asc")).toEqual([s.a, s.b, s.c, s.d, s.e]);
    // Every key sorts without a fault.
    for (const key of ["plan", "status", "blocked", "sign_in", "delivery", "keys", "subscription", "language"]) {
      for (const dir of ["asc", "desc"]) expect((await ids(`sort=${key}&dir=${dir}`)).sort(), `${key} ${dir}`).toEqual([s.a, s.b, s.c, s.d, s.e].sort());
    }
    expect(await ids("sort=sign_in&dir=desc")).toEqual([s.e, s.b, s.c, s.d, s.a]);
    const html = await text(await adminGet(op, `/admin/accounts?q=${s.tag}&plan=free&sort=address`));
    expect(html).toContain(`<th aria-sort="ascending"><a href="/admin/accounts?q=${s.tag}&plan=free&sort=address&dir=desc">Address`);
    expect(html).toContain(`<a href="/admin/accounts?q=${s.tag}&plan=free&sort=searches">Saved searches</a>`);
    expect(html).toContain(`<a href="/admin/accounts?q=${s.tag}&plan=free">Signed up</a>`);
    // The filter form keeps the order.
    expect(html).toContain('<input type="hidden" name="sort" value="address"/>');
  });

  it("ignores a sort, direction, filter or page value off its list, and runs nothing it is given", async () => {
    const op = await operator();
    const s = await seedAccounts(op);
    const all = [s.e, s.d, s.c, s.b, s.a];
    for (const query of [
      `sort=${encodeURIComponent("created_at; DROP TABLE users")}`, `sort=${encodeURIComponent("email) --")}`, "sort=CREATED", "dir=sideways",
      `dir=${encodeURIComponent("desc; DELETE FROM users")}`, "plan=enterprise", `subscription=${encodeURIComponent("' OR 1=1 --")}`,
      "language=de", "blocked=maybe", "delivery=1", "status=", "page=-3", "page=1e3", "page=abc",
    ]) {
      const res = await adminGet(op, `/admin/accounts?q=${s.tag}&${query}`);
      expect(res.status, query).toBe(200);
      expect(listed(await text(res)), query).toEqual(all);
    }
    // A direction off the list on a valid key is that key's first direction.
    expect(listed(await text(await adminGet(op, `/admin/accounts?q=${s.tag}&sort=address&dir=${encodeURIComponent("asc; --")}`))))
      .toEqual([s.a, s.b, s.c, s.d, s.e]);
    const csv = await adminGet(op, `/admin/accounts.csv?q=${s.tag}&sort=${encodeURIComponent("created_at; DROP TABLE users")}`);
    expect(csv.status).toBe(200);
    expect((await csv.text()).split("\r\n").slice(1, 6).map((l) => l.split(",")[0])).toEqual(all);
    expect(await userRow(s.b)).toMatchObject({ status: "active" });
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM users WHERE email LIKE ?").bind(`${s.tag}%`).first<{ n: number }>())?.n).toBe(5);
  });

  it("pages 50 at a time, a page past the last showing the last, page 0 the first", async () => {
    const op = await operator();
    const tag = newTag();
    const users = Array.from({ length: 120 }, (_, i) => ({
      id: hexId(), email: `${tag}-${String(i).padStart(3, "0")}@example.com`, at: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString(),
    }));
    await ACCOUNTS.batch(users.map((u) => ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, 'en', 'active', 'free')")
      .bind(u.id, u.email, u.at)));
    const newest = [...users].reverse().map((u) => u.id);
    const pageOf = async (query: string) => text(await adminGet(op, `/admin/accounts?q=${tag}&language=en${query}`));
    const first = await pageOf("");
    expect(ACCOUNT_PAGE_SIZE).toBe(50);
    expect(listed(first)).toEqual(newest.slice(0, 50));
    expect(first).toContain("120 accounts, showing 1 to 50");
    expect(first).toContain("Page 1 of 3");
    expect(first).toContain(`<a href="/admin/accounts?q=${tag}&language=en&page=2" class="btn" rel="next">`);
    expect(first).not.toContain('rel="prev"');
    expect(listed(await pageOf("&page=0"))).toEqual(newest.slice(0, 50));
    expect(listed(await pageOf("&page=1"))).toEqual(newest.slice(0, 50));
    const second = await pageOf("&page=2");
    expect(listed(second)).toEqual(newest.slice(50, 100));
    expect(second).toContain(`<a href="/admin/accounts?q=${tag}&language=en" class="btn" rel="prev">`);
    for (const page of ["3", "4", "200", "10000", "999999"]) {
      const last = await pageOf(`&page=${page}`);
      expect(listed(last), page).toEqual(newest.slice(100));
      expect(last, page).toContain("120 accounts, showing 101 to 120");
      expect(last, page).toContain("Page 3 of 3");
      expect(last, page).not.toContain('rel="next"');
    }
    // The order and the filters carry through the pages.
    const byAddress = await pageOf("&sort=address&dir=desc&page=2");
    expect(listed(byAddress)).toEqual([...users].reverse().slice(50, 100).map((u) => u.id));
    expect(byAddress).toContain(`href="/admin/accounts?q=${tag}&language=en&sort=address&dir=desc&page=3"`);
  });

  it(`stops paging at page ${ACCOUNT_MAX_PAGE} and the CSV at ${ACCOUNT_CSV_ROWS} rows`, async () => {
    const op = await operator();
    const tag = newTag();
    const total = ACCOUNT_CSV_ROWS + 50;
    const idHead = (0xb0000000 + ++seq).toString(16).padStart(24, "0");
    await ACCOUNTS.prepare(
      "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?3 - 1) " +
      "INSERT INTO users (id, email, created_at, lang, status, plan) " +
      "SELECT ?1 || printf('%08x', i), ?2 || printf('-%05d@example.com', i), strftime('%Y-%m-%dT%H:%M:%fZ', '2024-01-01', '+' || i || ' minutes'), 'en', 'active', 'free' FROM n",
    ).bind(idHead, tag, total).run();
    try {
      const html = await text(await adminGet(op, `/admin/accounts?q=${tag}&page=10000`));
      expect(html).toContain("10,050 accounts, showing 9,951 to 10,000");
      expect(html).toContain(`Page ${ACCOUNT_MAX_PAGE} of ${ACCOUNT_MAX_PAGE}`);
      expect(html).toContain("Only the first 10,000 can be paged through");
      expect(html).not.toContain('rel="next"');
      const res = await adminGet(op, `/admin/accounts.csv?q=${tag}`);
      const lines = (await res.text()).split("\r\n");
      expect(lines[0]).toBe(ACCOUNT_CSV_HEAD.join(","));
      expect(lines.at(-1)).toBe("");
      expect(lines.length - 2).toBe(ACCOUNT_CSV_ROWS);
      // Newest first: the 50 oldest are the ones left out.
      expect(lines[1].split(",")[1]).toBe(`${tag}-${String(total - 1).padStart(5, "0")}@example.com`);
      expect(lines.at(-2)!.split(",")[1]).toBe(`${tag}-00050@example.com`);
    } finally {
      await ACCOUNTS.prepare("DELETE FROM users WHERE id LIKE ?").bind(`${idHead}%`).run();
    }
  });

  it("serves the view as a CSV: the same columns, filters and order, every page, no-store", async () => {
    const op = await operator();
    const s = await seedAccounts(op);
    const res = await adminGet(op, `/admin/accounts.csv?q=${s.tag}&page=2`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="accounts-[0-9]{4}-[0-9]{2}-[0-9]{2}\.csv"$/);
    const lines = (await res.text()).split("\r\n");
    expect(lines[0]).toBe(
      "user_id,address,plan,plan_until,status,blocked,blocked_at,signed_up,last_sign_in,saved_searches,delivery_on,api_keys,subscription,language",
    );
    expect(lines.slice(1, -1).map((l) => l.split(",")[0])).toEqual([s.e, s.d, s.c, s.b, s.a]);
    expect(lines).toContain(
      `${s.b},${s.mail("b")},pro,2099-01-01T00:00:00.000Z,active,no,,2026-02-01T00:00:00.000Z,2026-10-30T09:00:00.000Z,2,1,1,active,fr`,
    );
    expect(lines).toContain(
      `${s.c},${s.mail("c")},free,,active,yes,2026-10-01T12:00:00.000Z,2026-03-01T00:00:00.000Z,2026-09-15T09:00:00.000Z,1,0,0,past_due,en`,
    );
    expect(lines).toContain(`${s.a},${s.mail("a")},free,,active,no,,2026-01-01T00:00:00.000Z,,0,0,0,,en`);
    const filtered = (await (await adminGet(op, `/admin/accounts.csv?q=${s.tag}&delivery=on&sort=address`)).text()).split("\r\n");
    expect(filtered.slice(1, -1).map((l) => l.split(",")[0])).toEqual([s.b, s.e]);
    // The page's link carries the view, without its page.
    const html = await text(await adminGet(op, `/admin/accounts?q=${s.tag}&delivery=on&sort=address&page=2`));
    expect(html).toContain(`href="/admin/accounts.csv?q=${s.tag}&delivery=on&sort=address"`);
    // A cell a spreadsheet would read as a formula is written as text.
    const formula = await addUser(`=${s.tag}-f@example.com`, "2026-06-01T00:00:00.000Z");
    const guarded = (await (await adminGet(op, `/admin/accounts.csv?q=${encodeURIComponent(`=${s.tag}`)}`)).text()).split("\r\n");
    expect(guarded[1]).toBe(`${formula},'=${s.tag}-f@example.com,free,,active,no,,2026-06-01T00:00:00.000Z,,0,0,0,,en`);
  });

  it("reads every account as not blocked while account_blocks is missing", async () => {
    const op = await operator();
    const s = await seedAccounts(op);
    const blocks = await ACCOUNTS.prepare("SELECT user_id, reason, created_at, by_user_id, paused FROM account_blocks").all();
    await ACCOUNTS.prepare("DROP TABLE account_blocks").run();
    try {
      const html = await text(await adminGet(op, `/admin/accounts?q=${s.tag}`));
      expect(listed(html)).toEqual([s.e, s.d, s.c, s.b, s.a]);
      expect(cells(html, s.c).Blocked).toBe("No");
      expect(listed(await text(await adminGet(op, `/admin/accounts?q=${s.tag}&blocked=yes`)))).toEqual([]);
      expect((await adminGet(op, `/admin/accounts.csv?q=${s.tag}`)).status).toBe(200);
    } finally {
      await ACCOUNTS.prepare(
        "CREATE TABLE IF NOT EXISTS account_blocks (user_id TEXT PRIMARY KEY REFERENCES users(id), reason TEXT, created_at TEXT NOT NULL, " +
        "by_user_id TEXT NOT NULL REFERENCES users(id), paused TEXT)",
      ).run();
      for (const r of (blocks.results ?? []) as Record<string, string | null>[]) {
        await ACCOUNTS.prepare("INSERT INTO account_blocks (user_id, reason, created_at, by_user_id, paused) VALUES (?, ?, ?, ?, ?)")
          .bind(r.user_id, r.reason, r.created_at, r.by_user_id, r.paused).run();
      }
    }
  });

  it("is the site's 404 for a reader, a signed-out request, and anyone while the switch is off", async () => {
    const op = await operator();
    const r = await reader(op.env, "tbl-reader");
    for (const path of ["/admin/accounts", "/admin/accounts.csv"]) {
      expect((await get(path, { cookie: r.cookie, env: op.env })).status, `reader ${path}`).toBe(404);
      expect((await get(path, { env: op.env })).status, `signed out ${path}`).toBe(404);
      expect((await get(path, { cookie: op.cookie, env: { ...offEnv(), OPERATOR_EMAILS: op.email } })).status, `switch off ${path}`).toBe(404);
      expect((await adminGet(op, path)).status, `operator ${path}`).toBe(200);
    }
  });

  it("speaks French", async () => {
    const op = await operator();
    const s = await seedAccounts(op);
    const html = await text(await adminGet(op, `/admin/accounts?lang=fr&q=${s.tag}`));
    for (const w of [
      "Comptes", "Inscription", "Dernière connexion", "Recherches enregistrées", "Envoi activé", "Clés d’API", "Abonnement", "Langue",
      "Indifférent", "Gratuit maintenant", "Pro maintenant", "Activé pour au moins une recherche", "Aucun abonnement",
      "5 comptes, affichage de 1 à 5", "Oui, depuis le 2026-10-01", "Français", "Télécharger le CSV", "Appliquer",
    ]) expect(html, w).toContain(w);
    for (const w of ["Signed up", "Last sign-in", "Download CSV", "Any<"]) expect(html, w).not.toContain(w);
    expect(html).not.toContain(EM_DASH);
  });
});

// =========================================================================================
// One account's page
// =========================================================================================

describe("the user page", () => {
  it("shows the row, both plans, entitlements, the stored subscription, sessions, searches, keys, deliveries and the audit trail", async () => {
    const op = await operator();
    const mobile = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148" };
    const r = await reader(op.env, "page", mobile);
    const second = await signIn(r.email, { env: op.env, headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/140.0" } });
    expect(second).not.toBe("");
    await grantPro(r.email, "2099-01-01T00:00:00.000Z");
    await entitle(r.id, { revoked: true });
    await ACCOUNTS.prepare(
      "INSERT INTO payment_customers (user_id, customer_id, subscription_id, status, current_period_end, updated_at) VALUES (?, 'cus_p1', 'sub_p1', 'active', '2026-12-01T00:00:00.000Z', ?)",
    ).bind(r.id, new Date().toISOString()).run();
    const search = await addSearch(r.id, "weekly");
    await ACCOUNTS.prepare("INSERT INTO deliveries (saved_search_id, sent_at, items, status) VALUES (?, '2026-11-01T15:02:00.000Z', 7, 'sent')").bind(search).run();
    const keyCsrf = await csrf(second, "/account", { env: op.env });
    expect((await post("/account/keys", { csrf: keyCsrf, name: "probe" }, { cookie: second, env: op.env })).status).toBe(200);
    const res = await adminGet(op, `/admin/users/${r.id}`);
    expect(res.status).toBe(200);
    const html = await text(res);
    for (const s of [
      r.email, r.id, "Plan as cached", "Plan now, from the rows", "Pro, until 2099-01-01", "Entitlements", "Revoked ", "By hand",
      "Subscription", "cus_p1", "sub_p1", "The Stripe keys are not set", "Card details stay with Stripe", "Sessions", "mobile 1", "desktop 1",
      "Saved Searches", "Tender notices", "Weekly", "2026-11-01 15:02 UTC, sent (7 records)", "API Keys", "aw_", "Deliveries, Latest 20",
      "Audit Trail", "signed_in", "key_created", "Blocked", "Block the account", "Change the address", "Delete the account",
    ]) expect(html, s).toContain(s);
    // One revoke button: the live grant, not the revoked row.
    expect(html.match(/\/entitlements\/[0-9a-f]{32}\/revoke/g)).toHaveLength(1);
    // No cancellation or refund without the Stripe keys.
    expect(html).not.toContain(`/admin/users/${r.id}/cancel`);
    expect(html).not.toContain(`/admin/users/${r.id}/refund`);
  });

  it("reads the subscription from Stripe when the keys are set", async () => {
    const op = await operator(STRIPE);
    const r = await reader(op.env, "live-sub");
    await ACCOUNTS.prepare(
      "INSERT INTO payment_customers (user_id, customer_id, subscription_id, status, current_period_end, updated_at) VALUES (?, 'cus_l1', 'sub_l1', 'active', NULL, ?)",
    ).bind(r.id, new Date().toISOString()).run();
    subs.set("sub_l1", {
      id: "sub_l1", object: "subscription", customer: "cus_l1", status: "past_due", cancel_at_period_end: true,
      items: { data: [{ current_period_end: Date.parse("2026-12-24T00:00:00Z") / 1000 }] }, metadata: {},
    });
    const html = await text(await adminGet(op, `/admin/users/${r.id}`));
    expect(html).toMatch(/Status at Stripe now<\/dt>\s*<dd class="mono">past_due/);
    expect(html).toMatch(/Period end at Stripe<\/dt>\s*<dd class="mono">2026-12-24/);
    expect(html).toMatch(/Ends at the period end<\/dt>\s*<dd>Yes/);
    expect(html).toContain(`/admin/users/${r.id}/cancel`);
    const call = stripeSent().find((s) => s.url.pathname === "/v1/subscriptions/sub_l1")!;
    expect(call.method).toBe("GET");
    expect(call.headers.authorization).toBe(`Bearer ${STRIPE.STRIPE_SECRET_KEY}`);
    expect(call.headers["stripe-version"]).toBe(STRIPE_VERSION);
    // Stripe down: the stored row and a line saying so.
    failing.add("GET /v1/subscriptions/:id");
    expect(await text(await adminGet(op, `/admin/users/${r.id}`))).toContain("Stripe could not be read just now");
  });

  it("is the site's 404 for an unknown or malformed id, and offers no actions on the operator's own account", async () => {
    const op = await operator();
    expect((await adminGet(op, `/admin/users/${"f".repeat(32)}`)).status).toBe(404);
    expect((await adminGet(op, "/admin/users/not-an-id")).status).toBe(404);
    expect((await adminPost(op, `/admin/users/${"f".repeat(32)}/sign-out`)).status).toBe(404);
    const own = await text(await adminGet(op, `/admin/users/${op.id}`));
    expect(own).toContain("This is your own account.");
    expect(own).not.toContain(`/admin/users/${op.id}/block`);
  });
});

// =========================================================================================
// Posts: Origin and CSRF
// =========================================================================================

describe("every post", () => {
  it("needs the site's Origin and the session's CSRF value, and changes nothing without them", async () => {
    const op = await operator();
    const r = await reader(op.env, "csrf");
    const path = `/admin/users/${r.id}/grant`;
    const fields = { reference: "csrf test" };
    expect((await adminPost(op, path, fields, { csrf: "0".repeat(32) })).status).toBe(403);
    expect((await adminPost(op, path, fields, { csrf: "" })).status).toBe(403);
    expect((await adminPost(op, path, fields, { origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await adminPost(op, path, fields, { origin: "null" })).status).toBe(403);
    expect((await adminPost(op, path, fields, { origin: null })).status).toBe(403);
    // Another session's CSRF value is not this one's.
    expect((await adminPost(op, path, fields, { csrf: await csrf(r.cookie, "/account", { env: op.env }) })).status).toBe(403);
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?").bind(r.id).first<{ n: number }>())?.n).toBe(0);
    expect(await auditOf(r.id, "operator_granted")).toEqual([]);
    expect((await adminPost(op, path, fields)).status).toBe(303);
  });
});

// =========================================================================================
// Plans
// =========================================================================================

describe("granting and revoking", () => {
  it("grants Pro by hand with a reference and an optional end, and records who", async () => {
    const op = await operator();
    const r = await reader(op.env, "grant");
    const res = await adminPost(op, `/admin/users/${r.id}/grant`, { reference: "press account", until: "2099-06-30" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/admin/users/${r.id}?m=granted`);
    const row = await ACCOUNTS.prepare("SELECT plan, source, ends_at, reference, revoked_at FROM entitlements WHERE user_id = ?").bind(r.id).first();
    expect(row).toEqual({ plan: "pro", source: "manual", ends_at: "2099-06-30T00:00:00.000Z", reference: "press account", revoked_at: null });
    expect(await userRow(r.id)).toMatchObject({ plan: "pro", plan_until: "2099-06-30T00:00:00.000Z" });
    expect(await auditOf(r.id, "operator_granted")).toEqual([`by ${op.id}, until 2099-06-30`]);
    expect(await text(await adminGet(op, `/admin/users/${r.id}?m=granted`))).toContain("Pro granted.");
    // No end date: no end.
    expect((await adminPost(op, `/admin/users/${r.id}/grant`, { reference: "open grant" })).status).toBe(303);
    expect(await auditOf(r.id, "operator_granted")).toEqual([`by ${op.id}, until 2099-06-30`, `by ${op.id}, no end`]);
    expect(await userRow(r.id)).toMatchObject({ plan: "pro", plan_until: null });
  });

  it("refuses a missing or overlong reference, one holding an address, and a date that is past or not a date", async () => {
    const op = await operator();
    const r = await reader(op.env, "grant-bad");
    const tries: [Record<string, string>, string][] = [
      [{ reference: "" }, `Write a reference of at most ${REFERENCE_MAX} characters`],
      [{ reference: "x".repeat(REFERENCE_MAX + 1) }, "Write a reference"],
      [{ reference: "for reader@example.com" }, "without an address"],
      [{ reference: "ok", until: "2020-01-01" }, "Give the end date"],
      [{ reference: "ok", until: new Date().toISOString().slice(0, 10) }, "Give the end date"],
      [{ reference: "ok", until: "2099-02-30" }, "Give the end date"],
      [{ reference: "ok", until: "soon" }, "Give the end date"],
    ];
    for (const [fields, message] of tries) {
      const res = await adminPost(op, `/admin/users/${r.id}/grant`, fields);
      expect(res.status, JSON.stringify(fields)).toBe(400);
      expect(await text(res), JSON.stringify(fields)).toContain(message);
    }
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?").bind(r.id).first<{ n: number }>())?.n).toBe(0);
  });

  it("revokes a live row at once, and says so when there is nothing left to revoke", async () => {
    const op = await operator();
    const r = await reader(op.env, "revoke");
    await grantPro(r.email);
    const ent = await ACCOUNTS.prepare("SELECT id FROM entitlements WHERE user_id = ?").bind(r.id).first<{ id: string }>();
    const path = `/admin/users/${r.id}/entitlements/${ent!.id}/revoke`;
    const res = await adminPost(op, path);
    expect(res.headers.get("location")).toBe(`/admin/users/${r.id}?m=revoked`);
    expect((await ACCOUNTS.prepare("SELECT revoked_at FROM entitlements WHERE id = ?").bind(ent!.id).first<{ revoked_at: string | null }>())?.revoked_at)
      .not.toBeNull();
    expect(await userRow(r.id)).toMatchObject({ plan: "free" });
    expect(await auditOf(r.id, "operator_revoked")).toEqual([`by ${op.id}`]);
    expect((await adminPost(op, path)).headers.get("location")).toBe(`/admin/users/${r.id}?m=nothing`);
    // Another account's row is not this account's to revoke.
    const other = await reader(op.env, "revoke-other");
    await grantPro(other.email);
    const theirs = await ACCOUNTS.prepare("SELECT id FROM entitlements WHERE user_id = ?").bind(other.id).first<{ id: string }>();
    expect((await adminPost(op, `/admin/users/${r.id}/entitlements/${theirs!.id}/revoke`)).headers.get("location")).toContain("m=nothing");
    expect((await ACCOUNTS.prepare("SELECT revoked_at FROM entitlements WHERE id = ?").bind(theirs!.id).first<{ revoked_at: string | null }>())?.revoked_at)
      .toBeNull();
  });
});

// =========================================================================================
// Sessions
// =========================================================================================

describe("sign out everywhere", () => {
  it("revokes every session of the account", async () => {
    const op = await operator();
    const r = await reader(op.env, "out");
    expect((await get("/account", { cookie: r.cookie, env: op.env })).status).toBe(200);
    const res = await adminPost(op, `/admin/users/${r.id}/sign-out`);
    expect(res.headers.get("location")).toBe(`/admin/users/${r.id}?m=signed_out`);
    expect(await liveSessions(r.id)).toBe(0);
    const after = await get("/account", { cookie: r.cookie, env: op.env });
    expect(after.status).toBe(303);
    expect(after.headers.get("location")).toBe("/account/sign-in");
    expect(await auditOf(r.id, "operator_signed_out")).toEqual([`by ${op.id}, 1 sessions`]);
  });
});

// =========================================================================================
// Blocking
// =========================================================================================

describe("blocking", () => {
  const probe = new Hono<AppEnv>();
  probe.get("/plan", async (c) => c.text(await planOfRequest(c)));
  probe.get("/key", requireApiKey(), (c) => c.text("through"));

  async function proReaderWithKey(op: Operator) {
    const r = await reader(op.env, "blocked");
    await grantPro(r.email);
    const html = await (await post("/account/keys", { csrf: await csrf(r.cookie, "/account", { env: op.env }), name: "k" }, { cookie: r.cookie, env: op.env })).text();
    return { ...r, key: /(aw_[0-9a-f]{8}_[0-9a-f]{64})/.exec(html)![1] };
  }

  it("asks first: the GET says what happens, and a post without the box or a reason does nothing", async () => {
    const op = await operator();
    const r = await reader(op.env, "block-ask");
    const page = await text(await adminGet(op, `/admin/users/${r.id}/block`));
    for (const s of ["Block the Account", "Every session ends", "turned back on when the block is lifted", "API keys are refused", "free view"]) {
      expect(page, s).toContain(s);
    }
    expect(page).toContain(`action="/admin/users/${r.id}/block"`);
    expect(page).toContain('name="confirm" value="yes"');
    for (const [fields, message] of [
      [{ reason: "spam" }, "Tick the box to confirm."],
      [{ confirm: "yes" }, `Write a reason of at most ${REASON_MAX} characters`],
      [{ confirm: "yes", reason: "mail me at x@example.com" }, "without an address"],
    ] as [Record<string, string>, string][]) {
      const res = await adminPost(op, `/admin/users/${r.id}/block`, fields);
      expect(res.status).toBe(400);
      expect(await text(res)).toContain(message);
    }
    expect(await isBlocked(op.env as never, { id: r.id })).toBe(false);
    expect(await liveSessions(r.id)).toBe(1);
  });

  it("revokes the sessions, pauses delivery, refuses codes, links and keys, and reads as free; lifting it restores delivery", async () => {
    const op = await operator();
    const r = await proReaderWithKey(op);
    const daily = await addSearch(r.id, "daily");
    const weekly = await addSearch(r.id, "weekly", "/tenders?segment=43");
    const off = await addSearch(r.id, "off", "/tenders?segment=44");
    const key = { authorization: `Bearer ${r.key}` };
    expect(await (await probe.request("/plan", { headers: { cookie: r.cookie } }, op.env)).text()).toBe("pro");
    expect((await probe.request("/key", { headers: key }, op.env)).status).toBe(200);

    const res = await adminPost(op, `/admin/users/${r.id}/block`, { confirm: "yes", reason: "abuse of the API" });
    expect(res.headers.get("location")).toBe(`/admin/users/${r.id}?m=blocked`);
    const block = await ACCOUNTS.prepare("SELECT reason, by_user_id, paused FROM account_blocks WHERE user_id = ?").bind(r.id)
      .first<{ reason: string; by_user_id: string; paused: string }>();
    expect(block).toMatchObject({ reason: "abuse of the API", by_user_id: op.id });
    expect(pausedSearches(block!.paused).sort()).toEqual([[daily, "daily"], [weekly, "weekly"]].sort());
    expect(await auditOf(r.id, "operator_blocked")).toEqual([`by ${op.id}`]);
    expect(await isBlocked(op.env as never, { id: r.id })).toBe(true);
    expect(await isBlocked(op.env as never, { email: r.email })).toBe(true);

    // Sessions: gone, and the request reads as free.
    expect(await liveSessions(r.id)).toBe(0);
    expect(await (await probe.request("/plan", { headers: { cookie: r.cookie } }, op.env)).text()).toBe("free");
    // Delivery: off on every search.
    const delivers = await ACCOUNTS.prepare("SELECT id, deliver FROM saved_searches WHERE user_id = ? ORDER BY id").bind(r.id).all<{ id: string; deliver: string }>();
    expect(delivers.results?.map((s) => s.deliver)).toEqual(["off", "off", "off"]);
    // Keys: 401, as a revoked key.
    const refused = await probe.request("/key", { headers: key }, op.env);
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toContain("Bearer");
    // Sign-in: the same page as for any address, then the code and the link answer as stale ones.
    const stranger = newEmail("never-seen");
    const pageFor = async (email: string) => (await text(await post("/account/sign-in", { email }, { env: op.env }))).split(email).join("X");
    expect(await pageFor(r.email)).toBe(await pageFor(stranger));
    const { code, token } = await requestCode(r.email, { env: op.env });
    const byCode = await post("/account/check", { email: r.email, code, sent: "1" }, { env: op.env });
    expect(byCode.status).toBe(400);
    expect(sessionCookie(byCode)).toBe("");
    expect(await text(byCode)).toContain("This code or link has expired or was already used.");
    const byLink = await post("/account/check", { token }, { env: op.env });
    expect(byLink.status).toBe(400);
    expect(await text(byLink)).toContain("This code or link has expired or was already used.");
    expect(await liveSessions(r.id)).toBe(0);
    // The page shows the block.
    const page = await text(await adminGet(op, `/admin/users/${r.id}`));
    expect(page).toMatch(new RegExp(`Since [0-9-]{10}, by ${op.id}: abuse of the API`));
    expect(page).toContain("Lift the block");
    // A second block changes nothing and says so.
    expect((await adminPost(op, `/admin/users/${r.id}/block`, { confirm: "yes", reason: "again" })).headers.get("location")).toContain("m=already_blocked");

    // Lifted: delivery back where it was, keys and sign-in work again.
    const lifted = await adminPost(op, `/admin/users/${r.id}/unblock`);
    expect(lifted.headers.get("location")).toBe(`/admin/users/${r.id}?m=unblocked&n=2`);
    expect(await text(await adminGet(op, `/admin/users/${r.id}?m=unblocked&n=2`))).toContain("Delivery was turned back on for 2 saved searches.");
    const back = await ACCOUNTS.prepare("SELECT id, deliver FROM saved_searches WHERE user_id = ?").bind(r.id).all<{ id: string; deliver: string }>();
    expect(Object.fromEntries((back.results ?? []).map((s) => [s.id, s.deliver]))).toEqual({ [daily]: "daily", [weekly]: "weekly", [off]: "off" });
    expect(await auditOf(r.id, "operator_unblocked")).toEqual([`by ${op.id}`]);
    expect(await isBlocked(op.env as never, { id: r.id })).toBe(false);
    expect((await probe.request("/key", { headers: key }, op.env)).status).toBe(200);
    expect((await adminPost(op, `/admin/users/${r.id}/unblock`)).headers.get("location")).toContain("m=not_blocked");
    const again = await requestCode(r.email, { env: op.env });
    expect((await post("/account/check", { email: r.email, code: again.code, sent: "1" }, { env: op.env })).status).toBe(303);
  });

  it("keeps the delivery job away from a blocked account, and lets it back after", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const op = await operator();
    const DAY = "2026-10-31";
    const make = async (tag: string) => {
      const id = hexId();
      const email = newEmail(tag);
      await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active')").bind(id, email).run();
      await entitle(id, { created: "2026-01-01T00:00:00.000Z" });
      return { id, email, search: await addSearch(id, "daily", "/tenders?segment=72") };
    };
    const blocked = await make("job-blocked");
    const control = await make("job-control");
    expect((await adminPost(op, `/admin/users/${blocked.id}/block`, { confirm: "yes", reason: "job test" })).status).toBe(303);
    const files: Record<string, unknown> = {};
    for (let i = 0; i < 8; i++) {
      const d = new Date(`${DAY}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - i);
      files[`tenders/new/${d.toISOString().slice(0, 10)}.json`] = [];
    }
    files[`tenders/new/${DAY}.json`] = [{
      reference: "cb-700-70000009", amendment: 0, title_en: "Notice", title_fr: "Avis", buyer_id: "dfo-mpo", buyer_en: "Fisheries and Oceans Canada",
      buyer_fr: "Pêches et Océans Canada", published: DAY, closing: "2026-11-26T14:00:00", category: ["SRV"], notice_type_en: "Request for Proposal",
      notice_type_fr: "Demande de propositions", method_en: "Competitive", method_fr: "Concurrentielle", segments: ["72"], provinces: ["BC"],
      first_seen: DAY, status: "open",
    }];
    const handed: string[] = [];
    const mail = { async send(m: { to: string }) { handed.push(m.to); return { messageId: "<t@awardwatch.ca>" }; } } as unknown as SendEmail;
    const jobEnv = onEnv({ ASSETS: makeFakeAssets({}, files), MAIL: mail, MAIL_FROM: "alerts@awardwatch.ca", MAIL_SENDER: undefined });
    const rowsOf = async (search: string) =>
      ((await ACCOUNTS.prepare("SELECT status FROM deliveries WHERE saved_search_id = ?").bind(search).all<{ status: string }>()).results ?? []).map((d) => d.status);
    await runDeliveries(jobEnv as never);
    expect(await rowsOf(control.search)).toEqual(["sent"]);
    expect(await rowsOf(blocked.search)).toEqual([]);
    expect(handed).toContain(control.email);
    expect(handed).not.toContain(blocked.email);
    await adminPost(op, `/admin/users/${blocked.id}/unblock`);
    await runDeliveries(jobEnv as never);
    expect(await rowsOf(blocked.search)).toEqual(["sent"]);
  });

  it("is refused for the operator's own account and for a deleted one", async () => {
    const op = await operator();
    const own = await text(await adminGet(op, `/admin/users/${op.id}/block`));
    expect(own).toContain("This is your own account; the console does not do this to it.");
    expect(own).not.toContain('name="confirm"');
    expect((await adminPost(op, `/admin/users/${op.id}/block`, { confirm: "yes", reason: "self" })).status).toBe(400);
    expect(await isBlocked(op.env as never, { id: op.id })).toBe(false);
    const r = await reader(op.env, "gone");
    await ACCOUNTS.prepare("UPDATE users SET status = 'deleted', email = ? WHERE id = ?").bind(`deleted:${hexId()}`, r.id).run();
    expect(await text(await adminGet(op, `/admin/users/${r.id}/block`))).toContain("The account is deleted; this does not apply to it.");
    expect((await adminPost(op, `/admin/users/${r.id}/block`, { confirm: "yes", reason: "late" })).status).toBe(400);
  });

  it("reads the paused list strictly", () => {
    const a = "1".repeat(32);
    const b = "2".repeat(32);
    expect(pausedSearches(`${a}:daily,${b}:weekly`)).toEqual([[a, "daily"], [b, "weekly"]]);
    expect(pausedSearches(`${a}:off,nonsense,${b}:hourly,`)).toEqual([]);
    expect(pausedSearches(null)).toEqual([]);
  });
});

// =========================================================================================
// The address
// =========================================================================================

describe("changing the address", () => {
  it("asks first, then changes it, revokes every session, closes the old address's codes and tells the new address", async () => {
    const op = await operator();
    const r = await reader(op.env, "move");
    const page = await text(await adminGet(op, `/admin/users/${r.id}/email`));
    expect(page).toContain(`The account's address is <strong>${r.email}</strong> today.`);
    expect(page).toContain("receives a message saying the site's operator changed the account's address");
    const target = newEmail("moved");
    expect((await adminPost(op, `/admin/users/${r.id}/email`, { email: target })).status).toBe(400);
    expect((await userRow(r.id))?.email).toBe(r.email);
    await requestCode(r.email, { env: op.env });
    const res = await adminPost(op, `/admin/users/${r.id}/email`, { email: `  ${target.toUpperCase()} `, confirm: "yes" });
    expect(res.headers.get("location")).toBe(`/admin/users/${r.id}?m=email`);
    expect((await userRow(r.id))?.email).toBe(target);
    expect(await liveSessions(r.id)).toBe(0);
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM magic_codes WHERE email = ?").bind(r.email).first<{ n: number }>())?.n).toBe(0);
    const mail = await lastMail(target);
    expect(mail?.subject).toBe("Your Award Watch address was changed");
    expect(mail?.text).toContain("The site's operator changed the address of your Award Watch account to this one.");
    expect(mail?.text).toContain("/account/sign-in");
    expect(mail?.text).not.toContain(r.email);
    expect(mail?.html).not.toContain(r.email);
    expect(await lastMail(r.email).then((m) => m?.subject)).not.toBe("Your Award Watch address was changed");
    const audit = await auditOf(r.id, "operator_email_changed");
    expect(audit).toEqual([`by ${op.id}, notice sent`]);
    expect(audit.join(" ")).not.toContain("@");
    // The new address signs in to the same account; the old one starts afresh.
    await signIn(target, { env: op.env });
    expect(await userId(target)).toBe(r.id);
    await signIn(r.email, { env: op.env });
    expect(await userId(r.email)).not.toBe(r.id);
  });

  it("refuses an address another account holds, the same address, and one that is not an address", async () => {
    const op = await operator();
    const r = await reader(op.env, "move-bad");
    const other = await reader(op.env, "taken");
    const tries: [string, number, string][] = [
      [other.email, 409, "Another account holds that address."],
      [other.email.toUpperCase(), 409, "Another account holds that address."],
      [r.email, 400, "That is the account's address already."],
      ["not an address", 400, "Give a complete address."],
      [`${"a".repeat(250)}@example.com`, 400, "Give a complete address."],
    ];
    for (const [email, status, message] of tries) {
      const res = await adminPost(op, `/admin/users/${r.id}/email`, { email, confirm: "yes" });
      expect(res.status, email).toBe(status);
      expect(await text(res), email).toContain(message);
    }
    expect((await userRow(r.id))?.email).toBe(r.email);
    expect(await liveSessions(r.id)).toBe(1);
    expect(await auditOf(r.id, "operator_email_changed")).toEqual([]);
  });

  it("sends no message when mail is not set up, and says so", async () => {
    const signedIn = await operator();
    const r = await reader(signedIn.env, "move-quiet");
    // The same operator, on a site with no mail binding and no log sender.
    const op = { ...signedIn, env: { ...signedIn.env, MAIL_SENDER: undefined, MAIL: undefined } };
    expect(await text(await adminGet(op, `/admin/users/${r.id}/email`))).toContain("Mail is not set up here");
    const target = newEmail("moved-quiet");
    const res = await adminPost(op, `/admin/users/${r.id}/email`, { email: target, confirm: "yes" });
    expect(res.headers.get("location")).toBe(`/admin/users/${r.id}?m=email_unsent`);
    expect(await lastMail(target)).toBeNull();
    expect(await auditOf(r.id, "operator_email_changed")).toEqual([`by ${op.id}, notice not sent`]);
  });

  it("writes the notice in the account's language, with no em-dash", () => {
    const fr = addressNotice("fr", "x@example.com", "https://awardwatch.ca");
    expect(fr.subject).toBe("Votre adresse Award Watch a été changée");
    expect(fr.text).toContain("https://awardwatch.ca/account/sign-in?lang=fr");
    for (const m of [fr, addressNotice("en", "x@example.com", "https://awardwatch.ca")]) {
      expect(m.text + m.html + m.subject).not.toContain(EM_DASH);
      expect(m.html).toContain("contact@awardwatch.ca");
    }
  });

  it("is refused for the operator's own account", async () => {
    const op = await operator();
    expect((await adminPost(op, `/admin/users/${op.id}/email`, { email: newEmail("self"), confirm: "yes" })).status).toBe(400);
    expect((await userRow(op.id))?.email).toBe(op.email);
  });
});

// =========================================================================================
// The subscription
// =========================================================================================

async function subscriber(op: Operator, tag = "sub") {
  const r = await reader(op.env, tag);
  const sub = `sub_${hexId().slice(-12)}`;
  await ACCOUNTS.prepare(
    "INSERT INTO payment_customers (user_id, customer_id, subscription_id, status, current_period_end, updated_at) VALUES (?, 'cus_s1', ?, 'active', ?, ?)",
  ).bind(r.id, sub, "2026-12-03T00:00:00.000Z", new Date().toISOString()).run();
  subs.set(sub, {
    id: sub, object: "subscription", customer: "cus_s1", status: "active", cancel_at_period_end: false,
    items: { data: [{ current_period_end: Date.parse("2026-12-03T00:00:00Z") / 1000 }] }, metadata: { user_id: r.id },
  });
  return { ...r, sub };
}

describe("cancelling the subscription", () => {
  it("asks first, then cancels at the period end with cancel_at_period_end", async () => {
    const op = await operator(STRIPE);
    const r = await subscriber(op);
    const page = await text(await adminGet(op, `/admin/users/${r.id}/cancel`));
    expect(page).toContain("Pro runs to 2026-12-03");
    expect(page).toContain("Cancel at the period end");
    expect(page).toContain("Cancel at once");
    sent = [];
    const unconfirmed = await adminPost(op, `/admin/users/${r.id}/cancel`, { at: "period_end" });
    expect(unconfirmed.status).toBe(400);
    expect(stripeSent().filter((s) => s.method !== "GET")).toEqual([]);
    const res = await adminPost(op, `/admin/users/${r.id}/cancel`, { at: "period_end", confirm: "yes" });
    expect(res.headers.get("location")).toBe(`/admin/users/${r.id}?m=cancel_end`);
    const call = stripeSent().find((s) => s.method === "POST")!;
    expect(call.url.pathname).toBe(`/v1/subscriptions/${r.sub}`);
    expect([...call.form]).toEqual([["cancel_at_period_end", "true"]]);
    expect(call.headers.authorization).toBe(`Bearer ${STRIPE.STRIPE_SECRET_KEY}`);
    expect(call.headers["stripe-version"]).toBe(STRIPE_VERSION);
    expect(call.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(await auditOf(r.id, "operator_cancelled")).toEqual([`by ${op.id}, at period end`]);
    // The stored row waits for Stripe's notice.
    expect((await ACCOUNTS.prepare("SELECT status FROM payment_customers WHERE user_id = ?").bind(r.id).first<{ status: string }>())?.status).toBe("active");
    expect(await text(await adminGet(op, `/admin/users/${r.id}/cancel`))).toContain("Stripe will already end it at the period end.");
  });

  it("cancels at once with a DELETE and marks the stored row; a refusal from Stripe changes nothing", async () => {
    const op = await operator(STRIPE);
    const r = await subscriber(op);
    failing.add("DELETE /v1/subscriptions/:id");
    const down = await adminPost(op, `/admin/users/${r.id}/cancel`, { at: "now", confirm: "yes" });
    expect(down.status).toBe(503);
    expect(await text(down)).toContain("Stripe could not be reached, or refused the request.");
    expect(await auditOf(r.id, "operator_cancelled")).toEqual([]);
    failing.clear();
    sent = [];
    const res = await adminPost(op, `/admin/users/${r.id}/cancel`, { at: "now", confirm: "yes" });
    expect(res.headers.get("location")).toBe(`/admin/users/${r.id}?m=cancel_now`);
    const call = stripeSent().find((s) => s.method === "DELETE")!;
    expect(call.url.pathname).toBe(`/v1/subscriptions/${r.sub}`);
    expect((await ACCOUNTS.prepare("SELECT status FROM payment_customers WHERE user_id = ?").bind(r.id).first<{ status: string }>())?.status).toBe("canceled");
    expect(await auditOf(r.id, "operator_cancelled")).toEqual([`by ${op.id}, at once`]);
    expect(await text(await adminGet(op, `/admin/users/${r.id}?m=cancel_now`))).toContain("Pro ends when its notice arrives.");
    // Ended now: nothing left to cancel.
    expect(await text(await adminGet(op, `/admin/users/${r.id}/cancel`))).toContain("The account has no subscription that can still bill.");
  });

  it("offers nothing without the Stripe keys or a subscription", async () => {
    const op = await operator();
    const r = await reader(op.env, "no-keys");
    expect(await text(await adminGet(op, `/admin/users/${r.id}/cancel`))).toContain("the Stripe keys are missing");
    expect((await adminPost(op, `/admin/users/${r.id}/cancel`, { at: "now", confirm: "yes" })).status).toBe(400);
    const withKeys = await operator(STRIPE);
    expect(await text(await adminGet(withKeys, `/admin/users/${r.id}/cancel`))).toContain("no subscription that can still bill");
    expect(stripeSent()).toEqual([]);
  });
});

describe("refunding the latest payment", () => {
  function paidThroughIntent(sub: string, o: { refunded?: number } = {}) {
    invoices = [
      { id: "in_zero", object: "invoice", subscription: sub, status: "paid", amount_paid: 0, payments: { data: [] } },
      {
        id: "in_paid", object: "invoice", status: "paid", amount_paid: 1900,
        payments: { object: "list", data: [{ id: "inpay_1", status: "paid", payment: { type: "payment_intent", payment_intent: "pi_1" } }] },
      },
    ];
    charges.set("ch_fail", { id: "ch_fail", payment_intent: "pi_1", amount: 1900, amount_refunded: 0, currency: "cad", status: "failed", paid: false, created: 1 });
    charges.set("ch_1", {
      id: "ch_1", object: "charge", payment_intent: "pi_1", amount: 1900, amount_refunded: o.refunded ?? 0, refunded: (o.refunded ?? 0) >= 1900,
      currency: "cad", status: "succeeded", paid: true, created: Date.parse("2026-11-03T12:00:00Z") / 1000,
      billing_details: { email: "cardholder@example.com", name: "Card Holder" },
      payment_method_details: { type: "card", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } },
    });
  }

  it("shows the charge of the latest paid invoice and no card data, then refunds it in full under an idempotency key", async () => {
    const op = await operator(STRIPE);
    const r = await subscriber(op, "refund");
    paidThroughIntent(r.sub);
    const res = await adminGet(op, `/admin/users/${r.id}/refund`);
    const page = await text(res);
    for (const s of ["in_paid", "ch_1", "19.00 CAD", "0.00 CAD", "2026-11-03", "ends the account's Stripe Pro", "The subscription is not cancelled."]) {
      expect(page, s).toContain(s);
    }
    for (const s of ["4242", "cardholder@example.com", "Card Holder"]) expect(page, s).not.toContain(s);
    const list = stripeSent().find((s) => s.url.pathname === "/v1/invoices")!;
    expect(list.method).toBe("GET");
    expect(list.url.searchParams.get("subscription")).toBe(r.sub);
    expect(list.url.searchParams.get("status")).toBe("paid");
    expect(list.url.searchParams.getAll("expand[]")).toEqual(["data.payments"]);
    expect(stripeSent().find((s) => s.url.pathname === "/v1/charges")!.url.searchParams.get("payment_intent")).toBe("pi_1");
    // Not confirmed, or a charge other than the one shown: no refund.
    sent = [];
    expect((await adminPost(op, `/admin/users/${r.id}/refund`, { charge: "ch_1" })).status).toBe(400);
    const moved = await adminPost(op, `/admin/users/${r.id}/refund`, { charge: "ch_old", confirm: "yes" });
    expect(moved.status).toBe(409);
    expect(await text(moved)).toContain("The latest payment is not the one shown before.");
    expect(stripeSent().filter((s) => s.method === "POST")).toEqual([]);
    const done = await adminPost(op, `/admin/users/${r.id}/refund`, { charge: "ch_1", confirm: "yes" });
    expect(done.headers.get("location")).toBe(`/admin/users/${r.id}?m=refunded`);
    const refund = stripeSent().find((s) => s.method === "POST")!;
    expect(refund.url.pathname).toBe("/v1/refunds");
    expect([...refund.form]).toEqual([["charge", "ch_1"]]);
    expect(refund.headers["idempotency-key"]).toBe(refundKey("ch_1"));
    expect(refundKey("ch_1")).toBe("operator-refund-ch_1");
    expect(refund.headers["stripe-version"]).toBe(STRIPE_VERSION);
    expect(await auditOf(r.id, "operator_refunded")).toEqual([`by ${op.id}, refund succeeded`]);
    // The page says the webhook ends Pro; the refund itself wrote no entitlement.
    expect(await text(await adminGet(op, `/admin/users/${r.id}?m=refunded`))).toContain("Its notice ends the account's Stripe Pro");
    // Refunded in full: no second refund.
    const again = await text(await adminGet(op, `/admin/users/${r.id}/refund`));
    expect(again).toContain("That charge is refunded in full already.");
    expect(again).not.toContain('name="confirm"');
  });

  it("reads the charge an older API version names on the invoice itself", async () => {
    const op = await operator(STRIPE);
    const r = await subscriber(op, "refund-old");
    invoices = [{ id: "in_old", object: "invoice", subscription: r.sub, status: "paid", amount_paid: 19000, charge: "ch_old1" }];
    charges.set("ch_old1", { id: "ch_old1", amount: 19000, amount_refunded: 0, currency: "cad", status: "succeeded", paid: true, created: 1_700_000_000 });
    const page = await text(await adminGet(op, `/admin/users/${r.id}/refund`));
    expect(page).toContain("ch_old1");
    expect(page).toContain("190.00 CAD");
    expect(stripeSent().some((s) => s.url.pathname === "/v1/charges/ch_old1")).toBe(true);
  });

  it("says so when there is no paid charge, or Stripe cannot be reached, and refunds nothing", async () => {
    const op = await operator(STRIPE);
    const r = await subscriber(op, "refund-none");
    invoices = [];
    expect(await text(await adminGet(op, `/admin/users/${r.id}/refund`))).toContain("No paid invoice of the account's subscription took money");
    failing.add("GET /v1/invoices");
    const down = await adminPost(op, `/admin/users/${r.id}/refund`, { charge: "ch_1", confirm: "yes" });
    expect(down.status).toBe(400);
    expect(await text(down)).toContain("Stripe could not be reached");
    failing.clear();
    paidThroughIntent(r.sub);
    failing.add("POST /v1/refunds");
    const refused = await adminPost(op, `/admin/users/${r.id}/refund`, { charge: "ch_1", confirm: "yes" });
    expect(refused.status).toBe(503);
    expect(await auditOf(r.id, "operator_refunded")).toEqual([]);
  });
});

// =========================================================================================
// Deletion
// =========================================================================================

describe("deleting the account", () => {
  it("asks first, then deletes as the reader's own deletion does", async () => {
    const op = await operator();
    const r = await reader(op.env, "del");
    await addSearch(r.id);
    const page = await text(await adminGet(op, `/admin/users/${r.id}/delete`));
    expect(page).toContain("The same deletion a reader makes from their own account page.");
    expect((await adminPost(op, `/admin/users/${r.id}/delete`)).status).toBe(400);
    expect((await userRow(r.id))?.status).toBe("active");
    const res = await adminPost(op, `/admin/users/${r.id}/delete`, { confirm: "yes" });
    expect(res.headers.get("location")).toBe(`/admin/users/${r.id}?m=deleted`);
    const row = await userRow(r.id);
    expect(row?.status).toBe("deleted");
    expect(row?.email).toMatch(/^deleted:[0-9a-f]{64}$/);
    expect(await liveSessions(r.id)).toBe(0);
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?").bind(r.id).first<{ n: number }>())?.n).toBe(0);
    expect(await auditOf(r.id, "deleted")).toEqual([null]);
    expect(await auditOf(r.id, "operator_deleted")).toEqual([`by ${op.id}`]);
    const after = await text(await adminGet(op, `/admin/users/${r.id}?m=deleted`));
    expect(after).toContain("Deleted Account");
    expect(after).toContain("The account was deleted.");
    expect(after).not.toContain(r.email);
    // The address signs up again as a new account.
    await signIn(r.email, { env: op.env });
    expect(await userId(r.email)).not.toBe(r.id);
  });

  it("ends a block with the account", async () => {
    const op = await operator();
    const r = await reader(op.env, "del-blocked");
    await adminPost(op, `/admin/users/${r.id}/block`, { confirm: "yes", reason: "before deletion" });
    expect(await text(await adminGet(op, `/admin/users/${r.id}/delete`))).toContain("The block ends with the account");
    expect((await adminPost(op, `/admin/users/${r.id}/delete`, { confirm: "yes" })).status).toBe(303);
    expect(await isBlocked(op.env as never, { id: r.id })).toBe(false);
    await signIn(r.email, { env: op.env });
    expect(await isBlocked(op.env as never, { email: r.email })).toBe(false);
  });

  it("cancels a live subscription first, and deletes nothing when Stripe cannot confirm it", async () => {
    const op = await operator(STRIPE);
    const r = await subscriber(op, "del-sub");
    failing.add("DELETE /v1/subscriptions/:id");
    failing.add("GET /v1/subscriptions/:id");
    const res = await adminPost(op, `/admin/users/${r.id}/delete`, { confirm: "yes" });
    expect(res.status).toBe(503);
    expect(await text(res)).toContain("The Pro subscription could not be cancelled, so the account was not deleted.");
    expect((await userRow(r.id))?.status).toBe("active");
    failing.clear();
    const ok = await adminPost(op, `/admin/users/${r.id}/delete`, { confirm: "yes" });
    expect(ok.status).toBe(303);
    expect(stripeSent().filter((s) => s.method === "DELETE").map((s) => s.url.pathname)).toContain(`/v1/subscriptions/${r.sub}`);
    expect((await userRow(r.id))?.status).toBe("deleted");
  });

  it("is refused for the operator's own account", async () => {
    const op = await operator();
    expect(await text(await adminGet(op, `/admin/users/${op.id}/delete`))).toContain("This is your own account");
    expect((await adminPost(op, `/admin/users/${op.id}/delete`, { confirm: "yes" })).status).toBe(400);
    expect((await userRow(op.id))?.status).toBe("active");
  });
});

// =========================================================================================
// The docs and robots.txt
// =========================================================================================

describe("the docs", () => {
  it("describe the secrets, the Access setup, each action, the Stripe permissions and the absence of card data", async () => {
    const docs = (await import("../../docs/accounts.md?raw")).default as string;
    const start = docs.indexOf("## Operator console");
    expect(start).toBeGreaterThan(0);
    const section = docs.slice(start).replace(/\s+/g, " ");
    for (const s of [
      "npx wrangler secret put OPERATOR_EMAILS", "npx wrangler secret put ACCESS_TEAM_DOMAIN", "npx wrangler secret put ACCESS_AUD",
      "never variables in `wrangler.jsonc`", "`Cf-Access-Jwt-Assertion`", "/cdn-cgi/access/certs", "at most once an hour", "at most once a minute",
      "first days only", "Zero Trust, Access controls, Applications", "Self-hosted and private", "path `admin`", "`admin/*`", "One-time PIN",
      "Application Audience (AUD) Tag", "the site's own 404", "Grant Pro by hand", "Revoke", "Cancel the subscription (confirm)",
      "Refund the latest payment (confirm)", "Block (confirm)", "Change the address (confirm)", "Sign out everywhere", "Delete (confirm)",
      "`cancel_at_period_end=true`", "`DELETE /v1/subscriptions/<id>`", "`POST /v1/refunds`", `\`Idempotency-Key: ${refundKey("<charge id>")}\``,
      "`charge.refunded`", "Subscriptions write", "Refunds write", "Invoices and Charges read", "The console never shows card data.",
      `at most ${REFERENCE_MAX} characters`, `at most ${REASON_MAX} characters`, "`by <operator's user id>`", "`account_blocks`",
      "`/admin/accounts`", "`/admin/accounts.csv`", "idx_users_created", `${ACCOUNT_PAGE_SIZE} to a page`, `page ${ACCOUNT_MAX_PAGE}`,
      `${ACCOUNT_CSV_ROWS.toLocaleString("en-CA")} rows`, ACCOUNT_CSV_HEAD.join(","),
    ]) expect(section, s).toContain(s);
    expect(section).not.toContain(EM_DASH);
    // No mailbox is named: the only @ in the section is the character refused in a note.
    expect(section.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/g)).toBeNull();
  });

  it("robots.txt keeps every open crawler group off /admin", () => {
    const groups = robotsTxt.split(/\n\s*\n/).filter((g) => /^User-agent:/m.test(g));
    const open = groups.filter((g) => /^Allow: \/$/m.test(g));
    expect(open).toHaveLength(2);
    for (const g of open) expect(g.split("\n")).toContain("Disallow: /admin");
  });
});
