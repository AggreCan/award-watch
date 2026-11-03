/* Open tender notices (/tenders).

   Interaction model: the server renders the first 50 notices by closing date
   from a small file (tenders/open-first.json), with the toolbar set to the
   URL's values and each active filter as a chip whose link drops it. This
   script fetches the full list, /data/tenders/open.json, once, renders the
   view the URL asks for, and then answers every filter, sort and page change
   in memory, typed text after a short pause, writing the state back into the
   URL so the view can be shared. The view's reading, address and filter
   rules live in tender-query.js, the browser's copy of readTenderQuery(),
   tenderQueryString() and filterTenders() in src/pages/tenders.tsx (which
   the server uses when its small file holds every open notice); the tests
   hold the two to the same answers. Category, segment and province may
   each carry several values (a list saved on the Email lists page opens
   so): each value has its own chip, and the key's select reads "Several
   (n)" until another value is chosen there.

   The list is a split view from 1200 px: a click, j or k selects a row and
   the panel beside the list shows that notice, read from its detail shard
   (/data/tenders/<first three hex digits of the SHA-1 of the reference>.json,
   the file the notice's own page reads). Enter opens the selected notice's
   page and / moves to the text filter. Below 1200 px the keys still move the
   selection and open the page; the panel stays hidden.

   When the full list cannot be fetched the server's rows stay, a sentence
   says why, and the toolbar keeps working as a plain form.

   Closing states come from the visitor's clock by the rule in closing.js
   (Eastern time when the value names no zone), as the server works them out
   when it renders: a notice whose closing time has passed reads "Closing
   date passed" and sorts last. A notice closing soon carries its closing
   instant for countdown.js, which this script tells ("aw:rows") after each
   draw of the list or the detail panel. Sorted by closing date, a row
   closing soon shows the time left in place of its chip (the chip waits
   hidden until the time comes), as the server draws it.

   An empty list says what to do next and hides the detail panel. Beside the
   panel the provinces column rests, and each row's provinces show under its
   buyer. On a phone the filters fold behind a button that counts the active
   ones (pager.js folds them); this script keeps the count.

   Everything rendered from data uses textContent. Every word the script
   draws comes from the page's <script type="application/json" id="i18n">
   block or from the toolbar's own labels, so the script holds no copy of
   its own in either language. The page loads it as a module. */
import { closingInstant, closingParts, closingPassed, closingState, countdownText } from "./closing.js";
import { BUYER_RE, CODE_RE, FIELDS, MULTI, clean, filterRows, queryString, readSearch } from "./tender-query.js";

(function () {
  var form = document.getElementById("tender-filters");
  var results = document.getElementById("tender-results");
  var tableBox = document.getElementById("tender-table");
  var countEl = document.getElementById("tender-count");
  var pager = document.getElementById("tender-pager");
  var chipsEl = document.getElementById("tender-chips");
  var foldEl = document.getElementById("tender-fold");
  var splitEl = document.getElementById("tender-split");
  var noteEl = document.getElementById("tender-note");
  var detail = document.getElementById("tender-detail-body");
  if (!form || !results || !tableBox || !countEl || !pager) return;

  var I18N = {};
  try { I18N = JSON.parse(document.getElementById("i18n").textContent) || {}; } catch (e) { I18N = {}; }
  var STRINGS = I18N.strings || {};
  var LABELS = I18N.labels || {};
  // The table's class, widths and head row, from the column system in src/columns.tsx.
  var TABLE = I18N.table && I18N.table.heads ? I18N.table : null;
  var LANG = I18N.lang === "fr" ? "fr" : "en";
  var LOCALE = I18N.locale || "en-CA";
  var PAGE = parseInt(results.getAttribute("data-page-size") || "50", 10) || 50;
  var SOON_DAYS = 7;
  var TYPING_MS = 250;
  var DESCRIPTION_CHARS = 600;
  var REF_RE = /^[a-z0-9._-]{1,80}$/;
  var NUMBER = null;
  try { NUMBER = new Intl.NumberFormat(LOCALE); } catch (e) { NUMBER = null; }
  var WIDE = window.matchMedia ? window.matchMedia("(min-width: 1200px)") : null;

  var rows = null;
  var byRef = {};
  var state = readUrl();
  var typing = null;
  var selected = null;
  var shards = {};
  var detailRun = 0;

  // -- helpers ----------------------------------------------------------------

  function tx(key, vars) {
    var s = STRINGS[key];
    if (s == null) return key;
    return vars ? s.replace(/\{(\w+)\}/g, function (m, name) { return name in vars ? String(vars[name]) : m; }) : s;
  }
  function txn(one, many, n, vars) {
    var singular = LANG === "fr" ? Math.abs(n) < 2 : n === 1;
    return tx(singular ? one : many, vars);
  }
  function num(n) { return NUMBER ? NUMBER.format(n || 0) : String(n || 0); }
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function pick(en, fr) {
    var mine = LANG === "fr" ? fr : en;
    var other = LANG === "fr" ? en : fr;
    return mine && String(mine).trim() ? mine : other && String(other).trim() ? other : null;
  }
  function pickList(en, fr) {
    var mine = LANG === "fr" ? fr : en;
    var other = LANG === "fr" ? en : fr;
    return Array.isArray(mine) && mine.length ? mine : Array.isArray(other) ? other : [];
  }
  // As closingTime() and closingText() in src/closing.ts: the time in the
  // page's language ("14:00", "14 h 00") with its zone (Eastern time, "ET",
  // when the value names none), after the date.
  function closingTime(c) {
    var p = closingParts(c);
    if (!p || !p.hh) return null;
    var zone = !p.zone ? tx("common.zone_et") : p.zone === "Z" ? "UTC" : p.zone;
    return tx("common.time", { hh: p.hh, mm: p.mm }) + " " + zone;
  }
  function closingText(c) {
    var p = closingParts(c);
    if (!p) return c || "";
    var time = closingTime(c);
    return time ? p.day + " " + time : p.day;
  }
  // A notice's state now: "closed" once its closing time has passed,
  // "closing" within the window, else "open".
  function stateOf(closing) { return closingState(closing, Date.now(), SOON_DAYS); }
  function closesAt(closing) {
    var at = closingInstant(closing);
    return at === null ? null : new Date(at).toISOString().replace(".000Z", "Z");
  }
  // The countdown script reads new marks at once.
  function rowsDrawn() {
    try { document.dispatchEvent(new CustomEvent("aw:rows")); } catch (e) { /* the countdown reads them on its next minute */ }
  }
  function shownRef(r) {
    return typeof r.reference_published === "string" && r.reference_published ? r.reference_published : r.reference;
  }
  // The notice on CanadaBuys in the page's language, as tenderNoticeUrl() in
  // src/pages/shared.tsx builds it: lower case, colons dropped, slashes kept.
  function noticeUrl(published) {
    var ref = encodeURIComponent(String(published).toLowerCase().replace(/:/g, "")).replace(/%2F/gi, "/");
    return LANG === "fr"
      ? "https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/" + ref
      : "https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/" + ref;
  }

  // -- state ------------------------------------------------------------------

  function readUrl() { return readSearch(location.search); }
  var nationalBox = form.querySelector('input[type="checkbox"][name="national"]');
  // A key with several values shows "Several (n)" in its select; choosing
  // anything else there replaces them with that choice.
  function multiSelect(k) { return form.querySelector('select[name="' + k + '"]'); }
  function readForm() {
    var raw = {};
    FIELDS.concat(["sort"]).forEach(function (k) {
      if (MULTI.indexOf(k) >= 0) {
        var select = multiSelect(k);
        var opt = select ? select.options[select.selectedIndex] : null;
        raw[k] = opt && opt.hasAttribute("data-several") ? state[k].slice() : select && select.value ? [select.value] : [];
        return;
      }
      var field = form.elements.namedItem(k);
      raw[k] = field && "value" in field ? field.value : "";
    });
    raw.national = nationalBox ? nationalBox.checked : true;
    return clean(raw);
  }
  function writeMulti(k) {
    var select = multiSelect(k);
    if (!select) return;
    var values = state[k];
    var several = select.querySelector("option[data-several]");
    if (values.length > 1) {
      if (!several) {
        several = document.createElement("option");
        several.value = "";
        several.setAttribute("data-several", "");
        select.insertBefore(several, select.firstChild);
      }
      several.textContent = tx("tenders.several", { n: num(values.length) });
      several.selected = true;
    } else {
      if (several) select.removeChild(several);
      select.value = values[0] || "";
    }
  }
  function writeForm() {
    FIELDS.concat(["sort"]).forEach(function (k) {
      if (MULTI.indexOf(k) >= 0) return writeMulti(k);
      var field = form.elements.namedItem(k);
      if (field && "value" in field) field.value = state[k] || (k === "sort" ? "closing" : "");
    });
    if (nationalBox) nationalBox.checked = state.national;
  }
  function query(s, page) { return queryString(s, page); }

  // -- filtering --------------------------------------------------------------

  function filter(all, s) { return filterRows(all, s, Date.now()); }

  // -- rendering (the same markup as TenderTable in src/pages/shared.tsx) -----

  function badge(state, ref) {
    var chip = el("span", "badge badge-" + state, tx("status." + state));
    if (state === "closing" && ref) chip.setAttribute("data-notice", ref);
    return chip;
  }
  // The marks countdown.js reads on an element showing a closing-soon time.
  function markCountdown(node, closing, ref) {
    var at = closesAt(closing);
    if (!at) return;
    node.setAttribute("data-closes", at);
    node.setAttribute("data-time", closingTime(closing) || "");
    node.setAttribute("data-notice", ref);
  }
  function cell(tr, label, cls) {
    var td = el("td", cls);
    td.setAttribute("data-label", tx(label));
    tr.appendChild(td);
    return td;
  }
  function provincesText(list) {
    var names = (list || []).map(function (p) { return (LABELS.provinces && LABELS.provinces[p]) || p; });
    return names.length ? names.join(", ") : tx("common.national");
  }
  // The words countdownText fills, as countdown.js reads them.
  function countdownWords() {
    return {
      in_min: tx("countdown.in_min"), in_hm: tx("countdown.in_hm"), in_day: tx("countdown.in_day"),
      in_days: tx("countdown.in_days"), today_at: tx("countdown.today_at"),
    };
  }
  function buyerNode(id, en, fr) {
    var name = pick(en, fr) || tx("common.not_stated");
    if (id && BUYER_RE.test(id)) {
      var b = el("a", null, name);
      b.href = "/buyers/" + id;
      return b;
    }
    return document.createTextNode(name);
  }
  function row(r) {
    var tr = el("tr");
    tr.setAttribute("data-ref", r.reference.toLowerCase());
    var notice = cell(tr, "col.notice", "c-notice");
    var shown = shownRef(r);
    var a = el("a", null, pick(r.title_en, r.title_fr) || shown);
    a.href = "/tenders/" + encodeURIComponent(r.reference.toLowerCase());
    notice.appendChild(a);
    notice.appendChild(el("br"));
    notice.appendChild(el("span", "mono id muted", shown));
    (r.segments || []).forEach(function (code) {
      notice.appendChild(document.createTextNode(" "));
      var short = (LABELS.short && LABELS.short[code]) || "";
      var chip = el("a", "chip", short ? code + " " + short : code);
      chip.href = "/segments/" + code;
      chip.setAttribute("aria-label", tx("segment.chip", { code: code, name: short }));
      if (LABELS.segments && LABELS.segments[code]) chip.title = LABELS.segments[code];
      notice.appendChild(chip);
    });
    var buyer = cell(tr, "col.buyer", "c-buyer");
    buyer.appendChild(buyerNode(r.buyer_id, r.buyer_en, r.buyer_fr));
    buyer.appendChild(el("span", "split-only muted small", provincesText(r.provinces)));
    var closing = cell(tr, "col.closing", "mono c-date");
    var state = stateOf(r.closing);
    var ref = r.reference.toLowerCase();
    closing.appendChild(document.createTextNode(closingText(r.closing) + " "));
    var chip = badge(state, ref);
    closing.appendChild(chip);
    if (state === "closing") {
      markCountdown(closing, r.closing, ref);
      var at = closingInstant(r.closing);
      var left = sortedByClosing() && at !== null ? countdownText(at, Date.now(), closingTime(r.closing) || "", countdownWords()) : null;
      if (left) {
        chip.hidden = true;
        closing.appendChild(el("span", "countdown", left));
      }
    }
    cell(tr, "col.published", "mono c-pub mdh").textContent = r.published || "";
    cell(tr, "col.region", "c-region").textContent = provincesText(r.provinces);
    return tr;
  }
  function table(list) {
    var wrap = el("div", "table-wrap bordered");
    var t = el("table", TABLE ? TABLE.cls : "restack t-tenders");
    if (TABLE && TABLE.style) t.setAttribute("style", TABLE.style);
    var head = el("thead");
    var hr = el("tr");
    var heads = TABLE ? TABLE.heads : [
      ["c-notice", tx("col.notice")], ["c-buyer", tx("col.buyer")], ["c-date", tx("col.closing")],
      ["c-pub mdh", tx("col.published")], ["c-region", tx("col.region")],
    ];
    heads.forEach(function (h) { hr.appendChild(el("th", h[0], h[1])); });
    head.appendChild(hr);
    t.appendChild(head);
    var body = el("tbody");
    list.forEach(function (r) { body.appendChild(row(r)); });
    t.appendChild(body);
    wrap.appendChild(t);
    return wrap;
  }
  function pageLink(label, page, rel) {
    var a = el("a", "btn", label);
    a.href = "/tenders" + query(state, page);
    a.rel = rel;
    a.addEventListener("click", function (e) {
      e.preventDefault();
      state.page = page;
      selected = null;
      render(true);
      results.scrollIntoView({ block: "start" });
    });
    return a;
  }

  // The active filters as chips, one a value: the toolbar's own label for
  // the filter and the value as its control shows it (without the count in
  // brackets).
  function fieldLabel(name) {
    var field = MULTI.indexOf(name) >= 0 ? multiSelect(name) : form.elements.namedItem(name);
    var label = field && field.closest ? field.closest("label") : null;
    var span = label ? label.querySelector(".field-label") : null;
    return span ? span.textContent : name;
  }
  function fieldValue(name) {
    var field = form.elements.namedItem(name);
    if (!field) return state[name];
    if (field.tagName === "SELECT") {
      var opt = field.options[field.selectedIndex];
      return opt ? opt.textContent.replace(/\s*\([\d\s.,  ]+\)$/, "") : state[name];
    }
    return state[name];
  }
  function optionText(name, value) {
    var select = multiSelect(name);
    var opts = select ? select.options : [];
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].value === value && !opts[i].hasAttribute("data-several")) return opts[i].textContent.replace(/\s*\([\d\s.,  ]+\)$/, "");
    }
    return value;
  }
  // Each active filter as [key, value shown, the state without it].
  function activeFilters() {
    var out = [];
    var copy = function () {
      var without = {};
      Object.keys(state).forEach(function (x) { without[x] = state[x]; });
      return without;
    };
    FIELDS.forEach(function (k) {
      if (MULTI.indexOf(k) >= 0) {
        state[k].forEach(function (v) {
          var without = copy();
          without[k] = state[k].filter(function (x) { return x !== v; });
          out.push([k, optionText(k, v), without]);
        });
      } else if (state[k]) {
        var without = copy();
        without[k] = "";
        out.push([k, fieldValue(k), without]);
      }
    });
    return out;
  }
  function renderChips() {
    if (!chipsEl) return;
    var label = chipsEl.querySelector(".chips-label");
    chipsEl.textContent = "";
    if (label) chipsEl.appendChild(label);
    var active = activeFilters();
    active.forEach(function (f) {
      var k = f[0], value = f[1], without = f[2];
      var chip = el("a", "fchip");
      chip.href = "/tenders" + query(without, 1);
      chip.setAttribute("aria-label", tx("tenders.remove_filter", { name: value }));
      chip.appendChild(el("span", null, fieldLabel(k)));
      chip.appendChild(document.createTextNode(" "));
      chip.appendChild(el("b", null, value));
      var x = el("span", "fchip-x", "×");
      x.setAttribute("aria-hidden", "true");
      chip.appendChild(x);
      chip.addEventListener("click", function (e) {
        e.preventDefault();
        state[k] = without[k];
        state.page = 1;
        writeForm();
        selected = null;
        render(true);
      });
      chipsEl.appendChild(chip);
    });
    chipsEl.hidden = !active.length;
    if (foldEl) {
      var n = active.length;
      foldEl.textContent = n === 0 ? tx("filters.fold") : txn("filters.fold_one", "filters.fold_many", n, { n: num(n) });
    }
  }

  function sortedByClosing() { return state.sort === "closing"; }

  // The empty list's next steps, as NoMatch in src/pages/tenders.tsx draws them.
  function noMatch() {
    var box = el("div", "empty-state");
    box.appendChild(el("p", null, tx("tenders.none_match")));
    var next = el("p", "muted");
    var reset = el("a", null, tx("tenders.none_reset"));
    reset.href = "/tenders";
    var search = el("a", null, tx("tenders.none_search"));
    search.href = "/search?" + new URLSearchParams({ q: state.q }).toString();
    var parts = tx(state.q ? "tenders.none_next_q" : "tenders.none_next").split(/(\{reset\}|\{search\})/);
    parts.forEach(function (part) {
      if (part === "{reset}") next.appendChild(reset);
      else if (part === "{search}") next.appendChild(search);
      else if (part) next.appendChild(document.createTextNode(part));
    });
    box.appendChild(next);
    return box;
  }

  function render(push) {
    var matched = filter(rows, state);
    var pages = Math.max(1, Math.ceil(matched.length / PAGE));
    if (state.page > pages) state.page = pages;
    var shown = matched.slice((state.page - 1) * PAGE, state.page * PAGE);
    countEl.textContent = txn("tenders.count_one", "tenders.count_many", matched.length, { n: num(matched.length) });
    tableBox.textContent = "";
    tableBox.appendChild(shown.length ? table(shown) : noMatch());
    if (splitEl) splitEl.classList.toggle("is-empty", !shown.length);
    if (noteEl) noteEl.hidden = !shown.length;
    pager.textContent = "";
    pager.appendChild(el("span", "muted", tx("tenders.page_of", { page: num(state.page), pages: num(pages) })));
    var links = el("span", "pages");
    if (state.page > 1) links.appendChild(pageLink(tx("tenders.prev"), state.page - 1, "prev"));
    if (state.page < pages) links.appendChild(pageLink(tx("tenders.next"), state.page + 1, "next"));
    pager.appendChild(links);
    renderChips();
    restoreSelection();
    rowsDrawn();
    var url = location.pathname + query(state, state.page);
    try {
      if (push) history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    } catch (e) { /* a sandboxed page may refuse; the view still updates */ }
    // The alerts block (interest.js) saves the address shown.
    try { document.dispatchEvent(new CustomEvent("aw:view")); } catch (e) { /* the form still reads the address when it is sent */ }
  }

  function applyForm() {
    state = readForm();
    // A value chosen where "Several (n)" stood replaces them, and the select drops that line.
    MULTI.forEach(writeMulti);
    state.page = 1;
    selected = null;
    render(false);
  }

  // -- selection and the detail panel ----------------------------------------

  function listRows() {
    return Array.prototype.slice.call(tableBox.querySelectorAll("tbody tr[data-ref]"));
  }
  function current() {
    var all = listRows();
    for (var i = 0; i < all.length; i++) if (all[i].getAttribute("data-ref") === selected) return i;
    return -1;
  }
  function select(i, scroll) {
    var all = listRows();
    if (i < 0 || i >= all.length) return;
    all.forEach(function (tr) { tr.classList.remove("is-sel"); });
    var tr = all[i];
    tr.classList.add("is-sel");
    selected = tr.getAttribute("data-ref");
    if (scroll && tr.scrollIntoView) tr.scrollIntoView({ block: "nearest" });
    if (WIDE && WIDE.matches) showDetail(selected);
  }
  // After a redraw the same notice stays selected when it is still listed;
  // on a wide screen the first one is selected so the panel is never empty.
  function restoreSelection() {
    var i = current();
    if (i >= 0) { select(i, false); return; }
    selected = null;
    if (WIDE && WIDE.matches && listRows().length) select(0, false);
    else if (detail) showMessage("tenders.detail_empty");
  }

  function showMessage(key) {
    if (!detail) return;
    detail.textContent = "";
    detail.appendChild(el("p", "muted", tx(key)));
  }

  function shardOf(ref) {
    if (!window.crypto || !crypto.subtle || typeof TextEncoder === "undefined") return Promise.reject(new Error("no digest"));
    return crypto.subtle.digest("SHA-1", new TextEncoder().encode(ref.toLowerCase())).then(function (buf) {
      var b = new Uint8Array(buf);
      return ((b[0] < 16 ? "0" : "") + b[0].toString(16) + (b[1] < 16 ? "0" : "") + b[1].toString(16)).slice(0, 3);
    });
  }
  function loadNotice(ref) {
    return shardOf(ref).then(function (key) {
      if (!shards[key]) {
        shards[key] = fetch("/data/tenders/" + key + ".json").then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        });
        shards[key].catch(function () { delete shards[key]; });
      }
      return shards[key];
    }).then(function (shard) {
      if (!shard || typeof shard !== "object") return null;
      if (Object.prototype.hasOwnProperty.call(shard, ref)) return shard[ref];
      var keys = Object.keys(shard);
      for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === ref) return shard[keys[i]];
      return null;
    });
  }

  function kv(dl, key, value) {
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) return;
    dl.appendChild(el("dt", null, tx(key)));
    var dd = el("dd");
    if (Array.isArray(value)) {
      value.forEach(function (v, i) {
        if (i) dd.appendChild(el("br"));
        dd.appendChild(document.createTextNode(v));
      });
    } else if (typeof value === "string") {
      dd.textContent = value;
    } else {
      dd.appendChild(value);
    }
    dl.appendChild(dd);
  }

  function renderDetail(ref, d) {
    var listed = byRef[ref] || {};
    var published = shownRef(d.reference ? d : listed) || ref;
    detail.textContent = "";
    var head = el("div", "detail-head");
    var chips = el("p", "detail-chips");
    var closing = d.closing || listed.closing;
    var state = stateOf(closing);
    chips.appendChild(badge(state, ref));
    (Array.isArray(d.category) ? d.category : []).forEach(function (c) {
      chips.appendChild(document.createTextNode(" "));
      chips.appendChild(el("span", "chip", (LABELS.categories && LABELS.categories[c]) || c));
    });
    head.appendChild(chips);
    head.appendChild(el("h3", null, pick(d.title_en, d.title_fr) || published));
    head.appendChild(el("p", "mono id muted", published));
    var acts = el("p", "detail-actions");
    var open = el("a", "btn btn-primary", tx("tenders.detail_open"));
    open.href = "/tenders/" + encodeURIComponent(ref);
    acts.appendChild(open);
    var cb = el("a", "btn", tx("tenders.detail_canadabuys"));
    cb.href = noticeUrl(published);
    cb.rel = "noopener";
    acts.appendChild(cb);
    head.appendChild(acts);
    detail.appendChild(head);

    var dl = el("dl");
    kv(dl, "col.closing", closing ? closingText(closing) : null);
    if (closing && state === "closing") {
      var dds = dl.getElementsByTagName("dd");
      if (dds.length) markCountdown(dds[dds.length - 1], closing, ref);
    }
    kv(dl, "col.published", d.published || listed.published || null);
    kv(dl, "col.buyer", pick(d.buyer_en, d.buyer_fr) ? buyerNode(d.buyer_id, d.buyer_en, d.buyer_fr) : null);
    kv(dl, "tender.end_users", pickList(d.end_users_en, d.end_users_fr));
    kv(dl, "tender.notice_type", pick(d.notice_type_en, d.notice_type_fr));
    kv(dl, "tender.method", pick(d.method_en, d.method_fr));
    kv(dl, "tender.selection", pick(d.selection_en, d.selection_fr));
    kv(dl, "tender.regions_delivery", pickList(d.regions_delivery_en, d.regions_delivery_fr));
    kv(dl, "tender.trade_agreements", pickList(d.trade_agreements_en, d.trade_agreements_fr));
    kv(dl, "tender.solicitation", d.solicitation || null);
    detail.appendChild(dl);

    var text = pick(d.description_en, d.description_fr);
    if (text) {
      var box = el("div", "detail-text");
      // The description in the other language says so after the heading.
      var mine = LANG === "fr" ? d.description_fr : d.description_en;
      var other = !(mine && String(mine).trim());
      box.appendChild(el("h4", null, tx("tender.description_heading") + (other ? " " + tx("common.other_lang_only") : "")));
      var first = String(text).split(/\n{2,}/)[0];
      var cut = first.length > DESCRIPTION_CHARS || first.length < String(text).length;
      box.appendChild(el("p", null, first.length > DESCRIPTION_CHARS ? first.slice(0, DESCRIPTION_CHARS).replace(/\s+\S*$/, "") + "…" : first));
      if (cut) box.appendChild(el("p", "muted small", tx("tenders.detail_more")));
      detail.appendChild(box);
    }
    rowsDrawn();
  }

  function showDetail(ref) {
    if (!detail || !ref || !REF_RE.test(ref)) return;
    var run = ++detailRun;
    showMessage("tenders.detail_loading");
    loadNotice(ref).then(function (d) {
      if (run !== detailRun) return;
      if (!d || typeof d !== "object") throw new Error("missing");
      renderDetail(ref, d);
    }).catch(function () {
      if (run !== detailRun) return;
      showMessage("tenders.detail_failed");
    });
  }

  function wireSelection() {
    tableBox.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a, button")) return;
      var tr = e.target.closest ? e.target.closest("tr[data-ref]") : null;
      if (!tr) return;
      var all = listRows();
      select(all.indexOf(tr), false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      var tag = e.target && e.target.tagName ? e.target.tagName : "";
      if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
      if (e.key === "j" || e.key === "k") {
        var i = current();
        select(i < 0 ? 0 : i + (e.key === "j" ? 1 : -1), true);
        e.preventDefault();
      } else if (e.key === "Enter" && tag !== "A" && selected) {
        location.href = "/tenders/" + encodeURIComponent(selected);
        e.preventDefault();
      } else if (e.key === "/") {
        var text = form.elements.namedItem("q");
        if (text && text.focus) { text.focus(); e.preventDefault(); }
      }
    });
    if (WIDE) {
      var onWide = function () { if (WIDE.matches) restoreSelection(); };
      if (WIDE.addEventListener) WIDE.addEventListener("change", onWide);
      else if (WIDE.addListener) WIDE.addListener(onWide);
    }
    restoreSelection();
  }

  // -- wiring -----------------------------------------------------------------

  function start(data) {
    rows = data;
    byRef = {};
    rows.forEach(function (r) { byRef[r.reference.toLowerCase()] = r; });
    // The values a key carries beyond its select ride as hidden fields for
    // the form without the script; from here the state keeps them.
    Array.prototype.forEach.call(form.querySelectorAll("input[type=hidden][data-several]"), function (input) {
      input.parentNode.removeChild(input);
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); applyForm(); });
    form.addEventListener("change", function (e) {
      if (e.target && (e.target.name === "q" || e.target.name === "code")) return;
      applyForm();
    });
    // Typed text applies after a short pause; a code once it is 2 to 8 digits, or empty.
    ["q", "code"].forEach(function (name) {
      var input = form.elements.namedItem(name);
      if (!input) return;
      input.addEventListener("input", function () {
        if (typing) clearTimeout(typing);
        if (name === "code" && input.value && !CODE_RE.test(input.value)) return;
        typing = setTimeout(applyForm, TYPING_MS);
      });
    });
    // The apply button is for the form without the script; filters apply as they change.
    var apply = document.getElementById("tender-apply");
    if (apply) apply.hidden = true;
    window.addEventListener("popstate", function () {
      state = readUrl();
      writeForm();
      selected = null;
      render(false);
    });
    // A linked view (a filter, a sort, a later page) is drawn now that the
    // whole list is here; the plain view comes out the same as the server's.
    render(false);
  }

  // The server's rows can be selected while the full list loads, and stay
  // selectable if it never does.
  wireSelection();

  var note = el("p", "muted small loading-note", tx("tenders.loading"));
  note.setAttribute("aria-live", "polite");
  results.insertBefore(note, tableBox);
  fetch("/data/tenders/open.json")
    .then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(function (data) {
      if (!Array.isArray(data)) throw new Error("not a list");
      note.parentNode.removeChild(note);
      start(data.filter(function (r) { return r && typeof r.reference === "string" && Array.isArray(r.segments) && Array.isArray(r.provinces) && Array.isArray(r.category); }));
    }, function () {
      note.textContent = tx("tenders.load_failed");
    });
})();
