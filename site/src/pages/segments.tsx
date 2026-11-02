// /segments: the 57 UNSPSC segments with their open notices and this year's
// award notices (categories/index.json; the export keeps the files' old
// folder name). /segments/:nn: one segment's open notices, the organizations
// with the largest award values in it, and its award notices by year. A
// notice or award counts under every segment its codes fall in, so segment
// figures overlap and are never added up. "Category" is kept for the
// CanadaBuys field (goods, services, construction) on the tender pages; the
// old /categories addresses answer with a 301 here (index.tsx).

import type { Context } from "hono";
import { Table } from "../columns";
import { SEGMENT_CODES } from "../constants";
import { SEGMENT_RE, loadCategories, loadCategory, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, segmentLabel, t } from "../i18n";
import { clockOf, closingPassed, tenderState } from "../closing";
import { Layout, PageHead, Panel, noDataPage, notFoundPage, page } from "../layout";
import { pageSeo, segmentSeo } from "../seo";
import { InterestPanel, interestFilter } from "./interest";
import { CountdownScript, OrgTotalTable, TenderTable, money } from "./shared";

export async function segmentsIndex(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const idx = stats ? await loadCategories(c.env) : null;
  if (!stats || !idx) return noDataPage(c, "segments.title");
  const bySegment = new Map(idx.segments.map((s) => [s.code, s]));
  const n = (v: number) => fmtInt(v, lang);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "segments.title")} dataAsOf={stats.data_as_of} active="/segments" seo={pageSeo("segments", lang)}>
      <PageHead lang={lang} title={t(lang, "segments.title")} lead={t(lang, "segments.lead")}>
        <p class="page-note">{t(lang, "segments.overlap")}</p>
      </PageHead>
      <Panel title={t(lang, "segments.panel")} count={fmtInt(SEGMENT_CODES.length, lang)}>
      <div class="table-wrap bordered">
        <Table cols={[
          { kind: "main", label: t(lang, "col.segment") },
          { kind: "count", label: t(lang, "segments.col_open") },
          { kind: "tally", label: t(lang, "segments.col_year", { year: idx.year }), class: "num" },
          { kind: "tally", label: t(lang, "segments.col_all"), class: "num" },
        ]}>
          <tbody>
            {SEGMENT_CODES.map((code) => {
              const s = bySegment.get(code);
              return (
                <tr>
                  <td data-label={t(lang, "col.segment")}>
                    <span class="mono">{code}</span> <a href={`/segments/${code}`}>{segmentLabel(lang, code)}</a>
                  </td>
                  <td data-label={t(lang, "segments.col_open")} class="mono num">
                    {s && s.open_tenders ? <a href={`/tenders?segment=${code}`}>{n(s.open_tenders)}</a> : "0"}
                  </td>
                  <td data-label={t(lang, "segments.col_year", { year: idx.year })} class="mono num">
                    {n(s?.awards_year_n ?? 0)}
                    {s?.awards_year_total ? <><br /><span class="muted small">{money(lang, s.awards_year_total)}</span></> : null}
                  </td>
                  <td data-label={t(lang, "segments.col_all")} class="mono num">
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

export async function segmentPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const code = c.req.param("nn") ?? "";
  if (!SEGMENT_RE.test(code)) return c.notFound();
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "segments.title");
  if (!SEGMENT_CODES.includes(code)) return notFoundPage(c, stats.data_as_of, "segment.not_found", "/segments", "segment.back");
  const seg = await loadCategory(c.env, code);
  if (!seg) return noDataPage(c, "segments.title");
  const name = segmentLabel(lang, code);
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "segments.title"), path: "/segments" }, { name: `${code} ${name}` }];
  const years = [...seg.years].sort((a, b) => b.year - a.year);
  const n = (v: number) => fmtInt(v, lang);
  const clock = clockOf(c.env);
  // An open list: a notice whose closing time has passed goes after the ones still open.
  const open = [...seg.open_tenders.filter((r) => !closingPassed(r.closing, clock)), ...seg.open_tenders.filter((r) => closingPassed(r.closing, clock))];
  const interest = await interestFilter(c.env, lang, "segment", `/segments/${code}`);
  return page(
    c,
    <Layout lang={lang} title={name} dataAsOf={stats.data_as_of} active="/segments" seo={segmentSeo(seg, lang, crumbs)}>
      <PageHead lang={lang} crumbs={crumbs} eyebrow={t(lang, "segment.code", { code })} title={name}
        actions={<>
          <a href={`/tenders?segment=${code}`} class="btn btn-primary">{t(lang, "segment.all_open", { n: n(seg.open_tenders.length) })}</a>
          <a href={`/data/feeds/segment/${code}/tenders.xml`} class="btn">{t(lang, "feeds.button_tenders")}</a>
        </>} />

      <InterestPanel lang={lang} filter={interest} />

      <Panel title={t(lang, "segment.open")} count={n(seg.open_tenders.length)}>
      {open.length ? (
        <TenderTable lang={lang} rows={open} clock={clock} />
      ) : <p class="muted">{t(lang, "segment.open_none")}</p>}
      </Panel>

      <div class="panel-grid">
      <Panel title={t(lang, "segment.top")}>
      <p class="muted small">{t(lang, "segment.top_note")}</p>
      {seg.top_organizations.length ? <OrgTotalTable lang={lang} rows={seg.top_organizations} rank /> : <p class="muted">{t(lang, "awards.none")}</p>}
      </Panel>

      <Panel title={t(lang, "segment.years")}>
      {years.length ? (
        <div class="table-wrap bordered">
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
      {open.some((r) => tenderState("open", r.closing, clock) === "closing") ? <CountdownScript lang={lang} /> : null}
    </Layout>,
  );
}
