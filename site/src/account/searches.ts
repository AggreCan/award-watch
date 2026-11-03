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
import { INTEREST_KINDS, type InterestFilter, type InterestKind, kindOfPath } from "../pages/interest";
import { SAVED_SEARCH_MAX, savedSearchCap } from "./entitlements";
import { newId } from "./secrets";
import type { Account } from "./session";

export const DELIVERY = ["daily", "weekly", "off"] as const;
export type Delivery = (typeof DELIVERY)[number];
export const isDelivery = (v: unknown): v is Delivery => typeof v === "string" && (DELIVERY as readonly string[]).includes(v);

// The kinds the delivery job can serve (deliveries.ts). A tender list reads
// each day's new notices, which carry the day they were first seen; the radar
// reads its windows by end date. The organization, buyer and segment files
// list award notices, contracts and grants with no date first seen, so "new
// records naming it" cannot be told from records already there; those kinds
// keep delivery off until the export dates them.
export const DELIVERABLE_KINDS: readonly InterestKind[] = ["tenders", "expiring"];
export const isDeliverable = (kind: string): boolean => (DELIVERABLE_KINDS as readonly string[]).includes(kind);

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
// cannot pass it. "exists" when the same filter is saved already.
export async function addSearch(
  env: Env, account: Pick<Account, "userId" | "plan">, filter: InterestFilter, lang: Lang, now = new Date(),
): Promise<"added" | "exists" | "cap"> {
  const db = env.ACCOUNTS!;
  const res = await db.prepare(
    "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) " +
    "SELECT ?, ?, ?, ?, ?, ?, ?, 'off' WHERE (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?) < ? " +
    "ON CONFLICT (user_id, kind, params) DO NOTHING",
  ).bind(
    newId(), account.userId, filter.kind, filter.params.slice(0, PARAMS_MAX), filter.label.slice(0, LABEL_MAX), lang, now.toISOString(),
    account.userId, capFor(account),
  ).run();
  if ((res.meta?.changes ?? 0) === 1) return "added";
  const same = await db.prepare("SELECT 1 AS x FROM saved_searches WHERE user_id = ? AND kind = ? AND params = ?")
    .bind(account.userId, filter.kind, filter.params).first();
  return same ? "exists" : "cap";
}

// Daily or weekly only for a kind the job can deliver; off for any.
export async function setDelivery(env: Env, userId: string, id: string, deliver: Delivery): Promise<boolean> {
  const kinds = DELIVERABLE_KINDS.map(() => "?").join(", ");
  const res = await env.ACCOUNTS!.prepare(
    `UPDATE saved_searches SET deliver = ? WHERE id = ? AND user_id = ? AND (? = 'off' OR kind IN (${kinds}))`,
  ).bind(deliver, id, userId, deliver, ...DELIVERABLE_KINDS).run();
  return (res.meta?.changes ?? 0) === 1;
}

// The search with its stop link and its delivery rows, which the schema's
// cascade removes too; named here so the delete does not lean on it.
export async function deleteSearch(env: Env, userId: string, id: string): Promise<boolean> {
  const db = env.ACCOUNTS!;
  const mine = "SELECT id FROM saved_searches WHERE id = ? AND user_id = ?";
  const res = await db.batch([
    db.prepare(`DELETE FROM delivery_tokens WHERE search_id IN (${mine})`).bind(id, userId),
    db.prepare(`DELETE FROM deliveries WHERE saved_search_id IN (${mine})`).bind(id, userId),
    db.prepare("DELETE FROM saved_searches WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  return (res[2]?.meta?.changes ?? 0) === 1;
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
// lengths the form keeps.
function readable(row: InterestRow): row is InterestRow & { kind: InterestKind } {
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
