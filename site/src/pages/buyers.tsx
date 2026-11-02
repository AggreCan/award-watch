// /buyers: every federal institution with its counters, from buyers/index.json.
// /buyers/:id: one institution's yearly figures per source, the organizations
// it paid most in each, its contracts ending soon (when the file carries
// them), its open notices and newest award notices. Each source keeps its own
// column; nothing adds two sources together.

import type { Context } from "hono";
import { ChartStack, type Panel as ChartPanel } from "../chart";
import { Table } from "../columns";
import { MONEY_SOURCES } from "../constants";
import { BUYER_ID_RE, loadBuyer, loadBuyerAlias, loadBuyers, loadStats, type BuyerSummary } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, fmtMoney, fmtMoneyShort, numberLocale, pick, sourceLabel, t, tn, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, lowerRedirect, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { buyerSeo, pageSeo } from "../seo";
import { ExpiringSection } from "./expiring";
import { AwardTable, OrgTotalTable, PhonePagerScript, PhonePages, SourceLine, SourcesSeparate, money, shareText } from "./shared";

const KIND: Record<string, Key> = {
  department: "buyer.kind_department",
  agency: "buyer.kind_agency",
  crown: "buyer.kind_crown",
  other: "buyer.kind_other",
};

export function buyerName(lang: Lang, b: Pick<BuyerSummary, "name_en" | "name_fr" | "acronym_en" | "acronym_fr">): string {
  return pick(lang, b.name_en, b.name_fr) ?? b.name_en;
}

function acronym(lang: Lang, b: Pick<BuyerSummary, "acronym_en" | "acronym_fr">): string | null {
  return pick(lang, b.acronym_en, b.acronym_fr);
}

export async function buyersIndex(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const idx = stats ? await loadBuyers(c.env) : null;
  if (!stats || !idx) return noDataPage(c, "buyers.title");
  const rows = [...idx.buyers].sort((a, b) => buyerName(lang, a).localeCompare(buyerName(lang, b), numberLocale(lang)));
  const n = (v: number) => fmtInt(v, lang);
  const cell = (count: number, total: number | null | undefined) => (
    <>
      {n(count)}
      {total ? <><br /><span class="muted small">{money(lang, total)}</span></> : null}
    </>
  );
  return page(
    c,
    <Layout lang={lang} title={t(lang, "buyers.title")} dataAsOf={stats.data_as_of} active="/buyers" seo={pageSeo("buyers", lang)}>
      <PageHead lang={lang} title={t(lang, "buyers.title")} lead={t(lang, "buyers.lead", { n: n(stats.counts.buyers ?? rows.length) })}
        actions={<a href="/downloads/buyers.csv" class="btn">{t(lang, "buyers.csv")}</a>}>
        <p class="page-note"><SourcesSeparate lang={lang} /> {t(lang, "buyers.note")}</p>
      </PageHead>
      <Panel title={t(lang, "buyers.panel")} count={n(rows.length)}>
      <PhonePages lang={lang} on>
        <Table cols={[
          { kind: "main", label: t(lang, "col.buyer") },
          { kind: "count", label: t(lang, "buyers.col_open") },
          { kind: "total", label: sourceLabel(lang, "awards") },
          { kind: "total", label: sourceLabel(lang, "history") },
          { kind: "total", label: sourceLabel(lang, "contracts") },
          { kind: "total", label: sourceLabel(lang, "grants") },
        ]}>
          <tbody>
            {rows.map((b) => (
              <tr>
                <td data-label={t(lang, "col.buyer")}>
                  <a href={`/buyers/${b.id}`}>{buyerName(lang, b)}</a>
                  {acronym(lang, b) ? <span class="muted"> ({acronym(lang, b)})</span> : null}
                </td>
                <td data-label={t(lang, "buyers.col_open")} class="mono num">
                  {b.n_open_tenders ? <a href={`/tenders?buyer=${b.id}`}>{n(b.n_open_tenders)}</a> : n(b.n_open_tenders ?? 0)}
                </td>
                <td data-label={sourceLabel(lang, "awards")} class="mono num">{cell(b.n_awards, b.total_awards)}</td>
                <td data-label={sourceLabel(lang, "history")} class="mono num">{cell(b.n_history, b.total_history)}</td>
                <td data-label={sourceLabel(lang, "contracts")} class="mono num">{cell(b.n_contracts, b.total_contracts)}</td>
                <td data-label={sourceLabel(lang, "grants")} class="mono num">{cell(b.n_grants, b.total_grants)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PhonePages>
      </Panel>
      <PhonePagerScript lang={lang} />
    </Layout>,
  );
}

export async function buyerPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const raw = c.req.param("id") ?? "";
  const id = raw.toLowerCase();
  if (!BUYER_ID_RE.test(id) || id.length > 80) return c.notFound();
  const redirect = lowerRedirect(c, `/buyers/${id}`);
  if (redirect) return redirect;
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "buyers.title");
  const b = await loadBuyer(c.env, id);
  if (!b) {
    // A buyer id that moved (the export's buyers/aliases.json) answers with its new address.
    const moved = await loadBuyerAlias(c.env, id);
    if (moved) {
      const asked = c.req.query("lang");
      c.header("Cache-Control", "public, max-age=300");
      return c.redirect(`/buyers/${moved}${asked === "en" || asked === "fr" ? `?lang=${asked}` : ""}`, 301);
    }
    return notFoundPage(c, stats.data_as_of, "buyer.not_found", "/buyers", "buyer.back");
  }
  const name = buyerName(lang, b.buyer);
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "buyers.title"), path: "/buyers" }, { name }];
  const n = (v: number) => fmtInt(v, lang);
  const years = [...b.years].sort((x, y) => y.year - x.year || MONEY_SOURCES.indexOf(x.source) - MONEY_SOURCES.indexOf(y.source));
  const withValue = b.years.filter((y) => (y.total ?? 0) > 0);
  let chart = null;
  if (withValue.length) {
    const first = Math.min(...withValue.map((y) => y.year));
    const last = Math.max(...withValue.map((y) => y.year));
    const panels: ChartPanel[] = MONEY_SOURCES.filter((s) => withValue.some((y) => y.source === s)).map((s) => ({
      title: sourceLabel(lang, s),
      bars: withValue.filter((y) => y.source === s).map((y) => ({ x0: y.year, x1: y.year + 1, value: y.total ?? 0, title: `${y.year}: ${fmtMoney(y.total ?? 0, lang)}` })),
    }));
    const labels = [];
    for (let y = first; y <= last; y++) labels.push({ x: y + 0.5, text: String(y), minor: (last - y) % 2 === 1 && last - first > 8 });
    chart = (
      <div class="chart">
        <ChartStack domain={[first, last + 1]} panels={panels} height={110} xLabels={labels} fmt={(v) => fmtMoneyShort(v, lang)} aria={t(lang, "org.chart_aria")} />
      </div>
    );
  }
  const totals = { awards: b.buyer.total_awards, history: b.buyer.total_history ?? null, contracts: b.buyer.total_contracts, grants: b.buyer.total_grants };
  // Years after the data date's are as the sources date them.
  const lateYears = b.years.some((y) => y.year > Number(todayOf(stats.data_as_of).slice(0, 4)));
  const counts = { awards: b.buyer.n_awards, history: b.buyer.n_history, contracts: b.buyer.n_contracts, grants: b.buyer.n_grants };

  return page(
    c,
    <Layout lang={lang} title={name} dataAsOf={stats.data_as_of} active="/buyers" seo={buyerSeo(b, lang, crumbs)}>
      <PageHead lang={lang} crumbs={crumbs}
        title={<>{name}{acronym(lang, b.buyer) ? <span class="muted"> ({acronym(lang, b.buyer)})</span> : null}</>}
        lead={<>
          {b.buyer.kind && KIND[b.buyer.kind] ? t(lang, KIND[b.buyer.kind]) : t(lang, "buyer.kind_other")}
          {b.buyer.ckan_org ? <> · <a href={`https://open.canada.ca/data/${lang}/organization/${encodeURIComponent(b.buyer.ckan_org)}`}>{t(lang, "buyer.open_data")}</a></> : null}
        </>}
        actions={<a href={`/tenders?buyer=${b.buyer.id}`} class="btn btn-primary">
          {tn(lang, "buyer.open_one", "buyer.open_many", b.open_tenders, { n: n(b.open_tenders) })}
        </a>} />

      <section class="tiles" aria-label={t(lang, "org.tiles_label")}>
        {MONEY_SOURCES.map((s) => (
          <div class="tile">
            <span class="tile-label">{sourceLabel(lang, s)}</span>
            <span class="tile-value">{fmtMoneyShort(totals[s] ?? 0, lang)}</span>
            <span class="tile-note">{tn(lang, "org.tile_records_one", "org.tile_records_many", counts[s], { n: n(counts[s]) })}</span>
          </div>
        ))}
      </section>
      <p class="tiles-note"><SourcesSeparate lang={lang} /></p>

      <Panel title={t(lang, "org.years")} foot={<span>{t(lang, "org.nc_footnote")}</span>}>
      {lateYears ? <p class="muted small">{t(lang, "common.dates_as_published")}</p> : null}
      {chart}
      {years.length ? (
        <div class="table-wrap bordered">
          <Table cols={[
            { kind: "date", label: t(lang, "col.year") },
            { kind: "main", label: t(lang, "col.source") },
            { kind: "count", label: t(lang, "col.records") },
            { kind: "total", label: t(lang, "col.value") },
            { kind: "share", label: <span title={t(lang, "competitive.def_no")}>{t(lang, "org.col_nc_count")}</span> },
            { kind: "count", label: t(lang, "buyer.col_organizations"), rest: "md" },
          ]}>
            <tbody>
              {years.map((y) => (
                <tr>
                  <td data-label={t(lang, "col.year")} class="mono">{y.year}</td>
                  <td data-label={t(lang, "col.source")}>{sourceLabel(lang, y.source)}</td>
                  <td data-label={t(lang, "col.records")} class="mono num">{n(y.n)}</td>
                  <td data-label={t(lang, "col.value")} class="mono num">{money(lang, y.total)}</td>
                  <td data-label={t(lang, "org.col_nc_count")} class="mono num">
                    {shareText(lang, y.n_non_competitive, y.source === "grants" ? null : y.n, n)}
                  </td>
                  <td data-label={t(lang, "buyer.col_organizations")} class="mono num mdh">{y.n_organizations === null ? "" : n(y.n_organizations)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : <p class="muted">{t(lang, "org.years_none")}</p>}
      </Panel>

      <div class="panel-grid">
        {MONEY_SOURCES.map((s) => {
          const rows = b.top_organizations[s] ?? [];
          return rows.length ? (
            <Panel title={t(lang, "buyer.top", { source: sourceLabel(lang, s) })}>
              <OrgTotalTable lang={lang} rows={rows} rank />
            </Panel>
          ) : null;
        })}
      </div>

      {b.expiring ? (
        <ExpiringSection lang={lang} part={b.expiring} heading="buyer.expiring" buyer={false}
          link={<a href={`/expiring/12m?buyer=${b.buyer.id}`}>{t(lang, "buyer.expiring_all")}</a>} />
      ) : null}

      <Panel title={t(lang, "buyer.recent_awards")} foot={<SourceLine lang={lang} source="awards" />}>
        {b.recent_awards.length ? <AwardTable lang={lang} rows={b.recent_awards} buyer={false} /> : <p class="muted">{t(lang, "awards.none")}</p>}
      </Panel>
    </Layout>,
  );
}
