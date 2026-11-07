import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Profile } from "../src/data";
import { app } from "../src/index";
import { DOWNLOADS } from "../src/pages/data";
import { scriptJson } from "../src/layout";
import { DESCRIPTION_MAX, SITE_ORIGIN, TITLE_MAX, breadcrumbJsonLd, organizationDescription, recordTitle } from "../src/seo";
import { emptyAssets, fakeAssets, testEnv } from "./assets";
import profileFixtures from "./fixtures/profiles-a00.json";
import sitemapPart from "./fixtures/sitemap-1.xml?raw";
import sitemapIndex from "./fixtures/sitemap-index.xml?raw";

const profiles = profileFixtures as unknown as Record<string, Profile>;
const get = (path: string, headers: Record<string, string> = {}) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", ...headers } }, testEnv());
const headOf = async (path: string, headers: Record<string, string> = {}) => {
  const html = await (await get(path, headers)).text();
  return html.slice(0, html.indexOf("</head>"));
};

// French text carries narrow and plain no-break spaces; compare with plain ones.
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const meta = (head: string, key: string) =>
  decode(head.match(new RegExp(`<meta (?:name|property)="${key.replace(/[:.]/g, "\\$&")}" content="([^"]*)"`))?.[1] ?? "");
const title = (head: string) => decode(head.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
const canonical = (head: string) => head.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
const alternates = (head: string) =>
  Object.fromEntries([...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
const jsonLd = (head: string): any[] =>
  [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

const O = "https://awardwatch.ca";
const PAGES: [string, string, string][] = [
  ["/", `${O}/`, "Award Watch: Federal Tenders, Awards and Contracts Ending"],
  ["/tenders", `${O}/tenders`, "Open Federal Tenders from CanadaBuys | Award Watch"],
  ["/tenders/new", `${O}/tenders/new`, "New Federal Tenders by Day | Award Watch"],
  ["/tenders/cb-100-10000001", `${O}/tenders/cb-100-10000001`, "Translation services for regional offices | Award Watch"],
  ["/awards", `${O}/awards`, "Federal Contract Awards: Who Won | Award Watch"],
  ["/awards/2026", `${O}/awards/2026`, "Award Notices in 2026 | Award Watch"],
  ["/awards/erroneous", `${O}/awards/erroneous`, "Erroneous Award Notice Submissions | Award Watch"],
  ["/awards/cb-400-40000004", `${O}/awards/cb-400-40000004`, "Translation standing offer, official languages | Award Watch"],
  ["/expiring", `${O}/expiring`, "Federal Contracts Ending Soon, with Incumbents | Award Watch"],
  ["/expiring/3m", `${O}/expiring/3m`, "Federal Contracts Ending Within 3 Months | Award Watch"],
  ["/history/w8472-000633", `${O}/history/w8472-000633`, "Vessel refit, mid-shore patrol | Award Watch"],
  ["/organizations", `${O}/organizations`, "Federal Suppliers and Grant Recipients | Award Watch"],
  ["/organizations/directory/on", `${O}/organizations/directory/on`, "Organizations A to Z: Ontario | Award Watch"],
  ["/organizations/org-a000000001", `${O}/organizations/org-a000000001`, "Exemplar Translation Services Inc.: Contracts and Grants"],
  ["/buyers", `${O}/buyers`, "Federal Buyers: Departments and Agencies | Award Watch"],
  ["/buyers/pwgsc-tpsgc", `${O}/buyers/pwgsc-tpsgc`, "Public Services and Procurement Canada | Award Watch"],
  ["/segments", `${O}/segments`, "Federal Tenders and Awards by UNSPSC Segment | Award Watch"],
  ["/segments/82", `${O}/segments/82`, "Editorial and Design and Graphic and Fine Art Services | Award Watch"],
  ["/rankings", `${O}/rankings`, "Top Federal Suppliers and Grant Recipients | Award Watch"],
  ["/rankings/2026", `${O}/rankings/2026`, "Rankings for 2026 | Award Watch"],
  ["/feeds", `${O}/feeds`, "Atom Feeds of New Federal Tenders | Award Watch"],
  ["/alerts", `${O}/alerts`, "Email Alerts for New Federal Tenders | Award Watch"],
  ["/watchlist", `${O}/watchlist`, "Watchlist | Award Watch"],
  ["/methodology", `${O}/methodology`, "Methodology: Sources, Identity and Counting | Award Watch"],
  ["/data", `${O}/data`, "Federal Procurement Data: CSV, API, Licence | Award Watch"],
  ["/cite", `${O}/cite`, "How to Cite | Award Watch"],
  ["/corrections?organization=org-a000000001", `${O}/corrections`, "Report a Correction | Award Watch"],
];

describe("page metadata", () => {
  it("every page has a title, a short description, a query-free canonical and language alternates", async () => {
    expect(SITE_ORIGIN).toBe(O);
    for (const [path, url, expected] of PAGES) {
      const head = await headOf(path);
      expect(title(head), path).toBe(expected);
      const description = meta(head, "description");
      expect(description.length, path).toBeGreaterThan(50);
      expect(description.length, path).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(canonical(head), path).toBe(url);
      expect(alternates(head), path).toEqual({ en: url, fr: `${url}?lang=fr`, "x-default": url });
      expect(meta(head, "og:site_name")).toBe("Award Watch");
      expect(meta(head, "og:url")).toBe(url);
      expect(meta(head, "og:description")).toBe(description);
      expect(meta(head, "twitter:description")).toBe(description);
      expect(head).not.toContain('name="robots"');
      expect(head, path).not.toContain("\u2014");
      // No social accounts until the operator opens one.
      expect(head, path).not.toContain("twitter:site");
    }
  });

  it("a French view names its own URL as canonical and speaks French", async () => {
    for (const headers of [{}, { cookie: "lang=fr" }] as Record<string, string>[]) {
      const path = Object.keys(headers).length ? "/organizations/org-a000000001" : "/organizations/org-a000000001?lang=fr";
      const head = await headOf(path, headers);
      expect(canonical(head)).toBe(`${O}/organizations/org-a000000001?lang=fr`);
      expect(meta(head, "og:locale")).toBe("fr_CA");
      expect(meta(head, "og:locale:alternate")).toBe("en_CA");
      expect(nbsp(meta(head, "description"))).toBe(
        "Exemplar Translation Services Inc., Ottawa, Ontario : 1 avis d’attribution, 101 contrats publiés et 1 communication de lobbying.",
      );
      expect(jsonLd(head)[0].itemListElement.map((i: any) => i.name)).toEqual(["Accueil", "Organisations", "Ontario", "Exemplar Translation Services Inc."]);
    }
    const home = await headOf("/?lang=fr");
    expect(nbsp(title(home))).toBe("Award Watch : appels d’offres et contrats fédéraux du Canada");
    expect(canonical(home)).toBe(`${O}/?lang=fr`);
    const data = await headOf("/data?lang=fr");
    expect(nbsp(title(data))).toBe("Données des marchés fédéraux : CSV et API | Award Watch");
    expect(jsonLd(data)[0].inLanguage).toBe("fr");
    expect(jsonLd(data)[0].license).toBe("https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada");
    const cite = await headOf("/cite?lang=fr");
    expect(title(cite)).toBe("Comment citer | Award Watch");
    expect(canonical(cite)).toBe(`${O}/cite?lang=fr`);
  });

  it("organization descriptions come from the organization's own counts and fit a result list", () => {
    const p = profiles["org-a000000001"];
    expect(organizationDescription(p, "en")).toBe(
      "Exemplar Translation Services Inc., Ottawa, Ontario: 1 award notice, 101 published contracts and 1 lobbying communication.",
    );
    const two = organizationDescription(profiles["org-a000000002"], "en");
    expect(two).toContain("1 award notice, 1 PSPC contract and 1 grant or contribution.");
    expect(two.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    const long = { ...p, organization: { ...p.organization, display_name: "A".repeat(200) } };
    for (const lang of ["en", "fr"] as const) expect(organizationDescription(long, lang).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    const none = { ...p, organization: { ...p.organization, n_awards: 0, n_contracts: 0, n_lobbying: 0 } };
    expect(organizationDescription(none, "en")).toContain(": no records with an amount.");
    // Records describe; the description judges nothing.
    for (const word of ["suspicious", "flag", "risk"]) expect(organizationDescription(p, "en").toLowerCase()).not.toContain(word);
  });

  it("title a profile and a buyer page by what they hold, dropping the site's name, then the words, to fit a result list", () => {
    expect(recordTitle("National Defence", "buyer", "en")).toBe("National Defence: Contracts and Tenders | Award Watch");
    // French runs longer: the site's name goes first.
    expect(recordTitle("Défense nationale", "buyer", "fr").replace(/[\u00a0\u202f]/g, " ")).toBe("Défense nationale : contrats et appels d’offres");
    expect(recordTitle("Pêches", "buyer", "fr").replace(/[\u00a0\u202f]/g, " ")).toBe("Pêches : contrats et appels d’offres | Award Watch");
    expect(recordTitle("Exemplar Works Ltd.", "organization", "en")).toBe("Exemplar Works Ltd.: Contracts and Grants | Award Watch");
    expect(recordTitle("Exemplar Translation Services Inc.", "organization", "en")).toBe("Exemplar Translation Services Inc.: Contracts and Grants");
    expect(recordTitle("Public Services and Procurement Canada", "buyer", "en")).toBe("Public Services and Procurement Canada | Award Watch");
    for (const lang of ["en", "fr"] as const) {
      for (const n of [1, 20, 37, 45]) expect(recordTitle("A".repeat(n), "buyer", lang).length).toBeLessThanOrEqual(TITLE_MAX);
    }
  });

  it("the home page names Allwater Software Inc. as publisher with the site's logo, never a person", async () => {
    const [graph] = jsonLd(await headOf("/"));
    const org = graph["@graph"].find((n: any) => n["@type"] === "Organization");
    expect(org.name).toBe("Allwater Software Inc.");
    expect(org.logo).toEqual({ "@type": "ImageObject", url: `${O}/brand/mark-512.png`, width: 512, height: 512 });
    expect(org.sameAs).toBeUndefined();
    const site = graph["@graph"].find((n: any) => n["@type"] === "WebSite");
    expect(site.name).toBe("Award Watch");
    expect(site.inLanguage).toEqual(["en-CA", "fr-CA"]);
    expect(site.publisher).toEqual({ "@id": `${O}/#organization` });
    expect(site.potentialAction.target.urlTemplate).toBe(`${O}/search?q={search_term_string}`);
  });

  it("the data page describes the downloads as an open Dataset, one part per downloadable set", async () => {
    const [dataset] = jsonLd(await headOf("/data"));
    expect(dataset["@type"]).toBe("Dataset");
    expect(dataset.license).toBe("https://open.canada.ca/en/open-government-licence-canada");
    expect(dataset.dateModified).toBe("2026-10-31");
    // The free files only: the paid 12-month radar file is left out; the checksums are no dataset.
    const files = dataset.hasPart.flatMap((p: any) => p.distribution.map((d: any) => d.name));
    // The alias map (listed) is ids, no records, and stays out of the record sets.
    for (const d of DOWNLOADS.filter((d) => !d.paid && !d.listed && d.file.endsWith(".csv"))) expect(files).toContain(d.file);
    // The alias map is a dataset part of its own (seo.ts DATA_SETS): ids and reasons, no record data.
    expect(files).toContain("organization-aliases.csv");
    expect(files).not.toContain("expiring-12m.csv");
    for (const part of dataset.hasPart) {
      expect(part.license).toBe(dataset.license);
      for (const d of part.distribution) expect(d.contentUrl).toBe(`${O}/downloads/${d.name}`);
    }
    expect(dataset.creator.name).toBe("Allwater Software Inc.");
  });

  it("breadcrumbs carry a URL on every crumb but the last", () => {
    const ld = breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Plain" }, { name: "Last", path: "/x" }]) as any;
    expect(ld.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${O}/` },
      { "@type": "ListItem", position: 2, name: "Last" },
    ]);
  });

  it("outbound record links are nofollow where they go to a search", async () => {
    const html = await (await get("/organizations/org-a000000001")).text();
    expect(html).toContain('<a href="https://search.open.canada.ca/contracts/?search_text=C-2026-000" class="mono wrap" rel="nofollow noopener">C-2026-000</a>');
    expect(html).toContain('href="https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/cmmLgPblcVw?comlogId=500001" class="mono" rel="nofollow noopener"');
  });

  it("the response form, filtered views and later pages stay out of the index; error pages carry only the site description", async () => {
    for (const path of [
      "/organizations/org-a000000001/respond", "/tenders?segment=82", "/tenders/new?day=2026-10-30", "/awards?page=2",
      "/rankings?source=contracts", "/rankings/2026?by=count", "/expiring/3m?buyer=dnd-mdn", "/expiring/3m?page=1",
      "/expiring/3m?lang=fr&kind=award",
    ]) {
      expect(await headOf(path), path).toContain('<meta name="robots" content="noindex"/>');
    }
    const missing = await headOf("/nothing-here");
    expect(missing).not.toContain('rel="canonical"');
    expect(meta(missing, "description")).toContain("Canadian federal tenders from CanadaBuys");
  });

  it("JSON-LD text cannot close its script element", () => {
    const text = scriptJson({ name: "A </script><b> & B\u2028" });
    expect(text).not.toMatch(/[<>&\u2028]/);
    expect(JSON.parse(text)).toEqual({ name: "A </script><b> & B\u2028" });
  });
});

// Whether a group's rules let a crawler fetch a path, as Google and Bing read
// them: the longest matching pattern wins, Allow on a tie; "*" matches any
// run of characters and a final "$" anchors the end. With no match, allowed.
function robotsAllow(rules: string[], path: string): boolean {
  let best = { length: -1, allow: true };
  for (const rule of rules) {
    const m = /^(Allow|Disallow):\s*(\S*)$/.exec(rule);
    if (!m || m[2] === "") continue;
    const pattern = m[2];
    const anchored = pattern.endsWith("$");
    const parts = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!new RegExp(`^${parts.join(".*")}${anchored ? "$" : ""}`).test(path)) continue;
    const allow = m[1] === "Allow";
    if (pattern.length > best.length || (pattern.length === best.length && allow)) best = { length: pattern.length, allow };
  }
  return best.allow;
}

describe("crawler files", () => {
  it("/sitemap.xml is the index and each part comes from data/sitemaps, in both languages", async () => {
    // Without the records database the index is the pipeline's file as written.
    const index = await app.request("/sitemap.xml", {}, { ...testEnv(), RECORDS: undefined });
    expect(index.status).toBe(200);
    expect(index.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(await index.text()).toBe(sitemapIndex);
    const part = await get("/sitemap-1.xml");
    expect(part.status).toBe(200);
    // Each page of the part twice, English then French (test/seo-intent.test.ts reads the alternates).
    const listed = [...sitemapPart.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    const served = [...(await part.text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(served).toEqual(listed.flatMap((u) => [u, `${u}?lang=fr`]));
    expect((await get("/sitemap-2.xml")).status).toBe(404);
    expect((await get("/sitemap-x.xml")).status).toBe(404);
    const none = await app.request("/sitemap.xml", {}, testEnv(emptyAssets));
    expect(none.status).toBe(404);
  });

  it("/llms.txt points crawlers at the bulk files, and every profile names them in a Link header", async () => {
    const res = await app.request("/llms.txt", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const text = await res.text();
    expect(text).toContain(`${O}/downloads/organizations.csv`);
    expect(text).toContain(`${O}/downloads/expiring-12m.csv`);
    expect(text).toContain(`${O}/methodology`);
    expect(text).not.toContain("\u2014");
    const profile = await app.request("/organizations/org-a000000001", {}, testEnv(fakeAssets));
    expect(profile.status).toBe(200);
    expect(profile.headers.get("link")).toContain('</downloads/organizations.csv>; rel="alternate"; type="text/csv"');
    expect(profile.headers.get("link")).toContain('</llms.txt>; rel="help"');
    const robots = await (await app.request("/robots.txt", {}, env)).text();
    expect(robots).not.toContain("Disallow: /downloads/");
    expect(robots).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=no");
  });

  it("/robots.txt is the file in public/, open to all with the sitemap named", async () => {
    // The real assets binding, which serves site/public.
    const res = await app.request("/robots.txt", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    const text = await res.text();
    const rules = text.split("\n").filter((l) => l && !l.startsWith("#"));
    const crawl = rules.indexOf("Crawl-delay: 5");
    expect(rules.slice(0, 6)).toEqual([
      "User-agent: *",
      "Content-Signal: search=yes, ai-input=yes, ai-train=no",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /organizations/*/respond",
      "Disallow: /search",
    ]);
    // Bing obeys Crawl-delay, so its own group carries the same rules without one.
    const bing = rules.indexOf("User-agent: bingbot");
    expect(bing).toBeGreaterThan(crawl);
    const everyone = rules.slice(0, crawl);
    const bingRules = rules.slice(bing, rules.indexOf("User-agent: ShapBot"));
    expect(bingRules.slice(1)).toEqual(everyone.slice(2));
    const open = [
      "/", "/tenders", "/tenders?lang=fr", "/tenders/new", "/tenders/new?lang=fr", "/tenders/cb-100-10000001",
      "/organizations", "/organizations/org-a000000001", "/organizations/org-a000000001?lang=fr", "/organizations/directory/on/2",
      "/buyers/dnd-mdn", "/segments/82", "/rankings", "/rankings?lang=fr", "/rankings/2026", "/corrections", "/corrections?lang=fr",
      "/downloads/organizations.csv",
    ];
    const shut = [
      "/tenders?segment=82", "/tenders?lang=fr&segment=82", "/tenders/new?day=2026-10-30", "/rankings?source=contracts",
      "/organizations/org-a000000001/respond", "/api/stats", "/corrections?organization=org-a000000001",
    ];
    for (const group of [everyone, bingRules]) {
      for (const path of open) expect(robotsAllow(group, path), path).toBe(true);
      for (const path of shut) expect(robotsAllow(group, path), path).toBe(false);
    }
    // Training and bulk-scraping crawlers are kept off the Worker entirely.
    const aiGroup = rules.slice(rules.indexOf("User-agent: ShapBot"), rules.indexOf("Disallow: /") + 1);
    for (const bot of ["ClaudeBot", "GPTBot", "Google-Extended", "CCBot", "Bytespider"]) expect(aiGroup).toContain(`User-agent: ${bot}`);
    expect(rules[rules.length - 1]).toBe(`Sitemap: ${O}/sitemap.xml`);
    expect(text).not.toContain("\u2014");
  });
});
