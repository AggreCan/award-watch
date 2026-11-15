// Three changes approved by the operator on 2026-11-14, from the review of the first week of a paid
// account (its findings 3b, 3c and 7), each held here and each written to fail on the code as it stood:
// 1. the sign-in posts: AUTH_LIMIT at 10 a minute an address, so a third colleague behind one office
//    address signs in within the minute (a sign-in is two posts, the address and then the code);
// 2. a paying reader's downloads: a cap of their own, 30 a minute counted by the account (its user id) in
//    PAID_DOWNLOAD_LIMIT, while everyone else keeps the address's 10; the limiter shares the request's one
//    session read, reads nothing without a session cookie, and counts by address when the session cannot
//    be read;
// 3. the keyed API's open and new notice lists in one order for the whole data date, so a script paging
//    them lists each notice once while notices close between its pages.
//
// The caps are counted by counting limiters set to the figures written here (or, for the sign-in posts,
// to wrangler.jsonc's own figure), so no test meets the local runtime's minute turning over mid-count.
// Every expected line is written out here, never read back from the code under test.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { forgetSessions } from "../src/account/session";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { PAID_DOWNLOADS_PER_MINUTE } from "../src/pages/docs";
import wranglerConfig from "../wrangler.jsonc?raw";
import {
  ACCOUNTS, codeIn, csrf, decode, get, grantPro, grantUltra, lastMail, nbsp, newEmail, nextIp, offEnv, onEnv, post, signIn,
  ultraEnv, useAccountsDb, userId,
} from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const NAV = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "sec-fetch-mode": "navigate" };

const norm = (s: string) => nbsp(decode(s)).replace(/’/g, "'");
const html = async (res: Response) => norm(await res.text());

// A binding's figures as wrangler.jsonc gives them, or null when it declares none.
function binding(name: string): { namespace: string; limit: number; period: number } | null {
  const m = new RegExp(`\\{ "name": "${name}", "namespace_id": "(\\d+)", "simple": \\{ "limit": (\\d+), "period": (\\d+) \\} \\}`).exec(wranglerConfig);
  return m ? { namespace: m[1], limit: Number(m[2]), period: Number(m[3]) } : null;
}

// A limiter that allows `limit` requests a key in the test's minute, and keeps every key it is asked about.
function counting(limit: number) {
  const keys: string[] = [];
  const limiter = {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: keys.filter((k) => k === key).length <= limit };
    },
  } as unknown as RateLimit;
  return { keys, limiter };
}
const spent = { limit: async () => ({ success: false }) } as unknown as RateLimit;

type Reader = { email: string; id: string; cookie: string };

async function reader(tag: string, plan: "free" | "pro" | "ultra"): Promise<Reader> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  if (plan === "pro") await grantPro(email);
  if (plan === "ultra") await grantUltra(email);
  return { email, id: await userId(email), cookie };
}

// The accounts database with every statement it is asked to prepare kept, or with the session's read failing.
function watched(fail = false) {
  const sqls: string[] = [];
  const db = new Proxy(ACCOUNTS, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          sqls.push(sql);
          if (fail && SESSION_READ.test(sql)) throw new Error("D1_ERROR: the database is not available");
          return target.prepare(sql);
        };
      }
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { sqls, db };
}
// The one statement a session's read starts with (src/account/session.ts lookup).
const SESSION_READ = /FROM sessions s JOIN users u ON u\.id = s\.user_id/;
const sessionReads = (sqls: string[]) => sqls.filter((s) => SESSION_READ.test(s)).length;

// A binding that throws on any use, and records it.
function trap(): { used: string[]; db: D1Database } {
  const used: string[] = [];
  const db = new Proxy({}, {
    get(_t, prop) {
      used.push(String(prop));
      throw new Error("the accounts database was used");
    },
  }) as D1Database;
  return { used, db };
}

// =========================================================================================
// 1. Sign-in posts: 10 a minute an address
// =========================================================================================

describe("1. the sign-in posts, 10 a minute an address", () => {
  it("let three colleagues behind one office address sign in within a minute, at wrangler.jsonc's figure, and refuse the eleventh post", async () => {
    const auth = counting(binding("AUTH_LIMIT")?.limit ?? 0);
    const env = onEnv({ AUTH_LIMIT: auth.limiter });
    const ip = "192.0.2.10";
    for (let i = 1; i <= 3; i++) {
      const email = newEmail(`caps-office-${i}`);
      expect((await post("/account/sign-in", { email }, { ip, env })).status, `colleague ${i}'s address`).toBe(200);
      const code = codeIn((await lastMail(email))?.text ?? "");
      const checked = await post("/account/check", { email, code, sent: "1" }, { ip, env });
      expect(checked.status, `colleague ${i}'s code`).toBe(303);
    }
    // Six posts so far: four more pass, and the eleventh in the minute is refused.
    const more: number[] = [];
    for (let i = 0; i < 5; i++) more.push((await post("/account/sign-in", { email: newEmail("caps-office-more") }, { ip, env })).status);
    expect(more).toEqual([200, 200, 200, 200, 429]);
    expect(new Set(auth.keys)).toEqual(new Set([`auth:${ip}`]));
    expect(bucketFor("POST", "/account/sign-in")).toBe("auth");
    expect(bucketFor("POST", "/account/check")).toBe("auth");
  });

  it("is AUTH_LIMIT in wrangler.jsonc, 10 a minute in its own namespace, with the comment and the documentation saying 10", async () => {
    expect(binding("AUTH_LIMIT")).toEqual({ namespace: "2006", limit: 10, period: 60 });
    const docs = ((await import("../../docs/accounts.md?raw")).default as string).replace(/\s+/g, " ");
    expect(docs).toContain("Both sign-in posts count against `AUTH_LIMIT` (10 a minute per address) while the switch is on.");
    expect(docs).toContain("`AUTH_LIMIT` (10 a minute per IP address) on both sign-in posts");
    expect(docs).not.toMatch(/AUTH_LIMIT` \(5 a minute/);
    const comment = /\/\/ Accounts: posts of an address or a code[\s\S]*?"name": "AUTH_LIMIT"/.exec(wranglerConfig)?.[0] ?? "";
    expect(comment.replace(/\s*\/\/\s*/g, " ")).toContain("Ten a minute: a sign-in is two posts");
  });
});

// =========================================================================================
// 2. A paying reader's downloads: 30 a minute, counted by the account
// =========================================================================================

// One buyer's analytics view offers these 8 tables as CSV (src/pages/analytics.tsx VIEW_TABLES.buyer).
const BUYER_TABLES = ["quarters", "values", "records", "segments", "competition", "suppliers", "growth", "due"];
const tablesOf = (buyer: string) => BUYER_TABLES.map((t) => `/buyers/${buyer}/analytics/${t}.csv`);
// The 8 tables of three buyers, then the first 6 of a fourth: 30 files, and the 31st.
const FILES_30 = [...tablesOf("pwgsc-tpsgc"), ...tablesOf("dfo-mpo"), ...tablesOf("dnd-mdn"), ...tablesOf("tc").slice(0, 6)];
const FILE_31 = tablesOf("tc")[6];
const ICS = "/tenders/cb-200-20005019.ics";
const BULK = "/downloads/organizations.csv";

describe("2. a paying reader's downloads, 30 a minute counted by the account", () => {
  it("count a Pro analyst's downloads by the account: the 8 tables of three buyers and 6 of a fourth pass, the 31st is refused, and the address keeps its 10 for everyone else", async () => {
    const r = await reader("caps-pro", "pro");
    const ip = "192.0.2.20";
    const address = counting(10);
    const account = counting(30);
    const env = onEnv({ DOWNLOAD_LIMIT: address.limiter, PAID_DOWNLOAD_LIMIT: account.limiter });
    for (const [i, path] of FILES_30.entries()) {
      expect((await get(path, { cookie: r.cookie, env, ip })).status, `download ${i + 1}: ${path}`).not.toBe(429);
    }
    expect((await get(FILE_31, { cookie: r.cookie, env, ip })).status, "download 31").toBe(429);
    expect(account.keys).toEqual(Array(31).fill(`account:${r.id}`));
    expect(address.keys).toEqual([]);
    // A reader with no account at the same address, the same minute: the address's own 10.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await get(ICS, { env, ip })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(address.keys).toEqual(Array(11).fill(`download:${ip}`));
  });

  it("give Ultra the same cap of its own, and keep a free reader and a reader signed out on the address's", async () => {
    const ultra = await reader("caps-ultra", "ultra");
    const free = await reader("caps-free", "free");
    const ip = "192.0.2.21";
    const address = counting(10);
    const account = counting(30);
    const env = onEnv({ DOWNLOAD_LIMIT: address.limiter, PAID_DOWNLOAD_LIMIT: account.limiter });
    await get(tablesOf("pwgsc-tpsgc")[0], { cookie: ultra.cookie, env, ip });
    await get(ICS, { cookie: free.cookie, env, ip });
    await get(ICS, { env, ip });
    expect(account.keys).toEqual([`account:${ultra.id}`]);
    expect(address.keys).toEqual([`download:${ip}`, `download:${ip}`]);
    // A HEAD stays a page, whoever asks.
    expect(bucketFor("HEAD", tablesOf("pwgsc-tpsgc")[0])).toBe("page");
  });

  it("learn the account from the request's one session read, which the route then reuses, and read nothing without a session cookie", async () => {
    const r = await reader("caps-once", "pro");
    const ip = "192.0.2.22";
    const account = counting(30);
    const w = watched();
    const env = onEnv({ ACCOUNTS: w.db, PAID_DOWNLOAD_LIMIT: account.limiter, DOWNLOAD_LIMIT: counting(10).limiter });
    // The analytics file reads the plan itself (src/plan.ts analyticsPlan): one read serves the cap and the route.
    await get(tablesOf("pwgsc-tpsgc")[0], { cookie: r.cookie, env, ip });
    expect(account.keys).toEqual([`account:${r.id}`]);
    expect(sessionReads(w.sqls)).toBe(1);
    // A calendar file reads no session for itself: with a session cookie, the cap's read is the request's one.
    w.sqls.length = 0;
    await get(ICS, { cookie: r.cookie, env, ip });
    expect(sessionReads(w.sqls)).toBe(1);
    // Without a session cookie nothing touches the accounts database, whatever the file.
    await env.DATA.put("downloads/organizations.csv", "id,name\r\n");
    const t = trap();
    const address = counting(10);
    const bare = onEnv({ ACCOUNTS: t.db, PAID_DOWNLOAD_LIMIT: counting(30).limiter, DOWNLOAD_LIMIT: address.limiter });
    for (const path of [ICS, BULK]) expect((await get(path, { env: bare, ip, cookie: "lang=en" })).status, path).toBe(200);
    expect(t.used).toEqual([]);
    expect(address.keys).toEqual([`download:${ip}`, `download:${ip}`]);
  });

  it("count by the address when the session cannot be read, the database down or the session remembered through an outage", async () => {
    const r = await reader("caps-outage", "pro");
    const ip = "192.0.2.23";
    const run = async (db: D1Database) => {
      const address = counting(10);
      const account = counting(30);
      const res = await get(ICS, { cookie: r.cookie, env: onEnv({ ACCOUNTS: db, DOWNLOAD_LIMIT: address.limiter, PAID_DOWNLOAD_LIMIT: account.limiter }), ip });
      return { status: res.status, address: address.keys, account: account.keys };
    };
    // Never seen by this isolate: the read answers that it cannot say.
    forgetSessions();
    expect(await run(watched(true).db)).toEqual({ status: 200, address: [`download:${ip}`], account: [] });
    // Read once with the database up, then answered from what this isolate remembers.
    expect((await run(ACCOUNTS)).account).toEqual([`account:${r.id}`]);
    expect(await run(watched(true).db)).toEqual({ status: 200, address: [`download:${ip}`], account: [] });
  });

  it("refuse a paying reader past the cap with the page or the text it is today, naming the account in place of the address", async () => {
    const r = await reader("caps-refused", "pro");
    const env = onEnv({ PAID_DOWNLOAD_LIMIT: spent, DOWNLOAD_LIMIT: counting(10).limiter });
    const path = tablesOf("pwgsc-tpsgc")[1];
    const res = await get(path, { cookie: r.cookie, env, headers: { ...NAV, referer: "http://localhost/buyers/pwgsc-tpsgc/analytics" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await html(res);
    expect(body).toContain("<h1>Too Many Requests</h1>");
    expect(body).toContain("Too many downloads from this account. Wait a minute and try again.");
    expect(body).toContain('<a href="/buyers/pwgsc-tpsgc/analytics">Back to the page</a>');
    expect(body).not.toContain("from this address");
    const fr = await html(await get(path, { cookie: `${r.cookie}; lang=fr`, env, headers: NAV }));
    expect(fr).toContain("Trop de téléchargements depuis ce compte. Attendez une minute et réessayez.");
    for (const s of [body, fr]) {
      expect(s).not.toContain(EM_DASH);
      expect(s).not.toContain(EN_DASH);
    }
    // A script's request keeps the plain text answer.
    const plain = await app.request(path, { headers: { cookie: r.cookie, "cf-connecting-ip": nextIp() } }, env as never);
    expect(plain.status).toBe(429);
    expect(plain.headers.get("content-type")).toContain("text/plain");
    expect(await plain.text()).toBe("Too many downloads from this account. Wait a minute and try again.");
    // The address's refusal keeps its own line.
    const anon = await app.request(ICS, { headers: { "cf-connecting-ip": nextIp() } }, onEnv({ DOWNLOAD_LIMIT: spent }) as never);
    expect(await anon.text()).toBe("Too many requests from this address. Wait a minute and try again.");
  });

  it("is PAID_DOWNLOAD_LIMIT in wrangler.jsonc, 30 a minute in the next namespace, and every page that states the download figure says it", async () => {
    expect(binding("PAID_DOWNLOAD_LIMIT")).toEqual({ namespace: "2013", limit: 30, period: 60 });
    expect(binding("DOWNLOAD_LIMIT")).toEqual({ namespace: "2003", limit: 10, period: 60 });
    const ids = [...wranglerConfig.matchAll(/"namespace_id": "(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.max(...ids)).toBe(2013);
    expect(new Set(ids).size).toBe(ids.length);
    expect((env as unknown as { PAID_DOWNLOAD_LIMIT?: unknown }).PAID_DOWNLOAD_LIMIT, "the binding reaches the Worker").toBeTruthy();
    // The figure the pages quote is the binding's.
    expect(PAID_DOWNLOADS_PER_MINUTE).toBe(binding("PAID_DOWNLOAD_LIMIT")?.limit);
    // The terms: each address's figures, then, while accounts are open, the paying account's own: Pro's
    // while Ultra is off sale (the Terms name no Ultra before it is on sale), each paid plan's once it is.
    const addressLine = "Each address may make 120 page requests, 60 API requests and 10 downloads a minute.";
    const terms = await html(await get("/terms", { env: onEnv() }));
    expect(terms).toContain(addressLine);
    expect(terms).toContain("A signed-in account on Pro has its own download limit, 30 a minute, apart from its address's.");
    expect(terms).not.toContain("Ultra");
    const termsFr = await html(await get("/terms?lang=fr", { env: onEnv() }));
    expect(termsFr).toContain("Un compte connecté au forfait Pro a sa propre limite de téléchargements, 30 par minute, distincte de celle de son adresse.");
    const termsSale = await html(await get("/terms", { env: ultraEnv() }));
    expect(termsSale).toContain(addressLine);
    expect(termsSale).toContain("A signed-in account on Pro or Ultra has its own download limit, 30 a minute on either plan, apart from its address's.");
    const termsSaleFr = await html(await get("/terms?lang=fr", { env: ultraEnv() }));
    expect(termsSaleFr).toContain("Un compte connecté au forfait Pro ou Ultra a sa propre limite de téléchargements, 30 par minute avec l'un ou l'autre forfait, distincte de celle de son adresse.");
    const termsOff = await html(await get("/terms", { env: offEnv() }));
    expect(termsOff).toContain(addressLine);
    expect(termsOff).not.toContain("own download limit");
    for (const s of [terms, termsFr, termsSale, termsSaleFr]) {
      expect(s).not.toContain(EM_DASH);
      expect(s).not.toContain(EN_DASH);
    }
    // The crawlers' list, read by agents that never sign in: the address's figure, then the paid plans' own.
    const llms = (await (await app.request("/llms.txt", {}, onEnv() as never)).text()).replace(/\s+/g, " ");
    expect(llms).toContain("Downloads are limited to ten per minute per address. A signed-in account on a paid plan has its own limit of thirty downloads per minute, counted by the account.");
    // The documentation.
    const docs = ((await import("../../docs/accounts.md?raw")).default as string).replace(/\s+/g, " ");
    expect(docs).toContain("`PAID_DOWNLOAD_LIMIT` (30 a minute per account, namespace 2013)");
    const analytics = ((await import("../../docs/analytics.md?raw")).default as string).replace(/\s+/g, " ");
    expect(analytics).not.toContain("for the per-address limit (ten a minute)");
    expect(analytics).toContain("`PAID_DOWNLOAD_LIMIT`, thirty a minute");
  });
});

// =========================================================================================
// 3. The keyed API's open and new notice lists hold one order through a data date
// =========================================================================================

type Made = { key: string };

async function proKey(tag: string): Promise<Made> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  await grantPro(email);
  const page = await (await post("/account/keys", { csrf: await csrf(cookie), name: tag }, { cookie })).text();
  return { key: /(aw_[0-9a-f]{8}_[0-9a-f]{64})/.exec(page)![1] };
}

const call = (path: string, key: string, extra: Record<string, unknown>) =>
  app.request(path, { headers: { "cf-connecting-ip": nextIp(), authorization: `Bearer ${key}` } }, onEnv(extra) as never);
const body = async (res: Response) => (await res.json()) as { data_as_of: string; total: number; pages: number; rows: { reference: string }[]; error?: string };
const refs = (b: { rows: { reference: string }[] }) => b.rows.map((r) => r.reference);

// The fixtures' data date is 2026-10-31 (test/fixtures/stats.json). 14:00 Eastern that day is 18:00 UTC
// (daylight time until 2026-11-01); the two instants are a minute either side.
const T = "2026-10-31T14:00:00";
const BEFORE = "2026-10-31T17:59:00Z";
const AFTER = "2026-10-31T18:01:00Z";

// 150 open notices as the night's file lists them, soonest closing first: the first closes at T and is
// the newest published, so it is on page 1 in either order; the others close from 2026-11-01 to
// 2026-11-05, all within 7 days of the data date.
const OPEN_BASE = (FILES["tenders/open.json"] as Record<string, unknown>[])[0];
const OPEN_ROWS = Array.from({ length: 150 }, (_, i) => ({
  ...OPEN_BASE,
  reference: `cb-700-${70000000 + i}`,
  closing: i === 0 ? T : `2026-11-0${1 + Math.floor((i - 1) / 30)}T${String(9 + (i % 8)).padStart(2, "0")}:30:00`,
  published: i === 0 ? "2026-10-31" : `2026-10-${String(1 + ((i * 7) % 30)).padStart(2, "0")}`,
}));
const ALL_OPEN = OPEN_ROWS.map((r) => r.reference).sort();

// The notices first seen on the data date, newest published first as the file lists them: the 11th closes
// at T, three closed by the data date, the rest later in November.
const NEW_BASE = (FILES["tenders/new/2026-10-31.json"] as Record<string, unknown>[])[0];
const NEW_ROWS = Array.from({ length: 150 }, (_, i) => ({
  ...NEW_BASE,
  reference: `cb-800-${80000000 + i}`,
  status: i % 50 === 49 ? "closed" : "open",
  closing: i === 10 ? T : `2026-11-${String(10 + (i % 15)).padStart(2, "0")}T14:00:00`,
}));
const ALL_NEW = NEW_ROWS.map((r) => r.reference).sort();

describe("3. the keyed API's notice lists, one order through a data date", () => {
  it("list each open notice once to a script that pages /api/v1/tenders/open while a notice of page 1 closes between its pages, for every order and window", async () => {
    const { key } = await proKey("caps-crawl-open");
    const ASSETS = makeFakeAssets({}, { "tenders/open.json": OPEN_ROWS });
    for (const query of ["", "closing=7", "closing=30", "sort=published", "sort=published&closing=7"]) {
      const at = (page: number, now: string) => call(`/api/v1/tenders/open?${query ? `${query}&` : ""}page=${page}`, key, { ASSETS, NOW: now });
      const one = await body(await at(1, BEFORE));
      const two = await body(await at(2, AFTER));
      expect(one.rows.map((r) => r.reference), query).toContain(OPEN_ROWS[0].reference);
      const seen = [...refs(one), ...refs(two)];
      expect(seen.length, query).toBe(150);
      expect(new Set(seen).size, `${query}: no notice twice`).toBe(150);
      expect([...seen].sort(), `${query}: no notice missed`).toEqual(ALL_OPEN);
      // Each page is the same slice whenever it is asked within the data date.
      expect(refs(await body(await at(2, BEFORE))), query).toEqual(refs(two));
      expect([one.data_as_of, two.data_as_of], query).toEqual(["2026-10-31", "2026-10-31"]);
      expect([one.total, two.total], query).toEqual([150, 150]);
    }
    // The default order, soonest closing first: the notice closing at T keeps its place after T.
    expect(refs(await body(await call("/api/v1/tenders/open", key, { ASSETS, NOW: AFTER })))[0]).toBe(OPEN_ROWS[0].reference);
  });

  it("list each new notice once to a script that pages /api/v1/tenders/new the same way, the notices closed by the data date last", async () => {
    const { key } = await proKey("caps-crawl-new");
    const ASSETS = makeFakeAssets({}, { "tenders/new/2026-10-31.json": NEW_ROWS });
    const at = (page: number, now: string) => call(`/api/v1/tenders/new?page=${page}`, key, { ASSETS, NOW: now });
    const one = await body(await at(1, BEFORE));
    const two = await body(await at(2, AFTER));
    const seen = [...refs(one), ...refs(two)];
    expect(new Set(seen).size).toBe(150);
    expect([...seen].sort()).toEqual(ALL_NEW);
    expect(refs(one)[10]).toBe(NEW_ROWS[10].reference);
    expect(refs(await body(await at(1, AFTER)))).toEqual(refs(one));
    expect(refs(two).slice(-3)).toEqual(["cb-800-80000049", "cb-800-80000099", "cb-800-80000149"]);
  });

  it("say on the Data page and in the documentation what a script does when data_as_of changes between pages", async () => {
    const data = await html(await get("/data", { env: onEnv() }));
    expect(data).toContain("The open and new notice lists keep one order for the whole data date: a notice whose closing time passes keeps its place, so the pages of one data date list each notice once. If data_as_of changes between two pages, a new night's list has replaced the one the earlier pages came from: start again from page 1.");
    expect(data).toContain("7 or 30, for the notices closing within that many days of the data date");
    const fr = await html(await get("/data?lang=fr", { env: onEnv() }));
    expect(fr).toContain("Les listes des avis ouverts et des nouveaux avis gardent un même ordre pour toute la date des données : un avis dont l'heure de clôture passe garde sa place, de sorte que les pages d'une même date des données donnent chaque avis une fois. Si data_as_of change entre deux pages, la liste d'une nouvelle nuit a remplacé celle des pages précédentes : reprenez à la page 1.");
    expect(fr).toContain("7 ou 30, pour les avis dont la clôture tombe dans ce nombre de jours suivant la date des données");
    for (const s of [data, fr]) {
      expect(s).not.toContain(EM_DASH);
      expect(s).not.toContain(EN_DASH);
    }
    const docs = ((await import("../../docs/accounts.md?raw")).default as string).replace(/\s+/g, " ");
    expect(docs).toContain("### Paging the notice lists");
    expect(docs).toContain("If `data_as_of` changes between two pages");
  });
});
