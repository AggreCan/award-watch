// A notice's closing state at render. CanadaBuys publishes closing times in
// Eastern time with no zone in its file; public/closing.js holds that rule
// (one copy, which the browser scripts import too). A page works out each
// open notice's state from the time it is rendered, so a notice that closed
// at 14:00 today reads "Closing date passed" from 14:00, not from the next
// nightly run. The feeds and the CSV files are written by the nightly and
// keep the states of the data date; their notes say so.

import { closingInstant, closingParts, closingPassed as passedAt, closingState, easternDay } from "../public/closing.js";
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

// Whether a published closing value names its time zone.
export function closingHasZone(closing: string | null | undefined): boolean {
  return !!closingParts(closing)?.zone;
}
