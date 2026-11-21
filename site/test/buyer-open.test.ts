// A buyer's open tender notices on its own page (pages/buyers.tsx; the export's buyers/<id>.json "open_notices",
// since 2026-11-21). A reader who searched the buyer's name with "tenders" lands on this page, and the tender list
// filtered to the buyer is closed to crawlers, so the notices are listed here, first on the page, each a link to
// its own page: the soonest to close, one whose time has passed after the ones still open, without the buyer's
// column. A file from before the field, and a buyer with none, draw the page as it was.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { fmtInt, t, type Lang } from "../src/i18n";
import { BUYER_OPEN_PHONE_ROWS, BUYER_OPEN_ROWS } from "../src/pages/buyers";
import { tenderColumns } from "../src/pages/shared";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import { expectTablesFit } from "./table-fit";
import exportStatic from "../../pipeline/awardwatch_pipeline/export_static.py?raw";

const BUYER = "pwgsc-tpsgc";
const PATH = `/buyers/${BUYER}`;
const fixture = () => structuredClone(FILES[`buyers/${BUYER}.json`]) as Record<string, any>;

// A notice as the buyer's file lists it: the open list's row without what only that list's filters read.
function notice(i: number, closing: string | null): Record<string, unknown> {
  const row = structuredClone((FILES["tenders/open-first.json"] as { rows: Record<string, unknown>[] }).rows[0]);
  for (const k of ["excerpt_en", "excerpt_fr", "codes"]) delete row[k];
  return { ...row, reference: `cb-900-${90000000 + i}`, title_en: `Notice number ${i}`, title_fr: `Avis numéro ${i}`, closing, buyer_id: BUYER };
}
// Closing days after the test clock (2026-10-31T16:00:00Z), soonest first, as the export orders them.
const later = (n: number) => Array.from({ length: n }, (_, i) => notice(i + 1, `2026-12-${String(10 + i).padStart(2, "0")}T14:00:00`));

let address = 0;
async function page(doc: Record<string, unknown> | null, q = ""): Promise<string> {
  const env = testEnv(doc ? makeFakeAssets({}, { [`buyers/${BUYER}.json`]: doc }) : undefined);
  const res = await app.request(`${PATH}${q}`, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.51.100.${(address++ % 250) + 1}` } }, env);
  expect(res.status, q).toBe(200);
  return res.text();
}
const mainOf = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
// The panel that holds the heading with the id "open", from its section's start to its end.
function panelOf(html: string): string {
  const at = html.indexOf('<h2 id="open">');
  if (at < 0) return "";
  const start = html.lastIndexOf('<section class="panel"', at);
  return html.slice(start, html.indexOf("</section>", at));
}
const refsOf = (panel: string) => [...panel.matchAll(/<a href="\/tenders\/(cb-900-\d+)">/g)].map((m) => m[1]);
const text = (s: string) => s.replace(/&#39;/g, "'").replace(/’/g, "'").replace(/[  ]/g, " ");

describe("a buyer's file from before the field, or with no open notice", () => {
  it("draws the page as it was: no panel of open notices, the head's button as before", async () => {
    const before = await page(null);
    expect(fixture().open_notices).toBeUndefined();
    expect(before).not.toContain('id="open"');
    expect(mainOf(before)).toContain(`<a href="/tenders?buyer=${BUYER}" class="btn btn-primary">`);
    // The key present and empty: the same page, byte for byte.
    expect(await page({ ...fixture(), open_notices: [] })).toBe(before);
    expect(await page({ ...fixture(), open_notices: [] }, "?lang=fr")).toBe(await page(null, "?lang=fr"));
  });
});

describe("a buyer with open notices", () => {
  it("lists the soonest to close first on the page, each a link to its notice, without the buyer's column", async () => {
    const rows = later(12);
    const html = await page({ ...fixture(), open_tenders: 40, open_notices: rows });
    const main = mainOf(html);
    const panel = panelOf(main);
    expect(panel).toContain(`<h2 id="open">${t("en", "buyer.open_title")}</h2>`);
    // The whole count beside the title, as the head's button says it.
    expect(panel).toContain('<span class="panel-count">40</span>');
    expect(refsOf(panel)).toEqual(rows.slice(0, BUYER_OPEN_ROWS).map((r) => String(r.reference)));
    expect(BUYER_OPEN_ROWS).toBe(10);
    expect(panel).toContain(">Notice number 1</a>");
    // Every row is this buyer's: no buyer column, and the region shows at every width in its place.
    expect(panel).not.toContain("c-buyer");
    expect(panel).not.toContain(`>${t("en", "col.buyer")}<`);
    expect(panel.match(/<td data-label="[^"]*" class="c-region">/g)).toHaveLength(BUYER_OPEN_ROWS);
    expect(panel).not.toContain("c-region mdh");
    // A phone shows the first five and a button for the rest (public/pager.js).
    expect(panel).toContain(`<div class="table-wrap bordered" data-phone-rows="${BUYER_OPEN_PHONE_ROWS}">`);
    expect(html).toContain("/pager.js");
    // More than the page shows: the line says so and links the filtered list, as a plain link.
    expect(text(panel)).toContain(`${t("en", "buyer.open_first", { n: "10" })} <a href="/tenders?buyer=${BUYER}">${t("en", "buyer.open_all", { n: "40" })}</a>`);
    // First on the page, before the figures; the head keeps the page's one filled button.
    expect(main.indexOf('<h2 id="open">')).toBeGreaterThan(0);
    expect(main.indexOf('<h2 id="open">')).toBeLessThan(main.indexOf('<section class="tiles"'));
    expect(main.match(/class="btn btn-primary"/g)).toHaveLength(1);
    expect(panel).not.toContain("btn-primary");
    // None of these closes within the closing-soon window: no countdown script is loaded for them.
    expect(html).not.toContain("/countdown.js");
    expectTablesFit(html, PATH);
  });

  it("puts a notice whose closing time has passed after the ones still open, and says how long is left on one closing soon", async () => {
    // As the file orders them: the one that closed this morning first, then one closing tomorrow, then later ones.
    const rows = [notice(1, "2026-10-31T09:00:00"), notice(2, "2026-11-01T14:00:00"), ...later(3).map((r, i) => ({ ...r, reference: `cb-900-${90000010 + i}` }))];
    const html = await page({ ...fixture(), open_tenders: rows.length, open_notices: rows });
    const panel = panelOf(mainOf(html));
    expect(refsOf(panel)).toEqual([...rows.slice(1), rows[0]].map((r) => String(r.reference)));
    expect(panel).toContain(t("en", "status.closed"));
    // Every notice is on the page, so no line about the rest.
    expect(panel).not.toContain(`/tenders?buyer=${BUYER}`);
    expect(panel).toContain(`<span class="panel-count">${rows.length}</span>`);
    // The one closing tomorrow gets its live time left.
    expect(panel).toContain('class="countdown"');
    expect(html).toContain("/countdown.js");
  });

  it("reads in French, with the page's own words", async () => {
    const rows = later(12);
    const html = await page({ ...fixture(), open_tenders: 1234, open_notices: rows }, "?lang=fr");
    const panel = panelOf(mainOf(html));
    const lang: Lang = "fr";
    expect(text(panel)).toContain(`<h2 id="open">${text(t(lang, "buyer.open_title"))}</h2>`);
    expect(text(t(lang, "buyer.open_title"))).toBe("Avis d'appel d'offres ouverts");
    expect(panel).toContain(">Avis numéro 1</a>");
    expect(text(panel)).toContain(
      `${text(t(lang, "buyer.open_first", { n: "10" }))} <a href="/tenders?buyer=${BUYER}">${text(t(lang, "buyer.open_all", { n: fmtInt(1234, lang) }))}</a>`);
    for (const dash of [String.fromCharCode(0x2014), String.fromCharCode(0x2013)]) expect(panel).not.toContain(dash);
    expectTablesFit(html, `${PATH}?lang=fr`);
  });

  it("holds no more rows than the export writes, and the tender table's other uses keep the buyer's column", () => {
    expect(Number(/^BUYER_OPEN = (\d+)$/m.exec(exportStatic)?.[1])).toBeGreaterThanOrEqual(BUYER_OPEN_ROWS);
    const kinds = (cols: ReturnType<typeof tenderColumns>) => cols.map((c) => [c.kind, c.rest ?? null]);
    expect(kinds(tenderColumns("en"))).toEqual([["main", null], ["buyer", null], ["datetime", null], ["date", "md"], ["region", "md"]]);
    expect(kinds(tenderColumns("en", undefined, false))).toEqual([["main", null], ["datetime", null], ["date", "md"], ["region", null]]);
  });
});
