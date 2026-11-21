// The holder's record and may follow where readers already are (slice 3, the
// pages: src/pages/expiring.tsx sectionLines and the ?line= filter,
// src/account/fit_pages.tsx, src/pages/follows.tsx FollowLine; docs/accounts.md,
// Holder's record and May follow), against a local records database built
// from pipeline/records_schema.sql. A reader not signed in gets the radar's
// overview, a profile and a buyer page byte for byte as they were whatever
// rec_lines holds, reads nothing from it, and keeps the public cache; an
// address naming a band is read as if it named none. A signed-in reader gets
// the marks under the holders of the overview's first rows and of a profile's
// and a buyer's contracts ending, within its plan's days, with the
// disclaimer; can narrow a window's full list to one label over the rows its
// plan labels, never past them; and, while FOLLOWS_PANEL is "on", sees under
// each listed matching notice the earlier contract it may follow most
// closely, read in one statement, with the may-follow disclaimer.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { MATCH_PAGE, RULES } from "../src/account/entitlements";
import type { ExpiringRow } from "../src/data";
import { LINE_BANDS, lineLabel, parseLine } from "../src/lines";
import { radarParams, readExpiringQuery } from "../src/pages/expiring";
import { orgNumber } from "../src/records_db";
import { FIRST_FOLLOWS_MAX, FIRST_FOLLOWS_SQL, LINE_BAND_NUMBER, LINE_BAND_SQL, LINES_BY_KEY_SQL, RADAR_LINE_SQL } from "../src/records_tables";
import { ACCOUNTS, csrf, decode, get, grantPro, grantUltra, nbsp, newEmail, onEnv, post, signIn, userId, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { applySql } from "./setup";
import { expectTablesFit } from "./table-fit";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const A1 = "org-a000000001"; // Exemplar Translation Services Inc.
const A2 = "org-a000000002"; // Sample Harbour Marine Ltd.
const PROFILE = `/organizations/${A1}`;
const BUYER = "/buyers/pwgsc-tpsgc";

// -- the radar's rows: the fixtures' 3-month file, then rows of the whole window for the band filter -----------

const base = FILES["expiring/3m/1.json"] as ExpiringRow[];
const award = base.find((r) => r.kind === "award")!;
// An award row of the window, as the export writes it (days_left counted from the data date, 2026-10-31).
const radar = (reference: string, end: string, days: number, org: string | null): ExpiringRow => ({
  ...award, reference, end, days_left: days, organization_id: org, organization: org === A2 ? "Sample Harbour Marine Ltd." : award.organization,
  supplier_withheld: org === null ? true : undefined, tender_reference: null, title_en: `Contract ${reference}`, title_fr: `Contrat ${reference}`,
} as ExpiringRow);
const contractRow = base.find((r) => r.kind === "contract")!;
const historyRow = base.find((r) => r.kind === "history")!;

// The records each row's holder has (rec_lines.j), as lines.py writes them.
const j = (s: Record<string, unknown>[], o: Record<string, unknown> = {}) => JSON.stringify({
  v: 1, fy: [2017, 2026], buyer: "pwgsc-tpsgc", oid: orgNumber(A1), s,
  own: { comp: 1, meth: "OB", bids: null, amd: 0, growth: null, end0: null, end: null }, sim: [], ...o,
});
const src = (o: Record<string, unknown>) => ({ src: 1, lvl: "class", key: ["821118"], held: 1, run: 1, first: "2022-04-01", total: 10, others: 2,
  c: 1, nc: 0, u: 0, ...o });
const EARLIER = j([src({ held: 9, c: 9 })]);
const RUN = j([src({ held: 4, run: 4, c: 4 })]);
const NONE = j([src({})]);
// Two sources: the band is the larger figure of one, never a sum (1 held in one, 3 in the other, 2 back to back).
const EARLIER_TWO = j([src({}), { ...src({ held: 3, run: 2, c: 3 }), src: 3, lvl: "code", key: ["R019"] }]);
const UNCODED = j([]);
const OTHER_FORM = JSON.stringify({ ...JSON.parse(RUN), v: 2 });

// k, the row, its end in rec_expiring, its record (null: none, as for a withheld holder).
const ENDING: [number, ExpiringRow, string | null][] = [
  [1, award, EARLIER],
  [2, contractRow, NONE],
  [3, historyRow, null],
  [4, radar("RADAR-4", "2027-01-05", 66, A1), RUN],
  [5, radar("RADAR-5", "2027-01-25", 86, A2), UNCODED],
  [6, radar("RADAR-6", "2027-06-30", 242, A1), RUN],
  [7, radar("RADAR-7", "2027-01-10", 71, A2), OTHER_FORM],
  [8, radar("RADAR-8", "2026-12-01", 31, A1), EARLIER_TWO],
];
const KIND_N = { award: 1, history: 2, contract: 3 } as const;
const skOf = (r: ExpiringRow) => `${r.kind}:${r.reference}`.toLowerCase();

// -- the matching notices: the fixtures' first open notice under 60 references, each a close match ----------------

const OPEN = FILES["tenders/open.json"] as Record<string, unknown>[];
const NOTICES = Array.from({ length: 60 }, (_, i) => ({
  ...OPEN[0], reference: `cb-900-${String(i).padStart(8, "0")}`, title_en: `Matching notice ${i}`, title_fr: `Avis correspondant ${i}`,
  closing: "2026-11-20T14:00:00",
}));
const tref = (i: number) => `cb-900-${String(i).padStart(8, "0")}`;
const BLOCK = {
  fy: [2022, 2026], n: [7, 3, 12], coded: [7, 3], newest: "2026-09-30",
  classes: [["821118", 5, 2], ["811015", 2, 0]], families: [["8211", 5, 2], ["8110", 2, 0]], segments: [["82", 5, 2], ["81", 2, 0]],
  buyers: [["pwgsc-tpsgc", 4, 3, 0], ["dfo-mpo", 1, 0, 4]], provinces: [["ON", 6, 2], ["QC", 1, 1]], types: [["Request for Proposal", 5, 1]],
  held: [["SA", "82", 1]],
};
const follow = (o: Record<string, unknown>) => JSON.stringify({
  v: 1, src: 1, ref: "cb-725-74465042", t: ["Translation services, regional offices, one (1) year", "Services de traduction, bureaux régionaux"],
  oid: orgNumber(A1), wh: 0, end: "2026-10-23", deg: "close", sol: null, num: null, buyer: "pwgsc-tpsgc", client: 0, lvl: "class",
  code: ["821118"], words: [7, 8], days: -70, from: "start", line: null, ...o,
});
const LONG_TITLE = "Translation and interpretation services for the regional offices of the department, ".repeat(3).trim();
// Notice 0: an ended contract; 1: a withheld holder and no end; 2: rank 2 only, so no line; 3: a contract still running,
// its title long; 55: on a paid plan's second page.
const FOLLOWS: [number, string, number, string][] = [
  [41, tref(0), 1, follow({})],
  [42, tref(0), 2, follow({ ref: "cb-725-00000002", t: ["Second match", null] })],
  [43, tref(1), 1, follow({ src: 2, ref: "w8472-000633", t: ["Translation of reports", "Traduction de rapports"], oid: null, wh: 1, end: null, days: null })],
  [44, tref(2), 2, follow({ ref: "cb-725-00000004" })],
  [45, tref(3), 1, follow({ ref: "cb-691-38891244", t: [LONG_TITLE, null], oid: orgNumber(A2), end: "2027-02-19", days: 88 })],
  [46, tref(55), 1, follow({ ref: "cb-725-00000055", t: ["Page two's match", null] })],
];

async function seed(): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["rec_lines", "rec_meta", "rec_buyers", "rec_orgs", "rec_expiring", "rec_follows"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.batch([
    ...ENDING.map(([k, r]) => {
      const { days_left: _, ...row } = r;
      return RECORDS.prepare("INSERT INTO rec_expiring (k, endd, oid, buyer, client, segs, kind, comp, cad, cents, nv, so, m31, j) " +
        "VALUES (?, ?, ?, 'pwgsc-tpsgc', NULL, ' 82 ', ?, 1, 100000, 100000, 0, 0, 0, ?)")
        .bind(k, r.end.slice(0, 10), r.organization_id && !r.supplier_withheld ? orgNumber(r.organization_id) : null, KIND_N[r.kind], JSON.stringify(row));
    }),
    ...ENDING.filter(([, , line]) => line !== null).map(([k, r, line]) => RECORDS.prepare("INSERT INTO rec_lines (k, sk, j) VALUES (?, ?, ?)").bind(k, skOf(r), line)),
    ...FOLLOWS.map(([k, t, rank, fj]) => RECORDS.prepare("INSERT INTO rec_follows (k, tref, rank, j) VALUES (?, ?, ?, ?)").bind(k, t, rank, fj)),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', '2026-10-31'), ('rules', '2')"),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (101, 'pwgsc-tpsgc', 'Public Services and Procurement Canada', " +
      "'Services publics et Approvisionnement Canada')"),
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, 'Exemplar Translation Services Inc.'), (?, 'Sample Harbour Marine Ltd.')")
      .bind(orgNumber(A1), orgNumber(A2)),
  ]);
}
beforeAll(() => seed());

// -- the environments ----------------------------------------------------------------------------------------

// The 6- and 12-month windows as files (the fixtures publish the 3-month one only), the profile with its block and
// its contract ending in days (20 in the fixtures), the open list of 60 matching notices and the window of the blocks.
const windowFiles = (name: string, rows: ExpiringRow[]) => ({
  [`expiring/${name}/index.json`]: { window: name, pages: 1, rows: rows.length, total: 1_000_000 },
  [`expiring/${name}/1.json`]: rows,
});
function profiles(days = 20): Record<string, unknown> {
  const p = structuredClone(FILES["profiles/a00.json"]) as Record<string, any>;
  p[A1].matching = BLOCK;
  p[A1].expiring.rows = p[A1].expiring.rows.map((r: ExpiringRow) => ({ ...r, days_left: days }));
  return p;
}
type O = { records?: D1Database; follows?: string; days?: number };
const E = (o: O = {}) => onEnv({
  ASSETS: makeFakeAssets({}, {
    ...windowFiles("6m", base), ...windowFiles("12m", base), "profiles/a00.json": profiles(o.days),
    "tenders/open.json": NOTICES, "stats.json": { ...(FILES["stats.json"] as object), matching_fy: [2022, 2026] },
  }),
  ...("records" in o ? { RECORDS: o.records } : {}), ...("follows" in o ? { FOLLOWS_PANEL: o.follows } : {}),
});

// A records binding that reads the database as if the nightly had not made the table yet.
const without = (table: string, db: D1Database = RECORDS): D1Database => ({
  prepare: (sql: string) => db.prepare(sql.replaceAll(table, `${table}_not_made`)),
  batch: (s: D1PreparedStatement[]) => db.batch(s),
}) as unknown as D1Database;
// One that cannot answer.
const failing = { prepare: (sql: string) => RECORDS.prepare(sql), batch: () => Promise.reject(new Error("D1 timed out")) } as unknown as D1Database;
// One that cannot answer a batch naming the table, and answers every other (a buyer page's incumbents).
function failingOn(table: string): D1Database {
  const prepared: string[] = [];
  return {
    prepare: (sql: string) => (prepared.push(sql), RECORDS.prepare(sql)),
    batch: (s: D1PreparedStatement[]) => {
      const these = prepared.splice(0).slice(-s.length);
      return these.some((q) => q.includes(table)) ? Promise.reject(new Error("D1 timed out")) : RECORDS.batch(s);
    },
  } as unknown as D1Database;
}
// One that keeps each batch's statements (records_db.ts readRecords prepares them as it builds the batch).
function recording(db: D1Database = RECORDS): { binding: D1Database; batches: string[][] } {
  const batches: string[][] = [];
  const prepared: string[] = [];
  return {
    binding: {
      prepare: (sql: string) => (prepared.push(sql), db.prepare(sql)),
      batch: (s: D1PreparedStatement[]) => (batches.push(prepared.splice(0).slice(-s.length)), db.batch(s)),
    } as unknown as D1Database,
    batches,
  };
}

let free = "";
let pro = "";
let ultra = "";
let unclaimed = "";
async function claim(email: string): Promise<void> {
  const now = new Date().toISOString();
  await ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?, ?, NULL, '[]', ?, ?)")
    .bind(await userId(email), A1, now, now).run();
}
async function readers(): Promise<void> {
  if (ultra) return;
  const f = newEmail("places-free");
  free = await signIn(f, { env: E() });
  await claim(f);
  const p = newEmail("places-pro");
  pro = await signIn(p, { env: E() });
  await grantPro(p);
  await claim(p);
  const u = newEmail("places-ultra");
  ultra = await signIn(u, { env: E() });
  await grantUltra(u);
  await claim(u);
  unclaimed = await signIn(newEmail("places-none"), { env: E() });
}

const open = async (path: string, o: { env?: object; cookie?: string } = {}) => {
  const res = await get(path, { env: o.env ?? E(), cookie: o.cookie });
  return { res, html: decode(nbsp(await res.text())).replace(/’/g, "'") };
};
const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const marks = (html: string) => [...html.matchAll(/<span class="muted small line-mark">([^<]*)<\/span>/g)].map((m) => m[1]);
const rows = (html: string) => [...html.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((r) => r.includes("<td"));
const rowOf = (html: string, ref: string) => rows(html).find((r) => r.includes(`>${ref}<`)) ?? "";
// The references a radar table lists, in order.
const listed = (html: string) => [...main(html).matchAll(/<span class="mono id muted">([^<]+)<\/span>/g)].map((m) => m[1]);
const LINE_WORDS = /line-mark|Holder's record|Holder&#39;s record|Dossiers du titulaire|line-disclaimer|Under each holder|not available right now|after the next nightly/;
const DISCLAIMER = "Award Watch counts these records from public files. The counts and their labels are not advice and may be wrong or incomplete. See the Terms of Use.";
const FOLLOW_DISCLAIMER = "Award Watch finds these contracts by matching numbers, codes and title words in public records. A match does not mean this notice replaces a contract, is not advice and may be wrong. See the Terms of Use.";
const CREDIT = "Contains information licensed under the Open Government Licence, Canada.";

function carriesDisclaimer(html: string, why: string): void {
  const m = main(html);
  expect(m.replace(/<[^>]+>/g, ""), why).toContain(DISCLAIMER);
  expect(m, why).toContain('<a href="/terms#warranty">Terms of Use</a>');
  expect(m, why).toContain('<a href="/methodology#holders">How the holder\'s record is counted</a>');
  expect(m, why).toContain(CREDIT);
  // Once, at the foot of the list.
  expect(m.match(/line-disclaimer/g), why).toHaveLength(1);
}

// -- the overview, a profile and a buyer page ----------------------------------------------------------------

const PUBLIC_PAGES = ["/expiring", "/expiring?lang=fr", PROFILE, `${PROFILE}?lang=fr`, BUYER, `${BUYER}?lang=fr`, `/organizations/${A2}`];

describe("a reader not signed in", () => {
  it("gets the overview, a profile and a buyer page byte for byte whatever rec_lines holds, public, reading nothing of it", async () => {
    for (const path of PUBLIC_PAGES) {
      const filled = await get(path, { env: E() });
      expect(filled.status, path).toBe(200);
      expect(filled.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(filled.headers.get("vary"), path).toBe("Cookie");
      const body = decode(nbsp(await filled.text()));
      for (const records of [without("rec_lines"), failingOn("rec_lines")]) {
        expect(decode(nbsp(await (await get(path, { env: E({ records }) })).text())), path).toBe(body);
      }
      expect(body, path).not.toMatch(LINE_WORDS);
      expect(body, path).not.toContain("line-signin");
      const { binding, batches } = recording();
      await get(path, { env: E({ records: binding }) });
      expect(batches.flat().join("\n"), path).not.toContain("rec_lines");
    }
  });

  it("gets a window's page with a band in the address as if it named none, and no filter", async () => {
    for (const path of ["/expiring/3m", "/expiring/12m", "/expiring/3m?buyer=pwgsc-tpsgc", "/expiring/6m?lang=fr"]) {
      const join = path.includes("?") ? "&" : "?";
      const banded = await get(`${path}${join}line=run`, { env: E() });
      expect(banded.headers.get("cache-control"), path).toBe("public, max-age=300");
      const body = await banded.text();
      // The address is echoed (the language link, and encoded in the sign-in link's next) and nothing else differs
      // from an address with an unknown key.
      const plain = await (await get(`${path}${join}zz=run`, { env: E() })).text();
      expect(body.replaceAll("line=run", "zz=run").replaceAll("line%3Drun", "zz%3Drun"), path).toBe(plain);
      expect(body, path).not.toMatch(/<select name="line">|<b>Long run<\/b>|<b>Longue série<\/b>/);
    }
    // An unfiltered window reads the static file, and the band adds no read.
    const { binding, batches } = recording();
    await get("/expiring/3m?line=run", { env: E({ records: binding }) });
    expect(batches).toEqual([]);
    // Nor does the matches' file open to anyone without a session.
    expect((await get("/expiring/3m/rows.csv?line=run", { env: E() })).status).toBe(404);
  });
});

describe("a signed-in reader", () => {
  it("sees the marks under the overview's first rows, in one statement, with the disclaimer, on a private page", async () => {
    await readers();
    const { binding, batches } = recording();
    const { res, html } = await open("/expiring", { cookie: free, env: E({ records: binding }) });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // The state row and the rows' records by key: the withheld supplier's row is never asked for.
    expect(batches).toEqual([[expect.stringContaining("FROM rec_meta"), LINES_BY_KEY_SQL]]);
    expect(rowOf(html, "cb-400-40000004")).toContain('<span class="muted small line-mark">Earlier records · 8 earlier</span>');
    expect(rowOf(html, "C-2026-0042")).toContain('<span class="muted small line-mark">No earlier record</span>');
    expect(rowOf(html, "W8472-000777")).not.toContain("line-mark");
    expect(html).toContain("Under each holder's name: its record with the buyer for the same kind of work over the last 10 fiscal years.");
    carriesDisclaimer(html, "overview");
    // The mark sits under the holder's name, in the supplier cell the table already has.
    expect(rowOf(html, "cb-400-40000004")).toMatch(/Exemplar Translation Services Inc\.<\/a><br\/?><span class="muted small line-mark">/);
    const fr = await open("/expiring?lang=fr", { cookie: pro });
    expect(rowOf(fr.html, "cb-400-40000004")).toContain('<span class="muted small line-mark">Dossiers antérieurs · 8 antérieurs</span>');
    expect(main(fr.html)).toContain("Award Watch compte ces dossiers à partir de fichiers publics.");
    for (const page of [html, fr.html]) expectTablesFit(page, "overview with marks");
  });

  it("sees the mark under each contract ending on a profile, as the contract cell's last line, within the plan's days", async () => {
    await readers();
    const { res, html } = await open(PROFILE, { cookie: free });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const section = html.slice(html.indexOf('<h2 id="expiring">'), html.indexOf("</section>", html.indexOf('<h2 id="expiring">')));
    // No supplier column on a profile: the mark closes the contract cell.
    expect(section).not.toContain('data-label="Supplier"');
    expect(section).toMatch(/<td data-label="Contract" class="lead-cell">[\s\S]*<br\/?><span class="muted small line-mark">Earlier records · 8 earlier<\/span><\/td>/);
    // So the line under the table says where the marks stand.
    expect(section).toContain("Under each contract: this organization's record with the contract's buyer for the same kind of work over the last 10 fiscal years.");
    expect(section).not.toContain("Under each holder's name");
    carriesDisclaimer(html, "profile");
    expectTablesFit(html, "profile with a mark");
    // Ending in 120 days: past Free's 91, within Pro's 365.
    const late = await open(PROFILE, { cookie: free, env: E({ days: 120 }) });
    expect(marks(late.html)).toEqual([]);
    expect(main(late.html)).not.toMatch(LINE_WORDS);
    expect(marks((await open(PROFILE, { cookie: pro, env: E({ days: 120 }) })).html)).toEqual(["Earlier records · 8 earlier"]);
    // A profile without contracts ending reads nothing.
    const { binding, batches } = recording();
    await open(`/organizations/${A2}`, { cookie: pro, env: E({ records: binding }) });
    expect(batches.flat().join("\n")).not.toContain("rec_lines");
  });

  it("sees the mark under each named holder of a buyer page's contracts ending, in one statement more", async () => {
    await readers();
    const out = recording();
    await get(BUYER, { env: E({ records: out.binding }) });
    const { binding, batches } = recording();
    const { res, html } = await open(BUYER, { cookie: free, env: E({ records: binding }) });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // The page's own reads, then the records of the rows ending.
    expect(batches.length).toBe(out.batches.length + 1);
    expect(batches.filter((b) => b.includes(LINES_BY_KEY_SQL))).toEqual([[expect.stringContaining("FROM rec_meta"), LINES_BY_KEY_SQL]]);
    const section = html.slice(html.indexOf('<h2 id="expiring">'), html.indexOf("</section>", html.indexOf('<h2 id="expiring">')));
    expect(section).toMatch(/Exemplar Translation Services Inc\.<\/a><br\/?><span class="muted small line-mark">Earlier records · 8 earlier<\/span>/);
    carriesDisclaimer(html, "buyer");
    expectTablesFit(html, "buyer with a mark");
  });

  it("gets each of the three pages as it was while the records database holds no rec_lines, and a line when it cannot answer", async () => {
    await readers();
    for (const path of ["/expiring", PROFILE, BUYER]) {
      const absent = await open(path, { cookie: pro, env: E({ records: without("rec_lines") }) });
      expect(absent.res.status, path).toBe(200);
      expect(main(absent.html), path).not.toMatch(LINE_WORDS);
      const down = await open(path, { cookie: pro, env: E({ records: failingOn("rec_lines") }) });
      expect(down.res.status, path).toBe(200);
      expect(main(down.html), path).toContain("The holders' records are not available right now.");
      expect(marks(down.html), path).toEqual([]);
    }
  });

  it("adds no chip and no filled button where the marks show", async () => {
    await readers();
    const count = (html: string, re: RegExp) => main(html).match(re)?.length ?? 0;
    for (const path of ["/expiring", PROFILE, BUYER]) {
      const shown = (await open(path, { cookie: free })).html;
      const before = (await open(path, { cookie: free, env: E({ records: without("rec_lines") }) })).html;
      expect(shown, path).not.toBe(before);
      expect(count(shown, /class="pro-tag"/g), path).toBe(count(before, /class="pro-tag"/g));
      expect(count(shown, /btn-primary/g), path).toBe(count(before, /btn-primary/g));
    }
  });
});

// -- the band filter on a window's full list ------------------------------------------------------------------

describe("the holder's record filter", () => {
  it("numbers the label in SQL as the page reads it, each source apart, and a record of another form or without a kind of work in none", async () => {
    const found = (await RECORDS.prepare(`SELECT l.sk AS sk, l.j AS j, ${LINE_BAND_SQL} AS band FROM rec_lines l ORDER BY l.k LIMIT 20`).all()).results ?? [];
    expect(found.length).toBe(7);
    for (const r of found) {
      const parsed = parseLine(r.j);
      const label = parsed ? lineLabel(parsed) : null;
      // The form is checked beside the band in the statement (lineWhere), so a row of another form is read apart here.
      const other = JSON.parse(String(r.j)).v !== 1;
      expect(other ? null : r.band, String(r.sk)).toBe(label ? LINE_BAND_NUMBER[label.band] : null);
      if (!other) expect(parsed, String(r.sk)).not.toBeNull();
    }
    expect(LINE_BANDS).toEqual(["run", "earlier", "none"]);
  });

  it("is offered to a Free reader on the 3-month list, and narrows the whole window to one label", async () => {
    await readers();
    const { res, html } = await open("/expiring/3m?line=run", { cookie: free });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain('<span class="field-label">Holder\'s record</span><select name="line"><option value="">All</option>' +
      '<option value="run" selected="">Long run</option><option value="earlier">Earlier records</option><option value="none">No earlier record</option></select>');
    expect(listed(html)).toEqual(["RADAR-4"]);
    expect(marks(html)).toEqual(["Long run · 4 back to back"]);
    carriesDisclaimer(html, "band run");
    // The chip, its link without the band, and the heads and pages keeping it.
    expect(html).toContain('<a class="fchip" href="/expiring/3m" aria-label="Remove filter: Long run"><span>Holder\'s record</span> <b>Long run</b>');
    expect(html).toContain('href="/expiring/3m?line=run&sort=end"');
    // A filtered view is not indexed and names no canonical address, as the window's other filters.
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).not.toContain('rel="canonical"');
    // Earlier records: one source holding 9, and one holding 3 beside another holding 1 (never added).
    expect(listed((await open("/expiring/3m?line=earlier", { cookie: free })).html)).toEqual(["cb-400-40000004", "RADAR-8"]);
    // No earlier record: the withheld holder, the uncoded record and the record of another form are in no band.
    expect(listed((await open("/expiring/3m?line=none", { cookie: free })).html)).toEqual(["C-2026-0042"]);
    // With the other filters and an order.
    expect(listed((await open("/expiring/3m?line=earlier&sort=end-desc", { cookie: free })).html)).toEqual(["RADAR-8", "cb-400-40000004"]);
    expect(listed((await open(`/expiring/3m?line=earlier&supplier=${A2}`, { cookie: free })).html)).toEqual([]);
    // A value that is no band reads as no filter.
    expect(listed((await open("/expiring/3m?line=strong", { cookie: free })).html)).toEqual(["cb-400-40000004", "W8472-000777", "C-2026-0042"]);
    const fr = await open("/expiring/3m?line=earlier&lang=fr", { cookie: free });
    expect(fr.html).toContain('<span class="field-label">Dossiers du titulaire</span><select name="line"><option value="">Tous</option>');
    expect(fr.html).toContain("<span>Dossiers du titulaire</span> <b>Dossiers antérieurs</b>");
    for (const page of [html, fr.html]) expectTablesFit(page, "band filter");
  });

  it("reads in the window's one batch, the rows and their count through the band's statements", async () => {
    await readers();
    const { binding, batches } = recording();
    await open("/expiring/3m?line=run", { cookie: free, env: E({ records: binding }) });
    // The window's batch (the state row and six statements), then the marks of the rows shown.
    expect(batches.map((b) => b.length)).toEqual([7, 2]);
    expect(RADAR_LINE_SQL).toContain(batches[0][1]);
    expect(RADAR_LINE_SQL).toContain(batches[0][2]);
    expect(batches[1][1]).toBe(LINES_BY_KEY_SQL);
  });

  it("never reaches past the plan's days: Free's deeper windows set it aside as their other filters, Pro's read to 365 days", async () => {
    await readers();
    const teaser = await open("/expiring/12m?line=run", { cookie: free });
    expect(teaser.html).toContain("Filters and later pages are part of Pro, so this address shows the window's first contracts.");
    expect(teaser.html).not.toContain('<select name="line">');
    expect(teaser.html).not.toContain("RADAR-6");
    expect((await get("/expiring/3m/rows.csv?line=run", { cookie: free, env: E() })).status).toBe(404);
    // Pro: the 12-month list's long runs, the one past 91 days included.
    const twelve = await open("/expiring/12m?line=run", { cookie: pro });
    expect(listed(twelve.html)).toEqual(["RADAR-4", "RADAR-6"]);
    expect(marks(twelve.html)).toEqual(["Long run · 4 back to back", "Long run · 4 back to back"]);
    expect(listed((await open("/expiring/12m?line=run", { cookie: ultra })).html)).toEqual(["RADAR-4", "RADAR-6"]);
    // The statements end where the plan's labels end, whatever the window.
    const q = { ...readExpiringQuery(new URL("https://awardwatch.ca/expiring/12m")), line: "run" as const };
    expect(radarParams("12m", "2026-10-31", q, 91)).toMatchObject({ last: "2027-01-30", line: 2 });
    expect(radarParams("12m", "2026-10-31", q, 365)).toMatchObject({ last: "2027-10-31", line: 2 });
    // Without the plan's days no band is read.
    expect(radarParams("12m", "2026-10-31", q).line).toBeUndefined();
    expect(radarParams("12m", "2026-10-31", q).last).toBe("2027-10-31");
  });

  it("sends Pro the matches' file with the band applied and no label in it", async () => {
    await readers();
    const res = await get("/expiring/12m/rows.csv?line=earlier", { cookie: pro, env: E() });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    expect(text.trim().split("\r\n").slice(1).map((l) => l.split(",")[1])).toEqual(["cb-400-40000004", "RADAR-8"]);
    expect(text).not.toMatch(/Earlier records|Long run|No earlier record|back to back/i);
    const page = await open("/expiring/12m?line=earlier", { cookie: pro });
    expect(page.html).toContain('href="/expiring/12m/rows.csv?line=earlier" rel="nofollow">');
  });

  it("is kept out of a saved search and the email lists, as the organization and client filters are", async () => {
    const email = newEmail("places-save");
    const cookie = await signIn(email, { env: E() });
    const address = "/expiring/3m?line=run&buyer=pwgsc-tpsgc";
    const { html } = await open(address, { cookie });
    // The email list's form carries the filter rebuilt from the address, without the band.
    expect(html).toContain('<input type="hidden" name="params" value="/expiring/3m?buyer=pwgsc-tpsgc"/>');
    // Save this search posts the address; the searches page saves the filter it rebuilds, which holds no band.
    expect(html).toContain(`<input type="hidden" name="url" value="${address}"/>`);
    const res = await post("/account/searches", { csrf: await csrf(cookie, "/account", { env: E() }), lang: "en", url: address, next: address },
      { cookie, env: E() });
    expect(res.status).toBe(303);
    const saved = await ACCOUNTS.prepare("SELECT params FROM saved_searches WHERE user_id = ?").bind(await userId(email)).all();
    expect((saved.results ?? []).map((r) => r.params)).toEqual(["/expiring/3m?buyer=pwgsc-tpsgc"]);
  });

  it("is set aside, with a line saying so, while the records database holds no rec_lines or cannot answer", async () => {
    await readers();
    const absent = await open("/expiring/3m?line=run", { cookie: free, env: E({ records: without("rec_lines") }) });
    expect(absent.res.status).toBe(200);
    expect(listed(absent.html)).toEqual(["cb-400-40000004", "RADAR-8", "W8472-000777", "RADAR-4", "RADAR-7", "C-2026-0042", "RADAR-5"]);
    expect(absent.html).toContain("The holder's record filter is not available right now; the list shows every contract.");
    expect(absent.html).not.toContain("<b>Long run</b>");
    expect(absent.html).toContain('<option value="run">Long run</option>');
    const down = await open("/expiring/3m?line=run", { cookie: free, env: E({ records: failing }) });
    expect(down.res.status).toBe(200);
    expect(down.html).toContain("The holder's record filter is not available right now; the list shows every contract.");
    // A view without a band reads as it did.
    const plain = await open("/expiring/3m?sort=end", { cookie: free, env: E({ records: without("rec_lines") }) });
    expect(plain.html).not.toContain("filter is not available");
    const fr = await open("/expiring/3m?line=run&lang=fr", { cookie: free, env: E({ records: without("rec_lines") }) });
    expect(fr.html).toContain("Le filtre des dossiers du titulaire n'est pas offert pour le moment; la liste présente tous les contrats.");
  });

  it("joins the window's rows to rec_lines by key, one look-up each through the primary key, bounded", async () => {
    expect(RADAR_LINE_SQL).toHaveLength(18);
    const binds: (string | number)[] = ["2026-10-31", "2027-10-31", "", "", -1, "", -1, -1, -1, 0, 1, 1];
    for (const sql of RADAR_LINE_SQL) {
      const prov = sql.includes("rec_expiring_prov");
      const n = Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
      expect(n, sql).toBe((prov ? 15 : 13) + (sql.includes("OFFSET") ? 1 : 0));
      expect(sql, sql).toMatch(new RegExp(`LIMIT \\d+( OFFSET \\?${prov ? 16 : 14})?$`));
      const all = [...binds, ...(prov ? ["BC", 1] : []), 2, 0];
      const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...all.slice(0, n)).all()).results ?? [])
        .map((r) => String((r as { detail?: unknown }).detail));
      const text = steps.join("\n");
      expect(steps.filter((s) => /^SCAN (rec_expiring|rec_lines|l)\b/.test(s) && !/USING/.test(s)), `${sql}\n${text}`).toEqual([]);
      expect(text, `${sql}\n${text}`).toMatch(/SEARCH l USING INTEGER PRIMARY KEY \(rowid=\?\)/);
      expect(text, `${sql}\n${text}`).toMatch(/rec_expiring_end|INTEGER PRIMARY KEY/);
    }
  });
});

// -- the matching notices -----------------------------------------------------------------------------------

const MATCHES = "/account/matches";
const followIn = (part: string) => [...part.matchAll(/<span class="muted small follow-line">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
const followLines = (html: string) => followIn(main(html));
const noticeCell = (html: string, i: number) =>
  rows(html).find((r) => r.includes(`<a href="/tenders/${tref(i)}">`)) ?? "";

describe("the matching notices", () => {
  it("carry under each listed notice its closest earlier contract, in one statement, for Free on its rows", async () => {
    await readers();
    const { binding, batches } = recording();
    const { res, html } = await open(MATCHES, { cookie: free, env: E({ records: binding }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(batches).toEqual([[expect.stringContaining("FROM rec_meta"), FIRST_FOLLOWS_SQL]]);
    expect(rows(html)).toHaveLength(RULES.free.matches);
    expect(noticeCell(html, 0)).toContain('<br/><span class="muted small follow-line">May follow <a href="/tenders/cb-900-00000000#follows">' +
      "Translation services, regional offices, one (1) year</a> (Exemplar Translation Services Inc.), ended 2026-10-23</span>");
    // A withheld holder is named by no one; a record without an end ends at its holder.
    expect(noticeCell(html, 1)).toContain('May follow <a href="/tenders/cb-900-00000001#follows">Translation of reports</a> (Individual, name withheld)</span>');
    // Rank 2 alone shows nothing; a contract still running "ends", its long title cut.
    expect(noticeCell(html, 2)).not.toContain("follow-line");
    const third = followIn(noticeCell(html, 3))[0];
    expect(third).toMatch(/^May follow <a href="\/tenders\/cb-900-00000003#follows">Translation and interpretation services [^<]*…<\/a> \(Sample Harbour Marine Ltd\.\), ends 2027-02-19$/);
    expect(followLines(html)).toHaveLength(3);
    // The line comes after the buyer and notice type.
    expect(noticeCell(html, 0)).toMatch(/Public Services and Procurement Canada · Request for Proposal<\/span><br\/?><span class="muted small follow-line">/);
    // The disclaimer block gains may follow's, once, beside the matches'.
    const m = main(html);
    expect(m.replace(/<[^>]+>/g, "")).toContain(FOLLOW_DISCLAIMER);
    expect(m.match(/follow-disclaimer/g)).toHaveLength(1);
    expect(m).toContain('<a href="/methodology#follows">How earlier contracts are matched</a>');
    expect(m.indexOf("follow-disclaimer")).toBeLessThan(m.indexOf("<h2>Open Notices That Match</h2>"));
    expect(m).toContain(CREDIT);
    expectTablesFit(html, "matches with may follow");
  });

  it("carry it on each row of a paid plan's page, the page's notices only, in French too", async () => {
    await readers();
    for (const cookie of [pro, ultra]) {
      const first = await open(MATCHES, { cookie });
      expect(rows(first.html)).toHaveLength(MATCH_PAGE);
      expect(followLines(first.html)).toHaveLength(3);
      expect(first.html).not.toContain("Page two's match");
      const second = await open(`${MATCHES}?page=2`, { cookie });
      expect(followLines(second.html)).toEqual(['May follow <a href="/tenders/cb-900-00000055#follows">Page two\'s match</a> (Exemplar Translation Services Inc.), ended 2026-10-23']);
    }
    const fr = await open(`${MATCHES}?lang=fr`, { cookie: pro });
    expect(followLines(fr.html)[0]).toBe('Pourrait faire suite à <a href="/tenders/cb-900-00000000#follows">Services de traduction, bureaux régionaux</a> ' +
      "(Exemplar Translation Services Inc.), terminé le 2026-10-23");
    expect(followLines(fr.html)[1]).toContain("(Particulier, nom non divulgué)");
    expect(main(fr.html).replace(/<[^>]+>/g, "")).toContain("Award Watch trouve ces contrats en rapprochant les numéros");
    expectTablesFit(fr.html, "matches fr");
    expect(FIRST_FOLLOWS_MAX).toBe(MATCH_PAGE);
    expect(RULES.free.matches).toBeLessThanOrEqual(FIRST_FOLLOWS_MAX);
  });

  it("leave the page as it was, reading nothing, while FOLLOWS_PANEL is off; as it was too without rec_follows", async () => {
    await readers();
    for (const cookie of [free, pro]) {
      const { binding, batches } = recording();
      const off = await (await get(MATCHES, { cookie, env: E({ follows: "off", records: binding }) })).text();
      expect(batches).toEqual([]);
      expect(off).not.toMatch(/follow-line|follow-disclaimer|May follow|not available right now/);
      const absent = await (await get(MATCHES, { cookie, env: E({ records: without("rec_follows") }) })).text();
      expect(absent).toBe(off);
    }
    // An account without a claim lists nothing and reads nothing.
    const { binding, batches } = recording();
    await get(MATCHES, { cookie: unclaimed, env: E({ records: binding }) });
    expect(batches).toEqual([]);
  });

  it("say in a line when the records database cannot answer, with no disclaimer for lines it does not show", async () => {
    await readers();
    const { res, html } = await open(MATCHES, { cookie: free, env: E({ records: failing }) });
    expect(res.status).toBe(200);
    expect(main(html)).toContain('<p class="muted small">Earlier contracts are not available right now.</p>');
    expect(followLines(html)).toEqual([]);
    expect(html).not.toContain("follow-disclaimer");
  });

  it("add no chip and no filled button", async () => {
    await readers();
    const count = (html: string, re: RegExp) => main(html).match(re)?.length ?? 0;
    for (const cookie of [free, pro]) {
      const shown = (await open(MATCHES, { cookie })).html;
      const before = (await open(MATCHES, { cookie, env: E({ follows: "off" }) })).html;
      expect(shown).not.toBe(before);
      expect(count(shown, /class="pro-tag"/g)).toBe(count(before, /class="pro-tag"/g));
      expect(count(shown, /btn-primary/g)).toBe(count(before, /btn-primary/g));
    }
  });

  it("read rank 1 through rec_follows_tref, bounded to a page's notices", async () => {
    expect(FIRST_FOLLOWS_SQL).toMatch(new RegExp(`LIMIT ${MATCH_PAGE}$`));
    const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${FIRST_FOLLOWS_SQL}`).bind(JSON.stringify([tref(0), tref(1)])).all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    expect(steps.join("\n")).toMatch(/rec_follows_tref \(tref=\? AND rank=\?\)/);
    expect(steps.filter((s) => /^SCAN (f|rec_follows)\b/.test(s)), steps.join("\n")).toEqual([]);
  });
});
