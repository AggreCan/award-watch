// One buyer per institution (the pipeline's sources/buyers.merge, 2026-11-06):
// the buyers list shows the departments, agencies and Crown corporations, and
// apart from them the institutions only the lobbying registry names; a buyer
// page lists the other names it appears under, a former one marked; a retired
// buyer id redirects on the API as it does on the page.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { makeFakeAssets, testEnv } from "./assets";
import buyer from "./fixtures/buyer-pwgsc-tpsgc.json";
import buyers from "./fixtures/buyers-index.json";

const HOUSE = {
  ...buyers.buyers[0], id: "members-of-the-house-of-commons", name_en: "Members of the House of Commons",
  name_fr: "Députés de la Chambre des communes", acronym_en: null, acronym_fr: null, kind: "institution",
  n_tenders: 0, n_open_tenders: 0, n_awards: 0, n_history: 0, n_contracts: 0, n_grants: 0,
  total_awards: null, total_history: null, total_contracts: null, total_grants: null, n_lobbying: 412,
};
const ALIASES = [
  { name: "Public Works and Government Services Canada", note: "former" },
  { name: "Department of Public Works and Government Services (PSPC)", note: null },
];

const merged = (files: Record<string, unknown> = {}) => testEnv(makeFakeAssets({}, {
  "buyers/index.json": { buyers: [...buyers.buyers, HOUSE] },
  "buyers/pwgsc-tpsgc.json": { ...buyer, aliases: ALIASES },
  "buyers/members-of-the-house-of-commons.json": {
    ...buyer, buyer: { ...HOUSE, ckan_org: null, department_number: null }, years: [], top_organizations: {},
    open_tenders: 0, recent_awards: [], expiring: undefined, aliases: [],
  },
  ...files,
}));

const page = async (path: string, env = merged()) => {
  const res = await app.request(path, {}, env);
  return { status: res.status, html: await res.text() };
};

describe("the buyers list", () => {
  it("lists the departments first and the institutions only the lobbying registry names apart", async () => {
    const { status, html } = await page("/buyers");
    expect(status).toBe(200);
    const departments = html.indexOf("Departments, Agencies and Crown Corporations");
    const institutions = html.indexOf("Other Institutions");
    expect(departments).toBeGreaterThan(-1);
    expect(institutions).toBeGreaterThan(departments);
    const house = html.indexOf('href="/buyers/members-of-the-house-of-commons"');
    expect(house).toBeGreaterThan(institutions);
    expect(html.indexOf('href="/buyers/pwgsc-tpsgc"')).toBeLessThan(institutions);
    expect(html).toContain("Lobbying reports");
    expect(html.slice(house)).toContain(">412<");
  });

  it("keeps one plain list, titled as before, when no institution is listed", async () => {
    const { html } = await page("/buyers", testEnv());
    expect(html).toContain("All Buyers");
    expect(html).not.toContain("Other Institutions");
  });

  it("speaks French on the French list", async () => {
    const { html } = await page("/buyers?lang=fr");
    expect(html).toContain("Ministères, organismes et sociétés d’État");
    expect(html).toContain("Autres institutions");
    expect(html).toContain("Députés de la Chambre des communes");
  });
});

describe("a buyer page", () => {
  it("lists the names the buyer also appears under, a former one marked", async () => {
    const { status, html } = await page("/buyers/pwgsc-tpsgc");
    expect(status).toBe(200);
    expect(html).toContain("Also appears as:");
    expect(html).toContain("Public Works and Government Services Canada");
    expect(html).toContain("(former name)");
    expect(html).toContain("Department of Public Works and Government Services (PSPC)");
    const fr = await page("/buyers/pwgsc-tpsgc?lang=fr");
    expect(fr.html).toContain("Apparaît aussi sous");
    expect(fr.html).toContain("(ancien nom)");
  });

  it("says nothing of other names when the file lists none or comes from an older export", async () => {
    const { html } = await page("/buyers/pwgsc-tpsgc", testEnv());
    expect(html).not.toContain("Also appears as");
  });

  it("names an institution's kind and the lobbying reports that name it", async () => {
    const { status, html } = await page("/buyers/members-of-the-house-of-commons");
    expect(status).toBe(200);
    expect(html).toContain("Institution named in lobbying reports");
    expect(html).toContain("Lobbying communication reports naming this institution: 412.");
  });

  it("refuses a file whose list of other names is malformed, as any unreadable buyer file", async () => {
    for (const aliases of [[{ name: 5, note: null }], [{ name: "", note: null }], "Parks Canada"]) {
      const env = merged({ "buyers/pwgsc-tpsgc.json": { ...buyer, aliases } });
      expect((await page("/buyers/pwgsc-tpsgc", env)).status, JSON.stringify(aliases)).toBe(404);
    }
  });
});

describe("a retired buyer id on the API", () => {
  it("answers 301 to the live id's API path, as the page does", async () => {
    const res = await app.request("/api/buyers/public-works-and-government-services-canada", {}, merged());
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/api/buyers/pwgsc-tpsgc");
    const live = await app.request("/api/buyers/pwgsc-tpsgc", {}, merged());
    expect(live.status).toBe(200);
    expect(((await live.json()) as { aliases: unknown[] }).aliases).toEqual(ALIASES);
  });

  it("is a 404 when no alias names it or the aliases file is missing", async () => {
    expect((await app.request("/api/buyers/no-such-buyer", {}, merged())).status).toBe(404);
    const env = merged({ "buyers/aliases.json": undefined });
    expect((await app.request("/api/buyers/public-works-and-government-services-canada", {}, env)).status).toBe(404);
  });
});

describe("the methodology", () => {
  it("says how buyers are merged, in both languages", async () => {
    expect((await page("/methodology")).html).toContain("whatever name it appears under");
    expect((await page("/methodology?lang=fr")).html).toContain("quel que soit le nom sous lequel elle paraît");
  });
});
