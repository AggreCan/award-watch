// The analytics views (docs/analytics.md): one buyer, one organization or one
// UNSPSC segment over federal fiscal years, charted from the records database
// (src/records_db.ts), each chart with its table and, for Pro, a CSV file of
// that table.
//
// /buyers/:id/analytics          value by fiscal quarter, the average and
//                                median value, the ten largest records, value
//                                by segment, the non-competitive share by
//                                fiscal year, the organizations with the
//                                largest values, value growth through
//                                amendments, the contracts ending in the next
//                                eight fiscal quarters
// /organizations/:id/analytics   value by fiscal year, the ten largest
//                                records, the buyers and the segments with the
//                                largest values, its share of one segment
//                                beside up to five others, value growth
//                                through amendments
// /segments/:nn/analytics        buyers and organizations by fiscal year, the
//                                average and median value, the ten largest
//                                records, the largest buyers and
//                                organizations, the organizations new to the
//                                segment, the contracts ending in the next
//                                eight fiscal quarters
//
// One source at a time (?source=), because no figure ever adds two sources;
// the contracts ending are the radar's, each contract once across the three
// contract sources, and say so. The period is ?years= 3, 5, 10 or 20 fiscal
// years ending with the data date's, or ?from= and ?to= its first and last
// fiscal year (none after the data date's), so a chosen period is an
// address; a period reads at most the reader's plan's years (ten on Pro,
// twenty on Ultra, records_db.ts planYears), the latest of a longer one. A
// value the view cannot use reads as the default, never an error.
//
// The paid tier's part (feature analytics, src/plan.ts analyticsAccess).
// While the accounts switch is off every address here is the site's 404 and
// no page links one. With it on nothing is hidden: a request without the
// feature gets the view's head, the first chart for the latest three fiscal
// years without its table, and every other chart's title with a line of what
// it shows, marked Pro (classes pro-tag and pro-note, styled once in
// public/styles.css). That page reads the records database once: the state
// row and the first chart's statement in one batch. The pages are noindex and
// robots.txt keeps crawlers off them, so a crawl never becomes D1 reads.

import type { Context } from "hono";
import { ProTag, UltraTag } from "../pro";
import type { FC } from "hono/jsx";
import {
  ChartStack, RankedBars, barGap, fiscalAxis, moneyTip, partOf, recordsText, tipHead, tipText, type Panel as ChartPanel, type RankedBar,
  type YearPoint,
} from "../chart";
import { Table } from "../columns";
import { MONEY_SOURCES, type MoneySource } from "../constants";
import { BUYER_ID_RE, ORG_ID_RE, SEGMENT_RE, loadBuyer, loadBuyerAlias, loadProfile, loadStats, type Stats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, fmtMoney, fmtMoneyShort, fmtPct, pick, segmentLabel, sourceLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, lowerRedirect, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { allowsAnalytics, analyticsPlan } from "../plan";
import { ultraOnSale } from "../account/payments";
import {
  AMENDED_SOURCES, BUYER_COMPETITION_SQL, BUYER_DUE_SQL, BUYER_GROWTH_SQL, BUYER_QUARTERS_SQL, BUYER_RECORDS_SQL, BUYER_SEGMENTS_SQL,
  BUYER_SUPPLIERS_SQL, BUYER_VALUES_SQL, DUE_QUARTERS, DUE_YEARS, EARLIEST_FY, ENTRANT_LOOKBACK, FREE_YEARS, MAX_RIVALS, MAX_YEARS, ULTRA_YEARS, planYears,
  ORG_BUYERS_SQL, ORG_GROWTH_SQL, ORG_RECORDS_SQL, ORG_SEGMENTS_SQL, ORG_SHARE_SQL, ORG_YEARS_SQL, PERIODS, SEGMENT_BUYERS_SQL,
  SEGMENT_DUE_SQL, SEGMENT_ENTRANTS_SQL, SEGMENT_RECORDS_SQL, SEGMENT_SOURCES, RIVALS_N, SEGMENT_VALUES_SQL, SEGMENT_WINNERS_SQL,
  SEGMENT_YEARS_SQL, SHARE_SLOTS, SOURCE_NUMBER, TOP_N, type Period, type Query, type Read, type Row, choosePeriod, dollars,
  fiscalLabel, fiscalYearOf, num, orgIdOf, orgNumber, quarterEnd, readRecords, segmentCode, segmentNumber,
} from "../records_db";
import { railAccount } from "../account/session";
import { AddToDashboard, dashboardAccount, viewPanelRef } from "../account/dashboard_add";
import { growthPct, windowOf } from "./expiring";
import { retiredIdRedirect } from "./organization";
import { contractSearchUrl, grantUrl, money, shareText } from "./shared";

export type View = "buyer" | "organization" | "segment";

// Each view's tables in page order, by the name its CSV file takes.
export const VIEW_TABLES = {
  buyer: ["quarters", "values", "records", "segments", "competition", "suppliers", "growth", "due"],
  organization: ["years", "records", "buyers", "segments", "share", "growth"],
  segment: ["years", "values", "records", "buyers", "winners", "entrants", "due"],
} as const satisfies Record<View, readonly string[]>;

const DEFAULT_YEARS: Period = 10;

// -- the request -------------------------------------------------------------------

interface Frame {
  source: MoneySource;
  years: number;
  first: number;
  last: number;
  // The fiscal year the data date falls in, counted to date.
  current: number;
  // The period was chosen by its first and last fiscal year (?from, ?to)
  // rather than as the latest n, and capped: it was longer than the reader's
  // plan gives (most, records_db.ts planYears), so its latest most are shown.
  custom: boolean;
  capped: boolean;
  // The free view was asked for something it does not give (a longer period,
  // a segment or organizations to compare), and says so.
  asked: boolean;
  // The fiscal years the reader's plan shows at once (planYears).
  most: number;
  // The address asked for a period longer than the plan gives that Ultra
  // gives (ULTRA_YEARS); the view says so while Ultra is on sale.
  longer: boolean;
}

// The source by the most records on the entity's own page; the first of the
// list on a tie, or when the page names none.
function largestSource(counts: Partial<Record<MoneySource, number>>, allowed: readonly MoneySource[]): MoneySource {
  return allowed.reduce((best, s) => ((counts[s] ?? 0) > (counts[best] ?? 0) ? s : best), allowed[0]);
}

// most: the fiscal years the reader's plan shows at once (planYears); a
// period longer than that reads as the plan's own, the latest most years.
function readFrame(
  c: Context<AppEnv>, stats: Stats, pro: boolean, allowed: readonly MoneySource[], fallback: MoneySource, most: number = pro ? MAX_YEARS : FREE_YEARS,
): Frame {
  const url = new URL(c.req.url);
  const raw = (url.searchParams.get("source") ?? "").trim().toLowerCase();
  const source = (allowed as readonly string[]).includes(raw) ? (raw as MoneySource) : fallback;
  const current = fiscalYearOf(todayOf(stats.data_as_of));
  const latest = (years: number): Frame => ({
    source, years, first: current - years + 1, last: current, current, custom: false, capped: false, asked: false, most, longer: false,
  });
  const asked = Number(url.searchParams.get("years"));
  // Ultra's period asked by a plan that does not give it.
  const ultraAsked = asked === ULTRA_YEARS && most < ULTRA_YEARS;
  if (!pro) {
    const extra = ["years", "from", "to", "segment", "vs"].some((k) => url.searchParams.has(k));
    return { ...latest(FREE_YEARS), asked: extra, longer: ultraAsked };
  }
  const chosen = choosePeriod(url.searchParams.get("from"), url.searchParams.get("to"), current, most);
  if (chosen) {
    return {
      ...latest(chosen.last - chosen.first + 1), first: chosen.first, last: chosen.last, custom: true, capped: chosen.capped,
      longer: chosen.capped && most < ULTRA_YEARS,
    };
  }
  const years = (PERIODS as readonly number[]).includes(asked) ? Math.min(asked, most) : DEFAULT_YEARS;
  return { ...latest(years), longer: ultraAsked };
}

// A view's address: the source, then the period as the reader chose it
// (the latest n fiscal years, or the first and last one), then the rest.
type Link = Pick<Frame, "source" | "years" | "first" | "last" | "custom">;

function query(base: string, f: Link, more: Record<string, string | readonly string[]> = {}): string {
  const p = new URLSearchParams({ source: f.source });
  if (f.custom) {
    p.set("from", String(f.first));
    p.set("to", String(f.last));
  } else {
    p.set("years", String(f.years));
  }
  for (const [k, v] of Object.entries(more)) for (const one of typeof v === "string" ? [v] : v) p.append(k, one);
  return `${base}?${p.toString()}`;
}

// The same as hidden fields, for a form that changes something else.
const FrameFields: FC<{ frame: Link; more?: Record<string, string | readonly string[]>; period?: boolean }> = ({ frame, more = {}, period = true }) => (
  <>
    <input type="hidden" name="source" value={frame.source} />
    {!period ? null : frame.custom ? <>
      <input type="hidden" name="from" value={String(frame.first)} />
      <input type="hidden" name="to" value={String(frame.last)} />
    </> : <input type="hidden" name="years" value={String(frame.years)} />}
    {Object.entries(more).flatMap(([k, v]) => (typeof v === "string" ? [v] : [...v]).map((one) => <input type="hidden" name={k} value={one} />))}
  </>
);

// The organizations to compare on a profile: up to MAX_RIVALS valid ids, each
// once, never the profile's own.
function readRivals(url: URL, self: string): string[] {
  const out: string[] = [];
  for (const v of url.searchParams.getAll("vs")) {
    const id = v.trim().toLowerCase();
    if (ORG_ID_RE.test(id) && id !== self && !out.includes(id)) out.push(id);
    if (out.length === MAX_RIVALS) break;
  }
  return out;
}

async function readNamed(c: Context<AppEnv>, named: Record<string, Query>): Promise<{ read: Read; rows: Record<string, Row[]> }> {
  const names = Object.keys(named);
  const read = await readRecords(c.env, names.map((n) => named[n]));
  const rows: Record<string, Row[]> = {};
  if (read.state === "ready") names.forEach((n, i) => (rows[n] = read.rows[i] ?? []));
  return { read, rows };
}

// -- formatting --------------------------------------------------------------------

// A fiscal year's label, the data date's marked as counted to date.
const fy = (lang: Lang, year: number, current: number) =>
  year === current ? t(lang, "analytics.to_date", { fy: fiscalLabel(lang, year) }) : fiscalLabel(lang, year);

// The same in a date column (112 px), where "2026-2027 (à ce jour)" on one
// line ran into the next column: the year, and under it a muted "(to date)",
// as a date cell carries its second fact. The line break lets the cell wrap
// (styles.css, td.mono) and ends what public/sort.js reads, so the cell
// still sorts by its year.
const FyCell: FC<{ lang: Lang; year: number; current: number }> = ({ lang, year, current }) =>
  year === current ? <>{fiscalLabel(lang, year)}<br /><span class="muted small">{t(lang, "analytics.to_date_line")}</span></> : <>{fiscalLabel(lang, year)}</>;
const int = (v: unknown): number => num(v) ?? 0;
const share = (lang: Lang, part: number | null, whole: number | null) => (part !== null && whole !== null && whole > 0 ? fmtPct(part, whole, lang) : "");

function orgName(row: Row): string {
  return typeof row.name === "string" && row.name ? row.name : orgIdOf(int(row.oid));
}

function segmentLink(lang: Lang, sid: number) {
  const code = segmentCode(sid);
  return <a href={`/segments/${code}`}><span class="mono">{code}</span> {segmentLabel(lang, code)}</a>;
}

// -- the pieces every view shares ---------------------------------------------------


// Where a reader without the feature goes for it: the billing page, or the
// sign-in page while signed out.
const ProLink: FC<{ lang: Lang; signedIn: boolean }> = ({ lang, signedIn }) => (
  <a href={signedIn ? "/account/billing" : "/account/sign-in"}>{t(lang, signedIn ? "analytics.pro_billing" : "analytics.pro_sign_in")}</a>
);

// A chart the free view names without drawing: its title marked Pro and one
// line of what it shows.
const Locked: FC<{ lang: Lang; title: string; text: string }> = ({ lang, title, text }) => (
  <Panel title={<>{title}<ProTag lang={lang} /></>}>
    <div class="pro-note"><p>{text}</p></div>
  </Panel>
);

const SourceTabs: FC<{ lang: Lang; base: string; frame: Frame; allowed: readonly MoneySource[]; more?: Record<string, string | readonly string[]> }> = ({
  lang, base, frame, allowed, more,
}) => (
  <nav class="tabs toolbar-row" aria-label={t(lang, "analytics.sources_nav")}>
    {allowed.map((s) => (
      <a href={query(base, { ...frame, source: s }, more)} rel="nofollow" aria-current={s === frame.source ? "page" : undefined}>{sourceLabel(lang, s)}</a>
    ))}
  </nav>
);

// The periods: each a link for Pro; for the free view the longer ones carry
// the Pro mark and lead to the same view, which says they are part of Pro.
// Ultra's period (ULTRA_YEARS) is offered to a reader whose plan gives it
// and, while Ultra is on sale (ultra), to every other with the Ultra mark,
// leading to the view at the reader's own period, which says it is part of
// Ultra; otherwise it is not offered, and the tabs are as before Ultra.
const PeriodTabs: FC<{ lang: Lang; base: string; frame: Frame; pro: boolean; ultra: boolean; more?: Record<string, string | readonly string[]> }> = ({
  lang, base, frame, pro, ultra, more,
}) => (
  <nav class="tabs tabs-small toolbar-row" aria-label={t(lang, "analytics.period_nav")}>
    {PERIODS.filter((n) => n <= MAX_YEARS || n <= frame.most || ultra).map((n) => (
      <a href={query(base, { ...frame, years: n, custom: false }, more)} rel="nofollow"
        aria-current={!frame.custom && n === frame.years ? "page" : undefined}>
        {t(lang, "analytics.period", { n })}
        {n > frame.most && n > MAX_YEARS ? <UltraTag lang={lang} /> : !pro && n > FREE_YEARS ? <ProTag lang={lang} /> : null}
      </a>
    ))}
  </nav>
);

// A period by its first and last fiscal year, as a form that writes ?from=
// and ?to= into the address, so the view it opens can be linked. Every year
// from EARLIEST_FY to the data date's is offered; the view itself caps a
// longer span at the reader's plan's figure. For the free view the button
// carries the Pro mark and leads to the same view, which says the choice is
// part of Pro.
const PeriodForm: FC<{ lang: Lang; base: string; frame: Frame; pro: boolean; more?: Record<string, string | readonly string[]> }> = ({
  lang, base, frame, pro, more,
}) => {
  const years: number[] = [];
  for (let y = frame.current; y >= EARLIEST_FY; y--) years.push(y);
  const select = (name: "from" | "to", chosen: number) => (
    <select name={name}>{years.map((y) => <option value={String(y)} selected={y === chosen}>{fiscalLabel(lang, y)}</option>)}</select>
  );
  return (
    <form method="get" action={base} class="toolbar-fields" aria-label={t(lang, "analytics.period_form")}>
      <FrameFields frame={frame} more={more} period={false} />
      <label class="field field-code"><span class="field-label">{t(lang, "analytics.period_from")}</span>{select("from", frame.first)}</label>
      <label class="field field-code"><span class="field-label">{t(lang, "analytics.period_to")}</span>{select("to", frame.last)}</label>
      <div class="toolbar-actions">
        <button type="submit" class="btn">{t(lang, "analytics.period_show")}{pro ? null : <ProTag lang={lang} />}</button>
      </div>
    </form>
  );
};

const CsvLink: FC<{ lang: Lang; href: string }> = ({ lang, href }) => <a href={href} rel="nofollow">{t(lang, "analytics.csv")}</a>;

interface Shell {
  view: View;
  lang: Lang;
  stats: Stats;
  name: string;
  crumbs: { name: string; path?: string }[];
  // The entity's own page.
  back: string;
  backKey: Key;
  base: string;
  frame: Frame;
  pro: boolean;
  // Ultra's period offered to a reader whose plan lacks it: while Ultra is on sale (Ctx ultra).
  ultra: boolean;
  allowed: readonly MoneySource[];
  more?: Record<string, string | readonly string[]>;
  active: string;
}

// The head, the toolbar and the foot around a view's panels; a database that
// cannot answer gives the page that says so, status 503, kept by no cache.
async function shell(c: Context<AppEnv>, s: Shell, read: Read, body: unknown): Promise<Response> {
  const { lang, frame } = s;
  const title = t(lang, "analytics.title_of", { name: s.name });
  const ok = read.state === "ready";
  if (!ok) c.header("Retry-After", "3600");
  // An Ultra account adds the view, at its source and period, to its dashboard (account/dashboard.tsx); no one else sees it.
  const dash = s.pro ? await dashboardAccount(c) : null;
  const add = dash ? <AddToDashboard lang={lang} account={dash} kind="view" panelRef={viewPanelRef(s.base, frame)} button /> : null;
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={s.stats.data_as_of} active={s.active}
      seo={{ path: s.base, description: t(lang, `analytics.description_${s.view}` as Key, { name: s.name }), noindex: true }}>
      <PageHead lang={lang} crumbs={[...s.crumbs, { name: t(lang, "analytics.crumb") }]}
        eyebrow={<>{t(lang, "analytics.eyebrow")}<ProTag lang={lang} /></>} title={s.name}
        lead={t(lang, "analytics.lead", {
          source: sourceLabel(lang, frame.source), first: fiscalLabel(lang, frame.first), last: fiscalLabel(lang, frame.last),
        })}
        actions={<>{add}<a href={s.back} class="btn">{t(lang, s.backKey)}</a></>}>
        <p class="page-note">{t(lang, "analytics.note_sources")} {t(lang, "analytics.note_fiscal")}</p>
        {frame.capped ? <p class="page-note">{t(lang, "analytics.period_capped", { n: frame.most })}</p> : null}
        {frame.longer && s.ultra ? <p class="page-note">{t(lang, "analytics.ultra_years", { n: ULTRA_YEARS })}</p> : null}
      </PageHead>
      <div class="toolbar">
        <SourceTabs lang={lang} base={s.base} frame={frame} allowed={s.allowed} more={s.more} />
        <PeriodTabs lang={lang} base={s.base} frame={frame} pro={s.pro} ultra={s.ultra} more={s.more} />
        <PeriodForm lang={lang} base={s.base} frame={frame} pro={s.pro} more={s.more} />
      </div>
      {ok ? (body as any) : (
        <Panel title={t(lang, "analytics.unavailable_title")}>
          <p>{t(lang, read.state === "loading" ? "analytics.unavailable_loading" : "analytics.unavailable_text")}</p>
          <p><a href={s.back}>{t(lang, s.backKey)}</a></p>
        </Panel>
      )}
      {ok ? (
        <p class="muted small">
          {read.asOf ? t(lang, "analytics.as_of", { date: read.asOf }) : null}{" "}
          {tj(lang, "analytics.rules", { methodology: <a href="/methodology#analytics">{t(lang, "analytics.rules_link")}</a> })}
        </p>
      ) : null}
    </Layout>,
    ok ? 200 : 503,
  );
}

// The free view's word on what the rest holds, under its one chart.
const FreeNote: FC<{ lang: Lang; view: View; signedIn: boolean; asked: boolean }> = ({ lang, view, signedIn, asked }) => (
  <div class="pro-note">
    {asked ? <p>{t(lang, "analytics.free_asked", { n: FREE_YEARS })}</p> : null}
    <p><ProTag lang={lang} />{t(lang, `analytics.free_${view}` as Key, { n: FREE_YEARS })} {t(lang, `analytics.free_more_${view}` as Key)}</p>
    <p><ProLink lang={lang} signedIn={signedIn} /></p>
  </div>
);

// -- the charts ------------------------------------------------------------------------

// A quarter's position on the axis: four units a fiscal year.
const quarterX = (year: number, q: number) => year * 4 + q - 1;

const QuarterChart: FC<{ lang: Lang; rows: Row[]; frame: Frame }> = ({ lang, rows, frame }) => {
  const axis = fiscalAxis(frame.first, frame.last, (y) => fiscalLabel(lang, y), 4);
  const title = t(lang, "analytics.chart_quarters", { source: sourceLabel(lang, frame.source) });
  const bars = rows.filter((r) => int(r.cents) > 0).map((r) => {
    const x = quarterX(int(r.fy), int(r.fq));
    const value = int(r.cents) / 100;
    const period = `${fiscalLabel(lang, int(r.fy))} ${t(lang, "analytics.quarter", { n: int(r.fq) })}`;
    return { x0: x, x1: x + 1, value, title: moneyTip(lang, title, period, value, recordsText(lang, int(r.n))) };
  });
  const panel: ChartPanel = { title, bars };
  return (
    <div class="chart">
      <ChartStack domain={[frame.first * 4, (frame.last + 1) * 4]} panels={[panel]} height={140} xLabels={axis.labels} grid={axis.grid}
        fmt={(v) => fmtMoneyShort(v, lang)} aria={t(lang, "analytics.chart_aria")} gap={barGap(frame.years * 4)} />
    </div>
  );
};

// Bars a fiscal year apart, one panel each (one scale when shared). fmt
// writes the axis; each value brings its tip's exact figures, and the head
// names the year as the tables do (the current one "to date").
const YearChart: FC<{ lang: Lang; frame: Frame; panels: { title: string; values: YearPoint[] }[]; fmt: (v: number) => string; shared?: boolean }> = ({
  lang, frame, panels, fmt, shared,
}) => {
  const axis = fiscalAxis(frame.first, frame.last, (y) => fiscalLabel(lang, y));
  const stack: ChartPanel[] = panels.map((p) => ({
    title: p.title,
    bars: p.values.filter(([, v]) => v > 0).map(([year, v, figures]) => ({
      x0: year, x1: year + 1, value: v, title: tipText(tipHead(lang, p.title, fy(lang, year, frame.current)), figures),
    })),
  }));
  return (
    <div class="chart">
      <ChartStack domain={[frame.first, frame.last + 1]} panels={stack} height={110} xLabels={axis.labels} fmt={fmt}
        aria={t(lang, "analytics.chart_aria")} shared={shared} gap={barGap(frame.years)} />
    </div>
  );
};

const ShareLines: FC<{ lang: Lang; frame: Frame; panels: { title: string; values: YearPoint[] }[] }> = ({ lang, frame, panels }) => {
  const axis = fiscalAxis(frame.first, frame.last, (y) => fiscalLabel(lang, y));
  const pct = (v: number) => t(lang, "pct", { n: Math.round(v) });
  const stack: ChartPanel[] = panels.map((p) => ({
    title: p.title,
    line: p.values.map(([year, v, figures]) => ({ x: year + 0.5, value: v, title: tipText(tipHead(lang, p.title, fy(lang, year, frame.current)), figures) })),
  }));
  return (
    <div class="chart">
      <ChartStack domain={[frame.first, frame.last + 1]} panels={stack} height={110} xLabels={axis.labels} fmt={pct}
        aria={t(lang, "analytics.chart_aria")} shared />
    </div>
  );
};

// -- the tables --------------------------------------------------------------------------

const RankTable: FC<{ lang: Lang; head: string; rows: { label: unknown; n: number; cents: unknown; share: string }[] }> = ({ lang, head, rows }) => (
  <div class="table-wrap">
    <Table cols={[
      { kind: "rank", label: t(lang, "analytics.col_rank") },
      { kind: "main", label: head },
      { kind: "count", label: t(lang, "col.records") },
      { kind: "total", label: t(lang, "col.value") },
      { kind: "count", label: t(lang, "analytics.col_share") },
    ]}>
      <tbody>
        {rows.map((r, i) => (
          <tr>
            <td data-label={t(lang, "analytics.col_rank")} class="mono num">{fmtInt(i + 1, lang)}</td>
            <td data-label={head}>{r.label as any}</td>
            <td data-label={t(lang, "col.records")} class="mono num">{fmtInt(r.n, lang)}</td>
            <td data-label={t(lang, "col.value")} class="mono num">{money(lang, dollars(r.cents))}</td>
            <td data-label={t(lang, "analytics.col_share")} class="mono num">{r.share}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  </div>
);

// A row's tip: the name over the exact value, the records it adds up and its
// share of the period's value.
function rankBars(lang: Lang, rows: { label: unknown; name: string; n: number; cents: unknown; share: string }[]): RankedBar[] {
  return rows.map((r) => {
    const value = dollars(r.cents) ?? 0;
    const figures = [money(lang, dollars(r.cents)), recordsText(lang, r.n), ...(r.share ? [t(lang, "tip.share_of_period", { pct: r.share })] : [])];
    return { label: r.label, value, text: fmtMoneyShort(value, lang), note: r.share, title: tipText(r.name, figures) };
  });
}

// -- the panels the buyer and segment views share, and the records table ------------------

const none = (lang: Lang) => <p class="muted">{t(lang, "analytics.none")}</p>;

// The average and median value by fiscal year: one panel each, on its own
// scale, because a few large records put the average far above the median
// and one scale would flatten the median's bars; the table gives both and
// the count of records they rest on.
const ValuesPanel: FC<{ lang: Lang; rows: Row[]; frame: Frame; csv: string }> = ({ lang, rows, frame, csv }) => {
  const average = (r: Row) => (int(r.n_pos) > 0 ? Math.round(int(r.pos) / int(r.n_pos)) / 100 : null);
  const valued = (r: Row) => tn(lang, "tip.valued_one", "tip.valued_many", int(r.n_pos), { n: fmtInt(int(r.n_pos), lang) });
  return (
    <Panel title={t(lang, "analytics.panel_values")} tools={rows.length ? <CsvLink lang={lang} href={csv} /> : undefined}
      foot={<span>{t(lang, "analytics.foot_values")}</span>}>
      {rows.some((r) => int(r.n_pos) > 0) ? <>
        <YearChart lang={lang} frame={frame} fmt={(v) => fmtMoneyShort(v, lang)} panels={[
          { title: t(lang, "analytics.chart_median"), values: rows.map((r): YearPoint => [int(r.fy), int(r.med) / 100, [fmtMoney(int(r.med) / 100, lang), valued(r)]]) },
          { title: t(lang, "analytics.chart_average"), values: rows.map((r): YearPoint => [int(r.fy), average(r) ?? 0, [fmtMoney(average(r) ?? 0, lang), valued(r)]]) },
        ]} />
        <div class="table-wrap">
          <Table cols={[
            { kind: "date", label: t(lang, "analytics.col_fy") },
            { kind: "count", label: t(lang, "analytics.col_valued") },
            { kind: "value", label: t(lang, "analytics.col_median") },
            { kind: "main", label: t(lang, "analytics.col_average") },
          ]}>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr>
                  <td data-label={t(lang, "analytics.col_fy")} class="mono"><FyCell lang={lang} year={int(r.fy)} current={frame.current} /></td>
                  <td data-label={t(lang, "analytics.col_valued")} class="mono num">{fmtInt(int(r.n_pos), lang)}</td>
                  <td data-label={t(lang, "analytics.col_median")} class="mono num">{int(r.n_pos) > 0 ? money(lang, dollars(r.med)) : ""}</td>
                  <td data-label={t(lang, "analytics.col_average")} class="mono num">{int(r.n_pos) > 0 ? money(lang, average(r)) : ""}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </> : none(lang)}
    </Panel>
  );
};

// Value growth through amendments by fiscal year of the award: the first
// values of the amended records beside their values as last amended, one
// panel each on one scale (the same measure before and after), and the
// change. Award notices and history only: the other sources number no
// versions.
const GrowthPanel: FC<{ lang: Lang; rows: Row[]; frame: Frame; csv: string }> = ({ lang, rows, frame, csv }) => {
  const amended = AMENDED_SOURCES.includes(frame.source);
  const n = (v: number) => fmtInt(v, lang);
  const compared = (r: Row) => tn(lang, "tip.compared_one", "tip.compared_many", int(r.n_compared), { n: n(int(r.n_compared)) });
  return (
    <Panel title={t(lang, "analytics.panel_growth")} tools={amended && rows.length ? <CsvLink lang={lang} href={csv} /> : undefined}
      foot={amended ? <span>{t(lang, "analytics.foot_growth")}</span> : undefined}>
      {!amended ? <p class="muted">{t(lang, "analytics.no_growth")}</p> : !rows.length ? none(lang) : <>
        {rows.some((r) => int(r.first_cents) > 0) ? (
          <YearChart lang={lang} frame={frame} shared fmt={(v) => fmtMoneyShort(v, lang)} panels={[
            {
              title: t(lang, "analytics.chart_growth_first"),
              values: rows.map((r): YearPoint => [int(r.fy), int(r.first_cents) / 100, [fmtMoney(int(r.first_cents) / 100, lang), compared(r)]]),
            },
            {
              title: t(lang, "analytics.chart_growth_last"),
              values: rows.map((r): YearPoint => [int(r.fy), int(r.last_cents) / 100, [fmtMoney(int(r.last_cents) / 100, lang), compared(r)]]),
            },
          ]} />
        ) : <p class="muted">{t(lang, "analytics.growth_none")}</p>}
        <div class="table-wrap">
          {/* From 700 to 1279 px the first and newest values rest and show under the change. */}
          <Table cols={[
            { kind: "date", label: t(lang, "analytics.col_fy") },
            { kind: "count", label: t(lang, "col.records") },
            { kind: "share", label: t(lang, "analytics.col_amended") },
            { kind: "count", label: t(lang, "analytics.col_compared"), rest: "md" },
            { kind: "total", label: t(lang, "analytics.col_first_value"), rest: "md" },
            { kind: "total", label: t(lang, "analytics.col_last_value"), rest: "md" },
            { kind: "main", label: t(lang, "analytics.col_change") },
          ]}>
            <tbody>
              {[...rows].reverse().map((r) => {
                const before = int(r.first_cents);
                return (
                  <tr>
                    <td data-label={t(lang, "analytics.col_fy")} class="mono"><FyCell lang={lang} year={int(r.fy)} current={frame.current} /></td>
                    <td data-label={t(lang, "col.records")} class="mono num">{n(int(r.n))}</td>
                    <td data-label={t(lang, "analytics.col_amended")} class="mono num">{shareText(lang, int(r.n_amended), int(r.n), n)}</td>
                    <td data-label={t(lang, "analytics.col_compared")} class="mono num mdh">{n(int(r.n_compared))}</td>
                    <td data-label={t(lang, "analytics.col_first_value")} class="mono num mdh">{before > 0 ? money(lang, before / 100) : ""}</td>
                    <td data-label={t(lang, "analytics.col_last_value")} class="mono num mdh">{before > 0 ? money(lang, dollars(r.last_cents)) : ""}</td>
                    <td data-label={t(lang, "analytics.col_change")} class="mono num">
                      {before > 0 ? growthPct(lang, int(r.last_cents) / before - 1) : ""}
                      {before > 0 ? (
                        <span class="md-only muted small">
                          <span class="nw-block">{t(lang, "common.labelled", { label: t(lang, "analytics.col_first_value"), value: money(lang, before / 100) })}</span>
                          <span class="nw-block">{t(lang, "common.labelled", { label: t(lang, "analytics.col_last_value"), value: money(lang, dollars(r.last_cents)) })}</span>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </>}
    </Panel>
  );
};

// What a record's row links: an award notice or a history record to its
// page here (the reference is stored in the URL form its page has), a
// published contract to the government's contracts search, a grant to its
// record in the grants search. The text is the reference as the reader knows
// it; null when the row stores none the link could be made from.
const URL_REF_RE = /^[A-Za-z0-9._-]{1,120}$/;

export function recordLink(src: number, ref: unknown): { href: string; text: string; here: boolean } | null {
  if (typeof ref !== "string" || !ref) return null;
  if (src === SOURCE_NUMBER.awards || src === SOURCE_NUMBER.history) {
    return URL_REF_RE.test(ref) ? { href: `/${src === SOURCE_NUMBER.awards ? "awards" : "history"}/${ref.toLowerCase()}`, text: ref, here: true } : null;
  }
  const at = ref.indexOf(":");
  const dept = ref.slice(0, at);
  const reference = ref.slice(at + 1);
  if (at <= 0 || !reference) return null;
  return { href: src === SOURCE_NUMBER.contracts ? contractSearchUrl(reference) : grantUrl(dept, reference), text: reference, here: false };
}

// The ten records with the largest counted values in the period, each linked
// to its page or its government record, with the other party: the
// organization on a buyer view, the buyer on an organization view, both on a
// segment view.
const RecordsPanel: FC<{ lang: Lang; rows: Row[]; frame: Frame; party: "organization" | "buyer" | "both"; csv: string }> = ({
  lang, rows, frame, party, csv,
}) => {
  const org = party !== "buyer";
  const buyer = party !== "organization";
  return (
    <Panel title={t(lang, "analytics.panel_records")} tools={rows.length ? <CsvLink lang={lang} href={csv} /> : undefined}
      foot={<span>{t(lang, "analytics.foot_records")}</span>}>
      {rows.length ? (
        <div class="table-wrap">
          {/* With the organization shown, the fiscal year rests from 700 to 1279 px and shows under the reference. */}
          <Table cols={[
            { kind: "rank", label: t(lang, "analytics.col_rank") },
            { kind: "main", label: t(lang, "col.record") },
            org && { kind: "org", label: t(lang, "col.organization") },
            buyer && { kind: "buyer", label: t(lang, "col.buyer"), rest: org ? "md" : undefined },
            { kind: "date", label: t(lang, "analytics.col_fy"), rest: org ? "md" : undefined },
            { kind: "value", label: t(lang, "col.value") },
          ]}>
            <tbody>
              {rows.map((r, i) => {
                const link = recordLink(int(r.src), r.ref);
                const title = typeof r.title === "string" && r.title ? r.title : link?.text ?? t(lang, "common.not_stated");
                const buyerName = pick(lang, r.name_en as string | null, r.name_fr as string | null);
                return (
                  <tr>
                    <td data-label={t(lang, "analytics.col_rank")} class="mono num">{fmtInt(i + 1, lang)}</td>
                    <td data-label={t(lang, "col.record")} class="lead-cell">
                      {link ? <a href={link.href} rel={link.here ? undefined : "nofollow noopener"}>{title}</a> : title}
                      {link ? <><br /><span class="mono id muted">{link.text}</span></> : null}
                      {org ? <span class="md-only muted small">{t(lang, "common.labelled", { label: t(lang, "analytics.col_fy"), value: fy(lang, int(r.fy), frame.current) })}</span> : null}
                    </td>
                    {org ? (
                      <td data-label={t(lang, "col.organization")}>
                        {num(r.oid) !== null ? <a href={`/organizations/${orgIdOf(int(r.oid))}`}>{orgName(r)}</a> : <span class="muted">{t(lang, "common.not_stated")}</span>}
                      </td>
                    ) : null}
                    {buyer ? (
                      <td data-label={t(lang, "col.buyer")} class={org ? "mdh" : undefined}>
                        {typeof r.buyer_id === "string" ? <a href={`/buyers/${r.buyer_id}`}>{buyerName ?? r.buyer_id}</a> : <span class="muted">{t(lang, "common.not_stated")}</span>}
                      </td>
                    ) : null}
                    <td data-label={t(lang, "analytics.col_fy")} class={org ? "mono mdh" : "mono"}><FyCell lang={lang} year={int(r.fy)} current={frame.current} /></td>
                    <td data-label={t(lang, "col.value")} class="mono num">{money(lang, dollars(r.cents))}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      ) : none(lang)}
    </Panel>
  );
};

// The fiscal quarter a date falls in (1 is April to June).
const fiscalQuarterOf = (day: string) => Math.floor(((Number(day.slice(5, 7)) + 8) % 12) / 3) + 1;
const DAY_MS = 86_400_000;

// The contracts ending in each of the DUE_QUARTERS fiscal quarters from the
// one the records' date falls in, by the radar's rules: count and value, one
// panel each on its own scale (different units), and in the table each
// quarter's link to the radar's narrowest window that holds the whole
// quarter, counted from the radar's own data date (none past its twelve
// months). filter is the radar's own (buyer=<id> or segment=<nn>), so the
// window lists the same contracts and the ones before them.
const DuePanel: FC<{ lang: Lang; rows: Row[]; from: string; radarDay: string; filter: string; csv: string; noun: Key }> = ({
  lang, rows, from, radarDay, filter, csv, noun,
}) => {
  const start = fiscalYearOf(from) * 4 + fiscalQuarterOf(from) - 1;
  const quarters = Array.from({ length: DUE_QUARTERS }, (_, k) => {
    const at = start + k;
    const year = Math.floor(at / 4);
    const q = (at % 4) + 1;
    const row = rows.find((r) => int(r.fy) === year && int(r.fq) === q);
    const ends = quarterEnd(year, q);
    const days = Math.round((Date.parse(`${ends}T00:00:00Z`) - Date.parse(`${radarDay}T00:00:00Z`)) / DAY_MS);
    const label = `${t(lang, "analytics.quarter", { n: q })} ${fiscalLabel(lang, year)}`;
    return { at, year, q, label, ends, n: int(row?.n), cents: row ? num(row.cents) : null, noValue: int(row?.n_no_value), window: windowOf(days) };
  });
  const value = (cents: number | null) => (cents === null ? 0 : cents / 100);
  const contracts = (n: number) => tn(lang, "tip.contracts_one", "tip.contracts_many", n, { n: fmtInt(n, lang) });
  const axis = quarters.map((x, k) => ({ x: x.at + 0.5, text: x.label, minor: k % 2 === 1, phone: k === 0 || k === DUE_QUARTERS - 1 }));
  const grid = quarters.filter((x, k) => k > 0 && x.q === 1).map((x) => x.at);
  const any = quarters.some((x) => x.n > 0);
  return (
    <Panel title={t(lang, "analytics.panel_due")} tools={rows.length ? <CsvLink lang={lang} href={csv} /> : undefined}
      foot={<span>{t(lang, "analytics.foot_due", { date: from })}</span>}>
      <p>{t(lang, noun)}</p>
      {any ? <>
        <div class="chart">
          <ChartStack domain={[start, start + DUE_QUARTERS]} xLabels={axis} grid={grid} height={110} aria={t(lang, "analytics.due_aria")}
            fmt={(v) => fmtMoneyShort(v, lang)} gap={barGap(DUE_QUARTERS)} panels={[
              {
                title: t(lang, "analytics.chart_due_value"),
                bars: quarters.filter((x) => value(x.cents) > 0).map((x) => ({
                  x0: x.at, x1: x.at + 1, value: value(x.cents),
                  title: moneyTip(lang, t(lang, "analytics.chart_due_value"), x.label, value(x.cents), contracts(x.n)),
                })),
              },
            ]} />
          <ChartStack domain={[start, start + DUE_QUARTERS]} xLabels={axis} grid={grid} height={80} aria={t(lang, "analytics.due_aria")}
            fmt={(v) => fmtInt(v, lang)} gap={barGap(DUE_QUARTERS)} panels={[
              {
                title: t(lang, "analytics.chart_due_count"),
                bars: quarters.filter((x) => x.n > 0).map((x) => ({
                  x0: x.at, x1: x.at + 1, value: x.n,
                  title: tipText(tipHead(lang, t(lang, "analytics.chart_due_count"), x.label), [contracts(x.n), ...(x.cents !== null ? [fmtMoney(value(x.cents), lang)] : [])]),
                })),
              },
            ]} />
        </div>
        <div class="table-wrap">
          <Table cols={[
            { kind: "date", label: t(lang, "analytics.col_quarter") },
            { kind: "date", label: t(lang, "analytics.col_quarter_ends"), rest: "md" },
            { kind: "count", label: t(lang, "analytics.col_contracts") },
            { kind: "total", label: t(lang, "col.value") },
            { kind: "count", label: t(lang, "analytics.col_no_value"), rest: "md" },
            { kind: "main", label: t(lang, "analytics.col_radar") },
          ]}>
            <tbody>
              {quarters.map((x) => (
                <tr>
                  <td data-label={t(lang, "analytics.col_quarter")} class="mono">{x.label}</td>
                  <td data-label={t(lang, "analytics.col_quarter_ends")} class="mono mdh">{x.ends}</td>
                  <td data-label={t(lang, "analytics.col_contracts")} class="mono num">{fmtInt(x.n, lang)}</td>
                  <td data-label={t(lang, "col.value")} class="mono num">{x.cents === null ? "" : money(lang, x.cents / 100)}</td>
                  <td data-label={t(lang, "analytics.col_no_value")} class="mono num mdh">{fmtInt(x.noValue, lang)}</td>
                  <td data-label={t(lang, "analytics.col_radar")}>
                    {x.window && x.n > 0 ? <a href={`/expiring/${x.window}?${filter}`}>{t(lang, `expiring.window_${x.window}` as Key)}</a> : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </> : <p class="muted">{t(lang, "analytics.due_none")}</p>}
    </Panel>
  );
};

// -- the buyer view ------------------------------------------------------------------------

function buyerQueries(id: string, f: Frame, tables: readonly string[]): Record<string, Query> {
  const params = [id, SOURCE_NUMBER[f.source], f.first, f.last];
  const out: Record<string, Query> = {};
  for (const table of tables) {
    if (table === "quarters") out.quarters = { sql: BUYER_QUARTERS_SQL, params };
    if (table === "values") out.values = { sql: BUYER_VALUES_SQL, params };
    if (table === "records") out.records = { sql: BUYER_RECORDS_SQL, params };
    if (table === "segments" && SEGMENT_SOURCES.includes(f.source)) out.segments = { sql: BUYER_SEGMENTS_SQL, params };
    if (table === "competition" && f.source !== "grants") out.competition = { sql: BUYER_COMPETITION_SQL, params };
    if (table === "suppliers") out.suppliers = { sql: BUYER_SUPPLIERS_SQL, params };
    if (table === "growth" && AMENDED_SOURCES.includes(f.source)) out.growth = { sql: BUYER_GROWTH_SQL, params };
    // Whatever the source and period: the radar's quarters from the data date's.
    if (table === "due") out.due = { sql: BUYER_DUE_SQL, params: [id, f.current, f.current + DUE_YEARS - 1] };
  }
  return out;
}

// most: the fiscal years the reader's plan shows at once (planYears). ultra:
// Ultra's period is offered to a reader whose plan lacks it, which is only
// while Ultra is on sale (payments.ts ultraOnSale, whose cheap checks come
// first, so a site without Ultra's variables reads nothing for it).
type Ctx = { c: Context<AppEnv>; lang: Lang; stats: Stats; pro: boolean; most: number; ultra: boolean };

async function context(c: Context<AppEnv>): Promise<Ctx | Response> {
  const plan = await analyticsPlan(c);
  if (!plan) return c.notFound();
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "analytics.title");
  const most = planYears(plan);
  return { c, lang, stats, pro: allowsAnalytics(plan), most, ultra: most < ULTRA_YEARS && (await ultraOnSale(c.env)) };
}

async function signedIn(c: Context<AppEnv>): Promise<boolean> {
  return !!(await railAccount(c).catch(() => undefined))?.email;
}

// The buyer's id, its names and its record counts, or the response for an
// address that names no buyer (a 404, or a 301 to the id it moved to).
async function resolveBuyer(c: Context<AppEnv>, stats: Stats, suffix: string) {
  const id = (c.req.param("id") ?? "").toLowerCase();
  if (!BUYER_ID_RE.test(id) || id.length > 80) return c.notFound();
  const redirect = lowerRedirect(c, `/buyers/${id}${suffix}`);
  if (redirect) return redirect;
  const b = await loadBuyer(c.env, id);
  if (b) return b;
  const moved = await loadBuyerAlias(c.env, id);
  if (moved) {
    c.header("Cache-Control", "public, max-age=300");
    return c.redirect(`/buyers/${moved}${suffix}${new URL(c.req.url).search}`, 301);
  }
  return notFoundPage(c, stats.data_as_of, "buyer.not_found", "/buyers", "buyer.back");
}

export async function buyerAnalytics(c: Context<AppEnv>): Promise<Response> {
  const ctx = await context(c);
  if (ctx instanceof Response) return ctx;
  const { lang, stats, pro, most, ultra } = ctx;
  const b = await resolveBuyer(c, stats, "/analytics");
  if (b instanceof Response) return b;
  const id = b.buyer.id;
  const counts = { awards: b.buyer.n_awards, history: b.buyer.n_history, contracts: b.buyer.n_contracts, grants: b.buyer.n_grants };
  const frame = readFrame(c, stats, pro, MONEY_SOURCES, largestSource(counts, MONEY_SOURCES), pro ? most : FREE_YEARS);
  const { read, rows } = await readNamed(c, buyerQueries(id, frame, pro ? VIEW_TABLES.buyer : ["quarters"]));
  const name = pick(lang, b.buyer.name_en, b.buyer.name_fr) ?? b.buyer.name_en;
  const base = `/buyers/${id}/analytics`;
  const s: Shell = {
    view: "buyer", lang, stats, name, base, frame, pro, ultra, allowed: MONEY_SOURCES, active: "/buyers", back: `/buyers/${id}`, backKey: "analytics.back_buyer",
    crumbs: [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "buyers.title"), path: "/buyers" }, { name, path: `/buyers/${id}` }],
  };
  if (read.state !== "ready") return shell(c, s, read, null);

  const quarters = rows.quarters ?? [];
  const total = quarters.reduce((sum, r) => sum + int(r.cents), 0);
  const csv = (table: string) => query(`${base}/${table}.csv`, frame);
  const first = (
    <Panel title={t(lang, "analytics.panel_quarters")} tools={pro ? <CsvLink lang={lang} href={csv("quarters")} /> : undefined}
      foot={<span>{t(lang, "analytics.foot_quarters")}</span>}>
      {quarters.length ? <QuarterChart lang={lang} rows={quarters} frame={frame} /> : <p class="muted">{t(lang, "analytics.none")}</p>}
      {pro && quarters.length ? <QuarterTable lang={lang} rows={quarters} frame={frame} /> : null}
      {pro ? null : <FreeNote lang={lang} view="buyer" signedIn={await signedIn(c)} asked={frame.asked} />}
    </Panel>
  );
  if (!pro) {
    return shell(c, s, read, <>
      {first}
      <Locked lang={lang} title={t(lang, "analytics.panel_values")} text={t(lang, "analytics.tease_values")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_records")} text={t(lang, "analytics.tease_records")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_segments")} text={t(lang, "analytics.tease_buyer_segments")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_competition")} text={t(lang, "analytics.tease_competition")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_suppliers")} text={t(lang, "analytics.tease_suppliers")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_growth")} text={t(lang, "analytics.tease_growth")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_due")} text={t(lang, "analytics.tease_due")} />
    </>);
  }

  const segments = rows.segments ?? [];
  const competition = rows.competition ?? [];
  const suppliers = rows.suppliers ?? [];
  const nOrgs = int(suppliers[0]?.n_orgs);
  const topShare = (k: number) => share(lang, suppliers.slice(0, k).reduce((sum, r) => sum + int(r.cents), 0), total);
  const segRows = segments.map((r) => ({ label: segmentLink(lang, int(r.sid)), name: segmentLabel(lang, segmentCode(int(r.sid))), n: int(r.n), cents: r.cents, share: share(lang, num(r.cents), total) }));
  const supRows = suppliers.map((r) => {
    const oid = orgIdOf(int(r.oid));
    return { label: <a href={`/organizations/${oid}`}>{orgName(r)}</a>, name: orgName(r), n: int(r.n), cents: r.cents, share: share(lang, num(r.cents), total) };
  });
  return shell(c, s, read, <>
    {first}
    <ValuesPanel lang={lang} rows={rows.values ?? []} frame={frame} csv={csv("values")} />
    <RecordsPanel lang={lang} rows={rows.records ?? []} frame={frame} party="organization" csv={csv("records")} />
    <Panel title={t(lang, "analytics.panel_segments")} tools={segments.length ? <CsvLink lang={lang} href={csv("segments")} /> : undefined}
      foot={SEGMENT_SOURCES.includes(frame.source) ? <span>{t(lang, "analytics.foot_segments")}</span> : undefined}>
      {!SEGMENT_SOURCES.includes(frame.source) ? <p class="muted">{t(lang, "analytics.no_segments")}</p>
        : segRows.length ? <>
          <RankedBars rows={rankBars(lang, segRows)} aria={t(lang, "analytics.panel_segments")} />
          <RankTable lang={lang} head={t(lang, "col.segment")} rows={segRows} />
        </> : <p class="muted">{t(lang, "analytics.none")}</p>}
    </Panel>
    <Panel title={t(lang, "analytics.panel_competition")} tools={competition.length ? <CsvLink lang={lang} href={csv("competition")} /> : undefined}
      foot={frame.source === "grants" ? undefined : <span>{t(lang, "analytics.foot_competition")}</span>}>
      {frame.source === "grants" ? <p class="muted">{t(lang, "analytics.no_competition")}</p>
        : competition.length ? <CompetitionView lang={lang} rows={competition} frame={frame} /> : <p class="muted">{t(lang, "analytics.none")}</p>}
    </Panel>
    <Panel title={t(lang, "analytics.panel_suppliers")} tools={suppliers.length ? <CsvLink lang={lang} href={csv("suppliers")} /> : undefined}
      foot={<span>{t(lang, "analytics.foot_suppliers")}</span>}>
      {supRows.length ? <>
        {total > 0 ? (
          <p class="figures">
            <span>{t(lang, "analytics.top_1")} <b>{topShare(1)}</b></span>
            <span>{t(lang, "analytics.top_5")} <b>{topShare(5)}</b></span>
            <span>{t(lang, "analytics.top_10")} <b>{topShare(10)}</b></span>
            <span>{tn(lang, "analytics.orgs_one", "analytics.orgs_many", nOrgs, { n: fmtInt(nOrgs, lang) })}</span>
          </p>
        ) : null}
        <RankedBars rows={rankBars(lang, supRows)} aria={t(lang, "analytics.panel_suppliers")} />
        <RankTable lang={lang} head={t(lang, "col.organization")} rows={supRows} />
      </> : <p class="muted">{t(lang, "analytics.none")}</p>}
    </Panel>
    <GrowthPanel lang={lang} rows={rows.growth ?? []} frame={frame} csv={csv("growth")} />
    <DuePanel lang={lang} rows={rows.due ?? []} from={read.asOf ?? todayOf(stats.data_as_of)} radarDay={todayOf(stats.data_as_of)}
      filter={`buyer=${id}`} csv={csv("due")} noun="analytics.due_lead_buyer" />
  </>);
}

const QuarterTable: FC<{ lang: Lang; rows: Row[]; frame: Frame }> = ({ lang, rows, frame }) => {
  const years: number[] = [];
  for (let y = frame.last; y >= frame.first; y--) years.push(y);
  const cell = (y: number, q: number) => rows.find((r) => int(r.fy) === y && int(r.fq) === q);
  const quarter = (q: number) => t(lang, "analytics.quarter", { n: q });
  return (
    <div class="table-wrap">
      {/* With the four quarters shown (from 1280 px) the count without a published value rests below
          1440 px; from 700 to 1439 px it shows under the year's value. */}
      <Table cols={[
        { kind: "date", label: t(lang, "analytics.col_fy") },
        ...[1, 2, 3, 4].map((q) => ({ kind: "value" as const, label: quarter(q), rest: "md" as const })),
        { kind: "main", label: t(lang, "analytics.col_year_value") },
        { kind: "count", label: t(lang, "col.records") },
        { kind: "count", label: t(lang, "analytics.col_no_value"), rest: "lg" },
      ]}>
        <tbody>
          {years.map((y) => {
            const mine = rows.filter((r) => int(r.fy) === y);
            const value = mine.some((r) => num(r.cents) !== null) ? mine.reduce((s, r) => s + int(r.cents), 0) / 100 : null;
            const noValue = mine.reduce((s, r) => s + int(r.n_no_value), 0);
            return (
              <tr>
                <td data-label={t(lang, "analytics.col_fy")} class="mono"><FyCell lang={lang} year={y} current={frame.current} /></td>
                {[1, 2, 3, 4].map((q) => {
                  const r = cell(y, q);
                  return <td data-label={quarter(q)} class="mono num mdh">{r ? money(lang, dollars(r.cents)) : ""}</td>;
                })}
                <td data-label={t(lang, "analytics.col_year_value")} class="mono num">
                  {mine.length ? money(lang, value) : ""}
                  {mine.length ? <span class="lg-down muted small">{t(lang, "common.labelled", { label: t(lang, "analytics.col_no_value"), value: fmtInt(noValue, lang) })}</span> : null}
                </td>
                <td data-label={t(lang, "col.records")} class="mono num">{fmtInt(mine.reduce((s, r) => s + int(r.n), 0), lang)}</td>
                <td data-label={t(lang, "analytics.col_no_value")} class="mono num lgh">{fmtInt(noValue, lang)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
};

const CompetitionView: FC<{ lang: Lang; rows: Row[]; frame: Frame }> = ({ lang, rows, frame }) => {
  const n = (v: number) => fmtInt(v, lang);
  const m = (v: number) => fmtMoney(v / 100, lang);
  const byCount: YearPoint[] = rows.filter((r) => int(r.n) > 0)
    .map((r) => [int(r.fy), (int(r.n_nc) / int(r.n)) * 100, [partOf(lang, int(r.n_nc), int(r.n), n)]]);
  const byValue: YearPoint[] = rows.filter((r) => int(r.pos) > 0)
    .map((r) => [int(r.fy), (int(r.pos_nc) / int(r.pos)) * 100, [partOf(lang, int(r.pos_nc), int(r.pos), m)]]);
  return (
    <>
      <ShareLines lang={lang} frame={frame} panels={[
        { title: t(lang, "analytics.nc_by_count"), values: byCount },
        { title: t(lang, "analytics.nc_by_value"), values: byValue },
      ]} />
      <div class="table-wrap">
        <Table cols={[
          { kind: "date", label: t(lang, "analytics.col_fy") },
          { kind: "count", label: t(lang, "col.records") },
          { kind: "share", label: <span title={t(lang, "competitive.def_no")}>{t(lang, "org.col_nc_count")}</span> },
          { kind: "count", label: t(lang, "competitive.unstated"), rest: "md" },
          { kind: "main", label: <span title={t(lang, "competitive.def_no")}>{t(lang, "org.col_nc_value")}</span> },
        ]}>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr>
                <td data-label={t(lang, "analytics.col_fy")} class="mono"><FyCell lang={lang} year={int(r.fy)} current={frame.current} /></td>
                <td data-label={t(lang, "col.records")} class="mono num">{n(int(r.n))}</td>
                <td data-label={t(lang, "org.col_nc_count")} class="mono num">{shareText(lang, int(r.n_nc), int(r.n), n)}</td>
                <td data-label={t(lang, "competitive.unstated")} class="mono num mdh">{n(int(r.n_unstated))}</td>
                <td data-label={t(lang, "org.col_nc_value")} class="mono num">{shareText(lang, int(r.pos_nc), num(r.pos), m)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
};

// -- the organization view -------------------------------------------------------------------

interface ShareSpec { segment: number; rivals: number[]; chosen: boolean }

function shareParams(oid: number, f: Frame, spec: ShareSpec): (string | number)[] {
  const slots = [oid, ...spec.rivals];
  while (slots.length < SHARE_SLOTS) slots.push(-1);
  // ?11: when the reader chose none, the statement takes the segment's largest others itself.
  return [spec.segment, SOURCE_NUMBER[f.source], f.first, f.last, ...slots, spec.chosen ? 0 : MAX_RIVALS];
}

function orgQueries(oid: number, f: Frame, tables: readonly string[], spec: ShareSpec | null): Record<string, Query> {
  const params = [oid, SOURCE_NUMBER[f.source], f.first, f.last];
  const out: Record<string, Query> = {};
  const segments = SEGMENT_SOURCES.includes(f.source);
  for (const table of tables) {
    if (table === "years") out.years = { sql: ORG_YEARS_SQL, params };
    if (table === "records") out.records = { sql: ORG_RECORDS_SQL, params };
    if (table === "growth" && AMENDED_SOURCES.includes(f.source)) out.growth = { sql: ORG_GROWTH_SQL, params };
    if (table === "buyers") out.buyers = { sql: ORG_BUYERS_SQL, params };
    if (table === "segments" && segments) out.segments = { sql: ORG_SEGMENTS_SQL, params };
    if (table === "share" && segments && spec) {
      out.rivals = { sql: SEGMENT_WINNERS_SQL, params: [spec.segment, SOURCE_NUMBER[f.source], f.first, f.last] };
      out.share = { sql: ORG_SHARE_SQL, params: shareParams(oid, f, spec) };
    }
  }
  return out;
}

// The share chart's segment and organizations from the address: a segment
// that is one of the 57, and the organizations chosen (format checked here;
// only those among the segment's largest are shown).
function readShare(c: Context<AppEnv>, self: string): { segment: number | null; rivals: number[] } {
  const url = new URL(c.req.url);
  const raw = (url.searchParams.get("segment") ?? "").trim();
  const segment = SEGMENT_RE.test(raw) ? segmentNumber(raw) : null;
  return { segment, rivals: readRivals(url, self).map((id) => orgNumber(id) as number) };
}

// The organization view's data: one batch, or two when the share chart must
// first learn the organization's largest segment.
async function orgData(c: Context<AppEnv>, oid: number, self: string, frame: Frame, tables: readonly string[]) {
  const asked = readShare(c, self);
  const spec = (segment: number): ShareSpec => ({ segment, rivals: asked.rivals, chosen: asked.rivals.length > 0 });
  const wantShare = tables.includes("share") && SEGMENT_SOURCES.includes(frame.source);
  const firstTables = wantShare && asked.segment === null ? [...new Set([...tables.filter((x) => x !== "share"), "segments"])] : tables;
  const one = await readNamed(c, orgQueries(oid, frame, firstTables, asked.segment === null ? null : spec(asked.segment)));
  let segment = asked.segment;
  if (one.read.state !== "ready" || !wantShare || segment !== null) return { ...one, segment };
  const top = one.rows.segments?.[0];
  if (!top) return { ...one, segment: null };
  segment = int(top.sid);
  const two = await readNamed(c, orgQueries(oid, frame, ["share"], spec(segment)));
  if (two.read.state !== "ready") return { ...two, segment };
  return { read: one.read, rows: { ...one.rows, ...two.rows }, segment };
}

export async function organizationAnalytics(c: Context<AppEnv>): Promise<Response> {
  const ctx = await context(c);
  if (ctx instanceof Response) return ctx;
  const { lang, stats, pro, most, ultra } = ctx;
  const id = (c.req.param("id") ?? "").toLowerCase();
  const oid = orgNumber(id);
  if (oid === null) return c.notFound();
  const redirect = lowerRedirect(c, `/organizations/${id}/analytics`);
  if (redirect) return redirect;
  const profile = await loadProfile(c.env, id);
  if (!profile) {
    return (await retiredIdRedirect(c, id, "/analytics")) ??
      notFoundPage(c, stats.data_as_of, "org.not_found", "/organizations", "org.back");
  }
  const o = profile.organization;
  const counts = { awards: o.n_awards, history: o.n_history, contracts: o.n_contracts, grants: o.n_grants };
  const frame = readFrame(c, stats, pro, MONEY_SOURCES, largestSource(counts, MONEY_SOURCES), pro ? most : FREE_YEARS);
  const base = `/organizations/${id}/analytics`;
  const name = o.display_name;
  const data = pro
    ? await orgData(c, oid, id, frame, VIEW_TABLES.organization)
    : { ...(await readNamed(c, orgQueries(oid, frame, ["years"], null))), segment: null };
  const { read, rows } = data;
  const chosen = readRivals(new URL(c.req.url), id);
  const more: Record<string, string | readonly string[]> = pro && data.segment !== null
    ? { segment: segmentCode(data.segment), vs: chosen } : {};
  const s: Shell = {
    view: "organization", lang, stats, name, base, frame, pro, ultra, allowed: MONEY_SOURCES, active: "/organizations", more,
    back: `/organizations/${id}`, backKey: "analytics.back_organization",
    crumbs: [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "nav.organizations"), path: "/organizations" }, { name, path: `/organizations/${id}` }],
  };
  if (read.state !== "ready") return shell(c, s, read, null);

  const years = rows.years ?? [];
  const csv = (table: string) => query(`${base}/${table}.csv`, frame, more);
  const first = (
    <Panel title={t(lang, "analytics.panel_years")} tools={pro ? <CsvLink lang={lang} href={csv("years")} /> : undefined}>
      {years.length ? (
        <YearChart lang={lang} frame={frame} fmt={(v) => fmtMoneyShort(v, lang)}
          panels={[{
            title: t(lang, "analytics.chart_years", { source: sourceLabel(lang, frame.source) }),
            values: years.map((r): YearPoint => [int(r.fy), int(r.cents) / 100, [fmtMoney(int(r.cents) / 100, lang), recordsText(lang, int(r.n))]]),
          }]} />
      ) : <p class="muted">{t(lang, "analytics.none")}</p>}
      {pro && years.length ? <OrgYearTable lang={lang} rows={years} frame={frame} /> : null}
      {pro ? null : <FreeNote lang={lang} view="organization" signedIn={await signedIn(c)} asked={frame.asked} />}
    </Panel>
  );
  if (!pro) {
    return shell(c, s, read, <>
      {first}
      <Locked lang={lang} title={t(lang, "analytics.panel_records")} text={t(lang, "analytics.tease_records")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_buyers")} text={t(lang, "analytics.tease_org_buyers")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_segments")} text={t(lang, "analytics.tease_org_segments")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_share")} text={t(lang, "analytics.tease_share", { n: MAX_RIVALS })} />
      <Locked lang={lang} title={t(lang, "analytics.panel_growth")} text={t(lang, "analytics.tease_growth")} />
    </>);
  }

  const total = years.reduce((sum, r) => sum + int(r.cents), 0);
  const buyers = (rows.buyers ?? []).map((r) => {
    const label = pick(lang, r.name_en as string, r.name_fr as string | null) ?? String(r.id);
    return { label: <a href={`/buyers/${r.id}`}>{label}</a>, name: label, n: int(r.n), cents: r.cents, share: share(lang, num(r.cents), total) };
  });
  const segRows = (rows.segments ?? []).map((r) => ({
    label: segmentLink(lang, int(r.sid)), name: segmentLabel(lang, segmentCode(int(r.sid))), n: int(r.n), cents: r.cents, share: share(lang, num(r.cents), total),
  }));
  const segmentSource = SEGMENT_SOURCES.includes(frame.source);
  return shell(c, s, read, <>
    {first}
    <RecordsPanel lang={lang} rows={rows.records ?? []} frame={frame} party="buyer" csv={csv("records")} />
    <Panel title={t(lang, "analytics.panel_buyers")} tools={buyers.length ? <CsvLink lang={lang} href={csv("buyers")} /> : undefined}>
      {buyers.length ? <>
        <RankedBars rows={rankBars(lang, buyers)} aria={t(lang, "analytics.panel_buyers")} />
        <RankTable lang={lang} head={t(lang, "col.buyer")} rows={buyers} />
      </> : <p class="muted">{t(lang, "analytics.none")}</p>}
    </Panel>
    <Panel title={t(lang, "analytics.panel_segments")} tools={segRows.length ? <CsvLink lang={lang} href={csv("segments")} /> : undefined}
      foot={segmentSource ? <span>{t(lang, "analytics.foot_segments")}</span> : undefined}>
      {!segmentSource ? <p class="muted">{t(lang, "analytics.no_segments")}</p> : segRows.length ? <>
        <RankedBars rows={rankBars(lang, segRows)} aria={t(lang, "analytics.panel_segments")} />
        <RankTable lang={lang} head={t(lang, "col.segment")} rows={segRows} />
      </> : <p class="muted">{t(lang, "analytics.none")}</p>}
    </Panel>
    <SharePanel lang={lang} oid={oid} name={name} frame={frame} base={base} segment={data.segment} segmentSource={segmentSource}
      options={(rows.segments ?? []).map((r) => int(r.sid))} rivals={rows.rivals ?? []} share={rows.share ?? []} chosen={chosen}
      csv={data.segment !== null ? csv("share") : null} />
    <GrowthPanel lang={lang} rows={rows.growth ?? []} frame={frame} csv={csv("growth")} />
  </>);
}

const OrgYearTable: FC<{ lang: Lang; rows: Row[]; frame: Frame }> = ({ lang, rows, frame }) => {
  const n = (v: number) => fmtInt(v, lang);
  return (
    <div class="table-wrap">
      <Table cols={[
        { kind: "date", label: t(lang, "analytics.col_fy") },
        { kind: "count", label: t(lang, "col.records") },
        { kind: "main", label: t(lang, "col.value") },
        { kind: "count", label: t(lang, "analytics.col_no_value"), rest: "md" },
        { kind: "share", label: <span title={t(lang, "competitive.def_no")}>{t(lang, "org.col_nc_count")}</span> },
      ]}>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr>
              <td data-label={t(lang, "analytics.col_fy")} class="mono"><FyCell lang={lang} year={int(r.fy)} current={frame.current} /></td>
              <td data-label={t(lang, "col.records")} class="mono num">{n(int(r.n))}</td>
              <td data-label={t(lang, "col.value")} class="mono num">{money(lang, dollars(r.cents))}</td>
              <td data-label={t(lang, "analytics.col_no_value")} class="mono num mdh">{n(int(r.n_no_value))}</td>
              <td data-label={t(lang, "org.col_nc_count")} class="mono num">{shareText(lang, int(r.n_nc), frame.source === "grants" ? null : int(r.n), n)}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
};

// The organization's share of one segment's value by fiscal year, beside the
// organizations chosen from the segment's largest (by default its five
// largest others), one panel each on one scale: small multiples, so no
// organization is told apart by colour alone.
const SharePanel: FC<{
  lang: Lang; oid: number; name: string; frame: Frame; base: string; segment: number | null; segmentSource: boolean;
  options: number[]; rivals: Row[]; share: Row[]; chosen: string[]; csv: string | null;
}> = ({ lang, oid, name, frame, base, segment, segmentSource, options, rivals, share: shareRows, chosen, csv }) => {
  const title = t(lang, "analytics.panel_share");
  if (!segmentSource || segment === null) {
    return <Panel title={title}><p class="muted">{t(lang, segmentSource ? "analytics.none" : "analytics.no_segments")}</p></Panel>;
  }
  const names = new Map(rivals.map((r) => [int(r.oid), orgName(r)]));
  const allowed = new Set(rivals.map((r) => int(r.oid)));
  // Only organizations among the segment's largest are compared; the profile's own always is.
  const shown = [oid, ...[...new Set(shareRows.map((r) => num(r.oid)).filter((v): v is number => v !== null && v !== oid))]
    .filter((v) => allowed.has(v))];
  const segTotal = new Map<number, number>();
  for (const r of shareRows) segTotal.set(int(r.fy), int(r.seg_cents));
  const periodTotal = [...segTotal.values()].reduce((a, b) => a + b, 0);
  const label = (o: number) => (o === oid ? name : names.get(o) ?? orgIdOf(o));
  const panels = shown.map((o) => {
    const mine = shareRows.filter((r) => num(r.oid) === o);
    return {
      title: label(o),
      values: mine.filter((r) => int(r.seg_cents) > 0).map((r): YearPoint => [
        int(r.fy), (int(r.cents) / int(r.seg_cents)) * 100, [partOf(lang, int(r.cents), int(r.seg_cents), (v) => fmtMoney(v / 100, lang))],
      ]),
      n: mine.reduce((s, r) => s + int(r.n), 0),
      cents: mine.reduce((s, r) => s + int(r.cents), 0),
    };
  });
  const code = segmentCode(segment);
  const choices = [...new Set([segment, ...options])];
  return (
    <Panel title={title} tools={csv ? <CsvLink lang={lang} href={csv} /> : undefined}
      foot={<span>{t(lang, "analytics.foot_share", { n: MAX_RIVALS, m: RIVALS_N })}</span>}>
      <p>{tj(lang, "analytics.share_lead", { segment: segmentLink(lang, segment), source: sourceLabel(lang, frame.source) })}</p>
      <form method="get" action={base} class="toolbar">
        <FrameFields frame={frame} />
        <div class="toolbar-fields">
          <label class="field">
            <span>{t(lang, "col.segment")}</span>
            <select name="segment">
              {choices.map((sid) => <option value={segmentCode(sid)} selected={sid === segment}>{`${segmentCode(sid)} ${segmentLabel(lang, segmentCode(sid))}`}</option>)}
            </select>
          </label>
        </div>
        {rivals.filter((r) => int(r.oid) !== oid).length ? (
          <fieldset class="toolbar-row">
            <legend class="toolbar-label">{t(lang, "analytics.share_pick", { n: MAX_RIVALS })}</legend>
            {rivals.filter((r) => int(r.oid) !== oid).map((r) => {
              const rid = orgIdOf(int(r.oid));
              return (
                <label class="check">
                  <input type="checkbox" name="vs" value={rid} checked={chosen.length ? chosen.includes(rid) : shown.includes(int(r.oid))} />
                  <span>{orgName(r)}</span>
                </label>
              );
            })}
          </fieldset>
        ) : null}
        <div class="toolbar-actions">
          <button type="submit" class="btn btn-primary">{t(lang, "analytics.share_apply")}</button>
          <a href={query(base, frame, { segment: code })} class="btn" rel="nofollow">{t(lang, "analytics.share_reset")}</a>
        </div>
      </form>
      {periodTotal > 0 ? (
        <YearChart lang={lang} frame={frame} shared fmt={(v) => t(lang, "pct", { n: Math.round(v) })}
          panels={panels.map((p) => ({ title: p.title, values: p.values }))} />
      ) : <p class="muted">{t(lang, "analytics.none")}</p>}
      <div class="table-wrap">
        <Table cols={[
          { kind: "main", label: t(lang, "col.organization") },
          { kind: "count", label: t(lang, "col.records") },
          { kind: "total", label: t(lang, "col.value") },
          { kind: "count", label: t(lang, "analytics.col_share") },
        ]}>
          <tbody>
            {panels.map((p, i) => (
              <tr>
                <td data-label={t(lang, "col.organization")}>
                  {shown[i] === oid ? <strong>{p.title}</strong> : <a href={`/organizations/${orgIdOf(shown[i])}`}>{p.title}</a>}
                </td>
                <td data-label={t(lang, "col.records")} class="mono num">{fmtInt(p.n, lang)}</td>
                <td data-label={t(lang, "col.value")} class="mono num">{money(lang, p.n ? p.cents / 100 : null)}</td>
                <td data-label={t(lang, "analytics.col_share")} class="mono num">{share(lang, p.cents, periodTotal)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Panel>
  );
};

// -- the segment view ------------------------------------------------------------------------

function segmentQueries(sid: number, f: Frame, tables: readonly string[]): Record<string, Query> {
  const params = [sid, SOURCE_NUMBER[f.source], f.first, f.last];
  const out: Record<string, Query> = {};
  for (const table of tables) {
    if (table === "years") out.years = { sql: SEGMENT_YEARS_SQL, params };
    if (table === "values") out.values = { sql: SEGMENT_VALUES_SQL, params };
    if (table === "records") out.records = { sql: SEGMENT_RECORDS_SQL, params };
    if (table === "buyers") out.buyers = { sql: SEGMENT_BUYERS_SQL, params };
    if (table === "winners") out.winners = { sql: SEGMENT_WINNERS_SQL, params };
    if (table === "entrants") {
      out.entrants = { sql: SEGMENT_ENTRANTS_SQL, params: [sid, SOURCE_NUMBER[f.source], f.last - ENTRANT_LOOKBACK, f.last] };
    }
    if (table === "due") out.due = { sql: SEGMENT_DUE_SQL, params: [sid, f.current, f.current + DUE_YEARS - 1] };
  }
  return out;
}

export async function segmentAnalytics(c: Context<AppEnv>): Promise<Response> {
  const ctx = await context(c);
  if (ctx instanceof Response) return ctx;
  const { lang, stats, pro, most, ultra } = ctx;
  const code = c.req.param("nn") ?? "";
  const sid = SEGMENT_RE.test(code) ? segmentNumber(code) : null;
  if (sid === null) return c.notFound();
  const frame = readFrame(c, stats, pro, SEGMENT_SOURCES, "awards", pro ? most : FREE_YEARS);
  const { read, rows } = await readNamed(c, segmentQueries(sid, frame, pro ? VIEW_TABLES.segment : ["years"]));
  const name = segmentLabel(lang, code);
  const base = `/segments/${code}/analytics`;
  const s: Shell = {
    view: "segment", lang, stats, name, base, frame, pro, ultra, allowed: SEGMENT_SOURCES, active: "/segments",
    back: `/segments/${code}`, backKey: "analytics.back_segment",
    crumbs: [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "segments.title"), path: "/segments" }, { name: `${code} ${name}`, path: `/segments/${code}` }],
  };
  if (read.state !== "ready") return shell(c, s, read, null);

  const years = rows.years ?? [];
  const csv = (table: string) => query(`${base}/${table}.csv`, frame);
  const first = (
    <Panel title={t(lang, "analytics.panel_activity")} tools={pro ? <CsvLink lang={lang} href={csv("years")} /> : undefined}
      foot={<span>{t(lang, "analytics.foot_activity")}</span>}>
      {years.length ? (
        <YearChart lang={lang} frame={frame} fmt={(v) => fmtInt(v, lang)} panels={[
          { title: t(lang, "analytics.chart_buyers"), values: years.map((r): YearPoint => [int(r.fy), int(r.n_buyers), [fmtInt(int(r.n_buyers), lang)]]) },
          { title: t(lang, "analytics.chart_orgs"), values: years.map((r): YearPoint => [int(r.fy), int(r.n_orgs), [fmtInt(int(r.n_orgs), lang)]]) },
        ]} />
      ) : <p class="muted">{t(lang, "analytics.none")}</p>}
      {pro && years.length ? <SegmentYearTable lang={lang} rows={years} frame={frame} /> : null}
      {pro ? null : <FreeNote lang={lang} view="segment" signedIn={await signedIn(c)} asked={frame.asked} />}
    </Panel>
  );
  if (!pro) {
    return shell(c, s, read, <>
      {first}
      <Locked lang={lang} title={t(lang, "analytics.panel_values")} text={t(lang, "analytics.tease_values")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_records")} text={t(lang, "analytics.tease_records")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_segment_buyers")} text={t(lang, "analytics.tease_segment_buyers")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_winners")} text={t(lang, "analytics.tease_winners")} />
      <Locked lang={lang} title={t(lang, "analytics.panel_entrants")} text={t(lang, "analytics.tease_entrants", { n: ENTRANT_LOOKBACK })} />
      <Locked lang={lang} title={t(lang, "analytics.panel_due")} text={t(lang, "analytics.tease_due")} />
    </>);
  }

  const total = years.reduce((sum, r) => sum + int(r.cents), 0);
  const buyers = (rows.buyers ?? []).map((r) => {
    const label = pick(lang, r.name_en as string, r.name_fr as string | null) ?? String(r.id);
    return { label: <a href={`/buyers/${r.id}`}>{label}</a>, name: label, n: int(r.n), cents: r.cents, share: share(lang, num(r.cents), total) };
  });
  const winners = (rows.winners ?? []).slice(0, TOP_N).map((r) => ({
    label: <a href={`/organizations/${orgIdOf(int(r.oid))}`}>{orgName(r)}</a>, name: orgName(r), n: int(r.n), cents: r.cents,
    share: share(lang, num(r.cents), total),
  }));
  const entrants = rows.entrants ?? [];
  const nNew = int(entrants[0]?.n_new);
  return shell(c, s, read, <>
    {first}
    <ValuesPanel lang={lang} rows={rows.values ?? []} frame={frame} csv={csv("values")} />
    <RecordsPanel lang={lang} rows={rows.records ?? []} frame={frame} party="both" csv={csv("records")} />
    <Panel title={t(lang, "analytics.panel_segment_buyers")} tools={buyers.length ? <CsvLink lang={lang} href={csv("buyers")} /> : undefined}
      foot={<span>{t(lang, "analytics.foot_segments")}</span>}>
      {buyers.length ? <>
        <RankedBars rows={rankBars(lang, buyers)} aria={t(lang, "analytics.panel_segment_buyers")} />
        <RankTable lang={lang} head={t(lang, "col.buyer")} rows={buyers} />
      </> : <p class="muted">{t(lang, "analytics.none")}</p>}
    </Panel>
    <Panel title={t(lang, "analytics.panel_winners")} tools={winners.length ? <CsvLink lang={lang} href={csv("winners")} /> : undefined}>
      {winners.length ? <>
        <RankedBars rows={rankBars(lang, winners)} aria={t(lang, "analytics.panel_winners")} />
        <RankTable lang={lang} head={t(lang, "col.organization")} rows={winners} />
      </> : <p class="muted">{t(lang, "analytics.none")}</p>}
    </Panel>
    <Panel title={t(lang, "analytics.panel_entrants")} tools={entrants.length ? <CsvLink lang={lang} href={csv("entrants")} /> : undefined}
      foot={<span>{t(lang, "analytics.foot_entrants", { n: ENTRANT_LOOKBACK })}</span>}>
      <p>{tn(lang, "analytics.entrants_one", "analytics.entrants_many", nNew, { n: fmtInt(nNew, lang), fy: fy(lang, frame.last, frame.current) })}</p>
      {entrants.length ? (
        <RankTable lang={lang} head={t(lang, "col.organization")} rows={entrants.map((r) => ({
          label: <a href={`/organizations/${orgIdOf(int(r.oid))}`}>{orgName(r)}</a>, n: int(r.n), cents: r.cents,
          share: share(lang, num(r.cents), int(years.find((y) => int(y.fy) === frame.last)?.cents)),
        }))} />
      ) : null}
    </Panel>
    <DuePanel lang={lang} rows={rows.due ?? []} from={read.asOf ?? todayOf(stats.data_as_of)} radarDay={todayOf(stats.data_as_of)}
      filter={`segment=${code}`} csv={csv("due")} noun="analytics.due_lead_segment" />
  </>);
}

const SegmentYearTable: FC<{ lang: Lang; rows: Row[]; frame: Frame }> = ({ lang, rows, frame }) => {
  const n = (v: number) => fmtInt(v, lang);
  return (
    <div class="table-wrap">
      <Table cols={[
        { kind: "date", label: t(lang, "analytics.col_fy") },
        { kind: "count", label: t(lang, "col.records") },
        { kind: "main", label: t(lang, "col.value") },
        { kind: "count", label: t(lang, "analytics.col_no_value"), rest: "md" },
        { kind: "count", label: t(lang, "analytics.col_buyers") },
        { kind: "count", label: t(lang, "analytics.col_orgs") },
      ]}>
        <tbody>
          {[...rows].reverse().map((r) => (
            <tr>
              <td data-label={t(lang, "analytics.col_fy")} class="mono"><FyCell lang={lang} year={int(r.fy)} current={frame.current} /></td>
              <td data-label={t(lang, "col.records")} class="mono num">{n(int(r.n))}</td>
              <td data-label={t(lang, "col.value")} class="mono num">{money(lang, dollars(r.cents))}</td>
              <td data-label={t(lang, "analytics.col_no_value")} class="mono num mdh">{n(int(r.n_no_value))}</td>
              <td data-label={t(lang, "analytics.col_buyers")} class="mono num">{n(int(r.n_buyers))}</td>
              <td data-label={t(lang, "analytics.col_orgs")} class="mono num">{n(int(r.n_orgs))}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
};

// -- the CSV files ----------------------------------------------------------------------------

// A cell of a CSV file: quoted when it holds a comma, a quote or a line
// break; a text starting with = + - @ gets a leading apostrophe, so a
// spreadsheet reads a name as text rather than as a formula.
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const cad = (cents: unknown) => {
  const c = num(cents);
  return c === null ? null : (c / 100).toFixed(2);
};

// Each table's columns and rows as the file writes them: plain figures,
// dollars with two decimals, fiscal years by their first calendar year with
// the label beside them.
function csvRows(view: View, table: string, rows: Record<string, Row[]>, segment: number | null): [string[], unknown[][]] | null {
  const fyCols = (r: Row) => [int(r.fy), fiscalLabel("en", int(r.fy))];
  const named = (r: Row) => [orgIdOf(int(r.oid)), orgName(r), int(r.n), cad(r.cents)];
  const buyer = (r: Row) => [String(r.id), String(r.name_en), r.name_fr ?? "", int(r.n), cad(r.cents)];
  const seg = (r: Row) => [segmentCode(int(r.sid)), segmentLabel("en", segmentCode(int(r.sid))), int(r.n), cad(r.cents)];
  const list = rows[table] ?? [];
  switch (`${view}/${table}`) {
    case "buyer/quarters":
      return [["fiscal_year", "fiscal_year_label", "quarter", "records", "value_cad", "records_without_value"],
        list.map((r) => [...fyCols(r), int(r.fq), int(r.n), cad(r.cents), int(r.n_no_value)])];
    case "buyer/segments":
    case "organization/segments":
      return [["segment", "segment_title", "records", "value_cad"], list.map(seg)];
    case "buyer/competition":
      return [["fiscal_year", "fiscal_year_label", "records", "non_competitive", "not_stated", "positive_value_cad", "non_competitive_positive_value_cad"],
        list.map((r) => [...fyCols(r), int(r.n), int(r.n_nc), int(r.n_unstated), cad(r.pos), cad(r.pos_nc)])];
    case "buyer/suppliers":
    case "segment/winners":
    case "segment/entrants":
      return [["organization_id", "organization", "records", "value_cad"], list.map(named)];
    case "organization/years":
      return [["fiscal_year", "fiscal_year_label", "records", "value_cad", "records_without_value", "non_competitive"],
        list.map((r) => [...fyCols(r), int(r.n), cad(r.cents), int(r.n_no_value), int(r.n_nc)])];
    case "organization/buyers":
    case "segment/buyers":
      return [["buyer_id", "buyer", "buyer_fr", "records", "value_cad"], list.map(buyer)];
    case "organization/share":
      return [["segment", "fiscal_year", "fiscal_year_label", "segment_value_cad", "organization_id", "records", "value_cad"],
        list.filter((r) => num(r.oid) !== null).map((r) => [segment === null ? "" : segmentCode(segment), ...fyCols(r), cad(r.seg_cents), orgIdOf(int(r.oid)), int(r.n), cad(r.cents)])];
    case "segment/years":
      return [["fiscal_year", "fiscal_year_label", "records", "value_cad", "records_without_value", "buyers", "organizations"],
        list.map((r) => [...fyCols(r), int(r.n), cad(r.cents), int(r.n_no_value), int(r.n_buyers), int(r.n_orgs)])];
    case "buyer/values":
    case "segment/values":
      return [["fiscal_year", "fiscal_year_label", "records_with_value_above_zero", "median_cad", "average_cad"],
        list.map((r) => [...fyCols(r), int(r.n_pos), int(r.n_pos) > 0 ? cad(r.med) : null,
          int(r.n_pos) > 0 ? (int(r.pos) / int(r.n_pos) / 100).toFixed(2) : null])];
    case "buyer/growth":
    case "organization/growth":
      return [["fiscal_year", "fiscal_year_label", "records", "amended", "amended_compared", "amended_grew", "first_value_cad", "last_value_cad"],
        list.map((r) => [...fyCols(r), int(r.n), int(r.n_amended), int(r.n_compared), int(r.n_grew), cad(r.first_cents), cad(r.last_cents)])];
    case "buyer/records":
    case "organization/records":
    case "segment/records": {
      const head = ["rank", "source", "reference", "title", "fiscal_year", "fiscal_year_label", "value_cad"];
      const sources = Object.fromEntries(Object.entries(SOURCE_NUMBER).map(([k, v]) => [v, k]));
      const record = (r: Row, i: number) => [i + 1, sources[int(r.src)] ?? "", r.ref ?? "", r.title ?? "", ...fyCols(r), cad(r.cents)];
      const org = (r: Row) => (num(r.oid) === null ? ["", ""] : [orgIdOf(int(r.oid)), orgName(r)]);
      const by = (r: Row) => [r.buyer_id ?? "", r.name_en ?? "", r.name_fr ?? ""];
      if (view === "buyer") return [[...head, "organization_id", "organization"], list.map((r, i) => [...record(r, i), ...org(r)])];
      if (view === "organization") return [[...head, "buyer_id", "buyer", "buyer_fr"], list.map((r, i) => [...record(r, i), ...by(r)])];
      return [[...head, "organization_id", "organization", "buyer_id", "buyer", "buyer_fr"], list.map((r, i) => [...record(r, i), ...org(r), ...by(r)])];
    }
    case "buyer/due":
    case "segment/due":
      return [["fiscal_year", "fiscal_year_label", "quarter", "quarter_ends", "contracts", "value_cad", "contracts_without_value"],
        list.map((r) => [...fyCols(r), int(r.fq), quarterEnd(int(r.fy), int(r.fq)), int(r.n), cad(r.cents), int(r.n_no_value)])];
    default:
      return null;
  }
}

// What a file's name says it covers: the source and the fiscal years, or for
// the contracts ending (which follow neither) the fiscal year they count from.
const span = (table: string, f: Frame) => (table === "due" ? `from-${f.current}` : `${f.source}-${f.first}-${f.last}`);

// A view's table as a CSV file: Pro only (anyone else gets the site's 404, as
// for a file that is not there), read with that table's statement alone, sent
// private and never stored by a shared cache.
export async function analyticsCsv(c: Context<AppEnv>, view: View): Promise<Response> {
  const plan = await analyticsPlan(c);
  const file = c.req.param("table") ?? "";
  const table = file.replace(/\.csv$/, "");
  if (!plan || !allowsAnalytics(plan) || !(VIEW_TABLES[view] as readonly string[]).includes(table)) return c.notFound();
  // The period at most the reader's plan gives, as on the view.
  const most = planYears(plan);
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "analytics.title");
  let key: string;
  let data: { read: Read; rows: Record<string, Row[]>; segment: number | null };
  if (view === "buyer") {
    const b = await resolveBuyer(c, stats, `/analytics/${file}`);
    if (b instanceof Response) return b;
    const counts = { awards: b.buyer.n_awards, history: b.buyer.n_history, contracts: b.buyer.n_contracts, grants: b.buyer.n_grants };
    const frame = readFrame(c, stats, true, MONEY_SOURCES, largestSource(counts, MONEY_SOURCES), most);
    key = `${b.buyer.id}-${table}-${span(table, frame)}`;
    data = { ...(await readNamed(c, buyerQueries(b.buyer.id, frame, [table]))), segment: null };
  } else if (view === "organization") {
    const id = (c.req.param("id") ?? "").toLowerCase();
    const oid = orgNumber(id);
    const profile = oid === null ? null : await loadProfile(c.env, id);
    if (oid === null || !profile) return c.notFound();
    const o = profile.organization;
    const counts = { awards: o.n_awards, history: o.n_history, contracts: o.n_contracts, grants: o.n_grants };
    const frame = readFrame(c, stats, true, MONEY_SOURCES, largestSource(counts, MONEY_SOURCES), most);
    key = `${id}-${table}-${span(table, frame)}`;
    data = await orgData(c, oid, id, frame, [table]);
  } else {
    const code = c.req.param("nn") ?? "";
    const sid = SEGMENT_RE.test(code) ? segmentNumber(code) : null;
    if (sid === null) return c.notFound();
    const frame = readFrame(c, stats, true, SEGMENT_SOURCES, "awards", most);
    key = `segment-${code}-${table}-${span(table, frame)}`;
    data = { ...(await readNamed(c, segmentQueries(sid, frame, [table]))), segment: null };
  }
  c.header("Cache-Control", "no-store");
  if (data.read.state !== "ready") {
    c.header("Retry-After", "3600");
    return c.text(t(lang, data.read.state === "loading" ? "analytics.unavailable_loading" : "analytics.unavailable_text"), 503);
  }
  const made = csvRows(view, table, data.rows, data.segment) ?? [[], []];
  const body = [made[0], ...made[1]].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${key.replace(/[^a-z0-9.-]/gi, "-")}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
