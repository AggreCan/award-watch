// The dashboard (docs/accounts.md, Dashboard): up to boardCap(plan)
// dashboards an Ultra account keeps, each a grid of up to tileCap(plan)
// tiles it chooses from what the site already shows it, each at its own
// place and size on 12 columns (public/dash-grid.js holds the grid's rules;
// dashboard_fit.ts turns a tile's size into the rows it lists and the size
// of its chart). The first dashboard is at /account/dashboard, every one at
// /account/dashboard/<id> as well, a row of tabs above the grid leading
// from one to another. routes.tsx mounts the pages, their posts and the one
// read; the rail's item is the shell's (src/layout.tsx, dashboard_rule.ts
// dashboardInRail); "Add to dashboard" is dashboard_add.tsx; the page's
// script is public/dashboard.js.
//
// Each kind of tile is a reader the account pages already have, with a LIMIT
// of the tile's rows where it lists rows, and nothing else: no new statement
// about the data but the radar's short form (RADAR_TOP_SQL). A page view is
// the account's rows (read in parallel by the readers the account pages use),
// one records batch holding every tile's statements (each tile is read on its
// own only when that batch fails, so one tile that cannot be read leaves the
// others), the watches' and the briefings' own readers, which send their own
// batches, and at most two parsed static files (the open notices, and the
// claimed organization's profile shard). A Free or Pro account reads none of
// it: the page says what the dashboard holds, with the plan cards.
//
// The layout lives in the accounts database, in one of three states, and the
// page works in each:
// - the tables dashboards and dashboard_tiles absent (accounts_schema.sql not
//   applied since the grid): one dashboard, the account's dashboard_panels
//   rows, or the starting layout, laid out on the grid (fromPanels); the page
//   arranges them but saves no place or size, and says so; adding and
//   removing go to dashboard_panels as before, while that table is there; no
//   tabs, since nothing could keep a second dashboard;
// - the tables present and the account holding no dashboard: the same layout
//   as its one dashboard, computed and not stored; the first change of any
//   kind (a new dashboard, a name, a deletion included) writes the whole
//   layout as the account's first dashboard (writeFirst), then applies;
// - dashboards stored: each with its tiles, and dashboard_panels is read no
//   more for the account.
// Every layout is clamped and compacted by the grid's rules when it is read
// and before it is written; a stored place is never trusted. Each dashboard
// holds its own tiles: the cap, the briefings' cap and the same item once are
// each a dashboard's, so an item may sit on two dashboards, once on each.
//
// More Kinds of Tile (moreKinds) lists the kinds the account cannot add yet,
// each with the step that gives it what the tile shows, from the rows above
// and nothing else read.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { addDays } from "../../public/closing.js";
import {
  COLS, type Step, type Tile, fromPanels, normalize, place, resize, stack, startSize, stepTile, steps as stepsOf, takesBoth,
} from "../../public/dash-grid.js";
import { MATCH_MIN, blockState, rankNotices, type Score } from "../../public/fit.js";
import { templatePieces } from "../../public/refresh.js";
import { keyQuota } from "../api_keyed_spec";
import { ChartStack, type AxisLabel, barGap, fiscalAxis, moneyTip, recordsText, tipHead, tipText, type Panel as ChartPanel } from "../chart";
import { type Clock, clockOf, closingPassed } from "../closing";
import { Table } from "../columns";
import { MONEY_SOURCES, type MoneySource } from "../constants";
import {
  BUYER_ID_RE, EXPIRING_WINDOWS, type ExpiringRow, type ExpiringWindow, ORG_ID_RE, SEGMENT_RE, type Profile, type TenderRow, loadOpenList, loadStats,
  publishedReference,
} from "../data";
import type { AppEnv, Env } from "../env";
import { FitDisclaimer, MatchBand, countsText, profileMatching } from "../fit";
import { fmtInt, fmtMoney, fmtMoneyShort, fmtPct, pick, segmentLabel, sourceLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import { instrumentPath } from "../instruments";
import { ClientData, Layout, PageHead, Panel, page, todayOf } from "../layout";
import { contractReference, radarParams, radarRow, readExpiringQuery, sitePath as recordPath } from "../pages/expiring";
import { money } from "../pages/shared";
import { filterTenders, readTenderQuery } from "../pages/tenders";
import { PlanCards, checkoutPrice, dashboardsWording, planCards, ultraCheckoutPrice } from "../pro";
import {
  BUYER_QUARTERS_SQL, EARLIEST_FY, MAX_YEARS, ORG_YEARS_SQL, PERIODS, ULTRA_YEARS, SEGMENT_SOURCES, SEGMENT_YEARS_SQL, SOURCE_NUMBER, type Query, type Read,
  type Row, fiscalLabel, fiscalYearOf, num, orgNumber, readRecords, segmentCode, segmentNumber,
} from "../records_db";
import { RADAR_PROV_ROWS_END_SQL, RADAR_PROV_TOTAL_SQL, RADAR_ROWS_END_SQL, RADAR_TOTAL_SQL, radarBinds, radarProvBinds } from "../records_tables";
import { type KeyRow, listKeys } from "./api_keys";
import { keyUsage, nowOf } from "./api_usage";
import { briefingLabel } from "./briefing_pages";
import { type Briefing, briefingPath, listBriefings, readBriefing, weekAnchor } from "./briefings";
import { BOARD_NAME_MAX, boardLabels } from "./dashboard_add";
import { type ChartFit, ROWS_MAX, tileFit } from "./dashboard_fit";
import { DASHBOARD_PATH, boardCap, boardPath, holdsDashboard, missingTiles, tileCap } from "./dashboard_rule";
import { EVENT_KEY, watchEventLines } from "./digests";
import { allowed, matchCap, type Plan } from "./entitlements";
import {
  CLAIM_BLOCKS, CLAIM_BUYERS_SQL, CLAIM_INSTRUMENTS_SQL, CLAIM_SEGMENTS_SQL, CLAIM_SHARE_LARGEST_SQL, CLAIM_SHARE_SQL, type Claim, type ClaimBlock,
  type ClaimFrame, checkOrganization, claimFrame, endingParams, isClaimBlock, readClaim, shareBinds, shareSegment,
} from "./org_claim";
import { ultraOnSale } from "./payments";
import {
  BUYER_COUNTS_SQL, BUYER_NAME_SQL, KIND_SOURCES, ORG_COUNTS_SQL, ORG_NAME_SQL, type RecordsKind, SEGMENT_COUNTS_SQL, entityOf, isRecordsKind,
  missingTable,
} from "./records_deliveries";
import { type SavedView, cleanName, listViews } from "./saved_views";
import { type SavedSearch, listSearches } from "./searches";
import { newId } from "./secrets";
import { type Account, csrfValid } from "./session";
import { type EventKind, type EventRow, type EventsRead, eventIdentity, foundKey, listed, readEvents } from "./watch_events";
import { watchLabel } from "./watch_mail";
import { type Watch, listWatches } from "./watches";

// -- the kinds and the rules ------------------------------------------------------------

// The kinds of tile, in the order the page explains them and the Add select
// lists them. The tables hold kind as text (no CHECK), so a new kind needs no
// rebuild of a table; a stored kind the site no longer knows is not shown.
export const PANEL_KINDS = ["tenders", "radar", "records", "watches", "view", "briefing", "org", "matches", "api"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];
// The row of dashboard_panels that says an account emptied the layout it
// wrote there, before the tiles' tables: a kind no tile has (isPanelKind
// refuses it, so no page shows it and no post can name it), ref '', place
// -1. One an account (the table's unique key). The tiles' tables need none:
// a dashboards row with no tile is an emptied dashboard.
export const LAYOUT_MARKER = "layout";
export const isPanelKind = (v: unknown): v is PanelKind => typeof v === "string" && (PANEL_KINDS as readonly string[]).includes(v);

// The briefings a dashboard holds (each briefing reads its own batch of eight statements).
export const BRIEFING_PANELS_MAX = 2;
// The data dates a watches tile reads: the week ending with the data date.
export const WATCH_DAYS = 7;

const KIND_KEY: Readonly<Record<PanelKind, Key>> = {
  tenders: "dash.kind_tenders", radar: "dash.kind_radar", records: "dash.kind_records", watches: "dash.kind_watches", view: "dash.kind_view",
  briefing: "dash.kind_briefing", org: "dash.kind_org", matches: "dash.kind_matches", api: "dash.kind_api",
};
const WHAT_KEY: Readonly<Record<PanelKind, Key>> = {
  tenders: "dash.what_tenders", radar: "dash.what_radar", records: "dash.what_records", watches: "dash.what_watches", view: "dash.what_view",
  briefing: "dash.what_briefing", org: "dash.what_org", matches: "dash.what_matches", api: "dash.what_api",
};
// Each block of "Your organization" by its page's own panel title (org_pages.tsx).
const BLOCK_KEY: Readonly<Record<ClaimBlock, Key>> = {
  years: "orgclaim.panel_years", segments: "orgclaim.panel_segments", share: "orgclaim.panel_share", ending: "orgclaim.panel_ending",
  buyers: "orgclaim.panel_buyers", instruments: "orgclaim.panel_instruments",
};
const WINDOW_KEY: Readonly<Record<ExpiringWindow, Key>> = { "3m": "rail.ending_3m_full", "6m": "rail.ending_6m_full", "12m": "rail.ending_12m_full" };
const isWindow = (v: string): v is ExpiringWindow => (EXPIRING_WINDOWS as readonly string[]).includes(v);

// The radar's page of rows (records_tables.ts RADAR_ROWS_END_SQL, soonest end
// first, through rec_expiring_end) with its offset dropped and its LIMIT the
// tile's rows (?13, at most ROWS_MAX): the short form the dashboard reads.
// The same twelve binds as the total, then the rows.
export const RADAR_TOP_SQL = RADAR_ROWS_END_SQL.replace(/ LIMIT \d+ OFFSET \?13$/, " LIMIT ?13");

// -- an analytics view as a tile's ref ---------------------------------------------------

// A view's address as its page writes it: the view's path, its source and its
// period (the latest years, or a first and last fiscal year), the keys in
// order. The other parameters a view reads (a segment, the organizations it
// compares) change none of its first chart and are left out; anything else
// makes the address no view's.
export type ViewRef = {
  view: "buyer" | "organization" | "segment"; id: string; source: MoneySource; years: number | null; from: number | null; to: number | null;
};
const VIEW_PATH_RE = /^\/(buyers|organizations|segments)\/([a-z0-9-]{1,80})\/analytics$/;
const VIEW_KEYS = new Set(["source", "years", "from", "to", "segment", "vs", "lang"]);
const YEAR_RE = /^[0-9]{4}$/;
const VIEW_OF = { buyers: "buyer", organizations: "organization", segments: "segment" } as const;
export const viewSources = (view: ViewRef["view"]): readonly MoneySource[] => (view === "segment" ? SEGMENT_SOURCES : MONEY_SOURCES);

export function viewRef(raw: string): ViewRef | null {
  if (typeof raw !== "string" || raw.length > 300) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://view.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://view.invalid" || url.hash) return null;
  const m = VIEW_PATH_RE.exec(url.pathname);
  if (!m) return null;
  const view = VIEW_OF[m[1] as keyof typeof VIEW_OF];
  const id = m[2];
  if (view === "buyer" ? !BUYER_ID_RE.test(id) : view === "organization" ? !ORG_ID_RE.test(id) : !(SEGMENT_RE.test(id) && segmentNumber(id) !== null)) return null;
  for (const k of url.searchParams.keys()) if (!VIEW_KEYS.has(k)) return null;
  const one = (k: string) => (url.searchParams.getAll(k).length > 1 ? undefined : url.searchParams.get(k));
  const source = one("source");
  if (!source || !(viewSources(view) as readonly string[]).includes(source)) return null;
  const years = one("years");
  const from = one("from");
  const to = one("to");
  if (years === undefined || from === undefined || to === undefined) return null;
  if (from !== null || to !== null) {
    if (!from || !to || !YEAR_RE.test(from) || !YEAR_RE.test(to) || Number(from) > Number(to) || Number(from) < EARLIEST_FY) return null;
    return { view, id, source: source as MoneySource, years: null, from: Number(from), to: Number(to) };
  }
  if (!years || !(PERIODS as readonly number[]).includes(Number(years))) return null;
  return { view, id, source: source as MoneySource, years: Number(years), from: null, to: null };
}

const VIEW_BASE = { buyer: "buyers", organization: "organizations", segment: "segments" } as const;

// The address stored and linked: the path, then source and the period, the keys in order.
export function viewAddress(v: ViewRef): string {
  const pairs: [string, string][] = v.years !== null
    ? [["source", v.source], ["years", String(v.years)]]
    : [["from", String(v.from)], ["source", v.source], ["to", String(v.to)]];
  return `/${VIEW_BASE[v.view]}/${v.id}/analytics?${new URLSearchParams(pairs).toString()}`;
}

// The fiscal years a view's ref covers at a data date: the latest n, or the
// chosen span held to the data date's year and to ULTRA_YEARS (its latest):
// the dashboard is Ultra's, and an Ultra reader's view reads that many.
export function viewSpan(v: ViewRef, today: string): { first: number; last: number; current: number } | null {
  const current = fiscalYearOf(today);
  if (v.years !== null) return { first: current - v.years + 1, last: current, current };
  const last = Math.min(v.to ?? current, current);
  const first = Math.max(v.from ?? last, last - ULTRA_YEARS + 1, EARLIEST_FY);
  return first <= last ? { first, last, current } : null;
}

// -- the panels' table, before the grid -------------------------------------------------------------

export type PanelRow = { id: string; kind: string; ref: string; pos: number; wide: number; created_at: string };

export const PANELS_LIST_SQL = "SELECT id, kind, ref, pos, wide, created_at FROM dashboard_panels WHERE user_id = ? ORDER BY pos, created_at, id LIMIT 50";

// One insert held to the plan's figure and to BRIEFING_PANELS_MAX briefings
// inside the statement, so two posts at once cannot pass either; the same item
// once (the table's unique key). ?1 the id, ?2 the user, ?3 the kind, ?4 the
// ref, ?5 wide, ?6 the time, ?7 the plan's figure, ?8 the briefings' cap. The
// layout's marker takes neither a place nor a count. Used while the tiles'
// tables are absent.
export const ADD_PANEL_SQL =
  "INSERT INTO dashboard_panels (id, user_id, kind, ref, pos, wide, created_at) " +
  `SELECT ?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(pos), -1) + 1 FROM dashboard_panels WHERE user_id = ?2 AND kind <> '${LAYOUT_MARKER}'), ?5, ?6 ` +
  `WHERE (SELECT COUNT(*) FROM dashboard_panels WHERE user_id = ?2 AND kind <> '${LAYOUT_MARKER}') < ?7 ` +
  "AND (?3 <> 'briefing' OR (SELECT COUNT(*) FROM dashboard_panels WHERE user_id = ?2 AND kind = 'briefing') < ?8) " +
  "ON CONFLICT (user_id, kind, ref) DO NOTHING";

// The marker, written when the account holds no panel any more: ?1 a new id,
// ?2 the user, ?3 the time. With the removal in one batch, after it.
const MARK_EMPTIED_SQL =
  "INSERT INTO dashboard_panels (id, user_id, kind, ref, pos, wide, created_at) " +
  `SELECT ?1, ?2, '${LAYOUT_MARKER}', '', -1, 1, ?3 WHERE NOT EXISTS (SELECT 1 FROM dashboard_panels WHERE user_id = ?2 AND kind <> '${LAYOUT_MARKER}') ` +
  "ON CONFLICT (user_id, kind, ref) DO NOTHING";
const markEmptied = (db: D1Database, userId: string, now = new Date()) => db.prepare(MARK_EMPTIED_SQL).bind(newId(), userId, now.toISOString());

// A fault that names dashboard_panels missing: the schema not applied since the dashboard.
export const missingPanels = (e: unknown): boolean => /no such table:?\s*dashboard_panels/i.test(String((e as { message?: unknown })?.message ?? e));

// The account's panels in order, and whether it has emptied a layout it wrote
// (the marker); null while the table is not on the database.
export async function listLayout(env: Env, userId: string): Promise<{ rows: PanelRow[]; emptied: boolean } | null> {
  try {
    const all = (await env.ACCOUNTS!.prepare(PANELS_LIST_SQL).bind(userId).all<PanelRow>()).results ?? [];
    return { rows: all.filter((r) => r.kind !== LAYOUT_MARKER), emptied: all.some((r) => r.kind === LAYOUT_MARKER) };
  } catch (e) {
    if (missingPanels(e)) return null;
    throw e;
  }
}

// The account's panels in order, or null while the table is not on the database.
export async function listPanels(env: Env, userId: string): Promise<PanelRow[] | null> {
  return (await listLayout(env, userId))?.rows ?? null;
}

// The panel of a kind and ref the account holds, by its id: where a post
// that added it, or found it added, returns to.
async function panelIdOf(env: Env, userId: string, s: Pick<Spec, "kind" | "ref">): Promise<string | null> {
  const row = await env.ACCOUNTS!.prepare("SELECT id FROM dashboard_panels WHERE user_id = ? AND kind = ? AND ref = ?")
    .bind(userId, s.kind, s.ref).first<{ id: string }>();
  return row?.id ?? null;
}

export type Spec = { kind: PanelKind; ref: string; wide: boolean };
export type AddResult = "added" | "exists" | "full" | "briefings_full" | "unsaved";

const addStatement = (db: D1Database, userId: string, plan: Plan, s: Spec, at: string) =>
  db.prepare(ADD_PANEL_SQL).bind(newId(), userId, s.kind, s.ref, s.wide ? 1 : 0, at, tileCap(plan), BRIEFING_PANELS_MAX);

export async function addPanel(env: Env, who: { userId: string; plan: Plan }, s: Spec, now = new Date()): Promise<AddResult> {
  const db = env.ACCOUNTS!;
  try {
    const res = await addStatement(db, who.userId, who.plan, s, now.toISOString()).run();
    if ((res.meta?.changes ?? 0) === 1) return "added";
    const row = await db.prepare(
      `SELECT (SELECT COUNT(*) FROM dashboard_panels WHERE user_id = ?1 AND kind <> '${LAYOUT_MARKER}') AS n, ` +
      "EXISTS (SELECT 1 FROM dashboard_panels WHERE user_id = ?1 AND kind = ?2 AND ref = ?3) AS here",
    ).bind(who.userId, s.kind, s.ref).first<{ n: number; here: number }>();
    if (row?.here === 1) return "exists";
    return (row?.n ?? 0) >= tileCap(who.plan) ? "full" : "briefings_full";
  } catch (e) {
    if (missingPanels(e)) return "unsaved";
    throw e;
  }
}

// The starting layout written as the account's panels, in one batch, before a
// first change is applied to it there; the rows as they then stand.
async function writeStarter(env: Env, who: { userId: string; plan: Plan }, specs: readonly Spec[], now: Date): Promise<PanelRow[] | null> {
  const db = env.ACCOUNTS!;
  if (specs.length) await db.batch(specs.map((s, i) => addStatement(db, who.userId, who.plan, s, new Date(now.getTime() + i).toISOString())));
  return listPanels(env, who.userId);
}

// -- the tiles' tables ---------------------------------------------------------------------------

export type TileRow = { id: string; dashboard_id?: string; kind: string; ref: string; opts: string; x: number; y: number; w: number; h: number };
// A dashboard of the account: its id, its name ('' goes by the site's label, dashboard_add.tsx boardLabels), its
// place among the account's, when it was made, and how many tiles it holds.
export type BoardRow = { id: string; name: string; pos: number; created_at: string; n: number };
// The account's dashboards in their order, and the one a request shows: its id (null while none is stored, the
// first then being the computed one) and its tiles. found is false when the request named a dashboard the account
// does not hold. Null while the tables are absent.
export type Board = { boards: BoardRow[]; id: string | null; tiles: TileRow[]; found: boolean };
// Which dashboard a read is for: one named by its id, the one holding a tile, or else the first.
export type BoardPick = { board?: string | null; tile?: string | null };

// The account's dashboards with each one's count of tiles (through idx_dashboard_tiles_board), in order. The
// LIMIT leaves room past the ceiling, so a dashboard a smaller ceiling would leave is still listed and can be deleted.
export const BOARDS_SQL =
  "SELECT d.id, d.name, d.pos, d.created_at, (SELECT COUNT(*) FROM dashboard_tiles t WHERE t.dashboard_id = d.id) AS n " +
  "FROM dashboards d WHERE d.user_id = ? ORDER BY d.pos, d.created_at, d.id LIMIT 20";
// The account's first dashboard, for the user bound at the place given.
const firstOf = (user: string) => `(SELECT id FROM dashboards WHERE user_id = ${user} ORDER BY pos, created_at, id LIMIT 1)`;
const TILE_COLS = "id, dashboard_id, kind, ref, opts, x, y, w, h";
// One dashboard's tiles, each statement through idx_dashboard_tiles_board: the first's (?1 the user); a named
// one's (?2 its id); the one holding a tile (?2 the tile's id), else the first's.
export const TILES_SQL = `SELECT ${TILE_COLS} FROM dashboard_tiles WHERE user_id = ?1 AND dashboard_id = ${firstOf("?1")} ORDER BY y, x, id LIMIT 50`;
export const BOARD_TILES_SQL = `SELECT ${TILE_COLS} FROM dashboard_tiles WHERE user_id = ?1 AND dashboard_id = ?2 ORDER BY y, x, id LIMIT 50`;
export const TILE_BOARD_SQL =
  `SELECT ${TILE_COLS} FROM dashboard_tiles WHERE user_id = ?1 AND dashboard_id = ` +
  `COALESCE((SELECT dashboard_id FROM dashboard_tiles WHERE id = ?2 AND user_id = ?1), ${firstOf("?1")}) ORDER BY y, x, id LIMIT 50`;

// The first dashboard's row, written with the account's first change unless
// one is there already (two first changes at once write one): ?1 a new id,
// ?2 the user, ?3 the time. Its name is '' (the site's label) until renamed.
export const BOARD_INSERT_SQL =
  "INSERT INTO dashboards (id, user_id, name, pos, created_at) SELECT ?1, ?2, '', 0, ?3 WHERE NOT EXISTS (SELECT 1 FROM dashboards WHERE user_id = ?2)";

// Another dashboard, after the account's others, held inside the statement to
// the plan's figure, so two posts at once cannot pass it: ?1 a new id, ?2 the
// user, ?3 the time, ?4 the plan's figure.
export const NEW_BOARD_SQL =
  "INSERT INTO dashboards (id, user_id, name, pos, created_at) " +
  "SELECT ?1, ?2, '', (SELECT COALESCE(MAX(pos), -1) + 1 FROM dashboards WHERE user_id = ?2), ?3 " +
  "WHERE (SELECT COUNT(*) FROM dashboards WHERE user_id = ?2) < ?4";
export const RENAME_BOARD_SQL = "UPDATE dashboards SET name = ?1 WHERE id = ?2 AND user_id = ?3";
export const BOARD_POS_SQL = "UPDATE dashboards SET pos = ?1 WHERE id = ?2 AND user_id = ?3";
// A dashboard deleted, in one batch: its tiles, then its row unless it is the
// account's last (held inside the statement, so two deletions at once leave
// one), and the last one's name back to the site's label: an emptied first
// dashboard, as removing the last tile leaves. ?1 the dashboard, ?2 the user.
export const DELETE_BOARD_SQL = [
  "DELETE FROM dashboard_tiles WHERE dashboard_id = ?1 AND user_id = ?2",
  "DELETE FROM dashboards WHERE id = ?1 AND user_id = ?2 AND (SELECT COUNT(*) FROM dashboards WHERE user_id = ?2) > 1",
  "UPDATE dashboards SET name = '' WHERE id = ?1 AND user_id = ?2",
] as const;

// One tile into a dashboard of the account's (?12, its id; null for the
// account's first), held inside the statement to the plan's figure, to
// BRIEFING_PANELS_MAX briefings and to the same item once on that dashboard,
// so two posts at once cannot pass any of them. ?1 the id, ?2 the user, ?3 the
// kind, ?4 the ref, ?5 to ?8 its x, y, w and h, ?9 the time, ?10 the plan's
// figure, ?11 the briefings' cap. The first change writes each tile of the
// layout through it too. No choices are written yet (opts '').
export const ADD_TILE_SQL =
  "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) " +
  `SELECT ?1, d.id, ?2, ?3, ?4, '', ?5, ?6, ?7, ?8, ?9 FROM dashboards d WHERE d.id = COALESCE(?12, ${firstOf("?2")}) AND d.user_id = ?2 ` +
  "AND (SELECT COUNT(*) FROM dashboard_tiles WHERE dashboard_id = d.id) < ?10 " +
  "AND (?3 <> 'briefing' OR (SELECT COUNT(*) FROM dashboard_tiles WHERE dashboard_id = d.id AND kind = 'briefing') < ?11) " +
  "AND NOT EXISTS (SELECT 1 FROM dashboard_tiles WHERE dashboard_id = d.id AND kind = ?3 AND ref = ?4) ON CONFLICT DO NOTHING";
export const MOVE_TILE_SQL = "UPDATE dashboard_tiles SET x = ?1, y = ?2, w = ?3, h = ?4 WHERE id = ?5 AND user_id = ?6";
export const DELETE_TILE_SQL = "DELETE FROM dashboard_tiles WHERE id = ? AND user_id = ?";
// A tile to another dashboard of the account's, at the place given, held
// inside the statement to that dashboard's figure, its briefings' cap and the
// same item once: ?1 the dashboard, ?2 to ?5 the tile's x, y, w and h there,
// ?6 the tile, ?7 the user, ?8 the plan's figure, ?9 the briefings' cap.
export const MOVE_TO_SQL =
  "UPDATE dashboard_tiles SET dashboard_id = ?1, x = ?2, y = ?3, w = ?4, h = ?5 WHERE id = ?6 AND user_id = ?7 AND dashboard_id <> ?1 " +
  "AND EXISTS (SELECT 1 FROM dashboards WHERE id = ?1 AND user_id = ?7) " +
  "AND (SELECT COUNT(*) FROM dashboard_tiles WHERE dashboard_id = ?1) < ?8 " +
  "AND (kind <> 'briefing' OR (SELECT COUNT(*) FROM dashboard_tiles WHERE dashboard_id = ?1 AND kind = 'briefing') < ?9) " +
  "AND NOT EXISTS (SELECT 1 FROM dashboard_tiles o WHERE o.dashboard_id = ?1 AND o.kind = dashboard_tiles.kind AND o.ref = dashboard_tiles.ref)";

export { missingTiles };

// The account's dashboards and the tiles of the one picked, in one batch of
// two statements; null while the tables are absent.
export async function readBoard(env: Env, userId: string, pick: BoardPick = {}): Promise<Board | null> {
  const db = env.ACCOUNTS!;
  const tiles = pick.board ? db.prepare(BOARD_TILES_SQL).bind(userId, pick.board)
    : pick.tile ? db.prepare(TILE_BOARD_SQL).bind(userId, pick.tile)
    : db.prepare(TILES_SQL).bind(userId);
  try {
    const [listed, read] = await db.batch<Record<string, unknown>>([db.prepare(BOARDS_SQL).bind(userId), tiles]);
    const boards = ((listed?.results ?? []) as BoardRow[]).map((r) => ({ ...r, n: num(r.n) ?? 0 }));
    const rows = (read?.results ?? []) as TileRow[];
    const id = pick.board ? (boards.some((b) => b.id === pick.board) ? pick.board : null) : rows[0]?.dashboard_id ?? boards[0]?.id ?? null;
    return { boards, id, tiles: id ? rows : [], found: !pick.board || id !== null };
  } catch (e) {
    if (missingTiles(e)) return null;
    throw e;
  }
}

const tolerate = async (run: () => Promise<unknown>, missing: (e: unknown) => boolean): Promise<void> => {
  try {
    await run();
  } catch (e) {
    if (!missing(e)) throw e;
  }
};

// What deleting the account removes (routes.tsx deleteAccount): the tiles,
// the dashboards and the panels, each table's absence no fault.
export async function deletePanelsOf(env: Env, userId: string): Promise<void> {
  const db = env.ACCOUNTS!;
  await tolerate(() => db.batch([
    db.prepare("DELETE FROM dashboard_tiles WHERE user_id = ?").bind(userId), db.prepare("DELETE FROM dashboards WHERE user_id = ?").bind(userId),
  ]), missingTiles);
  await tolerate(() => db.prepare("DELETE FROM dashboard_panels WHERE user_id = ?").bind(userId).run(), missingPanels);
}

// What goes with a saved search, a briefing or a view the account removes:
// its tiles, and its panels. A panel that goes and leaves the account no
// panel marks that layout emptied, as a removal from the page did there; an
// account that never wrote one has no row there, and nothing is written for
// it. A dashboard that loses its last tile stays, empty.
export async function deletePanelsFor(env: Env, userId: string, kinds: readonly PanelKind[], ref: string): Promise<void> {
  const db = env.ACCOUNTS!;
  const which = `user_id = ? AND ref = ? AND kind IN (${kinds.map(() => "?").join(", ")})`;
  await tolerate(() => db.prepare(`DELETE FROM dashboard_tiles WHERE ${which}`).bind(userId, ref, ...kinds).run(), missingTiles);
  try {
    const held = await db.prepare(`SELECT COUNT(*) AS n FROM dashboard_panels WHERE ${which}`).bind(userId, ref, ...kinds).first<{ n: number }>();
    if (!held?.n) return;
    await db.batch([db.prepare(`DELETE FROM dashboard_panels WHERE ${which}`).bind(userId, ref, ...kinds), markEmptied(db, userId)]);
  } catch (e) {
    if (!missingPanels(e)) throw e;
  }
}

// -- what the account holds -----------------------------------------------------------------

// The rows the tiles name, read by the readers the account pages use, at
// once: the account's dashboards and the tiles of the one picked, the panels,
// the saved searches, the briefings, the claim, the watches, the keys and the
// saved views. A table the database does not hold yet reads as none.
export type Holdings = {
  panels: PanelRow[] | null; searches: SavedSearch[]; briefings: Briefing[]; claim: Claim | null; watches: Watch[]; keys: KeyRow[];
  views: SavedView[];
  // The dashboards and the tiles of the one picked; null while the grid's tables are absent.
  board?: Board | null;
  // The account emptied a layout it wrote in dashboard_panels (LAYOUT_MARKER).
  emptied?: boolean;
  // The tables the database does not hold yet, of the two whose pages More Kinds of Tile sends a reader to:
  // without them nothing saves a briefing or a claim, and the line is left out. Known from the reads above.
  absent?: { briefings?: boolean; claim?: boolean };
};

async function absentAs<T>(read: Promise<T>, absent: T, seen?: () => void): Promise<T> {
  try {
    return await read;
  } catch (e) {
    if (!missingTable(e)) throw e;
    seen?.();
    return absent;
  }
}

export async function readHoldings(env: Env, userId: string, pick: BoardPick = {}): Promise<Holdings> {
  let noClaims = false;
  const [board, layout, searches, briefings, claim, watches, keys, views] = await Promise.all([
    readBoard(env, userId, pick), listLayout(env, userId), listSearches(env, userId), listBriefings(env, userId),
    absentAs(readClaim(env, userId), null, () => (noClaims = true)), absentAs(listWatches(env, userId), [] as Watch[]), listKeys(env, userId),
    listViews(env, userId),
  ]);
  return {
    board, panels: layout?.rows ?? null, emptied: layout?.emptied ?? false, searches, briefings: briefings ?? [], claim, watches, keys, views: views ?? [],
    absent: { briefings: briefings === null, claim: noClaims },
  };
}

// How the layout is kept: "tiles", the dashboard picked is stored; "first",
// the tables there and nothing stored yet (the first change writes it all);
// "panels", the grid's tables absent and the panels' there (adding and
// removing are kept, places and sizes are not); "none", neither table.
export type Keeping = "tiles" | "first" | "panels" | "none";
export const keepingOf = (h: Pick<Holdings, "board" | "panels">): Keeping =>
  h.board ? (h.board.id ? "tiles" : "first") : h.panels ? "panels" : "none";

// The address of the dashboard picked: the bare path while it is the first (or the computed one), its own otherwise.
export const hereOf = (h: Pick<Holdings, "board">): string => {
  const b = h.board;
  return boardPath(b?.id ?? null, !b?.id || b.boards[0]?.id === b.id);
};

// The dashboards as the tabs show them, in the account's order, each with the
// name the reader gave it ('' for none), the name it goes by, the site's
// label it would have without one, its address, its count of tiles and
// whether it is the one shown; the computed first alone while none is
// stored; none at all while the tables are absent, since nothing could keep
// a second dashboard.
export type Tab = { id: string | null; name: string; label: string; plain: string; href: string; n: number; current: boolean };
export function tabsOf(lang: Lang, h: Pick<Holdings, "board">, shown: number): Tab[] {
  const b = h.board;
  if (!b) return [];
  if (!b.boards.length) {
    const one = t(lang, "dash.board_n", { n: 1 });
    return [{ id: null, name: "", label: one, plain: one, href: DASHBOARD_PATH, n: shown, current: true }];
  }
  const labels = boardLabels(lang, b.boards);
  const plain = boardLabels(lang, b.boards.map((r) => ({ ...r, name: "" })));
  return b.boards.map((r, i) => ({
    id: r.id, name: r.name, label: labels.get(r.id) ?? "", plain: plain.get(r.id) ?? "", href: boardPath(r.id, i === 0),
    n: r.id === b.id ? shown : r.n, current: r.id === b.id,
  }));
}

// The starting layout: the watches, the 3-month list, matching notices and the
// organization's years block when it has claimed one, its first two saved
// tender searches, and the API tile when it holds a key.
export function startingLayout(h: Pick<Holdings, "searches" | "claim" | "keys">): Spec[] {
  const out: Spec[] = [{ kind: "watches", ref: "", wide: true }, { kind: "radar", ref: "3m", wide: true }];
  if (h.claim) out.push({ kind: "matches", ref: "", wide: true }, { kind: "org", ref: "years", wide: true });
  for (const s of h.searches.filter((x) => x.kind === "tenders").slice(0, 2)) out.push({ kind: "tenders", ref: s.id, wide: true });
  if (h.keys.some((k) => !k.revoked_at)) out.push({ kind: "api", ref: "", wide: true });
  return out;
}

// A panel of dashboard_panels as the grid lays it out: a stored row, or a
// panel of the starting layout (id "s" and its place, written once the reader
// changes it).
type PanelShown = { id: string; kind: PanelKind; ref: string; wide: boolean };
const STARTER_ID_RE = /^s([0-9]{1,2})$/;

function shownPanels(h: Holdings): { list: PanelShown[]; starter: boolean } {
  if ((h.panels && h.panels.length) || h.emptied) {
    const list = (h.panels ?? []).filter((r) => isPanelKind(r.kind)).map((r) => ({ id: r.id, kind: r.kind as PanelKind, ref: r.ref, wide: r.wide === 1 }));
    return { list, starter: false };
  }
  return { list: startingLayout(h).map((s, i) => ({ id: `s${i}`, ...s })), starter: true };
}

// A tile as the page draws it: its id (a stored tile's, a panel's, or a
// starter's "s" and its place), its kind and ref, its place and size, and its
// size key (sizeKey), which the grid's least sizes read.
export type Shown = { id: string; kind: PanelKind; ref: string; x: number; y: number; w: number; h: number; key: string };

// What sets a tile's least size apart within its kind (public/dash-grid.js
// LEAST): a segment's view draws two charts, and three blocks of the
// organization hold taller rows. A saved view's tile reads its address.
export function sizeKey(kind: PanelKind, ref: string, views: readonly Pick<SavedView, "id" | "address">[] = []): string {
  if (kind === "view") return /^\/segments\//.test(viewOf(ref, views)) ? "view:segment" : "view";
  if (kind === "org" && (ref === "share" || ref === "ending" || ref === "instruments")) return `org:${ref}`;
  return kind;
}
const viewOf = (ref: string, views: readonly Pick<SavedView, "id" | "address">[]) => (ID_RE.test(ref) ? views.find((v) => v.id === ref)?.address ?? "" : ref);

// The grid's own tiles (the size key as their kind) and back.
const asTile = (s: Shown): Tile => ({ id: s.id, kind: s.key, x: s.x, y: s.y, w: s.w, h: s.h });
function fromTiles(tiles: readonly Tile[], by: ReadonlyMap<string, Omit<Shown, "x" | "y" | "w" | "h">>): Shown[] {
  return tiles.flatMap((t) => {
    const s = by.get(t.id);
    return s ? [{ ...s, x: t.x, y: t.y, w: t.w, h: t.h }] : [];
  });
}

// The tiles in reading order, each held to the grid: the stored dashboard's,
// else the panels or the starting layout laid out as the grid lays the
// earlier page out (fromPanels), computed and not stored.
export function shownTiles(h: Holdings): { list: Shown[]; starter: boolean; keeping: Keeping } {
  const keeping = keepingOf(h);
  const key = (kind: PanelKind, ref: string) => sizeKey(kind, ref, h.views);
  if (keeping === "tiles") {
    const rows = h.board!.tiles.filter((r) => isPanelKind(r.kind));
    const by = new Map(rows.map((r) => [r.id, { id: r.id, kind: r.kind as PanelKind, ref: r.ref, key: key(r.kind as PanelKind, r.ref) }]));
    const laid = normalize(rows.map((r) => ({ id: r.id, kind: by.get(r.id)!.key, x: r.x, y: r.y, w: r.w, h: r.h })));
    return { list: fromTiles(laid, by), starter: false, keeping };
  }
  const { list, starter } = shownPanels(h);
  const by = new Map(list.map((p) => [p.id, { id: p.id, kind: p.kind, ref: p.ref, key: key(p.kind, p.ref) }]));
  return { list: fromTiles(fromPanels(list.map((p) => ({ id: p.id, kind: by.get(p.id)!.key, wide: p.wide }))), by), starter, keeping };
}

// -- a tile's ref, checked as the post gives it -----------------------------------------------

const ID_RE = /^[0-9a-f]{32}$/;
const SEARCH_KINDS: Readonly<Partial<Record<PanelKind, (kind: string) => boolean>>> = {
  tenders: (k) => k === "tenders", radar: (k) => k === "expiring", records: (k) => isRecordsKind(k),
};

// The tile a post names, its ref in its stored form, if it names one the
// account holds; null for anything else. A view tile names a view's address,
// or one of the account's saved views by its id (saved_views.ts).
export function specOf(kind: unknown, rawRef: unknown, h: Pick<Holdings, "searches" | "briefings"> & { views?: readonly Pick<SavedView, "id">[] }): Spec | null {
  if (!isPanelKind(kind) || typeof rawRef !== "string") return null;
  const ref = rawRef.trim();
  const spec = (r: string): Spec => ({ kind, ref: r, wide: true });
  switch (kind) {
    case "tenders":
    case "records":
      return ID_RE.test(ref) && h.searches.some((s) => s.id === ref && SEARCH_KINDS[kind]!(s.kind)) ? spec(ref) : null;
    case "radar":
      if (isWindow(ref)) return spec(ref);
      return ID_RE.test(ref) && h.searches.some((s) => s.id === ref && s.kind === "expiring") ? spec(ref) : null;
    case "briefing":
      return ID_RE.test(ref) && h.briefings.some((b) => b.id === ref) ? spec(ref) : null;
    case "org":
      return isClaimBlock(ref) ? spec(ref) : null;
    case "view": {
      if (ID_RE.test(ref)) return (h.views ?? []).some((x) => x.id === ref) ? spec(ref) : null;
      const v = viewRef(ref);
      return v ? spec(viewAddress(v)) : null;
    }
    default:
      return ref === "" ? spec("") : null;
  }
}

// -- reading the tiles --------------------------------------------------------------------

// What a tile's body is once read: its count for the foot, its body, the
// item's name when only the read knows it (a view's buyer or organization),
// the rows it lists of the rows there are (the foot says "5 of 31" when they
// differ), and the muted line its foot carries (a source and a period).
type Body = { count?: unknown; body: unknown; item?: string; shown?: number; total?: number; meta?: unknown };
// A tile's reads: its statements for the page's records batch, any other
// read (a static file, the watches' or a briefing's own batch), and how the
// rows become its body; null from draw says the tile cannot be read now.
type Job = { queries: Query[]; extra?: () => Promise<unknown>; draw: (rows: Row[][] | null, extra: unknown) => Body | null };
// A tile resolved against what the account holds: its head, its "Open",
// and its reads; job null when what it showed was removed.
type Resolved = { shown: Shown; title: string; item: string | null; href: string; job: Job | null };

type Ctx = {
  lang: Lang; env: Env; who: Account; h: Holdings; today: string; clock: Clock; frame: ClaimFrame;
  open: () => Promise<TenderRow[] | null>;
  org: { id: string; profile: Profile } | null;
};

const int = (v: unknown): number => num(v) ?? 0;
const READ_BASE = "https://read.invalid";
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");

// Every table on the dashboard is one of the site's, held to the tile's rows
// and three columns; a tile narrower than its table stacks it in labelled
// rows (public/styles.css, .dash-tile), and a phone restacks it.
const fyHead = (lang: Lang, fy: number, current: number) =>
  fy === current ? t(lang, "analytics.to_date", { fy: fiscalLabel(lang, fy) }) : fiscalLabel(lang, fy);

const Figure: FC<{ lang: Lang; n: number; cents: number | null }> = ({ lang, n, cents }) => (
  n ? <>{cents === null ? t(lang, "common.not_stated") : fmtMoney(cents / 100, lang)}<br /><span class="muted small">{recordsText(lang, n)}</span></>
    : <span class="muted">{recordsText(lang, 0)}</span>
);

// Records by source over two fiscal years: the records tile and the organization's years block; as many sources as the tile holds.
function sourceYears(lang: Lang, rows: Row[], sources: readonly MoneySource[], current: number, n: number): { body: unknown; shown: number; total: number } {
  const at = new Map(rows.map((r) => [`${int(r.src)}:${int(r.fy)}`, { n: int(r.n), cents: num(r.cents) }]));
  const cell = (src: MoneySource, fy: number) => at.get(`${SOURCE_NUMBER[src]}:${fy}`) ?? { n: 0, cents: null };
  const shown = sources.slice(0, n);
  return {
    shown: shown.length, total: sources.length,
    body: (
      <div class="table-wrap">
        <Table sorting="none" cols={[
          { kind: "main", label: t(lang, "col.source") },
          { kind: "total", label: fyHead(lang, current - 1, current) },
          { kind: "total", label: fyHead(lang, current, current) },
        ]}>
          <tbody>
            {shown.map((src) => (
              <tr>
                <td data-label={t(lang, "col.source")}>{sourceLabel(lang, src)}</td>
                {[current - 1, current].map((fy) => (
                  <td data-label={fyHead(lang, fy, current)} class="num"><Figure lang={lang} {...cell(src, fy)} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    ),
  };
}

// The radar's count and value, then its rows soonest first, as many as the tile holds: a window, a saved search of one, the organization's own.
function radarBody(lang: Lang, rows: Row[][] | null, today: string, n: number): Body | null {
  if (!rows) return null;
  const total = rows[0]?.[0] ?? {};
  const count = int(total.n);
  const list = (rows[1] ?? []).slice(0, n).map((r) => radarRow(r, today)).filter((r): r is ExpiringRow => r !== null);
  return {
    count: fmtInt(count, lang), shown: list.length, total: count,
    body: count && list.length ? <>
      <p class="muted small">{t(lang, "expiring.window_total", { total: money(lang, num(total.cents) === null ? null : int(total.cents) / 100) })}</p>
      <div class="table-wrap">
        <Table sorting="none" cols={[
          { kind: "main", label: t(lang, "col.contract") },
          { kind: "date", label: t(lang, "expiring.col_ends") },
          { kind: "value", label: t(lang, "col.value") },
        ]}>
          <tbody>
            {list.map((r) => (
              <tr>
                <td data-label={t(lang, "col.contract")}>
                  <a href={recordPath(r)}>{pick(lang, r.title_en, r.title_fr) ?? contractReference(r)}</a>
                  {r.organization ? <><br /><span class="muted small">{r.organization}</span></> : null}
                </td>
                <td data-label={t(lang, "expiring.col_ends")} class="mono">{day(r.end)}</td>
                <td data-label={t(lang, "col.value")} class="num">{money(lang, r.value, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </> : <p class="muted">{t(lang, "expiring.none_window")}</p>,
  };
}

// The statements of a radar filter: a province reads the radar's province
// statements as the page does (their page of rows, of which the tile shows
// its rows); anything else the total and RADAR_TOP_SQL, at the tile's rows.
function radarQueries(p: ReturnType<typeof radarParams>, n: number): Query[] {
  if (p.prov) {
    const binds = radarProvBinds(p);
    return [{ sql: RADAR_PROV_TOTAL_SQL, params: binds }, { sql: RADAR_PROV_ROWS_END_SQL, params: [...binds, 0] }];
  }
  const binds = radarBinds(p);
  return [{ sql: RADAR_TOTAL_SQL, params: binds }, { sql: RADAR_TOP_SQL, params: [...binds, Math.min(ROWS_MAX, n)] }];
}

function tendersJob(ctx: Ctx, s: SavedSearch, n: number): Job {
  const { lang, clock } = ctx;
  return {
    queries: [],
    extra: () => ctx.open(),
    draw: (_rows, extra) => {
      const open = extra as TenderRow[] | null;
      if (!open) return null;
      const hits = filterTenders(open, readTenderQuery(new URL(s.params, READ_BASE)), clock).filter((r) => !closingPassed(r.closing, clock));
      const soon = hits.filter((r) => r.closing).sort((a, b) => (a.closing! < b.closing! ? -1 : a.closing! > b.closing! ? 1 : 0)).slice(0, n);
      return {
        count: tn(lang, "tenders.count_one", "tenders.count_many", hits.length, { n: fmtInt(hits.length, lang) }), shown: soon.length, total: hits.length,
        body: soon.length ? (
          <div class="table-wrap">
            <Table sorting="none" cols={[
              { kind: "main", label: t(lang, "col.notice") },
              { kind: "buyer", label: t(lang, "col.buyer") },
              { kind: "date", label: t(lang, "col.closing") },
            ]}>
              <tbody>
                {soon.map((r) => (
                  <tr>
                    <td data-label={t(lang, "col.notice")}><a href={`/tenders/${r.reference.toLowerCase()}`}>{pick(lang, r.title_en, r.title_fr) ?? publishedReference(r)}</a></td>
                    <td data-label={t(lang, "col.buyer")}>{pick(lang, r.buyer_en, r.buyer_fr) ?? ""}</td>
                    <td data-label={t(lang, "col.closing")} class="mono">{day(r.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        ) : <p class="muted">{t(lang, "tenders.none_match")}</p>,
      };
    },
  };
}

const COUNTS_SQL: Readonly<Record<RecordsKind, string>> = { organization: ORG_COUNTS_SQL, buyer: BUYER_COUNTS_SQL, segment: SEGMENT_COUNTS_SQL };

function recordsJob(ctx: Ctx, s: SavedSearch, n: number): Job | null {
  const e = entityOf(s.kind, s.params);
  if (!e) return null;
  const current = fiscalYearOf(ctx.today);
  return {
    queries: [{ sql: COUNTS_SQL[e.kind], params: [e.key, current - 1, current] }],
    draw: (rows) => (rows ? sourceYears(ctx.lang, rows[0] ?? [], KIND_SOURCES[e.kind], current, n) : null),
  };
}

// The week's events of every watch: how many of each kind, then the newest,
// as many as the tile holds, an event two watches reach once.
function watchesJob(ctx: Ctx, n: number): Job {
  const { lang } = ctx;
  const days = Array.from({ length: WATCH_DAYS }, (_, i) => addDays(ctx.today, -i));
  const watches = ctx.h.watches;
  return {
    queries: [],
    extra: () => (watches.length ? readEvents(ctx.env, watches, days) : Promise.resolve(null)),
    draw: (_rows, extra) => {
      if (!watches.length) return { body: <p class="muted">{t(lang, "watches.none")}</p> };
      const read = extra as EventsRead | null;
      if (!read || read.state !== "ready") return null;
      const set = new Set(days);
      const byKind = new Map<EventKind, number>();
      const seen = new Map<string, { r: EventRow; w: Watch }>();
      for (const w of watches) {
        for (const e of listed(read.found.get(foundKey(w)), w.events, w.kind, set)) {
          byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + e.n);
          for (const r of e.rows) if (!seen.has(eventIdentity(r))) seen.set(eventIdentity(r), { r, w });
        }
      }
      const total = [...byKind.values()].reduce((a, b) => a + b, 0);
      if (!total) return { count: fmtInt(0, lang), body: <p class="muted">{t(lang, "dash.none_week")}</p> };
      const newest = [...seen.values()].sort((a, b) => (a.r.day === b.r.day ? 0 : a.r.day < b.r.day ? 1 : -1)).slice(0, n);
      return {
        count: fmtInt(total, lang), shown: newest.length, total: seen.size,
        body: <>
          <p class="small">{[...byKind].map(([k, v]) => t(lang, "interest.pair", { name: t(lang, EVENT_KEY[k]), value: fmtInt(v, lang) })).join(" · ")}</p>
          <div class="table-wrap">
            <Table sorting="none" cols={[{ kind: "main", label: t(lang, "watches.title") }, { kind: "date", label: t(lang, "col.date") }]}>
              <tbody>
                {newest.map(({ r, w }) => {
                  const l = watchEventLines(lang, r);
                  return (
                    <tr>
                      <td data-label={t(lang, "watches.title")}>
                        <a href={r.path}>{l.title}</a><br /><span class="muted small">{l.line2}</span><br />
                        <span class="muted small">{watchLabel(lang, w)}</span>
                      </td>
                      <td data-label={t(lang, "col.date")} class="mono">{r.day}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>,
      };
    },
  };
}

// An axis's labels at the chart's width: one in about every LABEL_PX of the
// plot, the first and the last always, the others resting from the end
// back, so a narrow tile's axis never crowds.
const LABEL_PX = 64;
function thinLabels(labels: readonly AxisLabel[], width: number): AxisLabel[] {
  const room = Math.max(2, Math.floor(width / LABEL_PX));
  if (labels.length <= room) return [...labels];
  const step = Math.ceil((labels.length - 1) / (room - 1));
  const last = labels.length - 1;
  return labels.map((l, i) => (i === 0 || i === last || (last - i) % step === 0 ? l : { ...l, hidden: true }));
}

// An analytics view's first chart (pages/analytics.tsx): value by fiscal
// quarter for a buyer, by fiscal year for an organization, buyers and
// organizations by fiscal year for a segment; at the ref's source and
// period, from the one statement the view reads for it, with the
// buyer's or organization's name read by its key; drawn to the tile's width
// and height (dashboard_fit.ts tileFit), the source and period in the foot.
function viewJob(ctx: Ctx, v: ViewRef, size: ChartFit): Job | null {
  const { lang } = ctx;
  const span = viewSpan(v, ctx.today);
  if (!span) return null;
  const src = SOURCE_NUMBER[v.source];
  const key: number | string | null = v.view === "buyer" ? v.id : v.view === "organization" ? orgNumber(v.id) : segmentNumber(v.id);
  if (key === null) return null;
  const chart = v.view === "buyer" ? BUYER_QUARTERS_SQL : v.view === "organization" ? ORG_YEARS_SQL : SEGMENT_YEARS_SQL;
  const queries: Query[] = [{ sql: chart, params: [key, src, span.first, span.last] }];
  if (v.view === "buyer") queries.push({ sql: BUYER_NAME_SQL, params: [v.id] });
  if (v.view === "organization") queries.push({ sql: ORG_NAME_SQL, params: [key] });
  const years = span.last - span.first + 1;
  return {
    queries,
    draw: (rows) => {
      if (!rows) return null;
      const data = rows[0] ?? [];
      const nameRow = rows[1]?.[0];
      const name = v.view === "segment" ? `${v.id} ${segmentLabel(lang, v.id)}`
        : v.view === "buyer" ? pick(lang, (nameRow?.name_en as string | null) ?? null, (nameRow?.name_fr as string | null) ?? null) ?? v.id
        : typeof nameRow?.name === "string" ? nameRow.name : v.id;
      const meta = t(lang, "analytics.lead", { source: sourceLabel(lang, v.source), first: fiscalLabel(lang, span.first), last: fiscalLabel(lang, span.last) });
      if (!data.length) return { item: name, meta, body: <p class="muted">{t(lang, "analytics.none")}</p> };
      const fy = (y: number) => (y === span.current ? t(lang, "analytics.to_date", { fy: fiscalLabel(lang, y) }) : fiscalLabel(lang, y));
      let panels: ChartPanel[];
      let domain: [number, number];
      let fmt = (x: number) => fmtMoneyShort(x, lang);
      let axis = fiscalAxis(span.first, span.last, (y) => fiscalLabel(lang, y));
      let gap = barGap(years, 24, size.width);
      if (v.view === "buyer") {
        const title = t(lang, "analytics.chart_quarters", { source: sourceLabel(lang, v.source) });
        axis = fiscalAxis(span.first, span.last, (y) => fiscalLabel(lang, y), 4);
        domain = [span.first * 4, (span.last + 1) * 4];
        gap = barGap(years * 4, 24, size.width);
        panels = [{
          title, bars: data.filter((r) => int(r.cents) > 0).map((r) => {
            const x = int(r.fy) * 4 + int(r.fq) - 1;
            const value = int(r.cents) / 100;
            const period = `${fiscalLabel(lang, int(r.fy))} ${t(lang, "analytics.quarter", { n: int(r.fq) })}`;
            return { x0: x, x1: x + 1, value, title: moneyTip(lang, title, period, value, recordsText(lang, int(r.n))) };
          }),
        }];
      } else {
        domain = [span.first, span.last + 1];
        const series: { title: string; value: (r: Row) => number; figures: (r: Row) => string[] }[] = v.view === "organization"
          ? [{
            title: t(lang, "analytics.chart_years", { source: sourceLabel(lang, v.source) }), value: (r) => int(r.cents) / 100,
            figures: (r) => [fmtMoney(int(r.cents) / 100, lang), recordsText(lang, int(r.n))],
          }]
          : [
            { title: t(lang, "analytics.chart_buyers"), value: (r) => int(r.n_buyers), figures: (r) => [fmtInt(int(r.n_buyers), lang)] },
            { title: t(lang, "analytics.chart_orgs"), value: (r) => int(r.n_orgs), figures: (r) => [fmtInt(int(r.n_orgs), lang)] },
          ];
        if (v.view === "segment") fmt = (x) => fmtInt(x, lang);
        panels = series.map((s) => ({
          title: s.title,
          bars: data.filter((r) => s.value(r) > 0).map((r) => ({
            x0: int(r.fy), x1: int(r.fy) + 1, value: s.value(r), title: tipText(tipHead(lang, s.title, fy(int(r.fy))), s.figures(r)),
          })),
        }));
      }
      return {
        item: name, meta,
        body: (
          <div class="chart">
            <ChartStack domain={domain} panels={panels} height={size.height} xLabels={thinLabels(axis.labels, size.width)}
              grid={v.view === "buyer" ? axis.grid : undefined} fmt={fmt} aria={t(lang, "analytics.chart_aria")} gap={gap} />
          </div>
        ),
      };
    },
  };
}

// This week so far: the briefing's sections from the week's first data date
// (briefings.ts weekAnchor) to the data date, as counts, as many as the tile holds.
function briefingJob(ctx: Ctx, b: Briefing, n: number): Job {
  const { lang } = ctx;
  const start = addDays(weekAnchor(ctx.today), -1);
  return {
    queries: [],
    extra: () => readBriefing(ctx.env, b, ctx.today, start),
    draw: (_rows, extra) => {
      const read = extra as Awaited<ReturnType<typeof readBriefing>>;
      if (!read || read.state !== "ready") return null;
      const d = read.data;
      const lines: [Key, Key, number][] = [
        ["briefing.subj_notices_one", "briefing.subj_notices_many", d.notices.n],
        ["briefing.subj_awards_one", "briefing.subj_awards_many", d.awards.n],
        ["briefing.subj_amended_one", "briefing.subj_amended_many", d.amended.n],
        ["briefing.subj_ending_one", "briefing.subj_ending_many", d.ending.n],
      ];
      const shown = lines.slice(0, n);
      return {
        shown: shown.length, total: lines.length,
        body: <ul class="plain dash-counts">{shown.map(([one, many, v]) => <li>{tn(lang, one, many, v, { n: fmtInt(v, lang) })}</li>)}</ul>,
      };
    },
  };
}

// One block of "Your organization" (org_claim.ts readBlocks, the block alone), as many rows as the tile holds.
function orgJob(ctx: Ctx, block: ClaimBlock, n: number): Job | null {
  const { lang, frame: f } = ctx;
  const claim = ctx.h.claim;
  const oid = ctx.org ? orgNumber(ctx.org.id) : null;
  if (!claim || !ctx.org || oid === null) return null;
  switch (block) {
    case "years":
      return {
        queries: [{ sql: ORG_COUNTS_SQL, params: [oid, f.current - 1, f.current] }],
        draw: (rows) => rows ? { ...sourceYears(lang, rows[0] ?? [], KIND_SOURCES.organization, f.current, n), meta: t(lang, "orgclaim.foot_years") } : null,
      };
    case "segments":
      return {
        queries: [{ sql: CLAIM_SEGMENTS_SQL, params: [oid, f.first, f.current] }],
        draw: (rows) => {
          if (!rows) return null;
          const all = rows[0] ?? [];
          const src = all.some((r) => int(r.src) === 1) ? 1 : 2;
          const mine = all.filter((r) => int(r.src) === src);
          const top = mine.slice(0, n);
          const source = src === 1 ? "awards" : "history";
          return {
            shown: top.length, total: mine.length,
            meta: top.length ? t(lang, "analytics.lead", { source: sourceLabel(lang, source), first: fiscalLabel(lang, f.first), last: fiscalLabel(lang, f.current) }) : undefined,
            body: top.length ? (
              <div class="table-wrap">
                <Table sorting="none" cols={[
                  { kind: "main", label: t(lang, "col.segment") }, { kind: "count", label: t(lang, "col.records") }, { kind: "total", label: t(lang, "col.value") },
                ]}>
                  <tbody>
                    {top.map((r) => {
                      const code = segmentCode(int(r.sid));
                      return (
                        <tr>
                          <td data-label={t(lang, "col.segment")}><a href={`/segments/${code}`}>{`${code} ${segmentLabel(lang, code)}`}</a></td>
                          <td data-label={t(lang, "col.records")} class="num">{fmtInt(int(r.n), lang)}</td>
                          <td data-label={t(lang, "col.value")} class="num">{money(lang, num(r.cents) === null ? null : int(r.cents) / 100)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            ) : <p class="muted">{t(lang, "orgclaim.none_segments", { n: fmtInt(MAX_YEARS, lang) })}</p>,
          };
        },
      };
    case "share": {
      const competitors = claim.competitors.map((c) => orgNumber(c)).filter((x): x is number => x !== null);
      const chosen = claim.segment;
      const segment = chosen !== null ? Number(chosen) : null;
      return {
        queries: [
          { sql: segment === null ? CLAIM_SHARE_LARGEST_SQL : CLAIM_SHARE_SQL, params: shareBinds(oid, competitors, "awards", segment, f) },
          { sql: CLAIM_SEGMENTS_SQL, params: [oid, f.first, f.current] },
        ],
        draw: (rows) => {
          if (!rows) return null;
          const shown = shareSegment(chosen, rows[1] ?? [], "awards");
          const years = new Map<number, { whole: number; own: number }>();
          for (const r of rows[0] ?? []) {
            const y = years.get(int(r.fy)) ?? { whole: int(r.seg_cents), own: 0 };
            if (num(r.oid) === oid) y.own += int(r.cents);
            years.set(int(r.fy), y);
          }
          const all = [...years].sort(([a], [b]) => b - a);
          const list = all.slice(0, n);
          if (shown === null || !list.length) {
            return { body: <p class="muted">{t(lang, "orgclaim.none_share", { source: sourceLabel(lang, "awards"), n: fmtInt(MAX_YEARS, lang) })}</p> };
          }
          const code = segmentCode(shown);
          return {
            shown: list.length, total: all.length,
            body: <>
              <p class="muted small">{`${code} ${segmentLabel(lang, code)} · ${sourceLabel(lang, "awards")}`}</p>
              <div class="table-wrap">
                <Table sorting="none" cols={[
                  { kind: "main", label: t(lang, "analytics.col_fy") }, { kind: "total", label: t(lang, "col.value") }, { kind: "share", label: t(lang, "analytics.col_share") },
                ]}>
                  <tbody>
                    {list.map(([fy, y]) => (
                      <tr>
                        <td data-label={t(lang, "analytics.col_fy")}>{fyHead(lang, fy, f.current)}</td>
                        <td data-label={t(lang, "col.value")} class="num">{fmtMoney(y.own / 100, lang)}</td>
                        <td data-label={t(lang, "analytics.col_share")} class="num">{y.whole > 0 ? fmtPct(y.own, y.whole, lang) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <p class="muted small">{t(lang, "orgclaim.share_caveat")}</p>
            </>,
          };
        },
      };
    }
    case "ending":
      return {
        queries: radarQueries(endingParams(oid, f), n),
        draw: (rows) => radarBody(lang, rows, f.today, n),
      };
    case "buyers":
      return {
        queries: [{ sql: CLAIM_BUYERS_SQL, params: [oid, f.firstDay, f.today, f.today, f.endLast] }],
        draw: (rows) => {
          if (!rows) return null;
          const all = rows[0] ?? [];
          const top = all.slice(0, n);
          return {
            shown: top.length, total: all.length,
            body: top.length ? (
              <div class="table-wrap">
                <Table sorting="none" cols={[
                  { kind: "main", label: t(lang, "col.buyer") }, { kind: "count", label: t(lang, "col.records") }, { kind: "count", label: t(lang, "orgclaim.col_ending") },
                ]}>
                  <tbody>
                    {top.map((r) => (
                      <tr>
                        <td data-label={t(lang, "col.buyer")}>
                          <a href={`/buyers/${r.id}`}>{pick(lang, (r.name_en as string | null) ?? null, (r.name_fr as string | null) ?? null) ?? String(r.id)}</a>
                        </td>
                        <td data-label={t(lang, "col.records")} class="num">{fmtInt(int(r.n), lang)}</td>
                        <td data-label={t(lang, "orgclaim.col_ending")} class="num">
                          {int(r.n_ending) ? <a href={`/expiring/12m?buyer=${r.id}`}>{fmtInt(int(r.n_ending), lang)}</a> : fmtInt(0, lang)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : <p class="muted">{t(lang, "orgclaim.none_buyers", { n: fmtInt(MAX_YEARS, lang) })}</p>,
          };
        },
      };
    case "instruments":
      return {
        queries: [{ sql: CLAIM_INSTRUMENTS_SQL, params: [oid] }],
        draw: (rows) => {
          if (!rows) return null;
          const all = (rows[0] ?? []).filter((r) => typeof r.agr === "string" && r.agr);
          const top = all.slice(0, n);
          return {
            count: fmtInt(all.length, lang), shown: top.length, total: all.length,
            body: top.length ? (
              <div class="table-wrap">
                <Table sorting="none" cols={[
                  { kind: "main", label: t(lang, "instruments.col_instrument") }, { kind: "date", label: t(lang, "instruments.col_expiry") },
                ]}>
                  <tbody>
                    {top.map((r) => {
                      const description = pick(lang, (r.desc_en as string | null) ?? null, (r.desc_fr as string | null) ?? null);
                      return (
                        <tr>
                          <td data-label={t(lang, "instruments.col_instrument")}>
                            <a href={instrumentPath(String(r.agr))} class="mono">{String(r.agr)}</a>
                            {description ? <><br /><span class="small">{description}</span></> : null}
                          </td>
                          <td data-label={t(lang, "instruments.col_expiry")} class="mono">{day(r.expiry as string | null)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            ) : <p class="muted">{t(lang, "orgclaim.none_instruments")}</p>,
          };
        },
      };
  }
}

// The open notices closest to the claimed organization's records, as many
// as the tile holds, ranked as /account/matches ranks them (public/fit.js),
// with the line every match carries; the states the page names otherwise,
// with its own words.
function matchesJob(ctx: Ctx, n: number): Job | null {
  const { lang, clock } = ctx;
  const org = ctx.org;
  if (!ctx.h.claim || !org) return null;
  const name = org.profile.organization.display_name;
  const block = profileMatching(org.profile);
  const state = block ? blockState(block) : null;
  const fy = (b: readonly [number, number]) => ({ first: fiscalLabel(lang, b[0]), last: fiscalLabel(lang, b[1]) });
  return {
    queries: [],
    extra: () => (block && state === "ready" ? ctx.open() : Promise.resolve(null)),
    draw: (_rows, extra) => {
      const say = (text: string) => ({ body: <><FitDisclaimer lang={lang} /><p>{text}</p></> });
      if (!block) return say(t(lang, "fit.pending"));
      if (state === "none") return say(t(lang, "fit.none_records", { name, ...fy(block.fy) }));
      if (state === "uncoded") return say(t(lang, "fit.uncoded", { name, ...fy(block.fy) }));
      if (state === "thin") return say(t(lang, "fit.thin", { name, counts: countsText(lang, block.coded), min: fmtInt(MATCH_MIN, lang), ...fy(block.fy) }));
      const open = extra as TenderRow[] | null;
      if (!open) return null;
      const { matches } = rankNotices(block, open.filter((r) => !closingPassed(r.closing, clock)), org.profile.organization.province);
      const capped = Math.min(matches.length, matchCap(ctx.who.plan));
      const top = matches.slice(0, Math.min(n, capped)) as { row: TenderRow; score: Score }[];
      return {
        count: tn(lang, "fit.count_one", "fit.count_many", capped, { n: fmtInt(capped, lang) }), shown: top.length, total: capped,
        body: <>
          <FitDisclaimer lang={lang} />
          {top.length ? (
            <div class="table-wrap">
              <Table sorting="none" cols={[
                { kind: "label", label: t(lang, "fit.col_match") }, { kind: "main", label: t(lang, "fit.col_notice") }, { kind: "date", label: t(lang, "col.closing") },
              ]}>
                <tbody>
                  {top.map(({ row, score }) => (
                    <tr>
                      <td data-label={t(lang, "fit.col_match")}><MatchBand lang={lang} score={score} /></td>
                      <td data-label={t(lang, "fit.col_notice")}>
                        <a href={`/tenders/${row.reference.toLowerCase()}`}>{pick(lang, row.title_en, row.title_fr) ?? publishedReference(row)}</a>
                      </td>
                      <td data-label={t(lang, "col.closing")} class="mono">{day(row.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : <p>{tj(lang, "fit.none_open", { name, all: <a href="/tenders">{t(lang, "fit.all_open")}</a> })}</p>}
        </>,
      };
    },
  };
}

// Each live key's requests today, beside the plan's daily figure (api_keyed_spec.ts keyQuota), as many keys as the tile holds.
function apiJob(ctx: Ctx, n: number): Job {
  const { lang } = ctx;
  const live = ctx.h.keys.filter((k) => !k.revoked_at);
  const quota = keyQuota(ctx.who.plan);
  return {
    queries: [],
    extra: () => (live.length ? keyUsage(ctx.env, ctx.who.userId, nowOf(ctx.env)) : Promise.resolve(new Map())),
    draw: (_rows, extra) => {
      if (!live.length) return { body: <p class="muted">{t(lang, "account.keys_none")}</p> };
      const usage = extra as Awaited<ReturnType<typeof keyUsage>>;
      if (!usage) return null;
      const shown = live.slice(0, n);
      return {
        shown: shown.length, total: live.length,
        body: <>
          {quota ? <p class="muted small">{t(lang, "interest.pair", { name: t(lang, "apiusage.tile_day"), value: fmtInt(quota.perDay, lang) })}</p> : null}
          <div class="table-wrap">
            <Table sorting="none" cols={[{ kind: "main", label: t(lang, "account.key_name") }, { kind: "count", label: t(lang, "apiusage.tile_today") }]}>
              <tbody>
                {shown.map((k) => (
                  <tr>
                    <td data-label={t(lang, "account.key_name")}>{k.name}<br /><span class="muted small mono">{`aw_${k.prefix}_`}</span></td>
                    <td data-label={t(lang, "apiusage.tile_today")} class="num">{fmtInt(usage.get(k.id)?.today ?? 0, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>,
      };
    },
  };
}

// A tile against what the account holds: its head and its reads at its size, or gone.
function resolve(ctx: Ctx, s: Shown): Resolved {
  const { lang, h } = ctx;
  const title = s.kind === "org" && isClaimBlock(s.ref) ? t(lang, "dash.kind_org", { block: t(lang, BLOCK_KEY[s.ref]) }) : t(lang, KIND_KEY[s.kind]);
  const gone = (href: string): Resolved => ({ shown: s, title, item: null, href, job: null });
  const search = (ok: (kind: string) => boolean) => h.searches.find((x) => x.id === s.ref && ok(x.kind));
  const fit = tileFit(s.kind, s.kind === "view" ? viewOf(s.ref, h.views) : s.ref, s.w, s.h);
  const n = fit.rows;
  switch (s.kind) {
    case "tenders": {
      const found = search((k) => k === "tenders");
      return found ? { shown: s, title, item: found.label, href: found.params, job: tendersJob(ctx, found, n) } : gone("/account/searches");
    }
    case "radar": {
      const params = isWindow(s.ref) ? `/expiring/${s.ref}` : search((k) => k === "expiring")?.params;
      if (!params) return gone("/account/searches");
      const url = new URL(params, READ_BASE);
      const window = (/^\/expiring\/(3m|6m|12m)$/.exec(url.pathname)?.[1] ?? "3m") as ExpiringWindow;
      const item = isWindow(s.ref) ? t(lang, WINDOW_KEY[s.ref]) : search((k) => k === "expiring")!.label;
      return {
        shown: s, title, item, href: params,
        job: { queries: radarQueries(radarParams(window, ctx.today, readExpiringQuery(url)), n), draw: (rows) => radarBody(lang, rows, ctx.today, n) },
      };
    }
    case "records": {
      const found = search(isRecordsKind);
      const job = found ? recordsJob(ctx, found, n) : null;
      return found && job ? { shown: s, title, item: found.label, href: found.params, job } : gone("/account/searches");
    }
    case "watches":
      return { shown: s, title, item: null, href: "/account/watches", job: watchesJob(ctx, n) };
    case "view": {
      // A saved view by its id: its name in the head and its address as saved (the saved views page moves a merged id).
      if (ID_RE.test(s.ref)) {
        const saved = h.views.find((x) => x.id === s.ref);
        const v = saved ? viewRef(saved.address) : null;
        const read = v ? viewJob(ctx, v, fit.chart!) : null;
        // The reader's name for the view heads the tile, in place of the buyer's or organization's the read gives.
        const job: Job | null = read ? { ...read, draw: (rows, extra) => { const b = read.draw(rows, extra); return b ? { ...b, item: undefined } : null; } } : null;
        return saved && job ? { shown: s, title, item: saved.name, href: saved.address, job } : gone("/account/views");
      }
      const v = viewRef(s.ref);
      const job = v ? viewJob(ctx, v, fit.chart!) : null;
      return v && job ? { shown: s, title, item: null, href: viewAddress(v), job } : gone("/analytics");
    }
    case "briefing": {
      const b = h.briefings.find((x) => x.id === s.ref);
      return b ? { shown: s, title, item: briefingLabel(lang, b), href: briefingPath(b), job: briefingJob(ctx, b, n) } : gone("/account/searches#briefings");
    }
    case "org": {
      const job = isClaimBlock(s.ref) ? orgJob(ctx, s.ref, n) : null;
      return job && ctx.org ? { shown: s, title, item: ctx.org.profile.organization.display_name, href: "/account/organization", job } : gone("/account/organization");
    }
    case "matches": {
      const job = matchesJob(ctx, n);
      return job ? { shown: s, title, item: null, href: "/account/matches", job } : gone("/account/organization");
    }
    case "api":
      return { shown: s, title, item: null, href: "/account/api", job: apiJob(ctx, n) };
  }
}

// Every tile's reads: the records statements in one batch (each tile apart
// only when the batch fails), the other reads beside it, at once.
async function readAll(ctx: Ctx, list: readonly Resolved[]): Promise<Map<Resolved, Body | null>> {
  const jobs = list.filter((r) => r.job);
  const all = jobs.flatMap((r) => r.job!.queries);
  const rows = new Map<Resolved, Row[][] | null>();
  const batch = all.length ? readRecords(ctx.env, all) : Promise.resolve(null);
  const extras = Promise.all(jobs.map((r) => (r.job!.extra ? r.job!.extra().catch(() => null) : Promise.resolve(null))));
  const [read, extra] = await Promise.all([batch, extras]);
  if (read?.state === "ready") {
    let at = 0;
    for (const r of jobs) {
      const n = r.job!.queries.length;
      rows.set(r, n ? read.rows.slice(at, at + n) : null);
      at += n;
    }
  } else if (read?.state === "failed") {
    // One tile's statement (a table the nightly has not made yet) leaves the others.
    const alone = await Promise.all(jobs.map((r) => (r.job!.queries.length ? readRecords(ctx.env, r.job!.queries) : Promise.resolve(null))));
    jobs.forEach((r, i) => rows.set(r, (alone[i] as Read | null)?.state === "ready" ? (alone[i] as Extract<Read, { state: "ready" }>).rows : null));
  }
  const out = new Map<Resolved, Body | null>();
  jobs.forEach((r, i) => {
    try {
      out.set(r, r.job!.draw(rows.get(r) ?? null, extra[i]));
    } catch {
      out.set(r, null);
    }
  });
  return out;
}

// What a page view and a tile's fragment both need: the context of the reads.
async function contextOf(c: Context<AppEnv>, who: Account, h: Holdings, list: readonly Shown[]): Promise<Ctx> {
  const stats = await loadStats(c.env).catch(() => null);
  const today = todayOf(stats?.data_as_of);
  let openList: Promise<TenderRow[] | null> | null = null;
  const needsOrg = list.some((s) => s.kind === "org" || s.kind === "matches");
  const org = needsOrg && h.claim ? await checkOrganization(c.env, h.claim.organizationId).catch(() => null) : null;
  return {
    lang: c.get("lang"), env: c.env, who, h, today, clock: clockOf(c.env), frame: claimFrame(today), org,
    open: () => (openList ??= loadOpenList(c.env).catch(() => null)),
  };
}

// -- the page --------------------------------------------------------------------------------

const Csrf: FC<{ account: Account }> = ({ account }) => <input type="hidden" name="csrf" value={account.csrf} />;

// What a post's ?m= says on the page. {name} is the dashboard ?to= names (where a tile was moved, or could not be).
const NOTICE: Readonly<Record<string, Key>> = {
  added: "dash.added", exists: "dash.added", full: "dash.full", briefings_full: "dash.briefings_full", unsaved: "dash.unsaved",
  unsaved_layout: "dash.unsaved_layout", boards_full: "dash.boards_full", renamed: "dash.board_renamed", board_deleted: "dash.board_deleted",
  board_emptied: "dash.board_emptied", moved: "dash.moved", move_exists: "dash.move_exists", move_full: "dash.move_full",
};

// The Add select's choices: what the account holds that is not on the
// dashboard shown already, by kind, in PANEL_KINDS order. An analytics view
// is added from its own page, or here once it is saved.
function addChoices(lang: Lang, h: Holdings, taken: ReadonlySet<string>): { label: string; options: [string, string][] }[] {
  const free = (kind: PanelKind, ref: string) => !taken.has(`${kind}:${ref}`);
  const group = (kind: PanelKind, label: string, options: [string, string][]) => ({ label, options: options.filter(([v]) => free(kind, v.slice(kind.length + 1))) });
  const searches = (ok: (k: string) => boolean, kind: PanelKind): [string, string][] =>
    h.searches.filter((s) => ok(s.kind)).map((s) => [`${kind}:${s.id}`, s.label]);
  const groups = [
    group("tenders", t(lang, "dash.kind_tenders"), searches((k) => k === "tenders", "tenders")),
    group("radar", t(lang, "dash.kind_radar"), [
      ...EXPIRING_WINDOWS.map((w): [string, string] => [`radar:${w}`, t(lang, WINDOW_KEY[w])]), ...searches((k) => k === "expiring", "radar"),
    ]),
    group("records", t(lang, "dash.kind_records"), searches(isRecordsKind, "records")),
    group("watches", t(lang, "dash.kind_watches"), [["watches:", t(lang, "dash.kind_watches")]]),
    group("view", t(lang, "views.title"), h.views.map((v): [string, string] => [`view:${v.id}`, v.name])),
    group("briefing", t(lang, "briefing.list_title"), h.briefings.map((b): [string, string] => [`briefing:${b.id}`, briefingLabel(lang, b)])),
    group("org", t(lang, "orgclaim.title_short"), h.claim ? CLAIM_BLOCKS.map((b): [string, string] => [`org:${b}`, t(lang, BLOCK_KEY[b])]) : []),
    group("matches", t(lang, "dash.kind_matches"), h.claim ? [["matches:", t(lang, "dash.kind_matches")]] : []),
    group("api", t(lang, "dash.kind_api"), h.keys.some((k) => !k.revoked_at) ? [["api:", t(lang, "dash.kind_api")]] : []),
  ];
  return groups.filter((g) => g.options.length);
}

// More Kinds of Tile: the kinds the account cannot add yet, in PANEL_KINDS
// order, each with the one step that gives it what the tile shows and the
// page where that is done. Only from what the page read already (Holdings),
// so it costs no statement. A kind goes once the account holds its need: a
// saved search of the kind (tenders, expiring, an organization, a buyer or a
// segment), a saved view or a view on the dashboard (a view is added from its
// own page), a briefing, a claim (the organization's blocks and matching
// notices), a live key. The watches and the plain windows of contracts ending
// need nothing and are never listed. The briefings' and the claim's lines wait
// for their tables, the API's for a plan with the keyed API.
export type MoreLine = { kinds: readonly PanelKind[]; key: Key; link: Key; href: string };

export function moreKinds(h: Holdings, plan: Plan, shown: readonly Pick<Shown, "kind">[] = []): MoreLine[] {
  const saved = (ok: (k: string) => boolean) => h.searches.some((s) => ok(s.kind));
  const out: MoreLine[] = [];
  const add = (kinds: readonly PanelKind[], key: Key, link: Key, href: string) => out.push({ kinds, key, link, href });
  if (!saved((k) => k === "tenders")) add(["tenders"], "dash.more_tenders", "dash.more_tenders_link", "/tenders");
  if (!saved((k) => k === "expiring")) add(["radar"], "dash.more_radar", "dash.more_radar_link", "/expiring/12m");
  if (!saved(isRecordsKind)) add(["records"], "dash.more_records", "dash.more_records_link", "/account/searches");
  if (!h.views.length && !shown.some((s) => s.kind === "view") && !(h.panels ?? []).some((r) => r.kind === "view")) {
    add(["view"], "dash.more_view", "dash.more_view_link", "/analytics");
  }
  if (!h.absent?.briefings && !h.briefings.length) add(["briefing"], "dash.more_briefing", "dash.more_briefing_link", "/segments");
  if (!h.absent?.claim && !h.claim) add(["org", "matches"], "dash.more_org", "dash.more_org_link", "/account/organization");
  if (allowed({ plan }, "api") && !h.keys.some((k) => !k.revoked_at)) add(["api"], "dash.more_api", "dash.more_api_link", "/account/keys");
  return out;
}

const MoreList: FC<{ lang: Lang; lines: readonly MoreLine[] }> = ({ lang, lines }) => (
  <ul class="muted">
    {lines.map((l) => <li>{tj(lang, l.key, { link: <a href={l.href}>{t(lang, l.link)}</a> }) as any}</li>)}
  </ul>
);

// A short muted list under the starting layout's tiles, so a first visit finds it; its links plain links.
const MorePanel: FC<{ lang: Lang; lines: readonly MoreLine[] }> = ({ lang, lines }) => (
  <Panel title={t(lang, "dash.more_title")} class="panel-form dash-more">
    <MoreList lang={lang} lines={lines} />
  </Panel>
);

// Add a Tile's place on the page, where a removal that empties the dashboard returns.
const ADD_ANCHOR = "dash-add";

// Add a Tile: the page's one filled button, a details element, so it opens
// without the script: the count of tiles, then the select of what the account
// holds and Add, or why nothing can be added; More Kinds of Tile under it. An
// emptied dashboard draws it open, as the one thing the page can do. Its post
// names the dashboard shown once one is stored (board), so the tile goes there.
const AddTile: FC<{
  lang: Lang; account: Account; h: Holdings; n: number; cap: number; keeping: Keeping; taken: ReadonlySet<string>; more: readonly MoreLine[]; open: boolean;
}> = ({ lang, account, h, n, cap, keeping, taken, more, open }) => {
  const choices = addChoices(lang, h, taken);
  const board = keeping === "tiles" ? h.board?.id ?? null : null;
  return (
    <details class="dash-adder" id={ADD_ANCHOR} open={open || undefined}>
      <summary class="btn btn-primary">{t(lang, "dash.add_tile")}</summary>
      <div class="dash-adder-body">
        <p class="muted small">{t(lang, "dash.count", { n: fmtInt(n, lang), cap: fmtInt(cap, lang) })}</p>
        {keeping === "none" ? <p class="muted">{t(lang, "dash.unsaved")}</p>
          : n >= cap ? <p>{t(lang, "dash.full", { cap: fmtInt(cap, lang) })}</p>
          : choices.length ? (
            <form method="post" action={`${DASHBOARD_PATH}/panels`} class="stack">
              <Csrf account={account} />
              {board ? <input type="hidden" name="board" value={board} /> : null}
              <label>
                {t(lang, "dash.add_label")}
                <select name="panel">
                  {choices.map((g) => <optgroup label={g.label}>{g.options.map(([v, label]) => <option value={v}>{label}</option>)}</optgroup>)}
                </select>
              </label>
              <button type="submit" class="btn">{t(lang, "dash.add")}</button>
            </form>
          ) : <p class="muted">{t(lang, "dash.none_left")}</p>}
        {more.length ? <><p class="dash-adder-head">{t(lang, "dash.more_title")}</p><MoreList lang={lang} lines={more} /></> : null}
      </div>
    </details>
  );
};

// The word a dashboard's posts use for the account's first one while it is
// computed and not stored: such a post writes it first (writeFirst).
export const FIRST = "first";
export const boardPostPath = (id: string | null) => `${DASHBOARD_PATH}/boards/${id ?? FIRST}`;

// The dashboards' row (tabsOf): a tab a dashboard, the one shown marked; New
// dashboard while the account holds fewer than its plan's figure; and the
// shown one's Rename, Order or Delete, a details element that opens without
// the script, its deletion asked inside it (a second details element with the
// question and its own button), never in a browser dialog.
const BoardTabs: FC<{ lang: Lang; account: Account; tabs: readonly Tab[]; cap: number }> = ({ lang, account, tabs, cap }) => {
  const i = tabs.findIndex((x) => x.current);
  const at = tabs[i];
  if (!at) return null;
  const base = boardPostPath(at.id);
  const order = (dir: "earlier" | "later", key: Key, can: boolean) => (
    <form method="post" action={`${base}/move`}>
      <Csrf account={account} />
      <input type="hidden" name="dir" value={dir} />
      <button type="submit" class="btn" disabled={!can || undefined}>{t(lang, key)}</button>
    </form>
  );
  const ask: Key = at.n === 0 ? "dash.board_delete_q_none" : at.n === 1 ? "dash.board_delete_q_one" : "dash.board_delete_q";
  return (
    <div class="dash-boards">
      <nav class="tabs dash-tabs" aria-label={t(lang, "dash.boards_nav")}>
        {tabs.map((x) => <a href={x.href} aria-current={x.current ? "page" : undefined} title={x.label}>{x.label}</a>)}
      </nav>
      <div class="dash-board-tools">
        {tabs.length < cap ? (
          <form method="post" action={`${DASHBOARD_PATH}/boards`}>
            <Csrf account={account} />
            <button type="submit" class="btn-link">{t(lang, "dash.board_new")}</button>
          </form>
        ) : null}
        <details class="dash-board-edit">
          <summary class="btn-link">{t(lang, "dash.board_edit")}</summary>
          <div class="dash-board-body">
            <form method="post" action={`${base}/rename`} class="stack">
              <Csrf account={account} />
              <label>
                {t(lang, "dash.board_name")}
                <input type="text" name="name" value={at.name} maxlength={BOARD_NAME_MAX} placeholder={at.plain} autocomplete="off" />
              </label>
              <p class="muted small">{t(lang, "dash.board_name_note", { n: fmtInt(BOARD_NAME_MAX, lang), label: at.plain })}</p>
              <button type="submit" class="btn">{t(lang, "dash.board_rename")}</button>
            </form>
            <div class="dash-board-order">
              {order("earlier", "dash.board_earlier", i > 0)}
              {order("later", "dash.board_later", i < tabs.length - 1)}
            </div>
            <details class="dash-board-delete">
              <summary class="btn-link">{t(lang, "dash.board_delete")}</summary>
              <form method="post" action={`${base}/delete`} class="stack">
                <Csrf account={account} />
                <p>{t(lang, ask, { name: at.label, n: fmtInt(at.n, lang) })}</p>
                {tabs.length === 1 ? <p class="muted small">{t(lang, "dash.board_delete_last")}</p> : null}
                <button type="submit" name="confirm" value="yes" class="btn">{t(lang, "dash.board_delete_yes")}</button>
              </form>
            </details>
          </div>
        </details>
      </div>
    </div>
  );
};

type Drawn = { r: Resolved; body: Body | null };
// Another stored dashboard a tile's menu offers to move it to: its id, its name, and whether it holds its figure.
export type MoveTarget = { id: string; label: string; full: boolean };
export const moveTargets = (tabs: readonly Tab[], cap: number): MoveTarget[] =>
  tabs.filter((x) => !x.current && x.id).map((x) => ({ id: x.id!, label: x.label, full: x.n >= cap }));

// The three-dot mark of a tile's menu and the grip's six dots, drawn in currentColor.
const DOTS = <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="3" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="13" cy="8" r="1.5" /></svg>;
const GRIP = (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <circle cx="5.5" cy="3.5" r="1.4" /><circle cx="10.5" cy="3.5" r="1.4" /><circle cx="5.5" cy="8" r="1.4" /><circle cx="10.5" cy="8" r="1.4" />
    <circle cx="5.5" cy="12.5" r="1.4" /><circle cx="10.5" cy="12.5" r="1.4" />
  </svg>
);

// The menu's moves and sizes, in order, each a post with its field.
const MENU: readonly { step: Step; key: Key; op: "move" | "size"; field: string }[] = [
  { step: "left", key: "dash.left", op: "move", field: "dir" }, { step: "right", key: "dash.right", op: "move", field: "dir" },
  { step: "up", key: "dash.up", op: "move", field: "dir" }, { step: "down", key: "dash.down", op: "move", field: "dir" },
  { step: "wider", key: "dash.wider", op: "size", field: "to" }, { step: "narrower", key: "dash.narrower", op: "size", field: "to" },
  { step: "taller", key: "dash.taller", op: "size", field: "to" }, { step: "shorter", key: "dash.shorter", op: "size", field: "to" },
];

export const tilePath = (id: string) => `${DASHBOARD_PATH}/tiles/${id}`;

// A tile: its head (the grip, the kind and the item, the menu), its body, its
// foot (the source and period where it has one, the rows it lists of all
// there are, Open) and its corner. Its place and size ride on custom
// properties the stylesheet places it by from 1,100 px, and as data the
// page's script reads; offer says which of the menu's steps would change the
// layout (dash-grid.js steps). With other dashboards stored, the menu offers
// Move To with each one's name, a post (a dashboard holding its figure is
// offered disabled); the page's script leaves those posts alone.
export const DashTile: FC<{ lang: Lang; account: Account; d: Drawn; offer: Record<Step, boolean>; moves?: readonly MoveTarget[] }> = (
  { lang, account, d, offer, moves },
) => {
  const { r, body } = d;
  const s = r.shown;
  const item = body?.item ?? r.item;
  const label = item ? `${r.title}: ${item}` : r.title;
  const head = `tile-${s.id}-t`;
  const count = !r.job || !body ? null
    : body.shown !== undefined && body.total !== undefined && body.shown < body.total ? t(lang, "dash.shown", { n: fmtInt(body.shown, lang), total: fmtInt(body.total, lang) })
    : body.count;
  return (
    <section class={`panel dash-tile${takesBoth(s) ? " dash-both" : ""}`} id={`tile-${s.id}`} aria-labelledby={head}
      data-id={s.id} data-key={s.key} data-x={String(s.x)} data-y={String(s.y)} data-w={String(s.w)} data-h={String(s.h)} data-title={r.title}
      data-total={body?.total !== undefined ? String(body.total) : undefined}
      style={`--gc:${s.x + 1};--gr:${s.y + 1};--gw:${s.w};--gh:${s.h}`}>
      <div class="dash-head">
        <button type="button" class="dash-grip" aria-label={t(lang, "dash.grip", { title: label })} aria-describedby="dash-keys-move">{GRIP}</button>
        <h2 id={head} class="dash-title" title={label}>{r.title}{item ? <span class="dash-item">{item}</span> : null}</h2>
        <details class="dash-menu">
          <summary class="dash-menu-button" aria-label={t(lang, "dash.menu", { title: label })} title={t(lang, "dash.menu", { title: label })}>{DOTS}</summary>
          <div class="dash-menu-list">
            {r.job ? <a href={r.href} class="dash-menu-item">{t(lang, "dash.open")}</a> : null}
            {MENU.map((m) => (
              <form method="post" action={`${tilePath(s.id)}/${m.op}`}>
                <Csrf account={account} />
                <input type="hidden" name={m.field} value={m.step} />
                <button type="submit" class="dash-menu-item" data-step={m.step} disabled={!offer[m.step] || undefined}>{t(lang, m.key)}</button>
              </form>
            ))}
            {moves && moves.length ? <p class="dash-menu-head">{t(lang, "dash.move_to")}</p> : null}
            {(moves ?? []).map((m) => (
              <form method="post" action={`${tilePath(s.id)}/board`}>
                <Csrf account={account} />
                <input type="hidden" name="board" value={m.id} />
                <button type="submit" class="dash-menu-item" aria-label={t(lang, "dash.move_to_name", { name: m.label })} disabled={m.full || undefined}>{m.label}</button>
              </form>
            ))}
            <form method="post" action={`${tilePath(s.id)}/delete`}>
              <Csrf account={account} />
              <button type="submit" class="dash-menu-item">{t(lang, "dash.remove")}</button>
            </form>
          </div>
        </details>
      </div>
      <div class="dash-body">
        {!r.job ? <p>{t(lang, "dash.gone")}</p>
          : body ? (body.body as any)
          : <p class="muted">{t(lang, "dash.unavailable")}</p>}
      </div>
      <div class="dash-foot">
        <span class="dash-meta" title={typeof body?.meta === "string" ? body.meta : undefined}>{(body?.meta ?? null) as any}</span>
        {count !== null && count !== undefined ? <span class="dash-count">{count as any}</span> : null}
        {r.job ? <a href={r.href}>{t(lang, "dash.open")}</a> : null}
      </div>
      <button type="button" class="dash-corner" aria-label={t(lang, "dash.corner", { title: label })} aria-describedby="dash-keys-size"></button>
    </section>
  );
};

// The words and settings the page's script reads (public/dashboard.js),
// each template in pieces (public/refresh.js templatePieces) so the page
// carries no unfilled placeholder. The layout's address names the dashboard
// shown once it is stored (?board=), so the script, which posts to the
// address it is given, saves to that dashboard and no other.
export function dashClientData(lang: Lang, account: Account, keeping: Keeping, board: string | null = null) {
  const pieces = (key: Key) => templatePieces(t(lang, key));
  const at = keeping === "tiles" && board ? `?board=${board}` : "";
  return {
    csrf: account.csrf, save: keeping === "tiles" || keeping === "first", cols: COLS, layout: `${DASHBOARD_PATH}/layout${at}`, tiles: `${DASHBOARD_PATH}/tiles/`,
    words: {
      saving: t(lang, "dash.status_saving"), saved: t(lang, "dash.status_saved"), failed: t(lang, "dash.status_failed"), local: t(lang, "dash.status_local"),
      undone: t(lang, "dash.status_undone"), undo: t(lang, "dash.js_undo"), retry: t(lang, "dash.js_retry"),
      picked: pieces("dash.say_picked"), pickedSize: pieces("dash.say_picked_size"), at: pieces("dash.say_at"), size: pieces("dash.say_size"),
      dropped: pieces("dash.say_dropped"), back: pieces("dash.say_back"), shown: pieces("dash.shown"),
    },
  };
}

export function dashboardView(
  lang: Lang, account: Account,
  s: { drawn: Drawn[]; h: Holdings; starter: boolean; keeping: Keeping; notice: string | null; cap: number; boards: number },
) {
  const n = s.drawn.length;
  const emptied = !s.starter && !n;
  const taken = new Set(s.drawn.map((d) => `${d.r.shown.kind}:${d.r.shown.ref}`));
  // More Kinds of Tile wherever a tile can be added: inside Add a Tile, and on the starting layout under its tiles too (a
  // first visit). A full dashboard, or one whose tiles cannot be kept, adds nothing, so it lists nothing.
  const canAdd = s.keeping !== "none" && n < s.cap;
  const more = canAdd ? moreKinds(s.h, account.plan, s.drawn.map((d) => d.r.shown)) : [];
  const tiles = s.drawn.map((d) => asTile(d.r.shown));
  const tabs = tabsOf(lang, s.h, n);
  const moves = moveTargets(tabs, s.cap);
  const line = s.keeping === "none" ? t(lang, "dash.unsaved") : s.keeping === "panels" ? t(lang, "dash.unsaved_layout")
    : s.starter ? t(lang, "dash.starter") : emptied ? t(lang, "dash.empty") : "";
  return (
    <>
      {/* The tabs in the head, under the lead: Add a Tile's choices hang below the head's row, so an emptied
          dashboard's open Add a Tile never covers them. */}
      <PageHead lang={lang} title={t(lang, "dash.title")} lead={t(lang, "dash.lead")}
        actions={<AddTile lang={lang} account={account} h={s.h} n={n} cap={s.cap} keeping={s.keeping} taken={taken} more={more} open={emptied} />}>
        {tabs.length ? <BoardTabs lang={lang} account={account} tabs={tabs} cap={s.boards} /> : null}
      </PageHead>
      {s.notice ? <p class="account-notice" role="status">{s.notice}</p> : null}
      <div class="dash-bar">
        <p class="dash-status muted" id="dash-status" role="status" aria-live="polite">{line}</p>
      </div>
      <div class="dash-grid" id="dash-grid">
        {s.drawn.map((d) => <DashTile lang={lang} account={account} d={d} offer={stepsOf(tiles, d.r.shown.id)} moves={moves} />)}
      </div>
      {s.starter && more.length ? <MorePanel lang={lang} lines={more} /> : null}
      <p id="dash-keys-move" hidden>{t(lang, "dash.keys_move")}</p>
      <p id="dash-keys-size" hidden>{t(lang, "dash.keys_size")}</p>
      <p id="dash-say" class="visually-hidden" aria-live="polite"></p>
      <ClientData id="dash-data" data={dashClientData(lang, account, s.keeping, s.h.board?.id ?? null)} />
      <script type="module" src="/dashboard.js"></script>
    </>
  );
}

// What a Free or Pro account reads at the address while Ultra is on sale:
// the head, what the dashboard holds (Ultra's figures, as its plan card
// states them), the gate line and the plan cards. Ultra's link is the page's
// filled button, the dashboard being Ultra's.
export function teaseView(lang: Lang, cards: ReturnType<typeof planCards>) {
  const own = cards.map((c) => ({ ...c, actions: c.actions.map((a) => ({ ...a, primary: c.plan === "ultra" && a === c.actions[0] })) }));
  const ultra = dashboardsWording("ultra");
  return (
    <>
      <PageHead lang={lang} title={t(lang, "dash.title")} />
      <Panel title={t(lang, "dash.what_title")}>
        <p>{t(lang, "dash.what_lead", { line: t(lang, ultra.key, ultra.vars?.(lang)) })}</p>
        <ul>{PANEL_KINDS.map((k) => <li>{t(lang, WHAT_KEY[k])}</li>)}</ul>
      </Panel>
      <p class="muted">{t(lang, "dash.gate")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></p>
      <PlanCards lang={lang} plans={own} />
    </>
  );
}

// The shell of every dashboard response: an account page with the rail's
// Dashboard item as the current one, at the dashboard's own address.
async function dashPage(c: Context<AppEnv>, body: unknown, path = DASHBOARD_PATH, status = 200): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "dash.title")} dataAsOf={stats?.data_as_of ?? null} active={DASHBOARD_PATH}
      seo={{ path, description: t(lang, "account.description"), noindex: true }}>
      {body as any}
    </Layout>,
    status,
  );
}

// The tiles drawn: each resolved at its size and read, in reading order.
async function drawTiles(c: Context<AppEnv>, who: Account, h: Holdings, list: readonly Shown[]): Promise<Drawn[]> {
  const ctx = await contextOf(c, who, h, list);
  const resolved = stack(list.map(asTile)).map((t) => resolve(ctx, list.find((s) => s.id === t.id)!));
  const bodies = await readAll(ctx, resolved);
  return resolved.map((r) => ({ r, body: bodies.get(r) ?? null }));
}

const inLang = (c: Context<AppEnv>, path: string) => (c.get("lang") === "fr" ? `${path}?lang=fr` : path);

// A dashboard's page: the first one's (board null), or the one an address
// names; one the account does not hold (deleted, another account's, or any
// while the tables are absent) sends the reader to the first.
export async function dashboardPage(c: Context<AppEnv>, who: Account, board: string | null = null): Promise<Response> {
  const lang = c.get("lang");
  if (!holdsDashboard(who.plan)) {
    const [price, ultra] = [checkoutPrice(c.env), await ultraCheckoutPrice(c.env)];
    const cards = planCards(lang, { price, ultra, reader: who.plan === "pro" ? "pro" : "free", place: "tease" });
    return dashPage(c, teaseView(lang, cards), board ? boardPath(board) : DASHBOARD_PATH);
  }
  const h = await readHoldings(c.env, who.userId, { board });
  if (board && !h.board?.found) return c.redirect(inLang(c, DASHBOARD_PATH), 303);
  const { list, starter, keeping } = shownTiles(h);
  const drawn = await drawTiles(c, who, h, list);
  const m = c.req.query("m") ?? "";
  const cap = tileCap(who.plan);
  const boards = boardCap(who.plan);
  // The dashboard a notice names: the one ?to= names, among the account's.
  const to = c.req.query("to") ?? "";
  const named = tabsOf(lang, h, drawn.length).find((x) => x.id === to)?.label ?? "";
  const notice = NOTICE[m]
    ? t(lang, NOTICE[m], { cap: fmtInt(cap, lang), n: fmtInt(BRIEFING_PANELS_MAX, lang), boards: fmtInt(boards, lang), name: named })
    : null;
  return dashPage(c, dashboardView(lang, who, { drawn, h, starter, keeping, notice, cap, boards }), board ? boardPath(board) : DASHBOARD_PATH);
}

// One tile at a size, for the page's script after a resize: the tile's
// section as the page draws it, read alone (its own records batch). The
// size asked for (w, h) is held to the grid and the kind's least; without
// one, the tile's own. The id is the account's own, in the layout of the
// dashboard that holds it (a stored tile's, a panel's or a starter's);
// anything else is 404.
export async function tileFragment(c: Context<AppEnv>, who: Account, id: string): Promise<Response> {
  if (!holdsDashboard(who.plan)) return c.text("", 404);
  const h = await readHoldings(c.env, who.userId, { tile: ID_RE.test(id) ? id : null });
  const { list } = shownTiles(h);
  const at = list.find((s) => s.id === id);
  if (!at) return c.text("", 404);
  const ask = (k: string) => (c.req.query(k) === undefined ? undefined : Number(c.req.query(k)));
  const w = ask("w");
  const hh = ask("h");
  const tiles = w === undefined && hh === undefined ? list.map(asTile) : resize(list.map(asTile), id, w ?? at.w, hh ?? at.h);
  const sized = tiles.find((x) => x.id === id)!;
  const shown = { ...at, x: sized.x, y: sized.y, w: sized.w, h: sized.h };
  const [d] = await drawTiles(c, who, h, [shown]);
  const lang = c.get("lang");
  const moves = moveTargets(tabsOf(lang, h, list.length), tileCap(who.plan));
  return c.html(<DashTile lang={lang} account={who} d={d} offer={stepsOf(tiles, id)} moves={moves} /> as any);
}

// -- the posts ------------------------------------------------------------------------------

// Where a post returns: a dashboard (at, the first's bare path unless the
// post was another's), with what happened, in the page's language, at the
// place the change was made (place: a tile's id, or ADD_ANCHOR), so a reader
// moving a tile down the page with its menu does not scroll back to it after
// each press; to names the dashboard a notice is about.
function back(c: Context<AppEnv>, m = "", place: string | null = null, at = DASHBOARD_PATH, to: string | null = null): Response {
  const q = [m ? `m=${m}` : "", to ? `to=${to}` : "", c.get("lang") === "fr" ? "lang=fr" : ""].filter(Boolean).join("&");
  const anchor = place === null ? "" : place === ADD_ANCHOR ? `#${ADD_ANCHOR}` : `#tile-${place}`;
  return c.redirect(`${at}${q ? `?${q}` : ""}${anchor}`, 303);
}

// The layout written as the account's first dashboard, in one batch with the
// dashboard's row: each tile at its place through ADD_TILE_SQL (a panel's id
// kept, a starter's a new one). Two first changes at once write one
// dashboard and each item once. The ids as they then stand, by the ids the
// page gave the tiles (an item written by the other change keeps that one's).
async function writeFirst(env: Env, who: Account, tiles: readonly Shown[], now = new Date()): Promise<Map<string, string>> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  await db.batch([
    db.prepare(BOARD_INSERT_SQL).bind(newId(), who.userId, at),
    ...tiles.map((s) => db.prepare(ADD_TILE_SQL).bind(ID_RE.test(s.id) ? s.id : newId(), who.userId, s.kind, s.ref, s.x, s.y, s.w, s.h, at,
      tileCap(who.plan), BRIEFING_PANELS_MAX, null)),
  ]);
  const rows = (await readBoard(env, who.userId))?.tiles ?? [];
  const ids = new Map<string, string>();
  for (const s of tiles) {
    const row = rows.find((r) => r.kind === s.kind && r.ref === s.ref);
    if (row) ids.set(s.id, row.id);
  }
  return ids;
}

// The stored tiles moved to a layout: an update for each tile whose place or size differs, in one batch.
async function writeMoves(env: Env, who: Account, rows: readonly TileRow[], next: readonly Tile[]): Promise<void> {
  const db = env.ACCOUNTS!;
  const was = new Map(rows.map((r) => [r.id, r]));
  const changed = next.filter((t) => {
    const r = was.get(t.id);
    return r && (r.x !== t.x || r.y !== t.y || r.w !== t.w || r.h !== t.h);
  });
  if (changed.length) await db.batch(changed.map((t) => db.prepare(MOVE_TILE_SQL).bind(t.x, t.y, t.w, t.h, t.id, who.userId)));
}

// A layout the reader changed, kept as the account keeps its layout: the
// tiles' places updated, or the whole layout written with the first change.
// The layout given is the page's, already through the grid's rules.
async function keepLayout(env: Env, who: Account, h: Holdings, keeping: Keeping, list: readonly Shown[], next: readonly Tile[]): Promise<Map<string, string>> {
  if (keeping === "tiles") {
    await writeMoves(env, who, h.board!.tiles, next);
    return new Map(next.map((t) => [t.id, t.id]));
  }
  const by = new Map(list.map((s) => [s.id, s]));
  return writeFirst(env, who, fromTiles(next, by));
}

// A post's board field: a dashboard's id, or none for the account's first; anything else is no dashboard.
const boardField = (v: unknown): string | null | false => (v === undefined || v === "" ? null : typeof v === "string" && ID_RE.test(v) ? v : false);

// Add: the tile a page's "Add to dashboard" names (kind and ref) or the Add
// select's choice (panel, "kind:ref"), checked against what the account
// holds, placed under the others at the left of the dashboard the post names
// (board), else of the first.
export async function addPanelPost(c: Context<AppEnv>, who: Account, fields: Record<string, string>): Promise<Response> {
  const lang = c.get("lang");
  if (!holdsDashboard(who.plan)) return c.redirect(DASHBOARD_PATH, 303);
  const want = boardField(fields.board);
  if (want === false) return c.text(t(lang, "form.rejected"), 400);
  const [kind, ref] = typeof fields.panel === "string"
    ? [fields.panel.slice(0, Math.max(0, fields.panel.indexOf(":"))), fields.panel.slice(fields.panel.indexOf(":") + 1)]
    : [fields.kind, fields.ref ?? ""];
  const h = await readHoldings(c.env, who.userId, { board: want });
  const spec = specOf(kind, ref, h);
  if (!spec) return c.text(t(lang, "form.rejected"), 400);
  // A dashboard deleted meanwhile (another tab): the first, with nothing added.
  if (want && h.board && !h.board.found) return back(c);
  const { list, keeping } = shownTiles(h);
  if (keeping === "none") return back(c, "unsaved");
  if (keeping === "panels") {
    // The grid's tables absent: the panel goes where the dashboard kept its panels.
    if (!h.panels!.length && !h.emptied) await writeStarter(c.env, who, startingLayout(h), new Date());
    const result = await addPanel(c.env, who, spec);
    const place = result === "added" || result === "exists" ? await panelIdOf(c.env, who.userId, spec) : null;
    return back(c, result, place);
  }
  if (keeping === "first") await writeFirst(c.env, who, list);
  const board = (await readBoard(c.env, who.userId, { board: want }))!;
  const at = hereOf({ board });
  const here = board.tiles.find((r) => r.kind === spec.kind && r.ref === spec.ref);
  if (here) return back(c, "exists", here.id, at);
  const key = sizeKey(spec.kind, spec.ref, h.views);
  const id = newId();
  const now = shownTiles({ ...h, board }).list.map(asTile);
  const placed = place(now, { id, kind: key, x: 0, y: 0, ...startSize(key, false) }).find((x) => x.id === id)!;
  const db = c.env.ACCOUNTS!;
  const res = await db.prepare(ADD_TILE_SQL).bind(id, who.userId, spec.kind, spec.ref, placed.x, placed.y, placed.w, placed.h, new Date().toISOString(),
    tileCap(who.plan), BRIEFING_PANELS_MAX, board.id).run();
  if ((res.meta?.changes ?? 0) === 1) return back(c, "added", id, at);
  // Refused inside the insert: the same item meanwhile, the plan's figure, or the briefings'.
  const again = (await readBoard(c.env, who.userId, { board: board.id }))!.tiles;
  const found = again.find((r) => r.kind === spec.kind && r.ref === spec.ref);
  if (found) return back(c, "exists", found.id, at);
  return back(c, again.length >= tileCap(who.plan) ? "full" : "briefings_full", null, at);
}

export type EditOp = { op: "step"; step: Step } | { op: "width"; wide: boolean } | { op: "delete" } | { op: "board"; board: string };

// A step, a width (the earlier page's posts: full or half the row), a
// removal and a move to another dashboard, on the account's own tile only (a
// stored one's on the dashboard that holds it; a panel's or a starter's in
// the computed layout). A step or a width the account cannot keep yet (the
// grid's tables absent) answers that it cannot be saved; a removal goes to
// the panels there, as before.
export async function editPanelPost(c: Context<AppEnv>, who: Account, id: string, op: EditOp): Promise<Response> {
  if (!holdsDashboard(who.plan)) return c.redirect(DASHBOARD_PATH, 303);
  const starter = STARTER_ID_RE.exec(id);
  if (!ID_RE.test(id) && !starter) return c.text(t(c.get("lang"), "form.rejected"), 400);
  const h = await readHoldings(c.env, who.userId, { tile: ID_RE.test(id) ? id : null });
  const { list, keeping } = shownTiles(h);
  if (keeping === "none") return back(c, "unsaved");
  if (keeping === "panels") return op.op === "delete" ? deletePanel(c, who, id, h) : back(c, "unsaved_layout");
  const at = hereOf(h);
  const target = list.find((s) => s.id === id);
  if (!target) return back(c, "", null, at);
  if (op.op === "board") return moveTile(c, who, h, target, op.board);
  const tiles = list.map(asTile);
  if (op.op === "delete") {
    // The tile that takes its place in reading order, else the one before it, else Add a Tile.
    const near = nearOf(tiles, id);
    const rest = normalize(tiles.filter((x) => x.id !== id));
    if (keeping === "first") {
      const ids = await writeFirst(c.env, who, fromTiles(rest, new Map(list.map((s) => [s.id, s]))));
      return back(c, "", near ? ids.get(near) ?? null : ADD_ANCHOR);
    }
    await c.env.ACCOUNTS!.prepare(DELETE_TILE_SQL).bind(id, who.userId).run();
    await writeMoves(c.env, who, h.board!.tiles, rest);
    return back(c, "", near ?? ADD_ANCHOR, at);
  }
  const next = op.op === "step" ? stepTile(tiles, id, op.step) : resize(tiles, id, op.wide ? COLS : COLS / 2, target.h);
  const ids = await keepLayout(c.env, who, h, keeping, list, next);
  return back(c, "", ids.get(id) ?? null, at);
}

// The tile that takes a tile's place in reading order, else the one before it; null when it is the only one.
function nearOf(tiles: readonly Tile[], id: string): string | null {
  const order = stack(tiles);
  const i = order.findIndex((x) => x.id === id);
  return (order[i + 1] ?? order[i - 1])?.id ?? null;
}

// A stored tile moved to another of the account's dashboards: it keeps its
// size and lands at the foot of that dashboard at the left (dash-grid.js
// place, as an add does), within that dashboard's figure, its briefings' cap
// and the same item once, each held inside the statement (MOVE_TO_SQL); the
// dashboard it left closes up. The reader stays on the dashboard it left, at
// the tile that takes its place, and the notice names where it went. A tile
// of the computed first dashboard has nowhere to go: no other is stored.
async function moveTile(c: Context<AppEnv>, who: Account, h: Holdings, src: Shown, target: string): Promise<Response> {
  const b = h.board!;
  const at = hereOf(h);
  const dest = b.boards.find((x) => x.id === target);
  if (keepingOf(h) !== "tiles" || !dest || dest.id === b.id) return back(c, "", src.id, at);
  const db = c.env.ACCOUNTS!;
  const cap = tileCap(who.plan);
  const read = async () => ((await db.prepare(BOARD_TILES_SQL).bind(who.userId, target).all<TileRow>()).results ?? []);
  const sameItem = (r: TileRow) => r.kind === src.kind && r.ref === src.ref;
  const there = await read();
  if (there.some(sameItem)) return back(c, "move_exists", src.id, at, target);
  if (there.length >= cap) return back(c, "move_full", src.id, at, target);
  const laid = normalize(there.filter((r) => isPanelKind(r.kind)).map((r) => ({
    id: r.id, kind: sizeKey(r.kind as PanelKind, r.ref, h.views), x: r.x, y: r.y, w: r.w, h: r.h,
  })));
  const landed = place(laid, { ...asTile(src), x: 0, y: 0 }).find((x) => x.id === src.id)!;
  const res = await db.prepare(MOVE_TO_SQL).bind(target, landed.x, landed.y, landed.w, landed.h, src.id, who.userId, cap, BRIEFING_PANELS_MAX).run();
  if ((res.meta?.changes ?? 0) !== 1) {
    // Refused inside the statement: the same item there meanwhile, its figure, or its briefings'.
    const again = await read();
    return back(c, again.some(sameItem) ? "move_exists" : again.length >= cap ? "move_full" : "briefings_full", src.id, at, target);
  }
  const tiles = shownTiles(h).list.map(asTile);
  const near = nearOf(tiles, src.id);
  await writeMoves(c.env, who, b.tiles.filter((r) => r.id !== src.id), normalize(tiles.filter((x) => x.id !== src.id)));
  return back(c, "moved", near ?? ADD_ANCHOR, at, target);
}

// A removal while the grid's tables are absent: the panel, as the earlier
// page removed it (the starting layout written first, the last removal
// marking the layout emptied).
async function deletePanel(c: Context<AppEnv>, who: Account, id: string, h: Holdings): Promise<Response> {
  const starter = STARTER_ID_RE.exec(id);
  let rows = h.panels!;
  let specs: Spec[] | null = null;
  if (!rows.length && !h.emptied) {
    specs = startingLayout(h);
    rows = (await writeStarter(c.env, who, specs, new Date())) ?? [];
  }
  const spec = starter && specs ? specs[Number(starter[1])] : undefined;
  const target = spec ? rows.find((r) => r.kind === spec.kind && r.ref === spec.ref) : rows.find((r) => r.id === id);
  if (!target) return back(c);
  const i = rows.findIndex((r) => r.id === target.id);
  const near = rows[i + 1] ?? rows[i - 1] ?? null;
  const db = c.env.ACCOUNTS!;
  await db.batch([db.prepare("DELETE FROM dashboard_panels WHERE id = ? AND user_id = ?").bind(target.id, who.userId), markEmptied(db, who.userId)]);
  return back(c, "", near ? near.id : ADD_ANCHOR);
}

// -- the dashboards' posts ------------------------------------------------------------------

export type BoardOp = { op: "new" } | { op: "rename"; name: string } | { op: "move"; dir: "earlier" | "later" } | { op: "delete" };

// A name as a reader types it: plain text, control characters dropped, cut
// to BOARD_NAME_MAX characters; '' (the site's label) when left empty.
export const boardName = (raw: unknown): string => cleanName(raw, BOARD_NAME_MAX);

// New dashboard, and a dashboard's Rename, Move earlier or later and Delete
// (id: its own, or FIRST for the account's first, stored or computed). While
// the first is computed, the post writes it before it applies, as it shows
// (or with no tile, for a deletion). New is held to the plan's figure inside
// its insert and lands on the new dashboard, empty, Add a Tile open. An order
// is written whole, a place a dashboard. A deletion takes the dashboard's
// tiles with it; the account's last dashboard is kept, emptied and with the
// site's label (DELETE_BOARD_SQL), as removing its last tile leaves it. The
// tables absent, nothing here can be kept, and no tab is offered.
export async function boardPost(c: Context<AppEnv>, who: Account, id: string, op: BoardOp): Promise<Response> {
  if (!holdsDashboard(who.plan)) return c.redirect(DASHBOARD_PATH, 303);
  const named = id === "" || id === FIRST ? null : id;
  if (named !== null && !ID_RE.test(named)) return c.text(t(c.get("lang"), "form.rejected"), 400);
  const h = await readHoldings(c.env, who.userId, { board: named });
  const keeping = keepingOf(h);
  if (keeping === "none") return back(c, "unsaved");
  if (keeping === "panels") return back(c, "unsaved_layout");
  if (!h.board!.found) return back(c);
  let board = h.board!;
  if (keeping === "first") {
    await writeFirst(c.env, who, op.op === "delete" ? [] : shownTiles(h).list);
    board = (await readBoard(c.env, who.userId))!;
  }
  const self = board.id;
  if (!self) return back(c);
  const db = c.env.ACCOUNTS!;
  switch (op.op) {
    case "new": {
      const fresh = newId();
      const res = await db.prepare(NEW_BOARD_SQL).bind(fresh, who.userId, new Date().toISOString(), boardCap(who.plan)).run();
      // Never the first: the account held one before it.
      return (res.meta?.changes ?? 0) === 1 ? back(c, "", null, boardPath(fresh)) : back(c, "boards_full", null, hereOf({ board }));
    }
    case "rename":
      await db.prepare(RENAME_BOARD_SQL).bind(op.name, self, who.userId).run();
      return back(c, "renamed", null, hereOf({ board }));
    case "move": {
      const order = board.boards.map((x) => x.id);
      const i = order.indexOf(self);
      const j = op.dir === "earlier" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= order.length) return back(c, "", null, hereOf({ board }));
      [order[i], order[j]] = [order[j], order[i]];
      await db.batch(order.map((x, k) => db.prepare(BOARD_POS_SQL).bind(k, x, who.userId)));
      return back(c, "", null, boardPath(self, j === 0));
    }
    case "delete": {
      const done = await db.batch(DELETE_BOARD_SQL.map((sql) => db.prepare(sql).bind(self, who.userId)));
      return back(c, (done[1]?.meta?.changes ?? 0) === 1 ? "board_deleted" : "board_emptied");
    }
  }
}

// The most tiles a posted layout may name, and the longest layout read.
const LAYOUT_TILES_MAX = 50;
export const LAYOUT_CHARS_MAX = 8000;

// The page's script saving a layout: the layout as JSON ([{id, x, y, w, h}]),
// in the form field layout, for the dashboard the address names (?board=;
// none, the first). Only that dashboard's own tile ids count; a tile the
// post leaves out keeps its place; the whole goes through the grid's rules
// (dash-grid.js normalize) before it is kept, and the answer is the layout as
// kept, with the ids the first change gave a starter's tiles. While the
// grid's tables are absent nothing is kept, and the answer says so; a
// dashboard the account no longer holds is refused.
export async function layoutPost(c: Context<AppEnv>, who: Account, fields: Record<string, string>): Promise<Response> {
  if (!holdsDashboard(who.plan)) return c.json({ state: "refused" }, 403);
  const want = boardField(c.req.query("board") ?? fields.board);
  const raw = typeof fields.layout === "string" && fields.layout.length <= LAYOUT_CHARS_MAX ? fields.layout : "";
  let posted: unknown;
  try {
    posted = JSON.parse(raw);
  } catch {
    posted = null;
  }
  if (want === false || !Array.isArray(posted) || posted.length > LAYOUT_TILES_MAX) return c.json({ state: "refused" }, 400);
  const h = await readHoldings(c.env, who.userId, { board: want });
  const { list, keeping } = shownTiles(h);
  if (keeping === "none" || keeping === "panels") return c.json({ state: "unsaved" });
  if (!h.board!.found) return c.json({ state: "refused" }, 404);
  const asked = new Map<string, Record<string, unknown>>();
  for (const p of posted) {
    if (p && typeof p === "object" && typeof (p as { id?: unknown }).id === "string") asked.set((p as { id: string }).id, p as Record<string, unknown>);
  }
  // A place or a size the post leaves out, or gives as no number, is the tile's own.
  const own = (v: unknown, was: number) => (typeof v === "number" && Number.isFinite(v) ? v : was);
  const next = normalize(list.map((s) => {
    const p = asked.get(s.id);
    return p ? { ...asTile(s), x: own(p.x, s.x), y: own(p.y, s.y), w: own(p.w, s.w), h: own(p.h, s.h) } : asTile(s);
  }));
  const ids = await keepLayout(c.env, who, h, keeping, list, next);
  return c.json({
    state: "saved",
    tiles: next.map((x) => ({ id: ids.get(x.id) ?? x.id, x: x.x, y: x.y, w: x.w, h: x.h })),
    renamed: Object.fromEntries([...ids].filter(([a, b]) => a !== b)),
  });
}

// The read of one tile is the session's, with the CSRF value the page carries
// in a header (the script's fetch alone sends it), so another site's page
// cannot have a reader's browser fetch it.
export const CSRF_HEADER = "x-csrf-token";
export const tileReadAllowed = (who: Account, value: string | undefined): boolean => csrfValid(who, value);

// Whether the address is the dashboard for this request: while Ultra is on
// sale, for everyone (a reader without it reads what it holds, a reader
// signed out signs in); otherwise only for an account that holds it, and the
// address stays the site's 404 for every other reader, as before Ultra. A
// session the database cannot say goes on to the page, which answers 503.
export async function dashboardOpen(c: Context<AppEnv>, read: () => Promise<{ state: string; plan?: Plan }>): Promise<boolean> {
  if (await ultraOnSale(c.env).catch(() => false)) return true;
  const s = await read().catch(() => ({ state: "unavailable" }) as { state: string; plan?: Plan });
  return s.state === "ok" ? holdsDashboard(s.plan) : s.state === "unavailable";
}
