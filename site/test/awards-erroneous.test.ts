// Award notices whose award date falls after the data date (the contract's
// end date typed in the award-date field): /awards/erroneous lists them as
// published beside their own dates, /awards links it with a count, and the
// loader checks the rows' extra dates.
import { describe, expect, it } from "vitest";
import { isAwardRow, isErroneousAward } from "../src/data";
import { app } from "../src/index";
import { makeFakeAssets, testEnv } from "./assets";
import erroneous from "./fixtures/awards-erroneous.json";
import stats from "./fixtures/stats.json";

let address = 0;
const get = (path: string, overrides: Record<string, unknown> = {}) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.21.${(address++ % 250) + 1}` } },
    testEnv(makeFakeAssets({}, overrides)));
const text = async (path: string, overrides: Record<string, unknown> = {}) => (await get(path, overrides)).text();
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const EM_DASH = String.fromCharCode(0x2014);
const headRow = (html: string) => html.slice(html.indexOf("<main")).match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1] ?? "";
const rowOf = (html: string, ref: string) => html.match(new RegExp(`<tr>(?:(?!</tr>)[\\s\\S])*?/awards/${ref}"[\\s\\S]*?</tr>`))?.[0] ?? "";
const withCount = (n: number | undefined) => ({ "stats.json": { ...stats, counts: { ...stats.counts, awards_erroneous: n } } });

describe("the erroneous submissions page", () => {
  it("lists each notice as published beside its publication date and the contract's dates, in English", async () => {
    const html = await text("/awards/erroneous");
    expect(html).toContain("<h1>Erroneous Submissions</h1>");
    expect(decode(html)).toContain(
      "Award notices whose award date falls after the data date (2026-10-31). In the rows seen so far the award date usually " +
      "matches the contract's end date, so the end date was entered in the award-date field; a notice dated a day or two ahead " +
      "leaves the list as the date passes.",
    );
    expect(html).not.toContain(EM_DASH);
    // Under Awards: the rail item and the breadcrumbs.
    expect(html).toContain('<a class="rail-item rail-ancestor" href="/awards">');
    expect(html).toMatch(/<a href="\/awards">Award Notices<\/a>/);
    const heads = [...headRow(html).matchAll(/<button type="button" class="th-sort">([^<]*)<\/button>/g)].map((m) => decode(m[1]));
    expect(heads).toEqual(["Notice", "Buyer", "Published", "Award date (as published)", "Start", "End", "Value", "Record"]);
    // Sorted in the browser: every row is on the page.
    expect(html).toContain('data-sorting="client"');
    const row = rowOf(html, "cb-810-81000001");
    expect(row).toContain('<a href="/awards/cb-810-81000001">Conference interpretation, three years</a>');
    for (const day of ["2026-08-31", "2029-08-31", "2026-09-01"]) expect(row).toContain(`>${day}<`);
    expect(row).toContain("$420,000");
    expect(row).toContain('href="https://canadabuys.canada.ca/en/tender-opportunities/award-notice/cb-810-81000001"');
    expect(row).toContain('<a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a>');
    // The file's order: the latest award date first.
    expect(html.indexOf("cb-810-81000001")).toBeLessThan(html.indexOf("cb-820-82000002"));
  });

  it("speaks French on the same path", async () => {
    const html = nbsp(await text("/awards/erroneous?lang=fr"));
    expect(html).toContain("<h1>Soumissions erronées</h1>");
    expect(decode(html)).toContain("Avis d’attribution dont la date d’attribution tombe après la date des données (2026-10-31).");
    expect(decode(headRow(html))).toContain("Date d’attribution (telle que publiée)");
    expect(html).toContain('href="https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/cb-810-81000001"');
    // The publisher's French title, as published.
    expect(decode(html)).toContain("Services d'inspection de quais");
  });

  it("says none at the moment when the file is empty, and not published when it is missing", async () => {
    for (const [path, words] of [["/awards/erroneous", "None at the moment."], ["/awards/erroneous?lang=fr", "Aucun pour le moment."]]) {
      const res = await get(path, { "awards/erroneous.json": [] });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(words);
      expect(html).not.toContain("<table");
    }
    const missing = await get("/awards/erroneous", { "awards/erroneous.json": undefined });
    expect(missing.status).toBe(503);
    // An export from before the file existed (no count in stats.json): none listed, not a failure.
    const before = await get("/awards/erroneous", { "awards/erroneous.json": undefined, ...withCount(undefined) });
    expect(before.status).toBe(200);
    expect(await before.text()).toContain("None at the moment.");
  });
});

describe("the line on /awards", () => {
  it("counts the notices listed apart and links them, in both languages", async () => {
    const html = await text("/awards");
    expect(html).toContain('<a href="/awards/erroneous">2 notices carry an award date after the data date and are listed apart.</a>');
    const fr = decode(nbsp(await text("/awards?lang=fr")));
    expect(fr).toContain(
      '<a href="/awards/erroneous">2 avis portent une date d’attribution postérieure à la date des données et sont présentés à part.</a>',
    );
    const one = await text("/awards", withCount(1));
    expect(one).toContain('<a href="/awards/erroneous">1 notice carries an award date after the data date and is listed apart.</a>');
  });

  it("is left out when there is none, or when the export does not count them", async () => {
    for (const n of [0, undefined]) {
      const html = await text("/awards", withCount(n));
      expect(html).toContain("A cancelled notice counts zero in every total.");
      expect(html).not.toContain("/awards/erroneous");
    }
  });
});

describe("the page's search entry and the counting rule", () => {
  const head = (html: string) => html.slice(0, html.indexOf("</head>"));
  const crumbs = (html: string) => [...head(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => JSON.parse(m[1])).find((j) => j["@type"] === "BreadcrumbList")?.itemListElement.map((i: { name: string }) => i.name);

  it("names the page in a result list and in its breadcrumbs, in both languages", async () => {
    const en = await text("/awards/erroneous");
    expect(head(en)).toContain("<title>Erroneous Award Notice Submissions | Award Watch</title>");
    expect(decode(head(en))).toContain('<meta name="description" content="CanadaBuys award notices whose award date falls after the data date');
    expect(crumbs(en)).toEqual(["Home", "Award Notices", "Erroneous Submissions"]);
    expect(head(en)).not.toContain('name="robots"');
    const fr = nbsp(await text("/awards/erroneous?lang=fr"));
    expect(decode(head(fr))).toContain("<title>Avis d’attribution : soumissions erronées | Award Watch</title>");
    expect(head(fr)).toContain('<link rel="canonical" href="https://awardwatch.ca/awards/erroneous?lang=fr"/>');
    expect(crumbs(fr)).toEqual(["Accueil", "Avis d’attribution", "Soumissions erronées"]);
  });

  it("states on the methodology page that such a record counts in the fiscal year it was published", async () => {
    expect(decode(await text("/methodology"))).toContain(
      "is counted in the fiscal year and quarter of its publication date.",
    );
    expect(decode(nbsp(await text("/methodology?lang=fr")))).toContain(
      "est compté dans l’exercice et le trimestre de sa date de publication.",
    );
  });
});

describe("the loader's checks", () => {
  it("take a list row with the publication date and the contract's dates, each a string or null", () => {
    const row = erroneous[0];
    expect(isErroneousAward(row)).toBe(true);
    expect(isErroneousAward({ ...row, start: null, end: null, published: null })).toBe(true);
    for (const key of ["published", "start", "end"]) {
      const { [key]: _, ...without } = row as Record<string, unknown>;
      expect(isErroneousAward(without), key).toBe(false);
      expect(isErroneousAward({ ...row, [key]: 20290831 }), key).toBe(false);
    }
    // An ordinary list row without the dates still reads; one with a date of the wrong type does not.
    const { published: _p, start: _s, end: _e, ...plain } = row;
    expect(isAwardRow(plain)).toBe(true);
    expect(isAwardRow({ ...plain, end: 7 })).toBe(false);
  });

  it("answer not published for a file whose rows do not read", async () => {
    const bad = [{ ...erroneous[0], published: 20260831 }];
    expect((await get("/awards/erroneous", { "awards/erroneous.json": bad })).status).toBe(503);
  });
});
