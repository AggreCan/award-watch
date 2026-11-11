/* Sorting a table by its head.

   Each table of the column system (src/columns.tsx) says on its markup who
   orders it (data-sorting). "client": the whole list is on the page, each
   head is a button, and this script orders the rows here: ascending, then
   descending, then back to the order the page came in. "server": the list
   runs past this page, so a head the server can order by is a link it
   writes to the same view in the next order, and the other heads are plain
   labels; the script only gives those links their hint.

   A cell reads by its column (the k-* class of its head, data-kind="date"
   on a head outside the column system, or .num on the head or on the
   cells): a figure (money, a short tile amount, a count, a
   share, a percentage, as English or French prints them), a date as the
   site prints it (2026-10-31, a year, a fiscal year, a time after the
   date), or text in the page's language, accents folded. A cell's
   data-sort, written by the server where the text would read badly, comes
   first. A cell reads up to its first line break, so a figure with a note
   under it sorts by the figure. An empty cell, or one with no figure or
   date to read, goes last whichever way.

   Rows keep the order they came in (one list per table body), so the third
   click puts back exactly that order; a body another script redraws (the
   watchlist) starts again from its new order. After a sort the table sends
   "aw:sorted", and pager.js folds or pages the rows again in their new
   order.

   The words come from the page's JSON block (id "sort-i18n"). The functions
   are exported for test/sort.test.ts and for the server's head links
   (src/columns.tsx); the part that touches the page runs only in a browser. */

/** @typedef {"num" | "share" | "date" | "text"} SortKind */
/** @typedef {number | string | null} SortKey */

/**
 * The first figure in a text, as the language writes it: "$13,044,299",
 * "13 044 299 $", "$4.5M", "4,5 M$", "25%", "<1%", "< 1 %", "-10%". A
 * figure under one ("<1%") reads as half of it, between zero and one.
 * @param {string} text
 * @param {"en" | "fr"} lang
 * @returns {number | null}
 */
function figure(text, lang) {
  const re = lang === "fr"
    ? /(<\s*)?(\d{1,3}(?:[   ]\d{3})+|\d+)(?:,(\d+))?/
    : /(<\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/;
  const m = re.exec(text);
  if (!m) return null;
  let n = Number(m[2].replace(/\D/g, "") + (m[3] ? `.${m[3]}` : ""));
  if (m[1]) n /= 2;
  const scale = /^\s*([MBG])/.exec(text.slice(m.index + m[0].length));
  if (scale) n *= scale[1] === "M" ? 1e6 : 1e9;
  if (/[-−]\s*\$?\s*$/.test(text.slice(0, m.index))) n = -n;
  return n;
}

// A date and an optional time ("14:00", "14 h 00"); a fiscal year reads as its first year and the rest.
const DATE = /(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ]+(\d{1,2})(?::|\s*h\s*)(\d{2}))?/;

/**
 * A cell's sort key: a number for a figure, a string for a date or text,
 * null for an empty cell or one with nothing of its kind to read.
 * @param {string | null | undefined} text
 * @param {SortKind} kind
 * @param {"en" | "fr"} lang
 * @returns {SortKey}
 */
export function sortKey(text, kind, lang) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (kind === "num") return figure(s, lang);
  if (kind === "share") {
    // "3 of 60 (5%)": the share is the percentage in brackets.
    const pct = /\(([^()]*%)\s*\)/.exec(s);
    return figure(pct ? pct[1] : s, lang);
  }
  if (kind === "date") {
    const m = DATE.exec(s);
    if (!m) return null;
    return m[1] + (m[2] ? `-${m[2]}` : "") + (m[3] ? `-${m[3]}` : "") + (m[4] ? ` ${m[4].padStart(2, "0")}:${m[5]}` : "");
  }
  return s;
}

/**
 * The rows' new order, as indices into keys: ascending or descending, ties
 * in the order they came, and the empty keys last in either direction.
 * @param {readonly SortKey[]} keys
 * @param {"asc" | "desc"} dir
 * @param {SortKind} kind
 * @param {"en" | "fr"} lang
 * @returns {number[]}
 */
export function sortOrder(keys, dir, kind, lang) {
  const text = new Intl.Collator(lang === "fr" ? "fr-CA" : "en-CA", { numeric: true, sensitivity: "base" });
  const sign = dir === "desc" ? -1 : 1;
  /** @param {SortKey} a @param {SortKey} b */
  const compare = (a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    if (kind === "text") return text.compare(String(a), String(b));
    return a === b ? 0 : String(a) < String(b) ? -1 : 1;
  };
  const filled = [];
  const empty = [];
  keys.forEach((k, i) => (k === null ? empty : filled).push(i));
  filled.sort((i, j) => sign * compare(keys[i], keys[j]) || i - j);
  return filled.concat(empty);
}

/**
 * A head's place in a server-ordered list: its order now and the order a
 * click asks for next. orders lists each order's value in the address, the
 * column it sorts and its direction; none is the value of the list's own
 * order, which no head shows as its state.
 * @param {readonly (readonly [string, string, "asc" | "desc"])[]} orders
 * @param {string} current
 * @param {string} column
 * @param {string} [none]
 * @returns {{ state: "ascending" | "descending" | null, next: string }}
 */
export function headOrder(orders, current, column, none = "") {
  const now = orders.find((o) => o[0] === current && o[1] === column);
  const want = !now ? "asc" : now[2] === "asc" ? "desc" : null;
  const next = want ? orders.find((o) => o[1] === column && o[2] === want) : undefined;
  return { state: now ? (now[2] === "asc" ? "ascending" : "descending") : null, next: next ? next[0] : none };
}

// -- the page ----------------------------------------------------------------------

/** @param {Element} th @param {HTMLTableElement} table @returns {SortKind} */
function kindOf(th, table) {
  const c = th.classList;
  if (c.contains("k-date") || c.contains("k-datetime") || th.getAttribute("data-kind") === "date") return "date";
  // A part of a count ("3 (25%)") sorts by its percentage, as a share does.
  if (c.contains("k-share") || c.contains("k-part")) return "share";
  if (c.contains("num")) return "num";
  // A figure under a head of another kind (an average in the main column): its cells say so.
  const col = /** @type {HTMLTableCellElement} */ (th).cellIndex;
  for (const body of table.tBodies) for (const tr of body.rows) if (tr.cells[col]) return tr.cells[col].classList.contains("num") ? "num" : "text";
  return "text";
}

/** @param {HTMLTableCellElement | undefined} td */
function cellText(td) {
  if (!td) return "";
  const own = td.getAttribute("data-sort");
  if (own !== null) return own;
  let s = "";
  for (const n of td.childNodes) {
    if (n.nodeName === "BR") break;
    s += n.textContent;
  }
  return s;
}

if (typeof document !== "undefined") {
  /** @type {{ by?: string[], done?: string[], asc?: string, desc?: string, none?: string }} */
  let words = {};
  try {
    words = JSON.parse(document.getElementById("sort-i18n")?.textContent || "{}") || {};
  } catch (e) {
    words = {};
  }
  const lang = document.documentElement.lang === "fr" ? "fr" : "en";
  // A template travels as pieces, its text and its slots' names in turn (as public/refresh.js has them).
  /** @param {unknown} pieces @param {Record<string, string>} vars */
  const fill = (pieces, vars) => (Array.isArray(pieces) ? pieces.map((p, i) => (i % 2 ? vars[p] ?? "" : p)).join("") : "");
  /** @param {EventTarget | null} target */
  const control = (target) => (target instanceof Element ? target.closest(".th-sort") : null);
  /** @param {Element | null} el */
  const hint = (el) => {
    if (el && !el.getAttribute("title") && words.by) el.setAttribute("title", fill(words.by, { column: (el.textContent || "").trim() }));
  };
  document.querySelectorAll(".th-sort").forEach(hint);
  // A head drawn after load (the tender list) gets its hint when it is reached.
  document.addEventListener("focusin", (e) => hint(control(e.target)));
  document.addEventListener("mouseover", (e) => hint(control(e.target)));

  /** @type {HTMLElement | null} */
  let status = null;
  /** @param {string} text */
  const say = (text) => {
    if (!status) {
      status = document.createElement("p");
      status.className = "visually-hidden";
      status.setAttribute("aria-live", "polite");
      document.body.appendChild(status);
    }
    status.textContent = text;
  };

  /** @type {WeakMap<HTMLTableSectionElement, HTMLTableRowElement[]>} */
  const first = new WeakMap();

  /** @param {HTMLTableElement} table @param {HTMLTableCellElement} th */
  const sort = (table, th) => {
    const heads = /** @type {HTMLTableRowElement} */ (th.parentElement).cells;
    const was = th.getAttribute("aria-sort");
    const next = was === "ascending" ? "descending" : was === "descending" ? null : "ascending";
    for (const h of heads) h.removeAttribute("aria-sort");
    if (next) th.setAttribute("aria-sort", next);
    const kind = kindOf(th, table);
    const col = th.cellIndex;
    // A group's head or a total spans the row and keeps its place.
    /** @param {HTMLTableRowElement} tr */
    const moves = (tr) => tr.cells.length === heads.length && !tr.querySelector(":scope > th, :scope > td[colspan]");
    for (const body of table.tBodies) {
      const rows = Array.from(body.rows).filter(moves);
      let came = first.get(body);
      const known = new Set(came);
      if (!came || came.length !== rows.length || rows.some((tr) => !known.has(tr))) {
        came = rows;
        first.set(body, rows);
      }
      const from = /** @type {HTMLTableRowElement[]} */ (came);
      const order = next
        ? sortOrder(from.map((tr) => sortKey(cellText(tr.cells[col]), kind, lang)), next === "ascending" ? "asc" : "desc", kind, lang).map((i) => from[i])
        : from;
      let k = 0;
      for (const tr of Array.from(body.rows).map((tr) => (moves(tr) ? order[k++] : tr))) body.appendChild(tr);
    }
    table.dispatchEvent(new CustomEvent("aw:sorted", { bubbles: true }));
    const state = next === "ascending" ? words.asc : next === "descending" ? words.desc : words.none;
    say(fill(words.done, { column: (th.textContent || "").trim(), state: state || "" }));
  };

  document.addEventListener("click", (e) => {
    const button = control(e.target);
    const th = button && button.tagName === "BUTTON" ? button.closest("th") : null;
    const table = th ? th.closest("table") : null;
    if (th && table && table.getAttribute("data-sorting") === "client") sort(table, th);
  });
}
