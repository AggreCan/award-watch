// The home page's Canada map (src/pages/home_map.tsx, src/canada_map.ts,
// public/canada-map.js): the panel under the head with every layer's
// figures in the markup, the buttons and their pressed state, the links
// each layer's provinces open (the same-day ones gated as /tenders/same-day
// is), the not-stated line, the table under the map, no panel from an export
// without stats.json "map", both languages, the stylesheet's tokens in both
// palettes, and the lists the links open honouring their province filter.
// The same-day layer is counted from rows in a real local D1 with
// pipeline/intraday_schema.sql applied, as test/intraday.test.ts does.
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import mapJs from "../public/canada-map.js?raw";
import { INSET_BORDERS, INSET_PATHS, MAP_BORDERS, MAP_HEIGHT, MAP_LABELS, MAP_PATHS, MAP_WIDTH } from "../src/canada_map";
import { PROVINCES } from "../src/constants";
import { provinceCounts, type TenderRow } from "../src/data";
import { STYLES_VERSION } from "../src/layout";
import { MAP_STEPS, firstLayer, mapLayers, mapStep, stepRanges } from "../src/pages/home_map";
import { INTRADAY_SQL } from "../src/intraday";
import { SAME_DAY_COUNTS_MS, forgetSameDayCounts } from "../src/pages/intraday";
import { get, grantPro, nbsp, newEmail, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { makeFakeAssets, testEnv } from "./assets";
import stats from "./fixtures/stats.json";
import map from "./fixtures/stats-map.json";
import { applySql } from "./setup";

useAccountsDb();

const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const SCHEMA = (env as unknown as { INTRADAY_SCHEMA_SQL: string }).INTRADAY_SCHEMA_SQL;
const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
const EM_DASH = String.fromCharCode(0x2014);
const DATA_DATE = "2026-10-31";

// The day's new notices for the filter on /tenders/new: stated, derived, both, none.
const DAY_ROWS = (() => {
  const base = { amendment: 0, title_fr: null, buyer_id: "pwgsc-tpsgc", buyer_en: "Public Services and Procurement Canada",
    buyer_fr: null, published: DATA_DATE, closing: "2026-11-20T14:00:00", category: ["SRV"], notice_type_en: null, notice_type_fr: null,
    method_en: null, method_fr: null, segments: [], first_seen: DATA_DATE, status: "open", source_status: "open" };
  return [
    { ...base, reference: "cb-610-61000001", title_en: "Stated in Ontario", provinces: ["ON"] },
    { ...base, reference: "cb-610-61000002", title_en: "Derived to Ontario", provinces: [], provinces_derived: ["ON"], provinces_from: "delivery" },
    { ...base, reference: "cb-610-61000003", title_en: "Stated in Quebec", provinces: ["QC"] },
    { ...base, reference: "cb-610-61000004", title_en: "Canada-wide notice", provinces: [] },
  ];
})();

const withMap = (extra: Record<string, unknown> = {}) =>
  makeFakeAssets({}, { "stats.json": { ...stats, map }, [`tenders/new/${DATA_DATE}.json`]: DAY_ROWS, ...extra });
const on = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS: withMap(), ...extra });
const off = () => testEnv(withMap());
const html = async (path: string, o: { env?: object; cookie?: string } = {}) => nbsp(await (await get(path, o)).text());

const PANEL = /<section class="panel cmap-panel">[\s\S]*?<\/section>/;
const panelOf = (page: string) => PANEL.exec(page)?.[0] ?? "";
// The SVG's links of one layer, by province: the shapes on the main map and in the inset.
const layerLinks = (panel: string, layer: string) => {
  const groups = panel.match(new RegExp(`<g class="cmap-layer" data-for="${layer}">[\\s\\S]*?</g>`, "g")) ?? [];
  return [...groups.join("").matchAll(/<a href="([^"]*)" tabindex="-1"><use href="#cmi?-(\w\w)"/g)].map((m) => [m[2], m[1]]);
};
const tableOf = (panel: string) => /<table[\s\S]*?<\/table>/.exec(panel)?.[0] ?? "";
const rowOf = (table: string, name: string) => new RegExp(`<tr><td data-label="[^"]*">${name}</td>[\\s\\S]*?</tr>`).exec(table)?.[0] ?? "";

// The same-day rows: ON twice (one of them in QC too), BC, and one with no province. One more is already listed by
// the nightly at the same amendment, so the band, and the count, leave it out.
type Seed = { reference: string; provinces: string; seen?: string };
const SAME_DAY: Seed[] = [
  { reference: "cb-620-62000001", provinces: '["ON"]' },
  { reference: "cb-620-62000002", provinces: '["ON","QC"]' },
  { reference: "cb-620-62000003", provinces: '["BC"]' },
  { reference: "cb-620-62000004", provinces: "[]" },
  { reference: "cb-200-20005019", provinces: '["BC"]' },
  { reference: "cb-620-62000005", provinces: '["NS"]', seen: "2026-10-30T23:45:00Z" },
];

async function seed(rows: Seed[] = SAME_DAY): Promise<void> {
  await applySql(SEARCH, SCHEMA);
  await SEARCH.prepare("DELETE FROM intraday_tenders").run();
  await SEARCH.batch(rows.map((r) => SEARCH.prepare(
    "INSERT INTO intraday_tenders (reference, amendment, seen_at, title_en, provinces) VALUES (?, 0, ?, ?, ?)",
  ).bind(r.reference, r.seen ?? "2026-10-31T15:45:10Z", `Same-day ${r.reference}`, r.provinces)));
}

let freeCookie = "";
let proCookie = "";
beforeAll(async () => {
  await seed();
  freeCookie = await signIn(newEmail("map-free"));
  const pro = newEmail("map-pro");
  proCookie = await signIn(pro);
  await grantPro(pro);
});
beforeEach(() => forgetSameDayCounts());

// -- the scale ---------------------------------------------------------------------------

describe("the fills", () => {
  it("step on a square-root scale of the layer's largest count, none for a province with no notice", () => {
    expect(MAP_STEPS).toBe(4);
    expect([0, 1, 5, 6, 22, 23, 50, 51, 90].map((n) => mapStep(n, 90))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(mapStep(1, 1)).toBe(4);
    expect(mapStep(0, 0)).toBe(0);
    // A boundary in whole numbers: 16 of 256 is exactly a quarter's square, the first step.
    expect([mapStep(16, 256), mapStep(17, 256)]).toEqual([1, 2]);
  });

  it("show in the legend only the steps a count can reach, each the counts it covers", () => {
    expect(stepRanges(90)).toEqual([{ step: 1, lo: 1, hi: 5 }, { step: 2, lo: 6, hi: 22 }, { step: 3, lo: 23, hi: 50 }, { step: 4, lo: 51, hi: 90 }]);
    expect(stepRanges(14)).toEqual([{ step: 2, lo: 1, hi: 3 }, { step: 3, lo: 4, hi: 7 }, { step: 4, lo: 8, hi: 14 }]);
    expect(stepRanges(1)).toEqual([{ step: 4, lo: 1, hi: 1 }]);
    expect(stepRanges(0)).toEqual([]);
    for (const top of [1, 2, 3, 7, 14, 90, 260, 1000]) {
      for (const r of stepRanges(top)) for (const n of [r.lo, r.hi]) expect(mapStep(n, top), `${n} of ${top}`).toBe(r.step);
    }
  });

  it("count a notice once in each province it is placed in, stated or derived, as the pipeline does", () => {
    const row = (provinces: string[], derived?: string[]) => ({ provinces, ...(derived ? { provinces_derived: derived } : {}) }) as TenderRow;
    const counts = provinceCounts([row(["BC"]), row([], ["BC"]), row(["ON", "QC"]), row(["ON"], ["NS"]), row([]), row(["XX"])]);
    expect(counts.n).toBe(6);
    expect(counts.not_stated).toBe(2);
    expect(counts.provinces).toEqual({ ...Object.fromEntries(PROVINCES.map((p) => [p, 0])), BC: 2, ON: 2, QC: 1, NS: 1 });
  });

  it("have an outline and a label for every province and territory, the Maritimes also in the inset", () => {
    expect(Object.keys(MAP_PATHS).sort()).toEqual([...PROVINCES]);
    for (const p of PROVINCES) expect(MAP_PATHS[p], p).toMatch(/^M\d+ \d+l[-\d ]+z/);
    expect(Object.keys(INSET_PATHS).sort()).toEqual(["NB", "NS", "PE"]);
    for (const p of PROVINCES) {
      const { x, y, inset } = MAP_LABELS[p];
      expect(inset, p).toBe(["NB", "NS", "PE"].includes(p));
      expect(x > 0 && x < MAP_WIDTH && y > 0 && y < MAP_HEIGHT, p).toBe(true);
    }
  });

  it("carry the land borders as open lines that lie on the outlines, every pair of neighbours and no strait", () => {
    type P = [number, number];
    const nums = (s: string) => [...s.matchAll(/-?\d+/g)].map((m) => Number(m[0]));
    // Path data as the script writes it: each part one absolute move and relative steps.
    const lines = (d: string): P[][] => d.split("M").filter(Boolean).map((part) => {
      const [head, steps] = part.replace(/z$/, "").split("l");
      let [x, y] = nums(head);
      const line: P[] = [[x, y]];
      const v = nums(steps);
      for (let i = 0; i < v.length; i += 2) line.push([(x += v[i]), (y += v[i + 1])]);
      if (part.endsWith("z")) line.push(line[0]);
      return line;
    });
    const segments = (ls: P[][]) => ls.flatMap((l) => l.slice(1).map((b, i): [P, P] => [l[i], b]));
    const reach = (p: P, segs: [P, P][]) => {
      let best = Infinity;
      for (const [[ax, ay], [bx, by]] of segs) {
        const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len));
        best = Math.min(best, Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy)));
      }
      return best;
    };
    const check = (borders: string, paths: Readonly<Record<string, string>>, pairs: [string, string][]) => {
      expect(borders).toMatch(/^(?:M\d+ \d+l[-\d ]+)+$/); // open lines: no ring closes
      const outline = Object.fromEntries(Object.entries(paths).map(([code, d]) => [code, segments(lines(d))]));
      const every = Object.values(outline).flat();
      const drawn = lines(borders);
      // Every point of a border is a point of an outline (the script rounds a line's two ends to whole units).
      for (const p of drawn.flat()) expect(reach(p, every), String(p)).toBeLessThanOrEqual(1);
      // Each pair of neighbours has a stretch of border that lies on both of them.
      const middles = segments(drawn).map(([a, b]): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      for (const [a, b] of pairs) {
        expect(middles.some((m) => reach(m, outline[a]) <= 1.5 && reach(m, outline[b]) <= 1.5), `${a} and ${b}`).toBe(true);
      }
      // A strait is not a border: nothing is drawn along Prince Edward Island.
      for (const p of drawn.flat()) expect(reach(p, outline.PE), String(p)).toBeGreaterThan(2);
    };
    check(MAP_BORDERS, MAP_PATHS, [
      ["AB", "BC"], ["AB", "NT"], ["AB", "SK"], ["BC", "NT"], ["BC", "YT"], ["MB", "NU"], ["MB", "ON"], ["MB", "SK"],
      ["NB", "NS"], ["NB", "QC"], ["NL", "QC"], ["NT", "NU"], ["NT", "SK"], ["NT", "YT"], ["ON", "QC"],
    ]);
    check(INSET_BORDERS, INSET_PATHS, [["NB", "NS"]]);
  });
});

// -- the panel ----------------------------------------------------------------------------

describe("the map panel", () => {
  it("sits under the head, before the tiles and the first list, with every layer's figures in the markup", async () => {
    const page = await html("/", { env: on() });
    const panel = panelOf(page);
    expect(panel).toContain("<h2>Tender Notices by Province</h2>");
    const head = page.indexOf('<header class="page-head">');
    expect(head).toBeGreaterThan(-1);
    expect(page.indexOf(panel)).toBeGreaterThan(head);
    expect(page.indexOf(panel)).toBeLessThan(page.indexOf('<section class="tiles"'));
    expect(page.indexOf(panel)).toBeLessThan(page.indexOf("<h2>New Tender Notices Today</h2>"));
    // The first layer shown, the others in the markup for the stylesheet to show.
    expect(panel).toContain('<div class="cmap" id="canada-map" data-layer="new_today" style="--cmap-list-min:528px">');
    for (const layer of ["new_today", "open", "closing_7d", "same_day"]) {
      expect(panel.match(new RegExp(`<g class="cmap-layer" data-for="${layer}">`, "g")), layer).toHaveLength(2);
      expect(panel).toContain(`<p class="cmap-caption" data-for="${layer}">`);
      expect(panel).toContain(`<div class="cmap-key" data-for="${layer}">`);
    }
    expect(panel).toContain('<p class="cmap-caption" data-for="new_today">46 new notices today</p>');
    expect(panel).toContain('<p class="cmap-caption" data-for="open">854 open notices</p>');
    expect(panel).toContain('<p class="cmap-caption" data-for="closing_7d">120 notices closing within 7 days</p>');
    // The same-day notices the band lists: two in ON, one in QC, one in BC, one in none; the listed one and the
    // one read before the data date left out.
    expect(panel).toContain('<p class="cmap-caption" data-for="same_day">4 notices posted since this morning&#39;s refresh</p>');
    // Each province's figure on the map, a label a layer: the code over its count.
    expect(panel).toMatch(/<text class="cmap-label" x="\d+" y="\d+">ON<tspan class="cmap-count" x="\d+" dy="22">260<\/tspan><\/text>/);
    expect(panel).toMatch(/<text class="cmap-label" x="\d+" y="\d+">PE<tspan class="cmap-count" x="\d+" dy="22">8<\/tspan><\/text>/);
    // The outlines once, in the defs, placed by each layer.
    expect(panel.match(/<path id="cm-ON"/g)).toHaveLength(1);
    expect(panel.match(/<path id="cm-borders"/g)).toHaveLength(1);
    expect(panel.match(/<path id="cmi-borders"/g)).toHaveLength(1);
    // Twice a layer: its fill, and its clear outline for the pointer.
    expect(panel.match(/<use href="#cm-ON"/g)).toHaveLength(8);
    // The fills of the open layer: Ontario the largest count, the top step; Prince Edward Island's 8 the first.
    const open = panel.match(/<g class="cmap-layer" data-for="open">[\s\S]*?<\/g>/)?.[0] ?? "";
    expect(open).toContain('<use href="#cm-ON" class="cmap-s4">');
    expect(open).toContain('<use href="#cm-PE" class="cmap-s1">');
    // A layer's three passes, then its labels: the fills, the land borders as a gap, each province's clear outline.
    const gap = open.indexOf('<use href="#cm-borders" class="cmap-borders"></use>');
    expect(gap).toBeGreaterThan(open.lastIndexOf('class="cmap-s'));
    expect(open.indexOf('class="cmap-hit"')).toBeGreaterThan(gap);
    expect(open.lastIndexOf('class="cmap-hit"')).toBeLessThan(open.indexOf('<text class="cmap-label"'));
    expect(open.match(/class="cmap-hit"/g)).toHaveLength(PROVINCES.length);
    // The inset the same, with its own border.
    const inset = panel.match(/<g class="cmap-layer" data-for="open">[\s\S]*?<\/g>/g)?.[1] ?? "";
    expect(inset).toMatch(/class="cmap-s\d"><\/use><use href="#cmi-borders" class="cmap-borders"><\/use><(?:a|use) /);
    expect(inset.match(/class="cmap-hit"/g)).toHaveLength(3);
    expect(page).toContain('<script src="/canada-map.js" defer=""></script>');
  });

  it("keeps the map from assistive technology and the tab order, and its buttons in a labelled group with their pressed state", async () => {
    const panel = panelOf(await html("/", { env: on() }));
    expect(panel).toContain('<svg class="cmap-svg" viewBox="0 0 1000 858" aria-hidden="true" focusable="false">');
    expect(panel).not.toMatch(/<a href="[^"]*"><use/);
    const group = /<div class="cmap-toggles" role="group" aria-label="Map layer">[\s\S]*?<\/div>/.exec(panel)?.[0] ?? "";
    const buttons = [...group.matchAll(/<button type="button" class="btn" data-map-layer="(\w+)" aria-pressed="(true|false)">([^<]*)/g)]
      .map((m) => [m[1], m[2], m[3]]);
    expect(buttons).toEqual([
      ["new_today", "true", "New today"], ["open", "false", "Open"], ["closing_7d", "false", "Closing within 7 days"], ["same_day", "false", "Same day"],
    ]);
    // The script switches the wrapper's attribute and the pressed state, and nothing else.
    expect(mapJs).toContain('map.setAttribute("data-layer"');
    expect(mapJs).toContain('setAttribute("aria-pressed"');
    expect(mapJs).not.toMatch(/innerHTML|textContent\s*=|fetch\(|insertAdjacent|createElement/);
  });

  it("opens the open notices on the day of no new one", async () => {
    const quiet = { ...map, new_today: { n: 0, not_stated: 0, provinces: {} } };
    const panel = panelOf(await html("/", { env: onEnv({ ASSETS: withMap({ "stats.json": { ...stats, map: quiet } }) }) }));
    expect(panel).toContain('data-layer="open"');
    expect(panel).toContain('data-map-layer="open" aria-pressed="true"');
    expect(panel).toContain('<p class="cmap-caption" data-for="new_today">0 new notices today</p>');
    expect(firstLayer(mapLayers("en", map, null, false, DATA_DATE))).toBe("new_today");
  });

  it("says, for the layer shown, how many notices are Canada-wide or not stated, and that a notice in several provinces counts in each", async () => {
    const panel = panelOf(await html("/", { env: on() }));
    const lines = [...panel.matchAll(/<div class="cmap-key" data-for="(\w+)"><p class="cmap-national">([^<]*)<\/p>/g)].map((m) => [m[1], m[2]]);
    expect(lines).toEqual([
      ["new_today", "Canada-wide or not stated: 15"], ["open", "Canada-wide or not stated: 300"],
      ["closing_7d", "Canada-wide or not stated: 40"], ["same_day", "Canada-wide or not stated: 1"],
    ]);
    expect(panel).toContain("A notice in several provinces counts in each.");
    expect(panel).toContain('(<a href="/methodology#places">Methodology</a>)');
    expect(panel).toContain("Same-day notices count the provinces they state.");
    // The legend of the open layer: no notice, then the counts each step covers.
    const key = /<div class="cmap-key" data-for="open">[\s\S]*?<\/div>/.exec(panel)?.[0] ?? "";
    expect([...key.matchAll(/<li><span class="cmap-sw cmap-s(\d)"><\/span>([^<]*)<\/li>/g)].map((m) => `${m[1]}:${m[2]}`))
      .toEqual(["0:0", "1:1 to 16", "2:17 to 65", "3:66 to 146", "4:147 to 260"]);
    // The boundaries' source, adapted, as the licence asks.
    expect(panel).toContain("Boundaries adapted from Statistics Canada, <a href=\"https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm\">Census Boundary Files</a>, 2021.");
  });
});

// -- the links -----------------------------------------------------------------------------

describe("each province", () => {
  it("opens the list of its layer, with national=0 so the list holds what the count counts", async () => {
    const panel = panelOf(await html("/", { env: on() }));
    const links = (layer: string) => Object.fromEntries(layerLinks(panel, layer));
    expect(links("new_today").ON).toBe("/tenders/new?province=ON&amp;national=0");
    expect(links("open").ON).toBe("/tenders?province=ON&amp;national=0");
    expect(links("closing_7d").ON).toBe("/tenders?province=ON&amp;closing=7&amp;national=0");
    // The Maritimes link from the main map and from the inset alike.
    expect(layerLinks(panel, "open").filter(([p]) => p === "NS").map(([, h]) => h)).toEqual([
      "/tenders?province=NS&amp;national=0", "/tenders?province=NS&amp;national=0",
    ]);
    // A province with no notice in the layer is no link.
    expect(links("new_today").YT).toBeUndefined();
    expect(panel).toContain('<use href="#cm-YT" class="cmap-s0">');
  });

  it("opens the same-day page for a Pro reader, filtered, and its free view, with the Pro card, for any other", async () => {
    const sameDay = async (cookie?: string) => Object.fromEntries(layerLinks(panelOf(await html("/", { env: on(), cookie })), "same_day"));
    for (const cookie of [undefined, freeCookie]) {
      forgetSameDayCounts();
      const links = await sameDay(cookie);
      expect(Object.keys(links).sort(), cookie ? "free" : "no session").toEqual(["BC", "ON", "QC"]);
      for (const href of Object.values(links)) expect(href).toBe("/tenders/same-day");
    }
    forgetSameDayCounts();
    expect((await sameDay(proCookie)).ON).toBe("/tenders/same-day?province=ON&amp;national=0");
    // The free view is the Pro card whatever the address asks.
    const free = await html("/tenders/same-day?province=ON&national=0", { env: on(), cookie: freeCookie });
    expect(free).toContain('<section class="panel pro-panel">');
    expect(free).not.toContain("Same-day cb-620");
  });

  it("is a row of the table under the map, every layer's figure a link to the same list, sortable, the not-stated row last", async () => {
    const panel = panelOf(await html("/", { env: on() }));
    expect(panel.indexOf("<table")).toBeGreaterThan(panel.indexOf("</svg>"));
    const table = tableOf(panel);
    expect(table).toContain('data-sorting="client"');
    expect(table).toContain('class="restack cols cmap-table"');
    expect([...table.matchAll(/<th class="([^"]*)"><button type="button" class="th-sort">([^<]*)<\/button><\/th>/g)].map((m) => `${m[1]}|${m[2]}`))
      .toEqual(["k-main|Province", "k-count num|New today", "k-count num|Open", "k-count num|Closing within 7 days", "k-count num|Same day"]);
    expect(table.match(/<tr><td data-label="Province">/g)).toHaveLength(14);
    expect(rowOf(table, "Ontario")).toBe(
      '<tr><td data-label="Province">Ontario</td><td data-label="New today" class="num"><a href="/tenders/new?province=ON&amp;national=0">14</a></td>' +
      '<td data-label="Open" class="num"><a href="/tenders?province=ON&amp;national=0">260</a></td>' +
      '<td data-label="Closing within 7 days" class="num"><a href="/tenders?province=ON&amp;closing=7&amp;national=0">38</a></td>' +
      '<td data-label="Same day" class="num"><a href="/tenders/same-day">2</a></td></tr>',
    );
    // A zero is a figure, not a link.
    expect(rowOf(table, "Yukon")).toContain('<td data-label="New today" class="num">0</td>');
    // Alphabetical in the page's language, then the notices placed in none, in a body of their own.
    const names = [...table.matchAll(/<tr><td data-label="Province">([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(names[0]).toBe("Alberta");
    expect(names.at(-1)).toBe("Canada-wide or not stated");
    expect(table).toContain('<tbody class="cmap-national-row"><tr><td data-label="Province">Canada-wide or not stated</td>' +
      '<td data-label="New today" class="num">15</td><td data-label="Open" class="num">300</td>' +
      '<td data-label="Closing within 7 days" class="num">40</td><td data-label="Same day" class="num">1</td></tr></tbody>');
  });
});

// -- the gate, the switch and older exports ----------------------------------------------------

describe("the same-day layer", () => {
  it("carries the Pro chip on its button and counts for every reader", async () => {
    for (const cookie of [undefined, freeCookie, proCookie]) {
      forgetSameDayCounts();
      const panel = panelOf(await html("/", { env: on(), cookie }));
      const button = /<button type="button" class="btn" data-map-layer="same_day"[\s\S]*?<\/button>/.exec(panel)?.[0] ?? "";
      expect(button).toContain('<span class="pro-tag">');
      expect((panel.match(/<span class="pro-tag">/g) ?? []).length).toBe(1);
      expect(rowOf(tableOf(panel), "Ontario")).toMatch(/data-label="Same day" class="num"><a href="[^"]*">2<\/a>/);
    }
  });

  it("reads the rows once while its counts are kept, never their words, and none at all while the switch is off", async () => {
    const sql: string[] = [];
    const recording = { prepare: (q: string) => { sql.push(q); return SEARCH.prepare(q); } } as unknown as D1Database;
    const page = await html("/", { env: on({ SEARCH: recording }) });
    expect(sql).toEqual([INTRADAY_SQL]);
    expect(page).not.toContain("Same-day cb-620");
    expect(page).not.toContain("cb-620-62000001");
    await html("/", { env: on({ SEARCH: recording }) });
    expect(sql).toEqual([INTRADAY_SQL]);
    expect(SAME_DAY_COUNTS_MS).toBe(10 * 60 * 1000);
    forgetSameDayCounts();
    sql.length = 0;
    const switchedOff = await html("/", { env: { ...off(), SEARCH: recording } });
    expect(sql).toEqual([]);
    const panel = panelOf(switchedOff);
    expect(panel).not.toContain("same_day");
    expect(panel).not.toContain("pro-tag");
    expect(panel).toContain('style="--cmap-list-min:432px"');
    expect(panel).not.toContain("Same-day notices count");
  });

  it("is left out, with no error on the page, when the rows cannot be read", async () => {
    const failing = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error("D1_ERROR: no such table: SQLITE_ERROR"); } }) }) };
    const error = console.error;
    const logged: unknown[] = [];
    console.error = (...a: unknown[]) => { logged.push(a.join(" ")); };
    try {
      const page = await html("/", { env: on({ SEARCH: failing }) });
      expect(panelOf(page)).toContain('data-for="open"');
      expect(panelOf(page)).not.toContain("same_day");
      expect(logged.join(" ")).toContain("intraday: map counts failed");
    } finally {
      console.error = error;
    }
  });
});

describe("an export from before the map", () => {
  it("renders no map panel, and none from a map that does not read", async () => {
    for (const files of [{ "stats.json": stats }, { "stats.json": { ...stats, map: { ...map, open: { n: "854" } } } },
      { "stats.json": { ...stats, map: { new_today: map.new_today } } }]) {
      const page = await html("/", { env: onEnv({ ASSETS: makeFakeAssets({}, files) }) });
      expect(page).toContain("<h2>New Tender Notices Today</h2>");
      expect(page).not.toContain("cmap");
      expect(page).not.toContain("canada-map.js");
    }
  });
});

// -- French and the copy --------------------------------------------------------------------

describe("in French", () => {
  it("says the same in French, with French names, groupings and links", async () => {
    const page = await html("/?lang=fr", { env: on() });
    const panel = panelOf(page);
    expect(panel).toContain("<h2>Avis d’appel d’offres par province</h2>");
    expect(panel).toContain('aria-label="Couche de la carte"');
    expect(panel).toContain(">Nouveaux aujourd’hui");
    expect(panel).toContain(">Clôture d’ici 7 jours");
    expect(panel).toContain(">Du jour");
    expect(panel).toContain('<p class="cmap-caption" data-for="open">854 avis ouverts</p>');
    expect(panel).toContain('<p class="cmap-caption" data-for="closing_7d">120 avis qui ferment d’ici 7 jours</p>');
    expect(panel).toContain("Tout le Canada ou non indiqué : 300");
    expect(panel).toContain("Un avis visant plusieurs provinces compte dans chacune.");
    expect(panel).toContain("Les avis du jour comptent les provinces qu’ils indiquent.");
    expect(panel).toContain("<li><span class=\"cmap-sw cmap-s4\"></span>147 à 260</li>");
    expect(panel).toContain("index2021-fra.cfm");
    expect(panel).toContain('<span class="visually-hidden"> (forfait payant)</span>');
    const table = tableOf(panel);
    expect([...table.matchAll(/<tr><td data-label="Province">([^<]*)<\/td>/g)].map((m) => m[1]).slice(0, 3))
      .toEqual(["Alberta", "Colombie-Britannique", "Île-du-Prince-Édouard"]);
    for (const page of [panel, panelOf(await html("/", { env: on() }))]) {
      expect(page).not.toContain(EM_DASH);
      expect(page).not.toMatch(/\{\w+\}/);
    }
  });
});

// -- the stylesheet ----------------------------------------------------------------------------

describe("the stylesheet", () => {
  it("draws the steps from tokens every palette defines, one hue each, and hides the map below 700 px", () => {
    expect(STYLES_VERSION).toBeGreaterThanOrEqual(28); // the bump that shipped the map; later landings move it on
    const blocks = [/:root \{[\s\S]*?\n\}/, /:root\[data-theme="dark"\] \{[\s\S]*?\n\}/, /:root:not\(\[data-theme="light"\]\) \{[\s\S]*?\n {2}\}/];
    for (const block of blocks) {
      const body = block.exec(STYLES)?.[0] ?? "";
      for (let s = 0; s <= MAP_STEPS; s++) expect(body, `--map-${s}`).toMatch(new RegExp(`--map-${s}: #[0-9a-f]{6};`));
    }
    for (let s = 0; s <= MAP_STEPS; s++) {
      expect(STYLES).toContain(`.cmap-s${s} { fill: var(--map-${s}); }`);
      expect(STYLES).toContain(`.cmap-sw.cmap-s${s} { background: var(--map-${s}); }`);
    }
    // The steps get lighter as the count grows in the dark and darker in the light: one ramp, by lightness.
    const lightness = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    };
    const ramp = (body: string) => [1, 2, 3, 4].map((s) => lightness(new RegExp(`--map-${s}: (#[0-9a-f]{6});`).exec(body)![1]));
    const light = ramp(blocks[0].exec(STYLES)![0]);
    const dark = ramp(blocks[1].exec(STYLES)![0]);
    for (let i = 1; i < 4; i++) {
      expect(light[i]).toBeLessThan(light[i - 1]);
      expect(dark[i]).toBeGreaterThan(dark[i - 1]);
    }
    // The steps are the charts' emerald (operator, 2026-11-11: one data hue across the site): green leads in every step.
    for (const block of blocks) {
      const body = block.exec(STYLES)![0];
      for (const s of [1, 2, 3, 4]) {
        const hex = new RegExp(`--map-${s}: (#[0-9a-f]{6});`).exec(body)![1];
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        expect(g, `--map-${s} ${hex}`).toBeGreaterThan(r);
        expect(g, `--map-${s} ${hex}`).toBeGreaterThan(b);
      }
    }
    const phone = STYLES.slice(STYLES.indexOf("-- the home page's Canada map"));
    expect(phone).toMatch(/@media \(max-width: 699px\) \{\s*\.cmap-figure \{ display: none; \}/);
    for (const layer of ["new_today", "open", "closing_7d", "same_day"]) {
      expect(STYLES).toContain(`.cmap:not([data-layer="${layer}"]) [data-for="${layer}"]`);
    }
    expect(STYLES).toContain("html.js .cmap-toggles { display: flex; }");
    // Neighbours part on a gap in the panel's ground along the land borders; the pointer's outline lies over it,
    // clear until it is the one under the pointer or the keys.
    expect(STYLES).toContain("\n.cmap-svg .cmap-borders { fill: none; stroke: var(--panel); stroke-width: 4; stroke-linecap: round; pointer-events: none; }");
    expect(STYLES).toContain("\n.cmap-svg .cmap-hit { fill: transparent; stroke: none; }");
    expect(STYLES).toContain("\n.cmap-svg a:hover .cmap-hit { stroke: var(--ink); stroke-width: 2.5; }");
    expect(STYLES).toContain("\n.cmap-svg a:focus-visible .cmap-hit { stroke: var(--ink); stroke-width: 2.5; }");
  });
});

// -- the lists the links open ----------------------------------------------------------------

describe("the lists a province opens", () => {
  it("keeps the day's notices placed in the province on /tenders/new, stated or derived, with a chip to take it off", async () => {
    const page = await html("/tenders/new?province=ON&national=0", { env: on() });
    expect(page).toContain("Stated in Ontario");
    expect(page).toContain("Derived to Ontario");
    expect(page).not.toContain("Stated in Quebec");
    expect(page).not.toContain("Canada-wide notice");
    expect(page).toContain('<a class="fchip" href="/tenders/new" aria-label="Remove filter: Ontario">');
    expect(page).toContain('<meta name="robots" content="noindex');
    // The other days keep the filter.
    expect(page).toContain('href="/tenders/new?day=2026-10-30&amp;province=ON&amp;national=0"');
    // With national on, the notices placed in none stay; derived=0 reads the stated ones alone.
    const national = await html("/tenders/new?province=ON", { env: on() });
    expect(national).toContain("Canada-wide notice");
    const stated = await html("/tenders/new?province=ON&national=0&derived=0", { env: on() });
    expect(stated).toContain("Stated in Ontario");
    expect(stated).not.toContain("Derived to Ontario");
    // A province with none of the day's notices says so.
    expect(await html("/tenders/new?province=YT&national=0", { env: on() }))
      .toContain("No notice of this day matches the province filter (Yukon).");
    // Without a province the page is as it was.
    expect(await html("/tenders/new", { env: on() })).not.toContain("fchip");
  });

  it("keeps the same-day notices placed in the province on /tenders/same-day for a Pro reader", async () => {
    const page = await html("/tenders/same-day?province=ON&national=0", { env: on(), cookie: proCookie });
    expect(page).toContain("Same-day cb-620-62000001");
    expect(page).toContain("Same-day cb-620-62000002");
    expect(page).not.toContain("Same-day cb-620-62000003");
    expect(page).not.toContain("Same-day cb-620-62000004");
    expect(page).toContain('<a class="fchip" href="/tenders/same-day" aria-label="Remove filter: Ontario">');
    const none = await html("/tenders/same-day?province=YT&national=0", { env: on(), cookie: proCookie });
    expect(none).toContain("No same-day notice read since this morning&#39;s refresh matches the province filter (Yukon).");
    const all = await html("/tenders/same-day", { env: on(), cookie: proCookie });
    expect(all).toContain("Same-day cb-620-62000003");
    expect(all).not.toContain("fchip");
  });
});
