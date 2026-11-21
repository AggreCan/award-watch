// The sitemap index and its named parts (src/sitemaps.ts), from files shaped
// exactly as the export writes them (fixtures/sitemaps/: the pipeline's
// test_sitemaps.py writes them again from their entries and compares the
// bytes): the parts in the order a search engine should read them, the guides'
// part among the site's own pages, nothing for the organizations with nothing
// recent or for the published contracts (neither listed nor served since
// 2026-11-21) and nothing read from the records database, every page in both
// languages with the alternates its own head names, and the addresses an
// older export or a search engine still holds.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import {
  CONTRACT_SITEMAPS_LISTED, CONTRACT_SITEMAPS_SERVED, GUIDES_SITEMAP, PIPELINE_PARTS, sitemapAsset, sitemapIndex as servedIndex, withGuidesPart,
  withServedParts,
} from "../src/sitemaps";
import type { Env } from "../src/env";
import { guidesChecked } from "../src/guides";
import { makeFakeAssets, testEnv } from "./assets";
import namedIndex from "./fixtures/sitemaps/index.xml?raw";
import openTenders from "./fixtures/sitemaps/sitemap-open-tenders-1.xml?raw";
import sitePages from "./fixtures/sitemaps/sitemap-pages-1.xml?raw";
import activeOrganizations from "./fixtures/sitemaps/sitemap-active-organizations-1.xml?raw";
import oldIndex from "./fixtures/sitemap-index.xml?raw";
import exportStatic from "../../pipeline/awardwatch_pipeline/export_static.py?raw";

const O = "https://awardwatch.ca";
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

const NAMED: Record<string, string> = {
  "sitemaps/index.xml": namedIndex,
  "sitemaps/sitemap-open-tenders-1.xml": openTenders,
  "sitemaps/sitemap-pages-1.xml": sitePages,
  "sitemaps/sitemap-active-organizations-1.xml": activeOrganizations,
};

// An export written the night before the organizations with nothing recent lost their part: its index still
// names the part, and its file is still on the site.
const RETIRED = "sitemap-other-organizations-1.xml";
const RETIRED_ENTRY = `<sitemap><loc>${O}/${RETIRED}</loc><lastmod>2026-10-12</lastmod></sitemap>\n`;
const earlierIndex = namedIndex.replace("</sitemapindex>", `${RETIRED_ENTRY}</sitemapindex>`);
const EARLIER: Record<string, string> = {
  ...NAMED,
  "sitemaps/index.xml": earlierIndex,
  [`sitemaps/${RETIRED}`]: activeOrganizations.replace("org-a000000001", "org-a000000002"),
};

// The shared fixtures (test/assets.ts) with the export's sitemaps in their named form. The shared fake serves
// its own sitemap files before any override, so these are answered here first.
function namedAssets(files: Record<string, string> = NAMED): Fetcher {
  const rest = makeFakeAssets();
  return {
    fetch: async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname.replace(/^\/data\//, "");
      const body = files[path];
      if (body !== undefined) return new Response(body, { headers: { "content-type": "application/xml", etag: `"${path}"` } });
      return rest.fetch(input as Request);
    },
  } as unknown as Fetcher;
}

// A records binding that counts every use and answers nothing: the index must not touch it.
function recordsSpy() {
  const used: string[] = [];
  const binding = new Proxy({}, {
    get(_t, prop) {
      used.push(String(prop));
      return () => { throw new Error("the records database was read for a sitemap"); };
    },
  }) as unknown as D1Database;
  return { used, binding };
}

let address = 0;
const get = (path: string, e: object = { ...testEnv(namedAssets()) }) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.51.100.${(address++ % 250) + 1}` } }, e);
const locsOf = (xml: string, tag = "url") => [...xml.matchAll(new RegExp(`<${tag}><loc>([^<]*)</loc>`, "g"))].map((m) => m[1]);
const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("the sitemap index", () => {
  it("names the parts the pipeline writes, in the pipeline's order", () => {
    const listed = /^SITEMAP_PARTS = \(([^)]*)\)/m.exec(exportStatic)?.[1] ?? "";
    expect([...listed.matchAll(/"([^"]+)"/g)].map((m) => m[1])).toEqual([...PIPELINE_PARTS]);
    expect(locsOf(namedIndex, "sitemap")).toEqual(PIPELINE_PARTS.map((p) => `${O}/sitemap-${p}-1.xml`));
    // The organizations with nothing recent have no part (the operator's ruling of 2026-11-21).
    expect([...PIPELINE_PARTS]).toEqual(["open-tenders", "pages", "active-organizations"]);
  });

  it("lists the open notices, the site's own pages, the guides, then the active organizations, and nothing else", async () => {
    expect(CONTRACT_SITEMAPS_LISTED).toBe(false);
    expect(CONTRACT_SITEMAPS_SERVED).toBe(false);
    const spy = recordsSpy();
    const res = await get("/sitemap.xml", { ...testEnv(namedAssets()), RECORDS: spy.binding });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const index = await res.text();
    expect(locsOf(index, "sitemap")).toEqual([
      `${O}/sitemap-open-tenders-1.xml`, `${O}/sitemap-pages-1.xml`, `${O}/${GUIDES_SITEMAP}`, `${O}/sitemap-active-organizations-1.xml`,
    ]);
    // Each part keeps the date the export gave it; the guides' part is dated by the newest check.
    expect(index).toContain(`<sitemap><loc>${O}/sitemap-active-organizations-1.xml</loc><lastmod>2026-10-30</lastmod></sitemap>`);
    expect(index).toContain(`<sitemap><loc>${O}/${GUIDES_SITEMAP}</loc><lastmod>${guidesChecked()}</lastmod></sitemap>`);
    expect(index).not.toContain("sitemap-contracts");
    expect(index).not.toContain("other-organizations");
    // Nothing is asked of the records database.
    expect(spy.used).toEqual([]);
    expect(index).toBe(withGuidesPart(namedIndex));
    expect(await servedIndex({ ...testEnv(), RECORDS: spy.binding } as unknown as Env, namedIndex)).toBe(index);
    expect(spy.used).toEqual([]);
  });

  it("leaves out a part the site no longer serves, so an earlier export's index is right from the deploy on", async () => {
    // The pipeline's index of the night before: it names the retired part, whose file is still on the site.
    expect(locsOf(earlierIndex, "sitemap")).toContain(`${O}/${RETIRED}`);
    const e = testEnv(namedAssets(EARLIER));
    const index = await (await get("/sitemap.xml", e)).text();
    expect(index).toBe(withGuidesPart(namedIndex));
    expect(index).not.toContain("other-organizations");
    // The file itself is the site's 404, though the export still holds it.
    expect((await get(`/${RETIRED}`, e)).status).toBe(404);
    expect(sitemapAsset(RETIRED)).toBeNull();
    // Only an entry whose file the site serves is kept: a part's name it does not know, a file of another site,
    // the index naming itself. What is kept is byte for byte as the export wrote it.
    const odd = namedIndex.replace("</sitemapindex>",
      `<sitemap><loc>${O}/sitemap-foo-1.xml</loc></sitemap>\n<sitemap><loc>https://example.com/sitemap-pages-1.xml</loc></sitemap>\n` +
      `<sitemap><loc>${O}/sitemap.xml</loc></sitemap>\n</sitemapindex>`);
    expect(withServedParts(odd)).toBe(namedIndex);
    expect(withServedParts(namedIndex)).toBe(namedIndex);
    // An export from before the parts had names keeps its numbered parts.
    expect(withServedParts(oldIndex)).toBe(oldIndex);
    expect(withServedParts("not an index")).toBe("not an index");
  });

  it("puts the guides' part after the last of the site's own pages, or at the end of an index that has none", () => {
    const two = namedIndex.replace(`<sitemap><loc>${O}/sitemap-pages-1.xml</loc><lastmod>2026-10-31</lastmod></sitemap>`,
      `<sitemap><loc>${O}/sitemap-pages-1.xml</loc><lastmod>2026-10-31</lastmod></sitemap>\n<sitemap><loc>${O}/sitemap-pages-2.xml</loc></sitemap>`);
    expect(locsOf(withGuidesPart(two), "sitemap").slice(1, 4)).toEqual([`${O}/sitemap-pages-1.xml`, `${O}/sitemap-pages-2.xml`, `${O}/${GUIDES_SITEMAP}`]);
    // An export written before the parts had names: the guides' part after all of them, as before.
    expect(withGuidesPart(oldIndex)).toBe(oldIndex.replace("</sitemapindex>",
      `<sitemap><loc>${O}/${GUIDES_SITEMAP}</loc><lastmod>${guidesChecked()}</lastmod></sitemap></sitemapindex>`));
    expect(withGuidesPart("not an index")).toBe("not an index");
  });
});

describe("the named parts", () => {
  it("list each page in English and in French, each with the alternates the page's own head names", async () => {
    for (const [part, body] of [["open-tenders", openTenders], ["pages", sitePages], ["active-organizations", activeOrganizations]] as const) {
      const res = await get(`/sitemap-${part}-1.xml`);
      expect(res.status, part).toBe(200);
      const xml = await res.text();
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">')).toBe(true);
      expect(locsOf(xml)).toEqual(locsOf(body).flatMap((u) => [u, `${u}?lang=fr`]));
      expect(xml).not.toContain(EM_DASH);
      expect(xml).not.toContain(EN_DASH);
    }
    // The lastmod the export gave a page stays with both of its entries; a page with none has none.
    const pages = await (await get("/sitemap-pages-1.xml")).text();
    expect(pages).toContain(`<url><loc>${O}/segments/82</loc><lastmod>2026-10-29</lastmod>`);
    expect(pages).toContain(`<url><loc>${O}/segments/82?lang=fr</loc><lastmod>2026-10-29</lastmod>`);
    expect(pages).toContain(`<url><loc>${O}/methodology</loc><xhtml:link`);
    // The sitemap's alternates for a page are the ones its head names, in both languages.
    const all = (await Promise.all(["open-tenders", "pages", "active-organizations"].map(async (p) => (await get(`/sitemap-${p}-1.xml`)).text()))).join("");
    for (const path of ["/", "/tenders", "/tenders/cb-100-10000001", "/buyers/pwgsc-tpsgc", "/segments/82", "/organizations/org-a000000001"]) {
      const block = [...all.matchAll(/<url>[\s\S]*?<\/url>/g)].map((m) => m[0]).find((u) => u.startsWith(`<url><loc>${O}${path}</loc>`));
      expect(block, path).toBeDefined();
      const listed = [...block!.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)"\/>/g)].map((m) => [m[1], decode(m[2])]);
      for (const q of ["", "?lang=fr"]) {
        const page = await (await get(`${path}${q}`, testEnv())).text();
        expect(page.length, path + q).toBeGreaterThan(0);
        const head = page.slice(0, page.indexOf("</head>"));
        const named = [...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]);
        expect(named, `${path}${q}`).toEqual(listed);
      }
    }
  });

  it("answer only the names the pipeline writes; the older numbered parts and the guides' part still answer", async () => {
    const e = testEnv(namedAssets());
    for (const bad of ["/sitemap-pages.xml", "/sitemap-pages-0.xml", "/sitemap-pages-01.xml", "/sitemap-pages-2.xml",
      "/sitemap-foo-1.xml", "/sitemap-x.xml", "/sitemap-contracts-x.xml", "/sitemap-guides-1.xml", "/sitemap-.xml", `/${RETIRED}`]) {
      expect((await get(bad, e)).status, bad).toBe(404);
    }
    // An export from before the parts had names, still on the site until the next nightly.
    expect((await get("/sitemap-1.xml", testEnv())).status).toBe(200);
    expect((await get(`/${GUIDES_SITEMAP}`, e)).status).toBe(200);
  });

  it("answer 404 for the published contracts' parts, reading nothing: robots.txt closes those pages to every crawler", async () => {
    const spy = recordsSpy();
    for (const path of ["/sitemap-contracts-1.xml", "/sitemap-contracts-128.xml", "/sitemap-contracts-129.xml"]) {
      expect((await get(path, { ...testEnv(namedAssets()), RECORDS: spy.binding })).status, path).toBe(404);
    }
    expect((await get("/sitemap-contracts-1.xml", { ...testEnv(namedAssets()), RECORDS: undefined })).status).toBe(404);
    expect(spy.used).toEqual([]);
  });

  it("map an address to its file under data/sitemaps", () => {
    expect(sitemapAsset("sitemap.xml")).toBe("sitemaps/index.xml");
    for (const part of PIPELINE_PARTS) expect(sitemapAsset(`sitemap-${part}-12.xml`)).toBe(`sitemaps/sitemap-${part}-12.xml`);
    expect(sitemapAsset("sitemap-3.xml")).toBe("sitemaps/sitemap-3.xml");
    for (const bad of ["sitemap-pages.xml", "sitemap-contracts-1.xml", "sitemap-guides.xml", "sitemap-0.xml", "sitemap-12345.xml",
      "sitemap-pages-1.xml.gz", "../sitemap-1.xml", "sitemap-1.XML", "sitemap-other-organizations-1.xml"]) {
      expect(sitemapAsset(bad), bad).toBeNull();
    }
  });
});
