// /awards: the newest award notices (awards/recent.json), 100 to a page.
// /awards/:year: one calendar year of award notices by award date, read one
// page at a time (awards/<year>/<n>.json, 500 rows each, newest first), with
// awards/<year>/index.json for the page count, so no request parses a whole
// year.

import type { Context } from "hono";
import { FIRST_AWARD_YEAR } from "../constants";
import { YEAR_RE, loadAwardPage, loadAwardYear, loadRecentAwards, loadStats, type AwardRow } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, t, tn } from "../i18n";
import { Layout, PageHead, Panel, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { canonicalUrl, pageSeo, sectionSeo } from "../seo";
import { FeedLinks, nationalFeedPath } from "./feeds";
import { AwardTable, SourceLine } from "./shared";

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

function pager(base: string, n: number, pages: number, lang: "en" | "fr") {
  const prev = n > 1 ? (n === 2 ? base : `${base}?page=${n - 1}`) : null;
  const next = n < pages ? `${base}?page=${n + 1}` : null;
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
  const sorted = newestFirst(rows);
  const pages = Math.max(1, Math.ceil(sorted.length / AWARD_PAGE_SIZE));
  const n = Math.min(pageOf(c) ?? 1, pages);
  const shown = sorted.slice((n - 1) * AWARD_PAGE_SIZE, n * AWARD_PAGE_SIZE);
  const today = todayOf(stats.data_as_of);
  const year = today.slice(0, 4);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "awards.title")} dataAsOf={stats.data_as_of} active="/awards"
      seo={pageSeo("awards", lang, c.req.query("page") !== undefined ? { noindex: true } : {})} head={<FeedLinks lang={lang} />}>
      <PageHead lang={lang} title={t(lang, "awards.title")} lead={t(lang, "awards.lead", { n: fmtInt(rows.length, lang) })}
        actions={<>
          <a href={`/downloads/awards-${year}.csv`} class="btn">{t(lang, "awards.download", { year })}</a>
          <a href={`/data/${nationalFeedPath("awards")}`} class="btn">{t(lang, "feeds.button_awards")}</a>
        </>}>
        <p class="page-note">{t(lang, "awards.value_note")}{lateDates(sorted, today) ? ` ${t(lang, "common.dates_as_published")}` : ""}</p>
      </PageHead>
      <YearLinks years={awardYears(stats.data_as_of)} current={null} lang={lang} />
      <Panel title={t(lang, "awards.recent")} count={fmtInt(rows.length, lang)}
        foot={<>{pager("/awards", n, pages, lang)}<SourceLine lang={lang} source="awards" /></>}>
        {shown.length ? <AwardTable lang={lang} rows={shown} /> : <p class="muted">{t(lang, "awards.none")}</p>}
      </Panel>
    </Layout>,
  );
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
  if (n === null || (n > 1 && n > idx.pages)) return notFoundPage(c, stats.data_as_of, "awards.page_not_found", path, "awards.back_year");
  const rows = idx.pages === 0 ? [] : await loadAwardPage(c.env, year, n);
  if (!rows) return noDataPage(c, "awards.title");
  const shown = newestFirst(rows);
  const pages = Math.max(1, idx.pages);
  const title = t(lang, "awards.year_title", { year });
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "awards.title"), path: "/awards" }, { name: String(year) }];
  const prev = n > 1 ? canonicalUrl(n === 2 ? path : `${path}?page=${n - 1}`, lang) : null;
  const next = n < pages ? canonicalUrl(`${path}?page=${n + 1}`, lang) : null;
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/awards"
      seo={sectionSeo(path, title, t(lang, "awards.year_description", { year, n: fmtInt(idx.rows, lang) }), crumbs, c.req.query("page") !== undefined)}
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
        foot={<>{pager(path, n, pages, lang)}<SourceLine lang={lang} source="awards" /></>}>
        {shown.length ? <AwardTable lang={lang} rows={shown} /> : <p class="muted">{t(lang, "awards.none")}</p>}
      </Panel>
    </Layout>,
  );
}
