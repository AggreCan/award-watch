// The line of guides on the record and list pages (src/guide_links.tsx,
// docs/guides.md, Where the section is linked): each kind of page's rule,
// called directly over every case it reads, and held to the guides it may
// name; the notice types read the way the tender list's own type filter
// reads them, the filter the guides' email lists save; the line as each page
// draws it, in both languages, where it sits, each guide linked once on the
// page; no line where there is no record; and the pages it stays off. The
// published contract's page is in test/source-fields.test.ts and a standing
// offer's page in test/instruments.test.ts, where their records are seeded.
import { describe, expect, it } from "vitest";
import type { ContractDetail, TenderDetail, TenderRow } from "../src/data";
import {
  ACAN, BID, DEBRIEF, ENDING, GuideLine, LIMITS, MAX_GUIDES, PSIB, READING, SOSA, THREE, TRADE, awardListGuides, contractGuides,
  instrumentGuides, publishedGuides, radarGuides, tenderGuides, tenderListGuides,
} from "../src/guide_links";
import * as guides from "../src/guides";
import { ACAN_TYPE, GUIDES, GUIDE_SLUGS, RFSA_TYPE, RFSO_TYPE, guideBySlug } from "../src/guides";
import { app } from "../src/index";
import { guideText } from "../src/pages/guides";
import { filterTenders, readTenderQuery } from "../src/pages/tenders";
import { decode, get, nbsp, onEnv, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets, testClock, testEnv } from "./assets";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const TODAY = "2026-10-31";

// -- the rules ----------------------------------------------------------------------------

const TYPES = [ACAN_TYPE, RFSO_TYPE, RFSA_TYPE, "Request for Proposal", "RFP against Supply Arrangement", "advance contract award notice", null];
const LISTS: (string[] | null)[] = [null, [], ["Canadian Free Trade Agreement (CFTA)"]];
const COMPETITIVE = [true, false, 1, 0, null] as const;
const ENDS = [null, "2026-10-30", TODAY, `${TODAY}T23:59:00`, "2027-03-31", "not a date"];

// Every result a rule can give, over every case it reads.
function everyResult(): string[][] {
  const out: string[][] = [];
  for (const type of TYPES) for (const en of LISTS) for (const fr of LISTS) {
    out.push(tenderGuides({ notice_type_en: type, trade_agreements_en: en, trade_agreements_fr: fr }));
  }
  for (const kind of ["award", "history"] as const) for (const competitive of COMPETITIVE) for (const end of ENDS) {
    out.push(contractGuides(kind, { competitive, end }, TODAY));
  }
  for (const competitive of COMPETITIVE) for (const exception of [null, "4"]) for (const psib of [null, "MS", "VS"]) for (const end of ENDS) {
    out.push(publishedGuides({ competitive, exception, psib, end }, TODAY));
  }
  out.push(radarGuides(), instrumentGuides(), tenderListGuides(), awardListGuides());
  return out;
}

describe("the rules", () => {
  it("name one to three guides each, no guide twice, every one a guide the index lists", () => {
    const results = everyResult();
    expect(results.length).toBeGreaterThan(150);
    for (const r of results) {
      expect(r.length, r.join()).toBeGreaterThanOrEqual(1);
      expect(r.length, r.join()).toBeLessThanOrEqual(MAX_GUIDES);
      expect(new Set(r).size, r.join()).toBe(r.length);
      for (const slug of r) expect(GUIDE_SLUGS.has(slug), slug).toBe(true);
    }
    for (const slug of [ACAN, BID, DEBRIEF, ENDING, LIMITS, PSIB, READING, SOSA, THREE, TRADE]) expect(GUIDE_SLUGS.has(slug), slug).toBe(true);
  });

  it("address the guides by the constants src/guides.ts exports, one for every guide", () => {
    const paths = Object.entries(guides).filter(([name]) => name.endsWith("_PATH")).map(([, v]) => v as string);
    for (const p of paths) {
      expect(p, p).toMatch(/^\/guides\/[a-z0-9-]+$/);
      expect(GUIDE_SLUGS.has(guides.slugOf(p)), p).toBe(true);
    }
    expect(new Set(paths.map(guides.slugOf))).toEqual(GUIDE_SLUGS);
  });

  it("give a tender notice its type's guide, then reading and bidding, then trade agreements while there is room", () => {
    const notice = (type: string | null, en: string[] | null = null, fr: string[] | null = null) =>
      tenderGuides({ notice_type_en: type, trade_agreements_en: en, trade_agreements_fr: fr });
    const cfta = ["Canadian Free Trade Agreement (CFTA)"];
    expect(notice(ACAN_TYPE)).toEqual([ACAN, READING, BID]);
    expect(notice(ACAN_TYPE, cfta)).toEqual([ACAN, READING, BID]);
    expect(notice(RFSO_TYPE, cfta)).toEqual([SOSA, READING, BID]);
    expect(notice(RFSA_TYPE)).toEqual([SOSA, READING, BID]);
    expect(notice("Request for Proposal", cfta)).toEqual([READING, BID, TRADE]);
    // The French list stands in for an empty English one, as on the page.
    expect(notice("Request for Proposal", [], ["Accord de libre-échange canadien (ALEC)"])).toEqual([READING, BID, TRADE]);
    expect(notice("Request for Proposal", [], [])).toEqual([READING, BID]);
    expect(notice(null)).toEqual([READING, BID]);
    // An arrangement's own notices are not requests for one.
    expect(notice("RFP against Supply Arrangement")).toEqual([READING, BID]);
  });

  it("read a notice's type exactly as the tender list's type filter, the one the ACAN and standing offers guides save", () => {
    const base = (FILES["tenders/open.json"] as TenderRow[])[0];
    const listOf = (type: string) => readTenderQuery(new URL(`https://awardwatch.ca/tenders?type=${encodeURIComponent(type)}`));
    // The ACAN guide saves its type's list; the standing offers guide the requests for standing offers, and its
    // rule takes the requests for supply arrangements too, each read by the list's filter of that type.
    for (const [slug, types] of [[ACAN, [ACAN_TYPE]], [SOSA, [RFSO_TYPE, RFSA_TYPE]]] as const) {
      const saved = readTenderQuery(new URL(`https://awardwatch.ca${guideBySlug(slug)!.action!.list.path}`));
      expect(types as readonly string[], slug).toContain(saved.type);
      for (const t of TYPES) {
        const row = { ...base, notice_type_en: t };
        const listed = types.some((type) => filterTenders([row], listOf(type), testClock).length === 1);
        expect(tenderGuides({ ...row, trade_agreements_en: null, trade_agreements_fr: null })[0] === slug, `${slug} ${t}`).toBe(listed);
      }
    }
  });

  it("give an award notice and a contract history record the limits guide by the competitive flag, then their own guides", () => {
    expect(contractGuides("award", { competitive: 1, end: "2029-09-30" }, TODAY)).toEqual([THREE, DEBRIEF]);
    expect(contractGuides("award", { competitive: 0, end: null }, TODAY)).toEqual([LIMITS, THREE, DEBRIEF]);
    expect(contractGuides("award", { competitive: false, end: "2020-01-01" }, TODAY)).toEqual([LIMITS, THREE, DEBRIEF]);
    // Unstated is not non-competitive.
    expect(contractGuides("award", { competitive: null, end: null }, TODAY)).toEqual([THREE, DEBRIEF]);
    expect(contractGuides("history", { competitive: 0, end: "2026-03-31" }, TODAY)).toEqual([LIMITS, THREE]);
    expect(contractGuides("history", { competitive: 0, end: "2027-03-31" }, TODAY)).toEqual([LIMITS, THREE, ENDING]);
    expect(contractGuides("history", { competitive: 1, end: TODAY }, TODAY)).toEqual([THREE, ENDING]);
    expect(contractGuides("history", { competitive: 1, end: `${TODAY}T00:00:00` }, TODAY)).toEqual([THREE, ENDING]);
    expect(contractGuides("history", { competitive: 1, end: "2026-10-30" }, TODAY)).toEqual([THREE]);
    expect(contractGuides("history", { competitive: 1, end: null }, TODAY)).toEqual([THREE]);
    expect(contractGuides("history", { competitive: 1, end: "soon" }, TODAY)).toEqual([THREE]);
  });

  it("give a published contract the limits guide only while its exception's note does not link it, then set-asides, three records and the end", () => {
    const pub = (competitive: 0 | 1 | null, exception: string | null, psib: string | null, end: string | null) =>
      publishedGuides({ competitive, exception, psib, end }, TODAY);
    expect(pub(0, null, null, "2027-03-31")).toEqual([LIMITS, THREE, ENDING]);
    expect(pub(0, "4", null, "2027-03-31")).toEqual([THREE, ENDING]);
    expect(pub(0, "7", "MS", "2027-03-31")).toEqual([PSIB, THREE, ENDING]);
    expect(pub(0, null, "MS", "2027-03-31")).toEqual([LIMITS, PSIB, THREE]);
    expect(pub(1, null, "VS", "2027-03-31")).toEqual([PSIB, THREE, ENDING]);
    expect(pub(1, null, null, "2027-03-31")).toEqual([THREE, ENDING]);
    expect(pub(1, null, null, "2026-03-31")).toEqual([THREE]);
    expect(pub(null, null, null, null)).toEqual([THREE]);
  });

  it("give the radar, a standing offer and the lists their fixed guides", () => {
    expect(radarGuides()).toEqual([ENDING, THREE]);
    expect(instrumentGuides()).toEqual([SOSA]);
    expect(tenderListGuides()).toEqual([READING, BID]);
    expect(awardListGuides()).toEqual([THREE, DEBRIEF]);
  });

  it("draw the line from the guides alone, with no request, binding or file", async () => {
    // The component is handed the language and the slugs, and nothing else: it cannot read a file or a database.
    const draw = async (lang: "en" | "fr", slugs: string[]) => String((await GuideLine({ lang, slugs })) ?? "");
    expect(nbsp(await draw("fr", [READING, BID]))).toBe(
      `<p class="page-foot-note">Guides : <a href="/guides/${READING}">${nbsp(guideText("fr", guideBySlug(READING)!.title))}</a> · ` +
      `<a href="/guides/${BID}">${nbsp(guideText("fr", guideBySlug(BID)!.title))}</a></p>`,
    );
    // The dot keeps to the title before it: a no-break space before it, a plain one after.
    expect(await draw("en", [THREE, DEBRIEF])).toContain("</a> · <a");
    expect(await draw("en", [])).toBe("");
    expect(await draw("en", ["no-such-guide"])).toBe("");
  });
});

// -- the pages ----------------------------------------------------------------------------

let address = 0;
const read = async (path: string, e: object = testEnv()) => {
  const res = await app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.40.${(address++ % 250) + 1}` } }, e as never);
  return { status: res.status, html: decode(nbsp(await res.text())) };
};

// The line on a page: where it starts, the guides it links and their words; null without one. A page has one at most.
function lineOf(html: string): { at: number; end: number; slugs: string[]; titles: string[]; text: string } | null {
  const found = [...html.matchAll(/<p class="page-foot-note">Guides ?: ((?:(?!<\/p>)[\s\S])*)<\/p>/g)];
  expect(found.length).toBeLessThanOrEqual(1);
  const m = found[0];
  if (!m) return null;
  const links = [...m[1].matchAll(/<a href="\/guides\/([a-z0-9-]+)">([^<]+)<\/a>/g)];
  // The links and the dots between them, nothing else.
  expect(m[1].replace(/<a href="\/guides\/[a-z0-9-]+">[^<]+<\/a>/g, "L")).toBe(links.map(() => "L").join(" · "));
  return { at: m.index!, end: m.index! + m[0].length, slugs: links.map((l) => l[1]), titles: links.map((l) => l[2]), text: m[0] };
}

// The line holds the guides given, by the titles the index shows, and each is linked nowhere else on the page.
function expectLine(html: string, lang: "en" | "fr", slugs: string[], label: string) {
  const line = lineOf(html);
  expect(line, label).not.toBeNull();
  expect(line!.slugs, label).toEqual(slugs);
  expect(line!.titles, label).toEqual(slugs.map((s) => nbsp(guideText(lang, guideBySlug(s)!.title))));
  for (const s of slugs) expect(html.split(`href="/guides/${s}`).length - 1, `${label} ${s}`).toBe(1);
  expect(line!.text, label).not.toContain(EM_DASH);
  expect(line!.text, label).not.toContain(EN_DASH);
  // Nothing in it keeps words together but the dot after a title, so it wraps at any width.
  expect(line!.text, label).not.toMatch(/class="[^"]*\bnw\b/);
  return line!;
}

const withLang = (path: string, lang: "en" | "fr") => (lang === "en" ? path : `${path}${path.includes("?") ? "&" : "?"}lang=fr`);
const LANGS = ["en", "fr"] as const;

// A fixture's detail record changed: the tender shard, or the contracts shard keyed "<kind>:<reference>".
const tenderWith = (ref: string, change: Partial<TenderDetail>) => {
  const shard = structuredClone(FILES["tenders/20a.json"]) as Record<string, TenderDetail>;
  shard[ref] = { ...shard[ref], ...change };
  return testEnv(makeFakeAssets({}, { "tenders/20a.json": shard }));
};
const contractWith = (key: string, change: Partial<ContractDetail>) => {
  const shard = structuredClone(FILES["contracts/637.json"]) as Record<string, ContractDetail>;
  shard[key] = { ...shard[key], ...change };
  return testEnv(makeFakeAssets({}, { "contracts/637.json": shard }));
};

describe("a record's page", () => {
  it("ends a tender notice on its guides, after the last panel and before the provenance line, in both languages", async () => {
    for (const lang of LANGS) {
      const { html } = await read(withLang("/tenders/cb-100-10000001", lang));
      const line = expectLine(html, lang, [READING, BID, TRADE], lang);
      // After every panel; the provenance line next.
      expect(html.lastIndexOf('class="panel')).toBeLessThan(line.at);
      expect(html.slice(line.end).trimStart()).toMatch(/^<p class="page-foot-note">/);
      expectLine((await read(withLang("/tenders/cb-200-20005019", lang))).html, lang, [READING, BID], `${lang} no agreement`);
    }
  });

  it("names the notice's type first: an ACAN, or a request for standing offer or supply arrangement", async () => {
    const cfta = { trade_agreements_en: ["Canadian Free Trade Agreement (CFTA)"], trade_agreements_fr: ["Accord de libre-échange canadien (ALEC)"] };
    for (const [type, fr, first] of [
      [ACAN_TYPE, "Préavis d'adjudication de contrat", ACAN], [RFSO_TYPE, "Demande d'offre à commandes", SOSA],
      [RFSA_TYPE, "Demande d'arrangement en matière d'approvisionnement", SOSA],
    ] as const) {
      const e = tenderWith("cb-200-20005019", { notice_type_en: type, notice_type_fr: fr, ...cfta });
      for (const lang of LANGS) expectLine((await read(withLang("/tenders/cb-200-20005019", lang), e)).html, lang, [first, READING, BID], `${type} ${lang}`);
    }
  });

  it("ends an award notice and a contract history record on theirs, by the flag the page shows and the end date", async () => {
    for (const lang of LANGS) {
      const award = (await read(withLang("/awards/cb-400-40000004", lang))).html;
      const line = expectLine(award, lang, [THREE, DEBRIEF], `award ${lang}`);
      expect(award.lastIndexOf('class="panel')).toBeLessThan(line.at);
      expect(award.slice(line.end).trimStart()).toMatch(/^<p class="page-foot-note">/);
      // Non-competitive, ended before the data date.
      expectLine((await read(withLang("/history/w8472-000633", lang))).html, lang, [LIMITS, THREE], `history ${lang}`);
    }
    expectLine((await read("/awards/cb-400-40000004", contractWith("award:cb-400-40000004", { competitive: 0 }))).html, "en",
      [LIMITS, THREE, DEBRIEF], "non-competitive award");
    expectLine((await read("/history/w8472-000633", contractWith("history:W8472-000633", { end: "2026-10-31" }))).html, "en",
      [LIMITS, THREE, ENDING], "history ending on the data date");
    expectLine((await read("/history/w8472-000633", contractWith("history:W8472-000633", { competitive: 1, end: "2027-06-30" }))).html, "en",
      [THREE, ENDING], "history ending after it");
  });

  it("draws no line where there is no record", async () => {
    for (const path of ["/tenders/cb-999-99999999", "/awards/cb-999-99999999", "/history/w9999-999999", "/expiring/9m"]) {
      const { status, html } = await read(path);
      expect(status, path).toBe(404);
      expect(lineOf(html), path).toBeNull();
    }
    // No data published yet, and the records database absent, loading or failing.
    const noStats = testEnv(makeFakeAssets({}, { "stats.json": undefined }));
    for (const path of ["/tenders/cb-100-10000001", "/awards/cb-400-40000004", "/expiring", "/tenders", "/awards"]) {
      const { status, html } = await read(path, noStats);
      expect(status, path).toBe(503);
      expect(lineOf(html), path).toBeNull();
    }
    for (const path of ["/contracts/dfo-mpo/C-2026-2027-Q1-00001", "/instruments/E60ZT-120002%2F001%2FZT"]) {
      const { status, html } = await read(path, { ...testEnv(), RECORDS: undefined });
      expect(status, path).toBe(503);
      expect(lineOf(html), path).toBeNull();
    }
  });
});

describe("the radar and the lists", () => {
  // The 12-month window as the 3-month one, so its full list and its free view have rows.
  const deep = {
    "expiring/12m/index.json": { ...(FILES["expiring/3m/index.json"] as object), window: "12m" },
    "expiring/12m/1.json": FILES["expiring/3m/1.json"],
  };

  it("end every view of the radar that lists contracts on its guides: the overview, a window, a filtered window, the free view", async () => {
    for (const lang of LANGS) {
      const overview = (await read(withLang("/expiring", lang))).html;
      const line = expectLine(overview, lang, [ENDING, THREE], `overview ${lang}`);
      expect(overview.lastIndexOf('class="panel')).toBeLessThan(line.at);
      for (const path of ["/expiring/3m", "/expiring/3m?segment=81", "/expiring/12m"]) {
        const html = (await read(withLang(path, lang), testEnv(makeFakeAssets({}, deep)))).html;
        const at = expectLine(html, lang, [ENDING, THREE], `${path} ${lang}`).at;
        // Under the list and its pager, before the email list.
        expect(html.indexOf('id="radar-pager"'), path).toBeLessThan(at);
        expect(html.indexOf('<section class="panel interest"'), path).toBeGreaterThan(at);
      }
      // The free view of a deep window once the switch is on: under its first rows, before what Pro adds.
      const teaser = await get(withLang("/expiring/12m", lang), { env: onEnv({ ASSETS: makeFakeAssets({}, deep) }) });
      expect(teaser.status).toBe(200);
      const html = decode(nbsp(await teaser.text()));
      expect(html).toContain('<section class="panel pro-panel"');
      const at = expectLine(html, lang, [ENDING, THREE], `free view ${lang}`).at;
      expect(html.indexOf('<section class="panel pro-panel"')).toBeGreaterThan(at);
    }
  });

  it("end the tender lists and the newest awards on theirs, under the list and its pager", async () => {
    for (const lang of LANGS) {
      for (const path of ["/tenders", "/tenders?type=Request%20for%20Proposal", "/tenders?q=nothing-matches-this"]) {
        const html = (await read(withLang(path, lang))).html;
        const at = expectLine(html, lang, [READING, BID], `${path} ${lang}`).at;
        expect(html.indexOf('id="tender-pager"'), path).toBeLessThan(at);
        expect(html.indexOf('id="tender-detail"'), path).toBeLessThan(at);
        expect(html.indexOf('<section class="panel interest"'), path).toBeGreaterThan(at);
      }
      const day = (await read(withLang("/tenders/new", lang))).html;
      expect(day.lastIndexOf('class="panel')).toBeLessThan(expectLine(day, lang, [READING, BID], `new ${lang}`).at);
      const awards = (await read(withLang("/awards", lang))).html;
      const at = expectLine(awards, lang, [THREE, DEBRIEF], `awards ${lang}`).at;
      expect(awards.lastIndexOf('class="pagination"')).toBeLessThan(at);
      expect(awards.lastIndexOf('class="panel')).toBeLessThan(at);
    }
  });

  it("stays off the pages it was not made for", async () => {
    for (const path of [
      "/organizations/org-a000000001", "/buyers/pwgsc-tpsgc", "/guides", `/guides/${GUIDES[0].slug}`, "/awards/2026", "/tenders/same-day",
      "/segments/82", "/methodology",
    ]) {
      expect(lineOf((await read(path)).html), path).toBeNull();
    }
    // The landing page, as a reader without a session gets it at "/".
    expect(lineOf((await read("/")).html)).toBeNull();
  });
});
