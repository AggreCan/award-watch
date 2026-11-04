// The records database: the statements behind the analytics views, over the
// D1 database the nightly sync fills (binding RECORDS, schema in
// pipeline/records_schema.sql, written by
// pipeline/awardwatch_pipeline/records_db.py; docs/analytics.md).
//
// Every statement is a constant in this file, prepared with ?N placeholders;
// the request reaches D1 only as bound values, and only values the pages have
// already checked: a buyer id that is a buyer id, an organization number read
// from an organization id, a segment that is one of the 57, a source from the
// list, fiscal years from the data date. There is no text to search and no
// column or order chosen by the request.
//
// Every statement is bounded: at most MAX_YEARS fiscal years of one buyer,
// one organization or one segment, through the index on that column
// (records_buyer, records_org, records_segment, or the summary tables' own),
// and every list ends in a LIMIT. A view sends one batch: the state row and
// its charts' statements, so a page is one round trip and a free view reads
// one statement beside the state.

import { SEGMENT_CODES, type MoneySource } from "./constants";
import type { Env } from "./env";
import { ORG_ID_RE } from "./data";
import { faultSummary } from "./search_db";

// records.src; records_db.SOURCES in the pipeline holds the same numbers
// (pipeline/tests/test_records_db.py compares the two).
export const SOURCE_NUMBER: Readonly<Record<MoneySource, number>> = { awards: 1, history: 2, contracts: 3, grants: 4 };
// The sources that carry UNSPSC codes, and so a segment.
export const SEGMENT_SOURCES: readonly MoneySource[] = ["awards", "history"];

// The periods a view offers, in fiscal years ending with the data date's.
export const PERIODS = [3, 5, 10] as const;
export type Period = (typeof PERIODS)[number];
export const MAX_YEARS = 10;
// What a reader without the paid feature sees of the first chart.
export const FREE_YEARS = 3;
// The top lists; the share chart's organizations (the profile's and up to
// MAX_RIVALS chosen from the segment's RIVALS_N largest).
export const TOP_N = 10;
export const RIVALS_N = 25;
export const MAX_RIVALS = 5;
export const SHARE_SLOTS = MAX_RIVALS + 1;
// A new entrant has no record in the segment in this many fiscal years before
// the one it is new in, so the statement reads MAX_YEARS years whatever the
// period shown.
export const ENTRANT_LOOKBACK = MAX_YEARS - 1;

// -- fiscal years and numbers -----------------------------------------------------

// The federal fiscal year (April to March) a date falls in, named by the
// calendar year it starts in: 2026-03-31 is 2025 (2025-26).
export function fiscalYearOf(day: string): number {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  return month >= 4 ? year : year - 1;
}

// "2025-26" in English, "2025-2026" in French, the forms the government's
// own pages use.
export function fiscalLabel(lang: "en" | "fr", fy: number): string {
  return lang === "fr" ? `${fy}-${fy + 1}` : `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
}

// An organization's number in the records database: its id's ten hex digits,
// at most 2^40, which a JavaScript number holds exactly.
export function orgNumber(id: string): number | null {
  return ORG_ID_RE.test(id) ? parseInt(id.slice(4), 16) : null;
}

export function orgIdOf(n: number): string {
  return `org-${n.toString(16).padStart(10, "0")}`;
}

export const segmentNumber = (code: string): number | null => (SEGMENT_CODES.includes(code) ? Number(code) : null);
export const segmentCode = (n: number): string => String(n).padStart(2, "0");

// -- the statements ------------------------------------------------------------------

export const STATE_SQL = "SELECT key, value FROM rec_meta WHERE key IN ('state', 'as_of', 'rules') LIMIT 3";

// ?1 the buyer id, ?2 the source, ?3 and ?4 the first and last fiscal years.
const BUYER = "bid = (SELECT bid FROM rec_buyers WHERE id = ?1) AND src = ?2 AND fy BETWEEN ?3 AND ?4";

// The buyer view's first chart and its free view: the summary table, at most
// four quarters of ten years.
export const BUYER_QUARTERS_SQL =
  `SELECT fy, fq, n, cents, n_no_value FROM rec_buyer_quarters WHERE ${BUYER} ORDER BY fy, fq LIMIT 40`;

// Value by segment: every row of the buyer's notices, so a notice in two
// segments counts in each, as on the segment pages.
export const BUYER_SEGMENTS_SQL =
  `SELECT sid, COUNT(*) AS n, SUM(cents) AS cents FROM records WHERE ${BUYER} AND sid IS NOT NULL ` +
  `GROUP BY sid ORDER BY cents DESC, n DESC, sid LIMIT ${TOP_N}`;

// The non-competitive share by fiscal year, by count and by value; the value
// share over positive values alone, as the profiles take it.
export const BUYER_COMPETITION_SQL =
  "SELECT fy, COUNT(*) AS n, SUM(CASE WHEN comp = 0 THEN 1 ELSE 0 END) AS n_nc, SUM(CASE WHEN comp IS NULL THEN 1 ELSE 0 END) AS n_unstated, " +
  "SUM(CASE WHEN cents > 0 THEN cents END) AS pos, SUM(CASE WHEN comp = 0 AND cents > 0 THEN cents END) AS pos_nc " +
  `FROM records WHERE ${BUYER} AND extra = 0 GROUP BY fy ORDER BY fy LIMIT ${MAX_YEARS}`;

// The organizations with the largest values, and how many organizations the
// buyer paid in the period (the window count runs over the groups before the
// limit).
export const BUYER_SUPPLIERS_SQL =
  "SELECT r.oid AS oid, o.name AS name, r.n AS n, r.cents AS cents, r.n_orgs AS n_orgs FROM (" +
  "SELECT oid, COUNT(*) AS n, SUM(cents) AS cents, COUNT(*) OVER () AS n_orgs FROM records " +
  `WHERE ${BUYER} AND extra = 0 AND oid IS NOT NULL GROUP BY oid ORDER BY cents DESC, n DESC, oid LIMIT ${TOP_N}` +
  `) r LEFT JOIN rec_orgs o ON o.oid = r.oid ORDER BY r.cents DESC, r.n DESC, r.oid LIMIT ${TOP_N}`;

// ?1 the organization's number, ?2 the source, ?3 and ?4 the fiscal years.
const ORG = "oid = ?1 AND src = ?2 AND fy BETWEEN ?3 AND ?4";

export const ORG_YEARS_SQL =
  "SELECT fy, COUNT(*) AS n, SUM(cents) AS cents, SUM(CASE WHEN vnote = 1 THEN 1 ELSE 0 END) AS n_no_value, " +
  "SUM(CASE WHEN comp = 0 THEN 1 ELSE 0 END) AS n_nc " +
  `FROM records WHERE ${ORG} AND extra = 0 GROUP BY fy ORDER BY fy LIMIT ${MAX_YEARS}`;

export const ORG_BUYERS_SQL =
  "SELECT b.id AS id, b.name_en AS name_en, b.name_fr AS name_fr, r.n AS n, r.cents AS cents, r.n_buyers AS n_buyers FROM (" +
  "SELECT bid, COUNT(*) AS n, SUM(cents) AS cents, COUNT(*) OVER () AS n_buyers FROM records " +
  `WHERE ${ORG} AND extra = 0 AND bid IS NOT NULL GROUP BY bid ORDER BY cents DESC, n DESC, bid LIMIT ${TOP_N}` +
  `) r JOIN rec_buyers b ON b.bid = r.bid ORDER BY r.cents DESC, r.n DESC, b.id LIMIT ${TOP_N}`;

export const ORG_SEGMENTS_SQL =
  `SELECT sid, COUNT(*) AS n, SUM(cents) AS cents FROM records WHERE ${ORG} AND sid IS NOT NULL ` +
  `GROUP BY sid ORDER BY cents DESC, n DESC, sid LIMIT ${TOP_N}`;

// ?1 the segment, ?2 the source, ?3 and ?4 the fiscal years.
const SEGMENT = "sid = ?1 AND src = ?2 AND fy BETWEEN ?3 AND ?4";

// The share chart: each fiscal year's segment total from the summary table,
// beside the values of up to SHARE_SLOTS organizations: ?5 the profile's, ?6
// to ?10 the ones the reader chose (an unused slot is bound to -1, which no
// organization's number is), and, when the reader chose none, the segment's
// ?11 largest others (?11 is 0 otherwise), so the default comparison costs no
// second round trip. Ten years of six organizations, plus a row for a year
// none of them has, is at most MAX_YEARS * SHARE_SLOTS rows.
const SLOTS = Array.from({ length: SHARE_SLOTS }, (_, i) => `?${i + 5}`).join(", ");
export const ORG_SHARE_SQL =
  "SELECT y.fy AS fy, y.n AS seg_n, y.cents AS seg_cents, r.oid AS oid, r.n AS n, r.cents AS cents FROM rec_segment_years y LEFT JOIN (" +
  `SELECT fy, oid, COUNT(*) AS n, SUM(cents) AS cents FROM records WHERE ${SEGMENT} AND (oid IN (${SLOTS}) OR oid IN (` +
  `SELECT oid FROM records WHERE ${SEGMENT} AND oid IS NOT NULL AND oid <> ?5 GROUP BY oid ` +
  "ORDER BY SUM(cents) DESC, COUNT(*) DESC, oid LIMIT ?11)) GROUP BY fy, oid" +
  `) r ON r.fy = y.fy WHERE y.sid = ?1 AND y.src = ?2 AND y.fy BETWEEN ?3 AND ?4 ORDER BY y.fy, r.oid LIMIT ${MAX_YEARS * SHARE_SLOTS}`;

// The segment's organizations with the largest values: the share chart's
// choices on a profile, the winners list on the segment view.
export const SEGMENT_WINNERS_SQL =
  "SELECT r.oid AS oid, o.name AS name, r.n AS n, r.cents AS cents, r.n_orgs AS n_orgs FROM (" +
  "SELECT oid, COUNT(*) AS n, SUM(cents) AS cents, COUNT(*) OVER () AS n_orgs FROM records " +
  `WHERE ${SEGMENT} AND oid IS NOT NULL GROUP BY oid ORDER BY cents DESC, n DESC, oid LIMIT ${RIVALS_N}` +
  `) r LEFT JOIN rec_orgs o ON o.oid = r.oid ORDER BY r.cents DESC, r.n DESC, r.oid LIMIT ${RIVALS_N}`;

// The segment view's first chart and its free view: the summary table.
export const SEGMENT_YEARS_SQL =
  `SELECT fy, n, cents, n_no_value, n_buyers, n_orgs FROM rec_segment_years WHERE ${SEGMENT} ORDER BY fy LIMIT ${MAX_YEARS}`;

export const SEGMENT_BUYERS_SQL =
  "SELECT b.id AS id, b.name_en AS name_en, b.name_fr AS name_fr, r.n AS n, r.cents AS cents, r.n_buyers AS n_buyers FROM (" +
  "SELECT bid, COUNT(*) AS n, SUM(cents) AS cents, COUNT(*) OVER () AS n_buyers FROM records " +
  `WHERE ${SEGMENT} AND bid IS NOT NULL GROUP BY bid ORDER BY cents DESC, n DESC, bid LIMIT ${TOP_N}` +
  `) r JOIN rec_buyers b ON b.bid = r.bid ORDER BY r.cents DESC, r.n DESC, b.id LIMIT ${TOP_N}`;

// The organizations new to the segment in fiscal year ?4: a record that year
// and none in the ENTRANT_LOOKBACK years before it (?3 is ?4 minus that), by
// their value that year; n_new counts them all.
export const SEGMENT_ENTRANTS_SQL =
  "SELECT r.oid AS oid, o.name AS name, r.n AS n, r.cents AS cents, r.n_new AS n_new FROM (" +
  "SELECT oid, SUM(CASE WHEN fy = ?4 THEN 1 ELSE 0 END) AS n, SUM(CASE WHEN fy = ?4 THEN cents END) AS cents, " +
  `COUNT(*) OVER () AS n_new FROM records WHERE ${SEGMENT} AND oid IS NOT NULL GROUP BY oid HAVING MIN(fy) = ?4 ` +
  `ORDER BY cents DESC, n DESC, oid LIMIT ${RIVALS_N}` +
  `) r LEFT JOIN rec_orgs o ON o.oid = r.oid ORDER BY r.cents DESC, r.n DESC, r.oid LIMIT ${RIVALS_N}`;

// Every statement, for the tests that read their plans and their bounds.
export const ALL_SQL: readonly string[] = [
  STATE_SQL, BUYER_QUARTERS_SQL, BUYER_SEGMENTS_SQL, BUYER_COMPETITION_SQL, BUYER_SUPPLIERS_SQL, ORG_YEARS_SQL, ORG_BUYERS_SQL,
  ORG_SEGMENTS_SQL, ORG_SHARE_SQL, SEGMENT_WINNERS_SQL, SEGMENT_YEARS_SQL, SEGMENT_BUYERS_SQL, SEGMENT_ENTRANTS_SQL,
];

// -- reading -----------------------------------------------------------------------

export interface Query { sql: string; params: (string | number)[] }

export type Row = Record<string, unknown>;

// "absent": no binding; "loading": a full reload is under way or the first
// load never finished; "failed": a statement failed (no table, an outage).
// The page answers each the same way, with what the reader can do.
export type Read =
  | { state: "ready"; asOf: string | null; rows: Row[][] }
  | { state: "absent" | "loading" | "failed" };

// The state row and the statements in one batch, so a view is one round trip
// to D1. Nothing here throws.
export async function readRecords(env: Env, queries: readonly Query[]): Promise<Read> {
  const db = env.RECORDS;
  if (!db) return { state: "absent" };
  let results: D1Result<Row>[];
  try {
    results = await db.batch<Row>([db.prepare(STATE_SQL), ...queries.map((q) => db.prepare(q.sql).bind(...q.params))]);
  } catch (e) {
    console.error(`records: query failed (${faultSummary(e)})`);
    return { state: "failed" };
  }
  const meta = new Map((results[0]?.results ?? []).map((r) => [String(r.key), String(r.value)]));
  if (meta.get("state") !== "ready") return { state: "loading" };
  const asOf = meta.get("as_of") ?? null;
  return { state: "ready", asOf: asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null, rows: results.slice(1).map((r) => r.results ?? []) };
}

// A number D1 returned, or null: an aggregate over no row is NULL.
export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export const dollars = (cents: unknown): number | null => {
  const c = num(cents);
  return c === null ? null : c / 100;
};
