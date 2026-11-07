// Calendar files (RFC 5545): the one-event file any reader takes from a
// notice or a contract page (src/pages/ics.ts), and the feeds a Pro account
// subscribes a calendar app to (src/account/feeds.ts). Both are written
// here, so an event has one form wherever it comes from.
//
// Every time is UTC ("Z"): a closing is read the way the pages read it
// (public/closing.js, Eastern time when the value names no zone), so no
// VTIMEZONE block is needed and every client places it at the same instant;
// the description repeats the closing as published. A contract's end is a
// date, written as an all-day event whose DTEND is the next day (the end is
// exclusive). A notice's UID is its reference and its SEQUENCE the amendment
// number, so an amendment that moves a closing moves the event in a client
// that already holds it instead of adding a second one.
//
// Lines end in CRLF and are folded at 75 octets (UTF-8 octets, not
// characters, and never inside a character); TEXT values escape backslash,
// semicolon, comma and line breaks. A timed closing has no DTEND: RFC 5545
// requires DTEND to be later than DTSTART, and a DATE-TIME start without one
// is an event that ends when it starts. A standing offer's or supply
// arrangement's expiry is an all-day event too, one per instrument and
// holder organization, for the watches' feed alone.

import { addDays, closingInstant, closingParts } from "../public/closing.js";
import { DAY_RE, publishedReference, type ContractDetail, type ExpiringKind, type ExpiringRow, type TenderRow } from "./data";
import type { Env } from "./env";
import { fmtInt, pick, segmentShort, sourceLabel, t, tn, type Key, type Lang } from "./i18n";
import { instrumentPath } from "./instruments";
import { KIND_SOURCE, contractReference, growthPct, sitePath } from "./pages/expiring";
import { contractPath, money, provincesText, tenderNoticeUrl } from "./pages/shared";
import { type Row, dollars, num, orgIdOf } from "./records_db";

export const ICS_TYPE = "text/calendar; charset=utf-8";
// The bounds of a feed (src/account/feeds.ts): the events it carries at most,
// the last of them the line saying how many more the cap left out; and the
// length of a description, in characters, before escaping.
export const FEED_EVENTS_MAX = 500;
export const DESCRIPTION_MAX = 1000;
// How often a subscribed client is asked to read the feed again.
export const REFRESH = "PT12H";

const CRLF = "\r\n";
const LINE_OCTETS = 75;
export const UID_HOST = "awardwatch.ca";

// -- the format ---------------------------------------------------------------------------

// A TEXT value (RFC 5545, 3.3.11): control characters other than the tab
// dropped, any line break written \n, and backslash, semicolon and comma
// escaped.
export function escapeText(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

const octets = (cp: number) => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

// A content line folded (RFC 5545, 3.1): no physical line longer than 75
// octets, each continuation starting with one space, which counts towards
// its 75; a character is never split between two lines.
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let used = 0;
  let limit = LINE_OCTETS;
  for (const ch of line) {
    const n = octets(ch.codePointAt(0) ?? 0);
    if (used + n > limit) {
      parts.push(current);
      current = "";
      used = 0;
      limit = LINE_OCTETS - 1;
    }
    current += ch;
    used += n;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

// The first n characters (code points, so a pair is never cut in two).
function clip(s: string, n: number): string {
  const chars = [...s];
  return chars.length <= n ? s : chars.slice(0, n).join("");
}

const pad = (n: number) => String(n).padStart(2, "0");

// "20261126T190000Z".
export function utcStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const dateValue = (day: string) => day.replace(/-/g, "");

// A part of a UID: lower case, anything but letters, digits, dot, dash,
// underscore and colon percent-encoded, so the same record gives the same
// UID whichever case or form a source wrote its reference in.
export function uidPart(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._:-]/g, (ch) => encodeURIComponent(ch));
}

// When an event happens: an instant (a closing with a time), or a whole day
// (a contract's end, or a closing published with a date alone).
export type CalStart = { at: number } | { day: string };

export type CalEvent = {
  uid: string;
  sequence: number;
  start: CalStart;
  summary: string;
  description: string;
  url: string;
  cancelled?: boolean;
  categories: string[];
};

// The order of a feed: soonest first, the UID breaking ties so the file is
// the same from one read to the next.
export function startKey(s: CalStart): string {
  return "at" in s ? new Date(s.at).toISOString() : `${s.day}T00:00:00.000Z`;
}

export function soonestFirst(events: readonly CalEvent[]): CalEvent[] {
  return [...events].sort((a, b) => {
    const x = startKey(a.start);
    const y = startKey(b.start);
    return x < y ? -1 : x > y ? 1 : a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });
}

export type CalendarFile = {
  lang: Lang;
  events: readonly CalEvent[];
  // The data date the events were read at: DTSTAMP and LAST-MODIFIED are
  // 12:30 UTC that day, when the nightly run publishes.
  dataDate: string;
  // A subscribed feed's name; with it come the refresh hints. A one-event
  // file has none, so importing it makes no calendar of its own.
  name?: string;
  // A display alarm a day before each event (?alarm=1d on a feed's address).
  alarm?: boolean;
};

export function writeCalendar(f: CalendarFile): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//Award Watch//awardwatch.ca//${f.lang === "fr" ? "FR" : "EN"}`,
    "METHOD:PUBLISH",
  ];
  if (f.name !== undefined) {
    lines.push(`X-WR-CALNAME:${escapeText(f.name)}`, `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH}`, `X-PUBLISHED-TTL:${REFRESH}`);
  }
  const stamp = `${dateValue(DAY_RE.test(f.dataDate) ? f.dataDate : "1970-01-01")}T123000Z`;
  for (const e of f.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(e.uid)}`,
      `SEQUENCE:${Number.isInteger(e.sequence) && e.sequence > 0 ? e.sequence : 0}`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${stamp}`,
    );
    if ("at" in e.start) lines.push(`DTSTART:${utcStamp(e.start.at)}`);
    else lines.push(`DTSTART;VALUE=DATE:${dateValue(e.start.day)}`, `DTEND;VALUE=DATE:${dateValue(addDays(e.start.day, 1))}`);
    lines.push(
      `SUMMARY:${escapeText(e.summary)}`,
      `DESCRIPTION:${escapeText(clip(e.description, DESCRIPTION_MAX))}`,
      `URL:${e.url.replace(/[\s"<>\\^`{|}]/g, (ch) => encodeURIComponent(ch))}`,
    );
    if (e.cancelled) lines.push("STATUS:CANCELLED");
    // A deadline does not make its reader busy.
    lines.push(`CATEGORIES:${e.categories.map(escapeText).join(",")}`, "TRANSP:TRANSPARENT");
    if (f.alarm && !e.cancelled) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(e.summary)}`, "TRIGGER:-P1D", "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// The address the events link to: the site's (SITE_URL), or the request's
// own origin where it is unset.
export function calendarBase(env: Pick<Env, "SITE_URL">, requestUrl: string): string {
  const site = (env.SITE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^/]+$/.test(site) ? site : new URL(requestUrl).origin;
}

// -- a notice's closing -------------------------------------------------------------------

// What a closing event needs: an open notice's row (tenders/open.json) or a
// notice's detail (its shard), with the segments the codes give.
export type NoticeFacts = Pick<
  TenderRow,
  "reference" | "reference_published" | "amendment" | "title_en" | "title_fr" | "buyer_en" | "buyer_fr" | "closing" |
  "notice_type_en" | "notice_type_fr" | "method_en" | "method_fr" | "provinces" | "first_seen"
> & { segments: readonly string[]; cancelled?: boolean };

// When a closing happens: its instant, or its day when it was published with
// no time; null for a value that is not a date.
export function closingStart(closing: string | null | undefined): CalStart | null {
  const at = closingInstant(closing);
  if (at !== null) return { at };
  const day = closingParts(closing)?.day;
  return day && DAY_RE.test(day) ? { day } : null;
}

// "2026-11-26 14:00, Eastern time" ("14 h 00, heure de l'Est"): the value
// as published, then its zone in words (UTC for "Z", or as written).
function closingAsPublished(lang: Lang, closing: string): { v: string; zone: string } {
  const p = closingParts(closing);
  if (!p) return { v: closing, zone: t(lang, "cal.zone_eastern") };
  const v = p.hh && p.mm ? `${p.day} ${t(lang, "common.time", { hh: p.hh, mm: p.mm })}` : p.day;
  const zone = !p.zone ? t(lang, "cal.zone_eastern") : p.zone === "Z" ? "UTC" : p.zone;
  return { v, zone };
}

const line = (ok: unknown, text: () => string): string | null => (ok ? text() : null);

export function noticeEvent(lang: Lang, n: NoticeFacts, base: string): CalEvent | null {
  const start = closingStart(n.closing);
  if (!start || !n.closing) return null;
  const ref = publishedReference(n);
  const title = pick(lang, n.title_en, n.title_fr) ?? ref;
  const buyer = pick(lang, n.buyer_en, n.buyer_fr);
  const type = pick(lang, n.notice_type_en, n.notice_type_fr);
  const method = pick(lang, n.method_en, n.method_fr);
  const url = `${base}/tenders/${n.reference.toLowerCase()}`;
  const description = [
    t(lang, "cal.d_reference", { v: ref }),
    line(buyer, () => t(lang, "cal.d_buyer", { v: buyer ?? "" })),
    line(type, () => t(lang, "cal.d_type", { v: type ?? "" })),
    line(method, () => t(lang, "cal.d_method", { v: method ?? "" })),
    line(n.segments.length, () => t(lang, "cal.d_segments", { v: n.segments.map((s) => `${s} ${segmentShort(lang, s)}`).join("; ") })),
    t(lang, "cal.d_regions", { v: provincesText(lang, n.provinces) }),
    t(lang, "cal.d_first_seen", { v: n.first_seen }),
    t(lang, "cal.d_closing", closingAsPublished(lang, n.closing)),
    line(n.cancelled, () => t(lang, "cal.d_cancelled")),
    t(lang, "cal.d_site", { v: url }),
    t(lang, "cal.d_canadabuys", { v: tenderNoticeUrl(ref, lang) }),
  ].filter((x): x is string => x !== null);
  return {
    uid: `notice-${uidPart(n.reference)}@${UID_HOST}`,
    sequence: n.amendment,
    start,
    summary: buyer ? t(lang, "cal.closes", { title, buyer }) : t(lang, "cal.closes_alone", { title }),
    description: description.join("\n"),
    url,
    cancelled: !!n.cancelled,
    categories: [t(lang, "site.name"), t(lang, "cal.cat_closing")],
  };
}

// -- a contract's end ---------------------------------------------------------------------

// What an end event needs, from whichever source holds the contract: its
// detail (an award notice or a contract history record), a published
// contract's row from the records database, or a row of the radar
// (tenders/expiring files, rec_expiring), which a watchlist feed reads.
// reference is the radar's key: an award's or a history record's reference
// as the site writes it, a published contract's "owner_org:reference".
export type ContractFacts = {
  kind: ExpiringKind;
  reference: string;
  // The site's page, a path (or the government's record when the site has none).
  path: string;
  holder: string;
  buyer: string | null;
  title: string;
  end: string;
  start: string | null;
  value: number | null;
  currency: string | null;
  amendments: number;
  growth: number | null;
  cancelled?: boolean;
};

export function contractEvent(lang: Lang, f: ContractFacts, base: string): CalEvent | null {
  const day = f.end.slice(0, 10);
  if (!DAY_RE.test(day)) return null;
  const url = /^https?:/.test(f.path) ? f.path : `${base}${f.path}`;
  const amendments = fmtInt(f.amendments, lang);
  const description = [
    t(lang, "cal.d_holder", { v: f.holder }),
    line(f.buyer, () => t(lang, "cal.d_buyer", { v: f.buyer ?? "" })),
    t(lang, "cal.d_value", { v: money(lang, f.value, f.currency) }),
    f.growth !== null && f.amendments > 0
      ? t(lang, "cal.d_amendments_growth", { n: amendments, growth: growthPct(lang, f.growth) })
      : t(lang, "cal.d_amendments", { n: amendments }),
    line(f.start, () => t(lang, "cal.d_start", { v: (f.start ?? "").slice(0, 10) })),
    t(lang, "cal.d_end", { v: day }),
    t(lang, "cal.d_source", { v: sourceLabel(lang, KIND_SOURCE[f.kind]) }),
    line(f.cancelled, () => t(lang, "cal.d_cancelled_contract")),
    t(lang, "cal.d_site", { v: url }),
  ].filter((x): x is string => x !== null);
  return {
    uid: `contract-${f.kind}-${uidPart(f.reference)}@${UID_HOST}`,
    sequence: f.amendments,
    start: { day },
    summary: f.buyer
      ? t(lang, "cal.ends", { holder: f.holder, buyer: f.buyer, title: f.title })
      : t(lang, "cal.ends_alone", { holder: f.holder, title: f.title }),
    description: description.join("\n"),
    url,
    cancelled: !!f.cancelled,
    categories: [t(lang, "site.name"), t(lang, "cal.cat_end")],
  };
}

// An award notice's or a contract history record's end, from its detail. A
// history record's buyer is the client department, as the radar names it;
// the growth is the newest total over the original amount. A supplier the
// detail does not name (a person's name withheld among them) reads "Not
// stated", as the page leaves it out.
export function detailFacts(lang: Lang, d: ContractDetail): ContractFacts | null {
  if (!d.end) return null;
  const original = d.amendments.find((v) => v.amendment === 0);
  const before = original ? original.amount ?? original.total_value : null;
  const now = d.total_value ?? d.amount;
  const buyer = d.kind === "history"
    ? pick(lang, d.client_en ?? null, d.client_fr ?? null) ?? pick(lang, d.buyer_en, d.buyer_fr)
    : pick(lang, d.buyer_en, d.buyer_fr);
  return {
    kind: d.kind,
    reference: d.reference,
    path: `/${d.kind === "award" ? "awards" : "history"}/${d.reference.toLowerCase()}`,
    holder: d.supplier ?? t(lang, "common.not_stated"),
    buyer,
    title: pick(lang, d.title_en, d.title_fr) ?? publishedReference(d),
    end: d.end,
    start: d.start,
    value: d.value,
    currency: d.currency,
    amendments: d.amendment,
    growth: before && before > 0 && now !== null && d.amendment > 0 ? now / before - 1 : null,
    cancelled: d.status === "cancelled",
  };
}

// A row of the radar, for a watchlist feed: the end, the holder (or the line
// for a person's name withheld) and the radar's own amendment count and growth.
export function expiringFacts(lang: Lang, r: ExpiringRow): ContractFacts {
  return {
    kind: r.kind,
    reference: r.reference,
    path: sitePath(r),
    holder: r.supplier_withheld ? t(lang, "expiring.withheld") : r.organization ?? t(lang, "common.not_stated"),
    buyer: pick(lang, r.buyer_en, r.buyer_fr),
    title: pick(lang, r.title_en, r.title_fr) ?? contractReference(r),
    end: r.end,
    start: r.start,
    value: r.value,
    currency: r.currency,
    amendments: r.n_amendments,
    growth: r.value_growth,
  };
}

// A published contract's end, from its rows as PUBLISHED_CONTRACT_SQL reads
// them (records_tables.ts), for its one-event file and a watch of it: the
// holder, the department, the counted value and the end of the row named;
// its amendments are the other rows of the same contract. Null when the row
// is not there or names no end.
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export function publishedFacts(lang: Lang, dept: string, ref: string, rows: readonly Row[]): ContractFacts | null {
  const d = rows.find((r) => num(r.self) === 1);
  const end = d ? text(d.endd) : null;
  if (!d || !end) return null;
  const description = pick(lang, text(d.desc_en), text(d.desc_fr));
  return {
    kind: "contract",
    reference: `${dept}:${ref}`,
    path: contractPath(dept, ref),
    holder: num(d.wh) === 1 ? t(lang, "expiring.withheld") : text(d.org_name) ?? t(lang, "common.not_stated"),
    buyer: pick(lang, text(d.buyer_en), text(d.buyer_fr)) ?? dept,
    title: description ? description.split("\n")[0].slice(0, 200) : ref,
    end,
    start: text(d.start),
    value: dollars(d.counted),
    currency: "CAD",
    amendments: rows.filter((r) => num(r.self) !== 1).length,
    growth: null,
  };
}

// -- an instrument's expiry ------------------------------------------------------------------

// What an expiry event needs: a row of the watches' feed's instruments
// statement (feeds.ts WATCH_INSTRUMENTS_SQL), in the feed's language. holderId
// is the organization's id: the UID names the instrument and the holder, so
// two followed organizations on one instrument are two events, each stable.
export type InstrumentFacts = {
  agreement: string;
  holderId: string;
  holder: string;
  type: string | null;
  description: string | null;
  regions: readonly string[];
  endUser: string | null;
  start: string | null;
  expiry: string;
  holders: number | null;
};

export function instrumentEvent(lang: Lang, f: InstrumentFacts, base: string): CalEvent | null {
  const day = f.expiry.slice(0, 10);
  if (!DAY_RE.test(day) || !f.agreement) return null;
  const url = `${base}${instrumentPath(f.agreement)}`;
  const description = [
    t(lang, "cal.d_agreement", { v: f.agreement }),
    line(f.type, () => t(lang, "cal.d_instrument_type", { v: f.type ?? "" })),
    line(f.description, () => t(lang, "cal.d_description", { v: f.description ?? "" })),
    t(lang, "cal.d_holder", { v: f.holder }),
    line(f.regions.length, () => t(lang, "cal.d_regions", { v: f.regions.join(", ") })),
    line(f.endUser, () => t(lang, "cal.d_end_user", { v: f.endUser ?? "" })),
    line(f.start, () => t(lang, "cal.d_start", { v: (f.start ?? "").slice(0, 10) })),
    t(lang, "cal.d_expiry", { v: day }),
    line(f.holders !== null, () => t(lang, "cal.d_holders", { n: fmtInt(f.holders ?? 0, lang) })),
    t(lang, "cal.d_site", { v: url }),
  ].filter((x): x is string => x !== null);
  return {
    uid: `instrument-${uidPart(`sosa:${f.agreement}:${f.holderId}`)}@${UID_HOST}`,
    // The records database keeps no count of the file publications that moved
    // an expiry, so the sequence stays 0; a subscribed calendar reads the moved
    // date on its next refresh all the same.
    sequence: 0,
    start: { day },
    summary: f.type
      ? t(lang, "cal.expires", { agreement: f.agreement, type: f.type, holder: f.holder })
      : t(lang, "cal.expires_untyped", { agreement: f.agreement, holder: f.holder }),
    description: description.join("\n"),
    url,
    categories: [t(lang, "site.name"), t(lang, "cal.cat_expiry")],
  };
}

// A row of the watches' feed's instruments statement as an expiry event's
// facts, in the feed's language: the regions the organization holds it in,
// in alphabetical order. Null for a row without a number, an expiry or an
// organization.
export function instrumentFacts(lang: Lang, r: Row): InstrumentFacts | null {
  const agreement = text(r.agr);
  const expiry = text(r.expiry);
  const oid = num(r.oid);
  if (!agreement || !expiry || oid === null) return null;
  const regions = [...new Set(String((lang === "fr" ? r.regions_fr : r.regions_en) ?? "").split("\u001f").filter((s) => s.trim()))];
  return {
    agreement,
    holderId: orgIdOf(oid),
    holder: text(r.name) ?? t(lang, "common.not_stated"),
    type: pick(lang, text(r.type_en), text(r.type_fr)),
    description: pick(lang, text(r.desc_en), text(r.desc_fr)),
    regions: regions.sort((a, b) => a.localeCompare(b, lang === "fr" ? "fr-CA" : "en-CA")),
    endUser: pick(lang, text(r.user_en), text(r.user_fr)),
    start: text(r.start),
    expiry,
    holders: num(r.n),
  };
}

// -- the cap ------------------------------------------------------------------------------

export type MoreKind = "closing" | "end" | "dates";

// A feed's events, soonest first, at most FEED_EVENTS_MAX: when the cap cuts,
// the last is an all-day event on the data date saying how many more there
// are, linking the page that lists them all. beyond counts the events a
// reader matched but did not read, each one later than all of those given (a
// watchlist feed reads the soonest FEED_EVENTS_MAX rows of the radar and
// counts the rest), so the cap cuts them first.
//
// The cap event comes whenever events are left out: more given than the file
// holds, or any matched and not read. The second can happen with fewer given
// than the cap: a statement that hit its LIMIT gives FEED_EVENTS_MAX rows, but
// one that is the same event as a followed record's (the same UID, kept once)
// or that does not read as an event adds none, so the given and the unread
// can sum to FEED_EVENTS_MAX or less and still leave rows out of the file.
// The remainder is every event given or unread less the ones kept; the
// description names how many are kept.
export function capped(
  lang: Lang, events: readonly CalEvent[],
  more: { uid: string; kind: MoreKind; dataDate: string; url: string; beyond?: number },
): CalEvent[] {
  const sorted = soonestFirst(events);
  const beyond = Math.max(0, more.beyond ?? 0);
  if (beyond === 0 && sorted.length <= FEED_EVENTS_MAX) return sorted;
  const kept = sorted.slice(0, FEED_EVENTS_MAX - 1);
  const rest = sorted.length + beyond - kept.length;
  const [one, many]: [Key, Key] = more.kind === "closing" ? ["cal.more_closing_one", "cal.more_closing"]
    : more.kind === "end" ? ["cal.more_end_one", "cal.more_end"] : ["cal.more_dates_one", "cal.more_dates"];
  const description = t(lang, "cal.more_text", { max: fmtInt(kept.length, lang), url: more.url });
  kept.push({
    uid: more.uid,
    // The day moves with each data date; the sequence rises with it.
    sequence: Math.round(Date.parse(`${more.dataDate}T00:00:00Z`) / 86_400_000) || 0,
    start: { day: more.dataDate },
    summary: tn(lang, one, many, rest, { n: fmtInt(rest, lang) }),
    description,
    url: more.url,
    categories: [t(lang, "site.name")],
  });
  return kept;
}

// How many events the file capped() writes holds: all of them when they fit
// and none was left unread, else the kept ones and the cap's own event. The
// feed pages' "N events today" counts with it, so they agree with the file.
export function cappedLength(given: number, beyond = 0): number {
  if (beyond <= 0 && given <= FEED_EVENTS_MAX) return given;
  return Math.min(given, FEED_EVENTS_MAX - 1) + 1;
}
