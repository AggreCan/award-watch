// The site leftovers: the yearly downloads of published contracts and grants
// on the Data page, a segment's families and classes (tenders/open-levels.json),
// and the tender list's code filter named on its chip.
import { describe, expect, it } from "vitest";
import { codeLevel } from "../src/data";
import { app } from "../src/index";
import { FIRST_CONTRACT_YEAR, FIRST_GRANT_YEAR, YEARLY_DOWNLOAD, fileParts } from "../src/pages/data";
import { LEVEL_CLASSES_MAX, LEVEL_FAMILIES_MAX, segmentLevels } from "../src/pages/segments";
import { codeChip, codeName } from "../src/pages/tenders";
import { routeTemplate } from "../src/views";
import levelsFixture from "./fixtures/tenders-open-levels.json";
import stats from "./fixtures/stats.json";
import { assetsWithout, fakeAssets, makeFakeAssets, testEnv } from "./assets";

const get = (path: string, assets: Fetcher = fakeAssets) => app.request(path, {}, testEnv(assets));
const html = async (path: string, assets?: Fetcher) => (await get(path, assets)).text();
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const EM_DASH = String.fromCharCode(0x2014);
const section = (page: string, id: string) => {
  const start = page.indexOf(`<h2 id="${id}">`);
  const next = page.indexOf("<h2 id=", start + 1);
  return page.slice(start, next < 0 ? undefined : next);
};
const link = (f: string) => `<a class="mono" href="/downloads/${f}">${f}</a>`;

describe("yearly downloads of published contracts and grants", () => {
  it("are served by name, with their before, after, undated and numbered-part files", () => {
    for (const f of ["contracts-2004.csv", "grants-2026.csv", "contracts-before-2004.csv", "grants-after-2026.csv",
      "grants-undated.csv", "contracts-2025-2.csv", "contracts-2025-9.csv"]) expect(YEARLY_DOWNLOAD.test(f), f).toBe(true);
    for (const f of ["contracts-2025-1.csv", "contracts-25.csv", "grants-undated-x.csv", "contracts-2025.csv.partial"]) {
      expect(YEARLY_DOWNLOAD.test(f), f).toBe(false);
    }
    // The views count a contracts or grants year under its source's template, as the awards years.
    expect(routeTemplate("GET", "/downloads/contracts-2025-2.csv")).toEqual({ route: "/downloads/contracts-:year.csv", kind: "download" });
    expect(routeTemplate("GET", "/downloads/grants-undated.csv")).toEqual({ route: "/downloads/grants-:year.csv", kind: "download" });
  });

  it("list each year from the first, the parts after their year, and an undated file only when the export wrote one", async () => {
    const plain = section(await html("/data"), "downloads");
    expect(plain).toContain("<h3>Published Contracts by Year of Contract Date</h3>");
    expect(plain).toContain("<h3>Grants and Contributions by Year of Agreement Start</h3>");
    for (const f of [`contracts-${FIRST_CONTRACT_YEAR}.csv`, "contracts-2026.csv", `grants-${FIRST_GRANT_YEAR}.csv`, "grants-2026.csv",
      "contracts-before-2004.csv", "contracts-after-2026.csv", "grants-before-2005.csv", "grants-after-2026.csv"]) {
      expect(plain, f).toContain(link(f));
    }
    expect(plain).not.toContain("contracts-2003.csv");
    expect(plain).not.toContain("grants-2004.csv");
    expect(plain).not.toContain("-undated.csv");
    expect(plain).toContain("<h3>Dates Outside the Years Above</h3>");
    expect(plain).toContain("Its closing times are Eastern time (ET), as CanadaBuys publishes them, with no zone written.");
    expect(plain).toContain("on published contracts and grants they are records reported later");

    const downloads = [
      { file: "contracts-2025.csv", bytes: 262_144_000, rows: 400_000 }, { file: "contracts-2025-2.csv", bytes: 1_048_576, rows: 1200 },
      { file: "contracts-2025-3.csv", bytes: 2048, rows: 3 }, { file: "grants-undated.csv", bytes: 900, rows: 4 },
    ];
    const listed = section(await html("/data", makeFakeAssets({}, { "stats.json": { ...stats, downloads } })), "downloads");
    const year = listed.indexOf('href="/downloads/contracts-2025.csv"');
    const two = listed.indexOf('href="/downloads/contracts-2025-2.csv"');
    const three = listed.indexOf('href="/downloads/contracts-2025-3.csv"');
    expect(year).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(year);
    expect(three).toBeGreaterThan(two);
    expect(listed.indexOf('href="/downloads/contracts-2024.csv"')).toBeGreaterThan(three);
    expect(listed).toContain('<a class="mono" href="/downloads/contracts-2025-2.csv" title="1 MB, 1,200 rows">contracts-2025-2.csv</a>');
    expect(listed).toContain('<a class="mono" href="/downloads/grants-undated.csv" title="900 B, 4 rows">grants-undated.csv</a>');
    expect(listed).not.toContain("contracts-undated.csv");
    expect(fileParts("grants-2026.csv", ["grants-2026-3.csv", "grants-2026.csv", "grants-2026-2.csv", "grants-2025-2.csv"]))
      .toEqual(["grants-2026-2.csv", "grants-2026-3.csv"]);
  });

  it("read in French", async () => {
    const page = nbsp(section(await html("/data?lang=fr"), "downloads"));
    expect(page).toContain("<h3>Contrats publiés par année de la date du contrat</h3>");
    expect(page).toContain("<h3>Subventions et contributions par année de début de l’accord</h3>");
    expect(page).toContain("Ses heures de clôture sont en heure de l’Est (HE)");
    expect(page).not.toContain(EM_DASH);
  });
});

describe("a segment's families and classes", () => {
  it("lists the families its open notices carry, each with its classes, linked to the tender list at that level", async () => {
    const page = await html("/segments/82");
    expect(page).toContain('<h2 id="levels">Families and Classes</h2>');
    expect(page).toContain('<tr class="level-family"><td data-label="Code" class="mono">8211</td><td data-label="Family or class">Writing and translations</td>');
    expect(page).toContain('<a href="/tenders?code=8211">1</a>');
    expect(page).toContain('<tr class="level-class"><td data-label="Code" class="mono">821118</td>');
    expect(page).toContain('<a href="/tenders?code=821118">1</a>');
    // Another segment's levels stay off this page.
    expect(page).not.toContain("4321");
    expect(page).toContain("Names are as the notices give them.");
    expect(page.indexOf('id="levels"')).toBeGreaterThan(page.indexOf("Open Notices"));
    const fr = nbsp(await html("/segments/82?lang=fr"));
    expect(fr).toContain('<h2 id="levels">Familles et classes</h2>');
    expect(fr).toContain("Rédaction et traductions");
    expect(fr).not.toContain(EM_DASH);
  });

  it("names a level without a name as such, and shows no panel without the file or without a family", async () => {
    const page = await html("/segments/82", makeFakeAssets({}, {
      "tenders/open-levels.json": { levels: [{ code: "8211", en: null, fr: null, n: 2 }] },
    }));
    expect(page).toContain('<span class="muted">No name in the notices</span>');
    expect(await html("/segments/82", assetsWithout("tenders/open-levels.json"))).not.toContain('id="levels"');
    expect(await html("/segments/82", makeFakeAssets({}, { "tenders/open-levels.json": { levels: [] } }))).not.toContain('id="levels"');
    // A file that does not read is no file.
    expect(await html("/segments/82", makeFakeAssets({}, { "tenders/open-levels.json": { levels: [{ code: "82", n: 1 }] } })))
      .not.toContain('id="levels"');
  });

  it("orders by notices then code, keeps the first families and classes, and counts the classes left", () => {
    const levels = [
      ...Array.from({ length: LEVEL_FAMILIES_MAX + 2 }, (_, i) => ({ code: `43${String(10 + i).padStart(2, "0")}`, en: null, fr: null, n: i === 3 ? 9 : 1 })),
      ...Array.from({ length: LEVEL_CLASSES_MAX + 3 }, (_, i) => ({ code: `4313${String(10 + i)}`, en: null, fr: null, n: i + 1 })),
      { code: "7210", en: null, fr: null, n: 50 },
    ];
    const { families, total } = segmentLevels(levels, "43");
    expect(total).toBe(LEVEL_FAMILIES_MAX + 2);
    expect(families.length).toBe(LEVEL_FAMILIES_MAX);
    expect(families[0].code).toBe("4313");
    expect(families[1].code).toBe("4310");
    expect(families[0].classes.length).toBe(LEVEL_CLASSES_MAX);
    expect(families[0].classes[0].n).toBe(LEVEL_CLASSES_MAX + 3);
    expect(families[0].more).toBe(3);
    expect(families.every((f) => f.code.startsWith("43"))).toBe(true);
  });
});

describe("the tender list's code filter", () => {
  it("names the level and the code on its chip", async () => {
    const family = await html("/tenders?code=8211");
    expect(family).toContain('<span>UNSPSC family</span> <b>8211 Writing and translations</b>');
    expect(family).toContain('"codes":{"8211":"Writing and translations"}');
    expect(family).toContain('list="code-levels"');
    expect(family).toContain('<datalist id="code-levels"></datalist>');
    // A class no notice named keeps its code alone; two digits are a segment, by its title; a commodity's eight
    // digits have no level here.
    expect(await html("/tenders?code=432115")).toContain('<span>UNSPSC class</span> <b>432115</b>');
    expect(await html("/tenders?code=82")).toContain(
      '<span>UNSPSC segment</span> <b>82 Editorial and Design and Graphic and Fine Art Services</b>');
    expect(await html("/tenders?code=43211509")).toContain('<span>UNSPSC family or class</span> <b>43211509</b>');
    const fr = nbsp(await html("/tenders?code=8211&lang=fr"));
    expect(fr).toContain('<span>Famille UNSPSC</span> <b>8211 Rédaction et traductions</b>');
  });

  it("reads the levels file only for a view with a code", async () => {
    const paths: string[] = [];
    const watched = {
      fetch: async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        paths.push(new URL(url).pathname);
        return fakeAssets.fetch(input as RequestInfo);
      },
    } as unknown as Fetcher;
    await html("/tenders", watched);
    await html("/tenders?province=ON", watched);
    expect(paths).not.toContain("/data/tenders/open-levels.json");
    await html("/tenders?code=7210", watched);
    expect(paths).toContain("/data/tenders/open-levels.json");
    // Without the file the chip shows the code, as before.
    expect(await html("/tenders?code=7210", assetsWithout("tenders/open-levels.json"))).toContain("<b>7210</b>");
  });

  it("finds a name only for a family or class the file holds", () => {
    const levels = levelsFixture.levels;
    expect(codeName(levels, "7210", "en")).toBe("Building and facility construction and maintenance services");
    expect(codeName(levels, "432115", "fr")).toBeNull();
    expect(codeName(levels, "43211509", "en")).toBeNull();
    expect(codeName(null, "7210", "en")).toBeNull();
    expect(codeName(null, "99", "en")).toBeNull();
    expect(codeChip("en", "721015", "Building support services")).toEqual({ label: "UNSPSC class", value: "721015 Building support services" });
    expect([codeLevel("4321"), codeLevel("432115"), codeLevel("43"), codeLevel("43211509")]).toEqual(["family", "class", null, null]);
  });
});
