// "Your organization" (docs/accounts.md, Your organization): an account names
// the organization it is, and its page under the account shows that
// organization's records by fiscal year and segment, its share of a segment
// beside up to five organizations the account chose, its own contracts
// ending within 12 months and the buyers it has won from with what those
// buyers have open or ending. org_pages.tsx draws the page; routes.tsx
// mounts it; the weekly block of the watch mail is orgWeekOpening below.
//
// The claim is self-declared and unchecked: the account says which
// organization it is, the site checks only that the id is one the profiles
// hold, and nothing public changes. The claim grants no data the profile and
// the analytics views do not already show to any Pro reader; it saves the
// account finding its own page, and it is shown to that account alone (the
// console aside). Two accounts may claim the same organization.
//
// Every records statement is a constant with ?N placeholders, bound only to
// values checked before they reach it (an organization number from an
// organization id, fiscal years and days from the data date, a segment from
// the 57), read through the index on the column it names, and ended by a
// LIMIT; a page view is one batch: the state row and at most eight
// statements (CLAIM_BATCH_MAX). The statements the views already have are
// reused as they are (ORG_COUNTS_SQL, the radar's); the share is
// ORG_SHARE_SQL's, narrowed to the six organizations named (CLAIM_SHARE_SQL);
// the rest are here. site/test/org-claim.test.ts reads every plan.

import { addDays } from "../../public/closing.js";
import { SEGMENT_CODES, type MoneySource } from "../constants";
import { ORG_ID_RE, loadAlias, loadProfile, type Profile } from "../data";
import type { Env } from "../env";
import {
  FREE_YEARS, MAX_RIVALS, MAX_YEARS, SEGMENT_SOURCES, SHARE_SLOTS, SOURCE_NUMBER, STATE_SQL, type Query, type Read, type Row,
  fiscalYearOf, num, orgNumber, readRecords,
} from "../records_db";
import { RADAR_CSV_END_SQL, RADAR_CSV_MAX, RADAR_ROWS_END_SQL, RADAR_TOTAL_SQL, RECORDS_PARTIES_MAX, type RadarParams, radarBinds } from "../records_tables";
import { fmtInt, fmtMoney, pick, t, tn, type Key, type Lang } from "../i18n";
import { MAX_Q, counts, faultSummary, orgSelect, searchTerms, toOrgHit } from "../search_db";
import { type DigestOpening, siteLink } from "./digests";
import { ORG_COUNTS_SQL, missingTable } from "./records_deliveries";

// -- bounds ------------------------------------------------------------------------

// The organizations an account compares its own with: the share statement's
// slots beside the organization's own.
export const COMPETITORS_MAX = MAX_RIVALS;
// The buyers block: the buyers with the most records naming the
// organization over MAX_YEARS fiscal years (as the profile's record table
// lists them), BUYERS_SHOWN of them on the page, all in the CSV file.
export const BUYERS_MAX = RECORDS_PARTIES_MAX;
export const BUYERS_SHOWN = 25;
// The contracts ending within 12 months: the radar's 12-month window, the
// first ENDING_SHOWN on the page, the window's file at most RADAR_CSV_MAX.
export const ENDING_DAYS = 365;
export const ENDING_SHOWN = 25;
export const CLAIM_CSV_MAX = RADAR_CSV_MAX;
// The state row and at most this many statements in one page's batch.
export const CLAIM_BATCH_MAX = 8;
// The weekly block's span, in data dates.
export const WEEK_DAYS = 7;
// The buyers named in the weekly block's third line before "and n more".
export const WEEK_BUYERS_NAMED = 5;

// The page's blocks, by the name of each one's CSV file.
export const CLAIM_BLOCKS = ["years", "segments", "share", "ending", "buyers"] as const;
export type ClaimBlock = (typeof CLAIM_BLOCKS)[number];
export const isClaimBlock = (v: string): v is ClaimBlock => (CLAIM_BLOCKS as readonly string[]).includes(v);

// The share block reads one source at a time (no figure adds two), award
// notices by default, as the analytics view does.
export const SHARE_SOURCES = SEGMENT_SOURCES;
export const isShareSource = (v: unknown): v is MoneySource => typeof v === "string" && (SHARE_SOURCES as readonly string[]).includes(v);

// -- the records statements ---------------------------------------------------------

// The organization's records by segment, each source apart (award notices and
// PSPC contract history, the two that carry UNSPSC codes), over the fiscal
// years ?2 to ?3: extra = 0, so a record counts once, in its first segment.
// ?1 the organization's number. Through records_org (oid, src, fy).
export const CLAIM_SEGMENTS_SQL =
  "SELECT src, sid, COUNT(*) AS n, SUM(cents) AS cents FROM records WHERE oid = ?1 AND src IN (1, 2) AND fy BETWEEN ?2 AND ?3 " +
  `AND extra = 0 AND sid IS NOT NULL GROUP BY src, sid ORDER BY src, cents DESC, n DESC, sid LIMIT ${2 * SEGMENT_CODES.length}`;

// The segment the share block reads when the account chose none: the
// organization's largest in the share's source (?2) over its fiscal years
// (?3, ?4), by the rule of the segments block above (each record once, the
// largest value, then the most records, then the lowest code), so the page
// names it from that block's rows. ?5 the organization's number.
const LARGEST_SEGMENT =
  "(SELECT sid FROM records WHERE oid = ?5 AND src = ?2 AND fy BETWEEN ?3 AND ?4 AND extra = 0 AND sid IS NOT NULL " +
  "GROUP BY sid ORDER BY SUM(cents) DESC, COUNT(*) DESC, sid LIMIT 1)";

// The share: the organization view's share statement (records_db
// ORG_SHARE_SQL) for the account's own choice of organizations, with its
// rows and binds (?1 the segment, ?2 the source, ?3 and ?4 the fiscal
// years, ?5 the organization, ?6 to ?10 the competitors, -1 unused), and
// one change: the organization view also offers the segment's largest
// others, so its statement reads the whole segment through records_segment;
// here the organizations are only the six named, so each is read through
// records_org (the unary plus on sid keeps the planner off records_segment)
// and the segment's whole value comes from rec_segment_years, as there. With
// ?1 read as the largest segment when the account chose none, so the page
// stays one batch. site/test/org-claim.test.ts holds the rows equal to
// ORG_SHARE_SQL's with its ?11 at 0.
const SIX = Array.from({ length: SHARE_SLOTS }, (_, i) => `?${i + 5}`).join(", ");
const shareSql = (segment: string) =>
  "SELECT y.fy AS fy, y.n AS seg_n, y.cents AS seg_cents, r.oid AS oid, r.n AS n, r.cents AS cents FROM rec_segment_years y LEFT JOIN (" +
  `SELECT fy, oid, COUNT(*) AS n, SUM(cents) AS cents FROM records WHERE oid IN (${SIX}) AND src = ?2 AND fy BETWEEN ?3 AND ?4 ` +
  `AND +sid = ${segment} GROUP BY fy, oid) r ON r.fy = y.fy WHERE y.sid = ${segment} AND y.src = ?2 AND y.fy BETWEEN ?3 AND ?4 ` +
  `ORDER BY y.fy, r.oid LIMIT ${MAX_YEARS * SHARE_SLOTS}`;
export const CLAIM_SHARE_SQL = shareSql("?1");
export const CLAIM_SHARE_LARGEST_SQL = shareSql(LARGEST_SEGMENT);

// The buyers the organization has records with: rec_details through
// rec_details_org over the days ?2 to ?3 (MAX_YEARS fiscal years), the most
// records first, as the profile's record table chooses them
// (records_tables ORG_RECORD_BUYERS_SQL); each source's records and counted
// value apart, since no figure adds two sources.
const POOL_WHERE = "d.oid = ?1 AND d.day BETWEEN ?2 AND ?3 AND d.bid IS NOT NULL";
const bySource = (n: number) =>
  `SUM(CASE WHEN d.src = ${n} THEN 1 ELSE 0 END) AS n${n}, SUM(CASE WHEN d.src = ${n} THEN d.cents END) AS c${n}`;
const BUYER_POOL =
  `SELECT d.bid AS bid, COUNT(*) AS n, ${[1, 2, 3, 4].map(bySource).join(", ")} FROM rec_details d WHERE ${POOL_WHERE} ` +
  `GROUP BY d.bid ORDER BY n DESC, d.bid LIMIT ${BUYERS_MAX}`;

// Each of those buyers with its contracts ending within the radar's window
// (?4, ?5: the data date and 365 days on), counted as the radar's buyer
// filter counts them (rec_expiring.buyer, through rec_expiring_buyer), so the
// figure is the one /expiring/12m?buyer= shows. Its open notices come from
// the buyers index (buyers/index.json n_open_tenders), not from here.
export const CLAIM_BUYERS_SQL =
  "SELECT b.id AS id, b.name_en AS name_en, b.name_fr AS name_fr, p.n AS n, p.n1 AS n1, p.c1 AS c1, p.n2 AS n2, p.c2 AS c2, " +
  "p.n3 AS n3, p.c3 AS c3, p.n4 AS n4, p.c4 AS c4, " +
  "(SELECT COUNT(*) FROM rec_expiring e WHERE e.buyer = b.id AND e.endd BETWEEN ?4 AND ?5) AS n_ending " +
  `FROM (${BUYER_POOL}) p JOIN rec_buyers b ON b.bid = p.bid ORDER BY p.n DESC, b.id LIMIT ${BUYERS_MAX}`;

// -- the weekly block's statements (orgWeekOpening) ----------------------------------

// The records naming the organization that the nightly first saw in the
// week (?2 to ?3, data dates): rec_events award and grant rows through
// rec_events_org, a count row counting what it stands for. ?1 the number.
export const WEEK_RECORDS_SQL =
  "SELECT src, SUM(COALESCE(more, 1)) AS n FROM rec_events WHERE oid = ?1 AND day BETWEEN ?2 AND ?3 AND kind IN ('award', 'grant') " +
  "GROUP BY src ORDER BY src LIMIT 6";

// Its contracts ending within 12 months: the radar's window (?1, ?2) through
// rec_expiring_end, the organization ?3; the count, the counted value and the
// soonest end.
export const WEEK_ENDING_SQL =
  "SELECT COUNT(*) AS n, SUM(cents) AS cents, MIN(endd) AS soonest FROM rec_expiring WHERE endd BETWEEN ?1 AND ?2 AND oid = ?3 LIMIT 1";

// The buyers of the buyers block (the same ?1 to ?3) that posted new tender
// notices in the week (?4 to ?5): rec_events notice rows through
// rec_events_buyer, the most first.
export const WEEK_BUYERS_SQL =
  "SELECT e.buyer AS id, b.name_en AS name_en, b.name_fr AS name_fr, SUM(COALESCE(e.more, 1)) AS n FROM rec_events e " +
  "JOIN rec_buyers b ON b.id = e.buyer WHERE e.kind = 'notice' AND e.day BETWEEN ?4 AND ?5 AND e.buyer IN (" +
  `SELECT rb.id FROM (SELECT d.bid AS bid, COUNT(*) AS n FROM rec_details d WHERE ${POOL_WHERE} GROUP BY d.bid ` +
  `ORDER BY n DESC, d.bid LIMIT ${BUYERS_MAX}) p JOIN rec_buyers rb ON rb.bid = p.bid) ` +
  `GROUP BY e.buyer ORDER BY n DESC, e.buyer LIMIT ${BUYERS_MAX}`;

// Every records statement this feature reads, reused ones included, for the
// tests that read their plans and bounds.
export const CLAIM_RECORDS_SQL: readonly string[] = [
  ORG_COUNTS_SQL, CLAIM_SEGMENTS_SQL, CLAIM_SHARE_SQL, CLAIM_SHARE_LARGEST_SQL, RADAR_ROWS_END_SQL, RADAR_TOTAL_SQL, RADAR_CSV_END_SQL,
  CLAIM_BUYERS_SQL, WEEK_RECORDS_SQL, WEEK_ENDING_SQL, WEEK_BUYERS_SQL,
];

// -- the frame -------------------------------------------------------------------------

// The fiscal years and days every statement reads, from the data date.
export interface ClaimFrame {
  today: string;
  current: number;
  // The first and last fiscal year of the blocks (MAX_YEARS), and of the free view's first block.
  first: number;
  freeFirst: number;
  // The first day of the first fiscal year: the record tables' span.
  firstDay: string;
  // The radar's 12-month window.
  endLast: string;
}

// The Free view's first block covers the latest FREE_YEARS fiscal years, as
// the free analytics view does.
export function claimFrame(today: string): ClaimFrame {
  const current = fiscalYearOf(today);
  const first = current - MAX_YEARS + 1;
  return { today, current, first, freeFirst: current - FREE_YEARS + 1, firstDay: `${first}-04-01`, endLast: addDays(today, ENDING_DAYS) };
}

// The radar's own filter for the organization's contracts ending within 12
// months: what /expiring/12m?supplier=<id> reads (pages/expiring.tsx
// radarParams with that query alone).
export function endingParams(oid: number, f: ClaimFrame): RadarParams {
  return { first: f.today, last: f.endLast, buyer: "", client: "", oid, segment: "", comp: -1, band: null, kind: 0, fye: true, sosa: true };
}

// The share statement's binds: the segment (or, for the largest, a value the
// statement does not read), the source, the fiscal years, the organization
// and its competitors (unused slots -1, which no organization's number is).
export function shareBinds(oid: number, competitors: readonly number[], source: MoneySource, segment: number | null, f: ClaimFrame): (string | number)[] {
  const slots = [oid, ...competitors.slice(0, COMPETITORS_MAX)];
  while (slots.length < SHARE_SLOTS) slots.push(-1);
  return [segment ?? -1, SOURCE_NUMBER[source], f.first, f.current, ...slots];
}

// -- the page's batch -------------------------------------------------------------------

export type BlockRows = Partial<Record<"years" | "segments" | "share" | "ending" | "endingTotal" | "buyers", Row[]>>;

export type BlocksRead = { state: "ready"; asOf: string | null; rows: BlockRows } | { state: "absent" | "loading" | "failed" };

// One batch for the page: a Free view reads the first block for the latest
// FREE_YEARS fiscal years; a Pro view every block over MAX_YEARS.
export async function readBlocks(
  env: Env, oid: number, competitors: readonly number[], o: { pro: boolean; source: MoneySource; segment: number | null; frame: ClaimFrame },
): Promise<BlocksRead> {
  const f = o.frame;
  const named: [keyof BlockRows, Query][] = [["years", { sql: ORG_COUNTS_SQL, params: [oid, o.pro ? f.first : f.freeFirst, f.current] }]];
  if (o.pro) {
    const radar = radarBinds(endingParams(oid, f));
    named.push(
      ["segments", { sql: CLAIM_SEGMENTS_SQL, params: [oid, f.first, f.current] }],
      ["share", { sql: o.segment === null ? CLAIM_SHARE_LARGEST_SQL : CLAIM_SHARE_SQL, params: shareBinds(oid, competitors, o.source, o.segment, f) }],
      ["ending", { sql: RADAR_ROWS_END_SQL, params: [...radar, 0] }],
      ["endingTotal", { sql: RADAR_TOTAL_SQL, params: radar }],
      ["buyers", { sql: CLAIM_BUYERS_SQL, params: [oid, f.firstDay, f.today, f.today, f.endLast] }],
    );
  }
  const read: Read = await readRecords(env, named.map(([, q]) => q));
  if (read.state !== "ready") return { state: read.state };
  const rows: BlockRows = {};
  named.forEach(([name], i) => (rows[name] = read.rows[i] ?? []));
  return { state: "ready", asOf: read.asOf, rows };
}

// One block's rows for its CSV file, read alone (the ending block's whole window).
export async function readBlockCsv(
  env: Env, block: ClaimBlock, oid: number, competitors: readonly number[], o: { source: MoneySource; segment: number | null; frame: ClaimFrame },
): Promise<Read> {
  const f = o.frame;
  const q: Query[] = block === "years" ? [{ sql: ORG_COUNTS_SQL, params: [oid, f.first, f.current] }]
    : block === "segments" ? [{ sql: CLAIM_SEGMENTS_SQL, params: [oid, f.first, f.current] }]
    : block === "share" ? [
      { sql: o.segment === null ? CLAIM_SHARE_LARGEST_SQL : CLAIM_SHARE_SQL, params: shareBinds(oid, competitors, o.source, o.segment, f) },
      // The share's segment when it is the largest: the segments block names it.
      { sql: CLAIM_SEGMENTS_SQL, params: [oid, f.first, f.current] },
    ]
    : block === "ending" ? [{ sql: RADAR_CSV_END_SQL, params: radarBinds(endingParams(oid, f)) }]
    : [{ sql: CLAIM_BUYERS_SQL, params: [oid, f.firstDay, f.today, f.today, f.endLast] }];
  return readRecords(env, q);
}

// The segment the share block shows: the one chosen, else the largest of the
// segments block's rows for the share's source (the rule LARGEST_SEGMENT applies).
export function shareSegment(chosen: string | null, segments: readonly Row[], source: MoneySource): number | null {
  if (chosen !== null && SEGMENT_CODES.includes(chosen)) return Number(chosen);
  const top = segments.find((r) => num(r.src) === SOURCE_NUMBER[source]);
  return top ? num(top.sid) : null;
}

// -- the claim in the accounts database ------------------------------------------------------

export interface Claim {
  organizationId: string;
  // Two digits, or null for the organization's largest.
  segment: string | null;
  competitors: string[];
  createdAt: string;
  updatedAt: string;
  // The stored list as written, for the compare-and-set of an update.
  stored: string;
}

export const CLAIM_READ_SQL =
  "SELECT organization_id, segment, competitors, created_at, updated_at FROM org_claims WHERE user_id = ? LIMIT 1";

// A second claim replaces the first: another organization starts the claim
// again (its time, the segment), the competitors stay (the page leaves out
// the new organization's own id from them).
export const CLAIM_WRITE_SQL =
  "INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?1, ?2, NULL, '[]', ?3, ?3) " +
  "ON CONFLICT (user_id) DO UPDATE SET " +
  "segment = CASE WHEN org_claims.organization_id = excluded.organization_id THEN org_claims.segment ELSE NULL END, " +
  "created_at = CASE WHEN org_claims.organization_id = excluded.organization_id THEN org_claims.created_at ELSE excluded.created_at END, " +
  "organization_id = excluded.organization_id, updated_at = excluded.updated_at";

// The competitors, written only over the list the page read (two posts at
// once cannot both add a fifth), and never past COMPETITORS_MAX (the table's
// CHECK says the same).
export const COMPETITORS_WRITE_SQL =
  `UPDATE org_claims SET competitors = ?1, updated_at = ?2 WHERE user_id = ?3 AND competitors = ?4 AND json_array_length(?1) <= ${COMPETITORS_MAX}`;

export const SEGMENT_WRITE_SQL = "UPDATE org_claims SET segment = ?1, updated_at = ?2 WHERE user_id = ?3";

// The claim follows a merge: the retired id is pointed at the surviving one.
export const CLAIM_REPOINT_SQL = "UPDATE org_claims SET organization_id = ?1, updated_at = ?2 WHERE user_id = ?3 AND organization_id = ?4";

export const CLAIM_DELETE_SQL = "DELETE FROM org_claims WHERE user_id = ?";

// The console: the claims in all and this week (?1 a week ago), and the most-claimed organizations.
export const CLAIM_COUNTS_SQL =
  "SELECT (SELECT COUNT(*) FROM org_claims) AS n, (SELECT COUNT(*) FROM org_claims WHERE created_at >= ?1) AS week";
export const CLAIM_TOP_N = 10;
export const CLAIM_TOP_SQL =
  `SELECT organization_id, COUNT(*) AS n FROM org_claims GROUP BY organization_id ORDER BY n DESC, organization_id LIMIT ${CLAIM_TOP_N}`;

// Every accounts statement, for the tests that read their plans.
export const CLAIM_ACCOUNTS_SQL: readonly string[] = [
  CLAIM_READ_SQL, CLAIM_WRITE_SQL, COMPETITORS_WRITE_SQL, SEGMENT_WRITE_SQL, CLAIM_REPOINT_SQL, CLAIM_DELETE_SQL, CLAIM_COUNTS_SQL, CLAIM_TOP_SQL,
];

// The stored list as ids: organization ids only, each once, at most COMPETITORS_MAX.
export function readCompetitors(text: string | null | undefined): string[] {
  let v: unknown;
  try {
    v = JSON.parse(text ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const id of v) if (typeof id === "string" && ORG_ID_RE.test(id) && !out.includes(id)) out.push(id);
  return out.slice(0, COMPETITORS_MAX);
}

type ClaimRow = { organization_id: string; segment: string | null; competitors: string; created_at: string; updated_at: string };

// The account's claim, or null. Throws on a database fault, a missing table included.
export async function readClaim(env: Env, userId: string): Promise<Claim | null> {
  const row = await env.ACCOUNTS!.prepare(CLAIM_READ_SQL).bind(userId).first<ClaimRow>();
  if (!row || !ORG_ID_RE.test(row.organization_id)) return null;
  return {
    organizationId: row.organization_id, segment: row.segment && SEGMENT_CODES.includes(row.segment) ? row.segment : null,
    competitors: readCompetitors(row.competitors).filter((id) => id !== row.organization_id), createdAt: row.created_at,
    updatedAt: row.updated_at, stored: row.competitors,
  };
}

// An organization id as the form or the search box gives it: an id, or the
// address of a profile (a path or a full address) that holds one. Only the
// id is kept; checkOrganization then asks the data.
export function orgIdIn(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (ORG_ID_RE.test(v)) return v;
  const m = /(?:^|\/)organizations\/(org-[0-9a-f]{10})(?:[/?#]|$)/.exec(v);
  return m ? m[1] : null;
}

// The id checked as the profile checks it: a profile the files hold, or the
// surviving id of a retired one (the aliases the profiles redirect through).
export async function checkOrganization(env: Env, id: string): Promise<{ id: string; profile: Profile } | null> {
  if (!ORG_ID_RE.test(id)) return null;
  const profile = await loadProfile(env, id).catch(() => null);
  if (profile) return { id, profile };
  const live = await loadAlias(env, id).catch(() => null);
  if (!live) return null;
  const moved = await loadProfile(env, live).catch(() => null);
  return moved ? { id: live, profile: moved } : null;
}

export async function claimOrganization(env: Env, userId: string, id: string, now = new Date()): Promise<void> {
  await env.ACCOUNTS!.prepare(CLAIM_WRITE_SQL).bind(userId, id, now.toISOString()).run();
}

export type CompareResult = "added" | "removed" | "exists" | "self" | "full" | "none" | "busy";

// One competitor more, or one fewer, written over the list the claim was read with.
export async function changeCompetitors(env: Env, userId: string, claim: Claim, id: string, add: boolean, now = new Date()): Promise<CompareResult> {
  if (add) {
    if (id === claim.organizationId) return "self";
    if (claim.competitors.includes(id)) return "exists";
    if (claim.competitors.length >= COMPETITORS_MAX) return "full";
  } else if (!claim.competitors.includes(id)) {
    return "none";
  }
  const next = add ? [...claim.competitors, id] : claim.competitors.filter((x) => x !== id);
  const res = await env.ACCOUNTS!.prepare(COMPETITORS_WRITE_SQL).bind(JSON.stringify(next), now.toISOString(), userId, claim.stored).run();
  return (res.meta?.changes ?? 0) === 1 ? (add ? "added" : "removed") : "busy";
}

export async function setClaimSegment(env: Env, userId: string, segment: string | null, now = new Date()): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(SEGMENT_WRITE_SQL).bind(segment, now.toISOString(), userId).run();
  return (res.meta?.changes ?? 0) === 1;
}

export async function deleteClaim(env: Env, userId: string): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(CLAIM_DELETE_SQL).bind(userId).run();
  return (res.meta?.changes ?? 0) === 1;
}

// What deleting an account removes here (routes.tsx deleteAccount): the
// claim. A database without the table yet holds none, so a missing table is
// no fault here.
export async function deleteClaimOf(env: Env, userId: string): Promise<void> {
  try {
    await env.ACCOUNTS!.prepare(CLAIM_DELETE_SQL).bind(userId).run();
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

// -- following merges ---------------------------------------------------------------------

export interface Followed {
  claim: Claim;
  // The claimed organization's profile; null when the files no longer hold it.
  own: Profile | null;
  competitors: { id: string; profile: Profile }[];
  // The claim was pointed at a surviving id; how many competitors moved, and
  // how many were dropped (gone from the data, or the same as another).
  moved: boolean;
  repointed: number;
  dropped: number;
}

// The claim as the data now stands: a retired organization id is followed
// to the one that took its records, as a watch follows it (data.ts
// loadAlias); a competitor that no longer exists is dropped from the set;
// the row is written back only when something changed.
export async function followClaim(env: Env, userId: string, claim: Claim, now = new Date()): Promise<Followed> {
  let own = await loadProfile(env, claim.organizationId).catch(() => null);
  let ownId = claim.organizationId;
  let moved = false;
  if (!own) {
    const live = await checkOrganization(env, claim.organizationId);
    if (live && live.id !== claim.organizationId) {
      const res = await env.ACCOUNTS!.prepare(CLAIM_REPOINT_SQL).bind(live.id, now.toISOString(), userId, claim.organizationId).run();
      if ((res.meta?.changes ?? 0) === 1) {
        own = live.profile;
        ownId = live.id;
        moved = true;
      }
    }
  }
  const competitors: { id: string; profile: Profile }[] = [];
  let repointed = 0;
  let dropped = 0;
  for (const id of claim.competitors) {
    const found = await checkOrganization(env, id);
    if (!found || found.id === ownId || competitors.some((x) => x.id === found.id)) {
      dropped++;
      continue;
    }
    if (found.id !== id) repointed++;
    competitors.push(found);
  }
  const next = competitors.map((x) => x.id);
  let stored = claim.stored;
  const text = JSON.stringify(next);
  if (text !== claim.stored) {
    const res = await env.ACCOUNTS!.prepare(COMPETITORS_WRITE_SQL).bind(text, now.toISOString(), userId, claim.stored).run();
    if ((res.meta?.changes ?? 0) === 1) stored = text;
  }
  return { claim: { ...claim, organizationId: ownId, competitors: next, stored }, own, competitors, moved, repointed, dropped };
}

// -- finding an organization -------------------------------------------------------------------

export interface OrgHit { id: string; name: string; city: string | null; prov: string | null; n: number }
export type Found = { hits: OrgHit[]; total: number } | null;
// The search's first rows shown under the box.
export const SEARCH_SHOWN = 25;

// The organizations a search box names: a pasted profile address (or an id)
// read from the files, anything else through the hosted search with the
// statements /search runs (search_db.ts), its first SEARCH_SHOWN. Null when
// the search cannot answer (no database, a fault).
export async function findOrganizations(env: Env, raw: string): Promise<Found> {
  const id = orgIdIn(raw);
  if (id) {
    const found = await checkOrganization(env, id);
    if (!found) return { hits: [], total: 0 };
    const o = found.profile.organization;
    return { hits: [{ id: found.id, name: o.display_name, city: o.city, prov: o.province, n: o.n_awards + o.n_history + o.n_contracts + o.n_grants }], total: 1 };
  }
  const terms = searchTerms(raw.slice(0, MAX_Q));
  if (!terms.terms.length) return { hits: [], total: 0 };
  const db = env.SEARCH;
  if (!db) return null;
  const page = orgSelect(terms, 1);
  const count = counts(terms)[0];
  try {
    const [n, rows] = await db.batch<Record<string, unknown>>([
      db.prepare(count.sql).bind(...count.params), db.prepare(page.sql).bind(...page.params),
    ]);
    const total = Number(n.results?.[0]?.n ?? 0) || 0;
    const hits = (rows.results ?? []).slice(0, SEARCH_SHOWN).map((r) => toOrgHit(r, terms.terms)).filter((h) => ORG_ID_RE.test(h.id))
      .map((h) => ({ id: h.id, name: h.name, city: h.city, prov: h.prov === "UN" ? null : h.prov, n: h.n_records }));
    return { hits, total };
  } catch (e) {
    console.error(`[org] search: query failed (${faultSummary(e)})`);
    return null;
  }
}

// -- the overview and the console --------------------------------------------------------------

// The overview's line: the claimed organization's name (null when the files
// no longer hold it), false when there is no claim, undefined before the
// table exists.
export async function claimSummary(env: Env, userId: string): Promise<{ id: string; name: string | null } | false | undefined> {
  let claim: Claim | null;
  try {
    claim = await readClaim(env, userId);
  } catch (e) {
    if (missingTable(e)) return undefined;
    throw e;
  }
  if (!claim) return false;
  const profile = await loadProfile(env, claim.organizationId).catch(() => null);
  return { id: claim.organizationId, name: profile?.organization.display_name ?? null };
}

export type ClaimOverview = { n: number; week: number; top: { id: string; n: number }[] };

export async function claimOverview(env: Env, now = new Date()): Promise<ClaimOverview | null> {
  const db = env.ACCOUNTS!;
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  try {
    const [counts, top] = await db.batch([db.prepare(CLAIM_COUNTS_SQL).bind(week), db.prepare(CLAIM_TOP_SQL)]);
    const c = (counts.results?.[0] ?? {}) as { n?: number; week?: number };
    return {
      n: c.n ?? 0, week: c.week ?? 0,
      top: ((top.results ?? []) as { organization_id: string; n: number }[]).map((r) => ({ id: r.organization_id, n: r.n })),
    };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// One account's claim for the console's user page; null before the table exists.
export async function claimDetail(env: Env, userId: string): Promise<Claim | false | null> {
  try {
    return (await readClaim(env, userId)) ?? false;
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// -- the weekly block of the watch mail -----------------------------------------------------------

export interface WeekFacts {
  // New records naming the organization in the week, by source number.
  records: { src: number; n: number }[];
  ending: { n: number; cents: number | null; soonest: string | null };
  buyers: { id: string; name_en: string; name_fr: string | null; n: number }[];
}

export type WeekRead = { state: "ready"; facts: WeekFacts } | { state: "absent" | "loading" | "failed" | "stale" };

// The week's three facts in one batch with the state row; the records
// database must be at the run's data date. Nothing here throws.
export async function readWeek(env: Env, oid: number, dataDate: string): Promise<WeekRead> {
  const db = env.RECORDS;
  if (!db) return { state: "absent" };
  const f = claimFrame(dataDate);
  const from = addDays(dataDate, -(WEEK_DAYS - 1));
  let results: D1Result<Row>[];
  try {
    results = await db.batch<Row>([
      db.prepare(STATE_SQL),
      db.prepare(WEEK_RECORDS_SQL).bind(oid, from, dataDate),
      db.prepare(WEEK_ENDING_SQL).bind(f.today, f.endLast, oid),
      db.prepare(WEEK_BUYERS_SQL).bind(oid, f.firstDay, f.today, from, dataDate),
    ]);
  } catch (e) {
    console.error(`[org] records: query failed (${faultSummary(e)})`);
    return { state: "failed" };
  }
  const meta = new Map((results[0]?.results ?? []).map((r) => [String(r.key), String(r.value)]));
  if (meta.get("state") !== "ready") return { state: "loading" };
  if (meta.get("as_of") !== dataDate) return { state: "stale" };
  const e = results[2]?.results?.[0] ?? {};
  return {
    state: "ready",
    facts: {
      records: (results[1]?.results ?? []).map((r) => ({ src: num(r.src) ?? 0, n: num(r.n) ?? 0 })).filter((r) => r.n > 0),
      ending: { n: num(e.n) ?? 0, cents: num(e.cents), soonest: typeof e.soonest === "string" ? e.soonest : null },
      buyers: (results[3]?.results ?? []).filter((r) => typeof r.id === "string" && typeof r.name_en === "string").map((r) => ({
        id: r.id as string, name_en: r.name_en as string, name_fr: typeof r.name_fr === "string" ? r.name_fr : null, n: num(r.n) ?? 0,
      })),
    },
  };
}

// Each source's words in the first line: "1 award notice", "2 published contracts".
const WEEK_SOURCE: Readonly<Record<number, [Key, Key]>> = {
  1: ["orgclaim.week_awards_one", "orgclaim.week_awards_many"], 2: ["orgclaim.week_history_one", "orgclaim.week_history_many"],
  3: ["orgclaim.week_contracts_one", "orgclaim.week_contracts_many"], 4: ["orgclaim.week_grants_one", "orgclaim.week_grants_many"],
};

// The block's lines from the week's facts: each a count with its link, a
// count of zero left out; no line at all gives the one-line block.
export function weekOpening(lang: Lang, site: string, id: string, name: string, f: WeekFacts): DigestOpening {
  const lines: { text: string; url: string }[] = [];
  const n = (v: number) => fmtInt(v, lang);
  const records = f.records.reduce((sum, r) => sum + r.n, 0);
  if (records > 0) {
    const parts = f.records.filter((r) => WEEK_SOURCE[r.src]).map((r) => tn(lang, WEEK_SOURCE[r.src][0], WEEK_SOURCE[r.src][1], r.n, { n: n(r.n) }));
    lines.push({
      text: t(lang, "orgclaim.week_records", { n: n(records), parts: parts.join(", ") }),
      url: siteLink(site, `/organizations/${id}/records`, lang),
    });
  }
  if (f.ending.n > 0 && f.ending.soonest) {
    const vars = { n: n(f.ending.n), date: f.ending.soonest, total: f.ending.cents === null ? "" : fmtMoney(f.ending.cents / 100, lang) };
    lines.push({
      text: t(lang, f.ending.cents === null ? "orgclaim.week_ending_no_total" : "orgclaim.week_ending", vars),
      url: siteLink(site, `/expiring/12m?supplier=${id}`, lang),
    });
  }
  if (f.buyers.length) {
    const named = f.buyers.slice(0, WEEK_BUYERS_NAMED).map((b) => `${pick(lang, b.name_en, b.name_fr) ?? b.id} (${n(b.n)})`).join(", ");
    const rest = f.buyers.length - WEEK_BUYERS_NAMED;
    const names = rest > 0 ? t(lang, "orgclaim.week_buyers_more", { names: named, n: n(rest) }) : named;
    lines.push({ text: t(lang, "orgclaim.week_buyers", { names }), url: siteLink(site, "/account/organization", lang) });
  }
  return {
    subject: t(lang, "orgclaim.week_subject", { name }),
    heading: lines.length ? t(lang, "orgclaim.week_heading", { name }) : t(lang, "orgclaim.week_nothing"),
    lines,
  };
}

// The block for an account's weekly watch mail: its claim followed to the
// live profile, the week to the data date read, the lines written in the
// account's language. Null when the account claims nothing, the claimed
// organization is no longer in the data, or the records database is not at
// the data date (the message then goes without the block). The watch mail's
// run calls this on the account's weekly day and passes the result to
// watchDigest as `opening`.
export async function orgWeekOpening(env: Env, o: { userId: string; lang: Lang; site: string; dataDate: string }): Promise<DigestOpening | null> {
  let claim: Claim | null;
  try {
    claim = await readClaim(env, o.userId);
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
  if (!claim) return null;
  const found = await checkOrganization(env, claim.organizationId);
  const oid = found ? orgNumber(found.id) : null;
  if (!found || oid === null) return null;
  const week = await readWeek(env, oid, o.dataDate);
  if (week.state !== "ready") return null;
  return weekOpening(o.lang, o.site, found.id, found.profile.organization.display_name, week.facts);
}
