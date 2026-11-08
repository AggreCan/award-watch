// Closing times at render. CanadaBuys publishes them in Eastern time with no
// zone in its file (four live notices checked on 2026-11-02, two of them from
// western buyers, all read "EST" on CanadaBuys at the stored wall time). A
// page works out each notice's state from its clock, prints the zone beside
// the time, and marks a notice closing soon for the countdown script.
import { describe, expect, it } from "vitest";
import { closingInstant, closingState, countdownText, easternDay } from "../public/closing.js";
import { clockAt, closesAtUtc, closingSoonCount, closingText, closingTime, tenderState } from "../src/closing";
import type { TenderRow } from "../src/data";
import { app } from "../src/index";
import { homeRequest } from "./home";
import { t } from "../src/i18n";
import { filterTenders, readTenderQuery } from "../src/pages/tenders";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import stats from "./fixtures/stats.json";
import openFirst from "./fixtures/tenders-open-first.json";
import openTenders from "./fixtures/tenders-open.json";

let address = 0;
const page = async (path: string, now: string, overrides: Record<string, unknown> = {}) =>
  (await homeRequest(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.7.${(address++ % 250) + 1}` } },
    testEnv(makeFakeAssets({}, overrides), now))).text();
const at = (iso: string) => clockAt(Date.parse(iso));
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const rail = (html: string) => html.match(/<nav class="rail"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
const rows = openTenders as unknown as TenderRow[];

describe("the Eastern rule", () => {
  it("reads a closing time without a zone as Toronto wall time, across the end of daylight saving", () => {
    // Daylight saving ended at 02:00 on 2026-11-01: 14:00 is 18:00 UTC before, 19:00 UTC after.
    expect(closingInstant("2026-10-31T14:00:00")).toBe(Date.parse("2026-10-31T18:00:00Z"));
    expect(closingInstant("2026-11-02T14:00:00")).toBe(Date.parse("2026-11-02T19:00:00Z"));
    // The hour the clocks repeat reads the first time; the one they skip in March reads an hour later.
    expect(closingInstant("2026-11-01T01:30:00")).toBe(Date.parse("2026-11-01T05:30:00Z"));
    expect(closingInstant("2026-03-08T02:30:00")).toBe(Date.parse("2026-03-08T07:30:00Z"));
    expect(closesAtUtc("2026-11-02T14:00:00")).toBe("2026-11-02T19:00:00Z");
  });

  it("reads a value that names its zone in that zone, and a date alone as a day", () => {
    expect(closingInstant("2026-11-26T14:00:00-08:00")).toBe(Date.parse("2026-11-26T22:00:00Z"));
    expect(closingInstant("2026-11-26T14:00:00Z")).toBe(Date.parse("2026-11-26T14:00:00Z"));
    expect(closingInstant("2026-11-26T14:00:00 PST")).toBe(Date.parse("2026-11-26T22:00:00Z"));
    expect(closingInstant("2026-11-26")).toBeNull();
    expect(closingInstant(null)).toBeNull();
    // A day passes when the Eastern date moves past it: 03:00 UTC on 2026-11-03 is still the 2nd in Toronto.
    expect(easternDay(Date.parse("2026-11-03T03:00:00Z"))).toBe("2026-11-02");
    expect(closingState("2026-11-02", Date.parse("2026-11-03T03:00:00Z"), 7)).toBe("closing");
    expect(closingState("2026-11-02", Date.parse("2026-11-03T06:00:00Z"), 7)).toBe("closed");
  });

  it("gives a notice's state at the clock: closing soon until its time, then closing date passed", () => {
    const before = at("2026-11-02T18:59:00Z");
    const after = at("2026-11-02T19:00:00Z");
    expect(tenderState("open", "2026-11-02T14:00:00", before)).toBe("closing");
    expect(tenderState("open", "2026-11-02T14:00:00", after)).toBe("closed");
    expect(tenderState("open", "2026-11-09T14:00:00", after)).toBe("closing");
    expect(tenderState("open", "2026-11-10T14:00:00", after)).toBe("open");
    // A status other than open passes through.
    expect(tenderState("cancelled", "2026-11-02T14:00:00", after)).toBe("cancelled");
  });
});

describe("the zone beside every closing time", () => {
  it("prints ET (HE in French) when the value names none, the value's own otherwise", () => {
    expect(closingText("2026-11-02T14:00:00", "en")).toBe("2026-11-02 14:00 ET");
    expect(closingText("2026-11-02T14:00:00", "fr")).toBe("2026-11-02 14 h 00 HE");
    expect(closingText("2026-11-02T14:00:00-08:00", "fr")).toBe("2026-11-02 14 h 00 -08:00");
    expect(closingTime("2026-11-02T14:00:00", "en")).toBe("14:00 ET");
    expect(closingTime("2026-11-02", "en")).toBeNull();
    expect(t("en", "common.zone_et")).toBe("ET");
    expect(t("fr", "common.zone_et")).toBe("HE");
  });

  it("is on the list, the notice page and the feeds' note in both languages", async () => {
    const en = await page("/tenders", "2026-10-31T16:00:00Z");
    expect(en).toContain("2026-11-04 14:00 ET");
    const fr = nbsp(await page("/tenders?lang=fr", "2026-10-31T16:00:00Z"));
    expect(fr).toContain("2026-11-04 14 h 00 HE");
    const notice = nbsp(await page("/tenders/cb-200-20005019?lang=fr", "2026-10-31T16:00:00Z"));
    expect(notice).toContain("2026-11-26 14 h 00 HE");
    expect(notice).toContain("AchatsCanada publie les heures de clôture en heure de l’Est (HE).");
  });
});

describe("the state at render", () => {
  it("turns a notice closed at its closing time, and sorts it last, on the server's list", async () => {
    // cb-100-10000001 closes 2026-11-04 at 14:00 Eastern, 19:00 UTC.
    const soon = await page("/tenders", "2026-11-04T18:30:00Z");
    // Sorted by closing date, the row shows the time left; the chip waits hidden for countdown.js.
    expect(soon).toContain('<span class="badge badge-closing" data-notice="cb-100-10000001" hidden="">Closing soon</span><span class="countdown">closes in 30 min</span>');
    expect(soon).toContain('data-closes="2026-11-04T19:00:00Z" data-time="14:00 ET" data-notice="cb-100-10000001"');
    // Sorted by publication date the chip stands.
    const published = await page("/tenders?sort=published", "2026-11-04T18:30:00Z");
    expect(published).toContain('<span class="badge badge-closing" data-notice="cb-100-10000001">Closing soon</span>');
    expect(soon.indexOf('data-ref="cb-100-10000001"')).toBeLessThan(soon.indexOf('data-ref="cb-200-20005019"'));
    const past = await page("/tenders", "2026-11-04T19:00:00Z");
    expect(past).toContain('<span class="badge badge-closed">Closing date passed</span>');
    expect(past).not.toContain('data-closes="2026-11-04T19:00:00Z"');
    expect(past.indexOf('data-ref="cb-100-10000001"')).toBeGreaterThan(past.indexOf('data-ref="cb-300-30000003"'));
  });

  it("sorts and filters by the clock in filterTenders, as the script does", () => {
    const q = (s: string) => readTenderQuery(new URL(`https://x/tenders${s}`));
    const refs = (s: string, iso: string) => filterTenders(rows, q(s), at(iso)).map((r) => r.reference);
    expect(refs("", "2026-11-04T18:59:00Z")).toEqual(["cb-100-10000001", "cb-200-20005019", "cb-300-30000003"]);
    expect(refs("", "2026-11-04T19:00:00Z")).toEqual(["cb-200-20005019", "cb-300-30000003", "cb-100-10000001"]);
    // The closing window counts from the Eastern date and leaves out a notice whose time has passed.
    expect(refs("?closing=7", "2026-11-04T18:59:00Z")).toEqual(["cb-100-10000001"]);
    expect(refs("?closing=7", "2026-11-04T19:00:00Z")).toEqual([]);
    expect(refs("?closing=30", "2026-11-04T19:00:00Z")).toEqual(["cb-200-20005019"]);
  });

  it("puts a passed notice last on the home panels, a segment page and the day's new notices", async () => {
    const day = (openTenders as unknown as TenderRow[]).map((r) => ({ ...r, status: "open" }));
    const newDay = await page("/tenders/new", "2026-11-04T19:00:00Z", { "tenders/new/2026-10-31.json": day });
    expect(newDay.indexOf("cb-100-10000001")).toBeGreaterThan(newDay.indexOf("cb-300-30000003"));
    const home = await page("/", "2026-11-04T19:00:00Z");
    const panel = home.slice(home.indexOf("Closing Within 7 Days"), home.indexOf("Recent Award Notices"));
    expect(panel).not.toContain("cb-100-10000001");
    expect(panel).toContain("No open notice closes in the next 7 days.");
  });

  it("marks the notice page's closing time for the countdown while it is near", async () => {
    // The notice's newest amendment closes 2026-11-04 at 14:00 Eastern.
    const near = await page("/tenders/cb-100-10000001", "2026-11-04T15:00:00Z");
    // The calendar file's link sits beside the time (pages/ics.ts); the script's line goes under both.
    expect(near).toContain('<dd data-closes="2026-11-04T19:00:00Z" data-time="14:00 ET" data-notice="cb-100-10000001">2026-11-04 14:00 ET · ' +
      '<a href="/tenders/cb-100-10000001.ics" class="small" rel="nofollow">Add to calendar</a></dd>');
    expect(near).toContain('<script type="module" src="/countdown.js"></script>');
    const gone = await page("/tenders/cb-100-10000001", "2026-11-04T19:00:00Z");
    expect(gone).toContain('<span class="badge badge-closed">Closing date passed</span>');
    expect(gone).not.toContain("data-closes=");
    expect(gone).not.toContain("/countdown.js");
  });
});

describe("the closing-soon counts", () => {
  const times = ["2026-11-02T14:00:00", "2026-11-03T14:00:00", "2026-11-09", "2026-11-10T14:00:00", "2026-11-12T14:00:00"];
  const withTimes = { "stats.json": { ...(FILES["stats.json"] as object), closing_soon_times: times } };

  it("count the export's closing times at the clock: past ones and ones beyond the week left out", () => {
    // 15:00 Eastern on 2026-11-02: the first has passed; the week runs to the 9th.
    expect(closingSoonCount(times, at("2026-11-02T20:00:00Z"))).toBe(2);
    expect(closingSoonCount(times, at("2026-11-02T18:00:00Z"))).toBe(3);
    // On the 3rd the window reaches the 10th.
    expect(closingSoonCount(times, at("2026-11-03T15:00:00Z"))).toBe(3);
  });

  it("are the rail's and the home panel's, marked so the countdown can lower them", async () => {
    const html = await page("/", "2026-11-02T20:00:00Z", withTimes);
    expect(rail(html)).toContain('<span class="rail-label">Closing within 7 days</span><span class="rail-n" data-soon-count="">2</span>');
    const panel = html.slice(html.indexOf("Closing Within 7 Days"), html.indexOf("Recent Award Notices"));
    expect(panel).toContain('<span class="panel-count"><span data-soon-count="">2</span></span>');
    // An export without the times keeps its own count.
    const older = await page("/", "2026-11-02T20:00:00Z", {
      "stats.json": { ...stats, closing_soon_times: undefined, counts: { ...stats.counts, tenders_closing_soon: 180 } },
    });
    expect(rail(older)).toContain('<span class="rail-n" data-soon-count="">180</span>');
  });

  it("drop a list of times that does not read, falling back as an older export would", async () => {
    const bad = { "stats.json": { ...(FILES["stats.json"] as object), closing_soon_times: [5] } };
    const html = await page("/", "2026-10-31T16:00:00Z", bad);
    expect(rail(html)).toContain('<span class="rail-n" data-soon-count="">1</span>');
  });
});

describe("the countdown", () => {
  const words = {
    in_min: t("en", "countdown.in_min"), in_hm: t("en", "countdown.in_hm"), in_day: t("en", "countdown.in_day"),
    in_days: t("en", "countdown.in_days"), today_at: t("en", "countdown.today_at"),
  };
  const closes = Date.parse("2026-11-04T19:00:00Z"); // 14:00 Eastern
  const left = (iso: string) => countdownText(closes, Date.parse(iso), "14:00 ET", words);

  it("reads minutes, then hours and minutes, then the time today, then days", () => {
    expect(left("2026-11-04T18:48:00Z")).toBe("closes in 12 min");
    expect(left("2026-11-04T18:59:30Z")).toBe("closes in 1 min");
    expect(left("2026-11-04T15:48:00Z")).toBe("closes in 3 h 12 min");
    expect(left("2026-11-04T12:00:00Z")).toBe("closes today at 14:00 ET");
    // Before midnight Eastern the day before: within a day, in hours.
    expect(left("2026-11-04T01:00:00Z")).toBe("closes in 18 h 0 min");
    expect(left("2026-11-03T12:00:00Z")).toBe("closes in 1 day");
    expect(left("2026-11-02T12:00:00Z")).toBe("closes in 2 days");
    expect(left("2026-11-04T19:00:00Z")).toBeNull();
    expect(left("2026-11-04T20:00:00Z")).toBeNull();
  });

  it("has its words in French, handed to the script in a JSON block", async () => {
    const fr = {
      in_min: t("fr", "countdown.in_min"), in_hm: t("fr", "countdown.in_hm"), in_day: t("fr", "countdown.in_day"),
      in_days: t("fr", "countdown.in_days"), today_at: t("fr", "countdown.today_at"),
    };
    expect(countdownText(closes, Date.parse("2026-11-04T15:48:00Z"), "14 h 00 HE", fr)).toBe("ferme dans 3 h 12 min");
    expect(countdownText(closes, Date.parse("2026-11-02T12:00:00Z"), "14 h 00 HE", fr)).toBe("ferme dans 2 jours");
    expect(countdownText(closes, Date.parse("2026-11-04T12:00:00Z"), "14 h 00 HE", fr)).toBe("ferme aujourd’hui à 14 h 00 HE");
    const html = await page("/tenders?lang=fr", "2026-10-31T16:00:00Z");
    const block = JSON.parse(html.match(/<script type="application\/json" id="countdown-i18n">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
    expect(block.words.in_hm).toBe("ferme dans {h} h {m} min");
    expect(block.words["status.closed"]).toBe("Date de clôture passée");
  });

  it("loads only where a notice closing soon is shown", async () => {
    const script = '<script type="module" src="/countdown.js"></script>';
    for (const path of ["/", "/tenders", "/segments/82", "/tenders/cb-100-10000001"]) {
      expect(await page(path, "2026-10-31T16:00:00Z"), path).toContain(script);
    }
    // The day's new notices close on 2026-11-26: not soon on 2026-10-31, soon a week before.
    expect(await page("/tenders/new", "2026-10-31T16:00:00Z")).not.toContain(script);
    expect(await page("/tenders/new", "2026-11-20T16:00:00Z")).toContain(script);
    expect(await page("/tenders/cb-200-20005019", "2026-10-31T16:00:00Z")).not.toContain(script);
    expect(await page("/buyers", "2026-10-31T16:00:00Z")).not.toContain(script);
  });
});
