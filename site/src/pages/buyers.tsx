// /buyers: every federal institution with its counters, from buyers/index.json:
// the departments, agencies and Crown corporations first, then, apart, the
// institutions only the lobbying registry names (kind "institution").
// /buyers/:id: one institution's yearly figures per source, the organizations
// it paid most in each, its contracts ending soon (when the file carries
// them), its open notices and newest award notices, and the other names it
// appears under. Each source keeps its own column; nothing adds two sources
// together.

import type { Context } from "hono";
import { accountsEnabled } from "../account/switch";
import { WatchControl, watchControl } from "../account/watch_pages";
import { ChartStack, type Panel as ChartPanel, yearLabels } from "../chart";
import { Table } from "../columns";
import { MONEY_SOURCES } from "../constants";
import { BUYER_ID_RE, INSTITUTION, loadBuyer, loadBuyerAlias, loadBuyers, loadStats, type BuyerAlias, type BuyerSummary } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, fmtMoney, fmtMoneyShort, numberLocale, pick, sourceLabel, t, tn, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, lowerRedirect, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { ProTag } from "../pro";
import { buyerSeo, pageSeo } from "../seo";
import { newestFirst } from "./awards";
import { IncumbentsPanel, loadIncumbents } from "./backbone";
import { ExpiringSection } from "./expiring";
import { EXPIRING_EVENT, loadFeedIndex } from "./feeds";
import { InterestPanel, interestFilter } from "./interest";
import { holdersPart } from "../instruments";
import { HoldersPanel } from "./instruments";
import {
  AnalyticsLink, AwardTable, BUYER_SOURCE_RESTS, Count, OrgTotalTable, PHONE_ROWS, PhonePagerScript, PhonePages, SourceLine, SourcesSeparate, YearsBox, money,
  shareText, sourceCellClass, sourceColumns,
} from "./shared";

const KIND: Record<string, Key> = {
  department: "buyer.kind_department",
  agency: "buyer.kind_agency",
  crown: "buyer.kind_crown",
  other: "buyer.kind_other",
  [INSTITUTION]: "buyer.kind_institution",
};

// "Also appears as": the other names, a former one marked as such.
function AlsoAppearsAs({ lang, aliases }: { lang: Lang; aliases: BuyerAlias[] }) {
  if (!aliases.length) return null;
  return (
    <p class="page-note buyer-aliases">
      {t(lang, "buyer.also")}{" "}
      {aliases.map((a, i) => (
        <>
          {i ? "; " : null}
          <span>{a.name}</span>
          {a.note === "former" ? <span class="muted"> ({t(lang, "buyer.former_name")})</span> : null}
        </>
      ))}
    </p>
  );
}

export function buyerName(lang: Lang, b: Pick<BuyerSummary, "name_en" | "name_fr" | "acronym_en" | "acronym_fr">): string {
  return pick(lang, b.name_en, b.name_fr) ?? b.name_en;
}

function acronym(lang: Lang, b: Pick<BuyerSummary, "acronym_en" | "acronym_fr">): string | null {
  return pick(lang, b.acronym_en, b.acronym_fr);
}

// A buyer's records in the four sources, the order /buyers lists them in by default.
export function buyerRecords(b: Pick<BuyerSummary, "n_awards" | "n_history" | "n_contracts" | "n_grants">): number {
  return b.n_awards + b.n_history + b.n_contracts + b.n_grants;
}

export async function buyersIndex(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const idx = stats ? await loadBuyers(c.env) : null;
  if (!stats || !idx) return noDataPage(c, "buyers.title");
  // The departments with the most records first; ?sort=name for A to Z.
  const byName = c.req.query("sort") === "name";
  const name = (a: BuyerSummary, b: BuyerSummary) => buyerName(lang, a).localeCompare(buyerName(lang, b), numberLocale(lang));
  const sorted = [...idx.buyers].sort(byName ? name : (a, b) => buyerRecords(b) - buyerRecords(a) || name(a, b));
  // The institutions only the lobbying registry names go in a list of their own,
  // so the departments' list holds the institutions that publish what is counted.
  const rows = sorted.filter((b) => b.kind !== INSTITUTION);
  const institutions = [...idx.buyers].filter((b) => b.kind === INSTITUTION)
    .sort(byName ? name : (a, b) => (b.n_lobbying ?? 0) - (a.n_lobbying ?? 0) || name(a, b));
  const n = (v: number) => fmtInt(v, lang);
  const cell = (count: number, total: number | null | undefined) => (
    <>
      <Count lang={lang} n={count} />
      {total ? <><br /><span class="muted small">{money(lang, total)}</span></> : null}
    </>
  );
  const sortHref = (s: "" | "name") => (s ? `/buyers?sort=${s}` : "/buyers");
  return page(
    c,
    <Layout lang={lang} title={t(lang, "buyers.title")} dataAsOf={stats.data_as_of} active="/buyers" seo={pageSeo("buyers", lang, byName ? { noindex: true } : {})}>
      <PageHead lang={lang} title={t(lang, "buyers.title")} lead={t(lang, "buyers.lead", { n: n(stats.counts.buyers ?? rows.length) })}
        actions={<a href="/downloads/buyers.csv" class="btn">{t(lang, "buyers.csv")}</a>}>
        <p class="page-note"><SourcesSeparate lang={lang} /> {t(lang, "buyers.note")}</p>
      </PageHead>
      <Panel title={t(lang, institutions.length ? "buyers.panel_departments" : "buyers.panel")} count={n(rows.length)}
        tools={<nav class="tabs tabs-small" aria-label={t(lang, "common.order")}>
          <a href={sortHref("")} aria-current={byName ? undefined : "page"}>{t(lang, "common.order_records")}</a>
          <a href={sortHref("name")} aria-current={byName ? "page" : undefined}>{t(lang, "common.order_name")}</a>
        </nav>}>
      <PhonePages lang={lang} on>
        <Table cols={[
          { kind: "main", label: t(lang, "col.buyer") },
          { kind: "count", label: t(lang, "buyers.col_open") },
          ...sourceColumns(lang, BUYER_SOURCE_RESTS),
        ]}>
          <tbody>
            {rows.map((b) => (
              <tr>
                <td data-label={t(lang, "col.buyer")}>
                  <a href={`/buyers/${b.id}`}>{buyerName(lang, b)}</a>
                  {acronym(lang, b) ? <span class="muted"> ({acronym(lang, b)})</span> : null}
                </td>
                <td data-label={t(lang, "buyers.col_open")} class="mono num">
                  {b.n_open_tenders ? <a href={`/tenders?buyer=${b.id}`}>{n(b.n_open_tenders)}</a> : <Count lang={lang} n={0} />}
                </td>
                <td data-label={sourceLabel(lang, "awards")} class={sourceCellClass("awards", BUYER_SOURCE_RESTS)}>{cell(b.n_awards, b.total_awards)}</td>
                <td data-label={sourceLabel(lang, "history")} class={sourceCellClass("history", BUYER_SOURCE_RESTS)}>{cell(b.n_history, b.total_history)}</td>
                <td data-label={sourceLabel(lang, "contracts")} class={sourceCellClass("contracts", BUYER_SOURCE_RESTS)}>{cell(b.n_contracts, b.total_contracts)}</td>
                <td data-label={sourceLabel(lang, "grants")} class={sourceCellClass("grants", BUYER_SOURCE_RESTS)}>{cell(b.n_grants, b.total_grants)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PhonePages>
      </Panel>
      {institutions.length ? (
        <Panel id="institutions" title={t(lang, "buyers.panel_institutions")} count={n(institutions.length)}>
          <p class="muted small">{t(lang, "buyers.institutions_note")}</p>
          <Table cols={[
            { kind: "main", label: t(lang, "buyers.col_institution") },
            { kind: "count", label: t(lang, "buyers.col_lobbying") },
          ]}>
            <tbody>
              {institutions.map((b) => (
                <tr>
                  <td data-label={t(lang, "buyers.col_institution")}>
                    <a href={`/buyers/${b.id}`}>{buyerName(lang, b)}</a>
                    {acronym(lang, b) ? <span class="muted"> ({acronym(lang, b)})</span> : null}
                  </td>
                  <td data-label={t(lang, "buyers.col_lobbying")} class="mono num">{n(b.n_lobbying ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      ) : null}
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
  const dataYear = Number(todayOf(stats.data_as_of).slice(0, 4));
  const withValue = b.years.filter((y) => (y.total ?? 0) > 0);
  let chart = null;
  if (withValue.length) {
    const first = Math.min(...withValue.map((y) => y.year));
    const last = Math.max(...withValue.map((y) => y.year));
    const panels: ChartPanel[] = MONEY_SOURCES.filter((s) => withValue.some((y) => y.source === s)).map((s) => ({
      title: sourceLabel(lang, s),
      bars: withValue.filter((y) => y.source === s).map((y) => ({ x0: y.year, x1: y.year + 1, value: y.total ?? 0, title: `${y.year}: ${fmtMoney(y.total ?? 0, lang)}` })),
    }));
    chart = (
      <div class="chart">
        <ChartStack domain={[first, last + 1]} panels={panels} height={110} xLabels={yearLabels(first, last)} fmt={(v) => fmtMoneyShort(v, lang)} aria={t(lang, "org.chart_aria")} />
      </div>
    );
  }
  const totals = { awards: b.buyer.total_awards, history: b.buyer.total_history ?? null, contracts: b.buyer.total_contracts, grants: b.buyer.total_grants };
  // Years after the data date's are as the sources date them.
  const lateYears = b.years.some((y) => y.year > dataYear);
  const counts = { awards: b.buyer.n_awards, history: b.buyer.n_history, contracts: b.buyer.n_contracts, grants: b.buyer.n_grants };
  // The years the records span, from the first to the data year (a year typed
  // past it in the source stays in the table, not in this line).
  const known = b.years.filter((y) => y.n > 0).map((y) => y.year);
  const upTo = known.filter((y) => y <= dataYear);
  const span = known.length ? { first: Math.min(...known), last: upTo.length ? Math.max(...upTo) : Math.max(...known) } : null;
  const ranked = MONEY_SOURCES.filter((s) => (b.top_organizations[s] ?? []).length);
  const [interest, feedIndex, incumbents] = await Promise.all([
    interestFilter(c.env, lang, "buyer", `/buyers/${b.buyer.id}`, { name }),
    loadFeedIndex(c).catch(() => null),
    loadIncumbents(c, "buyer", b.buyer.id, todayOf(stats.data_as_of)),
  ]);
  const feeds = feedIndex?.feeds.filter((f) => f.scope === "buyer" && f.key === b.buyer.id) ?? [];
  const feed = (event: string) => feeds.find((f) => f.event === event);
  const FEED_BUTTON: [string, Key][] = [["tenders", "feeds.button_tenders"], ["awards", "feeds.button_awards"], [EXPIRING_EVENT, "expiring.feed"]];
  const watch = await watchControl(c, "buyer", b.buyer.id);

  return page(
    c,
    <Layout lang={lang} title={name} dataAsOf={stats.data_as_of} active="/buyers" seo={buyerSeo(b, lang, crumbs)}>
      <PageHead lang={lang} crumbs={crumbs}
        title={<>{name}{acronym(lang, b.buyer) ? <span class="muted"> ({acronym(lang, b.buyer)})</span> : null}</>}
        lead={<>
          {b.buyer.kind && KIND[b.buyer.kind] ? t(lang, KIND[b.buyer.kind]) : t(lang, "buyer.kind_other")}
          {b.buyer.ckan_org ? <> · <a href={`https://open.canada.ca/data/${lang}/organization/${encodeURIComponent(b.buyer.ckan_org)}`}>{t(lang, "buyer.open_data")}</a></> : null}
        </>}
        actions={<>
          <a href={`/tenders?buyer=${b.buyer.id}`} class="btn btn-primary">
            {tn(lang, "buyer.open_one", "buyer.open_many", b.open_tenders, { n: n(b.open_tenders) })}
          </a>
          {FEED_BUTTON.map(([event, key]) => {
            const f = feed(event);
            return f ? <a href={`/data/${f.path}`} class="btn">{t(lang, key)}</a> : null;
          })}
          <AnalyticsLink lang={lang} href={`/buyers/${b.buyer.id}/analytics`} on={accountsEnabled(c.env)} />
          <a href={`/buyers/${b.buyer.id}/records`} class="btn" rel="nofollow">{t(lang, "records.link")}</a>
        </>}>
        {span ? <p class="page-note">{t(lang, "buyer.seen", { first: String(span.first), last: String(span.last) })}</p> : null}
        <WatchControl lang={lang} state={watch} kind="buyer" target={b.buyer.id} />
        {b.buyer.n_lobbying ? (
          <p class="page-note">{t(lang, "buyer.lobbying", { n: n(b.buyer.n_lobbying) })}</p>
        ) : null}
        <AlsoAppearsAs lang={lang} aliases={b.aliases ?? []} />
      </PageHead>

      {/* A tile opens the source's largest values when the page has them. */}
      <section class="tiles" aria-label={t(lang, "org.tiles_label")}>
        {MONEY_SOURCES.map((s) => {
          const body = (
            <>
              <span class="tile-label">{sourceLabel(lang, s)}</span>
              <span class="tile-value">{fmtMoneyShort(totals[s] ?? 0, lang)}</span>
              <span class="tile-note">{tn(lang, "org.tile_records_one", "org.tile_records_many", counts[s], { n: n(counts[s]) })}</span>
            </>
          );
          return ranked.includes(s) ? <a class="tile" href={`#top-${s}`}>{body}</a> : <div class="tile">{body}</div>;
        })}
      </section>
      <p class="tiles-note"><SourcesSeparate lang={lang} /></p>

      {b.expiring ? (
        <ExpiringSection lang={lang} part={b.expiring} heading="buyer.expiring" buyer={false} phoneRows={PHONE_ROWS}
          link={<a href={`/expiring/12m?buyer=${b.buyer.id}`}>
            {t(lang, "buyer.expiring_all")}{accountsEnabled(c.env) ? <>{" "}<ProTag lang={lang} /></> : null}
          </a>} />
      ) : null}

      <IncumbentsPanel lang={lang} inc={incumbents} />

      <HoldersPanel lang={lang} part={holdersPart(b)} kind="buyer" filter={`user=${b.buyer.id}`} />

      <div class="panel-grid">
        {ranked.map((s) => (
          <Panel id={`top-${s}`} title={t(lang, "buyer.top", { source: sourceLabel(lang, s) })}>
            <OrgTotalTable lang={lang} rows={b.top_organizations[s] ?? []} rank />
          </Panel>
        ))}
      </div>

      <Panel title={t(lang, "buyer.recent_awards")} foot={<SourceLine lang={lang} source="awards" />}>
        {/* The newest published notices, in the order of the Awarded column, as on the home page. */}
        {b.recent_awards.length ? <AwardTable lang={lang} rows={newestFirst(b.recent_awards)} buyer={false} phoneRows={PHONE_ROWS} /> : <p class="muted">{t(lang, "awards.none")}</p>}
      </Panel>

      <InterestPanel lang={lang} filter={interest} />

      <Panel id="years" title={t(lang, "org.years")} foot={<span>{t(lang, "org.nc_footnote")}</span>}>
      {lateYears ? <p class="muted small">{t(lang, "common.dates_as_published")}</p> : null}
      {chart}
      {b.years.length ? (
        <YearsBox lang={lang} years={b.years} dataYear={dataYear} cols={[
          { kind: "date", label: t(lang, "col.year") },
          { kind: "main", label: t(lang, "col.source") },
          { kind: "count", label: t(lang, "col.records") },
          { kind: "total", label: t(lang, "col.value") },
          { kind: "share", label: <span title={t(lang, "competitive.def_no")}>{t(lang, "org.col_nc_count")}</span> },
          { kind: "count", label: t(lang, "buyer.col_organizations"), rest: "md" },
        ]} cells={(y) => (
          <>
            <td data-label={t(lang, "col.year")} class="mono">{y.year}</td>
            <td data-label={t(lang, "col.source")}>{sourceLabel(lang, y.source)}</td>
            <td data-label={t(lang, "col.records")} class="mono num">{n(y.n)}</td>
            <td data-label={t(lang, "col.value")} class="mono num">{money(lang, y.total)}</td>
            <td data-label={t(lang, "org.col_nc_count")} class="mono num">
              {shareText(lang, y.n_non_competitive, y.source === "grants" ? null : y.n, n)}
            </td>
            <td data-label={t(lang, "buyer.col_organizations")} class="mono num mdh">{y.n_organizations === null ? "" : n(y.n_organizations)}</td>
          </>
        )} />
      ) : <p class="muted">{t(lang, "org.years_none")}</p>}
      </Panel>
      <PhonePagerScript lang={lang} />
    </Layout>,
  );
}
