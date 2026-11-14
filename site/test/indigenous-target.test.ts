// The mandatory minimum 5% Indigenous procurement target on a buyer page (src/indigenous_target.tsx): the
// institution's plan, gaps and result as it reported them and as Indigenous Services Canada published them,
// kept apart from every contract figure. The block rides in the buyer file; a file without one, or with one
// that does not read, renders the page byte for byte as it was. The Data page's row, the Methodology's
// section, the strings in both languages, and the tables against their column.
//
// The blocks are the export's own for real rows of the published files (Open Government Licence - Canada):
// PSPC_BLOCK is Public Services and Procurement Canada's as written for the 2025-26 plan and the 2024-25
// results; MIXED takes rows of other institutions (Health Canada, Indigenous Services Canada, the Federal
// Economic Development Agency for Northern Ontario, the Canadian Centre for Occupational Health and Safety) to
// show every state on one page.
import { describe, expect, it } from "vitest";
import { allKeys, rawEntry } from "../src/i18n";
import { app } from "../src/index";
import { IPT_GAP_ROWS, IPT_PLAN_ROWS, buyerIndigenousTarget, figureText, publishedPct, statedMoney } from "../src/indigenous_target";
import buyer from "./fixtures/buyer-pwgsc-tpsgc.json";
import { makeFakeAssets, testEnv } from "./assets";
import { expectTablesFit } from "./table-fit";

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const PLAN_DS = "88bd5306-e0a1-46dd-8e02-909931ade592";
const RESULTS_DS = "65dfa39f-e699-4698-b8c7-29e1b99d7b23";

const PSPC_BLOCK = {
  v: 1,
  objects: { "473": ["Information technology and telecommunications consultants", "Consultants en TI et en télécommunications", "Services", "Services"] },
  plan: {
    ds: PLAN_DS, fy: [2025, 2026], years: [
      { fy: 2025, n: 1, rows: [["473", 9_497_965, ["National Capital Region", "Région de la capitale nationale"]]] },
      { fy: 2026, n: 1, rows: [["473", 9_497_965, ["National Capital Region", "Région de la capitale nationale"]]] },
    ],
  },
  gaps: { ds: PLAN_DS, years: [{ fy: 2025, n: 0, keys: [], none: ["No Identified Gaps Reported by the Organization", "Aucune information fournie par l'organisation"] }] },
  result: { ds: RESULTS_DS, fy: 2024, a: 234_567_991, b: 7_413_347_154, c: 0, pct: 0.0316, met: ["No", "Non"] },
};

const MIXED = {
  v: 1,
  objects: {
    "1231": ["Office furniture and furnishings, including parts", "Mobilier et ameublement du bureau incluant des pièces", "Goods, land, buildings and works", "Biens, terrains, bâtiments et travaux"],
    "401": ["Accounting and audit services", "Services de comptabilité et de vérification", "Services", "Services"],
    "582": ["License/Maintenance fees for client software related to Distributed Computing Environment (DCE)", "Licences/maintenance des logiciels clients de l'environnement d'informatique répartie (EIR)", "Services", "Services"],
    "813": ["Temporary help services", "Services d'aide temporaire", "Services", "Services"],
    "1130": ["Inorganic and organic chemicals, including plastics, rubber and products, and excluding tires and tubes", "Produits chimiques inorganiques, et produits chimiques organiques, incluant matières plastiques, caoutchouc et leurs produits, excluant des pneus et chambres à air", null, null],
    "460": ["Protection services", "Services de protection", null, null],
  },
  plan: {
    ds: PLAN_DS, fy: [2025, 2026], years: [
      { fy: 2025, n: 4, rows: [
        ["1231", 2_700_000, ["Various but majority in Ottawa", "Divers mais majoritaires à Ottawa"]],
        ["582", 72_804.4, ["Ontario", null]],
        ["813", 5_000_000, "np"],
        ["401", "np", ["Ontario", null]],
      ] },
      { fy: 2026, n: 0, np: 1, rows: [] },
    ],
  },
  gaps: { ds: PLAN_DS, years: [{ fy: 2025, n: 2, keys: ["1130", "460"], none: null }] },
  result: { ds: RESULTS_DS, fy: 2024, a: 10_321_551, b: 133_497_190, c: 18_941_124, pct: 0.0901, met: ["Yes", "Oui"] },
};

const withBlock = (block: unknown, extra: Record<string, unknown> = {}) => {
  const file = structuredClone(buyer) as Record<string, unknown>;
  if (block !== undefined) file.indigenous_target = block;
  Object.assign(file, extra);
  return testEnv(makeFakeAssets({}, { "buyers/pwgsc-tpsgc.json": file }));
};

const page = async (path: string, env: object = testEnv()) => (await app.request(path, {}, env)).text();

// The panel, from its section's start to its end.
const panelOf = (html: string, id = "indigenous-target") => {
  const head = html.indexOf(`<h2 id="${id}">`);
  if (head < 0) return "";
  const start = html.lastIndexOf("<section", head);
  return html.slice(start, html.indexOf("</section>", head) + "</section>".length);
};
const without = (html: string) => html.replace(panelOf(html), "");

describe("the Indigenous procurement target on a buyer page", () => {
  it("renders a buyer file without a block, or with one that does not read, as it was", async () => {
    const plain = await page("/buyers/pwgsc-tpsgc");
    expect(plain).not.toContain("indigenous-target");
    const bad: unknown[] = [
      { ...PSPC_BLOCK, v: 2 },
      { v: 1, objects: {} },
      { ...PSPC_BLOCK, objects: {} },
      { ...PSPC_BLOCK, plan: { ...PSPC_BLOCK.plan, fy: [2025, 2027] } },
      { ...PSPC_BLOCK, plan: { ...PSPC_BLOCK.plan, years: [{ fy: 2025, n: 1, rows: [["473", "9,497,965", ["NCR", null], "x"]] }] } },
      { ...PSPC_BLOCK, plan: { ...PSPC_BLOCK.plan, years: [{ fy: 2024, n: 1, rows: [["473", 1, null]] }] } },
      { ...PSPC_BLOCK, gaps: { ds: PLAN_DS, years: [{ fy: 2025, n: 1, keys: ["999"], none: null }] } },
      { ...PSPC_BLOCK, result: { ...PSPC_BLOCK.result, met: "Yes" } },
      { ...PSPC_BLOCK, result: { ...PSPC_BLOCK.result, ds: "../../evil" } },
      "a string",
      null,
    ];
    for (const block of bad) {
      const res = await app.request("/buyers/pwgsc-tpsgc", {}, withBlock(block));
      expect(res.status).toBe(200);
      expect(await res.text(), JSON.stringify(block)).toBe(plain);
    }
    expect(buyerIndigenousTarget({})).toBeNull();
    expect(buyerIndigenousTarget({ indigenous_target: PSPC_BLOCK })?.plan?.years).toHaveLength(2);
  });

  it("adds its own panel after the records and before the Public Accounts' payments, and changes nothing else", async () => {
    const plain = await page("/buyers/pwgsc-tpsgc");
    const html = await page("/buyers/pwgsc-tpsgc", withBlock(PSPC_BLOCK));
    expect(html).not.toBe(plain);
    expect(without(html)).toBe(plain);
    expect(html.indexOf('<h2 id="indigenous-target">')).toBeGreaterThan(html.indexOf('<h2 id="years">'));
    // With the payments too: the target's panel first, the payments the last panel still.
    const pa = { v: 1, fy: 2025, classes: [{ cls: "47", en: "Informatics Services", fr: "Services informatiques", total: 100_000, named: [0, 0], under: [1, 100_000], federal: [0, 0], withheld: 0 }], payees: [], named_rows: 0 };
    const both = await page("/buyers/pwgsc-tpsgc", withBlock(PSPC_BLOCK, { public_accounts: pa }));
    expect(both.indexOf('<h2 id="indigenous-target">')).toBeLessThan(both.indexOf('<h2 id="public-accounts">'));
    expect(both.indexOf("</section>", both.indexOf('<h2 id="public-accounts">'))).toBeGreaterThan(both.lastIndexOf('<section class="panel'));
  });

  it("says whose reports these are, that a plan is no commitment, and gives each figure as published", async () => {
    const panel = nbsp(panelOf(await page("/buyers/pwgsc-tpsgc", withBlock(PSPC_BLOCK))));
    expect(panel).toContain('<h2 id="indigenous-target">Indigenous Procurement Target</h2>');
    expect(panel).toContain("What Public Services and Procurement Canada reported to Indigenous Services Canada under the mandatory minimum 5% Indigenous procurement target, as Indigenous Services Canada published it.");
    expect(panel).toContain("These are the institution&#39;s own reports. None of their figures is added to the contract totals on this page or anywhere on the site.");
    expect(panel).toContain("its amounts are planning estimates that may change, and it commits the institution to no purchase.");
    expect(panel).toContain("<h3>Planned Procurement, Fiscal 2025-26</h3>");
    expect(panel).toContain("<h3>Planned Procurement, Fiscal 2026-27</h3>");
    for (const head of ["Category", "Economic object", "Amount as reported", "Delivery location"]) expect(panel).toContain(`<button type="button" class="th-sort">${head}</button>`);
    expect(panel).toContain('<td data-label="Category">Services</td><td data-label="Economic object" class="lead-cell">Information technology and telecommunications consultants</td><td data-label="Amount as reported" class="mono num">$9,497,965</td><td data-label="Delivery location">National Capital Region</td>');
    // The file's own words where it reports no gap.
    expect(panel).toContain("<h3>Gaps Reported, Fiscal 2025-26</h3>");
    expect(panel).toContain("<p>The file&#39;s entry for this institution reads &quot;No Identified Gaps Reported by the Organization&quot;.</p>");
    // The result as published: the figures, the percentage the file gives, Target met as the file states it.
    expect(panel).toContain("<h3>Result, Fiscal 2024-25</h3>");
    expect(panel).toContain('<dt>Awarded to Indigenous businesses (A)</dt><dd class="mono">$234,567,991</dd>');
    expect(panel).toContain('<dt>Awarded to all businesses (B)</dt><dd class="mono">$7,413,347,154</dd>');
    expect(panel).toContain('<dt>Exceptions approved by the deputy head (C)</dt><dd class="mono">$0</dd>');
    expect(panel).toContain('<dt>Percentage, A / (B - C)</dt><dd class="mono">3.16%</dd>');
    expect(panel).toContain("<dt>Target met</dt><dd>No</dd>");
    expect(panel).toContain("the site computes none of them.");
    expect(panel).not.toContain("Report received");
    // The foot: each dataset linked with its fiscal years, the publisher's note, the licence.
    expect(panel).toContain(`Published by Indigenous Services Canada from the institutions&#39; reports: <a href="https://open.canada.ca/data/en/dataset/${PLAN_DS}">planned procurement and gaps, 2025-26 and 2026-27</a>; <a href="https://open.canada.ca/data/en/dataset/${RESULTS_DS}">results, 2024-25</a>.`);
    expect(panel).toContain("Indigenous Services Canada does not revise a dataset after publishing it.");
    expect(panel).toContain('<a href="https://open.canada.ca/en/open-government-licence-canada">Contains information licensed under the Open Government Licence, Canada.</a>');
    expect(panel).not.toContain(EM_DASH);
    expect(panel).not.toContain(EN_DASH);
  });

  it("shows what the file does not provide as not provided, never as zero, and keeps cents as stated", async () => {
    const panel = nbsp(panelOf(await page("/buyers/pwgsc-tpsgc", withBlock(MIXED))));
    expect(panel).toContain('<td data-label="Amount as reported" class="mono num">Not provided</td>');
    expect(panel).toContain('<td data-label="Delivery location">Not provided</td>');
    expect(panel).toContain('<td data-label="Amount as reported" class="mono num">$72,804.40</td>');
    expect(panel).toContain('<td data-label="Amount as reported" class="mono num">$5,000,000</td>');
    expect(panel).not.toContain(">$0<");
    // A year the file gives no data for.
    expect(panel).toContain("<h3>Planned Procurement, Fiscal 2026-27</h3><p class=\"muted small\">No data provided for this fiscal year, as the file states.</p>");
    // The gaps by name, a gap's category not given.
    expect(panel).toContain("<ul><li>Inorganic and organic chemicals, including plastics, rubber and products, and excluding tires and tubes</li><li>Protection services</li></ul>");
    expect(panel).toContain("<dt>Target met</dt><dd>Yes</dd>");
    // A year of the plan the file has no row for, and a result whose report is not received, read as the file says.
    const noRows = { ...MIXED, plan: { ...MIXED.plan, years: [MIXED.plan.years[0]] }, result: { ...MIXED.result, a: "np", met: "np", rcv: ["No", "Non"] } };
    const other = nbsp(panelOf(await page("/buyers/pwgsc-tpsgc", withBlock(noRows))));
    expect(other).toContain("The file has no row for this institution in this fiscal year.");
    expect(other).toContain('<dt>Awarded to Indigenous businesses (A)</dt><dd class="mono">Not provided</dd>');
    expect(other).toContain("<dt>Target met</dt><dd>Not provided</dd><dt>Report received</dt><dd>No</dd>");
  });

  it("reads in French with the files' own French", async () => {
    const html = nbsp(await page("/buyers/pwgsc-tpsgc?lang=fr", withBlock(MIXED)));
    const panel = panelOf(html);
    expect(panel).toContain('<h2 id="indigenous-target">Cible d’approvisionnement auprès des entreprises autochtones</h2>');
    expect(panel).toContain("<h3>Approvisionnements planifiés, exercice 2025-2026</h3>");
    expect(panel).toContain("Mobilier et ameublement du bureau incluant des pièces");
    expect(panel).toContain("Biens, terrains, bâtiments et travaux");
    expect(panel).toContain("Divers mais majoritaires à Ottawa");
    expect(panel).toContain("72 804,40 $");
    expect(panel).toContain("Non fourni");
    expect(panel).toContain("<dt>Pourcentage, A / (B - C)</dt><dd class=\"mono\">9,01 %</dd>");
    expect(panel).toContain("<dt>Cible atteinte</dt><dd>Oui</dd>");
    expect(panel).toContain(`https://open.canada.ca/data/fr/dataset/${PLAN_DS}`);
    expect(panel).toContain("approvisionnements planifiés et lacunes, 2025-2026 et 2026-2027");
    const pspc = nbsp(panelOf(await page("/buyers/pwgsc-tpsgc?lang=fr", withBlock(PSPC_BLOCK))));
    // The file's own words keep the file's own apostrophe.
    expect(pspc).toContain("L’entrée du fichier pour cette institution porte la mention « Aucune information fournie par l&#39;organisation ».");
    expect(pspc).toContain("<dt>Cible atteinte</dt><dd>Non</dd>");
  });

  it("fits every table to its column from 700 px in both languages", async () => {
    for (const block of [PSPC_BLOCK, MIXED]) {
      expectTablesFit(await page("/buyers/pwgsc-tpsgc", withBlock(block)), "buyer page with the target");
      expectTablesFit(await page("/buyers/pwgsc-tpsgc?lang=fr", withBlock(block)), "buyer page with the target, French");
    }
  });

  it("says how many rows a year holds when the file carries only the first", async () => {
    const rows = Array.from({ length: 3 }, () => ["1231", 1_000, ["Ontario", null]]);
    const block = { ...MIXED, plan: { ...MIXED.plan, years: [{ fy: 2025, n: 240, rows }] } };
    expect(nbsp(panelOf(await page("/buyers/pwgsc-tpsgc", withBlock(block))))).toContain("The first 3 of 240 rows for this fiscal year.");
    expect([IPT_PLAN_ROWS, IPT_GAP_ROWS]).toEqual([200, 200]);
  });

  it("writes figures as published", () => {
    expect(statedMoney("en", 99_999.99)).toBe("$99,999.99");
    expect(statedMoney("en", 1_500_000)).toBe("$1,500,000");
    expect(nbsp(publishedPct("fr", 0.0647))).toBe("6,47 %");
    expect(publishedPct("en", 0.2639)).toBe("26.39%");
    expect(figureText("en", "np", String)).toBe("Not provided");
    expect(figureText("en", null, String)).toBe("Not stated");
    expect(figureText("en", "TBD", String)).toBe("TBD");
  });
});

describe("the Indigenous procurement target on the Data and Methodology pages", () => {
  it("lists the source with its publisher and its licence", async () => {
    const html = nbsp(await page("/data"));
    expect(html).toContain('<a href="https://search.open.canada.ca/opendata/?owner_org=isc-sac&amp;search_text=%22Indigenous%20Procurement%20Target%22">Mandatory minimum 5% Indigenous procurement target: plans, gaps and results</a>');
    expect(html).toContain("Indigenous Services Canada");
    expect(html).toContain("Indigenous procurement target files: planned procurement, gaps and results");
    const fr = nbsp(await page("/data?lang=fr"));
    expect(fr).toContain("Cible minimale obligatoire de 5 % d’approvisionnement auprès des entreprises autochtones : plans, lacunes et résultats");
    expect(fr).toContain("https://rechercher.ouvert.canada.ca/donneesouvertes/?owner_org=isc-sac");
  });

  it("states the rules in a section of their own", async () => {
    const html = nbsp(await page("/methodology"));
    expect(html).toContain('<a href="#indigenous-target">Indigenous Procurement Target</a>');
    expect(html).toContain('<h2 id="indigenous-target">Indigenous Procurement Target</h2>');
    expect(html).toContain("A plan commits an institution to no purchase.");
    expect(html).toContain("is shown as not provided, never as zero");
    expect(html).toContain("Economic objects are not UNSPSC segments, and the site does not map one to the other.");
    expect(html.indexOf('<h2 id="indigenous-target">')).toBeGreaterThan(html.indexOf('<h2 id="public-accounts">'));
    const fr = nbsp(await page("/methodology?lang=fr"));
    expect(fr).toContain("Un plan n’engage l’institution à aucun achat.");
  });

  it("keeps its strings in both languages, with no dash and no word that judges", () => {
    const keys = allKeys().filter((k) => k.startsWith("ipt.") || k.startsWith("methodology.ipt_") || k.includes("indigenous_target") || k === "data.pub.isc");
    expect(keys.length).toBeGreaterThanOrEqual(45);
    const words = /\b(?:fail|failed|fails|failure|only|poor|poorly|exceed|exceeded|exceeds|short of|missed|lagging|behind|best|worst|will buy|guarantee)\b/i;
    const mots = /échou|échec|seulement|uniquement|mauvais|médiocre|dépass|meilleur|garanti/i;
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      for (const text of [en, fr]) {
        expect(text, key).not.toContain(EM_DASH);
        expect(text, key).not.toContain(EN_DASH);
      }
      expect(en, key).not.toMatch(words);
      expect(fr, key).not.toMatch(mots);
      expect(fr, key).not.toBe(en);
    }
  });
});
