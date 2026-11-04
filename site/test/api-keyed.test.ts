// The keyed API under /api/v1 (src/api_keyed.ts, src/api_keyed_spec.ts,
// src/account/api_usage.ts; docs/accounts.md, "The keyed API"), against real
// local D1 databases: the accounts database with real keys made through the
// keys page, the records database filled as the nightly sync fills it, and
// the hosted search's tables. The static files are the fixtures, replaced
// where a test needs more rows than they hold.
//
// The switch off (every address the open API's 404, nothing read); the key
// (401, 403, 503); the per-key limiter and the daily quota, failing open; each
// endpoint's parameters, paging and bounds; the records statements' plans;
// the keys page's counts; the sweep and the deletion; the Data page's
// section; and the binding in wrangler.jsonc.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { forgetKeys } from "../src/account/api_keys";
import { COUNT_SQL, USAGE_KEEP_DAYS, USAGE_SQL, dayPlus, secondsToNextDay } from "../src/account/api_usage";
import { sweep } from "../src/account/signin";
import { BUYER_KNOWN_SQL, BUYER_RECORDS_SQL, KEYED_RECORDS_SQL, ORG_KNOWN_SQL, ORG_RECORDS_SQL, keyedApi } from "../src/api_keyed";
import { KEYED_ENDPOINTS, KEYED_PARAMS, KEY_PER_DAY, KEY_PER_MINUTE, PAGE_ROWS, RECORD_PAGES_MAX } from "../src/api_keyed_spec";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { REQUEST_LIMITS } from "../src/pages/docs";
import { KEYED_EXAMPLE } from "../src/pages/keyed_api";
import { orgNumber } from "../src/records_db";
import { foldText } from "../src/search_db";
import { routeTemplate } from "../src/views";
import wranglerConfig from "../wrangler.jsonc?raw";
import { ACCOUNTS, csrf, decode, get, grantPro, nbsp, newEmail, nextIp, offEnv, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const SEARCH_SCHEMA = (env as unknown as { SEARCH_SCHEMA_SQL: string }).SEARCH_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);

// The fixtures' clock (test/assets.ts): 16:00 UTC on 2026-10-31, eight hours before the next UTC day.
const TODAY = "2026-10-31";

// -- the records database --------------------------------------------------------------------

const PSPC = 101;
const DND = 102;
const A1 = "org-a000000001";
const A2 = "org-a000000002";
const oid = (id: string) => orgNumber(id) as number;

type Rec = [src: number, fy: number, fq: number, bid: number | null, oid: number | null, sid: number | null, extra: 0 | 1, cents: number | null, vnote: number, comp: number | null, meth: string | null];
const RECS: Rec[] = [];
// A1's PSPC contract history (2), every quarter from 2014-15 (before the ten
// years) to 2026-27, the fourth non-competitive; each also reaches segment 43
// on an extra row, which is never a record of its own.
for (let fy = 2014; fy <= 2026; fy++) {
  for (let fq = 1; fq <= 4; fq++) {
    const cents = (100_000 * fq + fy) * 100;
    RECS.push([2, fy, fq, PSPC, oid(A1), 82, 0, cents, 0, fq === 4 ? 0 : 1, fq === 4 ? "TN" : "OB"]);
    RECS.push([2, fy, fq, PSPC, oid(A1), 43, 1, cents, 0, fq === 4 ? 0 : 1, fq === 4 ? "TN" : "OB"]);
  }
}
// A supplier withheld at PSPC, and a value not published.
RECS.push([2, 2025, 2, PSPC, null, 82, 0, 500_000, 0, 1, "OB"]);
RECS.push([2, 2024, 1, PSPC, oid(A1), 82, 0, null, 1, null, null]);
// A2's published contracts (3) at National Defence: 230 in 2025-26 and 5 in 2026-27, three pages.
for (let i = 0; i < 230; i++) RECS.push([3, 2025, 1 + (i % 4), DND, oid(A2), null, 0, (i + 1) * 100, 0, 1, "OB"]);
for (let i = 0; i < 5; i++) RECS.push([3, 2026, 1, DND, oid(A2), null, 0, 999_00, 0, 0, "TN"]);

async function seedRecords(): Promise<void> {
  await applySql(RECORDS, RECORDS_SCHEMA);
  await RECORDS.batch(["records", "rec_orgs", "rec_buyers", "rec_meta"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  const insert = "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote, comp, meth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  for (let i = 0; i < RECS.length; i += 50) await RECORDS.batch(RECS.slice(i, i + 50).map((r) => RECORDS.prepare(insert).bind(...r)));
  await RECORDS.batch([
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, 'Exemplar Translation Services Inc.'), (?, 'Sample Harbour Marine Ltd.')").bind(oid(A1), oid(A2)),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'pwgsc-tpsgc', 'Public Services and Procurement Canada', 'Services publics et Approvisionnement Canada')").bind(PSPC),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dnd-mdn', 'National Defence', 'Défense nationale')").bind(DND),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', '2026-10-31'), ('rules', '2')"),
  ]);
}

async function seedSearch(): Promise<void> {
  await applySql(SEARCH, SEARCH_SCHEMA);
  const orgSql = "INSERT OR REPLACE INTO search_orgs (id, name, alt, bn, folds, prov, city, n_awards, n_history, n_contracts, n_grants, " +
    "n_lobbying, n_records, total_awards, total_history, total_contracts, total_grants, hash) " +
    "VALUES (?, ?, '', '', ?, 'MB', 'Brandon', 1, 0, 0, 0, 0, 1, 1000, NULL, NULL, NULL, 'h')";
  await SEARCH.batch(["Quokka Survey Services Ltd", "Quokka Habitat Works Inc"].map((name, i) =>
    SEARCH.prepare(orgSql).bind(`org-c00000000${i + 1}`, name, foldText(name))));
}

beforeAll(async () => {
  await seedRecords();
  await seedSearch();
});

// -- keys and requests -------------------------------------------------------------------------

type Made = { email: string; cookie: string; key: string; keyId: string };

async function proKey(tag: string): Promise<Made> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  await grantPro(email);
  const html = await (await post("/account/keys", { csrf: await csrf(cookie), name: tag }, { cookie })).text();
  const key = /(aw_[0-9a-f]{8}_[0-9a-f]{64})/.exec(html)![1];
  const row = await ACCOUNTS.prepare("SELECT id FROM api_keys WHERE prefix = ?").bind(key.slice(3, 11)).first<{ id: string }>();
  return { email, cookie, key, keyId: row!.id };
}

const call = (path: string, key: string | null, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  app.request(path, { headers: { "cf-connecting-ip": nextIp(), ...(key ? { authorization: `Bearer ${key}` } : {}), ...headers } }, onEnv(extra));

const json = async (res: Response) => (await res.json()) as Record<string, any>;

let shared: Made;
beforeAll(async () => {
  shared = await proKey("keyed-shared");
});

const usageOf = async (keyId: string, day = TODAY) =>
  (await ACCOUNTS.prepare("SELECT n FROM api_usage WHERE key_id = ? AND day = ?").bind(keyId, day).first<{ n: number }>())?.n ?? 0;

// A binding that throws on every use, and records it.
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

// The accounts database with one statement failing, every other one passed on.
function failing(sql: string): D1Database {
  return {
    prepare(s: string) {
      if (s === sql) throw new Error("D1_ERROR: no such table: api_usage: SQLITE_ERROR");
      return ACCOUNTS.prepare(s);
    },
    batch: (s: D1PreparedStatement[]) => ACCOUNTS.batch(s),
  } as unknown as D1Database;
}

// Every route of the sub-app as a request path, a parameter made a well-formed id.
const SAMPLE_PATHS = [
  "/api/v1/tenders/open", "/api/v1/tenders/new", "/api/v1/expiring/3m", "/api/v1/search?q=quokka",
  `/api/v1/organizations/${A1}/records?source=history`, "/api/v1/buyers/pwgsc-tpsgc/records?source=history", "/api/v1/me",
];

// -- the switch -----------------------------------------------------------------------------

describe("the switch, off", () => {
  it("answers every address under /api/v1 with the open API's own 404, reading nothing", async () => {
    const accounts = trap<D1Database>("the accounts database");
    const records = trap<D1Database>("the records database");
    const search = trap<D1Database>("the search database");
    const off = { ...offEnv(), ACCOUNTS: accounts.binding, RECORDS: records.binding, SEARCH: search.binding };
    const missing = await app.request("/api/nothing-here", { headers: { "cf-connecting-ip": nextIp() } }, off);
    const body = await missing.text();
    expect(missing.status).toBe(404);
    for (const path of [...SAMPLE_PATHS, "/api/v1/nothing", "/api/v1"]) {
      for (const headers of [{}, { authorization: `Bearer ${shared.key}` }, { "x-api-key": shared.key }] as Record<string, string>[]) {
        const res = await app.request(path, { headers: { "cf-connecting-ip": nextIp(), ...headers } }, off);
        expect(res.status, path).toBe(404);
        expect(await res.text(), path).toBe(body);
        expect(res.headers.get("cache-control"), path).toBe(missing.headers.get("cache-control"));
        expect(res.headers.get("www-authenticate"), path).toBeNull();
      }
    }
    expect(accounts.used).toEqual([]);
    expect(records.used).toEqual([]);
    expect(search.used).toEqual([]);
  });
});

// -- the key ----------------------------------------------------------------------------------

describe("the key", () => {
  it("is asked for on every address: 401 without one or with one that is not a key, never stored by a cache", async () => {
    for (const path of [...SAMPLE_PATHS, "/api/v1/nothing"]) {
      for (const key of [null, "nope", `aw_${"0f".repeat(4)}_${"e1".repeat(32)}`]) {
        const res = await call(path, key);
        expect(res.status, `${path} ${key}`).toBe(401);
        expect(res.headers.get("www-authenticate")).toBe('Bearer realm="api"');
        // requireApiKey's no-store, made private by the sub-app as every keyed answer is.
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(Object.keys(await json(res))).toEqual(["error"]);
      }
    }
  });

  it("lets a Pro account's key through by either header, private and no-store, varying on both", async () => {
    for (const headers of [{ authorization: `Bearer ${shared.key}` }, { "x-api-key": shared.key }] as Record<string, string>[]) {
      const res = await call("/api/v1/me", null, {}, headers);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("vary")).toContain("Authorization, X-Api-Key");
    }
    // A route's own refusal goes out the same way.
    const bad = await call("/api/v1/tenders/open?page=0", shared.key);
    expect(bad.status).toBe(400);
    expect(bad.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses a revoked key with 401 and a key whose account left Pro with 403", async () => {
    const revoked = await proKey("keyed-revoked");
    await ACCOUNTS.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), revoked.keyId).run();
    expect((await call("/api/v1/me", revoked.key)).status).toBe(401);
    const lapsed = await proKey("keyed-lapsed");
    await ACCOUNTS.prepare("UPDATE entitlements SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), await userId(lapsed.email)).run();
    const res = await call("/api/v1/tenders/open", lapsed.key);
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("The plan of the key's account does not include the API.");
    // Neither was counted.
    expect(await usageOf(revoked.keyId)).toBe(0);
    expect(await usageOf(lapsed.keyId)).toBe(0);
  });

  it("answers 503 with Retry-After through an outage, for a key this isolate has not checked", async () => {
    forgetKeys();
    const broken = { prepare: () => { throw new Error("D1_ERROR: down"); }, batch: () => { throw new Error("D1_ERROR: down"); } };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await call("/api/v1/me", shared.key, { ACCOUNTS: broken });
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("60");
    } finally {
      error.mockRestore();
    }
  });
});

// -- the limits ----------------------------------------------------------------------------------

describe("the per-key limiter", () => {
  it("is asked by the key's id, and a refusal is a 429 with Retry-After 60 that is not counted", async () => {
    const made = await proKey("keyed-minute");
    const keys: string[] = [];
    const refuse = { limit: async ({ key }: { key: string }) => { keys.push(key); return { success: false }; } };
    const res = await call("/api/v1/me", made.key, { KEY_LIMIT: refuse });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await json(res)).error).toBe(`This key has made ${KEY_PER_MINUTE} requests in the last minute. Wait a minute and try again.`);
    expect(keys).toEqual([`key:${made.keyId}`]);
    expect(await usageOf(made.keyId)).toBe(0);
  });

  it("lets a request through when the limiter fails or allows it", async () => {
    const throwing = { limit: async () => { throw new Error("limiter down"); } };
    const allowing = { limit: async () => ({ success: true }) };
    for (const limiter of [throwing, allowing]) expect((await call("/api/v1/me", shared.key, { KEY_LIMIT: limiter })).status).toBe(200);
  });

  it("is the binding wrangler.jsonc declares, 600 a minute in namespace 2009, apart from every other namespace", () => {
    expect(wranglerConfig).toContain('{ "name": "KEY_LIMIT", "namespace_id": "2009", "simple": { "limit": 600, "period": 60 } }');
    expect(Number(/"name": "KEY_LIMIT"[^}]*"limit": (\d+)/.exec(wranglerConfig)?.[1])).toBe(KEY_PER_MINUTE);
    const ids = [...wranglerConfig.matchAll(/"namespace_id": "(\d+)"/g)].map((m) => m[1]);
    expect(ids).toContain("2009");
    expect(new Set(ids).size).toBe(ids.length);
    // The per-address API cap stays as it was, under every keyed request too.
    expect(wranglerConfig).toContain('{ "name": "API_LIMIT", "namespace_id": "2002", "simple": { "limit": 60, "period": 60 } }');
  });
});

describe("the daily quota", () => {
  it("counts each request in api_usage, and /me says the day's count", async () => {
    const made = await proKey("keyed-count");
    for (let i = 1; i <= 3; i++) {
      const res = await call("/api/v1/me", made.key);
      const body = await json(res);
      expect(body.usage).toEqual({ day: TODAY, requests: i, remaining: KEY_PER_DAY - i });
    }
    expect(await usageOf(made.keyId)).toBe(3);
    const me = await json(await call("/api/v1/me", made.key));
    expect(me).toMatchObject({ key: made.key.slice(0, 11), plan: "pro", plan_until: null, limits: { per_minute: KEY_PER_MINUTE, per_day: KEY_PER_DAY } });
    // The key itself is never echoed.
    expect(JSON.stringify(me)).not.toContain(made.key.slice(12));
  });

  it("stops at the cap with a 429 whose Retry-After is the next UTC day, counting no refused request", async () => {
    const made = await proKey("keyed-quota");
    await ACCOUNTS.batch([
      ACCOUNTS.prepare("INSERT INTO api_usage (key_id, day, n) VALUES (?, ?, ?)").bind(made.keyId, TODAY, KEY_PER_DAY - 1),
      ACCOUNTS.prepare("INSERT INTO api_usage (key_id, day, n) VALUES (?, ?, ?)").bind(made.keyId, "2026-10-30", KEY_PER_DAY),
    ]);
    const last = await call("/api/v1/me", made.key);
    expect(last.status).toBe(200);
    expect((await json(last)).usage).toEqual({ day: TODAY, requests: KEY_PER_DAY, remaining: 0 });
    for (const path of SAMPLE_PATHS) {
      const res = await call(path, made.key);
      expect(res.status, path).toBe(429);
      expect(res.headers.get("retry-after"), path).toBe(String(8 * 3600));
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect((await json(res)).error).toBe(`This key has made its ${KEY_PER_DAY} requests for the day. The count starts again at 00:00 UTC.`);
    }
    expect(await usageOf(made.keyId)).toBe(KEY_PER_DAY);
    // The next UTC day starts a new count.
    const tomorrow = await app.request("/api/v1/me", { headers: { "cf-connecting-ip": nextIp(), "x-api-key": made.key } }, onEnv({ NOW: "2026-11-01T00:00:01Z" }));
    expect((await json(tomorrow)).usage).toEqual({ day: "2026-11-01", requests: 1, remaining: KEY_PER_DAY - 1 });
    expect(secondsToNextDay(new Date("2026-10-31T23:59:59.500Z"))).toBe(1);
  });

  it("refuses at the cap before any route reads anything", async () => {
    const made = await proKey("keyed-spent");
    await ACCOUNTS.prepare("INSERT INTO api_usage (key_id, day, n) VALUES (?, ?, ?)").bind(made.keyId, TODAY, KEY_PER_DAY).run();
    const assets = trap<Fetcher>("the static files");
    const records = trap<D1Database>("the records database");
    const search = trap<D1Database>("the search database");
    for (const path of SAMPLE_PATHS) {
      const res = await call(path, made.key, { ASSETS: assets.binding, RECORDS: records.binding, SEARCH: search.binding });
      expect(res.status, path).toBe(429);
    }
    expect([...assets.used, ...records.used, ...search.used]).toEqual([]);
  });

  it("fails open: a count that cannot be written lets the request through uncounted", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await call("/api/v1/me", shared.key, { ACCOUNTS: failing(COUNT_SQL) });
      expect(res.status).toBe(200);
      expect((await json(res)).usage).toEqual({ day: TODAY, requests: null, remaining: null });
      expect((await call("/api/v1/tenders/open", shared.key, { ACCOUNTS: failing(COUNT_SQL) })).status).toBe(200);
      expect(error.mock.calls.flat().join(" ")).toContain("api usage: request not counted, let through");
      expect(error.mock.calls.flat().join(" ")).not.toContain(shared.key);
    } finally {
      error.mockRestore();
    }
  });
});

// -- parameters ---------------------------------------------------------------------------------

describe("parameters", () => {
  it("refuse a parameter an endpoint does not take, without repeating it", async () => {
    const res = await call("/api/v1/tenders/open?zqxevil=%3Cb%3E", shared.key);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).not.toContain("zqxevil");
    expect(JSON.parse(text).error).toMatch(/^unknown parameter; this endpoint takes category, segment, province/);
    expect((await json(await call("/api/v1/me?x=1", shared.key))).error).toBe("this endpoint takes no parameter");
  });

  it("refuse a single value given twice, a value out of its list, and a page that is not a whole number in range", async () => {
    const cases: [string, string][] = [
      ["/api/v1/tenders/open?sort=closing&sort=published", "sort: give it once"],
      ["/api/v1/tenders/open?category=XX", "category: one of GD, SRV, CNST, SRVTGD"],
      ["/api/v1/tenders/open?segment=99", "segment: a two-digit UNSPSC segment"],
      ["/api/v1/tenders/open?closing=14", "closing: 7 or 30"],
      ["/api/v1/tenders/open?national=yes", "national: 0 or 1"],
      ["/api/v1/tenders/open?buyer=Not%20A%20Buyer", "buyer: a buyer id, as in /buyers/{id}"],
      [`/api/v1/tenders/open?q=${"a".repeat(101)}`, "q: words to look for, at most 100 characters"],
      ["/api/v1/tenders/open?page=0", "page: a whole number from 1 to 10000"],
      ["/api/v1/tenders/open?page=1.5", "page: a whole number from 1 to 10000"],
      ["/api/v1/tenders/open?page=10001", "page: a whole number from 1 to 10000"],
      [`/api/v1/tenders/open?${Array.from({ length: 61 }, () => "province=ON").join("&")}`, "province: at most 60 values"],
      ["/api/v1/tenders/new?day=31-10-2026", "day: a date as YYYY-MM-DD"],
      ["/api/v1/search?page=201&q=quokka", "page: a whole number from 1 to 200"],
    ];
    for (const [path, error] of cases) {
      const res = await call(path, shared.key);
      expect(res.status, path).toBe(400);
      expect((await json(res)).error, path).toBe(error);
    }
  });
});

// -- tenders ----------------------------------------------------------------------------------

const refs = (body: Record<string, any>) => (body.rows as { reference: string }[]).map((r) => r.reference);

describe("/api/v1/tenders/open", () => {
  it("filters as the tender list does", async () => {
    const cases: [string, string[]][] = [
      ["", ["cb-100-10000001", "cb-200-20005019", "cb-300-30000003"]],
      // A province keeps the notices that name none unless national=0.
      ["?province=BC", ["cb-200-20005019", "cb-300-30000003"]],
      ["?province=BC&national=0", ["cb-200-20005019"]],
      ["?province=on", ["cb-100-10000001", "cb-300-30000003"]],
      ["?province=ON&national=0", ["cb-100-10000001"]],
      ["?province=ON&province=BC&national=0", ["cb-100-10000001", "cb-200-20005019"]],
      ["?category=GD", ["cb-300-30000003"]],
      ["?segment=82", ["cb-100-10000001"]],
      ["?buyer=dfo-mpo", ["cb-200-20005019"]],
      ["?closing=7", ["cb-100-10000001"]],
      ["?type=Invitation%20to%20Qualify", ["cb-300-30000003"]],
    ];
    for (const [query, expected] of cases) {
      const res = await call(`/api/v1/tenders/open${query}`, shared.key);
      expect(res.status, query).toBe(200);
      const body = await json(res);
      expect(refs(body), query).toEqual(expected);
      expect(body, query).toMatchObject({ data_as_of: "2026-10-31", total: expected.length, page: 1, pages: 1, per_page: PAGE_ROWS });
    }
    expect((await json(await call("/api/v1/tenders/open?page=2", shared.key))).error).toBe("page past the last");
  });

  it("pages 100 rows at a time and never sends a government contact", async () => {
    const base = FILES["tenders/open.json"] as Record<string, unknown>[];
    const rows = Array.from({ length: 250 }, (_, i) => ({
      ...base[0], reference: `cb-900-${String(90000000 + i)}`, closing: `2026-12-${String(1 + (i % 28)).padStart(2, "0")}T14:00:00`,
      contact_name: "Officer Name", contact_email: "officer@example.invalid",
    }));
    const assets = makeFakeAssets({}, { "tenders/open.json": rows });
    const pages = [];
    for (const n of [1, 2, 3]) pages.push(await json(await call(`/api/v1/tenders/open?page=${n}`, shared.key, { ASSETS: assets })));
    expect(pages.map((p) => p.rows.length)).toEqual([100, 100, 50]);
    expect(pages.map((p) => [p.total, p.pages])).toEqual([[250, 3], [250, 3], [250, 3]]);
    expect(new Set(pages.flatMap((p) => refs(p))).size).toBe(250);
    expect(JSON.stringify(pages)).not.toMatch(/contact|officer/i);
    expect((await call("/api/v1/tenders/open?page=4", shared.key, { ASSETS: assets })).status).toBe(404);
  });

  it("answers 503 while the file is not published", async () => {
    const res = await call("/api/v1/tenders/open", shared.key, { ASSETS: makeFakeAssets({}, { "tenders/open.json": undefined }) });
    expect(res.status).toBe(503);
    expect(await json(res)).toEqual({ error: "not published yet" });
  });
});

describe("/api/v1/tenders/new", () => {
  it("answers the newest day by default and any of the last 30 that has a file", async () => {
    for (const path of ["/api/v1/tenders/new", `/api/v1/tenders/new?day=${TODAY}`]) {
      const body = await json(await call(path, shared.key));
      expect(body).toMatchObject({ day: TODAY, total: 1, page: 1, pages: 1 });
      expect(refs(body)).toEqual(["cb-200-20005019"]);
    }
    const cases: [string, string][] = [
      ["2026-10-30", "no file for that day"],
      ["2026-11-01", "day: one of the 30 days to the data date"],
      ["2026-10-01", "day: one of the 30 days to the data date"],
    ];
    for (const [day, error] of cases) {
      const res = await call(`/api/v1/tenders/new?day=${day}`, shared.key);
      expect(res.status, day).toBe(404);
      expect((await json(res)).error, day).toBe(error);
    }
  });
});

// -- the radar ------------------------------------------------------------------------------

describe("/api/v1/expiring/{window}", () => {
  it("answers a window soonest first, and 404 for anything that is not a window", async () => {
    const body = await json(await call("/api/v1/expiring/3m", shared.key));
    expect(body).toMatchObject({ window: "3m", total: 3, value_total: 4910500, page: 1, pages: 1, per_page: PAGE_ROWS });
    const ends = (body.rows as { end: string }[]).map((r) => r.end);
    expect(ends).toEqual([...ends].sort());
    for (const w of ["9m", "3M", "12m.json"]) expect((await call(`/api/v1/expiring/${w}`, shared.key)).status, w).toBe(404);
    // Not published in the fixtures.
    expect((await call("/api/v1/expiring/6m", shared.key)).status).toBe(503);
  });

  it("reads one file of 500 rows for a page of 100", async () => {
    const base = (FILES["expiring/3m/1.json"] as { rows?: unknown[] }).rows ?? (FILES["expiring/3m/1.json"] as unknown[]);
    const row = (i: number) => ({
      ...(base[0] as object), reference: `W8472-${String(100000 + i)}`, end: dayPlus("2026-11-01", Math.floor(i / 4)), days_left: 1 + Math.floor(i / 4),
    });
    const all = Array.from({ length: 1200 }, (_, i) => row(i));
    const files = {
      "expiring/12m/index.json": { window: "12m", pages: 3, rows: 1200, total: 1 },
      "expiring/12m/1.json": all.slice(0, 500), "expiring/12m/2.json": all.slice(500, 1000), "expiring/12m/3.json": all.slice(1000),
    };
    const fake = makeFakeAssets({}, files);
    const seen: string[] = [];
    const assets = {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        seen.push(new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname);
        return fake.fetch(input as RequestInfo, init);
      },
    } as unknown as Fetcher;
    const body = await json(await call("/api/v1/expiring/12m?page=6", shared.key, { ASSETS: assets }));
    expect(body).toMatchObject({ window: "12m", total: 1200, page: 6, pages: 12 });
    expect(refs(body)).toEqual(all.slice(500, 600).map((r) => r.reference));
    expect(seen.filter((p) => p.startsWith("/data/expiring/12m/"))).toEqual(["/data/expiring/12m/index.json", "/data/expiring/12m/2.json"]);
    expect((await call("/api/v1/expiring/12m?page=13", shared.key, { ASSETS: assets })).status).toBe(404);
  });
});

// -- the hosted search -----------------------------------------------------------------------------

describe("/api/v1/search", () => {
  it("answers the hosted search's organizations without their ranking tier", async () => {
    const body = await json(await call("/api/v1/search?q=Quokka%20survey", shared.key));
    expect(body).toMatchObject({ q: "quokka survey", page: 1, pages: 1, per_page: 50, organizations: { total: 1 } });
    expect(body.organizations.rows[0]).toMatchObject({ id: "org-c000000001", name: "Quokka Survey Services Ltd" });
    expect(body.organizations.rows[0]).not.toHaveProperty("tier");
    expect((await json(await call("/api/v1/search?q=quokka", shared.key))).organizations.total).toBe(2);
  });

  it("asks for at least one word, at most 200 characters, and a page that exists", async () => {
    for (const [path, status] of [
      ["/api/v1/search", 400], ["/api/v1/search?q=%22%28%29%2A", 400], [`/api/v1/search?q=${"a".repeat(201)}`, 400],
      ["/api/v1/search?q=quokka&page=2", 404],
    ] as [string, number][]) {
      expect((await call(path, shared.key)).status, path).toBe(status);
    }
    expect((await json(await call("/api/v1/search", shared.key))).error).toBe("q: at least one word of letters or digits (required)");
  });

  it("answers 503 with Retry-After while the search database cannot be read", async () => {
    const res = await call("/api/v1/search?q=quokka", shared.key, { SEARCH: undefined });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("300");
  });
});

// -- the records database ------------------------------------------------------------------------

describe("the records endpoints", () => {
  it("answer an organization's records of one source, newest fiscal year first, over the last ten years", async () => {
    const res = await call(`/api/v1/organizations/${A1}/records?source=history`, shared.key);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ organization: A1, source: "history", fiscal_years: { from: 2017, to: 2026 }, data_as_of: "2026-10-31", page: 1, next_page: null });
    // Four quarters a year for ten years, the year before them left out, a further segment's row never a record.
    expect(body.rows).toHaveLength(41);
    expect(body.rows[0]).toEqual({
      fiscal_year: 2026, fiscal_quarter: 4, segment: "82", value: 400_000 + 2026, value_note: "counted", competitive: false, method: "TN",
      buyer: { id: "pwgsc-tpsgc", name_en: "Public Services and Procurement Canada", name_fr: "Services publics et Approvisionnement Canada" },
    });
    expect(body.rows.find((r: { value_note: string }) => r.value_note === "not_published")).toMatchObject({ value: null, competitive: null, method: null });
    const years = (body.rows as { fiscal_year: number }[]).map((r) => r.fiscal_year);
    expect(years).toEqual([...years].sort((a, b) => b - a));
    expect(Math.min(...years)).toBe(2017);
    const one = await json(await call(`/api/v1/organizations/${A1}/records?source=history&year=2020`, shared.key));
    expect(one.fiscal_years).toEqual({ from: 2020, to: 2020 });
    expect((one.rows as { fiscal_year: number }[]).map((r) => r.fiscal_year)).toEqual([2020, 2020, 2020, 2020]);
  });

  it("answer a buyer's records with the organization each is paired with, null when withheld", async () => {
    const body = await json(await call("/api/v1/buyers/pwgsc-tpsgc/records?source=history&year=2025", shared.key));
    expect(body.buyer).toBe("pwgsc-tpsgc");
    expect(body.rows).toHaveLength(5);
    expect(body.rows.filter((r: { organization: unknown }) => r.organization === null)).toHaveLength(1);
    expect(body.rows.find((r: { organization: unknown }) => r.organization !== null).organization).toEqual({ id: A1, name: "Exemplar Translation Services Inc." });
    // A buyer the database knows, with nothing from this source: an empty page.
    expect(await json(await call("/api/v1/buyers/dnd-mdn/records?source=awards", shared.key))).toMatchObject({ rows: [], next_page: null });
  });

  it("page 100 rows at a time and stop at page 50", async () => {
    const pages = [];
    for (const n of [1, 2, 3]) pages.push(await json(await call(`/api/v1/organizations/${A2}/records?source=contracts&page=${n}`, shared.key)));
    expect(pages.map((p) => p.rows.length)).toEqual([100, 100, 35]);
    expect(pages.map((p) => p.next_page)).toEqual([2, 3, null]);
    expect((await call(`/api/v1/organizations/${A2}/records?source=contracts&page=4`, shared.key)).status).toBe(404);
    const past = await call(`/api/v1/organizations/${A2}/records?source=contracts&page=${RECORD_PAGES_MAX + 1}`, shared.key);
    expect(past.status).toBe(400);
    expect((await json(past)).error).toBe(`page: a whole number from 1 to ${RECORD_PAGES_MAX}`);
  });

  it("ask for a source, a year inside the ten, and an id that is one", async () => {
    const cases: [string, number, string][] = [
      [`/api/v1/organizations/${A1}/records`, 400, "source: one of awards, history, contracts, grants (required)"],
      [`/api/v1/organizations/${A1}/records?source=lobbying`, 400, "source: one of awards, history, contracts, grants (required)"],
      [`/api/v1/organizations/${A1}/records?source=history&year=2016`, 400, "year: a fiscal year from 2017 to 2026, by the year it starts in"],
      [`/api/v1/organizations/${A1}/records?source=history&year=2027`, 400, "year: a fiscal year from 2017 to 2026, by the year it starts in"],
      ["/api/v1/organizations/org-zz/records?source=history", 404, "not found"],
      ["/api/v1/organizations/org-a0000000ff/records?source=history", 404, "not found"],
      ["/api/v1/buyers/NOT_A_BUYER!/records?source=history", 404, "not found"],
      ["/api/v1/buyers/no-such-buyer/records?source=history", 404, "not found"],
    ];
    for (const [path, status, error] of cases) {
      const res = await call(path, shared.key);
      expect(res.status, path).toBe(status);
      expect((await json(res)).error, path).toBe(error);
    }
  });

  it("move a retired id to the one that took its records, the query kept", async () => {
    const buyer = await call("/api/v1/buyers/public-works-and-government-services-canada/records?source=history&year=2020", shared.key);
    expect(buyer.status).toBe(301);
    expect(buyer.headers.get("location")).toBe("/api/v1/buyers/pwgsc-tpsgc/records?source=history&year=2020");
    const org = await call("/api/v1/organizations/org-a00000000f/records?source=history", shared.key);
    expect(org.status).toBe(301);
    expect(org.headers.get("location")).toBe(`/api/v1/organizations/${A1}/records?source=history`);
  });

  it("answer 503 with Retry-After while the database is missing, loading or failing", async () => {
    const loading = {
      prepare: (s: string) => RECORDS.prepare(s),
      batch: async () => [{ results: [{ key: "state", value: "loading" }] }, { results: [] }, { results: [] }],
    } as unknown as D1Database;
    const broken = { prepare: (s: string) => RECORDS.prepare(s), batch: async () => { throw new Error("D1_ERROR: down"); } } as unknown as D1Database;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const [binding, text] of [[undefined, "the records database could not be read"], [broken, "the records database could not be read"],
        [loading, "the records database is being loaded"]] as const) {
        const res = await call(`/api/v1/organizations/${A1}/records?source=history`, shared.key, { RECORDS: binding });
        expect(res.status).toBe(503);
        expect(res.headers.get("retry-after")).toBe("300");
        expect(await json(res)).toEqual({ error: text });
      }
    } finally {
      error.mockRestore();
    }
  });

  it("are constants with ?N placeholders, each ending in a LIMIT, the lists bounded to ?3 and ?4", () => {
    for (const sql of KEYED_RECORDS_SQL) {
      expect(sql, sql).toMatch(/LIMIT \d+( OFFSET \?5)?$/);
      expect(sql, sql).not.toMatch(/\?(?!\d)/);
      expect(sql, sql).not.toMatch(/\b20[0-9]{2}\b/);
    }
    for (const sql of [BUYER_RECORDS_SQL, ORG_RECORDS_SQL]) {
      expect(sql).toContain("fy BETWEEN ?3 AND ?4");
      expect(sql).toContain(`LIMIT ${PAGE_ROWS + 1} OFFSET ?5`);
      expect(sql).toContain("extra = 0");
    }
  });

  it("read through an index, never a whole table, and never sort", async () => {
    const plan = async (sql: string, binds: (string | number)[]) =>
      ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail));
    const cases: [string, (string | number)[], string][] = [
      [BUYER_RECORDS_SQL, ["pwgsc-tpsgc", 2, 2017, 2026, 4900], "records_buyer"],
      [ORG_RECORDS_SQL, [oid(A1), 2, 2017, 2026, 4900], "records_org"],
      [BUYER_KNOWN_SQL, ["pwgsc-tpsgc"], "sqlite_autoindex_rec_buyers_1"],
      [ORG_KNOWN_SQL, [oid(A1)], "INTEGER PRIMARY KEY"],
    ];
    for (const [sql, binds, index] of cases) {
      const steps = await plan(sql, binds);
      const detail = `${sql}\n${steps.join("\n")}`;
      expect(steps.filter((s) => /^SCAN (r|o|b|records|rec_\w+)\b/.test(s) && !/USING/.test(s)), detail).toEqual([]);
      expect(steps.some((s) => s.includes(index)), detail).toBe(true);
      expect(steps.some((s) => /TEMP B-TREE/.test(s)), detail).toBe(false);
    }
  });
});

// -- the keys page ---------------------------------------------------------------------------------

describe("the keys page", () => {
  it("shows each key's requests today and over 30 days, and lists the endpoints", async () => {
    const made = await proKey("keyed-page");
    await ACCOUNTS.batch([
      ACCOUNTS.prepare("INSERT INTO api_usage (key_id, day, n) VALUES (?, ?, 7)").bind(made.keyId, "2026-10-10"),
      // Outside the 30 days.
      ACCOUNTS.prepare("INSERT INTO api_usage (key_id, day, n) VALUES (?, ?, 1000)").bind(made.keyId, "2026-10-01"),
    ]);
    for (let i = 0; i < 3; i++) await call("/api/v1/me", made.key);
    const html = decode(nbsp(await (await get("/account/keys", { cookie: made.cookie })).text()));
    expect(html).toContain('<td data-label="Today" class="num">3</td><td data-label="Last 30 days" class="num">10</td>');
    expect(html).toContain("Requests are counted by UTC day. Each key may make 20,000 a day and 600 a minute.");
    expect(html).not.toContain("No endpoint asks for one yet");
    expect(html).toContain("A key opens the keyed API under /api/v1 while the account is on Pro.");
    for (const e of KEYED_ENDPOINTS) expect(html).toContain(`<dt class="mono">GET ${e.path}</dt>`);
    expect(html).toContain('<a href="/data#api-keyed">Data</a>');
    const fr = decode(nbsp(await (await get("/account/keys?lang=fr", { cookie: made.cookie })).text()));
    expect(fr).toContain("Chaque clé peut en faire 20 000 par jour et 600 par minute.");
    expect(fr).toContain("Points d’accès");
  });

  it("says the counts cannot be read when api_usage cannot, and still lists the keys", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get("/account/keys", { cookie: shared.cookie, env: onEnv({ ACCOUNTS: failing(USAGE_SQL) }) });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("The counts cannot be read just now.");
      expect(html).toContain(`aw_${shared.key.slice(3, 11)}`);
    } finally {
      error.mockRestore();
    }
  });
});

// -- keeping and deleting ------------------------------------------------------------------------

describe("the counts' keeping", () => {
  it(`go after ${USAGE_KEEP_DAYS} days with the sign-in sweep`, async () => {
    const made = await proKey("keyed-sweep");
    const now = new Date(`${TODAY}T16:00:00Z`);
    const edge = dayPlus(TODAY, -USAGE_KEEP_DAYS);
    await ACCOUNTS.batch([dayPlus(edge, -1), edge].map((day) =>
      ACCOUNTS.prepare("INSERT INTO api_usage (key_id, day, n) VALUES (?, ?, 1)").bind(made.keyId, day)));
    await sweep({ ACCOUNTS } as unknown as Env, now);
    const days = await ACCOUNTS.prepare("SELECT day FROM api_usage WHERE key_id = ? ORDER BY day").bind(made.keyId).all<{ day: string }>();
    expect((days.results ?? []).map((r) => r.day)).toEqual([edge]);
  });

  it("go with the account's keys when the account is deleted", async () => {
    const made = await proKey("keyed-delete");
    await call("/api/v1/me", made.key);
    expect(await usageOf(made.keyId)).toBe(1);
    const res = await post("/account/delete", { csrf: await csrf(made.cookie), confirm: "yes" }, { cookie: made.cookie });
    expect(res.status).toBe(200);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM api_usage WHERE key_id = ?").bind(made.keyId).first<{ n: number }>()).toEqual({ n: 0 });
  });
});

// -- the documentation ---------------------------------------------------------------------------

describe("the documentation", () => {
  it("lists exactly the routes the sub-app registers", () => {
    const shape = (p: string) => p.replace(/\{[^}]+\}|:[a-z]+/g, ":p");
    const routes = keyedApi.routes.filter((r) => r.method === "GET").map((r) => shape(`/api/v1${r.path}`));
    expect(new Set(routes)).toEqual(new Set(KEYED_ENDPOINTS.map((e) => shape(e.path))));
    const params = new Set(KEYED_PARAMS.map(([name]) => name));
    expect(new Set(KEYED_ENDPOINTS.flatMap((e) => e.params))).toEqual(params);
  });

  it("is on the Data page while the switch is on, in both languages, with the limits and an example", async () => {
    const en = decode(nbsp(await (await get("/data")).text()));
    expect(en).toContain('<h3 id="api-keyed">Keyed API</h3>');
    for (const e of KEYED_ENDPOINTS) expect(en).toContain(`GET ${e.path}`);
    for (const [name] of KEYED_PARAMS) expect(en).toContain(`<td data-label="Parameter" class="mono">${name}</td>`);
    expect(en).toContain(`Each key may make 600 requests a minute and 20,000 a day, counted by UTC day. The limit of ${REQUEST_LIMITS.api} API requests a minute from one address applies as well.`);
    expect(en).toContain(`<pre class="cite-block">${KEYED_EXAMPLE}</pre>`);
    expect(KEYED_EXAMPLE).toBe('curl -H "Authorization: Bearer $AWARDWATCH_KEY" "https://awardwatch.ca/api/v1/tenders/open?province=ON&closing=7"');
    expect(en).toContain("A records list stops at page 50");
    const fr = decode(nbsp(await (await get("/data?lang=fr")).text()));
    expect(fr).toContain('<h3 id="api-keyed">API avec clé</h3>');
    expect(fr).toContain("Chaque clé peut faire 600 requêtes par minute et 20 000 par jour");
    for (const text of [en, fr]) expect(text).not.toContain(EM_DASH);
  });

  it("is not on the Data page while the switch is off", async () => {
    const html = await (await get("/data", { env: offEnv() })).text();
    expect(html).not.toContain("/api/v1");
    expect(html).not.toContain("api-keyed");
  });

  it("names each endpoint's template in the views roll-up, never an id", () => {
    const cases: [string, string][] = [
      ["/api/v1/tenders/open", "/api/v1/tenders/open"],
      ["/api/v1/tenders/new", "/api/v1/tenders/new"],
      ["/api/v1/search", "/api/v1/search"],
      ["/api/v1/me", "/api/v1/me"],
      ["/api/v1/expiring/12m", "/api/v1/expiring/:window"],
      [`/api/v1/organizations/${A1}/records`, "/api/v1/organizations/:id/records"],
      ["/api/v1/buyers/pwgsc-tpsgc/records", "/api/v1/buyers/:id/records"],
      ["/api/v1/anything/else", "/api/v1/other"],
    ];
    for (const [path, route] of cases) expect(routeTemplate("GET", path), path).toEqual({ route, kind: "api" });
  });
});
