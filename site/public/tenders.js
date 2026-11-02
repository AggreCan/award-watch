/* Open tender notices (/tenders).

   Interaction model: the server renders the first 50 notices by closing date
   from a small file (tenders/open-first.json), with the toolbar set to the
   URL's values and each active filter as a chip whose link drops it. This
   script fetches the full list, /data/tenders/open.json, once, renders the
   view the URL asks for, and then answers every filter, sort and page change
   in memory, typed text after a short pause, writing the state back into the
   URL so the view can be shared. The filter rules match filterTenders() in
   src/pages/tenders.tsx, which the server uses when its small file holds
   every open notice; the tests hold that function to them.

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
import { addDays, closingInstant, closingParts, closingPassed, closingState, countdownText, easternDay } from "./closing.js";

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
  var FIELDS = ["q", "category", "segment", "code", "province", "buyer", "type", "method", "closing"];
  var CODE_RE = /^[0-9]{2,8}$/;
  var BUYER_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
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
  // The Eastern date now, which the closing filter counts from.
  function today() { return easternDay(Date.now()); }
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

  // The same reading as readTenderQuery() on the server: a value the filter
  // cannot use reads as no filter.
  function clean(raw) {
    var s = {};
    s.q = (raw.q || "").trim().slice(0, 100);
    s.category = /^(SRV|GD|CNST|SRVTGD)$/.test((raw.category || "").toUpperCase()) ? raw.category.toUpperCase() : "";
    s.segment = /^\d{2}$/.test(raw.segment || "") ? raw.segment : "";
    s.code = CODE_RE.test(raw.code || "") ? raw.code : "";
    s.province = /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/.test((raw.province || "").toUpperCase()) ? raw.province.toUpperCase() : "";
    var buyer = (raw.buyer || "").toLowerCase();
    s.buyer = BUYER_RE.test(buyer) && buyer.length <= 80 ? buyer : "";
    s.type = (raw.type || "").slice(0, 200);
    s.method = (raw.method || "").slice(0, 200);
    s.closing = raw.closing === "7" || raw.closing === "30" ? raw.closing : "";
    s.sort = raw.sort === "published" ? "published" : "closing";
    // The Canada-wide notices stay in unless the address or the box says otherwise.
    s.national = raw.national !== false;
    var page = parseInt(raw.page || "1", 10);
    s.page = page >= 1 && page <= 10000 ? page : 1;
    return s;
  }
  // As readTenderQuery() on the server: national=0 alone turns the
  // Canada-wide notices out; a 1 beside it (the ticked box) keeps them.
  function readUrl() {
    var p = new URLSearchParams(location.search);
    var raw = {};
    FIELDS.concat(["sort", "page"]).forEach(function (k) { raw[k] = p.get(k) || ""; });
    var national = p.getAll("national");
    raw.national = national.length === 0 || national.indexOf("1") >= 0;
    return clean(raw);
  }
  var nationalBox = form.querySelector('input[type="checkbox"][name="national"]');
  function readForm() {
    var raw = {};
    FIELDS.concat(["sort"]).forEach(function (k) {
      var field = form.elements.namedItem(k);
      raw[k] = field && "value" in field ? field.value : "";
    });
    raw.national = nationalBox ? nationalBox.checked : true;
    return clean(raw);
  }
  function writeForm() {
    FIELDS.concat(["sort"]).forEach(function (k) {
      var field = form.elements.namedItem(k);
      if (field && "value" in field) field.value = state[k] || (k === "sort" ? "closing" : "");
    });
    if (nationalBox) nationalBox.checked = state.national;
  }
  function query(s, page) {
    var p = new URLSearchParams();
    FIELDS.forEach(function (k) { if (s[k]) p.set(k, s[k]); });
    if (s.province && !s.national) p.set("national", "0");
    if (s.sort !== "closing") p.set("sort", s.sort);
    if (page > 1) p.set("page", String(page));
    var q = p.toString();
    return q ? "?" + q : "";
  }

  // -- filtering --------------------------------------------------------------

  function filter(all, s) {
    var words = fold(s.q).split(/\s+/).filter(Boolean);
    var now = Date.now();
    var until = s.closing ? addDays(today(), Number(s.closing)) : "";
    var out = all.filter(function (r) {
      if (s.category && r.category.indexOf(s.category) < 0) return false;
      if (s.segment && r.segments.indexOf(s.segment) < 0) return false;
      if (s.code && !(r.codes || []).some(function (c) { return String(c).indexOf(s.code) === 0; })) return false;
      if (s.province && r.provinces.indexOf(s.province) < 0 && !(s.national && !r.provinces.length)) return false;
      if (s.buyer && r.buyer_id !== s.buyer) return false;
      if (s.type && r.notice_type_en !== s.type) return false;
      if (s.method && r.method_en !== s.method) return false;
      if (until) {
        var day = (r.closing || "").slice(0, 10);
        if (!day || day > until || closingPassed(r.closing, now)) return false;
      }
      if (words.length) {
        var text = fold((r.title_en || "") + " " + (r.title_fr || "") + " " + (r.excerpt_en || "") + " " + (r.excerpt_fr || "") + " " +
          r.reference + " " + (r.reference_published || ""));
        for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) < 0) return false;
      }
      return true;
    });
    function byReference(a, b) { return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0; }
    if (s.sort === "published") {
      out.sort(function (a, b) {
        var x = a.published || "", y = b.published || "";
        return x < y ? 1 : x > y ? -1 : byReference(a, b);
      });
    } else {
      // Soonest first; a notice whose closing time has passed, then one with
      // no closing date, go last (filterTenders() orders them the same way).
      var ranks = {};
      out.forEach(function (r) { ranks[r.reference] = !r.closing ? 2 : closingPassed(r.closing, now) ? 1 : 0; });
      out.sort(function (a, b) {
        var ra = ranks[a.reference], rb = ranks[b.reference];
        if (ra !== rb) return ra - rb;
        var x = a.closing || "￿", y = b.closing || "￿";
        return x < y ? -1 : x > y ? 1 : byReference(a, b);
      });
    }
    return out;
  }

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

  // The active filters as chips: the toolbar's own label for the filter and
  // the value as its control shows it (without the count in brackets).
  function fieldLabel(name) {
    var field = form.elements.namedItem(name);
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
  function renderChips() {
    if (!chipsEl) return;
    var label = chipsEl.querySelector(".chips-label");
    chipsEl.textContent = "";
    if (label) chipsEl.appendChild(label);
    var any = false;
    FIELDS.forEach(function (k) {
      if (!state[k]) return;
      any = true;
      var without = {};
      Object.keys(state).forEach(function (x) { without[x] = state[x]; });
      without[k] = "";
      var value = fieldValue(k);
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
        state[k] = "";
        state.page = 1;
        writeForm();
        selected = null;
        render(true);
      });
      chipsEl.appendChild(chip);
    });
    chipsEl.hidden = !any;
    if (foldEl) {
      var active = FIELDS.filter(function (k) { return !!state[k]; }).length;
      foldEl.textContent = active === 0 ? tx("filters.fold") : txn("filters.fold_one", "filters.fold_many", active, { n: num(active) });
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
