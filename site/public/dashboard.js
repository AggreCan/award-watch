/* The dashboard's script (src/account/dashboard.tsx; docs/accounts.md,
   Dashboard): arranging the tiles in the page, saving what was arranged, and
   keeping each tile's list to what its height holds. Loaded on that page
   only. Every rule of the grid is public/dash-grid.js's, the Worker's own
   copy, so what the page shows while a tile moves is what the Worker keeps;
   the code here only reads the page, asks the grid, and writes places back.

   From 1,100 px, where the page is the grid itself: a tile's grip moves it
   and its corner sizes it, with a pointer (Pointer Events, the pointer
   captured, touch-action none on the two handles only) or with the keys
   (Enter or Space picks it up, the arrows move or size it a step, Enter
   drops it, Escape puts it back); while a tile moves, the place it will
   land is marked and the other tiles move to where they would go. Below
   1,100 px the page is a column or two in reading order and the handles
   rest; the tile's menu works at any width. A menu's step is done here
   rather than posted, so it joins Undo.

   Each change is saved by itself (DELAY_MS after the last), the status line
   saying so; a save that fails says so and offers to try again, but a save
   of a dashboard deleted meanwhile says it no longer exists, with a link to
   the account's dashboards, and nothing is saved again (goneOf). Undo (the
   status line's link, and Ctrl+Z or Cmd+Z outside a field) goes back a
   change, the last UNDO_MAX of the visit. A tile resized is read again at
   its new size (the Worker's fragment, from this site only, parsed and its
   body and foot put in place of the tile's) and nothing else reloads.
   While the account cannot keep places and sizes the page arranges and says
   so, and posts nothing. prefers-reduced-motion turns the sliding off. */
import { COLS, GAP_PX, ROW_PX, move, resize, same, stack, stepTile, steps, takesBoth } from "./dash-grid.js";

export const DELAY_MS = 600;
export const UNDO_MAX = 20;
const SLIDE_MS = 160;
// How close to the window's top or bottom a dragged tile scrolls the page, and by how much a move.
const EDGE_PX = 48;
const SCROLL_PX = 16;

/** @typedef {import("./dash-grid.js").Tile} Tile */
/** @typedef {import("./dash-grid.js").Step} Step */

/** A template's pieces filled: text and the slots' names in turn (src/layout.tsx scriptJson, public/refresh.js templatePieces). @param {unknown} pieces @param {Record<string, string | number>} vars */
export function fill(pieces, vars) {
  return Array.isArray(pieces) ? pieces.map((p, i) => (i % 2 ? (p in vars ? String(vars[p]) : "") : p)).join("") : "";
}

/** A layout as the Worker takes it: the id, the place and the size of each tile. @param {readonly Tile[]} tiles */
export function layoutJson(tiles) {
  return JSON.stringify(tiles.map((t) => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h })));
}

/**
 * What a save's answer says when its dashboard no longer exists (the layout post's 404 with state gone, a dashboard
 * deleted in another tab): the line, the link's words and the address of the account's dashboards, as the Worker
 * wrote them in the reader's language; null for any other answer, which the status line meets with Try again.
 * @param {number} status @param {any} answer @returns {{ line: string, link: string, href: string } | null}
 */
export function goneOf(status, answer) {
  if (status !== 404 || !answer || typeof answer !== "object" || answer.state !== "gone") return null;
  const href = typeof answer.href === "string" && /^\/account\/dashboard(\?lang=fr)?$/.test(answer.href) ? answer.href : "/account/dashboard";
  return { line: typeof answer.line === "string" ? answer.line : "", link: typeof answer.link === "string" ? answer.link : "", href };
}

/** The arrow keys' steps, for the grip and for the corner. */
export const KEY_STEPS = {
  grip: { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" },
  corner: { ArrowLeft: "narrower", ArrowRight: "wider", ArrowUp: "shorter", ArrowDown: "taller" },
};

if (typeof document !== "undefined") start();

function start() {
  const grid = document.getElementById("dash-grid");
  /** @type {{ csrf?: string, save?: boolean, cols?: number, layout?: string, tiles?: string, words?: Record<string, any> }} */
  let data = {};
  try {
    data = JSON.parse(document.getElementById("dash-data")?.textContent || "{}") || {};
  } catch {
    data = {};
  }
  if (!grid || !data.csrf) return;
  const words = data.words || {};
  const lang = document.documentElement.lang === "fr" ? "fr" : "en";
  let format = null;
  try {
    format = new Intl.NumberFormat(lang === "fr" ? "fr-CA" : "en-CA");
  } catch {
    format = null;
  }
  /** @param {number} n */
  const num = (n) => (format ? format.format(n) : String(n));
  const wide = window.matchMedia("(min-width: 1100px)");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)");
  const status = document.getElementById("dash-status");
  const say = document.getElementById("dash-say");
  const marker = document.createElement("div");
  marker.className = "dash-marker";
  marker.setAttribute("aria-hidden", "true");
  grid.appendChild(marker);
  grid.classList.add("dash-live");

  // -- the layout in the page ---------------------------------------------------------------

  /** @returns {HTMLElement[]} */
  const tileEls = () => Array.from(grid.querySelectorAll(":scope > .dash-tile"));
  /** @param {string} id */
  const tileEl = (id) => /** @type {HTMLElement | null} */ (tileEls().find((el) => el.dataset.id === id) ?? null);
  /** @param {HTMLElement} el @returns {Tile} */
  const tileOf = (el) => ({
    id: el.dataset.id || "", kind: el.dataset.key || "", x: Number(el.dataset.x), y: Number(el.dataset.y), w: Number(el.dataset.w), h: Number(el.dataset.h),
  });
  /** @type {Tile[]} */
  let layout = tileEls().map(tileOf);
  /** @param {HTMLElement} el */
  const titleOf = (el) => el.dataset.title || "";

  /** @param {HTMLElement} el @param {Tile} t */
  function place(el, t) {
    el.dataset.x = String(t.x);
    el.dataset.y = String(t.y);
    el.dataset.w = String(t.w);
    el.dataset.h = String(t.h);
    el.style.setProperty("--gc", String(t.x + 1));
    el.style.setProperty("--gr", String(t.y + 1));
    el.style.setProperty("--gw", String(t.w));
    el.style.setProperty("--gh", String(t.h));
    el.classList.toggle("dash-both", takesBoth(t));
  }

  /** The tiles at a layout; the others slide there unless motion is reduced. skip: a tile left where it is (the one dragged). @param {readonly Tile[]} next @param {string} [skip] */
  function show(next, skip) {
    const slide = wide.matches && !still.matches;
    const before = new Map();
    if (slide) for (const el of tileEls()) if (el.dataset.id !== skip) before.set(el, el.getBoundingClientRect());
    for (const t of next) {
      const el = tileEl(t.id);
      if (el && t.id !== skip) place(el, t);
    }
    if (!slide) return;
    for (const [el, was] of before) {
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if ((dx || dy) && typeof el.animate === "function") {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: "ease-out" });
      }
    }
  }

  /** The marker where a tile will land, or none. @param {Tile | null} t */
  function mark(t) {
    marker.classList.toggle("is-on", !!t);
    if (!t) return;
    marker.style.setProperty("--gc", String(t.x + 1));
    marker.style.setProperty("--gr", String(t.y + 1));
    marker.style.setProperty("--gw", String(t.w));
    marker.style.setProperty("--gh", String(t.h));
  }

  /** The tiles in reading order in the page too, for the keys, a screen reader and the narrow page; focus kept. */
  function order() {
    const active = document.activeElement;
    for (const t of stack(layout)) {
      const el = tileEl(t.id);
      if (el) grid.insertBefore(el, marker);
    }
    if (active instanceof HTMLElement && document.activeElement !== active) active.focus({ preventScroll: true });
  }

  /** Each menu's steps offered as the grid allows them now. */
  function offer() {
    for (const el of tileEls()) {
      const can = steps(layout, el.dataset.id || "");
      for (const b of el.querySelectorAll("button[data-step]")) {
        /** @type {HTMLButtonElement} */ (b).disabled = !can[/** @type {Step} */ (b.getAttribute("data-step"))];
      }
    }
  }

  // -- the status line and the live region ----------------------------------------------------

  /** The live region's words; the same words twice end in a no-break space the second time, so they are read again. @param {string} text */
  const announce = (text) => {
    if (say) say.textContent = say.textContent === text ? `${text}\u00a0` : text;
  };

  /** @param {string} text @param {{ undo?: boolean, retry?: boolean }} [o] */
  function line(text, o = {}) {
    if (!status) return;
    status.textContent = text;
    /** @param {string} label @param {() => void} run */
    const button = (label, run) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-link";
      b.textContent = label;
      b.addEventListener("click", run);
      status.appendChild(b);
    };
    if (o.retry) button(words.retry || "", () => save(true));
    if (o.undo && history.length) button(words.undo || "", undo);
  }

  // -- keeping the layout ----------------------------------------------------------------------

  /** @type {Tile[][]} */
  const history = [];
  let timer = 0;
  let sending = false;
  let again = false;
  /** The dashboard was deleted meanwhile (in another tab): the layout post's own words for it, and nothing is saved again. @type {{ line: string, link: string, href: string } | null} */
  let gone = null;

  /** The line in place of Try again: the dashboard no longer exists, and a link to the account's dashboards. */
  function goneLine() {
    if (!status || !gone) return;
    status.textContent = gone.line ? `${gone.line} ` : "";
    const a = document.createElement("a");
    a.href = gone.href;
    a.textContent = gone.link;
    status.appendChild(a);
    announce(gone.line);
  }

  /** A change made: the layout before it goes on the undo list, and the layout is saved. @param {readonly Tile[]} before */
  function changed(before) {
    history.push(before.map((t) => ({ ...t })));
    if (history.length > UNDO_MAX) history.shift();
    order();
    offer();
    trimAll();
    if (gone) {
      goneLine();
      return;
    }
    if (!data.save) {
      line(words.local || "", { undo: true });
      return;
    }
    line(words.saving || "");
    window.clearTimeout(timer);
    timer = window.setTimeout(() => save(false), DELAY_MS);
  }

  /** @param {Record<string, string>} renamed */
  function rename(renamed) {
    for (const [from, to] of Object.entries(renamed)) {
      const el = tileEl(from);
      if (!el || typeof to !== "string" || !/^[0-9a-f]{32}$/.test(to)) continue;
      el.dataset.id = to;
      el.id = `tile-${to}`;
      const head = el.querySelector(".dash-title");
      if (head) head.id = `tile-${to}-t`;
      el.setAttribute("aria-labelledby", `tile-${to}-t`);
      for (const f of el.querySelectorAll("form")) {
        const action = f.getAttribute("action") || "";
        f.setAttribute("action", action.replace(`/tiles/${from}/`, `/tiles/${to}/`));
      }
      for (const list of [layout, ...history]) for (const t of list) if (t.id === from) t.id = to;
    }
  }

  /** Send the layout now; a save asked for meanwhile goes after it. @param {boolean} now */
  async function save(now) {
    if (now) window.clearTimeout(timer);
    if (sending) {
      again = true;
      return;
    }
    sending = true;
    line(words.saving || "");
    let ok = false;
    try {
      const body = new URLSearchParams({ csrf: data.csrf || "", layout: layoutJson(layout) });
      const res = await fetch(data.layout || "", {
        method: "POST", body, credentials: "same-origin", redirect: "error", headers: { accept: "application/json" },
      });
      const json = (res.headers.get("content-type") || "").includes("json");
      const answer = (res.ok || res.status === 404) && json ? await res.json() : null;
      const said = goneOf(res.status, answer);
      if (said) {
        // Saving again can never work: the line says so, with the link, and no Try again.
        gone = said;
        window.clearTimeout(timer);
        again = false;
        sending = false;
        goneLine();
        return;
      }
      if (res.ok && answer && answer.state === "saved") {
        ok = true;
        if (answer.renamed && typeof answer.renamed === "object") rename(answer.renamed);
      } else if (res.ok && answer && answer.state === "unsaved") {
        data.save = false;
        sending = false;
        line(words.local || "", { undo: true });
        return;
      }
    } catch {
      ok = false;
    }
    sending = false;
    if (again) {
      again = false;
      save(true);
      return;
    }
    line(ok ? words.saved || "" : words.failed || "", ok ? { undo: true } : { retry: true, undo: true });
  }

  function undo() {
    const before = history.pop();
    if (!before) return;
    const was = layout;
    layout = before;
    show(layout);
    order();
    offer();
    for (const t of layout) {
      const old = was.find((o) => o.id === t.id);
      if (old && (old.w !== t.w || old.h !== t.h)) reread(t.id);
    }
    trimAll();
    announce(words.undone || "");
    if (gone) {
      goneLine();
      return;
    }
    if (!data.save) {
      line(words.undone || "", { undo: true });
      return;
    }
    window.clearTimeout(timer);
    timer = window.setTimeout(() => save(false), DELAY_MS);
    line(words.saving || "");
  }

  // -- a tile read again at its size ------------------------------------------------------------

  /** @param {string} id */
  async function reread(id) {
    const el = tileEl(id);
    const t = layout.find((x) => x.id === id);
    if (!el || !t) return;
    try {
      const res = await fetch(`${data.tiles || ""}${encodeURIComponent(id)}?w=${t.w}&h=${t.h}`, {
        credentials: "same-origin", redirect: "error", headers: { "x-csrf-token": data.csrf || "", accept: "text/html" },
      });
      if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) return;
      // The Worker's own fragment, read from this site: parsed apart from the page, then its body and foot put in place.
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const fresh = doc.querySelector(".dash-tile");
      const now = tileEl(id);
      if (!fresh || !now) return;
      now.dataset.total = fresh.getAttribute("data-total") ?? "";
      for (const part of [".dash-body", ".dash-foot"]) {
        const from = fresh.querySelector(part);
        const to = now.querySelector(part);
        if (from && to) to.replaceChildren(...Array.from(from.childNodes).map((n) => document.importNode(n, true)));
      }
      trim(now);
    } catch {
      // The tile keeps what it showed; the next load draws it at its size.
    }
  }

  // -- a list to its tile's height ------------------------------------------------------------

  /**
   * A body's rows as the units taken off together: a ranked bar with its table's row (an analytics table's bars
   * list the rows of its table), else each row alone.
   * @param {HTMLElement} body @returns {Element[][]}
   */
  function unitsOf(body) {
    const rows = Array.from(body.querySelectorAll("tbody > tr, ul.dash-counts > li"));
    const bars = Array.from(body.querySelectorAll("ol.rank-bars > li"));
    return bars.length === rows.length && bars.length ? rows.map((r, i) => [bars[i], r]) : rows.map((r) => [r]);
  }

  /** Rows that do not fit the tile's body are taken off, and its foot says how many it shows. @param {HTMLElement} el */
  function trim(el) {
    const body = /** @type {HTMLElement | null} */ (el.querySelector(".dash-body"));
    const count = /** @type {HTMLElement | null} */ (el.querySelector(".dash-count"));
    if (!body) return;
    const rows = unitsOf(body);
    for (const r of rows) for (const x of r) x.removeAttribute("hidden");
    if (count && count.dataset.text !== undefined) count.textContent = count.dataset.text;
    if (!wide.matches || !rows.length) return;
    let shown = rows.length;
    // Never fewer than one row: a tile at its least size holds three, and a body cut by its own height keeps its first.
    while (shown > 1 && body.scrollHeight > body.clientHeight + 1) for (const x of rows[--shown]) x.setAttribute("hidden", "");
    const total = Number(el.dataset.total || "");
    if (count && shown < rows.length && Number.isFinite(total) && total > 0) {
      if (count.dataset.text === undefined) count.dataset.text = count.textContent || "";
      count.textContent = fill(words.shown, { n: num(shown), total: num(total) });
    }
  }
  const trimAll = () => tileEls().forEach(trim);

  // -- moving and sizing ----------------------------------------------------------------------

  /** @type {null | { el: HTMLElement, id: string, how: "grip" | "corner", base: Tile[], preview: Tile[], keys: boolean, x?: number, y?: number, ox?: number, oy?: number, gw?: number, gh?: number, cw?: number, pid?: number }} */
  let held = null;

  /** A step of the held tile, or of a tile by its menu. @param {string} id @param {Step} step */
  const stepped = (id, step) => stepTile(layout, id, step);

  /** @param {HTMLElement} el @param {Tile} t */
  const where = (el, t) => fill(words.at, { title: titleOf(el), x: num(t.x + 1), cols: num(COLS), y: num(t.y + 1) });
  /** @param {HTMLElement} el @param {Tile} t */
  const sized = (el, t) => fill(words.size, { title: titleOf(el), w: num(t.w), h: num(t.h) });

  /** @param {HTMLElement} el @param {"grip" | "corner"} how @param {boolean} keys */
  function pick(el, how, keys) {
    held = { el, id: el.dataset.id || "", how, base: layout.map((t) => ({ ...t })), preview: layout, keys };
    el.classList.add("is-moving");
  }

  /** The held tile dropped (keep) or put back. @param {boolean} keep */
  function drop(keep) {
    if (!held) return;
    const { el, id, base, preview, how, keys } = held;
    held = null;
    // Where the tile is on the screen now (under the pointer, when dragged), so it slides from there to its place.
    const was = el.getBoundingClientRect();
    el.classList.remove("is-moving", "is-dragging");
    el.style.removeProperty("transform");
    mark(null);
    const moved = keep && !same(preview, base);
    layout = moved ? preview : base;
    show(layout, id);
    const t = layout.find((x) => x.id === id);
    if (t) place(el, t);
    if (wide.matches && !still.matches && typeof el.animate === "function") {
      const now = el.getBoundingClientRect();
      if (was.left !== now.left || was.top !== now.top) {
        el.animate([{ transform: `translate(${was.left - now.left}px, ${was.top - now.top}px)` }, { transform: "none" }], { duration: SLIDE_MS, easing: "ease-out" });
      }
    }
    if (keys || moved) announce(fill(keep ? words.dropped : words.back, { title: titleOf(el) }));
    if (!moved) return;
    changed(base);
    const b = base.find((x) => x.id === id);
    if (how === "corner" || (t && b && (t.w !== b.w || t.h !== b.h))) reread(id);
  }

  // The pointer: a grip moves, a corner sizes, from 1,100 px.
  grid.addEventListener("pointerdown", (e) => {
    const handle = e.target instanceof Element ? e.target.closest(".dash-grip, .dash-corner") : null;
    const el = /** @type {HTMLElement | null} */ (handle?.closest(".dash-tile") ?? null);
    if (!handle || !el || held || !wide.matches || e.button !== 0) return;
    e.preventDefault();
    const how = handle.classList.contains("dash-grip") ? "grip" : "corner";
    pick(el, how, false);
    const g = grid.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    Object.assign(/** @type {NonNullable<typeof held>} */ (held), {
      x: e.pageX, y: e.pageY, ox: r.left - g.left, oy: r.top - g.top, gw: r.width, gh: r.height, cw: (g.width - (COLS - 1) * GAP_PX) / COLS, pid: e.pointerId,
    });
    if (how === "grip") {
      el.classList.add("is-dragging");
      mark(layout.find((t) => t.id === el.dataset.id) ?? null);
    }
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a convenience: the moves still reach the grid while the pointer is over it.
    }
  });

  grid.addEventListener("pointermove", (e) => {
    if (!held || held.keys || e.pointerId !== held.pid) return;
    const h = held;
    if (e.clientY < EDGE_PX) window.scrollBy(0, -SCROLL_PX);
    else if (e.clientY > window.innerHeight - EDGE_PX) window.scrollBy(0, SCROLL_PX);
    const dx = e.pageX - (h.x ?? 0);
    const dy = e.pageY - (h.y ?? 0);
    const colStep = (h.cw ?? 1) + GAP_PX;
    const rowStep = ROW_PX + GAP_PX;
    let next;
    if (h.how === "grip") {
      h.el.style.transform = `translate(${dx}px, ${dy}px)`;
      next = move(h.base, h.id, Math.round(((h.ox ?? 0) + dx) / colStep), Math.round(((h.oy ?? 0) + dy) / rowStep));
    } else {
      next = resize(h.base, h.id, Math.round(((h.gw ?? 0) + dx + GAP_PX) / colStep), Math.round(((h.gh ?? 0) + dy + GAP_PX) / rowStep));
    }
    if (same(next, h.preview)) return;
    h.preview = next;
    show(next, h.how === "grip" ? h.id : undefined);
    if (h.how === "grip") mark(next.find((t) => t.id === h.id) ?? null);
  });

  /** @param {PointerEvent} e */
  const release = (e) => {
    if (held && !held.keys && e.pointerId === held.pid) drop(e.type === "pointerup");
  };
  grid.addEventListener("pointerup", release);
  grid.addEventListener("pointercancel", release);
  grid.addEventListener("lostpointercapture", (e) => {
    if (held && !held.keys && e.pointerId === held.pid) drop(true);
  });

  // The keys: Enter or Space picks the handle's tile up, the arrows step it, Enter drops it, Escape puts it back.
  grid.addEventListener("keydown", (e) => {
    const handle = e.target instanceof Element ? e.target.closest(".dash-grip, .dash-corner") : null;
    const el = /** @type {HTMLElement | null} */ (handle?.closest(".dash-tile") ?? null);
    if (!handle || !el) return;
    const how = handle.classList.contains("dash-grip") ? "grip" : "corner";
    if (!held) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      pick(el, how, true);
      announce(fill(how === "grip" ? words.picked : words.pickedSize, { title: titleOf(el) }));
      return;
    }
    if (!held.keys || held.el !== el) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      drop(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      drop(false);
      return;
    }
    const step = /** @type {Record<string, Step>} */ (KEY_STEPS[how])[e.key];
    if (!step) return;
    e.preventDefault();
    const next = stepTile(held.preview, held.id, step);
    held.preview = next;
    show(next);
    const t = next.find((x) => x.id === held?.id);
    if (t) announce(how === "grip" ? where(el, t) : sized(el, t));
  });
  // A held tile whose handle loses the focus is put back, as Escape does.
  grid.addEventListener("focusout", (e) => {
    if (held && held.keys && e.target instanceof Element && e.target.closest(".dash-tile") === held.el && !held.el.contains(/** @type {Node | null} */ (e.relatedTarget))) {
      drop(false);
    }
  });

  // The menu's steps, done here and kept as any change is; Remove and Open go on as links and posts.
  grid.addEventListener("submit", (e) => {
    const form = e.target instanceof HTMLFormElement ? e.target : null;
    const button = form?.querySelector("button[data-step]");
    const el = /** @type {HTMLElement | null} */ (form?.closest(".dash-tile") ?? null);
    if (!form || !button || !el || held) return;
    e.preventDefault();
    const step = /** @type {Step} */ (button.getAttribute("data-step"));
    const id = el.dataset.id || "";
    const before = layout;
    const next = stepped(id, step);
    form.closest("details")?.removeAttribute("open");
    if (same(next, before)) return;
    layout = next;
    show(layout);
    changed(before);
    const t = layout.find((x) => x.id === id);
    if (t) announce(["left", "right", "up", "down"].includes(step) ? where(el, t) : sized(el, t));
    if (!["left", "right", "up", "down"].includes(step)) reread(id);
    el.querySelector(".dash-menu-button")?.focus?.();
  });

  // Undo by the keys, outside a field.
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!history.length) return;
    e.preventDefault();
    undo();
  });

  // A menu closes when another opens, and on a press outside it.
  document.addEventListener("click", (e) => {
    for (const d of grid.querySelectorAll("details.dash-menu[open]")) {
      if (!(e.target instanceof Node) || !d.contains(e.target)) d.removeAttribute("open");
    }
  });

  // The lists kept to their tiles' heights at each width, and once the fonts are in.
  let pending = 0;
  window.addEventListener("resize", () => {
    window.cancelAnimationFrame(pending);
    pending = window.requestAnimationFrame(trimAll);
  });
  wide.addEventListener?.("change", () => {
    if (held) drop(false);
    trimAll();
  });
  document.fonts?.ready?.then(trimAll).catch(() => undefined);
  trimAll();
}
