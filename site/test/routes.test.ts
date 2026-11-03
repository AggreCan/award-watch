// Every page of the first slice: a 200 in the page's language for a record
// that exists, a 404 for one that does not, and "not published" (503) when the
// file the page reads is missing.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { TenderRow } from "../src/data";
import {
  LOCKUP_WORD_PATH, MARK_CHECK_COLOUR, MARK_CHECK_PATH, MARK_INK_PATH, WORDMARK_CHECK_INDEX, WORDMARK_CHECK_PATH, WORDMARK_INK_PATHS,
} from "../src/layout";
import lockupSvg from "../../brand/lockup.svg?raw";
import wordmarkSvg from "../../brand/wordmark.svg?raw";
import { filterTenders, readTenderQuery, tenderQueryString } from "../src/pages/tenders";
import { assetsWithout, emptyAssets, fakeAssets, makeFakeAssets, testClock, testEnv } from "./assets";
import openFirst from "./fixtures/tenders-open-first.json";
import stats from "./fixtures/stats.json";
import openTenders from "./fixtures/tenders-open.json";

let address = 0;
const get = (path: string, env = testEnv(), headers: Record<string, string> = {}) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.0.${(address++ % 250) + 1}`, ...headers } }, env);
const text = async (path: string, env = testEnv()) => (await get(path, env)).text();
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const decode = (s: string) => s.replace(/&amp;/g, "&");
const EM_DASH = String.fromCharCode(0x2014);

// [path, English phrase, French phrase, file whose absence makes it 503]
const PAGES: [string, string, string, string][] = [
  ["/", "Federal Tenders, Contracts and Grants, by Organization", "Appels d’offres, contrats et subventions du fédéral, par organisation", "stats.json"],
  ["/tenders", "<h1>Open Tender Notices</h1>", "<h1>Avis d’appel d’offres ouverts</h1>", "tenders/open-first.json"],
  ["/tenders/new", "<h1>New Tender Notices</h1>", "<h1>Nouveaux avis d’appel d’offres</h1>", "stats.json"],
  ["/tenders/cb-100-10000001", "<h1>Translation services for regional offices</h1>", "<h1>Services de traduction pour les bureaux régionaux</h1>", "stats.json"],
  ["/awards", "<h1>Award Notices</h1>", "<h1>Avis d’attribution</h1>", "awards/recent.json"],
  ["/awards/2026", "<h1>Award Notices in 2026</h1>", "<h1>Avis d’attribution en 2026</h1>", "awards/2026/index.json"],
  ["/awards/2026?page=2", "Interpretation services, regional consultations", "interprétation, consultations régionales", "awards/2026/2.json"],
  ["/awards/cb-400-40000004", "<h1>Translation standing offer, official languages</h1>", "<h1>Offre à commandes de traduction, langues officielles</h1>", "stats.json"],
  ["/expiring", "<h1>Contracts Ending Soon</h1>", "<h1>Contrats prenant fin bientôt</h1>", "expiring/index.json"],
  ["/expiring/3m", "<h1>Contracts Ending Within 3 Months</h1>", "<h1>Contrats prenant fin d’ici 3 mois</h1>", "expiring/3m/1.json"],
  ["/expiring/3m?buyer=dnd-mdn", "Satellite communications terminal maintenance", "Entretien de terminaux de communication par satellite", "expiring/3m/index.json"],
  ["/history/w8472-000633", "<h1>Vessel refit, mid-shore patrol</h1>", "<h1>Radoub de navire, patrouille semi-hauturière</h1>", "stats.json"],
  ["/organizations", "<h1>Organizations</h1>", "<h1>Organisations</h1>", "directory/index.json"],
  ["/organizations/directory/on", "<h1>Organizations A to Z: Ontario</h1>", "<h1>Organisations de A à Z : Ontario</h1>", "directory/on/index.json"],
  ["/organizations/org-a000000001", "<h1>Exemplar Translation Services Inc.</h1>", "Chiffres par année et par source", "stats.json"],
  ["/buyers", "<h1>Federal Buyers</h1>", "<h1>Acheteurs fédéraux</h1>", "buyers/index.json"],
  ["/buyers/pwgsc-tpsgc", "Public Services and Procurement Canada", "<h1>Services publics et Approvisionnement Canada", "stats.json"],
  ["/segments", "<h1>Procurement by Segment</h1>", "<h1>Approvisionnement par segment</h1>", "categories/index.json"],
  ["/segments/82", "<h1>Editorial and Design and Graphic and Fine Art Services</h1>", "<h1>Services de rédaction, de design, de graphisme et de beaux-arts</h1>", "categories/82.json"],
  ["/rankings", "<h1>Rankings</h1>", "<h1>Classements</h1>", "rankings/all.json"],
  ["/rankings/2026", "<h1>Rankings for 2026</h1>", "<h1>Classements de 2026</h1>", "stats.json"],
  ["/data", "<h1>Data, Downloads and Licence</h1>", "<h1>Données, téléchargements et licence</h1>", "stats.json"],
  ["/cite", "<h1>How to Cite</h1>", "<h1>Comment citer</h1>", "stats.json"],
];

// Pages that answer without the data files, in both languages.
const STATIC: [string, string, string][] = [
  ["/methodology", "<h1>Methodology</h1>", "<h1>Méthodologie</h1>"],
  ["/feeds", "<h1>Atom Feeds</h1>", "<h1>Fils Atom</h1>"],
  ["/watchlist", "<h1>Watchlist</h1>", "<h1>Liste de suivi</h1>"],
  ["/corrections", "<h1>Report a Correction</h1>", "<h1>Signaler une correction</h1>"],
];

describe("every page", () => {
  it("answers 200 in English and in French", async () => {
    for (const [path, en, fr] of [...PAGES.map(([p, e, f]) => [p, e, f] as const), ...STATIC]) {
      const english = await get(path);
      expect(english.status, path).toBe(200);
      const body = await english.text();
      expect(body, path).toContain(en);
      expect(body, path).toContain('<html lang="en">');
      expect(body, path).not.toContain(EM_DASH);
      const french = nbsp(await text(`${path}${path.includes("?") ? "&" : "?"}lang=fr`));
      expect(french, path).toContain(fr);
      expect(french, path).toContain('<html lang="fr">');
    }
  });

  it("answers 503 'not published' when the file it reads is missing", async () => {
    for (const [path, , , file] of PAGES) {
      const res = await get(path, testEnv(assetsWithout(file)));
      expect(res.status, `${path} without ${file}`).toBe(503);
      expect(await res.text(), path).toContain("Data Not Published Yet");
      expect(res.headers.get("cache-control"), path).toBe("no-store");
    }
    for (const [path] of PAGES) expect((await get(path, testEnv(emptyAssets))).status, path).toBe(503);
    for (const [path] of STATIC) expect((await get(path, testEnv(emptyAssets))).status, path).toBe(200);
  });

  it("answers 404 for a well-formed id or reference that no file holds", async () => {
    for (const [path, title] of [
      ["/tenders/cb-999-99999999", "Tender Notice Not Found"],
      ["/awards/cb-999-99999999", "Award Notice Not Found"],
      ["/history/w0000-000000", "Contract History Record Not Found"],
      ["/awards/2009", "No Award Notices for This Year"],
      ["/expiring/1m", "Window Not Found"],
      ["/expiring/3m?page=2", "Page Not Found"],
      ["/expiring/6m", "Data Not Published Yet"],
      ["/organizations/org-ffffffffff", "Organization Not Found"],
      ["/buyers/no-such-buyer", "Buyer Not Found"],
      ["/segments/99", "Segment Not Found"],
      ["/segments/10", "Data Not Published Yet"],
      ["/rankings/2019", "No Rankings for This Year"],
    ] as const) {
      const res = await get(path);
      expect(res.status, path).toBe(title === "Data Not Published Yet" ? 503 : 404);
      expect(await res.text(), path).toContain(title);
    }
    // Things that are not ids at all fall through to the site's 404 page.
    for (const path of ["/tenders/a%20b", "/organizations/not-an-id", "/buyers/Not_An_Id", "/segments/8", "/rankings/20x6", "/nowhere"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
    }
  });

  it("sends a mixed-case reference or id to its lower-case address", async () => {
    for (const [path, to] of [
      ["/tenders/CB-100-10000001?lang=fr", "/tenders/cb-100-10000001?lang=fr"],
      ["/awards/CB-400-40000004", "/awards/cb-400-40000004"],
      ["/history/W8472-000633", "/history/w8472-000633"],
      ["/buyers/PWGSC-TPSGC", "/buyers/pwgsc-tpsgc"],
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(301);
      expect(res.headers.get("location"), path).toBe(to);
    }
  });

  it("keeps the layout: rail, footer, data date, mark, theme and language toggles, no third-party asset", async () => {
    const res = await get("/");
    const html = await res.text();
    // The rail: the live index with its counts, the browse links, the reader's lists.
    const nav = html.match(/<nav class="rail" aria-label="Main">[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect([...nav.matchAll(/<a class="rail-item[^"]*" href="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "/tenders", "/tenders/new", "/tenders?closing=7", "/awards", "/awards/2026", "/expiring", "/expiring/3m", "/organizations",
      "/buyers", "/segments", "/rankings", "/feeds", "/alerts", "/data", "/methodology", "/watchlist", "/alerts",
    ]);
    expect(nav).toContain('<a class="rail-item" href="/tenders"><span class="rail-label">Open tender notices</span><span class="rail-n">3</span></a>');
    expect(nav).toContain('<a class="rail-item rail-child soon" href="/tenders?closing=7"><span class="rail-label">Closing within 7 days</span><span class="rail-n" data-soon-count="">1</span></a>');
    expect(nav).toContain('<a class="rail-item" href="/awards"><span class="rail-label">Award notices</span><span class="rail-n">5,883</span></a>');
    expect(nav).toContain('<a class="rail-item rail-child" href="/awards/2026"><span class="rail-label"><span class="rail-short">In 2026</span><span class="rail-full">Award notices in 2026</span></span><span class="rail-n">3</span></a>');
    expect(nav).toContain('<a class="rail-item" href="/expiring"><span class="rail-label">Contracts ending</span><span class="rail-n">8</span></a>');
    expect(nav).toContain('<a class="rail-item rail-child" href="/expiring/3m"><span class="rail-label"><span class="rail-short">Within 3 months</span><span class="rail-full">Ending within 3 months</span></span><span class="rail-n">3</span></a>');
    // The home page is none of the rail's items.
    expect(nav).not.toContain("aria-current");
    expect(nav).not.toContain("rail-ancestor");
    expect(nav).toContain('<span class="rail-n" data-watch-count="" hidden=""></span>');
    expect(nav).toContain('<a class="rail-item rail-later" href="/alerts"><span class="rail-label">Alerts: soon</span></a>');
    // A page's own section is marked in the rail.
    expect(await text("/buyers")).toContain('<a class="rail-item" href="/buyers" aria-current="page">');
    const footer = html.slice(html.indexOf('<footer class="site-footer">'));
    for (const href of ["/methodology", "/feeds", "/alerts", "/watchlist", "/corrections", "/cite", "/data#downloads", "/data#sources", "/about", "/terms", "/privacy"]) {
      expect(footer, href).toContain(`href="${href}"`);
    }
    expect(html).toContain("Data date: 2026-10-31");
    expect(html).toContain('<svg class="brand-wordmark" viewBox="0 0 241 34"');
    expect(html).toContain('<path class="mark-check" fill="#0f7b4f" fill-rule="evenodd"');
    expect(html).toContain('<button type="button" class="theme-toggle"><span class="when-light">Dark</span><span class="when-dark">Light</span></button>');
    expect(html).toContain('<a href="?lang=fr" class="lang-toggle" rel="nofollow">Français</a>');
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>');
    expect(html).toMatch(/<link rel="stylesheet" href="\/styles\.css\?v=\d+"\/>/);
    // No social accounts, no notice bar, nothing loaded from another host.
    expect(html).not.toMatch(/x\.com|bsky|notice-ee|ko-fi/i);
    // The site takes no donations: no support page, no payment link, no webhook.
    expect(footer).not.toContain('href="/support"');
    expect(html).not.toMatch(/donat|Support the site/i);
    expect(html).not.toMatch(/<script[^>]+src="https?:/);
    expect(html).not.toMatch(/<link rel="(?:stylesheet|icon|preload|apple-touch-icon)"[^>]+href="https?:/);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toMatch(/leaflet|openstreetmap|cdnjs/);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("carries the wordmark in the top bar, named for readers, with no name in live text", async () => {
    for (const path of ["/", "/?lang=fr", "/methodology"]) {
      const html = await text(path);
      const bar = html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] ?? "";
      // The link and the image both carry the name, the same in either language: 24 px tall, 170 wide.
      expect(bar, path).toContain('<a href="/" class="brand" aria-label="Award Watch"><svg class="brand-wordmark" viewBox="0 0 241 34" width="170" height="24" role="img"><title>Award Watch</title>');
      // The file's eleven shapes in its order: the letters in currentColor, the check in the check token's class.
      const drawn = [...bar.matchAll(/<path (?:class="mark-check" )?fill="([^"]+)" fill-rule="evenodd" d="([^"]+)"><\/path>/g)].map((m) => m[2]);
      const expected = [...WORDMARK_INK_PATHS];
      expected.splice(WORDMARK_CHECK_INDEX, 0, WORDMARK_CHECK_PATH);
      expect(drawn, path).toEqual(expected);
      expect(bar, path).toContain(`<path class="mark-check" fill="#0f7b4f" fill-rule="evenodd" d="${WORDMARK_CHECK_PATH}"></path>`);
      expect(bar, path).not.toContain("brand-lockup");
      expect(bar, path).not.toContain("brand-name");
      // Outside the image's title, the bar's text is the data date and the toggles.
      expect(bar.replace(/<title>[^<]*<\/title>/g, "").replace(/<[^>]+>/g, " "), path).not.toContain("Award Watch");
    }
  });

  it("draws the wordmark from brand/wordmark.svg's paths", () => {
    const paths = [...wordmarkSvg.matchAll(/<path fill="([^"]+)" fill-rule="evenodd" d="([^"]+)"\s*\/>/g)].map((m) => [m[1], m[2]]);
    expect(paths).toHaveLength(11);
    expect(wordmarkSvg).toContain('viewBox="0 0 241 34"');
    expect(paths[WORDMARK_CHECK_INDEX]).toEqual([MARK_CHECK_COLOUR, WORDMARK_CHECK_PATH]);
    const ink = paths.filter((_, i) => i !== WORDMARK_CHECK_INDEX);
    expect(ink.every(([fill]) => fill === "currentColor")).toBe(true);
    expect(ink.map(([, d]) => d)).toEqual([...WORDMARK_INK_PATHS]);
  });

  it("keeps the lockup's constants drawn from brand/lockup.svg's paths", () => {
    const paths = [...lockupSvg.matchAll(/<path fill="([^"]+)" fill-rule="evenodd" d="([^"]+)"\/>/g)].map((m) => [m[1], m[2]]);
    expect(paths).toHaveLength(13);
    expect(lockupSvg).toContain('viewBox="0 0 201 32"');
    expect(`${paths[0][1]} ${paths[1][1]}`).toBe(MARK_INK_PATH);
    expect(paths[2]).toEqual([MARK_CHECK_COLOUR, MARK_CHECK_PATH]);
    expect(paths.slice(3).every(([fill]) => fill === "currentColor")).toBe(true);
    expect(paths.slice(3).map(([, d]) => d).join(" ")).toBe(LOCKUP_WORD_PATH);
  });
});

describe("tender notices", () => {
  it("never shows the contact on a notice, even when the file carries one", async () => {
    for (const path of ["/tenders/cb-100-10000001", "/tenders/cb-100-10000001?lang=fr"]) {
      const html = await text(path);
      expect(html, path).not.toContain("contracting.officer@example.invalid");
      expect(html, path).not.toContain("Example Contracting Officer");
      expect(html, path).not.toContain("000-000-0000");
    }
    expect(await text("/tenders/cb-100-10000001")).toContain('href="https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-100-10000001"');
    expect(await text("/tenders/cb-100-10000001?lang=fr")).toContain('href="https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/cb-100-10000001"');
    const award = await text("/awards/cb-400-40000004");
    expect(award).not.toContain("awards.officer@example.invalid");
    expect(award).toContain('href="https://canadabuys.canada.ca/en/tender-opportunities/award-notice/cb-400-40000004"');
    expect(await text("/awards/cb-400-40000004?lang=fr")).toContain('href="https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/cb-400-40000004"');
  });

  it("shows a notice's fields, codes, amendments and related awards", async () => {
    const html = await text("/tenders/cb-200-20005019");
    expect(html).toContain('<span class="badge badge-open">Open</span>');
    expect(html).toContain('<a href="/buyers/dfo-mpo">Fisheries and Oceans Canada</a>');
    expect(html).toContain("72101500");
    expect(html).toContain('<a href="/segments/72">72 Building and Facility Construction and Maintenance Services</a>');
    expect(html).toContain('<a href="/awards/cb-500-50000005">Dock repairs, small craft harbour</a>');
    expect(html).toContain('<a href="/organizations/org-a000000002">Sample Harbour Marine Ltd.</a>');
    // Whole dollars from 1,000 up.
    expect(html).toContain("$48,501");
    const one = await text("/tenders/cb-100-10000001");
    expect(one).toContain('<span class="badge badge-closing" data-notice="cb-100-10000001">Closing soon</span>');
    expect(one).toContain("2026-11-03 14:00 ET");
    expect(one).toContain("2 versions on record.");
  });

  it("renders from the first file and never parses the full list", async () => {
    const asked: string[] = [];
    const counting = {
      fetch: async (input: Request) => {
        asked.push(new URL(input.url).pathname);
        return fakeAssets.fetch(input);
      },
    } as unknown as Fetcher;
    for (const path of ["/tenders", "/tenders?segment=82", "/tenders?page=2&sort=published", "/tenders?lang=fr"]) {
      expect((await get(path, testEnv(counting))).status, path).toBe(200);
    }
    expect(asked).toContain("/data/tenders/open-first.json");
    expect(asked).not.toContain("/data/tenders/open.json");
  });

  it("leaves a filtered or later view to the script when the first file holds only part of the list", async () => {
    const partial = { ...openFirst, total: 900 };
    const env = testEnv(makeFakeAssets({}, { "tenders/open-first.json": partial }));
    const plain = await (await get("/tenders", env)).text();
    expect(plain).toContain("900 notices open on CanadaBuys at the data date");
    expect(plain).toContain("<p id=\"tender-count\" aria-live=\"polite\">900 notices</p>");
    expect(plain).toContain("Page 1 of 18");
    expect(plain).toContain('<a href="/tenders?page=2" class="btn" rel="next">Next</a>');
    for (const path of ["/tenders?segment=82", "/tenders?page=2", "/tenders?sort=published"]) {
      const html = await (await get(path, env)).text();
      expect(html, path).toContain("These filters apply once the full list of open notices has loaded in your browser.");
      expect(html, path).toContain('<noscript><p>Filtering the full list needs JavaScript. Without it, <a href="/tenders">the unfiltered list</a> shows the open notices by closing date.</p></noscript>');
      expect(html, path).not.toContain("cb-100-10000001");
      expect(html, path).toContain('<meta name="robots" content="noindex"/>');
    }
    // The form still shows the link's values, so the script and the reader start from them.
    expect(await (await get("/tenders?segment=82", env)).text()).toContain('<option value="82" selected="">');
  });

  it("lists the open notices, the first 50 by closing date, with the filters the rows carry", async () => {
    const html = await text("/tenders");
    expect(html).toContain("3 notices open on CanadaBuys at the data date");
    expect(html.indexOf("cb-100-10000001")).toBeLessThan(html.indexOf("cb-200-20005019"));
    expect(html.indexOf("cb-200-20005019")).toBeLessThan(html.indexOf("cb-300-30000003"));
    expect(html).toContain('<option value="82">82 Editorial and Design and Graphic and Fine Art Services (1)</option>');
    expect(html).toContain('<option value="dnd-mdn">Department of National Defence (1)</option>');
    expect(html).toContain('<script type="module" src="/tenders.js"></script>');
    // The script reads closing states from the visitor's clock, not a date the page hands it.
    expect(html).not.toContain("data-today=");
    expect(html).toContain('<script type="module" src="/countdown.js"></script>');
    expect(html).toContain("Canada-wide or not stated");
  });

  it("renders a filtered view from its URL, so the link works without the script", async () => {
    // A province keeps the notices that name none, unless the box is unticked.
    const html = await text("/tenders?province=bc&sort=published&national=0");
    expect(html).toContain("1 notice");
    expect(html).toContain("cb-200-20005019");
    expect(html).not.toContain(">cb-100-10000001<");
    expect(html).toMatch(/<input type="checkbox" name="national" value="1"\/>/);
    expect(html).toContain('<option value="BC" selected="">British Columbia (1)</option>');
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    const none = await text("/tenders?q=zzzz");
    expect(none).toContain("No open notice matches these filters.");
  });

  it("filters and sorts by the rules the script uses", () => {
    const rows = openTenders as unknown as TenderRow[];
    const q = (s: string) => readTenderQuery(new URL(`https://x/tenders${s}`));
    const refs = (s: string) => filterTenders(rows, q(s), testClock).map((r) => r.reference);
    expect(refs("")).toEqual(["cb-100-10000001", "cb-200-20005019", "cb-300-30000003"]);
    expect(refs("?sort=published")).toEqual(["cb-200-20005019", "cb-100-10000001", "cb-300-30000003"]);
    expect(refs("?closing=7")).toEqual(["cb-100-10000001"]);
    expect(refs("?closing=30")).toEqual(["cb-100-10000001", "cb-200-20005019"]);
    expect(refs("?segment=43")).toEqual(["cb-300-30000003"]);
    expect(refs("?category=gd")).toEqual(["cb-300-30000003"]);
    // Notices that name no province (Canada-wide or not stated) stay in unless national=0 alone says otherwise.
    expect(refs("?province=QC")).toEqual(["cb-100-10000001", "cb-300-30000003"]);
    expect(refs("?province=QC&national=0")).toEqual(["cb-100-10000001"]);
    expect(refs("?province=QC&national=0&national=1")).toEqual(["cb-100-10000001", "cb-300-30000003"]);
    // A UNSPSC family or class is a prefix of any of a notice's codes.
    expect(refs("?code=7210")).toEqual(["cb-200-20005019"]);
    expect(refs("?code=781815")).toEqual(["cb-200-20005019"]);
    expect(refs("?code=43")).toEqual(["cb-300-30000003"]);
    expect(refs("?code=4321150x")).toHaveLength(3);
    // The words reach the start of the description, in either language.
    expect(refs("?q=propeller")).toEqual(["cb-200-20005019"]);
    expect(refs("?q=correspondance")).toEqual(["cb-100-10000001"]);
    expect(refs("?buyer=dfo-mpo")).toEqual(["cb-200-20005019"]);
    expect(refs(`?type=${encodeURIComponent("Invitation to Qualify")}`)).toEqual(["cb-300-30000003"]);
    expect(refs(`?method=${encodeURIComponent("Competitive - Selective tendering")}`)).toEqual(["cb-200-20005019"]);
    // Text matches either language's title and the reference, accents folded.
    expect(refs("?q=renforces")).toEqual(["cb-300-30000003"]);
    expect(refs("?q=HULL+repair")).toEqual(["cb-200-20005019"]);
    expect(refs("?q=20005019")).toEqual(["cb-200-20005019"]);
    // Values the filter cannot use read as no filter.
    expect(refs("?segment=99&province=ZZ&closing=5&buyer=BAD_ID&sort=up")).toHaveLength(3);
    expect(tenderQueryString(q("?segment=82&sort=published&page=2&bogus=1"))).toBe("?segment=82&sort=published&page=2");
    expect(tenderQueryString(q("?province=QC&national=0&code=4321"))).toBe("?code=4321&province=QC&national=0");
    // Without a province the box changes nothing, so the address leaves it out.
    expect(tenderQueryString(q("?national=0"))).toBe("");
    expect(tenderQueryString(q(""))).toBe("");
  });

  it("matches any value of a key given several, and every key given", () => {
    const rows = openTenders as unknown as TenderRow[];
    const q = (s: string) => readTenderQuery(new URL(`https://x/tenders${s}`));
    const refs = (s: string) => filterTenders(rows, q(s), testClock).map((r) => r.reference);
    // Within a key, the union: 82 is cb-100's segment, 72 one of cb-200's.
    expect(refs("?segment=72&segment=82")).toEqual(["cb-100-10000001", "cb-200-20005019"]);
    expect(refs("?category=GD&category=SRV")).toEqual(["cb-100-10000001", "cb-200-20005019", "cb-300-30000003"]);
    expect(refs("?province=BC&province=ON&national=0")).toEqual(["cb-100-10000001", "cb-200-20005019"]);
    // Across keys, the intersection: cb-200 alone has 72 or 82 and BC; cb-300 names no province, so it stays unless national=0.
    expect(refs("?segment=72&segment=82&province=BC")).toEqual(["cb-200-20005019"]);
    expect(refs("?segment=43&segment=82&province=QC&province=BC")).toEqual(["cb-100-10000001", "cb-300-30000003"]);
    expect(refs("?segment=43&segment=82&province=QC&province=BC&national=0")).toEqual(["cb-100-10000001"]);
    // Each value once, in the fixed order (categories GD, SRV, CNST, SRVTGD; segments and provinces by code); values the filter cannot use dropped.
    const messy = q("?segment=82&province=qc&segment=43&province=BC&segment=82&segment=99&national=0&category=srv&category=GD&province=ZZ");
    expect(messy.category).toEqual(["GD", "SRV"]);
    expect(messy.segment).toEqual(["43", "82"]);
    expect(messy.province).toEqual(["BC", "QC"]);
    const written = tenderQueryString(messy);
    expect(written).toBe("?category=GD&category=SRV&segment=43&segment=82&province=BC&province=QC&national=0");
    // The address round-trips: read back, it is the same view and writes the same address.
    expect(q(written)).toEqual(messy);
    expect(tenderQueryString(q(written))).toBe(written);
  });

  it("renders a view with several values of a key: the union within it, a chip a value, the select saying how many", async () => {
    const html = await text("/tenders?segment=82&segment=43&province=QC&province=BC");
    expect(html).toContain("2 notices");
    expect(html).toContain(">cb-100-10000001<");
    expect(html).toContain(">cb-300-30000003<");
    expect(html).not.toContain(">cb-200-20005019<");
    // One chip a value, each linking to the view without that value alone.
    const chips = [...html.matchAll(/<a class="fchip" href="([^"]*)"[^>]*><span>([^<]*)<\/span> <b>([^<]*)<\/b>/g)].map((m) => [decode(m[1]), m[2], m[3]]);
    expect(chips).toEqual([
      ["/tenders?segment=82&province=BC&province=QC", "UNSPSC segment", "43 Information Technology Broadcasting and Telecommunications"],
      ["/tenders?segment=43&province=BC&province=QC", "UNSPSC segment", "82 Editorial and Design and Graphic and Fine Art Services"],
      ["/tenders?segment=43&segment=82&province=QC", "Province of delivery", "British Columbia"],
      ["/tenders?segment=43&segment=82&province=BC", "Province of delivery", "Quebec"],
    ]);
    expect(html).toContain('<summary class="btn" id="tender-fold">Filters (4 active)</summary>');
    // The select reads "Several (2)", and the values ride as hidden fields so the form keeps them without the script.
    expect(html).toContain('<select name="segment"><option value="" selected="" data-several="">Several (2)</option><option value="">All</option>');
    expect(html).toContain('<input type="hidden" name="segment" value="43" data-several=""/><input type="hidden" name="segment" value="82" data-several=""/>');
    expect(html).not.toMatch(/<option value="(43|82)" selected=""/);
    // A key with one value keeps the plain select.
    expect(await text("/tenders?segment=82")).toContain('<option value="82" selected="">');
    expect(nbsp(await text("/tenders?province=QC&province=ON&lang=fr"))).toContain('<option value="" selected="" data-several="">Plusieurs (2)</option>');
  });

  it("lists the notices first seen on a day, the newest by default and any of the last 30 on request", async () => {
    const html = await text("/tenders/new");
    expect(html).toContain("<h2>First Seen on 2026-10-31</h2>");
    expect(html).toContain("cb-200-20005019");
    expect(html).toContain('<a class="mono" href="/tenders/new?day=2026-10-30">2026-10-30</a>');
    expect(html).toContain('<a class="mono" href="/tenders/new?day=2026-10-02">2026-10-02</a>');
    expect(html).not.toContain("2026-10-01</a>");
    const older = await text("/tenders/new?day=2026-10-30");
    expect(older).toContain("<h2>First Seen on 2026-10-30</h2>");
    expect(older).toContain("No list is published for this day");
    // A day outside the window reads as the newest day.
    expect(await text("/tenders/new?day=2020-01-01")).toContain("<h2>First Seen on 2026-10-31</h2>");
  });
});

describe("award notices and contract history", () => {
  it("shows an award with its value by the counting rules, its method and its amendments", async () => {
    const html = await text("/awards/cb-400-40000004");
    expect(html).toContain('<a href="/organizations/org-a000000001">Exemplar Translation Services Inc.</a>');
    // The three figures agree, so one row gives the value and no rule is needed to pick among them.
    expect(html).toContain("<dt>Value</dt><dd>$250,000</dd>");
    expect(html).not.toContain("Value counted");
    // The lead: the supplier, the value and the end date, which the radar's window links when it is near.
    expect(html).toContain('<a href="/organizations/org-a000000001">Exemplar Translation Services Inc.</a> · $250,000 · ends 2029-09-30');
    // One version, the original: no amendments table.
    expect(html).not.toContain("<h2>Amendments</h2>");
    expect(html).toContain('<span class="flag flag-yes"');
    expect(html).toContain("Standing Offer");
    expect(html).toContain("Department of Fisheries and Oceans (DFO)");
  });

  it("shows a history record under its client department, with the source's limited tendering reason", async () => {
    const html = await text("/history/w8472-000633");
    expect(html).toContain("<dt>Contracting entity</dt>");
    expect(html).toContain('<dt>Client department</dt><dd><a href="/buyers/dfo-mpo">Fisheries and Oceans Canada</a></dd>');
    expect(html).toContain("Only one firm is capable of performing the contract");
    expect(html).toContain('<span class="flag flag-no"');
    expect(html).toContain("<dt>Value counted</dt><dd>$1,200,000</dd>");
    expect(html).toContain('href="https://open.canada.ca/data/en/dataset/4fe645a1-ffcd-40c1-9385-2c771be956a4"');
    expect(html).toContain("PW-25-00012345");
  });

  it("lists the newest awards and a year's awards, newest first, with the year links", async () => {
    const html = await text("/awards");
    expect(html.indexOf("cb-400-40000004")).toBeLessThan(html.indexOf("cb-500-50000005"));
    expect(html).toContain('<a class="mono" href="/awards/2012">2012</a>');
    expect(html).toContain('<span class="badge badge-cancelled">Cancelled</span>');
    const year = await text("/awards/2026");
    expect(year).toContain("3 award notices dated 2026.");
    expect(year).toContain('<a href="/downloads/awards-2026.csv" class="btn">Download award notices dated 2026 (CSV)</a>');
    expect(year).toContain('<span aria-current="page" class="mono">2026</span>');
    expect(year).toContain("cb-400-40000004");
    expect(year).not.toContain("cb-600-60000006");
    expect(year).toContain("Page 1 of 2");
    expect(year).toContain('<a href="/awards/2026?page=2" class="btn" rel="next">Next</a>');
    expect(year).toContain('<link rel="next" href="https://awardwatch.ca/awards/2026?page=2"/>');
    const second = await text("/awards/2026?page=2");
    expect(second).toContain("Interpretation services, regional consultations");
    expect(second).toContain("Unmatched Interpretation Co.");
    expect(second).not.toContain("cb-400-40000004");
    expect(second).toContain('<a href="/awards/2026" class="btn" rel="prev">Previous</a>');
    expect(second).toContain('<meta name="robots" content="noindex"/>');
    for (const path of ["/awards/2026?page=3", "/awards/2026?page=x", "/awards/2026?page=0"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain('<a href="/awards/2026">Back to the first page of the year</a>');
    }
    // A year with no award notice yet says so.
    const empty = testEnv(makeFakeAssets({}, { "awards/2026/index.json": { year: 2026, pages: 0, rows: 0 } }));
    const none = await get("/awards/2026", empty);
    expect(none.status).toBe(200);
    expect(await none.text()).toContain("No award notice to show.");
    // The index must name its own year and count at least one row per page.
    for (const bad of [{ year: 2025, pages: 1, rows: 3 }, { year: 2026, pages: 2, rows: 1 }, { year: 2026, pages: "2", rows: 3 }]) {
      expect((await get("/awards/2026", testEnv(makeFakeAssets({}, { "awards/2026/index.json": bad })))).status, JSON.stringify(bad)).toBe(503);
    }
  });
});

describe("buyers, segments and rankings", () => {
  it("lists every buyer with its counts per source, and one buyer's figures", async () => {
    const index = await text("/buyers");
    expect(index).toContain('<a href="/buyers/dnd-mdn">National Defence</a><span class="muted"> (DND)</span>');
    expect(index).toContain('<a href="/tenders?buyer=pwgsc-tpsgc">1</a>');
    const one = await text("/buyers/pwgsc-tpsgc");
    expect(one).toContain('<a href="/tenders?buyer=pwgsc-tpsgc" class="btn btn-primary">1 open notice</a>');
    expect(one).toContain("Largest Values: Award notices");
    expect(one).toContain('<a href="/organizations/org-a000000002">Sample Harbour Marine Ltd.</a>');
    expect(one).toContain('href="https://open.canada.ca/data/en/organization/pwgsc-tpsgc"');
  });

  it("lists the 57 segments and one segment's notices and organizations", async () => {
    const index = await text("/segments");
    expect(index.match(/<a href="\/segments\/\d\d">/g)?.length).toBe(57);
    expect(index).toContain('<a href="/tenders?segment=82">1</a>');
    const one = await text("/segments/82");
    expect(one).toContain("UNSPSC segment 82");
    // The lead counts the open notices and the data year's award notices; the soonest open notices
    // come first with the filtered list's button under them.
    expect(one).toMatch(/<p class="lead">1 open notice\. (No award notice in 2026 yet|\d+ award notices? worth [^<]+ in 2026)\.?<\/p>/);
    expect(one).toContain('<div class="panel-foot"><a href="/tenders?segment=82" class="btn btn-primary">Filter the open notices (1)</a></div>');
    expect(one).toContain("cb-100-10000001");
    // A year's list would hold every segment's notices: the year is not a link.
    expect(one).toContain('<td data-label="Year" class="mono">2024</td>');
    expect(one).not.toContain('<a href="/awards/2024">');
  });

  it("ranks one source at a time, by value or by count", async () => {
    const all = await text("/rankings");
    expect(all).toContain("<h2>Award notices: Largest Values</h2>");
    expect(all).toContain('<a class="mono" href="/rankings/2026">2026</a>');
    const count = await text("/rankings?source=awards&by=count");
    expect(count).toContain("<h2>Award notices: Most Records</h2>");
    expect(count).toContain("Sample Harbour Marine Ltd.");
    // Lobbying has no amounts, so it ranks by count whatever the link asks.
    const lobbying = await text("/rankings?source=lobbying&by=value");
    expect(lobbying).toContain("<h2>Lobbying communications: Most Records</h2>");
    expect(lobbying).not.toContain(">By value</a>");
    const year = await text("/rankings/2026");
    expect(year).not.toContain(">PSPC contract history</a>");
  });
});

describe("home", () => {
  it("shows the counts, today's notices, those closing soon, recent awards and the year's largest", async () => {
    const html = await text("/");
    // The tiles add what the rail beside them lacks; the rail keeps the open and the award notices' counts.
    expect(html).toContain('<a class="tile tile-soon" href="/tenders?closing=7"><span class="tile-label">Closing within 7 days</span><span class="tile-value" data-soon-count="">');
    expect(html).toContain('<a class="tile" href="/awards/2026"><span class="tile-label">Award notices in 2026</span><span class="tile-value">3</span>');
    expect(html).not.toContain('<span class="tile-label">Open tender notices</span>');
    // Records held: the standing totals the rail does not count.
    expect(html).toContain("<h2>Records Held</h2>");
    expect(html).not.toMatch(/<a href="\/organizations">Organizations<\/a><span class="kv-note">/);
    // An older export without the closing times, the year's count or the radar keeps the old tiles.
    const older = await text("/", testEnv(makeFakeAssets({}, {
      "stats.json": { ...stats, closing_soon_times: undefined, counts: { ...stats.counts, tenders_closing_soon: undefined } },
      "expiring/index.json": "{", "awards/2026/index.json": "{",
    })));
    expect(older).toContain('<span class="tile-label">Open tender notices</span><span class="tile-value">3</span>');
    expect(older).toContain('<span class="tile-label">Award notices</span><span class="tile-value">5,883</span>');
    expect(html).toContain("<h2>New Tender Notices Today</h2>");
    expect(html).toContain("<h2>Closing Within 7 Days</h2>");
    expect(html).toContain("<h2>Largest Award Values in 2026</h2>");
    expect(html).toContain('<a href="/rankings/2026">Full ranking</a>');
    expect(html).toContain("Exemplar Translation Services Inc.");
    expect(html).toContain("Each entry is a government record, linked to the notice or file it came from.");
  });
});

describe("no donations", () => {
  it("answers 404 for the old support page and the payment webhook", async () => {
    for (const path of ["/support", "/support?lang=fr"]) expect((await get(path)).status, path).toBe(404);
    const hook = await app.request("/hooks/kofi", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "data=%7B%7D",
    }, testEnv());
    expect(hook.status).toBe(404);
    // Neither the footer, the About page nor the Privacy page mentions donations.
    for (const path of ["/", "/about", "/privacy", "/terms", "/data", "/alerts"]) {
      expect(await text(path), path).not.toMatch(/donat|ko-fi|Support the site/i);
    }
  });
});
