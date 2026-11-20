// Add a Tile's Analytics door (docs/accounts.md, Dashboard): find any buyer,
// organization or segment from the dashboard, then add its analytics tables
// as tiles from a checklist; the same checklist from a saved view's row; and
// the starters an empty dashboard offers. routes.tsx mounts:
//
//   GET  /account/dashboard/find               a search's matches (q), a few of each kind; kind narrows them to
//                                              one kind, all=1 carries a starter's "every table checked" on
//   GET  /account/dashboard/tables/:base/:id   a subject's checklist (:base buyers, organizations or segments):
//                                              its name, its source and period, its tables
//   POST /account/dashboard/tables/:base/:id   every table checked, each a tile
//   POST /account/dashboard/starter            an empty dashboard filled from a starter (starter org or ending)
//
// each for the dashboard board names (none: the account's first). Every one
// is Ultra's: any other reader gets what the dashboard's address gives them
// (routes.tsx dashboardDoor), and a post from one goes to that address.
//
// The find page reads what the site's own search reads (search_db.ts
// runSearch: the hosted search database's one batch of /search's first page),
// so it names no one /search does not name, a supplier withheld as a person
// among them; the segments are the site's list of 57, matched here by the
// search's own rule (lineMatches), no database read. While the analytics
// builder is the reader's (build_views.tsx buildsOn), each match also opens in
// the builder ("Open in the builder", builder.ts buildLink), so the builder's
// own fields never need an organization's id typed: its organization field
// links here. The checklist reads one
// records batch: the buyer's or the organization's name by its key, and for an
// organization at a source with segments its largest ones (the share table's
// choice); each statement is one the dashboard or the analytics view already
// sends, bounded. A segment's checklist reads no record.
//
// A table posted is checked as Add to dashboard's is (dashboard.tsx
// analyticRef: the view, its id, the source, the period, the share table's
// segment) and stored as the dashboard writes it (analyticAddress); a table
// its view does not draw, or that does not apply at the source
// (pages/analytics.tsx tableApplies), refuses the whole post with nothing
// added. The tiles go in one batch, each insert holding the dashboard's
// figure and the same item once (ADD_TILE_SQL), laid out under the others two
// to a row (public/dash-grid.js placeAll), in the checklist's order; what does
// not fit, or is there already, is counted and said on the dashboard.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { placeAll, startSize, type Tile } from "../../public/dash-grid.js";
import { MONEY_SOURCES, type MoneySource, SEGMENTS, SEGMENT_CODES, SEGMENT_SHORT } from "../constants";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, provinceName, segmentLabel, sourceLabel, t, type Key, type Lang } from "../i18n";
import { PageHead, Panel, todayOf } from "../layout";
import { TABLE_TITLES, VIEW_TABLES, tableApplies } from "../pages/analytics";
import { directoryName } from "../pages/organization";
import { searchPath } from "../pages/search";
import {
  EARLIEST_FY, ORG_SEGMENTS_SQL, PERIODS, SEGMENT_SOURCES, SOURCE_NUMBER, type Query, type Row, fiscalLabel, fiscalYearOf, num, orgNumber, planYears,
  readRecords, segmentCode,
} from "../records_db";
import { type BuyerHit, MAX_Q, type OrgHit, type SearchResult, lineMatches, runSearch, searchTerms } from "../search_db";
import { DEFAULT_YEARS, type Frame, type More, type View, orgMore, rivalsOf, shareSegmentOf, viewBase, viewFrame, viewOf } from "../view_address";
import {
  ADD_ANCHOR, ADD_PANEL_SQL, ADD_TILE_SQL, BRIEFING_PANELS_MAX, Csrf, type Holdings, LAYOUT_MARKER, type PanelRow, type Spec, type Shown, type Starter, type TablesCount,
  analyticAddress, analyticRef, asTile, back, boardField, dashPage, hereOf, listPanels, readBoard, readHoldings, shownTiles, sizeKey, starterSpecs,
  startingLayout, writeFirst, writeStarter,
} from "./dashboard";
import { buildLink } from "../builder";
import { buildsOn } from "./build_views";
import { analyticPanelRef, boardLabels } from "./dashboard_add";
import { DASHBOARD_PATH, FIND_PATH, TABLES_PATH, boardPath, holdsDashboard, tileCap } from "./dashboard_rule";
import { BUYER_NAME_SQL, ORG_NAME_SQL } from "./records_deliveries";
import { newId } from "./secrets";
import type { Account } from "./session";

// -- the subjects ------------------------------------------------------------------------------

// A view's base in an address (/buyers/...), and back.
export const VIEW_BASES = ["buyers", "organizations", "segments"] as const;
export type ViewBase = (typeof VIEW_BASES)[number];
const VIEW_OF_BASE: Readonly<Record<ViewBase, View>> = { buyers: "buyer", organizations: "organization", segments: "segment" };

// A subject's checklist at an address: its base and id, then a view's own
// parameters (the source, the period, an organization's segment and
// organizations), the dashboard (board) and all=1.
export function tablesHref(base: ViewBase, id: string, q: Record<string, string | readonly string[] | null | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === null || v === undefined || v === "") continue;
    for (const one of typeof v === "string" ? [v] : v) p.append(k, one);
  }
  const s = p.toString();
  return `${TABLES_PATH}/${base}/${id}${s ? `?${s}` : ""}`;
}

// The source a subject's page opens on: the one with the most records (the
// analytics view's default), the first on a tie.
function largestSource(f: Pick<BuyerHit, "n_awards" | "n_history" | "n_contracts" | "n_grants">): MoneySource {
  const n: Record<MoneySource, number> = { awards: f.n_awards, history: f.n_history, contracts: f.n_contracts, grants: f.n_grants };
  return MONEY_SOURCES.reduce((best, s) => (n[s] > n[best] ? s : best), MONEY_SOURCES[0]);
}

// -- the dashboard a page names ----------------------------------------------------------------------

// The dashboard a door is for: its id (null for the account's first, stored or
// computed) and the name it goes by; found false for one the account does
// not hold.
type BoardFor = { id: string | null; label: string; found: boolean };
function boardFor(lang: Lang, h: Pick<Holdings, "board">, want: string | null): BoardFor {
  const b = h.board;
  if (!b || !b.boards.length) return { id: null, label: t(lang, "dash.board_n", { n: 1 }), found: want === null };
  const labels = boardLabels(lang, b.boards);
  const id = b.id ?? b.boards[0].id;
  return { id: want, label: labels.get(id) ?? "", found: b.found };
}

// A dashboard the account does not hold, named by a door's address: the first, as that dashboard's own address
// sends one, in the page's language.
const toFirst = (c: Context<AppEnv>) => c.redirect(c.get("lang") === "fr" ? `${DASHBOARD_PATH}?lang=fr` : DASHBOARD_PATH, 303);

// -- the find page -------------------------------------------------------------------------------

// The matches of each kind the find page lists among the three, and with one kind asked.
export const FIND_ROWS = 6;
export const FIND_ROWS_ONE = 20;
const KINDS = ["buyer", "organization", "segment"] as const;
type FindKind = (typeof KINDS)[number];
const isFindKind = (v: unknown): v is FindKind => typeof v === "string" && (KINDS as readonly string[]).includes(v);

// The segments a search's words name: each word in the segment's code and
// title, or its short name, in either language, the last as a prefix, as
// /search matches a name (search_db.ts lineMatches); every segment for no word.
export function segmentMatches(terms: readonly string[]): string[] {
  if (!terms.length) return [...SEGMENT_CODES];
  return SEGMENT_CODES.filter((code) => {
    const s = SEGMENTS[code];
    const short = SEGMENT_SHORT[code];
    return [`${code} ${s.en}`, `${code} ${s.fr}`, short?.en ?? "", short?.fr ?? ""].some((line) => line && lineMatches(line, terms));
  });
}

const FIND_TITLE: Readonly<Record<FindKind | "", Key>> = {
  "": "dash.find_title", buyer: "dash.find_title_buyer", organization: "dash.find_title_organization", segment: "dash.find_title_segment",
};
const FIND_LABEL: Readonly<Record<FindKind | "", Key>> = { "": "dash.find_label", buyer: "col.buyer", organization: "col.organization", segment: "col.segment" };

// An organization's place, as /search writes it.
function placeOf(lang: Lang, o: OrgHit): string {
  const code = o.prov.toLowerCase();
  const where = code === "xx" || code === "un" ? directoryName(lang, code) : provinceName(lang, o.prov);
  return [o.city, where].filter(Boolean).join(", ");
}

// A match: its checklist (href), its name and its place or acronym, and, while the analytics builder is the reader's,
// the same subject's value by fiscal year in the builder (build), its other choice.
type Match = { href: string; name: string; note?: string; build?: string };
const MatchList: FC<{ lang: Lang; list: readonly Match[] }> = ({ lang, list }) => (
  <ul class="plain dash-matches">
    {list.map((m) => (
      <li>
        <a href={m.href}>{m.name}</a>{m.note ? <span class="muted small">{m.note}</span> : null}
        {m.build ? <a href={m.build} class="dash-pick">{t(lang, "build.open")}</a> : null}
      </li>
    ))}
  </ul>
);

export async function findPage(c: Context<AppEnv>, who: Account): Promise<Response> {
  const lang = c.get("lang");
  const want = boardField(c.req.query("board"));
  if (want === false) return toFirst(c);
  const kindAsked = c.req.query("kind") ?? "";
  const kind: FindKind | "" = isFindKind(kindAsked) ? kindAsked : "";
  const all = c.req.query("all") === "1";
  const q = (c.req.query("q") ?? "").trim().slice(0, MAX_Q);
  const terms = searchTerms(q);
  const rows = kind ? FIND_ROWS_ONE : FIND_ROWS;
  // The account's dashboards only: whether the one asked is its own, and its name. The search beside it.
  const [h, found] = await Promise.all([
    readBoard(c.env, who.userId, { board: want }).then((board) => ({ board })),
    terms.terms.length && kind !== "segment" ? runSearch(c.env, terms, 1) : Promise.resolve(null),
  ]);
  const board = boardFor(lang, h, want);
  if (!board.found) return toFirst(c);
  const extra = { board: board.id, all: all ? "1" : null };
  // Each match's own view in the analytics builder (builder.ts buildLink): its value by fiscal year over the latest
  // DEFAULT_YEARS, at the source its checklist opens on; only while the builder is the reader's.
  const current = buildsOn(c.env, who.plan) ? await loadStats(c.env).then((s) => (s?.data_as_of ? fiscalYearOf(todayOf(s.data_as_of)) : null)).catch(() => null) : null;
  const build = (subject: Parameters<typeof buildLink>[0], source: MoneySource): { build?: string } =>
    current === null ? {} : { build: buildLink(subject, source, Math.max(EARLIEST_FY, current - DEFAULT_YEARS + 1), current) };
  const searched = terms.terms.length > 0 && kind !== "segment";
  const buyers = kind === "" || kind === "buyer" ? found?.buyers ?? [] : [];
  const orgs = kind === "" || kind === "organization" ? found?.orgs ?? [] : [];
  const segments = kind === "segment" ? segmentMatches(terms.terms) : kind === "" && terms.terms.length ? segmentMatches(terms.terms) : [];
  const total = (r: SearchResult | null, k: "buyerTotal" | "orgTotal") => r?.[k] ?? 0;
  // Each kind's matches, and where the rest of them are: the search page for buyers and organizations, this page of
  // segments alone for the segments.
  const groups: { title: string; list: Match[]; total: number; more: string }[] = [];
  if (buyers.length) {
    groups.push({
      title: t(lang, "nav.buyers"), total: total(found, "buyerTotal"), more: searchPath(q),
      list: buyers.slice(0, rows).map((b) => ({
        href: tablesHref("buyers", b.id, { source: largestSource(b), years: String(DEFAULT_YEARS), ...extra }),
        name: pick(lang, b.name, b.name_fr) ?? b.name, note: pick(lang, b.acronym_en, b.acronym_fr) ?? undefined,
        ...build({ buyer: b.id }, largestSource(b)),
      })),
    });
  }
  if (orgs.length) {
    groups.push({
      title: t(lang, "nav.organizations"), total: total(found, "orgTotal"), more: searchPath(q),
      list: orgs.slice(0, rows).map((o) => ({
        href: tablesHref("organizations", o.id, { source: largestSource(o), years: String(DEFAULT_YEARS), ...extra }), name: o.name, note: placeOf(lang, o),
        ...build({ org: o.id }, largestSource(o)),
      })),
    });
  }
  if (segments.length) {
    const shown = kind === "segment" ? segments : segments.slice(0, rows);
    groups.push({
      title: t(lang, "nav.segments"), total: segments.length,
      more: `${FIND_PATH}?${new URLSearchParams({ q, kind: "segment", ...(board.id ? { board: board.id } : {}), ...(all ? { all: "1" } : {}) }).toString()}`,
      list: shown.map((code) => ({
        href: tablesHref("segments", code, { source: "awards", years: String(DEFAULT_YEARS), ...extra }), name: `${code} ${segmentLabel(lang, code)}`,
        ...build({ segment: code }, "awards"),
      })),
    });
  }
  const line = !terms.terms.length && kind !== "segment" ? t(lang, "dash.find_empty")
    : searched && found === null ? t(lang, "dash.find_unavailable")
    : !groups.length ? t(lang, "dash.find_none", { q })
    : null;
  const here = boardPath(board.id, !board.id || h.board?.boards[0]?.id === board.id);
  return dashPage(c, (
    <>
      <PageHead lang={lang} title={t(lang, FIND_TITLE[kind])} lead={t(lang, "dash.find_lead", { name: board.label })}
        actions={<a href={here} class="btn">{t(lang, "dash.back")}</a>} />
      <form method="get" action={FIND_PATH} class="toolbar dash-find-page" role="search">
        {board.id ? <input type="hidden" name="board" value={board.id} /> : null}
        {kind ? <input type="hidden" name="kind" value={kind} /> : null}
        {all ? <input type="hidden" name="all" value="1" /> : null}
        <div class="toolbar-fields">
          <label class="field field-text">
            <span class="field-label">{t(lang, FIND_LABEL[kind])}</span>
            <input type="search" name="q" value={q} maxlength={MAX_Q} autocomplete="off" />
          </label>
          <div class="toolbar-actions">
            <button type="submit" class="btn btn-primary">{t(lang, "dash.find")}</button>
          </div>
        </div>
      </form>
      {line ? <p class="muted dash-find-line" role="status">{line}</p> : null}
      {groups.map((g) => (
        <Panel title={g.title} count={g.list.length < g.total ? t(lang, "dash.shown", { n: fmtInt(g.list.length, lang), total: fmtInt(g.total, lang) }) : fmtInt(g.total, lang)}
          foot={g.list.length < g.total ? <a href={g.more}>{t(lang, "dash.find_all_kind")}</a> : undefined}>
          <MatchList lang={lang} list={g.list} />
        </Panel>
      ))}
    </>
  ), FIND_PATH);
}

// -- the checklist -------------------------------------------------------------------------------

// The checklist's view from its address, read as the view reads its own
// (view_address.ts viewFrame) for the reader's plan, so the period is held to
// the plan's years: the source; the period, the latest years (years) or a
// first and last fiscal year (period=span, or from and to with no period, as
// a view's own address writes them); an organization's segment and the
// organizations it compares. null for an id the view does not serve.
export type Checklist = { view: View; base: ViewBase; id: string; frame: Frame; more: More; segment: number | null; rivals: string[] };
export function checklistOf(base: ViewBase, id: string, url: URL, current: number, most: number): Checklist | null {
  const v = viewOf(viewBase(VIEW_OF_BASE[base], id));
  if (!v) return null;
  const q = url.searchParams;
  const span = q.get("period") === "span" || (q.get("period") !== "latest" && (q.has("from") || q.has("to")));
  const p = new URLSearchParams();
  const source = q.get("source");
  if (source !== null) p.set("source", source);
  if (span) {
    p.set("from", q.get("from") ?? "");
    p.set("to", q.get("to") ?? "");
  } else if (q.get("years") !== null) {
    p.set("years", q.get("years")!);
  }
  if (v.kind === "organization") {
    for (const k of ["segment", "vs"]) for (const one of q.getAll(k)) p.append(k, one);
  }
  const read = new URL(`${viewBase(v.kind, v.id)}?${p.toString()}`, "https://view.invalid");
  const frame = viewFrame(v.kind, read, current, most);
  if (frame.first < EARLIEST_FY) return null;
  const segment = v.kind === "organization" ? shareSegmentOf(read) : null;
  const rivals = v.kind === "organization" ? rivalsOf(read, v.id) : [];
  return { view: v.kind, base, id: v.id, frame, more: v.kind === "organization" ? orgMore(segment, rivals) : {}, segment, rivals };
}

// Why a table does not apply at a source: the analytics page's own line where its panel draws none.
const GAP_KEY = (table: string): Key => (table === "competition" ? "analytics.no_competition" : table === "growth" ? "analytics.no_growth" : "analytics.no_segments");

// A table of the checklist: its ref at the shown source and period (the share
// table's at the segment chosen), whether it applies there, and whether the
// dashboard holds it already.
type Item = { table: string; ok: boolean; why: string | null; there: boolean };

// The subject's name and, for an organization at a source with segments, its
// largest segments in the period (ORG_SEGMENTS_SQL, the share table's
// choice): one records batch; a segment reads none. Read as null when the
// records database cannot answer, the page then naming the subject by its id.
async function readSubject(c: Context<AppEnv>, lang: Lang, k: Checklist): Promise<{ name: string; segments: number[] | null }> {
  if (k.view === "segment") return { name: `${k.id} ${segmentLabel(lang, k.id)}`, segments: null };
  // The organization's number in the records (checklistOf held its id to one).
  const oid = orgNumber(k.id) ?? -1;
  const segmentSource = SEGMENT_SOURCES.includes(k.frame.source);
  const queries: Query[] = k.view === "buyer" ? [{ sql: BUYER_NAME_SQL, params: [k.id] }]
    : [{ sql: ORG_NAME_SQL, params: [oid] }, ...(segmentSource ? [{ sql: ORG_SEGMENTS_SQL, params: [oid, SOURCE_NUMBER[k.frame.source], k.frame.first, k.frame.last] }] : [])];
  const read = await readRecords(c.env, queries).catch(() => null);
  if (read?.state !== "ready") return { name: k.id, segments: null };
  const row: Row | undefined = read.rows[0]?.[0];
  const name = k.view === "buyer" ? pick(lang, (row?.name_en as string | null) ?? null, (row?.name_fr as string | null) ?? null) ?? k.id
    : typeof row?.name === "string" && row.name ? row.name : k.id;
  const segments = segmentSource ? (read.rows[1] ?? []).map((r) => num(r.sid)).filter((x): x is number => x !== null) : [];
  return { name, segments };
}

// A table's ref at a checklist's frame, as its panel on the view would post it (analyticPanelRef), the share table's
// at a segment; null where the ref check refuses it (the share table without a segment).
function tableRef(k: Checklist, table: string, segment: number | null): string | null {
  const more: More = table === "share" ? orgMore(segment, k.rivals) : {};
  const a = analyticRef(analyticPanelRef(viewBase(k.view, k.id), k.frame, table, more));
  return a ? analyticAddress(a) : null;
}

// The analytics tables the dashboard shown holds already, by ref.
const heldRefs = (list: readonly Pick<Shown, "kind" | "ref">[]): Set<string> => new Set(list.filter((s) => s.kind === "analytic").map((s) => s.ref));

export async function tablesPage(c: Context<AppEnv>, who: Account, base: ViewBase, id: string): Promise<Response> {
  const lang = c.get("lang");
  const url = new URL(c.req.url);
  const want = boardField(url.searchParams.get("board") ?? undefined);
  if (want === false) return toFirst(c);
  const stats = await loadStats(c.env).catch(() => null);
  const current = fiscalYearOf(todayOf(stats?.data_as_of));
  const most = planYears(who.plan);
  const k = checklistOf(base, id, url, current, most);
  if (!k) return c.notFound();
  const [h, subject] = await Promise.all([readHoldings(c.env, who.userId, { board: want }), readSubject(c, lang, k)]);
  const board = boardFor(lang, h, want);
  if (!board.found) return toFirst(c);
  const { list, keeping } = shownTiles(h);
  const held = heldRefs(list);
  const cap = tileCap(who.plan);
  const all = url.searchParams.get("all") === "1";
  // The share table's choice of segment: the one the address names, then the organization's largest.
  const choices = [...new Set([...(k.segment !== null ? [k.segment] : []), ...(subject.segments ?? [])])];
  const segment = k.segment ?? choices[0] ?? null;
  const items: Item[] = VIEW_TABLES[k.view].map((table): Item => {
    if (!tableApplies(k.view, table, k.frame.source)) return { table, ok: false, why: t(lang, GAP_KEY(table)), there: false };
    if (table === "share" && segment === null) {
      return { table, ok: false, why: t(lang, subject.segments === null ? "dash.tables_unread" : "dash.tables_no_share"), there: false };
    }
    const ref = tableRef(k, table, table === "share" ? segment : null);
    return { table, ok: ref !== null, why: null, there: ref !== null && held.has(ref) };
  });
  const full = list.length >= cap;
  const path = tablesHref(base, k.id);
  const here = boardPath(board.id, !board.id || h.board?.boards[0]?.id === board.id);
  const notice = url.searchParams.get("m") === "none" ? t(lang, "dash.tables_pick") : null;
  const boards = h.board?.boards.length ? boardLabels(lang, h.board.boards) : null;
  const years: number[] = [];
  for (let y = current; y >= EARLIEST_FY; y--) years.push(y);
  const yearSelect = (name: "from" | "to", chosen: number) => (
    <select name={name}>{years.map((y) => <option value={String(y)} selected={y === chosen}>{fiscalLabel(lang, y)}</option>)}</select>
  );
  const f = k.frame;
  return dashPage(c, (
    <>
      <PageHead lang={lang} eyebrow={t(lang, "dash.tables_eyebrow")} title={subject.name} lead={t(lang, "dash.tables_lead", { name: board.label })}
        actions={<a href={here} class="btn">{t(lang, "dash.back")}</a>}>
        <p class="page-note">{t(lang, "analytics.lead", { source: sourceLabel(lang, f.source), first: fiscalLabel(lang, f.first), last: fiscalLabel(lang, f.last) })}</p>
      </PageHead>
      {notice ? <p class="account-notice" role="status">{notice}</p> : null}
      <form method="get" action={path} class="toolbar dash-frame" aria-label={t(lang, "dash.tables_choose")}>
        {all ? <input type="hidden" name="all" value="1" /> : null}
        {k.view === "organization" && k.segment !== null ? <input type="hidden" name="segment" value={segmentCode(k.segment)} /> : null}
        {k.rivals.map((r) => <input type="hidden" name="vs" value={r} />)}
        <div class="toolbar-fields">
          {boards && h.board && h.board.boards.length > 1 ? (
            <label class="field">
              <span class="field-label">{t(lang, "dash.tables_board")}</span>
              <select name="board">
                {h.board.boards.map((b, i) => <option value={i === 0 ? "" : b.id} selected={b.id === (board.id ?? h.board!.boards[0].id)}>{boards.get(b.id) ?? ""}</option>)}
              </select>
            </label>
          ) : board.id ? <input type="hidden" name="board" value={board.id} /> : null}
          <label class="field">
            <span class="field-label">{t(lang, "common.source")}</span>
            <select name="source">
              {(k.view === "segment" ? SEGMENT_SOURCES : MONEY_SOURCES).map((s) => <option value={s} selected={s === f.source}>{sourceLabel(lang, s)}</option>)}
            </select>
          </label>
        </div>
        <fieldset class="toolbar-row dash-period">
          <legend class="toolbar-label">{t(lang, "analytics.period_nav")}</legend>
          <span class="dash-period-pick">
            <label class="check"><input type="radio" name="period" value="latest" checked={!f.custom || undefined} /><span>{t(lang, "dash.period_latest")}</span></label>
            <select name="years" aria-label={t(lang, "dash.period_latest")}>
              {PERIODS.filter((n) => n <= most).map((n) => <option value={String(n)} selected={n === (f.custom ? DEFAULT_YEARS : f.years)}>{t(lang, "analytics.period", { n })}</option>)}
            </select>
          </span>
          <span class="dash-period-pick">
            <label class="check"><input type="radio" name="period" value="span" checked={f.custom || undefined} /><span>{t(lang, "dash.period_span")}</span></label>
            <label class="dash-year"><span>{t(lang, "analytics.period_from")}</span>{yearSelect("from", f.first)}</label>
            <label class="dash-year"><span>{t(lang, "analytics.period_to")}</span>{yearSelect("to", f.last)}</label>
          </span>
          <div class="toolbar-actions">
            <button type="submit" class="btn">{t(lang, "dash.tables_show")}</button>
          </div>
        </fieldset>
      </form>
      <Panel title={t(lang, "dash.tables_legend")} id="dash-tables-head"
        count={t(lang, "dash.tables_count", { name: board.label, n: fmtInt(list.length, lang), cap: fmtInt(cap, lang) })}>
        <form method="post" action={path} class="dash-checklist">
          <Csrf account={who} />
          <input type="hidden" name="lang" value={lang} />
          {board.id ? <input type="hidden" name="board" value={board.id} /> : null}
          <input type="hidden" name="source" value={f.source} />
          {f.custom ? <>
            <input type="hidden" name="from" value={String(f.first)} />
            <input type="hidden" name="to" value={String(f.last)} />
          </> : <input type="hidden" name="years" value={String(f.years)} />}
          {k.rivals.map((r) => <input type="hidden" name="vs" value={r} />)}
          <ul class="plain dash-checks" aria-labelledby="dash-tables-head">
            {items.map((x) => (
              <li class={x.ok ? undefined : "is-off"}>
                <label class="check">
                  <input type="checkbox" name="table" value={x.table} checked={(all && x.ok && !x.there) || undefined} disabled={!x.ok || undefined} />
                  <span>{t(lang, TABLE_TITLES[k.view][x.table])}</span>
                </label>
                {x.table === "share" && x.ok && choices.length ? (
                  <label class="dash-check-field">
                    <span class="field-label">{t(lang, "col.segment")}</span>
                    <select name="segment">
                      {choices.map((sid) => <option value={segmentCode(sid)} selected={sid === segment}>{`${segmentCode(sid)} ${segmentLabel(lang, segmentCode(sid))}`}</option>)}
                    </select>
                  </label>
                ) : null}
                {x.there ? <span class="muted small dash-check-note">{t(lang, "dash.tables_here")}</span> : null}
                {x.why ? <span class="muted small dash-check-note">{x.why}</span> : null}
              </li>
            ))}
          </ul>
          {full ? <p>{t(lang, "dash.full", { cap: fmtInt(cap, lang) })}</p>
            : keeping === "none" ? <p class="muted">{t(lang, "dash.unsaved")}</p> : null}
          <button type="submit" class="btn btn-primary" disabled={full || keeping === "none" || undefined}>{t(lang, "dash.add_here")}</button>
        </form>
      </Panel>
    </>
  ), path);
}

// -- the checklist's post ------------------------------------------------------------------------

// The address a post names, in its parameters as posted (source, then years,
// or from and to; an organization's segment and organizations), for the ref
// check to read as it reads Add to dashboard's: nothing normalized first, so a
// value the check refuses is refused.
function postedAddress(base: ViewBase, id: string, fields: Record<string, string>, values: Record<string, string[]>): string {
  const p = new URLSearchParams();
  p.set("source", fields.source ?? "");
  if (fields.from !== undefined || fields.to !== undefined) {
    p.set("from", fields.from ?? "");
    p.set("to", fields.to ?? "");
  } else {
    p.set("years", fields.years ?? "");
  }
  if (base === "organizations" && fields.segment !== undefined) {
    p.set("segment", fields.segment);
    for (const r of values.vs ?? []) p.append("vs", r);
  }
  return `/${base}/${id}/analytics?${p.toString()}`;
}

// Where a post returns: a dashboard (at), with what happened and its counts
// (the checklist's: how many of the tables asked were added, and why the rest
// were not; a starter's: how many tiles), at a tile (place), in the page's
// language.
function backWith(c: Context<AppEnv>, at: string, params: Readonly<Record<string, string | number>>, place: string | null): Response {
  const parts = [...Object.entries(params).map(([k, v]) => `${k}=${v}`), ...(c.get("lang") === "fr" ? ["lang=fr"] : [])];
  return c.redirect(`${at}?${parts.join("&")}${place ? `#tile-${place}` : ""}`, 303);
}
const tablesBack = (c: Context<AppEnv>, at: string, q: TablesCount, place: string | null) => backWith(c, at, { m: "tables", ...q }, place);

// Add to dashboard on the checklist: every table checked (table, sent once a
// table), in the checklist's order, each an analytics tile at the source and
// period posted, to the dashboard board names (none: the first). Each is
// checked as Add to dashboard's ref is and must apply at the source, or the
// post is refused, 400, nothing added. The ones the dashboard holds already
// are counted and skipped; of the rest, as many as its figure leaves room for
// go in, in one batch, each insert holding the figure and the same item once
// (another post at once cannot pass either); the others are counted. The
// layout as the add does it, per state of storage: the grid's tables there
// (the computed first written first, writeFirst), laid out under the others
// two to a row; absent, into the panels, half the row each (the starting
// layout written first, as an add writes it); neither, nothing kept.
export async function tablesPost(
  c: Context<AppEnv>, who: Account, base: ViewBase, id: string, fields: Record<string, string>, values: Record<string, string[]>,
): Promise<Response> {
  if (!holdsDashboard(who.plan)) return c.redirect(DASHBOARD_PATH, 303);
  const lang = c.get("lang");
  const want = boardField(fields.board);
  if (want === false) return c.text(t(lang, "form.rejected"), 400);
  const view = VIEW_OF_BASE[base];
  const asked = values.table ?? [];
  const tables = (VIEW_TABLES[view] as readonly string[]).filter((x) => asked.includes(x));
  if (asked.some((x) => !tables.includes(x))) return c.text(t(lang, "form.rejected"), 400);
  const address = postedAddress(base, id, fields, values);
  const refs = tables.map((table) => ({ table, a: analyticRef(`${address}#table-${table}`) }));
  if (refs.some((r) => !r.a || !tableApplies(view, r.table, r.a.v.source))) return c.text(t(lang, "form.rejected"), 400);
  if (!refs.length) {
    // Nothing checked: the checklist again, at the same view and dashboard, saying so.
    const a = analyticRef(`${address}#table-${VIEW_TABLES[view][0]}`);
    if (!a) return c.text(t(lang, "form.rejected"), 400);
    const q = new URL(analyticAddress(a), "https://view.invalid").searchParams;
    if (want) q.set("board", want);
    q.set("m", "none");
    if (lang === "fr") q.set("lang", "fr");
    return c.redirect(`${tablesHref(base, id)}?${q.toString()}`, 303);
  }
  const specs: Spec[] = refs.map((r) => ({ kind: "analytic", ref: analyticAddress(r.a!), wide: false }));
  const h = await readHoldings(c.env, who.userId, { board: want });
  // A dashboard deleted meanwhile, or another account's: the first, with nothing added.
  if (want && h.board && !h.board.found) return back(c);
  const { list, keeping } = shownTiles(h);
  if (keeping === "none") return back(c, "unsaved");
  const cap = tileCap(who.plan);
  const db = c.env.ACCOUNTS!;
  const now = new Date();
  const has = (rows: readonly Pick<PanelRow, "kind" | "ref">[], s: Spec) => rows.some((r) => r.kind === s.kind && r.ref === s.ref);
  if (keeping === "panels") {
    if (!h.panels!.length && !h.emptied) await writeStarter(c.env, who, startingLayout(h), now);
    const rows = (await listPanels(c.env, who.userId)) ?? [];
    const fresh = specs.filter((s) => !has(rows, s));
    const fit = fresh.slice(0, Math.max(0, cap - rows.length));
    const done = fit.length ? await db.batch(fit.map((s, i) => db.prepare(ADD_PANEL_SQL)
      .bind(newId(), who.userId, s.kind, s.ref, 0, new Date(now.getTime() + i).toISOString(), cap, BRIEFING_PANELS_MAX))) : [];
    const added = fit.filter((_, i) => (done[i]?.meta?.changes ?? 0) === 1);
    const after = (await listPanels(c.env, who.userId)) ?? [];
    // Refused inside the insert: the same item meanwhile (there), or the figure reached (full).
    const there = specs.length - fresh.length + fit.filter((s) => !added.includes(s) && has(after, s)).length;
    const first = added[0] ?? specs.find((s) => has(after, s));
    const place = first ? after.find((r) => r.kind === first.kind && r.ref === first.ref)?.id ?? null : null;
    return tablesBack(c, DASHBOARD_PATH, { n: added.length, of: specs.length, there, full: specs.length - added.length - there }, place);
  }
  // An account in a group whose subscription's dashboards are all in use has none to write (dashboard.tsx writeFirst).
  if (keeping === "first" && !(await writeFirst(c.env, who, list, now))) return back(c, "boards_full");
  const board = (await readBoard(c.env, who.userId, { board: want }))!;
  const at = hereOf({ board });
  const fresh = specs.filter((s) => !has(board.tiles, s));
  const fit = fresh.slice(0, Math.max(0, cap - board.tiles.length));
  const news: Tile[] = fit.map((s) => {
    const key = sizeKey(s.kind, s.ref);
    return { id: newId(), kind: key, x: 0, y: 0, ...startSize(key, false) };
  });
  const laid = placeAll(shownTiles({ ...h, board }).list.map(asTile), news);
  const time = now.toISOString();
  const done = news.length ? await db.batch(news.map((n, i) => {
    const p = laid.find((x) => x.id === n.id)!;
    return db.prepare(ADD_TILE_SQL).bind(n.id, who.userId, fit[i].kind, fit[i].ref, p.x, p.y, p.w, p.h, time, cap, BRIEFING_PANELS_MAX, board.id);
  })) : [];
  const added = news.filter((_, i) => (done[i]?.meta?.changes ?? 0) === 1);
  // Refused inside the insert: the same item meanwhile (there), or the figure reached (full).
  const lost = fit.filter((_, i) => (done[i]?.meta?.changes ?? 0) !== 1);
  const again = lost.length ? (await readBoard(c.env, who.userId, { board: board.id }))!.tiles : board.tiles;
  const there = specs.length - fresh.length + lost.filter((s) => has(again, s)).length;
  // At the first table added, else the first the dashboard holds already.
  const place = added[0]?.id ?? again.find((r) => specs.some((s) => s.kind === r.kind && s.ref === r.ref))?.id ?? null;
  return tablesBack(c, at, { n: added.length, of: specs.length, there, full: specs.length - added.length - there }, place);
}

// -- the starters ----------------------------------------------------------------------------------

// A starter's tiles into an empty dashboard, the same insert with one more
// condition: the dashboard holds no tile but this batch's own (each bound to
// the batch's one time, ?9), so a starter never adds to a dashboard that held
// a tile when it began, another post's at the same moment included.
export const STARTER_TILE_SQL = ADD_TILE_SQL.replace(
  " ON CONFLICT DO NOTHING",
  " AND NOT EXISTS (SELECT 1 FROM dashboard_tiles WHERE dashboard_id = d.id AND created_at <> ?9) ON CONFLICT DO NOTHING",
);
// The same into the panels while the grid's tables are absent: no panel of the account's but this batch's (?6).
export const STARTER_PANEL_SQL = ADD_PANEL_SQL.replace(
  " ON CONFLICT (user_id, kind, ref) DO NOTHING",
  ` AND NOT EXISTS (SELECT 1 FROM dashboard_panels WHERE user_id = ?2 AND kind <> '${LAYOUT_MARKER}' AND created_at <> ?6) ON CONFLICT (user_id, kind, ref) DO NOTHING`,
);

const isStarterPost = (v: unknown): v is Extract<Starter, "org" | "ending"> => v === "org" || v === "ending";

// A starter pressed on an empty dashboard (Start From in its Add a Tile):
// Your organization (its matching notices and its blocks; without a claim,
// to the page where one is named) or Contracts ending (the watches and the
// plan's windows), only kinds the account can hold (starterSpecs), laid out
// two to a row, in one batch within the figure. Refused on a dashboard that
// holds a tile, there (started_taken) and inside each insert. The account's
// first dashboard, computed while nothing is stored, keeps its starting
// layout: it holds tiles, so it is never filled from a starter.
export async function starterPost(c: Context<AppEnv>, who: Account, fields: Record<string, string>): Promise<Response> {
  if (!holdsDashboard(who.plan)) return c.redirect(DASHBOARD_PATH, 303);
  const lang = c.get("lang");
  const want = boardField(fields.board);
  if (want === false || !isStarterPost(fields.starter)) return c.text(t(lang, "form.rejected"), 400);
  const h = await readHoldings(c.env, who.userId, { board: want });
  if (want && h.board && !h.board.found) return back(c);
  const { list, keeping } = shownTiles(h);
  if (keeping === "none") return back(c, "unsaved");
  if (list.length) return back(c, "started_taken", ADD_ANCHOR, hereOf(h));
  if (fields.starter === "org" && !h.claim) return c.redirect(lang === "fr" ? "/account/organization?lang=fr" : "/account/organization", 303);
  const cap = tileCap(who.plan);
  const specs = starterSpecs(fields.starter, h, who.plan).slice(0, cap);
  if (!specs.length) return back(c, "", ADD_ANCHOR, hereOf(h));
  const db = c.env.ACCOUNTS!;
  const time = new Date().toISOString();
  if (keeping === "panels") {
    const done = await db.batch(specs.map((s) => db.prepare(STARTER_PANEL_SQL).bind(newId(), who.userId, s.kind, s.ref, 0, time, cap, BRIEFING_PANELS_MAX)));
    const added = specs.filter((_, i) => (done[i]?.meta?.changes ?? 0) === 1);
    if (!added.length) return back(c, "started_taken", ADD_ANCHOR);
    const rows = (await listPanels(c.env, who.userId)) ?? [];
    return backWith(c, DASHBOARD_PATH, { m: "started", n: added.length }, rows.find((r) => r.kind === added[0].kind && r.ref === added[0].ref)?.id ?? null);
  }
  if (keeping === "first" && !(await writeFirst(c.env, who, []))) return back(c, "boards_full");
  const board = (await readBoard(c.env, who.userId, { board: want }))!;
  const at = hereOf({ board });
  const news: Tile[] = specs.map((s) => {
    const key = sizeKey(s.kind, s.ref);
    return { id: newId(), kind: key, x: 0, y: 0, ...startSize(key, false) };
  });
  const laid = placeAll([], news);
  const done = await db.batch(news.map((n, i) => {
    const p = laid.find((x) => x.id === n.id)!;
    return db.prepare(STARTER_TILE_SQL).bind(n.id, who.userId, specs[i].kind, specs[i].ref, p.x, p.y, p.w, p.h, time, cap, BRIEFING_PANELS_MAX, board.id);
  }));
  const added = news.filter((_, i) => (done[i]?.meta?.changes ?? 0) === 1);
  if (!added.length) return back(c, "started_taken", ADD_ANCHOR, at);
  return backWith(c, at, { m: "started", n: added.length }, added[0].id);
}
