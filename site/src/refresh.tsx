// The top bar's two timers beside the data date: the time until the next
// nightly run and the next same-day cut, each a label over the time left,
// or over the time a run under way was due. The server writes the figure
// from the page's clock and public/refresh.js rewrites it from the
// visitor's, once a minute. The figure is part of the page's cached HTML,
// so a copy kept for its five minutes reads a little long until the script
// runs; minutes round down, so it never reads past the run.
//
// A run's data appears some time after its scheduled start, so each timer
// carries the stamp of the data the page was built from (data-data-at): the
// nightly's for the daily timer, from stats.json (dataStamp in data.ts),
// and the last same-day cut's for the sub-daily one, which only a page
// drawn from the same-day notices has (a Pro reader's band, sameDayView in
// pages/intraday.tsx, which reads it with the rows). From a run's scheduled
// time until its stamp is later, the figure reads "Under way since 13:45";
// the rule is refreshState in public/refresh.js, which this file imports,
// so the first render and the script agree. A timer without a stamp is a
// countdown in the first render (no search-database read for the page);
// the script reads it as under way, provisionally, once its run's time
// comes, and asks for its stamp. /refresh.json (refreshStampsRoute) gives
// the script the current stamps while a run is under way.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { accountsEnabled } from "./account/switch";
import { clockOf } from "./closing";
import { countdownText, refreshState, runningText, templatePieces } from "../public/refresh.js";
import { dataStamp, loadStats } from "./data";
import type { AppEnv } from "./env";
import { t, type Key, type Lang } from "./i18n";
import { loadLastCut } from "./intraday";
import { ProTag } from "./pro";

// The nightly run's start (UTC): the "30 12 * * *" schedule in
// .github/workflows/nightly.yml. The new files follow within about an hour.
// test/refresh.test.ts reads the workflow and compares.
export const DAILY_RUNS_UTC: readonly string[] = ["12:30"];

// The same-day cuts (UTC): minute 45 of every odd hour from 11 to 23, then
// of 1 and 3, the two schedules in .github/workflows/intraday.yml (read and
// compared by the same test).
export const SAME_DAY_RUNS_UTC: readonly string[] = [
  "11:45", "13:45", "15:45", "17:45", "19:45", "21:45", "23:45", "01:45", "03:45",
];

// The page on the same-day notices, which are part of Pro.
export const SAME_DAY_HREF = "/tenders/same-day";

// The data stamps a page was built from, as /refresh.json names them: ISO
// UTC times, null when unknown.
export type RefreshStamps = { daily: string | null; same_day: string | null };

export function refreshWords(lang: Lang) {
  return {
    now: t(lang, "refresh.now"), hm: templatePieces(t(lang, "refresh.hm")), m: templatePieces(t(lang, "refresh.m")),
    since: templatePieces(t(lang, "refresh.since")), since_short: templatePieces(t(lang, "refresh.since_short")),
  };
}

type Figure = { text: string } | { full: string; short: string };

// A timer's first figure, by the script's rule, with the time of a run
// under way in UTC (the server does not know the visitor's zone; the
// script rewrites it in theirs).
export function refreshFigure(now: number, runs: readonly string[], dataAt: string | null | undefined, words: ReturnType<typeof refreshWords>): Figure | null {
  const state = refreshState(now, runs, dataAt);
  if (!state) return null;
  return state.state === "running" ? runningText(state.since, words, true) : { text: countdownText(now, state.target, words) };
}

// The label, then the figure the script rewrites. The space between them is
// not drawn (each is a line of its own) but keeps the two words apart for a
// screen reader and in the page's text. A label whose short form differs
// carries both, and the stylesheet shows the short one below 1440 px, where
// the French labels whole would squeeze the search field under its
// placeholder; the English ones fit whole at every width. A run under way
// carries both forms of its figure the same way, in both languages. The
// figure's slot holds text or those two spans and nothing else, which the
// ETag (src/conditional.ts) leaves out.
const Line: FC<{ lang: Lang; label: Key; short: Key; figure: Figure | null }> = ({ lang, label, short, figure }) => {
  const full = t(lang, label);
  const brief = t(lang, short);
  return (
    <span class="refresh-line">
      <span class="refresh-label">
        {brief === full ? full : <><span class="refresh-short">{brief}</span><span class="refresh-full">{full}</span></>}
      </span> <span class="refresh-left">
        {figure === null ? null : "text" in figure ? figure.text
          : <><span class="refresh-short">{figure.short}</span><span class="refresh-full">{figure.full}</span></>}
      </span>
    </span>
  );
};

// Hidden below 1200 px, where the top bar has no room for them (public/styles.css).
// on: the accounts switch. While it is off nothing is Pro, so the same-day
// timer carries no chip and leads to the tender list rather than the tease.
// stamps: the data the page was built from; absent or null, a timer counts
// down as it did before stamps.
export const RefreshTimers: FC<{ lang: Lang; now: number; on: boolean; stamps?: Partial<RefreshStamps> }> = ({ lang, now, on, stamps }) => {
  const words = refreshWords(lang);
  const daily = stamps?.daily ?? undefined;
  const sameDay = stamps?.same_day ?? undefined;
  return (
    <span class="refresh-timers" data-hm={JSON.stringify(words.hm)} data-m={JSON.stringify(words.m)}
      data-since={JSON.stringify(words.since)} data-since-short={JSON.stringify(words.since_short)}
      data-reload={t(lang, "refresh.reload")} data-reload-short={t(lang, "refresh.reload_short")}>
      <span class="refresh" data-refresh-runs={DAILY_RUNS_UTC.join(" ")} data-now={words.now} data-refresh-key="daily" data-data-at={daily}>
        <Line lang={lang} label="refresh.daily_label" short="refresh.daily_label_short" figure={refreshFigure(now, DAILY_RUNS_UTC, daily, words)} />
      </span>
      {/* Marked Pro for every reader while the switch is on: the same-day notices are part of Pro. */}
      <a class="refresh" href={on ? SAME_DAY_HREF : "/tenders"} data-refresh-runs={SAME_DAY_RUNS_UTC.join(" ")} data-now={words.now}
        data-refresh-key="same_day" data-data-at={sameDay}>
        <Line lang={lang} label="refresh.same_day_label" short="refresh.same_day_label_short" figure={refreshFigure(now, SAME_DAY_RUNS_UTC, sameDay, words)} />
        {on ? <ProTag lang={lang} /> : null}
      </a>
      <script type="module" src="/refresh.js"></script>
    </span>
  );
};

// -- /refresh.json -----------------------------------------------------------------

// The stamps a page under way asks for, every three minutes until its run's
// data is in, and once at load soon after a run (public/refresh.js), from
// the sources the pages read: the nightly's from stats.json, and the last
// same-day cut's from the search database's run log, read at most once a
// minute an isolate whatever the number of pages asking. That read happens
// only while the accounts switch is on: with it off nothing is Pro, the
// same-day workflow reads nothing for anyone, and same_day is null, which
// returns a provisional timer to its countdown. Public and cached a
// minute, since it is the same for every reader; it reads no session.
export const STAMPS_MAX_AGE = 60;

// Pages without the band have no same-day stamp, and their timer goes under
// way provisionally when a cut is due, until this answer says otherwise
// (public/refresh.js). The same-day workflow stops without a run row while
// no paid plan is live, so its last stamp can be days old; read as a cut
// still under way, it would hold every such timer there. A stamp older
// than this (the night's eight hours without a cut, and two cuts more) is
// answered as none, and those timers count down as before.
export const SAME_DAY_STAMP_MAX_HOURS = 12;

let keptCut: { at: number; value: string | null } | null = null;

// For the tests: the next request reads the run log again.
export function forgetRefreshStamps(): void {
  keptCut = null;
}

async function sameDayStamp(c: Context<AppEnv>): Promise<string | null> {
  const db = c.env.SEARCH;
  if (!accountsEnabled(c.env) || !db) return null;
  const read = Date.now();
  if (!keptCut || read - keptCut.at >= STAMPS_MAX_AGE * 1000) keptCut = { at: read, value: await loadLastCut(db) };
  const value = keptCut.value;
  const age = value ? clockOf(c.env).now - Date.parse(value) : Number.NaN;
  return value && age <= SAME_DAY_STAMP_MAX_HOURS * 3600000 ? value : null;
}

export async function refreshStampsRoute(c: Context<AppEnv>): Promise<Response> {
  const [stats, sameDay] = await Promise.all([loadStats(c.env).catch(() => null), sameDayStamp(c)]);
  const body: RefreshStamps = { daily: stats ? dataStamp(stats) : null, same_day: sameDay };
  c.header("Cache-Control", `public, max-age=${STAMPS_MAX_AGE}`);
  return c.json(body);
}
