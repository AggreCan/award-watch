// /tenders: every open notice, filtered and sorted. The server renders the
// view the URL asks for (the first 50 rows by closing date when it asks for
// nothing), so a filtered view is a link that works without JavaScript; the
// form is a plain GET form. public/tenders.js then fetches the same file
// once and answers every later change in memory, writing the state back
// into the URL. The filter rules are written twice (here and in the script)
// and the tests hold them to the same answers.
//
// /tenders/new: the notices first seen on one day, from tenders/new/<day>.json,
// the newest day by default and any of the last 30 on request.

import type { Context } from "hono";
import { CATEGORIES, CLOSING_SOON_DAYS, PROVINCES, SEGMENTS } from "../constants";
import { BUYER_ID_RE, DAY_RE, loadNewTenders, loadOpenTenders, loadStats, type TenderRow } from "../data";
import type { AppEnv } from "../env";
import {
  categoryLabel, clientStrings, fmtInt, numberLocale, pick, provinceName, segmentLabel, t, tn, type Key, type Lang,
} from "../i18n";
import { Breadcrumb, ClientData, Layout, addDays, noDataPage, page, todayOf } from "../layout";
import { pageSeo } from "../seo";
import { FeedLinks } from "./feeds";
import { TenderTable } from "./shared";

export const TENDER_PAGE_SIZE = 50;
export const CLOSING_WINDOWS = ["7", "30"] as const;

export interface TenderQuery {
  q: string;
  category: string;
  segment: string;
  province: string;
  buyer: string;
  type: string;
  method: string;
  closing: string;
  sort: "closing" | "published";
  page: number;
}

const MAX_TEXT = 100;

// The query as the form and the script write it. A value the filter cannot
// use reads as no filter, so a stale or hand-typed link still opens a page.
export function readTenderQuery(url: URL): TenderQuery {
  const get = (k: string) => (url.searchParams.get(k) ?? "").trim();
  const category = get("category").toUpperCase();
  const segment = get("segment");
  const province = get("province").toUpperCase();
  const buyer = get("buyer").toLowerCase();
  const closing = get("closing");
  const pageNo = Number(get("page"));
  return {
    q: get("q").slice(0, MAX_TEXT),
    category: (CATEGORIES as readonly string[]).includes(category) ? category : "",
    segment: segment in SEGMENTS ? segment : "",
    province: (PROVINCES as readonly string[]).includes(province) ? province : "",
    buyer: BUYER_ID_RE.test(buyer) && buyer.length <= 80 ? buyer : "",
    type: get("type").slice(0, 200),
    method: get("method").slice(0, 200),
    closing: (CLOSING_WINDOWS as readonly string[]).includes(closing) ? closing : "",
    sort: get("sort") === "published" ? "published" : "closing",
    page: Number.isInteger(pageNo) && pageNo >= 1 && pageNo <= 10_000 ? pageNo : 1,
  };
}

// Lower case with accents removed, so "evaluation" finds "Évaluation".
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
}

// The rows that pass every filter, in the order asked for. The text filter
// reads the title in both languages and the reference.
export function filterTenders(rows: readonly TenderRow[], q: TenderQuery, today: string): TenderRow[] {
  const words = fold(q.q).split(/\s+/).filter(Boolean);
  const until = q.closing ? addDays(today, Number(q.closing)) : "";
  const out = rows.filter((r) => {
    if (q.category && !r.category.includes(q.category)) return false;
    if (q.segment && !r.segments.includes(q.segment)) return false;
    if (q.province && !r.provinces.includes(q.province)) return false;
    if (q.buyer && r.buyer_id !== q.buyer) return false;
    if (q.type && r.notice_type_en !== q.type) return false;
    if (q.method && r.method_en !== q.method) return false;
    if (until) {
      const day = (r.closing ?? "").slice(0, 10);
      if (!day || day < today || day > until) return false;
    }
    if (words.length) {
      const text = fold(`${r.title_en ?? ""} ${r.title_fr ?? ""} ${r.reference}`);
      if (!words.every((w) => text.includes(w))) return false;
    }
    return true;
  });
  // Ties fall back to the reference so the order never depends on the file's.
  const byRef = (a: TenderRow, b: TenderRow) => (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0);
  if (q.sort === "published") {
    out.sort((a, b) => (a.published ?? "") < (b.published ?? "") ? 1 : (a.published ?? "") > (b.published ?? "") ? -1 : byRef(a, b));
  } else {
    // Soonest first; a notice with no closing date goes last.
    out.sort((a, b) => {
      const x = a.closing ?? "\uffff";
      const y = b.closing ?? "\uffff";
      return x < y ? -1 : x > y ? 1 : byRef(a, b);
    });
  }
  return out;
}

// The URL of a view: only the values set, in a fixed order.
export function tenderQueryString(q: TenderQuery, pageNo = q.page): string {
  const p = new URLSearchParams();
  for (const k of ["q", "category", "segment", "province", "buyer", "type", "method", "closing"] as const) if (q[k]) p.set(k, q[k]);
  if (q.sort !== "closing") p.set("sort", q.sort);
  if (pageNo > 1) p.set("page", String(pageNo));
  const s = p.toString();
  return s ? `?${s}` : "";
}

type Option = { value: string; label: string; n: number };

// Each select lists the values the open notices carry, with their counts, so
// no choice leads to an empty list.
function options(rows: readonly TenderRow[], lang: Lang) {
  const count = (values: (r: TenderRow) => (string | null)[], label: (v: string, r: TenderRow) => string) => {
    const seen = new Map<string, Option>();
    for (const r of rows) {
      for (const v of new Set(values(r))) {
        if (!v) continue;
        const o = seen.get(v);
        if (o) o.n += 1;
        else seen.set(v, { value: v, label: label(v, r), n: 1 });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, numberLocale(lang)));
  };
  return {
    category: count((r) => r.category, (v) => categoryLabel(lang, v)),
    segment: count((r) => r.segments, (v) => `${v} ${segmentLabel(lang, v)}`).sort((a, b) => a.value.localeCompare(b.value)),
    province: count((r) => r.provinces, (v) => provinceName(lang, v)),
    buyer: count((r) => [r.buyer_id], (_v, r) => pick(lang, r.buyer_en, r.buyer_fr) ?? r.buyer_id ?? ""),
    type: count((r) => [r.notice_type_en], (_v, r) => pick(lang, r.notice_type_en, r.notice_type_fr) ?? ""),
    method: count((r) => [r.method_en], (_v, r) => pick(lang, r.method_en, r.method_fr) ?? ""),
  };
}

// Every string tenders.js draws, handed over in the page's JSON block.
export const TENDERS_CLIENT_KEYS: readonly Key[] = [
  "col.notice", "col.buyer", "col.closing", "col.published", "col.region", "common.national", "common.not_stated",
  "status.open", "status.closing", "tenders.count_one", "tenders.count_many", "tenders.none_match", "tenders.page_of",
  "tenders.prev", "tenders.next", "tenders.load_failed", "tenders.loading",
];

const Select = ({ name, label, any, opts, value, lang }: {
  name: string; label: Key; any: Key; opts: Option[]; value: string; lang: Lang;
}) => (
  <label>
    {t(lang, label)}
    <select name={name}>
      <option value="">{t(lang, any)}</option>
      {opts.map((o) => (
        <option value={o.value} selected={o.value === value}>{`${o.label} (${fmtInt(o.n, lang)})`}</option>
      ))}
    </select>
  </label>
);

export async function tendersPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const rows = stats ? await loadOpenTenders(c.env) : null;
  if (!stats || !rows) return noDataPage(c, "tenders.title");
  const today = todayOf(stats.data_as_of);
  const q = readTenderQuery(new URL(c.req.url));
  const matched = filterTenders(rows, q, today);
  const pages = Math.max(1, Math.ceil(matched.length / TENDER_PAGE_SIZE));
  const pageNo = Math.min(q.page, pages);
  const shown = matched.slice((pageNo - 1) * TENDER_PAGE_SIZE, pageNo * TENDER_PAGE_SIZE);
  const opts = options(rows, lang);
  const filtered = tenderQueryString({ ...q, page: 1 }) !== "";
  // The canonical page is the unfiltered list; a filtered view is a view of it.
  const seo = pageSeo("tenders", lang, filtered ? { noindex: true } : {});
  const prev = pageNo > 1 ? `/tenders${tenderQueryString(q, pageNo - 1)}` : null;
  const next = pageNo < pages ? `/tenders${tenderQueryString(q, pageNo + 1)}` : null;
  const labels = {
    segments: Object.fromEntries(opts.segment.map((o) => [o.value, segmentLabel(lang, o.value)])),
    provinces: Object.fromEntries([...PROVINCES, "XX", "UN"].map((p) => [p, provinceName(lang, p)])),
  };

  return page(
    c,
    <Layout lang={lang} title={t(lang, "tenders.title")} dataAsOf={stats.data_as_of} active="/tenders" seo={seo}
      head={<FeedLinks lang={lang} />}>
      <h1>{t(lang, "tenders.title")}</h1>
      <p class="lead">{t(lang, "tenders.lead", { n: fmtInt(rows.length, lang) })}</p>
      <p class="muted small">{t(lang, "tenders.contact_note")}</p>
      <div class="list-layout">
        <form method="get" action="/tenders" class="filters stack" id="tender-filters">
          <label>
            {t(lang, "tenders.filter_text")}
            <input type="search" name="q" value={q.q} maxlength={MAX_TEXT} autocomplete="off" />
          </label>
          <Select name="category" label="tenders.filter_category" any="tenders.any" opts={opts.category} value={q.category} lang={lang} />
          <Select name="segment" label="tenders.filter_segment" any="tenders.any" opts={opts.segment} value={q.segment} lang={lang} />
          <Select name="province" label="tenders.filter_province" any="tenders.any" opts={opts.province} value={q.province} lang={lang} />
          <Select name="buyer" label="tenders.filter_buyer" any="tenders.any" opts={opts.buyer} value={q.buyer} lang={lang} />
          <Select name="type" label="tenders.filter_type" any="tenders.any" opts={opts.type} value={q.type} lang={lang} />
          <Select name="method" label="tenders.filter_method" any="tenders.any" opts={opts.method} value={q.method} lang={lang} />
          <label>
            {t(lang, "tenders.filter_closing")}
            <select name="closing">
              <option value="">{t(lang, "tenders.closing_any")}</option>
              <option value="7" selected={q.closing === "7"}>{t(lang, "tenders.closing_days", { n: CLOSING_SOON_DAYS })}</option>
              <option value="30" selected={q.closing === "30"}>{t(lang, "tenders.closing_days", { n: 30 })}</option>
            </select>
          </label>
          <label>
            {t(lang, "tenders.sort")}
            <select name="sort">
              <option value="closing">{t(lang, "tenders.sort_closing")}</option>
              <option value="published" selected={q.sort === "published"}>{t(lang, "tenders.sort_published")}</option>
            </select>
          </label>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" id="tender-apply">{t(lang, "tenders.apply")}</button>
            <a href="/tenders" class="btn">{t(lang, "tenders.reset")}</a>
          </div>
        </form>
        <div class="results" id="tender-results" data-today={today} data-page-size={String(TENDER_PAGE_SIZE)}>
          <p id="tender-count" aria-live="polite">
            {tn(lang, "tenders.count_one", "tenders.count_many", matched.length, { n: fmtInt(matched.length, lang) })}
          </p>
          <div id="tender-table">
            {shown.length ? <TenderTable lang={lang} rows={shown} today={today} /> : <p class="muted">{t(lang, "tenders.none_match")}</p>}
          </div>
          <nav aria-label={t(lang, "common.pagination")} class="pagination" id="tender-pager">
            <span class="muted">{t(lang, "tenders.page_of", { page: fmtInt(pageNo, lang), pages: fmtInt(pages, lang) })}</span>
            <span class="pages">
              {prev ? <a href={prev} class="btn" rel="prev">{t(lang, "tenders.prev")}</a> : null}
              {next ? <a href={next} class="btn" rel="next">{t(lang, "tenders.next")}</a> : null}
            </span>
          </nav>
        </div>
      </div>
      <ClientData id="i18n" data={{ lang, locale: numberLocale(lang), strings: clientStrings(lang, TENDERS_CLIENT_KEYS), labels }} />
      <script src="/tenders.js" defer></script>
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
  const rows = await loadNewTenders(c.env, day);
  const title = t(lang, "tenders.new_title");
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "tenders.title"), path: "/tenders" }, { name: title }];
  // Day views other than the newest are views of the same page.
  const seo = pageSeo("tenders_new", lang, day === latest ? {} : { noindex: true });
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/tenders" seo={seo} head={<FeedLinks lang={lang} />}>
      <Breadcrumb lang={lang} crumbs={crumbs} />
      <h1>{title}</h1>
      <p class="lead">{t(lang, "tenders.new_lead", { days: NEW_DAYS })}</p>
      <div class="list-layout">
        <nav class="filters" aria-label={t(lang, "tenders.new_days")}>
          <span class="filters-title">{t(lang, "tenders.new_days")}</span>
          <ul class="day-list">
            {days.map((d) => (
              <li>
                {d === day ? <span aria-current="page" class="mono">{d}</span> : <a class="mono" href={d === latest ? "/tenders/new" : `/tenders/new?day=${d}`}>{d}</a>}
              </li>
            ))}
          </ul>
        </nav>
        <div class="results">
          <h2>{t(lang, "tenders.new_day", { day })}</h2>
          {rows === null ? (
            <p class="muted">{t(lang, "tenders.new_missing")}</p>
          ) : rows.length === 0 ? (
            <p class="muted">{t(lang, "tenders.new_none")}</p>
          ) : (
            <>
              <p>{tn(lang, "tenders.count_one", "tenders.count_many", rows.length, { n: fmtInt(rows.length, lang) })}</p>
              <TenderTable lang={lang} rows={rows} today={latest} status />
            </>
          )}
        </div>
      </div>
    </Layout>,
  );
}
