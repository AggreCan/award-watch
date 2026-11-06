// A year of award notices in every order its heads set (/awards/<year>?sort=):
// the export writes the year twice, by award date (awards/<year>/<n>.json)
// and by value (awards/<year>/value/<n>.json, the rows without a value in
// files of their own after the first valued_pages), and each page of an
// order is one of those files, read forwards or backwards.
import { describe, expect, it } from "vitest";
import type { AwardRow, AwardYear } from "../src/data";
import { app } from "../src/index";
import { readYearOrder, yearPageFile, yearPages } from "../src/pages/awards";
import { makeFakeAssets, testEnv } from "./assets";
import page1 from "./fixtures/awards-2026-1.json";

let address = 0;
const get = (path: string, overrides: Record<string, unknown> = YEAR) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.22.${(address++ % 250) + 1}` } },
    testEnv(makeFakeAssets({}, overrides)));
const text = async (path: string, overrides?: Record<string, unknown>) => (await get(path, overrides)).text();
const headRow = (html: string) => html.slice(html.indexOf("<main")).match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1] ?? "";
// The references of the table's rows, in the order shown.
const shown = (html: string) => {
  const body = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  return [...body.matchAll(/<span class="mono id muted">([^<]+)<\/span>/g)].map((m) => m[1]);
};

const base = (page1 as unknown as AwardRow[])[0];
const row = (reference: string, awarded: string, value: number | null): AwardRow => ({ ...base, reference, awarded, value });
// Five notices of 2026, two to a file: the date order and the value order differ, and one has no value.
const R1 = row("cb-901-00000001", "2026-10-01", 500);
const R2 = row("cb-902-00000002", "2026-07-01", null);
const R3 = row("cb-903-00000003", "2026-05-01", 90_000);
const R4 = row("cb-904-00000004", "2026-03-01", 7_000);
const R5 = row("cb-905-00000005", "2026-01-15", 120_000);
const INDEX: AwardYear = { year: 2026, pages: 3, rows: 5, value_pages: 3, valued_pages: 2 };
const YEAR: Record<string, unknown> = {
  "awards/2026/index.json": INDEX,
  "awards/2026/1.json": [R1, R2], "awards/2026/2.json": [R3, R4], "awards/2026/3.json": [R5],
  "awards/2026/value/1.json": [R5, R3], "awards/2026/value/2.json": [R4, R1], "awards/2026/value/3.json": [R2],
};
const refs = (...rows: AwardRow[]) => rows.map((r) => r.reference);

describe("a year's orders", () => {
  it("read one file a page, forwards or backwards", () => {
    expect(readYearOrder(undefined)).toBe("");
    expect(readYearOrder("largest")).toBe("largest");
    expect(readYearOrder("biggest")).toBeNull();
    expect(readYearOrder("")).toBeNull();
    expect(yearPages(INDEX, "")).toBe(3);
    expect(yearPages(INDEX, "largest")).toBe(3);
    expect(yearPages({ year: 2026, pages: 3, rows: 5 }, "smallest")).toBeNull();
    expect(yearPages({ year: 2026, pages: 3, rows: 5 }, "oldest")).toBe(3);
    expect(yearPageFile(INDEX, "oldest", 1)).toEqual({ set: "date", file: 3, reverse: true });
    expect(yearPageFile(INDEX, "largest", 2)).toEqual({ set: "value", file: 2, reverse: false });
    expect(yearPageFile(INDEX, "smallest", 1)).toEqual({ set: "value", file: 2, reverse: true });
    expect(yearPageFile(INDEX, "smallest", 2)).toEqual({ set: "value", file: 1, reverse: true });
    // Past the valued files, the rows without a value as they stand.
    expect(yearPageFile(INDEX, "smallest", 3)).toEqual({ set: "value", file: 3, reverse: false });
    expect(yearPageFile(INDEX, "newest", 2)).toEqual({ set: "date", file: 2, reverse: false });
  });

  it("show each order's first and last rows, the rows without a value last both ways", async () => {
    const pages = async (sort: string) => {
      const out: string[][] = [];
      for (const n of [1, 2, 3]) out.push(shown(await text(`/awards/2026?${sort ? `sort=${sort}&` : ""}page=${n}`)));
      return out;
    };
    expect(await pages("")).toEqual([refs(R1, R2), refs(R3, R4), refs(R5)]);
    expect(await pages("newest")).toEqual([refs(R1, R2), refs(R3, R4), refs(R5)]);
    expect(await pages("oldest")).toEqual([refs(R5), refs(R4, R3), refs(R2, R1)]);
    expect(await pages("largest")).toEqual([refs(R5, R3), refs(R4, R1), refs(R2)]);
    expect(await pages("smallest")).toEqual([refs(R1, R4), refs(R3, R5), refs(R2)]);
  });

  it("link the Awarded and Value heads through the same cycle as /awards, every other head plain", async () => {
    const plain = headRow(await text("/awards/2026"));
    expect(plain).toContain('<th class="k-date"><a href="/awards/2026?sort=oldest" class="th-sort" rel="nofollow">Awarded</a></th>');
    expect(plain).toContain('<th class="k-value num"><a href="/awards/2026?sort=smallest" class="th-sort" rel="nofollow">Value</a></th>');
    expect(plain.match(/class="th-sort"/g)).toHaveLength(2);
    const smallest = headRow(await text("/awards/2026?sort=smallest"));
    expect(smallest).toContain('<th class="k-value num" aria-sort="ascending"><a href="/awards/2026?sort=largest" class="th-sort"');
    const largest = headRow(await text("/awards/2026?sort=largest&page=2"));
    expect(largest).toContain('<th class="k-value num" aria-sort="descending"><a href="/awards/2026" class="th-sort"');
    expect(largest).toContain('<th class="k-date"><a href="/awards/2026?sort=oldest" class="th-sort"');
    const oldest = headRow(await text("/awards/2026?sort=oldest"));
    expect(oldest).toContain('<th class="k-date" aria-sort="ascending"><a href="/awards/2026?sort=newest" class="th-sort"');
  });

  it("page within the order and keep it in the pager's links", async () => {
    const html = await text("/awards/2026?sort=largest");
    expect(html).toContain('<a href="/awards/2026?sort=largest&amp;page=2" class="btn" rel="next">Next</a>');
    const second = await text("/awards/2026?sort=smallest&page=2");
    expect(second).toContain('<a href="/awards/2026?sort=smallest" class="btn" rel="prev">Previous</a>');
    expect(second).toContain('<a href="/awards/2026?sort=smallest&amp;page=3" class="btn" rel="next">Next</a>');
  });

  it("keep a sorted view out of the index, as a later page of the year is", async () => {
    for (const path of ["/awards/2026?sort=largest", "/awards/2026?sort=oldest&page=2", "/awards/2026?sort=newest", "/awards/2026?page=2"]) {
      const html = await text(path);
      const head = html.slice(0, html.indexOf("</head>"));
      expect(head, path).toContain('<meta name="robots" content="noindex"/>');
      // The layout gives a noindex page no canonical (src/layout.tsx MetaTags), a later page of the year included.
      expect(head, path).not.toContain('rel="canonical"');
      // Only the plain view's pages are a series.
      if (path.includes("sort=")) expect(head, path).not.toContain('rel="next"');
    }
    const plain = await text("/awards/2026");
    const head = plain.slice(0, plain.indexOf("</head>"));
    expect(head).not.toContain('name="robots"');
    expect(head).toContain('<link rel="canonical" href="https://awardwatch.ca/awards/2026"/>');
    expect(head).toContain('<link rel="next" href="https://awardwatch.ca/awards/2026?page=2"/>');
  });

  it("answer 404 to a sort that is not one, a page past the order's last, or a value order without the value set", async () => {
    for (const path of ["/awards/2026?sort=biggest", "/awards/2026?sort=", "/awards/2026?sort=largest&page=4", "/awards/2026?sort=oldest&page=0"]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain('<a href="/awards/2026">Back to the first page of the year</a>');
    }
    // An older export: no value set, so the Value head is plain and a value order is not offered.
    const older = { ...YEAR, "awards/2026/index.json": { year: 2026, pages: 3, rows: 5 } };
    expect((await get("/awards/2026?sort=largest", older)).status).toBe(404);
    expect((await get("/awards/2026?sort=oldest", older)).status).toBe(200);
    const heads = headRow(await text("/awards/2026", older));
    expect(heads).toContain('<th class="k-value num">Value</th>');
    expect(heads.match(/class="th-sort"/g)).toHaveLength(1);
    // An index whose value set cannot be the same rows is read as having none.
    const odd = { ...YEAR, "awards/2026/index.json": { ...INDEX, value_pages: 7 } };
    expect((await get("/awards/2026?sort=largest", odd)).status).toBe(404);
    // A value file that does not read is "not published", as a date file is.
    expect((await get("/awards/2026?sort=largest", { ...YEAR, "awards/2026/value/1.json": undefined })).status).toBe(503);
  });

  it("speak French with the same orders", async () => {
    const html = await text("/awards/2026?sort=smallest&lang=fr");
    expect(html).toContain('<html lang="fr">');
    expect(shown(html)).toEqual(refs(R1, R4));
    expect(headRow(html)).toContain('aria-sort="ascending"');
  });
});
