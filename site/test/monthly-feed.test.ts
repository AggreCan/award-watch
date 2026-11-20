// The monthly record's Atom feed (pipeline feeds.py write_monthly_feed, written with the record's own files). The
// fixture feed-canada-monthly.xml is the writer's bytes for the twelve months written out below
// (pipeline/tests/test_monthly_feed.py holds the two equal), so each entry's title and summary are held here to the
// month page's own words and to the site's formatting of a month, a count and a sum in both languages. Then the
// pages that announce it while the monthly index names it (the head of /monthly and of each month, the Follow by feed
// link beside the index's CSV file, a line and a row on /feeds), nothing more on those pages, nothing on any other
// page, and the poll counted under the feeds' template.
import { describe, expect, it } from "vitest";
import type { MonthFigures } from "../src/data";
import { app } from "../src/index";
import { fmtInt, fmtMoney, t, tn, type Key, type Lang } from "../src/i18n";
import { monthLead, monthName } from "../src/pages/monthly";
import { feedFile, routeTemplate } from "../src/views";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import feedXml from "./fixtures/feed-canada-monthly.xml?raw";
import aug from "./fixtures/monthly-2026-08.json";
import july from "./fixtures/monthly-2026-07.json";
import sept from "./fixtures/monthly-2026-09.json";

const FEED = "feeds/canada/monthly.xml";
const HEAD_EN = `<link rel="alternate" type="application/atom+xml" title="Monthly record of federal procurement (Atom feed)" href="/data/${FEED}"/>`;
const HEAD_FR = `<link rel="alternate" type="application/atom+xml" title="Bilan mensuel des marchés publics fédéraux (fil Atom)" href="/data/${FEED}"/>`;
const FOLLOW_EN = `<a href="/data/${FEED}">Follow by feed</a>`;
const FOLLOW_FR = `<a href="/data/${FEED}">Suivre par fil Atom</a>`;
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const NBSP = String.fromCharCode(0xa0);
// The feeds page's own space before a French colon (pages/feeds.tsx), narrower than the dictionary's.
const NNBSP = String.fromCharCode(0x202f);

// The rows the fixture was written from (test_monthly_feed.py SITE_ROWS and SITE_DATES): [month, tender notices,
// award notices, the value the award notices state, the month's date in the ledger]. The first three are
// monthly-index.json's months.
type Row = [string, number, number, number | null, string];
const ROWS: Row[] = [
  ["2026-09", 1234, 567, 98765432.1, "2026-10-01"],
  ["2026-08", 40, 0, null, "2026-09-01"],
  ["2026-07", 35, 5, 1000, "2026-10-31"],
  ["2026-06", 1, 1, 512.5, "2026-07-01"],
  ["2026-05", 0, 3, 0, "2026-06-01"],
  ["2026-04", 2, 1, 2.675, "2026-05-01"],
  ["2026-03", 1500, 820, 1234.5, "2026-04-01"],
  ["2026-02", 980, 410, 2500000000.99, "2026-03-01"],
  ["2026-01", 1100, 0, null, "2026-02-01"],
  ["2025-12", 0, 0, null, "2026-01-01"],
  ["2025-11", 1, 2, 999.995, "2025-12-01"],
  ["2025-10", 12000, 7, 1150000, "2025-11-01"],
];

let address = 0;
const get = (path: string, env: object = testEnv(), headers: Record<string, string> = {}) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.51.100.${(address++ % 250) + 1}`, ...headers } }, env);
const html = async (path: string, env: object = testEnv()) => (await get(path, env)).text();
const headOf = (page: string) => page.slice(0, page.indexOf("</head>"));
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// The index without the feed: the night the feed was not written, or an export from before it existed.
const withoutFeed = () => testEnv(makeFakeAssets({}, {
  "monthly/index.json": Object.fromEntries(Object.entries(FILES["monthly/index.json"] as object).filter(([k]) => k !== "feed")),
}));
// What a panel's head holds beside its heading.
const toolsOf = (page: string, heading: string) => {
  const at = page.indexOf(`<h2>${heading}</h2>`);
  expect(at, heading).toBeGreaterThan(-1);
  return /<\/h2><div class="panel-tools">([\s\S]*?)<\/div>/.exec(page.slice(at))?.[1];
};

// The fixture's entries, read as text (the Workers runtime has no XML parser).
const entries = [...feedXml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
  const field = (re: RegExp) => decode(re.exec(m[1])?.[1] ?? "");
  return {
    id: field(/<id>(.*?)<\/id>/), title: field(/<title>(.*?)<\/title>/), updated: field(/<updated>(.*?)<\/updated>/),
    summary: field(/<summary>(.*?)<\/summary>/), en: field(/hreflang="en" href="([^"]*)"/), fr: field(/hreflang="fr" href="([^"]*)"/),
    via: /rel="via"/.test(m[1]),
  };
});

// A month's count as the page's lead words it (pages/monthly.tsx monthLead): none, one or many.
const notices = (lang: Lang, kind: "tenders" | "awards", n: number) =>
  n === 0 ? t(lang, `monthly.lead_${kind}_none` as Key)
    : tn(lang, `monthly.lead_${kind}_one` as Key, `monthly.lead_${kind}_many` as Key, n, { n: fmtInt(n, lang) });

describe("the feed's entries", () => {
  it("are one a month, newest first, each with a stable id, the month's page in both languages and its ledger date", () => {
    expect(entries.map((e) => e.id)).toEqual(ROWS.map(([m]) => `tag:awardwatch.ca,2026:monthly/${m}`));
    for (const [i, [month, , , , day]] of ROWS.entries()) {
      expect(entries[i].en).toBe(`https://awardwatch.ca/monthly/${month}`);
      expect(entries[i].fr).toBe(`https://awardwatch.ca/monthly/${month}?lang=fr`);
      expect(entries[i].updated).toBe(`${day}T00:00:00Z`);
      expect(entries[i].via).toBe(false);
    }
    // The feed's date is its newest entry's: July's (a figure that moved late), not September's.
    expect(feedXml).toContain("  <updated>2026-10-31T00:00:00Z</updated>\n  <link rel=\"self\" type=\"application/atom+xml\" href=\"https://awardwatch.ca/data/feeds/canada/monthly.xml\" />");
    expect(feedXml).toContain('<link rel="alternate" type="text/html" href="https://awardwatch.ca/monthly" />');
    expect(feedXml).not.toContain(EM_DASH);
    expect(feedXml).not.toContain(EN_DASH);
  });

  it("are titled as the month's page is, in both languages", () => {
    for (const [i, [month]] of ROWS.entries()) {
      expect(entries[i].title).toBe(`${t("en", "monthly.page_title", { month: monthName("en", month) })} / ${t("fr", "monthly.page_title", { month: monthName("fr", month) })}`);
    }
    expect(entries[0].title).toBe("Federal Procurement in September 2026 / Marchés publics fédéraux en septembre 2026");
    expect(entries[9].title).toBe("Federal Procurement in December 2025 / Marchés publics fédéraux en décembre 2025");
  });

  it("sum the month up in one sentence of the page's words and the site's numbers", () => {
    const summary = (lang: Lang, [month, tenders, awards, value]: Row) => {
      const vars = { month: monthName(lang, month), tenders: notices(lang, "tenders", tenders), awards: notices(lang, "awards", awards) };
      return value === null ? t(lang, "monthly.lead_published", vars) : t(lang, "monthly.feed_summary", { ...vars, value: fmtMoney(value, lang) });
    };
    for (const [i, row] of ROWS.entries()) expect(entries[i].summary, row[0]).toBe(`${summary("en", row)} / ${summary("fr", row)}`);
    // Written out: 1,234 and 567 notices and $98,765,432.10, whole dollars from $1,000 up; one of each and $512.50;
    // none of either and no value.
    const nb = NBSP;
    expect(entries[0].summary).toBe("In September 2026, federal buyers published 1,234 tender notices and 567 award notices on CanadaBuys; the award " +
      "notices state $98,765,432 in Canadian dollars in total. / En septembre 2026, les acheteurs fédéraux ont publié 1" + nb + "234 avis " +
      "d’appel d’offres et 567 avis d’attribution sur AchatsCanada; les avis d’attribution indiquent 98" + nb + "765" + nb + "432" + nb + "$ en " +
      "dollars canadiens au total.");
    expect(entries[3].summary).toBe("In June 2026, federal buyers published 1 tender notice and 1 award notice on CanadaBuys; the award notices " +
      "state $512.50 in Canadian dollars in total. / En juin 2026, les acheteurs fédéraux ont publié 1 avis d’appel d’offres et 1 avis " +
      "d’attribution sur AchatsCanada; les avis d’attribution indiquent 512,50" + nb + "$ en dollars canadiens au total.");
    expect(entries[9].summary).toBe("In December 2025, federal buyers published no tender notice and no award notice on CanadaBuys. / En " +
      "décembre 2025, les acheteurs fédéraux ont publié aucun avis d’appel d’offres et aucun avis d’attribution sur AchatsCanada.");
  });

  it("say what the month's page leads with: its first sentence, and its second joined to it when a value is stated", () => {
    for (const [i, f] of ([sept, aug, july] as unknown as MonthFigures[]).entries()) {
      for (const lang of ["en", "fr"] as const) {
        const lead = monthLead(lang, f);
        const said = entries[i].summary.split(" / ")[lang === "en" ? 0 : 1];
        expect(said, `${f.month} ${lang}`).toBe(f.awards.value === null ? lead[0]
          : `${lead[0].slice(0, -1)}; ${lead[1][0].toLowerCase()}${lead[1].slice(1)}`);
      }
    }
  });
});

describe("the pages that announce it", () => {
  it("name it in the head of the index and of every month, in the page's language", async () => {
    for (const path of ["/monthly", "/monthly/2026-09", "/monthly/2026-08", "/monthly/2026-07"]) {
      expect(headOf(await html(path)), path).toContain(HEAD_EN);
      expect(headOf(await html(`${path}?lang=fr`)), path).toContain(HEAD_FR);
    }
  });

  it("link it beside the index's CSV file, a plain link like it, in both languages", async () => {
    expect(toolsOf(await html("/monthly"), "The Months")).toBe(`<a href="/monthly/months.csv" rel="nofollow">CSV file</a>${FOLLOW_EN}`);
    expect(toolsOf(await html("/monthly?lang=fr"), "Les mois")).toBe(`<a href="/monthly/months.csv" rel="nofollow">Fichier CSV</a>${FOLLOW_FR}`);
    for (const path of ["/monthly", "/monthly?lang=fr"]) {
      const page = await html(path);
      expect(page.match(/href="\/data\/feeds\/canada\/monthly\.xml"/g), path).toHaveLength(2);
      expect(page, path).not.toContain("btn-primary");
    }
    // A month's page names it in its head only.
    expect((await html("/monthly/2026-09")).match(/feeds\/canada\/monthly\.xml/g)).toHaveLength(1);
  });

  it("list it on the feeds page with the national feeds, in both languages", async () => {
    const page = decode(await html("/feeds"));
    expect(page).toContain("<li id=\"monthly\"><strong>Monthly record of federal procurement</strong>: one entry for each month the monthly record " +
      "holds, the last twelve complete months, with the tender notices and award notices published in it and the value the award notices " +
      "state. An entry's date is the night its month's figures last changed.</li>");
    expect(page).toContain('<tr><td data-label="Feed">Monthly record of federal procurement</td><td data-label="Address">' +
      `<a href="/data/${FEED}" class="mono wrap" style="overflow-wrap:anywhere">https://awardwatch.ca/data/${FEED}</a></td></tr>`);
    // In the table of the national feeds, after them.
    const canada = page.slice(page.indexOf('<h2 id="canada">'), page.indexOf('<h2 id="segment">'));
    expect(canada.indexOf("feeds/canada/expiring.xml")).toBeLessThan(canada.indexOf(FEED));
    const fr = await html("/feeds?lang=fr");
    expect(fr).toContain(`<li id="monthly"><strong>Bilan mensuel des marchés publics fédéraux</strong>${NNBSP}: une entrée pour chaque mois que contient ` +
      "le bilan mensuel, soit les douze derniers mois complets, avec les avis d’appel d’offres et d’attribution publiés ce mois-là et la valeur " +
      "qu’indiquent les avis d’attribution. La date d’une entrée est la nuit où les chiffres de son mois ont changé pour la dernière fois.</li>");
    expect(fr).toContain('<td data-label="Fil">Bilan mensuel des marchés publics fédéraux</td>');
    // The feeds' own index missing: the page still lists it, the monthly index being the one that names it.
    expect(await html("/feeds", testEnv(makeFakeAssets({}, { "feeds/index.json": undefined })))).toContain(`https://awardwatch.ca/data/${FEED}`);
  });

  it("add exactly those parts: without the feed each page is the same, byte for byte", async () => {
    const off = withoutFeed();
    const cases: [string, string[]][] = [
      ["/monthly", [HEAD_EN, FOLLOW_EN]],
      ["/monthly?lang=fr", [HEAD_FR, FOLLOW_FR]],
      ["/monthly/2026-09", [HEAD_EN]],
      ["/monthly/2026-09?lang=fr", [HEAD_FR]],
    ];
    for (const [path, parts] of cases) {
      const on = await html(path);
      for (const part of parts) expect(on, `${path} ${part}`).toContain(part);
      expect(parts.reduce((page, part) => page.replace(part, ""), on), path).toBe(await html(path, off));
    }
    for (const lang of ["en", "fr"] as const) {
      const on = await html(`/feeds?lang=${lang}`);
      const line = /<li id="monthly">[\s\S]*?<\/li>/.exec(on)?.[0] ?? "";
      const row = new RegExp(`<tr><td data-label="[^"]*">[^<]*</td><td data-label="[^"]*"><a href="/data/${FEED}"[\\s\\S]*?</tr>`).exec(on)?.[0] ?? "";
      expect(line && row, lang).toBeTruthy();
      expect(on.replace(line, "").replace(row, ""), lang).toBe(await html(`/feeds?lang=${lang}`, off));
    }
  });

  it("say nothing of it while the index does not name a feed file, or names something else", async () => {
    const bad = (feed: unknown) => testEnv(makeFakeAssets({}, { "monthly/index.json": { ...(FILES["monthly/index.json"] as object), feed } }));
    for (const env of [withoutFeed(), bad("https://example.com/feed.xml"), bad("feeds/../x.xml"), bad(5), bad("feeds/canada/monthly.json")]) {
      for (const path of ["/monthly", "/monthly/2026-09", "/feeds", "/monthly?lang=fr"]) {
        const res = await get(path, env);
        expect(res.status, path).toBe(200);
        const page = await res.text();
        expect(page, path).not.toContain("monthly.xml");
        expect(page, path).not.toContain('id="monthly"');
      }
    }
    // A monthly index that does not read leaves the feeds page as it is, without the row.
    const broken = await get("/feeds", testEnv(makeFakeAssets({}, { "monthly/index.json": "{" })));
    expect(broken.status).toBe(200);
    expect(await broken.text()).not.toContain(FEED);
  });

  it("is announced on no other page", async () => {
    for (const path of ["/", "/overview", "/tenders", "/awards", "/feeds", "/data", "/expiring", "/buyers/pwgsc-tpsgc"]) {
      expect(headOf(await html(path)), path).not.toContain("monthly.xml");
    }
  });
});

describe("a poll of the feed", () => {
  it("is served as the export wrote it and counted under the feeds' template with its file", async () => {
    expect(routeTemplate("GET", `/data/${FEED}`)).toEqual({ route: "/data/feeds/:file", kind: "feed" });
    expect(feedFile(`/data/${FEED}`, 200)).toBe(FEED);
    expect(feedFile(`/data/${FEED}`, 304)).toBe(FEED);
    const points: AnalyticsEngineDataPoint[] = [];
    const dataset = { writeDataPoint: (p?: AnalyticsEngineDataPoint) => { if (p) points.push(p); } } as AnalyticsEngineDataset;
    const reader = "Feedly/1.0 (+https://feedly.com/poller.html; 4 subscribers; like FeedFetcher-Google)";
    const res = await app.request(`/data/${FEED}`, { headers: { "user-agent": reader, "cf-connecting-ip": "198.51.100.250" } }, { ...testEnv(), VIEWS: dataset });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/atom+xml");
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.text()).toBe(feedXml);
    expect(points).toEqual([
      { indexes: ["/data/feeds/:file"], blobs: ["/data/feeds/:file", "feed", "en", "", "", "GET", FEED, "bot", "", "", "", "2"], doubles: [200, 4] },
    ]);
  });
});
