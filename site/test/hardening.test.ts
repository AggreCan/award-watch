// Adversarial checks of the paid side: attempts to get the paid view, a paid
// feature or the databases without a paid entitlement, each kept as a test.
// The same-day notices band against every kind of cookie that is not a live
// Pro session; the hosted search against text meant to reach the intraday
// rows that share its database; caching and conditional requests between a
// paid rendering and a free one; sessions, codes, links and CSRF values;
// API keys through a database outage; the switch over every route the
// account router holds; and secrets in the source, the public files and the
// workflows. Real local D1 databases throughout; the bindings a test means
// to watch are wrapped so every statement they run is recorded.
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { apiKeyOf, forgetKeys, requireApiKey } from "../src/account/api_keys";
import { account } from "../src/account/routes";
import { sha256Hex } from "../src/account/secrets";
import { SESSION_COOKIE, forgetSessions } from "../src/account/session";
import { CODES_PER_HOUR, CODE_TRIES } from "../src/account/signin";
import { api } from "../src/api";
import type { AppEnv } from "../src/env";
import { app } from "../src/index";
import { INTRADAY_SQL } from "../src/intraday";
import {
  ANY_ROW_SQL, BUYER_COUNT_SQL, BUYER_ROWS, BUYER_SELECT_SQL, MAX_PAGE, ORG_COUNT_SQL, ORG_SELECT_SQL, PAGE_SIZE, foldText,
} from "../src/search_db";
import wranglerConfig from "../wrangler.jsonc?raw";
import {
  ACCOUNTS, DB, csrf, get, grantPro, newEmail, nextIp, onEnv, post, requestCode, sessionCookie, signIn, useAccountsDb, userId,
} from "./accounts-helpers";
import { applySql } from "./setup";

useAccountsDb();

const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const SEARCH_SCHEMA = (env as unknown as { SEARCH_SCHEMA_SQL: string }).SEARCH_SCHEMA_SQL;
const INTRADAY_SCHEMA = (env as unknown as { INTRADAY_SCHEMA_SQL: string }).INTRADAY_SCHEMA_SQL;

// One same-day notice, read after the fixtures' data date (2026-10-31), with
// strings no published file holds, so any page that shows one of them has
// read the paid rows.
const PAID = { reference: "cb-777-77700001", title: "Quokka habitat survey, paid view only", buyer: "Paid View Supply Office" };
const PAID_STRINGS = [PAID.reference, PAID.title, PAID.buyer, "habitat survey"];
// An organization in the search tables whose name shares a word with the paid notice.
const ORG = { id: "org-q000000001", name: "Quokka Survey Services Ltd" };

beforeAll(async () => {
  await applySql(SEARCH, SEARCH_SCHEMA);
  await applySql(SEARCH, INTRADAY_SCHEMA);
  await SEARCH.prepare(
    "INSERT OR REPLACE INTO intraday_tenders (reference, amendment, seen_at, published, closing, title_en, title_fr, buyer_id, " +
    "buyer_name, category, segments, provinces, codes) VALUES (?, 0, '2026-10-31T15:45:10Z', '2026-10-31', '2026-11-20T14:00:00', ?, ?, " +
    "NULL, ?, '[\"SRV\"]', '[\"72\"]', '[\"MB\"]', '[]')",
  ).bind(PAID.reference, PAID.title, PAID.title, PAID.buyer).run();
  await SEARCH.prepare(
    "INSERT OR REPLACE INTO search_orgs (id, name, alt, bn, folds, prov, city, n_awards, n_history, n_contracts, n_grants, " +
    "n_lobbying, n_records, total_awards, total_history, total_contracts, total_grants, hash) " +
    "VALUES (?, ?, '', '', ?, 'MB', 'Brandon', 1, 0, 0, 0, 0, 1, 1000, NULL, NULL, NULL, 'h')",
  ).bind(ORG.id, ORG.name, foldText(ORG.name)).run();
});

afterEach(() => {
  vi.useRealTimers();
});

// -- recording bindings -----------------------------------------------------------

// A D1 binding that runs everything on the real one and records the SQL text
// of every statement prepared and the values of every bind. Statements go to
// batch() as the real objects, which the runtime requires.
type Recorder = { db: D1Database; sql: string[]; binds: unknown[][] };

function recording(real: D1Database): Recorder {
  const sql: string[] = [];
  const binds: unknown[][] = [];
  const targets = new WeakMap<object, D1PreparedStatement>();
  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") {
          return (...values: unknown[]) => {
            binds.push(values);
            return target.bind(...values);
          };
        }
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    targets.set(proxy, stmt);
    return proxy;
  };
  const db = {
    prepare: (q: string) => {
      sql.push(q);
      return wrap(real.prepare(q));
    },
    batch: (stmts: D1PreparedStatement[]) => real.batch(stmts.map((s) => targets.get(s) ?? s)),
    exec: (q: string) => {
      sql.push(q);
      return real.exec(q);
    },
  } as unknown as D1Database;
  return { db, sql, binds };
}

// A binding that notes every use and throws: proof that nothing read it.
function trap<T>(what: string): { used: string[]; binding: T } {
  const used: string[] = [];
  const binding = new Proxy({}, {
    get(_t, prop) {
      used.push(String(prop));
      throw new Error(`${what} was used`);
    },
  }) as T;
  return { used, binding };
}

// The accounts database down: every statement fails.
const broken = {
  prepare: () => { throw new Error("D1_ERROR: database unavailable"); },
  batch: () => { throw new Error("D1_ERROR: database unavailable"); },
} as unknown as D1Database;

// -- the band ---------------------------------------------------------------------

const BAND = /<section class="panel intraday">[\s\S]*?<\/section>/;
const RAIL_ACCOUNT = /<li><a class="rail-item rail-account"[^>]*><span class="rail-label">[^<]*<\/span><\/a><\/li>/;
const BAND_PAGES = ["/tenders", "/tenders/new", "/tenders?lang=fr", "/tenders/new?lang=fr"];

type Rendered = { status: number; cache: string | null; etag: string | null; cookies: string[]; body: string; sql: string[] };

async function render(path: string, cookie?: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<Rendered> {
  const search = recording(SEARCH);
  const res = await get(path, { cookie, env: onEnv({ SEARCH: search.db, ...extra }), headers });
  return {
    status: res.status, cache: res.headers.get("cache-control"), etag: res.headers.get("etag"), cookies: res.headers.getSetCookie(),
    body: await res.text(), sql: search.sql,
  };
}

const intradayReads = (r: Rendered) => r.sql.filter((q) => /intraday/i.test(q));
const showsPaid = (body: string) => PAID_STRINGS.some((s) => body.includes(s)) || BAND.test(body);
const cookieParts = (cookie: string) => {
  const [id, secret] = cookie.slice(SESSION_COOKIE.length + 1).split(".");
  return { id, secret };
};

async function proSession(tag: string, endsAt: string | null = null): Promise<{ email: string; cookie: string }> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  await grantPro(email, endsAt);
  return { email, cookie };
}

describe("the same-day band, for a request that is not a live Pro session", () => {
  it("is drawn for a live Pro session, private and never stored (the control for every test below)", async () => {
    const { cookie } = await proSession("band-pro");
    for (const path of ["/tenders", "/tenders/new", "/tenders?lang=fr"]) {
      const r = await render(path, cookie);
      expect(r.status, path).toBe(200);
      expect(BAND.exec(r.body)?.[0] ?? "", path).toContain(PAID.title);
      expect(r.cache, path).toBe("private, no-store");
      expect(r.sql, path).toContain(INTRADAY_SQL);
    }
  });

  it("is the free page byte for byte, with no read of the intraday rows, for every cookie that does not stand", async () => {
    const pro = await proSession("band-forge");
    const other = await proSession("band-other");
    const { id, secret } = cookieParts(pro.cookie);
    const { secret: otherSecret } = cookieParts(other.cookie);
    const forged: [string, string][] = [
      ["random, right shape", `${SESSION_COOKIE}=${"a1".repeat(16)}.${"b2".repeat(32)}`],
      ["a live session's id, a made-up secret", `${SESSION_COOKIE}=${id}.${"0".repeat(64)}`],
      ["a live session's id, another live session's secret", `${SESSION_COOKIE}=${id}.${otherSecret}`],
      ["the session id alone", `${SESSION_COOKIE}=${id}`],
      ["the secret alone", `${SESSION_COOKIE}=${secret}`],
      ["upper-case hex", `${SESSION_COOKIE}=${id.toUpperCase()}.${secret.toUpperCase()}`],
      ["a trailing extra", `${SESSION_COOKIE}=${id}.${secret}.x`],
      ["the CSRF value as a cookie", `${SESSION_COOKIE}=${await csrf(pro.cookie)}`],
      ["the name before the prefix", `aw_session=${id}.${secret}`],
      ["empty", `${SESSION_COOKIE}=`],
    ];
    for (const path of BAND_PAGES) {
      const free = await render(path);
      expect(free.body, path).not.toMatch(BAND);
      expect(intradayReads(free), path).toEqual([]);
      for (const [what, cookie] of forged) {
        const r = await render(path, cookie);
        expect(r.body, `${path}: ${what}`).toBe(free.body);
        expect([r.status, r.cache, r.etag, r.cookies], `${path}: ${what}`).toEqual([free.status, free.cache, free.etag, free.cookies]);
        expect(r.sql, `${path}: ${what}`).toEqual([]);
      }
    }
  });

  it("is the free page byte for byte for an expired, revoked, signed-out or deleted session that was Pro", async () => {
    const at = new Date().toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    const expired = await proSession("band-expired");
    await ACCOUNTS.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?").bind(past, await userId(expired.email)).run();
    const revoked = await proSession("band-revoked");
    await ACCOUNTS.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").bind(at, await userId(revoked.email)).run();
    const signedOut = await proSession("band-out");
    expect((await post("/account/sign-out", { csrf: await csrf(signedOut.cookie) }, { cookie: signedOut.cookie })).status).toBe(303);
    const deleted = await proSession("band-deleted");
    expect((await post("/account/delete", { csrf: await csrf(deleted.cookie), confirm: "yes" }, { cookie: deleted.cookie })).status).toBe(200);
    for (const path of BAND_PAGES) {
      const free = await render(path);
      for (const [what, s] of Object.entries({ expired, revoked, signedOut, deleted })) {
        const r = await render(path, s.cookie);
        expect(r.body, `${path}: ${what}`).toBe(free.body);
        expect(r.cache, `${path}: ${what}`).toBe(free.cache);
        expect(intradayReads(r), `${path}: ${what}`).toEqual([]);
      }
    }
  });

  it("is the free page, with the reader's own address in the rail, for a Free plan and for a Pro entitlement revoked, ended, not begun or replaced", async () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const free = { email: newEmail("band-free"), cookie: "" };
    free.cookie = await signIn(free.email);
    const revoked = await proSession("band-ent-revoked");
    await ACCOUNTS.prepare("UPDATE entitlements SET revoked_at = ? WHERE user_id = ?").bind(iso(now), await userId(revoked.email)).run();
    const ended = await proSession("band-ent-ended");
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(iso(now - 1000), await userId(ended.email)).run();
    const later = { email: newEmail("band-ent-later"), cookie: "" };
    later.cookie = await signIn(later.email);
    await ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (lower(hex(randomblob(16))), ?, 'pro', 'manual', ?, NULL, 'not begun', ?)",
    ).bind(await userId(later.email), iso(now + 86_400_000), iso(now)).run();
    const replaced = await proSession("band-ent-replaced");
    await ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (lower(hex(randomblob(16))), ?, 'free', 'manual', ?, NULL, 'downgrade', ?)",
    ).bind(await userId(replaced.email), iso(now - 1000), iso(now + 5000)).run();
    // The plan cache on users says Pro with no entitlement behind it: the rows decide, so it grants nothing.
    const cached = { email: newEmail("band-cache"), cookie: "" };
    cached.cookie = await signIn(cached.email);
    await ACCOUNTS.prepare("UPDATE users SET plan = 'pro', plan_until = NULL WHERE email = ?").bind(cached.email).run();
    // The rail's account item and the plan subscript after the wordmark are the
    // only marks of a session on a free page.
    const normal = (body: string) => body.replace(RAIL_ACCOUNT, "<li>[account]</li>")
      .replace(/<span class="brand-plan brand-plan-(?:free|pro)">[^<]*<\/span>/, "");
    for (const path of BAND_PAGES) {
      const anonymous = await render(path);
      for (const [what, s] of Object.entries({ free, revoked, ended, later, replaced, cached })) {
        const r = await render(path, s.cookie);
        expect(r.body, `${path}: ${what}`).toContain(`<span class="rail-label">${s.email}</span>`);
        expect(normal(r.body), `${path}: ${what}`).toBe(normal(anonymous.body));
        expect(showsPaid(r.body), `${path}: ${what}`).toBe(false);
        expect(intradayReads(r), `${path}: ${what}`).toEqual([]);
        expect(r.cache, `${path}: ${what}`).toBe("private, no-store");
      }
    }
  });

  it("through an outage keeps a session this isolate verified, never one it did not, and never a plan past its end", async () => {
    forgetSessions();
    // Inside the hour a remembered session is trusted through an outage.
    const ends = new Date(Date.now() + 30 * 60_000).toISOString();
    const { email, cookie } = await proSession("band-outage", ends);
    const down = { ACCOUNTS: broken };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Not verified here yet: the free view.
      const unseen = await render("/tenders", cookie, down);
      expect(showsPaid(unseen.body)).toBe(false);
      expect(intradayReads(unseen)).toEqual([]);
      // Verified once, then the database goes: the last known plan, as the posture says.
      expect(showsPaid((await render("/tenders", cookie)).body)).toBe(true);
      const during = await render("/tenders", cookie, down);
      expect(showsPaid(during.body)).toBe(true);
      expect(during.cache).toBe("private, no-store");
      // The known session's id with another secret is no one.
      const { id } = cookieParts(cookie);
      const forged = await render("/tenders", `${SESSION_COOKIE}=${id}.${"0".repeat(64)}`, down);
      expect(forged.body).toBe((await render("/tenders", undefined, down)).body);
      expect(forged.sql).toEqual([]);
      // Past the entitlement's own end, which this isolate knows without the database: free.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.parse(ends) + 60_000);
      const ended = await render("/tenders", cookie, down);
      expect(ended.body).toContain(`<span class="rail-label">${email}</span>`);
      expect(showsPaid(ended.body)).toBe(false);
      expect(intradayReads(ended)).toEqual([]);
    } finally {
      vi.useRealTimers();
      error.mockRestore();
    }
  });

  it("keeps a revocation this isolate has read through a later outage; one made elsewhere is unseen only while the database cannot say", async () => {
    forgetSessions();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = { ACCOUNTS: broken };
    try {
      const a = await proSession("band-revoke-read");
      expect(showsPaid((await render("/tenders", a.cookie)).body)).toBe(true);
      await ACCOUNTS.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), await userId(a.email)).run();
      const read = await render("/tenders", a.cookie);
      expect(showsPaid(read.body)).toBe(false);
      expect(read.body).not.toContain(a.email);
      const after = await render("/tenders", a.cookie, down);
      expect(showsPaid(after.body)).toBe(false);
      expect(after.body).not.toContain(a.email);
      // Revoked by another isolate (here: straight in the database) after this one
      // verified the session: while the database cannot be read this isolate
      // cannot know, which is the posture's accepted window (docs/accounts.md);
      // the first read that works ends it.
      const b = await proSession("band-revoke-elsewhere");
      expect(showsPaid((await render("/tenders", b.cookie)).body)).toBe(true);
      await ACCOUNTS.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), await userId(b.email)).run();
      expect(showsPaid((await render("/tenders", b.cookie, down)).body)).toBe(true);
      expect(showsPaid((await render("/tenders", b.cookie)).body)).toBe(false);
      expect(showsPaid((await render("/tenders", b.cookie, down)).body)).toBe(false);
    } finally {
      error.mockRestore();
    }
  });
});

// -- other readers of the paid rows -------------------------------------------------

// Every source file of the Worker, as text.
const SOURCES = import.meta.glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const PUBLIC_TEXT = import.meta.glob("../public/*.{js,txt,css}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const WORKFLOWS = import.meta.glob("../../.github/workflows/*.yml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// A file's code without its comments, so a comment that names the table is not a reader.
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the paid rows have one reader", () => {
  it("only src/intraday.ts names the table, only the band loads it, and only the two tender pages draw the band", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30);
    const naming = Object.keys(SOURCES).filter((f) => code(SOURCES[f]).includes("intraday_tenders"));
    expect(naming).toEqual(["../src/intraday.ts"]);
    const loading = Object.keys(SOURCES).filter((f) => /\bloadIntraday\(/.test(code(SOURCES[f])) && f !== "../src/intraday.ts");
    expect(loading).toEqual(["../src/pages/intraday.tsx"]);
    const drawing = Object.keys(SOURCES).filter((f) => /\bintradayBand\(/.test(code(SOURCES[f])) && f !== "../src/pages/intraday.tsx");
    expect(drawing).toEqual(["../src/pages/tenders.tsx"]);
    // The band asks the plan before it touches the binding.
    const band = SOURCES["../src/pages/intraday.tsx"];
    const fn = band.slice(band.indexOf("export async function intradayBand"));
    expect(fn.indexOf("allowsIntraday(await requestPlan(c))")).toBeGreaterThan(-1);
    expect(fn.indexOf("allowsIntraday(await requestPlan(c))")).toBeLessThan(fn.indexOf("c.env.SEARCH"));
  });

  it("never reach the API, the feeds, the home page or any other page, for a Pro session either", async () => {
    const { cookie } = await proSession("band-elsewhere");
    for (const path of ["/", "/api/stats", "/api/tenders/cb-777-77700001", `/tenders/${PAID.reference}`, "/data/feeds/canada/tenders.xml",
      "/awards", "/expiring", "/buyers/pwgsc-tpsgc", "/segments/72", "/feeds", "/watchlist", "/alerts", "/search?q=quokka+habitat",
      "/sitemap.xml", "/robots.txt", "/llms.txt"]) {
      const r = await render(path, cookie);
      expect(showsPaid(r.body.replaceAll(PAID.reference, "")), path).toBe(false);
      expect(intradayReads(r), path).toEqual([]);
    }
  });
});

// -- search ---------------------------------------------------------------------------

const SEARCH_SQL = new Set([ORG_COUNT_SQL, BUYER_COUNT_SQL, ORG_SELECT_SQL, BUYER_SELECT_SQL, ANY_ROW_SQL]);
const FILTER = String.raw`(?:(?:name|\{name name_fr\}) : )?`;
const PHRASE = String.raw`"[\p{L}\p{N}]+"\*?`;
const FTS_RE = new RegExp(`^${FILTER}${PHRASE}(?: ${FILTER}${PHRASE})*$`, "u");
const TIER_RE = /^\n[\p{L}\p{N} ]+(?:\n| )?$/u;

// Every bound value is a quoted-phrase expression, a tier pattern of folded
// words, or a number within the page caps.
function boundValueOk(v: unknown): boolean {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v <= Math.max(PAGE_SIZE, BUYER_ROWS, (MAX_PAGE - 1) * PAGE_SIZE);
  return typeof v === "string" && (FTS_RE.test(v) || TIER_RE.test(v));
}

const AIMED_AT_INTRADAY = [
  "intraday_tenders", "quokka habitat", `quokka" OR intraday_tenders MATCH "habitat`, "title_en : quokka", "{title_en excerpt_en}: quokka",
  "title_en:quokka", "quokka UNION SELECT title_en FROM intraday_tenders --", "'; SELECT * FROM intraday_tenders; --",
  "NEAR(quokka habitat, 1)", `"quokka`, `quokka"`, "(quokka", "quokka)", "quokka*", "^quokka", "quokka -habitat", "quokka NOT survey",
  "quokka AND habitat OR survey", "\u0000quokka", "quokka\nhabitat", "quokka\r\nhabitat", "q".repeat(10_000), "ｑｕｏｋｋａ", "QUOKKA",
  "quökka", "quokka 😀", "קווקה quokka", "quókka", "quokka ".repeat(50), "rowid", "search_orgs_fts", "sqlite_master",
  "cb-777-77700001", "Paid View Supply Office", "?", "?1", ":q", "@q", "$q", "%", "_", "\\", "char(10)", "x'00'",
];

async function search(path: string, cookie?: string): Promise<{ status: number; body: string; rec: Recorder; cookies: string[] }> {
  const rec = recording(SEARCH);
  const res = await get(path, { cookie, env: onEnv({ SEARCH: rec.db }) });
  return { status: res.status, body: await res.text(), rec, cookies: res.headers.getSetCookie() };
}

describe("the hosted search, which shares its database with the paid rows", () => {
  it("finds the organization and runs only its constant statements with checked values, whatever the text", async () => {
    const found = await search("/search?q=quokka");
    expect(found.status).toBe(200);
    expect(found.body).toContain(ORG.name);
    for (const q of AIMED_AT_INTRADAY) {
      const r = await search(`/search?q=${encodeURIComponent(q)}`);
      const what = JSON.stringify(q.slice(0, 60));
      expect([200, 302], what).toContain(r.status);
      for (const sql of r.rec.sql) expect(SEARCH_SQL.has(sql), `${what}: ${sql.slice(0, 80)}`).toBe(true);
      for (const values of r.rec.binds) for (const v of values) expect(boundValueOk(v), `${what}: ${JSON.stringify(v)}`).toBe(true);
      expect(showsPaid(r.body.replaceAll(q, "")), what).toBe(false);
      expect(r.body, what).not.toContain("SQLITE");
      expect(r.body, what).not.toContain("D1_ERROR");
    }
  });

  it("is the same for a Pro session: the search never shows a same-day notice", async () => {
    const { cookie } = await proSession("search-pro");
    for (const q of ["quokka habitat", "habitat survey paid", PAID.reference, PAID.buyer]) {
      const r = await search(`/search?q=${encodeURIComponent(q)}`, cookie);
      for (const sql of r.rec.sql) expect(SEARCH_SQL.has(sql), q).toBe(true);
      expect(showsPaid(r.body.replaceAll(q, "").replaceAll(foldText(q), "")), q).toBe(false);
    }
  });

  it("reads ?page= as a bounded whole number and binds the offset as one", async () => {
    for (const page of ["-1", "0", "1e3", "99999", String(MAX_PAGE + 1), "2 OR 1=1", "1;DROP TABLE search_orgs", "0x10", "%00", "1.5", "", "１", "2"]) {
      const r = await search(`/search?q=quokka&page=${encodeURIComponent(page)}`);
      expect(r.status, page).toBe(200);
      for (const sql of r.rec.sql) expect(SEARCH_SQL.has(sql), page).toBe(true);
      for (const values of r.rec.binds) for (const v of values) expect(boundValueOk(v), `${page}: ${JSON.stringify(v)}`).toBe(true);
    }
    expect((await SEARCH.prepare("SELECT COUNT(*) AS n FROM search_orgs WHERE id = ?").bind(ORG.id).first<{ n: number }>())?.n).toBe(1);
  });

  it("takes ?lang= as en or fr only, and reflects nothing else", async () => {
    for (const lang of ["de", `fr'><script>alert(1)</script>`, "../", "FR", "fr,en", "fr\r\nSet-Cookie: x=1", ""]) {
      const r = await search(`/search?q=quokka&lang=${encodeURIComponent(lang)}`);
      expect(r.status, lang).toBe(200);
      expect(r.body, lang).toContain('<html lang="en"');
      expect(r.body, lang).not.toContain("<script>alert(1)");
      expect(r.cookies.filter((s) => s.startsWith("lang=")), lang).toEqual([]);
      expect(r.cookies.join("\n"), lang).not.toContain("x=1");
    }
  });
});

// -- caching and conditional requests ------------------------------------------------------

describe("caching between a paid rendering and a free one", () => {
  it("never answers 304 across the plans, and a 304 carries no body", async () => {
    const pro = await proSession("cache-pro");
    const freeEmail = newEmail("cache-free");
    const freeCookie = await signIn(freeEmail);
    for (const path of ["/tenders", "/tenders/new"]) {
      const paid = await render(path, pro.cookie);
      const anonymous = await render(path);
      const signedFree = await render(path, freeCookie);
      expect(paid.etag, path).toMatch(/^W\/"[0-9a-f]{40}"$/);
      expect(new Set([paid.etag, anonymous.etag, signedFree.etag]).size, path).toBe(3);
      // A free request naming the paid page's tag gets the free page, in full.
      const a = await render(path, undefined, {}, { "if-none-match": paid.etag! });
      expect([a.status, a.body], path).toEqual([200, anonymous.body]);
      const b = await render(path, freeCookie, {}, { "if-none-match": paid.etag! });
      expect(b.status, path).toBe(200);
      expect(showsPaid(b.body), path).toBe(false);
      // A paid request naming the free page's tag gets the paid page, in full.
      const c = await render(path, pro.cookie, {}, { "if-none-match": anonymous.etag! });
      expect(c.status, path).toBe(200);
      expect(showsPaid(c.body), path).toBe(true);
      // "*" answers 304 to anyone, with no body, and the paid one stays private.
      const star = await render(path, pro.cookie, {}, { "if-none-match": "*" });
      expect([star.status, star.body, star.cache], path).toEqual([304, "", "private, no-store"]);
      const starFree = await render(path, undefined, {}, { "if-none-match": "*" });
      expect([starFree.status, starFree.body], path).toEqual([304, ""]);
      // Its own tag: a 304 that keeps private, no-store.
      const own = await render(path, pro.cookie, {}, { "if-none-match": paid.etag! });
      expect([own.status, own.body, own.cache], path).toEqual([304, "", "private, no-store"]);
    }
  });

  it("marks every page drawn for a signed-in reader private and no-store, and every public page shared for five minutes", async () => {
    const { cookie } = await proSession("cache-every");
    for (const path of ["/", "/tenders", "/tenders/new", "/organizations/org-a000000001", "/search?q=quokka", "/nothing-here", "/privacy"]) {
      const signed = await render(path, cookie);
      expect(signed.cache, path).toBe("private, no-store");
      const anonymous = await render(path);
      expect(anonymous.cache, path).toBe(anonymous.status === 200 ? "public, max-age=300" : "no-store");
    }
  });
});

// -- sessions, codes and links ---------------------------------------------------------------

describe("sessions, codes and links", () => {
  it("set the cookie HttpOnly, Secure, SameSite=Lax, on the whole site, for 30 days, with no Domain, and clear it the same way", async () => {
    const email = newEmail("cookie");
    const { code } = await requestCode(email);
    const res = await post("/account/check", { email, code, sent: "1" });
    const set = res.headers.getSetCookie().find((s) => s.startsWith(`${SESSION_COOKIE}=`)) ?? "";
    expect(set).toMatch(new RegExp(`^${SESSION_COOKIE}=[0-9a-f]{32}\\.[0-9a-f]{64};`));
    for (const part of ["Max-Age=2592000", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(set.split("; ")).toContain(part);
    expect(set.toLowerCase()).not.toContain("domain=");
    const cookie = sessionCookie(res);
    const out = await post("/account/sign-out", { csrf: await csrf(cookie) }, { cookie });
    const cleared = out.headers.getSetCookie().find((s) => s.startsWith(`${SESSION_COOKIE}=`)) ?? "";
    for (const part of ["Max-Age=0", "Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) expect(cleared.split("; ")).toContain(part);
  });

  it("take a CSRF value that only the cookie's secret gives", async () => {
    const a = await signIn(newEmail("csrf-a"));
    const b = await signIn(newEmail("csrf-b"));
    const { id, secret } = cookieParts(a);
    const good = await csrf(a);
    expect(good).toBe((await sha256Hex(`csrf\n${secret}`)).slice(0, 32));
    const refused = [
      ["another session's value", await csrf(b)], ["from the session id", (await sha256Hex(`csrf\n${id}`)).slice(0, 32)],
      ["the secret itself", secret.slice(0, 32)], ["the id itself", id], ["empty", ""], ["one short", good.slice(0, 31)],
      ["upper case", good.toUpperCase()], ["the whole hash", await sha256Hex(`csrf\n${secret}`)],
    ];
    // A Free account's key post is a 403 whatever the value, so the probe is a
    // post whose right value answers 303: deleting a saved search.
    const target = "/account/searches/0123456789abcdef0123456789abcdef/delete";
    for (const [what, value] of refused) {
      const res = await post(target, { csrf: value }, { cookie: a });
      expect(res.status, what).toBe(403);
    }
    expect((await post(target, {}, { cookie: a })).status).toBe(403);
    expect((await post(target, { csrf: good }, { cookie: a })).status).toBe(303);
    // The value is on the account's own pages only, never on a public one.
    expect(await (await get("/tenders", { cookie: a })).text()).not.toContain(good);
    expect((await post("/account/sign-out", { csrf: good }, { cookie: a })).status).toBe(303);
  });

  it("answer an address with an account and one without by the same statements, status, page and headers", async () => {
    const known = newEmail("enum-known");
    await signIn(known);
    const unknown = newEmail("enum-unknown");
    const runs: { sql: string[]; status: number; body: string; cookies: string[]; cache: string | null }[] = [];
    for (const email of [known, unknown]) {
      const rec = recording(ACCOUNTS);
      const res = await post("/account/sign-in", { email }, { env: onEnv({ ACCOUNTS: rec.db }) });
      runs.push({
        sql: rec.sql, status: res.status, body: (await res.text()).split(email).join("EMAIL"), cookies: res.headers.getSetCookie(),
        cache: res.headers.get("cache-control"),
      });
    }
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0].status).toBe(200);
    // The same answer once the hour's codes are spent, account or not.
    const statuses = async (email: string) => {
      const out: number[] = [];
      for (let i = 0; i < CODES_PER_HOUR + 1; i++) out.push((await post("/account/sign-in", { email })).status);
      return out;
    };
    const k2 = newEmail("enum-known2");
    await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (lower(hex(randomblob(16))), ?, ?, 'en', 'active', 'free')")
      .bind(k2, new Date().toISOString()).run();
    expect(await statuses(k2)).toEqual(await statuses(newEmail("enum-unknown2")));
  });

  it("make at most five codes an hour for an address, and send at most five messages, even from a burst of posts at once", async () => {
    const email = newEmail("burst");
    const n = 3 * CODES_PER_HOUR;
    const results = await Promise.all(Array.from({ length: n }, () => post("/account/sign-in", { email }, { ip: nextIp() })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(CODES_PER_HOUR);
    expect(statuses.filter((s) => s === 429)).toHaveLength(n - CODES_PER_HOUR);
    const rows = await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM magic_codes WHERE email = ?").bind(email).first<{ n: number }>();
    expect(rows?.n).toBe(CODES_PER_HOUR);
    const mails = await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sent_mail WHERE to_addr = ?").bind(email).first<{ n: number }>();
    expect(mails?.n).toBe(CODES_PER_HOUR);
  });

  it("count every wrong code of a burst, so the right code after it is refused", async () => {
    const email = newEmail("guess-burst");
    const { code, token } = await requestCode(email);
    const wrong = code === "000000" ? "000001" : "000000";
    await Promise.all(Array.from({ length: 3 * CODE_TRIES }, () => post("/account/check", { email, code: wrong }, { ip: nextIp() })));
    const row = await ACCOUNTS.prepare("SELECT attempts, used_at FROM magic_codes WHERE email = ?").bind(email).first<{ attempts: number; used_at: string | null }>();
    expect(row?.attempts).toBeGreaterThanOrEqual(CODE_TRIES);
    expect(row?.used_at).toBeNull();
    const right = await post("/account/check", { email, code, sent: "1" });
    expect(right.status).toBe(400);
    expect(right.headers.getSetCookie().join("")).not.toContain(SESSION_COOKIE);
    // The link of the locked request is refused as well.
    const link = await post("/account/check", { token });
    expect(link.status).toBe(400);
    expect(link.headers.getSetCookie().join("")).not.toContain(SESSION_COOKIE);
  });

  it("treat the link as a secret: a GET uses nothing, the page is never stored, and the token signs in once and only its own request", async () => {
    const email = newEmail("link");
    const first = await requestCode(email);
    const second = await requestCode(email);
    expect(first.token).not.toBe(second.token);
    for (const method of ["GET", "HEAD"]) {
      const res = await app.request(`/account/check?token=${first.token}`, { method, headers: { "cf-connecting-ip": nextIp() } }, onEnv());
      expect(res.status, method).toBe(200);
      expect(res.headers.get("cache-control"), method).toBe("no-store");
      expect(res.headers.get("referrer-policy"), method).toBe("strict-origin-when-cross-origin");
      expect(res.headers.getSetCookie(), method).toEqual([]);
    }
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM magic_codes WHERE email = ? AND used_at IS NULL AND attempts = 0").bind(email).first<{ n: number }>())?.n).toBe(2);
    // One request's id with the other's secret is no token.
    const [id1] = first.token.split(".");
    const [, secret2] = second.token.split(".");
    const swapped = await post("/account/check", { token: `${id1}.${secret2}` });
    expect(swapped.status).toBe(400);
    expect(swapped.headers.getSetCookie().join("")).not.toContain(SESSION_COOKIE);
    for (const bad of [first.token.toUpperCase(), `${first.token}0`, first.token.slice(0, -1), id1, `${id1}.`]) {
      expect((await post("/account/check", { token: bad })).status, bad).toBe(400);
    }
    // The right token signs in; the Location names no token.
    const ok = await post("/account/check", { token: first.token });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location") ?? "").not.toContain(first.token.split(".")[1]);
    // Using one closes the other, and a token works once.
    expect((await post("/account/check", { token: second.token })).status).toBe(400);
    expect((await post("/account/check", { token: first.token })).status).toBe(400);
    // The code of a used request is refused too.
    expect((await post("/account/check", { email, code: first.code })).status).toBe(400);
  });

  it("accept no session id alone, on an account page or a public one", async () => {
    const cookie = await signIn(newEmail("id-alone"));
    const { id } = cookieParts(cookie);
    const res = await get("/account", { cookie: `${SESSION_COOKIE}=${id}` });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/sign-in");
    expect(await (await get("/tenders", { cookie: `${SESSION_COOKIE}=${id}` })).text()).toContain('href="/account/sign-in"');
  });
});

// -- API keys ----------------------------------------------------------------------------------------

// Mounted under the real /api sub-app, the shape phase 3 will use: the
// sub-app marks a response without a rule public for five minutes, which a
// keyed answer must never be. The site's own app copied its routes from api
// when it was built, so this route is on the probe alone.
api.get("/hardening-probe", requireApiKey(), (c) => c.json({ holder: apiKeyOf(c) ?? null }));
const probe = new Hono<AppEnv>();
probe.route("/api", api);
const callKey = (e: object, headers: Record<string, string> = {}) => probe.request("/api/hardening-probe", { headers }, e);

async function proKey(tag: string, endsAt: string | null = null): Promise<{ email: string; key: string }> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  await grantPro(email, endsAt);
  const html = await (await post("/account/keys", { csrf: await csrf(cookie), name: "probe" }, { cookie })).text();
  return { email, key: /(aw_[0-9a-f]{8}_[0-9a-f]{64})/.exec(html)![1] };
}

describe("API keys", () => {
  it("send a keyed answer private and no-store, under the sub-app that marks the others public", async () => {
    const { key } = await proKey("key-cache");
    const res = await callKey(onEnv(), { authorization: `Bearer ${key}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    for (const refused of [{}, { authorization: "Bearer nope" }] as Record<string, string>[]) {
      expect((await callKey(onEnv(), refused)).headers.get("cache-control")).toBe("no-store");
    }
    // The site's own API keeps its public rule.
    expect((await get("/api/stats")).headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("answer 503 through an outage for a key this isolate has not verified, made up or real", async () => {
    forgetKeys();
    const { key } = await proKey("key-unseen");
    const made = `aw_${"0f".repeat(4)}_${"e1".repeat(32)}`;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const k of [made, key, `${key.slice(0, 12)}${"9".repeat(64)}`.slice(0, key.length)]) {
        for (const headers of [{ authorization: `Bearer ${k}` }, { "x-api-key": k }] as Record<string, string>[]) {
          const res = await callKey(onEnv({ ACCOUNTS: broken }), headers);
          expect(res.status, k.slice(0, 12)).toBe(503);
          expect(res.headers.get("cache-control")).toBe("no-store");
          expect(res.headers.get("retry-after")).toBe("60");
          expect(JSON.stringify(await res.json())).not.toContain("holder");
        }
      }
      expect(error.mock.calls.flat().join(" ")).not.toContain(key);
    } finally {
      error.mockRestore();
    }
  });

  it("keep a key this isolate verified through an outage, until a read refuses it or its plan ends", async () => {
    forgetKeys();
    // Inside the hour a remembered key is trusted through an outage.
    const ends = new Date(Date.now() + 30 * 60_000).toISOString();
    const { email, key } = await proKey("key-known", ends);
    const headers = { authorization: `Bearer ${key}` };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await callKey(onEnv(), headers)).status).toBe(200);
      const res = await callKey(onEnv({ ACCOUNTS: broken }), headers);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const { holder } = (await res.json()) as { holder: { userId: string; keyId: string; stale?: boolean } };
      expect(holder.userId).toBe(await userId(email));
      expect(holder.keyId).toMatch(/^[0-9a-f]{32}$/);
      expect(holder.stale).toBe(true);
      // The same prefix with another secret is not the key this isolate knows.
      const other = `${key.slice(0, 12)}${key.slice(12).replace(/./g, (ch) => (ch === "a" ? "b" : "a"))}`;
      expect((await callKey(onEnv({ ACCOUNTS: broken }), { authorization: `Bearer ${other}` })).status).toBe(503);
      // Past the plan's end, which this isolate knows without the database: 403.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.parse(ends) + 60_000);
      expect((await callKey(onEnv({ ACCOUNTS: broken }), headers)).status).toBe(403);
      vi.useRealTimers();
      // Revoked: refused on the next read, and the outage after it does not bring it back.
      await ACCOUNTS.prepare("UPDATE api_keys SET revoked_at = ? WHERE prefix = ?").bind(new Date().toISOString(), key.slice(3, 11)).run();
      expect((await callKey(onEnv(), headers)).status).toBe(401);
      expect((await callKey(onEnv({ ACCOUNTS: broken }), headers)).status).toBe(503);
    } finally {
      vi.useRealTimers();
      error.mockRestore();
    }
  });

  it("refuse a Free account's key, and remember the refusal through an outage", async () => {
    forgetKeys();
    const { email, key } = await proKey("key-downgrade");
    await ACCOUNTS.prepare("UPDATE entitlements SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), await userId(email)).run();
    const headers = { "x-api-key": key };
    expect((await callKey(onEnv(), headers)).status).toBe(403);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await callKey(onEnv({ ACCOUNTS: broken }), headers)).status).toBe(403);
    } finally {
      error.mockRestore();
    }
  });
});

// -- the switch -------------------------------------------------------------------------------------

// Every route the account router holds, read from the router itself, so a
// route added later (the stop route, the payment notices) is covered without
// a list to keep: a parameter becomes a well-formed id, and a route for every
// method is tried with each.
function accountRequests(): [string, string][] {
  const out: [string, string][] = [];
  for (const r of account.routes) {
    if (r.path === "/*") continue;
    const path = `/account${r.path === "/" ? "" : r.path.replace(/:[A-Za-z_]+(\{[^}]*\})?/g, "0123456789abcdef0123456789abcdef")}`;
    const methods = r.method === "ALL" ? ["GET", "POST", "PUT", "DELETE", "PATCH"] : r.method === "GET" ? ["GET", "HEAD"] : [r.method];
    for (const m of methods) out.push([m, path]);
  }
  return out;
}

describe("the switch, off", () => {
  it("answers every route the account router holds with the site's 404, touching no accounts, mail or search binding", async () => {
    const requests = accountRequests();
    expect(requests.length).toBeGreaterThanOrEqual(20);
    const db = trap<D1Database>("the accounts database");
    const mail = trap<SendEmail>("the mail binding");
    const search = trap<D1Database>("the search database");
    const off = { ...onEnv({ ACCOUNTS: db.binding, MAIL: mail.binding, SEARCH: search.binding }), ACCOUNTS_ENABLED: "false" };
    const { cookie } = await proSession("switch-off");
    const notFound = await (await app.request("/nothing-here", { headers: { "cf-connecting-ip": nextIp() } }, off)).text();
    for (const [method, path] of requests) {
      const init: RequestInit = { method, headers: { "cf-connecting-ip": nextIp(), cookie, origin: "http://localhost" } };
      if (!["GET", "HEAD"].includes(method)) {
        init.headers = { ...(init.headers as Record<string, string>), "content-type": "application/x-www-form-urlencoded" };
        init.body = new URLSearchParams({ email: newEmail("off"), code: "123456", csrf: "0".repeat(32), confirm: "yes" }).toString();
      }
      const res = await app.request(path, init, off);
      expect(res.status, `${method} ${path}`).toBe(404);
      if (method !== "HEAD") expect(await res.text(), `${method} ${path}`).toBe(notFound);
    }
    // The paid band's pages with a Pro session's cookie: nothing read either.
    for (const path of BAND_PAGES) {
      const res = await app.request(path, { headers: { "cf-connecting-ip": nextIp(), cookie } }, off);
      expect(res.status, path).toBe(200);
      expect(showsPaid(await res.text()), path).toBe(false);
    }
    expect(db.used).toEqual([]);
    expect(mail.used).toEqual([]);
    expect(search.used).toEqual([]);
  });
});

// -- headers on the account pages -----------------------------------------------------------------------

describe("the account pages' headers", () => {
  it("are no-store on every answer, noindex on every page, and never framed", async () => {
    const email = newEmail("headers");
    const { code, token } = await requestCode(email);
    const signedIn = await post("/account/check", { email, code, sent: "1" });
    const cookie = sessionCookie(signedIn);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const answers: [string, Response][] = [];
    try {
      answers.push(
        ["GET sign-in", await get("/account/sign-in")],
        ["GET check with a token", await get(`/account/check?token=${token}`)],
        ["GET check with a bad token", await get("/account/check?token=bad")],
        ["POST sign-in honeypot", await post("/account/sign-in", { email, website: "x" })],
        ["POST sign-in from another site", await post("/account/sign-in", { email }, { origin: "https://example.com" })],
        ["POST check wrong", await post("/account/check", { email, code: "999999" })],
        ["POST check right", signedIn],
        ["GET account without a session", await get("/account")],
        ["GET account", await get("/account", { cookie })],
        ["GET keys", await get("/account/keys", { cookie })],
        ["POST keys without CSRF", await post("/account/keys", { name: "x" }, { cookie })],
        ["GET billing", await get("/account/billing", { cookie })],
        ["GET account through an outage, unseen", await (async () => {
          forgetSessions();
          return get("/account", { cookie, env: onEnv({ ACCOUNTS: broken }) });
        })()],
      );
    } finally {
      error.mockRestore();
    }
    for (const [what, res] of answers) {
      expect(res.headers.get("cache-control"), what).toBe("no-store");
      expect(res.headers.get("x-robots-tag"), what).toBe("noindex, nofollow");
      expect(res.headers.get("x-frame-options"), what).toBe("DENY");
      expect(res.headers.get("content-security-policy") ?? "", what).toContain("frame-ancestors 'none'");
      expect(res.headers.get("content-security-policy") ?? "", what).toContain("form-action 'self'");
      if (res.status !== 404 && (res.headers.get("content-type") ?? "").startsWith("text/html")) {
        expect(await res.clone().text(), what).toContain('<meta name="robots" content="noindex"/>');
      }
    }
    expect(answers.map(([, r]) => r.status)).toEqual([200, 200, 400, 400, 403, 400, 303, 303, 200, 200, 403, 200, 503]);
  });
});

// -- secrets ------------------------------------------------------------------------------------------------

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const ROLE_ADDRESSES = new Set(["contact@awardwatch.ca", "alerts@awardwatch.ca"]);
const SECRET_SHAPES = [
  /aw_[0-9a-f]{8}_[0-9a-f]{64}/, /\bBearer [A-Za-z0-9._-]{20,}/, /\bsk_(?:live|test)_[A-Za-z0-9]+/, /\bwhsec_[A-Za-z0-9]+/,
  /\bghp_[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/,
];

describe("secrets and addresses", () => {
  it("are absent from the Worker's source and public files: no key, token or address but the site's two role addresses", () => {
    const files = { ...SOURCES, ...PUBLIC_TEXT, "../wrangler.jsonc": wranglerConfig };
    expect(Object.keys(PUBLIC_TEXT).length).toBeGreaterThan(5);
    for (const [file, text] of Object.entries(files)) {
      for (const shape of SECRET_SHAPES) expect(shape.test(text), `${file}: ${shape}`).toBe(false);
      for (const address of text.match(EMAIL_RE) ?? []) expect(ROLE_ADDRESSES.has(address), `${file}: ${address}`).toBe(true);
    }
  });

  it("are not wrangler.jsonc variables: the vars name the site's addresses and the switch, never a credential", () => {
    const vars = /"vars":\s*\{([\s\S]*?)\}/.exec(wranglerConfig)?.[1] ?? "";
    const names = [...vars.matchAll(/"([A-Z_]+)":/g)].map((m) => m[1]).sort();
    expect(names).toEqual(expect.arrayContaining(["ACCOUNTS_ENABLED", "MAIL_FROM", "SITE_URL"]));
    for (const name of names) expect(name, name).not.toMatch(/TOKEN|SECRET|KEY|PASSWORD|SALT/);
    // Never the account's workers.dev subdomain.
    expect(wranglerConfig).toContain('"workers_dev": false');
  });

  it("never reach a workflow's log, and no workflow runs on a pull request or another repository's event", () => {
    expect(Object.keys(WORKFLOWS).sort()).toEqual(expect.arrayContaining([
      "../../.github/workflows/deploy-site.yml", "../../.github/workflows/intraday.yml", "../../.github/workflows/nightly.yml",
    ]));
    for (const [file, text] of Object.entries(WORKFLOWS)) {
      const lines = text.split("\n");
      // Triggers: the schedule and a manual dispatch only. A pull request from a
      // fork can therefore never run a job that holds the secrets.
      const on = lines.indexOf("on:");
      expect(on, file).toBeGreaterThan(-1);
      const triggers: string[] = [];
      for (const line of lines.slice(on + 1)) {
        if (/^\S/.test(line)) break;
        const m = /^ {2}([a-z_]+):/.exec(line);
        if (m) triggers.push(m[1]);
      }
      for (const trigger of triggers) expect(["schedule", "workflow_dispatch"], `${file}: ${trigger}`).toContain(trigger);
      // A secret reaches a step only as an environment variable, never written into a script.
      for (const line of lines.filter((l) => l.includes("secrets."))) {
        if (/^\s*#/.test(line)) continue;
        expect(line, file).toMatch(/^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+(?: != '')? \}\}$/);
      }
      // Text a dispatcher or an event supplies goes through env or a condition, never into a script.
      for (const line of lines.filter((l) => /\$\{\{\s*(?:inputs\.|github\.event\.|github\.head_ref)/.test(l))) {
        expect(line, file).toMatch(/^\s+(?:[A-Z_]+:|if:|-\s*if:)/);
      }
      // No shell tracing, and no secret variable echoed.
      expect(text, file).not.toMatch(/set -[a-z]*x/);
      for (const line of lines.filter((l) => /\b(?:echo|printf)\b/.test(l))) {
        expect(line, file).not.toMatch(/\$\{?(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_SITE_DEPLOY_TOKEN|CLOUDFLARE_ANALYTICS_TOKEN|GSC_SERVICE_ACCOUNT_JSON|CLOUDFLARE_ACCOUNT_ID)\b/);
      }
    }
  });
});

// The interest table of the forms database is reached by deletion and import only.
describe("the forms database", () => {
  it("is not read by any account route for an address the session did not prove", async () => {
    const email = newEmail("forms");
    const cookie = await signIn(email);
    const stranger = newEmail("stranger");
    await DB.prepare("INSERT INTO interest (email, kind, params, label, lang, created_at, token) VALUES (?, 'segment', '/segments/43', 'Stranger label', 'en', ?, ?)")
      .bind(stranger, new Date().toISOString(), "e".repeat(32)).run();
    const page = await (await get("/account/searches", { cookie })).text();
    expect(page).not.toContain("Stranger label");
    expect(page).not.toContain(stranger);
  });
});
