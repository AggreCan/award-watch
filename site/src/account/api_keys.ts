// API keys: issued and revoked on /account/keys, enforced on no route yet.
// Phase 3 mounts requireApiKey on the metered endpoints; until then it is
// exported and tested, and mounted nowhere.
//
// A key reads "aw_<prefix>_<secret>": 8 hex characters shown on the keys
// page so the user can tell keys apart, then 32 random bytes. The row holds
// the prefix and SHA-256 of the whole key; the key is shown once, on the
// page that creates it, and never again. A lookup reads the rows with the
// key's prefix and compares each hash in constant time.

import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv, Env } from "../env";
import { t } from "../i18n";
import { type Feature, allowed, planFor } from "./entitlements";
import { newId, randomHex, sameHash, sha256Hex } from "./secrets";
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

// A new key, or "limit" when the user already holds KEYS_MAX live ones.
export async function createKey(env: Env, userId: string, name: string, now = new Date()): Promise<{ key: string; prefix: string } | "limit"> {
  const db = env.ACCOUNTS!;
  const prefix = randomHex(4);
  const key = `aw_${prefix}_${randomHex(32)}`;
  const res = await db.prepare(
    "INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) SELECT ?, ?, ?, ?, ?, ? " +
    "WHERE (SELECT COUNT(*) FROM api_keys WHERE user_id = ? AND revoked_at IS NULL) < ?",
  ).bind(newId(), userId, name, await sha256Hex(key), prefix, now.toISOString(), userId, KEYS_MAX).run();
  return (res.meta?.changes ?? 0) === 1 ? { key, prefix } : "limit";
}

export async function revokeKey(env: Env, userId: string, id: string, now = new Date()): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(now.toISOString(), id, userId).run();
  return (res.meta?.changes ?? 0) === 1;
}

// -- the middleware ---------------------------------------------------------------

export type KeyHolder = { userId: string; keyId: string } | { userId: null; keyId: null; unverified: true };

const holders = new WeakMap<Request, KeyHolder>();

// Who a request's key belongs to, once requireApiKey has let it through.
// unverified: the database could not be read and the request went on.
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

// requireApiKey(feature): a missing, malformed, unknown or revoked key gets a
// 401; a key whose owner's plan does not allow the feature gets a 403. Fail
// open to outages, closed to revocation: when the database cannot be read
// the request goes on, marked unverified, while a key the database names as
// revoked stops at once. While the switch is off it gates nothing: the
// request passes untouched and nothing is read.
export function requireApiKey(feature: Feature = "api"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!accountsEnabled(c.env)) return next();
    const lang = c.get("lang") ?? "en";
    const refuse = (status: 401 | 403, key: "account.api_key_missing" | "account.api_key_invalid" | "account.api_key_plan") => {
      c.header("Cache-Control", "no-store");
      if (status === 401) c.header("WWW-Authenticate", 'Bearer realm="api"');
      return c.json({ error: t(lang, key) }, status);
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
      console.error("api key: database unreadable, request let through unverified");
      holders.set(c.req.raw, { userId: null, keyId: null, unverified: true });
      return next();
    }
    let found: Found | null = null;
    for (const row of rows) {
      const same = sameHash(hash, row.key_hash);
      if (same && !found) found = row;
    }
    if (!found || found.revoked_at || found.status !== "active") return refuse(401, "account.api_key_invalid");
    const plan = await planFor(c.env, { id: found.user_id, plan: found.plan, plan_until: found.plan_until }, now);
    if (!allowed(plan, feature)) return refuse(403, "account.api_key_plan");
    if (!found.last_used_at || now.getTime() - Date.parse(found.last_used_at) > USE_WRITE_MS) {
      try {
        await c.env.ACCOUNTS!.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").bind(now.toISOString(), found.id).run();
      } catch {
        // The last-use time lags; the key still stands.
      }
    }
    holders.set(c.req.raw, { userId: found.user_id, keyId: found.id });
    return next();
  };
}
