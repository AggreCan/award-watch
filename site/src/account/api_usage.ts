// The keyed API's daily count per key (the api_usage table of the accounts
// database; src/api_keyed.ts counts, the keys page reads). A row is a key, a
// UTC day and a number: no path, parameter, address or time of day.
//
// The count fails open: a request whose count cannot be written (the table
// not applied yet, an outage) goes on uncounted, as a limiter fault lets a
// request through (src/limits.ts). The key itself was checked before the
// count, closed to revocation (api_keys.ts).

import { KEY_PER_DAY } from "../api_keyed_spec";
import type { Env } from "../env";
import { KEYS_MAX } from "./api_keys";

// How long a day's row is kept (signin.ts, sweep), and how many days the keys
// page adds up. The usage page (api_usage_page.tsx) draws the USAGE_KEEP_DAYS
// days ending today.
export const USAGE_KEEP_DAYS = 60;
export const USAGE_DAYS_SHOWN = 30;

// One statement a request: the key's row for the day, made at 1 or counted up
// by one while it is under the cap (?3). No row back means the day's cap is
// spent, and the row is left as it was, so a refused request is not counted.
// Through the primary key (key_id, day).
export const COUNT_SQL =
  "INSERT INTO api_usage (key_id, day, n) VALUES (?1, ?2, 1) " +
  "ON CONFLICT (key_id, day) DO UPDATE SET n = api_usage.n + 1 WHERE api_usage.n < ?3 RETURNING n";

// The keys page: each key's count today (?2) and over the USAGE_DAYS_SHOWN
// days ending today (?3 to ?2), for the keys of one user (?1). At most 30
// rows a key, read through the primary key.
export const USAGE_SQL =
  "SELECT key_id, SUM(CASE WHEN day = ?2 THEN n ELSE 0 END) AS today, SUM(n) AS last30 FROM api_usage " +
  "WHERE key_id IN (SELECT id FROM api_keys WHERE user_id = ?1) AND day BETWEEN ?3 AND ?2 GROUP BY key_id";

// The usage page: each day's row from ?3 to ?2 (the USAGE_KEEP_DAYS days
// ending today) for at most ?4 (KEYS_MAX) keys of one user (?1): of the keys
// with a row in those days, the live ones first, then the ones revoked most
// recently, so a revoked key's days stay on the chart while there is room.
// At most ?4 * USAGE_KEEP_DAYS rows, each key's read through the primary key.
export const DAILY_SQL =
  "SELECT key_id, day, n FROM api_usage WHERE day BETWEEN ?3 AND ?2 AND key_id IN (" +
  "SELECT k.id FROM api_keys k WHERE k.user_id = ?1 " +
  "AND EXISTS (SELECT 1 FROM api_usage u WHERE u.key_id = k.id AND u.day BETWEEN ?3 AND ?2) " +
  "ORDER BY k.revoked_at IS NOT NULL, k.revoked_at DESC, k.created_at DESC, k.id LIMIT ?4)";

// The usage page's "All keys": each day's requests from ?3 to ?2 over every
// key of one user (?1), the keys DAILY_SQL leaves out included, and how many
// of those keys have a row in the window (n_keys, the same on each row), so
// the page can say how many have no series of their own. One row a day, at
// most USAGE_KEEP_DAYS; every key's days read through the primary key, the
// keys through idx_api_keys_user. Rows go after USAGE_KEEP_DAYS days, so a
// key reads at most that many.
export const TOTAL_SQL =
  "SELECT day, SUM(n) AS n, (SELECT COUNT(*) FROM api_keys k WHERE k.user_id = ?1 " +
  "AND EXISTS (SELECT 1 FROM api_usage u WHERE u.key_id = k.id AND u.day BETWEEN ?3 AND ?2)) AS n_keys " +
  "FROM api_usage WHERE day BETWEEN ?3 AND ?2 AND key_id IN (SELECT id FROM api_keys WHERE user_id = ?1) " +
  `GROUP BY day ORDER BY day LIMIT ${USAGE_KEEP_DAYS}`;

// The sweep: days before ?1, through idx_api_usage_day.
export const USAGE_SWEEP_SQL = "DELETE FROM api_usage WHERE day < ?1";

// The request's instant: NOW when the environment names one (the tests pin
// it, as they pin the pages' clock), else the time of the request. A request
// is counted under this instant's UTC date.
export function nowOf(env: Pick<Env, "NOW">): Date {
  const fixed = env.NOW ? Date.parse(env.NOW) : Number.NaN;
  return new Date(Number.isFinite(fixed) ? fixed : Date.now());
}

// The UTC date of an instant, and the date n days from a date.
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

export function dayPlus(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Whole seconds to the next 00:00 UTC, at least one: the Retry-After of a
// request refused at the day's cap.
export function secondsToNextDay(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

// What the count said of a request: its number in the day, "spent" at the
// cap, or null when the count could not be written (the request goes on).
export type Counted = number | "spent" | null;

export async function countRequest(env: Env, keyId: string, day: string): Promise<Counted> {
  try {
    const row = await env.ACCOUNTS!.prepare(COUNT_SQL).bind(keyId, day, KEY_PER_DAY).first<{ n: number }>();
    return row ? row.n : "spent";
  } catch {
    console.error("api usage: request not counted, let through");
    return null;
  }
}

export type KeyUsage = { today: number; last30: number };

// Each key's usage by key id (a key with no request in the period is absent),
// or null when the table cannot be read; the keys page then says so. Never
// throws.
export async function keyUsage(env: Env, userId: string, now: Date): Promise<Map<string, KeyUsage> | null> {
  const day = utcDay(now);
  try {
    const res = await env.ACCOUNTS!.prepare(USAGE_SQL).bind(userId, day, dayPlus(day, -(USAGE_DAYS_SHOWN - 1)))
      .all<{ key_id: string; today: number | null; last30: number | null }>();
    return new Map((res.results ?? []).map((r) => [r.key_id, { today: r.today ?? 0, last30: r.last30 ?? 0 }]));
  } catch {
    console.error("api usage: not readable for the keys page");
    return null;
  }
}

export type DayCount = { key_id: string; day: string; n: number };
export type DayTotal = { day: string; n: number };

// The usage page's read: the days of the keys it draws (DAILY_SQL), each
// day's total over every key and how many keys have a row in the window
// (TOTAL_SQL).
export type UsageRead = { rows: DayCount[]; totals: DayTotal[]; keys: number };

// The first day of the usage page's window, which ends on `day`.
const windowStart = (day: string): string => dayPlus(day, -(USAGE_KEEP_DAYS - 1));

// The usage page's rows: a key and a day with no request have none, nor a day
// with no request from any key. Both statements in one batch, so the total
// and the keys' rows are counted at the same moment. Null when the table
// cannot be read; the page then says so. Never throws.
export async function dailyUsage(env: Env, userId: string, now: Date): Promise<UsageRead | null> {
  const day = utcDay(now);
  const first = windowStart(day);
  try {
    const db = env.ACCOUNTS!;
    const [daily, total] = await db.batch<Record<string, unknown>>([
      db.prepare(DAILY_SQL).bind(userId, day, first, KEYS_MAX),
      db.prepare(TOTAL_SQL).bind(userId, day, first),
    ]);
    const totals = (total.results ?? []).map((r) => ({ day: String(r.day), n: Number(r.n) || 0, keys: Number(r.n_keys) || 0 }));
    return {
      rows: (daily.results ?? []).map((r) => ({ key_id: String(r.key_id), day: String(r.day), n: Number(r.n) || 0 })),
      totals: totals.map(({ day, n }) => ({ day, n })),
      keys: totals[0]?.keys ?? 0,
    };
  } catch {
    console.error("api usage: not readable for the usage page");
    return null;
  }
}
