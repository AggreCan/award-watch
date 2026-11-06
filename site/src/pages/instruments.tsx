// Standing offers and supply arrangements (docs/sosa.md), free for every
// reader: nothing here is hidden behind a plan. The two CSV files are Pro's
// (export_filtered) once the accounts switch is on, and the site's 404
// otherwise, as the radar's filtered file is.
//
// /instruments: every instrument with an active holder in PSPC's weekly
//   file (instruments/index.json), filtered by type, region, segment,
//   commodity, end user and expiry, sorted by expiry or holders, 100 a page;
//   /instruments/rows.csv the view as CSV.
// /instruments/<agreement>: one instrument from the records database, with
//   its holders and the call-ups the published contracts record against it;
//   /instruments/<agreement>/holders.csv its holders as CSV.
// The panels the other pages carry: the profile's line and section, the
//   holders on a segment page and a buyer page, and the instruments a tender
//   notice issued.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { allowed } from "../account/entitlements";
import { railAccount } from "../account/session";
import { accountsEnabled } from "../account/switch";
import { type HeadSort, Table, headSort } from "../columns";
import { SEGMENTS } from "../constants";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, provinceName, segmentLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import {
  AGREEMENT_MAX, HOLDER_ROWS_MAX, HOLDERS_CSV_MAX, INSTRUMENT_CSV_MAX, INSTRUMENT_ORDERS, INSTRUMENT_PAGE_ROWS, OTHER_REGIONS, TYPE_CODES, WITHIN_DAYS,
  activeFilters, callsOf, daysLeft, filterInstruments, instrumentPath, instrumentQueryString, isAgreement, loadInstrumentIndex,
  readHoldersCsv, readInstrument, readInstrumentQuery, sortInstruments, type Calls, type HeldInstrument, type HoldersPart,
  type InstrumentIndex, type InstrumentQuery, type InstrumentRow, type ProfileInstruments, type Row, type TenderInstrument,
  type TypeCode, type Within,
} from "../instruments";
import { Layout, PageHead, Panel, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { requestPlan } from "../plan";
import { ProNote } from "../pro";
import { dollars, num, orgIdOf } from "../records_db";
import { canonicalUrl } from "../seo";
import { csvCell } from "./analytics";
import { FiltersFold, money } from "./shared";

// The government's own pages for the source: its search, and the open data record.
export const SOSA_SEARCH_URL = "https://sosa.canadabuys.canada.ca/";
export const SOSA_DATASET_ID = "f5c8a5a0-354d-455a-99ab-8276aa38032e";
export const sosaDatasetUrl = (lang: Lang): string => `https://open.canada.ca/data/${lang === "fr" ? "fr" : "en"}/dataset/${SOSA_DATASET_ID}`;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

const TYPE_KEY: Record<TypeCode, Key> = {
  SA: "instruments.type_SA", NMSO: "instruments.type_NMSO", DISO: "instruments.type_DISO", RISO: "instruments.type_RISO",
  RMSO: "instruments.type_RMSO", OTHER: "instruments.type_OTHER",
};
const REGION_KEY: Record<(typeof OTHER_REGIONS)[number], Key> = {
  FD: "instruments.region_FD", NA: "instruments.region_NA", NC: "instruments.region_NC",
};

// A type the dictionary names reads in the site's words; another reads as the file wrote it.
export function typeLabel(lang: Lang, code: TypeCode, en?: string | null, fr?: string | null): string {
  return code === "OTHER" ? pick(lang, en, fr) ?? t(lang, TYPE_KEY.OTHER) : t(lang, TYPE_KEY[code]);
}

export function regionName(lang: Lang, code: string): string {
  if (!code) return t(lang, "common.not_stated");
  if ((OTHER_REGIONS as readonly string[]).includes(code)) return t(lang, REGION_KEY[code as (typeof OTHER_REGIONS)[number]]);
  return provinceName(lang, code);
}

export function expiryText(lang: Lang, expiry: string | null, today: string): string {
  if (!expiry) return t(lang, "common.not_stated");
  const left = daysLeft(expiry, today);
  if (left === null) return expiry;
  if (left < 0) return t(lang, "instruments.expired_on", { date: expiry });
  return tn(lang, "instruments.days_left_one", "instruments.days_left_many", left, { date: expiry, n: fmtInt(left, lang) });
}

// Pro's file of a view or of an instrument's holders: never while the switch is off.
export async function instrumentsCsvAllowed(c: Context<AppEnv>): Promise<boolean> {
  if (!accountsEnabled(c.env)) return false;
  return allowed({ plan: await requestPlan(c) }, "export_filtered");
}

// Where a reader without the file goes: the billing page signed in, else the sign-in.
const ProCsvNote: FC<{ lang: Lang; text: Key; signedIn: boolean }> = ({ lang, text, signedIn }) => (
  <ProNote lang={lang}>
    {t(lang, text)}{" "}
    <a href={signedIn ? "/account/billing" : "/account/sign-in"}>{t(lang, signedIn ? "analytics.pro_billing" : "analytics.pro_sign_in")}</a>
  </ProNote>
);

function pageOf(c: Context<AppEnv>): number | null {
  const raw = c.req.query("page");
  if (raw === undefined) return 1;
  const n = Number(raw);
  return /^[0-9]{1,6}$/.test(raw) && n >= 1 ? n : null;
}

// -- /instruments ---------------------------------------------------------------------

type Option = { value: string; label: string; n: number };

const OPTIONS_MAX = 300;

function counted(values: Iterable<string>): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

// The form's choices from the whole list, each with how many instruments carry it.
function indexOptions(idx: InstrumentIndex, lang: Lang) {
  const rows = idx.rows;
  const byCount = (a: Option, b: Option) => b.n - a.n || (a.label < b.label ? -1 : 1);
  const types = counted(rows.map((r) => r.type));
  const regions = counted(rows.flatMap((r) => r.regions));
  const segments = counted(rows.flatMap((r) => (r.segments.length ? r.segments : ["none"])));
  const commodities = counted(rows.flatMap((r) => (r.commodity ? [r.commodity] : [])));
  const users = counted(rows.flatMap((r) => (r.end_user ? [r.end_user] : [])));
  const named = (m: Record<string, { en: string | null; fr: string | null }>, k: string) => pick(lang, m[k]?.en, m[k]?.fr);
  return {
    type: TYPE_CODES.filter((k) => types.has(k)).map((k) => ({
      value: k, label: typeLabel(lang, k, idx.types[k]?.en, idx.types[k]?.fr), n: types.get(k) ?? 0,
    })),
    region: [...regions].map(([k, n]) => ({ value: k, label: regionName(lang, k), n })).sort((a, b) => (a.label < b.label ? -1 : 1)),
    segment: [...segments].map(([k, n]) => ({ value: k, label: k === "none" ? t(lang, "instruments.no_segment") : `${k} ${segmentLabel(lang, k)}`, n }))
      .sort((a, b) => (a.value === "none" ? 1 : b.value === "none" ? -1 : a.value < b.value ? -1 : 1)),
    commodity: [...commodities].map(([k, n]) => ({ value: k, label: named(idx.commodities, k) ? `${k} ${named(idx.commodities, k)}` : k, n }))
      .sort(byCount).slice(0, OPTIONS_MAX),
    user: [...users].map(([k, n]) => ({ value: k, label: named(idx.end_users, k) ?? k, n })).sort(byCount).slice(0, OPTIONS_MAX),
  };
}

const Select: FC<{ name: string; label: Key; any?: Key; opts: Option[]; value: string; lang: Lang }> = ({ name, label, any = "tenders.any", opts, value, lang }) => (
  <label class="field">
    <span class="field-label">{t(lang, label)}</span>
    <select name={name}>
      <option value="">{t(lang, any)}</option>
      {opts.map((o) => <option value={o.value} selected={o.value === value}>{`${o.label} (${fmtInt(o.n, lang)})`}</option>)}
    </select>
  </label>
);

// One page of the list, so the server orders it: the Expiry and Holders
// heads link its orders (sorts) and the others stay plain.
const InstrumentsTable: FC<{
  lang: Lang; rows: readonly InstrumentRow[]; idx: InstrumentIndex; today: string; sorts: { expiry: HeadSort; holders: HeadSort };
}> = ({ lang, rows, idx, today, sorts }) => (
  <div class="table-wrap bordered">
    <Table sorting="server" cols={[
      { kind: "main", label: t(lang, "instruments.col_instrument") },
      { kind: "label", label: t(lang, "instruments.col_type") },
      { kind: "text", label: t(lang, "instruments.col_commodity"), rest: "lg" },
      { kind: "buyer", label: t(lang, "instruments.col_user"), rest: "xl" },
      { kind: "region", label: t(lang, "instruments.col_regions"), rest: "md" },
      { kind: "date", label: t(lang, "instruments.col_expiry"), sort: sorts.expiry },
      { kind: "count", label: t(lang, "instruments.col_holders"), sort: sorts.holders },
    ]}>
      <tbody>
        {rows.map((r) => {
          const commodity = r.commodity ? pick(lang, idx.commodities[r.commodity]?.en, idx.commodities[r.commodity]?.fr) : null;
          const user = r.end_user ? idx.end_users[r.end_user] : undefined;
          return (
            <tr>
              <td data-label={t(lang, "instruments.col_instrument")}>
                <a href={instrumentPath(r.agreement)}>{pick(lang, r.description_en, r.description_fr) ?? r.agreement}</a>
                <br /><span class="mono muted">{r.agreement}</span>
              </td>
              <td data-label={t(lang, "instruments.col_type")}>{typeLabel(lang, r.type, idx.types[r.type]?.en, idx.types[r.type]?.fr)}</td>
              <td data-label={t(lang, "instruments.col_commodity")} class="lgh">
                {r.commodity ? <><span class="mono">{r.commodity}</span>{commodity ? ` ${commodity}` : ""}</> : t(lang, "common.not_stated")}
              </td>
              <td data-label={t(lang, "instruments.col_user")} class="xlh">
                {user ? (user.buyer_id ? <a href={`/buyers/${user.buyer_id}`}>{pick(lang, user.en, user.fr)}</a> : pick(lang, user.en, user.fr))
                  : t(lang, "common.not_stated")}
              </td>
              <td data-label={t(lang, "instruments.col_regions")} class="mdh">{r.regions.map((x) => regionName(lang, x)).join(", ")}</td>
              <td data-label={t(lang, "instruments.col_expiry")} class="mono">{expiryText(lang, r.expiry, today)}</td>
              <td data-label={t(lang, "instruments.col_holders")} class="mono num">
                {r.n_holders_withheld
                  ? t(lang, "instruments.holders_withheld", { n: fmtInt(r.n_holders, lang), w: fmtInt(r.n_holders_withheld, lang) })
                  : fmtInt(r.n_holders, lang)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  </div>
);

// The lead names the source, its weekly cadence and the file's date; a held
// or failed week says the rows are the last file's.
const IndexLead: FC<{ lang: Lang; idx: InstrumentIndex }> = ({ lang, idx }) => (
  <>
    {idx.published
      ? tn(lang, "instruments.lead_one", "instruments.lead_many", idx.rows.length, { n: fmtInt(idx.rows.length, lang), date: idx.published })
      : t(lang, "instruments.lead_none")}
    {idx.published && idx.status === "failed" ? <> {t(lang, "instruments.status_failed", { date: idx.published })}</> : null}
    {idx.published && idx.status === "held" ? <> {t(lang, "instruments.status_held", { date: idx.published })}</> : null}
  </>
);

const FILTER_KEYS = ["type", "region", "segment", "commodity", "user", "within"] as const;
const FILTER_LABEL: Record<(typeof FILTER_KEYS)[number], Key> = {
  type: "instruments.col_type", region: "instruments.filter_region", segment: "tenders.filter_segment",
  commodity: "instruments.col_commodity", user: "instruments.col_user", within: "instruments.filter_within",
};
const WITHIN_KEY: Record<Within, Key> = { "3": "instruments.within_3", "6": "instruments.within_6", "12": "instruments.within_12" };

export async function instrumentsIndex(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const idx = await loadInstrumentIndex(c.env);
  if (!idx) return noDataPage(c, "instruments.title");
  const stats = await loadStats(c.env);
  const dataAsOf = stats?.data_as_of ?? idx.as_of;
  const path = "/instruments";
  const n = pageOf(c);
  if (n === null) return notFoundPage(c, dataAsOf, "instruments.page_not_found", path, "instrument.back");
  const q = readInstrumentQuery(new URL(c.req.url));
  const today = todayOf(idx.as_of);
  const matched = sortInstruments(filterInstruments(idx.rows, q, today), q.sort);
  const pages = Math.max(1, Math.ceil(matched.length / INSTRUMENT_PAGE_ROWS));
  if (n > pages) return notFoundPage(c, dataAsOf, "instruments.page_not_found", path, "instrument.back");
  const shown = matched.slice((n - 1) * INSTRUMENT_PAGE_ROWS, n * INSTRUMENT_PAGE_ROWS);
  const opts = indexOptions(idx, lang);
  const active = activeFilters(q);
  const csvOk = await instrumentsCsvAllowed(c);
  const account = accountsEnabled(c.env) && !csvOk ? await railAccount(c).catch(() => undefined) : undefined;
  const prevPath = n > 1 ? `${path}${instrumentQueryString(q, n - 1)}` : null;
  const nextPath = n < pages ? `${path}${instrumentQueryString(q, n + 1)}` : null;
  // The heads' links: the same filters in the next order, from the first page.
  const sortHref = (v: string) => `${path}${instrumentQueryString({ ...q, sort: v as InstrumentQuery["sort"] })}`;
  const sorts = {
    expiry: headSort(INSTRUMENT_ORDERS, q.sort, "expiry", sortHref), holders: headSort(INSTRUMENT_ORDERS, q.sort, "holders", sortHref),
  };
  const title = t(lang, "instruments.title");
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: title }];
  const label = (k: (typeof FILTER_KEYS)[number]): string => {
    if (k === "within") return q.within ? t(lang, WITHIN_KEY[q.within]) : "";
    return (opts[k] as Option[]).find((o) => o.value === q[k])?.label ?? q[k];
  };
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={dataAsOf}
      seo={{ path, title: t(lang, "instruments.seo_title"), description: t(lang, "instruments.description"), noindex: active > 0 || q.sort !== "" || n > 1 }}
      head={<>
        {prevPath ? <link rel="prev" href={canonicalUrl(prevPath, lang)} /> : null}
        {nextPath ? <link rel="next" href={canonicalUrl(nextPath, lang)} /> : null}
      </>}>
      <PageHead lang={lang} crumbs={crumbs} title={title} lead={<IndexLead lang={lang} idx={idx} />}
        actions={<>
          <a href={SOSA_SEARCH_URL} class="btn" rel="noopener">{t(lang, "instruments.search_link")}</a>
          <a href={sosaDatasetUrl(lang)} class="btn" rel="noopener">{t(lang, "instruments.dataset_link")}</a>
        </>} />
      <form method="get" action={path} class="toolbar">
        <FiltersFold lang={lang} active={active}>
          <div class="toolbar-fields">
            <Select name="type" label="instruments.col_type" opts={opts.type} value={q.type} lang={lang} />
            <Select name="region" label="instruments.filter_region" any="tenders.any_f" opts={opts.region} value={q.region} lang={lang} />
            <Select name="segment" label="tenders.filter_segment" opts={opts.segment} value={q.segment} lang={lang} />
            <Select name="commodity" label="instruments.col_commodity" opts={opts.commodity} value={q.commodity} lang={lang} />
            <Select name="user" label="instruments.col_user" opts={opts.user} value={q.user} lang={lang} />
            <label class="field">
              <span class="field-label">{t(lang, "instruments.filter_within")}</span>
              <select name="within">
                <option value="">{t(lang, "instruments.within_any")}</option>
                {(Object.keys(WITHIN_DAYS) as Within[]).map((w) => <option value={w} selected={q.within === w}>{t(lang, WITHIN_KEY[w])}</option>)}
              </select>
            </label>
            <label class="field">
              <span class="field-label">{t(lang, "tenders.sort")}</span>
              {/* "expiry", set from the head, is the list's own order and reads as it here. */}
              <select name="sort">
                <option value="">{t(lang, "instruments.sort_expiry")}</option>
                <option value="expiry-desc" selected={q.sort === "expiry-desc"}>{t(lang, "instruments.sort_expiry_desc")}</option>
                <option value="holders" selected={q.sort === "holders"}>{t(lang, "instruments.sort_holders")}</option>
                <option value="holders-asc" selected={q.sort === "holders-asc"}>{t(lang, "instruments.sort_holders_asc")}</option>
              </select>
            </label>
            <div class="toolbar-actions">
              <button type="submit" class="btn btn-primary">{t(lang, "tenders.apply")}</button>
              <a href={path} class="btn">{t(lang, "tenders.reset")}</a>
            </div>
          </div>
        </FiltersFold>
        {active ? (
          <div class="toolbar-chips">
            <span class="chips-label">{t(lang, "tenders.filters_active")}</span>
            {FILTER_KEYS.filter((k) => q[k]).map((k) => (
              <a class="fchip" href={`${path}${instrumentQueryString({ ...q, [k]: "" } as InstrumentQuery)}`}
                aria-label={t(lang, "tenders.remove_filter", { name: label(k) })}>
                <span>{t(lang, FILTER_LABEL[k])}</span> <b>{label(k)}</b>
                <span class="fchip-x" aria-hidden="true">×</span>
              </a>
            ))}
          </div>
        ) : null}
      </form>
      <Panel title={title} count={tn(lang, "instruments.match_one", "instruments.match_many", matched.length, { n: fmtInt(matched.length, lang) })}
        foot={<>
          <span>{t(lang, "instruments.note")}</span>
          <nav aria-label={t(lang, "common.pagination")} class="pagination">
            <span class="muted">{t(lang, "tenders.page_of", { page: fmtInt(n, lang), pages: fmtInt(pages, lang) })}</span>
            <span class="pages">
              {prevPath ? <a href={prevPath} class="btn" rel="prev">{t(lang, "tenders.prev")}</a> : null}
              {nextPath ? <a href={nextPath} class="btn" rel="next">{t(lang, "tenders.next")}</a> : null}
            </span>
          </nav>
        </>}>
        {matched.length ? (
          csvOk ? (
            <p class="small">
              <a href={`${path}/rows.csv${instrumentQueryString(q)}`} rel="nofollow">{t(lang, "instruments.csv")}</a>
              {matched.length > INSTRUMENT_CSV_MAX ? <> {t(lang, "instruments.csv_cut", { n: fmtInt(INSTRUMENT_CSV_MAX, lang) })}</> : null}
            </p>
          ) : accountsEnabled(c.env) ? <ProCsvNote lang={lang} text="instruments.csv_pro" signedIn={!!account?.email} /> : null
        ) : null}
        {shown.length ? <InstrumentsTable lang={lang} rows={shown} idx={idx} today={today} sorts={sorts} />
          : <p class="muted">{t(lang, idx.rows.length ? "instruments.none" : "instruments.none_published")}</p>}
      </Panel>
    </Layout>,
  );
}

export const INSTRUMENT_CSV_COLUMNS = [
  "agreement_number", "type", "type_en", "type_fr", "description_en", "description_fr", "commodity", "commodity_en", "commodity_fr",
  "end_user_en", "end_user_fr", "end_user_buyer_id", "regions", "segments", "start", "expiry", "days_left", "holders",
  "holders_withheld", "url",
] as const;

export async function instrumentsCsv(c: Context<AppEnv>): Promise<Response> {
  if (!(await instrumentsCsvAllowed(c))) return c.notFound();
  const idx = await loadInstrumentIndex(c.env);
  if (!idx) {
    c.header("Retry-After", "3600");
    c.header("Cache-Control", "no-store");
    return c.text(t(c.get("lang"), "instrument.unavailable"), 503);
  }
  const q = readInstrumentQuery(new URL(c.req.url));
  const today = todayOf(idx.as_of);
  const rows = sortInstruments(filterInstruments(idx.rows, q, today), q.sort).slice(0, INSTRUMENT_CSV_MAX);
  const origin = new URL(c.req.url).origin;
  const lines = rows.map((r) => {
    const user = r.end_user ? idx.end_users[r.end_user] : undefined;
    const commodity = r.commodity ? idx.commodities[r.commodity] : undefined;
    return [
      r.agreement, r.type, idx.types[r.type]?.en ?? null, idx.types[r.type]?.fr ?? null, r.description_en, r.description_fr, r.commodity,
      commodity?.en ?? null, commodity?.fr ?? null, user?.en ?? null, user?.fr ?? null, user?.buyer_id ?? null, r.regions.join(" "),
      r.segments.join(" "), r.start, r.expiry, daysLeft(r.expiry, today), r.n_holders, r.n_holders_withheld, `${origin}${instrumentPath(r.agreement)}`,
    ].map(csvCell).join(",");
  });
  const body = [INSTRUMENT_CSV_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="standing-offers-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// -- /instruments/<agreement> ----------------------------------------------------------------

// The holder rows (one a region) as one line a holder, regions joined, the earliest first sight.
interface Holder { oid: number | null; name: string; op: string | null; regions: string[]; seen: string }

export function groupHolders(rows: readonly Row[]): Holder[] {
  const by = new Map<string, Holder>();
  for (const r of rows) {
    const name = str(r.name);
    if (!name) continue;
    const oid = num(r.oid);
    const key = `${oid ?? ""}|${name}`;
    const region = str(r.region) ?? "";
    const seen = str(r.seen) ?? "";
    const h = by.get(key);
    if (h) {
      if (!h.regions.includes(region)) h.regions.push(region);
      if (seen && (!h.seen || seen < h.seen)) h.seen = seen;
    } else {
      by.set(key, { oid, name, op: str(r.op), regions: [region], seen });
    }
  }
  return [...by.values()];
}

function moneyOf(lang: Lang, c: Calls | undefined): string {
  if (!c || c.n === 0) return money(lang, 0);
  const v = dollars(c.cents);
  return v === null ? t(lang, "common.not_stated") : money(lang, v);
}

const Detail: FC<{ lang: Lang; k: Key; v: unknown }> = ({ lang, k, v }) =>
  v === null || v === undefined || v === "" ? null : (<><dt>{t(lang, k)}</dt><dd>{v as any}</dd></>);

async function unavailable(c: Context<AppEnv>, lang: Lang, dataAsOf: string | null, agreement: string, state: string): Promise<Response> {
  c.header("Retry-After", "3600");
  return page(
    c,
    <Layout lang={lang} title={t(lang, "instrument.eyebrow")} dataAsOf={dataAsOf}>
      <PageHead lang={lang} eyebrow={t(lang, "instrument.eyebrow")} title={agreement}
        lead={t(lang, state === "loading" ? "instrument.loading" : "instrument.unavailable")}
        actions={<a href={SOSA_SEARCH_URL} class="btn" rel="noopener">{t(lang, "instruments.search_link")}</a>} />
    </Layout>,
    503,
  );
}

export async function instrumentRoute(c: Context<AppEnv>): Promise<Response> {
  // c.req.path keeps the escaped slashes of the number (%2F), so a literal
  // "/holders.csv" can only be the file's suffix.
  const raw = c.req.param("agreement") ?? "";
  if (c.req.path.endsWith("/holders.csv")) return holdersCsv(c, raw.slice(0, -"/holders.csv".length));
  return instrumentPage(c, raw);
}

async function instrumentPage(c: Context<AppEnv>, agreement: string): Promise<Response> {
  const lang = c.get("lang");
  if (!isAgreement(agreement) || agreement.length > AGREEMENT_MAX) return c.notFound();
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "instruments.title");
  const read = await readInstrument(c.env, agreement);
  if (read.state !== "ready") return unavailable(c, lang, stats.data_as_of, agreement, read.state);
  const d = read.rows[0]?.[0];
  if (!d) {
    return page(
      c,
      <Layout lang={lang} title={t(lang, "instrument.not_found")} dataAsOf={stats.data_as_of}>
        <PageHead lang={lang} title={t(lang, "instrument.not_found")}
          lead={<>
            {tj(lang, "instrument.not_found_text", { agreement: <span class="mono">{agreement}</span> })}{" "}
            <a href="/instruments">{t(lang, "instrument.back")}</a>
          </>} />
      </Layout>,
      404,
    );
  }
  const today = todayOf(stats.data_as_of);
  const path = instrumentPath(agreement);
  const rows = read.rows[1] ?? [];
  const cut = rows.length > HOLDER_ROWS_MAX;
  const holders = groupHolders(rows.slice(0, HOLDER_ROWS_MAX));
  const calls = callsOf(d.calls);
  const callsBy = new Map(calls.filter((x) => x.oid !== null).map((x) => [x.oid as number, x]));
  const other = calls.find((x) => x.oid === null);
  const n = num(d.n) ?? 0;
  const nw = num(d.nw) ?? 0;
  const code = typeCodeOf(str(d.type_en));
  const type = typeLabel(lang, code, str(d.type_en), str(d.type_fr));
  const description = pick(lang, str(d.desc_en), str(d.desc_fr));
  const title = description ?? agreement;
  const segs = (str(d.segs) ?? "").trim().split(/\s+/).filter((s) => /^\d{2}$/.test(s) && SEGMENTS[s]);
  const csvOk = await instrumentsCsvAllowed(c);
  const account = accountsEnabled(c.env) && !csvOk ? await railAccount(c).catch(() => undefined) : undefined;
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "instruments.title"), path: "/instruments" }, { name: agreement }];
  const buyer = str(d.buyer);
  const user = pick(lang, str(d.user_en), str(d.user_fr));
  const tref = str(d.tref);
  const gsin = str(d.gsin);
  const gsinName = pick(lang, str(d.gsin_en), str(d.gsin_fr));
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of}
      seo={{
        path, socialTitle: title,
        description: t(lang, "instrument.description", {
          type, agreement, n: fmtInt(n, lang), date: str(d.expiry) ?? t(lang, "common.not_stated"),
        }).slice(0, 155),
      }}>
      <PageHead lang={lang} crumbs={crumbs} eyebrow={type} title={title}
        lead={<>
          <span class="mono">{agreement}</span>{" · "}
          {t(lang, "instrument.lead_expiry", { expiry: expiryText(lang, str(d.expiry), today) })}{" · "}
          {tn(lang, "instrument.lead_holders_one", "instrument.lead_holders_many", n, { n: fmtInt(n, lang) })}
        </>}
        actions={<>
          <a href={SOSA_SEARCH_URL} class="btn" rel="noopener">{t(lang, "instruments.search_link")}</a>
          <a href="/instruments" class="btn">{t(lang, "instrument.back")}</a>
        </>}>
        {n === 0 ? <p class="page-note">{t(lang, "instrument.lapsed", { date: str(d.last) ?? t(lang, "common.na") })}</p> : null}
      </PageHead>

      <Panel title={t(lang, "instrument.details")}>
        <dl class="wide">
          <Detail lang={lang} k="instruments.col_type" v={type} />
          <Detail lang={lang} k="instrument.description_en" v={str(d.desc_en)} />
          <Detail lang={lang} k="instrument.description_fr" v={str(d.desc_fr)} />
          <Detail lang={lang} k="instrument.commodity" v={gsin ? <><span class="mono">{gsin}</span>{gsinName ? ` ${gsinName}` : ""}</> : null} />
          <Detail lang={lang} k="instruments.col_user" v={user ? (buyer ? <a href={`/buyers/${buyer}`}>{user}</a> : user) : null} />
          <Detail lang={lang} k="instrument.start" v={str(d.start)} />
          <Detail lang={lang} k="instruments.col_expiry" v={expiryText(lang, str(d.expiry), today)} />
          <Detail lang={lang} k="instrument.notice" v={tref ? <a href={`/tenders/${encodeURIComponent(tref.toLowerCase())}`} class="mono">{tref}</a> : null} />
          <dt>{t(lang, "instrument.segments")}</dt>
          <dd>{segs.length
            ? segs.map((s, i) => <>{i ? ", " : ""}<a href={`/segments/${s}`}>{`${s} ${segmentLabel(lang, s)}`}</a></>)
            : t(lang, "instrument.no_segment", { gsin: gsin ?? t(lang, "common.not_stated") })}</dd>
          <Detail lang={lang} k="instrument.first_seen" v={str(d.seen)} />
        </dl>
      </Panel>

      <Panel id="holders" title={t(lang, "instrument.holders")} count={fmtInt(n, lang)}
        foot={<span>{t(lang, "instrument.calls_note")}</span>}>
        {nw > 0 && nw === n ? <p class="muted">{t(lang, "instrument.all_withheld", { n: fmtInt(nw, lang) })}</p>
          : nw > 0 ? <p class="muted small">{tn(lang, "instrument.withheld_one", "instrument.withheld_many", nw, { n: fmtInt(nw, lang) })}</p> : null}
        {holders.length ? (
          csvOk ? <p class="small"><a href={`${path}/holders.csv`} rel="nofollow">{t(lang, "instrument.csv")}</a></p>
            : accountsEnabled(c.env) ? <ProCsvNote lang={lang} text="instrument.csv_pro" signedIn={!!account?.email} /> : null
        ) : null}
        {cut ? <p class="muted small">{t(lang, "instrument.holders_cut", { n: fmtInt(holders.length, lang) })}</p> : null}
        {holders.length ? (
          <div class="table-wrap bordered">
            <Table restack={false} class="compact" cols={[
              { kind: "main", label: t(lang, "instrument.col_holder") },
              { kind: "region", label: t(lang, "instruments.col_regions") },
              { kind: "date", label: t(lang, "instrument.col_first_seen"), rest: "md" },
              { kind: "count", label: t(lang, "instrument.col_calls") },
              { kind: "total", label: t(lang, "instrument.col_calls_value") },
            ]}>
              <tbody>
                {holders.map((h) => {
                  const mine = h.oid !== null ? callsBy.get(h.oid) : undefined;
                  return (
                    <tr>
                      <td data-label={t(lang, "instrument.col_holder")}>
                        {h.oid !== null ? <a href={`/organizations/${orgIdOf(h.oid)}`}>{h.name}</a> : h.name}
                        {h.op ? <><br /><span class="muted small">{t(lang, "instrument.operating", { name: h.op })}</span></> : null}
                      </td>
                      <td data-label={t(lang, "instruments.col_regions")}>{h.regions.map((x) => regionName(lang, x)).join(", ")}</td>
                      <td data-label={t(lang, "instrument.col_first_seen")} class="mono mdh">{h.seen}</td>
                      <td data-label={t(lang, "instrument.col_calls")} class="mono num">
                        {h.oid === null ? t(lang, "instrument.no_profile") : fmtInt(mine?.n ?? 0, lang)}
                      </td>
                      <td data-label={t(lang, "instrument.col_calls_value")} class="mono num">{h.oid === null ? "" : moneyOf(lang, mine)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : nw === 0 ? <p class="muted">{t(lang, "instrument.no_holders")}</p> : null}
        {other && other.n > 0 ? (
          <p class="muted small">{t(lang, "instrument.calls_other", { n: fmtInt(other.n, lang), value: moneyOf(lang, other) })}</p>
        ) : null}
      </Panel>

      <p class="muted small">
        {tj(lang, "instrument.source", {
          date: str(d.last) ?? t(lang, "common.na"),
          dataset: <a href={sosaDatasetUrl(lang)} rel="noopener">{t(lang, "instruments.dataset_link")}</a>,
          search: <a href={SOSA_SEARCH_URL} rel="noopener">{t(lang, "instruments.search_link")}</a>,
        })}
      </p>
    </Layout>,
  );
}

// The type code the pipeline gives (sources/sosa.type_code), from the English type.
export function typeCodeOf(typeEn: string | null): TypeCode {
  const text = (typeEn ?? "").toLowerCase();
  if (text.includes("supply arrangement")) return "SA";
  if (text.includes("national master")) return "NMSO";
  if (text.includes("departmental individual")) return "DISO";
  if (text.includes("regional individual")) return "RISO";
  if (text.includes("regional master")) return "RMSO";
  return "OTHER";
}

export const HOLDERS_CSV_COLUMNS = [
  "agreement_number", "holder", "operating_name", "organization_id", "regions", "first_seen", "callups", "callups_value",
] as const;

async function holdersCsv(c: Context<AppEnv>, agreement: string): Promise<Response> {
  if (!isAgreement(agreement) || !(await instrumentsCsvAllowed(c))) return c.notFound();
  const read = await readHoldersCsv(c.env, agreement);
  if (read.state !== "ready") {
    c.header("Retry-After", "3600");
    c.header("Cache-Control", "no-store");
    return c.text(t(c.get("lang"), read.state === "loading" ? "instrument.loading" : "instrument.unavailable"), 503);
  }
  const d = read.rows[0]?.[0];
  if (!d) return c.notFound();
  const callsBy = new Map(callsOf(d.calls).filter((x) => x.oid !== null).map((x) => [x.oid as number, x]));
  const lines = groupHolders((read.rows[1] ?? []).slice(0, HOLDERS_CSV_MAX)).map((h) => {
    const mine = h.oid !== null ? callsBy.get(h.oid) : undefined;
    const value = mine ? dollars(mine.cents) : null;
    return [agreement, h.name, h.op, h.oid === null ? null : orgIdOf(h.oid), h.regions.join(" "), h.seen,
      h.oid === null ? null : mine?.n ?? 0, h.oid === null ? null : value === null ? (mine ? null : 0) : value.toFixed(2)].map(csvCell).join(",");
  });
  const body = [HOLDERS_CSV_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
  const file = agreement.replace(/[^A-Za-z0-9.-]+/g, "-");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="holders-${file}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// -- the panels on other pages ---------------------------------------------------------------

// The profile's line in its head: how many instruments it holds, linked to the section.
export const InstrumentsLine: FC<{ lang: Lang; part: ProfileInstruments | null }> = ({ lang, part }) =>
  part && part.n > 0 ? (
    <p class="page-note">
      <a href="#instruments">{tn(lang, "org.instruments_one", "org.instruments_many", part.n, { n: fmtInt(part.n, lang) })}</a>
    </p>
  ) : null;

const HeldTable: FC<{ lang: Lang; rows: readonly HeldInstrument[]; lapsed?: boolean; today: string }> = ({ lang, rows, lapsed, today }) => (
  <div class="table-wrap bordered">
    <Table restack={false} class="compact" cols={[
      { kind: "main", label: t(lang, "instruments.col_instrument") },
      { kind: "label", label: t(lang, "instruments.col_type"), rest: "md" },
      { kind: "region", label: t(lang, "instruments.col_regions") },
      { kind: "date", label: t(lang, lapsed ? "org.instruments_lost_on" : "instruments.col_expiry") },
    ]}>
      <tbody>
        {rows.map((r) => (
          <tr>
            <td data-label={t(lang, "instruments.col_instrument")}>
              <a href={instrumentPath(r.agreement)}>{pick(lang, r.description_en, r.description_fr) ?? r.agreement}</a>
              <br /><span class="mono muted">{r.agreement}</span>
            </td>
            <td data-label={t(lang, "instruments.col_type")} class="mdh">{typeLabel(lang, r.type, r.type_en, r.type_fr)}</td>
            <td data-label={t(lang, "instruments.col_regions")}>{r.regions.map((x) => regionName(lang, x)).join(", ")}</td>
            <td data-label={t(lang, lapsed ? "org.instruments_lost_on" : "instruments.col_expiry")} class="mono">
              {lapsed ? r.lost_on ?? "" : expiryText(lang, r.expiry, today)}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  </div>
);

// The profile's section: every instrument held, soonest expiry first, and the
// ones it no longer holds (lapsed within the last 90 days).
export const ProfileInstrumentsPanel: FC<{ lang: Lang; part: ProfileInstruments | null; today: string }> = ({ lang, part, today }) =>
  part && (part.rows.length || part.lapsed.length) ? (
    <Panel id="instruments" title={t(lang, "org.instruments")} count={fmtInt(part.n, lang)}
      foot={<a href="/instruments">{t(lang, "instrument.back")}</a>}>
      {part.rows.length ? <HeldTable lang={lang} rows={part.rows} today={today} /> : <p class="muted">{t(lang, "org.instruments_none")}</p>}
      {part.lapsed.length ? (
        <>
          <h3>{t(lang, "org.instruments_lapsed")}</h3>
          <HeldTable lang={lang} rows={part.lapsed} lapsed today={today} />
        </>
      ) : null}
    </Panel>
  ) : null;

// "Holders in this segment" and the buyer page's block: the organizations with
// the most active instruments, each with the count and the soonest expiry.
export const HoldersPanel: FC<{ lang: Lang; part: HoldersPart | null; kind: "segment" | "buyer"; filter: string }> = ({ lang, part, kind, filter }) =>
  part && part.rows.length ? (
    <Panel id="holders" title={t(lang, kind === "segment" ? "instruments.segment_heading" : "instruments.buyer_heading")}
      count={fmtInt(part.n, lang)} foot={<a href={`/instruments?${filter}`}>{t(lang, "instruments.list_link")}</a>}>
      <p class="muted small">{tn(lang, "instruments.holders_note_one", "instruments.holders_note_many", part.n, { n: fmtInt(part.n, lang), max: 25 })}</p>
      <div class="table-wrap bordered">
        <Table restack={false} class="compact" cols={[
          { kind: "main", label: t(lang, "col.supplier") },
          { kind: "count", label: t(lang, "instruments.col_active") },
          { kind: "date", label: t(lang, "instruments.soonest") },
        ]}>
          <tbody>
            {part.rows.map((r) => (
              <tr>
                <td data-label={t(lang, "col.supplier")}><a href={`/organizations/${r.id}#instruments`}>{r.name}</a></td>
                <td data-label={t(lang, "instruments.col_active")} class="mono num">{fmtInt(r.n, lang)}</td>
                <td data-label={t(lang, "instruments.soonest")} class="mono">{r.soonest ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Panel>
  ) : null;

// An RFSO or RFSA notice: the active instruments its solicitation issued, each with its current holders.
export const TenderInstrumentsPanel: FC<{ lang: Lang; rows: readonly TenderInstrument[] }> = ({ lang, rows }) =>
  rows.length ? (
    <Panel title={t(lang, "instruments.tender_heading")} count={fmtInt(rows.length, lang)}>
      <ul class="plain">
        {rows.map((r) => (
          <li>
            {tj(lang, "instruments.tender_line", {
              agreement: <a href={`${instrumentPath(r.agreement)}#holders`} class="mono">{r.agreement}</a>,
              n: fmtInt(r.n_holders, lang),
            })}
            {r.n_holders_withheld ? ` ${t(lang, "instruments.tender_withheld", { n: fmtInt(r.n_holders_withheld, lang) })}` : ""}
            {r.expiry ? ` ${t(lang, "instruments.tender_expiry", { date: r.expiry })}` : ""}
          </li>
        ))}
      </ul>
    </Panel>
  ) : null;
