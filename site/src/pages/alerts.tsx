// /alerts: what email alerts will cover, where the form that registers
// interest sits, and the form itself with the widest filter (every new tender
// notice). Laid out like the Methodology page. Nothing is sent yet; the form
// stores what pages/interest.tsx describes.

import type { Context } from "hono";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { t, tj, type Key } from "../i18n";
import { Layout, PageHead, page } from "../layout";
import { pageSeo } from "../seo";
import { InterestBody, interestFilter } from "./interest";

const TOC: [string, Key][] = [
  ["cover", "alerts.toc_cover"],
  ["now", "alerts.toc_now"],
  ["register", "interest.title"],
  ["where", "alerts.toc_where"],
];

export async function alertsPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  const general = await interestFilter(c.env, lang, "tenders", "/tenders");
  const link = (href: string, key: Key) => <a href={href}>{t(lang, key)}</a>;
  return page(
    c,
    <Layout lang={lang} title={t(lang, "alerts.title")} dataAsOf={stats?.data_as_of ?? null} active="/alerts" seo={pageSeo("alerts", lang)}>
      <PageHead lang={lang} title={t(lang, "alerts.title")} lead={t(lang, "alerts.lead")} />
      <div class="doc-layout">
        <nav class="toc" aria-label={t(lang, "toc.label")}>
          <span class="toc-title">{t(lang, "toc.title")}</span>
          {TOC.map(([id, key]) => <a href={`#${id}`}>{t(lang, key)}</a>)}
        </nav>
        <div class="doc">

          <h2 id="cover">{t(lang, "alerts.toc_cover")}</h2>
          <p>{t(lang, "alerts.cover_intro")}</p>
          <ul>
            <li>{t(lang, "alerts.cover_tenders")}</li>
            <li>{t(lang, "alerts.cover_expiring")}</li>
            <li>{t(lang, "alerts.cover_organizations")}</li>
            <li>{t(lang, "alerts.cover_buyers")}</li>
          </ul>

          <h2 id="now">{t(lang, "alerts.toc_now")}</h2>
          <p>{t(lang, "alerts.now")}</p>
          <p>{tj(lang, "alerts.privacy", { privacy: link("/privacy#interest", "footer.privacy") })}</p>

          <h2 id="register">{t(lang, "interest.title")}</h2>
          <p>{t(lang, "alerts.register_intro")}</p>
          {general ? <InterestBody lang={lang} filter={general} /> : null}

          <h2 id="where">{t(lang, "alerts.toc_where")}</h2>
          <ul>
            <li>{tj(lang, "alerts.where_tenders", { link: link("/tenders", "rail.open") })}</li>
            <li>{tj(lang, "alerts.where_expiring", { link: link("/expiring", "alerts.link_expiring") })}</li>
            <li>{tj(lang, "alerts.where_profiles", { link: link("/organizations", "alerts.link_profiles") })}</li>
            <li>{tj(lang, "alerts.where_more", { buyers: link("/buyers", "alerts.link_buyers"), segments: link("/segments", "alerts.link_segments") })}</li>
          </ul>
        </div>
      </div>
      <script src="/interest.js" defer></script>
    </Layout>,
  );
}
