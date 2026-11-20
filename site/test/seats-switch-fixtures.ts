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
// The capture was made before the counter told four classes of client apart. The privacy page's two sentences about
// it changed with that (i18n.ts privacy.counting and privacy.visitor, each language), and nothing else on the page
// did, so each sentence as it reads now is put back as it read at the capture before the page is hashed: [now, at
// the capture]. A further change to either sentence is added here the same way, and the capture stays as it is.
const CAPTURED_TEXT: readonly (readonly [string, string])[] = [
  ["whether a crawler, a person's browser or another program asked, and the device class (computer, phone or tablet). Which of them asked is judged from the browser's identification, the network the request came from and the page asked for; the network itself is not recorded.",
   "whether a crawler or a person's browser asked, and the device class (computer, phone or tablet)."],
  ["si la requête vient d'un robot d'indexation, du navigateur d'une personne ou d'un autre programme, et la catégorie d'appareil (ordinateur, téléphone ou tablette). L'origine de la requête est établie d'après l'identification du navigateur, le réseau d'où elle vient et la page demandée; le réseau lui-même n'est pas consigné.",
   "si la requête vient d'un robot d'indexation ou du navigateur d'une personne, et la catégorie d'appareil (ordinateur, téléphone ou tablette)."],
  ["A request counted as a person's also gets a visitor code",
   "A request from a browser also gets a visitor code"],
  ["Une requête comptée comme celle d'une personne reçoit aussi un code de visiteur",
   "Une requête venant d'un navigateur reçoit aussi un code de visiteur"],
];
// Text as a page carries it: the apostrophe as the page writer escapes it (hono/jsx, &#39;) in English, and as
// French typography sets it first (i18n.ts, U+2019) in French.
const DRAWN: readonly ((text: string) => string)[] = [
  (text) => text.replaceAll("'", "&#39;"),
  (text) => text.replaceAll("'", "’"),
];
// The capture was made before the monthly record (pages/monthly.tsx). It added two things to these pages and
// changed nothing else in them: the footer's link to it on every page (layout.tsx FooterRow) and a fourth line in
// the app home's "What You Can Do Here" (pages/home.tsx HOME_DO). Each is taken out, as the page draws it in
// each language, before a page is hashed; the line first, since it holds the same address as the link. Also
// read by test/seats-service.test.ts and test/seats-rest-fixtures.ts, whose captures predate it too.
export const CAPTURED_WITHOUT: readonly string[] = [
  '<li><a href="/monthly">See each month in figures</a>: the tender notices, award notices, buyers and suppliers of each complete month, ready to cite.</li>',
  '<li><a href="/monthly">Voir chaque mois en chiffres</a>\u00a0: les avis d’appel d’offres et d’attribution, les acheteurs et les fournisseurs de chaque mois complet, prêts à citer.</li>',
  '<a href="/monthly">Monthly record</a>',
  '<a href="/monthly">Bilan mensuel</a>',
];
export const withoutMonthly = (page: string): string => CAPTURED_WITHOUT.reduce((p, added) => p.replaceAll(added, ""), page);
export async function shortHash(text: string): Promise<string> {
  let page = withoutMonthly(text).replaceAll(`styles.css?v=${STYLES_VERSION}"`, `styles.css?v=${CAPTURED_STYLES}"`);
  for (const [now, then] of CAPTURED_TEXT) for (const drawn of DRAWN) page = page.replaceAll(drawn(now), drawn(then));
  return (await sha256Hex(page)).slice(0, 24);
}

export type Seen = { status: number; cache: string | null; cookie: boolean; body: string };

// A page as a reader's browser gets it: its status, its caching, whether it sets a cookie, its body's hash.
export async function seen(path: string, env: object, cookie?: string): Promise<Seen> {
  const headers: Record<string, string> = { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() };
  if (cookie) headers.cookie = cookie;
  const res = await app.request(path, { headers }, env);
  return { status: res.status, cache: res.headers.get("cache-control"), cookie: res.headers.getSetCookie().length > 0, body: await shortHash(await res.text()) };
}
