// Fixtures for test/seats-rest.test.ts (seats, the pool's places left after slice P2: the weekly email, the
// dashboard's tiles, the "all" calendar feed, the analytics index's Saved Views panel, the keys page's status).
// Accounts are written at fixed ids and times, as test/seats-service.test.ts writes them, so a page's bytes and
// the statements it sends are the same on every run: test/seats-rest-today.ts holds what main sent and drew for
// an account in no group with these same fixtures, captured before the change and never rebuilt from the code
// under test.
import { env as testBindings } from "cloudflare:test";
import { app } from "../src/index";
import { STYLES_VERSION } from "../src/layout";
import { ACCOUNTS, PRO_SALE, ULTRA_VARS, nextIp, onEnv } from "./accounts-helpers";
import { applySql } from "./setup";

export const DAY = "2026-10-31";
export const hexOf = (tag: number, n: number) => `${tag.toString(16).padStart(8, "0")}${n.toString(16).padStart(24, "0")}`;
export const at = (day: number, i = 0) => `2026-01-${String(day).padStart(2, "0")}T00:00:${String(i).padStart(2, "0")}.000Z`;
export const sale = (extra: Record<string, unknown> = {}) => onEnv({ ...PRO_SALE, ...ULTRA_VARS, ...extra });

// A database binding with every statement prepared on it written down, in order.
export function recording(base: D1Database): { db: D1Database; sent: string[] } {
  const sent: string[] = [];
  const native = new WeakMap<object, D1PreparedStatement>();
  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const wrapped = new Proxy(stmt, {
      get(s, p) {
        const v = Reflect.get(s, p);
        if (p === "bind") return (...args: unknown[]) => wrap((v as (...a: unknown[]) => D1PreparedStatement).apply(s, args));
        return typeof v === "function" ? v.bind(s) : v;
      },
    });
    native.set(wrapped, stmt);
    return wrapped;
  };
  const db = new Proxy(base, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          sent.push(sql);
          return wrap(target.prepare(sql));
        };
      }
      if (prop === "batch") return (stmts: D1PreparedStatement[]) => target.batch(stmts.map((s) => native.get(s) ?? s));
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { db: db as D1Database, sent };
}

// The records database at the data date, its tables empty: every tile reads and finds nothing.
export const RECORDS = (testBindings as unknown as { RECORDS: D1Database }).RECORDS;
export async function recordsAt(day: string): Promise<void> {
  await applySql(RECORDS, (testBindings as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL);
  await RECORDS.batch([
    RECORDS.prepare("DELETE FROM rec_meta"),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(day),
  ]);
}

// An account written by fixture: its row and its plan from January.
export type Fixed = { id: string; email: string };
export async function account(tag: number, email: string, plan: "free" | "pro" | "ultra"): Promise<Fixed> {
  const id = hexOf(tag, 0);
  const stmts = [
    ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, 'en', 'active', ?)").bind(id, email, at(1), plan === "free" ? "free" : "pro"),
  ];
  if (plan !== "free") {
    const e = hexOf(tag, 1);
    stmts.push(ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'manual', ?, NULL, 'test', ?)",
    ).bind(e, id, at(1), at(1)));
    if (plan === "ultra") stmts.push(ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(e));
  }
  await ACCOUNTS.batch(stmts);
  return { id, email };
}

// The ids an account's items are written at, by tag.
export const ids = (tag: number) => ({
  tenders: [hexOf(tag, 0x100), hexOf(tag, 0x101)], expiring: hexOf(tag, 0x102), buyer: hexOf(tag, 0x103), briefing: hexOf(tag, 0x200),
  watches: [hexOf(tag, 0x300), hexOf(tag, 0x301)], views: (i: number) => hexOf(tag, 0x400 + i), keys: [hexOf(tag, 0x500), hexOf(tag, 0x501)],
  feedAll: hexOf(tag, 0x600), feedAllSecret: hexOf(tag, 0x6a0), feedWatchlist: hexOf(tag, 0x601), feedSearch: hexOf(tag, 0x602),
  board: hexOf(tag, 0x700), tile: (i: number) => hexOf(tag, 0x780 + i),
});

// One of each item a tile, a feed or the analytics index names: two tender searches, an expiring search and a
// buyer's records search, a briefing, two watches with their mail on, `views` saved views of a buyer's view (each
// its own number of years), two live keys, the "all" feed with the watchlist's and the first search's, and, with
// board, a dashboard holding a tile of every kind an item can be.
export async function holdings(tag: number, user: string, n: { views: number; board: boolean }): Promise<void> {
  const k = ids(tag);
  const s: D1PreparedStatement[] = [];
  const search = (id: string, kind: string, params: string, label: string, i: number) =>
    ACCOUNTS.prepare("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, ?, ?, ?, 'en', ?, 'off')")
      .bind(id, user, kind, params, label, at(2, i));
  s.push(search(k.tenders[0], "tenders", "/tenders", "All open tender notices", 0));
  s.push(search(k.tenders[1], "tenders", "/tenders?q=bridge", "Open notices: bridge", 1));
  s.push(search(k.expiring, "expiring", "/expiring/3m", "Contracts ending within 3 months", 2));
  s.push(search(k.buyer, "buyer", "/buyers/dnd-mdn", "National Defence", 3));
  s.push(ACCOUNTS.prepare("INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'segment', '81', '', '81 Engineering', 'en', ?, 'off')")
    .bind(k.briefing, user, at(3)));
  ["dnd-mdn", "pwgsc-tpsgc"].forEach((target, i) => s.push(ACCOUNTS.prepare(
    "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'buyer', ?, '', ?, 'award', 'daily', ?, '2026-10-30')",
  ).bind(k.watches[i], user, target, `Watched ${i + 1}`, at(4, i))));
  s.push(ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'off', ?)").bind(user, at(4)));
  for (let i = 0; i < n.views; i++) {
    s.push(ACCOUNTS.prepare("INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, ?, 'en', 'off', ?)")
      .bind(k.views(i), user, `/buyers/pwgsc-tpsgc/analytics?source=awards&years=${i + 1}`, `View ${i + 1}`, at(5, i)));
  }
  k.keys.forEach((id, i) => s.push(ACCOUNTS.prepare("INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, user, `Key ${i + 1}`, hexOf(tag, 0x5a0 + i) + hexOf(tag, 0x5b0 + i), `${tag.toString(16).padStart(6, "0").slice(-6)}a${i}`, at(6, i))));
  const feed = (id: string, kind: string, search: string | null, secret: string, i: number) =>
    ACCOUNTS.prepare("INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, user, kind, search, secret, at(7, i));
  s.push(feed(k.feedAll, "all", null, k.feedAllSecret, 0));
  s.push(feed(k.feedWatchlist, "watchlist", null, hexOf(tag, 0x6a1), 1));
  s.push(feed(k.feedSearch, "search", k.tenders[0], hexOf(tag, 0x6a2), 2));
  if (n.board) {
    s.push(ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', 0, ?)").bind(k.board, user, at(8)));
    const tiles: [string, string, string][] = [
      ["tenders", k.tenders[0], ""], ["radar", "3m", ""], ["radar", k.expiring, ""], ["records", k.buyer, ""], ["watches", "", ""],
      ["view", n.views ? k.views(0) : "", ""], ["analytic", "/buyers/pwgsc-tpsgc/analytics?source=awards&years=5#table-quarters", ""],
      ["briefing", k.briefing, ""], ["api", "", ""], ["text", hexOf(tag, 0x7f0), JSON.stringify({ text: "A note" })],
    ];
    tiles.forEach(([kind, ref, opts], i) => s.push(ACCOUNTS.prepare(
      "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 12, 6, ?)",
    ).bind(k.tile(i), k.board, user, kind, ref, opts, i * 6, at(8, i))));
  }
  await ACCOUNTS.batch(s);
}

async function sha(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A page's body with the session's CSRF value taken out and the stylesheet's stamp put back to the one the
// capture was made at (test/seats-service.test.ts does the same).
export const CAPTURED_STYLES = 77;
export const steady = (body: string) =>
  body.replace(/(name="csrf" value="|"csrf":")[0-9a-f]{32}/g, "$1CSRF").replaceAll(`styles.css?v=${STYLES_VERSION}"`, `styles.css?v=${CAPTURED_STYLES}"`);

// What a request answered and read: its status, its body's hash, and the statements it sent to the accounts
// database and to the records database, each sorted (reads made in parallel come in either order).
export type Seen = { status: number; body: string; accounts: string[]; records: string[] };
export async function seen(path: string, headers: Record<string, string>): Promise<Seen> {
  const a = recording(ACCOUNTS);
  const r = recording(RECORDS);
  const res = await app.request(path, { headers: { "cf-connecting-ip": nextIp(), ...headers } }, sale({ ACCOUNTS: a.db, RECORDS: r.db }));
  return { status: res.status, body: await sha(steady(await res.text())), accounts: [...a.sent].sort(), records: [...r.sent].sort() };
}
export const navigate = (cookie: string): Record<string, string> => ({ cookie, "sec-fetch-mode": "navigate" });

// Every page, tile and feed this slice touches, as three accounts in no group read them: Ultra holding one of each
// item and a dashboard of every kind of tile an item can be, Pro past its saved views' figure (11 of 10), Free
// holding a view its plan keeps none of. Keyed "<plan> <path>"; signIn is the caller's (accounts-helpers.ts).
export async function noGroupSeen(signIn: (email: string) => Promise<string>): Promise<Record<string, Seen>> {
  await recordsAt(DAY);
  const ultra = await account(0xd1, "rest-ultra@example.com", "ultra");
  await holdings(0xd1, ultra.id, { views: 3, board: true });
  const pro = await account(0xd2, "rest-pro@example.com", "pro");
  await holdings(0xd2, pro.id, { views: 11, board: false });
  const free = await account(0xd3, "rest-free@example.com", "free");
  await ACCOUNTS.prepare("INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, 'Kept', 'en', 'off', ?)")
    .bind(ids(0xd3).views(0), free.id, "/buyers/dnd-mdn/analytics?source=awards&years=3", at(5)).run();
  const out: Record<string, Seen> = {};
  const cookies = { ultra: await signIn(ultra.email), pro: await signIn(pro.email), free: await signIn(free.email) };
  const pages: [keyof typeof cookies, string][] = [
    ["ultra", "/analytics"], ["ultra", "/analytics?lang=fr"], ["pro", "/analytics"], ["pro", "/analytics?lang=fr"], ["free", "/analytics"],
    ["free", "/analytics?lang=fr"], ["ultra", "/account/dashboard"], ["ultra", "/account/dashboard?lang=fr"], ["ultra", "/account/searches"],
    ["ultra", "/account/searches?lang=fr"], ["pro", "/account/searches"], ["ultra", "/account/keys"], ["ultra", "/account/keys?lang=fr"],
  ];
  for (const [who, path] of pages) out[`${who} ${path}`] = await seen(path, navigate(cookies[who]));
  // The dashboard's one read of a tile, as the page's script asks for it: a tender search's, the watches', the keys'.
  const token = /name="csrf" value="([0-9a-f]{32})"/.exec(await (await app.request("/account/keys", {
    headers: { ...navigate(cookies.ultra), "cf-connecting-ip": nextIp() },
  }, sale())).text())?.[1] ?? "";
  for (const i of [0, 4, 8]) out[`ultra tile ${i}`] = await seen(`/account/dashboard/tiles/${ids(0xd1).tile(i)}?w=12&h=8`, { cookie: cookies.ultra, "x-csrf-token": token });
  // The calendar feeds, read as a calendar app reads them: no session, the feed's secret.
  for (const [who, tag] of [["ultra", 0xd1], ["pro", 0xd2]] as const) {
    const k = ids(tag);
    out[`${who} feed all`] = await seen(`/account/calendar/${k.feedAll}.ics?t=${k.feedAllSecret}`, {});
    out[`${who} feed search`] = await seen(`/account/calendar/${k.feedSearch}.ics?t=${hexOf(tag, 0x6a2)}`, {});
  }
  return out;
}
