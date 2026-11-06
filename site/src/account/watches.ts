// Watches: the organizations, buyers, single records (an award notice, a PSPC
// history record, a published contract) and open tender notices an account
// follows (docs/accounts.md, Watches). The accounts database keeps each watch
// and the kinds of event it follows (accounts_schema.sql, watches), the
// account's watch mail (watch_mail) and its runs (watch_deliveries); the
// events themselves are the records database's (watch_events.ts).
//
// Any signed-in account keeps watches: 3 on Free, 25 on Pro (entitlements.ts
// watchlists), held to the cap inside the insert so two posts at once cannot
// pass it. Only Pro's are mailed (watch_mail). A label is the site's own,
// written from the data when the watch is added, never typed by the reader. A
// watch follows an id: when the nightly retires an organization or a buyer id
// into another (the aliases the profiles redirect through), followAliases
// points the watch at the surviving id, or merges it into the account's watch
// of that id.

import { loadAlias, loadBuyerAlias } from "../data";
import type { Env } from "../env";
import { watchCap, type Plan } from "./entitlements";
import { missingTable } from "./records_deliveries";
import { newId } from "./secrets";
import { type EventKind, KINDS_FOR, type WatchKind, isEventKind, isWatchKind } from "./watch_events";

export const CADENCES = ["daily", "weekly"] as const;
export type Cadence = (typeof CADENCES)[number];
export const isCadence = (v: unknown): v is Cadence => v === "daily" || v === "weekly";

export const LABEL_MAX = 300;
// The console's and the page's run rows, and how long they are kept.
export const WATCH_DELIVERY_ROWS = 20;
export const WATCH_DELIVERY_DAYS = 90;

export type Watch = {
  id: string; kind: WatchKind; target: string; segment: string; label: string; events: EventKind[]; cadence: Cadence; created_at: string;
  last_sent_day: string | null;
};

type WatchRow = Omit<Watch, "kind" | "events" | "cadence"> & { kind: string; events: string; cadence: string };

// The kinds a stored list names that the watch's kind can follow, in its order.
export function eventsOf(kind: WatchKind, text: string): EventKind[] {
  const named = new Set(text.split(",").map((s) => s.trim()).filter(isEventKind));
  return KINDS_FOR[kind].filter((k) => named.has(k));
}

const toWatch = (r: WatchRow): Watch | null =>
  isWatchKind(r.kind)
    ? { ...r, kind: r.kind, events: eventsOf(r.kind, r.events), cadence: r.cadence === "weekly" ? "weekly" : "daily" }
    : null;

export const LIST_SQL =
  "SELECT id, kind, target, segment, label, events, cadence, created_at, last_sent_day FROM watches WHERE user_id = ? " +
  "ORDER BY created_at, id LIMIT 25";

export async function listWatches(env: Env, userId: string): Promise<Watch[]> {
  const res = await env.ACCOUNTS!.prepare(LIST_SQL).bind(userId).all<WatchRow>();
  return (res.results ?? []).map(toWatch).filter((w): w is Watch => w !== null);
}

// One insert held to the plan's cap, and the account's watch mail row (on)
// made with its first watch. "exists" when the same page (and segment) is
// watched already. since is the data date when the watch is added: its events
// are reported from the next one on (last_sent_day starts there).
export async function addWatch(
  env: Env, who: { userId: string; plan: Plan }, w: { kind: WatchKind; target: string; segment: string; label: string },
  since: string | null, now = new Date(),
): Promise<"added" | "exists" | "cap"> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const [res] = await db.batch([
    db.prepare(
      "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) " +
      "SELECT ?1, ?2, ?3, ?4, ?10, ?5, ?6, 'daily', ?7, ?9 WHERE (SELECT COUNT(*) FROM watches WHERE user_id = ?2) < ?8 " +
      "ON CONFLICT (user_id, kind, target, segment) DO NOTHING",
    ).bind(newId(), who.userId, w.kind, w.target, w.label.slice(0, LABEL_MAX), KINDS_FOR[w.kind].join(","), at, watchCap(who.plan), since,
      w.segment),
    db.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'on', ?) ON CONFLICT (user_id) DO NOTHING").bind(who.userId, at),
  ]);
  if ((res.meta?.changes ?? 0) === 1) return "added";
  const same = await db.prepare("SELECT 1 AS x FROM watches WHERE user_id = ? AND kind = ? AND target = ? AND segment = ?")
    .bind(who.userId, w.kind, w.target, w.segment).first();
  return same ? "exists" : "cap";
}

export async function deleteWatch(env: Env, userId: string, id: string): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare("DELETE FROM watches WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return (res.meta?.changes ?? 0) === 1;
}

// The kinds followed (at least one, each one the watch's kind can follow) and the cadence.
export async function setWatch(env: Env, userId: string, id: string, events: readonly string[], cadence: Cadence): Promise<boolean> {
  const db = env.ACCOUNTS!;
  const row = await db.prepare("SELECT kind FROM watches WHERE id = ? AND user_id = ?").bind(id, userId).first<{ kind: string }>();
  if (!row || !isWatchKind(row.kind)) return false;
  const chosen = eventsOf(row.kind, events.join(","));
  if (!chosen.length) return false;
  const res = await db.prepare("UPDATE watches SET events = ?, cadence = ? WHERE id = ? AND user_id = ?")
    .bind(chosen.join(","), cadence, id, userId).run();
  return (res.meta?.changes ?? 0) === 1;
}

// A page's watch for the reader: the id of the account's watch of it (the
// whole buyer first), its segment, and how many the account holds.
export async function watchState(env: Env, userId: string, kind: WatchKind, target: string): Promise<{ id: string | null; segment: string; n: number }> {
  const row = await env.ACCOUNTS!.prepare(
    "SELECT (SELECT id FROM watches WHERE user_id = ?1 AND kind = ?2 AND target = ?3 ORDER BY segment, created_at LIMIT 1) AS id, " +
    "(SELECT segment FROM watches WHERE user_id = ?1 AND kind = ?2 AND target = ?3 ORDER BY segment, created_at LIMIT 1) AS segment, " +
    "(SELECT COUNT(*) FROM watches WHERE user_id = ?1) AS n",
  ).bind(userId, kind, target).first<{ id: string | null; segment: string | null; n: number }>();
  return { id: row?.id ?? null, segment: row?.segment ?? "", n: row?.n ?? 0 };
}

// -- merges --------------------------------------------------------------------------------

// Each organization or buyer watch whose id the nightly retired into another
// is pointed at the surviving id; when the account already follows that id
// (with the same segment), the retired one is deleted, merged into it. Returns
// the watches as they now stand, and how many moved and merged.
export async function followAliases(env: Env, userId: string, watches: readonly Watch[]): Promise<{ watches: Watch[]; moved: number; merged: number }> {
  const db = env.ACCOUNTS!;
  const out: Watch[] = [];
  let moved = 0;
  let merged = 0;
  const live = new Map<string, string | null>();
  for (const w of watches) {
    if (w.kind !== "organization" && w.kind !== "buyer") {
      out.push(w);
      continue;
    }
    const key = `${w.kind}\n${w.target}`;
    if (!live.has(key)) {
      const next = w.kind === "organization" ? await loadAlias(env, w.target).catch(() => null) : await loadBuyerAlias(env, w.target).catch(() => null);
      live.set(key, next);
    }
    const next = live.get(key);
    if (!next || next === w.target) {
      out.push(w);
      continue;
    }
    const res = await db.prepare(
      "UPDATE watches SET target = ?1 WHERE id = ?2 AND user_id = ?3 AND NOT EXISTS " +
      "(SELECT 1 FROM watches x WHERE x.user_id = ?3 AND x.kind = ?4 AND x.target = ?1 AND x.segment = ?5)",
    ).bind(next, w.id, userId, w.kind, w.segment).run();
    if ((res.meta?.changes ?? 0) === 1) {
      moved++;
      out.push({ ...w, target: next });
    } else {
      await db.prepare("DELETE FROM watches WHERE id = ? AND user_id = ?").bind(w.id, userId).run();
      merged++;
    }
  }
  return { watches: out, moved, merged };
}

// -- the watch mail ---------------------------------------------------------------------

export type MailRow = {
  mail: string; last_day: string | null; last_at: string | null; last_status: string | null; last_items: number | null;
};

export async function mailOf(env: Env, userId: string): Promise<MailRow | null> {
  return env.ACCOUNTS!.prepare("SELECT mail, last_day, last_at, last_status, last_items FROM watch_mail WHERE user_id = ?")
    .bind(userId).first<MailRow>();
}

export async function setMail(env: Env, userId: string, on: boolean, now = new Date()): Promise<void> {
  await env.ACCOUNTS!.prepare(
    "INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (user_id) DO UPDATE SET mail = excluded.mail",
  ).bind(userId, on ? "on" : "off", now.toISOString()).run();
}

// What deleting an account removes of its watches (routes.tsx deleteAccount):
// every watch, the watch mail row and its runs. A database without the
// tables yet holds none, so a missing table is no fault here.
export async function deleteWatchesOf(env: Env, userId: string): Promise<void> {
  const db = env.ACCOUNTS!;
  try {
    await db.batch([
      db.prepare("DELETE FROM watches WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM watch_deliveries WHERE user_id = ?").bind(userId),
      db.prepare("DELETE FROM watch_mail WHERE user_id = ?").bind(userId),
    ]);
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

// How many watches an account holds and whether its mail is on, for the
// overview; null when the tables are not there yet.
export async function watchCount(env: Env, userId: string): Promise<{ n: number; mail: string | null } | null> {
  try {
    const row = await env.ACCOUNTS!.prepare(
      "SELECT (SELECT COUNT(*) FROM watches WHERE user_id = ?1) AS n, (SELECT mail FROM watch_mail WHERE user_id = ?1) AS mail",
    ).bind(userId).first<{ n: number; mail: string | null }>();
    return { n: row?.n ?? 0, mail: row?.mail ?? null };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// -- the console -----------------------------------------------------------------------------

export type WatchDeliveryRow = { sent_at: string; day: string; items: number; status: string };

// One account's watches, mail and newest runs, for the console's user page; null before the tables exist.
export async function watchDetail(env: Env, userId: string): Promise<{ watches: Watch[]; mail: MailRow | null; runs: WatchDeliveryRow[] } | null> {
  try {
    const [watches, mail, runs] = await Promise.all([
      listWatches(env, userId), mailOf(env, userId),
      env.ACCOUNTS!.prepare("SELECT sent_at, day, items, status FROM watch_deliveries WHERE user_id = ? ORDER BY id DESC LIMIT ?")
        .bind(userId, WATCH_DELIVERY_ROWS).all<WatchDeliveryRow>(),
    ]);
    return { watches, mail, runs: runs.results ?? [] };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

export type WatchOverview = {
  byKind: { kind: string; n: number }[]; mailOn: number; week: { status: string; n: number }[];
};

// The console's overview: watches by kind, accounts with the mail on, and the
// runs of the last seven days by how they ended; null before the tables exist.
export async function watchOverview(env: Env, now = new Date()): Promise<WatchOverview | null> {
  const db = env.ACCOUNTS!;
  const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  try {
    const [kinds, mail, runs] = await db.batch([
      db.prepare("SELECT kind, COUNT(*) AS n FROM watches GROUP BY kind ORDER BY kind LIMIT 4"),
      db.prepare("SELECT COUNT(*) AS n FROM watch_mail WHERE mail = 'on' AND EXISTS (SELECT 1 FROM watches w WHERE w.user_id = watch_mail.user_id)"),
      db.prepare("SELECT status, COUNT(*) AS n FROM watch_deliveries WHERE sent_at >= ? GROUP BY status ORDER BY status LIMIT 3").bind(week),
    ]);
    return {
      byKind: (kinds.results ?? []) as { kind: string; n: number }[],
      mailOn: (mail.results?.[0] as { n: number } | undefined)?.n ?? 0,
      week: (runs.results ?? []) as { status: string; n: number }[],
    };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}
