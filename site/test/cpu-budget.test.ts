// A CPU guard per route: each page rendered from the test fixtures, scaled up
// where a production file is large (the rail's 900 closing times, a profile
// shard of 90 organizations, a sitemap part of 5,000 addresses, the 3-month
// window's page of 500 contracts the landing page reads), timed in
// this run and divided by a yardstick timed in the same run (a fixed
// serialize-and-parse task), so a slower or busier machine moves both and the
// ratio holds. This is a guard, NOT a production figure: the bounds sit well
// above the ratios measured when it was written (cpu-report, 2026-11-07), so
// only a real regression trips them, such as a per-notice Intl call back in
// the rail on every page or a whole-shard parse back on a profile. The
// matching notices' pages are timed for a signed-in account too, its
// accounts database answered from memory (below).
import { describe, expect, it } from "vitest";
import { clearClosingCache } from "../src/closing";
import { clearParsedCache } from "../src/data";
import { app } from "../src/index";
import { FILES, TEST_NOW, testEnv } from "./assets";
import { homeApp } from "./home";

// -- the scaled-up files ------------------------------------------------------------

// About as many closing times as the open notices carry, from a week before
// the tests' clock to two months after it, with and without a time of day.
function closingTimes(n: number): string[] {
  const start = Date.parse(TEST_NOW) - 7 * 86_400_000;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const day = new Date(start + Math.floor((i * 67 * 86_400_000) / n)).toISOString().slice(0, 10);
    out.push(i % 9 === 0 ? day : `${day}T${String(8 + (i % 10)).padStart(2, "0")}:${i % 2 ? "30" : "00"}:00`);
  }
  return out;
}

// A shard of 90 organizations: the fixture's two, then copies of the smaller
// one under their own ids, as most of a production shard's entries are small.
function bigProfileShard(): Record<string, unknown> {
  const base = FILES["profiles/a00.json"] as Record<string, any>;
  const out: Record<string, unknown> = { ...base };
  const small = base["org-a000000002"];
  for (let i = 0; i < 88; i++) {
    const id = `org-a00${(0x100000 + i).toString(16).slice(1)}a`;
    out[id] = { ...small, organization: { ...small.organization, id } };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

// The open list the search page counts matches in: 900 rows from the fixture's.
function bigOpenList(n: number): unknown[] {
  const rows = FILES["tenders/open.json"] as Record<string, unknown>[];
  return Array.from({ length: n }, (_, i) => ({ ...rows[i % rows.length], reference: `cb-${900 + i}-${10000000 + i}` }));
}

function bigSitemap(n: number): string {
  const urls = Array.from({ length: n }, (_, i) => `<url><loc>https://awardwatch.ca/organizations/org-${(0x1000000000 + i).toString(16)}</loc><lastmod>2026-11-07</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
}

// A page of the 3-month window as the export writes it (500 rows), from the
// fixture's rows under their own references: the landing page reads it.
function bigExpiringPage(n: number): unknown[] {
  const rows = FILES["expiring/3m/1.json"] as Record<string, unknown>[];
  return Array.from({ length: n }, (_, i) => ({ ...rows[i % rows.length], reference: `cb-${700 + i}-${70000000 + i}` }));
}

// Every file written out once, with a fixed ETag, as the assets layer serves
// a deploy's files: the shared fake (test/assets.ts) serializes and hashes a
// file on each read, which here would time the fake rather than the Worker.
const BODIES: Record<string, string> = {};
for (const [path, value] of Object.entries({
  ...FILES,
  "stats.json": { ...(FILES["stats.json"] as Record<string, unknown>), closing_soon_times: closingTimes(900) },
  "profiles/a00.json": bigProfileShard(),
  "tenders/open.json": bigOpenList(900),
})) BODIES[path] = JSON.stringify(value);
BODIES["sitemaps/sitemap-1.xml"] = bigSitemap(5000);

// tag keeps each set's ETags its own, since the parsed files are kept by ETag.
function assetsOf(bodies: Record<string, string>, tag: string): Fetcher {
  return {
    fetch: async (input: Request) => {
      const path = new URL(input.url).pathname.replace(/^\/data\//, "");
      const body = bodies[path];
      if (body === undefined) return new Response("not found", { status: 404 });
      const type = path.endsWith(".xml") ? "application/xml" : "application/json";
      return new Response(body, { headers: { "content-type": type, etag: `"${tag}-${path}"` } });
    },
  } as unknown as Fetcher;
}

const assets = assetsOf(BODIES, "v1");
// The landing page with the 3-month window's first page at its production
// size; the radar page keeps the fixture's page, as its bound was set on it.
const landingAssets = assetsOf({ ...BODIES, "expiring/3m/1.json": JSON.stringify(bigExpiringPage(500)) }, "v1-landing");

// No database bindings: a page then reads no table (the radar reads its
// window files, the search page answers that search is unavailable after
// counting the open notices), so the time is the Worker's own work and not a
// local database's round trips.
const env = { ...testEnv(assets), DB: undefined, SEARCH: undefined, RECORDS: undefined, ACCOUNTS: undefined };
const landingEnv = { ...env, ASSETS: landingAssets };

// -- timing ---------------------------------------------------------------------------

let address = 0;
// home: "/" answered by the app home, as a signed-in reader gets it (test/home.ts);
// without it "/" is the landing page, there being no session here.
async function render(path: string, home = false): Promise<number> {
  const res = await (home ? homeApp : app).request(path, {
    headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.${100 + ((address >> 8) % 100)}.${(address++ % 250) + 1}` },
  }, path === "/" && !home ? landingEnv : env);
  await res.arrayBuffer();
  return res.status;
}

async function batch(fn: () => unknown, per: number): Promise<number> {
  const t0 = performance.now();
  for (let i = 0; i < per; i++) await fn();
  return (performance.now() - t0) / per;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// The yardstick: 2,000 list rows written out and read back.
const ROWS = Array.from({ length: 2000 }, (_, i) => ({ reference: `cb-${i}-${i * 7}`, title_en: `Notice ${i}`, value: i * 1234.5, segments: ["72", "81"] }));
const yardstick = () => JSON.parse(JSON.stringify(ROWS));

// A route's time over the yardstick's, batches of each taken in turn so a
// change in the machine's load falls on both.
async function ratio(path: string, per: number, home = false): Promise<number> {
  for (let i = 0; i < 3; i++) await render(path, home);
  const route: number[] = [];
  const yard: number[] = [];
  for (let b = 0; b < 5; b++) {
    yard.push(await batch(yardstick, 16));
    route.push(await batch(() => render(path, home), per));
  }
  return median(route) / median(yard);
}

// Each bound is about three times the ratio measured on 2026-11-07 (in
// brackets), rounded up. The rail's closing count done the old way, one
// Intl call after another for every notice, put /about at 23 and every page
// over its bound (checked when this was written).
// "/ (app home)" is the app home a signed-in reader gets at "/", with the
// bound "/" had before the landing page; "/" is now the landing page, with
// the 3-month window's page of 500 contracts (measured 2026-11-08).
const BUDGET: [path: string, bound: number, per: number][] = [
  ["/about", 4.5, 16], // [1.4]
  ["/ (app home)", 10, 16], // [3.2]
  ["/", 9, 16], // [2.8]
  ["/tenders", 9, 16], // [2.8]
  ["/organizations/org-a000000002", 11, 16], // [3.4]
  ["/organizations/org-a000000001", 22, 8], // [7.2]
  ["/awards/cb-400-40000004", 6, 16], // [1.8]
  ["/tenders/cb-100-10000001", 6, 16], // [1.9]
  ["/expiring/3m", 7, 16], // [2.2]
  ["/search?q=services", 16, 16], // [5.1]
  ["/sitemap-1.xml", 100, 2], // [32]
];

// -- a signed-in account that names its organization ---------------------------------------
//
// The matching surfaces (src/account/fit_panels.tsx, fit_pages.tsx) read a
// session and the account's claim, so these renders carry a session cookie
// and an accounts database that answers from memory: the session's row, no
// entitlement (Free), the claim on org-a000000001, and nothing for any other
// statement (no watch, no saved search, no write). As above, the time is the
// Worker's own work, not a local database's round trips. The claimed profile
// carries a matching block (the scale-up shard otherwise as above), and the
// open list its 900 rows, a third of them close matches.

const MATCH_BLOCK = {
  fy: [2022, 2026], n: [7, 3, 12], coded: [7, 3], newest: "2026-09-30",
  classes: [["821118", 5, 2], ["811015", 2, 0]], families: [["8211", 5, 2], ["8110", 2, 0]], segments: [["82", 5, 2], ["81", 2, 0]],
  buyers: [["pwgsc-tpsgc", 4, 3, 0], ["dfo-mpo", 1, 0, 4]], provinces: [["ON", 6, 2], ["QC", 1, 1]],
  types: [["Request for Proposal", 5, 1]], held: [["SA", "82", 1]],
};
const FIT_BODIES: Record<string, string> = {
  ...BODIES,
  "profiles/a00.json": JSON.stringify(Object.fromEntries(Object.entries(bigProfileShard()).map(([id, p]) =>
    [id, id === "org-a000000001" ? { ...(p as object), matching: MATCH_BLOCK } : p]))),
  "stats.json": JSON.stringify({ ...JSON.parse(BODIES["stats.json"]), matching_fy: [2022, 2026] }),
};

const SESSION_ID = "5e55".repeat(8);
const SECRET = "c0ffee".repeat(10) + "c0ff";
const COOKIE = `__Host-aw_session=${SESSION_ID}.${SECRET}`;

// The accounts database's answers, by statement: what a statement not named here reads is nothing.
function memoryAccounts(tokenHash: string, claim: boolean): D1Database {
  const at = new Date().toISOString();
  const answer = (sql: string): { first: unknown; all: unknown[] } => {
    if (sql.includes("FROM sessions s JOIN users u")) {
      return {
        first: {
          id: SESSION_ID, token_hash: tokenHash, expires_at: "2999-01-01T00:00:00.000Z", revoked_at: null, last_seen_at: at, user_id: "budget-user",
          email: "budget@example.com", lang: "en", status: "active", plan: "free", plan_until: null, created_at: at,
        },
        all: [],
      };
    }
    if (claim && sql.startsWith("SELECT organization_id, segment, competitors")) {
      return { first: { organization_id: "org-a000000001", segment: null, competitors: "[]", created_at: at, updated_at: at }, all: [] };
    }
    return { first: null, all: [] };
  };
  const statement = (sql: string) => {
    const s = {
      bind: () => s,
      first: async () => answer(sql).first,
      all: async () => ({ results: answer(sql).all, success: true, meta: {} }),
      raw: async () => [],
      run: async () => ({ results: [], success: true, meta: { changes: 0 } }),
    };
    return s;
  };
  return {
    prepare: statement,
    batch: async (list: unknown[]) => list.map(() => ({ results: [], success: true, meta: { changes: 0 } })),
  } as unknown as D1Database;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The same pages through the real app with the session cookie, the switch on and the accounts in memory.
// mark is what the page shows only for this account, so the render is the signed-in one.
async function signedInRatio(path: string, per: number, accounts: D1Database, mark: string): Promise<number> {
  const fitEnv = { ...env, ASSETS: assetsOf(FIT_BODIES, "v1-fit"), ACCOUNTS: accounts, ACCOUNTS_ENABLED: "true" };
  const request = () => app.request(path, {
    headers: { "sec-fetch-mode": "navigate", cookie: COOKIE, "cf-connecting-ip": `198.18.${100 + ((address >> 8) % 100)}.${(address++ % 250) + 1}` },
  }, fitEnv);
  const go = async () => {
    const res = await request();
    await res.arrayBuffer();
    return res.status;
  };
  const first = await request();
  expect(first.status, path).toBe(200);
  expect(first.headers.get("cache-control"), path).toBe("private, no-store");
  expect(await first.text(), path).toContain(mark);
  for (let i = 0; i < 3; i++) await go();
  const route: number[] = [];
  const yard: number[] = [];
  for (let b = 0; b < 5; b++) {
    yard.push(await batch(yardstick, 16));
    route.push(await batch(go, per));
  }
  return median(route) / median(yard);
}

// Each bound about three times the larger of two ratios measured when the
// panels were added (2026-11-11, in brackets, on a busy machine), rounded up.
// "no claim" is the same page for a signed-in account that names no
// organization: the signed-in path as it was before the panels, beside which
// the claim's read and the panel show.
const SIGNED_IN_BUDGET: [name: string, path: string, claim: boolean, mark: string, bound: number, per: number][] = [
  ["/tenders/cb-100-10000001, no claim", "/tenders/cb-100-10000001", false, "Tell the site which organization", 6, 16], // [2.0]
  ["/tenders/cb-100-10000001, claim", "/tenders/cb-100-10000001", true, "Match With Your Organization", 11, 16], // [3.4]
  ["/tenders, no claim", "/tenders", false, "data-save-search", 8, 16], // [2.4]
  ["/tenders, claim", "/tenders", true, 'id="fit-data"', 13, 16], // [4.3]
  ["/account/organization, claim", "/account/organization", true, "<h2>Notices Matching ", 21, 8], // [6.7]
  ["/account/matches, claim", "/account/matches", true, "<h2>Open Notices That Match</h2>", 21, 8], // [6.9]
];

describe("CPU budget per route (a synthetic guard, not a production number)", () => {
  it("keeps each route's render within its bound over the yardstick", async () => {
    clearParsedCache();
    clearClosingCache();
    const over: string[] = [];
    const seen: string[] = [];
    for (const [name, bound, per] of BUDGET) {
      const home = name === "/ (app home)";
      const path = home ? "/" : name;
      // The search page answers 503 without its database, after rendering in full.
      expect([200, 503], name).toContain(await render(path, home));
      const r = await ratio(path, per, home);
      seen.push(`${name} ${r.toFixed(2)}`);
      if (r > bound) over.push(`${name}: ${r.toFixed(2)} over ${bound}`);
    }
    expect(over, seen.join(", ")).toEqual([]);
  }, 120_000);

  it("keeps the matching surfaces of a signed-in account within their bounds (accounts answered from memory)", async () => {
    clearParsedCache();
    clearClosingCache();
    const hash = await sha256Hex(SECRET);
    const over: string[] = [];
    const seen: string[] = [];
    for (const [name, path, claim, mark, bound, per] of SIGNED_IN_BUDGET) {
      const r = await signedInRatio(path, per, memoryAccounts(hash, claim), mark);
      seen.push(`${name} ${r.toFixed(2)}`);
      if (r > bound) over.push(`${name}: ${r.toFixed(2)} over ${bound}`);
    }
    expect(over, seen.join(", ")).toEqual([]);
  }, 120_000);
});
