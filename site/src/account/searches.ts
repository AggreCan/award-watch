// Saved searches: the alerts form's filters, kept on an account. The kinds,
// the allowed filter keys and the labels are interest.tsx's: a page address
// goes through interestFilter, which keeps only the keys the kind allows and
// writes the label from the codes and the names the data holds, so nothing a
// user typed is stored as received (words of a title search stay in the
// filter and never reach the label).
//
// The interest table of the forms database holds requests for alerts made
// before accounts existed. When the signed-in address has rows there, the
// searches page offers to save them here in one step; the rows saved are
// then marked confirmed_at, since signing in has proved the address.

import type { Env } from "../env";
import type { Lang } from "../i18n";
import { INTEREST_KINDS, type InterestFilter, type InterestKind, ULTRA_KIND, kindOfPath } from "../pages/interest";
import { SAVED_SEARCH_MAX, savedSearchCap } from "./entitlements";
import { deleteFeeds } from "./feeds";
import { missingTable } from "./records_deliveries";
import { newId } from "./secrets";
import type { Account } from "./session";

export const DELIVERY = ["daily", "weekly", "off"] as const;
export type Delivery = (typeof DELIVERY)[number];
export const isDelivery = (v: unknown): v is Delivery => typeof v === "string" && (DELIVERY as readonly string[]).includes(v);

// The kinds the delivery job can serve (deliveries.ts): every kind. A tender
// list reads each day's new notices, which carry the day they were first
// seen; the radar reads its windows by end date; an organization, buyer or
// segment search reads the records database's counts by source and fiscal
// year and reports the ones that rose since its last delivery
// (records_deliveries.ts), since no file dates a record's first sighting.
export const DELIVERABLE_KINDS: readonly InterestKind[] = ["tenders", "expiring", "organization", "buyer", "segment"];

export type SavedSearch = {
  id: string; kind: InterestKind; params: string; label: string; lang: Lang; created_at: string; deliver: Delivery;
};

const PARAMS_MAX = 2000;
const LABEL_MAX = 1000;

export async function listSearches(env: Env, userId: string): Promise<SavedSearch[]> {
  const res = await env.ACCOUNTS!.prepare(
    "SELECT id, kind, params, label, lang, created_at, deliver FROM saved_searches WHERE user_id = ? ORDER BY created_at, id",
  ).bind(userId).all<SavedSearch>();
  return res.results ?? [];
}

export const capFor = (account: Pick<Account, "plan">): number => Math.min(savedSearchCap(account.plan), SAVED_SEARCH_MAX);

// One insert, held to the cap inside the statement so two posts at once
// cannot pass it; the weekly briefings share the cap (briefings.ts), so the
// count reads both tables (the searches alone while the briefings table is
// not on the database yet). "exists" when the same filter is saved already.
const ADD_SEARCH = (count: string) =>
  "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) " +
  `SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'off' WHERE ${count} < ?8 ON CONFLICT (user_id, kind, params) DO NOTHING`;
const SEARCHES_COUNT = "(SELECT COUNT(*) FROM saved_searches WHERE user_id = ?2)";

export async function addSearch(
  env: Env, account: Pick<Account, "userId" | "plan">, filter: InterestFilter, lang: Lang, now = new Date(),
): Promise<"added" | "exists" | "cap"> {
  const db = env.ACCOUNTS!;
  const binds = [
    newId(), account.userId, filter.kind, filter.params.slice(0, PARAMS_MAX), filter.label.slice(0, LABEL_MAX), lang, now.toISOString(),
    capFor(account),
  ];
  const res = await db.prepare(ADD_SEARCH(`${SEARCHES_COUNT} + (SELECT COUNT(*) FROM briefings WHERE user_id = ?2)`)).bind(...binds).run()
    .catch((e) => {
      if (!missingTable(e)) throw e;
      return db.prepare(ADD_SEARCH(SEARCHES_COUNT)).bind(...binds).run();
    });
  if ((res.meta?.changes ?? 0) === 1) return "added";
  const same = await db.prepare("SELECT 1 AS x FROM saved_searches WHERE user_id = ? AND kind = ? AND params = ?")
    .bind(account.userId, filter.kind, filter.params).first();
  return same ? "exists" : "cap";
}

// What a page's Save this search control shows (search_control.tsx): whether
// the page's filter is saved on the account, and how many the account holds
// against the cap, the briefings counted as addSearch counts them. One
// statement, on the table's unique key and the account's rows.
const SEARCH_STATE = (count: string) =>
  `SELECT EXISTS (SELECT 1 FROM saved_searches WHERE user_id = ?1 AND kind = ?2 AND params = ?3) AS saved, ${count} AS n`;
const STATE_COUNT = "(SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1)";

export async function searchState(
  env: Env, userId: string, filter: Pick<InterestFilter, "kind" | "params">,
): Promise<{ saved: boolean; n: number }> {
  const db = env.ACCOUNTS!;
  const binds = [userId, filter.kind, filter.params];
  const row = await db.prepare(SEARCH_STATE(`${STATE_COUNT} + (SELECT COUNT(*) FROM briefings WHERE user_id = ?1)`)).bind(...binds)
    .first<{ saved: number; n: number }>()
    .catch((e) => {
      if (!missingTable(e)) throw e;
      return db.prepare(SEARCH_STATE(STATE_COUNT)).bind(...binds).first<{ saved: number; n: number }>();
    });
  return { saved: row?.saved === 1, n: row?.n ?? 0 };
}

// Daily or weekly only for a kind the job can deliver; off for any.
export async function setDelivery(env: Env, userId: string, id: string, deliver: Delivery): Promise<boolean> {
  const kinds = DELIVERABLE_KINDS.map(() => "?").join(", ");
  const res = await env.ACCOUNTS!.prepare(
    `UPDATE saved_searches SET deliver = ? WHERE id = ? AND user_id = ? AND (? = 'off' OR kind IN (${kinds}))`,
  ).bind(deliver, id, userId, deliver, ...DELIVERABLE_KINDS).run();
  return (res.meta?.changes ?? 0) === 1;
}

// The search with its stop link, its delivery rows and its records mark,
// which the schema's cascade removes too; named here so the delete does not
// lean on it. Its calendar feed goes first (feeds.ts), so the feed's address
// stops with the search.
export async function deleteSearch(env: Env, userId: string, id: string): Promise<boolean> {
  const db = env.ACCOUNTS!;
  await deleteFeeds(env, { userId, searchId: id });
  const mine = "SELECT id FROM saved_searches WHERE id = ? AND user_id = ?";
  const res = await db.batch([
    db.prepare(`DELETE FROM delivery_tokens WHERE search_id IN (${mine})`).bind(id, userId),
    db.prepare(`DELETE FROM deliveries WHERE saved_search_id IN (${mine})`).bind(id, userId),
    db.prepare(`DELETE FROM delivery_marks WHERE search_id IN (${mine})`).bind(id, userId),
    db.prepare("DELETE FROM saved_searches WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  return (res[3]?.meta?.changes ?? 0) === 1;
}

// The newest delivery row of each of the user's searches, by search id.
export type LastDelivery = { sent_at: string; items: number; status: string };

export async function lastDeliveries(env: Env, userId: string): Promise<Map<string, LastDelivery>> {
  const res = await env.ACCOUNTS!.prepare(
    "SELECT d.saved_search_id, d.sent_at, d.items, d.status FROM deliveries d WHERE d.id IN (" +
    "SELECT MAX(x.id) FROM deliveries x JOIN saved_searches s ON s.id = x.saved_search_id WHERE s.user_id = ? GROUP BY x.saved_search_id)",
  ).bind(userId).all<LastDelivery & { saved_search_id: string }>();
  return new Map((res.results ?? []).map(({ saved_search_id, ...last }) => [saved_search_id, last]));
}

// -- the alerts form's rows ------------------------------------------------------

export type InterestRow = { id: number; kind: string; params: string; label: string; lang: string };

// A row the forms database holds is used only if it still reads as one the
// form could have written: a known kind whose path matches it, within the
// lengths the form keeps. The Ultra card's row (ULTRA_KIND, no filter) is an
// address waiting for the Ultra message, not a saved search, so it is never
// offered or imported; it stays in the table for that message.
function readable(row: InterestRow): row is InterestRow & { kind: InterestKind } {
  if (row.kind === ULTRA_KIND) return false;
  if (!(INTEREST_KINDS as readonly string[]).includes(row.kind)) return false;
  if (row.params.length > PARAMS_MAX || row.label.length > LABEL_MAX || !row.label.trim()) return false;
  const path = row.params.split("?")[0];
  return kindOfPath(path) === row.kind;
}

// The address's alert requests not unsubscribed and not saved on the
// account yet.
export async function pendingInterest(env: Env, email: string, userId: string): Promise<InterestRow[]> {
  const res = await env.DB.prepare(
    "SELECT id, kind, params, label, lang FROM interest WHERE email = ? AND unsubscribed_at IS NULL ORDER BY id LIMIT 100",
  ).bind(email).all<InterestRow>();
  const rows = (res.results ?? []).filter(readable);
  if (!rows.length) return [];
  const saved = new Set((await listSearches(env, userId)).map((s) => `${s.kind}\n${s.params}`));
  return rows.filter((r) => !saved.has(`${r.kind}\n${r.params}`));
}

// Saves the pending rows up to the plan's cap and marks the ones saved as
// confirmed. left is how many did not fit.
export async function importInterest(
  env: Env, account: Pick<Account, "userId" | "email" | "plan">, now = new Date(),
): Promise<{ imported: number; left: number }> {
  const rows = await pendingInterest(env, account.email, account.userId);
  const done: number[] = [];
  let left = 0;
  for (const row of rows) {
    const lang: Lang = row.lang === "fr" ? "fr" : "en";
    const result = await addSearch(env, account, { kind: row.kind as InterestKind, params: row.params, label: row.label }, lang, now);
    if (result === "cap") left++;
    else done.push(row.id);
  }
  if (done.length) {
    await env.DB.prepare(
      `UPDATE interest SET confirmed_at = ? WHERE email = ? AND confirmed_at IS NULL AND id IN (${done.map(() => "?").join(", ")})`,
    ).bind(now.toISOString(), account.email, ...done).run();
  }
  return { imported: done.length, left };
}
