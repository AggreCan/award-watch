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

   Everything rendered from data uses textContent. Every word the script
   draws comes from the page's <script type="application/json" id="i18n">
   block or from the toolbar's own labels, so the script holds no copy of
   its own in either language. */
(function () {
  var form = document.getElementById("tender-filters");
  var results = document.getElementById("tender-results");
  var tableBox = document.getElementById("tender-table");
  var countEl = document.getElementById("tender-count");
  var pager = document.getElementById("tender-pager");
  var chipsEl = document.getElementById("tender-chips");
  var detail = document.getElementById("tender-detail-body");
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
  var DESCRIPTION_CHARS = 600;
  var FIELDS = ["q", "category", "segment", "province", "buyer", "type", "method", "closing"];
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
  function addDays(day, n) {
    var d = new Date(day + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function closingText(c) {
    var m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(c || "");
    return m ? (m[2] ? m[1] + " " + m[2] : m[1]) : (c || "");
  }
  function shownRef(r) {
    return typeof r.reference_published === "string" && r.reference_published ? r.reference_published : r.reference;
  }
  // The notice on CanadaBuys in the page's language, as tenderNoticeUrl() in
  // src/pages/shared.tsx builds it.
  function noticeUrl(published) {
    var ref = encodeURIComponent(String(published).toLowerCase()).replace(/%2F/gi, "/");
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
  function writeForm() {
    FIELDS.concat(["sort"]).forEach(function (k) {
      var field = form.elements.namedItem(k);
      if (field && "value" in field) field.value = state[k] || (k === "sort" ? "closing" : "");
    });
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
        var text = fold((r.title_en || "") + " " + (r.title_fr || "") + " " + r.reference + " " + (r.reference_published || ""));
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
      out.sort(function (a, b) {
        var x = a.closing || "￿", y = b.closing || "￿";
        return x < y ? -1 : x > y ? 1 : byReference(a, b);
      });
    }
    return out;
  }

  // -- rendering (the same markup as TenderTable in src/pages/shared.tsx) -----

  function soon(closing) {
    var day = (closing || "").slice(0, 10);
    return !!day && day >= TODAY && day <= addDays(TODAY, SOON_DAYS);
  }
  function badge(closing) {
    var s = soon(closing);
    return el("span", "badge badge-" + (s ? "closing" : "open"), tx(s ? "status.closing" : "status.open"));
  }
  function cell(tr, label, cls) {
    var td = el("td", cls);
    td.setAttribute("data-label", tx(label));
    tr.appendChild(td);
    return td;
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
      var chip = el("a", "chip", code);
      chip.href = "/categories/" + code;
      if (LABELS.segments && LABELS.segments[code]) chip.title = LABELS.segments[code];
      notice.appendChild(chip);
    });
    cell(tr, "col.buyer", "c-buyer").appendChild(buyerNode(r.buyer_id, r.buyer_en, r.buyer_fr));
    var closing = cell(tr, "col.closing", "mono c-date");
    closing.appendChild(document.createTextNode(closingText(r.closing) + " "));
    closing.appendChild(badge(r.closing));
    cell(tr, "col.published", "mono c-pub mdh").textContent = r.published || "";
    var provinces = (r.provinces || []).map(function (p) { return (LABELS.provinces && LABELS.provinces[p]) || p; });
    cell(tr, "col.region", "c-region").textContent = provinces.length ? provinces.join(", ") : tx("common.national");
    return tr;
  }
  function table(list) {
    var wrap = el("div", "table-wrap bordered");
    var t = el("table", "restack t-tenders");
    var head = el("thead");
    var hr = el("tr");
    [["col.notice", "c-notice"], ["col.buyer", "c-buyer"], ["col.closing", "c-date"], ["col.published", "c-pub mdh"], ["col.region", "c-region"]]
      .forEach(function (c) { hr.appendChild(el("th", c[1], tx(c[0]))); });
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
    renderChips();
    restoreSelection();
    var url = location.pathname + query(state, state.page);
    try {
      if (push) history.pushState(null, "", url);
      else history.replaceState(null, "", url);
    } catch (e) { /* a sandboxed page may refuse; the view still updates */ }
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
    chips.appendChild(badge(d.closing || listed.closing));
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
    var closing = d.closing || listed.closing;
    kv(dl, "col.closing", closing ? closingText(closing) : null);
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
      box.appendChild(el("h4", null, tx("tender.description_heading")));
      var first = String(text).split(/\n{2,}/)[0];
      var cut = first.length > DESCRIPTION_CHARS || first.length < String(text).length;
      box.appendChild(el("p", null, first.length > DESCRIPTION_CHARS ? first.slice(0, DESCRIPTION_CHARS).replace(/\s+\S*$/, "") + "…" : first));
      if (cut) box.appendChild(el("p", "muted small", tx("tenders.detail_more")));
      detail.appendChild(box);
    }
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
