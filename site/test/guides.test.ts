// The guides (src/guides.ts, src/pages/guides.tsx, docs/guides.md): the index
// and each guide in both languages; English and French held to the same
// sections, links and figures; every link inside a guide answering on the
// site, its fragment included; every source an https page on a government
// domain; the sitemap's part, the result-list tags and the structured data;
// no account link and no Pro mark in a guide whatever the accounts switch
// says; the rail and footer links; and the writing rules a test can check.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { CLOSING_SOON_DAYS } from "../src/constants";
import { EXAMPLE_PROFILE, EXAMPLE_SET_ASIDE, GUIDES, type Block, type Both, type Guide, type Link, type Text } from "../src/guides";
import { allKeys, rawEntry } from "../src/i18n";
import { EXPIRING_TEASER_ROWS } from "../src/pages/expiring";
import { guideText } from "../src/pages/guides";
import { DESCRIPTION_MAX, TITLE_MAX } from "../src/seo";
import { routeTemplate } from "../src/views";
import { nextIp, onEnv, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import { applySql } from "./setup";
import { expectTablesFit } from "./table-fit";

useAccountsDb();

// The published contract the guide on set-asides links, in the records
// database its page reads: a mandatory set-aside, as its department reported it.
const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const [setAsideDept, setAsideRef] = EXAMPLE_SET_ASIDE.slice("/contracts/".length).split("/").map(decodeURIComponent);
beforeAll(async () => {
  await applySql(RECORDS, RECORDS_SCHEMA);
  await RECORDS.batch([
    RECORDS.prepare("DELETE FROM rec_contract_indigenous WHERE k = 9301"),
    RECORDS.prepare("DELETE FROM rec_contracts WHERE k = 9301"),
    RECORDS.prepare("INSERT OR REPLACE INTO rec_buyers (bid, id, name_en, name_fr) VALUES (9301, ?1, 'National Defence', 'Défense nationale')").bind(setAsideDept),
    RECORDS.prepare("INSERT OR REPLACE INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', '2026-10-31'), ('rules', '2')"),
    RECORDS.prepare(
      "INSERT INTO rec_contracts (k, dept, ref, pid, bid, oid, wh, cdate, start, endd, value, orig, amend, proc, comp, ctype, inst, period, bids, desc_en, desc_fr) " +
      "VALUES (9301, ?1, ?2, NULL, 9301, NULL, 0, '2026-03-26', '2026-03-26', '2027-03-31', 193398816, 193398816, 0, 'OB', 1, 'G', 'C', '2026-2027-Q1', 1, " +
      "'Road motor vehicles', 'Véhicules automobiles de route')",
    ).bind(setAsideDept, setAsideRef),
    RECORDS.prepare("INSERT INTO rec_contract_indigenous (k, psib, ib) VALUES (9301, 'MS', 0)"),
  ]);
});

const O = "https://awardwatch.ca";
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const headOf = (html: string) => html.slice(0, html.indexOf("</head>"));
const mainOf = (html: string) => /<main id="main">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
const titleOf = (head: string) => decode(/<title>([^<]*)<\/title>/.exec(head)?.[1] ?? "");
const metaOf = (head: string, name: string) =>
  decode(new RegExp(`<meta (?:name|property)="${name.replace(/[:.]/g, "\\$&")}" content="([^"]*)"`).exec(head)?.[1] ?? "");
const jsonLd = (head: string): any[] => [...head.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const hrefs = (html: string) => [...html.matchAll(/<a [^>]*?href="([^"]+)"/g)].map((m) => decode(m[1]));

const request = (path: string, env: object = testEnv()) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, env);
const html = async (path: string, env: object = testEnv()) => (await request(path, env)).text();
const pathOf = (g: Guide) => `/guides/${g.slug}`;
const fr = (path: string) => `${path}${path.includes("?") ? "&" : "?"}lang=fr`;

// -- the content, walked ---------------------------------------------------------------

// Every piece of text a guide holds, with the links its slots name.
type Piece = { where: string; both: Both; links?: Record<string, Link> };

function pieces(g: Guide): Piece[] {
  const out: Piece[] = [
    { where: `${g.slug} title`, both: g.title },
    { where: `${g.slug} summary`, both: g.summary },
  ];
  if (g.seoTitle) out.push({ where: `${g.slug} seoTitle`, both: g.seoTitle });
  const text = (where: string, t: Text) => out.push({ where, both: t, links: t.links });
  const block = (where: string, b: Block) => {
    if (b.kind === "p") text(where, b.text);
    if (b.kind === "list") b.items.forEach((i, n) => text(`${where} item ${n}`, i));
    if (b.kind === "terms") {
      b.items.forEach((i, n) => {
        out.push({ where: `${where} term ${n}`, both: i.term });
        text(`${where} definition ${n}`, i.text);
      });
    }
    if (b.kind === "table") {
      b.cols.forEach((c, n) => out.push({ where: `${where} column ${n}`, both: c.label }));
      b.rows.forEach((r, n) => r.forEach((cell, k) => { if (!("money" in cell)) out.push({ where: `${where} row ${n} cell ${k}`, both: cell }); }));
    }
  };
  for (const s of g.sections) {
    out.push({ where: `${g.slug}#${s.id} title`, both: s.title });
    s.blocks.forEach((b, n) => block(`${g.slug}#${s.id} block ${n}`, b));
  }
  // A source's title is the page's own, in the language it was read in; its publisher is said in both.
  for (const [n, s] of g.sources.entries()) out.push({ where: `${g.slug} source ${n} publisher`, both: s.publisher });
  // The sentence over the guide's email list (test/accounts-funnel.test.ts), held to the same writing rules.
  if (g.action) out.push({ where: `${g.slug} action`, both: g.action.text });
  return out;
}

const ALL = GUIDES.flatMap(pieces);
const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
// A piece's text with its links' words in their slots, as a reader sees it.
const filled = (p: Piece, lang: "en" | "fr") => p.both[lang].replace(/\{(\w+)\}/g, (_m, k: string) => p.links?.[k]?.text[lang] ?? "");
// The figures a text states: grouped thousands read whole ("10,000" and "10 000" are 10000).
const figures = (s: string, lang: "en" | "fr") =>
  (s.match(lang === "en" ? /\d{1,3}(?:,\d{3})+|\d+/g : /\d{1,3}(?:[   ]\d{3})+|\d+/g) ?? [])
    .map((n) => Number(n.replace(/[^\d]/g, ""))).sort((a, b) => a - b);
const internalLinks = (g: Guide) => pieces(g).flatMap((p) => Object.values(p.links ?? {}).map((l) => l.href));

// The fixtures the guides' links need beside the shared ones: the example
// profile with records in all three contract sources and an instrument, an
// instruments list to filter, and the 6- and 12-month lists of contracts
// ending (the 3-month list's rows, as the radar's other tests build them).
const shard = EXAMPLE_PROFILE.slice("/organizations/org-".length, "/organizations/org-".length + 3);
const exampleId = EXAMPLE_PROFILE.slice("/organizations/".length);
const exampleProfile = (() => {
  const profiles = structuredClone(FILES["profiles/a00.json"]) as Record<string, any>;
  const p = profiles["org-a000000001"];
  const other = profiles["org-a000000002"];
  p.organization.id = exampleId;
  p.history = other.history;
  p.history_total_rows = other.history_total_rows;
  p.organization.n_history = other.organization.n_history;
  p.instruments = {
    n: 1,
    rows: [{ agreement: "E60ZT-120003/001/ZT", type: "SA", type_en: "Supply Arrangement", type_fr: null, description_en: "Geospatial data services",
      description_fr: null, regions: ["NA"], expiry: "2027-12-31" }],
    lapsed: [],
  };
  return { [exampleId]: p };
})();
const INSTRUMENTS = {
  as_of: "2026-10-31", published: "2026-10-30", status: "ok", source: "https://sosa.canadabuys.canada.ca/",
  types: {
    SA: { en: "Supply Arrangement", fr: "Arrangement en matière d'approvisionnement" },
    NMSO: { en: "National Master Standing Offer", fr: "Offre à commandes principale et nationale" },
  },
  commodities: {},
  end_users: {},
  rows: [
    { agreement: "E60ZT-120003/001/ZT", type: "SA", description_en: "Geospatial data services", description_fr: null, commodity: [], end_user: null,
      regions: ["NA"], segments: [], start: null, expiry: "2027-12-31", n_holders: 1, n_holders_withheld: 0 },
    { agreement: "EZ899-250380/001/ZM", type: "NMSO", description_en: "Translation services", description_fr: null, commodity: [], end_user: null,
      regions: ["NC"], segments: [], start: null, expiry: "2027-06-30", n_holders: 1, n_holders_withheld: 0 },
  ],
};
const deeperWindows = Object.fromEntries(["6m", "12m"].flatMap((w) => [
  [`expiring/${w}/index.json`, { ...(FILES["expiring/3m/index.json"] as object), window: w }],
  [`expiring/${w}/1.json`, FILES["expiring/3m/1.json"]],
]));
const linkEnv = () =>
  testEnv(makeFakeAssets({}, { [`profiles/${shard}.json`]: exampleProfile, "instruments/index.json": INSTRUMENTS, ...deeperWindows }));

describe("the routes", () => {
  it("serve the index and every guide in both languages, cached as the other document pages are", async () => {
    for (const path of ["/guides", ...GUIDES.map(pathOf)]) {
      for (const [url, lang] of [[path, "en"], [fr(path), "fr"]] as const) {
        const res = await request(url);
        expect(res.status, url).toBe(200);
        expect(res.headers.get("cache-control"), url).toBe("public, max-age=300");
        const page = await res.text();
        expect(page, url).toContain(`<html lang="${lang}">`);
        expect(page, url).not.toContain(EM_DASH);
        expect(page, url).not.toContain(EN_DASH);
      }
    }
    for (const g of GUIDES) {
      for (const lang of ["en", "fr"] as const) {
        const page = nbsp(decode(await html(lang === "fr" ? fr(pathOf(g)) : pathOf(g))));
        expect(page).toContain(`<h1>${nbsp(guideText(lang, g.title))}</h1>`);
        // Every section under its heading, then the sources, the checked date and the line that they govern.
        for (const s of g.sections) expect(page).toContain(`<h2 id="${s.id}">${nbsp(guideText(lang, s.title))}</h2>`);
        expect(page).toContain(`<h2 id="sources">Sources</h2>`);
        expect(page.indexOf('<h2 id="sources">')).toBeGreaterThan(page.indexOf(`<h2 id="${g.sections.at(-1)!.id}">`));
        expect(page).toContain(lang === "fr" ? `Vérifié par rapport à ses sources le ${g.checked}.` : `Checked against its sources on ${g.checked}.`);
        expect(page).toContain(lang === "fr"
          ? "Les sources officielles font foi. Ce guide les explique et ne donne aucun conseil juridique ou d’affaires."
          : "The official sources govern. This guide explains them and gives no legal or business advice.");
      }
    }
  });

  it("answer an unknown guide with a 404 and a mixed-case slug with a move to the lower-case one", async () => {
    const missing = await request("/guides/no-such-guide");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Guide Not Found");
    const upper = await request(`/guides/${GUIDES[0].slug.toUpperCase()}?lang=fr`);
    expect(upper.status).toBe(301);
    expect(upper.headers.get("location")).toBe(`${pathOf(GUIDES[0])}?lang=fr`);
  });

  it("list every guide on the index, in its order, with its summary and the day it was checked", async () => {
    for (const lang of ["en", "fr"] as const) {
      const main = nbsp(decode(mainOf(await html(lang === "fr" ? "/guides?lang=fr" : "/guides"))));
      expect(hrefs(main).filter((h) => h.startsWith("/guides/"))).toEqual(GUIDES.map(pathOf));
      for (const g of GUIDES) {
        expect(main).toContain(`<h3><a href="${pathOf(g)}">${nbsp(guideText(lang, g.title))}</a></h3>`);
        expect(main).toContain(nbsp(guideText(lang, g.summary)));
        expect(main).toContain(g.checked);
      }
    }
  });

  it("count each guide's page at its own address in the views, and the index and sitemap part as the others are", () => {
    expect(routeTemplate("GET", "/guides")).toEqual({ route: "/guides", kind: "page" });
    for (const g of GUIDES) expect(routeTemplate("GET", pathOf(g))).toEqual({ route: pathOf(g), kind: "page" });
    expect(routeTemplate("GET", "/guides/anything-else")).toEqual({ route: "/guides/:slug", kind: "page" });
    expect(routeTemplate("GET", "/sitemap-guides.xml")).toEqual({ route: "/sitemap.xml", kind: "file" });
  });
});

describe("English and French", () => {
  it("say every piece in both languages, with the same links in the same slots", () => {
    expect(ALL.length).toBeGreaterThan(100);
    for (const p of ALL) {
      expect(p.both.en.trim(), p.where).not.toBe("");
      expect(p.both.fr.trim(), p.where).not.toBe("");
      const en = slots(p.both.en);
      const frs = slots(p.both.fr);
      expect([...frs].sort(), p.where).toEqual([...en].sort());
      expect(new Set(en).size, `${p.where}: a slot used twice`).toBe(en.length);
      expect(en.sort(), `${p.where}: a slot without a link, or a link without a slot`).toEqual(Object.keys(p.links ?? {}).sort());
      for (const l of Object.values(p.links ?? {})) {
        expect(l.text.en.trim(), p.where).not.toBe("");
        expect(l.text.fr.trim(), p.where).not.toBe("");
      }
    }
  });

  it("state the same figures in every piece", () => {
    for (const p of ALL) expect(figures(filled(p, "fr"), "fr"), p.where).toEqual(figures(filled(p, "en"), "en"));
  });

  it("render the same sections, the same internal links and the same table shapes", async () => {
    for (const g of GUIDES) {
      const ids = new Set(g.sections.map((s) => s.id));
      expect(ids.size, g.slug).toBe(g.sections.length);
      expect(ids.has("sources"), g.slug).toBe(false);
      for (const s of g.sections) {
        for (const b of s.blocks) if (b.kind === "table") for (const r of b.rows) expect(r.length, `${g.slug}#${s.id}`).toBe(b.cols.length);
      }
      const en = mainOf(await html(pathOf(g)));
      const frPage = mainOf(await html(fr(pathOf(g))));
      const inside = (main: string) => hrefs(main).filter((h) => h.startsWith("/") || h.startsWith("#"));
      expect(inside(frPage), g.slug).toEqual(inside(en));
      const heads = (main: string) => [...main.matchAll(/<h2 id="([^"]+)">/g)].map((m) => m[1]);
      expect(heads(frPage), g.slug).toEqual(heads(en));
      expect(heads(en), g.slug).toEqual([...g.sections.map((s) => s.id), "sources"]);
      const tables = (main: string) => [...main.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => (m[0].match(/<td/g) ?? []).length);
      expect(tables(frPage), g.slug).toEqual(tables(en));
    }
  });
});

describe("links and sources", () => {
  it("send every link inside a guide to a page the site serves, its fragment on that page", async () => {
    const env = linkEnv();
    const targets = new Set<string>(GUIDES.flatMap(internalLinks));
    // The guides link the parts of the site the brief names: the open notices, a type filter, the
    // Methodology's statuses and places, the standing offers list, a profile's sections, the Data page;
    // the open ACANs and the counting of competitive records; a contract reporting a set-aside; the three
    // lists of contracts ending and the overview of them.
    for (const want of ["/tenders", "/methodology#statuses", "/methodology#places", "/methodology#counting", "/instruments", "/data#sources",
      `${EXAMPLE_PROFILE}#awards`, `${EXAMPLE_PROFILE}#history`, `${EXAMPLE_PROFILE}#contracts`, `${EXAMPLE_PROFILE}#instruments`,
      "/tenders?type=Advance%20Contract%20Award%20Notice", "/methodology#competitive", "/methodology#expiring", EXAMPLE_SET_ASIDE,
      "/expiring", "/expiring/3m", "/expiring/6m", "/expiring/12m"]) {
      expect(targets.has(want), want).toBe(true);
    }
    expect([...targets].some((h) => h.startsWith("/tenders?type="))).toBe(true);
    for (const href of targets) {
      expect(href.startsWith("/"), href).toBe(true);
      const [path, hash] = href.split("#");
      const res = await request(path, env);
      expect(res.status, href).toBe(200);
      const body = await res.text();
      if (hash) expect(body, href).toContain(`id="${hash}"`);
    }
  });

  it("cite only https pages on a government domain, each with its title, publisher and the day they were checked", () => {
    for (const g of GUIDES) {
      expect(g.sources.length, g.slug).toBeGreaterThanOrEqual(5);
      expect(new Set(g.sources.map((s) => s.url)).size, `${g.slug}: a source listed twice`).toBe(g.sources.length);
      for (const s of g.sources) {
        expect(s.title.trim(), s.url).not.toBe("");
        if (s.fr) expect(s.fr.title.trim(), s.url).not.toBe("");
        for (const address of [s.url, s.fr?.url].filter((u): u is string => !!u)) {
          const u = new URL(address);
          expect(u.protocol, address).toBe("https:");
          expect(/(^|\.)canada\.ca$|\.gc\.ca$/.test(u.hostname), address).toBe(true);
        }
      }
      expect(/^\d{4}-\d{2}-\d{2}$/.test(g.checked), g.slug).toBe(true);
    }
  });

  it("show each source with its title, publisher and address: the French page where one was read, else the English one, said so", async () => {
    for (const g of GUIDES) {
      const en = nbsp(decode(await html(pathOf(g))));
      const frPage = nbsp(decode(await html(fr(pathOf(g)))));
      for (const s of g.sources) {
        expect(en).toContain(`<a href="${s.url}" rel="noopener">${s.title}</a>. ${s.publisher.en}. <span class="muted small">${s.url}</span>`);
        const french = s.fr
          ? `<a href="${s.fr.url}" rel="noopener">${nbsp(guideText("fr", { en: "", fr: s.fr.title }))}</a>`
          : `<a href="${s.url}" rel="noopener">${s.title} (en anglais)</a>`;
        expect(frPage, s.url).toContain(french);
      }
    }
  });

  it("send the guide on set-asides to a contract page that shows the field it describes", async () => {
    const page = nbsp(decode(await html(EXAMPLE_SET_ASIDE, linkEnv())));
    expect(page).toContain("<dt>Procurement Strategy for Indigenous Business</dt>");
    expect(page).toContain("Mandatory Set-Aside");
    const frPage = nbsp(decode(await html(fr(EXAMPLE_SET_ASIDE), linkEnv())));
    expect(frPage).toContain("Contrat réservé obligatoire");
  });

  it("hold what the guide on contracts ending says every reader sees to the number the pages show", () => {
    const g = GUIDES.find((x) => x.slug === "when-a-federal-contract-ends")!;
    const ending = pieces(g).filter((p) => p.where.includes("#ending"));
    expect(ending.some((p) => filled(p, "en").includes(`their first ${EXPIRING_TEASER_ROWS} contracts`))).toBe(true);
    expect(ending.some((p) => filled(p, "fr").includes(`les ${EXPIRING_TEASER_ROWS} premiers contrats`))).toBe(true);
  });

  it("hold the closing-soon window to the one the pages use", () => {
    const g = GUIDES.find((x) => x.slug === "reading-a-canadabuys-tender-notice")!;
    const closing = pieces(g).filter((p) => p.where.includes("#closing"));
    expect(closing.some((p) => filled(p, "en").includes(`within ${CLOSING_SOON_DAYS} days`))).toBe(true);
    expect(closing.some((p) => filled(p, "fr").includes(`d'ici ${CLOSING_SOON_DAYS} jours`))).toBe(true);
    expect(internalLinks(g)).toContain(`/tenders?closing=${CLOSING_SOON_DAYS}`);
  });
});

describe("search framing", () => {
  it("give each page a title and description that fit a result list, and none shared", async () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const path of ["/guides", ...GUIDES.map(pathOf)]) {
      for (const url of [path, fr(path)]) {
        const head = headOf(await html(url));
        const title = titleOf(head);
        const description = metaOf(head, "description");
        expect(title.length, `${url}: ${title}`).toBeLessThanOrEqual(TITLE_MAX);
        expect(description.length, `${url}: ${description}`).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(description.length, url).toBeGreaterThanOrEqual(60);
        expect(titles.has(title), title).toBe(false);
        expect(descriptions.has(description), description).toBe(false);
        titles.add(title);
        descriptions.add(description);
      }
    }
  });

  it("carry the tags the other document pages carry: canonical, alternates, social, and on a guide its trail and Article", async () => {
    for (const path of ["/guides", ...GUIDES.map(pathOf)]) {
      const en = headOf(await html(path));
      const frHead = headOf(await html(fr(path)));
      expect(en, path).toContain(`<link rel="canonical" href="${O}${path}"/>`);
      expect(decode(frHead), path).toContain(`<link rel="canonical" href="${O}${path}?lang=fr"/>`);
      for (const head of [en, frHead]) {
        expect(decode(head), path).toContain(`<link rel="alternate" hreflang="en" href="${O}${path}"/>`);
        expect(decode(head), path).toContain(`<link rel="alternate" hreflang="fr" href="${O}${path}?lang=fr"/>`);
        expect(decode(head), path).toContain(`<link rel="alternate" hreflang="x-default" href="${O}${path}"/>`);
        expect(metaOf(head, "og:title"), path).not.toBe("");
        expect(metaOf(head, "og:description"), path).toBe(metaOf(head, "description"));
        expect(metaOf(head, "twitter:card"), path).toBe("summary_large_image");
        expect(head, path).not.toContain('name="robots"');
      }
    }
    for (const g of GUIDES) {
      for (const lang of ["en", "fr"] as const) {
        const url = lang === "fr" ? fr(pathOf(g)) : pathOf(g);
        const blocks = jsonLd(headOf(await html(url)));
        const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList");
        expect(crumbs.itemListElement.map((i: any) => i.item ?? null)).toEqual([`${O}/`, `${O}/guides`, null]);
        const article = blocks.find((b) => b["@type"] === "Article");
        expect(article["@context"]).toBe("https://schema.org");
        expect(nbsp(article.headline)).toBe(nbsp(guideText(lang, g.title)).replace(/ /g, " "));
        expect(article.dateModified).toBe(g.checked);
        expect(article.inLanguage).toBe(lang === "fr" ? "fr-CA" : "en-CA");
        expect(article.url).toBe(lang === "fr" ? `${O}${pathOf(g)}?lang=fr` : `${O}${pathOf(g)}`);
        expect(article.publisher.name).toBe("Allwater Software Inc.");
        expect(JSON.stringify(blocks)).not.toContain(EM_DASH);
      }
    }
  });

  it("list the index and every guide in their sitemap part, both languages, dated by the check, and the part in the index", async () => {
    const res = await request("/sitemap-guides.xml");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    const xml = await res.text();
    const locs = [...xml.matchAll(/<url><loc>([^<]*)<\/loc>/g)].map((m) => decode(m[1]));
    const paths = ["/guides", ...GUIDES.map(pathOf)];
    expect(locs).toEqual(paths.flatMap((p) => [`${O}${p}`, `${O}${p}?lang=fr`]));
    for (const g of GUIDES) expect(xml).toContain(`<loc>${O}${pathOf(g)}</loc><lastmod>${g.checked}</lastmod>`);
    expect(xml).toContain(`<xhtml:link rel="alternate" hreflang="fr" href="${O}${pathOf(GUIDES[0])}?lang=fr"/>`);
    const index = await (await request("/sitemap.xml")).text();
    expect(index).toContain(`<sitemap><loc>${O}/sitemap-guides.xml</loc><lastmod>`);
  });

  it("name the guides in llms.txt", async () => {
    const llms = await html("/llms.txt");
    expect(llms).toContain(`${O}/guides:`);
    for (const g of GUIDES) expect(llms).toContain(`${O}${pathOf(g)}:`);
  });
});

describe("the frame", () => {
  it("links the index from the rail's Browse group and the footer, marked as the page on the guides", async () => {
    for (const path of ["/guides", pathOf(GUIDES[1])]) {
      const page = await html(path);
      const browse = /<div class="rail-group rail-browse">[\s\S]*?<\/div>/.exec(page)?.[0] ?? "";
      expect(browse, path).toContain('<a class="rail-item" href="/guides" aria-current="page"><span class="rail-label">Guides</span></a>');
      const footer = /<span class="footer-links">[\s\S]*?<\/span>/.exec(page)?.[0] ?? "";
      expect(footer, path).toContain('<a href="/methodology">Methodology</a><a href="/guides">Guides</a>');
    }
    // On any other page the item is there and not current.
    expect(await html("/tenders")).toContain('<a class="rail-item" href="/guides"><span class="rail-label">Guides</span></a>');
  });

  it("puts no account link and no Pro mark in a guide, signed out, with the accounts switch off and on", async () => {
    for (const path of ["/guides", ...GUIDES.map(pathOf)]) {
      for (const url of [path, fr(path)]) {
        const off = await html(url);
        expect(off, url).not.toContain("/account");
        expect(off, url).not.toContain("pro-tag");
        const on = await html(url, onEnv());
        expect(mainOf(on), url).not.toContain("/account");
        expect(mainOf(on), url).not.toContain("pro-tag");
        expect(mainOf(on), url).not.toContain('href="/pro"');
      }
    }
  });

  it("fits every table to its column from 700 px, and restacks it below", async () => {
    for (const g of GUIDES) {
      for (const url of [pathOf(g), fr(pathOf(g))]) {
        const page = await html(url);
        expectTablesFit(page, url);
        expect(page, url).toMatch(/<table class="restack cols"/);
      }
    }
  });
});

describe("the writing", () => {
  // The operator's list (docs/guides.md), as whole words.
  const BANNED = [
    "delve", "tapestry", "testament", "beacon", "underscore", "pivotal", "intricate", "nuanced", "multifaceted", "realm", "landscape", "robust",
    "seamless", "leverage", "utilize", "comprehensive", "holistic", "meticulous", "foster", "harness", "unlock", "elevate", "empower",
    "streamline", "cutting-edge", "game-changer", "paradigm", "navigate", "boasts", "vibrant", "crucially", "importantly", "notably",
    "genuinely", "arguably",
  ];
  const FRAME = allKeys().filter((k) => k === "nav.guides" || k.startsWith("guides."));
  const texts = (lang: "en" | "fr") => [
    ...ALL.map((p) => ({ where: p.where, s: filled(p, lang) })),
    ...FRAME.map((k) => ({ where: k, s: rawEntry(k)[lang] })),
  ];

  it("has no em-dash or en-dash in either language, the sources' titles included", () => {
    expect(FRAME.length).toBe(9);
    for (const s of GUIDES.flatMap((g) => g.sources)) {
      for (const title of [s.title, s.fr?.title ?? ""]) {
        expect(title, s.url).not.toContain(EM_DASH);
        expect(title, s.url).not.toContain(EN_DASH);
      }
    }
    for (const lang of ["en", "fr"] as const) {
      for (const { where, s } of texts(lang)) {
        expect(s, where).not.toContain(EM_DASH);
        expect(s, where).not.toContain(EN_DASH);
      }
    }
  });

  it("uses none of the banned words, no question, no signpost and no 'not this but that'", () => {
    for (const { where, s } of texts("en")) {
      for (const word of BANNED) expect(new RegExp(`\\b${word}`, "i").test(s), `${where}: ${word}`).toBe(false);
      expect(s, where).not.toContain("?");
      expect(s, where).not.toMatch(/worth noting|in this guide|this guide will|below we|let's|not only/i);
      expect(s, where).not.toMatch(/\bnot\b[^.;:]*\bbut\b/i);
    }
    for (const { where, s } of texts("fr")) expect(s, where).not.toContain("?");
  });

  it("writes French with straight apostrophes in the source and the dictionary's punctuation", () => {
    for (const { where, s } of texts("fr")) {
      expect(s, `${where}: straight apostrophes in the source`).not.toContain("’");
      expect(s, `${where}: no space before ; !`).not.toMatch(/\s[;!]/);
      // A colon takes a space before it, except inside a time or an address.
      expect(s.replace(/https?:\/\/\S+/g, ""), `${where}: a space before every colon`).not.toMatch(/[^ \d]:/);
      expect(s, `${where}: guillemets, not straight quotes`).not.toContain('"');
      expect(s, `${where}: a space inside guillemets`).not.toMatch(/«(?! )|(?<! )»/);
    }
  });

  it("keeps each guide's English between 600 and 1,000 words of running text", () => {
    for (const g of GUIDES) {
      const words = pieces(g)
        .filter((p) => !/ (title|publisher|action)$| column | row /.test(p.where) && !p.where.endsWith(" summary") && !p.where.endsWith(" seoTitle"))
        .map((p) => filled(p, "en").split(/\s+/).filter(Boolean).length)
        .reduce((a, b) => a + b, 0);
      expect(words, g.slug).toBeGreaterThanOrEqual(600);
      expect(words, g.slug).toBeLessThanOrEqual(1000);
    }
  });
});
