// The pool's lines on the list pages (docs/accounts.md, Seats, The pool; the
// seats design's 5.9), shown only to an account in a group: what the
// subscription holds of a figure and how much of it is this account's
// (pool.count), the line above the rows when some of the account's are past its
// allowance (pool.over), and the mark on each such row (pool.mark). Counts only:
// a member reads the group's total and its own, never another account's alone.
// An account in no group is never given a line here, so its pages keep every byte.

import type { FC } from "hono/jsx";
import { fmtInt, type Key, type Lang, t, tn } from "../i18n";
import type { PoolFigure, PoolLine } from "./pool";

export const THINGS: Readonly<Record<PoolFigure, Key>> = {
  searches: "pool.f_searches", watches: "pool.f_watches", views: "pool.f_views", dashboards: "pool.f_dashboards", keys: "pool.f_keys",
  feeds: "pool.f_feeds",
};

// "This subscription holds 97 of its 100 saved searches and briefings; 12 are this account's."
export function poolCount(lang: Lang, figure: PoolFigure, line: PoolLine): string {
  return tn(lang, "pool.count_one", "pool.count", line.own, {
    total: fmtInt(line.total, lang), cap: fmtInt(line.cap, lang), things: t(lang, THINGS[figure]), own: fmtInt(line.own, lang),
  });
}

// How many of the account's own are past its allowance, said once above the rows; null when none is.
export function poolOver(lang: Lang, figure: PoolFigure, line: PoolLine, past: number): string | null {
  if (past <= 0) return null;
  return tn(lang, "pool.over_one", "pool.over", past, { n: fmtInt(past, lang), things: t(lang, THINGS[figure]), cap: fmtInt(line.cap, lang) });
}

// The paragraph above the rows: the count, then the line on those past, when there are.
export const PoolLines: FC<{ lang: Lang; figure: PoolFigure; line: PoolLine; past: number }> = ({ lang, figure, line, past }) => {
  const over = poolOver(lang, figure, line, past);
  return (
    <>
      <p>{poolCount(lang, figure, line)}</p>
      {over ? <p>{over}</p> : null}
    </>
  );
};

// A row's mark, under its label, as a view past a plan's figure is marked.
export const PoolMark: FC<{ lang: Lang }> = ({ lang }) => (
  <><br /><span class="muted small">{t(lang, "pool.mark")}</span></>
);
