// The seats' switch (SEATS in wrangler.jsonc, src/account/seats.ts seatsOn; the seats design's 9.1). While it is
// off, and while it is on but the seats table is not on the database, every page a reader opens is byte for byte
// what main drew before slice C (test/seats-switch-today.ts, captured from these fixtures on main and never
// rebuilt here): signed out, Free, Pro and Ultra, Ultra off sale and on sale, the table present and absent.
// Every address under /account/seats and /account/seat is the site's 404, the same answer as an address the
// accounts module does not know, with nothing read beyond that answer's own reads; the invitation's post writes
// nothing and sends nothing; the limiter counts the seats' addresses as pages. With the switch on, a reader who
// neither holds a seat nor gives one reads every page as before once what the switch adds is taken out of it:
// the plan cards' seats row, /pro's Ultra text and its question, the Terms' Seats section and abuse phrase, the
// privacy page's paragraph, and an Ultra account's Seats row on the overview and Seats link on the billing page.
import { env as poolEnv } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import wrangler from "../wrangler.jsonc?raw";
import { KEYS_MAX } from "../src/account/api_keys";
import { PLANS, PLAN_SEATS, RULES, memberSeats } from "../src/account/entitlements";
import { SEAT_INVITE_DAYS, SEAT_KEEP_DAYS, SEAT_WINDOW_DAYS, joinsAllowed, seatsSwitched } from "../src/account/seats";
import { SESSIONS_MAX } from "../src/account/session";
import { keyQuota } from "../src/api_keyed_spec";
import { fmtInt, t, type Lang } from "../src/i18n";
import { app } from "../src/index";
import { scriptJson } from "../src/layout";
import { CHECK_PATH, dashboardsWording, planLine, seatsWording } from "../src/pro";
import { planYears } from "../src/records_db";
import { ACCOUNTS, csrf, nextIp, onEnv, post, useAccountsDb, withoutSeats } from "./accounts-helpers";
import { ENVS, type EnvName, READERS, type Reader, type Seen, emailOf, makeReaders, pagesOf, seen, shortHash } from "./seats-switch-fixtures";
import { TODAY } from "./seats-switch-today";

useAccountsDb();

afterEach(() => {
  vi.restoreAllMocks();
});

let cookies: Record<Reader, string | undefined> | null = null;
async function readers(): Promise<Record<Reader, string | undefined>> {
  if (!cookies) {
    cookies = await makeReaders();
    // A first read of each signed-in reader brings its cached plan up to date, as the capture did.
    for (const reader of READERS) if (cookies[reader]) await seen("/account", ENVS.base(), cookies[reader]);
  }
  return cookies;
}

// An environment with the seats' variable as given: "off" (as the test pool holds it), "on" (as wrangler.jsonc ships it), or absent (as before slice C).
function withSeats(env: object, value: "off" | "on" | null): object {
  const out = { ...env } as Record<string, unknown>;
  if (value === null) delete out.SEATS;
  else out.SEATS = value;
  return out;
}

// Every page of every reader, against the capture.
async function everyPage(value: "off" | "on" | null): Promise<Map<string, Seen>> {
  const c = await readers();
  const out = new Map<string, Seen>();
  for (const name of Object.keys(ENVS) as EnvName[]) {
    for (const reader of READERS) {
      for (const path of pagesOf(reader)) out.set(`${name} ${reader} ${path}`, await seen(path, withSeats(ENVS[name](), value), c[reader]));
    }
  }
  return out;
}

const SEATS_ROUTES: [string, string][] = [
  ["GET", "/account/seats"], ["GET", "/account/seats?lang=fr"], ["POST", "/account/seats/invite"],
  ["GET", `/account/seats/join?i=${"a".repeat(32)}&t=${"b".repeat(64)}`], ["POST", "/account/seats/join"],
  ["POST", `/account/seats/${"a".repeat(32)}/cancel`], ["GET", `/account/seats/${"a".repeat(32)}/remove`],
  ["POST", `/account/seats/${"a".repeat(32)}/remove`], ["GET", "/account/seat/leave"], ["POST", "/account/seat/leave"],
  ["GET", "/account/seats/anything"], ["GET", "/account/seat"],
];

// The accounts database with every statement prepared on it written down.
function recording(): { db: D1Database; sent: string[] } {
  const sent: string[] = [];
  const native = new WeakMap<object, D1PreparedStatement>();
  const db = new Proxy(ACCOUNTS, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          sent.push(sql);
          const stmt = target.prepare(sql);
          const wrapped = new Proxy(stmt, { get: (s, p) => { const v = Reflect.get(s, p); return typeof v === "function" ? v.bind(s) : v; } });
          native.set(wrapped, stmt);
          return wrapped;
        };
      }
      if (prop === "batch") return (stmts: D1PreparedStatement[]) => target.batch(stmts.map((s) => native.get(s) ?? s));
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { db: db as D1Database, sent };
}

async function request(method: string, path: string, env: object, cookie?: string, fields: Record<string, string> = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": nextIp(), "sec-fetch-mode": "navigate" };
  if (cookie) headers.cookie = cookie;
  const init: RequestInit = { method, headers };
  if (method === "POST") {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers.origin = "http://localhost";
    init.body = new URLSearchParams(fields).toString();
  }
  const res = await app.request(path, init, env);
  return { status: res.status, cache: res.headers.get("cache-control"), robots: res.headers.get("x-robots-tag"), body: await res.text() };
}

const counts = async () => {
  const one = async (sql: string) => Number((await ACCOUNTS.prepare(sql).first<{ n: number }>())?.n ?? 0);
  return {
    seats: await one("SELECT COUNT(*) AS n FROM seats"), mail: await one("SELECT COUNT(*) AS n FROM sent_mail"),
    runs: await one("SELECT COUNT(*) AS n FROM delivery_runs"), audit: await one("SELECT COUNT(*) AS n FROM audit WHERE event LIKE 'seat_%'"),
  };
};

describe("the switch as shipped", () => {
  it("ships \"on\", starts \"off\" under test, and only \"on\" with accounts open switches it", () => {
    // The site ships the switch on (since 2026-11-21); the test pool holds it off (vitest.config.ts), so every
    // test that does not set it sees the pages without seats.
    expect(wrangler).toMatch(/"SEATS":\s*"on"/);
    expect((poolEnv as unknown as { SEATS?: string }).SEATS).toBe("off");
    const switched = (extra: Record<string, unknown>) => seatsSwitched(onEnv(extra) as never);
    expect(switched({ SEATS: "on" })).toBe(true);
    for (const v of ["off", "", "On", "ON", "true", "1", undefined]) expect(switched({ SEATS: v }), String(v)).toBe(false);
    // Accounts closed: the seats' switch alone opens nothing.
    expect(switched({ SEATS: "on", ACCOUNTS_ENABLED: "false" })).toBe(false);
  });
});

describe("with the switch off", () => {
  it("draws every page, every reader, Ultra off sale and on sale, byte for byte as main drew it, the table present and absent", { timeout: 180_000 }, async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const value of ["off", null] as const) {
      for (const [key, page] of await everyPage(value)) expect(page, `${value ?? "absent"} ${key}`).toEqual(TODAY[key]);
    }
    await withoutSeats(async () => {
      // Without the table the switch reads as off even when it says on.
      for (const value of ["off", "on"] as const) {
        for (const [key, page] of await everyPage(value)) expect(page, `${value}, no table, ${key}`).toEqual(TODAY[key]);
      }
    });
    expect(Object.keys(TODAY)).toHaveLength(122);
  });

  it("answers every seats address with the site's 404, as an address the module does not know, reading nothing more", { timeout: 60_000 }, async () => {
    const c = await readers();
    for (const value of ["off", null] as const) {
      for (const cookie of [undefined, c.ultra, c.free]) {
        for (const [method, path] of SEATS_ROUTES) {
          // The unknown address's 404, in the same language.
          const known = recording();
          const notFound = await request("GET", `/account/nothing-here${path.endsWith("lang=fr") ? "?lang=fr" : ""}`,
            withSeats(onEnv({ ACCOUNTS: known.db }), value), cookie);
          expect(notFound.status).toBe(404);
          const r = recording();
          const res = await request(method, path, withSeats(onEnv({ ACCOUNTS: r.db }), value), cookie, { csrf: "0".repeat(32), email: "someone@example.com" });
          expect(res, `${value} ${method} ${path}`).toEqual(notFound);
          // The same statements as the unknown address's 404 (its rail reads the session), never one that names the seats alone.
          expect([...r.sent].sort(), `${value} ${method} ${path}`).toEqual([...known.sent].sort());
          expect(r.sent, `${method} ${path}`).not.toContain("SELECT 1 AS x FROM seats LIMIT 1");
        }
      }
    }
  });

  it("writes nothing and sends nothing for an invitation posted from an Ultra account's own page", async () => {
    const c = await readers();
    const env = onEnv();
    const token = await csrf(c.ultra!, "/account", { env });
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const before = await counts();
    const res = await post("/account/seats/invite", { csrf: token, email: "invited-off@example.com", message_lang: "en" }, { cookie: c.ultra, env });
    expect(res.status).toBe(404);
    expect(await counts()).toEqual(before);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sent_mail WHERE to_addr = ?").bind("invited-off@example.com").first()).toEqual({ n: 0 });
  });

  it("counts the seats' addresses as pages, and in their own buckets only while it is on", async () => {
    const keys: string[] = [];
    const keeper = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } as unknown as RateLimit;
    const limiters = { PAGE_LIMIT: keeper, FORM_LIMIT: keeper, EDIT_LIMIT: keeper, STOP_LIMIT: keeper };
    const ip = "203.0.113.201";
    const send = (method: string, path: string, env: object) => app.request(path, {
      method, headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": ip, origin: "http://localhost" },
      ...(method === "POST" ? { body: "" } : {}),
    }, env);
    const cases: [string, string, string][] = [
      ["POST", "/account/seats/invite", "form"], ["POST", "/account/seats/join", "form"], ["GET", "/account/seats/join", "stop"],
      ["POST", `/account/seats/${"a".repeat(32)}/cancel`, "edit"], ["POST", `/account/seats/${"a".repeat(32)}/remove`, "edit"],
      ["POST", "/account/seat/leave", "edit"], ["GET", "/account/seats", "page"],
    ];
    for (const [method, path, bucket] of cases) {
      for (const [value, want] of [["off", "page"], [null, "page"], ["on", bucket]] as const) {
        keys.length = 0;
        await send(method, path, withSeats({ ...onEnv(), ...limiters }, value));
        expect(keys, `${value} ${method} ${path}`).toEqual([`${want}:${ip}`]);
      }
    }
  });
});

// The pages the switch reaches, of the 122: those with plan cards (/pro for every reader, the billing page for
// every account, the landing page signed out, the saved views' gate for Free, the dashboard's tease for Free and
// Pro while Ultra is on sale and the address is open to them), the privacy page for every reader, the Terms while
// Ultra is on sale, and an Ultra account's overview.
const EXPECTED_CHANGED: readonly string[] = [
  "base free /account/billing", "base free /account/billing?lang=fr", "base free /account/views", "base free /privacy", "base free /pro",
  "base out /", "base out /?lang=fr", "base out /privacy", "base out /privacy?lang=fr", "base out /pro", "base out /pro?lang=fr",
  "base pro /account/billing", "base pro /account/billing?lang=fr", "base pro /privacy", "base pro /pro",
  "base ultra /account", "base ultra /account/billing", "base ultra /account/billing?lang=fr", "base ultra /account?lang=fr", "base ultra /privacy",
  "base ultra /pro",
  "sale free /account/billing", "sale free /account/billing?lang=fr", "sale free /account/dashboard", "sale free /account/views", "sale free /privacy",
  "sale free /pro", "sale free /terms?lang=fr",
  "sale out /", "sale out /?lang=fr", "sale out /privacy", "sale out /privacy?lang=fr", "sale out /pro", "sale out /pro?lang=fr", "sale out /terms",
  "sale out /terms?lang=fr",
  "sale pro /account/billing", "sale pro /account/billing?lang=fr", "sale pro /account/dashboard", "sale pro /privacy", "sale pro /pro",
  "sale pro /terms?lang=fr",
  "sale ultra /account", "sale ultra /account/billing", "sale ultra /account/billing?lang=fr", "sale ultra /account?lang=fr", "sale ultra /privacy",
  "sale ultra /pro", "sale ultra /terms?lang=fr",
];

// What the switch adds to a page, as the page writes it (hono escapes these five characters in text).
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The page with every piece the switch adds taken out, each by its exact markup, so that what is left can be held
// to the capture: anything else the switch changed stays in and fails the comparison.
function unseated(body: string, lang: Lang, ultra: boolean): string {
  let out = body;
  // The plan cards' seats row, first on every card (src/pro.tsx SEATS_ROW), and the landing page's cards and lines.
  for (const plan of PLANS) {
    const words = esc(planLine(lang, seatsWording(plan)));
    out = out.replaceAll(`<li><svg class="plan-mark" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="${CHECK_PATH}"></path></svg><span>${words}</span></li>`, "");
    out = out.replaceAll(`<li><svg class="lp-ck" viewBox="0 0 16 16" aria-hidden="true"><path d="${CHECK_PATH}"></path></svg><span>${words}</span></li>`, "");
  }
  out = out.replace(/--plan-rows:(\d+);--plan-card-rows:(\d+)/g, (_, rows: string, all: string) => `--plan-rows:${Number(rows) - 1};--plan-card-rows:${Number(all) - 1}`);
  const n = (v: number) => fmtInt(v, lang);
  const seats = (v: number) => t(lang, v === 1 ? "seats.seat_one" : "seats.seat_many", { n: n(v) });
  // /pro's Ultra text and its question, in the page and in its FAQ markup.
  const d = dashboardsWording("ultra");
  const ultraVars = {
    searches: n(RULES.ultra.saved_searches), watches: n(RULES.ultra.watchlists), years: n(planYears("ultra")), day: n(keyQuota("ultra")?.perDay ?? 0),
    dashboards: t(lang, d.key, d.vars?.(lang)), seats: seats(PLAN_SEATS.ultra), others: n(memberSeats("ultra")), keys: n(KEYS_MAX),
  };
  out = out.replace(esc(t(lang, "propage.ultra_text_seats", ultraVars)), esc(t(lang, "propage.ultra_text", ultraVars)));
  const q = t(lang, "propage.q_seats");
  const a = t(lang, "propage.a_seats", { pro_seats: seats(PLAN_SEATS.pro), ultra_seats: seats(PLAN_SEATS.ultra), others: n(memberSeats("ultra")) });
  out = out.replace(`<h3>${esc(q)}</h3><p>${esc(a)}</p>`, "");
  out = out.replace(`,${scriptJson({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })}`, "");
  // The Terms' Seats section and the abuse paragraph that names a seat.
  const terms = {
    pro_seats: seats(PLAN_SEATS.pro), ultra_seats: seats(PLAN_SEATS.ultra), others: n(memberSeats("ultra")), days: n(SEAT_INVITE_DAYS),
    joins: n(joinsAllowed("ultra")), window: n(SEAT_WINDOW_DAYS), devices: n(SESSIONS_MAX),
  };
  out = out.replace(`<h3>${esc(t(lang, "terms.pro_seats_title"))}</h3><p>${esc(t(lang, "terms.pro_seats", terms))}</p>`, "");
  out = out.replace(esc(t(lang, "terms.pro_abuse_seats")), esc(t(lang, "terms.pro_abuse_ultra")));
  // The privacy page's paragraph.
  out = out.replace(`<p>${esc(t(lang, "seats.privacy", { days: n(SEAT_KEEP_DAYS) }))}</p>`, "");
  // An Ultra account's Seats row on the overview and Seats link on the billing page (slice C1).
  if (ultra) {
    out = out.replace(lang === "fr" ? '<dt>Sièges</dt><dd><a href="/account/seats">1 siège sur 5</a></dd>' : '<dt>Seats</dt><dd><a href="/account/seats">1 of 5 seats</a></dd>', "");
    out = out.replace(`<a href="/account/seats" class="btn">${lang === "fr" ? "Sièges" : "Seats"}</a>`, "");
  }
  return out;
}

describe("with the switch on and the table there", () => {
  it("adds to each page of a reader who gives and holds no seat what the switch draws and nothing else: taken out, every page is main's", { timeout: 180_000 }, async () => {
    const c = await readers();
    const changed: string[] = [];
    for (const name of Object.keys(ENVS) as EnvName[]) {
      for (const reader of READERS) {
        for (const path of pagesOf(reader)) {
          const key = `${name} ${reader} ${path}`;
          const headers: Record<string, string> = { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() };
          if (c[reader]) headers.cookie = c[reader]!;
          const res = await app.request(path, { headers }, withSeats(ENVS[name](), "on"));
          const body = await res.text();
          const lang: Lang = path.includes("lang=fr") ? "fr" : "en";
          const page = { status: res.status, cache: res.headers.get("cache-control"), cookie: res.headers.getSetCookie().length > 0, body: await shortHash(unseated(body, lang, reader === "ultra"), path) };
          expect(page, key).toEqual(TODAY[key]);
          if ((await shortHash(body, path)) !== TODAY[key].body) changed.push(key);
        }
      }
    }
    // What the switch reaches: every page with plan cards, /pro, the Terms while Ultra is on sale, the privacy page,
    // and an Ultra account's overview and billing page; nothing else.
    expect(changed.sort()).toEqual(EXPECTED_CHANGED);
    expect(emailOf("ultra")).toContain("@example.com");
  });
});
