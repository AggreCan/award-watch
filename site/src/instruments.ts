// Standing offers and supply arrangements (docs/sosa.md): what the site reads
// of PSPC's weekly SOSA file, as the pipeline keeps it
// (pipeline/awardwatch_pipeline/sources/sosa.py, sosa_export.py).
//
// - instruments/index.json, a static file: every instrument with an active
//   holder, which /instruments filters, sorts and pages in the Worker (a few
//   thousand rows), and its CSV of a view.
// - The records database's rec_instruments and rec_holders: one
//   instrument's page and its CSV of holders, through rec_instruments_agr and
//   rec_holders_instrument. Every statement is a constant with ?N
//   placeholders bound to a checked agreement number, names an index and
//   ends in a LIMIT (site/test/instruments.test.ts reads each plan).
// - The parts the export adds to existing files: "instruments" on a profile,
//   "holders" on a segment's and a buyer's file, "instruments" on a tender
//   notice. Each is optional: a file written before them reads as having none.

import type { Env } from "./env";
import { loadJson } from "./data";
import { type Query, type Read, type Row, readRecords } from "./records_db";
import { isListOf, isNum, isObj, isStr, isStrOrNull, optional } from "./valid";

// -- bounds ----------------------------------------------------------------------

export const INSTRUMENT_PAGE_ROWS = 100;
export const INSTRUMENT_CSV_MAX = 10_000;
// One row a holder and region: the largest instruments have a few hundred holders in several regions.
export const HOLDER_ROWS_MAX = 5_000;
export const HOLDERS_CSV_MAX = 10_000;
// An agreement number is about 20 characters; anything longer is not one.
export const AGREEMENT_MAX = 120;
// The radar's windows, which the index's expiry filter reads the same way.
export const WITHIN_DAYS = { "3": 91, "6": 182, "12": 365 } as const;
export type Within = keyof typeof WITHIN_DAYS;

export const TYPE_CODES = ["SA", "NMSO", "NISO", "DISO", "RISO", "RMSO", "OTHER"] as const;
export type TypeCode = (typeof TYPE_CODES)[number];
// The acronyms a type is known by: every code but OTHER.
export const TYPES_BY_ACRONYM: ReadonlyMap<string, TypeCode> = new Map(TYPE_CODES.filter((c) => c !== "OTHER").map((c) => [c, c]));
// The delivery point codes beside the provinces and territories: foreign, national, national capital.
export const OTHER_REGIONS = ["FD", "NA", "NC"] as const;
// Two of them as the file published in 2026 writes them: CA for the whole
// country and RCNNCR (the stored letters of its code) for the capital region.
export const REGION_ALIASES: Record<string, (typeof OTHER_REGIONS)[number]> = { CA: "NA", RCNNCR: "NC" };

const CONTROL_RE = /[\u0000-\u001f\u007f]/;
export function isAgreement(v: unknown): v is string {
  return isStr(v) && v.trim().length > 0 && v.length <= AGREEMENT_MAX && !CONTROL_RE.test(v);
}

// The page's address: the number as one escaped path segment (E60ZT-120002%2F001%2FZT).
export function instrumentPath(agreement: string): string {
  return `/instruments/${encodeURIComponent(agreement)}`;
}

// -- the static parts -------------------------------------------------------------

export interface InstrumentRow {
  agreement: string;
  type: TypeCode;
  // The file's own words, on a row whose type is OTHER only.
  type_en?: string | null;
  type_fr?: string | null;
  description_en: string | null;
  description_fr: string | null;
  // The commodity codes as the file writes them (UNSPSC in the current file, a GSIN in older ones).
  commodity: string[];
  end_user: string | null;
  regions: string[];
  segments: string[];
  start: string | null;
  expiry: string | null;
  n_holders: number;
  n_holders_withheld: number;
}

export interface Named { en: string | null; fr: string | null }

export interface InstrumentIndex {
  as_of: string;
  published: string | null;
  // The stage's last outcome: a failed read or a held file leaves the last file's rows.
  status: "ok" | "held" | "failed" | "none";
  source: string;
  types: Record<string, Named>;
  // One name per commodity code.
  commodities: Record<string, Named>;
  end_users: Record<string, Named & { buyer_id: string | null }>;
  // The file's own names of its delivery point codes.
  region_names?: Record<string, Named>;
  rows: InstrumentRow[];
}

// A delivery point code as the pipeline writes it (sources/sosa.region_code).
const REGION_RE = /^[A-Z0-9]{0,8}$/;
// A commodity code (sources/sosa.COMMODITY_CODE_RE).
export const COMMODITY_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$/;
const isCount = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;
const isDayOrNull = (v: unknown): boolean => v === null || (isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v));
const isCodes = (v: unknown, re: RegExp): boolean => isListOf(v, (x) => isStr(x) && re.test(x));
const isNamed = (v: unknown): v is Named => isObj(v) && isStrOrNull(v.en ?? null) && isStrOrNull(v.fr ?? null);
const isType = (v: unknown): v is TypeCode => (TYPE_CODES as readonly unknown[]).includes(v);

// A file written before 2026-11-08 holds one commodity string a row, in the
// source file's quotes ('"25111900; 81100000"'); loadInstrumentIndex reads it
// as the list of codes it names (upgradeIndex).
const isCommodity = (v: unknown): boolean => isCodes(v, COMMODITY_RE) || isStrOrNull(v);

export const isInstrumentRow = (r: unknown): r is InstrumentRow => isObj(r) && isAgreement(r.agreement) && isType(r.type) &&
  optional(r.type_en, isStrOrNull) && optional(r.type_fr, isStrOrNull) &&
  isStrOrNull(r.description_en) && isStrOrNull(r.description_fr) && isCommodity(r.commodity) && isStrOrNull(r.end_user) &&
  isCodes(r.regions, REGION_RE) && isCodes(r.segments, /^\d{2}$/) && isDayOrNull(r.start) && isDayOrNull(r.expiry) &&
  isCount(r.n_holders) && isCount(r.n_holders_withheld);

// A kept file is the same frozen object on every hit (data.ts loadJson), so
// its rows are checked, and an older file's read in today's form, once per
// isolate, not on every request.
const checked = new WeakMap<object, InstrumentIndex>();

export async function loadInstrumentIndex(env: Env): Promise<InstrumentIndex | null> {
  const v = await loadJson<unknown>(env, "instruments/index.json");
  if (!isObj(v)) return null;
  const known = checked.get(v);
  if (known) return known;
  const ok = isStr(v.as_of) && isDayOrNull(v.published) && ["ok", "held", "failed", "none"].includes(v.status) && isStr(v.source) &&
    isObj(v.types) && Object.values(v.types).every(isNamed) && isObj(v.commodities) && Object.values(v.commodities).every(isNamed) &&
    isObj(v.end_users) && Object.values(v.end_users).every((u) => isNamed(u) && isStrOrNull((u as any).buyer_id ?? null)) &&
    optional(v.region_names, (x) => isObj(x) && Object.values(x).every(isNamed)) && isListOf(v.rows, isInstrumentRow);
  if (!ok) return null;
  const idx = upgradeIndex(v as unknown as InstrumentIndex);
  checked.set(v, idx);
  return idx;
}

// An index whose rows hold one commodity string (written before 2026-11-08)
// in today's form: each row's codes as a list and the names per code, read out
// of the old keys and names as the instrument page reads rec_instruments. The
// Worker can then be deployed before the nightly writes the new file.
function upgradeIndex(idx: InstrumentIndex): InstrumentIndex {
  const old = (c: unknown): c is string | null => !Array.isArray(c);
  if (!idx.rows.some((r) => old(r.commodity))) return idx;
  const commodities: Record<string, Named> = {};
  for (const [key, named] of Object.entries(idx.commodities)) {
    for (const lang of ["en", "fr"] as const) {
      for (const c of commodityList(key, named[lang])) {
        const entry = (commodities[c.code] ??= { en: null, fr: null });
        entry[lang] ??= c.name;
      }
    }
  }
  const rows = idx.rows.map((r) => (old(r.commodity) ? { ...r, commodity: commodityList(r.commodity, null).map((c) => c.code) } : r));
  return { ...idx, commodities, rows };
}

export interface HeldInstrument {
  agreement: string;
  type: TypeCode;
  type_en: string | null;
  type_fr: string | null;
  description_en: string | null;
  description_fr: string | null;
  regions: string[];
  expiry: string | null;
  lost_on?: string;
  why?: string | null;
}

export interface ProfileInstruments { n: number; rows: HeldInstrument[]; lapsed: HeldInstrument[] }

const isHeld = (r: unknown): r is HeldInstrument => isObj(r) && isAgreement(r.agreement) && isType(r.type) && isStrOrNull(r.type_en) &&
  isStrOrNull(r.type_fr) && isStrOrNull(r.description_en) && isStrOrNull(r.description_fr) && isCodes(r.regions, REGION_RE) &&
  isDayOrNull(r.expiry) && optional(r.lost_on, (x) => isDayOrNull(x) && x !== null) && optional(r.why, (x) => x === null || isStr(x));

// A profile's "instruments", or null when it holds none (or a file written before them).
export function profileInstruments(profile: unknown): ProfileInstruments | null {
  const v = isObj(profile) ? profile.instruments : undefined;
  return isObj(v) && isCount(v.n) && isListOf(v.rows, isHeld) && isListOf(v.lapsed, isHeld) && v.rows.length <= v.n
    ? (v as ProfileInstruments)
    : null;
}

export interface HolderTop { id: string; name: string; n: number; soonest: string | null }
export interface HoldersPart { n: number; rows: HolderTop[] }

// A segment's or a buyer's "holders", or null.
export function holdersPart(file: unknown): HoldersPart | null {
  const v = isObj(file) ? file.holders : undefined;
  return isObj(v) && isCount(v.n) && isListOf(v.rows, (r) => isObj(r) && isStr(r.id) && /^org-[0-9a-f]{10}$/.test(r.id) && isStr(r.name) &&
    isCount(r.n) && isDayOrNull(r.soonest)) && v.rows.length <= v.n
    ? (v as HoldersPart)
    : null;
}

export interface TenderInstrument { agreement: string; n_holders: number; n_holders_withheld: number; expiry: string | null }

// A tender notice's "instruments": the active instruments its solicitation issued.
export function tenderInstruments(detail: unknown): TenderInstrument[] {
  const v = isObj(detail) ? detail.instruments : undefined;
  return isListOf(v, (r) => isObj(r) && isAgreement(r.agreement) && isCount(r.n_holders) && isCount(r.n_holders_withheld) &&
    isDayOrNull(r.expiry)) ? (v as TenderInstrument[]) : [];
}

// -- the index's filters ---------------------------------------------------------------

export interface InstrumentQuery {
  type: string; region: string; segment: string; commodity: string; user: string; within: "" | Within; sort: "" | InstrumentOrder;
}

// The orders of /instruments, which the Expiry and Holders heads set too:
// the value in the address, the column, the direction. "" (no order asked)
// is the soonest expiry first, which "expiry" repeats from the head;
// "holders" is the most holders first.
export const INSTRUMENT_ORDERS = [
  ["expiry", "expiry", "asc"], ["expiry-desc", "expiry", "desc"], ["holders-asc", "holders", "asc"], ["holders", "holders", "desc"],
] as const;
export type InstrumentOrder = (typeof INSTRUMENT_ORDERS)[number][0];

const QUERY_KEYS = ["type", "region", "segment", "commodity", "user", "within", "sort"] as const;

// Anything out of form reads as no filter, never an error.
export function readInstrumentQuery(url: URL): InstrumentQuery {
  const get = (k: string, re: RegExp) => {
    const v = url.searchParams.get(k) ?? "";
    return re.test(v) ? v : "";
  };
  const within = get("within", /^(?:3|6|12)$/) as "" | Within;
  return {
    // A region is a province or territory, or one of the file's own codes (RCNNCR, US).
    type: get("type", /^[A-Z]{2,5}$/), region: get("region", /^[A-Z0-9]{2,8}$/), segment: get("segment", /^(?:\d{2}|none)$/),
    commodity: get("commodity", /^[A-Za-z0-9.-]{1,40}$/), user: get("user", /^[a-z0-9:-]{1,80}$/), within,
    sort: get("sort", /^(?:expiry|expiry-desc|holders|holders-asc)$/) as "" | InstrumentOrder,
  };
}

export function instrumentQueryString(q: InstrumentQuery, page = 1): string {
  const p = new URLSearchParams();
  for (const k of QUERY_KEYS) if (q[k]) p.set(k, q[k]);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function activeFilters(q: InstrumentQuery): number {
  return (["type", "region", "segment", "commodity", "user", "within"] as const).filter((k) => q[k]).length;
}

export function daysLeft(expiry: string | null, today: string): number | null {
  if (!expiry) return null;
  const ms = Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

export function filterInstruments(rows: readonly InstrumentRow[], q: InstrumentQuery, today: string): InstrumentRow[] {
  return rows.filter((r) => {
    if (q.type && r.type !== q.type) return false;
    if (q.region && !r.regions.includes(q.region)) return false;
    if (q.segment === "none" ? r.segments.length > 0 : q.segment && !r.segments.includes(q.segment)) return false;
    if (q.commodity && !r.commodity.includes(q.commodity)) return false;
    if (q.user && r.end_user !== q.user) return false;
    if (q.within) {
      const left = daysLeft(r.expiry, today);
      if (left === null || left < 0 || left > WITHIN_DAYS[q.within]) return false;
    }
    return true;
  });
}

// Soonest expiry first (no expiry last), or the most holders first; the
// number breaks ties. Each the other way round too, for the table's heads:
// the latest expiry first (no expiry still last), the fewest holders first.
export function sortInstruments(rows: readonly InstrumentRow[], sort: InstrumentQuery["sort"]): InstrumentRow[] {
  const byNumber = (a: InstrumentRow, b: InstrumentRow) => (a.agreement < b.agreement ? -1 : a.agreement > b.agreement ? 1 : 0);
  const up = sort === "expiry-desc" ? -1 : 1;
  const byExpiry = (a: InstrumentRow, b: InstrumentRow) =>
    a.expiry === b.expiry ? 0 : a.expiry === null ? 1 : b.expiry === null ? -1 : a.expiry < b.expiry ? -up : up;
  const byHolders = (a: InstrumentRow, b: InstrumentRow) =>
    sort === "holders" ? b.n_holders - a.n_holders : sort === "holders-asc" ? a.n_holders - b.n_holders : 0;
  return [...rows].sort((a, b) => byHolders(a, b) || byExpiry(a, b) || byNumber(a, b));
}

// -- one instrument, from the records database ------------------------------------------------

const INSTRUMENT_COLUMNS =
  "i.agr AS agr, i.type_en AS type_en, i.type_fr AS type_fr, i.desc_en AS desc_en, i.desc_fr AS desc_fr, i.gsin AS gsin, " +
  "i.gsin_en AS gsin_en, i.gsin_fr AS gsin_fr, i.user_en AS user_en, i.user_fr AS user_fr, i.buyer AS buyer, i.start AS start, " +
  "i.expiry AS expiry, i.segs AS segs, i.tref AS tref, i.n AS n, i.nw AS nw, i.seen AS seen, i.last AS last, i.calls AS calls";
// ?1 the agreement number as published, through rec_instruments_agr.
export const INSTRUMENT_SQL = `SELECT ${INSTRUMENT_COLUMNS} FROM rec_instruments i WHERE i.agr = ?1 LIMIT 1`;
// Its holders whose names are shown, by name then region, through
// rec_holders_instrument; one row more than the page shows, so it knows when
// there are more.
const HOLDER_COLUMNS = "h.oid AS oid, h.name AS name, h.op AS op, h.region AS region, h.region_en AS region_en, h.region_fr AS region_fr, h.seen AS seen";
export const HOLDERS_SQL =
  `SELECT ${HOLDER_COLUMNS} FROM rec_holders h WHERE h.ik = (SELECT k FROM rec_instruments WHERE agr = ?1) ORDER BY h.name, h.region ` +
  `LIMIT ${HOLDER_ROWS_MAX + 1}`;
export const HOLDERS_CSV_SQL =
  `SELECT ${HOLDER_COLUMNS} FROM rec_holders h WHERE h.ik = (SELECT k FROM rec_instruments WHERE agr = ?1) ORDER BY h.name, h.region ` +
  `LIMIT ${HOLDERS_CSV_MAX}`;

export function readInstrument(env: Env, agreement: string): Promise<Read> {
  return readRecords(env, [{ sql: INSTRUMENT_SQL, params: [agreement] }, { sql: HOLDERS_SQL, params: [agreement] }]);
}

export function readHoldersCsv(env: Env, agreement: string): Promise<Read> {
  return readRecords(env, [{ sql: INSTRUMENT_SQL, params: [agreement] }, { sql: HOLDERS_CSV_SQL, params: [agreement] }]);
}

// One instrument's commodity codes with their names, from rec_instruments.gsin
// ("25111900; 81100000") and gsin_en or gsin_fr ("25111900 - Marine craft
// systems; 81100000 - Professional engineering services"), the pipeline's
// pieces (sosa_export.instrument_rows). A row written before the pipeline
// cleaned the file's quotes reads the same, and a lone code's plain
// description is its name.
const QUOTES_RE = /^["\u201c\u201d\s]+|["\u201c\u201d\s]+$/g;
export function commodityList(codesText: string | null, namesText: string | null): { code: string; name: string | null }[] {
  const codes: string[] = [];
  for (const piece of (codesText ?? "").split(/[;,|\n]/)) {
    const code = piece.replace(QUOTES_RE, "");
    if (COMMODITY_RE.test(code) && !codes.includes(code)) codes.push(code);
  }
  const text = (namesText ?? "").replace(QUOTES_RE, "");
  const names = new Map<string, string>();
  for (const piece of text.split(/;\s*(?=[A-Za-z0-9.-]+\s+-\s)/)) {
    const m = /^([A-Za-z0-9.-]+)\s+-\s+(.+)$/s.exec(piece.replace(QUOTES_RE, ""));
    if (m && codes.includes(m[1]) && !names.has(m[1])) names.set(m[1], m[2].replace(QUOTES_RE, ""));
  }
  if (names.size === 0 && codes.length === 1 && text) names.set(codes[0], text);
  return codes.map((code) => ({ code, name: names.get(code) ?? null }));
}

// Every statement here, for the tests that read their plans.
export const INSTRUMENT_STATEMENTS: readonly string[] = [INSTRUMENT_SQL, HOLDERS_SQL, HOLDERS_CSV_SQL];

// The call-ups JSON of a rec_instruments row: [organization number or null, rows, cents or null, rows with no value].
export interface Calls { oid: number | null; n: number; cents: number | null; noValue: number }

export function callsOf(raw: unknown): Calls[] {
  if (!isStr(raw)) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v.filter((c): c is unknown[] => Array.isArray(c) && c.length === 4 && (c[0] === null || isCount(c[0])) && isCount(c[1]) &&
    (c[2] === null || isNum(c[2])) && isCount(c[3]))
    .map((c) => ({ oid: c[0] as number | null, n: c[1] as number, cents: c[2] as number | null, noValue: c[3] as number }));
}

export type { Query, Read, Row };
