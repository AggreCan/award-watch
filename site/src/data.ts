// The site's data is a set of JSON files the pipeline writes and the deploy
// ships as static assets under /data/ (CLAUDE.md "Static export layout").
// The Worker reads them through the assets binding; nothing here touches a
// database. Every loader checks the fields its pages render and answers
// null for a file that is missing, unreadable or the wrong shape, so a page
// says "not published" or "not found", never a server error.

import { type Clock, clockOf, closingSoonCount } from "./closing";
import { DIRECTORY_CODES, MONEY_SOURCES, PROVINCES, SEGMENTS, SOURCES, type MoneySource, type SourceKey } from "./constants";
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

// Where a record's work is delivered, besides the provinces its regions of
// delivery state (`provinces`): the ones derived from another field
// (pipeline places.py), never one of `provinces`, and the field they come
// from: "delivery" a city the regions of delivery name, "opportunity" a
// notice's regions of opportunity, "land_claims" a published contract's land
// claims agreement area, "dcc_office" the Defence Construction Canada regional
// office that issued a notice. Present only on a row that has some.
export const PLACE_SOURCES = ["delivery", "opportunity", "land_claims", "dcc_office"] as const;
export type PlaceSource = (typeof PLACE_SOURCES)[number];
export interface DerivedPlaces {
  provinces_derived?: string[];
  provinces_from?: PlaceSource;
}
const isPlaceSource = (v: unknown): v is PlaceSource => (PLACE_SOURCES as readonly unknown[]).includes(v);
// Both or neither, as the export writes them.
const isDerivedPlaces = (r: Record<string, unknown>): boolean =>
  r.provinces_derived === undefined ? r.provinces_from === undefined : isStrList(r.provinces_derived) && isPlaceSource(r.provinces_from);

// One open (or newly published) notice, list fields only.
export interface TenderRow extends DerivedPlaces {
  reference: string;
  // The reference as published, when it holds a character a URL path cannot
  // ("/" or ":"); `reference` is then its URL-safe form. Shown on pages and
  // used for the CanadaBuys links; `reference` stays the site's own key.
  reference_published?: string;
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
  // On the rows of tenders/open.json and open-first.json, for the word and
  // code filters: the start of the description in each language (about 200
  // characters, contacts removed) and the full UNSPSC codes.
  excerpt_en?: string | null;
  excerpt_fr?: string | null;
  codes?: string[];
  // Present on rows of tenders/new/<day>.json, where a notice may already be
  // closed: the status on the data date ("closed" once the closing day has
  // passed), with the file's own status in source_status.
  status?: string;
  source_status?: string;
}

// One award notice or contract history row as a list row. On contract
// history rows the buyer is the client department (the end user); the
// contracting entity is always Public Services and Procurement Canada.
export interface AwardRow extends DerivedPlaces {
  reference: string;
  reference_published?: string;
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
  // On the rows of awards/erroneous.json only: the publication date and the
  // contract's start and end, which the award date is read against there.
  published?: string | null;
  start?: string | null;
  end?: string | null;
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
  // A profile's years: the positive values alone, which the non-competitive
  // share by value is taken over, and how many records were below zero (an
  // amendment that lowered a published contract). Absent from older exports.
  total_positive?: number | null;
  total_non_competitive_positive?: number | null;
  n_negative?: number;
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

// One layer of the home page's Canada map (src/pages/home_map.tsx): n, the
// notices; provinces, each of the thirteen codes with the notices placed in
// it by a stated province or a derived one, a notice placed in several
// counted in each; not_stated, the notices placed in none (Canada-wide or not
// stated). stats.json carries the layers the nightly counts
// (STATS_MAP_LAYERS, pipeline export_static.province_map); the same-day layer
// is counted here from the intraday rows (sameDayMapCounts in
// src/pages/intraday.tsx), by provinceCounts below.
export interface ProvinceCounts {
  n: number;
  not_stated: number;
  provinces: Partial<Record<string, number>>;
}
export const STATS_MAP_LAYERS = ["new_today", "open", "closing_7d"] as const;
export type StatsMapLayer = (typeof STATS_MAP_LAYERS)[number];

// The rows by province, as the pipeline counts a layer: a row's stated and
// derived provinces together, each province once per row, and a row placed
// in none of the thirteen counted once in not_stated.
export function provinceCounts(rows: readonly TenderRow[]): ProvinceCounts {
  const provinces: Record<string, number> = Object.fromEntries(PROVINCES.map((p) => [p, 0]));
  let notStated = 0;
  for (const r of rows) {
    const placed = new Set([...r.provinces, ...(r.provinces_derived ?? [])].filter((p) => p in provinces));
    if (!placed.size) notStated += 1;
    for (const p of placed) provinces[p] += 1;
  }
  return { n: rows.length, not_stated: notStated, provinces };
}

// awards/<year>/index.json: how many pages of award rows the year has (500 to
// a page, newest award date first) and how many rows in all.
export interface AwardYear {
  year: number;
  pages: number;
  rows: number;
  // The value set (awards/<year>/value/<n>.json): its file count, and how
  // many of its first files hold the rows with a value; the files after them
  // hold the rows without one. Absent from older exports, which have no
  // value set (the year's Value head then stays plain).
  value_pages?: number;
  valued_pages?: number;
}

export interface Stats {
  data_as_of: string | null;
  counts: Partial<Record<
    | "organizations" | "buyers" | "tenders_open" | "tenders_new_today" | "awards" | "history" | "contracts" | "grants" | "lobbying"
    // Read by the rail when the export writes them (see loadRail).
    | "tenders_closing_soon" | "awards_year"
    // The home page's award notices tile: those awarded in the 30 days to the
    // data date, and the organizations the year's notices name. Absent from older exports.
    | "awards_30d" | "awards_year_suppliers"
    // The award notices dated after the data date, which awards/erroneous.json
    // lists apart (the /awards line counts them). Absent from older exports.
    | "awards_erroneous",
    number
  >>;
  new_tenders: TenderRow[];
  closing_soon: TenderRow[];
  // The closing value of every open notice closing within a few days more
  // than the closing-soon window of the data date, soonest first: the rail
  // and the home page count "closing soon" from it at render, leaving out a
  // notice whose closing time has passed. Absent from older exports.
  closing_soon_times?: string[];
  recent_awards: AwardRow[];
  top_organizations_year: OrgTotal[];
  runs: { run_at: string; source: string; detail: string | null; rows_new: number | null; ok: number | boolean }[];
  // One row per file a stage reads. last_modified is the publisher's date: an
  // HTTP date as sent ("Sun, 01 Nov 2026 17:15:06 GMT") or, from newer
  // exports, an ISO instant. loaded, when present, is false for a source that
  // was never read.
  sources: { source: string; file: string; last_read: string | null; last_modified: string | null; loaded?: boolean }[];
  // A Zenodo record of the open files, when one is published; absent until then.
  citation?: Citation | null;
  // Values beside the counts: the data year's award notices and those awarded
  // in the 30 days to the data date, by the counting rules (Canadian dollars).
  // Absent from older exports.
  totals?: { awards_year?: number | null; awards_30d?: number | null };
  // Each file of the Data page's downloads as the export found it: its size in
  // bytes and, for a CSV file, its rows under the header. Absent from older exports.
  downloads?: { file: string; bytes: number; rows: number | null }[];
  // The home page's Canada map, a layer per list (ProvinceCounts above).
  // Absent from older exports, and dropped when it does not read: the home
  // page then has no map.
  map?: Record<StatsMapLayer, ProvinceCounts>;
  // The first and last fiscal year the profiles' "matching" blocks count
  // (pipeline profile_matching.py). Absent from exports written before the
  // block: a profile without one then says nothing yet. Read through
  // src/fit.tsx matchingWindow.
  matching_fy?: unknown;
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
  reference_published?: string;
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
export interface TenderDetail extends DerivedPlaces {
  reference: string;
  reference_published?: string;
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
  // The documents the CanadaBuys file names for the notice (export_static.tender_attachments).
  // Absent from a file exported before the field, and from a notice with none:
  // read it through tenderAttachments, which checks each one.
  attachments?: unknown;
}

// A tender notice's document: its link and the file name the page shows.
export interface Attachment {
  url: string;
  name: string;
}

export const ATTACHMENTS_MAX = 50;
// Hosts a document may be linked on: canada.ca and its subdomains, and the
// gc.ca subdomains (Shared Services Canada's buying portal is one). The
// pipeline keeps only these (canadabuys_rows.government_url); the page checks
// again so a link to any other host never renders, whatever a file holds.
const GOV_HOST = /^(?:(?:[a-z0-9-]+\.)*canada\.ca|(?:[a-z0-9-]+\.)+gc\.ca)$/;

// A document link as the page may show it, or null: https on a Government of
// Canada host, no user name, password or other port, and no "@" anywhere, so
// no address reaches the page through a link.
export function documentUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2000 || /@|%40|\s/i.test(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port !== "" && u.port !== "443")) return null;
  return GOV_HOST.test(u.hostname) ? u.href : null;
}

// The name a document shows when its file gives none: the last segment of
// its path, decoded, else the host.
function documentName(url: string): string {
  const u = new URL(url);
  const last = u.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // A malformed escape: the segment as written.
  }
  return name.trim() || u.hostname;
}

// A notice's documents, each link checked, each URL once, ATTACHMENTS_MAX at
// most. A detail file from before the field, or one whose field does not
// read, gives none: the page then points at the CanadaBuys notice.
export function tenderAttachments(d: TenderDetail): Attachment[] {
  const list = d.attachments;
  if (!Array.isArray(list)) return [];
  const out: Attachment[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!isObj(item)) continue;
    const url = documentUrl(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : documentName(url);
    out.push({ url, name });
    if (out.length >= ATTACHMENTS_MAX) break;
  }
  return out;
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
export interface ContractDetail extends DerivedPlaces {
  kind: "award" | "history";
  reference: string;
  reference_published?: string;
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
  supplier_withheld?: boolean;
  supplier_operating?: string | null;
  // Contract history: the supplier's employees as PSPC gives them; read through supplierEmployees.
  supplier_employees?: unknown;
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
  // The contracts ending within 12 months; absent from older exports.
  expiring?: ExpiringPart;
  // Whether each source was read at all, when the export says (see sourceLoaded).
  sources?: Partial<Record<string, { loaded?: boolean }>>;
  loaded?: Partial<Record<string, boolean>>;
  lobbying_loaded?: boolean;
  registry_loaded?: boolean;
  // The corporate family the curated seed places it in; absent from older
  // exports and from a profile in no family. Read through profileFamily.
  family?: unknown;
  // The names of the retired ids whose records it took, with the seed's
  // note, and how many in all when the list stops; absent from older
  // exports. Read through profileAliases.
  aliases?: unknown;
  aliases_total_rows?: unknown;
  // The supplier employees on its newest history record that gives them;
  // absent from older exports. Read through profileEmployees.
  employees?: unknown;
  // What its records hold for matching notices (pipeline profile_matching.py);
  // absent from older exports and from a profile with nothing in the window.
  // Read through src/fit.tsx profileMatching.
  matching?: unknown;
  // The payments the Public Accounts report for it, a block of their own
  // (pipeline sources/public_accounts.py); absent from older exports and from
  // a profile with none. Read through src/public_accounts.tsx.
  public_accounts?: unknown;
}

// -- corporate families ------------------------------------------------------------

// A family member as the export writes it: its own profile and its own
// record count, never a figure added across members (operator ruling of
// 2026-11-07). note is the seed's word for its tie: subsidiary, affiliate or
// joint venture; null or another word shows no word.
export interface FamilyMember { id: string; display_name: string; n_records: number; note: string | null }
export interface Family { name: string; members: FamilyMember[] }

const isFamilyMember = (m: unknown): m is FamilyMember => isObj(m) && isStr(m.id) && ORG_ID_RE.test(m.id) &&
  isStr(m.display_name) && m.display_name.trim() !== "" && isNum(m.n_records) && Number.isInteger(m.n_records) && m.n_records >= 0 &&
  (m.note === undefined || isStrOrNull(m.note));

// -- names it also appears under ---------------------------------------------------

// The names of the retired ids whose records a profile took, as the export
// writes them on the profile: `aliases`, a list of {id, name, note, reason}
// (at most ALIASES_MAX, the ones with a note first), and `aliases_total_rows`
// when there are more. note is the alias seed's word (organization_aliases.csv):
// "spelling", "former", "short" or "branch"; null, or any other word, shows
// the name alone. An export without the field has no names and the line
// stays off.
export const ALIAS_NOTES = ["former", "spelling", "short", "branch"] as const;
export const ALIASES_MAX = 12;
export type AliasNote = (typeof ALIAS_NOTES)[number];
export interface OrgAlias { name: string; note: AliasNote | null }
export interface OrgAliases { names: OrgAlias[]; more: number }

// The names, once each (case and spacing aside) and never the profile's own
// display name, in the export's order, at most ALIASES_MAX; more counts the
// retired ids the list leaves out (aliases_total_rows past the list's length,
// and any entry past ALIASES_MAX). A malformed entry is skipped rather than
// taking the profile down, and a field that is not a list reads as none.
export function profileAliases(profile: unknown): OrgAliases {
  const v = isObj(profile) ? profile.aliases : undefined;
  if (!Array.isArray(v)) return { names: [], more: 0 };
  const own = isObj(profile) && isObj(profile.organization) && isStr(profile.organization.display_name)
    ? fold(profile.organization.display_name) : "";
  const seen = new Set<string>([own]);
  const names: OrgAlias[] = [];
  for (const a of v.slice(0, ALIASES_MAX)) {
    if (!isObj(a) || !isStr(a.name)) continue;
    const name = a.name.replace(/\s+/g, " ").trim();
    const key = fold(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push({ name, note: (ALIAS_NOTES as readonly unknown[]).includes(a.note) ? (a.note as AliasNote) : null });
  }
  const total = isObj(profile) && isNum(profile.aliases_total_rows) && Number.isInteger(profile.aliases_total_rows)
    ? profile.aliases_total_rows : v.length;
  const listed = Math.min(v.length, ALIASES_MAX);
  return { names, more: names.length ? Math.max(0, Math.max(total, v.length) - listed) : 0 };
}
const fold = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

// The profile's family, or null: the profile renders without the section
// when the export predates families, the profile is in none, or the field
// is the wrong shape (a bad family never takes the profile down with it).
export function profileFamily(profile: unknown): Family | null {
  const v = isObj(profile) ? profile.family : undefined;
  if (!isObj(v) || !isStr(v.name) || !v.name.trim() || !isListOf(v.members, isFamilyMember) || v.members.length === 0) return null;
  return {
    name: v.name,
    members: (v.members as FamilyMember[]).map((m) => ({ id: m.id, display_name: m.display_name, n_records: m.n_records, note: m.note ?? null })),
  };
}

// Whether a source was ever read, when the files say so: the profile's own
// flag (the export writes <key>_loaded: false for a source never read; the
// forms sources.<key>.loaded and loaded.<key> read too), then the rows of
// stats.json "sources" for that stage when they carry `loaded`. Undefined
// when nothing says, and the page reads as it always has.
export function sourceLoaded(
  key: string, profile: Profile | null, stats: Pick<Stats, "sources"> | null,
): boolean | undefined {
  const flags: unknown[] = profile
    ? [profile.sources?.[key]?.loaded, profile.loaded?.[key], (profile as unknown as Record<string, unknown>)[`${key}_loaded`]]
    : [];
  const own = flags.find((v) => typeof v === "boolean");
  if (typeof own === "boolean") return own;
  const rows = (stats?.sources ?? []).filter((s) => s.source === key && typeof s.loaded === "boolean");
  if (rows.length === 0) return undefined;
  return rows.some((s) => s.loaded === true);
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
  // The lobbying communication reports naming it; absent from older exports.
  n_lobbying?: number;
}
export interface BuyerIndex { buyers: BuyerSummary[] }
// A name the buyer also appears under (sources/buyers.py, buyer_aliases.csv):
// note "former" marks a former name; a spelling the sources carry has none.
export interface BuyerAlias { name: string; note: string | null }
// kind "institution": no open.canada.ca organization, and only the lobbying
// registry names it (Members of the House of Commons, offices of Parliament).
export const INSTITUTION = "institution";
export interface BuyerYear extends YearFigure { n_organizations: number | null }
export interface Buyer {
  buyer: BuyerSummary & { ckan_org: string | null; department_number: string | null };
  years: BuyerYear[];
  top_organizations: Partial<Record<MoneySource, OrgTotal[]>>;
  open_tenders: number;
  recent_awards: AwardRow[];
  // The contracts ending within 12 months; absent from older exports.
  expiring?: ExpiringPart;
  // The names it also appears under; absent from older exports.
  aliases?: BuyerAlias[];
  // What the Public Accounts report it paid for professional and special
  // services; absent from older exports. Read through src/public_accounts.tsx.
  public_accounts?: unknown;
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

// -- expiring contracts ---------------------------------------------------------------

// The radar's windows, cumulative: a contract ending within 3 months of the
// data date is also in the 6- and 12-month lists (CLAUDE.md "Expiring-contracts
// radar").
export const EXPIRING_WINDOWS = ["3m", "6m", "12m"] as const;
export type ExpiringWindow = (typeof EXPIRING_WINDOWS)[number];
// The source a radar row was kept from: an award notice, a PSPC contract
// history record or a published contract (proactive publication).
export const EXPIRING_KINDS = ["award", "history", "contract"] as const;
export type ExpiringKind = (typeof EXPIRING_KINDS)[number];

// One contract whose newest version ends within 12 months of the data date,
// listed once whichever sources hold it.
export interface ExpiringRow extends DerivedPlaces {
  kind: ExpiringKind;
  // As published; for a published contract "owner_org:reference", since its
  // reference is unique within one department only. An award or history
  // reference holding "/" or ":" is in its URL-safe form, with the published
  // one in reference_published.
  reference: string;
  reference_published?: string;
  title_en: string | null;
  title_fr: string | null;
  // Both null, with supplier_withheld true, when the supplier reads as a person.
  organization_id: string | null;
  organization: string | null;
  supplier_withheld?: boolean;
  buyer_id: string | null;
  buyer_en: string | null;
  buyer_fr: string | null;
  start: string | null;
  end: string;
  days_left: number;
  value: number | null; // the value counted by the row's own source's rules
  currency: string | null;
  competitive: Competitive;
  method_en: string | null;
  method_fr: string | null;
  instrument_en: string | null;
  instrument_fr: string | null;
  n_amendments: number; // versions beyond the original
  value_growth: number | null; // newest total over the original amount, minus 1
  // The tender notice for the solicitation, when the source gives one.
  tender_reference?: string | null;
  segments: string[];
  provinces: string[];
  // The published contracts' Indigenous business mark; read through indigenousMark.
  indigenous?: unknown;
}

// The mark a radar row carries when its published contract reports a
// set-aside under the Procurement Strategy for Indigenous Business (MS
// mandatory, VS voluntary) or an Indigenous business outside one (IB), as
// export_static.expiring_row writes it. Absent from older files and from
// every other row; anything else reads as none, and a row whose supplier is
// withheld as a person shows none whatever it holds.
export const INDIGENOUS_MARKS = ["MS", "VS", "IB"] as const;
export type IndigenousMark = (typeof INDIGENOUS_MARKS)[number];
export function indigenousMark(r: { indigenous?: unknown; supplier_withheld?: boolean }): IndigenousMark | null {
  if (r.supplier_withheld) return null;
  return (INDIGENOUS_MARKS as readonly unknown[]).includes(r.indigenous) ? (r.indigenous as IndigenousMark) : null;
}

// -- the supplier's employees on PSPC's contract history ---------------------------

// How the export writes them (normalize.employee_count in the pipeline): a
// count's digits ("180"), or the code of one of the CanadaBuys data
// dictionary's size bands, which older records give instead of a count.
export const EMPLOYEE_BANDS = [
  "self", "1-4", "5-9", "10-19", "20-49", "50-99", "100-199", "200-499", "500-999", "1000-1499", "1500-2499", "2500-4999", "5000+",
] as const;
export const isEmployees = (v: unknown): v is string =>
  isStr(v) && (/^\d{1,7}$/.test(v) || (EMPLOYEE_BANDS as readonly string[]).includes(v));

// A history record's supplier employees, or null: absent from files written
// before the field, from a record that states none, and from one whose
// supplier is withheld; a value of another shape reads as none rather than
// taking the page down.
export function supplierEmployees(d: { supplier_employees?: unknown; supplier_withheld?: boolean }): string | null {
  return !d.supplier_withheld && isEmployees(d.supplier_employees) ? d.supplier_employees : null;
}

// The figure a profile carries: the supplier employees on the organization's
// newest history record that gives them, that record's award date and
// reference (export_static.profile_employees). Null when the profile has
// none, an older export, or a field of the wrong shape.
export interface ProfileEmployees { value: string; awarded: string; reference: string }
export function profileEmployees(profile: unknown): ProfileEmployees | null {
  const v = isObj(profile) ? profile.employees : undefined;
  if (!isObj(v) || !isEmployees(v.value) || !isStr(v.awarded) || !/^\d{4}-\d{2}-\d{2}$/.test(v.awarded) || !isRef(v.reference)) return null;
  return { value: v.value, awarded: v.awarded, reference: v.reference };
}

export interface ExpiringIndex {
  as_of: string;
  // n_no_value: the window's contracts with no value published, which its total leaves out.
  windows: { window: ExpiringWindow; n: number; total: number | null; n_no_value?: number }[];
  by_buyer: { buyer_id: string | null; buyer_en: string | null; buyer_fr: string | null; n: number; total: number | null }[];
  by_segment: { code: string; n: number; total: number | null }[];
}

// expiring/<window>/index.json: how many pages of rows the window has (500
// to a page, soonest end first), how many rows in all and their value.
export interface ExpiringWindowIndex {
  window: ExpiringWindow;
  pages: number;
  rows: number;
  total: number | null;
}

// What a buyer file and a profile carry of the radar: the number of rows,
// their value, and the first 25 by end date. Absent from files written
// before the radar.
export interface ExpiringPart {
  n: number;
  total: number | null;
  rows: ExpiringRow[];
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
  try {
    text = await res.text();
  } catch (e) {
    console.error(`asset ${path} is not valid JSON: ${String(e).slice(0, 200)}`);
    return null;
  }
  return parseText(path, etag, text) as T | null;
}

// The rest of loadJson once the text is read: parsed, frozen, and kept under
// its ETag when it has one and is not too large; null when it does not parse.
function parseText(path: string, etag: string | null, text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    console.error(`asset ${path} is not valid JSON: ${String(e).slice(0, 200)}`);
    return null;
  }
  if (typeof value === "object" && value !== null) deepFreeze(value);
  if (etag && text.length <= CACHE_MAX_ENTRY_CHARS) keep(path, { etag, value, chars: text.length });
  return value;
}

// -- one entry of a shard -----------------------------------------------------------
//
// A page that shows one organization, notice or contract needs one entry of
// its shard, and a profile shard holds about ninety organizations in about
// 450 KB, most of it the few largest. Crawlers walk the profiles in no order,
// so the shard is rarely kept from an earlier request, and parsing and
// freezing the whole file for a 2 KB entry was a large part of a profile
// page's time and of the garbage the isolate collects.
//
// The export writes each shard as compact JSON with every key once, so the
// entry's key appears in the text as "<key>": right after the { or the , that
// opens it. The value after it is found by matching its brackets, parsed
// alone and frozen; nothing is kept. Whenever that does not give an entry
// the caller accepts (the key is not there in that form, the brackets do not
// close, the slice does not parse, or what it holds is not the entry asked
// for), the whole file is read as loadJson reads it, so a page gets exactly
// what the full parse would give.

// The end (exclusive) of the object or array that opens at from, or -1.
function valueEnd(text: string, from: number): number {
  const open = text.charCodeAt(from);
  if (open !== 123 && open !== 91) return -1;
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 34) {
      // A string: on to its closing quote, past any escaped character.
      for (i++; i < text.length; i++) {
        const s = text.charCodeAt(i);
        if (s === 92) i++;
        else if (s === 34) break;
      }
    } else if (c === 123 || c === 91) {
      depth++;
    } else if (c === 125 || c === 93) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// The value under key, cut from the shard's text, or undefined. Only from a
// text shaped like a whole shard: it opens with a brace and ends with two,
// its last entry's and its own. In the shards the export writes today two
// closing braces in a row come only there (checked on the 2026-11-07 files:
// an entry's last key, sorted, holds a list or a number), so a file cut short
// in a broken deploy does not end that way; the full parse then finds it
// broken and the page reads it as missing, as before.
function sliceEntry(text: string, key: string): unknown {
  let last = text.length - 1;
  // JSON's whitespace: space, tab, line feed, carriage return.
  while (last > 0 && [32, 9, 10, 13].includes(text.charCodeAt(last))) last--;
  if (text.charCodeAt(0) !== 123 || text.charCodeAt(last) !== 125 || text.charCodeAt(last - 1) !== 125) return undefined;
  const needle = `${JSON.stringify(key)}:`;
  // The key must be a key of the shard itself, at depth one and outside any
  // string: an entry may hold the same key inside (a map of organizations,
  // a name in a string), and an accept check cannot tell a whole copy from
  // the entry. The text is walked once up to each occurrence, string and
  // bracket state carried along, until one is found at the top level.
  let depth = 0;
  let inString = false;
  let escaped = false;
  let i = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    for (; i < at; i++) {
      const c = text.charCodeAt(i);
      if (inString) {
        if (escaped) escaped = false;
        else if (c === 92) escaped = true;
        else if (c === 34) inString = false;
      } else if (c === 34) inString = true;
      else if (c === 123 || c === 91) depth++;
      else if (c === 125 || c === 93) depth--;
    }
    if (inString || depth !== 1) continue;
    const before = text.charCodeAt(at - 1);
    if (before !== 123 && before !== 44) continue;
    const start = at + needle.length;
    const end = valueEnd(text, start);
    if (end < 0) return undefined;
    try {
      return JSON.parse(text.slice(start, end));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// The entry under key in the shard at path, if accept takes it, else null.
// lookup finds the entry in the parsed shard (an exact key, or entryFor's
// match in any case) when the whole file has to be read. Frozen like
// everything loadJson returns.
export async function loadShardEntry(
  env: Env, path: string, key: string, lookup: (shard: Record<string, unknown>) => unknown, accept: (v: unknown) => boolean,
): Promise<unknown> {
  const res = await assetResponse(env, path);
  if (!res) return null;
  const etag = res.headers.get("etag");
  const hit = etag ? parsed.get(path) : undefined;
  let value: unknown;
  if (hit && hit.etag === etag) {
    parsed.delete(path);
    parsed.set(path, hit);
    await res.body?.cancel().catch(() => undefined);
    value = isObj(hit.value) ? lookup(hit.value as Record<string, unknown>) : null;
    return accept(value) ? value : null;
  }
  forget(path);
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    console.error(`asset ${path} is not valid JSON: ${String(e).slice(0, 200)}`);
    return null;
  }
  value = sliceEntry(text, key);
  if (value !== undefined && accept(value)) return typeof value === "object" && value !== null ? deepFreeze(value) : value;
  const shard = parseText(path, etag, text);
  value = isObj(shard) ? lookup(shard as Record<string, unknown>) : null;
  return accept(value) ? value : null;
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
// The reference as published: any text the page prints (it is escaped), but not empty or long.
const isPublishedRef = (v: unknown): v is string => isStr(v) && v.length >= 1 && v.length <= 200;

// The reference a reader knows the record by: as published when the export
// had to make it URL-safe, else the reference itself.
export function publishedReference(r: { reference: string; reference_published?: string }): string {
  return r.reference_published ?? r.reference;
}
const isMoneySource = (v: unknown): v is MoneySource => (MONEY_SOURCES as readonly unknown[]).includes(v);

export const isTenderRow = (r: unknown): r is TenderRow => isObj(r) && isRef(r.reference) &&
  optional(r.reference_published, isPublishedRef) && isNum(r.amendment) &&
  isStrOrNull(r.title_en) && isStrOrNull(r.title_fr) && isBuyerIdOrNull(r.buyer_id) && isStrOrNull(r.buyer_en) &&
  isStrOrNull(r.buyer_fr) && isStrOrNull(r.published) && isStrOrNull(r.closing) && isStrList(r.category) &&
  isStrOrNull(r.notice_type_en) && isStrOrNull(r.notice_type_fr) && isStrOrNull(r.method_en) && isStrOrNull(r.method_fr) &&
  isStrList(r.segments) && isStrList(r.provinces) && isDerivedPlaces(r) && isStr(r.first_seen) && optional(r.status, isStr) &&
  optional(r.excerpt_en, isStrOrNull) && optional(r.excerpt_fr, isStrOrNull) && optional(r.codes, isStrList);

export const isAwardRow = (r: unknown): r is AwardRow => isObj(r) && isRef(r.reference) &&
  optional(r.reference_published, isPublishedRef) && isStrOrNull(r.title_en) &&
  isStrOrNull(r.title_fr) && isOrgIdOrNull(r.organization_id) && isStrOrNull(r.organization) && isBuyerIdOrNull(r.buyer_id) &&
  isStrOrNull(r.buyer_en) && isStrOrNull(r.buyer_fr) && isStrOrNull(r.awarded) && isNumOrNull(r.value) &&
  isStrOrNull(r.currency) && isCompetitive(r.competitive) && isStrOrNull(r.instrument_en) && isStrOrNull(r.instrument_fr) &&
  isStrList(r.segments) && isStrList(r.provinces) && isDerivedPlaces(r) && optional(r.status, isStr) &&
  optional(r.published, isStrOrNull) && optional(r.start, isStrOrNull) && optional(r.end, isStrOrNull);

// A row of awards/erroneous.json: a list row that carries the publication
// date and the contract's dates, which that page shows beside the award date.
export const isErroneousAward = (r: unknown): r is AwardRow => isAwardRow(r) &&
  isStrOrNull(r.published) && isStrOrNull(r.start) && isStrOrNull(r.end);

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
  isNumOrNull(r.total_non_competitive) && optional(r.total_positive, isNumOrNull) &&
  optional(r.total_non_competitive_positive, isNumOrNull) && optional(r.n_negative, isCount);

const isCodeRow = (r: unknown): r is CodeRow => isObj(r) && isStr(r.code) && isStrOrNull(r.desc_en) && isStrOrNull(r.desc_fr);

// -- stats.json ------------------------------------------------------------------

const STAT_LISTS: [keyof Stats, (v: unknown) => boolean][] = [
  ["new_tenders", isTenderRow],
  ["closing_soon", isTenderRow],
  ["recent_awards", isAwardRow],
  ["top_organizations_year", isOrgTotal],
  ["runs", (r) => isObj(r) && isStr(r.run_at) && isStr(r.source) && isStrOrNull(r.detail) && isNumOrNull(r.rows_new) && (isNum(r.ok) || isBool(r.ok))],
  ["sources", (r) => isObj(r) && isStr(r.source) && isStr(r.file) && isStrOrNull(r.last_read) && isStrOrNull(r.last_modified) &&
    optional(r.loaded, isBool)],
];

const PROVINCE_SET: ReadonlySet<string> = new Set(PROVINCES);
const isProvinceCounts = (v: unknown): v is ProvinceCounts => isObj(v) && isCount(v.n) && isCount(v.not_stated) &&
  isObj(v.provinces) && Object.entries(v.provinces).every(([code, n]) => PROVINCE_SET.has(code) && isCount(n));
const isStatsMap = (v: unknown): boolean => isObj(v) && STATS_MAP_LAYERS.every((layer) => isProvinceCounts(v[layer]));

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
  // The closing times are optional: a list that does not read is left out, so the rail falls back to the counts.
  const badTimes = stats.closing_soon_times !== undefined &&
    !checkOnce(stats.closing_soon_times, "stats.closing_soon_times", (v) => isListOf(v, isStr));
  // So is the map: one that does not read, every layer of it, is left out and the home page draws none.
  const badMap = stats.map !== undefined && !checkOnce(stats.map, "stats.map", isStatsMap);
  if (badCounts.length === 0 && badLists.length === 0 && !badTimes && !badMap) return stats as unknown as Stats;
  const fixed: Record<string, unknown> = { ...stats, counts: Object.fromEntries(Object.entries(counts).filter(([, v]) => isNum(v))) };
  for (const k of badLists) fixed[k] = [];
  if (badTimes) delete fixed.closing_soon_times;
  if (badMap) delete fixed.map;
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

// tenders/open.json, every open notice. The browser reads it for /tenders;
// on the server only the search page reads it, to count the open notices
// whose title holds the searched words (about a thousand rows, parsed once an
// isolate while its ETag holds).
export async function loadOpenList(env: Env): Promise<TenderRow[] | null> {
  const rows = await loadJson<unknown>(env, "tenders/open.json");
  return checkOnce(rows, "tenders/open.json", (v) => isListOf(v, isTenderRow)) ? (rows as TenderRow[]) : null;
}

export async function loadNewTenders(env: Env, day: string): Promise<TenderRow[] | null> {
  if (!DAY_RE.test(day)) return null;
  const rows = await loadJson<unknown>(env, `tenders/new/${day}.json`);
  return isListOf(rows, isTenderRow) ? rows : null;
}

const isTenderVersion = (v: unknown): boolean => isObj(v) && isNum(v.amendment) && isStrOrNull(v.published) &&
  isStrOrNull(v.amended) && isStrOrNull(v.closing) && isStrOrNull(v.status) && isStrOrNull(v.title_en) &&
  isStrOrNull(v.title_fr) && isStr(v.first_seen);

const isRelatedAward = (v: unknown): boolean => isObj(v) && isRef(v.reference) &&
  optional(v.reference_published, isPublishedRef) && isStrOrNull(v.title_en) &&
  isStrOrNull(v.title_fr) && isOrgIdOrNull(v.organization_id) && isStrOrNull(v.organization) && isStrOrNull(v.awarded) &&
  isNumOrNull(v.value) && isStrOrNull(v.currency);

const BI_TEXT = ["title", "notice_type", "method", "selection", "limited_reason", "description"] as const;
const BI_LISTS = ["trade_agreements", "regions_delivery"] as const;

const isTenderDetail = (v: unknown, reference: string): v is TenderDetail => isObj(v) && isRef(v.reference) &&
  optional(v.reference_published, isPublishedRef) &&
  v.reference.toLowerCase() === reference && isNum(v.amendment) && isStrOrNull(v.solicitation) &&
  BI_TEXT.every((k) => isStrOrNull(v[`${k}_en`]) && isStrOrNull(v[`${k}_fr`])) &&
  BI_LISTS.every((k) => isStrListOrNull(v[`${k}_en`]) && isStrListOrNull(v[`${k}_fr`])) &&
  isStrListOrNull(v.regions_opportunity_en) && isStrListOrNull(v.regions_opportunity_fr) &&
  isStrListOrNull(v.end_users_en) && isStrListOrNull(v.end_users_fr) &&
  isStrOrNull(v.published) && isStrOrNull(v.closing) && isStrOrNull(v.amended) && isStrOrNull(v.start_expected) &&
  isStrOrNull(v.end_expected) && isStr(v.status) && isStrOrNull(v.gsin) && isStrOrNull(v.gsin_desc_en) &&
  isStrOrNull(v.gsin_desc_fr) && isStrList(v.category) && isStrList(v.provinces) && isDerivedPlaces(v) &&
  isBuyerIdOrNull(v.buyer_id) &&
  isStrOrNull(v.buyer_en) && isStrOrNull(v.buyer_fr) && isStr(v.source_file) && isStr(v.first_seen) && isStr(v.last_seen) &&
  isListOf(v.codes, isCodeRow) && isListOf(v.amendments, isTenderVersion) && isListOf(v.related_awards, isRelatedAward);

// One notice from its shard. The reference is lower-cased for the shard and
// matched in any case inside it; null for a reference that is not one, a
// missing shard, or an entry that does not read.
export async function loadTender(env: Env, reference: string): Promise<TenderDetail | null> {
  if (!REFERENCE_RE.test(reference)) return null;
  const key = reference.toLowerCase();
  const entry = await loadShardEntry(env, `tenders/${await referenceShard(key)}.json`, key, (shard) => entryFor(shard, key),
    (v) => isTenderDetail(v, key));
  return entry as TenderDetail | null;
}

// -- award notices and contract history -------------------------------------------

const isContractVersion = (v: unknown): boolean => isObj(v) && isNum(v.amendment) && isStrOrNull(v.amended) &&
  isNumOrNull(v.amount) && isNumOrNull(v.total_value) && isStrOrNull(v.status) && isStrOrNull(v.amendment_type_en) &&
  isStrOrNull(v.amendment_type_fr);

const isContractDetail = (v: unknown, kind: "award" | "history", reference: string): v is ContractDetail => isObj(v) &&
  v.kind === kind && isRef(v.reference) && v.reference.toLowerCase() === reference &&
  optional(v.reference_published, isPublishedRef) && isNum(v.amendment) &&
  isStrOrNull(v.solicitation) && isStrOrNull(v.contract_number) && optional(v.procurement_number, isStrOrNull) &&
  BI_TEXT.every((k) => isStrOrNull(v[`${k}_en`]) && isStrOrNull(v[`${k}_fr`])) &&
  BI_LISTS.every((k) => isStrListOrNull(v[`${k}_en`]) && isStrListOrNull(v[`${k}_fr`])) &&
  isStrListOrNull(v.end_users_en) && isStrListOrNull(v.end_users_fr) &&
  isStrOrNull(v.published) && isStrOrNull(v.awarded) && isStrOrNull(v.amended) && isStrOrNull(v.start) && isStrOrNull(v.end) &&
  isNumOrNull(v.amount) && isNumOrNull(v.total_value) && isNumOrNull(v.value) && isStrOrNull(v.currency) && isStr(v.status) &&
  isStrOrNull(v.instrument_type_en) && isStrOrNull(v.instrument_type_fr) && isStrOrNull(v.amendment_type_en) &&
  isStrOrNull(v.amendment_type_fr) && isStrOrNull(v.gsin) && isStrOrNull(v.gsin_desc_en) && isStrOrNull(v.gsin_desc_fr) &&
  isStrList(v.category) && isCompetitive(v.competitive) && isStrList(v.provinces) && isDerivedPlaces(v) &&
  isOrgIdOrNull(v.organization_id) &&
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
  const entry = await loadShardEntry(env, `contracts/${await referenceShard(key)}.json`, `${kind}:${key}`,
    (shard) => entryFor(shard, `${kind}:${key}`), (v) => isContractDetail(v, kind, key));
  return entry as ContractDetail | null;
}

// awards/recent.json: the 500 newest award notices.
export async function loadRecentAwards(env: Env): Promise<AwardRow[] | null> {
  const rows = await loadJson<unknown>(env, "awards/recent.json");
  return checkOnce(rows, "awards", (v) => isListOf(v, isAwardRow)) ? (rows as AwardRow[]) : null;
}

// awards/erroneous.json: the award notices whose award date falls after the
// data date (500 at most), newest award date first, left out of the newest
// lists and shown on /awards/erroneous.
export async function loadErroneousAwards(env: Env): Promise<AwardRow[] | null> {
  const rows = await loadJson<unknown>(env, "awards/erroneous.json");
  return checkOnce(rows, "awards/erroneous", (v) => isListOf(v, isErroneousAward)) ? (rows as AwardRow[]) : null;
}

const isYear = (y: unknown): y is number => isNum(y) && Number.isInteger(y) && y >= 1900 && y <= 2999;

// A year of award notices is paged so no request parses more than one page
// of 500 rows; the index says how many pages there are.
export async function loadAwardYear(env: Env, year: number): Promise<AwardYear | null> {
  if (!isYear(year)) return null;
  const v = await loadJson<unknown>(env, `awards/${year}/index.json`);
  if (!(isObj(v) && v.year === year && isCount(v.pages) && isCount(v.rows) && v.rows >= v.pages)) return null;
  // The value set holds the same rows in as many files or one more (the rows
  // without a value start a file of their own); one that says otherwise is
  // left out, so the year still reads in award date order.
  const value = isCount(v.value_pages) && isCount(v.valued_pages) && v.valued_pages <= v.value_pages &&
    v.value_pages >= v.pages && v.value_pages <= v.pages + 1;
  const { value_pages: _p, valued_pages: _v, ...plain } = v;
  return (value ? v : plain) as unknown as AwardYear;
}

// One page of a year: the rows as a list, or an object holding them as
// "rows" (either form reads). set "value" reads the year's value set.
export async function loadAwardPage(env: Env, year: number, n: number, set: "date" | "value" = "date"): Promise<AwardRow[] | null> {
  if (!isYear(year) || !Number.isInteger(n) || n < 1 || n > 100_000) return null;
  const v = await loadJson<unknown>(env, `awards/${year}/${set === "value" ? "value/" : ""}${n}.json`);
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
  optional(p.non_cad, (v) => isObj(v) && Object.entries(v).every(([k, n]) => isMoneySource(k) && isCount(n))) &&
  optional(p.expiring, isExpiringPart);

export async function loadProfile(env: Env, id: string): Promise<Profile | null> {
  if (!ORG_ID_RE.test(id)) return null;
  const entry = await loadShardEntry(env, `profiles/${id.slice(4, 7)}.json`, id, (shard) => shard[id], (v) => isProfile(v, id));
  return entry as Profile | null;
}

// The id that took a retired organization id's records (ids move when the
// name rules change), from a shard keyed like the profiles by the old id. A
// missing or unreadable shard, or an entry that is not an organization id,
// reads as no alias. The value goes into a Location header, so it must be an
// id; an entry pointing at itself would redirect forever, so it counts as none.
// The id a buyer moved to (buyers/aliases.json, {"aliases": {"old-id":
// "new-id"}}), read like the organization aliases: anything that is not a
// buyer id, or an id pointing at itself, reads as no alias.
export async function loadBuyerAlias(env: Env, id: string): Promise<string | null> {
  if (!BUYER_ID_RE.test(id) || id.length > 80) return null;
  const file = await loadJson<Record<string, unknown>>(env, "buyers/aliases.json");
  const aliases = isObj(file) && isObj(file.aliases) ? (file.aliases as Record<string, unknown>) : null;
  const live: unknown = aliases && Object.prototype.hasOwnProperty.call(aliases, id) ? aliases[id] : null;
  return typeof live === "string" && BUYER_ID_RE.test(live) && live.length <= 80 && live !== id ? live : null;
}

// An entry is the live id as the export writes it; an object naming the id
// as "to" (or "to_id") reads the same, so a shard written with more beside
// the id keeps its redirects rather than sending the old links to a 404.
export async function loadAlias(env: Env, id: string): Promise<string | null> {
  if (!ORG_ID_RE.test(id)) return null;
  const shard = await loadJson<Record<string, unknown>>(env, `aliases/${id.slice(4, 6)}.json`);
  const entry: unknown = isObj(shard) ? shard[id] : null;
  const live: unknown = isObj(entry) ? entry.to ?? entry.to_id : entry;
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
  optional(v.total_history, isNumOrNull) && isNumOrNull(v.total_contracts) && isNumOrNull(v.total_grants) &&
  optional(v.n_lobbying, isCount);

const isBuyerAlias = (v: unknown): v is BuyerAlias => isObj(v) && isStr(v.name) && v.name.length > 0 && isStrOrNull(v.note);

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
    isCount(v.open_tenders) && isListOf(v.recent_awards, isAwardRow) && optional(v.expiring, isExpiringPart) &&
    optional(v.aliases, (a) => isListOf(a, isBuyerAlias));
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

// -- expiring contracts -------------------------------------------------------------

export const isExpiringWindow = (v: unknown): v is ExpiringWindow => (EXPIRING_WINDOWS as readonly unknown[]).includes(v);
const isExpiringKind = (v: unknown): v is ExpiringKind => (EXPIRING_KINDS as readonly unknown[]).includes(v);
const isDay = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}/.test(v);

// An award or history reference becomes a path on this site, so it must be
// one; a published contract's "owner_org:reference" only goes into a search
// query, so any short string reads.
export const isExpiringRow = (r: unknown): r is ExpiringRow => isObj(r) && isExpiringKind(r.kind) &&
  (r.kind === "contract" ? isStr(r.reference) && r.reference.length > 0 && r.reference.length <= 200 : isRef(r.reference)) &&
  optional(r.reference_published, isPublishedRef) &&
  isStrOrNull(r.title_en) && isStrOrNull(r.title_fr) && isOrgIdOrNull(r.organization_id) && isStrOrNull(r.organization) &&
  optional(r.supplier_withheld, isBool) && isBuyerIdOrNull(r.buyer_id) && isStrOrNull(r.buyer_en) && isStrOrNull(r.buyer_fr) &&
  isStrOrNull(r.start) && isDay(r.end) && isCount(r.days_left) && isNumOrNull(r.value) && isStrOrNull(r.currency) &&
  isCompetitive(r.competitive) && isStrOrNull(r.method_en) && isStrOrNull(r.method_fr) && isStrOrNull(r.instrument_en) &&
  isStrOrNull(r.instrument_fr) && isCount(r.n_amendments) && isNumOrNull(r.value_growth) &&
  optional(r.tender_reference, (x) => x === null || isRef(x)) && isStrList(r.segments) && isStrList(r.provinces) &&
  isDerivedPlaces(r);

// The part of a buyer file or a profile: never more rows than it counts.
const isExpiringPart = (v: unknown): v is ExpiringPart => isObj(v) && isCount(v.n) && isNumOrNull(v.total) &&
  isListOf(v.rows, isExpiringRow) && v.rows.length <= v.n;

export async function loadExpiringIndex(env: Env): Promise<ExpiringIndex | null> {
  const v = await loadJson<unknown>(env, "expiring/index.json");
  const ok = isObj(v) && isStr(v.as_of) &&
    isListOf(v.windows, (w) => isObj(w) && isExpiringWindow(w.window) && isCount(w.n) && isNumOrNull(w.total)) &&
    isListOf(v.by_buyer, (b) => isObj(b) && isBuyerIdOrNull(b.buyer_id) && isStrOrNull(b.buyer_en) && isStrOrNull(b.buyer_fr) &&
      isCount(b.n) && isNumOrNull(b.total)) &&
    isListOf(v.by_segment, (g) => isObj(g) && isStr(g.code) && SEGMENT_RE.test(g.code) && isCount(g.n) && isNumOrNull(g.total));
  return ok ? (v as unknown as ExpiringIndex) : null;
}

// A window is paged like a year of award notices, so no request parses more
// than one page of 500 rows; its index says how many pages there are.
export async function loadExpiringWindow(env: Env, window: string): Promise<ExpiringWindowIndex | null> {
  if (!isExpiringWindow(window)) return null;
  const v = await loadJson<unknown>(env, `expiring/${window}/index.json`);
  return isObj(v) && v.window === window && isCount(v.pages) && isCount(v.rows) && v.rows >= v.pages && isNumOrNull(v.total)
    ? (v as unknown as ExpiringWindowIndex)
    : null;
}

// One page of a window: the rows as a list, or an object holding them as
// "rows" (either form reads).
export async function loadExpiringPage(env: Env, window: string, n: number): Promise<ExpiringRow[] | null> {
  if (!isExpiringWindow(window) || !Number.isInteger(n) || n < 1 || n > 100_000) return null;
  const v = await loadJson<unknown>(env, `expiring/${window}/${n}.json`);
  const rows = isObj(v) ? v.rows : v;
  return checkOnce(rows, "expiring", (r) => isListOf(r, isExpiringRow)) ? (rows as ExpiringRow[]) : null;
}

// -- the rail ---------------------------------------------------------------------

// How many rows the export keeps in each of the home page's lists in
// stats.json (HOME_ROWS in the pipeline). A shorter closing-soon list is the
// whole of it, so its length is the count; a full one may be cut short.
export const STATS_LIST_ROWS = 12;

// The counts beside the rail's links (layout.tsx). A count no file gives is
// left out and its link shows without one, so the rail never shows a guess.
export interface RailCounts {
  year: string;
  open?: number;
  newToday?: number;
  closingSoon?: number;
  ending3m?: number;
  ending6m?: number;
  ending12m?: number;
  awards?: number;
  awardsYear?: number;
  organizations?: number;
  buyers?: number;
  // Whether the lobbying registry has been read: the footer names only the
  // sources that have.
  lobbyingLoaded?: boolean;
  // Not a count: the nightly's stamp (dataStamp), for the top bar's daily
  // timer, taken here because the shell reads stats.json through this call.
  dataAt?: string;
}

// The nightly's stamp on stats.json: the newest time in its run log (the
// stages' rows, which every run of the pipeline writes before the export
// reads them), as "2026-11-07T13:02:11Z", or null when no row's time reads.
// The run that wrote it began at a scheduled time before this instant, and
// the file reaches the site only after it, so the top bar's daily timer
// (src/refresh.tsx) reads a run as under way until a newer stamp is served.
export function dataStamp(stats: Pick<Stats, "runs">): string | null {
  let newest: number | null = null;
  for (const r of stats.runs) {
    const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r.run_at) ? Date.parse(r.run_at) : Number.NaN;
    if (Number.isFinite(ms) && (newest === null || ms > newest)) newest = ms;
  }
  return newest === null ? null : `${new Date(newest).toISOString().slice(0, 19)}Z`;
}

// The open notices closing soon at the page's clock (src/closing.ts): counted
// from the export's closing times, so a notice whose closing time has passed
// since the nightly is left out. An older export without them gives its own
// count (as of the data date), else the closing-soon list when it is shorter
// than its cap; otherwise there is no count.
export function closingSoonTotal(stats: Stats, clock: Clock): number | undefined {
  if (stats.closing_soon_times) return closingSoonCount(stats.closing_soon_times, clock);
  if (stats.counts.tenders_closing_soon !== undefined) return stats.counts.tenders_closing_soon;
  return stats.closing_soon.length < STATS_LIST_ROWS ? closingSoonCount(stats.closing_soon.map((r) => r.closing), clock) : undefined;
}

// stats.json first. The year's award notices come from their own count
// field when the export writes it, else from the year's award index. The
// 3-month count needs the expiring radar's index.
export async function loadRail(env: Env): Promise<RailCounts | null> {
  const stats = await loadStats(env);
  if (!stats) return null;
  const counts = stats.counts;
  const day = (stats.data_as_of && /^\d{4}-\d{2}-\d{2}/.test(stats.data_as_of) ? stats.data_as_of : new Date().toISOString()).slice(0, 10);
  const year = day.slice(0, 4);
  const closingSoon = closingSoonTotal(stats, clockOf(env));
  const [awardYear, expiring] = await Promise.all([
    counts.awards_year === undefined ? loadAwardYear(env, Number(year)).catch(() => null) : Promise.resolve(null),
    loadExpiringIndex(env).catch(() => null),
  ]);
  return {
    year,
    open: counts.tenders_open,
    newToday: counts.tenders_new_today,
    closingSoon,
    ending3m: expiring?.windows.find((w) => w.window === "3m")?.n,
    ending6m: expiring?.windows.find((w) => w.window === "6m")?.n,
    ending12m: expiring?.windows.find((w) => w.window === "12m")?.n,
    awards: counts.awards,
    awardsYear: counts.awards_year ?? awardYear?.rows,
    organizations: counts.organizations,
    buyers: counts.buyers,
    lobbyingLoaded: sourceLoaded("lobbying", null, stats) === true,
    dataAt: dataStamp(stats) ?? undefined,
  };
}

// -- UNSPSC families and classes ------------------------------------------------------

// tenders/open-levels.json: the families (4 digits) and classes (6) the open
// notices' codes fall in, in code order, each with the notices carrying a
// code in it and its name as the notices published it (null in both
// languages when no notice used the level's own code; the source names
// only the codes it uses). A segment page lists its own; the tender list
// names a family or class chosen in its code filter by it.
export interface CodeLevel { code: string; en: string | null; fr: string | null; n: number }
export const LEVEL_CODE_RE = /^[0-9]{4}(?:[0-9]{2})?$/;

const isCodeLevel = (v: unknown): v is CodeLevel => isObj(v) && isStr(v.code) && LEVEL_CODE_RE.test(v.code) &&
  isStrOrNull(v.en) && isStrOrNull(v.fr) && isCount(v.n);

export async function loadOpenLevels(env: Env): Promise<readonly CodeLevel[] | null> {
  const v = await loadJson<unknown>(env, "tenders/open-levels.json");
  return isObj(v) && checkOnce(v.levels, "tenders/open-levels.json", (x) => isListOf(x, isCodeLevel)) ? (v.levels as CodeLevel[]) : null;
}

// The level a code names: "family" for 4 digits, "class" for 6, null for
// any other length (a segment has its own page; a commodity, 8 digits, no
// level of its own here).
export function codeLevel(code: string): "family" | "class" | null {
  return code.length === 4 ? "family" : code.length === 6 ? "class" : null;
}
