// The dashboard (docs/accounts.md, Dashboard): /account/dashboard, a page of
// up to dashboardCap(plan) panels an Ultra account chooses from what the site
// already shows it, in its own order, each full width or half width (half
// from 1,280 px). routes.tsx mounts the page and its four posts; the rail's
// item is the shell's (src/layout.tsx, dashboard_rule.ts dashboardInRail);
// "Add to dashboard" is dashboard_add.tsx.
//
// Each kind of panel is a reader the account pages already have, with a
// LIMIT of PANEL_ROWS where it lists rows, and nothing else: no new statement
// about the data but the radar's 5-row form (RADAR_TOP_SQL). A page view is
// the account's rows (read in parallel by the readers the account pages use),
// one records batch holding every panel's statements (each panel is read on
// its own only when that batch fails, so one panel that cannot be read leaves
// the others), the watches' and the briefings' own readers, which send their
// own batches, and at most two parsed static files (the open notices, and the
// claimed organization's profile shard). A Free or Pro account reads none of
// it: the page says what the dashboard holds, with the plan cards.
//
// The layout lives in the accounts database (dashboard_panels). Until the
// operator applies accounts_schema.sql the table is absent: the starting
// layout renders, and the edit controls say the layout cannot be saved yet.
// An account with no row stored sees the starting layout, computed and not
// stored; its first change writes it, then applies the change, so the panels
// the reader kept stay where they were.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { addDays } from "../../public/closing.js";
import { MATCH_MIN, blockState, rankNotices, type Score } from "../../public/fit.js";
import { keyQuota } from "../api_keyed_spec";
import { ChartStack, barGap, fiscalAxis, moneyTip, recordsText, tipHead, tipText, type Panel as ChartPanel } from "../chart";
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
import { Layout, PageHead, Panel, page, todayOf } from "../layout";
import { contractReference, radarParams, radarRow, readExpiringQuery, sitePath as recordPath } from "../pages/expiring";
import { money } from "../pages/shared";
import { filterTenders, readTenderQuery } from "../pages/tenders";
import { PlanCards, checkoutPrice, planCards, ultraCheckoutPrice } from "../pro";
import {
  BUYER_QUARTERS_SQL, EARLIEST_FY, MAX_YEARS, ORG_YEARS_SQL, PERIODS, ULTRA_YEARS, SEGMENT_SOURCES, SEGMENT_YEARS_SQL, SOURCE_NUMBER, type Query, type Read,
  type Row, fiscalLabel, fiscalYearOf, num, orgNumber, readRecords, segmentCode, segmentNumber,
} from "../records_db";
import { RADAR_PROV_ROWS_END_SQL, RADAR_PROV_TOTAL_SQL, RADAR_ROWS_END_SQL, RADAR_TOTAL_SQL, radarBinds, radarProvBinds } from "../records_tables";
import { type KeyRow, listKeys } from "./api_keys";
import { keyUsage, nowOf } from "./api_usage";
import { briefingLabel } from "./briefing_pages";
import { type Briefing, briefingPath, listBriefings, readBriefing, weekAnchor } from "./briefings";
import { DASHBOARD_PATH, dashboardCap, holdsDashboard } from "./dashboard_rule";
import { EVENT_KEY, watchEventLines } from "./digests";
import { matchCap, type Plan } from "./entitlements";
import {
  CLAIM_BLOCKS, CLAIM_BUYERS_SQL, CLAIM_INSTRUMENTS_SQL, CLAIM_SEGMENTS_SQL, CLAIM_SHARE_LARGEST_SQL, CLAIM_SHARE_SQL, type Claim, type ClaimBlock,
  type ClaimFrame, checkOrganization, claimFrame, endingParams, isClaimBlock, readClaim, shareBinds, shareSegment,
} from "./org_claim";
import { ultraOnSale } from "./payments";
import {
  BUYER_COUNTS_SQL, BUYER_NAME_SQL, KIND_SOURCES, ORG_COUNTS_SQL, ORG_NAME_SQL, type RecordsKind, SEGMENT_COUNTS_SQL, entityOf, isRecordsKind,
  missingTable,
} from "./records_deliveries";
import { type SavedView, listViews } from "./saved_views";
import { type SavedSearch, listSearches } from "./searches";
import { newId } from "./secrets";
import type { Account } from "./session";
import { type EventKind, type EventRow, type EventsRead, eventIdentity, foundKey, listed, readEvents } from "./watch_events";
import { watchLabel } from "./watch_mail";
import { type Watch, listWatches } from "./watches";

// -- the kinds and the rules ------------------------------------------------------------

// The kinds of panel, in the order the page explains them and the Add select
// lists them. The table holds kind as text (no CHECK), so a new kind needs no
// rebuild of the table; a stored kind the site no longer knows is not shown.
export const PANEL_KINDS = ["tenders", "radar", "records", "watches", "view", "briefing", "org", "matches", "api"] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];
export const isPanelKind = (v: unknown): v is PanelKind => typeof v === "string" && (PANEL_KINDS as readonly string[]).includes(v);

// The rows a panel that lists rows shows, and the briefings a dashboard holds
// (each briefing reads its own batch of eight statements).
export const PANEL_ROWS = 5;
export const BRIEFING_PANELS_MAX = 2;
// The data dates a watches panel reads: the week ending with the data date.
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
// first, through rec_expiring_end) cut to PANEL_ROWS and its offset dropped:
// the 5-row form the design names. The same twelve binds as the total.
export const RADAR_TOP_SQL = RADAR_ROWS_END_SQL.replace(/ LIMIT \d+ OFFSET \?13$/, ` LIMIT ${PANEL_ROWS}`);

// -- an analytics view as a panel's ref ---------------------------------------------------

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

// -- the table -------------------------------------------------------------------------

export type PanelRow = { id: string; kind: string; ref: string; pos: number; wide: number; created_at: string };

export const PANELS_LIST_SQL = "SELECT id, kind, ref, pos, wide, created_at FROM dashboard_panels WHERE user_id = ? ORDER BY pos, created_at, id LIMIT 50";

// One insert held to the plan's figure and to BRIEFING_PANELS_MAX briefings
// inside the statement, so two posts at once cannot pass either; the same item
// once (the table's unique key). ?1 the id, ?2 the user, ?3 the kind, ?4 the
// ref, ?5 wide, ?6 the time, ?7 the plan's figure, ?8 the briefings' cap.
export const ADD_PANEL_SQL =
  "INSERT INTO dashboard_panels (id, user_id, kind, ref, pos, wide, created_at) " +
  "SELECT ?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(pos), -1) + 1 FROM dashboard_panels WHERE user_id = ?2), ?5, ?6 " +
  "WHERE (SELECT COUNT(*) FROM dashboard_panels WHERE user_id = ?2) < ?7 " +
  "AND (?3 <> 'briefing' OR (SELECT COUNT(*) FROM dashboard_panels WHERE user_id = ?2 AND kind = 'briefing') < ?8) " +
  "ON CONFLICT (user_id, kind, ref) DO NOTHING";

// A fault that names dashboard_panels missing: the schema not applied since the dashboard.
export const missingPanels = (e: unknown): boolean => /no such table:?\s*dashboard_panels/i.test(String((e as { message?: unknown })?.message ?? e));

// The account's panels in order, or null while the table is not on the database.
export async function listPanels(env: Env, userId: string): Promise<PanelRow[] | null> {
  try {
    return (await env.ACCOUNTS!.prepare(PANELS_LIST_SQL).bind(userId).all<PanelRow>()).results ?? [];
  } catch (e) {
    if (missingPanels(e)) return null;
    throw e;
  }
}

export type Spec = { kind: PanelKind; ref: string; wide: boolean };
export type AddResult = "added" | "exists" | "full" | "briefings_full" | "unsaved";

const addStatement = (db: D1Database, userId: string, plan: Plan, s: Spec, at: string) =>
  db.prepare(ADD_PANEL_SQL).bind(newId(), userId, s.kind, s.ref, s.wide ? 1 : 0, at, dashboardCap(plan), BRIEFING_PANELS_MAX);

export async function addPanel(env: Env, who: { userId: string; plan: Plan }, s: Spec, now = new Date()): Promise<AddResult> {
  const db = env.ACCOUNTS!;
  try {
    const res = await addStatement(db, who.userId, who.plan, s, now.toISOString()).run();
    if ((res.meta?.changes ?? 0) === 1) return "added";
    const row = await db.prepare(
      "SELECT (SELECT COUNT(*) FROM dashboard_panels WHERE user_id = ?1) AS n, " +
      "EXISTS (SELECT 1 FROM dashboard_panels WHERE user_id = ?1 AND kind = ?2 AND ref = ?3) AS here",
    ).bind(who.userId, s.kind, s.ref).first<{ n: number; here: number }>();
    if (row?.here === 1) return "exists";
    return (row?.n ?? 0) >= dashboardCap(who.plan) ? "full" : "briefings_full";
  } catch (e) {
    if (missingPanels(e)) return "unsaved";
    throw e;
  }
}

// The starting layout written as the account's rows, in one batch, before a
// first change is applied to it; the rows as they then stand.
async function writeStarter(env: Env, who: { userId: string; plan: Plan }, specs: readonly Spec[], now: Date): Promise<PanelRow[] | null> {
  const db = env.ACCOUNTS!;
  if (specs.length) await db.batch(specs.map((s, i) => addStatement(db, who.userId, who.plan, s, new Date(now.getTime() + i).toISOString())));
  return listPanels(env, who.userId);
}

// What deleting the account removes (routes.tsx deleteAccount), and what goes
// with a saved search or a briefing the account removes. A database without
// the table holds no panel, so its absence is no fault here.
export async function deletePanelsOf(env: Env, userId: string): Promise<void> {
  try {
    await env.ACCOUNTS!.prepare("DELETE FROM dashboard_panels WHERE user_id = ?").bind(userId).run();
  } catch (e) {
    if (!missingPanels(e)) throw e;
  }
}

export async function deletePanelsFor(env: Env, userId: string, kinds: readonly PanelKind[], ref: string): Promise<void> {
  try {
    await env.ACCOUNTS!.prepare(`DELETE FROM dashboard_panels WHERE user_id = ? AND ref = ? AND kind IN (${kinds.map(() => "?").join(", ")})`)
      .bind(userId, ref, ...kinds).run();
  } catch (e) {
    if (!missingPanels(e)) throw e;
  }
}

// -- what the account holds -----------------------------------------------------------------

// The rows the panels name, read by the readers the account pages use, at
// once: the panels, the saved searches, the briefings, the claim, the watches,
// the keys and the saved views. A table the database does not hold yet reads
// as none.
export type Holdings = {
  panels: PanelRow[] | null; searches: SavedSearch[]; briefings: Briefing[]; claim: Claim | null; watches: Watch[]; keys: KeyRow[];
  views: SavedView[];
};

async function absentAs<T>(read: Promise<T>, absent: T): Promise<T> {
  try {
    return await read;
  } catch (e) {
    if (missingTable(e)) return absent;
    throw e;
  }
}

export async function readHoldings(env: Env, userId: string): Promise<Holdings> {
  const [panels, searches, briefings, claim, watches, keys, views] = await Promise.all([
    listPanels(env, userId), listSearches(env, userId), listBriefings(env, userId), absentAs(readClaim(env, userId), null),
    absentAs(listWatches(env, userId), [] as Watch[]), listKeys(env, userId), listViews(env, userId),
  ]);
  return { panels, searches, briefings: briefings ?? [], claim, watches, keys, views: views ?? [] };
}

// The starting layout: the watches, the 3-month list, matching notices and the
// organization's years block when it has claimed one, its first two saved
// tender searches, and the API panel when it holds a key.
export function startingLayout(h: Pick<Holdings, "searches" | "claim" | "keys">): Spec[] {
  const out: Spec[] = [{ kind: "watches", ref: "", wide: true }, { kind: "radar", ref: "3m", wide: true }];
  if (h.claim) out.push({ kind: "matches", ref: "", wide: true }, { kind: "org", ref: "years", wide: true });
  for (const s of h.searches.filter((x) => x.kind === "tenders").slice(0, 2)) out.push({ kind: "tenders", ref: s.id, wide: true });
  if (h.keys.some((k) => !k.revoked_at)) out.push({ kind: "api", ref: "", wide: true });
  return out;
}

// A panel as the page draws it: a stored row, or a panel of the starting
// layout (id "s" and its place, written once the reader changes it).
export type Shown = { id: string; kind: PanelKind; ref: string; wide: boolean };
const STARTER_ID_RE = /^s([0-9]{1,2})$/;

export function shownPanels(h: Holdings): { list: Shown[]; starter: boolean } {
  if (h.panels && h.panels.length) {
    const list = h.panels.filter((r) => isPanelKind(r.kind)).map((r) => ({ id: r.id, kind: r.kind as PanelKind, ref: r.ref, wide: r.wide === 1 }));
    return { list, starter: false };
  }
  return { list: startingLayout(h).map((s, i) => ({ id: `s${i}`, ...s })), starter: true };
}

// -- a panel's ref, checked as the post gives it -----------------------------------------------

const ID_RE = /^[0-9a-f]{32}$/;
const SEARCH_KINDS: Readonly<Partial<Record<PanelKind, (kind: string) => boolean>>> = {
  tenders: (k) => k === "tenders", radar: (k) => k === "expiring", records: (k) => isRecordsKind(k),
};

// The panel a post names, its ref in its stored form, if it names one the
// account holds; null for anything else. A view panel names a view's address,
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

// -- reading the panels --------------------------------------------------------------------

// What a panel's body is once read: its count for the head, its body, and the
// item's name when only the read knows it (a view's buyer or organization).
type Body = { count?: unknown; body: unknown; item?: string };
// A panel's reads: its statements for the page's records batch, any other
// read (a static file, the watches' or a briefing's own batch), and how the
// rows become its body; null from draw says the panel cannot be read now.
type Job = { queries: Query[]; extra?: () => Promise<unknown>; draw: (rows: Row[][] | null, extra: unknown) => Body | null };
// A panel resolved against what the account holds: its head, its "See all",
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

// Every table on the dashboard is one of the site's, held to PANEL_ROWS rows
// and three columns so it fits half a row from 1,280 px; restacked on a phone.
const fyHead = (lang: Lang, fy: number, current: number) =>
  fy === current ? t(lang, "analytics.to_date", { fy: fiscalLabel(lang, fy) }) : fiscalLabel(lang, fy);

const Figure: FC<{ lang: Lang; n: number; cents: number | null }> = ({ lang, n, cents }) => (
  n ? <>{cents === null ? t(lang, "common.not_stated") : fmtMoney(cents / 100, lang)}<br /><span class="muted small">{recordsText(lang, n)}</span></>
    : <span class="muted">{recordsText(lang, 0)}</span>
);

// Records by source over two fiscal years: the records panel and the organization's years block.
function sourceYears(lang: Lang, rows: Row[], sources: readonly MoneySource[], current: number) {
  const at = new Map(rows.map((r) => [`${int(r.src)}:${int(r.fy)}`, { n: int(r.n), cents: num(r.cents) }]));
  const cell = (src: MoneySource, fy: number) => at.get(`${SOURCE_NUMBER[src]}:${fy}`) ?? { n: 0, cents: null };
  return (
    <div class="table-wrap">
      <Table sorting="none" cols={[
        { kind: "main", label: t(lang, "col.source") },
        { kind: "total", label: fyHead(lang, current - 1, current) },
        { kind: "total", label: fyHead(lang, current, current) },
      ]}>
        <tbody>
          {sources.map((src) => (
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
  );
}

// The radar's count and value, then its PANEL_ROWS rows soonest first: a window, a saved search of one, the organization's own.
function radarBody(lang: Lang, rows: Row[][] | null, today: string): Body | null {
  if (!rows) return null;
  const total = rows[0]?.[0] ?? {};
  const n = int(total.n);
  const list = (rows[1] ?? []).slice(0, PANEL_ROWS).map((r) => radarRow(r, today)).filter((r): r is ExpiringRow => r !== null);
  return {
    count: fmtInt(n, lang),
    body: n && list.length ? <>
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
// statements as the page does (their page of rows, of which the panel shows
// PANEL_ROWS); anything else the total and RADAR_TOP_SQL.
function radarQueries(p: ReturnType<typeof radarParams>): Query[] {
  if (p.prov) {
    const binds = radarProvBinds(p);
    return [{ sql: RADAR_PROV_TOTAL_SQL, params: binds }, { sql: RADAR_PROV_ROWS_END_SQL, params: [...binds, 0] }];
  }
  const binds = radarBinds(p);
  return [{ sql: RADAR_TOTAL_SQL, params: binds }, { sql: RADAR_TOP_SQL, params: binds }];
}

function tendersJob(ctx: Ctx, s: SavedSearch): Job {
  const { lang, clock } = ctx;
  return {
    queries: [],
    extra: () => ctx.open(),
    draw: (_rows, extra) => {
      const open = extra as TenderRow[] | null;
      if (!open) return null;
      const hits = filterTenders(open, readTenderQuery(new URL(s.params, READ_BASE)), clock).filter((r) => !closingPassed(r.closing, clock));
      const soon = hits.filter((r) => r.closing).sort((a, b) => (a.closing! < b.closing! ? -1 : a.closing! > b.closing! ? 1 : 0)).slice(0, PANEL_ROWS);
      return {
        count: tn(lang, "tenders.count_one", "tenders.count_many", hits.length, { n: fmtInt(hits.length, lang) }),
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

function recordsJob(ctx: Ctx, s: SavedSearch): Job | null {
  const e = entityOf(s.kind, s.params);
  if (!e) return null;
  const current = fiscalYearOf(ctx.today);
  return {
    queries: [{ sql: COUNTS_SQL[e.kind], params: [e.key, current - 1, current] }],
    draw: (rows) => (rows ? { body: sourceYears(ctx.lang, rows[0] ?? [], KIND_SOURCES[e.kind], current) } : null),
  };
}

// The week's events of every watch: how many of each kind, then the newest
// PANEL_ROWS, an event two watches reach once.
function watchesJob(ctx: Ctx): Job {
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
      const newest = [...seen.values()].sort((a, b) => (a.r.day === b.r.day ? 0 : a.r.day < b.r.day ? 1 : -1)).slice(0, PANEL_ROWS);
      return {
        count: fmtInt(total, lang),
        body: <>
          <p class="small">{[...byKind].map(([k, n]) => t(lang, "interest.pair", { name: t(lang, EVENT_KEY[k]), value: fmtInt(n, lang) })).join(" · ")}</p>
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

// An analytics view's first chart (pages/analytics.tsx): value by fiscal
// quarter for a buyer, by fiscal year for an organization, buyers and
// organizations by fiscal year for a segment; at the ref's source and
// period, from the one statement the view reads for it, with the
// buyer's or organization's name read by its key.
function viewJob(ctx: Ctx, v: ViewRef): Job | null {
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
      const lead = <p class="muted small">{t(lang, "analytics.lead", {
        source: sourceLabel(lang, v.source), first: fiscalLabel(lang, span.first), last: fiscalLabel(lang, span.last),
      })}</p>;
      if (!data.length) return { item: name, body: <>{lead}<p class="muted">{t(lang, "analytics.none")}</p></> };
      const fy = (y: number) => (y === span.current ? t(lang, "analytics.to_date", { fy: fiscalLabel(lang, y) }) : fiscalLabel(lang, y));
      let panels: ChartPanel[];
      let domain: [number, number];
      let fmt = (x: number) => fmtMoneyShort(x, lang);
      let axis = fiscalAxis(span.first, span.last, (y) => fiscalLabel(lang, y));
      let gap = barGap(years);
      if (v.view === "buyer") {
        const title = t(lang, "analytics.chart_quarters", { source: sourceLabel(lang, v.source) });
        axis = fiscalAxis(span.first, span.last, (y) => fiscalLabel(lang, y), 4);
        domain = [span.first * 4, (span.last + 1) * 4];
        gap = barGap(years * 4);
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
        item: name,
        body: <>
          {lead}
          <div class="chart">
            <ChartStack domain={domain} panels={panels} height={v.view === "buyer" ? 140 : 110} xLabels={axis.labels} grid={v.view === "buyer" ? axis.grid : undefined}
              fmt={fmt} aria={t(lang, "analytics.chart_aria")} gap={gap} />
          </div>
        </>,
      };
    },
  };
}

// This week so far: the briefing's sections from the week's first data date
// (briefings.ts weekAnchor) to the data date, as counts.
function briefingJob(ctx: Ctx, b: Briefing): Job {
  const { lang } = ctx;
  const start = addDays(weekAnchor(ctx.today), -1);
  return {
    queries: [],
    extra: () => readBriefing(ctx.env, b, ctx.today, start),
    draw: (_rows, extra) => {
      const read = extra as Awaited<ReturnType<typeof readBriefing>>;
      if (!read || read.state !== "ready") return null;
      const d = read.data;
      const line = (one: Key, many: Key, n: number) => <li>{tn(lang, one, many, n, { n: fmtInt(n, lang) })}</li>;
      return {
        body: (
          <ul class="plain dash-counts">
            {line("briefing.subj_notices_one", "briefing.subj_notices_many", d.notices.n)}
            {line("briefing.subj_awards_one", "briefing.subj_awards_many", d.awards.n)}
            {line("briefing.subj_amended_one", "briefing.subj_amended_many", d.amended.n)}
            {line("briefing.subj_ending_one", "briefing.subj_ending_many", d.ending.n)}
          </ul>
        ),
      };
    },
  };
}

// One block of "Your organization" (org_claim.ts readBlocks, the block alone).
function orgJob(ctx: Ctx, block: ClaimBlock): Job | null {
  const { lang, frame: f } = ctx;
  const claim = ctx.h.claim;
  const oid = ctx.org ? orgNumber(ctx.org.id) : null;
  if (!claim || !ctx.org || oid === null) return null;
  switch (block) {
    case "years":
      return {
        queries: [{ sql: ORG_COUNTS_SQL, params: [oid, f.current - 1, f.current] }],
        draw: (rows) => rows ? {
          body: <>{sourceYears(lang, rows[0] ?? [], KIND_SOURCES.organization, f.current)}<p class="muted small">{t(lang, "orgclaim.foot_years")}</p></>,
        } : null,
      };
    case "segments":
      return {
        queries: [{ sql: CLAIM_SEGMENTS_SQL, params: [oid, f.first, f.current] }],
        draw: (rows) => {
          if (!rows) return null;
          const all = rows[0] ?? [];
          const src = all.some((r) => int(r.src) === 1) ? 1 : 2;
          const top = all.filter((r) => int(r.src) === src).slice(0, PANEL_ROWS);
          const source = src === 1 ? "awards" : "history";
          return {
            body: top.length ? <>
              <p class="muted small">{t(lang, "analytics.lead", { source: sourceLabel(lang, source), first: fiscalLabel(lang, f.first), last: fiscalLabel(lang, f.current) })}</p>
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
            </> : <p class="muted">{t(lang, "orgclaim.none_segments", { n: fmtInt(MAX_YEARS, lang) })}</p>,
          };
        },
      };
    case "share": {
      const competitors = claim.competitors.map((c) => orgNumber(c)).filter((n): n is number => n !== null);
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
          const list = [...years].sort(([a], [b]) => b - a).slice(0, PANEL_ROWS);
          if (shown === null || !list.length) {
            return { body: <p class="muted">{t(lang, "orgclaim.none_share", { source: sourceLabel(lang, "awards"), n: fmtInt(MAX_YEARS, lang) })}</p> };
          }
          const code = segmentCode(shown);
          return {
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
        queries: radarQueries(endingParams(oid, f)),
        draw: (rows) => radarBody(lang, rows, f.today),
      };
    case "buyers":
      return {
        queries: [{ sql: CLAIM_BUYERS_SQL, params: [oid, f.firstDay, f.today, f.today, f.endLast] }],
        draw: (rows) => {
          if (!rows) return null;
          const top = (rows[0] ?? []).slice(0, PANEL_ROWS);
          return {
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
          const top = all.slice(0, PANEL_ROWS);
          return {
            count: fmtInt(all.length, lang),
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

// The PANEL_ROWS open notices closest to the claimed organization's records,
// ranked as /account/matches ranks them (public/fit.js), with the line every
// match carries; the states the page names otherwise, with its own words.
function matchesJob(ctx: Ctx): Job | null {
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
      const top = matches.slice(0, Math.min(PANEL_ROWS, capped)) as { row: TenderRow; score: Score }[];
      return {
        count: tn(lang, "fit.count_one", "fit.count_many", capped, { n: fmtInt(capped, lang) }),
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

// Each live key's requests today, beside the plan's daily figure (api_keyed_spec.ts keyQuota).
function apiJob(ctx: Ctx): Job {
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
      return {
        body: <>
          {quota ? <p class="muted small">{t(lang, "interest.pair", { name: t(lang, "apiusage.tile_day"), value: fmtInt(quota.perDay, lang) })}</p> : null}
          <div class="table-wrap">
            <Table sorting="none" cols={[{ kind: "main", label: t(lang, "account.key_name") }, { kind: "count", label: t(lang, "apiusage.tile_today") }]}>
              <tbody>
                {live.slice(0, PANEL_ROWS).map((k) => (
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

// A panel against what the account holds: its head and its reads, or gone.
function resolve(ctx: Ctx, s: Shown): Resolved {
  const { lang, h } = ctx;
  const title = s.kind === "org" && isClaimBlock(s.ref) ? t(lang, "dash.kind_org", { block: t(lang, BLOCK_KEY[s.ref]) }) : t(lang, KIND_KEY[s.kind]);
  const gone = (href: string): Resolved => ({ shown: s, title, item: null, href, job: null });
  const search = (ok: (kind: string) => boolean) => h.searches.find((x) => x.id === s.ref && ok(x.kind));
  switch (s.kind) {
    case "tenders": {
      const found = search((k) => k === "tenders");
      return found ? { shown: s, title, item: found.label, href: found.params, job: tendersJob(ctx, found) } : gone("/account/searches");
    }
    case "radar": {
      const params = isWindow(s.ref) ? `/expiring/${s.ref}` : search((k) => k === "expiring")?.params;
      if (!params) return gone("/account/searches");
      const url = new URL(params, READ_BASE);
      const window = (/^\/expiring\/(3m|6m|12m)$/.exec(url.pathname)?.[1] ?? "3m") as ExpiringWindow;
      const item = isWindow(s.ref) ? t(lang, WINDOW_KEY[s.ref]) : search((k) => k === "expiring")!.label;
      return {
        shown: s, title, item, href: params,
        job: { queries: radarQueries(radarParams(window, ctx.today, readExpiringQuery(url))), draw: (rows) => radarBody(lang, rows, ctx.today) },
      };
    }
    case "records": {
      const found = search(isRecordsKind);
      const job = found ? recordsJob(ctx, found) : null;
      return found && job ? { shown: s, title, item: found.label, href: found.params, job } : gone("/account/searches");
    }
    case "watches":
      return { shown: s, title, item: null, href: "/account/watches", job: watchesJob(ctx) };
    case "view": {
      // A saved view by its id: its name in the head and its address as saved (the saved views page moves a merged id).
      if (ID_RE.test(s.ref)) {
        const saved = h.views.find((x) => x.id === s.ref);
        const v = saved ? viewRef(saved.address) : null;
        const read = v ? viewJob(ctx, v) : null;
        // The reader's name for the view heads the panel, in place of the buyer's or organization's the read gives.
        const job: Job | null = read ? { ...read, draw: (rows, extra) => { const b = read.draw(rows, extra); return b ? { ...b, item: undefined } : null; } } : null;
        return saved && job ? { shown: s, title, item: saved.name, href: saved.address, job } : gone("/account/views");
      }
      const v = viewRef(s.ref);
      const job = v ? viewJob(ctx, v) : null;
      return v && job ? { shown: s, title, item: null, href: viewAddress(v), job } : gone("/analytics");
    }
    case "briefing": {
      const b = h.briefings.find((x) => x.id === s.ref);
      return b ? { shown: s, title, item: briefingLabel(lang, b), href: briefingPath(b), job: briefingJob(ctx, b) } : gone("/account/searches#briefings");
    }
    case "org": {
      const job = isClaimBlock(s.ref) ? orgJob(ctx, s.ref) : null;
      return job && ctx.org ? { shown: s, title, item: ctx.org.profile.organization.display_name, href: "/account/organization", job } : gone("/account/organization");
    }
    case "matches": {
      const job = matchesJob(ctx);
      return job ? { shown: s, title, item: null, href: "/account/matches", job } : gone("/account/organization");
    }
    case "api":
      return { shown: s, title, item: null, href: "/account/api", job: apiJob(ctx) };
  }
}

// Every panel's reads: the records statements in one batch (each panel apart
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
    // One panel's statement (a table the nightly has not made yet) leaves the others.
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

// -- the page --------------------------------------------------------------------------------

const Csrf: FC<{ account: Account }> = ({ account }) => <input type="hidden" name="csrf" value={account.csrf} />;

// One change as a form; edit: the post returns to edit mode.
const PostButton: FC<{ account: Account; action: string; fields?: Record<string, string>; label: string; edit?: boolean }> = (
  { account, action, fields = {}, label, edit = true },
) => (
  <form method="post" action={action} class="account-inline">
    <Csrf account={account} />
    {edit ? <input type="hidden" name="from" value="edit" /> : null}
    {Object.entries(fields).map(([k, v]) => <input type="hidden" name={k} value={v} />)}
    <button type="submit" class="btn-link">{label}</button>
  </form>
);

const NOTICE: Readonly<Record<string, Key>> = {
  added: "dash.added", exists: "dash.added", full: "dash.full", briefings_full: "dash.briefings_full", unsaved: "dash.unsaved",
};

// The Add select's choices: what the account holds that is not on the
// dashboard already, by kind, in PANEL_KINDS order. An analytics view is
// added from its own page, or here once it is saved.
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

const AddPanel: FC<{ lang: Lang; account: Account; h: Holdings; n: number; cap: number; saved: boolean; taken: ReadonlySet<string> }> = (
  { lang, account, h, n, cap, saved, taken },
) => {
  const choices = addChoices(lang, h, taken);
  return (
    <Panel title={t(lang, "dash.add_panel")} count={t(lang, "dash.count", { n: fmtInt(n, lang), cap: fmtInt(cap, lang) })} class="panel-form">
      {!saved ? <p class="muted">{t(lang, "dash.unsaved")}</p>
        : n >= cap ? <p>{t(lang, "dash.full", { cap: fmtInt(cap, lang) })}</p>
        : choices.length ? (
          <form method="post" action={`${DASHBOARD_PATH}/panels`} class="stack">
            <Csrf account={account} />
            <input type="hidden" name="from" value="edit" />
            <label>
              {t(lang, "dash.add_panel")}
              <select name="panel">
                {choices.map((g) => <optgroup label={g.label}>{g.options.map(([v, label]) => <option value={v}>{label}</option>)}</optgroup>)}
              </select>
            </label>
            <button type="submit" class="btn btn-primary">{t(lang, "dash.add")}</button>
          </form>
        ) : null}
    </Panel>
  );
};

type Drawn = { r: Resolved; body: Body | null };

const DashPanel: FC<{ lang: Lang; account: Account; d: Drawn; i: number; n: number; edit: boolean; saved: boolean }> = (
  { lang, account, d, i, n, edit, saved },
) => {
  const { r, body } = d;
  const s = r.shown;
  const base = `${DASHBOARD_PATH}/panels/${s.id}`;
  const item = body?.item ?? r.item;
  const remove = <PostButton account={account} action={`${base}/delete`} label={t(lang, "dash.remove")} />;
  const controls = edit && saved ? (
    <span class="dash-controls">
      {i > 0 ? <PostButton account={account} action={`${base}/move`} fields={{ dir: "up" }} label={t(lang, "dash.up")} /> : null}
      {i < n - 1 ? <PostButton account={account} action={`${base}/move`} fields={{ dir: "down" }} label={t(lang, "dash.down")} /> : null}
      <PostButton account={account} action={`${base}/width`} fields={{ wide: s.wide ? "0" : "1" }} label={t(lang, s.wide ? "dash.narrow" : "dash.wide")} />
      {remove}
    </span>
  ) : null;
  return (
    <Panel class={s.wide ? "dash-panel" : "dash-panel dash-half"} id={`panel-${s.id}`}
      title={<>{r.title}{item ? <span class="dash-item">{item}</span> : null}</>}
      count={r.job && body?.count !== undefined ? body.count : undefined}
      tools={<>{r.job ? <a href={r.href}>{t(lang, "dash.see_all")}</a> : null}{controls}</>}>
      {!r.job ? <><p>{t(lang, "dash.gone")}</p>{saved && !edit
        ? <PostButton account={account} action={`${base}/delete`} label={t(lang, "dash.remove")} edit={false} /> : null}</>
        : body ? (body.body as any)
        : <p class="muted">{t(lang, "dash.unavailable")}</p>}
    </Panel>
  );
};

export function dashboardView(
  lang: Lang, account: Account,
  s: { drawn: Drawn[]; h: Holdings; starter: boolean; edit: boolean; notice: string | null; cap: number },
) {
  const saved = s.h.panels !== null;
  const stored = s.starter ? 0 : s.drawn.length;
  const taken = new Set(s.drawn.map((d) => `${d.r.shown.kind}:${d.r.shown.ref}`));
  const action = s.edit
    ? <a href={DASHBOARD_PATH} class="btn">{t(lang, "dash.done")}</a>
    : <a href={`${DASHBOARD_PATH}?edit=1`} class="btn">{t(lang, "dash.edit")}</a>;
  return (
    <>
      <PageHead lang={lang} title={t(lang, "dash.title")} lead={t(lang, "dash.lead")} actions={action} />
      {s.notice ? <p class="account-notice" role="status">{s.notice}</p> : null}
      {s.starter ? <p class="muted">{t(lang, "dash.starter")}</p> : null}
      {s.edit && !saved ? <p class="muted">{t(lang, "dash.unsaved")}</p> : null}
      <div class="dash-grid">
        {s.drawn.map((d, i) => <DashPanel lang={lang} account={account} d={d} i={i} n={s.drawn.length} edit={s.edit} saved={saved} />)}
      </div>
      {s.edit ? <AddPanel lang={lang} account={account} h={s.h} n={s.starter ? s.drawn.length : stored} cap={s.cap} saved={saved} taken={taken} /> : null}
    </>
  );
}

// What a Free or Pro account reads at the address while Ultra is on sale:
// the head, what the dashboard holds, the gate line and the plan cards.
// Ultra's link is the page's filled button, the dashboard being Ultra's.
export function teaseView(lang: Lang, cards: ReturnType<typeof planCards>) {
  const own = cards.map((c) => ({ ...c, actions: c.actions.map((a) => ({ ...a, primary: c.plan === "ultra" && a === c.actions[0] })) }));
  return (
    <>
      <PageHead lang={lang} title={t(lang, "dash.title")} />
      <Panel title={t(lang, "dash.what_title")}>
        <p>{t(lang, "dash.what_lead", { cap: fmtInt(dashboardCap("ultra"), lang) })}</p>
        <ul>{PANEL_KINDS.map((k) => <li>{t(lang, WHAT_KEY[k])}</li>)}</ul>
      </Panel>
      <p class="muted">{t(lang, "dash.gate")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></p>
      <PlanCards lang={lang} plans={own} />
    </>
  );
}

// The shell of every dashboard response: an account page with the rail's
// Dashboard item as the current one.
async function dashPage(c: Context<AppEnv>, body: unknown, status = 200): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "dash.title")} dataAsOf={stats?.data_as_of ?? null} active={DASHBOARD_PATH}
      seo={{ path: DASHBOARD_PATH, description: t(lang, "account.description"), noindex: true }}>
      {body as any}
    </Layout>,
    status,
  );
}

export async function dashboardPage(c: Context<AppEnv>, who: Account): Promise<Response> {
  const lang = c.get("lang");
  if (!holdsDashboard(who.plan)) {
    const [price, ultra] = [checkoutPrice(c.env), await ultraCheckoutPrice(c.env)];
    const cards = planCards(lang, { price, ultra, reader: who.plan === "pro" ? "pro" : "free", place: "tease" });
    return dashPage(c, teaseView(lang, cards));
  }
  const h = await readHoldings(c.env, who.userId);
  const stats = await loadStats(c.env).catch(() => null);
  const today = todayOf(stats?.data_as_of);
  const { list, starter } = shownPanels(h);
  let openList: Promise<TenderRow[] | null> | null = null;
  const needsOrg = list.some((s) => s.kind === "org" || s.kind === "matches");
  const org = needsOrg && h.claim ? await checkOrganization(c.env, h.claim.organizationId).catch(() => null) : null;
  const ctx: Ctx = {
    lang, env: c.env, who, h, today, clock: clockOf(c.env), frame: claimFrame(today), org,
    open: () => (openList ??= loadOpenList(c.env).catch(() => null)),
  };
  const resolved = list.map((s) => resolve(ctx, s));
  const bodies = await readAll(ctx, resolved);
  const drawn = resolved.map((r) => ({ r, body: bodies.get(r) ?? null }));
  const m = c.req.query("m") ?? "";
  const cap = dashboardCap(who.plan);
  const notice = NOTICE[m] ? t(lang, NOTICE[m], { cap: fmtInt(cap, lang), n: fmtInt(BRIEFING_PANELS_MAX, lang) }) : null;
  return dashPage(c, dashboardView(lang, who, { drawn, h, starter, edit: c.req.query("edit") === "1", notice, cap }));
}

// -- the posts ------------------------------------------------------------------------------

// Where a post returns: the dashboard, in edit mode for the page's own
// controls, with what happened, in the page's language.
function back(c: Context<AppEnv>, fields: Record<string, string>, m = ""): Response {
  const q = [fields.from === "edit" ? "edit=1" : "", m ? `m=${m}` : "", c.get("lang") === "fr" ? "lang=fr" : ""].filter(Boolean).join("&");
  return c.redirect(`${DASHBOARD_PATH}${q ? `?${q}` : ""}`, 303);
}

// The starting layout written before a first change, when the account has
// no row yet: the change then applies to the rows as the reader saw them.
async function rowsForChange(env: Env, who: Account): Promise<{ rows: PanelRow[] | null; specs: Spec[] | null }> {
  const rows = await listPanels(env, who.userId);
  if (rows === null || rows.length) return { rows, specs: null };
  const h = await readHoldings(env, who.userId);
  const specs = startingLayout(h);
  return { rows: await writeStarter(env, who, specs, new Date()), specs };
}

// Add: the panel a page's "Add to dashboard" names (kind and ref) or the Add
// select's choice (panel, "kind:ref"), checked against what the account holds.
export async function addPanelPost(c: Context<AppEnv>, who: Account, fields: Record<string, string>): Promise<Response> {
  const lang = c.get("lang");
  if (!holdsDashboard(who.plan)) return c.redirect(DASHBOARD_PATH, 303);
  const [kind, ref] = typeof fields.panel === "string"
    ? [fields.panel.slice(0, Math.max(0, fields.panel.indexOf(":"))), fields.panel.slice(fields.panel.indexOf(":") + 1)]
    : [fields.kind, fields.ref ?? ""];
  const h = await readHoldings(c.env, who.userId);
  const spec = specOf(kind, ref, h);
  if (!spec) return c.text(t(lang, "form.rejected"), 400);
  if (h.panels === null) return back(c, fields, "unsaved");
  if (!h.panels.length) await writeStarter(c.env, who, startingLayout(h), new Date());
  const result = await addPanel(c.env, who, spec);
  return back(c, fields, result);
}

export type EditOp = { op: "move"; dir: "up" | "down" } | { op: "width"; wide: boolean } | { op: "delete" };

// Move, width and remove, on the account's own row only (a starter's place
// once the starter is written).
export async function editPanelPost(c: Context<AppEnv>, who: Account, id: string, op: EditOp, fields: Record<string, string>): Promise<Response> {
  if (!holdsDashboard(who.plan)) return c.redirect(DASHBOARD_PATH, 303);
  const starter = STARTER_ID_RE.exec(id);
  if (!ID_RE.test(id) && !starter) return c.text(t(c.get("lang"), "form.rejected"), 400);
  const { rows, specs } = await rowsForChange(c.env, who);
  if (rows === null) return back(c, fields, "unsaved");
  const spec = starter && specs ? specs[Number(starter[1])] : undefined;
  const target = spec ? rows.find((r) => r.kind === spec.kind && r.ref === spec.ref) : rows.find((r) => r.id === id);
  if (!target) return back(c, fields);
  const db = c.env.ACCOUNTS!;
  if (op.op === "delete") {
    await db.prepare("DELETE FROM dashboard_panels WHERE id = ? AND user_id = ?").bind(target.id, who.userId).run();
  } else if (op.op === "width") {
    await db.prepare("UPDATE dashboard_panels SET wide = ? WHERE id = ? AND user_id = ?").bind(op.wide ? 1 : 0, target.id, who.userId).run();
  } else {
    const order = rows.map((r) => r.id);
    const i = order.indexOf(target.id);
    const j = op.dir === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < order.length) {
      [order[i], order[j]] = [order[j], order[i]];
      await db.batch(order.map((pid, pos) => db.prepare("UPDATE dashboard_panels SET pos = ? WHERE id = ? AND user_id = ?").bind(pos, pid, who.userId)));
    }
  }
  return back(c, fields);
}

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
