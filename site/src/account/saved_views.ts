// Saved analytics views (docs/accounts.md, Saved views): a buyer's, an
// organization's or a segment's view (pages/analytics.tsx) kept on an account
// with its source, its period and its choices, under a name the reader may
// type. The accounts database keeps each view (accounts_schema.sql,
// saved_views) and its email's runs (view_deliveries); the pages are
// view_pages.tsx, the email view_mail.ts.
//
// The address kept is the view's own: the post's address is read as the view
// reads it and written again as the view writes it (view_address.ts
// readViewAddress), and anything that does not come back unchanged is
// refused, so no address a view would not write is ever stored. The name is
// the reader's, control characters dropped and cut to NAME_MAX, or the site's
// label of the view when left empty (LABEL_MAX at most).
//
// Pro keeps 10 and Ultra 50 (entitlements.ts RULES saved_views), held inside
// the insert so two posts at once cannot pass it; Free keeps none. After a
// move to a smaller plan nothing is deleted: the views past the plan's figure
// are kept, listed and marked, and only the first ones by creation date are
// within the plan (withinViewCap). Email delivery, weekly or monthly, is
// Ultra's (view_mail), and offered only while Ultra is on sale.
//
// Until the operator applies accounts_schema.sql the two tables are absent:
// every reader here answers null or nothing for it, so nothing offers to save
// a view and no page answers 500 for it.

import { loadBuyer, loadProfile } from "../data";
import type { Env } from "../env";
import { pick, segmentShort, sourceLabel, t, type Lang } from "../i18n";
import { fiscalLabel } from "../records_db";
import { type Frame, type View, viewBase, viewOf } from "../view_address";
import { SAVED_VIEW_MAX, savedViewCap, type Plan } from "./entitlements";
import { newId } from "./secrets";
import { survivorOf } from "./watches";

// The kinds the site saves today; 'build' (the analytics builder, slice 5)
// is held by the table's CHECK and served by nothing yet.
export const VIEW_KINDS = ["buyer", "organization", "segment"] as const satisfies readonly View[];
export const isViewKind = (v: unknown): v is View => typeof v === "string" && (VIEW_KINDS as readonly string[]).includes(v);

export const VIEW_DELIVERY = ["weekly", "monthly", "off"] as const;
export type ViewDelivery = (typeof VIEW_DELIVERY)[number];
export const isViewDelivery = (v: unknown): v is ViewDelivery => typeof v === "string" && (VIEW_DELIVERY as readonly string[]).includes(v);

// The longest name a reader types, in characters.
export const NAME_MAX = 60;
// The longest label the site writes for a view left unnamed. Longer than a
// typed name, so a subject's name stays whole beside its source and period:
// "Public Services and Procurement Canada, PSPC contract history, 2017-18 to
// 2026-27" is 80 characters, and at 60 the label kept "Public Services and".
export const LABEL_MAX = 100;
// How long a run's row is kept.
export const VIEW_DELIVERY_DAYS = 90;

export type SavedView = {
  id: string; kind: View; address: string; name: string; lang: Lang; deliver: ViewDelivery; created_at: string; last_delivered_at: string | null;
};

type ViewRow = Omit<SavedView, "kind" | "lang" | "deliver"> & { kind: string; lang: string; deliver: string };

const toView = (r: ViewRow): SavedView | null =>
  isViewKind(r.kind)
    ? { ...r, kind: r.kind, lang: r.lang === "fr" ? "fr" : "en", deliver: isViewDelivery(r.deliver) ? r.deliver : "off" }
    : null;

// A fault that names either table missing: the schema not applied since saved views.
export const missingViews = (e: unknown): boolean =>
  /no such table:?\s*(?:saved_views|view_deliveries)\b/i.test(String((e as { message?: unknown })?.message ?? e));

export const VIEWS_LIST_SQL =
  "SELECT id, kind, address, name, lang, deliver, created_at, last_delivered_at FROM saved_views WHERE user_id = ? " +
  `ORDER BY created_at, id LIMIT ${SAVED_VIEW_MAX}`;

// The account's views, oldest first; null while the table is not on the database.
export async function listViews(env: Env, userId: string): Promise<SavedView[] | null> {
  try {
    const res = await env.ACCOUNTS!.prepare(VIEWS_LIST_SQL).bind(userId).all<ViewRow>();
    return (res.results ?? []).map(toView).filter((v): v is SavedView => v !== null);
  } catch (e) {
    if (missingViews(e)) return null;
    throw e;
  }
}

// The views within a plan's figure, in the list's order: the first by
// creation. An account within its plan keeps every view in it; one past it
// (after a move to a smaller plan) keeps the rest listed and marked.
export function withinViewCap<V>(views: readonly V[], plan: Plan): V[] {
  return views.slice(0, savedViewCap(plan));
}

// -- the name -----------------------------------------------------------------------------------

const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;

// A name as kept: control characters dropped, spaces at either end trimmed,
// at most max characters, a typed name's NAME_MAX unless the caller holds the
// site's label (code points, so a character outside the basic plane is never
// cut in half).
export function cleanName(raw: unknown, max = NAME_MAX): string {
  const s = (typeof raw === "string" ? raw : "").replace(CONTROL_RE, "").trim();
  return Array.from(s).slice(0, max).join("").trim();
}

// "Published contracts" mid-sentence: the first letter lowered unless the
// word is an acronym ("PSPC contract history" stays).
const midSentence = (s: string): string => (s.length > 1 && s[1] === s[1].toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);

const length = (s: string) => Array.from(s).length;

// s in at most max characters, cut after its last whole word within them; a
// start with no space in it is cut at max itself.
function cutOnWord(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const cut = chars.slice(0, max).join("");
  if (chars[max] === " ") return cut.trimEnd();
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "");
}

// The site's label of a view: "National Defence, published contracts,
// 2016-17 to 2025-26". Within LABEL_MAX: past it, the subject's name is cut on
// a word with an ellipsis, so the source and the period that tell one view of
// it from another stay whole; when they alone leave too little of the name,
// the label is cut at its last whole part instead (the period, then the source).
export function viewLabel(lang: Lang, name: string, frame: Pick<Frame, "source" | "first" | "last">): string {
  const label = (n: string) => t(lang, "views.label", {
    name: n, source: midSentence(sourceLabel(lang, frame.source)), first: fiscalLabel(lang, frame.first), last: fiscalLabel(lang, frame.last),
  });
  const whole = label(cleanName(name, LABEL_MAX));
  if (length(whole) <= LABEL_MAX) return whole;
  const room = LABEL_MAX - length(label("")) - 1;
  if (room >= 12) return label(`${cutOnWord(name, room)}\u2026`);
  const head = Array.from(whole).slice(0, LABEL_MAX - 1).join("");
  const part = head.lastIndexOf(", ");
  return `${part > 0 ? head.slice(0, part) : cutOnWord(whole, LABEL_MAX - 1)}\u2026`;
}

// The name of what a view shows, as the site names it: a buyer's name, an
// organization's display name, or a segment's code and short name ("81
// Engineering", as a briefing names it); null when the data no longer holds it.
export async function subjectName(env: Env, lang: Lang, kind: View, id: string): Promise<string | null> {
  if (kind === "segment") return `${id} ${segmentShort(lang, id)}`;
  if (kind === "buyer") {
    const b = await loadBuyer(env, id).catch(() => null);
    return b ? pick(lang, b.buyer.name_en, b.buyer.name_fr) ?? b.buyer.name_en : null;
  }
  return (await loadProfile(env, id).catch(() => null))?.organization.display_name ?? null;
}

// -- the rows -------------------------------------------------------------------------------------

// One insert, held to the plan's figure inside the statement, so two posts at
// once cannot pass it; the same address once (the table's unique key).
// ?1 the id, ?2 the account, ?3 the kind, ?4 the address, ?5 the name, ?6 the
// language, ?7 the time, ?8 the plan's figure.
export const ADD_VIEW_SQL =
  "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) " +
  "SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'off', ?7 WHERE (SELECT COUNT(*) FROM saved_views WHERE user_id = ?2) < ?8 " +
  "ON CONFLICT (user_id, address) DO NOTHING";

export type AddViewResult = "added" | "exists" | "full" | "missing";

export async function addView(
  env: Env, who: { userId: string; plan: Plan }, v: { kind: View; address: string; name: string }, lang: Lang, now = new Date(),
): Promise<AddViewResult> {
  const db = env.ACCOUNTS!;
  try {
    const res = await db.prepare(ADD_VIEW_SQL)
      .bind(newId(), who.userId, v.kind, v.address, cleanName(v.name, LABEL_MAX), lang, now.toISOString(), savedViewCap(who.plan)).run();
    if ((res.meta?.changes ?? 0) === 1) return "added";
    const same = await db.prepare("SELECT 1 AS x FROM saved_views WHERE user_id = ? AND address = ?").bind(who.userId, v.address).first();
    return same ? "exists" : "full";
  } catch (e) {
    if (missingViews(e)) return "missing";
    throw e;
  }
}

// What a view's Save control shows (view_pages.tsx): whether the address is
// saved on the account, and how many views it holds. One statement; null
// while the table is not on the database.
export async function viewState(env: Env, userId: string, address: string): Promise<{ saved: boolean; n: number } | null> {
  try {
    const row = await env.ACCOUNTS!.prepare(
      "SELECT EXISTS (SELECT 1 FROM saved_views WHERE user_id = ?1 AND address = ?2) AS saved, " +
      "(SELECT COUNT(*) FROM saved_views WHERE user_id = ?1) AS n",
    ).bind(userId, address).first<{ saved: number; n: number }>();
    return { saved: row?.saved === 1, n: row?.n ?? 0 };
  } catch (e) {
    if (missingViews(e)) return null;
    throw e;
  }
}

// Weekly, monthly or off; the caller holds turning it on to Ultra while it
// is on sale. False when nothing changed, the table missing included.
export async function setViewDelivery(env: Env, userId: string, id: string, deliver: ViewDelivery): Promise<boolean> {
  try {
    const res = await env.ACCOUNTS!.prepare("UPDATE saved_views SET deliver = ? WHERE id = ? AND user_id = ?").bind(deliver, id, userId).run();
    return (res.meta?.changes ?? 0) === 1;
  } catch (e) {
    if (missingViews(e)) return false;
    throw e;
  }
}

// The view with its runs, which the schema's cascade removes too; named here
// so the delete does not lean on it. False when nothing was removed, the
// tables missing included.
export async function deleteView(env: Env, userId: string, id: string): Promise<boolean> {
  const db = env.ACCOUNTS!;
  try {
    const res = await db.batch([
      db.prepare("DELETE FROM view_deliveries WHERE view_id IN (SELECT id FROM saved_views WHERE id = ? AND user_id = ?)").bind(id, userId),
      db.prepare("DELETE FROM saved_views WHERE id = ? AND user_id = ?").bind(id, userId),
    ]);
    return (res[1]?.meta?.changes ?? 0) === 1;
  } catch (e) {
    if (missingViews(e)) return false;
    throw e;
  }
}

// What deleting an account removes of its views (routes.tsx deleteAccount):
// every view and its runs. A database without the tables yet holds none, so
// a missing table is no fault here.
export async function deleteViewsOf(env: Env, userId: string): Promise<void> {
  const db = env.ACCOUNTS!;
  try {
    await db.batch([
      db.prepare("DELETE FROM view_deliveries WHERE view_id IN (SELECT id FROM saved_views WHERE user_id = ?)").bind(userId),
      db.prepare("DELETE FROM saved_views WHERE user_id = ?").bind(userId),
    ]);
  } catch (e) {
    if (!missingViews(e)) throw e;
  }
}

// The newest run of each of the account's views, by view id.
export type ViewRun = { sent_at: string; day: string; status: string };

export async function lastViewRuns(env: Env, userId: string): Promise<Map<string, ViewRun>> {
  const res = await env.ACCOUNTS!.prepare(
    "SELECT d.view_id, d.sent_at, d.day, d.status FROM view_deliveries d WHERE d.id IN (" +
    "SELECT MAX(x.id) FROM view_deliveries x JOIN saved_views v ON v.id = x.view_id WHERE v.user_id = ? GROUP BY x.view_id)",
  ).bind(userId).all<ViewRun & { view_id: string }>();
  return new Map((res.results ?? []).map(({ view_id, ...run }) => [view_id, run]));
}

// -- merges --------------------------------------------------------------------------------------

// A view's address with its buyer or organization id moved to the id the
// nightly merged it into (watches.ts survivorOf), the rest kept; null while
// the id stands (or the alias files cannot say) and for a segment's view.
export async function survivingAddress(env: Env, address: string): Promise<string | null> {
  const v = viewOf(address);
  if (!v || v.kind === "segment") return null;
  const next = await survivorOf(env, v.kind, v.id);
  if (!next || !viewOf(viewBase(v.kind, next))) return null;
  return `${viewBase(v.kind, next)}${v.url.search}`;
}

// Each buyer or organization view whose id the nightly retired into another
// is pointed at the surviving id, as a watch is (watches.ts followAliases);
// when the account already keeps the view at that address, the retired one is
// deleted, merged into it. Returns the views as they now stand, and the ids
// merged away (their dashboard panels go with them, routes.tsx).
export async function followViewAliases(env: Env, userId: string, views: readonly SavedView[]): Promise<{ views: SavedView[]; merged: string[] }> {
  const db = env.ACCOUNTS!;
  const out: SavedView[] = [];
  const merged: string[] = [];
  for (const v of views) {
    const next = await survivingAddress(env, v.address);
    if (!next) {
      out.push(v);
      continue;
    }
    const res = await db.prepare(
      "UPDATE saved_views SET address = ?1 WHERE id = ?2 AND user_id = ?3 AND NOT EXISTS (SELECT 1 FROM saved_views x WHERE x.user_id = ?3 AND x.address = ?1)",
    ).bind(next, v.id, userId).run();
    if ((res.meta?.changes ?? 0) === 1) {
      out.push({ ...v, address: next });
    } else {
      await deleteView(env, userId, v.id);
      merged.push(v.id);
    }
  }
  return { views: out, merged };
}
