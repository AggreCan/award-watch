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
import { sha256Hex } from "../src/account/secrets";
import { clearClosingCache } from "../src/closing";
import { clearParsedCache } from "../src/data";
import { app } from "../src/index";
import { FILES, TEST_NOW, testEnv } from "./assets";
import { PA_BUYER_PAYEES, PA_BUYER_WORKS, PA_FREE_YEARS, PA_PROFILE_ROWS } from "../src/public_accounts";
import { homeApp } from "./home";
import DND from "./fixtures/buyer-dnd-mdn.json";

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

// The landing page with the accounts switch on (the matching notices' band and the plan cards; an accounts database
// that answers nothing, which the page never asks, having no session and no payment service), and the same with
// the builder's band (BUILDER_DEMO; src/pages/landing.tsx
// BuildBand), which reads National Defence's buyer file. The file at its production size where loadBuyer checks it
// on every read: the fixture's yearly rows and 26 earlier ones (72, as on 2026-11-15), 50 recent awards, 25
// organizations a source and the 25 contracts ending soonest, copied from the PSPC fixture's rows.
function bigBuyerFile(): string {
  const pspc = FILES["buyers/pwgsc-tpsgc.json"] as Record<string, any>;
  const years = DND.years as Record<string, unknown>[];
  const oldest = years.find((y) => y.source === "contracts" && y.year === 2016);
  const holder = pspc.top_organizations.awards[0];
  return JSON.stringify({
    ...DND,
    years: [...years, ...Array.from({ length: 26 }, (_, i) => ({ ...oldest, year: 1990 + i }))],
    recent_awards: Array.from({ length: 50 }, (_, i) => ({ ...pspc.recent_awards[0], reference: `cb-${800 + i}-${80000000 + i}` })),
    top_organizations: Object.fromEntries(["awards", "contracts", "grants", "history"].map((s) => [s, Array.from({ length: 25 }, () => holder)])),
    expiring: { n: 8150, total: 13_680_359_770.34, rows: Array.from({ length: 25 }, (_, i) => ({ ...pspc.expiring.rows[0], reference: `cb-${900 + i}-${90000000 + i}` })) },
  });
}
const BIG_BUYER = bigBuyerFile();
const landingOnEnv = { ...landingEnv, ACCOUNTS_ENABLED: "true", ACCOUNTS: stubDb(() => []) };
const builderEnv = {
  ...landingOnEnv, BUILDER_DEMO: "on",
  ASSETS: assetsOf({ ...BODIES, "expiring/3m/1.json": JSON.stringify(bigExpiringPage(500)), "buyers/dnd-mdn.json": BIG_BUYER }, "v1-builder"),
};

// -- a signed-in reader's window page, with the holders' records ----------------------------

// A database that answers in memory: each statement's rows from answer(sql,
// params), for first(), all() and a batch alike. No local database runs, so
// the time is the Worker's own.
type Answer = (sql: string, params: unknown[]) => Record<string, unknown>[];
function stubDb(answer: Answer): D1Database {
  const statement = (sql: string, params: unknown[] = []): Record<string, unknown> => ({
    sql, params,
    bind: (...p: unknown[]) => statement(sql, p),
    first: async () => answer(sql, params)[0] ?? null,
    all: async () => ({ results: answer(sql, params), success: true, meta: {} }),
    run: async () => ({ results: [], success: true, meta: { changes: 0 } }),
    raw: async () => [],
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { sql: string; params: unknown[] }[]) => list.map((s) => ({ results: answer(s.sql, s.params), success: true, meta: {} })),
  } as unknown as D1Database;
}

// A Pro session the stub accounts database knows (the cookie's secret hashed
// as the sessions table holds it), last seen now so no request writes.
const SESSION_ID = "a".repeat(32);
const SESSION_SECRET = "b".repeat(64);
const SIGNED_IN = `__Host-aw_session=${SESSION_ID}.${SESSION_SECRET}`;
async function accountsStub(): Promise<D1Database> {
  const now = new Date().toISOString();
  const session = {
    id: SESSION_ID, token_hash: await sha256Hex(SESSION_SECRET), expires_at: "2999-01-01T00:00:00.000Z", revoked_at: null, last_seen_at: now,
    user_id: "u-cpu", email: "reader@example.com", lang: "en", status: "active", plan: "pro", plan_until: null, created_at: now,
  };
  // The plan statement's own half (entitlements.ts PLAN_ROWS_SQL): the account's own row, no seat.
  const pro = { via: "own", id: "e-cpu", plan: "pro", starts_at: "2026-01-01T00:00:00.000Z", ends_at: null, created_at: "2026-01-01T00:00:00.000Z", revoked_at: null };
  return stubDb((sql) => (sql.includes("FROM sessions s JOIN users u") ? [session] : sql.includes("FROM entitlements") ? [pro] : []));
}
// A record for every row a page asks for: two sources and a similar name,
// about as long as the longest the pipeline writes.
const LINE_J = JSON.stringify({
  v: 1, fy: [2017, 2026], buyer: "pwgsc-tpsgc", oid: 1,
  s: [{ src: 1, lvl: "class", key: ["821118", "811015"], held: 9, run: 3, first: "2019-04-01", total: 43, others: 17, c: 6, nc: 2, u: 1 },
    { src: 3, lvl: "code", key: ["R019"], held: 4, run: 1, first: "2021-04-01", total: 12, others: 3, c: 1, nc: 3, u: 0 }],
  own: { comp: 1, meth: "OB", bids: 3, amd: 2, growth: 0.25, end0: "2026-09-30", end: "2026-11-20" },
  sim: [["org-b000000001", "Exemplar Translation Services Limited", 1, 2, "2024-04-01"]],
});
// The earlier contracts an open notice may follow, three as Pro sees them, each
// with its holder's record (src/pages/follows.tsx), about as long as the
// pipeline writes them (titles of 200 characters).
const FOLLOW_ROWS = [1, 2, 3].map((rank) => ({
  rank, holder: "Exemplar Translation Services Inc.", buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada",
  j: JSON.stringify({
    v: 1, src: 1, ref: `cb-72${rank}-74465042`, t: ["Translation services ".repeat(10).trim(), "Services de traduction ".repeat(8).trim()],
    oid: 1, wh: 0, end: "2026-10-23", deg: rank === 1 ? "number" : "close", sol: rank === 1 ? "EN578-260001" : null, num: null,
    buyer: "dfo-mpo", client: 1, lvl: "class", code: ["821118", "811015"], words: [7, 8], days: -70, from: "start", line: JSON.parse(LINE_J),
  }),
}));
const recordsStub = stubDb((sql, params) => {
  if (sql.includes("FROM rec_meta")) return [{ key: "state", value: "ready" }, { key: "as_of", value: "2026-10-31" }];
  if (sql.includes("FROM rec_lines")) return (JSON.parse(String(params[0])) as string[]).map((sk) => ({ sk, j: LINE_J }));
  if (sql.includes("FROM rec_follows")) return FOLLOW_ROWS;
  return [];
});
// The 3-month window's first page at its production size, under its own ETags.
const signedInBody = JSON.stringify(bigExpiringPage(500));
const signedInAssets = assetsOf({ ...BODIES, "expiring/3m/1.json": signedInBody }, "v1-signed-in");

// -- payments in the Public Accounts ------------------------------------------------------
//
// The largest blocks the export writes (src/public_accounts.tsx): a profile with
// three fiscal years of 100 rows, from ten departments and six classes, a third
// of them flagged, and a buyer file with fourteen classes and fifty payees. They
// ride in the files a page reads already, so the time is the render alone.
const PA_DEPTS = ["pwgsc-tpsgc", "dnd-mdn", "ssc-spc", "esdc-edsc", "hc-sc", "cra-arc", "tbs-sct", "dfo-mpo", "ec", "pa:018"];
const PA_CLASSES = ["40", "41", "42", "43", "44", "45", "46", "47", "48", "82", "86", "87", "88", "89"];
const paProfileBlock = {
  v: 1,
  services: Array.from({ length: PA_FREE_YEARS }, (_, y) => ({
    fy: 2025 - y, n: 160, total: 98_765_432, d: PA_DEPTS.length,
    rows: Array.from({ length: PA_PROFILE_ROWS }, (_, i) => [
      PA_DEPTS[i % PA_DEPTS.length], PA_CLASSES[i % 6], 9_000_000 - i * 1_234, "Exemplar Translation Services Inc",
      i % 7 === 0 ? "Services de traduction Exemplar inc." : null, i % 5 === 0 ? "Montréal" : "Ottawa", null,
      i % 9 === 0 ? ["United Kingdom", "Royaume-Uni"] : i % 5 === 0 ? "QC" : "ON", i % 3 === 0 ? 1 : 0,
    ]),
  })),
  buyers: Object.fromEntries(PA_DEPTS.map((d) => [d, [`Department ${d}`, `Ministère ${d}`]])),
  classes: Object.fromEntries(PA_CLASSES.map((c) => [c, [`Class ${c} Services`, `Services ${c}`]])),
  loaded: [2016, 2025],
};
const paBuyerBlock = {
  v: 1, fy: 2025,
  classes: PA_CLASSES.map((c, i) => ({
    cls: c, en: `Class ${c} Services`, fr: `Services ${c}`, total: 35_098_042 - i * 1_000, named: [17, 21_593_026], under: [33, 643_992],
    federal: [4, 12_861_023], withheld: i % 4 === 0 ? 1 : 0,
  })),
  payees: Array.from({ length: PA_BUYER_PAYEES }, (_, i) => [
    `Exemplar Payee ${i} Inc`, null, i % 2 ? "org-a000000001" : null, PA_CLASSES[i % PA_CLASSES.length], 4_962_296 - i * 10_000,
    "Ottawa", null, "ON",
  ]),
  named_rows: 240,
  years: [[2025, 491_234_567]],
};
const paShard = bigProfileShard() as Record<string, Record<string, unknown>>;
paShard["org-a000000001"] = { ...paShard["org-a000000001"], public_accounts: paProfileBlock };
const paAssets = assetsOf({
  ...BODIES,
  "profiles/a00.json": JSON.stringify(paShard),
  "buyers/pwgsc-tpsgc.json": JSON.stringify({ ...(FILES["buyers/pwgsc-tpsgc.json"] as Record<string, unknown>), public_accounts: paBuyerBlock }),
}, "v1-pa");
const paEnv = { ...env, ASSETS: paAssets };
// The same blocks with the works file's largest parts (slice 2): three fiscal years of 100 contracts on the
// profile, each with its project, its place and the contractor's, a third flagged; on the buyer file the 25
// largest contracts and the line under the threshold.
const paWorksProfile = {
  ...paProfileBlock,
  works: Array.from({ length: PA_FREE_YEARS }, (_, y) => ({
    fy: 2025 - y, n: 140,
    rows: Array.from({ length: PA_PROFILE_ROWS }, (_, i) => [
      PA_DEPTS[i % PA_DEPTS.length], 25_000_000 - i * 12_345, i % 11 === 0 ? -6_606 : 1_000_000 + i, 9_000_000 - i * 1_000,
      "Exemplar Translation Services Inc", i % 7 === 0 ? "Services de traduction Exemplar inc." : null, i % 5 === 0 ? "Montréal" : "Ottawa", null,
      i % 9 === 0 ? ["United Kingdom", "Royaume-Uni"] : i % 5 === 0 ? "QC" : "ON",
      "Construction Works - Buildings, envelope repairs and the renewal of the mechanical systems of the main building",
      i % 2 ? "Travaux de construction - Bâtiments, réparation de l'enveloppe et renouvellement des systèmes mécaniques" : null,
      i % 4 === 0 ? "Various locations" : "Petawawa", i % 4 === 0 ? "Divers endroits" : null,
      i % 4 === 0 ? ["Various provinces", "Plusieurs provinces"] : "ON", i % 3 === 0 ? 1 : 0,
    ]),
  })),
};
const paWorksBuyer = {
  ...paBuyerBlock,
  works: {
    fy: 2025, n: 683,
    rows: Array.from({ length: PA_BUYER_WORKS }, (_, i) => [
      `Exemplar Builders ${i} Ltd`, null, i % 2 ? "org-a000000001" : null, "Ottawa", null, "ON",
      "Construction Works - Buildings, envelope repairs and the renewal of the mechanical systems of the main building", null,
      "Petawawa", null, "ON", 72_354_222 - i * 100_000, 5_000_000 - i * 1_000, 40_000_000 - i * 10_000, i % 2 === 0 && i % 5 === 0 ? 1 : 0,
    ]),
    under: [31, 3_556_269],
  },
};
const paWorksShard = bigProfileShard() as Record<string, Record<string, unknown>>;
paWorksShard["org-a000000001"] = { ...paWorksShard["org-a000000001"], public_accounts: paWorksProfile };
const paWorksEnv = {
  ...env,
  ASSETS: assetsOf({
    ...BODIES,
    "profiles/a00.json": JSON.stringify(paWorksShard),
    "buyers/pwgsc-tpsgc.json": JSON.stringify({ ...(FILES["buyers/pwgsc-tpsgc.json"] as Record<string, unknown>), public_accounts: paWorksBuyer }),
  }, "v1-pa-works"),
};

// -- the Indigenous procurement target ------------------------------------------------------
//
// The largest block the export writes for the 2025-26 plan (src/indigenous_target.tsx), a little larger:
// two fiscal years of 26 rows (the most of any institution) each with the longest delivery location the
// file holds in both languages, 24 gaps (the most) and a result. It rides in the buyer file the page reads
// already, so the time is the render alone.
const IPT_WHERE = ["Ontario; British Columbia (multiple sites); Ottawa, ON; NE Vancouver Island, BC; Esquimalt Harbour, BC; Ladysmith, BC; "
  + "Puntledge River, Courtenay, BC; Ucluelet, BC; Neekas Creek; Coldwater River; Babine Lake; NL; Terrace, BC; Walpole Island; Upper Morice "
  + "River; Willow River; NT; Paulatuk, NT; Mostly NCR; Canada, Québec; West Coast Vancouver Isl.; North Coast; BC+Yukon",
"Ontario; Colombie-Britannique (plusieurs sites); Ottawa (Ont.); nord-est de l'île de Vancouver (C.-B.); port d'Esquimalt (C.-B.); "
  + "Ladysmith (C.-B.); rivière Puntledge, Courtenay (C.-B.); Ucluelet (C.-B.); ruisseau Neekas; rivière Coldwater; lac Babine; T.-N.-L.; "
  + "Terrace (C.-B.); île Walpole; rivière Upper Morice; rivière Willow; Territoires du Nord-Ouest; Paulatuk (T.-N.-O.); principalement la RCN"];
const iptCodes = Array.from({ length: 50 }, (_, i) => String(400 + i));
const iptBlock = {
  v: 1,
  objects: Object.fromEntries(iptCodes.map((c, i) => [c, [
    `Economic object ${c} related to Distributed Computing Environment (DCE) and its parts and peripherals`,
    `Article économique ${c} de l'environnement d'informatique répartie, y compris pièces et périphériques`,
    i % 3 ? "Services" : "Goods, land, buildings and works", i % 3 ? "Services" : "Biens, terrains, bâtiments et travaux",
  ]])),
  plan: {
    ds: "88bd5306-e0a1-46dd-8e02-909931ade592", fy: [2025, 2026],
    years: [2025, 2026].map((fy) => ({ fy, n: 26, rows: iptCodes.slice(0, 26).map((c, i) => [c, i % 9 ? 2_989_480 - i * 1_000 : "np", i % 7 ? IPT_WHERE : "np"]) })),
  },
  gaps: { ds: "88bd5306-e0a1-46dd-8e02-909931ade592", years: [{ fy: 2025, n: 24, keys: iptCodes.slice(26), none: null }] },
  result: { ds: "65dfa39f-e699-4698-b8c7-29e1b99d7b23", fy: 2024, a: 273_885_099, b: 11_738_570_927, c: 6_447_024_797, pct: 0.0518, met: ["Yes", "Oui"] },
};
const iptEnv = {
  ...env,
  ASSETS: assetsOf({
    ...BODIES,
    "buyers/pwgsc-tpsgc.json": JSON.stringify({ ...(FILES["buyers/pwgsc-tpsgc.json"] as Record<string, unknown>), indigenous_target: iptBlock }),
  }, "v1-ipt"),
};

// -- the pages that read the records database ------------------------------------------------
//
// A published contract's page (src/pages/published.tsx) and a standing offer's page
// (src/pages/instruments.tsx), each statement of their one batch answered from memory, so the time is the
// render alone, the line of guides at the foot included (src/guide_links.tsx): a non-competitive contract
// under a mandatory set-aside with two earlier versions and long descriptions, and a regional standing
// offer with 40 holders and its call-ups.
const publishedRow = (self: 0 | 1, ref: string, cdate: string) => ({
  self, dept: "dfo-mpo", ref, pid: "F1234-260001", wh: 0, oid: 1, cdate, start: "2026-05-01", endd: "2027-03-31", value: 12_345_600,
  orig: 10_000_000, amend: self ? 2_345_600 : null, proc: "TN", comp: 0, ctype: "S", gsin: "N7010", agr: "C", trade: "0", ltr: "71",
  inst: self ? "A" : "C", period: "2026-2027-Q2", bids: 1, so_no: null, desc_en: "Harbour dredging services ".repeat(8).trim(),
  desc_fr: "Services de dragage portuaire ".repeat(8).trim(), com_en: "Amendment to extend the period of the work.", com_fr: null,
  buyer_id: "dfo-mpo", buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada", org_name: "Exemplar Translation Services Inc.",
  counted: 12_345_600, vnote: null, gsin_en: "ADP equipment", gsin_fr: "Matériel de TED",
});
const INSTRUMENT_ROW = {
  agr: "E60ZT-120002/001/ZT", type_en: "Regional Master Standing Offer", type_fr: "Offre à commandes principale régionale",
  desc_en: "Environmental consulting services", desc_fr: "Services d'experts-conseils en environnement", gsin: "R109C",
  gsin_en: "Environmental consulting services", gsin_fr: null, user_en: "Public Services and Procurement Canada",
  user_fr: "Services publics et Approvisionnement Canada", buyer: "pwgsc-tpsgc", start: "2024-04-01", expiry: "2028-03-31", segs: " 77 ",
  tref: "cb-100-10000001", n: 40, nw: 1, seen: "2026-10-30", last: "2026-10-30", calls: JSON.stringify([[1, 2, 15_000_000, 0], [null, 2, 1_500_000, 0]]),
};
const HOLDER_ROWS = Array.from({ length: 40 }, (_, i) => ({
  oid: i % 3 ? null : 1 + i, name: `Holder ${i} Environmental Consulting Ltd.`, op: null, region: "ON", region_en: "Ontario", region_fr: "Ontario",
  seen: "2026-10-30",
}));
const pageRecords = stubDb((sql) => {
  if (sql.includes("FROM rec_meta")) return [{ key: "state", value: "ready" }, { key: "as_of", value: "2026-10-31" }];
  if (sql.includes("SELECT 1 AS self")) {
    return [publishedRow(1, "C-2026-2027-Q2-00117", "2026-08-01"), publishedRow(0, "C-2026-2027-Q1-00052", "2026-05-01"),
      publishedRow(0, "C-2026-2027-Q1-00053", "2026-06-01")];
  }
  if (sql.includes("rec_contract_indigenous")) return [{ psib: "MS", ib: 0 }];
  if (sql.includes("FROM rec_instruments i")) return [INSTRUMENT_ROW];
  if (sql.includes("FROM rec_holders h")) return HOLDER_ROWS;
  return [];
});
const recordsEnv = { ...env, RECORDS: pageRecords };
const PUBLISHED_PAGE = "/contracts/dfo-mpo/C-2026-2027-Q2-00117";
const INSTRUMENT_PAGE = "/instruments/E60ZT-120002%2F001%2FZT";

// -- timing ---------------------------------------------------------------------------

let address = 0;
// home: "/" answered by the app home, as a signed-in reader gets it (test/home.ts);
// without it "/" is the landing page, there being no session here.
// signedIn: the request carries the stub's Pro session, under the signed-in environment (signedInEnv).
let signedInEnv: object | null = null;
// payments: the files carry the largest Public Accounts blocks (paEnv), and with works their works parts too
// (paWorksEnv); target: the buyer file carries the largest Indigenous procurement target block (iptEnv);
// records: the records database answers from memory (recordsEnv). landing: the landing page's environment in
// place of landingEnv (landingOnEnv, builderEnv).
async function render(
  path: string, home = false, signedIn = false, payments = false, target = false, works = false, records = false, landing?: object,
): Promise<number> {
  const res = await (home ? homeApp : app).request(path, {
    headers: {
      "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.${100 + ((address >> 8) % 100)}.${(address++ % 250) + 1}`,
      ...(signedIn ? { cookie: SIGNED_IN } : {}),
    },
  }, signedIn ? signedInEnv! : works ? paWorksEnv : payments ? paEnv : target ? iptEnv : records ? recordsEnv
    : path === "/" && !home ? (landing ?? landingEnv) : env);
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
async function ratio(
  path: string, per: number, home = false, signedIn = false, payments = false, target = false, works = false, records = false, landing?: object,
): Promise<number> {
  for (let i = 0; i < 3; i++) await render(path, home, signedIn, payments, target, works, records, landing);
  const route: number[] = [];
  const yard: number[] = [];
  for (let b = 0; b < 5; b++) {
    yard.push(await batch(yardstick, 16));
    route.push(await batch(() => render(path, home, signedIn, payments, target, works, records, landing), per));
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
  // The landing page with the accounts switch on, and with the builder's band too, which reads National Defence's
  // buyer file at its production size and draws its picture (src/pages/landing.tsx BuildBand; measured 2026-11-15
  // in one run: 2.79 and 3.39, "/" 2.50). Both are held to the bound "/" has, which the band stays well inside.
  ["/ (accounts on)", 9, 16], // [2.79]
  ["/ (accounts on, builder demo on)", 9, 16], // [3.39]
  ["/tenders", 9, 16], // [2.8]
  ["/organizations/org-a000000002", 11, 16], // [3.4]
  ["/organizations/org-a000000001", 22, 8], // [7.2]
  ["/awards/cb-400-40000004", 6, 16], // [1.8]
  ["/tenders/cb-100-10000001", 6, 16], // [1.9]
  ["/expiring/3m", 7, 16], // [2.2]
  ["/search?q=services", 16, 16], // [5.1]
  ["/sitemap-1.xml", 100, 2], // [32]
  // A Pro reader's 3-month list of 500 contracts, each named holder's record
  // read from a records database that answers at once and drawn as a mark
  // (src/pages/expiring.tsx radarLines; measured 2026-11-11). The same 500
  // rows measured 27.2 signed out and 27.4 signed in with no record: the
  // table is most of it, the records about 4.
  ["/expiring/3m (signed in, 500 rows with records)", 95, 8], // [31.6]
  // A Pro reader's open notice with may follow's panel on (FOLLOWS_PANEL; src/pages/follows.tsx): three earlier
  // contracts read beside the earlier awards and drawn with their holders' marks (measured 2026-11-14 at 2.29; the
  // same page with the panel off measured 3.25 in the next run, so the panel is within the machine's noise).
  ["/tenders/cb-100-10000001 (signed in, may follow on)", 10, 16], // [2.29]
  // Payments in the Public Accounts (src/public_accounts.tsx; measured 2026-11-11 on a busy machine): the
  // profile above with three fiscal years of 100 rows (8.2 against 5.0 without them in the same run), and the
  // buyer page without and with fourteen classes and fifty payees.
  ["/organizations/org-a000000001 (with payments, 300 rows)", 25, 8], // [8.2]
  ["/buyers/pwgsc-tpsgc", 6, 16], // [2.0]
  ["/buyers/pwgsc-tpsgc (with payments)", 9, 16], // [2.7]
  // The Indigenous procurement target (src/indigenous_target.tsx; measured 2026-11-14): the buyer page with the
  // largest block the 2025-26 plan gives, a little larger (two years of 26 rows, the longest delivery location,
  // 24 gaps); 2.6 against 1.6 for the plain page and 2.4 with the payments in the same run.
  ["/buyers/pwgsc-tpsgc (with the target)", 9, 16], // [2.6]
  // The works file's contracts beside the payments (src/public_accounts.tsx, slice 2; measured 2026-11-15): the
  // profile above with three fiscal years of 100 contracts more (13.9 against 8.0 with the payments alone in the
  // same run), and the buyer page with its 25 largest (3.9 against 3.0).
  ["/organizations/org-a000000001 (with payments and works, 600 rows)", 42, 8], // [13.9]
  ["/buyers/pwgsc-tpsgc (with payments and works)", 12, 16], // [3.9]
  // The other pages that end on the line of guides (src/guide_links.tsx; measured 2026-11-15 with the line): the
  // lists, a contract history record, the radar's overview, and the two pages that read the records database,
  // answered from memory (recordsEnv).
  ["/tenders/new", 4.5, 16], // [1.35]
  ["/awards", 4, 16], // [1.17]
  ["/history/w8472-000633", 4.5, 16], // [1.39]
  ["/expiring", 5, 16], // [1.48]
  [`${PUBLISHED_PAGE} (records in memory)`, 4.5, 16], // [1.35]
  [`${INSTRUMENT_PAGE} (records in memory)`, 4.5, 16], // [1.35]
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

const FIT_SESSION_ID = "5e55".repeat(8);
const SECRET = "c0ffee".repeat(10) + "c0ff";
const COOKIE = `__Host-aw_session=${FIT_SESSION_ID}.${SECRET}`;

// The accounts database's answers, by statement: what a statement not named here reads is nothing.
function memoryAccounts(tokenHash: string, claim: boolean): D1Database {
  const at = new Date().toISOString();
  const answer = (sql: string): { first: unknown; all: unknown[] } => {
    if (sql.includes("FROM sessions s JOIN users u")) {
      return {
        first: {
          id: FIT_SESSION_ID, token_hash: tokenHash, expires_at: "2999-01-01T00:00:00.000Z", revoked_at: null, last_seen_at: at, user_id: "budget-user",
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

// The same pages through the real app with the session cookie, the switch on and the accounts in memory.
// mark is what the page shows only for this account, so the render is the signed-in one. extra adds bindings.
async function signedInRatio(path: string, per: number, accounts: D1Database, mark: string, extra: object = {}): Promise<number> {
  const fitEnv = { ...env, ASSETS: assetsOf(FIT_BODIES, "v1-fit"), ACCOUNTS: accounts, ACCOUNTS_ENABLED: "true", ...extra };
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

// -- an Ultra account's dashboard of twelve tiles ------------------------------------------
//
// src/account/dashboard.tsx: the session, an Ultra entitlement and the
// account's rows answered from memory (its dashboard and twelve tiles stored
// on the grid: two tender searches, the 3- and 12-month lists, an
// organization search, the watches, an analytics view, a briefing, two
// blocks of the claimed organization, matching notices and the API, at
// sizes from the least to the whole row and 16 rows tall), and a records
// database that answers at once with a row or two for each statement, so
// the time is the Worker's own: the layout laid out by the grid's rules and
// every tile's menu reckoned, the 900 open notices filtered twice and
// ranked once, the radar's rows, the chart, the tables.
const DASH_AT = new Date().toISOString();
const S1 = "1".repeat(32);
const S2 = "2".repeat(32);
const S3 = "3".repeat(32);
const B1 = "4".repeat(32);
// Each tile at a place and size: [kind, ref, x, y, w, h]; the grid's rules lay them out again on the read.
const DASH_TILES = ([
  ["tenders", S1, 0, 0, 6, 10], ["tenders", S2, 6, 0, 6, 16], ["radar", "3m", 0, 10, 4, 10], ["radar", "12m", 4, 10, 8, 16], ["records", S3, 0, 20, 4, 9],
  ["watches", "", 0, 29, 12, 11], ["view", "/organizations/org-a000000001/analytics?source=awards&years=10", 0, 40, 6, 8], ["briefing", B1, 6, 40, 3, 4],
  ["org", "years", 9, 40, 3, 9], ["org", "ending", 0, 49, 12, 16], ["matches", "", 0, 65, 7, 12], ["api", "", 7, 65, 5, 8],
] as const).map(([kind, ref, x, y, w, h], i) => ({ id: `${i}`.padStart(32, "d"), kind, ref, opts: "", x, y, w, h }));
// A dashboard at Ultra's figure of 24 tiles: the twelve above and twelve more of the kinds that read the records
// database (two more tender searches, the 6-month list and a saved search of one, a buyer's and a segment's records,
// a buyer's and a segment's analytics view, a second briefing, three more blocks of the organization), at sizes from
// the least to the whole row, under the others.
const S4 = "5".repeat(32);
const S5 = "6".repeat(32);
const S6 = "7".repeat(32);
const S7 = "8".repeat(32);
const S8 = "9".repeat(32);
const B2 = "a".repeat(32);
const DASH_TILES_24 = [...DASH_TILES, ...([
  ["tenders", S4, 0, 77, 6, 10], ["tenders", S5, 6, 77, 6, 12], ["radar", "6m", 0, 89, 12, 11], ["radar", S6, 0, 100, 4, 16], ["records", S7, 4, 100, 4, 9],
  ["records", S8, 8, 100, 4, 9], ["view", "/buyers/pwgsc-tpsgc/analytics?source=awards&years=10", 0, 116, 8, 9],
  ["view", "/segments/81/analytics?source=awards&years=10", 8, 116, 4, 9], ["briefing", B2, 0, 125, 3, 6], ["org", "segments", 3, 125, 9, 9],
  ["org", "share", 0, 134, 6, 8], ["org", "buyers", 6, 134, 6, 12],
] as const).map(([kind, ref, x, y, w, h], i) => ({ id: `${i + 12}`.padStart(32, "d"), kind, ref, opts: "", x, y, w, h }))];

// A dashboard of 24 analytics tables (B3a, 2026-11-16): every table of a buyer's, an organization's and a segment's
// view, then three of them again at another source or period, at sizes from each shape's least to the whole row.
const BUYER_VIEW = "/buyers/pwgsc-tpsgc/analytics?source=awards&years=10";
const ORG_VIEW = "/organizations/org-a000000001/analytics?source=awards&years=10";
const SEGMENT_VIEW = "/segments/81/analytics?source=awards&years=10";
const ANALYTIC_REFS = [
  ...["quarters", "values", "records", "segments", "competition", "suppliers", "growth", "due"].map((x) => `${BUYER_VIEW}#table-${x}`),
  ...["years", "records", "buyers", "segments", "growth"].map((x) => `${ORG_VIEW}#table-${x}`), `${ORG_VIEW}&segment=81#table-share`,
  ...["years", "values", "records", "buyers", "winners", "entrants", "due"].map((x) => `${SEGMENT_VIEW}#table-${x}`),
  "/buyers/pwgsc-tpsgc/analytics?source=contracts&years=10#table-quarters", "/organizations/org-a000000001/analytics?source=history&years=20#table-years",
  "/segments/81/analytics?source=history&years=5#table-records",
];
const ANALYTIC_SIZES: readonly [number, number][] = [[12, 16], [7, 12], [12, 14], [4, 14], [6, 16], [8, 13]];
const DASH_ANALYTICS_24 = ANALYTIC_REFS.map((ref, i) => {
  const [w, h] = ANALYTIC_SIZES[i % ANALYTIC_SIZES.length];
  return { id: `${i}`.padStart(32, "e"), kind: "analytic", ref, opts: "", x: 0, y: i * 16, w, h };
});
// That page's records batch: the state row and each table's statements as its view reads them, with its subject's
// name (a segment's needs none): the buyer's eight tables 18 (two each, three for the segments and the suppliers,
// which read the quarters for their shares), the organization's six 15 (two each, three for the buyers, the
// segments and the share, which reads the segment's largest organizations), the segment's seven 10 (one each, two
// for the buyers, the largest organizations and the newcomers, which read the years), and the three again 5.
const DASHBOARD_ANALYTICS_STATEMENTS = 1 + 18 + 15 + 10 + 5;

function ultraAccounts(tokenHash: string, tiles: readonly Record<string, unknown>[] = DASH_TILES): D1Database {
  const at = DASH_AT;
  const session = {
    id: FIT_SESSION_ID, token_hash: tokenHash, expires_at: "2999-01-01T00:00:00.000Z", revoked_at: null, last_seen_at: at, user_id: "budget-ultra",
    email: "ultra@example.com", lang: "en", status: "active", plan: "pro", plan_until: null, created_at: at,
  };
  const all = (sql: string): Record<string, unknown>[] => {
    if (sql.includes("FROM sessions s JOIN users u")) return [session];
    if (sql.includes("FROM entitlements e LEFT JOIN entitlement_tiers")) {
      return [{ via: "own", id: "e-ultra", plan: "ultra", starts_at: "2026-01-01T00:00:00.000Z", ends_at: null, created_at: "2026-01-01T00:00:00.000Z", revoked_at: null }];
    }
    // The account's one dashboard (dashboard.tsx BOARDS_SQL), then its tiles (TILES_SQL): both statements name both tables.
    if (sql.startsWith("SELECT d.id, d.name")) return [{ id: "b".repeat(32), name: "", pos: 0, created_at: at, n: tiles.length }];
    if (sql.startsWith("SELECT id, dashboard_id")) return tiles.map((x) => ({ ...x, dashboard_id: "b".repeat(32) }));
    if (sql.includes("FROM saved_searches")) {
      return [
        { id: S1, kind: "tenders", params: "/tenders?segment=82", label: "Notices in segment 82", lang: "en", created_at: at, deliver: "off" },
        { id: S2, kind: "tenders", params: "/tenders?q=services", label: "Notices with services", lang: "en", created_at: at, deliver: "off" },
        { id: S3, kind: "organization", params: "/organizations/org-a000000001", label: "Exemplar", lang: "en", created_at: at, deliver: "off" },
        { id: S4, kind: "tenders", params: "/tenders?segment=72", label: "Notices in segment 72", lang: "en", created_at: at, deliver: "off" },
        { id: S5, kind: "tenders", params: "/tenders?segment=43", label: "Notices in segment 43", lang: "en", created_at: at, deliver: "off" },
        { id: S6, kind: "expiring", params: "/expiring/12m?buyer=pwgsc-tpsgc", label: "Ending at PSPC", lang: "en", created_at: at, deliver: "off" },
        { id: S7, kind: "buyer", params: "/buyers/pwgsc-tpsgc", label: "PSPC", lang: "en", created_at: at, deliver: "off" },
        { id: S8, kind: "segment", params: "/segments/81", label: "Segment 81", lang: "en", created_at: at, deliver: "off" },
      ];
    }
    if (sql.includes("FROM briefings")) {
      return [
        { id: B1, kind: "segment", subject: "81", segment: "", label: "81", lang: "en", created_at: at, deliver: "off", last_delivered_at: null },
        { id: B2, kind: "segment", subject: "43", segment: "", label: "43", lang: "en", created_at: at, deliver: "off", last_delivered_at: null },
      ];
    }
    if (sql.startsWith("SELECT organization_id, segment, competitors")) {
      return [{ organization_id: "org-a000000001", segment: null, competitors: "[]", created_at: at, updated_at: at }];
    }
    if (sql.includes("FROM watches")) {
      return [{ id: "w1", kind: "organization", target: "org-a000000001", segment: "", label: "Exemplar", events: "award,grant,amended,ends_12m", cadence: "daily", created_at: at, last_sent_day: null }];
    }
    if (sql.includes("FROM api_keys")) return [{ id: "k1", name: "Reports", prefix: "abcd", created_at: at, last_used_at: null, revoked_at: null }];
    return [];
  };
  const statement = (sql: string) => {
    const s = {
      sql,
      bind: () => s,
      first: async () => all(sql)[0] ?? null,
      all: async () => ({ results: all(sql), success: true, meta: {} }),
      raw: async () => [],
      run: async () => ({ results: [], success: true, meta: { changes: 0 } }),
    };
    return s;
  };
  return {
    prepare: statement,
    batch: async (list: { sql: string }[]) => list.map((s) => ({ results: all(s.sql), success: true, meta: { changes: 0 } })),
  } as unknown as D1Database;
}

// A row or two for each records statement a panel reads: the state, a radar row, a year's counts, an event.
const RADAR_J = JSON.stringify({
  kind: "award", reference: "EN578-000001", title_en: "A contract", title_fr: "Un contrat", organization_id: "org-a000000001", organization: "Exemplar",
  buyer_id: "pwgsc-tpsgc", buyer_en: "PSPC", buyer_fr: "SPAC", start: "2024-01-01", end: "2027-01-15", value: 300000, currency: "CAD", competitive: 1,
  method_en: null, method_fr: null, instrument_en: null, instrument_fr: null, n_amendments: 0, value_growth: null, tender_reference: null, segments: ["81"], provinces: ["ON"],
});
const dashRecords = stubDb((sql) => {
  if (sql.includes("FROM rec_meta")) return [{ key: "state", value: "ready" }, { key: "as_of", value: "2026-10-31" }];
  if (sql.includes("SELECT endd, j FROM rec_expiring")) return Array.from({ length: 5 }, (_, i) => ({ endd: "2027-01-15", j: RADAR_J.replace("000001", `00000${i}`) }));
  if (sql.includes("COUNT(*) AS n, SUM(cents) AS cents, SUM(nv)")) return [{ n: 12, cents: 123_456_700, n_no_value: 1 }];
  if (sql.includes("FROM records") || sql.includes("FROM rec_segment_years") || sql.includes("FROM rec_buyer_quarters")) {
    return [{ src: 1, fy: 2025, n: 4, cents: 50_000_000, n_no_value: 0, n_nc: 0 }, { src: 1, fy: 2026, n: 2, cents: 30_000_000, n_no_value: 0, n_nc: 0 }];
  }
  if (sql.includes("FROM rec_orgs")) return [{ name: "Exemplar Translation Services Inc." }];
  return [];
});

describe("CPU budget per route (a synthetic guard, not a production number)", () => {
  it("keeps each route's render within its bound over the yardstick", async () => {
    clearParsedCache();
    clearClosingCache();
    const over: string[] = [];
    const seen: string[] = [];
    signedInEnv = {
      ...env, ASSETS: signedInAssets, ACCOUNTS_ENABLED: "true", ACCOUNTS: await accountsStub(), RECORDS: recordsStub, FOLLOWS_PANEL: "on",
    };
    // What the signed-in entry times: a private page with a mark under every named holder of its 500 rows.
    const signed = await app.request("/expiring/3m", { headers: { "sec-fetch-mode": "navigate", cookie: SIGNED_IN } }, signedInEnv);
    expect(signed.headers.get("cache-control")).toBe("private, no-store");
    const marked = (await signed.text()).match(/class="muted small line-mark"/g)?.length ?? 0;
    expect(marked).toBe((JSON.parse(signedInBody) as { organization_id: unknown }[]).filter((r) => r.organization_id).length);
    expect(marked).toBeGreaterThan(300);
    // What the target's entry times: its panel drawn whole, both plan years' 26 rows and the 24 gaps.
    const withTarget = await (await app.request("/buyers/pwgsc-tpsgc", { headers: { "sec-fetch-mode": "navigate" } }, iptEnv)).text();
    expect(withTarget.match(/<td data-label="Economic object" class="lead-cell">/g)?.length).toBe(52);
    expect(withTarget.slice(withTarget.indexOf('<h2 id="indigenous-target">')).match(/<li>Economic object/g)?.length).toBe(24);
    // And on the notice: may follow's three rows, each holder with its mark.
    const notice = await (await app.request("/tenders/cb-100-10000001", { headers: { "sec-fetch-mode": "navigate", cookie: SIGNED_IN } }, signedInEnv)).text();
    expect(notice.match(/class="muted small line-mark"/g)).toHaveLength(3);
    // What the works entries time: every contract of the three years on the profile, the 25 on the buyer page.
    const worksProfile = await (await app.request("/organizations/org-a000000001", { headers: { "sec-fetch-mode": "navigate" } }, paWorksEnv)).text();
    expect(worksProfile.match(/<td data-label="Amount contracted" class="mono num">/g)?.length).toBe(PA_FREE_YEARS * PA_PROFILE_ROWS);
    const worksBuyer = await (await app.request("/buyers/pwgsc-tpsgc", { headers: { "sec-fetch-mode": "navigate" } }, paWorksEnv)).text();
    expect(worksBuyer.match(/<td data-label="Amount contracted" class="mono num">/g)?.length).toBe(PA_BUYER_WORKS);
    // And on the two pages read from the records database: the whole page, its line of guides at the foot.
    for (const [path, guides] of [[PUBLISHED_PAGE, 3], [INSTRUMENT_PAGE, 1]] as const) {
      const res = await app.request(path, { headers: { "sec-fetch-mode": "navigate" } }, recordsEnv);
      expect(res.status, path).toBe(200);
      const line = /<p class="page-foot-note">Guides: ([\s\S]*?)<\/p>/.exec(await res.text())?.[1] ?? "";
      expect(line.match(/<a href="\/guides\//g), path).toHaveLength(guides);
    }
    // What the two landing entries time: the plan cards with the accounts switch on, and the builder's band
    // beside them, its table of the buyer file's eight years and its tile, the file being 30 KB and more.
    const landingOn = await (await app.request("/", { headers: { "sec-fetch-mode": "navigate" } }, landingOnEnv)).text();
    expect(landingOn).toContain('<section class="lp-pricing"');
    expect(landingOn).not.toContain("lp-build");
    const builder = await (await app.request("/", { headers: { "sec-fetch-mode": "navigate" } }, builderEnv)).text();
    expect(builder.match(/<section class="lp-feat lp-build"/g)).toHaveLength(1);
    expect(builder.match(/<div class="tr"><span>20\d\d<\/span>/g)).toHaveLength(12);
    expect(BIG_BUYER.length).toBeGreaterThan(30_000);
    for (const [name, bound, per] of BUDGET) {
      const home = name === "/ (app home)";
      const signedIn = name.includes("(signed in");
      const payments = name.includes("(with payments");
      const target = name.includes("(with the target");
      const works = name.includes("and works");
      const records = name.includes("(records in memory");
      const landing = name.includes("builder demo on") ? builderEnv : name.includes("(accounts on") ? landingOnEnv : undefined;
      const path = home ? "/" : name.split(" ")[0];
      // The search page answers 503 without its database, after rendering in full.
      expect([200, 503], name).toContain(await render(path, home, signedIn, payments, target, works, records, landing));
      const r = await ratio(path, per, home, signedIn, payments, target, works, records, landing);
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

  // About three times the larger of two ratios measured when the dashboard was added (2026-11-11, in brackets),
  // rounded up: about as much as the 3-month list's 500 contracts signed out.
  const DASHBOARD_BOUND = 27; // [8.75, 8.36]
  it("keeps an Ultra account's dashboard of twelve tiles within its bound (accounts and records answered from memory)", async () => {
    clearParsedCache();
    clearClosingCache();
    const accounts = ultraAccounts(await sha256Hex(SECRET));
    // What the entry times: twelve tiles, each drawn from its reads at its size, none unreadable.
    const first = await app.request("/account/dashboard", { headers: { "sec-fetch-mode": "navigate", cookie: COOKIE } },
      { ...env, ASSETS: assetsOf(FIT_BODIES, "v1-fit"), ACCOUNTS: accounts, ACCOUNTS_ENABLED: "true", RECORDS: dashRecords });
    const html = await first.text();
    expect(html.match(/<section class="panel dash-tile/g)).toHaveLength(12);
    expect(html).not.toContain("This tile cannot be read right now.");
    const r = await signedInRatio("/account/dashboard", 8, accounts, '<div class="dash-grid" id="dash-grid">', { RECORDS: dashRecords });
    expect(r, `/account/dashboard, 12 tiles ${r.toFixed(2)}`).toBeLessThanOrEqual(DASHBOARD_BOUND);
  }, 120_000);

  // A dashboard at Ultra's figure, 24 tiles (B1b, 2026-11-15): about three times the larger of two ratios measured
  // then (in brackets), rounded up, beside the twelve tiles' in the same run (in the comment after).
  const DASHBOARD_24_BOUND = 44; // [14.62, 14.62]; twelve tiles [8.62, 8.77]
  // The records batch of that page: the state row and the tiles' 23 statements (two each for a window or a saved
  // search of contracts ending, the organization's ending and share blocks, and a buyer's or an organization's view;
  // one each for a records search, a segment's view and the other blocks; none for the tiles read from files or
  // from their own readers).
  const DASHBOARD_24_STATEMENTS = 24;
  it("keeps an Ultra account's dashboard of 24 tiles within its bound, its records read in one batch", async () => {
    clearParsedCache();
    clearClosingCache();
    const accounts = ultraAccounts(await sha256Hex(SECRET), DASH_TILES_24);
    // What the entry times: 24 tiles, each drawn from its reads at its size, none unreadable; the tiles' records
    // statements in one batch (the watches' and the two briefings' readers send their own, as on any page).
    const batches: number[] = [];
    const records = { ...dashRecords, batch: (list: D1PreparedStatement[]) => (batches.push(list.length), dashRecords.batch(list)) } as D1Database;
    const first = await app.request("/account/dashboard", { headers: { "sec-fetch-mode": "navigate", cookie: COOKIE } },
      { ...env, ASSETS: assetsOf(FIT_BODIES, "v1-fit"), ACCOUNTS: accounts, ACCOUNTS_ENABLED: "true", RECORDS: records });
    const html = await first.text();
    expect(html.match(/<section class="panel dash-tile/g)).toHaveLength(24);
    expect(html).not.toContain("This tile cannot be read right now.");
    expect(html).toContain('<p class="muted small">24 of 24 tiles</p>');
    expect(Math.max(...batches), batches.join(" ")).toBe(DASHBOARD_24_STATEMENTS);
    const r = await signedInRatio("/account/dashboard", 8, accounts, '<div class="dash-grid" id="dash-grid">', { RECORDS: dashRecords });
    expect(r, `/account/dashboard, 24 tiles ${r.toFixed(2)}`).toBeLessThanOrEqual(DASHBOARD_24_BOUND);
  }, 120_000);

  // A dashboard of 24 analytics tables (B3a, 2026-11-16), each a whole table of a view drawn by the view's own code
  // at its size: about three times the larger of two ratios measured then (in brackets), rounded up, beside the
  // 24 tiles of every other kind in the same run (in the comment after).
  const DASHBOARD_ANALYTICS_BOUND = 41; // [13.33, 13.57]; two runs more: [12.69, 13.17], the 24 tiles [17.08, 16.88], twelve tiles [10.64, 10.08]
  it("keeps an Ultra account's dashboard of 24 analytics tables within its bound, their records read in one batch", async () => {
    clearParsedCache();
    clearClosingCache();
    const accounts = ultraAccounts(await sha256Hex(SECRET), DASH_ANALYTICS_24);
    const batches: number[] = [];
    const records = { ...dashRecords, batch: (list: D1PreparedStatement[]) => (batches.push(list.length), dashRecords.batch(list)) } as D1Database;
    const first = await app.request("/account/dashboard", { headers: { "sec-fetch-mode": "navigate", cookie: COOKIE } },
      { ...env, ASSETS: assetsOf(FIT_BODIES, "v1-fit"), ACCOUNTS: accounts, ACCOUNTS_ENABLED: "true", RECORDS: records });
    const html = await first.text();
    expect(html.match(/<section class="panel dash-tile/g)).toHaveLength(24);
    expect(html).not.toContain("This tile cannot be read right now.");
    expect(html).not.toContain("What this tile showed was removed.");
    expect(html.match(/<div class="dash-body dash-rest/g)).toHaveLength(24);
    // One batch, and nothing read apart from it.
    expect(batches).toEqual([DASHBOARD_ANALYTICS_STATEMENTS]);
    const r = await signedInRatio("/account/dashboard", 8, accounts, '<div class="dash-grid" id="dash-grid">', { RECORDS: dashRecords });
    expect(r, `/account/dashboard, 24 analytics tables ${r.toFixed(2)}`).toBeLessThanOrEqual(DASHBOARD_ANALYTICS_BOUND);
  }, 120_000);
});
