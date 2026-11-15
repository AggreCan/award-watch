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
import { referenceShard } from "../src/data";
import {
  EXAMPLE_ACAN, EXAMPLE_AWARD, EXAMPLE_BUY_CANADIAN, EXAMPLE_CYBER, EXAMPLE_DEBRIEF, EXAMPLE_EVALUATION, EXAMPLE_INTEGRITY, EXAMPLE_LIMITS, EXAMPLE_NOTICE,
  EXAMPLE_PROFILE, EXAMPLE_SBPP, EXAMPLE_SET_ASIDE,
  GUIDES,
  type Block, type Both, type Cell, type Guide, type Link, type Text,
} from "../src/guides";
import { allKeys, rawEntry } from "../src/i18n";
import { EXPIRING_TEASER_ROWS } from "../src/pages/expiring";
import { guideText } from "../src/pages/guides";
import { DESCRIPTION_MAX, TITLE_MAX } from "../src/seo";
import { routeTemplate } from "../src/views";
import { nextIp, onEnv, useAccountsDb } from "./accounts-helpers";
import sampleTenders from "../figures/tenders.json";
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
    // A figure's words (test/guide-figures.test.ts checks the rest of it), held to the same writing rules.
    if (b.kind === "figure") {
      out.push({ where: `${where} figure alt`, both: b.alt });
      out.push({ where: `${where} figure caption`, both: b.caption });
      b.callouts.forEach((c, n) => text(`${where} figure callout ${n}`, c.text));
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
// The example notices and award the guides link: a fixture's record under each live reference, in the shard
// that reference hashes to.
const exampleRecords: Record<string, unknown> = {};
beforeAll(async () => {
  const tender = (FILES["tenders/20a.json"] as Record<string, any>)["cb-100-10000001"];
  for (const reference of [EXAMPLE_NOTICE, EXAMPLE_ACAN, EXAMPLE_BUY_CANADIAN, EXAMPLE_EVALUATION, EXAMPLE_CYBER, EXAMPLE_INTEGRITY].map((p) => p.slice("/tenders/".length))) {
    const path = `tenders/${await referenceShard(reference)}.json`;
    exampleRecords[path] = { ...((exampleRecords[path] as object) ?? {}), [reference]: { ...structuredClone(tender), reference } };
  }
  const award = (FILES["contracts/637.json"] as Record<string, any>)["award:cb-400-40000004"];
  for (const awardRef of [EXAMPLE_AWARD, EXAMPLE_DEBRIEF, EXAMPLE_SBPP, EXAMPLE_LIMITS].map((p) => p.slice("/awards/".length))) {
    const path = `contracts/${await referenceShard(awardRef)}.json`;
    exampleRecords[path] = { ...((exampleRecords[path] as object) ?? {}), [`award:${awardRef}`]: { ...structuredClone(award), reference: awardRef } };
  }
});
const linkEnv = () =>
  testEnv(makeFakeAssets({}, {
    [`profiles/${shard}.json`]: exampleProfile, "instruments/index.json": INSTRUMENTS, ...deeperWindows, ...exampleRecords,
  }));

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
    // lists of contracts ending and the overview of them; the new notices, the award notices, an example
    // notice, ACAN and award, a notice stating a Buy Canadian policy, a request for proposal stating its selection
    // criteria, an award notice showing the dates and the trade agreements line the complaint rules turn on, an award notice
    // showing the category, value and trade agreements line the guide on the Small Business Procurement Program names, an award
    // notice showing a non-competitive method and a limited tendering reason; two National Defence requests for proposal
    // with their documents; and the guides that link one another.
    for (const want of ["/tenders", "/methodology#statuses", "/methodology#places", "/methodology#counting", "/instruments", "/data#sources",
      `${EXAMPLE_PROFILE}#awards`, `${EXAMPLE_PROFILE}#history`, `${EXAMPLE_PROFILE}#contracts`, `${EXAMPLE_PROFILE}#instruments`,
      "/tenders?type=Advance%20Contract%20Award%20Notice", "/methodology#competitive", "/methodology#expiring", EXAMPLE_SET_ASIDE,
      "/expiring", "/expiring/3m", "/expiring/6m", "/expiring/12m", "/tenders/new", "/awards", EXAMPLE_NOTICE, EXAMPLE_ACAN, EXAMPLE_AWARD,
      EXAMPLE_BUY_CANADIAN, EXAMPLE_EVALUATION, EXAMPLE_DEBRIEF, EXAMPLE_SBPP, EXAMPLE_LIMITS, EXAMPLE_CYBER, EXAMPLE_INTEGRITY, ...GUIDES.map(pathOf)]) {
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

  it("hold the evaluation guide's worked combined rating to its own arithmetic, in both languages", () => {
    // Clause A0027T's example as the guide's table gives it: 135 points available, a 60/40 ratio, each pricing score
    // the lowest evaluated price over the bid's, and the combined rating their sum, ranked.
    const g = GUIDES.find((x) => x.slug === "how-federal-bids-are-evaluated-and-selected")!;
    const table = g.sections.find((s) => s.id === "example")!.blocks.find((b) => b.kind === "table") as Extract<Block, { kind: "table" }>;
    const row = (label: string) => table.rows.find((r) => !("money" in r[0]) && r[0].en === label)!.slice(1);
    const words = (c: Cell) => c as Both;
    const prices = row("Bid evaluated price").map((c) => (c as { money: number }).money);
    const points = row("Overall technical score").map((c) => Number(words(c).en.split("/")[0]));
    const lowest = Math.min(...prices);
    const round = (n: number) => Math.round(n * 100) / 100;
    const technical = points.map((n) => round((n / 135) * 60));
    const pricing = prices.map((n) => round((lowest / n) * 40));
    const combined = technical.map((t, i) => round(t + pricing[i]));
    const fr = (n: number) => n.toFixed(2).replace(".", ",");
    expect(row("Technical merit score").map(words)).toEqual(points.map((n, i) => ({ en: `${n}/135 x 60 = ${technical[i].toFixed(2)}`, fr: `${n}/135 x 60 = ${fr(technical[i])}` })));
    expect(row("Pricing score").map(words)).toEqual(prices.map((n, i) => ({
      en: `${lowest / 1000}/${n / 1000} x 40 = ${pricing[i].toFixed(2)}`, fr: `${lowest / 1000}/${n / 1000} x 40 = ${fr(pricing[i])}`,
    })));
    expect(row("Combined rating").map(words)).toEqual(combined.map((n) => ({ en: n.toFixed(2), fr: fr(n) })));
    const order = [...combined].sort((a, b) => b - a);
    expect(row("Overall rating").map((c) => words(c).en)).toEqual(combined.map((n) => ["1st", "2nd", "3rd"][order.indexOf(n)]));
  });

  it("hold the debriefings guide's thresholds to the CFTA row of the trade guide's table, and place it right after the evaluation guide", () => {
    // Both guides state the CFTA thresholds of Contracting Policy Notice 2025-8 for departments and agencies; when the
    // notice is revised, the two change together.
    const trade = GUIDES.find((x) => x.slug === "trade-agreements-and-thresholds-on-federal-tenders")!;
    const table = trade.sections.find((s) => s.id === "thresholds")!.blocks.find((b) => b.kind === "table") as Extract<Block, { kind: "table" }>;
    const cfta = table.rows.find((r) => !("money" in r[0]) && r[0].en.startsWith("Canadian Free Trade Agreement"))!;
    const [goods, services, construction] = cfta.slice(1).map((c) => (c as { money: number }).money);
    expect(services).toBe(construction);
    const g = GUIDES.find((x) => x.slug === "debriefings-and-bid-challenges-on-federal-contracts")!;
    const text = (lang: "en" | "fr") => pieces(g).map((p) => filled(p, lang)).join("\n");
    const en = (n: number) => `$${n.toLocaleString("en-CA")}`;
    const fr = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} $`;
    expect(text("en")).toContain(`at ${en(goods)} for goods and ${en(services)} for services and construction`);
    expect(text("en")).toContain(`less than ${en(goods)} for goods or less than ${en(services)} for services`);
    expect(text("en")).toContain(`${en(goods)} and above for goods and ${en(services)} and above for services and construction`);
    expect(text("fr")).toContain(`à ${fr(goods)} pour les biens et à ${fr(services)} pour les services et la construction`);
    expect(text("fr")).toContain(`moins de ${fr(goods)} pour les biens ou moins de ${fr(services)} pour les services`);
    expect(GUIDES.indexOf(g)).toBe(GUIDES.findIndex((x) => x.slug === "how-federal-bids-are-evaluated-and-selected") + 1);
  });

  it("hold the small business guide's launch date to the Buy Canadian guide's table, place it right after that guide, and link the two", () => {
    // Both guides give the day PSPC launched the Small Business Procurement Program; when one changes, the other does.
    const bc = GUIDES.find((x) => x.slug === "buy-canadian-policy-on-federal-tenders")!;
    const table = bc.sections.find((s) => s.id === "instruments")!.blocks.find((b) => b.kind === "table") as Extract<Block, { kind: "table" }>;
    const row = table.rows.find((r) => !("money" in r[0]) && r[0].en === "Small Business Procurement Program")!;
    const launched = row[1] as Both;
    expect(launched).toEqual({ en: "Launched July 6, 2026", fr: "Lancé le 6 juillet 2026" });
    const g = GUIDES.find((x) => x.slug === "small-business-procurement-program-sbpp")!;
    const text = (lang: "en" | "fr") => pieces(g).map((p) => filled(p, lang)).join("\n");
    expect(text("en")).toContain(`on ${launched.en.slice("Launched ".length)}, Public Services and Procurement Canada (PSPC)`);
    expect(text("fr")).toContain(`le ${launched.fr.slice("Lancé le ".length)}, Services publics et Approvisionnement Canada (SPAC)`);
    expect(GUIDES.indexOf(g)).toBe(GUIDES.indexOf(bc) + 1);
    expect(internalLinks(bc)).toContain(pathOf(g));
    expect(internalLinks(g)).toContain(pathOf(bc));
    // It rests on the Treasury Board Secretariat's notice and cites the regulations its Tribunal sentences quote.
    expect(g.sources.map((s) => s.url)).toEqual(expect.arrayContaining([
      "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice/2026-4.html",
      "https://laws-lois.justice.gc.ca/eng/regulations/SOR-93-602/FullText.html",
    ]));
  });

  it("hold the guide on contracts without competition to the ACAN guide's section 6 amounts and the contract-end guide's day, and place it right after the ACAN guide", () => {
    const g = GUIDES.find((x) => x.slug === "federal-contracts-without-competition-and-contracting-limits")!;
    const acan = GUIDES.find((x) => x.slug === "advance-contract-award-notices-acan")!;
    const ending = GUIDES.find((x) => x.slug === "when-a-federal-contract-ends")!;
    // Both guides give the amounts of paragraph 6(b) of the Government Contracts Regulations; when the Regulations
    // change them, the two change together.
    const list = acan.sections.find((s) => s.id === "when")!.blocks.find((b) => b.kind === "list") as Extract<Block, { kind: "list" }>;
    const item = list.items.find((i) => i.en.includes("estimated expenditure"))!;
    const table = g.sections.find((s) => s.id === "exceptions")!.blocks.find((b) => b.kind === "table") as Extract<Block, { kind: "table" }>;
    const words = table.rows.find((r) => !("money" in r[0]) && r[0].en === "(b)")![1] as Both;
    for (const lang of ["en", "fr"] as const) {
      expect(new Set(figures(words[lang], lang)), lang).toEqual(new Set(figures(item[lang], lang)));
      expect(figures(words[lang], lang), lang).toEqual([25_000, 40_000, 100_000, 100_000]);
    }
    // Both give the day Contracting Policy Notice 2026-1 says the directive's limits were raised for inflation.
    const text = (x: Guide, lang: "en" | "fr") => pieces(x).map((p) => filled(p, lang)).join("\n");
    const en = /raised for inflation effective (\w+ \d{1,2}, \d{4})/.exec(text(ending, "en"))?.[1];
    const frDay = /avec effet le (\d{1,2} \S+ \d{4})/.exec(text(ending, "fr"))?.[1];
    expect([en, frDay]).toEqual(["December 15, 2025", "15 décembre 2025"]);
    expect(text(g, "en")).toContain(`amended, effective ${en}, to increase most contracting limits`);
    expect(text(g, "fr")).toContain(`le ${frDay}, la directive a été modifiée pour augmenter la plupart des limites contractuelles`);
    expect(GUIDES.indexOf(g)).toBe(GUIDES.indexOf(acan) + 1);
    expect(internalLinks(g)).toEqual(expect.arrayContaining([pathOf(acan), pathOf(ending), "/guides/trade-agreements-and-thresholds-on-federal-tenders"]));
    // It rests on the Regulations, the directive and the Treasury Board Secretariat's notices on the limits and on PSPC's authority.
    expect(g.sources.map((s) => s.url)).toEqual(expect.arrayContaining([
      "https://laws-lois.justice.gc.ca/eng/regulations/SOR-87-402/FullText.html",
      "https://www.tbs-sct.canada.ca/pol/doc-eng.aspx?id=32692",
      "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice/2026-1.html",
      "https://www.canada.ca/en/treasury-board-secretariat/services/policy-notice/2026-2.html",
      "https://open.canada.ca/data/recombinant-published-schema/contracts.json",
    ]));
  });

  it("place the cyber security certification guide right after the security guide, link the two both ways, and keep its dates with their pages", () => {
    const g = GUIDES.find((x) => x.slug === "cyber-security-certification-for-defence-suppliers-cpcsc")!;
    const security = GUIDES.find((x) => x.slug === "security-requirements-on-federal-contracts")!;
    expect(GUIDES.indexOf(g)).toBe(GUIDES.indexOf(security) + 1);
    expect(internalLinks(g)).toContain(pathOf(security));
    expect(internalLinks(security)).toContain(pathOf(g));
    expect(internalLinks(g)).toContain(EXAMPLE_CYBER);
    // The program is being phased in: every date in the phases table names the page that gives it, and that page is a source.
    const table = g.sections.find((s) => s.id === "phases")!.blocks.find((b) => b.kind === "table") as Extract<Block, { kind: "table" }>;
    expect(table.cols.map((c) => c.label.en)).toEqual(["When", "What the page says", "Page"]);
    for (const row of table.rows) expect((row[2] as Both).en, (row[0] as Both).en).toMatch(/^(Backgrounder|News release|Additional information), (modified )?\w+ \d{1,2}, \d{4}$/);
    // It rests on PSPC's pages on the program, its releases, the Cyber Centre's standard and PSPC's page on security requirements for
    // contracting, and the guide on security requirements cites that page for its link here.
    const urls = g.sources.map((s) => s.url);
    expect(urls).toEqual(expect.arrayContaining([
      "https://www.canada.ca/en/public-services-procurement/services/industrial-security/security-requirements-contracting/cyber-security-certification-defence-suppliers-canada/program-overview.html",
      "https://www.canada.ca/en/public-services-procurement/services/industrial-security/security-requirements-contracting/cyber-security-certification-defence-suppliers-canada/meet-level1-certification-requirements.html",
      "https://www.canada.ca/en/public-services-procurement/services/industrial-security/security-requirements-contracting/cyber-security-certification-defence-suppliers-canada/additional-information-support.html",
      "https://www.canada.ca/en/public-services-procurement/news/2026/04/canadian-program-for-cyber-security-certification-level-1.html",
      "https://www.cyber.gc.ca/en/guidance/protecting-specified-information-non-government-canada-systems-and-organizations-itsp10171",
      "https://www.canada.ca/en/public-services-procurement/services/industrial-security/security-requirements-contracting.html",
    ]));
    expect(security.sources.map((s) => s.url)).toContain("https://www.canada.ca/en/public-services-procurement/services/industrial-security/security-requirements-contracting.html");
  });

  it("place the supplier integrity guide right after the cyber security guide, link it both ways with the bidding guide, and keep the policy's grounds and periods", () => {
    const g = GUIDES.find((x) => x.slug === "supplier-integrity-ineligibility-and-suspension-policy")!;
    const cyber = GUIDES.find((x) => x.slug === "cyber-security-certification-for-defence-suppliers-cpcsc")!;
    const bid = GUIDES.find((x) => x.slug === "how-to-bid-on-government-of-canada-contracts")!;
    expect(GUIDES.indexOf(g)).toBe(GUIDES.indexOf(cyber) + 1);
    expect(internalLinks(g)).toContain(pathOf(bid));
    expect(internalLinks(bid)).toContain(pathOf(g));
    expect(internalLinks(g)).toContain(EXAMPLE_INTEGRITY);
    // Appendix 2's thirteen paragraphs, (1)(a) to (1)(m), each in the policy's words.
    const grounds = g.sections.find((s) => s.id === "grounds")!.blocks.find((b) => b.kind === "table") as Extract<Block, { kind: "table" }>;
    expect(grounds.rows.map((r) => (r[0] as Both).en)).toEqual([..."abcdefghijklm"].map((l) => `(1)(${l})`));
    // The English and French texts of paragraph (1)(d) give different periods; both languages say so.
    const d = grounds.rows[3][1] as Both;
    expect(d.en).toContain("within 1 business day");
    expect(d.en).toContain("the French text of the policy gives 5 business days");
    expect(d.fr).toContain("dans un délai de 5 jours ouvrables");
    expect(d.fr).toContain("le texte anglais de la politique indique 1 jour ouvrable");
    // The periods, each with the event it runs from, in the comparison.
    const compared = g.sections.find((s) => s.id === "compared")!.blocks.find((b) => b.kind === "table") as Extract<Block, { kind: "table" }>;
    const period = compared.rows.find((r) => (r[0] as Both).en === "Period")!;
    expect((period[1] as Both).en).toContain("no more than 10 years from the date the Notice of Ineligibility is delivered");
    expect((period[2] as Both).en).toContain("18 months following such notice, which can be longer if a legal process is underway");
    // It rests on the policy and OSIC's pages, read in both languages, and the two data descriptions.
    expect(g.sources.every((s) => s.fr)).toBe(true);
    expect(g.sources.map((s) => s.url)).toEqual(expect.arrayContaining([
      "https://www.canada.ca/en/public-services-procurement/services/standards-oversight/supplier-integrity-compliance/policy-directives/ineligibility-suspension-policy.html",
      "https://www.canada.ca/en/public-services-procurement/services/standards-oversight/supplier-integrity-compliance.html",
      "https://www.canada.ca/en/public-services-procurement/services/standards-oversight/supplier-integrity-compliance/ineligibility-suspension-clauses/procurement-contracts.html",
      "https://www.canada.ca/en/public-services-procurement/services/standards-oversight/supplier-integrity-compliance/supplier-guidance/application-subcontractor.html",
      "https://www.canada.ca/en/public-services-procurement/services/standards-oversight/supplier-integrity-compliance/ineligible-suspended-suppliers.html",
      "https://donnees-data.tpsgc-pwgsc.gc.ca/ba2/ac-cb/achatscanada-canadabuys-dd.xml",
      "https://open.canada.ca/data/recombinant-published-schema/contracts.json",
    ]));
  });

  it("name no organization but government bodies in the supplier integrity guide: its text, tables, figure, sources and sample record", () => {
    const g = GUIDES.find((x) => x.slug === "supplier-integrity-ineligibility-and-suspension-policy")!;
    // A company's legal suffix, as a word: none appears anywhere in the guide or in the sample its figure is drawn from.
    const SUFFIX = /\b(?:Inc|Ltd|Ltée|Corp|LLP|Limited)\b/;
    const figure = g.sections.flatMap((s) => s.blocks).find((b) => b.kind === "figure") as Extract<Block, { kind: "figure" }>;
    const sample = (sampleTenders as Record<string, unknown>)[figure.shot.page.slice("/tenders/".length)];
    expect(sample).toBeDefined();
    const strings = [
      ...pieces(g).flatMap((p) => [filled(p, "en"), filled(p, "fr")]),
      ...g.sources.flatMap((s) => [s.title, s.fr?.title ?? ""]),
      g.action!.text.en, g.action!.text.fr,
      JSON.stringify(sample),
    ];
    expect(strings.length).toBeGreaterThan(100);
    for (const s of strings) expect(SUFFIX.test(s), s).toBe(false);
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
    // The tenth is the line that ends every figure's caption (guides.figure_sample).
    expect(FRAME.length).toBe(10);
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
      // A figure's alt text, caption and legend describe the picture; they are not the guide's running text.
      const words = pieces(g)
        .filter((p) => !/ (title|publisher|action)$| column | row | figure /.test(p.where) && !p.where.endsWith(" summary") && !p.where.endsWith(" seoTitle"))
        .map((p) => filled(p, "en").split(/\s+/).filter(Boolean).length)
        .reduce((a, b) => a + b, 0);
      expect(words, g.slug).toBeGreaterThanOrEqual(600);
      expect(words, g.slug).toBeLessThanOrEqual(1000);
    }
  });
});
