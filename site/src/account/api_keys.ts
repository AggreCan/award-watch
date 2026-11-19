// API keys: issued and revoked on /account/keys, and asked for by the keyed
// API under /api/v1 (src/api_keyed.ts), which mounts requireApiKey("api").
//
// A key reads "aw_<prefix>_<secret>": 8 hex characters shown on the keys
// page so the user can tell keys apart, then 32 random bytes. The row holds
// the prefix and SHA-256 of the whole key; the key is shown once, on the
// page that creates it, and never again. A lookup reads the rows with the
// key's prefix and compares each hash in constant time.

import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "../env";
import { fmtInt, t } from "../i18n";
import { isBlocked } from "./admin_ops";
import { type Feature, type Group, type Plan, allowed, lastKnownPlan, planFor } from "./entitlements";
import { type InGroup, aheadIds, groupIn, pooled } from "./pool";
import { newId, randomHex, sameHash, sha256Hex } from "./secrets";
import { OUTAGE_TRUST_MS } from "./session";
import { accountsEnabled } from "./switch";

export const KEY_RE = /^aw_([0-9a-f]{8})_([0-9a-f]{64})$/;
export const KEYS_MAX = 5;
export const KEY_NAME_MAX = 60;
const USE_WRITE_MS = 60_000;

export type KeyRow = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

export async function listKeys(env: Env, userId: string): Promise<KeyRow[]> {
  const res = await env.ACCOUNTS!.prepare(
    "SELECT id, name, prefix, created_at, last_used_at, revoked_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC, id",
  ).bind(userId).all<KeyRow>();
  return res.results ?? [];
}

// A new key; "limit" when the user already holds KEYS_MAX live ones; "exists"
// when one of its live keys has that name already. Both held inside the
// insert, so the same form posted again (a reload of the page that showed the
// new key) makes no second key, and two posts at once cannot pass either. For
// an account in a group KEYS_MAX is the subscription's, the live keys counted
// over the group's ids at ?8 to ?12 (pool.ts); a key's name stays each
// person's own.
const createKeySql = (users: string) =>
  "INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 " +
  `WHERE (SELECT COUNT(*) FROM api_keys WHERE user_id ${users} AND revoked_at IS NULL) < ?7 ` +
  "AND NOT EXISTS (SELECT 1 FROM api_keys WHERE user_id = ?2 AND revoked_at IS NULL AND name = ?3)";
export const CREATE_KEY_SQL = createKeySql("= ?2");
export const CREATE_KEY_GROUP_SQL = createKeySql(`IN ${groupIn(8)}`);

export async function createKey(
  env: Env, who: { userId: string } & InGroup, name: string, now = new Date(),
): Promise<{ key: string; prefix: string } | "limit" | "exists"> {
  const db = env.ACCOUNTS!;
  const prefix = randomHex(4);
  const key = `aw_${prefix}_${randomHex(32)}`;
  const q = pooled(who, CREATE_KEY_SQL, CREATE_KEY_GROUP_SQL);
  const res = await db.prepare(q.sql).bind(newId(), who.userId, name, await sha256Hex(key), prefix, now.toISOString(), KEYS_MAX, ...q.binds).run();
  if ((res.meta?.changes ?? 0) === 1) return { key, prefix };
  const same = await db.prepare("SELECT 1 AS x FROM api_keys WHERE user_id = ? AND revoked_at IS NULL AND name = ?").bind(who.userId, name).first();
  return same ? "exists" : "limit";
}

export async function revokeKey(env: Env, userId: string, id: string, now = new Date()): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(now.toISOString(), id, userId).run();
  return (res.meta?.changes ?? 0) === 1;
}

// -- the middleware ---------------------------------------------------------------

// stale: the database could not be read and this isolate's last check of the
// key answered. plan and planUntil are the answer the check gave, so a route
// behind the middleware never reads the entitlements a second time.
export type KeyHolder = { userId: string; keyId: string; plan: Plan; planUntil: string | null; stale?: true };

const holders = new WeakMap<Request, KeyHolder>();

// Who a request's key belongs to, once requireApiKey has let it through.
export function apiKeyOf(c: Context<AppEnv>): KeyHolder | undefined {
  return holders.get(c.req.raw);
}

// The key a request carries: "Authorization: Bearer aw_..." or "X-Api-Key".
export function presentedKey(headers: Headers): string | null {
  const auth = headers.get("authorization");
  const bearer = auth ? /^Bearer\s+(\S+)$/i.exec(auth.trim())?.[1] : undefined;
  const raw = bearer ?? headers.get("x-api-key")?.trim();
  return raw ? raw.slice(0, 120) : null;
}

type Found = { id: string; key_hash: string; revoked_at: string | null; last_used_at: string | null; user_id: string; status: string; plan: string; plan_until: string | null };

// What this isolate last read for each key it has checked, for the outage
// case only, as session.ts keeps sessions: keyed by the key's hash (never the
// key), bounded, the oldest first out, and dropped the moment a read refuses
// the key. served is a group member's key's last answer from KEY_SERVED_SQL
// and when it was read; absent for every other key.
type KnownKey = { userId: string; keyId: string; plan: Plan; planUntil: string | null; verifiedAt: number; served?: { ok: boolean; at: number } };

// A key of a member of a group (docs/accounts.md, Seats, The pool) is in
// service while the live keys of the accounts ahead of it in its group (?3 to
// ?7, NULL in the places left) and the account's own live keys made before it
// (?1 the account, ?2 the key) number fewer than KEYS_MAX: the subscription's
// keys are served the holder's first, then each member's in the order the seat
// was joined, each account's oldest first. One statement, through
// idx_api_keys_user and the key's own row, sent only for a member's key (a
// holder's keys are all in service, the insert holding them to KEYS_MAX) and at
// most once in KEY_SERVED_MS a key: the answer is remembered with the key's
// last-known answer, so a key used 600 times a minute is checked once in five.
export const KEY_SERVED_SQL =
  `SELECT (SELECT COUNT(*) FROM api_keys WHERE user_id IN ${groupIn(3)} AND revoked_at IS NULL) + ` +
  "(SELECT COUNT(*) FROM api_keys x JOIN api_keys k ON k.id = ?2 WHERE x.user_id = ?1 AND x.revoked_at IS NULL " +
  "AND (x.created_at < k.created_at OR (x.created_at = k.created_at AND x.id < k.id))) AS n";
export const KEY_SERVED_MS = 5 * 60 * 1000;

// Whether a member's key is in service, from the remembered answer while it is
// recent, else from KEY_SERVED_SQL. A read that fails keeps the remembered
// answer, or lets the key through (fail open to outages, as the rest of the
// check does); a key the pool has no room for is refused, never deleted.
async function servedKey(
  env: Env, userId: string, keyId: string, group: Group, before: KnownKey | undefined, now: Date,
): Promise<{ ok: boolean; at: number }> {
  if (before?.served && before.keyId === keyId && now.getTime() - before.served.at < KEY_SERVED_MS) return before.served;
  try {
    const row = await env.ACCOUNTS!.prepare(KEY_SERVED_SQL).bind(userId, keyId, ...aheadIds(group)).first<{ n: number }>();
    return { ok: (row?.n ?? 0) < KEYS_MAX, at: now.getTime() };
  } catch {
    console.error("api key: the pool's keys unreadable, last answer kept");
    return before?.served ?? { ok: true, at: now.getTime() };
  }
}
const lastKnownKeys = new Map<string, KnownKey>();
const LAST_KNOWN_KEYS_MAX = 500;

function rememberKey(hash: string, known: KnownKey): void {
  lastKnownKeys.delete(hash);
  lastKnownKeys.set(hash, known);
  if (lastKnownKeys.size > LAST_KNOWN_KEYS_MAX) lastKnownKeys.delete(lastKnownKeys.keys().next().value as string);
}

// For tests: forget what this isolate has checked.
export function forgetKeys(): void {
  lastKnownKeys.clear();
}

// requireApiKey(feature): a missing, malformed, unknown or revoked key gets a
// 401; a key whose owner's plan does not allow the feature gets a 403. Fail
// open to outages, closed to revocation: when the database cannot be read, a
// key this isolate verified within the last hour keeps its last known answer
// (its plan until the plan's own end), and any other key gets a 503, since a
// key that looks right proves nothing until the database has seen it; a key
// the database names as revoked stops at once. An answer to a key is for its
// holder alone, so it goes out private and no-store whatever the route set
// (the /api sub-app marks a response without a rule public for five
// minutes). While the switch is off it gates nothing: the request passes
// untouched and nothing is read. A key of a member of a group that is past the
// subscription's keys gets a 403 that says so (KEY_SERVED_SQL above).
export function requireApiKey(feature: Feature = "api"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!accountsEnabled(c.env)) return next();
    const lang = c.get("lang") ?? "en";
    const refuse = (
      status: 401 | 403 | 503,
      key: "account.api_key_missing" | "account.api_key_invalid" | "account.api_key_plan" | "account.unavailable_text" | "pool.key_unavailable",
    ) => {
      c.header("Cache-Control", "no-store");
      if (status === 401) c.header("WWW-Authenticate", 'Bearer realm="api"');
      if (status === 503) c.header("Retry-After", "60");
      return c.json({ error: key === "pool.key_unavailable" ? t(lang, key, { cap: fmtInt(KEYS_MAX, lang) }) : t(lang, key) }, status);
    };
    const pass = async (holder: KeyHolder) => {
      holders.set(c.req.raw, holder);
      await next();
      c.header("Cache-Control", "private, no-store");
    };
    const raw = presentedKey(c.req.raw.headers);
    if (!raw) return refuse(401, "account.api_key_missing");
    const m = KEY_RE.exec(raw);
    if (!m) return refuse(401, "account.api_key_invalid");
    const hash = await sha256Hex(raw);
    const now = new Date();
    let rows: Found[];
    try {
      const res = await c.env.ACCOUNTS!.prepare(
        "SELECT k.id, k.key_hash, k.revoked_at, k.last_used_at, k.user_id, u.status, u.plan, u.plan_until " +
        "FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.prefix = ?",
      ).bind(m[1]).all<Found>();
      rows = res.results ?? [];
    } catch {
      const known = lastKnownKeys.get(hash);
      // Within an hour of its last check, as a remembered session (session.ts).
      if (!known || now.getTime() - known.verifiedAt > OUTAGE_TRUST_MS) {
        console.error("api key: database unreadable, key not checked before on this instance");
        return refuse(503, "account.unavailable_text");
      }
      console.error("api key: database unreadable, last known answer used");
      const last = lastKnownPlan({ id: known.userId, plan: known.plan, plan_until: known.planUntil }, now);
      if (!allowed(last, feature)) return refuse(403, "account.api_key_plan");
      // A member's key the pool had no room for at its last check stays refused.
      if (known.served && !known.served.ok) return refuse(403, "pool.key_unavailable");
      return pass({ userId: known.userId, keyId: known.keyId, plan: last.plan, planUntil: last.until, stale: true });
    }
    let found: Found | null = null;
    for (const row of rows) {
      const same = sameHash(hash, row.key_hash);
      if (same && !found) found = row;
    }
    // A blocked account's keys (admin_ops.ts) answer as revoked ones do.
    if (!found || found.revoked_at || found.status !== "active" || (await isBlocked(c.env, { id: found.user_id }))) {
      lastKnownKeys.delete(hash);
      return refuse(401, "account.api_key_invalid");
    }
    const plan = await planFor(c.env, { id: found.user_id, plan: found.plan, plan_until: found.plan_until }, now);
    // A member's key, on a plan with the feature: in service or not (KEY_SERVED_SQL). Nothing more for any other key.
    const member = plan.group && plan.group.position > 0 && allowed(plan, feature) ? plan.group : null;
    const served = member ? await servedKey(c.env, found.user_id, found.id, member, lastKnownKeys.get(hash), now) : null;
    rememberKey(hash, {
      userId: found.user_id, keyId: found.id, plan: plan.plan, planUntil: plan.until, verifiedAt: now.getTime(), ...(served ? { served } : {}),
    });
    if (!allowed(plan, feature)) return refuse(403, "account.api_key_plan");
    if (served && !served.ok) return refuse(403, "pool.key_unavailable");
    if (!found.last_used_at || now.getTime() - Date.parse(found.last_used_at) > USE_WRITE_MS) {
      try {
        await c.env.ACCOUNTS!.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now.toISOString(), found.id).run();
      } catch {
        // The last-use time lags; the key still stands.
      }
    }
    return pass({ userId: found.user_id, keyId: found.id, plan: plan.plan, planUntil: plan.until });
  };
}
