/* Open tender notices (/tenders).

   Interaction model: the server renders the view the URL asks for, from the
   same file, so a linked or bookmarked filter works with scripts off and the
   form stays a plain GET form. This script fetches /data/tenders/open.json
   once and then answers every filter, sort and page change in memory, typed
   text after a short pause, writing the state back into the URL so the view
   can be shared. The filter rules match filterTenders() in
   src/pages/tenders.tsx; the tests hold the server to them.

   When the file cannot be fetched the server's rows stay, a sentence says
   why, and the form keeps working as a plain form.

   Everything rendered from data uses textContent. Every word the script
   draws comes from the page's <script type="application/json" id="i18n">
   block, so the script holds no copy of its own in either language. */
(function () {
  var form = document.getElementById("tender-filters");
  var results = document.getElementById("tender-results");
  var tableBox = document.getElementById("tender-table");
  var countEl = document.getElementById("tender-count");
  var pager = document.getElementById("tender-pager");
  if (!form || !results || !tableBox || !countEl || !pager) return;

  var I18N = {};
  try { I18N = JSON.parse(document.getElementById("i18n").textContent) || {}; } catch (e) { I18N = {}; }
  var STRINGS = I18N.strings || {};
  var LABELS = I18N.labels || {};
  var LANG = I18N.lang === "fr" ? "fr" : "en";
  var LOCALE = I18N.locale || "en-CA";
  var TODAY = results.getAttribute("data-today") || new Date().toISOString().slice(0, 10);
  var PAGE = parseInt(results.getAttribute("data-page-size") || "50", 10) || 50;
  var SOON_DAYS = 7;
  var TYPING_MS = 250;
  var FIELDS = ["q", "category", "segment", "province", "buyer", "type", "method", "closing"];
  var BUYER_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var NUMBER = null;
  try { NUMBER = new Intl.NumberFormat(LOCALE); } catch (e) { NUMBER = null; }

  var rows = null;
  var state = readUrl();
  var typing = null;

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
  function fold(s) {
    return String(s || "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  }
  function addDays(day, n) {
    var d = new Date(day + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function closingText(c) {
    var m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(c || "");
    return m ? (m[2] ? m[1] + " " + m[2] : m[1]) : (c || "");
  }

  // -- state ------------------------------------------------------------------

  // The same reading as readTenderQuery() on the server: a value the filter
  // cannot use reads as no filter.
  function clean(raw) {
    var s = {};
    s.q = (raw.q || "").trim().slice(0, 100);
    s.category = /^(SRV|GD|CNST|SRVTGD)$/.test((raw.category || "").toUpperCase()) ? raw.category.toUpperCase() : "";
    s.segment = /^\d{2}$/.test(raw.segment || "") ? raw.segment : "";
    s.province = /^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/.test((raw.province || "").toUpperCase()) ? raw.province.toUpperCase() : "";
    var buyer = (raw.buyer || "").toLowerCase();
    s.buyer = BUYER_RE.test(buyer) && buyer.length <= 80 ? buyer : "";
    s.type = (raw.type || "").slice(0, 200);
    s.method = (raw.method || "").slice(0, 200);
    s.closing = raw.closing === "7" || raw.closing === "30" ? raw.closing : "";
    s.sort = raw.sort === "published" ? "published" : "closing";
    var page = parseInt(raw.page || "1", 10);
    s.page = page >= 1 && page <= 10000 ? page : 1;
    return s;
  }
  function readUrl() {
    var p = new URLSearchParams(location.search);
    var raw = {};
    FIELDS.concat(["sort", "page"]).forEach(function (k) { raw[k] = p.get(k) || ""; });
    return clean(raw);
  }
  function readForm() {
    var raw = {};
    FIELDS.concat(["sort"]).forEach(function (k) {
      var field = form.elements.namedItem(k);
      raw[k] = field && "value" in field ? field.value : "";
    });
    return clean(raw);
  }
  function query(s, page) {
    var p = new URLSearchParams();
    FIELDS.forEach(function (k) { if (s[k]) p.set(k, s[k]); });
    if (s.sort !== "closing") p.set("sort", s.sort);
    if (page > 1) p.set("page", String(page));
    var q = p.toString();
    return q ? "?" + q : "";
  }

  // -- filtering --------------------------------------------------------------

  function filter(all, s) {
    var words = fold(s.q).split(/\s+/).filter(Boolean);
    var until = s.closing ? addDays(TODAY, Number(s.closing)) : "";
    var out = all.filter(function (r) {
      if (s.category && r.category.indexOf(s.category) < 0) return false;
      if (s.segment && r.segments.indexOf(s.segment) < 0) return false;
      if (s.province && r.provinces.indexOf(s.province) < 0) return false;
      if (s.buyer && r.buyer_id !== s.buyer) return false;
      if (s.type && r.notice_type_en !== s.type) return false;
      if (s.method && r.method_en !== s.method) return false;
      if (until) {
        var day = (r.closing || "").slice(0, 10);
        if (!day || day < TODAY || day > until) return false;
      }
      if (words.length) {
        var text = fold((r.title_en || "") + " " + (r.title_fr || "") + " " + r.reference);
        for (var i = 0; i < words.length; i++) if (text.indexOf(words[i]) < 0) return false;
      }
      return true;
    });
    function byRef(a, b) { return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0; }
    if (s.sort === "published") {
      out.sort(function (a, b) {
        var x = a.published || "", y = b.published || "";
        return x < y ? 1 : x > y ? -1 : byRef(a, b);
      });
    } else {
      out.sort(function (a, b) {
        var x = a.closing || "\uffff", y = b.closing || "\uffff";
        return x < y ? -1 : x > y ? 1 : byRef(a, b);
      });
    }
    return out;
  }

  // -- rendering (the same markup as TenderTable in src/pages/shared.tsx) -----

  function badge(r) {
    var day = (r.closing || "").slice(0, 10);
    var soon = day && day >= TODAY && day <= addDays(TODAY, SOON_DAYS);
    return el("span", "badge badge-" + (soon ? "closing" : "open"), tx(soon ? "status.closing" : "status.open"));
  }
  function cell(tr, label, cls) {
    var td = el("td", cls);
    td.setAttribute("data-label", tx(label));
    tr.appendChild(td);
    return td;
  }
  function row(r) {
    var tr = el("tr");
    var notice = cell(tr, "col.notice");
    var a = el("a", null, pick(r.title_en, r.title_fr) || r.reference);
    a.href = "/tenders/" + encodeURIComponent(r.reference.toLowerCase());
    notice.appendChild(a);
    notice.appendChild(el("br"));
    notice.appendChild(el("span", "mono id muted", r.reference));
    (r.segments || []).forEach(function (code) {
      notice.appendChild(document.createTextNode(" "));
      var chip = el("a", "chip", code);
      chip.href = "/categories/" + code;
      if (LABELS.segments && LABELS.segments[code]) chip.title = LABELS.segments[code];
      notice.appendChild(chip);
    });
    var buyer = cell(tr, "col.buyer");
    var name = pick(r.buyer_en, r.buyer_fr) || tx("common.not_stated");
    if (r.buyer_id && BUYER_RE.test(r.buyer_id)) {
      var b = el("a", null, name);
      b.href = "/buyers/" + r.buyer_id;
      buyer.appendChild(b);
    } else {
      buyer.textContent = name;
    }
    var closing = cell(tr, "col.closing", "mono");
    closing.appendChild(document.createTextNode(closingText(r.closing) + " "));
    closing.appendChild(badge(r));
    cell(tr, "col.published", "mono").textContent = r.published || "";
    var provinces = (r.provinces || []).map(function (p) { return (LABELS.provinces && LABELS.provinces[p]) || p; });
    cell(tr, "col.region").textContent = provinces.length ? provinces.join(", ") : tx("common.national");
    return tr;
  }
  function table(list) {
    var wrap = el("div", "table-wrap bordered");
    var t = el("table", "restack");
    var head = el("thead");
    var hr = el("tr");
    ["col.notice", "col.buyer", "col.closing", "col.published", "col.region"].forEach(function (k) { hr.appendChild(el("th", null, tx(k))); });
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
      render(true);
      results.scrollIntoView({ block: "start" });
    });
    return a;
  }
  function render(push) {
    var matched = filter(rows, state);
    var pages = Math.max(1, Math.ceil(matched.length / PAGE));
    if (state.page > pages) state.page = pages;
    var shown = matched.slice((state.page - 1) * PAGE, state.page * PAGE);
    countEl.textContent = txn("tenders.count_one", "tenders.count_many", matched.length, { n: num(matched.length) });
    tableBox.textContent = "";
    tableBox.appendChild(shown.length ? table(shown) : el("p", "muted", tx("tenders.none_match")));
    pager.textContent = "";
    pager.appendChild(el("span", "muted", tx("tenders.page_of", { page: num(state.page), pages: num(pages) })));
    var links = el("span", "pages");
    if (state.page > 1) links.appendChild(pageLink(tx("tenders.prev"), state.page - 1, "prev"));
    if (state.page < pages) links.appendChild(pageLink(tx("tenders.next"), state.page + 1, "next"));
    pager.appendChild(links);
    var url = location.pathname + query(state, state.page);
    try {
      if (push) history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    } catch (e) { /* a sandboxed page may refuse; the view still updates */ }
  }

  function applyForm() {
    state = readForm();
    state.page = 1;
    render(false);
  }

  // -- wiring -----------------------------------------------------------------

  function start(data) {
    rows = data;
    form.addEventListener("submit", function (e) { e.preventDefault(); applyForm(); });
    form.addEventListener("change", function (e) {
      if (e.target && e.target.name === "q") return;
      applyForm();
    });
    var text = form.elements.namedItem("q");
    if (text) {
      text.addEventListener("input", function () {
        if (typing) clearTimeout(typing);
        typing = setTimeout(applyForm, TYPING_MS);
      });
    }
    // The apply button is for the form without the script; filters apply as they change.
    var apply = document.getElementById("tender-apply");
    if (apply) apply.hidden = true;
    window.addEventListener("popstate", function () {
      state = readUrl();
      FIELDS.concat(["sort"]).forEach(function (k) {
        var field = form.elements.namedItem(k);
        if (field && "value" in field) field.value = state[k] || (k === "sort" ? "closing" : "");
      });
      render(false);
    });
  }

  var note = el("p", "muted small", tx("tenders.loading"));
  note.setAttribute("aria-live", "polite");
  results.insertBefore(note, countEl);
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
