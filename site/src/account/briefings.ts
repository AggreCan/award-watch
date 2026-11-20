// Weekly briefings (docs/accounts.md, Weekly briefings): one segment or one
// buyer (optionally narrowed to one UNSPSC segment) an account receives a
// message about each week. The accounts database keeps the briefing
// (accounts_schema.sql, briefings) and its runs (briefing_deliveries); the
// records database holds what a message reports: rec_events for the week's
// notices, awards and amendments, rec_due and rec_expiring for the contracts
// ending next fiscal quarter, records for the fiscal year's largest,
// rec_instruments for the standing offers and supply arrangements ending
// within 6 months. The message is digests.ts briefingDigest; the pages are
// briefing_pages.tsx.
//
// Every records statement is a constant here with ?N placeholders, bound to
// values checked before they reach it (a segment that is one of the 57, a
// buyer id that is a buyer id, days and quarters from the data date), read
// through the subject's index (rec_events_segment or _buyer by subject and
// day, rec_expiring_end or _buyer by end date, records_segment or
// records_buyer by subject, source and one fiscal year; rec_instruments by
// rec_instruments_expiry, or rec_instruments_buyer for a buyer, then the
// segment on the rows in the window), and
// ended by a LIMIT of SECTION_ROWS rows (the per-source totals at most
// SECTION_ROWS too). A briefing reads one batch: the state row and its eight
// statements (seven for a buyer narrowed to a segment, which rec_due does not
// hold).
//
// The delivery job's third part (deliveries.ts runDeliveries calls
// runBriefings after the watch mail, inside the same cap of RUN_MESSAGES_MAX
// messages): each briefing with delivery weekly, an active account whose plan
// allows delivery and that is not blocked, not covered since this week's
// weekday (BRIEFING_WEEKDAY, Monday), and no message refused for it since
// then. Claimed for the week before its message goes and given back when the
// send does not go, as a saved search is. Until the records database is ready
// at today's data date, every briefing waits unclaimed. A briefing whose
// account's plan does not send it is marked for the week with no run row
// (passedOver), so it leaves the list; a buyer the nightly merged is read at
// the surviving id, the briefing's row keeping the id saved. More than
// GROUP_OVER of an account's briefings with something to send in one run go
// as one message (digests.ts briefingGroupDigest), as its saved searches do.
//
// Log lines name counts and dates only, never an address or a label.

import { addDays } from "../../public/closing.js";
import { SEGMENT_CODES } from "../constants";
import { BUYER_ID_RE, type ExpiringRow } from "../data";
import type { Env } from "../env";
import { segmentShort, type Lang } from "../i18n";
import { WITHIN_DAYS, type Within } from "../instruments";
import {
  BUYER_DUE_SQL, SEGMENT_DUE_SQL, type Query, SOURCE_NUMBER, fiscalYearOf, quarterEnd, readRecords,
} from "../records_db";
import {
  ACCOUNT_LANG_SQL, type Ceiling, GROUP_OVER, type QueryCount, STOP_CODES, type Tally, afterSend, budgetStop, likelyServed, sendWithHeaders,
  unfinished,
} from "./deliveries";
import { type DigestMessage, briefingDigest, briefingGroupDigest, siteLink } from "./digests";
import { allowed, savedSearchCap, SAVED_SEARCH_MAX, type Plan } from "./entitlements";
import { groupStopPath } from "./group_stop";
import { type InGroup, RunPool, groupIn, pooled } from "./pool";
import { type RecordsWait, missingTable } from "./records_deliveries";
import { newId, randomHex } from "./secrets";
import { EVENT_NOTABLE_CENTS, EVENT_NOTABLE_SHARE } from "./watch_events";
import { survivorOf } from "./watches";

export const BRIEFING_KINDS = ["segment", "buyer"] as const;
export type BriefingKind = (typeof BRIEFING_KINDS)[number];
export const isBriefingKind = (v: unknown): v is BriefingKind => v === "segment" || v === "buyer";

export const BRIEFING_DELIVERY = ["weekly", "off"] as const;
export type BriefingDelivery = (typeof BRIEFING_DELIVERY)[number];
export const isBriefingDelivery = (v: unknown): v is BriefingDelivery => v === "weekly" || v === "off";

// The weekday a briefing is sent on (Date.getUTCDay: 1 is Monday), as the
// open decision of the specification set it. A briefing not covered since the
// week's Monday (a nightly late on Monday, a first subscription) goes on the
// next data date of the same week.
export const BRIEFING_WEEKDAY = 1;
// The data dates a message covers: those after the last one covered (seven
// for a first message); after a message that failed, at most two weeks.
export const WEEK_DAYS = 7;
export const SPAN_DAYS_MAX = 14;
// Rows a section lists; six sections at most, so 60 rows a message.
export const SECTION_ROWS = 10;
// Section 6's window: the instruments index's 6-month expiry filter
// (instruments.ts WITHIN_DAYS), so the section's count is the count its "See
// all" link opens on.
export const INSTRUMENT_WITHIN = "6" as const;
export const INSTRUMENT_DAYS = WITHIN_DAYS[INSTRUMENT_WITHIN];
// Briefings the job reads in one run; the next hour reads the rest.
export const BRIEFINGS_RUN_MAX = 1000;
// How long a run's row is kept, and the rows the console's user page lists.
export const BRIEFING_DELIVERY_DAYS = 90;
export const BRIEFING_DELIVERY_ROWS = 20;
export const LABEL_MAX = 300;

// -- the calendar: weeks and fiscal quarters --------------------------------------------------

// The week's weekday on or before the data date: a briefing covered on or
// after it waits for the next one.
export function weekAnchor(dataDate: string): string {
  const day = new Date(`${dataDate}T00:00:00Z`).getUTCDay();
  return addDays(dataDate, -((day - BRIEFING_WEEKDAY + 7) % 7));
}

// Whether a briefing is due on a data date: delivery weekly, and not covered
// since the week's weekday.
export function briefingDue(deliver: string, lastDelivered: string | null, dataDate: string): boolean {
  if (deliver !== "weekly") return false;
  return !lastDelivered || lastDelivered.slice(0, 10) < weekAnchor(dataDate);
}

// The day the message's span starts after (exclusive): the last data date
// covered, so no day is reported twice (a Monday whose nightly came late sends
// on Tuesday, and the next Monday's span starts after that Tuesday); seven
// data dates back for a first message; at most SPAN_DAYS_MAX back after a
// message that failed.
export function briefingStart(lastDelivered: string | null, dataDate: string): string {
  if (!lastDelivered) return addDays(dataDate, -WEEK_DAYS);
  const prev = lastDelivered.slice(0, 10);
  const floor = addDays(dataDate, -SPAN_DAYS_MAX);
  return prev > floor ? prev : floor;
}

// A federal fiscal quarter: the fiscal year by the calendar year it starts in
// (records_db.fiscalYearOf) and the quarter, 1 April to June ... 4 January to
// March, with its first and last day.
export type Quarter = { fy: number; fq: number; first: string; last: string };

const pad2 = (n: number) => String(n).padStart(2, "0");

export function quarterOf(day: string): Quarter {
  const fy = fiscalYearOf(day);
  const month = Number(day.slice(5, 7));
  return quarterAt(fy, month >= 4 ? Math.floor((month - 4) / 3) + 1 : 4);
}

export function quarterAt(fy: number, fq: number): Quarter {
  const first = fq === 4 ? `${fy + 1}-01-01` : `${fy}-${pad2(4 + 3 * (fq - 1))}-01`;
  return { fy, fq, first, last: quarterEnd(fy, fq) };
}

export const quarterAfter = (q: Pick<Quarter, "fy" | "fq">): Quarter => (q.fq === 4 ? quarterAt(q.fy + 1, 1) : quarterAt(q.fy, q.fq + 1));

// The quarter section 3 lists: the one after the data date's. Stable from week
// to week within a quarter, so the "new this week" marks carry the change.
export const nextQuarter = (dataDate: string): Quarter => quarterAfter(quarterOf(dataDate));

// The last briefing of a quarter (next week's data date falls in another):
// the day the quarter turns and the quarter next week's briefing lists.
export function quarterTurn(dataDate: string): { on: string; quarter: Quarter } | null {
  const now = quarterOf(dataDate);
  const later = quarterOf(addDays(dataDate, WEEK_DAYS));
  if (later.fy === now.fy && later.fq === now.fq) return null;
  return { on: later.first, quarter: quarterAfter(later) };
}

// -- subjects -----------------------------------------------------------------------------------

export type BriefingSubject = { kind: BriefingKind; subject: string; segment: string };

// A subject as the page names it, checked as the page checks it; null for anything else.
export function subjectOf(kind: BriefingKind, raw: string): string | null {
  if (kind === "segment") return SEGMENT_CODES.includes(raw) ? raw : null;
  return BUYER_ID_RE.test(raw) && raw.length <= 80 ? raw : null;
}

// A buyer briefing's segment: '' for the whole buyer, else one of the 57 codes.
export const narrowOf = (raw: string | undefined): string | null => (!raw ? "" : SEGMENT_CODES.includes(raw) ? raw : null);

// What a page's Save this briefing link asks for before its reader has signed
// in (briefing_pages.tsx BriefingPanel, routes.tsx): the kind and the subject
// in one field, "<kind>:<subject>" (neither holds a colon). It rides along
// with the sign-in as ?next does, as a Follow form's follow does
// (watch_events.ts followOf), and is read back here by the rules the briefing
// post applies (isBriefingKind, subjectOf), so anything but one briefing of a
// page the site writes reads as null and is dropped. A buyer's link asks for
// the whole buyer: the segment choice stays with the signed-in form.
export type Brief = { kind: BriefingKind; subject: string };
// A kind, the colon and the 100 characters the briefing post reads of a subject.
export const BRIEF_MAX = 110;

export const briefValue = (kind: BriefingKind, subject: string): string => `${kind}:${subject}`;

export function briefOf(raw: string | undefined | null): Brief | null {
  if (typeof raw !== "string" || raw.length > BRIEF_MAX) return null;
  const at = raw.indexOf(":");
  const kind = raw.slice(0, at);
  if (at <= 0 || !isBriefingKind(kind)) return null;
  const subject = subjectOf(kind, raw.slice(at + 1));
  return subject ? { kind, subject } : null;
}

// The subject's page on the site, and its analytics view.
export const briefingPath = (s: Pick<BriefingSubject, "kind" | "subject">): string =>
  s.kind === "segment" ? `/segments/${s.subject}` : `/buyers/${s.subject}`;

// The briefing's name in a message or a list: "81 Engineering", a buyer's
// name, or a buyer narrowed to a segment, "Fisheries and Oceans Canada · 81
// Engineering". name is the buyer's name as the site wrote it.
export function briefingName(lang: Lang, s: BriefingSubject, name: string): string {
  if (s.kind === "segment") return `${s.subject} ${segmentShort(lang, s.subject)}`;
  return s.segment ? `${name} · ${s.segment} ${segmentShort(lang, s.segment)}` : name;
}

// A saved briefing's name in a page's or a message's language: a segment's
// rebuilt, a buyer's as the site wrote it (its name in the language it was
// saved in). The searches page, the stop page and a grouped message, which
// takes the account's language, read it.
export const briefingLabel = (lang: Lang, b: Pick<Briefing, "kind" | "subject" | "segment" | "label" | "lang">): string =>
  b.kind === "segment" ? briefingName(lang, b, "") : b.label;

// -- the records statements -------------------------------------------------------------------

// The week's events of a subject: a segment by rec_events_segment (?1 the
// segment as a number), a buyer by rec_events_buyer (?1 the buyer id, ?2 a
// segment it is narrowed to or -1); then the span, after one day and up to
// the data date.
const SEG_EVENTS = "sid = ?1 AND day > ?2 AND day <= ?3";
const BUY_EVENTS = "buyer = ?1 AND (?2 = -1 OR sid = ?2) AND day > ?3 AND day <= ?4";

// Section 1: the new notices, soonest closing first, with how many in all (a
// count row counts the rows it stands for, and sorts last).
const noticesSql = (where: string) =>
  "SELECT e.ref AS ref, e.day AS day, e.closing AS closing, e.title AS title, e.title_fr AS title_fr, e.path AS path, e.more AS more, " +
  "e.n AS n, b.name_en AS buyer_en, b.name_fr AS buyer_fr FROM (SELECT k, ref, day, closing, title, title_fr, path, more, buyer, " +
  `SUM(COALESCE(more, 1)) OVER () AS n FROM rec_events WHERE ${where} AND kind = 'notice' ` +
  `ORDER BY more IS NOT NULL, closing IS NULL, closing, day DESC, k LIMIT ${SECTION_ROWS}) e LEFT JOIN rec_buyers b ON b.id = e.buyer ` +
  `ORDER BY e.more IS NOT NULL, e.closing IS NULL, e.closing, e.day DESC, e.k LIMIT ${SECTION_ROWS}`;

// Section 2: the awards (the kind award: an award notice, a PSPC history
// record or a published contract new to the records; grants are their own
// kind and stay out, as the buyer digest's rule has it), the largest value
// first, with the winner and the buyer named.
const awardsSql = (where: string) =>
  "SELECT e.ref AS ref, e.src AS src, e.day AS day, e.cents AS cents, e.title AS title, e.title_fr AS title_fr, e.path AS path, e.sid AS sid, " +
  "o.name AS org, b.name_en AS buyer_en, b.name_fr AS buyer_fr FROM (SELECT k, ref, src, day, cents, title, title_fr, path, sid, oid, buyer " +
  `FROM rec_events WHERE ${where} AND kind = 'award' AND more IS NULL ORDER BY cents IS NULL, cents DESC, day DESC, k LIMIT ${SECTION_ROWS}) e ` +
  "LEFT JOIN rec_orgs o ON o.oid = e.oid LEFT JOIN rec_buyers b ON b.id = e.buyer " +
  `ORDER BY e.cents IS NULL, e.cents DESC, e.day DESC, e.k LIMIT ${SECTION_ROWS}`;

// Section 2's figures, each source on its own (nothing is added across
// sources): how many, their counted value, and how many have none. A count
// row (src NULL) stands for awards past the 100 a day one buyer keeps.
const sourcesSql = (where: string) =>
  "SELECT src, SUM(COALESCE(more, 1)) AS n, SUM(cents) AS cents, SUM(CASE WHEN more IS NULL AND cents IS NULL THEN 1 ELSE 0 END) AS n_no_value " +
  `FROM rec_events WHERE ${where} AND kind = 'award' GROUP BY src ORDER BY src LIMIT ${SECTION_ROWS}`;

// Section 4: the amendments whose counted value moved by EVENT_NOTABLE_CENTS
// or EVENT_NOTABLE_SHARE of the value before, the largest change first.
const NOTABLE =
  `cents IS NOT NULL AND ocents IS NOT NULL AND (abs(cents - ocents) >= ${EVENT_NOTABLE_CENTS} ` +
  `OR abs(cents - ocents) >= ${EVENT_NOTABLE_SHARE} * abs(ocents))`;
const amendedSql = (where: string) =>
  "SELECT e.ref AS ref, e.src AS src, e.day AS day, e.cents AS cents, e.ocents AS ocents, e.endd AS endd, e.oendd AS oendd, e.title AS title, " +
  "e.title_fr AS title_fr, e.path AS path, e.n AS n, o.name AS org, b.name_en AS buyer_en, b.name_fr AS buyer_fr FROM (" +
  "SELECT k, ref, src, day, cents, ocents, endd, oendd, title, title_fr, path, oid, buyer, COUNT(*) OVER () AS n FROM rec_events " +
  `WHERE ${where} AND kind = 'amended' AND more IS NULL AND ${NOTABLE} ORDER BY abs(cents - ocents) DESC, day DESC, k LIMIT ${SECTION_ROWS}) e ` +
  "LEFT JOIN rec_orgs o ON o.oid = e.oid LEFT JOIN rec_buyers b ON b.id = e.buyer " +
  `ORDER BY abs(e.cents - e.ocents) DESC, e.day DESC, e.k LIMIT ${SECTION_ROWS}`;

// Section 3: the radar's rows (rec_expiring) ending in the quarter, the
// largest Canadian value first, each marked fresh when the span saw it come
// onto the list: an award new to the records, or an amendment that moved its
// end date from outside the quarter. The 12-month crossing (ends_12m) cannot
// fall in the next quarter, so it marks nothing here. The row's rec_events ref
// is made as the events step makes it (records_db.record_ref) and found
// through rec_events_ref. The window counts run over the quarter's rows: how
// many, their counted value, how many have none, how many are fresh.
const FRESH = (s: string, d: string, qs: string, qe: string) =>
  "EXISTS (SELECT 1 FROM rec_events v WHERE v.ref = (CASE x.kind WHEN 1 THEN 'award:' || lower(json_extract(x.j, '$.reference')) " +
  "WHEN 2 THEN 'history:' || lower(json_extract(x.j, '$.reference')) ELSE 'contract:' || json_extract(x.j, '$.reference') END) " +
  `AND v.day > ${s} AND v.day <= ${d} AND (v.kind = 'award' OR (v.kind = 'amended' AND v.oendd IS NOT NULL ` +
  `AND (v.oendd < ${qs} OR v.oendd > ${qe}))))`;
const endingSql = (where: string, s: string, d: string, qs: string, qe: string) =>
  "SELECT endd, j, fresh, COUNT(*) OVER () AS n, SUM(cents) OVER () AS cents_all, SUM(nv) OVER () AS nv_all, SUM(fresh) OVER () AS n_new FROM (" +
  `SELECT x.endd AS endd, x.j AS j, x.cad AS cad, x.cents AS cents, x.nv AS nv, x.k AS k, ${FRESH(s, d, qs, qe)} AS fresh ` +
  `FROM rec_expiring x WHERE x.endd BETWEEN ${qs} AND ${qe} AND ${where}) ORDER BY cad IS NULL, cad DESC, endd, k LIMIT ${SECTION_ROWS}`;

// Section 5: the subject's largest counted records in the data date's fiscal
// year, each with its date from rec_details (a notice's row for a further
// segment has a key of its own and no date there).
const LARGEST_COLUMNS =
  "r.src AS src, r.ref AS ref, r.title AS title, d.title_fr AS title_fr, r.cents AS cents, r.sid AS sid, d.day AS day, o.name AS org, " +
  "b.name_en AS buyer_en, b.name_fr AS buyer_fr";
const largestSql = (where: string) =>
  `SELECT ${LARGEST_COLUMNS} FROM (SELECT k, src, ref, title, cents, sid, oid, bid FROM records WHERE ${where} AND cents IS NOT NULL ` +
  `ORDER BY cents DESC, ref LIMIT ${SECTION_ROWS}) r LEFT JOIN rec_details d ON d.k = r.k LEFT JOIN rec_orgs o ON o.oid = r.oid ` +
  `LEFT JOIN rec_buyers b ON b.bid = r.bid ORDER BY r.cents DESC, r.ref LIMIT ${SECTION_ROWS}`;

// Section 6: the standing offers and supply arrangements expiring from the
// data date to INSTRUMENT_DAYS later, as the index's window counts them, the
// soonest first, each with its type, description, end user and active
// holders. n above 0 keeps the active ones only (rec_instruments keeps a
// lapsed one 90 days with n at 0), as the index lists them. The table has no
// index by expiry, segment or end user, so the statement reads it whole (a
// few thousand rows, as feeds.ts WATCH_INSTRUMENTS_SQL does) and sorts the
// matches for the first SECTION_ROWS; COUNT(*) OVER () counts every match.
const instrumentsSql = (where: string, from: string, to: string) =>
  "SELECT agr, type_en, type_fr, desc_en, desc_fr, user_en, user_fr, expiry, n, COUNT(*) OVER () AS n_all FROM rec_instruments " +
  `WHERE ${where} AND n > 0 AND expiry BETWEEN ${from} AND ${to} ORDER BY expiry, agr LIMIT ${SECTION_ROWS}`;

const SEGMENT_SOURCES = `${SOURCE_NUMBER.awards}, ${SOURCE_NUMBER.history}`;
const BUYER_SOURCES = `${SOURCE_NUMBER.awards}, ${SOURCE_NUMBER.history}, ${SOURCE_NUMBER.contracts}`;

// A segment briefing: ?1 the segment as a number (the ending list and the
// instruments: as it sits in rec_expiring.segs and rec_instruments.segs,
// ' 81 '), ?2 the span's start, ?3 the data date, ?4 ?5 the quarter's first
// and last day; the largest: ?2 the fiscal year; the instruments: ?2 the
// data date, ?3 INSTRUMENT_DAYS later.
export const SEGMENT_BRIEFING_SQL = {
  notices: noticesSql(SEG_EVENTS),
  awards: awardsSql(SEG_EVENTS),
  sources: sourcesSql(SEG_EVENTS),
  ending: endingSql("instr(x.segs, ?1) > 0", "?2", "?3", "?4", "?5"),
  amended: amendedSql(SEG_EVENTS),
  // Every row of the segment, a notice's further segments included: each notice once in the segment, as its figures count it.
  largest: largestSql(`sid = ?1 AND src IN (${SEGMENT_SOURCES}) AND fy = ?2`),
  instruments: instrumentsSql("instr(segs, ?1) > 0", "?2", "?3"),
} as const;

// A buyer briefing: ?1 the buyer id, ?2 the segment it is narrowed to (a
// number, -1 for none; the ending list and the instruments: ' 81 ', '' for
// none), ?3 the span's start, ?4 the data date, ?5 ?6 the quarter; the
// largest: ?3 the fiscal year; the instruments: ?3 the data date, ?4
// INSTRUMENT_DAYS later. An instrument is the buyer's when its end user is
// (rec_instruments.buyer, which the index's end user filter reads too).
export const BUYER_BRIEFING_SQL = {
  notices: noticesSql(BUY_EVENTS),
  awards: awardsSql(BUY_EVENTS),
  sources: sourcesSql(BUY_EVENTS),
  ending: endingSql("x.buyer = ?1 AND (?2 = '' OR instr(x.segs, ?2) > 0)", "?3", "?4", "?5", "?6"),
  amended: amendedSql(BUY_EVENTS),
  // The whole buyer counts each record once (extra = 0); narrowed, its rows in the segment.
  largest: largestSql(
    `bid = (SELECT bid FROM rec_buyers WHERE id = ?1) AND src IN (${BUYER_SOURCES}) AND fy = ?3 AND ((?2 = -1 AND extra = 0) OR sid = ?2)`,
  ),
  instruments: instrumentsSql("buyer = ?1 AND (?2 = '' OR instr(segs, ?2) > 0)", "?3", "?4"),
} as const;

// Every statement a briefing reads, for the tests that read their plans and bounds.
export const BRIEFING_SQL: readonly string[] = [
  ...Object.values(SEGMENT_BRIEFING_SQL), ...Object.values(BUYER_BRIEFING_SQL), SEGMENT_DUE_SQL, BUYER_DUE_SQL,
];

// -- reading ------------------------------------------------------------------------------------

export type NoticeLine = {
  ref: string; day: string; closing: string | null; title: string | null; title_fr: string | null; path: string;
  buyer_en: string | null; buyer_fr: string | null;
};
export type AwardLine = {
  ref: string; src: number | null; day: string; cents: number | null; title: string | null; title_fr: string | null; path: string;
  sid: number | null; org: string | null; buyer_en: string | null; buyer_fr: string | null;
};
// One source's figures in section 2; src null for the count rows' awards.
export type SourceTotal = { src: number | null; n: number; cents: number | null; nv: number };
export type EndingLine = { row: Omit<ExpiringRow, "days_left">; fresh: boolean };
export type AmendLine = AwardLine & { ocents: number | null; endd: string | null; oendd: string | null };
export type LargestLine = {
  src: number; ref: string | null; title: string | null; title_fr: string | null; cents: number; sid: number | null; day: string | null;
  org: string | null; buyer_en: string | null; buyer_fr: string | null;
  // The record's page on the site (recordPath), null when it has none.
  path: string | null;
};
// n: the active holders, persons withheld counted.
export type InstrumentLine = {
  agr: string; type_en: string | null; type_fr: string | null; desc_en: string | null; desc_fr: string | null;
  user_en: string | null; user_fr: string | null; expiry: string; n: number;
};

export type BriefingData = {
  // The records database's data date, the data date the message is for, and
  // the day its span starts after.
  asOf: string | null; dataDate: string; start: string;
  notices: { n: number; rows: NoticeLine[] };
  awards: { n: number; sources: SourceTotal[]; rows: AwardLine[] };
  ending: { quarter: Quarter; n: number; cents: number | null; nv: number; fresh: number; rows: EndingLine[] };
  amended: { n: number; rows: AmendLine[] };
  largest: { fy: number; rows: LargestLine[] };
  // within: the index's expiry filter the section reads, for its link.
  instruments: { within: Within; n: number; rows: InstrumentLine[] };
  turn: { on: string; quarter: Quarter } | null;
};

export type BriefingRead = { state: "ready"; data: BriefingData } | { state: Exclude<RecordsWait, "stale"> };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function awardLine(r: Record<string, unknown>): AwardLine | null {
  const ref = str(r.ref);
  const path = str(r.path);
  const day = str(r.day);
  if (!ref || !path || !day) return null;
  return {
    ref, src: num(r.src), day, cents: num(r.cents), title: str(r.title), title_fr: str(r.title_fr), path, sid: num(r.sid),
    org: str(r.org), buyer_en: str(r.buyer_en), buyer_fr: str(r.buyer_fr),
  };
}

function expiringRow(j: unknown): Omit<ExpiringRow, "days_left"> | null {
  if (typeof j !== "string") return null;
  try {
    const v = JSON.parse(j) as Omit<ExpiringRow, "days_left">;
    return v && typeof v === "object" && typeof v.reference === "string" && typeof v.end === "string" ? v : null;
  } catch {
    return null;
  }
}

// The subject's sections for the span after `start` up to the data date, in
// one batch with the state row. Nothing here throws.
export async function readBriefing(env: Env, s: BriefingSubject, dataDate: string, start: string): Promise<BriefingRead> {
  const quarter = nextQuarter(dataDate);
  const fy = fiscalYearOf(dataDate);
  const until = addDays(dataDate, INSTRUMENT_DAYS);
  const seg = s.kind === "segment" ? s.subject : s.segment;
  const segNumber = seg ? Number(seg) : -1;
  const segText = seg ? ` ${seg} ` : "";
  const narrowed = s.kind === "buyer" && !!s.segment;
  let queries: Query[];
  if (s.kind === "segment") {
    const ev = [segNumber, start, dataDate];
    const q = SEGMENT_BRIEFING_SQL;
    queries = [
      { sql: q.notices, params: ev }, { sql: q.awards, params: ev }, { sql: q.sources, params: ev },
      { sql: q.ending, params: [segText, start, dataDate, quarter.first, quarter.last] },
      { sql: q.amended, params: ev }, { sql: q.largest, params: [segNumber, fy] },
      { sql: q.instruments, params: [segText, dataDate, until] },
      { sql: SEGMENT_DUE_SQL, params: [segNumber, quarter.fy, quarter.fy] },
    ];
  } else {
    const ev = [s.subject, segNumber, start, dataDate];
    const q = BUYER_BRIEFING_SQL;
    queries = [
      { sql: q.notices, params: ev }, { sql: q.awards, params: ev }, { sql: q.sources, params: ev },
      { sql: q.ending, params: [s.subject, segText, start, dataDate, quarter.first, quarter.last] },
      { sql: q.amended, params: ev }, { sql: q.largest, params: [s.subject, segNumber, fy] },
      { sql: q.instruments, params: [s.subject, segText, dataDate, until] },
      // rec_due holds a buyer's quarters and a segment's, never the two together: last, since a narrowed buyer has none.
      ...(narrowed ? [] : [{ sql: BUYER_DUE_SQL, params: [s.subject, quarter.fy, quarter.fy] }]),
    ];
  }
  const read = await readRecords(env, queries);
  if (read.state !== "ready") return { state: read.state };
  const [noticeRows, awardRows, sourceRows, endingRows, amendedRows, largestRows, instrumentRows, dueRows] = read.rows;

  // A count row sorts last and is not a notice: the count holds it.
  const notices = (noticeRows ?? []).filter((r) => r.more === null || r.more === undefined).map((r): NoticeLine | null => {
    const ref = str(r.ref);
    const path = str(r.path);
    const day = str(r.day);
    if (!ref || !path || !day) return null;
    return { ref, day, closing: str(r.closing), title: str(r.title), title_fr: str(r.title_fr), path, buyer_en: str(r.buyer_en), buyer_fr: str(r.buyer_fr) };
  }).filter((r): r is NoticeLine => r !== null);
  const sources = (sourceRows ?? []).map((r) => ({ src: num(r.src), n: num(r.n) ?? 0, cents: num(r.cents), nv: num(r.n_no_value) ?? 0 }))
    .filter((r) => r.n > 0);
  const ending = (endingRows ?? []).map((r) => {
    const row = expiringRow(r.j);
    return row ? { row, fresh: r.fresh === 1 } : null;
  }).filter((r): r is EndingLine => r !== null);
  const first = endingRows?.[0];
  const due = narrowed
    ? { n: num(first?.n) ?? 0, cents: num(first?.cents_all), nv: num(first?.nv_all) ?? 0 }
    : (() => {
      const r = (dueRows ?? []).find((x) => x.fy === quarter.fy && x.fq === quarter.fq);
      return { n: num(r?.n) ?? 0, cents: num(r?.cents), nv: num(r?.n_no_value) ?? 0 };
    })();
  const amended = (amendedRows ?? []).map((r) => {
    const a = awardLine(r);
    return a ? { ...a, ocents: num(r.ocents), endd: str(r.endd), oendd: str(r.oendd) } : null;
  }).filter((r): r is AmendLine => r !== null);
  const largest = (largestRows ?? []).map((r): LargestLine | null => {
    const src = num(r.src);
    const cents = num(r.cents);
    return src !== null && cents !== null ? {
      src, ref: str(r.ref), title: str(r.title), title_fr: str(r.title_fr), cents, sid: num(r.sid), day: str(r.day), org: str(r.org),
      buyer_en: str(r.buyer_en), buyer_fr: str(r.buyer_fr), path: recordPath(src, str(r.ref)),
    } : null;
  }).filter((r): r is LargestLine => r !== null);
  const instruments = (instrumentRows ?? []).map((r): InstrumentLine | null => {
    const agr = str(r.agr);
    const expiry = str(r.expiry);
    const holders = num(r.n);
    return agr && expiry && holders !== null ? {
      agr, type_en: str(r.type_en), type_fr: str(r.type_fr), desc_en: str(r.desc_en), desc_fr: str(r.desc_fr), user_en: str(r.user_en),
      user_fr: str(r.user_fr), expiry: expiry.slice(0, 10), n: holders,
    } : null;
  }).filter((r): r is InstrumentLine => r !== null);

  return {
    state: "ready",
    data: {
      asOf: read.asOf && DAY_RE.test(read.asOf) ? read.asOf : null, dataDate, start,
      notices: { n: num(noticeRows?.[0]?.n) ?? 0, rows: notices },
      awards: {
        n: sources.reduce((sum, x) => sum + x.n, 0), sources, rows: (awardRows ?? []).map(awardLine).filter((r): r is AwardLine => r !== null),
      },
      ending: { quarter, ...due, fresh: num(first?.n_new) ?? 0, rows: ending },
      amended: { n: num(amendedRows?.[0]?.n) ?? 0, rows: amended },
      largest: { fy, rows: largest },
      instruments: { within: INSTRUMENT_WITHIN, n: num(instrumentRows?.[0]?.n_all) ?? 0, rows: instruments },
      turn: quarterTurn(dataDate),
    },
  };
}

// Whether a briefing has anything to send: a row in the week's sections, or a
// contract ending next quarter (the quarter's list is the standing part). The
// fiscal year's largest records and the instruments ending within 6 months
// alone are not news: both lists stand from week to week.
export const hasNews = (d: BriefingData): boolean => d.notices.n + d.awards.n + d.amended.n + d.ending.n > 0;

// How many rows the message lists, for its delivery row.
export const listedRows = (d: BriefingData): number =>
  d.notices.rows.length + d.awards.rows.length + d.ending.rows.length + d.amended.rows.length + d.largest.rows.length +
  d.instruments.rows.length;

// The page a record of the largest list links: an award notice or a history
// record its page here, a published contract its page here; null for none.
export function recordPath(src: number, ref: string | null): string | null {
  if (!ref) return null;
  if (src === SOURCE_NUMBER.awards || src === SOURCE_NUMBER.history) {
    return /^[A-Za-z0-9._-]{1,120}$/.test(ref) ? `/${src === SOURCE_NUMBER.awards ? "awards" : "history"}/${ref.toLowerCase()}` : null;
  }
  // As pages/shared.tsx contractPath writes it: the department, then the reference, each one path segment.
  const at = ref.indexOf(":");
  if (src !== SOURCE_NUMBER.contracts || at <= 0 || at >= ref.length - 1) return null;
  return `/contracts/${encodeURIComponent(ref.slice(0, at))}/${encodeURIComponent(ref.slice(at + 1))}`;
}

// -- the rows in the accounts database ------------------------------------------------------------

export type Briefing = BriefingSubject & {
  id: string; label: string; lang: Lang; created_at: string; deliver: BriefingDelivery; last_delivered_at: string | null;
};

type BriefingRow = Omit<Briefing, "kind" | "lang" | "deliver"> & { kind: string; lang: string; deliver: string };

const toBriefing = (r: BriefingRow): Briefing | null =>
  isBriefingKind(r.kind)
    ? { ...r, kind: r.kind, lang: r.lang === "fr" ? "fr" : "en", deliver: r.deliver === "weekly" ? "weekly" : "off", segment: r.segment ?? "" }
    : null;

export const BRIEFING_LIST_SQL =
  "SELECT id, kind, subject, segment, label, lang, created_at, deliver, last_delivered_at FROM briefings WHERE user_id = ? " +
  `ORDER BY created_at, id LIMIT ${SAVED_SEARCH_MAX}`;

// The account's briefings, oldest first; null before the table exists.
export async function listBriefings(env: Env, userId: string): Promise<Briefing[] | null> {
  try {
    const res = await env.ACCOUNTS!.prepare(BRIEFING_LIST_SQL).bind(userId).all<BriefingRow>();
    return (res.results ?? []).map(toBriefing).filter((b): b is Briefing => b !== null);
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// The cap the saved searches and the briefings share: the plan's, at most SAVED_SEARCH_MAX.
export const sharedCap = (plan: Plan): number => Math.min(savedSearchCap(plan), SAVED_SEARCH_MAX);

// The count of the account's rows in table made before the row r (the alias
// of a saved search or a briefing in the statement that uses it): by
// creation, then by id, the order the shared cap counts them in. Past the
// plan's figure (after a move to a smaller plan) only the first ones in that
// order are sent (deliveries.ts, runBriefings). Through each table's index on
// user_id, at most SAVED_SEARCH_MAX rows an account.
export const madeBefore = (r: string, table: "saved_searches" | "briefings") =>
  `(SELECT COUNT(*) FROM ${table} x WHERE x.user_id = ${r}.user_id AND (x.created_at < ${r}.created_at OR (x.created_at = ${r}.created_at AND x.id < ${r}.id)))`;

// One insert, held to the shared cap inside the statement (both tables
// counted), so two posts at once cannot pass it: delivery weekly on a plan
// with delivery, off otherwise. "exists" when the same subject (and segment)
// is subscribed already. users is the accounts the cap is counted over: the
// account's own (?2), or for an account in a group the group's ids at ?11 to
// ?15 (pool.ts); the same subject stays the account's own (the unique key).
const addBriefingSql = (users: string) =>
  "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) " +
  `SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE (SELECT COUNT(*) FROM saved_searches WHERE user_id ${users}) + ` +
  `(SELECT COUNT(*) FROM briefings WHERE user_id ${users}) < ?10 ON CONFLICT (user_id, kind, subject, segment) DO NOTHING`;
export const ADD_BRIEFING_SQL = addBriefingSql("= ?2");
export const ADD_BRIEFING_GROUP_SQL = addBriefingSql(`IN ${groupIn(11)}`);

export async function addBriefing(
  env: Env, who: { userId: string; plan: Plan } & InGroup, b: BriefingSubject & { label: string }, lang: Lang, now = new Date(),
): Promise<"added" | "exists" | "cap"> {
  const db = env.ACCOUNTS!;
  const q = pooled(who, ADD_BRIEFING_SQL, ADD_BRIEFING_GROUP_SQL);
  const res = await db.prepare(q.sql).bind(newId(), who.userId, b.kind, b.subject, b.segment, b.label.slice(0, LABEL_MAX), lang, now.toISOString(),
    allowed(who, "delivery") ? "weekly" : "off", sharedCap(who.plan), ...q.binds).run();
  if ((res.meta?.changes ?? 0) === 1) return "added";
  const same = await db.prepare("SELECT 1 AS x FROM briefings WHERE user_id = ? AND kind = ? AND subject = ? AND segment = ?")
    .bind(who.userId, b.kind, b.subject, b.segment).first();
  return same ? "exists" : "cap";
}

export async function setBriefingDelivery(env: Env, userId: string, id: string, deliver: BriefingDelivery): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare("UPDATE briefings SET deliver = ? WHERE id = ? AND user_id = ?").bind(deliver, id, userId).run();
  return (res.meta?.changes ?? 0) === 1;
}

export async function deleteBriefing(env: Env, userId: string, id: string): Promise<boolean> {
  const db = env.ACCOUNTS!;
  const res = await db.batch([
    db.prepare("DELETE FROM briefing_deliveries WHERE briefing_id IN (SELECT id FROM briefings WHERE id = ? AND user_id = ?)").bind(id, userId),
    db.prepare("DELETE FROM briefings WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  return (res[1]?.meta?.changes ?? 0) === 1;
}

// What deleting an account removes of its briefings (routes.tsx
// deleteAccount): every briefing and its runs. A database without the tables
// yet holds none, so a missing table is no fault here.
export async function deleteBriefingsOf(env: Env, userId: string): Promise<void> {
  const db = env.ACCOUNTS!;
  try {
    await db.batch([
      db.prepare("DELETE FROM briefing_deliveries WHERE briefing_id IN (SELECT id FROM briefings WHERE user_id = ?)").bind(userId),
      db.prepare("DELETE FROM briefings WHERE user_id = ?").bind(userId),
    ]);
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

// A page's briefing for the reader: the id of the account's briefing of it
// (the whole buyer first), its segment, and how many searches and briefings
// the account holds; null before the table exists. For an account in a group,
// n is the group's (?4 to ?8), so the page reads full when the subscription
// is, and mine the account's own, in the same statement; the briefing read is
// the account's own either way.
const BRIEFING_OWN = "FROM briefings WHERE user_id = ?1 AND kind = ?2 AND subject = ?3 ORDER BY segment, created_at LIMIT 1";
const SHARED_OWN = "(SELECT COUNT(*) FROM briefings WHERE user_id = ?1) + (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1)";
const briefingStateSql = (counts: string) =>
  `SELECT (SELECT id ${BRIEFING_OWN}) AS id, (SELECT segment ${BRIEFING_OWN}) AS segment, (SELECT deliver ${BRIEFING_OWN}) AS deliver, ${counts}`;
export const BRIEFING_STATE_SQL = briefingStateSql(`${SHARED_OWN} AS n`);
export const BRIEFING_STATE_GROUP_SQL = briefingStateSql(
  `(SELECT COUNT(*) FROM briefings WHERE user_id IN ${groupIn(4)}) + (SELECT COUNT(*) FROM saved_searches WHERE user_id IN ${groupIn(4)}) AS n, ` +
  `${SHARED_OWN} AS mine`,
);

export async function briefingState(
  env: Env, who: { userId: string } & InGroup, kind: BriefingKind, subject: string,
): Promise<{ id: string | null; segment: string; deliver: BriefingDelivery | null; n: number; mine?: number } | null> {
  try {
    const q = pooled(who, BRIEFING_STATE_SQL, BRIEFING_STATE_GROUP_SQL);
    const row = await env.ACCOUNTS!.prepare(q.sql).bind(who.userId, kind, subject, ...q.binds)
      .first<{ id: string | null; segment: string | null; deliver: string | null; n: number; mine?: number }>();
    const deliver = row?.deliver === "weekly" || row?.deliver === "off" ? row.deliver : null;
    return { id: row?.id ?? null, segment: row?.segment ?? "", deliver, n: row?.n ?? 0, ...(who.group ? { mine: row?.mine ?? 0 } : {}) };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// The newest run of each of the account's briefings, by briefing id.
export type BriefingRun = { sent_at: string; day: string; items: number; status: string };

export async function lastBriefingRuns(env: Env, userId: string): Promise<Map<string, BriefingRun>> {
  const res = await env.ACCOUNTS!.prepare(
    "SELECT d.briefing_id, d.sent_at, d.day, d.items, d.status FROM briefing_deliveries d WHERE d.id IN (" +
    "SELECT MAX(x.id) FROM briefing_deliveries x JOIN briefings b ON b.id = x.briefing_id WHERE b.user_id = ? GROUP BY x.briefing_id)",
  ).bind(userId).all<BriefingRun & { briefing_id: string }>();
  return new Map((res.results ?? []).map(({ briefing_id, ...run }) => [briefing_id, run]));
}

// -- the run --------------------------------------------------------------------------------------

export type BriefingWait = RecordsWait | "no_table";

export interface BriefingReport {
  sent: number;
  failed: number;
  // Of the messages sent, the grouped ones, and the briefings they carried (each grouped message counts once in sent).
  groups: number;
  grouped: number;
  empty: number;
  // Due briefings whose owner's plan does not allow delivery.
  skipped: number;
  // Briefings left for a later run, and why; records is null when none waited.
  waiting: number;
  records: BriefingWait | null;
}

export const emptyBriefingReport = (): BriefingReport => ({
  sent: 0, failed: 0, groups: 0, grouped: 0, empty: 0, skipped: 0, waiting: 0, records: null,
});

// The briefings that can be due this week, those of accounts whose cached
// plan is paid first, then oldest first (?1 the week's weekday on or before
// the data date, ?2 the cap): delivery weekly, an active account that is not
// blocked, not covered since ?1, and no message refused for it since then (it
// waits for next week, whose message covers both). n_before counts the
// account's saved searches and briefings made before it (madeBefore above):
// past the plan's figure, after a move to a smaller plan, only the first ones
// by creation date are sent. The cached plan (users.plan) only orders the
// list, so the briefings of accounts that moved down, each read once a week
// and passed over, come after the ones paid for; planFor at the send decides.
export const BRIEFINGS_DUE_SQL =
  "SELECT b.id, b.user_id, b.kind, b.subject, b.segment, b.label, b.lang, b.deliver, b.last_delivered_at, b.secret, u.email, u.plan, u.plan_until, " +
  `${madeBefore("b", "saved_searches")} + ${madeBefore("b", "briefings")} AS n_before ` +
  "FROM briefings b JOIN users u ON u.id = b.user_id WHERE b.deliver = 'weekly' AND u.status = 'active' " +
  "AND (b.last_delivered_at IS NULL OR substr(b.last_delivered_at, 1, 10) < ?1) " +
  "AND NOT EXISTS (SELECT 1 FROM briefing_deliveries d WHERE d.briefing_id = b.id AND d.status = 'failed' AND d.sent_at >= ?1) " +
  "AND NOT EXISTS (SELECT 1 FROM account_blocks x WHERE x.user_id = b.user_id) ORDER BY u.plan = 'free', b.created_at, b.id LIMIT ?2";

type DueRow = BriefingRow & { user_id: string; secret: string | null; email: string; plan: string; plan_until: string | null; n_before: number };

// The briefing taken for the week by this run: one statement that holds only
// while no run has covered it since the week's weekday. The same statement
// covers a briefing passed over (passedOver below), and a group's claims are
// made with it, one each, in one batch (claimAll).
const CLAIM_SQL =
  "UPDATE briefings SET last_delivered_at = ?1 WHERE id = ?2 AND deliver = 'weekly' AND (last_delivered_at IS NULL OR substr(last_delivered_at, 1, 10) < ?3)";

async function claim(env: Env, id: string, anchor: string, now: Date): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(CLAIM_SQL).bind(now.toISOString(), id, anchor).run();
  return (res.meta?.changes ?? 0) === 1;
}

// A group's claims: each briefing its own statement, in one batch (one query); whether each one holds, in order.
async function claimAll(env: Env, ids: readonly string[], anchor: string, now: Date): Promise<boolean[]> {
  const db = env.ACCOUNTS!;
  const results = await db.batch(ids.map((id) => db.prepare(CLAIM_SQL).bind(now.toISOString(), id, anchor)));
  return results.map((r) => (r.meta?.changes ?? 0) === 1);
}

// The claim given back, while it is this run's.
const RELEASE_SQL = "UPDATE briefings SET last_delivered_at = ?1 WHERE id = ?2 AND last_delivered_at = ?3";

async function release(env: Env, id: string, before: string | null, now: Date): Promise<void> {
  await env.ACCOUNTS!.prepare(RELEASE_SQL).bind(before, id, now.toISOString()).run();
}

// The briefings read and passed over because their account's plan does not
// send them (no delivery, or past the plan's figure after a move to a smaller
// plan): covered for the week as a claim would cover them, with no run row,
// so they leave the week's list and do not fill it ahead of the briefings that
// are paid for. A plan restored that week sends from the next Monday on. One
// D1 batch of at most MARKS_BATCH statements a query.
export const MARKS_BATCH = 100;

async function passedOver(env: Env, ids: readonly string[], anchor: string, now: Date): Promise<void> {
  const db = env.ACCOUNTS!;
  for (let i = 0; i < ids.length; i += MARKS_BATCH) {
    await db.batch(ids.slice(i, i + MARKS_BATCH).map((id) => db.prepare(CLAIM_SQL).bind(now.toISOString(), id, anchor)));
  }
}

// A grouped message's stop link (/account/stop?gb=, routes.tsx): the account's briefings that hold a stop secret,
// through idx_briefings_user, at most GROUP_TAGS_MAX (?2), each checked against the link's tags (group_stop.ts).
export const GROUP_STOP_SQL =
  "SELECT b.id, b.user_id, b.kind, b.subject, b.segment, b.label, b.lang, b.deliver, b.secret FROM briefings b JOIN users u ON u.id = b.user_id " +
  "WHERE b.user_id = ? AND b.secret IS NOT NULL AND u.status = 'active' ORDER BY b.created_at, b.id LIMIT ?";

// One run row, written only while the briefing exists.
const RECORD_SQL =
  "INSERT INTO briefing_deliveries (briefing_id, sent_at, day, items, status) SELECT ?1, ?2, ?3, ?4, ?5 " +
  "WHERE EXISTS (SELECT 1 FROM briefings WHERE id = ?1)";

const recordStatement = (env: Env, id: string, status: "sent" | "failed" | "empty", items: number, now: Date, dataDate: string) =>
  env.ACCOUNTS!.prepare(RECORD_SQL).bind(id, now.toISOString(), dataDate, items, status);

async function record(env: Env, id: string, status: "sent" | "failed" | "empty", items: number, now: Date, dataDate: string): Promise<void> {
  await recordStatement(env, id, status, items, now, dataDate).run();
}

// Every claim of a group given back together, and, when the mail service
// refused the message, each briefing's failed row with it: one batch.
async function releaseAll(
  env: Env, held: readonly { id: string; before: string | null }[], now: Date, dataDate: string, failed: readonly { id: string; items: number }[] = [],
): Promise<void> {
  const db = env.ACCOUNTS!;
  await db.batch([
    ...held.map((h) => db.prepare(RELEASE_SQL).bind(h.before, h.id, now.toISOString())),
    ...failed.map((f) => recordStatement(env, f.id, "failed", f.items, now, dataDate)),
  ]);
}

// The stop link's secret, made with the briefing's first message.
async function stopSecret(env: Env, id: string): Promise<string | null> {
  const db = env.ACCOUNTS!;
  const [, read] = await db.batch([
    db.prepare("UPDATE briefings SET secret = ? WHERE id = ? AND secret IS NULL").bind(randomHex(16), id),
    db.prepare("SELECT secret FROM briefings WHERE id = ?").bind(id),
  ]);
  return (read.results?.[0] as { secret?: string } | undefined)?.secret ?? null;
}

// What a grouped message needs after its claims, in one batch (one query):
// the stop secrets of its briefings that have none yet, made as stopSecret
// makes one (a briefing deleted while the run was going has none), and the
// account's mail language (users.lang), which a grouped message takes. The
// secrets are read by the primary key, at most an account's 100.
export const GROUP_SECRETS_SQL = "SELECT id, secret FROM briefings WHERE id IN (SELECT value FROM json_each(?))";

async function groupSecrets(env: Env, userId: string, ids: readonly string[]): Promise<{ secrets: Map<string, string>; lang: Lang }> {
  const db = env.ACCOUNTS!;
  const results = await db.batch([
    ...ids.map((id) => db.prepare("UPDATE briefings SET secret = ? WHERE id = ? AND secret IS NULL").bind(randomHex(16), id)),
    ...(ids.length ? [db.prepare(GROUP_SECRETS_SQL).bind(JSON.stringify(ids))] : []),
    db.prepare(ACCOUNT_LANG_SQL).bind(userId),
  ]);
  const rows = (ids.length ? results[results.length - 2]?.results ?? [] : []) as { id: string; secret: string | null }[];
  const lang = (results[results.length - 1]?.results?.[0] as { lang?: string } | undefined)?.lang === "fr" ? "fr" : "en";
  return { secrets: new Map(rows.filter((r) => r.secret).map((r) => [r.id, r.secret!])), lang };
}

// room: the messages the run may still send (the cap less what the saved
// searches and the watch mail sent). stop: why the run stopped early.
// queries: the run's count (deliveries.ts QueryCount); tally: what the run
// left due, which this part adds to on every way out; ceiling: what the
// day's ceiling still allows (deliveries.ts Ceiling); report: the report to
// fill, the caller's, so a fault keeps what was sent before it
// (deliveries.ts partFault); a part run alone makes its own.
//
// Grouping, as the saved searches group (deliveries.ts): an account with more
// than GROUP_OVER briefings due in the list is taken up whole where its first
// one stands, each of them read before any is sent; when more than
// GROUP_OVER of them have something to send (passed over and empty ones out),
// they go as one message (briefingGroupDigest, sendGroup below), counted once
// against the cap, the day's ceiling and the run log, each briefing keeping
// its own claim and its own run row. Every other account's briefings go in the
// list's order, one message each, exactly as before grouping.
export async function runBriefings(
  env: Env,
  o: {
    site: string; dataDate: string; now: Date; plans: Map<string, Plan>; room: number; capText: string; queries?: QueryCount; tally?: Tally;
    ceiling?: Ceiling;
    // The run's groups and their counts (pool.ts RunPool); a part run alone keeps its own.
    pool?: RunPool;
    report?: BriefingReport;
  },
): Promise<{ report: BriefingReport; stop: string | null; capped: boolean }> {
  const { site, dataDate, now } = o;
  const pool = o.pool ?? new RunPool();
  const report = o.report ?? emptyBriefingReport();
  const anchor = weekAnchor(dataDate);
  let due: DueRow[];
  try {
    due = (await env.ACCOUNTS!.prepare(BRIEFINGS_DUE_SQL).bind(anchor, BRIEFINGS_RUN_MAX).all<DueRow>()).results ?? [];
    await env.ACCOUNTS!.prepare("DELETE FROM briefing_deliveries WHERE sent_at < ?")
      .bind(new Date(now.getTime() - BRIEFING_DELIVERY_DAYS * 86_400_000).toISOString()).run();
  } catch (e) {
    if (!missingTable(e)) throw e;
    report.records = "no_table";
    return { report, stop: null, capped: false };
  }
  // Two briefings of one subject and span read the records database once.
  const reads = new Map<string, BriefingRead>();
  let stop: string | null = null;
  let capped = false;
  // The claims this run holds and has not yet recorded or given back: a fault in between gives them back.
  let held: { id: string; before: string | null }[] = [];
  const unhold = (id: string) => {
    held = held.filter((h) => h.id !== id);
  };
  const passed: string[] = [];
  // Past the run's query budget (deliveries.ts QueryCount), nothing more is taken up; the next hour goes on.
  const pause = (claiming = false): boolean => {
    const why = budgetStop(o.queries, claiming);
    if (why) {
      stop = why;
      capped = true;
    }
    return why !== null;
  };
  const dueOn = (r: DueRow): boolean => {
    const b = toBriefing(r);
    return !!b && briefingDue(b.deliver, b.last_delivered_at, dataDate);
  };
  // The due briefings of each account in the list, and the rows an account taken up whole has dealt with (handled),
  // so the list's later rows of it are passed by and what the part leaves due counts them only while they wait.
  const perAccount = new Map<string, number>();
  for (const r of due) if (dueOn(r)) perAccount.set(r.user_id, (perAccount.get(r.user_id) ?? 0) + 1);
  const taken = new Set<string>();
  const handled = new Set<string>();
  const left = (from: number) => due.slice(from).filter((r) => !handled.has(r.id)).length;

  // A briefing read for its message: the briefing at its surviving id, its row and what it reports.
  type Readied = { row: DueRow; b: Briefing; data: BriefingData };
  type Step = { go: "next" } | { go: "stop" } | { go: "send"; item: Readied };
  // One briefing read: its plan, its place within the figure, its records; an empty one's row written. "stop" when the
  // part must stop (the budget, or the records database not ready: every briefing from `from` on waits).
  const readOne = async (row: DueRow, from: number): Promise<Step> => {
    const saved = toBriefing(row);
    if (!saved || !briefingDue(saved.deliver, saved.last_delivered_at, dataDate)) return { go: "next" };
    if (pause()) return { go: "stop" };
    const plan = await pool.plan(env, o.plans, { id: row.user_id, plan: row.plan, plan_until: row.plan_until }, now);
    // One figure with the saved searches: in a group, the account's allowance of the subscription's (pool.ts).
    if (!allowed({ plan }, "delivery") || (row.n_before ?? 0) >= (await pool.allowance(env, row.user_id, "searches", sharedCap(plan)))) {
      report.skipped++;
      passed.push(saved.id);
      return { go: "next" };
    }
    // A buyer the nightly merged into another is read at the surviving id (watches.ts survivorOf, as a
    // watch follows it); the briefing's row and label keep the id saved.
    const moved = saved.kind === "buyer" ? await survivorOf(env, "buyer", saved.subject) : null;
    const b = moved ? { ...saved, subject: moved } : saved;
    const start = briefingStart(b.last_delivered_at, dataDate);
    const key = `${b.kind}\n${b.subject}\n${b.segment}\n${start}`;
    let read = reads.get(key);
    if (!read) {
      read = await readBriefing(env, b, dataDate, start);
      reads.set(key, read);
    }
    if (read.state !== "ready" || read.data.asOf !== dataDate) {
      report.records = read.state === "ready" ? "stale" : read.state;
      report.waiting += left(from);
      return { go: "stop" };
    }
    const data = read.data;
    if (!hasNews(data)) {
      if (pause(true)) return { go: "stop" };
      if (!(await claim(env, b.id, anchor, now))) return { go: "next" };
      held = [{ id: b.id, before: b.last_delivered_at }];
      await record(env, b.id, "empty", 0, now, dataDate);
      held = [];
      report.empty++;
      return { go: "next" };
    }
    return { go: "send", item: { row, b, data } };
  };

  // Whether the part may take up one more message: under the room, under the day's ceiling, with the queries for a
  // claim and its writes left.
  const mayTakeUp = (): boolean => {
    if (report.sent + report.failed >= o.room) {
      stop = o.capText;
      capped = true;
      return false;
    }
    // The day's ceiling reached: stopped before the claim, as a sending limit stops the run.
    if (o.ceiling && report.sent >= o.ceiling.room) {
      stop = o.ceiling.text;
      return false;
    }
    return !pause(true);
  };

  // A briefing's own message, its claim held by this run and its stop secret known: sent and recorded, or its claim
  // given back. Counted before the writes after it, so a fault there cannot take it out of the run's count.
  const sendClaimed = async (x: Readied, secret: string): Promise<"next" | "stop"> => {
    const { row, b, data } = x;
    const message: DigestMessage = briefingDigest({
      lang: b.lang, to: row.email, site, stopUrl: siteLink(site, `/account/stop?b=${b.id}&t=${secret}`, b.lang), briefing: b,
      name: b.label, data,
    });
    const items = listedRows(data);
    const result = await sendWithHeaders(env, site, message);
    if (result.sent) {
      unhold(b.id);
      report.sent++;
      await afterSend(() => record(env, b.id, "sent", items, now, dataDate));
      return "next";
    }
    if (result.code && STOP_CODES.has(result.code)) {
      await release(env, b.id, b.last_delivered_at, now);
      unhold(b.id);
      stop = result.code;
      return "stop";
    }
    report.failed++;
    await release(env, b.id, b.last_delivered_at, now);
    unhold(b.id);
    await record(env, b.id, "failed", items, now, dataDate);
    return "next";
  };

  // A briefing's own message, as before grouping: taken up, claimed, its secret made with the first message.
  const sendOne = async (x: Readied): Promise<"next" | "stop"> => {
    const { row, b } = x;
    if (!mayTakeUp()) return "stop";
    if (!(await claim(env, b.id, anchor, now))) return "next";
    held = [{ id: b.id, before: b.last_delivered_at }];
    const secret = row.secret ?? (await stopSecret(env, b.id));
    if (!secret) {
      await release(env, b.id, b.last_delivered_at, now);
      held = [];
      return "next";
    }
    return sendClaimed(x, secret);
  };

  // More than GROUP_OVER of an account's briefings with something to send: one message, one against the room and the
  // day's ceiling, all or nothing, as deliveries.ts sendGroup sends an account's saved searches. Each briefing keeps its
  // own claim (one batch) and its own run row (one batch after the send); a send that does not go gives every claim back
  // together. At most GROUP_QUERIES queries from the claims on (the claims, the secrets and the account's language, the
  // rows and their one retry), inside what mayTakeUp holds back. When the claims leave GROUP_OVER or fewer (a stop link
  // clicked since the list was read), each goes as its own message, the second and later each held to mayTakeUp again.
  const sendGroup = async (items: Readied[]): Promise<"next" | "stop"> => {
    if (!mayTakeUp()) return "stop";
    const claimed = await claimAll(env, items.map((x) => x.b.id), anchor, now);
    const members = items.filter((_, k) => claimed[k]);
    for (const x of items) if (!members.includes(x)) handled.add(x.row.id);
    if (!members.length) return "next";
    held = members.map((x) => ({ id: x.b.id, before: x.b.last_delivered_at }));
    const userId = members[0].row.user_id;
    const made = await groupSecrets(env, userId, members.filter((x) => !x.row.secret).map((x) => x.b.id));
    const secretOf = (x: Readied) => x.row.secret ?? made.secrets.get(x.b.id) ?? null;
    // A briefing deleted while the run was going has no secret any more, and its claim went with its row.
    const kept = members.filter((x) => secretOf(x));
    for (const x of members) if (!kept.includes(x)) handled.add(x.row.id);
    held = held.filter((h) => kept.some((x) => x.b.id === h.id));
    if (!kept.length) return "next";
    if (kept.length <= GROUP_OVER) {
      for (const [k, x] of kept.entries()) {
        // The first was taken up with the group (mayTakeUp above); each later one is a message of its own.
        const went = k > 0 && !mayTakeUp() ? "stop" : await sendClaimed(x, secretOf(x)!);
        if (went === "stop") {
          if (held.length) await releaseAll(env, held, now, dataDate);
          held = [];
          return "stop";
        }
        handled.add(x.row.id);
      }
      return "next";
    }
    const lang = made.lang;
    const sections = kept.map((x) => ({
      label: briefingLabel(lang, x.b), briefing: x.b, data: x.data, stopUrl: siteLink(site, `/account/stop?b=${x.b.id}&t=${secretOf(x)}`, lang),
    }));
    const stopUrl = siteLink(site, await groupStopPath(userId, kept.map((x) => ({ id: x.b.id, secret: secretOf(x)! })), "briefings"), lang);
    const message = briefingGroupDigest({ lang, to: kept[0].row.email, site, dataDate, stopUrl, sections, over: GROUP_OVER });
    const result = await sendWithHeaders(env, site, message);
    if (result.sent) {
      // Sent: the claims stand, whatever happens to the rows that record them, and the message is counted first.
      held = [];
      for (const x of kept) handled.add(x.row.id);
      report.sent++;
      report.groups++;
      report.grouped += kept.length;
      await afterSend(() => env.ACCOUNTS!.batch(kept.map((x) => recordStatement(env, x.b.id, "sent", listedRows(x.data), now, dataDate))));
      return "next";
    }
    if (result.code && STOP_CODES.has(result.code)) {
      await releaseAll(env, held, now, dataDate);
      held = [];
      stop = result.code;
      return "stop";
    }
    report.failed++;
    await releaseAll(env, held, now, dataDate, kept.map((x) => ({ id: x.b.id, items: listedRows(x.data) })));
    held = [];
    for (const x of kept) handled.add(x.row.id);
    return "next";
  };

  // An account taken up whole (more than GROUP_OVER of its briefings due): each read in the list's order, then grouped
  // or sent one by one. `from` is where its first one stands.
  const takeAccount = async (userId: string, from: number): Promise<"next" | "stop"> => {
    const rows = due.slice(from).filter((r) => r.user_id === userId);
    const items: Readied[] = [];
    for (const r of rows) {
      taken.add(r.id);
      const step = await readOne(r, from);
      if (step.go === "stop") return "stop";
      if (step.go === "send") items.push(step.item);
      else handled.add(r.id);
    }
    if (items.length > GROUP_OVER) return sendGroup(items);
    for (const x of items) {
      if ((await sendOne(x)) === "stop") return "stop";
      handled.add(x.row.id);
    }
    return "next";
  };

  let i = 0;
  try {
    for (; i < due.length; i++) {
      const row = due[i];
      if (taken.has(row.id)) continue;
      if ((perAccount.get(row.user_id) ?? 0) > GROUP_OVER) {
        if ((await takeAccount(row.user_id, i)) === "stop") break;
        continue;
      }
      const step = await readOne(row, i);
      if (step.go === "stop") break;
      if (step.go === "next") continue;
      if ((await sendOne(step.item)) === "stop") break;
    }
    await passedOver(env, passed, anchor, now);
  } catch (e) {
    if (held.length === 1) await release(env, held[0].id, held[0].before, now).catch(() => undefined);
    else if (held.length) await releaseAll(env, held, now, dataDate).catch(() => undefined);
    throw e;
  } finally {
    // From the briefing in hand on (a wait, a stop or a fault), those due whose plan would send them; an account taken
    // up whole counts its own that it has not dealt with.
    if (o.tally) {
      o.tally.left += unfinished(due, i, (r) => !handled.has(r.id) && dueOn(r) && likelyServed(o.plans, r.user_id, r.plan, "delivery"));
    }
  }
  return { report, stop, capped };
}

export const BRIEFING_WAIT_WHY: Record<BriefingWait, string> = {
  absent: "the records database is not bound",
  loading: "the records database is loading",
  failed: "the records database could not be read",
  stale: "the records database is not at today's data date",
  no_table: "the accounts database has no briefings table (apply accounts_schema.sql)",
};

export const briefingActive = (r: BriefingReport) => r.sent + r.failed + r.empty + r.skipped + r.waiting > 0 || r.records !== null;

export const briefingCounts = (r: BriefingReport) =>
  `briefings: ${r.sent} sent${r.groups ? ` (${r.groups} of them grouped, carrying ${r.grouped} briefings)` : ""}, ${r.failed} failed, ` +
  `${r.empty} with nothing new, ${r.skipped} not on a plan with delivery` +
  (r.records ? `, ${r.waiting} waiting: ${BRIEFING_WAIT_WHY[r.records]}` : "");

// -- the console --------------------------------------------------------------------------------

export type BriefingOverview = {
  byKind: { kind: string; deliver: string; n: number }[]; week: { status: string; n: number }[];
};

// Briefings by kind and delivery, and the runs of the last seven days by how
// they ended; null before the tables exist.
export async function briefingOverview(env: Env, now = new Date()): Promise<BriefingOverview | null> {
  const db = env.ACCOUNTS!;
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  try {
    const [kinds, runs] = await db.batch([
      db.prepare("SELECT kind, deliver, COUNT(*) AS n FROM briefings GROUP BY kind, deliver ORDER BY kind, deliver LIMIT 4"),
      db.prepare("SELECT status, COUNT(*) AS n FROM briefing_deliveries WHERE sent_at >= ? GROUP BY status ORDER BY status LIMIT 3").bind(week),
    ]);
    return {
      byKind: (kinds.results ?? []) as { kind: string; deliver: string; n: number }[],
      week: (runs.results ?? []) as { status: string; n: number }[],
    };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// One account's briefings, each with its newest run, and the account's last
// BRIEFING_DELIVERY_ROWS runs, for the console's user page; null before the tables exist.
export async function userBriefings(
  env: Env, userId: string,
): Promise<{ briefings: (Briefing & { last: BriefingRun | null })[]; runs: (BriefingRun & { label: string })[] } | null> {
  try {
    const [list, last, runs] = await Promise.all([
      listBriefings(env, userId), lastBriefingRuns(env, userId),
      env.ACCOUNTS!.prepare(
        "SELECT d.sent_at, d.day, d.items, d.status, b.label FROM briefing_deliveries d JOIN briefings b ON b.id = d.briefing_id " +
        "WHERE b.user_id = ? ORDER BY d.id DESC LIMIT ?",
      ).bind(userId, BRIEFING_DELIVERY_ROWS).all<BriefingRun & { label: string }>(),
    ]);
    if (list === null) return null;
    return { briefings: list.map((b) => ({ ...b, last: last.get(b.id) ?? null })), runs: runs.results ?? [] };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}
