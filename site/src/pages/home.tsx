import type { Context } from "hono";
import { clockOf, tenderState } from "../closing";
import { CLOSING_SOON_DAYS } from "../constants";
import { STATS_LIST_ROWS, closingSoonTotal, loadExpiringIndex, loadOpenFirst, loadRail, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, fmtMoneyShort, t, tj, tn, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, noDataPage, page, todayOf } from "../layout";
import { homeJsonLd, pageSeo } from "../seo";
import { newestFirst } from "./awards";
import { FeedLinks } from "./feeds";
import { AwardTable, CountdownScript, OrgTotalTable, TenderTable } from "./shared";

type CountKey = "contracts" | "grants" | "history";

// The standing totals the rail does not carry, each linking to where the
// source is described; a count the file does not carry is left out.
const HELD: { count: CountKey; label: Key; note: Key; href: string }[] = [
  { count: "contracts", label: "home.tile_contracts", note: "home.tile_contracts_note", href: "/data#sources" },
  { count: "grants", label: "home.tile_grants", note: "home.tile_grants_note", href: "/data#sources" },
  { count: "history", label: "home.tile_history", note: "home.tile_history_note", href: "/data#sources" },
];

// The tiles carry what the rail beside them does not: how many of the notices
// closing soon close today, and the value of the year's award notices and of
// the contracts ending within 3 months.
type Tile = { label: string; note: string; href: string; value: number; soon?: boolean };

const Empty = ({ lang, k }: { lang: Lang; k: Key }) => <p class="muted">{t(lang, k)}</p>;

export async function homePage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "site.name");
  const today = todayOf(stats.data_as_of);
  const year = today.slice(0, 4);
  const clock = clockOf(c.env);
  const [index, first, rail] = await Promise.all([loadExpiringIndex(c.env).catch(() => null), loadOpenFirst(c.env), loadRail(c.env).catch(() => null)]);
  const expiring = index?.windows.find((w) => w.window === "3m");
  // Closing soon at the page's clock: a notice whose closing time has passed
  // since the nightly is left out. The first open notices
  // (tenders/open-first.json) hold every notice that could close before the
  // next nightly and the ones after them, so the panel stays full through
  // the day; stats.json's own list stands in when the file is missing.
  const closingSoon = (first?.rows ?? stats.closing_soon)
    .filter((r) => tenderState("open", r.closing, clock) === "closing")
    .slice(0, STATS_LIST_ROWS);
  const soonTotal = closingSoonTotal(stats, clock);
  // The ones closing today (Eastern time), from the export's closing times or the rows.
  const times = stats.closing_soon_times ?? (first?.rows ?? stats.closing_soon).map((r) => r.closing);
  const closingToday = times.filter((c) => tenderState("open", c, clock) === "closing" && (c ?? "").slice(0, 10) === clock.today).length;
  // The year's count as the rail reads it: its own field, else the year's award index.
  const awardsYear = rail?.awardsYear;
  const awardsYearTotal = typeof stats.totals?.awards_year === "number" ? stats.totals.awards_year : null;
  const tiles: Tile[] = [];
  if (soonTotal !== undefined) {
    tiles.push({
      label: t(lang, "rail.closing", { n: CLOSING_SOON_DAYS }), href: "/tenders?closing=7", value: soonTotal, soon: true,
      note: closingToday === 0 ? t(lang, "home.tile_closing_none")
        : tn(lang, "home.tile_closing_one", "home.tile_closing_many", closingToday, { n: fmtInt(closingToday, lang) }),
    });
  }
  if (awardsYear !== undefined) {
    tiles.push({
      label: t(lang, "rail.awards_year_full", { year }), href: `/awards/${year}`, value: awardsYear,
      note: awardsYearTotal !== null ? t(lang, "home.tile_value", { total: fmtMoneyShort(awardsYearTotal, lang) }) : t(lang, "home.tile_awards_year_note"),
    });
  }
  if (expiring) {
    tiles.push({
      label: t(lang, "home.tile_expiring"), href: "/expiring/3m", value: expiring.n,
      note: expiring.total === null ? t(lang, "home.tile_expiring_note") : t(lang, "home.tile_value", { total: fmtMoneyShort(expiring.total, lang) }),
    });
  }
  // An export without these figures: the open and the award notices, as before.
  if (tiles.length < 2) {
    tiles.length = 0;
    if (stats.counts.tenders_open !== undefined) {
      tiles.push({ label: t(lang, "home.tile_open"), note: t(lang, "home.tile_open_note"), href: "/tenders", value: stats.counts.tenders_open });
    }
    if (stats.counts.awards !== undefined) {
      tiles.push({ label: t(lang, "home.tile_awards"), note: t(lang, "home.tile_awards_note"), href: "/awards", value: stats.counts.awards });
    }
  }
  const held = HELD.flatMap((h) => (stats.counts[h.count] === undefined ? [] : [{ ...h, value: stats.counts[h.count]! }]));
  // The day's new notices: one whose closing time has passed goes after the others.
  const passed = (r: { closing: string | null }) => tenderState("open", r.closing, clock) === "closed";
  const newToday = [...stats.new_tenders.filter((r) => !passed(r)), ...stats.new_tenders.filter(passed)];
  const countdown = [...stats.new_tenders, ...closingSoon].some((r) => tenderState("open", r.closing, clock) === "closing");
  // The newest award notices published, in the order of the Awarded column.
  const recentAwards = newestFirst(stats.recent_awards);
  // The note on the segment chips, once: over the first list that has them.
  const chipsFirst = newToday.some((r) => r.segments.length);

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
            <a class={tile.soon ? "tile tile-soon" : "tile"} href={tile.href}>
              <span class="tile-label">{tile.label}</span>
              <span class="tile-value" data-soon-count={tile.soon ? "" : undefined}>{fmtInt(tile.value, lang)}</span>
              <span class="tile-note">{tile.note}</span>
            </a>
          ))}
        </section>
      ) : null}

      <Panel title={t(lang, "home.new_heading")} tools={<a href="/tenders/new">{t(lang, "home.new_all")}</a>}>
        {newToday.length ? <TenderTable lang={lang} rows={newToday} clock={clock} note={chipsFirst} /> : <Empty lang={lang} k="home.new_none" />}
      </Panel>

      <Panel title={t(lang, "home.closing_heading")} class="soon" tools={<a href="/tenders?closing=7">{t(lang, "home.closing_all")}</a>}
        count={soonTotal !== undefined ? <span data-soon-count="">{fmtInt(soonTotal, lang)}</span> : undefined}>
        {closingSoon.length ? <TenderTable lang={lang} rows={closingSoon} clock={clock} timeLeft note={!chipsFirst} /> : <Empty lang={lang} k="home.closing_none" />}
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
      {countdown ? <CountdownScript lang={lang} /> : null}
    </Layout>,
  );
}
