/* The open notices' view in the browser: reading it from an address,
   writing it back, and the rows it keeps. tenders.js draws with these; the
   server's readTenderQuery(), tenderQueryString() and filterTenders() in
   src/pages/tenders.tsx are the same rules in TypeScript, and
   test/tender-query.test.ts holds the two to the same answers. A value the
   filter cannot use reads as no filter.

   Category, segment and province may each carry several values (a list
   saved on the Email lists page opens so): a notice matches when it carries
   any one of a key's values, and it must match every key given. A key's
   values are kept once each, in the server's order, so a view has one
   address. The page loads it as a module. */
import { addDays, closingPassed, easternDay } from "./closing.js";

export var FIELDS = ["q", "category", "segment", "code", "province", "buyer", "type", "method", "closing"];
// The keys that take several values, and the order the server keeps them in
// (CATEGORY_ORDER and PROVINCES in src; segments by code).
export var MULTI = ["category", "segment", "province"];
var CATEGORY_ORDER = ["GD", "SRV", "CNST", "SRVTGD"];
var PROVINCE_ORDER = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
export var CODE_RE = /^[0-9]{2,8}$/;
export var BUYER_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// The orders the list's heads set, as TENDER_ORDERS in src/pages/tenders.tsx:
// the value in the address, the column, the direction. "closing" (no order
// asked) is the list's own, the soonest closing first, which "closing-asc"
// repeats from the head; "published" is the newest first.
export var ORDERS = [
  ["closing-asc", "closing", "asc"], ["closing-desc", "closing", "desc"], ["published-asc", "published", "asc"], ["published", "published", "desc"],
];
var SORTS = ORDERS.map(function (o) { return o[0]; });

// The values of a key the filter can use, once each, in the given order.
function ordered(values, order) {
  var asked = {};
  (values || []).forEach(function (v) { asked[String(v).trim().toUpperCase()] = true; });
  return order.filter(function (v) { return asked[v] === true; });
}
function segmentsOf(values) {
  var out = [];
  (values || []).forEach(function (v) {
    v = String(v).trim();
    if (/^\d{2}$/.test(v) && out.indexOf(v) < 0) out.push(v);
  });
  return out.sort();
}

// The view from raw values (an address's or the form's): category, segment
// and province come in as lists.
export function clean(raw) {
  var s = {};
  s.q = (raw.q || "").trim().slice(0, 100);
  s.category = ordered(raw.category, CATEGORY_ORDER);
  s.segment = segmentsOf(raw.segment);
  s.code = CODE_RE.test(raw.code || "") ? raw.code : "";
  s.province = ordered(raw.province, PROVINCE_ORDER);
  var buyer = (raw.buyer || "").toLowerCase();
  s.buyer = BUYER_RE.test(buyer) && buyer.length <= 80 ? buyer : "";
  s.type = (raw.type || "").slice(0, 200);
  s.method = (raw.method || "").slice(0, 200);
  s.closing = raw.closing === "7" || raw.closing === "30" ? raw.closing : "";
  s.sort = SORTS.indexOf(raw.sort) >= 0 ? raw.sort : "closing";
  // The Canada-wide notices stay in unless the address or the box says otherwise.
  s.national = raw.national !== false;
  // A province reads the derived provinces too unless the address or the box says otherwise.
  s.derived = raw.derived !== false;
  var page = parseInt(raw.page || "1", 10);
  s.page = page >= 1 && page <= 10000 ? page : 1;
  return s;
}

// As readTenderQuery(): national=0 alone turns the Canada-wide notices out;
// a 1 beside it (the ticked box) keeps them. derived reads the same way.
export function readSearch(search) {
  var p = new URLSearchParams(search);
  var raw = {};
  FIELDS.concat(["sort", "page"]).forEach(function (k) { raw[k] = MULTI.indexOf(k) >= 0 ? p.getAll(k) : p.get(k) || ""; });
  var national = p.getAll("national");
  raw.national = national.length === 0 || national.indexOf("1") >= 0;
  var derived = p.getAll("derived");
  raw.derived = derived.length === 0 || derived.indexOf("1") >= 0;
  return clean(raw);
}

// As tenderQueryString(): only the values set, keys in a fixed order.
export function queryString(s, page) {
  var p = new URLSearchParams();
  FIELDS.forEach(function (k) {
    if (MULTI.indexOf(k) >= 0) s[k].forEach(function (v) { p.append(k, v); });
    else if (s[k]) p.set(k, s[k]);
  });
  if (s.province.length && !s.national) p.set("national", "0");
  if (s.province.length && !s.derived) p.set("derived", "0");
  if (s.sort !== "closing") p.set("sort", s.sort);
  if (page > 1) p.set("page", String(page));
  var q = p.toString();
  return q ? "?" + q : "";
}

// Lower case with accents removed, so "evaluation" finds "Évaluation".
export function fold(s) {
  return String(s || "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
}

// As filterTenders(): the rows the view keeps, in its order, at the instant now.
export function filterRows(all, s, now) {
  var words = fold(s.q).split(/\s+/).filter(Boolean);
  var until = s.closing ? addDays(easternDay(now), Number(s.closing)) : "";
  var out = all.filter(function (r) {
    if (s.category.length && !s.category.some(function (v) { return r.category.indexOf(v) >= 0; })) return false;
    if (s.segment.length && !s.segment.some(function (v) { return r.segments.indexOf(v) >= 0; })) return false;
    if (s.code && !(r.codes || []).some(function (c) { return String(c).indexOf(s.code) === 0; })) return false;
    if (s.province.length) {
      // The stated provinces, and the derived ones unless the view leaves them out.
      var placed = s.derived && r.provinces_derived ? r.provinces.concat(r.provinces_derived) : r.provinces;
      if (!s.province.some(function (v) { return placed.indexOf(v) >= 0; }) && !(s.national && !placed.length)) return false;
    }
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
  if (s.sort === "published" || s.sort === "published-asc") {
    // Newest first, or oldest; a notice with no published date goes last either way.
    var up = s.sort === "published-asc" ? 1 : -1;
    out.sort(function (a, b) {
      var x = a.published || "", y = b.published || "";
      if (!x !== !y) return x ? -1 : 1;
      return x < y ? -up : x > y ? up : byReference(a, b);
    });
  } else {
    // Soonest first (latest first for closing-desc); a notice whose closing
    // time has passed, then one with no closing date, go last either way
    // (filterTenders() orders them the same way).
    var ranks = {};
    var dir = s.sort === "closing-desc" ? -1 : 1;
    out.forEach(function (r) { ranks[r.reference] = !r.closing ? 2 : closingPassed(r.closing, now) ? 1 : 0; });
    out.sort(function (a, b) {
      var ra = ranks[a.reference], rb = ranks[b.reference];
      if (ra !== rb) return ra - rb;
      var x = a.closing || "￿", y = b.closing || "￿";
      return x < y ? -dir : x > y ? dir : byReference(a, b);
    });
  }
  return out;
}
