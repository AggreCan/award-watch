// The open tender notices by province and territory (pages/provinces.tsx, since 2026-11-22): /provinces, the thirteen
// with their counts, and /provinces/<slug>, one province's notices, its buyers and its segments, from the export's
// provinces/ files. A reader who searches "federal tenders in <province>" lands here; the tender list filtered to a
// province is a query the crawlers do not read. A notice is placed by a stated or a derived province, so the list a
// page links (/tenders?province=XX&national=0) holds exactly its count.
import { describe, expect, it } from "vitest";
import { PROVINCES, PROVINCE_SLUGS, provinceOfSlug, provincePath } from "../src/constants";
import { app } from "../src/index";
import { provinceIn, provinceName, t, type Lang } from "../src/i18n";
import { PROVINCE_OPEN_PHONE_ROWS, PROVINCE_OPEN_ROWS, provinceList } from "../src/pages/provinces";
import { DESCRIPTION_MAX, TITLE_MAX, provinceSeo } from "../src/seo";
import { routeTemplate } from "../src/views";
import { FILES, assetsWithout, makeFakeAssets, testEnv } from "./assets";
import { expectTablesFit } from "./table-fit";
import exportStatic from "../../pipeline/awardwatch_pipeline/export_static.py?raw";

let address = 0;
async function get(path: string, assets?: Fetcher): Promise<Response> {
  return app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.51.100.${(address++ % 250) + 1}` } }, testEnv(assets));
}
async function html(path: string, assets?: Fetcher): Promise<string> {
  const res = await get(path, assets);
  expect(res.status, path).toBe(200);
  return res.text();
}
const mainOf = (page: string) => page.slice(page.indexOf("<main"), page.indexOf("</main>"));
const headOf = (page: string) => page.slice(0, page.indexOf("</head>"));
const titleOf = (page: string) => /<title>([^<]*)<\/title>/.exec(page)?.[1] ?? "";
const descriptionOf = (page: string) => /<meta name="description" content="([^"]*)"/.exec(page)?.[1] ?? "";
// The two no-break spaces, each named by its number so that this file holds neither.
const NBSP = String.fromCharCode(0xa0);
const NNBSP = String.fromCharCode(0x202f);
// Typographic apostrophes and no-break spaces read as plain ones.
const plain = (s: string) => s.replace(/&#39;|’/g, "'").replaceAll(NBSP, " ").replaceAll(NNBSP, " ").replace(/&amp;/g, "&");
// The panel whose heading holds the text, from its section's start to its end.
function panelOf(main: string, heading: string): string {
  const at = main.indexOf(`>${heading}</h2>`);
  if (at < 0) return "";
  return main.slice(main.lastIndexOf('<section class="panel', at), main.indexOf("</section>", at));
}

// A notice as a province's file lists it: the open list's row without what only that list's filters read.
function notice(i: number, closing: string): Record<string, unknown> {
  const row = structuredClone((FILES["tenders/open-first.json"] as { rows: Record<string, unknown>[] }).rows[1]);
  for (const k of ["excerpt_en", "excerpt_fr", "codes"]) delete row[k];
  return { ...row, reference: `cb-900-${90000000 + i}`, title_en: `Notice number ${i}`, title_fr: `Avis numéro ${i}`, closing };
}
const bc = () => structuredClone(FILES["provinces/bc.json"]) as Record<string, any>;
const withBc = (doc: Record<string, unknown>) => makeFakeAssets({}, { "provinces/bc.json": doc });

describe("the addresses", () => {
  it("are one slug for each of the thirteen, the same table as the pipeline's", () => {
    expect(Object.keys(PROVINCE_SLUGS).sort()).toEqual([...PROVINCES].sort());
    const block = /^PROVINCE_SLUGS = \{([\s\S]*?)^\}/m.exec(exportStatic)?.[1] ?? "";
    const theirs = Object.fromEntries([...block.matchAll(/"([A-Z]{2})": "([a-z-]+)"/g)].map((m) => [m[1], m[2]]));
    expect(theirs).toEqual(PROVINCE_SLUGS);
    for (const code of PROVINCES) {
      expect(PROVINCE_SLUGS[code]).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(provinceOfSlug(PROVINCE_SLUGS[code])).toBe(code);
      expect(provincePath(code)).toBe(`/provinces/${PROVINCE_SLUGS[code]}`);
    }
    expect(new Set(Object.values(PROVINCE_SLUGS)).size).toBe(13);
    // A code that is no province's (outside Canada, no address) has no page.
    expect(provincePath("XX")).toBeNull();
    expect(provinceOfSlug("bc")).toBeUndefined();
  });

  it("are in the pipeline's sitemap pages, dated by the provinces' index", () => {
    expect(/^SITEMAP_PAGES = \[([\s\S]*?)\]/m.exec(exportStatic)?.[1]).toContain('"/provinces"');
    expect(/^SITEMAP_DATED_PAGES = \{([\s\S]*?)\}/m.exec(exportStatic)?.[1]).toContain('"/provinces"');
    expect(exportStatic).toContain('"/provinces": ("provinces/index.json",),');
  });

  it("are counted as pages, one route for the thirteen", () => {
    expect(routeTemplate("GET", "/provinces")).toEqual({ route: "/provinces", kind: "page" });
    expect(routeTemplate("GET", "/provinces/nova-scotia")).toEqual({ route: "/provinces/:slug", kind: "page" });
  });
});

describe("/provinces", () => {
  it("lists the thirteen with their open notices, the most first, each a link to its page", async () => {
    const page = await html("/provinces");
    const main = mainOf(page);
    expect(main).toContain("<h1>Federal Tenders by Province and Territory</h1>");
    expect(titleOf(page)).toBe("Federal Tenders by Province and Territory | Award Watch");
    const links = [...main.matchAll(/<a href="\/provinces\/([a-z-]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(links).toHaveLength(13);
    expect(new Set(links.map((l) => l[0]))).toEqual(new Set(Object.values(PROVINCE_SLUGS)));
    // The three with a notice first, by name; then the rest by name.
    expect(links.slice(0, 4).map((l) => l[1])).toEqual(["British Columbia", "Ontario", "Quebec", "Alberta"]);
    expect(links[12][1]).toBe("Yukon");
    // A count opens the tender list at the province, the notices that name none left out; a zero is no link.
    expect(main).toContain('<a href="/tenders?province=BC&amp;national=0">1</a>');
    expect(main).not.toContain("province=AB");
    expect(main.match(/<span class="zero">0<\/span>/g)).toHaveLength(10);
    // The notice that names no province is counted apart, beside the way to every open notice.
    expect(main).toContain("1 open notice names no province or territory (Canada-wide or not stated).");
    expect(main).toContain('<a href="/tenders">All 3 open notices</a>');
    expect(main).toContain(t("en", "map.several"));
    expect(page).not.toContain('content="noindex');
  });

  it("reads in French, the names and their order the French ones", async () => {
    const page = await html("/provinces?lang=fr");
    const main = plain(mainOf(page));
    expect(main).toContain("<h1>Appels d'offres fédéraux par province et territoire</h1>");
    // The French name fills the line: the site's name is left out of the title, which fits a result list.
    expect(plain(titleOf(page))).toBe("Appels d'offres fédéraux par province et territoire");
    const names = [...main.matchAll(/<a href="\/provinces\/[a-z-]+">([^<]+)<\/a>/g)].map((m) => m[1]);
    expect(names.slice(0, 3)).toEqual(["Colombie-Britannique", "Ontario", "Québec"]);
    expect(names).toContain("Île-du-Prince-Édouard");
    expect(main).toContain("1 avis ouvert ne nomme aucune province ni aucun territoire (tout le Canada ou non indiqué).");
    expect(main).toContain('<a href="/tenders">Les 3 avis ouverts</a>');
  });

  it("answers not published without its file", async () => {
    expect((await get("/provinces", assetsWithout("provinces/index.json"))).status).toBe(503);
  });
});

describe("a province's page", () => {
  it("names the place and lists its open notices, its buyers and its segments", async () => {
    const page = await html("/provinces/british-columbia");
    const main = mainOf(page);
    expect(titleOf(page)).toBe("Federal Tenders in British Columbia | Award Watch");
    expect(main).toContain("<h1>Federal Tenders in British Columbia</h1>");
    expect(main).toContain("1 open federal tender notice has work delivered in British Columbia.");
    expect(main).toContain(t("en", "province.note"));
    expect(headOf(page)).toContain('<link rel="canonical" href="https://awardwatch.ca/provinces/british-columbia"/>');
    expect(descriptionOf(page)).toContain("in British Columbia");
    expect(page).not.toContain('content="noindex');
    // The breadcrumb, in the page and in its structured data.
    expect(main).toContain('<a href="/provinces">Provinces and Territories</a>');
    expect(headOf(page)).toContain('"name":"British Columbia"');

    const open = panelOf(main, t("en", "buyer.open_title"));
    expect(open).toContain('<span class="panel-count">1</span>');
    expect(open).toContain('<a href="/tenders/cb-200-20005019">');
    // A phone shows the first rows and a button for the rest, which the pager script draws.
    expect(open).toContain(`data-phone-rows="${PROVINCE_OPEN_PHONE_ROWS}"`);
    expect(page.split('<script src="/pager.js" defer=""></script>')).toHaveLength(2);
    // Every notice is shown, so no line says which are; the filled button opens the list with its filters.
    expect(open).not.toContain("closing soonest");
    expect(open).toContain('<a href="/tenders?province=BC&amp;national=0" class="btn btn-primary">Filter the open notices (1)</a>');
    expect(main.match(/btn-primary/g)).toHaveLength(1);

    const buyers = panelOf(main, t("en", "province.buyers"));
    expect(buyers).toContain('<a href="/buyers/dfo-mpo">Fisheries and Oceans Canada</a>');
    expect(buyers).toContain('<a href="/tenders?province=BC&amp;national=0&amp;buyer=dfo-mpo">1</a>');
    expect(buyers).not.toContain("The first");
    const segments = panelOf(main, t("en", "province.segments"));
    expect(segments).toContain('<span class="mono">72</span> <a href="/segments/72">');
    expect(segments).toContain('<a href="/tenders?province=BC&amp;national=0&amp;segment=78">1</a>');
    expect(segments).toContain('<span class="panel-count">2</span>');

    // The other twelve, by name, and never the page itself.
    const others = panelOf(main, t("en", "province.others"));
    const linked = [...others.matchAll(/<a href="\/provinces\/([a-z-]+)">/g)].map((m) => m[1]);
    expect(linked).toHaveLength(12);
    expect(linked).not.toContain("british-columbia");
    expect(linked[0]).toBe("alberta");
  });

  it("offers the province's new notices by email, the tender list's own filter", async () => {
    const main = mainOf(await html("/provinces/british-columbia"));
    const params = /<input type="hidden" name="params" value="([^"]*)"/.exec(main)?.[1] ?? "";
    expect(plain(params).startsWith("/tenders?")).toBe(true);
    expect(new URLSearchParams(plain(params).split("?")[1]).get("province")).toBe("BC");
    expect(new URLSearchParams(plain(params).split("?")[1]).get("national")).toBe("0");
    expect(main).toContain('<input type="hidden" name="kind" value="tenders"/>');
    expect(provinceList("BC")).toBe("/tenders?province=BC&national=0");
  });

  it("reads in French with the place's own preposition", async () => {
    const page = await html("/provinces/british-columbia?lang=fr");
    const main = plain(mainOf(page));
    expect(main).toContain("<h1>Appels d'offres fédéraux en Colombie-Britannique</h1>");
    expect(main).toContain("1 avis d'appel d'offres fédéral ouvert prévoit une livraison en Colombie-Britannique.");
    expect(main).toContain('<a href="/buyers/dfo-mpo">Pêches et Océans Canada</a>');
    expect(main).toContain(">Filtrer les avis ouverts (1)</a>");
    expect(headOf(page)).toContain('<link rel="canonical" href="https://awardwatch.ca/provinces/british-columbia?lang=fr"/>');
    const yukon = plain(mainOf(await html("/provinces/yukon?lang=fr")));
    expect(yukon).toContain("<h1>Appels d'offres fédéraux au Yukon</h1>");
  });

  it("with no notice says so, keeps the email list and the other provinces, and draws no empty table", async () => {
    const page = await html("/provinces/yukon");
    const main = mainOf(page);
    expect(main).toContain("No open federal tender notice has work delivered in Yukon.");
    const open = panelOf(main, t("en", "buyer.open_title"));
    expect(open).toContain("No open notice is placed in Yukon.");
    expect(open).not.toContain("<table");
    expect(page).not.toContain("/pager.js");
    expect(main).not.toContain("btn-primary");
    expect(main).not.toContain(`>${t("en", "province.buyers")}</h2>`);
    expect(main).not.toContain(`>${t("en", "province.segments")}</h2>`);
    expect(main).toContain('name="kind" value="tenders"');
    expect(panelOf(main, t("en", "province.others"))).toContain('<a href="/provinces/british-columbia">British Columbia</a>');
    // The page stays one a search engine may index: it says what is true of the day, with the ways onward.
    expect(page).not.toContain('content="noindex');
  });

  it("shows the soonest to close, a notice whose time has passed after the ones still open, and says how many it shows", async () => {
    // Forty in the file, 60 in all: the first closed an hour before the test clock (2026-10-31T16:00:00Z).
    const rows = [notice(0, "2026-10-31T11:00:00"), ...Array.from({ length: 39 }, (_, i) => notice(i + 1, `2026-12-${String(1 + (i % 28)).padStart(2, "0")}T14:00:00`))];
    const doc = { ...bc(), open_tenders: 60, open_notices: rows, n_buyers: 14, n_segments: 2 };
    const main = mainOf(await html("/provinces/british-columbia", withBc(doc)));
    const open = panelOf(main, t("en", "buyer.open_title"));
    const refs = [...open.matchAll(/<a href="\/tenders\/(cb-900-\d+)">/g)].map((m) => m[1]);
    expect(refs).toHaveLength(PROVINCE_OPEN_ROWS);
    expect(PROVINCE_OPEN_ROWS).toBe(25);
    expect(refs).toEqual(rows.slice(1, 26).map((r) => String(r.reference)));
    expect(open).toContain('<span class="panel-count">60</span>');
    expect(open).toContain("The 25 closing soonest.");
    expect(open).toContain(">Filter the open notices (60)</a>");
    expect(main).toContain("60 open federal tender notices have work delivered in British Columbia.");
    // The file ranks the first buyers of fourteen: the panel counts them all and says how many it shows.
    const buyers = panelOf(main, t("en", "province.buyers"));
    expect(buyers).toContain('<span class="panel-count">14</span>');
    expect(buyers).toContain("The first 1 of 14.");
    expect(panelOf(main, t("en", "province.segments"))).not.toContain("The first");
  });

  it("fits its tables at every width, in both languages", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => notice(i + 1, `2026-12-${String(1 + (i % 28)).padStart(2, "0")}T14:00:00`));
    const assets = withBc({ ...bc(), open_tenders: 30, open_notices: rows });
    for (const q of ["", "?lang=fr"]) {
      expectTablesFit(await html(`/provinces/british-columbia${q}`, assets), `/provinces/british-columbia${q}`);
      expectTablesFit(await html(`/provinces${q}`), `/provinces${q}`);
    }
  });

  it("answers not found for a slug that names none, and not published without the province's file", async () => {
    const missing = await get("/provinces/atlantis");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain('<a href="/provinces"');
    for (const path of ["/provinces/BC", "/provinces/bc", "/provinces/british_columbia", "/provinces/42", `/provinces/${"a".repeat(60)}`]) {
      expect((await get(path)).status, path).toBe(404);
    }
    // Alberta has no file among the fixtures; a file of the wrong province is not read as this one's.
    expect((await get("/provinces/alberta")).status).toBe(503);
    expect((await get("/provinces/british-columbia", withBc({ ...bc(), code: "ON" }))).status).toBe(503);
    expect((await get("/provinces/british-columbia", withBc({ ...bc(), open_tenders: 0 }))).status).toBe(503);
  });
});

describe("a province's result-list text", () => {
  it("fits a result list for every province in both languages, and names the place", () => {
    for (const lang of ["en", "fr"] as Lang[]) {
      const titles = new Set<string>();
      for (const code of PROVINCES) {
        const seo = provinceSeo(code, 1234, lang, [{ name: provinceName(lang, code) }]);
        const what = `${lang} ${code}: ${seo.title}`;
        expect((seo.title ?? "").length, what).toBeLessThanOrEqual(TITLE_MAX);
        expect(seo.title, what).toContain(provinceIn(lang, code));
        expect(seo.description.length, `${lang} ${code}: ${seo.description}`).toBeLessThanOrEqual(DESCRIPTION_MAX);
        // Nothing cut: the description ends on its own sentence, the count in it.
        expect(seo.description.endsWith("."), `${lang} ${code}: ${seo.description}`).toBe(true);
        expect(seo.description).toContain(lang === "fr" ? `1${NBSP}234` : "1,234");
        expect(seo.path).toBe(`/provinces/${PROVINCE_SLUGS[code]}`);
        // Neither long dash, each named by its number so that this file holds none.
        for (const dash of [0x2013, 0x2014]) expect(`${seo.title}${seo.description}`).not.toContain(String.fromCharCode(dash));
        titles.add(seo.title ?? "");
      }
      expect(titles.size).toBe(13);
    }
    // The site's name follows where the line has room for it, and is left out where it has not.
    expect(provinceSeo("ON", 5, "en", []).title).toBe("Federal Tenders in Ontario | Award Watch");
    expect(plain(provinceSeo("NT", 5, "fr", []).title ?? "")).toBe("Appels d'offres fédéraux dans les Territoires du Nord-Ouest");
  });
});

describe("the ways to the pages", () => {
  it("every page's footer links the provinces, in both languages", async () => {
    for (const path of ["/tenders", "/methodology", "/provinces/yukon"]) {
      expect(await html(path), path).toContain('<a href="/provinces">By province</a>');
    }
    expect(await html("/tenders?lang=fr")).toContain('<a href="/provinces">Par province</a>');
  });

  it("the rail lists the pages after Segments, and its item is the current one on each of them", async () => {
    const ITEM = '<a class="rail-item" href="/provinces"><span class="rail-label">Provinces</span></a>';
    const HERE = '<a class="rail-item" href="/provinces" aria-current="page"><span class="rail-label">Provinces</span></a>';
    const railOf = (page: string) => /<nav class="rail"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
    for (const path of ["/tenders", "/tenders?lang=fr", "/segments/82"]) {
      const rail = railOf(await html(path));
      expect(rail, path).toContain(`<span class="rail-label">Segments</span></a></li><li>${ITEM}</li>`);
    }
    for (const path of ["/provinces", "/provinces/british-columbia", "/provinces/yukon?lang=fr"]) {
      const rail = railOf(await html(path));
      expect(rail, path).toContain(`<li>${HERE}</li>`);
      expect(rail.match(/aria-current="page"/g), path).toHaveLength(1);
    }
  });

  it("a notice's provinces of delivery link their pages", async () => {
    const main = mainOf(await html("/tenders/cb-100-10000001"));
    expect(main).toContain('<dd><a href="/provinces/ontario">Ontario</a>, <a href="/provinces/quebec">Quebec</a></dd>');
    const fr = mainOf(await html("/tenders/cb-100-10000001?lang=fr"));
    expect(fr).toContain('<a href="/provinces/quebec">Québec</a>');
  });
});
