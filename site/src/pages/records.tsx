// /organizations/:id/records and /buyers/:id/records: every record naming an
// organization or a buyer over ten fiscal years, from the records database
// (rec_details, src/records_tables.ts), newest first by default or by date or
// value either way (the Sort field, and the table's Date and Value heads), 50 to
// a page, filtered by fiscal year, the other party, source and method; the
// same query as CSV at <address>.csv. docs/analytics.md "Record tables".
//
// Once the accounts switch is on, the filters, the order, the later pages
// and the file are part of Pro (feature analytics for the table, and
// export_filtered for the file); a reader without them gets the newest 50
// records, one statement beside the state row, and the word on what Pro adds.
// While the switch is off every reader gets the whole table and no file.
// The pages are noindex; their links are nofollow.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { allowed } from "../account/entitlements";
import { railAccount } from "../account/session";
import { accountsEnabled } from "../account/switch";
import { type HeadSort, type SortOrders, Table, headSort } from "../columns";
import { MONEY_SOURCES, type MoneySource } from "../constants";
import { BUYER_ID_RE, ORG_ID_RE, loadBuyer, loadBuyerAlias, loadProfile, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, sourceLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import { CompetitiveFlag, Layout, PageHead, Panel, lowerRedirect, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { requestPlan } from "../plan";
import { ProNote } from "../pro";
import { MAX_YEARS, SOURCE_NUMBER, dollars, fiscalLabel, fiscalYearOf, num, orgIdOf, orgNumber } from "../records_db";
import {
  RECORDS_CSV_MAX, RECORDS_PAGE_ROWS, type RecordsParams, type RecordsSort, type RecordsView, type Row, readRecordCsv, readRecordTable,
} from "../records_tables";
import { csvCell } from "./analytics";
import { BuyerLink, contractPath, grantUrl, money } from "./shared";

const METHODS = ["OB", "TC", "ST", "TN", "AC"] as const;
type Method = (typeof METHODS)[number];
const METHOD_NAME: Record<(typeof METHODS)[number], Key> = {
  OB: "method.open", TC: "method.traditional", ST: "method.selective", TN: "method.non_competitive", AC: "method.acan",
};
const SOURCE_OF: Record<number, MoneySource> = { 1: "awards", 2: "history", 3: "contracts", 4: "grants" };

// The orders a record table offers, the table's Date and Value heads set
// them too; "" (no order asked) is the newest first, the table's own.
export const RECORDS_ORDERS = [
  ["oldest", "date", "asc"], ["newest", "date", "desc"], ["smallest", "value", "asc"], ["largest", "value", "desc"],
] as const satisfies SortOrders;

export interface RecordsQuery { year: number | null; source: MoneySource | ""; method: string; party: string; sort: "" | RecordsSort; page: number }

// A value the table cannot use reads as no filter; a page that is not a whole number from 1 reads as null (a 404).
export function readRecordsQuery(url: URL, view: RecordsView, lastFy: number): RecordsQuery & { badPage: boolean } {
  const get = (k: string) => (url.searchParams.get(k) ?? "").trim();
  const year = /^\d{4}$/.test(get("year")) ? Number(get("year")) : null;
  const source = get("source").toLowerCase();
  const method = get("method").toUpperCase();
  const party = get(view === "organization" ? "buyer" : "organization").toLowerCase();
  const rawPage = get("page");
  const page = rawPage === "" ? 1 : /^[1-9]\d{0,4}$/.test(rawPage) ? Number(rawPage) : 0;
  return {
    year: year !== null && year <= lastFy && year > lastFy - MAX_YEARS ? year : null,
    source: (MONEY_SOURCES as readonly string[]).includes(source) ? (source as MoneySource) : "",
    method: (METHODS as readonly string[]).includes(method) ? method : "",
    party: view === "organization" ? (BUYER_ID_RE.test(party) && party.length <= 80 ? party : "") : ORG_ID_RE.test(party) ? party : "",
    sort: RECORDS_ORDERS.find((o) => o[0] === get("sort"))?.[0] ?? "",
    page: page || 1,
    badPage: page === 0,
  };
}

export function recordsQueryString(view: RecordsView, q: RecordsQuery, pageNo = 1): string {
  const p = new URLSearchParams();
  if (q.year !== null) p.set("year", String(q.year));
  if (q.party) p.set(view === "organization" ? "buyer" : "organization", q.party);
  if (q.source) p.set("source", q.source);
  if (q.method) p.set("method", q.method);
  if (q.sort) p.set("sort", q.sort);
  if (pageNo > 1) p.set("page", String(pageNo));
  const s = p.toString();
  return s ? `?${s}` : "";
}

// The site's page of a record, or the government's for a grant; null when
// the record has none. ref is rec_details.ref: an award or history reference
// in its URL form, or ":<reference>" when another reference took that form
// first (records_db.text_rows), so the row never links the other record's
// page; "<department>:<reference>" otherwise.
export function recordHref(src: number, ref: string): string | null {
  const at = ref.indexOf(":");
  if (src === 1 || src === 2) return ref && at < 0 ? `/${src === 1 ? "awards" : "history"}/${ref.toLowerCase()}` : null;
  if (at <= 0) return null;
  const dept = ref.slice(0, at);
  const reference = ref.slice(at + 1);
  return src === 3 ? contractPath(dept, reference) : grantUrl(dept, reference);
}

// The reference as the reader knows it: what follows the department, or
// the empty place of one; a URL form holds no colon.
export const shownReference = (ref: string): string => (ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref);

// A record's title, else its reference, else "Not stated".
export const recordTitle = (lang: Lang, r: Row, ref: string): string =>
  pick(lang, str(r.title_en), str(r.title_fr)) ?? (shownReference(ref) || t(lang, "common.not_stated"));

type Access = "full" | "first";

async function access(c: Context<AppEnv>): Promise<{ table: Access; csv: boolean }> {
  if (!accountsEnabled(c.env)) return { table: "full", csv: false };
  const plan = await requestPlan(c);
  return { table: allowed({ plan }, "analytics") ? "full" : "first", csv: allowed({ plan }, "export_filtered") };
}

type Entity = { view: RecordsView; id: string; name: string; key: string | number; base: string; back: string };

// The organization or buyer the address names, or the response for one that names none.
async function entity(c: Context<AppEnv>, view: RecordsView, stats: { data_as_of: string | null }, suffix: string): Promise<Entity | Response> {
  const lang = c.get("lang");
  const raw = c.req.param("id") ?? "";
  const id = raw.toLowerCase();
  if (view === "organization") {
    const oid = orgNumber(id);
    if (oid === null) return c.notFound();
    const redirect = lowerRedirect(c, `/organizations/${id}${suffix}`);
    if (redirect) return redirect;
    const profile = await loadProfile(c.env, id);
    if (!profile) return c.notFound();
    return { view, id, name: profile.organization.display_name, key: oid, base: `/organizations/${id}/records`, back: `/organizations/${id}` };
  }
  if (!BUYER_ID_RE.test(id) || id.length > 80) return c.notFound();
  const redirect = lowerRedirect(c, `/buyers/${id}${suffix}`);
  if (redirect) return redirect;
  const b = await loadBuyer(c.env, id);
  if (b) return { view, id, name: pick(lang, b.buyer.name_en, b.buyer.name_fr) ?? id, key: id, base: `/buyers/${id}/records`, back: `/buyers/${id}` };
  const moved = await loadBuyerAlias(c.env, id);
  if (moved) {
    c.header("Cache-Control", "public, max-age=300");
    return c.redirect(`/buyers/${moved}${suffix}${new URL(c.req.url).search}`, 301);
  }
  return notFoundPage(c, stats.data_as_of, "buyer.not_found", "/buyers", "buyer.back");
}

function params(e: Entity, q: RecordsQuery, lastFy: number): RecordsParams {
  const firstFy = q.year ?? lastFy - MAX_YEARS + 1;
  const endFy = q.year ?? lastFy;
  return {
    key: e.key, first: `${firstFy}-04-01`, last: `${endFy + 1}-03-31`, src: q.source ? SOURCE_NUMBER[q.source] : 0, meth: q.method,
    party: e.view === "organization" ? q.party : q.party ? orgNumber(q.party) ?? -1 : -1,
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

// The table is one page of a longer list, so the server orders it: the date
// and value heads link their orders (sorts), and a free reader, whose view
// keeps the newest first, gets plain heads.
const RecordRows: FC<{ lang: Lang; view: RecordsView; rows: Row[]; sorts?: { date: HeadSort; value: HeadSort } }> = ({ lang, view, rows, sorts }) => (
  <div class="table-wrap bordered">
    <Table sorting="server" cols={[
      { kind: "date", label: t(lang, "col.date"), sort: sorts?.date },
      { kind: "main", label: t(lang, "col.record") },
      { kind: view === "organization" ? "buyer" : "org", label: t(lang, view === "organization" ? "col.buyer" : "col.supplier") },
      { kind: "value", label: t(lang, "col.value"), sort: sorts?.value },
      { kind: "comp", label: t(lang, "col.method") },
    ]}>
      <tbody>
        {rows.map((r) => {
          const src = num(r.src) ?? 0;
          const ref = String(r.ref ?? "");
          const href = recordHref(src, ref);
          const title = recordTitle(lang, r, ref);
          const oid = num(r.oid);
          const cents = dollars(r.cents);
          return (
            <tr>
              <td data-label={t(lang, "col.date")} class="mono">{str(r.day) ?? ""}</td>
              <td data-label={t(lang, "col.record")} class="lead-cell">
                {href ? <a href={href} rel={src === 4 ? "nofollow noopener" : "nofollow"}>{title}</a> : title}
                <br />
                <span class="mono id muted">{shownReference(ref)}</span> <span class="muted small">{SOURCE_OF[src] ? sourceLabel(lang, SOURCE_OF[src]) : ""}</span>
              </td>
              {view === "organization" ? (
                <td data-label={t(lang, "col.buyer")}><BuyerLink lang={lang} id={str(r.buyer_id)} en={str(r.buyer_en)} fr={str(r.buyer_fr)} /></td>
              ) : (
                <td data-label={t(lang, "col.supplier")}>
                  {oid === null ? <span class="muted">{t(lang, "common.not_stated")}</span> : <a href={`/organizations/${orgIdOf(oid)}`}>{str(r.org_name) ?? orgIdOf(oid)}</a>}
                </td>
              )}
              <td data-label={t(lang, "col.value")} class="mono num">{cents === null ? t(lang, "common.not_stated") : money(lang, cents)}</td>
              <td data-label={t(lang, "col.method")}>
                {src === 4 ? "" : <CompetitiveFlag lang={lang} value={num(r.comp) as 0 | 1 | null} />}
                {/* A published contract's procedure is a code (TN, OB, ...): its name, with the code as the title; other sources' methods are words already. */}
                {str(r.meth) ? <> <span class={METHOD_NAME[str(r.meth) as Method] ? "muted small" : "mono muted small"} title={METHOD_NAME[str(r.meth) as Method] ? str(r.meth) ?? undefined : undefined}>{METHOD_NAME[str(r.meth) as Method] ? t(lang, METHOD_NAME[str(r.meth) as Method]) : str(r.meth)}</span></> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  </div>
);

async function recordsPage(c: Context<AppEnv>, view: RecordsView): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "records.title");
  const e = await entity(c, view, stats, "/records");
  if (e instanceof Response) return e;
  const lastFy = fiscalYearOf(todayOf(stats.data_as_of));
  const url = new URL(c.req.url);
  const q = readRecordsQuery(url, view, lastFy);
  const a = await access(c);
  const free = a.table === "first";
  const asked = recordsQueryString(view, q) !== "";
  if (q.badPage || (free && q.page > 1)) return c.notFound();
  // A free reader's view is the newest page with no filter: one statement beside the state row.
  const read = free
    ? await readRecordTable(c.env, view, params(e, { ...q, year: null, source: "", method: "", party: "" }, lastFy), "newest", 0, false)
    : await readRecordTable(c.env, view, params(e, q, lastFy), q.sort || "newest", (q.page - 1) * RECORDS_PAGE_ROWS, true);
  const partyRows: Row[] = read.state === "ready" && !free ? read.rows[2] ?? [] : [];
  const ok = read.state === "ready";
  const rows = ok ? read.rows[0] ?? [] : [];
  const total = ok && !free ? read.rows[1]?.[0] ?? {} : {};
  const n = num(total.n);
  const pages = n === null ? 1 : Math.max(1, Math.ceil(n / RECORDS_PAGE_ROWS));
  if (ok && !free && q.page > pages) return c.notFound();
  const account = free ? await railAccount(c).catch(() => undefined) : undefined;
  const title = t(lang, "records.title_of", { name: e.name });
  const crumbs = [
    { name: t(lang, "common.home"), path: "/" },
    { name: t(lang, view === "organization" ? "nav.organizations" : "nav.buyers"), path: view === "organization" ? "/organizations" : "/buyers" },
    { name: e.name, path: e.back },
    { name: t(lang, "records.crumb") },
  ];
  const prev = !free && q.page > 1 ? `${e.base}${recordsQueryString(view, q, q.page - 1)}` : null;
  const next = !free && q.page < pages ? `${e.base}${recordsQueryString(view, q, q.page + 1)}` : null;
  // The heads' links, each to the same filters in its next order, from the first page; none in the free view.
  const sortHref = (v: string) => `${e.base}${recordsQueryString(view, { ...q, sort: v as RecordsQuery["sort"] })}`;
  const sorts = free ? undefined : {
    date: headSort(RECORDS_ORDERS, q.sort, "date", sortHref), value: headSort(RECORDS_ORDERS, q.sort, "value", sortHref),
  };
  const years = Array.from({ length: MAX_YEARS }, (_, i) => lastFy - i);
  const parties = partyRows.map((r) => view === "organization"
    ? { value: String(r.id), label: pick(lang, str(r.name_en), str(r.name_fr)) ?? String(r.id) }
    : { value: orgIdOf(num(r.oid) ?? 0), label: str(r.name) ?? orgIdOf(num(r.oid) ?? 0) });
  if (q.party && !parties.some((o) => o.value === q.party)) parties.push({ value: q.party, label: q.party });
  if (!ok) c.header("Retry-After", "3600");

  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of}
      seo={{ path: e.base, description: t(lang, `records.description_${view}` as Key, { name: e.name }), noindex: true }}>
      <PageHead lang={lang} crumbs={crumbs} eyebrow={t(lang, "records.eyebrow")} title={e.name}
        // Each fiscal year on one line: the browser would break "2026-27" at its hyphen.
        lead={tj(lang, `records.lead_${view}` as Key, {
          first: <span class="nw">{fiscalLabel(lang, lastFy - MAX_YEARS + 1)}</span>, last: <span class="nw">{fiscalLabel(lang, lastFy)}</span>,
        })}
        actions={<a href={e.back} class="btn">{t(lang, view === "organization" ? "records.back_organization" : "records.back_buyer")}</a>} />
      {!ok ? (
        <Panel title={t(lang, "records.unavailable_title")}>
          <p>{t(lang, read.state === "loading" ? "records.unavailable_loading" : "analytics.unavailable_text")}</p>
          <p><a href={e.back}>{t(lang, view === "organization" ? "records.back_organization" : "records.back_buyer")}</a></p>
        </Panel>
      ) : (
        <>
          {free ? null : (
            <form method="get" action={e.base} class="toolbar">
              <div class="toolbar-fields">
                <label class="field"><span class="field-label">{t(lang, "records.year")}</span>
                  <select name="year">
                    <option value="">{t(lang, "records.year_all", { n: MAX_YEARS })}</option>
                    {years.map((y) => <option value={String(y)} selected={q.year === y}>{fiscalLabel(lang, y)}</option>)}
                  </select>
                </label>
                <label class="field"><span class="field-label">{t(lang, view === "organization" ? "col.buyer" : "col.supplier")}</span>
                  <select name={view === "organization" ? "buyer" : "organization"}>
                    <option value="">{t(lang, "tenders.any")}</option>
                    {parties.map((o) => <option value={o.value} selected={o.value === q.party}>{o.label}</option>)}
                  </select>
                </label>
                <label class="field"><span class="field-label">{t(lang, "col.source")}</span>
                  <select name="source">
                    <option value="">{t(lang, "tenders.any_f")}</option>
                    {MONEY_SOURCES.map((s) => <option value={s} selected={q.source === s}>{sourceLabel(lang, s)}</option>)}
                  </select>
                </label>
                <label class="field"><span class="field-label">{t(lang, "col.method")}</span>
                  <select name="method">
                    <option value="">{t(lang, "tenders.any_f")}</option>
                    {METHODS.map((m) => <option value={m} selected={q.method === m}>{`${m} ${t(lang, METHOD_NAME[m])}`}</option>)}
                  </select>
                </label>
                <label class="field"><span class="field-label">{t(lang, "tenders.sort")}</span>
                  {/* "newest", set from the head, is the table's own order and reads as it here. */}
                  <select name="sort">
                    <option value="">{t(lang, "records.sort_newest")}</option>
                    <option value="oldest" selected={q.sort === "oldest"}>{t(lang, "records.sort_oldest")}</option>
                    <option value="largest" selected={q.sort === "largest"}>{t(lang, "expiring.sort_value")}</option>
                    <option value="smallest" selected={q.sort === "smallest"}>{t(lang, "expiring.sort_value_asc")}</option>
                  </select>
                </label>
                <div class="toolbar-actions">
                  <button type="submit" class="btn btn-primary">{t(lang, "tenders.apply")}</button>
                  <a href={e.base} class="btn">{t(lang, "tenders.reset")}</a>
                </div>
              </div>
            </form>
          )}
          <Panel title={t(lang, "records.heading")}
            count={n === null ? undefined : tn(lang, "records.count_one", "records.count_many", n, { n: fmtInt(n, lang) })}
            foot={free ? undefined : (
              <nav aria-label={t(lang, "common.pagination")} class="pagination">
                <span class="muted">{t(lang, "tenders.page_of", { page: fmtInt(q.page, lang), pages: fmtInt(pages, lang) })}</span>
                <span class="pages">
                  {prev ? <a href={prev} class="btn" rel="prev nofollow">{t(lang, "tenders.prev")}</a> : null}
                  {next ? <a href={next} class="btn" rel="next nofollow">{t(lang, "tenders.next")}</a> : null}
                </span>
              </nav>
            )}>
            {free ? (
              <ProNote lang={lang}>
                {asked ? `${t(lang, "records.free_asked")} ` : ""}{t(lang, "records.free_note", { n: RECORDS_PAGE_ROWS })}{" "}
                <a href={account?.email ? "/account/billing" : "/account/sign-in"}>{t(lang, account?.email ? "analytics.pro_billing" : "analytics.pro_sign_in")}</a>
              </ProNote>
            ) : (
              <p class="muted small">
                {n === null ? null : t(lang, "records.total", { total: money(lang, dollars(total.cents) ?? 0) })}{" "}
                {a.csv && n ? <a href={`${e.base}.csv${recordsQueryString(view, q)}`} rel="nofollow">{t(lang, "records.csv")}</a> : null}
                {a.csv && n !== null && n > RECORDS_CSV_MAX ? <> {t(lang, "expiring.csv_cut", { n: fmtInt(RECORDS_CSV_MAX, lang) })}</> : null}
                {!a.csv && accountsEnabled(c.env) && n ? <ProNote lang={lang}>{t(lang, "records.csv_pro")}</ProNote> : null}
              </p>
            )}
            {rows.length ? <RecordRows lang={lang} view={view} rows={rows} sorts={sorts} /> : <p class="muted">{t(lang, "records.none")}</p>}
          </Panel>
          <p class="muted small">{t(lang, "records.note", { as_of: read.state === "ready" && read.asOf ? read.asOf : t(lang, "common.na") })}</p>
        </>
      )}
    </Layout>,
    ok ? 200 : 503,
  );
}

export const organizationRecords = (c: Context<AppEnv>) => recordsPage(c, "organization");
export const buyerRecords = (c: Context<AppEnv>) => recordsPage(c, "buyer");

// The file: Pro's (export_filtered) once the accounts switch is on, the site's 404 otherwise.
export const RECORDS_CSV_COLUMNS = ["date", "source", "reference", "title_en", "title_fr", "buyer_id", "buyer", "organization_id", "organization", "value_cad", "value_note", "competitive", "method"] as const;
const VALUE_NOTE: Record<number, string> = { 0: "", 1: "not published", 2: "another currency", 3: "flagged" };

async function recordsCsv(c: Context<AppEnv>, view: RecordsView): Promise<Response> {
  const a = await access(c);
  if (!a.csv) return c.notFound();
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "records.title");
  const e = await entity(c, view, stats, "/records.csv");
  if (e instanceof Response) return e;
  const lastFy = fiscalYearOf(todayOf(stats.data_as_of));
  const q = readRecordsQuery(new URL(c.req.url), view, lastFy);
  const read = await readRecordCsv(c.env, view, params(e, q, lastFy), q.sort || "newest");
  if (read.state !== "ready") {
    c.header("Retry-After", "3600");
    c.header("Cache-Control", "no-store");
    return c.text(t(lang, read.state === "loading" ? "records.unavailable_loading" : "analytics.unavailable_text"), 503);
  }
  const lines = (read.rows[0] ?? []).map((r) => {
    const src = num(r.src) ?? 0;
    const oid = num(r.oid);
    const cents = num(r.cents);
    return [
      r.day, SOURCE_OF[src] ?? "", shownReference(String(r.ref ?? "")), r.title_en, r.title_fr, r.buyer_id, r.buyer_en,
      oid === null ? null : orgIdOf(oid), r.org_name, cents === null ? null : (cents / 100).toFixed(2), VALUE_NOTE[num(r.vnote) ?? 0] ?? "",
      num(r.comp), r.meth,
    ].map(csvCell).join(",");
  });
  const body = [RECORDS_CSV_COLUMNS.join(","), ...lines].join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${e.id}-records.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const organizationRecordsCsv = (c: Context<AppEnv>) => recordsCsv(c, "organization");
export const buyerRecordsCsv = (c: Context<AppEnv>) => recordsCsv(c, "buyer");
