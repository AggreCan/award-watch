/* Long lists on a phone.

   Below 700 px a table restacks into labelled blocks, and a list of several
   hundred rows runs to tens of thousands of pixels. A table wrapper marked
   data-phone-page="50" (PhonePages in src/pages/shared.tsx) shows that many
   rows at a time there, with a pager under it: the range shown, Previous and
   Next. Wider screens, and phones without this script, show every row; the
   stylesheet holds the rows past the first 50 back until the script runs.

   A details element marked data-phone-closed (the segment feeds on /feeds)
   starts closed on a phone and stays open elsewhere.

   The pager's words come from the page's JSON block (id "pager-i18n"), so
   the script holds no copy of its own in either language. */
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

  function paged(wrap) {
    var size = parseInt(wrap.getAttribute("data-phone-page") || "50", 10) || 50;
    var rows = Array.prototype.slice.call(wrap.querySelectorAll("tbody > tr"));
    wrap.classList.add("paged");
    if (rows.length <= size) return;
    var parts = Math.ceil(rows.length / size);
    var part = 0;

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
      var first = part * size + 1;
      var last = Math.min(rows.length, (part + 1) * size);
      range.textContent = fill(WORDS.range, { first: num(first), last: num(last), n: num(rows.length) });
      prev.disabled = part === 0;
      next.disabled = part === parts - 1;
    }
    show();
    onChange(show);
  }

  function folded(details) {
    function set() { details.open = !PHONE.matches; }
    set();
    onChange(set);
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-phone-page]"), paged);
  Array.prototype.forEach.call(document.querySelectorAll("details[data-phone-closed]"), folded);
})();
