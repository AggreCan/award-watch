// A chart's axis on a dashboard tile (src/chart.tsx tileLabels, TILE_TIERS;
// public/styles.css, the container queries on .dash-tile): the labels rest by
// the width the tile is drawn at, whatever the layout, so no two ever touch.
// Every layout a tile is drawn in is reckoned here from the shell's own
// widths: the grid of twelve columns from 1,100 px (beside the rail), two
// columns from 700 px (a tile of seven columns or more across both, the rail
// beside them from 1,000 px), one column below 700 px. For a 5-year and a
// 20-year axis, in English and in French, at tile spans 4, 6, 8 and 12, each
// label drawn there is placed on the plot as the chart places it (centred on
// its year, an end label anchored at its end) and measured at the axis type's
// 6.2 px a character; no two may come closer than 4 px.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { COLS, GAP_PX } from "../public/dash-grid.js";
import { analyticFit, buildFit, tileWidthPx } from "../src/account/dashboard_fit";
import { type AxisLabel, TILE_PLOT_LESS, TILE_TIERS, clearOfAnchors, fiscalAxis, tileLabels } from "../src/chart";
import { fiscalLabel } from "../src/records_db";

const SCROLLBAR = 15;
const RAIL = 264;
const GUTTER = 24;
const PHONE_GUTTER = 16;
const CHAR_PX = 6.2;
const CLEAR_PX = 4;

// The inside width of a tile of `span` columns (its container, the tile less its border), in each layout.
function insides(span: number): { layout: string; px: number }[] {
  const out: { layout: string; px: number }[] = [];
  for (const window of [1100, 1280, 1440, 1920]) {
    const content = window - SCROLLBAR - RAIL - 2 * GUTTER;
    const col = (content - (COLS - 1) * GAP_PX) / COLS;
    out.push({ layout: `grid at ${window} px`, px: span * col + (span - 1) * GAP_PX - 2 });
  }
  for (const window of [700, 850, 999, 1000, 1099]) {
    const content = window - SCROLLBAR - (window >= 1000 ? RAIL : 0) - 2 * GUTTER;
    out.push({ layout: `two columns at ${window} px`, px: (span >= 7 ? content : (content - GAP_PX) / 2) - 2 });
  }
  for (const window of [360, 480, 699]) out.push({ layout: `one column at ${window} px`, px: window - 2 * PHONE_GUTTER - 2 });
  return out;
}

const tierOf = (px: number) => TILE_TIERS.reduce((k, at, i) => (px >= at ? i : k), 0);

// The labels a tile of this inside width draws: not left out, not resting in its tier, clear of the end labels.
function drawn(labels: readonly AxisLabel[], domain: [number, number], px: number): { text: string; from: number; to: number }[] {
  const tier = tierOf(px);
  const plot = px - TILE_PLOT_LESS;
  const lefts = labels.map((l) => ((l.x - domain[0]) / (domain[1] - domain[0])) * 100);
  const clear = clearOfAnchors(lefts);
  return labels.flatMap((l, i) => {
    if (l.hidden || !clear[i] || (l.off ?? []).includes(tier)) return [];
    const at = (lefts[i] / 100) * plot;
    const width = l.text.length * CHAR_PX;
    // As the chart anchors a label within 4% of an end (chart.tsx anchor).
    const [from, to] = lefts[i] < 4 ? [at, at + width] : lefts[i] > 96 ? [at - width, at] : [at - width / 2, at + width / 2];
    return [{ text: l.text, from, to }];
  });
}

describe("a tile's axis labels", () => {
  it("never touch, at any span, in any layout, for 5 and 20 fiscal years, in English and French", { timeout: 30_000 }, () => {
    const axes: [string, number, number][] = [["5 years", 2022, 2026], ["20 years", 2007, 2026]];
    let checked = 0;
    for (const lang of ["en", "fr"] as const) {
      for (const [name, first, last] of axes) {
        const axis = fiscalAxis(first, last, (y) => fiscalLabel(lang, y));
        const labels = tileLabels(axis.labels);
        for (const span of [4, 6, 8, 12]) {
          for (const { layout, px } of insides(span)) {
            const list = drawn(labels, [first, last + 1], px).sort((a, b) => a.from - b.from);
            const where = `${lang} ${name}, span ${span}, ${layout} (inside ${px.toFixed(0)} px)`;
            // The first and the last year always show.
            expect(list[0]?.text, where).toBe(fiscalLabel(lang, first));
            expect(list.at(-1)?.text, where).toBe(fiscalLabel(lang, last));
            for (let i = 1; i < list.length; i++) {
              expect(list[i].from - list[i - 1].to, `${where}: ${list[i - 1].text} and ${list[i].text}`).toBeGreaterThanOrEqual(CLEAR_PX);
            }
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(2 * 2 * 4 * 12);
  });

  it("show more of the years where the tile is wider, and every one of five on a whole row of the grid", () => {
    const axis = fiscalAxis(2007, 2026, (y) => fiscalLabel("en", y));
    const labels = tileLabels(axis.labels);
    const shown = (px: number) => drawn(labels, [2007, 2027], px).length;
    expect(shown(950)).toBeGreaterThan(shown(450));
    expect(shown(450)).toBeGreaterThanOrEqual(shown(250));
    const five = tileLabels(fiscalAxis(2022, 2026, (y) => fiscalLabel("en", y)).labels);
    expect(drawn(five, [2022, 2027], 950)).toHaveLength(5);
    // A page that is not a tile's passes no fit, so its labels carry no tier (pages/analytics.tsx labelsAt).
    expect(fiscalAxis(2022, 2026, (y) => fiscalLabel("en", y)).labels.every((l) => l.off === undefined)).toBe(true);
  });

  it("rest by the stylesheet's container queries, one a tier, and reckon a plot as the tile's fit does", () => {
    const css = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
    TILE_TIERS.forEach((at, k) => {
      const next = TILE_TIERS[k + 1];
      const query = k === 0 ? `(max-width: ${next - 1}.98px)` : next === undefined ? `(min-width: ${at}px)` : `(min-width: ${at}px) and (max-width: ${next - 1}.98px)`;
      expect(css, `tier ${k}`).toContain(`@container dash-tile ${query} { .chart-x .x-c${k} { display: none; } }`);
    });
    // The first tier holds a chart tile of the least width (four columns) at the narrowest grid, 1,100 px.
    expect(insides(4)[0].px).toBeGreaterThanOrEqual(TILE_TIERS[0]);
    // The plot the tiers thin for is the one the tiles' fit reckons (dashboard_fit.ts: the tile less its border, 32 and 78).
    for (const w of [4, 6, 8, 12]) {
      expect(analyticFit("buyer/quarters", w, 14).width).toBe(Math.floor(tileWidthPx(w) - 2 - TILE_PLOT_LESS));
      expect(buildFit("chart", w, 14).width).toBe(Math.floor(tileWidthPx(w) - 2 - TILE_PLOT_LESS));
    }
  });
});
