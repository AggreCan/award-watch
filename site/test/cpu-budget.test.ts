// A CPU guard per route: each page rendered from the test fixtures, scaled up
// where a production file is large (the rail's 900 closing times, a profile
// shard of 90 organizations, a sitemap part of 5,000 addresses, the 3-month
// window's page of 500 contracts the landing page reads), timed in
// this run and divided by a yardstick timed in the same run (a fixed
// serialize-and-parse task), so a slower or busier machine moves both and the
// ratio holds. This is a guard, NOT a production figure: the bounds sit well
// above the ratios measured when it was written (cpu-report, 2026-11-07), so
// only a real regression trips them, such as a per-notice Intl call back in
// the rail on every page or a whole-shard parse back on a profile.
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
});
