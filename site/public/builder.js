/* The analytics builder's page (src/pages/builder.tsx) with its menus kept to
   what they offer, and the result redrawn as each menu changes.

   The menus' rules are build-menu.js, the copy the Worker reads every address
   through. As a menu changes, the menus after it keep only the options the
   matrix offers with those before (Subject, Rows, Figure, Source, then the
   period's longest span, Show as and the top N); an option no longer offered
   is hidden and disabled, and a menu whose choice was hidden takes its first
   offered one. The fields a subject does not use (a buyer, a segment, an
   organization, the ones compared), and the source and period of the
   contracts ending, are hidden and disabled, so the address the form writes
   names only what the view reads.

   Then the page asks the server for the result alone: a GET of the form's
   own address with the header x-build-fragment, answered with the result's
   section and the same header, which takes the place of the one on the page;
   the address in the bar becomes the view's. Any other answer, or a fault,
   puts one line in the result's place, from the words the page carries in
   its JSON block (#build-words), in its language: the view could not be
   drawn, and the form's own button to try again (drawable, failedLine); a
   request a newer one replaced writes nothing. Without this script every
   option shows, the form's button does the same, and the page answers a
   combination outside the matrix with its reason. This file holds no text of
   its own. */

import { longestSpan, measuresFor, rowsFor, showsFor, sourcesFor, topOffered } from "./build-menu.js";

/** Whether a preview's answer is the result to draw: 200, marked by the Worker as the fragment. @param {number} status @param {string | null} header */
export function drawable(status, header) {
  return status === 200 && header === "1";
}

/**
 * The line a preview that could not be drawn leaves in the result: the page's words for it, then the form's own button
 * (a submit button naming the form, so it asks the Worker for the whole page) to try again. null without the words.
 * @param {{ createElement: (tag: string) => any }} doc @param {{ failed?: unknown, retry?: unknown } | null} words
 */
export function failedLine(doc, words) {
  if (!words || typeof words.failed !== "string" || typeof words.retry !== "string") return null;
  const line = doc.createElement("p");
  const retry = doc.createElement("button");
  retry.type = "submit";
  retry.setAttribute("form", "build-form");
  retry.className = "btn-link";
  retry.textContent = words.retry;
  line.append(`${words.failed} `, retry);
  return line;
}

if (typeof document !== "undefined") start();

function start() {
  const form = document.getElementById("build-form");
  if (!form || !window.fetch || !window.URLSearchParams || !window.FormData || !window.DOMParser) return;
  /** @type {{ failed?: unknown, retry?: unknown } | null} */
  let words = null;
  try {
    words = JSON.parse(document.getElementById("build-words")?.textContent || "null");
  } catch {
    words = null;
  }
  const most = Number(form.getAttribute("data-most")) || 20;
  const field = (name) => form.elements.namedItem(name);

  // Keep a select's options to those offered; the first offered when its own is not.
  const keep = (select, offered) => {
    if (!select || !select.options) return;
    for (const option of Array.from(select.options)) {
      const ok = offered.includes(option.value);
      option.hidden = !ok;
      option.disabled = !ok;
    }
    if (!offered.includes(select.value) && offered.length) select.value = offered[0];
  };

  // Show or hide a group of fields, its controls disabled while hidden so the form does not send them.
  const group = (name, shown) => {
    for (const el of Array.from(form.querySelectorAll(`[data-for="${name}"]`))) {
      el.hidden = !shown;
      for (const control of Array.from(el.querySelectorAll("input, select"))) control.disabled = !shown;
      if (el.matches("select, input")) el.disabled = !shown;
    }
  };

  const apply = () => {
    const subject = field("subject").value;
    group("buyer", ["buyer", "buyers", "buyer_segment"].includes(subject));
    group("buyers", subject === "buyers");
    group("segment", ["segment", "buyer_segment"].includes(subject));
    group("org", ["organization", "organizations"].includes(subject));
    group("orgs", subject === "organizations");
    keep(field("rows"), rowsFor(subject));
    const rows = field("rows").value;
    keep(field("measure"), measuresFor(subject, rows));
    const measure = field("measure").value;
    keep(field("source"), sourcesFor({ subject, rows, measure }));
    const span = longestSpan({ rows, measure }, most);
    group("period", span !== null);
    if (span !== null) {
      // The first year within the span that ends with the last.
      const to = Number(field("to").value);
      const from = field("from");
      const years = Array.from(from.options).map((o) => o.value).filter((y) => Number(y) <= to && Number(y) > to - span);
      keep(from, years.includes(from.value) ? years : years.slice().sort((a, b) => Number(a) - Number(b)));
    }
    keep(field("show"), showsFor(rows, measure));
    group("top", topOffered(subject, rows));
  };

  // The form's address as the browser would write it, without the empty fields.
  const address = () => {
    const query = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (typeof v === "string" && v.trim()) query.append(k, v.trim());
    return query.toString();
  };

  let asked = null;
  const preview = async () => {
    const result = document.getElementById("build-result");
    if (!result) return;
    const query = address();
    if (asked) asked.abort();
    const controller = new AbortController();
    asked = controller;
    // The view could not be drawn: the line in the result's place, so it no longer shows a view the menus have left,
    // and the address the menus' view, so a reload or the line's button asks for it again.
    const failed = () => {
      const now = document.getElementById("build-result");
      const line = failedLine(document, words);
      if (!now || !line) return;
      now.hidden = false;
      now.replaceChildren(line);
      history.replaceState(null, "", `${location.pathname}?${query}`);
    };
    try {
      const res = await fetch(`${form.action}?${query}`, { headers: { "x-build-fragment": "1" }, credentials: "same-origin", signal: controller.signal });
      if (!drawable(res.status, res.headers.get("x-build-fragment"))) {
        if (controller === asked) failed();
        return;
      }
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const next = doc.getElementById("build-result");
      const now = document.getElementById("build-result");
      if (controller !== asked || !now) return;
      if (!next) {
        failed();
        return;
      }
      // The box stays, so a screen reader hears its new content; what it holds is the answer's.
      now.hidden = next.hidden;
      now.replaceChildren(...Array.from(next.childNodes, (node) => document.importNode(node, true)));
      history.replaceState(null, "", `${location.pathname}?${query}`);
    } catch {
      // A newer request aborted this one and draws in its place; a fault leaves the line.
      if (controller === asked) failed();
    }
  };

  let timer = 0;
  form.addEventListener("change", () => {
    apply();
    clearTimeout(timer);
    timer = setTimeout(preview, 250);
  });
  // A page the menus as served do not offer (a form sent without the script) is drawn again once they are kept to
  // what they offer.
  const chosen = () => ["rows", "measure", "source", "from", "show"].map((name) => field(name).value).join(" ");
  const served = chosen();
  apply();
  if (chosen() !== served) preview();
}
