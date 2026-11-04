// The records side of the organization, buyer and segment deliveries
// (deliveries.ts runs them; digests.ts writes the message). The records
// database (binding RECORDS, docs/analytics.md) holds one row per counted
// record with its source, fiscal year and quarter, but no day the record was
// first seen, no title and no reference, so "the records added since the last
// delivery" cannot be listed one by one. What it can tell exactly is how many
// records each source holds in each fiscal year for one organization, buyer
// or segment. A delivery reads those counts, compares them with the counts
// kept at the search's previous delivery (delivery_marks in the accounts
// database, the "mark"), and reports each source and year whose count rose.
// A first delivery has nothing to compare with: it keeps the counts and
// reports nothing, and the next one reports what rose since.
//
// Every records statement is a constant here with ?N placeholders, bound to
// values checked before they reach it (an organization number from an
// organization id, a buyer id that is a buyer id, a segment that is one of
// the 57, fiscal years from the data date), bounded to MAX_YEARS fiscal years
// through the index on that column, and ended by a LIMIT. A search reads one
// batch: the state row and the kind's statements.

import { type MoneySource } from "../constants";
import { BUYER_ID_RE } from "../data";
import type { Env } from "../env";
import { MAX_YEARS, SOURCE_NUMBER, STATE_SQL, fiscalYearOf, orgNumber, segmentNumber } from "../records_db";
import { faultSummary } from "../search_db";

export const RECORDS_KINDS = ["organization", "buyer", "segment"] as const;
export type RecordsKind = (typeof RECORDS_KINDS)[number];
export const isRecordsKind = (kind: string): kind is RecordsKind => (RECORDS_KINDS as readonly string[]).includes(kind);

// The sources each kind follows, as its saved search's label names them:
// "named on a new award, contract or grant"; "new award notices and
// contracts from" a buyer; award notices in a segment (and PSPC's contract
// history, the other source that carries UNSPSC codes).
export const KIND_SOURCES: Readonly<Record<RecordsKind, readonly MoneySource[]>> = {
  organization: ["awards", "history", "contracts", "grants"],
  buyer: ["awards", "history", "contracts"],
  segment: ["awards", "history"],
};

const SOURCE_OF_NUMBER = new Map(Object.entries(SOURCE_NUMBER).map(([name, n]) => [n, name as MoneySource]));
const numbers = (kind: RecordsKind) => KIND_SOURCES[kind].map((s) => SOURCE_NUMBER[s]).join(", ");

// -- the statements -------------------------------------------------------------------

// ?1 the organization's number, ?2 and ?3 the first and last fiscal years.
// Read through records_org (oid, src, fy); extra = 0 counts a notice once,
// as the profile does.
export const ORG_COUNTS_SQL =
  `SELECT src, fy, COUNT(*) AS n, SUM(cents) AS cents FROM records WHERE oid = ?1 AND src IN (${numbers("organization")}) ` +
  `AND fy BETWEEN ?2 AND ?3 AND extra = 0 GROUP BY src, fy ORDER BY src, fy LIMIT ${KIND_SOURCES.organization.length * MAX_YEARS}`;

export const ORG_NAME_SQL = "SELECT name FROM rec_orgs WHERE oid = ?1 LIMIT 1";

// ?1 the buyer id. The summary table the buyer view's first chart reads,
// whose rows already count each record once.
export const BUYER_COUNTS_SQL =
  "SELECT src, fy, SUM(n) AS n, SUM(cents) AS cents FROM rec_buyer_quarters WHERE bid = (SELECT bid FROM rec_buyers WHERE id = ?1) " +
  `AND src IN (${numbers("buyer")}) AND fy BETWEEN ?2 AND ?3 GROUP BY src, fy ORDER BY src, fy LIMIT ${KIND_SOURCES.buyer.length * MAX_YEARS}`;

export const BUYER_NAME_SQL = "SELECT name_en, name_fr FROM rec_buyers WHERE id = ?1 LIMIT 1";

// ?1 the segment. The summary table the segment view's first chart reads: a
// notice in several segments counts in each, as on the segment pages.
export const SEGMENT_COUNTS_SQL =
  `SELECT src, fy, n, cents FROM rec_segment_years WHERE sid = ?1 AND src IN (${numbers("segment")}) AND fy BETWEEN ?2 AND ?3 ` +
  `ORDER BY src, fy LIMIT ${KIND_SOURCES.segment.length * MAX_YEARS}`;

const COUNTS_SQL: Record<RecordsKind, string> = { organization: ORG_COUNTS_SQL, buyer: BUYER_COUNTS_SQL, segment: SEGMENT_COUNTS_SQL };
// A segment's name is the site's own (constants.ts); the others come from the database.
const NAME_SQL: Record<RecordsKind, string | null> = { organization: ORG_NAME_SQL, buyer: BUYER_NAME_SQL, segment: null };

// Every records statement, for the tests that read their plans and bounds.
export const RECORDS_DELIVERY_SQL: readonly string[] = [ORG_COUNTS_SQL, ORG_NAME_SQL, BUYER_COUNTS_SQL, BUYER_NAME_SQL, SEGMENT_COUNTS_SQL];

// -- the entity a search follows -------------------------------------------------------------

export interface Entity {
  kind: RecordsKind;
  // What the statements bind as ?1: the organization's number, the buyer id or the segment's number.
  key: number | string;
  // The organization id, the buyer id or the two-digit segment code.
  id: string;
}

// The saved search's page as interestFilter saved it, checked again as the
// pages check their ids; null for anything else.
export function entityOf(kind: string, params: string): Entity | null {
  if (kind === "organization") {
    const id = /^\/organizations\/(org-[0-9a-f]{10})$/.exec(params)?.[1];
    const n = id ? orgNumber(id) : null;
    return id && n !== null ? { kind, key: n, id } : null;
  }
  if (kind === "buyer") {
    const id = /^\/buyers\/([^/?#]+)$/.exec(params)?.[1];
    return id && id.length <= 80 && BUYER_ID_RE.test(id) ? { kind, key: id, id } : null;
  }
  if (kind === "segment") {
    const code = /^\/segments\/([0-9]{2})$/.exec(params)?.[1];
    const n = code ? segmentNumber(code) : null;
    return code && n !== null ? { kind, key: n, id: code } : null;
  }
  return null;
}

// -- counts and marks ---------------------------------------------------------------------------

// "<source number>:<fiscal year>" to the count and the counted cents (null when none was counted).
export type Counts = Record<string, [number, number | null]>;

export interface Mark {
  // The records database's data date when the counts were read.
  asOf: string;
  // The counting rules' version (rec_meta "rules"): counts made under other rules do not compare.
  rules: string | null;
  // The fiscal years read, first and last: a year outside them was not counted, so it is not compared.
  from: number;
  to: number;
  counts: Counts;
}

// A source and fiscal year whose count rose: by how many, its count now and
// its counted value now.
export interface Rise {
  src: MoneySource;
  fy: number;
  more: number;
  n: number;
  cents: number | null;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isCents = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isSafeInteger(v));

// The stored JSON as a mark; null for anything that does not read as one, so
// a damaged row only makes the next delivery a first one again.
export function readMark(asOf: string, text: string | null): Mark | null {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!(o.rules === null || typeof o.rules === "string") || !Number.isInteger(o.from) || !Number.isInteger(o.to)) return null;
  if (!o.counts || typeof o.counts !== "object" || Array.isArray(o.counts)) return null;
  const counts: Counts = {};
  for (const [key, pair] of Object.entries(o.counts as Record<string, unknown>)) {
    if (!/^[1-4]:\d{4}$/.test(key) || !Array.isArray(pair) || pair.length !== 2 || !isCount(pair[0]) || !isCents(pair[1])) return null;
    counts[key] = [pair[0], pair[1]];
  }
  return { asOf, rules: o.rules as string | null, from: o.from as number, to: o.to as number, counts };
}

export const markText = (m: Mark): string => JSON.stringify({ rules: m.rules, from: m.from, to: m.to, counts: m.counts });

// The counts that rose since the previous mark, newest fiscal year first and
// in the profile's order of sources within a year; null when there is no
// previous mark to compare with, or it was made under other counting rules
// (a full reload with new rules moves counts that were never new). A year
// the previous mark did not read (the window moved on at the turn of a
// fiscal year) is not compared. A count that fell is not reported.
export function rises(prev: Mark | null, now: Mark): Rise[] | null {
  if (!prev || prev.rules !== now.rules) return null;
  const out: Rise[] = [];
  for (const [key, [n, cents]] of Object.entries(now.counts)) {
    const [srcNumber, fy] = key.split(":").map(Number);
    const src = SOURCE_OF_NUMBER.get(srcNumber);
    if (!src || fy < prev.from || fy > prev.to) continue;
    const before = prev.counts[key]?.[0] ?? 0;
    if (n > before) out.push({ src, fy, more: n - before, n, cents });
  }
  return out.sort((a, b) => b.fy - a.fy || SOURCE_NUMBER[a.src] - SOURCE_NUMBER[b.src]);
}

// -- reading the records database ---------------------------------------------------------------

// Why the records kinds wait: no binding, a load under way or never
// finished, a statement that failed, or a database whose data date is not
// the run's (its sync did not finish tonight).
export type RecordsWait = "absent" | "loading" | "failed" | "stale";

export type CountsRead =
  | { state: "ready"; mark: Mark; name: { en: string | null; fr: string | null } | null }
  | { state: RecordsWait };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

// The entity's counts for the MAX_YEARS fiscal years ending with the data
// date's, as a mark ready to keep, and its name. Nothing here throws.
export async function readCounts(env: Env, entity: Entity, dataDate: string): Promise<CountsRead> {
  const db = env.RECORDS;
  if (!db) return { state: "absent" };
  const to = fiscalYearOf(dataDate);
  const from = to - MAX_YEARS + 1;
  const name = NAME_SQL[entity.kind];
  let results: D1Result<Record<string, unknown>>[];
  try {
    results = await db.batch<Record<string, unknown>>([
      db.prepare(STATE_SQL),
      db.prepare(COUNTS_SQL[entity.kind]).bind(entity.key, from, to),
      ...(name ? [db.prepare(name).bind(entity.key)] : []),
    ]);
  } catch (e) {
    console.error(`[deliveries] records: query failed (${faultSummary(e)})`);
    return { state: "failed" };
  }
  const meta = new Map((results[0]?.results ?? []).map((r) => [String(r.key), String(r.value)]));
  if (meta.get("state") !== "ready") return { state: "loading" };
  const asOf = meta.get("as_of") ?? "";
  if (asOf !== dataDate) return { state: "stale" };
  const counts: Counts = {};
  for (const r of results[1]?.results ?? []) {
    const src = Number(r.src);
    const fy = Number(r.fy);
    const n = Number(r.n);
    if (!SOURCE_OF_NUMBER.has(src) || !Number.isInteger(fy) || !isCount(n) || n === 0) continue;
    counts[`${src}:${fy}`] = [n, isCents(r.cents) ? r.cents : null];
  }
  const row = name ? results[2]?.results?.[0] : undefined;
  const names = row ? { en: str(row.name ?? row.name_en), fr: str(row.name_fr) } : null;
  return { state: "ready", mark: { asOf, rules: meta.get("rules") ?? null, from, to, counts }, name: names };
}

// -- the marks in the accounts database ------------------------------------------------------------

export const MARK_READ_SQL = "SELECT as_of, counts FROM delivery_marks WHERE search_id = ?";

// Written in the batch that records a delivery sent or empty, and only while
// the search exists, so a search deleted during the run leaves no mark.
export const MARK_WRITE_SQL =
  "INSERT INTO delivery_marks (search_id, as_of, counts, updated_at) SELECT ?1, ?2, ?3, ?4 " +
  "WHERE EXISTS (SELECT 1 FROM saved_searches WHERE id = ?1) " +
  "ON CONFLICT (search_id) DO UPDATE SET as_of = excluded.as_of, counts = excluded.counts, updated_at = excluded.updated_at";

// The search's mark; null when it has none (or none that reads). Throws on a
// database fault, a missing table included: the caller tells the two apart.
export async function loadMark(env: Env, searchId: string): Promise<Mark | null> {
  const row = await env.ACCOUNTS!.prepare(MARK_READ_SQL).bind(searchId).first<{ as_of: string; counts: string }>();
  return row ? readMark(row.as_of, row.counts) : null;
}

export const missingTable = (e: unknown): boolean => /no such table/i.test(String((e as { message?: unknown })?.message ?? e));
