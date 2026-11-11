// The tips (src/chart.tsx, public/tooltip.js, src/layout.tsx): every chart
// mark, map province and short-form figure carries its exact figures as its
// title, which is the browser's own tip without the script: the head (the
// series and the period) over the full money value with its cents rule, the
// count, a share with its parts, never the tiles' short form. The elements
// that hold tips are marked data-tip; a page that draws one gets the one box
// (role="tooltip") and the script, and no other page does; both languages;
// no em-dash. The script's placing, picking and stepping run here in Node.
// The analytics views' and the account organization page's charts are
// checked in their own files (analytics.test.ts, org-claim.test.ts), on the
// records they seed.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import tooltipJs from "../public/tooltip.js?raw";
import { GAP, MARGIN, TIP_ID, markAt, markReach, placeTip, stepMark, tipLines } from "../public/tooltip.js";
import { ShortMoney, moneyTip, partOf, recordsText, tipHead, tipText } from "../src/chart";
import { fmtInt, fmtMoney } from "../src/i18n";
import { app } from "../src/index";
import { homeRequest } from "./home";
import { makeFakeAssets, testEnv } from "./assets";
import profiles from "./fixtures/profiles-a00.json";
import stats from "./fixtures/stats.json";
import map from "./fixtures/stats-map.json";

const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
const EM_DASH = String.fromCharCode(0x2014);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const ID = "org-a000000001";
const BOX = `<div id="${TIP_ID}" class="tip" role="tooltip" hidden=""></div><script type="module" src="/tooltip.js"></script>`;

let ip = 0;
const html = async (path: string, e: object = testEnv()) =>
  nbsp(await (await homeRequest(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.51.100.${++ip % 250}` } }, e)).text());
// The tips of a page's chart marks and map provinces: their SVG <title>s.
const svgTitles = (page: string) => [...page.matchAll(/<(?:path|line|use)\b[^>]*><title>([^<]*)<\/title>/g)].map((m) => m[1]);

// The fixture's profile with a PSPC contract history: 2024's value over a million, 2026's under a thousand.
function withHistory() {
  const all = JSON.parse(JSON.stringify(profiles)) as Record<string, { years: unknown[]; organization: Record<string, unknown> }>;
  all[ID].years.push(
    { year: 2024, source: "history", n: 15, total: 4_512_345.67, n_non_competitive: 0, total_non_competitive: 0 },
    { year: 2026, source: "history", n: 8, total: 812.5, n_non_competitive: 0, total_non_competitive: 0 },
  );
  all[ID].organization.n_history = 23;
  all[ID].organization.total_history = 4_513_158.17;
  return testEnv(makeFakeAssets({}, { "profiles/a00.json": all }));
}

describe("a tip's text (src/chart.tsx)", () => {
  it("gives a money mark the series and the period over the full value, with the cents rule, and its count", () => {
    expect(moneyTip("en", "PSPC contract history", "2024", 4_512_345.67, recordsText("en", 15))).toBe("PSPC contract history, 2024\n$4,512,346\n15 records");
    // Cents below $1,000, as fmtMoney writes them everywhere.
    expect(moneyTip("en", "PSPC contract history", "2026", 812.5, recordsText("en", 1))).toBe("PSPC contract history, 2026\n$812.50\n1 record");
    expect(nbsp(moneyTip("fr", "Historique des contrats de SPAC", "2024", 4_512_345.67, recordsText("fr", 15))))
      .toBe("Historique des contrats de SPAC, 2024\n4 512 346 $\n15 dossiers");
    expect(nbsp(moneyTip("fr", "Historique des contrats de SPAC", "2026", 812.5, recordsText("fr", 1)))).toBe("Historique des contrats de SPAC, 2026\n812,50 $\n1 dossier");
    // Never the tiles' short form.
    expect(moneyTip("en", "Award notices", "2025", 1_200_000_000)).toBe("Award notices, 2025\n$1,200,000,000");
    expect(moneyTip("en", "Award notices", "2025", 1_200_000_000)).not.toMatch(/\d[MB]\b/);
  });

  it("gives a count mark the series and the period over the count, and a share its parts", () => {
    expect(tipText(tipHead("en", "Buyers with a record", "2025-26"), [fmtInt(1234, "en")])).toBe("Buyers with a record, 2025-26\n1,234");
    expect(nbsp(tipText(tipHead("fr", "Acheteurs ayant un dossier", "2025-2026"), [fmtInt(1234, "fr")]))).toBe("Acheteurs ayant un dossier, 2025-2026\n1 234");
    const n = (v: number) => fmtInt(v, "en");
    expect(partOf("en", 12, 35, n)).toBe("12 of 35 (34%)");
    expect(partOf("en", 50_000_000, 200_000_000, (v) => fmtMoney(v / 100, "en"))).toBe("$500,000 of $2,000,000 (25%)");
    expect(nbsp(partOf("fr", 12, 35, (v) => fmtInt(v, "fr")))).toBe("12 sur 35 (34 %)");
    // Nothing to be a share of: the part alone.
    expect(partOf("en", 0, 0, n)).toBe("0");
    // A tip of one line is a figure alone; empty lines are left out.
    expect(tipText(null, ["$4,512,346"])).toBe("$4,512,346");
    expect(tipText("Head", ["", "$1"])).toBe("Head\n$1");
  });

  it("gives a short-form figure its exact value as its title, and a figure the short form leaves whole none", () => {
    const render = (lang: "en" | "fr", value: number, cls?: string) => nbsp(String(ShortMoney({ lang, value, class: cls })));
    expect(render("en", 4_512_345.67, "tile-value")).toBe('<span class="tile-value" title="$4,512,346" data-tip="">$4.5M</span>');
    expect(render("fr", 4_512_345.67, "tile-value")).toBe('<span class="tile-value" title="4 512 346 $" data-tip="">4,5 M$</span>');
    expect(render("en", 2_300_000_000)).toBe('<span title="$2,300,000,000" data-tip="">$2.3B</span>');
    // Below a million the short form is the whole amount; rounding $999.50 up is a short form too.
    expect(render("en", 250_000, "tile-value")).toBe('<span class="tile-value">$250,000</span>');
    expect(render("en", 250_000)).toBe("$250,000");
    expect(render("en", 999.5)).toBe('<span title="$999.50" data-tip="">$1,000</span>');
  });
});

describe("the script's arithmetic (public/tooltip.js)", () => {
  it("reads a tip as a head over its figures, or a figure alone", () => {
    expect(tipLines("PSPC contract history, 2024\n$4,512,346\n15 records")).toEqual({ head: "PSPC contract history, 2024", figures: ["$4,512,346", "15 records"] });
    expect(tipLines("$4,512,346")).toEqual({ head: null, figures: ["$4,512,346"] });
    expect(tipLines(" a \n\n b ")).toEqual({ head: "a", figures: ["b"] });
  });

  it("places the box above the mark, below it near the top, and never past an edge", () => {
    const view = { width: 1440, height: 900 };
    const size = { width: 180, height: 66 };
    const bar = { left: 1136, right: 1214, top: 409, bottom: 491 };
    // Centred over the mark, the gap above it.
    expect(placeTip(bar, size, view)).toEqual({ left: 1085, top: 409 - GAP.focus - 66, side: "above" });
    // Too near the top: below it.
    expect(placeTip({ ...bar, top: 40, bottom: 120 }, size, view)).toEqual({ left: 1085, top: 120 + GAP.focus, side: "below" });
    // Near the right edge and the left one: held the margin inside.
    expect(placeTip({ left: 1430, right: 1430, top: 400, bottom: 400 }, size, view, GAP.pointer).left).toBe(1440 - MARGIN - 180);
    expect(placeTip({ left: 4, right: 4, top: 400, bottom: 400 }, size, view, GAP.pointer).left).toBe(MARGIN);
    // A phone, 390 px wide, the last bar at the right edge.
    expect(placeTip({ left: 336, right: 356, top: 422, bottom: 422 }, { width: 178, height: 66 }, { width: 390, height: 844 }).left).toBe(390 - MARGIN - 178);
    // Room neither above nor below: over the mark, inside the window.
    const tall = placeTip({ left: 600, right: 640, top: 50, bottom: 860 }, size, view);
    expect(tall.side).toBe("over");
    expect(tall.top).toBeGreaterThanOrEqual(MARGIN);
    expect(tall.top + size.height).toBeLessThanOrEqual(900 - MARGIN);
    // A box wider than the window less its margins starts at the margin (the stylesheet caps it to fit).
    expect(placeTip(bar, { width: 400, height: 66 }, { width: 390, height: 844 }).left).toBe(MARGIN);
  });

  it("picks the bar whose column the pointer is in, so a short bar or a point needs no aim", () => {
    // Bars filling 72 px slots, the third slot empty: a bar owns about itself.
    const full = [{ left: 2, right: 70 }, { left: 74, right: 142 }, { left: 218, right: 286 }];
    expect(markAt(full, 100)).toBe(1);
    expect(markAt(full, 72)).toBeGreaterThanOrEqual(0);
    expect(markAt(full, 180)).toBe(-1);
    // Thin bars (24 px in 72 px slots): each owns its whole slot.
    const thin = [{ left: 24, right: 48 }, { left: 96, right: 120 }, { left: 168, right: 192 }];
    expect(markReach(thin)).toBe(24);
    expect(markAt(thin, 2)).toBe(0);
    expect(markAt(thin, 140)).toBe(1);
    expect(markAt(thin, 150)).toBe(2);
    expect(markAt(thin, 230)).toBe(-1);
    // Points a year apart on a line: the nearest within half the spacing.
    const dots = [{ left: 33, right: 39 }, { left: 105, right: 111 }];
    expect(markAt(dots, 60)).toBe(0);
    expect(markAt(dots, 80)).toBe(1);
    // One mark alone: a reach of twice the margin.
    expect(markReach([{ left: 10, right: 20 }])).toBe(2 * MARGIN);
    expect(markAt([], 10)).toBe(-1);
  });

  it("steps through a panel's marks with the arrow keys, Home and End", () => {
    expect(stepMark(0, 5, "ArrowRight")).toBe(1);
    expect(stepMark(0, 5, "ArrowDown")).toBe(1);
    expect(stepMark(4, 5, "ArrowRight")).toBe(4);
    expect(stepMark(3, 5, "ArrowLeft")).toBe(2);
    expect(stepMark(0, 5, "ArrowUp")).toBe(0);
    expect(stepMark(2, 5, "Home")).toBe(0);
    expect(stepMark(2, 5, "End")).toBe(4);
    expect(stepMark(2, 5, "Tab")).toBeNull();
    expect(stepMark(0, 0, "ArrowRight")).toBeNull();
  });

  it("reads nothing from the network, loads no library, says no word of its own and has no em-dash", () => {
    expect(tooltipJs).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|\bimport\b|\bimport\(/);
    expect(tooltipJs).not.toContain(EM_DASH);
    // The box's id, its describing link and the ways it hides.
    for (const part of ['"aria-describedby"', '"Escape"', '"focusin"', '"focusout"', '"pointermove"', '"pointerdown"', '"pointerleave"', '"scroll"', '"resize"']) {
      expect(tooltipJs, part).toContain(part);
    }
    expect(TIP_ID).toBe("aw-tip");
  });
});

describe("the pages", () => {
  it("give a profile's year bars their exact value and count, the panel one tab stop, and its tiles' short forms their exact figure", async () => {
    const page = await html(`/organizations/${ID}`, withHistory());
    expect(page).toContain(
      '<svg viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label="PSPC contract history. Value per calendar year. The table below gives every figure." focusable="false" data-tip="keys">',
    );
    const titles = svgTitles(page);
    expect(titles).toContain("PSPC contract history, 2024\n$4,512,346\n15 records");
    // The cents rule: under $1,000 the cents show.
    expect(titles).toContain("PSPC contract history, 2026\n$812.50\n8 records");
    expect(titles).toContain("Published contracts, 2026\n$1,100,000\n60 records");
    expect(titles).toContain("Award notices, 2026\n$250,000\n1 record");
    // A bar is a path from the baseline up, its data end rounded by two arcs, its foot square on the baseline.
    expect(page).toMatch(/<path class="bar" style="fill:url\(#cf-1-\d+\) var\(--chart-bar\)" d="M[\d.]+ 100 L[\d.]+ [\d.]+ A[\d.]+ [\d.]+ 0 0 1 [\d.]+ [\d.]+ L[\d.]+ [\d.]+ A[\d.]+ [\d.]+ 0 0 1 [\d.]+ [\d.]+ L[\d.]+ 100 Z"><title>PSPC contract history, 2024\n\$4,512,346\n15 records<\/title><\/path>/);
    for (const t of titles) expect(t, t).not.toMatch(/\d[MB]\b|M\$|G\$/);
    expect(page).toContain('<span class="tile-label">PSPC contract history</span><span class="tile-value" title="$4,513,158" data-tip="">$4.5M</span>');
    expect(page).toContain('<span class="tile-value" title="$1,875,000" data-tip="">$1.9M</span>');
    // The box and the script, once, after the content.
    expect(page.split(BOX)).toHaveLength(2);
    expect(page.indexOf(BOX)).toBeGreaterThan(page.indexOf("</footer>"));
    expect(page).not.toContain(EM_DASH);
  });

  it("are French on a French request", async () => {
    const page = await html(`/organizations/${ID}?lang=fr`, withHistory());
    const titles = svgTitles(page);
    expect(titles).toContain("Historique des contrats de SPAC, 2024\n4 512 346 $\n15 dossiers");
    expect(titles).toContain("Historique des contrats de SPAC, 2026\n812,50 $\n8 dossiers");
    expect(titles).toContain("Contrats publiés, 2026\n1 100 000 $\n60 dossiers");
    expect(page).toContain('<span class="tile-value" title="1 875 000 $" data-tip="">1,9 M$</span>');
    expect(page).toContain(BOX);
    expect(page).not.toContain(EM_DASH);
  });

  it("give a buyer's year bars and tiles the same", async () => {
    const page = await html("/buyers/pwgsc-tpsgc");
    const titles = svgTitles(page);
    expect(titles.length).toBeGreaterThan(0);
    for (const t of titles) expect(t, t).toMatch(/^[^\n]+, \d{4}\n\$[\d,]+(?:\.\d\d)?\n\d[\d,]* records?$/);
    expect(page).toContain('data-tip="keys"');
    expect(page).toContain(BOX);
  });

  it("give each province of every map layer its count in the layer's words, and a tile note's short form its exact value", async () => {
    const e = testEnv(makeFakeAssets({}, { "stats.json": { ...stats, map } }));
    const page = await html("/", e);
    expect(page).toContain('<div class="cmap-figure" data-tip="">');
    expect(page).toContain('<use href="#cm-ON" class="cmap-s4"><title>Ontario\n14 new notices today</title></use>');
    expect(page).toContain("<title>Ontario\n260 open notices</title>");
    expect(page).toContain("<title>Ontario\n38 notices closing within 7 days</title>");
    // A province with no notice has its tip too, with no link.
    expect(page).toMatch(/<use href="#cm-YT" class="cmap-s0"><title>Yukon\n0 new notices today<\/title><\/use>/);
    expect(page).toContain('Worth <span title="$4,910,500" data-tip="">$4.9M</span>');
    expect(page).toContain(BOX);
    const fr = await html("/?lang=fr", e);
    expect(fr).toContain("<title>Ontario\n14 nouveaux avis aujourd’hui</title>");
    expect(fr).toContain("<title>Québec\n7 nouveaux avis aujourd’hui</title>");
    expect(fr).toContain('Valeur : <span title="4 910 500 $" data-tip="">4,9 M$</span>');
    expect(fr).not.toContain(EM_DASH);
  });

  it("load the script on a page that draws a tip and on no other", async () => {
    for (const path of ["/", `/organizations/${ID}`, "/buyers/pwgsc-tpsgc", "/expiring"]) {
      const page = await html(path);
      expect(page.split("/tooltip.js").length - 1, path).toBe(1);
      expect(page, path).toContain(BOX);
    }
    for (const path of ["/tenders", "/awards", "/about", "/data", "/methodology", "/privacy", "/nothing-here"]) {
      const page = await html(path);
      expect(page, path).not.toContain("/tooltip.js");
      expect(page, path).not.toContain(TIP_ID);
      expect(page, path).not.toContain("data-tip");
    }
  });

  it("style the box through the tokens in both themes, with no display of its own so [hidden] hides it", () => {
    const rule = STYLES.match(/\n\.tip \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("position: fixed;");
    expect(rule).toContain("background: var(--panel);");
    expect(rule).toContain("border: 1px solid var(--border-2);");
    expect(rule).toContain("color: var(--ink);");
    expect(rule).toContain("max-width: min(18rem, calc(100vw - 16px));");
    expect(rule).toContain("pointer-events: none;");
    expect(rule).not.toMatch(/display:|box-shadow|#[0-9a-f]{3,6}/);
    expect(STYLES).toContain("\n.tip-head { display: block; color: var(--muted); }");
    expect(STYLES).toContain("\n.tip-main { font-size: 13px; line-height: 20px; font-weight: 600; color: var(--ink); }");
    expect(STYLES).toContain("\n.chart-plot .bar.tip-on, .chart-plot .bar:hover { fill: var(--chart-on) !important; }");
    expect(STYLES).toContain("\n.cmap-svg use.tip-on { stroke: var(--ink); stroke-width: 2.5; }");
  });
});
