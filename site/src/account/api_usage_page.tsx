// The API usage page, /account/api (docs/accounts.md, The keyed API): a key's
// limits on the account's plan, today's requests of each key in use against
// the daily cap, and the requests a day of each key over the USAGE_KEEP_DAYS
// days the counts are kept (api_usage.ts), drawn and then listed.
//
// routes.tsx mounts it behind the session. A plan without the keyed API has
// no usage to show and is sent to the keys page, whose gate note says what
// the plan lacks. The page reads the account's keys and two statements on
// api_usage in one batch: the days of the keys it draws (DAILY_SQL) and each
// day's total over every key (TOTAL_SQL). When they cannot be read the page
// still answers, with the limits, an empty chart and the keys page's line
// saying the counts cannot be read.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { type KeyQuota, keyQuota } from "../api_keyed_spec";
import { type AxisLabel, ChartStack, type Panel as ChartPanel, type RankedBar, RankedBars, dayPos, niceTicks, partOf, tipHead, tipText } from "../chart";
import { type Rest, Table, restClass } from "../columns";
import type { AppEnv } from "../env";
import { fmtInt, t, tj, tn, type Lang } from "../i18n";
import { PageHead, Panel } from "../layout";
import { REQUEST_LIMITS } from "../pages/docs";
import { type KeyRow, listKeys } from "./api_keys";
import { type DayCount, type DayTotal, USAGE_KEEP_DAYS, type UsageRead, dailyUsage, dayPlus, nowOf, utcDay } from "./api_usage";
import { accountPage } from "./pages";
import { ultraOnSale } from "./payments";
import type { Account } from "./session";

// The least top of the chart's axis: a key making a few requests a day (or
// none) still draws on a scale of tens rather than reaching the plot's top.
export const AXIS_FLOOR = 10;

// The USAGE_KEEP_DAYS UTC days ending today, oldest first.
export function usageDays(today: string): string[] {
  return Array.from({ length: USAGE_KEEP_DAYS }, (_, i) => dayPlus(today, i - (USAGE_KEEP_DAYS - 1)));
}

// A series of the chart and a column of its table: a key (id), or every key
// together (id null). values follow the days, a day with no row at 0.
export type UsageSeries = { id: string | null; label: string; revoked: boolean; values: number[] };

// One series a key: every key in use, then each revoked key the read has rows
// for, each group in the keys page's order; with more than one, the total
// comes first. The total is the database's over every key (TOTAL_SQL), the
// keys the read left out included; without it, the series' own sum. A name
// two series share carries the key's prefix.
export function usageSeries(
  lang: Lang, keys: readonly KeyRow[], rows: readonly DayCount[], days: readonly string[], totals?: readonly DayTotal[],
): UsageSeries[] {
  const at = new Map(days.map((d, i) => [d, i]));
  const counts = new Map<string, number[]>();
  for (const r of rows) {
    const i = at.get(r.day);
    if (i === undefined) continue;
    let values = counts.get(r.key_id);
    if (!values) counts.set(r.key_id, (values = days.map(() => 0)));
    values[i] += r.n;
  }
  const shown = [...keys.filter((k) => !k.revoked_at), ...keys.filter((k) => k.revoked_at && counts.has(k.id))];
  const named = new Map<string, number>();
  for (const k of shown) named.set(k.name, (named.get(k.name) ?? 0) + 1);
  const series: UsageSeries[] = shown.map((k) => {
    const name = (named.get(k.name) ?? 0) > 1 ? `${k.name}, aw_${k.prefix}` : k.name;
    return {
      id: k.id, label: k.revoked_at ? t(lang, "apiusage.series_revoked", { name }) : name, revoked: !!k.revoked_at,
      values: counts.get(k.id) ?? days.map(() => 0),
    };
  });
  if (series.length < 2) return series;
  const total = totals ? dayValues(totals, days) : days.map((_, i) => series.reduce((n, s) => n + s.values[i], 0));
  return [{ id: null, label: t(lang, "apiusage.series_all"), revoked: false, values: total }, ...series];
}

// Each day's total in the days' order, a day with no row at 0.
export function dayValues(totals: readonly DayTotal[], days: readonly string[]): number[] {
  const by = new Map(totals.map((r) => [r.day, r.n]));
  return days.map((d) => by.get(d) ?? 0);
}

// The table: the day's column (the main one, at least MAIN_MIN, 128 px) and a
// column a series, of the requests kind (80 px). From 700 to 1279 px of
// window the content column is 635 px at the least: six series fit (128 +
// 480 = 608), the total and five keys, KEYS_MAX. Up to 1439 px it is 951
// px: ten fit (928). The most the page shows is eleven: five keys in use
// with no request in the window, five revoked ones that have some (DAILY_SQL
// reads at most KEYS_MAX keys with rows; a line under the table counts the
// others, whose requests the total holds) and the total, 1,008 px, which the
// 1,111 px from 1440 px holds.
export const SERIES_FIT = { md: 6, lg: 10 } as const;

// Where a range holds fewer series than the page shows, the keys with the
// fewest requests over the window rest there first, the later one first on
// a tie (the total never rests); each one's count then shows under the day,
// on a line of its own. The rest of a key that rests below 1440 px is "lg".
export function seriesRests(series: readonly UsageSeries[]): (Rest | undefined)[] {
  const rests: (Rest | undefined)[] = series.map(() => undefined);
  const md = Math.max(0, series.length - SERIES_FIT.md);
  const lg = Math.max(0, series.length - SERIES_FIT.lg);
  series
    .map((s, i) => ({ i, id: s.id, sum: s.values.reduce((a, b) => a + b, 0) }))
    .filter((x) => x.id !== null)
    .sort((a, b) => a.sum - b.sum || b.i - a.i)
    .slice(0, md)
    .forEach((x, k) => (rests[x.i] = k < lg ? "lg" : "md"));
  return rests;
}

// The top of a panel's axis (niceTicks over its largest day, at least
// AXIS_FLOOR), as the chart works it out. Each panel has its own scale, so a
// key making a few hundred requests a day keeps a readable line beside one
// making thousands; a key's panel draws the cap when its top reaches it.
export function axisTop(values: readonly number[]): number {
  const ticks = niceTicks(Math.max(AXIS_FLOOR, ...values));
  return ticks[ticks.length - 1];
}

// A date label every week, counted back from a week before today: all eight
// from 1200 px, every other one on a tablet, three on a phone. None sits at
// today, against the axis's end, where an anchored label would leave its
// neighbours out (chart.tsx clearOfAnchors); the panel's head names the
// period's two ends.
export function weekLabels(days: readonly string[]): AxisLabel[] {
  const labels: AxisLabel[] = [];
  for (let k = Math.floor((days.length - 1) / 7); k >= 1; k--) {
    const day = days[days.length - 1 - k * 7];
    labels.push({ x: dayPos(day) + 0.5, text: day, minor: k % 2 === 0, phone: k % 3 === 1 });
  }
  return labels;
}

const requestsText = (lang: Lang, n: number) => tn(lang, "apiusage.requests_one", "apiusage.requests_many", n, { n: fmtInt(n, lang) });

const Tile: FC<{ label: string; value: string; note: unknown }> = ({ label, value, note }) => (
  <div class="tile">
    <span class="tile-label">{label}</span>
    <span class="tile-value">{value}</span>
    <span class="tile-note">{note as any}</span>
  </div>
);

// A date never breaks at its hyphens (the stylesheet's .nw).
const Day: FC<{ day: string }> = ({ day }) => <span class="nw">{day}</span>;

// The daily chart's two forms (operator, 2026-11-11: keep both as the reader's
// choice). A day's requests are an amount, so the page draws a bar a day
// unless asked for the lines: the bars wear the fade the site's other amounts
// wear, and a key that runs every fifth day reads as a run and then nothing,
// where a line would draw teeth. ?chart=lines asks for the lines; any other
// value, or none, is the bars. Nothing is stored: the choice is the address.
export type ChartForm = "bars" | "lines";
export const chartForm = (raw: string | undefined | null): ChartForm => (raw === "lines" ? "lines" : "bars");
const FORMS: [ChartForm, string, "apiusage.form_bars" | "apiusage.form_lines"][] = [
  ["bars", "/account/api", "apiusage.form_bars"], ["lines", "/account/api?chart=lines", "apiusage.form_lines"],
];

// ultraDay: a key's day on Ultra, for a reader on a plan with a smaller one
// while Ultra is on sale (payments.ts ultraOnSale); one plain line then says
// it under the page. Absent or null otherwise, so the page is as before.
export type UsageView = { quota: KeyQuota; keys: KeyRow[]; usage: UsageRead | null; today: string; form?: ChartForm; ultraDay?: number | null };

export function usageView(lang: Lang, view: UsageView) {
  const { quota, keys, usage, today } = view;
  const rows = usage?.rows ?? null;
  const form = view.form ?? "bars";
  const days = usageDays(today);
  const first = days[0];
  const series = usage ? usageSeries(lang, keys, usage.rows, days, usage.totals) : [];
  const last = days.length - 1;
  const n = (v: number) => fmtInt(v, lang);
  const keysLink = <a href="/account/keys">{t(lang, "account.keys_title")}</a>;
  // Every key's requests a day, the tiles' figures, whichever keys have a series.
  const all = usage ? dayValues(usage.totals, days) : days.map(() => 0);
  const live = series.filter((s) => s.id !== null && !s.revoked);
  const total = series.length > 1;
  // The cap is a key's: the total of several keys has none.
  const ruled = (s: UsageSeries) => s.id !== null && quota.perDay <= axisTop(s.values);
  const capShown = series.some(ruled);
  const tip = (s: UsageSeries, i: number) => tipText(tipHead(lang, s.label, days[i]), [requestsText(lang, s.values[i])]);
  const panels: ChartPanel[] = series.length ? series.map((s) => ({
    title: s.label,
    // Today is a day still under way, so its bar takes the pale step a part period takes elsewhere.
    ...(form === "bars"
      ? { bars: s.values.map((v, i) => ({ x0: dayPos(days[i]), x1: dayPos(days[i]) + 1, value: v, light: i === last, title: tip(s, i) })) }
      : { line: s.values.map((v, i) => ({ x: dayPos(days[i]) + 0.5, value: v, title: tip(s, i) })) }),
    rule: ruled(s) ? quota.perDay : undefined,
  })) : [{ title: t(lang, "apiusage.series_all"), line: [] }];
  // Keys with requests in the window that have no series: past KEYS_MAX keys with rows, DAILY_SQL leaves the
  // revoked ones longest gone out. Their requests are in the total.
  const unshown = usage ? Math.max(0, usage.keys - new Set(usage.rows.map((r) => r.key_id)).size) : 0;
  const bars: RankedBar[] = live.map((s) => {
    const share = partOf(lang, s.values[last], quota.perDay, n);
    return { label: s.label, value: s.values[last], text: share, title: tipText(s.label, [share]) };
  });
  const period = tj(lang, "apiusage.period", { first: <Day day={first} />, last: <Day day={today} /> });
  const capLine = t(lang, capShown ? (total ? "apiusage.cap_rule_keys" : "apiusage.cap_rule") : total ? "apiusage.cap_off_keys" : "apiusage.cap_off",
    { cap: n(quota.perDay) });
  const rests = seriesRests(series);
  const resting = series.map((_, k) => k).filter((k) => rests[k]);
  return (
    <>
      <PageHead lang={lang} title={t(lang, "apiusage.title")} lead={t(lang, "apiusage.lead", { days: USAGE_KEEP_DAYS })}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      <section class="tiles" aria-label={t(lang, "apiusage.tiles_label")}>
        <Tile label={t(lang, "apiusage.tile_day")} value={n(quota.perDay)} note={t(lang, "apiusage.tile_day_note")} />
        <Tile label={t(lang, "apiusage.tile_minute")} value={n(quota.perMinute)} note={t(lang, "apiusage.tile_minute_note", { n: n(REQUEST_LIMITS.api) })} />
        {rows ? (
          <>
            <Tile label={t(lang, "apiusage.tile_today")} value={n(all[last])} note={tj(lang, "apiusage.tile_today_note", { date: <Day day={today} /> })} />
            <Tile label={t(lang, "apiusage.tile_window", { days: USAGE_KEEP_DAYS })} value={n(all.reduce((a, b) => a + b, 0))}
              note={tj(lang, "apiusage.tile_window_note", { first: <Day day={first} />, last: <Day day={today} /> })} />
          </>
        ) : null}
      </section>
      <Panel title={t(lang, "apiusage.panel_today")} count={today}>
        {rows === null ? (
          <p class="muted">{t(lang, "account.keys_usage_unread")}</p>
        ) : bars.length ? (
          <RankedBars rows={bars} max={quota.perDay} class="of-cap" aria={t(lang, "apiusage.today_aria")} />
        ) : (
          <p class="muted">{tj(lang, "apiusage.none_live", { keys: keysLink })}</p>
        )}
      </Panel>
      <Panel title={t(lang, "apiusage.panel_chart")} count={period}
        tools={
          <nav aria-label={t(lang, "apiusage.form_nav")} class="tabs tabs-small">
            {FORMS.map(([f, href, key]) => <a href={href} aria-current={f === form ? "page" : undefined}>{t(lang, key)}</a>)}
          </nav>
        }
        foot={<>
          {form === "bars" && all[last] > 0 ? <p>{t(lang, "apiusage.today_pale")}</p> : null}
          <p>{t(lang, "apiusage.counted", { days: USAGE_KEEP_DAYS })}</p>
        </>}>
        {rows === null ? <p class="muted">{t(lang, "account.keys_usage_unread")}</p> : null}
        <div class="chart">
          <ChartStack domain={[dayPos(first), dayPos(today) + 1]} panels={panels} height={total ? 110 : 160} xLabels={weekLabels(days)}
            fmt={n} aria={t(lang, "apiusage.chart_aria", { first, last: today })} floor={AXIS_FLOOR} />
        </div>
        {/* The cap's line, or its figure where no axis reaches it, right under the chart and above its table. */}
        <p class="muted small">{capLine}</p>
        {series.length ? (
          <div class="table-wrap">
            <Table cols={[
              { kind: "main", label: t(lang, "apiusage.col_day") },
              ...series.map((s, k) => ({ kind: "requests" as const, label: s.label, rest: rests[k] })),
            ]}>
              <tbody>
                {days.map((_, j) => {
                  const i = last - j;
                  // A resting key's count shows under the day only on a day it made requests: with five keys
                  // resting, a line of zeros a key a day made each row six lines tall and said nothing.
                  const shown = resting.filter((k) => series[k].values[i] > 0);
                  return (
                    <tr>
                      {shown.length ? (
                        // The line break ends what public/sort.js reads, so the cell sorts by its day.
                        <td data-label={t(lang, "apiusage.col_day")} class="mono">
                          <Day day={days[i]} /><br />
                          {shown.map((k) => (
                            <span class={`${rests[k] === "md" ? "md-only" : "lg-down"} muted small`}>
                              {t(lang, "common.labelled", { label: series[k].label, value: n(series[k].values[i]) })}
                            </span>
                          ))}
                        </td>
                      ) : <td data-label={t(lang, "apiusage.col_day")} class="mono">{days[i]}</td>}
                      {series.map((s, k) => <td data-label={s.label} class={rests[k] ? `mono num ${restClass(rests[k])}` : "mono num"}>{n(s.values[i])}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        ) : null}
        {unshown ? <p class="muted small">{tn(lang, "apiusage.unshown_one", "apiusage.unshown_many", unshown, { n: n(unshown) })}</p> : null}
      </Panel>
      <p class="muted small">{tj(lang, "apiusage.keys_page", { keys: keysLink })}</p>
      {view.ultraDay ? (
        <p class="muted small">{t(lang, "apiusage.ultra_note", { day: n(view.ultraDay) })} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></p>
      ) : null}
    </>
  );
}

// GET /account/api. The plan's quota decides: none sends the reader to the
// keys page. The day's counts are read only when there is a key to count.
export async function usagePage(c: Context<AppEnv>, who: Account): Promise<Response> {
  const lang = c.get("lang");
  const quota = keyQuota(who.plan);
  if (!quota) return c.redirect("/account/keys", 303);
  const now = nowOf(c.env);
  const keys = await listKeys(c.env, who.userId);
  const usage = keys.length ? await dailyUsage(c.env, who.userId, now) : { rows: [], totals: [], keys: 0 };
  // Ultra's figure, for a plan with a smaller one, only while Ultra can be bought.
  const ultra = keyQuota("ultra");
  const ultraDay = ultra && ultra.perDay > quota.perDay && (await ultraOnSale(c.env)) ? ultra.perDay : null;
  return accountPage(c, t(lang, "apiusage.title"),
    usageView(lang, { quota, keys, usage, today: utcDay(now), form: chartForm(c.req.query("chart")), ultraDay }));
}
