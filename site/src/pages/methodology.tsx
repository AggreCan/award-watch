import type { Context } from "hono";
import { HowToCite } from "../cite";
import { CLOSING_SOON_DAYS } from "../constants";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { t, tj, type Key } from "../i18n";
import { Layout, PageHead, page } from "../layout";
import { pageSeo } from "../seo";
import { ENTRANT_LOOKBACK, FREE_YEARS } from "../records_db";
import { EXPIRING_TEASER_ROWS } from "./expiring";

// How the site reads its sources, merges organizations and buyers, counts
// money and derives statuses and competitive flags. The "Counting money"
// section states the rules in the words the pipeline follows
// (CLAUDE.md "Counting money"); change the code and this page together. The
// "Contracts ending soon" section states the radar's rules the same way
// (CLAUDE.md "Expiring-contracts radar"). The "Analytics" section states the
// rules the analytics views count by (src/records_db.ts, docs/analytics.md).

const TOC: [string, Key][] = [
  ["sources", "methodology.toc_sources"],
  ["organizations", "methodology.toc_organizations"],
  ["buyers", "methodology.toc_buyers"],
  ["counting", "methodology.toc_counting"],
  ["competitive", "methodology.toc_competitive"],
  ["statuses", "methodology.toc_statuses"],
  ["expiring", "methodology.toc_expiring"],
  ["analytics", "methodology.toc_analytics"],
  ["people", "methodology.toc_people"],
  ["claims", "methodology.toc_claims"],
  ["corrections", "methodology.toc_corrections"],
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
  return page(
    c,
    <Layout lang={lang} title={t(lang, "methodology.title")} dataAsOf={stats?.data_as_of ?? null} active="/methodology" seo={pageSeo("methodology", lang)}>
      <PageHead lang={lang} title={t(lang, "methodology.title")} lead={t(lang, "methodology.lead")} />
      <div class="doc-layout">
        <nav class="toc" aria-label={t(lang, "toc.label")}>
          <span class="toc-title">{t(lang, "toc.title")}</span>
          {TOC.map(([id, key]) => <a href={`#${id}`}>{t(lang, key)}</a>)}
        </nav>
        <div class="doc">

          <h2 id="sources">{t(lang, "methodology.toc_sources")}</h2>
          <p>{t(lang, "methodology.sources_text")}</p>
          <List lang={lang} keys={[
            "methodology.src_tenders", "methodology.src_same_day", "methodology.src_awards", "methodology.src_history",
            "methodology.src_contracts", "methodology.src_grants", "methodology.src_lobbying", "methodology.src_registry",
          ]} />
          <p>{tj(lang, "methodology.sources_more", { data: <a href="/data#sources">{t(lang, "nav.data")}</a> })}</p>

          <h2 id="organizations">{t(lang, "methodology.toc_organizations")}</h2>
          <p>{t(lang, "methodology.org_text")}</p>
          <List lang={lang} keys={["methodology.org_rule_name", "methodology.org_rule_id", "methodology.org_rule_place", "methodology.org_rule_display"]} />
          <p>{t(lang, "methodology.org_shared")}</p>
          <p>{t(lang, "methodology.org_registry")}</p>

          <h2 id="buyers">{t(lang, "methodology.toc_buyers")}</h2>
          <p>{t(lang, "methodology.buyers_text")}</p>
          <p>{t(lang, "methodology.buyers_history")}</p>

          <h2 id="counting">{t(lang, "methodology.toc_counting")}</h2>
          <p>{t(lang, "methodology.counting_intro")}</p>
          <List lang={lang} keys={[
            "methodology.count_awards", "methodology.count_contracts", "methodology.count_grants",
            "methodology.count_years", "methodology.count_currency",
          ]} />
          <p><strong>{t(lang, "methodology.never_add")}</strong></p>

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

          <h2 id="expiring">{t(lang, "methodology.toc_expiring")}</h2>
          <p>{t(lang, "methodology.expiring_intro")}</p>
          <List lang={lang} vars={{ "methodology.expiring_pro": { n: EXPIRING_TEASER_ROWS } }} keys={[
            "methodology.expiring_candidates", "methodology.expiring_once", "methodology.expiring_windows",
            "methodology.expiring_pro", "methodology.expiring_growth", "methodology.expiring_value", "methodology.expiring_feeds",
          ]} />
          <p>{t(lang, "methodology.expiring_claim")}</p>

          <h2 id="analytics">{t(lang, "methodology.toc_analytics")}</h2>
          <p>{t(lang, "methodology.analytics_intro")}</p>
          <List lang={lang} vars={{ "methodology.analytics_entrants": { n: ENTRANT_LOOKBACK }, "methodology.analytics_pro": { n: FREE_YEARS } }} keys={[
            "methodology.analytics_fiscal", "methodology.analytics_counting", "methodology.analytics_sources", "methodology.analytics_segments",
            "methodology.analytics_shares", "methodology.analytics_entrants", "methodology.analytics_people", "methodology.analytics_pro",
            "methodology.analytics_date",
          ]} />

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
