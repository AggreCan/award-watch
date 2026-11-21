// Seats, slice C2, with the switch on (SEATS "on"; the seats design's 3.4, 5.2, 5.7, 5.8 and 6): what the seats
// say elsewhere. The plan cards' seats row, each plan its own figure from PLAN_SEATS; /pro's Ultra text and its
// question; the Terms' Seats section and the abuse phrase; the privacy page's paragraph; the Ultra message; the
// line a control reads where the SUBSCRIPTION is full, for a member (naming the holder from its own session) and
// for the holder (pointing to the Seats page), and the line an account in no group still reads, byte for byte;
// the delete page; the console's actions on a holder's seats, with their guard, confirmation and audit; and the
// join page's GET, which writes nothing and offers Take the seat only where the take could pass. Every clock here
// is the real one: each row a fixture writes is placed relative to it. test/seats-switch.test.ts holds the site
// with the switch off to the capture from main.
import { env as bindings } from "cloudflare:test";
import { jsx } from "hono/jsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ultraLinks, ultraMessageLines, ultraOpenMessage, ULTRA_MESSAGE_LINES } from "../src/account/announce";
import { KEYS_MAX } from "../src/account/api_keys";
import { PLAN_SEATS, memberSeats } from "../src/account/entitlements";
import { FEEDS_MAX } from "../src/account/feeds";
import { mailCheckMessages } from "../src/account/mail_check";
import { SEATS_IN_USE_SQL, SEAT_INVITE_DAYS, SEAT_KEEP_DAYS, SEAT_WINDOW_DAYS, joinsAllowed } from "../src/account/seats";
import { SEATS_STRINGS } from "../src/account/seats_strings";
import { SESSIONS_MAX } from "../src/account/session";
import { SaveViewRow } from "../src/account/view_pages";
import { t, type Key, type Lang } from "../src/i18n";
import { app } from "../src/index";
import { RailContext, STYLES_VERSION } from "../src/layout";
import { PLAN_LINE_MAX, SEATS_ROW, planLine, planRows, seatsWording, ultraLineKeys, ultraLines } from "../src/pro";
import {
  ACCOUNTS, PRO_SALE, ULTRA_VARS, csrf, decode, get, grantPro, grantUltra, lastMail, nbsp, newEmail, nextIp, onEnv, post, signIn, useAccountsDb,
  userId, withoutSeats,
} from "./accounts-helpers";

useAccountsDb();

afterEach(() => {
  vi.restoreAllMocks();
});

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const ON = (extra: Record<string, unknown> = {}) => onEnv({ SEATS: "on", ...extra });
const OFF = (extra: Record<string, unknown> = {}) => onEnv({ SEATS: "off", ...extra });
const SALE = { ...PRO_SALE, ...ULTRA_VARS };
const DAY_MS = 86_400_000;
const iso = (days: number, ms = 0) => new Date(Date.now() + days * DAY_MS + ms).toISOString();
const hexId = () => crypto.randomUUID().replace(/-/g, "");
const text = (s: string) => nbsp(decode(s)).replace(/’/g, "'");
const line = (lang: Lang, key: Key, vars?: Record<string, string | number>) => text(t(lang, key, vars));
const read = async (res: Response) => text(await res.text());
const seatWords = (lang: Lang, n: number) => line(lang, n === 1 ? "seats.seat_one" : "seats.seat_many", { n });
const things = (lang: Lang, key: Key) => line(lang, key);

// -- people and their items --------------------------------------------------------------------------------

type Person = { email: string; id: string; cookie: string };

async function person(tag: string, plan: "free" | "pro" | "ultra" = "free", env: object = ON()): Promise<Person> {
  const email = newEmail(tag);
  const cookie = await signIn(email, { env });
  if (plan === "ultra") await grantUltra(email);
  if (plan === "pro") await grantPro(email);
  return { email, id: await userId(email), cookie };
}

async function seatRow(holder: string, o: { member?: string; joined?: number; email?: string; invited?: number; hash?: string | null }): Promise<string> {
  const id = hexId();
  const invited = o.invited ?? (o.joined !== undefined ? o.joined - 1 : 0);
  await ACCOUNTS.prepare(
    "INSERT INTO seats (id, holder_id, email, token_hash, lang, invited_at, expires_at, member_id, joined_at) VALUES (?, ?, ?, ?, 'en', ?, ?, ?, ?)",
  ).bind(
    id, holder, o.member ? null : o.email ?? newEmail("fixture"), o.member ? null : o.hash === undefined ? "f".repeat(64) : o.hash, iso(invited),
    iso(invited + SEAT_INVITE_DAYS), o.member ?? null, o.member ? iso(o.joined ?? 0) : null,
  ).run();
  return id;
}

async function batched(stmts: D1PreparedStatement[]): Promise<void> {
  for (let i = 0; i < stmts.length; i += 50) await ACCOUNTS.batch(stmts.slice(i, i + 50));
}

// An account at every figure Ultra pools: 100 saved searches (3 of them tender lists with their feeds), 100
// watches, 50 saved views, 5 keys, 5 calendar feeds (the 3 searches', the watches' and the "all" one) and 5
// dashboards, made at fixed steps a year ago so none is the newest of anything a test adds.
async function atEveryFigure(user: string): Promise<void> {
  const s: D1PreparedStatement[] = [];
  const searchIds: string[] = [];
  for (let i = 0; i < 100; i++) {
    const id = hexId();
    searchIds.push(id);
    s.push(ACCOUNTS.prepare("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, 'off')")
      .bind(id, user, `/tenders?q=full${i}`, `Full search ${i + 1}`, iso(-365, i * 1000)));
  }
  for (let i = 0; i < 100; i++) {
    s.push(ACCOUNTS.prepare(
      "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at) VALUES (?, ?, 'buyer', ?, '', ?, 'award', 'daily', ?)",
    ).bind(hexId(), user, `buyer-full-${i}`, `Watched ${i + 1}`, iso(-365, i * 1000)));
  }
  for (let i = 0; i < 50; i++) {
    s.push(ACCOUNTS.prepare("INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, ?, 'en', 'off', ?)")
      .bind(hexId(), user, `/buyers/pwgsc-tpsgc/analytics?source=awards&t=${i}`, `View ${i + 1}`, iso(-365, i * 1000)));
  }
  for (let i = 0; i < KEYS_MAX; i++) {
    s.push(ACCOUNTS.prepare("INSERT INTO api_keys (id, user_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(hexId(), user, `Key ${i + 1}`, hexId() + hexId(), hexId().slice(0, 8), iso(-365, i * 1000)));
  }
  const feeds: [string, string | null][] = [["search", searchIds[0]], ["search", searchIds[1]], ["search", searchIds[2]], ["watchlist", null], ["all", null]];
  for (const [i, [kind, search]] of feeds.entries()) {
    s.push(ACCOUNTS.prepare("INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(hexId(), user, kind, search, hexId(), iso(-365, i * 1000)));
  }
  for (let i = 0; i < 5; i++) {
    s.push(ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', ?, ?)").bind(hexId(), user, i, iso(-365, i * 1000)));
  }
  await batched(s);
}

// A holder whose group is at every figure, with one member who holds nothing; and an Ultra account alone at
// the same figures.
async function fullGroup(tag: string, env: object = ON()) {
  const h = await person(`${tag}-h`, "ultra", env);
  const m = await person(`${tag}-m`, "free", env);
  await seatRow(h.id, { member: m.id, joined: -3 });
  await atEveryFigure(h.id);
  return { h, m };
}

const SAVE_LIST = "/tenders?segment=82&province=BC&sort=published";
const ORG = "/organizations/org-a000000001";
const SEGMENT = "/segments/82";

// The member's line and the holder's for a figure, as a page reads them.
const memberLine = (lang: Lang, figure: Key, cap: number, holder: string) =>
  line(lang, "pool.full", { cap, things: things(lang, figure), holder });
const holderText = (lang: Lang, figure: Key, cap: number) =>
  line(lang, "pool.full_holder", { cap, things: things(lang, figure), seats: line(lang, "pool.full_seats") });
// The holder's line with the Seats page linked, as markup reads once tags are taken out.
const holderLinked = (lang: Lang) => `<a href="/account/seats${lang === "fr" ? "?lang=fr" : ""}">${line(lang, "pool.full_seats")}</a>`;

// =========================================================================================================
// 1. The plan cards
// =========================================================================================================

const cardsOf = (page: string) => page.split(/(?=<div class="plan-card[ "])/).slice(1);
const firstRow = (card: string) => /<ul class="plan-list"><li>[\s\S]*?<span>([^<]*)<\/span><\/li>/.exec(card)?.[1] ?? null;

describe("the plan cards", () => {
  it("draw the seats row first on every card while the switch is on, each plan its own figure from PLAN_SEATS, in both languages", async () => {
    expect(PLAN_SEATS).toEqual({ free: 1, pro: 1, ultra: 5 });
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const on = await read(await get(`/pro${q}`, { env: ON(SALE) }));
      const cards = cardsOf(on);
      expect(cards, lang).toHaveLength(3);
      const want = (["free", "pro", "ultra"] as const).map((p) => text(planLine(lang, seatsWording(p))));
      expect(cards.map(firstRow), lang).toEqual(want);
      expect(want, lang).toEqual(lang === "en" ? ["1 seat", "1 seat", "5 seats sharing these figures"] : ["1 siège", "1 siège", "5 sièges qui partagent ces chiffres"]);
      const rows = planRows(["free", "pro", "ultra"], { seats: true });
      expect(rows[0]).toBe(SEATS_ROW);
      expect(on, lang).toContain(`--plan-rows:${rows.length};`);
      // Off, absent: the rows of before, and no seat named on any card.
      const off = await read(await get(`/pro${q}`, { env: OFF(SALE) }));
      expect(off, lang).toContain(`--plan-rows:${planRows(["free", "pro", "ultra"]).length};`);
      for (const w of want) expect(cardsOf(off).join(""), lang).not.toContain(`<span>${w}</span>`);
    }
  });

  it("put the row on the billing page, the tease panels, the dashboard's tease and the saved views' gate, and on none while the table is absent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const free = await person("cards-free");
    const pro = await person("cards-pro", "pro");
    const pages: [string, string | undefined][] = [
      ["/account/billing", free.cookie], ["/tenders/same-day", undefined], ["/account/dashboard", pro.cookie], ["/account/views", free.cookie],
    ];
    for (const [path, cookie] of pages) {
      const page = await read(await get(path, { cookie, env: ON(SALE) }));
      const cards = cardsOf(page);
      expect(cards.length, path).toBeGreaterThan(1);
      for (const card of cards) expect(firstRow(card), path).toMatch(/^(1 seat|5 seats sharing these figures)$/);
      const off = await read(await get(path, { cookie, env: OFF(SALE) }));
      expect(off, path).not.toContain("<span>1 seat</span>");
    }
    await withoutSeats(async () => {
      const page = await read(await get("/pro", { env: ON(SALE) }));
      expect(page).not.toContain("<span>1 seat</span>");
    });
  });

  it("put the row on the landing page's cards, and Ultra's line among its own while it is not on sale", async () => {
    const landing = async (env: object, lang: Lang) =>
      text(await (await app.request(`/${lang === "fr" ? "?lang=fr" : ""}`, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, env)).text());
    for (const lang of ["en", "fr"] as const) {
      const lists = (page: string) => [...page.matchAll(/<ul class="lp-plan-list[^"]*"><li>[\s\S]*?<span>([^<]*)<\/span><\/li>/g)].map((m) => m[1]);
      // On sale: three cards, each its own figure first.
      const sale = await landing(ON(SALE), lang);
      expect(lists(sale), lang).toEqual((["free", "pro", "ultra"] as const).map((p) => text(planLine(lang, seatsWording(p)))));
      // Before it is on sale: Free's and Pro's cards from the rows, Ultra's own lines after "Everything in Pro".
      const before = await landing(ON(), lang);
      const [freeFirst, proFirst, ultraFirst] = lists(before);
      expect([freeFirst, proFirst], lang).toEqual(["free", "pro"].map((p) => text(planLine(lang, seatsWording(p as "free" | "pro")))));
      expect(ultraFirst, lang).toBe(line(lang, "landing.everything_pro"));
      expect(before, lang).toContain(`<span>${line(lang, "landing.everything_pro")}</span></li><li><svg`);
      expect(before, lang).toContain(`<span>${text(planLine(lang, seatsWording("ultra")))}</span>`);
      const off = await landing(OFF(SALE), lang);
      expect(lists(off)[0], lang).not.toBe(text(planLine(lang, seatsWording("free"))));
    }
    expect(ultraLines("en", ultraLineKeys({ seats: true }))[0]).toBe("5 seats sharing these figures");
    expect(ultraLineKeys({})).toEqual(ultraLineKeys({ seats: false }));
  });

  it("put the row first in the Ultra message only while the switch is on", async () => {
    const links = ultraLinks("https://awardwatch.ca", "en", "c".repeat(32));
    const on = ultraOpenMessage("en", "reader@example.com", links, true);
    const off = ultraOpenMessage("en", "reader@example.com", links);
    expect(on.text).toContain(`${t("en", "announce.ultra_holds")}\n- 5 seats sharing these figures\n- `);
    expect(off.text).not.toContain("seats sharing");
    expect(ultraMessageLines(false)).toBe(ULTRA_MESSAGE_LINES);
    expect(ultraMessageLines(true)).toEqual([SEATS_ROW.ultra.key, ...ULTRA_MESSAGE_LINES]);
    const checks = await mailCheckMessages("fr", "check@example.com", "https://awardwatch.ca", new Date(), null, true);
    expect(text(checks.find((m) => m.template === "ultra_open")!.message.text)).toContain("- 5 sièges qui partagent ces chiffres");
  });

  it("keep every line within PLAN_LINE_MAX, naming its own figure and comparing nothing", () => {
    const COMPARATIVE = /\b(more|higher|above|unlimited|plus|davantage|supérieure?s?|au-dessus|illimitée?s?|than)\b/i;
    for (const lang of ["en", "fr"] as const) {
      for (const plan of ["free", "pro", "ultra"] as const) {
        const l = planLine(lang, seatsWording(plan));
        expect(l.length, `${lang} ${plan}`).toBeLessThanOrEqual(PLAN_LINE_MAX);
        expect(l, `${lang} ${plan}`).not.toMatch(COMPARATIVE);
        expect(l, `${lang} ${plan}`).toContain(String(PLAN_SEATS[plan]));
      }
    }
  });
});

// =========================================================================================================
// 2. /pro, the Terms, the privacy page
// =========================================================================================================

describe("/pro", () => {
  it("names the seats in Ultra's section and asks the seats' question while the switch is on and Ultra is on sale", async () => {
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const on = await read(await get(`/pro${q}`, { env: ON(SALE) }));
      expect(on, lang).toContain(`${seatWords(lang, PLAN_SEATS.ultra)}, ${lang === "en" ? "yours and" : "le vôtre et"} ${memberSeats("ultra")} `);
      expect(on, lang).toContain(lang === "en" ? `${KEYS_MAX} API keys of` : `${KEYS_MAX} clés d'API de`);
      expect(on, lang).toContain(`<h3>${line(lang, "propage.q_seats")}</h3>`);
      const answer = line(lang, "propage.a_seats", {
        pro_seats: seatWords(lang, PLAN_SEATS.pro), ultra_seats: seatWords(lang, PLAN_SEATS.ultra), others: memberSeats("ultra"),
      });
      expect(on, lang).toContain(`<p>${answer}</p>`);
      // The question rides in the FAQ markup too.
      expect(on, lang).toContain(`"name":"${line(lang, "propage.q_seats")}"`);
      // Off, or on with Ultra off sale: today's text, no question.
      const off = await read(await get(`/pro${q}`, { env: OFF(SALE) }));
      expect(off, lang).not.toContain(line(lang, "propage.q_seats"));
      expect(off, lang).not.toContain(seatWords(lang, PLAN_SEATS.ultra));
      const closed = await read(await get(`/pro${q}`, { env: ON() }));
      expect(closed, lang).not.toContain(line(lang, "propage.q_seats"));
    }
  });
});

describe("the Terms and the privacy page", () => {
  const figures = (lang: Lang) => ({
    pro_seats: seatWords(lang, PLAN_SEATS.pro), ultra_seats: seatWords(lang, PLAN_SEATS.ultra), others: memberSeats("ultra"),
    days: SEAT_INVITE_DAYS, joins: joinsAllowed("ultra"), window: SEAT_WINDOW_DAYS, devices: SESSIONS_MAX,
  });

  it("add the Seats section after the paid plans' contents, and name a seat beside an account under abuse, while on and on sale", async () => {
    expect([memberSeats("ultra"), SEAT_INVITE_DAYS, joinsAllowed("ultra"), SEAT_WINDOW_DAYS, SESSIONS_MAX]).toEqual([4, 7, 6, 30, 3]);
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const on = await read(await get(`/terms${q}`, { env: ON(SALE) }));
      const section = `<h3>${line(lang, "terms.pro_seats_title")}</h3><p>${line(lang, "terms.pro_seats", figures(lang))}</p>`;
      expect(on, lang).toContain(section);
      expect(on.indexOf(section), lang).toBeGreaterThan(on.indexOf(line(lang, "terms.pro_includes_ultra")));
      expect(on.indexOf(section), lang).toBeLessThan(on.indexOf(`<h3>${line(lang, "terms.pro_prices_title")}</h3>`));
      expect(on, lang).toContain(line(lang, "terms.pro_abuse_seats"));
      expect(on, lang).not.toContain(line(lang, "terms.pro_abuse_ultra"));
      expect(line(lang, "terms.pro_abuse_seats"), lang).toContain(lang === "en" ? "sharing or reselling an account or a seat" : "le partage ou la revente d'un compte ou d'un siège");
      // Off, or on with Ultra off sale: the terms of before.
      for (const env of [OFF(SALE), ON()]) {
        const page = await read(await get(`/terms${q}`, { env }));
        expect(page, lang).not.toContain(`<h3>${line(lang, "terms.pro_seats_title")}</h3>`);
        expect(page, lang).not.toContain(line(lang, "terms.pro_abuse_seats"));
      }
    }
    // Every figure the section states is the constants'.
    const en = line("en", "terms.pro_seats", figures("en"));
    expect(en).toContain("Pro has 1 seat, the subscriber's. Ultra has 5 seats: the subscriber's, and 4 the subscriber may give");
    expect(en).toContain("an invitation's link works for 7 days");
    expect(en).toContain("at most 6 people may join one subscription in any 30 days");
    expect(en).toContain("signed in on at most 3 browsers at a time");
  });

  it("say what an invitation and a seat keep, and for how long, while the switch is on", async () => {
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const paragraph = `<p>${line(lang, "seats.privacy", { days: SEAT_KEEP_DAYS })}</p>`;
      const on = await read(await get(`/privacy${q}`, { env: ON() }));
      expect(on, lang).toContain(paragraph);
      // After the signed-in browsers' sentence.
      expect(on.indexOf(paragraph), lang).toBeGreaterThan(on.indexOf(line(lang, "account.privacy_sessions", { cap: SESSIONS_MAX, days: 90 })));
      const off = await read(await get(`/privacy${q}`, { env: OFF() }));
      expect(off, lang).not.toContain(line(lang, "seats.privacy", { days: SEAT_KEEP_DAYS }));
    }
    expect(SEAT_KEEP_DAYS).toBe(30);
    expect(line("en", "seats.privacy", { days: SEAT_KEEP_DAYS })).toContain("is deleted 30 days after it was sent");
  });
});

// =========================================================================================================
// 3. The line a control reads where the subscription is full
// =========================================================================================================

describe("a control where the subscription is full", () => {
  it("tells a member whom to ask and the holder where the counts are, on every control, in both languages", { timeout: 60_000 }, async () => {
    const { h, m } = await fullGroup("full");
    const env = ON();
    for (const lang of ["en", "fr"] as const) {
      const q = (path: string) => `${path}${path.includes("?") ? "&" : "?"}lang=${lang}`;
      const page = async (who: Person, path: string) => read(await get(q(path), { cookie: who.cookie, env }));
      // Each page, the figure it is full at, and whether the holder meets the same control there (the holder's own
      // watches' feed is made, so its watches page shows the feed and not the panel's line).
      const cases: [string, Key, number, boolean][] = [
        [SAVE_LIST, "pool.f_searches", 100, true], [ORG, "pool.f_watches", 100, true], [SEGMENT, "pool.f_searches", 100, true],
        ["/account/searches", "pool.f_searches", 100, true], ["/account/searches?m=cap", "pool.f_searches", 100, true],
        ["/account/searches?m=b_cap", "pool.f_searches", 100, true], ["/account/searches?m=feed_cap", "pool.f_feeds", FEEDS_MAX, true],
        ["/account/watches?m=cap", "pool.f_watches", 100, true], ["/account/watches?m=feed_cap", "pool.f_feeds", FEEDS_MAX, true],
        ["/account/watches", "pool.f_feeds", FEEDS_MAX, false], ["/account/keys", "pool.f_keys", KEYS_MAX, true],
        ["/account/dashboard?m=boards_full", "pool.f_dashboards", 5, true],
      ];
      for (const [path, figure, cap, holderToo] of cases) {
        const mine = await page(m, path);
        expect(mine, `${lang} member ${path}`).toContain(memberLine(lang, figure, cap, h.email));
        const held = await page(h, path);
        // The holder's line names the Seats page: a link where the line is markup, words in the dashboard's notice.
        const [before, after] = line(lang, "pool.full_holder", { cap, things: things(lang, figure), seats: "@@" }).split("@@");
        if (!holderToo) expect(held, `${lang} holder ${path}`).not.toContain(before);
        else if (path.startsWith("/account/dashboard")) expect(held, `${lang} holder ${path}`).toContain(holderText(lang, figure, cap));
        else expect(held, `${lang} holder ${path}`).toContain(`${before}${holderLinked(lang)}${after}`);
        // Neither reads the old line that said "this account", nor another account's labels.
        for (const p of [mine, held]) {
          expect(p, `${lang} ${path}`).not.toContain(line(lang, "account.save_cap_pro", { n: 100, cap: 100 }));
          expect(p, `${lang} ${path}`).not.toContain(line(lang, "calfeed.msg_cap"));
          expect(p, `${lang} ${path}`).not.toContain(line(lang, "dash.boards_full", { boards: 5 }));
          expect(p, `${lang} ${path}`).not.toContain(EM_DASH);
        }
        expect(mine, path).not.toContain("Full search 1<");
      }
      // The briefings' panel: the figure a briefing counts toward is the subscription's.
      expect(await page(m, "/account/searches"), lang).toContain(line(lang, "briefing.list_lead_pool"));
    }
  });

  it("reads exactly as before for an account in no group at the same figures, the switch on or off", { timeout: 60_000 }, async () => {
    const alone = await person("full-alone", "ultra");
    await atEveryFigure(alone.id);
    const paths = [
      SAVE_LIST, ORG, SEGMENT, "/account/searches", "/account/searches?m=cap", "/account/searches?m=b_cap", "/account/searches?m=feed_cap",
      "/account/watches?m=cap", "/account/watches?m=feed_cap", "/account/keys", "/account/dashboard?m=boards_full",
    ];
    for (const path of paths) {
      for (const lang of ["en", "fr"] as const) {
        const p = `${path}${path.includes("?") ? "&" : "?"}lang=${lang}`;
        const on = await (await get(p, { cookie: alone.cookie, env: ON() })).text();
        const off = await (await get(p, { cookie: alone.cookie, env: OFF() })).text();
        expect(on, `${lang} ${path}`).toBe(off);
        expect(on, `${lang} ${path}`).not.toContain(t(lang, "pool.full_seats"));
      }
    }
    // The lines it reads are the ones of before, which say "this account".
    const read1 = async (path: string) => read(await get(path, { cookie: alone.cookie, env: ON() }));
    expect(await read1(SAVE_LIST)).toContain(line("en", "account.save_cap_pro", { n: 100, cap: 100 }));
    expect(await read1(ORG)).toContain(line("en", "watches.control_cap_pro", { n: 100, cap: 100 }));
    expect(await read1("/account/searches?m=feed_cap")).toContain(line("en", "calfeed.msg_cap"));
    expect(await read1("/account/keys")).toContain(line("en", "account.keys_limit", { n: KEYS_MAX }));
    expect(await read1("/account/dashboard?m=boards_full")).toContain(line("en", "dash.boards_full", { boards: 5 }));
    expect(await read1("/account/searches")).toContain(line("en", "briefing.list_lead"));
  });

  it("is not read by a member while the switch is off: the pool's lines of before stand", { timeout: 30_000 }, async () => {
    const { h, m } = await fullGroup("full-off", OFF());
    for (const path of [SAVE_LIST, ORG, "/account/searches?m=cap", "/account/keys", "/account/dashboard?m=boards_full"]) {
      const page = await read(await get(path, { cookie: m.cookie, env: OFF() }));
      expect(page, path).not.toContain(h.email);
      expect(page, path).not.toContain(line("en", "pool.full_seats"));
    }
  });

  it("is drawn by Save this view, for a member, the holder and an account in no group", async () => {
    const render = async (account: object, seats: boolean, mine?: number) => {
      const state = { account, address: "/segments/81/analytics?source=awards&years=5", label: "Segment 81", saved: false, n: 50, cap: 50, ...(mine === undefined ? {} : { mine }) };
      const node = jsx(RailContext.Provider, { value: { rail: null, here: "/", ...(seats ? { seats: true } : {}) } }, jsx(SaveViewRow, { lang: "en", state } as never));
      return text(await (node as unknown as { toString(): Promise<string> | string }).toString());
    };
    const group = { holderId: "h".repeat(32), ids: ["h".repeat(32), "m".repeat(32)], position: 1 };
    const member = { userId: "m".repeat(32), plan: "ultra", group, seat: { id: "s".repeat(32), holderId: "h".repeat(32), holderEmail: "holder@example.com", covered: true } };
    const holder = { userId: "h".repeat(32), plan: "ultra", group: { ...group, position: 0 } };
    const alone = { userId: "a".repeat(32), plan: "ultra" };
    expect(await render(member, true, 0)).toContain(memberLine("en", "pool.f_views", 50, "holder@example.com"));
    expect(await render(holder, true, 50)).toContain(holderLinked("en"));
    // Off, or in no group: the line of before.
    expect(await render(member, false, 0)).toContain(line("en", "pool.count", { total: 50, cap: 50, things: things("en", "pool.f_views"), own: 0 }));
    expect(await render(alone, true)).toContain(line("en", "views.full", { cap: 50 }));
    expect(await render(alone, true)).toBe(await render(alone, false));
  });
});

// =========================================================================================================
// 4. The delete page
// =========================================================================================================

describe("the delete page", () => {
  it("says what deleting does to the seat an account holds and to the seats it gives, while the switch is on", async () => {
    const h = await person("del-holder", "ultra");
    const m = await person("del-member");
    await seatRow(h.id, { member: m.id, joined: -2 });
    await seatRow(h.id, { invited: 0 });
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const member = await read(await get(`/account/delete${q}`, { cookie: m.cookie, env: ON() }));
      expect(member, lang).toContain(line(lang, "account.delete_seat", { holder: h.email }));
      // A member pays for no subscription of its own: the line names none.
      expect(member, lang).toContain(line(lang, "account.delete_subscription_any"));
      const holder = await read(await get(`/account/delete${q}`, { cookie: h.cookie, env: ON() }));
      expect(holder, lang).toContain(line(lang, "account.delete_seats", { n: 2 }));
      for (const [who, page] of [["member", member], ["holder", holder]] as const) {
        expect(page.match(/class="btn btn-primary"/g), `${lang} ${who}`).toHaveLength(1);
      }
    }
    // Off: neither line.
    expect(await read(await get("/account/delete", { cookie: m.cookie, env: OFF() }))).not.toContain(line("en", "account.delete_seat", { holder: h.email }));
    expect(await read(await get("/account/delete", { cookie: h.cookie, env: OFF() }))).not.toContain(line("en", "account.delete_seats", { n: 2 }));
    // One seat given: the singular.
    const one = await person("del-one", "ultra");
    await seatRow(one.id, { invited: 0 });
    expect(await read(await get("/account/delete", { cookie: one.cookie, env: ON() }))).toContain(line("en", "account.delete_seats_one"));
  });

  it("answers the 503 page, never the 500, when the accounts database fails under the page or its unticked post", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await person("del-fault", "ultra");
    await seatRow(h.id, { invited: 0 });
    const token = await csrf(h.cookie, "/account", { env: ON() });
    // The seats' count fails, as any statement does while the database stops answering; the rest still read.
    const failing = new Proxy(ACCOUNTS, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => (sql === SEATS_IN_USE_SQL
            ? { bind: () => ({ first: async () => { throw new Error("D1_ERROR: the database did not answer"); } }) }
            : target.prepare(sql));
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const env = ON({ ACCOUNTS: failing });
    for (const lang of ["en", "fr"] as const) {
      const answers = [
        await get(`/account/delete${lang === "fr" ? "?lang=fr" : ""}`, { cookie: h.cookie, env }),
        await post("/account/delete", { csrf: token, lang }, { cookie: h.cookie, env }),
      ];
      for (const res of answers) {
        expect(res.status, lang).toBe(503);
        expect(await read(res), lang).toContain(`<h1>${line(lang, "account.unavailable_title")}</h1>`);
      }
    }
    // Nothing was deleted.
    expect(await ACCOUNTS.prepare("SELECT status FROM users WHERE id = ?").bind(h.id).first("status")).toBe("active");
  });
});

// =========================================================================================================
// 5. The console's actions on seats
// =========================================================================================================

describe("the console's actions on seats", () => {
  type Operator = { email: string; id: string; cookie: string; csrf: string; env: Record<string, unknown> };
  async function operator(seats: "on" | "off" = "on"): Promise<Operator> {
    const email = newEmail("seat-op");
    const env = onEnv({ SEATS: seats, OPERATOR_EMAILS: email });
    const cookie = await signIn(email, { env });
    return { email, id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env }), env };
  }
  const auditOf = async (user: string, event: string) =>
    ((await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = ? ORDER BY id").bind(user, event).all<{ detail: string | null }>()).results ?? [])
      .map((r) => r.detail);
  const row = (id: string) => ACCOUNTS.prepare("SELECT * FROM seats WHERE id = ?").bind(id).first<Record<string, unknown>>();

  it("ends a live seat after its page and box, the member on its own plan, an audit row on each side naming the operator alone", async () => {
    const op = await operator();
    const h = await person("con-holder", "ultra");
    const m = await person("con-member");
    const seat = await seatRow(h.id, { member: m.id, joined: -2 });
    const invited = newEmail("con-invited");
    const open = await seatRow(h.id, { email: invited, invited: 0 });
    const panel = await read(await get(`/admin/users/${h.id}`, { cookie: op.cookie, env: op.env }));
    expect(panel).toContain(`<a href="/admin/users/${h.id}/seats/${seat}/end">${line("en", "admin.seat_end")}</a>`);
    expect(panel).toContain(`<a href="/admin/users/${h.id}/seats/${open}/invite-cancel">${line("en", "admin.invite_end")}</a>`);
    const confirm = await read(await get(`/admin/users/${h.id}/seats/${seat}/end`, { cookie: op.cookie, env: op.env }));
    expect(confirm).toContain(line("en", "admin.seat_end_lead"));
    expect(confirm).toContain(m.email);
    expect(confirm).toContain('name="confirm" value="yes"');
    // Without the box: nothing changes.
    const unticked = await post(`/admin/users/${h.id}/seats/${seat}/end`, { csrf: op.csrf }, { cookie: op.cookie, env: op.env });
    expect(unticked.status).toBe(400);
    expect((await row(seat))?.ended_at).toBeNull();
    // Without an Origin: refused, as every console post is.
    expect((await post(`/admin/users/${h.id}/seats/${seat}/end`, { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: op.env, origin: null })).status).toBe(403);
    const res = await post(`/admin/users/${h.id}/seats/${seat}/end`, { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: op.env });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/admin/users/${h.id}?m=seat_ended`);
    expect(await row(seat)).toMatchObject({ ended_why: "operator", member_id: m.id });
    expect(await auditOf(h.id, "operator_seat_ended")).toEqual([`by ${op.id}`]);
    expect(await auditOf(m.id, "operator_seat_ended")).toEqual([`by ${op.id}`]);
    // The member reads its own plan from its next request.
    expect(await read(await get("/account", { cookie: m.cookie, env: ON() }))).not.toContain(line("en", "account.plan_seat", { plan: "Ultra", holder: h.email }));
    // Again: nothing more changes.
    const again = await post(`/admin/users/${h.id}/seats/${seat}/end`, { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: op.env });
    expect(again.headers.get("location")).toBe(`/admin/users/${h.id}?m=seat_nothing`);
    expect(await auditOf(h.id, "operator_seat_ended")).toHaveLength(1);
  });

  it("cancels an open invitation, its link's hash cleared and its address kept for the sweep", async () => {
    const op = await operator();
    const h = await person("con-cancel-h", "ultra");
    const invited = newEmail("con-cancel-to");
    const open = await seatRow(h.id, { email: invited, invited: 0 });
    const confirm = await read(await get(`/admin/users/${h.id}/seats/${open}/invite-cancel`, { cookie: op.cookie, env: op.env }));
    expect(confirm).toContain(invited);
    expect(confirm).toContain(line("en", "admin.invite_end_lead", { days: SEAT_KEEP_DAYS }));
    const res = await post(`/admin/users/${h.id}/seats/${open}/invite-cancel`, { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: op.env });
    expect(res.headers.get("location")).toBe(`/admin/users/${h.id}?m=invite_cancelled`);
    expect(await row(open)).toMatchObject({ ended_why: "operator", token_hash: null, email: invited, member_id: null });
    expect(await auditOf(h.id, "operator_invite_cancelled")).toEqual([`by ${op.id}`]);
    expect(await read(await get(`/admin/users/${h.id}?m=invite_cancelled`, { cookie: op.cookie, env: op.env }))).toContain(line("en", "admin.msg_invite_cancelled"));
  });

  it("acts only on the holder's own rows, only for the operator, and still ends a seat while the switch is off", async () => {
    const op = await operator();
    const h = await person("con-guard-h", "ultra");
    const other = await person("con-guard-o", "ultra");
    const m = await person("con-guard-m");
    const seat = await seatRow(h.id, { member: m.id, joined: -2 });
    // Another holder's address with this seat's id: the site's 404, nothing changed.
    expect((await get(`/admin/users/${other.id}/seats/${seat}/end`, { cookie: op.cookie, env: op.env })).status).toBe(404);
    expect((await post(`/admin/users/${other.id}/seats/${seat}/end`, { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: op.env })).status).toBe(404);
    // A reader who is not the operator: the site's 404.
    const notOp = await csrf(m.cookie, "/account", { env: op.env });
    expect((await get(`/admin/users/${h.id}/seats/${seat}/end`, { cookie: m.cookie, env: op.env })).status).toBe(404);
    expect((await post(`/admin/users/${h.id}/seats/${seat}/end`, { csrf: notOp, confirm: "yes" }, { cookie: m.cookie, env: op.env })).status).toBe(404);
    expect((await row(seat))?.ended_at).toBeNull();
    // The switch off: a live seat still gives its member the plan, so the operator's column and both addresses stand,
    // and the seat can be ended. Taking a plan back never waits on a switch.
    const offOp = await operator("off");
    const panel = await read(await get(`/admin/users/${h.id}`, { cookie: offOp.cookie, env: offOp.env }));
    expect(panel).toContain(`<a href="/admin/users/${h.id}/seats/${seat}/end">${line("en", "admin.seat_end")}</a>`);
    expect((await get(`/admin/users/${h.id}/seats/${seat}/end`, { cookie: offOp.cookie, env: offOp.env })).status).toBe(200);
    const ended = await post(`/admin/users/${h.id}/seats/${seat}/end`, { csrf: offOp.csrf, confirm: "yes" }, { cookie: offOp.cookie, env: offOp.env });
    expect(ended.headers.get("location")).toBe(`/admin/users/${h.id}?m=seat_ended`);
    expect(await row(seat)).toMatchObject({ ended_why: "operator", member_id: m.id });
    // An account no seat row names reads no actions column, on or off.
    const plain = await read(await get(`/admin/users/${other.id}`, { cookie: offOp.cookie, env: offOp.env }));
    expect(plain).not.toContain("/seats/");
  });

  it("names no address, no seat id and no secret in a log line or an audit detail", async () => {
    const logged = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const op = await operator();
    const h = await person("con-log-h", "ultra");
    const m = await person("con-log-m");
    const seat = await seatRow(h.id, { member: m.id, joined: -2 });
    const invited = newEmail("con-log-to");
    const open = await seatRow(h.id, { email: invited, invited: 0 });
    await post(`/admin/users/${h.id}/seats/${seat}/end`, { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: op.env });
    await post(`/admin/users/${h.id}/seats/${open}/invite-cancel`, { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: op.env });
    const all = logged.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" "))).join("\n");
    for (const secret of [h.email, m.email, invited, seat, open]) expect(all).not.toContain(secret);
    const details = (await ACCOUNTS.prepare("SELECT detail FROM audit WHERE event LIKE 'operator_%' AND user_id IN (?, ?)").bind(h.id, m.id)
      .all<{ detail: string }>()).results ?? [];
    expect(details).toHaveLength(3);
    for (const d of details) expect(d.detail).toBe(`by ${op.id}`);
  });
});

// =========================================================================================================
// 6. What C1 left: the join page's GET, the pool table, the phone's labels
// =========================================================================================================

describe("the join page's GET", () => {
  async function sha256Hex(s: string): Promise<string> {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
    return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  it("writes nothing at all, not even the holder's cached plan", async () => {
    const h = await person("get-cache-h", "ultra");
    const m = await person("get-cache-m");
    // The holder's cache behind its rows, as it is until its next read.
    await ACCOUNTS.prepare("UPDATE users SET plan = 'free', plan_until = NULL WHERE id = ?").bind(h.id).run();
    const secret = "2".repeat(64);
    const id = await seatRow(h.id, { email: m.email, invited: 0, hash: await sha256Hex(secret) });
    const before = await ACCOUNTS.prepare("SELECT plan, plan_until FROM users WHERE id = ?").bind(h.id).first();
    const res = await get(`/account/seats/join?i=${id}&t=${secret}`, { cookie: m.cookie, env: ON() });
    expect(await read(res)).toContain(t("en", "join.take"));
    expect(await ACCOUNTS.prepare("SELECT plan, plan_until FROM users WHERE id = ?").bind(h.id).first()).toEqual(before);
  });

  it("answers join.no_room, with no Take the seat, where the take would refuse: a blocked holder, the window's joins spent", async () => {
    for (const name of ["blocked", "joins"] as const) {
      const h = await person(`get-room-${name}-h`, "ultra");
      const m = await person(`get-room-${name}-m`);
      const secret = "3".repeat(64);
      const id = await seatRow(h.id, { email: m.email, invited: 0, hash: await sha256Hex(secret) });
      if (name === "blocked") {
        await ACCOUNTS.prepare("INSERT INTO account_blocks (user_id, reason, created_at, by_user_id) VALUES (?, 'test', ?, ?)").bind(h.id, iso(0), m.id).run();
      } else {
        for (let i = 0; i < joinsAllowed("ultra"); i++) {
          const gone = hexId();
          await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, 'en', 'active', 'free')").bind(gone, newEmail("gone"), iso(-30)).run();
          await ACCOUNTS.prepare(
            "INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id, joined_at, ended_at, ended_why) VALUES (?, ?, 'en', ?, ?, ?, ?, ?, 'removed')",
          ).bind(hexId(), h.id, iso(-11 + i), iso(-4 + i), gone, iso(-10 + i), iso(-9 + i)).run();
        }
      }
      const page = await read(await get(`/account/seats/join?i=${id}&t=${secret}`, { cookie: m.cookie, env: ON() }));
      expect(page, name).toContain(line("en", "join.no_room", { holder: h.email }));
      expect(page, name).not.toContain(t("en", "join.take"));
      expect(page, name).toContain(t("en", "join.decline"));
    }
  });
});

describe("the holder's pool table", () => {
  it("says the people in seats its plan does not cover are not counted there, and leaves them out of its columns", async () => {
    const h = await person("table-h", "ultra");
    const members: string[] = [];
    for (let i = 0; i < memberSeats("ultra") + 1; i++) {
      const m = hexId();
      const email = newEmail(`table-m${i}`);
      members.push(email);
      await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, 'en', 'active', 'free')").bind(m, email, iso(-50)).run();
      await seatRow(h.id, { member: m, joined: -20 + i });
    }
    const page = await read(await get("/account/seats", { cookie: h.cookie, env: ON() }));
    expect(page).toContain(line("en", "seats.pool_uncovered"));
    expect(page).toContain(line("en", "seats.state_uncovered"));
    const table = /<table class="restack seats-pool">[\s\S]*?<\/table>/.exec(page)?.[0] ?? "";
    for (const email of members.slice(0, 4)) expect(table).toContain(email);
    expect(table).not.toContain(members[4]);
    // With every seat covered, no such line.
    const h2 = await person("table-h2", "ultra");
    await seatRow(h2.id, { member: (await person("table-c")).id, joined: -2 });
    expect(await read(await get("/account/seats", { cookie: h2.cookie, env: ON() }))).not.toContain(line("en", "seats.pool_uncovered"));
  });

  it("puts each label before its value on a phone, so an address is broken only where a line cannot hold it", () => {
    const css = (bindings as unknown as { STYLES_CSS: string }).STYLES_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const at = css.indexOf(".restack.seats-pool td::before");
    expect(at).toBeGreaterThan(-1);
    // Inside the phone's block, as the label column it replaces is.
    expect(css.slice(css.lastIndexOf("@media", at)).startsWith("@media (max-width: 699px)")).toBe(true);
    const rule = /\.restack\.seats-pool td::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("float: none");
    expect(rule).toContain("display: inline-block");
    expect(rule).toContain("overflow-wrap: anywhere");
    expect(/\.restack\.seats-pool td, \.restack\.seats-pool td:first-child, \.restack\.seats-pool td:last-child\s*\{\s*padding-left: 0;\s*\}/.test(css)).toBe(true);
    // The stamp moved with this rule (layout.tsx STYLES_VERSION 76), so no cached stylesheet meets the new table.
    expect(STYLES_VERSION).toBeGreaterThanOrEqual(76);
  });
});

describe("the words of this slice", () => {
  it("are in both languages, with no dash, no comparison and straight apostrophes in the French as written", () => {
    const keys = [
      "seats.pool_uncovered", "plans.seat_one", "plans.seats_shared", "propage.ultra_text_seats", "propage.q_seats", "propage.a_seats",
      "terms.pro_seats_title", "terms.pro_seats", "terms.pro_abuse_seats", "seats.privacy", "pool.full", "pool.full_holder", "pool.full_seats",
      "briefing.list_lead_pool", "account.delete_seat", "account.delete_seats", "account.delete_seats_one", "admin.seat_end", "admin.seat_end_title",
      "admin.seat_end_lead", "admin.seat_end_button", "admin.invite_end", "admin.invite_end_title", "admin.invite_end_lead", "admin.invite_end_button",
      "admin.seat_field_person", "admin.seat_field_invited", "admin.seat_field_holder", "admin.msg_seat_ended", "admin.msg_invite_cancelled",
      "admin.msg_seat_nothing",
    ] as const;
    for (const key of keys) {
      const entry = (SEATS_STRINGS as Record<string, { en: string; fr: string }>)[key];
      expect(entry, key).toBeDefined();
      for (const s of [entry.en, entry.fr]) {
        expect(s, key).not.toContain(EM_DASH);
        expect(s, key).not.toContain(EN_DASH);
        // A plan's line names its own figure and compares nothing (the Terms may say "more than one person").
        if (key.startsWith("plans.")) expect(s, key).not.toMatch(/\b(more|than|above|plus|davantage)\b/);
        expect(s, key).not.toMatch(/\babove Pro\b|\bthan Pro\b/);
      }
      expect(entry.fr, key).not.toContain("’");
      expect(entry.fr, key).not.toBe(entry.en);
    }
  });
});
