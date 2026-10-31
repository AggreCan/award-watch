// The expiring-contracts radar (CLAUDE.md "Expiring-contracts radar"):
// contracts whose newest version ends within 12 months of the data date,
// each listed once whichever sources hold it.
//
// /expiring: the three cumulative windows (expiring/index.json), the first
// 50 rows of the 3-month list (expiring/3m/1.json), and the counts by buyer
// and by UNSPSC segment.
// /expiring/:window: one window, read one page at a time
// (expiring/<window>/<n>.json, 500 rows each, soonest end first) with
// expiring/<window>/index.json for the page count, so no request parses a
// whole window. The filters in the URL (buyer, segment, competitive, value
// band, source) apply to the page loaded, and the page says so.
//
// The buyer pages and the profiles carry the first 25 rows of their own
// (ExpiringSection below) when their file has them.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { SEGMENTS } from "../constants";
import {
  BUYER_ID_RE, EXPIRING_KINDS, EXPIRING_WINDOWS, SEGMENT_RE, isExpiringWindow, loadExpiringIndex, loadExpiringPage,
  loadExpiringWindow, loadStats, type ExpiringKind, type ExpiringPart, type ExpiringRow, type ExpiringWindow,
} from "../data";
import type { AppEnv } from "../env";
import { fmtInt, fmtMoneyShort, numberLocale, pick, segmentLabel, sourceLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import { Breadcrumb, CompetitiveFlag, Layout, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { canonicalUrl, expiringWindowSeo, pageSeo } from "../seo";
import { EXPIRING_EVENT, loadFeedIndex } from "./feeds";
import { BuyerLink, SegmentChips, awardNoticeUrl, contractSearchUrl, datasetUrl, money } from "./shared";

// How many rows of the 3-month list the overview shows.
export const EXPIRING_FIRST = 50;
export const EXPIRING_CSV = "expiring-12m.csv";
export const EXPIRING_FEED = "feeds/canada/expiring.xml";

const WINDOW_LABEL: Record<ExpiringWindow, Key> = { "3m": "expiring.window_3m", "6m": "expiring.window_6m", "12m": "expiring.window_12m" };
const WINDOW_TITLE: Record<ExpiringWindow, Key> = {
  "3m": "expiring.window_title_3m", "6m": "expiring.window_title_6m", "12m": "expiring.window_title_12m",
};
export const WINDOW_MONTHS: Record<ExpiringWindow, Key> = { "3m": "expiring.months_3m", "6m": "expiring.months_6m", "12m": "expiring.months_12m" };
const KIND_LABEL: Record<ExpiringKind, Key> = { award: "expiring.kind_award", history: "expiring.kind_history", contract: "expiring.kind_contract" };
// The source each kind is read from, for the source filter's labels.
const KIND_SOURCE: Record<ExpiringKind, string> = { award: "awards", history: "history", contract: "contracts" };

// -- value bands and the filters in the URL -------------------------------------

// In Canadian dollars, lower bound included, upper bound excluded.
export const VALUE_BANDS = ["under-100k", "100k-1m", "1m-10m", "over-10m"] as const;
export type ValueBand = (typeof VALUE_BANDS)[number];
const BAND_LIMITS: Record<ValueBand, [number, number]> = {
  "under-100k": [-Infinity, 100_000],
  "100k-1m": [100_000, 1_000_000],
  "1m-10m": [1_000_000, 10_000_000],
  "over-10m": [10_000_000, Infinity],
};
const BAND_LABEL: Record<ValueBand, Key> = {
  "under-100k": "expiring.band_under_100k",
  "100k-1m": "expiring.band_100k_1m",
  "1m-10m": "expiring.band_1m_10m",
  "over-10m": "expiring.band_over_10m",
};

export const COMPETITIVE_FILTERS = ["yes", "no", "unstated"] as const;
export type CompetitiveFilter = (typeof COMPETITIVE_FILTERS)[number];
const COMPETITIVE_LABEL: Record<CompetitiveFilter, Key> = { yes: "competitive.yes", no: "competitive.no", unstated: "competitive.unstated" };

export interface ExpiringQuery {
  buyer: string;
  segment: string;
  competitive: CompetitiveFilter | "";
  value: ValueBand | "";
  kind: ExpiringKind | "";
}

// The query as the form writes it. A value the filter cannot use reads as no
// filter, so a stale or hand-typed link still opens a page.
export function readExpiringQuery(url: URL): ExpiringQuery {
  const get = (k: string) => (url.searchParams.get(k) ?? "").trim();
  const buyer = get("buyer").toLowerCase();
  const segment = get("segment");
  const competitive = get("competitive").toLowerCase();
  const value = get("value").toLowerCase();
  const kind = get("kind").toLowerCase();
  return {
    buyer: BUYER_ID_RE.test(buyer) && buyer.length <= 80 ? buyer : "",
    segment: SEGMENT_RE.test(segment) ? segment : "",
    competitive: (COMPETITIVE_FILTERS as readonly string[]).includes(competitive) ? (competitive as CompetitiveFilter) : "",
    value: (VALUE_BANDS as readonly string[]).includes(value) ? (value as ValueBand) : "",
    kind: (EXPIRING_KINDS as readonly string[]).includes(kind) ? (kind as ExpiringKind) : "",
  };
}

const FILTER_KEYS = ["buyer", "segment", "competitive", "value", "kind"] as const;

export function isFiltered(q: ExpiringQuery): boolean {
  return FILTER_KEYS.some((k) => q[k] !== "");
}

// The URL of a view: only the values set, in a fixed order, then the page.
export function expiringQueryString(q: ExpiringQuery, pageNo = 1): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (q[k]) p.set(k, q[k]);
  if (pageNo > 1) p.set("page", String(pageNo));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function competitiveOfRow(r: ExpiringRow): CompetitiveFilter {
  return r.competitive === true || r.competitive === 1 ? "yes" : r.competitive === false || r.competitive === 0 ? "no" : "unstated";
}

// A row's band, or null when it has no value or its value is in another
// currency (the bands are Canadian dollars).
export function valueBand(r: Pick<ExpiringRow, "value" | "currency">): ValueBand | null {
  if (r.value === null) return null;
  const currency = (r.currency ?? "").trim().toUpperCase();
  if (currency && currency !== "CAD") return null;
  const v = r.value;
  return VALUE_BANDS.find((b) => v >= BAND_LIMITS[b][0] && v < BAND_LIMITS[b][1]) ?? null;
}

const KIND_ORDER: Record<ExpiringKind, number> = { award: 0, history: 1, contract: 2 };

// Soonest end first; the source's preference order and the reference break
// ties, so the order never depends on the file's.
export function soonestFirst(rows: readonly ExpiringRow[]): ExpiringRow[] {
  return [...rows].sort((a, b) => {
    const x = a.end.slice(0, 10);
    const y = b.end.slice(0, 10);
    if (x !== y) return x < y ? -1 : 1;
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0;
  });
}

export function filterExpiring(rows: readonly ExpiringRow[], q: ExpiringQuery): ExpiringRow[] {
  return rows.filter((r) => {
    if (q.buyer && r.buyer_id !== q.buyer) return false;
    if (q.segment && !r.segments.includes(q.segment)) return false;
    if (q.competitive && competitiveOfRow(r) !== q.competitive) return false;
    if (q.value && valueBand(r) !== q.value) return false;
    if (q.kind && r.kind !== q.kind) return false;
    return true;
  });
}

// -- cells ----------------------------------------------------------------------------

// "+25%", "-10%", "0%"; a change under half a percent either way reads "<1%"
// with its sign, so a small change never reads as none.
export function growthPct(lang: Lang, growth: number): string {
  const pct = growth * 100;
  const whole = Math.round(pct);
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  const n = whole === 0 && pct !== 0 ? (lang === "fr" ? "< 1" : "<1") : fmtInt(Math.abs(whole), lang);
  return t(lang, "pct", { n: `${sign}${n}` });
}

// A published contract's reference is "owner_org:reference"; the search
// takes the reference alone.
export function contractReference(r: Pick<ExpiringRow, "kind" | "reference">): string {
  if (r.kind !== "contract") return r.reference;
  const at = r.reference.indexOf(":");
  return at >= 0 ? r.reference.slice(at + 1) : r.reference;
}

// The government's own record of a row: the CanadaBuys notice for an award;
// the contract history dataset for a PSPC record, which has no page of its
// own on CanadaBuys; the contracts search for a published contract.
export function expiringRecordUrl(r: Pick<ExpiringRow, "kind" | "reference">, lang: Lang): string {
  if (r.kind === "award") return awardNoticeUrl(r.reference, lang);
  if (r.kind === "history") return datasetUrl("history", lang);
  return contractSearchUrl(contractReference(r));
}

const RECORD_LABEL: Record<ExpiringKind, Key> = {
  award: "expiring.record_award", history: "expiring.record_history", contract: "expiring.record_contract",
};

// The site's own page for the row, where it has one.
function sitePath(r: ExpiringRow): string | null {
  if (r.kind === "award") return `/awards/${r.reference.toLowerCase()}`;
  if (r.kind === "history") return `/history/${r.reference.toLowerCase()}`;
  return null;
}

const Organization: FC<{ lang: Lang; r: ExpiringRow }> = ({ lang, r }) => {
  if (r.supplier_withheld) return <span class="muted">{t(lang, "expiring.withheld")}</span>;
  if (r.organization_id) return <a href={`/organizations/${r.organization_id}`}>{r.organization ?? r.organization_id}</a>;
  return <>{r.organization ?? t(lang, "common.not_stated")}</>;
};

export const ExpiringTable: FC<{ lang: Lang; rows: readonly ExpiringRow[]; organization?: boolean; buyer?: boolean }> = ({
  lang, rows, organization = true, buyer = true,
}) => (
  <div class="table-wrap bordered">
    <table class="restack">
      <thead>
        <tr>
          <th>{t(lang, "expiring.col_ends")}</th>
          <th>{t(lang, "col.contract")}</th>
          {organization ? <th>{t(lang, "col.organization")}</th> : null}
          {buyer ? <th>{t(lang, "col.buyer")}</th> : null}
          <th class="num">{t(lang, "col.value")}</th>
          <th>{t(lang, "col.method")}</th>
          <th><span title={t(lang, "expiring.growth_def")}>{t(lang, "expiring.col_amendments")}</span></th>
          <th>{t(lang, "col.record")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const title = pick(lang, r.title_en, r.title_fr) ?? contractReference(r);
          const path = sitePath(r);
          const instrument = pick(lang, r.instrument_en, r.instrument_fr);
          return (
            <tr>
              <td data-label={t(lang, "expiring.col_ends")} class="mono">
                {r.end.slice(0, 10)}
                <br />
                <span class="muted small">{tn(lang, "expiring.days_left_one", "expiring.days_left_many", r.days_left, { n: fmtInt(r.days_left, lang) })}</span>
              </td>
              <td data-label={t(lang, "col.contract")}>
                {path ? <a href={path}>{title}</a> : title}
                <br />
                <span class="mono id muted">{contractReference(r)}</span> <SegmentChips lang={lang} codes={r.segments} />
                {instrument ? <><br /><span class="muted small">{instrument}</span></> : null}
              </td>
              {organization ? <td data-label={t(lang, "col.organization")}><Organization lang={lang} r={r} /></td> : null}
              {buyer ? <td data-label={t(lang, "col.buyer")}><BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} /></td> : null}
              <td data-label={t(lang, "col.value")} class="mono num">{money(lang, r.value, r.currency)}</td>
              <td data-label={t(lang, "col.method")}><CompetitiveFlag lang={lang} value={r.competitive} /></td>
              <td data-label={t(lang, "expiring.col_amendments")}>
                {r.n_amendments === 0
                  ? t(lang, "expiring.amendments_none")
                  : tn(lang, "expiring.amendments_one", "expiring.amendments_many", r.n_amendments, { n: fmtInt(r.n_amendments, lang) })}
                {r.value_growth === null ? null : (
                  <><br /><span class="muted small">{t(lang, "expiring.growth", { pct: growthPct(lang, r.value_growth) })}</span></>
                )}
              </td>
              <td data-label={t(lang, "col.record")}>
                <span class="muted small">{t(lang, KIND_LABEL[r.kind])}</span>
                <br />
                <a href={expiringRecordUrl(r, lang)} rel={r.kind === "contract" ? "nofollow noopener" : "noopener"}>{t(lang, RECORD_LABEL[r.kind])}</a>
                {r.tender_reference ? (
                  <><br /><a href={`/tenders/${r.tender_reference.toLowerCase()}`}>{t(lang, "contract.tender_link")}</a></>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

// The section on a buyer page or a profile: how many of its contracts end
// within 12 months, their value, the first rows, and where the rest are.
// more is said when the part holds fewer rows than it counts; link always.
export const ExpiringSection: FC<{
  lang: Lang; part: ExpiringPart; heading: Key; organization?: boolean; buyer?: boolean; more?: unknown; link?: unknown;
}> = ({ lang, part, heading, organization, buyer, more, link }) => {
  const rows = soonestFirst(part.rows);
  return (
    <>
      <h2 id="expiring">{t(lang, heading)}</h2>
      <p>
        {part.n === 0
          ? t(lang, "expiring.part_none")
          : tn(lang, "expiring.part_one", "expiring.part_many", part.n, { n: fmtInt(part.n, lang), total: money(lang, part.total) })}
      </p>
      {rows.length ? <ExpiringTable lang={lang} rows={rows} organization={organization} buyer={buyer} /> : null}
      {rows.length < part.n ? (
        <p class="more-rows">{t(lang, "expiring.part_shown", { shown: fmtInt(rows.length, lang) })}{more ? <> {more as any}</> : null}</p>
      ) : null}
      {link ? <p>{link as any}</p> : null}
      <p class="muted small">
        {tj(lang, "expiring.value_note", { rules: <a href="/methodology#expiring">{t(lang, "expiring.rules_link")}</a> })}
      </p>
    </>
  );
};

// The rest of a profile's rows are in the 12-month CSV file.
export const MoreInCsv: FC<{ lang: Lang; part: ExpiringPart }> = ({ lang, part }) => {
  const more = part.n - part.rows.length;
  if (more <= 0) return null;
  return (
    <>
      {tj(lang, more === 1 ? "expiring.part_more_one" : "expiring.part_more_many", {
        more: fmtInt(more, lang), csv: <a href={`/downloads/${EXPIRING_CSV}`}>{t(lang, "expiring.csv_link")}</a>,
      })}
    </>
  );
};

// -- pages ----------------------------------------------------------------------------

// Which expiring feeds the feed index lists: the national one (linked, and
// named for Atom autodiscovery) and any at all (the link to the feeds page).
async function expiringFeeds(c: Context<AppEnv>): Promise<{ national: boolean; any: boolean }> {
  const feeds = (await loadFeedIndex(c))?.feeds.filter((f) => f.event === EXPIRING_EVENT) ?? [];
  return { national: feeds.some((f) => f.path === EXPIRING_FEED), any: feeds.length > 0 };
}

const FeedLink: FC<{ lang: Lang }> = ({ lang }) => (
  <link rel="alternate" type="application/atom+xml" title={t(lang, "feeds.link_title", { event: t(lang, "feeds.ev.expiring") })} href={`/data/${EXPIRING_FEED}`} />
);

const WindowLinks: FC<{ lang: Lang; current: ExpiringWindow; q: ExpiringQuery }> = ({ lang, current, q }) => (
  <nav aria-label={t(lang, "expiring.windows_nav")}>
    <ul class="quick-links">
      {EXPIRING_WINDOWS.map((w) => (
        <li>
          {w === current
            ? <span aria-current="page">{t(lang, WINDOW_LABEL[w])}</span>
            : <a href={`/expiring/${w}${expiringQueryString(q)}`}>{t(lang, WINDOW_LABEL[w])}</a>}
        </li>
      ))}
    </ul>
  </nav>
);

export async function expiringPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const idx = stats ? await loadExpiringIndex(c.env) : null;
  if (!stats || !idx) return noDataPage(c, "expiring.title");
  const windows = EXPIRING_WINDOWS.map((w) => idx.windows.find((x) => x.window === w)).filter((w) => w !== undefined);
  const three = windows.find((w) => w.window === "3m");
  // The 3-month list's first page: none to read when the window is empty,
  // null when its file is missing (the section says so, the page stands).
  const [first, feeds] = await Promise.all([
    three && three.n > 0 ? loadExpiringPage(c.env, "3m", 1) : Promise.resolve([] as ExpiringRow[]),
    expiringFeeds(c),
  ]);
  const shown = first ? soonestFirst(first).slice(0, EXPIRING_FIRST) : [];
  const n = (v: number) => fmtInt(v, lang);
  const byBuyerName = (b: (typeof idx.by_buyer)[number]) => pick(lang, b.buyer_en, b.buyer_fr) ?? b.buyer_id ?? t(lang, "common.not_stated");

  return page(
    c,
    <Layout lang={lang} title={t(lang, "expiring.title")} dataAsOf={stats.data_as_of} active="/expiring" seo={pageSeo("expiring", lang)}
      head={feeds.national ? <FeedLink lang={lang} /> : null}>
      <h1>{t(lang, "expiring.title")}</h1>
      <p class="lead">{t(lang, "expiring.lead", { date: /^\d{4}-\d{2}-\d{2}/.test(idx.as_of) ? idx.as_of.slice(0, 10) : todayOf(stats.data_as_of) })}</p>
      <p class="muted small">
        {tj(lang, "expiring.value_note", { rules: <a href="/methodology#expiring">{t(lang, "expiring.rules_link")}</a> })}
      </p>

      {windows.length ? (
        <section class="tiles" aria-label={t(lang, "expiring.tiles_label")}>
          {windows.map((w) => (
            <a class="tile" href={`/expiring/${w.window}`}>
              <span class="tile-label">{t(lang, WINDOW_LABEL[w.window])}</span>
              <span class="tile-value">{n(w.n)}</span>
              <span class="tile-note">
                {t(lang, "expiring.tile_total", { total: w.total === null ? t(lang, "common.not_stated") : fmtMoneyShort(w.total, lang) })}
              </span>
            </a>
          ))}
        </section>
      ) : null}

      <p class="links">
        <a href={`/downloads/${EXPIRING_CSV}`} class="btn">{t(lang, "expiring.download")}</a>
        {feeds.national ? <a href={`/data/${EXPIRING_FEED}`} class="btn">{t(lang, "expiring.feed")}</a> : null}
        {feeds.any ? <a href="/feeds#expiring" class="btn">{t(lang, "expiring.feeds_all")}</a> : null}
      </p>

      <section class="topic">
        <div class="topic-head">
          <h2>{t(lang, "expiring.first_heading")}</h2>
          <a href="/expiring/3m">{t(lang, "expiring.first_all")}</a>
        </div>
        {first === null ? (
          <p class="muted">{t(lang, "expiring.list_missing")}</p>
        ) : shown.length ? (
          <>
            <p class="muted small">{t(lang, "expiring.first_note", { n: n(shown.length) })}</p>
            <ExpiringTable lang={lang} rows={shown} />
          </>
        ) : (
          <p class="muted">{t(lang, "expiring.none_window")}</p>
        )}
      </section>

      <h2 id="buyers">{t(lang, "expiring.by_buyer")}</h2>
      {idx.by_buyer.length ? (
        <div class="table-wrap bordered">
          <table class="restack">
            <thead>
              <tr>
                <th>{t(lang, "col.buyer")}</th>
                <th class="num">{t(lang, "expiring.col_contracts")}</th>
                <th class="num">{t(lang, "col.value")}</th>
              </tr>
            </thead>
            <tbody>
              {idx.by_buyer.map((b) => (
                <tr>
                  <td data-label={t(lang, "col.buyer")}>
                    {b.buyer_id ? <a href={`/buyers/${b.buyer_id}`}>{byBuyerName(b)}</a> : byBuyerName(b)}
                  </td>
                  <td data-label={t(lang, "expiring.col_contracts")} class="mono num">
                    {b.buyer_id ? <a href={`/expiring/12m?buyer=${b.buyer_id}`}>{n(b.n)}</a> : n(b.n)}
                  </td>
                  <td data-label={t(lang, "col.value")} class="mono num">{money(lang, b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p class="muted">{t(lang, "expiring.none_window")}</p>}

      <h2 id="segments">{t(lang, "expiring.by_segment")}</h2>
      <p class="muted small">{t(lang, "expiring.by_segment_note")}</p>
      {idx.by_segment.length ? (
        <div class="table-wrap bordered">
          <table class="restack">
            <thead>
              <tr>
                <th>{t(lang, "col.segment")}</th>
                <th class="num">{t(lang, "expiring.col_contracts")}</th>
                <th class="num">{t(lang, "col.value")}</th>
              </tr>
            </thead>
            <tbody>
              {idx.by_segment.map((g) => (
                <tr>
                  <td data-label={t(lang, "col.segment")}>
                    {g.code in SEGMENTS ? <a href={`/categories/${g.code}`}>{`${g.code} ${segmentLabel(lang, g.code)}`}</a> : g.code}
                  </td>
                  <td data-label={t(lang, "expiring.col_contracts")} class="mono num">
                    <a href={`/expiring/12m?segment=${g.code}`}>{n(g.n)}</a>
                  </td>
                  <td data-label={t(lang, "col.value")} class="mono num">{money(lang, g.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p class="muted">{t(lang, "expiring.none_window")}</p>}
    </Layout>,
  );
}

// The page a ?page= query asks for: 1 when there is none, null when it is not
// a page number.
function pageOf(c: Context<AppEnv>): number | null {
  const raw = c.req.query("page");
  if (raw === undefined) return 1;
  const n = Number(raw);
  return /^[0-9]{1,6}$/.test(raw) && n >= 1 ? n : null;
}

type Option = { value: string; label: string; n: number };

// Each select lists the values the loaded page carries, with how many of its
// rows carry each, plus the value the link asks for when the page has none.
function options(rows: readonly ExpiringRow[], q: ExpiringQuery, lang: Lang) {
  const tally = (pairs: [string, string][], current: string, fallback: (v: string) => string): Option[] => {
    const seen = new Map<string, Option>();
    for (const [value, label] of pairs) {
      const o = seen.get(value);
      if (o) o.n++;
      else seen.set(value, { value, label, n: 1 });
    }
    if (current && !seen.has(current)) seen.set(current, { value: current, label: fallback(current), n: 0 });
    return [...seen.values()];
  };
  const byLabel = (a: Option, b: Option) => a.label.localeCompare(b.label, numberLocale(lang));
  const fixed = <V extends string>(values: readonly V[], label: (v: V) => string, of: (r: ExpiringRow) => V | null): Option[] =>
    values.map((v) => ({ value: v, label: label(v), n: rows.filter((r) => of(r) === v).length }));
  return {
    buyer: tally(
      rows.filter((r) => r.buyer_id).map((r): [string, string] => [r.buyer_id!, pick(lang, r.buyer_en, r.buyer_fr) ?? r.buyer_id!]),
      q.buyer, (v) => v,
    ).sort(byLabel),
    segment: tally(rows.flatMap((r) => r.segments.map((s): [string, string] => [s, `${s} ${segmentLabel(lang, s)}`])), q.segment, (v) => `${v} ${segmentLabel(lang, v)}`)
      .sort((a, b) => a.value.localeCompare(b.value)),
    competitive: fixed(COMPETITIVE_FILTERS, (v) => t(lang, COMPETITIVE_LABEL[v]), competitiveOfRow),
    value: fixed(VALUE_BANDS, (v) => t(lang, BAND_LABEL[v]), valueBand),
    kind: fixed(EXPIRING_KINDS, (v) => sourceLabel(lang, KIND_SOURCE[v]), (r) => r.kind),
  };
}

const Select: FC<{ name: string; label: Key; opts: Option[]; value: string; lang: Lang }> = ({ name, label, opts, value, lang }) => (
  <label>
    {t(lang, label)}
    <select name={name}>
      <option value="">{t(lang, "tenders.any")}</option>
      {opts.map((o) => (
        <option value={o.value} selected={o.value === value}>{`${o.label} (${fmtInt(o.n, lang)})`}</option>
      ))}
    </select>
  </label>
);

export async function expiringWindowPage(c: Context<AppEnv>, raw: string): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  // A window that is not one is a 404 whether or not the data is published.
  if (!isExpiringWindow(raw)) return notFoundPage(c, stats?.data_as_of ?? null, "expiring.window_not_found", "/expiring", "expiring.back");
  if (!stats) return noDataPage(c, "expiring.title");
  const window = raw;
  const idx = await loadExpiringWindow(c.env, window);
  if (!idx) return noDataPage(c, "expiring.title");
  const path = `/expiring/${window}`;
  const n = pageOf(c);
  if (n === null || (n > 1 && n > idx.pages)) return notFoundPage(c, stats.data_as_of, "expiring.page_not_found", path, "expiring.back_window");
  const rows = idx.pages === 0 ? [] : await loadExpiringPage(c.env, window, n);
  if (!rows) return noDataPage(c, "expiring.title");
  const q = readExpiringQuery(new URL(c.req.url));
  const filtered = isFiltered(q);
  const sorted = soonestFirst(rows);
  const shown = filtered ? filterExpiring(sorted, q) : sorted;
  const pages = Math.max(1, idx.pages);
  const date = todayOf(stats.data_as_of);
  const months = t(lang, WINDOW_MONTHS[window]);
  const title = t(lang, WINDOW_TITLE[window]);
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "expiring.title"), path: "/expiring" }, { name: t(lang, WINDOW_LABEL[window]) }];
  const prevPath = n > 1 ? `${path}${expiringQueryString(q, n - 1)}` : null;
  const nextPath = n < pages ? `${path}${expiringQueryString(q, n + 1)}` : null;
  // A filtered or later view is a view of the window's first page.
  const noindex = filtered || c.req.query("page") !== undefined;
  const opts = options(sorted, q, lang);

  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/expiring"
      seo={expiringWindowSeo(path, title, lang, crumbs, { n: idx.rows, months, date, noindex })}
      head={filtered ? null : <>
        {prevPath ? <link rel="prev" href={canonicalUrl(prevPath, lang)} /> : null}
        {nextPath ? <link rel="next" href={canonicalUrl(nextPath, lang)} /> : null}
      </>}>
      <Breadcrumb lang={lang} crumbs={crumbs} />
      <h1>{title}</h1>
      <p class="lead">
        {tn(lang, "expiring.window_count_one", "expiring.window_count_many", idx.rows, { n: fmtInt(idx.rows, lang), months, date })}{" "}
        {t(lang, "expiring.window_total", { total: money(lang, idx.total) })}
      </p>
      <p class="muted small">
        {tj(lang, "expiring.value_note", { rules: <a href="/methodology#expiring">{t(lang, "expiring.rules_link")}</a> })}
      </p>
      <p>
        <a href={`/downloads/${EXPIRING_CSV}`}>{t(lang, "expiring.download")}</a>
      </p>
      <WindowLinks lang={lang} current={window} q={q} />
      <div class="list-layout">
        <form method="get" action={path} class="filters stack">
          <Select name="buyer" label="tenders.filter_buyer" opts={opts.buyer} value={q.buyer} lang={lang} />
          <Select name="segment" label="tenders.filter_segment" opts={opts.segment} value={q.segment} lang={lang} />
          <Select name="competitive" label="col.method" opts={opts.competitive} value={q.competitive} lang={lang} />
          <Select name="value" label="expiring.filter_value" opts={opts.value} value={q.value} lang={lang} />
          <Select name="kind" label="col.source" opts={opts.kind} value={q.kind} lang={lang} />
          <p class="muted small">{t(lang, "expiring.band_note")}</p>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">{t(lang, "tenders.apply")}</button>
            <a href={path} class="btn">{t(lang, "tenders.reset")}</a>
          </div>
        </form>
        <div class="results">
          {filtered ? (
            <>
              <p class="muted small">
                {t(lang, "expiring.filter_note", { rows: fmtInt(sorted.length, lang), page: fmtInt(n, lang), pages: fmtInt(pages, lang) })}
              </p>
              <p aria-live="polite">{tn(lang, "expiring.match_one", "expiring.match_many", shown.length, { n: fmtInt(shown.length, lang) })}</p>
            </>
          ) : null}
          {shown.length ? (
            <ExpiringTable lang={lang} rows={shown} />
          ) : (
            <p class="muted">{t(lang, filtered ? "expiring.none_match" : "expiring.none_window")}</p>
          )}
          <nav aria-label={t(lang, "common.pagination")} class="pagination">
            <span class="muted">{t(lang, "tenders.page_of", { page: fmtInt(n, lang), pages: fmtInt(pages, lang) })}</span>
            <span class="pages">
              {prevPath ? <a href={prevPath} class="btn" rel="prev">{t(lang, "tenders.prev")}</a> : null}
              {nextPath ? <a href={nextPath} class="btn" rel="next">{t(lang, "tenders.next")}</a> : null}
            </span>
          </nav>
        </div>
      </div>
    </Layout>,
  );
}
