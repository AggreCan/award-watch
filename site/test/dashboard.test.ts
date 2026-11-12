// The dashboard (src/account/dashboard.tsx; docs/accounts.md, Dashboard):
// the address for each reader (the site's 404 while Ultra is off sale for
// anyone who does not hold it, the sign-in page, what it holds for Free and
// Pro with no records read, the panels for Ultra); the starting layout; each
// kind of panel from rows written here, with its "See all"; a removed item;
// the four posts behind the session, CSRF and Origin, in the form bucket; the
// 13th panel and the third briefing refused inside the insert; the table
// missing; the page's fit from 700 px, its one filled button, its cache
// header; the rail's item; "Add to dashboard" for Ultra alone; both
// languages. The records database is built here from
// pipeline/records_schema.sql with the rows below.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ADD_PANEL_SQL, BRIEFING_PANELS_MAX, PANEL_KINDS, PANEL_ROWS, RADAR_TOP_SQL, specOf, startingLayout, viewAddress, viewRef, viewSpan,
} from "../src/account/dashboard";
import { DASHBOARD_MAX, dashboardCap } from "../src/account/dashboard_rule";
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
import { leastWidths, misfits, tablesIn } from "./table-fit";
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
function radar(ref: string, end: string, value: number, org: string): string {
  return JSON.stringify({
    kind: "award", reference: ref, title_en: `Contract ${ref}`, title_fr: `Contrat ${ref}`, organization_id: org, organization: org === A1 ? NAME1 : "Other Ltd.",
    buyer_id: "pwgsc-tpsgc", buyer_en: "PSPC", buyer_fr: "SPAC", start: "2024-01-01", end, value, currency: "CAD", competitive: 1,
    method_en: "Competitive", method_fr: "Concurrentielle", instrument_en: "Contract", instrument_fr: "Contrat", n_amendments: 0,
    value_growth: null, tender_reference: null, segments: ["81"], provinces: ["ON"],
  });
}
// Seven contracts ending within 12 months of the data date, six of them the organization's: more than a panel lists.
const ENDS = ["2026-11-15", "2026-12-01", "2027-01-15", "2027-02-01", "2027-03-01", "2027-05-01", "2027-07-01"];
const EXPIRING = ENDS.map((end, i) => ({
  endd: end, oid: i === 6 ? n(A2) : n(A1), buyer: i === 6 ? "dfo-mpo" : "pwgsc-tpsgc", cents: (i + 1) * 1_000_000,
  j: radar(`EN578-00000${i}`, end, (i + 1) * 10_000, i === 6 ? A2 : A1),
}));
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

const panelRows = (id: string) => ACCOUNTS.prepare("SELECT id, kind, ref, pos, wide FROM dashboard_panels WHERE user_id = ? ORDER BY pos, created_at, id")
  .bind(id).all<{ id: string; kind: string; ref: string; pos: number; wide: number }>().then((r) => r.results ?? []);
// The panels' heads, in order: the kind, then the item.
const heads = (html: string) => [...mainOf(html).matchAll(/<section class="panel dash-panel[^"]*"[^>]*><div class="panel-head"><h2[^>]*>([\s\S]*?)<\/h2>/g)]
  .map((m) => m[1].replace(/<span class="dash-item">/, " | ").replace(/<[^>]+>/g, ""));
const searchId = async (r: Reader, params: string) =>
  (await ACCOUNTS.prepare("SELECT id FROM saved_searches WHERE user_id = ? AND params = ?").bind(r.id, params).first<{ id: string }>())!.id;

// The dashboard's table taken off the database for the length of fn, then made again from accounts_schema.sql, its
// rows kept aside and put back: the database before the operator applies the schema (as accounts-helpers withoutTiers).
const PANELS_SCHEMA = splitSql(accountsSchema).filter((s) => s.includes("dashboard_panels"));
async function withoutPanels<T>(fn: () => Promise<T>): Promise<T> {
  const kept = (await ACCOUNTS.prepare("SELECT * FROM dashboard_panels").all<Record<string, unknown>>()).results ?? [];
  await ACCOUNTS.prepare("DROP TABLE IF EXISTS dashboard_panels").run();
  try {
    return await fn();
  } finally {
    await ACCOUNTS.batch(PANELS_SCHEMA.map((s) => ACCOUNTS.prepare(s)));
    if (kept.length) {
      await ACCOUNTS.batch(kept.map((r) => ACCOUNTS.prepare(
        "INSERT OR IGNORE INTO dashboard_panels (id, user_id, kind, ref, pos, wide, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(r.id, r.user_id, r.kind, r.ref, r.pos, r.wide, r.created_at)));
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
        expect(main).toContain(norm(t(lang, "dash.what_lead", { cap: String(RULES.ultra.dashboard) })));
        for (const k of PANEL_KINDS) expect(main, k).toContain(`<li>${norm(t(lang, `dash.what_${k}` as Key))}</li>`);
        expect(main).toContain(`<p class="muted">${norm(t(lang, "dash.gate"))} <a href="/account/billing">${norm(t(lang, "billing.link_plans"))}</a></p>`);
        expect(main.match(/<div class="plan-card[ "]/g)).toHaveLength(3);
        expect(main).toContain("plan-card plan-card-ultra");
        // One filled button: Ultra's.
        const filled = [...main.matchAll(/<a href="([^"]*)" class="btn btn-primary">/g)].map((m) => m[1]);
        expect(filled).toHaveLength(1);
        expect(filled[0]).toContain("plan=ultra");
        // No panel, no records read.
        expect(main).not.toContain("dash-panel");
        expect(records.used).toEqual([]);
        expect(html).not.toContain(EM_DASH);
        expect(html).not.toContain(EN_DASH);
      }
    }
  });
});

describe("an Ultra account", () => {
  it("with no panel stored sees the starting layout, computed and not stored", async () => {
    const r = await reader("dash-start");
    const html = await text(await open(r));
    expect(heads(html)).toEqual(["Your watches this week", "Contracts ending | Ending within 3 months"]);
    expect(mainOf(html)).toContain(`<p class="muted">${t("en", "dash.starter")}</p>`);
    expect(await panelRows(r.id)).toEqual([]);
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
    expect(await panelRows(r.id)).toEqual([]);
    expect(startingLayout({ searches: [], claim: null, keys: [] }).map((s) => `${s.kind}:${s.ref}`)).toEqual(["watches:", "radar:3m"]);
  });

  it("draws every kind from what it reads, each with its See all, and keeps the advisory line inside the matching notices", async () => {
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
    // the tender search, the API), then adds the panel after it; five more fill the dashboard's twelve.
    const panels: [string, string][] = [
      ["radar", expiring], ["radar", "12m"], ["records", org], ["view", view], ["briefing", briefing], ["org", "segments"],
    ];
    for (const [kind, ref] of panels) {
      const res = await send(r, "/account/dashboard/panels", { kind, ref });
      expect(res.status, `${kind} ${ref}`).toBe(303);
      expect(res.headers.get("location"), `${kind} ${ref}`).toBe("/account/dashboard?m=added");
    }
    expect((await panelRows(r.id)).map((p) => `${p.kind}:${p.ref}`)).toEqual([
      "watches:", "radar:3m", "matches:", "org:years", `tenders:${tenders}`, "api:", ...panels.map(([k, v]) => `${k}:${v}`),
    ]);
    const res = await open(r, "/account/dashboard?m=added");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const html = await text(res);
    const main = mainOf(html);
    expect(main).toContain(`<p class="account-notice" role="status">${t("en", "dash.added")}</p>`);
    expect(main).not.toContain(t("en", "dash.starter"));
    const h = heads(html);
    expect(h.slice(0, 4)).toEqual([
      "Your watches this week", "Contracts ending | Ending within 3 months", "Matching notices", `Your organization: Records by Fiscal Year | ${NAME1}`,
    ]);
    expect(h[4]).toMatch(/^Saved search: open notices \| /);
    expect(h[5]).toBe("API requests today");
    expect(h[6]).toMatch(/^Contracts ending \| .*Public Services and Procurement Canada/);
    expect(h.slice(7, 8)).toEqual(["Contracts ending | Ending within 12 months"]);
    expect(h[8]).toBe(`Saved search: records | When ${NAME1} is named on a new award, contract or grant`);
    expect(h.slice(9)).toEqual([
      `Analytics view | ${NAME1}`, "Weekly briefing, this week so far | 81 Engineering", `Your organization: Records by Segment | ${NAME1}`,
    ]);
    // The See all of each, in order.
    const seeAll = [...main.matchAll(/<a href="([^"]*)">See all<\/a>/g)].map((m) => m[1]);
    expect(seeAll).toEqual([
      "/account/watches", "/expiring/3m", "/account/matches", "/account/organization", "/tenders?segment=82", "/account/api",
      "/expiring/12m?buyer=pwgsc-tpsgc", "/expiring/12m", `/organizations/${A1}`, view, "/segments/81", "/account/organization",
    ]);
    const sections = main.split(/(?=<section class="panel dash-panel)/).slice(1);
    expect(sections).toHaveLength(12);
    // The watches: the claimed organization's two events this week, not the one before it.
    expect(sections[0]).toContain("A new award this week");
    expect(sections[0]).toContain("A published contract this week");
    expect(sections[0]).not.toContain("An award before the week");
    // The 3-month list: the three contracts ending within 91 days.
    expect(sections[1]).toContain('<span class="panel-count">3</span>');
    // The matching notices: the advisory line inside the panel, and the notice in segment 82 first.
    expect(sections[2]).toContain('class="muted small fit-disclaimer"');
    expect(sections[2]).toContain('<a href="/tenders/cb-100-10000001">');
    // The years block: the figures from the rows written.
    expect(sections[3]).toContain("$300,000");
    expect(sections[3]).toContain("2026-27 (to date)");
    // The tender search: the open notice in segment 82.
    expect(sections[4]).toContain('<a href="/tenders/cb-100-10000001">');
    expect(sections[4]).toContain('<span class="panel-count">1 notice</span>');
    // The API: the key, none used today, and the plan's daily figure.
    expect(sections[5]).toContain("Reports");
    // The holder's plan's figure: Ultra's (api_keyed_spec.ts keyQuota).
    expect(sections[5]).toContain("Requests a day, per key: 50,000");
    // The saved radar search: its six at the buyer, the five ending soonest.
    expect(sections[6]).toContain('<span class="panel-count">6</span>');
    expect(sections[6].match(/<tr>/g)).toHaveLength(1 + PANEL_ROWS);
    expect(sections[6]).toContain("EN578-000000");
    expect(sections[6]).not.toContain("EN578-000005");
    expect(sections[7]).toContain('<span class="panel-count">7</span>');
    // The records search: each source over the last two fiscal years.
    expect(sections[8]).toContain("2025-26");
    expect(sections[8]).toContain("$500,000");
    expect(sections[8]).toContain("$12,345");
    // The view: its first chart at its source and period, named from the records.
    expect(sections[9]).toContain("Award notices, federal fiscal years 2017-18 to 2026-27.");
    expect(sections[9]).toContain('class="chart"');
    // The briefing: the week's counts, one line each.
    expect(sections[10]).toContain('<ul class="plain dash-counts">');
    expect(sections[10].match(/<li>/g)).toHaveLength(4);
    // The segments block: segment 81's award notices.
    expect(sections[11]).toContain("81 Engineering");
    for (const s of sections) {
      expect(s).not.toContain(t("en", "dash.unavailable"));
      expect(s).not.toContain(t("en", "dash.gone"));
    }
    // No filled button in the view; every table fits its column from 700 px.
    expect(main).not.toContain("btn-primary");
    expect(tablesIn(html).length).toBeGreaterThanOrEqual(8);
    expect(misfits(html)).toEqual([]);
    // Twelve held: a thirteenth is refused inside the insert, and the page says so.
    const full = await send(r, "/account/dashboard/panels", { kind: "org", ref: "share" });
    expect(full.headers.get("location")).toBe("/account/dashboard?m=full");
    expect((await panelRows(r.id)).length).toBe(12);
    expect(await text(await open(r, "/account/dashboard?m=full"))).toContain(t("en", "dash.full", { cap: "12" }));
  });

  it("draws the organization's other blocks, half width side by side from 1,280 px with every table in its column", async () => {
    const r = await reader("dash-blocks");
    await send(r, "/account/organization", { org: A1 });
    for (const ref of ["share", "ending", "buyers", "instruments"]) {
      expect((await send(r, "/account/dashboard/panels", { kind: "org", ref })).headers.get("location")).toBe("/account/dashboard?m=added");
    }
    // Every panel half width.
    for (const p of await panelRows(r.id)) await send(r, `/account/dashboard/panels/${p.id}/width`, { wide: "0", from: "edit" });
    expect((await panelRows(r.id)).every((p) => p.wide === 0)).toBe(true);
    const html = await text(await open(r));
    const main = mainOf(html);
    expect(main.match(/class="panel dash-panel dash-half"/g)).toHaveLength(8);
    const sections = main.split(/(?=<section class="panel dash-panel)/).slice(1);
    const at = (title: string) => sections.find((s) => s.includes(title)) ?? "";
    expect(at("Share of a Segment")).toContain("81 Engineering and Research and Technology Based Services · Award notices");
    // Its own share by fiscal year: all of 2025-26's counted value, 30 of 2026-27's 40.
    expect(at("Share of a Segment")).toContain("100%");
    expect(at("Share of a Segment")).toContain("75%");
    expect(at("Share of a Segment")).toContain("Records whose supplier is withheld");
    expect(at("Contracts Ending Within 12 Months")).toContain('<span class="panel-count">6</span>');
    expect(at("Buyers It Has Won From")).toContain('<a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a>');
    expect(at("Standing Offers and Supply Arrangements")).toContain("E60ZT-120002/001/ZT");
    for (const s of sections) expect(s).not.toContain(t("en", "dash.unavailable"));
    // Half a row from 1,280 px: each table's least width in its range within the half track.
    expect(misfits(html)).toEqual([]);
    for (const table of tablesIn(html)) expect(leastWidths(table).lg).toBeLessThanOrEqual(462);
  });

  it("says a panel whose item was removed, offering Remove; a search or briefing removed on its page takes its panel with it", async () => {
    const r = await reader("dash-gone");
    await send(r, "/account/searches", { url: "/tenders?segment=82" });
    await send(r, "/account/searches", { url: "/tenders?segment=72" });
    await send(r, "/account/briefings", { kind: "segment", subject: "81" });
    const first = await searchId(r, "/tenders?segment=82");
    const second = await searchId(r, "/tenders?segment=72");
    const briefing = (await ACCOUNTS.prepare("SELECT id FROM briefings WHERE user_id = ?").bind(r.id).first<{ id: string }>())!.id;
    await send(r, "/account/dashboard/panels", { kind: "briefing", ref: briefing });
    // A search removed behind the page's back (as another tab's delete could leave it): the panel says so.
    await ACCOUNTS.prepare("DELETE FROM saved_searches WHERE id = ?").bind(first).run();
    const html = await text(await open(r));
    const gone = mainOf(html).split(/(?=<section class="panel dash-panel)/).find((s) => s.includes(t("en", "dash.gone")))!;
    expect(gone).toBeDefined();
    expect(gone).toContain("Saved search: open notices");
    expect(gone).toMatch(/<form method="post" action="\/account\/dashboard\/panels\/[0-9a-f]{32}\/delete" class="account-inline">/);
    expect(gone).not.toContain("See all");
    // Removed on the searches page and the briefings panel, each takes its panel.
    const before = (await panelRows(r.id)).length;
    await send(r, `/account/searches/${second}/delete`);
    await send(r, `/account/briefings/${briefing}/delete`);
    const after = await panelRows(r.id);
    expect(after.length).toBe(before - 2);
    expect(after.some((p) => p.ref === second || p.ref === briefing)).toBe(false);
  });

  it("takes every post through the session, the CSRF value and the Origin, in the form bucket, and moves, sizes and removes its own rows only", async () => {
    const r = await reader("dash-posts");
    const other = await reader("dash-posts-other");
    // Without the value, from another site, or without a session: nothing written.
    expect((await post("/account/dashboard/panels", { kind: "watches", ref: "" }, { cookie: r.cookie, env: off() })).status).toBe(403);
    expect((await post("/account/dashboard/panels", { csrf: r.csrf, kind: "watches", ref: "" }, { cookie: r.cookie, env: off(), origin: "https://evil.example" })).status).toBe(403);
    const out = await post("/account/dashboard/panels", { csrf: r.csrf, kind: "watches", ref: "" }, { env: off() });
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/account/sign-in");
    expect(await panelRows(r.id)).toEqual([]);
    // A ref the account does not hold, or a kind the site does not know: refused.
    for (const [kind, ref] of [["tenders", "0".repeat(32)], ["gauges", ""], ["radar", "24m"], ["view", "/buyers/pwgsc-tpsgc/analytics?source=awards"], ["org", "registry"]]) {
      expect((await send(r, "/account/dashboard/panels", { kind, ref })).status, `${kind} ${ref}`).toBe(400);
    }
    // The first change writes the starting layout (the watches, the 3-month list) and applies to it: the second moves up.
    const moved = await send(r, "/account/dashboard/panels/s1/move", { dir: "up", from: "edit" });
    expect(moved.headers.get("location")).toBe("/account/dashboard?edit=1");
    expect((await panelRows(r.id)).map((p) => `${p.kind}:${p.ref}`)).toEqual(["radar:3m", "watches:"]);
    const [a, b] = await panelRows(r.id);
    await send(r, `/account/dashboard/panels/${a.id}/move`, { dir: "down" });
    expect((await panelRows(r.id)).map((p) => p.id)).toEqual([b.id, a.id]);
    await send(r, `/account/dashboard/panels/${a.id}/width`, { wide: "0" });
    expect((await panelRows(r.id)).find((p) => p.id === a.id)?.wide).toBe(0);
    expect((await send(r, `/account/dashboard/panels/${a.id}/width`, { wide: "half" })).status).toBe(400);
    expect((await send(r, `/account/dashboard/panels/${a.id}/move`, { dir: "left" })).status).toBe(400);
    // Another account's post names the id and changes nothing.
    await send(other, `/account/dashboard/panels/${a.id}/delete`);
    expect((await panelRows(r.id)).length).toBe(2);
    await send(r, `/account/dashboard/panels/${a.id}/delete`);
    expect((await panelRows(r.id)).map((p) => p.id)).toEqual([b.id]);
    // The form bucket for the four posts, the page's own GET with the pages.
    for (const path of ["/account/dashboard/panels", `/account/dashboard/panels/${b.id}/move`, `/account/dashboard/panels/${b.id}/width`,
      `/account/dashboard/panels/${b.id}/delete`]) expect(bucketFor("POST", path), path).toBe("form");
    expect(bucketFor("GET", "/account/dashboard")).toBe("page");
    // A Free account's post is sent to the page, which says what the dashboard holds; nothing is written.
    const free = await reader("dash-posts-free", "free");
    const refused = await send(free, "/account/dashboard/panels", { kind: "watches", ref: "" }, sale());
    expect(refused.headers.get("location")).toBe("/account/dashboard");
    expect(await panelRows(free.id)).toEqual([]);
  });

  it("refuses the third briefing and the thirteenth panel inside the insert itself", async () => {
    const r = await reader("dash-caps");
    for (const s of ["81", "43", "72"]) await send(r, "/account/briefings", { kind: "segment", subject: s });
    const ids = ((await ACCOUNTS.prepare("SELECT id FROM briefings WHERE user_id = ? ORDER BY created_at, id").bind(r.id).all<{ id: string }>()).results ?? [])
      .map((x) => x.id);
    expect(ids).toHaveLength(3);
    for (const id of ids.slice(0, BRIEFING_PANELS_MAX)) {
      expect((await send(r, "/account/dashboard/panels", { kind: "briefing", ref: id })).headers.get("location")).toBe("/account/dashboard?m=added");
    }
    const third = await send(r, "/account/dashboard/panels", { kind: "briefing", ref: ids[2] });
    expect(third.headers.get("location")).toBe("/account/dashboard?m=briefings_full");
    expect(await text(await open(r, "/account/dashboard?m=briefings_full"))).toContain(t("en", "dash.briefings_full", { n: "2" }));
    // The statement alone holds both: two inserts at once cannot pass either.
    const insert = (kind: string, ref: string, cap: number) => ACCOUNTS.prepare(ADD_PANEL_SQL)
      .bind(crypto.randomUUID().replace(/-/g, ""), r.id, kind, ref, 1, new Date().toISOString(), cap, BRIEFING_PANELS_MAX).run();
    expect((await insert("briefing", ids[2], DASHBOARD_MAX)).meta.changes).toBe(0);
    const held = (await panelRows(r.id)).length;
    expect((await insert("watches", "x", held)).meta.changes).toBe(0);
    expect((await insert("watches", "x", held + 1)).meta.changes).toBe(1);
    // The same item once.
    expect((await insert("watches", "x", DASHBOARD_MAX)).meta.changes).toBe(0);
    expect(dashboardCap("ultra")).toBe(RULES.ultra.dashboard);
    expect([dashboardCap("free"), dashboardCap("pro")]).toEqual([0, 0]);
  });

  it("in edit mode adds its controls, the Add panel and its one filled button; the plain view has none", async () => {
    const r = await reader("dash-edit");
    await send(r, "/account/searches", { url: "/tenders?segment=82" });
    const view = mainOf(await text(await open(r)));
    expect(view).not.toContain("btn-primary");
    expect(view).toContain('<a href="/account/dashboard?edit=1" class="btn">Edit the dashboard</a>');
    expect(view).not.toContain("dash-controls");
    const edit = mainOf(await text(await open(r, "/account/dashboard?edit=1")));
    expect(edit.match(/btn-primary/g)).toHaveLength(1);
    expect(edit).toContain('<button type="submit" class="btn btn-primary">Add</button>');
    expect(edit).toContain('<a href="/account/dashboard" class="btn">Done</a>');
    expect(edit).toContain(`<h2>${t("en", "dash.add_panel")}</h2>`);
    expect(edit).toContain('<span class="panel-count">3 of 12 panels</span>');
    // The starter's panels carry their places as ids until written; the first has no Move up, the last no Move down.
    expect(edit).toContain('action="/account/dashboard/panels/s0/width"');
    const sections = edit.split(/(?=<section class="panel dash-panel)/).slice(1);
    expect(sections).toHaveLength(3);
    expect(sections[0]).not.toContain(">Move up<");
    expect(sections[0]).toContain(">Move down<");
    expect(sections[1]).toContain(">Move up<");
    expect(sections[2]).not.toContain(">Move down<");
    for (const s of sections) expect(s).toContain(">Half width<");
    // The select offers what the account holds and the dashboard does not show yet.
    expect(edit).toContain('<optgroup label="Contracts ending"><option value="radar:6m">Ending within 6 months</option>');
    expect(edit).not.toContain('value="radar:3m"');
    expect(edit).not.toContain('value="watches:"');
    expect(edit).not.toContain(EM_DASH);
  });

  it("without its table renders the starting layout, says the layout cannot be saved yet, and writes nothing", async () => {
    const r = await reader("dash-unsaved");
    await withoutPanels(async () => {
      const html = await text(await open(r));
      expect(heads(html)).toEqual(["Your watches this week", "Contracts ending | Ending within 3 months"]);
      const edit = mainOf(await text(await open(r, "/account/dashboard?edit=1")));
      expect(edit).toContain(`<p class="muted">${t("en", "dash.unsaved")}</p>`);
      expect(edit).not.toContain("btn-primary");
      expect(edit).not.toContain("dash-controls");
      const add = await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" });
      expect(add.headers.get("location")).toBe("/account/dashboard?m=unsaved");
      const move = await send(r, "/account/dashboard/panels/s0/move", { dir: "down", from: "edit" });
      expect(move.headers.get("location")).toBe("/account/dashboard?edit=1&m=unsaved");
      expect(await text(await open(r, "/account/dashboard?m=unsaved"))).toContain(t("en", "dash.unsaved"));
      // The account's other pages read as before.
      expect((await open(r, "/account/searches")).status).toBe(200);
    });
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
    // Off sale: the account that holds it alone.
    expect(await rail(null, off())).not.toMatch(ITEM);
    expect(await rail(free, off())).not.toMatch(ITEM);
    const held = await rail(ultra, off());
    expect(held).toMatch(ITEM);
    expect(held.indexOf("/account/dashboard")).toBeLessThan(held.indexOf('href="/watchlist"'));
    // On sale: every reader the rail shows an account to.
    for (const r of [null, free, ultra]) expect(await rail(r, sale())).toMatch(ITEM);
    // The dashboard marks its own item.
    expect(await text(await open(ultra))).toMatch(/<a class="rail-item" href="\/account\/dashboard" aria-current="page">/);
    // The switch off: no account, no item, Ultra's variables or not.
    expect(await rail(ultra, { ...offEnv(), ...PRO_SALE })).not.toContain("/account/dashboard");
    expect(await rail(null, { ...ultraEnv(), ACCOUNTS_ENABLED: "false" })).not.toContain("/account/dashboard");
  });
});

describe("Add to dashboard", () => {
  it("is on each analytics view, each saved search a panel can show and each briefing, for an Ultra account alone", async () => {
    const ultra = await reader("dash-add-ultra");
    const pro = await reader("dash-add-pro", "pro");
    for (const r of [ultra, pro]) {
      await send(r, "/account/searches", { url: "/tenders?segment=82" });
      await send(r, "/account/briefings", { kind: "segment", subject: "81" });
    }
    const form = (kind: string) => new RegExp(`<form method="post" action="/account/dashboard/panels" class="account-inline dash-add"><input type="hidden" name="csrf" value="[0-9a-f]{32}"/><input type="hidden" name="kind" value="${kind}"/>`);
    const analytics = async (r: Reader) => text(await get(`/organizations/${A1}/analytics?source=awards&years=5`, { cookie: r.cookie, env: off() }));
    const a = await analytics(ultra);
    expect(a).toMatch(form("view"));
    expect(a).toContain(`<input type="hidden" name="ref" value="/organizations/${A1}/analytics?source=awards&years=5"/>`);
    expect(a).toContain('<button type="submit" class="btn">Add to dashboard</button>');
    expect(await analytics(pro)).not.toContain("account-inline dash-add");
    const searches = await text(await get("/account/searches", { cookie: ultra.cookie, env: off() }));
    expect(searches).toMatch(form("tenders"));
    expect(searches).toMatch(form("briefing"));
    expect(await text(await get("/account/searches", { cookie: pro.cookie, env: off() }))).not.toContain("account-inline dash-add");
    // The view's own address, posted from its page, is stored as the dashboard writes it.
    const res = await send(ultra, "/account/dashboard/panels", { kind: "view", ref: `/organizations/${A1}/analytics?years=5&source=awards&lang=fr` });
    expect(res.headers.get("location")).toBe("/account/dashboard?m=added");
    expect((await panelRows(ultra.id)).map((p) => p.ref)).toContain(`/organizations/${A1}/analytics?source=awards&years=5`);
  });
});

describe("both languages", () => {
  it("draw the page in French with no dash, and every string of the dashboard in both, without a dash", async () => {
    const r = await reader("dash-fr");
    await send(r, "/account/organization", { org: A1 });
    await send(r, "/account/dashboard/panels", { kind: "org", ref: "segments" });
    const html = await text(await open(r, "/account/dashboard?lang=fr&edit=1"));
    const main = mainOf(html);
    expect(main).toContain(`<h1>${norm(t("fr", "dash.title"))}</h1>`);
    expect(main).toContain(norm(t("fr", "dash.kind_org", { block: t("fr", "orgclaim.panel_segments") })));
    expect(main).toContain(">Monter<");
    expect(main).toContain(norm(t("fr", "dash.add_panel")));
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

describe("a panel's ref", () => {
  it("names an analytics view only by its own path, source and period, stored in one form", () => {
    const ok = viewRef(`/buyers/pwgsc-tpsgc/analytics?years=10&source=contracts&segment=81&vs=${A2}&lang=fr`);
    expect(ok).toEqual({ view: "buyer", id: "pwgsc-tpsgc", source: "contracts", years: 10, from: null, to: null });
    expect(viewAddress(ok!)).toBe("/buyers/pwgsc-tpsgc/analytics?source=contracts&years=10");
    const span = viewRef("/segments/81/analytics?source=history&from=2019&to=2022")!;
    expect(viewAddress(span)).toBe("/segments/81/analytics?from=2019&source=history&to=2022");
    expect(viewSpan(span, DAY)).toEqual({ first: 2019, last: 2022, current: 2026 });
    // A span past ULTRA_YEARS keeps its latest; one past the data date stops at its year.
    expect(viewSpan(viewRef("/segments/81/analytics?source=awards&from=2001&to=2030")!, DAY)).toEqual({ first: 2007, last: 2026, current: 2026 });
    for (const bad of [
      "/buyers/pwgsc-tpsgc/analytics", "/buyers/pwgsc-tpsgc/analytics?source=lobbying&years=10", "/segments/99/analytics?source=awards&years=10",
      "/segments/81/analytics?source=contracts&years=10", "/organizations/org-zz/analytics?source=awards&years=10",
      "/buyers/pwgsc-tpsgc/analytics?source=awards&years=7", "/buyers/pwgsc-tpsgc/analytics?source=awards&years=10&evil=1",
      "/buyers/pwgsc-tpsgc/analytics?source=awards&source=grants&years=10", "/buyers/pwgsc-tpsgc/analytics?source=awards&from=2022",
      "/buyers/pwgsc-tpsgc/analytics?source=awards&from=2024&to=2020", "https://evil.example/buyers/pwgsc-tpsgc/analytics?source=awards&years=10",
      "//evil.example/buyers/x/analytics?source=awards&years=10", "/buyers/pwgsc-tpsgc?source=awards&years=10",
    ]) expect(viewRef(bad), bad).toBeNull();
    // Search and briefing ids only the account holds.
    const h = { searches: [{ id: "a".repeat(32), kind: "tenders" }], briefings: [{ id: "b".repeat(32) }] } as never;
    expect(specOf("tenders", "a".repeat(32), h)).toEqual({ kind: "tenders", ref: "a".repeat(32), wide: true });
    expect(specOf("records", "a".repeat(32), h)).toBeNull();
    expect(specOf("briefing", "b".repeat(32), h)?.ref).toBe("b".repeat(32));
    expect(specOf("watches", "x", h)).toBeNull();
  });

  it("reads the radar's rows through its 5-row form of the page's statement, by the window's index", async () => {
    expect(RADAR_TOP_SQL).toBe(RADAR_ROWS_END_SQL.replace(/ LIMIT 100 OFFSET \?13$/, " LIMIT 5"));
    expect(RADAR_TOP_SQL).toMatch(/ ORDER BY endd, kind, k LIMIT 5$/);
    expect(RADAR_TOP_SQL).not.toContain("?13");
    const binds = radarBinds(endingParams(n(A1), claimFrame(DAY)));
    const rows = (await RECORDS.prepare(RADAR_TOP_SQL).bind(...binds).all()).results ?? [];
    expect(rows).toHaveLength(PANEL_ROWS);
    const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${RADAR_TOP_SQL}`).bind(...binds).all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail));
    expect(steps.filter((s) => /^SCAN rec_expiring\b/.test(s) && !/USING/.test(s)), steps.join("\n")).toEqual([]);
    expect(steps.join("\n")).toMatch(/rec_expiring_end/);
  });
});

describe("a panel that cannot be read", () => {
  it("says so, and the others render: the records batch is read panel by panel once it fails", async () => {
    const r = await reader("dash-unreadable");
    await send(r, "/account/organization", { org: A1 });
    await send(r, "/account/dashboard/panels", { kind: "org", ref: "instruments" });
    // The table the instruments block reads, gone (a nightly that has not made it yet).
    await RECORDS.prepare("DROP TABLE rec_holders").run();
    try {
      const html = await text(await open(r));
      const sections = mainOf(html).split(/(?=<section class="panel dash-panel)/).slice(1);
      const instruments = sections.find((s) => s.includes("Standing Offers and Supply Arrangements"))!;
      expect(instruments).toContain(t("en", "dash.unavailable"));
      const others = sections.filter((s) => s !== instruments);
      expect(others.length).toBeGreaterThanOrEqual(4);
      for (const s of others) expect(s).not.toContain(t("en", "dash.unavailable"));
      expect(html).toContain("$300,000");
    } finally {
      await seedRecords();
    }
  });
});

describe("deleting the account", () => {
  it("removes its panels", async () => {
    const r = await reader("dash-delete");
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" });
    expect((await panelRows(r.id)).length).toBeGreaterThan(0);
    const res = await send(r, "/account/delete", { confirm: "yes" });
    expect(res.status).toBe(200);
    expect(await panelRows(r.id)).toEqual([]);
  });
});
