// The analytics builder's statements (docs/analytics.md, "The builder"): for
// each cell of the matrix (public/build-menu.js MATRIX) the statement it
// reads, and how its rows become the figures the page draws. The cubes
// (cube_bs, cube_place, cube_meta, pipeline cubes.py) answer every buyer, a
// buyer, a segment and a buyer in a segment; records answers the
// organizations, the quarters and the methods through its own indexes;
// rec_due and rec_expiring the contracts ending, by the radar's rule.
//
// The rules of records_db.ts hold here: every statement is a constant
// prepared with ?N placeholders and bound only to values the menu model has
// checked (src/builder.ts); every one reads through an index and ends in a
// LIMIT; a period reads at most BUILD_YEARS fiscal years, a view by quarter
// QUARTER_YEARS. A page view sends one batch: the state row, cube_meta when
// it reads a cube, and one or two statements (readRecords).
//
// Nothing here adds what cannot be added: a median, a count of organizations
// and the largest organizations' values are read for one fiscal year a row
// and are left out of any sum of more than one (sumFigures). A supplier
// withheld as a person counts in every total and is never an organization:
// the organizations' statements leave out the records that name none, as the
// views' do.

import { QUARTER_YEARS, SET_MAX, TOPS } from "../public/build-menu.js";
import type { BuildChoice } from "./builder";
import { BUILD_YEARS } from "./builder";
import { SEGMENT_CODES } from "./constants";
import {
  BUYER_DUE_SQL, BUYER_QUARTERS_SQL, COMPETITION_COLUMNS, DUE_QUARTERS, DUE_YEARS, GROWTH_COLUMNS, SEGMENT_DUE_SQL, SOURCE_NUMBER,
  fiscalQuarterOf, fiscalYearOf, num, orgNumber, quarterEnd, type Query, type Row,
} from "./records_db";

// The most rows a ranked list holds (its largest top N), and the provinces a cube names (thirteen and '').
const TOP_MAX = Math.max(...TOPS);
export const PLACES_MAX = 14;
// The methods a record names (records_db.METHOD_CODES) and none.
const METHODS_MAX = 6;
// The quarters the contracts ending count by rec_expiring's twelve months, from the data date's.
export const EXPIRING_QUARTERS = 4;

// -- the figures --------------------------------------------------------------------------

// The columns of a cube_bs cell, each one fiscal year (records_schema.sql).
export const CUBE_FIELDS = [
  "n", "cents", "n_no_value", "n_nc", "n_unstated", "n_pos", "pos", "pos_nc", "pos_unstated", "med", "n_orgs", "top1", "top5", "top10",
  "n_amended", "n_compared", "n_grew", "first_cents", "last_cents",
] as const;
export type Field = (typeof CUBE_FIELDS)[number];
export type Figures = Partial<Record<Field, number | null>>;
// The figures no sum of more than one fiscal year keeps.
const UNADDABLE_FIELDS: readonly Field[] = ["med", "n_orgs", "top1", "top5", "top10"];
// cube_place's (records_schema.sql), the same meaning.
const PLACE_FIELDS: readonly Field[] = ["n", "cents", "n_nc", "n_pos", "pos", "med"];
// What a statement over records counts for each organization or fiscal year (records_db.ts's own columns).
const RECORD_FIELDS: readonly Field[] = ["n", "cents", "n_no_value", "n_nc", "n_unstated", "pos", "pos_nc", "n_amended", "n_compared", "n_grew", "first_cents", "last_cents"];
// What the quarters, the methods and the contracts ending count.
const COUNT_FIELDS: readonly Field[] = ["n", "cents", "n_no_value"];

function figuresOf(r: Row, fields: readonly Field[]): Figures {
  const out: Figures = {};
  for (const f of fields) if (f in r) out[f] = num(r[f]);
  return out;
}

// Figures added over lines: each field the sum of the lines that hold it (null where none counted one). A median, a
// count of organizations or a largest organizations' value is kept only from a single line, never added.
export function sumFigures(list: readonly Figures[]): Figures {
  const out: Figures = {};
  for (const f of CUBE_FIELDS) {
    const held = list.filter((x) => f in x);
    if (!held.length) continue;
    if (UNADDABLE_FIELDS.includes(f) && list.length > 1) continue;
    const values = held.map((x) => x[f]).filter((v): v is number => v !== null && v !== undefined);
    out[f] = values.length ? values.reduce((a, b) => a + b, 0) : null;
  }
  return out;
}

// -- the statements --------------------------------------------------------------------------

export const CUBE_META_SQL = "SELECT as_of FROM cube_meta WHERE k = 1 LIMIT 1";

const cols = (fields: readonly Field[], alias = "") => fields.map((f) => `${alias}${f} AS ${f}`).join(", ");
const sums = (fields: readonly Field[], alias = "") => fields.map((f) => `SUM(${alias}${f}) AS ${f}`).join(", ");
// ?1 a JSON list of buyer ids, read as the buyers' numbers through rec_buyers' unique id.
const BIDS = "(SELECT bid FROM rec_buyers WHERE id IN (SELECT value FROM json_each(?1)))";
const BUYER_ONE = "bid = (SELECT bid FROM rec_buyers WHERE id = ?1)";
const NO_VALUE = "SUM(CASE WHEN vnote = 1 THEN 1 ELSE 0 END) AS n_no_value";

// Every buyer (bid 0), or a segment's every buyer (sid ?1), by fiscal year: one cell a year (cube_bs_buyer).
export const CELL_YEARS_SQL =
  `SELECT fy, ${cols(CUBE_FIELDS)} FROM cube_bs WHERE bid = 0 AND sid = ?1 AND src = ?2 AND fy BETWEEN ?3 AND ?4 ORDER BY fy LIMIT ${BUILD_YEARS}`;

// A buyer or up to SET_MAX (?1), alone (sid 0) or in a segment (?2), by fiscal year.
export const BUYERS_YEARS_SQL =
  `SELECT b.id AS id, c.fy AS fy, ${cols(CUBE_FIELDS, "c.")} FROM cube_bs c JOIN rec_buyers b ON b.bid = c.bid ` +
  `WHERE c.bid IN ${BIDS} AND c.sid = ?2 AND c.src = ?3 AND c.fy BETWEEN ?4 AND ?5 ORDER BY b.id, c.fy LIMIT ${SET_MAX * BUILD_YEARS}`;

// Every buyer by segment, each segment's cells added over the period.
export const SEGMENTS_SQL =
  `SELECT sid, ${sums(CUBE_FIELDS)} FROM cube_bs WHERE bid = 0 AND src = ?1 AND sid > 0 AND fy BETWEEN ?2 AND ?3 GROUP BY sid ORDER BY sid ` +
  `LIMIT ${SEGMENT_CODES.length}`;

// A buyer's or a set's segments.
export const BUYERS_SEGMENTS_SQL =
  `SELECT b.id AS id, c.sid AS sid, ${sums(CUBE_FIELDS, "c.")} FROM cube_bs c JOIN rec_buyers b ON b.bid = c.bid ` +
  `WHERE c.bid IN ${BIDS} AND c.src = ?2 AND c.sid > 0 AND c.fy BETWEEN ?3 AND ?4 GROUP BY c.bid, c.sid ORDER BY b.id, c.sid ` +
  `LIMIT ${SET_MAX * SEGMENT_CODES.length}`;

// The ?5 buyers with the largest values, of every buyer (sid ?1 = 0) or in a segment (cube_bs_segment).
export const TOP_BUYERS_SQL =
  `SELECT b.id AS id, b.name_en AS name_en, b.name_fr AS name_fr, ${cols(CUBE_FIELDS, "r.")} FROM (` +
  `SELECT bid, ${sums(CUBE_FIELDS)} FROM cube_bs WHERE sid = ?1 AND src = ?2 AND bid > 0 AND fy BETWEEN ?3 AND ?4 ` +
  `GROUP BY bid ORDER BY cents DESC, n DESC, bid LIMIT ?5) r JOIN rec_buyers b ON b.bid = r.bid ORDER BY r.cents DESC, r.n DESC, b.id LIMIT ${TOP_MAX}`;

// By province of delivery: every record (both 0), a segment (bid 0), a buyer or a set (sid 0). Each statement names its
// index: every record's cells are found by the buyer's (bid 0), a segment's by the segment's.
export const PLACE_ALL_SQL =
  `SELECT prov, ${sums(PLACE_FIELDS)} FROM cube_place INDEXED BY cube_place_buyer WHERE bid = 0 AND sid = 0 AND src = ?1 AND fy BETWEEN ?2 AND ?3 ` +
  `GROUP BY prov ORDER BY prov LIMIT ${PLACES_MAX}`;
export const PLACE_SEGMENT_SQL =
  `SELECT prov, ${sums(PLACE_FIELDS)} FROM cube_place INDEXED BY cube_place_segment WHERE sid = ?1 AND bid = 0 AND src = ?2 AND fy BETWEEN ?3 AND ?4 ` +
  `GROUP BY prov ORDER BY prov LIMIT ${PLACES_MAX}`;
export const PLACE_BUYERS_SQL =
  `SELECT b.id AS id, p.prov AS prov, ${sums(PLACE_FIELDS, "p.")} FROM cube_place p INDEXED BY cube_place_buyer JOIN rec_buyers b ON b.bid = p.bid ` +
  `WHERE p.bid IN ${BIDS} AND p.sid = 0 AND p.src = ?2 AND p.fy BETWEEN ?3 AND ?4 GROUP BY p.bid, p.prov ORDER BY b.id, p.prov ` +
  `LIMIT ${SET_MAX * PLACES_MAX}`;

// By fiscal quarter, from records (a buyer's is the views' own rec_buyer_quarters, BUYER_QUARTERS_SQL): a segment's
// every row, extra or not, as its views count it; a buyer's rows in a segment.
const QUARTERS = `SELECT fy, fq, COUNT(*) AS n, SUM(cents) AS cents, ${NO_VALUE} FROM records WHERE`;
const QUARTERS_ORDER = `GROUP BY fy, fq ORDER BY fy, fq LIMIT ${4 * QUARTER_YEARS}`;
export const SEGMENT_QUARTERS_SQL = `${QUARTERS} sid = ?1 AND src = ?2 AND fy BETWEEN ?3 AND ?4 ${QUARTERS_ORDER}`;
export const BUYER_SEGMENT_QUARTERS_SQL = `${QUARTERS} ${BUYER_ONE} AND src = ?2 AND fy BETWEEN ?3 AND ?4 AND sid = ?5 ${QUARTERS_ORDER}`;

// By procurement method: a buyer's records, each once; a segment's every row.
const METHODS = `SELECT meth, COUNT(*) AS n, SUM(cents) AS cents, ${NO_VALUE} FROM records WHERE`;
export const BUYER_METHODS_SQL = `${METHODS} ${BUYER_ONE} AND src = ?2 AND fy BETWEEN ?3 AND ?4 AND extra = 0 GROUP BY meth ORDER BY meth LIMIT ${METHODS_MAX}`;
export const SEGMENT_METHODS_SQL = `${METHODS} sid = ?1 AND src = ?2 AND fy BETWEEN ?3 AND ?4 GROUP BY meth ORDER BY meth LIMIT ${METHODS_MAX}`;

// The organizations with the largest values, of a buyer (its records, each once, as BUYER_SUPPLIERS_SQL), a segment
// (every row, as SEGMENT_WINNERS_SQL) or a buyer in a segment; a record that names none (withheld) is in no row.
const ORG_COLUMNS = `oid, COUNT(*) AS n, SUM(cents) AS cents, ${NO_VALUE}, ${COMPETITION_COLUMNS}, ${GROWTH_COLUMNS}`;
const topOrgs = (where: string, limit: string) =>
  `SELECT o.name AS name, ${cols(RECORD_FIELDS, "r.")}, r.oid AS oid FROM (SELECT ${ORG_COLUMNS} FROM records WHERE ${where} ` +
  `AND oid IS NOT NULL GROUP BY oid ORDER BY cents DESC, n DESC, oid LIMIT ${limit}) r LEFT JOIN rec_orgs o ON o.oid = r.oid ` +
  `ORDER BY r.cents DESC, r.n DESC, r.oid LIMIT ${TOP_MAX}`;
export const BUYER_ORGS_SQL = topOrgs(`${BUYER_ONE} AND src = ?2 AND fy BETWEEN ?3 AND ?4 AND extra = 0`, "?5");
export const SEGMENT_ORGS_SQL = topOrgs("sid = ?1 AND src = ?2 AND fy BETWEEN ?3 AND ?4", "?5");
export const BUYER_SEGMENT_ORGS_SQL = topOrgs(`${BUYER_ONE} AND src = ?2 AND fy BETWEEN ?3 AND ?4 AND sid = ?5`, "?6");

// An organization or up to SET_MAX (?1, a JSON list of their numbers) by fiscal year, each record once, as the
// organization view reads it (ORG_YEARS_SQL, ORG_GROWTH_SQL); and their names.
export const ORGS_YEARS_SQL =
  `SELECT fy, ${ORG_COLUMNS} FROM records WHERE oid IN (SELECT value FROM json_each(?1)) AND src = ?2 AND fy BETWEEN ?3 AND ?4 AND extra = 0 ` +
  `GROUP BY oid, fy ORDER BY oid, fy LIMIT ${SET_MAX * BUILD_YEARS}`;
export const ORG_NAMES_SQL = `SELECT oid, name FROM rec_orgs WHERE oid IN (SELECT value FROM json_each(?1)) LIMIT ${SET_MAX}`;

// The contracts ending, by the radar's rule (rec_due, the eight quarters from the data date's): ?1 and ?2 the
// fiscal years they fall in, ?3 and ?4 the first and last quarter as fy * 4 + fq - 1. Every buyer by segment; the
// buyers with the largest values (?5 of them).
const DUE_SPAN = "fy BETWEEN ?1 AND ?2 AND fy * 4 + fq - 1 BETWEEN ?3 AND ?4";
const DUE_SUMS = "SUM(n) AS n, SUM(cents) AS cents, SUM(n_no_value) AS n_no_value";
export const DUE_SEGMENTS_SQL =
  `SELECT sid, ${DUE_SUMS} FROM rec_due WHERE sid IS NOT NULL AND ${DUE_SPAN} GROUP BY sid ORDER BY sid LIMIT ${SEGMENT_CODES.length}`;
export const DUE_BUYERS_SQL =
  `SELECT b.id AS id, b.name_en AS name_en, b.name_fr AS name_fr, r.n AS n, r.cents AS cents, r.n_no_value AS n_no_value FROM (` +
  `SELECT bid, ${DUE_SUMS} FROM rec_due WHERE bid IS NOT NULL AND ${DUE_SPAN} GROUP BY bid ORDER BY cents DESC, n DESC, bid LIMIT ?5` +
  `) r JOIN rec_buyers b ON b.bid = r.bid ORDER BY r.cents DESC, r.n DESC, b.id LIMIT ${TOP_MAX}`;

// The same from the radar's twelve months (rec_expiring) where rec_due holds no cell: a buyer in a segment by
// quarter, a buyer by segment, a segment by buyer, over the EXPIRING_QUARTERS from the data date's. ?2 and ?3 the
// first and last end dates; a segment between spaces (' 43 '), as the radar's own filter reads segs.
const END_FY = "CAST(substr(endd, 1, 4) AS INTEGER) - (CAST(substr(endd, 6, 2) AS INTEGER) < 4)";
const END_FQ = "(CAST(substr(endd, 6, 2) AS INTEGER) + 8) % 12 / 3 + 1";
const ENDING = "COUNT(*) AS n, SUM(cents) AS cents, SUM(nv) AS n_no_value";
export const EXPIRING_QUARTERS_SQL =
  `SELECT ${END_FY} AS fy, ${END_FQ} AS fq, ${ENDING} FROM rec_expiring WHERE buyer = ?1 AND endd BETWEEN ?2 AND ?3 AND instr(segs, ?4) > 0 ` +
  `GROUP BY fy, fq ORDER BY fy, fq LIMIT ${EXPIRING_QUARTERS}`;
const SEGMENT_LIST = `SELECT column1 AS code FROM (VALUES ${SEGMENT_CODES.map((c) => `('${c}')`).join(", ")})`;
export const EXPIRING_SEGMENTS_SQL =
  `SELECT CAST(s.code AS INTEGER) AS sid, COUNT(*) AS n, SUM(e.cents) AS cents, SUM(e.nv) AS n_no_value FROM rec_expiring e JOIN (${SEGMENT_LIST}) s ` +
  `ON instr(e.segs, ' ' || s.code || ' ') > 0 WHERE e.buyer = ?1 AND e.endd BETWEEN ?2 AND ?3 GROUP BY s.code ORDER BY s.code LIMIT ${SEGMENT_CODES.length}`;
export const EXPIRING_BUYERS_SQL =
  `SELECT r.buyer AS id, b.name_en AS name_en, b.name_fr AS name_fr, r.n AS n, r.cents AS cents, r.n_no_value AS n_no_value FROM (` +
  `SELECT buyer, ${ENDING} FROM rec_expiring WHERE endd BETWEEN ?2 AND ?3 AND instr(segs, ?1) > 0 AND buyer IS NOT NULL ` +
  `GROUP BY buyer ORDER BY cents DESC, n DESC, buyer LIMIT ?4) r LEFT JOIN rec_buyers b ON b.id = r.buyer ORDER BY r.cents DESC, r.n DESC, r.buyer LIMIT ${TOP_MAX}`;

// Every statement the builder sends, for the tests that read their plans and their bounds; the views' own three it
// reuses (BUYER_QUARTERS_SQL, BUYER_DUE_SQL, SEGMENT_DUE_SQL) are in records_db.ts ALL_SQL.
export const BUILD_SQL: readonly string[] = [
  CUBE_META_SQL, CELL_YEARS_SQL, BUYERS_YEARS_SQL, SEGMENTS_SQL, BUYERS_SEGMENTS_SQL, TOP_BUYERS_SQL, PLACE_ALL_SQL, PLACE_SEGMENT_SQL,
  PLACE_BUYERS_SQL, SEGMENT_QUARTERS_SQL, BUYER_SEGMENT_QUARTERS_SQL, BUYER_METHODS_SQL, SEGMENT_METHODS_SQL, BUYER_ORGS_SQL, SEGMENT_ORGS_SQL,
  BUYER_SEGMENT_ORGS_SQL, ORGS_YEARS_SQL, ORG_NAMES_SQL, DUE_SEGMENTS_SQL, DUE_BUYERS_SQL, EXPIRING_QUARTERS_SQL, EXPIRING_SEGMENTS_SQL,
  EXPIRING_BUYERS_SQL,
];

// -- what a view reads, and what its rows become ----------------------------------------------------

// A line's key: what its row is (a fiscal year, a quarter, a segment, a buyer, a province, a method, competitive or
// not, an organization, or the period's one figure).
export type LineKey =
  | { kind: "year"; fy: number }
  | { kind: "quarter"; fy: number; fq: number }
  | { kind: "segment"; sid: number }
  | { kind: "buyer"; id: string; en: string | null; fr: string | null }
  | { kind: "province"; code: string }
  | { kind: "method"; code: string | null }
  | { kind: "competitive"; comp: 1 | 0 | null }
  | { kind: "organization"; oid: number; name: string | null }
  | { kind: "total" };
export type Line = { key: LineKey; f: Figures };

// Whose lines a group holds: one subject of the view (a panel of a comparison), or the set itself when the rows are
// its own buyers or organizations.
export type SubjectRef =
  | { kind: "all" }
  | { kind: "buyer"; id: string }
  | { kind: "segment"; code: string }
  | { kind: "buyer_segment"; id: string; code: string }
  | { kind: "organization"; oid: number; name: string | null }
  | { kind: "set" };
export type Group = { subject: SubjectRef; lines: Line[] };

// The figures a view draws: its groups, and for the contracts ending by quarter the quarters it lists (each from
// start, fy * 4 + fq - 1, whether a contract ends in it or not).
export type Model = { groups: Group[]; quarters?: { start: number; count: number } };

// A view's statements and the reading of their rows (in the order sent, after the state row and cube_meta).
// cubes: the view reads a cube, so its data date is cube_meta's and an empty cube_meta means its figures are not
// there yet.
export type BuildPlan = { queries: Query[]; cubes: boolean; read: (rows: readonly Row[][]) => Model };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const quarterIndex = (fy: number, fq: number) => fy * 4 + fq - 1;
const quarterAt = (i: number) => ({ fy: Math.floor(i / 4), fq: (i % 4) + 1 });

// The cells a set's statement returns, one group a subject in the order the address names them (one with no row
// is an empty panel, never left out).
function bySubject(rows: readonly Row[], ids: readonly string[], idOf: (r: Row) => string, subject: (id: string) => SubjectRef, line: (r: Row) => Line): Group[] {
  return ids.map((id) => ({ subject: subject(id), lines: rows.filter((r) => idOf(r) === id).map(line) }));
}

const yearLine = (fields: readonly Field[]) => (r: Row): Line => ({ key: { kind: "year", fy: num(r.fy) ?? 0 }, f: figuresOf(r, fields) });

// A group's lines added into the period's one figure.
const total = (g: Group): Group => ({ subject: g.subject, lines: [{ key: { kind: "total" }, f: sumFigures(g.lines.map((l) => l.f)) }] });

// Competitive or not, from a group's cells added over the period: competitive is what is neither non-competitive
// nor unstated. The value is the counted values above zero, the ones the non-competitive share reads.
function competitiveLines(g: Group): Group {
  const f = sumFigures(g.lines.map((l) => l.f));
  const n = (x: Field) => f[x] ?? 0;
  const value = (all: number | null | undefined, ...less: (number | null | undefined)[]) =>
    all === null || all === undefined ? null : less.reduce<number>((a, b) => a - (b ?? 0), all);
  return {
    subject: g.subject,
    lines: [
      { key: { kind: "competitive", comp: 1 }, f: { n: n("n") - n("n_nc") - n("n_unstated"), cents: value(f.pos, f.pos_nc, f.pos_unstated) } },
      { key: { kind: "competitive", comp: 0 }, f: { n: n("n_nc"), cents: f.pos_nc ?? null } },
      { key: { kind: "competitive", comp: null }, f: { n: n("n_unstated"), cents: f.pos_unstated ?? null } },
    ],
  };
}

// The statements a view reads and how its rows become its groups. day is the data date (YYYY-MM-DD), which the
// contracts ending count from; current its fiscal year. Called only for a view the menu model offers
// (builder.ts buildProblem null): the subject's ids are checked, the period within its bound.
export function buildPlan(c: BuildChoice, o: { current: number; day: string }): BuildPlan {
  const src = SOURCE_NUMBER[c.source];
  const span = [c.first, c.last];
  const sid = c.segment ? Number(c.segment) : 0;
  const buyers = JSON.stringify(c.buyers);
  const oids = c.orgs.map((id) => orgNumber(id) as number);
  const start = quarterIndex(fiscalYearOf(o.day), fiscalQuarterOf(o.day));
  const dueSpan = [o.current, o.current + DUE_YEARS - 1, start, start + DUE_QUARTERS - 1];
  const fourEnd = (() => {
    const q = quarterAt(start + EXPIRING_QUARTERS - 1);
    return quarterEnd(q.fy, q.fq);
  })();
  const within = (count: number) => (r: Row) => {
    const i = quarterIndex(num(r.fy) ?? 0, num(r.fq) ?? 0);
    return i >= start && i < start + count;
  };
  const quarterLine = (r: Row): Line => ({ key: { kind: "quarter", fy: num(r.fy) ?? 0, fq: num(r.fq) ?? 0 }, f: figuresOf(r, COUNT_FIELDS) });
  const one = (sql: string, params: (string | number)[]): Query[] => [{ sql, params }];
  const subjectOne = (): SubjectRef =>
    c.subject === "all" ? { kind: "all" } : c.subject === "segment" ? { kind: "segment", code: c.segment }
    : c.subject === "buyer_segment" ? { kind: "buyer_segment", id: c.buyers[0], code: c.segment } : { kind: "buyer", id: c.buyers[0] };
  const plan = (queries: Query[], cubes: boolean, read: BuildPlan["read"]): BuildPlan => ({ queries, cubes, read });

  // The cells by fiscal year of every subject the cubes or records answer: the base of the rows by year, the one
  // figure, competitive or not, and the set's own buyers or organizations.
  const yearly = (): { queries: Query[]; cubes: boolean; groups: (rows: readonly Row[][]) => Group[] } => {
    if (c.subject === "organization" || c.subject === "organizations") {
      return {
        queries: [{ sql: ORGS_YEARS_SQL, params: [JSON.stringify(oids), src, ...span] }, { sql: ORG_NAMES_SQL, params: [JSON.stringify(oids)] }],
        cubes: false,
        groups: (rows) => {
          const names = new Map((rows[1] ?? []).map((r) => [num(r.oid), str(r.name)]));
          return oids.map((oid) => ({
            subject: { kind: "organization", oid, name: names.get(oid) ?? null },
            lines: (rows[0] ?? []).filter((r) => num(r.oid) === oid).map(yearLine(RECORD_FIELDS)),
          }));
        },
      };
    }
    if (c.subject === "all" || c.subject === "segment") {
      return { queries: one(CELL_YEARS_SQL, [sid, src, ...span]), cubes: true, groups: (rows) => [{ subject: subjectOne(), lines: (rows[0] ?? []).map(yearLine(CUBE_FIELDS)) }] };
    }
    const inSegment = c.subject === "buyer_segment" ? sid : 0;
    return {
      queries: one(BUYERS_YEARS_SQL, [buyers, inSegment, src, ...span]),
      cubes: true,
      groups: (rows) => (c.subject === "buyers" || c.subject === "buyer"
        ? bySubject(rows[0] ?? [], c.buyers, (r) => String(r.id), (id) => ({ kind: "buyer", id }), yearLine(CUBE_FIELDS))
        : [{ subject: subjectOne(), lines: (rows[0] ?? []).map(yearLine(CUBE_FIELDS)) }]),
    };
  };

  // The contracts ending, by quarter: the eight of rec_due, or rec_expiring's four for a buyer in a segment.
  const endingQuarters = (): { queries: Query[]; count: number; lines: (rows: readonly Row[][]) => Line[] } => {
    if (c.subject === "buyer_segment") {
      return {
        queries: one(EXPIRING_QUARTERS_SQL, [c.buyers[0], o.day, fourEnd, ` ${c.segment} `]),
        count: EXPIRING_QUARTERS,
        lines: (rows) => (rows[0] ?? []).filter(within(EXPIRING_QUARTERS)).map(quarterLine),
      };
    }
    const sql = c.subject === "segment" ? SEGMENT_DUE_SQL : BUYER_DUE_SQL;
    const key = c.subject === "segment" ? sid : c.buyers[0];
    return {
      queries: one(sql, [key, o.current, o.current + DUE_YEARS - 1]),
      count: DUE_QUARTERS,
      lines: (rows) => (rows[0] ?? []).filter(within(DUE_QUARTERS)).map(quarterLine),
    };
  };

  switch (c.rows) {
    case "year": {
      const y = yearly();
      return plan(y.queries, y.cubes, (rows) => ({ groups: y.groups(rows) }));
    }
    case "none": {
      if (c.measure === "ending") {
        const e = endingQuarters();
        return plan(e.queries, false, (rows) => ({ groups: [total({ subject: subjectOne(), lines: e.lines(rows) })] }));
      }
      const y = yearly();
      return plan(y.queries, y.cubes, (rows) => ({ groups: y.groups(rows).map(total) }));
    }
    case "competitive": {
      const y = yearly();
      return plan(y.queries, y.cubes, (rows) => ({ groups: y.groups(rows).map(competitiveLines) }));
    }
    case "quarter": {
      if (c.measure === "ending") {
        const e = endingQuarters();
        return plan(e.queries, false, (rows) => ({ groups: [{ subject: subjectOne(), lines: e.lines(rows) }], quarters: { start, count: e.count } }));
      }
      const queries = c.subject === "segment" ? one(SEGMENT_QUARTERS_SQL, [sid, src, ...span])
        : c.subject === "buyer_segment" ? one(BUYER_SEGMENT_QUARTERS_SQL, [c.buyers[0], src, ...span, sid])
        : one(BUYER_QUARTERS_SQL, [c.buyers[0], src, ...span]);
      return plan(queries, false, (rows) => ({ groups: [{ subject: subjectOne(), lines: (rows[0] ?? []).map(quarterLine) }] }));
    }
    case "segment": {
      const segLine = (fields: readonly Field[]) => (r: Row): Line => ({ key: { kind: "segment", sid: num(r.sid) ?? 0 }, f: figuresOf(r, fields) });
      if (c.measure === "ending") {
        const queries = c.subject === "all" ? one(DUE_SEGMENTS_SQL, dueSpan) : one(EXPIRING_SEGMENTS_SQL, [c.buyers[0], o.day, fourEnd]);
        return plan(queries, false, (rows) => ({ groups: [{ subject: subjectOne(), lines: (rows[0] ?? []).map(segLine(COUNT_FIELDS)) }] }));
      }
      if (c.subject === "all") {
        return plan(one(SEGMENTS_SQL, [src, ...span]), true, (rows) => ({ groups: [{ subject: { kind: "all" }, lines: (rows[0] ?? []).map(segLine(CUBE_FIELDS)) }] }));
      }
      return plan(one(BUYERS_SEGMENTS_SQL, [buyers, src, ...span]), true, (rows) => ({
        groups: bySubject(rows[0] ?? [], c.buyers, (r) => String(r.id), (id) => ({ kind: "buyer", id }), segLine(CUBE_FIELDS)),
      }));
    }
    case "buyer": {
      const buyerLine = (fields: readonly Field[]) => (r: Row): Line => ({
        key: { kind: "buyer", id: String(r.id), en: str(r.name_en), fr: str(r.name_fr) }, f: figuresOf(r, fields),
      });
      if (c.measure === "ending") {
        const queries = c.subject === "all" ? one(DUE_BUYERS_SQL, [...dueSpan, c.top]) : one(EXPIRING_BUYERS_SQL, [` ${c.segment} `, o.day, fourEnd, c.top]);
        return plan(queries, false, (rows) => ({ groups: [{ subject: subjectOne(), lines: (rows[0] ?? []).map(buyerLine(COUNT_FIELDS)) }] }));
      }
      if (c.subject === "buyers") {
        // The set's own buyers, each its cells added over the period.
        const y = yearly();
        return plan(y.queries, true, (rows) => ({
          groups: [{
            subject: { kind: "set" },
            lines: y.groups(rows).map((g) => ({ key: { kind: "buyer", id: (g.subject as { id: string }).id, en: null, fr: null }, f: sumFigures(g.lines.map((l) => l.f)) })),
          }],
        }));
      }
      return plan(one(TOP_BUYERS_SQL, [c.subject === "segment" ? sid : 0, src, ...span, c.top]), true, (rows) => ({
        groups: [{ subject: subjectOne(), lines: (rows[0] ?? []).map(buyerLine(CUBE_FIELDS)) }],
      }));
    }
    case "province": {
      const placeLine = (r: Row): Line => ({ key: { kind: "province", code: typeof r.prov === "string" ? r.prov : "" }, f: figuresOf(r, PLACE_FIELDS) });
      if (c.subject === "buyer" || c.subject === "buyers") {
        return plan(one(PLACE_BUYERS_SQL, [buyers, src, ...span]), true, (rows) => ({
          groups: bySubject(rows[0] ?? [], c.buyers, (r) => String(r.id), (id) => ({ kind: "buyer", id }), placeLine),
        }));
      }
      const queries = c.subject === "segment" ? one(PLACE_SEGMENT_SQL, [sid, src, ...span]) : one(PLACE_ALL_SQL, [src, ...span]);
      return plan(queries, true, (rows) => ({ groups: [{ subject: subjectOne(), lines: (rows[0] ?? []).map(placeLine) }] }));
    }
    case "method": {
      const queries = c.subject === "segment" ? one(SEGMENT_METHODS_SQL, [sid, src, ...span]) : one(BUYER_METHODS_SQL, [c.buyers[0], src, ...span]);
      return plan(queries, false, (rows) => ({
        groups: [{ subject: subjectOne(), lines: (rows[0] ?? []).map((r) => ({ key: { kind: "method", code: str(r.meth) }, f: figuresOf(r, COUNT_FIELDS) })) }],
      }));
    }
    case "organization": {
      const orgLine = (r: Row): Line => ({ key: { kind: "organization", oid: num(r.oid) ?? 0, name: str(r.name) }, f: figuresOf(r, RECORD_FIELDS) });
      if (c.subject === "organizations") {
        const y = yearly();
        return plan(y.queries, false, (rows) => ({
          groups: [{
            subject: { kind: "set" },
            lines: y.groups(rows).map((g) => {
              const s = g.subject as { oid: number; name: string | null };
              return { key: { kind: "organization", oid: s.oid, name: s.name }, f: sumFigures(g.lines.map((l) => l.f)) };
            }),
          }],
        }));
      }
      const queries = c.subject === "segment" ? one(SEGMENT_ORGS_SQL, [sid, src, ...span, c.top])
        : c.subject === "buyer_segment" ? one(BUYER_SEGMENT_ORGS_SQL, [c.buyers[0], src, ...span, sid, c.top])
        : one(BUYER_ORGS_SQL, [c.buyers[0], src, ...span, c.top]);
      return plan(queries, false, (rows) => ({ groups: [{ subject: subjectOne(), lines: (rows[0] ?? []).map(orgLine) }] }));
    }
  }
}
