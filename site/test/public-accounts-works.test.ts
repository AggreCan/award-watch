// The works file of the Public Accounts (src/public_accounts.tsx, slice 2): contracts of $250,000 or more
// for land, buildings and works, with what the department spent on each in the fiscal year and to date. On a
// profile, a table under its own heading in the payments panel; on a buyer page, a panel of its own after the
// payments for services, with the department's line under the threshold. Never summed with the services
// payments nor with any contract value. A block without the works part (every file before the pipeline writes
// it) renders as it did; a works part that does not read is left out and the services part stays.
import { describe, expect, it } from "vitest";
import { allKeys, rawEntry } from "../src/i18n";
import { app } from "../src/index";
import { PA_BUYER_WORKS, PA_WORKS_DATASET, buyerPublicAccounts, profilePublicAccounts } from "../src/public_accounts";
import buyer from "./fixtures/buyer-pwgsc-tpsgc.json";
import profiles from "./fixtures/profiles-a00.json";
import { makeFakeAssets, testEnv } from "./assets";
import { expectTablesFit } from "./table-fit";

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const ID = "org-a000000001";
const WORKS_DATASET = "https://open.canada.ca/data/en/dataset/8776785b-445c-42bb-bb53-c29a1bff44dd";

// The services block slice 1's test uses, invented.
const SERVICES_PART = {
  services: [{
    fy: 2025, n: 2, total: 6_269_022 + 1_250_000, d: 2,
    rows: [
      ["pwgsc-tpsgc", "47", 6_269_022, "Exemplar Translation Services Inc", null, "Ottawa", null, "ON", 0],
      ["pa:018", "89", 1_250_000, "Exemplar Translation Services Inc", null, "Montréal", null, "QC", 1],
    ],
  }],
  classes: { "47": ["Informatics Services", "Services informatiques"], "89": ["Other Services", "Autres services"] },
};
// [department key, contracted, spent in the year, spent to date, contractor, in French, city, in French, place,
//  description, in French, project city, in French, project place, flag]
const WORKS_ROWS = [
  ["pwgsc-tpsgc", 25_000_000, 5_000_000, 20_000_000, "Exemplar Translation Services Inc", null, "Ottawa", null, "ON",
    "Wharf repairs", "Réparation du quai", "Halifax", null, "NS", 0],
  ["pa:018", 4_500_000, -6_606, 500_000, "Exemplar Translation Services Inc", null, "Montréal", null, "QC",
    "Building envelope repairs", "Réparation de l'enveloppe du bâtiment", "Various locations", "Divers endroits",
    ["Various provinces", "Plusieurs provinces"], 1],
  ["pwgsc-tpsgc", 900_000, 0, 450_000, "Exemplar Translation Services Inc", "Services de traduction Exemplar inc.", "London", "Londres",
    ["United Kingdom", "Royaume-Uni"], "Embassy chancery renewal", null, "Berlin", null, ["Germany", "Allemagne"], 0],
];
const WORKS_PART = [{ fy: 2025, n: 3, rows: WORKS_ROWS }];
const DEPTS = {
  "pwgsc-tpsgc": ["Public Services and Procurement Canada", "Services publics et Approvisionnement Canada"],
  "pa:018": ["Department of National Defence", "Ministère de la Défense nationale"],
};
const SERVICES_BLOCK = { v: 1, ...SERVICES_PART, buyers: DEPTS, loaded: [2025, 2025] };
const BOTH = { ...SERVICES_BLOCK, works: WORKS_PART };
const WORKS_ONLY = { v: 1, services: [], works: WORKS_PART, buyers: DEPTS, classes: {}, loaded: [2025, 2025] };

const BUYER_SERVICES = {
  v: 1, fy: 2025,
  classes: [{ cls: "47", en: "Informatics Services", fr: "Services informatiques", total: 35_098_042, named: [17, 21_593_026], under: [33, 643_992], federal: [4, 12_861_023], withheld: 0 }],
  payees: [["Exemplar Translation Services Inc", null, ID, "47", 4_962_296, "Ottawa", null, "ON"]],
  named_rows: 17,
  years: [[2025, 35_098_042]],
};
// [contractor, in French, organization id, city, in French, place, description, in French, project city, in French,
//  project place, contracted, spent in the year, spent to date, a federal institution (1) or not (0)]
const BUYER_WORKS = {
  fy: 2025, n: 40,
  rows: [
    ["Exemplar Translation Services Inc", null, ID, "Ottawa", null, "ON", "Laboratory renewal", "Renouvellement du laboratoire",
      "Ottawa", null, "ON", 12_000_000, 3_000_000, 9_000_000, 0],
    ["Department of Sample Works", "Ministère des Travaux exemplaires", null, "Gatineau", null, "QC", "Fit-up", "Aménagement",
      "Gatineau", null, "QC", 2_000_000, 1_000_000, 1_500_000, 1],
    ["Nordwave SIA", null, null, "Riga", "Riga", ["Latvia", "Lettonie"], "Consulate fit-up", "Aménagement du consulat", "New York", null,
      ["United States of America", "États-Unis d'Amérique"], 1_500_000, 750_000, 750_000, 0],
  ],
  under: [12, 1_234_567],
};
const BUYER_BOTH = { ...BUYER_SERVICES, works: BUYER_WORKS };
const BUYER_WORKS_ONLY = { v: 1, fy: 2025, classes: [], payees: [], named_rows: 0, years: [], works: BUYER_WORKS };

const withBlocks = (profileBlock: unknown, buyerBlock: unknown = undefined) => {
  const shard = structuredClone(profiles) as Record<string, Record<string, unknown>>;
  if (profileBlock !== undefined) shard[ID].public_accounts = profileBlock;
  const file = structuredClone(buyer) as Record<string, unknown>;
  if (buyerBlock !== undefined) file.public_accounts = buyerBlock;
  return testEnv(makeFakeAssets({}, { "profiles/a00.json": shard, "buyers/pwgsc-tpsgc.json": file }));
};

const page = async (path: string, env: object = testEnv()) => (await app.request(path, {}, env)).text();

// A panel, from its section's start to its end, by its heading's id.
const panelOf = (html: string, id = "public-accounts") => {
  const head = html.indexOf(`<h2 id="${id}">`);
  if (head < 0) return "";
  const start = html.lastIndexOf("<section", head);
  return html.slice(start, html.indexOf("</section>", head) + "</section>".length);
};
const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
const LEAD = "Contracts of $250,000 or more ($25,000 or more for cost-plus contracts) for land, buildings and works, with what the department spent on each in fiscal 2025-26 and to date, as the Public Accounts of Canada report them.";
const APART = "The amount contracted is the Public Accounts&#39; own figure and is not added to the contract values of the other sources. Spending is never added to an amount contracted, nor to the payments for services above: a works contract awarded through Public Services and Procurement Canada can be counted in both.";
const APART_ALONE = "The amount contracted is the Public Accounts&#39; own figure and is not added to the contract values of the other sources. Spending is never added to an amount contracted, nor to payments for professional and special services: a works contract awarded through Public Services and Procurement Canada can be counted in both.";

describe("the works contracts on a profile", () => {
  it("renders a block without the works part as it did, and leaves out a works part that does not read", async () => {
    const services = await page(`/organizations/${ID}`, withBlocks(SERVICES_BLOCK));
    expect(services).toContain('<h2 id="public-accounts">');
    expect(services).not.toContain("Works contracts");
    for (const bad of [
      "works", [{ fy: 2025, n: 1, rows: [["pwgsc-tpsgc", "25,000,000", 0, 0, "X", null, null, null, null, "D", null, null, null, null, 0]] }],
      [{ fy: 2025, n: 1, rows: [WORKS_ROWS[0].slice(0, 14)] }], [{ fy: "2025", n: 3, rows: WORKS_ROWS }], [{ fy: 2025, n: 1, rows: WORKS_ROWS }],
    ]) {
      const res = await app.request(`/organizations/${ID}`, {}, withBlocks({ ...SERVICES_BLOCK, works: bad }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(services);
    }
    // No services and no readable works: no panel at all.
    const plain = await page(`/organizations/${ID}`);
    for (const bad of [{ ...WORKS_ONLY, works: [] }, { ...WORKS_ONLY, works: "x" }]) {
      expect(await page(`/organizations/${ID}`, withBlocks(bad))).toBe(plain);
    }
    expect(profilePublicAccounts({ public_accounts: BOTH })?.works).toHaveLength(1);
    expect(profilePublicAccounts({ public_accounts: SERVICES_BLOCK })?.works).toEqual([]);
  });

  it("puts the works table under its own heading after the payments, the services part as it was", async () => {
    const services = panelOf(await page(`/organizations/${ID}`, withBlocks(SERVICES_BLOCK)));
    const html = await page(`/organizations/${ID}`, withBlocks(BOTH));
    const panel = nbsp(panelOf(html));
    // Everything before the works heading is the services panel's own content, unchanged.
    expect(panelOf(html).slice(0, panelOf(html).indexOf("<h3>Works contracts</h3>"))).toBe(services.slice(0, services.indexOf('<div class="panel-foot">')));
    expect(panel).toContain("<h3>Works contracts</h3>");
    expect(panel).toContain(`<p class="muted small">${LEAD}</p>`);
    expect(panel).toContain(`<p class="muted small">${APART}</p>`);
    for (const head of ["Department", "Project", "Amount contracted", "Spent in 2025-26", "Spent to date"]) {
      expect(panel).toContain(`<button type="button" class="th-sort">${head}</button>`);
    }
    // The project and its place; the contractor as written with its own place, on every row; the flag where it differs.
    expect(panel).toContain('Wharf repairs<span class="nw-block muted small">Halifax, Nova Scotia</span>');
    expect(panel).toContain('Building envelope repairs<span class="nw-block muted small">Various locations, Various provinces</span>');
    expect(panel).toContain('Embassy chancery renewal<span class="nw-block muted small">Berlin, Germany</span>');
    expect(panel.match(/Contractor as written: Exemplar Translation Services Inc, /g)).toHaveLength(3);
    expect(panel).toContain("Contractor as written: Exemplar Translation Services Inc, London, United Kingdom");
    expect(panel.match(/Province not among this profile&#39;s addresses/g)).toHaveLength(2);
    expect(panel).toContain('<td data-label="Amount contracted" class="mono num">$25,000,000</td>');
    expect(panel).toContain('<td data-label="Spent in 2025-26" class="mono num">-$6,606<span class="md-only muted small">Spent to date: $500,000</span></td>');
    expect(panel).toContain('<td data-label="Spent to date" class="mono num mdh">$20,000,000</td>');
    expect(panel).toContain('<td data-label="Department"><a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a></td>');
    // The foot names both files, each with its dataset, then the official record and the licence once.
    expect(panel).toContain("Public Accounts of Canada, Volume III, professional and special services, fiscal 2025-26.");
    expect(panel).toContain(`Public Accounts of Canada, Volume III, acquisition of land, buildings and works, fiscal 2025-26. <a href="${WORKS_DATASET}">The dataset on open.canada.ca</a>`);
    expect(panel.match(/This copy is not the official record/g)).toHaveLength(1);
    expect(panel.match(/Contains information licensed under the Open Government Licence, Canada/g)).toHaveLength(1);
    expect(panel).not.toContain(EM_DASH);
    expect(panel).not.toContain(EN_DASH);
  });

  it("adds no works figure to a total: the year's payments, the tiles and Records by Year read the same", async () => {
    const services = await page(`/organizations/${ID}`, withBlocks(SERVICES_BLOCK));
    const html = await page(`/organizations/${ID}`, withBlocks(BOTH));
    const tiles = (h: string) => between(h, '<section class="tiles"', '<p class="tiles-note">');
    const years = (h: string) => between(h, '<h2 id="years">', "</section>");
    expect(tiles(html)).toBe(tiles(services));
    expect(years(html)).toBe(years(services));
    const panel = nbsp(panelOf(html));
    expect(panel).toContain('<h3>Fiscal year 2025-26 <span class="muted">$7,519,022 from 2 departments</span></h3>');
    // No sum of the works rows, nor of the works and the services together, anywhere on the page.
    for (const sum of ["$30,400,000", "$4,993,394", "$20,950,000", "$37,919,022"]) expect(nbsp(html)).not.toContain(sum);
  });

  it("shows a profile with works contracts alone, without the services lines", async () => {
    const html = await page(`/organizations/${ID}`, withBlocks(WORKS_ONLY));
    const panel = nbsp(panelOf(html));
    expect(panel).toContain('<h2 id="public-accounts">Payments Reported in the Public Accounts</h2>');
    expect(panel).not.toContain("Payments and accrued charges of $100,000 or more");
    expect(panel).not.toContain("These are amounts paid, not contract values.");
    expect(panel).not.toContain("<h3>Fiscal year");
    expect(panel).toContain("Matched to this organization by the payee&#39;s name as the Public Accounts write it");
    expect(panel).toContain("<h3>Works contracts</h3>");
    expect(panel).toContain(APART_ALONE);
    expect(panel).not.toContain("services above");
    expect(panel).not.toContain("professional and special services, fiscal");
    expect(panel).toContain(`<a href="${WORKS_DATASET}">`);
    expect(html).toContain("Payments reported in the Public Accounts are not in these totals.");
  });

  it("reads in French", async () => {
    const panel = nbsp(panelOf(await page(`/organizations/${ID}?lang=fr`, withBlocks(BOTH))));
    expect(panel).toContain("<h3>Marchés de travaux</h3>");
    expect(panel).toContain("Marchés de 250 000 $ ou plus (25 000 $ ou plus pour les marchés à prix coûtant majoré) visant des terrains, des bâtiments et des travaux, avec ce que le ministère a dépensé pour chacun au cours de l’exercice 2025-2026 et à ce jour");
    expect(panel).toContain("Le montant du marché est celui des Comptes publics");
    for (const head of ["Ministère", "Projet", "Montant du marché", "Dépensé en 2025-2026", "Dépensé à ce jour"]) {
      expect(panel).toContain(`<button type="button" class="th-sort">${head}</button>`);
    }
    expect(panel).toContain("Réparation du quai");
    expect(panel).toContain("Divers endroits, Plusieurs provinces");
    expect(panel).toContain("Entrepreneur tel qu’inscrit : Services de traduction Exemplar inc., Londres, Royaume-Uni");
    expect(panel).toContain("25 000 000 $");
    expect(panel).toContain("Comptes publics du Canada, volume III, acquisition de terrains, bâtiments et travaux, exercice 2025-2026.");
    expect(panel).toContain("https://open.canada.ca/data/fr/dataset/8776785b-445c-42bb-bb53-c29a1bff44dd");
  });

  it("fits every table to its column at every width, in both languages, with and without the services part", async () => {
    for (const block of [BOTH, WORKS_ONLY]) {
      expectTablesFit(await page(`/organizations/${ID}`, withBlocks(block)), "profile with works");
      expectTablesFit(await page(`/organizations/${ID}?lang=fr`, withBlocks(block)), "profile with works, French");
    }
  });
});

describe("the works contracts on a buyer page", () => {
  it("renders a buyer file without the works part as it did, and leaves out a works part that does not read", async () => {
    const services = await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, BUYER_SERVICES));
    expect(services).toContain('<h2 id="public-accounts">');
    expect(services).not.toContain("public-accounts-works");
    for (const bad of [{ ...BUYER_WORKS, rows: [["x"]] }, { ...BUYER_WORKS, rows: [BUYER_WORKS.rows[0].slice(0, 14)] }, { ...BUYER_WORKS, n: 1 },
      { ...BUYER_WORKS, under: [1] }, "works"]) {
      const res = await app.request("/buyers/pwgsc-tpsgc", {}, withBlocks(undefined, { ...BUYER_SERVICES, works: bad }));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(services);
    }
    const plain = await page("/buyers/pwgsc-tpsgc");
    expect(await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, { ...BUYER_WORKS_ONLY, works: "x" }))).toBe(plain);
    expect(buyerPublicAccounts({ public_accounts: BUYER_BOTH })?.works?.rows).toHaveLength(3);
    expect(buyerPublicAccounts({ public_accounts: BUYER_SERVICES })?.works).toBeNull();
  });

  it("adds a panel of its own after the payments: the largest contracts and the line under the threshold", async () => {
    const services = await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, BUYER_SERVICES));
    const html = await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, BUYER_BOTH));
    // The page is the services page with one more panel, after the payments panel.
    expect(html.replace(panelOf(html, "public-accounts-works"), "")).toBe(services);
    expect(html.indexOf('<h2 id="public-accounts-works">')).toBeGreaterThan(html.indexOf('<h2 id="public-accounts">'));
    const panel = nbsp(panelOf(html, "public-accounts-works"));
    expect(panel).toContain('<h2 id="public-accounts-works">Works Contracts in the Public Accounts, Fiscal 2025-26</h2>');
    expect(panel).toContain(`<p>${LEAD}</p>`);
    expect(panel).toContain(`<p class="muted small">${APART}</p>`);
    for (const head of ["Contractor as written", "Project", "Amount contracted", "Spent in 2025-26", "Spent to date"]) {
      expect(panel).toContain(`<button type="button" class="th-sort">${head}</button>`);
    }
    expect(panel).toContain(`<a href="/organizations/${ID}#public-accounts">Exemplar Translation Services Inc</a><span class="nw-block muted small">Ottawa, Ontario</span>`);
    // A federal institution as the contractor: unlinked, and said so on its row.
    expect(panel).toContain('Department of Sample Works<span class="nw-block muted small">Gatineau, Quebec</span><span class="nw-block muted small">A federal institution, not an organization on the site</span>');
    expect(panel.match(/A federal institution, not an organization on the site/g)).toHaveLength(1);
    expect(panel).toContain('Consulate fit-up<span class="nw-block muted small">New York, United States of America</span>');
    expect(panel).toContain('<td data-label="Amount contracted" class="mono num">$12,000,000</td>');
    expect(panel).toContain("The 3 largest of 40 rows for this fiscal year.");
    expect(panel).toContain("Contracts under $250,000: 12 contractors, $1,234,567 spent in fiscal 2025-26.");
    expect(panel).toContain(`Public Accounts of Canada, Volume III, acquisition of land, buildings and works, fiscal 2025-26. <a href="${WORKS_DATASET}">`);
    expect(panel).toContain("This copy is not the official record.");
    expect(panel).toContain("Contains information licensed under the Open Government Licence, Canada.");
    expect(panel).not.toContain("professional and special services, fiscal");
    // The services panel's years and the page's tiles read the same: no works figure in them.
    expect(between(html, '<section class="tiles"', '<p class="tiles-note">')).toBe(between(services, '<section class="tiles"', '<p class="tiles-note">'));
    expect(nbsp(html)).not.toContain("$15,500,000");
  });

  it("states one contractor, or no count, as the line under the threshold gives it", async () => {
    const one = nbsp(panelOf(await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, { ...BUYER_BOTH, works: { ...BUYER_WORKS, under: [1, 261_154] } })), "public-accounts-works"));
    expect(one).toContain("Contracts under $250,000: 1 contractor, $261,154 spent in fiscal 2025-26.");
    const none = nbsp(panelOf(await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, { ...BUYER_BOTH, works: { ...BUYER_WORKS, under: [null, 9_000] } })), "public-accounts-works"));
    expect(none).toContain("Contracts under $250,000: $9,000 spent in fiscal 2025-26.");
    // A department with the line alone.
    const alone = nbsp(panelOf(await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, { ...BUYER_WORKS_ONLY, works: { fy: 2025, n: 0, rows: [], under: [3, 479_541] } })), "public-accounts-works"));
    expect(alone).toContain("Contracts under $250,000: 3 contractors, $479,541 spent in fiscal 2025-26.");
    expect(alone).not.toContain("<table");
  });

  it("shows a department with works contracts alone without the services panel", async () => {
    const html = await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, BUYER_WORKS_ONLY));
    expect(html).not.toContain('<h2 id="public-accounts">');
    const panel = nbsp(panelOf(html, "public-accounts-works"));
    expect(panel).toContain(APART_ALONE);
    expect(panel).not.toContain("services above");
  });

  it("reads in French and fits every table to its column at every width", async () => {
    const html = await page("/buyers/pwgsc-tpsgc?lang=fr", withBlocks(undefined, BUYER_BOTH));
    const panel = nbsp(panelOf(html, "public-accounts-works"));
    expect(panel).toContain("Marchés de travaux dans les Comptes publics, exercice 2025-2026");
    expect(panel).toContain("Entrepreneur tel qu’inscrit");
    expect(panel).toContain("Ministère des Travaux exemplaires");
    expect(panel).toContain("Une institution fédérale, qui n’est pas une organisation sur le site");
    // A place is as the file writes it: its apostrophe stays straight.
    expect(panel).toContain("New York, États-Unis d&#39;Amérique");
    expect(panel).toContain("Marchés de moins de 250 000 $ : 12 entrepreneurs, 1 234 567 $ dépensés au cours de l’exercice 2025-2026.");
    expect(panel).toContain("Les 3 plus grandes des 40 lignes de cet exercice.");
    for (const block of [BUYER_BOTH, BUYER_WORKS_ONLY]) {
      expectTablesFit(await page("/buyers/pwgsc-tpsgc", withBlocks(undefined, block)), "buyer page with works");
      expectTablesFit(await page("/buyers/pwgsc-tpsgc?lang=fr", withBlocks(undefined, block)), "buyer page with works, French");
    }
    expect(PA_BUYER_WORKS).toBe(25);
    expect(PA_WORKS_DATASET).toBe("8776785b-445c-42bb-bb53-c29a1bff44dd");
  });
});

describe("the works file on the Data and Methodology pages, and its strings", () => {
  it("lists the works file as a source with its dataset, and in the licence row", async () => {
    const html = nbsp(await page("/data"));
    expect(html).toContain(`<a href="${WORKS_DATASET}">Public Accounts of Canada, acquisition of land, buildings and works</a>`);
    expect(html).toContain("Public Accounts of Canada files: professional and special services; acquisition of land, buildings and works");
    const fr = nbsp(await page("/data?lang=fr"));
    expect(fr).toContain("Comptes publics du Canada, acquisition de terrains, bâtiments et travaux");
  });

  it("states the works file's thresholds and that its figures are never added to another", async () => {
    const html = nbsp(await page("/methodology"));
    expect(html).toContain("and of works contracts of $250,000 or more");
    expect(html).toContain("Works contracts are listed from $250,000, or $25,000 for cost-plus contracts.");
    expect(html).toContain("Spending is never added to an amount contracted, nor to the payments for services");
    const fr = nbsp(await page("/methodology?lang=fr"));
    expect(fr).toContain("des marchés de travaux de 250 000 $ ou plus");
  });

  it("keeps the works strings in both languages, with no dash and no word that judges", () => {
    // The keys this file adds, and the four whose text it changes.
    const keys = ["pa.works_head", "pa.works_lead", "pa.works_apart", "pa.works_apart_alone", "pa.works_under", "pa.works_under_one",
      "pa.works_under_nocount", "pa.works_source", "pa.buyer_works", "pa.col_project", "pa.col_contracted", "pa.col_spent_year",
      "pa.col_spent_to_date", "pa.col_contractor", "pa.works_federal", "data.src.pa_works", "methodology.pa_works", "data.lic.public_accounts",
      "methodology.src_public_accounts", "methodology.pa_thresholds"] as const;
    for (const k of keys) expect(allKeys()).toContain(k);
    const words = /waste|overpaid|excessive|lavish|suspicious|questionable|red flag|scandal|favou?r|untendered|sole source|error/i;
    const mots = /gaspill|excessi|suspect|douteu|favori|scandal|erreur/i;
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      for (const text of [en, fr]) {
        expect(text, key).not.toContain(EM_DASH);
        expect(text, key).not.toContain(EN_DASH);
        // French as the files write it: plain spaces and straight apostrophes in the source strings.
        expect(text, key).not.toMatch(/[  ’]/);
      }
      expect(en, key).not.toMatch(words);
      expect(fr, key).not.toMatch(mots);
    }
  });
});
