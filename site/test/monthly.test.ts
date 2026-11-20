// The monthly record (pages/monthly.tsx): the index and each month from the export's files (the fixtures
// monthly-*.json, written out by hand: September holds every table, August no award notice, July the record's
// oldest). Every figure on the page is the file's; the tests hold each to the fixture's own rows, the lead to its
// template, the tables to their order and their counting rules, the CSV files to their rows, and the pages to
// both languages, to the site's 404 for a month the record does not hold, and to the fit of every table.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { routeTemplate } from "../src/views";
import { onEnv } from "./accounts-helpers";
import { assetsWithout, makeFakeAssets, testEnv } from "./assets";
import { expectTablesFit, find, parse, tablesIn } from "./table-fit";
import sept from "./fixtures/monthly-2026-09.json";

let address = 0;
const get = (path: string, env: object = testEnv()) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `203.0.113.${(address++ % 250) + 1}` } }, env);
const html = async (path: string, env: object = testEnv()) => (await get(path, env)).text();
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
// The part of a page under one panel's heading, to its end.
const panel = (page: string, heading: string) => {
  const at = page.indexOf(`<h2>${heading}</h2>`);
  expect(at, heading).toBeGreaterThan(-1);
  return page.slice(at, page.indexOf("</section>", at));
};
// The text of each body row's cells in a part of a page, tags taken out (the head row has no cell).
const rows = (part: string) =>
  [...part.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, "")))
    .filter((cells) => cells.length > 0);

describe("the index", () => {
  it("lists each month the record holds, newest first, with its three figures, a chart and the counting rule", async () => {
    const res = await get("/monthly");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const page = decode(await res.text());
    expect(page).toContain("<h1>Monthly Record of Federal Procurement</h1>");
    expect(page).toContain("Figures as of 2026-10-31: counted from the data as they stood that night.");
    // The fixture's index: September 1,234 tender notices, 567 award notices, $98,765,432.10; August 40, 0, none;
    // July 35, 5, $1,000.
    expect(rows(panel(page, "The Months"))).toEqual([
      ["September 2026", "1,234", "567", "$98,765,432"],
      ["August 2026", "40", "0", "Not stated"],
      ["July 2026", "35", "5", "$1,000"],
    ]);
    expect(page).toContain('<a href="/monthly/2026-09">September 2026</a>');
    expect(page).toContain('<a href="/monthly/months.csv" rel="nofollow">CSV file</a>');
    expect(page).toContain("A notice is counted in the month CanadaBuys published it.");
    // The chart: two panels, a bar a month the oldest first, each bar's tip its month and figure.
    expect(page).toContain('<div class="chart-title">Tender notices</div>');
    expect(page).toContain('<div class="chart-title">Award notices</div>');
    expect(page).toContain("<title>Tender notices, July 2026\n35 notices</title>");
    expect(page).toContain("<title>Tender notices, September 2026\n1,234 notices</title>");
    expect(page).toContain("<title>Award notices, September 2026\n567 notices</title>");
    expect(page.indexOf("July 2026\n35")).toBeLessThan(page.indexOf("September 2026\n1,234"));
    // A bar of 0 draws no mark; its month keeps its label.
    expect(page).not.toContain("<title>Award notices, August 2026");
    expect(page).toContain(">2026-08</span>");
  });

  it("reads in French", async () => {
    const page = nbsp(decode(await html("/monthly?lang=fr")));
    expect(page).toContain("<h1>Bilan mensuel des marchés publics fédéraux</h1>");
    expect(rows(panel(page, "Les mois"))).toEqual([
      ["septembre 2026", "1 234", "567", "98 765 432 $"],
      ["août 2026", "40", "0", "Non indiqué"],
      ["juillet 2026", "35", "5", "1 000 $"],
    ]);
    expect(page).toContain("Chiffres au 2026-10-31 : comptés d’après les données");
  });
});

describe("a month", () => {
  it("leads with three or four sentences built from its figures", async () => {
    const page = decode(await html("/monthly/2026-09"));
    expect(page).toContain("<h1>Federal Procurement in September 2026</h1>");
    // 120 of 567 is 21%; 12,345,678.90 of 98,765,432.10 is 12.4999%; the largest is the first of the file's list.
    expect(page).toContain('<p class="lead">In September 2026, federal buyers published 1,234 tender notices and 567 award notices on CanadaBuys. ' +
      "The award notices state $98,765,432 in Canadian dollars in total. The source marks 120 of them (21%) as non-competitive, " +
      "$12,345,679 of their positive value (12%). The largest states $250,000: Translation standing offer, official languages, " +
      "from Public Services and Procurement Canada to Exemplar Translation Services Inc.</p>");
    const fr = nbsp(decode(await html("/monthly/2026-09?lang=fr")));
    expect(fr).toContain('<p class="lead">En septembre 2026, les acheteurs fédéraux ont publié 1 234 avis d’appel d’offres et 567 avis ' +
      "d’attribution sur AchatsCanada. Les avis d’attribution indiquent 98 765 432 $ en dollars canadiens au total. La source en indique " +
      "120 (21 %) comme non concurrentiels, soit 12 345 679 $ de leur valeur positive (12 %). Le plus grand indique 250 000 $ : Offre à " +
      "commandes de traduction, langues officielles, de Services publics et Approvisionnement Canada à Exemplar Translation Services Inc.</p>");
    // A month with no award notice says so, and nothing about values or the largest.
    const aug = decode(await html("/monthly/2026-08"));
    expect(aug).toContain('<p class="lead">In August 2026, federal buyers published 40 tender notices and no award notice on CanadaBuys.</p>');
  });

  it("shows the tender notices: the month against the month before and a year before, the buyers, the segments, the methods", async () => {
    const page = decode(await html("/monthly/2026-09"));
    const counts = panel(page, "Tender Notices Published");
    expect(rows(counts)).toEqual([["September 2026", "1,234"], ["August 2026", "40"], ["September 2025", "1,100"]]);
    // A month the record holds links to its page; one before the record is named only.
    expect(counts).toContain('<a href="/monthly/2026-08">August 2026</a>');
    expect(counts).not.toContain('href="/monthly/2025-09"');
    expect(counts).toContain("A notice is in the month of its publication date on CanadaBuys (a notice published on the last day of a month is in that month)");
    const buyers = panel(page, "Buyers That Published the Most Tender Notices");
    expect(rows(buyers)).toEqual([
      ["1", "Public Services and Procurement Canada", "600"], ["2", "National Defence", "200"], ["3", "Example Board of Review", "12"],
    ]);
    expect(buyers).toContain('<a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a>');
    // A buyer the site lists no page for is named, not linked.
    expect(buyers).toContain('<td data-label="Buyer">Example Board of Review</td>');
    expect(buyers).toContain("counts for none (3 this month).");
    const segments = panel(page, "Tender Notices by Segment");
    expect(rows(segments).map((r) => [r[0], r[2]])).toEqual([["1", "300"], ["2", "120"], ["3", "90"]]);
    expect(segments).toContain('<a href="/segments/81">Engineering and Research and Technology Based Services</a> <span class="mono muted">81</span>');
    expect(segments).toContain("A notice with no code counts in none (14 this month).");
    const methods = panel(page, "Tender Notices by Procurement Method");
    // 900, 100 and 234 of 1,234: 73%, 8% and 19%.
    expect(rows(methods)).toEqual([["Competitive - Open bidding", "900 (73%)"], ["Non-competitive", "100 (8%)"], ["Method not stated", "234 (19%)"]]);
    expect(methods).toContain("Days open, median: 21.5, over 1,180 notices:");
  });

  it("shows the award notices: counts and value, the share without competition, the largest, the buyers and the suppliers", async () => {
    const page = decode(await html("/monthly/2026-09"));
    const awards = panel(page, "Award Notices Published");
    // The fixture holds no year-before figure for the award notices (the data do not hold that month): no row for it.
    expect(rows(awards)).toEqual([["September 2026", "567", "$98,765,432", "7"], ["August 2026", "0", "Not stated", "0"]]);
    expect(awards).toContain("7 notices state no value and 2 state one in another currency or one flagged for checking");
    const competition = panel(page, "Awarded Without Competition");
    expect(rows(competition)).toEqual([["By number", "120", "567", "21%"], ["By value", "$12,345,679", "$98,765,432", "12%"]]);
    expect(competition).toContain('Non-competitive is the source\'s own term: the method "Non-competitive" or an advance contract award notice.');
    expect(competition).toContain("9 of which state no method");
    const largest = panel(page, "Largest Award Notices by Value");
    // The file's order: the largest, then the two of $48,500.50 by reference, then the notice whose supplier is withheld.
    const refs = [...largest.matchAll(/<a href="\/awards\/([^"]+)">/g)].map((m) => m[1]);
    expect(refs).toEqual(["cb-400-40000004", "cb-600-60000006", "cb-700-70000007", "cb-800-80000008"]);
    expect(largest).toContain('<td data-label="Supplier"><a href="/organizations/org-a000000001">Exemplar Translation Services Inc.</a>');
    // The withheld supplier as the award lists draw it: an empty cell, no name and no link.
    expect(largest).toContain('<span class="mono id muted">cb-800-80000008</span></td><td data-label="Supplier"><br/>');
    expect(largest).toContain("ties by reference");
    const buyers = panel(page, "Buyers by Value of Award Notices");
    expect(rows(buyers)).toEqual([["1", "Public Services and Procurement Canada", "300", "$60,000,000"], ["2", "National Defence", "100", "$30,000,000"]]);
    expect(buyers).toContain("counts for none (1 this month).");
    const suppliers = panel(page, "Suppliers");
    expect(suppliers).toContain("<span>Suppliers named in the month's award notices</span><span class=\"num\">456</span>");
    expect(suppliers).toContain("<span>Named in an award notice for the first time</span><span class=\"num\">120</span>");
    expect(suppliers).toContain("A notice whose supplier is withheld as a private individual names none.");
  });

  it("shows a month with no award notice as none, its shares as not applicable", async () => {
    const page = decode(await html("/monthly/2026-08"));
    expect(rows(panel(page, "Award Notices Published"))).toEqual([
      ["August 2026", "0", "Not stated", "0"], ["July 2026", "5", "$1,000", "0"], ["August 2025", "3", "$500", "1"],
    ]);
    expect(rows(panel(page, "Awarded Without Competition"))).toEqual([
      ["By number", "0", "0", "Not applicable"], ["By value", "Not stated", "Not stated", "Not applicable"],
    ]);
    expect(panel(page, "Largest Award Notices by Value")).toContain('<p class="muted">None this month.</p>');
    expect(panel(page, "Largest Award Notices by Value")).not.toContain("CSV file");
    expect(panel(page, "Buyers by Value of Award Notices")).toContain('<p class="muted">None this month.</p>');
    // July: no closing date to count from.
    expect(decode(await html("/monthly/2026-07"))).toContain("Days open: no notice of the month states a closing date on or after its publication date.");
  });

  it("says what it does not show, how to cite it, and where to go on", async () => {
    const page = decode(await html("/monthly/2026-09"));
    const notShown = panel(page, "What This Page Does Not Show");
    expect(notShown).toContain("Money paid. A notice's value is what the notice states when it is published, not what was spent.");
    expect(notShown).toContain("Published contracts over $10,000.");
    expect(notShown).toContain("Amendments by month.");
    expect(notShown).toContain("Fixed figures.");
    // The /cite page's APA form, with the page's title and address, the figures' date and the day read.
    expect(page).toContain('<pre class="cite-block">Award Watch. (2026). <i>Federal procurement in September 2026: Monthly record</i> ' +
      "(Data as of October 31, 2026). Retrieved October 31, 2026, from https://awardwatch.ca/monthly/2026-09</pre>");
    expect(page).toContain('<a href="/cite">How to Cite</a>');
    expect(page).toContain('<script src="/cite.js" defer=""></script>');
    const fr = nbsp(decode(await html("/monthly/2026-09?lang=fr")));
    expect(fr).toContain("<i>Marchés publics fédéraux en septembre 2026 : bilan mensuel</i> (Données au 31 octobre 2026). " +
      "Consulté le 31 octobre 2026 à https://awardwatch.ca/monthly/2026-09?lang=fr</pre>");
    // The months around it: September is the newest; August has both; July the oldest.
    expect(page).toContain('<a href="/monthly/2026-08" rel="prev">Previous month: August 2026</a>');
    expect(page).not.toContain('rel="next"');
    const aug = await html("/monthly/2026-08");
    expect(aug).toContain('<a href="/monthly/2026-07" rel="prev">Previous month: July 2026</a>');
    expect(aug).toContain('<a href="/monthly/2026-09" rel="next">Next month: September 2026</a>');
    expect(await html("/monthly/2026-07")).not.toContain('rel="prev"');
    for (const path of ["/monthly/2026-09", "/monthly", "/monthly?lang=fr", "/monthly/2026-09?lang=fr"]) {
      const body = await html(path);
      expect(body, path).toContain('<a href="/monthly">');
      expect(body, path).not.toContain(EM_DASH);
      expect(body, path).not.toContain(EN_DASH);
      // No filled button and no plan chip on these pages.
      expect(body, path).not.toContain("btn-primary");
      expect(body, path).not.toContain("pro-tag");
      expect(body, path).not.toContain("ultra-tag");
    }
  });

  it("points to the free tools in one line while accounts are open, and nowhere else", async () => {
    const on = decode(await html("/monthly/2026-09", onEnv()));
    expect(on).toContain('<p class="muted small">With a free account you can follow a <a href="/buyers">buyer</a> from its page and save a search ' +
      'of the <a href="/tenders">open tender notices</a>.</p>');
    expect(on.match(/With a free account/g)).toHaveLength(1);
    expect(await html("/monthly/2026-09")).not.toContain("With a free account");
  });

  it("is the site's 404 for a month the record does not hold or a malformed one, and 'not published' without its files", async () => {
    for (const path of ["/monthly/2026-13", "/monthly/abc", "/monthly/2026-1", "/monthly/2025-01", "/monthly/2026-10", "/monthly/2026-09/nothing.csv",
      "/monthly/2026-13/tenders.csv", "/monthly/2025-01/tenders.csv", "/monthly/abc/tenders.csv"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain("<h1>Page Not Found</h1>");
    }
    const noIndex = testEnv(assetsWithout("monthly/index.json"));
    for (const path of ["/monthly", "/monthly/2026-09", "/monthly/months.csv", "/monthly/2026-09/tenders.csv"]) {
      expect((await get(path, noIndex)).status, path).toBe(503);
    }
    const noMonth = testEnv(assetsWithout("monthly/2026-09.json"));
    expect((await get("/monthly/2026-09", noMonth)).status).toBe(503);
    expect((await get("/monthly/2026-09/largest.csv", noMonth)).status).toBe(503);
    expect((await get("/monthly", noMonth)).status).toBe(200);
    // A file of the wrong shape reads as missing.
    const wrong = testEnv(makeFakeAssets({}, { "monthly/2026-09.json": { ...sept, month: "2026-08" } }));
    expect((await get("/monthly/2026-09", wrong)).status).toBe(503);
  });
});

describe("the CSV files", () => {
  const csv = async (path: string) => {
    const res = await get(path);
    expect(res.status, path).toBe(200);
    // As the analytics views send theirs.
    expect(res.headers.get("content-type"), path).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control"), path).toBe("private, no-store");
    return { disposition: res.headers.get("content-disposition"), body: await res.text() };
  };

  it("give each table of a month, its rows as the page shows them", async () => {
    const page = await html("/monthly/2026-09");
    const linked = [...page.matchAll(/href="\/monthly\/2026-09\/([a-z]+)\.csv"/g)].map((m) => m[1]);
    expect(linked).toEqual(["tenders", "tenderbuyers", "segments", "methods", "awards", "competition", "largest", "awardbuyers"]);
    for (const table of linked) expect((await csv(`/monthly/2026-09/${table}.csv`)).body.split("\r\n")[0], table).not.toBe("");
    const tenders = await csv("/monthly/2026-09/tenders.csv");
    expect(tenders.disposition).toBe('attachment; filename="awardwatch-monthly-2026-09-tenders.csv"');
    expect(tenders.body).toBe("month,tender_notices\r\n2026-09,1234\r\n2026-08,40\r\n2025-09,1100\r\n");
    expect((await csv("/monthly/2026-09/tenderbuyers.csv")).body).toBe("rank,buyer_id,buyer,buyer_fr,tender_notices\r\n" +
      "1,pwgsc-tpsgc,Public Services and Procurement Canada,Services publics et Approvisionnement Canada,600\r\n" +
      "2,dnd-mdn,National Defence,Défense nationale,200\r\n3,,Example Board of Review,,12\r\n");
    expect((await csv("/monthly/2026-09/methods.csv")).body).toBe("method,method_fr,tender_notices\r\n" +
      "Competitive - Open bidding,Concurrentielle - Appel d'offres ouvert,900\r\nNon-competitive,Non concurrentielle,100\r\n,,234\r\n");
    expect((await csv("/monthly/2026-09/awards.csv")).body).toBe("month,award_notices,value_cad,award_notices_without_value\r\n" +
      "2026-09,567,98765432.10,7\r\n2026-08,0,,0\r\n");
    expect((await csv("/monthly/2026-09/competition.csv")).body).toBe("measure,non_competitive,all_award_notices\r\n" +
      "number,120,567\r\npositive_value_cad,12345678.90,98765432.10\r\n");
    const largest = (await csv("/monthly/2026-09/largest.csv")).body.split("\r\n");
    expect(largest[0]).toBe("rank,reference,title,title_fr,published,awarded,organization_id,supplier,buyer_id,buyer,buyer_fr,value,currency,competitive");
    expect(largest[1]).toBe('1,cb-400-40000004,"Translation standing offer, official languages","Offre à commandes de traduction, langues officielles",' +
      "2026-09-16,2026-09-15,org-a000000001,Exemplar Translation Services Inc.,pwgsc-tpsgc,Public Services and Procurement Canada," +
      "Services publics et Approvisionnement Canada,250000.00,CAD,1");
    expect(largest.slice(1, 5).map((l) => l.split(",")[1])).toEqual(["cb-400-40000004", "cb-600-60000006", "cb-700-70000007", "cb-800-80000008"]);
    // The withheld supplier: no id, no name, as on the page; the method not stated is an empty cell.
    expect(largest[4]).toBe('4,cb-800-80000008,"Interpretation, one session","Interprétation, une séance",2026-09-11,2026-09-10,,,pwgsc-tpsgc,' +
      "Public Services and Procurement Canada,Services publics et Approvisionnement Canada,12000.00,CAD,");
    expect((await csv("/monthly/2026-09/awardbuyers.csv")).body).toBe("rank,buyer_id,buyer,buyer_fr,award_notices,value_cad,award_notices_without_value\r\n" +
      "1,pwgsc-tpsgc,Public Services and Procurement Canada,Services publics et Approvisionnement Canada,300,60000000.00,2\r\n" +
      "2,dnd-mdn,National Defence,Défense nationale,100,30000000.00,0\r\n");
    const index = await csv("/monthly/months.csv");
    expect(index.disposition).toBe('attachment; filename="awardwatch-monthly-2026-10-31.csv"');
    expect(index.body).toBe("month,tender_notices,award_notices,value_cad\r\n2026-09,1234,567,98765432.10\r\n2026-08,40,0,\r\n2026-07,35,5,1000.00\r\n");
    for (const path of ["/monthly/2026-08/largest.csv", "/monthly/2026-08/awards.csv"]) {
      const body = (await csv(path)).body;
      expect(body, path).not.toContain(EM_DASH);
      expect(body, path).not.toContain(EN_DASH);
    }
    expect((await csv("/monthly/2026-08/largest.csv")).body).toBe("rank,reference,title,title_fr,published,awarded,organization_id,supplier,buyer_id,buyer," +
      "buyer_fr,value,currency,competitive\r\n");
  });

  it("are counted as downloads and capped as downloads; the pages as pages", () => {
    expect(routeTemplate("GET", "/monthly")).toEqual({ route: "/monthly", kind: "page" });
    expect(routeTemplate("GET", "/monthly/2026-09")).toEqual({ route: "/monthly/:month", kind: "page" });
    expect(routeTemplate("GET", "/monthly/2026-09/largest.csv")).toEqual({ route: "/monthly/:month/:table.csv", kind: "download" });
    expect(routeTemplate("GET", "/monthly/months.csv")).toEqual({ route: "/monthly/months.csv", kind: "download" });
    expect(bucketFor("GET", "/monthly/2026-09/largest.csv")).toBe("download");
    expect(bucketFor("GET", "/monthly/months.csv")).toBe("download");
    expect(bucketFor("HEAD", "/monthly/months.csv")).toBe("page");
    expect(bucketFor("GET", "/monthly/2026-09")).toBe("page");
    expect(bucketFor("GET", "/monthly")).toBe("page");
  });
});

describe("the tables", () => {
  it("fit their column at every width from 700 px, and stack into labelled blocks below it (a phone of 360 px)", async () => {
    for (const path of ["/monthly", "/monthly/2026-09", "/monthly/2026-08", "/monthly?lang=fr", "/monthly/2026-09?lang=fr"]) {
      const page = await html(path);
      expectTablesFit(page, path);
      // Every table restacks below 700 px, so none keeps a row of columns on a phone, whatever its width.
      for (const table of tablesIn(page)) expect(table.cls.includes("restack"), path).toBe(true);
      expect(find(parse(page), (e) => e.tag === "table" && e.cls.includes("compact")), path).toEqual([]);
    }
  });
});

describe("the links to it", () => {
  it("stand in the footer of every page, in the app home's lines and on the Data page", async () => {
    for (const path of ["/", "/tenders", "/data", "/monthly", "/organizations/org-a000000001"]) {
      expect(await html(path), path).toContain('<a href="/monthly">Monthly record</a>');
    }
    expect(await html("/tenders?lang=fr")).toContain('<a href="/monthly">Bilan mensuel</a>');
    expect(decode(await html("/overview"))).toContain('<li><a href="/monthly">See each month in figures</a>: the tender notices, award notices, ' +
      "buyers and suppliers of each complete month, ready to cite.</li>");
    expect(decode(await html("/data"))).toContain('Each complete month of the last twelve in figures, with a CSV file of each table: ' +
      '<a href="/monthly">the monthly record</a>.');
  });
});
