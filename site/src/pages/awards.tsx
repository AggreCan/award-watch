// /awards: the newest award notices (awards/recent.json), 100 to a page,
// newest first or as the Awarded and Value heads order the whole list.
// /awards/:year: one calendar year of award notices by award date, read one
// page at a time (awards/<year>/<n>.json, 500 rows each, newest first), with
// awards/<year>/index.json for the page count, so no request parses a whole
// year. The Awarded and Value heads order it (?sort=) through a second copy
// ordered by value (awards/<year>/value/<n>.json), one file a page.
// /awards/erroneous: the notices whose award date falls after the data date
// (awards/erroneous.json), which the newest lists leave out.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { FIRST_AWARD_YEAR } from "../constants";
import {
  YEAR_RE, loadAwardPage, loadAwardYear, loadErroneousAwards, loadRecentAwards, loadStats, publishedReference, type AwardRow,
  type AwardYear,
} from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, t, tn, type Lang } from "../i18n";
import { Table, type SortOrders, headSort } from "../columns";
import { Layout, PageHead, Panel, StatusBadge, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { breadcrumbJsonLd, canonicalUrl, pageSeo, sectionSeo } from "../seo";
import { FeedLinks, nationalFeedPath } from "./feeds";
import { AwardTable, BuyerLink, SourceLine, awardNoticeUrl, money } from "./shared";

export const AWARD_PAGE_SIZE = 100;

// The page a ?page= query asks for: 1 when there is none, null when it is not
// a page number.
function pageOf(c: Context<AppEnv>): number | null {
  const raw = c.req.query("page");
  if (raw === undefined) return 1;
  const n = Number(raw);
  return /^[0-9]{1,6}$/.test(raw) && n >= 1 ? n : null;
}

// Newest award date first; the reference breaks ties so the order never
// depends on the file's.
export function newestFirst(rows: readonly AwardRow[]): AwardRow[] {
  return [...rows].sort((a, b) => {
    const x = a.awarded ?? "";
    const y = b.awarded ?? "";
    return x < y ? 1 : x > y ? -1 : a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0;
  });
}

// The orders of the newest awards (/awards), which the Awarded and Value
// heads set: the value in the address, the column, the direction. "" (no
// order asked) is the newest first.
export const AWARD_ORDERS = [
  ["oldest", "awarded", "asc"], ["newest", "awarded", "desc"], ["smallest", "value", "asc"], ["largest", "value", "desc"],
] as const satisfies SortOrders;
export type AwardOrder = "" | (typeof AWARD_ORDERS)[number][0];

export function readAwardOrder(raw: string | undefined): AwardOrder {
  return AWARD_ORDERS.find((o) => o[0] === raw)?.[0] ?? "";
}

// The list in an order. A row with no date, or no amount in Canadian dollars
// (the radar's rule), goes last either way; the newest first breaks ties.
export function orderAwards(rows: readonly AwardRow[], order: AwardOrder): AwardRow[] {
  const newest = newestFirst(rows);
  if (order === "" || order === "newest") return newest;
  const at = new Map(newest.map((r, i) => [r, i]));
  const key = (r: AwardRow): string | number | null => {
    if (order === "oldest") return r.awarded || null;
    const currency = (r.currency ?? "").trim().toUpperCase();
    return r.value === null || (currency && currency !== "CAD") ? null : r.value;
  };
  const up = order === "largest" ? -1 : 1;
  return [...newest].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === y) return at.get(a)! - at.get(b)!;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : 1) * up;
  });
}

// Whether any row is dated after the data date (the source's own dates).
function lateDates(rows: readonly AwardRow[], today: string): boolean {
  return rows.some((r) => (r.awarded ?? "").slice(0, 10) > today);
}

export function awardYears(dataAsOf: string | null): number[] {
  const last = Number(todayOf(dataAsOf).slice(0, 4));
  const out: number[] = [];
  for (let y = last; y >= FIRST_AWARD_YEAR; y--) out.push(y);
  return out;
}

const YearLinks = ({ years, current, lang }: { years: number[]; current: number | null; lang: "en" | "fr" }) => (
  <nav aria-label={t(lang, "awards.years")} class="toolbar">
    <span class="toolbar-label">{t(lang, "awards.years")}</span>
    <ul class="quick-links">
      <li>{current === null ? <span aria-current="page">{t(lang, "awards.recent")}</span> : <a href="/awards">{t(lang, "awards.recent")}</a>}</li>
      {years.map((y) => (
        <li>{y === current ? <span aria-current="page" class="mono">{y}</span> : <a class="mono" href={`/awards/${y}`}>{y}</a>}</li>
      ))}
    </ul>
  </nav>
);

// A page's address: the order kept (on /awards), page 1 without its number.
export function awardsQuery(order: AwardOrder, n: number): string {
  const p = new URLSearchParams();
  if (order) p.set("sort", order);
  if (n > 1) p.set("page", String(n));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function pager(base: string, n: number, pages: number, lang: "en" | "fr", order: AwardOrder = "") {
  const prev = n > 1 ? `${base}${awardsQuery(order, n - 1)}` : null;
  const next = n < pages ? `${base}${awardsQuery(order, n + 1)}` : null;
  return (
    <nav aria-label={t(lang, "common.pagination")} class="pagination">
      <span class="muted">{t(lang, "tenders.page_of", { page: fmtInt(n, lang), pages: fmtInt(pages, lang) })}</span>
      <span class="pages">
        {prev ? <a href={prev} class="btn" rel="prev">{t(lang, "tenders.prev")}</a> : null}
        {next ? <a href={next} class="btn" rel="next">{t(lang, "tenders.next")}</a> : null}
      </span>
    </nav>
  );
}

export async function awardsPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const rows = stats ? await loadRecentAwards(c.env) : null;
  if (!stats || !rows) return noDataPage(c, "awards.title");
  // The whole list is in memory, so the heads order all of it, then it is paged.
  const order = readAwardOrder(c.req.query("sort"));
  const sorted = orderAwards(rows, order);
  const pages = Math.max(1, Math.ceil(sorted.length / AWARD_PAGE_SIZE));
  const n = Math.min(pageOf(c) ?? 1, pages);
  const shown = sorted.slice((n - 1) * AWARD_PAGE_SIZE, n * AWARD_PAGE_SIZE);
  const today = todayOf(stats.data_as_of);
  const year = today.slice(0, 4);
  const sortHref = (v: string) => `/awards${awardsQuery(v as AwardOrder, 1)}`;
  const sorts = { awarded: headSort(AWARD_ORDERS, order, "awarded", sortHref), value: headSort(AWARD_ORDERS, order, "value", sortHref) };
  // The notices dated after the data date, which this list leaves out (absent from older exports: no line).
  const erroneous = stats.counts.awards_erroneous ?? 0;
  return page(
    c,
    <Layout lang={lang} title={t(lang, "awards.title")} dataAsOf={stats.data_as_of} active="/awards"
      seo={pageSeo("awards", lang, c.req.query("page") !== undefined || order ? { noindex: true } : {})} head={<FeedLinks lang={lang} />}>
      <PageHead lang={lang} title={t(lang, "awards.title")} lead={t(lang, "awards.lead", { n: fmtInt(rows.length, lang) })}
        actions={<>
          <a href={`/downloads/awards-${year}.csv`} class="btn">{t(lang, "awards.download", { year })}</a>
          <a href={`/data/${nationalFeedPath("awards")}`} class="btn">{t(lang, "feeds.button_awards")}</a>
        </>}>
        <p class="page-note">
          {t(lang, "awards.value_note")}{lateDates(sorted, today) ? ` ${t(lang, "common.dates_as_published")}` : ""}
          {erroneous > 0 ? (
            <> <a href="/awards/erroneous">{tn(lang, "erroneous.note_one", "erroneous.note_many", erroneous, { n: fmtInt(erroneous, lang) })}</a></>
          ) : null}
        </p>
      </PageHead>
      <YearLinks years={awardYears(stats.data_as_of)} current={null} lang={lang} />
      <Panel title={t(lang, "awards.recent")} count={fmtInt(rows.length, lang)}
        foot={<>{pager("/awards", n, pages, lang, order)}<SourceLine lang={lang} source="awards" /></>}>
        {shown.length ? <AwardTable lang={lang} rows={shown} sorting="server" sorts={sorts} /> : <p class="muted">{t(lang, "awards.none")}</p>}
      </Panel>
    </Layout>,
  );
}

// The order a year's ?sort= asks for: none (""), one of /awards's orders, or
// null for anything else, which answers 404 as a page number that is not
// one does.
export function readYearOrder(raw: string | undefined): AwardOrder | null {
  if (raw === undefined) return "";
  return AWARD_ORDERS.find((o) => o[0] === raw)?.[0] ?? null;
}

// The pages of a year in an order, or null when the order needs the value
// set and the export has none. The value set can hold one file more than the
// date set: its rows without a value start a file of their own.
export function yearPages(idx: AwardYear, order: AwardOrder): number | null {
  if (order === "largest" || order === "smallest") return idx.value_pages ?? null;
  return idx.pages;
}

// The file page n of an order reads, and whether its rows run backwards. The
// pipeline writes a year twice, newest award date first and largest value
// first (the rows without a value in the files after the first
// valued_pages), so one file makes one page in every order: the oldest are the
// date set read from its last file backwards; the smallest are the valued
// files read the same way, then the files without a value as they stand, so
// those rows stay last whichever way the values run.
export function yearPageFile(idx: AwardYear, order: AwardOrder, n: number): { set: "date" | "value"; file: number; reverse: boolean } {
  if (order === "oldest") return { set: "date", file: idx.pages - n + 1, reverse: true };
  if (order === "largest") return { set: "value", file: n, reverse: false };
  if (order === "smallest") {
    const valued = idx.valued_pages ?? 0;
    return n <= valued ? { set: "value", file: valued - n + 1, reverse: true } : { set: "value", file: n, reverse: false };
  }
  return { set: "date", file: n, reverse: false };
}

export async function awardsYearPage(c: Context<AppEnv>, raw: string): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "awards.title");
  const years = awardYears(stats.data_as_of);
  const year = YEAR_RE.test(raw) ? Number(raw) : NaN;
  if (!years.includes(year)) return notFoundPage(c, stats.data_as_of, "awards.year_not_found", "/awards", "awards.back");
  const idx = await loadAwardYear(c.env, year);
  if (!idx) return noDataPage(c, "awards.title");
  const path = `/awards/${year}`;
  const n = pageOf(c);
  const order = readYearOrder(c.req.query("sort"));
  const count = order === null ? null : yearPages(idx, order);
  if (n === null || order === null || count === null || (n > 1 && n > count)) {
    return notFoundPage(c, stats.data_as_of, "awards.page_not_found", path, "awards.back_year");
  }
  const at = yearPageFile(idx, order, n);
  const read = count === 0 ? [] : await loadAwardPage(c.env, year, at.file, at.set);
  if (!read) return noDataPage(c, "awards.title");
  // A file of the order is the page already; newest first only reorders the
  // plain view's ties as the list always has.
  const shown = order === "" ? newestFirst(read) : at.reverse ? [...read].reverse() : [...read];
  const pages = Math.max(1, count);
  const title = t(lang, "awards.year_title", { year });
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "awards.title"), path: "/awards" }, { name: String(year) }];
  // Only the plain view's pages are a series for search engines; a sorted view is noindex.
  const prev = order === "" && n > 1 ? canonicalUrl(n === 2 ? path : `${path}?page=${n - 1}`, lang) : null;
  const next = order === "" && n < pages ? canonicalUrl(`${path}?page=${n + 1}`, lang) : null;
  const sortHref = (v: string) => `${path}${awardsQuery(v as AwardOrder, 1)}`;
  // The Value head links only where the export wrote the value set.
  const sorts = {
    awarded: headSort(AWARD_ORDERS, order, "awarded", sortHref),
    value: idx.value_pages === undefined ? {} : headSort(AWARD_ORDERS, order, "value", sortHref),
  };
  const noindex = c.req.query("page") !== undefined || c.req.query("sort") !== undefined;
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/awards"
      seo={sectionSeo(path, title, t(lang, "awards.year_description", { year, n: fmtInt(idx.rows, lang) }), crumbs, noindex)}
      head={<>{prev ? <link rel="prev" href={prev} /> : null}{next ? <link rel="next" href={next} /> : null}</>}>
      <PageHead lang={lang} crumbs={crumbs} title={title}
        lead={tn(lang, "awards.year_count_one", "awards.year_count_many", idx.rows, { n: fmtInt(idx.rows, lang), year })}
        actions={<a href={`/downloads/awards-${year}.csv`} class="btn">{t(lang, "awards.download", { year })}</a>}>
        <p class="page-note">
          {t(lang, "awards.value_note")}{lateDates(shown, todayOf(stats.data_as_of)) ? ` ${t(lang, "common.dates_as_published")}` : ""}
        </p>
      </PageHead>
      <YearLinks years={years} current={year} lang={lang} />
      <Panel title={t(lang, "awards.year_panel", { year })} count={fmtInt(idx.rows, lang)}
        foot={<>{pager(path, n, pages, lang, order)}<SourceLine lang={lang} source="awards" /></>}>
        {/* A year is read one file of 500 at a time, so the Awarded and Value heads order the whole year
            through the export's two orders of it (yearPageFile); the others stay plain. */}
        {shown.length ? <AwardTable lang={lang} rows={shown} sorting="server" sorts={sorts} /> : <p class="muted">{t(lang, "awards.none")}</p>}
      </Panel>
    </Layout>,
  );
}

// The notices dated after the data date, each with the dates its award date
// is read against: the publication date, and the contract's start and end.
// Every row is on the page, so any head sorts it in the browser. The buyer
// and start rest below 1280 px and the record link below 1440 px; the
// title opens the site's page of the notice, which links it too.
const ErroneousTable: FC<{ lang: Lang; rows: readonly AwardRow[] }> = ({ lang, rows }) => (
  <div class="table-wrap bordered">
    <Table sorting="client" cols={[
      { kind: "main", label: t(lang, "col.notice") },
      { kind: "buyer", label: t(lang, "col.buyer"), rest: "md" },
      { kind: "date", label: t(lang, "col.published") },
      { kind: "date", label: t(lang, "erroneous.col_awarded") },
      { kind: "date", label: t(lang, "erroneous.col_start"), rest: "md" },
      { kind: "date", label: t(lang, "erroneous.col_end") },
      { kind: "value", label: t(lang, "col.value") },
      { kind: "record", label: t(lang, "col.record"), rest: "lg" },
    ]}>
      <tbody>
        {rows.map((r) => (
          <tr>
            <td data-label={t(lang, "col.notice")} class="lead-cell">
              <a href={`/awards/${r.reference.toLowerCase()}`}>{pick(lang, r.title_en, r.title_fr) ?? publishedReference(r)}</a>
              <br />
              <span class="mono id muted">{publishedReference(r)}</span>
              {r.status === "cancelled" ? <> <StatusBadge lang={lang} status="cancelled" /></> : null}
            </td>
            <td data-label={t(lang, "col.buyer")} class="mdh"><BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} /></td>
            <td data-label={t(lang, "col.published")} class="mono">{r.published ?? ""}</td>
            <td data-label={t(lang, "erroneous.col_awarded")} class="mono">{r.awarded ?? ""}</td>
            <td data-label={t(lang, "erroneous.col_start")} class="mono mdh">{r.start ?? ""}</td>
            <td data-label={t(lang, "erroneous.col_end")} class="mono">{r.end ?? ""}</td>
            <td data-label={t(lang, "col.value")} class="mono num">{money(lang, r.value, r.currency)}</td>
            <td data-label={t(lang, "col.record")} class="lgh">
              <a href={awardNoticeUrl(publishedReference(r), lang)} rel="noopener">{t(lang, "expiring.record_award")}</a>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  </div>
);

export async function erroneousAwardsPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "erroneous.title");
  // An export from before the file existed carries no count: the page then
  // lists none rather than failing, until the next nightly writes the file.
  const rows = (await loadErroneousAwards(c.env)) ?? (stats.counts.awards_erroneous === undefined ? [] : null);
  if (!rows) return noDataPage(c, "erroneous.title");
  const title = t(lang, "erroneous.title");
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "awards.title"), path: "/awards" }, { name: title }];
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/awards"
      seo={pageSeo("awards_erroneous", lang, { jsonLd: [breadcrumbJsonLd(crumbs)] })}>
      <PageHead lang={lang} crumbs={crumbs} title={title} lead={t(lang, "erroneous.lead", { date: todayOf(stats.data_as_of) })} />
      <Panel title={t(lang, "erroneous.panel")} count={fmtInt(rows.length, lang)} foot={<SourceLine lang={lang} source="awards" />}>
        {rows.length ? <ErroneousTable lang={lang} rows={rows} /> : <p class="muted">{t(lang, "erroneous.none")}</p>}
      </Panel>
    </Layout>,
  );
}
