// The expiring-contracts radar: /expiring, /expiring/:window with its
// filters and pages, the sections on buyer pages and profiles, the home tile,
// the feeds, the methodology section and the file readers behind them.
import { describe, expect, it } from "vitest";
import type { ExpiringRow } from "../src/data";
import { app, downloadAllowed } from "../src/index";
import { homeRequest } from "./home";
import {
  expiringQueryString, expiringRecordUrl, filterExpiring, growthPct, readExpiringQuery, soonestFirst, valueBand,
} from "../src/pages/expiring";
import { FEED_EVENTS } from "../src/pages/feeds";
import { routeTemplate } from "../src/views";
import { FILES, assetsWithout, makeFakeAssets, testEnv } from "./assets";
import page1 from "./fixtures/expiring-3m-1.json";

let address = 0;
const get = (path: string, env = testEnv()) =>
  homeRequest(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.51.100.${(address++ % 250) + 1}` } }, env);
const text = async (path: string, env = testEnv()) => (await get(path, env)).text();
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const head = (html: string) => html.slice(0, html.indexOf("</head>"));
const EM_DASH = String.fromCharCode(0x2014);
const rows = page1 as unknown as ExpiringRow[];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// The words the radar never uses: it describes end dates and gives no advice.
const ADVICE = /opportunit|\blead\b|recompet|you should|bid now/i;

describe("/expiring", () => {
  it("shows the three windows, the first rows of the 3-month list, the buyers and the segments", async () => {
    const res = await get("/expiring");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Contracts Ending Soon</h1>");
    // A short-form figure carries its exact value as its title, for the tip.
    expect(html).toContain("<p class=\"lead\">8 federal contracts, worth <span title=\"$12,450,000\" data-tip=\"\">$12.5M</span>, end within 12 months of the data date (2026-10-31), each with the supplier that holds it.</p>");
    // One tile per window: the count, the value, a link to the window.
    expect(html).toContain('<a class="tile" href="/expiring/3m"><span class="tile-label">Within 3 months</span><span class="tile-value">3</span><span class="tile-note">Value <span title="$4,910,500" data-tip="">$4.9M</span></span></a>');
    expect(html).toContain('<a class="tile" href="/expiring/6m"><span class="tile-label">Within 6 months</span><span class="tile-value">5</span>');
    expect(html).toContain('<a class="tile" href="/expiring/12m"><span class="tile-label">Within 12 months</span><span class="tile-value">8</span>');
    // The 3-month list, soonest end first, whatever the file's order.
    expect(html).toContain("<h2>Ending Within 3 Months</h2>");
    expect(html).toContain("The first 3 by end date.");
    expect(html.indexOf("cb-400-40000004")).toBeLessThan(html.indexOf("W8472-000777"));
    expect(html.indexOf("W8472-000777")).toBeLessThan(html.indexOf("C-2026-0042"));
    expect(html).toContain("Individual, name withheld");
    // By buyer and by segment, each count a link to the 12-month list filtered.
    expect(html).toContain('<a href="/buyers/dnd-mdn">National Defence</a>');
    expect(html).toContain('<a href="/expiring/12m?buyer=dnd-mdn">3</a>');
    expect(html).toContain('<a href="/segments/43">43 Information Technology Broadcasting and Telecommunications</a>');
    expect(html).toContain('<a href="/expiring/12m?segment=43">3</a>');
    // The CSV (the free 3-month file; the 12-month one is part of Pro once accounts open) and the feeds.
    expect(html).toContain('<a href="/downloads/expiring-3m.csv" class="btn">Download contracts ending within 3 months (CSV)</a>');
    expect(html).not.toContain("/downloads/expiring-12m.csv");
    expect(html).toContain('<a href="/data/feeds/canada/expiring.xml" class="btn">Atom feed of contracts now within 3 months of their end</a>');
    expect(html).toContain('<a href="/feeds#expiring">Feeds by buyer and by segment</a>');
    expect(head(html)).toContain('<link rel="alternate" type="application/atom+xml" title="Contracts ending within 3 months (Atom feed)" href="/data/feeds/canada/expiring.xml"/>');
    expect(head(html)).toContain('<link rel="canonical" href="https://awardwatch.ca/expiring"/>');
    expect(html).toContain('<a class="rail-item" href="/expiring" aria-current="page"><span class="rail-label">Contracts ending</span>');
    expect(html).not.toContain(EM_DASH);
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(ADVICE);
  });

  it("speaks French", async () => {
    const html = nbsp(await text("/expiring?lang=fr"));
    expect(html).toContain("<h1>Contrats prenant fin bientôt</h1>");
    expect(html).toContain('<span class="tile-label">D’ici 3 mois</span><span class="tile-value">3</span><span class="tile-note">Valeur : <span title="4 910 500 $" data-tip="">4,9 M$</span></span>');
    expect(html).toContain("Particulier, nom non divulgué");
    expect(html).toContain("<h2>Contrats prenant fin d’ici 3 mois</h2>");
    expect(html).toContain('<a href="/buyers/dnd-mdn">Défense nationale</a>');
    expect(html).toContain("Télécharger les contrats prenant fin d’ici 3 mois (CSV)");
    expect(html).toContain('<a class="rail-item" href="/expiring" aria-current="page"><span class="rail-label">Contrats prenant fin</span>');
  });

  it("leaves out the feed links until the feed index lists them, and says so when the 3-month page is missing", async () => {
    const feeds = clone(FILES["feeds/index.json"]) as { feeds: { event: string }[] };
    feeds.feeds = feeds.feeds.filter((f) => f.event !== "expiring");
    const noFeeds = await text("/expiring", testEnv(makeFakeAssets({}, { "feeds/index.json": feeds })));
    expect(noFeeds).not.toContain("/data/feeds/canada/expiring.xml");
    expect(noFeeds).not.toContain("/feeds#expiring");
    expect(noFeeds).toContain("/downloads/expiring-3m.csv");
    const missing = await get("/expiring", testEnv(assetsWithout("expiring/3m/1.json")));
    expect(missing.status).toBe(200);
    expect(await missing.text()).toContain("The list for this window is not published yet.");
    // An empty 3-month window reads no page at all.
    const index = clone(FILES["expiring/index.json"]) as { windows: { window: string; n: number; total: number | null }[] };
    index.windows[0] = { window: "3m", n: 0, total: 0 };
    const empty = await text("/expiring", testEnv(makeFakeAssets({}, { "expiring/index.json": index, "expiring/3m/1.json": undefined })));
    expect(empty).toContain("No contract ends within this window.");
  });

  it("answers 503 'not published' without its index, or with one that does not read", async () => {
    for (const assets of [
      assetsWithout("expiring/index.json"),
      makeFakeAssets({}, { "expiring/index.json": { as_of: "2026-10-31", windows: [{ window: "2m", n: 1, total: 1 }], by_buyer: [], by_segment: [] } }),
      makeFakeAssets({}, { "expiring/index.json": { as_of: "2026-10-31", windows: [], by_buyer: [{ buyer_id: "Not An Id", n: 1, total: 1 }], by_segment: [] } }),
    ]) {
      const res = await get("/expiring", testEnv(assets));
      expect(res.status).toBe(503);
      expect(await res.text()).toContain("Data Not Published Yet");
    }
  });
});

describe("/expiring/:window", () => {
  it("lists the window soonest end first with every column", async () => {
    const html = await text("/expiring/3m");
    expect(html).toContain("<h1>Contracts Ending Within 3 Months</h1>");
    expect(html).toContain("3 contracts end within 3 months of the data date (2026-10-31). Value of the contracts listed: $4,910,500.");
    expect(html.indexOf("cb-400-40000004")).toBeLessThan(html.indexOf("W8472-000777"));
    expect(html.indexOf("W8472-000777")).toBeLessThan(html.indexOf("C-2026-0042"));
    // Ends on, with the days left.
    expect(html).toContain('<td data-label="Ends on" class="mono">2026-11-20<br/><span class="muted small">20 days left</span></td>');
    // The title links the site's own record page where there is one.
    expect(html).toContain('<a href="/awards/cb-400-40000004">Translation standing offer, official languages</a>');
    expect(html).toContain('<a href="/history/w8472-000777">Diesel engine overhaul, patrol vessel</a>');
    expect(html).not.toContain('href="/awards/dnd-mdn');
    // A published contract's title opens its page here (pages/published.tsx),
    // by department and reference; its Record link stays the contracts search.
    expect(html).toContain('<td data-label="Contract" class="lead-cell"><a href="/contracts/dnd-mdn/C-2026-0042">Satellite communications terminal maintenance</a>');
    const fr = await text("/expiring/3m?lang=fr");
    expect(fr).toContain('<td data-label="Contrat" class="lead-cell"><a href="/contracts/dnd-mdn/C-2026-0042">Entretien de terminaux de communication par satellite</a>');
    // The source each row was kept from, on the line under the contract, so it shows while the Record column rests.
    expect(html).toMatch(/Translation standing offer, official languages<\/a><br\/><span class="mono id muted">[^<]+<\/span>[^]*?<br\/><span class="muted small">Award notice/);
    expect(html).toContain('<span class="muted small">Published contract');
    // A line says where the resting columns are, shown only while they rest:
    // for the 3-month list, the free 3-month file, which the head offers too.
    expect(html).toContain('<p class="rest-note muted small">Amendments, value changes and the source record of each contract are in <a href="/downloads/expiring-3m.csv">the 3-month CSV file</a>.</p>');
    expect(html).toContain('<a href="/downloads/expiring-3m.csv" class="btn">Download contracts ending within 3 months (CSV)</a>');
    expect(html).not.toContain("/downloads/expiring-12m.csv");
    // Organization, withheld wording, buyer, value, competition. Below 1440 px the buyer rests and shows
    // under the supplier, on a line of its own after a break (so the cell sorts by its supplier).
    expect(html).toContain('<td data-label="Supplier"><a href="/organizations/org-a000000001">Exemplar Translation Services Inc.</a><br/><span class="lg-down muted small">Buyer: <a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a></span></td>');
    expect(html).toContain('<td data-label="Supplier"><span class="muted">Individual, name withheld</span><br/><span class="lg-down muted small">Buyer: ');
    // The buyer column shows from 1440 px, the competition column from 1280; the record links and amendments and growth from 1600 px.
    expect(html).toContain('<td data-label="Buyer" class="lgh"><a href="/buyers/dfo-mpo">Fisheries and Oceans Canada</a></td>');
    expect(html).toContain('<th class="k-buyer lgh">Buyer</th>');
    expect(html).toContain('<th class="k-comp mdh">Competition</th>');
    expect(html).toContain('<th class="k-record xlh">Record</th>');
    // The Record cell holds the links; the source is under the title.
    expect(html).toMatch(/<td data-label="Record" class="xlh"><a href="https:\/\/canadabuys/);
    // Below 1280 px the competition flag shows under the value.
    expect(html).toMatch(/<td data-label="Value" class="mono num">\$4,500,000<span class="md-only rest-flag"><span class="flag flag-[a-z]+" title="[^>]+">[^<]+<\/span><\/span><\/td>/);
    expect(html).toMatch(/<td data-label="Competition" class="mdh"><span class="flag flag-/);
    expect(html).toContain('<span class="flag flag-yes"');
    expect(html).toContain('<span class="flag flag-no"');
    expect(html).toContain('<span class="flag flag-unstated"');
    // Amendments and value change as a signed percentage.
    expect(html).toContain("2 amendments<br/><span class=\"muted small\">+25% on the original amount</span>");
    expect(html).toContain("1 amendment<br/><span class=\"muted small\">-10% on the original amount</span>");
    expect(html).toContain('<td data-label="Amendments and value change" class="xlh" data-sort="0">None</td>');
    // The source record: the CanadaBuys notice, the history dataset, the contracts search.
    expect(html).toContain('<a href="https://canadabuys.canada.ca/en/tender-opportunities/award-notice/cb-400-40000004" rel="noopener">CanadaBuys notice</a>');
    expect(html).toContain('<a href="https://open.canada.ca/data/en/dataset/4fe645a1-ffcd-40c1-9385-2c771be956a4" rel="noopener">Contract history dataset</a>');
    expect(html).toContain('<a href="https://search.open.canada.ca/contracts/?search_text=C-2026-0042" rel="nofollow noopener">Contracts search</a>');
    // The tender link only where the row names a tender.
    expect(html.match(/>Tender notice</g)?.length).toBe(1);
    expect(html).toContain('<a href="/tenders/cb-100-10000001">Tender notice</a>');
    expect(html).toContain("Page 1 of 1");
    expect(head(html)).toContain('<link rel="canonical" href="https://awardwatch.ca/expiring/3m"/>');
    expect(head(html)).not.toContain('name="robots"');
    expect(html).not.toContain("The filters apply");
    expect(html).not.toContain(EM_DASH);
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(ADVICE);
  });

  it("speaks French, with the record links in French", async () => {
    const html = nbsp(await text("/expiring/3m?lang=fr"));
    expect(html).toContain("<h1>Contrats prenant fin d’ici 3 mois</h1>");
    expect(html).toContain("3 contrats prennent fin dans les 3 mois suivant la date des données (2026-10-31).");
    expect(html).toContain("20 jours restants");
    expect(html).toContain("Particulier, nom non divulgué");
    expect(html).toContain("+25 % par rapport au montant initial");
    expect(html).toContain("-10 % par rapport au montant initial");
    expect(html).toContain(">Aucune</td>");
    expect(html).toContain('href="https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/cb-400-40000004"');
    expect(html).toContain('href="https://open.canada.ca/data/fr/dataset/4fe645a1-ffcd-40c1-9385-2c771be956a4"');
    expect(html).toContain(">Avis d’appel d’offres</a>");
  });

  it("filters the loaded page from the URL and says so", async () => {
    const cases: [string, string[]][] = [
      ["?buyer=dnd-mdn", ["C-2026-0042"]],
      ["?segment=82", ["cb-400-40000004"]],
      ["?competitive=no", ["W8472-000777"]],
      ["?competitive=unstated", ["C-2026-0042"]],
      ["?competitive=yes&kind=award", ["cb-400-40000004"]],
      ["?value=under-100k", ["W8472-000777"]],
      ["?value=100k-1m", ["cb-400-40000004"]],
      ["?value=1m-10m", ["C-2026-0042"]],
      ["?kind=history", ["W8472-000777"]],
      ["?kind=contract&buyer=DND-MDN", ["C-2026-0042"]],
    ];
    const all = ["cb-400-40000004", "W8472-000777", "C-2026-0042"];
    for (const [query, want] of cases) {
      const html = await text(`/expiring/3m${query}`);
      expect(html, query).toContain("The filters apply to the 3 contracts on this page (page 1 of 1). Each other page is filtered when you open it.");
      expect(html, query).toContain(want.length === 1 ? "1 contract on this page matches." : `${want.length} contracts on this page match.`);
      for (const ref of all) {
        if (want.includes(ref)) expect(html, `${query} keeps ${ref}`).toContain(`<span class="mono id muted">${ref}</span>`);
        else expect(html, `${query} drops ${ref}`).not.toContain(`<span class="mono id muted">${ref}</span>`);
      }
      expect(head(html), query).toContain('<meta name="robots" content="noindex"/>');
    }
    const none = await text("/expiring/3m?value=over-10m");
    expect(none).toContain("No contract on this page matches these filters.");
    expect(none).toContain("0 contracts on this page match.");
    // The form shows the link's values; a buyer the page does not carry is still offered.
    const form = await text("/expiring/3m?buyer=dnd-mdn&value=1m-10m");
    expect(form).toContain('<option value="dnd-mdn" selected="">National Defence (1)</option>');
    expect(form).toContain('<option value="1m-10m" selected="">$1 million to under $10 million (1)</option>');
    expect(form).toContain('<option value="contract">Published contracts (1)</option>');
    expect(await text("/expiring/3m?buyer=hc-sc")).toContain('<option value="hc-sc" selected="">hc-sc (0)</option>');
    // Values the filter cannot use read as no filter.
    const junk = await text("/expiring/3m?buyer=Not_An_Id&segment=8&competitive=maybe&value=huge&kind=grant");
    expect(junk).not.toContain("The filters apply");
    for (const ref of all) expect(junk).toContain(`<span class="mono id muted">${ref}</span>`);
    // The window links keep the filters.
    expect(await text("/expiring/3m?kind=award")).toContain('<a href="/expiring/12m?kind=award">Within 12 months</a>');
  });

  it("pages through a window, carrying the filters, and answers 404 for a page or window that is not one", async () => {
    const two = testEnv(makeFakeAssets({}, {
      "expiring/3m/index.json": { window: "3m", pages: 2, rows: 4, total: 5_000_000 },
      "expiring/3m/2.json": [{ ...rows[1], reference: "dnd-mdn:C-2026-0099", end: "2027-01-28", days_left: 89 }],
    }));
    const first = await text("/expiring/3m", two);
    expect(first).toContain("Page 1 of 2");
    expect(first).toContain('<a href="/expiring/3m?page=2" class="btn" rel="next">Next</a>');
    expect(head(first)).toContain('<link rel="next" href="https://awardwatch.ca/expiring/3m?page=2"/>');
    const filtered = await text("/expiring/3m?buyer=dnd-mdn", two);
    expect(filtered).toContain('<a href="/expiring/3m?buyer=dnd-mdn&amp;page=2" class="btn" rel="next">Next</a>');
    expect(filtered).toContain("(page 1 of 2)");
    expect(head(filtered)).not.toContain('rel="next"');
    const second = await text("/expiring/3m?page=2", two);
    expect(second).toContain("C-2026-0099");
    expect(second).not.toContain("cb-400-40000004");
    expect(second).toContain('<a href="/expiring/3m" class="btn" rel="prev">Previous</a>');
    expect(head(second)).toContain('<meta name="robots" content="noindex"/>');
    for (const path of ["/expiring/3m?page=3", "/expiring/3m?page=0", "/expiring/3m?page=x", "/expiring/3m?page=-1"]) {
      const res = await get(path, two);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain('<a href="/expiring/3m">Back to the first page of the window</a>');
    }
    for (const path of ["/expiring/1m", "/expiring/3M", "/expiring/12", "/expiring/all"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain('<a href="/expiring">Back to the contracts ending soon</a>');
    }
    // Not a window even when nothing is published.
    expect((await get("/expiring/1m", testEnv(assetsWithout("stats.json")))).status).toBe(404);
  });

  it("answers 503 'not published' when a window's files are missing or do not read, and says when a window is empty", async () => {
    for (const [path, assets] of [
      ["/expiring/6m", testEnv()],
      ["/expiring/12m?buyer=pwgsc-tpsgc", testEnv()],
      ["/expiring/3m", testEnv(assetsWithout("expiring/3m/index.json"))],
      ["/expiring/3m", testEnv(assetsWithout("expiring/3m/1.json"))],
      ["/expiring/3m", testEnv(makeFakeAssets({}, { "expiring/3m/index.json": { window: "6m", pages: 1, rows: 3, total: 1 } }))],
      ["/expiring/3m", testEnv(makeFakeAssets({}, { "expiring/3m/index.json": { window: "3m", pages: 2, rows: 1, total: 1 } }))],
      ["/expiring/3m", testEnv(makeFakeAssets({}, { "expiring/3m/1.json": [{ ...rows[0], days_left: -1 }] }))],
      ["/expiring/3m", testEnv(makeFakeAssets({}, { "expiring/3m/1.json": [{ ...rows[0], kind: "grant" }] }))],
      ["/expiring/3m", testEnv(makeFakeAssets({}, { "expiring/3m/1.json": [{ ...rows[2], reference: "cb 1/2" }] }))],
      ["/expiring/3m", testEnv(makeFakeAssets({}, { "expiring/3m/1.json": [{ ...rows[2], end: null }] }))],
    ] as const) {
      const res = await get(path, assets);
      expect(res.status, path).toBe(503);
      expect(await res.text(), path).toContain("Data Not Published Yet");
    }
    // A published contract's reference only goes into a search query, so it may hold any text.
    const spaced = await get("/expiring/3m", testEnv(makeFakeAssets({}, { "expiring/3m/1.json": [{ ...rows[1], reference: "dnd-mdn:C 2026/0042" }] })));
    expect(spaced.status).toBe(200);
    expect(await spaced.text()).toContain('href="https://search.open.canada.ca/contracts/?search_text=C%202026%2F0042"');
    // The rows may also come as an object holding them.
    expect((await get("/expiring/3m", testEnv(makeFakeAssets({}, { "expiring/3m/1.json": { rows } }))))).toHaveProperty("status", 200);
    const empty = await get("/expiring/3m", testEnv(makeFakeAssets({}, { "expiring/3m/index.json": { window: "3m", pages: 0, rows: 0, total: 0 } })));
    expect(empty.status).toBe(200);
    expect(await empty.text()).toContain("No contract ends within this window.");
  });
});

describe("contracts ending on buyer pages and profiles", () => {
  it("adds 'Contracts ending soon' to a buyer page whose file carries them", async () => {
    const html = await text("/buyers/pwgsc-tpsgc");
    const section = html.slice(html.indexOf('<h2 id="expiring">'), html.indexOf("Newest Award Notices"));
    expect(section).toContain("<h2 id=\"expiring\">Contracts Ending Soon</h2>");
    expect(section).toContain("1 contract ends within 12 months of the data date. Value: $312,500.");
    expect(section).toContain('<a href="/awards/cb-400-40000004">Translation standing offer, official languages</a>');
    expect(section).toContain('<a href="/expiring/12m?buyer=pwgsc-tpsgc">This buyer&#39;s contracts in the 12-month list</a>');
    // The buyer is the page's own, so the table leaves the column out.
    expect(section).not.toMatch(/<th class="k-buyer[^"]*">(<button type="button" class="th-sort">)?Buyer</);
    // The section shows its rows whole, so every head sorts them in the page.
    expect(section).toContain('<th class="k-org"><button type="button" class="th-sort">Supplier</button></th>');
    // The same order as the full list: amendments and growth and the record links from 1600 px.
    expect(section).toContain('<th class="k-amend xlh"><button type="button" class="th-sort">');
    expect(section).toContain('<th class="k-record xlh"><button type="button" class="th-sort">Record</button></th>');
    const fr = nbsp(await text("/buyers/pwgsc-tpsgc?lang=fr"));
    expect(fr).toContain('<h2 id="expiring">Contrats prenant fin bientôt</h2>');
    expect(fr).toContain("1 contrat prend fin dans les 12 mois suivant la date des données. Valeur : 312 500 $.");
    // Older files carry no radar: no section.
    const buyer = clone(FILES["buyers/pwgsc-tpsgc.json"]) as Record<string, unknown>;
    delete buyer.expiring;
    const old = await text("/buyers/pwgsc-tpsgc", testEnv(makeFakeAssets({}, { "buyers/pwgsc-tpsgc.json": buyer })));
    expect(old).toContain("Newest Award Notices");
    expect(old).not.toContain('id="expiring"');
    // A part that does not read makes the file unreadable, like any other field.
    (buyer as any).expiring = { n: 0, total: null, rows: [rows[0]] };
    expect((await get("/buyers/pwgsc-tpsgc", testEnv(makeFakeAssets({}, { "buyers/pwgsc-tpsgc.json": buyer })))).status).toBe(404);
  });

  it("adds 'Contracts ending' to a profile that carries them, with where the rest are", async () => {
    const html = await text("/organizations/org-a000000001");
    const section = html.slice(html.indexOf('<h2 id="expiring">'), html.indexOf('<h2 id="awards">'));
    expect(section).toContain("<h2 id=\"expiring\">Contracts Ending</h2>");
    expect(section).toContain("1 contract ends within 12 months of the data date. Value: $312,500.");
    expect(section).not.toMatch(/<th class="k-org[^"]*">(<button type="button" class="th-sort">)?Organization</);
    expect(section).toContain('<th class="k-buyer mdh"><button type="button" class="th-sort">Buyer</button></th>');
    expect(section).toContain('<th class="k-amend xlh"><button type="button" class="th-sort">');
    expect(section).toContain('<th class="k-record xlh"><button type="button" class="th-sort">Record</button></th>');
    // The radar has no supplier filter: a link to it would drop the organization, so the profile has none.
    expect(section).not.toContain('<a href="/expiring">');
    expect(section).not.toContain("The first");
    expect(await text("/organizations/org-a000000002")).not.toContain('id="expiring"');
    const fr = nbsp(await text("/organizations/org-a000000001?lang=fr"));
    expect(fr).toContain('<h2 id="expiring">Contrats prenant fin</h2>');
    // More rows than the part holds: the rest are in the 12-month list, linked
    // as the window's page (its free view once the 12-month window is Pro).
    const profiles = clone(FILES["profiles/a00.json"]) as Record<string, any>;
    profiles["org-a000000001"].expiring.n = 30;
    const more = await text("/organizations/org-a000000001", testEnv(makeFakeAssets({}, { "profiles/a00.json": profiles })));
    expect(more).toContain('The first 1 by end date are shown. The other 29 are in <a href="/expiring/12m">the 12-month list</a>.');
    const moreFr = nbsp(await text("/organizations/org-a000000001?lang=fr", testEnv(makeFakeAssets({}, { "profiles/a00.json": profiles }))));
    expect(moreFr).toContain('Les 29 autres se trouvent dans <a href="/expiring/12m">la liste de 12 mois</a>.');
    profiles["org-a000000001"].expiring.n = 2;
    expect(await text("/organizations/org-a000000001", testEnv(makeFakeAssets({}, { "profiles/a00.json": profiles }))))
      .toContain("The other one is in");
  });
});

describe("home, feeds, methodology and the downloads", () => {
  it("shows the 3-month tile on the home page when the index is published", async () => {
    const html = await text("/");
    // With the window's value, which the rail beside it does not give.
    expect(html).toContain('<a class="tile" href="/expiring/3m"><span class="tile-label">Ending within 3 months</span><span class="tile-value">3</span><span class="tile-note">Worth <span title="$4,910,500" data-tip="">$4.9M</span></span>');
    // After the year's award notices tile.
    expect(html.indexOf('<a class="tile" href="/expiring/3m"')).toBeGreaterThan(html.indexOf('<span class="tile-label">Award notices in 2026</span>'));
    expect(nbsp(await text("/?lang=fr"))).toContain('<span class="tile-label">Contrats prenant fin d’ici 3 mois</span>');
    for (const assets of [assetsWithout("expiring/index.json"), makeFakeAssets({}, { "expiring/index.json": "{" })]) {
      const res = await get("/", testEnv(assets));
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain('href="/expiring/3m"');
    }
  });

  it("lists the expiring feeds from the feed index, and only then", async () => {
    expect(FEED_EVENTS).toEqual(["tenders", "awards"]);
    const html = await text("/feeds");
    expect(html).toContain("Feeds of new tender notices, new award notices and contracts ending within 3 months, each holding the 50 newest entries.");
    expect(html).toContain('<li id="expiring"><strong>Contracts ending within 3 months</strong>');
    expect(html).toContain('<td data-label="Feed">Contracts ending within 3 months</td>');
    expect(html).toContain("https://awardwatch.ca/data/feeds/canada/expiring.xml");
    expect(html).toContain('<a href="/data/feeds/segment/82/expiring.xml" class="mono" aria-label="82 Editorial and Design and Graphic and Fine Art Services: Contracts ending within 3 months">expiring.xml</a>');
    expect(html).toContain('<td data-label="Buyer">Public Services and Procurement Canada</td>');
    expect(html).toContain('href="/data/feeds/buyer/pwgsc-tpsgc/expiring.xml"');
    // The province feeds carry no expiring column.
    const prov = html.slice(html.indexOf('<h2 id="province">'), html.indexOf('<h2 id="buyer">'));
    expect(prov).not.toContain("Contracts ending");
    const feeds = clone(FILES["feeds/index.json"]) as { feeds: { event: string }[] };
    feeds.feeds = feeds.feeds.filter((f) => f.event !== "expiring");
    // The page itself, past the rail, whose overview names the 12-month list.
    const none = (await text("/feeds", testEnv(makeFakeAssets({}, { "feeds/index.json": feeds })))).replace(/<nav class="rail"[\s\S]*?<\/nav>/, "");
    expect(none).not.toContain("Contracts ending");
    expect(none).not.toContain("contracts ending");
    expect(none).not.toContain('id="expiring"');
    expect(nbsp(await text("/feeds?lang=fr"))).toContain("Contrats prenant fin d’ici 3 mois");
  });

  it("states the radar's rules on the methodology page in both languages", async () => {
    const html = await text("/methodology");
    expect(html).toContain('<a href="#expiring">Contracts Ending Soon</a>');
    expect(html).toContain('<h2 id="expiring">Contracts Ending Soon</h2>');
    expect(html).toContain("Its newest version must have an end date on or after the data date and within 12 months of it.");
    expect(html).toContain("It prefers the CanadaBuys award notice, which links the solicitation, then PSPC contract history, then the published contract.");
    expect(html).toContain("end date (within 3 days) and value (within 1%) all match a kept record");
    expect(html).toContain("The windows are cumulative: within 3, 6 and 12 months of the data date.");
    expect(html).toContain("Value growth is the newest total value over the original amount, minus one");
    expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(ADVICE);
    const fr = nbsp(await text("/methodology?lang=fr"));
    expect(fr).toContain('<h2 id="expiring">Contrats prenant fin bientôt</h2>');
    expect(fr).toContain("Les périodes sont cumulatives : d’ici 3, 6 et 12 mois après la date des données.");
  });

  it("allows the 3- and 12-month CSVs, lists them on the Data page and names the routes by template", async () => {
    expect(downloadAllowed("expiring-12m.csv")).toBe(true);
    expect(downloadAllowed("expiring-3m.csv")).toBe(true);
    expect(downloadAllowed("expiring-6m.csv")).toBe(false);
    const data = await text("/data");
    expect(data).toContain('<a href="/downloads/expiring-3m.csv" class="mono">expiring-3m.csv</a>');
    expect(data).toContain("Every contract ending within 3 months of the data date, in the 12-month file&#39;s columns");
    expect(data).toContain('<a href="/downloads/expiring-12m.csv" class="mono">expiring-12m.csv</a>');
    expect(data).toContain("Every contract ending within 12 months of the data date");
    expect(routeTemplate("GET", "/downloads/expiring-3m.csv")).toEqual({ route: "/downloads/expiring-3m.csv", kind: "download" });
    expect(routeTemplate("GET", "/expiring")).toEqual({ route: "/expiring", kind: "page" });
    expect(routeTemplate("GET", "/expiring/3m")).toEqual({ route: "/expiring/:window", kind: "page" });
    expect(routeTemplate("GET", "/expiring/whatever")).toEqual({ route: "/expiring/:window", kind: "page" });
    expect(routeTemplate("GET", "/expiring/3m/2")).toEqual({ route: "other", kind: "other" });
    expect(routeTemplate("GET", "/downloads/expiring-12m.csv")).toEqual({ route: "/downloads/expiring-12m.csv", kind: "download" });
  });
});

describe("filter rules", () => {
  const q = (s: string) => readExpiringQuery(new URL(`https://x/expiring/3m${s}`));
  const refs = (s: string) => filterExpiring(soonestFirst(rows), q(s)).map((r) => r.reference);

  it("sorts soonest end first and filters by each field", () => {
    expect(soonestFirst(rows).map((r) => r.reference)).toEqual(["cb-400-40000004", "W8472-000777", "dnd-mdn:C-2026-0042"]);
    expect(refs("")).toHaveLength(3);
    expect(refs("?buyer=pwgsc-tpsgc")).toEqual(["cb-400-40000004"]);
    expect(refs("?segment=25")).toEqual(["W8472-000777"]);
    expect(refs("?competitive=YES")).toEqual(["cb-400-40000004"]);
    expect(refs("?kind=contract&value=1m-10m")).toEqual(["dnd-mdn:C-2026-0042"]);
    expect(refs("?kind=contract&value=under-100k")).toEqual([]);
    expect(expiringQueryString(q("?kind=award&bogus=1&value=over-10m&buyer=dnd-mdn"), 3)).toBe("?buyer=dnd-mdn&value=over-10m&kind=award&page=3");
    expect(expiringQueryString(q(""))).toBe("");
  });

  it("puts each value in one band, lower bound included, and none for another currency or no value", () => {
    const band = (value: number | null, currency: string | null = "CAD") => valueBand({ value, currency });
    expect(band(99_999.99)).toBe("under-100k");
    expect(band(100_000)).toBe("100k-1m");
    expect(band(999_999)).toBe("100k-1m");
    expect(band(1_000_000, null)).toBe("1m-10m");
    expect(band(10_000_000, "")).toBe("over-10m");
    expect(band(-5000)).toBe("under-100k");
    expect(band(5_000_000, "USD")).toBeNull();
    expect(band(null)).toBeNull();
  });

  it("writes growth as a signed whole percentage", () => {
    expect(growthPct("en", 0.25)).toBe("+25%");
    expect(growthPct("en", -0.1)).toBe("-10%");
    expect(growthPct("en", 0)).toBe("0%");
    expect(growthPct("en", 0.003)).toBe("+<1%");
    expect(growthPct("en", 12.5)).toBe("+1,250%");
    expect(nbsp(growthPct("fr", 0.25))).toBe("+25 %");
  });

  it("links each kind to the government's record", () => {
    expect(expiringRecordUrl(rows[2], "fr")).toBe("https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/cb-400-40000004");
    expect(expiringRecordUrl(rows[0], "en")).toBe("https://open.canada.ca/data/en/dataset/4fe645a1-ffcd-40c1-9385-2c771be956a4");
    expect(expiringRecordUrl(rows[1], "en")).toBe("https://search.open.canada.ca/contracts/?search_text=C-2026-0042");
  });
});
