// /organizations/:id: one organization's public records, source by source.
// Each source keeps its own figures and its own totals: a contract can appear
// in an award notice, in PSPC's contract history and in a department's
// published contracts at once, so nothing here ever adds two sources into one
// figure. The figures are what the records add up to by the rules on the
// Methodology page; they describe the records and judge nothing.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { ChartStack, type Panel } from "../chart";
import { MONEY_SOURCES, PROVINCES, type MoneySource, type SourceKey } from "../constants";
import { buyerPath, directoryCode, directoryPath, loadDirectories } from "../crosslinks";
import { loadAlias, loadProfile, loadStats, type Profile, type YearFigure } from "../data";
import type { AppEnv } from "../env";
import {
  fmtInt, fmtMoney, fmtMoneyShort, fmtPct, pick, provinceName, sourceLabel, t, tj, tn, type Key, type Lang,
} from "../i18n";
import { Breadcrumb, CompetitiveFlag, Layout, noDataPage, notFoundPage, page } from "../layout";
import { organizationSeo } from "../seo";
import { ExpiringSection, MoreInCsv } from "./expiring";
import { AwardTable, BuyerLink, SourceLine, contractSearchUrl, datasetUrl, grantUrl, lobbyUrl, money } from "./shared";
import { WATCH_MAX } from "./watchlist";

const REGISTRY_NAME: Record<string, Key> = {
  corporations_canada: "registry.corporations_canada",
  bc_orgbook: "registry.bc_orgbook",
  quebec_req: "registry.quebec_req",
};
const REGISTRY_URL: Record<string, string> = {
  corporations_canada: "https://ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html",
  bc_orgbook: "https://orgbook.gov.bc.ca/",
  quebec_req: "https://www.registreentreprises.gouv.qc.ca/",
};
const GRADE: Record<string, Key> = { exact: "registry.grade_exact", probable: "registry.grade_probable", possible: "registry.grade_possible" };
const AGREEMENT_TYPE: Record<string, Key> = { G: "grant.type_G", C: "grant.type_C", O: "grant.type_O" };

const SECTION_KEY: Record<SourceKey, Key> = {
  awards: "org.section_awards",
  history: "org.section_history",
  contracts: "org.section_contracts",
  grants: "org.section_grants",
  lobbying: "org.section_lobbying",
};

// The rows the export leaves out of a list (the profile holds the newest 100,
// lobbying 50) and where the whole list is: the yearly CSV files for the two
// CanadaBuys sources, the publisher's own files for the others.
const MoreRows: FC<{ lang: Lang; source: SourceKey; shown: number; total: number }> = ({ lang, source, shown, total }) => {
  if (total <= shown) return null;
  const where = source === "awards" || source === "history"
    ? <a href="/data#downloads">{t(lang, "org.more_downloads")}</a>
    : <a href={datasetUrl(source, lang)}>{t(lang, "org.more_source")}</a>;
  return (
    <p class="more-rows">
      {tj(lang, total - shown === 1 ? "org.more_rows_one" : "org.more_rows_many", {
        shown: fmtInt(shown, lang), total: fmtInt(total, lang), more: fmtInt(total - shown, lang), where,
      })}
    </p>
  );
};

const NonCad: FC<{ lang: Lang; n: number | undefined }> = ({ lang, n }) =>
  n ? <p class="muted small">{tn(lang, "org.non_cad_one", "org.non_cad_many", n, { n: fmtInt(n, lang) })}</p> : null;

// "3 of 12 (25%)": the share and what it is a share of. Grants carry no
// competitive flag, so their cells read "not applicable".
function share(lang: Lang, part: number | null, whole: number | null, fmt: (v: number) => string): string {
  if (part === null || whole === null) return t(lang, "common.not_applicable");
  const pct = fmtPct(part, whole, lang);
  return t(lang, "org.share", { part: fmt(part), whole: fmt(whole), pct: pct ? ` (${pct})` : "" });
}

// The yearly value of each money source as its own panel (each on its own
// scale: the sources are never drawn as one series).
const YearChart: FC<{ lang: Lang; years: readonly YearFigure[] }> = ({ lang, years }) => {
  const withValue = years.filter((y) => (y.total ?? 0) > 0);
  if (withValue.length === 0) return null;
  const first = Math.min(...withValue.map((y) => y.year));
  const last = Math.max(...withValue.map((y) => y.year));
  const domain: [number, number] = [first, last + 1];
  const panels: Panel[] = MONEY_SOURCES.filter((s) => withValue.some((y) => y.source === s)).map((s) => ({
    title: sourceLabel(lang, s),
    bars: withValue.filter((y) => y.source === s).map((y) => ({
      x0: y.year, x1: y.year + 1, value: y.total ?? 0,
      title: `${y.year}: ${fmtMoney(y.total ?? 0, lang)}`,
    })),
  }));
  const labels = [];
  for (let y = first; y <= last; y++) labels.push({ x: y + 0.5, text: String(y), minor: (last - y) % 2 === 1 && last - first > 8 });
  return (
    <div class="chart">
      <ChartStack domain={domain} panels={panels} height={110} xLabels={labels} fmt={(v) => fmtMoneyShort(v, lang)} aria={t(lang, "org.chart_aria")} />
    </div>
  );
};

interface ResponseRow { submitted_at: string; text: string }
interface CorrectionRow { submitted_at: string; page: string | null; text: string }

// The published responses and corrections from the forms database. A storage
// failure reads as none: the profile renders from the static files alone.
async function siteRows(c: Context<AppEnv>, id: string): Promise<{ responses: ResponseRow[]; corrections: CorrectionRow[] }> {
  if (!c.env.DB) return { responses: [], corrections: [] };
  try {
    const [responses, corrections] = await c.env.DB.batch([
      c.env.DB.prepare("SELECT submitted_at, text FROM organization_responses WHERE organization_id = ? AND published = 1 ORDER BY submitted_at DESC").bind(id),
      c.env.DB.prepare("SELECT submitted_at, page, text FROM corrections WHERE organization_id = ? AND published = 1 ORDER BY submitted_at DESC").bind(id),
    ]);
    return {
      responses: (responses.results ?? []) as unknown as ResponseRow[],
      corrections: (corrections.results ?? []) as unknown as CorrectionRow[],
    };
  } catch {
    return { responses: [], corrections: [] };
  }
}

// A retired organization id redirects to the id that took its records, so old
// links and bookmarks still reach the profile. Only the language query is
// carried over. Cached like a page rather than for good, since a later rule
// change can move the records again. Null when the id has no alias.
export async function retiredIdRedirect(
  c: Context<AppEnv>, id: string, suffix = "", status: 301 | 308 = 301,
): Promise<Response | null> {
  const live = await loadAlias(c.env, id);
  if (!live) return null;
  const lang = c.req.query("lang");
  c.header("Cache-Control", "public, max-age=300");
  return c.redirect(`/organizations/${live}${suffix}${lang === "en" || lang === "fr" ? `?lang=${lang}` : ""}`, status);
}

export function directoryName(lang: Lang, code: string): string {
  if (code === "xx") return t(lang, "directory.name_xx");
  if (code === "un") return t(lang, "directory.name_un");
  return provinceName(lang, code.toUpperCase());
}

function placeText(lang: Lang, p: { country: string | null; province: string | null; city: string | null }): string {
  const prov = p.province && (PROVINCES as readonly string[]).includes(p.province) ? provinceName(lang, p.province) : null;
  const country = p.country && p.country !== "CA" ? p.country : null;
  return [p.city, prov, country].filter(Boolean).join(", ") || t(lang, "common.not_stated");
}

export async function organizationPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const id = c.req.param("id") ?? "";
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "org.title");
  const profile: Profile | null = await loadProfile(c.env, id);
  if (!profile) {
    const moved = await retiredIdRedirect(c, id);
    if (moved) return moved;
    return notFoundPage(c, stats.data_as_of, "org.not_found", "/organizations", "org.back");
  }
  const o = profile.organization;
  const [{ responses, corrections }, directories] = await Promise.all([siteRows(c, id), loadDirectories(c.env)]);
  const dirCode = directoryCode(o.province, o.country);
  const dirListed = (directories?.get(dirCode)?.pages ?? 0) > 0;
  const crumbs = [
    { name: t(lang, "common.home"), path: "/" },
    { name: t(lang, "nav.organizations"), path: "/organizations" },
    { name: directoryName(lang, dirCode), path: dirListed ? directoryPath(dirCode) : undefined },
    { name: o.display_name },
  ];
  const otherNames = [...new Set(profile.names.map((n) => n.name).filter((n) => n !== o.display_name))];
  const places = profile.places;
  const placeCount = profile.places_total_rows ?? places.length;
  const counts: Record<SourceKey, number> = {
    awards: o.n_awards, history: o.n_history, contracts: o.n_contracts, grants: o.n_grants, lobbying: o.n_lobbying,
  };
  const totals: Record<MoneySource, number | null> = {
    awards: o.total_awards, history: o.total_history, contracts: o.total_contracts, grants: o.total_grants,
  };
  const years = [...profile.years].sort((a, b) => b.year - a.year || MONEY_SOURCES.indexOf(a.source) - MONEY_SOURCES.indexOf(b.source));
  const n = (v: number) => fmtInt(v, lang);
  const nonCad = profile.non_cad ?? {};
  // The bulk file that holds every profile, and the crawler guide to it, so a
  // client walking profiles can find the file instead.
  c.header("Link", '</downloads/organizations.csv>; rel="alternate"; type="text/csv", </llms.txt>; rel="help"');

  return page(
    c,
    <Layout lang={lang} title={o.display_name} dataAsOf={stats.data_as_of} active="/organizations" seo={organizationSeo(profile, lang, crumbs)}>
      <Breadcrumb lang={lang} crumbs={crumbs} />
      <h1>{o.display_name}</h1>
      <p class="lead">{placeText(lang, o)}</p>
      {otherNames.length ? <p>{t(lang, "org.also_recorded")} {otherNames.join(" · ")}</p> : null}
      <p class="muted small">
        {t(lang, "org.seen", { first: o.first_seen ?? t(lang, "common.na"), last: o.last_seen ?? t(lang, "common.na") })}
        {o.business_number ? ` ${t(lang, "org.business_number", { bn: o.business_number })}` : ""}
      </p>
      <p class="links">
        <button type="button" class="btn" id="watch-toggle" style="display:none" data-organization={o.id} data-max={String(WATCH_MAX)}
          data-label-on={t(lang, "watch.on")} data-label-off={t(lang, "watch.off")} data-label-full={t(lang, "watch.full", { max: WATCH_MAX })}>
          {t(lang, "watch.off")}
        </button>
        <a href={`/organizations/${o.id}/respond`} class="btn">{t(lang, "org.respond")}</a>
        <a href={`/corrections?organization=${o.id}`} class="btn">{t(lang, "org.correct")}</a>
      </p>

      <section class="tiles" aria-label={t(lang, "org.tiles_label")}>
        {MONEY_SOURCES.map((s) => (
          <a class="tile" href={`#${s}`}>
            <span class="tile-label">{sourceLabel(lang, s)}</span>
            <span class="tile-value">{counts[s] ? fmtMoneyShort(totals[s] ?? 0, lang) : "0"}</span>
            <span class="tile-note">{tn(lang, "org.tile_records_one", "org.tile_records_many", counts[s], { n: n(counts[s]) })}</span>
          </a>
        ))}
        <a class="tile" href="#lobbying">
          <span class="tile-label">{sourceLabel(lang, "lobbying")}</span>
          <span class="tile-value">{n(counts.lobbying)}</span>
          <span class="tile-note">{t(lang, "org.tile_lobbying")}</span>
        </a>
      </section>
      <p class="muted small">{t(lang, "org.never_added")}</p>

      <div class="cards">
        <section class="card">
          <h2>{t(lang, "org.places")}</h2>
          {places.length ? (
            <ul class="plain">
              {places.map((p) => <li>{placeText(lang, p)} <span class="muted small">{tn(lang, "org.rows_one", "org.rows_many", p.n, { n: n(p.n) })}</span></li>)}
            </ul>
          ) : <p class="muted">{t(lang, "common.not_stated")}</p>}
          {placeCount > 1 ? <p class="muted small">{t(lang, "org.places_note", { n: n(placeCount) })}</p> : null}
        </section>
        <section class="card">
          <h2>{t(lang, "org.registry")}</h2>
          {profile.registry.length ? (
            <dl>
              {profile.registry.map((r) => (
                <>
                  <dt>{REGISTRY_NAME[r.registry] ? t(lang, REGISTRY_NAME[r.registry]) : r.registry}</dt>
                  <dd>
                    {r.legal_name ?? ""} <span class="mono">{r.registry_id}</span>
                    {r.status ? `, ${r.status}` : ""}
                    {r.registered_on ? `, ${t(lang, "registry.registered", { date: r.registered_on })}` : ""}
                    <br />
                    <span class="muted small">{GRADE[r.grade] ? t(lang, GRADE[r.grade]) : r.grade}</span>
                    {REGISTRY_URL[r.registry] ? <> <a class="small" href={REGISTRY_URL[r.registry]}>{t(lang, "registry.search")}</a></> : null}
                  </dd>
                </>
              ))}
            </dl>
          ) : <p class="muted">{t(lang, "registry.none")}</p>}
        </section>
      </div>

      <h2 id="years">{t(lang, "org.years")}</h2>
      <p class="muted small">
        {tj(lang, "org.years_note", { methodology: <a href="/methodology#counting">{t(lang, "org.years_rules")}</a> })}
      </p>
      <YearChart lang={lang} years={profile.years} />
      {years.length ? (
        <div class="table-wrap bordered">
          <table class="restack">
            <thead>
              <tr>
                <th>{t(lang, "col.year")}</th>
                <th>{t(lang, "col.source")}</th>
                <th class="num">{t(lang, "col.records")}</th>
                <th class="num">{t(lang, "col.value")}</th>
                <th class="num"><span title={t(lang, "competitive.def_no")}>{t(lang, "org.col_nc_count")}</span></th>
                <th class="num"><span title={t(lang, "competitive.def_no")}>{t(lang, "org.col_nc_value")}</span></th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr>
                  <td data-label={t(lang, "col.year")} class="mono">{y.year}</td>
                  <td data-label={t(lang, "col.source")}>{sourceLabel(lang, y.source)}</td>
                  <td data-label={t(lang, "col.records")} class="mono num">{n(y.n)}</td>
                  <td data-label={t(lang, "col.value")} class="mono num">{money(lang, y.total)}</td>
                  <td data-label={t(lang, "org.col_nc_count")} class="mono num">{share(lang, y.n_non_competitive, y.source === "grants" ? null : y.n, n)}</td>
                  <td data-label={t(lang, "org.col_nc_value")} class="mono num">
                    {share(lang, y.total_non_competitive, y.source === "grants" ? null : y.total, (v) => fmtMoney(v, lang))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p class="muted">{t(lang, "org.years_none")}</p>}
      <p class="muted small">{t(lang, "org.nc_footnote")}</p>

      {profile.expiring ? (
        <ExpiringSection lang={lang} part={profile.expiring} heading="org.expiring" organization={false}
          more={<MoreInCsv lang={lang} part={profile.expiring} />}
          link={<a href="/expiring">{t(lang, "expiring.see_all")}</a>} />
      ) : null}

      <h2 id="awards">{t(lang, SECTION_KEY.awards)}</h2>
      {profile.awards.length ? <AwardTable lang={lang} rows={profile.awards} organization={false} /> : <p class="muted">{t(lang, "org.none_awards")}</p>}
      <MoreRows lang={lang} source="awards" shown={profile.awards.length} total={profile.awards_total_rows} />
      <NonCad lang={lang} n={nonCad.awards} />
      <SourceLine lang={lang} source="awards" />

      <h2 id="history">{t(lang, SECTION_KEY.history)}</h2>
      <p class="muted small">{t(lang, "org.history_note")}</p>
      {profile.history.length ? <AwardTable lang={lang} rows={profile.history} href="/history" organization={false} /> : <p class="muted">{t(lang, "org.none_history")}</p>}
      <MoreRows lang={lang} source="history" shown={profile.history.length} total={profile.history_total_rows} />
      <NonCad lang={lang} n={nonCad.history} />
      <SourceLine lang={lang} source="history" />

      <h2 id="contracts">{t(lang, SECTION_KEY.contracts)}</h2>
      <p class="muted small">{t(lang, "org.contracts_note")}</p>
      {profile.contracts.length ? (
        <div class="table-wrap bordered">
          <table class="restack">
            <thead>
              <tr>
                <th>{t(lang, "col.date")}</th>
                <th>{t(lang, "col.description")}</th>
                <th>{t(lang, "col.buyer")}</th>
                <th class="num">{t(lang, "col.value")}</th>
                <th>{t(lang, "col.method")}</th>
                <th>{t(lang, "col.record")}</th>
              </tr>
            </thead>
            <tbody>
              {profile.contracts.map((r) => (
                <tr>
                  <td data-label={t(lang, "col.date")} class="mono">{r.contract_date ?? ""}</td>
                  <td data-label={t(lang, "col.description")}>
                    {pick(lang, r.description_en, r.description_fr) ?? t(lang, "common.not_stated")}
                    {r.reporting_period ? <><br /><span class="muted small">{t(lang, "org.reporting_period", { period: r.reporting_period })}</span></> : null}
                  </td>
                  <td data-label={t(lang, "col.buyer")}><BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} /></td>
                  <td data-label={t(lang, "col.value")} class="mono num">
                    {money(lang, r.value)}
                    {r.value_last_reported !== undefined && r.value_last_reported !== null ? (
                      <><br /><span class="muted small" title={t(lang, "org.last_reported_def")}>{t(lang, "org.last_reported", { value: money(lang, r.value_last_reported) })}</span></>
                    ) : null}
                  </td>
                  <td data-label={t(lang, "col.method")}><CompetitiveFlag lang={lang} value={r.competitive} /></td>
                  <td data-label={t(lang, "col.record")}><a href={contractSearchUrl(r.reference)} class="mono" rel="nofollow noopener">{r.reference}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p class="muted">{t(lang, "org.none_contracts")}</p>}
      <MoreRows lang={lang} source="contracts" shown={profile.contracts.length} total={profile.contracts_total_rows} />
      <NonCad lang={lang} n={nonCad.contracts} />
      <SourceLine lang={lang} source="contracts" />

      <h2 id="grants">{t(lang, SECTION_KEY.grants)}</h2>
      {profile.grants.length ? (
        <div class="table-wrap bordered">
          <table class="restack">
            <thead>
              <tr>
                <th>{t(lang, "grant.start")}</th>
                <th>{t(lang, "grant.program")}</th>
                <th>{t(lang, "grant.department")}</th>
                <th>{t(lang, "grant.type")}</th>
                <th class="num">{t(lang, "col.value")}</th>
                <th>{t(lang, "col.record")}</th>
              </tr>
            </thead>
            <tbody>
              {profile.grants.map((g) => (
                <tr>
                  <td data-label={t(lang, "grant.start")} class="mono">{g.start ?? ""}{g.end ? <span class="muted"> {t(lang, "grant.to", { end: g.end })}</span> : null}</td>
                  <td data-label={t(lang, "grant.program")}>
                    {pick(lang, g.program_en, g.program_fr) ?? ""}
                    {pick(lang, g.title_en, g.title_fr) ? <><br /><span class="muted small">{pick(lang, g.title_en, g.title_fr)}</span></> : null}
                  </td>
                  <td data-label={t(lang, "grant.department")}><BuyerLink lang={lang} id={g.buyer_id} en={g.buyer_en} fr={g.buyer_fr} /></td>
                  <td data-label={t(lang, "grant.type")}>{g.agreement_type && AGREEMENT_TYPE[g.agreement_type] ? t(lang, AGREEMENT_TYPE[g.agreement_type]) : g.agreement_type ?? ""}</td>
                  <td data-label={t(lang, "col.value")} class="mono num">{money(lang, g.value)}</td>
                  <td data-label={t(lang, "col.record")}>
                    <a href={grantUrl(g.owner_org, g.reference)} class="mono" rel="nofollow noopener">{g.reference}</a>
                    {g.amendment > 0 ? <span class="muted small"> {t(lang, "grant.amendment", { n: g.amendment })}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p class="muted">{t(lang, "org.none_grants")}</p>}
      <MoreRows lang={lang} source="grants" shown={profile.grants.length} total={profile.grants_total_rows} />
      <NonCad lang={lang} n={nonCad.grants} />
      <SourceLine lang={lang} source="grants" />

      <h2 id="lobbying">{t(lang, SECTION_KEY.lobbying)}</h2>
      <p class="muted small">{t(lang, "org.lobbying_note")}</p>
      {profile.lobbying.length ? (
        <div class="table-wrap bordered">
          <table class="restack">
            <thead>
              <tr>
                <th>{t(lang, "col.date")}</th>
                <th>{t(lang, "lobby.subjects")}</th>
                <th>{t(lang, "lobby.institutions")}</th>
                <th>{t(lang, "lobby.officials")}</th>
                <th>{t(lang, "lobby.registrant")}</th>
                <th>{t(lang, "col.record")}</th>
              </tr>
            </thead>
            <tbody>
              {profile.lobbying.map((r) => (
                <tr>
                  <td data-label={t(lang, "col.date")} class="mono">{r.comm_date ?? ""}</td>
                  <td data-label={t(lang, "lobby.subjects")}>{r.subject_matters.join("; ")}</td>
                  <td data-label={t(lang, "lobby.institutions")}>{r.institutions.join("; ")}</td>
                  <td data-label={t(lang, "lobby.officials")}>
                    {r.dpoh.map((d) => <span class="nw-block">{[d.name, d.title, d.institution].filter(Boolean).join(", ")}</span>)}
                  </td>
                  <td data-label={t(lang, "lobby.registrant")}>{r.registrant ?? ""}</td>
                  <td data-label={t(lang, "col.record")}><a href={lobbyUrl(r.comm_number)} class="mono" rel="nofollow noopener">{r.comm_number}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p class="muted">{t(lang, "org.none_lobbying")}</p>}
      <MoreRows lang={lang} source="lobbying" shown={profile.lobbying.length} total={profile.lobbying_total_rows} />
      <SourceLine lang={lang} source="lobbying" />

      <h2 id="buyers">{t(lang, "org.buyers")}</h2>
      {profile.buyers.length ? (
        <div class="table-wrap bordered">
          <table class="restack">
            <thead>
              <tr>
                <th>{t(lang, "col.source")}</th>
                <th>{t(lang, "col.buyer")}</th>
                <th class="num">{t(lang, "col.records")}</th>
                <th class="num">{t(lang, "col.value")}</th>
              </tr>
            </thead>
            <tbody>
              {profile.buyers.map((b) => (
                <tr>
                  <td data-label={t(lang, "col.source")}>{sourceLabel(lang, b.source)}</td>
                  <td data-label={t(lang, "col.buyer")}>
                    {buyerPath(b.buyer_id) ? <a href={`/buyers/${b.buyer_id}`}>{pick(lang, b.buyer_en, b.buyer_fr) ?? b.buyer_id}</a> : b.buyer_id}
                  </td>
                  <td data-label={t(lang, "col.records")} class="mono num">{n(b.n)}</td>
                  <td data-label={t(lang, "col.value")} class="mono num">{money(lang, b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p class="muted">{t(lang, "org.buyers_none")}</p>}

      <h2 id="responses">{t(lang, "org.responses")}</h2>
      {responses.length ? (
        <ul class="statement-list">
          {responses.map((r) => (
            <li>
              <p class="muted small">{t(lang, "org.received", { date: r.submitted_at.slice(0, 10) })}</p>
              <blockquote>{r.text}</blockquote>
            </li>
          ))}
        </ul>
      ) : <p class="muted">{t(lang, "org.no_responses")}</p>}
      <p><a href={`/organizations/${o.id}/respond`}>{t(lang, "org.respond")}</a></p>

      <h2 id="corrections">{t(lang, "org.corrections")}</h2>
      {corrections.length ? (
        <ul class="statement-list">
          {corrections.map((r) => (
            <li>
              <p class="muted small">{t(lang, "org.received", { date: r.submitted_at.slice(0, 10) })}{r.page ? ` · ${r.page}` : ""}</p>
              <p>{r.text}</p>
            </li>
          ))}
        </ul>
      ) : <p class="muted">{t(lang, "org.no_corrections")}</p>}
      <p><a href={`/corrections?organization=${o.id}`}>{t(lang, "org.correct")}</a></p>
      <script src="/watchlist.js" defer></script>
    </Layout>,
  );
}
