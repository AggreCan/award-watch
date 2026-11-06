// Calendar feeds: an address a calendar app subscribes to,
// /account/calendar/<feed id>.ics?t=<secret>, that lists dates the account
// follows as events (src/calendar.ts writes them). Part of Pro (the
// "delivery" feature: a feed is a delivery, as mail is). The kinds:
//
//   search     one saved tender search: every open notice that matches its
//              filter now, by closing date, read from tenders/open.json
//              through readTenderQuery and filterTenders, as the delivery
//              and /tenders read it
//   watchlist  the account's watchlist: the end dates of the contracts its
//              watches follow, and its followed notices' closings
//   all        every saved tender search and the watchlist in one feed
//
// The watchlist is another build's (src/account/watch*). Its events come in
// through WATCHLIST_EVENTS below, null until that build sets it: until then
// no watchlist feed can be made, and an "all" feed holds the saved tender
// searches alone.
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
// non-Pro account answers 404 at once. A file the feed reads that does not
// load (tenders/open.json) is a 503 too, never an empty calendar, which a
// client would read as every event cancelled.
//
// What is kept: the row, and last_read_day, the UTC date a calendar last read
// the feed (written at most once a day; no time, no address, no user agent).

import { closingPassed, type Clock } from "../closing";
import { type CalEvent, type MoreKind, UID_HOST, capped, noticeEvent, writeCalendar } from "../calendar";
import { loadOpenList, type TenderRow } from "../data";
import type { Env } from "../env";
import { t, type Lang } from "../i18n";
import { filterTenders, readTenderQuery } from "../pages/tenders";
import { isBlocked } from "./admin_ops";
import { type Plan, allowed, lastKnownPlan, planFor } from "./entitlements";
import { newId, randomHex, sameHash } from "./secrets";
import { OUTAGE_TRUST_MS } from "./session";

export const FEED_KINDS = ["search", "watchlist", "all"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];
// Feeds an account keeps at once (revoked rows aside): one per saved tender
// search up to that, the watchlist's and the "all" feed.
export const FEEDS_MAX = 5;
export const FEED_PATH = "/account/calendar";
export const FEED_ID_RE = /^[0-9a-f]{32}$/;
// The saved searches a feed can follow: the tender lists.
export const FEED_SEARCH_KIND = "tenders";

// The watchlist's events for a feed (kinds "watchlist" and "all"). The
// watchlist build sets this to its reader: the contracts ending within each
// watch's horizon (12 months at most) of each organization and buyer watch
// from rec_expiring, each followed contract's end and each followed notice's
// closing, built with contractEvent(expiringFacts(...)) and noticeEvent so
// the UIDs match the per-record files. It throws when it cannot read, and
// the feed answers 503.
export type WatchlistEvents = (env: Env, userId: string, lang: Lang, base: string, clock: Clock) => Promise<CalEvent[]>;
export const WATCHLIST_EVENTS: WatchlistEvents | null = null;

export const feedKindsOpen = (): readonly FeedKind[] => (WATCHLIST_EVENTS ? FEED_KINDS : ["search", "all"]);

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
  if (!feedKindsOpen().includes(kind)) return "missing";
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

// A new secret: the old address stops at once.
export async function rotateFeed(env: Env, userId: string, id: string): Promise<boolean> {
  lastKnown.delete(id);
  if (!FEED_ID_RE.test(id)) return false;
  const res = await env.ACCOUNTS!.prepare("UPDATE feeds SET secret = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(randomHex(16), id, userId).run();
  return (res.meta?.changes ?? 0) === 1;
}

export async function removeFeed(env: Env, userId: string, id: string, now = new Date()): Promise<boolean> {
  lastKnown.delete(id);
  if (!FEED_ID_RE.test(id)) return false;
  const res = await env.ACCOUNTS!.prepare("UPDATE feeds SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(now.toISOString(), id, userId).run();
  return (res.meta?.changes ?? 0) === 1;
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

// What a feed lists: its kind, the account, and the saved tender searches it
// reads (the one search, or all of the account's for "all").
export type FeedState = {
  id: string; userId: string; kind: FeedKind; searchId: string | null; searches: SearchRef[]; plan: Plan; stale: boolean;
};

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
    if (!allowed(plan, "delivery") || (await isBlocked(env, { id: row.user_id })) || (kind === "watchlist" && !WATCHLIST_EVENTS)) {
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
    known = {
      id, userId: row.user_id, kind, searchId: row.search_id, searches, plan: plan.plan, planUntil: plan.until, secret: row.secret,
      verifiedAt: now.getTime(),
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

// The events of a feed, before the cap: the notices of its saved tender
// searches (each once, whichever searches match it) and, for "watchlist" and
// "all", the watchlist's events.
export async function feedEvents(env: Env, feed: FeedState, ctx: Omit<FeedContext, "alarm" | "name">): Promise<CalEvent[]> {
  const events = new Map<string, CalEvent>();
  if (feed.searches.length) {
    const open = await loadOpenList(env);
    if (!open) throw new FeedFault("tenders/open.json could not be read");
    for (const s of feed.searches) {
      for (const r of searchMatches(open, s.params, ctx.clock)) {
        if (events.has(`notice:${r.reference}`)) continue;
        const e = noticeEvent(ctx.lang, r, ctx.base);
        if (e) events.set(`notice:${r.reference}`, e);
      }
    }
  }
  if (feed.kind !== "search" && WATCHLIST_EVENTS) {
    for (const e of await (WATCHLIST_EVENTS as WatchlistEvents)(env, feed.userId, ctx.lang, ctx.base, ctx.clock)) {
      if (!events.has(e.uid)) events.set(e.uid, e);
    }
  }
  return [...events.values()];
}

// The feed's file: its events, capped, under its name.
export async function feedCalendar(env: Env, feed: FeedState, ctx: FeedContext): Promise<string> {
  const all = await feedEvents(env, feed, ctx);
  const more: MoreKind = feed.kind === "search" || !WATCHLIST_EVENTS ? "closing" : feed.kind === "watchlist" ? "end" : "dates";
  const page = feed.kind === "search" && feed.searches[0] ? feed.searches[0].params : "/account/searches";
  const events = capped(ctx.lang, all, { uid: `more-${feed.id}@${UID_HOST}`, kind: more, dataDate: ctx.dataDate, url: `${ctx.base}${page}` });
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
