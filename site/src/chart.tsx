// Charts drawn on the server, for the trends pages. The marks (bars, lines,
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
function marks(p: Panel, ticks: number[], top: number, grid: number[], markers: Marker[], sx: (x: number) => number, gap: number): string {
  const sy = (v: number) => H - (v / top) * H;
  const ns = ' vector-effect="non-scaling-stroke"';
  let out = "";
  for (const v of ticks.slice(1)) out += `<line class="grid" x1="0" x2="${W}" y1="${f(sy(v))}" y2="${f(sy(v))}"${ns}/>`;
  for (const x of grid) out += `<line class="grid grid-x" x1="${f(sx(x))}" x2="${f(sx(x))}" y1="0" y2="${H}"${ns}/>`;
  for (const b of p.bars ?? []) {
    if (!(b.value > 0)) continue;
    const x0 = sx(b.x0 + gap);
    const x1 = sx(b.x1 - gap);
    out += `<rect class="${b.light ? "bar bar-light" : "bar"}" x="${f(x0)}" y="${f(sy(b.value))}" width="${f(Math.max(0.5, x1 - x0))}" height="${f(H - sy(b.value))}"><title>${esc(b.title)}</title></rect>`;
  }
  for (const m of markers) out += `<line class="mark" x1="${f(sx(m.x))}" x2="${f(sx(m.x))}" y1="0" y2="${H}"${ns}/>`;
  const line = p.line ?? [];
  if (line.length > 1) out += `<polyline class="line" points="${line.map((pt) => `${f(sx(pt.x))},${f(sy(pt.value))}`).join(" ")}"${ns}/>`;
  // A zero-length line with round caps draws a round dot at any stretch.
  if (line.length <= 60) {
    for (const pt of line) {
      out += `<line class="dot" x1="${f(sx(pt.x))}" x2="${f(sx(pt.x))}" y1="${f(sy(pt.value))}" y2="${f(sy(pt.value))}"${ns}><title>${esc(pt.title)}</title></line>`;
    }
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
}> = ({ domain, panels, height, xLabels, grid = [], markers = [], fmt, aria, shared, gap: barGapUnits }) => {
  useTips();
  const span = domain[1] - domain[0];
  const sx = (x: number) => ((x - domain[0]) / span) * W;
  const pct = (x: number) => ((x - domain[0]) / span) * 100;
  const peak = (p: Panel) => Math.max(0, ...(p.bars ?? []).map((b) => b.value), ...(p.line ?? []).map((pt) => pt.value));
  const sharedTicks = shared ? niceTicks(Math.max(...panels.map(peak))) : null;
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
                  data-tip="keys">{raw(marks(p, ticks, top, grid, markers, sx, gap))}</svg>
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
            return xLabels.map((l, i) => shown[i]
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
// shows the first and the last past four.
export function fiscalAxis(first: number, last: number, label: (fy: number) => string, per = 1): { labels: AxisLabel[]; grid: number[] } {
  const labels: AxisLabel[] = [];
  const grid: number[] = [];
  const span = last - first + 1;
  for (let fy = first; fy <= last; fy++) {
    if (fy > first) grid.push(fy * per);
    labels.push({
      x: fy * per + per / 2, text: label(fy),
      minor: span > 6 && (last - fy) % 2 === 1,
      phone: span <= 4 || fy === first || fy === last,
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
// hover and when the link in its label takes the keyboard focus.
export const RankedBars: FC<{ rows: readonly RankedBar[]; aria: string }> = ({ rows, aria }) => {
  useTips();
  const top = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ol class="rank-bars" aria-label={aria} data-tip="">
      {rows.map((r) => (
        <li title={r.title}>
          <span class="rank-label">{r.label as any}</span>
          <span class="rank-track" aria-hidden="true">
            {r.value > 0 && top > 0 ? <span class="rank-bar" style={`width:${f(Math.max(0.5, (r.value / top) * 100))}%`}></span> : null}
          </span>
          <span class="rank-value">{r.text}{r.note ? <span class="muted"> {r.note}</span> : null}</span>
        </li>
      ))}
    </ol>
  );
};
