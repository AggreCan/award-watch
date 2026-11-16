// The dashboard (src/account/dashboard.tsx; docs/accounts.md, Dashboard):
// the address for each reader (the site's 404 while Ultra is off sale for
// anyone who does not hold it, the sign-in page, what it holds for Free and
// Pro with no records read, the tiles for Ultra); the starting layout; each
// kind of tile from rows written here, with its Open; a removed item; the
// grid's three states of storage (the tiles' tables absent, present and
// empty, holding tiles), each tested on its own; the add, the steps and
// sizes of the menu, the removal, the layout the script saves and the one
// tile it reads, behind the session, CSRF and Origin, in the edit bucket;
// the cap and the briefings' cap inside the insert; rows and charts that
// follow a tile's size; the page's one filled button, its fit at every
// width, its cache header; the rail's item; "Add to dashboard" for Ultra
// alone; both languages. The analytics tables (kind "analytic"): one table
// of each view drawn in full at its size, the same item once, a table the
// view does not draw refused, a view's tile from before drawn as its first
// table, the per-panel Add to dashboard on each analytics page for Ultra
// alone. The text tile (kind "text"): added, edited, emptied, cut, escaped.
// The records database is built here from pipeline/records_schema.sql with
// the rows below.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { LEAST, START_H, least, normalize, steps as gridSteps } from "../public/dash-grid.js";
import {
  ADD_PANEL_SQL, ADD_TEXT_SQL, ADD_TILE_SQL, BRIEFING_PANELS_MAX, MOVE_TO_SQL, NEW_BOARD_SQL, NOTE_MAX, PANEL_KINDS, RADAR_TOP_SQL, TEASE_KINDS, analyticAddress,
  analyticRef, isHeading, noteOf, noteText, specOf, startingLayout, viewAddress, viewRef, viewSpan,
} from "../src/account/dashboard";
import { analyticFit, analyticPlot, tileFit } from "../src/account/dashboard_fit";
import { VIEW_TABLES } from "../src/pages/analytics";
import { DASHBOARDS_MAX, TILES_MAX, boardCap, tileCap } from "../src/account/dashboard_rule";
import { DASHBOARD_STRINGS } from "../src/account/dashboard_strings";
import { RULES } from "../src/account/entitlements";
import { claimFrame, endingParams } from "../src/account/org_claim";
import { bucketFor } from "../src/limits";
import { allKeys, rawEntry, t, type Key } from "../src/i18n";
import { orgNumber } from "../src/records_db";
import { RADAR_ROWS_END_SQL, radarBinds } from "../src/records_tables";
import {
  ACCOUNTS, PRO_SALE, csrf, decode, get, grantPro, grantUltra, nbsp, newEmail, offEnv, onEnv, post, signIn, ultraEnv, useAccountsDb, userId,
} from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { applySql, splitSql } from "./setup";
import { misfits, tablesIn } from "./table-fit";
import accountsSchema from "../accounts_schema.sql?raw";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const DAY = "2026-10-31"; // the fixtures' data date, in fiscal year 2026-27

const A1 = "org-a000000001"; // Exemplar Translation Services Inc., the fixtures' profile
const A2 = "org-a000000002";
const NAME1 = "Exemplar Translation Services Inc.";
const n = (id: string) => orgNumber(id) as number;

// The fixtures' profiles, the first with a matching block (as test/cpu-budget.test.ts writes one), so the matching
// notices rank the open list's notice in segment 82.
const MATCH_BLOCK = {
  fy: [2022, 2026], n: [7, 3, 12], coded: [7, 3], newest: "2026-09-30",
  classes: [["821118", 5, 2], ["811015", 2, 0]], families: [["8211", 5, 2], ["8110", 2, 0]], segments: [["82", 5, 2], ["81", 2, 0]],
  buyers: [["pwgsc-tpsgc", 4, 3, 0], ["dfo-mpo", 1, 0, 4]], provinces: [["ON", 6, 2], ["QC", 1, 1]],
  types: [["Request for Proposal", 5, 1]], held: [["SA", "82", 1]],
};
const PROFILES = structuredClone(FILES["profiles/a00.json"]) as Record<string, any>;
PROFILES[A1] = { ...PROFILES[A1], matching: MATCH_BLOCK };
const ASSETS = makeFakeAssets({}, { "profiles/a00.json": PROFILES, "stats.json": { ...(FILES["stats.json"] as object), matching_fy: [2022, 2026] } });

// Ultra on sale (its variables and the payments), or off sale (Pro's alone); the switch on in both.
const sale = (extra: Record<string, unknown> = {}) => ultraEnv({ ASSETS, ...extra });
const off = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS, ...PRO_SALE, ...extra });

const norm = (s: string) => nbsp(s).replace(/’/g, "'");
const text = async (res: Response) => norm(decode(await res.text()));
const mainOf = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));

// -- the records database ------------------------------------------------------------------

const PSPC = 101;
const DFO = 103;
const RECS = [
  { src: 1, fy: 2025, fq: 1, bid: PSPC, oid: n(A1), sid: 81, cents: 50_000_000 },
  { src: 1, fy: 2026, fq: 2, bid: PSPC, oid: n(A1), sid: 81, cents: 30_000_000 },
  { src: 1, fy: 2026, fq: 2, bid: PSPC, oid: n(A2), sid: 81, cents: 10_000_000 },
  { src: 2, fy: 2026, fq: 1, bid: DFO, oid: n(A1), sid: 43, cents: 20_000_000 },
  { src: 3, fy: 2026, fq: 2, bid: DFO, oid: n(A1), sid: null, cents: 1_234_500 },
];
// A third buyer, Shared Services Canada: a record a fiscal year in its contract history (2), 2013-14 to 2026-27, in
// segment 81, every third from one organization (org-c000000001, five fiscal years) and the others each from one
// organization of its own, the largest withheld (no organization): more rows than a small tile lists of the tables
// an analytics tile draws, apart from every row the other tests count.
const SSC = 104;
const C = (i: number) => `org-c0000000${String(i).padStart(2, "0")}`;
const CASCADE = "Cascade Systems Ltd.";
const MORE = Array.from({ length: 14 }, (_, i) => ({
  src: 2, fy: 2013 + i, fq: (i % 4) + 1, bid: SSC, oid: i === 13 ? null : n(C(i % 3 === 0 ? 1 : i + 1)), sid: 81, cents: (i + 1) * 2_000_000,
}));
function radar(ref: string, end: string, value: number, org: string): string {
  return JSON.stringify({
    kind: "award", reference: ref, title_en: `Contract ${ref}`, title_fr: `Contrat ${ref}`, organization_id: org, organization: org === A1 ? NAME1 : "Other Ltd.",
    buyer_id: "pwgsc-tpsgc", buyer_en: "PSPC", buyer_fr: "SPAC", start: "2024-01-01", end, value, currency: "CAD", competitive: 1,
    method_en: "Competitive", method_fr: "Concurrentielle", instrument_en: "Contract", instrument_fr: "Contrat", n_amendments: 0,
    value_growth: null, tender_reference: null, segments: ["81"], provinces: ["ON"],
  });
}
// Thirty contracts ending within 12 months of the data date, all but every seventh the organization's: more than a
// tile of any size lists at its least, and fewer than its tallest lists.
const EXPIRING = Array.from({ length: 30 }, (_, i) => {
  const end = new Date(Date.UTC(2026, 10, 1 + i * 11)).toISOString().slice(0, 10);
  const other = i % 7 === 6;
  return {
    endd: end, oid: other ? n(A2) : n(A1), buyer: other ? "dfo-mpo" : "pwgsc-tpsgc", cents: (i + 1) * 1_000_000,
    j: radar(`EN578-${String(100000 + i)}`, end, (i + 1) * 10_000, other ? A2 : A1),
  };
});
const EVENTS = [
  { day: "2026-10-30", kind: "award", src: 1, oid: n(A1), buyer: "pwgsc-tpsgc", sid: 81, ref: "award:a1", title: "A new award this week" },
  { day: "2026-10-29", kind: "award", src: 3, oid: n(A1), buyer: "dfo-mpo", sid: null, ref: "contract:dfo-mpo:c1", title: "A published contract this week" },
  { day: "2026-10-20", kind: "award", src: 1, oid: n(A1), buyer: "pwgsc-tpsgc", sid: 81, ref: "award:old", title: "An award before the week" },
  { day: "2026-10-30", kind: "notice", src: 5, oid: null, buyer: "pwgsc-tpsgc", sid: 81, ref: "tender:t1", title: "A notice in segment 81" },
];

async function seedRecords(): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["records", "rec_orgs", "rec_buyers", "rec_segment_years", "rec_details", "rec_expiring", "rec_events", "rec_meta",
    "rec_instruments", "rec_holders", "rec_buyer_quarters"].map((x) => RECORDS.prepare(`DELETE FROM ${x}`)));
  await RECORDS.batch([
    ...RECS.map((r, i) => RECORDS.prepare(
      "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote, comp, ref, title) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 1, ?, ?)",
    ).bind(r.src, r.fy, r.fq, r.bid, r.oid, r.sid, r.cents, `REF-${i}`, `Record ${i}`)),
    ...MORE.map((r, i) => RECORDS.prepare(
      "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote, comp, ref, title) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 1, ?, ?)",
    ).bind(r.src, r.fy, r.fq, r.bid, r.oid, r.sid, r.cents, `SSC-${i}`, `Network record ${i}`)),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'ssc-spc', 'Shared Services Canada', 'Services partagés Canada')").bind(SSC),
    ...Array.from({ length: 13 }, (_, i) => RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, ?)").bind(n(C(i + 1)), i ? `Supplier ${i + 1} Inc.` : CASCADE)),
    RECORDS.prepare("INSERT INTO rec_segment_years (sid, src, fy, n, cents, n_no_value, n_buyers, n_orgs, n_pos) SELECT sid, src, fy, COUNT(*), " +
      "SUM(cents), 0, COUNT(DISTINCT bid), COUNT(DISTINCT oid), COUNT(*) FROM records WHERE sid IS NOT NULL GROUP BY sid, src, fy"),
    RECORDS.prepare("INSERT INTO rec_buyer_quarters (bid, src, fy, fq, n, cents, n_no_value) SELECT bid, src, fy, fq, COUNT(*), SUM(cents), 0 " +
      "FROM records GROUP BY bid, src, fy, fq"),
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, ?)").bind(n(A1), NAME1),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'pwgsc-tpsgc', 'Public Services and Procurement Canada', " +
      "'Services publics et Approvisionnement Canada')").bind(PSPC),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dfo-mpo', 'Fisheries and Oceans Canada', 'Pêches et Océans Canada')").bind(DFO),
    RECORDS.prepare("INSERT INTO rec_details (k, src, day, bid, oid, cents, vnote, comp, ref, title_en) VALUES (1, 1, '2026-06-01', ?, ?, 30000000, 0, 1, 'd1', 'Detail')")
      .bind(PSPC, n(A1)),
    ...EXPIRING.map((x, i) => RECORDS.prepare(
      "INSERT INTO rec_expiring (k, endd, oid, buyer, client, segs, kind, comp, cad, cents, nv, so, m31, j) VALUES (?, ?, ?, ?, NULL, ' 81 ', 1, 1, ?, ?, 0, 0, 0, ?)",
    ).bind(i + 1, x.endd, x.oid, x.buyer, x.cents, x.cents, x.j)),
    ...EVENTS.map((x, i) => RECORDS.prepare(
      "INSERT INTO rec_events (k, day, kind, src, oid, buyer, sid, ref, more, path, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, '/x', ?)",
    ).bind(i + 1, x.day, x.kind, x.src, x.oid, x.buyer, x.sid, x.ref, x.title)),
    RECORDS.prepare("INSERT INTO rec_instruments (k, agr, type_en, type_fr, desc_en, desc_fr, user_en, user_fr, buyer, start, expiry, n, nw, seen, last) " +
      "VALUES (1, 'E60ZT-120002/001/ZT', 'Supply Arrangement', NULL, 'Translation services', NULL, NULL, NULL, NULL, NULL, '2027-06-30', 1, 0, ?1, ?1)").bind(DAY),
    RECORDS.prepare("INSERT INTO rec_holders (k, ik, oid, name, op, region, region_en, region_fr, seen) VALUES (1, 1, ?, ?, NULL, 'NC', NULL, NULL, ?)")
      .bind(n(A1), NAME1, DAY),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(DAY),
  ]);
}

beforeAll(async () => {
  await seedRecords();
});

// -- accounts ------------------------------------------------------------------------------------

type Reader = { email: string; id: string; cookie: string; csrf: string };

async function reader(tag: string, plan: "free" | "pro" | "ultra" = "ultra"): Promise<Reader> {
  const email = newEmail(tag);
  const cookie = await signIn(email, { env: off() });
  if (plan === "pro") await grantPro(email);
  if (plan === "ultra") await grantUltra(email);
  return { email, id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env: off() }) };
}

const open = (r: Reader | null, path = "/account/dashboard", e: object = off()) => get(path, { cookie: r?.cookie, env: e });
const send = (r: Reader, path: string, fields: Record<string, string> = {}, e: object = off()) =>
  post(path, { csrf: r.csrf, ...fields }, { cookie: r.cookie, env: e });
// The page's script: a layout saved, and one tile read at a size.
const save = (r: Reader, layout: unknown, e: object = off()) => send(r, "/account/dashboard/layout", { layout: JSON.stringify(layout) }, e);
const readTile = (r: Reader, id: string, q = "", e: object = off(), token: string | null = r.csrf) =>
  get(`/account/dashboard/tiles/${id}${q}`, { cookie: r.cookie, env: e, headers: token === null ? {} : { "x-csrf-token": token } });

type TileRow = { id: string; kind: string; ref: string; opts: string; x: number; y: number; w: number; h: number };
const tileRows = (id: string) => ACCOUNTS.prepare("SELECT id, kind, ref, opts, x, y, w, h FROM dashboard_tiles WHERE user_id = ? ORDER BY y, x, id")
  .bind(id).all<TileRow>().then((r) => r.results ?? []);
const boards = (id: string) => ACCOUNTS.prepare("SELECT id, name, pos FROM dashboards WHERE user_id = ?").bind(id).all<{ id: string; name: string; pos: number }>()
  .then((r) => r.results ?? []);
const panelRows = (id: string) => ACCOUNTS.prepare("SELECT id, kind, ref, pos, wide FROM dashboard_panels WHERE user_id = ? ORDER BY pos, created_at, id")
  .bind(id).all<{ id: string; kind: string; ref: string; pos: number; wide: number }>().then((r) => r.results ?? []);

// The tiles as the page draws them, in reading order: id, the kind and the item, the place and size.
type Drawn = { id: string; head: string; x: number; y: number; w: number; h: number; html: string };
function drawn(html: string): Drawn[] {
  const main = mainOf(html);
  return main.split(/(?=<section class="panel dash-tile)/).slice(1).map((s) => {
    const attr = (k: string) => /^[^>]*/.exec(s)![0].match(new RegExp(` data-${k}="([^"]*)"`))?.[1] ?? "";
    const head = /<h2 id="tile-[^"]+-t" class="dash-title"[^>]*>([\s\S]*?)<\/h2>/.exec(s)?.[1] ?? "";
    return {
      id: attr("id"), head: head.replace(/<span class="dash-item">/, " | ").replace(/<[^>]+>/g, ""),
      x: Number(attr("x")), y: Number(attr("y")), w: Number(attr("w")), h: Number(attr("h")), html: s,
    };
  });
}
const heads = (html: string) => drawn(html).map((d) => d.head);
// Each tile's Open, in its foot.
const opens = (html: string) => [...mainOf(html).matchAll(/<div class="dash-foot">[\s\S]*?<a href="([^"]*)">Open<\/a>/g)].map((m) => m[1]);
const rowsIn = (s: string) => (s.match(/<tr>/g)?.length ?? 1) - 1;
// n tiles written straight into a dashboard, under its others: saved tender searches by made-up ids (the page says
// each was removed), a ref apart for each tag, so a dashboard reaches its figure without as many real searches.
async function fill(r: Reader, board: string, n: number, tag = "f"): Promise<void> {
  if (n <= 0) return;
  const at = new Date().toISOString();
  await ACCOUNTS.batch(Array.from({ length: n }, (_, i) => ACCOUNTS.prepare(
    "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, 'tenders', ?, '', 0, ?, 6, 10, ?)",
  ).bind(crypto.randomUUID().replace(/-/g, ""), board, r.id, `${tag}${i}`.padStart(32, "0"), 200 + 10 * i, at)));
}
const searchId = async (r: Reader, params: string) =>
  (await ACCOUNTS.prepare("SELECT id FROM saved_searches WHERE user_id = ? AND params = ?").bind(r.id, params).first<{ id: string }>())!.id;

// Tables taken off the database for the length of fn, then made again from accounts_schema.sql, their rows kept
// aside and put back: the database before the operator applies the schema. The grid's two tables ("tiles"), and
// with them the panels' table ("all").
const GRID_TABLES = ["dashboard_tiles", "dashboards"];
async function without<T>(which: "tiles" | "all", fn: () => Promise<T>): Promise<T> {
  const tables = which === "tiles" ? GRID_TABLES : [...GRID_TABLES, "dashboard_panels"];
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

// =====================================================================================

describe("the address", () => {
  it("is the site's 404 with the switch off, and while Ultra is off sale for every reader who does not hold it", async () => {
    expect((await get("/account/dashboard", { env: offEnv() })).status).toBe(404);
    const free = await reader("dash-off-free", "free");
    const pro = await reader("dash-off-pro", "pro");
    for (const r of [null, free, pro]) {
      const res = await open(r);
      expect(res.status).toBe(404);
      // The 404 as an unknown account address gives it, no-store as before Ultra, and no rail item.
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      expect(html).not.toContain("dash-grid");
      expect(html).not.toContain('href="/account/dashboard"');
    }
  });

  it("sends a reader signed out to the sign-in page, and back here, while Ultra is on sale", async () => {
    const res = await open(null, "/account/dashboard", sale());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/sign-in?next=%2Faccount%2Fdashboard");
  });
});

// A records binding that throws on any use: the Free and Pro page reads none.
const trap = () => {
  const used: string[] = [];
  const db = new Proxy({}, { get(_t, prop) { used.push(String(prop)); throw new Error("records read"); } }) as D1Database;
  return { db, used };
};

describe("a Free or Pro account while Ultra is on sale", () => {
  it("reads what the dashboard holds, the gate line and the three plan cards, Ultra's the one filled button, and no record", async () => {
    for (const plan of ["free", "pro"] as const) {
      const r = await reader(`dash-tease-${plan}`, plan);
      for (const lang of ["en", "fr"] as const) {
        const records = trap();
        const res = await open(r, `/account/dashboard?lang=${lang}`, sale({ RECORDS: records.db }));
        expect(res.status, plan).toBe(200);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        const html = await text(res);
        const main = mainOf(html);
        expect(main).toContain(`<h1>${norm(t(lang, "dash.title"))}</h1>`);
        expect(main).toContain(`<h2>${norm(t(lang, "dash.what_title"))}</h2>`);
        // Ultra's figures, as its plan card states them: 5 dashboards of 24 tiles each.
        const line = lang === "fr" ? `${RULES.ultra.dashboards} tableaux de bord de ${RULES.ultra.dashboard_tiles} tuiles chacun`
          : `${RULES.ultra.dashboards} dashboards of ${RULES.ultra.dashboard_tiles} tiles each`;
        expect(main).toContain(norm(t(lang, "dash.what_lead", { line })));
        expect(main).not.toMatch(/panels|panneaux/);
        // A line a kind, an earlier view's tile being an analytics table's; none still says a view shows its first chart.
        for (const k of TEASE_KINDS) expect(main, k).toContain(`<li>${norm(t(lang, `dash.what_${k}` as Key))}</li>`);
        const what = /<h2>[^<]*<\/h2><\/div><p>[^<]*<\/p><ul>([\s\S]*?)<\/ul>/.exec(main)![1];
        expect(what.match(/<li>/g)).toHaveLength(TEASE_KINDS.length);
        expect(what).not.toMatch(/first chart|premier graphique/);
        expect(main).toContain(`<p class="muted">${norm(t(lang, "dash.gate"))} <a href="/account/billing">${norm(t(lang, "billing.link_plans"))}</a></p>`);
        expect(main.match(/<div class="plan-card[ "]/g)).toHaveLength(3);
        expect(main).toContain("plan-card plan-card-ultra");
        // One filled button: Ultra's.
        const filled = [...main.matchAll(/<a href="([^"]*)" class="btn btn-primary">/g)].map((m) => m[1]);
        expect(filled).toHaveLength(1);
        expect(filled[0]).toContain("plan=ultra");
        // No tile, no script, no records read.
        expect(main).not.toContain("dash-tile");
        expect(main).not.toContain("dashboard.js");
        expect(records.used).toEqual([]);
        expect(html).not.toContain(EM_DASH);
        expect(html).not.toContain(EN_DASH);
      }
    }
  });
});

describe("an Ultra account", () => {
  it("with nothing stored sees the starting layout on the grid, computed and not stored", async () => {
    const r = await reader("dash-start");
    const html = await text(await open(r));
    expect(heads(html)).toEqual(["Your watches this week", "Contracts ending | Ending within 3 months"]);
    expect(drawn(html).map((d) => [d.id, d.x, d.y, d.w, d.h])).toEqual([
      ["s0", 0, 0, 12, START_H.watches], ["s1", 0, START_H.watches, 12, START_H.radar],
    ]);
    expect(mainOf(html)).toContain(`<p class="dash-status muted" id="dash-status" role="status" aria-live="polite">${t("en", "dash.starter")}</p>`);
    expect(await tileRows(r.id)).toEqual([]);
    expect(await boards(r.id)).toEqual([]);
    // With a claim, two saved tender searches and a key: matches and the years block, the first two searches, the API.
    await send(r, "/account/organization", { org: A1 });
    for (const url of ["/tenders?segment=82", "/tenders?segment=72", "/tenders?segment=43"]) await send(r, "/account/searches", { url });
    await send(r, "/account/keys", { name: "Reports" });
    const full = await text(await open(r));
    const h = heads(full);
    expect(h.slice(0, 4)).toEqual([
      "Your watches this week", "Contracts ending | Ending within 3 months", "Matching notices", `Your organization: Records by Fiscal Year | ${NAME1}`,
    ]);
    expect(h[4]).toMatch(/^Saved search: open notices \| .*82 /);
    expect(h[5]).toMatch(/^Saved search: open notices \| .*72 /);
    expect(h.slice(6)).toEqual(["API requests today"]);
    expect(await tileRows(r.id)).toEqual([]);
    expect(startingLayout({ searches: [], claim: null, keys: [] }).map((s) => `${s.kind}:${s.ref}`)).toEqual(["watches:", "radar:3m"]);
  });

  it("draws every kind from what it reads, each with its Open, and keeps the advisory line inside the matching notices", async () => {
    const r = await reader("dash-kinds");
    await send(r, "/account/organization", { org: A1 });
    await send(r, "/account/searches", { url: "/tenders?segment=82" });
    await send(r, "/account/searches", { url: "/expiring/12m?buyer=pwgsc-tpsgc" });
    await send(r, "/account/searches", { url: `/organizations/${A1}` });
    await send(r, "/account/briefings", { kind: "segment", subject: "81" });
    await send(r, "/account/keys", { name: "Reports" });
    const tenders = await searchId(r, "/tenders?segment=82");
    const expiring = await searchId(r, "/expiring/12m?buyer=pwgsc-tpsgc");
    const org = await searchId(r, `/organizations/${A1}`);
    const briefing = (await ACCOUNTS.prepare("SELECT id FROM briefings WHERE user_id = ?").bind(r.id).first<{ id: string }>())!.id;
    const view = `/organizations/${A1}/analytics?source=awards&years=10`;
    // The first change writes the starting layout (the watches, the 3-month list, matching notices, the years block,
    // the tender search, the API) as the account's tiles, then adds the tile under them; five more fill the twelve.
    const tiles: [string, string][] = [
      ["radar", expiring], ["radar", "12m"], ["records", org], ["view", view], ["briefing", briefing], ["org", "segments"],
    ];
    for (const [kind, ref] of tiles) {
      const res = await send(r, "/account/dashboard/panels", { kind, ref });
      expect(res.status, `${kind} ${ref}`).toBe(303);
      expect(res.headers.get("location"), `${kind} ${ref}`).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    }
    const stored = await tileRows(r.id);
    expect(stored.map((p) => `${p.kind}:${p.ref}`).sort()).toEqual([
      "watches:", "radar:3m", "matches:", "org:years", `tenders:${tenders}`, "api:", ...tiles.map(([k, v]) => `${k}:${v}`),
    ].sort());
    expect(stored.every((p) => p.opts === "")).toBe(true);
    expect(await boards(r.id)).toHaveLength(1);
    const res = await open(r, "/account/dashboard?m=added");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const html = await text(res);
    const main = mainOf(html);
    expect(main).toContain(`<p class="account-notice" role="status">${t("en", "dash.added")}</p>`);
    expect(main).not.toContain(t("en", "dash.starter"));
    const d = drawn(html);
    expect(d).toHaveLength(12);
    const by = (head: string | RegExp) => d.find((x) => (typeof head === "string" ? x.head === head : head.test(x.head)))!.html;
    expect(heads(html)).toEqual(expect.arrayContaining([
      "Your watches this week", "Contracts ending | Ending within 3 months", "Matching notices", `Your organization: Records by Fiscal Year | ${NAME1}`,
      "API requests today", "Contracts ending | Ending within 12 months", `Saved search: records | When ${NAME1} is named on a new award, contract or grant`,
      `Value by Fiscal Year | ${NAME1}`, "Weekly briefing, this week so far | 81 Engineering", `Your organization: Records by Segment | ${NAME1}`,
    ]));
    // Each tile's Open, to the page it comes from.
    expect(opens(html).sort()).toEqual([
      "/account/watches", "/expiring/3m", "/account/matches", "/account/organization", "/tenders?segment=82", "/account/api",
      "/expiring/12m?buyer=pwgsc-tpsgc", "/expiring/12m", `/organizations/${A1}`, `${view}#table-years`, "/segments/81", "/account/organization",
    ].sort());
    // The watches: the claimed organization's two events this week, not the one before it.
    expect(by("Your watches this week")).toContain("A new award this week");
    expect(by("Your watches this week")).toContain("A published contract this week");
    expect(by("Your watches this week")).not.toContain("An award before the week");
    // The 3-month list: the contracts ending within 91 days, as many as the tile holds, the count in its foot.
    const three = by("Contracts ending | Ending within 3 months");
    expect(three).toMatch(/<span class="dash-count">(\d+|\d+ of 9)<\/span>/);
    // The matching notices: the advisory line inside the tile, and the notice in segment 82 first.
    expect(by("Matching notices")).toContain('class="muted small fit-disclaimer"');
    expect(by("Matching notices")).toContain('<a href="/tenders/cb-100-10000001">');
    // The years block: the figures from the rows written, its note in the foot.
    expect(by(/^Your organization: Records by Fiscal Year/)).toContain("$300,000");
    expect(by(/^Your organization: Records by Fiscal Year/)).toContain("2026-27 (to date)");
    expect(by(/^Your organization: Records by Fiscal Year/)).toContain(`<span class="dash-meta" title="${t("en", "orgclaim.foot_years")}">`);
    // The tender search: the open notice in segment 82.
    expect(by(/^Saved search: open notices/)).toContain('<a href="/tenders/cb-100-10000001">');
    expect(by(/^Saved search: open notices/)).toContain('<span class="dash-count">1 notice</span>');
    // The API: the key, none used today, and the plan's daily figure (Ultra's, api_keyed_spec.ts keyQuota).
    expect(by("API requests today")).toContain("Reports");
    expect(by("API requests today")).toContain("Requests a day, per key: 50,000");
    // The saved radar search: 26 at the buyer, the tile's rows of them soonest first, "n of 26" in its foot.
    const saved = drawn(html).find((x) => /Public Services and Procurement Canada/.test(x.head))!;
    const rows = tileFit("radar", expiring, saved.w, saved.h).rows;
    expect(rowsIn(saved.html)).toBe(rows);
    expect(saved.html).toContain(`<span class="dash-count">${rows} of 26</span>`);
    expect(saved.html).toContain("EN578-100000");
    expect(saved.html).not.toContain(`EN578-${100000 + rows}`);
    // The records search: each source over the last two fiscal years.
    const records = by(/^Saved search: records/);
    expect(records).toContain("2025-26");
    expect(records).toContain("$500,000");
    expect(records).toContain("$12,345");
    // The view: its first table drawn in full (the chart and the table) at its source and period (in its foot), named
    // from the records, at the tile's size: its two fiscal years with records, the plot taking the rows' room left.
    const v = drawn(html).find((x) => x.head.startsWith("Value by Fiscal Year"))!;
    expect(v.html).toContain("Award notices, federal fiscal years 2017-18 to 2026-27.");
    expect(v.html).toContain('class="chart"');
    const vfit = analyticFit("organization/years", v.w, v.h);
    expect(v.html).toContain(`<div class="chart-plot" style="height:${analyticPlot("organization/years", vfit, 2)}px">`);
    expect(rowsIn(v.html)).toBe(2);
    // The briefing: the week's counts, one line each.
    expect(by(/^Weekly briefing/)).toContain('<ul class="plain dash-counts">');
    expect(by(/^Weekly briefing/).match(/<li>/g)).toHaveLength(4);
    // The segments block: segment 81's award notices.
    expect(by(/^Your organization: Records by Segment/)).toContain("81 Engineering");
    for (const x of d) {
      expect(x.html).not.toContain(t("en", "dash.unavailable"));
      expect(x.html).not.toContain(t("en", "dash.gone"));
    }
    // One filled button, Add a Tile; every table fits its tile at every width from 700 px, or stacks.
    expect(main.match(/btn-primary/g)).toHaveLength(1);
    expect(tablesIn(html).length).toBeGreaterThanOrEqual(8);
    expect(misfits(html)).toEqual([]);
    // Filled to the plan's figure (TILES_MAX, 24): one more is refused inside the insert, and the page says so.
    const board = (await boards(r.id))[0].id;
    await fill(r, board, TILES_MAX - 12);
    expect((await tileRows(r.id)).length).toBe(TILES_MAX);
    const full = await send(r, "/account/dashboard/panels", { kind: "org", ref: "share" });
    expect(full.headers.get("location")).toBe("/account/dashboard?m=full");
    expect((await tileRows(r.id)).length).toBe(TILES_MAX);
    expect(await text(await open(r, "/account/dashboard?m=full"))).toContain(t("en", "dash.full", { cap: "24" }));
  });

  it("draws the organization's other blocks, side by side on the grid, every table in its tile at every width", async () => {
    const r = await reader("dash-blocks");
    await send(r, "/account/organization", { org: A1 });
    for (const ref of ["share", "ending", "buyers", "instruments"]) {
      expect((await send(r, "/account/dashboard/panels", { kind: "org", ref })).headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    }
    const html = await text(await open(r));
    const d = drawn(html);
    expect(d.filter((x) => x.w === 6)).toHaveLength(4);
    const at = (title: string) => d.find((x) => x.head.includes(title))?.html ?? "";
    expect(at("Share of a Segment")).toContain("81 Engineering and Research and Technology Based Services · Award notices");
    // Its own share by fiscal year: all of 2025-26's counted value, 30 of 2026-27's 40.
    expect(at("Share of a Segment")).toContain("100%");
    expect(at("Share of a Segment")).toContain("75%");
    expect(at("Share of a Segment")).toContain("Records whose supplier is withheld");
    expect(at("Contracts Ending Within 12 Months")).toMatch(/<span class="dash-count">\d+ of 26<\/span>/);
    expect(at("Buyers It Has Won From")).toContain('<a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a>');
    expect(at("Standing Offers and Supply Arrangements")).toContain("E60ZT-120002/001/ZT");
    for (const x of d) expect(x.html).not.toContain(t("en", "dash.unavailable"));
    expect(misfits(html)).toEqual([]);
  });

  it("says a tile whose item was removed, offering Remove; a search or briefing removed on its page takes its tile with it", async () => {
    const r = await reader("dash-gone");
    await send(r, "/account/searches", { url: "/tenders?segment=82" });
    await send(r, "/account/searches", { url: "/tenders?segment=72" });
    await send(r, "/account/briefings", { kind: "segment", subject: "81" });
    const first = await searchId(r, "/tenders?segment=82");
    const second = await searchId(r, "/tenders?segment=72");
    const briefing = (await ACCOUNTS.prepare("SELECT id FROM briefings WHERE user_id = ?").bind(r.id).first<{ id: string }>())!.id;
    await send(r, "/account/dashboard/panels", { kind: "briefing", ref: briefing });
    // A search removed behind the page's back (as another tab's delete could leave it): the tile says so.
    await ACCOUNTS.prepare("DELETE FROM saved_searches WHERE id = ?").bind(first).run();
    const html = await text(await open(r));
    const gone = drawn(html).find((x) => x.html.includes(t("en", "dash.gone")))!;
    expect(gone).toBeDefined();
    expect(gone.head).toBe("Saved search: open notices");
    expect(gone.html).toMatch(/<form method="post" action="\/account\/dashboard\/tiles\/[0-9a-f]{32}\/delete">/);
    expect(gone.html).not.toContain(">Open</a>");
    // Removed on the searches page and the briefings panel, each takes its tile.
    const before = (await tileRows(r.id)).length;
    await send(r, `/account/searches/${second}/delete`);
    await send(r, `/account/briefings/${briefing}/delete`);
    const after = await tileRows(r.id);
    expect(after.length).toBe(before - 2);
    expect(after.some((p) => p.ref === second || p.ref === briefing)).toBe(false);
  });

  it("refuses the third briefing and the tile past the figure inside the insert itself", async () => {
    const r = await reader("dash-caps");
    for (const s of ["81", "43", "72"]) await send(r, "/account/briefings", { kind: "segment", subject: s });
    const ids = ((await ACCOUNTS.prepare("SELECT id FROM briefings WHERE user_id = ? ORDER BY created_at, id").bind(r.id).all<{ id: string }>()).results ?? [])
      .map((x) => x.id);
    expect(ids).toHaveLength(3);
    for (const id of ids.slice(0, BRIEFING_PANELS_MAX)) {
      expect((await send(r, "/account/dashboard/panels", { kind: "briefing", ref: id })).headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    }
    const third = await send(r, "/account/dashboard/panels", { kind: "briefing", ref: ids[2] });
    expect(third.headers.get("location")).toBe("/account/dashboard?m=briefings_full");
    expect(await text(await open(r, "/account/dashboard?m=briefings_full"))).toContain(t("en", "dash.briefings_full", { n: "2" }));
    // The statement alone holds all three: two inserts at once cannot pass any of them.
    const insert = (kind: string, ref: string, cap: number) => ACCOUNTS.prepare(ADD_TILE_SQL)
      .bind(crypto.randomUUID().replace(/-/g, ""), r.id, kind, ref, 0, 99, 6, 9, new Date().toISOString(), cap, BRIEFING_PANELS_MAX, null).run();
    expect((await insert("briefing", ids[2], TILES_MAX)).meta.changes).toBe(0);
    const held = (await tileRows(r.id)).length;
    expect((await insert("watches", "x", held)).meta.changes).toBe(0);
    expect((await insert("watches", "x", held + 1)).meta.changes).toBe(1);
    // The same item once.
    expect((await insert("watches", "x", TILES_MAX)).meta.changes).toBe(0);
    // The figures are RULES' (5 dashboards of 24 tiles on Ultra, none on Free and Pro), the ceilings Ultra's.
    expect([RULES.free.dashboards, RULES.pro.dashboards, RULES.ultra.dashboards]).toEqual([0, 0, 5]);
    expect([RULES.free.dashboard_tiles, RULES.pro.dashboard_tiles, RULES.ultra.dashboard_tiles]).toEqual([0, 0, 24]);
    expect([tileCap("ultra"), boardCap("ultra")]).toEqual([RULES.ultra.dashboard_tiles, RULES.ultra.dashboards]);
    expect([TILES_MAX, DASHBOARDS_MAX]).toEqual([RULES.ultra.dashboard_tiles, RULES.ultra.dashboards]);
    expect([tileCap("free"), tileCap("pro"), boardCap("free"), boardCap("pro")]).toEqual([0, 0, 0, 0]);
    // A tile goes in only into the account's own dashboard: with none, nothing is written; nor into another account's.
    const fresh = await reader("dash-caps-none");
    const none = await ACCOUNTS.prepare(ADD_TILE_SQL).bind("f".repeat(32), fresh.id, "watches", "", 0, 0, 6, 9, new Date().toISOString(), 24, 2, null).run();
    expect(none.meta.changes).toBe(0);
    const theirs = (await boards(r.id))[0].id;
    const foreign = await ACCOUNTS.prepare(ADD_TILE_SQL).bind("e".repeat(32), fresh.id, "watches", "", 0, 0, 6, 9, new Date().toISOString(), 24, 2, theirs).run();
    expect(foreign.meta.changes).toBe(0);
  });
});

// =====================================================================================
// The three states of storage
// =====================================================================================

describe("without the grid's tables (accounts_schema.sql not applied since the grid)", () => {
  it("lays the panels or the starting layout out on the grid, says places cannot be kept, saves none, and answers no 500", async () => {
    const r = await reader("dash-state-a");
    await send(r, "/account/searches", { url: "/tenders?segment=82" });
    await without("tiles", async () => {
      // The starting layout on the grid, the line that says positions and sizes cannot be saved yet.
      const first = await text(await open(r));
      expect(drawn(first).map((d) => [d.id, d.x, d.y, d.w])).toEqual([["s0", 0, 0, 12], ["s1", 0, START_H.watches, 12], ["s2", 0, START_H.watches + START_H.radar, 12]]);
      expect(mainOf(first)).toContain(t("en", "dash.unsaved_layout"));
      expect(first).toContain('"save":false');
      // The script's save answers that nothing was kept; the menu's steps say so; nothing answers 500.
      const saved = await save(r, [{ id: "s0", x: 0, y: 0, w: 6, h: 9 }]);
      expect(saved.status).toBe(200);
      expect(saved.headers.get("cache-control")).toBe("private, no-store");
      expect(await saved.json()).toEqual({ state: "unsaved" });
      for (const [path, fields] of [["/account/dashboard/tiles/s0/move", { dir: "down" }], ["/account/dashboard/tiles/s1/size", { to: "narrower" }]] as const) {
        const res = await send(r, path, fields);
        expect(res.status, path).toBe(303);
        expect(res.headers.get("location"), path).toBe("/account/dashboard?m=unsaved_layout");
      }
      // One tile read at a size works from the computed layout.
      const tile = await readTile(r, "s1", "?w=6&h=12");
      expect(tile.status).toBe(200);
      expect(await tile.text()).toContain('data-w="6" data-h="12"');
      // Adding and removing keep working, in the panels' table, as before the grid.
      expect((await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" })).headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
      const rows = await panelRows(r.id);
      expect(rows.map((p) => `${p.kind}:${p.ref}`)).toEqual(["watches:", "radar:3m", `tenders:${await searchId(r, "/tenders?segment=82")}`, "radar:6m"]);
      expect((await send(r, `/account/dashboard/tiles/${rows[0].id}/delete`)).status).toBe(303);
      expect((await panelRows(r.id)).map((p) => `${p.kind}:${p.ref}`)).toEqual(["radar:3m", `tenders:${await searchId(r, "/tenders?segment=82")}`, "radar:6m"]);
      // The page lays the panels out: their order, full width.
      const panels = await text(await open(r));
      expect(heads(panels)).toEqual(["Contracts ending | Ending within 3 months", expect.stringMatching(/^Saved search: open notices/), "Contracts ending | Ending within 6 months"]);
      // Deleting the account works without the tables.
      const gone = await reader("dash-state-a-delete");
      expect((await send(gone, "/account/delete", { confirm: "yes" })).status).toBe(200);
    });
  });

  it("with neither the grid's tables nor the panels', shows the starting layout and keeps nothing", async () => {
    const r = await reader("dash-state-none");
    await without("all", async () => {
      const html = await text(await open(r));
      expect(heads(html)).toEqual(["Your watches this week", "Contracts ending | Ending within 3 months"]);
      expect(mainOf(html)).toContain(t("en", "dash.unsaved"));
      // Add a Tile says why it adds nothing.
      expect(mainOf(html)).toMatch(/<div class="dash-adder-body"><p class="muted small">2 of 24 tiles<\/p><p class="muted">The dashboard cannot be saved yet/);
      expect((await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" })).headers.get("location")).toBe("/account/dashboard?m=unsaved");
      expect((await send(r, "/account/dashboard/tiles/s0/move", { dir: "down" })).headers.get("location")).toBe("/account/dashboard?m=unsaved");
      expect((await send(r, "/account/dashboard/tiles/s0/delete")).headers.get("location")).toBe("/account/dashboard?m=unsaved");
      expect(await (await save(r, [])).json()).toEqual({ state: "unsaved" });
      expect(await text(await open(r, "/account/dashboard?m=unsaved"))).toContain(t("en", "dash.unsaved"));
      expect((await open(r, "/account/searches")).status).toBe(200);
    });
  });
});

describe("with the grid's tables and nothing stored for the account", () => {
  it("shows the panels laid out on the grid, computed; the first change writes the whole layout, and the panels are read no more", async () => {
    const r = await reader("dash-state-b");
    // Panels the account arranged before the grid: two half-width ones side by side, then a full-width one.
    const at = new Date().toISOString();
    const P = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
    await ACCOUNTS.batch([["radar", "3m", 0, 0], ["radar", "6m", 1, 0], ["watches", "", 2, 1]].map(([kind, ref, pos, wide], i) => ACCOUNTS.prepare(
      "INSERT INTO dashboard_panels (id, user_id, kind, ref, pos, wide, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(P[i], r.id, kind, ref, pos, wide, at)));
    const html = await text(await open(r));
    expect(drawn(html).map((d) => [d.id, d.x, d.y, d.w, d.h])).toEqual([
      [P[0], 0, 0, 6, START_H.radar], [P[1], 6, 0, 6, START_H.radar], [P[2], 0, START_H.radar, 12, START_H.watches],
    ]);
    expect(mainOf(html)).not.toContain(t("en", "dash.starter"));
    expect(html).toContain('"save":true');
    expect(await boards(r.id)).toEqual([]);
    // The first change: the script's save of the layout with the watches moved up. The whole layout is written, the
    // panels' ids kept, and the answer is the layout as kept.
    const res = await save(r, [{ id: P[2], x: 0, y: 0, w: 12, h: START_H.watches }, { id: "f".repeat(32), x: 0, y: 0, w: 3, h: 3 }, { id: P[0], x: 0, y: 99 }]);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const answer = await res.json() as { state: string; tiles: { id: string; x: number; y: number; w: number; h: number }[]; renamed: object };
    expect(answer.state).toBe("saved");
    expect(answer.renamed).toEqual({});
    const rows = await tileRows(r.id);
    expect(rows.map((x) => [x.id, x.kind, x.ref, x.x, x.y, x.w, x.h])).toEqual([
      [P[2], "watches", "", 0, 0, 12, START_H.watches], [P[0], "radar", "3m", 0, START_H.watches, 6, START_H.radar],
      [P[1], "radar", "6m", 6, START_H.watches, 6, START_H.radar],
    ]);
    expect(answer.tiles).toEqual(rows.map((x) => ({ id: x.id, x: x.x, y: x.y, w: x.w, h: x.h })));
    const board = await boards(r.id);
    expect(board).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{32}$/), name: "", pos: 0 }]);
    // The panels' table is read no more for this account: a panel written there now changes nothing.
    await ACCOUNTS.prepare("INSERT INTO dashboard_panels (id, user_id, kind, ref, pos, wide, created_at) VALUES (?, ?, 'radar', '12m', 3, 1, ?)")
      .bind("d".repeat(32), r.id, at).run();
    expect(heads(await text(await open(r)))).toEqual(["Your watches this week", "Contracts ending | Ending within 3 months", "Contracts ending | Ending within 6 months"]);
  });

  it("writes the starting layout with new ids at the first change, and answers each starter's new id", async () => {
    const r = await reader("dash-state-b-starter");
    const res = await save(r, [{ id: "s1", x: 6, y: 0, w: 6, h: 11 }, { id: "s0", x: 0, y: 0, w: 6, h: 11 }]);
    const answer = await res.json() as { state: string; tiles: { id: string }[]; renamed: Record<string, string> };
    const rows = await tileRows(r.id);
    expect(rows.map((x) => [x.kind, x.ref, x.x, x.y, x.w, x.h])).toEqual([["watches", "", 0, 0, 6, 11], ["radar", "3m", 6, 0, 6, 11]]);
    expect(answer.renamed).toEqual({ s0: rows[0].id, s1: rows[1].id });
    expect(answer.tiles.map((x) => x.id)).toEqual([rows[0].id, rows[1].id]);
    // A second first change from another tab, at once, writes nothing more.
    await save(r, [{ id: "s0", x: 0, y: 0, w: 12, h: 11 }]);
    expect((await tileRows(r.id)).length).toBe(2);
    expect(await boards(r.id)).toHaveLength(1);
  });

  it("writes the layout at the first add, removal, step or size from the menu, then applies it", async () => {
    for (const [tag, path, fields, check] of [
      ["add", "/account/dashboard/panels", { kind: "radar", ref: "12m" }, (rows: TileRow[]) => expect(rows.map((x) => `${x.kind}:${x.ref}`)).toEqual(["watches:", "radar:3m", "radar:12m"])],
      ["remove", "/account/dashboard/tiles/s0/delete", {}, (rows: TileRow[]) => expect(rows.map((x) => `${x.kind}:${x.ref}@${x.y}`)).toEqual(["radar:3m@0"])],
      ["step", "/account/dashboard/tiles/s1/move", { dir: "up" }, (rows: TileRow[]) => expect(rows.map((x) => `${x.kind}@${x.y}`)).toEqual(["radar@0", `watches@${START_H.radar}`])],
      ["size", "/account/dashboard/tiles/s1/size", { to: "narrower" }, (rows: TileRow[]) => expect(rows.find((x) => x.kind === "radar")!.w).toBe(11)],
    ] as const) {
      const r = await reader(`dash-state-b-${tag}`);
      const res = await send(r, path, fields);
      expect(res.status, tag).toBe(303);
      expect(res.headers.get("location"), tag).toMatch(/^\/account\/dashboard(\?m=added)?#(tile-[0-9a-f]{32}|dash-add)$/);
      check(await tileRows(r.id));
      expect(await boards(r.id), tag).toHaveLength(1);
    }
  });
});

describe("with the account's tiles stored", () => {
  it("draws each at its stored place and size, holds a posted layout to the grid and to the account's own tiles, and answers it", async () => {
    const r = await reader("dash-state-c");
    const other = await reader("dash-state-c-other");
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" });
    await send(other, "/account/dashboard/panels", { kind: "radar", ref: "6m" });
    const rows = await tileRows(r.id);
    expect(rows.map((x) => `${x.kind}:${x.ref}`)).toEqual(["watches:", "radar:3m", "radar:6m"]);
    const [w, three, six] = rows;
    // Placed by the script: the 6-month list beside the watches, the 3-month list wide under them; another
    // account's tile, nonsense sizes and a negative place go through the grid's rules.
    const foreign = (await tileRows(other.id))[0].id;
    const res = await save(r, [
      { id: w.id, x: 0, y: 0, w: 6, h: 9 }, { id: six.id, x: 6, y: 0, w: 6, h: 99 }, { id: three.id, x: -4, y: 0, w: 40, h: 9 },
      { id: foreign, x: 0, y: 0, w: 3, h: 2 }, { id: "s0", x: 0, y: 0, w: 3, h: 2 }, "nonsense", null,
    ]);
    const answer = await res.json() as { state: string; tiles: { id: string; x: number; y: number; w: number; h: number }[] };
    expect(answer.state).toBe("saved");
    const kept = await tileRows(r.id);
    expect(kept.map((x) => [x.id, x.x, x.y, x.w, x.h])).toEqual(normalize([
      { id: w.id, kind: "watches", x: 0, y: 0, w: 6, h: 9 }, { id: six.id, kind: "radar", x: 6, y: 0, w: 6, h: 99 },
      { id: three.id, kind: "radar", x: -4, y: 0, w: 40, h: 9 },
    ]).map((x) => [x.id, x.x, x.y, x.w, x.h]).sort((a, b) => (a[2] as number) - (b[2] as number) || (a[1] as number) - (b[1] as number)));
    expect(kept.find((x) => x.id === six.id)!.h).toBe(16);
    expect(answer.tiles.map((x) => x.id).sort()).toEqual(kept.map((x) => x.id).sort());
    // The other account's tile is as it was.
    expect((await tileRows(other.id))[0]).toMatchObject({ id: foreign, kind: "watches" });
    // The page draws them at their places, in reading order.
    const page = drawn(await text(await open(r)));
    expect(page.map((d) => [d.id, d.x, d.y, d.w, d.h])).toEqual(kept.map((x) => [x.id, x.x, x.y, x.w, x.h]));
    // A stored place the grid would not give (an overlap written by hand) is drawn held to the grid.
    await ACCOUNTS.prepare("UPDATE dashboard_tiles SET x = 0, y = 0, w = 2, h = 1 WHERE id = ?").bind(three.id).run();
    const held = drawn(await text(await open(r)));
    expect(held.find((d) => d.id === three.id)).toMatchObject({ w: least("radar").w, h: least("radar", least("radar").w).h });
    for (let i = 0; i < held.length; i++) for (let j = i + 1; j < held.length; j++) {
      const a = held[i];
      const b = held[j];
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.id} meets ${b.id}`).toBe(false);
    }
    // A layout that is not a list, too long, or not JSON is refused and changes nothing.
    for (const bad of ["{}", "[", JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ id: String(i) }))), "x".repeat(9000)]) {
      const refused = await send(r, "/account/dashboard/layout", { layout: bad });
      expect(refused.status, bad.slice(0, 20)).toBe(400);
    }
  });

  it("steps and sizes a tile from its menu as the grid does, and offers only the steps that change the layout", async () => {
    const r = await reader("dash-menu");
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" });
    const [w, three, six] = await tileRows(r.id);
    const go = async (id: string, op: string, field: string, value: string) => {
      const res = await send(r, `/account/dashboard/tiles/${id}/${op}`, { [field]: value });
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe(`/account/dashboard#tile-${id}`);
      return tileRows(r.id);
    };
    // The 6-month list up a place: above the 3-month list.
    let rows = await go(six.id, "move", "dir", "up");
    expect(rows.map((x) => x.ref)).toEqual(["", "6m", "3m"]);
    // Narrower twice, then right: it leaves the left edge.
    rows = await go(six.id, "size", "to", "narrower");
    rows = await go(six.id, "size", "to", "narrower");
    rows = await go(six.id, "move", "dir", "right");
    expect(rows.find((x) => x.id === six.id)).toMatchObject({ x: 1, w: 4 });
    rows = await go(six.id, "size", "to", "taller");
    expect(rows.find((x) => x.id === six.id)!.h).toBe(START_H.radar + 1);
    rows = await go(six.id, "size", "to", "shorter");
    expect(rows.find((x) => x.id === six.id)!.h).toBe(START_H.radar);
    // The menu: each step a post with its CSRF value, Open first, Remove last; a step that changes nothing is offered
    // disabled (the watches cannot go up, nor sideways at full width).
    const html = await text(await open(r));
    const watches = drawn(html).find((d) => d.id === w.id)!.html;
    const offer = gridSteps(drawn(html).map((d) => ({ id: d.id, kind: d.id === w.id ? "watches" : "radar", x: d.x, y: d.y, w: d.w, h: d.h })), w.id);
    for (const [step, label] of [["left", "Move left"], ["right", "Move right"], ["up", "Move up"], ["down", "Move down"], ["wider", "Wider"], ["narrower", "Narrower"],
      ["taller", "Taller"], ["shorter", "Shorter"]] as const) {
      const op = ["left", "right", "up", "down"].includes(step) ? "move" : "size";
      const field = op === "move" ? "dir" : "to";
      expect(watches, step).toContain(`<form method="post" action="/account/dashboard/tiles/${w.id}/${op}"><input type="hidden" name="csrf" value="${r.csrf}"/>` +
        `<input type="hidden" name="${field}" value="${step}"/><button type="submit" class="dash-menu-item" data-step="${step}"${offer[step] ? "" : ' disabled=""'}>${label}</button></form>`);
    }
    expect(offer).toMatchObject({ up: false, left: false, right: false, wider: false, down: true });
    expect(watches).toContain(`<a href="/account/watches" class="dash-menu-item">Open</a>`);
    expect(watches).toMatch(/<form method="post" action="\/account\/dashboard\/tiles\/[0-9a-f]{32}\/delete"><input type="hidden" name="csrf" value="[0-9a-f]{32}"\/><button type="submit" class="dash-menu-item">Remove<\/button><\/form><\/div><\/details>/);
    // A step the post does not name, or another account's tile: refused, or nothing changed.
    expect((await send(r, `/account/dashboard/tiles/${six.id}/move`, { dir: "wider" })).status).toBe(400);
    expect((await send(r, `/account/dashboard/tiles/${six.id}/size`, { to: "up" })).status).toBe(400);
    expect((await send(r, `/account/dashboard/tiles/${six.id}/spin`, { to: "up" })).status).toBe(404);
    const other = await reader("dash-menu-other");
    const before = await tileRows(r.id);
    await send(other, `/account/dashboard/tiles/${six.id}/move`, { dir: "down" });
    await send(other, `/account/dashboard/tiles/${six.id}/delete`);
    expect(await tileRows(r.id)).toEqual(before);
    // The earlier page's posts answer as they did: a place up, a width, a removal.
    const legacy = await send(r, `/account/dashboard/panels/${three.id}/width`, { wide: "1" });
    expect(legacy.headers.get("location")).toBe(`/account/dashboard#tile-${three.id}`);
    expect((await tileRows(r.id)).find((x) => x.id === three.id)!.w).toBe(12);
  });

  it("removes a tile at the tile that takes its place, and an emptied dashboard stays empty, Add a Tile open", async () => {
    const r = await reader("dash-remove");
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" });
    const [a, b, c] = await tileRows(r.id);
    expect((await send(r, `/account/dashboard/tiles/${b.id}/delete`)).headers.get("location")).toBe(`/account/dashboard#tile-${c.id}`);
    expect((await send(r, `/account/dashboard/tiles/${c.id}/delete`)).headers.get("location")).toBe(`/account/dashboard#tile-${a.id}`);
    expect((await send(r, `/account/dashboard/tiles/${a.id}/delete`)).headers.get("location")).toBe("/account/dashboard#dash-add");
    expect(await tileRows(r.id)).toEqual([]);
    expect(await boards(r.id)).toHaveLength(1);
    const main = mainOf(await text(await open(r)));
    expect(main).not.toContain("dash-tile");
    expect(main).not.toContain(t("en", "dash.starter"));
    expect(main).toContain('<details class="dash-adder" id="dash-add" open="">');
    expect(main).toContain('<option value="radar:6m">');
    // Its next tile comes alone.
    await send(r, "/account/dashboard/panels", { panel: "radar:6m" });
    expect((await tileRows(r.id)).map((x) => `${x.kind}:${x.ref}@${x.x},${x.y}`)).toEqual(["radar:6m@0,0"]);
  });
});

// =====================================================================================

describe("a tile's size", () => {
  it("sets the rows it lists, 3 at the least and 25 at the most, the statement's LIMIT and its foot's count", async () => {
    const r = await reader("dash-rows");
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "12m" });
    const id = (await tileRows(r.id)).find((x) => x.ref === "12m")!.id;
    const sizes: [number, number][] = [[least("radar").w, least("radar", least("radar").w).h], [6, 8], [12, 12], [12, 16]];
    let last = 0;
    for (const [w, h] of sizes) {
      await save(r, [{ id, x: 0, y: 0, w, h }]);
      const tile = drawn(await text(await open(r))).find((d) => d.id === id)!;
      const rows = tileFit("radar", "12m", w, h).rows;
      expect(rowsIn(tile.html), `${w}x${h}`).toBe(rows);
      expect(rows).toBeGreaterThanOrEqual(3);
      expect(rows).toBeLessThanOrEqual(25);
      expect(rows, `${w}x${h}`).toBeGreaterThanOrEqual(last);
      last = rows;
      expect(tile.html).toContain(`<span class="dash-count">${rows} of 30</span>`);
      expect(tile.html).toContain('data-total="30"');
    }
    // The radar's short form reads the tile's rows through the window's index.
    expect(RADAR_TOP_SQL).toBe(RADAR_ROWS_END_SQL.replace(/ LIMIT 100 OFFSET \?13$/, " LIMIT ?13"));
    const binds = radarBinds(endingParams(n(A1), claimFrame(DAY)));
    for (const rows of [3, 25]) expect(((await RECORDS.prepare(RADAR_TOP_SQL).bind(...binds, rows).all()).results ?? []).length).toBe(rows);
    const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${RADAR_TOP_SQL}`).bind(...binds, 5).all()).results ?? []).map((x) => String((x as { detail?: unknown }).detail));
    expect(steps.filter((s) => /^SCAN rec_expiring\b/.test(s) && !/USING/.test(s)), steps.join("\n")).toEqual([]);
    expect(steps.join("\n")).toMatch(/rec_expiring_end/);
  });

  it("is read for one tile alone, behind the session and the CSRF value in its header, at the size asked, held to the grid", async () => {
    const r = await reader("dash-fragment");
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "12m" });
    const id = (await tileRows(r.id)).find((x) => x.ref === "12m")!.id;
    const res = await readTile(r, id, "?w=6&h=14");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = norm(decode(await res.text()));
    expect(html.startsWith(`<section class="panel dash-tile" id="tile-${id}"`)).toBe(true);
    expect(html).toContain('data-w="6" data-h="14"');
    expect(rowsIn(html)).toBe(tileFit("radar", "12m", 6, 14).rows);
    expect(html).not.toContain("<html");
    // Held to the grid: past the columns and below the least.
    expect(norm(decode(await (await readTile(r, id, "?w=40&h=1")).text()))).toContain(`data-w="12" data-h="${least("radar").h}"`);
    // Its own size without one asked.
    expect(norm(decode(await (await readTile(r, id)).text()))).toMatch(/data-w="6" data-h="\d+"/);
    // Without the header's value, with another value, without a session, for another account's tile or an unknown id: nothing.
    expect((await readTile(r, id, "", off(), null)).status).toBe(403);
    expect((await readTile(r, id, "", off(), "0".repeat(32))).status).toBe(403);
    expect((await get(`/account/dashboard/tiles/${id}`, { env: off(), headers: { "x-csrf-token": r.csrf } })).status).toBe(403);
    const other = await reader("dash-fragment-other");
    expect((await readTile(other, id)).status).toBe(404);
    expect((await readTile(r, "s9")).status).toBe(404);
    // A Free account reads none.
    const free = await reader("dash-fragment-free", "free");
    expect((await readTile(free, "s0")).status).toBe(404);
  });

  it("draws a view's tile from before as its view's first table, chart and table to the tile's width and height", async () => {
    const r = await reader("dash-chart");
    const view = "/buyers/ssc-spc/analytics?source=history&years=20";
    await send(r, "/account/dashboard/panels", { kind: "view", ref: view });
    const id = (await tileRows(r.id)).find((x) => x.kind === "view")!.id;
    const plot = (html: string) => Number(/<div class="chart-plot" style="height:(\d+)px">/.exec(html)?.[1]);
    const labels = (html: string) => (html.match(/<div class="chart-x">([\s\S]*?)<\/div>/)?.[1].match(/<span /g) ?? []).length;
    const least = LEAST["analytic:chart"];
    const small = norm(decode(await (await readTile(r, id, `?w=${least.w}&h=${least.hn}`)).text()));
    const big = norm(decode(await (await readTile(r, id, "?w=12&h=16")).text()));
    const fit = (w: number, h: number) => analyticFit("buyer/quarters", w, h);
    expect(plot(small)).toBe(fit(least.w, least.hn).plot);
    expect(plot(big)).toBe(fit(12, 16).plot);
    expect(plot(big)).toBeGreaterThan(plot(small));
    // A narrow chart's axis keeps fewer of its years' labels; its table lists as many years as its height holds.
    expect(labels(big)).toBeGreaterThan(labels(small));
    expect(rowsIn(small)).toBe(fit(least.w, least.hn).rows);
    expect(rowsIn(big)).toBe(fit(12, 16).rows);
    expect(small).toContain(`<span class="dash-count">${fit(least.w, least.hn).rows} of 20</span>`);
    // Headed by the table, named from the records, its source and period in the foot, Open at the table's anchor.
    expect(small).toContain(`<h2 id="tile-${id}-t" class="dash-title" title="Value by Fiscal Quarter: Shared Services Canada">Value by Fiscal Quarter<span class="dash-item">Shared Services Canada</span></h2>`);
    expect(small).toContain("PSPC contract history, federal fiscal years 2007-08 to 2026-27.");
    expect(small).toContain(`<a href="${view}#table-quarters">Open</a>`);
    expect(small).not.toMatch(/See all|Voir tout/);
  });
});

describe("the page", () => {
  it("has no edit mode: ?edit=1 is the same page, Add a Tile its one filled button, every tile its handles and its menu", async () => {
    const r = await reader("dash-page");
    await send(r, "/account/searches", { url: "/tenders?segment=82" });
    const plain = mainOf(await text(await open(r)));
    const edit = mainOf(await text(await open(r, "/account/dashboard?edit=1")));
    expect(edit).toBe(plain);
    expect(plain.match(/btn-primary/g)).toHaveLength(1);
    expect(plain).toContain(`<details class="dash-adder" id="dash-add"><summary class="btn btn-primary">${t("en", "dash.add_tile")}</summary>`);
    expect(plain).toContain('<p class="muted small">3 of 24 tiles</p>');
    expect(plain).toContain('<button type="submit" class="btn">Add</button>');
    expect(plain).toContain('<optgroup label="Contracts ending"><option value="radar:6m">Ending within 6 months</option>');
    expect(plain).not.toContain('value="radar:3m"');
    expect(plain).not.toContain('value="watches:"');
    // The handles are buttons, described by the keys' help; the menu a details element.
    for (const d of drawn(plain)) {
      expect(d.html).toContain(`<button type="button" class="dash-grip" aria-label="Move: ${d.head.replace(" | ", ": ")}" aria-describedby="dash-keys-move">`);
      expect(d.html).toContain(`<button type="button" class="dash-corner" aria-label="Resize: ${d.head.replace(" | ", ": ")}" aria-describedby="dash-keys-size"></button>`);
      expect(d.html).toContain('<details class="dash-menu"><summary class="dash-menu-button"');
    }
    expect(plain).toContain(`<p id="dash-keys-move" hidden="">${t("en", "dash.keys_move")}</p>`);
    expect(plain).toContain('<p id="dash-say" class="visually-hidden" aria-live="polite"></p>');
    // The script and its words, every template in pieces.
    expect(plain).toContain('<script type="module" src="/dashboard.js"></script>');
    const data = JSON.parse(/<script type="application\/json" id="dash-data">([\s\S]*?)<\/script>/.exec(plain)![1]);
    expect(data).toMatchObject({ csrf: r.csrf, save: true, cols: 12, layout: "/account/dashboard/layout", tiles: "/account/dashboard/tiles/" });
    expect(data.words.at).toEqual(["", "title", ": column ", "x", " of ", "cols", ", row ", "y", "."]);
    expect(plain).not.toMatch(/\{\w+\}/);
    expect(plain).not.toContain(EM_DASH);
  });

  it("counts every post and the one read in the edit bucket, the page with the pages", () => {
    const id = "a".repeat(32);
    for (const path of ["/account/dashboard/panels", "/account/dashboard/layout", `/account/dashboard/tiles/${id}/move`, `/account/dashboard/tiles/${id}/size`,
      `/account/dashboard/tiles/${id}/delete`, `/account/dashboard/tiles/${id}/board`, `/account/dashboard/panels/${id}/move`,
      `/account/dashboard/panels/${id}/width`, `/account/dashboard/panels/${id}/delete`, "/account/dashboard/boards", `/account/dashboard/boards/${id}/rename`,
      `/account/dashboard/boards/${id}/move`, `/account/dashboard/boards/${id}/delete`, "/account/dashboard/boards/first/rename", `/account/dashboard/tiles/${id}/text`]) {
      expect(bucketFor("POST", path), path).toBe("edit");
    }
    expect(bucketFor("GET", `/account/dashboard/tiles/${id}`)).toBe("edit");
    expect(bucketFor("GET", "/account/dashboard")).toBe("page");
    expect(bucketFor("GET", `/account/dashboard/${id}`)).toBe("page");
    expect(bucketFor("POST", `/account/dashboard/boards/${id}/spin`)).toBe("page");
    expect(bucketFor("POST", `/account/dashboard/tiles/${id}/spin`)).toBe("page");
  });

  it("takes every post through the session, the CSRF value and the Origin", async () => {
    const r = await reader("dash-posts");
    for (const path of ["/account/dashboard/panels", "/account/dashboard/layout", "/account/dashboard/tiles/s0/move"]) {
      const fields = { kind: "watches", ref: "", layout: "[]", dir: "down" };
      expect((await post(path, fields, { cookie: r.cookie, env: off() })).status, path).toBe(403);
      expect((await post(path, { csrf: r.csrf, ...fields }, { cookie: r.cookie, env: off(), origin: "https://evil.example" })).status, path).toBe(403);
      const out = await post(path, { csrf: r.csrf, ...fields }, { env: off() });
      expect(out.status, path).toBe(303);
      expect(out.headers.get("location"), path).toBe("/account/sign-in");
    }
    expect(await tileRows(r.id)).toEqual([]);
    // A ref the account does not hold, or a kind the site does not know: refused.
    for (const [kind, ref] of [["tenders", "0".repeat(32)], ["gauges", ""], ["radar", "24m"], ["view", "/buyers/pwgsc-tpsgc/analytics?source=awards"], ["org", "registry"]]) {
      expect((await send(r, "/account/dashboard/panels", { kind, ref })).status, `${kind} ${ref}`).toBe(400);
    }
    expect((await send(r, "/account/dashboard/tiles/nonsense/move", { dir: "down" })).status).toBe(400);
    // A Free account's post is sent to the page, which says what the dashboard holds; nothing is written.
    const free = await reader("dash-posts-free", "free");
    expect((await send(free, "/account/dashboard/panels", { kind: "watches", ref: "" }, sale())).headers.get("location")).toBe("/account/dashboard");
    expect((await save(free, [])).status).toBe(403);
    expect(await tileRows(free.id)).toEqual([]);
  });
});

describe("the rail's Dashboard item", () => {
  const ITEM = /<a class="rail-item" href="\/account\/dashboard"[^>]*><span class="rail-label">Dashboard<\/span><span class="ultra-tag"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">/;

  it("is first in Your lists, with the Ultra chip, while Ultra is on sale or the account holds it, and never with the switch off", async () => {
    const free = await reader("dash-rail-free", "free");
    const ultra = await reader("dash-rail-ultra");
    const rail = async (r: Reader | null, e: object) => {
      const html = await (await get("/tenders", { cookie: r?.cookie, env: e })).text();
      return html.slice(html.indexOf('<p class="rail-head" id="rail-lists">'), html.indexOf("</nav>"));
    };
    expect(await rail(null, off())).not.toMatch(ITEM);
    expect(await rail(free, off())).not.toMatch(ITEM);
    const held = await rail(ultra, off());
    expect(held).toMatch(ITEM);
    expect(held.indexOf("/account/dashboard")).toBeLessThan(held.indexOf('href="/watchlist"'));
    for (const r of [null, free, ultra]) expect(await rail(r, sale())).toMatch(ITEM);
    expect(await text(await open(ultra))).toMatch(/<a class="rail-item" href="\/account\/dashboard" aria-current="page">/);
    expect(await rail(ultra, { ...offEnv(), ...PRO_SALE })).not.toContain("/account/dashboard");
    expect(await rail(null, { ...ultraEnv(), ACCOUNTS_ENABLED: "false" })).not.toContain("/account/dashboard");
  });
});

describe("Add to dashboard", () => {
  it("is on each saved search a tile can show and each briefing, and on each panel of an analytics view, for an Ultra account alone", async () => {
    const ultra = await reader("dash-add-ultra");
    const pro = await reader("dash-add-pro", "pro");
    for (const r of [ultra, pro]) {
      await send(r, "/account/searches", { url: "/tenders?segment=82" });
      await send(r, "/account/briefings", { kind: "segment", subject: "81" });
    }
    const form = (kind: string) => new RegExp(`<form method="post" action="/account/dashboard/panels" class="account-inline dash-add"><input type="hidden" name="csrf" value="[0-9a-f]{32}"/><input type="hidden" name="kind" value="${kind}"/>`);
    const analytics = async (r: Reader) => text(await get(`/organizations/${A1}/analytics?source=awards&years=5`, { cookie: r.cookie, env: off() }));
    const a = await analytics(ultra);
    expect(a).toMatch(form("analytic"));
    expect(a).toContain(`<input type="hidden" name="ref" value="/organizations/${A1}/analytics?source=awards&years=5#table-years"/>`);
    expect(a).toContain('<button type="submit" class="btn-link">Add to dashboard</button>');
    expect(a).not.toMatch(form("view"));
    expect(await analytics(pro)).not.toContain("account-inline dash-add");
    const searches = await text(await get("/account/searches", { cookie: ultra.cookie, env: off() }));
    expect(searches).toMatch(form("tenders"));
    expect(searches).toMatch(form("briefing"));
    expect(await text(await get("/account/searches", { cookie: pro.cookie, env: off() }))).not.toContain("account-inline dash-add");
    // A view's own address, posted, is stored as the dashboard writes it, under the others, at its first table's size.
    const res = await send(ultra, "/account/dashboard/panels", { kind: "view", ref: `/organizations/${A1}/analytics?years=5&source=awards&lang=fr` });
    expect(res.headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    const rows = await tileRows(ultra.id);
    const added = rows.find((p) => p.ref === `/organizations/${A1}/analytics?source=awards&years=5`)!;
    expect(added).toMatchObject({ kind: "view", x: 0, w: 6, h: START_H["analytic:chart"] });
    expect(added.y).toBe(Math.max(...rows.filter((p) => p !== added).map((p) => p.y + p.h)));
    // Added again: the tile it has.
    expect((await send(ultra, "/account/dashboard/panels", { kind: "view", ref: `/organizations/${A1}/analytics?source=awards&years=5` })).headers.get("location"))
      .toBe(`/account/dashboard?m=exists#tile-${added.id}`);
  });
});

describe("both languages", () => {
  it("draw the page in French with no dash, and every string of the dashboard in both, without a dash", async () => {
    const r = await reader("dash-fr");
    await send(r, "/account/organization", { org: A1 });
    await send(r, "/account/dashboard/panels", { kind: "org", ref: "segments" });
    const html = await text(await open(r, "/account/dashboard?lang=fr"));
    const main = mainOf(html);
    expect(main).toContain(`<h1>${norm(t("fr", "dash.title"))}</h1>`);
    expect(main).toContain(norm(t("fr", "dash.kind_org", { block: t("fr", "orgclaim.panel_segments") })));
    expect(main).toContain(">Monter<");
    expect(main).toContain(">Plus large<");
    expect(main).toContain(norm(t("fr", "dash.add_tile")));
    expect(html).not.toContain(EM_DASH);
    expect(html).not.toContain(EN_DASH);
    expect(misfits(html)).toEqual([]);
    const keys = Object.keys(DASHBOARD_STRINGS) as Key[];
    expect(keys.every((k) => allKeys().includes(k))).toBe(true);
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      for (const s of [en, fr]) {
        expect(s, key).not.toContain(EM_DASH);
        expect(s, key).not.toContain(EN_DASH);
        expect(s, key).not.toContain("’");
      }
      expect(fr, key).not.toBe(en);
    }
  });
});

describe("a tile's ref", () => {
  it("names an analytics view only by its own path, source and period, stored in one form", () => {
    const ok = viewRef(`/buyers/pwgsc-tpsgc/analytics?years=10&source=contracts&segment=81&vs=${A2}&lang=fr`);
    expect(ok).toEqual({ view: "buyer", id: "pwgsc-tpsgc", source: "contracts", years: 10, from: null, to: null });
    expect(viewAddress(ok!)).toBe("/buyers/pwgsc-tpsgc/analytics?source=contracts&years=10");
    const span = viewRef("/segments/81/analytics?source=history&from=2019&to=2022")!;
    expect(viewAddress(span)).toBe("/segments/81/analytics?from=2019&source=history&to=2022");
    expect(viewSpan(span, DAY)).toEqual({ first: 2019, last: 2022, current: 2026 });
    expect(viewSpan(viewRef("/segments/81/analytics?source=awards&from=2001&to=2030")!, DAY)).toEqual({ first: 2007, last: 2026, current: 2026 });
    for (const bad of [
      "/buyers/pwgsc-tpsgc/analytics", "/buyers/pwgsc-tpsgc/analytics?source=lobbying&years=10", "/segments/99/analytics?source=awards&years=10",
      "/segments/81/analytics?source=contracts&years=10", "/organizations/org-zz/analytics?source=awards&years=10",
      "/buyers/pwgsc-tpsgc/analytics?source=awards&years=7", "/buyers/pwgsc-tpsgc/analytics?source=awards&years=10&evil=1",
      "/buyers/pwgsc-tpsgc/analytics?source=awards&source=grants&years=10", "/buyers/pwgsc-tpsgc/analytics?source=awards&from=2022",
      "/buyers/pwgsc-tpsgc/analytics?source=awards&from=2024&to=2020", "https://evil.example/buyers/pwgsc-tpsgc/analytics?source=awards&years=10",
      "//evil.example/buyers/x/analytics?source=awards&years=10", "/buyers/pwgsc-tpsgc?source=awards&years=10",
    ]) expect(viewRef(bad), bad).toBeNull();
    const h = { searches: [{ id: "a".repeat(32), kind: "tenders" }], briefings: [{ id: "b".repeat(32) }] } as never;
    expect(specOf("tenders", "a".repeat(32), h)).toEqual({ kind: "tenders", ref: "a".repeat(32), wide: true });
    expect(specOf("records", "a".repeat(32), h)).toBeNull();
    expect(specOf("briefing", "b".repeat(32), h)?.ref).toBe("b".repeat(32));
    expect(specOf("watches", "x", h)).toBeNull();
  });
});

describe("a tile that cannot be read", () => {
  it("says so, and the others render: the records batch is read tile by tile once it fails", async () => {
    const r = await reader("dash-unreadable");
    await send(r, "/account/organization", { org: A1 });
    await send(r, "/account/dashboard/panels", { kind: "org", ref: "instruments" });
    // The table the instruments block reads, gone (a nightly that has not made it yet).
    await RECORDS.prepare("DROP TABLE rec_holders").run();
    try {
      const html = await text(await open(r));
      const d = drawn(html);
      const instruments = d.find((x) => x.head.includes("Standing Offers and Supply Arrangements"))!;
      expect(instruments.html).toContain(t("en", "dash.unavailable"));
      const others = d.filter((x) => x !== instruments);
      expect(others.length).toBeGreaterThanOrEqual(4);
      for (const x of others) expect(x.html).not.toContain(t("en", "dash.unavailable"));
      expect(html).toContain("$300,000");
    } finally {
      await seedRecords();
    }
  });
});

describe("deleting the account", () => {
  it("removes its tiles, its dashboard and its panels", async () => {
    const r = await reader("dash-delete");
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" });
    await ACCOUNTS.prepare(ADD_PANEL_SQL).bind("e".repeat(32), r.id, "radar", "12m", 1, new Date().toISOString(), 12, 2).run();
    expect((await tileRows(r.id)).length).toBeGreaterThan(0);
    expect((await panelRows(r.id)).length).toBe(1);
    const res = await send(r, "/account/delete", { confirm: "yes" });
    expect(res.status).toBe(200);
    expect(await tileRows(r.id)).toEqual([]);
    expect(await boards(r.id)).toEqual([]);
    expect(await panelRows(r.id)).toEqual([]);
  });
});

// =====================================================================================
// Several dashboards (B1b): tabs, each at its own address; New, Rename, Order, Delete;
// tiles a dashboard's own; Move To; Add to dashboard's choice; the figures from RULES
// =====================================================================================

// The dashboards' tabs as the page draws them: each one's address, whether it is the one shown, its name.
function tabsIn(html: string): { href: string; current: boolean; label: string }[] {
  const nav = /<nav class="tabs dash-tabs" aria-label="[^"]*">([\s\S]*?)<\/nav>/.exec(mainOf(html))?.[1] ?? "";
  return [...nav.matchAll(/<a href="([^"]*)"( aria-current="page")? title="[^"]*">([^<]*)<\/a>/g)].map((m) => ({ href: m[1], current: !!m[2], label: m[3] }));
}
// A form of the page by its action, whole.
const formAt = (html: string, action: string, also = "") => {
  const at = html.indexOf(`<form method="post" action="${action}"${also}`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</form>", at) + 7);
};
type Ordered = { id: string; name: string; pos: number };
const ordered = (id: string) => ACCOUNTS.prepare("SELECT id, name, pos FROM dashboards WHERE user_id = ? ORDER BY pos, created_at, id")
  .bind(id).all<Ordered>().then((r) => r.results ?? []);
const boardTiles = (board: string) => ACCOUNTS.prepare("SELECT id, kind, ref, opts, x, y, w, h FROM dashboard_tiles WHERE dashboard_id = ? ORDER BY y, x, id")
  .bind(board).all<TileRow>().then((r) => r.results ?? []);
// New dashboard pressed: the post lands on the new one's own address; its id.
async function newBoard(r: Reader, e: object = off()): Promise<string> {
  const res = await send(r, "/account/dashboard/boards", {}, e);
  expect(res.status).toBe(303);
  const at = res.headers.get("location") ?? "";
  expect(at).toMatch(/^\/account\/dashboard\/[0-9a-f]{32}$/);
  return at.slice("/account/dashboard/".length);
}

describe("several dashboards", () => {
  it("are tabs over the grid, each at its own address; New dashboard writes the computed first and lands on the new one, empty", async () => {
    const r = await reader("boards-new");
    // Nothing stored: one tab, the computed first, current, with New dashboard beside it; the view writes nothing.
    const first = await text(await open(r));
    expect(tabsIn(first)).toEqual([{ href: "/account/dashboard", current: true, label: "Dashboard 1" }]);
    expect(formAt(mainOf(first), "/account/dashboard/boards")).toBe(
      `<form method="post" action="/account/dashboard/boards"><input type="hidden" name="csrf" value="${r.csrf}"/><button type="submit" class="btn-link">New dashboard</button></form>`,
    );
    expect(await boards(r.id)).toEqual([]);
    const id = await newBoard(r);
    const rows = await ordered(r.id);
    expect(rows.map((b) => [b.name, b.pos])).toEqual([["", 0], ["", 1]]);
    expect(rows[1].id).toBe(id);
    // The first was written as it showed (the starting layout's two tiles); the new one holds none.
    expect((await boardTiles(rows[0].id)).map((x) => `${x.kind}:${x.ref}`)).toEqual(["watches:", "radar:3m"]);
    expect(await boardTiles(id)).toEqual([]);
    // The new one at its own address: its tab current, empty, Add a Tile open, its posts and its saves naming it.
    const res = await open(r, `/account/dashboard/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const html = await text(res);
    expect(tabsIn(html)).toEqual([
      { href: "/account/dashboard", current: false, label: "Dashboard 1" }, { href: `/account/dashboard/${id}`, current: true, label: "Dashboard 2" },
    ]);
    const main = mainOf(html);
    expect(main).not.toContain("dash-tile");
    expect(main).toContain('<details class="dash-adder" id="dash-add" open="">');
    expect(main).toContain(`<input type="hidden" name="board" value="${id}"/>`);
    expect(main).toContain(t("en", "dash.empty"));
    expect(main.match(/btn-primary/g)).toHaveLength(1);
    const data = JSON.parse(/<script type="application\/json" id="dash-data">([\s\S]*?)<\/script>/.exec(main)![1]);
    expect(data.layout).toBe(`/account/dashboard/layout?board=${id}`);
    // A reload keeps it; the language switch is the page's own address with the other language, so it keeps it too.
    expect(tabsIn(await text(await open(r, `/account/dashboard/${id}`))).map((x) => x.current)).toEqual([false, true]);
    const fr = await text(await open(r, `/account/dashboard/${id}?lang=fr`));
    expect(tabsIn(fr).map((x) => [x.label, x.current])).toEqual([["Tableau de bord 1", false], ["Tableau de bord 2", true]]);
    expect(fr).toContain('<a href="?lang=en" class="lang-toggle"');
    expect(fr).not.toContain(EM_DASH);
    expect(fr).not.toContain(EN_DASH);
    // The bare address shows the first, as does the first's own id.
    const bare = await text(await open(r));
    expect(tabsIn(bare).map((x) => x.current)).toEqual([true, false]);
    expect(drawn(bare)).toHaveLength(2);
    expect(tabsIn(await text(await open(r, `/account/dashboard/${rows[0].id}`))).map((x) => x.current)).toEqual([true, false]);
    // A dashboard the account does not hold goes to the first, in the page's language; anything else there is the site's 404.
    const other = await reader("boards-new-other");
    expect((await open(other, `/account/dashboard/${id}`)).headers.get("location")).toBe("/account/dashboard");
    expect((await open(other, `/account/dashboard/${id}?lang=fr`)).headers.get("location")).toBe("/account/dashboard?lang=fr");
    expect((await open(r, `/account/dashboard/${"0".repeat(32)}`)).headers.get("location")).toBe("/account/dashboard");
    for (const bad of ["abc", "nonsense", `${id}0`]) expect((await open(r, `/account/dashboard/${bad}`)).status, bad).toBe(404);
    // Signed out while Ultra is on sale: the sign-in page, back to this dashboard; off sale, a Free reader's 404.
    expect((await open(null, `/account/dashboard/${id}`, sale())).headers.get("location")).toBe(`/account/sign-in?next=${encodeURIComponent(`/account/dashboard/${id}`)}`);
    const free = await reader("boards-new-free", "free");
    expect((await open(free, `/account/dashboard/${id}`)).status).toBe(404);
  });

  it("holds the plan's figure of dashboards inside the insert, and offers New dashboard only below it", async () => {
    const r = await reader("boards-cap");
    for (let i = 1; i < RULES.ultra.dashboards; i++) await newBoard(r);
    expect(await boards(r.id)).toHaveLength(DASHBOARDS_MAX);
    const html = await text(await open(r));
    expect(tabsIn(html).map((x) => x.label)).toEqual(["Dashboard 1", "Dashboard 2", "Dashboard 3", "Dashboard 4", "Dashboard 5"]);
    expect(formAt(mainOf(html), "/account/dashboard/boards")).toBe("");
    const sixth = await send(r, "/account/dashboard/boards");
    expect(sixth.headers.get("location")).toBe("/account/dashboard?m=boards_full");
    expect(await boards(r.id)).toHaveLength(DASHBOARDS_MAX);
    expect(await text(await open(r, "/account/dashboard?m=boards_full"))).toContain(t("en", "dash.boards_full", { boards: "5" }));
    // The statement alone holds it, so two posts at once cannot pass it.
    expect((await ACCOUNTS.prepare(NEW_BOARD_SQL).bind("f".repeat(32), r.id, new Date().toISOString(), DASHBOARDS_MAX).run()).meta.changes).toBe(0);
    expect((await ACCOUNTS.prepare(NEW_BOARD_SQL).bind("f".repeat(32), r.id, new Date().toISOString(), DASHBOARDS_MAX + 1).run()).meta.changes).toBe(1);
  });

  it("renames a dashboard as typed: plain text, control characters dropped, 40 characters at most, the site's label when left empty", async () => {
    const r = await reader("boards-name");
    const id = await newBoard(r);
    const rename = (board: string, name: string) => send(r, `/account/dashboard/boards/${board}/rename`, { name });
    // The form: the name typed so far, the site's label as its placeholder, the note under it.
    const form = formAt(mainOf(await text(await open(r, `/account/dashboard/${id}`))), `/account/dashboard/boards/${id}/rename`);
    expect(form).toContain('<input type="text" name="name" value="" maxlength="40" placeholder="Dashboard 2" autocomplete="off"/>');
    expect(form).toContain("40 characters at most. Left empty, it is named Dashboard 2.");
    const res = await rename(id, "  Suppliers\u0007 <b>&</b>\u0000 ");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/account/dashboard/${id}?m=renamed`);
    expect((await ordered(r.id))[1].name).toBe("Suppliers <b>&</b>");
    // Shown as text, never as markup.
    const raw = await (await open(r, `/account/dashboard/${id}`)).text();
    expect(raw).toContain(`aria-current="page" title="Suppliers &lt;b&gt;&amp;&lt;/b&gt;">Suppliers &lt;b&gt;&amp;&lt;/b&gt;</a>`);
    expect(raw).not.toContain("<b>&</b>");
    await rename(id, "x".repeat(60));
    expect((await ordered(r.id))[1].name).toBe("x".repeat(40));
    await rename(id, "   ");
    expect((await ordered(r.id))[1].name).toBe("");
    expect(tabsIn(await text(await open(r, `/account/dashboard/${id}?lang=fr`))).map((x) => x.label)).toEqual(["Tableau de bord 1", "Tableau de bord 2"]);
    // The computed first, named: written first, as it showed, with the name.
    const fresh = await reader("boards-name-first");
    expect((await send(fresh, "/account/dashboard/boards/first/rename", { name: "Ma vue" })).headers.get("location")).toBe("/account/dashboard?m=renamed");
    const [only] = await ordered(fresh.id);
    expect(only.name).toBe("Ma vue");
    expect((await boardTiles(only.id)).length).toBe(2);
    expect(await text(await open(fresh, "/account/dashboard?m=renamed"))).toContain(t("en", "dash.board_renamed"));
    // Another account's dashboard: nothing changes.
    await send(fresh, `/account/dashboard/boards/${id}/rename`, { name: "Theirs" });
    expect((await ordered(r.id))[1].name).toBe("");
  });

  it("moves a dashboard earlier or later, the order written whole, its label kept and the first's address the bare one", async () => {
    const r = await reader("boards-order");
    const b2 = await newBoard(r);
    const b3 = await newBoard(r);
    const b1 = (await ordered(r.id))[0].id;
    expect((await send(r, `/account/dashboard/boards/${b3}/move`, { dir: "earlier" })).headers.get("location")).toBe(`/account/dashboard/${b3}`);
    expect((await ordered(r.id)).map((x) => [x.id, x.pos])).toEqual([[b1, 0], [b3, 1], [b2, 2]]);
    expect((await send(r, `/account/dashboard/boards/${b3}/move`, { dir: "earlier" })).headers.get("location")).toBe("/account/dashboard");
    const html = await text(await open(r));
    // Each keeps the label it was made with (they are numbered in the order the account made them).
    expect(tabsIn(html)).toEqual([
      { href: "/account/dashboard", current: true, label: "Dashboard 3" }, { href: `/account/dashboard/${b1}`, current: false, label: "Dashboard 1" },
      { href: `/account/dashboard/${b2}`, current: false, label: "Dashboard 2" },
    ]);
    // The first cannot go earlier: offered disabled, and its post changes nothing; the last cannot go later.
    const main = mainOf(html);
    expect(main).toContain(`<form method="post" action="/account/dashboard/boards/${b3}/move"><input type="hidden" name="csrf" value="${r.csrf}"/>` +
      '<input type="hidden" name="dir" value="earlier"/><button type="submit" class="btn" disabled="">Move earlier</button></form>');
    expect(main).toContain('<input type="hidden" name="dir" value="later"/><button type="submit" class="btn">Move later</button>');
    await send(r, `/account/dashboard/boards/${b3}/move`, { dir: "earlier" });
    expect((await ordered(r.id)).map((x) => x.id)).toEqual([b3, b1, b2]);
    expect(mainOf(await text(await open(r, `/account/dashboard/${b2}`)))).toContain('<input type="hidden" name="dir" value="later"/><button type="submit" class="btn" disabled="">Move later</button>');
    expect((await send(r, `/account/dashboard/boards/${b2}/move`, { dir: "later" })).headers.get("location")).toBe(`/account/dashboard/${b2}`);
    expect((await ordered(r.id)).map((x) => x.id)).toEqual([b3, b1, b2]);
    expect((await send(r, `/account/dashboard/boards/${b1}/move`, { dir: "later" })).headers.get("location")).toBe(`/account/dashboard/${b1}`);
    expect((await ordered(r.id)).map((x) => [x.id, x.pos])).toEqual([[b3, 0], [b2, 1], [b1, 2]]);
    // A direction the post does not name, and an operation the address does not know: refused, or the site's 404.
    expect((await send(r, `/account/dashboard/boards/${b2}/move`, { dir: "sideways" })).status).toBe(400);
    expect((await send(r, `/account/dashboard/boards/${b2}/spin`)).status).toBe(404);
  });

  it("deletes a dashboard and its tiles on the question inside the page, never a dialog, and empties the last one", async () => {
    const r = await reader("boards-delete");
    const b2 = await newBoard(r);
    const b1 = (await ordered(r.id))[0].id;
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m", board: b2 });
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "12m", board: b2 });
    // The question is a details element inside Rename, Order or Delete, its button the answer; the page has no dialog.
    const raw = await (await open(r, `/account/dashboard/${b2}`)).text();
    expect(norm(decode(raw))).toContain(`<details class="dash-board-delete"><summary class="btn-link">Delete this dashboard</summary>` +
      `<form method="post" action="/account/dashboard/boards/${b2}/delete" class="stack"><input type="hidden" name="csrf" value="${r.csrf}"/>` +
      `<p>Delete the dashboard Dashboard 2 and its 2 tiles?</p><button type="submit" name="confirm" value="yes" class="btn">Delete</button></form></details>`);
    expect(raw).not.toMatch(/confirm\(|onclick|onsubmit/);
    // Without the answer, nothing.
    expect((await send(r, `/account/dashboard/boards/${b2}/delete`)).status).toBe(400);
    expect(await boards(r.id)).toHaveLength(2);
    const res = await send(r, `/account/dashboard/boards/${b2}/delete`, { confirm: "yes" });
    expect(res.headers.get("location")).toBe("/account/dashboard?m=board_deleted");
    expect((await ordered(r.id)).map((x) => x.id)).toEqual([b1]);
    expect(await boardTiles(b2)).toEqual([]);
    expect((await boardTiles(b1)).map((x) => x.ref)).toEqual(["", "3m"]);
    expect(await text(await open(r, "/account/dashboard?m=board_deleted"))).toContain(t("en", "dash.board_deleted"));
    expect((await open(r, `/account/dashboard/${b2}`)).headers.get("location")).toBe("/account/dashboard");
    // The last one: its tiles go, and it stays, emptied, with the site's label, as removing its last tile leaves it.
    await send(r, `/account/dashboard/boards/${b1}/rename`, { name: "Main" });
    const one = mainOf(await text(await open(r)));
    expect(one).toContain("<p>Delete the dashboard Main and its 2 tiles?</p>");
    expect(one).toContain(t("en", "dash.board_delete_last"));
    expect((await send(r, `/account/dashboard/boards/${b1}/delete`, { confirm: "yes" })).headers.get("location")).toBe("/account/dashboard?m=board_emptied");
    expect(await ordered(r.id)).toEqual([{ id: b1, name: "", pos: 0 }]);
    expect(await boardTiles(b1)).toEqual([]);
    const emptied = mainOf(await text(await open(r, "/account/dashboard?m=board_emptied")));
    expect(emptied).toContain(t("en", "dash.board_emptied"));
    expect(emptied).not.toContain("dash-tile");
    expect(emptied).not.toContain(t("en", "dash.starter"));
    expect(emptied).toContain('<details class="dash-adder" id="dash-add" open="">');
    // The computed first, deleted: written with no tile, so the account keeps an emptied first dashboard.
    const fresh = await reader("boards-delete-first");
    expect(mainOf(await text(await open(fresh)))).toContain("<p>Delete the dashboard Dashboard 1 and its 2 tiles?</p>");
    expect((await send(fresh, "/account/dashboard/boards/first/delete", { confirm: "yes" })).headers.get("location")).toBe("/account/dashboard?m=board_emptied");
    expect(await ordered(fresh.id)).toHaveLength(1);
    expect(await tileRows(fresh.id)).toEqual([]);
    expect(mainOf(await text(await open(fresh)))).not.toContain(t("en", "dash.starter"));
  });

  it("keeps each dashboard's tiles its own: the same item once on each, the figure and the briefings' cap a dashboard's", async () => {
    const r = await reader("boards-tiles");
    const b2 = await newBoard(r);
    const b1 = (await ordered(r.id))[0].id;
    expect((await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" })).headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    const two = await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m", board: b2 });
    expect(two.headers.get("location")).toMatch(new RegExp(`^/account/dashboard/${b2}\\?m=added#tile-[0-9a-f]{32}$`));
    const again = await send(r, "/account/dashboard/panels", { panel: "radar:6m", board: b2 });
    expect(again.headers.get("location")).toMatch(new RegExp(`^/account/dashboard/${b2}\\?m=exists#tile-[0-9a-f]{32}$`));
    expect((await boardTiles(b1)).filter((x) => x.ref === "6m")).toHaveLength(1);
    expect((await boardTiles(b2)).filter((x) => x.ref === "6m")).toHaveLength(1);
    // Add a Tile on the second offers what the second does not show, the first's own tiles included.
    const second = mainOf(await text(await open(r, `/account/dashboard/${b2}`)));
    expect(second).not.toContain('value="radar:6m"');
    expect(second).toContain('value="radar:3m"');
    // The figure is a dashboard's: the second full at 24, the first still takes one.
    await fill(r, b2, TILES_MAX - 1);
    const full = await send(r, "/account/dashboard/panels", { kind: "radar", ref: "12m", board: b2 });
    expect(full.headers.get("location")).toBe(`/account/dashboard/${b2}?m=full`);
    expect((await boardTiles(b2)).length).toBe(TILES_MAX);
    expect(await text(await open(r, `/account/dashboard/${b2}?m=full`))).toContain(t("en", "dash.full", { cap: "24" }));
    expect((await send(r, "/account/dashboard/panels", { kind: "radar", ref: "12m" })).headers.get("location")).toMatch(/\?m=added#/);
    // The briefings' cap is a dashboard's too: two on the first, two on a third, the third briefing on neither.
    for (const s of ["81", "43", "72"]) await send(r, "/account/briefings", { kind: "segment", subject: s });
    const ids = ((await ACCOUNTS.prepare("SELECT id FROM briefings WHERE user_id = ? ORDER BY created_at, id").bind(r.id).all<{ id: string }>()).results ?? [])
      .map((x) => x.id);
    const b3 = await newBoard(r);
    for (const board of ["", b3]) {
      for (const id of ids.slice(0, BRIEFING_PANELS_MAX)) {
        expect((await send(r, "/account/dashboard/panels", { kind: "briefing", ref: id, board })).headers.get("location"), board).toMatch(/\?m=added#/);
      }
      expect((await send(r, "/account/dashboard/panels", { kind: "briefing", ref: ids[2], board })).headers.get("location"), board).toMatch(/\?m=briefings_full$/);
    }
  });

  it("moves a tile to another dashboard from its menu: it keeps its size, lands at that dashboard's foot, and the one it left closes up", async () => {
    const r = await reader("boards-move");
    const b2 = await newBoard(r);
    const b1 = (await ordered(r.id))[0].id;
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m", board: b2 });
    await send(r, `/account/dashboard/boards/${b2}/rename`, { name: "Second" });
    // Each tile's menu offers the other dashboards by name, each a post; one with no other dashboard offers none.
    const page = await text(await open(r));
    const watches = drawn(page).find((d) => d.head === "Your watches this week")!;
    expect(watches.html).toContain(`<p class="dash-menu-head">Move to</p><form method="post" action="/account/dashboard/tiles/${watches.id}/board">` +
      `<input type="hidden" name="csrf" value="${r.csrf}"/><input type="hidden" name="board" value="${b2}"/>` +
      `<button type="submit" class="dash-menu-item" aria-label="Move to Second">Second</button></form>`);
    expect(watches.html).toMatch(/Second<\/button><\/form><form method="post" action="\/account\/dashboard\/tiles\/[0-9a-f]{32}\/delete">/);
    const solo = await reader("boards-move-solo");
    expect(await text(await open(solo))).not.toContain("dash-menu-head");
    // Moved: on the second, at its foot at the left, its size kept; the first closes up; the reader stays, told where it went.
    const before = (await boardTiles(b1)).find((x) => x.kind === "watches")!;
    const three = (await boardTiles(b1)).find((x) => x.ref === "3m")!;
    const res = await send(r, `/account/dashboard/tiles/${watches.id}/board`, { board: b2 });
    expect(res.headers.get("location")).toBe(`/account/dashboard?m=moved&to=${b2}#tile-${three.id}`);
    const there = await boardTiles(b2);
    const six = there.find((x) => x.ref === "6m")!;
    expect(there.find((x) => x.id === watches.id)).toMatchObject({ kind: "watches", x: 0, y: six.y + six.h, w: before.w, h: before.h });
    expect((await boardTiles(b1)).map((x) => [x.ref, x.y])).toEqual([["3m", 0]]);
    expect(await text(await open(r, `/account/dashboard?m=moved&to=${b2}`))).toContain("The tile was moved to Second.");
    expect(drawn(await text(await open(r, `/account/dashboard/${b2}`))).map((d) => d.id)).toContain(watches.id);
    // To a dashboard that shows the same item already: nothing moves, and the page says why.
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" });
    const six1 = (await boardTiles(b1)).find((x) => x.ref === "6m")!;
    expect((await send(r, `/account/dashboard/tiles/${six1.id}/board`, { board: b2 })).headers.get("location"))
      .toBe(`/account/dashboard?m=move_exists&to=${b2}#tile-${six1.id}`);
    expect(await text(await open(r, `/account/dashboard?m=move_exists&to=${b2}`))).toContain("The dashboard Second shows this already.");
    // To a full one: nothing moves; the menu offers it disabled.
    await fill(r, b2, TILES_MAX - (await boardTiles(b2)).length);
    expect((await send(r, `/account/dashboard/tiles/${three.id}/board`, { board: b2 })).headers.get("location"))
      .toBe(`/account/dashboard?m=move_full&to=${b2}#tile-${three.id}`);
    expect(drawn(await text(await open(r))).find((d) => d.id === three.id)!.html).toContain('aria-label="Move to Second" disabled="">Second</button>');
    // The statement alone holds the figure.
    expect((await ACCOUNTS.prepare(MOVE_TO_SQL).bind(b2, 0, 999, 6, 9, three.id, r.id, TILES_MAX, BRIEFING_PANELS_MAX).run()).meta.changes).toBe(0);
    // To another account's dashboard, to its own, or to no id: nothing moves.
    const other = await reader("boards-move-other");
    const theirs = await newBoard(other);
    expect((await send(r, `/account/dashboard/tiles/${three.id}/board`, { board: theirs })).status).toBe(303);
    expect((await send(r, `/account/dashboard/tiles/${three.id}/board`, { board: b1 })).status).toBe(303);
    expect((await send(r, `/account/dashboard/tiles/${three.id}/board`, { board: "nope" })).status).toBe(400);
    expect((await boardTiles(b1)).map((x) => x.id)).toContain(three.id);
    expect(await boardTiles(theirs)).toEqual([]);
    // Another account's tile: nothing moves.
    await send(other, `/account/dashboard/tiles/${three.id}/board`, { board: theirs });
    expect((await boardTiles(b1)).map((x) => x.id)).toContain(three.id);
  });

  it("adds from the other pages to the first dashboard, or with several to the one chosen, and adds no filled button there", async () => {
    const r = await reader("boards-add");
    await send(r, "/account/searches", { url: "/tenders?segment=82" });
    await send(r, "/account/briefings", { kind: "segment", subject: "81" });
    await ACCOUNTS.prepare(
      "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, 'Fleet', 'en', 'off', ?)",
    ).bind("c".repeat(32), r.id, "/buyers/pwgsc-tpsgc/analytics?source=awards&years=5", new Date().toISOString()).run();
    const search = await searchId(r, "/tenders?segment=82");
    const pages = async () => Promise.all(["/account/searches", "/account/views", `/organizations/${A1}/analytics?source=awards&years=5`]
      .map(async (path) => text(await get(path, { cookie: r.cookie, env: off() }))));
    const filled = (html: string) => (mainOf(html).match(/btn-primary/g) ?? []).length;
    // One dashboard: the one button, no choice, and the post goes to the first.
    const one = await pages();
    for (const html of one) {
      expect(html).toContain('class="account-inline dash-add"');
      expect(html).not.toContain("dash-add-menu");
    }
    const b2 = await newBoard(r);
    const b1 = (await ordered(r.id))[0].id;
    await send(r, `/account/dashboard/boards/${b2}/rename`, { name: "Bids" });
    // Several: Add to dashboard opens on their names, each a button of one form naming its dashboard.
    const several = await pages();
    expect(several[0]).toContain(`<details class="dash-add dash-add-menu"><summary class="btn-link">Add to dashboard</summary>` +
      `<form method="post" action="/account/dashboard/panels" class="dash-add-list"><input type="hidden" name="csrf" value="${r.csrf}"/>` +
      `<input type="hidden" name="kind" value="tenders"/><input type="hidden" name="ref" value="${search}"/>` +
      `<button type="submit" name="board" value="${b1}" class="dash-menu-item">Dashboard 1</button>` +
      `<button type="submit" name="board" value="${b2}" class="dash-menu-item">Bids</button></form></details>`);
    expect(several[0]).toMatch(/<details class="dash-add dash-add-menu"><summary class="btn-link">Add to dashboard<\/summary><form [^>]*><input [^>]*\/><input type="hidden" name="kind" value="briefing"\/>/);
    expect(several[1]).toMatch(/<details class="dash-add dash-add-menu"><summary class="btn-link">Add to dashboard<\/summary><form [^>]*><input [^>]*\/><input type="hidden" name="kind" value="view"\/><input type="hidden" name="ref" value="c{32}"\/>/);
    // On the analytics page, in each panel's tools, link style, the dashboards' names under it.
    expect(several[2]).toContain('<div class="panel-tools"><a href="/organizations/org-a000000001/analytics/years.csv?source=awards&years=5&segment=81" rel="nofollow">CSV file</a>' +
      '<details class="dash-add dash-add-menu"><summary class="btn-link">Add to dashboard</summary>');
    expect(several[2]).toContain(`<input type="hidden" name="kind" value="analytic"/><input type="hidden" name="ref" value="/organizations/${A1}/analytics?source=awards&years=5#table-records"/>` +
      `<button type="submit" name="board" value="${b1}" class="dash-menu-item">Dashboard 1</button>`);
    several.forEach((html, i) => expect(filled(html), String(i)).toBe(filled(one[i])));
    const fr = await text(await get("/account/searches?lang=fr", { cookie: r.cookie, env: off() }));
    expect(fr).toContain(`<button type="submit" name="board" value="${b1}" class="dash-menu-item">Tableau de bord 1</button>`);
    // The one chosen: the second.
    const res = await send(r, "/account/dashboard/panels", { kind: "tenders", ref: search, board: b2 });
    expect(res.headers.get("location")).toMatch(new RegExp(`^/account/dashboard/${b2}\\?m=added#tile-[0-9a-f]{32}$`));
    expect((await boardTiles(b2)).map((x) => `${x.kind}:${x.ref}`)).toEqual([`tenders:${search}`]);
    // Another account's dashboard: the first, nothing added; no id: refused.
    const other = await reader("boards-add-other");
    const theirs = await newBoard(other);
    expect((await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m", board: theirs })).headers.get("location")).toBe("/account/dashboard");
    expect(await boardTiles(theirs)).toEqual([]);
    expect((await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m", board: "x" })).status).toBe(400);
  });

  it("saves a dashboard's layout at the address its page gives the script, that dashboard's tiles alone, and reads a tile from either", async () => {
    const r = await reader("boards-layout");
    const b2 = await newBoard(r);
    const b1 = (await ordered(r.id))[0].id;
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m", board: b2 });
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "12m", board: b2 });
    const twelve = (await boardTiles(b2)).find((x) => x.ref === "12m")!;
    const six = (await boardTiles(b2)).find((x) => x.ref === "6m")!;
    const firsts = await boardTiles(b1);
    const at = (board: string) => `/account/dashboard/layout?board=${board}`;
    // The 12-month list to the top, the whole row wide, the 6-month list under it; and a tile of the first dashboard.
    const layout = JSON.stringify([
      { id: twelve.id, x: 0, y: 0, w: 12, h: 9 }, { id: six.id, x: 0, y: 9, w: 6, h: six.h }, { id: firsts[0].id, x: 6, y: 0, w: 6, h: 9 },
    ]);
    const res = await post(at(b2), { csrf: r.csrf, layout }, { cookie: r.cookie, env: off() });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "saved" });
    expect((await boardTiles(b2)).find((x) => x.id === twelve.id)).toMatchObject({ x: 0, y: 0, w: 12 });
    // The first dashboard's tile named in the second's save is left as it was.
    expect(await boardTiles(b1)).toEqual(firsts);
    // A dashboard the account does not hold, or a board that is no id: refused.
    expect((await post(at("0".repeat(32)), { csrf: r.csrf, layout }, { cookie: r.cookie, env: off() })).status).toBe(404);
    expect((await post(at("nonsense"), { csrf: r.csrf, layout }, { cookie: r.cookie, env: off() })).status).toBe(400);
    // One tile read at a size, from the second: its menu offers the first.
    const tile = await readTile(r, twelve.id, "?w=6&h=12");
    expect(tile.status).toBe(200);
    const html = await tile.text();
    expect(html).toContain('data-w="6" data-h="12"');
    expect(html).toContain(`<input type="hidden" name="board" value="${b1}"/>`);
  });

  it("go with the account, every dashboard and tile; a search or a briefing removed takes its tile from every dashboard", async () => {
    const r = await reader("boards-gone");
    await send(r, "/account/searches", { url: "/tenders?segment=82" });
    await send(r, "/account/briefings", { kind: "segment", subject: "81" });
    const search = await searchId(r, "/tenders?segment=82");
    const briefing = (await ACCOUNTS.prepare("SELECT id FROM briefings WHERE user_id = ?").bind(r.id).first<{ id: string }>())!.id;
    const b2 = await newBoard(r);
    for (const board of ["", b2]) {
      await send(r, "/account/dashboard/panels", { kind: "tenders", ref: search, board });
      await send(r, "/account/dashboard/panels", { kind: "briefing", ref: briefing, board });
    }
    const held = async (ref: string) => (await tileRows(r.id)).filter((x) => x.ref === ref).length;
    expect([await held(search), await held(briefing)]).toEqual([2, 2]);
    await send(r, `/account/searches/${search}/delete`);
    await send(r, `/account/briefings/${briefing}/delete`);
    expect([await held(search), await held(briefing)]).toEqual([0, 0]);
    expect(await boards(r.id)).toHaveLength(2);
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m", board: b2 });
    expect((await send(r, "/account/delete", { confirm: "yes" })).status).toBe(200);
    expect(await boards(r.id)).toEqual([]);
    expect(await tileRows(r.id)).toEqual([]);
  });

  it("offers no tab while the grid's tables are absent, where a dashboard's posts answer that nothing can be kept, and nothing answers 500", async () => {
    const r = await reader("boards-absent");
    const posts: [string, Record<string, string>][] = [
      ["/account/dashboard/boards", {}], ["/account/dashboard/boards/first/rename", { name: "x" }], ["/account/dashboard/boards/first/delete", { confirm: "yes" }],
      ["/account/dashboard/boards/first/move", { dir: "later" }], [`/account/dashboard/tiles/${"a".repeat(32)}/board`, { board: "b".repeat(32) }],
    ];
    for (const [which, line] of [["tiles", "unsaved_layout"], ["all", "unsaved"]] as const) {
      await without(which, async () => {
        const page = await open(r);
        expect(page.status, which).toBe(200);
        expect(mainOf(await text(page)), which).not.toContain("dash-boards");
        expect((await open(r, `/account/dashboard/${"a".repeat(32)}`)).headers.get("location"), which).toBe("/account/dashboard");
        for (const [path, fields] of posts) {
          const res = await send(r, path, fields);
          expect(res.status, `${which} ${path}`).toBe(303);
          expect(res.headers.get("location"), `${which} ${path}`).toBe(`/account/dashboard?m=${line}`);
        }
        const saved = await post(`/account/dashboard/layout?board=${"a".repeat(32)}`, { csrf: r.csrf, layout: "[]" }, { cookie: r.cookie, env: off() });
        expect(await saved.json(), which).toEqual({ state: "unsaved" });
      });
    }
  });
});

describe("a dashboard of 24 tiles", () => {
  // The records binding watched: each statement's text and binds, in the order prepared, and each batch's size.
  function watchRecords(): { db: D1Database; prepared: { sql: string; params: unknown[] }[]; batches: number[] } {
    const prepared: { sql: string; params: unknown[] }[] = [];
    const batches: number[] = [];
    const db = new Proxy(RECORDS, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            const s = target.prepare(sql);
            const seen = { sql, params: [] as unknown[] };
            prepared.push(seen);
            const bind = s.bind.bind(s);
            (s as unknown as { bind: (...p: unknown[]) => D1PreparedStatement }).bind = (...p: unknown[]) => ((seen.params = p), bind(...p));
            return s;
          };
        }
        if (prop === "batch") return (list: D1PreparedStatement[]) => (batches.push(list.length), target.batch(list));
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    return { db, prepared, batches };
  }

  it("reads every tile's records in one batch of indexed statements, and a tile that cannot be read leaves the other 23", async () => {
    const r = await reader("boards-24");
    await send(r, "/account/organization", { org: A1 });
    for (const url of ["/tenders?segment=82", "/tenders?segment=72", "/tenders?segment=43", "/expiring/12m?buyer=pwgsc-tpsgc", `/organizations/${A1}`,
      "/buyers/pwgsc-tpsgc", "/segments/81"]) await send(r, "/account/searches", { url });
    for (const s of ["81", "43"]) await send(r, "/account/briefings", { kind: "segment", subject: s });
    await send(r, "/account/keys", { name: "Reports" });
    const id = (url: string) => searchId(r, url);
    const briefings = ((await ACCOUNTS.prepare("SELECT id FROM briefings WHERE user_id = ? ORDER BY created_at, id").bind(r.id).all<{ id: string }>()).results ?? [])
      .map((x) => x.id);
    // The first add writes the starting layout (the watches, the 3-month list, matching notices, the years block, two
    // tender searches, the API: 7); seventeen more fill the figure.
    const more: [string, string][] = [
      ["radar", "6m"], ["radar", "12m"], ["radar", await id("/expiring/12m?buyer=pwgsc-tpsgc")], ["tenders", await id("/tenders?segment=43")],
      ["records", await id(`/organizations/${A1}`)], ["records", await id("/buyers/pwgsc-tpsgc")], ["records", await id("/segments/81")],
      ["org", "segments"], ["org", "share"], ["org", "ending"], ["org", "buyers"], ["org", "instruments"],
      ["view", "/buyers/pwgsc-tpsgc/analytics?source=awards&years=10"], ["view", `/organizations/${A1}/analytics?source=awards&years=10`],
      ["view", "/segments/81/analytics?source=awards&years=10"], ["briefing", briefings[0]], ["briefing", briefings[1]],
    ];
    for (const [kind, ref] of more) expect((await send(r, "/account/dashboard/panels", { kind, ref })).headers.get("location"), `${kind} ${ref}`).toMatch(/\?m=added#/);
    expect(await tileRows(r.id)).toHaveLength(TILES_MAX);
    const watch = watchRecords();
    const html = await text(await open(r, "/account/dashboard", off({ RECORDS: watch.db })));
    const d = drawn(html);
    expect(d).toHaveLength(TILES_MAX);
    for (const x of d) expect(x.html, x.head).not.toContain(t("en", "dash.unavailable"));
    expect(mainOf(html)).toContain('<p class="muted small">24 of 24 tiles</p>');
    // One batch holds the state row and every tile's statements: 25 (two each for the four lists of contracts ending,
    // the share and ending blocks and the buyer's and organization's views; one each for the three records searches,
    // the segment's view and the other four blocks). The watches and the two briefings send their own, smaller.
    const start = watch.prepared.findIndex((s) => /FROM rec_meta/.test(s.sql));
    const main = watch.prepared.slice(start, start + 25);
    expect(Math.max(...watch.batches), watch.batches.join(" ")).toBe(25);
    expect(watch.batches.filter((n) => n === 25)).toHaveLength(1);
    // Each statement bounded and indexed: its plan reads no table whole (a SCAN of a table, or of its alias, without
    // an index), whatever it then does with what it read. A scan of a subquery's own rows (MATERIALIZE or CO-ROUTINE,
    // each held by its LIMIT) reads no table.
    for (const s of main.slice(1)) {
      const plan = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${s.sql}`).bind(...s.params).all()).results ?? []).map((x) => String((x as { detail?: unknown }).detail));
      const made = new Set(plan.flatMap((p) => /^(?:MATERIALIZE|CO-ROUTINE) (\S+)/.exec(p)?.[1] ?? []));
      const whole = plan.filter((p) => /^SCAN /.test(p) && !/USING|CONSTANT ROW/i.test(p) && !made.has(/^SCAN (\S+)/.exec(p)![1]));
      expect(whole, `${s.sql}\n${plan.join("\n")}`).toEqual([]);
    }
    // The table one block reads, gone: that tile says so, the other 23 draw.
    await RECORDS.prepare("DROP TABLE rec_holders").run();
    try {
      const gone = drawn(await text(await open(r)));
      const instruments = gone.find((x) => x.head.includes("Standing Offers and Supply Arrangements"))!;
      expect(instruments.html).toContain(t("en", "dash.unavailable"));
      expect(gone.filter((x) => x !== instruments && x.html.includes(t("en", "dash.unavailable")))).toEqual([]);
    } finally {
      await seedRecords();
    }
  });
});

// =====================================================================================
// Analytics tables (B3a): one table of a view on a tile, drawn in full at its size
// =====================================================================================

// A table's ref as its panel posts it, and its tile as the page draws it.
const SSC_VIEW = "/buyers/ssc-spc/analytics?source=history&years=20";
const CASCADE_VIEW = `/organizations/${C(1)}/analytics?source=history&years=20`;
const SEG_VIEW = "/segments/81/analytics?source=history&years=20";
const tableRef = (view: string, table: string) => `${view}#table-${table}`;
const addTable = (r: Reader, ref: string, e: object = off(), board = "") => send(r, "/account/dashboard/panels", { kind: "analytic", ref, ...(board ? { board } : {}) }, e);
const tileOfRef = async (r: Reader, ref: string) => (await tileRows(r.id)).find((x) => x.kind === "analytic" && x.ref === ref)!;
// A tile's foot: its count line and its Open.
const countIn = (html: string) => /<span class="dash-count">([^<]*)<\/span>/.exec(html)?.[1] ?? null;
const openIn = (html: string) => /<div class="dash-foot">[\s\S]*?<a href="([^"]*)">(?:Open|Ouvrir)<\/a>/.exec(html)?.[1] ?? null;

describe("an analytics table on a tile", () => {
  // Each view's tables as tiles: name, ref, the head, the rows its read gives, the subject's name.
  const CASES: { name: string; ref: string; head: string; item: string; total: number }[] = [
    { name: "buyer/quarters", ref: tableRef(SSC_VIEW, "quarters"), head: "Value by Fiscal Quarter", item: "Shared Services Canada", total: 20 },
    { name: "buyer/records", ref: tableRef(SSC_VIEW, "records"), head: "Ten Largest Records", item: "Shared Services Canada", total: 10 },
    { name: "buyer/suppliers", ref: tableRef(SSC_VIEW, "suppliers"), head: "Largest Organizations", item: "Shared Services Canada", total: 9 },
    { name: "organization/years", ref: tableRef(CASCADE_VIEW, "years"), head: "Value by Fiscal Year", item: CASCADE, total: 5 },
    { name: "organization/records", ref: tableRef(CASCADE_VIEW, "records"), head: "Ten Largest Records", item: CASCADE, total: 5 },
    { name: "segment/years", ref: tableRef(SEG_VIEW, "years"), head: "Buyers and Organizations by Fiscal Year", item: "81 Engineering and Research and Technology Based Services", total: 14 },
    { name: "segment/winners", ref: tableRef(SEG_VIEW, "winners"), head: "Largest Organizations in the Segment", item: "81 Engineering and Research and Technology Based Services", total: 9 },
    { name: "segment/records", ref: tableRef(SEG_VIEW, "records"), head: "Ten Largest Records", item: "81 Engineering and Research and Technology Based Services", total: 10 },
  ];

  it("draws one table of each view in full at two sizes: the rows its height holds, its count, its chart, Open at its anchor", async () => {
    const r = await reader("dash-analytic");
    for (const x of CASES) expect((await addTable(r, x.ref)).headers.get("location"), x.name).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    const ids = new Map<string, string>();
    for (const x of CASES) ids.set(x.name, (await tileOfRef(r, x.ref)).id);
    // Stored as posted, a tile each, no choices written.
    expect((await tileRows(r.id)).filter((x) => x.kind === "analytic").every((x) => x.opts === "")).toBe(true);
    for (const [w, h] of [[7, 16], [12, 16]] as const) {
      // Every table at one size, one under another.
      await save(r, CASES.map((x, i) => ({ id: ids.get(x.name)!, x: 0, y: i * 16, w, h })));
      const html = await text(await open(r));
      for (const x of CASES) {
        const tile = drawn(html).find((d) => d.id === ids.get(x.name))!;
        expect([tile.w, tile.h], x.name).toEqual([w, h]);
        const fit = analyticFit(x.name, w, h);
        const shown = Math.min(fit.rows, x.total);
        expect(tile.head, x.name).toBe(`${x.head} | ${x.item}`);
        expect(rowsIn(tile.html), `${x.name} ${w}x${h}`).toBe(shown);
        expect(countIn(tile.html), `${x.name} ${w}x${h}`).toBe(shown < x.total ? `${shown} of ${x.total}` : null);
        expect(tile.html).toContain(`data-total="${x.total}"`);
        expect(openIn(tile.html), x.name).toBe(x.ref);
        expect(tile.html).toContain(`<a href="${x.ref}" class="dash-menu-item">Open</a>`);
        expect(tile.html).toContain("PSPC contract history, federal fiscal years 2007-08 to 2026-27.");
        // Its body's classes: where its secondary columns rest and where it stacks (styles.css).
        expect(tile.html).toMatch(/<div class="dash-body dash-rest( dash-stack-(540|640))?">/);
        // The page's own drawing: a chart over a table drawn to the tile, the plot as the fit says, no sorting in a tile.
        if (fit.chart) expect(tile.html, x.name).toContain(`<div class="chart-plot" style="height:${analyticPlot(x.name, fit, shown)}px">`);
        expect(tile.html).not.toContain("data-sorting");
        expect(tile.html).not.toContain(t("en", "dash.unavailable"));
      }
      // A tall tile lists more than a short one would, never more than 25, never a scroll bar's worth: the rows follow the height.
      expect(analyticFit("buyer/quarters", w, h).rows).toBeGreaterThan(analyticFit("buyer/quarters", w, 10).rows);
      expect(misfits(html)).toEqual([]);
      expect(mainOf(html).match(/btn-primary/g)).toHaveLength(1);
    }
    // Ranked: the bars and the table list the same organizations; a withheld supplier is named by no one.
    const page = await text(await open(r));
    const suppliers = drawn(page).find((d) => d.id === ids.get("buyer/suppliers"))!.html;
    expect(suppliers.match(/<li title=/g)?.length).toBe(rowsIn(suppliers));
    expect(suppliers).toContain(`<a href="/organizations/${C(1)}">${CASCADE}</a>`);
    const records = drawn(page).find((d) => d.id === ids.get("buyer/records"))!.html;
    expect(records).toContain(`<span class="muted">${t("en", "common.not_stated")}</span>`);
    // The quarters' figures are the records': 2026-27's one record, $28,000 (the withheld one), and 2013-14's $20,000.
    const quarters = drawn(page).find((d) => d.id === ids.get("buyer/quarters"))!.html;
    expect(quarters).toContain("$280,000");
    // One of each view's tables at a size read alone (the page's script after a resize), rows at that size.
    for (const x of [CASES[0], CASES[3], CASES[5]]) {
      const fragment = norm(decode(await (await readTile(r, ids.get(x.name)!, "?w=12&h=12")).text()));
      expect(fragment).toContain('data-w="12" data-h="12"');
      expect(rowsIn(fragment), x.name).toBe(Math.min(analyticFit(x.name, 12, 12).rows, x.total));
    }
  });

  it("reads every analytics table of a page view in the one records batch, each with the view's own statements", async () => {
    const r = await reader("dash-analytic-batch");
    for (const x of CASES) await addTable(r, x.ref);
    // The records binding watched: each statement's text and binds, in the order prepared, and each batch's size.
    const batches: number[] = [];
    const prepared: { sql: string; params: unknown[] }[] = [];
    const db = new Proxy(RECORDS, {
      get(target, prop) {
        if (prop === "batch") return (list: D1PreparedStatement[]) => (batches.push(list.length), target.batch(list));
        if (prop === "prepare") {
          return (sql: string) => {
            const st = target.prepare(sql);
            const seen = { sql, params: [] as unknown[] };
            prepared.push(seen);
            const bind = st.bind.bind(st);
            (st as unknown as { bind: (...p: unknown[]) => D1PreparedStatement }).bind = (...p: unknown[]) => ((seen.params = p), bind(...p));
            return st;
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const html = await text(await open(r, "/account/dashboard", off({ RECORDS: db })));
    for (const d of drawn(html)) expect(d.html, d.head).not.toContain(t("en", "dash.unavailable"));
    // The starting layout's 3-month list (two) and the state row, then each table's statements and its subject's name
    // (a segment's needs none): quarters 1+1, records 1+1, suppliers 2+1, years 1+1, records 1+1, segment years 1,
    // winners 2, records 1.
    const size = 1 + 2 + 2 + 2 + 3 + 2 + 2 + 1 + 2 + 1;
    expect(Math.max(...batches)).toBe(size);
    expect(batches.filter((b) => b > 2)).toHaveLength(1);
    // Each statement bounded (a LIMIT, as on the analytics page) and read through an index: its plan reads no table
    // whole (a SCAN of a table without an index), whatever it then does with what it read.
    const start = prepared.findIndex((x) => /FROM rec_meta/.test(x.sql));
    for (const x of prepared.slice(start + 1, start + size)) {
      expect(x.sql, x.sql).toMatch(/LIMIT (\d+|\?\d+)\s*$/);
      const plan = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${x.sql}`).bind(...x.params).all()).results ?? []).map((p) => String((p as { detail?: unknown }).detail));
      const made = new Set(plan.flatMap((p) => /^(?:MATERIALIZE|CO-ROUTINE) (\S+)/.exec(p)?.[1] ?? []));
      const whole = plan.filter((p) => /^SCAN /.test(p) && !/USING|CONSTANT ROW/i.test(p) && !made.has(/^SCAN (\S+)/.exec(p)![1]));
      expect(whole, `${x.sql}\n${plan.join("\n")}`).toEqual([]);
    }
  });

  it("keeps the same table once on a dashboard and two tables of one view as two tiles; a table its view does not draw is refused", async () => {
    const r = await reader("dash-analytic-once");
    const ref = tableRef(SSC_VIEW, "records");
    expect((await addTable(r, ref)).headers.get("location")).toMatch(/\?m=added#tile-/);
    const first = await tileOfRef(r, ref);
    // The same table again, in another order and language: the tile it has.
    expect((await addTable(r, "/buyers/ssc-spc/analytics?years=20&source=history&lang=fr#table-records")).headers.get("location"))
      .toBe(`/account/dashboard?m=exists#tile-${first.id}`);
    // Another table of the same view, and the same table at another period or source: tiles of their own.
    await addTable(r, tableRef(SSC_VIEW, "quarters"));
    await addTable(r, "/buyers/ssc-spc/analytics?source=history&years=10#table-records");
    await addTable(r, "/buyers/ssc-spc/analytics?source=awards&years=20#table-records");
    const refs = (await tileRows(r.id)).filter((x) => x.kind === "analytic").map((x) => x.ref).sort();
    expect(refs).toEqual([
      "/buyers/ssc-spc/analytics?source=awards&years=20#table-records", "/buyers/ssc-spc/analytics?source=history&years=10#table-records",
      tableRef(SSC_VIEW, "quarters"), ref,
    ].sort());
    // The statement alone holds the same item once.
    const board = (await boards(r.id))[0].id;
    const again = await ACCOUNTS.prepare(ADD_TILE_SQL).bind("e".repeat(32), r.id, "analytic", ref, 0, 0, 6, 9, new Date().toISOString(), 24, 2, board).run();
    expect(again.meta.changes).toBe(0);
    // A table not the view's, no table, an unknown anchor, the share table without its segment, a view the ref check refuses.
    for (const bad of [
      `/organizations/${C(1)}/analytics?source=history&years=20#table-quarters`, "/segments/81/analytics?source=history&years=20#table-share",
      SSC_VIEW, `${SSC_VIEW}#records`, `${SSC_VIEW}#table-nope`, `${CASCADE_VIEW}#table-share`, "/buyers/ssc-spc/analytics?source=history&years=7#table-records",
      "/buyers/ssc-spc/analytics?source=history&years=20&evil=1#table-records", "https://evil.example/buyers/ssc-spc/analytics?source=history&years=20#table-records",
    ]) {
      expect((await addTable(r, bad)).status, bad).toBe(400);
    }
    // The ref as the dashboard reads and writes it.
    const share = analyticRef(`${CASCADE_VIEW}&vs=${C(2)}&segment=81&vs=${C(1)}#table-share`)!;
    expect(share).toMatchObject({ table: "share", segment: 81, rivals: [C(2)] });
    expect(analyticAddress(share)).toBe(`${CASCADE_VIEW}&segment=81&vs=${C(2)}#table-share`);
    expect(analyticRef(`${SSC_VIEW}&segment=81#table-records`)).toMatchObject({ table: "records", segment: null });
    expect(analyticAddress(analyticRef(`${SSC_VIEW}&segment=81#table-records`)!)).toBe(tableRef(SSC_VIEW, "records"));
    for (const view of ["buyer", "organization", "segment"] as const) {
      for (const table of VIEW_TABLES[view]) {
        const base = view === "buyer" ? SSC_VIEW : view === "organization" ? `${CASCADE_VIEW}&segment=81` : SEG_VIEW;
        expect(specOf("analytic", `${base}#table-${table}`, { searches: [], briefings: [] })?.kind, `${view} ${table}`).toBe("analytic");
      }
    }
  });

  it("draws the share table of an organization with its segment and the organizations chosen", async () => {
    const r = await reader("dash-analytic-share");
    const ref = `${CASCADE_VIEW}&segment=81&vs=${C(2)}#table-share`;
    expect((await addTable(r, ref)).headers.get("location")).toMatch(/\?m=added#tile-/);
    const html = await text(await open(r));
    const tile = drawn(html).find((d) => d.head.startsWith("Share of a Segment"))!;
    expect(tile.head).toBe(`Share of a Segment | ${CASCADE}`);
    expect(tile.html).toContain(`<strong>${CASCADE}</strong>`);
    expect(tile.html).toContain(`<a href="/organizations/${C(2)}">Supplier 2 Inc.</a>`);
    expect(tile.html).toContain('<a href="/segments/81">');
    expect(openIn(tile.html)).toBe(ref);
    // The tile draws no form of the panel's: its one filled button stays the page's Add a Tile.
    expect(tile.html).not.toContain("<form method=\"get\"");
    expect(mainOf(html).match(/btn-primary/g)).toHaveLength(1);
    expect(misfits(html)).toEqual([]);
  });

  it("draws a saved view's tile as its first table, under the reader's name for it", async () => {
    const r = await reader("dash-analytic-saved");
    const id = crypto.randomUUID().replace(/-/g, "");
    await ACCOUNTS.prepare(
      "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'segment', ?, 'Engineering', 'en', 'off', ?)",
    ).bind(id, r.id, SEG_VIEW, new Date().toISOString()).run();
    await send(r, "/account/dashboard/panels", { kind: "view", ref: id });
    const tile = drawn(await text(await open(r))).find((d) => d.head.startsWith("Buyers and Organizations"))!;
    expect(tile.head).toBe("Buyers and Organizations by Fiscal Year | Engineering");
    expect(openIn(tile.html)).toBe(`${SEG_VIEW}#table-years`);
    expect(tile.html.match(/<div class="chart-plot"/g)).toHaveLength(2);
    expect(rowsIn(tile.html)).toBeGreaterThanOrEqual(3);
    // Its saved view removed: the tile goes with it.
    await send(r, `/account/views/${id}/delete`);
    expect((await tileRows(r.id)).some((x) => x.ref === id)).toBe(false);
  });

  it("moves to another dashboard and is removed as any tile is", async () => {
    const r = await reader("dash-analytic-move");
    const b2 = await newBoard(r);
    const ref = tableRef(SEG_VIEW, "winners");
    await addTable(r, ref);
    const tile = await tileOfRef(r, ref);
    expect((await send(r, `/account/dashboard/tiles/${tile.id}/board`, { board: b2 })).headers.get("location")).toMatch(new RegExp(`m=moved&to=${b2}`));
    expect((await boardTiles(b2)).map((x) => x.ref)).toEqual([ref]);
    // The same table on both dashboards, once on each; on the second it is there already.
    await addTable(r, ref);
    const back = (await tileRows(r.id)).find((x) => x.ref === ref && x.id !== tile.id)!;
    expect((await send(r, `/account/dashboard/tiles/${back.id}/board`, { board: b2 })).headers.get("location")).toMatch(/m=move_exists/);
    expect((await send(r, `/account/dashboard/tiles/${back.id}/delete`)).status).toBe(303);
    expect((await tileRows(r.id)).filter((x) => x.ref === ref)).toHaveLength(1);
  });

  it("is added in each state of storage: into the panels while the grid's tables are absent, with the first change, or stored", async () => {
    const ref = tableRef(SSC_VIEW, "records");
    // The grid's tables absent: into the panels' table, drawn on the page from there.
    const a = await reader("dash-analytic-state-a");
    await without("tiles", async () => {
      expect((await addTable(a, ref)).headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
      expect((await panelRows(a.id)).map((p) => `${p.kind}:${p.ref}`)).toContain(`analytic:${ref}`);
      const tile = drawn(await text(await open(a))).find((d) => d.head.startsWith("Ten Largest Records"))!;
      expect(tile.html).not.toContain(t("en", "dash.unavailable"));
    });
    // Neither table: nothing kept.
    const none = await reader("dash-analytic-state-none");
    await without("all", async () => {
      expect((await addTable(none, ref)).headers.get("location")).toBe("/account/dashboard?m=unsaved");
    });
    // The tables there and nothing stored: the starting layout written, then the table under it.
    const b = await reader("dash-analytic-state-b");
    await addTable(b, ref);
    expect((await tileRows(b.id)).map((x) => `${x.kind}:${x.ref}`)).toEqual(["watches:", "radar:3m", `analytic:${ref}`]);
    expect(await boards(b.id)).toHaveLength(1);
  });
});

// =====================================================================================
// The per-panel Add to dashboard on each analytics page
// =====================================================================================

describe("each analytics page's panels", () => {
  const PAGES = [
    { view: "buyer", path: "/buyers/pwgsc-tpsgc/analytics?source=awards&years=5" },
    { view: "organization", path: `/organizations/${A1}/analytics?source=awards&years=5` },
    { view: "segment", path: "/segments/81/analytics?source=awards&years=5" },
  ] as const;
  // A page's main without what only an Ultra account's carries (each panel's Add to dashboard and its anchor) and the
  // period tabs, which offer Ultra's period to Ultra; the session's own values blanked.
  const bare = (html: string) => mainOf(html)
    .replace(/<form method="post" action="\/account\/dashboard\/panels" class="account-inline dash-add">[\s\S]*?<\/form>/g, "")
    .replace(/<details class="dash-add dash-add-menu">[\s\S]*?<\/details>/g, "")
    .replace(/<div class="panel-tools"><\/div>/g, "")
    .replace(/ id="table-[a-z]+"/g, "")
    .replace(/<nav class="tabs tabs-small toolbar-row"[\s\S]*?<\/nav>/, "")
    .replace(/[0-9a-f]{32}/g, "X");

  it("carry each its own Add to dashboard and an anchor for an Ultra account, the page's own one gone, and nothing for any other reader", async () => {
    const ultra = await reader("dash-panels-ultra");
    const pro = await reader("dash-panels-pro", "pro");
    const free = await reader("dash-panels-free", "free");
    for (const p of PAGES) {
      for (const lang of ["en", "fr"] as const) {
        const path = lang === "fr" ? `${p.path}&lang=fr` : p.path;
        const u = await text(await get(path, { cookie: ultra.cookie, env: off() }));
        const tables = VIEW_TABLES[p.view] as readonly string[];
        // Each panel's heading carries its table's anchor, in page order; each panel that draws its table its own control.
        const anchors = [...mainOf(u).matchAll(/<h2 id="table-([a-z]+)">/g)].map((m) => m[1]);
        expect(anchors, `${p.view} ${lang}`).toEqual(tables);
        const refs = [...mainOf(u).matchAll(/<input type="hidden" name="kind" value="analytic"\/><input type="hidden" name="ref" value="([^"]*)"\/>/g)].map((m) => m[1]);
        expect(refs.map((x) => x.slice(x.indexOf("#table-") + 7)), `${p.view} ${lang}`).toEqual(tables);
        for (const ref of refs) {
          expect(analyticRef(ref), ref).not.toBeNull();
          expect(specOf("analytic", ref, { searches: [], briefings: [] })?.ref, ref).toBe(ref);
        }
        expect(refs[0]).toBe(`${p.path}#table-${tables[0]}`);
        // Link style, never a filled button; the page head's own Add to dashboard is gone.
        expect(mainOf(u)).toContain(`<button type="submit" class="btn-link">${norm(t(lang, "dash.add_here"))}</button>`);
        expect(mainOf(u).indexOf("dash-add")).toBeGreaterThan(mainOf(u).indexOf('<section class="panel'));
        expect(mainOf(u).match(/<form method="post" action="\/account\/dashboard\/panels" class="account-inline dash-add">/g)?.length).toBe(refs.length);
        expect(u).not.toContain(EM_DASH);
        expect(misfits(u)).toEqual([]);
        for (const r of [null, free, pro]) {
          const other = await text(await get(path, { cookie: r?.cookie, env: off() }));
          expect(other, p.path).not.toContain("dash-add");
          expect(other, p.path).not.toContain('id="table-');
        }
        // Pro's page and Ultra's are the same page but for each panel's control and anchor (and Ultra's longer period).
        const pr = await text(await get(path, { cookie: pro.cookie, env: off() }));
        expect(bare(u), `${p.view} ${lang}`).toBe(bare(pr));
      }
    }
  });

  it("add their table to the dashboard, and with several dashboards to the one chosen", async () => {
    const r = await reader("dash-panels-add");
    const html = await text(await get(PAGES[2].path, { cookie: r.cookie, env: off() }));
    const ref = [...mainOf(html).matchAll(/name="ref" value="([^"]*#table-winners)"/g)][0][1];
    expect((await addTable(r, ref)).headers.get("location")).toMatch(/\?m=added#tile-/);
    expect((await tileRows(r.id)).some((x) => x.kind === "analytic" && x.ref === ref)).toBe(true);
    const b2 = await newBoard(r);
    const several = await text(await get(PAGES[2].path, { cookie: r.cookie, env: off() }));
    expect(several).toContain(`<details class="dash-add dash-add-menu"><summary class="btn-link">Add to dashboard</summary><form method="post" action="/account/dashboard/panels" class="dash-add-list">`);
    expect((await addTable(r, tableRef(PAGES[2].path, "records"), off(), b2)).headers.get("location")).toMatch(new RegExp(`^/account/dashboard/${b2}\\?m=added#tile-`));
  });
});

// =====================================================================================
// The text tile
// =====================================================================================

describe("a text tile", () => {
  const addText = (r: Reader, value: string, board = "") => send(r, "/account/dashboard/panels", { kind: "text", text: value, ...(board ? { board } : {}) });
  const texts = async (r: Reader) => (await tileRows(r.id)).filter((x) => x.kind === "text");
  const tileHtml = (html: string, id: string) => drawn(html).find((d) => d.id === id)!.html;

  it("is added from Add a Tile as a heading or a note, plain text, its markup drawn as text, edited from its menu", async () => {
    const r = await reader("dash-text");
    // Add a Tile's Text group: a field and Add, no filled button.
    const page = mainOf(await text(await open(r)));
    expect(page).toContain('<p class="dash-adder-part" id="dash-add-text">Text</p>');
    expect(page).toContain(`<textarea name="text" rows="3" maxlength="${NOTE_MAX}"></textarea>`);
    expect(page.match(/btn-primary/g)).toHaveLength(1);
    // A heading: one short line.
    expect((await addText(r, "  Network spending  ")).headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    const [heading] = await texts(r);
    expect(heading.ref).toMatch(/^[0-9a-f]{32}$/);
    expect(heading.ref).not.toBe(heading.id);
    expect(JSON.parse(heading.opts)).toEqual({ text: "Network spending" });
    // A note: lines kept, control characters dropped, markup as typed.
    await addText(r, "Watch these buyers\r\n<b>closely</b> & \u0007often\n\n\n\nEvery Monday");
    const note = (await texts(r)).find((x) => x.id !== heading.id)!;
    expect(noteOf(note.opts)).toBe("Watch these buyers\n<b>closely</b> & often\n\nEvery Monday");
    // Two notes on one dashboard: each its own ref.
    expect(note.ref).not.toBe(heading.ref);
    const raw = await (await open(r)).text();
    const h = tileHtml(raw, heading.id);
    expect(h).toContain(`<h2 id="tile-${heading.id}-t" class="dash-heading">Network spending</h2>`);
    expect(h).toContain('data-key="text"');
    const n2 = tileHtml(raw, note.id);
    expect(n2).toContain(`<h2 id="tile-${note.id}-t" class="visually-hidden">Your note</h2>`);
    expect(n2).toContain('<p class="dash-note">Watch these buyers<br/>&lt;b&gt;closely&lt;/b&gt; &amp; often<br/><br/>Every Monday</p>');
    expect(n2).toContain('data-key="text:note"');
    expect(raw).not.toContain("<b>closely</b>");
    // No foot, no Open; the menu leads with Edit, a details element with the text and Save, never a dialog.
    expect(n2).not.toContain("dash-foot");
    expect(n2).toContain(`<details class="dash-text-edit"><summary class="dash-menu-item">Edit</summary><form method="post" action="/account/dashboard/tiles/${note.id}/text" class="stack dash-text-form">`);
    expect(n2).toContain(`maxlength="${NOTE_MAX}">Watch these buyers\n&lt;b&gt;closely&lt;/b&gt; &amp; often\n\nEvery Monday</textarea>`);
    expect(raw).not.toMatch(/confirm\(|prompt\(|onclick/);
    // Edited: the heading becomes a note, and back.
    expect((await send(r, `/account/dashboard/tiles/${heading.id}/text`, { text: "Two\nlines" })).headers.get("location")).toBe(`/account/dashboard#tile-${heading.id}`);
    expect(noteOf((await texts(r)).find((x) => x.id === heading.id)!.opts)).toBe("Two\nlines");
    expect(drawn(await text(await open(r))).find((d) => d.id === heading.id)!.html).toContain('data-key="text:note"');
    // Another account's tile: nothing changes.
    const other = await reader("dash-text-other");
    await send(other, `/account/dashboard/tiles/${heading.id}/text`, { text: "Theirs" });
    expect(noteOf((await texts(r)).find((x) => x.id === heading.id)!.opts)).toBe("Two\nlines");
    // A text post on a tile of another kind changes nothing.
    const watches = (await tileRows(r.id)).find((x) => x.kind === "watches")!;
    await send(r, `/account/dashboard/tiles/${watches.id}/text`, { text: "x" });
    expect((await tileRows(r.id)).find((x) => x.id === watches.id)!.opts).toBe("");
    expect(misfits(raw)).toEqual([]);
  });

  it("holds 500 characters and cuts what is past them, refuses an empty add, keeps an emptied one, and draws broken opts as an empty note", async () => {
    const r = await reader("dash-text-bounds");
    await addText(r, "x".repeat(NOTE_MAX));
    await addText(r, `${"y".repeat(NOTE_MAX)}z`);
    const [a, b] = (await texts(r)).sort((p, q) => p.opts.localeCompare(q.opts));
    expect(noteOf(a.opts)).toBe("x".repeat(NOTE_MAX));
    expect(noteOf(b.opts)).toBe("y".repeat(NOTE_MAX));
    expect(a.opts.length).toBeLessThanOrEqual(2000);
    // A character outside the basic plane counts once and is never cut in half.
    expect(noteText("\u{1F600}".repeat(NOTE_MAX + 3))).toBe("\u{1F600}".repeat(NOTE_MAX));
    expect(noteText("a\uD800b")).toBe("ab");
    expect(isHeading("x".repeat(80))).toBe(true);
    expect(isHeading("x".repeat(81))).toBe(false);
    // Nothing typed, or only spaces and control characters: nothing added, the page says why.
    const before = (await tileRows(r.id)).length;
    for (const empty of ["", "   ", "\u0000\u0007\n\n"]) {
      expect((await addText(r, empty)).headers.get("location"), JSON.stringify(empty)).toBe("/account/dashboard?m=text_empty#dash-add");
    }
    expect((await tileRows(r.id)).length).toBe(before);
    expect(await text(await open(r, "/account/dashboard?m=text_empty"))).toContain(t("en", "dash.text_empty"));
    // Emptied by Edit: the tile stays and says it is empty.
    await send(r, `/account/dashboard/tiles/${a.id}/text`, { text: "" });
    expect(noteOf((await texts(r)).find((x) => x.id === a.id)!.opts)).toBe("");
    expect(drawn(await text(await open(r))).find((d) => d.id === a.id)!.html).toContain(t("en", "dash.text_empty_tile"));
    // Opts that do not parse, or of another shape: an empty note, never a fault.
    for (const broken of ["{nope", "[]", '{"text":42}', "null"]) {
      await ACCOUNTS.prepare("UPDATE dashboard_tiles SET opts = ? WHERE id = ?").bind(broken, b.id).run();
      const res = await open(r);
      expect(res.status, broken).toBe(200);
      expect(drawn(await text(res)).find((d) => d.id === b.id)!.html, broken).toContain(t("en", "dash.text_empty_tile"));
    }
    // The statement writes the text as given (the post cleans it first).
    const board = (await boards(r.id))[0].id;
    const written = await ACCOUNTS.prepare(ADD_TEXT_SQL)
      .bind("d".repeat(32), r.id, "text", "e".repeat(32), 0, 99, 3, 2, new Date().toISOString(), 24, 2, board, JSON.stringify({ text: "Direct" })).run();
    expect(written.meta.changes).toBe(1);
    expect(noteOf((await tileRows(r.id)).find((x) => x.id === "d".repeat(32))!.opts)).toBe("Direct");
  });

  it("is sized from 3 columns by 2 rows as a heading, moves to another dashboard and is removed as any tile is", async () => {
    const r = await reader("dash-text-move");
    await addText(r, "Bids");
    const [x] = await texts(r);
    expect([x.w, x.h]).toEqual([6, START_H.text]);
    await save(r, [{ id: x.id, x: 0, y: 0, w: 3, h: 2 }]);
    const kept = (await texts(r))[0];
    expect([kept.w, kept.h]).toEqual([LEAST.text.w, LEAST.text.h]);
    await save(r, [{ id: x.id, x: 0, y: 0, w: 1, h: 1 }]);
    expect([(await texts(r))[0].w, (await texts(r))[0].h]).toEqual([3, 2]);
    // Read alone at a size, as the page's script reads it after a resize.
    const fragment = await (await readTile(r, x.id, "?w=4&h=3")).text();
    expect(fragment).toContain('<h2 id="tile-' + x.id + '-t" class="dash-heading">Bids</h2>');
    const b2 = await newBoard(r);
    expect((await send(r, `/account/dashboard/tiles/${x.id}/board`, { board: b2 })).headers.get("location")).toMatch(/m=moved/);
    expect((await boardTiles(b2)).map((t2) => t2.kind)).toEqual(["text"]);
    expect((await send(r, `/account/dashboard/tiles/${x.id}/delete`)).status).toBe(303);
    expect(await texts(r)).toEqual([]);
  });

  it("is kept only with the grid's tables: while they are absent Add a Tile says so and a post adds nothing", async () => {
    const r = await reader("dash-text-absent");
    await without("tiles", async () => {
      const page = mainOf(await text(await open(r)));
      expect(page).toContain(t("en", "dash.text_unsaved"));
      expect(page).not.toContain('<textarea name="text"');
      expect((await addText(r, "Kept?")).headers.get("location")).toBe("/account/dashboard?m=text_unsaved#dash-add");
      expect((await panelRows(r.id)).some((p) => p.kind === "text")).toBe(false);
    });
    // The first change writes the starting layout, then the text under it.
    const b = await reader("dash-text-first");
    await addText(b, "First");
    expect((await tileRows(b.id)).map((x) => x.kind)).toEqual(["watches", "radar", "text"]);
    // In French: the group, the field and the empty note's words.
    const fr = mainOf(await text(await open(b, "/account/dashboard?lang=fr")));
    expect(fr).toContain('<p class="dash-adder-part" id="dash-add-text">Texte</p>');
    expect(fr).toContain(norm(t("fr", "dash.text_label")));
    expect(fr).not.toContain(EM_DASH);
    expect(fr).not.toContain(EN_DASH);
  });
});
