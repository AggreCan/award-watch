// The top bar's two timers beside the data date: the time until the next
// nightly run and the next same-day cut, each a label over the time left.
// The server writes the time left from the page's clock and
// public/refresh.js rewrites it from the visitor's, once a minute; neither
// reads anything. The figure is part of the page's cached HTML, so a copy
// kept for its five minutes reads a little long until the script runs;
// minutes round down, so it never reads past the run.

import type { FC } from "hono/jsx";
import { refreshText, templatePieces } from "../public/refresh.js";
import { t, type Key, type Lang } from "./i18n";
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

export function refreshWords(lang: Lang) {
  return { now: t(lang, "refresh.now"), hm: templatePieces(t(lang, "refresh.hm")), m: templatePieces(t(lang, "refresh.m")) };
}

// The label, then the figure the script rewrites. The space between them is
// not drawn (each is a line of its own) but keeps the two words apart for a
// screen reader and in the page's text. A label whose short form differs
// carries both, and the stylesheet shows the short one below 1440 px, where
// the French labels whole would squeeze the search field under its
// placeholder; the English ones fit whole at every width.
const Line: FC<{ lang: Lang; label: Key; short: Key; left: string | null }> = ({ lang, label, short, left }) => {
  const full = t(lang, label);
  const brief = t(lang, short);
  return (
    <span class="refresh-line">
      <span class="refresh-label">
        {brief === full ? full : <><span class="refresh-short">{brief}</span><span class="refresh-full">{full}</span></>}
      </span> <span class="refresh-left">{left}</span>
    </span>
  );
};

// Hidden below 1200 px, where the top bar has no room for them (public/styles.css).
// on: the accounts switch. While it is off nothing is Pro, so the same-day
// timer carries no chip and leads to the tender list rather than the tease.
export const RefreshTimers: FC<{ lang: Lang; now: number; on: boolean }> = ({ lang, now, on }) => {
  const words = refreshWords(lang);
  return (
    <span class="refresh-timers" data-hm={JSON.stringify(words.hm)} data-m={JSON.stringify(words.m)}>
      <span class="refresh" data-refresh-runs={DAILY_RUNS_UTC.join(" ")} data-now={words.now}>
        <Line lang={lang} label="refresh.daily_label" short="refresh.daily_label_short" left={refreshText(now, DAILY_RUNS_UTC, words)} />
      </span>
      {/* Marked Pro for every reader while the switch is on: the same-day notices are part of Pro. */}
      <a class="refresh" href={on ? SAME_DAY_HREF : "/tenders"} data-refresh-runs={SAME_DAY_RUNS_UTC.join(" ")} data-now={words.now}>
        <Line lang={lang} label="refresh.same_day_label" short="refresh.same_day_label_short" left={refreshText(now, SAME_DAY_RUNS_UTC, words)} />
        {on ? <> <ProTag lang={lang} /></> : null}
      </a>
      <script type="module" src="/refresh.js"></script>
    </span>
  );
};
