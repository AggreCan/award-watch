// Standing offers and supply arrangements (src/instruments.ts,
// src/pages/instruments.tsx, docs/sosa.md): the index from its static file
// with its filters, sort and pages; the instrument page from a real local D1
// built from pipeline/records_schema.sql, with holders linked to a profile,
// holders with no profile and holders withheld as persons; the profile's line
// and section, the segment and buyer blocks and the tender notice's line from
// the parts the export adds to their files; the two CSV files Pro's and the
// pages free; both languages and no em-dash; and every statement's plan.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import {
  HOLDERS_CSV_SQL, HOLDERS_SQL, INSTRUMENT_SQL, INSTRUMENT_STATEMENTS, filterInstruments, instrumentPath, readInstrumentQuery,
  sortInstruments, type InstrumentRow,
} from "../src/instruments";
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
const A1 = "org-a000000001";
const A2 = "org-a000000002";

const PSPC = { en: "Public Services and Procurement Canada", fr: "Services publics et Approvisionnement Canada", buyer_id: "pwgsc-tpsgc" };
const row = (r: Partial<InstrumentRow> & { agreement: string }): InstrumentRow => ({
  type: "RMSO", description_en: null, description_fr: null, commodity: null, end_user: null, regions: [], segments: [], start: null,
  expiry: null, n_holders: 1, n_holders_withheld: 0, ...r,
});
const ROWS: InstrumentRow[] = [
  row({ agreement: SA, type: "SA", description_en: "Geospatial data services", description_fr: "Services de données géospatiales", commodity: "N7010",
    end_user: "n:all-government-departments", regions: ["NA"], expiry: "2026-12-31" }),
  row({ agreement: NMSO, type: "NMSO", description_en: "Translation services", description_fr: "Services de traduction", commodity: "N7010",
    end_user: "pwgsc-tpsgc", regions: ["NC"], segments: ["43"], expiry: "2027-06-30" }),
  row({ agreement: RMSO, description_en: "Environmental consulting services", description_fr: "Services d'experts-conseils en environnement",
    commodity: "R109C", end_user: "pwgsc-tpsgc", regions: ["AB", "BC"], expiry: "2028-03-31", n_holders: 3, n_holders_withheld: 1 }),
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
    expect(html).toContain("None: no award or tender notice shares its solicitation number (GSIN R109C)");
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
