// The mandatory minimum 5% Indigenous procurement target on a buyer page:
// what the institution planned for the next two fiscal years, the goods and
// services where it reported a gap, and its latest result, each as it
// reported them to Indigenous Services Canada and as that department
// published them. A plan is no commitment and a result is the file's own,
// so the panel computes nothing and adds nothing to a contract figure. The
// block rides in the buyer file (the pipeline's
// sources/indigenous_target.py buyer_blocks), so the page fetches nothing
// more; a block that does not read, or a file written before the source,
// shows no panel and the page is as it was.

import type { FC } from "hono/jsx";
import { Table } from "./columns";
import { fmtInt, fmtMoney, numberLocale, pick, t, tj, type Lang } from "./i18n";
import { Panel } from "./layout";
import { PHONE_ROWS, PhonePages } from "./pages/shared";
import { fiscalLabel } from "./records_db";
import { OGL_URL } from "./seo";
import { isListOf, isNum, isObj, isStr } from "./valid";

// The pipeline's figures (sources/indigenous_target.py; its tests hold the
// two equal): a fiscal year's plan rows and gaps a block carries at most, and
// the word it writes for a figure the file gives as "No Data Provided".
export const IPT_PLAN_ROWS = 200;
export const IPT_GAP_ROWS = 200;
export const IPT_NP = "np";

export const iptDatasetUrl = (lang: Lang, id: string): string => `https://open.canada.ca/data/${lang === "fr" ? "fr" : "en"}/dataset/${id}`;
// The catalogue's list of the target's datasets, one a year for the plans and
// one for the results (the Data page's link; read 2026-11-13, five datasets).
export const IPT_SEARCH_URL: Readonly<Record<Lang, string>> = {
  en: "https://search.open.canada.ca/opendata/?owner_org=isc-sac&search_text=%22Indigenous%20Procurement%20Target%22",
  fr: "https://rechercher.ouvert.canada.ca/donneesouvertes/?owner_org=isc-sac&search_text=approvisionnement%20autochtone%20obligatoire",
};

// -- the block as the export writes it ---------------------------------------------------

// A figure as published: a number, "np" where the file says No Data Provided,
// the text as written where it is no figure, null where it is blank.
export type Figure = number | string | null;
export type Pair = [string, string | null];
// [object key, amount, delivery location: [English, French or null], "np" or null]
export type PlanRow = [string, Figure, Pair | string | null];
export interface PlanYear { fy: number; n: number; rows: PlanRow[]; np?: 1 }
export interface GapYear { fy: number; n: number; keys: string[]; none: [string | null, string | null] | null }
export interface IptPlan { ds: string; fy: [number, number]; years: PlanYear[] }
export interface IptGaps { ds: string; years: GapYear[] }
export interface IptResult { ds: string; fy: number; a: Figure; b: Figure; c: Figure; pct: Figure; met: Pair | string | null; rcv?: Pair }
// [object in English, in French, its category in English, in French]
export type IptObject = [string | null, string | null, string | null, string | null];
export interface BuyerIpt { objects: Record<string, IptObject>; plan: IptPlan | null; gaps: IptGaps | null; result: IptResult | null }

const TEXT_MAX = 600;
const isText = (v: unknown, max = TEXT_MAX): v is string => isStr(v) && v.trim() !== "" && v.length <= max;
const isTextOrNull = (v: unknown, max = TEXT_MAX): boolean => v === null || isText(v, max);
const isCount = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;
const isFy = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 2000 && v <= 2999;
// A dataset id as it goes into the address: open.canada.ca's are UUIDs, a samples run writes "sample".
const DATASET = /^[0-9a-z-]{1,64}$/;
const isDataset = (v: unknown): v is string => isStr(v) && DATASET.test(v);
const isFigure = (v: unknown): v is Figure => v === null || isNum(v) || isText(v, 80);
const isPair = (v: unknown): v is Pair => Array.isArray(v) && v.length === 2 && isText(v[0]) && isTextOrNull(v[1]);
const isObject = (v: unknown): v is IptObject => Array.isArray(v) && v.length === 4 && v.every((x) => isTextOrNull(x, 300));

// The buyer file's block, or null: an export before the source, a buyer the
// files do not name, or a block of the wrong shape (which never takes the
// page down with it).
export function buyerIndigenousTarget(file: unknown): BuyerIpt | null {
  const v = isObj(file) ? file.indigenous_target : undefined;
  if (!isObj(v) || v.v !== 1 || !isObj(v.objects) || !Object.values(v.objects).every(isObject)) return null;
  const objects = v.objects as Record<string, IptObject>;
  const isKey = (k: unknown): k is string => isStr(k) && Object.prototype.hasOwnProperty.call(objects, k);
  const isRow = (r: unknown): r is PlanRow => Array.isArray(r) && r.length === 3 && isKey(r[0]) && isFigure(r[1]) &&
    (r[2] === null || r[2] === IPT_NP || isPair(r[2]));
  const plan = v.plan;
  const planOk = plan === undefined || (isObj(plan) && isDataset(plan.ds) && Array.isArray(plan.fy) && plan.fy.length === 2 &&
    isFy(plan.fy[0]) && plan.fy[1] === plan.fy[0] + 1 && isListOf(plan.years, (y) => isObj(y) && (y.fy === plan.fy[0] || y.fy === plan.fy[1]) &&
      isCount(y.n) && isListOf(y.rows, isRow) && y.rows.length <= Math.min(IPT_PLAN_ROWS, y.n) && (y.np === undefined || y.np === 1)) &&
    plan.years.length >= 1);
  const gaps = v.gaps;
  const gapsOk = gaps === undefined || (isObj(gaps) && isDataset(gaps.ds) && isListOf(gaps.years, (y) => isObj(y) && isFy(y.fy) &&
    isCount(y.n) && isListOf(y.keys, isKey) && y.keys.length <= Math.min(IPT_GAP_ROWS, y.n) &&
    (y.none === null || (Array.isArray(y.none) && y.none.length === 2 && y.none.every((x: unknown) => isTextOrNull(x, 300))))) &&
    gaps.years.length >= 1);
  const r = v.result;
  const resultOk = r === undefined || (isObj(r) && isDataset(r.ds) && isFy(r.fy) && isFigure(r.a) && isFigure(r.b) && isFigure(r.c) &&
    isFigure(r.pct) && (r.met === null || r.met === IPT_NP || isPair(r.met)) && (r.rcv === undefined || isPair(r.rcv)));
  if (!planOk || !gapsOk || !resultOk || (plan === undefined && gaps === undefined && r === undefined)) return null;
  return {
    objects,
    plan: plan === undefined ? null : (plan as IptPlan),
    gaps: gaps === undefined ? null : (gaps as IptGaps),
    result: r === undefined ? null : (r as IptResult),
  };
}

// -- what the panel shows ----------------------------------------------------------------

// An amount as stated: whole dollars as the site writes them, and the cents
// where the file gives some ("$99,999.99" stays itself, never $100,000).
const CENTS_FORMAT = new Map<Lang, Intl.NumberFormat>();
export function statedMoney(lang: Lang, value: number): string {
  if (Number.isInteger(value)) return fmtMoney(value, lang);
  let f = CENTS_FORMAT.get(lang);
  if (!f) {
    f = new Intl.NumberFormat(numberLocale(lang), { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    CENTS_FORMAT.set(lang, f);
  }
  return f.format(value);
}

// The published percentage, a fraction in the file ("0.0647" reads 6.47%).
const PCT_FORMAT = new Map<Lang, Intl.NumberFormat>();
export function publishedPct(lang: Lang, fraction: number): string {
  let f = PCT_FORMAT.get(lang);
  if (!f) {
    f = new Intl.NumberFormat(numberLocale(lang), { style: "percent", maximumFractionDigits: 4 });
    PCT_FORMAT.set(lang, f);
  }
  return f.format(fraction);
}

// A figure in words: not provided, never zero; blank as not stated; text as written.
export function figureText(lang: Lang, v: Figure, number: (n: number) => string): string {
  if (v === null) return t(lang, "common.not_stated");
  if (v === IPT_NP) return t(lang, "ipt.not_provided");
  return isNum(v) ? number(v) : v;
}

const pairText = (lang: Lang, v: Pair | string | null): string =>
  v === null ? t(lang, "common.not_stated") : v === IPT_NP || isStr(v) ? t(lang, "ipt.not_provided") : pick(lang, v[0], v[1]) ?? v[0];

const yearsText = (lang: Lang, years: readonly number[]): string =>
  years.length === 2 ? t(lang, "ipt.years_two", { a: fiscalLabel(lang, years[0]), b: fiscalLabel(lang, years[1]) }) : fiscalLabel(lang, years[0]);

const Cap: FC<{ lang: Lang; shown: number; n: number; gaps?: boolean }> = ({ lang, shown, n, gaps }) =>
  n > shown ? <p class="muted small">{t(lang, gaps ? "ipt.gaps_cap" : "ipt.rows_cap", { shown: fmtInt(shown, lang), n: fmtInt(n, lang) })}</p> : null;

// Each dataset the panel reads, linked, with the fiscal years it covers.
const Foot: FC<{ lang: Lang; ipt: BuyerIpt }> = ({ lang, ipt }) => {
  const links: [string, string][] = [];
  const { plan, gaps, result } = ipt;
  if (plan) links.push([plan.ds, t(lang, gaps && gaps.ds === plan.ds ? "ipt.ds_plan_gaps" : "ipt.ds_plan", { years: yearsText(lang, plan.fy) })]);
  if (gaps && (!plan || gaps.ds !== plan.ds)) links.push([gaps.ds, t(lang, "ipt.ds_gaps", { years: yearsText(lang, gaps.years.map((y) => y.fy)) })]);
  if (result) links.push([result.ds, t(lang, "ipt.ds_results", { years: fiscalLabel(lang, result.fy) })]);
  return (
    <>
      <p class="muted small">
        {tj(lang, "ipt.source", { datasets: links.map(([ds, label], i) => <>{i ? "; " : null}<a href={iptDatasetUrl(lang, ds)}>{label}</a></>) })}
      </p>
      <p class="muted small">{t(lang, "ipt.responsible")}</p>
      <p class="muted small"><a href={OGL_URL[lang]}>{t(lang, "data.credit")}</a></p>
    </>
  );
};

// The panel, before the Public Accounts' payments: the plan's two fiscal
// years, each a table by category, then the gaps, then the result as a list
// of the file's figures.
export const IndigenousTargetPanel: FC<{ lang: Lang; ipt: BuyerIpt | null; buyer: string }> = ({ lang, ipt, buyer }) => {
  if (!ipt) return null;
  const name = (key: string) => {
    const o = ipt.objects[key];
    return pick(lang, o[0], o[1]) ?? t(lang, "common.not_stated");
  };
  const category = (key: string) => {
    const o = ipt.objects[key];
    return pick(lang, o[2], o[3]) ?? t(lang, "common.not_stated");
  };
  const { plan, gaps, result } = ipt;
  const money = (n: number) => statedMoney(lang, n);
  return (
    <Panel id="indigenous-target" title={t(lang, "ipt.panel")} foot={<Foot lang={lang} ipt={ipt} />}>
      <p>{t(lang, "ipt.lead", { buyer })}</p>
      <p class="muted small">{t(lang, "ipt.apart")}</p>
      {plan ? (
        <>
          <p class="muted small">{t(lang, "ipt.plan_lead", { buyer })}</p>
          {plan.fy.map((fy) => {
            const year = plan.years.find((y) => y.fy === fy);
            return (
              <>
                <h3>{t(lang, "ipt.plan_head", { fy: fiscalLabel(lang, fy) })}</h3>
                {year && year.rows.length ? (
                  <>
                    <PhonePages lang={lang} rows={PHONE_ROWS}>
                      <Table cols={[
                        { kind: "label", label: t(lang, "ipt.col_category") },
                        { kind: "main", label: t(lang, "ipt.col_object") },
                        { kind: "value", label: t(lang, "ipt.col_amount") },
                        { kind: "region", label: t(lang, "ipt.col_delivery") },
                      ]}>
                        <tbody>
                          {year.rows.map(([key, amount, where]) => (
                            <tr>
                              <td data-label={t(lang, "ipt.col_category")}>{category(key)}</td>
                              <td data-label={t(lang, "ipt.col_object")} class="lead-cell">{name(key)}</td>
                              <td data-label={t(lang, "ipt.col_amount")} class="mono num">{figureText(lang, amount, money)}</td>
                              <td data-label={t(lang, "ipt.col_delivery")}>{pairText(lang, where)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </PhonePages>
                    <Cap lang={lang} shown={year.rows.length} n={year.n} />
                  </>
                ) : (
                  <p class="muted small">{t(lang, year?.np ? "ipt.plan_np" : "ipt.plan_none")}</p>
                )}
              </>
            );
          })}
        </>
      ) : null}
      {gaps ? gaps.years.map((y) => {
        const none = y.none ? pick(lang, y.none[0], y.none[1]) : null;
        return (
          <>
            <h3>{t(lang, "ipt.gaps_head", { fy: fiscalLabel(lang, y.fy) })}</h3>
            <p class="muted small">{t(lang, "ipt.gaps_lead", { buyer })}</p>
            {y.keys.length ? <ul>{y.keys.map((k) => <li>{name(k)}</li>)}</ul> : null}
            {y.keys.length ? <Cap lang={lang} shown={y.keys.length} n={y.n} gaps /> : null}
            {!y.keys.length ? <p>{none ? t(lang, "ipt.gaps_entry", { text: none }) : t(lang, "ipt.gaps_empty")}</p> : null}
          </>
        );
      }) : null}
      {result ? (
        <>
          <h3>{t(lang, "ipt.result_head", { fy: fiscalLabel(lang, result.fy) })}</h3>
          <p class="muted small">{t(lang, "ipt.result_lead", { buyer })}</p>
          <dl class="wide stack">
            <dt>{t(lang, "ipt.result_a")}</dt><dd class="mono">{figureText(lang, result.a, money)}</dd>
            <dt>{t(lang, "ipt.result_b")}</dt><dd class="mono">{figureText(lang, result.b, money)}</dd>
            <dt>{t(lang, "ipt.result_c")}</dt><dd class="mono">{figureText(lang, result.c, money)}</dd>
            <dt>{t(lang, "ipt.result_pct")}</dt><dd class="mono">{figureText(lang, result.pct, (n) => publishedPct(lang, n))}</dd>
            <dt>{t(lang, "ipt.result_met")}</dt><dd>{pairText(lang, result.met)}</dd>
            {result.rcv ? <><dt>{t(lang, "ipt.result_received")}</dt><dd>{pairText(lang, result.rcv)}</dd></> : null}
          </dl>
          <p class="muted small">{t(lang, "ipt.result_note")}</p>
        </>
      ) : null}
    </Panel>
  );
};
