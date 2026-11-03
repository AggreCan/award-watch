// The readability pass (2026-11-02): the order of the profile and buyer
// pages, the year tables' switch and fold, the alerts form after the lists,
// the lead lines of a notice and an award, the empty tender list, the sorts
// on /buyers and /segments, the rankings' one buyer table and year select,
// and the small helpers behind them.
import { describe, expect, it } from "vitest";
import { yearLabels } from "../src/chart";
import { clockAt, countdownLine } from "../src/closing";
import type { YearFigure } from "../src/data";
import { app } from "../src/index";
import { windowOf } from "../src/pages/expiring";
import { instrumentText, orList, sourceFileText, yearOrder } from "../src/pages/shared";
import { FILES, makeFakeAssets, testEnv } from "./assets";

const text = async (path: string, env = testEnv()) => (await app.request(path, {}, env)).text();
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const withFiles = (overrides: Record<string, unknown>) => testEnv(makeFakeAssets({}, overrides));
const order = (html: string, marks: string[]) => marks.map((m) => html.indexOf(m));
const ascending = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

describe("helpers", () => {
  it("orders the years newest first, a year past the data year after the data year's own", () => {
    const y = (year: number, source: YearFigure["source"]) =>
      ({ year, source, n: 1, total: 1, n_non_competitive: 0, total_non_competitive: 0 }) as YearFigure;
    const rows = yearOrder([y(2024, "awards"), y(2029, "awards"), y(2026, "contracts"), y(2027, "awards"), y(2026, "awards")], 2026);
    expect(rows.map((r) => `${r.year} ${r.source}`)).toEqual(["2026 awards", "2026 contracts", "2027 awards", "2029 awards", "2024 awards"]);
  });

  it("labels a phone's chart with the first year, the last and every fifth clear of both", () => {
    const phone = yearLabels(2002, 2026).filter((l) => l.phone).map((l) => l.text);
    expect(phone).toEqual(["2002", "2005", "2010", "2015", "2020", "2026"]);
  });

  it("spells out the source's terms and names its files", () => {
    expect(instrumentText("en", "Contract against SA", "Contrat découlant d'un arrangement")).toBe("Contract against a supply arrangement");
    expect(instrumentText("en", "Standing Offer", null)).toBe("Standing Offer");
    expect(sourceFileText("en", "openTenderNotice-ouvertAvisAppelOffres.csv")).toBe("the CanadaBuys open tender notices file");
    expect(sourceFileText("en", "2026-2027-awardNotice-avisAttribution.csv")).toBe("the CanadaBuys award notices file for 2026-2027");
    expect(sourceFileText("en", "something-else.csv")).toBe("something-else.csv");
    expect(orList("en", ["a", "b", "c"])).toBe("a, b or c");
    expect(orList("fr", ["a", "b"])).toBe("a ou b");
  });

  it("puts a contract's end in the narrowest radar window, and writes the time left as the countdown does", () => {
    expect([windowOf(0), windowOf(91), windowOf(92), windowOf(182), windowOf(365), windowOf(366), windowOf(-1)])
      .toEqual(["3m", "3m", "6m", "6m", "12m", null, null]);
    const clock = clockAt(Date.parse("2026-11-04T18:30:00Z"));
    expect(countdownLine("2026-11-04T14:00:00", clock, "en")).toBe("closes in 30 min");
    expect(countdownLine("2026-11-07T14:00:00", clock, "en")).toBe("closes in 3 days");
    expect(countdownLine("2026-11-04", clock, "en")).toBeNull();
  });
});

describe("a profile", () => {
  it("reads tiles, contracts ending, main buyers, figures by year, the records, then the rest, the alerts form after the records", async () => {
    const html = await text("/organizations/org-a000000001");
    expect(ascending(order(html, [
      '<section class="tiles"', '<h2 id="expiring">', '<h2 id="buyers">', '<h2 id="years">', '<h2 id="awards">', '<h2 id="contracts">',
      '<h2 id="lobbying">', 'class="sources-line"', "<h2>Email Lists</h2>", "Addresses on the Records", "Corporate Registry",
      '<h2 id="responses">', '<h2 id="corrections">',
    ]))).toBe(true);
    // The alerts form follows the lists, with the quieter button.
    expect(html).toContain('<button type="submit" class="btn">Notify me</button>');
    // The main buyers under their source's sub-head, and a phone keeps the table.
    expect(html).toContain('<tr class="group-row"><th colspan="3" scope="colgroup" class="group-head">Published contracts</th></tr>');
    expect(html).toMatch(/<h2 id="buyers">[^]*?<table class="cols compact"/);
    // A record list shows its first ten rows on a phone, with the rest a button away.
    expect(html).toContain('<div class="table-wrap bordered" data-phone-rows="10">');
    expect(html).toContain('<script src="/pager.js" defer=""></script>');
  });

  it("switches the year table between sources, opening on the one with the most records", async () => {
    const html = await text("/organizations/org-a000000001");
    const years = html.slice(html.indexOf('<h2 id="years">'), html.indexOf('<h2 id="awards">'));
    expect(years).toContain('<div class="ysw" role="radiogroup" aria-label="Source shown">');
    expect(years).toContain('<input type="radio" name="years-source" value="contracts" checked=""/><span>Published contracts</span>');
    expect(years).toContain('<input type="radio" name="years-source" value="all"/><span>All sources</span>');
    expect(years).toContain('<tr data-source="contracts">');
    // Nothing older than ten years in the fixture: no fold.
    expect(years).not.toContain("years-more");
    const profiles = structuredClone(FILES["profiles/a00.json"]) as Record<string, any>;
    profiles["org-a000000001"].years.push({ ...profiles["org-a000000001"].years[2], year: 2010 });
    const folded = await text("/organizations/org-a000000001", withFiles({ "profiles/a00.json": profiles }));
    expect(folded).toContain('<tr data-source="contracts" class="older">');
    expect(folded).toContain('<details class="years-more" data-older="contracts"><summary class="btn"><span class="when-closed">Show all years</span>');
  });
});

describe("a buyer page", () => {
  it("leads with its contracts ending, then the largest values, the newest awards, the alerts form and the years", async () => {
    const html = await text("/buyers/pwgsc-tpsgc");
    expect(ascending(order(html, [
      '<h2 id="expiring">', '<h2 id="top-awards">', "<h2>Newest Award Notices</h2>", "<h2>Email Lists</h2>", '<h2 id="years">',
    ]))).toBe(true);
    // The span of its records, its feed buttons, and tiles that open the source's largest values.
    expect(html).toContain('<p class="page-note">Records from 2025 to 2026.</p>');
    expect(html).toContain('href="/data/feeds/buyer/pwgsc-tpsgc/expiring.xml" class="btn">Atom feed of contracts entering the 3-month window</a>');
    expect(html).toContain('<a class="tile" href="#top-awards"><span class="tile-label">Award notices</span>');
    expect(html).toContain('<div class="tile"><span class="tile-label">Published contracts</span>');
  });
});

describe("the lists", () => {
  it("put the alerts form after the list on /tenders, /expiring and its windows, and a segment page", async () => {
    for (const [path, list] of [
      ["/tenders", 'id="tender-split"'], ["/expiring", "<h2>Ending Within 3 Months</h2>"], ["/expiring/3m", "<h2>Within 3 months</h2>"],
      ["/segments/82", "<h2>Open Notices</h2>"],
    ]) {
      const html = await text(path);
      expect(html.indexOf("<h2>Email Lists</h2>"), path).toBeGreaterThan(html.indexOf(list));
      expect(html, path).toContain('<button type="submit" class="btn">Notify me</button>');
    }
    // On /alerts the chooser is the page's own action.
    expect(await text("/alerts")).toContain('<button type="submit" class="btn btn-primary">Sign me up</button>');
  });

  it("move the radar's rule to the list's foot, and only under rows", async () => {
    const html = await text("/expiring");
    const head = html.slice(0, html.indexOf("</header>", html.indexOf('class="page-head"')));
    expect(head).not.toContain("Each contract is listed once");
    expect(html).toMatch(/<div class="panel-foot"><span>Each contract is listed once/);
    const profile = await text("/organizations/org-a000000002", withFiles({
      "profiles/a00.json": { ...(FILES["profiles/a00.json"] as object), "org-a000000002": { ...(FILES["profiles/a00.json"] as any)["org-a000000002"], expiring: { n: 0, total: null, rows: [] } } },
    }));
    const part = profile.slice(profile.indexOf('<h2 id="expiring">'), profile.indexOf('<h2 id="buyers">'));
    expect(part).toContain("No contract ends within 12 months");
    expect(part).not.toContain("Each contract is listed once");
  });

  it("fold the filters behind a button that counts the active ones", async () => {
    const plain = await text("/tenders");
    expect(plain).toContain('<details class="phone-fold filters-fold" open="" data-phone-closed=""><summary class="btn" id="tender-fold">Filters</summary>');
    const two = await text("/tenders?segment=82&province=ON");
    expect(two).toContain('<summary class="btn" id="tender-fold">Filters (2 active)</summary>');
    expect(nbsp(await text("/expiring/3m?lang=fr&value=over-10m"))).toContain("<summary class=\"btn\">Filtres (1 actif)</summary>");
  });

  it("say what to do next when no notice matches, and hide the detail panel", async () => {
    const html = await text("/tenders?q=zzqqxx");
    expect(html).toContain('<div class="split is-empty" id="tender-split">');
    expect(html).toContain('<div class="empty-state"><p>No open notice matches these filters.</p><p class="muted">Remove a filter above, <a href="/tenders">show every open notice</a>, or <a href="/search?q=zzqqxx">look for these words among organizations and buyers</a>.</p></div>');
  });

  it("sort /buyers and /segments by records, with an A to Z (or code) switch", async () => {
    const buyers = await text("/buyers");
    expect(buyers).toContain('<a href="/buyers" aria-current="page">Most records</a><a href="/buyers?sort=name">A to Z</a>');
    const named = await text("/buyers?sort=name");
    expect(named).toContain('<a href="/buyers?sort=name" aria-current="page">A to Z</a>');
    expect(named).toContain('<meta name="robots" content="noindex"/>');
    const segments = await text("/segments");
    expect(segments).toContain('<a href="/segments?sort=code">By code</a>');
    expect(segments).toContain('<span class="zero"><span aria-hidden="true">–</span><span class="visually-hidden">0</span></span>');
  });

  it("give the rankings one buyer table, the tab's own, and a year select on a phone", async () => {
    const awards = await text("/rankings");
    expect(awards).toContain("<h2>Award notices: Buyers by Value</h2>");
    // The fixture ranks buyers for award notices only: the history tab has no buyer table, and shows no other source's.
    const html = await text("/rankings?source=history");
    expect(html).not.toContain("Buyers by Value");
    expect(html).toContain('<form method="get" action="/rankings" class="toolbar-row phone-only">');
    expect(html).toContain('<input type="hidden" name="source" value="history"/>');
    const res = await app.request("/rankings?year=2026&source=history", {}, testEnv());
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/rankings/2026?source=history");
    expect((await app.request("/rankings/2026?year=all", {}, testEnv())).headers.get("location")).toBe("/rankings");
  });
});

describe("a notice and an award", () => {
  it("lead with when the notice closes, who buys and what kind, and put the description under the dates and the buyer", async () => {
    const html = await text("/tenders/cb-100-10000001");
    expect(html).toMatch(/<p class="lead"><span class="badge badge-[a-z]+"[^>]*>[^<]+<\/span> Closes 2026-11-04 14:00 ET · <a href="\/buyers\/[a-z-]+">[^<]+<\/a> · Services<\/p>/);
    expect(ascending(order(html, ["<h2>Key Dates</h2>", "<h2>Description as Published</h2>", "<h2>Procurement</h2>"]))).toBe(true);
    expect(html).toContain("Read from ");
    expect(html).toContain('(see <a href="/data#sources">Data</a>)');
  });

  it("splits an award's details into key dates and procurement, the end date linked to its radar window", async () => {
    const html = await text("/awards/cb-400-40000004");
    expect(ascending(order(html, ["<h2>Supplier and Buyer</h2>", "<h2>Key Dates</h2>", "<h2>Procurement</h2>"]))).toBe(true);
    expect(html).not.toContain("<h2>Details</h2>");
    // Its end falls past the radar's last window: no days left.
    expect(html).not.toContain("days left</a>");
    const shard = structuredClone(FILES["contracts/637.json"]) as Record<string, any>;
    shard["award:cb-400-40000004"].end = "2027-03-31";
    shard["award:cb-400-40000004"].tender_reference = "cb-100-10000001";
    const near = await text("/awards/cb-400-40000004", withFiles({ "contracts/637.json": shard }));
    expect(near).toContain('2027-03-31 · <a href="/expiring/6m" class="small">151 days left</a>');
    expect(near).toContain('<a href="/tenders/cb-100-10000001" class="mono">EN578-250099</a>');
  });
});

describe("the directory and the data page", () => {
  it("leave a row's date blank when it counts no record", async () => {
    const page = { code: "on", page: 1, rows: [{ id: "org-a000000001", name: "Nothing counted", city: null, n_records: 0, last_seen: "2018-04-01" }] };
    const html = await text("/organizations/directory/on", withFiles({ "directory/on/1.json": page }));
    expect(html).not.toContain("2018-04-01");
  });
});
