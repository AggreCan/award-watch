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

// A view's chart (the analytics view's first, dashboard.tsx viewJob): its
// plot's height, each panel's, and its width, from the body less the chart's
// margins (16 each side), each panel's title (26 for the first, 36 for the
// next), the axis's labels (24) and the column of figures (70 and a gap of 8).
function chartFit(w: number, h: number, panels: number): ChartFit {
  const body = bodyPx(h, true);
  const height = Math.floor((body - 32 - 26 - 36 * (panels - 1) - 24) / panels);
  return { width: Math.floor(tileWidthPx(w) - 2 - 32 - 78), height: Math.max(CHART_LEAST, height), panels };
}

const bodyOf = (kind: string, ref: string): Body => (kind === "org" ? BLOCKS[ref as ClaimBlock] ?? BLOCKS.years : BODIES[kind] ?? BLOCKS.years);

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
// chart's size. ref names a block of the organization, or a view's address
// (a segment's view draws two panels).
export function tileFit(kind: string, ref: string, w: number, h: number): Fit {
  if (kind === "view") return { rows: ROWS_MIN, stacked: false, body: bodyPx(h, true), chart: chartFit(w, h, /^\/segments\//.test(ref) ? 2 : 1) };
  const m = measure(kind, ref, w, h);
  return { rows: Math.min(ROWS_MAX, Math.max(ROWS_MIN, Math.floor(m.room / m.row))), stacked: m.stacked, body: m.body, chart: null };
}

// How many rows fit before the floor of ROWS_MIN is applied (a chart: whether
// its plot keeps its least height): what the least and starting sizes in
// public/dash-grid.js are held to (test/dash-grid.test.ts).
export function rowsHeld(kind: string, ref: string, w: number, h: number): number {
  if (kind === "view") {
    const c = chartFit(w, h, /^\/segments\//.test(ref) ? 2 : 1);
    return Math.floor((bodyPx(h, true) - 32 - 26 - 36 * (c.panels - 1) - 24) / c.panels) >= CHART_LEAST ? ROWS_MAX : 0;
  }
  const m = measure(kind, ref, w, h);
  return Math.floor(m.room / m.row);
}
