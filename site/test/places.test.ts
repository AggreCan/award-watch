// Provinces stated and derived (pipeline places.py): the tender list's
// province filter reads both unless derived=0, the browser's rules answer the
// same, every place they show marks the derived ones, a detail page names the
// field they come from, the row checks hold the pair together, and the
// methodology page states the rule and the Defence Construction Canada finding.
import { describe, expect, it } from "vitest";
import { filterRows, queryString, readSearch } from "../public/tender-query.js";
import { type TenderRow, isTenderRow } from "../src/data";
import { app } from "../src/index";
import { derivedPlacesText, provincesText } from "../src/pages/shared";
import { filterTenders, readTenderQuery, tenderQueryString } from "../src/pages/tenders";
import { makeFakeAssets, testClock, testEnv } from "./assets";
import tenderShard from "./fixtures/tenders-20a.json";
import openTenders from "./fixtures/tenders-open.json";

const base = (openTenders as unknown as TenderRow[])[2];
const row = (reference: string, provinces: string[], derived?: string[]): TenderRow => ({
  ...base, reference, provinces, ...(derived ? { provinces_derived: derived, provinces_from: "delivery" as const } : {}),
});
const ROWS: TenderRow[] = [
  row("cb-1-1", ["BC"]),
  row("cb-2-2", [], ["BC"]),
  row("cb-3-3", []),
  row("cb-4-4", ["ON"], ["AB"]),
];
const server = (search: string) => readTenderQuery(new URL(`https://x/tenders${search}`));
const serverRefs = (search: string) => filterTenders(ROWS, server(search), testClock).map((r) => r.reference).sort();
const clientRefs = (search: string) =>
  (filterRows(ROWS, readSearch(search), testClock.now) as TenderRow[]).map((r) => r.reference).sort();
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ");
const page = async (path: string, overrides: Record<string, unknown> = {}) =>
  decode(await (await app.request(path, {}, testEnv(makeFakeAssets({}, overrides)))).text());

describe("the province filter", () => {
  const VIEWS: [string, string[]][] = [
    ["?province=BC", ["cb-1-1", "cb-2-2", "cb-3-3"]],
    ["?province=BC&national=0", ["cb-1-1", "cb-2-2"]],
    ["?province=BC&national=0&derived=0", ["cb-1-1"]],
    // Read for the stated ones alone, a notice derived to BC names no province and stays as not stated.
    ["?province=BC&derived=0", ["cb-1-1", "cb-2-2", "cb-3-3"]],
    ["?province=AB&national=0", ["cb-4-4"]],
    ["?province=AB&national=0&derived=0", []],
    ["?province=ON&national=0", ["cb-4-4"]],
    // A form that sends the hidden 0 and the ticked 1 keeps the derived ones.
    ["?province=BC&national=0&derived=0&derived=1", ["cb-1-1", "cb-2-2"]],
  ];

  it("reads stated and derived provinces unless derived=0, on the server and in the browser alike", () => {
    for (const [view, refs] of VIEWS) {
      expect(serverRefs(view), view).toEqual(refs);
      expect(clientRefs(view), view).toEqual(refs);
    }
  });

  it("writes derived=0 only beside a province, as the browser does", () => {
    expect(tenderQueryString(server("?province=BC&derived=0"))).toBe("?province=BC&derived=0");
    expect(tenderQueryString(server("?derived=0"))).toBe("");
    for (const [view] of VIEWS) {
      const s = readSearch(view);
      expect(queryString(s, s.page), view).toBe(tenderQueryString(server(view)));
      expect(s.derived, view).toBe(server(view).derived);
    }
  });

  it("offers the box on the tenders page, ticked unless the address says derived=0", async () => {
    const on = await page("/tenders");
    expect(on).toContain('<input type="checkbox" name="derived" value="1" checked=""/>');
    expect(on).toContain("Include provinces derived from other fields");
    const off = await page("/tenders?province=BC&derived=0");
    expect(off).toContain('<input type="checkbox" name="derived" value="1"/>');
    expect(await page("/tenders?lang=fr")).toContain("Inclure les provinces déduites d’autres champs");
  });
});

describe("showing derived provinces", () => {
  it("marks each derived province after the stated ones, in both languages", () => {
    expect(provincesText("en", ["ON"], ["AB"])).toBe("Ontario, Alberta (derived)");
    expect(provincesText("en", [], ["BC"])).toBe("British Columbia (derived)");
    expect(provincesText("en", [])).toBe("Canada-wide or not stated");
    expect(provincesText("fr", [], ["BC"])).toBe("Colombie-Britannique (par déduction)");
  });

  it("names the field they come from", () => {
    expect(derivedPlacesText("en", { provinces_derived: ["BC"], provinces_from: "delivery" }))
      .toBe("British Columbia (derived from a city named in the regions of delivery)");
    expect(derivedPlacesText("en", { provinces_derived: ["NS"], provinces_from: "opportunity" }))
      .toBe("Nova Scotia (derived from the regions of opportunity)");
    expect(derivedPlacesText("en", { provinces_derived: ["NT", "YT"], provinces_from: "land_claims" }))
      .toBe("Northwest Territories, Yukon (derived from the land claims agreement area)");
    expect(derivedPlacesText("en", { provinces_derived: ["BC"], provinces_from: "dcc_office" }))
      .toBe("British Columbia (derived from the Defence Construction Canada regional office)");
    expect(derivedPlacesText("fr", { provinces_derived: ["BC"], provinces_from: "dcc_office" }))
      .toBe("Colombie-Britannique (d’après le bureau régional de Construction de Défense Canada)");
    expect(decode(derivedPlacesText("fr", { provinces_derived: ["NS"], provinces_from: "opportunity" }) ?? ""))
      .toBe("Nouvelle-Écosse (d’après les régions de l’appel d’offres)");
    expect(derivedPlacesText("en", {})).toBeNull();
  });

  it("puts them on a notice's page apart from the stated provinces", async () => {
    const shard = structuredClone(tenderShard) as Record<string, Record<string, unknown>>;
    Object.assign(shard["cb-200-20005019"], { provinces: [], provinces_derived: ["BC"], provinces_from: "delivery" });
    const html = await page("/tenders/cb-200-20005019", { "tenders/20a.json": shard });
    expect(html).toContain("Derived provinces");
    expect(html).toContain("British Columbia (derived from a city named in the regions of delivery)");
    const fr = await page("/tenders/cb-200-20005019?lang=fr", { "tenders/20a.json": shard });
    expect(fr).toContain("Colombie-Britannique (d’après une ville nommée dans les régions de livraison)");
  });

  it("are read from a row only as a pair", () => {
    expect(isTenderRow(ROWS[1])).toBe(true);
    expect(isTenderRow({ ...base, provinces_derived: ["BC"] })).toBe(false);
    expect(isTenderRow({ ...base, provinces_derived: ["BC"], provinces_from: "title" })).toBe(false);
    expect(isTenderRow({ ...base, provinces_from: "delivery" })).toBe(false);
  });
});

describe("the methodology page", () => {
  it("states the rule, the fields never read, the counts and the Defence Construction Canada finding", async () => {
    const en = await page("/methodology");
    expect(en).toContain('<h3 id="places">Derived provinces</h3>');
    expect(en).toContain("Esquimalt gives British Columbia");
    expect(en).toContain("Never read for a place");
    expect(en).toContain("467 of the 854 open notices stated no province, and 167 of them were placed (67 by a Defence Construction Canada regional office), leaving 300");
    expect(en).toContain("Pacific gives British Columbia; Western gives Alberta, Saskatchewan and Manitoba");
    expect(en).toContain("This is the one buyer whose office is read.");
    expect(en).toContain("its award notices are not in the CanadaBuys award file");
    expect(en).toContain('<a href="https://www.dcc-cdc.gc.ca/industry/contract-activity" rel="noopener">Contract Activity</a>');
    const fr = await page("/methodology?lang=fr");
    expect(fr).toContain("Esquimalt donne la Colombie-Britannique");
    expect(fr).toContain("Pacifique donne la Colombie-Britannique; Ouest, l’Alberta, la Saskatchewan et le Manitoba");
    expect(fr).toContain('<a href="https://www.cdc-dcc.gc.ca/industrie/activit%C3%A9-contractuelle" rel="noopener">Activité contractuelle</a>');
  });
});
