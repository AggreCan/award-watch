// /categories: the 57 UNSPSC segments with their open notices and this
// year's award notices (categories/index.json). /categories/:nn: one segment's
// open notices, the organizations with the largest award values in it, and
// its award notices by year. A notice or award counts under every segment
// its codes fall in, so segment figures overlap and are never added up.

import type { Context } from "hono";
import { SEGMENT_CODES } from "../constants";
import { SEGMENT_RE, loadCategories, loadCategory, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, segmentLabel, t } from "../i18n";
import { Breadcrumb, Layout, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { categorySeo, pageSeo } from "../seo";
import { OrgTotalTable, TenderTable, money } from "./shared";

export async function categoriesIndex(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const idx = stats ? await loadCategories(c.env) : null;
  if (!stats || !idx) return noDataPage(c, "categories.title");
  const bySegment = new Map(idx.segments.map((s) => [s.code, s]));
  const n = (v: number) => fmtInt(v, lang);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "categories.title")} dataAsOf={stats.data_as_of} active="/categories" seo={pageSeo("categories", lang)}>
      <h1>{t(lang, "categories.title")}</h1>
      <p class="lead">{t(lang, "categories.lead")}</p>
      <p class="muted small">{t(lang, "categories.overlap")}</p>
      <div class="table-wrap bordered">
        <table class="restack">
          <thead>
            <tr>
              <th>{t(lang, "col.segment")}</th>
              <th class="num">{t(lang, "categories.col_open")}</th>
              <th class="num">{t(lang, "categories.col_year", { year: idx.year })}</th>
              <th class="num">{t(lang, "categories.col_all")}</th>
            </tr>
          </thead>
          <tbody>
            {SEGMENT_CODES.map((code) => {
              const s = bySegment.get(code);
              return (
                <tr>
                  <td data-label={t(lang, "col.segment")}>
                    <span class="mono">{code}</span> <a href={`/categories/${code}`}>{segmentLabel(lang, code)}</a>
                  </td>
                  <td data-label={t(lang, "categories.col_open")} class="mono num">
                    {s && s.open_tenders ? <a href={`/tenders?segment=${code}`}>{n(s.open_tenders)}</a> : "0"}
                  </td>
                  <td data-label={t(lang, "categories.col_year", { year: idx.year })} class="mono num">
                    {n(s?.awards_year_n ?? 0)}
                    {s?.awards_year_total ? <><br /><span class="muted small">{money(lang, s.awards_year_total)}</span></> : null}
                  </td>
                  <td data-label={t(lang, "categories.col_all")} class="mono num">
                    {n(s?.awards_n ?? 0)}
                    {s?.awards_total ? <><br /><span class="muted small">{money(lang, s.awards_total)}</span></> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Layout>,
  );
}

export async function categoryPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const code = c.req.param("nn") ?? "";
  if (!SEGMENT_RE.test(code)) return c.notFound();
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "categories.title");
  if (!SEGMENT_CODES.includes(code)) return notFoundPage(c, stats.data_as_of, "category.not_found", "/categories", "category.back");
  const cat = await loadCategory(c.env, code);
  if (!cat) return noDataPage(c, "categories.title");
  const name = segmentLabel(lang, code);
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "categories.title"), path: "/categories" }, { name: `${code} ${name}` }];
  const years = [...cat.years].sort((a, b) => b.year - a.year);
  const n = (v: number) => fmtInt(v, lang);
  return page(
    c,
    <Layout lang={lang} title={name} dataAsOf={stats.data_as_of} active="/categories" seo={categorySeo(cat, lang, crumbs)}>
      <Breadcrumb lang={lang} crumbs={crumbs} />
      <p class="eyebrow">{t(lang, "category.segment", { code })}</p>
      <h1>{name}</h1>
      <p class="links">
        <a href={`/tenders?segment=${code}`} class="btn btn-primary">{t(lang, "category.all_open", { n: n(cat.open_tenders.length) })}</a>
        <a href={`/data/feeds/segment/${code}/tenders.xml`} class="btn">{t(lang, "category.feed")}</a>
      </p>

      <h2>{t(lang, "category.open")}</h2>
      {cat.open_tenders.length ? (
        <TenderTable lang={lang} rows={cat.open_tenders} today={todayOf(stats.data_as_of)} />
      ) : <p class="muted">{t(lang, "category.open_none")}</p>}

      <h2>{t(lang, "category.top")}</h2>
      <p class="muted small">{t(lang, "category.top_note")}</p>
      {cat.top_organizations.length ? <OrgTotalTable lang={lang} rows={cat.top_organizations} rank /> : <p class="muted">{t(lang, "awards.none")}</p>}

      <h2>{t(lang, "category.years")}</h2>
      {years.length ? (
        <div class="table-wrap bordered narrow">
          <table class="restack">
            <thead>
              <tr>
                <th>{t(lang, "col.year")}</th>
                <th class="num">{t(lang, "col.records")}</th>
                <th class="num">{t(lang, "col.value")}</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr>
                  <td data-label={t(lang, "col.year")} class="mono"><a href={`/awards/${y.year}`}>{y.year}</a></td>
                  <td data-label={t(lang, "col.records")} class="mono num">{n(y.n)}</td>
                  <td data-label={t(lang, "col.value")} class="mono num">{money(lang, y.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p class="muted">{t(lang, "awards.none")}</p>}
    </Layout>,
  );
}
