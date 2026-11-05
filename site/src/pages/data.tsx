import type { Context } from "hono";
import { accountsEnabled } from "../account/switch";
import { HowToCite } from "../cite";
import { Table } from "../columns";
import { FIRST_AWARD_YEAR } from "../constants";
import { loadStats, type Stats } from "../data";
import type { AppEnv } from "../env";
import { decimal, fmtInt, t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, noDataPage, page, todayOf } from "../layout";
import { allowsRadarDepth, requestPlan } from "../plan";
import { ProNote, ProTag } from "../pro";
import { type DataSet, ODLA_URL, OGL_URL, datasetJsonLd, pageSeo } from "../seo";
import { KeyedApiDocs } from "./keyed_api";
import { datasetUrl } from "./shared";

// The changelog of anything that changes how a figure is computed, newest
// first whatever order the entries are written in. Empty until the first
// such change after launch; add an entry here and the table sorts by date.
export type ChangeRow = { date: string; change: Key; recomputed: Key; vars?: Record<string, string | number> };
export const CHANGELOG: readonly ChangeRow[] = [];

export function changelog(): ChangeRow[] {
  return [...CHANGELOG].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// "2026-10-20T02:46:39Z" -> "2026-10-20 02:46 UTC" ("02 h 46" in French); anything else as given.
export function runTime(iso: string | null | undefined, lang: Lang): string {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(iso ?? "");
  return m ? t(lang, "data.run_time", { date: m[1], hh: m[2], mm: m[3] }) : (iso ?? "");
}

// The publisher's date as an ISO day (2026-11-01). Exports have written the
// publisher's Last-Modified header as sent ("Sun, 01 Nov 2026 17:15:06 GMT")
// and may write an ISO date or instant; Date reads either. Null for a value
// it cannot read.
export function publisherDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

// A file's size as a reader reads it: bytes below a kilobyte, whole
// kilobytes below a megabyte, then megabytes and gigabytes to one decimal.
export function fileSize(lang: Lang, bytes: number): string {
  const one = (n: number) => decimal(lang, (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, ""));
  if (bytes < 1024) return t(lang, "data.size_b", { n: fmtInt(bytes, lang) });
  if (bytes < 1024 ** 2) return t(lang, "data.size_kb", { n: fmtInt(Math.max(1, Math.round(bytes / 1024)), lang) });
  if (bytes < 1024 ** 3) return t(lang, "data.size_mb", { n: one(bytes / 1024 ** 2) });
  return t(lang, "data.size_gb", { n: one(bytes / 1024 ** 3) });
}

// The export's list of downloads with their sizes and rows, by file name;
// empty for an older export without it, and the columns then show nothing.
export function downloadSizes(stats: Stats): Map<string, { bytes: number; rows: number | null }> {
  const list = Array.isArray(stats.downloads) ? stats.downloads : [];
  return new Map(list
    .filter((d) => d && typeof d.file === "string" && typeof d.bytes === "number" && (d.rows === null || typeof d.rows === "number"))
    .map((d) => [d.file, { bytes: d.bytes, rows: d.rows }]));
}

// The fixed CSV files in R2 (downloads/<file>), the only names the download
// route serves besides the yearly files below. All of them are derived from
// Open Government Licence material and carry that licence. note: a line
// under the contents. paid: part of Pro once the accounts switch is on
// (index.tsx serves the 12-month radar file by that rule), so the dataset
// metadata for search engines leaves it out and a crawler never meets the gate.
export const DOWNLOADS: { file: string; contents: Key; note?: Key; paid?: boolean }[] = [
  { file: "open-tenders.csv", contents: "data.file.open_tenders" },
  { file: "organizations.csv", contents: "data.file.organizations" },
  { file: "buyers.csv", contents: "data.file.buyers" },
  { file: "expiring-3m.csv", contents: "data.file.expiring_3m" },
  { file: "expiring-12m.csv", contents: "data.file.expiring", note: "data.file.pro", paid: true },
  { file: "SHA256SUMS", contents: "data.file.sums" },
];
// One file per calendar year of award notices, contract history, published
// contracts and grants; one each for the dates before a source's first year
// and after the data date's year, and for the rows whose date gives no year
// (undated); and the numbered parts (-2 to -9) a year past 250 MiB goes on
// in, as the pipeline writes them (export.py YEAR_RE and FIRST_YEAR): the
// page offers every name SHA256SUMS can list.
export const YEARLY_DOWNLOAD = /^(awards|history|contracts|grants)-(?:[0-9]{4}|before-[0-9]{4}|after-[0-9]{4}|undated)(?:-[2-9])?\.csv$/;
export const FIRST_HISTORY_YEAR = 2009;
// The years their proactive publication began; an earlier date is a record reported later.
export const FIRST_CONTRACT_YEAR = 2004;
export const FIRST_GRANT_YEAR = 2005;
export const YEARLY_SOURCES = ["awards", "history", "contracts", "grants"] as const;

// A yearly file's numbered parts, in order, among the export's files: a year
// past the size cap goes on in <name>-2.csv, -3 and on.
export function fileParts(file: string, files: Iterable<string>): string[] {
  const stem = file.replace(/\.csv$/, "");
  const parts: [number, string][] = [];
  for (const f of files) {
    const m = /^(.*)-([2-9])\.csv$/.exec(f);
    if (m && m[1] === stem) parts.push([Number(m[2]), f]);
  }
  return parts.sort((a, b) => a[0] - b[0]).map(([, f]) => f);
}

// The licence table: what each source supplies and the terms it carries.
// The Registry of Lobbyists' data comes under the Commissioner's own licence.
export const LICENCE_ROWS: readonly { material: Key; terms: Key; url?: string }[] = [
  { material: "data.lic.canadabuys", terms: "data.lic.ogl_terms" },
  { material: "data.lic.proactive", terms: "data.lic.ogl_terms" },
  { material: "data.lic.lobbying", terms: "data.lic.odla_terms", url: ODLA_URL },
  { material: "data.lic.organizations", terms: "data.lic.ogl_terms" },
  { material: "data.lic.corporations", terms: "data.lic.ogl_terms" },
  { material: "data.lic.computed", terms: "data.lic.computed_terms" },
];

// The sources the pipeline reads, in the order of its stages. `key` matches
// the `source` of the rows in stats.json "sources", which say when each file
// was last read and the Last-Modified date the publisher gave it.
export const SOURCE_ROWS: readonly { key: string; name: Key; publisher: Key; files: string; url: (lang: Lang) => string; odla?: boolean }[] = [
  { key: "buyers", name: "data.src.buyers", publisher: "data.pub.tbs", files: "organization_show", url: (lang) => `https://open.canada.ca/data/${lang}/organization` },
  { key: "tenders", name: "data.src.tenders", publisher: "data.pub.pspc", files: "newTenderNotice, openTenderNotice, tenderNoticeComplete", url: (lang) => datasetUrl("tenders", lang) },
  { key: "awards", name: "data.src.awards", publisher: "data.pub.pspc", files: "awardNotice, awardNoticeComplete, awardNoticeHistorical", url: (lang) => datasetUrl("awards", lang) },
  { key: "history", name: "data.src.history", publisher: "data.pub.pspc", files: "contractHistory, contractHistoryComplete, contractHistoryHistorical", url: (lang) => datasetUrl("history", lang) },
  { key: "contracts", name: "data.src.contracts", publisher: "data.pub.tbs", files: "contracts.csv", url: (lang) => datasetUrl("contracts", lang) },
  { key: "grants", name: "data.src.grants", publisher: "data.pub.tbs", files: "grants.csv", url: (lang) => datasetUrl("grants", lang) },
  { key: "lobbying", name: "data.src.lobbying", publisher: "data.pub.ocl", files: "communications_ocl_cal.zip", url: (lang) => datasetUrl("lobbying", lang), odla: true },
  { key: "registry", name: "data.src.registry", publisher: "data.pub.ised", files: "federal corporations extract", url: (lang) => `https://open.canada.ca/data/${lang}/dataset/0032ce54-c5dd-4b66-99a0-320a7b5e99f2` },
];

const API_ROWS: [string, Key][] = [
  ["GET /api/stats", "data.api.stats"],
  ["GET /api/organizations/{id}", "data.api.organization"],
  ["GET /api/tenders/{reference}", "data.api.tender"],
  ["GET /api/buyers/{id}", "data.api.buyer"],
  ["GET /api/categories/{nn}", "data.api.category"],
  ["GET /data/tenders/open.json", "data.api.open"],
];

function filesRead(stats: Stats, key: string): Stats["sources"] {
  return stats.sources.filter((s) => s.source === key);
}

// A dataset's one "last read": the newest read of its files, with the
// publisher's newest date; null when no file of it was ever read.
export function lastRead(rows: Stats["sources"]): { read: string; modified: string | null } | null {
  const read = rows.filter((r) => r.last_read && r.loaded !== false);
  if (!read.length) return null;
  const newest = read.reduce((a, b) => ((b.last_read ?? "") > (a.last_read ?? "") ? b : a));
  const days = read.map((r) => publisherDay(r.last_modified)).filter((d): d is string => d !== null).sort();
  return { read: newest.last_read ?? "", modified: days.length ? days[days.length - 1] : null };
}

export async function dataPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "data.title");
  const lastYear = Number(todayOf(stats.data_as_of).slice(0, 4));
  const years = (from: number) => Array.from({ length: lastYear - from + 1 }, (_, i) => lastYear - i);
  const sizes = downloadSizes(stats);
  const sizeOf = (file: string) => sizes.get(file);
  // Each file a yearly list names, then its numbered parts when the export wrote any.
  const withParts = (files: readonly string[]) => files.flatMap((f) => [f, ...fileParts(f, sizes.keys())]);
  const firstYear = { awards: FIRST_AWARD_YEAR, history: FIRST_HISTORY_YEAR, contracts: FIRST_CONTRACT_YEAR, grants: FIRST_GRANT_YEAR };
  // The dataset metadata names the free files only, each set with the
  // government dataset it is read from: the 3-month radar file stands where
  // the 12-month one would. A yearly set lists the files its list names.
  const src = (...sources: string[]) => sources.map((s) => datasetUrl(s, lang));
  const sets: DataSet[] = [
    { id: "open-tenders", files: ["open-tenders.csv"], basedOn: src("tenders") },
    ...YEARLY_SOURCES.map((s): DataSet => ({
      id: s, files: years(firstYear[s]).map((y) => `${s}-${y}.csv`), basedOn: src(s), from: firstYear[s],
    })),
    { id: "organizations", files: ["organizations.csv"], basedOn: src("awards", "history", "contracts", "grants", "lobbying") },
    { id: "buyers", files: ["buyers.csv"], basedOn: src("tenders", "awards", "history", "contracts", "grants") },
    { id: "expiring-3m", files: ["expiring-3m.csv"], basedOn: src("awards", "history", "contracts") },
  ];
  // The files outside the years: before and after for each source, and an
  // undated file only when the export lists one (it writes one only for a
  // source with such a row).
  const outside = YEARLY_SOURCES.flatMap((s) => [`${s}-before-${firstYear[s]}.csv`, `${s}-after-${lastYear}.csv`,
    ...(sizes.has(`${s}-undated.csv`) ? [`${s}-undated.csv`] : [])]);
  const yearly: [Key, (typeof YEARLY_SOURCES)[number]][] = [
    ["data.yearly_awards", "awards"], ["data.yearly_history", "history"],
    ["data.yearly_contracts", "contracts"], ["data.yearly_grants", "grants"],
  ];
  // A yearly file's size and rows ride on its link's title.
  const sizeTitle = (file: string) => {
    const s = sizeOf(file);
    if (!s) return undefined;
    return s.rows === null ? fileSize(lang, s.bytes) : t(lang, "data.size_rows", { size: fileSize(lang, s.bytes), n: fmtInt(s.rows, lang) });
  };
  const changes = changelog();
  // While the switch is on, the 12-month file's row and the line on API keys
  // carry the Pro chip, and a reader without the radar's depth follows the
  // file's name to the 12-month list's free view rather than to the file's
  // 404 (the file's own address still answers 404 to such a request).
  const pro = accountsEnabled(c.env);
  const deepFile = pro && allowsRadarDepth(await requestPlan(c));
  const fileHref = (d: (typeof DOWNLOADS)[number]) => (d.paid && pro && !deepFile ? "/expiring/12m" : `/downloads/${d.file}`);
  const toc: [string, Key][] = [
    ["sources", "data.toc_sources"],
    ["downloads", "data.toc_downloads"],
    ["api", "data.toc_api"],
    ["licence", "data.toc_licence"],
    ["runs", "data.toc_runs"],
    ["changes", "data.toc_changes"],
    ["views", "data.toc_views"],
  ];

  return page(
    c,
    <Layout lang={lang} title={t(lang, "data.title")} dataAsOf={stats.data_as_of} active="/data"
      seo={pageSeo("data", lang, { jsonLd: [datasetJsonLd(sets, stats.data_as_of, lang)] })}>
      <PageHead lang={lang} title={t(lang, "data.title")} lead={t(lang, "data.lead")} />
      <div class="doc-layout">
        <nav class="toc" aria-label={t(lang, "toc.label")}>
          <span class="toc-title">{t(lang, "toc.title")}</span>
          {toc.map(([id, key]) => <a href={`#${id}`}>{t(lang, key)}</a>)}
        </nav>
        <div class="doc">

          <h2 id="sources">{t(lang, "data.toc_sources")}</h2>
          <p>{t(lang, "data.sources_text")}</p>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "main", label: t(lang, "data.col_source") },
              { kind: "buyer", label: t(lang, "data.col_publisher") },
              { kind: "text", label: t(lang, "data.col_files"), rest: "md" },
              { kind: "datetime", label: t(lang, "data.col_last_read") },
            ]}>
              <tbody>
                {SOURCE_ROWS.map((s) => {
                  const last = lastRead(filesRead(stats, s.key));
                  return (
                    <tr>
                      <td data-label={t(lang, "data.col_source")}>
                        <a href={s.url(lang)}>{t(lang, s.name)}</a>
                        {/* The licence table below covers the terms; the one source under its own licence says so here. */}
                        {s.odla ? <span class="nw-block small"><a href={ODLA_URL}>{t(lang, "data.odla")}</a></span> : null}
                      </td>
                      <td data-label={t(lang, "data.col_publisher")}>{t(lang, s.publisher)}</td>
                      <td data-label={t(lang, "data.col_files")} class="small mdh">{s.files}</td>
                      <td data-label={t(lang, "data.col_last_read")} class="mono">
                        {last ? (
                          <>
                            {runTime(last.read, lang)}
                            {last.modified ? <span class="nw-block muted small">{t(lang, "data.modified", { date: last.modified })}</span> : null}
                          </>
                        ) : <span class="muted">{t(lang, "data.not_read")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <p class="muted small">{tj(lang, "data.sources_runs", { runs: <a href="#files">{t(lang, "data.files_read")}</a> })}</p>

          <h2 id="downloads">{t(lang, "data.toc_downloads")}</h2>
          <p>{t(lang, "data.downloads_text")}</p>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "file", label: t(lang, "data.col_file") },
              { kind: "main", label: t(lang, "data.col_contents") },
              sizes.size > 0 && { kind: "count", label: t(lang, "data.col_size") },
              sizes.size > 0 && { kind: "count", label: t(lang, "data.col_rows") },
            ]}>
              <tbody>
                {DOWNLOADS.map((d) => {
                  const size = sizeOf(d.file);
                  return (
                    <tr>
                      <td data-label={t(lang, "data.col_file")}><a href={fileHref(d)} class="mono">{d.file}</a></td>
                      <td data-label={t(lang, "data.col_contents")}>
                        {t(lang, d.contents)}
                        {d.paid && pro ? <>{" "}<ProTag lang={lang} /><br /><span class="muted small">{t(lang, "data.file.pro_on")}</span></> : null}
                        {d.note && !(d.paid && pro) ? <><br /><span class="muted small">{t(lang, d.note)}</span></> : null}
                      </td>
                      {sizes.size > 0 ? <td data-label={t(lang, "data.col_size")} class="mono num">{size ? fileSize(lang, size.bytes) : ""}</td> : null}
                      {sizes.size > 0 ? (
                        <td data-label={t(lang, "data.col_rows")} class="mono num">{size && size.rows !== null ? fmtInt(size.rows, lang) : ""}</td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          {sizes.size > 0 ? <p class="muted small">{t(lang, "data.sizes_note")}</p> : null}
          {yearly.map(([heading, source]) => (
            <>
              <h3>{t(lang, heading)}</h3>
              <ul class="quick-links">
                {withParts(years(firstYear[source]).map((y) => `${source}-${y}.csv`)).map((f) => (
                  <li><a class="mono" href={`/downloads/${f}`} title={sizeTitle(f)}>{f}</a></li>
                ))}
              </ul>
            </>
          ))}
          <h3>{t(lang, "data.yearly_outside")}</h3>
          <ul class="quick-links">
            {withParts(outside).map((f) => <li><a class="mono" href={`/downloads/${f}`} title={sizeTitle(f)}>{f}</a></li>)}
          </ul>
          {/* A div carries the gap: ".doc p" sets every paragraph's margin and outranks
              .top-gap. The file endings stay whole; a browser breaks "-undated" after its hyphen. */}
          <div class="top-gap">
            <p class="muted small">{tj(lang, "data.downloads_note", { undated: <span class="nw">-undated</span>, parts: <span class="nw">-2, -3</span> })}</p>
          </div>
          <p class="muted small">{t(lang, "data.downloads_closing")}</p>

          <h2 id="api">{t(lang, "data.toc_api")}</h2>
          <p>{t(lang, "data.api_text")}</p>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "file", label: t(lang, "data.col_endpoint") },
              { kind: "main", label: t(lang, "data.col_contents") },
            ]}>
              <tbody>
                {API_ROWS.map(([endpoint, key]) => (
                  <tr>
                    <td data-label={t(lang, "data.col_endpoint")} class="mono">{endpoint}</td>
                    <td data-label={t(lang, "data.col_contents")}>{t(lang, key)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p class="muted small">{t(lang, "data.api_limits")}</p>
          {pro ? (
            <ProNote lang={lang}>{tj(lang, "data.api_keys", { keys: <a href="/account/keys">{t(lang, "data.api_keys_link")}</a> })}</ProNote>
          ) : null}
          {pro ? <KeyedApiDocs lang={lang} /> : null}

          <h2 id="licence">{t(lang, "data.toc_licence")}</h2>
          <p>{tj(lang, "data.licence_text", { ogl: <a href={OGL_URL[lang]}>{t(lang, "data.ogl")}</a>, odla: <a href={ODLA_URL}>{t(lang, "data.odla")}</a> })}</p>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "main", label: t(lang, "data.col_material") },
              { kind: "text", label: t(lang, "data.col_terms") },
            ]}>
              <tbody>
                {LICENCE_ROWS.map((r) => (
                  <tr>
                    <td data-label={t(lang, "data.col_material")}>{t(lang, r.material)}</td>
                    <td data-label={t(lang, "data.col_terms")}>{r.url ? <a href={r.url}>{t(lang, r.terms)}</a> : t(lang, r.terms)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p>{t(lang, "data.credit")}</p>
          <HowToCite lang={lang} citation={stats.citation} />

          <h2 id="runs">{t(lang, "data.toc_runs")}</h2>
          {stats.runs.length ? (
            <div class="table-wrap bordered">
              <Table cols={[
                { kind: "datetime", label: t(lang, "data.col_run") },
                { kind: "main", label: t(lang, "data.col_stage") },
                { kind: "count", label: t(lang, "data.col_new_rows") },
                { kind: "label", label: t(lang, "col.status") },
              ]}>
                <tbody>
                  {stats.runs.map((r) => (
                    <tr>
                      <td data-label={t(lang, "data.col_run")} class="mono">{runTime(r.run_at, lang)}</td>
                      <td data-label={t(lang, "data.col_stage")}>{r.source}</td>
                      <td data-label={t(lang, "data.col_new_rows")} class="mono num">{r.rows_new ?? ""}</td>
                      <td data-label={t(lang, "col.status")}>{r.ok ? t(lang, "data.run_ok") : t(lang, "data.run_failed")}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : <p class="muted">{t(lang, "data.runs_none")}</p>}

          <h3 id="files">{t(lang, "data.files_read")}</h3>
          {stats.sources.length ? (
            <div class="table-wrap bordered">
              <Table cols={[
                { kind: "file", label: t(lang, "data.col_file") },
                { kind: "main", label: t(lang, "data.col_source") },
                { kind: "datetime", label: t(lang, "data.col_last_read") },
                { kind: "date", label: t(lang, "data.col_publisher_date") },
              ]}>
                <tbody>
                  {stats.sources.map((r) => {
                    const row = SOURCE_ROWS.find((s) => s.key === r.source);
                    return (
                      <tr>
                        {/* A file name can run past its column ("openTenderNotice-ouvertAvisAppelOffres.csv"): it wraps. */}
                        <td data-label={t(lang, "data.col_file")} class="mono wrap">{r.file}</td>
                        <td data-label={t(lang, "data.col_source")}>{row ? t(lang, row.name) : r.source}</td>
                        <td data-label={t(lang, "data.col_last_read")} class="mono">
                          {r.last_read && r.loaded !== false ? runTime(r.last_read, lang) : <span class="muted">{t(lang, "data.not_read")}</span>}
                        </td>
                        <td data-label={t(lang, "data.col_publisher_date")} class="mono">{r.loaded !== false ? publisherDay(r.last_modified) ?? "" : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          ) : <p class="muted">{t(lang, "data.runs_none")}</p>}

          <h2 id="changes">{t(lang, "data.toc_changes")}</h2>
          <p>{t(lang, "data.changes_text")}</p>
          {changes.length ? (
            <div class="table-wrap bordered">
              <Table cols={[
                { kind: "date", label: t(lang, "col.date") },
                { kind: "main", label: t(lang, "data.col_change") },
                { kind: "text", label: t(lang, "data.col_recomputed") },
              ]}>
                <tbody>
                  {changes.map((r) => (
                    <tr>
                      <td data-label={t(lang, "col.date")} class="mono">{r.date}</td>
                      <td data-label={t(lang, "data.col_change")}>{t(lang, r.change, r.vars)}</td>
                      <td data-label={t(lang, "data.col_recomputed")}>{t(lang, r.recomputed, r.vars)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : <p class="muted">{t(lang, "data.changes_none")}</p>}

          <h2 id="views">{t(lang, "data.toc_views")}</h2>
          <p>{t(lang, "data.views_note")}</p>
        </div>
      </div>
    </Layout>,
  );
}
