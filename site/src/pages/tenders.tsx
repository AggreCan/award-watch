// /tenders: every open notice, filtered and sorted. The server renders from
// tenders/open-first.json, a small file holding the first 50 notices by
// closing date, the number open and the facet counts, so a request never
// parses the full list. public/tenders.js fetches the full list
// (tenders/open.json) once and answers every filter, sort and page in
// memory, writing the state back into the URL so a view can be shared.
//
// A link to a filtered, sorted or later view is rendered by the script once
// the list has loaded; the server shows the form set to the link's values and
// says so. Category, segment and province may each carry several values (a
// list saved on the Email lists page opens so): a notice matches when it
// carries any one of a key's values, and it must match every key given. When the first file holds every open notice (a short list), the
// server answers any view itself, with the same rules as the script
// (filterTenders below; the tests hold both to the same answers).
//
// /tenders/new: the notices first seen on one day, from tenders/new/<day>.json,
// the newest day by default and any of the last 30 on request.

import type { Context } from "hono";
import { type SortOrders, SortsHere, clientTable, headSort } from "../columns";
import { CATEGORIES, CLOSING_SOON_DAYS, PROVINCES, SEGMENT_CODES } from "../constants";
import {
  BUYER_ID_RE, type CodeLevel, DAY_RE, type FacetCount, type OpenFirst, codeLevel, loadNewTenders, loadOpenFirst, loadOpenLevels, loadStats,
  type TenderRow,
} from "../data";
import type { AppEnv } from "../env";
import {
  categoryLabel, clientStrings, fmtInt, numberLocale, pick, provinceName, segmentLabel, segmentShort, t, tj, tn, type Key, type Lang,
} from "../i18n";
import { type Clock, clockOf, closingPassed, tenderState } from "../closing";
import { ClientData, Layout, PageHead, Panel, addDays, noDataPage, page, todayOf } from "../layout";
import { pageSeo } from "../seo";
import { FeedLinks, nationalFeedPath } from "./feeds";
import { InterestPanel, interestFilter } from "./interest";
import { intradayBand, sameDayView } from "./intraday";
import { SameDayNote, sameDayNoted } from "./same_day";
import { CountdownScript, FiltersFold, SegmentNote, TenderTable, tenderColumns } from "./shared";

export const TENDER_PAGE_SIZE = 50;
export const CLOSING_WINDOWS = ["7", "30"] as const;
export const CODE_RE = /^[0-9]{2,8}$/;

// The order several values of a key are read, written and named in, so a
// view has one address. Segments go by code and provinces by their code's
// order in PROVINCES.
export const CATEGORY_ORDER = ["GD", "SRV", "CNST", "SRVTGD"] as const;
// The keys that take several values.
export const MULTI_KEYS = ["category", "segment", "province"] as const;
type MultiKey = (typeof MULTI_KEYS)[number];

export interface TenderQuery {
  q: string;
  // Each value once, in the fixed order; empty for no filter.
  category: string[];
  segment: string[];
  // A UNSPSC code prefix: a family (4 digits), a class (6) or any 2 to 8.
  code: string;
  province: string[];
  // With a province chosen, whether the notices that name none (Canada-wide
  // or not stated, about half of them) stay in the list. On unless the
  // address says national=0.
  national: boolean;
  // Whether a province filter reads the provinces derived from another field
  // (a city the regions of delivery name, a notice's regions of opportunity, a
  // Defence Construction Canada regional office: pipeline places.py) beside
  // the stated ones. On unless the address says
  // derived=0.
  derived: boolean;
  buyer: string;
  type: string;
  method: string;
  closing: string;
  // TENDER_ORDERS, or "closing", the list's own order.
  sort: "closing" | (typeof TENDER_ORDERS)[number][0];
  page: number;
}

// The orders the list's heads set (ORDERS in public/tender-query.js): the
// value in the address, the column, the direction. "closing" (no order
// asked) is the soonest closing first, which "closing-asc" repeats from the
// head; "published" is the newest first.
export const TENDER_ORDERS = [
  ["closing-asc", "closing", "asc"], ["closing-desc", "closing", "desc"], ["published-asc", "published", "asc"], ["published", "published", "desc"],
] as const satisfies SortOrders;

// Whether the list runs soonest closing first, where the closing-soon rows show the time left.
export const soonestClosing = (q: Pick<TenderQuery, "sort">): boolean => q.sort === "closing" || q.sort === "closing-asc";

const MAX_TEXT = 100;

// The query as the form and the script write it. A value the filter cannot
// use reads as no filter, so a stale or hand-typed link still opens a page.
export function readTenderQuery(url: URL): TenderQuery {
  const get = (k: string) => (url.searchParams.get(k) ?? "").trim();
  // Every value of the key the filter can use, once each, in the fixed order.
  const all = (k: MultiKey, allowed: readonly string[]) => {
    const asked = new Set(url.searchParams.getAll(k).map((v) => v.trim().toUpperCase()));
    return allowed.filter((v) => asked.has(v));
  };
  const buyer = get("buyer").toLowerCase();
  const closing = get("closing");
  const pageNo = Number(get("page"));
  const code = get("code");
  // The form sends national=0 from a hidden field and national=1 from the
  // ticked box, so either 1 or no value at all keeps the notices in.
  const national = url.searchParams.getAll("national");
  const derived = url.searchParams.getAll("derived");
  return {
    q: get("q").slice(0, MAX_TEXT),
    category: all("category", CATEGORY_ORDER),
    segment: all("segment", SEGMENT_CODES),
    code: CODE_RE.test(code) ? code : "",
    province: all("province", PROVINCES),
    national: national.length === 0 || national.includes("1"),
    derived: derived.length === 0 || derived.includes("1"),
    buyer: BUYER_ID_RE.test(buyer) && buyer.length <= 80 ? buyer : "",
    type: get("type").slice(0, 200),
    method: get("method").slice(0, 200),
    closing: (CLOSING_WINDOWS as readonly string[]).includes(closing) ? closing : "",
    sort: TENDER_ORDERS.find((o) => o[0] === get("sort"))?.[0] ?? "closing",
    page: Number.isInteger(pageNo) && pageNo >= 1 && pageNo <= 10_000 ? pageNo : 1,
  };
}

// Lower case with accents removed, so "evaluation" finds "Évaluation".
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
}

// The rows that pass every filter, in the order asked for, at the page's
// clock. Each of category, segment and province keeps a notice that carries
// any one of its values. The text filter reads the title and the start of
// the description in both languages and the reference, as published too. A
// province reads a notice's stated provinces and, unless derived is off, its
// derived ones; it keeps the notices that have none unless national is off. The code filter is a
// prefix of any of a notice's UNSPSC codes. The closing window counts from
// the Eastern date and leaves out a notice whose closing time has passed.
// By closing date, such a notice goes after the ones still open.
export function filterTenders(rows: readonly TenderRow[], q: TenderQuery, clock: Clock): TenderRow[] {
  const words = fold(q.q).split(/\s+/).filter(Boolean);
  const until = q.closing ? addDays(clock.today, Number(q.closing)) : "";
  const out = rows.filter((r) => {
    if (q.category.length && !q.category.some((v) => r.category.includes(v))) return false;
    if (q.segment.length && !q.segment.some((v) => r.segments.includes(v))) return false;
    if (q.code && !(r.codes ?? []).some((c) => c.startsWith(q.code))) return false;
    if (q.province.length) {
      const placed = q.derived && r.provinces_derived ? [...r.provinces, ...r.provinces_derived] : r.provinces;
      if (!q.province.some((v) => placed.includes(v)) && !(q.national && placed.length === 0)) return false;
    }
    if (q.buyer && r.buyer_id !== q.buyer) return false;
    if (q.type && r.notice_type_en !== q.type) return false;
    if (q.method && r.method_en !== q.method) return false;
    if (until) {
      const day = (r.closing ?? "").slice(0, 10);
      if (!day || day > until || closingPassed(r.closing, clock)) return false;
    }
    if (words.length) {
      const text = fold(`${r.title_en ?? ""} ${r.title_fr ?? ""} ${r.excerpt_en ?? ""} ${r.excerpt_fr ?? ""} ${r.reference} ${r.reference_published ?? ""}`);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
  // Ties fall back to the reference so the order never depends on the file's.
  const byRef = (a: TenderRow, b: TenderRow) => (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0);
  if (q.sort === "published" || q.sort === "published-asc") {
    // Newest first, or oldest; a notice with no published date goes last either way.
    const up = q.sort === "published-asc" ? 1 : -1;
    out.sort((a, b) => {
      const x = a.published ?? "";
      const y = b.published ?? "";
      if (!x !== !y) return x ? -1 : 1;
      return x < y ? -up : x > y ? up : byRef(a, b);
    });
  } else {
    // Soonest first (latest first for closing-desc); a notice whose closing
    // time has passed, then one with no closing date, go last either way.
    // Each rank is worked out once.
    const dir = q.sort === "closing-desc" ? -1 : 1;
    const ranks = new Map(out.map((r) => [r, r.closing === null ? 2 : closingPassed(r.closing, clock) ? 1 : 0]));
    out.sort((a, b) => {
      const ra = ranks.get(a)!;
      const rb = ranks.get(b)!;
      if (ra !== rb) return ra - rb;
      const x = a.closing ?? "\uffff";
      const y = b.closing ?? "\uffff";
      return x < y ? -dir : x > y ? dir : byRef(a, b);
    });
  }
  return out;
}

// The URL of a view: only the values set, keys in a fixed order and a key's
// values once each in theirs; national=0 and derived=0 only where they change
// the list, beside a province.
export function tenderQueryString(q: TenderQuery, pageNo = q.page): string {
  const p = new URLSearchParams();
  for (const k of ["q", "category", "segment", "code", "province", "buyer", "type", "method", "closing"] as const) {
    const v = q[k];
    if (Array.isArray(v)) for (const one of new Set(v)) p.append(k, one);
    else if (v) p.set(k, v);
  }
  if (q.province.length && !q.national) p.set("national", "0");
  if (q.province.length && !q.derived) p.set("derived", "0");
  if (q.sort !== "closing") p.set("sort", q.sort);
  if (pageNo > 1) p.set("page", String(pageNo));
  const s = p.toString();
  return s ? `?${s}` : "";
}

type Option = { value: string; label: string; n: number };

// Each select lists the values the open notices carry (the export counts them
// over the whole list), so no choice leads to an empty list. The Email lists
// page offers the same segments and provinces.
export function tenderOptions(facets: OpenFirst["facets"], lang: Lang) {
  const list = (counts: readonly FacetCount[], label: (f: FacetCount) => string, byValue = false) =>
    counts
      .map((f) => ({ value: f.value, label: label(f), n: f.n }))
      .sort((a, b) => (byValue ? a.value.localeCompare(b.value) : a.label.localeCompare(b.label, numberLocale(lang))));
  const named = (f: FacetCount) => pick(lang, f.en, f.fr) ?? f.value;
  return {
    category: list(facets.category, (f) => categoryLabel(lang, f.value)),
    segment: list(facets.segment, (f) => `${f.value} ${segmentLabel(lang, f.value)}`, true),
    province: list(facets.province, (f) => provinceName(lang, f.value)),
    buyer: list(facets.buyer, named),
    type: list(facets.notice_type, named),
    method: list(facets.method, named),
  };
}

// Every string tenders.js draws, handed over in the page's JSON block.
export const TENDERS_CLIENT_KEYS: readonly Key[] = [
  "col.notice", "col.buyer", "col.closing", "col.published", "col.region", "common.national", "common.not_stated",
  "places.derived_mark", "places.derived_row", "places.derived_value", "places.from_delivery", "places.from_opportunity",
  "places.from_dcc_office",
  "common.time", "common.zone_et", "common.other_lang_only", "segment.chip", "tenders.filter_segment", "tenders.filter_family",
  "tenders.filter_class",
  "status.open", "status.closing", "status.closed", "tenders.count_one", "tenders.count_many", "tenders.none_match", "tenders.page_of",
  "tenders.prev", "tenders.next", "tenders.load_failed", "tenders.loading", "tenders.remove_filter",
  "tenders.detail_empty", "tenders.detail_loading", "tenders.detail_failed", "tenders.detail_open",
  "tenders.detail_canadabuys", "tenders.detail_more", "tender.notice_type", "tender.method", "tender.selection",
  "tender.category", "tender.regions_delivery", "tender.trade_agreements", "tender.solicitation", "tender.end_users",
  "tender.description_heading", "tenders.none_next", "tenders.none_next_q", "tenders.none_reset", "tenders.none_search",
  "filters.fold", "filters.fold_one", "filters.fold_many", "tenders.several",
  "countdown.in_min", "countdown.in_hm", "countdown.in_day", "countdown.in_days", "countdown.today_at",
];

// The empty list: what to do next. With words in the title filter, the
// organizations and buyers that carry them are a search away.
export const NoMatch = ({ lang, q }: { lang: Lang; q: string }) => (
  <div class="empty-state">
    <p>{t(lang, "tenders.none_match")}</p>
    <p class="muted">
      {tj(lang, q ? "tenders.none_next_q" : "tenders.none_next", {
        reset: <a href="/tenders">{t(lang, "tenders.none_reset")}</a>,
        search: <a href={`/search?${new URLSearchParams({ q }).toString()}`}>{t(lang, "tenders.none_search")}</a>,
      })}
    </p>
  </div>
);

// A filter field in the toolbar: its name above, the control below. A key
// set to several values shows "Several (n)", and the values ride along as
// hidden fields, so the form without the script keeps them (a value chosen
// in the select is added to them; the chips take one off). tenders.js
// removes the hidden fields and keeps the values itself.
const Select = ({ name, label, any, opts, value, lang }: {
  name: string; label: Key; any: Key; opts: Option[]; value: string | readonly string[]; lang: Lang;
}) => {
  const values = typeof value === "string" ? (value ? [value] : []) : value;
  const several = values.length > 1;
  return (
    <label class="field">
      <span class="field-label">{t(lang, label)}</span>
      <select name={name}>
        {several ? <option value="" selected data-several="">{t(lang, "tenders.several", { n: values.length })}</option> : null}
        <option value="">{t(lang, any)}</option>
        {opts.map((o) => (
          <option value={o.value} selected={!several && o.value === values[0]}>{`${o.label} (${fmtInt(o.n, lang)})`}</option>
        ))}
      </select>
      {several ? values.map((v) => <input type="hidden" name={name} value={v} data-several="" />) : null}
    </label>
  );
};

type Chip = { label: string; value: string; without: TenderQuery };

// The name of the code the filter holds: a segment's title for two digits,
// and for a family or class its name as the open notices give it
// (tenders/open-levels.json); null for a commodity's eight digits, a level
// no open notice carries, or one the notices never named.
export function codeName(levels: readonly CodeLevel[] | null, code: string, lang: Lang): string | null {
  if (code.length === 2) return SEGMENT_CODES.includes(code) ? segmentLabel(lang, code) : null;
  if (!levels || !codeLevel(code)) return null;
  const level = levels.find((l) => l.code === code);
  return level ? pick(lang, level.en, level.fr) : null;
}

// The code filter's chip: the level its digits name (segment, family or
// class) and the code with its name, so the chip shows no bare number
// where a name is known.
export function codeChip(lang: Lang, code: string, name: string | null): { label: string; value: string } {
  const level = code.length === 2 ? "segment" : codeLevel(code);
  const label = t(lang, level === "segment" ? "tenders.filter_segment" : level === "family" ? "tenders.filter_family"
    : level === "class" ? "tenders.filter_class" : "tenders.filter_code");
  return { label, value: name ? `${code} ${name}` : code };
}

// The filters the URL sets, one chip a value, each linking to the same view
// without that value, so a filter comes off with or without the script.
function activeChips(q: TenderQuery, opts: ReturnType<typeof tenderOptions>, lang: Lang, code: string | null): Chip[] {
  const named = (list: Option[], v: string) => list.find((o) => o.value === v)?.label ?? v;
  const chips: Chip[] = [];
  const one = (key: Exclude<keyof TenderQuery, MultiKey | "national" | "derived" | "sort" | "page">, label: Key, value: string) =>
    chips.push({ label: t(lang, label), value, without: { ...q, [key]: "", page: 1 } });
  const each = (key: MultiKey, label: Key, list: Option[]) => {
    for (const v of q[key]) chips.push({ label: t(lang, label), value: named(list, v), without: { ...q, [key]: q[key].filter((x) => x !== v), page: 1 } });
  };
  if (q.q) one("q", "tenders.filter_text", q.q);
  each("category", "tenders.filter_category", opts.category);
  each("segment", "tenders.filter_segment", opts.segment);
  if (q.code) chips.push({ ...codeChip(lang, q.code, code), without: { ...q, code: "", page: 1 } });
  each("province", "tenders.filter_province", opts.province);
  if (q.buyer) one("buyer", "tenders.filter_buyer", named(opts.buyer, q.buyer));
  if (q.type) one("type", "tenders.filter_type", named(opts.type, q.type));
  if (q.method) one("method", "tenders.filter_method", named(opts.method, q.method));
  if (q.closing) one("closing", "tenders.filter_closing", t(lang, "tenders.closing_days", { n: Number(q.closing) }));
  return chips;
}

export async function tendersPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const first = stats ? await loadOpenFirst(c.env) : null;
  if (!stats || !first) return noDataPage(c, "tenders.title");
  const clock = clockOf(c.env);
  const url = new URL(c.req.url);
  const q = readTenderQuery(url);
  const filtered = tenderQueryString({ ...q, page: 1 }) !== "";
  const complete = first.rows.length >= first.total;
  // The first file answers the plain list, and any view when it holds every
  // open notice; any other view waits for the script and the full list.
  const waiting = (filtered || q.page > 1) && !complete;
  const matched = waiting ? [] : filterTenders(first.rows, q, clock);
  const count = filtered ? matched.length : first.total;
  const pages = Math.max(1, Math.ceil(count / TENDER_PAGE_SIZE));
  const pageNo = Math.min(q.page, pages);
  const shown = matched.slice((pageNo - 1) * TENDER_PAGE_SIZE, pageNo * TENDER_PAGE_SIZE);
  const opts = tenderOptions(first.facets, lang);
  // The levels file is read only for a view with a code, to name it.
  const levels = q.code ? await loadOpenLevels(c.env).catch(() => null) : null;
  const named = q.code ? codeName(levels, q.code, lang) : null;
  // The canonical page is the unfiltered list; a filtered view is a view of it.
  const seo = pageSeo("tenders", lang, filtered || q.page > 1 ? { noindex: true } : {});
  const prev = !waiting && pageNo > 1 ? `/tenders${tenderQueryString(q, pageNo - 1)}` : null;
  const next = !waiting && pageNo < pages ? `/tenders${tenderQueryString(q, pageNo + 1)}` : null;
  const labels = {
    segments: Object.fromEntries(opts.segment.map((o) => [o.value, segmentLabel(lang, o.value)])),
    short: Object.fromEntries(SEGMENT_CODES.map((code) => [code, segmentShort(lang, code)])),
    provinces: Object.fromEntries([...PROVINCES, "XX", "UN"].map((p) => [p, provinceName(lang, p)])),
    categories: Object.fromEntries(CATEGORIES.map((k) => [k, categoryLabel(lang, k)])),
    // The address's family or class with its name; tenders.js reads the rest from
    // tenders/open-levels.json, and a segment's name from the two lists above.
    codes: q.code && named && codeLevel(q.code) ? { [q.code]: named } : {},
  };
  const chips = activeChips(q, opts, lang, named);
  const interest = await interestFilter(c.env, lang, "tenders", `/tenders${url.search}`);
  const empty = !waiting && shown.length === 0;
  // The same-day notices for a paid request; null (nothing read) on the free plan.
  const intraday = await intradayBand(c, stats.data_as_of, clock);
  const sameDay = await sameDayNoted(c);
  // The list runs past one page, so its heads sort it whole: Closing and
  // Published link the same view in their next order (tenders.js answers
  // the links in memory once the full list is in); the other heads are plain.
  const sortHref = (v: string) => `/tenders${tenderQueryString({ ...q, sort: v as TenderQuery["sort"], page: 1 })}`;
  const sorts = {
    closing: headSort(TENDER_ORDERS, q.sort, "closing", sortHref, "closing"),
    published: headSort(TENDER_ORDERS, q.sort, "published", sortHref, "closing"),
  };

  return page(
    c,
    <Layout lang={lang} title={t(lang, "tenders.title")} dataAsOf={stats.data_as_of} active="/tenders" seo={seo}
      head={<FeedLinks lang={lang} />}>
      <PageHead lang={lang} title={t(lang, "tenders.title")} lead={t(lang, "tenders.lead", { n: fmtInt(first.total, lang) })}
        actions={<>
          <a href="/downloads/open-tenders.csv" class="btn">{t(lang, "tenders.csv")}</a>
          <a href={`/data/${nationalFeedPath("tenders")}`} class="btn">{t(lang, "feeds.button_tenders")}</a>
        </>}>
        <p class="page-note">{t(lang, "tenders.contact_note")}</p>
        {sameDay ? <SameDayNote lang={lang} /> : null}
      </PageHead>

      <form method="get" action="/tenders" class="toolbar" id="tender-filters">
        <FiltersFold lang={lang} active={chips.length} id="tender-fold">
        <div class="toolbar-fields">
          <label class="field field-text">
            <span class="field-label">{t(lang, "tenders.filter_text")}</span>
            <input type="search" name="q" value={q.q} maxlength={MAX_TEXT} autocomplete="off" />
          </label>
          {/* "All" agrees with the filter's noun in French: Toutes for Catégorie, Province, Méthode. */}
          <Select name="category" label="tenders.filter_category" any="tenders.any_f" opts={opts.category} value={q.category} lang={lang} />
          <Select name="segment" label="tenders.filter_segment" any="tenders.any" opts={opts.segment} value={q.segment} lang={lang} />
          <label class="field field-code">
            <span class="field-label">{t(lang, "tenders.filter_code")}</span>
            <input type="text" name="code" value={q.code} maxlength={8} inputmode="numeric" pattern="[0-9]{2,8}" autocomplete="off"
              placeholder={t(lang, "tenders.code_placeholder")} list="code-levels" />
            {/* tenders.js fills it with the open notices' families and classes, by name, once the field is used. */}
            <datalist id="code-levels"></datalist>
          </label>
          <Select name="province" label="tenders.filter_province" any="tenders.any_f" opts={opts.province} value={q.province} lang={lang} />
          <div class="field field-check">
            <span class="field-label" aria-hidden="true">&nbsp;</span>
            <label class="check">
              <input type="hidden" name="national" value="0" />
              <input type="checkbox" name="national" value="1" checked={q.national} />
              <span>{t(lang, "tenders.include_national")}</span>
            </label>
          </div>
          <div class="field field-check">
            <span class="field-label" aria-hidden="true">&nbsp;</span>
            <label class="check">
              <input type="hidden" name="derived" value="0" />
              <input type="checkbox" name="derived" value="1" checked={q.derived} />
              <span>{t(lang, "tenders.include_derived")}</span>
            </label>
          </div>
          <Select name="buyer" label="tenders.filter_buyer" any="tenders.any" opts={opts.buyer} value={q.buyer} lang={lang} />
          <Select name="type" label="tenders.filter_type" any="tenders.any" opts={opts.type} value={q.type} lang={lang} />
          <Select name="method" label="tenders.filter_method" any="tenders.any_f" opts={opts.method} value={q.method} lang={lang} />
          <label class="field">
            <span class="field-label">{t(lang, "tenders.filter_closing")}</span>
            <select name="closing">
              <option value="">{t(lang, "tenders.closing_any")}</option>
              <option value="7" selected={q.closing === "7"}>{t(lang, "tenders.closing_days", { n: CLOSING_SOON_DAYS })}</option>
              <option value="30" selected={q.closing === "30"}>{t(lang, "tenders.closing_days", { n: 30 })}</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">{t(lang, "tenders.sort")}</span>
            {/* "closing-asc", set from the head, is the list's own order and reads as it here. */}
            <select name="sort">
              <option value="closing">{t(lang, "tenders.sort_closing")}</option>
              <option value="closing-desc" selected={q.sort === "closing-desc"}>{t(lang, "tenders.sort_closing_desc")}</option>
              <option value="published" selected={q.sort === "published"}>{t(lang, "tenders.sort_published")}</option>
              <option value="published-asc" selected={q.sort === "published-asc"}>{t(lang, "tenders.sort_published_asc")}</option>
            </select>
          </label>
          <div class="toolbar-actions">
            <button type="submit" class="btn btn-primary" id="tender-apply">{t(lang, "tenders.apply")}</button>
            <a href="/tenders" class="btn">{t(lang, "tenders.reset")}</a>
          </div>
        </div>
        </FiltersFold>
        <div class="toolbar-chips" id="tender-chips" hidden={chips.length === 0}>
          <span class="chips-label">{t(lang, "tenders.filters_active")}</span>
          {chips.map((ch) => (
            <a class="fchip" href={`/tenders${tenderQueryString(ch.without)}`}
              aria-label={t(lang, "tenders.remove_filter", { name: ch.value })}>
              <span>{ch.label}</span> <b>{ch.value}</b>
              <span class="fchip-x" aria-hidden="true">×</span>
            </a>
          ))}
        </div>
      </form>

      {intraday}
      <div class={empty ? "split is-empty" : "split"} id="tender-split">
        <Panel title={t(lang, "tenders.list_heading")} class="list-panel"
          tools={<p id="tender-count" aria-live="polite">
            {waiting ? "" : tn(lang, "tenders.count_one", "tenders.count_many", count, { n: fmtInt(count, lang) })}
          </p>}
          foot={<>
            <span class="keys">{tj(lang, "tenders.keys_hint", { j: <kbd>j</kbd>, k: <kbd>k</kbd>, enter: <kbd>{t(lang, "tenders.key_enter")}</kbd> })}</span>
            <nav aria-label={t(lang, "common.pagination")} class="pagination" id="tender-pager">
              <span class="muted">{waiting ? "" : t(lang, "tenders.page_of", { page: fmtInt(pageNo, lang), pages: fmtInt(pages, lang) })}</span>
              <span class="pages">
                {prev ? <a href={prev} class="btn" rel="prev">{t(lang, "tenders.prev")}</a> : null}
                {next ? <a href={next} class="btn" rel="next">{t(lang, "tenders.next")}</a> : null}
              </span>
            </nav>
          </>}>
          {/* Over the list only while it has rows; tenders.js keeps it so. */}
          <SegmentNote lang={lang} rows={first.rows} id="tender-note" hidden={empty} />
          <div class="results" id="tender-results" data-page-size={String(TENDER_PAGE_SIZE)} data-lang={lang}>
            <div id="tender-table">
              {waiting ? (
                <>
                  <p class="muted">{t(lang, "tenders.waiting")}</p>
                  <noscript>
                    <p>{tj(lang, "tenders.noscript", { link: <a href="/tenders">{t(lang, "tenders.noscript_link")}</a> })}</p>
                  </noscript>
                </>
              ) : shown.length ? (
                <TenderTable lang={lang} rows={shown} clock={clock} selectable note={false} timeLeft={soonestClosing(q)} sorts={sorts} />
              ) : (
                <NoMatch lang={lang} q={q.q} />
              )}
            </div>
          </div>
        </Panel>
        <aside class="panel detail" id="tender-detail" aria-label={t(lang, "tenders.detail_heading")}>
          <div class="panel-head">
            <h2>{t(lang, "tenders.detail_heading")}</h2>
          </div>
          <div class="detail-body" id="tender-detail-body" aria-live="polite">
            <p class="muted">{t(lang, "tenders.detail_empty")}</p>
          </div>
        </aside>
      </div>
      <InterestPanel lang={lang} filter={interest} />
      <ClientData id="i18n" data={{
        lang, locale: numberLocale(lang), strings: clientStrings(lang, TENDERS_CLIENT_KEYS), labels,
        table: clientTable(tenderColumns(lang, { closing: { key: "closing" }, published: { key: "published" } }), "t-tenders", "server"),
      }} />
      <SortsHere />
      <CountdownScript lang={lang} />
      <script type="module" src="/tenders.js"></script>
      <script src="/pager.js" defer></script>
    </Layout>,
  );
}

// How many days /tenders/new offers: the pipeline keeps 30 day files.
export const NEW_DAYS = 30;

export async function newTendersPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "tenders.new_title");
  const latest = todayOf(stats.data_as_of);
  const days = Array.from({ length: NEW_DAYS }, (_, i) => addDays(latest, -i));
  const asked = c.req.query("day") ?? "";
  const day = DAY_RE.test(asked) && days.includes(asked) ? asked : latest;
  // A notice whose closing has passed ("closed" in the file, or still "open"
  // with a closing time now past) goes last.
  const loaded = await loadNewTenders(c.env, day);
  const clock = clockOf(c.env);
  const passed = (r: TenderRow) => r.status === "closed" || (r.status === "open" && closingPassed(r.closing, clock));
  const rows = loaded ? [...loaded.filter((r) => !passed(r)), ...loaded.filter(passed)] : null;
  // The same-day notices for a paid request, on the newest day's view only;
  // a notice of the band that the day's list holds too carries its mark there.
  const intraday = day === latest ? await sameDayView(c, stats.data_as_of, clock) : null;
  const sameDay = await sameDayNoted(c);
  const title = t(lang, "tenders.new_title");
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "tenders.title"), path: "/tenders" }, { name: title }];
  // Day views other than the newest are views of the same page.
  const seo = pageSeo("tenders_new", lang, day === latest ? {} : { noindex: true });
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/tenders" seo={seo} head={<FeedLinks lang={lang} />}>
      <PageHead lang={lang} title={title} crumbs={crumbs} lead={t(lang, "tenders.new_lead", { days: NEW_DAYS })}
        actions={<a href={`/data/${nationalFeedPath("tenders")}`} class="btn">{t(lang, "feeds.button_tenders")}</a>}>
        {sameDay ? <SameDayNote lang={lang} /> : null}
      </PageHead>
      <nav class="toolbar" aria-label={t(lang, "tenders.new_days")}>
        <span class="toolbar-label">{t(lang, "tenders.new_days")}</span>
        <ul class="quick-links day-list">
          {days.map((d) => (
            <li>
              {d === day ? <span aria-current="page" class="mono">{d}</span> : <a class="mono" href={d === latest ? "/tenders/new" : `/tenders/new?day=${d}`}>{d}</a>}
            </li>
          ))}
        </ul>
      </nav>
      {intraday?.band}
      <Panel title={t(lang, "tenders.new_day", { day })}
        count={rows && rows.length ? tn(lang, "tenders.count_one", "tenders.count_many", rows.length, { n: fmtInt(rows.length, lang) }) : undefined}>
        {rows === null ? (
          <p class="muted">{t(lang, "tenders.new_missing")}</p>
        ) : rows.length === 0 ? (
          <p class="muted">{t(lang, "tenders.new_none")}</p>
        ) : (
          <TenderTable lang={lang} rows={rows} clock={clock} status marked={intraday?.marked} />
        )}
      </Panel>
      {/* The same-day band marks its closing-soon rows too, so with a band the countdown runs whatever the day's list holds. */}
      {intraday || rows?.some((r) => tenderState(r.status ?? "open", r.closing, clock) === "closing") ? <CountdownScript lang={lang} /> : null}
    </Layout>,
  );
}
