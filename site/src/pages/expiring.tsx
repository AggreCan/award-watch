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
// whole window. The filters in the URL (buyer, client department,
// organization, segment, province with or without the derived ones,
// competitive, value band, source, the two marks)
// and the orders (by end date or by value, either way, which the table's
// heads set too) apply to the whole window, read from the records
// database (rec_expiring, src/records_tables.ts), RADAR_PAGE_ROWS to a page,
// with the matches' count and total; the matches as CSV are Pro's
// (export_filtered). Without the database they apply to the page loaded, as
// before, and the page says so.
//
// The buyer pages and the profiles carry the first 25 rows of their own
// (ExpiringSection below) when their file has them.
//
// Once the accounts switch is on, the 6- and 12-month windows are part of
// Pro (feature radar_depth, src/plan.ts): a request whose plan lacks it gets
// the window's count and total and its first rows (expiringTeaser), and its
// files under /data/expiring/ answer 404 (expiringFile). The overview and
// the 3-month window never change. Until the switch, nothing does. While it
// is on, the tabs and tiles that lead to a deep window, and the links to the
// 12-month list, carry the Pro chip (src/pro.tsx) for every reader.
//
// On a window's page (the full list and the free view), a signed-in reader
// sees under each holder's name its record with the buyer (src/lines.ts,
// radarLines below) for the rows ending within the plan's days, Free the
// 3-month list's and Pro the 12-month list's; a reader not signed in sees
// one line saying so. The page is then private, as every signed-in page is.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { allowed } from "../account/entitlements";
import { SaveSearchForm, SaveSearchLine, SaveSearchRow, saveControl } from "../account/search_control";
import { railAccount } from "../account/session";
import { accountsEnabled } from "../account/switch";
import { ShortMoney } from "../chart";
import { type HeadSort, type Rest, type SortOrders, Table, headSort, restClass } from "../columns";
import { PROVINCES, SEGMENTS } from "../constants";
import {
  BUYER_ID_RE, EXPIRING_KINDS, EXPIRING_WINDOWS, ORG_ID_RE, SEGMENT_RE, indigenousMark, isExpiringRow, isExpiringWindow, loadExpiringIndex,
  loadExpiringPage, loadExpiringWindow, loadStats, type ExpiringKind, type ExpiringPart, type ExpiringRow, type ExpiringWindow,
  type ExpiringWindowIndex, type IndigenousMark, type Stats,
} from "../data";
import type { AppEnv } from "../env";
import { fmtInt, numberLocale, pick, provinceName, segmentLabel, sourceLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import { CompetitiveFlag, Layout, addDays, noDataPage, notFoundPage, page, PageHead, Panel, todayOf, varyOnCookie } from "../layout";
import { lineKey, parseLine } from "../lines";
import { RadarLineNotes, RadarMark, type RadarLines, markText } from "../lines_view";
import { DEEP_WINDOWS, type Plan, allowsRadarDepth, radarWindowLocked, requestPlan } from "../plan";
import { dollars, num, orgIdOf, orgNumber } from "../records_db";
import {
  RADAR_CSV_MAX, RADAR_PAGE_ROWS, type RadarParams, type RadarSort, type Read, type Row, type SortDir, readLines, readRadar, readRadarCsv,
} from "../records_tables";
import { csvCell } from "./analytics";
import { ProNote, ProPanel, ProTag, checkoutPrice, ultraCheckoutPrice } from "../pro";
import { canonicalUrl, expiringWindowSeo, pageSeo } from "../seo";
import { EXPIRING_EVENT, loadFeedIndex } from "./feeds";
import { InterestPanel, interestFilter } from "./interest";
import {
  BuyerLink, FiltersFold, PhonePagerScript, PhonePages, RestFlag, RestParty, SegmentChips, SegmentNote, type ServerPages, awardNoticeUrl,
  contractPath, contractSearchUrl, datasetUrl, instrumentText, money,
} from "./shared";

// How many rows of the 3-month list the overview shows.
export const EXPIRING_FIRST = 50;
// The rows in each page file of a window (expiring/<window>/<n>.json).
export const EXPIRING_PAGE_ROWS = 500;
// How many rows of a 6- or 12-month window a request without the paid
// feature sees, once the accounts switch is on.
export const EXPIRING_TEASER_ROWS = 10;
// Each window in days from the data date, as the pipeline cuts them (expiring.py WINDOWS).
export const WINDOW_DAYS: Record<ExpiringWindow, number> = { "3m": 91, "6m": 182, "12m": 365 };

// The days within which a plan sees the holder's record (src/lines.ts): the
// radar's own windows, the 3-month list's on Free and the 12-month list's on
// Pro, as radar_depth opens them.
export function lineDays(plan: Plan): number {
  return WINDOW_DAYS[allowsRadarDepth(plan) ? "12m" : "3m"];
}

// The narrowest window a contract ending in this many days falls in, or null past the last.
export function windowOf(daysLeft: number): ExpiringWindow | null {
  if (daysLeft < 0) return null;
  return EXPIRING_WINDOWS.find((w) => daysLeft <= WINDOW_DAYS[w]) ?? null;
}
// The radar's CSV files, one a window. The 6- and 12-month ones are part of
// Pro once the accounts switch is on, each by its own window's gate
// (index.tsx refuses them as expiringFile refuses the window files, by the
// window pages/data.tsx DOWNLOADS names); the 3-month one stays free, so the
// overview, the 3-month list and the free view of a deeper window link it. A
// deep window's full list links its own file.
export const EXPIRING_CSV = "expiring-12m.csv";
export const EXPIRING_CSV_6M = "expiring-6m.csv";
export const EXPIRING_CSV_3M = "expiring-3m.csv";
type CsvWindow = ExpiringWindow;
const CSV_FILE: Record<CsvWindow, string> = { "3m": EXPIRING_CSV_3M, "6m": EXPIRING_CSV_6M, "12m": EXPIRING_CSV };
const CSV_DOWNLOAD: Record<CsvWindow, Key> = { "3m": "expiring.download_3m", "6m": "expiring.download_6m", "12m": "expiring.download" };
const CSV_LINK: Record<CsvWindow, Key> = { "3m": "expiring.csv_link_3m", "6m": "expiring.csv_link_6m", "12m": "expiring.csv_link" };
export const EXPIRING_FEED = "feeds/canada/expiring.xml";

const WINDOW_LABEL: Record<ExpiringWindow, Key> = { "3m": "expiring.window_3m", "6m": "expiring.window_6m", "12m": "expiring.window_12m" };
const WINDOW_TITLE: Record<ExpiringWindow, Key> = {
  "3m": "expiring.window_title_3m", "6m": "expiring.window_title_6m", "12m": "expiring.window_title_12m",
};
export const WINDOW_MONTHS: Record<ExpiringWindow, Key> = { "3m": "expiring.months_3m", "6m": "expiring.months_6m", "12m": "expiring.months_12m" };
const KIND_LABEL: Record<ExpiringKind, Key> = { award: "expiring.kind_award", history: "expiring.kind_history", contract: "expiring.kind_contract" };
// The tag of a row whose published contract reports a set-aside under the
// Procurement Strategy for Indigenous Business or an Indigenous business
// outside one, in the TBS schema's own terms.
const INDIGENOUS_TAG: Record<IndigenousMark, Key> = { MS: "expiring.tag_psib_MS", VS: "expiring.tag_psib_VS", IB: "expiring.tag_ib" };
// The source each kind is read from, for the source filter's labels.
export const KIND_SOURCE: Record<ExpiringKind, string> = { award: "awards", history: "history", contract: "contracts" };

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
export const BAND_LABEL: Record<ValueBand, Key> = {
  "under-100k": "expiring.band_under_100k",
  "100k-1m": "expiring.band_100k_1m",
  "1m-10m": "expiring.band_1m_10m",
  "over-10m": "expiring.band_over_10m",
};

export const COMPETITIVE_FILTERS = ["yes", "no", "unstated"] as const;
export type CompetitiveFilter = (typeof COMPETITIVE_FILTERS)[number];
export const COMPETITIVE_LABEL: Record<CompetitiveFilter, Key> = { yes: "competitive.yes", no: "competitive.no", unstated: "competitive.unstated" };

export interface ExpiringQuery {
  buyer: string;
  segment: string;
  competitive: CompetitiveFilter | "";
  value: ValueBand | "";
  kind: ExpiringKind | "";
  // The organization (an id) and the client department (a buyer id).
  supplier: string;
  client: string;
  // A province's code, or "" for none; derived: whether a province derived
  // from another field (pipeline places.py) counts beside the stated ones,
  // on unless the address says derived=0, as on the tender list.
  province: string;
  derived: boolean;
  // Whether contracts ending on March 31 and standing offers and supply
  // arrangements stay in the list: on unless the address says fye=0 or sosa=0.
  fye: boolean;
  sosa: boolean;
  // The order (RADAR_ORDERS): "" the soonest end first, the window's own;
  // "end" the same, set from the table's head; "end-desc" the latest end
  // first; "value" the largest value first; "value-asc" the smallest.
  sort: RadarOrder;
}

// The orders a window offers: the value in the address, the column of the
// table's head that sets it, and the direction.
export const RADAR_ORDERS = [
  ["end", "end", "asc"], ["end-desc", "end", "desc"], ["value-asc", "value", "asc"], ["value", "value", "desc"],
] as const satisfies SortOrders;
export type RadarOrder = "" | (typeof RADAR_ORDERS)[number][0];

// What the records database orders a window's matches by.
export function radarSortOf(order: RadarOrder): { by: RadarSort; dir: SortDir } {
  const o = RADAR_ORDERS.find((x) => x[0] === order);
  return o ? { by: o[1], dir: o[2] } : { by: "end", dir: "asc" };
}

// A contract ending on March 31, the last day of the federal fiscal year.
export function fiscalYearEnd(r: Pick<ExpiringRow, "end">): boolean {
  return r.end.slice(5, 10) === "03-31";
}

// A standing offer or a supply arrangement (CanadaBuys' instrument types, and
// the published contracts' "Standing offer or supply arrangement"), not a
// contract made under one.
export function standingOffer(r: Pick<ExpiringRow, "instrument_en">): boolean {
  return /^(standing offer|supply arrangement)/i.test((r.instrument_en ?? "").trim());
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
  const supplier = get("supplier").toLowerCase();
  const client = get("client").toLowerCase();
  const province = get("province").toUpperCase();
  // The form sends 0 from a hidden field and 1 from a ticked box, so a 1 or
  // no value at all keeps the rows in.
  const kept = (k: string) => {
    const v = url.searchParams.getAll(k);
    return v.length === 0 || v.includes("1");
  };
  return {
    fye: kept("fye"),
    sosa: kept("sosa"),
    buyer: BUYER_ID_RE.test(buyer) && buyer.length <= 80 ? buyer : "",
    segment: SEGMENT_RE.test(segment) ? segment : "",
    competitive: (COMPETITIVE_FILTERS as readonly string[]).includes(competitive) ? (competitive as CompetitiveFilter) : "",
    value: (VALUE_BANDS as readonly string[]).includes(value) ? (value as ValueBand) : "",
    kind: (EXPIRING_KINDS as readonly string[]).includes(kind) ? (kind as ExpiringKind) : "",
    supplier: ORG_ID_RE.test(supplier) ? supplier : "",
    client: BUYER_ID_RE.test(client) && client.length <= 80 ? client : "",
    province: (PROVINCES as readonly string[]).includes(province) ? province : "",
    derived: kept("derived"),
    sort: RADAR_ORDERS.find((o) => o[0] === get("sort").toLowerCase())?.[0] ?? "",
  };
}

const FILTER_KEYS = ["buyer", "client", "supplier", "segment", "province", "competitive", "value", "kind"] as const;
// The toolbar's name for each filter, on its chip.
const FILTER_LABEL: Record<(typeof FILTER_KEYS)[number], Key> = {
  buyer: "tenders.filter_buyer", segment: "tenders.filter_segment", competitive: "col.method", value: "expiring.filter_value", kind: "col.source",
  supplier: "col.supplier", client: "col.client", province: "col.province",
};

// A window with nothing filtered: what a bare /expiring/<window> reads as.
const NO_FILTERS: ExpiringQuery = {
  buyer: "", segment: "", competitive: "", value: "", kind: "", supplier: "", client: "", province: "", derived: true, fye: true, sosa: true,
  sort: "",
};

export function isFiltered(q: ExpiringQuery): boolean {
  return FILTER_KEYS.some((k) => q[k] !== "") || !q.fye || !q.sosa;
}

// The URL of a view: only the values set, in a fixed order, then the page;
// derived=0 only beside a province, where it changes the list.
export function expiringQueryString(q: ExpiringQuery, pageNo = 1): string {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) if (q[k]) p.set(k, q[k]);
  if (q.province && !q.derived) p.set("derived", "0");
  if (!q.fye) p.set("fye", "0");
  if (!q.sosa) p.set("sosa", "0");
  if (q.sort) p.set("sort", q.sort);
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

// The client department a row names (the export writes it; the row type
// leaves it out, as the tables never show it).
function clientOf(r: ExpiringRow): string | null {
  const v = (r as { client_buyer_id?: unknown }).client_buyer_id;
  return typeof v === "string" ? v : null;
}

function clientName(lang: Lang, r: ExpiringRow): string | null {
  const x = r as { client_buyer_name?: unknown; client_buyer_name_fr?: unknown };
  return pick(lang, typeof x.client_buyer_name === "string" ? x.client_buyer_name : null,
    typeof x.client_buyer_name_fr === "string" ? x.client_buyer_name_fr : null);
}

// The largest Canadian value first; a row with no value, or one in another
// currency, after them; the end date breaks ties.
export function largestFirst(rows: readonly ExpiringRow[]): ExpiringRow[] {
  const cad = (r: ExpiringRow) => (valueBand(r) === null ? null : r.value);
  return [...rows].sort((a, b) => {
    const x = cad(a);
    const y = cad(b);
    if (x !== y) return x === null ? 1 : y === null ? -1 : y - x;
    return a.end < b.end ? -1 : a.end > b.end ? 1 : 0;
  });
}

// A page's rows in a window's order, as the records database orders the
// whole window (src/records_tables.ts): the latest end first with the
// source's order breaking ties, or the smallest Canadian value first with
// the rows without one still last.
export function orderExpiring(rows: readonly ExpiringRow[], order: RadarOrder): ExpiringRow[] {
  if (order === "value") return largestFirst(rows);
  const soonest = soonestFirst(rows);
  if (order === "end-desc") {
    const day = (r: ExpiringRow) => r.end.slice(0, 10);
    return soonest.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => (day(a) !== day(b) ? (day(a) < day(b) ? 1 : -1) : i - j)).map(([r]) => r);
  }
  if (order === "value-asc") {
    const cad = (r: ExpiringRow) => (valueBand(r) === null ? null : r.value);
    return soonest.map((r, i) => [r, i] as const).sort(([a, i], [b, j]) => {
      const x = cad(a);
      const y = cad(b);
      return x === y ? i - j : x === null ? 1 : y === null ? -1 : x - y;
    }).map(([r]) => r);
  }
  return soonest;
}

// The provinces a row is filed under: the ones its source states, and the
// ones derived from another field unless the filter leaves those out (the
// same rows rec_expiring_prov holds for the records database's statements).
export function rowProvinces(r: Pick<ExpiringRow, "provinces" | "provinces_derived">, derived: boolean): string[] {
  return derived && r.provinces_derived ? [...r.provinces, ...r.provinces_derived] : r.provinces;
}

export function filterExpiring(rows: readonly ExpiringRow[], q: ExpiringQuery): ExpiringRow[] {
  return rows.filter((r) => {
    if (q.buyer && r.buyer_id !== q.buyer) return false;
    if (q.segment && !r.segments.includes(q.segment)) return false;
    if (q.province && !rowProvinces(r, q.derived).includes(q.province)) return false;
    if (q.competitive && competitiveOfRow(r) !== q.competitive) return false;
    if (q.value && valueBand(r) !== q.value) return false;
    if (q.kind && r.kind !== q.kind) return false;
    if (q.supplier && r.organization_id !== q.supplier) return false;
    if (q.client && clientOf(r) !== q.client) return false;
    if (!q.fye && fiscalYearEnd(r)) return false;
    if (!q.sosa && standingOffer(r)) return false;
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
  const n = whole === 0 && pct !== 0 ? (lang === "fr" ? "<\u00a01" : "<1") : fmtInt(Math.abs(whole), lang);
  return t(lang, "pct", { n: `${sign}${n}` });
}

// The reference a reader knows the row by: an award or history row's as
// published; a published contract's is "owner_org:reference" and the search
// takes the reference alone.
export function contractReference(r: Pick<ExpiringRow, "kind" | "reference" | "reference_published">): string {
  if (r.kind !== "contract") return r.reference_published ?? r.reference;
  const at = r.reference.indexOf(":");
  return at >= 0 ? r.reference.slice(at + 1) : r.reference;
}

// The government's own record of a row: the CanadaBuys notice for an award;
// the contract history dataset for a PSPC record, which has no page of its
// own on CanadaBuys; the contracts search for a published contract.
export function expiringRecordUrl(r: Pick<ExpiringRow, "kind" | "reference" | "reference_published">, lang: Lang): string {
  if (r.kind === "award") return awardNoticeUrl(r.reference_published ?? r.reference, lang);
  if (r.kind === "history") return datasetUrl("history", lang);
  return contractSearchUrl(contractReference(r));
}

const RECORD_LABEL: Record<ExpiringKind, Key> = {
  award: "expiring.record_award", history: "expiring.record_history", contract: "expiring.record_contract",
};

// The site's own page for the row: an award notice's, a PSPC record's, or a
// published contract's (pages/published.tsx), whose reference here is
// "owner_org:reference".
export function sitePath(r: Pick<ExpiringRow, "kind" | "reference">): string {
  if (r.kind === "award") return `/awards/${r.reference.toLowerCase()}`;
  if (r.kind === "history") return `/history/${r.reference.toLowerCase()}`;
  const at = r.reference.indexOf(":");
  return at > 0 ? contractPath(r.reference.slice(0, at), r.reference.slice(at + 1)) : contractSearchUrl(r.reference);
}

const Organization: FC<{ lang: Lang; r: ExpiringRow }> = ({ lang, r }) => {
  if (r.supplier_withheld) return <span class="muted">{t(lang, "expiring.withheld")}</span>;
  if (r.organization_id) return <a href={`/organizations/${r.organization_id}`}>{r.organization ?? r.organization_id}</a>;
  return <>{r.organization ?? t(lang, "common.not_stated")}</>;
};

// The widest table on the site. The record links (the title opens the
// site's own page, the Record column the government's record) and
// amendments and growth rest below 1600 px, and the line under the table
// says where they are. With the supplier shown, the competition flag shows
// under the value below 1280 px, and the buyer, the column a reader filters
// on, rests below 1440 px and shows under the supplier there. A profile
// drops the supplier: there the buyer rests below 1280 px and the flag
// keeps its column. A buyer page drops the buyer. No range is wider than its
// content column (src/columns.tsx).
const LATE_REST: Rest = "xl";

// phonePages: a long list, 50 rows at a time on a phone (pages: the window's
// server pages, which the phone pager steps through); phoneRows: a short
// list on a profile or a buyer page, its first rows on a phone. csv: the
// file the line under the table sends a reader to for the resting columns.
// sorts: a window read from the server one page at a time orders by its end
// date and its value there (the heads link the orders), and no other head
// sorts; a list shown whole sorts in the page by any column.
export const ExpiringTable: FC<{
  lang: Lang; rows: readonly ExpiringRow[]; organization?: boolean; buyer?: boolean; phonePages?: boolean; pages?: ServerPages; phoneRows?: number;
  // Which file the line under the table names, or "list" for the 12-month
  // list itself: on profiles and buyer pages the 12-month file is part of Pro
  // once accounts open, and the list shows a free reader the teaser instead.
  csv?: CsvWindow | "list";
  sorts?: { end: HeadSort; value: HeadSort };
  // The holder's record of the rows a signed-in reader's plan covers, as the
  // mark under each holder's name, by row key (radarLines).
  marks?: ReadonlyMap<string, string>;
}> = ({ lang, rows, organization = true, buyer = true, phonePages = false, pages, phoneRows, csv = "12m", sorts, marks }) => {
  const buyerRest: Rest = organization ? "lg" : "md";
  const compRest: Rest | undefined = organization ? "md" : undefined;
  return (
  <>
  <SegmentNote lang={lang} rows={rows} />
  <PhonePages lang={lang} on={phonePages} pages={pages} rows={phoneRows}>
    <Table sorting={sorts ? "server" : "client"} cols={[
      { kind: "date", label: t(lang, "expiring.col_ends"), sort: sorts?.end },
      { kind: "main", label: t(lang, "col.contract") },
      organization && { kind: "org", label: t(lang, "col.supplier") },
      buyer && { kind: "buyer", label: t(lang, "col.buyer"), rest: buyerRest },
      { kind: "value", label: t(lang, "col.value"), sort: sorts?.value },
      { kind: "comp", label: t(lang, "col.method"), rest: compRest },
      { kind: "amend", label: <span title={t(lang, "expiring.growth_def")}>{t(lang, "expiring.col_amendments")}</span>, rest: LATE_REST },
      { kind: "record", label: t(lang, "col.record"), rest: LATE_REST },
    ]}>
      <tbody>
        {rows.map((r) => {
          const title = pick(lang, r.title_en, r.title_fr) ?? contractReference(r);
          const path = sitePath(r);
          const instrument = instrumentText(lang, r.instrument_en, r.instrument_fr);
          const indigenous = indigenousMark(r);
          const mark = marks?.get(lineKey(r.kind, r.reference));
          return (
            <tr>
              <td data-label={t(lang, "expiring.col_ends")} class="mono">
                {r.end.slice(0, 10)}
                <br />
                <span class="muted small">
                  {r.days_left === 0
                    ? t(lang, "expiring.ends_today")
                    : tn(lang, "expiring.days_left_one", "expiring.days_left_many", r.days_left, { n: fmtInt(r.days_left, lang) })}
                </span>
              </td>
              <td data-label={t(lang, "col.contract")} class="lead-cell">
                {/* The title opens the site's own page of the row; the Record
                    column links the government's own record. */}
                <a href={path}>{title}</a>
                <br />
                <span class="mono id muted">{contractReference(r)}</span> <SegmentChips lang={lang} codes={r.segments} />
                {/* The source the row was kept from, then the instrument; a
                    standing offer or supply arrangement is tagged (a framework,
                    not one purchase), and so is an end on March 31, and an
                    Indigenous business set-aside or award its published contract reports. */}
                <br />
                <span class="muted small">{t(lang, KIND_LABEL[r.kind])}{instrument && !standingOffer(r) ? ` · ${instrument}` : ""}</span>
                {instrument && standingOffer(r) ? <> <span class="tag">{instrument}</span></> : null}
                {fiscalYearEnd(r) ? <> <span class="tag">{t(lang, "expiring.tag_fye")}</span></> : null}
                {indigenous ? <> <span class="tag" title={t(lang, "expiring.tag_indigenous_def")}>{t(lang, INDIGENOUS_TAG[indigenous])}</span></> : null}
              </td>
              {organization ? (
                <td data-label={t(lang, "col.supplier")}>
                  <Organization lang={lang} r={r} />
                  {mark ? <RadarMark text={mark} /> : null}
                  {buyer ? <RestParty lang={lang} label="col.buyer"><BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} /></RestParty> : null}
                </td>
              ) : null}
              {buyer ? <td data-label={t(lang, "col.buyer")} class={restClass(buyerRest)}><BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} /></td> : null}
              <td data-label={t(lang, "col.value")} class="mono num">
                {money(lang, r.value, r.currency)}
                {compRest ? <RestFlag lang={lang} value={r.competitive} /> : null}
              </td>
              <td data-label={t(lang, "col.method")} class={restClass(compRest)}><CompetitiveFlag lang={lang} value={r.competitive} /></td>
              {/* Sorted in the page by the number of amendments, which the words around it hide. */}
              <td data-label={t(lang, "expiring.col_amendments")} class={restClass(LATE_REST)} data-sort={String(r.n_amendments)}>
                {r.n_amendments === 0
                  ? t(lang, "expiring.amendments_none")
                  : tn(lang, "expiring.amendments_one", "expiring.amendments_many", r.n_amendments, { n: fmtInt(r.n_amendments, lang) })}
                {r.value_growth === null ? null : (
                  <><br /><span class="muted small">{t(lang, "expiring.growth", { pct: growthPct(lang, r.value_growth) })}</span></>
                )}
              </td>
              {/* The source the row was kept from is under its title, so this cell holds the links alone. */}
              <td data-label={t(lang, "col.record")} class={restClass(LATE_REST)}>
                <a href={expiringRecordUrl(r, lang)} rel={r.kind === "contract" ? "nofollow noopener" : "noopener"}>{t(lang, RECORD_LABEL[r.kind])}</a>
                {r.tender_reference ? (
                  <><br /><a href={`/tenders/${r.tender_reference.toLowerCase()}`}>{t(lang, "expiring.record_tender")}</a></>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  </PhonePages>
  {/* While the amendments and record columns rest (700 to 1599 px), a line
      says where they are; wider screens and phones show them. */}
  {rows.length ? (
    <p class="rest-note muted small">
      {tj(lang, "expiring.rest_note", {
        csv: csv === "list"
          ? <a href="/expiring/12m">{t(lang, "expiring.list_link_12m")}</a>
          : <a href={`/downloads/${CSV_FILE[csv]}`}>{t(lang, CSV_LINK[csv])}</a>,
      })}
    </p>
  ) : null}
  </>
  );
};

// The rule the radar lists by, for the foot of a list that shows rows.
export const ExpiringNote: FC<{ lang: Lang }> = ({ lang }) => (
  <span>{tj(lang, "expiring.value_note", { rules: <a href="/methodology#expiring">{t(lang, "expiring.rules_link")}</a> })}</span>
);

// The section on a buyer page or a profile: how many of its contracts end
// within 12 months, their value, the first rows, and where the rest are.
// more is said when the part holds fewer rows than it counts; link when given.
export const ExpiringSection: FC<{
  lang: Lang; part: ExpiringPart; heading: Key; organization?: boolean; buyer?: boolean; more?: unknown; link?: unknown; phoneRows?: number;
}> = ({ lang, part, heading, organization, buyer, more, link, phoneRows }) => {
  const rows = soonestFirst(part.rows);
  return (
    <Panel id="expiring" title={t(lang, heading)} count={fmtInt(part.n, lang)} tools={link}
      foot={part.n > 0 ? <ExpiringNote lang={lang} /> : undefined}>
      {part.n === 0 ? (
        <p class="muted">{t(lang, "expiring.part_none")}</p>
      ) : (
        <p>{tn(lang, "expiring.part_one", "expiring.part_many", part.n, { n: fmtInt(part.n, lang), total: money(lang, part.total) })}</p>
      )}
      {rows.length ? <ExpiringTable lang={lang} rows={rows} organization={organization} buyer={buyer} phoneRows={phoneRows} csv="list" /> : null}
      {rows.length < part.n ? (
        <p class="more-rows">{t(lang, "expiring.part_shown", { shown: fmtInt(rows.length, lang) })}{more ? <> {more as any}</> : null}</p>
      ) : null}
    </Panel>
  );
};

// The rest of a profile's rows are in the 12-month list. The link is the
// window's page, not the 12-month CSV: once the accounts switch is on, a free
// reader lands on its free view and what Pro adds rather than a 404, and a
// Pro reader on the full window. pro: the accounts switch is on, so the link
// carries the chip.
export const MoreInWindow: FC<{ lang: Lang; part: ExpiringPart; pro?: boolean }> = ({ lang, part, pro = false }) => {
  const more = part.n - part.rows.length;
  if (more <= 0) return null;
  return (
    <>
      {tj(lang, more === 1 ? "expiring.part_more_one" : "expiring.part_more_many", {
        more: fmtInt(more, lang),
        list: <a href="/expiring/12m">{t(lang, "expiring.list_link_12m")}{pro ? <ProTag lang={lang} /> : null}</a>,
      })}
    </>
  );
};

// -- the holder's record on a window's page ---------------------------------------------

// What a window's list shows of its rows' holders' records (src/lines.ts):
// nothing while the accounts switch is off; one line for a reader not signed
// in; for a signed-in reader, the records of the rows ending within the
// plan's days (lineDays) whose holder is named, read from rec_lines in one
// statement, as a mark each. A records database without rec_lines yet leaves
// the list as it was; one that cannot answer says so in a line.
export async function radarLines(c: Context<AppEnv>, lang: Lang, rows: readonly ExpiringRow[]): Promise<RadarLines> {
  if (!accountsEnabled(c.env)) return { state: "off" };
  const account = await railAccount(c).catch(() => undefined);
  if (!account?.email) return { state: "signed_out" };
  const days = lineDays(account.plan ?? "free");
  const keys = rows.filter((r) => r.days_left >= 0 && r.days_left <= days && r.organization_id && !r.supplier_withheld)
    .map((r) => lineKey(r.kind, r.reference));
  if (!keys.length) return { state: "ready", marks: new Map(), pending: false };
  const read = await readLines(c.env, keys);
  if (read.state === "failed" && read.noTable) return { state: "absent" };
  if (read.state !== "ready") return { state: "unavailable" };
  const found = read.rows[0] ?? [];
  const marks = new Map<string, string>();
  for (const row of found) {
    const j = parseLine(row.j);
    const text = j ? markText(lang, j) : null;
    if (text && typeof row.sk === "string") marks.set(row.sk, text);
  }
  return { state: "ready", marks, pending: found.length === 0 };
}

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

// The windows as tabs, the current one underlined. pro: the accounts switch
// is on, so the deep windows' tabs carry the chip, whatever the reader's plan.
const WindowLinks: FC<{ lang: Lang; current: ExpiringWindow; q: ExpiringQuery; pro: boolean }> = ({ lang, current, q, pro }) => (
  <nav aria-label={t(lang, "expiring.windows_nav")} class="tabs toolbar-row">
    {EXPIRING_WINDOWS.map((w) => (
      <a href={`/expiring/${w}${expiringQueryString(q)}`} aria-current={w === current ? "page" : undefined}>
        {t(lang, WINDOW_LABEL[w])}{pro && DEEP_WINDOWS.includes(w) ? <ProTag lang={lang} /> : null}
      </a>
    ))}
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
  const [first, feeds, interest] = await Promise.all([
    three && three.n > 0 ? loadExpiringPage(c.env, "3m", 1) : Promise.resolve([] as ExpiringRow[]),
    expiringFeeds(c),
    interestFilter(c.env, lang, "expiring", "/expiring"),
  ]);
  // Save this search, for a signed-in reader (account/search_control.tsx): the 3-month list the overview opens on.
  const save = await saveControl(c, interest, "/expiring");
  const shown = first ? soonestFirst(first).slice(0, EXPIRING_FIRST) : [];
  const n = (v: number) => fmtInt(v, lang);
  const byBuyerName = (b: (typeof idx.by_buyer)[number]) => pick(lang, b.buyer_en, b.buyer_fr) ?? b.buyer_id ?? t(lang, "common.not_stated");
  const pro = accountsEnabled(c.env);
  // The head opens on the 12-month figure and its value, when the index has them.
  const leadDate = /^\d{4}-\d{2}-\d{2}/.test(idx.as_of) ? idx.as_of.slice(0, 10) : todayOf(stats.data_as_of);
  const twelve = windows.find((w) => w.window === "12m");
  const lead = !twelve ? t(lang, "expiring.lead_plain", { date: leadDate })
    : twelve.total === null ? t(lang, "expiring.lead_no_total", { n: n(twelve.n), date: leadDate })
    : tj(lang, "expiring.lead", { n: n(twelve.n), total: <ShortMoney lang={lang} value={twelve.total} />, date: leadDate });

  return page(
    c,
    <Layout lang={lang} title={t(lang, "expiring.title")} dataAsOf={stats.data_as_of} active="/expiring" seo={pageSeo("expiring", lang)}
      head={feeds.national ? <FeedLink lang={lang} /> : null}>
      <PageHead lang={lang} title={t(lang, "expiring.title")}
        lead={lead}
        actions={<>
          <a href={`/downloads/${EXPIRING_CSV_3M}`} class="btn">{t(lang, "expiring.download_3m")}</a>
          {feeds.national ? <a href={`/data/${EXPIRING_FEED}`} class="btn">{t(lang, "expiring.feed")}</a> : null}
        </>}>
        <SaveSearchLine lang={lang} state={save} />
      </PageHead>

      {windows.length ? (
        <section class="tiles" aria-label={t(lang, "expiring.tiles_label")}>
          {windows.map((w) => (
            <a class="tile" href={`/expiring/${w.window}`}>
              <span class="tile-label">
                {t(lang, WINDOW_LABEL[w.window])}{pro && DEEP_WINDOWS.includes(w.window) ? <ProTag lang={lang} /> : null}
              </span>
              <span class="tile-value">{n(w.n)}</span>
              <span class="tile-note">
                {tj(lang, "expiring.tile_total", { total: w.total === null ? t(lang, "common.not_stated") : <ShortMoney lang={lang} value={w.total} /> })}
              </span>
            </a>
          ))}
        </section>
      ) : null}

      <Panel title={t(lang, "expiring.first_heading")} tools={<a href="/expiring/3m">{t(lang, "expiring.first_all")}</a>}
        foot={shown.length ? <ExpiringNote lang={lang} /> : undefined}>
        {first === null ? (
          <p class="muted">{t(lang, "expiring.list_missing")}</p>
        ) : shown.length ? (
          <>
            <p class="muted small">{t(lang, "expiring.first_note_3m", { n: n(shown.length) })}</p>
            <ExpiringTable lang={lang} rows={shown} csv="3m" />
          </>
        ) : (
          <p class="muted">{t(lang, "expiring.none_window")}</p>
        )}
      </Panel>

      <InterestPanel lang={lang} filter={interest} />

      <div class="panel-grid">
      <Panel id="buyers" title={t(lang, "expiring.by_buyer")}
        tools={feeds.any ? <a href="/feeds#expiring">{t(lang, "expiring.feeds_all")}</a> : undefined}>
      {idx.by_buyer.length ? (
        <div class="table-wrap bordered">
          <Table restack={false} class="compact" cols={[
            { kind: "main", label: t(lang, "col.buyer") },
            { kind: "count", label: t(lang, "expiring.col_contracts") },
            { kind: "total", label: t(lang, "col.value") },
          ]}>
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
          </Table>
        </div>
      ) : <p class="muted">{t(lang, "expiring.none_window")}</p>}
      </Panel>

      <Panel id="segments" title={t(lang, "expiring.by_segment")}>
      <p class="muted small">{t(lang, "expiring.by_segment_note")}</p>
      {idx.by_segment.length ? (
        <div class="table-wrap bordered">
          <Table restack={false} class="compact" cols={[
            { kind: "main", label: t(lang, "col.segment") },
            { kind: "count", label: t(lang, "expiring.col_contracts") },
            { kind: "total", label: t(lang, "col.value") },
          ]}>
            <tbody>
              {idx.by_segment.map((g) => (
                <tr>
                  <td data-label={t(lang, "col.segment")}>
                    {g.code in SEGMENTS ? <a href={`/segments/${g.code}`}>{`${g.code} ${segmentLabel(lang, g.code)}`}</a> : g.code}
                  </td>
                  <td data-label={t(lang, "expiring.col_contracts")} class="mono num">
                    <a href={`/expiring/12m?segment=${g.code}`}>{n(g.n)}</a>
                  </td>
                  <td data-label={t(lang, "col.value")} class="mono num">{money(lang, g.total)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : <p class="muted">{t(lang, "expiring.none_window")}</p>}
      </Panel>
      </div>
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

type Option = { value: string; label: string; n: number | null };

// Each select lists the values the loaded page carries, with how many of its
// rows carry each, plus the value the link asks for when the page has none.
function options(rows: readonly ExpiringRow[], q: ExpiringQuery, lang: Lang) {
  const tally = (pairs: [string, string][], current: string, fallback: (v: string) => string): Option[] => {
    const seen = new Map<string, Option>();
    for (const [value, label] of pairs) {
      const o = seen.get(value);
      if (o) o.n = (o.n ?? 0) + 1;
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
    // Every province in PROVINCES order, a row counted in each it is filed under.
    province: PROVINCES.map((p): Option => ({
      value: p, label: provinceName(lang, p), n: rows.filter((r) => rowProvinces(r, q.derived).includes(p)).length,
    })),
    competitive: fixed(COMPETITIVE_FILTERS, (v) => t(lang, COMPETITIVE_LABEL[v]), competitiveOfRow),
    value: fixed(VALUE_BANDS, (v) => t(lang, BAND_LABEL[v]), valueBand),
    kind: fixed(EXPIRING_KINDS, (v) => sourceLabel(lang, KIND_SOURCE[v]), (r) => r.kind),
    supplier: tally(
      rows.filter((r) => r.organization_id).map((r): [string, string] => [r.organization_id!, r.organization ?? r.organization_id!]),
      q.supplier, (v) => v,
    ).sort(byLabel),
    client: tally(
      rows.filter((r) => clientOf(r)).map((r): [string, string] => [clientOf(r)!, clientName(lang, r) ?? clientOf(r)!]),
      q.client, (v) => v,
    ).sort(byLabel),
    fye: rows.filter(fiscalYearEnd).length,
    sosa: rows.filter(standingOffer).length,
  };
}

// -- the whole window, from the records database ------------------------------------

const KIND_NUMBER: Record<ExpiringKind, number> = { award: 1, history: 2, contract: 3 };
const COMP_NUMBER: Record<CompetitiveFilter, number> = { yes: 1, no: 0, unstated: 2 };
// The bands in cents; the open ends as far as a JavaScript number reaches exactly.
const BAND_CENTS: Record<ValueBand, [number, number]> = {
  "under-100k": [-Number.MAX_SAFE_INTEGER, 10_000_000],
  "100k-1m": [10_000_000, 100_000_000],
  "1m-10m": [100_000_000, 1_000_000_000],
  "over-10m": [1_000_000_000, Number.MAX_SAFE_INTEGER],
};

export function radarParams(window: ExpiringWindow, today: string, q: ExpiringQuery): RadarParams {
  return {
    first: today, last: addDays(today, WINDOW_DAYS[window]), buyer: q.buyer, client: q.client,
    oid: q.supplier ? orgNumber(q.supplier) ?? -1 : -1, segment: q.segment,
    comp: q.competitive ? COMP_NUMBER[q.competitive] : -1, band: q.value ? BAND_CENTS[q.value] : null,
    kind: q.kind ? KIND_NUMBER[q.kind] : 0, fye: q.fye, sosa: q.sosa, prov: q.province, derived: q.derived,
  };
}

// A row as rec_expiring holds it (the window file's row without days_left),
// with days_left counted from the data date again; null for one that does
// not read as a radar row.
export function radarRow(r: Row, today: string): ExpiringRow | null {
  if (typeof r.j !== "string") return null;
  let row: unknown;
  try {
    row = JSON.parse(r.j);
  } catch {
    return null;
  }
  if (typeof row !== "object" || row === null || typeof r.endd !== "string") return null;
  const days = Math.round((Date.parse(`${r.endd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const out = { ...(row as object), days_left: days };
  return isExpiringRow(out) ? out : null;
}

// noProvinces: the view named a province and the records database does not
// hold the province table yet, so the matches are the window's without it.
type Whole = { rows: ExpiringRow[]; n: number; total: number | null; noValue: number; opts: ReturnType<typeof options>; noProvinces: boolean };

// The form's choices from the whole window: the buyers, clients and
// organizations the window names, and the window's counts by flag, source,
// band and mark; the segments are the ones the page's rows carry, and the
// provinces every one, without a count (counting them would read the
// province table for every view, filtered or not).
function wholeOptions(read: Extract<Read, { state: "ready" }>, page: ReturnType<typeof options>, q: ExpiringQuery, lang: Lang) {
  const [facetRows, buyerRows, clientRows, supplierRows] = read.rows.slice(2, 6);
  const f = facetRows?.[0] ?? {};
  const count = (k: string) => num(f[k]) ?? 0;
  const named = (rows: Row[] | undefined, current: string): Option[] => {
    const out: Option[] = (rows ?? []).map((r) => ({
      value: String(r.id), label: pick(lang, typeof r.name_en === "string" ? r.name_en : null, typeof r.name_fr === "string" ? r.name_fr : null) ?? String(r.id),
      n: num(r.n),
    }));
    if (current && !out.some((o) => o.value === current)) out.push({ value: current, label: current, n: null });
    return out.sort((a, b) => a.label.localeCompare(b.label, numberLocale(lang)));
  };
  const suppliers: Option[] = (supplierRows ?? []).map((r) => {
    const id = orgIdOf(num(r.oid) ?? 0);
    return { value: id, label: typeof r.name === "string" ? r.name : id, n: num(r.n) };
  });
  if (q.supplier && !suppliers.some((o) => o.value === q.supplier)) suppliers.push({ value: q.supplier, label: q.supplier, n: null });
  suppliers.sort((a, b) => a.label.localeCompare(b.label, numberLocale(lang)));
  return {
    buyer: named(buyerRows, q.buyer),
    client: named(clientRows, q.client),
    supplier: suppliers,
    segment: page.segment.map((o) => ({ ...o, n: null })),
    province: page.province.map((o) => ({ ...o, n: null })),
    competitive: COMPETITIVE_FILTERS.map((v) => ({ value: v, label: t(lang, COMPETITIVE_LABEL[v]), n: count(`c${COMP_NUMBER[v]}`) })),
    value: VALUE_BANDS.map((v, i) => ({ value: v, label: t(lang, BAND_LABEL[v]), n: count(`b${i + 1}`) })),
    kind: EXPIRING_KINDS.map((v) => ({ value: v, label: sourceLabel(lang, KIND_SOURCE[v]), n: count(`k${KIND_NUMBER[v]}`) })),
    fye: count("m31"),
    sosa: count("so"),
  };
}

// A page of the matches over the whole window, or null when the records
// database cannot answer (the page then filters its own rows, as before).
async function wholeWindow(c: Context<AppEnv>, window: ExpiringWindow, today: string, q: ExpiringQuery, pageNo: number,
  page: ReturnType<typeof options>, lang: Lang): Promise<Whole | null> {
  const order = radarSortOf(q.sort);
  const read = await readRadar(c.env, radarParams(window, today, q), order.by, (pageNo - 1) * RADAR_PAGE_ROWS, order.dir);
  if (read.state !== "ready") return null;
  const total = read.rows[1]?.[0] ?? {};
  return {
    rows: (read.rows[0] ?? []).map((r) => radarRow(r, today)).filter((r): r is ExpiringRow => r !== null),
    n: num(total.n) ?? 0, total: dollars(total.cents), noValue: num(total.n_no_value) ?? 0,
    opts: wholeOptions(read, page, q, lang), noProvinces: !!read.noProvinces,
  };
}

// The matches as a file (/expiring/<window>/rows.csv with the window's
// query): part of Pro (export_filtered, and radar_depth for a deep window)
// once the accounts switch is on; the site's 404 otherwise, and while the
// switch is off, as for the analytics files. Sent private, never kept.
export const RADAR_CSV_COLUMNS = [
  "kind", "reference", "title_en", "title_fr", "organization_id", "organization", "buyer_id", "buyer_en", "buyer_fr", "client_buyer_id",
  "client_buyer_name", "start", "end", "days_left", "value", "currency", "competitive", "method_en", "instrument_en", "n_amendments",
  "value_growth", "segments", "provinces", "provinces_derived", "provinces_from", "value_flag",
] as const;

export async function filteredCsvAllowed(c: Context<AppEnv>, window: ExpiringWindow): Promise<boolean> {
  if (!accountsEnabled(c.env)) return false;
  return allowed({ plan: await requestPlan(c) }, "export_filtered") && !(await radarWindowLocked(c, window));
}

export async function expiringRowsCsv(c: Context<AppEnv>): Promise<Response> {
  const window = c.req.param("window") ?? "";
  if (!isExpiringWindow(window) || !(await filteredCsvAllowed(c, window))) return c.notFound();
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "expiring.title");
  const today = todayOf(stats.data_as_of);
  const q = readExpiringQuery(new URL(c.req.url));
  const order = radarSortOf(q.sort);
  const read = await readRadarCsv(c.env, radarParams(window, today, q), order.by, order.dir);
  if (read.state !== "ready") {
    c.header("Retry-After", "3600");
    c.header("Cache-Control", "no-store");
    return c.text(t(lang, read.state === "loading" ? "analytics.unavailable_loading" : "analytics.unavailable_text"), 503);
  }
  const rows = (read.rows[0] ?? []).map((r) => radarRow(r, today)).filter((r): r is ExpiringRow => r !== null);
  const cell = (r: ExpiringRow, k: (typeof RADAR_CSV_COLUMNS)[number]): unknown => {
    const v = (r as unknown as Record<string, unknown>)[k];
    if (k === "reference") return contractReference(r);
    if (Array.isArray(v)) return v.join(" ");
    if (k === "competitive") return v === true || v === 1 ? 1 : v === false || v === 0 ? 0 : null;
    return v;
  };
  const body = [RADAR_CSV_COLUMNS.join(","), ...rows.map((r) => RADAR_CSV_COLUMNS.map((k) => csvCell(cell(r, k))).join(","))].join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expiring-${window}-filtered-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// any is the "All" that agrees with the filter's noun in French.
const Select: FC<{ name: string; label: Key; any?: Key; opts: Option[]; value: string; lang: Lang }> = ({ name, label, any = "tenders.any", opts, value, lang }) => (
  <label class="field">
    <span class="field-label">{t(lang, label)}</span>
    <select name={name}>
      <option value="">{t(lang, any)}</option>
      {opts.map((o) => (
        <option value={o.value} selected={o.value === value}>{o.n === null ? o.label : `${o.label} (${fmtInt(o.n, lang)})`}</option>
      ))}
    </select>
  </label>
);

// The head of a window's page, the same on the full list and on the free
// view: how many contracts the window holds, their value, and a CSV (the
// 3-month file on the free view, else the window's own).
const WindowHead: FC<{
  lang: Lang; crumbs: { name: string; path?: string }[]; title: string; idx: ExpiringWindowIndex; months: string; date: string; csv: CsvWindow;
}> = ({ lang, crumbs, title, idx, months, date, csv }) => (
  <PageHead lang={lang} crumbs={crumbs} title={title}
    lead={<>
      {tn(lang, "expiring.window_count_one", "expiring.window_count_many", idx.rows, { n: fmtInt(idx.rows, lang), months, date })}{" "}
      {t(lang, "expiring.window_total", { total: money(lang, idx.total) })}
    </>}
    actions={<a href={`/downloads/${CSV_FILE[csv]}`} class="btn">{t(lang, CSV_DOWNLOAD[csv])}</a>} />
);

// What Pro adds on a window's free view, in figures: all the window's
// contracts, and how many of them, worth how much, end beyond the free
// 3-month list. Without the 3-month figures it names the count alone.
function proTeaserText(lang: Lang, window: ExpiringWindow, idx: ExpiringWindowIndex, three: ExpiringWindowIndex | null): unknown {
  const all = fmtInt(idx.rows, lang);
  const beyond = three ? idx.rows - three.rows : 0;
  // The window's months, which also name its own CSV file.
  const months = fmtInt(Number(window.slice(0, -1)), lang);
  if (!three || beyond <= 0) return t(lang, "expiring.pro_text_all", { all, months });
  const vars = { all, beyond: fmtInt(beyond, lang), months };
  return idx.total !== null && three.total !== null
    ? tj(lang, "expiring.pro_text", { ...vars, total_beyond: <ShortMoney lang={lang} value={idx.total - three.total} /> })
    : t(lang, "expiring.pro_text_no_total", vars);
}

// The free view of a 6- or 12-month window, once the accounts switch is on,
// for a request whose plan lacks radar_depth (src/plan.ts): the head the full
// list has, the window tabs, the first rows by end date, and what Pro adds.
// It reads the window's index and its first page only. Filters and a page
// number in the address are set aside (the note says so), and such an
// address is not indexed. Without a session the page may be kept by public
// caches; Vary: Cookie stops a browser from showing a kept copy after the
// reader signs in. A signed-in reader's page is private (page()).
async function expiringTeaser(c: Context<AppEnv>, window: ExpiringWindow, stats: Stats): Promise<Response> {
  const lang = c.get("lang");
  const [idx, three] = await Promise.all([loadExpiringWindow(c.env, window), loadExpiringWindow(c.env, "3m").catch(() => null)]);
  if (!idx) return noDataPage(c, "expiring.title");
  const rows = idx.pages === 0 ? [] : await loadExpiringPage(c.env, window, 1);
  if (!rows) return noDataPage(c, "expiring.title");
  const shown = soonestFirst(rows).slice(0, EXPIRING_TEASER_ROWS);
  const path = `/expiring/${window}`;
  const asked = isFiltered(readExpiringQuery(new URL(c.req.url))) || c.req.query("page") !== undefined;
  const date = todayOf(stats.data_as_of);
  const months = t(lang, WINDOW_MONTHS[window]);
  const title = t(lang, WINDOW_TITLE[window]);
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "expiring.title"), path: "/expiring" }, { name: title }];
  const account = await railAccount(c).catch(() => undefined);
  varyOnCookie(c); // once per request; page() adds the same for every page while the switch is on
  const lines: RadarLines = shown.length ? await radarLines(c, lang, shown) : { state: "off" };

  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/expiring"
      seo={expiringWindowSeo(path, title, lang, crumbs, { n: idx.rows, months, date, noindex: asked })}>
      <WindowHead lang={lang} crumbs={crumbs} title={title} idx={idx} months={months} date={date} csv="3m" />
      <div class="toolbar">
        <WindowLinks lang={lang} current={window} q={NO_FILTERS} pro />
      </div>
      <Panel title={t(lang, WINDOW_LABEL[window])} count={fmtInt(idx.rows, lang)} foot={shown.length ? <ExpiringNote lang={lang} /> : undefined}>
        {asked ? <p class="muted small">{t(lang, "expiring.pro_asked")}</p> : null}
        {shown.length ? (
          <>
            <p class="muted small">{t(lang, "expiring.first_note", { n: fmtInt(shown.length, lang) })}</p>
            <ExpiringTable lang={lang} rows={shown} csv="3m" marks={lines.state === "ready" ? lines.marks : undefined} />
            <RadarLineNotes lang={lang} lines={lines} />
          </>
        ) : (
          <p class="muted">{t(lang, "expiring.none_window")}</p>
        )}
      </Panel>
      <ProPanel lang={lang} signedIn={!!account?.email} price={checkoutPrice(c.env)} ultra={await ultraCheckoutPrice(c.env)}
        text={proTeaserText(lang, window, idx, three)}
        free={tj(lang, "expiring.pro_free", { list: <a href="/expiring/3m">{t(lang, "expiring.pro_free_list")}</a> })} />
    </Layout>,
  );
}

export async function expiringWindowPage(c: Context<AppEnv>, raw: string): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  // A window that is not one is a 404 whether or not the data is published.
  if (!isExpiringWindow(raw)) return notFoundPage(c, stats?.data_as_of ?? null, "expiring.window_not_found", "/expiring", "expiring.back");
  if (!stats) return noDataPage(c, "expiring.title");
  const window = raw;
  if (await radarWindowLocked(c, window)) return expiringTeaser(c, window, stats);
  const idx = await loadExpiringWindow(c.env, window);
  if (!idx) return noDataPage(c, "expiring.title");
  const path = `/expiring/${window}`;
  const n = pageOf(c);
  const url = new URL(c.req.url);
  const q = readExpiringQuery(url);
  const filtered = isFiltered(q);
  const date = todayOf(stats.data_as_of);
  if (n === null) return notFoundPage(c, stats.data_as_of, "expiring.page_not_found", path, "expiring.back_window");
  // A filtered or sorted view reads the whole window from the records
  // database; its page numbers count the matches, RADAR_PAGE_ROWS at a time.
  // Without the database it filters the window file's page, as before. The
  // form's choices come from the window file's first page either way.
  const viewOnly = filtered || q.sort !== "";
  const first = idx.pages === 0 ? [] : await loadExpiringPage(c.env, window, viewOnly ? 1 : Math.min(n, Math.max(1, idx.pages)));
  if (!first) return noDataPage(c, "expiring.title");
  const pageOpts = options(soonestFirst(first), q, lang);
  const whole = viewOnly ? await wholeWindow(c, window, date, q, n, pageOpts, lang) : null;
  const wholePages = whole ? Math.max(1, Math.ceil(whole.n / RADAR_PAGE_ROWS)) : 0;
  if (whole ? n > wholePages : n > 1 && n > idx.pages) {
    return notFoundPage(c, stats.data_as_of, "expiring.page_not_found", path, "expiring.back_window");
  }
  // Unfiltered, first is already page n; filtered without the database, the
  // page asked for is filtered, as before.
  const rows = !viewOnly || whole || n === 1 ? first : await loadExpiringPage(c.env, window, n);
  if (!rows) return noDataPage(c, "expiring.title");
  const interest = await interestFilter(c.env, lang, "expiring", `${path}${url.search}`);
  // Save this search, for a signed-in reader (account/search_control.tsx): the window's filter as the address sets it.
  const save = await saveControl(c, interest, `${path}${url.search}`);
  const sorted = soonestFirst(rows);
  const local = filtered ? filterExpiring(sorted, q) : sorted;
  const shown = whole ? whole.rows : orderExpiring(local, q.sort);
  const pages = whole ? wholePages : Math.max(1, idx.pages);
  const csvAllowed = whole ? await filteredCsvAllowed(c, window) : false;
  // The holder's record of the rows shown (radarLines): a mark under each holder's name for a signed-in reader.
  const lines: RadarLines = shown.length ? await radarLines(c, lang, shown) : { state: "off" };
  const account = whole && accountsEnabled(c.env) && !csvAllowed ? await railAccount(c).catch(() => undefined) : undefined;
  const months = t(lang, WINDOW_MONTHS[window]);
  const title = t(lang, WINDOW_TITLE[window]);
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "expiring.title"), path: "/expiring" }, { name: title }];
  // A province the records database cannot filter by yet (its nightly has
  // not made rec_expiring_prov) is set aside: the matches are the window's
  // without it, and the form, the chips and the links say the same.
  const view: ExpiringQuery = whole?.noProvinces ? { ...q, province: "" } : q;
  const prevPath = n > 1 ? `${path}${expiringQueryString(view, n - 1)}` : null;
  const nextPath = n < pages ? `${path}${expiringQueryString(view, n + 1)}` : null;
  // A filtered, sorted or later view is a view of the window's first page.
  const noindex = viewOnly || c.req.query("page") !== undefined;
  const opts = whole ? whole.opts : viewOnly ? options(sorted, q, lang) : pageOpts;
  const active = FILTER_KEYS.filter((k) => view[k]).length + (view.fye ? 0 : 1) + (view.sosa ? 0 : 1);
  // Unfiltered, the phone pager counts the window's contracts and steps
  // through its server pages; over the whole window, the matches; filtered
  // within a page, the page's matches.
  const serverPages: ServerPages | undefined = whole
    ? { offset: (n - 1) * RADAR_PAGE_ROWS, total: whole.n, prev: prevPath, next: nextPath, replaces: "radar-pager" }
    : viewOnly ? undefined : {
      offset: (n - 1) * EXPIRING_PAGE_ROWS, total: idx.rows, prev: prevPath, next: nextPath, replaces: "radar-pager",
    };
  const csvPath = `${path}/rows.csv${expiringQueryString(view)}`;
  // Each list links its own window's file: the 3-month list the free 3-month file.
  const csv: CsvWindow = window;
  // The heads the window orders by, each a link to the same view in its next order, from the first page.
  const sortHref = (v: string) => `${path}${expiringQueryString({ ...view, sort: v as RadarOrder })}`;
  const sorts = { end: headSort(RADAR_ORDERS, q.sort, "end", sortHref), value: headSort(RADAR_ORDERS, q.sort, "value", sortHref) };

  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/expiring"
      seo={expiringWindowSeo(path, title, lang, crumbs, { n: idx.rows, months, date, noindex })}
      head={viewOnly ? null : <>
        {prevPath ? <link rel="prev" href={canonicalUrl(prevPath, lang)} /> : null}
        {nextPath ? <link rel="next" href={canonicalUrl(nextPath, lang)} /> : null}
      </>}>
      <WindowHead lang={lang} crumbs={crumbs} title={title} idx={idx} months={months} date={date} csv={csv} />
      <form method="get" action={path} class="toolbar">
        <WindowLinks lang={lang} current={window} q={view} pro={accountsEnabled(c.env)} />
        <FiltersFold lang={lang} active={active}>
        <div class="toolbar-fields">
          <Select name="buyer" label="tenders.filter_buyer" opts={opts.buyer} value={q.buyer} lang={lang} />
          <Select name="client" label="col.client" opts={opts.client} value={q.client} lang={lang} />
          <Select name="supplier" label="col.supplier" opts={opts.supplier} value={q.supplier} lang={lang} />
          <Select name="segment" label="tenders.filter_segment" opts={opts.segment} value={q.segment} lang={lang} />
          {/* The province, as the tender list offers it, with its derived-provinces box; gone while
              the records database cannot filter by it. */}
          {whole?.noProvinces ? null : (
            <>
              <Select name="province" label="col.province" any="tenders.any_f" opts={opts.province} value={view.province} lang={lang} />
              <div class="field field-check">
                <span class="field-label" aria-hidden="true">&nbsp;</span>
                <label class="check">
                  <input type="hidden" name="derived" value="0" />
                  <input type="checkbox" name="derived" value="1" checked={q.derived} />
                  <span>{t(lang, "tenders.include_derived")}</span>
                </label>
              </div>
            </>
          )}
          <Select name="competitive" label="col.method" any="tenders.any_f" opts={opts.competitive} value={q.competitive} lang={lang} />
          <Select name="value" label="expiring.filter_value" any="tenders.any_f" opts={opts.value} value={q.value} lang={lang} />
          <Select name="kind" label="col.source" any="tenders.any_f" opts={opts.kind} value={q.kind} lang={lang} />
          <label class="field">
            <span class="field-label">{t(lang, "tenders.sort")}</span>
            {/* "end", set from the head, is the window's own order and reads as it here. */}
            <select name="sort">
              <option value="">{t(lang, "expiring.sort_end")}</option>
              <option value="end-desc" selected={q.sort === "end-desc"}>{t(lang, "expiring.sort_end_desc")}</option>
              <option value="value" selected={q.sort === "value"}>{t(lang, "expiring.sort_value")}</option>
              <option value="value-asc" selected={q.sort === "value-asc"}>{t(lang, "expiring.sort_value_asc")}</option>
            </select>
          </label>
          <div class="toolbar-actions">
            <button type="submit" class="btn btn-primary">{t(lang, "tenders.apply")}</button>
            <a href={path} class="btn">{t(lang, "tenders.reset")}</a>
          </div>
        </div>
        {/* Two kinds of rows, in by default; the counts are the window's over the
            records database, else the loaded page's, as the selects' are. */}
        <div class="toolbar-row" role="group" aria-labelledby="radar-include">
          <span class="toolbar-label" id="radar-include">{t(lang, "expiring.filter_include")}</span>
          <label class="check">
            <input type="hidden" name="fye" value="0" />
            <input type="checkbox" name="fye" value="1" checked={q.fye} />
            <span>{t(lang, "expiring.filter_fye", { n: fmtInt(opts.fye, lang) })}</span>
          </label>
          <label class="check">
            <input type="hidden" name="sosa" value="0" />
            <input type="checkbox" name="sosa" value="1" checked={q.sosa} />
            <span>{t(lang, "expiring.filter_sosa", { n: fmtInt(opts.sosa, lang) })}</span>
          </label>
        </div>
        <p class="toolbar-note">{t(lang, "expiring.band_note")}</p>
        </FiltersFold>
        {isFiltered(view) ? (
          <div class="toolbar-chips">
            <span class="chips-label">{t(lang, "tenders.filters_active")}</span>
            {FILTER_KEYS.filter((k) => view[k]).map((k) => {
              const value = (opts[k] as Option[]).find((o) => o.value === view[k])?.label ?? view[k];
              return (
                <a class="fchip" href={`${path}${expiringQueryString({ ...view, [k]: "" })}`} aria-label={t(lang, "tenders.remove_filter", { name: value })}>
                  <span>{t(lang, FILTER_LABEL[k])}</span> <b>{value}</b>
                  <span class="fchip-x" aria-hidden="true">×</span>
                </a>
              );
            })}
            {([["fye", "expiring.chip_fye"], ["sosa", "expiring.chip_sosa"]] as const).filter(([k]) => !view[k]).map(([k, label]) => (
              <a class="fchip" href={`${path}${expiringQueryString({ ...view, [k]: true })}`}
                aria-label={t(lang, "tenders.remove_filter", { name: t(lang, label) })}>
                <span>{t(lang, label)}</span> <b>{t(lang, "expiring.chip_left_out")}</b>
                <span class="fchip-x" aria-hidden="true">×</span>
              </a>
            ))}
          </div>
        ) : null}
        <SaveSearchRow lang={lang} state={save} />
      </form>
      <SaveSearchForm lang={lang} state={save} />
      <Panel title={t(lang, WINDOW_LABEL[window])}
        count={whole ? tn(lang, "expiring.whole_match_one", "expiring.whole_match_many", whole.n, { n: fmtInt(whole.n, lang) })
          : filtered ? tn(lang, "expiring.match_one", "expiring.match_many", shown.length, { n: fmtInt(shown.length, lang) }) : fmtInt(idx.rows, lang)}
        foot={<>
          {shown.length ? <ExpiringNote lang={lang} /> : null}
          <nav aria-label={t(lang, "common.pagination")} class="pagination" id="radar-pager">
            <span class="muted">{t(lang, "tenders.page_of", { page: fmtInt(n, lang), pages: fmtInt(pages, lang) })}</span>
            <span class="pages">
              {prevPath ? <a href={prevPath} class="btn" rel="prev">{t(lang, "tenders.prev")}</a> : null}
              {nextPath ? <a href={nextPath} class="btn" rel="next">{t(lang, "tenders.next")}</a> : null}
            </span>
          </nav>
        </>}>
        {whole ? (
          <p class="muted small" aria-live="polite">
            {t(lang, "expiring.whole_note", {
              n: fmtInt(whole.n, lang), rows: fmtInt(idx.rows, lang),
              total: whole.total === null ? t(lang, "common.not_stated") : money(lang, whole.total),
            })}
            {whole.noValue ? <> {t(lang, "expiring.whole_no_value", { n: fmtInt(whole.noValue, lang) })}</> : null}
            {whole.noProvinces ? <> {t(lang, "expiring.province_unavailable")}</> : null}
          </p>
        ) : viewOnly ? (
          <p class="muted small" aria-live="polite">
            {t(lang, "expiring.filter_note", { rows: fmtInt(sorted.length, lang), page: fmtInt(n, lang), pages: fmtInt(pages, lang) })}
          </p>
        ) : null}
        {whole && whole.n > 0 ? (
          csvAllowed ? (
            <p class="small">
              <a href={csvPath} rel="nofollow">{t(lang, "expiring.csv_filtered")}</a>
              {whole.n > RADAR_CSV_MAX ? <> {t(lang, "expiring.csv_cut", { n: fmtInt(RADAR_CSV_MAX, lang) })}</> : null}
            </p>
          ) : accountsEnabled(c.env) ? (
            <ProNote lang={lang}>
              {t(lang, "expiring.csv_filtered_pro")}{" "}
              <a href={account?.email ? "/account/billing" : "/account/sign-in"}>
                {t(lang, account?.email ? "analytics.pro_billing" : "analytics.pro_sign_in")}
              </a>
            </ProNote>
          ) : null
        ) : null}
        {shown.length ? (
          <>
            <ExpiringTable lang={lang} rows={shown} phonePages pages={serverPages} csv={csv} sorts={sorts}
              marks={lines.state === "ready" ? lines.marks : undefined} />
            <RadarLineNotes lang={lang} lines={lines} />
          </>
        ) : (
          <p class="muted">{t(lang, whole ? "expiring.whole_none" : filtered ? "expiring.none_match" : "expiring.none_window")}</p>
        )}
      </Panel>
      <InterestPanel lang={lang} filter={interest} />
      <PhonePagerScript lang={lang} />
    </Layout>,
  );
}

// A file of the 6- or 12-month window under /data/expiring/, which
// wrangler.jsonc sends through the Worker before the static layer; the
// pages read the same files through the assets binding, which never comes
// back through here. Once the accounts switch is on, a request whose plan
// lacks radar_depth gets the site's 404, as for a file that does not exist,
// and a Pro request gets the file marked private so no shared cache hands
// it on. While the switch is off every request gets the file as the static
// layer serves it: its headers as they are, and the reader's conditional
// headers passed on, so a reader that holds the file gets a 304.
export async function expiringFile(c: Context<AppEnv>, window: ExpiringWindow): Promise<Response> {
  if (await radarWindowLocked(c, window)) return c.notFound();
  if (!c.env.ASSETS) return c.notFound();
  let res: Response;
  try {
    res = await c.env.ASSETS.fetch(c.req.raw);
  } catch (e) {
    console.error(`radar file ${c.req.path}: ${String(e).slice(0, 200)}`);
    c.header("Retry-After", "300");
    c.header("Cache-Control", "no-store");
    return c.body(null, 503);
  }
  if (res.status === 404) return c.notFound();
  // The binding's headers cannot be changed in place, and the middleware
  // adds its own after this returns.
  const headers = new Headers(res.headers);
  if (accountsEnabled(c.env)) headers.set("Cache-Control", "private, no-store");
  return new Response(res.body, { status: res.status, headers });
}
