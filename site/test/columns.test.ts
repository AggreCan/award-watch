// The column system (src/columns.tsx): one width per kind of column, the same
// numbers in the stylesheet as in the code that works out a table's least
// width, and every table on the site drawn on it.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import tendersJs from "../public/tenders.js?raw";
import watchlistJs from "../public/watchlist.js?raw";
import { app } from "../src/index";
import { homeRequest } from "./home";
import { COLUMN_WIDTHS, MAIN_MIN, type Column, headClass, minWidths, tableStyle } from "../src/columns";
import { homeTenderColumns, tenderColumns } from "../src/pages/shared";
import { testEnv } from "./assets";
import { SHEET, edges, leastWidths, mainWidth, misfits, rangeOf, tableColumn, tablesIn } from "./table-fit";

// The stylesheet's text, handed over by vitest.config.ts.
const styles = env.STYLES_CSS;

let address = 0;
const text = async (path: string) =>
  (await homeRequest(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.1.${(address++ % 250) + 1}` } }, testEnv())).text();

// Every page that draws a table, in both languages. The pages that read the
// records database, the search database or an account hold the same check
// in their own tests (expectTablesFit), which set those up.
const PAGES = [
  "/", "/overview", "/tenders", "/tenders/new", "/tenders/cb-100-10000001", "/awards", "/awards/2026", "/awards/erroneous",
  "/awards/cb-400-40000004", "/history/w8472-000633", "/expiring", "/expiring/3m", "/organizations", "/organizations/directory/on",
  "/organizations/org-a000000001", "/organizations/org-a000000002", "/buyers", "/buyers/pwgsc-tpsgc", "/segments", "/segments/82",
  "/rankings", "/rankings/2026?source=contracts&by=count", "/data", "/feeds", "/watchlist", "/methodology",
];

describe("column widths", () => {
  it("are the same numbers in the stylesheet and in src/columns.tsx", () => {
    const css = Object.fromEntries([...styles.matchAll(/^\.k-([a-z]+) \{ width: (\d+)px; \}$/gm)].map((m) => [m[1], Number(m[2])]));
    expect(css).toEqual(COLUMN_WIDTHS);
    // The main column has no width of its own: it takes the rest.
    expect(styles).not.toMatch(/\.k-main\s*\{/);
  });

  it("work out a table's least width in each range from the columns it shows there", () => {
    const cols: Column[] = [
      { kind: "date", label: "" }, { kind: "main", label: "" }, { kind: "org", label: "" },
      { kind: "buyer", label: "", rest: "xl" }, { kind: "value", label: "" }, { kind: "amend", label: "", rest: "lg" },
      { kind: "record", label: "", rest: "md" },
    ];
    const base = COLUMN_WIDTHS.date + MAIN_MIN + COLUMN_WIDTHS.org + COLUMN_WIDTHS.value;
    const md = base;
    const lg = md + COLUMN_WIDTHS.record;
    const xl = lg + COLUMN_WIDTHS.amend;
    const all = xl + COLUMN_WIDTHS.buyer;
    // No column rests in the widest range, so its width is the whole table's and the style leaves it out.
    expect(minWidths(cols)).toEqual({ all, xxl: all, xl, lg, md });
    expect(tableStyle(cols)).toBe(`--tmin:${all}px;--tmin-xl:${xl}px;--tmin-lg:${lg}px;--tmin-md:${md}px`);
    const wide: Column[] = [...cols, { kind: "tally", label: "", rest: "xxl" }];
    expect(minWidths(wide)).toEqual({ all: all + COLUMN_WIDTHS.tally, xxl: all, xl, lg, md });
    expect(tableStyle(wide)).toBe(`--tmin:${all + COLUMN_WIDTHS.tally}px;--tmin-xxl:${all}px;--tmin-xl:${xl}px;--tmin-lg:${lg}px;--tmin-md:${md}px`);
    expect(headClass({ kind: "tally", label: "", rest: "xxl", class: "num" })).toBe("k-tally xxh num");
    expect(headClass({ kind: "tally", label: "" })).toBe("k-tally");
    expect(headClass({ kind: "value", label: "" })).toBe("k-value num");
    expect(headClass({ kind: "buyer", label: "", rest: "md", class: "c-buyer" })).toBe("k-buyer mdh c-buyer");
  });

  it("puts every table on the site on the system, its least widths matching its head row", async () => {
    let tables = 0;
    for (const page of PAGES) {
      for (const path of [page, `${page}${page.includes("?") ? "&" : "?"}lang=fr`]) {
        const html = await text(path);
        for (const m of html.matchAll(/<table([^>]*)><thead><tr>([\s\S]*?)<\/tr><\/thead>/g)) {
          tables += 1;
          const attrs = m[1];
          const heads = [...m[2].matchAll(/<th class="([^"]+)"/g)].map((h) => h[1].split(" "));
          expect(attrs, path).toMatch(/class="(restack )?cols( [a-z-]+)?"/);
          expect(heads.length, path).toBe((m[2].match(/<th[ >]/g) ?? []).length);
          const kinds = heads.map((cls) => {
            const k = cls.filter((c) => c.startsWith("k-"));
            expect(k, `${path} ${cls.join(" ")}`).toHaveLength(1);
            const rest = cls.includes("mdh") ? "md" : cls.includes("lgh") ? "lg" : cls.includes("xlh") ? "xl" : cls.includes("xxh") ? "xxl" : undefined;
            return { kind: k[0].slice(2), rest } as Column;
          });
          // One main column per table, which takes the width the others leave.
          expect(kinds.filter((c) => c.kind === "main"), path).toHaveLength(1);
          expect(attrs, path).toContain(`style="${tableStyle(kinds)}"`);
        }
      }
    }
    expect(tables).toBeGreaterThan(40);
  });

  it("hands the tender list's head row and widths to the client script", async () => {
    const html = await text("/tenders");
    const data = JSON.parse(html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
    expect(data.table.cls).toBe("restack cols t-tenders");
    expect(data.table.heads.map((h: string[]) => h[0])).toEqual([
      "k-main c-notice", "k-buyer c-buyer", "k-datetime c-date", "k-date mdh c-pub", "k-region mdh c-region",
    ]);
    expect(data.table.heads.map((h: string[]) => h[1])).toEqual(["Notice", "Buyer", "Closing", "Published", "Provinces of delivery"]);
    // The script draws a row as the server does: the provinces under the buyer while their column rests.
    expect(tendersJs).toContain('buyer.appendChild(el("span", "split-only md-only muted small", provincesText(r.provinces, r.provinces_derived)));');
    expect(tendersJs).toContain('cell(tr, "col.region", "c-region mdh")');
    // The watchlist's script puts each row's Remove button under its name, as the head row has no column for it.
    expect(watchlistJs).toContain("removeButton(who, tr, id, name);");
    expect(watchlistJs).not.toContain("watch.col_manage");
    expect(data.table.style).toMatch(/^--tmin:\d+px;--tmin-xl:\d+px;--tmin-lg:\d+px;--tmin-md:\d+px$/);
  });

  it("gives the home lists a Type column in place of Published, resting with the provinces below 1280 px", async () => {
    const cols = homeTenderColumns("en");
    expect(cols.map(headClass)).toEqual(["k-main c-notice", "k-label mdh c-type", "k-buyer c-buyer", "k-datetime c-date", "k-region mdh c-region"]);
    expect(cols.map((c) => c.label)).toEqual(["Notice", "Type", "Buyer", "Closing", "Provinces of delivery"]);
    // From 700 to 1279 px the content column is 635 px at the least: the three columns left fit it.
    expect(minWidths(cols)).toEqual({ all: 820, xxl: 820, xl: 820, lg: 820, md: 512 });
    expect(minWidths(cols).md).toBeLessThanOrEqual(mainWidth(700) - 2 * SHEET.panelBorder);
    const html = await text("/");
    expect(html).toContain(`<table class="restack cols t-tenders" style="${tableStyle(cols)}" data-sorting="client"><thead><tr>` +
      '<th class="k-main c-notice"><button type="button" class="th-sort">Notice</button></th><th class="k-label mdh c-type"><button type="button" class="th-sort">Type</button></th>');
    // The tender list keeps its own columns; its provinces rest below 1280 px too, and show under the buyer.
    expect(tenderColumns("en").map(headClass)).toEqual(["k-main c-notice", "k-buyer c-buyer", "k-datetime c-date", "k-date mdh c-pub", "k-region mdh c-region"]);
  });
});

describe("a table's least width", () => {
  it("works the content column out from the stylesheet: window, scrollbar, rail, padding and border", () => {
    // The rail is the stylesheet's own figure, and the window it appears at.
    expect(SHEET.rail).toBe(264);
    expect(SHEET.railFrom).toBe(1000);
    const panel = (w: number) => mainWidth(w) - 2 * SHEET.panelBorder;
    expect([700, 1000, 1280, 1440, 1600, 1920].map(panel)).toEqual([635, 671, 951, 1111, 1271, 1591]);
    // Each range's low edge, the rail's window, and the windows inside a range where a panel grid
    // splits into tracks, three panels share a row, a document's contents move beside it, or the
    // home map's list moves beside the map.
    expect(edges()).toEqual([700, 1000, 1200, 1280, 1351, 1400, 1440, 1600, 1840, 1920]);
    expect([699, 700, 1279, 1280, 1439, 1440, 1599, 1600, 1919, 1920].map(rangeOf)).toEqual(
      ["md", "md", "md", "lg", "lg", "xl", "xl", "xxl", "xxl", "all"]);
  });

  it("is never wider than the column the table gets, for every table the pages draw, at every edge from 700 px", async () => {
    let tables = 0;
    for (const page of PAGES) {
      for (const path of [page, `${page}${page.includes("?") ? "&" : "?"}lang=fr`]) {
        const html = await text(path);
        tables += tablesIn(html).length;
        expect(misfits(html), path).toEqual([]);
      }
    }
    expect(tables).toBeGreaterThan(80);
  });

  it("narrows with the column a table sits in: a panel grid's track, a document's measure", async () => {
    // A buyer's ranked lists, two to a track from 1351 px: 500 px tracks less the panel's border.
    const [first] = tablesIn(await text("/buyers/pwgsc-tpsgc")).filter((tb) => tb.parent?.parent?.parent?.cls.includes("panel-grid"));
    expect(first?.parent?.parent?.parent?.children.length).toBeGreaterThanOrEqual(2);
    expect(tableColumn(first, 1350)).toBe(mainWidth(1350) - 2);
    expect(tableColumn(first, 1351)).toBe(498);
    expect(leastWidths(first).lg).toBeLessThanOrEqual(498);
    // A document's tables run its 880 px measure, less its border.
    for (const tb of tablesIn(await text("/data"))) {
      expect(tableColumn(tb, 1920)).toBe(SHEET.measure - 2);
      expect(tableColumn(tb, 700)).toBe(635);
    }
  });
});

describe("a source's name over its figure", () => {
  it("heads its column on one line, in the tally kind, on every table that has one", async () => {
    // "Historique des contrats de SPAC", the longest, is 186 px of 12 px Inter
    // at weight 500 (measured in Chrome); the cell's padding is 8 px a side.
    expect(COLUMN_WIDTHS.tally).toBeGreaterThanOrEqual(186 + 16);
    for (const [path, heads] of [
      ["/buyers?lang=fr", ["Avis d’attribution", "Historique des contrats de SPAC", "Contrats publiés", "Subventions et contributions"]],
      ["/watchlist", ["Award notices", "PSPC contract history", "Published contracts", "Grants and contributions", "Lobbying communications"]],
      ["/segments", ["Award notices in 2026", "All award notices"]],
    ] as const) {
      const html = await text(path);
      // A tally column may rest on a medium screen ([a-z]+h) or on a phone (ph). Each of these
      // tables is whole on its page, so its head is the button that sorts it; the button's glyph
      // sits in the cell's padding, so the name still fits the line.
      for (const head of heads) {
        expect(html, `${path} ${head}`).toMatch(new RegExp(`<th class="k-tally( [a-z]+h)? num( ph)?"><button type="button" class="th-sort">${head}</button></th>`));
      }
    }
  });

  it("keeps the buyers list and the watchlist inside the window from 700 px, resting columns rather than scrolling", async () => {
    for (const path of ["/buyers", "/watchlist"]) {
      const html = await text(path);
      expect(html, path).toContain('<th class="k-tally');
      expect(misfits(html), path).toEqual([]);
    }
    // The watchlist's Remove button sits under the name: eight columns, none of them for it.
    expect((await text("/watchlist")).match(/<th class="k-/g)).toHaveLength(8);
  });
});
