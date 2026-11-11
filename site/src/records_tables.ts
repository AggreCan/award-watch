// The records backbone's other readers: the page of each published contract,
// and (below) the radar over its whole window, the record tables, the earlier
// awards on a tender, the incumbents and the per-organization feeds. The
// tables are pipeline/records_schema.sql's rec_contracts, rec_gsin,
// rec_contract_indigenous, rec_details, rec_classes and rec_expiring, which the nightly sync fills
// (pipeline/awardwatch_pipeline/records_db.py; docs/analytics.md).
//
// The rules of records_db.ts hold here too: every statement is a constant
// prepared with ?N placeholders and bound only to values the page has
// checked; every one names an index, ends in a LIMIT and reads at most
// MAX_YEARS fiscal years where it reads years at all; readRecords sends the
// state row and the statements in one batch. site/test/records-tables.test.ts
// reads each one's plan.

import type { Env } from "./env";
import { type Query, type Read, type Row, readRecords } from "./records_db";

// -- a published contract (pages/published.tsx) --------------------------------------

// How many other rows of the same contract (its amendments: the rows sharing
// the department and procurement_id) the page lists.
export const CONTRACT_VERSIONS_MAX = 50;

const CONTRACT_COLUMNS =
  "c.dept AS dept, c.ref AS ref, c.pid AS pid, c.wh AS wh, c.oid AS oid, c.cdate AS cdate, c.start AS start, c.endd AS endd, " +
  "c.value AS value, c.orig AS orig, c.amend AS amend, c.proc AS proc, c.comp AS comp, c.ctype AS ctype, c.gsin AS gsin, " +
  "c.agr AS agr, c.trade AS trade, c.ltr AS ltr, c.inst AS inst, c.period AS period, c.bids AS bids, c.so_no AS so_no, " +
  "c.desc_en AS desc_en, c.desc_fr AS desc_fr, c.com_en AS com_en, c.com_fr AS com_fr, b.id AS buyer_id, b.name_en AS buyer_en, " +
  "b.name_fr AS buyer_fr, o.name AS org_name, r.cents AS counted, r.vnote AS vnote, g.desc_en AS gsin_en, g.desc_fr AS gsin_fr";
const CONTRACT_JOINS =
  "LEFT JOIN rec_buyers b ON b.bid = c.bid LEFT JOIN rec_orgs o ON o.oid = c.oid LEFT JOIN records r ON r.k = c.k " +
  "LEFT JOIN rec_gsin g ON g.code = c.gsin";

// ?1 the department (owner_org), ?2 the reference as published: the row
// itself (self = 1) through the unique index on both, then up to
// CONTRACT_VERSIONS_MAX + 1 other rows of its contract through the
// department and procurement_id, oldest first (one more than the page lists,
// so it knows when there are more). A row without a procurement_id stands
// alone, as on the radar.
export const PUBLISHED_CONTRACT_SQL =
  `SELECT * FROM (SELECT 1 AS self, ${CONTRACT_COLUMNS} FROM rec_contracts c ${CONTRACT_JOINS} WHERE c.dept = ?1 AND c.ref = ?2 LIMIT 1) ` +
  `UNION ALL SELECT * FROM (SELECT 0 AS self, ${CONTRACT_COLUMNS} FROM rec_contracts c ${CONTRACT_JOINS} ` +
  "WHERE c.dept = ?1 AND c.pid IS NOT NULL AND c.pid = (SELECT pid FROM rec_contracts WHERE dept = ?1 AND ref = ?2) AND c.ref <> ?2 " +
  `ORDER BY c.cdate, c.ref LIMIT ${CONTRACT_VERSIONS_MAX + 1}) ORDER BY self DESC, cdate, ref LIMIT ${CONTRACT_VERSIONS_MAX + 2}`;

// The row's two Indigenous business fields (rec_contract_indigenous, keyed as
// its rec_contracts row): ?1 the department, ?2 the reference, through the
// unique index on both and the table's key. A row only where the department
// reported a set-aside under the Procurement Strategy for Indigenous
// Business (psib MS or VS) or an Indigenous business outside one (ib 1).
export const PUBLISHED_INDIGENOUS_SQL =
  "SELECT i.psib AS psib, i.ib AS ib FROM rec_contracts c JOIN rec_contract_indigenous i ON i.k = c.k WHERE c.dept = ?1 AND c.ref = ?2 LIMIT 1";

// One batch: the state row, the contract's rows and its Indigenous business
// fields (rows[1]). A records database the nightly has not given
// rec_contract_indigenous yet is read again without it, and the page shows
// the contract without the two fields.
export async function readPublishedContract(env: Env, dept: string, ref: string): Promise<Read> {
  const contract: Query = { sql: PUBLISHED_CONTRACT_SQL, params: [dept, ref] };
  const read = await readRecords(env, [contract, { sql: PUBLISHED_INDIGENOUS_SQL, params: [dept, ref] }]);
  if (read.state !== "failed" || !read.noTable) return read;
  return readRecords(env, [contract]);
}

// -- the radar over its whole window (pages/expiring.tsx) -------------------------------

// A filtered or sorted window reads rec_expiring, the 12-month window as the
// static export wrote it, through rec_expiring_end: the window's first and
// last end dates bound every statement, so none reads more than the 12-month
// window's rows (about 20,000).
export const RADAR_PAGE_ROWS = 100;
export const RADAR_CSV_MAX = 10_000;
export const RADAR_OPTIONS_MAX = 200;

// ?1 ?2 the window's first and last end dates; ?3 the buyer id or ''; ?4 the
// client department's buyer id or ''; ?5 the organization's number or -1;
// ?6 a segment between spaces (' 43 ') or ''; ?7 -1 any, 1 competitive, 0
// non-competitive, 2 not stated; ?8 and ?9 the value band in cents, lower
// bound included (?8 = -1: no band; no band starts there); ?10 the kind (records.src: 1 award notice,
// 2 history, 3 published contract) or 0; ?11 0 to leave out the March 31
// ends; ?12 0 to leave out standing offers and supply arrangements.
const RADAR_WHERE =
  "endd BETWEEN ?1 AND ?2 AND (?3 = '' OR buyer = ?3) AND (?4 = '' OR client = ?4) AND (?5 = -1 OR oid = ?5) " +
  "AND (?6 = '' OR instr(segs, ?6) > 0) AND (?7 = -1 OR (?7 = 2 AND comp IS NULL) OR comp = ?7) " +
  "AND (?8 = -1 OR (cad >= ?8 AND cad < ?9)) AND (?10 = 0 OR kind = ?10) AND (?11 = 1 OR m31 = 0) AND (?12 = 1 OR so = 0)";
// Soonest end first, the source's order and the key breaking ties; or the
// largest value first, the rows without a Canadian value last. Each the
// other way round too (a head of the radar's table asks for either), the
// rows without a value still last.
const BY_END = "ORDER BY endd, kind, k";
const BY_END_DESC = "ORDER BY endd DESC, kind, k";
const BY_VALUE = "ORDER BY cad IS NULL, cad DESC, endd, k";
const BY_VALUE_ASC = "ORDER BY cad IS NULL, cad, endd, k";

// A page of the matches: ?13 the offset (a multiple of RADAR_PAGE_ROWS).
export const RADAR_ROWS_END_SQL = `SELECT endd, j FROM rec_expiring WHERE ${RADAR_WHERE} ${BY_END} LIMIT ${RADAR_PAGE_ROWS} OFFSET ?13`;
export const RADAR_ROWS_END_DESC_SQL = `SELECT endd, j FROM rec_expiring WHERE ${RADAR_WHERE} ${BY_END_DESC} LIMIT ${RADAR_PAGE_ROWS} OFFSET ?13`;
export const RADAR_ROWS_VALUE_SQL = `SELECT endd, j FROM rec_expiring WHERE ${RADAR_WHERE} ${BY_VALUE} LIMIT ${RADAR_PAGE_ROWS} OFFSET ?13`;
export const RADAR_ROWS_VALUE_ASC_SQL = `SELECT endd, j FROM rec_expiring WHERE ${RADAR_WHERE} ${BY_VALUE_ASC} LIMIT ${RADAR_PAGE_ROWS} OFFSET ?13`;
// The matches as a file, at most RADAR_CSV_MAX of them.
export const RADAR_CSV_END_SQL = `SELECT endd, j FROM rec_expiring WHERE ${RADAR_WHERE} ${BY_END} LIMIT ${RADAR_CSV_MAX}`;
export const RADAR_CSV_END_DESC_SQL = `SELECT endd, j FROM rec_expiring WHERE ${RADAR_WHERE} ${BY_END_DESC} LIMIT ${RADAR_CSV_MAX}`;
export const RADAR_CSV_VALUE_SQL = `SELECT endd, j FROM rec_expiring WHERE ${RADAR_WHERE} ${BY_VALUE} LIMIT ${RADAR_CSV_MAX}`;
export const RADAR_CSV_VALUE_ASC_SQL = `SELECT endd, j FROM rec_expiring WHERE ${RADAR_WHERE} ${BY_VALUE_ASC} LIMIT ${RADAR_CSV_MAX}`;

// Each order's page and file statements; dir, when left out, is the
// order's own: the soonest end, the largest value.
export type RadarSort = "end" | "value";
export type SortDir = "asc" | "desc";
const RADAR_ORDER: Record<RadarSort, Record<SortDir, { rows: string; csv: string }>> = {
  end: { asc: { rows: RADAR_ROWS_END_SQL, csv: RADAR_CSV_END_SQL }, desc: { rows: RADAR_ROWS_END_DESC_SQL, csv: RADAR_CSV_END_DESC_SQL } },
  value: { desc: { rows: RADAR_ROWS_VALUE_SQL, csv: RADAR_CSV_VALUE_SQL }, asc: { rows: RADAR_ROWS_VALUE_ASC_SQL, csv: RADAR_CSV_VALUE_ASC_SQL } },
};
// How many match, what their counted values add up to, and how many have no value.
export const RADAR_TOTAL_SQL = `SELECT COUNT(*) AS n, SUM(cents) AS cents, SUM(nv) AS n_no_value FROM rec_expiring WHERE ${RADAR_WHERE} LIMIT 1`;

// The province filter. rec_expiring_prov holds one row per row of the window
// (k, rec_expiring.k) and province (prov, a two-letter code), derived 0 when
// the source states the province and 1 when the pipeline derived it from
// another field (places.py), indexed on (prov, k). ?13 the province's code;
// ?14 1 to count a derived province too (the tender list's "Include derived
// provinces"), 0 for the stated ones alone. The window's rows join it by key
// through that index, as a set, so a row holding the province both ways is
// one row; every other condition and the LIMIT stay the window's. Only a view
// that names a province reads these statements, so a records database whose
// nightly has not made the table yet answers every other view as before.
const RADAR_PROV_WHERE = `${RADAR_WHERE} AND k IN (SELECT k FROM rec_expiring_prov WHERE prov = ?13 AND derived <= ?14)`;
// ?15 the offset of a page.
const provRows = (order: string) => `SELECT endd, j FROM rec_expiring WHERE ${RADAR_PROV_WHERE} ${order} LIMIT ${RADAR_PAGE_ROWS} OFFSET ?15`;
const provCsv = (order: string) => `SELECT endd, j FROM rec_expiring WHERE ${RADAR_PROV_WHERE} ${order} LIMIT ${RADAR_CSV_MAX}`;
export const RADAR_PROV_ROWS_END_SQL = provRows(BY_END);
export const RADAR_PROV_TOTAL_SQL = `SELECT COUNT(*) AS n, SUM(cents) AS cents, SUM(nv) AS n_no_value FROM rec_expiring WHERE ${RADAR_PROV_WHERE} LIMIT 1`;
const RADAR_PROV_ORDER: Record<RadarSort, Record<SortDir, { rows: string; csv: string }>> = {
  end: { asc: { rows: RADAR_PROV_ROWS_END_SQL, csv: provCsv(BY_END) }, desc: { rows: provRows(BY_END_DESC), csv: provCsv(BY_END_DESC) } },
  value: { desc: { rows: provRows(BY_VALUE), csv: provCsv(BY_VALUE) }, asc: { rows: provRows(BY_VALUE_ASC), csv: provCsv(BY_VALUE_ASC) } },
};
// Every province statement, for the tests that read their plans and their bounds.
export const RADAR_PROV_SQL: readonly string[] = [
  RADAR_PROV_TOTAL_SQL, ...Object.values(RADAR_PROV_ORDER).flatMap((o) => Object.values(o).flatMap((s) => [s.rows, s.csv])),
];

const radarOrder = (sort: RadarSort, dir?: SortDir, prov = false) =>
  (prov ? RADAR_PROV_ORDER : RADAR_ORDER)[sort][dir ?? (sort === "value" ? "desc" : "asc")];

// The window's own counts for the form's choices (?1 ?2 the window), the
// filters set aside: by competitive flag, source, value band (the bands of
// pages/expiring.tsx in cents) and the two marks.
export const RADAR_FACETS_SQL =
  "SELECT COUNT(*) AS n, SUM(comp = 1) AS c1, SUM(comp = 0) AS c0, SUM(comp IS NULL) AS c2, SUM(kind = 1) AS k1, SUM(kind = 2) AS k2, " +
  "SUM(kind = 3) AS k3, SUM(cad < 10000000) AS b1, SUM(cad >= 10000000 AND cad < 100000000) AS b2, " +
  "SUM(cad >= 100000000 AND cad < 1000000000) AS b3, SUM(cad >= 1000000000) AS b4, SUM(m31) AS m31, SUM(so) AS so " +
  "FROM rec_expiring WHERE endd BETWEEN ?1 AND ?2 LIMIT 1";
// The buyers, client departments and organizations the window names, the
// most rows first, with their names, at most RADAR_OPTIONS_MAX of each.
export const RADAR_BUYERS_SQL =
  "SELECT e.id AS id, b.name_en AS name_en, b.name_fr AS name_fr, e.n AS n FROM (SELECT buyer AS id, COUNT(*) AS n FROM rec_expiring " +
  `WHERE endd BETWEEN ?1 AND ?2 AND buyer IS NOT NULL GROUP BY buyer ORDER BY n DESC, buyer LIMIT ${RADAR_OPTIONS_MAX}) e ` +
  `LEFT JOIN rec_buyers b ON b.id = e.id ORDER BY e.n DESC, e.id LIMIT ${RADAR_OPTIONS_MAX}`;
export const RADAR_CLIENTS_SQL =
  "SELECT e.id AS id, b.name_en AS name_en, b.name_fr AS name_fr, e.n AS n FROM (SELECT client AS id, COUNT(*) AS n FROM rec_expiring " +
  `WHERE endd BETWEEN ?1 AND ?2 AND client IS NOT NULL GROUP BY client ORDER BY n DESC, client LIMIT ${RADAR_OPTIONS_MAX}) e ` +
  `LEFT JOIN rec_buyers b ON b.id = e.id ORDER BY e.n DESC, e.id LIMIT ${RADAR_OPTIONS_MAX}`;
export const RADAR_SUPPLIERS_SQL =
  "SELECT e.oid AS oid, o.name AS name, e.n AS n FROM (SELECT oid, COUNT(*) AS n, SUM(cents) AS cents FROM rec_expiring " +
  `WHERE endd BETWEEN ?1 AND ?2 AND oid IS NOT NULL GROUP BY oid ORDER BY cents DESC, n DESC, oid LIMIT ${RADAR_OPTIONS_MAX}) e ` +
  `LEFT JOIN rec_orgs o ON o.oid = e.oid ORDER BY e.cents DESC, e.n DESC, e.oid LIMIT ${RADAR_OPTIONS_MAX}`;

// prov: a province's code, or '' (or absent) for none; derived: whether a
// province derived from another field counts, as on the tender list.
export interface RadarParams {
  first: string; last: string; buyer: string; client: string; oid: number; segment: string; comp: number;
  band: [number, number] | null; kind: number; fye: boolean; sosa: boolean; prov?: string; derived?: boolean;
}

export function radarBinds(p: RadarParams): (string | number)[] {
  return [p.first, p.last, p.buyer, p.client, p.oid, p.segment ? ` ${p.segment} ` : "", p.comp, p.band ? p.band[0] : -1,
    p.band ? p.band[1] : -1, p.kind, p.fye ? 1 : 0, p.sosa ? 1 : 0];
}

// The binds of the province statements: the window's, then ?13 and ?14.
export function radarProvBinds(p: RadarParams): (string | number)[] {
  return [...radarBinds(p), p.prov ?? "", p.derived === false ? 0 : 1];
}

// A read of the window; noProvinces when the view named a province and the
// records database does not hold rec_expiring_prov yet, so the read was made
// again without it (the province set aside, as a missing table elsewhere
// degrades to the page without what it holds).
export type RadarRead = Read & { noProvinces?: true };

async function withoutMissingProvinces(env: Env, p: RadarParams, queries: (prov: boolean) => Query[]): Promise<RadarRead> {
  const prov = !!p.prov;
  const read = await readRecords(env, queries(prov));
  if (!prov || read.state !== "failed" || !read.noTable) return read;
  return { ...(await readRecords(env, queries(false))), noProvinces: true };
}

// One batch: the state row, the page of matches, their count and total, and the form's choices.
export function readRadar(env: Env, p: RadarParams, sort: RadarSort, offset: number, dir?: SortDir): Promise<RadarRead> {
  const span = [p.first, p.last];
  return withoutMissingProvinces(env, p, (prov) => {
    const binds = prov ? radarProvBinds(p) : radarBinds(p);
    return [
      { sql: radarOrder(sort, dir, prov).rows, params: [...binds, offset] },
      { sql: prov ? RADAR_PROV_TOTAL_SQL : RADAR_TOTAL_SQL, params: binds },
      { sql: RADAR_FACETS_SQL, params: span },
      { sql: RADAR_BUYERS_SQL, params: span },
      { sql: RADAR_CLIENTS_SQL, params: span },
      { sql: RADAR_SUPPLIERS_SQL, params: span },
    ];
  });
}

export function readRadarCsv(env: Env, p: RadarParams, sort: RadarSort, dir?: SortDir): Promise<RadarRead> {
  return withoutMissingProvinces(env, p, (prov) => [{ sql: radarOrder(sort, dir, prov).csv, params: prov ? radarProvBinds(p) : radarBinds(p) }]);
}

// -- the record tables of a profile and a buyer (pages/records.tsx) --------------------

// rec_details through rec_details_org (oid, day) or rec_details_buyer (bid,
// day): every statement is held to a span of days within MAX_YEARS fiscal
// years (?2 and ?3), so the newest first page reads its own rows through the
// index and a count reads at most ten years of one party's records.
export const RECORDS_PAGE_ROWS = 50;
export const RECORDS_CSV_MAX = 10_000;
export const RECORDS_PARTIES_MAX = 100;

const DETAIL_COLUMNS =
  "d.src AS src, d.day AS day, d.cents AS cents, d.vnote AS vnote, d.comp AS comp, d.meth AS meth, d.ref AS ref, d.title_en AS title_en, " +
  "d.title_fr AS title_fr, d.oid AS oid, b.id AS buyer_id, b.name_en AS buyer_en, b.name_fr AS buyer_fr, o.name AS org_name";
const DETAIL_JOINS = "LEFT JOIN rec_buyers b ON b.bid = d.bid LEFT JOIN rec_orgs o ON o.oid = d.oid";
const NEWEST = "ORDER BY d.day DESC, d.k";
const LARGEST = "ORDER BY d.cents IS NULL, d.cents DESC, d.day DESC, d.k";
// The other way round, for the table's heads: the oldest first, the smallest
// value first (the records without a value still last).
const OLDEST = "ORDER BY d.day, d.k";
const SMALLEST = "ORDER BY d.cents IS NULL, d.cents, d.day DESC, d.k";

// ?1 the organization's number; ?2 and ?3 the first and last day; ?4 the
// source's number or 0; ?5 the method's code or ''; ?6 a buyer's id or ''.
const ORG_WHERE =
  "d.oid = ?1 AND d.day BETWEEN ?2 AND ?3 AND (?4 = 0 OR d.src = ?4) AND (?5 = '' OR d.meth = ?5) " +
  "AND (?6 = '' OR d.bid = (SELECT bid FROM rec_buyers WHERE id = ?6))";
// ?1 the buyer's id; the same then, ?6 an organization's number or -1.
const BUYER_WHERE =
  "d.bid = (SELECT bid FROM rec_buyers WHERE id = ?1) AND d.day BETWEEN ?2 AND ?3 AND (?4 = 0 OR d.src = ?4) AND (?5 = '' OR d.meth = ?5) " +
  "AND (?6 = -1 OR d.oid = ?6)";

// A page of records (?7 the offset), the file, and the count and total.
export const ORG_RECORDS_NEWEST_SQL = `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE ${ORG_WHERE} ${NEWEST} LIMIT ${RECORDS_PAGE_ROWS} OFFSET ?7`;
export const ORG_RECORDS_LARGEST_SQL = `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE ${ORG_WHERE} ${LARGEST} LIMIT ${RECORDS_PAGE_ROWS} OFFSET ?7`;
export const ORG_RECORDS_CSV_NEWEST_SQL = `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE ${ORG_WHERE} ${NEWEST} LIMIT ${RECORDS_CSV_MAX}`;
export const ORG_RECORDS_CSV_LARGEST_SQL = `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE ${ORG_WHERE} ${LARGEST} LIMIT ${RECORDS_CSV_MAX}`;
export const ORG_RECORDS_TOTAL_SQL = `SELECT COUNT(*) AS n, SUM(d.cents) AS cents FROM rec_details d WHERE ${ORG_WHERE} LIMIT 1`;
export const BUYER_RECORDS_NEWEST_SQL = `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE ${BUYER_WHERE} ${NEWEST} LIMIT ${RECORDS_PAGE_ROWS} OFFSET ?7`;
export const BUYER_RECORDS_LARGEST_SQL = `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE ${BUYER_WHERE} ${LARGEST} LIMIT ${RECORDS_PAGE_ROWS} OFFSET ?7`;
export const BUYER_RECORDS_CSV_NEWEST_SQL = `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE ${BUYER_WHERE} ${NEWEST} LIMIT ${RECORDS_CSV_MAX}`;
export const BUYER_RECORDS_CSV_LARGEST_SQL = `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE ${BUYER_WHERE} ${LARGEST} LIMIT ${RECORDS_CSV_MAX}`;
export const BUYER_RECORDS_TOTAL_SQL = `SELECT COUNT(*) AS n, SUM(d.cents) AS cents FROM rec_details d WHERE ${BUYER_WHERE} LIMIT 1`;
const pageSql = (where: string, order: string) =>
  `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE ${where} ${order} LIMIT ${RECORDS_PAGE_ROWS} OFFSET ?7`;
const csvSql = (where: string, order: string) => `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE ${where} ${order} LIMIT ${RECORDS_CSV_MAX}`;

// The other party's choices over the span (?1 to ?3): an organization's
// buyers by records, a buyer's organizations by value.
export const ORG_RECORD_BUYERS_SQL =
  "SELECT b.id AS id, b.name_en AS name_en, b.name_fr AS name_fr, p.n AS n FROM (SELECT d.bid AS bid, COUNT(*) AS n FROM rec_details d " +
  `WHERE d.oid = ?1 AND d.day BETWEEN ?2 AND ?3 AND d.bid IS NOT NULL GROUP BY d.bid ORDER BY n DESC, d.bid LIMIT ${RECORDS_PARTIES_MAX}) p ` +
  `JOIN rec_buyers b ON b.bid = p.bid ORDER BY p.n DESC, b.id LIMIT ${RECORDS_PARTIES_MAX}`;
export const BUYER_RECORD_ORGS_SQL =
  "SELECT p.oid AS oid, o.name AS name, p.n AS n FROM (SELECT d.oid AS oid, COUNT(*) AS n, SUM(d.cents) AS cents FROM rec_details d " +
  "WHERE d.bid = (SELECT bid FROM rec_buyers WHERE id = ?1) AND d.day BETWEEN ?2 AND ?3 AND d.oid IS NOT NULL GROUP BY d.oid " +
  `ORDER BY cents DESC, n DESC, d.oid LIMIT ${RECORDS_PARTIES_MAX}) p LEFT JOIN rec_orgs o ON o.oid = p.oid ` +
  `ORDER BY p.cents DESC, p.n DESC, p.oid LIMIT ${RECORDS_PARTIES_MAX}`;

export type RecordsView = "organization" | "buyer";
// party: on a profile a buyer's id or ''; on a buyer page an organization's number or -1.
export interface RecordsParams { key: string | number; first: string; last: string; src: number; meth: string; party: string | number }

const RECORDS_SQL = {
  organization: {
    newest: ORG_RECORDS_NEWEST_SQL, largest: ORG_RECORDS_LARGEST_SQL, csvNewest: ORG_RECORDS_CSV_NEWEST_SQL,
    csvLargest: ORG_RECORDS_CSV_LARGEST_SQL, total: ORG_RECORDS_TOTAL_SQL, parties: ORG_RECORD_BUYERS_SQL,
    oldest: pageSql(ORG_WHERE, OLDEST), smallest: pageSql(ORG_WHERE, SMALLEST), csvOldest: csvSql(ORG_WHERE, OLDEST),
    csvSmallest: csvSql(ORG_WHERE, SMALLEST),
  },
  buyer: {
    newest: BUYER_RECORDS_NEWEST_SQL, largest: BUYER_RECORDS_LARGEST_SQL, csvNewest: BUYER_RECORDS_CSV_NEWEST_SQL,
    csvLargest: BUYER_RECORDS_CSV_LARGEST_SQL, total: BUYER_RECORDS_TOTAL_SQL, parties: BUYER_RECORD_ORGS_SQL,
    oldest: pageSql(BUYER_WHERE, OLDEST), smallest: pageSql(BUYER_WHERE, SMALLEST), csvOldest: csvSql(BUYER_WHERE, OLDEST),
    csvSmallest: csvSql(BUYER_WHERE, SMALLEST),
  },
} as const;

// The four orders of a record table: by day or by value, each either way.
export type RecordsSort = "newest" | "oldest" | "largest" | "smallest";
const PAGE_KEY = { newest: "newest", oldest: "oldest", largest: "largest", smallest: "smallest" } as const;
const CSV_KEY = { newest: "csvNewest", oldest: "csvOldest", largest: "csvLargest", smallest: "csvSmallest" } as const;

const recordsBinds = (p: RecordsParams): (string | number)[] => [p.key, p.first, p.last, p.src, p.meth, p.party];

// full: the page, its count and total and the party choices in one batch;
// otherwise the first page alone (the free view).
export function readRecordTable(env: Env, view: RecordsView, p: RecordsParams, sort: RecordsSort, offset: number, full: boolean): Promise<Read> {
  const sql = RECORDS_SQL[view];
  const binds = recordsBinds(p);
  const queries: Query[] = [{ sql: sql[PAGE_KEY[sort]], params: [...binds, offset] }];
  if (full) queries.push({ sql: sql.total, params: binds }, { sql: sql.parties, params: [p.key, p.first, p.last] });
  return readRecords(env, queries);
}

export function readRecordCsv(env: Env, view: RecordsView, p: RecordsParams, sort: RecordsSort): Promise<Read> {
  const sql = RECORDS_SQL[view];
  return readRecords(env, [{ sql: sql[CSV_KEY[sort]], params: recordsBinds(p) }]);
}

// -- the earlier awards on a tender (pages/earlier.tsx) --------------------------------

// The records of the tender's buyer that share a UNSPSC class with it, the
// most classes shared then the newest first, EARLIER_POOL of them through
// rec_classes_class (cls, bid, day); the page ranks them by the words their
// titles share with the tender's and shows EARLIER_SHOWN.
export const EARLIER_CLASSES_MAX = 6;
export const EARLIER_POOL = 50;
export const EARLIER_SHOWN = 10;
// ?1 the buyer's id; ?2 the first day (ten fiscal years back); ?3 to ?8 the
// tender's classes as numbers (an unused one is -1, which no class is).
export const EARLIER_AWARDS_SQL =
  "SELECT d.src AS src, d.day AS day, d.cents AS cents, d.vnote AS vnote, d.ref AS ref, d.title_en AS title_en, d.title_fr AS title_fr, " +
  "d.oid AS oid, o.name AS org_name, p.shared AS shared FROM (SELECT c.rk AS rk, COUNT(*) AS shared, MAX(c.day) AS day FROM rec_classes c " +
  "WHERE c.cls IN (?3, ?4, ?5, ?6, ?7, ?8) AND c.bid = (SELECT bid FROM rec_buyers WHERE id = ?1) AND c.day >= ?2 " +
  `GROUP BY c.rk ORDER BY shared DESC, day DESC LIMIT ${EARLIER_POOL}) p JOIN rec_details d ON d.k = p.rk ` +
  `LEFT JOIN rec_orgs o ON o.oid = d.oid ORDER BY p.shared DESC, p.day DESC LIMIT ${EARLIER_POOL}`;

export function readEarlierAwards(env: Env, buyer: string, first: string, classes: readonly number[]): Promise<Read> {
  const slots = Array.from({ length: EARLIER_CLASSES_MAX }, (_, i) => classes[i] ?? -1);
  return readRecords(env, [{ sql: EARLIER_AWARDS_SQL, params: [buyer, first, ...slots] }]);
}

// -- the incumbents of a buyer or a segment (pages/incumbents.tsx) ---------------------

// Who holds the contracts ending within 12 months: the radar's window
// (rec_expiring), by organization, the largest value first.
export const INCUMBENTS_MAX = 25;
const INCUMBENT_COLUMNS = "oid, COUNT(*) AS n, SUM(cents) AS cents, MIN(endd) AS soonest, COUNT(*) OVER () AS n_orgs";
const INCUMBENT_ORDER = "ORDER BY cents IS NULL, cents DESC, n DESC, oid";
const incumbents = (where: string) =>
  "SELECT e.oid AS oid, o.name AS name, e.n AS n, e.cents AS cents, e.soonest AS soonest, e.n_orgs AS n_orgs FROM (" +
  `SELECT ${INCUMBENT_COLUMNS} FROM rec_expiring WHERE ${where} AND endd BETWEEN ?2 AND ?3 AND oid IS NOT NULL GROUP BY oid ` +
  `${INCUMBENT_ORDER} LIMIT ${INCUMBENTS_MAX}) e LEFT JOIN rec_orgs o ON o.oid = e.oid ` +
  `ORDER BY e.cents IS NULL, e.cents DESC, e.n DESC, e.oid LIMIT ${INCUMBENTS_MAX}`;
// ?1 the buyer's id, as the row's buyer or its client department; ?2 ?3 the window.
export const BUYER_INCUMBENTS_SQL = incumbents("(buyer = ?1 OR client = ?1)");
// ?1 the segment between spaces (' 43 ').
export const SEGMENT_INCUMBENTS_SQL = incumbents("instr(segs, ?1) > 0");

export function readIncumbents(env: Env, kind: "buyer" | "segment", key: string, first: string, last: string): Promise<Read> {
  return readRecords(env, [{
    sql: kind === "buyer" ? BUYER_INCUMBENTS_SQL : SEGMENT_INCUMBENTS_SQL, params: [kind === "buyer" ? key : ` ${key} `, first, last],
  }]);
}

// -- an organization's feed (pages/org_feed.tsx) ---------------------------------------

// The newest FEED_ENTRIES records naming the organization within ten fiscal
// years (?2 the first day), through rec_details_org.
export const FEED_ENTRIES = 50;
export const ORG_FEED_SQL =
  `SELECT ${DETAIL_COLUMNS} FROM rec_details d ${DETAIL_JOINS} WHERE d.oid = ?1 AND d.day >= ?2 ${NEWEST} LIMIT ${FEED_ENTRIES}`;

export function readOrgFeed(env: Env, oid: number, first: string): Promise<Read> {
  return readRecords(env, [{ sql: ORG_FEED_SQL, params: [oid, first] }]);
}

// -- the published contracts' sitemaps (src/sitemaps.ts) --------------------------------

// ?1 and ?2 the first and last key of one part's range, as decimal text: the
// keys are signed 64-bit hashes (records_db.key_of in the pipeline), past
// what a JavaScript number holds exactly, and SQLite reads the text as the
// integer for the seek on the primary key. Each row is the department and
// the reference that make the page's address; CONTRACT_SITEMAP_ROWS bounds a
// part, two URLs a row (English and French) within the protocol's 50,000.
export const CONTRACT_SITEMAP_ROWS = 25_000;
export const CONTRACT_SITEMAP_SQL =
  `SELECT dept, ref FROM rec_contracts WHERE k BETWEEN ?1 AND ?2 ORDER BY k LIMIT ${CONTRACT_SITEMAP_ROWS}`;

export function readContractSitemap(env: Env, first: string, last: string): Promise<Read> {
  return readRecords(env, [{ sql: CONTRACT_SITEMAP_SQL, params: [first, last] }]);
}

// Every statement here, for the tests that read their plans and their bounds.
export const TABLE_SQL: readonly string[] = [
  CONTRACT_SITEMAP_SQL, EARLIER_AWARDS_SQL, BUYER_INCUMBENTS_SQL, SEGMENT_INCUMBENTS_SQL, ORG_FEED_SQL,
  PUBLISHED_CONTRACT_SQL, PUBLISHED_INDIGENOUS_SQL, RADAR_ROWS_END_SQL, RADAR_ROWS_VALUE_SQL, RADAR_CSV_END_SQL, RADAR_CSV_VALUE_SQL, RADAR_TOTAL_SQL,
  RADAR_ROWS_END_DESC_SQL, RADAR_ROWS_VALUE_ASC_SQL, RADAR_CSV_END_DESC_SQL, RADAR_CSV_VALUE_ASC_SQL,
  RADAR_FACETS_SQL, RADAR_BUYERS_SQL, RADAR_CLIENTS_SQL, RADAR_SUPPLIERS_SQL,
  ...Object.values(RECORDS_SQL.organization), ...Object.values(RECORDS_SQL.buyer), ...RADAR_PROV_SQL,
];

export type { Query, Read, Row };
