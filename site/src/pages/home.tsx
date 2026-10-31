import type { Context } from "hono";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, t, tj, type Key, type Lang } from "../i18n";
import { Layout, noDataPage, page, todayOf } from "../layout";
import { homeJsonLd, pageSeo } from "../seo";
import { FeedLinks } from "./feeds";
import { AwardTable, OrgTotalTable, TenderTable } from "./shared";

type CountKey = "tenders_open" | "tenders_new_today" | "organizations" | "awards" | "history" | "contracts" | "grants" | "buyers";

// One tile per count, each linking to the page that lists what it counts. A
// count the file does not carry leaves its tile out.
const TILES: { count: CountKey; label: Key; note: Key; href: string }[] = [
  { count: "tenders_open", label: "home.tile_open", note: "home.tile_open_note", href: "/tenders" },
  { count: "tenders_new_today", label: "home.tile_new", note: "home.tile_new_note", href: "/tenders/new" },
  { count: "awards", label: "home.tile_awards", note: "home.tile_awards_note", href: "/awards" },
  { count: "organizations", label: "home.tile_organizations", note: "home.tile_organizations_note", href: "/organizations" },
  { count: "contracts", label: "home.tile_contracts", note: "home.tile_contracts_note", href: "/data#sources" },
  { count: "grants", label: "home.tile_grants", note: "home.tile_grants_note", href: "/data#sources" },
  { count: "history", label: "home.tile_history", note: "home.tile_history_note", href: "/data#sources" },
  { count: "buyers", label: "home.tile_buyers", note: "home.tile_buyers_note", href: "/buyers" },
];

const Empty = ({ lang, k }: { lang: Lang; k: Key }) => <p class="muted">{t(lang, k)}</p>;

export async function homePage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "site.name");
  const today = todayOf(stats.data_as_of);
  const year = today.slice(0, 4);
  const tiles = TILES.filter((tile) => stats.counts[tile.count] !== undefined);

  return page(
    c,
    <Layout lang={lang} title={t(lang, "site.name")} dataAsOf={stats.data_as_of} seo={pageSeo("home", lang, { jsonLd: [homeJsonLd(lang)] })}
      head={<FeedLinks lang={lang} />}>
      <section class="hero">
        <h1>{t(lang, "home.title")}</h1>
        <p class="lead">{t(lang, "home.lead")}</p>
        <div class="quick-links">
          <a href="/tenders">{t(lang, "home.quick_open")}</a>
          <a href="/tenders?closing=7">{t(lang, "home.quick_closing")}</a>
          <a href="/tenders/new">{t(lang, "home.quick_new")}</a>
          <a href="/awards">{t(lang, "home.quick_awards")}</a>
          <a href="/organizations">{t(lang, "home.quick_directory")}</a>
        </div>
      </section>

      {tiles.length ? (
        <section class="tiles" aria-label={t(lang, "home.tiles_label")}>
          {tiles.map((tile) => (
            <a class="tile" href={tile.href}>
              <span class="tile-label">{t(lang, tile.label)}</span>
              <span class="tile-value">{fmtInt(stats.counts[tile.count], lang)}</span>
              <span class="tile-note">{t(lang, tile.note)}</span>
            </a>
          ))}
        </section>
      ) : null}

      <section class="topic">
        <div class="topic-head">
          <h2>{t(lang, "home.new_heading")}</h2>
          <a href="/tenders/new">{t(lang, "home.new_all")}</a>
        </div>
        {stats.new_tenders.length ? <TenderTable lang={lang} rows={stats.new_tenders} today={today} /> : <Empty lang={lang} k="home.new_none" />}
      </section>

      <section class="topic">
        <div class="topic-head">
          <h2>{t(lang, "home.closing_heading")}</h2>
          <a href="/tenders?closing=7">{t(lang, "home.closing_all")}</a>
        </div>
        {stats.closing_soon.length ? <TenderTable lang={lang} rows={stats.closing_soon} today={today} /> : <Empty lang={lang} k="home.closing_none" />}
      </section>

      <section class="topic">
        <div class="topic-head">
          <h2>{t(lang, "home.awards_heading")}</h2>
          <a href="/awards">{t(lang, "home.awards_all")}</a>
        </div>
        {stats.recent_awards.length ? <AwardTable lang={lang} rows={stats.recent_awards} /> : <Empty lang={lang} k="home.awards_none" />}
      </section>

      <section class="topic">
        <div class="topic-head">
          <h2>{t(lang, "home.top_heading", { year })}</h2>
          <a href={`/rankings/${year}`}>{t(lang, "home.top_all")}</a>
        </div>
        <p class="muted small">{t(lang, "home.top_note")}</p>
        {stats.top_organizations_year.length ? <OrgTotalTable lang={lang} rows={stats.top_organizations_year} rank /> : <Empty lang={lang} k="home.top_none" />}
      </section>

      <section class="panel">
        <h2>{t(lang, "home.read_heading")}</h2>
        <ul>
          <li>{t(lang, "home.read_records")}</li>
          <li>{t(lang, "home.read_sources")}</li>
          <li>{t(lang, "home.read_competitive")}</li>
          <li>{tj(lang, "home.read_more", { methodology: <a href="/methodology">{t(lang, "nav.methodology")}</a> })}</li>
        </ul>
      </section>
    </Layout>,
  );
}
