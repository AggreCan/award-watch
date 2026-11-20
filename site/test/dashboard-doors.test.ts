// Add a Tile's Analytics door (src/account/dashboard_doors.tsx; docs/accounts.md, Dashboard): the find page (a
// buyer's, an organization's and a segment's query, an empty one, one with no match), a subject's checklist of
// analytics tables at each view (its sources and periods, a table that does not apply, the ones on the dashboard
// already) and its post (one table, several, more than fit, a table refused, a second dashboard, another
// account's), the checklist from a saved view's row, and the starters of an empty dashboard; each reader at each
// new address; the three states of storage; both languages. The records and the search databases are built here
// from the pipeline's schemas with the rows below.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { START_H, placeAll, startSize } from "../public/dash-grid.js";
import { LAYOUT_MARKER } from "../src/account/dashboard";
import { STARTER_PANEL_SQL, STARTER_TILE_SQL, segmentMatches } from "../src/account/dashboard_doors";
import { DASHBOARD_STRINGS } from "../src/account/dashboard_strings";
import { bucketFor } from "../src/limits";
import { allKeys, rawEntry, t, type Key } from "../src/i18n";
import { VIEW_TABLES, tableApplies } from "../src/pages/analytics";
import { MONEY_SOURCES } from "../src/constants";
import { PERIODS, SEGMENT_SOURCES, orgNumber } from "../src/records_db";
import { foldText } from "../src/search_db";
import accountsSchema from "../accounts_schema.sql?raw";
import {
  ACCOUNTS, PRO_SALE, csrf, decode, get, grantPro, grantUltra, nbsp, newEmail, onEnv, post, signIn, ultraEnv, useAccountsDb, userId,
} from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { applySql, splitSql } from "./setup";
import { misfits } from "./table-fit";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const SEARCH_SCHEMA = (env as unknown as { SEARCH_SCHEMA_SQL: string }).SEARCH_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const n = (id: string) => orgNumber(id) as number;

const A1 = "org-a000000001"; // Exemplar Translation Services Inc., the fixtures' profile
const NAME1 = "Exemplar Translation Services Inc.";
const PSPC_NAME = "Public Services and Procurement Canada";
const ASSETS = makeFakeAssets({}, { "profiles/a00.json": FILES["profiles/a00.json"] as object });
// Ultra off sale (Pro's prices alone), or on sale; the switch on in both.
const off = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS, ...PRO_SALE, ...extra });
const sale = (extra: Record<string, unknown> = {}) => ultraEnv({ ASSETS, ...extra });

const norm = (s: string) => nbsp(s).replace(/’/g, "'");
const text = async (res: Response) => norm(decode(await res.text()));
const mainOf = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));

// -- the two databases -------------------------------------------------------------------------

const PSPC = 101;
const DFO = 103;
// The organization's records: award notices in segments 81 (the larger) and 43, a contract history record and a
// published contract with no segment, so its share table has segments at award notices and none at the history.
const RECS = [
  { src: 1, fy: 2026, fq: 1, bid: PSPC, oid: n(A1), sid: 81, cents: 50_000_000 },
  { src: 1, fy: 2025, fq: 3, bid: DFO, oid: n(A1), sid: 43, cents: 2_000_000 },
  { src: 2, fy: 2026, fq: 1, bid: PSPC, oid: n(A1), sid: null, cents: 1_000_000 },
  { src: 3, fy: 2026, fq: 2, bid: DFO, oid: n(A1), sid: null, cents: 1_234_500 },
];
// Eight organizations named Exemplar (more than the find page lists of a kind among the three) and two buyers.
const EXEMPLARS = Array.from({ length: 8 }, (_, i) => ({
  id: `org-a00000000${i + 1}`, name: i ? `Exemplar Holdings ${i + 1} Ltd.` : NAME1, records: 100 - i * 10, prov: i % 2 ? "QC" : "ON",
}));

beforeAll(async () => {
  await applySql(RECORDS, RECORDS_SCHEMA);
  await RECORDS.batch(["records", "rec_orgs", "rec_buyers", "rec_meta", "rec_segment_years", "rec_buyer_quarters"].map((x) => RECORDS.prepare(`DELETE FROM ${x}`)));
  await RECORDS.batch([
    ...RECS.map((r, i) => RECORDS.prepare(
      "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote, comp, ref, title) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 1, ?, ?)",
    ).bind(r.src, r.fy, r.fq, r.bid, r.oid, r.sid, r.cents, `REF-${i}`, `Record ${i}`)),
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, ?)").bind(n(A1), NAME1),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'pwgsc-tpsgc', ?, 'Services publics et Approvisionnement Canada')").bind(PSPC, PSPC_NAME),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dfo-mpo', 'Fisheries and Oceans Canada', 'Pêches et Océans Canada')").bind(DFO),
    RECORDS.prepare("INSERT INTO rec_segment_years (sid, src, fy, n, cents, n_no_value, n_buyers, n_orgs, n_pos) SELECT sid, src, fy, COUNT(*), " +
      "SUM(cents), 0, COUNT(DISTINCT bid), COUNT(DISTINCT oid), COUNT(*) FROM records WHERE sid IS NOT NULL GROUP BY sid, src, fy"),
    RECORDS.prepare("INSERT INTO rec_buyer_quarters (bid, src, fy, fq, n, cents, n_no_value) SELECT bid, src, fy, fq, COUNT(*), SUM(cents), 0 FROM records GROUP BY bid, src, fy, fq"),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', '2026-10-31'), ('rules', '2')"),
  ]);
  await applySql(SEARCH, SEARCH_SCHEMA);
  await SEARCH.batch([SEARCH.prepare("DELETE FROM search_orgs"), SEARCH.prepare("DELETE FROM search_buyers")]);
  await SEARCH.batch(EXEMPLARS.map((o) => SEARCH.prepare(
    "INSERT INTO search_orgs (id, name, alt, bn, folds, prov, city, n_awards, n_history, n_contracts, n_grants, n_lobbying, n_records, total_awards, " +
    "total_history, total_contracts, total_grants, hash) VALUES (?, ?, '', '', ?, ?, 'Ottawa', ?, 0, 1, 0, 0, ?, 100, NULL, 10, NULL, 'h')",
  ).bind(o.id, o.name, foldText(o.name), o.prov, o.records - 1, o.records)));
  const buyer = "INSERT INTO search_buyers (id, name, name_fr, acronym_en, acronym_fr, alt, folds, kind, n_tenders, n_open_tenders, n_awards, n_history, " +
    "n_contracts, n_grants, n_records, total_awards, total_history, total_contracts, total_grants, hash) VALUES (?, ?, ?, ?, ?, ?, ?, 'department', 1, 1, ?, ?, 1, 0, ?, 1, 2, 3, NULL, 'h')";
  await SEARCH.batch([
    // PSPC's largest source is its contract history; DFO's its award notices.
    SEARCH.prepare(buyer).bind("pwgsc-tpsgc", PSPC_NAME, "Services publics et Approvisionnement Canada", "PSPC", "SPAC", "PSPC\nSPAC",
      [PSPC_NAME, "Services publics et Approvisionnement Canada", "PSPC", "SPAC"].map(foldText).join("\n"), 2, 9, 12),
    SEARCH.prepare(buyer).bind("dfo-mpo", "Fisheries and Oceans Canada", "Pêches et Océans Canada", "DFO", "MPO", "DFO\nMPO",
      ["Fisheries and Oceans Canada", "Pêches et Océans Canada", "DFO", "MPO"].map(foldText).join("\n"), 7, 1, 9),
  ]);
});

// -- accounts --------------------------------------------------------------------------------------

type Reader = { email: string; id: string; cookie: string; csrf: string };

async function reader(tag: string, plan: "free" | "pro" | "ultra" = "ultra"): Promise<Reader> {
  const email = newEmail(tag);
  const cookie = await signIn(email, { env: off() });
  if (plan === "pro") await grantPro(email);
  if (plan === "ultra") await grantUltra(email);
  return { email, id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env: off() }) };
}

const open = (r: Reader | null, path = "/account/dashboard", e: object = off()) => get(path, { cookie: r?.cookie, env: e });
// A form post with the reader's CSRF value; pairs send a field more than once (the checklist's table).
const send = (r: Reader, path: string, fields: Record<string, string> | [string, string][] = {}, e: object = off()) =>
  post(path, Array.isArray(fields) ? [["csrf", r.csrf], ...fields] : { csrf: r.csrf, ...fields }, { cookie: r.cookie, env: e });

type TileRow = { id: string; kind: string; ref: string; x: number; y: number; w: number; h: number };
const tileRows = (id: string) => ACCOUNTS.prepare("SELECT id, kind, ref, x, y, w, h FROM dashboard_tiles WHERE user_id = ? ORDER BY y, x, id")
  .bind(id).all<TileRow>().then((r) => r.results ?? []);
const boardTiles = (board: string) => ACCOUNTS.prepare("SELECT id, kind, ref, x, y, w, h FROM dashboard_tiles WHERE dashboard_id = ? ORDER BY y, x, id")
  .bind(board).all<TileRow>().then((r) => r.results ?? []);
const boards = (id: string) => ACCOUNTS.prepare("SELECT id FROM dashboards WHERE user_id = ? ORDER BY pos").bind(id).all<{ id: string }>()
  .then((r) => (r.results ?? []).map((x) => x.id));
const panelRows = (id: string) => ACCOUNTS.prepare("SELECT id, kind, ref, wide FROM dashboard_panels WHERE user_id = ? ORDER BY pos, created_at, id")
  .bind(id).all<{ id: string; kind: string; ref: string; wide: number }>().then((r) => r.results ?? []);

async function newBoard(r: Reader): Promise<string> {
  const res = await send(r, "/account/dashboard/boards");
  expect(res.headers.get("location")).toMatch(/^\/account\/dashboard\/[0-9a-f]{32}$/);
  return res.headers.get("location")!.slice("/account/dashboard/".length);
}
// n tiles written straight into a dashboard (saved tender searches by made-up ids), so it nears its figure.
async function fill(r: Reader, board: string, count: number): Promise<void> {
  const at = new Date().toISOString();
  await ACCOUNTS.batch(Array.from({ length: count }, (_, i) => ACCOUNTS.prepare(
    "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, 'tenders', ?, '', 0, ?, 6, 10, ?)",
  ).bind(crypto.randomUUID().replace(/-/g, ""), board, r.id, `f${i}`.padStart(32, "0"), 200 + 10 * i, at)));
}

// The grid's tables, or with them the panels' table, taken off the database for the length of fn and made again
// from accounts_schema.sql with their rows put back: the database before the operator applied the schema.
async function without<T>(which: "tiles" | "all", fn: () => Promise<T>): Promise<T> {
  const tables = which === "tiles" ? ["dashboard_tiles", "dashboards"] : ["dashboard_tiles", "dashboards", "dashboard_panels"];
  const kept = new Map<string, Record<string, unknown>[]>();
  for (const table of tables) kept.set(table, (await ACCOUNTS.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>()).results ?? []);
  for (const table of tables) await ACCOUNTS.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  try {
    return await fn();
  } finally {
    const own = new RegExp(`\\b(?:TABLE IF NOT EXISTS|ON) (?:${tables.join("|")})\\b`);
    await ACCOUNTS.batch(splitSql(accountsSchema).filter((s) => own.test(s)).map((s) => ACCOUNTS.prepare(s)));
    for (const table of [...tables].reverse()) {
      for (const row of kept.get(table) ?? []) {
        const cols = Object.keys(row);
        await ACCOUNTS.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => row[c])).run();
      }
    }
  }
}

// A binding that throws on any use, and the names it was asked for: a page that must read nothing from it.
const trap = () => {
  const used: string[] = [];
  const db = new Proxy({}, { get(_t, prop) { used.push(String(prop)); throw new Error("read"); } }) as D1Database;
  return { db, used };
};

// -- the pages' parts --------------------------------------------------------------------------------

// The find page's groups: each panel's title, its count, its matches' links and names, its foot's link.
type Group = { title: string; count: string; links: string[]; names: string[]; more: string | null };
function groupsOf(html: string): Group[] {
  return mainOf(html).split('<section class="panel">').slice(1).map((s) => ({
    title: /<h2>([^<]*)<\/h2>/.exec(s)?.[1] ?? "", count: /<span class="panel-count">([^<]*)<\/span>/.exec(s)?.[1] ?? "",
    links: [...s.matchAll(/<li><a href="([^"]*)">/g)].map((m) => m[1]), names: [...s.matchAll(/<li><a href="[^"]*">([^<]*)<\/a>/g)].map((m) => m[1]),
    more: /<div class="panel-foot"><a href="([^"]*)">/.exec(s)?.[1] ?? null,
  }));
}
// The checklist's items: each table's box, whether it is checked or left out, and its line.
type Check = { table: string; checked: boolean; off: boolean; note: string };
function checksOf(html: string): Check[] {
  const list = /<ul class="plain dash-checks"[^>]*>([\s\S]*?)<\/ul>/.exec(mainOf(html))?.[1] ?? "";
  return list.split("<li").slice(1).map((s) => {
    const box = /<input type="checkbox" name="table" value="([a-z]+)"([^>]*)\/>/.exec(s)!;
    return {
      table: box[1], checked: box[2].includes("checked"), off: box[2].includes("disabled"),
      note: [...s.matchAll(/<span class="muted small dash-check-note">([^<]*)<\/span>/g)].map((m) => m[1]).join(" "),
    };
  });
}
const selected = (html: string, name: string) => /<option value="([^"]*)" selected="">/.exec(new RegExp(`<select name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(mainOf(html))?.[1] ?? "")?.[1] ?? null;
const optionsOf = (html: string, name: string) =>
  [...(new RegExp(`<select name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(mainOf(html))?.[1] ?? "").matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
const noticeOf = (html: string) => /<p class="account-notice" role="status">([^<]*)<\/p>/.exec(mainOf(html))?.[1] ?? null;
const ref = (view: string, table: string) => `${view}#table-${table}`;
const PSPC_VIEW = "/buyers/pwgsc-tpsgc/analytics?source=awards&years=10";
const ORG_VIEW = `/organizations/${A1}/analytics?source=awards&years=10`;
const TABLES = (base: string) => `/account/dashboard/tables/${base}`;
// The checklist's post: its view's source and period, the tables checked, and the rest of the fields.
const tablesPost = (r: Reader, base: string, tables: readonly string[], more: [string, string][] = [["source", "awards"], ["years", "10"]]) =>
  send(r, TABLES(base), [...more, ...tables.map((x): [string, string] => ["table", x])]);

// =====================================================================================

describe("the find page", () => {
  it("lists a few buyers, organizations and segments a query names, as the site's search finds and ranks them, each to its checklist", async () => {
    const r = await reader("doors-find");
    // An organization's name: its first six of the eight, in /search's order, with the way to all of them there.
    const html = await text(await open(r, "/account/dashboard/find?q=exemplar"));
    const [orgs, ...rest] = groupsOf(html);
    expect(rest).toEqual([]);
    expect(orgs.title).toBe("Organizations");
    expect(orgs.count).toBe("6 of 8");
    expect(orgs.more).toBe("/search?q=exemplar");
    const site = await text(await open(r, "/search?q=exemplar"));
    const ranked = [...mainOf(site).matchAll(/<a href="\/organizations\/(org-[0-9a-f]{10})">/g)].map((m) => m[1]);
    expect(ranked).toHaveLength(8);
    expect(orgs.links).toEqual(ranked.slice(0, 6).map((id) => `/account/dashboard/tables/organizations/${id}?source=awards&years=10`));
    expect(orgs.names[0]).toBe(NAME1);
    expect(mainOf(html)).toContain(`<a href="/account/dashboard/tables/organizations/${A1}?source=awards&years=10">${NAME1}</a><span class="muted small">Ottawa, Ontario</span>`);
    // A buyer's acronym: the buyer, opening on its largest source, its contract history.
    const buyers = groupsOf(await text(await open(r, "/account/dashboard/find?q=pspc")));
    expect(buyers.map((g) => [g.title, g.count, g.links])).toEqual([["Buyers", "1", ["/account/dashboard/tables/buyers/pwgsc-tpsgc?source=history&years=10"]]]);
    // A segment's word: the segments whose code or title holds it, from the site's list of 57; and its code.
    const segs = groupsOf(await text(await open(r, "/account/dashboard/find?q=engineering")));
    expect(segs.map((g) => g.title)).toEqual(["Segments"]);
    expect(segs[0].links).toContain("/account/dashboard/tables/segments/81?source=awards&years=10");
    expect(segs[0].names).toContain("81 Engineering and Research and Technology Based Services");
    expect(segmentMatches(["81"])).toEqual(["81"]);
    expect(segmentMatches(["ingenierie"])).toContain("81");
    // A query that names all three kinds, a few of each: "services" names a buyer, an organization and segments.
    const all = groupsOf(await text(await open(r, "/account/dashboard/find?q=services")));
    expect(all.map((g) => g.title)).toEqual(["Buyers", "Organizations", "Segments"]);
    expect(all.every((g) => g.links.length <= 6)).toBe(true);
    const seg = all[2];
    if (seg.links.length < Number(seg.count.split(" ").pop())) expect(seg.more).toBe("/account/dashboard/find?q=services&kind=segment");
  });

  it("says what it searches for an empty query and when nothing matches, and lists every segment for the segment starter", async () => {
    const r = await reader("doors-find-empty");
    const empty = await text(await open(r, "/account/dashboard/find"));
    expect(mainOf(empty)).toContain(`<p class="muted dash-find-line" role="status">${t("en", "dash.find_empty")}</p>`);
    expect(groupsOf(empty)).toEqual([]);
    const none = await text(await open(r, "/account/dashboard/find?q=zzqxw"));
    expect(mainOf(none)).toContain(t("en", "dash.find_none", { q: "zzqxw" }));
    expect(groupsOf(none)).toEqual([]);
    // Markup in a query is text.
    const markup = await (await open(r, `/account/dashboard/find?q=${encodeURIComponent("<b>x</b>")}`)).text();
    expect(markup).not.toContain("<b>x</b>");
    // The segment starter: every segment, no query needed, each to its checklist with every table checked.
    const segments = await text(await open(r, "/account/dashboard/find?kind=segment&all=1"));
    const [g] = groupsOf(segments);
    expect(g.links).toHaveLength(57);
    expect(g.links.every((l) => /^\/account\/dashboard\/tables\/segments\/[0-9]{2}\?source=awards&years=10&all=1$/.test(l))).toBe(true);
    expect(mainOf(segments)).toContain("<h1>Choose a Segment</h1>");
    // The buyer starter: buyers alone.
    const only = groupsOf(await text(await open(r, "/account/dashboard/find?kind=buyer&all=1&q=services")));
    expect(only.map((g) => g.title)).toEqual(["Buyers"]);
    expect(only[0].links).toEqual(["/account/dashboard/tables/buyers/pwgsc-tpsgc?source=history&years=10&all=1"]);
  });

  it("reads the search database's one batch for a query, nothing else, and nothing for the segments alone", async () => {
    const r = await reader("doors-find-reads");
    const batches: number[] = [];
    const search = new Proxy(SEARCH, {
      get(target, prop) {
        if (prop === "batch") return (list: D1PreparedStatement[]) => (batches.push(list.length), target.batch(list));
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const records = trap();
    expect((await open(r, "/account/dashboard/find?q=exemplar", off({ SEARCH: search, RECORDS: records.db }))).status).toBe(200);
    // /search's first page: both counts, the organizations and the buyers.
    expect(batches).toEqual([4]);
    const segs = trap();
    expect((await open(r, "/account/dashboard/find?kind=segment&q=engineering", off({ SEARCH: segs.db, RECORDS: records.db }))).status).toBe(200);
    expect(segs.used).toEqual([]);
    expect(records.used).toEqual([]);
    // The search database unavailable: the page says so and still lists the segments.
    const down = await text(await open(r, "/account/dashboard/find?q=services", off({ SEARCH: undefined })));
    expect(mainOf(down)).toContain(t("en", "dash.find_unavailable"));
    expect(groupsOf(down).map((g) => g.title)).toEqual(["Segments"]);
  });

  it("carries the dashboard it was opened from, refuses one the account does not hold, and is private, flat but for Find", async () => {
    const r = await reader("doors-find-board");
    const b2 = await newBoard(r);
    const res = await open(r, `/account/dashboard/find?q=pspc&board=${b2}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const html = await text(res);
    expect(mainOf(html)).toContain(`<p class="lead">${t("en", "dash.find_lead", { name: "Dashboard 2" })}</p>`);
    expect(mainOf(html)).toContain(`<a href="/account/dashboard/${b2}" class="btn">Back to the dashboard</a>`);
    expect(mainOf(html)).toContain(`<input type="hidden" name="board" value="${b2}"/>`);
    expect(groupsOf(html)[0].links).toEqual([`/account/dashboard/tables/buyers/pwgsc-tpsgc?source=history&years=10&board=${b2}`]);
    expect(mainOf(html).match(/btn-primary/g)).toHaveLength(1);
    expect(mainOf(html)).toContain('<button type="submit" class="btn btn-primary">Find</button>');
    expect(html).not.toContain(EM_DASH);
    expect(html).not.toContain(EN_DASH);
    const other = await reader("doors-find-board-other");
    expect((await open(other, `/account/dashboard/find?q=pspc&board=${b2}`)).headers.get("location")).toBe("/account/dashboard");
    expect((await open(other, `/account/dashboard/find?board=nonsense&lang=fr`)).headers.get("location")).toBe("/account/dashboard?lang=fr");
  });
});

describe("each reader at the new addresses", () => {
  const GETS = ["/account/dashboard/find?q=pspc", `/account/dashboard/tables/organizations/${A1}?source=awards&years=10`];
  const POSTS: [string, [string, string][]][] = [
    [TABLES(`organizations/${A1}`), [["source", "awards"], ["years", "10"], ["table", "years"]]], ["/account/dashboard/starter", [["starter", "ending"]]],
  ];

  it("is the site's 404 while Ultra is off sale for anyone who does not hold it; a post goes to the dashboard's address and writes nothing", async () => {
    const free = await reader("doors-off-free", "free");
    const pro = await reader("doors-off-pro", "pro");
    for (const path of GETS) {
      for (const r of [null, free, pro]) {
        const res = await open(r, path);
        expect(res.status, path).toBe(404);
        expect(res.headers.get("cache-control"), path).toContain("no-store");
      }
    }
    for (const [path, fields] of POSTS) {
      for (const r of [free, pro]) {
        const res = await send(r, path, fields);
        expect(res.status, path).toBe(303);
        expect(res.headers.get("location"), path).toBe("/account/dashboard");
        expect(await tileRows(r.id)).toEqual([]);
        expect(await panelRows(r.id)).toEqual([]);
      }
      const out = await post(path, fields, { env: off() });
      expect(out.headers.get("location"), path).toBe("/account/sign-in");
    }
  });

  it("while Ultra is on sale gives Free and Pro what the dashboard holds, reading no record and no search, and a reader signed out the sign-in page", async () => {
    for (const plan of ["free", "pro"] as const) {
      const r = await reader(`doors-sale-${plan}`, plan);
      for (const path of GETS) {
        const records = trap();
        const search = trap();
        const res = await open(r, path, sale({ RECORDS: records.db, SEARCH: search.db }));
        expect(res.status, path).toBe(200);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        const main = mainOf(await text(res));
        expect(main).toContain(`<h2>${t("en", "dash.what_title")}</h2>`);
        expect(main).not.toContain("dash-checks");
        expect(main).not.toContain("dash-matches");
        expect(records.used).toEqual([]);
        expect(search.used).toEqual([]);
      }
    }
    for (const path of GETS) {
      expect((await open(null, path, sale())).headers.get("location")).toBe(`/account/sign-in?next=${encodeURIComponent(path)}`);
    }
  });

  it("counts every new read and post in the edit bucket, and takes every post through the session, the CSRF value and the Origin", async () => {
    for (const path of ["/account/dashboard/find", `/account/dashboard/tables/buyers/pwgsc-tpsgc`, `/account/dashboard/tables/organizations/${A1}`, "/account/dashboard/tables/segments/81"]) {
      expect(bucketFor("GET", path), path).toBe("edit");
    }
    for (const path of [`/account/dashboard/tables/buyers/pwgsc-tpsgc`, "/account/dashboard/tables/segments/81", "/account/dashboard/starter"]) {
      expect(bucketFor("POST", path), path).toBe("edit");
    }
    for (const path of ["/account/dashboard/findx", "/account/dashboard/tables/widgets/x", "/account/dashboard/tables/buyers/a/b"]) expect(bucketFor("GET", path), path).toBe("page");
    const r = await reader("doors-posts");
    for (const [path, fields] of POSTS) {
      expect((await post(path, fields, { cookie: r.cookie, env: off() })).status, path).toBe(403);
      expect((await post(path, [["csrf", r.csrf], ...fields], { cookie: r.cookie, env: off(), origin: "https://evil.example" })).status, path).toBe(403);
    }
    expect(await tileRows(r.id)).toEqual([]);
    expect((await open(r, "/account/dashboard/tables/widgets/x")).status).toBe(404);
  });
});

describe("the checklist", () => {
  it("names the subject and offers the sources and periods its view offers Ultra, every table by its title, at each view", async () => {
    const r = await reader("doors-list");
    for (const [base, name, sources, tables] of [
      ["buyers/pwgsc-tpsgc", PSPC_NAME, MONEY_SOURCES, VIEW_TABLES.buyer], [`organizations/${A1}`, NAME1, MONEY_SOURCES, VIEW_TABLES.organization],
      ["segments/81", "81 Engineering and Research and Technology Based Services", SEGMENT_SOURCES, VIEW_TABLES.segment],
    ] as const) {
      const res = await open(r, `${TABLES(base)}?source=awards&years=10`);
      expect(res.status, base).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const html = await text(res);
      const main = mainOf(html);
      expect(main).toContain(`<p class="eyebrow">Add Analytics Tables</p><h1>${name}</h1>`);
      expect(main).toContain("<p class=\"page-note\">Award notices, federal fiscal years 2017-18 to 2026-27.</p>");
      expect(optionsOf(html, "source"), base).toEqual([...sources]);
      expect(selected(html, "source")).toBe("awards");
      expect(optionsOf(html, "years")).toEqual(PERIODS.map(String));
      expect(selected(html, "years")).toBe("10");
      expect(optionsOf(html, "from")[0]).toBe("2026");
      expect(optionsOf(html, "from").at(-1)).toBe("2000");
      expect(checksOf(html).map((c) => c.table), base).toEqual([...tables]);
      expect(checksOf(html).every((c) => !c.checked && !c.off), base).toBe(true);
      // Its source and period a GET with a flat Show; its one filled button Add to dashboard.
      expect(main).toContain(`<form method="get" action="${TABLES(base)}" class="toolbar dash-frame" aria-label="Source and period">`);
      expect(main).toContain('<button type="submit" class="btn">Show</button>');
      expect(main.match(/btn-primary/g)).toHaveLength(1);
      expect(main).toContain('<button type="submit" class="btn btn-primary">Add to dashboard</button>');
      expect(main).toContain('<span class="panel-count">Dashboard 1 holds 2 of 24 tiles.</span>');
      expect(html).not.toContain(EM_DASH);
      expect(html).not.toContain(EN_DASH);
      expect(misfits(html)).toEqual([]);
    }
    // The organization's share table: its segments, the largest first, to choose among.
    const org = await text(await open(r, `${TABLES(`organizations/${A1}`)}?source=awards&years=10`));
    expect(optionsOf(org, "segment")).toEqual(["81", "43"]);
    expect(selected(org, "segment")).toBe("81");
  });

  it("leaves out a table at a source where its view offers none, saying why, and marks the ones the dashboard holds already", async () => {
    const r = await reader("doors-list-off");
    const at = async (base: string, q: string) => checksOf(await text(await open(r, `${TABLES(base)}?${q}`)));
    const grants = await at("buyers/pwgsc-tpsgc", "source=grants&years=10");
    expect(grants.filter((c) => c.off).map((c) => [c.table, c.note])).toEqual([
      ["segments", t("en", "analytics.no_segments")], ["competition", t("en", "analytics.no_competition")], ["growth", t("en", "analytics.no_growth")],
    ]);
    const contracts = await at(`organizations/${A1}`, "source=contracts&years=10");
    expect(contracts.filter((c) => c.off).map((c) => c.table)).toEqual(["segments", "share", "growth"]);
    // At the contract history the organization has no record in a segment: its share table cannot be drawn.
    const history = await at(`organizations/${A1}`, "source=history&years=10");
    expect(history.filter((c) => c.off).map((c) => [c.table, c.note])).toEqual([["share", t("en", "dash.tables_no_share")]]);
    for (const list of [grants, contracts, history]) {
      for (const c of list) expect(c.off, c.table).toBe(!tableApplies(list === grants ? "buyer" : "organization", c.table, list === grants ? "grants" : list === contracts ? "contracts" : "history") || c.table === "share");
    }
    // Two tables on the dashboard: marked, and left unchecked when every other one is checked (all=1).
    await tablesPost(r, "buyers/pwgsc-tpsgc", ["records", "suppliers"]);
    const marked = await at("buyers/pwgsc-tpsgc", "source=awards&years=10&all=1");
    expect(marked.filter((c) => c.note === t("en", "dash.tables_here")).map((c) => c.table)).toEqual(["records", "suppliers"]);
    expect(marked.filter((c) => c.checked).map((c) => c.table)).toEqual(["quarters", "values", "segments", "competition", "growth", "due"]);
    // At another period the same tables are other items: none marked.
    expect((await at("buyers/pwgsc-tpsgc", "source=awards&years=5")).some((c) => c.note)).toBe(false);
  });

  it("reads the period as the view does: held to the plan's years, the span by its years, a value it cannot use as the default", async () => {
    const r = await reader("doors-list-period");
    const span = await text(await open(r, `${TABLES("segments/81")}?source=history&from=2000&to=2026`));
    expect(mainOf(span)).toContain("PSPC contract history, federal fiscal years 2007-08 to 2026-27.");
    expect([selected(span, "from"), selected(span, "to")]).toEqual(["2007", "2026"]);
    expect(mainOf(span)).toContain('<input type="radio" name="period" value="span" checked=""/>');
    expect(mainOf(span)).toContain('<input type="hidden" name="from" value="2007"/><input type="hidden" name="to" value="2026"/>');
    // The radio picks: the latest, whatever from and to the form also sends.
    const latest = await text(await open(r, `${TABLES("segments/81")}?source=awards&period=latest&years=5&from=2010&to=2012`));
    expect(mainOf(latest)).toContain("federal fiscal years 2022-23 to 2026-27.");
    expect(mainOf(latest)).toContain('<input type="hidden" name="years" value="5"/>');
    const odd = await text(await open(r, `${TABLES("buyers/pwgsc-tpsgc")}?source=gold&years=7`));
    expect([selected(odd, "source"), selected(odd, "years")]).toEqual(["awards", "10"]);
    for (const bad of ["buyers/PSPC", "buyers/a--b", "organizations/org-zz", "organizations/pwgsc-tpsgc", "segments/99", "segments/8"]) {
      expect((await open(r, TABLES(bad))).status, bad).toBe(404);
    }
  });

  it("reads one records batch of bounded statements (the name, and an organization's segments), none for a segment", async () => {
    const r = await reader("doors-list-reads");
    const batches: number[] = [];
    const prepared: string[] = [];
    const db = new Proxy(RECORDS, {
      get(target, prop) {
        if (prop === "batch") return (list: D1PreparedStatement[]) => (batches.push(list.length), target.batch(list));
        if (prop === "prepare") return (sql: string) => (prepared.push(sql), target.prepare(sql));
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const at = async (base: string) => {
      batches.length = 0;
      prepared.length = 0;
      expect((await open(r, `${TABLES(base)}?source=awards&years=10`, off({ RECORDS: db }))).status).toBe(200);
      return { batches: [...batches], sql: [...prepared] };
    };
    const buyer = await at("buyers/pwgsc-tpsgc");
    expect(buyer.batches).toEqual([2]);
    const org = await at(`organizations/${A1}`);
    expect(org.batches).toEqual([3]);
    expect(org.sql).toHaveLength(3);
    for (const sql of org.sql) expect(sql, sql).toMatch(/LIMIT (\d+|\?\d+)\s*$/);
    expect((await at("segments/81")).batches).toEqual([]);
    // The records database unavailable: the subject by its id, the share table saying its segments cannot be read.
    const down = await text(await open(r, `${TABLES(`organizations/${A1}`)}?source=awards&years=10`, off({ RECORDS: undefined })));
    expect(mainOf(down)).toContain(`<h1>${A1}</h1>`);
    expect(checksOf(down).find((c) => c.table === "share")).toMatchObject({ off: true, note: t("en", "dash.tables_unread") });
  });

  it("offers the account's dashboards to choose among, the dashboard named marked, and its tables marked as that one's", async () => {
    const r = await reader("doors-list-boards");
    const b2 = await newBoard(r);
    await tablesPost(r, "segments/81", ["records"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    const first = await text(await open(r, `${TABLES("segments/81")}?source=awards&years=10`));
    expect(optionsOf(first, "board")).toEqual(["", b2]);
    expect(selected(first, "board")).toBe("");
    expect(checksOf(first).some((c) => c.note)).toBe(false);
    const second = await text(await open(r, `${TABLES("segments/81")}?source=awards&years=10&board=${b2}`));
    expect(selected(second, "board")).toBe(b2);
    expect(checksOf(second).filter((c) => c.note).map((c) => c.table)).toEqual(["records"]);
    expect(mainOf(second)).toContain(`<p class="lead">${t("en", "dash.tables_lead", { name: "Dashboard 2" })}</p>`);
    expect(mainOf(second)).toContain('<span class="panel-count">Dashboard 2 holds 1 of 24 tiles.</span>');
    const other = await reader("doors-list-boards-other");
    expect((await open(other, `${TABLES("segments/81")}?board=${b2}`)).headers.get("location")).toBe("/account/dashboard");
  });
});

describe("the checklist's post", () => {
  it("adds one table under the others, half the row, normalized, and says so on the dashboard at its tile", async () => {
    const r = await reader("doors-add-one");
    // In a posted order and a language the ref check reads, stored in its one form.
    const res = await send(r, TABLES("buyers/pwgsc-tpsgc"), [["years", "10"], ["source", "awards"], ["table", "records"], ["lang", "en"]]);
    expect(res.status).toBe(303);
    const rows = await tileRows(r.id);
    // The computed first written first (the starting layout's two tiles), then the table under them.
    expect(rows.map((x) => `${x.kind}:${x.ref}`)).toEqual(["watches:", "radar:3m", `analytic:${ref(PSPC_VIEW, "records")}`]);
    const added = rows[2];
    expect(added).toMatchObject({ x: 0, w: 6, h: START_H["analytic:table"], y: START_H.watches + START_H.radar });
    expect(res.headers.get("location")).toBe(`/account/dashboard?m=tables&n=1&of=1&there=0&full=0#tile-${added.id}`);
    expect(noticeOf(await text(await open(r, res.headers.get("location")!)))).toBe("1 table added.");
  });

  it("adds several in the checklist's order two to a row, and the same table once", async () => {
    const r = await reader("doors-add-several");
    const b2 = await newBoard(r);
    const res = await tablesPost(r, "buyers/pwgsc-tpsgc", ["growth", "quarters", "records", "quarters"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    const rows = await boardTiles(b2);
    const order = ["quarters", "records", "growth"].map((x) => ref(PSPC_VIEW, x));
    // The layout the grid gives them: the two half-width ones side by side, the two-chart table under them, alone in its
    // row and so the whole row wide.
    const sizes = ["analytic:chart", "analytic:table", "analytic:two"].map((k) => ({ id: k, kind: k, x: 0, y: 0, ...startSize(k, false) }));
    const laid = placeAll([], sizes);
    expect(rows.map((x) => [x.ref, x.x, x.y, x.w, x.h])).toEqual(order.map((o, i) => [o, laid[i].x, laid[i].y, laid[i].w, laid[i].h]));
    expect(rows.map((x) => [x.x, x.y, x.w])).toEqual([[0, 0, 6], [6, 0, 6], [0, START_H["analytic:chart"], 12]]);
    expect(res.headers.get("location")).toBe(`/account/dashboard/${b2}?m=tables&n=3&of=3&there=0&full=0#tile-${rows[0].id}`);
    expect(noticeOf(await text(await open(r, res.headers.get("location")!)))).toBe("3 tables added.");
    // Again with one of them and one more: the one there is counted, the other added under them.
    const again = await tablesPost(r, "buyers/pwgsc-tpsgc", ["records", "values"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    const now = await boardTiles(b2);
    expect(now).toHaveLength(4);
    const values = now.find((x) => x.ref === ref(PSPC_VIEW, "values"))!;
    expect(again.headers.get("location")).toBe(`/account/dashboard/${b2}?m=tables&n=1&of=2&there=1&full=0#tile-${values.id}`);
    expect(noticeOf(await text(await open(r, again.headers.get("location")!)))).toBe("1 of 2 tables added. 1 was on this dashboard already.");
    // All there: none added, at the first of them.
    const there = await tablesPost(r, "buyers/pwgsc-tpsgc", ["quarters", "records"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    expect(there.headers.get("location")).toBe(`/account/dashboard/${b2}?m=tables&n=0&of=2&there=2&full=0#tile-${rows[0].id}`);
    expect(noticeOf(await text(await open(r, there.headers.get("location")!)))).toBe("No table was added. 2 were on this dashboard already.");
  });

  it("adds those that fit when not all do, in the list's order, and says how many of how many and why the rest were not", async () => {
    const r = await reader("doors-add-full");
    const b2 = await newBoard(r);
    await fill(r, b2, 21);
    await tablesPost(r, "buyers/pwgsc-tpsgc", ["records"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    expect(await boardTiles(b2)).toHaveLength(22);
    const res = await tablesPost(r, "buyers/pwgsc-tpsgc", ["suppliers", "segments", "records", "values", "quarters"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    const rows = await boardTiles(b2);
    expect(rows).toHaveLength(24);
    const analytic = rows.filter((x) => x.kind === "analytic").map((x) => x.ref.slice(x.ref.indexOf("#table-") + 7));
    expect(analytic.sort()).toEqual(["quarters", "records", "values"]);
    expect(res.headers.get("location")).toMatch(new RegExp(`^/account/dashboard/${b2}\\?m=tables&n=2&of=5&there=1&full=2#tile-[0-9a-f]{32}$`));
    const html = await text(await open(r, res.headers.get("location")!));
    expect(noticeOf(html)).toBe("2 of 5 tables added. 1 was on this dashboard already. 2 did not fit: the dashboard holds its 24 tiles.");
    // Full: nothing more, the checklist saying so with its button off.
    const more = await tablesPost(r, "buyers/pwgsc-tpsgc", ["growth"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    expect(more.headers.get("location")).toBe(`/account/dashboard/${b2}?m=tables&n=0&of=1&there=0&full=1`);
    expect(noticeOf(await text(await open(r, more.headers.get("location")!)))).toBe("No table was added. 1 did not fit: the dashboard holds its 24 tiles.");
    const list = mainOf(await text(await open(r, `${TABLES("buyers/pwgsc-tpsgc")}?source=awards&years=10&board=${b2}`)));
    expect(list).toContain(t("en", "dash.full", { cap: "24" }));
    expect(list).toContain('<button type="submit" class="btn btn-primary" disabled="">Add to dashboard</button>');
    expect(await boardTiles(b2)).toHaveLength(24);
  });

  it("refuses a table the view does not draw or that does not apply at the source, a share without its segment and a bad period, adding nothing", async () => {
    const r = await reader("doors-add-refused");
    const before = await tileRows(r.id);
    for (const [base, tables, more] of [
      [`organizations/${A1}`, ["years", "quarters"], [["source", "awards"], ["years", "10"]]],
      ["buyers/pwgsc-tpsgc", ["records", "segments"], [["source", "grants"], ["years", "10"]]],
      ["buyers/pwgsc-tpsgc", ["competition"], [["source", "grants"], ["years", "10"]]],
      [`organizations/${A1}`, ["growth"], [["source", "contracts"], ["years", "10"]]],
      [`organizations/${A1}`, ["share"], [["source", "awards"], ["years", "10"]]],
      [`organizations/${A1}`, ["share"], [["source", "awards"], ["years", "10"], ["segment", "99"]]],
      ["buyers/pwgsc-tpsgc", ["records"], [["source", "awards"], ["years", "7"]]],
      ["buyers/pwgsc-tpsgc", ["records"], [["source", "gold"], ["years", "10"]]],
      ["buyers/pwgsc-tpsgc", ["records"], [["source", "awards"], ["from", "2020"], ["to", "2019"]]],
      ["buyers/pwgsc-tpsgc", ["nope"], [["source", "awards"], ["years", "10"]]],
      ["buyers/PSPC", ["records"], [["source", "awards"], ["years", "10"]]],
      ["segments/81", ["records"], [["source", "contracts"], ["years", "10"]]],
      ["buyers/pwgsc-tpsgc", ["records"], [["source", "awards"], ["years", "10"], ["board", "nonsense"]]],
    ] as [string, string[], [string, string][]][]) {
      expect((await tablesPost(r, base, tables, more)).status, `${base} ${tables} ${JSON.stringify(more)}`).toBe(400);
    }
    expect(await tileRows(r.id)).toEqual(before);
    expect(await boards(r.id)).toEqual([]);
    // The share table at its segment, and the organizations it compares, kept in the ref as the dashboard writes it.
    const share = await tablesPost(r, `organizations/${A1}`, ["share"], [["source", "awards"], ["years", "10"], ["segment", "43"], ["vs", "org-a000000002"]]);
    expect(share.status).toBe(303);
    expect((await tileRows(r.id)).map((x) => x.ref)).toContain(`${ORG_VIEW}&segment=43&vs=org-a000000002#table-share`);
  });

  it("goes to the dashboard it names, and never to another account's", async () => {
    const r = await reader("doors-add-board");
    const b2 = await newBoard(r);
    const res = await tablesPost(r, "segments/81", ["winners"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    expect(res.headers.get("location")).toMatch(new RegExp(`^/account/dashboard/${b2}\\?m=tables&n=1&of=1`));
    expect((await boardTiles(b2)).map((x) => x.ref)).toEqual(["/segments/81/analytics?source=awards&years=10#table-winners"]);
    const other = await reader("doors-add-board-other");
    const refused = await tablesPost(other, "segments/81", ["records"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    expect(refused.headers.get("location")).toBe("/account/dashboard");
    expect(await boardTiles(b2)).toHaveLength(1);
    expect(await tileRows(other.id)).toEqual([]);
  });

  it("with nothing checked returns to the checklist, saying so", async () => {
    const r = await reader("doors-add-none");
    const res = await tablesPost(r, "segments/81", [], [["source", "history"], ["from", "2019"], ["to", "2024"]]);
    expect(res.headers.get("location")).toBe(`${TABLES("segments/81")}?from=2019&source=history&to=2024&m=none`);
    expect(noticeOf(await text(await open(r, res.headers.get("location")!)))).toBe(t("en", "dash.tables_pick"));
    expect(await tileRows(r.id)).toEqual([]);
  });

  it("adds in each state of storage: into the panels while the grid's tables are absent, nothing kept without either", async () => {
    const a = await reader("doors-add-panels");
    await without("tiles", async () => {
      const page = await text(await open(a, `${TABLES("buyers/pwgsc-tpsgc")}?source=awards&years=10`));
      expect(mainOf(page)).toContain('<span class="panel-count">Dashboard 1 holds 2 of 24 tiles.</span>');
      const res = await tablesPost(a, "buyers/pwgsc-tpsgc", ["records", "quarters"]);
      const rows = await panelRows(a.id);
      expect(rows.map((p) => `${p.kind}:${p.ref}:${p.wide}`)).toEqual(["watches::1", "radar:3m:1", ...["quarters", "records"].map((x) => `analytic:${ref(PSPC_VIEW, x)}:0`)]);
      expect(res.headers.get("location")).toBe(`/account/dashboard?m=tables&n=2&of=2&there=0&full=0#tile-${rows[2].id}`);
      // The checklist marks them from the panels.
      const marked = checksOf(await text(await open(a, `${TABLES("buyers/pwgsc-tpsgc")}?source=awards&years=10`)));
      expect(marked.filter((c) => c.note).map((c) => c.table)).toEqual(["quarters", "records"]);
    });
    const none = await reader("doors-add-unsaved");
    await without("all", async () => {
      expect((await tablesPost(none, "buyers/pwgsc-tpsgc", ["records"])).headers.get("location")).toBe("/account/dashboard?m=unsaved");
      expect(mainOf(await text(await open(none, `${TABLES("buyers/pwgsc-tpsgc")}?source=awards&years=10`))))
        .toContain('<button type="submit" class="btn btn-primary" disabled="">Add to dashboard</button>');
    });
  });
});

describe("a saved view's row", () => {
  const save = (r: Reader, kind: string, address: string, name: string) => ACCOUNTS.prepare(
    "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, ?, ?, ?, 'en', 'off', ?)",
  ).bind(crypto.randomUUID().replace(/-/g, ""), r.id, kind, address, name, new Date().toISOString()).run();

  it("keeps its one-press Add to dashboard and links the view's checklist at its subject, source and period, for Ultra alone", async () => {
    const ultra = await reader("doors-views-ultra");
    const pro = await reader("doors-views-pro", "pro");
    const custom = `/organizations/${A1}/analytics?source=awards&from=2019&to=2024&segment=43&vs=org-a000000002`;
    for (const r of [ultra, pro]) {
      await save(r, "organization", `/organizations/${A1}/analytics?source=history&years=5`, "Exemplar's history");
      await save(r, "organization", custom.replace("source=awards&from=2019&to=2024", "from=2019&source=awards&to=2024"), "Exemplar's share");
    }
    const html = await text(await open(ultra, "/account/views"));
    expect(html.match(/<form method="post" action="\/account\/dashboard\/panels" class="account-inline dash-add">/g)).toHaveLength(2);
    expect(mainOf(html)).toContain(`<a href="/account/dashboard/tables/organizations/${A1}?source=history&years=5" class="dash-pick">Choose its tables</a>`);
    const links = [...mainOf(html).matchAll(/<a href="([^"]*)" class="dash-pick">/g)].map((m) => m[1]);
    expect(links).toHaveLength(2);
    // Each opens the checklist as the view stands. The two views were saved a moment apart and the list orders by
    // the time saved, then by a random id, so each link is found by its address, never by its place.
    const historyLink = links.find((l) => l.includes("source=history"))!;
    const spanLink = links.find((l) => l.includes("from=2019"))!;
    expect(new Set([historyLink, spanLink]).size).toBe(2);
    const history = await text(await open(ultra, historyLink));
    expect([selected(history, "source"), selected(history, "years")]).toEqual(["history", "5"]);
    const span = await text(await open(ultra, spanLink));
    expect([selected(span, "source"), selected(span, "from"), selected(span, "to"), selected(span, "segment")]).toEqual(["awards", "2019", "2024", "43"]);
    expect(mainOf(span)).toContain('<input type="hidden" name="segment" value="43"/><input type="hidden" name="vs" value="org-a000000002"/>');
    expect(html).not.toContain(EM_DASH);
    // Pro's page draws neither the control nor the link.
    const proPage = await text(await open(pro, "/account/views"));
    expect(proPage).not.toContain("dash-pick");
    expect(proPage).not.toContain("/account/dashboard/tables");
    expect(proPage).not.toContain("dash-add");
  });
});

describe("the starters", () => {
  const startOf = (html: string) => /<ul class="plain dash-starters"[^>]*>([\s\S]*?)<\/ul>/.exec(mainOf(html))?.[1] ?? null;

  it("show on an empty dashboard inside Add a Tile, open, and on no dashboard with a tile, the account's first keeping its starting layout", async () => {
    const r = await reader("doors-start-show");
    // The first, computed: its starting layout, no starter.
    expect(startOf(await text(await open(r)))).toBeNull();
    const b2 = await newBoard(r);
    const html = await text(await open(r, `/account/dashboard/${b2}`));
    const list = startOf(html)!;
    expect(mainOf(html)).toContain('<details class="dash-adder" id="dash-add" open="">');
    expect(mainOf(html).indexOf("dash-starters")).toBeLessThan(mainOf(html).indexOf('id="dash-add-lists"'));
    expect(list).toContain(`<li><a href="/account/organization">Your organization</a><span class="muted small">${t("en", "dash.start_org_claim")}</span></li>`);
    expect(list).toContain(`<li><a href="/account/dashboard/find?kind=buyer&all=1&board=${b2}">A buyer</a>`);
    expect(list).toContain(`<li><a href="/account/dashboard/find?kind=segment&all=1&board=${b2}">A segment</a>`);
    expect(list).toContain(`<input type="hidden" name="starter" value="ending"/><button type="submit" class="btn-link">Contracts ending</button></form><span class="muted small">${t("en", "dash.start_ending_line")}</span>`);
    expect(mainOf(html).match(/btn-primary/g)).toHaveLength(1);
    // With a claim, Your organization is a post.
    await send(r, "/account/organization", { org: A1 });
    const claimed = startOf(await text(await open(r, `/account/dashboard/${b2}`)))!;
    expect(claimed).toContain(`<input type="hidden" name="starter" value="org"/><button type="submit" class="btn-link">Your organization</button></form><span class="muted small">Its 6 blocks and the notices that match it.</span>`);
    // A tile on it: no starter.
    await tablesPost(r, "segments/81", ["records"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    expect(startOf(await text(await open(r, `/account/dashboard/${b2}`)))).toBeNull();
  });

  it("fill an empty dashboard in one post, two to a row: your organization's notices and blocks, or the contracts ending and the watches", async () => {
    const r = await reader("doors-start-fill");
    await send(r, "/account/organization", { org: A1 });
    const b2 = await newBoard(r);
    const res = await send(r, "/account/dashboard/starter", { starter: "org", board: b2 });
    const rows = await boardTiles(b2);
    // Laid out as the grid lays the starter's tiles out in their order, half the row each, two to a row.
    const order = ["matches:", "org:years", "org:segments", "org:share", "org:ending", "org:buyers", "org:instruments"];
    const keys = ["matches", "org", "org", "org:share", "org:ending", "org", "org:instruments"];
    const laid = placeAll([], keys.map((k, i) => ({ id: order[i], kind: k, x: 0, y: 0, ...startSize(k, false) })));
    expect(rows.map((x) => [`${x.kind}:${x.ref}`, x.x, x.y, x.w, x.h])).toEqual(laid.map((x) => [x.id, x.x, x.y, x.w, x.h]));
    expect(laid.slice(0, 2).map((x) => x.x)).toEqual([0, 6]);
    // Six in pairs, half the row each; the seventh, alone in its row, the whole row.
    expect(rows.filter((x) => x.w === 6)).toHaveLength(6);
    expect(rows.find((x) => x.ref === "instruments")!.w).toBe(12);
    expect(res.headers.get("location")).toBe(`/account/dashboard/${b2}?m=started&n=7#tile-${rows.find((x) => x.kind === "matches")!.id}`);
    const html = await text(await open(r, res.headers.get("location")!));
    expect(noticeOf(html)).toBe("7 tiles added.");
    expect(html).not.toContain(t("en", "dash.unavailable"));
    const b3 = await newBoard(r);
    const ending = await send(r, "/account/dashboard/starter", { starter: "ending", board: b3 });
    const tiles = await boardTiles(b3);
    expect(tiles.map((x) => `${x.kind}:${x.ref}@${x.x}`)).toEqual(["watches:@0", "radar:3m@6", "radar:6m@0", "radar:12m@6"]);
    expect(ending.headers.get("location")).toBe(`/account/dashboard/${b3}?m=started&n=4#tile-${tiles[0].id}`);
    // The statements: each insert holds the dashboard empty but for its own batch.
    expect(STARTER_TILE_SQL).toContain("AND NOT EXISTS (SELECT 1 FROM dashboard_tiles WHERE dashboard_id = d.id AND created_at <> ?9) ON CONFLICT DO NOTHING");
    expect(STARTER_PANEL_SQL).toContain(`AND kind <> '${LAYOUT_MARKER}' AND created_at <> ?6) ON CONFLICT (user_id, kind, ref) DO NOTHING`);
    const first = (await boards(r.id))[0];
    const held = await ACCOUNTS.prepare(STARTER_TILE_SQL).bind("e".repeat(32), r.id, "radar", "6m", 0, 0, 6, 11, new Date().toISOString(), 24, 2, first).run();
    expect(held.meta.changes).toBe(0);
  });

  it("A buyer and A segment lead to the search of their kind, whose checklist opens with every table that applies checked", async () => {
    const r = await reader("doors-start-search");
    const b2 = await newBoard(r);
    const found = groupsOf(await text(await open(r, `/account/dashboard/find?kind=buyer&all=1&board=${b2}&q=pspc`)));
    expect(found[0].links).toEqual([`/account/dashboard/tables/buyers/pwgsc-tpsgc?source=history&years=10&board=${b2}&all=1`]);
    const list = checksOf(await text(await open(r, found[0].links[0])));
    expect(list.filter((c) => c.checked).map((c) => c.table)).toEqual(VIEW_TABLES.buyer.filter((x) => tableApplies("buyer", x, "history")));
    const seg = groupsOf(await text(await open(r, `/account/dashboard/find?kind=segment&all=1&board=${b2}`)))[0];
    const segList = checksOf(await text(await open(r, seg.links.find((l) => l.includes("/segments/81?"))!)));
    expect(segList.every((c) => c.checked)).toBe(true);
    // Its post fills the dashboard, two to a row.
    const res = await tablesPost(r, "segments/81", segList.map((c) => c.table), [["source", "awards"], ["years", "10"], ["board", b2]]);
    expect(res.headers.get("location")).toMatch(/m=tables&n=7&of=7&there=0&full=0#tile-/);
    // Two to a row where they fit: the ranked tables side by side, the two-chart ones (7 columns) a whole row each.
    const placed = await boardTiles(b2);
    expect(placed.filter((x) => x.x === 6).map((x) => x.ref.slice(x.ref.indexOf("#") + 7))).toEqual(["buyers", "entrants"]);
  });

  it("are refused on a dashboard with a tile, the account's first and its starting layout untouched; your organization without a claim leads to naming one", async () => {
    const r = await reader("doors-start-refused");
    const res = await send(r, "/account/dashboard/starter", { starter: "ending" });
    expect(res.headers.get("location")).toBe("/account/dashboard?m=started_taken#dash-add");
    expect(await boards(r.id)).toEqual([]);
    expect(await tileRows(r.id)).toEqual([]);
    expect(noticeOf(await text(await open(r, res.headers.get("location")!)))).toBe(t("en", "dash.started_taken"));
    const b2 = await newBoard(r);
    await tablesPost(r, "segments/81", ["records"], [["source", "awards"], ["years", "10"], ["board", b2]]);
    const before = await boardTiles(b2);
    expect((await send(r, "/account/dashboard/starter", { starter: "ending", board: b2 })).headers.get("location")).toBe(`/account/dashboard/${b2}?m=started_taken#dash-add`);
    expect(await boardTiles(b2)).toEqual(before);
    const b3 = await newBoard(r);
    expect((await send(r, "/account/dashboard/starter", { starter: "org", board: b3 })).headers.get("location")).toBe("/account/organization");
    expect(await boardTiles(b3)).toEqual([]);
    for (const bad of [{ starter: "buyer" }, { starter: "nope" }, {}, { starter: "ending", board: "nonsense" }]) {
      expect((await send(r, "/account/dashboard/starter", bad as Record<string, string>)).status, JSON.stringify(bad)).toBe(400);
    }
    const other = await reader("doors-start-other");
    expect((await send(other, "/account/dashboard/starter", { starter: "ending", board: b3 })).headers.get("location")).toBe("/account/dashboard");
    expect(await boardTiles(b3)).toEqual([]);
  });

  it("fill an emptied dashboard in each state of storage: the panels, the computed first emptied, nothing kept without either", async () => {
    // The grid's tables absent, the panels emptied: into the panels.
    const a = await reader("doors-start-panels");
    await without("tiles", async () => {
      // The starting layout's second tile removed (which writes it as panels), then the first by its id.
      await send(a, "/account/dashboard/tiles/s1/delete");
      await send(a, `/account/dashboard/tiles/${(await panelRows(a.id))[0].id}/delete`);
      const rowsBefore = await panelRows(a.id);
      expect(rowsBefore.map((p) => p.kind)).toEqual([LAYOUT_MARKER]);
      expect(startOf(await text(await open(a)))).not.toBeNull();
      const res = await send(a, "/account/dashboard/starter", { starter: "ending" });
      const rows = (await panelRows(a.id)).filter((p) => p.kind !== LAYOUT_MARKER);
      expect(rows.map((p) => `${p.kind}:${p.ref}:${p.wide}`)).toEqual(["watches::0", "radar:3m:0", "radar:6m:0", "radar:12m:0"]);
      expect(res.headers.get("location")).toBe(`/account/dashboard?m=started&n=4#tile-${rows[0].id}`);
      expect((await send(a, "/account/dashboard/starter", { starter: "ending" })).headers.get("location")).toBe("/account/dashboard?m=started_taken#dash-add");
    });
    // The grid's tables there, nothing stored, the earlier layout emptied: the computed first is empty, and is written.
    const b = await reader("doors-start-first");
    await ACCOUNTS.prepare("INSERT INTO dashboard_panels (id, user_id, kind, ref, pos, wide, created_at) VALUES (?, ?, ?, '', -1, 1, ?)")
      .bind("9".repeat(32), b.id, LAYOUT_MARKER, new Date().toISOString()).run();
    expect(startOf(await text(await open(b)))).not.toBeNull();
    const res = await send(b, "/account/dashboard/starter", { starter: "ending" });
    expect(res.headers.get("location")).toMatch(/^\/account\/dashboard\?m=started&n=4#tile-[0-9a-f]{32}$/);
    expect(await boards(b.id)).toHaveLength(1);
    expect((await tileRows(b.id)).map((x) => `${x.kind}:${x.ref}`)).toEqual(["watches:", "radar:3m", "radar:6m", "radar:12m"]);
    const none = await reader("doors-start-none");
    await without("all", async () => {
      expect((await send(none, "/account/dashboard/starter", { starter: "ending" })).headers.get("location")).toBe("/account/dashboard?m=unsaved");
    });
  });
});

describe("both languages", () => {
  it("draw the find page, the checklist, the starters and the notices in French, without a dash", async () => {
    const r = await reader("doors-fr");
    const b2 = await newBoard(r);
    const find = await text(await open(r, `/account/dashboard/find?q=pspc&lang=fr`));
    expect(mainOf(find)).toContain("<h1>Trouver un acheteur, une organisation ou un segment</h1>");
    expect(groupsOf(find)[0].names).toEqual(["Services publics et Approvisionnement Canada"]);
    const list = await text(await open(r, `${TABLES("buyers/pwgsc-tpsgc")}?source=grants&years=10&lang=fr&board=${b2}`));
    expect(mainOf(list)).toContain('<p class="eyebrow">Ajouter des tableaux d\'analyse</p><h1>Services publics et Approvisionnement Canada</h1>');
    expect(checksOf(list).find((c) => c.table === "competition")!.note).toBe(norm(t("fr", "analytics.no_competition")));
    expect(mainOf(list)).toContain('<button type="submit" class="btn btn-primary">Ajouter au tableau de bord</button>');
    expect(mainOf(list)).toContain('<input type="hidden" name="lang" value="fr"/>');
    const res = await send(r, TABLES("buyers/pwgsc-tpsgc"), [["lang", "fr"], ["source", "awards"], ["years", "10"], ["board", b2], ["table", "records"], ["table", "values"]]);
    expect(res.headers.get("location")).toMatch(new RegExp(`^/account/dashboard/${b2}\\?m=tables&n=2&of=2&there=0&full=0&lang=fr#tile-`));
    const board = await text(await open(r, res.headers.get("location")!));
    expect(noticeOf(board)).toBe("2 tableaux ajoutés.");
    const again = await send(r, TABLES("buyers/pwgsc-tpsgc"), [["lang", "fr"], ["source", "awards"], ["years", "10"], ["board", b2], ["table", "records"], ["table", "due"]]);
    expect(noticeOf(await text(await open(r, again.headers.get("location")!)))).toBe("1 tableau ajouté sur 2. 1 était déjà sur ce tableau de bord.");
    const b3 = await newBoard(r);
    const starters = await text(await open(r, `/account/dashboard/${b3}?lang=fr`));
    expect(mainOf(starters)).toContain('<p class="dash-adder-part" id="dash-add-start">Commencer à partir de</p>');
    expect(mainOf(starters)).toContain(">Contrats prenant fin</button>");
    const started = await send(r, "/account/dashboard/starter", { starter: "ending", board: b3, lang: "fr" });
    expect(noticeOf(await text(await open(r, started.headers.get("location")!)))).toBe("4 tuiles ajoutées.");
    for (const html of [find, list, board, starters]) {
      expect(html).not.toContain(EM_DASH);
      expect(html).not.toContain(EN_DASH);
    }
    // Every string of the dashboard in both languages, apart, with no dash and no "not X but Y".
    const keys = Object.keys(DASHBOARD_STRINGS) as Key[];
    expect(keys.every((k) => allKeys().includes(k))).toBe(true);
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      for (const s of [en, fr]) {
        expect(s, key).not.toContain(EM_DASH);
        expect(s, key).not.toContain(EN_DASH);
        expect(s, key).not.toMatch(/\bnot [^.]* but\b|\bpas [^.]* mais\b/);
      }
      expect(fr, key).not.toBe(en);
    }
  });
});

describe("a table that applies at a source", () => {
  it("is one the analytics page's own panel offers Add to dashboard for, at every source of every view", async () => {
    const r = await reader("doors-applies");
    for (const [view, path, sources] of [
      ["buyer", "/buyers/pwgsc-tpsgc/analytics", MONEY_SOURCES], ["organization", `/organizations/${A1}/analytics`, MONEY_SOURCES],
      ["segment", "/segments/81/analytics", SEGMENT_SOURCES],
    ] as const) {
      for (const source of sources) {
        const html = await text(await open(r, `${path}?source=${source}&years=10`));
        const offered = [...mainOf(html).matchAll(/name="ref" value="[^"]*#table-([a-z]+)"/g)].map((m) => m[1]);
        // The share table also needs a segment the organization has records in at that source (award notices here).
        const expected = (VIEW_TABLES[view] as readonly string[]).filter((x) => tableApplies(view, x, source) && !(x === "share" && source !== "awards"));
        expect(offered, `${view} ${source}`).toEqual(expected);
      }
    }
    expect(tableApplies("segment", "years", "contracts")).toBe(false);
    expect(tableApplies("buyer", "share", "awards")).toBe(false);
  });
});
