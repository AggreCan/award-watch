// The column system (src/columns.tsx): one width per kind of column, the same
// numbers in the stylesheet as in the code that works out a table's least
// width, and every table on the site drawn on it.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { COLUMN_WIDTHS, MAIN_MIN, type Column, headClass, minWidths, tableStyle } from "../src/columns";
import { homeTenderColumns, tenderColumns } from "../src/pages/shared";
import { testEnv } from "./assets";

// The stylesheet's text, handed over by vitest.config.ts.
const styles = env.STYLES_CSS;

let address = 0;
const text = async (path: string) =>
  (await app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.1.${(address++ % 250) + 1}` } }, testEnv())).text();

// Every page that draws a table, in both languages.
const PAGES = [
  "/", "/tenders", "/tenders/new", "/tenders/cb-100-10000001", "/awards", "/awards/2026", "/awards/erroneous", "/awards/cb-400-40000004",
  "/expiring", "/expiring/3m", "/organizations", "/organizations/directory/on", "/organizations/org-a000000001",
  "/organizations/org-a000000002", "/buyers", "/buyers/pwgsc-tpsgc", "/segments", "/segments/82", "/rankings",
  "/data", "/feeds", "/watchlist",
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
      "k-main c-notice", "k-buyer c-buyer", "k-datetime c-date", "k-date mdh c-pub", "k-region c-region",
    ]);
    expect(data.table.heads.map((h: string[]) => h[1])).toEqual(["Notice", "Buyer", "Closing", "Published", "Provinces of delivery"]);
    expect(data.table.style).toMatch(/^--tmin:\d+px;--tmin-xl:\d+px;--tmin-lg:\d+px;--tmin-md:\d+px$/);
  });

  it("gives the home lists a Type column in place of Published, resting with the provinces below 1280 px", async () => {
    const cols = homeTenderColumns("en");
    expect(cols.map(headClass)).toEqual(["k-main c-notice", "k-label mdh c-type", "k-buyer c-buyer", "k-datetime c-date", "k-region mdh c-region"]);
    expect(cols.map((c) => c.label)).toEqual(["Notice", "Type", "Buyer", "Closing", "Provinces of delivery"]);
    // From 1000 to 1279 px the content column is 671 px at the least: the three columns left fit it.
    expect(minWidths(cols)).toEqual({ all: 836, xxl: 836, xl: 836, lg: 836, md: 528 });
    expect(minWidths(cols).md).toBeLessThanOrEqual(1000 - 15 - 264 - 48 - 2);
    const html = await text("/");
    expect(html).toContain(`<table class="restack cols t-tenders" style="${tableStyle(cols)}" data-sorting="client"><thead><tr>` +
      '<th class="k-main c-notice"><button type="button" class="th-sort">Notice</button></th><th class="k-label mdh c-type"><button type="button" class="th-sort">Type</button></th>');
    // The tender list keeps its own columns.
    expect(tenderColumns("en").map(headClass)).toEqual(["k-main c-notice", "k-buyer c-buyer", "k-datetime c-date", "k-date mdh c-pub", "k-region c-region"]);
  });
});

// The content column at the narrowest window of each range: the window less
// a 15 px scrollbar, the 240 px rail, the two 24 px gutters and the panel's
// two borders. A table fits its range when its least width there is no wider.
const CONTENT = { lg: 1280 - 15 - 240 - 48 - 2, xl: 1440 - 15 - 240 - 48 - 2, xxl: 1600 - 15 - 240 - 48 - 2, all: 1920 - 15 - 240 - 48 - 2 };
const styleOf = (html: string, marker: string) => {
  const at = html.indexOf(marker);
  const m = html.slice(at).match(/<table class="[^"]*" style="([^"]+)"/);
  const v = (name: string) => Number(m?.[1].match(new RegExp(`--tmin${name}:([0-9]+)px`))?.[1]);
  return { all: v(""), xxl: v("-xxl") || v(""), xl: v("-xl"), lg: v("-lg") };
};

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

  it("keeps the buyers list and the watchlist inside the window at 1280, 1440, 1600 and 1920 px, resting columns rather than scrolling", async () => {
    for (const [path, marker] of [["/buyers", 'id="main"'], ["/watchlist", 'id="watchlist"']] as const) {
      const w = styleOf(await text(path), marker);
      expect(w.lg, path).toBeLessThanOrEqual(CONTENT.lg);
      expect(w.xl, path).toBeLessThanOrEqual(CONTENT.xl);
      expect(w.xxl, path).toBeLessThanOrEqual(CONTENT.xxl);
      expect(w.all, path).toBeLessThanOrEqual(CONTENT.all);
    }
  });
});
