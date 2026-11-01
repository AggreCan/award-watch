// /categories: the 57 UNSPSC segments with their open notices and this
// year's award notices (categories/index.json). /categories/:nn: one segment's
// open notices, the organizations with the largest award values in it, and
// its award notices by year. A notice or award counts under every segment
// its codes fall in, so segment figures overlap and are never added up.

import type { Context } from "hono";
import { Table } from "../columns";
import { SEGMENT_CODES } from "../constants";
import { SEGMENT_RE, loadCategories, loadCategory, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, segmentLabel, t } from "../i18n";
import { Layout, PageHead, Panel, noDataPage, notFoundPage, page, todayOf } from "../layout";
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
      <PageHead lang={lang} title={t(lang, "categories.title")} lead={t(lang, "categories.lead")}>
        <p class="page-note">{t(lang, "categories.overlap")}</p>
      </PageHead>
      <Panel title={t(lang, "categories.title")} count={fmtInt(SEGMENT_CODES.length, lang)}>
      <div class="table-wrap bordered">
        <Table cols={[
          { kind: "main", label: t(lang, "col.segment") },
          { kind: "count", label: t(lang, "categories.col_open") },
          { kind: "total", label: t(lang, "categories.col_year", { year: idx.year }) },
          { kind: "total", label: t(lang, "categories.col_all") },
        ]}>
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
        </Table>
      </div>
      </Panel>
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
      <PageHead lang={lang} crumbs={crumbs} eyebrow={t(lang, "category.segment", { code })} title={name}
        actions={<>
          <a href={`/tenders?segment=${code}`} class="btn btn-primary">{t(lang, "category.all_open", { n: n(cat.open_tenders.length) })}</a>
          <a href={`/data/feeds/segment/${code}/tenders.xml`} class="btn">{t(lang, "category.feed")}</a>
        </>} />

      <Panel title={t(lang, "category.open")} count={n(cat.open_tenders.length)}>
      {cat.open_tenders.length ? (
        <TenderTable lang={lang} rows={cat.open_tenders} today={todayOf(stats.data_as_of)} />
      ) : <p class="muted">{t(lang, "category.open_none")}</p>}
      </Panel>

      <div class="panel-grid">
      <Panel title={t(lang, "category.top")}>
      <p class="muted small">{t(lang, "category.top_note")}</p>
      {cat.top_organizations.length ? <OrgTotalTable lang={lang} rows={cat.top_organizations} rank /> : <p class="muted">{t(lang, "awards.none")}</p>}
      </Panel>

      <Panel title={t(lang, "category.years")}>
      {years.length ? (
        <div class="table-wrap bordered narrow">
          <Table cols={[
            { kind: "main", label: t(lang, "col.year") },
            { kind: "count", label: t(lang, "col.records") },
            { kind: "total", label: t(lang, "col.value") },
          ]}>
            <tbody>
              {years.map((y) => (
                <tr>
                  <td data-label={t(lang, "col.year")} class="mono"><a href={`/awards/${y.year}`}>{y.year}</a></td>
                  <td data-label={t(lang, "col.records")} class="mono num">{n(y.n)}</td>
                  <td data-label={t(lang, "col.value")} class="mono num">{money(lang, y.total)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : <p class="muted">{t(lang, "awards.none")}</p>}
      </Panel>
      </div>
    </Layout>,
  );
}
