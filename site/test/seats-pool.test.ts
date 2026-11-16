// Seats, slice P1: the pool at the inserts and the download limiter (docs/accounts.md, Seats, The
// pool). Every counted figure of a subscription with seats is counted over its group inside the insert
// that holds it (src/account/pool.ts pooled, and each statement's _GROUP_SQL twin), the counts the pages
// state are the group's with the account's own beside them, and a download counts under the holder's
// key. For an account in no group every statement is today's, word for word: TODAY below holds each as
// the code sent it at e9a7df6, captured from the running code before this slice (never rebuilt from the
// constants under test), and each is held here with the values it binds and the answers it gives. No
// page creates a seat yet, so every seat here is written by fixture, as test/seats.test.ts writes them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CREATE_KEY_GROUP_SQL, CREATE_KEY_SQL, KEYS_MAX, createKey } from "../src/account/api_keys";
import { ADD_BRIEFING_GROUP_SQL, ADD_BRIEFING_SQL, BRIEFING_STATE_GROUP_SQL, BRIEFING_STATE_SQL, addBriefing, briefingState } from "../src/account/briefings";
import { BUG_REPORTS_PER_DAY, BUG_STORE_GROUP_SQL, BUG_STORE_SQL } from "../src/account/bugs";
import {
  ADD_TEXT_SQL, ADD_TILE_SQL, BOARD_INSERT_GROUP_SQL, BOARD_INSERT_SQL, MOVE_TO_SQL, NEW_BOARD_GROUP_SQL, NEW_BOARD_SQL,
} from "../src/account/dashboard";
import { type Group, type Plan, type PlanHolder, planFor } from "../src/account/entitlements";
import { CREATE_FEED_GROUP_SQL, CREATE_FEED_SQL, FEEDS_MAX, createFeed } from "../src/account/feeds";
import { POOL_SLOTS, groupIds, pooled } from "../src/account/pool";
import { ADD_VIEW_GROUP_SQL, ADD_VIEW_SQL, addView } from "../src/account/saved_views";
import {
  ADD_SEARCH_GROUP_SQL, ADD_SEARCH_NO_BRIEFINGS_GROUP_SQL, ADD_SEARCH_NO_BRIEFINGS_SQL, ADD_SEARCH_SQL, HELD_GROUP_SQL, HELD_NO_BRIEFINGS_GROUP_SQL,
  HELD_NO_BRIEFINGS_SQL, HELD_SQL, SEARCH_STATE_GROUP_SQL, SEARCH_STATE_NO_BRIEFINGS_GROUP_SQL, SEARCH_STATE_NO_BRIEFINGS_SQL, SEARCH_STATE_SQL,
  addSearch, heldCount, heldCounts, importInterest, searchState,
} from "../src/account/searches";
import {
  ADD_WATCH_GROUP_SQL, ADD_WATCH_SQL, WATCH_COUNT_GROUP_SQL, WATCH_COUNT_SQL, WATCH_STATE_GROUP_SQL, WATCH_STATE_SQL, addWatch, watchCount, watchState,
} from "../src/account/watches";
import { ACCOUNTS, csrf, decode, get, grantPro, grantUltra, nbsp, newEmail, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";

useAccountsDb();

afterEach(() => {
  vi.restoreAllMocks();
});

// Today's statements, word for word, as the code sent them before this slice.
const TODAY = {
  ADD_SEARCH: "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'off' WHERE (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?2) + (SELECT COUNT(*) FROM briefings WHERE user_id = ?2) < ?8 ON CONFLICT (user_id, kind, params) DO NOTHING",
  ADD_SEARCH_NO_BRIEFINGS: "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'off' WHERE (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?2) < ?8 ON CONFLICT (user_id, kind, params) DO NOTHING",
  SEARCH_STATE: "SELECT EXISTS (SELECT 1 FROM saved_searches WHERE user_id = ?1 AND kind = ?2 AND params = ?3) AS saved, (SELECT id FROM saved_searches WHERE user_id = ?1 AND kind = ?2 AND params = ?3) AS id, (SELECT deliver FROM saved_searches WHERE user_id = ?1 AND kind = ?2 AND params = ?3) AS deliver, (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1) + (SELECT COUNT(*) FROM briefings WHERE user_id = ?1) AS n",
  SEARCH_STATE_NO_BRIEFINGS: "SELECT EXISTS (SELECT 1 FROM saved_searches WHERE user_id = ?1 AND kind = ?2 AND params = ?3) AS saved, (SELECT id FROM saved_searches WHERE user_id = ?1 AND kind = ?2 AND params = ?3) AS id, (SELECT deliver FROM saved_searches WHERE user_id = ?1 AND kind = ?2 AND params = ?3) AS deliver, (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1) AS n",
  HELD: "SELECT (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1) + (SELECT COUNT(*) FROM briefings WHERE user_id = ?1) AS n",
  HELD_NO_BRIEFINGS: "SELECT (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1) AS n",
  ADD_BRIEFING: "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 WHERE (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?2) + (SELECT COUNT(*) FROM briefings WHERE user_id = ?2) < ?10 ON CONFLICT (user_id, kind, subject, segment) DO NOTHING",
  BRIEFING_STATE: "SELECT (SELECT id FROM briefings WHERE user_id = ?1 AND kind = ?2 AND subject = ?3 ORDER BY segment, created_at LIMIT 1) AS id, (SELECT segment FROM briefings WHERE user_id = ?1 AND kind = ?2 AND subject = ?3 ORDER BY segment, created_at LIMIT 1) AS segment, (SELECT deliver FROM briefings WHERE user_id = ?1 AND kind = ?2 AND subject = ?3 ORDER BY segment, created_at LIMIT 1) AS deliver, (SELECT COUNT(*) FROM briefings WHERE user_id = ?1) + (SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1) AS n",
  ADD_WATCH: "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) SELECT ?1, ?2, ?3, ?4, ?10, ?5, ?6, 'daily', ?7, ?9 WHERE (SELECT COUNT(*) FROM watches w WHERE w.user_id = ?2 AND NOT (w.kind = 'organization' AND w.target IS (SELECT c.organization_id FROM org_claims c WHERE c.user_id = ?2))) < ?8 + (?3 = 'organization' AND ?4 IS (SELECT c.organization_id FROM org_claims c WHERE c.user_id = ?2)) ON CONFLICT (user_id, kind, target, segment) DO NOTHING",
  WATCH_MAIL_ROW: "INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'on', ?) ON CONFLICT (user_id) DO NOTHING",
  WATCH_STATE: "SELECT (SELECT id FROM watches WHERE user_id = ?1 AND kind = ?2 AND target = ?3 ORDER BY segment, created_at LIMIT 1) AS id, (SELECT segment FROM watches WHERE user_id = ?1 AND kind = ?2 AND target = ?3 ORDER BY segment, created_at LIMIT 1) AS segment, (SELECT COUNT(*) FROM watches w WHERE w.user_id = ?1 AND NOT (w.kind = 'organization' AND w.target IS (SELECT c.organization_id FROM org_claims c WHERE c.user_id = ?1))) AS n, (?2 = 'organization' AND ?3 IS (SELECT c.organization_id FROM org_claims c WHERE c.user_id = ?1)) AS free, (SELECT c.organization_id FROM org_claims c WHERE c.user_id = ?1) IS NOT NULL AS claimed, (SELECT mail FROM watch_mail WHERE user_id = ?1) AS mail",
  WATCH_COUNT: "SELECT (SELECT COUNT(*) FROM watches w WHERE w.user_id = ?1 AND NOT (w.kind = 'organization' AND w.target IS (SELECT c.organization_id FROM org_claims c WHERE c.user_id = ?1))) AS n, (SELECT mail FROM watch_mail WHERE user_id = ?1) AS mail, EXISTS (SELECT 1 FROM watches w WHERE w.user_id = ?1 AND w.kind = 'organization' AND w.target IS (SELECT c.organization_id FROM org_claims c WHERE c.user_id = ?1)) AS own",
  ADD_VIEW: "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'off', ?7 WHERE (SELECT COUNT(*) FROM saved_views WHERE user_id = ?2) < ?8 ON CONFLICT (user_id, address) DO NOTHING",
  CREATE_KEY: "INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT COUNT(*) FROM api_keys WHERE user_id = ?2 AND revoked_at IS NULL) < ?7 AND NOT EXISTS (SELECT 1 FROM api_keys WHERE user_id = ?2 AND revoked_at IS NULL AND name = ?3)",
  CREATE_FEED: "INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT COUNT(*) FROM feeds WHERE user_id = ?2 AND revoked_at IS NULL) < ?7 AND (?3 <> 'search' OR EXISTS (SELECT 1 FROM saved_searches WHERE id = ?4 AND user_id = ?2 AND kind = ?8)) ON CONFLICT DO NOTHING",
  BUG_STORE: "INSERT INTO bug_reports (id, user_id, page, text, expected, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT COUNT(*) FROM bug_reports WHERE user_id = ?2 AND created_at > ?7) < ?8 AND NOT EXISTS (SELECT 1 FROM bug_reports WHERE user_id = ?2 AND created_at > ?9 AND page IS ?3 AND text = ?4 AND expected IS ?5)",
  NEW_BOARD: "INSERT INTO dashboards (id, user_id, name, pos, created_at) SELECT ?1, ?2, '', (SELECT COALESCE(MAX(pos), -1) + 1 FROM dashboards WHERE user_id = ?2), ?3 WHERE (SELECT COUNT(*) FROM dashboards WHERE user_id = ?2) < ?4",
  BOARD_INSERT: "INSERT INTO dashboards (id, user_id, name, pos, created_at) SELECT ?1, ?2, '', 0, ?3 WHERE NOT EXISTS (SELECT 1 FROM dashboards WHERE user_id = ?2)",
  ADD_TILE: "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) SELECT ?1, d.id, ?2, ?3, ?4, '', ?5, ?6, ?7, ?8, ?9 FROM dashboards d WHERE d.id = COALESCE(?12, (SELECT id FROM dashboards WHERE user_id = ?2 ORDER BY pos, created_at, id LIMIT 1)) AND d.user_id = ?2 AND (SELECT COUNT(*) FROM dashboard_tiles WHERE dashboard_id = d.id) < ?10 AND (?3 <> 'briefing' OR (SELECT COUNT(*) FROM dashboard_tiles WHERE dashboard_id = d.id AND kind = 'briefing') < ?11) AND NOT EXISTS (SELECT 1 FROM dashboard_tiles WHERE dashboard_id = d.id AND kind = ?3 AND ref = ?4) ON CONFLICT DO NOTHING",
  ADD_TEXT: "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) SELECT ?1, d.id, ?2, ?3, ?4, ?13, ?5, ?6, ?7, ?8, ?9 FROM dashboards d WHERE d.id = COALESCE(?12, (SELECT id FROM dashboards WHERE user_id = ?2 ORDER BY pos, created_at, id LIMIT 1)) AND d.user_id = ?2 AND (SELECT COUNT(*) FROM dashboard_tiles WHERE dashboard_id = d.id) < ?10 AND (?3 <> 'briefing' OR (SELECT COUNT(*) FROM dashboard_tiles WHERE dashboard_id = d.id AND kind = 'briefing') < ?11) AND NOT EXISTS (SELECT 1 FROM dashboard_tiles WHERE dashboard_id = d.id AND kind = ?3 AND ref = ?4) ON CONFLICT DO NOTHING",
  MOVE_TO: "UPDATE dashboard_tiles SET dashboard_id = ?1, x = ?2, y = ?3, w = ?4, h = ?5 WHERE id = ?6 AND user_id = ?7 AND dashboard_id <> ?1 AND EXISTS (SELECT 1 FROM dashboards WHERE id = ?1 AND user_id = ?7) AND (SELECT COUNT(*) FROM dashboard_tiles WHERE dashboard_id = ?1) < ?8 AND (kind <> 'briefing' OR (SELECT COUNT(*) FROM dashboard_tiles WHERE dashboard_id = ?1 AND kind = 'briefing') < ?9) AND NOT EXISTS (SELECT 1 FROM dashboard_tiles o WHERE o.dashboard_id = ?1 AND o.kind = dashboard_tiles.kind AND o.ref = dashboard_tiles.ref)",
} as const;

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const NOW = new Date();
const iso = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
const hexId = () => crypto.randomUUID().replace(/-/g, "");
const ID = /^[0-9a-f]{32}$/;
const env = () => onEnv() as never;

// -- fixtures ------------------------------------------------------------------------------

type Person = { id: string; email: string; cookie: string };
// An account as the session read gives it to an insert: its id, its plan and its group (planFor).
type Who = { userId: string; email: string; plan: Plan; group?: Group };

// An account signed in through its code, so its pages and posts can be asked for.
async function person(tag: string): Promise<Person> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  return { id: await userId(email), email, cookie };
}

// A taken seat, joined `joined` days from now.
async function seat(holder: string, member: string, joined: number): Promise<void> {
  await ACCOUNTS.prepare(
    "INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id, joined_at) VALUES (?, ?, 'en', ?, ?, ?, ?)",
  ).bind(hexId(), holder, iso(joined - 1), iso(joined + 6), member, iso(joined)).run();
}

async function whoOf(p: Person): Promise<Who> {
  const row = await ACCOUNTS.prepare("SELECT id, plan, plan_until FROM users WHERE id = ?").bind(p.id).first<PlanHolder>();
  const s = await planFor(env(), row!);
  return { userId: p.id, email: p.email, plan: s.plan, ...(s.group ? { group: s.group } : {}) };
}

// A subscription of five: an Ultra holder and four members its plan covers, joined in this order.
type Five = { holder: Person; members: Person[]; all: Person[]; who: Who[] };
async function five(tag: string): Promise<Five> {
  const holder = await person(`${tag}-holder`);
  await grantUltra(holder.email);
  const members: Person[] = [];
  for (let i = 0; i < 4; i++) {
    members.push(await person(`${tag}-m${i + 1}`));
    await seat(holder.id, members[i].id, -40 + i);
  }
  const all = [holder, ...members];
  const who: Who[] = [];
  for (const p of all) who.push(await whoOf(p));
  const ids = all.map((p) => p.id);
  for (const [i, w] of who.entries()) {
    expect([w.plan, w.group], `${tag} ${i}`).toStrictEqual(["ultra", { holderId: holder.id, ids, position: i }]);
  }
  return { holder, members, all, who };
}

// An Ultra account alone, and an account holding a seat that gives no plan (its holder's Ultra ended):
// both in no group, the second with a seat row and a holder full of rows of its own.
async function alone(tag: string): Promise<Who> {
  const p = await person(tag);
  await grantUltra(p.email);
  return whoOf(p);
}
async function uncovered(tag: string): Promise<{ who: Who; holder: Person }> {
  const holder = await person(`${tag}-lapsed`);
  await grantUltra(holder.email, iso(-1));
  const p = await person(tag);
  await grantPro(p.email);
  await seat(holder.id, p.id, -30);
  const who = await whoOf(p);
  expect(who.plan).toBe("pro");
  return { who, holder };
}

const run = (stmts: D1PreparedStatement[]) => (stmts.length ? ACCOUNTS.batch(stmts) : Promise.resolve([]));
const many = (n: number, f: (i: number) => D1PreparedStatement) => run(Array.from({ length: n }, (_, i) => f(i)));
const tag = () => hexId().slice(0, 8);

const searchRows = (user: string, n: number, t = tag()) => many(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, 'Fixture', 'en', ?, 'off')",
).bind(hexId(), user, `/tenders?q=${t}-${i}`, iso(-20)));
const briefingRows = (user: string, n: number, t = tag()) => many(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'buyer', ?, '', 'Fixture', 'en', ?, 'off')",
).bind(hexId(), user, `fixture-${t}-${i}`, iso(-20)));
const watchRows = (user: string, n: number, t = tag()) => many(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at) VALUES (?, ?, 'buyer', ?, '', 'Fixture', 'award', 'daily', ?)",
).bind(hexId(), user, `fixture-${t}-${i}`, iso(-20)));
const orgWatch = (user: string, org: string) => ACCOUNTS.prepare(
  "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at) VALUES (?, ?, 'organization', ?, '', 'Fixture', 'award', 'daily', ?)",
).bind(hexId(), user, org, iso(-20)).run();
const claim = (user: string, org: string) => ACCOUNTS.prepare(
  "INSERT INTO org_claims (user_id, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
).bind(user, org, iso(-10), iso(-10)).run();
const viewRows = (user: string, n: number, t = tag()) => many(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, 'Fixture', 'en', 'off', ?)",
).bind(hexId(), user, `/buyers/fixture-${t}-${i}/analytics`, iso(-20)));
const boardRows = (user: string, n: number) => many(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', ?, ?)",
).bind(hexId(), user, i, iso(-20 + i)));
const keyRows = (user: string, names: string[], revoked: string | null = null) => many(names.length, (i) => ACCOUNTS.prepare(
  "INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at, revoked_at) VALUES (?, ?, ?, ?, 'abcd0123', ?, ?)",
).bind(hexId(), user, names[i], hexId(), iso(-20), revoked));
const feedRows = (user: string, kinds: ("watchlist" | "all")[]) => many(kinds.length, (i) => ACCOUNTS.prepare(
  "INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) VALUES (?, ?, ?, NULL, ?, ?)",
).bind(hexId(), user, kinds[i], hexId(), iso(-20)));
const bugRows = (user: string, n: number, hoursAgo = 2) => many(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO bug_reports (id, user_id, page, text, expected, created_at) VALUES (?, ?, NULL, ?, NULL, ?)",
).bind(hexId(), user, `fixture ${i}`, new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString()));

// How many rows of a table the accounts hold together.
async function held(table: string, users: string[], where = ""): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM ${table} WHERE user_id IN (${users.map(() => "?").join(", ")})${where ? ` AND ${where}` : ""}`;
  return (await ACCOUNTS.prepare(sql).bind(...users).first<{ n: number }>())!.n;
}

// The accounts database with every statement prepared on it written down with the values bound to it;
// a statement reading the table `missing` names answers as a database without that table does.
type Sent = { sql: string; binds: unknown[] };
function recording(missing?: string): { env: never; sent: Sent[] } {
  const sent: Sent[] = [];
  const native = new WeakMap<object, D1PreparedStatement>();
  const db = new Proxy(ACCOUNTS, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          const entry: Sent = { sql, binds: [] };
          sent.push(entry);
          const stmt = target.prepare(missing && sql.includes(`FROM ${missing}`) ? `SELECT x FROM no_such_table_${missing}` : sql);
          const wrapped = new Proxy(stmt, {
            get(s, p) {
              if (p === "bind") {
                return (...args: unknown[]) => {
                  entry.binds = args;
                  return s.bind(...args);
                };
              }
              const v = Reflect.get(s, p);
              return typeof v === "function" ? v.bind(s) : v;
            },
          });
          native.set(wrapped, stmt);
          return wrapped;
        };
      }
      if (prop === "batch") return (stmts: D1PreparedStatement[]) => target.batch(stmts.map((s) => native.get(s) ?? s));
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { env: onEnv({ ACCOUNTS: db }) as never, sent };
}
const sqls = (sent: Sent[]) => sent.map((s) => s.sql);

// The highest numbered place a statement binds: the count of values it takes.
const places = (sql: string) => Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));

const filterOf = (t: string) => ({ kind: "tenders" as const, params: `/tenders?q=${t}`, label: `Search ${t}` });

// =====================================================================================

describe("an account in no group", () => {
  it("keeps every statement's text word for word, and pooled() sends it with nothing more bound", () => {
    const pairs: [string, string][] = [
      [ADD_SEARCH_SQL, TODAY.ADD_SEARCH], [ADD_SEARCH_NO_BRIEFINGS_SQL, TODAY.ADD_SEARCH_NO_BRIEFINGS], [SEARCH_STATE_SQL, TODAY.SEARCH_STATE],
      [SEARCH_STATE_NO_BRIEFINGS_SQL, TODAY.SEARCH_STATE_NO_BRIEFINGS], [HELD_SQL, TODAY.HELD], [HELD_NO_BRIEFINGS_SQL, TODAY.HELD_NO_BRIEFINGS],
      [ADD_BRIEFING_SQL, TODAY.ADD_BRIEFING], [BRIEFING_STATE_SQL, TODAY.BRIEFING_STATE], [ADD_WATCH_SQL, TODAY.ADD_WATCH],
      [WATCH_STATE_SQL, TODAY.WATCH_STATE], [WATCH_COUNT_SQL, TODAY.WATCH_COUNT], [ADD_VIEW_SQL, TODAY.ADD_VIEW], [NEW_BOARD_SQL, TODAY.NEW_BOARD],
      [BOARD_INSERT_SQL, TODAY.BOARD_INSERT], [CREATE_KEY_SQL, TODAY.CREATE_KEY], [CREATE_FEED_SQL, TODAY.CREATE_FEED], [BUG_STORE_SQL, TODAY.BUG_STORE],
      [ADD_TILE_SQL, TODAY.ADD_TILE], [ADD_TEXT_SQL, TODAY.ADD_TEXT], [MOVE_TO_SQL, TODAY.MOVE_TO],
    ];
    for (const [code, today] of pairs) {
      expect(code).toBe(today);
      expect(pooled({}, code, "the group's form", ["a value"])).toStrictEqual({ sql: today, binds: [] });
      expect(pooled({ group: undefined }, code, "the group's form")).toStrictEqual({ sql: today, binds: [] });
    }
  });

  it("sends today's statements and only those, each with today's values, for an account alone and for one whose seat gives no plan", async () => {
    const one = await alone("ng-alone");
    const { who: two, holder: lapsed } = await uncovered("ng-uncovered");
    // The lapsed holder's rows are its own and never count for the account in its seat.
    await searchRows(lapsed.id, 30);
    for (const w of [one, two]) {
      expect(w.group, w.email).toBeUndefined();
      const cap = w.plan === "ultra" ? 100 : 25;
      const f = filterOf(tag());
      let r = recording();
      expect(await addSearch(r.env, w, f, "en")).toBe("added");
      expect(r.sent).toStrictEqual([{ sql: TODAY.ADD_SEARCH, binds: [expect.stringMatching(ID), w.userId, "tenders", f.params, f.label, "en", expect.any(String), cap] }]);
      r = recording("briefings");
      const g = filterOf(tag());
      expect(await addSearch(r.env, w, g, "en")).toBe("added");
      expect(sqls(r.sent)).toEqual([TODAY.ADD_SEARCH, TODAY.ADD_SEARCH_NO_BRIEFINGS]);
      expect(r.sent[1].binds).toStrictEqual(r.sent[0].binds);
      r = recording();
      await searchState(r.env, w, f);
      expect(r.sent).toStrictEqual([{ sql: TODAY.SEARCH_STATE, binds: [w.userId, "tenders", f.params] }]);
      r = recording("briefings");
      await searchState(r.env, w, f);
      expect(sqls(r.sent)).toEqual([TODAY.SEARCH_STATE, TODAY.SEARCH_STATE_NO_BRIEFINGS]);
      r = recording();
      await heldCount(r.env, w);
      expect(r.sent).toStrictEqual([{ sql: TODAY.HELD, binds: [w.userId] }]);
      r = recording("briefings");
      await heldCounts(r.env, w);
      expect(sqls(r.sent)).toEqual([TODAY.HELD, TODAY.HELD_NO_BRIEFINGS]);
      r = recording();
      const b = { kind: "segment" as const, subject: "81", segment: "", label: "81 Engineering" };
      expect(await addBriefing(r.env, w, b, "en")).toBe("added");
      expect(r.sent).toStrictEqual([{
        sql: TODAY.ADD_BRIEFING, binds: [expect.stringMatching(ID), w.userId, "segment", "81", "", "81 Engineering", "en", expect.any(String), "weekly", cap],
      }]);
      r = recording();
      await briefingState(r.env, w, "segment", "81");
      expect(r.sent).toStrictEqual([{ sql: TODAY.BRIEFING_STATE, binds: [w.userId, "segment", "81"] }]);
      r = recording();
      expect(await addWatch(r.env, w, { kind: "buyer", target: "dfo-mpo", segment: "", label: "DFO" }, "2026-01-02")).toBe("added");
      expect(sqls(r.sent)).toEqual([TODAY.ADD_WATCH, TODAY.WATCH_MAIL_ROW]);
      expect(r.sent[0].binds).toStrictEqual([expect.stringMatching(ID), w.userId, "buyer", "dfo-mpo", "DFO", expect.any(String), expect.any(String), cap, "2026-01-02", ""]);
      r = recording();
      await watchState(r.env, w, "buyer", "dfo-mpo");
      expect(r.sent).toStrictEqual([{ sql: TODAY.WATCH_STATE, binds: [w.userId, "buyer", "dfo-mpo"] }]);
      r = recording();
      await watchCount(r.env, w);
      expect(r.sent).toStrictEqual([{ sql: TODAY.WATCH_COUNT, binds: [w.userId] }]);
      r = recording();
      const address = `/buyers/dfo-mpo/analytics?source=awards&from=2020&to=2026&t=${tag()}`;
      expect(await addView(r.env, w, { kind: "buyer", address, name: "Fleet" }, "en")).toBe("added");
      expect(r.sent).toStrictEqual([{
        sql: TODAY.ADD_VIEW, binds: [expect.stringMatching(ID), w.userId, "buyer", address, "Fleet", "en", expect.any(String), w.plan === "ultra" ? 50 : 10],
      }]);
      r = recording();
      expect(await createKey(r.env, w, "Key one")).toMatchObject({ key: expect.any(String) });
      expect(r.sent).toStrictEqual([{
        sql: TODAY.CREATE_KEY, binds: [expect.stringMatching(ID), w.userId, "Key one", expect.any(String), expect.any(String), expect.any(String), KEYS_MAX],
      }]);
      r = recording();
      expect(await createFeed(r.env, w, "watchlist", null)).toBe("added");
      expect(r.sent).toStrictEqual([{
        sql: TODAY.CREATE_FEED, binds: [expect.stringMatching(ID), w.userId, "watchlist", null, expect.any(String), expect.any(String), FEEDS_MAX, "tenders"],
      }]);
    }
  });

  it("sends today's statements from the bug report and the dashboards' posts", async () => {
    const p = await person("ng-posts");
    await grantUltra(p.email);
    const token = await csrf(p.cookie, "/account/bug");
    let r = recording();
    expect((await post("/account/bug", { csrf: token, text: "Today's statement" }, { cookie: p.cookie, env: r.env })).status).toBe(200);
    expect(r.sent.filter((s) => s.sql.includes("bug_reports"))).toStrictEqual([{
      sql: TODAY.BUG_STORE,
      binds: [expect.stringMatching(ID), p.id, null, "Today's statement", null, expect.any(String), expect.any(String), BUG_REPORTS_PER_DAY, expect.any(String)],
    }]);
    // A new dashboard from none: the first written with the change, then the new one.
    r = recording();
    const res = await post("/account/dashboard/boards", { csrf: await csrf(p.cookie) }, { cookie: p.cookie, env: r.env });
    expect(res.status).toBe(303);
    expect(r.sent.filter((s) => s.sql.startsWith("INSERT INTO dashboards"))).toStrictEqual([
      { sql: TODAY.BOARD_INSERT, binds: [expect.stringMatching(ID), p.id, expect.any(String)] },
      { sql: TODAY.NEW_BOARD, binds: [expect.stringMatching(ID), p.id, expect.any(String), 5] },
    ]);
    expect(await held("dashboards", [p.id])).toBe(2);
  });

  it("answers what today's statements answer: the states from the same rows, each add at and under its figure", async () => {
    const w = await alone("ng-answers");
    const { who: u, holder: lapsed } = await uncovered("ng-answers-seat");
    await claim(w.userId, "org-c000000001");
    await orgWatch(w.userId, "org-c000000001");
    for (const x of [w, u]) {
      const f = filterOf(tag());
      await addSearch(env(), x, f, "en");
      await briefingRows(x.userId, 2);
      await watchRows(x.userId, 3);
      const s = (await ACCOUNTS.prepare(TODAY.SEARCH_STATE).bind(x.userId, f.kind, f.params)
        .first<{ saved: number; id: string | null; deliver: string | null; n: number }>())!;
      expect(await searchState(env(), x, f)).toStrictEqual({ saved: s.saved === 1, id: s.id, deliver: s.deliver, n: s.n });
      expect(await heldCount(env(), x)).toBe((await ACCOUNTS.prepare(TODAY.HELD).bind(x.userId).first<{ n: number }>())!.n);
      expect(await heldCounts(env(), x)).toStrictEqual({ n: 3 });
      const b = (await ACCOUNTS.prepare(TODAY.BRIEFING_STATE).bind(x.userId, "buyer", "none")
        .first<{ id: string | null; segment: string | null; deliver: string | null; n: number }>())!;
      expect(await briefingState(env(), x, "buyer", "none")).toStrictEqual({ id: b.id, segment: b.segment ?? "", deliver: null, n: b.n });
      const ws = (await ACCOUNTS.prepare(TODAY.WATCH_STATE).bind(x.userId, "organization", "org-c000000001")
        .first<{ id: string | null; segment: string | null; n: number; free: number; claimed: number; mail: string | null }>())!;
      expect(await watchState(env(), x, "organization", "org-c000000001")).toStrictEqual({
        id: ws.id, segment: ws.segment ?? "", n: ws.n, free: ws.free === 1, claimed: ws.claimed === 1, mailOff: ws.mail === "off",
      });
      const wc = (await ACCOUNTS.prepare(TODAY.WATCH_COUNT).bind(x.userId).first<{ n: number; own: number; mail: string | null }>())!;
      expect(await watchCount(env(), x)).toStrictEqual({ n: wc.n, own: wc.own === 1, mail: wc.mail });
    }
    // The claimed organization's watch stays beside the count, as it did.
    expect((await watchCount(env(), w))?.n).toBe(3);
    // Each figure at the account's own count: one under it adds, at it refuses; the lapsed holder's 200 rows count for nothing.
    await searchRows(lapsed.id, 100);
    await watchRows(lapsed.id, 100);
    await searchRows(u.userId, 25 - 3);
    expect(await addSearch(env(), u, filterOf(tag()), "en")).toBe("cap");
    await ACCOUNTS.prepare("DELETE FROM briefings WHERE user_id = ?").bind(u.userId).run();
    expect(await addSearch(env(), u, filterOf(tag()), "en")).toBe("added");
    expect(await addBriefing(env(), u, { kind: "segment", subject: "43", segment: "", label: "43" }, "en")).toBe("added");
    expect(await addBriefing(env(), u, { kind: "segment", subject: "44", segment: "", label: "44" }, "en")).toBe("cap");
    await watchRows(u.userId, 25 - 3 - 1);
    expect(await addWatch(env(), u, { kind: "buyer", target: "dnd-mdn", segment: "", label: "DND" }, null)).toBe("added");
    expect(await addWatch(env(), u, { kind: "buyer", target: "tc", segment: "", label: "TC" }, null)).toBe("cap");
    await viewRows(u.userId, 9);
    expect(await addView(env(), u, { kind: "buyer", address: `/buyers/tc/analytics?t=${tag()}`, name: "" }, "en")).toBe("added");
    expect(await addView(env(), u, { kind: "buyer", address: `/buyers/tc/analytics?t=${tag()}`, name: "" }, "en")).toBe("full");
    await keyRows(u.userId, ["k1", "k2", "k3"]);
    expect(await createKey(env(), u, "k4")).toMatchObject({ key: expect.any(String) });
    expect(await createKey(env(), u, "k4")).toBe("exists");
    expect(await createKey(env(), u, "k5")).toMatchObject({ key: expect.any(String) });
    expect(await createKey(env(), u, "k6")).toBe("limit");
    await feedRows(u.userId, ["watchlist", "all"]);
    const tenders = (await ACCOUNTS.prepare("SELECT id FROM saved_searches WHERE user_id = ? AND kind = 'tenders' LIMIT 3").bind(u.userId).all<{ id: string }>()).results;
    for (const s of tenders.slice(0, 3)) expect(await createFeed(env(), u, "search", s.id)).toBe("added");
    expect(await createFeed(env(), u, "search", tenders[0].id)).toBe("exists");
    await ACCOUNTS.prepare("UPDATE feeds SET revoked_at = ? WHERE user_id = ? AND kind = 'all'").bind(iso(0), u.userId).run();
    expect(await createFeed(env(), u, "search", (await ACCOUNTS.prepare("SELECT id FROM saved_searches WHERE user_id = ? ORDER BY id DESC LIMIT 1")
      .bind(lapsed.id).first<{ id: string }>())!.id)).toBe("missing");
    expect(await createFeed(env(), u, "all", null)).toBe("added");
    expect(await createFeed(env(), u, "search", tenders[0].id)).toBe("exists");
  });
});

// =====================================================================================

describe("a group of five, each figure the subscription's", () => {
  it("holds saved searches and briefings together at 100 over the group, a member's and the holder's adds alike, the import too", async () => {
    const g = await five("pool-searches");
    const [h, m1, m2, m3, m4] = g.who;
    await searchRows(h.userId, 40);
    await briefingRows(m1.userId, 30);
    await searchRows(m2.userId, 29);
    const ids = g.all.map((p) => p.id);
    expect(await held("saved_searches", ids) + await held("briefings", ids)).toBe(99);
    // The states: the group's total, the account's own beside it.
    expect(await heldCounts(env(), m1)).toStrictEqual({ n: 99, mine: 30 });
    expect(await heldCount(env(), m1)).toBe(99);
    expect(await heldCounts(env(), h)).toStrictEqual({ n: 99, mine: 40 });
    const f = filterOf(tag());
    expect(await searchState(env(), m3, f)).toStrictEqual({ saved: false, id: null, deliver: null, n: 99, mine: 0 });
    expect(await briefingState(env(), m1, "segment", "81")).toStrictEqual({ id: null, segment: "", deliver: null, n: 99, mine: 30 });
    // The hundredth, from a member with nothing of its own.
    const r = recording();
    expect(await addSearch(r.env, m3, f, "en")).toBe("added");
    expect(r.sent).toStrictEqual([{
      sql: ADD_SEARCH_GROUP_SQL, binds: [expect.stringMatching(ID), m3.userId, "tenders", f.params, f.label, "en", expect.any(String), 100, ...groupIds(m3.group!)],
    }]);
    expect(await searchState(env(), m3, f)).toMatchObject({ saved: true, n: 100, mine: 1 });
    // Full for everyone in the group, the holder included, by either insert and the import.
    expect(await addSearch(env(), m4, filterOf(tag()), "en")).toBe("cap");
    expect(await addSearch(env(), h, filterOf(tag()), "en")).toBe("cap");
    expect(await addBriefing(env(), m4, { kind: "segment", subject: "81", segment: "", label: "81" }, "en")).toBe("cap");
    expect(await addBriefing(env(), h, { kind: "segment", subject: "81", segment: "", label: "81" }, "en")).toBe("cap");
    expect((await post("/interest", { email: m4.email, kind: "segment", params: "/segments/82", lang: "en", website: "" })).status).toBe(200);
    expect(await importInterest(env(), m4)).toEqual({ imported: 0, left: 1 });
    // The same filter is each account's own: m3 holds it already, m4 is refused for the pool.
    expect(await addSearch(env(), m3, f, "en")).toBe("exists");
    expect(await addSearch(env(), m4, f, "en")).toBe("cap");
    await ACCOUNTS.prepare("DELETE FROM saved_searches WHERE user_id = ? AND id IN (SELECT id FROM saved_searches WHERE user_id = ? LIMIT 2)").bind(h.userId, h.userId).run();
    expect(await addSearch(env(), m4, f, "en")).toBe("added");
    expect(await addSearch(env(), m3, f, "en")).toBe("exists");
    expect(await importInterest(env(), m4)).toEqual({ imported: 1, left: 0 });
    expect(await addBriefing(env(), m2, { kind: "segment", subject: "81", segment: "", label: "81" }, "en")).toBe("cap");
    expect(await held("saved_searches", ids) + await held("briefings", ids)).toBe(100);
    // While the briefings table is missing, the group's searches alone, through the fallback's own twin.
    await ACCOUNTS.prepare("DELETE FROM briefings WHERE user_id = ?").bind(m1.userId).run();
    const fb = recording("briefings");
    expect(await addSearch(fb.env, m1, filterOf(tag()), "en")).toBe("added");
    expect(sqls(fb.sent)).toEqual([ADD_SEARCH_GROUP_SQL, ADD_SEARCH_NO_BRIEFINGS_GROUP_SQL]);
    expect(fb.sent[1].binds).toStrictEqual(fb.sent[0].binds);
    const fs = recording("briefings");
    expect(await heldCounts(fs.env, m1)).toStrictEqual({ n: 71, mine: 1 });
    expect(sqls(fs.sent)).toEqual([HELD_GROUP_SQL, HELD_NO_BRIEFINGS_GROUP_SQL]);
    const ss = recording("briefings");
    expect(await searchState(ss.env, m1, f)).toStrictEqual({ saved: false, id: null, deliver: null, n: 71, mine: 1 });
    expect(sqls(ss.sent)).toEqual([SEARCH_STATE_GROUP_SQL, SEARCH_STATE_NO_BRIEFINGS_GROUP_SQL]);
  });

  it("holds watches at 100 over the group, each person's claimed organization's watch beside the pool, read per row", async () => {
    const g = await five("pool-watches");
    const [h, m1, m2, m3, m4] = g.who;
    const [ORG_H, ORG_M1, ORG_M4] = ["org-d000000001", "org-d000000002", "org-d000000004"];
    await claim(h.userId, ORG_H);
    await orgWatch(h.userId, ORG_H);
    await watchRows(h.userId, 40);
    await claim(m1.userId, ORG_M1);
    await orgWatch(m1.userId, ORG_M1);
    await watchRows(m1.userId, 30);
    // m2 follows m1's claimed organization: m1's claim is m1's, so m2's watch counts.
    await orgWatch(m2.userId, ORG_M1);
    await watchRows(m2.userId, 28);
    expect(await watchCount(env(), h)).toStrictEqual({ n: 99, own: true, mail: null, mine: 40 });
    expect(await watchCount(env(), m2)).toStrictEqual({ n: 99, own: false, mail: null, mine: 29 });
    expect(await watchState(env(), m1, "organization", ORG_M1)).toMatchObject({ n: 99, mine: 30, free: true, claimed: true });
    const r = recording();
    expect(await addWatch(r.env, m3, { kind: "buyer", target: "dfo-mpo", segment: "", label: "DFO" }, null)).toBe("added");
    expect(r.sent[0]).toStrictEqual({
      sql: ADD_WATCH_GROUP_SQL,
      binds: [expect.stringMatching(ID), m3.userId, "buyer", "dfo-mpo", "DFO", expect.any(String), expect.any(String), 100, null, "", ...groupIds(m3.group!)],
    });
    expect(r.sent[1].sql).toBe(TODAY.WATCH_MAIL_ROW);
    for (const w of [m4, h, m1]) expect(await addWatch(env(), w, { kind: "buyer", target: "tc", segment: "", label: "TC" }, null), w.email).toBe("cap");
    expect((await watchState(env(), m4, "buyer", "tc")).n).toBe(100);
    // A member's own claimed organization: one place more, at the full pool, and it stays beside it.
    await claim(m4.userId, ORG_M4);
    expect(await addWatch(env(), m4, { kind: "organization", target: ORG_M4, segment: "", label: "Own" }, null)).toBe("added");
    expect(await watchCount(env(), m4)).toStrictEqual({ n: 100, own: true, mail: "on", mine: 0 });
    // Another member's claimed organization is no place more for anyone else.
    expect(await addWatch(env(), m3, { kind: "organization", target: ORG_M4, segment: "", label: "Not mine" }, null)).toBe("cap");
    expect(await addWatch(env(), m4, { kind: "organization", target: "org-d000000009", segment: "", label: "Unclaimed" }, null)).toBe("cap");
    expect(await held("watches", g.all.map((p) => p.id))).toBe(103);
  });

  it("holds saved views at 50, dashboards at 5, keys at 5 and calendar feeds at 5 over the group, for a member and the holder alike", async () => {
    const g = await five("pool-figures");
    const [h, m1, m2, m3, m4] = g.who;
    const ids = g.all.map((p) => p.id);
    // Saved views: 49 held.
    await viewRows(h.userId, 20);
    await viewRows(m1.userId, 20);
    await viewRows(m2.userId, 9);
    const view = () => ({ kind: "buyer" as const, address: `/buyers/tc/analytics?t=${tag()}`, name: "" });
    const rv = recording();
    expect(await addView(rv.env, m3, view(), "en")).toBe("added");
    expect(rv.sent[0].sql).toBe(ADD_VIEW_GROUP_SQL);
    expect(rv.sent[0].binds.slice(-POOL_SLOTS)).toStrictEqual(groupIds(m3.group!));
    expect(await addView(env(), m4, view(), "en")).toBe("full");
    expect(await addView(env(), h, view(), "en")).toBe("full");
    expect(await held("saved_views", ids)).toBe(50);
    // API keys: 3 live (a revoked one counts for nothing); names are each person's own.
    await keyRows(h.userId, ["Shared name", "h2"]);
    await keyRows(h.userId, ["revoked"], iso(-1));
    await keyRows(m1.userId, ["m1"]);
    const rk = recording();
    expect(await createKey(rk.env, m2, "Shared name")).toMatchObject({ key: expect.any(String) });
    expect(rk.sent[0].sql).toBe(CREATE_KEY_GROUP_SQL);
    expect(rk.sent[0].binds.slice(-POOL_SLOTS)).toStrictEqual(groupIds(m2.group!));
    expect(await createKey(env(), m2, "Shared name")).toBe("exists");
    expect(await createKey(env(), m3, "m3")).toMatchObject({ key: expect.any(String) });
    expect(await createKey(env(), m4, "m4")).toBe("limit");
    expect(await createKey(env(), h, "h3")).toBe("limit");
    // The same name as another person's key at a full pool is the limit, not "exists".
    expect(await createKey(env(), m4, "Shared name")).toBe("limit");
    expect(await held("api_keys", ids, "revoked_at IS NULL")).toBe(5);
    // Calendar feeds: 4 live; a search's feed needs the account's own search.
    await feedRows(h.userId, ["watchlist", "all"]);
    await feedRows(m1.userId, ["watchlist", "all"]);
    const rf = recording();
    expect(await createFeed(rf.env, m2, "watchlist", null)).toBe("added");
    expect(rf.sent[0].sql).toBe(CREATE_FEED_GROUP_SQL);
    expect(rf.sent[0].binds.slice(-POOL_SLOTS)).toStrictEqual(groupIds(m2.group!));
    expect(await createFeed(env(), m3, "watchlist", null)).toBe("cap");
    expect(await createFeed(env(), h, "watchlist", null)).toBe("exists");
    await ACCOUNTS.prepare("UPDATE feeds SET revoked_at = ? WHERE user_id = ? AND kind = 'all'").bind(iso(0), m1.userId).run();
    await searchRows(h.userId, 1);
    const hs = (await ACCOUNTS.prepare("SELECT id FROM saved_searches WHERE user_id = ?").bind(h.userId).first<{ id: string }>())!.id;
    expect(await createFeed(env(), m3, "search", hs)).toBe("missing");
    expect(await createFeed(env(), m3, "all", null)).toBe("added");
    expect(await createFeed(env(), h, "search", hs)).toBe("cap");
    expect(await held("feeds", ids, "revoked_at IS NULL")).toBe(5);
    // Dashboards: 4 held; a new one from a member with one, then full for the holder too.
    await boardRows(h.userId, 3);
    await boardRows(m1.userId, 1);
    const token = await csrf(g.members[0].cookie);
    const made = await post("/account/dashboard/boards", { csrf: token }, { cookie: g.members[0].cookie });
    expect(made.headers.get("location")).toMatch(/^\/account\/dashboard\/[0-9a-f]{32}$/);
    const full = await post("/account/dashboard/boards", { csrf: await csrf(g.holder.cookie) }, { cookie: g.holder.cookie });
    expect(full.headers.get("location")).toMatch(/^\/account\/dashboard(\/[0-9a-f]{32})?\?m=boards_full$/);
    expect(await held("dashboards", ids)).toBe(5);
    expect(await held("dashboards", [m1.userId])).toBe(2);
  });

  it("refuses a member's first dashboard when the group holds 5, with the line the page has, and keeps nothing of the change", async () => {
    const g = await five("pool-first");
    const [h, , , m3] = g.who;
    await boardRows(h.userId, 5);
    const m = g.members[2];
    const token = await csrf(m.cookie);
    const r = recording();
    const add = await post("/account/dashboard/panels", { csrf: token, kind: "radar", ref: "6m" }, { cookie: m.cookie, env: r.env });
    expect(add.headers.get("location")).toBe("/account/dashboard?m=boards_full");
    const first = r.sent.find((s) => s.sql.startsWith("INSERT INTO dashboards"))!;
    expect(first).toStrictEqual({ sql: BOARD_INSERT_GROUP_SQL, binds: [expect.stringMatching(ID), m3.userId, expect.any(String), 5, ...groupIds(m3.group!)] });
    for (const [path, fields] of [
      ["/account/dashboard/boards", {}], ["/account/dashboard/tiles/s0/move", { dir: "down" }], ["/account/dashboard/tiles/s1/delete", {}],
      ["/account/dashboard/boards/first/rename", { name: "Mine" }],
    ] as [string, Record<string, string>][]) {
      expect((await post(path, { csrf: token, ...fields }, { cookie: m.cookie })).headers.get("location"), path).toMatch(/^\/account\/dashboard\?m=boards_full/);
    }
    const layout = await post("/account/dashboard/layout", { csrf: token, layout: "[]" }, { cookie: m.cookie });
    expect(await layout.json()).toEqual({ state: "unsaved" });
    expect(await held("dashboards", [m3.userId])).toBe(0);
    expect(await held("dashboard_tiles", [m3.userId])).toBe(0);
    const page = nbsp(decode(await (await get("/account/dashboard?m=boards_full", { cookie: m.cookie })).text()));
    expect(page).toContain("The account holds its 5 dashboards. Delete one to make another.");
    expect(page).not.toContain(EM_DASH);
    expect(page).not.toContain(EN_DASH);
    // One dashboard deleted makes room: the member's first change writes its first.
    await ACCOUNTS.prepare("DELETE FROM dashboards WHERE id = (SELECT id FROM dashboards WHERE user_id = ? LIMIT 1)").bind(h.userId).run();
    const again = await post("/account/dashboard/panels", { csrf: token, kind: "radar", ref: "6m" }, { cookie: m.cookie });
    expect(again.headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    expect(await held("dashboards", [m3.userId])).toBe(1);
  });

  it("leaves tiles a dashboard's own: a member's dashboard takes tiles while the holder's is full", async () => {
    expect(ADD_TILE_SQL).not.toMatch(/ IN \(/);
    expect(MOVE_TO_SQL).not.toMatch(/ IN \(/);
    const g = await five("pool-tiles");
    const [h, m1] = g.who;
    await boardRows(h.userId, 1);
    const board = (await ACCOUNTS.prepare("SELECT id FROM dashboards WHERE user_id = ?").bind(h.userId).first<{ id: string }>())!.id;
    await many(24, (i) => ACCOUNTS.prepare(
      "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, 'text', ?, '', 0, ?, 6, 2, ?)",
    ).bind(hexId(), board, h.userId, hexId(), i * 2, iso(-1)));
    const token = await csrf(g.members[0].cookie);
    const add = await post("/account/dashboard/panels", { csrf: token, kind: "radar", ref: "6m" }, { cookie: g.members[0].cookie });
    expect(add.headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    expect(await held("dashboard_tiles", [m1.userId])).toBeGreaterThan(0);
    const full = await post("/account/dashboard/panels", { csrf: await csrf(g.holder.cookie), kind: "radar", ref: "6m" }, { cookie: g.holder.cookie });
    expect(full.headers.get("location")).toBe("/account/dashboard?m=full");
  });

  it("counts the day's bug reports over the group, and a repeat as the account's own", async () => {
    const g = await five("pool-bugs");
    const [h, m1, m2, m3] = g.who;
    await bugRows(h.userId, 2);
    await bugRows(m1.userId, 1);
    // Older than a day: counted for nobody.
    await bugRows(m3.userId, 4, 30);
    const send = async (i: number, text: string) => {
      const p = g.all[i];
      return post("/account/bug", { csrf: await csrf(p.cookie, "/account/bug"), text }, { cookie: p.cookie });
    };
    const r = recording();
    const p2 = g.all[2];
    expect((await post("/account/bug", { csrf: await csrf(p2.cookie, "/account/bug"), text: "Same words" }, { cookie: p2.cookie, env: r.env })).status).toBe(200);
    expect(r.sent.filter((s) => s.sql.includes("bug_reports"))).toStrictEqual([{
      sql: BUG_STORE_GROUP_SQL,
      binds: [expect.stringMatching(ID), m2.userId, null, "Same words", null, expect.any(String), expect.any(String), BUG_REPORTS_PER_DAY, expect.any(String),
        ...groupIds(m2.group!)],
    }]);
    // The same report from another person is that person's own: stored, the fifth of the day.
    expect((await send(1, "Same words")).status).toBe(200);
    // m2's own repeat is the repeat it was: answered as sent, nothing stored.
    expect((await send(2, "Same words")).status).toBe(200);
    expect((await send(3, "Something else")).status).toBe(429);
    expect((await send(0, "The holder's")).status).toBe(429);
    const day = new Date(NOW.getTime() - 86_400_000).toISOString();
    expect(await held("bug_reports", g.all.map((p) => p.id), `created_at > '${day}'`)).toBe(BUG_REPORTS_PER_DAY);
    expect(await held("bug_reports", [m2.userId])).toBe(1);
  });

  it("leaves the group at its figure when two members add at once, for each figure", async () => {
    const g = await five("pool-race");
    const [h, m1, m2, m3, m4] = g.who;
    const ids = g.all.map((p) => p.id);
    const both = async (a: Promise<unknown>, b: Promise<unknown>) => (await Promise.all([a, b])).map((x) => (typeof x === "object" ? "added" : x)).sort();
    await searchRows(h.userId, 99);
    expect(await both(addSearch(env(), m1, filterOf(tag()), "en"), addSearch(env(), m2, filterOf(tag()), "en"))).toEqual(["added", "cap"]);
    expect(await held("saved_searches", ids)).toBe(100);
    await ACCOUNTS.prepare("DELETE FROM saved_searches WHERE id IN (SELECT id FROM saved_searches WHERE user_id = ? LIMIT 1)").bind(h.userId).run();
    expect(await both(
      addBriefing(env(), m3, { kind: "segment", subject: "81", segment: "", label: "81" }, "en"), addSearch(env(), m4, filterOf(tag()), "en"),
    )).toEqual(["added", "cap"]);
    expect(await held("saved_searches", ids) + await held("briefings", ids)).toBe(100);
    await watchRows(m1.userId, 99);
    expect(await both(
      addWatch(env(), m2, { kind: "buyer", target: "tc", segment: "", label: "TC" }, null), addWatch(env(), m3, { kind: "buyer", target: "tc", segment: "", label: "TC" }, null),
    )).toEqual(["added", "cap"]);
    expect(await held("watches", ids)).toBe(100);
    await viewRows(m4.userId, 49);
    const view = () => ({ kind: "buyer" as const, address: `/buyers/tc/analytics?t=${tag()}`, name: "" });
    expect(await both(addView(env(), m1, view(), "en"), addView(env(), h, view(), "en"))).toEqual(["added", "full"]);
    expect(await held("saved_views", ids)).toBe(50);
    await keyRows(h.userId, ["a", "b", "c", "d"]);
    expect(await both(createKey(env(), m1, "x"), createKey(env(), m2, "y"))).toEqual(["added", "limit"]);
    expect(await held("api_keys", ids, "revoked_at IS NULL")).toBe(5);
    await feedRows(h.userId, ["watchlist", "all"]);
    await feedRows(m1.userId, ["watchlist", "all"]);
    expect(await both(createFeed(env(), m2, "watchlist", null), createFeed(env(), m3, "watchlist", null))).toEqual(["added", "cap"]);
    expect(await held("feeds", ids, "revoked_at IS NULL")).toBe(5);
    // Two members holding a dashboard each, the holder two: a new one each at once, and one of them passes.
    await boardRows(h.userId, 2);
    await boardRows(m2.userId, 1);
    await boardRows(m3.userId, 1);
    const tokens = await Promise.all([g.members[1], g.members[2]].map((p) => csrf(p.cookie)));
    const boards = await Promise.all([g.members[1], g.members[2]].map(async (p, i) =>
      (await post("/account/dashboard/boards", { csrf: tokens[i] }, { cookie: p.cookie })).headers.get("location") ?? ""));
    expect(boards.filter((l) => /\?m=boards_full$/.test(l))).toHaveLength(1);
    expect(boards.filter((l) => /^\/account\/dashboard\/[0-9a-f]{32}$/.test(l))).toHaveLength(1);
    expect(await held("dashboards", ids)).toBe(5);
    await bugRows(h.userId, 4);
    const bugs = await Promise.all([g.members[2], g.members[3]].map(async (p) =>
      (await post("/account/bug", { csrf: await csrf(p.cookie, "/account/bug"), text: "At once" }, { cookie: p.cookie })).status));
    expect(bugs.sort()).toEqual([200, 429]);
    expect(await held("bug_reports", ids)).toBe(5);
  });
});

// =====================================================================================

// One office's limiter, and a counting one that keeps every key it is asked about.
function counting(limit: number) {
  const keys: string[] = [];
  const limiter = {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: keys.filter((k) => k === key).length <= limit };
    },
  } as unknown as RateLimit;
  return { keys, limiter };
}
const ICS = "/tenders/cb-200-20005019.ics";

describe("the download limiter", () => {
  it("counts every download of the group under the holder's key, 30 a minute together, and an account alone under its own", async () => {
    const g = await five("pool-downloads");
    const lone = await person("pool-downloads-alone");
    await grantUltra(lone.email);
    const account = counting(30);
    const address = counting(10);
    const e = onEnv({ PAID_DOWNLOAD_LIMIT: account.limiter, DOWNLOAD_LIMIT: address.limiter });
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++) {
      const p = g.all[i % 5];
      statuses.push((await get(ICS, { cookie: p.cookie, env: e })).status);
    }
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect((await get(ICS, { cookie: g.members[3].cookie, env: e })).status).toBe(429);
    expect(account.keys).toEqual(Array(31).fill(`account:${g.holder.id}`));
    expect((await get(ICS, { cookie: lone.cookie, env: e })).status).toBe(200);
    expect(account.keys.at(-1)).toBe(`account:${lone.id}`);
    expect(address.keys).toEqual([]);
  });
});

// =====================================================================================

// Each group's form: its statement, the first of its group's places, and the tables its pooled counts read.
const TWINS: { name: string; today: string; twin: string; first: number; only?: number; tables: string[] }[] = [
  { name: "addSearch", today: TODAY.ADD_SEARCH, twin: ADD_SEARCH_GROUP_SQL, first: 9, tables: ["saved_searches", "briefings"] },
  { name: "addSearch alone", today: TODAY.ADD_SEARCH_NO_BRIEFINGS, twin: ADD_SEARCH_NO_BRIEFINGS_GROUP_SQL, first: 9, tables: ["saved_searches"] },
  { name: "searchState", today: TODAY.SEARCH_STATE, twin: SEARCH_STATE_GROUP_SQL, first: 4, tables: ["saved_searches", "briefings"] },
  { name: "searchState alone", today: TODAY.SEARCH_STATE_NO_BRIEFINGS, twin: SEARCH_STATE_NO_BRIEFINGS_GROUP_SQL, first: 4, tables: ["saved_searches"] },
  { name: "heldCount", today: TODAY.HELD, twin: HELD_GROUP_SQL, first: 2, tables: ["saved_searches", "briefings"] },
  { name: "heldCount alone", today: TODAY.HELD_NO_BRIEFINGS, twin: HELD_NO_BRIEFINGS_GROUP_SQL, first: 2, tables: ["saved_searches"] },
  { name: "addBriefing", today: TODAY.ADD_BRIEFING, twin: ADD_BRIEFING_GROUP_SQL, first: 11, tables: ["saved_searches", "briefings"] },
  { name: "briefingState", today: TODAY.BRIEFING_STATE, twin: BRIEFING_STATE_GROUP_SQL, first: 4, tables: ["briefings", "saved_searches"] },
  { name: "addWatch", today: TODAY.ADD_WATCH, twin: ADD_WATCH_GROUP_SQL, first: 11, tables: ["w"] },
  { name: "watchState", today: TODAY.WATCH_STATE, twin: WATCH_STATE_GROUP_SQL, first: 4, tables: ["w"] },
  { name: "watchCount", today: TODAY.WATCH_COUNT, twin: WATCH_COUNT_GROUP_SQL, first: 2, tables: ["w"] },
  { name: "addView", today: TODAY.ADD_VIEW, twin: ADD_VIEW_GROUP_SQL, first: 9, tables: ["saved_views"] },
  { name: "new dashboard", today: TODAY.NEW_BOARD, twin: NEW_BOARD_GROUP_SQL, first: 5, tables: ["dashboards"] },
  { name: "first dashboard", today: TODAY.BOARD_INSERT, twin: BOARD_INSERT_GROUP_SQL, first: 5, only: 1, tables: ["dashboards"] },
  { name: "createKey", today: TODAY.CREATE_KEY, twin: CREATE_KEY_GROUP_SQL, first: 8, tables: ["api_keys"] },
  { name: "createFeed", today: TODAY.CREATE_FEED, twin: CREATE_FEED_GROUP_SQL, first: 9, tables: ["feeds"] },
  { name: "bug report", today: TODAY.BUG_STORE, twin: BUG_STORE_GROUP_SQL, first: 10, tables: ["bug_reports"] },
];

describe("the group's statements", () => {
  it("are today's with only the pooled counts read over the group's places, after today's own, and bind at most 100 values", () => {
    expect(POOL_SLOTS).toBe(5);
    for (const t of TWINS) {
      // Today's own places, then any value only the twin reads, then the group's five.
      expect(places(t.today), t.name).toBe(t.first - 1 - (t.only ?? 0));
      expect(places(t.twin), t.name).toBe(t.first + POOL_SLOTS - 1);
      expect(places(t.twin), t.name).toBeLessThanOrEqual(100);
      const list = `(${Array.from({ length: POOL_SLOTS }, (_, i) => `?${t.first + i}`).join(", ")})`;
      // Every place of the group is inside a COUNT over a table's user_id, and nowhere else.
      const uses = t.twin.split(list).length - 1;
      expect(uses, t.name).toBeGreaterThan(0);
      const counted = [...t.twin.matchAll(/SELECT COUNT\(\*\) FROM (\w+)(?: (\w+))? WHERE (?:\w+\.)?user_id IN (\([^)]*\))/g)];
      expect(counted.map((m) => m[3]), t.name).toEqual(Array(uses).fill(list));
      expect(counted.map((m) => m[2] ?? m[1]).sort(), t.name).toEqual([...t.tables].sort());
      // The twin is today's statement with the pooled counts read over the group and, for a state, the
      // account's own count beside them: put the account's own id back in those places, drop the column
      // beside, and today's statement remains, word for word.
      const own = t.twin.startsWith("SELECT") ? "?1" : "?2";
      let back = t.twin.split(`user_id IN ${list}`).join(`user_id = ${own}`).split("c.user_id = w.user_id").join(`c.user_id = ${own}`);
      const mine = back.indexOf(" AS mine");
      if (mine >= 0) {
        const from = back.lastIndexOf(" AS n, ", mine) + " AS n, ".length;
        const column = back.slice(from, mine);
        expect(back, t.name).toContain(`${column} AS n, ${column} AS mine`);
        back = back.replace(`, ${column} AS mine`, "");
      }
      if (t.only) back = back.replace(` AND (SELECT COUNT(*) FROM dashboards WHERE user_id = ${own}) < ?4`, "");
      expect(back, t.name).toBe(t.today);
    }
  });

  it("read each pooled count through the table's user_id index, with three of the five ids NULL", async () => {
    for (const t of TWINS) {
      const binds: unknown[] = Array.from({ length: places(t.twin) }, (_, i) => `v${i + 1}`);
      binds.splice(t.first - 1, POOL_SLOTS, hexId(), hexId(), null, null, null);
      const steps = ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${t.twin}`).bind(...binds).all<{ detail: string }>()).results ?? []).map((r) => r.detail);
      for (const table of t.tables) {
        expect(steps.some((d) => new RegExp(`^SEARCH ${table} USING (?:COVERING )?INDEX \\w+ \\(user_id=\\?`).test(d)), `${t.name} ${table}: ${steps.join(" | ")}`)
          .toBe(true);
      }
      // No table read whole (an insert's SELECT of bound values alone reads one constant row).
      expect(steps.filter((d) => /^SCAN (?!CONSTANT ROW)/.test(d)), t.name).toEqual([]);
    }
  });

  it("bind the session's ids alone: the account's at its own place and the group's after, never more than 100 values in a group's run", async () => {
    const g = await five("pool-binds");
    const w = g.who[3];
    const r = recording();
    const f = filterOf(tag());
    await addSearch(r.env, w, f, "en");
    await searchState(r.env, w, f);
    await heldCounts(r.env, w);
    await addBriefing(r.env, w, { kind: "segment", subject: "81", segment: "", label: "81" }, "en");
    await briefingState(r.env, w, "segment", "81");
    await addWatch(r.env, w, { kind: "buyer", target: "tc", segment: "", label: "TC" }, null);
    await watchState(r.env, w, "buyer", "tc");
    await watchCount(r.env, w);
    await addView(r.env, w, { kind: "buyer", address: `/buyers/tc/analytics?t=${tag()}`, name: "" }, "en");
    await createKey(r.env, w, "k");
    await createFeed(r.env, w, "watchlist", null);
    const twins = r.sent.filter((s) => TWINS.some((t) => t.twin === s.sql));
    expect(twins).toHaveLength(11);
    for (const s of r.sent) expect(s.binds.length).toBeLessThanOrEqual(100);
    for (const s of twins) {
      const t = TWINS.find((x) => x.twin === s.sql)!;
      expect(s.binds, t.name).toHaveLength(places(t.twin));
      expect(s.binds.slice(t.first - 1), t.name).toStrictEqual([...w.group!.ids]);
      expect(s.binds[s.sql.startsWith("SELECT") ? 0 : 1], t.name).toBe(w.userId);
    }
  });

  it("return nothing of another account: the states' rows hold the group's counts and the account's own, nothing else", async () => {
    const g = await five("pool-private");
    const [h, m1] = g.who;
    await searchRows(h.userId, 3);
    await claim(h.userId, "org-e000000001");
    await orgWatch(h.userId, "org-e000000001");
    await watchRows(h.userId, 2);
    const f = filterOf(tag());
    const binds = [m1.userId, f.kind, f.params, ...groupIds(m1.group!)];
    const keys = async (sql: string, b: unknown[]) => Object.keys((await ACCOUNTS.prepare(sql).bind(...b).first<Record<string, unknown>>())!).sort();
    expect(await keys(SEARCH_STATE_GROUP_SQL, binds)).toEqual(["deliver", "id", "mine", "n", "saved"]);
    expect(await keys(HELD_GROUP_SQL, [m1.userId, ...groupIds(m1.group!)])).toEqual(["mine", "n"]);
    expect(await keys(BRIEFING_STATE_GROUP_SQL, [m1.userId, "segment", "81", ...groupIds(m1.group!)])).toEqual(["deliver", "id", "mine", "n", "segment"]);
    expect(await keys(WATCH_STATE_GROUP_SQL, [m1.userId, "organization", "org-e000000001", ...groupIds(m1.group!)]))
      .toEqual(["claimed", "free", "id", "mail", "mine", "n", "segment"]);
    expect(await keys(WATCH_COUNT_GROUP_SQL, [m1.userId, ...groupIds(m1.group!)])).toEqual(["mail", "mine", "n", "own"]);
    // m1 reads the holder's watch of its own claimed organization as nothing of m1's.
    expect(await watchState(env(), m1, "organization", "org-e000000001")).toStrictEqual({
      id: null, segment: "", n: 2, free: false, claimed: false, mailOff: false, mine: 0,
    });
    expect(await searchState(env(), m1, { kind: "tenders", params: "/tenders?q=none" })).toStrictEqual({ saved: false, id: null, deliver: null, n: 3, mine: 0 });
  });
});
