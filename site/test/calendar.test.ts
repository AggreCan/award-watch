// The calendar files (src/calendar.ts): the one-event file of a notice or a
// contract (src/pages/ics.ts), public whatever the switch, and a Pro
// account's feeds (src/account/feeds.ts). Every file is read back through a
// strict parser (ical.js) as well as checked line by line: CRLF ends, 75
// octets at most, escaped TEXT, UTC times.
import ICAL from "ical.js";
import { describe, expect, it } from "vitest";
import { closesAtUtc } from "../src/closing";
import {
  type CalEvent, FEED_EVENTS_MAX, capped, contractEvent, escapeText, foldLine, noticeEvent, writeCalendar,
} from "../src/calendar";
import { type FeedRow, WATCHLIST_EVENTS, forgetFeeds } from "../src/account/feeds";
import { app } from "../src/index";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import { ACCOUNTS, csrf, get, grantPro, newEmail, nextIp, offEnv, onEnv, post, signIn, userId, useAccountsDb } from "./accounts-helpers";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const BASE = "https://awardwatch.ca";
const LOCAL = "http://localhost";
const octets = (s: string) => new TextEncoder().encode(s).length;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// The file's content lines, unfolded (RFC 5545, 3.1).
const unfold = (text: string) => text.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
const prop = (text: string, name: string) => unfold(text).filter((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

// What every file must be, whatever it holds.
function wellFormed(text: string): ICAL.Component {
  expect(text.endsWith("\r\n")).toBe(true);
  expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  for (const line of text.split("\r\n")) {
    expect(octets(line), line).toBeLessThanOrEqual(75);
    // A fold never cuts a character in two.
    expect(() => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(new TextEncoder().encode(line))).not.toThrow();
  }
  expect(text).not.toContain(EM_DASH);
  const cal = new ICAL.Component(ICAL.parse(text));
  expect(cal.name).toBe("vcalendar");
  expect(cal.getFirstPropertyValue("version")).toBe("2.0");
  expect(cal.getFirstPropertyValue("method")).toBe("PUBLISH");
  for (const ev of cal.getAllSubcomponents("vevent")) {
    for (const p of ["uid", "dtstamp", "dtstart", "summary", "sequence"]) expect(ev.hasProperty(p), p).toBe(true);
  }
  return cal;
}

const events = (cal: ICAL.Component) => cal.getAllSubcomponents("vevent").map((v) => new ICAL.Event(v));

// -- the format ------------------------------------------------------------------------------

describe("the file's format", () => {
  it("folds at 75 octets, not characters, on a long French title with accents", () => {
    const title = "Évaluation écologique des répercussions éventuelles sur les écosystèmes côtiers, études préliminaires et réévaluation";
    const line = `SUMMARY:${escapeText(`Clôture : ${title}`)}`;
    expect([...line].length).toBeLessThan(octets(line));
    const folded = foldLine(line);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(octets(l)).toBeLessThanOrEqual(75);
    for (const l of lines.slice(1)) expect(l.startsWith(" ")).toBe(true);
    // Some line is full to the octet count while holding fewer than 75 characters.
    expect(lines.some((l) => octets(l) > [...l].length)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    const e = noticeEvent("fr", {
      reference: "cb-900-90000009", amendment: 0, title_en: null, title_fr: title, buyer_en: null, buyer_fr: "Pêches et Océans Canada",
      closing: "2026-11-26T14:00:00", notice_type_en: null, notice_type_fr: null, method_en: null, method_fr: null, provinces: ["QC"],
      first_seen: "2026-10-31", segments: ["77"],
    }, BASE)!;
    const cal = wellFormed(writeCalendar({ lang: "fr", events: [e], dataDate: "2026-10-31" }));
    expect(events(cal)[0].summary).toBe(`Clôture : ${title} · Pêches et Océans Canada`);
  });

  it("escapes commas, semicolons, backslashes and line breaks in TEXT values", () => {
    expect(escapeText("A, B; C\\D\nE\r\nF")).toBe("A\\, B\\; C\\\\D\\nE\\nF");
    const e = noticeEvent("en", {
      reference: "cb-900-90000010", amendment: 0, title_en: "Snow removal; parking lots, north\\south", title_fr: null, buyer_en: "Parks, Canada",
      buyer_fr: null, closing: "2026-12-01T10:00:00", notice_type_en: null, notice_type_fr: null, method_en: null, method_fr: null,
      provinces: [], first_seen: "2026-10-31", segments: [],
    }, BASE)!;
    const text = writeCalendar({ lang: "en", events: [e], dataDate: "2026-10-31" });
    expect(prop(text, "SUMMARY")).toEqual(["SUMMARY:Closes: Snow removal\\; parking lots\\, north\\\\south · Parks\\, Canada"]);
    expect(events(wellFormed(text))[0].summary).toBe("Closes: Snow removal; parking lots, north\\south · Parks, Canada");
  });

  it("converts a closing to UTC as the pages do, in standard time and in daylight time", () => {
    const at = (closing: string) => {
      const e = noticeEvent("en", {
        reference: "cb-900-90000011", amendment: 0, title_en: "T", title_fr: null, buyer_en: null, buyer_fr: null, closing,
        notice_type_en: null, notice_type_fr: null, method_en: null, method_fr: null, provinces: [], first_seen: "2026-10-01", segments: [],
      }, BASE)!;
      const text = writeCalendar({ lang: "en", events: [e], dataDate: "2026-10-01" });
      wellFormed(text);
      return prop(text, "DTSTART")[0];
    };
    // Daylight time until 2026-11-01: 14:00 Eastern is 18:00 UTC.
    expect(at("2026-10-30T14:00:00")).toBe("DTSTART:20261030T180000Z");
    expect(closesAtUtc("2026-10-30T14:00:00")).toBe("2026-10-30T18:00:00Z");
    // Standard time after it: 19:00 UTC.
    expect(at("2026-11-26T14:00:00")).toBe("DTSTART:20261126T190000Z");
    expect(closesAtUtc("2026-11-26T14:00:00")).toBe("2026-11-26T19:00:00Z");
    // A value naming its own zone is read in it; a date alone is an all-day event.
    expect(at("2026-11-26T14:00:00Z")).toBe("DTSTART:20261126T140000Z");
    expect(at("2026-11-26")).toBe("DTSTART;VALUE=DATE:20261126");
  });

  it("writes a contract's end as an all-day event whose DTEND is the next day", () => {
    const e = contractEvent("en", {
      kind: "award", reference: "cb-900-1", path: "/awards/cb-900-1", holder: "Holder Ltd.", buyer: "Health Canada", title: "Cleaning",
      end: "2026-12-31", start: "2025-01-01", value: 1000, currency: "CAD", amendments: 2, growth: 0.25,
    }, BASE)!;
    const text = writeCalendar({ lang: "en", events: [e], dataDate: "2026-10-31" });
    expect(prop(text, "DTSTART")).toEqual(["DTSTART;VALUE=DATE:20261231"]);
    expect(prop(text, "DTEND")).toEqual(["DTEND;VALUE=DATE:20270101"]);
    expect(prop(text, "SUMMARY")).toEqual(["SUMMARY:Ends: Holder Ltd. · Health Canada · Cleaning"]);
    expect(prop(text, "SEQUENCE")).toEqual(["SEQUENCE:2"]);
    expect(prop(text, "CATEGORIES")).toEqual(["CATEGORIES:Award Watch,Contract end"]);
    const ev = events(wellFormed(text))[0];
    expect(ev.startDate.isDate).toBe(true);
    expect(ev.endDate.toString()).toBe("2027-01-01");
    expect(ev.description).toContain("Amendments: 2, value change +25%");
  });

  it("holds at most 500 events, soonest first, the last saying how many more", () => {
    const many: CalEvent[] = Array.from({ length: 620 }, (_, i) => ({
      uid: `notice-n${String(i).padStart(4, "0")}@awardwatch.ca`, sequence: 0, start: { at: Date.UTC(2026, 10, 1) + (620 - i) * 3_600_000 },
      summary: `Closes: ${i}`, description: "", url: `${BASE}/tenders/n${i}`, categories: ["Award Watch"],
    }));
    const kept = capped("en", many, { uid: "more-x@awardwatch.ca", kind: "closing", dataDate: "2026-10-31", url: `${BASE}/tenders` });
    expect(kept).toHaveLength(FEED_EVENTS_MAX);
    const last = kept[kept.length - 1];
    expect(last.summary).toBe("Award Watch: 121 more closing dates, see the site");
    expect(last.start).toEqual({ day: "2026-10-31" });
    // The 499 kept are the soonest of the 620.
    expect(kept[0].summary).toBe("Closes: 619");
    expect(kept[FEED_EVENTS_MAX - 2].summary).toBe(`Closes: ${619 - (FEED_EVENTS_MAX - 2)}`);
    const cal = wellFormed(writeCalendar({ lang: "en", events: kept, dataDate: "2026-10-31", name: "Award Watch · Test" }));
    expect(cal.getAllSubcomponents("vevent")).toHaveLength(FEED_EVENTS_MAX);
    expect(capped("fr", many, { uid: "more-x@awardwatch.ca", kind: "end", dataDate: "2026-10-31", url: BASE }).at(-1)!.summary)
      .toBe("Award Watch : 121 autres dates de fin, voir le site");
    expect(capped("en", many.slice(0, 500), { uid: "m", kind: "closing", dataDate: "2026-10-31", url: BASE })).toHaveLength(500);
  });

  it("cuts a description at 1,000 characters", () => {
    const e: CalEvent = {
      uid: "u@awardwatch.ca", sequence: 0, start: { day: "2026-11-01" }, summary: "S", description: "é".repeat(1500), url: BASE, categories: [],
    };
    const ev = events(wellFormed(writeCalendar({ lang: "en", events: [e], dataDate: "2026-10-31" })))[0];
    expect(ev.description).toBe("é".repeat(1000));
  });
});

// -- the one-event files -------------------------------------------------------------------------

const file = (path: string, env: object = testEnv()) => app.request(path, { headers: { "cf-connecting-ip": nextIp() } }, env);

const shard = (patch: (entry: Record<string, unknown>) => void, ref = "cb-100-10000001") => {
  const s = clone(FILES["tenders/20a.json"]) as Record<string, Record<string, unknown>>;
  patch(s[ref]);
  return makeFakeAssets({}, { "tenders/20a.json": s });
};

describe("a notice's file", () => {
  it("is public, cached an hour, and holds the open notice's closing with its stable UID", async () => {
    const res = await file("/tenders/cb-200-20005019.ics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="cb-200-20005019.ics"');
    const text = await res.text();
    const cal = wellFormed(text);
    expect(cal.getFirstPropertyValue("prodid")).toBe("-//Award Watch//awardwatch.ca//EN");
    // A one-event file makes no calendar of its own in the app that imports it.
    expect(text).not.toContain("X-WR-CALNAME");
    expect(text).not.toContain("REFRESH-INTERVAL");
    const [ev] = events(cal);
    expect(ev.uid).toBe("notice-cb-200-20005019@awardwatch.ca");
    expect(ev.sequence).toBe(0);
    expect(prop(text, "DTSTART")).toEqual(["DTSTART:20261126T190000Z"]);
    expect(prop(text, "DTEND")).toEqual([]);
    expect(prop(text, "DTSTAMP")).toEqual(["DTSTAMP:20261031T123000Z"]);
    expect(prop(text, "LAST-MODIFIED")).toEqual(["LAST-MODIFIED:20261031T123000Z"]);
    expect(prop(text, "STATUS")).toEqual([]);
    expect(prop(text, "VALARM")).toEqual([]);
    expect(ev.summary).toBe("Closes: Hull inspection and repair, coastal patrol vessels · Fisheries and Oceans Canada");
    expect(prop(text, "URL")).toEqual(["URL:https://awardwatch.ca/tenders/cb-200-20005019"]);
    expect(prop(text, "CATEGORIES")).toEqual(["CATEGORIES:Award Watch,Closing"]);
    expect(ev.description.split("\n")).toEqual([
      "Reference: cb-200-20005019",
      "Buyer: Fisheries and Oceans Canada",
      "Notice type: Request for Proposal",
      "Procurement method: Competitive - Selective tendering",
      "Segments: 72 Construction",
      "Regions: British Columbia",
      "First seen: 2026-10-31",
      "Closing as published: 2026-11-26 14:00, Eastern time",
      "On Award Watch: https://awardwatch.ca/tenders/cb-200-20005019",
      "On CanadaBuys: https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-200-20005019",
    ]);
    // The page links it beside the closing.
    const page = await (await file("/tenders/cb-200-20005019")).text();
    expect(page).toContain('2026-11-26 14:00 ET · <a href="/tenders/cb-200-20005019.ics" class="small" rel="nofollow">Add to calendar</a>');
  });

  it("reads in French at ?lang=fr, which the French page's link carries", async () => {
    const text = await (await file("/tenders/cb-200-20005019.ics?lang=fr")).text();
    const cal = wellFormed(text);
    expect(cal.getFirstPropertyValue("prodid")).toBe("-//Award Watch//awardwatch.ca//FR");
    const [ev] = events(cal);
    expect(ev.summary).toBe("Clôture : Inspection et réparation de coques, navires de patrouille côtière · Pêches et Océans Canada");
    expect(ev.description).toContain("Clôture telle que publiée : 2026-11-26 14 h 00, heure de l’Est");
    expect(ev.description).toContain("Sur AchatsCanada : https://achatscanada.canada.ca/fr/");
    expect(prop(text, "CATEGORIES")).toEqual(["CATEGORIES:Award Watch,Clôture"]);
    const page = await (await file("/tenders/cb-200-20005019?lang=fr")).text();
    expect(page).toContain('<a href="/tenders/cb-200-20005019.ics?lang=fr" class="small" rel="nofollow">Ajouter au calendrier</a>');
  });

  it("keeps its UID and raises its SEQUENCE when an amendment moves the closing", async () => {
    const before = shard((e) => {
      e.amendment = 0;
      e.closing = "2026-11-03T14:00:00";
    });
    const a = events(wellFormed(await (await file("/tenders/cb-100-10000001.ics", testEnv(before))).text()))[0];
    const b = events(wellFormed(await (await file("/tenders/cb-100-10000001.ics")).text()))[0];
    expect(a.uid).toBe("notice-cb-100-10000001@awardwatch.ca");
    expect(b.uid).toBe(a.uid);
    expect([a.sequence, b.sequence]).toEqual([0, 1]);
    expect(a.startDate.toJSDate().toISOString()).toBe("2026-11-03T19:00:00.000Z");
    expect(b.startDate.toJSDate().toISOString()).toBe("2026-11-04T19:00:00.000Z");
  });

  it("still answers for a closed notice, with no link on its page", async () => {
    const after = testEnv(undefined, "2026-11-05T00:00:00Z");
    const res = await file("/tenders/cb-100-10000001.ics", after);
    expect(res.status).toBe(200);
    wellFormed(await res.text());
    const page = await (await file("/tenders/cb-100-10000001", after)).text();
    expect(page).toContain("Closing date passed");
    expect(page).not.toContain(".ics");
    expect(page).not.toContain("Add to calendar");
  });

  it("marks a cancelled notice STATUS:CANCELLED, with no link on its page", async () => {
    const env = testEnv(shard((e) => { e.status = "cancelled"; }));
    const text = await (await file("/tenders/cb-100-10000001.ics", env)).text();
    wellFormed(text);
    expect(prop(text, "STATUS")).toEqual(["STATUS:CANCELLED"]);
    expect(events(new ICAL.Component(ICAL.parse(text)))[0].description).toContain("The notice was cancelled.");
    const page = await (await file("/tenders/cb-100-10000001", env)).text();
    expect(page).not.toContain(".ics");
  });

  it("is the site's 404 for a notice the data does not hold", async () => {
    expect((await file("/tenders/cb-999-99999999.ics")).status).toBe(404);
    expect((await file("/tenders/..ics")).status).toBe(404);
  });
});

describe("a contract's file", () => {
  it("holds an award notice's end as an all-day event, linked beside the end date", async () => {
    const res = await file("/awards/cb-400-40000004.ics");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const text = await res.text();
    const [ev] = events(wellFormed(text));
    expect(ev.uid).toBe("contract-award-cb-400-40000004@awardwatch.ca");
    expect(prop(text, "DTSTART")).toEqual(["DTSTART;VALUE=DATE:20290930"]);
    expect(prop(text, "DTEND")).toEqual(["DTEND;VALUE=DATE:20291001"]);
    expect(ev.summary).toBe("Ends: Exemplar Translation Services Inc. · Public Services and Procurement Canada · Translation standing offer, official languages");
    expect(ev.description).toContain("Holder: Exemplar Translation Services Inc.");
    expect(ev.description).toContain("Value counted: $250,000");
    expect(ev.description).toContain("Source: Award notices");
    expect(ev.description).toContain("On Award Watch: https://awardwatch.ca/awards/cb-400-40000004");
    const page = await (await file("/awards/cb-400-40000004")).text();
    expect(page).toContain('<a href="/awards/cb-400-40000004.ics" class="small" rel="nofollow">Add to calendar</a>');
  });

  it("answers for a history record, and its page has no link once the end has passed", async () => {
    const res = await file("/history/w8472-000633.ics");
    expect(res.status).toBe(200);
    const text = await res.text();
    const [ev] = events(wellFormed(text));
    expect(ev.uid).toBe("contract-history-w8472-000633@awardwatch.ca");
    expect(ev.sequence).toBe(2);
    expect(prop(text, "DTSTART")).toEqual(["DTSTART;VALUE=DATE:20260331"]);
    const page = await (await file("/history/w8472-000633")).text();
    expect(page).not.toContain(".ics");
  });

  it("marks a cancelled contract and is the 404 of a record the data does not hold", async () => {
    const contracts = clone(FILES["contracts/637.json"]) as Record<string, Record<string, unknown>>;
    contracts["award:cb-400-40000004"].status = "cancelled";
    const env = testEnv(makeFakeAssets({}, { "contracts/637.json": contracts }));
    const text = await (await file("/awards/cb-400-40000004.ics", env)).text();
    expect(prop(text, "STATUS")).toEqual(["STATUS:CANCELLED"]);
    expect(await (await file("/awards/cb-400-40000004", env)).text()).not.toContain(".ics");
    expect((await file("/awards/cb-999-99999999.ics")).status).toBe(404);
    // The year pages and the references are still what they were.
    expect((await file("/awards/2026")).status).toBe(200);
  });

  it("counts as a download, and stays as it is with the switch on", async () => {
    const keys: string[] = [];
    const keeper = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } as unknown as RateLimit;
    await app.request("/tenders/cb-200-20005019.ics", { headers: { "cf-connecting-ip": "203.0.113.91" } },
      { ...testEnv(), DOWNLOAD_LIMIT: keeper, PAGE_LIMIT: keeper });
    expect(keys).toEqual(["download:203.0.113.91"]);
    const off = await (await file("/tenders/cb-200-20005019.ics")).text();
    const on = await (await file("/tenders/cb-200-20005019.ics", onEnv())).text();
    expect(on).toBe(off);
  });
});

// -- the feeds -----------------------------------------------------------------------------------

async function proAccount(tag: string, searches: string[] = ["/tenders?segment=82"]) {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  await grantPro(email);
  const token = await csrf(cookie, "/account/searches");
  for (const url of searches) await post("/account/searches", { csrf: token, url }, { cookie });
  const user = await userId(email);
  const ids = (await ACCOUNTS.prepare("SELECT id, params FROM saved_searches WHERE user_id = ? ORDER BY created_at, id").bind(user)
    .all<{ id: string; params: string }>()).results;
  return { email, cookie, token, user, searches: ids };
}

async function makeFeed(a: { cookie: string; token: string }, kind: string, search?: string) {
  const fields: Record<string, string> = { csrf: a.token, kind };
  if (search) fields.search = search;
  return post("/account/calendar", fields, { cookie: a.cookie });
}

const feedRows = async (user: string) =>
  (await ACCOUNTS.prepare("SELECT * FROM feeds WHERE user_id = ? ORDER BY created_at, id").bind(user).all<FeedRow>()).results;
const feedPath = (f: Pick<FeedRow, "id" | "secret">, extra = "") => `/account/calendar/${f.id}.ics?t=${f.secret}${extra}`;
const today = () => new Date().toISOString().slice(0, 10);

describe("a saved search's feed", () => {
  it("lists every open notice the search matches, by closing date, private and never stored", async () => {
    const a = await proAccount("feed-search", ["/tenders?segment=82", "/tenders"]);
    const made = await makeFeed(a, "search", a.searches[0].id);
    expect(made.status).toBe(303);
    expect(made.headers.get("location")).toBe("/account/searches?m=feed_added#calendar");
    const [feed] = await feedRows(a.user);
    expect(feed.kind).toBe("search");
    expect(feed.search_id).toBe(a.searches[0].id);
    expect(feed.secret).toMatch(/^[0-9a-f]{32}$/);
    expect(feed.last_read_day).toBeNull();
    const res = await get(feedPath(feed));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    const cal = wellFormed(text);
    expect(cal.getFirstPropertyValue("x-wr-calname")).toMatch(/^Award Watch · /);
    expect(prop(text, "REFRESH-INTERVAL")).toEqual(["REFRESH-INTERVAL;VALUE=DURATION:PT12H"]);
    expect(prop(text, "X-PUBLISHED-TTL")).toEqual(["X-PUBLISHED-TTL:PT12H"]);
    // Segment 82 holds one open notice.
    expect(events(cal).map((e) => e.uid)).toEqual(["notice-cb-100-10000001@awardwatch.ca"]);
    // The address names no account and no address.
    expect(text).not.toContain(a.email);
    expect(text).not.toContain(a.user);
    expect(text).not.toContain(feed.secret);
    // The searches page shows the address, when it was read and how many events it holds.
    // A local request's own origin; the site's address (SITE_URL) on the account.
    const page = await (await get("/account/searches", { cookie: a.cookie })).text();
    expect(page).toContain(`value="${LOCAL}/account/calendar/${feed.id}.ics?t=${feed.secret}"`);
    expect(page).toContain(`Last read by a calendar on ${today()}`);
    expect(page).toContain("1 event today");
    expect(page).toContain("Google Calendar: Other calendars, then From URL, then paste the address.");
    expect(page).toContain("Outlook: Add calendar, then Subscribe from web, then paste the address.");
    expect(page).toContain("Apple Calendar: File, then New Calendar Subscription, then paste the address.");
    expect(page).toContain("address can read what it lists. Rotate the address if it was shared by mistake.");
    expect(page).toContain('<script src="/calendar.js" defer=""></script>');
  });

  it("merges every saved tender search in the all feed, each notice once, soonest first", async () => {
    const a = await proAccount("feed-all", ["/tenders?segment=82", "/tenders"]);
    await makeFeed(a, "all");
    const [feed] = await feedRows(a.user);
    expect(feed.kind).toBe("all");
    const cal = wellFormed(await (await get(feedPath(feed))).text());
    expect(events(cal).map((e) => e.uid)).toEqual([
      "notice-cb-100-10000001@awardwatch.ca", "notice-cb-200-20005019@awardwatch.ca", "notice-cb-300-30000003@awardwatch.ca",
    ]);
    expect(cal.getFirstPropertyValue("x-wr-calname")).toBe("Award Watch · All saved tender searches");
  });

  it("is an empty calendar, still valid, for a search with no open notice; the page says 0 events today", async () => {
    const a = await proAccount("feed-empty", ["/tenders?segment=10"]);
    await makeFeed(a, "search", a.searches[0].id);
    const [feed] = await feedRows(a.user);
    const text = await (await get(feedPath(feed))).text();
    const cal = wellFormed(text);
    expect(cal.getAllSubcomponents("vevent")).toHaveLength(0);
    expect(cal.getFirstPropertyValue("x-wr-calname")).toMatch(/^Award Watch · /);
    expect(await (await get("/account/searches", { cookie: a.cookie })).text()).toContain("0 events today");
  });

  it("adds a display alarm a day before each event with ?alarm=1d, and none by default", async () => {
    const a = await proAccount("feed-alarm");
    await makeFeed(a, "search", a.searches[0].id);
    const [feed] = await feedRows(a.user);
    expect(await (await get(feedPath(feed))).text()).not.toContain("VALARM");
    const text = await (await get(feedPath(feed, "&alarm=1d"))).text();
    const cal = wellFormed(text);
    const alarm = cal.getFirstSubcomponent("vevent")!.getFirstSubcomponent("valarm")!;
    expect(alarm.getFirstPropertyValue("action")).toBe("DISPLAY");
    expect(String(alarm.getFirstPropertyValue("trigger"))).toBe("-P1D");
  });

  it("reads in French with &lang=fr, the address the French page shows", async () => {
    const a = await proAccount("feed-fr");
    await makeFeed(a, "search", a.searches[0].id);
    const [feed] = await feedRows(a.user);
    const page = await (await get("/account/searches?lang=fr", { cookie: a.cookie })).text();
    expect(page).toContain(`value="${LOCAL}/account/calendar/${feed.id}.ics?t=${feed.secret}&amp;lang=fr"`);
    expect(page).toContain("Changer l’adresse");
    const text = await (await get(feedPath(feed, "&lang=fr"))).text();
    const cal = wellFormed(text);
    expect(cal.getFirstPropertyValue("prodid")).toBe("-//Award Watch//awardwatch.ca//FR");
    expect(events(cal)[0].summary).toBe("Clôture : Services de traduction pour les bureaux régionaux · Services publics et Approvisionnement Canada");
  });

  it("writes last_read_day once a UTC day at most, a date and nothing more", async () => {
    const a = await proAccount("feed-read");
    await makeFeed(a, "search", a.searches[0].id);
    const [feed] = await feedRows(a.user);
    const sql: string[] = [];
    const recording = {
      prepare: (q: string) => (sql.push(q), ACCOUNTS.prepare(q)),
      batch: (s: D1PreparedStatement[]) => ACCOUNTS.batch(s),
    } as unknown as D1Database;
    const env = onEnv({ ACCOUNTS: recording });
    for (let i = 0; i < 3; i++) expect((await get(feedPath(feed), { env })).status).toBe(200);
    expect(sql.filter((q) => /^UPDATE feeds SET last_read_day/.test(q))).toHaveLength(1);
    expect(sql.filter((q) => /^(UPDATE|INSERT|DELETE)/i.test(q))).toHaveLength(1);
    const [after] = await feedRows(a.user);
    expect(after.last_read_day).toBe(today());
    // A day already past is moved on by the next read.
    await ACCOUNTS.prepare("UPDATE feeds SET last_read_day = '2026-01-01' WHERE id = ?").bind(feed.id).run();
    await get(feedPath(feed));
    expect((await feedRows(a.user))[0].last_read_day).toBe(today());
  });

  it("answers the site's 404 at once for a rotated, a wrong or a removed address, and for a deleted search", async () => {
    const a = await proAccount("feed-revoke");
    await makeFeed(a, "search", a.searches[0].id);
    const [feed] = await feedRows(a.user);
    expect((await get(feedPath(feed))).status).toBe(200);
    expect((await get(feedPath({ id: feed.id, secret: "0".repeat(32) }))).status).toBe(404);
    expect((await get(`/account/calendar/${feed.id}.ics`)).status).toBe(404);
    const rotated = await post(`/account/calendar/${feed.id}/rotate`, { csrf: a.token }, { cookie: a.cookie });
    expect(rotated.headers.get("location")).toBe("/account/searches?m=feed_rotated#calendar");
    const [now] = await feedRows(a.user);
    expect(now.id).toBe(feed.id);
    expect(now.secret).not.toBe(feed.secret);
    const old = await get(feedPath(feed));
    expect(old.status).toBe(404);
    expect(await old.text()).toContain("Page Not Found");
    expect((await get(feedPath(now))).status).toBe(200);
    await post(`/account/calendar/${feed.id}/delete`, { csrf: a.token }, { cookie: a.cookie });
    expect((await feedRows(a.user))[0].revoked_at).not.toBeNull();
    expect((await get(feedPath(now))).status).toBe(404);
    // A search's feed goes with the search.
    await makeFeed(a, "search", a.searches[0].id);
    const live = (await feedRows(a.user)).find((f) => !f.revoked_at)!;
    expect((await get(feedPath(live))).status).toBe(200);
    await post(`/account/searches/${a.searches[0].id}/delete`, { csrf: a.token }, { cookie: a.cookie });
    expect((await get(feedPath(live))).status).toBe(404);
    expect(await feedRows(a.user)).toHaveLength(0);
  });

  it("stops when the plan has no delivery, and is gone with the account", async () => {
    const a = await proAccount("feed-lapse");
    await makeFeed(a, "all");
    const [feed] = await feedRows(a.user);
    expect((await get(feedPath(feed))).status).toBe(200);
    await ACCOUNTS.prepare("UPDATE entitlements SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), a.user).run();
    expect((await get(feedPath(feed))).status).toBe(404);
    await grantPro(a.email);
    expect((await get(feedPath(feed))).status).toBe(200);
    const deleted = await post("/account/delete", { csrf: a.token, confirm: "yes" }, { cookie: a.cookie });
    expect(deleted.status).toBe(200);
    expect(await feedRows(a.user)).toHaveLength(0);
    expect((await get(feedPath(feed))).status).toBe(404);
  });

  it("holds five live feeds at most, one per search and one all feed", async () => {
    const a = await proAccount("feed-cap", ["/tenders?segment=82", "/tenders", "/tenders?segment=72", "/tenders?segment=43", "/tenders?province=BC"]);
    expect(a.searches).toHaveLength(5);
    for (const s of a.searches.slice(0, 4)) await makeFeed(a, "search", s.id);
    expect((await makeFeed(a, "search", a.searches[0].id)).headers.get("location")).toBe("/account/searches?m=feed_exists#calendar");
    await makeFeed(a, "all");
    expect((await makeFeed(a, "all")).headers.get("location")).toBe("/account/searches?m=feed_exists#calendar");
    expect((await makeFeed(a, "search", a.searches[4].id)).headers.get("location")).toBe("/account/searches?m=feed_cap#calendar");
    expect(await feedRows(a.user)).toHaveLength(5);
    // Another account's search, an unknown kind, and the watchlist before its build.
    const other = await proAccount("feed-cap-other");
    expect((await makeFeed(a, "search", other.searches[0].id)).headers.get("location")).toBe("/account/searches?m=feed_missing#calendar");
    expect((await makeFeed(a, "everything")).status).toBe(400);
    if (!WATCHLIST_EVENTS) {
      expect((await makeFeed(other, "watchlist")).headers.get("location")).toBe("/account/searches?m=feed_missing#calendar");
    }
  });

  it("serves a feed this isolate verified within the hour through a database outage, and answers 503 for any other", async () => {
    forgetFeeds();
    const a = await proAccount("feed-outage");
    await makeFeed(a, "search", a.searches[0].id);
    await makeFeed(a, "all");
    const [one, two] = await feedRows(a.user);
    const before = await (await get(feedPath(one))).text();
    const down = new Proxy({}, { get() { throw new Error("D1_ERROR: database unavailable"); } }) as D1Database;
    const error = console.error;
    console.error = () => undefined;
    try {
      const during = await get(feedPath(one), { env: onEnv({ ACCOUNTS: down }) });
      expect(during.status).toBe(200);
      expect(await during.text()).toBe(before);
      // Never read by this isolate: the database must answer first.
      const unknown = await get(feedPath(two), { env: onEnv({ ACCOUNTS: down }) });
      expect(unknown.status).toBe(503);
      expect(unknown.headers.get("retry-after")).toBe("600");
      // Another secret is not the remembered one: only the database can say whether a rotation made it good.
      expect((await get(feedPath({ id: one.id, secret: "f".repeat(32) }), { env: onEnv({ ACCOUNTS: down }) })).status).toBe(503);
    } finally {
      console.error = error;
    }
    // A revocation the database answers ends the remembered state at once.
    await post(`/account/calendar/${one.id}/delete`, { csrf: a.token }, { cookie: a.cookie });
    expect((await get(feedPath(one))).status).toBe(404);
  });

  it("answers 503, never an empty calendar, when the open notices cannot be read", async () => {
    const a = await proAccount("feed-nofile");
    await makeFeed(a, "search", a.searches[0].id);
    const [feed] = await feedRows(a.user);
    const error = console.error;
    console.error = () => undefined;
    try {
      const res = await get(feedPath(feed), { env: onEnv({ ASSETS: makeFakeAssets({}, { "tenders/open.json": undefined }) }) });
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain("BEGIN:VCALENDAR");
    } finally {
      console.error = error;
    }
  });

  it("counts against the calendar cap per address while the switch is on", async () => {
    const a = await proAccount("feed-limit");
    await makeFeed(a, "search", a.searches[0].id);
    const [feed] = await feedRows(a.user);
    const keys: string[] = [];
    const keeper = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } as unknown as RateLimit;
    await get(feedPath(feed), { ip: "203.0.113.92", env: onEnv({ CALENDAR_LIMIT: keeper, PAGE_LIMIT: keeper }) });
    expect(keys).toEqual(["calendar:203.0.113.92"]);
    const spent = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    expect((await get(feedPath(feed), { env: onEnv({ CALENDAR_LIMIT: spent }) })).status).toBe(429);
  });
});

describe("the feeds' states", () => {
  it("hides every feed address while the switch is off, and keeps the per-notice files and links", async () => {
    const a = await proAccount("feed-switch");
    await makeFeed(a, "search", a.searches[0].id);
    const [feed] = await feedRows(a.user);
    const notFound = await (await get("/nothing-here", { env: offEnv() })).text();
    const off = await get(feedPath(feed), { env: offEnv() });
    expect(off.status).toBe(404);
    expect(await off.text()).toBe(notFound);
    for (const path of ["/account/calendar", `/account/calendar/${feed.id}/rotate`, `/account/calendar/${feed.id}/delete`]) {
      expect((await post(path, { csrf: a.token, kind: "all" }, { cookie: a.cookie, env: offEnv() })).status, path).toBe(404);
    }
    expect((await get("/tenders/cb-200-20005019.ics", { env: offEnv() })).status).toBe(200);
    expect(await (await get("/tenders/cb-200-20005019", { env: offEnv() })).text()).toContain("Add to calendar");
  });

  it("shows a Free account the Pro chip and one line, and makes no feed for it", async () => {
    const email = newEmail("feed-free");
    const cookie = await signIn(email);
    const token = await csrf(cookie, "/account/searches");
    await post("/account/searches", { csrf: token, url: "/tenders?segment=82" }, { cookie });
    const page = await (await get("/account/searches", { cookie })).text();
    const panel = page.slice(page.indexOf('id="calendar"'), page.indexOf("Add a Search"));
    expect(panel).toContain('class="pro-tag"');
    expect(panel).toContain("A calendar feed of each saved tender search is part of Pro.");
    expect(panel).not.toContain("Make a calendar feed");
    const made = await post("/account/calendar", { csrf: token, kind: "all" }, { cookie });
    expect(made.headers.get("location")).toBe("/account/searches?m=feed_pro#calendar");
    expect(await feedRows(await userId(email))).toHaveLength(0);
  });

  it("does not exist signed out: the searches page sends to the sign-in", async () => {
    const res = await get("/account/searches");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/sign-in");
  });

  it("lists the feeds on the console by kind and on the user page, never the secret", async () => {
    const a = await proAccount("feed-console");
    await makeFeed(a, "search", a.searches[0].id);
    await makeFeed(a, "all");
    const [feed] = await feedRows(a.user);
    await get(feedPath(feed));
    const op = newEmail("feed-operator");
    const opCookie = await signIn(op, { env: onEnv({ OPERATOR_EMAILS: op }) });
    const env = onEnv({ OPERATOR_EMAILS: op });
    const overview = await (await get("/admin", { cookie: opCookie, env })).text();
    expect(overview).toMatch(/Calendar feeds by kind<\/dt><dd class="mono">[^<]*all \d+, search \d+<\/dd>/);
    expect(overview).toMatch(/Calendar feeds read, last 7 days<\/dt><dd>[1-9]\d*<\/dd>/);
    const user = await (await get(`/admin/users/${a.user}`, { cookie: opCookie, env })).text();
    expect(user).toContain("<h2>Calendar Feeds</h2>");
    expect(user).toContain(today());
    expect(user).not.toContain(feed.secret);
  });
});
