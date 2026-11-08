// A notice's closing state at render. CanadaBuys publishes closing times in
// Eastern time with no zone in its file; public/closing.js holds that rule
// (one copy, which the browser scripts import too). A page works out each
// open notice's state from the time it is rendered, so a notice that closed
// at 14:00 today reads "Closing date passed" from 14:00, not from the next
// nightly run. The feeds and the CSV files are written by the nightly and
// keep the states of the data date; their notes say so.

import { addDays, closingInstant, closingParts, countdownText, easternDay } from "../public/closing.js";
import { CLOSING_SOON_DAYS } from "./constants";
import { t, type Lang } from "./i18n";

// -- the states, worked out cheaply -------------------------------------------------
//
// The rail counts the notices closing soon on every page, over every open
// notice's closing value (stats.json closing_soon_times, about 900). Done
// with public/closing.js as it stands, each value costs four or five
// Intl.DateTimeFormat calls, several milliseconds a page. The functions below
// give the same answers as closingPassed and closingState there, with two
// savings: a value's date and instant are worked out once per isolate (both
// depend on the text alone), and a value dated two days or more from the
// Eastern date needs no instant at all, since no zone offset can carry its
// time across that gap. test/closing-fast.test.ts holds the two equal.

// A value's date ("2026-11-26", null when the value is not a date), whether
// the shortcut may judge it by that date alone, and its instant once asked for.
interface Known { day: string | null; plain: boolean; at?: number | null }

// Bounded: the open notices' values repeat on every page, and a page of old
// notices adds a few more; past the cap the map starts again.
const KNOWN_MAX = 20000;
const known = new Map<string, Known>();

const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;
// Every offset a zone has had is under 16 hours; an explicit offset past that
// (a file could write "+99:00") is judged by its instant instead.
const MAX_OFFSET_MIN = 16 * 60;

function knownOf(value: string): Known {
  let k = known.get(value);
  if (k) return k;
  const p = closingParts(value);
  let plain = false;
  if (p) {
    const [y, m, d] = p.day.split("-").map(Number);
    // A date that does not exist (2026-02-30) or a time past 23:59 rolls
    // over into another day, so only a real date and time take the shortcut.
    const realDay = new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === p.day;
    const realTime = !p.hh || (Number(p.hh) <= 23 && Number(p.mm) <= 59);
    const off = p.zone ? OFFSET.exec(p.zone) : null;
    const realZone = !off || Number(off[2]) * 60 + Number(off[3]) < MAX_OFFSET_MIN;
    plain = realDay && realTime && realZone;
  }
  k = { day: p ? p.day : null, plain };
  if (known.size >= KNOWN_MAX) known.clear();
  known.set(value, k);
  return k;
}

function instantOf(value: string, k: Known = knownOf(value)): number | null {
  if (k.at === undefined) k.at = closingInstant(value);
  return k.at;
}

// The Eastern date at an instant and the dates the states compare with. A
// request reads one clock throughout, so the last answer is kept.
interface Days { now: number; soon: number; today: string; before: string; after: string; limit: string }
let lastDays: Days | null = null;

function daysAt(now: number, soon: number): Days {
  if (lastDays && lastDays.now === now && lastDays.soon === soon) return lastDays;
  const today = easternDay(now);
  lastDays = { now, soon, today, before: addDays(today, -2), after: addDays(today, 2), limit: addDays(today, soon) };
  return lastDays;
}

// public/closing.js closingPassed for a value that is not empty. Eastern
// midnight is 03:00 to 06:00 UTC whatever the year, so "now" lies within
// [today 03:00, tomorrow 06:00) UTC, and a wall time on a date two days or
// more either side, read in any offset under 16 hours, is past or ahead of it.
function passedFast(value: string, now: number, d: Days): boolean {
  const k = knownOf(value);
  if (k.day === null) return false;
  if (k.plain && k.day >= d.after) return false;
  if (k.plain && k.day <= d.before) return true;
  const at = instantOf(value, k);
  return at !== null ? at <= now : k.day < d.today;
}

// public/closing.js closingState for a value that is not empty.
function stateFast(value: string, now: number, d: Days): "closed" | "closing" | "open" {
  if (passedFast(value, now, d)) return "closed";
  const day = knownOf(value).day;
  return day !== null && day <= d.limit ? "closing" : "open";
}

// For the tests: start from nothing, as a new isolate does.
export function clearClosingCache(): void {
  known.clear();
  lastDays = null;
}

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
  if (!closing) return false;
  return passedFast(closing, clock.now, daysAt(clock.now, CLOSING_SOON_DAYS));
}

// An open notice closing within the window reads as closing soon; the tag's
// colour differs from the open one in lightness as well as hue. One whose
// closing time has passed reads "closed" (closing date passed), the status
// the export writes for one whose closing day had passed by the data date,
// so the same label covers both. Other statuses pass through.
export function tenderState(status: string, closing: string | null, clock: Clock): string {
  if (status !== "open" || !closing) return status;
  return stateFast(closing, clock.now, daysAt(clock.now, CLOSING_SOON_DAYS));
}

// How many of these closing values are still to come and within the window:
// the rail's and the home page's "closing soon" counts.
export function closingSoonCount(closings: readonly (string | null)[], clock: Clock): number {
  const d = daysAt(clock.now, CLOSING_SOON_DAYS);
  let n = 0;
  for (const c of closings) if (c && stateFast(c, clock.now, d) === "closing") n += 1;
  return n;
}

// The same notices by their closing day (the date as published, which the
// window counts by): today, tomorrow, the day after, and the rest of the
// window. The four add up to closingSoonCount.
export function closingSoonByDay(closings: readonly (string | null)[], clock: Clock): { today: number; day1: number; day2: number; later: number } {
  const out = { today: 0, day1: 0, day2: 0, later: 0 };
  const day1 = addDays(clock.today, 1);
  const day2 = addDays(clock.today, 2);
  const d = daysAt(clock.now, CLOSING_SOON_DAYS);
  for (const c of closings) {
    if (!c || stateFast(c, clock.now, d) !== "closing") continue;
    const day = knownOf(c).day ?? "";
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
  const at = closing ? instantOf(closing) : null;
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
  const at = closing ? instantOf(closing) : null;
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
  const at = instantOf(closing);
  if (at === null) {
    const day = closingParts(closing)?.day;
    return day === clock.today ? t(lang, "tender.closes_today") : t(lang, "tender.lead_closes", { date: closingText(closing, lang) });
  }
  return countdownText(at, clock.now, closingTime(closing, lang) ?? "", closesLineWords(lang)) ?? t(lang, "status.closed");
}
