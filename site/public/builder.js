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
   the address in the bar becomes the view's. Any other answer leaves the page
   as it was. Without this script every option shows, the form's button does
   the same, and the page answers a combination outside the matrix with its
   reason. This file holds no text of its own. */

import { longestSpan, measuresFor, rowsFor, showsFor, sourcesFor, topOffered } from "./build-menu.js";

const form = document.getElementById("build-form");
if (form && window.fetch && window.URLSearchParams && window.FormData && window.DOMParser) {
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
    try {
      const res = await fetch(`${form.action}?${query}`, { headers: { "x-build-fragment": "1" }, credentials: "same-origin", signal: controller.signal });
      if (!res.ok || res.headers.get("x-build-fragment") !== "1") return;
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const next = doc.getElementById("build-result");
      const now = document.getElementById("build-result");
      if (!next || !now || controller !== asked) return;
      // The box stays, so a screen reader hears its new content; what it holds is the answer's.
      now.hidden = next.hidden;
      now.replaceChildren(...Array.from(next.childNodes, (node) => document.importNode(node, true)));
      history.replaceState(null, "", `${location.pathname}?${query}`);
    } catch {
      // A fault or a newer request: the page stays as it was.
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
