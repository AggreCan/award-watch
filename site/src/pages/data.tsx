import type { Context } from "hono";
import { HowToCite } from "../cite";
import { Table } from "../columns";
import { FIRST_AWARD_YEAR } from "../constants";
import { loadStats, type Stats } from "../data";
import type { AppEnv } from "../env";
import { t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, noDataPage, page, todayOf } from "../layout";
import { ODLA_URL, OGL_URL, datasetJsonLd, pageSeo } from "../seo";
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

// The fixed CSV files in R2 (downloads/<file>), the only names the download
// route serves besides the yearly files below. All of them are derived from
// Open Government Licence material and carry that licence.
export const DOWNLOADS: { file: string; contents: Key }[] = [
  { file: "open-tenders.csv", contents: "data.file.open_tenders" },
  { file: "organizations.csv", contents: "data.file.organizations" },
  { file: "buyers.csv", contents: "data.file.buyers" },
  { file: "expiring-12m.csv", contents: "data.file.expiring" },
  { file: "SHA256SUMS", contents: "data.file.sums" },
];
// One file per calendar year of award notices and of contract history, and
// one each for the dates before the first year and after the data date's
// year (typing errors in the source), as the pipeline writes them: the page
// offers every name SHA256SUMS can list.
export const YEARLY_DOWNLOAD = /^(awards|history)-(?:[0-9]{4}|before-[0-9]{4}|after-[0-9]{4})\.csv$/;
export const FIRST_HISTORY_YEAR = 2009;

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

export async function dataPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "data.title");
  const lastYear = Number(todayOf(stats.data_as_of).slice(0, 4));
  const years = (from: number) => Array.from({ length: lastYear - from + 1 }, (_, i) => lastYear - i);
  const downloads = DOWNLOADS.map((d) => ({ file: d.file, contents: t(lang, d.contents) }));
  const changes = changelog();
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
      seo={pageSeo("data", lang, { jsonLd: [datasetJsonLd(downloads, stats.data_as_of, lang)] })}>
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
              { kind: "label", label: t(lang, "data.col_licence") },
              { kind: "text", label: t(lang, "data.col_last_read") },
            ]}>
              <tbody>
                {SOURCE_ROWS.map((s) => {
                  const read = filesRead(stats, s.key);
                  return (
                    <tr>
                      <td data-label={t(lang, "data.col_source")}><a href={s.url(lang)}>{t(lang, s.name)}</a></td>
                      <td data-label={t(lang, "data.col_publisher")}>{t(lang, s.publisher)}</td>
                      <td data-label={t(lang, "data.col_files")} class="small mdh">{s.files}</td>
                      <td data-label={t(lang, "data.col_licence")}>
                        {s.odla ? <a href={ODLA_URL}>{t(lang, "data.odla")}</a> : <a href={OGL_URL[lang]}>{t(lang, "data.ogl_short")}</a>}
                      </td>
                      <td data-label={t(lang, "data.col_last_read")} class="small">
                        {read.length ? read.map((r) => (
                          <span class="nw-block">
                            <span class="mono">{r.file}</span>{lang === "fr" ? "\u202f: " : ": "}
                            {r.last_read && r.loaded !== false ? runTime(r.last_read, lang) : t(lang, "data.not_read")}
                            {r.loaded !== false && publisherDay(r.last_modified)
                              ? <span class="muted"> {t(lang, "data.modified", { date: publisherDay(r.last_modified) ?? "" })}</span>
                              : null}
                          </span>
                        )) : <span class="muted">{t(lang, "data.not_read")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>

          <h2 id="downloads">{t(lang, "data.toc_downloads")}</h2>
          <p>{t(lang, "data.downloads_text")}</p>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "file", label: t(lang, "data.col_file") },
              { kind: "main", label: t(lang, "data.col_contents") },
            ]}>
              <tbody>
                {DOWNLOADS.map((d) => (
                  <tr>
                    <td data-label={t(lang, "data.col_file")}><a href={`/downloads/${d.file}`} class="mono">{d.file}</a></td>
                    <td data-label={t(lang, "data.col_contents")}>{t(lang, d.contents)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <h3>{t(lang, "data.yearly_awards")}</h3>
          <ul class="quick-links">
            {years(FIRST_AWARD_YEAR).map((y) => <li><a class="mono" href={`/downloads/awards-${y}.csv`}>{`awards-${y}.csv`}</a></li>)}
          </ul>
          <h3>{t(lang, "data.yearly_history")}</h3>
          <ul class="quick-links">
            {years(FIRST_HISTORY_YEAR).map((y) => <li><a class="mono" href={`/downloads/history-${y}.csv`}>{`history-${y}.csv`}</a></li>)}
          </ul>
          <h3>{t(lang, "data.yearly_other", { first: FIRST_AWARD_YEAR, last: lastYear })}</h3>
          <ul class="quick-links">
            {[`awards-before-${FIRST_AWARD_YEAR}.csv`, `awards-after-${lastYear}.csv`, `history-before-${FIRST_HISTORY_YEAR}.csv`,
              `history-after-${lastYear}.csv`].map((f) => <li><a class="mono" href={`/downloads/${f}`}>{f}</a></li>)}
          </ul>
          <p class="muted small top-gap">{t(lang, "data.downloads_note")}</p>

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
