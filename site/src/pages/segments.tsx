// /segments: the 57 UNSPSC segments with their open notices and this year's
// award notices (categories/index.json; the export keeps the files' old
// folder name). /segments/:nn: one segment's open notices, the families and
// classes they carry (tenders/open-levels.json), the organizations with the
// largest award values in it, and its award notices by year. A
// notice or award counts under every segment its codes fall in, so segment
// figures overlap and are never added up. "Category" is kept for the
// CanadaBuys field (goods, services, construction) on the tender pages; the
// old /categories addresses answer with a 301 here (index.tsx).

import type { Context } from "hono";
import { Table } from "../columns";
import { SEGMENT_CODES } from "../constants";
import { type CodeLevel, SEGMENT_RE, loadCategories, loadCategory, loadExpiringIndex, loadOpenLevels, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, segmentLabel, t, tn, type Lang } from "../i18n";
import { clockOf, closingPassed, tenderState } from "../closing";
import { Layout, PageHead, Panel, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { pageSeo, segmentSeo } from "../seo";
import { accountsEnabled } from "../account/switch";
import { IncumbentsPanel, loadIncumbents } from "./backbone";
import { InterestPanel, interestFilter } from "./interest";
import { AnalyticsLink, Count, CountdownScript, OrgTotalTable, TenderTable, money } from "./shared";

// How many open notices a segment page lists, the soonest to close; the
// tender list filtered to the segment has them all.
export const SEGMENT_OPEN_ROWS = 10;

export async function segmentsIndex(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const idx = stats ? await loadCategories(c.env) : null;
  if (!stats || !idx) return noDataPage(c, "segments.title");
  const bySegment = new Map(idx.segments.map((s) => [s.code, s]));
  const n = (v: number) => fmtInt(v, lang);
  // The segments with the most award notices first; ?sort=code in code order.
  const byCode = c.req.query("sort") === "code";
  const codes = byCode ? SEGMENT_CODES : [...SEGMENT_CODES].sort((a, b) =>
    (bySegment.get(b)?.awards_n ?? 0) - (bySegment.get(a)?.awards_n ?? 0) || a.localeCompare(b));
  return page(
    c,
    <Layout lang={lang} title={t(lang, "segments.title")} dataAsOf={stats.data_as_of} active="/segments"
      seo={pageSeo("segments", lang, byCode ? { noindex: true } : {})}>
      <PageHead lang={lang} title={t(lang, "segments.title")} lead={t(lang, "segments.lead")}>
        <p class="page-note">{t(lang, "segments.overlap")}</p>
      </PageHead>
      <Panel title={t(lang, "segments.panel")} count={fmtInt(SEGMENT_CODES.length, lang)}
        tools={<nav class="tabs tabs-small" aria-label={t(lang, "common.order")}>
          <a href="/segments" aria-current={byCode ? undefined : "page"}>{t(lang, "common.order_records")}</a>
          <a href="/segments?sort=code" aria-current={byCode ? "page" : undefined}>{t(lang, "common.order_code")}</a>
        </nav>}>
      <div class="table-wrap bordered">
        <Table restack={false} class="compact" cols={[
          { kind: "main", label: t(lang, "col.segment") },
          { kind: "count", label: t(lang, "segments.col_open") },
          { kind: "tally", label: t(lang, "segments.col_year", { year: idx.year }), class: "num" },
          { kind: "tally", label: t(lang, "segments.col_all"), class: "num ph" },
        ]}>
          <tbody>
            {codes.map((code) => {
              const s = bySegment.get(code);
              return (
                <tr>
                  <td data-label={t(lang, "col.segment")}>
                    <span class="mono">{code}</span> <a href={`/segments/${code}`}>{segmentLabel(lang, code)}</a>
                  </td>
                  <td data-label={t(lang, "segments.col_open")} class="mono num">
                    {s && s.open_tenders ? <a href={`/tenders?segment=${code}`}>{n(s.open_tenders)}</a> : <Count lang={lang} n={0} />}
                  </td>
                  <td data-label={t(lang, "segments.col_year", { year: idx.year })} class="mono num">
                    <Count lang={lang} n={s?.awards_year_n ?? 0} />
                    {s?.awards_year_total ? <><br /><span class="muted small">{money(lang, s.awards_year_total)}</span></> : null}
                  </td>
                  <td data-label={t(lang, "segments.col_all")} class="mono num ph">
                    <Count lang={lang} n={s?.awards_n ?? 0} />
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

// -- the segment's families and classes ------------------------------------------------

// The families with the most open notices a segment page lists, and the
// classes under each; the tender list filtered to a family has all of its
// classes, and the families past the first ones are a code away there.
export const LEVEL_FAMILIES_MAX = 25;
export const LEVEL_CLASSES_MAX = 8;

export type SegmentFamily = CodeLevel & { classes: CodeLevel[]; more: number };

// The families of the segment the open notices carry (tenders/open-levels.json),
// most notices first, then by code, each with its classes in the same order.
export function segmentLevels(levels: readonly CodeLevel[], code: string): { families: SegmentFamily[]; total: number } {
  const order = (a: CodeLevel, b: CodeLevel) => b.n - a.n || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const mine = levels.filter((l) => l.code.startsWith(code));
  const all = mine.filter((l) => l.code.length === 4).sort(order);
  const families = all.slice(0, LEVEL_FAMILIES_MAX).map((f) => {
    const classes = mine.filter((l) => l.code.length === 6 && l.code.startsWith(f.code)).sort(order);
    return { ...f, classes: classes.slice(0, LEVEL_CLASSES_MAX), more: Math.max(0, classes.length - LEVEL_CLASSES_MAX) };
  });
  return { families, total: all.length };
}

const LevelName = ({ lang, level }: { lang: Lang; level: CodeLevel }) => {
  const name = pick(lang, level.en, level.fr);
  return name ? <>{name}</> : <span class="muted">{t(lang, "segment.levels_unnamed")}</span>;
};

// Each family's row, then its classes indented under it; a count opens the
// tender list at that family or class (the code filter).
const SegmentLevels = ({ lang, families, total }: { lang: Lang; families: readonly SegmentFamily[]; total: number }) => (
  <Panel id="levels" title={t(lang, "segment.levels")} count={fmtInt(total, lang)}
    foot={<span>{t(lang, "segment.levels_names")}</span>}>
    <p class="muted small">
      {t(lang, "segment.levels_note")}
      {total > families.length ? ` ${t(lang, "segment.levels_first", { n: fmtInt(families.length, lang) })}` : ""}
    </p>
    <div class="table-wrap bordered levels">
      <Table restack={false} class="compact" cols={[
        { kind: "label", label: t(lang, "col.code") },
        { kind: "main", label: t(lang, "segment.col_level") },
        { kind: "count", label: t(lang, "segments.col_open") },
      ]}>
        <tbody>
          {families.map((f) => (
            <>
              <tr class="level-family">
                <td data-label={t(lang, "col.code")} class="mono">{f.code}</td>
                <td data-label={t(lang, "segment.col_level")}><LevelName lang={lang} level={f} /></td>
                <td data-label={t(lang, "segments.col_open")} class="mono num"><a href={`/tenders?code=${f.code}`}>{fmtInt(f.n, lang)}</a></td>
              </tr>
              {f.classes.map((k) => (
                <tr class="level-class">
                  <td data-label={t(lang, "col.code")} class="mono">{k.code}</td>
                  <td data-label={t(lang, "segment.col_level")}><LevelName lang={lang} level={k} /></td>
                  <td data-label={t(lang, "segments.col_open")} class="mono num"><a href={`/tenders?code=${k.code}`}>{fmtInt(k.n, lang)}</a></td>
                </tr>
              ))}
              {f.more ? (
                <tr class="level-class">
                  <td></td>
                  <td colspan={2} class="muted small">
                    <a href={`/tenders?code=${f.code}`}>{tn(lang, "segment.levels_more_one", "segment.levels_more_many", f.more, { n: fmtInt(f.more, lang) })}</a>
                  </td>
                </tr>
              ) : null}
            </>
          ))}
        </tbody>
      </Table>
    </div>
  </Panel>
);

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
  const shown = open.slice(0, SEGMENT_OPEN_ROWS);
  const [interest, expiring, openLevels, incumbents] = await Promise.all([
    interestFilter(c.env, lang, "segment", `/segments/${code}`),
    loadExpiringIndex(c.env).catch(() => null),
    loadOpenLevels(c.env).catch(() => null),
    loadIncumbents(c, "segment", code, todayOf(stats.data_as_of)),
  ]);
  // An export without the levels file shows no levels panel.
  const levels = openLevels ? segmentLevels(openLevels, code) : null;
  const ending = expiring?.by_segment.find((g) => g.code === code)?.n ?? 0;
  const dataYear = Number(todayOf(stats.data_as_of).slice(0, 4));
  const thisYear = seg.years.find((y) => y.year === dataYear);
  const awardsLine = !thisYear || thisYear.n === 0
    ? t(lang, "segment.lead_awards_none", { year: dataYear })
    : tn(lang, "segment.lead_awards_one", "segment.lead_awards_many", thisYear.n, { n: n(thisYear.n), total: money(lang, thisYear.total), year: dataYear });
  // The years the award notices span, for the note on the ranking (a year typed past the data year left out).
  const spanned = seg.years.filter((y) => y.n > 0 && y.year <= dataYear).map((y) => y.year);
  return page(
    c,
    <Layout lang={lang} title={name} dataAsOf={stats.data_as_of} active="/segments" seo={segmentSeo(seg, lang, crumbs)}>
      <PageHead lang={lang} crumbs={crumbs} eyebrow={t(lang, "segment.code", { code })} title={name}
        lead={`${tn(lang, "segment.lead_open_one", "segment.lead_open_many", seg.open_tenders.length, { n: n(seg.open_tenders.length) })} ${awardsLine}`}
        actions={<>
          {ending > 0 ? <a href={`/expiring/12m?segment=${code}`} class="btn">{t(lang, "segment.expiring", { n: n(ending) })}</a> : null}
          <a href={`/data/feeds/segment/${code}/tenders.xml`} class="btn">{t(lang, "feeds.button_tenders")}</a>
          <AnalyticsLink lang={lang} href={`/segments/${code}/analytics`} on={accountsEnabled(c.env)} />
        </>} />

      <Panel title={t(lang, "segment.open")} count={n(seg.open_tenders.length)}
        foot={open.length ? <a href={`/tenders?segment=${code}`} class="btn btn-primary">{t(lang, "segment.all_open", { n: n(seg.open_tenders.length) })}</a> : undefined}>
      {open.length > shown.length ? <p class="muted small">{t(lang, "segment.open_first", { n: n(shown.length) })}</p> : null}
      {shown.length ? (
        <TenderTable lang={lang} rows={shown} clock={clock} timeLeft omit={code} />
      ) : <p class="muted">{t(lang, "segment.open_none")}</p>}
      </Panel>

      {levels && levels.families.length ? <SegmentLevels lang={lang} families={levels.families} total={levels.total} /> : null}

      <InterestPanel lang={lang} filter={interest} />

      {/* The incumbents: who holds the segment's contracts ending within 12 months (pages/backbone.tsx). */}
      <IncumbentsPanel lang={lang} inc={incumbents} />

      <div class="panel-grid">
      <Panel title={t(lang, "segment.top")}>
      <p class="muted small">
        {t(lang, "segment.top_note")}
        {spanned.length ? ` ${t(lang, "segment.top_years", { first: Math.min(...spanned), last: Math.max(...spanned) })}` : ""}
      </p>
      {seg.top_organizations.length ? <OrgTotalTable lang={lang} rows={seg.top_organizations} rank /> : <p class="muted">{t(lang, "awards.none")}</p>}
      </Panel>

      <Panel title={t(lang, "segment.years")}>
      {years.length ? (
        <div class="table-wrap bordered">
          <Table restack={false} class="compact" cols={[
            { kind: "main", label: t(lang, "col.year") },
            { kind: "count", label: t(lang, "col.records") },
            { kind: "total", label: t(lang, "col.value") },
          ]}>
            <tbody>
              {years.map((y) => (
                <tr>
                  {/* A year's list would hold every segment's notices, so the year is not a link until award lists can filter. */}
                  <td data-label={t(lang, "col.year")} class="mono">{y.year}</td>
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
      {shown.some((r) => tenderState("open", r.closing, clock) === "closing") ? <CountdownScript lang={lang} /> : null}
    </Layout>,
  );
}
