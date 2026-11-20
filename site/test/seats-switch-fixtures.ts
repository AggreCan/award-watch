// The fixtures of test/seats-switch.test.ts, apart so test/seats-switch-today.ts could be captured from them on
// main before any of slice C's code was written: three accounts written at fixed ids, addresses, times and
// session secrets (a session's CSRF value comes from its secret, so it is fixed too, and its last use is set
// ahead of any clock the suite runs on, so no read extends it and no page names the day it ran), and the
// pages each reads, signed out and signed in, with Ultra off sale and on sale. Nothing here depends on the
// day the suite runs. A change to this file changes what the capture means: capture again from main.
import { ACCOUNTS, PRO_SALE, ULTRA_VARS, nextIp, onEnv } from "./accounts-helpers";
import { app } from "../src/index";
import { STYLES_VERSION } from "../src/layout";

const hexOf = (tag: number, n: number) => `${tag.toString(16).padStart(8, "0")}${n.toString(16).padStart(24, "0")}`;
const AT = "2026-01-05T09:00:00.000Z";
// Ahead of every clock the suite will run on: the session is never extended, so no read writes or re-sends it.
const LAST_USED = "2099-01-01T00:00:00.000Z";
const ENDS = "2099-02-01T00:00:00.000Z";

export type Reader = "out" | "free" | "pro" | "ultra";
export const READERS: readonly Reader[] = ["out", "free", "pro", "ultra"];
const TAG: Record<Exclude<Reader, "out">, number> = { free: 0x5e01, pro: 0x5e02, ultra: 0x5e03 };

export const SIGNED_OUT_PAGES = [
  "/", "/?lang=fr", "/pro", "/pro?lang=fr", "/terms", "/terms?lang=fr", "/privacy", "/privacy?lang=fr", "/account/sign-in",
  "/account/sign-in?lang=fr", "/tenders", "/organizations/org-a000000001", "/nothing-here",
];
export const SIGNED_IN_PAGES = [
  "/", "/account", "/account?lang=fr", "/account/billing", "/account/billing?lang=fr", "/account/delete", "/account/delete?lang=fr",
  "/account/searches", "/account/keys", "/account/watches", "/account/views", "/account/dashboard", "/account/bug", "/pro", "/terms?lang=fr",
  "/privacy",
];
export const pagesOf = (reader: Reader) => (reader === "out" ? SIGNED_OUT_PAGES : SIGNED_IN_PAGES);

// The two environments: Ultra off sale (the test environment as it is) and on sale.
export const ENVS = { base: () => onEnv(), sale: () => onEnv({ ...PRO_SALE, ...ULTRA_VARS }) } as const;
export type EnvName = keyof typeof ENVS;

export const emailOf = (reader: Exclude<Reader, "out">) => `switch-${reader}@example.com`;
export const idOf = (reader: Exclude<Reader, "out">) => hexOf(TAG[reader], 0);

async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The three accounts, each with one live session; Pro and Ultra granted by hand from January. Answers each
// reader's cookie.
export async function makeReaders(): Promise<Record<Reader, string | undefined>> {
  const cookies: Record<Reader, string | undefined> = { out: undefined, free: undefined, pro: undefined, ultra: undefined };
  for (const reader of ["free", "pro", "ultra"] as const) {
    const tag = TAG[reader];
    const id = idOf(reader);
    const session = hexOf(tag, 1);
    const secret = `${hexOf(tag, 2)}${hexOf(tag, 3)}`;
    const stmts = [
      ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, last_seen_at, lang, status, plan) VALUES (?, ?, ?, ?, 'en', 'active', ?)")
        .bind(id, emailOf(reader), AT, LAST_USED, reader === "free" ? "free" : "pro"),
      ACCOUNTS.prepare(
        "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, ua_class) VALUES (?, ?, ?, ?, ?, ?, 'desktop')",
      ).bind(session, id, await sha256Hex(secret), AT, LAST_USED, ENDS),
    ];
    if (reader !== "free") {
      const e = hexOf(tag, 4);
      stmts.push(ACCOUNTS.prepare(
        "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'manual', ?, NULL, 'fixture', ?)",
      ).bind(e, id, AT, AT));
      if (reader === "ultra") stmts.push(ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(e));
    }
    await ACCOUNTS.batch(stmts);
    cookies[reader] = `__Host-aw_session=${session}.${secret}`;
  }
  return cookies;
}

// The capture was made at this stylesheet stamp. A change to the stylesheet raises the stamp on every page
// (layout.tsx STYLES_VERSION) and changes nothing else in a page's bytes, so the stamp is put back before a page is
// hashed; a new stamp alone needs no new capture.
const CAPTURED_STYLES = 74;
export async function shortHash(text: string): Promise<string> {
  return (await sha256Hex(text.replaceAll(`styles.css?v=${STYLES_VERSION}"`, `styles.css?v=${CAPTURED_STYLES}"`))).slice(0, 24);
}

export type Seen = { status: number; cache: string | null; cookie: boolean; body: string };

// A page as a reader's browser gets it: its status, its caching, whether it sets a cookie, its body's hash.
export async function seen(path: string, env: object, cookie?: string): Promise<Seen> {
  const headers: Record<string, string> = { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() };
  if (cookie) headers.cookie = cookie;
  const res = await app.request(path, { headers }, env);
  return { status: res.status, cache: res.headers.get("cache-control"), cookie: res.headers.getSetCookie().length > 0, body: await shortHash(await res.text()) };
}
