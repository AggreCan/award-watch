// The site's data is a set of JSON files the pipeline writes and the deploy
// ships as static assets under /data/ (CLAUDE.md "Static export layout").
// The Worker reads them through the assets binding; nothing here touches a
// database. Every loader checks the fields its pages render and answers
// null for a file that is missing, unreadable or the wrong shape, so a page
// says "not published" or "not found", never a server error.

import { DIRECTORY_CODES, MONEY_SOURCES, SEGMENTS, SOURCES, type MoneySource, type SourceKey } from "./constants";
import type { Env } from "./env";
import { isBool, isListOf, isNum, isNumOrNull, isObj, isStr, isStrOrNull, optional } from "./valid";

// -- ids in URLs ------------------------------------------------------------------

export const ORG_ID_RE = /^org-[0-9a-f]{10}$/;
export const BUYER_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Tender and award references as published: cb-418-22395949, PW-$$XL-123...
// arrive with the dollar signs stripped by the pipeline; anything else is
// not a reference and never reaches a file name.
export const REFERENCE_RE = /^[A-Za-z0-9._-]{1,80}$/;
export const SEGMENT_RE = /^[0-9]{2}$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const YEAR_RE = /^\d{4}$/;

// -- row shapes -----------------------------------------------------------------------

// 1 or true competitive, 0 or false non-competitive, null when the source does
// not say (CLAUDE.md "Counting money"). The schema stores the integer; either
// form reads the same.
export type Competitive = boolean | 0 | 1 | null;

export function competitiveOf(v: Competitive | undefined): boolean | null {
  return v === true || v === 1 ? true : v === false || v === 0 ? false : null;
}

// One open (or newly published) notice, list fields only.
export interface TenderRow {
  reference: string;
  amendment: number;
  title_en: string | null;
  title_fr: string | null;
  buyer_id: string | null;
  buyer_en: string | null;
  buyer_fr: string | null;
  published: string | null;
  closing: string | null; // ISO date and time as published, local to the buyer, no zone
  category: string[];
  notice_type_en: string | null;
  notice_type_fr: string | null;
  method_en: string | null;
  method_fr: string | null;
  segments: string[];
  provinces: string[];
  first_seen: string;
  // Present on rows of tenders/new/<day>.json, where a notice may already be closed.
  status?: string;
}

// One award notice or contract history row as a list row. On contract
// history rows the buyer is the client department (the end user); the
// contracting entity is always Public Services and Procurement Canada.
export interface AwardRow {
  reference: string;
  title_en: string | null;
  title_fr: string | null;
  organization_id: string | null;
  organization: string | null;
  buyer_id: string | null;
  buyer_en: string | null;
  buyer_fr: string | null;
  awarded: string | null;
  value: number | null; // by the counting rules: total value on the newest amendment, else its amount
  currency: string | null;
  competitive: Competitive;
  instrument_en: string | null;
  instrument_fr: string | null;
  segments: string[];
  provinces: string[];
  status?: string;
}

// One row of the proactive publication of contracts over $10,000.
export interface ContractRow {
  owner_org: string;
  reference: string;
  procurement_id: string | null;
  buyer_id: string | null;
  buyer_en: string | null;
  buyer_fr: string | null;
  contract_date: string | null;
  value: number | null; // the row's own value by the counting rules
  // The largest contract_value among the rows sharing this procurement_id,
  // when there are several; shown beside the row, never added.
  value_last_reported?: number | null;
  description_en: string | null;
  description_fr: string | null;
  competitive: Competitive;
  solicitation_procedure: string | null;
  instrument_type: string | null;
  reporting_period: string | null;
}

// One grant or contribution agreement, at its highest amendment.
export interface GrantRow {
  owner_org: string;
  reference: string;
  amendment: number;
  buyer_id: string | null;
  buyer_en: string | null;
  buyer_fr: string | null;
  agreement_type: string | null; // G grant, C contribution, O other
  program_en: string | null;
  program_fr: string | null;
  title_en: string | null;
  title_fr: string | null;
  value: number | null;
  start: string | null;
  end: string | null;
}

// One communication report from the Registry of Lobbyists. Designated public
// office holders are named in their public role, as the registry publishes them.
export interface LobbyRow {
  comm_number: string;
  comm_date: string | null;
  registrant: string | null;
  subject_matters: string[];
  institutions: string[];
  dpoh: { name: string; title: string | null; institution: string | null }[];
}

// An organization's total in one source (rankings, buyer and category pages).
export interface OrgTotal {
  id: string;
  name: string;
  n: number;
  total: number | null;
  province?: string | null;
}

export interface YearFigure {
  year: number;
  source: MoneySource;
  n: number;
  total: number | null;
  // Null for grants, which have no competitive flag.
  n_non_competitive: number | null;
  total_non_competitive: number | null;
}

export interface Citation {
  title: string;
  concept_doi: string;
  doi: string | null;
  version: string | null;
  published: string | null;
}

// A facet of the open notices: a value and how many open notices carry it.
// Buyers, notice types and methods carry their name in both languages; the
// value of a notice type or method is its English text, as the filters use it.
export interface FacetCount {
  value: string;
  n: number;
  en?: string | null;
  fr?: string | null;
}

export const FACETS = ["category", "segment", "province", "buyer", "notice_type", "method"] as const;
export type FacetName = (typeof FACETS)[number];

// tenders/open-first.json: the first 50 open notices by closing date, the
// number of open notices, and the facet counts over all of them. The /tenders
// page renders from it; the full list (tenders/open.json) is read by the
// browser alone, so the Worker never parses it.
export interface OpenFirst {
  total: number;
  rows: TenderRow[];
  facets: Record<FacetName, FacetCount[]>;
}

// awards/<year>/index.json: how many pages of award rows the year has (500 to
// a page, newest award date first) and how many rows in all.
export interface AwardYear {
  year: number;
  pages: number;
  rows: number;
}

export interface Stats {
  data_as_of: string | null;
  counts: Partial<Record<
    "organizations" | "buyers" | "tenders_open" | "tenders_new_today" | "awards" | "history" | "contracts" | "grants" | "lobbying",
    number
  >>;
  new_tenders: TenderRow[];
  closing_soon: TenderRow[];
  recent_awards: AwardRow[];
  top_organizations_year: OrgTotal[];
  runs: { run_at: string; source: string; detail: string | null; rows_new: number | null; ok: number | boolean }[];
  sources: { source: string; file: string; last_read: string | null; last_modified: string | null }[];
  // A Zenodo record of the open files, when one is published; absent until then.
  citation?: Citation | null;
}

export interface CodeRow { code: string; desc_en: string | null; desc_fr: string | null }

export interface TenderVersion {
  amendment: number;
  published: string | null;
  amended: string | null;
  closing: string | null;
  status: string | null;
  title_en: string | null;
  title_fr: string | null;
  first_seen: string;
}

export interface RelatedAward {
  reference: string;
  title_en: string | null;
  title_fr: string | null;
  organization_id: string | null;
  organization: string | null;
  awarded: string | null;
  value: number | null;
  currency: string | null;
}

// A notice as it stands (its newest amendment), every exported column. The
// contact fields are never exported; the page links to CanadaBuys for them.
export interface TenderDetail {
  reference: string;
  amendment: number;
  solicitation: string | null;
  title_en: string | null;
  title_fr: string | null;
  published: string | null;
  closing: string | null;
  amended: string | null;
  start_expected: string | null;
  end_expected: string | null;
  status: string;
  gsin: string | null;
  gsin_desc_en: string | null;
  gsin_desc_fr: string | null;
  category: string[];
  notice_type_en: string | null;
  notice_type_fr: string | null;
  method_en: string | null;
  method_fr: string | null;
  selection_en: string | null;
  selection_fr: string | null;
  limited_reason_en: string | null;
  limited_reason_fr: string | null;
  trade_agreements_en: string[] | null;
  trade_agreements_fr: string[] | null;
  regions_opportunity_en: string[] | null;
  regions_opportunity_fr: string[] | null;
  regions_delivery_en: string[] | null;
  regions_delivery_fr: string[] | null;
  provinces: string[];
  buyer_id: string | null;
  buyer_en: string | null;
  buyer_fr: string | null;
  end_users_en: string[] | null;
  end_users_fr: string[] | null;
  description_en: string | null;
  description_fr: string | null;
  source_file: string;
  first_seen: string;
  last_seen: string;
  codes: CodeRow[];
  amendments: TenderVersion[];
  related_awards: RelatedAward[];
}

export interface ContractVersion {
  amendment: number;
  amended: string | null;
  amount: number | null;
  total_value: number | null;
  status: string | null;
  amendment_type_en: string | null;
  amendment_type_fr: string | null;
}

// An award notice ("award:<reference>") or a contract history record
// ("history:<reference>"), at its newest amendment.
export interface ContractDetail {
  kind: "award" | "history";
  reference: string;
  amendment: number;
  solicitation: string | null;
  contract_number: string | null;
  procurement_number?: string | null;
  title_en: string | null;
  title_fr: string | null;
  published: string | null;
  awarded: string | null;
  amended: string | null;
  start: string | null;
  end: string | null;
  amount: number | null;
  total_value: number | null;
  value: number | null; // by the counting rules
  currency: string | null;
  status: string;
  instrument_type_en: string | null;
  instrument_type_fr: string | null;
  amendment_type_en: string | null;
  amendment_type_fr: string | null;
  gsin: string | null;
  gsin_desc_en: string | null;
  gsin_desc_fr: string | null;
  category: string[];
  notice_type_en: string | null;
  notice_type_fr: string | null;
  method_en: string | null;
  method_fr: string | null;
  competitive: Competitive;
  selection_en: string | null;
  selection_fr: string | null;
  limited_reason_en: string | null;
  limited_reason_fr: string | null;
  trade_agreements_en: string[] | null;
  trade_agreements_fr: string[] | null;
  regions_delivery_en: string[] | null;
  regions_delivery_fr: string[] | null;
  provinces: string[];
  organization_id: string | null;
  supplier: string | null;
  supplier_operating?: string | null;
  supplier_city: string | null;
  supplier_province: string | null;
  supplier_country: string | null;
  buyer_id: string | null;
  buyer_en: string | null;
  buyer_fr: string | null;
  // Contract history: the client department the contract was awarded for.
  client_id?: string | null;
  client_en?: string | null;
  client_fr?: string | null;
  end_users_en?: string[] | null;
  end_users_fr?: string[] | null;
  description_en: string | null;
  description_fr: string | null;
  source_file: string;
  first_seen: string;
  last_seen: string;
  codes: CodeRow[];
  amendments: ContractVersion[];
  // The tender notice with the same solicitation number, when there is one.
  tender_reference?: string | null;
}

export interface OrganizationRow {
  id: string;
  display_name: string;
  country: string | null;
  province: string | null;
  city: string | null;
  business_number: string | null;
  first_seen: string | null;
  last_seen: string | null;
  n_awards: number;
  n_history: number;
  n_contracts: number;
  n_grants: number;
  n_lobbying: number;
  total_awards: number | null;
  total_history: number | null;
  total_contracts: number | null;
  total_grants: number | null;
}

export interface Profile {
  organization: OrganizationRow;
  names: { name: string; source: string; n: number }[];
  places: { country: string | null; province: string | null; city: string | null; n: number }[];
  // The number of distinct places behind the ten listed; absent means the list is whole.
  places_total_rows?: number;
  registry: {
    registry: string; registry_id: string; legal_name: string | null; entity_type: string | null; status: string | null;
    registered_on: string | null; grade: string; checked_at: string;
  }[];
  years: YearFigure[];
  awards: AwardRow[];
  awards_total_rows: number;
  history: AwardRow[];
  history_total_rows: number;
  contracts: ContractRow[];
  contracts_total_rows: number;
  grants: GrantRow[];
  grants_total_rows: number;
  lobbying: LobbyRow[];
  lobbying_total_rows: number;
  buyers: { source: MoneySource; buyer_id: string; buyer_en: string | null; buyer_fr: string | null; n: number; total: number | null }[];
  // Rows left out of the totals because their currency is not CAD, per source.
  non_cad?: Partial<Record<MoneySource, number>>;
}

export interface DirectorySummary { code: string; organizations: number; pages: number }
export interface DirectoryIndex { directories: DirectorySummary[] }
export interface DirectoryPart {
  code: string; organizations: number; pages: number; page_size: number;
  ranges: [string, string][]; letters: [string, number][]; updated: string | null;
}
export interface DirectoryRow { id: string; name: string; city: string | null; n_records: number; last_seen: string | null }
export interface DirectoryPage { code: string; page: number; rows: DirectoryRow[] }

export interface BuyerSummary {
  id: string;
  name_en: string;
  name_fr: string | null;
  acronym_en: string | null;
  acronym_fr: string | null;
  kind: string | null;
  n_tenders: number;
  n_open_tenders?: number;
  n_awards: number;
  n_history: number;
  n_contracts: number;
  n_grants: number;
  total_awards: number | null;
  total_history?: number | null;
  total_contracts: number | null;
  total_grants: number | null;
}
export interface BuyerIndex { buyers: BuyerSummary[] }
export interface BuyerYear extends YearFigure { n_organizations: number | null }
export interface Buyer {
  buyer: BuyerSummary & { ckan_org: string | null; department_number: string | null };
  years: BuyerYear[];
  top_organizations: Partial<Record<MoneySource, OrgTotal[]>>;
  open_tenders: number;
  recent_awards: AwardRow[];
}

export interface CategorySummary {
  code: string;
  title_en: string;
  title_fr: string;
  open_tenders: number;
  awards_year_n: number;
  awards_year_total: number | null;
  awards_n: number;
  awards_total: number | null;
}
export interface CategoryIndex { year: number; segments: CategorySummary[] }
export interface Category {
  code: string;
  title_en: string;
  title_fr: string;
  open_tenders: TenderRow[];
  top_organizations: OrgTotal[];
  years: { year: number; n: number; total: number | null }[];
}

export interface BuyerRank { id: string; name_en: string; name_fr: string | null; n: number; total: number | null }
export interface Rankings {
  year: number | null; // null for rankings/all.json
  years: number[];
  sources: Partial<Record<SourceKey, { by_value: OrgTotal[]; by_count: OrgTotal[] }>>;
  buyers: Partial<Record<MoneySource, BuyerRank[]>>;
}

// -- reading files ---------------------------------------------------------------------

export async function assetResponse(env: Env, path: string): Promise<Response | null> {
  if (!env.ASSETS) return null;
  try {
    const res = await env.ASSETS.fetch(new Request(`https://assets.invalid/data/${path}`));
    return res.ok ? res : null;
  } catch (e) {
    console.error(`asset ${path}: ${String(e).slice(0, 200)}`);
    return null;
  }
}

// Parsed files are kept for the life of the isolate and shared by every
// request it serves, so a crawler walking pages that read the same file pays
// for parsing it once. Each read still fetches the asset and compares its
// ETag with the kept one: the assets layer gives a file a new ETag whenever
// its content changes, and a deploy ships changed files, so a stale value is
// never served and no expiry time is needed. A response without an ETag is
// parsed and not kept.
//
// Memory: a detail shard is a few hundred KB, and parsed JSON measured about
// 1.35 times its text in V8. Entries are capped at 2 MB of text and the
// whole cache at 24 MB of text (about 32 MB of heap), well inside the
// isolate's 128 MB whatever the files become. A file past the entry cap
// still loads; it is parsed on every read. Sizes are the text's length,
// known for every response (the assets binding in the test runtime sends no
// Content-Length).
const CACHE_MAX_ENTRIES = 64;
const CACHE_MAX_ENTRY_CHARS = 2 * 1024 * 1024;
const CACHE_MAX_TOTAL_CHARS = 24 * 1024 * 1024;

interface Parsed {
  etag: string;
  value: unknown;
  chars: number;
}

// A Map iterates in insertion order, and a hit is moved to the end, so the
// first key is always the least recently used.
const parsed = new Map<string, Parsed>();
let parsedChars = 0;

function forget(path: string): void {
  const old = parsed.get(path);
  if (!old) return;
  parsed.delete(path);
  parsedChars -= old.chars;
}

function keep(path: string, entry: Parsed): void {
  forget(path);
  parsed.set(path, entry);
  parsedChars += entry.chars;
  for (const [oldest, e] of parsed) {
    if (parsed.size <= CACHE_MAX_ENTRIES && parsedChars <= CACHE_MAX_TOTAL_CHARS) break;
    parsed.delete(oldest);
    parsedChars -= e.chars;
  }
}

// For the tests: the cache starts empty in each one that asks.
export function clearParsedCache(): void {
  parsed.clear();
  parsedChars = 0;
}

// A kept value is shared between requests, so it is frozen all the way down:
// a page that changed it in place would change it for every later request,
// and in strict mode (every module is) the attempt throws instead. Every
// loaded value is frozen, kept or not, so a page behaves the same either way
// and the tests, whose fake files often carry no ETag, see what production
// sees. A parsed file is a tree, so no node is visited twice.
function deepFreeze<T>(root: T): T {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const v = stack.pop() as object;
    Object.freeze(v);
    for (const child of Object.values(v)) if (typeof child === "object" && child !== null) stack.push(child);
  }
  return root;
}

// A file that does not parse (a truncated or corrupt deploy) reads as missing,
// so a page answers "not published" or "not found" instead of an error page.
// The value returned is frozen and may be shared: copy before changing it.
export async function loadJson<T>(env: Env, path: string): Promise<T | null> {
  const res = await assetResponse(env, path);
  if (!res) return null;
  const etag = res.headers.get("etag");
  const hit = etag ? parsed.get(path) : undefined;
  if (hit && hit.etag === etag) {
    parsed.delete(path);
    parsed.set(path, hit);
    await res.body?.cancel().catch(() => undefined);
    return hit.value as T;
  }
  forget(path);
  let text: string;
  let value: unknown;
  try {
    text = await res.text();
    value = JSON.parse(text);
  } catch (e) {
    console.error(`asset ${path} is not valid JSON: ${String(e).slice(0, 200)}`);
    return null;
  }
  if (typeof value === "object" && value !== null) deepFreeze(value);
  if (etag && text.length <= CACHE_MAX_ENTRY_CHARS) keep(path, { etag, value, chars: text.length });
  return value as T;
}

// A kept file is the same frozen object on every hit, so a long list that
// passed its check once (the open notices, about a thousand rows) is not
// checked again on each request while it stays cached.
const checked = new WeakMap<object, Set<string>>();

function checkOnce(value: unknown, name: string, check: (v: unknown) => boolean): boolean {
  if (typeof value !== "object" || value === null) return check(value);
  const done = checked.get(value);
  if (done?.has(name)) return true;
  if (!check(value)) return false;
  if (done) done.add(name);
  else checked.set(value, new Set([name]));
  return true;
}

// -- shards ----------------------------------------------------------------------------

// The detail shards are keyed by the first three hex digits of the SHA-1 of
// the reference. References are matched case-insensitively (they sit in URLs
// in lower case), so the pipeline hashes the lower-cased reference and so
// does this; a reference hashed as published would land in another shard
// whenever it carries a capital.
export async function referenceShard(reference: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(reference.toLowerCase()));
  return [...new Uint8Array(digest).slice(0, 2)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 3);
}

// The entry under key, or under the same key in another case: the pipeline
// keys entries by the reference as published or lower-cased, and either reads.
function entryFor(shard: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(shard, key)) return shard[key];
  const want = key.toLowerCase();
  for (const k of Object.keys(shard)) if (k.toLowerCase() === want) return shard[k];
  return undefined;
}

// -- checks ------------------------------------------------------------------------

const isStrList = (v: unknown): v is string[] => isListOf(v, isStr);
// A bilingual list column (trade agreements, regions, end users) that may be empty.
const isStrListOrNull = (v: unknown): boolean => v === null || v === undefined || isStrList(v);
const isCount = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;
export const isCompetitive = (v: unknown): v is Competitive => v === null || isBool(v) || v === 0 || v === 1;
const isOrgIdOrNull = (v: unknown): boolean => v === null || (isStr(v) && ORG_ID_RE.test(v));
const isBuyerIdOrNull = (v: unknown): boolean => v === null || (isStr(v) && BUYER_ID_RE.test(v));
const isRef = (v: unknown): v is string => isStr(v) && REFERENCE_RE.test(v);
const isMoneySource = (v: unknown): v is MoneySource => (MONEY_SOURCES as readonly unknown[]).includes(v);

export const isTenderRow = (r: unknown): r is TenderRow => isObj(r) && isRef(r.reference) && isNum(r.amendment) &&
  isStrOrNull(r.title_en) && isStrOrNull(r.title_fr) && isBuyerIdOrNull(r.buyer_id) && isStrOrNull(r.buyer_en) &&
  isStrOrNull(r.buyer_fr) && isStrOrNull(r.published) && isStrOrNull(r.closing) && isStrList(r.category) &&
  isStrOrNull(r.notice_type_en) && isStrOrNull(r.notice_type_fr) && isStrOrNull(r.method_en) && isStrOrNull(r.method_fr) &&
  isStrList(r.segments) && isStrList(r.provinces) && isStr(r.first_seen) && optional(r.status, isStr);

export const isAwardRow = (r: unknown): r is AwardRow => isObj(r) && isRef(r.reference) && isStrOrNull(r.title_en) &&
  isStrOrNull(r.title_fr) && isOrgIdOrNull(r.organization_id) && isStrOrNull(r.organization) && isBuyerIdOrNull(r.buyer_id) &&
  isStrOrNull(r.buyer_en) && isStrOrNull(r.buyer_fr) && isStrOrNull(r.awarded) && isNumOrNull(r.value) &&
  isStrOrNull(r.currency) && isCompetitive(r.competitive) && isStrOrNull(r.instrument_en) && isStrOrNull(r.instrument_fr) &&
  isStrList(r.segments) && isStrList(r.provinces) && optional(r.status, isStr);

const isContractRow = (r: unknown): r is ContractRow => isObj(r) && isStr(r.owner_org) && isStr(r.reference) &&
  isStrOrNull(r.procurement_id) && isBuyerIdOrNull(r.buyer_id) && isStrOrNull(r.buyer_en) && isStrOrNull(r.buyer_fr) &&
  isStrOrNull(r.contract_date) && isNumOrNull(r.value) && optional(r.value_last_reported, isNumOrNull) &&
  isStrOrNull(r.description_en) && isStrOrNull(r.description_fr) && isCompetitive(r.competitive) &&
  isStrOrNull(r.solicitation_procedure) && isStrOrNull(r.instrument_type) && isStrOrNull(r.reporting_period);

const isGrantRow = (r: unknown): r is GrantRow => isObj(r) && isStr(r.owner_org) && isStr(r.reference) && isNum(r.amendment) &&
  isBuyerIdOrNull(r.buyer_id) && isStrOrNull(r.buyer_en) && isStrOrNull(r.buyer_fr) && isStrOrNull(r.agreement_type) &&
  isStrOrNull(r.program_en) && isStrOrNull(r.program_fr) && isStrOrNull(r.title_en) && isStrOrNull(r.title_fr) &&
  isNumOrNull(r.value) && isStrOrNull(r.start) && isStrOrNull(r.end);

const isLobbyRow = (r: unknown): r is LobbyRow => isObj(r) && isStr(r.comm_number) && isStrOrNull(r.comm_date) &&
  isStrOrNull(r.registrant) && isStrList(r.subject_matters) && isStrList(r.institutions) &&
  isListOf(r.dpoh, (d) => isObj(d) && isStr(d.name) && isStrOrNull(d.title) && isStrOrNull(d.institution));

// Rendered as a link to the profile, so the id must be an organization id.
export const isOrgTotal = (r: unknown): r is OrgTotal => isObj(r) && isStr(r.id) && ORG_ID_RE.test(r.id) && isStr(r.name) &&
  isCount(r.n) && isNumOrNull(r.total) && optional(r.province, isStrOrNull);

const isYearFigure = (r: unknown): r is YearFigure => isObj(r) && isNum(r.year) && Number.isInteger(r.year) &&
  isMoneySource(r.source) && isCount(r.n) && isNumOrNull(r.total) && isNumOrNull(r.n_non_competitive) &&
  isNumOrNull(r.total_non_competitive);

const isCodeRow = (r: unknown): r is CodeRow => isObj(r) && isStr(r.code) && isStrOrNull(r.desc_en) && isStrOrNull(r.desc_fr);

// -- stats.json ------------------------------------------------------------------

const STAT_LISTS: [keyof Stats, (v: unknown) => boolean][] = [
  ["new_tenders", isTenderRow],
  ["closing_soon", isTenderRow],
  ["recent_awards", isAwardRow],
  ["top_organizations_year", isOrgTotal],
  ["runs", (r) => isObj(r) && isStr(r.run_at) && isStr(r.source) && isStrOrNull(r.detail) && isNumOrNull(r.rows_new) && (isNum(r.ok) || isBool(r.ok))],
  ["sources", (r) => isObj(r) && isStr(r.source) && isStr(r.file) && isStrOrNull(r.last_read) && isStrOrNull(r.last_modified)],
];

// Every page reads the data date from here, so the file is required only to
// be an object with a counts object; a count that is not a number reads as
// absent and a list that does not read as empty, each hiding its own part of
// the home page instead of taking every page down. The loaded file is shared
// and frozen, so the repairs go on a copy.
export async function loadStats(env: Env): Promise<Stats | null> {
  const stats = await loadJson<Record<string, unknown>>(env, "stats.json");
  if (!isObj(stats) || !isObj(stats.counts) || !isStrOrNull(stats.data_as_of)) return null;
  const counts = stats.counts as Record<string, unknown>;
  const badCounts = Object.keys(counts).filter((k) => !isNum(counts[k]));
  const badLists = STAT_LISTS.filter(([k, each]) => !checkOnce(stats[k], `stats.${k}`, (v) => isListOf(v, each))).map(([k]) => k);
  if (badCounts.length === 0 && badLists.length === 0) return stats as unknown as Stats;
  const fixed: Record<string, unknown> = { ...stats, counts: Object.fromEntries(Object.entries(counts).filter(([, v]) => isNum(v))) };
  for (const k of badLists) fixed[k] = [];
  return fixed as unknown as Stats;
}

// -- tenders ------------------------------------------------------------------------

const isFacetCount = (v: unknown): v is FacetCount => isObj(v) && isStr(v.value) && isCount(v.n) &&
  optional(v.en, isStrOrNull) && optional(v.fr, isStrOrNull);

export async function loadOpenFirst(env: Env): Promise<OpenFirst | null> {
  const v = await loadJson<unknown>(env, "tenders/open-first.json");
  const ok = isObj(v) && isCount(v.total) && isListOf(v.rows, isTenderRow) && v.rows.length <= v.total &&
    isObj(v.facets) && FACETS.every((f) => isListOf((v.facets as Record<string, unknown>)[f], isFacetCount));
  return ok ? (v as unknown as OpenFirst) : null;
}

export async function loadNewTenders(env: Env, day: string): Promise<TenderRow[] | null> {
  if (!DAY_RE.test(day)) return null;
  const rows = await loadJson<unknown>(env, `tenders/new/${day}.json`);
  return isListOf(rows, isTenderRow) ? rows : null;
}

const isTenderVersion = (v: unknown): boolean => isObj(v) && isNum(v.amendment) && isStrOrNull(v.published) &&
  isStrOrNull(v.amended) && isStrOrNull(v.closing) && isStrOrNull(v.status) && isStrOrNull(v.title_en) &&
  isStrOrNull(v.title_fr) && isStr(v.first_seen);

const isRelatedAward = (v: unknown): boolean => isObj(v) && isRef(v.reference) && isStrOrNull(v.title_en) &&
  isStrOrNull(v.title_fr) && isOrgIdOrNull(v.organization_id) && isStrOrNull(v.organization) && isStrOrNull(v.awarded) &&
  isNumOrNull(v.value) && isStrOrNull(v.currency);

const BI_TEXT = ["title", "notice_type", "method", "selection", "limited_reason", "description"] as const;
const BI_LISTS = ["trade_agreements", "regions_delivery"] as const;

const isTenderDetail = (v: unknown, reference: string): v is TenderDetail => isObj(v) && isRef(v.reference) &&
  v.reference.toLowerCase() === reference && isNum(v.amendment) && isStrOrNull(v.solicitation) &&
  BI_TEXT.every((k) => isStrOrNull(v[`${k}_en`]) && isStrOrNull(v[`${k}_fr`])) &&
  BI_LISTS.every((k) => isStrListOrNull(v[`${k}_en`]) && isStrListOrNull(v[`${k}_fr`])) &&
  isStrListOrNull(v.regions_opportunity_en) && isStrListOrNull(v.regions_opportunity_fr) &&
  isStrListOrNull(v.end_users_en) && isStrListOrNull(v.end_users_fr) &&
  isStrOrNull(v.published) && isStrOrNull(v.closing) && isStrOrNull(v.amended) && isStrOrNull(v.start_expected) &&
  isStrOrNull(v.end_expected) && isStr(v.status) && isStrOrNull(v.gsin) && isStrOrNull(v.gsin_desc_en) &&
  isStrOrNull(v.gsin_desc_fr) && isStrList(v.category) && isStrList(v.provinces) && isBuyerIdOrNull(v.buyer_id) &&
  isStrOrNull(v.buyer_en) && isStrOrNull(v.buyer_fr) && isStr(v.source_file) && isStr(v.first_seen) && isStr(v.last_seen) &&
  isListOf(v.codes, isCodeRow) && isListOf(v.amendments, isTenderVersion) && isListOf(v.related_awards, isRelatedAward);

// One notice from its shard. The reference is lower-cased for the shard and
// matched in any case inside it; null for a reference that is not one, a
// missing shard, or an entry that does not read.
export async function loadTender(env: Env, reference: string): Promise<TenderDetail | null> {
  if (!REFERENCE_RE.test(reference)) return null;
  const key = reference.toLowerCase();
  const shard = await loadJson<unknown>(env, `tenders/${await referenceShard(key)}.json`);
  if (!isObj(shard)) return null;
  const entry = entryFor(shard, key);
  return isTenderDetail(entry, key) ? entry : null;
}

// -- award notices and contract history -------------------------------------------

const isContractVersion = (v: unknown): boolean => isObj(v) && isNum(v.amendment) && isStrOrNull(v.amended) &&
  isNumOrNull(v.amount) && isNumOrNull(v.total_value) && isStrOrNull(v.status) && isStrOrNull(v.amendment_type_en) &&
  isStrOrNull(v.amendment_type_fr);

const isContractDetail = (v: unknown, kind: "award" | "history", reference: string): v is ContractDetail => isObj(v) &&
  v.kind === kind && isRef(v.reference) && v.reference.toLowerCase() === reference && isNum(v.amendment) &&
  isStrOrNull(v.solicitation) && isStrOrNull(v.contract_number) && optional(v.procurement_number, isStrOrNull) &&
  BI_TEXT.every((k) => isStrOrNull(v[`${k}_en`]) && isStrOrNull(v[`${k}_fr`])) &&
  BI_LISTS.every((k) => isStrListOrNull(v[`${k}_en`]) && isStrListOrNull(v[`${k}_fr`])) &&
  isStrListOrNull(v.end_users_en) && isStrListOrNull(v.end_users_fr) &&
  isStrOrNull(v.published) && isStrOrNull(v.awarded) && isStrOrNull(v.amended) && isStrOrNull(v.start) && isStrOrNull(v.end) &&
  isNumOrNull(v.amount) && isNumOrNull(v.total_value) && isNumOrNull(v.value) && isStrOrNull(v.currency) && isStr(v.status) &&
  isStrOrNull(v.instrument_type_en) && isStrOrNull(v.instrument_type_fr) && isStrOrNull(v.amendment_type_en) &&
  isStrOrNull(v.amendment_type_fr) && isStrOrNull(v.gsin) && isStrOrNull(v.gsin_desc_en) && isStrOrNull(v.gsin_desc_fr) &&
  isStrList(v.category) && isCompetitive(v.competitive) && isStrList(v.provinces) && isOrgIdOrNull(v.organization_id) &&
  isStrOrNull(v.supplier) && optional(v.supplier_operating, isStrOrNull) && isStrOrNull(v.supplier_city) &&
  isStrOrNull(v.supplier_province) && isStrOrNull(v.supplier_country) && isBuyerIdOrNull(v.buyer_id) &&
  isStrOrNull(v.buyer_en) && isStrOrNull(v.buyer_fr) && optional(v.client_id, isBuyerIdOrNull) &&
  optional(v.client_en, isStrOrNull) && optional(v.client_fr, isStrOrNull) && isStr(v.source_file) &&
  isStr(v.first_seen) && isStr(v.last_seen) && isListOf(v.codes, isCodeRow) && isListOf(v.amendments, isContractVersion) &&
  optional(v.tender_reference, (x) => x === null || isRef(x));

// Award notices and contract history rows share one set of shards, keyed
// "award:<reference>" and "history:<reference>".
export async function loadContract(env: Env, kind: "award" | "history", reference: string): Promise<ContractDetail | null> {
  if (!REFERENCE_RE.test(reference)) return null;
  const key = reference.toLowerCase();
  const shard = await loadJson<unknown>(env, `contracts/${await referenceShard(key)}.json`);
  if (!isObj(shard)) return null;
  const entry = entryFor(shard, `${kind}:${key}`);
  return isContractDetail(entry, kind, key) ? entry : null;
}

// awards/recent.json: the 500 newest award notices.
export async function loadRecentAwards(env: Env): Promise<AwardRow[] | null> {
  const rows = await loadJson<unknown>(env, "awards/recent.json");
  return checkOnce(rows, "awards", (v) => isListOf(v, isAwardRow)) ? (rows as AwardRow[]) : null;
}

const isYear = (y: unknown): y is number => isNum(y) && Number.isInteger(y) && y >= 1900 && y <= 2999;

// A year of award notices is paged so no request parses more than one page
// of 500 rows; the index says how many pages there are.
export async function loadAwardYear(env: Env, year: number): Promise<AwardYear | null> {
  if (!isYear(year)) return null;
  const v = await loadJson<unknown>(env, `awards/${year}/index.json`);
  return isObj(v) && v.year === year && isCount(v.pages) && isCount(v.rows) && v.rows >= v.pages ? (v as unknown as AwardYear) : null;
}

// One page of a year: the rows as a list, or an object holding them as
// "rows" (either form reads).
export async function loadAwardPage(env: Env, year: number, n: number): Promise<AwardRow[] | null> {
  if (!isYear(year) || !Number.isInteger(n) || n < 1 || n > 100_000) return null;
  const v = await loadJson<unknown>(env, `awards/${year}/${n}.json`);
  const rows = isObj(v) ? v.rows : v;
  return checkOnce(rows, "awards", (r) => isListOf(r, isAwardRow)) ? (rows as AwardRow[]) : null;
}

// -- organization profiles ----------------------------------------------------------

const ORG_COUNTS = ["n_awards", "n_history", "n_contracts", "n_grants", "n_lobbying"] as const;
const ORG_TOTALS = ["total_awards", "total_history", "total_contracts", "total_grants"] as const;

const isOrganizationRow = (v: unknown, id: string): v is OrganizationRow => isObj(v) && v.id === id &&
  isStr(v.display_name) && isStrOrNull(v.country) && isStrOrNull(v.province) && isStrOrNull(v.city) &&
  isStrOrNull(v.business_number) && isStrOrNull(v.first_seen) && isStrOrNull(v.last_seen) &&
  ORG_COUNTS.every((k) => isCount(v[k])) && ORG_TOTALS.every((k) => isNumOrNull(v[k]));

const PROFILE_LISTS: Record<SourceKey, (v: unknown) => boolean> = {
  awards: isAwardRow,
  history: isAwardRow,
  contracts: isContractRow,
  grants: isGrantRow,
  lobbying: isLobbyRow,
};

const isProfile = (p: unknown, id: string): p is Profile => isObj(p) && isOrganizationRow(p.organization, id) &&
  isListOf(p.names, (n) => isObj(n) && isStr(n.name) && isStr(n.source) && isCount(n.n)) &&
  isListOf(p.places, (n) => isObj(n) && isStrOrNull(n.country) && isStrOrNull(n.province) && isStrOrNull(n.city) && isCount(n.n)) &&
  optional(p.places_total_rows, isCount) &&
  isListOf(p.registry, (r) => isObj(r) && isStr(r.registry) && isStr(r.registry_id) && isStrOrNull(r.legal_name) &&
    isStrOrNull(r.entity_type) && isStrOrNull(r.status) && isStrOrNull(r.registered_on) && isStr(r.grade)) &&
  isListOf(p.years, isYearFigure) &&
  SOURCES.every((s) => isListOf(p[s], PROFILE_LISTS[s]) && isCount(p[`${s}_total_rows`])) &&
  isListOf(p.buyers, (b) => isObj(b) && isMoneySource(b.source) && isStr(b.buyer_id) && BUYER_ID_RE.test(b.buyer_id) &&
    isStrOrNull(b.buyer_en) && isStrOrNull(b.buyer_fr) && isCount(b.n) && isNumOrNull(b.total)) &&
  optional(p.non_cad, (v) => isObj(v) && Object.entries(v).every(([k, n]) => isMoneySource(k) && isCount(n)));

export async function loadProfile(env: Env, id: string): Promise<Profile | null> {
  if (!ORG_ID_RE.test(id)) return null;
  const shard = await loadJson<unknown>(env, `profiles/${id.slice(4, 7)}.json`);
  const profile: unknown = isObj(shard) ? shard[id] : null;
  return isProfile(profile, id) ? profile : null;
}

// The id that took a retired organization id's records (ids move when the
// name rules change), from a shard keyed like the profiles by the old id. A
// missing or unreadable shard, or an entry that is not an organization id,
// reads as no alias. The value goes into a Location header, so it must be an
// id; an entry pointing at itself would redirect forever, so it counts as none.
export async function loadAlias(env: Env, id: string): Promise<string | null> {
  if (!ORG_ID_RE.test(id)) return null;
  const shard = await loadJson<Record<string, unknown>>(env, `aliases/${id.slice(4, 7)}.json`);
  const live: unknown = isObj(shard) ? shard[id] : null;
  return typeof live === "string" && ORG_ID_RE.test(live) && live !== id ? live : null;
}

// -- directory -------------------------------------------------------------------------

export async function loadDirectory(env: Env): Promise<DirectoryIndex | null> {
  const doc = await loadJson<unknown>(env, "directory/index.json");
  if (!isObj(doc) || !isListOf(doc.directories, (d) => isObj(d) && isStr(d.code) && DIRECTORY_CODES.includes(d.code) &&
    isCount(d.organizations) && isCount(d.pages))) return null;
  return doc as unknown as DirectoryIndex;
}

const tuple = (v: unknown, ...checks: ((x: unknown) => boolean)[]): boolean =>
  Array.isArray(v) && v.length === checks.length && checks.every((check, i) => check(v[i]));

export async function loadDirectoryPart(env: Env, code: string): Promise<DirectoryPart | null> {
  if (!DIRECTORY_CODES.includes(code)) return null;
  const v = await loadJson<unknown>(env, `directory/${code}/index.json`);
  if (!isObj(v) || v.code !== code || !isCount(v.organizations) || !isCount(v.pages) || !isCount(v.page_size) ||
    !isStrOrNull(v.updated)) return null;
  const pages = v.pages;
  const ok = isListOf(v.ranges, (r) => tuple(r, isStr, isStr)) && v.ranges.length === pages &&
    isListOf(v.letters, (l) => tuple(l, isStr, (n) => isCount(n) && n >= 1 && n <= pages));
  return ok ? (v as unknown as DirectoryPart) : null;
}

const isDirectoryRow = (v: unknown): v is DirectoryRow => isObj(v) && isStr(v.id) && ORG_ID_RE.test(v.id) && isStr(v.name) &&
  isStrOrNull(v.city) && isCount(v.n_records) && isStrOrNull(v.last_seen);

export async function loadDirectoryPage(env: Env, code: string, n: number): Promise<DirectoryPage | null> {
  if (!DIRECTORY_CODES.includes(code) || !Number.isInteger(n) || n < 1) return null;
  const v = await loadJson<unknown>(env, `directory/${code}/${n}.json`);
  return isObj(v) && v.code === code && v.page === n && isListOf(v.rows, isDirectoryRow) && v.rows.length > 0
    ? (v as unknown as DirectoryPage)
    : null;
}

// -- buyers -----------------------------------------------------------------------------

const isBuyerSummary = (v: unknown): v is BuyerSummary => isObj(v) && isStr(v.id) && BUYER_ID_RE.test(v.id) &&
  isStr(v.name_en) && isStrOrNull(v.name_fr) && isStrOrNull(v.acronym_en) && isStrOrNull(v.acronym_fr) &&
  isStrOrNull(v.kind) && isCount(v.n_tenders) && optional(v.n_open_tenders, isCount) && isCount(v.n_awards) &&
  isCount(v.n_history) && isCount(v.n_contracts) && isCount(v.n_grants) && isNumOrNull(v.total_awards) &&
  optional(v.total_history, isNumOrNull) && isNumOrNull(v.total_contracts) && isNumOrNull(v.total_grants);

export async function loadBuyers(env: Env): Promise<BuyerIndex | null> {
  const doc = await loadJson<unknown>(env, "buyers/index.json");
  return isObj(doc) && checkOnce(doc.buyers, "buyers", (v) => isListOf(v, isBuyerSummary)) ? (doc as unknown as BuyerIndex) : null;
}

export async function loadBuyer(env: Env, id: string): Promise<Buyer | null> {
  if (!BUYER_ID_RE.test(id) || id.length > 80) return null;
  const v = await loadJson<unknown>(env, `buyers/${id}.json`);
  if (!isObj(v) || !isBuyerSummary(v.buyer) || v.buyer.id !== id) return null;
  const b = v.buyer as unknown as Record<string, unknown>;
  const ok = isStrOrNull(b.ckan_org) && isStrOrNull(b.department_number) &&
    isListOf(v.years, (y) => isYearFigure(y) && isNumOrNull((y as unknown as Record<string, unknown>).n_organizations)) &&
    isObj(v.top_organizations) &&
    Object.entries(v.top_organizations).every(([k, rows]) => isMoneySource(k) && isListOf(rows, isOrgTotal)) &&
    isCount(v.open_tenders) && isListOf(v.recent_awards, isAwardRow);
  return ok ? (v as unknown as Buyer) : null;
}

// -- categories (UNSPSC segments) -----------------------------------------------------

const isCategorySummary = (v: unknown): v is CategorySummary => isObj(v) && isStr(v.code) && v.code in SEGMENTS &&
  isStr(v.title_en) && isStr(v.title_fr) && isCount(v.open_tenders) && isCount(v.awards_year_n) &&
  isNumOrNull(v.awards_year_total) && isCount(v.awards_n) && isNumOrNull(v.awards_total);

export async function loadCategories(env: Env): Promise<CategoryIndex | null> {
  const v = await loadJson<unknown>(env, "categories/index.json");
  return isObj(v) && isNum(v.year) && isListOf(v.segments, isCategorySummary) ? (v as unknown as CategoryIndex) : null;
}

export async function loadCategory(env: Env, code: string): Promise<Category | null> {
  if (!SEGMENT_RE.test(code) || !(code in SEGMENTS)) return null;
  const v = await loadJson<unknown>(env, `categories/${code}.json`);
  const ok = isObj(v) && v.code === code && isStr(v.title_en) && isStr(v.title_fr) && isListOf(v.open_tenders, isTenderRow) &&
    isListOf(v.top_organizations, isOrgTotal) &&
    isListOf(v.years, (y) => isObj(y) && isNum(y.year) && isCount(y.n) && isNumOrNull(y.total));
  return ok ? (v as unknown as Category) : null;
}

// -- rankings -----------------------------------------------------------------------------

const isBuyerRank = (v: unknown): v is BuyerRank => isObj(v) && isStr(v.id) && BUYER_ID_RE.test(v.id) && isStr(v.name_en) &&
  isStrOrNull(v.name_fr) && isCount(v.n) && isNumOrNull(v.total);

export async function loadRankings(env: Env, which: number | "all"): Promise<Rankings | null> {
  if (which !== "all" && !(Number.isInteger(which) && which >= 1900 && which <= 2999)) return null;
  const v = await loadJson<unknown>(env, `rankings/${which}.json`);
  if (!isObj(v) || !(which === "all" ? v.year === null : v.year === which)) return null;
  const ok = isListOf(v.years, (y) => isNum(y) && Number.isInteger(y)) && isObj(v.sources) &&
    Object.entries(v.sources).every(([k, s]) => (SOURCES as readonly string[]).includes(k) && isObj(s) &&
      isListOf(s.by_value, isOrgTotal) && isListOf(s.by_count, isOrgTotal)) &&
    isObj(v.buyers) && Object.entries(v.buyers).every(([k, rows]) => isMoneySource(k) && isListOf(rows, isBuyerRank));
  return ok ? (v as unknown as Rankings) : null;
}
