import type { Context } from "hono";
import { HowToCite } from "../cite";
import { CLOSING_SOON_DAYS } from "../constants";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { t, tj, type Key } from "../i18n";
import { Layout, page } from "../layout";
import { pageSeo } from "../seo";

// How the site reads its sources, merges organizations and buyers, counts
// money and derives statuses and competitive flags. The "Counting money"
// section states the rules in the words the pipeline follows
// (CLAUDE.md "Counting money"); change the code and this page together.

const TOC: [string, Key][] = [
  ["sources", "methodology.toc_sources"],
  ["organizations", "methodology.toc_organizations"],
  ["buyers", "methodology.toc_buyers"],
  ["counting", "methodology.toc_counting"],
  ["competitive", "methodology.toc_competitive"],
  ["statuses", "methodology.toc_statuses"],
  ["people", "methodology.toc_people"],
  ["claims", "methodology.toc_claims"],
  ["corrections", "methodology.toc_corrections"],
];

const List = ({ keys, lang }: { keys: Key[]; lang: "en" | "fr" }) => (
  <ul>
    {keys.map((k) => <li>{t(lang, k)}</li>)}
  </ul>
);

export async function methodologyPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "methodology.title")} dataAsOf={stats?.data_as_of ?? null} seo={pageSeo("methodology", lang)}>
      <div class="doc-layout">
        <nav class="toc" aria-label={t(lang, "toc.label")}>
          <span class="toc-title">{t(lang, "toc.title")}</span>
          {TOC.map(([id, key]) => <a href={`#${id}`}>{t(lang, key)}</a>)}
        </nav>
        <div class="doc">
          <h1>{t(lang, "methodology.title")}</h1>
          <p class="lead">{t(lang, "methodology.lead")}</p>

          <h2 id="sources">{t(lang, "methodology.toc_sources")}</h2>
          <p>{t(lang, "methodology.sources_text")}</p>
          <List lang={lang} keys={[
            "methodology.src_tenders", "methodology.src_awards", "methodology.src_history", "methodology.src_contracts",
            "methodology.src_grants", "methodology.src_lobbying", "methodology.src_registry",
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
          <p>{t(lang, "methodology.status_awards")}</p>
          <p>{t(lang, "methodology.status_regions")}</p>

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
