/* The dashboard's grid: the one copy of its rules, for the page's script
   (public/dashboard.js) and the Worker (src/account/dashboard.tsx), which
   runs every layout a reader posts through it before storing it and never
   trusts a position (docs/accounts.md, Dashboard).

   A tile is { id, kind, x, y, w, h } on COLS columns and rows of ROW_PX
   with GAP_PX between them: x from 0, w from W_MIN to COLS, h from H_MIN to
   H_MAX, and never less than the least size of its kind (LEAST). Tiles
   never overlap. A tile moved or resized pushes down the tiles it meets,
   and then every tile slides up into the free rows above it, as far as the
   tiles above it allow (compact), so a layout has no empty row a tile
   could rise into.

   Which way a moved tile settles against a tile it meets follows the
   pointer, as a sorted list does: moving up (or along its row), it goes
   above a tile once its top reaches that tile's middle, and the tile is
   pushed down; moving down, it goes under a tile once its bottom passes
   that tile's middle. Dropping a tile exactly where another of its height
   was swaps the two, either way.

   Every function returns new tiles and leaves its input alone, so the
   same input gives the same output (ties go by x, then by id), and a
   layout already compacted comes back unchanged. Nothing here touches the
   page, so test/dash-grid.test.ts imports it as it is. */

export const COLS = 12;
export const ROW_PX = 40;
export const GAP_PX = 12;
export const W_MIN = 3;
export const W_MAX = COLS;
export const H_MIN = 2;
export const H_MAX = 16;
// No stored y is believed past this: the most tiles a dashboard holds at the tallest size stack well under it.
export const Y_MAX = 1000;
// Below 1,100 px of window the page has two columns, and a tile this wide or wider takes both.
export const BOTH_FROM = 7;
// A tile narrower than this is narrower than its table at the window the sizes are reckoned at (1,280 px; the
// stylesheet stacks a tile's table in labelled rows below 440 px), so its rows stand taller and it needs more height.
export const NARROW_BELOW = 6;

/**
 * The least size of each kind of tile: w, h from NARROW_BELOW columns, and hn below that, where the table
 * stacks. Each holds three of the kind's rows at the least (src/account/dashboard_fit.ts reckons them; a test
 * holds the two together). A tile's kind here is its size key (the page's sizeKey): the kind, or the kind and
 * what sets its size apart (a segment's view draws two charts; three blocks of the organization stand taller
 * than the others). A key not listed takes its kind's, and an unknown kind the grid's own least.
 * @type {Readonly<Record<string, { w: number, h: number, hn: number }>>}
 */
export const LEAST = {
  tenders: { w: 4, h: 7, hn: 10 },
  radar: { w: 4, h: 8, hn: 10 },
  records: { w: 4, h: 6, hn: 9 },
  watches: { w: 3, h: 8, hn: 10 },
  view: { w: 4, h: 5, hn: 5 },
  "view:segment": { w: 4, h: 7, hn: 7 },
  briefing: { w: 3, h: 4, hn: 4 },
  org: { w: 4, h: 6, hn: 9 },
  "org:share": { w: 4, h: 7, hn: 9 },
  "org:ending": { w: 4, h: 8, hn: 10 },
  "org:instruments": { w: 4, h: 7, hn: 8 },
  matches: { w: 4, h: 7, hn: 10 },
  api: { w: 3, h: 7, hn: 8 },
};

/**
 * The height a tile of each size key starts at: the five rows each list showed before tiles had sizes, at
 * half the row (dashboard_fit.ts again); the whole row holds as many or more.
 * @type {Readonly<Record<string, number>>}
 */
export const START_H = {
  tenders: 10, radar: 11, records: 9, watches: 11, view: 7, "view:segment": 8, briefing: 6, org: 9, "org:share": 8, "org:ending": 11,
  "org:instruments": 10, matches: 10, api: 9,
};

/** A key's own entry in a table, else its kind's (the part before the colon). @template V @param {Readonly<Record<string, V>>} table @param {string | undefined} key @returns {V | null} */
function entry(table, key) {
  if (key === undefined) return null;
  const own = Object.prototype.hasOwnProperty;
  if (own.call(table, key)) return table[key];
  const kind = key.split(":")[0];
  return own.call(table, kind) ? table[kind] : null;
}

/** @typedef {{ id: string, kind?: string, x: number, y: number, w: number, h: number }} Tile */

/** A whole number within [lo, hi], or the fallback for anything that is not a finite number. @param {unknown} v @param {number} lo @param {number} hi @param {number} fallback */
function bound(v, lo, hi, fallback) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/** The least size of a tile of this kind at this width. @param {string | undefined} kind @param {number} [w] */
export function least(kind, w = COLS) {
  const l = entry(LEAST, kind);
  const lw = Math.max(W_MIN, l ? l.w : W_MIN);
  return { w: lw, h: Math.max(H_MIN, l ? (w < NARROW_BELOW ? l.hn : l.h) : H_MIN) };
}

/** The size a tile of this kind starts at. @param {string | undefined} kind @param {boolean} wide */
export function startSize(kind, wide) {
  const w = wide ? COLS : COLS / 2;
  const h = entry(START_H, kind) ?? H_MIN;
  return { w, h: Math.max(h, least(kind, w).h) };
}

/**
 * A tile held to the grid: whole numbers, its width and height within the grid's and at least its kind's,
 * inside the columns (a tile past the right edge moves left), and its top at 0 or below.
 * @template {Tile} T @param {T} t @returns {T}
 */
export function clamp(t) {
  const lw = least(t.kind).w;
  const w = bound(t.w, lw, W_MAX, lw);
  const lh = least(t.kind, w).h;
  return { ...t, w, h: bound(t.h, lh, H_MAX, lh), x: bound(t.x, 0, COLS - w, 0), y: bound(t.y, 0, Y_MAX, 0) };
}

/** Whether two tiles share a cell; a tile never meets itself. @param {Tile} a @param {Tile} b */
export function collides(a, b) {
  return a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Reading order: top, then left, then id. @param {Tile} a @param {Tile} b */
function byTop(a, b) {
  return a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The tiles in reading order (top, then left), as a phone shows them, one under another. @template {Tile} T @param {readonly T[]} tiles @returns {T[]} */
export function stack(tiles) {
  return tiles.map((t) => ({ ...t })).sort(byTop);
}

/** @param {readonly Tile[]} placed @param {Tile} t */
function hit(placed, t) {
  for (const p of placed) if (collides(p, t)) return p;
  return null;
}

/**
 * Every tile slid up into the free rows above it, in reading order: each rises until a tile already placed
 * stops it, and one that overlaps a tile placed before it goes under that tile. lead, a tile's id, goes first
 * among tiles of the same top (the one a reader just moved). Returned in reading order.
 * @template {Tile} T @param {readonly T[]} tiles @param {string} [lead] @returns {T[]}
 */
export function compact(tiles, lead) {
  const order = tiles.map((t) => ({ ...t })).sort((a, b) => a.y - b.y || (a.id === lead ? -1 : b.id === lead ? 1 : 0) || byTop(a, b));
  /** @type {T[]} */
  const placed = [];
  for (const t of order) {
    // Up to the lowest bottom of the placed tiles above it in its columns (a tile cannot pass one), or row 0.
    let top = 0;
    for (const p of placed) if (p.x < t.x + t.w && t.x < p.x + p.w && p.y + p.h <= t.y) top = Math.max(top, p.y + p.h);
    t.y = top;
    for (let p = hit(placed, t); p; p = hit(placed, t)) t.y = p.y + p.h;
    placed.push(t);
  }
  return placed.sort(byTop);
}

/** Each tile clamped, then the whole compacted: what any layout read or posted becomes. @template {Tile} T @param {readonly T[]} tiles @returns {T[]} */
export function normalize(tiles) {
  return compact(tiles.map(clamp));
}

/**
 * The moved tile m at its new place among the others, before the layout is compacted. Which tiles it passes
 * is decided once, from where it was dropped, by the rule at the head of the file: it goes under the lowest
 * of the tiles it passes, and every tile it then meets goes under it. (Deciding again from its new place
 * would carry a tall tile past every tile below the one it was dropped on.)
 * @param {Tile[]} list @param {Tile} m @param {boolean} down
 */
function settle(list, m, down) {
  const edge = down ? 2 * (m.y + m.h) : 2 * m.y;
  let y = m.y;
  for (const t of list) if (t !== m && collides(t, m) && edge > 2 * t.y + t.h) y = Math.max(y, t.y + t.h);
  m.y = y;
  pushUnder(list, m);
}

/**
 * Push a tile down to y, and every tile it then meets under it in turn; the held tile (the one a reader moved
 * or resized) stays where it is.
 * @param {Tile[]} list @param {Tile} t @param {number} y @param {Tile} held
 */
function pushOthers(list, t, y, held) {
  t.y = Math.max(t.y, y);
  for (const o of list) {
    if (o !== t && o !== held && collides(o, t)) pushOthers(list, o, t.y + t.h, held);
  }
}

/**
 * Every tile the held tile m meets pushed under it, the lowest first, so a tile pushed into the one below it
 * pushes that one on, and tiles pushed together keep their order.
 * @param {Tile[]} list @param {Tile} m
 */
function pushUnder(list, m) {
  for (const t of list.filter((o) => o !== m).sort(byTop).reverse()) if (collides(t, m)) pushOthers(list, t, m.y + m.h, m);
}

/**
 * The layout with one tile moved to column x and row y (each held to the grid), the tiles it meets pushed
 * down or passed, and everything compacted. An unknown id changes nothing but the compaction.
 * @template {Tile} T @param {readonly T[]} tiles @param {string} id @param {number} x @param {number} y @returns {T[]}
 */
export function move(tiles, id, x, y) {
  const list = tiles.map((t) => clamp({ ...t }));
  const m = list.find((t) => t.id === id);
  if (!m) return compact(list);
  const from = m.y;
  Object.assign(m, clamp({ ...m, x, y }));
  settle(list, m, m.y > from);
  return compact(list, id);
}

/**
 * The layout with one tile at width w and height h (each held to the grid and the kind's least; it keeps its
 * column unless the new width would pass the right edge), the tiles it then meets pushed under it, and
 * everything compacted.
 * @template {Tile} T @param {readonly T[]} tiles @param {string} id @param {number} w @param {number} h @returns {T[]}
 */
export function resize(tiles, id, w, h) {
  const list = tiles.map((t) => clamp({ ...t }));
  const m = list.find((t) => t.id === id);
  if (!m) return compact(list);
  const lw = least(m.kind).w;
  const nw = bound(w, lw, W_MAX, m.w);
  Object.assign(m, clamp({ ...m, w: nw, h, x: Math.min(m.x, COLS - nw) }));
  pushUnder(list, m);
  return compact(list, id);
}

/** Whether two layouts put every tile at the same place and size. @param {readonly Tile[]} a @param {readonly Tile[]} b */
export function same(a, b) {
  if (a.length !== b.length) return false;
  const at = new Map(a.map((t) => [t.id, t]));
  return b.every((t) => {
    const o = at.get(t.id);
    return !!o && o.x === t.x && o.y === t.y && o.w === t.w && o.h === t.h;
  });
}

/** @typedef {"left" | "right" | "up" | "down" | "wider" | "narrower" | "taller" | "shorter"} Step */
export const STEPS = /** @type {const} */ (["left", "right", "up", "down", "wider", "narrower", "taller", "shorter"]);

/**
 * One step of a tile, as a keyboard's arrow or the tile's menu asks for it: a column left or right; up or down
 * to the next place where the layout changes (one row is often not enough to pass the tile above or below);
 * a column wider or narrower; a row taller or shorter. A step that changes nothing gives the layout back as
 * it is, compacted.
 * @template {Tile} T @param {readonly T[]} tiles @param {string} id @param {Step} step @returns {T[]}
 */
export function stepTile(tiles, id, step) {
  const now = normalize(tiles);
  const m = now.find((t) => t.id === id);
  if (!m) return now;
  switch (step) {
    case "left":
      return move(now, id, m.x - 1, m.y);
    case "right":
      return move(now, id, m.x + 1, m.y);
    case "wider":
      return resize(now, id, m.w + 1, m.h);
    case "narrower":
      return resize(now, id, m.w - 1, m.h);
    case "taller":
      return resize(now, id, m.w, m.h + 1);
    case "shorter":
      return resize(now, id, m.w, m.h - 1);
    case "up":
    case "down": {
      const bottom = now.reduce((n, t) => Math.max(n, t.y + t.h), 0);
      const dir = step === "up" ? -1 : 1;
      for (let y = m.y + dir; y >= 0 && y <= bottom; y += dir) {
        const next = move(now, id, m.x, y);
        if (!same(next, now)) return next;
      }
      return now;
    }
  }
  return now;
}

/** Which steps would change the layout, for the menu to offer. @param {readonly Tile[]} tiles @param {string} id @returns {Record<Step, boolean>} */
export function steps(tiles, id) {
  const now = normalize(tiles);
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const s of STEPS) out[s] = !same(stepTile(now, id, s), now);
  return /** @type {Record<Step, boolean>} */ (out);
}

/**
 * The panels of the earlier dashboard, in their order and widths, as tiles: a full-width panel takes the whole
 * row, half-width ones go two to a row, left then right, as the page drew them from 1,280 px, each at its
 * kind's starting height; then compacted.
 * @param {readonly { id: string, kind: string, wide: boolean }[]} panels @returns {Tile[]}
 */
export function fromPanels(panels) {
  /** @type {Tile[]} */
  const out = [];
  let slot = 0;
  let col = 0;
  for (const p of panels) {
    if (p.wide && col > 0) {
      slot += 1;
      col = 0;
    }
    const size = startSize(p.kind, p.wide);
    out.push({ id: p.id, kind: p.kind, x: col, y: slot * H_MAX, w: size.w, h: size.h });
    col += size.w;
    if (col >= COLS) {
      slot += 1;
      col = 0;
    }
  }
  return normalize(out);
}

/**
 * A new tile of this kind and size placed under the others at the left, then compacted: where an added tile
 * goes.
 * @template {Tile} T @param {readonly T[]} tiles @param {T} t @returns {T[]}
 */
export function place(tiles, t) {
  const bottom = tiles.reduce((n, o) => Math.max(n, o.y + o.h), 0);
  return compact([...tiles.map((o) => ({ ...o })), clamp({ ...t, x: 0, y: bottom })]);
}

/** Whether a tile takes both columns of the two-column page (below 1,100 px). @param {Tile} t */
export const takesBoth = (t) => t.w >= BOTH_FROM;
