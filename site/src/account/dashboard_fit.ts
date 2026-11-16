// What a dashboard tile shows at its size (docs/accounts.md, Dashboard): the
// rows a list holds and the size of a chart, from the tile's kind and its w
// and h on the grid (public/dash-grid.js), worked out here and nowhere else.
// dashboard.tsx asks once per tile, on a page view and for one tile's
// fragment after a resize; the statements take the rows as their LIMIT.
//
// The figures are the stylesheet's (public/styles.css, the dashboard's
// rules and the tables'), reckoned for a window 1,280 px wide (REF_WINDOW),
// where a tile of w columns is w x 68.4 px plus its gaps: a head band of 41
// px (53 with the item's line), a foot of 33, a table's head row of 33, a
// row of 8 px padding each side, 20 px a line of text (a small line too,
// inside a cell) and 16 a small line in a block of its own,
// and the table stacked into labelled rows when the tile is narrower than
// STACK_BELOW. A row's main text wraps at about 6.6 px a character. The page
// lays the tile out in the browser at its real width, where its script
// takes off any row that still does not fit (public/dashboard.js trim), so
// these figures err tall: a row reckoned too tall leaves room under the
// list, never a row cut in half.

import { COLS, GAP_PX, ROW_PX } from "../../public/dash-grid.js";
import type { ClaimBlock } from "./org_claim";

export const ROWS_MIN = 3;
export const ROWS_MAX = 25;

// The window the sizes are reckoned at, and its content column: the window
// less the scrollbar (15), the rail (264) and the page's gutters (2 x 24).
export const REF_WINDOW = 1280;
const CONTENT_PX = REF_WINDOW - 15 - 264 - 48;
const COL_PX = (CONTENT_PX - (COLS - 1) * GAP_PX) / COLS;
// A tile narrower inside its border than this stacks its table (the stylesheet's container query, .dash-tile).
export const STACK_BELOW = 440;

const HEAD_PX = 41;
const HEAD_ITEM_PX = 53;
const FOOT_PX = 33;
const TABLE_HEAD_PX = 33;
const LINE_PX = 20;
const CHAR_PX = 6.6;
// A row's padding and its rule.
const ROW_FRAME_PX = 17;
// A block in the body that is not a table (a line of figures, the advisory line): its 12 px margins.
const BLOCK_PX = 24;
const SMALL_PX = 16;
// A small line inside a table's cell (a name under a title): the cell's own 20 px line box holds it.
const UNDER_PX = 20;

// A tile's outer width and height on the grid at the reference window.
export const tileWidthPx = (w: number): number => w * COL_PX + (w - 1) * GAP_PX;
export const tileHeightPx = (h: number): number => h * ROW_PX + (h - 1) * GAP_PX;

// How each kind's body is built. item: the head carries the item's line.
// lead: the blocks beside the table. fixed: the table's columns other than
// the main one (src/columns.tsx). chars: a main cell's usual text. under:
// small lines under it. cells: what the other cells take once stacked, each
// on a line of its own. least: a row's least height in the table (a cell of
// two lines elsewhere in it). list: a list's line, where the body is no table.
type Body = { item: boolean; lead: number; fixed: number; chars: number; under: number; cells: number; least: number; list?: number };

const RADAR: Body = { item: true, lead: BLOCK_PX + SMALL_PX, fixed: 244, chars: 50, under: UNDER_PX, cells: 44, least: 37 };
const BLOCKS: Readonly<Record<ClaimBlock, Body>> = {
  // Each source over two fiscal years, a figure and its count in each cell.
  years: { item: true, lead: 0, fixed: 296, chars: 26, under: 0, cells: 84, least: 57 },
  segments: { item: true, lead: 0, fixed: 244, chars: 50, under: 0, cells: 44, least: 37 },
  // The segment's line over the table and the caveat under it, two lines.
  share: { item: true, lead: 2 * BLOCK_PX + 3 * SMALL_PX, fixed: 308, chars: 20, under: 0, cells: 44, least: 37 },
  ending: RADAR,
  buyers: { item: true, lead: 0, fixed: 192, chars: 40, under: 0, cells: 44, least: 37 },
  instruments: { item: true, lead: 0, fixed: 112, chars: 20, under: 2 * UNDER_PX, cells: 22, least: 37 },
};

const BODIES: Readonly<Record<string, Body>> = {
  // A buyer's name in two lines beside the title.
  tenders: { item: true, lead: 0, fixed: 312, chars: 55, under: 0, cells: 66, least: 57 },
  radar: RADAR,
  records: BLOCKS.years,
  // The week's counts by kind over the table, in two lines; a title, its line and the watch under it.
  watches: { item: false, lead: BLOCK_PX + 2 * SMALL_PX, fixed: 112, chars: 50, under: 2 * UNDER_PX, cells: 22, least: 37 },
  // A briefing's four counts, a line each.
  briefing: { item: true, lead: BLOCK_PX, fixed: 0, chars: 0, under: 0, cells: 0, least: 0, list: 28 },
  // The advisory line over the table, in three small lines; a band beside the title.
  matches: { item: false, lead: BLOCK_PX + 3 * SMALL_PX, fixed: 240, chars: 55, under: 0, cells: 48, least: 57 },
  // The plan's daily figure over the table; each key's name and prefix.
  api: { item: false, lead: BLOCK_PX + SMALL_PX, fixed: 96, chars: 20, under: UNDER_PX, cells: 22, least: 37 },
};

export type ChartFit = { width: number; height: number; panels: number };
// A plot's least height: the three figures of its scale apart.
export const CHART_LEAST = 64;
export type Fit = { rows: number; stacked: boolean; body: number; chart: ChartFit | null };

const lines = (chars: number, px: number) => Math.min(3, Math.max(1, Math.ceil((chars * CHAR_PX) / Math.max(1, px))));

// The body's height inside a tile of h rows, under its head and over its foot.
export const bodyPx = (h: number, item: boolean): number => tileHeightPx(h) - 2 - (item ? HEAD_ITEM_PX : HEAD_PX) - FOOT_PX;

const bodyOf = (kind: string, ref: string): Body => (kind === "org" ? BLOCKS[ref as ClaimBlock] ?? BLOCKS.years : BODIES[kind] ?? BLOCKS.years);

// -- a table of an analytics view on a tile (dashboard.tsx kind "analytic", pages/analytics.tsx analyticBody) --------

// What a table's panel draws over its table: one chart (or ranked bars, a bar a row), two charts, a chart an
// organization (the share table), or nothing. Each shape has its own least and starting size (public/dash-grid.js
// LEAST, "analytic:<shape>").
export type AnalyticShape = "chart" | "two" | "share" | "table";

// How a table of a view is built on a tile. lead: the blocks over its charts (a line, the figures). plots: the
// plots whose height follows the tile's; frame: the charts' own height besides them (titles, the axis, margins).
// per: what each row listed adds beside its table row (a ranked bar; an organization's own chart in the share
// table, whose plot is rowPlot), at the tile's width and below its stacking width. row: the table's row as the md layout draws it
// (src/columns.tsx; a tile narrower than REST_BELOW rests its secondary columns, as the page does from 700 to
// 1279 px). stack: the tile width below which the table stacks into labelled rows (the stylesheet's container
// queries, .dash-stack-540 and .dash-stack-640, else the tiles' own 440).
type AnalyticBody = { shape: AnalyticShape; lead: number; plots: number; frame: number; per: [number, number]; row: Body; stack: number; rowPlot?: number };

// A tile narrower than this inside its border rests its table's secondary columns (styles.css .dash-rest), at
// least as wide as the widest table of a view (the buyer's quarters, 960 px with every column).
export const REST_BELOW = 960;
// A plot's height in the share table: each organization's own chart, a row each.
export const SHARE_PLOT = CHART_LEAST;
// The share of the room under the leads a tile gives its charts, before its rows; and the tallest a plot grows when
// the rows read are fewer than the tile holds.
const CHART_SHARE = 0.45;
export const PLOT_MAX = 320;

// A chart's frame: the chart's margins (16 each side), each stack's first title (26) and its axis (24), each
// further panel's title (36).
const frameOf = (stacks: number, panels: number): number => 32 + stacks * (26 + 24) + 36 * (panels - stacks);
// A row of a table by fiscal year: the year, short figures. The current year's row is a line taller (its "(to
// date)" under the year), once a table (NOW_PX, with the leads), unless its rows are two lines anyway.
const yearRow = (fixed: number, under: number, cells: number): Body => ({ item: true, lead: 0, fixed, chars: 14, under, cells, least: 37 });
const NOW_PX = LINE_PX;
// A ranked table (rank, a name, records, value, share) and its bars, a row each.
const RANK_ROW: Body = { item: true, lead: 0, fixed: 396, chars: 30, under: 0, cells: 88, least: 37 };
const RANKED = { lead: 0, plots: 0, frame: BLOCK_PX, per: [28, 52] as [number, number], row: RANK_ROW, stack: 540 };
// A records table: the title over its reference, the organization or the buyer beside it.
const recordsRow = (fixed: number, under: number, cells: number): Body => ({ item: true, lead: 0, fixed, chars: 50, under, cells, least: 37 });
const NONE: [number, number] = [0, 0];

export const ANALYTIC_BODIES: Readonly<Record<string, AnalyticBody>> = {
  "buyer/quarters": { shape: "chart", lead: 0, plots: 1, frame: frameOf(1, 1), per: NONE, row: yearRow(208, UNDER_PX, 66), stack: 440 },
  "buyer/values": { shape: "two", lead: NOW_PX, plots: 2, frame: frameOf(1, 2), per: NONE, row: yearRow(340, 0, 66), stack: 540 },
  "buyer/records": { shape: "table", lead: 0, plots: 0, frame: 0, per: NONE, row: recordsRow(404, 2 * UNDER_PX, 66), stack: 540 },
  "buyer/segments": { shape: "chart", ...RANKED },
  "buyer/competition": { shape: "two", lead: NOW_PX, plots: 2, frame: frameOf(1, 2), per: NONE, row: yearRow(368, 0, 66), stack: 540 },
  // The shares of the largest one, five and ten over the bars, in two lines.
  "buyer/suppliers": { shape: "chart", ...RANKED, lead: BLOCK_PX + 2 * LINE_PX },
  "buyer/growth": { shape: "two", lead: 0, plots: 2, frame: frameOf(1, 2), per: NONE, row: yearRow(368, 2 * UNDER_PX, 110), stack: 540 },
  // What the contracts ending are, a line over two charts of their own, then the quarters.
  "buyer/due": {
    shape: "two", lead: BLOCK_PX + 2 * LINE_PX, plots: 2, frame: frameOf(2, 2), per: NONE,
    row: { item: true, lead: 0, fixed: 356, chars: 24, under: 0, cells: 66, least: 37 }, stack: 540,
  },
  "organization/years": { shape: "chart", lead: NOW_PX, plots: 1, frame: frameOf(1, 1), per: NONE, row: yearRow(368, 0, 66), stack: 540 },
  "organization/records": { shape: "table", lead: 0, plots: 0, frame: 0, per: NONE, row: recordsRow(500, UNDER_PX, 110), stack: 640 },
  "organization/buyers": { shape: "chart", ...RANKED },
  "organization/segments": { shape: "chart", ...RANKED },
  // The segment's line, then each organization's chart over its row of the table.
  "organization/share": {
    shape: "share", lead: BLOCK_PX + 2 * LINE_PX, plots: 0, frame: frameOf(1, 1) - 26, per: [36 + SHARE_PLOT, 36 + SHARE_PLOT], rowPlot: SHARE_PLOT,
    row: { item: true, lead: 0, fixed: 340, chars: 30, under: 0, cells: 66, least: 37 }, stack: 540,
  },
  "organization/growth": { shape: "two", lead: 0, plots: 2, frame: frameOf(1, 2), per: NONE, row: yearRow(368, 2 * UNDER_PX, 110), stack: 540 },
  "segment/years": { shape: "two", lead: NOW_PX, plots: 2, frame: frameOf(1, 2), per: NONE, row: yearRow(400, 0, 88), stack: 540 },
  "segment/values": { shape: "two", lead: NOW_PX, plots: 2, frame: frameOf(1, 2), per: NONE, row: yearRow(340, 0, 66), stack: 540 },
  "segment/records": { shape: "table", lead: 0, plots: 0, frame: 0, per: NONE, row: recordsRow(404, 2 * UNDER_PX, 66), stack: 540 },
  "segment/buyers": { shape: "chart", ...RANKED },
  "segment/winners": { shape: "chart", ...RANKED },
  // The count of newcomers, a line over the ranked table.
  "segment/entrants": { shape: "table", lead: BLOCK_PX + 2 * LINE_PX, plots: 0, frame: 0, per: NONE, row: RANK_ROW, stack: 540 },
  "segment/due": {
    shape: "two", lead: BLOCK_PX + 2 * LINE_PX, plots: 2, frame: frameOf(2, 2), per: NONE,
    row: { item: true, lead: 0, fixed: 356, chars: 24, under: 0, cells: 66, least: 37 }, stack: 540,
  },
};

// A table's shape and its tile's size key ("analytic:chart"), by its view and name ("buyer/quarters").
export const analyticShape = (name: string): AnalyticShape => ANALYTIC_BODIES[name]?.shape ?? "table";
export const analyticKey = (name: string): string => `analytic:${analyticShape(name)}`;

// The rows a table of a view lists on a tile, at its size, and its charts: each plot's height and its width. held
// is the rows before the floor of ROWS_MIN, unit a row's height with what it adds (the plots may take the room of
// the rows a read does not fill, analyticPlot).
export type AnalyticFit = Fit & { plot: number; width: number; held: number; unit: number };

export function analyticFit(name: string, w: number, h: number): AnalyticFit {
  const b = ANALYTIC_BODIES[name] ?? ANALYTIC_BODIES["buyer/records"];
  const body = bodyPx(h, true);
  const inner = tileWidthPx(w) - 2;
  const stacked = inner < b.stack;
  const r = b.row;
  const row = stacked
    ? ROW_FRAME_PX + LINE_PX * lines(r.chars, inner - 32) + r.under + r.cells
    : Math.max(r.least, ROW_FRAME_PX + LINE_PX * lines(r.chars, inner - r.fixed - 16) + r.under);
  const unit = row + (stacked ? b.per[1] : b.per[0]);
  let room = body - b.lead - b.frame - (stacked ? 0 : TABLE_HEAD_PX);
  let plot = b.rowPlot ?? 0;
  if (b.plots) {
    const least = b.plots * CHART_LEAST;
    const total = Math.max(least, Math.min(Math.floor(room * CHART_SHARE), room - ROWS_MIN * unit));
    plot = Math.min(PLOT_MAX, Math.floor(total / b.plots));
    room -= plot * b.plots;
  }
  const held = Math.floor(room / unit);
  const width = Math.floor(tileWidthPx(w) - 2 - 32 - 78);
  return {
    rows: Math.min(ROWS_MAX, Math.max(ROWS_MIN, held)), stacked, body, held, unit, plot, width,
    chart: b.plots ? { width, height: plot, panels: b.plots } : null,
  };
}

// Each plot's height once the read gives fewer rows than the tile holds: the rows' room left over shared by the
// plots, up to PLOT_MAX.
export function analyticPlot(name: string, fit: AnalyticFit, shown: number): number {
  const plots = ANALYTIC_BODIES[name]?.plots ?? 0;
  if (!plots || shown >= fit.rows) return fit.plot;
  return Math.max(fit.plot, Math.min(PLOT_MAX, fit.plot + Math.floor(((fit.rows - shown) * fit.unit) / plots)));
}

// The room a tile's list has and the height of one of its rows.
function measure(kind: string, ref: string, w: number, h: number): { room: number; row: number; stacked: boolean; body: number } {
  const b = bodyOf(kind, ref);
  const body = bodyPx(h, b.item);
  const inner = tileWidthPx(w) - 2;
  if (b.list !== undefined) return { room: body - b.lead, row: b.list, stacked: false, body };
  if (inner < STACK_BELOW) return { room: body - b.lead, row: ROW_FRAME_PX + LINE_PX * lines(b.chars, inner - 32) + b.under + b.cells, stacked: true, body };
  const row = Math.max(b.least, ROW_FRAME_PX + LINE_PX * lines(b.chars, inner - b.fixed - 16) + b.under);
  return { room: body - b.lead - TABLE_HEAD_PX, row, stacked: false, body };
}

// The tile's rows (ROWS_MIN to ROWS_MAX), whether its table stacks, and its
// chart's size. ref names a block of the organization, or for an analytics
// table its view and name ("buyer/quarters", analyticFit); a view's tile is
// its first table's (dashboard.tsx).
export function tileFit(kind: string, ref: string, w: number, h: number): Fit {
  if (kind === "analytic") return analyticFit(ref, w, h);
  const m = measure(kind, ref, w, h);
  return { rows: Math.min(ROWS_MAX, Math.max(ROWS_MIN, Math.floor(m.room / m.row))), stacked: m.stacked, body: m.body, chart: null };
}

// How many rows fit before the floor of ROWS_MIN is applied (an analytics
// table: with its plots at their least height or more): what the least and
// starting sizes in public/dash-grid.js are held to (test/dash-grid.test.ts).
// A text tile lists no row, so any size holds it.
export function rowsHeld(kind: string, ref: string, w: number, h: number): number {
  if (kind === "text") return ROWS_MAX;
  if (kind === "analytic") return analyticFit(ref, w, h).held;
  const m = measure(kind, ref, w, h);
  return Math.floor(m.room / m.row);
}
