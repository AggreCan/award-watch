/* Long lists on a phone.

   Below 700 px a table restacks into labelled blocks, and a list of several
   hundred rows runs to tens of thousands of pixels. A table wrapper marked
   data-phone-page="50" (PhonePages in src/pages/shared.tsx) shows that many
   rows at a time there, with a pager under it: the range shown, Previous and
   Next. Wider screens, and phones without this script, show every row; the
   stylesheet holds the rows past the first 50 back until the script runs.
   A radar window, read from the server one page of 500 at a time, marks its
   wrapper with the page's offset in the window, the window's total and the
   addresses of the server pages on either side: its pager then counts the
   window's contracts ("51 to 100 of 7,192"), steps on to the next server
   page past its last rows (and back to the previous one's last rows), and
   takes the place of the window's own pager on a phone.

   A wrapper marked data-phone-rows="10" (a record list on a profile or a
   buyer page, a year table) shows its first ten rows on a phone, with a
   button under it that shows the rest. It counts the rows in view, so a year
   table switched to one source folds that source's rows.

   A details element marked data-phone-closed (the segment feeds on /feeds,
   the filters above a list) starts closed on a phone and stays open
   elsewhere.

   The words come from the page's JSON block (id "pager-i18n"), so the script
   holds no copy of its own in either language. */
(function () {
  var PHONE = window.matchMedia ? window.matchMedia("(max-width: 699px)") : null;
  if (!PHONE) return;

  var WORDS = {};
  try { WORDS = JSON.parse(document.getElementById("pager-i18n").textContent) || {}; } catch (e) { WORDS = {}; }
  var NUMBER = null;
  try { NUMBER = new Intl.NumberFormat(WORDS.locale || "en-CA"); } catch (e) { NUMBER = null; }
  function num(n) { return NUMBER ? NUMBER.format(n) : String(n); }
  function fill(s, vars) {
    return String(s || "").replace(/\{(\w+)\}/g, function (m, name) { return name in vars ? vars[name] : m; });
  }
  function onChange(fn) {
    if (PHONE.addEventListener) PHONE.addEventListener("change", fn);
    else if (PHONE.addListener) PHONE.addListener(fn);
  }
  function int(v) {
    var n = parseInt(v || "", 10);
    return isNaN(n) ? null : n;
  }

  // The server page before this one opens on its last rows.
  var FROM_END = "#from-end";

  function paged(wrap) {
    var size = int(wrap.getAttribute("data-phone-page")) || 50;
    var rows = Array.prototype.slice.call(wrap.querySelectorAll("tbody > tr"));
    var offset = int(wrap.getAttribute("data-phone-offset"));
    var combined = offset !== null;
    var total = combined ? int(wrap.getAttribute("data-phone-total")) || rows.length : rows.length;
    var prevUrl = wrap.getAttribute("data-phone-prev");
    var nextUrl = wrap.getAttribute("data-phone-next");
    var replaces = document.getElementById(wrap.getAttribute("data-phone-replaces") || "");
    wrap.classList.add("paged");
    if (rows.length <= size && !(combined && (prevUrl || nextUrl))) return;
    var parts = Math.max(1, Math.ceil(rows.length / size));
    var part = combined && location.hash === FROM_END ? parts - 1 : 0;

    var nav = document.createElement("nav");
    nav.className = "phone-pager";
    if (WORDS.nav) nav.setAttribute("aria-label", WORDS.nav);
    var range = document.createElement("span");
    range.className = "muted";
    range.setAttribute("aria-live", "polite");
    var buttons = document.createElement("span");
    buttons.className = "pages";
    function button(label, step) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = label || "";
      b.addEventListener("click", function () {
        if (step < 0 && part === 0 && prevUrl) { location.href = prevUrl + FROM_END; return; }
        if (step > 0 && part === parts - 1 && nextUrl) { location.href = nextUrl; return; }
        part = Math.min(parts - 1, Math.max(0, part + step));
        show();
        if (wrap.scrollIntoView) wrap.scrollIntoView({ block: "start" });
      });
      buttons.appendChild(b);
      return b;
    }
    var prev = button(WORDS.prev, -1);
    var next = button(WORDS.next, 1);
    nav.appendChild(range);
    nav.appendChild(buttons);
    wrap.parentNode.insertBefore(nav, wrap.nextSibling);

    function show() {
      var phone = PHONE.matches;
      rows.forEach(function (tr, i) { tr.hidden = phone && Math.floor(i / size) !== part; });
      nav.hidden = !phone;
      if (replaces) replaces.hidden = phone;
      var base = combined ? offset : 0;
      var first = base + part * size + 1;
      var last = base + Math.min(rows.length, (part + 1) * size);
      range.textContent = fill(WORDS.range, { first: num(first), last: num(last), n: num(total) });
      prev.disabled = part === 0 && !prevUrl;
      next.disabled = part === parts - 1 && !nextUrl;
    }
    show();
    onChange(show);
    if (combined && location.hash === FROM_END && PHONE.matches && wrap.scrollIntoView) wrap.scrollIntoView({ block: "start" });
  }

  function folded(wrap) {
    var size = int(wrap.getAttribute("data-phone-rows")) || 10;
    var rows = Array.prototype.slice.call(wrap.querySelectorAll("tbody > tr"));
    if (rows.length <= size) return;
    var open = false;
    var more = document.createElement("button");
    more.type = "button";
    more.className = "btn phone-more";
    more.hidden = true;
    more.addEventListener("click", function () {
      open = true;
      apply();
    });
    wrap.parentNode.insertBefore(more, wrap.nextSibling);
    function apply() {
      rows.forEach(function (tr) { tr.removeAttribute("data-phone-cut"); });
      if (!PHONE.matches || open) {
        more.hidden = true;
        return;
      }
      // The rows in view: a source switch or a fold above may hide some.
      var shown = rows.filter(function (tr) { return window.getComputedStyle(tr).display !== "none"; });
      shown.forEach(function (tr, i) { if (i >= size) tr.setAttribute("data-phone-cut", ""); });
      more.hidden = shown.length <= size;
      more.textContent = fill(WORDS.rows, { n: num(shown.length) });
    }
    apply();
    onChange(apply);
    var box = wrap.closest ? wrap.closest(".years-box") : null;
    if (box) {
      box.addEventListener("change", apply);
      // A details element's toggle does not bubble; it is caught on the way down.
      box.addEventListener("toggle", apply, true);
    }
  }

  function closed(details) {
    function set() { details.open = !PHONE.matches; }
    set();
    onChange(set);
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-phone-page]"), paged);
  Array.prototype.forEach.call(document.querySelectorAll("[data-phone-rows]"), folded);
  Array.prototype.forEach.call(document.querySelectorAll("details[data-phone-closed]"), closed);
})();
