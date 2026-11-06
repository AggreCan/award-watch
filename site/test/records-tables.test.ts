// The records backbone's other readers (src/records_tables.ts) against a real
// local D1 database built from pipeline/records_schema.sql and filled as the
// nightly sync fills it. Every figure checked is worked out here from the
// rows, never read back from the page's own arithmetic.
//
// The page of a published contract (src/pages/published.tsx): its fields in
// both languages, the other rows of the same contract, the address (a
// department and an escaped reference), the 404s, the database missing or
// loading, one batch per page, the plan; and the radar rows and profile rows
// that link their titles to it.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { orgNumber } from "../src/records_db";
import { bucketFor } from "../src/limits";
import {
  BUYER_INCUMBENTS_SQL, CONTRACT_VERSIONS_MAX, EARLIER_AWARDS_SQL, ORG_FEED_SQL, PUBLISHED_CONTRACT_SQL, RADAR_PAGE_ROWS, SEGMENT_INCUMBENTS_SQL, TABLE_SQL,
} from "../src/records_tables";
import { recordHref, recordTitle, shownReference } from "../src/pages/records";
import { contractPath } from "../src/pages/shared";
import { get, grantPro, newEmail, offEnv, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const DND = 102;
const A1 = "org-a000000001";
const FIRST = "C-2026-2027-Q1-00096";
const SECOND = "C-2026-2027-Q2-00097";
const SLASHED = "W8486-123456/001/ZM";

interface Contract {
  k: number; ref: string; pid: string | null; oid: number | null; wh: 0 | 1; cdate: string; endd: string | null; value: number | null;
  orig: number | null; amend: number | null; inst: string; counted: number | null; vnote: number; desc_en: string | null; desc_fr: string | null;
  com_en?: string | null;
}
const CONTRACTS: Contract[] = [
  { k: 1001, ref: FIRST, pid: "P-77", oid: orgNumber(A1), wh: 0, cdate: "2026-04-10", endd: "2026-12-15", value: 10_000_000, orig: 10_000_000,
    amend: null, inst: "C", counted: 10_000_000, vnote: 0, desc_en: "Translation services", desc_fr: "Services de traduction",
    com_en: "Two-year term.\n\nOption years not exercised." },
  { k: 1002, ref: SECOND, pid: "P-77", oid: orgNumber(A1), wh: 0, cdate: "2026-08-01", endd: "2027-02-28", value: 13_000_000, orig: null,
    amend: 3_000_000, inst: "A", counted: 3_000_000, vnote: 0, desc_en: "Translation services", desc_fr: "Services de traduction" },
  // A person's contract: no organization, its value flagged for checking, ended.
  { k: 1003, ref: SLASHED, pid: null, oid: null, wh: 1, cdate: "2024-02-01", endd: "2025-01-31", value: 4_500_000, orig: 4_500_000,
    amend: null, inst: "C", counted: null, vnote: 3, desc_en: "Snow removal", desc_fr: null },
];

// The radar's 12-month window as rec_expiring holds it (the data date is
// 2026-10-31, so the 3-month window ends 2027-01-30).
interface Ending {
  k: number; end: string; kind: "award" | "history" | "contract"; oid: string | null; buyer: string; client: string; value: number | null;
  comp: 0 | 1 | null; so?: boolean; m31?: boolean; segs?: string[];
}
// The fixtures' 3-month window file is the one the site has; contract 4
// carries the March 31 mark whatever its date, and contract 6 ends after the
// 3-month window.
const ENDING: Ending[] = [
  { k: 1, end: "2026-11-15", kind: "award", oid: A1, buyer: "pwgsc-tpsgc", client: "dnd-mdn", value: 250_000, comp: 1, segs: ["80"] },
  { k: 2, end: "2026-12-01", kind: "history", oid: null, buyer: "dnd-mdn", client: "dnd-mdn", value: 40_000, comp: 0 },
  { k: 3, end: "2027-01-10", kind: "contract", oid: A1, buyer: "dnd-mdn", client: "dnd-mdn", value: 1_500_000, comp: 0, so: true },
  { k: 4, end: "2027-01-20", kind: "award", oid: "org-b000000001", buyer: "pwgsc-tpsgc", client: "hc-sc", value: 9_000_000, comp: 1, m31: true, segs: ["43", "81"] },
  { k: 5, end: "2027-01-25", kind: "award", oid: A1, buyer: "pwgsc-tpsgc", client: "hc-sc", value: null, comp: null },
  { k: 6, end: "2027-06-30", kind: "award", oid: A1, buyer: "pwgsc-tpsgc", client: "dnd-mdn", value: 5_000, comp: 1 },
  // Four organizations in segment 82 at Fisheries and Oceans, after the 3-month window: the incumbents' tease.
  ...[1, 2, 3, 4].map((i): Ending => ({
    k: 6 + i, end: `2027-0${4 + i}-01`, kind: "award", oid: `org-c00000000${i}`, buyer: "dfo-mpo", client: "dfo-mpo", value: i * 1_000_000, comp: 1,
    segs: ["82"],
  })),
];
const KIND_N = { award: 1, history: 2, contract: 3 } as const;
function endingRow(e: Ending): Record<string, unknown> {
  return {
    kind: e.kind, reference: e.kind === "contract" ? `dnd-mdn:C-${e.k}` : `RADAR-${e.k}`, title_en: `Contract ${e.k}`, title_fr: `Contrat ${e.k}`,
    organization_id: e.oid, organization: e.oid ? `Org ${e.oid.slice(-1)}` : null, supplier_withheld: e.oid === null, buyer_id: e.buyer,
    buyer_en: e.buyer, buyer_fr: null, start: "2025-01-01", end: e.end, value: e.value, currency: "CAD", competitive: e.comp,
    method_en: null, method_fr: null, instrument_en: e.so ? "Standing offer" : "Contract", instrument_fr: null, n_amendments: 0, value_growth: null,
    segments: e.segs ?? [], provinces: [], client_buyer_id: e.client, client_buyer_name: e.client === "hc-sc" ? "Health Canada" : "National Defence",
  };
}

// The record tables' rows (rec_details): the profile's organization at three
// buyers and in four sources, one record before the ten fiscal years, and
// another organization at each buyer.
const PSPC = 101;
const B1 = "org-b000000001";
interface Detail { k: number; src: number; day: string; bid: number; oid: string; cents: number | null; comp: 0 | 1 | null; meth: string | null; ref: string; title: string }
const DETAILS: Detail[] = [
  { k: 11, src: 1, day: "2026-06-01", bid: PSPC, oid: A1, cents: 25_000_000, comp: 1, meth: "OB", ref: "cb-400-1", title: "Translation standing offer" },
  { k: 12, src: 3, day: "2026-04-10", bid: DND, oid: A1, cents: 10_000_000, comp: 0, meth: "TN", ref: `dnd-mdn:${FIRST}`, title: "Translation services" },
  { k: 13, src: 4, day: "2025-05-01", bid: DND, oid: A1, cents: 4_000_000, comp: null, meth: null, ref: "dnd-mdn:G-1", title: "Research grant" },
  { k: 14, src: 2, day: "2016-05-01", bid: PSPC, oid: A1, cents: 1_000_000, comp: 1, meth: "OB", ref: "w8472-000001", title: "Before the ten years" },
  { k: 15, src: 3, day: "2026-09-01", bid: DND, oid: B1, cents: 50_000_000, comp: 1, meth: "OB", ref: "dnd-mdn:C-9", title: "Other supplier at Defence" },
  { k: 16, src: 2, day: "2026-08-01", bid: PSPC, oid: B1, cents: 7_000_000, comp: 1, meth: "TC", ref: "w8472-000777", title: "Other supplier at PSPC" },
];

async function seed(state = "ready"): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["records", "rec_orgs", "rec_buyers", "rec_contracts", "rec_gsin", "rec_meta", "rec_expiring", "rec_details", "rec_classes"]
    .map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  // The UNSPSC classes of the PSPC records: 821118 (translation), as the open notice cb-100-10000001 carries.
  await RECORDS.batch([11, 16, 14].map((rk) => RECORDS.prepare("INSERT INTO rec_classes (k, rk, cls, bid, day) VALUES (?, ?, 821118, ?, ?)")
    .bind(1000 + rk, rk, PSPC, DETAILS.find((d) => d.k === rk)!.day)));
  await RECORDS.batch(DETAILS.map((d) => RECORDS.prepare(
    "INSERT INTO rec_details (k, src, day, bid, oid, cents, vnote, comp, meth, ref, title_en, title_fr) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)",
  ).bind(d.k, d.src, d.day, d.bid, orgNumber(d.oid), d.cents, d.comp, d.meth, d.ref, d.title, `FR ${d.title}`)));
  await RECORDS.batch(ENDING.map((e) => RECORDS.prepare(
    "INSERT INTO rec_expiring (k, endd, oid, buyer, client, segs, kind, comp, cad, cents, nv, so, m31, j) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(e.k, e.end, e.oid ? orgNumber(e.oid) : null, e.buyer, e.client, e.segs?.length ? ` ${e.segs.join(" ")} ` : "", KIND_N[e.kind], e.comp,
    e.value === null ? null : e.value * 100, e.value === null ? null : e.value * 100, e.value === null ? 1 : 0, e.so ? 1 : 0,
    e.m31 ? 1 : 0, JSON.stringify(endingRow(e)))));
  await RECORDS.batch([
    ...CONTRACTS.map((c) => RECORDS.prepare(
      "INSERT INTO rec_contracts (k, dept, ref, pid, bid, oid, wh, cdate, start, endd, value, orig, amend, proc, comp, ctype, gsin, agr, trade, ltr, " +
      "inst, period, bids, so_no, desc_en, desc_fr, com_en, com_fr) VALUES (?, 'dnd-mdn', ?, ?, ?, ?, ?, ?, '2026-04-15', ?, ?, ?, ?, 'TN', 0, 'S', " +
      "'R019BF', '0', 'CA, WT', '71', ?, '2026-2027-Q1', 1, NULL, ?, ?, ?, NULL)",
    ).bind(c.k, c.ref, c.pid, DND, c.oid, c.wh, c.cdate, c.endd, c.value, c.orig, c.amend, c.inst, c.desc_en, c.desc_fr, c.com_en ?? null)),
    ...CONTRACTS.map((c) => RECORDS.prepare("INSERT INTO records (k, src, fy, fq, bid, oid, extra, cents, vnote, comp, meth) VALUES (?, 3, 2026, 1, ?, ?, 0, ?, ?, 0, 'TN')")
      .bind(c.k, DND, c.oid, c.counted, c.vnote)),
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, 'Exemplar Translation Services Inc.')").bind(orgNumber(A1)),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dnd-mdn', 'National Defence', 'Défense nationale')").bind(DND),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (103, 'hc-sc', 'Health Canada', 'Santé Canada')"),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'pwgsc-tpsgc', 'Public Services and Procurement Canada', NULL)").bind(PSPC),
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, 'Rival One Inc.')").bind(orgNumber(B1)),
    RECORDS.prepare("INSERT INTO rec_gsin (k, code, desc_en, desc_fr) VALUES (1, 'R019BF', 'Translation services', 'Services de traduction')"),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', ?), ('as_of', '2026-10-31'), ('rules', '2')").bind(state),
  ]);
}

beforeAll(() => seed());

const page = async (path: string, o: { env?: object } = {}) => {
  const res = await get(path, { env: o.env ?? offEnv() });
  return { res, html: decode(nbsp(await res.text())) };
};

// A D1 binding that counts the batches it runs and their statements.
function counting(db: D1Database): { binding: D1Database; batches: number[] } {
  const batches: number[] = [];
  const binding = {
    prepare: (sql: string) => db.prepare(sql),
    batch: (statements: D1PreparedStatement[]) => {
      batches.push(statements.length);
      return db.batch(statements);
    },
  } as unknown as D1Database;
  return { binding, batches };
}

describe("a published contract's page", () => {
  it("shows the department, the organization, the amounts, the dates, the procedure and the source, from one batch", async () => {
    const { binding, batches } = counting(RECORDS);
    const { res, html } = await page(contractPath("dnd-mdn", SECOND), { env: { ...offEnv(), RECORDS: binding } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(batches).toEqual([2]);
    expect(html).toContain("<h1>Translation services</h1>");
    expect(html).toContain(`href="/organizations/${A1}">Exemplar Translation Services Inc.</a>`);
    expect(html).toContain('href="/buyers/dnd-mdn">National Defence</a>');
    // The row's own figures, and the contract's: 100,000 counted on the original, 30,000 on the amendment.
    for (const figure of ["$130,000", "$30,000", "$100,000"]) expect(html, figure).toContain(figure);
    expect(html).toMatch(/Value counted, all versions<\/dt>\s*<dd>\$130,000/);
    expect(html).toContain("2026-08-01");
    expect(html).toContain("2026-2027-Q1");
    // Ends 2027-02-28, 120 days after the data date: the 6-month window, as the contract's newest version.
    expect(html).toContain('href="/expiring/6m" class="small">120 days left</a>');
    expect(html).toContain('<span class="mono">TN</span> Non-competitive');
    expect(html).toContain('<span class="mono">A</span> Amendment');
    expect(html).toContain('<span class="mono">S</span> Services');
    expect(html).toContain('<span class="mono">R019BF</span> Translation services');
    expect(html).toContain('<span class="mono">CA, WT</span>');
    expect(html).toContain('<span class="mono">P-77</span>');
    // The other row of the contract, linked; this one marked newest.
    expect(html).toContain(`href="${contractPath("dnd-mdn", FIRST)}">${FIRST}</a>`);
    expect(html).toMatch(new RegExp(`<strong>${SECOND}</strong> <span class="tag">Newest</span>`));
    // The source: the government's search for the reference, a secondary link, and the dataset.
    expect(html).toContain(`href="https://search.open.canada.ca/contracts/?search_text=${SECOND}" class="btn" rel="nofollow noopener"`);
    expect(html).toContain("dataset/d8f85d91-7dec-4fd1-8055-483b77225d8b");
    expect(html).toContain("as of the records of 2026-10-31");
    expect(html).toContain(`<link rel="canonical" href="https://awardwatch.ca${contractPath("dnd-mdn", SECOND)}"`);
    expect(html).not.toContain(EM_DASH);
  });

  it("reads an older version's window from the newest one, and prints the comments as paragraphs", async () => {
    const { html } = await page(contractPath("dnd-mdn", FIRST));
    expect(html).toContain("2026-12-15");
    expect(html).not.toContain('href="/expiring/3m" class="small"');
    expect(html).toContain("The radar reads a contract's end from its newest version");
    expect(html).toContain("<p>Two-year term.</p><p>Option years not exercised.</p>");
    expect(html).toContain(`href="${contractPath("dnd-mdn", SECOND)}">${SECOND}</a> <span class="tag">Newest</span>`);
  });

  it("reads in French", async () => {
    const { html } = await page(`${contractPath("dnd-mdn", SECOND)}?lang=fr`);
    expect(html).toContain("Contrat publié");
    expect(html).toContain("<h1>Services de traduction</h1>");
    expect(html).toContain(">Défense nationale</a>");
    expect(html).toContain("130 000 $");
    expect(html).toContain("Recherche de contrats sur ouvert.canada.ca");
    expect(html).toContain('<span class="mono">A</span> Modification');
    expect(html).not.toContain("Value counted");
  });

  it("takes a reference with a slash in it, and names no one for a person's contract", async () => {
    const path = contractPath("dnd-mdn", SLASHED);
    expect(path).toBe("/contracts/dnd-mdn/W8486-123456%2F001%2FZM");
    const { res, html } = await page(path);
    expect(res.status).toBe(200);
    expect(html).toContain("Individual, name withheld");
    expect(html).toContain("Flagged for checking, left out of totals");
    expect(html).toContain("ended 2025-01-31");
    expect(html).not.toContain("Versions of This Contract");
    // The same reference with its slashes unescaped reaches the same page.
    expect((await page(`/contracts/dnd-mdn/${SLASHED}`)).res.status).toBe(200);
  });

  it("answers a reference it does not hold with a 404 that links the search, and a malformed address with the site's 404", async () => {
    const missing = await page("/contracts/dnd-mdn/C-2026-2027-Q3-99999");
    expect(missing.res.status).toBe(404);
    expect(missing.res.headers.get("Cache-Control")).toBe("no-store");
    expect(missing.html).toContain("Published Contract Not Found");
    expect(missing.html).toContain('href="https://search.open.canada.ca/contracts/?search_text=C-2026-2027-Q3-99999"');
    // The same reference under another department is another contract.
    expect((await page(contractPath("pwgsc-tpsgc", SECOND))).res.status).toBe(404);
    for (const path of ["/contracts/Not%20A%20Department/X-1", `/contracts/dnd-mdn/${"x".repeat(201)}`, "/contracts/dnd-mdn/A%07B", "/contracts/dnd-mdn"]) {
      const { res, html } = await page(path);
      expect(res.status, path).toBe(404);
      expect(html, path).not.toContain("Published Contract Not Found");
    }
  });

  it("offers its end as a calendar file beside the end date (pages/ics.ts), its other rows as the event's sequence", async () => {
    const ics = `${contractPath("dnd-mdn", SECOND)}.ics`;
    expect((await page(contractPath("dnd-mdn", SECOND))).html).toContain(`<a href="${ics}" class="small" rel="nofollow">Add to calendar</a>`);
    const res = await get(ics, { env: offEnv() });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const text = (await res.text()).replace(/\r\n /g, "");
    expect(text).toContain(`UID:contract-contract-dnd-mdn:${SECOND.toLowerCase()}@awardwatch.ca`);
    expect(text).toContain("SEQUENCE:1");
    expect(text).toContain("DTSTART;VALUE=DATE:20270228");
    expect(text).toContain("DTEND;VALUE=DATE:20270301");
    expect(text).toContain("SUMMARY:Ends: Exemplar Translation Services Inc. · National Defence · Translation services");
    expect(text).not.toContain(EM_DASH);
    // An ended contract's page has no link; its file still names no person.
    expect((await page(contractPath("dnd-mdn", SLASHED))).html).not.toContain(".ics");
    const person = (await (await get(`${contractPath("dnd-mdn", SLASHED)}.ics`, { env: offEnv() })).text()).replace(/\r\n /g, "");
    expect(person).toContain("SUMMARY:Ends: Individual\\, name withheld · National Defence · Snow removal");
    expect((await get("/contracts/dnd-mdn/C-2026-2027-Q3-99999.ics", { env: offEnv() })).status).toBe(404);
    expect((await get("/contracts/Not%20A%20Department/X-1.ics", { env: offEnv() })).status).toBe(404);
  });

  it("sends a department in capitals to its lower-case address", async () => {
    const res = await get(`/contracts/DND-MDN/${SECOND}?lang=fr`, { env: offEnv() });
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe(`${contractPath("dnd-mdn", SECOND)}?lang=fr`);
  });

  it("answers 503 with the search when the records database is missing or loading", async () => {
    const none = await page(contractPath("dnd-mdn", SECOND), { env: { ...offEnv(), RECORDS: undefined } });
    expect(none.res.status).toBe(503);
    expect(none.res.headers.get("Cache-Control")).toBe("no-store");
    expect(none.res.headers.get("Retry-After")).toBe("3600");
    expect(none.html).toContain("This page is not available right now");
    expect(none.html).toContain(`search_text=${SECOND}`);
    await seed("loading");
    try {
      const loading = await page(contractPath("dnd-mdn", SECOND));
      expect(loading.res.status).toBe(503);
      expect(loading.html).not.toContain("$130,000");
      // Each page says what returns: this page, or the record table, not "the analytics".
      expect(loading.html).toContain("This page returns when the load is finished");
      const table = (await page(`/organizations/${A1}/records`)).html;
      expect(table).toContain("The record table returns when the load is finished.");
      expect(table + loading.html).not.toContain("analytics return");
      expect((await page(`/organizations/${A1}/records?lang=fr`)).html).toContain("Le tableau des dossiers reviendra");
    } finally {
      await seed();
    }
  });

  it("reads through the indexes and is bounded", async () => {
    for (const sql of TABLE_SQL) expect(sql, sql).toMatch(/LIMIT \d+( OFFSET \?\d+)?$/);
    expect(PUBLISHED_CONTRACT_SQL).toContain(`LIMIT ${CONTRACT_VERSIONS_MAX + 1}`);
    const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${PUBLISHED_CONTRACT_SQL}`).bind("dnd-mdn", SECOND).all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    const text = steps.join("\n");
    // No table is read whole; the row comes through (dept, ref), its versions through (dept, pid, cdate).
    expect(steps.filter((s) => /^SCAN (c|b|o|r|g|records|rec_\w+)\b/.test(s)), text).toEqual([]);
    expect(text).toContain("rec_contracts_ref");
    expect(text).toContain("rec_contracts_group");
  });
});

describe("the links to it", () => {
  it("go from the radar's title and the profile's published contracts", async () => {
    const radar = await page("/expiring/3m");
    expect(radar.html).toContain(`href="${contractPath("dnd-mdn", "C-2026-0042")}">Satellite communications terminal maintenance</a>`);
    // The government's search stays in the Record column.
    expect(radar.html).toContain('href="https://search.open.canada.ca/contracts/?search_text=C-2026-0042"');
    const profile = await page(`/organizations/${A1}`);
    expect(profile.html).toContain(`href="${contractPath("dfo-mpo", "C-2026-000")}">Translation services</a>`);
  });
});

describe("the radar over its whole window", () => {
  const titles = (html: string) => [...html.matchAll(/>Contract (\d)<\/a>/g)].map((m) => Number(m[1]));

  it("filters by organization and client department across the window, with the count and total of the matches", async () => {
    const { res, html } = await page(`/expiring/3m?supplier=${A1}`);
    expect(res.status).toBe(200);
    // Contracts 1, 3 and 5 name the organization within 3 months (6 ends later); 5 has no value.
    expect(titles(html)).toEqual([1, 3, 5]);
    expect(html).toContain("3 contracts match");
    expect(html).toContain("the whole window: 3 of its");
    expect(html).toContain("worth $1,750,000");
    expect(html).toContain("1 of them published no value");
    expect(html).toContain('<meta name="robots" content="noindex');
    const client = await page("/expiring/3m?client=hc-sc");
    expect(titles(client.html)).toEqual([4, 5]);
    expect(client.html).toMatch(/<option value="hc-sc" selected="">Health Canada \(2\)<\/option>/);
    // The marks: March 31 and standing offers, left out on request.
    expect(titles((await page("/expiring/3m?fye=0&sosa=0&sort=value")).html)).toEqual([1, 2, 5]);
  });

  it("sorts by value, largest first, and pages the matches", async () => {
    expect(titles((await page("/expiring/3m?sort=value")).html)).toEqual([4, 3, 1, 2, 5]);
    expect((await page("/expiring/3m?sort=value&page=2")).res.status).toBe(404);
    expect(RADAR_PAGE_ROWS).toBe(100);
  });

  it("orders the whole window by end date and by value either way from the table's heads, the rows without a value last", async () => {
    expect(titles((await page("/expiring/3m?sort=end")).html)).toEqual([1, 2, 3, 4, 5]);
    expect(titles((await page("/expiring/3m?sort=end-desc")).html)).toEqual([5, 4, 3, 2, 1]);
    expect(titles((await page("/expiring/3m?sort=value-asc")).html)).toEqual([2, 1, 3, 4, 5]);
    const { html } = await page(`/expiring/3m?supplier=${A1}&sort=value-asc`);
    expect(titles(html)).toEqual([1, 3, 5]);
    // The heads: Value ascending, its link the next order with the filter kept; Ends the start of its own.
    expect(html).toContain(`<th class="k-value num" aria-sort="ascending"><a href="/expiring/3m?supplier=${A1}&sort=value" class="th-sort" rel="nofollow">Value</a></th>`);
    expect(html).toContain(`<th class="k-date"><a href="/expiring/3m?supplier=${A1}&sort=end" class="th-sort" rel="nofollow">Ends on</a></th>`);
    // The matches' file keeps the order shown.
    const email = newEmail("pro-radar-order");
    const pro = await signIn(email);
    await grantPro(email);
    const res = await get(`/expiring/3m/rows.csv?supplier=${A1}&sort=value-asc`, { cookie: pro, env: onEnv() });
    expect(res.status).toBe(200);
    expect((await res.text()).trim().split("\r\n").slice(1).map((l) => l.split(",")[1])).toEqual(["RADAR-1", "C-3", "RADAR-5"]);
  });

  it("filters the window file's page as before when the records database cannot answer", async () => {
    const { res, html } = await page(`/expiring/3m?supplier=${A1}`, { env: { ...offEnv(), RECORDS: undefined } });
    expect(res.status).toBe(200);
    expect(html).toContain("The filters apply to the");
    expect(html).not.toContain("the whole window");
  });

  it("makes the matches' CSV file Pro's, and the site's 404 for anyone else or with the switch off", async () => {
    expect(bucketFor("GET", "/expiring/3m/rows.csv")).toBe("download");
    expect((await get(`/expiring/3m/rows.csv?supplier=${A1}`, { env: offEnv() })).status).toBe(404);
    const free = await signIn(newEmail("free-radar"));
    expect((await get(`/expiring/3m/rows.csv?supplier=${A1}`, { cookie: free, env: onEnv() })).status).toBe(404);
    const freePage = decode(nbsp(await (await get(`/expiring/3m?supplier=${A1}`, { cookie: free, env: onEnv() })).text()));
    expect(freePage).toContain("These contracts as a CSV file, in the order shown, are part of Pro.");
    expect(freePage).toContain('href="/account/billing"');
    const email = newEmail("pro-radar");
    const pro = await signIn(email);
    await grantPro(email);
    const proPage = decode(nbsp(await (await get(`/expiring/3m?supplier=${A1}&sort=value`, { cookie: pro, env: onEnv() })).text()));
    expect(proPage).toContain(`href="/expiring/3m/rows.csv?supplier=${A1}&sort=value" rel="nofollow">Download these contracts (CSV)</a>`);
    const res = await get(`/expiring/3m/rows.csv?supplier=${A1}&sort=value`, { cookie: pro, env: onEnv() });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("kind,reference,title_en,title_fr,organization_id,organization,buyer_id,buyer_en,buyer_fr,client_buyer_id,client_buyer_name,start,end,days_left,value,currency,competitive,method_en,instrument_en,n_amendments,value_growth,segments,provinces,value_flag");
    expect(lines.slice(1).map((l) => l.split(",")[1])).toEqual(["C-3", "RADAR-1", "RADAR-5"]);
    expect(lines[1]).toContain(",2027-01-10,71,1500000,CAD,0,");
  });

  it("reads every statement through the window's index, bounded", async () => {
    for (const sql of TABLE_SQL) expect(sql, sql).toMatch(/LIMIT \d+( OFFSET \?\d+)?$/);
    const binds: (string | number)[] = ["2026-10-31", "2027-10-31", "", "", -1, "", -1, -1, -1, 0, 1, 1, 0];
    for (const sql of TABLE_SQL.filter((q) => q.includes("FROM rec_expiring"))) {
      const n = Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
      const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds.slice(0, n)).all()).results ?? [])
        .map((r) => String((r as { detail?: unknown }).detail));
      const text = steps.join("\n");
      expect(steps.filter((s) => /^SCAN (rec_expiring|records|rec_\w+)\b/.test(s) && !/USING/.test(s)), `${sql}\n${text}`).toEqual([]);
      expect(text, sql).toMatch(/rec_expiring_(end|buyer|client)/);
    }
  });
});

describe("the record tables", () => {
  const order = (html: string) => [...html.matchAll(/rel="nofollow(?: noopener)?">([^<]+)<\/a><br\/><span class="mono id muted">/g)].map((m) => m[1]);
  const ORG = `/organizations/${A1}/records`;

  it("list a profile's records over ten fiscal years, newest first, each linked to its page, with the count and total", async () => {
    const { res, html } = await page(ORG);
    expect(res.status).toBe(200);
    expect(order(html)).toEqual(["Translation standing offer", "Translation services", "Research grant"]);
    expect(html).toContain("3 records");
    expect(html).toContain('fiscal years <span class="nw">2017-18</span> to <span class="nw">2026-27</span>.');
    expect(html).toContain("Value counted: $390,000.");
    expect(html).toContain('href="/awards/cb-400-1"');
    expect(html).toContain(`href="${contractPath("dnd-mdn", FIRST)}"`);
    expect(html).toContain('href="https://search.open.canada.ca/grants/record/dnd-mdn%2CG-1%2Ccurrent"');
    expect(html).toContain('href="/buyers/dnd-mdn">National Defence</a>');
    expect(html).toContain('<meta name="robots" content="noindex');
    expect(html).not.toContain(EM_DASH);
    // Switch off: the whole table for everyone, and no file.
    expect(html).toContain('<select name="buyer">');
    expect(html).not.toContain("records.csv");
    expect((await get(`${ORG}.csv`, { env: offEnv() })).status).toBe(404);
    expect(bucketFor("GET", `${ORG}.csv`)).toBe("download");
    // The profile links it.
    expect((await page(`/organizations/${A1}`)).html).toContain(`href="${ORG}" class="btn" rel="nofollow">Record table</a>`);
  });

  it("filter by fiscal year, buyer, source and method, order by value, and page", async () => {
    expect(order((await page(`${ORG}?source=contracts`)).html)).toEqual(["Translation services"]);
    expect(order((await page(`${ORG}?buyer=dnd-mdn`)).html)).toEqual(["Translation services", "Research grant"]);
    expect(order((await page(`${ORG}?year=2025`)).html)).toEqual(["Research grant"]);
    expect(order((await page(`${ORG}?method=TN`)).html)).toEqual(["Translation services"]);
    expect(order((await page(`${ORG}?sort=largest`)).html)).toEqual(["Translation standing offer", "Translation services", "Research grant"]);
    // A year outside the ten reads as all ten; one page only.
    expect(order((await page(`${ORG}?year=2016`)).html)).toHaveLength(3);
    expect((await page(`${ORG}?page=2`)).res.status).toBe(404);
    expect((await page(`${ORG}?page=x`)).res.status).toBe(404);
    const fr = await page(`${ORG}?lang=fr`);
    expect(fr.html).toContain("FR Translation services");
    expect(fr.html).toContain("Dossiers de");
  });

  it("order by date and by value either way from the Date and Value heads, the other heads plain, and give a free reader plain heads", async () => {
    expect(order((await page(`${ORG}?sort=oldest`)).html)).toEqual(["Research grant", "Translation services", "Translation standing offer"]);
    expect(order((await page(`${ORG}?sort=smallest`)).html)).toEqual(["Research grant", "Translation services", "Translation standing offer"]);
    const plain = (await page(ORG)).html;
    expect(plain).toContain('data-sorting="server"');
    expect(plain).toContain(`<th class="k-date"><a href="${ORG}?sort=oldest" class="th-sort" rel="nofollow">Date</a></th>`);
    expect(plain).toContain(`<th class="k-value num"><a href="${ORG}?sort=smallest" class="th-sort" rel="nofollow">Value</a></th>`);
    expect(plain).toContain('<th class="k-main">Record</th>');
    expect(plain).not.toContain("aria-sort");
    // Descending is the table's own order shown on its head; the next click leaves the order, the filter kept.
    const newest = (await page(`${ORG}?buyer=dnd-mdn&sort=newest`)).html;
    expect(order(newest)).toEqual(["Translation services", "Research grant"]);
    expect(newest).toContain(`<th class="k-date" aria-sort="descending"><a href="${ORG}?buyer=dnd-mdn" class="th-sort" rel="nofollow">Date</a></th>`);
    expect(newest).toContain(`<a href="${ORG}?buyer=dnd-mdn&sort=smallest" class="th-sort"`);
    expect((await page(`${ORG}?sort=smallest`)).html).toContain('<option value="smallest" selected="">Value, smallest first</option>');
    // A free reader's view keeps the newest first: no head offers an order it would not get.
    const free = await signIn(newEmail("free-records-heads"));
    const freeHtml = decode(nbsp(await (await get(`${ORG}?sort=smallest`, { cookie: free, env: onEnv() })).text()));
    expect(freeHtml).toContain('data-sorting="server"');
    expect(freeHtml).not.toContain("th-sort");
    expect(order(freeHtml)).toEqual(["Translation standing offer", "Translation services", "Research grant"]);
  });

  it("list a buyer's records by organization", async () => {
    const buyer = await page("/buyers/pwgsc-tpsgc/records");
    expect(buyer.res.status).toBe(200);
    expect(order(buyer.html)).toEqual(["Other supplier at PSPC", "Translation standing offer"]);
    expect(buyer.html).toContain(`href="/organizations/${B1}">Rival One Inc.</a>`);
    expect(order((await page(`/buyers/pwgsc-tpsgc/records?organization=${A1}`)).html)).toEqual(["Translation standing offer"]);
    expect((await page("/buyers/pwgsc-tpsgc")).html).toContain('href="/buyers/pwgsc-tpsgc/records" class="btn" rel="nofollow">Record table</a>');
    expect((await page("/buyers/no-such-buyer/records")).res.status).toBe(404);
    expect((await page("/organizations/org-ffffffffff/records")).res.status).toBe(404);
  });

  it("give a free reader the newest page and what Pro adds, and Pro the filters and the file", async () => {
    const free = await signIn(newEmail("free-records"));
    const freeHtml = decode(nbsp(await (await get(`${ORG}?source=grants`, { cookie: free, env: onEnv() })).text()));
    expect(order(freeHtml)).toEqual(["Translation standing offer", "Translation services", "Research grant"]);
    expect(freeHtml).toContain("The filters and later pages are set aside here.");
    expect(freeHtml).not.toContain('<select name="buyer">');
    expect((await get(`${ORG}?page=2`, { cookie: free, env: onEnv() })).status).toBe(404);
    expect((await get(`${ORG}.csv`, { cookie: free, env: onEnv() })).status).toBe(404);
    const email = newEmail("pro-records");
    const pro = await signIn(email);
    await grantPro(email);
    const proHtml = decode(nbsp(await (await get(`${ORG}?buyer=dnd-mdn`, { cookie: pro, env: onEnv() })).text()));
    expect(proHtml).toContain(`href="${ORG}.csv?buyer=dnd-mdn" rel="nofollow">Download these records (CSV)</a>`);
    const res = await get(`${ORG}.csv?buyer=dnd-mdn`, { cookie: pro, env: onEnv() });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("date,source,reference,title_en,title_fr,buyer_id,buyer,organization_id,organization,value_cad,value_note,competitive,method");
    expect(lines.slice(1).map((l) => l.split(",").slice(0, 3).join(","))).toEqual([`2026-04-10,contracts,${FIRST}`, "2025-05-01,grants,G-1"]);
  });

  it("read rec_details through its indexes", async () => {
    const binds: (string | number)[] = [orgNumber(A1) as number, "2017-04-01", "2027-03-31", 0, "", "", 0];
    for (const sql of TABLE_SQL.filter((q) => q.includes("FROM rec_details"))) {
      const n = Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
      const b = sql.includes("SELECT bid FROM rec_buyers WHERE id = ?1") ? ["pwgsc-tpsgc", ...binds.slice(1)] : binds;
      const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...b.slice(0, n)).all()).results ?? [])
        .map((r) => String((r as { detail?: unknown }).detail));
      const text = steps.join("\n");
      expect(steps.filter((s) => /^SCAN (d|rec_details|records|rec_\w+)\b/.test(s) && !/USING/.test(s)), `${sql}\n${text}`).toEqual([]);
      expect(text, sql).toMatch(/rec_details_(org|buyer)/);
    }
  });
});

describe("the earlier awards, the incumbents and the organization feeds", () => {
  it("list an open notice's buyer's earlier records of its UNSPSC class, the closest titles first, for every reader", async () => {
    const { html } = await page("/tenders/cb-100-10000001");
    const panel = html.split("Earlier Awards Like This One")[1] ?? "";
    expect(panel).toContain("Up to 10 records of this buyer");
    // Within ten fiscal years only (the 2016 record is out), "translation" first.
    const titles = [...panel.matchAll(/<a href="([^"]+)">([^<]+)<\/a><br\/><span class="muted small">/g)].map((m) => m[2]);
    expect(titles).toEqual(["Translation standing offer", "Other supplier at PSPC"]);
    expect(panel).toContain('href="/awards/cb-400-1"');
    // Another buyer's notice of other classes: the panel says there is none.
    expect((await page("/tenders/cb-200-20005019")).html).toContain("No record of this buyer in the last 10 fiscal years shares a UNSPSC class");
    // Without the database the notice stands, and says so.
    const none = await page("/tenders/cb-100-10000001", { env: { ...offEnv(), RECORDS: undefined } });
    expect(none.res.status).toBe(200);
    expect(none.html).toContain("Earlier awards are not available right now.");
  });

  it("show who holds a buyer's and a segment's contracts ending within 12 months, three rows for a reader without Pro", async () => {
    const buyer = await page("/buyers/pwgsc-tpsgc");
    const panel = buyer.html.split("Who Holds the Contracts Ending Within 12 Months")[1] ?? "";
    // B1: one contract of $9,000,000; A1: three, $255,000 counted (one with no value), the soonest 2026-11-15.
    expect(panel).toMatch(/Rival One Inc\.<\/a>[^]*?>1<\/a>[^]*?\$9,000,000[^]*?2027-01-20/);
    expect(panel).toMatch(new RegExp(`href="/expiring/12m\\?buyer=pwgsc-tpsgc&supplier=${A1}" rel="nofollow">3</a>[^]*?\\$255,000[^]*?2026-11-15`));
    const segment = (await page("/segments/82")).html.split("Who Holds the Contracts")[1] ?? "";
    expect([...segment.matchAll(/href="\/organizations\/(org-c\d+)"/g)].map((m) => m[1])).toEqual(
      ["org-c000000004", "org-c000000003", "org-c000000002", "org-c000000001"]);
    const free = await signIn(newEmail("free-incumbents"));
    const tease = decode(nbsp(await (await get("/segments/82", { cookie: free, env: onEnv() })).text())).split("Who Holds the Contracts")[1] ?? "";
    expect([...tease.matchAll(/href="\/organizations\/(org-c\d+)"/g)]).toHaveLength(3);
    expect(tease).toContain("The first 3 are shown. The whole list is part of Pro.");
    const email = newEmail("pro-incumbents");
    const pro = await signIn(email);
    await grantPro(email);
    const full = decode(nbsp(await (await get("/segments/82", { cookie: pro, env: onEnv() })).text())).split("Who Holds the Contracts")[1] ?? "";
    expect([...full.matchAll(/href="\/organizations\/(org-c\d+)"/g)]).toHaveLength(4);
    expect(full).not.toContain("part of Pro");
  });

  it("serve an organization's newest records as Atom, cached an hour, in the feed bucket", async () => {
    const path = `/data/feeds/organizations/${A1}.xml`;
    expect(bucketFor("GET", path)).toBe("feed");
    const res = await get(path, { env: offEnv() });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/atom+xml; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
    const body = await res.text();
    expect(body).toContain(`<id>tag:awardwatch.ca,2026:feeds/organizations/${A1}</id>`);
    expect([...body.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]).slice(1)).toEqual([
      "Translation standing offer / FR Translation standing offer", "Translation services / FR Translation services", "Research grant / FR Research grant",
    ]);
    expect(body).toContain(`href="https://awardwatch.ca${contractPath("dnd-mdn", FIRST)}"`);
    expect(body).not.toContain("Before the ten years");
    expect((await get("/data/feeds/organizations/org-ffffffffff.xml", { env: offEnv() })).status).toBe(404);
    expect((await get("/data/feeds/organizations/not-an-id.xml", { env: offEnv() })).status).toBe(404);
    expect((await page(`/organizations/${A1}`)).html).toContain(`href="${path}" class="btn" rel="nofollow">Records feed</a>`);
  });

  it("read rec_classes and rec_expiring through their indexes", async () => {
    const cases: [string, (string | number)[], RegExp][] = [
      [EARLIER_AWARDS_SQL, ["pwgsc-tpsgc", "2017-04-01", 821118, -1, -1, -1, -1, -1], /rec_classes_class/],
      [BUYER_INCUMBENTS_SQL, ["pwgsc-tpsgc", "2026-10-31", "2027-10-31"], /rec_expiring_(end|buyer|client)/],
      [SEGMENT_INCUMBENTS_SQL, [" 82 ", "2026-10-31", "2027-10-31"], /rec_expiring_end/],
      [ORG_FEED_SQL, [orgNumber(A1) as number, "2017-04-01"], /rec_details_org/],
    ];
    for (const [sql, binds, index] of cases) {
      const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all()).results ?? [])
        .map((r) => String((r as { detail?: unknown }).detail));
      const text = steps.join("\n");
      expect(steps.filter((x) => /^SCAN (c|d|rec_\w+|records)\b/.test(x) && !/USING/.test(x)), `${sql}\n${text}`).toEqual([]);
      expect(text, sql).toMatch(index);
    }
  });
});

// An award reference whose URL form another reference took first has no page
// here: records.ref is null and rec_details.ref reads ":" and the reference
// as published (records_db.text_rows), so no row links the other record's page.
describe("a record with no page here", () => {
  it("is never linked: the reference is read after the empty department, and a missing title falls back to it", () => {
    expect(recordHref(1, ":PW-ZZ-1")).toBeNull();
    expect(recordHref(2, ":W8472/1")).toBeNull();
    expect(recordHref(1, "pw-zz-1")).toBe("/awards/pw-zz-1");
    expect(recordHref(3, ":C-1")).toBeNull();
    expect(recordHref(3, "dnd-mdn:C-1")).toBe(contractPath("dnd-mdn", "C-1"));
    expect(shownReference(":PW-ZZ-1")).toBe("PW-ZZ-1");
    expect(shownReference("dnd-mdn:C-1")).toBe("C-1");
    expect(recordTitle("en", {}, ":PW-ZZ-1")).toBe("PW-ZZ-1");
    expect(recordTitle("fr", {}, ":")).toBe("Non indiqué");
  });

  it("shows its title unlinked and its reference as text in the record table, the earlier awards and the feed", async () => {
    const feed = new Request(`https://awardwatch.ca/data/feeds/organizations/${A1}.xml`);
    const edge = (globalThis as { caches?: { default?: Cache } }).caches?.default;
    await RECORDS.batch([
      RECORDS.prepare("INSERT INTO rec_details (k, src, day, bid, oid, cents, vnote, comp, meth, ref, title_en, title_fr) " +
        "VALUES (17, 1, '2026-07-01', ?, ?, 2000000, 0, 1, 'OB', ':PW-ZZ-1', 'Translation of manuals', 'FR Translation of manuals')").bind(PSPC, orgNumber(A1)),
      RECORDS.prepare("INSERT INTO rec_classes (k, rk, cls, bid, day) VALUES (1017, 17, 821118, ?, '2026-07-01')").bind(PSPC),
    ]);
    await edge?.delete(feed);
    try {
      const cell = 'class="lead-cell">Translation of manuals<br/><span class="mono id muted">PW-ZZ-1</span>';
      const table = (await page(`/organizations/${A1}/records`)).html;
      expect(table).toContain(cell);
      expect(table).not.toMatch(/href="\/awards\/pw-zz-1"/);
      expect((await page(`/organizations/${A1}/records?lang=fr`)).html).toContain('class="lead-cell">FR Translation of manuals<br/>');
      const earlier = (await page("/tenders/cb-100-10000001")).html.split("Earlier Awards Like This One")[1] ?? "";
      expect(earlier).toContain(cell);
      expect(earlier).not.toContain("pw-zz-1");
      const body = await (await get(`/data/feeds/organizations/${A1}.xml`, { env: offEnv() })).text();
      const entry = body.split("<entry>").find((e) => e.includes("Translation of manuals")) ?? "";
      expect(entry).toContain("<id>tag:awardwatch.ca,2026:records/1/:PW-ZZ-1</id>");
      expect(entry).toContain("<title>Translation of manuals / FR Translation of manuals</title>");
      expect(entry).not.toContain("<link");
      expect(entry).toMatch(/<content type="text">[^<]+ · PW-ZZ-1<\/content>/);
      // The other three entries keep their links.
      expect(body.split("<entry>").slice(1).filter((e) => e.includes("<link")).length).toBe(3);
    } finally {
      await RECORDS.batch([RECORDS.prepare("DELETE FROM rec_details WHERE k = 17"), RECORDS.prepare("DELETE FROM rec_classes WHERE k = 1017")]);
      await edge?.delete(feed);
    }
  });
});
