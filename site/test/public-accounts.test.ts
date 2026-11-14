// The Public Accounts of Canada on a profile and a buyer page (src/public_accounts.tsx): payments in a
// fiscal year, the site's one source of amounts paid, shown apart from every contract figure. The blocks
// ride in the profile shard and the buyer file; a file without one, or with one that does not read, renders
// the page as it was. The Data page's row, the Methodology's section and the two sentences the source made
// untrue, the strings in both languages, and the tables against their column.
import { describe, expect, it } from "vitest";
import { allKeys, rawEntry } from "../src/i18n";
import { app } from "../src/index";
import {
  PA_BUYER_PAYEES, PA_FREE_YEARS, PA_PROFILE_ROWS, buyerPublicAccounts, placeText, profilePublicAccounts,
} from "../src/public_accounts";
import buyer from "./fixtures/buyer-pwgsc-tpsgc.json";
import profiles from "./fixtures/profiles-a00.json";
import { makeFakeAssets, testEnv } from "./assets";
import { expectTablesFit } from "./table-fit";

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const ID = "org-a000000001";

// Cofomo-like rows, invented: two departments, a flagged row, a payee abroad, one with no place.
const PROFILE_BLOCK = {
  v: 1,
  services: [{
    fy: 2025, n: 4, total: 6_269_022 + 1_250_000 + 480_000 + 120_000, d: 2,
    rows: [
      ["pwgsc-tpsgc", "47", 6_269_022, "Exemplar Translation Services Inc", null, "Ottawa", null, "ON", 0],
      ["pa:018", "89", 1_250_000, "Exemplar Translation Services Inc", null, "Montréal", null, "QC", 1],
      ["pwgsc-tpsgc", "87", 480_000, "Exemplar Translation Services Inc", "Services de traduction Exemplar inc.", "London", "Londres", ["United Kingdom", "Royaume-Uni"], 0],
      ["pwgsc-tpsgc", "87", 120_000, "Exemplar Translation Services Inc", null, null, null, null, 0],
    ],
  }],
  buyers: {
    "pwgsc-tpsgc": ["Public Services and Procurement Canada", "Services publics et Approvisionnement Canada"],
    "pa:018": ["Department of National Defence", "Ministère de la Défense nationale"],
  },
  classes: {
    "47": ["Informatics Services", "Services informatiques"], "87": ["Interpretation and Translation Services", "Services d'interprétation et de traduction"],
    "89": ["Other Services", "Autres services"],
  },
  loaded: [2025, 2025],
};

const BUYER_BLOCK = {
  v: 1, fy: 2025,
  classes: [
    { cls: "47", en: "Informatics Services", fr: "Services informatiques", total: 35_098_042, named: [17, 21_593_026], under: [33, 643_992], federal: [4, 12_861_023], withheld: 0 },
    { cls: "45", en: "Health and Welfare Services", fr: "Services de santé et de bien-être", total: 2_400_000, named: [3, 1_900_000], under: [null, 150_000], federal: [0, 0], withheld: 2 },
  ],
  payees: [
    ["Exemplar Translation Services Inc", null, ID, "47", 4_962_296, "Ottawa", null, "ON"],
    ["Nordwave SIA", null, null, "47", 1_200_000, "Riga", "Riga", ["Latvia", "Lettonie"]],
  ],
  named_rows: 20,
  years: [[2025, 37_498_042]],
};

const withBlocks = (profileBlock: unknown, buyerBlock: unknown = undefined) => {
  const shard = structuredClone(profiles) as Record<string, Record<string, unknown>>;
  if (profileBlock !== undefined) shard[ID].public_accounts = profileBlock;
  const file = structuredClone(buyer) as Record<string, unknown>;
  if (buyerBlock !== undefined) file.public_accounts = buyerBlock;
  return testEnv(makeFakeAssets({}, { "profiles/a00.json": shard, "buyers/pwgsc-tpsgc.json": file }));
};

const page = async (path: string, env: object = testEnv()) => (await app.request(path, {}, env)).text();

// The panel, from its section's start to its end.
const panelOf = (html: string) => {
  const head = html.indexOf('<h2 id="public-accounts">');
  if (head < 0) return "";
  const start = html.lastIndexOf("<section", head);
  return html.slice(start, html.indexOf("</section>", head) + "</section>".length);
};
const TILES_NOTE = ' Payments reported in the Public Accounts are not in these totals. They are shown apart, <a href="#public-accounts">further down</a>.';
// The page as it would be without the block: the panel and the tiles' line out.
const without = (html: string) => html.replace(panelOf(html), "").replace(TILES_NOTE, "");
const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));

describe("the Public Accounts on a profile", () => {
  it("renders a profile without a block, or with one that does not read, as it was: no panel, no line, no error", async () => {
    const plain = await page(`/organizations/${ID}`);
    expect(plain).not.toContain("public-accounts");
    expect(plain).not.toContain("Public Accounts");
    for (const bad of [
      { ...PROFILE_BLOCK, v: 2 },
      { ...PROFILE_BLOCK, services: [] },
      { ...PROFILE_BLOCK, services: [{ ...PROFILE_BLOCK.services[0], rows: [["pwgsc-tpsgc", "47", "6,269,022", "X", null, null, null, null, 0]] }] },
      { ...PROFILE_BLOCK, services: [{ ...PROFILE_BLOCK.services[0], rows: [["pwgsc-tpsgc", "47", 1, "X", null, null, null, "Ontario", 0]] }] },
      { ...PROFILE_BLOCK, loaded: [2025] },
      "a string",
      null,
    ]) {
      const res = await app.request(`/organizations/${ID}`, {}, withBlocks(bad));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(plain);
    }
    expect(profilePublicAccounts({})).toBeNull();
  });

  it("adds its own panel and one line under the tiles, and changes nothing else on the page", async () => {
    const plain = await page(`/organizations/${ID}`);
    const html = await page(`/organizations/${ID}`, withBlocks(PROFILE_BLOCK));
    expect(html).not.toBe(plain);
    expect(without(html)).toBe(plain);
    // The tiles and Records by Year read the same: no payment in a total.
    const tiles = (h: string) => between(h, '<section class="tiles"', '<p class="tiles-note">');
    const years = (h: string) => between(h, '<h2 id="years">', "</section>");
    expect(tiles(html)).toBe(tiles(plain));
    expect(years(html)).toBe(years(plain));
    expect(html).toContain(`<p class="tiles-note">Each source is totalled separately (<a href="/methodology#counting">Methodology</a>).${TILES_NOTE}</p>`);
    // After the record panels, before the interest panel.
    expect(html.indexOf('<h2 id="public-accounts">')).toBeGreaterThan(html.indexOf('<h2 id="lobbying">'));
  });

  it("says what the rows are, that they are paid amounts kept apart, that the match is by name, and where they come from", async () => {
    const panel = nbsp(panelOf(await page(`/organizations/${ID}`, withBlocks(PROFILE_BLOCK))));
    expect(panel).toContain('<h2 id="public-accounts">Payments Reported in the Public Accounts</h2>');
    expect(panel).toContain("Payments and accrued charges of $100,000 or more for professional and special services, by department and class of service");
    expect(panel).toContain("These are amounts paid, not contract values. They are never added to the contract totals on this page or anywhere on the site.");
    expect(panel).toContain("Matched to this organization by the payee&#39;s name as the Public Accounts write it, shown on each row. The Public Accounts carry no business number.");
    expect(panel).toContain('<h3>Fiscal year 2025-26 <span class="muted">$8,119,022 from 2 departments</span></h3>');
    for (const head of ["Department", "Class of service", "Payee as written", "Paid"]) expect(panel).toContain(`<button type="button" class="th-sort">${head}</button>`);
    // The department under the buyer's own name and linked; one without a buyer page unlinked.
    expect(panel).toContain('<td data-label="Department"><a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a></td>');
    expect(panel).toContain('<td data-label="Department">Department of National Defence</td>');
    // The payee as written on every row, with its place, and the flag where the province differs.
    expect(panel.match(/Exemplar Translation Services Inc<span class="nw-block muted small">/g)).toHaveLength(4);
    expect(panel).toContain('<span class="nw-block muted small">Ottawa, Ontario</span>');
    expect(panel).toContain('Montréal, Quebec</span><span class="nw-block muted small">Province not among this profile&#39;s addresses</span>');
    expect(panel).toContain('<span class="nw-block muted small">London, United Kingdom</span>');
    expect(panel).toContain('<span class="nw-block muted small">Not stated</span>');
    expect(panel.match(/Province not among/g)).toHaveLength(1);
    expect(panel).toContain('<td data-label="Paid" class="mono num">$6,269,022</td>');
    // The foot: the source and the dataset, the copy not the official record, the licence linked.
    expect(panel).toContain('Public Accounts of Canada, Volume III, professional and special services, fiscal 2025-26. <a href="https://open.canada.ca/data/en/dataset/ac597ff8-ee13-48c3-b315-42e528090af2">The dataset on open.canada.ca</a>');
    expect(panel).toContain('This copy is not the official record. The official version is the <a href="https://www.canada.ca/en/public-services-procurement/services/payments-accounting/public-accounts.html">Public Accounts of Canada</a>.');
    expect(panel).toContain('<a href="https://open.canada.ca/en/open-government-licence-canada">Contains information licensed under the Open Government Licence, Canada.</a>');
    expect(panel).not.toContain(EM_DASH);
    expect(panel).not.toContain(EN_DASH);
  });

  it("reads in French", async () => {
    const html = nbsp(await page(`/organizations/${ID}?lang=fr`, withBlocks(PROFILE_BLOCK)));
    const panel = panelOf(html);
    expect(panel).toContain('<h2 id="public-accounts">Paiements déclarés dans les Comptes publics</h2>');
    expect(panel).toContain("<h3>Exercice 2025-2026 <span class=\"muted\">8 119 022 $ de 2 ministères</span></h3>");
    expect(panel).toContain("Services de traduction Exemplar inc.");
    expect(panel).toContain("Londres, Royaume-Uni");
    expect(panel).toContain("Ministère de la Défense nationale");
    expect(panel).toContain("Cette copie n’est pas la version officielle.");
    expect(panel).toContain("https://www.canada.ca/fr/services-publics-approvisionnement/services/paiements-comptabilite/comptes-publics.html");
    expect(panel).toContain("https://open.canada.ca/data/fr/dataset/ac597ff8-ee13-48c3-b315-42e528090af2");
    expect(html).toContain("Les paiements déclarés dans les Comptes publics ne sont pas compris dans ces totaux.");
  });

  it("says how many rows the year holds when the file lists only the largest", async () => {
    const rows = Array.from({ length: PA_PROFILE_ROWS }, (_, i) => ["pwgsc-tpsgc", "47", 1_000_000 - i, "Exemplar Translation Services Inc", null, "Ottawa", null, "ON", 0]);
    const block = { ...PROFILE_BLOCK, services: [{ fy: 2025, n: 130, total: 99_000_000, d: 1, rows }] };
    expect(nbsp(panelOf(await page(`/organizations/${ID}`, withBlocks(block))))).toContain("The 100 largest of 130 rows for this fiscal year.");
    // Never more years than the free window, newest first.
    const years = [2021, 2022, 2023, 2024, 2025].map((fy) => ({ ...PROFILE_BLOCK.services[0], fy }));
    const read = profilePublicAccounts({ public_accounts: { ...PROFILE_BLOCK, services: years, loaded: [2021, 2025] } });
    expect(read?.services.map((y) => y.fy)).toEqual([2025, 2024, 2023].slice(0, PA_FREE_YEARS));
  });

  it("fits every table to its column from 700 px", async () => {
    expectTablesFit(await page(`/organizations/${ID}`, withBlocks(PROFILE_BLOCK)), "profile with payments");
    expectTablesFit(await page(`/organizations/${ID}?lang=fr`, withBlocks(PROFILE_BLOCK)), "profile with payments, French");
  });
});

describe("the Public Accounts on a buyer page", () => {
  it("renders a buyer file without a block, or with one that does not read, as it was", async () => {
    const plain = await page("/buyers/pwgsc-tpsgc");
    expect(plain).not.toContain("public-accounts");
    for (const bad of [{ ...BUYER_BLOCK, classes: [] }, { ...BUYER_BLOCK, payees: [["x"]] }, { ...BUYER_BLOCK, named_rows: 1 }, { ...BUYER_BLOCK, fy: "2025" }]) {
      const res = await app.request("/buyers/pwgsc-tpsgc", {}, withBlocks(undefined, bad));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(plain);
    }
    expect(buyerPublicAccounts({ public_accounts: BUYER_BLOCK })?.payees).toHaveLength(2);
  });

  it("is the last panel: each class's total as published and its parts, persons as a count, federal payees apart", async () => {
    const plain = await page("/buyers/pwgsc-tpsgc");
    const html = await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, BUYER_BLOCK));
    expect(without(html)).toBe(plain);
    const panel = nbsp(panelOf(html));
    expect(html.indexOf('<h2 id="public-accounts">')).toBeGreaterThan(html.indexOf('<h2 id="years">'));
    expect(panel).toContain('<h2 id="public-accounts">Payments for Professional and Special Services</h2>');
    expect(panel).toContain("What Public Services and Procurement Canada reported paying for professional and special services in fiscal 2025-26, by class of service, as the Public Accounts of Canada publish it. These are amounts paid, never added to contract values.");
    expect(panel).toContain('<td data-label="Class of service">Informatics Services</td><td data-label="Total as published" class="mono num">$35,098,042</td>');
    expect(panel).toContain('<td data-label="Payees listed" class="mono num">17, $21,593,026</td>');
    expect(panel).toContain('<td data-label="Payees under $100,000" class="mono num">33, $643,992<span class="md-only muted small">Federal institutions: 4, $12,861,023</span></td>');
    expect(panel).toContain('<td data-label="Federal institutions" class="mono num mdh">4, $12,861,023</td>');
    // A class whose under-threshold rows give no count shows the amount alone.
    expect(panel).toContain('<td data-label="Payees under $100,000" class="mono num">$150,000<span');
    // The persons withheld: a count, never an amount of their own.
    expect(panel).toContain("2 payees in these classes read as private individuals, or are withheld by the Public Accounts, and are not named. Their payments are in the class totals.");
    expect(panel).toContain("Payments to other federal institutions pay for services between departments.");
    expect(panel).toContain("<h3>Payees Listed by Name, Fiscal 2025-26</h3>");
    expect(panel).toContain(`<a href="/organizations/${ID}#public-accounts">Exemplar Translation Services Inc</a><span class="nw-block muted small">Ottawa, Ontario</span>`);
    expect(panel).toContain('Nordwave SIA<span class="nw-block muted small">Riga, Latvia</span>');
    expect(panel).toContain("The 2 largest of 20 rows for this fiscal year.");
    expect(panel).toContain("This copy is not the official record.");
    expect(panel).toContain("Contains information licensed under the Open Government Licence, Canada.");
    // The page's own tiles and years are as they were.
    expect(between(html, '<section class="tiles"', '<p class="tiles-note">')).toBe(between(plain, '<section class="tiles"', '<p class="tiles-note">'));
  });

  it("reads in French and fits every table to its column from 700 px", async () => {
    const html = await page("/buyers/pwgsc-tpsgc?lang=fr", withBlocks(undefined, BUYER_BLOCK));
    const panel = nbsp(panelOf(html));
    expect(panel).toContain("Paiements pour services professionnels et spéciaux");
    expect(panel).toContain("17, 21 593 026 $");
    expect(panel).toContain("Riga, Lettonie");
    expect(panel).toContain("2 bénéficiaires de ces catégories semblent être des particuliers, ou leur nom est retenu par les Comptes publics, et ne sont pas nommés");
    expectTablesFit(html, "buyer page with payments, French");
    expectTablesFit(await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, BUYER_BLOCK)), "buyer page with payments");
    expect(PA_BUYER_PAYEES).toBe(50);
  });
});

describe("the Public Accounts on the Data and Methodology pages", () => {
  it("lists the source with its publisher and says the files are not the official record", async () => {
    const html = nbsp(await page("/data"));
    expect(html).toContain('<a href="https://open.canada.ca/data/en/dataset/ac597ff8-ee13-48c3-b315-42e528090af2">Public Accounts of Canada, professional and special services</a>');
    expect(html).toContain("The Public Accounts files say they are not the official record. The official version is the <a href=\"https://www.canada.ca/en/public-services-procurement/services/payments-accounting/public-accounts.html\">Public Accounts of Canada</a>, prepared by the Receiver General for Canada.");
    expect(html).toContain("Public Accounts of Canada files: professional and special services");
    const fr = nbsp(await page("/data?lang=fr"));
    expect(fr).toContain("Comptes publics du Canada, services professionnels et spéciaux");
  });

  it("states the rules in a section of their own, and the two sentences the source made untrue are rewritten", async () => {
    const html = nbsp(await page("/methodology"));
    expect(html).toContain('<a href="#public-accounts">Payments in the Public Accounts</a>');
    expect(html).toContain('<h2 id="public-accounts">Payments in the Public Accounts</h2>');
    expect(html).toContain("The Public Accounts are the only source on the site that reports amounts paid.");
    expect(html).toContain("The Public Accounts report by fiscal year (April 1 to March 31), and their sections keep that year.");
    expect(html).toContain("Amounts paid come from the Public Accounts of Canada alone; they are shown apart, by fiscal year, and never added to a contract or agreement value.");
    expect(html).not.toContain("Fiscal years appear only in source file names");
    expect(html).not.toContain("The sources do not report amounts paid");
    // The counting rule sits before the line that sources are never added.
    expect(html.indexOf("Public Accounts payments: a payee&#39;s payments")).toBeLessThan(html.indexOf("Sources are never added together."));
    const fr = nbsp(await page("/methodology?lang=fr"));
    expect(fr).toContain("Paiements dans les Comptes publics");
    expect(fr).toContain("Les montants versés proviennent des seuls Comptes publics du Canada");
    expect(fr).not.toContain("Les exercices financiers n’apparaissent que dans le nom des fichiers sources.");
  });

  it("keeps its strings in both languages, with no dash and no word that judges", () => {
    const keys = allKeys().filter((k) => k.startsWith("pa.") || k.startsWith("methodology.pa_") || k.includes("public_accounts") ||
      k === "data.src.pa_services" || k === "data.pa_official");
    expect(keys.length).toBeGreaterThanOrEqual(40);
    const words = /waste|overpaid|excessive|lavish|suspicious|questionable|red flag|scandal|favou?r|untendered|sole source|error/i;
    const mots = /gaspill|excessi|suspect|douteu|favori|scandal|erreur/i;
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      for (const text of [en, fr]) {
        expect(text, key).not.toContain(EM_DASH);
        expect(text, key).not.toContain(EN_DASH);
      }
      expect(en, key).not.toMatch(words);
      expect(fr, key).not.toMatch(mots);
    }
  });

  it("writes a place as the file gives it", () => {
    expect(placeText("en", "Ottawa", null, "ON")).toBe("Ottawa, Ontario");
    expect(placeText("fr", "London", "Londres", ["United Kingdom", "Royaume-Uni"])).toBe("Londres, Royaume-Uni");
    expect(placeText("en", null, null, null)).toBe("Not stated");
  });
});
