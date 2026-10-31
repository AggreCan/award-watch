// /rankings and /rankings/:year: the organizations with the largest value or
// the most records in one source, and the buyers with the most, from one
// pre-ranked file each (rankings/all.json, rankings/<year>.json). One source
// at a time: a ranking never mixes sources.

import type { Context } from "hono";
import { MONEY_SOURCES, SOURCES, type SourceKey } from "../constants";
import { YEAR_RE, loadRankings, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, sourceLabel, t } from "../i18n";
import { Breadcrumb, Layout, noDataPage, notFoundPage, page } from "../layout";
import { pageSeo, sectionSeo } from "../seo";
import { OrgTotalTable, money } from "./shared";

export async function rankingsPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const raw = c.req.param("year");
  if (raw !== undefined && !YEAR_RE.test(raw)) return c.notFound();
  const year = raw === undefined ? null : Number(raw);
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "rankings.title");
  const r = await loadRankings(c.env, year ?? "all");
  if (!r) {
    return year === null
      ? noDataPage(c, "rankings.title")
      : notFoundPage(c, stats.data_as_of, "rankings.year_not_found", "/rankings", "rankings.back");
  }
  const askedSource = c.req.query("source") ?? "";
  const available = SOURCES.filter((s) => r.sources[s]);
  const source: SourceKey = (available as readonly string[]).includes(askedSource) ? (askedSource as SourceKey) : available[0] ?? "awards";
  // Lobbying reports carry no amount, so they rank by count only.
  const by = c.req.query("by") === "count" || source === "lobbying" ? "count" : "value";
  const block = r.sources[source];
  const rows = block ? (by === "count" ? block.by_count : block.by_value) : [];
  const base = year === null ? "/rankings" : `/rankings/${year}`;
  const href = (s: string, b: string) => `${base}?source=${s}${b === "count" ? "&by=count" : ""}`;
  const title = year === null ? t(lang, "rankings.title") : t(lang, "rankings.title_year", { year });
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, ...(year === null ? [{ name: title }] : [{ name: t(lang, "rankings.title"), path: "/rankings" }, { name: String(year) }])];
  const filtered = askedSource !== "" || c.req.query("by") !== undefined;
  const seo = year === null
    ? pageSeo("rankings", lang, filtered ? { noindex: true } : {})
    : sectionSeo(base, title, t(lang, "rankings.description_year", { year }), crumbs, filtered);

  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/rankings" seo={seo}>
      <Breadcrumb lang={lang} crumbs={crumbs} />
      <h1>{title}</h1>
      <p class="lead">{t(lang, "rankings.lead")}</p>
      <p class="muted small">{t(lang, "rankings.note")}</p>
      <nav aria-label={t(lang, "rankings.years")}>
        <ul class="quick-links">
          <li>{year === null ? <span aria-current="page">{t(lang, "rankings.all_years")}</span> : <a href="/rankings">{t(lang, "rankings.all_years")}</a>}</li>
          {[...r.years].sort((a, b) => b - a).map((y) => (
            <li>{y === year ? <span aria-current="page" class="mono">{y}</span> : <a class="mono" href={`/rankings/${y}`}>{y}</a>}</li>
          ))}
        </ul>
      </nav>
      <nav aria-label={t(lang, "rankings.sources")} class="tabs">
        {available.map((s) => (
          <a href={href(s, by)} aria-current={s === source ? "page" : undefined}>{sourceLabel(lang, s)}</a>
        ))}
      </nav>
      {source !== "lobbying" ? (
        <nav aria-label={t(lang, "rankings.measure")} class="tabs tabs-small">
          <a href={href(source, "value")} aria-current={by === "value" ? "page" : undefined}>{t(lang, "rankings.by_value")}</a>
          <a href={href(source, "count")} aria-current={by === "count" ? "page" : undefined}>{t(lang, "rankings.by_count")}</a>
        </nav>
      ) : null}
      <h2>{t(lang, by === "count" ? "rankings.heading_count" : "rankings.heading_value", { source: sourceLabel(lang, source) })}</h2>
      {rows.length ? <OrgTotalTable lang={lang} rows={rows} rank /> : <p class="muted">{t(lang, "rankings.none")}</p>}

      <h2>{t(lang, "rankings.buyers")}</h2>
      {MONEY_SOURCES.filter((s) => (r.buyers[s] ?? []).length).map((s) => (
        <>
          <h3>{sourceLabel(lang, s)}</h3>
          <div class="table-wrap bordered">
            <table class="restack">
              <thead>
                <tr>
                  <th class="num">{t(lang, "col.rank")}</th>
                  <th>{t(lang, "col.buyer")}</th>
                  <th class="num">{t(lang, "col.records")}</th>
                  <th class="num">{t(lang, "col.value")}</th>
                </tr>
              </thead>
              <tbody>
                {(r.buyers[s] ?? []).map((b, i) => (
                  <tr>
                    <td data-label={t(lang, "col.rank")} class="mono num">{fmtInt(i + 1, lang)}</td>
                    <td data-label={t(lang, "col.buyer")}><a href={`/buyers/${b.id}`}>{pick(lang, b.name_en, b.name_fr) ?? b.id}</a></td>
                    <td data-label={t(lang, "col.records")} class="mono num">{fmtInt(b.n, lang)}</td>
                    <td data-label={t(lang, "col.value")} class="mono num">{money(lang, b.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}
    </Layout>,
  );
}
