// Standing offers and supply arrangements (src/instruments.ts,
// src/pages/instruments.tsx, docs/sosa.md): the index from its static file
// with its filters, sort and pages; the instrument page from a real local D1
// built from pipeline/records_schema.sql, with holders linked to a profile,
// holders with no profile and holders withheld as persons; the profile's line
// and section, the segment and buyer blocks and the tender notice's line from
// the parts the export adds to their files; the two CSV files Pro's and the
// pages free; both languages and no em-dash; and every statement's plan.
// Then the layout of the file as published in 2026: types
// as acronyms, UNSPSC commodity codes in literal quotes, and delivery point
// codes the data dictionary does not list (CA, RCNNCR, countries).
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import {
  HOLDERS_CSV_SQL, HOLDERS_SQL, INSTRUMENT_SQL, INSTRUMENT_STATEMENTS, commodityList, filterInstruments, instrumentPath, readInstrumentQuery,
  sortInstruments, type InstrumentRow,
} from "../src/instruments";
import { regionName, typeCodeOf } from "../src/pages/instruments";
import { bucketFor } from "../src/limits";
import { PRO_INCLUDES } from "../src/pro";
import { orgNumber } from "../src/records_db";
import { routeTemplate } from "../src/views";
import { decode, get, grantPro, nbsp, newEmail, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);

const RMSO = "E60ZT-120002/001/ZT";
const SA = "E60ZT-120003/001/ZT";
const NMSO = "EZ899-250380/001/ZM";
const SECRET = "E60ZT-999999/001/ZT";
const NISO = "CW0000001";
const A1 = "org-a000000001";
const A2 = "org-a000000002";

const PSPC = { en: "Public Services and Procurement Canada", fr: "Services publics et Approvisionnement Canada", buyer_id: "pwgsc-tpsgc" };
const row = (r: Partial<InstrumentRow> & { agreement: string }): InstrumentRow => ({
  type: "RMSO", description_en: null, description_fr: null, commodity: [], end_user: null, regions: [], segments: [], start: null,
  expiry: null, n_holders: 1, n_holders_withheld: 0, ...r,
});
const ROWS: InstrumentRow[] = [
  row({ agreement: SA, type: "SA", description_en: "Geospatial data services", description_fr: "Services de données géospatiales", commodity: ["N7010"],
    end_user: "n:all-government-departments", regions: ["NA"], expiry: "2026-12-31" }),
  row({ agreement: NMSO, type: "NMSO", description_en: "Translation services", description_fr: "Services de traduction", commodity: ["N7010"],
    end_user: "pwgsc-tpsgc", regions: ["NC"], segments: ["43"], expiry: "2027-06-30" }),
  row({ agreement: RMSO, description_en: "Environmental consulting services", description_fr: "Services d'experts-conseils en environnement",
    commodity: ["R109C"], end_user: "pwgsc-tpsgc", regions: ["AB", "BC"], expiry: "2028-03-31", n_holders: 3, n_holders_withheld: 1 }),
];
const INDEX = {
  as_of: "2026-10-31", published: "2026-10-30", status: "ok", source: "https://sosa.canadabuys.canada.ca/",
  types: {
    SA: { en: "Supply Arrangement", fr: "Arrangement en matière d'approvisionnement" },
    NMSO: { en: "National Master Standing Offer", fr: "Offre à commandes principale et nationale" },
    RMSO: { en: "Regional Master Standing Offer", fr: "Offre à commandes principale régionale" },
  },
  commodities: { N7010: { en: "ADP equipment", fr: "Matériel de TED" }, R109C: { en: "Environmental consulting services", fr: null } },
  end_users: { "pwgsc-tpsgc": PSPC, "n:all-government-departments": { en: "All government departments", fr: "Tous les ministères", buyer_id: null } },
  rows: ROWS,
};

const clone = <T,>(v: T): T => structuredClone(v);
const profiles = (() => {
  const p = clone(FILES["profiles/a00.json"]) as Record<string, any>;
  p[A1].instruments = {
    n: 2,
    rows: [
      { agreement: NMSO, type: "NMSO", type_en: "National Master Standing Offer", type_fr: null, description_en: "Translation services",
        description_fr: "Services de traduction", regions: ["NC"], expiry: "2027-06-30" },
      { agreement: RMSO, type: "RMSO", type_en: "Regional Master Standing Offer", type_fr: null, description_en: "Environmental consulting services",
        description_fr: null, regions: ["AB", "BC"], expiry: "2028-03-31" },
    ],
    lapsed: [{ agreement: SA, type: "SA", type_en: "Supply Arrangement", type_fr: null, description_en: "Geospatial data services",
      description_fr: null, regions: ["NA"], expiry: "2026-12-31", lost_on: "2026-10-23", why: "absent" }],
  };
  return p;
})();
const holders = { n: 2, rows: [{ id: A1, name: "Exemplar Translation Services Inc.", n: 2, soonest: "2027-06-30" },
  { id: A2, name: "Second Org Ltd.", n: 1, soonest: "2028-03-31" }] };
const category = { ...(clone(FILES["categories/82.json"]) as object), holders };
const buyer = { ...(clone(FILES["buyers/pwgsc-tpsgc.json"]) as object), holders };
const tenders = (() => {
  const s = clone(FILES["tenders/20a.json"]) as Record<string, any>;
  s["cb-100-10000001"].instruments = [{ agreement: NMSO, n_holders: 14, n_holders_withheld: 2, expiry: "2027-06-30" }];
  return s;
})();
const OVERRIDES: Record<string, unknown> = {
  "instruments/index.json": INDEX, "profiles/a00.json": profiles, "categories/82.json": category, "buyers/pwgsc-tpsgc.json": buyer,
  "tenders/20a.json": tenders,
};
const assets = (extra: Record<string, unknown> = {}) => makeFakeAssets({}, { ...OVERRIDES, ...extra });
const off = (extra: Record<string, unknown> = {}, more: Record<string, unknown> = {}) => ({ ...testEnv(assets(extra)), ...more });
const on = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS: assets(extra) });

const page = async (path: string, e: object = off()) => {
  const res = await get(path, { env: e });
  return { res, html: decode(nbsp(await res.text())) };
};
const order = (html: string, needles: string[]) => needles.map((n) => html.indexOf(n));
const shownAgreements = (html: string) => [...html.matchAll(/<span class="mono muted">([^<]+)<\/span>/g)].map((m) => m[1]);

// rec_instruments and rec_holders as the nightly sync fills them: the
// regional offer with two holders shown (one linked to a profile in two
// regions, one with no profile) and one withheld, its call-ups by the linked
// holder and by other vendors; the national offer with a segment and its
// RFSO notice; an instrument whose every holder is withheld.
async function seed(state = "ready"): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["rec_instruments", "rec_holders", "rec_meta"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  const calls = JSON.stringify([[orgNumber(A1), 2, 15_000_000, 0], [null, 2, 1_500_000, 0]]);
  const inst = "INSERT INTO rec_instruments (k, agr, type_en, type_fr, desc_en, desc_fr, gsin, gsin_en, gsin_fr, user_en, user_fr, buyer, start, " +
    "expiry, segs, tref, n, nw, seen, last, calls) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  const holder = "INSERT INTO rec_holders (k, ik, oid, name, op, region, region_en, region_fr, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
  await RECORDS.batch([
    RECORDS.prepare(inst).bind(1, RMSO, "Regional Master Standing Offer", "Offre à commandes principale régionale", "Environmental consulting services",
      "Services d'experts-conseils en environnement", "R109C", "Environmental consulting services", null, PSPC.en, PSPC.fr, "pwgsc-tpsgc",
      "2024-04-01", "2028-03-31", "", null, 3, 1, "2026-10-30", "2026-10-30", calls),
    RECORDS.prepare(inst).bind(2, NMSO, "National Master Standing Offer", null, "Translation services", "Services de traduction", "N7010",
      "ADP equipment", "Matériel de TED", PSPC.en, PSPC.fr, "pwgsc-tpsgc", "2025-06-01", "2027-06-30", " 43 ", "cb-100-10000001", 1, 0,
      "2026-10-30", "2026-10-30", null),
    RECORDS.prepare(inst).bind(3, SECRET, "Departmental Individual Standing Offer", null, "Interpretation", null, null, null, null, null, null, null,
      null, "2027-01-31", "", null, 2, 2, "2026-10-30", "2026-10-30", null),
    RECORDS.prepare(holder).bind(11, 1, orgNumber(A1), "Exemplar Translation Services Inc.", "Exemplar Words", "AB", "Alberta", "Alberta", "2026-10-30"),
    RECORDS.prepare(holder).bind(12, 1, orgNumber(A1), "Exemplar Translation Services Inc.", "Exemplar Words", "BC", "British Columbia",
      "Colombie-Britannique", "2026-10-30"),
    RECORDS.prepare(holder).bind(13, 1, null, "Coastal Geomatics Limited", null, "BC", "British Columbia", "Colombie-Britannique", "2026-11-06"),
    RECORDS.prepare(holder).bind(21, 2, orgNumber(A1), "Exemplar Translation Services Inc.", null, "NC", "National Capital Region", null, "2026-10-30"),
    // The current file's layout as the records database held it before the pipeline cleaned it: the type's
    // acronym, the commodity codes and names in the file's literal quotes, the file's own region codes.
    RECORDS.prepare(inst).bind(4, NISO, "NISO", "NISO", "Marine engine monitoring parts and service", null, '"25111900; 81100000"',
      '"25111900 - Marine craft systems and subassemblies; 81100000 - Professional engineering services"',
      '"25111900 - Systèmes et sous-ensembles pour embarcations; 81100000 - Services d\'ingénierie professionnelle"', null, null, null,
      "2024-11-12", "2027-11-16", "", null, 1, 0, "2026-10-29", "2026-10-29", null),
    RECORDS.prepare(holder).bind(41, 4, null, "Harbour Marine Systems Ltd.", null, "RCNNCR", "National Capital Region", "Région de la capitale nationale",
      "2026-10-29"),
    RECORDS.prepare(holder).bind(42, 4, null, "Harbour Marine Systems Ltd.", null, "CA", "Canada", "Canada", "2026-10-29"),
    RECORDS.prepare(holder).bind(43, 4, null, "Harbour Marine Systems Ltd.", null, "EF", "Delivery point named by the file", "Point de livraison nommé par le fichier",
      "2026-10-29"),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', ?), ('as_of', '2026-10-31'), ('rules', '2')").bind(state),
  ]);
}

beforeAll(() => seed());

describe("the list of standing offers and supply arrangements", () => {
  it("names the source, its weekly cadence and the file's date, and lists the soonest expiry first", async () => {
    const { res, html } = await page("/instruments");
    expect(res.status).toBe(200);
    expect(html).toContain("<h1>Standing Offers and Supply Arrangements</h1>");
    expect(html).toContain("3 standing offers and supply arrangements active in the file Public Services and Procurement Canada publishes each week " +
      "under the Open Government Licence, in its edition of 2026-10-30.");
    expect(shownAgreements(html)).toEqual([SA, NMSO, RMSO]);
    expect(html).toContain(`<a href="${instrumentPath(RMSO)}">Environmental consulting services</a>`);
    expect(instrumentPath(RMSO)).toBe("/instruments/E60ZT-120002%2F001%2FZT");
    // The type in the site's words, the regions by name, the days left, the persons withheld counted.
    expect(html).toContain("Regional master standing offer");
    expect(html).toContain("Alberta, British Columbia");
    expect(html).toContain("2026-12-31 (61 days left)");
    expect(html).toContain("3, 1 withheld");
    expect(html).toContain('<a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a>');
    expect(html).toContain("the radar of contracts ending leaves them out");
  });

  it("filters by type, region, segment, commodity, end user and expiry, and sorts by holders", async () => {
    const shown = async (q: string) => shownAgreements((await page(`/instruments?${q}`)).html);
    expect(await shown("type=SA")).toEqual([SA]);
    expect(await shown("region=BC")).toEqual([RMSO]);
    expect(await shown("segment=43")).toEqual([NMSO]);
    expect(await shown("segment=none")).toEqual([SA, RMSO]);
    expect(await shown("commodity=N7010")).toEqual([SA, NMSO]);
    expect(await shown("user=pwgsc-tpsgc")).toEqual([NMSO, RMSO]);
    expect(await shown("within=3")).toEqual([SA]);
    expect(await shown("within=12")).toEqual([SA, NMSO]);
    expect(await shown("sort=holders")).toEqual([RMSO, SA, NMSO]);
    // Each way round, from the table's Expires and Holders heads; ties by the soonest expiry.
    expect(await shown("sort=holders-asc")).toEqual([SA, NMSO, RMSO]);
    expect(await shown("sort=expiry-desc")).toEqual([RMSO, NMSO, SA]);
    expect(await shown("sort=expiry")).toEqual([SA, NMSO, RMSO]);
    const heads = (await page("/instruments?region=BC&sort=holders")).html;
    expect(heads).toContain('data-sorting="server"');
    expect(heads).toContain('<th class="k-count num" aria-sort="descending"><a href="/instruments?region=BC" class="th-sort" rel="nofollow">Holders</a></th>');
    expect(heads).toContain('<th class="k-date"><a href="/instruments?region=BC&sort=expiry" class="th-sort" rel="nofollow">Expires</a></th>');
    expect(heads).toContain('<th class="k-label">Instrument type</th>');
    expect(heads).toContain('<option value="holders" selected="">Most holders</option>');
    // Anything out of form reads as no filter.
    expect(readInstrumentQuery(new URL("https://x/instruments?type=<b>&within=5&segment=4&user=A B&sort=value"))).toEqual({
      type: "", region: "", segment: "", commodity: "", user: "", within: "", sort: "",
    });
    expect(filterInstruments(ROWS, { ...readInstrumentQuery(new URL("https://x/")), within: "6" }, "2026-10-31").map((r) => r.agreement)).toEqual([SA]);
    expect(sortInstruments([ROWS[2], row({ agreement: "B", expiry: null }), ROWS[0]], "").map((r) => r.agreement)).toEqual([SA, RMSO, "B"]);
    // A filtered view stays out of the index and names its filters as chips.
    const { html } = await page("/instruments?region=BC");
    expect(html).toContain('<meta name="robots" content="noindex');
    expect(html).toContain("<span>Region</span> <b>British Columbia</b>");
  });

  it("pages 100 at a time, and a page past the last is a 404", async () => {
    const many = { ...INDEX, rows: Array.from({ length: 150 }, (_, i) => row({ agreement: `A-${String(i).padStart(3, "0")}`, expiry: "2027-01-01" })) };
    const e = off({ "instruments/index.json": many });
    expect(shownAgreements((await page("/instruments", e)).html)).toHaveLength(100);
    const second = await page("/instruments?page=2", e);
    expect(shownAgreements(second.html)).toHaveLength(50);
    expect(second.html).toContain("Page 2 of 2");
    expect((await page("/instruments?page=3", e)).res.status).toBe(404);
    expect((await page("/instruments?page=x", e)).res.status).toBe(404);
  });

  it("says when the file was never read, when a week failed or was held, and answers 503 without the file", async () => {
    expect((await page("/instruments", off({ "instruments/index.json": { ...INDEX, published: null, status: "none", rows: [] } }))).html)
      .toContain("has not been read yet");
    expect((await page("/instruments", off({ "instruments/index.json": { ...INDEX, status: "failed" } }))).html)
      .toContain("The last weekly read of the file failed; the rows shown are those of the edition of 2026-10-30.");
    expect((await page("/instruments", off({ "instruments/index.json": { ...INDEX, status: "held" } }))).html)
      .toContain("is held for review");
    expect((await page("/instruments", off({ "instruments/index.json": undefined }))).res.status).toBe(503);
    expect((await page("/instruments", off({ "instruments/index.json": { ...INDEX, rows: [{ agreement: 5 }] } }))).res.status).toBe(503);
  });
});

describe("an instrument's page", () => {
  it("shows its details and its holders: linked to a profile, with no profile, and withheld as a count", async () => {
    const { res, html } = await page(instrumentPath(RMSO));
    expect(res.status).toBe(200);
    expect(html).toContain("<h1>Environmental consulting services</h1>");
    expect(html).toContain("expires 2028-03-31 (517 days left)");
    // One line a holder, its regions joined; the profile linked; the operating name beside the legal one.
    expect(html).toContain(`<a href="/organizations/${A1}">Exemplar Translation Services Inc.</a>`);
    expect(html).toContain("operating as Exemplar Words");
    expect(html).toContain("Alberta, British Columbia");
    expect(html.match(/Exemplar Translation Services Inc\.<\/a>/g)).toHaveLength(1);
    // A holder whose name names no profile is shown unlinked, its call-ups not matched.
    expect(html).toContain("Coastal Geomatics Limited");
    expect(html).not.toContain(">Coastal Geomatics Limited</a>");
    expect(html).toContain("no profile");
    expect(html).toContain("1 holder reads as a private individual and is withheld.");
    // The call-ups: the holder's own, and the other vendors' beside them.
    expect(html).toContain("$150,000");
    expect(html).toContain("Call-ups by vendors that are not holders with a profile here: 2, $15,000.");
    expect(html).toContain("Call-ups recorded in the published contracts naming this instrument, over ten fiscal years");
    expect(html).toContain("None: no award or tender notice shares its solicitation number</dd>");
    expect(html).toContain('<dt>Commodity</dt><dd><span class="mono">R109C</span> Environmental consulting services</dd>');
    expect(html).toContain('href="https://sosa.canadabuys.canada.ca/"');
    expect(html).toContain("Open Government Licence");
  });

  it("links the RFSO notice and the inherited segments, and reads in French", async () => {
    const { html } = await page(instrumentPath(NMSO));
    expect(html).toContain('<a href="/tenders/cb-100-10000001" class="mono">cb-100-10000001</a>');
    expect(html).toContain('<a href="/segments/43">43 Information Technology Broadcasting and Telecommunications</a>');
    const fr = (await page(`${instrumentPath(RMSO)}?lang=fr`)).html;
    expect(fr).toContain("<h1>Services d'experts-conseils en environnement</h1>");
    expect(fr).toContain("Alberta, Colombie-Britannique");
    expect(fr).toContain("1 titulaire semble être un particulier et son nom est retiré.");
    expect(fr).toContain("Offre à commandes principale régionale");
  });

  it("says when every holder is withheld, answers 404 for a number it does not hold and 503 while the database cannot answer", async () => {
    expect((await page(instrumentPath(SECRET))).html).toContain("All holders withheld (2).");
    const missing = await page(instrumentPath("E60ZT-000000/001/ZT"));
    expect(missing.res.status).toBe(404);
    expect(missing.html).toContain("No standing offer or supply arrangement numbered");
    expect((await page(instrumentPath(RMSO), off({}, { RECORDS: undefined }))).res.status).toBe(503);
    await seed("loading");
    try {
      const loading = await page(instrumentPath(RMSO));
      expect(loading.res.status).toBe(503);
      expect(loading.html).toContain("being reloaded");
    } finally {
      await seed();
    }
  });

  it("reads through the indexes, bounded", async () => {
    for (const sql of INSTRUMENT_STATEMENTS) {
      expect(sql, sql).toMatch(/LIMIT \d+$/);
      const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(RMSO).all()).results ?? [])
        .map((r) => String((r as { detail?: unknown }).detail));
      const text = steps.join("\n");
      expect(steps.filter((s) => /^SCAN (i|h|rec_\w+)\b/.test(s) && !/USING/.test(s)), `${sql}\n${text}`).toEqual([]);
      expect(text, sql).toMatch(/rec_instruments_agr|rec_holders_instrument/);
    }
    expect([HOLDERS_SQL, HOLDERS_CSV_SQL].every((s) => s.includes("rec_holders h"))).toBe(true);
    expect(INSTRUMENT_SQL).toContain("WHERE i.agr = ?1");
  });
});

describe("the other pages", () => {
  it("give a profile the line in its head and the section, soonest expiry first, with what it no longer holds", async () => {
    const { html } = await page(`/organizations/${A1}`);
    expect(html).toContain('<a href="#instruments">Holds 2 active standing offers or supply arrangements</a>');
    expect(html).toContain('<h2 id="instruments">Standing Offers and Supply Arrangements</h2>');
    const section = html.slice(html.indexOf('<h2 id="instruments">'));
    expect(order(section, [NMSO, RMSO, "<h3>No Longer Held</h3>", SA]).every((x, i, a) => x >= 0 && (i === 0 || x > a[i - 1]))).toBe(true);
    expect(section).toContain("2026-10-23");
    const fr = (await page(`/organizations/${A1}?lang=fr`)).html;
    expect(fr).toContain("Détient 2 offres à commandes ou arrangements en matière d’approvisionnement actifs");
    // A profile with none, and a file written before them, have neither.
    const none = (await page(`/organizations/${A2}`)).html;
    expect(none).not.toContain('href="#instruments"');
    expect(none).not.toContain('<h2 id="instruments">');
  });

  it("give a segment page its holders after the incumbents, and a buyer page the same block", async () => {
    const seg = (await page("/segments/82")).html;
    expect(seg).toContain('<h2 id="holders">Holders in This Segment</h2>');
    expect(seg.indexOf('<h2 id="holders">')).toBeGreaterThan(seg.indexOf('<h2 id="incumbents">'));
    expect(seg).toContain(`<a href="/organizations/${A1}#instruments">Exemplar Translation Services Inc.</a>`);
    expect(seg).toContain('href="/instruments?segment=82"');
    expect((await page("/segments/82?lang=fr")).html).toContain("Titulaires dans ce segment");
    const b = (await page("/buyers/pwgsc-tpsgc")).html;
    expect(b).toContain("Holders of Standing Offers and Supply Arrangements for This Buyer");
    expect(b).toContain('href="/instruments?user=pwgsc-tpsgc"');
    // Without the part, no block.
    expect((await page("/segments/82", testEnv())).html).not.toContain('<h2 id="holders">');
  });

  it("give an RFSO notice the current holders of what it issued", async () => {
    const { html } = await page("/tenders/cb-100-10000001");
    expect(html).toContain(`Current holders of <a href="${instrumentPath(NMSO)}#holders" class="mono">${NMSO}</a>: 14`);
    expect(html).toContain("(2 withheld as private individuals)");
    expect((await page("/tenders/cb-100-10000001?lang=fr")).html).toContain("Titulaires actuels de");
    expect((await page("/tenders/cb-100-10000001", testEnv())).html).not.toContain("Current holders of");
  });
});

describe("the CSV files", () => {
  it("are the site's 404 while the switch is off, and the pages carry no Pro mark", async () => {
    for (const path of ["/instruments/rows.csv", `${instrumentPath(RMSO)}/holders.csv`]) {
      expect((await get(path, { env: off() })).status, path).toBe(404);
    }
    for (const path of ["/instruments", instrumentPath(RMSO)]) {
      const { html } = await page(path);
      expect(html, path).not.toContain("pro-tag");
      expect(html, path).not.toContain("rows.csv");
      expect(html, path).not.toContain("holders.csv");
    }
  });

  it("are Pro's once the switch is on; a free reader gets every row of the pages and the mark beside the file", async () => {
    const index = (await page("/instruments", on())).html;
    expect(shownAgreements(index)).toEqual([SA, NMSO, RMSO]);
    expect(index).toContain("The CSV of this view is part of Pro.");
    expect(index).toContain('<span class="pro-tag">');
    expect((await page(instrumentPath(RMSO), on())).html).toContain("The CSV of the holders is part of Pro.");
    expect((await get("/instruments/rows.csv", { env: on() })).status).toBe(404);
    expect((await get(`${instrumentPath(RMSO)}/holders.csv`, { env: on() })).status).toBe(404);

    const email = newEmail("sosa");
    const cookie = await signIn(email, { env: on() });
    await grantPro(email);
    const rows = await get("/instruments/rows.csv?user=pwgsc-tpsgc", { env: on(), cookie });
    expect(rows.status).toBe(200);
    expect(rows.headers.get("content-type")).toContain("text/csv");
    expect(rows.headers.get("cache-control")).toBe("private, no-store");
    const lines = (await rows.text()).trim().split("\r\n");
    expect(lines[0]).toBe("agreement_number,type,type_en,type_fr,description_en,description_fr,commodity,commodity_en,commodity_fr,end_user_en," +
      "end_user_fr,end_user_buyer_id,regions,segments,start,expiry,days_left,holders,holders_withheld,url");
    expect(lines.slice(1).map((l) => l.split(",")[0])).toEqual([NMSO, RMSO]);
    const held = await get(`${instrumentPath(RMSO)}/holders.csv`, { env: on(), cookie });
    expect(held.status).toBe(200);
    const body = await held.text();
    expect(body).toContain(`${RMSO},Exemplar Translation Services Inc.,Exemplar Words,${A1},AB BC,2026-10-30,2,150000.00`);
    expect(body).toContain(`${RMSO},Coastal Geomatics Limited,,,BC,2026-11-06,,`);
    const proPage = await (await get("/instruments", { env: on(), cookie })).text();
    expect(proPage).not.toContain("The CSV of this view is part of Pro.");
    expect(proPage).toContain('href="/instruments/rows.csv"');
  });

  it("count against the download cap and fold the numbers into their routes", () => {
    expect(bucketFor("GET", "/instruments/rows.csv")).toBe("download");
    expect(bucketFor("GET", "/instruments/E60ZT-120002%2F001%2FZT/holders.csv")).toBe("download");
    expect(bucketFor("GET", "/instruments/E60ZT-120002%2F001%2FZT")).toBe("page");
    expect(routeTemplate("GET", "/instruments/E60ZT-120002%2F001%2FZT").route).toBe("/instruments/:agreement");
    expect(routeTemplate("GET", "/instruments/E60ZT-120002%2F001%2FZT/holders.csv").route).toBe("/instruments/:agreement/holders.csv");
    expect(PRO_INCLUDES.some(([f, k]) => f === "export_filtered" && k === "plans.pro_instruments")).toBe(true);
  });
});

describe("both languages", () => {
  it("render every page in English and French with no em-dash", async () => {
    for (const path of ["/instruments", instrumentPath(RMSO), instrumentPath(SECRET), `/organizations/${A1}`, "/segments/82", "/tenders/cb-100-10000001"]) {
      for (const lang of ["en", "fr"]) {
        const { res, html } = await page(`${path}${path.includes("?") ? "&" : "?"}lang=${lang}`);
        expect(res.status, `${path} ${lang}`).toBe(200);
        expect(html, `${path} ${lang}`).toContain(`<html lang="${lang}">`);
        expect(html, `${path} ${lang}`).not.toContain(EM_DASH);
      }
    }
  });
});

// The file as published in 2026: what the review of
// 2026-11-07 found on /instruments (every type read "NISO", the commodity
// column printed its codes in their quotes, the region filter listed raw
// codes) and what the page now makes of it.
describe("the layout of the current file", () => {
  const live = (r: Partial<InstrumentRow> & { agreement: string }) => row({ start: "2024-11-12", n_holders: 1, ...r });
  const LIVE = {
    ...INDEX,
    types: {
      NISO: { en: "National individual standing offer", fr: "Offre à commandes individuelle nationale" },
      NMSO: { en: "National master standing offer", fr: "Offre à commandes principale et nationale" },
    },
    commodities: {
      "25111900": { en: "Marine craft systems and subassemblies", fr: "Systèmes et sous-ensembles pour embarcations" },
      "81100000": { en: "Professional engineering services", fr: "Services d'ingénierie professionnelle" },
      "43230000": { en: "Software", fr: "Logiciels" },
      "43211500": { en: "Computers", fr: null },
      "43211600": { en: "Computer accessories", fr: null },
      "43222600": { en: "Network service equipment", fr: null },
    },
    region_names: {
      CA: { en: "Canada", fr: "Canada" }, RCNNCR: { en: "National Capital Region", fr: "Région de la capitale nationale" },
      US: { en: "United States of America", fr: "États-Unis d'Amérique" }, EF: { en: "Delivery point named by the file", fr: "Point de livraison nommé par le fichier" },
    },
    rows: [
      live({ agreement: "CW0000001", type: "NISO", description_en: "Marine engine monitoring parts and service", commodity: ["25111900", "81100000"],
        regions: ["BC", "RCNNCR"], expiry: "2026-11-16" }),
      live({ agreement: "CW0000002", type: "NMSO", description_en: "Computers and software", commodity: ["43230000", "43211500", "43211600", "43222600", "81100000"],
        regions: ["CA", "US"], segments: ["43", "81"], expiry: "2027-03-31", n_holders: 12 }),
      live({ agreement: "CW0000003", type: "OTHER", type_en: "Framework agreement", type_fr: "Accord-cadre", description_en: "Training",
        regions: ["EF"], expiry: "2027-06-30" }),
    ],
  };
  const e = () => off({ "instruments/index.json": LIVE });

  it("names each type in the page's language and lists the real types in the filter", async () => {
    const { html } = await page("/instruments", e());
    const cells = [...html.matchAll(/<td data-label="Instrument type">([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(cells).toEqual(["National individual standing offer", "National master standing offer", "Framework agreement"]);
    expect(html).toContain('<option value="NISO">National individual standing offer (1)</option>');
    expect(html).toContain('<option value="NMSO">National master standing offer (1)</option>');
    expect(html).toContain('<option value="OTHER">Other type (1)</option>');
    expect(shownAgreements((await page("/instruments?type=NISO", e())).html)).toEqual(["CW0000001"]);
    const fr = (await page("/instruments?lang=fr", e())).html;
    expect(fr).toContain("Offre à commandes individuelle nationale");
    expect(fr).toContain("Accord-cadre");
    // The acronym the records database held before the pipeline's names reach it reads as the name too.
    expect([typeCodeOf("NISO"), typeCodeOf("Regional Master Standing Offer"), typeCodeOf("Supply arrangement (SA)"), typeCodeOf("Accord")])
      .toEqual(["NISO", "RMSO", "SA", "OTHER"]);
  });

  it("prints each commodity code with its name, never the file's quotes, and filters by one code", async () => {
    const { html } = await page("/instruments", e());
    expect(html).toContain(">Commodity</th>");
    expect(html).not.toContain("GSIN");
    // The old page printed the codes and names in the file's quotes.
    expect(html).not.toContain('mono">"');
    expect(html).not.toContain(' "25111900 - ');
    expect(html).toContain('<span class="mono">25111900</span> Marine craft systems and subassemblies; <span class="mono">81100000</span> Professional engineering services');
    // The first three codes of a long list, then how many more.
    expect(html).toContain('<span class="mono">43211600</span> Computer accessories and 2 more');
    expect(shownAgreements((await page("/instruments?commodity=81100000", e())).html)).toEqual(["CW0000001", "CW0000002"]);
    expect(html).toContain('<option value="81100000">81100000 Professional engineering services (2)</option>');
    // The segments are the chips the other lists carry, explained once above the table.
    expect(html).toContain('<a href="/segments/43" class="chip"');
    expect(html).toContain("The tags after a reference are UNSPSC segments");
    expect(commodityList('"39121000; 41100000; 41110000; 41120000;', '"39121000 - Power conditioning equipment; 41100000 - Laboratory equipment"'))
      .toEqual([{ code: "39121000", name: "Power conditioning equipment" }, { code: "41100000", name: "Laboratory equipment" },
        { code: "41110000", name: null }, { code: "41120000", name: null }]);
  });

  it("names every region in the filter and the table in the page's language", async () => {
    const { html } = await page("/instruments", e());
    const options = (lang: string, src: string) => {
      const select = src.slice(src.indexOf('<select name="region">'), src.indexOf("</select>", src.indexOf('<select name="region">')));
      return [...select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((m) => `${m[1]}=${m[2]}`).slice(1);
    };
    expect(options("en", html)).toEqual(["BC=British Columbia (1)", "EF=Delivery point named by the file (1)", "CA=National (all regions) (1)",
      "RCNNCR=National Capital Region (1)", "US=United States of America (1)"]);
    const fr = (await page("/instruments?lang=fr", e())).html;
    expect(options("fr", fr)).toContain("RCNNCR=Région de la capitale nationale (1)");
    expect(options("fr", fr)).toContain("US=États-Unis d'Amérique (1)");
    expect(options("fr", fr)).toContain("CA=National (toutes les régions) (1)");
    expect(html).toContain("British Columbia, National Capital Region");
    // The file's own codes are a filter as the provinces are.
    expect(shownAgreements((await page("/instruments?region=RCNNCR", e())).html)).toEqual(["CW0000001"]);
    expect(shownAgreements((await page("/instruments?region=US", e())).html)).toEqual(["CW0000002"]);
    expect((await page("/instruments?region=RCNNCR", e())).html).toContain("<span>Region</span> <b>National Capital Region</b>");
    // The dictionary's codes and the current file's name the same places; a country the file does not name
    // reads by the runtime's name for it, and a code no one names as written.
    expect([regionName("en", "CA"), regionName("en", "NA"), regionName("fr", "RCNNCR"), regionName("en", "FD"), regionName("fr", "FD")])
      .toEqual(["National (all regions)", "National (all regions)", "Région de la capitale nationale", "Outside Canada", "Hors du Canada"]);
    expect([regionName("en", "MX"), regionName("fr", "US")]).toEqual(["Mexico", "États-Unis"]);
    expect([regionName("en", "EF"), regionName("en", "EF", { en: "Named", fr: null })]).toEqual(["EF", "Named"]);
  });

  it("reads an index written before the fix, so the Worker can be deployed ahead of the nightly", async () => {
    // As the export wrote it until 2026-11-07: one commodity string a row in the source file's quotes, keyed so
    // in the names, and every type OTHER under the first one's words.
    const before = {
      ...INDEX, types: { OTHER: { en: "NISO", fr: "NISO" } },
      commodities: { '"25111900; 81100000"': { en: '"25111900 - Marine craft systems and subassemblies; 81100000 - Professional engineering services"', fr: null } },
      rows: [{ ...live({ agreement: "CW0000001", type: "OTHER", regions: ["RCNNCR"], expiry: "2026-11-16" }), commodity: '"25111900; 81100000"' }],
    };
    const { res, html } = await page("/instruments", off({ "instruments/index.json": before }));
    expect(res.status).toBe(200);
    expect(html).toContain('<span class="mono">25111900</span> Marine craft systems and subassemblies; <span class="mono">81100000</span> Professional engineering services');
    expect(html).not.toContain('mono">"');
    expect(html).toContain("<td data-label=\"Instrument type\">Other type</td>");
    expect(html).toContain('<option value="RCNNCR">National Capital Region (1)</option>');
    expect(shownAgreements((await page("/instruments?commodity=81100000", off({ "instruments/index.json": before }))).html)).toEqual(["CW0000001"]);
  });

  it("shows an instrument the records database held in the file's quotes and acronyms by name", async () => {
    const { html } = await page(instrumentPath(NISO));
    expect(html).toContain("<dt>Instrument type</dt><dd>National individual standing offer</dd>");
    expect(html).toContain('<dt>Commodity</dt><dd><span class="mono">25111900</span> Marine craft systems and subassemblies; ' +
      '<span class="mono">81100000</span> Professional engineering services</dd>');
    expect(html).not.toContain('mono">"');
    expect(html).toContain("National (all regions), Delivery point named by the file, National Capital Region");
    const fr = (await page(`${instrumentPath(NISO)}?lang=fr`)).html;
    expect(fr).toContain("Offre à commandes individuelle nationale");
    expect(fr).toContain(`<span class="mono">81100000</span> Services d'ingénierie professionnelle`);
    expect(fr).toContain("National (toutes les régions), Point de livraison nommé par le fichier, Région de la capitale nationale");
  });
});
