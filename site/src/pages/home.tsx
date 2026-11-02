import type { Context } from "hono";
import { loadExpiringIndex, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, closingPassed, noDataPage, page, todayOf } from "../layout";
import { homeJsonLd, pageSeo } from "../seo";
import { newestFirst } from "./awards";
import { FeedLinks } from "./feeds";
import { AwardTable, OrgTotalTable, TenderTable } from "./shared";

type CountKey = "tenders_open" | "tenders_new_today" | "organizations" | "awards" | "history" | "contracts" | "grants" | "buyers";

// One entry per count, each linking to the page that lists what it counts. A
// count the file does not carry is left out. The day's figures (open, new,
// award notices and, when the radar is published, the 3-month count) are the
// tiles; the standing totals are the "records held" panel beneath.
const TILES: { count: CountKey; label: Key; note: Key; href: string; tile: boolean }[] = [
  { count: "tenders_open", label: "home.tile_open", note: "home.tile_open_note", href: "/tenders", tile: true },
  { count: "tenders_new_today", label: "home.tile_new", note: "home.tile_new_note", href: "/tenders/new", tile: true },
  { count: "awards", label: "home.tile_awards", note: "home.tile_awards_note", href: "/awards", tile: true },
  { count: "organizations", label: "home.tile_organizations", note: "home.tile_organizations_note", href: "/organizations", tile: false },
  { count: "contracts", label: "home.tile_contracts", note: "home.tile_contracts_note", href: "/data#sources", tile: false },
  { count: "grants", label: "home.tile_grants", note: "home.tile_grants_note", href: "/data#sources", tile: false },
  { count: "history", label: "home.tile_history", note: "home.tile_history_note", href: "/data#sources", tile: false },
  { count: "buyers", label: "home.tile_buyers", note: "home.tile_buyers_note", href: "/buyers", tile: false },
];

type Tile = { label: Key; note: Key; href: string; value: number };

const Empty = ({ lang, k }: { lang: Lang; k: Key }) => <p class="muted">{t(lang, k)}</p>;

export async function homePage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "site.name");
  const today = todayOf(stats.data_as_of);
  const year = today.slice(0, 4);
  // The contracts ending within 3 months, after the award notices, when the
  // radar's index is published.
  const expiring = (await loadExpiringIndex(c.env))?.windows.find((w) => w.window === "3m");
  const tiles: Tile[] = [];
  const held: Tile[] = [];
  for (const entry of TILES) {
    const value = stats.counts[entry.count];
    if (value !== undefined) (entry.tile ? tiles : held).push({ label: entry.label, note: entry.note, href: entry.href, value });
    if (entry.count === "awards" && expiring) {
      tiles.push({ label: "home.tile_expiring", note: "home.tile_expiring_note", href: "/expiring/3m", value: expiring.n });
    }
  }
  // Four tiles to a row: without the radar the first standing total moves up.
  while (tiles.length < 4 && held.length) tiles.push(held.shift()!);
  // A notice whose closing date has passed is not closing soon, whatever the file says.
  const closingSoon = stats.closing_soon.filter((r) => !closingPassed(r.closing, today));
  // The newest award notices published, in the order of the Awarded column.
  const recentAwards = newestFirst(stats.recent_awards);

  return page(
    c,
    <Layout lang={lang} title={t(lang, "site.name")} dataAsOf={stats.data_as_of} seo={pageSeo("home", lang, { jsonLd: [homeJsonLd(lang)] })}
      head={<FeedLinks lang={lang} />}>
      <PageHead lang={lang} title={t(lang, "home.title")} lead={t(lang, "home.lead")}
        actions={<>
          <a href="/feeds" class="btn">{t(lang, "feeds.button_all")}</a>
          <a href="/data#downloads" class="btn">{t(lang, "footer.download")}</a>
        </>} />

      {tiles.length ? (
        <section class="tiles" aria-label={t(lang, "home.tiles_label")}>
          {tiles.map((tile) => (
            <a class="tile" href={tile.href}>
              <span class="tile-label">{t(lang, tile.label)}</span>
              <span class="tile-value">{fmtInt(tile.value, lang)}</span>
              <span class="tile-note">{t(lang, tile.note)}</span>
            </a>
          ))}
        </section>
      ) : null}

      <Panel title={t(lang, "home.new_heading")} tools={<a href="/tenders/new">{t(lang, "home.new_all")}</a>}>
        {stats.new_tenders.length ? <TenderTable lang={lang} rows={stats.new_tenders} today={today} /> : <Empty lang={lang} k="home.new_none" />}
      </Panel>

      <Panel title={t(lang, "home.closing_heading")} class="soon" tools={<a href="/tenders?closing=7">{t(lang, "home.closing_all")}</a>}>
        {closingSoon.length ? <TenderTable lang={lang} rows={closingSoon} today={today} /> : <Empty lang={lang} k="home.closing_none" />}
      </Panel>

      <Panel title={t(lang, "home.awards_heading")} tools={<a href="/awards">{t(lang, "home.awards_all")}</a>}>
        {recentAwards.length ? <AwardTable lang={lang} rows={recentAwards} /> : <Empty lang={lang} k="home.awards_none" />}
      </Panel>

      <Panel title={t(lang, "home.top_heading", { year })} tools={<a href={`/rankings/${year}`}>{t(lang, "home.top_all")}</a>}>
        <p class="muted small">{t(lang, "home.top_note")}</p>
        {stats.top_organizations_year.length ? <OrgTotalTable lang={lang} rows={stats.top_organizations_year} rank /> : <Empty lang={lang} k="home.top_none" />}
      </Panel>

      <div class="panel-grid">
        {held.length ? (
          <Panel title={t(lang, "home.records_heading")}>
            <ul class="kv">
              {held.map((h) => (
                <li>
                  <span>
                    <a href={h.href}>{t(lang, h.label)}</a>
                    <span class="kv-note">{t(lang, h.note)}</span>
                  </span>
                  <span class="num">{fmtInt(h.value, lang)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
        <Panel title={t(lang, "home.read_heading")}>
          <ul class="notes">
            <li>{t(lang, "home.read_records")}</li>
            <li>{t(lang, "home.read_sources")}</li>
            <li>{t(lang, "home.read_competitive")}</li>
            <li>{tj(lang, "home.read_more", { methodology: <a href="/methodology">{t(lang, "nav.methodology")}</a> })}</li>
            <li>{tj(lang, "home.read_about", { about: <a href="/about">{t(lang, "footer.about")}</a> })}</li>
          </ul>
        </Panel>
      </div>
    </Layout>,
  );
}
