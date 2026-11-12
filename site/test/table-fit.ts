// Whether each table a page draws fits the column the stylesheet gives it,
// at every window width from 700 px up (below that, tables restack into
// labelled blocks and compact ones drop their least width). The figures come
// from public/styles.css: the
// rail's width and the window from which it stands beside the content, the
// page's padding, a panel's border, the measure of a document, the panel
// grid's tracks, and the window ranges in which columns rest. The one figure
// the stylesheet cannot give is the window's scrollbar, 15 px on Windows.
import { env } from "cloudflare:test";
import { expect } from "vitest";

const styles: string = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;

const px = (re: RegExp, what: string): number => {
  const m = styles.match(re);
  if (!m) throw new Error(`the stylesheet no longer says ${what}`);
  return Number(m[1]);
};

export const SCROLLBAR = 15;

// The figures, each read from the rule that sets it.
export const SHEET = {
  rail: px(/^\s*--rail: (\d+)px;/m, "the rail's width"),
  gutter: px(/^\s*--gutter: (\d+)px;/m, "the gutter"),
  measure: px(/^\s*--measure: (\d+)px;/m, "a document's measure"),
  // The window from which the rail is a column beside the content.
  railFrom: px(/@media \(min-width: (\d+)px\) \{\n(?:[^\n]*\n){0,4}?\s*\.frame \{ display: grid; grid-template-columns: var\(--rail\)/, "where the rail becomes a column"),
  panelBorder: px(/^\.panel \{[^}]*border: (\d+)px solid/m, "a panel's border"),
  docBorder: px(/^\.doc \{[^}]*border: (\d+)px solid/m, "a document's border"),
  docPad: px(/^\.doc \{[^}]*padding: 0 (\d+)px/m, "a document's padding"),
  // A table's wrapper in a document reaches this far into its padding.
  docWrapOut: px(/^\.doc \.table-wrap \{ margin: 0 -(\d+)px/m, "how far a document's table reaches"),
  // The panel grid: its tracks from this window, each at least this wide.
  gridFrom: px(/@media \(min-width: (\d+)px\) \{\n\s*\.panel-grid \{ grid-template-columns: repeat\(auto-fit/, "where the panel grid takes tracks"),
  gridTrack: px(/\.panel-grid \{ grid-template-columns: repeat\(auto-fit, minmax\(max\((\d+)px/, "the panel grid's least track"),
  // Three panels side by side from this window when the grid holds three.
  threeFrom: px(/@media \(min-width: (\d+)px\) \{\n\s*\.panel-grid:has\(> :nth-child\(3\):last-child\) \{ grid-template-columns: repeat\(3/, "where three panels share a row"),
  // A document's contents beside it from this window, in a column this wide.
  tocFrom: px(/@media \(min-width: (\d+)px\) \{\n\s*\.doc-layout \{ grid-template-columns: \d+px minmax/, "where a document's contents stand beside it"),
  toc: px(/\.doc-layout \{ grid-template-columns: (\d+)px minmax\(0, var\(--measure\)\); \}/, "the contents column"),
  // The home map's list stands beside the map from this window.
  cmapFrom: px(/@media \(min-width: (\d+)px\) \{ \.cmap \{ grid-template-columns: minmax\(0, 1fr\) minmax\(var\(--cmap-list-min/, "where the map's list stands beside it"),
  // A block inside a panel that is not a table's wrapper keeps this margin.
  panelInset: px(/^\.panel > :not\([^)]*\) \{ margin: (\d+)px; \}/m, "the margin of a block inside a panel"),
  // The dashboard's two tracks from this window, a half-width panel taking one (src/account/dashboard.tsx).
  dashFrom: px(/@media \(min-width: (\d+)px\) \{\n\s*\.dash-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/, "where the dashboard takes two tracks"),
};

// The blocks that run to a panel's edges rather than keep its inset: the
// ones the inset rule leaves out, and any the stylesheet sets to no margin.
const EDGE_TO_EDGE: string[] = (() => {
  const m = styles.match(/^\.panel > :not\(([^)]*)\) \{ margin: \d+px; \}/m);
  const listed = (m?.[1] ?? "").split(",").map((s) => s.trim());
  const zero = [...styles.matchAll(/^\.panel > (\.[a-z-]+) \{ margin: 0; \}/gm)].map((x) => x[1]);
  return [...listed, ...zero];
})();

const edgeToEdge = (e: El): boolean =>
  EDGE_TO_EDGE.some((sel) => (sel.startsWith(".") ? e.cls.includes(sel.slice(1)) : e.tag === sel));

export type Range = "md" | "lg" | "xl" | "xxl" | "all";

// The ranges in which columns rest, from the stylesheet's queries: the
// class each one hides and the windows it covers.
function ranges(): { range: Range; from: number }[] {
  const at = (cls: string) => px(new RegExp(`@media \\(min-width: (\\d+)px\\) and \\(max-width: \\d+px\\) \\{\\n\\s*\\.${cls} \\{ display: none; \\}`), `where .${cls} rests`);
  const to = (cls: string) => px(new RegExp(`@media \\(min-width: \\d+px\\) and \\(max-width: (\\d+)px\\) \\{\\n\\s*\\.${cls} \\{ display: none; \\}`), `where .${cls} shows again`);
  const restackBelow = at("mdh");
  // Each range starts where the next narrower class shows again.
  return [
    { range: "md", from: restackBelow },
    { range: "lg", from: to("mdh") + 1 },
    { range: "xl", from: to("lgh") + 1 },
    { range: "xxl", from: to("xlh") + 1 },
    { range: "all", from: to("xxh") + 1 },
  ];
}
export const RANGES = ranges();

export function rangeOf(w: number): Range {
  let r: Range = "md";
  for (const x of RANGES) if (w >= x.from) r = x.range;
  return r;
}

// The content column: the window less the scrollbar, the rail from where it
// stands beside the content, and the page's padding on both sides.
export function mainWidth(w: number): number {
  return w - SCROLLBAR - 2 * SHEET.gutter - (w >= SHEET.railFrom ? SHEET.rail : 0);
}

// The windows to check: the low edge of each range, and every window inside
// a range where the column a table gets narrows (the rail appearing, the
// panel grid splitting into tracks, three panels sharing a row, a
// document's contents moving beside it, the map's list beside the map).
// Between two of these the column only grows with the window.
export function edges(): number[] {
  // The first window at which the grid holds two tracks of its least width.
  let split = SHEET.gridFrom;
  while (mainWidth(split) < 2 * SHEET.gridTrack + SHEET.gutter) split += 1;
  const all = [...RANGES.map((r) => r.from), SHEET.railFrom, SHEET.gridFrom, split, SHEET.threeFrom, SHEET.tocFrom, SHEET.cmapFrom, SHEET.dashFrom];
  return [...new Set(all)].sort((a, b) => a - b);
}

// -- a page's elements -----------------------------------------------------------

export type El = { tag: string; cls: string[]; style: string; children: El[]; parent: El | null; text?: string };

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

// The page's elements as a tree: enough of HTML for the site's own markup,
// which hono/jsx writes with every attribute quoted. A script's or a
// style's text is skipped whole.
export function parse(html: string): El {
  const root: El = { tag: "#root", cls: [], style: "", children: [], parent: null };
  let at: El = root;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      // Close up to the matching element; a stray closing tag closes nothing.
      let n: El | null = at;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) at = n.parent;
      continue;
    }
    const attrs = m[3];
    const el: El = {
      tag, cls: (attrs.match(/\sclass="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean),
      style: attrs.match(/\sstyle="([^"]*)"/)?.[1] ?? "", children: [], parent: at,
    };
    at.children.push(el);
    if (tag === "script" || tag === "style") {
      const end = html.indexOf(`</${tag}>`, re.lastIndex);
      re.lastIndex = end < 0 ? html.length : end + tag.length + 3;
      continue;
    }
    // A heading keeps its text, so a test can name a panel.
    if (tag === "h2") el.text = html.slice(re.lastIndex, html.indexOf("</h2>", re.lastIndex)).replace(/<[^>]*>/g, "");
    if (!VOID.has(tag) && !/\/\s*$/.test(attrs)) at = el;
  }
  return root;
}

export function find(root: El, pred: (e: El) => boolean): El[] {
  const out: El[] = [];
  const walk = (e: El) => {
    if (pred(e)) out.push(e);
    e.children.forEach(walk);
  };
  walk(root);
  return out;
}

const has = (e: El, c: string) => e.cls.includes(c);

// A table's least width in each range, as the page writes it on the table.
export function leastWidths(table: El): Record<Range, number> {
  const v = (name: string) => {
    const m = table.style.match(new RegExp(`--tmin${name}:(\\d+)px`));
    return m ? Number(m[1]) : NaN;
  };
  const all = v("");
  return { all, xxl: Number.isNaN(v("-xxl")) ? all : v("-xxl"), xl: v("-xl"), lg: v("-lg"), md: v("-md") };
}

// The width a box inside the content column gets at window w: the content
// column, narrowed by the grid or document it stands in.
function boxWidth(box: El, w: number): number {
  const main = mainWidth(w);
  const parent = box.parent;
  // A panel in a stack is a cell of the grid the stack stands in.
  const cell = parent && has(parent, "panel-stack") ? parent : box;
  const grid = cell.parent;
  if (grid && has(grid, "panel-grid")) {
    const n = grid.children.length;
    const i = grid.children.indexOf(cell);
    if (w < SHEET.gridFrom) return main;
    if (has(grid, "thirds")) return (main - 2 * SHEET.gutter) / 3;
    if (n === 3 && w >= SHEET.threeFrom) return (main - 2 * SHEET.gutter) / 3;
    const half = (main - SHEET.gutter) / 2;
    // Two tracks only once each is its least width; an odd last panel takes the row.
    if (half < SHEET.gridTrack || n === 1) return main;
    if (i === n - 1 && n % 2 === 1) return main;
    return half;
  }
  // A half-width panel of the dashboard takes one of its two tracks from dashFrom; every other panel there takes the row.
  if (grid && has(grid, "dash-grid") && has(cell, "dash-half") && w >= SHEET.dashFrom) return (main - SHEET.gutter) / 2;
  if (has(box, "doc")) {
    const layout = box.parent;
    const toc = layout && has(layout, "doc-layout") && !has(layout, "doc-alone") && w >= SHEET.tocFrom ? SHEET.toc + SHEET.gutter : 0;
    return Math.min(SHEET.measure, main - toc);
  }
  return main;
}

// The column a table gets at window w. The tender list beside its detail
// panel (from 1200 px, with the script) may be narrower than its least width
// on purpose (styles.css: it "never scrolls", the notice takes what is
// left); without the script it is a full-width list, and is checked as one.
export function tableColumn(table: El, w: number): number {
  let box: El | null = table.parent;
  const path: El[] = [];
  while (box && !has(box, "panel") && !has(box, "doc") && box.tag !== "main") {
    path.push(box);
    box = box.parent;
  }
  if (!box || box.tag === "main") throw new Error(`a table outside a panel or a document: ${tableName(table)}`);
  let width = has(box, "doc")
    ? boxWidth(box, w) - 2 * SHEET.docBorder - 2 * SHEET.docPad + 2 * SHEET.docWrapOut
    : boxWidth(box, w) - 2 * SHEET.panelBorder;
  // The block the table's wrapper sits in, directly inside the panel: a
  // table's own wrapper, a list's results and the year box run edge to edge,
  // anything else keeps the panel's inset. (In a document a table's wrapper
  // runs to the document's edges wherever it sits.)
  const top = path[path.length - 1];
  if (has(box, "panel") && top && !edgeToEdge(top)) width -= 2 * SHEET.panelInset;
  // The home map's list: from where it stands beside the map, at least as wide as its table by the server's own figure.
  const list = path.find((e) => has(e, "cmap"));
  if (list && w >= SHEET.cmapFrom) {
    // Its track is at least that figure and the map's may shrink to nothing, so the list has up to the whole row less the gap.
    const min = Number(list.style.match(/--cmap-list-min:(\d+)px/)?.[1] ?? NaN);
    width = Math.min(width - SHEET.gutter, Math.max(min, (width - SHEET.gutter) / 2));
  }
  return width;
}

export function tableName(table: El): string {
  const chain: string[] = [];
  for (let e: El | null = table; e && e.tag !== "#root"; e = e.parent) {
    chain.push(e.cls.length ? `${e.tag}.${e.cls.join(".")}` : e.tag);
    if (e.tag === "main") break;
  }
  const heads = find(table, (e) => e.tag === "th" && e.cls.some((c) => c.startsWith("k-")));
  return `${chain.reverse().join(" > ")} [${heads.map((h) => h.cls.filter((c) => c.startsWith("k-") || /^(mdh|lgh|xlh|xxh)$/.test(c)).join(" ")).join(", ")}]`;
}

// The heading of the panel a table sits in, as the page writes it.
export function panelTitle(table: El): string {
  let e: El | null = table.parent;
  while (e && !has(e, "panel")) e = e.parent;
  const head = e ? find(e, (x) => x.tag === "h2")[0] : undefined;
  return head?.text ?? "";
}

export type Misfit = { table: string; window: number; range: Range; least: number; column: number };

// Every table on the column system in a page, at every edge: its least
// width for the range against the column it gets there. skip leaves out the
// tables a test names (by their panel's heading).
export function misfits(html: string, skip: (table: El) => boolean = () => false): Misfit[] {
  const root = parse(html);
  const out: Misfit[] = [];
  for (const table of find(root, (e) => e.tag === "table" && e.cls.includes("cols") && !skip(e))) {
    const least = leastWidths(table);
    for (const w of edges()) {
      const range = rangeOf(w);
      const column = tableColumn(table, w);
      if (least[range] > column) out.push({ table: tableName(table), window: w, range, least: least[range], column: Math.floor(column * 10) / 10 });
    }
  }
  return out;
}

export function tablesIn(html: string): El[] {
  return find(parse(html), (e) => e.tag === "table" && e.cls.includes("cols"));
}

// For a test that renders its own pages: each draws at least one table, and
// every table fits its column at every edge.
export function expectTablesFit(html: string, label: string): void {
  expect(tablesIn(html).length, `${label}: no table`).toBeGreaterThan(0);
  expect(misfits(html), label).toEqual([]);
}
