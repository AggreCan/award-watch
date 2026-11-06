// Calendar feeds: an address a calendar app subscribes to,
// /account/calendar/<feed id>.ics?t=<secret>, that lists dates the account
// follows as events (src/calendar.ts writes them). Part of Pro (the
// "delivery" feature: a feed is a delivery, as mail is). The kinds:
//
//   search     one saved tender search: every open notice that matches its
//              filter now, by closing date, read from tenders/open.json
//              through readTenderQuery and filterTenders, as the delivery
//              and /tenders read it
//   watchlist  the account's watches (watches.ts): the end of each followed
//              contract whatever its date, the contracts each organization
//              and buyer watch holds that end within its horizon (the
//              radar's window, rec_expiring, read below), and each followed
//              open notice's closing
//   all        every saved tender search and the watches in one feed
//
// Every event is written by contractEvent or noticeEvent, so its UID and
// SEQUENCE are the one-event file's for the same record: an amendment that
// moves an end or a closing moves the event in a client that holds it from
// either.
//
// The secret is 16 random bytes in clear, as a stop link's is: the page shows
// the whole address, so it must be readable again. It is compared in
// constant time. Rotating writes a new one and the old address is the site's
// 404 on the next read; removing marks the row revoked, and the same.
// Deleting the search or the account deletes the row.
//
// Fail open to outages, closed to revocation, as sessions are: a feed this
// isolate verified within the hour is served from its last known state while
// the accounts database cannot be read (its plan held only to the plan's own
// end); any other read during an outage answers 503, which a calendar app
// retries without dropping what it holds. A feed the database says is
// revoked, rotated, removed, of a deleted search, a deleted, blocked or
// non-Pro account answers 404 at once. A file or a database the feed reads
// that does not answer (tenders/open.json, the records database) is a 503
// too, never an empty calendar, which a client would read as every event
// cancelled. The account's searches and watches are read with the feed's own
// row, so the outage case serves them as last read.
//
// What is kept: the row, and last_read_day, the UTC date a calendar last read
// the feed (written at most once a day; no time, no address, no user agent).

import { addDays } from "../../public/closing.js";
import { closingPassed, type Clock } from "../closing";
import {
  type CalEvent, FEED_EVENTS_MAX, type MoreKind, UID_HOST, capped, contractEvent, detailFacts, expiringFacts, noticeEvent, publishedFacts,
  writeCalendar,
} from "../calendar";
import { BUYER_ID_RE, loadContract, loadOpenList, type TenderRow } from "../data";
import type { Env } from "../env";
import { t, type Lang } from "../i18n";
import { WINDOW_DAYS, radarRow } from "../pages/expiring";
import { filterTenders, readTenderQuery } from "../pages/tenders";
import { type Query, type Row, num, orgNumber, readRecords } from "../records_db";
import { PUBLISHED_CONTRACT_SQL } from "../records_tables";
import { isBlocked } from "./admin_ops";
import { type Plan, allowed, lastKnownPlan, planFor } from "./entitlements";
import { newId, randomHex, sameHash } from "./secrets";
import { OUTAGE_TRUST_MS } from "./session";
import { TARGET_SLOTS } from "./watch_events";
import { type Watch, listWatches, survivorOf } from "./watches";

export const FEED_KINDS = ["search", "watchlist", "all"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];
// Feeds an account keeps at once (revoked rows aside): one per saved tender
// search up to that, the watchlist's and the "all" feed.
export const FEEDS_MAX = 5;
export const FEED_PATH = "/account/calendar";
export const FEED_ID_RE = /^[0-9a-f]{32}$/;
// The saved searches a feed can follow: the tender lists.
export const FEED_SEARCH_KIND = "tenders";
export const isFeedKind = (v: unknown): v is FeedKind => typeof v === "string" && (FEED_KINDS as readonly string[]).includes(v);

// -- the rows ---------------------------------------------------------------------------

export type FeedRow = {
  id: string; kind: FeedKind; search_id: string | null; secret: string; created_at: string; revoked_at: string | null;
  last_read_day: string | null;
};

const missingTable = (e: unknown) => /no such table/i.test(String((e as { message?: unknown })?.message ?? e));

// The account's live feeds, oldest first; null while the table is not on the
// database yet (the searches page then shows no feeds rather than failing).
export async function listFeeds(env: Env, userId: string): Promise<FeedRow[] | null> {
  try {
    const res = await env.ACCOUNTS!.prepare(
      "SELECT id, kind, search_id, secret, created_at, revoked_at, last_read_day FROM feeds " +
      "WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at, id",
    ).bind(userId).all<FeedRow>();
    return res.results ?? [];
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// One insert, held to the cap and to the account's own tender search inside
// the statement, so two posts at once pass neither; the partial unique index
// keeps one live feed per search and one of each other kind.
export async function createFeed(
  env: Env, userId: string, kind: FeedKind, searchId: string | null, now = new Date(),
): Promise<"added" | "exists" | "cap" | "missing"> {
  if (!isFeedKind(kind)) return "missing";
  const search = kind === "search" ? searchId : null;
  if (kind === "search" && !(search && FEED_ID_RE.test(search))) return "missing";
  const db = env.ACCOUNTS!;
  const res = await db.prepare(
    "INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 " +
    "WHERE (SELECT COUNT(*) FROM feeds WHERE user_id = ?2 AND revoked_at IS NULL) < ?7 " +
    "AND (?3 <> 'search' OR EXISTS (SELECT 1 FROM saved_searches WHERE id = ?4 AND user_id = ?2 AND kind = ?8)) " +
    "ON CONFLICT DO NOTHING",
  ).bind(newId(), userId, kind, search, randomHex(16), now.toISOString(), FEEDS_MAX, FEED_SEARCH_KIND).run();
  if ((res.meta?.changes ?? 0) === 1) return "added";
  const same = await db.prepare(
    "SELECT 1 AS x FROM feeds WHERE user_id = ? AND kind = ? AND COALESCE(search_id, '') = ? AND revoked_at IS NULL",
  ).bind(userId, kind, search ?? "").first();
  if (same) return "exists";
  if (kind === "search") {
    const owned = await db.prepare("SELECT 1 AS x FROM saved_searches WHERE id = ? AND user_id = ? AND kind = ?")
      .bind(search, userId, FEED_SEARCH_KIND).first();
    if (!owned) return "missing";
  }
  return "cap";
}

// A new secret: the old address stops at once. Each answers the feed's kind
// (the page it is shown on: the watches page for the watchlist's, the
// searches page for the others), or null when no live feed of the account's
// had that id.
export async function rotateFeed(env: Env, userId: string, id: string): Promise<FeedKind | null> {
  lastKnown.delete(id);
  if (!FEED_ID_RE.test(id)) return null;
  const row = await env.ACCOUNTS!.prepare("UPDATE feeds SET secret = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL RETURNING kind")
    .bind(randomHex(16), id, userId).first<{ kind: string }>();
  return row && isFeedKind(row.kind) ? row.kind : null;
}

export async function removeFeed(env: Env, userId: string, id: string, now = new Date()): Promise<FeedKind | null> {
  lastKnown.delete(id);
  if (!FEED_ID_RE.test(id)) return null;
  const row = await env.ACCOUNTS!.prepare("UPDATE feeds SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL RETURNING kind")
    .bind(now.toISOString(), id, userId).first<{ kind: string }>();
  return row && isFeedKind(row.kind) ? row.kind : null;
}

// The feeds of a search being deleted, or of an account being deleted. Run
// before the search's or the account's own batch; a database without the
// table yet has nothing to delete. Any other fault stops the deletion before
// anything else is removed.
export async function deleteFeeds(env: Env, who: { userId: string; searchId?: string }): Promise<void> {
  for (const [id, known] of lastKnown) {
    if (known.userId === who.userId && (who.searchId === undefined || known.searchId === who.searchId)) lastKnown.delete(id);
  }
  const db = env.ACCOUNTS!;
  try {
    if (who.searchId === undefined) await db.prepare("DELETE FROM feeds WHERE user_id = ?").bind(who.userId).run();
    else await db.prepare("DELETE FROM feeds WHERE user_id = ? AND search_id = ?").bind(who.userId, who.searchId).run();
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

// -- reading a feed -------------------------------------------------------------------------

// A saved search's label is in the language it was saved in.
export type SearchRef = { id: string; params: string; label: string; lang: string };

// A watch as a feed reads it: what it follows and the kinds of event it
// follows, which set an organization's or a buyer's horizon.
export type FeedWatch = Pick<Watch, "kind" | "target" | "segment" | "events">;

// What a feed lists: its kind, the account, the saved tender searches it
// reads (the one search, or all of the account's for "all") and the watches
// (for "watchlist" and "all").
export type FeedState = {
  id: string; userId: string; kind: FeedKind; searchId: string | null; searches: SearchRef[]; watches: FeedWatch[]; plan: Plan;
  stale: boolean;
};

// The account's watches for a feed; none while the table is not on the
// database yet.
export async function feedWatches(env: Env, userId: string): Promise<FeedWatch[]> {
  try {
    return (await listWatches(env, userId)).map(({ kind, target, segment, events }) => ({ kind, target, segment, events }));
  } catch (e) {
    if (missingTable(e)) return [];
    throw e;
  }
}

type Known = Omit<FeedState, "stale"> & { secret: string; planUntil: string | null; verifiedAt: number };

// What this isolate last read for each feed it served, for the outage case
// only. Bounded; the oldest entries go first.
const lastKnown = new Map<string, Known>();
const LAST_KNOWN_MAX = 500;

function remember(known: Known): void {
  lastKnown.delete(known.id);
  lastKnown.set(known.id, known);
  if (lastKnown.size > LAST_KNOWN_MAX) lastKnown.delete(lastKnown.keys().next().value as string);
}

// For tests: forget what this isolate has seen.
export function forgetFeeds(): void {
  lastKnown.clear();
}

export type FeedRead = { state: "ok"; feed: FeedState } | { state: "none" } | { state: "unavailable" };

type ReadRow = {
  id: string; user_id: string; kind: string; search_id: string | null; secret: string; revoked_at: string | null;
  last_read_day: string | null; status: string; plan: string; plan_until: string | null;
};

export async function readFeed(env: Env, id: string, secret: string, now = new Date()): Promise<FeedRead> {
  if (!FEED_ID_RE.test(id) || !FEED_ID_RE.test(secret)) return { state: "none" };
  const db = env.ACCOUNTS!;
  let known: Known;
  try {
    const row = await db.prepare(
      "SELECT f.id, f.user_id, f.kind, f.search_id, f.secret, f.revoked_at, f.last_read_day, u.status, u.plan, u.plan_until " +
      "FROM feeds f JOIN users u ON u.id = f.user_id WHERE f.id = ?",
    ).bind(id).first<ReadRow>();
    if (!row || !sameHash(row.secret, secret) || row.revoked_at || row.status !== "active" ||
      !(FEED_KINDS as readonly string[]).includes(row.kind)) {
      lastKnown.delete(id);
      return { state: "none" };
    }
    const kind = row.kind as FeedKind;
    const plan = await planFor(env, { id: row.user_id, plan: row.plan, plan_until: row.plan_until }, now);
    if (!allowed(plan, "delivery") || (await isBlocked(env, { id: row.user_id }))) {
      lastKnown.delete(id);
      return { state: "none" };
    }
    const searches = kind === "watchlist" ? [] : ((await db.prepare(
      "SELECT id, params, label, lang FROM saved_searches WHERE user_id = ? AND kind = ? AND (? = '' OR id = ?) ORDER BY created_at, id",
    ).bind(row.user_id, FEED_SEARCH_KIND, row.search_id ?? "", row.search_id ?? "").all<SearchRef>()).results ?? []);
    if (kind === "search" && !searches.length) {
      lastKnown.delete(id);
      return { state: "none" };
    }
    const watches = kind === "search" ? [] : await feedWatches(env, row.user_id);
    known = {
      id, userId: row.user_id, kind, searchId: row.search_id, searches, watches, plan: plan.plan, planUntil: plan.until,
      secret: row.secret, verifiedAt: now.getTime(),
    };
    remember(known);
    // The day a calendar last read it, once a UTC day at most; a write that
    // fails changes nothing about the answer.
    const today = now.toISOString().slice(0, 10);
    if (row.last_read_day !== today) {
      await db.prepare("UPDATE feeds SET last_read_day = ?1 WHERE id = ?2 AND (last_read_day IS NULL OR last_read_day < ?1)")
        .bind(today, id).run().catch(() => console.error("calendar feed: last read day not written"));
    }
  } catch {
    const held = lastKnown.get(id);
    if (held && sameHash(held.secret, secret) && now.getTime() - held.verifiedAt <= OUTAGE_TRUST_MS) {
      const plan = lastKnownPlan({ id: held.userId, plan: held.plan, plan_until: held.planUntil }, now);
      if (!allowed(plan, "delivery")) return { state: "none" };
      const { secret: _s, planUntil: _p, verifiedAt: _v, ...state } = held;
      return { state: "ok", feed: { ...state, plan: plan.plan, stale: true } };
    }
    console.error("calendar feed: database unreadable");
    return { state: "unavailable" };
  }
  const { secret: _s, planUntil: _p, verifiedAt: _v, ...state } = known;
  return { state: "ok", feed: { ...state, stale: false } };
}

// -- the events -----------------------------------------------------------------------------

// A saved search's address, read as the site reads it.
const READ_BASE = "https://awardwatch.ca";

// The open notices a saved tender search matches now, soonest closing first:
// filterTenders's answer without the ones whose closing has passed or that
// carry none.
export function searchMatches(rows: readonly TenderRow[], params: string, clock: Clock): TenderRow[] {
  const q = readTenderQuery(new URL(params, READ_BASE));
  return filterTenders(rows, q, clock).filter((r) => r.closing && !closingPassed(r.closing, clock));
}

export class FeedFault extends Error {}

export type FeedContext = { lang: Lang; base: string; clock: Clock; dataDate: string; alarm: boolean; name: string };
export type EventContext = Omit<FeedContext, "alarm" | "name">;

// What a feed lists before the cap: its events, and how many radar rows its
// watches matched past the ones read (watchEnds), every one later than them.
export type FeedEvents = { events: CalEvent[]; beyond: number };

// -- the watches' dates ---------------------------------------------------------------------

// How far ahead an organization or buyer watch reads the radar, in days: the
// 12-month window when it follows ends_12m, 6 months when it follows ends_6m
// alone, and nothing when it follows neither, since its reader chose no end
// dates for it.
export function horizonDays(events: readonly string[]): number {
  return events.includes("ends_12m") ? WINDOW_DAYS["12m"] : events.includes("ends_6m") ? WINDOW_DAYS["6m"] : 0;
}

// One slot per watch an account can hold (entitlements.ts WATCH_MAX).
export const ENDS_SLOTS = TARGET_SLOTS;

// The contracts an account's organization and buyer watches hold in the
// radar's window (rec_expiring), soonest end first: the rows ending from the
// data date (?1) to the furthest horizon (?2), through rec_expiring_end, so
// a read never passes the 12-month window's rows. Each watch has a slot of
// three: its target (an organization's number, or a buyer's id matched as the
// row's buyer or its client department, as the radar's and the incumbents'
// buyer filters read one), its segment mark (' 43 ', or '' for the whole
// buyer) and the last day of its horizon. typeof keeps a buyer's id made of
// digits from reading as an organization's number. An unused slot is bound to
// -1, '' and '', which match no row. A row two watches reach is one row; n
// counts every match before the LIMIT, so the feed's last event can say how
// many more there are.
const endsSlot = (i: number): string => {
  const t = 3 + 3 * i;
  return `(endd <= ?${t + 2} AND ((typeof(?${t}) <> 'text' AND oid = ?${t}) OR (typeof(?${t}) = 'text' AND (buyer = ?${t} OR client = ?${t}))) ` +
    `AND (?${t + 1} = '' OR instr(segs, ?${t + 1}) > 0))`;
};
export const WATCH_ENDS_SQL =
  "SELECT endd, j, COUNT(*) OVER () AS n FROM rec_expiring WHERE endd BETWEEN ?1 AND ?2 AND (" +
  `${Array.from({ length: ENDS_SLOTS }, (_, i) => endsSlot(i)).join(" OR ")}) ORDER BY endd, k LIMIT ${FEED_EVENTS_MAX}`;

export type EndsSlot = { target: number | string; mark: string; last: string };

export function endsBinds(first: string, slots: readonly EndsSlot[]): (string | number)[] {
  const last = slots.reduce((m, s) => (s.last > m ? s.last : m), first);
  const bound = Array.from({ length: ENDS_SLOTS }, (_, i) => slots[i]);
  return [first, last, ...bound.flatMap((s) => (s ? [s.target, s.mark, s.last] : [-1, "", ""]))];
}

// The watches' contract ends: each followed record's end whatever its date,
// read as its one-event file reads it (the detail file of an award notice or
// a history record, the rows of a published contract in the records
// database), then the radar rows each organization and buyer watch reaches,
// read by the id the nightly merged its own into when it retired one (the
// page or the next mail run writes the move; a feed only reads). A record the
// data no longer holds adds nothing. A records database that is not ready
// throws, and the feed answers 503.
export async function watchEnds(env: Env, watches: readonly FeedWatch[], ctx: EventContext): Promise<FeedEvents> {
  const records: { kind: "award" | "history"; reference: string }[] = [];
  const published: { dept: string; ref: string }[] = [];
  const subjects: (FeedWatch & { kind: "organization" | "buyer" })[] = [];
  for (const w of watches) {
    if (w.kind === "organization" || w.kind === "buyer") {
      if (horizonDays(w.events)) subjects.push({ ...w, kind: w.kind });
      continue;
    }
    if (w.kind !== "contract") continue;
    const [head, ...rest] = w.target.split(":");
    if (head === "award" || head === "history") records.push({ kind: head, reference: rest.join(":") });
    else if (head === "contract" && rest.length > 1) published.push({ dept: rest[0], ref: rest.slice(1).join(":") });
  }
  const ids = await Promise.all(subjects.map(async (w) => (await survivorOf(env, w.kind, w.target)) ?? w.target));
  const slots = new Map<string, EndsSlot>();
  subjects.forEach((w, i) => {
    const id = ids[i];
    const target = w.kind === "organization" ? orgNumber(id) : BUYER_ID_RE.test(id) ? id : null;
    if (target === null) return;
    // The same subject followed twice (a retired id and its survivor) reads once, to the longer horizon.
    const key = `${w.kind}\n${id}\n${w.segment}`;
    const last = addDays(ctx.dataDate, horizonDays(w.events));
    const held = slots.get(key);
    if (!held || held.last < last) slots.set(key, { target, mark: w.segment ? ` ${w.segment} ` : "", last });
  });
  const bound = [...slots.values()].slice(0, ENDS_SLOTS);
  const queries: Query[] = [
    ...(bound.length ? [{ sql: WATCH_ENDS_SQL, params: endsBinds(ctx.dataDate, bound) }] : []),
    ...published.map((p) => ({ sql: PUBLISHED_CONTRACT_SQL, params: [p.dept, p.ref] })),
  ];
  let rows: Row[][] = [];
  if (queries.length) {
    const read = await readRecords(env, queries);
    if (read.state !== "ready") throw new FeedFault(`the records database is ${read.state}`);
    rows = read.rows;
  }
  const events: CalEvent[] = [];
  const push = (e: CalEvent | null) => {
    if (e) events.push(e);
  };
  for (const d of await Promise.all(records.map((r) => loadContract(env, r.kind, r.reference)))) {
    const facts = d ? detailFacts(ctx.lang, d) : null;
    push(facts ? contractEvent(ctx.lang, facts, ctx.base) : null);
  }
  const first = bound.length ? 1 : 0;
  published.forEach((p, i) => {
    const facts = publishedFacts(ctx.lang, p.dept, p.ref, rows[first + i] ?? []);
    push(facts ? contractEvent(ctx.lang, facts, ctx.base) : null);
  });
  if (!bound.length) return { events, beyond: 0 };
  const ends = rows[0] ?? [];
  for (const r of ends) {
    const row = radarRow(r, ctx.dataDate);
    push(row ? contractEvent(ctx.lang, expiringFacts(ctx.lang, row), ctx.base) : null);
  }
  return { events, beyond: Math.max(0, (num(ends[0]?.n) ?? 0) - ends.length) };
}

// -- a feed's events --------------------------------------------------------------------------

// The events of a feed, before the cap, each once whichever searches or
// watches reach it: the notices of its saved tender searches and, for
// "watchlist" and "all", the watches' contract ends (a followed record's own
// first) and the closings of their followed notices.
export async function feedEvents(env: Env, feed: Pick<FeedState, "kind" | "searches" | "watches">, ctx: EventContext): Promise<FeedEvents> {
  const events = new Map<string, CalEvent>();
  const add = (e: CalEvent | null) => {
    if (e && !events.has(e.uid)) events.set(e.uid, e);
  };
  const watches = feed.kind === "search" ? [] : feed.watches;
  const notices = new Set(watches.filter((w) => w.kind === "tender").map((w) => w.target.slice(w.target.indexOf(":") + 1)));
  let open: TenderRow[] = [];
  if (feed.searches.length || notices.size) {
    const list = await loadOpenList(env);
    if (!list) throw new FeedFault("tenders/open.json could not be read");
    open = list;
  }
  for (const s of feed.searches) for (const r of searchMatches(open, s.params, ctx.clock)) add(noticeEvent(ctx.lang, r, ctx.base));
  const ends = watches.length ? await watchEnds(env, watches, ctx) : { events: [], beyond: 0 };
  for (const e of ends.events) add(e);
  // A followed notice leaves the open list when it closes or is cancelled,
  // and its event leaves the feed, as a search's does.
  for (const r of open) {
    if (notices.has(r.reference.toLowerCase()) && r.closing && !closingPassed(r.closing, ctx.clock)) add(noticeEvent(ctx.lang, r, ctx.base));
  }
  return { events: [...events.values()], beyond: ends.beyond };
}

// How many events a feed holds now, as its file counts them (the cap's last
// event among them), for the pages' rows; null when what it reads does not
// answer.
export async function feedSize(env: Env, feed: Pick<FeedState, "kind" | "searches" | "watches">, ctx: EventContext): Promise<number | null> {
  try {
    const { events, beyond } = await feedEvents(env, feed, ctx);
    return Math.min(events.length + beyond, FEED_EVENTS_MAX);
  } catch {
    return null;
  }
}

// The page a feed's events come from: the search's list, the watches page or the searches page.
export const feedPage = (feed: Pick<FeedState, "kind" | "searches">): string =>
  feed.kind === "search" && feed.searches[0] ? feed.searches[0].params : feed.kind === "watchlist" ? "/account/watches" : "/account/searches";

// The feed's file: its events, capped, under its name. The cap's last event
// names the dates the feed holds: closing dates, end dates, or both.
export async function feedCalendar(env: Env, feed: FeedState, ctx: FeedContext): Promise<string> {
  const { events: all, beyond } = await feedEvents(env, feed, ctx);
  const ends = beyond > 0 || all.some((e) => e.uid.startsWith("contract-"));
  const closings = all.some((e) => e.uid.startsWith("notice-"));
  const more: MoreKind = ends && closings ? "dates" : ends ? "end" : "closing";
  const events = capped(ctx.lang, all, {
    uid: `more-${feed.id}@${UID_HOST}`, kind: more, dataDate: ctx.dataDate, url: `${ctx.base}${feedPage(feed)}`, beyond,
  });
  return writeCalendar({ lang: ctx.lang, events, dataDate: ctx.dataDate, name: ctx.name, alarm: ctx.alarm });
}

// The feed's name in a calendar app: "Award Watch · <the search's label>",
// or the kind's name.
export function feedName(lang: Lang, feed: Pick<FeedState, "kind" | "searches">, label?: string): string {
  const what = feed.kind === "search"
    ? label ?? feed.searches[0]?.label ?? ""
    : t(lang, feed.kind === "watchlist" ? "calfeed.kind_watchlist" : "calfeed.kind_all");
  return `${t(lang, "site.name")} · ${what}`;
}

// The address a calendar app subscribes to.
export function feedAddress(base: string, row: Pick<FeedRow, "id" | "secret">, lang: Lang): string {
  return `${base}${FEED_PATH}/${row.id}.ics?t=${row.secret}${lang === "fr" ? "&lang=fr" : ""}`;
}

// -- the console ----------------------------------------------------------------------------

export type FeedCounts = { byKind: { kind: string; n: number }[]; readWeek: number };

// Live feeds by kind, and feeds read in the last 7 days; null while the
// table is not on the database.
export async function feedCounts(env: Env, now = new Date()): Promise<FeedCounts | null> {
  const db = env.ACCOUNTS!;
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  try {
    const [kinds, read] = await db.batch([
      db.prepare("SELECT kind, COUNT(*) AS n FROM feeds WHERE revoked_at IS NULL GROUP BY kind ORDER BY kind"),
      db.prepare("SELECT COUNT(*) AS n FROM feeds WHERE revoked_at IS NULL AND last_read_day >= ?").bind(since),
    ]);
    return {
      byKind: (kinds.results ?? []) as { kind: string; n: number }[],
      readWeek: ((read.results?.[0] ?? {}) as { n?: number }).n ?? 0,
    };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

export type FeedView = Omit<FeedRow, "secret">;

// One account's feeds for the console, revoked ones too, never the secret.
export async function userFeeds(env: Env, userId: string): Promise<FeedView[] | null> {
  try {
    const res = await env.ACCOUNTS!.prepare(
      "SELECT id, kind, search_id, created_at, revoked_at, last_read_day FROM feeds WHERE user_id = ? ORDER BY created_at DESC, id LIMIT 50",
    ).bind(userId).all<FeedView>();
    return res.results ?? [];
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}
