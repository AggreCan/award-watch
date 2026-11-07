// The rail's Analytics item and the index of the analytics views it opens
// (src/pages/analytics_index.tsx, docs/analytics.md "The index").
//
// Switch off: the address is the site's 404 and the rail has no item, as
// for the views. Switch on: the item sits in the rail's Browse group with
// the Pro chip in the count's slot for every reader, in both languages; the
// index lists the buyers with a record, the 57 segments and the year's
// largest organizations for every reader, one gate note for a reader whose
// plan lacks the views and none for a Pro reader, and a signed-in account's
// own organization once it has named one. The search box goes straight to a
// view it names or to the one view a query matches, else lists the matches;
// a missing file or search database leaves a plain line, never an error.
// Nothing here reads the records database.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { SEGMENT_CODES } from "../src/constants";
import type { BuyerSummary } from "../src/data";
import { app } from "../src/index";
import {
  ORG_MATCHES_SHOWN, addressedView, buyerHasRecords, matchBuyers, matchSegments,
} from "../src/pages/analytics_index";
import { PRO_GLYPH_PATH, SUBSCRIBE_PATH } from "../src/pro";
import { foldText, searchTerms } from "../src/search_db";
import { routeTemplate } from "../src/views";
import { ACCOUNTS, decode, get, grantPro, nbsp, newEmail, onEnv, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import { applySql } from "./setup";

useAccountsDb();

const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const SEARCH_SCHEMA = (env as unknown as { SEARCH_SCHEMA_SQL: string }).SEARCH_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);

const CHIP_EN = `<span class="pro-tag"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="${PRO_GLYPH_PATH}"></path></svg>Pro<span class="visually-hidden"> (paid plan)</span></span>`;
const CHIP_FR = CHIP_EN.replace("(paid plan)", "(forfait payant)");
const chips = (html: string) => (html.match(/<span class="pro-tag">/g) ?? []).length;
const railOf = (html: string) => /<nav class="rail"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
const browseOf = (html: string) => /<div class="rail-group rail-browse">[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
const mainOf = (html: string) => /<main id="main">[\s\S]*?<\/main>/.exec(html)?.[0] ?? "";
const headOf = (html: string) => html.slice(0, html.indexOf("</head>"));
const page = async (path: string, o: { env?: object; cookie?: string } = {}) => nbsp(decode(await (await get(path, o)).text()));
const panelOf = (html: string, title: string) =>
  new RegExp(`<section class="panel"><div class="panel-head"><h2>${title}</h2>[\\s\\S]*?</section>`).exec(html)?.[0] ?? "";

// A records binding that records any use: nothing on these pages may read it.
function recordsTrap() {
  const used: string[] = [];
  const binding = new Proxy({}, { get: (_t, prop) => { used.push(String(prop)); throw new Error("the records database was read"); } });
  return { used, binding: binding as D1Database };
}

// The hosted search database, as the nightly sync fills it (test/search.test.ts):
// two organizations named Exemplar, and thirty more "Filler Holdings" than the
// list shows.
const ORGS = [
  { id: "org-a000000001", name: "Exemplar Translation Services Inc.", records: 12 },
  { id: "org-a000000006", name: "Exemplar Labs", records: 30 },
  ...Array.from({ length: ORG_MATCHES_SHOWN + 5 }, (_, i) => ({ id: `org-b${String(i).padStart(9, "0")}`, name: `Filler Holdings ${String(i).padStart(3, "0")}`, records: 40 - i })),
];

async function seedSearch(): Promise<void> {
  await applySql(SEARCH, SEARCH_SCHEMA);
  await SEARCH.batch([SEARCH.prepare("DELETE FROM search_orgs"), SEARCH.prepare("DELETE FROM search_buyers")]);
  const sql = "INSERT INTO search_orgs (id, name, alt, bn, folds, prov, city, n_awards, n_history, n_contracts, n_grants, " +
    "n_lobbying, n_records, total_awards, total_history, total_contracts, total_grants, hash) " +
    "VALUES (?, ?, '', '', ?, 'ON', NULL, ?, 0, 0, 0, 0, ?, NULL, NULL, NULL, NULL, 'h')";
  await SEARCH.batch(ORGS.map((o) => SEARCH.prepare(sql).bind(o.id, o.name, foldText(o.name), o.records, o.records)));
}

beforeAll(seedSearch);

let freeCookie = "";
let proCookie = "";
let freeEmail = "";
let proEmail = "";
async function sessions(): Promise<void> {
  if (proCookie) return;
  freeEmail = newEmail("index-free");
  freeCookie = await signIn(freeEmail);
  proEmail = newEmail("index-pro");
  proCookie = await signIn(proEmail);
  await grantPro(proEmail);
}
const READERS = () => [["no session", undefined], ["free", freeCookie], ["pro", proCookie]] as const;

async function claim(email: string, organization: string): Promise<void> {
  const at = new Date().toISOString();
  await ACCOUNTS.prepare(
    "INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?1, ?2, NULL, '[]', ?3, ?3) " +
    "ON CONFLICT (user_id) DO UPDATE SET organization_id = excluded.organization_id, updated_at = excluded.updated_at",
  ).bind(await userId(email), organization, at).run();
}

// -- the switch off -----------------------------------------------------------------------

describe("with the switch off", () => {
  it("answers the index with the site's 404 and leaves the rail without the item, in both languages", async () => {
    const off = testEnv();
    const notFound = await (await get("/nothing-here", { env: off })).text();
    for (const path of ["/analytics", "/analytics?lang=fr", "/analytics?q=org-a000000001", "/analytics?q=canada"]) {
      const res = await get(path, { env: off });
      expect(res.status, path).toBe(404);
      expect(res.headers.get("location"), path).toBeNull();
      if (!path.includes("lang=fr")) expect(await res.text(), path).toBe(notFound);
    }
    for (const path of ["/", "/?lang=fr", "/rankings", "/buyers/pwgsc-tpsgc"]) {
      const html = await (await get(path, { env: off })).text();
      expect(railOf(html), path).not.toContain('href="/analytics"');
      expect(html, path).not.toContain("/analytics");
    }
  });
});

// -- the rail ------------------------------------------------------------------------------

describe("the rail's Analytics item", () => {
  it("sits in the Browse group after Rankings with the chip in the count's slot, for every reader, in both languages", async () => {
    await sessions();
    for (const [who, cookie] of READERS()) {
      for (const lang of ["en", "fr"] as const) {
        const browse = browseOf(await page(`/tenders?lang=${lang}`, { cookie }));
        const item = lang === "en"
          ? `<li><a class="rail-item" href="/analytics"><span class="rail-label">Analytics</span>${CHIP_EN}</a></li>`
          : `<li><a class="rail-item" href="/analytics"><span class="rail-label">Analyses</span>${CHIP_FR}</a></li>`;
        expect(browse, `${who} ${lang}`).toContain(item);
        const hrefs = [...browse.matchAll(/<a class="rail-item[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
        expect(hrefs, `${who} ${lang}`).toEqual(["/segments", "/rankings", "/analytics", "/feeds", "/alerts", "/data", "/methodology"]);
        // No word space beside the chip: its own margins make the gap.
        expect(browse, `${who} ${lang}`).not.toMatch(/[\s ]<span class="pro-tag">/);
      }
    }
  });

  it("has a footer link after Rankings, with no chip, where a phone hides the Browse group", async () => {
    const footerOf = (html: string) => /<span class="footer-links">[\s\S]*?<\/span>/.exec(html)?.[0] ?? "";
    for (const [lang, word] of [["en", "Analytics"], ["fr", "Analyses"]]) {
      const footer = footerOf(await page(`/?lang=${lang}`));
      expect(footer, lang).toMatch(new RegExp(`<a href="/rankings">[^<]+</a><a href="/analytics">${word}</a>`));
      expect(chips(footer), lang).toBe(0);
    }
    expect(footerOf(await page("/", { env: testEnv() }))).not.toContain("/analytics");
  });

  it("marks itself as the page on the index, and no other item", async () => {
    for (const path of ["/analytics", "/analytics?q=canada"]) {
      const rail = railOf(await page(path));
      expect(rail, path).toContain('<a class="rail-item" href="/analytics" aria-current="page">');
      expect((rail.match(/aria-current="page"/g) ?? []).length, path).toBe(1);
    }
  });
});

// -- the index -----------------------------------------------------------------------------

describe("the index for a reader without a session", () => {
  it("lists the buyers with a record, the year's largest organizations and the 57 segments, each linked to its view", async () => {
    const records = recordsTrap();
    const res = await get("/analytics", { env: onEnv({ RECORDS: records.binding }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("vary")).toContain("Cookie");
    const html = nbsp(decode(await res.text()));
    expect(html).toContain("<h1>Analytics</h1>");
    // Buyers in name order; National Defence has no record in the four sources, so no view to list.
    const buyers = panelOf(html, "Buyers");
    expect([...buyers.matchAll(/<a href="([^"]+)" rel="nofollow">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]])).toEqual([
      ["/buyers/dfo-mpo/analytics", "Fisheries and Oceans Canada"],
      ["/buyers/pwgsc-tpsgc/analytics", "Public Services and Procurement Canada"],
    ]);
    expect(buyers).toContain('<span class="panel-count">2</span>');
    expect(buyers).toContain('<span class="muted">PSPC</span>');
    expect(buyers).not.toContain("dnd-mdn");
    // Organizations: the way to the rest, and the data year's largest from stats.json.
    const orgs = panelOf(html, "Organizations");
    expect(orgs).toContain('Each organization\'s profile links its view. Find one by name above, or in the <a href="/organizations">directory</a>.');
    expect(orgs).toContain("Largest award notice values in 2026:");
    expect(orgs).toContain('<a href="/organizations/org-a000000001/analytics" rel="nofollow">Exemplar Translation Services Inc.</a>');
    // Every segment, in code order.
    const segments = panelOf(html, "Segments");
    expect([...segments.matchAll(/href="\/segments\/([0-9]{2})\/analytics"/g)].map((m) => m[1])).toEqual([...SEGMENT_CODES]);
    expect(segments).toContain('<span class="mono">82</span> <a href="/segments/82/analytics" rel="nofollow">Editorial and Design and Graphic and Fine Art Services</a>');
    // The search box, a GET to this page.
    expect(html).toContain('<form method="get" action="/analytics" class="toolbar" role="search">');
    expect(html).toContain('<span class="field-label">Find a buyer, an organization or a segment</span><input type="search" name="q" value=""');
    // One gate note, the only chip in the page's body, with the way to Pro and the two figures.
    const main = mainOf(html);
    expect(chips(main)).toBe(1);
    expect(main.match(/<p class="pro-note">/g)).toHaveLength(1);
    expect(main).toContain(`<p class="pro-note">${CHIP_EN}Each view's first chart is free for the latest 3 fiscal years; Pro shows every chart for up to 10. <a href="${SUBSCRIBE_PATH}">Subscribe to Pro</a></p>`);
    expect(main).not.toContain('href="/pro"');
    expect(main).not.toContain("Your Organization");
    // A section page for search engines.
    const head = headOf(html);
    expect(head).toContain('<link rel="canonical" href="https://awardwatch.ca/analytics"/>');
    expect(head).not.toContain('name="robots"');
    expect(head).toContain("<title>Analytics by Buyer, Organization and Segment | Award Watch</title>");
    expect(html).not.toContain(EM_DASH);
    expect(records.used).toEqual([]);
  });

  it("reads in French on the French page", async () => {
    const html = await page("/analytics?lang=fr");
    expect(html).toContain("<h1>Analyses</h1>");
    expect(html).toContain("<span class=\"field-label\">Trouver un acheteur, une organisation ou un segment</span>");
    expect(html).toContain('<button type="submit" class="btn btn-primary">Trouver</button>');
    expect(html).toContain(`<p class="pro-note">${CHIP_FR}Le premier graphique de chaque vue est gratuit sur les 3 derniers exercices; Pro les montre tous sur 10. <a href="${SUBSCRIBE_PATH}">S’abonner à Pro</a></p>`);
    const buyers = panelOf(html, "Acheteurs");
    expect([...buyers.matchAll(/rel="nofollow">([^<]+)<\/a>/g)].map((m) => m[1])).toEqual([
      "Pêches et Océans Canada", "Services publics et Approvisionnement Canada",
    ]);
    expect(buyers).toContain('<span class="muted">SPAC</span>');
    expect(panelOf(html, "Organisations")).toContain("Valeurs d’avis d’attribution les plus élevées en 2026 :");
    expect(panelOf(html, "Segments")).toContain("Services de rédaction, de design, de graphisme et de beaux-arts");
    expect(headOf(html)).toContain('<link rel="canonical" href="https://awardwatch.ca/analytics?lang=fr"/>');
    expect(html).not.toContain(EM_DASH);
    for (const english of ["Find a buyer", "Each view's first chart", "Largest award notice", "Subscribe to Pro"]) expect(html).not.toContain(english);
  });
});

describe("the index for an account", () => {
  it("gives a Free account the same lists and the one gate note, privately, and its own organization once it names one", async () => {
    await sessions();
    const res = await get("/analytics", { cookie: freeCookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const before = nbsp(decode(await res.text()));
    expect(chips(mainOf(before))).toBe(1);
    expect(before).toContain(`<a href="${SUBSCRIBE_PATH}">Subscribe to Pro</a>`);
    expect(before).not.toContain("Your Organization");
    await claim(freeEmail, "org-a000000001");
    const after = await page("/analytics", { cookie: freeCookie });
    const own = panelOf(after, "Your Organization");
    expect(own).toContain('<a href="/organizations/org-a000000001/analytics" rel="nofollow">Exemplar Translation Services Inc.</a>');
    expect(own).toContain('<a href="/account/organization">Its page in your account</a>');
    expect(chips(mainOf(after))).toBe(1);
    // Before the buyers, and nowhere for a reader without a session.
    expect(after.indexOf("Your Organization")).toBeLessThan(after.indexOf("<h2>Buyers</h2>"));
    expect(await page("/analytics")).not.toContain("Your Organization");
  });

  it("gives a Pro account no gate note and no chip in the page's body, with its own organization in both languages", async () => {
    await sessions();
    const plain = await page("/analytics", { cookie: proCookie });
    expect(chips(mainOf(plain))).toBe(0);
    expect(plain).not.toContain("pro-note");
    expect(plain).not.toContain("Subscribe to Pro");
    expect(panelOf(plain, "Buyers")).toContain("/buyers/pwgsc-tpsgc/analytics");
    await claim(proEmail, "org-a000000001");
    const en = await page("/analytics", { cookie: proCookie });
    expect(panelOf(en, "Your Organization")).toContain("/organizations/org-a000000001/analytics");
    const fr = await page("/analytics?lang=fr", { cookie: proCookie });
    expect(panelOf(fr, "Votre organisation")).toContain('<a href="/account/organization">Sa page dans votre compte</a>');
    expect(chips(mainOf(fr))).toBe(0);
    expect(fr).not.toContain(EM_DASH);
  });
});

// -- the search box -----------------------------------------------------------------------

describe("the search box", () => {
  const location = async (q: string, e: object = onEnv()) => {
    const res = await get(`/analytics?q=${encodeURIComponent(q)}`, { env: e });
    return { status: res.status, location: res.headers.get("location"), cache: res.headers.get("cache-control") };
  };

  it("goes straight to the view an id, an address or a segment code names", async () => {
    const cases: [string, string][] = [
      ["org-a000000001", "/organizations/org-a000000001/analytics"],
      [" ORG-A000000006 ", "/organizations/org-a000000006/analytics"],
      ["https://awardwatch.ca/organizations/org-a000000001?lang=fr", "/organizations/org-a000000001/analytics"],
      ["82", "/segments/82/analytics"],
      ["https://awardwatch.ca/segments/43", "/segments/43/analytics"],
      ["/segments/82/analytics?source=history", "/segments/82/analytics"],
      ["dnd-mdn", "/buyers/dnd-mdn/analytics"],
      ["https://awardwatch.ca/buyers/dfo-mpo", "/buyers/dfo-mpo/analytics"],
      ["/buyers/pwgsc-tpsgc/records", "/buyers/pwgsc-tpsgc/analytics"],
    ];
    for (const [q, to] of cases) expect(await location(q), q).toEqual({ status: 302, location: to, cache: "public, max-age=300" });
  });

  it("goes straight to the one view a query matches, a buyer, an organization or a segment", async () => {
    expect((await location("Fisheries")).location).toBe("/buyers/dfo-mpo/analytics");
    expect((await location("Pêches")).location).toBe("/buyers/dfo-mpo/analytics");
    expect((await location("SPAC")).location).toBe("/buyers/pwgsc-tpsgc/analytics");
    expect((await location("exemplar labs")).location).toBe("/organizations/org-a000000006/analytics");
    expect((await location("editorial design")).location).toBe("/segments/82/analytics");
  });

  it("lists the matches when there are several, noindex, with the query in the box", async () => {
    const res = await get("/analytics?q=canada");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const html = nbsp(decode(await res.text()));
    expect(headOf(html)).toContain('<meta name="robots" content="noindex"/>');
    expect(headOf(html)).toContain("<title>Analytics: canada | Award Watch</title>");
    expect(html).toContain('<input type="search" name="q" value="canada"');
    expect(html).toContain('<a href="/analytics" class="btn">All views</a>');
    expect([...panelOf(html, "Buyers").matchAll(/<a href="([^"]+)" rel="nofollow">/g)].map((m) => m[1])).toEqual([
      "/buyers/dfo-mpo/analytics", "/buyers/pwgsc-tpsgc/analytics",
    ]);
    expect(html).not.toContain("<h2>Segments</h2>");
    expect(html).not.toContain("<h2>Organizations</h2>");
    expect(chips(mainOf(html))).toBe(1);
    // Two organizations named Exemplar, ranked as the search page ranks them.
    const two = await page("/analytics?q=exemplar");
    expect([...panelOf(two, "Organizations").matchAll(/<a href="([^"]+)" rel="nofollow">/g)].map((m) => m[1])).toEqual([
      "/organizations/org-a000000006/analytics", "/organizations/org-a000000001/analytics",
    ]);
  });

  it("shows the first organizations and links the search page for the rest", async () => {
    const html = await page("/analytics?q=filler");
    const orgs = panelOf(html, "Organizations");
    expect((orgs.match(/rel="nofollow"/g) ?? []).length).toBe(ORG_MATCHES_SHOWN);
    expect(orgs).toContain(`<span class="panel-count">${ORG_MATCHES_SHOWN + 5}</span>`);
    expect(orgs).toContain(`The first ${ORG_MATCHES_SHOWN} of ${ORG_MATCHES_SHOWN + 5}; the <a href="/search?q=filler">search page</a> lists them all.`);
  });

  it("says when nothing matches, and when a query has no letter or digit", async () => {
    const none = await page("/analytics?q=zzqx");
    expect(none).toContain('<p class="page-note">No buyer, organization or segment matches “zzqx”.</p>');
    expect(none).not.toContain("<h2>Buyers</h2>");
    const fr = await page("/analytics?q=zzqx&lang=fr");
    expect(fr).toContain("Aucun acheteur, aucune organisation et aucun segment ne correspond à « zzqx ».");
    const marks = await page("/analytics?q=%21%21%21");
    expect(marks).toContain('<p class="page-note">A search needs at least one letter or digit.</p>');
    expect(marks).not.toContain("No buyer, organization or segment matches");
    // A query is echoed as text, never as markup.
    const tag = await (await get(`/analytics?q=${encodeURIComponent("<b>zzqx</b>")}`)).text();
    expect(tag).not.toContain("<b>zzqx</b>");
  });

  it("lists buyers and segments without the search database, says organizations cannot be searched, and keeps nothing", async () => {
    const e = onEnv({ SEARCH: undefined });
    const res = await get("/analytics?q=fisheries", { env: e });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = nbsp(decode(await res.text()));
    // One buyer matches, but the organizations were not read: no shortcut.
    expect(panelOf(html, "Buyers")).toContain("/buyers/dfo-mpo/analytics");
    expect(panelOf(html, "Organizations")).toContain(
      'Organization search is not available right now; the <a href="/organizations">directory</a> lists every organization.');
    // An address still goes straight to its view.
    expect((await location("org-a000000001", e)).location).toBe("/organizations/org-a000000001/analytics");
  });
});

// -- missing files --------------------------------------------------------------------------

describe("when a file is missing", () => {
  const without = (...paths: string[]) => onEnv({ ASSETS: makeFakeAssets({}, Object.fromEntries(paths.map((p) => [p, undefined]))) });

  it("lists what it can with a plain line for the rest, never an error", async () => {
    const noBuyers = await get("/analytics", { env: without("buyers/index.json") });
    expect(noBuyers.status).toBe(200);
    const a = nbsp(decode(await noBuyers.text()));
    expect(panelOf(a, "Buyers")).toContain('<p class="muted">The list of buyers is not available right now.</p>');
    expect([...panelOf(a, "Segments").matchAll(/\/analytics"/g)]).toHaveLength(SEGMENT_CODES.length);
    expect(panelOf(a, "Organizations")).toContain("Largest award notice values in 2026:");

    const noStats = await get("/analytics", { env: without("stats.json") });
    expect(noStats.status).toBe(200);
    const b = nbsp(decode(await noStats.text()));
    expect(panelOf(b, "Organizations")).not.toContain("Largest");
    expect(panelOf(b, "Buyers")).toContain("/buyers/dfo-mpo/analytics");

    const neither = await get("/analytics?lang=fr", { env: without("stats.json", "buyers/index.json") });
    expect(neither.status).toBe(200);
    const c = nbsp(decode(await neither.text()));
    expect(c).toContain("La liste des acheteurs n’est pas disponible pour le moment.");
    expect(c).not.toContain(EM_DASH);

    // A bare buyer id cannot be checked without the list: the matches page, with the line.
    const query = await get("/analytics?q=dnd-mdn", { env: without("buyers/index.json") });
    expect(query.status).toBe(200);
    expect(panelOf(nbsp(decode(await query.text())), "Buyers")).toContain("The list of buyers is not available right now.");
  });
});

// -- the pieces ------------------------------------------------------------------------------

describe("the pieces", () => {
  const buyers = (FILES["buyers/index.json"] as { buyers: BuyerSummary[] }).buyers;

  it("read an address, an id or a code, and nothing else, as a view", () => {
    const ids = new Set(buyers.map((b) => b.id));
    expect(addressedView("health", ids)).toBeNull();
    expect(addressedView("99", ids)).toBeNull();
    expect(addressedView("8", ids)).toBeNull();
    expect(addressedView("org-a00000000", ids)).toBeNull();
    expect(addressedView("", ids)).toBeNull();
    expect(addressedView("dfo-mpo", ids)).toBe("/buyers/dfo-mpo/analytics");
    expect(addressedView("dfo-mpo", new Set())).toBeNull();
    expect(addressedView("https://awardwatch.ca/buyers/Not A Buyer", ids)).toBeNull();
  });

  it("match every word, the last as a prefix, in either language, and list a buyer only with a record", () => {
    expect(matchBuyers(buyers, searchTerms("oceans can")).map((b) => b.id)).toEqual(["dfo-mpo"]);
    expect(matchBuyers(buyers, searchTerms("défense")).map((b) => b.id)).toEqual(["dnd-mdn"]);
    expect(matchBuyers(buyers, searchTerms("")).map((b) => b.id)).toEqual([]);
    expect(buyers.filter(buyerHasRecords).map((b) => b.id)).toEqual(["pwgsc-tpsgc", "dfo-mpo"]);
    expect(matchSegments(searchTerms("editorial"))).toEqual(["82"]);
    expect(matchSegments(searchTerms("rédaction"))).toEqual(["82"]);
    expect(matchSegments(searchTerms("43"))).toEqual(["43"]);
  });

  it("count the index as a page of its own, and keep crawlers off its queries", async () => {
    expect(routeTemplate("GET", "/analytics")).toEqual({ route: "/analytics", kind: "page" });
    const robots = await (await app.request("/robots.txt", {}, env)).text();
    for (const rule of ["Disallow: /analytics?\n", "Allow: /analytics?lang=fr$\n"]) expect(robots.split(rule).length - 1, rule).toBe(2);
    expect(robots).not.toMatch(/^Disallow: \/analytics$/m);
  });
});
