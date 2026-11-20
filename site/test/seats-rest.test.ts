// Seats, the pool's places left after slice P2 (docs/accounts.md, Seats, The pool): the weekly email, the
// dashboard's tiles, the "all" calendar feed, the analytics index's Saved Views panel and the keys page's status.
// For an account in a group, each serves an item only to the account's allowance (src/account/pool.ts), its
// oldest first, and says where one is past it; the rest are saved and unavailable, and nothing is deleted.
//
// For an account in no group nothing changes: the first block holds every page, tile and feed this slice touches,
// and every statement each sends, to test/seats-rest-today.ts, captured from main before the change with these
// same fixtures (test/seats-rest-fixtures.ts). Every seat here is written by fixture, as test/seats-service.test.ts
// writes them, and every clock the code reads is fixed (NOW, the fixtures' own dates).
import { afterEach, describe, expect, it, vi } from "vitest";
import { STATE_SQL } from "../src/records_db";
import { RADAR_TOTAL_SQL } from "../src/records_tables";
import { runDeliveries } from "../src/account/deliveries";
import { SAVED_SEARCH_MAX } from "../src/account/entitlements";
import { FEED_SEARCHES_SERVED_SQL, FEED_SEARCHES_SQL, FEED_SERVED_SQL, forgetFeeds, readFeed } from "../src/account/feeds";
import { POOL_COUNTS_SQL } from "../src/account/pool";
import { BUYER_COUNTS_SQL } from "../src/account/records_deliveries";
import { app } from "../src/index";
import { makeFakeAssets } from "./assets";
import stats from "./fixtures/stats.json";
import { ACCOUNTS, decode, nbsp, nextIp, signIn, useAccountsDb } from "./accounts-helpers";
import { fakeMail } from "./mail-fixtures";
import { type Fixed, RECORDS, account, hexOf, noGroupSeen, recording, recordsAt, sale } from "./seats-rest-fixtures";
import { SEEN, STATEMENTS } from "./seats-rest-today";

useAccountsDb();

afterEach(() => {
  vi.restoreAllMocks();
  forgetFeeds();
});

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const MARK = { en: "Saved, unavailable until there is room", fr: "Enregistré, indisponible jusqu'à ce qu'il y ait de la place" } as const;
const marks = (body: string, lang: "en" | "fr") => body.split(MARK[lang]).length - 1;
const count = (sent: readonly string[], sql: string) => sent.filter((s) => s === sql).length;

// =====================================================================================

describe("an account in no group", () => {
  it("reads and draws, on the analytics index, the dashboard and its tiles, the searches and keys pages and its calendar feeds, what main did",
    { timeout: 60_000 }, async () => {
      const now = await noGroupSeen(signIn);
      expect(Object.keys(now).sort()).toEqual(Object.keys(SEEN).sort());
      for (const [key, today] of Object.entries(SEEN)) {
        expect(now[key], key).toEqual({
          status: today.status, body: today.body, accounts: today.accounts.map((i) => STATEMENTS[i]), records: today.records.map((i) => STATEMENTS[i]),
        });
        for (const sql of [POOL_COUNTS_SQL, FEED_SERVED_SQL, FEED_SEARCHES_SERVED_SQL]) expect(now[key].accounts, key).not.toContain(sql);
      }
      // The feeds' statement is the one it always was, word for word.
      expect(FEED_SEARCHES_SQL).toBe("SELECT id, params, label, lang FROM saved_searches WHERE user_id = ? AND kind = ? AND (? = '' OR id = ?) ORDER BY created_at, id");
    });
});

// =====================================================================================
// Groups, written by fixture.

const T0 = Date.UTC(2026, 1, 1);
// A time in February, minutes and seconds after its first moment: each kind of item its own minute, each item its second.
const when = (minutes: number, i = 0) => new Date(T0 + minutes * 60_000 + i * 1000).toISOString();

type Group = { holder: Fixed; members: Fixed[] };

// An Ultra holder and n members, each on Free of its own and covered by the holder's plan, joined in order.
async function groupOf(tag: number, n: number): Promise<Group> {
  const holder = await account(tag, `rest-g${tag.toString(16)}-h@example.com`, "ultra");
  const members: Fixed[] = [];
  for (let i = 1; i <= n; i++) {
    const m = await account(tag + i, `rest-g${tag.toString(16)}-m${i}@example.com`, "free");
    await ACCOUNTS.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").bind(m.id).run();
    await ACCOUNTS.prepare("INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id, joined_at) VALUES (?, ?, 'en', ?, ?, ?, ?)")
      .bind(hexOf(tag + i, 0xfff), holder.id, when(i * 60 - 1), "2026-12-31T00:00:00.000Z", m.id, when(i * 60)).run();
    members.push(m);
  }
  return { holder, members };
}

async function rows(n: number, f: (i: number) => D1PreparedStatement): Promise<void> {
  for (let i = 0; i < n; i += 50) await ACCOUNTS.batch(Array.from({ length: Math.min(50, n - i) }, (_, k) => f(i + k)));
}
// The holder's fill: n of an item, each its own, made before any member's.
const searchesOf = (user: string, tag: number, n: number) => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, 'off')",
).bind(hexOf(tag, 0x1000 + i), user, `/tenders?q=zzrest${tag.toString(16)}n${i}`, `Fill search ${i + 1}`, when(1000, i)));
const watchesOf = (user: string, tag: number, n: number) => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'buyer', ?, '', ?, 'award', 'daily', ?, '2026-10-30')",
).bind(hexOf(tag, 0x3000 + i), user, `fill-${tag.toString(16)}-${i}`, `Fill watch ${i + 1}`, when(1000, i)));
const viewsOf = (user: string, tag: number, n: number) => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, ?, 'en', 'off', ?)",
).bind(hexOf(tag, 0x4000 + i), user, `/buyers/pwgsc-tpsgc/analytics?source=awards&years=${(i % 20) + 1}&from=x${i}`, `Fill view ${i + 1}`, when(1000, i)));
const keysOf = (user: string, tag: number, n: number) => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, 'ffff0000', ?)",
).bind(hexOf(tag, 0x5000 + i), user, `Fill key ${i + 1}`, hexOf(tag, 0x5a00 + i) + hexOf(tag, 0x5b00 + i), when(1000, i)));

// A member's own item, made at its own minute (each later than every fill).
const search = (user: string, id: string, kind: string, params: string, label: string, minute: number) => ACCOUNTS.prepare(
  "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, ?, ?, ?, 'en', ?, 'off')",
).bind(id, user, kind, params, label, when(minute)).run();
const briefing = (user: string, id: string, minute: number) => ACCOUNTS.prepare(
  "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'segment', '81', '', '81 Engineering', 'en', ?, 'off')",
).bind(id, user, when(minute)).run();
const watch = (user: string, id: string, target: string, label: string, minute: number) => ACCOUNTS.prepare(
  "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'buyer', ?, '', ?, 'award', 'daily', ?, '2026-10-30')",
).bind(id, user, target, label, when(minute)).run();
const view = (user: string, id: string, years: number, name: string, minute: number) => ACCOUNTS.prepare(
  "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, ?, 'en', 'off', ?)",
).bind(id, user, `/buyers/pwgsc-tpsgc/analytics?source=awards&years=${years}`, name, when(minute)).run();
const key = (user: string, id: string, name: string, minute: number) => ACCOUNTS.prepare(
  "INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)",
).bind(id, user, name, id + id, id.slice(-8), when(minute)).run();

// Award notices in the week, one on each buyer named.
const ev = (k: number, day: string, buyer: string) => RECORDS.prepare(
  "INSERT INTO rec_events (k, day, kind, src, buyer, ref, title, path) VALUES (?, ?, 'award', 1, ?, ?, ?, ?)",
).bind(k, day, buyer, `award:rest-${k}`, `Award to ${buyer}`, `/awards/rest-${k}`);

// A page as a reader gets it, its body with entities and no-break spaces made plain, and the statements it sent.
async function pageOf(path: string, cookie: string, extra: Record<string, unknown> = {}) {
  const a = recording(ACCOUNTS);
  const r = recording(RECORDS);
  const res = await app.request(path, { headers: { cookie, "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, sale({ ACCOUNTS: a.db, RECORDS: r.db, ...extra }));
  return { status: res.status, body: nbsp(decode(await res.text())).replace(/’/g, "'"), accounts: a.sent, records: r.sent };
}
// One tile's section in a page.
const tileOf = (body: string, id: string) => new RegExp(`<section[^>]*id="tile-${id}"[\\s\\S]*?</section>`).exec(body)?.[0] ?? "";

// =====================================================================================

describe("the weekly email", () => {
  it("covers a member's watches to its allowance of the subscription's figure, oldest first; the holder's all of its own",
    { timeout: 60_000 }, async () => {
      const day = "2026-11-02";
      await recordsAt(day);
      const g = await groupOf(0x5100, 1);
      const m = g.members[0];
      // The holder 99 watches: the member's allowance is 1 of its 3.
      await watchesOf(g.holder.id, 0x5100, 99);
      const targets = ["rest-buyer-a", "rest-buyer-b", "rest-buyer-c"];
      for (let i = 0; i < 3; i++) await watch(m.id, hexOf(0x5101, 0x300 + i), targets[i], `Rest watch ${i + 1}`, 3000 + i);
      await RECORDS.batch([...targets.map((b, i) => ev(9000 + i, "2026-10-29", b)), ev(9010, "2026-10-29", "fill-5100-0")]);
      for (const u of [m.id, g.holder.id]) {
        await ACCOUNTS.prepare("INSERT INTO weekly_mail (user_id, mail, via, on_at, created_at) VALUES (?, 'on', 'account', '2026-10-20T09:00:00.000Z', '2026-10-20T09:00:00.000Z')")
          .bind(u).run();
      }
      const files: Record<string, unknown> = { "stats.json": { ...stats, data_as_of: day } };
      for (let i = 0; i < 8; i++) files[`tenders/new/${new Date(Date.parse(day) - i * 86_400_000).toISOString().slice(0, 10)}.json`] = [];
      const mail = fakeMail();
      const r = recording(ACCOUNTS);
      await runDeliveries(sale({
        ACCOUNTS: r.db, ASSETS: makeFakeAssets({}, files), MAIL: mail.binding, MAIL_FROM: "alerts@awardwatch.ca", MAIL_SENDER: undefined,
        SITE_URL: "https://awardwatch.ca", RECORDS, NOW: `${day}T16:00:00Z`, MAIL_ADDRESS: "1 Example Street, Example City",
      }) as never);
      const [week] = mail.to(m.email).filter((x) => x.subject.startsWith("Your week"));
      expect(week, mail.handed.map((x) => `${x.to} ${x.subject}`).join("\n")).toBeDefined();
      // The first by creation, and the lead counts the one page the allowance covers.
      expect(week.text).toContain("Rest watch 1");
      expect(week.text).not.toContain("Rest watch 2");
      expect(week.text).not.toContain("Rest watch 3");
      expect(week.text).toContain("on the page you follow");
      expect(week.html).not.toContain("Rest watch 2");
      // The holder's first watch, its own, in its own message.
      const [own] = mail.to(g.holder.email).filter((x) => x.subject.startsWith("Your week"));
      expect(own.text).toContain("Fill watch 1");
      // The group's counts read once in the run, for the member alone.
      expect(count(r.sent, POOL_COUNTS_SQL)).toBe(1);
      for (const x of [week, own]) {
        expect(x.text).not.toContain(EM_DASH);
        expect(x.text).not.toContain(EN_DASH);
      }
    });
});

// =====================================================================================

describe("the dashboard's tiles", () => {
  it("say so in place of the body of a tile whose item is past a member's allowance and read nothing for it; the watches tile reads the watches the allowance covers",
    { timeout: 60_000 }, async () => {
      await recordsAt("2026-10-31");
      const g = await groupOf(0x5200, 2);
      const [m, m2] = g.members;
      const T = 0x5201;
      // The holder's fills: 98 searches (the member's allowance 2), 98 watches (2), 49 views (1), 4 keys (1).
      await searchesOf(g.holder.id, 0x5200, 98);
      await watchesOf(g.holder.id, 0x5200, 98);
      await viewsOf(g.holder.id, 0x5200, 49);
      await keysOf(g.holder.id, 0x5200, 4);
      // The member's own, oldest first: two tender searches in service, then a briefing, an expiring search and a
      // buyer's records search past; three watches, the third past; two views and two keys, the second of each past.
      const id = (n: number) => hexOf(T, n);
      await search(m.id, id(0x101), "tenders", "/tenders?q=translation", "Rest tenders 1", 2000);
      await search(m.id, id(0x102), "tenders", "/tenders?q=hull", "Rest tenders 2", 2001);
      await briefing(m.id, id(0x103), 2002);
      await search(m.id, id(0x104), "expiring", "/expiring/3m", "Rest ending", 2003);
      await search(m.id, id(0x105), "buyer", "/buyers/dnd-mdn", "Rest records", 2004);
      for (let i = 0; i < 3; i++) await watch(m.id, id(0x300 + i), `rest-dash-${i}`, `Rest watch ${i + 1}`, 3000 + i);
      await RECORDS.batch([0, 1, 2].map((i) => ev(9100 + i, "2026-10-30", `rest-dash-${i}`)));
      await view(m.id, id(0x401), 3, "Rest view 1", 4000);
      await view(m.id, id(0x402), 5, "Rest view 2", 4001);
      await key(m.id, id(0x501), "Rest key 1", 5000);
      await key(m.id, id(0x502), "Rest key 2", 5001);
      // The member's dashboard: a tile of each.
      const board = id(0x700);
      const tiles: [number, string, string][] = [
        [0, "tenders", id(0x101)], [1, "tenders", id(0x102)], [2, "briefing", id(0x103)], [3, "radar", id(0x104)], [4, "records", id(0x105)],
        [5, "radar", "3m"], [6, "view", id(0x401)], [7, "view", id(0x402)], [8, "watches", ""], [9, "api", ""],
        [10, "analytic", "/buyers/pwgsc-tpsgc/analytics?source=awards&years=5#table-quarters"],
      ];
      await ACCOUNTS.batch([
        ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', 0, ?)").bind(board, m.id, when(7000)),
        ...tiles.map(([i, kind, ref]) => ACCOUNTS.prepare(
          "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, '', 0, ?, 12, 6, ?)",
        ).bind(id(0x780 + i), board, m.id, kind, ref, i * 6, when(7000, i))),
      ]);
      const cookie = await signIn(m.email);
      const past = [2, 3, 4, 7];
      for (const lang of ["en", "fr"] as const) {
        const q = lang === "fr" ? "?lang=fr" : "";
        const p = await pageOf(`/account/dashboard${q}`, cookie);
        expect(p.status).toBe(200);
        // Each tile past the allowance: its head and the line in place of its body, no Open.
        for (const i of past) {
          const s = tileOf(p.body, id(0x780 + i));
          expect(s, `tile ${i}`).toContain(`<div class="dash-body"><p>${MARK[lang]}</p></div>`);
          expect(s, `tile ${i}`).not.toContain(lang === "en" ? ">Open</a>" : ">Ouvrir</a>");
        }
        // Each keeps its item's name in its head (a briefing's in the page's language).
        expect(tileOf(p.body, id(0x782))).toContain('<span class="dash-item">81 ');
        expect(tileOf(p.body, id(0x783))).toContain("Rest ending");
        expect(tileOf(p.body, id(0x784))).toContain("Rest records");
        expect(tileOf(p.body, id(0x787))).toContain("Rest view 2");
        // The tiles in service draw as before (the keys' tile marks its one key past, below).
        for (const i of [0, 1, 5, 6, 8, 10]) expect(tileOf(p.body, id(0x780 + i)), `tile ${i}`).not.toContain(MARK[lang]);
        expect(tileOf(p.body, id(0x780))).toContain(lang === "en" ? ">Open</a>" : ">Ouvrir</a>");
        // The watches tile: the events of the two watches the allowance covers, none of the third's.
        const w = tileOf(p.body, id(0x788));
        expect(w).toContain("Rest watch 1");
        expect(w).toContain("Rest watch 2");
        expect(w).not.toContain("Rest watch 3");
        // The keys' tile: the second key marked, the first not.
        const k = tileOf(p.body, id(0x789));
        expect(k).toContain(`Rest key 2<br/><span class="muted small mono">aw_${id(0x502).slice(-8)}_</span><br/><span class="muted small">${MARK[lang]}</span>`);
        expect(k).toContain(`Rest key 1<br/><span class="muted small mono">aw_${id(0x501).slice(-8)}_</span></td>`);
        // Four tiles and a key: the marks the page carries.
        expect(marks(p.body, lang)).toBe(5);
        // One read of the group's counts and nothing more on the accounts database; nothing read for the tiles past.
        expect(count(p.accounts, POOL_COUNTS_SQL)).toBe(1);
        expect(p.records).not.toContain(BUYER_COUNTS_SQL);
        expect(count(p.records, RADAR_TOTAL_SQL)).toBe(1);
        // The page's one records batch and the watches' own.
        expect(count(p.records, STATE_SQL)).toBe(2);
        expect(p.body).not.toContain(EM_DASH);
        expect(p.body).not.toContain(EN_DASH);
      }
      // The same tile read alone, as the page's script asks for it after a resize: the line, nothing read for it.
      const token = /name="csrf" value="([0-9a-f]{32})"/.exec((await pageOf("/account/dashboard", cookie)).body)?.[1] ?? "";
      const r = recording(RECORDS);
      const one = await app.request(`/account/dashboard/tiles/${id(0x784)}?w=12&h=8`, { headers: { cookie, "x-csrf-token": token, "cf-connecting-ip": nextIp() } },
        sale({ RECORDS: r.db }));
      expect(one.status).toBe(200);
      expect(await one.text()).toContain(`<div class="dash-body"><p>${MARK.en}</p></div>`);
      expect(r.sent).toEqual([]);
      // The second member: its allowance of the watches is none (100 - 98 - 3), so its watches tile says so and reads nothing.
      await watch(m2.id, hexOf(0x5202, 0x300), "rest-dash-9", "Second's watch", 3100);
      await ACCOUNTS.batch([
        ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', 0, ?)").bind(hexOf(0x5202, 0x700), m2.id, when(7100)),
        ACCOUNTS.prepare("INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, 'watches', '', '', 0, 0, 12, 6, ?)")
          .bind(hexOf(0x5202, 0x780), hexOf(0x5202, 0x700), m2.id, when(7100)),
      ]);
      const second = await pageOf("/account/dashboard", await signIn(m2.email));
      expect(tileOf(second.body, hexOf(0x5202, 0x780))).toContain(`<div class="dash-body"><p>${MARK.en}</p></div>`);
      expect(second.records).toEqual([]);
      // The holder's own dashboard reads every one of its items: its allowance is the whole figure.
      await ACCOUNTS.batch([
        ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', 0, ?)").bind(hexOf(0x5200, 0x700), g.holder.id, when(7200)),
        ACCOUNTS.prepare("INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, 'tenders', ?, '', 0, 0, 12, 6, ?)")
          .bind(hexOf(0x5200, 0x780), hexOf(0x5200, 0x700), g.holder.id, hexOf(0x5200, 0x1000 + 97), when(7200)),
      ]);
      const holder = await pageOf("/account/dashboard", await signIn(g.holder.email));
      expect(marks(holder.body, "en")).toBe(0);
      expect(tileOf(holder.body, hexOf(0x5200, 0x780))).toContain("Fill search 98");
    });
});

// =====================================================================================

describe("the \"all\" calendar feed", () => {
  it("lists a member's tender searches its allowance covers, as a search's own feed is refused past it, with no statement more; the holder's every one",
    { timeout: 60_000 }, async () => {
      const g = await groupOf(0x5300, 1);
      const m = g.members[0];
      const T = 0x5301;
      // The holder 97 searches: the member's allowance is 3, its briefing first, then its first two tender searches.
      await searchesOf(g.holder.id, 0x5300, 97);
      await briefing(m.id, hexOf(T, 0x200), 1900);
      await search(m.id, hexOf(T, 0x101), "tenders", "/tenders?q=translation", "Rest translation", 2000);
      await search(m.id, hexOf(T, 0x102), "tenders", "/tenders?q=hull", "Rest hull", 2001);
      await search(m.id, hexOf(T, 0x103), "tenders", "/tenders?q=laptops", "Rest laptops", 2002);
      const feed = async (user: string, tag: number) => {
        await ACCOUNTS.prepare("INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) VALUES (?, ?, 'all', NULL, ?, ?)")
          .bind(hexOf(tag, 0x600), user, hexOf(tag, 0x6a0), when(6000)).run();
        return { id: hexOf(tag, 0x600), secret: hexOf(tag, 0x6a0) };
      };
      const mf = await feed(m.id, T);
      const hf = await feed(g.holder.id, 0x5300);
      const now = new Date("2026-10-31T16:00:00Z");
      const read = async (f: { id: string; secret: string }) => {
        const r = recording(ACCOUNTS);
        const out = await readFeed(sale({ ACCOUNTS: r.db }) as never, f.id, f.secret, now);
        return { out, sent: r.sent };
      };
      const member = await read(mf);
      expect(member.out.state).toBe("ok");
      if (member.out.state !== "ok") return;
      expect(member.out.feed.searches.map((s) => s.label)).toEqual(["Rest translation", "Rest hull"]);
      expect(count(member.sent, FEED_SERVED_SQL)).toBe(1);
      expect(count(member.sent, FEED_SEARCHES_SERVED_SQL)).toBe(1);
      expect(member.sent).not.toContain(FEED_SEARCHES_SQL);
      const holder = await read(hf);
      if (holder.out.state !== "ok") throw new Error("the holder's feed");
      expect(holder.out.feed.searches).toHaveLength(97);
      expect(holder.sent).not.toContain(FEED_SERVED_SQL);
      expect(holder.sent).not.toContain(FEED_SEARCHES_SERVED_SQL);
      expect(count(holder.sent, FEED_SEARCHES_SQL)).toBe(1);
      // The file a calendar app reads: the two notices the covered searches match, not the third's.
      const ics = await (await app.request(`/account/calendar/${mf.id}.ics?t=${mf.secret}`, { headers: { "cf-connecting-ip": nextIp() } }, sale())).text();
      expect(ics).toContain("cb-100-10000001");
      expect(ics).toContain("cb-200-20005019");
      expect(ics).not.toContain("cb-300-30000003");
      // The searches page counts the feed as the feed lists it, and marks the third search.
      const page = await pageOf("/account/searches", await signIn(m.email));
      expect(page.body).toContain("2 events today");
      expect(page.body).not.toContain("3 events today");
      // One search more by the holder: the member's allowance is 2, its briefing and its first search.
      await search(g.holder.id, hexOf(0x5300, 0x2000), "tenders", "/tenders?q=zzrestmore", "Fill more", 1500);
      forgetFeeds();
      const after = await read(mf);
      if (after.out.state !== "ok") throw new Error("the member's feed");
      expect(after.out.feed.searches.map((s) => s.label)).toEqual(["Rest translation"]);
    });

  it("reads FEED_SEARCHES_SERVED_SQL through the index on user_id of each table it counts, with no scan", async () => {
    const steps = ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${FEED_SEARCHES_SERVED_SQL}`).bind(hexOf(1, 1), "tenders", 3).all<{ detail: string }>()).results ?? [])
      .map((r) => r.detail);
    for (const table of ["s", "x"]) {
      expect(steps.some((d) => new RegExp(`^SEARCH ${table} USING (?:COVERING )?INDEX \\w+ \\(user_id=\\?`).test(d)), `${table}: ${steps.join(" | ")}`).toBe(true);
    }
    expect(steps.filter((d) => /^SCAN (?!CONSTANT ROW)/.test(d))).toEqual([]);
    // It lists, so it ends in a bound: the most saved searches any plan keeps.
    expect(FEED_SEARCHES_SERVED_SQL).toMatch(new RegExp(` LIMIT ${SAVED_SEARCH_MAX}$`));
  });
});

// =====================================================================================

describe("the analytics index's Saved Views panel and the keys page", () => {
  it("state the subscription's views with the account's own, mark each past the allowance; a key past it is not In use", { timeout: 60_000 }, async () => {
    const g = await groupOf(0x5400, 1);
    const m = g.members[0];
    const T = 0x5401;
    await viewsOf(g.holder.id, 0x5400, 48);
    await keysOf(g.holder.id, 0x5400, 4);
    for (let i = 0; i < 4; i++) await view(m.id, hexOf(T, 0x400 + i), [3, 5, 10, 20][i], `Rest view ${i + 1}`, 4000 + i);
    await key(m.id, hexOf(T, 0x501), "Rest key 1", 5000);
    await key(m.id, hexOf(T, 0x502), "Rest key 2", 5001);
    const cookie = await signIn(m.email);
    const L = {
      en: ["52 of 50 views", "This subscription holds 52 of its 50 saved views; 4 are this account's.",
        "2 of this account's saved views are saved and unavailable until the subscription has room: it holds more than its 50, and the subscriber's come first, then each seat's in the order it joined."],
      fr: ["52 vues sur 50", "Cet abonnement détient 52 de ses 50 vues enregistrées; 4 appartiennent à ce compte.",
        "2 éléments de ce compte, parmi ses vues enregistrées, sont enregistrés et indisponibles jusqu'à ce que l'abonnement ait de la place : il en détient plus que ses 50; ceux de l'abonné passent en premier, puis ceux de chaque siège dans l'ordre d'arrivée."],
    };
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const index = await pageOf(`/analytics${q}`, cookie);
      expect(index.status).toBe(200);
      for (const line of L[lang]) expect(index.body, line).toContain(line);
      expect(marks(index.body, lang)).toBe(2);
      expect(index.body).toContain(`>Rest view 3</a><br/><span class="muted small">${MARK[lang]}</span></li>`);
      expect(index.body).toContain(">Rest view 2</a></li>");
      expect(count(index.accounts, POOL_COUNTS_SQL)).toBe(1);
      expect(index.body).not.toContain(EM_DASH);
      expect(index.body).not.toContain(EN_DASH);
      // The keys page: the second key's status says it is not served, in place of In use; the first is in use.
      const keys = await pageOf(`/account/keys${q}`, cookie);
      expect(keys.body).toContain(`<span class="muted">${MARK[lang]}</span>`);
      expect(keys.body.split(lang === "en" ? "<span>In use</span>" : "<span>En service</span>").length - 1).toBe(1);
      expect(keys.body).toContain(">Rest key 2</td>");
      expect(marks(keys.body, lang)).toBe(1);
    }
    // The holder: the same total with its own, nothing marked.
    const holder = await pageOf("/analytics", await signIn(g.holder.email));
    expect(holder.body).toContain("This subscription holds 52 of its 50 saved views; 48 are this account's.");
    expect(marks(holder.body, "en")).toBe(0);
  });
});
