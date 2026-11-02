// /organizations/:id: one organization's public records, source by source.
// Each source keeps its own figures and its own totals: a contract can appear
// in an award notice, in PSPC's contract history and in a department's
// published contracts at once, so nothing here ever adds two sources into one
// figure. The figures are what the records add up to by the rules on the
// Methodology page; they describe the records and judge nothing.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { ChartStack, type Panel as ChartPanel, yearLabels } from "../chart";
import { Table, restClass } from "../columns";
import { MONEY_SOURCES, PROVINCES, type MoneySource, type SourceKey } from "../constants";
import { buyerPath, directoryCode, directoryPath, loadDirectories } from "../crosslinks";
import { loadAlias, loadProfile, loadStats, sourceLoaded, type Profile, type YearFigure } from "../data";
import type { AppEnv } from "../env";
import {
  fmtInt, fmtMoney, fmtMoneyShort, pick, provinceName, sourceLabel, t, tj, tn, type Key, type Lang,
} from "../i18n";
import { CompetitiveFlag, Layout, PageHead, Panel, noDataPage, notFoundPage, page, todayOf } from "../layout";
import { organizationSeo } from "../seo";
import { ExpiringSection, MoreInCsv } from "./expiring";
import { InterestPanel, interestFilter } from "./interest";
import {
  AwardTable, BuyerLink, PHONE_ROWS, PhonePagerScript, PhonePages, SourceLine, SourcesSeparate, YearsBox, contractSearchUrl, datasetUrl,
  grantUrl, lobbyUrl, money, orList, shareText,
} from "./shared";
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

// Each source as the line naming the sources with no records says it.
const SOURCE_IN: Record<SourceKey, Key> = {
  awards: "org.in_awards",
  history: "org.in_history",
  contracts: "org.in_contracts",
  grants: "org.in_grants",
  lobbying: "org.in_lobbying",
};

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


// The yearly value of each money source as its own panel (each on its own
// scale: the sources are never drawn as one series).
const YearChart: FC<{ lang: Lang; years: readonly YearFigure[] }> = ({ lang, years }) => {
  const withValue = years.filter((y) => (y.total ?? 0) > 0);
  if (withValue.length === 0) return null;
  const first = Math.min(...withValue.map((y) => y.year));
  const last = Math.max(...withValue.map((y) => y.year));
  const domain: [number, number] = [first, last + 1];
  const panels: ChartPanel[] = MONEY_SOURCES.filter((s) => withValue.some((y) => y.source === s)).map((s) => ({
    title: sourceLabel(lang, s),
    bars: withValue.filter((y) => y.source === s).map((y) => ({
      x0: y.year, x1: y.year + 1, value: y.total ?? 0,
      title: `${y.year}: ${fmtMoney(y.total ?? 0, lang)}`,
    })),
  }));
  const labels = yearLabels(first, last);
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

// The non-competitive share of a year's value. Over the positive values
// alone when the export gives them, so an amendment that lowered a published
// contract cannot turn the share negative or past 100 percent; a year with
// such a record carries the footnote's mark. An older export gives the net
// figures: a part below zero or past the whole shows without a percentage.
export function valueShare(lang: Lang, y: YearFigure): string {
  if (y.source === "grants") return shareText(lang, null, null, (v) => fmtMoney(v, lang));
  const money = (v: number) => fmtMoney(v, lang);
  if (y.total_positive !== undefined) {
    const text = shareText(lang, y.total_non_competitive_positive ?? 0, y.total_positive, money);
    return (y.n_negative ?? 0) > 0 ? `${text} *` : text;
  }
  const part = y.total_non_competitive ?? 0;
  if (y.total !== null && (part < 0 || part > y.total)) return money(part);
  return shareText(lang, y.total_non_competitive, y.total, money);
}

type Place = Profile["places"][number];

// A place as the records spell it, reduced so trivial variants match: case,
// accents and punctuation folded ("Pointe-Claire" and "pointe claire"), a
// postal code run into the city dropped ("Toronto2C4"), and a province
// written after the city left out ("Markham Ontario", "Markham, Ontario",
// "Markham ON" with Ontario as the province).
export function placeKey(p: Pick<Place, "country" | "province" | "city">): string {
  const fold = (s: string | null) => (s ?? "").normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  let city = fold(p.city).replace(/[0-9].*$/, "").replace(/[^a-z]+/g, " ").trim();
  const province = (p.province ?? "").toUpperCase();
  if (province) {
    const names = [province.toLowerCase(), fold(provinceName("en", province)), fold(provinceName("fr", province))]
      .map((s) => s.replace(/[^a-z]+/g, " ").trim()).filter(Boolean);
    for (const name of names) {
      if (city !== name && city.endsWith(` ${name}`)) city = city.slice(0, -name.length - 1).trim();
    }
  }
  return `${(p.country ?? "").toUpperCase()}|${province}|${city}`;
}

// The places with their variants merged: one row per key, counted together,
// spelled as its most frequent variant (the export lists the most frequent first).
export function mergedPlaces(places: readonly Place[]): Place[] {
  const byKey = new Map<string, Place>();
  for (const p of places) {
    const key = placeKey(p);
    const seen = byKey.get(key);
    if (seen) byKey.set(key, { ...seen, n: seen.n + p.n });
    else byKey.set(key, { ...p });
  }
  return [...byKey.values()].sort((a, b) => b.n - a.n);
}

// How many addresses the note counts: the distinct places that name a city
// (a country or province alone could be any of them), plus the places past
// the ten listed, which the page cannot compare.
export function addressCount(places: readonly Place[], total?: number): number {
  const named = new Set(places.filter((p) => placeKey(p).split("|")[2]).map(placeKey)).size;
  return named + Math.max(0, (total ?? places.length) - places.length);
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
  const [{ responses, corrections }, directories, interest] = await Promise.all([
    siteRows(c, id), loadDirectories(c.env), interestFilter(c.env, lang, "organization", `/organizations/${o.id}`, { name: o.display_name }),
  ]);
  const dirCode = directoryCode(o.province, o.country);
  const dirListed = (directories?.get(dirCode)?.pages ?? 0) > 0;
  const crumbs = [
    { name: t(lang, "common.home"), path: "/" },
    { name: t(lang, "nav.organizations"), path: "/organizations" },
    { name: directoryName(lang, dirCode), path: dirListed ? directoryPath(dirCode) : undefined },
    { name: o.display_name },
  ];
  const otherNames = [...new Set(profile.names.map((n) => n.name).filter((n) => n !== o.display_name))];
  const places = mergedPlaces(profile.places);
  const placeCount = addressCount(profile.places, profile.places_total_rows);
  const counts: Record<SourceKey, number> = {
    awards: o.n_awards, history: o.n_history, contracts: o.n_contracts, grants: o.n_grants, lobbying: o.n_lobbying,
  };
  const totals: Record<MoneySource, number | null> = {
    awards: o.total_awards, history: o.total_history, contracts: o.total_contracts, grants: o.total_grants,
  };
  const n = (v: number) => fmtInt(v, lang);
  const nonCad = profile.non_cad ?? {};
  // A source never read shows "n/a" and says so, instead of zero and "none".
  // The profile says so for its own five sources (a key it carries only for
  // a source never read); the registry's read is on the Data page's rows.
  const read = (s: SourceKey | "registry") => sourceLoaded(s, profile, s === "registry" ? stats : null) !== false;
  const registryRead = read("registry");
  // Years after the data date's are as the source dates them.
  const lateYears = profile.years.some((y) => y.year > Number(todayOf(stats.data_as_of).slice(0, 4)));
  // The bulk file that holds every profile, and the crawler guide to it, so a
  // client walking profiles can find the file instead.
  c.header("Link", '</downloads/organizations.csv>; rel="alternate"; type="text/csv", </llms.txt>; rel="help"');

  // The record lists in the order of the sources: the ones with records as
  // panels, the ones with none in one line after them, and a source never
  // read named as such in that line.
  const SOURCE_ORDER: readonly SourceKey[] = ["awards", "history", "contracts", "grants", "lobbying"];
  const totalRows: Record<SourceKey, number> = {
    awards: profile.awards_total_rows, history: profile.history_total_rows, contracts: profile.contracts_total_rows,
    grants: profile.grants_total_rows, lobbying: profile.lobbying_total_rows,
  };
  const withRecords = SOURCE_ORDER.filter((s) => read(s) && totalRows[s] > 0);
  const withNone = SOURCE_ORDER.filter((s) => read(s) && totalRows[s] === 0);
  const notRead = SOURCE_ORDER.filter((s) => !read(s));
  const listed = (s: SourceKey) => withRecords.includes(s);
  const dataYear = Number(todayOf(stats.data_as_of).slice(0, 4));
  const buyerSources = MONEY_SOURCES.filter((s) => profile.buyers.some((b) => b.source === s));

  const sections: Record<SourceKey, unknown> = {
    awards: (
      <Panel id="awards" title={t(lang, SECTION_KEY.awards)} count={n(profile.awards_total_rows)} foot={<SourceLine lang={lang} source="awards" />}>
        {profile.awards.length ? <AwardTable lang={lang} rows={profile.awards} organization={false} phoneRows={PHONE_ROWS} /> : <p class="muted">{t(lang, "org.none_awards")}</p>}
        <MoreRows lang={lang} source="awards" shown={profile.awards.length} total={profile.awards_total_rows} />
        <NonCad lang={lang} n={nonCad.awards} />
      </Panel>
    ),
    history: (
      <Panel id="history" title={t(lang, SECTION_KEY.history)} count={n(profile.history_total_rows)} foot={<SourceLine lang={lang} source="history" />}>
        <p class="muted small">{t(lang, "org.history_note")}</p>
        {profile.history.length ? <AwardTable lang={lang} rows={profile.history} href="/history" organization={false} phoneRows={PHONE_ROWS} /> : <p class="muted">{t(lang, "org.none_history")}</p>}
        <MoreRows lang={lang} source="history" shown={profile.history.length} total={profile.history_total_rows} />
        <NonCad lang={lang} n={nonCad.history} />
      </Panel>
    ),
    contracts: (
      <Panel id="contracts" title={t(lang, SECTION_KEY.contracts)} count={n(profile.contracts_total_rows)} foot={<SourceLine lang={lang} source="contracts" />}>
        <p class="muted small">{t(lang, "org.contracts_note")}</p>
        {profile.contracts.length ? (
          <PhonePages lang={lang} rows={PHONE_ROWS}>
            <Table cols={[
              { kind: "date", label: t(lang, "col.date") },
              { kind: "main", label: t(lang, "col.description") },
              { kind: "buyer", label: t(lang, "col.buyer"), rest: "md" },
              { kind: "value", label: t(lang, "col.value") },
              { kind: "comp", label: t(lang, "col.method") },
              { kind: "record", label: t(lang, "col.record") },
            ]}>
              <tbody>
                {profile.contracts.map((r) => (
                  <tr>
                    <td data-label={t(lang, "col.date")} class="mono">{r.contract_date ?? ""}</td>
                    <td data-label={t(lang, "col.description")} class="lead-cell">
                      {pick(lang, r.description_en, r.description_fr) ?? t(lang, "common.not_stated")}
                      {r.reporting_period ? <><br /><span class="muted small">{t(lang, "org.reporting_period", { period: r.reporting_period })}</span></> : null}
                    </td>
                    <td data-label={t(lang, "col.buyer")} class="mdh"><BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} /></td>
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
            </Table>
          </PhonePages>
        ) : <p class="muted">{t(lang, "org.none_contracts")}</p>}
        <MoreRows lang={lang} source="contracts" shown={profile.contracts.length} total={profile.contracts_total_rows} />
        <NonCad lang={lang} n={nonCad.contracts} />
      </Panel>
    ),
    grants: (
      <Panel id="grants" title={t(lang, SECTION_KEY.grants)} count={n(profile.grants_total_rows)} foot={<SourceLine lang={lang} source="grants" />}>
        {profile.grants.length ? (
          <PhonePages lang={lang} rows={PHONE_ROWS}>
            <Table cols={[
              { kind: "date", label: t(lang, "grant.start") },
              { kind: "main", label: t(lang, "grant.program") },
              { kind: "buyer", label: t(lang, "grant.department"), rest: "md" },
              { kind: "label", label: t(lang, "grant.type") },
              { kind: "value", label: t(lang, "col.value") },
              { kind: "record", label: t(lang, "col.record") },
            ]}>
              <tbody>
                {profile.grants.map((g) => (
                  <tr>
                    <td data-label={t(lang, "grant.start")} class="mono">
                      <span class="nw">{g.start ?? ""}</span>
                      {g.end ? <span class="muted"> {tj(lang, "grant.to", { end: <span class="nw">{g.end}</span> })}</span> : null}
                    </td>
                    <td data-label={t(lang, "grant.program")} class="lead-cell">
                      {pick(lang, g.program_en, g.program_fr) ?? ""}
                      {pick(lang, g.title_en, g.title_fr) ? <><br /><span class="muted small">{pick(lang, g.title_en, g.title_fr)}</span></> : null}
                    </td>
                    <td data-label={t(lang, "grant.department")} class="mdh"><BuyerLink lang={lang} id={g.buyer_id} en={g.buyer_en} fr={g.buyer_fr} /></td>
                    <td data-label={t(lang, "grant.type")}>{g.agreement_type && AGREEMENT_TYPE[g.agreement_type] ? t(lang, AGREEMENT_TYPE[g.agreement_type]) : g.agreement_type ?? ""}</td>
                    <td data-label={t(lang, "col.value")} class="mono num">{money(lang, g.value)}</td>
                    <td data-label={t(lang, "col.record")}>
                      <a href={grantUrl(g.owner_org, g.reference)} class="mono" rel="nofollow noopener">{g.reference}</a>
                      {g.amendment > 0 ? <span class="muted small"> {t(lang, "grant.amendment", { n: g.amendment })}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </PhonePages>
        ) : <p class="muted">{t(lang, "org.none_grants")}</p>}
        <MoreRows lang={lang} source="grants" shown={profile.grants.length} total={profile.grants_total_rows} />
        <NonCad lang={lang} n={nonCad.grants} />
      </Panel>
    ),
    lobbying: (
      <Panel id="lobbying" title={t(lang, SECTION_KEY.lobbying)} count={n(profile.lobbying_total_rows)} foot={<SourceLine lang={lang} source="lobbying" />}>
        <p class="muted small">{t(lang, "org.lobbying_note")}</p>
        {profile.lobbying.length ? (
          <PhonePages lang={lang} rows={PHONE_ROWS}>
            <Table cols={[
              { kind: "date", label: t(lang, "col.date") },
              { kind: "main", label: t(lang, "lobby.subjects") },
              { kind: "buyer", label: t(lang, "lobby.institutions"), rest: "md" },
              { kind: "org", label: t(lang, "lobby.officials") },
              { kind: "org", label: t(lang, "lobby.registrant"), rest: "lg" },
              { kind: "record", label: t(lang, "col.record") },
            ]}>
              <tbody>
                {profile.lobbying.map((r) => (
                  <tr>
                    <td data-label={t(lang, "col.date")} class="mono">{r.comm_date ?? ""}</td>
                    <td data-label={t(lang, "lobby.subjects")} class="lead-cell">{r.subject_matters.join("; ")}</td>
                    <td data-label={t(lang, "lobby.institutions")} class={restClass("md")}>{r.institutions.join("; ")}</td>
                    <td data-label={t(lang, "lobby.officials")}>
                      {r.dpoh.map((d) => <span class="nw-block">{[d.name, d.title, d.institution].filter(Boolean).join(", ")}</span>)}
                    </td>
                    <td data-label={t(lang, "lobby.registrant")} class={restClass("lg")}>{r.registrant ?? ""}</td>
                    <td data-label={t(lang, "col.record")}><a href={lobbyUrl(r.comm_number)} class="mono" rel="nofollow noopener">{r.comm_number}</a></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </PhonePages>
        ) : <p class="muted">{t(lang, "org.none_lobbying")}</p>}
        <MoreRows lang={lang} source="lobbying" shown={profile.lobbying.length} total={profile.lobbying_total_rows} />
      </Panel>
    ),
  };

  return page(
    c,
    <Layout lang={lang} title={o.display_name} dataAsOf={stats.data_as_of} active="/organizations" seo={organizationSeo(profile, lang, crumbs)}>
      <PageHead lang={lang} crumbs={crumbs} title={o.display_name} lead={placeText(lang, o)}
        actions={<>
          <button type="button" class="btn" id="watch-toggle" style="display:none" title={t(lang, "watch.button_title")}
            data-organization={o.id} data-max={String(WATCH_MAX)}
            data-label-on={t(lang, "watch.on")} data-label-off={t(lang, "watch.off")} data-label-full={t(lang, "watch.full", { max: WATCH_MAX })}>
            {t(lang, "watch.off")}
          </button>
          <a href={`/organizations/${o.id}/respond`} class="btn">{t(lang, "org.respond")}</a>
          <a href={`/corrections?organization=${o.id}`} class="btn">{t(lang, "org.correct")}</a>
        </>}>
        {otherNames.length ? <p class="page-note">{t(lang, "org.also_recorded")} {otherNames.join(" · ")}</p> : null}
        <p class="page-note">
          {t(lang, "org.seen", { first: o.first_seen ?? t(lang, "common.na"), last: o.last_seen ?? t(lang, "common.na") })}
          {o.business_number ? ` ${t(lang, "org.business_number", { bn: o.business_number })}` : ""}
        </p>
      </PageHead>

      {/* A tile opens its source's list when the profile has one; a source
          never read says so in place of a figure. */}
      <section class="tiles" aria-label={t(lang, "org.tiles_label")}>
        {[...MONEY_SOURCES, "lobbying" as const].map((s) => {
          const body = (
            <>
              <span class="tile-label">{sourceLabel(lang, s)}</span>
              <span class="tile-value">
                {!read(s) ? t(lang, "common.not_loaded_short")
                  : s === "lobbying" ? n(counts.lobbying) : fmtMoneyShort(counts[s] ? totals[s] ?? 0 : 0, lang)}
              </span>
              <span class="tile-note">
                {!read(s) ? "" : s === "lobbying"
                  ? tn(lang, "org.tile_reports_one", "org.tile_reports_many", counts.lobbying, { n: n(counts.lobbying) })
                  : tn(lang, "org.tile_records_one", "org.tile_records_many", counts[s], { n: n(counts[s]) })}
              </span>
            </>
          );
          return listed(s) ? <a class="tile" href={`#${s}`}>{body}</a> : <div class="tile">{body}</div>;
        })}
      </section>
      <p class="tiles-note"><SourcesSeparate lang={lang} /></p>

      {profile.expiring ? (
        <ExpiringSection lang={lang} part={profile.expiring} heading="org.expiring" organization={false} phoneRows={PHONE_ROWS}
          more={<MoreInCsv lang={lang} part={profile.expiring} />} />
      ) : null}

      {/* The buyers under each source's own sub-head, so a source is named once. */}
      <Panel id="buyers" title={t(lang, "org.buyers")}>
        {profile.buyers.length ? (
          <div class="table-wrap bordered">
            <Table restack={false} class="compact" cols={[
              { kind: "main", label: t(lang, "col.buyer") },
              { kind: "count", label: t(lang, "col.records") },
              { kind: "total", label: t(lang, "col.value") },
            ]}>
              {buyerSources.map((s) => (
                <tbody>
                  <tr class="group-row"><th colspan={3} scope="colgroup" class="group-head">{sourceLabel(lang, s)}</th></tr>
                  {profile.buyers.filter((b) => b.source === s).map((b) => (
                    <tr>
                      <td data-label={t(lang, "col.buyer")}>
                        {buyerPath(b.buyer_id) ? <a href={`/buyers/${b.buyer_id}`}>{pick(lang, b.buyer_en, b.buyer_fr) ?? b.buyer_id}</a> : b.buyer_id}
                      </td>
                      <td data-label={t(lang, "col.records")} class="mono num">{n(b.n)}</td>
                      <td data-label={t(lang, "col.value")} class="mono num">{money(lang, b.total)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </Table>
          </div>
        ) : <p class="muted">{t(lang, "org.buyers_none")}</p>}
      </Panel>

      <Panel id="years" title={t(lang, "org.years")} foot={<span>
        {t(lang, "org.nc_footnote")}
        {profile.years.some((y) => (y.n_negative ?? 0) > 0 && y.source !== "grants") ? <><br />{t(lang, "org.nc_negative_note")}</> : null}
      </span>}>
        <p class="muted small">
          {tj(lang, "org.years_note", { methodology: <a href="/methodology#counting">{t(lang, "org.years_rules")}</a> })}
          {lateYears ? ` ${t(lang, "common.dates_as_published")}` : ""}
        </p>
        <YearChart lang={lang} years={profile.years} />
        {profile.years.length ? (
          <YearsBox lang={lang} years={profile.years} dataYear={dataYear} cols={[
            { kind: "date", label: t(lang, "col.year") },
            { kind: "main", label: t(lang, "col.source") },
            { kind: "count", label: t(lang, "col.records") },
            { kind: "total", label: t(lang, "col.value") },
            { kind: "share", label: <span title={t(lang, "competitive.def_no")}>{t(lang, "org.col_nc_count")}</span> },
            { kind: "share", label: <span title={t(lang, "competitive.def_no")}>{t(lang, "org.col_nc_value")}</span>, rest: "md" },
          ]} cells={(y) => (
            <>
              <td data-label={t(lang, "col.year")} class="mono">{y.year}</td>
              <td data-label={t(lang, "col.source")}>{sourceLabel(lang, y.source)}</td>
              <td data-label={t(lang, "col.records")} class="mono num">{n(y.n)}</td>
              <td data-label={t(lang, "col.value")} class="mono num">{money(lang, y.total)}</td>
              <td data-label={t(lang, "org.col_nc_count")} class="mono num">{shareText(lang, y.n_non_competitive, y.source === "grants" ? null : y.n, n)}</td>
              <td data-label={t(lang, "org.col_nc_value")} class="mono num mdh">{valueShare(lang, y)}</td>
            </>
          )} />
        ) : <p class="muted">{t(lang, "org.years_none")}</p>}
      </Panel>

      {withRecords.map((s) => sections[s] as any)}

      {withNone.length || notRead.length ? (
        <p class="sources-line">
          {withNone.length ? t(lang, "org.sources_none", { list: orList(lang, withNone.map((s) => t(lang, SOURCE_IN[s]))) }) : null}
          {withNone.length && notRead.length ? " " : null}
          {notRead.length ? t(lang, "org.sources_not_read", { list: notRead.map((s) => t(lang, SOURCE_IN[s])).join(", ") }) : null}
        </p>
      ) : null}

      <InterestPanel lang={lang} filter={interest} />

      <div class="panel-grid">
        <Panel title={t(lang, "org.places")}>
          {places.length ? (
            <ul class="kv">
              {places.map((p) => <li><span>{placeText(lang, p)}</span> <span class="num muted">{tn(lang, "org.rows_one", "org.rows_many", p.n, { n: n(p.n) })}</span></li>)}
            </ul>
          ) : <p class="muted">{t(lang, "common.not_stated")}</p>}
          {placeCount > 1 ? <p class="muted small">{t(lang, "org.places_note", { n: n(placeCount) })}</p> : null}
        </Panel>
        <Panel title={t(lang, "org.registry")}>
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
          ) : <p class="muted">{t(lang, registryRead ? "registry.none" : "common.not_loaded")}</p>}
        </Panel>
      </div>

      <div class="panel-grid">
        <Panel id="responses" title={t(lang, "org.responses")} foot={<a href={`/organizations/${o.id}/respond`}>{t(lang, "org.respond")}</a>}>
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
        </Panel>
        <Panel id="corrections" title={t(lang, "org.corrections")} foot={<a href={`/corrections?organization=${o.id}`}>{t(lang, "org.correct")}</a>}>
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
        </Panel>
      </div>
      <PhonePagerScript lang={lang} />
    </Layout>,
  );
}
