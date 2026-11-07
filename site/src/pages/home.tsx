import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { accountsEnabled } from "../account/switch";
import { clockOf, closingSoonByDay, tenderState } from "../closing";
import { CLOSING_SOON_DAYS } from "../constants";
import { STATS_LIST_ROWS, closingSoonTotal, loadExpiringIndex, loadOpenFirst, loadRail, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, fmtMoneyShort, t, tj, tn, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, noDataPage, page, todayOf } from "../layout";
import { allowsIntraday, requestPlan } from "../plan";
import { homeJsonLd, pageSeo } from "../seo";
import { newestFirst } from "./awards";
import { FeedLinks } from "./feeds";
import { CanadaMapPanel, mapLayers } from "./home_map";
import { sameDayMapCounts } from "./intraday";
import { AwardTable, CountdownScript, OrgTotalTable, SegmentNote, TenderTable } from "./shared";

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
// the contracts ending within 3 months. side: the figures beside the main
// one, a label and a figure a line, each from a file the page already reads;
// a tile whose export lacks them has none.
type Side = { label: string; value: string }[];
type Tile = { label: string; note: string; href: string; value: number; soon?: boolean; side?: Side };

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
  const row = (label: string, value: string) => ({ label, value });
  // Closing soon by closing day, from the export's closing times only: with
  // the ones closing today (the note) the three add up to the figure, which
  // the rows of open-first.json do not guarantee.
  const byDay = stats.closing_soon_times ? closingSoonByDay(stats.closing_soon_times, clock) : null;
  // The award notices of the last 30 days and what they add up to, and the
  // organizations the year's notices name, when the export writes them.
  const n30 = stats.counts.awards_30d;
  const total30 = stats.totals?.awards_30d;
  const suppliers = stats.counts.awards_year_suppliers;
  const awardsSide: Side = [
    ...(n30 !== undefined ? [row(t(lang, "home.side_30d"), fmtInt(n30, lang))] : []),
    ...(n30 !== undefined && typeof total30 === "number" ? [row(t(lang, "home.side_worth"), fmtMoneyShort(total30, lang))] : []),
    ...(suppliers !== undefined ? [row(t(lang, "home.side_suppliers"), fmtInt(suppliers, lang))] : []),
  ];
  // The radar's longer windows, which the rail gives only in part, and the
  // 3-month window's contracts with no value, which its "Worth" leaves out.
  const windowN = (w: string) => index?.windows.find((x) => x.window === w)?.n;
  const n6 = windowN("6m");
  const n12 = windowN("12m");
  const noValue = expiring?.n_no_value;
  const endingSide: Side = [
    ...(n6 !== undefined ? [row(t(lang, "home.side_6m"), fmtInt(n6, lang))] : []),
    ...(n12 !== undefined ? [row(t(lang, "home.side_12m"), fmtInt(n12, lang))] : []),
    ...(typeof noValue === "number" ? [row(t(lang, "home.side_no_value"), fmtInt(noValue, lang))] : []),
  ];
  const tiles: Tile[] = [];
  if (soonTotal !== undefined) {
    tiles.push({
      label: t(lang, "rail.closing", { n: CLOSING_SOON_DAYS }), href: "/tenders?closing=7", value: soonTotal, soon: true,
      note: closingToday === 0 ? t(lang, "home.tile_closing_none")
        : tn(lang, "home.tile_closing_one", "home.tile_closing_many", closingToday, { n: fmtInt(closingToday, lang) }),
      side: byDay ? [
        row(t(lang, "home.side_tomorrow"), fmtInt(byDay.day1, lang)),
        row(t(lang, "home.side_in_2_days"), fmtInt(byDay.day2, lang)),
        row(t(lang, "home.side_days_3_7", { n: CLOSING_SOON_DAYS }), fmtInt(byDay.later, lang)),
      ] : undefined,
    });
  }
  if (awardsYear !== undefined) {
    tiles.push({
      label: t(lang, "rail.awards_year_full", { year }), href: `/awards/${year}`, value: awardsYear,
      note: awardsYearTotal !== null ? t(lang, "home.tile_value", { total: fmtMoneyShort(awardsYearTotal, lang) }) : t(lang, "home.tile_awards_year_note"),
      side: awardsSide.length ? awardsSide : undefined,
    });
  }
  if (expiring) {
    tiles.push({
      label: t(lang, "home.tile_expiring"), href: "/expiring/3m", value: expiring.n,
      note: expiring.total === null ? t(lang, "home.tile_expiring_note") : t(lang, "home.tile_value", { total: fmtMoneyShort(expiring.total, lang) }),
      side: endingSide.length ? endingSide : undefined,
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
  // The newest award notices by award date (stats.json picks them so, leaving
  // out a date past the data date), in the order of the Awarded column.
  const recentAwards = newestFirst(stats.recent_awards);
  // The Canada map, when the export writes its counts (an older one has none
  // and the page has no map). Its same-day layer is counted for every reader;
  // the plan is read only to pick where that layer's links lead.
  const sameDay = stats.map ? await sameDayMapCounts(c, stats.data_as_of) : null;
  const proSameDay = sameDay ? allowsIntraday(await requestPlan(c)) : false;
  const mapLayerList = stats.map ? mapLayers(lang, stats.map, sameDay, proSameDay, today) : null;
  // The note on the segment chips, once: in the foot of the first list that
  // has them, so the rows start right under the head band.
  const chipsFirst = newToday.some((r) => r.segments.length);
  const chipsSoon = !chipsFirst && closingSoon.some((r) => r.segments.length);

  return page(
    c,
    <Layout lang={lang} title={t(lang, "site.name")} dataAsOf={stats.data_as_of} seo={pageSeo("home", lang, { jsonLd: [homeJsonLd(lang)] })}
      head={<FeedLinks lang={lang} />}>
      <PageHead lang={lang} title={t(lang, "home.title")} lead={homeLead(lang, stats.counts.organizations)}
        actions={<>
          <a href="/feeds" class="btn">{t(lang, "feeds.button_all")}</a>
          <a href="/data#downloads" class="btn">{t(lang, "footer.download")}</a>
        </>} />

      {mapLayerList ? <CanadaMapPanel lang={lang} layers={mapLayerList} /> : null}

      {tiles.length ? (
        <section class="tiles" aria-label={t(lang, "home.tiles_label")}>
          {tiles.map((tile) => (
            <a class={tile.soon ? "tile tile-soon" : "tile"} href={tile.href}>
              <span class="tile-label">{tile.label}</span>
              <span class="tile-value" data-soon-count={tile.soon ? "" : undefined}>{fmtInt(tile.value, lang)}</span>
              <span class="tile-note">{tile.note}</span>
              {tile.side ? (
                <span class="tile-side">
                  {tile.side.map((s) => (
                    <span class="tile-side-row"><span class="tile-side-label">{s.label}</span><span class="tile-side-value">{s.value}</span></span>
                  ))}
                </span>
              ) : null}
            </a>
          ))}
        </section>
      ) : null}

      <HomeDo lang={lang} pro={accountsEnabled(c.env)} />

      <Panel title={t(lang, "home.new_heading")} tools={<a href="/tenders/new">{t(lang, "home.new_all")}</a>}
        foot={chipsFirst ? <SegmentNote lang={lang} rows={newToday} /> : undefined}>
        {newToday.length ? <TenderTable lang={lang} rows={newToday} clock={clock} note={false} variant="home" /> : <Empty lang={lang} k="home.new_none" />}
      </Panel>

      <Panel title={t(lang, "home.closing_heading")} class="soon" tools={<a href="/tenders?closing=7">{t(lang, "home.closing_all")}</a>}
        foot={chipsSoon ? <SegmentNote lang={lang} rows={closingSoon} /> : undefined}
        count={soonTotal !== undefined ? <span data-soon-count="">{fmtInt(soonTotal, lang)}</span> : undefined}>
        {closingSoon.length ? <TenderTable lang={lang} rows={closingSoon} clock={clock} timeLeft note={false} variant="home" /> : <Empty lang={lang} k="home.closing_none" />}
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

// -- search framing (docs/seo.md) -------------------------------------------------

// The lead, with the organizations stats.json counts when it carries them.
export function homeLead(lang: Lang, organizations: number | undefined): string {
  return organizations ? t(lang, "home.lead_n", { n: fmtInt(organizations, lang) }) : t(lang, "home.lead");
}

// What a reader can do here, one line a task, each led by its link: the
// tasks search brings readers for. The email line leads to the Pro page
// while the accounts switch is on and is left out while it is off (nothing
// is Pro then). It names Pro in words and carries no chip: the home page's
// one chip is on the map's Same day button (test/pro-mark.test.ts).
const HOME_DO: readonly { text: Key; link: Key; href: string }[] = [
  { text: "home.do_tenders", link: "home.do_tenders_link", href: "/tenders" },
  { text: "home.do_awards", link: "home.do_awards_link", href: "/awards" },
  { text: "home.do_expiring", link: "home.do_expiring_link", href: "/expiring" },
];

export const HomeDo: FC<{ lang: Lang; pro: boolean }> = ({ lang, pro }) => (
  <Panel title={t(lang, "home.do_heading")} class="home-do">
    <ul class="home-do-list">
      {HOME_DO.map((d) => <li>{tj(lang, d.text, { link: <a href={d.href}>{t(lang, d.link)}</a> })}</li>)}
      {pro ? (
        <li class="home-do-pro">{tj(lang, "home.do_pro", { link: <a href="/pro">{t(lang, "home.do_pro_link")}</a> })}</li>
      ) : null}
    </ul>
  </Panel>
);
