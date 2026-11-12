// Charts drawn on the server, for the trends pages. The marks (thin bars
// with a rounded data end, lines over a wash with ringed dots, hairline
// gridlines) sit in an inline SVG that stretches to the plot's width
// (preserveAspectRatio="none", strokes held at a fixed width by
// vector-effect), and the words (axis labels, marker numbers) are HTML placed
// by percentage. An SVG scaled to the page would scale its text with it, so a
// 12 px label would read at 6 px on a phone; HTML text keeps its size at any
// width. Colours come from custom properties in the stylesheet, so the charts
// follow the light and dark themes. Every figure is in the table under the
// chart.
//
// Each bar and point carries its tip as its SVG <title>: a head line (the
// panel's series and the period) over the exact figures, one a line (the
// full money value with its cents rule, never the tiles' short form, and
// the count or the parts of a share). Without a script the browser shows
// that title after its own delay; public/tooltip.js shows the same lines at
// once in the site's box, on hover, on a tap and on keyboard focus. An
// element marked data-tip holds tips: a chart's SVG (data-tip="keys", whose
// marks the arrow keys step through), the ranked bars, the home map, and a
// short-form figure (ShortMoney), which is its own tip.

import { raw } from "hono/html";
import { useContext, type FC } from "hono/jsx";
import { TableUseContext } from "./columns";
import { fmtInt, fmtMoney, fmtMoneyShort, fmtPct, t, tn, type Lang } from "./i18n";

const W = 1000;
const H = 100;
const DAY = 86_400_000;

// A bar is a thin mark with air around it, never a slab that fills its slot:
// at most BAR_SHARE of the slot and about BAR_MAX_PX wide, centred. Its data
// end is rounded by about BAR_RADIUS_PX and its foot stays square on the
// baseline. The plot stretches with the page, so pixels are worked out for a
// plot PLOT_PX wide (a column's on a desktop): a narrower plot draws the bars
// thinner in step, and the corner's two radii are given apart, the vertical
// one from the plot's own height, so the corner is round at that width and
// near enough to it at any other.
const PLOT_PX = 900;
const BAR_MAX_PX = 22;
const BAR_SHARE = 0.6;
const BAR_RADIUS_PX = 4;
// The marks fade a little (operator, 2026-11-11: the subtle of two versions):
// a bar is full at its data end, where its value is read, and lighter toward
// its foot; a line's wash fades from the line to nothing at the baseline.
// Each is a gradient over the mark's own box, so a short bar is a tall one in
// miniature and the fade never says a value twice. The stops take their
// colour and strength from the stylesheet (.fade-*, .wash-*), so both themes
// follow; a mark names its gradient with the plain colour after it, which a
// browser that cannot resolve the gradient draws instead.
const fadeId = (chart: number, panel: number) => `cf-${chart}-${panel}`;
const washId = (chart: number, panel: number) => `cw-${chart}-${panel}`;
const gradient = (id: string, top: string, foot: string) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="${top}"/><stop offset="1" class="${foot}"/></linearGradient>`;

// A line of more points than this keeps a dot on its last point only; the
// others stay as marks for the pointer and the keys, unseen until one is on
// them, so a long line reads as a line.
const DOTS_SHOWN_MAX = 24;

// Position on a time axis measured in quarters: 2024-01-01 is 2024 * 4,
// 2024-04-01 one more, and a day inside a quarter falls in proportion. With
// `endOfDay` the position is the day's end, so a quarter's last day ends on
// the next whole number.
export function quarterPos(iso: string, endOfDay = false): number {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  const q = Math.floor((m - 1) / 3);
  const start = Date.UTC(y, q * 3, 1);
  const end = Date.UTC(y, q * 3 + 3, 1);
  return y * 4 + q + (Date.UTC(y, m - 1, d) + (endOfDay ? DAY : 0) - start) / (end - start);
}

// Position on a time axis measured in days (the daily series).
export function dayPos(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
}

// Gridline values from zero to a round number at or above the largest value:
// steps of 1, 2 or 5 (and 2.5 from 25 up) times a power of ten, never a fraction.
export function niceTicks(max: number, count = 3): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const factors = mag >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const step = Math.max(1, (factors.find((f) => f * mag >= raw) ?? 10) * mag);
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) {
    ticks.push(v);
    if (v >= max) break;
  }
  return ticks;
}

export interface Bar {
  x0: number;
  x1: number;
  value: number;
  // A file covering several quarters, drawn lighter at its average per quarter.
  light?: boolean;
  // The tip's lines (tipText): the head, then the exact figures.
  title: string;
}

export interface LinePoint {
  x: number;
  value: number;
  title: string;
}

// A fiscal year's figure for the charts a year apart (pages/analytics.tsx
// YearChart, account/org_pages.tsx YearBars): the year, the value drawn and
// the tip's exact figures under its head.
export type YearPoint = [year: number, value: number, figures: string[]];

// -- tips ------------------------------------------------------------------------------

// A tip's text, one line each: the head (what the figure is and its period),
// then the exact figures. The script shows the head in the muted type and
// the figures in ink; a tip of one line is a figure alone.
export function tipText(head: string | null, figures: readonly string[]): string {
  return [head, ...figures].filter((s): s is string => !!s).join("\n");
}

// The head of a chart mark's tip: the panel's series and the mark's period.
export function tipHead(lang: Lang, label: string, period: string): string {
  return t(lang, "tip.head", { label, period });
}

// "12 records", the count a figure adds up.
export function recordsText(lang: Lang, n: number): string {
  return tn(lang, "org.tile_records_one", "org.tile_records_many", n, { n: fmtInt(n, lang) });
}

// The tip of a money mark: the series and the period over the exact value
// and, where the caller has one, the count it adds up.
export function moneyTip(lang: Lang, label: string, period: string, value: number, count?: string): string {
  return tipText(tipHead(lang, label, period), [fmtMoney(value, lang), ...(count ? [count] : [])]);
}

// A share with its parts, "$1,234,567 of $3,600,000 (34%)", each part as fmt
// writes it; the part alone where the whole is not positive.
export function partOf(lang: Lang, part: number, whole: number, fmt: (v: number) => string): string {
  const pct = fmtPct(part, whole, lang);
  return pct ? t(lang, "tip.part_of", { part: fmt(part), whole: fmt(whole), pct }) : fmt(part);
}

// Tells the layout this page draws a tip, so it loads public/tooltip.js and
// the box it fills after the content (src/layout.tsx), as a sortable table
// loads public/sort.js.
export function useTips(): void {
  const use = useContext(TableUseContext);
  if (use) use.tips = true;
}

// A money figure in the tiles' short form ($4.5M, 4,5 M$) with its exact
// value as its title, which the script shows as the tip. Below a million the
// short form is the whole amount and the figure carries no title.
export const ShortMoney: FC<{ lang: Lang; value: number; class?: string }> = ({ lang, value, class: cls }) => {
  const text = fmtMoneyShort(value, lang);
  const exact = fmtMoney(value, lang);
  if (text === exact) return cls ? <span class={cls}>{text}</span> : <>{text}</>;
  useTips();
  return <span class={cls} title={exact} data-tip="">{text}</span>;
};

export interface Panel {
  title: string;
  bars?: Bar[];
  line?: LinePoint[];
  tone?: "approved" | "refused" | "pending";
  // A level drawn across the plot as a dashed rule (a key's daily cap on the
  // usage page, account/api_usage_page.tsx), only while the axis reaches it.
  rule?: number;
}

export interface Marker {
  x: number;
  n: number;
}

export interface AxisLabel {
  x: number;
  text: string;
  // Hidden on a narrow screen, so every other year shows.
  minor?: boolean;
  // False for a label a phone leaves out (below 700 px only some years show).
  phone?: boolean;
  // Never drawn at any width, but kept in the axis's spacing (clearOfAnchors):
  // every other year of a long fiscal axis (fiscalAxis).
  hidden?: boolean;
}

// The labels of a chart with one bar a year, from first to last: every other
// year rests below 1200 px, and below 700 px only the first, the last and
// every fifth year at least three years clear of both show.
export function yearLabels(first: number, last: number): AxisLabel[] {
  const labels: AxisLabel[] = [];
  for (let y = first; y <= last; y++) {
    labels.push({
      x: y + 0.5, text: String(y),
      minor: (last - y) % 2 === 1 && last - first > 8,
      phone: y === first || y === last || (y % 5 === 0 && y - first >= 3 && last - y >= 3),
    });
  }
  return labels;
}

const f = (v: number) => (Math.round(v * 100) / 100).toString();

// Marker numbers stagger onto as many rows as it takes to keep them this far
// apart, as a share of the plot's width: about 20 px on a phone, and a
// tighter share on a wide screen (min-width 1000px in the stylesheet), where
// the same share is three times as many pixels.
const MARK_GAP = 4.5;
const MARK_GAP_WIDE = 3.2;
// Markers float over the first panel's title line only when every one is at
// least this far into the plot (percent), clear of the title text on a phone.
const TITLE_CLEAR = 35;

export function markerRows(markers: Marker[], domain: [number, number], gap = MARK_GAP): { m: Marker; left: number; row: number }[] {
  const last: number[] = [];
  return [...markers]
    .sort((a, b) => a.x - b.x)
    .map((m) => {
      const left = ((m.x - domain[0]) / (domain[1] - domain[0])) * 100;
      let row = last.findIndex((at) => left - at >= gap);
      if (row < 0) row = last.length;
      last[row] = left;
      return { m, left, row };
    });
}

// Labels near either end are anchored to that end, so they stay over the plot.
function anchor(left: number): string | undefined {
  return left < 4 ? "x-start" : left > 96 ? "x-end" : undefined;
}

// A label's classes: its anchor, and when it rests. A chart whose labels say
// what a phone shows (yearLabels) rests the minor ones from 700 to 1199 px and
// the others below 700; any other chart rests the minor ones below 1200 px.
function labelClass(l: AxisLabel, anchored: string | undefined): string | undefined {
  const rest = l.phone === undefined
    ? [l.minor && !anchored ? "x-minor" : ""]
    : [l.minor && !anchored ? "x-tablet-minor" : "", l.phone ? "" : "x-phone-minor"];
  return [anchored, ...rest].filter(Boolean).join(" ") || undefined;
}

// An anchored label runs inward from its end of the axis, over the next
// slots, so a label within two slots of one is left out rather than drawn on
// top of it. A slot is the gap between neighbouring labels.
export function clearOfAnchors(lefts: readonly number[]): boolean[] {
  const sorted = [...lefts].sort((a, b) => a - b);
  let slot = Infinity;
  for (let i = 1; i < sorted.length; i++) slot = Math.min(slot, sorted[i] - sorted[i - 1]);
  const anchored = lefts.filter((l) => anchor(l) !== undefined);
  return lefts.map((l) => anchor(l) !== undefined || !anchored.some((a) => Math.abs(l - a) <= 2 * slot + 1e-9));
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The inside of one panel's SVG, written as a string: a panel of the
// province view holds about 40 bars and a page 14 panels, and string
// building costs a fraction of rendering each element through JSX.
function marks(
  p: Panel, ticks: number[], top: number, grid: number[], markers: Marker[], sx: (x: number) => number, gap: number, height: number,
  ids: { fade: string; wash: string },
): string {
  const sy = (v: number) => H - (v / top) * H;
  const ns = ' vector-effect="non-scaling-stroke"';
  let out = "";
  // The gradients this panel's marks use, and no others.
  const fades = (p.bars ?? []).some((b) => b.value > 0 && !b.light);
  const washes = (p.line ?? []).length > 1;
  if (fades || washes) {
    out += `<defs>${fades ? gradient(ids.fade, "fade-top", "fade-foot") : ""}${washes ? gradient(ids.wash, "wash-top", "wash-foot") : ""}</defs>`;
  }
  for (const v of ticks.slice(1)) out += `<line class="grid" x1="0" x2="${W}" y1="${f(sy(v))}" y2="${f(sy(v))}"${ns}/>`;
  for (const x of grid) out += `<line class="grid grid-x" x1="${f(sx(x))}" x2="${f(sx(x))}" y1="0" y2="${H}"${ns}/>`;
  for (const b of p.bars ?? []) {
    if (!(b.value > 0)) continue;
    // The widest the bar may be: its slot less the gap each side, then the
    // share and the cap; what is left of the slot is air, split either side.
    const slot = sx(b.x1) - sx(b.x0);
    const width = Math.max(0.5, Math.min(sx(b.x1 - gap) - sx(b.x0 + gap), slot * BAR_SHARE, (BAR_MAX_PX * W) / PLOT_PX));
    const x0 = sx(b.x0) + (slot - width) / 2;
    const x1 = x0 + width;
    const y = sy(b.value);
    const rx = Math.min((BAR_RADIUS_PX * W) / PLOT_PX, width / 2);
    const ry = Math.min((BAR_RADIUS_PX * H) / height, H - y);
    const d = `M${f(x0)} ${H} L${f(x0)} ${f(y + ry)} A${f(rx)} ${f(ry)} 0 0 1 ${f(x0 + rx)} ${f(y)} ` +
      `L${f(x1 - rx)} ${f(y)} A${f(rx)} ${f(ry)} 0 0 1 ${f(x1)} ${f(y + ry)} L${f(x1)} ${H} Z`;
    // A partial period's bar stays the flat pale step: it is a different kind of mark, and a fade on it would read as a third.
    out += b.light
      ? `<path class="bar bar-light" d="${d}"><title>${esc(b.title)}</title></path>`
      : `<path class="bar" style="fill:url(#${ids.fade}) var(--chart-bar)" d="${d}"><title>${esc(b.title)}</title></path>`;
  }
  for (const m of markers) out += `<line class="mark" x1="${f(sx(m.x))}" x2="${f(sx(m.x))}" y1="0" y2="${H}"${ns}/>`;
  if (p.rule !== undefined && p.rule >= 0 && p.rule <= top) {
    out += `<line class="mark mark-rule" x1="0" x2="${W}" y1="${f(sy(p.rule))}" y2="${f(sy(p.rule))}"${ns}/>`;
  }
  const line = p.line ?? [];
  if (line.length > 1) {
    const points = line.map((pt) => `${f(sx(pt.x))},${f(sy(pt.value))}`);
    // A wash of the line's own colour down to the baseline, under the line.
    out += `<path class="area" style="fill:url(#${ids.wash}) var(--chart-wash)" d="M${f(sx(line[0].x))} ${H} L${points.map((pt) => pt.replace(",", " ")).join(" L")} ` +
      `L${f(sx(line[line.length - 1].x))} ${H} Z"/>`;
    out += `<polyline class="line" points="${points.join(" ")}"${ns}/>`;
  }
  // A zero-length line with round caps draws a round dot at any stretch; one
  // in the panel's colour under it rings the dot, so it stays apart from the
  // line it sits on. Past DOTS_SHOWN_MAX points only the last one shows.
  if (line.length <= 60) {
    const quiet = line.length > DOTS_SHOWN_MAX;
    line.forEach((pt, i) => {
      const at = `x1="${f(sx(pt.x))}" x2="${f(sx(pt.x))}" y1="${f(sy(pt.value))}" y2="${f(sy(pt.value))}"${ns}`;
      const last = i === line.length - 1;
      if (!quiet || last) out += `<line class="dot-ring" ${at}/>`;
      out += `<line class="${quiet && !last ? "dot dot-quiet" : "dot"}" ${at}><title>${esc(pt.title)}</title></line>`;
    });
  }
  return out;
}

export const ChartStack: FC<{
  domain: [number, number];
  panels: Panel[];
  height: number;
  xLabels: AxisLabel[];
  grid?: number[];
  markers?: Marker[];
  fmt: (n: number) => string;
  aria: string;
  // One scale for every panel (the same unit side by side); otherwise each panel has its own.
  shared?: boolean;
  // The space left on each side of a bar, in axis units; by default a thin
  // gap between bars that fill their slot. A chart of few slots passes more,
  // so a bar stays a thin mark rather than a block (barGap).
  gap?: number;
  // The least value the axis reaches, so a panel of small figures (or of none)
  // still draws a scale rather than a few units.
  floor?: number;
}> = ({ domain, panels, height, xLabels, grid = [], markers = [], fmt, aria, shared, gap: barGapUnits, floor = 0 }) => {
  useTips();
  // This stack's number on the page, for its gradients' ids (0 where no page keeps count).
  const use = useContext(TableUseContext);
  const chart = use ? (use.charts = (use.charts ?? 0) + 1) : 0;
  const span = domain[1] - domain[0];
  const sx = (x: number) => ((x - domain[0]) / span) * W;
  const pct = (x: number) => ((x - domain[0]) / span) * 100;
  const peak = (p: Panel) => Math.max(floor, ...(p.bars ?? []).map((b) => b.value), ...(p.line ?? []).map((pt) => pt.value));
  const sharedTicks = shared ? niceTicks(Math.max(floor, ...panels.map(peak))) : null;
  const placed = markerRows(markers, domain);
  const wide = markerRows(markers, domain, MARK_GAP_WIDE);
  const rows = placed.reduce((n, p) => Math.max(n, p.row + 1), 0);
  const rowsWide = wide.reduce((n, p) => Math.max(n, p.row + 1), 0);
  // The numbers sit on the top plot's upper edge, so each one meets its dashed
  // line; when two land close together the second stacks above the first.
  // They float over the title's line, leaving the title as close to its plot
  // as every other panel's, unless one would land under the title text (the
  // left part of the plot), in which case they take a row of their own.
  const marks_ = rows ? (
    <div class="chart-marks" style={`--hn:${rows * 1.6}em;--hw:${rowsWide * 1.6}em`}>
      {placed.map(({ m, left, row }, i) => (
        <span class={anchor(left)}
          style={`left:${f(left)}%;--tn:${(rows - 1 - row) * 1.6}em;--tw:${(rowsWide - 1 - wide[i].row) * 1.6}em`}>{m.n}</span>
      ))}
    </div>
  ) : null;
  const overTitle = rows > 0 && placed.every((p) => p.left >= TITLE_CLEAR);
  const markRow = rows && !overTitle ? (
    <div class="chart-row" aria-hidden="true">
      <span></span>
      {marks_}
    </div>
  ) : null;
  return (
    <div class="chart-stack">
      {panels.map((p, i) => {
        const ticks = sharedTicks ?? niceTicks(peak(p));
        const top = ticks[ticks.length - 1] || 1;
        const gap = barGapUnits ?? Math.min(0.12, span / 400);
        return (
          <>
            <div class="chart-row">
              <span></span>
              {i === 0 && overTitle ? (
                <div class="chart-title-over">
                  <div class="chart-title">{p.title}</div>
                  <div class="chart-marks-over" aria-hidden="true">{marks_}</div>
                </div>
              ) : (
                <div class="chart-title">{p.title}</div>
              )}
            </div>
            {i === 0 ? markRow : null}
            <div class={`chart-row tone-${p.tone ?? "approved"}`}>
              <div class="chart-y" aria-hidden="true" style={`height:${height}px`}>
                {ticks.map((v) => <span style={`bottom:${f((v / top) * 100)}%`}>{fmt(v)}</span>)}
              </div>
              <div class="chart-plot" style={`height:${height}px`}>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${p.title}. ${aria}`} focusable="false"
                  data-tip="keys">{raw(marks(p, ticks, top, grid, markers, sx, gap, height, { fade: fadeId(chart, i), wash: washId(chart, i) }))}</svg>
              </div>
            </div>
          </>
        );
      })}
      <div class="chart-row" aria-hidden="true">
        <span></span>
        <div class="chart-x">
          {(() => {
            const lefts = xLabels.map((l) => pct(l.x));
            const shown = clearOfAnchors(lefts);
            // An end label always shows, even a minor one, as it stands for the axis's start or end.
            return xLabels.map((l, i) => shown[i] && !l.hidden
              ? <span class={labelClass(l, anchor(lefts[i]))} style={`left:${f(lefts[i])}%`}>{l.text}</span>
              : null);
          })()}
        </div>
      </div>
    </div>
  );
};

// One label per calendar year at the middle of the part of it inside the
// domain (quarter units), every other one marked minor; and a gridline at
// each year's start.
export function yearAxis(domain: [number, number]): { labels: AxisLabel[]; grid: number[] } {
  const first = Math.floor(domain[0] / 4);
  const last = Math.ceil(domain[1] / 4) - 1;
  const labels: AxisLabel[] = [];
  const grid: number[] = [];
  for (let y = first; y <= last; y++) {
    const a = Math.max(y * 4, domain[0]);
    const b = Math.min(y * 4 + 4, domain[1]);
    if (b <= a) continue;
    if (y * 4 > domain[0]) grid.push(y * 4);
    labels.push({ x: (a + b) / 2, text: String(y), minor: (last - y) % 2 === 1 });
  }
  return { labels, grid };
}

// One label per fiscal year (text from the caller: "2025-26", "2025-2026"),
// at the middle of its span on an axis measured in `per` units a year (1 for
// yearly bars, 4 for quarters), and on a quarterly axis a gridline at each
// year's start after the first. A fiscal label is wider than a calendar
// year's, so every other one rests below 1200 px past six years and a phone
// shows the first and the last past four. Past LONG_AXIS_YEARS (Ultra's
// twenty) every other one is never drawn, the first and last aside, and of
// the rest every other one rests below 1200 px, so a label still has the room
// a ten-year axis gives it.
export const LONG_AXIS_YEARS = 12;

export function fiscalAxis(first: number, last: number, label: (fy: number) => string, per = 1): { labels: AxisLabel[]; grid: number[] } {
  const labels: AxisLabel[] = [];
  const grid: number[] = [];
  const span = last - first + 1;
  const long = span > LONG_AXIS_YEARS;
  for (let fy = first; fy <= last; fy++) {
    if (fy > first) grid.push(fy * per);
    const hidden = long && (last - fy) % 2 === 1 && fy !== first;
    labels.push({
      x: fy * per + per / 2, text: label(fy),
      minor: long ? (last - fy) % 4 === 2 : span > 6 && (last - fy) % 2 === 1,
      phone: span <= 4 || fy === first || fy === last,
      ...(hidden ? { hidden } : {}),
    });
  }
  return { labels, grid: per > 1 ? grid : [] };
}

// The gap that keeps a bar near `px` pixels wide on a plot about `plot`
// pixels wide holding `slots` one-unit slots (thinner on a phone, where the
// plot is narrower), never less than the default gap and never closing the
// bar entirely.
export function barGap(slots: number, px = 24, plot = 720): number {
  return Math.min(0.46, Math.max(0.12, (1 - (px / plot) * slots) / 2));
}

export interface RankedBar {
  label: unknown;
  value: number;
  // The figure printed at the bar's end, in the short form; title is the tip
  // (tipText): the name over the exact value, the count and the share.
  text: string;
  title: string;
  note?: string;
}

// Ranked horizontal bars, largest first, one hue, for comparing the parts of
// a whole: the label, a bar on one baseline scaled to the largest value, and
// the figure at its end in text ink. HTML rather than SVG, so a long name
// wraps and the type keeps its size at any width. A value at or below zero
// draws no bar and keeps its figure. The table under the chart carries every
// value, so the tip is never the only way to read one. A row's tip shows on
// hover and when the link in its label takes the keyboard focus. max scales
// the bars to a fixed whole instead of the largest row (a key's daily cap on
// the usage page, with class "of-cap", whose track shows that whole).
export const RankedBars: FC<{ rows: readonly RankedBar[]; aria: string; max?: number; class?: string }> = ({ rows, aria, max, class: cls }) => {
  useTips();
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  return (
    <ol class={cls ? `rank-bars ${cls}` : "rank-bars"} aria-label={aria} data-tip="">
      {rows.map((r) => (
        <li title={r.title}>
          <span class="rank-label">{r.label as any}</span>
          <span class="rank-track" aria-hidden="true">
            {r.value > 0 && top > 0 ? <span class="rank-bar" style={`width:${f(Math.min(100, Math.max(0.5, (r.value / top) * 100)))}%`}></span> : null}
          </span>
          <span class="rank-value">{r.text}{r.note ? <span class="muted"> {r.note}</span> : null}</span>
        </li>
      ))}
    </ol>
  );
};
