// A notice's closing state at render. CanadaBuys publishes closing times in
// Eastern time with no zone in its file; public/closing.js holds that rule
// (one copy, which the browser scripts import too). A page works out each
// open notice's state from the time it is rendered, so a notice that closed
// at 14:00 today reads "Closing date passed" from 14:00, not from the next
// nightly run. The feeds and the CSV files are written by the nightly and
// keep the states of the data date; their notes say so.

import { addDays, closingInstant, closingParts, closingPassed as passedAt, closingState, countdownText, easternDay } from "../public/closing.js";
import { CLOSING_SOON_DAYS } from "./constants";
import { t, type Lang } from "./i18n";

// The instant a page is rendered at, and the Eastern date then.
export type Clock = { now: number; today: string };

export function clockAt(now: number): Clock {
  return { now, today: easternDay(now) };
}

// The request's time, or the instant NOW names when the environment sets
// one: the tests pin it, so a fixture's "closing soon" stays so.
export function clockOf(env: { NOW?: string } | undefined | null): Clock {
  const fixed = env?.NOW ? Date.parse(env.NOW) : Number.NaN;
  return clockAt(Number.isFinite(fixed) ? fixed : Date.now());
}

export function closingPassed(closing: string | null | undefined, clock: Clock): boolean {
  return passedAt(closing, clock.now);
}

// An open notice closing within the window reads as closing soon; the tag's
// colour differs from the open one in lightness as well as hue. One whose
// closing time has passed reads "closed" (closing date passed), the status
// the export writes for one whose closing day had passed by the data date,
// so the same label covers both. Other statuses pass through.
export function tenderState(status: string, closing: string | null, clock: Clock): string {
  if (status !== "open" || !closing) return status;
  return closingState(closing, clock.now, CLOSING_SOON_DAYS);
}

// How many of these closing values are still to come and within the window:
// the rail's and the home page's "closing soon" counts.
export function closingSoonCount(closings: readonly (string | null)[], clock: Clock): number {
  return closings.filter((c) => !!c && closingState(c, clock.now, CLOSING_SOON_DAYS) === "closing").length;
}

// The same notices by their closing day (the date as published, which the
// window counts by): today, tomorrow, the day after, and the rest of the
// window. The four add up to closingSoonCount.
export function closingSoonByDay(closings: readonly (string | null)[], clock: Clock): { today: number; day1: number; day2: number; later: number } {
  const out = { today: 0, day1: 0, day2: 0, later: 0 };
  const day1 = addDays(clock.today, 1);
  const day2 = addDays(clock.today, 2);
  for (const c of closings) {
    if (!c || closingState(c, clock.now, CLOSING_SOON_DAYS) !== "closing") continue;
    const day = closingParts(c)?.day ?? "";
    if (day <= clock.today) out.today += 1;
    else if (day === day1) out.day1 += 1;
    else if (day === day2) out.day2 += 1;
    else out.later += 1;
  }
  return out;
}

// The closing instant in UTC ("2026-11-04T19:00:00Z") for public/countdown.js,
// or null for a value without a time.
export function closesAtUtc(closing: string | null | undefined): string | null {
  const at = closingInstant(closing);
  return at === null ? null : new Date(at).toISOString().replace(".000Z", "Z");
}

// The zone printed beside a closing time: Eastern time when the value names
// none (ET, HE in French), UTC for "Z", otherwise the value's own.
export function zoneLabel(lang: Lang, zone: string | null): string {
  if (!zone) return t(lang, "common.zone_et");
  return zone === "Z" ? "UTC" : zone;
}

// "14:00 ET" ("14 h 00 HE"), or null for a value without a time.
export function closingTime(closing: string | null | undefined, lang: Lang): string | null {
  const p = closingParts(closing);
  if (!p || !p.hh || !p.mm) return null;
  return `${t(lang, "common.time", { hh: p.hh, mm: p.mm })} ${zoneLabel(lang, p.zone)}`;
}

// "2026-11-26 14:00 ET" as printed beside a notice; a day without a time is
// the date alone, and anything that is not a date comes back as given.
export function closingText(closing: string | null | undefined, lang: Lang = "en"): string {
  if (!closing) return "";
  const p = closingParts(closing);
  if (!p) return closing;
  const time = closingTime(closing, lang);
  return time ? `${p.day} ${time}` : p.day;
}

// The time left as public/countdown.js writes it ("closes in 3 h 12 min",
// "closes in 2 days"), from the page's clock, or null for a value without a
// time or one already past. A list sorted by closing date shows it in place of
// the closing-soon chip; the script rewrites it each minute.
export function countdownLine(closing: string | null | undefined, clock: Clock, lang: Lang): string | null {
  const at = closingInstant(closing);
  if (at === null) return null;
  const words = {
    in_min: t(lang, "countdown.in_min"), in_hm: t(lang, "countdown.in_hm"), in_day: t(lang, "countdown.in_day"),
    in_days: t(lang, "countdown.in_days"), today_at: t(lang, "countdown.today_at"),
  };
  return countdownText(at, clock.now, closingTime(closing, lang) ?? "", words);
}

// Whether a published closing value names its time zone.
export function closingHasZone(closing: string | null | undefined): boolean {
  return !!closingParts(closing)?.zone;
}

// The words of the line beside a notice's documents: countdownText's, opening
// a line ("Closes in 2 days"). public/countdown.js gets them as the "line"
// set of its JSON block, for the element marked data-words="line".
export function closesLineWords(lang: Lang): { in_min: string; in_hm: string; in_day: string; in_days: string; today_at: string } {
  return {
    in_min: t(lang, "tender.closes_in_min"), in_hm: t(lang, "tender.closes_in_hm"), in_day: t(lang, "tender.closes_in_day"),
    in_days: t(lang, "tender.closes_in_days"), today_at: t(lang, "tender.closes_today_at"),
  };
}

// The line beside a notice's documents (pages/tender.tsx), at the page's
// clock: the time left as the lists write it (the same countdownText, so the
// figure is theirs: whole days from 24 hours out, the time on the closing
// day, hours and minutes in the last hours), "Closing date passed" once the
// closing has passed, and for a closing with a date and no time "Closes
// <date>", or "Closes today" on that Eastern date. Null without a closing,
// or for a notice no longer open whose closing is still ahead (cancelled,
// awarded): its status says it. An amended closing is the newest version's,
// so it moves the line.
export function closesLine(status: string, closing: string | null | undefined, clock: Clock, lang: Lang): string | null {
  if (!closing) return null;
  if (closingPassed(closing, clock)) return t(lang, "status.closed");
  const state = tenderState(status, closing, clock);
  if (state !== "open" && state !== "closing") return null;
  const at = closingInstant(closing);
  if (at === null) {
    const day = closingParts(closing)?.day;
    return day === clock.today ? t(lang, "tender.closes_today") : t(lang, "tender.lead_closes", { date: closingText(closing, lang) });
  }
  return countdownText(at, clock.now, closingTime(closing, lang) ?? "", closesLineWords(lang)) ?? t(lang, "status.closed");
}
