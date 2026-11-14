import type { Context } from "hono";
import { BAND_CLOSE, BAND_PARTIAL, MATCH_MANY, MATCH_MAX, MATCH_MIN, MATCH_POINTS, MATCH_YEARS } from "../../public/fit.js";
import { HowToCite } from "../cite";
import { Table } from "../columns";
import { CLOSING_SOON_DAYS } from "../constants";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, t, tj, type Key } from "../i18n";
import { Layout, PageHead, page } from "../layout";
import { pageSeo } from "../seo";
import {
  CODE_CHARS, FOLLOW_AFTER_DAYS, FOLLOW_BEFORE_DAYS, FOLLOW_CLOSE, FOLLOW_MAX, FOLLOW_MIN, LINE_YEARS, LONG_RUN, RUN_GAP_DAYS,
  RUN_OVERLAP_DAYS, SIMILAR_GROUP_MAX, SIMILAR_PREFIX, followsPanelOn,
} from "../lines";
import { BAND_KEY } from "../lines_view";
import { ENTRANT_LOOKBACK, FREE_YEARS } from "../records_db";
import { EXPIRING_TEASER_ROWS } from "./expiring";

// How the site reads its sources, merges organizations and buyers, counts
// money and derives statuses and competitive flags. The "Counting money"
// section states the rules in the words the pipeline follows
// (CLAUDE.md "Counting money"); change the code and this page together. The
// "Contracts ending soon" section states the radar's rules the same way
// (CLAUDE.md "Expiring-contracts radar"). The "Analytics" section states the
// rules the analytics views count by (src/records_db.ts, docs/analytics.md).
// The "Matching notices" section states the rules public/fit.js scores by,
// its table and figures drawn from that module's constants; the Terms' No
// Warranty section links the page. The "Holder's record" section states the
// rules the pipeline's lines.py counts by, every figure from src/lines.ts;
// while FOLLOWS_PANEL is "on" it is named for the earlier contracts too and
// holds may follow's paragraph (#follows, the rules of follows.py), and
// otherwise says nothing of them.
// The "Derived provinces" part of "Statuses and Regions" states the place
// rule of the pipeline's places.py; its figures were counted on the files of
// 2026-11-06. The "Payments in the Public Accounts" section states the rules
// of the pipeline's sources/public_accounts.py (docs/public-accounts.md), and
// the "Indigenous Procurement Target" section those of its
// sources/indigenous_target.py (docs/indigenous-procurement.md).

// Defence Construction Canada's own page of recent awards (a PDF it links),
// read 2026-11-06: neither CanadaBuys' award file nor the proactive
// publication carries its awards.
const DCC_CONTRACTS = {
  en: "https://www.dcc-cdc.gc.ca/industry/contract-activity",
  fr: "https://www.cdc-dcc.gc.ca/industrie/activit%C3%A9-contractuelle",
} as const;

const TOC: [string, Key][] = [
  ["sources", "methodology.toc_sources"],
  ["organizations", "methodology.toc_organizations"],
  ["buyers", "methodology.toc_buyers"],
  ["counting", "methodology.toc_counting"],
  ["public-accounts", "methodology.toc_public_accounts"],
  ["indigenous-target", "methodology.toc_indigenous_target"],
  ["competitive", "methodology.toc_competitive"],
  ["statuses", "methodology.toc_statuses"],
  ["expiring", "methodology.toc_expiring"],
  ["analytics", "methodology.toc_analytics"],
  ["matching", "methodology.toc_matching"],
  ["holders", "methodology.toc_holders"],
  ["people", "methodology.toc_people"],
  ["claims", "methodology.toc_claims"],
  ["corrections", "methodology.toc_corrections"],
];

// Matching notices: each part's rule beside its points, every figure from
// public/fit.js, the module that scores by them.
const P = MATCH_POINTS;
const MATCH_RULES: [Key, readonly number[]][] = [
  ["methodology.matching_rule_class", P.class],
  ["methodology.matching_rule_family", P.family],
  ["methodology.matching_rule_segment", P.segment],
  ["methodology.matching_rule_buyer", P.buyer],
  ["methodology.matching_rule_province", [...P.delivered, P.home, P.national]],
  ["methodology.matching_rule_type", [P.held, ...P.type]],
];

// The holder's record: each label beside its rule, the long run's figure from src/lines.ts.
const HOLDER_RULES: [keyof typeof BAND_KEY, Key][] = [
  ["run", "methodology.holders_rule_run"],
  ["earlier", "methodology.holders_rule_earlier"],
  ["none", "methodology.holders_rule_none"],
];

// vars fills a key's placeholders, for a figure the page takes from the code.
const List = ({ keys, lang, vars }: { keys: Key[]; lang: "en" | "fr"; vars?: Partial<Record<Key, Record<string, number>>> }) => (
  <ul>
    {keys.map((k) => <li>{t(lang, k, vars?.[k])}</li>)}
  </ul>
);

export async function methodologyPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  const follows = followsPanelOn(c.env);
  const tocKey = (id: string, key: Key): Key => (id === "holders" && follows ? "methodology.toc_holders_follows" : key);
  const pct = (share: number) => fmtInt(Math.round(share * 100), lang);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "methodology.title")} dataAsOf={stats?.data_as_of ?? null} active="/methodology" seo={pageSeo("methodology", lang)}>
      <PageHead lang={lang} title={t(lang, "methodology.title")} lead={t(lang, "methodology.lead")} />
      <div class="doc-layout">
        <nav class="toc" aria-label={t(lang, "toc.label")}>
          <span class="toc-title">{t(lang, "toc.title")}</span>
          {TOC.map(([id, key]) => <a href={`#${id}`}>{t(lang, tocKey(id, key))}</a>)}
        </nav>
        <div class="doc">

          <h2 id="sources">{t(lang, "methodology.toc_sources")}</h2>
          <p>{t(lang, "methodology.sources_text")}</p>
          <List lang={lang} keys={[
            "methodology.src_tenders", "methodology.src_same_day", "methodology.src_awards", "methodology.src_history",
            "methodology.src_contracts", "methodology.src_grants", "methodology.src_lobbying", "methodology.src_registry",
            "methodology.src_public_accounts", "methodology.src_indigenous_target",
          ]} />
          <p>{tj(lang, "methodology.src_dcc", { link: <a href={DCC_CONTRACTS[lang]} rel="noopener">{t(lang, "methodology.src_dcc_link")}</a> })}</p>
          <p>{tj(lang, "methodology.sources_more", { data: <a href="/data#sources">{t(lang, "nav.data")}</a> })}</p>
          <p>{t(lang, "methodology.tender_documents")}</p>

          <h2 id="organizations">{t(lang, "methodology.toc_organizations")}</h2>
          <p>{t(lang, "methodology.org_text")}</p>
          <List lang={lang} keys={["methodology.org_rule_name", "methodology.org_rule_id", "methodology.org_rule_place", "methodology.org_rule_display"]} />
          <p>{t(lang, "methodology.org_shared")}</p>
          <p>{t(lang, "methodology.org_registry")}</p>
          <p>{t(lang, "methodology.org_families")}</p>

          <h2 id="buyers">{t(lang, "methodology.toc_buyers")}</h2>
          <p>{t(lang, "methodology.buyers_text")}</p>
          <p>{t(lang, "methodology.buyers_merges")}</p>
          <p>{t(lang, "methodology.buyers_history")}</p>

          <h2 id="counting">{t(lang, "methodology.toc_counting")}</h2>
          <p>{t(lang, "methodology.counting_intro")}</p>
          <List lang={lang} keys={[
            "methodology.count_awards", "methodology.count_contracts", "methodology.count_grants",
            "methodology.count_years", "methodology.count_currency", "methodology.count_public_accounts",
          ]} />
          <p><strong>{t(lang, "methodology.never_add")}</strong></p>

          <h2 id="public-accounts">{t(lang, "methodology.toc_public_accounts")}</h2>
          <p>{t(lang, "methodology.pa_what")}</p>
          <p>{t(lang, "methodology.pa_thresholds")}</p>
          <p>{t(lang, "methodology.pa_match")}</p>
          <p>{t(lang, "methodology.pa_federal")}</p>
          <p>{t(lang, "methodology.pa_people")}</p>
          <p>{t(lang, "methodology.pa_limits")}</p>

          <h2 id="indigenous-target">{t(lang, "methodology.toc_indigenous_target")}</h2>
          <p>{t(lang, "methodology.ipt_what")}</p>
          <p>{t(lang, "methodology.ipt_plan")}</p>
          <p>{t(lang, "methodology.ipt_gaps")}</p>
          <p>{t(lang, "methodology.ipt_result")}</p>
          <p>{t(lang, "methodology.ipt_missing")}</p>
          <p>{t(lang, "methodology.ipt_match")}</p>
          <p>{t(lang, "methodology.ipt_limits")}</p>

          <h2 id="competitive">{t(lang, "methodology.toc_competitive")}</h2>
          <p>{t(lang, "methodology.competitive_intro")}</p>
          <List lang={lang} keys={["methodology.competitive_awards", "methodology.competitive_contracts", "methodology.competitive_share"]} />
          <dl>
            <dt>{t(lang, "competitive.yes")}</dt>
            <dd>{t(lang, "competitive.def_yes")}</dd>
            <dt>{t(lang, "competitive.no")}</dt>
            <dd>{t(lang, "competitive.def_no")}</dd>
            <dt>{t(lang, "competitive.unstated")}</dt>
            <dd>{t(lang, "competitive.def_unstated")}</dd>
          </dl>
          <p>{t(lang, "methodology.competitive_meaning")}</p>

          <h2 id="statuses">{t(lang, "methodology.toc_statuses")}</h2>
          <List lang={lang} keys={["methodology.status_open", "methodology.status_expired", "methodology.status_weekly"]} />
          <p>{t(lang, "methodology.status_closing", { days: CLOSING_SOON_DAYS })}</p>
          <p>{t(lang, "methodology.status_past")}</p>
          <p>{t(lang, "methodology.status_awards")}</p>
          <p>{t(lang, "methodology.status_regions")}</p>
          <h3 id="places">{t(lang, "places.derived_row")}</h3>
          <p>{t(lang, "methodology.places_intro")}</p>
          <List lang={lang} keys={[
            "methodology.places_city", "methodology.places_opportunity", "methodology.places_land_claims", "methodology.places_dcc",
            "methodology.places_never",
          ]} />
          <p>{t(lang, "methodology.places_filter")}</p>
          <p>{t(lang, "methodology.places_counts")}</p>

          <h2 id="expiring">{t(lang, "methodology.toc_expiring")}</h2>
          <p>{t(lang, "methodology.expiring_intro")}</p>
          <List lang={lang} vars={{ "methodology.expiring_pro": { n: EXPIRING_TEASER_ROWS } }} keys={[
            "methodology.expiring_candidates", "methodology.expiring_once", "methodology.expiring_windows",
            "methodology.expiring_pro", "methodology.expiring_filters", "methodology.expiring_growth", "methodology.expiring_value", "methodology.expiring_feeds",
          ]} />
          <p>{t(lang, "methodology.expiring_claim")}</p>

          <h2 id="analytics">{t(lang, "methodology.toc_analytics")}</h2>
          <p>{t(lang, "methodology.analytics_intro")}</p>
          <List lang={lang} vars={{ "methodology.analytics_entrants": { n: ENTRANT_LOOKBACK }, "methodology.analytics_pro": { n: FREE_YEARS } }} keys={[
            "methodology.analytics_fiscal", "methodology.analytics_late_award", "methodology.analytics_period", "methodology.analytics_counting", "methodology.analytics_sources",
            "methodology.analytics_segments", "methodology.analytics_shares", "methodology.analytics_values", "methodology.analytics_growth",
            "methodology.analytics_records", "methodology.analytics_due", "methodology.analytics_entrants", "methodology.analytics_people",
            "methodology.analytics_pro", "methodology.analytics_date",
          ]} />

          <h2 id="matching">{t(lang, "methodology.toc_matching")}</h2>
          <p>{t(lang, "methodology.matching_what")}</p>
          <p>{t(lang, "methodology.matching_read", { years: fmtInt(MATCH_YEARS, lang) })}</p>
          <div class="table-wrap">
            <Table sorting="none" cols={[
              { kind: "main", label: t(lang, "methodology.matching_col_rule") },
              { kind: "label", label: t(lang, "methodology.matching_col_points") },
            ]}>
              <tbody>
                {MATCH_RULES.map(([key, points]) => (
                  <tr>
                    <td data-label={t(lang, "methodology.matching_col_rule")}>
                      {t(lang, key, { many: fmtInt(MATCH_MANY, lang), few: fmtInt(MATCH_MANY - 1, lang) })}
                    </td>
                    <td data-label={t(lang, "methodology.matching_col_points")} class="mono">{points.map((n) => fmtInt(n, lang)).join(" / ")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p>
            {t(lang, "methodology.matching_bands", {
              max: fmtInt(MATCH_MAX, lang), close: fmtInt(BAND_CLOSE, lang), partial: fmtInt(BAND_PARTIAL, lang),
            })}
          </p>
          <p>{t(lang, "methodology.matching_limits", { min: fmtInt(MATCH_MIN, lang) })}</p>

          <h2 id="holders">{t(lang, tocKey("holders", "methodology.toc_holders"))}</h2>
          <p>{t(lang, "methodology.holders_what")}</p>
          <p>{t(lang, "methodology.holders_cell", { chars: fmtInt(CODE_CHARS, lang), years: fmtInt(LINE_YEARS, lang) })}</p>
          <p>{t(lang, "methodology.holders_run", { gap: fmtInt(RUN_GAP_DAYS, lang), overlap: fmtInt(RUN_OVERLAP_DAYS, lang) })}</p>
          <div class="table-wrap">
            <Table sorting="none" cols={[
              { kind: "label", label: t(lang, "methodology.holders_col_label") },
              { kind: "main", label: t(lang, "methodology.holders_col_rule") },
            ]}>
              <tbody>
                {HOLDER_RULES.map(([band, key]) => (
                  <tr>
                    <td data-label={t(lang, "methodology.holders_col_label")}>{t(lang, BAND_KEY[band])}</td>
                    <td data-label={t(lang, "methodology.holders_col_rule")}>{t(lang, key, { long: fmtInt(LONG_RUN, lang) })}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <p>{t(lang, "methodology.holders_similar", { prefix: fmtInt(SIMILAR_PREFIX, lang), group: fmtInt(SIMILAR_GROUP_MAX, lang) })}</p>
          {follows ? (
            <p id="follows">
              {t(lang, "methodology.holders_follow", {
                years: fmtInt(LINE_YEARS, lang), min: pct(FOLLOW_MIN), close: pct(FOLLOW_CLOSE), before: fmtInt(FOLLOW_BEFORE_DAYS, lang),
                after: fmtInt(FOLLOW_AFTER_DAYS, lang), max: fmtInt(FOLLOW_MAX, lang),
              })}
            </p>
          ) : null}
          <p>{t(lang, "methodology.holders_limits")}</p>

          <h2 id="people">{t(lang, "methodology.toc_people")}</h2>
          <List lang={lang} keys={["methodology.people_individuals", "methodology.people_contacts", "methodology.people_officials"]} />

          <h2 id="claims">{t(lang, "methodology.toc_claims")}</h2>
          <List lang={lang} keys={["methodology.claim_records", "methodology.claim_identity", "methodology.claim_complete", "methodology.claim_totals"]} />

          <h2 id="corrections">{t(lang, "methodology.toc_corrections")}</h2>
          <p>{tj(lang, "methodology.corrections_text", { form: <a href="/corrections">{t(lang, "form.correct_title")}</a> })}</p>
          <HowToCite lang={lang} citation={stats?.citation} />
        </div>
      </div>
    </Layout>,
  );
}
