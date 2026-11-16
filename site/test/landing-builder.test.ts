// The landing page's band on the analytics builder (src/pages/landing.tsx
// BuildBand, docs/landing.md "The builder's band"): its switch, BUILDER_DEMO,
// ships "off" and leaves the page byte for byte as it is without the band;
// "on" with the accounts switch adds the band once in each language, its
// picture drawn from National Defence's buyer file (the fixture is that
// file's yearly rows as the site served them on 2026-11-15) by the site's
// own formatters, on one scale (src/landing_chart.ts); a file that does not
// read, or holds fewer than four years, leaves the band out.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wrangler from "../wrangler.jsonc?raw";
import { type Key, allKeys, fmtInt, fmtMoneyShort, rawEntry, sourceLabel, t } from "../src/i18n";
import { app } from "../src/index";
import { CHART_TICKS, PLOT_BASE, PLOT_LEFT, PLOT_RIGHT, PLOT_TOP, buildChart, tickStep } from "../src/landing_chart";
import {
  BUILDER_STYLES, BUILD_BUYER, BUILD_MIN_YEARS, BUILD_TILE_ROWS, BUILD_YEARS, LANDING_VERSION, builderDemoOn, dashboardLine, landingStylesheet,
} from "../src/pages/landing";
import { PLAN_ROWS, planLine } from "../src/pro";
import { decode, nbsp, onEnv, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import DND from "./fixtures/buyer-dnd-mdn.json";
import STATS_MAP from "./fixtures/stats-map.json";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const LANDING_CSS = (env as unknown as { LANDING_CSS: string }).LANDING_CSS;
const stats = FILES["stats.json"] as Record<string, any>;
// The fixtures' data date is 2026-10-31, so 2026 is the year to date.
const DATA_YEAR = Number(String(stats.data_as_of).slice(0, 4));

const assetsWith = (files: Record<string, unknown> = {}) =>
  makeFakeAssets({}, { "stats.json": { ...stats, map: STATS_MAP }, "buyers/dnd-mdn.json": DND, ...files });
const off = (extra: Record<string, unknown> = {}) => ({ ...testEnv(assetsWith()), ...extra });
const on = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS: assetsWith(), ...extra });
const paid = (extra: Record<string, unknown> = {}) => on({ STRIPE_SECRET_KEY: "sk_test_fake0000", STRIPE_WEBHOOK_SECRET: "whsec_fake0000", ...extra });
const band = (extra: Record<string, unknown> = {}) => on({ BUILDER_DEMO: "on", ...extra });

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

// The fixture's published contracts by year as the band must show them, read here from the file itself.
const CONTRACT_YEARS = (DND.years as { year: number; source: string; n: number; total: number | null }[])
  .filter((y) => y.source === "contracts" && y.year <= DATA_YEAR && y.total !== null)
  .sort((a, b) => a.year - b.year)
  .slice(-BUILD_YEARS) as { year: number; n: number; total: number }[];

const BUILD_KEYS = allKeys().filter((k) => k.startsWith("landing.build_"));

describe("the switch", () => {
  it("ships \"off\", and only \"on\" turns it on", () => {
    expect((env as unknown as { BUILDER_DEMO?: string }).BUILDER_DEMO).toBe("off");
    expect(wrangler).toMatch(/"BUILDER_DEMO":\s*"off"/);
    expect(builderDemoOn({ BUILDER_DEMO: "on" })).toBe(true);
    for (const v of ["off", "", "On", "ON", "true", "1", undefined]) expect(builderDemoOn({ BUILDER_DEMO: v }), String(v)).toBe(false);
  });

  it("while off, leaves the page byte for byte as it is, in both languages and both accounts states, and reads no buyer file", async () => {
    for (const make of [off, on, paid]) {
      for (const [lang, path] of PATHS) {
        const shipped = await html(path, make());
        expect(shipped, `${lang} shipped`).not.toContain("lp-build");
        for (const v of [undefined, "off", "", "On", "true"]) {
          expect(await html(path, make({ BUILDER_DEMO: v })), `${lang} ${String(v)}`).toBe(shipped);
        }
        // With the accounts switch off the band never shows: it names Ultra, which does not exist then.
        if (make === off) expect(await html(path, off({ BUILDER_DEMO: "on" })), `${lang} accounts off`).toBe(shipped);
        expect(shipped).toContain(`<link rel="stylesheet" href="/landing.css?v=${LANDING_VERSION}"/>`);
        for (const key of ["landing.build_eyebrow", "landing.build_heading", "landing.build_text", "landing.build_any", "landing.build_figures",
          "landing.build_more", "landing.build_new", "landing.build_choose_buyer", "landing.build_empty"] as const) {
          expect(textOf(shipped), `${lang} ${key}`).not.toContain(textOf(t(lang, key)));
        }
        expect(shipped).not.toMatch(/class="bd"|builder=1|Calendar year|Année civile/);
      }
    }
    const paths: string[] = [];
    const base = assetsWith();
    const recording = { fetch: (input: Request) => (paths.push(new URL(input.url).pathname), base.fetch(input)) } as unknown as Fetcher;
    await html("/", on({ ASSETS: recording }));
    expect(paths).not.toContain(`/data/buyers/${BUILD_BUYER}.json`);
  });

  it("while on, changes the page by the band alone and the stylesheet's address, which marks the band's rules", async () => {
    for (const make of [on, paid]) {
      for (const [lang, path] of PATHS) {
        const page = await html(path, make({ BUILDER_DEMO: "on" }));
        expect(page.match(/<section class="lp-feat lp-build"/g), lang).toHaveLength(1);
        expect(page).toContain(`<link rel="stylesheet" href="/landing.css?v=${LANDING_VERSION}&amp;${BUILDER_STYLES}"/>`);
        expect(withoutBand(page), lang).toBe(await html(path, make()));
      }
    }
    expect(landingStylesheet(false)).toBe(`/landing.css?v=${LANDING_VERSION}`);
    expect(landingStylesheet(true)).not.toBe(landingStylesheet(false));
  });
});

describe("the band", () => {
  it("says every word of the draft in each language, the third point the plan cards' own dashboard line for Ultra", async () => {
    const row = PLAN_ROWS.find((r) => r.feature === "dashboards");
    expect(row).toBeDefined();
    for (const [lang, path] of PATHS) {
      const section = sectionOf(await html(path, band()));
      const text = textOf(section);
      const line = planLine(lang, row!.ultra);
      expect(dashboardLine(lang)).toBe(line);
      expect(text).toContain(textOf(t(lang, "landing.build_plan", { line })));
      const name = lang === "fr" ? DND.buyer.name_fr : DND.buyer.name_en;
      const filled: Partial<Record<Key, Record<string, string>>> = {
        "landing.build_plan": { line },
        "landing.build_title": { buyer: name },
        "landing.build_caption": { source: sourceLabel(lang, "contracts"), year: String(DATA_YEAR) },
        "landing.build_shown": { n: fmtInt(BUILD_TILE_ROWS, lang), total: fmtInt(CONTRACT_YEARS.length, lang) },
        "landing.build_aria": { buyer: name, first: String(CONTRACT_YEARS[0].year), last: String(DATA_YEAR) },
      };
      for (const key of BUILD_KEYS) expect(text, `${lang} ${key}`).toContain(textOf(t(lang, key, filled[key])));
      // The words first, in the page's own pieces: the eyebrow in plain words, the heading, the text, the three points, the link.
      expect(section).toContain(`<p class="lp-eyebrow">${t(lang, "landing.build_eyebrow").replace(/'/g, "&#39;")}</p>`);
      expect(section).toContain(`<h2 id="lp-build-h">`);
      expect(section.match(/<li><svg class="lp-ck"/g)).toHaveLength(3);
      expect(section).toContain('<a class="lp-link" href="#ultra">');
    }
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
      const name = lang === "fr" ? DND.buyer.name_fr : DND.buyer.name_en;
      const description = t(lang, "landing.build_aria", { buyer: name, first: String(CONTRACT_YEARS[0].year), last: String(DATA_YEAR) });
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
  it("are the buyer file's published contracts, the last eight years to the data date, each written by the site's formatters", async () => {
    expect(CONTRACT_YEARS.map((y) => y.year)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    for (const [lang, path] of PATHS) {
      const section = sectionOf(await html(path, band()));
      const table = /<div class="pv-table">([\s\S]*?)<\/div><p class="pv-c">/.exec(section)?.[1] ?? "";
      const rows = [...table.matchAll(/<div class="tr"><span>([^<]*)<\/span><span>([^<]*)<\/span><span>([^<]*)<\/span><\/div>/g)].map((m) => m.slice(1));
      expect(rows).toEqual(CONTRACT_YEARS.map((y) => [String(y.year), fmtInt(y.n, lang), fmtMoneyShort(y.total, lang)]));
      expect(table).toContain(`<div class="tr th"><span>${t(lang, "landing.build_col_year")}</span>`);
      // The dashboard's tile: the same table's first four rows, and how many of them it shows.
      const tile = /<div class="tile tn">([\s\S]*?)<i class="corner"><\/i>/.exec(section)?.[1] ?? "";
      const tileRows = [...tile.matchAll(/<div class="tr"><span>([^<]*)<\/span><span>([^<]*)<\/span><span>([^<]*)<\/span><\/div>/g)].map((m) => m.slice(1));
      expect(tileRows).toEqual(rows.slice(0, BUILD_TILE_ROWS));
      expect(tile).toContain(`<span>${sourceLabel(lang, "contracts")}</span><span>${t(lang, "landing.build_shown", { n: "4", total: "8" })}</span>`);
      // The buyer's name, typed into the first menu and heading the chart and the tile.
      const name = lang === "fr" ? DND.buyer.name_fr : DND.buyer.name_en;
      expect(section).toContain(`<span class="val">${name}</span>`);
      // The newest year is the data date's, and the caption says it is the year to date.
      expect(nbsp(section)).toContain(`<p class="pv-c">${nbsp(t(lang, "landing.build_caption", { source: sourceLabel(lang, "contracts"), year: "2026" }))}</p>`);
      // The chart: the gridlines' labels, the largest bar's label (2024's), every bar on one scale.
      const ticks = [...section.matchAll(/<text class="tk" x="28" y="[\d.]+" text-anchor="end">([^<]*)<\/text>/g)].map((m) => m[1]);
      expect(ticks).toEqual([8e9, 16e9, 24e9].map((v) => fmtMoneyShort(v, lang)));
      const peak = Math.max(...CONTRACT_YEARS.map((y) => y.total));
      expect(section).toMatch(new RegExp(`<text class="dl" x="[\\d.]+" y="[\\d.]+" text-anchor="middle">${fmtMoneyShort(peak, lang).replace(/\$/g, "\\$")}</text>`));
      const heights = [...section.matchAll(/<rect class="bar" style="--i:\d" x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)]
        .map((m) => ({ y: Number(m[1]), h: Number(m[2]) }));
      expect(heights).toHaveLength(8);
      const scale = (PLOT_BASE - PLOT_TOP) / 24e9;
      heights.forEach(({ y, h }, i) => {
        expect(Math.abs(h - CONTRACT_YEARS[i].total * scale), String(CONTRACT_YEARS[i].year)).toBeLessThanOrEqual(0.051);
        expect(Math.abs(y + h - PLOT_BASE)).toBeLessThanOrEqual(0.051);
      });
      // The line runs through the bars' tops.
      const line = /<path class="ln" pathLength="1" d="([^"]+)"/.exec(section)?.[1] ?? "";
      expect([...line.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]))).toEqual(heights.map((b) => b.y));
    }
    // The figures in the draft the operator approved, read from the same file the same day.
    expect(CONTRACT_YEARS.map((y) => fmtMoneyShort(y.total, "en"))).toEqual(["$11.6B", "$7.1B", "$3.9B", "$13.7B", "$15.8B", "$22.2B", "$16.9B", "$11.3B"]);
  });

  it("leave out a year after the data date's and a year with no total in dollars, and drop the caption's year to date when the newest year is earlier", async () => {
    const rows = DND.years as Record<string, unknown>[];
    const later = { ...rows.find((y) => y.source === "contracts" && y.year === 2026), year: 2027, total: 99e9 };
    const blank = rows.map((y) => (y.source === "contracts" && y.year === 2023 ? { ...y, total: null } : y));
    const section = sectionOf(await html("/", band({ ASSETS: assetsWith({ "buyers/dnd-mdn.json": { ...DND, years: [later, ...blank] } }) })));
    const years = [...section.matchAll(/<div class="tr"><span>(\d{4})<\/span>/g)].map((m) => Number(m[1]));
    // The table, then the tile's first four.
    expect(years).toEqual([2018, 2019, 2020, 2021, 2022, 2024, 2025, 2026, 2018, 2019, 2020, 2021]);
    expect(section).not.toContain("$99B");
    // A file whose newest year is before the data date's: no year to date.
    const earlier = rows.filter((y) => !(y.source === "contracts" && y.year === 2026));
    const plain = sectionOf(await html("/", band({ ASSETS: assetsWith({ "buyers/dnd-mdn.json": { ...DND, years: earlier } }) })));
    expect(plain).toContain(`<p class="pv-c">${sourceLabel("en", "contracts")}</p>`);
    expect(plain).not.toContain("year to date");
  });

  it("read stats.json, the expiring index, the 3-month window's first page, one profile and the buyer file, and no database", async () => {
    const paths: string[] = [];
    const base = assetsWith();
    const recording = { fetch: (input: Request) => (paths.push(new URL(input.url).pathname), base.fetch(input)) } as unknown as Fetcher;
    const trap = new Proxy({}, { get: () => { throw new Error("a database was read"); } }) as unknown as D1Database;
    const page = await html("/", band({ ASSETS: recording, ACCOUNTS: trap, SEARCH: trap, RECORDS: trap, DB: trap }));
    expect(page).toContain('class="lp-feat lp-build"');
    expect([...new Set(paths)].sort()).toEqual([
      `/data/buyers/${BUILD_BUYER}.json`, "/data/expiring/3m/1.json", "/data/expiring/index.json", "/data/profiles/a00.json", "/data/stats.json",
    ]);
  });
});

describe("without its figures", () => {
  it("leaves the band out, and the page as it is with the switch off, when the file is missing, unreadable or short", async () => {
    const rows = DND.years as Record<string, unknown>[];
    const contracts = rows.filter((y) => y.source === "contracts").sort((a, b) => Number(b.year) - Number(a.year));
    const short = [...rows.filter((y) => y.source !== "contracts"), ...contracts.slice(0, BUILD_MIN_YEARS - 1)];
    const zero = rows.map((y) => (y.source === "contracts" ? { ...y, total: 0 } : y));
    const cases: [string, unknown][] = [
      ["missing", undefined], ["not JSON", "{ not json"], ["another buyer's file", FILES["buyers/pwgsc-tpsgc.json"]],
      ["rows of the wrong shape", { ...DND, years: [{ year: "2026" }] }], ["three years", { ...DND, years: short }],
      ["no contracts", { ...DND, years: rows.filter((y) => y.source !== "contracts") }], ["nothing above zero", { ...DND, years: zero }],
    ];
    for (const [what, file] of cases) {
      for (const [lang, path] of PATHS) {
        const assets = assetsWith({ "buyers/dnd-mdn.json": file });
        const page = await html(path, band({ ASSETS: assets }));
        expect(page, `${what} ${lang}`).toBe(await html(path, on({ ASSETS: assets })));
        expect(page, `${what} ${lang}`).not.toContain("lp-build");
      }
    }
    // Four years are enough.
    const four = [...rows.filter((y) => y.source !== "contracts"), ...contracts.slice(0, BUILD_MIN_YEARS)];
    expect(await html("/", band({ ASSETS: assetsWith({ "buyers/dnd-mdn.json": { ...DND, years: four } }) }))).toContain("lp-build");
  });
});

describe("the geometry", () => {
  const money = (v: number) => fmtMoneyShort(v, "en");
  const totals = CONTRACT_YEARS.map((y) => ({ label: String(y.year), value: y.total }));

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

  it("draws every bar, the line and the gridlines on one scale, inside the plot, and labels the largest bar", () => {
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
    expect(c.peak).toEqual({ index: 5, x: c.points[5].x, y: Math.round((c.bars[5].y - 5) * 10) / 10, text: "$22.2B" });
    // Eight bars: every other year labelled, from the first; four bars: every year.
    expect(c.xLabels.map((l) => l.text)).toEqual(["2019", "2021", "2023", "2025"]);
    expect(buildChart(totals.slice(0, 4), money).xLabels.map((l) => l.text)).toEqual(["2019", "2020", "2021", "2022"]);
  });

  it("labels the first of two equal largest bars, and draws nothing below zero or for nothing at all", () => {
    expect(buildChart([{ label: "a", value: 5 }, { label: "b", value: 9 }, { label: "c", value: 9 }, { label: "d", value: 1 }], String).peak.index).toBe(1);
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
    expect(BUILD_KEYS.length).toBe(31);
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

  it("names nothing but its own words, the buyer and the plan: every word on the band is one of the band's strings", async () => {
    // The capitalized words of the strings, past each sentence's first: the plan's name and the menu's figure, nothing else.
    for (const key of BUILD_KEYS) {
      for (const lang of ["en", "fr"] as const) {
        const s = rawEntry(key)[lang].replace(/\{\w+\}/g, "");
        const inner = [...s.matchAll(/(?<![.:;]\s|^)\b(\p{Lu}[\p{L}'-]*)/gu)].map((m) => m[1]);
        for (const word of inner) expect(["Ultra", "Value", "Valeur"], `${key} ${lang}: ${word}`).toContain(word);
      }
    }
    for (const [lang, path] of PATHS) {
      const name = lang === "fr" ? DND.buyer.name_fr : DND.buyer.name_en;
      const line = dashboardLine(lang) ?? "";
      const known = [
        ...BUILD_KEYS.map((k) => t(lang, k, { line, buyer: name, source: sourceLabel(lang, "contracts"), year: String(DATA_YEAR), first: "2019", last: "2026",
          n: fmtInt(BUILD_TILE_ROWS, lang), total: fmtInt(8, lang) })),
        name, sourceLabel(lang, "contracts"),
        ...CONTRACT_YEARS.flatMap((y) => [String(y.year), fmtInt(y.n, lang), fmtMoneyShort(y.total, lang)]),
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
    // The two defects the operator saw in the first draft: the highlight inside the control, the marker's width changed out of sight.
    expect(block).toContain(".bd .seg i { box-sizing: border-box;");
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
