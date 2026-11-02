// Shared steps for the accounts tests: the accounts database's schema and
// the development outbox applied to the local ACCOUNTS binding, an
// environment with the switch on and the log sender, requests from fresh
// addresses (so the per-address caps trip only where a test means them to),
// and a complete sign-in through the code in the outbox.
import { env } from "cloudflare:test";
import { beforeAll } from "vitest";
import accountsSchema from "../accounts_schema.sql?raw";
import accountsDev from "../seed/accounts_dev.sql?raw";
import { app } from "../src/index";
import { testEnv } from "./assets";

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

export async function get(path: string, o: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { "cf-connecting-ip": o.ip ?? nextIp(), "sec-fetch-mode": "navigate", ...o.headers };
  if (o.cookie) headers.cookie = o.cookie;
  return app.request(path, { headers }, o.env ?? onEnv());
}

// A form post from the site's own page (Origin http://localhost) unless
// origin says otherwise; null sends none.
export async function post(path: string, fields: Record<string, string>, o: Opts = {}): Promise<Response> {
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
  const set = res.headers.getSetCookie().find((s) => s.startsWith("aw_session="));
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

export const decode = (s: string) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export const nbsp = (s: string) => s.replace(/[  ]/g, " ");
