// Sorting a table by its head (public/sort.js, src/columns.tsx): the key the
// script reads from each cell, in both languages and as the site's own
// formatters print it; the order, empty cells last either way; the three
// states a head cycles through; the markup a page carries for it (a button
// on a table whole on its page, a link the server answers on a table that
// runs past it, nothing on the other heads there); the words in the page's
// language; and the rows the phone pager folds after a sort.
import { describe, expect, it } from "vitest";
import pagerJs from "../public/pager.js?raw";
import sortJs from "../public/sort.js?raw";
import tendersJs from "../public/tenders.js?raw";
import { headOrder, sortKey, sortOrder } from "../public/sort.js";
import { clientTable, headSort } from "../src/columns";
import { closingText } from "../src/closing";
import { fmtInt, fmtMoney, fmtMoneyShort, fmtPct, t } from "../src/i18n";
import { app } from "../src/index";
import { sortWords } from "../src/layout";
import { AWARD_ORDERS, orderAwards } from "../src/pages/awards";
import { RADAR_ORDERS, growthPct, orderExpiring, readExpiringQuery } from "../src/pages/expiring";
import { shareText, tenderColumns } from "../src/pages/shared";
import { TENDER_ORDERS } from "../src/pages/tenders";
import { RECORDS_ORDERS } from "../src/pages/records";
import { INSTRUMENT_ORDERS } from "../src/instruments";
import type { AwardRow, ExpiringRow } from "../src/data";
import { testEnv } from "./assets";
import page1 from "./fixtures/expiring-3m-1.json";
import recent from "./fixtures/awards-recent.json";

let address = 0;
const get = (path: string) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.40.${(address++ % 250) + 1}` } }, testEnv());
const text = async (path: string) => (await get(path)).text();
const EM_DASH = String.fromCharCode(0x2014);
const BUTTON = (label: string) => `<button type="button" class="th-sort">${label}</button>`;
// The head row of the first table after a marker.
const headRow = (html: string, marker = "<main") => html.slice(html.indexOf(marker)).match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1] ?? "";
const tableTag = (html: string, marker = "<main") => html.slice(html.indexOf(marker)).match(/<table[^>]*>/)?.[0] ?? "";

describe("a cell's key", () => {
  it("reads money as the site prints it, in English and French, whole, with cents and in a tile's short form", () => {
    for (const lang of ["en", "fr"] as const) {
      for (const v of [13_044_299, 13_044_299_191, 950, 12.5, 0]) expect(sortKey(fmtMoney(v, lang), "num", lang), `${lang} ${v}`).toBe(v);
      expect(sortKey(fmtMoney(-1_234, lang), "num", lang), lang).toBe(-1_234);
      // A tile's short form is the amount to a tenth of its unit.
      for (const v of [4_500_000, 1_200_000_000, 312_500]) expect(sortKey(fmtMoneyShort(v, lang), "num", lang), `${lang} short ${v}`).toBeCloseTo(v, -1);
    }
    expect(sortKey("$13,044,299", "num", "en")).toBe(13_044_299);
    expect(sortKey("13 044 299 $", "num", "fr")).toBe(13_044_299);
    expect(sortKey("13 044 299 $", "num", "fr")).toBe(13_044_299);
    expect(sortKey("$4.5M", "num", "en")).toBe(4_500_000);
    expect(sortKey("4,5 M$", "num", "fr")).toBe(4_500_000);
    expect(sortKey("$1.2B", "num", "en")).toBe(1_200_000_000);
    expect(sortKey("1,2 G$", "num", "fr")).toBe(1_200_000_000);
    expect(sortKey("US$1,234", "num", "en")).toBe(1_234);
  });

  it("reads counts with their separators, a percentage, under one percent, a signed change and a share", () => {
    for (const lang of ["en", "fr"] as const) {
      expect(sortKey(fmtInt(1_234_567, lang), "num", lang), lang).toBe(1_234_567);
      expect(sortKey(fmtPct(1, 4, lang), "num", lang), lang).toBe(25);
      expect(sortKey(fmtPct(1, 1000, lang), "num", lang), `${lang} <1`).toBe(0.5);
      expect(sortKey(growthPct(lang, 0.25), "num", lang), lang).toBe(25);
      expect(sortKey(growthPct(lang, -0.1), "num", lang), lang).toBe(-10);
      expect(sortKey(growthPct(lang, -0.002), "num", lang), lang).toBe(-0.5);
      expect(sortKey(shareText(lang, 3, 12, (v) => fmtInt(v, lang)), "share", lang), lang).toBe(25);
      expect(sortKey(shareText(lang, 1, 1000, (v) => fmtInt(v, lang)), "share", lang), lang).toBe(0.5);
      expect(sortKey(shareText(lang, 3, null, (v) => fmtInt(v, lang)), "share", lang), `${lang} no whole`).toBeNull();
    }
    expect(sortKey("<1%", "num", "en")).toBe(0.5);
    expect(sortKey("< 1 %", "num", "fr")).toBe(0.5);
    expect(sortKey("3 of 60 (5%)", "share", "en")).toBe(5);
    expect(sortKey("3 sur 60 (5 %)", "share", "fr")).toBe(5);
    expect(sortKey("12, 3 withheld", "num", "en")).toBe(12);
    expect(sortKey("12, dont 3 retirés", "num", "fr")).toBe(12);
    // A zero among counts is printed as a muted 0 (pages/shared.tsx Count).
    expect(sortKey("0", "num", "en")).toBe(0);
  });

  it("reads a date, a date and time in either language, a year and a fiscal year", () => {
    expect(sortKey("2026-10-31", "date", "en")).toBe("2026-10-31");
    expect(sortKey(`${closingText("2026-11-26T14:00:00", "en")} Closing soon`, "date", "en")).toBe("2026-11-26 14:00");
    expect(sortKey(closingText("2026-11-26T14:00:00", "fr"), "date", "fr")).toBe("2026-11-26 14:00");
    expect(sortKey("2026-11-26 9:05", "date", "en")).toBe("2026-11-26 09:05");
    expect(sortKey("2026-11-04T19:00:00Z", "date", "en")).toBe("2026-11-04 19:00");
    expect(sortKey("2026", "date", "en")).toBe("2026");
    expect(sortKey("2025-26", "date", "en")).toBe("2025-26");
    expect(sortKey("2026-12-31 (45 days left)", "date", "en")).toBe("2026-12-31");
    // Ascending: the year before its days, a day before its times.
    const keys = ["2026-11-26 14:00", "2026", "2026-11-26", "2025-26"];
    expect(sortOrder(keys, "asc", "date", "en").map((i) => keys[i])).toEqual(["2025-26", "2026", "2026-11-26", "2026-11-26 14:00"]);
  });

  it("is empty for an empty cell and one with nothing of its kind to read", () => {
    for (const kind of ["num", "share", "date", "text"] as const) expect(sortKey("   ", kind, "en"), kind).toBeNull();
    expect(sortKey(t("en", "common.not_stated"), "num", "en")).toBeNull();
    expect(sortKey(t("fr", "common.not_stated"), "date", "fr")).toBeNull();
    expect(sortKey(t("fr", "common.not_applicable"), "share", "fr")).toBeNull();
    expect(sortKey("  Éclair  au   chocolat ", "text", "fr")).toBe("Éclair au chocolat");
  });
});

describe("the order", () => {
  it("sorts figures up and down, ties in the order they came, empty cells last either way", () => {
    const keys = [3, null, 1, 2, null, 1];
    expect(sortOrder(keys, "asc", "num", "en")).toEqual([2, 5, 3, 0, 1, 4]);
    expect(sortOrder(keys, "desc", "num", "en")).toEqual([0, 3, 2, 5, 1, 4]);
  });

  it("sorts text in the page's language with accents folded and numbers read as numbers", () => {
    const names = ["Zèbre", "école", "Eau", "Ébène", "apple", "Lot 10", "Lot 9"];
    const asc = sortOrder(names, "asc", "text", "fr").map((i) => names[i]);
    expect(asc).toEqual(["apple", "Eau", "Ébène", "école", "Lot 9", "Lot 10", "Zèbre"]);
    expect(sortOrder(names, "desc", "text", "fr").map((i) => names[i])).toEqual([...asc].reverse());
  });

  it("cycles a head through ascending, descending and the list's own order", () => {
    const orders = [["a-asc", "a", "asc"], ["a", "a", "desc"], ["b", "b", "asc"], ["b-desc", "b", "desc"]] as const;
    expect(headOrder(orders, "", "a")).toEqual({ state: null, next: "a-asc" });
    expect(headOrder(orders, "a-asc", "a")).toEqual({ state: "ascending", next: "a" });
    expect(headOrder(orders, "a", "a")).toEqual({ state: "descending", next: "" });
    // Another column's order leaves this one at none, and a click starts it ascending.
    expect(headOrder(orders, "b-desc", "a")).toEqual({ state: null, next: "a-asc" });
    expect(headOrder(orders, "b-desc", "b", "own")).toEqual({ state: "descending", next: "own" });
    expect(headSort(orders, "b", "b", (v) => `/x?sort=${v}`)).toEqual({ key: "b", href: "/x?sort=b-desc", state: "ascending" });
  });

  it("gives every server-sorted list an ascending and a descending order for each head it links", () => {
    for (const orders of [RADAR_ORDERS, TENDER_ORDERS, AWARD_ORDERS, RECORDS_ORDERS, INSTRUMENT_ORDERS]) {
      for (const column of new Set(orders.map((o) => o[1]))) {
        expect(orders.filter((o) => o[1] === column).map((o) => o[2]).sort(), column).toEqual(["asc", "desc"]);
      }
    }
  });

  it("orders a radar page's rows without the records database as the database orders the window", () => {
    const rows = page1 as unknown as ExpiringRow[];
    const refs = (order: string) => orderExpiring(rows, readExpiringQuery(new URL(`https://x/?sort=${order}`)).sort).map((r) => r.reference);
    expect(refs("")).toEqual(["cb-400-40000004", "W8472-000777", "dnd-mdn:C-2026-0042"]);
    expect(refs("end")).toEqual(refs(""));
    expect(refs("end-desc")).toEqual(["dnd-mdn:C-2026-0042", "W8472-000777", "cb-400-40000004"]);
    expect(refs("value")).toEqual(["dnd-mdn:C-2026-0042", "cb-400-40000004", "W8472-000777"]);
    expect(refs("value-asc")).toEqual(["W8472-000777", "cb-400-40000004", "dnd-mdn:C-2026-0042"]);
    // A row without a value goes last either way.
    const none = [{ ...rows[1], value: null, reference: "none" }, ...rows];
    for (const order of ["value", "value-asc"] as const) expect(orderExpiring(none, order).at(-1)?.reference, order).toBe("none");
  });

  it("orders the newest awards by date and by value, either way", () => {
    const rows = recent as unknown as AwardRow[];
    const refs = (order: Parameters<typeof orderAwards>[1]) => orderAwards(rows, order).map((r) => r.reference);
    expect(refs("")).toEqual(["cb-400-40000004", "cb-500-50000005"]);
    expect(refs("oldest")).toEqual(["cb-500-50000005", "cb-400-40000004"]);
    expect(refs("smallest")).toEqual(["cb-500-50000005", "cb-400-40000004"]);
    expect(refs("largest")).toEqual(["cb-400-40000004", "cb-500-50000005"]);
  });
});

describe("the markup", () => {
  it("gives a table whole on its page a button in every head, no order marked, and the script and its words", async () => {
    for (const lang of ["en", "fr"] as const) {
      const html = await text(`/buyers?lang=${lang}`);
      expect(tableTag(html), lang).toContain('data-sorting="client"');
      const heads = headRow(html);
      expect(heads.match(/<th[ >]/g)?.length, lang).toBe(heads.match(/<button type="button" class="th-sort">/g)?.length);
      expect(heads, lang).toContain(BUTTON(t(lang, "col.buyer")));
      expect(html, lang).not.toContain("aria-sort");
      // Once a page, after the content, with the words in the page's language as pieces (no unfilled placeholder).
      expect(html.match(/<script type="module" src="\/sort.js"><\/script>/g), lang).toHaveLength(1);
      expect(html.indexOf("/sort.js"), lang).toBeGreaterThan(html.indexOf("</main>"));
      const block = JSON.parse(html.match(/<script type="application\/json" id="sort-i18n">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
      expect(block, lang).toEqual(sortWords(lang));
      expect(block.by.join(""), lang).toBe(t(lang, "sort.by", { column: "column" }));
      expect(JSON.stringify(block), lang).not.toMatch(/\{\w+\}/);
    }
    expect(sortWords("en")).toEqual({ by: ["Sort by ", "column", ""], done: ["", "column", ": ", "state", ""], asc: "sorted ascending",
      desc: "sorted descending", none: "original order" });
    expect(sortWords("fr")).toMatchObject({ by: ["Trier par ", "column", ""], asc: "tri croissant", desc: "tri décroissant", none: "ordre d’origine" });
  });

  it("leaves the script off a page with no table, and the heads plain on a tree of levels", async () => {
    const about = await text("/about");
    expect(about).not.toContain("<table");
    expect(about).not.toContain("/sort.js");
    expect(about).not.toContain("sort-i18n");
    const segment = await text("/segments/82");
    expect(segment).toContain('class="table-wrap bordered levels"');
    const levels = segment.slice(segment.indexOf('class="table-wrap bordered levels"'));
    expect(tableTag(levels, "<table")).not.toContain("data-sorting");
    expect(headRow(levels, "<table")).not.toContain("th-sort");
  });

  it("links only the heads the server orders a radar window by, cycling their order with every filter kept", async () => {
    const html = await text("/expiring/3m");
    const heads = headRow(html);
    expect(tableTag(html)).toContain('data-sorting="server"');
    expect(heads).toContain('<th class="k-date"><a href="/expiring/3m?sort=end" class="th-sort" rel="nofollow">Ends on</a></th>');
    expect(heads).toContain('<th class="k-value num"><a href="/expiring/3m?sort=value-asc" class="th-sort" rel="nofollow">Value</a></th>');
    // The other heads: no button, no link, no glyph.
    expect(heads.match(/class="th-sort"/g)).toHaveLength(2);
    expect(heads).toContain('<th class="k-main">Contract</th>');
    expect(heads).toContain('<th class="k-buyer mdh">Buyer</th>');
    expect(heads).not.toContain("<button");
    expect(heads).not.toContain("aria-sort");
    // Round trip: ascending, descending, then the window's own order, the filters kept and the first page.
    const steps: [string, string, string, string][] = [
      ["?buyer=dnd-mdn&sort=end", "k-date", "ascending", "/expiring/3m?buyer=dnd-mdn&amp;sort=end-desc"],
      ["?buyer=dnd-mdn&sort=end-desc", "k-date", "descending", "/expiring/3m?buyer=dnd-mdn"],
      ["?buyer=dnd-mdn&sort=value-asc&page=1", "k-value num", "ascending", "/expiring/3m?buyer=dnd-mdn&amp;sort=value"],
      ["?buyer=dnd-mdn&sort=value", "k-value num", "descending", "/expiring/3m?buyer=dnd-mdn"],
    ];
    for (const [query, cls, state, href] of steps) {
      const row = headRow(await text(`/expiring/3m${query}`));
      expect(row, query).toContain(`<th class="${cls}" aria-sort="${state}"><a href="${href}" class="th-sort" rel="nofollow">`);
      expect(row.match(/aria-sort/g), query).toHaveLength(1);
    }
    // The other head starts its own order ascending, the filters kept.
    expect(headRow(await text("/expiring/3m?buyer=dnd-mdn&sort=value"))).toContain('<a href="/expiring/3m?buyer=dnd-mdn&amp;sort=end" class="th-sort"');
    // The rows follow the order asked; the Sort field shows it.
    const order = async (q: string) => {
      const page = await text(`/expiring/3m${q}`);
      return ["cb-400-40000004", "W8472-000777", "C-2026-0042"].sort((a, b) => page.indexOf(`>${a}</span>`) - page.indexOf(`>${b}</span>`));
    };
    expect(await order("?sort=end-desc")).toEqual(["C-2026-0042", "W8472-000777", "cb-400-40000004"]);
    expect(await order("?sort=value-asc")).toEqual(["W8472-000777", "cb-400-40000004", "C-2026-0042"]);
    expect(await text("/expiring/3m?sort=value-asc")).toContain('<option value="value-asc" selected="">Value, smallest first</option>');
    expect(await text("/expiring/3m?sort=end-desc&lang=fr")).toContain('<option value="end-desc" selected="">Date de fin, la plus lointaine d’abord</option>');
    // A list shown whole (the overview's first rows) sorts in the page instead.
    const overview = await text("/expiring");
    expect(tableTag(overview, "Ending Within 3 Months")).toContain('data-sorting="client"');
    expect(headRow(overview, "Ending Within 3 Months")).toContain(BUTTON("Ends on"));
  });

  it("links the tender list's Closing and Published heads, and hands the order each sets to tenders.js", async () => {
    const html = await text("/tenders");
    const heads = headRow(html, 'id="tender-table"');
    expect(heads).toContain('<th class="k-datetime c-date"><a href="/tenders?sort=closing-asc" class="th-sort" rel="nofollow">Closing</a></th>');
    expect(heads).toContain('<th class="k-date mdh c-pub"><a href="/tenders?sort=published-asc" class="th-sort" rel="nofollow">Published</a></th>');
    expect(heads).toContain('<th class="k-main c-notice">Notice</th>');
    expect(heads.match(/class="th-sort"/g)).toHaveLength(2);
    expect(headRow(await text("/tenders?sort=published"), 'id="tender-table"'))
      .toContain('<th class="k-date mdh c-pub" aria-sort="descending"><a href="/tenders" class="th-sort" rel="nofollow">Published</a></th>');
    expect(headRow(await text("/tenders?sort=closing-asc&closing=30"), 'id="tender-table"'))
      .toContain('<th class="k-datetime c-date" aria-sort="ascending"><a href="/tenders?closing=30&amp;sort=closing-desc" class="th-sort"');
    const data = JSON.parse(html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
    expect(data.table.sorting).toBe("server");
    expect(data.table.heads.map((h: string[]) => h[2])).toEqual(["", "", "closing", "published", ""]);
    expect(html).toContain('<script type="module" src="/sort.js"></script>');
    expect(clientTable(tenderColumns("en")).heads.map((h) => h[2])).toEqual(["", "", "", "", ""]);
    // The script draws the same heads from the same orders, and answers their links in memory.
    expect(tendersJs).toContain('import { headOrder } from "./sort.js";');
    expect(tendersJs).toContain('headOrder(ORDERS, state.sort, h[2], "closing")');
  });

  it("links the newest awards' Awarded and Value heads, and a year's too (test/awards-year-sort.test.ts)", async () => {
    const html = await text("/awards");
    const heads = headRow(html);
    expect(heads).toContain('<th class="k-date"><a href="/awards?sort=oldest" class="th-sort" rel="nofollow">Awarded</a></th>');
    expect(heads).toContain('<th class="k-value num"><a href="/awards?sort=smallest" class="th-sort" rel="nofollow">Value</a></th>');
    expect(heads.match(/class="th-sort"/g)).toHaveLength(2);
    const largest = await text("/awards?sort=largest");
    expect(headRow(largest)).toContain('<th class="k-value num" aria-sort="descending"><a href="/awards" class="th-sort"');
    expect(largest.indexOf("cb-400-40000004")).toBeLessThan(largest.indexOf("cb-500-50000005"));
    const smallest = await text("/awards?sort=smallest");
    expect(smallest.indexOf("cb-500-50000005")).toBeLessThan(smallest.indexOf("cb-400-40000004"));
    expect(smallest).toContain('<meta name="robots" content="noindex');
    const year = await text("/awards/2026");
    expect(tableTag(year)).toContain('data-sorting="server"');
    expect(headRow(year)).toContain('<th class="k-date"><a href="/awards/2026?sort=oldest" class="th-sort" rel="nofollow">Awarded</a></th>');
    expect(headRow(year)).toContain('<th class="k-value num"><a href="/awards/2026?sort=smallest" class="th-sort" rel="nofollow">Value</a></th>');
    expect(headRow(year).match(/class="th-sort"/g)).toHaveLength(2);
    expect(year).toContain('<script type="module" src="/sort.js"></script>');
  });

  it("keeps the words out of the script, in both languages in the dictionary, with no em-dash", () => {
    expect(sortJs).toContain('document.getElementById("sort-i18n")');
    expect(sortJs).toContain('typeof document !== "undefined"');
    expect([...sortJs.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((s) => /\b[A-Z][a-z]+(?: [a-z]+)+/.test(s))).toEqual([]);
    for (const key of ["sort.by", "sort.ascending", "sort.descending", "sort.original", "sort.done"] as const) {
      for (const lang of ["en", "fr"] as const) expect(t(lang, key), `${lang} ${key}`).not.toContain(EM_DASH);
    }
    expect(sortJs).not.toContain(EM_DASH);
  });
});

describe("the phone pager after a sort", () => {
  // The suite has no DOM, so the hand-off is held at its two ends: the sort
  // announces itself on the table, bubbling, and both of the pager's
  // wrappers read their rows again in the new order (a paged one from its
  // first rows) before folding them.
  it("hears the table's aw:sorted and folds the rows in their new order", () => {
    expect(sortJs).toContain('table.dispatchEvent(new CustomEvent("aw:sorted", { bubbles: true }))');
    const handlers = [...pagerJs.matchAll(/wrap\.addEventListener\("aw:sorted", function \(\) \{([\s\S]*?)\}\);/g)].map((m) => m[1]);
    expect(handlers).toHaveLength(2);
    for (const h of handlers) expect(h).toContain('rows = Array.prototype.slice.call(wrap.querySelectorAll("tbody > tr"));');
    expect(handlers[0]).toContain("part = 0;");
    expect(handlers[0]).toContain("show();");
    expect(handlers[1]).toContain("apply();");
  });
});
