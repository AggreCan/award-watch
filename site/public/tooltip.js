/* The site's tip over a chart's bar or point, a province of the home map, a
   ranked bar or a short-form figure (src/chart.tsx).

   Each of those carries its tip as its own title, an SVG <title> or a title
   attribute, a line each: the head (what the figure is and its period) over
   the exact figures (the full money value, a count, a share with its parts).
   An element marked data-tip holds tips (a chart's SVG, the ranked bars, the
   map) or is one (a short-form figure). Without this script the browser
   shows the title after its own delay. With it the same lines show at once
   in the page's one box (#aw-tip, role="tooltip", written by src/layout.tsx),
   above the pointer or the mark, below it near the window's top, and never
   past the window's edges:

   - on hover: the element under the pointer, or in a chart the bar or point
     whose column the pointer is in, so a short bar or a small point needs no
     aim. While the box shows, the element's title is set aside, so the
     browser's own tip does not show over it, and put back after;
   - on a tap: the same, until a tap elsewhere;
   - on keyboard focus: a chart panel's marks are one stop in the tab order
     and the arrow keys, Home and End step through them; a link holding a
     figure with a tip (a tile, a ranked bar's name) shows that tip while it
     has the focus. The element shown points to the box with
     aria-describedby.

   Escape hides the box, as do leaving, a scroll and a resize (a focused
   mark's box follows it instead). No request and no library. The functions
   are exported for test/tooltip.test.ts; the part that touches the page runs
   only in a browser. */

export const TIP_ID = "aw-tip";
// The room kept between the box and the window's edges, and between the box
// and what it describes: a mark, the pointer, or a finger, which hides more.
export const MARGIN = 8;
export const GAP = { focus: 8, pointer: 12, tap: 28 };

/**
 * A tip's text as its lines: a head over the figures, or one figure alone.
 * @param {string} text
 * @returns {{ head: string | null, figures: string[] }}
 */
export function tipLines(text) {
  const lines = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 ? { head: lines[0], figures: lines.slice(1) } : { head: null, figures: lines };
}

/** @typedef {{ left: number, top: number, right: number, bottom: number }} Box */

/**
 * Where the tip goes: centred over the anchor, above it with the gap, below
 * it when the window's top is too near, over it when neither fits; never
 * closer than the margin to an edge.
 * @param {Box} anchor the mark's box, or the pointer as a box of no size
 * @param {{ width: number, height: number }} size the tip's
 * @param {{ width: number, height: number }} view the window's
 * @param {number} [gap]
 * @param {number} [margin]
 * @returns {{ left: number, top: number, side: "above" | "below" | "over" }}
 */
export function placeTip(anchor, size, view, gap = GAP.focus, margin = MARGIN) {
  const mid = (anchor.left + anchor.right) / 2;
  const left = Math.max(margin, Math.min(mid - size.width / 2, view.width - margin - size.width));
  const above = anchor.top - gap - size.height;
  const below = anchor.bottom + gap;
  if (above >= margin) return { left: Math.round(left), top: Math.round(above), side: "above" };
  if (below + size.height <= view.height - margin) return { left: Math.round(left), top: Math.round(below), side: "below" };
  const top = Math.max(margin, Math.min(above, view.height - margin - size.height));
  return { left: Math.round(left), top: Math.round(top), side: "over" };
}

/**
 * How far from a chart's marks the pointer may be and still pick one: half
 * the closest spacing of their centres, less the widest's half width, so a
 * thin bar or a point owns its whole slot and a bar that fills its slot
 * owns little more than itself; never under the margin.
 * @param {{ left: number, right: number }[]} spans the marks' horizontal extents
 * @returns {number}
 */
export function markReach(spans) {
  const centres = spans.map((s) => (s.left + s.right) / 2).sort((a, b) => a - b);
  let spacing = Infinity;
  for (let i = 1; i < centres.length; i++) spacing = Math.min(spacing, centres[i] - centres[i - 1]);
  const half = Math.max(0, ...spans.map((s) => (s.right - s.left) / 2));
  return spacing === Infinity ? 2 * MARGIN : Math.max(MARGIN, spacing / 2 - half);
}

/**
 * The mark whose column holds x, or the nearest within reach; -1 for none.
 * @param {{ left: number, right: number }[]} spans
 * @param {number} x
 * @param {number} [reach]
 * @returns {number}
 */
export function markAt(spans, x, reach = markReach(spans)) {
  let best = -1;
  let gap = Infinity;
  spans.forEach((s, i) => {
    const d = x < s.left ? s.left - x : x > s.right ? x - s.right : 0;
    if (d < gap) {
      gap = d;
      best = i;
    }
  });
  return gap <= reach ? best : -1;
}

/**
 * The mark a key moves the focus to among n, from the one at i; null for a
 * key that moves nothing.
 * @param {number} i
 * @param {number} n
 * @param {string} key
 * @returns {number | null}
 */
export function stepMark(i, n, key) {
  if (n <= 0) return null;
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(n - 1, i + 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(0, i - 1);
  if (key === "Home") return 0;
  if (key === "End") return n - 1;
  return null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function start() {
  const tip = document.getElementById(TIP_ID);
  if (!tip) return;
  const box = /** @type {HTMLElement} */ (tip);

  /** @type {WeakMap<Element, string>} */
  const texts = new WeakMap();
  /** @param {Element} el */
  const svgTitle = (el) => {
    for (const c of Array.from(el.children)) if (c.localName === "title" && c.namespaceURI === SVG_NS) return c;
    return null;
  };
  // The element's tip, read once: its title is set aside while its box shows.
  /** @param {Element} el @returns {string | null} */
  const textOf = (el) => {
    const known = texts.get(el);
    if (known !== undefined) return known;
    const own = el.getAttribute("title") ?? (el instanceof SVGElement ? svgTitle(el)?.textContent ?? null : null);
    if (own === null || !own.trim()) return null;
    texts.set(el, own);
    return own;
  };
  /** @param {Element} el */
  const holds = (el) => !!el.closest("[data-tip]") && textOf(el) !== null;
  // The element with a tip at or above a node, up to the element marked data-tip that holds it.
  /** @param {EventTarget | null} node @returns {Element | null} */
  const tipAt = (node) => {
    let el = node instanceof Element ? node : null;
    const scope = el ? el.closest("[data-tip]") : null;
    for (; el && scope; el = el.parentElement) {
      if (textOf(el) !== null) return el;
      if (el === scope) break;
    }
    return null;
  };
  // A figure with a tip inside a focused link (a tile, the map's province).
  /** @param {Element} el @returns {Element | null} */
  const tipInside = (el) => {
    for (const n of Array.from(el.querySelectorAll("[data-tip][title], [data-tip] [title], [data-tip] title"))) {
      const t = n.localName === "title" && n.namespaceURI === SVG_NS ? n.parentElement : n;
      if (t && holds(t)) return t;
    }
    return null;
  };
  // A chart panel's marks in their order.
  /** @param {Element} scope @returns {Element[]} */
  const marksOf = (scope) => Array.from(scope.children).filter((el) => textOf(el) !== null);
  /** @param {Element} el */
  const chartOf = (el) => el.closest('[data-tip="keys"]');

  // Each chart panel a single stop in the tab order; its marks are then
  // controls of their own, so the panel is a group rather than an image.
  for (const scope of Array.from(document.querySelectorAll('[data-tip="keys"]'))) {
    const marks = marksOf(scope);
    if (!marks.length) continue;
    if (scope.getAttribute("role") === "img") scope.setAttribute("role", "group");
    marks.forEach((m, i) => m.setAttribute("tabindex", i === 0 ? "0" : "-1"));
  }

  /** @type {{ el: Element, how: "pointer" | "tap" | "focus", title: Element | null, attr: string | null, described: string | null } | null} */
  let shown = null;

  /** @param {string} text */
  const fill = (text) => {
    const { head, figures } = tipLines(text);
    box.textContent = "";
    if (head) {
      const h = document.createElement("span");
      h.className = "tip-head";
      h.textContent = head;
      box.appendChild(h);
    }
    figures.forEach((f, i) => {
      const s = document.createElement("span");
      s.className = i === 0 ? "tip-figure tip-main" : "tip-figure";
      s.textContent = f;
      box.appendChild(s);
    });
  };

  // The title goes while a pointer is on the element (the browser would
  // show it too) and comes back when the box hides.
  const setTitleAside = () => {
    if (!shown || shown.title || shown.attr !== null) return;
    const el = shown.el;
    if (el.hasAttribute("title")) {
      shown.attr = el.getAttribute("title");
      el.removeAttribute("title");
    } else {
      const t = svgTitle(el);
      if (t) {
        shown.title = t;
        t.remove();
      }
    }
  };

  const hide = () => {
    if (!shown) return;
    const { el, title, attr, described } = shown;
    if (attr !== null) el.setAttribute("title", attr);
    if (title) el.insertBefore(title, el.firstChild);
    if (described) el.setAttribute("aria-describedby", described);
    else el.removeAttribute("aria-describedby");
    el.classList.remove("tip-on");
    shown = null;
    box.hidden = true;
  };

  /** @param {Box} anchor @param {number} gap */
  const place = (anchor, gap) => {
    // Measured at the window's corner, so the last place does not narrow it.
    box.style.left = "0px";
    box.style.top = "0px";
    const size = { width: box.offsetWidth, height: box.offsetHeight };
    const view = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const p = placeTip(anchor, size, view, gap);
    box.style.left = `${p.left}px`;
    box.style.top = `${p.top}px`;
  };

  /** @param {Element} el @param {"pointer" | "tap" | "focus"} how @param {Box | null} at */
  const show = (el, how, at) => {
    if (!shown || shown.el !== el) {
      const text = textOf(el);
      if (text === null) return;
      hide();
      fill(text);
      const described = el.getAttribute("aria-describedby");
      shown = { el, how, title: null, attr: null, described };
      el.setAttribute("aria-describedby", described ? `${described} ${TIP_ID}` : TIP_ID);
      el.classList.add("tip-on");
      box.hidden = false;
    } else if (how !== "pointer" || shown.how === "pointer") {
      shown.how = how;
    }
    if (how !== "focus") setTitleAside();
    place(at ?? el.getBoundingClientRect(), GAP[how]);
  };

  // The pointer as the box's anchor; over a chart's mark the box also clears
  // the mark's top, the figure's end, so it never covers the bar it is about.
  /** @param {PointerEvent} e @param {Element} el @returns {Box} */
  const pointAt = (e, el) => {
    const top = chartOf(el) ? Math.min(e.clientY, el.getBoundingClientRect().top) : e.clientY;
    return { left: e.clientX, right: e.clientX, top, bottom: e.clientY };
  };

  // The element under the pointer, or in a chart the mark whose column it is in.
  /** @param {PointerEvent} e @returns {Element | null} */
  const pointed = (e) => {
    const node = e.target instanceof Element ? e.target : null;
    if (!node) return null;
    if (box.contains(node)) return shown ? shown.el : null;
    const direct = tipAt(node);
    if (direct) return direct;
    const scope = chartOf(node);
    if (!scope) return null;
    const marks = marksOf(scope);
    const i = markAt(marks.map((m) => m.getBoundingClientRect()), e.clientX);
    return i < 0 ? null : marks[i];
  };

  // Browsers send pointer moves once a frame at most, so each is handled as it comes.
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const el = pointed(e);
    if (el) show(el, "pointer", pointAt(e, el));
    else if (shown && shown.how === "pointer") hide();
  }, { passive: true });

  document.addEventListener("pointerdown", (e) => {
    const el = pointed(e);
    if (el && e.pointerType !== "mouse") show(el, "tap", pointAt(e, el));
    else if (!el && shown) hide();
  });

  document.documentElement.addEventListener("pointerleave", () => {
    if (shown && shown.how === "pointer") hide();
  });

  document.addEventListener("focusin", (e) => {
    const node = e.target instanceof Element ? e.target : null;
    const el = node ? tipAt(node) ?? tipInside(node) : null;
    if (el) {
      const scope = chartOf(el);
      if (scope) for (const m of marksOf(scope)) m.setAttribute("tabindex", m === el ? "0" : "-1");
      show(el, "focus", null);
    } else if (shown && shown.how === "focus") hide();
  });

  // The focus moving on hides the box; a focusin that follows shows the next.
  document.addEventListener("focusout", () => {
    if (shown && shown.how === "focus") hide();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hide();
      return;
    }
    const node = e.target instanceof Element ? e.target : null;
    const scope = node ? chartOf(node) : null;
    if (!node || !scope) return;
    const marks = marksOf(scope);
    const i = marks.indexOf(node);
    const next = i < 0 ? null : stepMark(i, marks.length, e.key);
    if (next === null) return;
    e.preventDefault();
    if (next !== i) /** @type {HTMLElement} */ (marks[next]).focus();
  });

  // A scroll or a resize moves the page under the box: a focused mark's box
  // follows it, a pointer's goes until the pointer moves again.
  const moved = () => {
    if (!shown) return;
    if (shown.how === "focus") place(shown.el.getBoundingClientRect(), GAP.focus);
    else hide();
  };
  window.addEventListener("scroll", moved, { passive: true, capture: true });
  window.addEventListener("resize", moved, { passive: true });
}

if (typeof document !== "undefined") start();
