// The landing page's band on the analytics builder and the dashboard (src/pages/landing.tsx
// BuildBand, docs/landing.md "The builder's band"): its switch, BUILDER_DEMO,
// ships "off" and leaves the page byte for byte as it is without the band, as
// does "on" while the builder's own switch is off; with both on the band
// shows once in each language, its picture the builder's own view of National
// Defence's published contracts by fiscal year, read with the builder's
// statements from the records database (here a database that answers them
// from memory with test cells, the buyer file's yearly figures set on fiscal
// years), every word in it the builder's and the dashboard's own, the figures
// written by the builder's formatters on one scale (src/landing_chart.ts); a
// file, a database or a cube that does not answer, or fewer than four years,
// leaves the band out.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wrangler from "../wrangler.jsonc?raw";
import { type BuildChoice, buildAddress } from "../src/builder";
import { BUYERS_YEARS_SQL, CUBE_META_SQL } from "../src/builder_sql";
import { type Key, allKeys, fmtInt, fmtMoney, fmtMoneyShort, rawEntry, sourceLabel, t } from "../src/i18n";
import { app } from "../src/index";
import { CHART_TICKS, PLOT_BASE, PLOT_LEFT, PLOT_RIGHT, PLOT_TOP, buildChart, tickStep } from "../src/landing_chart";
import {
  BAND_RETRY_MS, BUILDER_STYLES, BUILD_BUYER, BUILD_MIN_YEARS, BUILD_SOURCE, BUILD_TILE_ROWS, BUILD_YEARS, LANDING_VERSION, bandChoice,
  builderDemoOn,
  dashboardLine, landingStylesheet,
} from "../src/pages/landing";
import { viewTitle } from "../src/pages/builder";
import { PLAN_ROWS, planLine } from "../src/pro";
import { STATE_SQL, fiscalLabel } from "../src/records_db";
import { decode, nbsp, onEnv, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import DND from "./fixtures/buyer-dnd-mdn.json";
import STATS_MAP from "./fixtures/stats-map.json";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const LANDING_CSS = (env as unknown as { LANDING_CSS: string }).LANDING_CSS;
const stats = FILES["stats.json"] as Record<string, any>;
// The fixtures' data date is 2026-10-31, in fiscal year 2026-27, which is then the year to date.
const CURRENT = 2026;
const FIRST = CURRENT - BUILD_YEARS + 1;
// The data date cube_meta gives the builder's figures.
const AS_OF = "2026-10-30";

// The test cells the records database answers for the buyer's fiscal years: the buyer file's published contracts by
// year, each set on the fiscal year of the same number, so the figures are the size of the real ones. What is held
// is that the band shows what the builder's statement answers, and nothing else.
type Cell = { fy: number; n: number; cents: number | null; n_no_value: number };
const CELLS: Cell[] = (DND.years as { year: number; source: string; n: number; n_no_value: number; total: number | null }[])
  .filter((y) => y.source === "contracts" && y.year >= FIRST && y.year <= CURRENT && y.total !== null)
  .sort((a, b) => a.year - b.year)
  .map((y) => ({ fy: y.year, n: y.n, cents: Math.round((y.total as number) * 100), n_no_value: y.n_no_value }));

// A records database that answers the builder's statements from memory and writes down every batch it runs.
function recordsWith(cells: readonly Cell[] = CELLS, o: { state?: string; cubeDate?: string | null; fail?: boolean } = {}) {
  const batches: { sql: string; params: unknown[] }[][] = [];
  const answer = (sql: string, params: unknown[]): Record<string, unknown>[] => {
    if (sql === STATE_SQL) return [{ key: "state", value: o.state ?? "ready" }, { key: "as_of", value: AS_OF }];
    if (sql === CUBE_META_SQL) return o.cubeDate === null ? [] : [{ as_of: o.cubeDate ?? AS_OF }];
    if (sql === BUYERS_YEARS_SQL) {
      return cells.filter((c) => c.fy >= Number(params[3]) && c.fy <= Number(params[4])).map((c) => ({ id: BUILD_BUYER, ...c }));
    }
    return [];
  };
  const statement = (sql: string, params: unknown[] = []): Record<string, unknown> => ({
    sql, params, bind: (...p: unknown[]) => statement(sql, p),
    all: async () => ({ results: answer(sql, params), success: true, meta: {} }), first: async () => answer(sql, params)[0] ?? null,
  });
  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { sql: string; params: unknown[] }[]) => {
      if (o.fail) throw new Error("D1_ERROR: the database did not answer");
      batches.push(list.map((s) => ({ sql: s.sql, params: s.params })));
      return list.map((s) => ({ results: answer(s.sql, s.params), success: true, meta: {} }));
    },
  };
  return { db: db as unknown as D1Database, batches };
}
// A binding that throws when used: proof that nothing reads it.
const trap = new Proxy({}, { get: () => { throw new Error("a database was read"); } }) as unknown as D1Database;

const assetsWith = (files: Record<string, unknown> = {}) =>
  makeFakeAssets({}, { "stats.json": { ...stats, map: STATS_MAP }, "buyers/dnd-mdn.json": DND, ...files });
const off = (extra: Record<string, unknown> = {}) => ({ ...testEnv(assetsWith()), RECORDS: trap, ...extra });
const on = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS: assetsWith(), RECORDS: trap, ...extra });
const paid = (extra: Record<string, unknown> = {}) => on({ STRIPE_SECRET_KEY: "sk_test_fake0000", STRIPE_WEBHOOK_SECRET: "whsec_fake0000", ...extra });
// The band: its switch and the builder's, with the records database answering.
const band = (extra: Record<string, unknown> = {}) => on({ BUILDER_DEMO: "on", BUILDER: "on", RECORDS: recordsWith().db, ...extra });

let address = 0;
const html = async (path: string, environment: object) =>
  (await app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.62.${(address++ % 250) + 1}` } }, environment)).text();
const PATHS = [["en", "/"], ["fr", "/?lang=fr"]] as const;
const SECTION_RE = /<section class="lp-feat lp-build"[\s\S]*?<\/section>/;
const sectionOf = (page: string) => SECTION_RE.exec(page)?.[0] ?? "";
const textOf = (s: string) => nbsp(decode(s.replace(/<[^>]+>/g, " "))).replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
// The page as it is without the band: the band taken out and the stylesheet named as before.
const withoutBand = (page: string) =>
  page.replace(SECTION_RE, "").replace(`/landing.css?v=${LANDING_VERSION}&amp;${BUILDER_STYLES}`, `/landing.css?v=${LANDING_VERSION}`);

const BUILD_KEYS = allKeys().filter((k) => k.startsWith("landing.build_"));
const nameOf = (lang: "en" | "fr") => (lang === "fr" ? DND.buyer.name_fr : DND.buyer.name_en);
// The view the band draws, as the builder reads its address.
const CHOICE = bandChoice(CURRENT) as BuildChoice;
// A fiscal year as the builder's table writes it, the data date's marked as the year to date.
const fyText = (lang: "en" | "fr", fy: number) => (fy === CURRENT ? t(lang, "analytics.to_date", { fy: fiscalLabel(lang, fy) }) : fiscalLabel(lang, fy));

// Every word the picture shows, by its key: the builder's and the dashboard's own. The report lists them.
const PICTURE_KEYS: readonly Key[] = [
  "build.title", "build.buyer", "build.buyer_choose", "build.rows", "build.rows_year", "col.source", "source.awards", "source.contracts", "build.show",
  "build.show_bars", "build.show_line", "build.show_table", "build.apply", "build.choose_buyer", "col.value", "build.by_year", "dash.add_here",
  "analytics.col_fy", "col.records", "build.as_of", "analytics.to_date", "dash.title", "dash.status_saved", "dash.kind_tenders", "dash.kind_radar",
  "analytics.lead", "dash.shown", "dash.open",
];

describe("the switch", () => {
  it("ships \"off\", and only \"on\" turns it on", () => {
    expect((env as unknown as { BUILDER_DEMO?: string }).BUILDER_DEMO).toBe("off");
    expect(wrangler).toMatch(/"BUILDER_DEMO":\s*"off"/);
    expect(builderDemoOn({ BUILDER_DEMO: "on" })).toBe(true);
    for (const v of ["off", "", "On", "ON", "true", "1", undefined]) expect(builderDemoOn({ BUILDER_DEMO: v }), String(v)).toBe(false);
  });

  it("while off, or on with the builder off, leaves the page byte for byte as it is, in both languages and both accounts states, and reads nothing more", async () => {
    for (const make of [off, on, paid]) {
      for (const [lang, path] of PATHS) {
        const shipped = await html(path, make());
        expect(shipped, `${lang} shipped`).not.toContain("lp-build");
        for (const v of [undefined, "off", "", "On", "true"]) {
          expect(await html(path, make({ BUILDER_DEMO: v })), `${lang} ${String(v)}`).toBe(shipped);
        }
        // The band never shows without the builder: with the accounts switch off, or the builder's switch.
        expect(await html(path, make({ BUILDER_DEMO: "on", RECORDS: recordsWith().db })), `${lang} builder off`).toBe(shipped);
        expect(shipped).toContain(`<link rel="stylesheet" href="/landing.css?v=${LANDING_VERSION}"/>`);
        for (const key of BUILD_KEYS) {
          if (key === "landing.build_plan") continue;
          expect(textOf(shipped), `${lang} ${key}`).not.toContain(textOf(t(lang, key, { source: "", buyer: "", first: "", last: "" })).slice(0, 40));
        }
        expect(shipped).not.toMatch(/class="bd"|builder=1|Analytics Builder|Générateur d’analyses/);
      }
    }
    const paths: string[] = [];
    const base = assetsWith();
    const recording = { fetch: (input: Request) => (paths.push(new URL(input.url).pathname), base.fetch(input)) } as unknown as Fetcher;
    await html("/", on({ ASSETS: recording, BUILDER_DEMO: "on" }));
    expect(paths).not.toContain(`/data/buyers/${BUILD_BUYER}.json`);
  });

  it("while on, changes the page by the band alone and the stylesheet's address, which marks the band's rules", async () => {
    for (const make of [on, paid]) {
      for (const [lang, path] of PATHS) {
        const page = await html(path, make({ BUILDER_DEMO: "on", BUILDER: "on", RECORDS: recordsWith().db }));
        expect(page.match(/<section class="lp-feat lp-build"/g), lang).toHaveLength(1);
        expect(page).toContain(`<link rel="stylesheet" href="/landing.css?v=${LANDING_VERSION}&amp;${BUILDER_STYLES}"/>`);
        // The page with the builder on and its band off: the plan cards name the builder either way.
        expect(withoutBand(page), lang).toBe(await html(path, make({ BUILDER: "on" })));
      }
    }
    expect(landingStylesheet(false)).toBe(`/landing.css?v=${LANDING_VERSION}`);
    expect(landingStylesheet(true)).not.toBe(landingStylesheet(false));
  });
});

describe("the band", () => {
  it("says every word of the band in each language, the third point the plan cards' own dashboard line for Ultra", async () => {
    const row = PLAN_ROWS.find((r) => r.feature === "dashboards");
    expect(row).toBeDefined();
    for (const [lang, path] of PATHS) {
      const section = sectionOf(await html(path, band()));
      const text = textOf(section);
      const line = planLine(lang, row!.ultra);
      expect(dashboardLine(lang)).toBe(line);
      const vars = { line, buyer: nameOf(lang), source: sourceLabel(lang, BUILD_SOURCE), first: fiscalLabel(lang, FIRST), last: fiscalLabel(lang, CURRENT) };
      for (const key of BUILD_KEYS) expect(text, `${lang} ${key}`).toContain(textOf(t(lang, key, vars)));
      // The words first, in the page's own pieces: the eyebrow in plain words, the heading, the text, the three points, the link.
      expect(section).toContain(`<p class="lp-eyebrow">${t(lang, "landing.build_eyebrow").replace(/'/g, "&#39;")}</p>`);
      expect(section).toContain(`<h2 id="lp-build-h">`);
      expect(section.match(/<li><svg class="lp-ck"/g)).toHaveLength(3);
      expect(section).toContain('<a class="lp-link" href="#ultra">');
    }
    // The first point names what the builder's menus offer, by fiscal year.
    expect(t("en", "landing.build_any")).toBe("Buyers, segments and organizations by fiscal year, and buyers and segments by quarter, province or method");
    expect(t("fr", "landing.build_any")).toBe("Acheteurs, segments et organisations par exercice, et acheteurs et segments par trimestre, province ou méthode");
  });

  it("pictures the builder and the dashboard in their own words: the form in its order, the result, the tile", async () => {
    for (const [lang, path] of PATHS) {
      const section = nbsp(decode(sectionOf(await html(path, band()))));
      const w = (key: Key, vars?: Record<string, string>) => nbsp(t(lang, key, vars));
      const name = nameOf(lang);
      const source = sourceLabel(lang, BUILD_SOURCE);
      const [first, last] = [fiscalLabel(lang, FIRST), fiscalLabel(lang, CURRENT)];
      expect(section).toContain(`<p class="sc-h">${w("build.title")}</p>`);
      // The form's menus in its order: Buyer, Rows, Source, Show, then its button.
      expect(section).toContain(`<div class="fld f1"><span class="fld-l">${w("build.buyer")}</span><div class="fld-b"><span class="ph">${w("build.buyer_choose")}</span><span class="val">${name}</span>`);
      expect(section).toContain(`<div class="fld f2"><span class="fld-l">${w("build.rows")}</span><div class="fld-b"><span>${w("build.rows_year")}</span>`);
      expect(section).toContain(`<div class="fld f3"><span class="fld-l">${w("col.source")}</span><div class="fld-b"><span class="ph">${sourceLabel(lang, "awards")}</span><span class="val">${source}</span>`);
      expect(section).toContain(`<div class="fld f4"><span class="fld-l">${w("build.show")}</span><div class="fld-b sh"><span class="s1">${w("build.show_bars")}</span><span class="s2">${w("build.show_line")}</span><span class="s3">${w("build.show_table")}</span>`);
      expect(section).toContain(`<div class="go">${w("build.apply")}</div>`);
      // The result: what it says before a buyer is chosen, its title (the builder's own), what it is about, Add to dashboard, its line.
      expect(section).toContain(`<div class="pv-empty"><p class="pv-t">${nbsp(viewTitle(lang, CHOICE))}</p>${w("build.choose_buyer")}</div>`);
      expect(viewTitle(lang, CHOICE)).toBe(`${t(lang, "col.value")} ${t(lang, "build.by_year")}`);
      expect(section).toContain(`<p class="pv-t">${nbsp(viewTitle(lang, CHOICE))}</p>`);
      expect(section).toContain(`<p class="pv-s"><span>${name}</span><span class="add">${w("dash.add_here")}</span></p>`);
      expect(section).toContain(`<p class="pv-c">${w("build.as_of", { source, first, last, date: AS_OF })}</p>`);
      // The dashboard: its title, the status of a saved layout, the two other tiles' heads, the tile's head and foot.
      expect(section).toContain(`<p class="sc-h">${w("dash.title")}</p><span class="saved">${w("dash.status_saved")}</span>`);
      expect(section).toContain(`<i class="grip"></i><span>${w("dash.kind_tenders")}</span>`);
      expect(section).toContain(`<i class="grip"></i><span>${w("dash.kind_radar")}</span>`);
      expect(section).toContain(`<i class="grip"></i><span>${nbsp(viewTitle(lang, CHOICE))}<span class="it">${name}</span></span>`);
      expect(section).toContain(`<div class="tile-ft"><span>${w("analytics.lead", { source, first, last })}</span>` +
        `<span>${w("dash.shown", { n: fmtInt(BUILD_TILE_ROWS, lang), total: fmtInt(CELLS.length, lang) })}</span><span class="open">${w("dash.open")}</span></div>`);
      // Nothing the builder lacks: no year by the calendar, no typed field, no label on the largest bar.
      expect(section).not.toMatch(/Calendar year|Année civile|class="dl"|class="seg"|New view|Nouvelle vue/);
    }
    // The view is the address a buyer's analytics view opens in the builder: one buyer's published contracts, value by fiscal year.
    expect(buildAddress(CHOICE)).toBe(`/analytics/build?subject=buyer&b=${BUILD_BUYER}&rows=year&measure=value&source=contracts&from=${FIRST}&to=${CURRENT}&show=bars`);
  });

  it("sits after the matching notices' band and before the steps and the plans, and its link reaches Ultra's card", async () => {
    const page = await html("/", band());
    const at = (needle: string) => page.indexOf(needle);
    expect(at('class="lp-feat lp-paper lp-flip lp-fit"')).toBeGreaterThan(0);
    expect(at('class="lp-feat lp-build"')).toBeGreaterThan(at('class="lp-feat lp-paper lp-flip lp-fit"'));
    expect(at('class="lp-steps"')).toBeGreaterThan(at('class="lp-feat lp-build"'));
    expect(at('class="lp-pricing"')).toBeGreaterThan(at('class="lp-steps"'));
    expect(page).toContain('<div class="lp-plan lp-plan-ultra" id="ultra">');
    // On sale too: the card keeps its anchor.
    expect(await html("/", band({ STRIPE_SECRET_KEY: "sk_test_fake0000", STRIPE_WEBHOOK_SECRET: "whsec_fake0000" }))).toContain('id="ultra"');
  });

  it("adds no chip and no filled button, and hides its picture from assistive technology behind a description in the page's language", async () => {
    for (const [lang, path] of PATHS) {
      const page = await html(path, band());
      const section = sectionOf(page);
      expect(section).not.toMatch(/pro-tag|ultra-tag|lp-btn/);
      // The chips stay where they were: one each, on the plan cards.
      expect(page.match(/class="pro-tag"/g)).toHaveLength(1);
      expect(page.match(/class="ultra-tag"/g)).toHaveLength(1);
      expect(page.match(/lp-btn-fill/g)?.length).toBe((await html(path, on())).match(/lp-btn-fill/g)?.length);
      const description = t(lang, "landing.build_aria", {
        source: sourceLabel(lang, BUILD_SOURCE), buyer: nameOf(lang), first: fiscalLabel(lang, FIRST), last: fiscalLabel(lang, CURRENT),
      });
      expect(section.match(/aria-hidden="true">/g)?.length).toBe(5); // the stage, the three points' marks and the link's arrow
      expect(section).toMatch(/<div class="lp-stage"><div class="bd" aria-hidden="true">/);
      expect(section).toContain(`</div><p class="visually-hidden">${description.replace(/'/g, "&#39;")}</p></div>`);
      // Nothing in the picture takes the focus.
      const stage = /<div class="bd"[\s\S]*<\/div><p class="visually-hidden">/.exec(section)?.[0] ?? "";
      expect(stage).not.toMatch(/<a |<button|<input|tabindex/);
    }
  });
});

describe("the figures", () => {
  it("are the builder's own view, the eight fiscal years to the data date's, each written by the builder's formatters", async () => {
    expect(CELLS.map((c) => c.fy)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    for (const [lang, path] of PATHS) {
      const section = sectionOf(await html(path, band()));
      const cells = (html: string) => [...html.matchAll(/<div class="tr"><span>([^<]*)<\/span><span>([^<]*)<\/span><span>([^<]*)<\/span><\/div>/g)].map((m) => m.slice(1).map((s) => nbsp(decode(s))));
      const table = /<div class="pv-table">([\s\S]*?)<\/div><p class="pv-c">/.exec(section)?.[1] ?? "";
      // Newest first, as the builder's table lists fiscal years: the year to date marked, the value in whole dollars, the records.
      const newest = [...CELLS].reverse();
      expect(cells(table)).toEqual(newest.map((c) => [fyText(lang, c.fy), nbsp(fmtMoney((c.cents as number) / 100, lang)), nbsp(fmtInt(c.n, lang))]));
      expect(table).toContain(`<div class="tr th"><span>${t(lang, "analytics.col_fy")}</span><span>${t(lang, "col.value")}</span><span>${t(lang, "col.records")}</span></div>`);
      // The dashboard's tile: the same table's first four rows.
      const tile = /<div class="tile tn">([\s\S]*?)<i class="corner"><\/i>/.exec(section)?.[1] ?? "";
      expect(cells(tile)).toEqual(cells(table).slice(0, BUILD_TILE_ROWS));
      // The chart: the gridlines' labels in the axis's short form, every bar on one scale, oldest first.
      const ticks = [...section.matchAll(/<text class="tk" x="28" y="[\d.]+" text-anchor="end">([^<]*)<\/text>/g)].map((m) => m[1]);
      expect(ticks).toEqual([8e9, 16e9, 24e9].map((v) => fmtMoneyShort(v, lang)));
      const heights = [...section.matchAll(/<rect class="bar" style="--i:\d" x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)]
        .map((m) => ({ y: Number(m[1]), h: Number(m[2]) }));
      expect(heights).toHaveLength(8);
      const scale = (PLOT_BASE - PLOT_TOP) / 24e9;
      heights.forEach(({ y, h }, i) => {
        expect(Math.abs(h - ((CELLS[i].cents as number) / 100) * scale), String(CELLS[i].fy)).toBeLessThanOrEqual(0.051);
        expect(Math.abs(y + h - PLOT_BASE)).toBeLessThanOrEqual(0.051);
      });
      // The fiscal years under the bars, every other one from the first.
      const years = [...section.matchAll(/<text class="tk" x="[\d.]+" y="231" text-anchor="middle">([^<]*)<\/text>/g)].map((m) => m[1]);
      expect(years).toEqual([2019, 2021, 2023, 2025].map((y) => fiscalLabel(lang, y)));
      // The line runs through the bars' tops.
      const line = /<path class="ln" pathLength="1" d="([^"]+)"/.exec(section)?.[1] ?? "";
      expect([...line.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]))).toEqual(heights.map((b) => b.y));
    }
  });

  it("leave out a year with no value in dollars, and show the year to date only for the data date's fiscal year", async () => {
    const blank = CELLS.map((c) => (c.fy === 2023 ? { ...c, cents: null } : c));
    const section = sectionOf(await html("/", band({ RECORDS: recordsWith(blank).db })));
    const years = [...section.matchAll(/<div class="tr"><span>(\d{4}-\d{2})/g)].map((m) => m[1]);
    // The table, then the tile's first four.
    expect(years).toEqual(["2026-27", "2025-26", "2024-25", "2022-23", "2021-22", "2020-21", "2019-20", "2026-27", "2025-26", "2024-25", "2022-23"]);
    expect(section).toContain(`<span>${t("en", "dash.shown", { n: "4", total: "7" })}</span>`);
    // A view whose newest fiscal year has no row: no year to date.
    const earlier = sectionOf(await html("/", band({ RECORDS: recordsWith(CELLS.filter((c) => c.fy !== CURRENT)).db })));
    expect(earlier).toContain("lp-build");
    expect(earlier).not.toContain("(to date)");
  });

  it("read stats.json, the expiring index, the 3-month window's first page, one profile, the buyer file and one batch of the builder's statements", async () => {
    const paths: string[] = [];
    const base = assetsWith();
    const recording = { fetch: (input: Request) => (paths.push(new URL(input.url).pathname), base.fetch(input)) } as unknown as Fetcher;
    const records = recordsWith();
    const page = await html("/", band({ ASSETS: recording, RECORDS: records.db, ACCOUNTS: trap, SEARCH: trap, DB: trap }));
    expect(page).toContain('class="lp-feat lp-build"');
    expect([...new Set(paths)].sort()).toEqual([
      `/data/buyers/${BUILD_BUYER}.json`, "/data/expiring/3m/1.json", "/data/expiring/index.json", "/data/profiles/a00.json", "/data/stats.json",
    ]);
    expect(records.batches).toEqual([[
      { sql: STATE_SQL, params: [] }, { sql: CUBE_META_SQL, params: [] },
      { sql: BUYERS_YEARS_SQL, params: [JSON.stringify([BUILD_BUYER]), 0, 3, FIRST, CURRENT] },
    ]]);
  });

  it("ask the records database once a data date, however many visits, and again when the data date moves", async () => {
    const records = recordsWith();
    const first = sectionOf(await html("/", band({ RECORDS: records.db })));
    const again = sectionOf(await html("/", band({ RECORDS: records.db })));
    const french = sectionOf(await html("/?lang=fr", band({ RECORDS: records.db })));
    expect(first).toContain("lp-build");
    expect(again).toBe(first);
    expect(french).toContain("lp-build");
    expect(records.batches).toHaveLength(1);
    // The next night's data date: one read more, and no more after it.
    const next = assetsWith({ "stats.json": { ...stats, map: STATS_MAP, data_as_of: "2026-11-01" } });
    expect(sectionOf(await html("/", band({ ASSETS: next, RECORDS: records.db })))).toContain("lp-build");
    expect(sectionOf(await html("/", band({ ASSETS: next, RECORDS: records.db })))).toContain("lp-build");
    expect(records.batches).toHaveLength(2);
    // Another isolate's binding is another memory: it reads for itself.
    const other = recordsWith();
    await html("/", band({ RECORDS: other.db }));
    expect(other.batches).toHaveLength(1);
    expect(records.batches).toHaveLength(2);
  });

  it("do not ask a database that gave nothing again inside the wait", async () => {
    let asked = 0;
    const silent = {
      prepare: (sql: string) => ({ sql, params: [], bind: () => ({ sql, params: [] }) }),
      batch: async () => { asked++; throw new Error("D1_ERROR: the database did not answer"); },
    } as unknown as D1Database;
    for (let i = 0; i < 4; i++) expect(sectionOf(await html("/", band({ RECORDS: silent })))).toBe("");
    expect(asked).toBe(1);
    expect(BAND_RETRY_MS).toBe(60_000);
  });
});

describe("without its figures", () => {
  it("leaves the band out, and the page as it is with the band off, when the file, the database or the cube does not answer, or the years are short", async () => {
    const contracts = [...CELLS].sort((a, b) => b.fy - a.fy);
    const cases: [string, Record<string, unknown>][] = [
      ["the file missing", { ASSETS: assetsWith({ "buyers/dnd-mdn.json": undefined }) }],
      ["the file not JSON", { ASSETS: assetsWith({ "buyers/dnd-mdn.json": "{ not json" }) }],
      ["another buyer's file", { ASSETS: assetsWith({ "buyers/dnd-mdn.json": FILES["buyers/pwgsc-tpsgc.json"] }) }],
      ["no records database", { RECORDS: undefined }],
      ["the database failing", { RECORDS: recordsWith(CELLS, { fail: true }).db }],
      ["the database loading", { RECORDS: recordsWith(CELLS, { state: "loading" }).db }],
      ["the cube not filled", { RECORDS: recordsWith(CELLS, { cubeDate: null }).db }],
      ["three years", { RECORDS: recordsWith(contracts.slice(0, BUILD_MIN_YEARS - 1)).db }],
      ["no year", { RECORDS: recordsWith([]).db }],
      ["nothing above zero", { RECORDS: recordsWith(CELLS.map((c) => ({ ...c, cents: 0 }))).db }],
    ];
    for (const [what, extra] of cases) {
      for (const [lang, path] of PATHS) {
        const page = await html(path, band(extra));
        expect(page, `${what} ${lang}`).toBe(await html(path, on({ BUILDER: "on", ...("ASSETS" in extra ? { ASSETS: extra.ASSETS } : {}) })));
        expect(page, `${what} ${lang}`).not.toContain("lp-build");
      }
    }
    // Four years are enough.
    expect(await html("/", band({ RECORDS: recordsWith(contracts.slice(0, BUILD_MIN_YEARS)).db }))).toContain("lp-build");
  });
});

describe("the geometry", () => {
  const money = (v: number) => fmtMoneyShort(v, "en");
  const totals = CELLS.map((c) => ({ label: fiscalLabel("en", c.fy), value: (c.cents as number) / 100 }));

  it("picks round gridlines that just reach the largest value", () => {
    expect(tickStep(22_238_551_248.07)).toBe(8e9);
    expect(tickStep(24e9)).toBe(8e9);
    expect(tickStep(24.1e9)).toBe(10e9);
    expect(tickStep(3e9)).toBe(1e9);
    expect(tickStep(10)).toBe(4);
    expect(tickStep(4.4)).toBe(1.5);
    expect(tickStep(0)).toBe(1);
    expect(tickStep(Number.NaN)).toBe(1);
    for (const max of [1, 2.9, 7, 13, 99, 101, 1234, 5e8, 22.24e9]) {
      const step = tickStep(max);
      expect(step * CHART_TICKS, String(max)).toBeGreaterThanOrEqual(max);
      // The largest bar fills at least two thirds of the plot.
      expect(max / (step * CHART_TICKS), String(max)).toBeGreaterThanOrEqual(0.66);
    }
  });

  it("draws every bar, the line and the gridlines on one scale, inside the plot", () => {
    const c = buildChart(totals, money);
    expect(c.top).toBe(24e9);
    const scale = (PLOT_BASE - PLOT_TOP) / c.top;
    expect(c.bars).toHaveLength(8);
    c.bars.forEach((b, i) => {
      expect(Math.abs(b.h - totals[i].value * scale)).toBeLessThanOrEqual(0.051);
      expect(Math.abs(b.y + b.h - PLOT_BASE)).toBeLessThanOrEqual(0.051);
      expect(b.x).toBeGreaterThanOrEqual(PLOT_LEFT);
      expect(b.x + b.w).toBeLessThanOrEqual(PLOT_RIGHT);
      expect(c.points[i].y).toBe(b.y);
      expect(Math.abs(c.points[i].x - (b.x + b.w / 2))).toBeLessThanOrEqual(0.1);
      if (i) expect(b.x).toBeGreaterThan(c.bars[i - 1].x + c.bars[i - 1].w);
    });
    expect(c.line).toBe(c.points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(""));
    expect(c.ticks.map((k) => k.y)).toEqual([155, 95, 35]);
    expect(c.ticks.map((k) => k.text)).toEqual(["$8B", "$16B", "$24B"]);
    expect(c.ticks[CHART_TICKS - 1].y).toBe(PLOT_TOP);
    // Eight bars: every other fiscal year labelled, from the first; four bars: every one.
    expect(c.xLabels.map((l) => l.text)).toEqual(["2019-20", "2021-22", "2023-24", "2025-26"]);
    expect(buildChart(totals.slice(0, 4), money).xLabels.map((l) => l.text)).toEqual(["2019-20", "2020-21", "2021-22", "2022-23"]);
  });

  it("draws nothing below zero or for nothing at all", () => {
    const flat = buildChart([{ label: "a", value: 0 }, { label: "b", value: -4 }, { label: "c", value: Number.NaN }, { label: "d", value: 0 }], String);
    for (const b of flat.bars) {
      expect(b.h).toBe(0);
      expect(b.y).toBe(PLOT_BASE);
    }
    expect(flat.line).not.toContain("NaN");
  });
});

describe("the writing", () => {
  // The operator's list of words to avoid (test/guides.test.ts), and the house's own.
  const BANNED = [
    "delve", "tapestry", "testament", "beacon", "underscore", "pivotal", "intricate", "nuanced", "multifaceted", "realm", "landscape", "robust",
    "seamless", "leverage", "utilize", "comprehensive", "holistic", "meticulous", "foster", "harness", "unlock", "elevate", "empower",
    "streamline", "cutting-edge", "game-changer", "paradigm", "navigate", "boasts", "vibrant", "crucially", "importantly", "notably",
    "genuinely", "arguably", "load-bearing", "critically", "quietly", "airtight", "powerful", "effortless", "simply",
  ];

  it("has no dash, no banned word and no question in either language, in the strings or on the page", async () => {
    expect([...BUILD_KEYS].sort()).toEqual([
      "landing.build_any", "landing.build_aria", "landing.build_eyebrow", "landing.build_figures", "landing.build_heading", "landing.build_more",
      "landing.build_plan", "landing.build_text",
    ]);
    for (const key of BUILD_KEYS) {
      for (const lang of ["en", "fr"] as const) {
        const s = rawEntry(key)[lang];
        expect(s, key).not.toContain(EM_DASH);
        expect(s, key).not.toContain(EN_DASH);
        expect(s, key).not.toContain("?");
      }
      for (const word of BANNED) expect(new RegExp(`\\b${word}`, "i").test(rawEntry(key).en), `${key}: ${word}`).toBe(false);
    }
    for (const [lang, path] of PATHS) {
      const section = sectionOf(await html(path, band()));
      expect(section, lang).not.toContain(EM_DASH);
      expect(section, lang).not.toContain(EN_DASH);
      expect(section, lang).not.toMatch(/\{\w+\}/);
    }
    expect(LANDING_CSS).not.toContain(EN_DASH);
  });

  it("names nothing but its own words, the builder's and the dashboard's, the buyer and the figures", async () => {
    for (const [lang, path] of PATHS) {
      const name = nameOf(lang);
      const line = dashboardLine(lang) ?? "";
      const source = sourceLabel(lang, BUILD_SOURCE);
      const [first, last] = [fiscalLabel(lang, FIRST), fiscalLabel(lang, CURRENT)];
      const vars = { line, buyer: name, source, first, last, date: AS_OF, n: fmtInt(BUILD_TILE_ROWS, lang), total: fmtInt(CELLS.length, lang), fy: last };
      const known = [
        ...BUILD_KEYS.map((k) => t(lang, k, vars)), ...PICTURE_KEYS.map((k) => t(lang, k, vars)), viewTitle(lang, CHOICE), name,
        ...CELLS.flatMap((c) => [fyText(lang, c.fy), fiscalLabel(lang, c.fy), fmtInt(c.n, lang), fmtMoney((c.cents as number) / 100, lang)]),
        ...[8e9, 16e9, 24e9].map((v) => fmtMoneyShort(v, lang)),
      ].map(textOf).sort((a, b) => b.length - a.length);
      let rest = textOf(sectionOf(await html(path, band())));
      for (const s of known) rest = rest.split(s).join(" ");
      expect(rest.replace(/[\s.,;:]/g, ""), lang).toBe("");
    }
  });
});

describe("the stylesheet", () => {
  const block = LANDING_CSS.slice(LANDING_CSS.indexOf("/* -- the builder's band"), LANDING_CSS.indexOf("/* -- steps"));

  it("holds the band's rules: one 24-second timeline, the hold, the pause and the still for reduced motion", () => {
    expect(block.length).toBeGreaterThan(5000);
    expect(block).toContain(".bd { --dur: 24s;");
    expect(block).toContain(".bd * { animation-duration: var(--dur);");
    expect(block).toContain("animation-delay: calc(var(--scrub, 0) * -1s); }");
    expect(block).toContain(".bd.is-paused * { animation-play-state: paused; }");
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.bd \{ --scrub: 23; \}\s*\.bd \* \{ animation-play-state: paused; \}\s*\}/);
    // Every animation the band names is one of its own keyframes, and each is defined once.
    const named = new Set([...block.matchAll(/animation-name: ([\w-]+);/g)].map((m) => m[1]));
    const defined = [...block.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]);
    expect(new Set(defined).size).toBe(defined.length);
    expect([...named].sort()).toEqual([...defined].sort());
    for (const name of defined) {
      expect(name).toMatch(/^bd-/);
      expect(LANDING_CSS.match(new RegExp(`@keyframes ${name} `, "g"))).toHaveLength(1);
    }
    // Show is a menu whose value turns from Bars to Line to Table; the result's Add to dashboard is what the reader presses.
    for (const rule of [".bd .sh .s1 { animation-name: bd-show1; }", ".bd .sh .s2 { animation-name: bd-show2; }", ".bd .sh .s3 { animation-name: bd-show3; }",
      ".bd .add { flex: none; color: var(--em); font-weight: 600; animation-name: bd-press; }"]) expect(block, rule).toContain(rule);
    expect(block).not.toMatch(/\.seg\b|bd-type|bd-dl\b/);
    // The marker's width changes only out of sight (a defect the operator saw in the first draft).
    expect(block).toMatch(/@keyframes bd-mark \{[\s\S]*?85% \{ opacity: 0; width: 44\.5cqw; \}\s*85\.1%, 89\.5% \{ opacity: 0; width: 92cqw; \}/);
  });

  it("scopes every rule to the band and colours it with the page's tokens, each set in all three theme blocks", () => {
    const selectors = [...block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, "")
      .replace(/@media[^{]*\{/g, "").matchAll(/([^{}]+)\{[^}]*\}/g)].map((m) => m[1].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(40);
    for (const s of selectors) for (const one of s.split(",")) expect(one.trim(), one).toMatch(/^\.(?:bd|lp-build|lp-points|lp-stage)\b/);
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const used = new Set([...block.matchAll(/var\(--([\w-]+)/g)].map((m) => m[1]).filter((v) => !["scrub", "dur", "i", "display", "body", "r"].includes(v)));
    const blocks = [/:root \{([^}]*)\}/, /:root\[data-theme="dark"\] \{([^}]*)\}/, /:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/]
      .map((re) => re.exec(LANDING_CSS)?.[1] ?? "");
    for (const token of used) for (const b of blocks) expect(b, token).toContain(`--${token}:`);
    // The eyebrow in Ultra's sapphire, as plain words.
    expect(block).toContain(".lp-build .lp-eyebrow { color: var(--sap); }");
  });
});
