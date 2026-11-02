// Hosted search: the queries behind /search, over the D1 database the nightly
// sync fills (binding SEARCH, schema in pipeline/search_schema.sql, written by
// pipeline/awardwatch_pipeline/search_db.py; docs/hosted-search.md). The same
// design as the operator's other site.
//
// No SQL injection, and no query syntax from the visitor:
//
// - Every statement is a constant in this file, prepared with ? placeholders;
//   the visitor's text reaches D1 only as bound values, and only after
//   searchTerms has folded it. Nothing a request holds is ever written into
//   the SQL text.
// - Text never reaches MATCH as typed. searchTerms folds it the way the
//   pipeline folds names (lower case, accents removed, every run of
//   characters that are neither letters nor digits made one space), keeps
//   the first MAX_TERMS words, and drops any word that is not letters and
//   digits alone. ftsExpression writes each word as a double-quoted FTS5
//   phrase, the last with a prefix star, so AND, OR, NOT and NEAR are plain
//   words, and quotes, parentheses, colons (column filters), stars, carets
//   and minus signs cannot survive the fold. The only column filters are the
//   two written here.
// - A page is PAGE_SIZE rows at an offset of at most (MAX_PAGE - 1) pages,
//   the page number read as an integer.
//
// Ranking: a match on the name itself first, then a match through another
// spelling or a business number; within each, more records first, then by
// name. The match is a tier: 0 the display name (for a buyer, either name or
// an acronym) is the query; 1 it starts with the query as whole words; 2 it
// starts with the query; 3 every word is in the name; 4 the match is through
// another spelling or a business number. Tiers 0 to 3 rank alike, since every
// word matches as a prefix in each: "IBM Canada Ltd." with 4,172 records
// comes before "IBM" with 22.
//
// What a request reads: the full-text index lists every match once per
// statement (the count, the page and the name tier), so a word in many names
// ("canada", "inc") reads tens of thousands of index rows. The page sorts the
// matches it reads; no offset reads more than that.

import type { Env } from "./env";

export const PAGE_SIZE = 50;
export const BUYER_ROWS = 50;
export const MAX_Q = 200;
export const MAX_TERMS = 8;
export const MAX_PAGE = 200;

// -- text ----------------------------------------------------------------------

// search_db.fold in the pipeline does the same to every name it indexes.
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const WORD = /^[\p{L}\p{N}]+$/u;

export interface SearchTerms {
  // The query's words, folded: letters and digits only, at most MAX_TERMS.
  terms: string[];
  // The words joined by single spaces, as a name's folded form is written.
  folded: string;
}

export function searchTerms(raw: string): SearchTerms {
  const terms = foldText(raw.slice(0, MAX_Q))
    .split(" ")
    .filter((w) => WORD.test(w))
    .slice(0, MAX_TERMS);
  return { terms, folded: terms.join(" ") };
}

// The words as an FTS5 expression: quoted phrases joined by spaces (an
// implicit AND). The last word gets a prefix star ("tim"* finds Tim and
// Timbers) unless it is one character: a one-letter prefix makes FTS5 merge
// the list of every word starting with that letter, which costs far more
// than a reader gains. filter, when given, is one of COLUMN_FILTERS, never
// anything from the request. "" when there is no word.
export function ftsExpression(terms: readonly string[], filter: ColumnFilter | null = null): string {
  const out: string[] = [];
  terms.forEach((term, i) => {
    if (!WORD.test(term)) return;
    const phrase = i === terms.length - 1 && [...term].length > 1 ? `"${term}"*` : `"${term}"`;
    out.push(filter ? `${filter} : ${phrase}` : phrase);
  });
  return out.join(" ");
}

// The name columns of each index, for tier 3.
export const COLUMN_FILTERS = { orgs: "name", buyers: "{name name_fr}" } as const;
export type ColumnFilter = (typeof COLUMN_FILTERS)[keyof typeof COLUMN_FILTERS];

// Whether a line of text holds every word, the last as a prefix when the
// expression gave it a star: the full-text match, applied to one spelling so
// the page can say which one matched.
export function lineMatches(line: string, terms: readonly string[]): boolean {
  const words = foldText(line).split(" ").filter(Boolean);
  return terms.length > 0 && terms.every((term, i) => {
    const prefix = i === terms.length - 1 && [...term].length > 1;
    return words.some((w) => (prefix ? w.startsWith(term) : w === term));
  });
}

// -- statements ------------------------------------------------------------------

// The patterns tiers 0 to 2 look for in "\n" + folds + "\n" (folds holds one
// folded name per line).
function tierPatterns(folded: string): [string, string, string] {
  return [`\n${folded}\n`, `\n${folded} `, `\n${folded}`];
}

export const ORG_COUNT_SQL = "SELECT COUNT(*) AS n FROM search_orgs_fts WHERE search_orgs_fts MATCH ?";
export const BUYER_COUNT_SQL = "SELECT COUNT(*) AS n FROM search_buyers_fts WHERE search_buyers_fts MATCH ?";

const TIER = (alias: string, fts: string) =>
  `CASE WHEN instr(char(10) || ${alias}.folds || char(10), ?) > 0 THEN 0 ` +
  `WHEN instr(char(10) || ${alias}.folds || char(10), ?) > 0 THEN 1 ` +
  `WHEN instr(char(10) || ${alias}.folds || char(10), ?) > 0 THEN 2 ` +
  `WHEN ${alias}.rid IN (SELECT rowid FROM ${fts} WHERE ${fts} MATCH ?) THEN 3 ELSE 4 END AS tier`;

// Bound in order: the three tier patterns, the name-column expression, the
// whole expression, the row limit and the offset.
export const ORG_SELECT_SQL =
  "SELECT o.id, o.name, o.alt, o.bn, o.prov, o.city, o.n_awards, o.n_history, o.n_contracts, o.n_grants, o.n_lobbying, " +
  "o.n_records, o.total_awards, o.total_history, o.total_contracts, o.total_grants, " +
  TIER("o", "search_orgs_fts") +
  " FROM search_orgs AS o WHERE o.rid IN (SELECT rowid FROM search_orgs_fts WHERE search_orgs_fts MATCH ?)" +
  " ORDER BY tier = 4, o.n_records DESC, o.folds, o.id LIMIT ? OFFSET ?";

export const BUYER_SELECT_SQL =
  "SELECT b.id, b.name, b.name_fr, b.acronym_en, b.acronym_fr, b.alt, b.n_tenders, b.n_open_tenders, b.n_awards, " +
  "b.n_history, b.n_contracts, b.n_grants, b.n_records, b.total_awards, b.total_history, b.total_contracts, b.total_grants, " +
  TIER("b", "search_buyers_fts") +
  " FROM search_buyers AS b WHERE b.rid IN (SELECT rowid FROM search_buyers_fts WHERE search_buyers_fts MATCH ?)" +
  " ORDER BY tier = 4, b.n_records DESC, b.folds, b.id LIMIT ? OFFSET ?";

// One row read: whether the table holds anything, to tell an empty database
// (the first night, or a full reload under way) from a query nothing matches.
export const ANY_ROW_SQL = "SELECT EXISTS (SELECT 1 FROM search_orgs) AS n";

export interface Statement {
  sql: string;
  params: (string | number)[];
}

export function orgSelect(t: SearchTerms, page: number): Statement {
  const p = Math.min(Math.max(1, Math.trunc(page) || 1), MAX_PAGE);
  return {
    sql: ORG_SELECT_SQL,
    params: [...tierPatterns(t.folded), ftsExpression(t.terms, COLUMN_FILTERS.orgs), ftsExpression(t.terms), PAGE_SIZE,
      (p - 1) * PAGE_SIZE],
  };
}

export function buyerSelect(t: SearchTerms): Statement {
  return {
    sql: BUYER_SELECT_SQL,
    params: [...tierPatterns(t.folded), ftsExpression(t.terms, COLUMN_FILTERS.buyers), ftsExpression(t.terms), BUYER_ROWS, 0],
  };
}

export function counts(t: SearchTerms): Statement[] {
  const expr = ftsExpression(t.terms);
  return [{ sql: ORG_COUNT_SQL, params: [expr] }, { sql: BUYER_COUNT_SQL, params: [expr] }];
}

// -- rows -------------------------------------------------------------------------

export interface Figures {
  n_awards: number;
  n_history: number;
  n_contracts: number;
  n_grants: number;
  n_records: number;
  total_awards: number | null;
  total_history: number | null;
  total_contracts: number | null;
  total_grants: number | null;
}

export interface OrgHit extends Figures {
  id: string;
  name: string;
  prov: string;
  city: string | null;
  n_lobbying: number;
  tier: number;
  // The other spelling that holds every word, when the match came through one.
  also: string | null;
  // The business number the query named, when the match came through one.
  bn: string | null;
}

export interface BuyerHit extends Figures {
  id: string;
  name: string;
  name_fr: string | null;
  acronym_en: string | null;
  acronym_fr: string | null;
  n_tenders: number;
  n_open_tenders: number;
  tier: number;
  also: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);
const money = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function figures(r: Record<string, unknown>): Figures {
  return {
    n_awards: count(r.n_awards), n_history: count(r.n_history), n_contracts: count(r.n_contracts), n_grants: count(r.n_grants),
    n_records: count(r.n_records), total_awards: money(r.total_awards), total_history: money(r.total_history),
    total_contracts: money(r.total_contracts), total_grants: money(r.total_grants),
  };
}

// Up to tier 3 the name itself matched, so no other spelling is named.
function alsoOf(alt: unknown, tier: number, terms: readonly string[]): string | null {
  if (tier < 4) return null;
  return str(alt).split("\n").find((line) => line && lineMatches(line, terms)) ?? null;
}

export function toOrgHit(r: Record<string, unknown>, terms: readonly string[]): OrgHit {
  const tier = count(r.tier);
  const also = alsoOf(r.alt, tier, terms);
  const bn = tier === 4 && !also ? str(r.bn).split(" ").find((n) => n && lineMatches(n, terms)) ?? null : null;
  return {
    id: str(r.id), name: str(r.name), prov: str(r.prov) || "UN", city: strOrNull(r.city), n_lobbying: count(r.n_lobbying),
    tier, also, bn, ...figures(r),
  };
}

export function toBuyerHit(r: Record<string, unknown>, terms: readonly string[]): BuyerHit {
  const tier = count(r.tier);
  return {
    id: str(r.id), name: str(r.name), name_fr: strOrNull(r.name_fr), acronym_en: strOrNull(r.acronym_en),
    acronym_fr: strOrNull(r.acronym_fr), n_tenders: count(r.n_tenders), n_open_tenders: count(r.n_open_tenders), tier,
    also: alsoOf(r.alt, tier, terms), ...figures(r),
  };
}

// -- running ------------------------------------------------------------------------

export interface SearchResult {
  orgs: OrgHit[];
  orgTotal: number;
  buyers: BuyerHit[];
  buyerTotal: number;
  // The page shown (a page past the last match shows the last page) and the
  // number of pages of organizations.
  page: number;
  pages: number;
}

// What a failure is, in words that cannot carry a request value: a D1 or
// SQLite code and a few fixed phrases. An FTS5 error quotes the expression,
// which is built from the visitor's text, so its message is never logged.
const KNOWN_FAULTS = ["no such table", "no such column", "syntax error", "malformed", "too many", "interrupted", "timeout",
  "locked", "overloaded", "reset"];

export function faultSummary(e: unknown): string {
  const s = String(e);
  const code = /SQLITE_[A-Z_]+/.exec(s)?.[0] ?? /D1_[A-Z_]+/.exec(s)?.[0] ?? "no code";
  const phrase = KNOWN_FAULTS.find((k) => s.toLowerCase().includes(k)) ?? "other";
  return `${code}, ${phrase}`;
}

const prepare = (db: D1Database, s: Statement) => db.prepare(s.sql).bind(...s.params);
const firstCount = (r: D1Result<Record<string, unknown>> | undefined): number => count(r?.results?.[0]?.n);

// The search, or null when there is no database, a query failed, or the
// database holds no row yet (the page then explains and links the
// directory). terms must hold at least one word.
export async function runSearch(env: Env, t: SearchTerms, page: number): Promise<SearchResult | null> {
  const db = env.SEARCH;
  if (!db || !t.terms.length) return null;
  const wanted = Math.min(Math.max(1, Math.trunc(page) || 1), MAX_PAGE);
  try {
    // One round trip: both counts, the page of organizations and, on the
    // first page, the buyers (a short list, shown on the first page only).
    const stmts = [...counts(t), orgSelect(t, wanted), ...(wanted === 1 ? [buyerSelect(t)] : [])];
    const res = await db.batch<Record<string, unknown>>(stmts.map((s) => prepare(db, s)));
    const orgTotal = firstCount(res[0]);
    const buyerTotal = firstCount(res[1]);
    let rows = res[2]?.results ?? [];
    let buyerRows = wanted === 1 ? res[3]?.results ?? [] : [];
    const pages = Math.max(1, Math.min(Math.ceil(orgTotal / PAGE_SIZE), MAX_PAGE));
    // A page past the last (an old link, a hand-edited number) shows the last.
    const shown = Math.min(wanted, pages);
    if (shown !== wanted && orgTotal + buyerTotal > 0) {
      const again = [orgSelect(t, shown), ...(shown === 1 ? [buyerSelect(t)] : [])];
      const res2 = await db.batch<Record<string, unknown>>(again.map((s) => prepare(db, s)));
      rows = res2[0]?.results ?? [];
      buyerRows = shown === 1 ? res2[1]?.results ?? [] : [];
    }
    if (orgTotal + buyerTotal === 0) {
      const any = await prepare(db, { sql: ANY_ROW_SQL, params: [] }).first<Record<string, unknown>>();
      if (!count(any?.n)) return null;
    }
    return {
      orgs: rows.map((r) => toOrgHit(r, t.terms)),
      orgTotal,
      buyers: buyerRows.map((r) => toBuyerHit(r, t.terms)),
      buyerTotal,
      page: shown,
      pages,
    };
  } catch (e) {
    console.error(`search: query failed (${faultSummary(e)})`);
    return null;
  }
}
