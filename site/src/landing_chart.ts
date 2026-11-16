// The geometry of the landing page's builder picture (pages/landing.tsx
// BuildStage, docs/landing.md): a bar per value on one scale, the line
// through the bars' tops, three gridlines with their labels and the largest
// bar's label, on the stage's 320 by 250 box. Values in, numbers and the
// labels' text out; nothing here reads a file or knows a language (fmt
// writes every amount), so a test can hold every coordinate to the figures.

export const CHART_WIDTH = 320;
export const CHART_HEIGHT = 250;
// The plot: from the gridlines' labels at the left to the box's right edge,
// from the top gridline down to the baseline the bars stand on.
export const PLOT_LEFT = 34;
export const PLOT_RIGHT = 312;
export const PLOT_TOP = 35;
export const PLOT_BASE = 215;
// Three gridlines, the top one at PLOT_TOP; a bar is at most this wide.
export const CHART_TICKS = 3;
const BAR_MAX = 24;
// Where the labels sit: the gridlines' to the left of the plot and on their
// line, the years under the baseline, the largest bar's above its top.
const TICK_LABEL_X = PLOT_LEFT - 6;
const TICK_LABEL_DY = 3;
const YEAR_LABEL_Y = PLOT_BASE + 16;
const PEAK_LABEL_DY = 5;
// A gridline's step is the smallest of these (times a power of ten) that
// lets the three gridlines reach the largest value, so the axis reads in
// round figures and the tallest bar fills most of the plot.
const STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
// Up to this many bars, every bar's label is written; past it, every other
// one, from the first.
const ALL_LABELS_UP_TO = 6;

export type ChartInput = { label: string; value: number };
export type Bar = { x: number; y: number; w: number; h: number };
export type BuildChart = {
  bars: Bar[];
  // The line through the bars' tops, at the bars' centres, and the same points as a path.
  points: { x: number; y: number }[];
  line: string;
  // The gridlines, bottom up, each with its value written by fmt.
  ticks: { y: number; labelX: number; labelY: number; text: string }[];
  // The labels under the bars, at each labelled bar's centre.
  xLabels: { x: number; y: number; text: string }[];
  // The largest bar (the first of equals) and its label above it.
  peak: { index: number; x: number; y: number; text: string };
  // The value the top gridline stands for: one scale for the bars, the line and the gridlines.
  top: number;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

// The gridlines' step for a largest value: 8 for 22.24 (8, 16, 24), 1 for
// nothing to draw.
export function tickStep(max: number, ticks = CHART_TICKS): number {
  if (!(max > 0) || !Number.isFinite(max)) return 1;
  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  // A hair under the raw step still counts, so 24 over three gridlines is 8 and not 10.
  for (const m of STEPS) if (m * power >= raw * (1 - 1e-9)) return m * power;
  return 10 * power;
}

export function buildChart(rows: readonly ChartInput[], fmt: (value: number) => string): BuildChart {
  const n = rows.length;
  const values = rows.map((r) => (Number.isFinite(r.value) && r.value > 0 ? r.value : 0));
  const max = Math.max(0, ...values);
  const step = tickStep(max);
  const top = step * CHART_TICKS;
  const scale = (PLOT_BASE - PLOT_TOP) / top;
  const slot = (PLOT_RIGHT - PLOT_LEFT) / Math.max(1, n);
  const w = Math.min(BAR_MAX, slot * 0.7);
  const centre = (i: number) => PLOT_LEFT + slot * (i + 0.5);
  const bars = values.map((v, i) => {
    const h = v * scale;
    return { x: r1(centre(i) - w / 2), y: r1(PLOT_BASE - h), w: r1(w), h: r1(h) };
  });
  const points = bars.map((b, i) => ({ x: r1(centre(i)), y: b.y }));
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("");
  const ticks = Array.from({ length: CHART_TICKS }, (_, k) => {
    const y = r1(PLOT_BASE - step * (k + 1) * scale);
    return { y, labelX: TICK_LABEL_X, labelY: r1(y + TICK_LABEL_DY), text: fmt(step * (k + 1)) };
  });
  const every = n > ALL_LABELS_UP_TO ? 2 : 1;
  const xLabels = rows.flatMap((r, i) => (i % every === 0 ? [{ x: points[i].x, y: YEAR_LABEL_Y, text: r.label }] : []));
  const index = Math.max(0, values.indexOf(max));
  const peak = { index, x: points[index]?.x ?? r1(centre(0)), y: r1((bars[index]?.y ?? PLOT_BASE) - PEAK_LABEL_DY), text: fmt(values[index] ?? 0) };
  return { bars, points, line, ticks, xLabels, peak, top };
}
