// Seats, slice P2: the pool in service (docs/accounts.md, Seats, The pool). When a group holds more than a
// figure, the holder's items are in service first, then each member's in the order the seat was joined, each
// account's own oldest first; the rest are saved and unavailable, and nothing is deleted. An account's allowance
// is the figure less what the accounts ahead of it hold (src/account/pool.ts), read with POOL_COUNTS_SQL once a
// group a run or a page view, and only for an account in a group.
//
// For an account in no group, which is every account until a seat is taken, nothing changes: the first block
// below runs the delivery run, the key check and the list pages on fixtures of fixed ids and times and holds
// every statement they send and every page's bytes to what main sent and drew before this slice
// (test/seats-today.ts, captured by running these same fixtures on main, never rebuilt from the code under
// test). Every seat here is written by fixture, as test/seats.test.ts and test/seats-pool.test.ts write them.
import { env as testBindings } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEYS_MAX, KEY_SERVED_SQL, createKey } from "../src/account/api_keys";
import { runDeliveries } from "../src/account/deliveries";
import { FEED_SERVED_SQL } from "../src/account/feeds";
import { POOL_COUNTS_SQL, POOL_SLOTS, RunPool, allowanceIn, pastAllowance, readPool } from "../src/account/pool";
import { VIEW_STATE_GROUP_SQL, VIEW_STATE_SQL } from "../src/account/saved_views";
import { app } from "../src/index";
import { STYLES_VERSION } from "../src/layout";
import { makeFakeAssets } from "./assets";
import stats from "./fixtures/stats.json";
import { ACCOUNTS, PRO_SALE, ULTRA_VARS, decode, nbsp, nextIp, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { fakeMail } from "./mail-fixtures";
import { applySql } from "./setup";
import { withoutMonthly } from "./seats-switch-fixtures";
import { KEYS, PAGES as TODAY_PAGES, RUN, RUN_MAIL, STATEMENTS } from "./seats-today";

useAccountsDb();

afterEach(() => {
  vi.restoreAllMocks();
});

const DAY = "2026-10-31";
const SITE = "https://awardwatch.ca";
const FROM = "alerts@awardwatch.ca";
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const hexOf = (tag: number, n: number) => `${tag.toString(16).padStart(8, "0")}${n.toString(16).padStart(24, "0")}`;
const at = (day: number, i = 0) => `2026-01-${String(day).padStart(2, "0")}T00:00:${String(i).padStart(2, "0")}.000Z`;

// The accounts database with every statement prepared on it written down, in order.
function recording(): { db: D1Database; sent: string[] } {
  const sent: string[] = [];
  const native = new WeakMap<object, D1PreparedStatement>();
  const db = new Proxy(ACCOUNTS, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          sent.push(sql);
          const stmt = target.prepare(sql);
          const wrapped = new Proxy(stmt, {
            get(s, p) {
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
  return { db: db as D1Database, sent };
}

// An account written by fixture, at fixed ids and times: its row, its plan from January, and its items.
type Fixed = { id: string; email: string };
async function account(tag: number, email: string, plan: "free" | "pro" | "ultra"): Promise<Fixed> {
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

// What every list page and every run part reads for: searches (one with news on the data date), a
// briefing, watches with their mail on, saved views, keys, feeds and dashboards.
async function items(tag: number, user: string, n: { searches: number; watches: number; views: number; keys: number; feeds: boolean; boards: number }) {
  const s: D1PreparedStatement[] = [];
  for (let i = 0; i < n.searches; i++) {
    s.push(ACCOUNTS.prepare("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, 'daily')")
      .bind(hexOf(tag, 0x100 + i), user, i ? `/tenders?q=s${i}` : "/tenders", `Search ${i + 1}`, at(2, i)));
  }
  s.push(ACCOUNTS.prepare("INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'segment', '81', '', '81 Engineering', 'en', ?, 'weekly')")
    .bind(hexOf(tag, 0x200), user, at(3)));
  for (let i = 0; i < n.watches; i++) {
    s.push(ACCOUNTS.prepare(
      "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'buyer', ?, '', ?, 'award', 'daily', ?, '2026-10-30')",
    ).bind(hexOf(tag, 0x300 + i), user, i ? `buyer-${i}` : "dnd-mdn", `Watched ${i + 1}`, at(4, i)));
  }
  if (n.watches) s.push(ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'on', ?)").bind(user, at(4)));
  for (let i = 0; i < n.views; i++) {
    s.push(ACCOUNTS.prepare("INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, ?, 'en', 'weekly', ?)")
      .bind(hexOf(tag, 0x400 + i), user, `/buyers/pwgsc-tpsgc/analytics?source=awards&t=${i}`, `View ${i + 1}`, at(5, i)));
  }
  for (let i = 0; i < n.keys; i++) {
    s.push(ACCOUNTS.prepare("INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(hexOf(tag, 0x500 + i), user, `Key ${i + 1}`, hexOf(tag, 0x5a0 + i) + hexOf(tag, 0x5b0 + i), `${tag.toString(16).padStart(6, "0").slice(-6)}a${i}`, at(6, i)));
  }
  if (n.feeds) {
    s.push(ACCOUNTS.prepare("INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) VALUES (?, ?, 'search', ?, ?, ?)")
      .bind(hexOf(tag, 0x600), user, hexOf(tag, 0x100), hexOf(tag, 0x6a0), at(7, 0)));
    s.push(ACCOUNTS.prepare("INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) VALUES (?, ?, 'watchlist', NULL, ?, ?)")
      .bind(hexOf(tag, 0x601), user, hexOf(tag, 0x6a1), at(7, 1)));
  }
  for (let i = 0; i < n.boards; i++) {
    s.push(ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', ?, ?)").bind(hexOf(tag, 0x700 + i), user, i, at(8, i)));
    s.push(ACCOUNTS.prepare("INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, 'watches', '', '', 0, 0, 12, 6, ?)")
      .bind(hexOf(tag, 0x780 + i), hexOf(tag, 0x700 + i), user, at(8, i)));
  }
  await ACCOUNTS.batch(s);
}

const sale = (extra: Record<string, unknown> = {}) => onEnv({ ...PRO_SALE, ...ULTRA_VARS, ...extra });
const week = (): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (let i = 1; i < 8; i++) out[`tenders/new/2026-10-${String(31 - i).padStart(2, "0")}.json`] = [];
  return out;
};

async function sha(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// A page's body with the session's CSRF value taken out, the one thing in it that differs between two sign-ins,
// and the stylesheet's version stamp put back to the one the capture was made at: a change to the stylesheet raises
// the stamp on every page (layout.tsx STYLES_VERSION) and changes nothing else in these pages' bytes. What the
// monthly record added to every page after the capture is taken out first (seats-switch-fixtures.ts CAPTURED_WITHOUT).
const CAPTURED_STYLES = 74;
// The capture was made while Add a Tile's count read "1 tuiles sur 24" in French (dash.count for every number).
// The count now takes the singular for none and one (dash.count_one), and nothing else on the page changed, so that
// one line is put back as it read at the capture before a page is compared; the capture stays as it is.
const CAPTURED_COUNT = /(<p class="muted small">[01]) tuile sur /g;
const steady = (body: string) =>
  withoutMonthly(body).replace(CAPTURED_COUNT, "$1 tuiles sur ").replace(/(name="csrf" value="|"csrf":")[0-9a-f]{32}/g, "$1CSRF")
    .replaceAll(`styles.css?v=${STYLES_VERSION}"`, `styles.css?v=${CAPTURED_STYLES}"`);

const PAGES = ["/account/searches", "/account/watches", "/account/views", "/account/keys", "/account/dashboard"];
const text = (i: number) => STATEMENTS[i];

// =====================================================================================

describe("an account in no group", () => {
  it("is sent, in the delivery run, every statement main sent, in the same order, and no other", { timeout: 60_000 }, async () => {
    // One Ultra account alone holding an item each part reads.
    const ultra = await account(0xa1, "p2-run@example.com", "ultra");
    await items(0xa1, ultra.id, { searches: 2, watches: 2, views: 2, keys: 1, feeds: true, boards: 1 });
    // And a Pro account past its figures, after a move from Ultra: each part passes over the ones past them.
    const past = await account(0xa2, "p2-run-past@example.com", "pro");
    await items(0xa2, past.id, { searches: 26, watches: 27, views: 11, keys: 0, feeds: false, boards: 0 });
    const run = recording();
    const mail = fakeMail();
    await runDeliveries(sale({ ACCOUNTS: run.db, ASSETS: makeFakeAssets({}, week()), MAIL: mail.binding, MAIL_FROM: FROM, MAIL_SENDER: undefined, RECORDS: undefined, SITE_URL: SITE }) as never);
    expect(run.sent).toEqual(RUN.map(text));
    expect(mail.handed).toHaveLength(RUN_MAIL);
    expect(run.sent).not.toContain(POOL_COUNTS_SQL);
  });

  it("is sent, at the key check, every statement main sent, and no other", async () => {
    for (const [tag, plan] of [[0xb1, "pro"], [0xb2, "ultra"]] as const) {
      const a = await account(tag, `p2-key-${plan}@example.com`, plan);
      const made = await createKey(onEnv() as never, { userId: a.id }, "Fixture key");
      if (typeof made !== "object") throw new Error("no key");
      const r = recording();
      const res = await app.request("/api/v1/me", { headers: { authorization: `Bearer ${made.key}`, "cf-connecting-ip": nextIp() } }, onEnv({ ACCOUNTS: r.db }));
      expect({ status: res.status, sent: r.sent }, plan).toEqual({ status: KEYS[plan].status, sent: KEYS[plan].sent.map(text) });
      expect(r.sent).not.toContain(KEY_SERVED_SQL);
    }
  });

  it("reads, on each list page, what main read, and draws every byte main drew, Free, Pro past its figures and Ultra", { timeout: 60_000 }, async () => {
    for (const [tag, plan, n] of [
      [0xc1, "free", { searches: 2, watches: 2, views: 0, keys: 0, feeds: false, boards: 0 }],
      [0xc2, "pro", { searches: 26, watches: 27, views: 11, keys: 2, feeds: true, boards: 0 }],
      [0xc3, "ultra", { searches: 3, watches: 3, views: 3, keys: 2, feeds: true, boards: 2 }],
    ] as const) {
      const a = await account(tag, `p2-page-${plan}@example.com`, plan);
      await items(tag, a.id, n);
      const cookie = await signIn(a.email);
      for (const lang of ["en", "fr"]) {
        for (const path of PAGES) {
          const r = recording();
          const url = lang === "fr" ? `${path}?lang=fr` : path;
          const res = await app.request(url, { headers: { cookie, "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, sale({ ACCOUNTS: r.db }));
          const today = TODAY_PAGES[`${plan}_${url}`];
          expect({ status: res.status, body: await sha(steady(await res.text())), sent: [...r.sent].sort() }, `${plan} ${url}`)
            .toEqual({ status: today.status, body: today.body, sent: today.sent.map(text) });
        }
      }
    }
  });
});

// =====================================================================================
// Groups, written by fixture.

const T0 = Date.UTC(2026, 1, 1);
// A time in February, minutes and seconds after its first moment: each kind of item its own minute, each item its second.
const when = (minutes: number, i = 0) => new Date(T0 + minutes * 60_000 + i * 1000).toISOString();

type Group = { holder: Fixed; members: Fixed[]; seats: string[] };

// An Ultra holder and n members, each on Free of its own and covered by the holder's plan, joined in order. A
// member's cached plan reads as planFor writes it for a covered member, so no read writes it.
async function groupOf(tag: number, n: number): Promise<Group> {
  const holder = await account(tag, `p2-g${tag.toString(16)}-h@example.com`, "ultra");
  const members: Fixed[] = [];
  const seats: string[] = [];
  for (let i = 1; i <= n; i++) {
    const m = await account(tag + i, `p2-g${tag.toString(16)}-m${i}@example.com`, "free");
    await ACCOUNTS.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").bind(m.id).run();
    const seat = hexOf(tag + i, 0xfff);
    await ACCOUNTS.prepare("INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id, joined_at) VALUES (?, ?, 'en', ?, ?, ?, ?)")
      .bind(seat, holder.id, when(i * 60 - 1), "2026-12-31T00:00:00.000Z", m.id, when(i * 60)).run();
    members.push(m);
    seats.push(seat);
  }
  return { holder, members, seats };
}

const leave = (seat: string) => ACCOUNTS.prepare("UPDATE seats SET ended_at = ?, ended_why = 'left', told = 0 WHERE id = ?").bind(new Date().toISOString(), seat).run();

async function rows(n: number, f: (i: number) => D1PreparedStatement): Promise<void> {
  for (let i = 0; i < n; i += 50) await ACCOUNTS.batch(Array.from({ length: Math.min(50, n - i) }, (_, k) => f(i + k)));
}
const searchIds = (tag: number, n: number) => Array.from({ length: n }, (_, i) => hexOf(tag, 0x1000 + i));
const searchesOf = (user: string, tag: number, n: number, deliver = "daily") => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, ?)",
).bind(hexOf(tag, 0x1000 + i), user, `/tenders?q=zzp2${tag.toString(16)}n${i}`, `Pool search ${i + 1}`, when(1000, i), deliver));
const briefingIds = (tag: number, n: number) => Array.from({ length: n }, (_, i) => hexOf(tag, 0x2000 + i));
const briefingsOf = (user: string, tag: number, n: number, deliver = "weekly") => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'segment', ?, '', ?, 'en', ?, ?)",
).bind(hexOf(tag, 0x2000 + i), user, String(43 + i), `Pool briefing ${i + 1}`, when(2000, i), deliver));
const watchIds = (tag: number, n: number) => Array.from({ length: n }, (_, i) => hexOf(tag, 0x3000 + i));
const watchesOf = (user: string, tag: number, n: number) => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'buyer', ?, '', ?, 'award', 'daily', ?, '2026-10-30')",
).bind(hexOf(tag, 0x3000 + i), user, `pool-${tag.toString(16)}-${i}`, `Pool watch ${i + 1}`, when(3000, i)));
const viewIds = (tag: number, n: number) => Array.from({ length: n }, (_, i) => hexOf(tag, 0x4000 + i));
// Each a buyer's view the run can read, at its own number of years (a view's address is its own once).
const viewsOf = (user: string, tag: number, n: number, deliver = "weekly") => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, ?, 'en', ?, ?)",
).bind(hexOf(tag, 0x4000 + i), user, `/buyers/pwgsc-tpsgc/analytics?source=awards&years=${i + 1}`, `Pool view ${i + 1}`, deliver, when(4000, i)));
const keysOf = (user: string, tag: number, n: number) => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, 'ffff0000', ?)",
).bind(hexOf(tag, 0x5000 + i), user, `Pool key ${i + 1}`, hexOf(tag, 0x5a00 + i) + hexOf(tag, 0x5b00 + i), when(5000, i)));
const feedOf = (user: string, tag: number, i: number, kind: "search" | "watchlist" | "all", search: string | null = null) => ACCOUNTS.prepare(
  "INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) VALUES (?, ?, ?, ?, ?, ?)",
).bind(hexOf(tag, 0x6000 + i), user, kind, search, hexOf(tag, 0x6a00 + i), when(6000, i)).run();
const boardOf = (user: string, tag: number, i: number, pos: number) => ACCOUNTS.batch([
  ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, ?, ?, ?)").bind(hexOf(tag, 0x7000 + i), user, `Board ${i + 1}`, pos, when(7000, i)),
  ACCOUNTS.prepare("INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, 'watches', '', '', 0, 0, 12, 6, ?)")
    .bind(hexOf(tag, 0x7800 + i), hexOf(tag, 0x7000 + i), user, when(7000, i)),
]);

// Every earlier fixture's mail turned off, so a run reads only the group a test builds.
async function quiet(): Promise<void> {
  await ACCOUNTS.batch([
    ACCOUNTS.prepare("UPDATE saved_searches SET deliver = 'off'"), ACCOUNTS.prepare("UPDATE briefings SET deliver = 'off'"),
    ACCOUNTS.prepare("UPDATE saved_views SET deliver = 'off'"), ACCOUNTS.prepare("UPDATE watch_mail SET mail = 'off'"),
  ]);
}

// The records database at the data date, its tables empty: the parts read it and find nothing new.
const RECORDS = (testBindings as unknown as { RECORDS: D1Database }).RECORDS;
async function recordsAt(day: string): Promise<void> {
  await applySql(RECORDS, (testBindings as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL);
  await RECORDS.batch([
    RECORDS.prepare("DELETE FROM rec_meta"),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(day),
  ]);
}

// One run at a data date (16:00 UTC that day), its statements written down.
async function runOn(day: string, records = false): Promise<string[]> {
  const files: Record<string, unknown> = { "stats.json": { ...stats, data_as_of: day } };
  for (let i = 0; i < 8; i++) files[`tenders/new/${new Date(Date.parse(day) - i * 86_400_000).toISOString().slice(0, 10)}.json`] = [];
  const r = recording();
  await runDeliveries(sale({
    ACCOUNTS: r.db, ASSETS: makeFakeAssets({}, files), MAIL: fakeMail().binding, MAIL_FROM: FROM, MAIL_SENDER: undefined, SITE_URL: SITE,
    RECORDS: records ? RECORDS : undefined, NOW: `${day}T16:00:00Z`,
  }) as never);
  return r.sent;
}

// The saved searches of an account a run sent or found empty on a day (each has its deliveries row), and those it passed over (covered for the day, no row).
async function servedOn(user: string, day: string): Promise<{ served: string[]; passed: string[] }> {
  const all = (await ACCOUNTS.prepare(
    "SELECT s.id, s.last_delivered_at, EXISTS (SELECT 1 FROM deliveries d WHERE d.saved_search_id = s.id AND substr(d.sent_at, 1, 10) = ?2) AS row " +
    "FROM saved_searches s WHERE s.user_id = ?1 ORDER BY s.created_at, s.id",
  ).bind(user, day).all<{ id: string; last_delivered_at: string | null; row: number }>()).results ?? [];
  return {
    served: all.filter((r) => r.row === 1).map((r) => r.id),
    passed: all.filter((r) => r.row !== 1 && (r.last_delivered_at ?? "").slice(0, 10) === day).map((r) => r.id),
  };
}

const count = (sent: readonly string[], sql: string) => sent.filter((s) => s === sql).length;

// A page as a reader gets it, its body with entities and no-break spaces made plain.
async function pageOf(path: string, cookie: string, extra: Record<string, unknown> = {}): Promise<{ status: number; body: string; sent: string[] }> {
  const r = recording();
  const res = await app.request(path, { headers: { cookie, "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, sale({ ACCOUNTS: r.db, ...extra }));
  return { status: res.status, body: nbsp(decode(await res.text())).replace(/’/g, "'"), sent: r.sent };
}
const marks = (body: string, lang: "en" | "fr") =>
  body.split(lang === "en" ? "Saved, unavailable until there is room" : "Enregistré, indisponible jusqu'à ce qu'il y ait de la place").length - 1;

// =====================================================================================

describe("the order and the allowance", () => {
  it("reads every account's counts in one statement, numbers by id and nothing else, each table through its index", async () => {
    const g = await groupOf(0x1000, 2);
    await searchesOf(g.holder.id, 0x1000, 4);
    await briefingsOf(g.holder.id, 0x1000, 1);
    await watchesOf(g.members[0].id, 0x1001, 3);
    await ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, created_at, updated_at) VALUES (?, 'org-a000000001', ?, ?)")
      .bind(g.members[0].id, when(1), when(1)).run();
    await ACCOUNTS.prepare(
      "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at) VALUES (?, ?, 'organization', 'org-a000000001', '', 'Own', 'award', 'daily', ?)",
    ).bind(hexOf(0x1001, 0x3fff), g.members[0].id, when(3000, 99)).run();
    await viewsOf(g.members[1].id, 0x1002, 2);
    await keysOf(g.holder.id, 0x1000, 2);
    await ACCOUNTS.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ?").bind(when(9000), hexOf(0x1000, 0x5001)).run();
    await feedOf(g.members[1].id, 0x1002, 0, "watchlist");
    await boardOf(g.members[1].id, 0x1002, 0, 0);
    const ids = [g.holder.id, ...g.members.map((m) => m.id)];
    const group = { holderId: g.holder.id, ids, position: 2 };
    const pool = await readPool(ACCOUNTS, group);
    expect(Object.fromEntries(pool.counts)).toEqual({
      [ids[0]]: { searches: 5, watches: 0, views: 0, dashboards: 0, keys: 1, feeds: 0 },
      // The member's own claimed organization's watch stays beside the pool.
      [ids[1]]: { searches: 0, watches: 3, views: 0, dashboards: 0, keys: 0, feeds: 0 },
      [ids[2]]: { searches: 0, watches: 0, views: 2, dashboards: 1, keys: 0, feeds: 1 },
    });
    const raw = (await ACCOUNTS.prepare(POOL_COUNTS_SQL).bind(...ids, null, null).all<Record<string, unknown>>()).results ?? [];
    for (const row of raw) {
      expect(Object.keys(row).sort()).toEqual(["dashboards", "feeds", "id", "keys", "searches", "views", "watches"]);
      for (const [k, v] of Object.entries(row)) if (k !== "id") expect(typeof v, k).toBe("number");
    }
    // The holder's allowance is the whole figure; each member's the figure less what the accounts ahead hold, never below none.
    expect(allowanceIn(pool, { ...group, position: 0 }, "searches", 100)).toBe(100);
    expect(allowanceIn(pool, { ...group, position: 1 }, "searches", 100)).toBe(95);
    expect(allowanceIn(pool, { ...group, position: 2 }, "watches", 100)).toBe(97);
    expect(allowanceIn(pool, { ...group, position: 2 }, "searches", 3)).toBe(0);
    // An account's own, oldest first, then by id: the rest past its allowance.
    const own = [{ id: "c", created_at: "2026-01-02" }, { id: "b", created_at: "2026-01-01" }, { id: "a", created_at: "2026-01-02" }];
    expect([...pastAllowance(own, 1)]).toEqual(["a", "c"]);
    expect([...pastAllowance(own, 0)]).toEqual(["b", "a", "c"]);
    expect([...pastAllowance(own, 5)]).toEqual([]);
  });

  it("reads POOL_COUNTS_SQL, the key's and the feed's statements and the views' state through an index on each table they count", async () => {
    const places = (sql: string) => Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
    const plans: [string, string, Record<string, unknown>[], string[]][] = [
      ["POOL_COUNTS_SQL", POOL_COUNTS_SQL, [hexOf(1, 1), hexOf(1, 2), null, null, null], ["u", "s", "b", "w", "c", "v", "d", "k", "f"]],
      ["KEY_SERVED_SQL", KEY_SERVED_SQL, [hexOf(1, 1), hexOf(1, 2), hexOf(1, 3), null, null, null, null], ["api_keys", "x", "k"]],
      ["FEED_SERVED_SQL", FEED_SERVED_SQL, [hexOf(1, 1), hexOf(1, 2), hexOf(1, 3), hexOf(1, 4), null, null, null, hexOf(1, 5)],
        ["feeds", "x", "f", "saved_searches", "briefings", "s", "w", "c"]],
      ["VIEW_STATE_GROUP_SQL", VIEW_STATE_GROUP_SQL, [hexOf(1, 1), "/x", hexOf(1, 1), hexOf(1, 2), null, null, null], ["saved_views"]],
    ] as never;
    expect(places(POOL_COUNTS_SQL)).toBe(POOL_SLOTS);
    for (const [name, sql, binds, tables] of plans) {
      expect(binds, name).toHaveLength(places(sql));
      const steps = ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all<{ detail: string }>()).results ?? []).map((r) => r.detail);
      for (const table of tables) {
        expect(steps.some((d) => new RegExp(`^SEARCH ${table} USING (?:COVERING |PRIMARY KEY |INTEGER PRIMARY KEY )?(?:INDEX \\w+ )?\\((?:user_id|id|rowid)=\\?`).test(d)),
          `${name} ${table}: ${steps.join(" | ")}`).toBe(true);
      }
      expect(steps.filter((d) => /^SCAN (?!CONSTANT ROW)/.test(d)), name).toEqual([]);
    }
    // The views' state for an account in no group is the statement it always was.
    expect(VIEW_STATE_SQL).toBe("SELECT EXISTS (SELECT 1 FROM saved_views WHERE user_id = ?1 AND address = ?2) AS saved, (SELECT COUNT(*) FROM saved_views WHERE user_id = ?1) AS n");
  });
});

// =====================================================================================

describe("the delivery run", () => {
  it("serves an overfull group's holder's 90 and the member's first 10 by creation; 5 of the holder's removed bring 5 back; a leave frees the group at once",
    { timeout: 120_000 }, async () => {
      await quiet();
      const g = await groupOf(0x2000, 2);
      const [m1, m2] = g.members;
      await searchesOf(g.holder.id, 0x2000, 90);
      await searchesOf(m1.id, 0x2001, 30);
      await searchesOf(m2.id, 0x2002, 5);
      const holder = searchIds(0x2000, 90);
      const first = searchIds(0x2001, 30);
      const second = searchIds(0x2002, 5);
      // Day one: the holder's 90, the first member's first 10 by creation, and nothing of the second member's (100 - 90 - 30 leaves it none).
      let sent = await runOn("2026-10-31");
      expect(await servedOn(g.holder.id, "2026-10-31")).toEqual({ served: holder, passed: [] });
      expect(await servedOn(m1.id, "2026-10-31")).toEqual({ served: first.slice(0, 10), passed: first.slice(10) });
      expect(await servedOn(m2.id, "2026-10-31")).toEqual({ served: [], passed: second });
      // The group's counts once a run, for the two members; the holder's needs none.
      expect(count(sent, POOL_COUNTS_SQL)).toBe(1);
      // Five of the holder's removed: the next data date serves five more of the first member's.
      await ACCOUNTS.prepare(`DELETE FROM saved_searches WHERE id IN (${holder.slice(0, 5).map(() => "?").join(", ")})`).bind(...holder.slice(0, 5)).run();
      sent = await runOn("2026-11-01");
      expect(await servedOn(g.holder.id, "2026-11-01")).toEqual({ served: holder.slice(5), passed: [] });
      expect(await servedOn(m1.id, "2026-11-01")).toEqual({ served: first.slice(0, 15), passed: first.slice(15) });
      expect(await servedOn(m2.id, "2026-11-01")).toEqual({ served: [], passed: second });
      expect(count(sent, POOL_COUNTS_SQL)).toBe(1);
      // The first member leaves: from the next read its 30 are under its own plan (Free sends none), and the second member's 5 are in service.
      await leave(g.seats[0]);
      sent = await runOn("2026-11-02");
      expect(await servedOn(m2.id, "2026-11-02")).toEqual({ served: second, passed: [] });
      expect(await servedOn(m1.id, "2026-11-02")).toEqual({ served: [], passed: first });
      expect(await servedOn(g.holder.id, "2026-11-02")).toEqual({ served: holder.slice(5), passed: [] });
      expect(count(sent, POOL_COUNTS_SQL)).toBe(1);
      // Nothing was deleted.
      expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM saved_searches WHERE user_id IN (?, ?)").bind(m1.id, m2.id).first<{ n: number }>())!.n).toBe(35);
    });

  it("passes over exactly the watches, briefings and views past each member's allowance, the claimed organization's watch beside them, reading each group's counts once",
    { timeout: 120_000 }, async () => {
      await quiet();
      await recordsAt(DAY);
      // Watches: the holder 99, the member 4 and its own claimed organization's: the organization's and the first are covered.
      const w = await groupOf(0x2100, 1);
      await watchesOf(w.holder.id, 0x2100, 99);
      const mw = w.members[0];
      await watchesOf(mw.id, 0x2101, 4);
      await ACCOUNTS.batch([
        ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, created_at, updated_at) VALUES (?, 'org-a000000001', ?, ?)").bind(mw.id, when(1), when(1)),
        ACCOUNTS.prepare(
          "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'organization', 'org-a000000001', '', 'Own', 'award', 'daily', ?, '2026-10-30')",
        ).bind(hexOf(0x2101, 0x3fff), mw.id, when(3000, 99)),
        ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'on', ?)").bind(mw.id, when(1)),
      ]);
      // Briefings: the holder's 98 searches, the member's 3 briefings: the first 2 are in service.
      const b = await groupOf(0x2200, 1);
      await searchesOf(b.holder.id, 0x2200, 98, "off");
      await briefingsOf(b.members[0].id, 0x2201, 3);
      // Views: the holder 48, the member 4: the first 2 are in service.
      const v = await groupOf(0x2300, 1);
      await viewsOf(v.holder.id, 0x2300, 48, "off");
      await viewsOf(v.members[0].id, 0x2301, 4);
      const sent = await runOn(DAY, true);
      const sentDay = async (id: string) =>
        (await ACCOUNTS.prepare("SELECT last_sent_day AS d FROM watches WHERE id = ?").bind(id).first<{ d: string }>())!.d;
      const watches = watchIds(0x2101, 4);
      expect(await Promise.all([hexOf(0x2101, 0x3fff), ...watches].map(sentDay))).toEqual([DAY, DAY, "2026-10-30", "2026-10-30", "2026-10-30"]);
      const briefings = briefingIds(0x2201, 3);
      const briefed = async (id: string) => (await ACCOUNTS.prepare(
        "SELECT substr(b.last_delivered_at, 1, 10) AS day, (SELECT COUNT(*) FROM briefing_deliveries d WHERE d.briefing_id = b.id) AS rows FROM briefings b WHERE b.id = ?",
      ).bind(id).first<{ day: string | null; rows: number }>())!;
      // In service: claimed and recorded; past: covered for the week, no row.
      expect(await Promise.all(briefings.map(briefed))).toEqual([{ day: DAY, rows: 1 }, { day: DAY, rows: 1 }, { day: DAY, rows: 0 }]);
      const views = viewIds(0x2301, 4);
      const viewed = async (id: string) => (await ACCOUNTS.prepare(
        "SELECT substr(v.last_delivered_at, 1, 10) AS day, (SELECT COUNT(*) FROM view_deliveries d WHERE d.view_id = v.id) AS rows FROM saved_views v WHERE v.id = ?",
      ).bind(id).first<{ day: string | null; rows: number }>())!;
      const read = await Promise.all(views.map(viewed));
      expect(read.map((r) => r.rows)).toEqual([1, 1, 0, 0]);
      expect(read.slice(2).map((r) => r.day)).toEqual([DAY, DAY]);
      // One read of the counts for each of the three groups, none for anyone else.
      expect(count(sent, POOL_COUNTS_SQL)).toBe(3);
    });

  it("keeps each account's plan and group once a run and reads a group's counts once, and nothing for a holder or an account alone", async () => {
    // RunPool: planFor once an account, its group kept; an account alone has the plan's figure with nothing read.
    const g = await groupOf(0x2400, 1);
    await viewsOf(g.holder.id, 0x2400, 49, "off");
    const r = recording();
    const pool = new RunPool();
    const plans = new Map();
    const e = onEnv({ ACCOUNTS: r.db }) as never;
    const user = (f: Fixed) => ({ id: f.id, plan: "pro", plan_until: null });
    expect(await pool.plan(e, plans, user(g.members[0]), new Date())).toBe("ultra");
    expect(await pool.plan(e, plans, user(g.members[0]), new Date())).toBe("ultra");
    expect(await pool.allowance(e, g.members[0].id, "views", 50)).toBe(1);
    expect(await pool.allowance(e, g.members[0].id, "searches", 100)).toBe(100);
    expect(await pool.allowance(e, g.holder.id, "views", 50)).toBe(50);
    const alone = await account(0x2410, "p2-alone@example.com", "ultra");
    expect(await pool.plan(e, plans, user(alone), new Date())).toBe("ultra");
    expect(await pool.allowance(e, alone.id, "views", 50)).toBe(50);
    // One plan read for each account and one read of the group's counts, whatever was asked after.
    expect(r.sent.filter((s) => s.startsWith("SELECT 'own' AS via"))).toHaveLength(2);
    expect(count(r.sent, POOL_COUNTS_SQL)).toBe(1);
    expect(r.sent).toHaveLength(3);
  });
});

// =====================================================================================

describe("off the run", () => {
  it("answers a member's key past its allowance 403 with the line, one statement more and then none for five minutes; the holder's key reads nothing more", async () => {
    const g = await groupOf(0x3000, 1);
    const m = g.members[0];
    // Keys made while no seat stood (the insert holds a group's), the member's own two first, then the holder's.
    await ACCOUNTS.prepare("UPDATE seats SET ended_at = ? WHERE id = ?").bind(when(1), g.seats[0]).run();
    const k1 = await createKey(onEnv() as never, { userId: m.id }, "Member one", new Date(Date.parse(when(5000, 1))));
    const k2 = await createKey(onEnv() as never, { userId: m.id }, "Member two", new Date(Date.parse(when(5000, 2))));
    const hk = await createKey(onEnv() as never, { userId: g.holder.id }, "Holder", new Date(Date.parse(when(5000, 3))));
    await keysOf(g.holder.id, 0x3000, 3);
    await ACCOUNTS.prepare("UPDATE seats SET ended_at = NULL WHERE id = ?").bind(g.seats[0]).run();
    if (typeof k1 !== "object" || typeof k2 !== "object" || typeof hk !== "object") throw new Error("no key");
    const ask = async (key: string, lang = "") => {
      const r = recording();
      const res = await app.request(`/api/v1/me${lang}`, { headers: { authorization: `Bearer ${key}`, "cf-connecting-ip": nextIp() } }, onEnv({ ACCOUNTS: r.db }));
      return { status: res.status, body: (await res.json()) as { error?: string }, sent: r.sent };
    };
    // The holder's 4 and the member's first: in service. The holder's key is checked as any key alone is.
    const holder = await ask(hk.key);
    expect(holder.status).toBe(200);
    expect(holder.sent).toEqual(KEYS.ultra.sent.map(text));
    const first = await ask(k1.key);
    expect(first.status).toBe(200);
    const plain = KEYS.ultra.sent.map(text);
    expect(first.sent).toEqual([...plain.slice(0, 3), KEY_SERVED_SQL, ...plain.slice(3)]);
    // Remembered with the key's last-known answer: the next request asks nothing more.
    const again = await ask(k1.key);
    expect(again.status).toBe(200);
    expect(count(again.sent, KEY_SERVED_SQL)).toBe(0);
    // The member's second: saved, unavailable.
    const past = await ask(k2.key);
    expect(past.status).toBe(403);
    expect(past.body.error).toBe(`This key is saved and unavailable until the subscription has room for it: its ${KEYS_MAX} keys are in use.`);
    expect(count(past.sent, KEY_SERVED_SQL)).toBe(1);
    expect(past.sent).not.toContain("UPDATE api_keys SET last_used_at = ? WHERE id = ?");
    const fr = await ask(k2.key, "?lang=fr");
    expect(fr.status).toBe(403);
    expect(nbsp(fr.body.error ?? "").replace(/’/g, "'")).toBe(
      `Cette clé est enregistrée et indisponible jusqu'à ce que l'abonnement ait de la place pour elle : ses ${KEYS_MAX} clés sont utilisées.`);
    // The member leaves: its keys are its own plan's (Free has none), refused as any Free key is, and nothing more is read.
    await leave(g.seats[0]);
    const after = await ask(k1.key);
    expect(after.status).toBe(403);
    expect(after.body.error).toBe("The plan of the key's account does not include the API.");
    expect(count(after.sent, KEY_SERVED_SQL)).toBe(0);
  });

  it("answers a member's calendar feed past its allowance, or whose search is past it, as a feed on a plan without feeds, with one statement more", async () => {
    const g = await groupOf(0x3100, 1);
    const m = g.members[0];
    await searchesOf(g.holder.id, 0x3100, 98, "off");
    await searchesOf(m.id, 0x3101, 2, "off");
    // The holder's 3 feeds, then the member's watchlist and "all" feeds: 5, each in service.
    const hs = searchIds(0x3100, 98);
    await feedOf(g.holder.id, 0x3100, 0, "watchlist");
    await feedOf(g.holder.id, 0x3100, 1, "all");
    await feedOf(g.holder.id, 0x3100, 2, "search", hs[0]);
    await feedOf(m.id, 0x3101, 0, "watchlist");
    await feedOf(m.id, 0x3101, 1, "all");
    const feed = (tag: number, i: number) => `/account/calendar/${hexOf(tag, 0x6000 + i)}.ics?t=${hexOf(tag, 0x6a00 + i)}`;
    const ask = async (path: string) => {
      const r = recording();
      const res = await app.request(path, { headers: { "cf-connecting-ip": nextIp() } }, onEnv({ ACCOUNTS: r.db }));
      return { status: res.status, sent: r.sent };
    };
    // The holder's own feed asks nothing more; the member's ask one statement each.
    expect((await ask(feed(0x3100, 0))).sent).not.toContain(FEED_SERVED_SQL);
    const watchlist = await ask(feed(0x3101, 0));
    expect(watchlist.status).toBe(200);
    expect(count(watchlist.sent, FEED_SERVED_SQL)).toBe(1);
    expect((await ask(feed(0x3101, 1))).status).toBe(200);
    await feedOf(g.holder.id, 0x3100, 3, "search", hs[1]);
    // A fourth of the holder's: the member's watchlist is the fifth and in service, its "all" the sixth and past.
    expect((await ask(feed(0x3101, 0))).status).toBe(200);
    const past = await ask(feed(0x3101, 1));
    expect(past.status).toBe(404);
    expect(count(past.sent, FEED_SERVED_SQL)).toBe(1);
    // A search's feed whose search is past the member's allowance of the searches: its second search is within 100 - 98 = 2, and past
    // 100 - 99 = 1 once the holder saves one more.
    await ACCOUNTS.prepare("UPDATE feeds SET revoked_at = ? WHERE id IN (?, ?)").bind(when(9000), hexOf(0x3100, 0x6003), hexOf(0x3101, 0x6001)).run();
    await feedOf(m.id, 0x3101, 2, "search", searchIds(0x3101, 2)[1]);
    expect((await ask(feed(0x3101, 2))).status).toBe(200);
    await searchesOf(g.holder.id, 0x3102, 1, "off");
    expect((await ask(feed(0x3101, 2))).status).toBe(404);
    // Nothing was deleted or revoked by it.
    expect((await ACCOUNTS.prepare("SELECT revoked_at FROM feeds WHERE id = ?").bind(hexOf(0x3101, 0x6002)).first<{ revoked_at: string | null }>())!.revoked_at).toBeNull();
  });

  it("keeps a dashboard past a member's allowance, by creation and not by tab order, its tab marked, its page the line and no tile read", { timeout: 60_000 }, async () => {
    const g = await groupOf(0x3200, 2);
    const [m1, m2] = g.members;
    for (let i = 0; i < 4; i++) await boardOf(g.holder.id, 0x3200, i, i);
    // The member's older dashboard second in its tabs, its newer one first: the newer is past (5 - 4 = 1).
    await boardOf(m1.id, 0x3201, 0, 1);
    await boardOf(m1.id, 0x3201, 1, 0);
    const older = hexOf(0x3201, 0x7000);
    const newer = hexOf(0x3201, 0x7001);
    const cookie = await signIn(m1.email);
    // A records database that would throw if a tile asked it anything.
    const trap = { prepare: () => { throw new Error("a tile was read"); }, batch: () => { throw new Error("a tile was read"); } };
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const first = await pageOf(`/account/dashboard${q}`, cookie, { RECORDS: trap });
      expect(first.status).toBe(200);
      expect(first.body).toContain(lang === "en"
        ? "This dashboard is saved and unavailable until the subscription has room for it: its 5 dashboards are in use. Its tiles are kept as they are."
        : "Ce tableau de bord est enregistré et indisponible jusqu'à ce que l'abonnement ait de la place pour lui : ses 5 tableaux de bord sont utilisés. Ses tuiles sont gardées telles quelles.");
      expect(first.body).not.toContain("dash-tile");
      expect(first.body).not.toContain("/dashboard.js");
      expect(first.body).toContain(lang === "en"
        ? "1 of this account's dashboards is saved and unavailable until the subscription has room: it holds more than its 5, and the subscriber's come first, then each seat's in the order it joined."
        : "1 élément de ce compte, parmi ses tableaux de bord, est enregistré et indisponible jusqu'à ce que l'abonnement ait de la place : il en détient plus que ses 5; ceux de l'abonné passent en premier, puis ceux de chaque siège dans l'ordre d'arrivée.");
      // Both tabs, the newer one marked; no New Dashboard while the subscription holds 6 of its 5.
      // The newer, first in the tabs, at the bare address; the older at its own.
      expect(first.body).toContain('<a href="/account/dashboard" aria-current="page" title="Board 2.');
      expect(first.body).toContain(`href="/account/dashboard/${older}"`);
      expect(marks(first.body, lang)).toBe(2); // the tab's own and its title
      expect(first.body).not.toContain('action="/account/dashboard/boards"');
      expect(first.body).not.toContain(EM_DASH);
      expect(first.body).not.toContain(EN_DASH);
      // The older one, in service: its tiles drawn, the newer tab still marked.
      const other = await pageOf(`/account/dashboard/${older}${q}`, cookie);
      expect(other.status).toBe(200);
      expect(other.body.match(/<section class="panel dash-tile/g)).toHaveLength(1);
      expect(marks(other.body, lang)).toBe(2);
      expect(count(other.sent, POOL_COUNTS_SQL)).toBe(1);
    }
    // A tile of the dashboard past the allowance is not drawn alone either.
    const csrf = /name="csrf" value="([0-9a-f]{32})"/.exec((await pageOf("/account/dashboard", cookie)).body)?.[1] ?? "";
    const tile = await app.request(`/account/dashboard/tiles/${hexOf(0x3201, 0x7801)}`, { headers: { cookie, "x-csrf-token": csrf, "cf-connecting-ip": nextIp() } }, sale());
    expect(tile.status).toBe(404);
    const ok = await app.request(`/account/dashboard/tiles/${hexOf(0x3201, 0x7800)}`, { headers: { cookie, "x-csrf-token": csrf, "cf-connecting-ip": nextIp() } }, sale());
    expect(ok.status).toBe(200);
    // The second member holds none, and its allowance is none: the line in place of the starting layout.
    const none = await pageOf("/account/dashboard", await signIn(m2.email), { RECORDS: trap });
    expect(none.body).toContain("This dashboard is saved and unavailable until the subscription has room for it");
    expect(none.body).not.toContain("dash-tile");
    // Room again (the holder deletes one): the newer dashboard is back with its tile, nothing having been deleted.
    await ACCOUNTS.batch(["DELETE FROM dashboard_tiles WHERE dashboard_id = ?", "DELETE FROM dashboards WHERE id = ?"]
      .map((sql) => ACCOUNTS.prepare(sql).bind(hexOf(0x3200, 0x7003))));
    const back = await pageOf(`/account/dashboard/${newer}`, cookie);
    expect(back.body.match(/<section class="panel dash-tile/g)).toHaveLength(1);
    expect(marks(back.body, "en")).toBe(0);
  });
});

// =====================================================================================

describe("the list pages", () => {
  it("state the group's count with the account's own, mark each row past the allowance and say so above them, in both languages", { timeout: 60_000 }, async () => {
    const g = await groupOf(0x4000, 1);
    const h = g.holder;
    const m = g.members[0];
    await searchesOf(h.id, 0x4000, 90, "off");
    await watchesOf(h.id, 0x4000, 98);
    await viewsOf(h.id, 0x4000, 48, "off");
    await keysOf(h.id, 0x4000, 4);
    await feedOf(h.id, 0x4000, 0, "watchlist");
    await feedOf(h.id, 0x4000, 1, "all");
    await feedOf(h.id, 0x4000, 2, "search", searchIds(0x4000, 1)[0]);
    await feedOf(h.id, 0x4000, 3, "search", searchIds(0x4000, 2)[1]);
    await searchesOf(m.id, 0x4001, 30, "off");
    await briefingsOf(m.id, 0x4001, 2, "off");
    await watchesOf(m.id, 0x4001, 5);
    await viewsOf(m.id, 0x4001, 4, "off");
    await keysOf(m.id, 0x4001, 2);
    await feedOf(m.id, 0x4001, 0, "search", searchIds(0x4001, 1)[0]);
    await feedOf(m.id, 0x4001, 1, "watchlist");
    const cookie = await signIn(m.email);
    const holder = await signIn(h.email);
    const EN = {
      searches: ["This subscription holds 122 of its 100 saved searches and briefings; 32 are this account's.",
        "22 of this account's saved searches and briefings are saved and unavailable until the subscription has room: it holds more than its 100, and the subscriber's come first, then each seat's in the order it joined."],
      feeds: ["This subscription holds 6 of its 5 calendar feeds; 2 are this account's.",
        "1 of this account's calendar feeds is saved and unavailable until the subscription has room: it holds more than its 5, and the subscriber's come first, then each seat's in the order it joined."],
      watches: ["This subscription holds 103 of its 100 watches; 5 are this account's.",
        "3 of this account's watches are saved and unavailable until the subscription has room: it holds more than its 100, and the subscriber's come first, then each seat's in the order it joined."],
      views: ["This subscription holds 52 of its 50 saved views; 4 are this account's.",
        "2 of this account's saved views are saved and unavailable until the subscription has room: it holds more than its 50, and the subscriber's come first, then each seat's in the order it joined."],
      keys: ["This subscription holds 6 of its 5 API keys; 2 are this account's.",
        "1 of this account's API keys is saved and unavailable until the subscription has room: it holds more than its 5, and the subscriber's come first, then each seat's in the order it joined."],
    };
    const FR = {
      searches: ["Cet abonnement détient 122 de ses 100 recherches enregistrées et bulletins; 32 appartiennent à ce compte.",
        "22 éléments de ce compte, parmi ses recherches enregistrées et bulletins, sont enregistrés et indisponibles jusqu'à ce que l'abonnement ait de la place : il en détient plus que ses 100; ceux de l'abonné passent en premier, puis ceux de chaque siège dans l'ordre d'arrivée."],
      feeds: ["Cet abonnement détient 6 de ses 5 flux de calendrier; 2 appartiennent à ce compte.",
        "1 élément de ce compte, parmi ses flux de calendrier, est enregistré et indisponible jusqu'à ce que l'abonnement ait de la place : il en détient plus que ses 5; ceux de l'abonné passent en premier, puis ceux de chaque siège dans l'ordre d'arrivée."],
      watches: ["Cet abonnement détient 103 de ses 100 suivis; 5 appartiennent à ce compte.",
        "3 éléments de ce compte, parmi ses suivis, sont enregistrés et indisponibles jusqu'à ce que l'abonnement ait de la place : il en détient plus que ses 100; ceux de l'abonné passent en premier, puis ceux de chaque siège dans l'ordre d'arrivée."],
      views: ["Cet abonnement détient 52 de ses 50 vues enregistrées; 4 appartiennent à ce compte.",
        "2 éléments de ce compte, parmi ses vues enregistrées, sont enregistrés et indisponibles jusqu'à ce que l'abonnement ait de la place : il en détient plus que ses 50; ceux de l'abonné passent en premier, puis ceux de chaque siège dans l'ordre d'arrivée."],
      keys: ["Cet abonnement détient 6 de ses 5 clés d'API; 2 appartiennent à ce compte.",
        "1 élément de ce compte, parmi ses clés d'API, est enregistré et indisponible jusqu'à ce que l'abonnement ait de la place : il en détient plus que ses 5; ceux de l'abonné passent en premier, puis ceux de chaque siège dans l'ordre d'arrivée."],
    };
    for (const [lang, L] of [["en", EN], ["fr", FR]] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const searches = await pageOf(`/account/searches${q}`, cookie);
      for (const line of [...L.searches, ...L.feeds]) expect(searches.body, line).toContain(line);
      // 20 searches and the 2 briefings past the allowance of 10.
      expect(marks(searches.body, lang)).toBe(22);
      expect(searches.body).toContain(lang === "en" ? '<span class="panel-count">122 of 100</span>' : '<span class="panel-count">122 sur 100</span>');
      expect(searches.body).toContain(lang === "en" ? '<span class="panel-count">6 of 5</span>' : '<span class="panel-count">6 sur 5</span>');
      expect(count(searches.sent, POOL_COUNTS_SQL)).toBe(1);
      const watches = await pageOf(`/account/watches${q}`, cookie);
      for (const line of L.watches) expect(watches.body, line).toContain(line);
      // 3 watches past the allowance of 2, and the watchlist feed past the feeds' (5 - 4 = 1, the search feed first).
      expect(marks(watches.body, lang)).toBe(4);
      expect(count(watches.sent, POOL_COUNTS_SQL)).toBe(1);
      const views = await pageOf(`/account/views${q}`, cookie);
      for (const line of L.views) expect(views.body, line).toContain(line);
      expect(marks(views.body, lang)).toBe(2);
      // No email select for the two past the allowance.
      expect(views.body.match(/<select name="deliver"/g)).toHaveLength(2);
      expect(views.body).toContain(lang === "en" ? "52 of 50 views" : "52 vues sur 50");
      const keys = await pageOf(`/account/keys${q}`, cookie);
      for (const line of L.keys) expect(keys.body, line).toContain(line);
      expect(marks(keys.body, lang)).toBe(1);
      expect(keys.body).not.toContain('action="/account/keys" class="stack"');
      for (const p of [searches, watches, views, keys]) {
        expect(p.status).toBe(200);
        expect(p.body).not.toContain(EM_DASH);
        expect(p.body).not.toContain(EN_DASH);
        // The pool's sentences name the group's total, the figure, the account's own and how many of its own are past, and no other count.
        for (const sentence of p.body.match(lang === "en" ? /This subscription holds [^<]*/g : /Cet abonnement détient [^<]*/g) ?? []) {
          for (const n of sentence.match(/\d+/g) ?? []) expect(["122", "100", "32", "6", "5", "2", "103", "52", "50", "4"], sentence).toContain(n);
        }
      }
    }
    // The holder's pages: the same totals with its own, nothing marked, no line on items past (the holder's are all in service).
    const hs = await pageOf("/account/searches", holder);
    expect(hs.body).toContain("This subscription holds 122 of its 100 saved searches and briefings; 90 are this account's.");
    expect(hs.body).not.toContain("of this account's saved searches and briefings are saved and unavailable");
    expect(marks(hs.body, "en")).toBe(0);
    const hk = await pageOf("/account/keys", holder);
    expect(hk.body).toContain("This subscription holds 6 of its 5 API keys; 4 are this account's.");
    expect(marks(hk.body, "en")).toBe(0);
    // A refused add names the subscription's count, the member's own beside it.
    const refused = await pageOf("/account/searches?m=cap", cookie);
    expect(refused.body).toContain('<p class="account-notice" role="status">This subscription holds 122 of its 100 saved searches and briefings; 32 are this account\'s.</p>');
  });

  it("show nothing of the pool once the member leaves: its things under its own plan's figures, saved, the holder alone again", async () => {
    const g = await groupOf(0x4100, 1);
    const m = g.members[0];
    await searchesOf(g.holder.id, 0x4100, 99, "off");
    await searchesOf(m.id, 0x4101, 4, "off");
    await viewsOf(m.id, 0x4101, 2, "off");
    const cookie = await signIn(m.email);
    expect((await pageOf("/account/searches", cookie)).body).toContain("This subscription holds 103 of its 100 saved searches and briefings; 4 are this account's.");
    await leave(g.seats[0]);
    const searches = await pageOf("/account/searches", cookie);
    expect(searches.body).not.toContain("This subscription holds");
    expect(marks(searches.body, "en")).toBe(0);
    expect(count(searches.sent, POOL_COUNTS_SQL)).toBe(0);
    // Free's own figure and its line, every search kept and listed.
    expect(searches.body).toContain("This account holds 4 of 3 saved searches and briefings.");
    for (let i = 1; i <= 4; i++) expect(searches.body).toContain(`>Pool search ${i}</a>`);
    // Free keeps no view: the two kept and listed, each marked as past the plan's own figure.
    const views = await pageOf("/account/views", cookie);
    expect(views.body).not.toContain("This subscription holds");
    expect(views.body.split("Past this plan's number of views").length - 1).toBe(2);
    const holder = await pageOf("/account/searches", await signIn(g.holder.email));
    expect(holder.body).not.toContain("This subscription holds");
    expect(count(holder.sent, POOL_COUNTS_SQL)).toBe(0);
  });
});
