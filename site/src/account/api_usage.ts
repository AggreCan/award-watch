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

// How long a day's row is kept (signin.ts, sweep), and how many days the keys
// page adds up.
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
