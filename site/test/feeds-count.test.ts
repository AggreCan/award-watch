// The feeds panel's counts (account/routes.tsx calendarView) and a feed's count (account/feeds.ts feedSize), read
// through one index of the open list (openIndex, indexMatches) since the panel stopped recounting every search over
// the whole list: each held to a count made by hand on the rows below, and to the path they replaced (searchMatches
// with closingStart for a search's row, the length of feedEvents' events for a feed). The rows: notices closing later,
// later today, on a day with no time, already closed, with no closing and with one no calendar can place; text with
// accents; derived provinces; and two references that differ only in case, whose events share one uid. The searches
// overlap, one matches nothing and one matches every notice.
import { describe, expect, it } from "vitest";
import { feedEvents, feedSize, indexMatches, openIndex, searchMatches, type FeedState } from "../src/account/feeds";
import { FEED_EVENTS_MAX, cappedLength, closingStart } from "../src/calendar";
import type { TenderRow } from "../src/data";
import { ACCOUNTS, get, grantUltra, newEmail, signIn, ultraEnv, useAccountsDb, userId } from "./accounts-helpers";
import { FILES, makeFakeAssets, testClock, testEnv } from "./assets";

useAccountsDb();

const BASE = { ...(FILES["tenders/open.json"] as TenderRow[])[0], excerpt_en: null, excerpt_fr: null };
const row = (o: Partial<TenderRow>): TenderRow => ({ ...BASE, provinces: [], ...o }) as TenderRow;
// The clock is test/assets.ts TEST_NOW, 2026-10-31 12:00 Eastern.
const OPEN: TenderRow[] = [
  row({ reference: "cb-1-1", title_en: "Translation services for regional offices", title_fr: "Services de traduction pour les bureaux régionaux",
    category: ["SRV"], segments: ["82"], provinces: ["ON", "QC"], buyer_id: "pwgsc-tpsgc", closing: "2026-11-04T14:00:00", codes: ["82111800"] }),
  row({ reference: "cb-2-2", title_en: "Hull inspection and repair", title_fr: "Inspection et réparation de coques", category: ["SRV"],
    segments: ["72", "78"], provinces: ["BC"], buyer_id: "dfo-mpo", closing: "2026-11-26T14:00:00", codes: ["72101500"] }),
  row({ reference: "cb-3-3", title_en: "Ruggedized laptops", title_fr: "Ordinateurs portatifs renforcés", category: ["GD"], segments: ["43"],
    buyer_id: "dnd-mdn", notice_type_en: "Invitation to Qualify", closing: "2026-12-15T13:00:00", codes: ["43211509"] }),
  // A day and no time: the calendar holds it as a whole day.
  row({ reference: "cb-4-4", title_en: null, title_fr: "Évaluation de programmes", category: ["SRV"], segments: ["80"], provinces: ["QC"],
    buyer_id: "pwgsc-tpsgc", closing: "2026-11-10", codes: ["80101500"] }),
  // Closed at 11:00 this morning.
  row({ reference: "cb-5-5", title_en: "Snow removal services", title_fr: "Déneigement", category: ["SRV"], segments: ["72"], provinces: ["ON"],
    buyer_id: "pwgsc-tpsgc", closing: "2026-10-31T11:00:00", codes: ["72102900"] }),
  // Closes at 13:00 today; no stated province, Ontario derived.
  row({ reference: "cb-6-6", title_en: "Translation of manuals", title_fr: "Traduction de manuels", category: ["SRV"], segments: ["82"],
    provinces_derived: ["ON"], provinces_from: "delivery", buyer_id: "dfo-mpo", closing: "2026-10-31T13:00:00", codes: ["82111800"] }),
  row({ reference: "cb-7-7", title_en: "Office furniture", title_fr: "Mobilier de bureau", category: ["GD"], segments: ["56"], provinces: ["ON"],
    buyer_id: "pwgsc-tpsgc", closing: null, codes: ["56101500"] }),
  // A closing no calendar can place: open, listed by the search, never an event.
  row({ reference: "cb-8-8", title_en: "Engineering services", title_fr: "Services d'ingénierie", category: ["SRV"], segments: ["81"], provinces: ["ON"],
    buyer_id: "pwgsc-tpsgc", closing: "to be announced", codes: ["81101500"] }),
  row({ reference: "cb-9-9", title_en: "Security services", title_fr: "Services de sécurité", category: ["SRV"], segments: ["92"], provinces: ["ON"],
    buyer_id: "pwgsc-tpsgc", closing: "2026-10-30T14:00:00", codes: ["92121500"] }),
  row({ reference: "cb-10-10", title_en: "Bridge inspection services", title_fr: "Inspection de ponts", category: ["SRV"], segments: ["72"],
    provinces: ["BC"], buyer_id: "pwgsc-tpsgc", closing: "2026-11-26T14:00:00-08:00", codes: ["72141100"] }),
  // Two references that differ only in case: two rows of a search, one event of a feed.
  row({ reference: "CB-11-11", title_en: "Translation audit", title_fr: "Vérification de traduction", category: ["SRV"], segments: ["82"],
    provinces: ["QC"], buyer_id: "dnd-mdn", closing: "2026-11-20T10:00:00", codes: ["82111800"] }),
  row({ reference: "cb-11-11", title_en: "Translation review", title_fr: "Révision de traduction", category: ["SRV"], segments: ["82"],
    provinces: ["QC"], buyer_id: "dnd-mdn", closing: "2026-11-21T10:00:00", codes: ["82111800"] }),
];
// The rows that make an event: 1, 2, 3, 4, 6, 10 and the two 11s (5 and 9 have closed, 7 has no closing, 8 none a
// calendar can place). Each search's count of them, worked out by hand.
const SEARCHES: [params: string, n: number][] = [
  ["/tenders", 8],
  ["/tenders?q=translation", 4], // 1, 6, 11, 11
  ["/tenders?q=services", 2], // 1, 10 (5, 8, 9 make no event)
  ["/tenders?q=evaluation", 1], // 4, through its French title's accent
  ["/tenders?q=nothing-matches-this", 0],
  ["/tenders?segment=82", 4], // 1, 6, 11, 11
  ["/tenders?segment=72&segment=43", 3], // 2, 3, 10
  ["/tenders?province=ON", 3], // 1, 3 (no province), 6 (derived)
  ["/tenders?province=ON&national=0&derived=0", 1], // 1
  ["/tenders?category=GD", 1], // 3
  ["/tenders?buyer=pwgsc-tpsgc", 3], // 1, 4, 10
  ["/tenders?closing=7", 2], // 1 and 6 close by 2026-11-07
  ["/tenders?code=4321", 1], // 3
  ["/tenders?q=translation&segment=82&province=QC", 3], // 1, 11, 11 (6's place is Ontario)
  ["/tenders?type=Invitation%20to%20Qualify", 1], // 3
  ["/tenders?q=inspection", 2], // 2, 10
];

const assets = makeFakeAssets({}, { "tenders/open.json": OPEN });
const env = testEnv(assets) as never;
const ctx = { lang: "en" as const, base: "https://awardwatch.ca", clock: testClock, dataDate: "2026-10-31" };
const search = (params: string, i: number) => ({ id: `${i}`.padStart(32, "0"), params, label: `Search ${i}`, lang: "en" });
type Watch = FeedState["watches"][number];
const followed = (ref: string): Watch => ({ kind: "tender", target: `tender:${ref}`, segment: "", events: ["notice_closed"] });

describe("a search's count over the index", () => {
  it("is the count made by hand and the old path's, for each search", () => {
    const index = openIndex(OPEN, testClock);
    expect(index.listed.map((r) => r.reference)).toEqual(["cb-1-1", "cb-2-2", "cb-3-3", "cb-4-4", "cb-6-6", "cb-10-10", "CB-11-11", "cb-11-11"]);
    for (const [params, n] of SEARCHES) {
      expect(indexMatches(index, params).length, params).toBe(n);
      expect(searchMatches(OPEN, params, testClock).filter((r) => closingStart(r.closing)).length, `${params}, the old path`).toBe(n);
    }
  });
});

describe("a feed's count without its events", () => {
  // [feed, events by hand]
  const FEEDS: [string, Pick<FeedState, "kind" | "searches" | "watches">, number][] = [
    // Every search: the eight rows, the two 11s one event.
    ["all, every search", { kind: "all", searches: SEARCHES.map(([p], i) => search(p, i)), watches: [] }, 7],
    ["all, every search the other way round", { kind: "all", searches: SEARCHES.map(([p], i) => search(p, i)).reverse(), watches: [] }, 7],
    // Nothing and the 7-day window (1 and 6), with followed notices: 3 (an event), 6 (one already), 5 (closed), 8 (none).
    ["all, a few searches and followed notices", {
      kind: "all", searches: [search(SEARCHES[4][0], 4), search(SEARCHES[11][0], 11)],
      watches: [followed("cb-3-3"), followed("cb-6-6"), followed("cb-5-5"), followed("cb-8-8")],
    }, 3],
    ["watchlist", { kind: "watchlist", searches: [], watches: [followed("cb-3-3"), followed("cb-6-6"), followed("cb-5-5")] }, 2],
    ["one search with the two 11s", { kind: "search", searches: [search("/tenders?q=translation", 1)], watches: [] }, 3],
    ["one search matching nothing", { kind: "search", searches: [search("/tenders?q=nothing-matches-this", 4)], watches: [] }, 0],
  ];
  for (const [name, feed, n] of FEEDS) {
    it(`counts ${name} as its file holds it`, async () => {
      expect(await feedSize(env, feed, ctx)).toBe(n);
      const old = await feedEvents(env, feed, ctx);
      expect(cappedLength(old.events.length, old.beyond)).toBe(n);
      // The page's own index, read at the same clock, gives the same.
      expect(await feedSize(env, feed, ctx, openIndex(OPEN, testClock))).toBe(n);
    });
  }

  it("counts past the file's cap as the file does", async () => {
    // 600 notices closing later, each its own event: the file keeps 499 and its last event names the rest.
    const many = Array.from({ length: 600 }, (_, i) => ({ ...OPEN[0], reference: `cb-900-${i}` }));
    const big = testEnv(makeFakeAssets({}, { "tenders/open.json": many })) as never;
    const feed = { kind: "all" as const, searches: [search("/tenders", 0), search("/tenders?q=translation", 1)], watches: [] };
    expect(FEED_EVENTS_MAX).toBe(500);
    expect(await feedSize(big, feed, ctx)).toBe(500);
    const old = await feedEvents(big, feed, ctx);
    expect(cappedLength(old.events.length, old.beyond)).toBe(500);
    expect(indexMatches(openIndex(many, testClock), "/tenders").length).toBe(600);
  });

  it("answers null when the open list cannot be read, as before", async () => {
    const none = testEnv(makeFakeAssets({}, { "tenders/open.json": undefined })) as never;
    expect(await feedSize(none, { kind: "all", searches: [search("/tenders", 0)], watches: [] }, ctx)).toBeNull();
  });
});

describe("the saved searches page's feeds panel", () => {
  it("shows each feed's count made by hand: a search's rows, the all feed's events", async () => {
    const email = newEmail("feeds-count");
    const page = ultraEnv({ ASSETS: assets });
    const cookie = await signIn(email, { env: page });
    await grantUltra(email);
    const user = await userId(email);
    const id = (i: number) => `${(0xf00 + i).toString(16)}`.padStart(32, "0");
    const at = (i: number) => `2026-01-02T00:00:${String(i).padStart(2, "0")}.000Z`;
    await ACCOUNTS.batch([
      ...SEARCHES.map(([params], i) => ACCOUNTS.prepare(
        "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, 'off')",
      ).bind(id(i), user, params, `Search ${i + 1}`, at(i))),
      // Four searches' feeds (every notice, translation, nothing, translation in 82 at Quebec) and the all feed.
      ...[0, 1, 4, 13].map((s, i) => ACCOUNTS.prepare("INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) VALUES (?, ?, 'search', ?, ?, ?)")
        .bind(id(0x40 + i), user, id(s), id(0x80 + i), at(30 + i))),
      ACCOUNTS.prepare("INSERT INTO feeds (id, user_id, kind, search_id, secret, created_at) VALUES (?, ?, 'all', NULL, ?, ?)").bind(id(0x50), user, id(0x90), at(40)),
    ]);
    const res = await get("/account/searches", { cookie, env: page });
    expect(res.status).toBe(200);
    const html = await res.text();
    // In the panel's order: the searches with a feed as saved, then the all feed (seven events: the two 11s are one).
    expect(html.match(/[0-9,]+ events? today/g)).toEqual(["8 events today", "4 events today", "0 events today", "3 events today", "7 events today"]);
  });
});
