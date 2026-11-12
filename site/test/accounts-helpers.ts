// Shared steps for the accounts tests: the accounts database's schema and
// the development outbox applied to the local ACCOUNTS binding, an
// environment with the switch on and the log sender, requests from fresh
// addresses (so the per-address caps trip only where a test means them to),
// and a complete sign-in through the code in the outbox.
import { env } from "cloudflare:test";
import { beforeAll } from "vitest";
import accountsSchema from "../accounts_schema.sql?raw";
import accountsDev from "../seed/accounts_dev.sql?raw";
import { forgetTiers } from "../src/account/entitlements";
import { app } from "../src/index";
import { testEnv } from "./assets";
import { homeRequest } from "./home";

export const ACCOUNTS = (env as unknown as { ACCOUNTS: D1Database }).ACCOUNTS;
export const DB = (env as unknown as { DB: D1Database }).DB;

function statements(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function useAccountsDb(): void {
  beforeAll(async () => {
    await ACCOUNTS.batch([...statements(accountsSchema), ...statements(accountsDev)].map((s) => ACCOUNTS.prepare(s)));
  });
}

// The switch on, the log sender; extra replaces or adds bindings. MAIL is
// left out: wrangler.jsonc's binding reaches the tests as the local runtime's
// stand-in, which writes every message it is given to a file, so a test that
// means the binding to answer passes its own (accounts-mail.test.ts).
export function onEnv(extra: Record<string, unknown> = {}) {
  return { ...testEnv(), ACCOUNTS_ENABLED: "true", MAIL_SENDER: "log", MAIL: undefined, ...extra };
}

// The switch as wrangler.jsonc ships it ("false").
export const offEnv = () => testEnv();

let address = 0;
export const nextIp = () => `198.51.100.${(address++ % 250) + 1}`;

let mailbox = 0;
export const newEmail = (tag = "reader") => `${tag}.${Date.now().toString(36)}.${mailbox++}@example.com`;

type Opts = { cookie?: string; env?: object; ip?: string; origin?: string | null; headers?: Record<string, string> };

// "/" is the app home here, signed in or not (test/home.ts); test/landing.test.ts
// requests the landing page through the app itself.
export async function get(path: string, o: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { "cf-connecting-ip": o.ip ?? nextIp(), "sec-fetch-mode": "navigate", ...o.headers };
  if (o.cookie) headers.cookie = o.cookie;
  return homeRequest(path, { headers }, o.env ?? onEnv());
}

// A form post from the site's own page (Origin http://localhost) unless
// origin says otherwise; null sends none. Pairs send a field more than once.
export async function post(path: string, fields: Record<string, string> | [string, string][], o: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": o.ip ?? nextIp(), ...o.headers,
  };
  if (o.origin !== null) headers.origin = o.origin ?? "http://localhost";
  if (o.cookie) headers.cookie = o.cookie;
  return app.request(path, { method: "POST", headers, body: new URLSearchParams(fields).toString() }, o.env ?? onEnv());
}

export type Mail = { to_addr: string; subject: string; text: string; html: string; lang: string };

export async function lastMail(to: string): Promise<Mail | null> {
  return ACCOUNTS.prepare("SELECT to_addr, subject, text, html, lang FROM sent_mail WHERE to_addr = ? ORDER BY id DESC LIMIT 1")
    .bind(to).first<Mail>();
}

export const codeIn = (text: string) => /([0-9]{6})/.exec(text)?.[1] ?? "";
export const tokenIn = (text: string) => /token=([0-9a-f]{32}\.[0-9a-f]{64})/.exec(text)?.[1] ?? "";

// The cookie a response sets, as a request would send it back.
export function sessionCookie(res: Response): string {
  const set = res.headers.getSetCookie().find((s) => s.startsWith("__Host-aw_session="));
  return set ? set.split(";")[0] : "";
}

export async function requestCode(email: string, o: Opts = {}): Promise<{ code: string; token: string }> {
  const res = await post("/account/sign-in", { email }, o);
  if (res.status !== 200) throw new Error(`sign-in request answered ${res.status}`);
  const mail = await lastMail(email);
  return { code: codeIn(mail?.text ?? ""), token: tokenIn(mail?.text ?? "") };
}

// A full sign-in: the request, then the code; the cookie to send back.
export async function signIn(email: string, o: Opts = {}): Promise<string> {
  const { code } = await requestCode(email, o);
  const res = await post("/account/check", { email, code, sent: "1" }, o);
  if (res.status !== 303) throw new Error(`check answered ${res.status}`);
  return sessionCookie(res);
}

export async function userId(email: string): Promise<string> {
  const row = await ACCOUNTS.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  if (!row) throw new Error("no user");
  return row.id;
}

// The CSRF value a signed-in page's forms carry.
export async function csrf(cookie: string, path = "/account", o: Opts = {}): Promise<string> {
  const html = await (await get(path, { ...o, cookie })).text();
  return /name="csrf" value="([0-9a-f]{32})"/.exec(html)?.[1] ?? "";
}

// The documented manual grant (docs/accounts.md), with the email bound.
export const MANUAL_GRANT_SQL =
  "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) " +
  "SELECT lower(hex(randomblob(16))), id, 'pro', 'manual', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, 'manual grant', " +
  "strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM users WHERE email = ? AND status = 'active'";

export async function grantPro(email: string, endsAt: string | null = null): Promise<void> {
  await ACCOUNTS.prepare(MANUAL_GRANT_SQL).bind(endsAt, email).run();
}

// Ultra by hand: a pro row and its tier row in one batch, as the console's
// grant writes them (src/account/entitlements.ts entitlementWrites).
export async function grantUltra(email: string, endsAt: string | null = null): Promise<string> {
  const user = await userId(email);
  const id = crypto.randomUUID().replace(/-/g, "");
  const at = new Date().toISOString();
  await ACCOUNTS.batch([
    ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'manual', ?, ?, 'manual grant', ?)",
    ).bind(id, user, at, endsAt, at),
    ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(id),
  ]);
  return id;
}

// Stripe's two secrets and Pro's four variables, test values (the code holds no price).
export const PRO_SALE = {
  STRIPE_SECRET_KEY: "sk_test_fake0000", STRIPE_WEBHOOK_SECRET: "whsec_fake0000",
  STRIPE_PRICE_MONTHLY: "price_monthlyTEST", STRIPE_PRICE_YEARLY: "price_yearlyTEST",
  PRICE_MONTHLY_CAD: "12", PRICE_YEARLY_CAD: "120.50",
};
// Ultra's five variables, test values: with PRO_SALE and the tier table, Ultra is on sale (payments.ts ultraOnSale).
export const ULTRA_VARS = {
  STRIPE_PRODUCT_ULTRA: "prod_ultraTEST", STRIPE_PRICE_ULTRA_MONTHLY: "price_ultraMonthlyTEST", STRIPE_PRICE_ULTRA_YEARLY: "price_ultraYearlyTEST",
  PRICE_ULTRA_MONTHLY_CAD: "30", PRICE_ULTRA_YEARLY_CAD: "301.50",
};
export const ultraEnv = (extra: Record<string, unknown> = {}) => onEnv({ ...PRO_SALE, ...ULTRA_VARS, ...extra });

// entitlement_tiers taken off the database for the length of fn, then made
// again from accounts_schema.sql: the database before the operator applies
// the schema. The isolate's memory of having seen the table goes with it.
const TIERS_SCHEMA = statements(accountsSchema).filter((s) => s.includes("entitlement_tiers"));
export async function withoutTiers<T>(fn: () => Promise<T>): Promise<T> {
  // The tier rows written so far are kept aside and put back, so later tests see them.
  const kept = (await ACCOUNTS.prepare("SELECT entitlement_id, tier FROM entitlement_tiers").all<{ entitlement_id: string; tier: string }>()).results ?? [];
  await ACCOUNTS.prepare("DROP TABLE IF EXISTS entitlement_tiers").run();
  forgetTiers();
  try {
    return await fn();
  } finally {
    await ACCOUNTS.batch(TIERS_SCHEMA.map((s) => ACCOUNTS.prepare(s)));
    if (kept.length) {
      await ACCOUNTS.batch(kept.map((r) => ACCOUNTS.prepare("INSERT OR IGNORE INTO entitlement_tiers (entitlement_id, tier) VALUES (?, ?)").bind(r.entitlement_id, r.tier)));
    }
    forgetTiers();
  }
}

// A page as it reads without Save this search (src/account/search_control.tsx),
// which a signed-in reader's page carries where a search is saved from: the
// line under a head, the toolbar's row, and the row's own form after the toolbar.
export const SAVE_SEARCH_PARTS = [
  /<form method="post" action="\/account\/searches" class="save-search">[\s\S]*?<\/form>/,
  /<div class="save-search">[\s\S]*?<\/div>/,
  /<div class="toolbar-row save-search" data-save-search="">[\s\S]*?<\/div>(?:<\/div>)?(?=<\/form>)/,
  /<form method="post" action="\/account\/searches" id="save-search" class="save-search-form">[\s\S]*?<\/form>/,
];
export const noSaveSearch = (body: string) => SAVE_SEARCH_PARTS.reduce((b, re) => b.replace(re, ""), body);

export const decode = (s: string) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export const nbsp = (s: string) => s.replace(/[  ]/g, " ");
