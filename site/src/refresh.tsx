// The top bar's two timers beside the data date: the time until the next
// nightly run and the next same-day cut. The server writes each line from
// the page's clock and public/refresh.js rewrites it from the visitor's,
// once a minute; neither reads anything. The line is part of the page's
// cached HTML, so a copy kept for its five minutes reads a little long until
// the script runs; minutes round down, so it never reads past the run.

import type { FC } from "hono/jsx";
import { refreshText, templatePieces } from "../public/refresh.js";
import { t, type Lang } from "./i18n";
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

function words(lang: Lang, key: "refresh.daily" | "refresh.same_day") {
  return {
    in: templatePieces(t(lang, key)), now: t(lang, `${key}_now`),
    hm: templatePieces(t(lang, "refresh.hm")), m: templatePieces(t(lang, "refresh.m")),
  };
}

// Hidden below 1200 px, where the top bar has no room for them; stacked
// below 1440 (public/styles.css).
// on: the accounts switch. While it is off nothing is Pro, so the same-day
// timer carries no chip and leads to the tender list rather than the tease.
export const RefreshTimers: FC<{ lang: Lang; now: number; on: boolean }> = ({ lang, now, on }) => {
  const daily = words(lang, "refresh.daily");
  const sameDay = words(lang, "refresh.same_day");
  return (
    <span class="refresh-timers" data-hm={JSON.stringify(daily.hm)} data-m={JSON.stringify(daily.m)}>
      <span class="refresh" data-refresh-runs={DAILY_RUNS_UTC.join(" ")} data-in={JSON.stringify(daily.in)} data-now={daily.now}>
        <span class="refresh-line">{refreshText(now, DAILY_RUNS_UTC, daily)}</span>
      </span>
      {/* Marked Pro for every reader while the switch is on: the same-day notices are part of Pro. */}
      <a class="refresh" href={on ? SAME_DAY_HREF : "/tenders"} data-refresh-runs={SAME_DAY_RUNS_UTC.join(" ")} data-in={JSON.stringify(sameDay.in)}
        data-now={sameDay.now}>
        <span class="refresh-line">{refreshText(now, SAME_DAY_RUNS_UTC, sameDay)}</span>{on ? <> <ProTag lang={lang} /></> : null}
      </a>
      <script type="module" src="/refresh.js"></script>
    </span>
  );
};
