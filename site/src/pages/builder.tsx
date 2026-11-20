// /analytics/build, the analytics builder (docs/analytics.md, "The builder"):
// a form of fixed menus (src/builder.ts, public/build-menu.js), its address
// the view, and under it one chart and its table, the line naming the source,
// the period and the data date, and the view's CSV file at
// /analytics/build.csv with the same query.
//
// Ultra's part (feature "builder", src/account/entitlements.ts), behind its
// own switch: while BUILDER is not "on", or the accounts switch is off, both
// addresses are the site's 404 (plan.ts builderOn) and nothing links them.
// With it on, a reader whose plan lacks the feature (signed out, Free, Pro)
// gets the menus and the line that says the builder is part of Ultra, with
// the plans, and nothing is read from the records database; a submitted form
// shows the same. An Ultra reader's view reads one batch: the state row,
// cube_meta when it reads a cube, and the view's statements
// (src/builder_sql.ts). A view the menus do not offer reads nothing and says
// why (build.not_offered).
//
// Every answer is private and never stored by a shared cache, whoever reads
// it. The page's script (public/builder.js) hides what the menus do not offer
// and asks for the result alone as each menu changes: the same address with
// the header x-build-fragment, answered with the result's section and the same
// header; without the script the form's button does the same.
//
// The figures are the views' own: the cubes hold the same rows' counts
// (pipeline cubes.py), the average is the views' (analytics.tsx averageOf), a
// share is fmtPct of its parts and every money figure goes through money().
// A median, a count of organizations and the largest organizations' share are
// read for one fiscal year a row and never added (builder_sql.ts sumFigures);
// provinces and segments are never totalled and say why; a supplier withheld
// as a person counts in every total and is named by no row.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { MEASURES, ROWS, SET_MAX, SOURCES, SUBJECTS, TOPS, topOffered } from "../../public/build-menu.js";
import {
  BUILD_CSV_PATH, BUILD_PATH, BUILD_YEARS, FRAGMENT_HEADER, type BuildChoice, type Measure, type Problem, type Rows, type Show, type Subject,
  buildProblem, buildQuery, isSet, readBuild, usesBuyers, usesOrgs, usesSegment,
} from "../builder";
import { CUBE_META_SQL, type Figures, type Group, type Line, type LineKey, type Model, type SubjectRef, buildPlan } from "../builder_sql";
import {
  ChartStack, RankedBars, ShortMoney, barGap, fiscalAxis, partOf, recordsText, tipHead, tipText, useTips, type AxisLabel, type Panel as ChartPanel,
  type RankedBar,
} from "../chart";
import { COLUMN_WIDTHS, MAIN_MIN, SortsHere, Table, type Column, type ColumnKind, type Rest } from "../columns";
import { SEGMENT_CODES } from "../constants";
import { loadBuyers, loadStats, type BuyerSummary, type Stats } from "../data";
import type { AppEnv } from "../env";
import {
  competitiveLabel, fmtInt, fmtMoney, fmtMoneyShort, fmtPct, numberLocale, pick, provinceName, segmentLabel, sourceLabel, t, tj, tn, type Key, type Lang,
} from "../i18n";
import { ClientData, Layout, PageHead, Panel, noDataPage, page, todayOf, varyOnCookie } from "../layout";
import { allowsBuilder, builderOn, requestPlan } from "../plan";
import { EARLIEST_FY, fiscalLabel, fiscalYearOf, orgIdOf, quarterEnd, readRecords, segmentCode } from "../records_db";
import { FyCell, averageOf, csvCell } from "./analytics";
import { buyerHasRecords } from "./analytics_index";
import { growthPct } from "./expiring";
import { money, shareText } from "./shared";

// -- the menus' words ---------------------------------------------------------------------

const SUBJECT_KEY: Readonly<Record<Subject, Key>> = {
  all: "build.subject_all", buyer: "build.subject_buyer", buyers: "build.subject_buyers", segment: "build.subject_segment",
  buyer_segment: "build.subject_buyer_segment", organization: "build.subject_org", organizations: "build.subject_orgs",
};
const ROWS_KEY: Readonly<Record<Rows, Key>> = {
  year: "build.rows_year", quarter: "build.rows_quarter", segment: "col.segment", buyer: "build.rows_buyer", province: "build.rows_province",
  method: "build.rows_method", competitive: "build.rows_competitive", organization: "build.rows_organization", none: "build.rows_none",
};
const BY_KEY: Readonly<Record<Exclude<Rows, "none">, Key>> = {
  year: "build.by_year", quarter: "build.by_quarter", segment: "build.by_segment", buyer: "build.by_buyer", province: "build.by_province",
  method: "build.by_method", competitive: "build.by_competitive", organization: "build.by_organization",
};
// The figures' names: the analytics views' where they have one.
const MEASURE_KEY: Readonly<Record<Measure, Key>> = {
  value: "col.value", records: "col.records", average: "analytics.chart_average", median: "analytics.chart_median", organizations: "analytics.col_orgs",
  noncompetitive: "build.measure_nc", largest: "build.largest_share", amendments: "build.measure_amendments", ending: "build.measure_ending",
};
const SHOW_KEY: Readonly<Record<Show, Key>> = {
  bars: "build.show_bars", line: "build.show_line", ranked: "build.show_ranked", number: "build.show_number", table: "build.show_table",
};
// The TBS method codes as the record tables name them (pages/records.tsx).
const METHOD_KEY: Readonly<Record<string, Key>> = {
  OB: "method.open", TC: "method.traditional", ST: "method.selective", TN: "method.non_competitive", AC: "method.acan",
};

// -- the request ---------------------------------------------------------------------------

type Ctx = {
  c: Context<AppEnv>; lang: Lang; stats: Stats; day: string; current: number; ultra: boolean; buyers: BuyerSummary[];
  all: BuyerSummary[]; choice: BuildChoice; problem: Problem | null;
};

// The view the address names and what the reader may see of it; the site's 404 while the switch is off. The plan is
// read once (the session's one read); the buyers' file gives the menu and the names.
async function context(c: Context<AppEnv>): Promise<Ctx | Response> {
  if (!builderOn(c.env)) return c.notFound();
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "build.title");
  const day = todayOf(stats.data_as_of);
  const current = fiscalYearOf(day);
  const ultra = allowsBuilder(await requestPlan(c));
  const index = await loadBuyers(c.env).catch(() => null);
  const order = new Intl.Collator(numberLocale(lang));
  const buyers = (index?.buyers ?? []).filter(buyerHasRecords).sort((a, b) => order.compare(buyerName(lang, a), buyerName(lang, b)));
  const choice = readBuild(new URL(c.req.url), current);
  const problem = buildProblem(choice, index ? new Set(index.buyers.map((b) => b.id)) : null);
  return { c, lang, stats, day, current, ultra, buyers, all: index?.buyers ?? [], choice, problem };
}

const buyerName = (lang: Lang, b: BuyerSummary) => pick(lang, b.name_en, b.name_fr) ?? b.name_en;

type Names = (id: string) => string;
const namesOf = (lang: Lang, buyers: readonly BuyerSummary[]): Names => {
  const byId = new Map(buyers.map((b) => [b.id, buyerName(lang, b)]));
  return (id) => byId.get(id) ?? id;
};

// What a view read: its groups and the data date its figures describe, or why it could not be read.
type Outcome = { ok: true; model: Model; asOf: string } | { ok: false; loading: boolean };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function readView(ctx: Ctx): Promise<Outcome> {
  const plan = buildPlan(ctx.choice, { current: ctx.current, day: ctx.day });
  const queries = plan.cubes ? [{ sql: CUBE_META_SQL, params: [] }, ...plan.queries] : plan.queries;
  const read = await readRecords(ctx.c.env, queries);
  if (read.state !== "ready") return { ok: false, loading: read.state === "loading" };
  const cubeDate = plan.cubes ? read.rows[0]?.[0]?.as_of : null;
  // A cube the nightly has not filled yet (no cube_meta row) has no figures to show.
  if (plan.cubes && !(typeof cubeDate === "string" && DATE_RE.test(cubeDate))) return { ok: false, loading: false };
  const asOf = plan.cubes ? (cubeDate as string) : read.asOf ?? ctx.day;
  return { ok: true, model: plan.read(plan.cubes ? read.rows.slice(1) : read.rows), asOf };
}

// -- the figures -------------------------------------------------------------------------------

const v = (f: Figures, k: keyof Figures): number | null => (typeof f[k] === "number" ? (f[k] as number) : null);
const n0 = (f: Figures, k: keyof Figures): number => v(f, k) ?? 0;
const dollars = (cents: number | null) => (cents === null ? null : cents / 100);

// One series of a figure: its name, its value for a line (null where it means nothing), how the axis and the cell
// write it, and the tip's exact figures.
type Series = {
  label: string; get: (f: Figures) => number | null; axis: (x: number) => string; text: (f: Figures) => string; tip: (f: Figures) => string[];
  money?: boolean;
};

function seriesOf(lang: Lang, c: BuildChoice): Series[] {
  const pct = (x: number) => t(lang, "pct", { n: Math.round(x) });
  const short = (x: number) => fmtMoneyShort(x, lang);
  const cash = (cents: number | null) => money(lang, dollars(cents));
  const valued = (f: Figures) => tn(lang, "tip.valued_one", "tip.valued_many", n0(f, "n_pos"), { n: fmtInt(n0(f, "n_pos"), lang) });
  const contracts = (f: Figures) => tn(lang, "tip.contracts_one", "tip.contracts_many", n0(f, "n"), { n: fmtInt(n0(f, "n"), lang) });
  const share = (part: keyof Figures, whole: keyof Figures, fmt: (x: number) => string, label: string): Series => ({
    label, axis: pct, get: (f) => (n0(f, whole) > 0 && v(f, part) !== null ? (n0(f, part) / n0(f, whole)) * 100 : null),
    text: (f) => (v(f, whole) !== null ? fmtPct(n0(f, part), n0(f, whole), lang) : ""), tip: (f) => [partOf(lang, n0(f, part), n0(f, whole), fmt)],
  });
  const cents = (x: number) => fmtMoney(x / 100, lang);
  const ints = (x: number) => fmtInt(x, lang);
  switch (c.measure) {
    case "value":
      return [{ label: t(lang, "col.value"), money: true, axis: short, get: (f) => dollars(v(f, "cents")), text: (f) => cash(v(f, "cents")), tip: (f) => [cash(v(f, "cents")), recordsText(lang, n0(f, "n"))] }];
    case "records":
      return [{ label: t(lang, "col.records"), axis: ints, get: (f) => v(f, "n"), text: (f) => fmtInt(n0(f, "n"), lang), tip: (f) => [recordsText(lang, n0(f, "n"))] }];
    case "average":
      return [{
        label: t(lang, "analytics.chart_average"), money: true, axis: short, get: (f) => averageOf(f), text: (f) => (averageOf(f) === null ? "" : money(lang, averageOf(f))),
        tip: (f) => [money(lang, averageOf(f) ?? 0), valued(f)],
      }];
    case "median": {
      const med = (f: Figures) => (n0(f, "n_pos") > 0 && v(f, "med") !== null ? n0(f, "med") / 100 : null);
      return [{ label: t(lang, "analytics.chart_median"), money: true, axis: short, get: med, text: (f) => (med(f) === null ? "" : money(lang, med(f))), tip: (f) => [money(lang, med(f) ?? 0), valued(f)] }];
    }
    case "organizations":
      return [{ label: t(lang, "analytics.col_orgs"), axis: ints, get: (f) => v(f, "n_orgs"), text: (f) => (v(f, "n_orgs") === null ? "" : fmtInt(n0(f, "n_orgs"), lang)), tip: (f) => [fmtInt(n0(f, "n_orgs"), lang)] }];
    case "noncompetitive":
      return [
        share("n_nc", "n", ints, t(lang, "analytics.nc_by_count")),
        ...(c.rows === "province" ? [] : [share("pos_nc", "pos", cents, t(lang, "analytics.nc_by_value"))]),
      ];
    case "largest":
      return ([["top1", "build.col_top1"], ["top5", "build.col_top5"], ["top10", "build.col_top10"]] as const).map(([k, key]) => share(k, "cents", cents, t(lang, key)));
    case "amendments": {
      const compared = (f: Figures) => tn(lang, "tip.compared_one", "tip.compared_many", n0(f, "n_compared"), { n: fmtInt(n0(f, "n_compared"), lang) });
      const amount = (k: "first_cents" | "last_cents", key: Key): Series => ({
        label: t(lang, key), money: true, axis: short, get: (f) => (n0(f, "n_compared") > 0 ? n0(f, k) / 100 : null),
        text: (f) => (n0(f, "first_cents") > 0 ? cash(v(f, k)) : ""), tip: (f) => [cash(v(f, k)), compared(f)],
      });
      const change: Series = {
        label: t(lang, "build.col_change"), axis: pct, get: (f) => (n0(f, "first_cents") > 0 ? (n0(f, "last_cents") / n0(f, "first_cents") - 1) * 100 : null),
        text: (f) => (n0(f, "first_cents") > 0 ? growthPct(lang, n0(f, "last_cents") / n0(f, "first_cents") - 1) : ""), tip: (f) => [compared(f)],
      };
      return [amount("first_cents", "analytics.chart_growth_first"), amount("last_cents", "analytics.chart_growth_last"), change];
    }
    case "ending":
      return [
        { label: t(lang, "analytics.chart_due_value"), money: true, axis: short, get: (f) => dollars(v(f, "cents")), text: (f) => (v(f, "cents") === null ? "" : cash(v(f, "cents"))), tip: (f) => [cash(v(f, "cents")), contracts(f)] },
        { label: t(lang, "analytics.chart_due_count"), axis: ints, get: (f) => v(f, "n"), text: (f) => fmtInt(n0(f, "n"), lang), tip: (f) => [contracts(f)] },
      ];
  }
}

// The series a comparison, a ranked list and a one-number set draw: one a figure (the largest organizations' five,
// the change through amendments).
const primaryOf = (measure: Measure): number => (measure === "largest" ? 1 : measure === "amendments" ? 2 : 0);
// The series one subject's chart by time draws: both shares, the three largest shares, the first and newest values.
const chartSeries = (measure: Measure, all: Series[]): Series[] =>
  measure === "amendments" ? all.slice(0, 2) : measure === "noncompetitive" || measure === "largest" ? all : [all[0]];
// Whether those series share one scale (the same unit side by side).
const sharedScale = (measure: Measure) => measure === "noncompetitive" || measure === "largest" || measure === "amendments";

// -- names --------------------------------------------------------------------------------------

const segmentText = (lang: Lang, code: string) => `${code} ${segmentLabel(lang, code)}`;

function subjectName(lang: Lang, s: SubjectRef, names: Names): string {
  switch (s.kind) {
    case "all": return t(lang, "build.subject_all");
    case "buyer": return names(s.id);
    case "segment": return segmentText(lang, s.code);
    case "buyer_segment": return t(lang, "build.in_segment", { buyer: names(s.id), segment: segmentText(lang, s.code) });
    case "organization": return s.name ?? orgIdOf(s.oid);
    case "set": return t(lang, "build.the_set");
  }
}

function subjectLink(lang: Lang, s: SubjectRef, names: Names): unknown {
  const name = subjectName(lang, s, names);
  if (s.kind === "buyer") return <a href={`/buyers/${s.id}`}>{name}</a>;
  if (s.kind === "segment") return <a href={`/segments/${s.code}`}>{name}</a>;
  if (s.kind === "organization") return <a href={`/organizations/${orgIdOf(s.oid)}`}>{name}</a>;
  return name;
}

// A line's label as text (tips, the CSV) and as the page draws it (a link where the row is a page of the site).
function lineLabel(lang: Lang, key: LineKey, names: Names, current: number): { text: string; node: unknown; sort?: string } {
  switch (key.kind) {
    case "year": {
      const text = key.fy === current ? t(lang, "analytics.to_date", { fy: fiscalLabel(lang, key.fy) }) : fiscalLabel(lang, key.fy);
      return { text, node: <FyCell lang={lang} year={key.fy} current={current} /> };
    }
    case "quarter": {
      const text = `${t(lang, "analytics.quarter", { n: key.fq })} ${fiscalLabel(lang, key.fy)}`;
      return { text, node: text, sort: quarterEnd(key.fy, key.fq) };
    }
    case "segment": {
      const code = segmentCode(key.sid);
      return { text: segmentText(lang, code), node: <a href={`/segments/${code}`}><span class="mono">{code}</span> {segmentLabel(lang, code)}</a> };
    }
    case "buyer": {
      const text = pick(lang, key.en, key.fr) ?? names(key.id);
      return { text, node: <a href={`/buyers/${key.id}`}>{text}</a> };
    }
    case "province": {
      const text = key.code ? provinceName(lang, key.code) : t(lang, "build.province_none");
      return { text, node: text };
    }
    case "method": {
      const text = key.code && METHOD_KEY[key.code] ? t(lang, METHOD_KEY[key.code]) : key.code ?? t(lang, "competitive.unstated");
      return { text, node: text };
    }
    case "competitive": {
      const text = competitiveLabel(lang, key.comp);
      return { text, node: text };
    }
    case "organization": {
      const text = key.name ?? orgIdOf(key.oid);
      return { text, node: <a href={`/organizations/${orgIdOf(key.oid)}`}>{text}</a> };
    }
    case "total":
      return { text: "", node: "" };
  }
}

// -- the lines a view draws, in order -------------------------------------------------------------

const isTime = (rows: Rows) => rows === "year" || rows === "quarter";
const TOP_ROWS: readonly Rows[] = ["segment", "buyer", "province", "organization"];

// A group's lines as the chart and the table read them: by time, oldest first, every quarter of the contracts ending
// listed whether one ends in it or not; any other rows sorted by the figure, the largest first, and the largest N by
// value kept where the rows take a top N (the statements already keep the N largest buyers and organizations).
function ordered(c: BuildChoice, model: Model, g: Group, primary: Series): Line[] {
  if (model.quarters) {
    const { start, count } = model.quarters;
    return Array.from({ length: count }, (_, k) => {
      const at = start + k;
      const fy = Math.floor(at / 4);
      const fq = (at % 4) + 1;
      return g.lines.find((l) => l.key.kind === "quarter" && l.key.fy === fy && l.key.fq === fq) ?? { key: { kind: "quarter", fy, fq }, f: { n: 0, cents: null, n_no_value: 0 } };
    });
  }
  if (isTime(c.rows)) {
    const at = (l: Line) => (l.key.kind === "year" ? l.key.fy * 4 : l.key.kind === "quarter" ? l.key.fy * 4 + l.key.fq - 1 : 0);
    return [...g.lines].sort((a, b) => at(a) - at(b));
  }
  let lines = [...g.lines];
  if (TOP_ROWS.includes(c.rows) && topOffered(c.subject, c.rows)) {
    lines = lines.sort((a, b) => (n0(b.f, "cents") - n0(a.f, "cents")) || (n0(b.f, "n") - n0(a.f, "n"))).slice(0, c.top);
  }
  const fig = (l: Line) => primary.get(l.f);
  return lines.sort((a, b) => {
    const x = fig(a);
    const y = fig(b);
    if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
    return y - x || n0(b.f, "cents") - n0(a.f, "cents");
  });
}

// -- the chart -----------------------------------------------------------------------------------

// A view by fiscal year or quarter: its axis, the slot each line takes, and how many slots.
function timeAxis(lang: Lang, c: BuildChoice, model: Model): { domain: [number, number]; labels: AxisLabel[]; grid: number[]; slot: (k: LineKey) => number; slots: number } {
  if (model.quarters) {
    const { start, count } = model.quarters;
    const labels = Array.from({ length: count }, (_, k) => {
      const at = start + k;
      return { x: at + 0.5, text: `${t(lang, "analytics.quarter", { n: (at % 4) + 1 })} ${fiscalLabel(lang, Math.floor(at / 4))}`, minor: k % 2 === 1, phone: k === 0 || k === count - 1 };
    });
    const grid = labels.map((_, k) => start + k).filter((at, k) => k > 0 && at % 4 === 0);
    return { domain: [start, start + count], labels, grid, slot: (k) => (k.kind === "quarter" ? k.fy * 4 + k.fq - 1 : 0), slots: count };
  }
  if (c.rows === "quarter") {
    const axis = fiscalAxis(c.first, c.last, (y) => fiscalLabel(lang, y), 4);
    return { domain: [c.first * 4, (c.last + 1) * 4], ...axis, slot: (k) => (k.kind === "quarter" ? k.fy * 4 + k.fq - 1 : 0), slots: (c.last - c.first + 1) * 4 };
  }
  const axis = fiscalAxis(c.first, c.last, (y) => fiscalLabel(lang, y));
  return { domain: [c.first, c.last + 1], ...axis, slot: (k) => (k.kind === "year" ? k.fy : 0), slots: c.last - c.first + 1 };
}

// The panels of a view by time: one subject's series, or one panel a subject of a comparison on one scale (small
// multiples), drawn as bars or a line. A share or an amount below zero draws no mark; the table holds it.
function timePanels(lang: Lang, c: BuildChoice, lines: (g: Group) => Line[], groups: Group[], series: Series[], names: Names, slot: (k: LineKey) => number, current: number): { title: string; s: Series; panel: ChartPanel }[] {
  const several = groups.length > 1 || isSet(c.subject);
  const pairs = several
    ? groups.map((g) => ({ title: subjectName(lang, g.subject, names), s: series[primaryOf(c.measure)], g }))
    : chartSeries(c.measure, series).map((s) => ({ title: s.label, s, g: groups[0] }));
  return pairs.map(({ title, s, g }) => {
    const marks = lines(g).map((l) => ({ l, x: slot(l.key), value: s.get(l.f) })).filter((m): m is { l: Line; x: number; value: number } => m.value !== null && m.value >= 0);
    const tip = (l: Line) => tipText(tipHead(lang, title, lineLabel(lang, l.key, names, current).text), s.tip(l.f));
    const panel: ChartPanel = c.show === "line"
      ? { title, line: marks.map((m) => ({ x: m.x + 0.5, value: m.value, title: tip(m.l) })) }
      : { title, bars: marks.filter((m) => m.value > 0).map((m) => ({ x0: m.x, x1: m.x + 1, value: m.value, title: tip(m.l) })) };
    return { title, s, panel };
  });
}

const TimeChart: FC<{ lang: Lang; c: BuildChoice; model: Model; series: Series[]; names: Names; current: number; lines: (g: Group) => Line[] }> = ({
  lang, c, model, series, names, current, lines,
}) => {
  const axis = timeAxis(lang, c, model);
  const panels = timePanels(lang, c, lines, model.groups, series, names, axis.slot, current);
  const several = model.groups.length > 1 || isSet(c.subject);
  const aria = t(lang, "build.chart_aria");
  const gap = barGap(axis.slots, 24);
  const stack = (list: typeof panels, shared: boolean) => (
    <ChartStack domain={axis.domain} panels={list.map((p) => p.panel)} height={list.length > 1 ? 110 : 140} xLabels={axis.labels} grid={axis.grid}
      fmt={list[0].s.axis} aria={aria} shared={shared} gap={gap} />
  );
  // The contracts ending's value and count are two units: two stacks, each on its own scale, as the views draw them.
  if (!several && c.measure === "ending") return <div class="chart">{panels.map((p) => stack([p], false))}</div>;
  return <div class="chart">{stack(panels, several || sharedScale(c.measure))}</div>;
};

// Sorted horizontal bars: one list, or one a subject of a comparison scaled to one whole (small multiples).
const RankedChart: FC<{ lang: Lang; c: BuildChoice; groups: Group[]; lines: (g: Group) => Line[]; primary: Series; names: Names; current: number }> = ({
  lang, c, groups, lines, primary, names, current,
}) => {
  const bars = (g: Group): RankedBar[] => lines(g).map((l) => {
    const label = lineLabel(lang, l.key, names, current);
    const value = primary.get(l.f) ?? 0;
    return { label: label.node, value, text: primary.text(l.f), title: tipText(label.text, primary.tip(l.f)) };
  });
  const several = groups.length > 1;
  const max = Math.max(0, ...groups.flatMap((g) => bars(g).map((b) => b.value)));
  return (
    <div class="chart">
      {groups.map((g) => (
        <>
          {several ? <p class="chart-title">{subjectName(lang, g.subject, names)}</p> : null}
          <RankedBars rows={bars(g)} aria={several ? subjectName(lang, g.subject, names) : primary.label} max={several ? max : undefined} />
        </>
      ))}
    </div>
  );
};

// One figure: a tile a series for one subject, a tile a subject for a comparison.
const NumberTiles: FC<{ lang: Lang; c: BuildChoice; groups: Group[]; series: Series[]; names: Names }> = ({ lang, c, groups, series, names }) => {
  const tile = (label: string, f: Figures, s: Series, note: string) => (
    <div class="tile">
      <span class="tile-label">{label}</span>
      {s.money && s.get(f) !== null ? <ShortMoney lang={lang} value={s.get(f) as number} class="tile-value" /> : <span class="tile-value">{s.text(f) || t(lang, "common.na")}</span>}
      <span class="tile-note">{note}</span>
    </div>
  );
  const several = groups.length > 1 || isSet(c.subject);
  const primary = series[primaryOf(c.measure)];
  const shown = c.measure === "largest" || c.measure === "noncompetitive" || c.measure === "amendments" ? series : [series[0]];
  return (
    <section class="tiles" aria-label={t(lang, MEASURE_KEY[c.measure])}>
      {several
        ? groups.map((g) => {
          const f = g.lines[0]?.f ?? {};
          return tile(subjectName(lang, g.subject, names), f, primary, primary.tip(f).join(", "));
        })
        : shown.map((s) => {
          const f = groups[0]?.lines[0]?.f ?? {};
          return tile(s.label, f, s, s.tip(f).join(", "));
        })}
    </section>
  );
};

// -- the table -------------------------------------------------------------------------------------

// A column of figures: its kind (a width of the column system), its head, the cell, which lines hold it, and how
// much it matters (the least is the first to rest where the window is too narrow for the whole table).
type FigureColumn = { kind: Exclude<ColumnKind, "main">; label: string; cell: (f: Figures) => string; holds: (f: Figures) => boolean; keep: number };

function figureColumns(lang: Lang, c: BuildChoice, several: boolean): FigureColumn[] {
  const has = (k: keyof Figures) => (f: Figures) => k in f;
  const ints = (k: keyof Figures) => (f: Figures) => fmtInt(n0(f, k), lang);
  const cash = (k: keyof Figures) => (f: Figures) => money(lang, dollars(v(f, k)));
  const pct = (k: keyof Figures) => (f: Figures) => (v(f, "cents") !== null ? fmtPct(n0(f, k), n0(f, "cents"), lang) : "");
  const records: FigureColumn = { kind: "count", label: t(lang, "col.records"), cell: ints("n"), holds: has("n"), keep: 2 };
  const noValue: FigureColumn = { kind: "count", label: t(lang, "analytics.col_no_value"), cell: ints("n_no_value"), holds: has("n_no_value"), keep: 0 };
  const valued: FigureColumn = { kind: "count", label: t(lang, "analytics.col_valued"), cell: ints("n_pos"), holds: has("n_pos"), keep: 1 };
  switch (c.measure) {
    case "value":
      return [{ kind: "total", label: t(lang, "col.value"), cell: cash("cents"), holds: has("cents"), keep: 3 }, records, ...(several ? [] : [noValue])];
    case "records":
      return [{ ...records, keep: 3 }];
    case "average":
      return [{ kind: "value", label: t(lang, "analytics.col_average"), cell: (f) => (averageOf(f) === null ? "" : money(lang, averageOf(f))), holds: has("pos"), keep: 3 }, valued];
    case "median":
      return [{ kind: "value", label: t(lang, "analytics.col_median"), cell: (f) => (n0(f, "n_pos") > 0 && v(f, "med") !== null ? money(lang, n0(f, "med") / 100) : ""), holds: has("med"), keep: 3 }, valued];
    case "organizations":
      return [{ kind: "count", label: t(lang, "analytics.col_orgs"), cell: (f) => (v(f, "n_orgs") === null ? "" : fmtInt(n0(f, "n_orgs"), lang)), holds: has("n_orgs"), keep: 3 }];
    case "noncompetitive":
      return [
        ...(several ? [] : [records]),
        { kind: "share", label: t(lang, "org.col_nc_count"), cell: (f) => shareText(lang, n0(f, "n_nc"), v(f, "n"), (x) => fmtInt(x, lang)), holds: has("n_nc"), keep: 3 },
        ...(several ? [] : [{ kind: "count" as const, label: t(lang, "competitive.unstated"), cell: ints("n_unstated"), holds: has("n_unstated"), keep: 0 }]),
        { kind: "share", label: t(lang, "org.col_nc_value"), cell: (f) => shareText(lang, n0(f, "pos_nc"), v(f, "pos"), (x) => fmtMoney(x / 100, lang)), holds: has("pos_nc"), keep: 1 },
      ];
    case "largest":
      return [
        { kind: "total", label: t(lang, "col.value"), cell: cash("cents"), holds: has("cents"), keep: 0 },
        { kind: "count", label: t(lang, "build.col_top1"), cell: pct("top1"), holds: has("top1"), keep: 2 },
        { kind: "count", label: t(lang, "build.col_top5"), cell: pct("top5"), holds: has("top5"), keep: 3 },
        { kind: "count", label: t(lang, "build.col_top10"), cell: pct("top10"), holds: has("top10"), keep: 2 },
      ];
    case "amendments": {
      const first = (f: Figures) => n0(f, "first_cents") > 0;
      return [
        { kind: "part", label: t(lang, "analytics.col_amended"), cell: (f) => shareText(lang, n0(f, "n_amended"), v(f, "n"), (x) => fmtInt(x, lang)), holds: has("n_amended"), keep: 2 },
        { kind: "value", label: t(lang, "analytics.col_first_value"), cell: (f) => (first(f) ? money(lang, n0(f, "first_cents") / 100) : ""), holds: has("first_cents"), keep: 0 },
        { kind: "value", label: t(lang, "analytics.col_last_value"), cell: (f) => (first(f) ? money(lang, dollars(v(f, "last_cents"))) : ""), holds: has("last_cents"), keep: 0 },
        {
          kind: "count", label: t(lang, "build.col_change"), holds: has("first_cents"), keep: 3,
          cell: (f) => (first(f) ? growthPct(lang, n0(f, "last_cents") / n0(f, "first_cents") - 1) : ""),
        },
      ];
    }
    case "ending":
      return [
        { kind: "count", label: t(lang, "analytics.col_contracts"), cell: ints("n"), holds: has("n"), keep: 3 },
        { kind: "total", label: t(lang, "col.value"), cell: (f) => (v(f, "cents") === null ? "" : money(lang, n0(f, "cents") / 100)), holds: has("cents"), keep: 2 },
        { kind: "count", label: t(lang, "analytics.col_no_value"), cell: ints("n_no_value"), holds: has("n_no_value"), keep: 0 },
      ];
  }
}

// The narrowest content column a table meets from 700 px (the window less the scrollbar, the gutters and the panel's
// borders, before the rail appears at 1,000 px), and the one from 1,280 px, where the "md" columns show again
// (src/columns.tsx); test/table-fit.ts holds every view's table to them.
const FROM_700 = 635;
const FROM_1280 = 951;

// The columns at rest: the least needed rest first, from 700 to 1279 px while the table is wider than the column
// there, and then from 1280 to 1439 px likewise.
function withRests(cols: { col: Column; keep: number }[]): Column[] {
  const width = (cs: Column[]) => cs.reduce((n, c) => n + (c.kind === "main" ? MAIN_MIN : COLUMN_WIDTHS[c.kind]), 0);
  const out = cols.map((x) => ({ ...x.col }));
  const order = cols.map((x, i) => ({ i, keep: x.keep })).filter((x) => x.keep >= 0).sort((a, b) => a.keep - b.keep || b.i - a.i);
  const rest = (r: Rest, budget: number, shown: (c: Column) => boolean) => {
    for (const { i } of order) {
      if (width(out.filter(shown)) <= budget) return;
      if (!out[i].rest) out[i].rest = r;
    }
  };
  rest("md", FROM_700, (c) => !c.rest);
  rest("lg", FROM_1280, (c) => !c.rest || c.rest !== "md");
  return out;
}

// The kind of a row's label column beside a subject's column in a comparison's table.
const LABEL_KIND: Readonly<Record<Rows, Exclude<ColumnKind, "main">>> = {
  year: "date", quarter: "date", segment: "text", buyer: "buyer", province: "region", method: "label", competitive: "comp", organization: "org", none: "label",
};

const ResultTable: FC<{ lang: Lang; c: BuildChoice; groups: Group[]; lines: (g: Group) => Line[]; names: Names; current: number }> = ({
  lang, c, groups, lines, names, current,
}) => {
  const several = groups.length > 1 || (isSet(c.subject) && c.rows !== "buyer" && c.rows !== "organization");
  const all = groups.flatMap((g) => lines(g));
  const figures = figureColumns(lang, c, several).filter((fc) => all.some((l) => fc.holds(l.f)));
  const time = isTime(c.rows);
  const rowsHead = t(lang, c.rows === "year" ? "analytics.col_fy" : c.rows === "quarter" ? "analytics.col_quarter" : ROWS_KEY[c.rows]);
  // The label columns: the subject's in a comparison or a one-figure table; the row's, unless the view has one figure.
  const subjectCol = several || c.rows === "none";
  const rowCol = c.rows !== "none";
  const cols: { col: Column; keep: number }[] = [];
  if (subjectCol) cols.push({ col: { kind: "main", label: t(lang, "build.col_subject") }, keep: -1 });
  if (rowCol) cols.push({ col: { kind: time ? "date" : subjectCol ? LABEL_KIND[c.rows] : "main", label: rowsHead }, keep: -1 });
  figures.forEach((fc) => cols.push({ col: { kind: fc.kind, label: fc.label }, keep: fc.keep }));
  // A table with no column of words gives the room that is left to the figure it is about (the one kept longest), as
  // the views' year tables give it to the value.
  if (!cols.some((x) => x.col.kind === "main")) {
    const at = cols.reduce((best, x, i) => (x.keep > cols[best].keep ? i : best), 0);
    cols[at] = { col: { ...cols[at].col, kind: "main" }, keep: -1 };
  }
  const shown = withRests(cols);
  const restOf = (i: number) => (shown[i].rest ? (shown[i].rest === "md" ? "mdh" : "lgh") : "");
  const rowsOf = groups.flatMap((g) => {
    const list = lines(g);
    // Newest first by time, as the views' tables list years; the contracts ending soonest first, as theirs do.
    return (time && c.measure !== "ending" ? [...list].reverse() : list).map((l) => ({ g, l }));
  });
  return (
    <div class="table-wrap">
      <Table cols={shown}>
        <tbody>
          {rowsOf.map(({ g, l }) => {
            const label = lineLabel(lang, l.key, names, current);
            let i = 0;
            const cells: unknown[] = [];
            if (subjectCol) cells.push(<td data-label={shown[i].label as string} class={restOf(i++) || undefined}>{subjectLink(lang, g.subject, names)}</td>);
            if (rowCol) {
              const idx = i++;
              cells.push(time
                ? <td data-label={shown[idx].label as string} class="mono" data-sort={label.sort}>{label.node as any}</td>
                : <td data-label={shown[idx].label as string}>{label.node as any}</td>);
            }
            figures.forEach((fc) => {
              const idx = i++;
              cells.push(<td data-label={shown[idx].label as string} class={["mono num", restOf(idx)].filter(Boolean).join(" ")}>{fc.holds(l.f) ? fc.cell(l.f) : ""}</td>);
            });
            return <tr>{cells as any}</tr>;
          })}
        </tbody>
      </Table>
    </div>
  );
};

// -- the result ---------------------------------------------------------------------------------------

// The view's title: its figure and its rows ("Median value by segment"); the contracts ending by their own words.
function viewTitle(lang: Lang, c: BuildChoice): string {
  const key: Key = c.measure === "ending" ? "analytics.chart_due_count" : c.measure === "noncompetitive" ? "build.title_nc"
    : c.measure === "largest" ? "build.title_largest" : MEASURE_KEY[c.measure];
  const measure = t(lang, key);
  return c.rows === "none" ? measure : `${measure} ${t(lang, BY_KEY[c.rows])}`;
}

// The notes a view carries: why its rows are not added together, whom its organizations leave out, what its value is.
function notes(lang: Lang, c: BuildChoice): string[] {
  const out: string[] = [];
  if (c.rows === "segment") out.push(t(lang, "build.segments_note"));
  if (c.rows === "province") out.push(t(lang, "build.places_note"));
  if (c.rows === "organization") out.push(t(lang, "build.withheld_note"));
  if (c.measure === "organizations") out.push(t(lang, "build.orgs_note"));
  if (c.measure === "largest") out.push(t(lang, "build.largest_note"));
  if (c.rows === "competitive") out.push(t(lang, "build.competitive_note"));
  if (TOP_ROWS.includes(c.rows) && topOffered(c.subject, c.rows)) out.push(t(lang, "build.top_note", { n: c.top }));
  if (c.capped) out.push(t(lang, "analytics.period_capped", { n: BUILD_YEARS }));
  return out;
}

const RESULT_ID = "build-result";
// The result's box: what the preview replaces (public/builder.js), read by screen readers as it changes.
const Box: FC<{ children?: unknown; hidden?: boolean }> = ({ children, hidden }) => (
  <div id={RESULT_ID} aria-live="polite" hidden={hidden}>{children as any}</div>
);

// The result: why there is none, or the view's chart, its table, its notes, the line naming the source, the period
// and the data date, and its CSV file. The same section is the page's and the preview's.
const Result: FC<{ lang: Lang; ctx: Ctx; outcome: Outcome | null }> = ({ lang, ctx, outcome }) => {
  const { choice: c, problem, current } = ctx;
  if (problem) {
    const text = problem.kind === "choose" ? t(lang, problem.key)
      : t(lang, "build.not_offered", {
        why: problem.key === "build.why_source" ? t(lang, "build.why_source", { source: sourceLabel(lang, c.source) })
          : problem.key === "build.why_quarters" ? t(lang, "build.why_quarters", { n: problem.n ?? 0 }) : t(lang, problem.key),
      });
    return <Box><Panel title={viewTitle(lang, c)}><p>{text}</p></Panel></Box>;
  }
  if (!outcome || !outcome.ok) {
    return <Box><Panel title={t(lang, "build.unavailable_title")}><p>{t(lang, "build.unavailable")}</p></Panel></Box>;
  }
  const { model, asOf } = outcome;
  const names = namesOf(lang, ctx.all);
  const series = seriesOf(lang, c);
  const primary = series[primaryOf(c.measure)];
  const memo = new Map<Group, Line[]>();
  const lines = (g: Group) => {
    let l = memo.get(g);
    if (!l) memo.set(g, (l = ordered(c, model, g, primary)));
    return l;
  };
  const any = model.groups.some((g) => g.lines.length > 0 && (c.rows !== "none" || n0(g.lines[0].f, "n") > 0));
  const csv = `${BUILD_CSV_PATH}?${buildQuery(c)}`;
  const line = c.measure === "ending" ? t(lang, "build.as_of_ending", { date: asOf })
    : t(lang, "build.as_of", { source: sourceLabel(lang, c.source), first: fiscalLabel(lang, c.first), last: fiscalLabel(lang, c.last), date: asOf });
  const subjects = model.groups.filter((g) => g.subject.kind !== "set").map((g) => subjectLink(lang, g.subject, names));
  return (
    <Box><Panel title={viewTitle(lang, c)} tools={any ? <a href={csv} rel="nofollow">{t(lang, "analytics.csv")}</a> : undefined}
      foot={<span>{line} {tj(lang, "analytics.rules", { methodology: <a href="/methodology#analytics">{t(lang, "analytics.rules_link")}</a> })}</span>}>
      {subjects.length ? <p>{subjects.map((s, i) => <>{i ? ", " : ""}{s as any}</>)}</p> : null}
      {!any ? <p class="muted">{t(lang, "build.none")}</p> : <>
        {c.show === "number" ? <NumberTiles lang={lang} c={c} groups={model.groups} series={series} names={names} />
          : c.show === "ranked" ? <RankedChart lang={lang} c={c} groups={model.groups} lines={lines} primary={primary} names={names} current={current} />
          : c.show === "table" ? null
          : <TimeChart lang={lang} c={c} model={model} series={series} names={names} current={current} lines={lines} />}
        <ResultTable lang={lang} c={c} groups={model.groups} lines={lines} names={names} current={current} />
      </>}
      {notes(lang, c).map((n) => <p class="muted small">{n}</p>)}
    </Panel></Box>
  );
};

// -- the menus ------------------------------------------------------------------------------------------

// A group of fields the view does not use: drawn hidden (the stylesheet's [hidden] rule) and its controls disabled,
// so the form sends none of them; the page's script shows and enables them as the menus change.
type Off = { hidden?: boolean };

const Select: FC<{ name: string; label: string; value: string; options: readonly (readonly [string, string])[]; group?: string; code?: boolean } & Off> = ({
  name, label, value, options, group, code, hidden,
}) => (
  <label class={code ? "field field-code" : "field"} data-for={group} hidden={hidden}>
    <span class="field-label">{label}</span>
    <select name={name} disabled={hidden}>{options.map(([v, text]) => <option value={v} selected={v === value}>{text}</option>)}</select>
  </label>
);

// A buyer's menu: every buyer the analytics index lists, by name in the page's language, its id the value, and
// first the empty choice. A buyer the address names that the list leaves out is kept, so it stays chosen.
function buyerOptions(lang: Lang, ctx: Ctx): (readonly [string, string])[] {
  const listed = new Set(ctx.buyers.map((b) => b.id));
  const name = namesOf(lang, ctx.all);
  const kept = ctx.choice.buyers.filter((id) => !listed.has(id)).map((id) => [id, name(id)] as const);
  return [["", t(lang, "build.buyer_choose")], ...ctx.buyers.map((b) => [b.id, buyerName(lang, b)] as const), ...kept];
}

// The form: the subject and its ids, the rows, the figure, the source, the period, how to show it and how many rows.
// The groups the view does not use are drawn hidden and disabled: the buyers, the segment and the organizations of
// another subject, the second box of a comparison of the other kind, the source and the period of the contracts
// ending, the rows shown where the rows take no top N. Every option of a menu is drawn; the page's script hides those
// the menus do not offer with the others as chosen, and without it the page answers a combination outside them with
// its reason. A GET form, so the view is its address.
const Menus: FC<{ lang: Lang; ctx: Ctx }> = ({ lang, ctx }) => {
  const c = ctx.choice;
  const years: number[] = [];
  for (let y = ctx.current; y >= EARLIEST_FY; y--) years.push(y);
  const yearOptions = years.map((y) => [String(y), fiscalLabel(lang, y)] as const);
  const extra = (list: readonly string[]) => Array.from({ length: SET_MAX - 1 }, (_, i) => list[i + 1] ?? "");
  const buyers = buyerOptions(lang, ctx);
  const off = {
    buyer: !usesBuyers(c.subject), buyers: c.subject !== "buyers", segment: !usesSegment(c.subject), org: !usesOrgs(c.subject),
    orgs: c.subject !== "organizations", period: c.measure === "ending", top: !topOffered(c.subject, c.rows),
  };
  return (
    <form method="get" action={BUILD_PATH} class="toolbar build-form" id="build-form" aria-label={t(lang, "build.form")} data-most={String(BUILD_YEARS)}>
      <div class="toolbar-fields">
        <Select name="subject" label={t(lang, "build.subject")} value={c.subject} options={SUBJECTS.map((s) => [s, t(lang, SUBJECT_KEY[s as Subject])] as const)} />
        <Select name="b" label={t(lang, "build.buyer")} value={c.buyers[0] ?? ""} group="buyer" hidden={off.buyer} options={buyers} />
        <Select name="s" label={t(lang, "col.segment")} value={c.segment} group="segment" hidden={off.segment}
          options={[["", t(lang, "build.segment_choose")], ...SEGMENT_CODES.map((code) => [code, segmentText(lang, code)] as const)]} />
        <label class="field field-text" data-for="org" hidden={off.org}>
          <span class="field-label">{t(lang, "build.org")}</span>
          <input type="text" name="o" value={c.orgs[0] ?? ""} maxlength={120} autocomplete="off" spellcheck={false} disabled={off.org} />
          <span class="field-hint">{t(lang, "build.org_hint")}</span>
        </label>
      </div>
      <fieldset class="toolbar-fields" data-for="buyers" hidden={off.buyers}>
        <legend>{t(lang, "build.compare", { n: SET_MAX - 1 })}</legend>
        {extra(c.subject === "buyers" ? c.buyers : []).map((id, i) => (
          <label class="field">
            <span class="visually-hidden">{`${t(lang, "build.buyer")} ${i + 2}`}</span>
            <select name="b" disabled={off.buyers}>{buyers.map(([v, text]) => <option value={v} selected={v === id}>{text}</option>)}</select>
          </label>
        ))}
      </fieldset>
      <fieldset class="toolbar-fields" data-for="orgs" hidden={off.orgs}>
        <legend>{t(lang, "build.compare", { n: SET_MAX - 1 })}</legend>
        {extra(c.subject === "organizations" ? c.orgs : []).map((id, i) => (
          <label class="field field-text">
            <span class="visually-hidden">{`${t(lang, "build.org")} ${i + 2}`}</span>
            <input type="text" name="o" value={id} maxlength={120} autocomplete="off" spellcheck={false} disabled={off.orgs} />
          </label>
        ))}
      </fieldset>
      <div class="toolbar-fields">
        <Select name="rows" label={t(lang, "build.rows")} value={c.rows} options={ROWS.map((r) => [r, t(lang, ROWS_KEY[r as Rows])] as const)} />
        <Select name="measure" label={t(lang, "build.measure")} value={c.measure} options={MEASURES.map((m) => [m, t(lang, MEASURE_KEY[m as Measure])] as const)} />
        <Select name="source" label={t(lang, "col.source")} value={c.source} group="period" hidden={off.period} options={SOURCES.map((s) => [s, sourceLabel(lang, s)] as const)} />
      </div>
      <div class="toolbar-fields">
        <Select name="from" label={t(lang, "analytics.period_from")} value={String(c.first)} group="period" hidden={off.period} options={yearOptions} code />
        <Select name="to" label={t(lang, "analytics.period_to")} value={String(c.last)} group="period" hidden={off.period} options={yearOptions} code />
        <Select name="show" label={t(lang, "build.show")} value={c.show} options={(["bars", "line", "ranked", "number", "table"] as const).map((s) => [s, t(lang, SHOW_KEY[s])] as const)} />
        <Select name="top" label={t(lang, "build.top")} value={String(c.top)} group="top" hidden={off.top} options={TOPS.map((n) => [String(n), t(lang, "build.top_n", { n })] as const)} />
        <div class="toolbar-actions">
          <button type="submit" class="btn btn-primary">{t(lang, "build.apply")}</button>
        </div>
      </div>
    </form>
  );
};

// Tells the layout this page sorts a table and draws tips, so the two scripts are there for a preview that brings
// them after an answer that had none.
const Readies: FC = () => {
  useTips();
  return <SortsHere />;
};

// -- the routes -----------------------------------------------------------------------------------------

const PRIVATE = "private, no-store";

export async function builderPage(c: Context<AppEnv>): Promise<Response> {
  const ctx = await context(c);
  if (ctx instanceof Response) return ctx;
  const { lang } = ctx;
  const fragment = c.req.header(FRAGMENT_HEADER) === "1";
  // Nothing is read from the records database for a reader without the builder, nor for a view it does not offer.
  const outcome = ctx.ultra && !ctx.problem ? await readView(ctx) : null;
  const result = ctx.ultra ? <Result lang={lang} ctx={ctx} outcome={outcome} /> : null;
  const failed = !!outcome && !outcome.ok;
  if (fragment) {
    varyOnCookie(c);
    c.header("Cache-Control", PRIVATE);
    c.header("X-Build-Fragment", "1");
    return c.html((result ?? <Box hidden />) as any, 200);
  }
  if (failed) c.header("Retry-After", "3600");
  const res = await page(
    c,
    <Layout lang={lang} title={t(lang, "build.title")} dataAsOf={ctx.stats.data_as_of} active={BUILD_PATH}
      seo={{ path: BUILD_PATH, description: t(lang, "build.description"), noindex: true }}>
      <PageHead lang={lang} crumbs={[{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "analytics.title"), path: "/analytics" }, { name: t(lang, "build.crumb") }]}
        title={t(lang, "build.title")} lead={t(lang, "build.lead")}>
        {ctx.ultra ? null : <p class="page-note">{t(lang, "build.gate")} <a href="/pro">{t(lang, "build.gate_link")}</a></p>}
      </PageHead>
      <Menus lang={lang} ctx={ctx} />
      {result as any}
      {ctx.ultra ? <Readies /> : null}
      <script type="module" src="/builder.js"></script>
    </Layout>,
    failed ? 503 : 200,
  );
  res.headers.set("Cache-Control", PRIVATE);
  return res;
}

// -- the CSV file ---------------------------------------------------------------------------------------

// A cell's raw figure: dollars with two decimals, counts as they are, a share as a fraction of four decimals.
const cad = (cents: number | null | undefined) => (typeof cents === "number" ? (cents / 100).toFixed(2) : null);

// The columns the file writes for a figure, beside the subject and the row: every count and amount the figure rests
// on, never one it cannot hold (a median of more than one year is never read).
function csvColumns(m: Measure): [string, (f: Figures) => unknown][] {
  const ints = (k: keyof Figures) => (f: Figures) => v(f, k);
  const cash = (k: keyof Figures) => (f: Figures) => cad(v(f, k));
  switch (m) {
    case "value": return [["records", ints("n")], ["value_cad", cash("cents")], ["records_without_value", ints("n_no_value")]];
    case "records": return [["records", ints("n")]];
    case "average": return [["records_with_value_above_zero", ints("n_pos")], ["value_above_zero_cad", cash("pos")], ["average_cad", (f) => (averageOf(f) === null ? null : (averageOf(f) as number).toFixed(2))]];
    case "median": return [["records_with_value_above_zero", ints("n_pos")], ["median_cad", (f) => (n0(f, "n_pos") > 0 ? cad(v(f, "med")) : null)]];
    case "organizations": return [["organizations", ints("n_orgs")]];
    case "noncompetitive": return [
      ["records", ints("n")], ["non_competitive", ints("n_nc")], ["not_stated", ints("n_unstated")], ["positive_value_cad", cash("pos")],
      ["non_competitive_positive_value_cad", cash("pos_nc")],
    ];
    case "largest": return [["value_cad", cash("cents")], ["largest_1_cad", cash("top1")], ["largest_5_cad", cash("top5")], ["largest_10_cad", cash("top10")], ["organizations", ints("n_orgs")]];
    case "amendments": return [
      ["records", ints("n")], ["amended", ints("n_amended")], ["amended_compared", ints("n_compared")], ["amended_grew", ints("n_grew")],
      ["first_value_cad", cash("first_cents")], ["last_value_cad", cash("last_cents")],
    ];
    case "ending": return [["contracts", ints("n")], ["value_cad", cash("cents")], ["contracts_without_value", ints("n_no_value")]];
  }
}

// A row's key in the file: plain codes and numbers, the label in English beside them, as the views' files write theirs.
function csvKey(key: LineKey, names: Names): [string, string] {
  switch (key.kind) {
    case "year": return [String(key.fy), fiscalLabel("en", key.fy)];
    case "quarter": return [`${key.fy}-Q${key.fq}`, `${fiscalLabel("en", key.fy)} Q${key.fq}`];
    case "segment": return [segmentCode(key.sid), segmentLabel("en", segmentCode(key.sid))];
    case "buyer": return [key.id, key.en ?? names(key.id)];
    case "province": return [key.code, key.code ? provinceName("en", key.code) : ""];
    case "method": return [key.code ?? "", key.code && METHOD_KEY[key.code] ? t("en", METHOD_KEY[key.code]) : ""];
    case "competitive": return [key.comp === null ? "" : String(key.comp), competitiveLabel("en", key.comp)];
    case "organization": return [orgIdOf(key.oid), key.name ?? ""];
    case "total": return ["", ""];
  }
}

function csvSubject(s: SubjectRef, names: Names): [string, string] {
  switch (s.kind) {
    case "all": return ["all", ""];
    case "buyer": return [s.id, names(s.id)];
    case "segment": return [s.code, segmentLabel("en", s.code)];
    case "buyer_segment": return [`${s.id}:${s.code}`, `${names(s.id)}, ${s.code}`];
    case "organization": return [orgIdOf(s.oid), s.name ?? ""];
    case "set": return ["", ""];
  }
}

// The view as a CSV file: Ultra only (anyone else, and a view the menus do not offer, gets the site's 404, as for a
// file that is not there), read with the view's own statements, sent private and never stored by a shared cache.
export async function builderCsv(c: Context<AppEnv>): Promise<Response> {
  if (!builderOn(c.env) || !allowsBuilder(await requestPlan(c))) return c.notFound();
  const ctx = await context(c);
  if (ctx instanceof Response) return ctx;
  if (ctx.problem) return c.notFound();
  c.header("Cache-Control", "no-store");
  const outcome = await readView(ctx);
  if (!outcome.ok) {
    c.header("Retry-After", "3600");
    return c.text(t(ctx.lang, "build.unavailable"), 503);
  }
  const ch = ctx.choice;
  const names = namesOf("en", ctx.all);
  const series = seriesOf("en", ch);
  const primary = series[primaryOf(ch.measure)];
  const columns = csvColumns(ch.measure);
  const period = ch.measure === "ending" ? [] : [ch.source, String(ch.first), String(ch.last)];
  const head = ["subject_id", "subject", "row", "row_label", ...(ch.measure === "ending" ? ["from"] : ["source", "first_fiscal_year", "last_fiscal_year"]), ...columns.map(([k]) => k)];
  const body = outcome.model.groups.flatMap((g) => ordered(ch, outcome.model, g, primary).map((l) => [
    ...csvSubject(g.subject, names), ...csvKey(l.key, names), ...(ch.measure === "ending" ? [ctx.day] : period), ...columns.map(([, get]) => get(l.f)),
  ]));
  const text = [head, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const name = ["build", ch.subject, ch.rows, ch.measure, ...(ch.measure === "ending" ? [ctx.day] : [ch.source, ch.first, ch.last])].join("-");
  return new Response(text, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${String(name).replace(/[^a-z0-9.-]/gi, "-")}.csv"`,
      "Cache-Control": PRIVATE,
    },
  });
}
