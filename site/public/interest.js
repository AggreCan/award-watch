/* The "Get alerts by email" block (src/pages/interest.tsx) without a page
   load. The form works as a plain post without this script. With it, the post
   goes through fetch with the x-interest-fragment header, and the block the
   site answers with takes the place of the one on the page, so the reader
   keeps their place. Any other answer (a refusal from the request limits, a
   network fault) falls back to the plain post.

   On /tenders the list is filtered in the browser and tenders.js rewrites
   the address as the filters change, with an "aw:view" event each time. The
   form then saves the address shown, and its wording comes from the form's
   data attributes: the site's own wording while the filters are the ones the
   page was served with, otherwise "every new notice" or "the filters above".
   The site writes the exact wording again in its answer.

   On the Email lists page (src/pages/alerts.tsx) the same posting applies to
   the chooser, and choosing one of the filters under "New tender notices
   matching filters" ticks that list's box, so the filters are never left
   out of the post by an unticked box. This file holds no text of its own. */
(function () {
  if (!window.fetch || !window.URLSearchParams || !window.FormData) return;

  // The allowed keys that carry a value, sorted, as one string. A key may
  // carry several values (a saved list of several segments).
  function filterKey(search, keys) {
    var p = new URLSearchParams(search);
    var out = [];
    keys.forEach(function (k) {
      p.getAll(k).forEach(function (v) {
        v = v.trim();
        if (v) out.push(k + "=" + v);
      });
    });
    return out.sort().join("&");
  }

  function follow(box) {
    var form = box.querySelector("form[data-follow]");
    if (!form) return;
    var keys = (form.getAttribute("data-keys") || "").split(" ").filter(Boolean);
    var params = form.elements.namedItem("params");
    var label = box.querySelector(".interest-label");
    if (!params || !label) return;
    var served = filterKey(params.value.split("?")[1] || "", keys);
    var servedLabel = label.textContent;
    function update() {
      if (!box.isConnected) return;
      params.value = location.pathname + location.search;
      var now = filterKey(location.search, keys);
      label.textContent = now === served ? servedLabel : now ? form.getAttribute("data-label-some") : form.getAttribute("data-label-all");
    }
    document.addEventListener("aw:view", update);
    form.addEventListener("submit", update);
  }

  // The Canada-wide box only narrows a province, so it alone ticks nothing.
  function lists(box) {
    var filters = box.querySelector("form[data-lists] [data-list-filters]");
    var list = box.querySelector('form[data-lists] input[name="list"][value="matching"]');
    if (!filters || !list) return;
    filters.addEventListener("change", function (ev) {
      var t = ev.target;
      if (!t || t.name === "national") return;
      if (t.type === "checkbox" ? t.checked : t.selectedOptions && t.selectedOptions.length > 0) list.checked = true;
    });
  }

  function bind(box) {
    var form = box.querySelector("form[data-interest-form]");
    if (!form) return;
    follow(box);
    lists(box);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var button = form.querySelector("button[type=submit]");
      if (button) button.disabled = true;
      fetch(form.action, {
        method: "POST",
        body: new URLSearchParams(new FormData(form)),
        headers: { "x-interest-fragment": "1" },
        credentials: "same-origin",
      })
        .then(function (res) {
          if (res.headers.get("x-interest-fragment") !== "1") throw new Error("not the block");
          return res.text();
        })
        .then(function (html) {
          var holder = document.createElement("div");
          holder.innerHTML = html;
          var next = holder.querySelector("[data-interest]");
          if (!next) throw new Error("not the block");
          box.parentNode.replaceChild(next, box);
          bind(next);
          // After an error the cursor goes where the site points (the first
          // list box when none was ticked), else to the address.
          var field = next.querySelector(".interest-error") &&
            (next.querySelector("[data-focus]") || next.querySelector("input[name=email]"));
          if (field) field.focus();
        })
        .catch(function () {
          if (button) button.disabled = false;
          HTMLFormElement.prototype.submit.call(form);
        });
    });
  }

  function start() {
    var boxes = document.querySelectorAll("[data-interest]");
    for (var i = 0; i < boxes.length; i++) bind(boxes[i]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
