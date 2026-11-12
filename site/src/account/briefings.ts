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
// The delivery job's last step (deliveries.ts runDeliveries calls
// runBriefings after the watch mail, inside the same cap of RUN_MESSAGES_MAX
// messages): each briefing with delivery weekly, an active account whose plan
// allows delivery and that is not blocked, not covered since this week's
// weekday (BRIEFING_WEEKDAY, Monday), and no message refused for it since
// then. Claimed for the week before its message goes and given back when the
// send does not go, as a saved search is. Until the records database is ready
// at today's data date, every briefing waits unclaimed.
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
import { STOP_CODES, sendWithHeaders } from "./deliveries";
import { type DigestMessage, briefingDigest, siteLink } from "./digests";
import { allowed, planFor, savedSearchCap, SAVED_SEARCH_MAX, type Plan } from "./entitlements";
import { type RecordsWait, missingTable } from "./records_deliveries";
import { newId, randomHex } from "./secrets";
import { EVENT_NOTABLE_CENTS, EVENT_NOTABLE_SHARE } from "./watch_events";

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
// The data dates a message covers: the seven ending with the data date; after
// a message that failed, back to the last one covered, at most two weeks.
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

// The day the message's span starts after (exclusive): seven data dates back,
// or the last one covered when that is further (a message that failed), at
// most SPAN_DAYS_MAX back.
export function briefingStart(lastDelivered: string | null, dataDate: string): string {
  const week = addDays(dataDate, -WEEK_DAYS);
  if (!lastDelivered) return week;
  const prev = lastDelivered.slice(0, 10);
  const floor = addDays(dataDate, -SPAN_DAYS_MAX);
  return prev >= week ? week : prev > floor ? prev : floor;
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
// is subscribed already.
export async function addBriefing(
  env: Env, who: { userId: string; plan: Plan }, b: BriefingSubject & { label: string }, lang: Lang, now = new Date(),
): Promise<"added" | "exists" | "cap"> {
  const db = env.ACCOUNTS!;
  const res = await db.prepare(
    "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) " +
    "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?2) + " +
    "(SELECT COUNT(*) FROM briefings WHERE user_id = ?2) < ?10 ON CONFLICT (user_id, kind, subject, segment) DO NOTHING",
  ).bind(newId(), who.userId, b.kind, b.subject, b.segment, b.label.slice(0, LABEL_MAX), lang, now.toISOString(),
    allowed(who, "delivery") ? "weekly" : "off", sharedCap(who.plan)).run();
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
// the account holds; null before the table exists.
export async function briefingState(
  env: Env, userId: string, kind: BriefingKind, subject: string,
): Promise<{ id: string | null; segment: string; n: number } | null> {
  try {
    const row = await env.ACCOUNTS!.prepare(
      "SELECT (SELECT id FROM briefings WHERE user_id = ?1 AND kind = ?2 AND subject = ?3 ORDER BY segment, created_at LIMIT 1) AS id, " +
      "(SELECT segment FROM briefings WHERE user_id = ?1 AND kind = ?2 AND subject = ?3 ORDER BY segment, created_at LIMIT 1) AS segment, " +
      "(SELECT COUNT(*) FROM briefings WHERE user_id = ?1) + (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1) AS n",
    ).bind(userId, kind, subject).first<{ id: string | null; segment: string | null; n: number }>();
    return { id: row?.id ?? null, segment: row?.segment ?? "", n: row?.n ?? 0 };
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
  empty: number;
  // Due briefings whose owner's plan does not allow delivery.
  skipped: number;
  // Briefings left for a later run, and why; records is null when none waited.
  waiting: number;
  records: BriefingWait | null;
}

export const emptyBriefingReport = (): BriefingReport => ({ sent: 0, failed: 0, empty: 0, skipped: 0, waiting: 0, records: null });

// The briefings that can be due this week, oldest first (?1 the week's
// weekday on or before the data date, ?2 the cap): delivery weekly, an active
// account that is not blocked, not covered since ?1, and no message refused
// for it since then (it waits for next week, whose message covers both).
// n_before counts the account's saved searches and briefings made before it
// (madeBefore above): past the plan's figure, after a move to a smaller plan,
// only the first ones by creation date are sent.
export const BRIEFINGS_DUE_SQL =
  "SELECT b.id, b.user_id, b.kind, b.subject, b.segment, b.label, b.lang, b.deliver, b.last_delivered_at, b.secret, u.email, u.plan, u.plan_until, " +
  `${madeBefore("b", "saved_searches")} + ${madeBefore("b", "briefings")} AS n_before ` +
  "FROM briefings b JOIN users u ON u.id = b.user_id WHERE b.deliver = 'weekly' AND u.status = 'active' " +
  "AND (b.last_delivered_at IS NULL OR substr(b.last_delivered_at, 1, 10) < ?1) " +
  "AND NOT EXISTS (SELECT 1 FROM briefing_deliveries d WHERE d.briefing_id = b.id AND d.status = 'failed' AND d.sent_at >= ?1) " +
  "AND NOT EXISTS (SELECT 1 FROM account_blocks x WHERE x.user_id = b.user_id) ORDER BY b.created_at, b.id LIMIT ?2";

type DueRow = BriefingRow & { user_id: string; secret: string | null; email: string; plan: string; plan_until: string | null; n_before: number };

// The briefing taken for the week by this run: one statement that holds only
// while no run has covered it since the week's weekday.
async function claim(env: Env, id: string, anchor: string, now: Date): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE briefings SET last_delivered_at = ?1 WHERE id = ?2 AND deliver = 'weekly' AND (last_delivered_at IS NULL OR substr(last_delivered_at, 1, 10) < ?3)",
  ).bind(now.toISOString(), id, anchor).run();
  return (res.meta?.changes ?? 0) === 1;
}

// The claim given back, while it is this run's.
async function release(env: Env, id: string, before: string | null, now: Date): Promise<void> {
  await env.ACCOUNTS!.prepare("UPDATE briefings SET last_delivered_at = ?1 WHERE id = ?2 AND last_delivered_at = ?3")
    .bind(before, id, now.toISOString()).run();
}

// One run row, written only while the briefing exists.
async function record(env: Env, id: string, status: "sent" | "failed" | "empty", items: number, now: Date, dataDate: string): Promise<void> {
  await env.ACCOUNTS!.prepare(
    "INSERT INTO briefing_deliveries (briefing_id, sent_at, day, items, status) SELECT ?1, ?2, ?3, ?4, ?5 " +
    "WHERE EXISTS (SELECT 1 FROM briefings WHERE id = ?1)",
  ).bind(id, now.toISOString(), dataDate, items, status).run();
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

// room: the messages the run may still send (the cap less what the saved
// searches and the watch mail sent). stop: why the run stopped early.
export async function runBriefings(
  env: Env, o: { site: string; dataDate: string; now: Date; plans: Map<string, Plan>; room: number; capText: string },
): Promise<{ report: BriefingReport; stop: string | null; capped: boolean }> {
  const { site, dataDate, now } = o;
  const report = emptyBriefingReport();
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
  let held: { id: string; before: string | null } | null = null;
  try {
    for (const row of due) {
      const b = toBriefing(row);
      if (!b || !briefingDue(b.deliver, b.last_delivered_at, dataDate)) continue;
      let plan = o.plans.get(row.user_id);
      if (!plan) {
        plan = (await planFor(env, { id: row.user_id, plan: row.plan, plan_until: row.plan_until }, now)).plan;
        o.plans.set(row.user_id, plan);
      }
      if (!allowed({ plan }, "delivery") || (row.n_before ?? 0) >= sharedCap(plan)) {
        report.skipped++;
        continue;
      }
      const start = briefingStart(b.last_delivered_at, dataDate);
      const key = `${b.kind}\n${b.subject}\n${b.segment}\n${start}`;
      let read = reads.get(key);
      if (!read) {
        read = await readBriefing(env, b, dataDate, start);
        reads.set(key, read);
      }
      if (read.state !== "ready" || read.data.asOf !== dataDate) {
        report.records = read.state === "ready" ? "stale" : read.state;
        report.waiting += due.length - due.indexOf(row);
        break;
      }
      const data = read.data;
      if (!hasNews(data)) {
        if (!(await claim(env, b.id, anchor, now))) continue;
        held = { id: b.id, before: b.last_delivered_at };
        await record(env, b.id, "empty", 0, now, dataDate);
        held = null;
        report.empty++;
        continue;
      }
      if (report.sent + report.failed >= o.room) {
        stop = o.capText;
        capped = true;
        break;
      }
      if (!(await claim(env, b.id, anchor, now))) continue;
      held = { id: b.id, before: b.last_delivered_at };
      const secret = row.secret ?? (await stopSecret(env, b.id));
      if (!secret) {
        await release(env, b.id, b.last_delivered_at, now);
        held = null;
        continue;
      }
      const message: DigestMessage = briefingDigest({
        lang: b.lang, to: row.email, site, stopUrl: siteLink(site, `/account/stop?b=${b.id}&t=${secret}`, b.lang), briefing: b,
        name: b.label, data,
      });
      const items = listedRows(data);
      const result = await sendWithHeaders(env, site, message);
      if (result.sent) {
        held = null;
        await record(env, b.id, "sent", items, now, dataDate);
        report.sent++;
      } else if (result.code && STOP_CODES.has(result.code)) {
        await release(env, b.id, b.last_delivered_at, now);
        held = null;
        stop = result.code;
        break;
      } else {
        await release(env, b.id, b.last_delivered_at, now);
        held = null;
        await record(env, b.id, "failed", items, now, dataDate);
        report.failed++;
      }
    }
  } catch (e) {
    if (held) await release(env, held.id, held.before, now).catch(() => undefined);
    throw e;
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
  `briefings: ${r.sent} sent, ${r.failed} failed, ${r.empty} with nothing new, ${r.skipped} not on a plan with delivery` +
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
