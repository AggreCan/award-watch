// /monthly and /monthly/:month: the monthly record, each complete month of
// the last twelve in figures (pipeline monthly.py writes monthly/index.json
// and one file a month). The page counts and adds nothing: every figure is
// the file's, formatted here, and a share is taken of two figures the file
// gives. The months before and after a month come from the index, so a
// month's file changes only when its own figures do. Each table has its CSV
// file at /monthly/:month/:table.csv (the index's at /monthly/months.csv),
// counted as a download and sent as the analytics views' files are.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { accountsEnabled } from "../account/switch";
import { ChartStack, barGap, tipHead, tipText, type AxisLabel, type Panel as ChartPanel } from "../chart";
import { styleDate } from "../cite";
import { clockOf } from "../closing";
import { Table } from "../columns";
import {
  MONTH_RE, loadMonth, loadMonthlyIndex, loadStats, monthlyFeed, type AwardRow, type MonthAwardFigure, type MonthBuyer,
  type MonthFigures, type MonthlyIndex, publishedReference,
} from "../data";
import type { AppEnv } from "../env";
import { fmtInt, fmtMoney, fmtPct, numberLocale, pick, segmentLabel, t, tj, tn, type Lang } from "../i18n";
import { Layout, PageHead, Panel, noDataPage, page } from "../layout";
import { SITE_NAME, canonicalUrl, pageSeo, sectionSeo } from "../seo";
import { csvCell } from "./analytics";
import { MonthlyFeedLink } from "./feeds";
import { AwardTable, BuyerLink, money, shareText } from "./shared";

// "October 2026", "octobre 2026": one formatter a language, made on first use.
const MONTH_FORMAT: Partial<Record<Lang, Intl.DateTimeFormat>> = {};
export function monthName(lang: Lang, month: string): string {
  const format = (MONTH_FORMAT[lang] ??= new Intl.DateTimeFormat(numberLocale(lang), { month: "long", year: "numeric", timeZone: "UTC" }));
  return format.format(new Date(`${month}-01T00:00:00Z`));
}

// The tables of a month, each with its CSV file (the name in the address).
export const MONTH_TABLES = ["tenders", "tenderbuyers", "segments", "methods", "awards", "competition", "largest", "awardbuyers"] as const;
type MonthTable = (typeof MONTH_TABLES)[number];

const csvHref = (month: string, table: MonthTable) => `/monthly/${month}/${table}.csv`;
const CsvLink: FC<{ lang: Lang; href: string }> = ({ lang, href }) => <a href={href} rel="nofollow">{t(lang, "analytics.csv")}</a>;
// The record's Atom feed (pipeline feeds.write_monthly_feed), announced in the head of the index and of each month
// and linked beside the index's CSV file, while the index names it.
const feedHead = (lang: Lang, feed: string | null) => (feed ? <MonthlyFeedLink lang={lang} path={feed} /> : undefined);
const Rule: FC<{ text: unknown }> = ({ text }) => <span>{text as any}</span>;

// -- the index ---------------------------------------------------------------------------------------------------------

// The axis of the index's chart: one label a month, the oldest first, every
// other one resting from 700 to 1199 px and only the first, the middle and
// the last on a phone.
function monthLabels(months: readonly string[]): AxisLabel[] {
  const last = months.length - 1;
  const middle = Math.floor(last / 2);
  return months.map((m, i) => ({ x: i + 0.5, text: m, minor: (last - i) % 2 === 1, phone: i === 0 || i === last || i === middle }));
}

const MonthsChart: FC<{ lang: Lang; index: MonthlyIndex }> = ({ lang, index }) => {
  const months = [...index.months].reverse();
  const bar = (label: string, n: number, i: number, month: string) => ({
    x0: i, x1: i + 1, value: n,
    title: tipText(tipHead(lang, label, monthName(lang, month)), [tn(lang, "monthly.notices_one", "monthly.notices_many", n, { n: fmtInt(n, lang) })]),
  });
  const panels: ChartPanel[] = [
    { title: t(lang, "monthly.col_tenders"), bars: months.map((m, i) => bar(t(lang, "monthly.col_tenders"), m.tenders, i, m.month)) },
    { title: t(lang, "monthly.col_awards"), bars: months.map((m, i) => bar(t(lang, "monthly.col_awards"), m.awards, i, m.month)) },
  ];
  return (
    <div class="chart">
      <ChartStack domain={[0, months.length]} panels={panels} height={110} xLabels={monthLabels(months.map((m) => m.month))}
        fmt={(v) => fmtInt(v, lang)} aria={t(lang, "monthly.chart_aria")} gap={barGap(months.length)} />
    </div>
  );
};

export async function monthlyIndexPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const [stats, index] = await Promise.all([loadStats(c.env), loadMonthlyIndex(c.env)]);
  if (!stats || !index) return noDataPage(c, "monthly.title");
  const feed = monthlyFeed(index);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "monthly.title")} dataAsOf={stats.data_as_of} seo={pageSeo("monthly", lang)} head={feedHead(lang, feed)}>
      <PageHead lang={lang} title={t(lang, "monthly.title")} lead={t(lang, "monthly.lead")}>
        <p class="page-note">{t(lang, "monthly.as_of", { date: index.as_of })}</p>
      </PageHead>
      {index.months.length ? (
        <>
          <Panel title={t(lang, "monthly.chart_heading")}>
            <MonthsChart lang={lang} index={index} />
          </Panel>
          <Panel title={t(lang, "monthly.months_heading")}
            tools={<><CsvLink lang={lang} href="/monthly/months.csv" />{feed ? <a href={`/data/${feed}`}>{t(lang, "monthly.follow_feed")}</a> : null}</>}
            foot={<Rule text={t(lang, "monthly.index_rule")} />}>
            <div class="table-wrap bordered">
              <Table cols={[
                { kind: "main", label: t(lang, "monthly.col_month") },
                { kind: "count", label: t(lang, "monthly.col_tenders") },
                { kind: "count", label: t(lang, "monthly.col_awards") },
                { kind: "total", label: t(lang, "monthly.col_awards_value") },
              ]}>
                <tbody>
                  {index.months.map((m) => (
                    <tr>
                      <td data-label={t(lang, "monthly.col_month")} data-sort={m.month}><a href={`/monthly/${m.month}`}>{monthName(lang, m.month)}</a></td>
                      <td data-label={t(lang, "monthly.col_tenders")} class="mono num">{fmtInt(m.tenders, lang)}</td>
                      <td data-label={t(lang, "monthly.col_awards")} class="mono num">{fmtInt(m.awards, lang)}</td>
                      <td data-label={t(lang, "monthly.col_awards_value")} class="mono num">{money(lang, m.awards_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Panel>
        </>
      ) : <p class="muted">{t(lang, "monthly.none")}</p>}
      <NotShown lang={lang} />
      <FreeTools lang={lang} on={accountsEnabled(c.env)} />
    </Layout>,
  );
}

// -- one month ---------------------------------------------------------------------------------------------------------

// The month the address names, when the record holds it; anything else is the site's 404.
async function monthOf(c: Context<AppEnv>): Promise<{ month: string; index: MonthlyIndex } | Response | null> {
  const month = c.req.param("month") ?? "";
  if (!MONTH_RE.test(month)) return null;
  const index = await loadMonthlyIndex(c.env);
  if (!index) return noDataPage(c, "monthly.title");
  return index.months.some((m) => m.month === month) ? { month, index } : null;
}

const count = (lang: Lang, n: number) => fmtInt(n, lang);

// The lead, three or four sentences from the figures by template.
export function monthLead(lang: Lang, f: MonthFigures): string[] {
  const name = monthName(lang, f.month);
  const a = f.awards;
  const out = [t(lang, "monthly.lead_published", {
    month: name,
    tenders: f.tenders.n ? tn(lang, "monthly.lead_tenders_one", "monthly.lead_tenders_many", f.tenders.n, { n: count(lang, f.tenders.n) })
      : t(lang, "monthly.lead_tenders_none"),
    awards: a.n ? tn(lang, "monthly.lead_awards_one", "monthly.lead_awards_many", a.n, { n: count(lang, a.n) }) : t(lang, "monthly.lead_awards_none"),
  })];
  if (a.value !== null) out.push(t(lang, "monthly.lead_value", { value: fmtMoney(a.value, lang) }));
  if (a.n > 0) {
    const pct = fmtPct(a.n_nc, a.n, lang);
    out.push(a.pos !== null && a.pos > 0
      ? t(lang, "monthly.lead_nc_value", { nc: count(lang, a.n_nc), pct, value: fmtMoney(a.pos_nc ?? 0, lang), value_pct: fmtPct(a.pos_nc ?? 0, a.pos, lang) })
      : t(lang, "monthly.lead_nc", { nc: count(lang, a.n_nc), pct }));
  }
  const top = a.largest[0];
  if (top && top.value !== null) {
    // A title's own closing period would sit before the sentence's comma.
    const title = (pick(lang, top.title_en, top.title_fr) ?? publishedReference(top)).replace(/\.$/, "");
    const buyer = pick(lang, top.buyer_en, top.buyer_fr) ?? t(lang, "common.not_stated");
    out.push(top.organization
      ? t(lang, "monthly.lead_largest", { value: fmtMoney(top.value, lang, top.currency), title, buyer, supplier: top.organization })
      : t(lang, "monthly.lead_largest_no_supplier", { value: fmtMoney(top.value, lang, top.currency), title, buyer }));
  }
  // A supplier's name that ends its own abbreviation ("Inc.") ends the sentence with it.
  return out.map((s) => s.replace(/\.\.$/, "."));
}

// A month in a comparison table: a link to its page when the record holds it.
const MonthCell: FC<{ lang: Lang; month: string; held: ReadonlySet<string>; here: string }> = ({ lang, month, held, here }) =>
  month === here ? <strong>{monthName(lang, month)}</strong>
    : held.has(month) ? <a href={`/monthly/${month}`}>{monthName(lang, month)}</a> : <>{monthName(lang, month)}</>;

const BuyerTable: FC<{ lang: Lang; rows: readonly MonthBuyer[]; value: boolean }> = ({ lang, rows, value }) => (
  <div class="table-wrap bordered">
    <Table cols={[
      { kind: "rank", label: t(lang, "col.rank") },
      { kind: "main", label: t(lang, "col.buyer") },
      { kind: "count", label: t(lang, "monthly.col_notices") },
      value && { kind: "total", label: t(lang, "col.value") },
    ]}>
      <tbody>
        {rows.map((b, i) => (
          <tr>
            <td data-label={t(lang, "col.rank")} class="mono num">{fmtInt(i + 1, lang)}</td>
            <td data-label={t(lang, "col.buyer")}><BuyerLink lang={lang} id={b.id} en={b.en} fr={b.fr} /></td>
            <td data-label={t(lang, "monthly.col_notices")} class="mono num">{fmtInt(b.n, lang)}</td>
            {value ? <td data-label={t(lang, "col.value")} class="mono num">{money(lang, b.value ?? null)}</td> : null}
          </tr>
        ))}
      </tbody>
    </Table>
  </div>
);

const None: FC<{ lang: Lang }> = ({ lang }) => <p class="muted">{t(lang, "monthly.none_month")}</p>;

const NotShown: FC<{ lang: Lang }> = ({ lang }) => (
  <Panel title={t(lang, "monthly.not_shown_panel")}>
    <ul class="notes">
      <li>{t(lang, "monthly.not_paid")}</li>
      <li>{t(lang, "monthly.not_changes")}</li>
      <li>{t(lang, "monthly.not_contracts")}</li>
      <li>{t(lang, "monthly.not_amendments")}</li>
      <li>{t(lang, "monthly.not_fixed")}</li>
    </ul>
  </Panel>
);

// The one line to the free tools, while accounts are open: nothing to point at otherwise.
const FreeTools: FC<{ lang: Lang; on: boolean }> = ({ lang, on }) =>
  on ? (
    <p class="muted small">{tj(lang, "monthly.free_tools", {
      buyer: <a href="/buyers">{t(lang, "monthly.free_buyer")}</a>,
      tenders: <a href="/tenders">{t(lang, "monthly.free_tenders")}</a>,
    })}</p>
  ) : null;

// How to cite the page: the /cite page's APA form, with this page's title and address and the figures' date.
const CiteThisPage: FC<{ lang: Lang; month: string; asOf: string; accessed: string }> = ({ lang, month, asOf, accessed }) => (
  <Panel title={t(lang, "monthly.cite_panel")}>
    <div class="cite-page" data-copy={t(lang, "citepage.copy")} data-copied={t(lang, "citepage.copied")}>
      <p>{tj(lang, "monthly.cite_text", { cite: <a href="/cite">{t(lang, "cite.title")}</a> })}</p>
      <h3 id="cite-apa">{t(lang, "citepage.style.apa")}</h3>
      <pre class="cite-block">{tj(lang, "citepage.fmt.apa", {
        author: SITE_NAME,
        year: asOf.slice(0, 4),
        title: <i>{t(lang, "monthly.cite_title", { month: monthName(lang, month) })}</i>,
        data: t(lang, "citepage.data_as_of", { date: styleDate(asOf, lang, "apa") }),
        accessed: styleDate(accessed, lang, "apa"),
        url: canonicalUrl(`/monthly/${month}`, lang),
      })}</pre>
    </div>
    <script src="/cite.js" defer></script>
  </Panel>
);

export async function monthlyPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const found = await monthOf(c);
  if (found === null) return c.notFound();
  if (found instanceof Response) return found;
  const { month, index } = found;
  const [stats, f] = await Promise.all([loadStats(c.env), loadMonth(c.env, month)]);
  if (!stats || !f) return noDataPage(c, "monthly.title");
  const name = monthName(lang, month);
  const title = t(lang, "monthly.page_title", { month: name });
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "monthly.title"), path: "/monthly" }, { name }];
  const held = new Set(index.months.map((m) => m.month));
  const at = index.months.findIndex((m) => m.month === month);
  const newer = at > 0 ? index.months[at - 1].month : null;
  const older = at < index.months.length - 1 ? index.months[at + 1].month : null;
  const tn_ = f.tenders;
  const a = f.awards;
  const tenderRows = [{ month, n: tn_.n }, ...[tn_.before, tn_.year_before].filter((x): x is { month: string; n: number } => !!x)];
  const awardRows: MonthAwardFigure[] = [
    { month, n: a.n, value: a.value, n_no_value: a.n_no_value },
    ...[a.before, a.year_before].filter((x): x is MonthAwardFigure => !!x),
  ];
  const accessed = new Date(clockOf(c.env).now).toISOString().slice(0, 10);
  const seo = sectionSeo(`/monthly/${month}`, title,
    t(lang, "monthly.description", { month: name, tenders: fmtInt(tn_.n, lang), awards: fmtInt(a.n, lang) }), crumbs);
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} seo={seo} head={feedHead(lang, monthlyFeed(index))}>
      <PageHead lang={lang} crumbs={crumbs} title={title} lead={monthLead(lang, f).join(" ")}>
        <p class="page-note">{t(lang, "monthly.as_of", { date: f.as_of })}</p>
      </PageHead>

      <Panel title={t(lang, "monthly.tenders_panel")} tools={<CsvLink lang={lang} href={csvHref(month, "tenders")} />}
        foot={<Rule text={t(lang, "monthly.tenders_rule")} />}>
        <div class="table-wrap bordered">
          <Table cols={[{ kind: "main", label: t(lang, "monthly.col_month") }, { kind: "count", label: t(lang, "monthly.col_tenders") }]}>
            <tbody>
              {tenderRows.map((r) => (
                <tr>
                  <td data-label={t(lang, "monthly.col_month")} data-sort={r.month}><MonthCell lang={lang} month={r.month} held={held} here={month} /></td>
                  <td data-label={t(lang, "monthly.col_tenders")} class="mono num">{fmtInt(r.n, lang)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Panel>

      <Panel title={t(lang, "monthly.tender_buyers_panel")} tools={tn_.buyers.length ? <CsvLink lang={lang} href={csvHref(month, "tenderbuyers")} /> : undefined}
        foot={<Rule text={t(lang, "monthly.tender_buyers_rule", { n: fmtInt(tn_.n_no_buyer, lang) })} />}>
        {tn_.buyers.length ? <BuyerTable lang={lang} rows={tn_.buyers} value={false} /> : <None lang={lang} />}
      </Panel>

      <Panel title={t(lang, "monthly.segments_panel")} tools={tn_.segments.length ? <CsvLink lang={lang} href={csvHref(month, "segments")} /> : undefined}
        foot={<Rule text={t(lang, "monthly.segments_rule", { n: fmtInt(tn_.n_no_segment, lang) })} />}>
        {tn_.segments.length ? (
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "rank", label: t(lang, "col.rank") },
              { kind: "main", label: t(lang, "col.segment") },
              { kind: "count", label: t(lang, "monthly.col_notices") },
            ]}>
              <tbody>
                {tn_.segments.map((s, i) => (
                  <tr>
                    <td data-label={t(lang, "col.rank")} class="mono num">{fmtInt(i + 1, lang)}</td>
                    <td data-label={t(lang, "col.segment")}><a href={`/segments/${s.code}`}>{segmentLabel(lang, s.code)}</a> <span class="mono muted">{s.code}</span></td>
                    <td data-label={t(lang, "monthly.col_notices")} class="mono num">{fmtInt(s.n, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : <None lang={lang} />}
      </Panel>

      <Panel title={t(lang, "monthly.methods_panel")} tools={tn_.methods.length ? <CsvLink lang={lang} href={csvHref(month, "methods")} /> : undefined}
        foot={<Rule text={t(lang, "monthly.methods_rule")} />}>
        {tn_.methods.length ? (
          <div class="table-wrap bordered">
            <Table cols={[{ kind: "main", label: t(lang, "monthly.col_procurement_method") }, { kind: "part", label: t(lang, "monthly.col_notices") }]}>
              <tbody>
                {tn_.methods.map((m) => (
                  <tr>
                    <td data-label={t(lang, "monthly.col_procurement_method")}>{pick(lang, m.en, m.fr) ?? t(lang, "monthly.method_unstated")}</td>
                    <td data-label={t(lang, "monthly.col_notices")} class="mono num" data-sort={String(m.n)}>{shareText(lang, m.n, tn_.n, (v) => fmtInt(v, lang))}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : <None lang={lang} />}
        <p class="small">{tn_.days_open.median !== null
          ? t(lang, "monthly.days_open", { days: fmtInt(tn_.days_open.median, lang), n: fmtInt(tn_.days_open.n, lang) })
          : t(lang, "monthly.days_open_none")}</p>
      </Panel>

      <Panel title={t(lang, "monthly.awards_panel")} tools={<CsvLink lang={lang} href={csvHref(month, "awards")} />}
        foot={<Rule text={t(lang, "monthly.awards_rule", { no_value: fmtInt(a.n_no_value, lang), not_counted: fmtInt(a.n_not_counted, lang) })} />}>
        <div class="table-wrap bordered">
          <Table cols={[
            { kind: "main", label: t(lang, "monthly.col_month") },
            { kind: "count", label: t(lang, "monthly.col_awards") },
            { kind: "total", label: t(lang, "monthly.col_awards_value") },
            { kind: "count", label: t(lang, "monthly.col_no_value") },
          ]}>
            <tbody>
              {awardRows.map((r) => (
                <tr>
                  <td data-label={t(lang, "monthly.col_month")} data-sort={r.month}><MonthCell lang={lang} month={r.month} held={held} here={month} /></td>
                  <td data-label={t(lang, "monthly.col_awards")} class="mono num">{fmtInt(r.n, lang)}</td>
                  <td data-label={t(lang, "monthly.col_awards_value")} class="mono num">{money(lang, r.value)}</td>
                  <td data-label={t(lang, "monthly.col_no_value")} class="mono num">{fmtInt(r.n_no_value, lang)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Panel>

      <Panel title={t(lang, "monthly.competition_panel")} tools={<CsvLink lang={lang} href={csvHref(month, "competition")} />}
        foot={<Rule text={t(lang, "monthly.competition_rule", { unstated: fmtInt(a.n_unstated, lang) })} />}>
        <div class="table-wrap bordered">
          <Table cols={[
            { kind: "main", label: t(lang, "monthly.col_measure") },
            { kind: "total", label: t(lang, "monthly.col_non_competitive") },
            { kind: "total", label: t(lang, "monthly.col_whole") },
            { kind: "count", label: t(lang, "monthly.col_share") },
          ]}>
            <tbody>
              <tr>
                <td data-label={t(lang, "monthly.col_measure")}>{t(lang, "monthly.by_number")}</td>
                <td data-label={t(lang, "monthly.col_non_competitive")} class="mono num">{fmtInt(a.n_nc, lang)}</td>
                <td data-label={t(lang, "monthly.col_whole")} class="mono num">{fmtInt(a.n, lang)}</td>
                <td data-label={t(lang, "monthly.col_share")} class="mono num">{fmtPct(a.n_nc, a.n, lang) || t(lang, "common.not_applicable")}</td>
              </tr>
              <tr>
                <td data-label={t(lang, "monthly.col_measure")}>{t(lang, "monthly.by_value")}</td>
                <td data-label={t(lang, "monthly.col_non_competitive")} class="mono num">{money(lang, a.pos === null ? null : a.pos_nc ?? 0)}</td>
                <td data-label={t(lang, "monthly.col_whole")} class="mono num">{money(lang, a.pos)}</td>
                <td data-label={t(lang, "monthly.col_share")} class="mono num">{(a.pos !== null && fmtPct(a.pos_nc ?? 0, a.pos, lang)) || t(lang, "common.not_applicable")}</td>
              </tr>
            </tbody>
          </Table>
        </div>
      </Panel>

      <Panel title={t(lang, "monthly.largest_panel")} tools={a.largest.length ? <CsvLink lang={lang} href={csvHref(month, "largest")} /> : undefined}
        foot={<Rule text={t(lang, "monthly.largest_rule")} />}>
        {a.largest.length ? <AwardTable lang={lang} rows={a.largest} /> : <None lang={lang} />}
      </Panel>

      <Panel title={t(lang, "monthly.award_buyers_panel")} tools={a.buyers.length ? <CsvLink lang={lang} href={csvHref(month, "awardbuyers")} /> : undefined}
        foot={<Rule text={t(lang, "monthly.award_buyers_rule", { n: fmtInt(a.n_no_buyer, lang) })} />}>
        {a.buyers.length ? <BuyerTable lang={lang} rows={a.buyers} value /> : <None lang={lang} />}
      </Panel>

      <Panel title={t(lang, "monthly.suppliers_panel")} foot={<Rule text={t(lang, "monthly.suppliers_rule")} />}>
        <ul class="kv">
          <li><span>{t(lang, "monthly.suppliers_named")}</span><span class="num">{fmtInt(a.suppliers, lang)}</span></li>
          <li><span>{t(lang, "monthly.suppliers_new")}</span><span class="num">{fmtInt(a.suppliers_new, lang)}</span></li>
        </ul>
      </Panel>

      <NotShown lang={lang} />
      <CiteThisPage lang={lang} month={month} asOf={f.as_of} accessed={accessed} />

      <nav aria-label={t(lang, "monthly.months_nav")} class="toolbar">
        <div class="toolbar-row">
          <ul class="quick-links">
            {older ? <li><a href={`/monthly/${older}`} rel="prev">{t(lang, "monthly.previous", { month: monthName(lang, older) })}</a></li> : null}
            {newer ? <li><a href={`/monthly/${newer}`} rel="next">{t(lang, "monthly.next", { month: monthName(lang, newer) })}</a></li> : null}
            <li><a href="/monthly">{t(lang, "monthly.all")}</a></li>
          </ul>
        </div>
      </nav>
      <FreeTools lang={lang} on={accountsEnabled(c.env)} />
    </Layout>,
  );
}

// -- the CSV files -----------------------------------------------------------------------------------------------------

const dollars = (v: number | null | undefined) => (v === null || v === undefined ? null : v.toFixed(2));
const competitive = (r: AwardRow) => (r.competitive === true || r.competitive === 1 ? 1 : r.competitive === false || r.competitive === 0 ? 0 : null);

// Each table's columns and rows as its file writes them: plain figures, dollars with two decimals, and both
// languages' names where the page shows one.
export function monthCsvRows(f: MonthFigures, table: MonthTable): [string[], unknown[][]] {
  const t_ = f.tenders;
  const a = f.awards;
  const buyer = (b: MonthBuyer) => [b.id ?? "", b.en ?? "", b.fr ?? ""];
  switch (table) {
    case "tenders":
      return [["month", "tender_notices"], [[f.month, t_.n], ...[t_.before, t_.year_before].filter((x) => !!x).map((x) => [x!.month, x!.n])]];
    case "tenderbuyers":
      return [["rank", "buyer_id", "buyer", "buyer_fr", "tender_notices"], t_.buyers.map((b, i) => [i + 1, ...buyer(b), b.n])];
    case "segments":
      return [["rank", "segment", "segment_title", "segment_title_fr", "tender_notices"],
        t_.segments.map((s, i) => [i + 1, s.code, segmentLabel("en", s.code), segmentLabel("fr", s.code), s.n])];
    case "methods":
      return [["method", "method_fr", "tender_notices"], t_.methods.map((m) => [m.en ?? "", m.fr ?? "", m.n])];
    case "awards":
      return [["month", "award_notices", "value_cad", "award_notices_without_value"],
        [[f.month, a.n, dollars(a.value), a.n_no_value], ...[a.before, a.year_before].filter((x) => !!x).map((x) => [x!.month, x!.n, dollars(x!.value), x!.n_no_value])]];
    case "competition":
      return [["measure", "non_competitive", "all_award_notices"],
        [["number", a.n_nc, a.n], ["positive_value_cad", a.pos === null ? null : dollars(a.pos_nc ?? 0), dollars(a.pos)]]];
    case "largest":
      return [["rank", "reference", "title", "title_fr", "published", "awarded", "organization_id", "supplier", "buyer_id", "buyer", "buyer_fr",
        "value", "currency", "competitive"],
        a.largest.map((r, i) => [i + 1, publishedReference(r), r.title_en ?? "", r.title_fr ?? "", r.published ?? "", r.awarded ?? "",
          r.organization_id ?? "", r.organization ?? "", r.buyer_id ?? "", r.buyer_en ?? "", r.buyer_fr ?? "", dollars(r.value), r.currency ?? "",
          competitive(r)])];
    case "awardbuyers":
      return [["rank", "buyer_id", "buyer", "buyer_fr", "award_notices", "value_cad", "award_notices_without_value"],
        a.buyers.map((b, i) => [i + 1, ...buyer(b), b.n, dollars(b.value), b.n_no_value ?? 0])];
  }
}

// A CSV file as the analytics views send theirs: the same type, the file named in its disposition, private and never
// kept by a shared cache.
function csvFile(name: string, made: [string[], unknown[][]]): Response {
  const body = [made[0], ...made[1]].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^a-z0-9.-]/gi, "-")}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function monthlyCsv(c: Context<AppEnv>): Promise<Response> {
  const table = (c.req.param("table") ?? "").replace(/\.csv$/, "");
  if (!(MONTH_TABLES as readonly string[]).includes(table)) return c.notFound();
  const found = await monthOf(c);
  if (found === null) return c.notFound();
  if (found instanceof Response) return found;
  const f = await loadMonth(c.env, found.month);
  if (!f) return noDataPage(c, "monthly.title");
  return csvFile(`awardwatch-monthly-${found.month}-${table}`, monthCsvRows(f, table as MonthTable));
}

export async function monthlyIndexCsv(c: Context<AppEnv>): Promise<Response> {
  const index = await loadMonthlyIndex(c.env);
  if (!index) return noDataPage(c, "monthly.title");
  return csvFile(`awardwatch-monthly-${index.as_of}`, [["month", "tender_notices", "award_notices", "value_cad"],
    index.months.map((m) => [m.month, m.tenders, m.awards, dollars(m.awards_value)])]);
}
