// The calendar files (src/calendar.ts): the one-event file of a notice or a
// contract (src/pages/ics.ts), public whatever the switch, and a Pro
// account's feeds (src/account/feeds.ts). Every file is read back through a
// strict parser (ical.js) as well as checked line by line: CRLF ends, 75
// octets at most, escaped TEXT, UTC times. The watches' feed reads a local
// records database built from pipeline/records_schema.sql with rows written
// here; every expected line is written out from those rows.
import { env as workerEnv } from "cloudflare:test";
import ICAL from "ical.js";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays } from "../public/closing.js";
import { closesAtUtc } from "../src/closing";
import {
  type CalEvent, FEED_EVENTS_MAX, capped, cappedLength, contractEvent, escapeText, foldLine, noticeEvent, writeCalendar,
} from "../src/calendar";
import {
  ENDS_SLOTS, type FeedRow, INSTRUMENT_DAYS, INSTRUMENT_SLOTS, WATCH_ENDS_SQL, WATCH_INSTRUMENTS_SQL, endsBinds, forgetFeeds, instrumentBinds,
} from "../src/account/feeds";
import { WINDOW_DAYS } from "../src/pages/expiring";
import { app } from "../src/index";
import { orgNumber } from "../src/records_db";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import {
  ACCOUNTS, csrf, get, grantPro, nbsp, newEmail, nextIp, offEnv, onEnv, post, signIn, userId, useAccountsDb,
} from "./accounts-helpers";
import { applySql } from "./setup";

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

  it("says the true remainder at the cap's edge: exactly the cap, one more, and rows left unread beside fewer given", () => {
    const given = (n: number): CalEvent[] => Array.from({ length: n }, (_, i) => ({
      uid: `contract-award-e${String(i).padStart(4, "0")}@awardwatch.ca`, sequence: 0, start: { day: addDays("2026-11-01", Math.floor(i / 2)) },
      summary: `Ends: ${i}`, description: "", url: `${BASE}/awards/e${i}`, categories: ["Award Watch"],
    }));
    const more = (beyond = 0) => ({ uid: "more-x@awardwatch.ca", kind: "end" as const, dataDate: "2026-10-31", url: `${BASE}/account/watches`, beyond });
    const capEvent = (list: CalEvent[]) => list.filter((e) => e.uid === "more-x@awardwatch.ca");
    // Exactly FEED_EVENTS_MAX, none unread: every one, and no cap event.
    const exact = capped("en", given(FEED_EVENTS_MAX), more());
    expect(exact).toHaveLength(FEED_EVENTS_MAX);
    expect(capEvent(exact)).toEqual([]);
    expect(cappedLength(FEED_EVENTS_MAX, 0)).toBe(FEED_EVENTS_MAX);
    // One more: 499 kept and 2 left out (the one past the cap and the one the cap event takes the place of).
    const over = capped("en", given(FEED_EVENTS_MAX + 1), more());
    expect(over).toHaveLength(FEED_EVENTS_MAX);
    expect(capEvent(over).map((e) => [e.summary, e.description])).toEqual([[
      "Award Watch: 2 more end dates, see the site",
      `This feed holds the ${FEED_EVENTS_MAX - 1} soonest dates. The rest are on the site: ${BASE}/account/watches`,
    ]]);
    expect(over.at(-2)!.summary).toBe(`Ends: ${FEED_EVENTS_MAX - 2}`);
    expect(cappedLength(FEED_EVENTS_MAX + 1, 0)).toBe(FEED_EVENTS_MAX);
    // A statement that hit its LIMIT with one row unread, and one row read that added no event (the same UID as a
    // followed record's, or a row that does not parse): 499 given and 1 unread. The file still says the one is left out.
    const edge = capped("en", given(FEED_EVENTS_MAX - 1), more(1));
    expect(edge).toHaveLength(FEED_EVENTS_MAX);
    expect(capEvent(edge)[0].summary).toBe("Award Watch: 1 more end date, see the site");
    expect(nbsp(capped("fr", given(FEED_EVENTS_MAX - 1), more(1)).at(-1)!.summary)).toBe("Award Watch : 1 autre date de fin, voir le site");
    expect(cappedLength(FEED_EVENTS_MAX - 1, 1)).toBe(FEED_EVENTS_MAX);
    // Fewer given than the cap with rows unread: every given one kept, the description naming how many.
    const few = capped("en", given(300), more(50));
    expect(few).toHaveLength(301);
    expect(capEvent(few).map((e) => [e.summary, e.description])).toEqual([[
      "Award Watch: 50 more end dates, see the site", `This feed holds the 300 soonest dates. The rest are on the site: ${BASE}/account/watches`,
    ]]);
    expect(cappedLength(300, 50)).toBe(301);
    // Far over: the cap's count is everything given or unread less the 499 kept.
    expect(capEvent(capped("en", given(700), more(80)))[0].summary).toBe(`Award Watch: ${700 + 80 - (FEED_EVENTS_MAX - 1)} more end dates, see the site`);
    expect(cappedLength(700, 80)).toBe(FEED_EVENTS_MAX);
    expect(cappedLength(0, 0)).toBe(0);
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
    expect(cal.getFirstPropertyValue("x-wr-calname")).toBe("Award Watch · All saved tender searches and watches");
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
    // Another account's search, an unknown kind; the watches' feed is the sixth, past the cap, and answers on the watches page.
    const other = await proAccount("feed-cap-other");
    expect((await makeFeed(a, "search", other.searches[0].id)).headers.get("location")).toBe("/account/searches?m=feed_missing#calendar");
    expect((await makeFeed(a, "everything")).status).toBe(400);
    expect((await makeFeed(a, "watchlist")).headers.get("location")).toBe("/account/watches?m=feed_cap#calendar");
    expect(await feedRows(a.user)).toHaveLength(5);
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
    expect(res.headers.get("location")).toBe("/account/sign-in?next=%2Faccount%2Fsearches");
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

// -- the watches' feed ---------------------------------------------------------------------------

const RECORDS = (workerEnv as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (workerEnv as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const DAY = "2026-10-31"; // the fixtures' data date
const ORG = "org-a000000001"; // the fixtures' profile; org-a00000000f is an alias of it
const RETIRED = "org-a00000000f";
const ORG_B = "org-b000000002";
const PUBLISHED_REF = "C-2026-2027-Q1-00096";

const BUYER_NAMES: Record<string, string> = {
  "pwgsc-tpsgc": "Public Services and Procurement Canada", "dnd-mdn": "National Defence", "hc-sc": "Health Canada",
  "dfo-mpo": "Fisheries and Oceans Canada",
};
const ORG_NAMES: Record<string, string> = { [ORG]: "Exemplar Works Ltd.", [ORG_B]: "Org B Two Inc." };
const KIND_N = { award: 1, history: 2, contract: 3 } as const;

// A contract in the radar's 12-month window, as rec_expiring holds it: the
// window file's row (without days_left) and the columns a statement filters by.
type Ending = {
  k: number; end: string; title: string; oid: string | null; buyer: string; client?: string; segs?: string[];
  kind?: "award" | "history" | "contract"; ref?: string; amendments?: number;
};

function windowRow(e: Ending): Record<string, unknown> {
  return {
    kind: e.kind ?? "award", reference: e.ref ?? `RADAR-${e.k}`, title_en: e.title, title_fr: `FR ${e.title}`, organization_id: e.oid,
    organization: e.oid ? ORG_NAMES[e.oid] : null, supplier_withheld: e.oid === null, buyer_id: e.buyer, buyer_en: BUYER_NAMES[e.buyer],
    buyer_fr: null, start: "2025-04-01", end: e.end, value: 100_000, currency: "CAD", competitive: 1, method_en: null, method_fr: null,
    instrument_en: "Contract", instrument_fr: null, n_amendments: e.amendments ?? 0, value_growth: null, segments: e.segs ?? [], provinces: [],
    client_buyer_id: e.client ?? e.buyer, client_buyer_name: null,
  };
}

async function radar(rows: Ending[], state = "ready"): Promise<void> {
  await RECORDS.batch(["rec_expiring", "rec_meta"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  for (let i = 0; i < rows.length; i += 100) {
    await RECORDS.batch(rows.slice(i, i + 100).map((e) => RECORDS.prepare(
      "INSERT INTO rec_expiring (k, endd, oid, buyer, client, segs, kind, comp, cad, cents, nv, so, m31, j) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, 1, 10000000, 10000000, 0, 0, 0, ?)",
    ).bind(e.k, e.end, e.oid ? orgNumber(e.oid) : null, e.buyer, e.client ?? e.buyer, e.segs?.length ? ` ${e.segs.join(" ")} ` : "",
      KIND_N[e.kind ?? "award"], JSON.stringify(windowRow(e)))));
  }
  await RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', ?), ('as_of', ?), ('rules', '2')").bind(state, DAY).run();
}

// The window: ORG's contracts at three buyers (one past the 6-month mark,
// one before the data date, one past the 12 months), a published contract and
// a withheld person's record at National Defence (the second as its client
// department), and Org B's in segments 43 and 81 at PSPC.
const WINDOW: Ending[] = [
  { k: 1, end: "2026-11-20", title: "Cleaning services", oid: ORG, buyer: "pwgsc-tpsgc", client: "dnd-mdn", segs: ["80"] },
  { k: 2, end: "2027-03-01", title: "Software licences", oid: ORG, buyer: "hc-sc", segs: ["43"] },
  { k: 3, end: "2027-08-15", title: "Network equipment", oid: ORG, buyer: "pwgsc-tpsgc", segs: ["43"] },
  { k: 4, end: "2027-01-15", title: "Fleet maintenance", oid: ORG_B, buyer: "dnd-mdn", kind: "contract", ref: "dnd-mdn:C-4" },
  { k: 5, end: "2027-02-10", title: "Snow removal", oid: null, buyer: "pwgsc-tpsgc", client: "dnd-mdn", kind: "history" },
  { k: 6, end: "2027-04-01", title: "Laptops", oid: ORG_B, buyer: "pwgsc-tpsgc", segs: ["43"] },
  { k: 7, end: "2027-04-02", title: "Office furniture", oid: ORG_B, buyer: "pwgsc-tpsgc", segs: ["81"] },
  { k: 8, end: "2027-06-01", title: "Base security", oid: ORG_B, buyer: "dnd-mdn" },
  { k: 9, end: "2026-10-15", title: "Already ended", oid: ORG, buyer: "hc-sc" },
  { k: 10, end: "2027-12-01", title: "Past the window", oid: ORG, buyer: "hc-sc" },
];

const EVENTS_OF: Record<string, string> = {
  organization: "award,grant,amended,cancelled,ends_12m,ends_6m,ended",
  buyer: "notice,notice_amended,award,amended,cancelled,ends_12m,ends_6m,ended",
  contract: "amended,cancelled,ends_12m,ends_6m,ended",
  tender: "notice_amended,notice_closed,notice_cancelled,notice_awarded",
};
let watchSeq = 0;

async function follow(user: string, kind: string, target: string, o: { events?: string; segment?: string } = {}): Promise<void> {
  watchSeq++;
  await ACCOUNTS.prepare(
    "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, ?, ?, ?, ?, ?, 'daily', ?, ?)",
  ).bind((0xc0000000 + watchSeq).toString(16).padStart(32, "0"), user, kind, target, o.segment ?? "", target, o.events ?? EVENTS_OF[kind],
    `2026-01-01T00:00:00.${String(watchSeq).padStart(3, "0")}Z`, DAY).run();
}

// The watches of the first test: a single award notice (ending in 2029) and
// a published contract, the retired id of ORG (12 months), National Defence
// on the 6-month notice alone, PSPC narrowed to segment 43, Org B with no end
// kind chosen, and an open notice.
async function followAll(user: string): Promise<void> {
  await follow(user, "contract", "award:cb-400-40000004");
  await follow(user, "contract", `contract:dnd-mdn:${PUBLISHED_REF}`);
  await follow(user, "organization", RETIRED);
  await follow(user, "buyer", "dnd-mdn", { events: "notice,award,ends_6m" });
  await follow(user, "buyer", "pwgsc-tpsgc", { segment: "43" });
  await follow(user, "organization", ORG_B, { events: "award,amended" });
  await follow(user, "tender", "tender:cb-200-20005019");
}

const EXPECTED = [
  "contract-award-radar-1@awardwatch.ca", "notice-cb-200-20005019@awardwatch.ca", "contract-contract-dnd-mdn:c-4@awardwatch.ca",
  "contract-history-radar-5@awardwatch.ca", "contract-award-radar-2@awardwatch.ca", "contract-award-radar-6@awardwatch.ca",
  `contract-contract-dnd-mdn:${PUBLISHED_REF.toLowerCase()}@awardwatch.ca`, "contract-award-radar-3@awardwatch.ca",
  "contract-award-cb-400-40000004@awardwatch.ca",
];

async function watchFeed(a: { user: string; cookie: string; token: string }): Promise<FeedRow> {
  const made = await makeFeed(a, "watchlist");
  expect(made.headers.get("location")).toBe("/account/watches?m=feed_added#calendar");
  return (await feedRows(a.user)).find((f) => f.kind === "watchlist" && !f.revoked_at)!;
}

describe("the watches' feed", () => {
  beforeAll(async () => {
    await applySql(RECORDS, RECORDS_SCHEMA);
    await RECORDS.batch(["rec_contracts", "records", "rec_orgs", "rec_buyers"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
    // One published contract at National Defence, held by Org B, no amendment.
    await RECORDS.batch([
      RECORDS.prepare(
        "INSERT INTO rec_contracts (k, dept, ref, pid, bid, oid, wh, cdate, start, endd, value, inst, desc_en, desc_fr) " +
        "VALUES (2001, 'dnd-mdn', ?, NULL, 102, ?, 0, '2026-04-10', '2026-04-15', '2027-06-30', 5000000, 'C', 'Translation services', NULL)",
      ).bind(PUBLISHED_REF, orgNumber(ORG_B)),
      RECORDS.prepare("INSERT INTO records (k, src, fy, fq, bid, oid, extra, cents, vnote, comp, meth) VALUES (2001, 3, 2026, 1, 102, ?, 0, 5000000, 0, 0, 'TN')")
        .bind(orgNumber(ORG_B)),
      RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, 'Org B Two Inc.')").bind(orgNumber(ORG_B)),
      RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (102, 'dnd-mdn', 'National Defence', 'Défense nationale')"),
    ]);
  });
  beforeEach(() => radar(WINDOW));

  it("read the radar's window through its end-date index, bounded, within D1's 100 bound values", async () => {
    expect(WATCH_ENDS_SQL).toMatch(new RegExp(`LIMIT ${FEED_EVENTS_MAX}$`));
    const highest = Math.max(...[...WATCH_ENDS_SQL.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
    expect(highest).toBe(2 + 3 * ENDS_SLOTS);
    expect(highest).toBeLessThanOrEqual(100);
    const binds = endsBinds(DAY, [
      { target: orgNumber(ORG)!, mark: "", last: "2027-10-31" }, { target: "pwgsc-tpsgc", mark: " 43 ", last: "2027-05-01" },
    ]);
    expect(binds).toHaveLength(highest);
    expect(binds.slice(0, 2)).toEqual([DAY, "2027-10-31"]);
    expect(binds.slice(-3)).toEqual([-1, "", ""]);
    const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${WATCH_ENDS_SQL}`).bind(...binds).all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    const text = steps.join("\n");
    expect(steps.filter((s) => /^SCAN rec_expiring\b/.test(s) && !/USING/.test(s)), text).toEqual([]);
    expect(text).toMatch(/SEARCH rec_expiring USING INDEX rec_expiring_end \(endd>\? AND endd<\?\)/);
  });

  it("lists each followed contract's end, the contracts each organization and buyer watch holds within its horizon, and a followed notice's closing", async () => {
    const a = await proAccount("wfeed-contents", []);
    await followAll(a.user);
    const feed = await watchFeed(a);
    const res = await get(feedPath(feed));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    const cal = wellFormed(text);
    expect(cal.getFirstPropertyValue("x-wr-calname")).toBe("Award Watch · Watches");
    const list = events(cal);
    // Soonest first, each contract once whichever watches reach it; Office
    // furniture (segment 81, and Org B follows no end), Base security (past
    // the 6-month horizon), the ended contract and the one past 12 months
    // are not there.
    expect(list.map((e) => e.uid)).toEqual(EXPECTED);
    const by = (uid: string) => list.find((e) => e.uid === uid)!;
    // The holder first; a withheld person's record says so.
    expect(by(EXPECTED[0]).summary).toBe("Ends: Exemplar Works Ltd. · Public Services and Procurement Canada · Cleaning services");
    expect(by(EXPECTED[2]).summary).toBe("Ends: Org B Two Inc. · National Defence · Fleet maintenance");
    expect(by(EXPECTED[3]).summary).toBe("Ends: Individual, name withheld · Public Services and Procurement Canada · Snow removal");
    expect(by(EXPECTED[6]).summary).toBe("Ends: Org B Two Inc. · National Defence · Translation services");
    expect(by(EXPECTED[8]).summary)
      .toBe("Ends: Exemplar Translation Services Inc. · Public Services and Procurement Canada · Translation standing offer, official languages");
    expect(by(EXPECTED[1]).summary.startsWith("Closes: ")).toBe(true);
    expect(prop(text, "DTSTART").slice(0, 3)).toEqual([
      "DTSTART;VALUE=DATE:20261120", "DTSTART:20261126T190000Z", "DTSTART;VALUE=DATE:20270115",
    ]);
    expect(by(EXPECTED[0]).description).toContain(`On Award Watch: ${LOCAL}/awards/radar-1`);
    expect(prop(text, "CATEGORIES")[0]).toBe("CATEGORIES:Award Watch,Contract end");
    // The single records' events are the one-event files' own.
    const award = events(wellFormed(await (await get("/awards/cb-400-40000004.ics", { env: offEnv() })).text()))[0];
    expect([award.uid, award.sequence, award.summary]).toEqual([by(EXPECTED[8]).uid, by(EXPECTED[8]).sequence, by(EXPECTED[8]).summary]);
    expect(text).not.toContain(a.email);
    // In French, under its French name.
    const fr = wellFormed(await (await get(feedPath(feed, "&lang=fr"))).text());
    expect(fr.getFirstPropertyValue("x-wr-calname")).toBe("Award Watch · Suivis");
    expect(nbsp(events(fr)[0].summary)).toBe("Prend fin : Exemplar Works Ltd. · Public Services and Procurement Canada · FR Cleaning services");
  });

  it("merges the watches with every saved tender search in the all feed, and counts it on the searches page", async () => {
    const a = await proAccount("wfeed-all");
    await followAll(a.user);
    await makeFeed(a, "all");
    const [feed] = await feedRows(a.user);
    const cal = wellFormed(await (await get(feedPath(feed))).text());
    // Segment 82's open notice closes 2026-11-04, before the rest.
    expect(events(cal).map((e) => e.uid)).toEqual(["notice-cb-100-10000001@awardwatch.ca", ...EXPECTED]);
    const page = await (await get("/account/searches", { cookie: a.cookie })).text();
    expect(page).toContain("All saved tender searches and watches");
    expect(page).toContain(`${EXPECTED.length + 1} events today`);
  });

  it("keeps an event's UID and raises its SEQUENCE when an amendment moves the end", async () => {
    const a = await proAccount("wfeed-moved", []);
    await follow(a.user, "organization", ORG);
    await follow(a.user, "contract", "award:cb-400-40000004");
    const feed = await watchFeed(a);
    const before = await (await get(feedPath(feed))).text();
    const radar1 = (text: string) => events(wellFormed(text)).filter((e) => e.uid === "contract-award-radar-1@awardwatch.ca");
    expect(radar1(before).map((e) => [e.sequence, e.startDate.toString()])).toEqual([[0, "2026-11-20"]]);
    // The radar's row: the end moved to January with the first amendment.
    await radar(WINDOW.map((e) => (e.k === 1 ? { ...e, end: "2027-01-31", amendments: 1 } : e)));
    // The award notice's detail: its end moved with amendment 1.
    const contracts = clone(FILES["contracts/637.json"]) as Record<string, Record<string, unknown>>;
    contracts["award:cb-400-40000004"].end = "2030-03-31";
    contracts["award:cb-400-40000004"].amendment = 1;
    const after = await (await get(feedPath(feed), { env: onEnv({ ASSETS: makeFakeAssets({}, { "contracts/637.json": contracts }) }) })).text();
    expect(radar1(after).map((e) => [e.sequence, e.startDate.toString()])).toEqual([[1, "2027-01-31"]]);
    const award = (text: string) => events(wellFormed(text)).filter((e) => e.uid === "contract-award-cb-400-40000004@awardwatch.ca")
      .map((e) => [e.sequence, e.startDate.toString()]);
    expect(award(before)).toEqual([[0, "2029-09-30"]]);
    expect(award(after)).toEqual([[1, "2030-03-31"]]);
  });

  it("holds 500 events at most, the soonest, the last counting the radar rows past the ones read", async () => {
    const a = await proAccount("wfeed-cap", []);
    await follow(a.user, "buyer", "dfo-mpo");
    // 620 contracts at Fisheries and Oceans, two ending on each of the next 260 days and one on each of the 100 after.
    await radar(Array.from({ length: 620 }, (_, i) => ({
      k: 100 + i, end: addDays(DAY, 1 + (i % 360)), title: `Vessel ${i}`, oid: ORG_B, buyer: "dfo-mpo",
    })));
    const feed = await watchFeed(a);
    const text = await (await get(feedPath(feed))).text();
    const list = events(wellFormed(text));
    expect(list).toHaveLength(FEED_EVENTS_MAX);
    expect(list[0].startDate.toString()).toBe(addDays(DAY, 1));
    // 249 days of two, then the first of day 250.
    expect(list[FEED_EVENTS_MAX - 2].startDate.toString()).toBe(addDays(DAY, 250));
    const last = list[FEED_EVENTS_MAX - 1];
    expect(last.summary).toBe("Award Watch: 121 more end dates, see the site");
    expect(last.startDate.toString()).toBe(DAY);
    expect(last.description).toBe(`This feed holds the 499 soonest dates. The rest are on the site: ${LOCAL}/account/watches`);
    expect(await (await get("/account/watches", { cookie: a.cookie })).text()).toContain("500 events today");
  });

  it("holds exactly FEED_EVENTS_MAX radar rows whole, and cuts one more to 499 and a cap counting 2", async () => {
    const a = await proAccount("wfeed-edge", []);
    await follow(a.user, "buyer", "dfo-mpo");
    const feed = await watchFeed(a);
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ k: 3000 + i, end: addDays(DAY, 1 + (i % 300)), title: `Hull ${i}`, oid: ORG_B, buyer: "dfo-mpo" }));
    await radar(rows(FEED_EVENTS_MAX));
    const exact = events(wellFormed(await (await get(feedPath(feed))).text()));
    expect(exact).toHaveLength(FEED_EVENTS_MAX);
    expect(exact.filter((e) => e.uid.startsWith("more-"))).toEqual([]);
    expect(await (await get("/account/watches", { cookie: a.cookie })).text()).toContain(`${FEED_EVENTS_MAX} events today`);
    // The statement reads FEED_EVENTS_MAX rows and counts 501: one unread, so 499 kept and 2 out of the file.
    await radar(rows(FEED_EVENTS_MAX + 1));
    const over = events(wellFormed(await (await get(feedPath(feed))).text()));
    expect(over).toHaveLength(FEED_EVENTS_MAX);
    expect(over.at(-1)!.summary).toBe("Award Watch: 2 more end dates, see the site");
    expect(over.filter((e) => e.uid.startsWith("contract-"))).toHaveLength(FEED_EVENTS_MAX - 1);
    expect(await (await get("/account/watches", { cookie: a.cookie })).text()).toContain(`${FEED_EVENTS_MAX} events today`);
  });

  it("counts the instruments statement's own rows by instrument and holder, not by holder row, at the cap's edge", async () => {
    // A holder with no other instrument, in two regions of each: two rec_holders rows, one group, one event per instrument.
    const HOLDER = "org-c000000777";
    const fill = async (from: number, to: number) => {
      const stmts: D1PreparedStatement[] = [];
      for (let i = from; i < to; i++) {
        stmts.push(
          RECORDS.prepare("INSERT INTO rec_instruments (k, agr, type_en, start, expiry, n, nw) VALUES (?, ?, 'Supply Arrangement', '2024-04-01', ?, 2, 0)")
            .bind(50_000 + i, `EDGE-${String(i).padStart(4, "0")}`, addDays(DAY, 1 + (i % 150))),
          ...["BC", "AB"].map((region, r) => RECORDS.prepare(
            "INSERT INTO rec_holders (k, ik, oid, name, region, region_en, region_fr, seen) VALUES (?, ?, ?, 'Edge Holder Ltd.', ?, ?, ?, '2026-10-30')",
          ).bind(60_000 + 2 * i + r, 50_000 + i, orgNumber(HOLDER), region, region, region)),
        );
      }
      for (let i = 0; i < stmts.length; i += 100) await RECORDS.batch(stmts.slice(i, i + 100));
    };
    const clear = () => RECORDS.batch([
      RECORDS.prepare("DELETE FROM rec_holders WHERE k >= 60000"), RECORDS.prepare("DELETE FROM rec_instruments WHERE k >= 50000"),
    ]);
    await clear();
    try {
      await radar([]);
      const a = await proAccount("wfeed-inst-edge", []);
      await follow(a.user, "organization", HOLDER, { events: "instrument_expires_6m" });
      const feed = await watchFeed(a);
      await fill(0, FEED_EVENTS_MAX);
      // The statement's count is its groups: FEED_EVENTS_MAX of them, read whole.
      const binds = instrumentBinds(DAY, [orgNumber(HOLDER)!]);
      const read = (await RECORDS.prepare(WATCH_INSTRUMENTS_SQL).bind(...binds).all<{ total: number }>()).results;
      expect(read).toHaveLength(FEED_EVENTS_MAX);
      expect(read[0].total).toBe(FEED_EVENTS_MAX);
      const exact = events(wellFormed(await (await get(feedPath(feed))).text()));
      expect(exact).toHaveLength(FEED_EVENTS_MAX);
      expect(exact.every((e) => e.uid.startsWith("instrument-"))).toBe(true);
      // One more instrument: 1,002 holder rows, 501 groups, 500 read; 499 kept and the cap counting 2.
      await fill(FEED_EVENTS_MAX, FEED_EVENTS_MAX + 1);
      const more = (await RECORDS.prepare(WATCH_INSTRUMENTS_SQL).bind(...binds).all<{ total: number }>()).results;
      expect(more).toHaveLength(FEED_EVENTS_MAX);
      expect(more[0].total).toBe(FEED_EVENTS_MAX + 1);
      const over = events(wellFormed(await (await get(feedPath(feed))).text()));
      expect(over).toHaveLength(FEED_EVENTS_MAX);
      expect(over.at(-1)!.summary).toBe("Award Watch: 2 more end dates, see the site");
      expect(over.at(-1)!.description).toBe(`This feed holds the ${FEED_EVENTS_MAX - 1} soonest dates. The rest are on the site: ${LOCAL}/account/watches`);
    } finally {
      await clear();
    }
  });

  it("answers 503, never an empty calendar, while the records database is not ready", async () => {
    const a = await proAccount("wfeed-loading", []);
    await follow(a.user, "organization", ORG);
    const feed = await watchFeed(a);
    await radar(WINDOW, "loading");
    const error = console.error;
    console.error = () => undefined;
    try {
      const res = await get(feedPath(feed));
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("600");
      expect(await res.text()).not.toContain("BEGIN:VCALENDAR");
      // The page still shows the feed, without a count it cannot make.
      const page = await (await get("/account/watches", { cookie: a.cookie })).text();
      expect(page).toContain(feed.secret);
      expect(page).not.toContain("events today");
    } finally {
      console.error = error;
    }
    // A watchlist with no contract ending in its horizon is a valid calendar with no event.
    await radar([]);
    const empty = wellFormed(await (await get(feedPath(feed))).text());
    expect(empty.getAllSubcomponents("vevent")).toHaveLength(0);
    expect(empty.getFirstPropertyValue("x-wr-calname")).toBe("Award Watch · Watches");
  });

  it("shows the feed's cell on the watches page in both languages, and rotates and removes it there", async () => {
    const a = await proAccount("wfeed-page", []);
    await followAll(a.user);
    const fresh = await (await get("/account/watches", { cookie: a.cookie })).text();
    const panel = (page: string) => page.slice(page.indexOf('id="calendar"'));
    expect(panel(fresh)).toContain('<input type="hidden" name="kind" value="watchlist"/>');
    expect(panel(fresh)).toContain("Make a calendar feed");
    const feed = await watchFeed(a);
    const en = (await (await get("/account/watches?m=feed_added", { cookie: a.cookie })).text()).replace(/&#39;/g, "'");
    expect(en).toContain("The calendar feed is made. Copy its address into a calendar app.");
    expect(panel(en)).toContain('id="calendar">Calendar Feed</h2>');
    expect(panel(en)).toContain(`value="${LOCAL}/account/calendar/${feed.id}.ics?t=${feed.secret}"`);
    expect(panel(en)).toContain(`Not read yet · ${EXPECTED.length} events today`);
    expect(panel(en)).toContain("A calendar feed of your watches lists the end date of each followed contract");
    expect(panel(en)).toContain("Each end date's title starts with the holder");
    expect(panel(en)).toContain("Google Calendar: Other calendars, then From URL, then paste the address.");
    expect(panel(en)).toContain('<script src="/calendar.js" defer=""></script>');
    await get(feedPath(feed));
    const fr = nbsp((await (await get("/account/watches?lang=fr", { cookie: a.cookie })).text()));
    expect(panel(fr)).toContain('id="calendar">Flux de calendrier</h2>');
    expect(panel(fr)).toContain(`value="${LOCAL}/account/calendar/${feed.id}.ics?t=${feed.secret}&amp;lang=fr"`);
    expect(panel(fr)).toContain(`Lu par un calendrier pour la dernière fois le ${today()} · ${EXPECTED.length} événements aujourd’hui`);
    expect(panel(fr)).toContain("Changer l’adresse");
    expect(panel(fr)).toContain("Un flux de calendrier de vos suivis présente la date de fin de chaque contrat suivi");
    for (const page of [en, fr]) expect(page).not.toContain(EM_DASH);
    // Rotating and removing answer on the watches page.
    const rotated = await post(`/account/calendar/${feed.id}/rotate`, { csrf: a.token }, { cookie: a.cookie });
    expect(rotated.headers.get("location")).toBe("/account/watches?m=feed_rotated#calendar");
    expect((await get(feedPath(feed))).status).toBe(404);
    const removed = await post(`/account/calendar/${feed.id}/delete`, { csrf: a.token }, { cookie: a.cookie });
    expect(removed.headers.get("location")).toBe("/account/watches?m=feed_removed#calendar");
    expect((await feedRows(a.user)).every((f) => f.revoked_at)).toBe(true);
  });

  // The standing offers and supply arrangements: ORG holds the regional offer
  // in British Columbia and Alberta and the supply arrangement nationally,
  // both expiring within the 182 days from the data date (2027-05-01 is the
  // last day), and the national offer, expiring after; Org B holds the
  // regional offer too, and a holder with no profile the arrangement.
  async function instruments(): Promise<void> {
    const inst = (k: number, agr: string, type: [string, string], desc: [string, string | null], expiry: string, n: number) =>
      RECORDS.prepare(
        "INSERT OR REPLACE INTO rec_instruments (k, agr, type_en, type_fr, desc_en, desc_fr, user_en, user_fr, start, expiry, n, nw) " +
        "VALUES (?, ?, ?, ?, ?, ?, 'Public Services and Procurement Canada', 'Services publics et Approvisionnement Canada', '2024-04-01', ?, ?, 0)",
      ).bind(k, agr, ...type, ...desc, expiry, n);
    const holder = (k: number, ik: number, oid: string | null, name: string, region: string, en: string, fr: string) =>
      RECORDS.prepare("INSERT OR REPLACE INTO rec_holders (k, ik, oid, name, region, region_en, region_fr, seen) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-10-30')")
        .bind(k, ik, oid ? orgNumber(oid) : null, name, region, en, fr);
    await RECORDS.batch([
      inst(3001, "E60ZT-120002/001/ZT", ["Regional Master Standing Offer", "Offre à commandes principale régionale"],
        ["Environmental consulting services", "Services d'experts-conseils en environnement"], "2027-03-31", 14),
      inst(3002, "E60ZT-120003/001/ZT", ["Supply Arrangement", "Arrangement en matière d'approvisionnement"], ["Geospatial data services", null],
        "2026-12-31", 3),
      inst(3003, "EZ899-250380/001/ZM", ["National Master Standing Offer", "Offre à commandes principale et nationale"],
        ["Translation services", "Services de traduction"], "2027-06-30", 1),
      holder(4001, 3001, ORG, "Exemplar Works Ltd.", "BC", "British Columbia", "Colombie-Britannique"),
      holder(4002, 3001, ORG, "Exemplar Works Ltd.", "AB", "Alberta", "Alberta"),
      holder(4003, 3001, ORG_B, "Org B Two Inc.", "BC", "British Columbia", "Colombie-Britannique"),
      holder(4004, 3002, ORG, "Exemplar Works Ltd.", "NA", "National", "National"),
      holder(4005, 3002, null, "Unlinked Survey Ltd.", "NA", "National", "National"),
      holder(4006, 3003, ORG, "Exemplar Works Ltd.", "NC", "National Capital Region", "Région de la capitale nationale"),
    ]);
  }

  it("read the instruments an organization watch holds through each instrument's holders, bounded, within D1's 100 bound values", async () => {
    expect(INSTRUMENT_DAYS).toBe(WINDOW_DAYS["6m"]);
    expect(WATCH_INSTRUMENTS_SQL).toMatch(new RegExp(`LIMIT ${FEED_EVENTS_MAX}$`));
    const highest = Math.max(...[...WATCH_INSTRUMENTS_SQL.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));
    expect(highest).toBe(2 + INSTRUMENT_SLOTS);
    expect(highest).toBeLessThanOrEqual(100);
    const binds = instrumentBinds(DAY, [orgNumber(ORG)!]);
    expect(binds).toHaveLength(highest);
    expect(binds.slice(0, 4)).toEqual([DAY, "2027-05-01", orgNumber(ORG), -1]);
    const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${WATCH_INSTRUMENTS_SQL}`).bind(...binds).all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    const text = steps.join("\n");
    // rec_holders has no index by organization: rec_instruments (a few thousand rows) is the outer table, and each
    // instrument's holders are sought through rec_holders_instrument; rec_holders is never scanned.
    expect(steps.filter((s) => /^SCAN h\b|^SCAN rec_holders\b/.test(s)), text).toEqual([]);
    // The expiry index narrows the window since 2026-11-07 (records_schema.sql rec_instruments_expiry).
    expect(text).toMatch(/^SEARCH i USING INDEX rec_instruments_expiry /m);
    expect(text).toMatch(/SEARCH h USING (COVERING )?INDEX rec_holders_instrument \(ik=\?\)/);
  });

  it("lists the instruments each organization watch that follows their expiry holds, one event per instrument and holder", async () => {
    await instruments();
    const a = await proAccount("wfeed-instruments", []);
    // ORG through its retired id and its own; Org B follows the gains and losses but not the expiry.
    await follow(a.user, "organization", RETIRED, { events: "instrument_expires_6m" });
    await follow(a.user, "organization", ORG, { events: "award,instrument_expires_6m" });
    await follow(a.user, "organization", ORG_B, { events: "award,instrument_gained,instrument_lost" });
    const feed = await watchFeed(a);
    const text = await (await get(feedPath(feed))).text();
    const cal = wellFormed(text);
    const list = events(cal);
    const SA_UID = "instrument-sosa:e60zt-120003%2F001%2Fzt:org-a000000001@awardwatch.ca";
    const RMSO_UID = "instrument-sosa:e60zt-120002%2F001%2Fzt:org-a000000001@awardwatch.ca";
    expect(list.map((e) => e.uid)).toEqual([SA_UID, RMSO_UID]);
    const [sa, rmso] = list;
    expect(sa.summary).toBe("Expires: E60ZT-120003/001/ZT · Supply Arrangement · Exemplar Works Ltd.");
    expect(rmso.summary).toBe("Expires: E60ZT-120002/001/ZT · Regional Master Standing Offer · Exemplar Works Ltd.");
    expect([rmso.sequence, rmso.startDate.toString(), rmso.endDate.toString()]).toEqual([0, "2027-03-31", "2027-04-01"]);
    expect(rmso.description.split("\n")).toEqual([
      "Agreement number: E60ZT-120002/001/ZT", "Type: Regional Master Standing Offer", "Description: Environmental consulting services",
      "Holder: Exemplar Works Ltd.", "Regions: Alberta, British Columbia", "End user: Public Services and Procurement Canada",
      "Start: 2024-04-01", "Expiry: 2027-03-31", "Active holders: 14", `On Award Watch: ${LOCAL}/instruments/E60ZT-120002%2F001%2FZT`,
    ]);
    expect(prop(text, "URL")).toContain(`URL:${LOCAL}/instruments/E60ZT-120002%2F001%2FZT`);
    expect(prop(text, "CATEGORIES")).toEqual(["CATEGORIES:Award Watch,Instrument expiry", "CATEGORIES:Award Watch,Instrument expiry"]);
    expect(prop(text, "TRANSP")).toEqual(["TRANSP:TRANSPARENT", "TRANSP:TRANSPARENT"]);
    expect(prop(text, "DTSTART")).toEqual(["DTSTART;VALUE=DATE:20261231", "DTSTART;VALUE=DATE:20270331"]);
    // In French.
    const fr = events(wellFormed(await (await get(feedPath(feed, "&lang=fr"))).text()));
    expect(nbsp(fr[1].summary)).toBe("Expire : E60ZT-120002/001/ZT · Offre à commandes principale régionale · Exemplar Works Ltd.");
    expect(nbsp(fr[1].description)).toContain("Régions : Alberta, Colombie-Britannique");
    expect(nbsp(fr[0].description)).toContain("Description : Geospatial data services");
    // An expiry moved past the 182 days leaves the feed; the UID of the one that stays is unchanged.
    await RECORDS.prepare("UPDATE rec_instruments SET expiry = '2027-05-02' WHERE k = 3002").run();
    const later = events(wellFormed(await (await get(feedPath(feed))).text()));
    expect(later.map((e) => e.uid)).toEqual([RMSO_UID]);
    await RECORDS.prepare("UPDATE rec_instruments SET expiry = '2026-12-31' WHERE k = 3002").run();
    // The watches page counts them with the feed.
    expect(await (await get("/account/watches", { cookie: a.cookie })).text()).toContain("2 events today");
  });

  it("gives a Free account the Pro chip and one line, and no feed", async () => {
    const email = newEmail("wfeed-free");
    const cookie = await signIn(email);
    const user = await userId(email);
    await follow(user, "organization", ORG);
    const page = await (await get("/account/watches", { cookie })).text();
    const panel = page.slice(page.indexOf('id="calendar"'));
    expect(panel).toContain('class="pro-tag"');
    expect(panel).toContain("A calendar feed of your watches, with their end and closing dates, is part of Pro.");
    expect(panel).not.toContain("Make a calendar feed");
    const fr = nbsp(await (await get("/account/watches?lang=fr", { cookie })).text());
    expect(fr).toContain("Un flux de calendrier de vos suivis, avec leurs dates de fin et de clôture, fait partie de Pro.");
    const made = await post("/account/calendar", { csrf: await csrf(cookie, "/account/watches"), kind: "watchlist" }, { cookie });
    expect(made.headers.get("location")).toBe("/account/watches?m=feed_pro#calendar");
    expect(await feedRows(user)).toHaveLength(0);
    // A Pro account's feed stops when the plan does.
    const b = await proAccount("wfeed-lapse", []);
    await follow(b.user, "organization", ORG);
    const feed = await watchFeed(b);
    expect((await get(feedPath(feed))).status).toBe(200);
    await ACCOUNTS.prepare("UPDATE entitlements SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), b.user).run();
    expect((await get(feedPath(feed))).status).toBe(404);
  });
});
