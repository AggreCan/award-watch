// The column system (src/columns.tsx): one width per kind of column, the same
// numbers in the stylesheet as in the code that works out a table's least
// width, and every table on the site drawn on it.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { COLUMN_WIDTHS, MAIN_MIN, type Column, headClass, minWidths, tableStyle } from "../src/columns";
import { testEnv } from "./assets";

// The stylesheet's text, handed over by vitest.config.ts.
const styles = env.STYLES_CSS;

let address = 0;
const text = async (path: string) =>
  (await app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.1.${(address++ % 250) + 1}` } }, testEnv())).text();

// Every page that draws a table, in both languages.
const PAGES = [
  "/", "/tenders", "/tenders/new", "/tenders/cb-100-10000001", "/awards", "/awards/2026", "/awards/cb-400-40000004",
  "/expiring", "/expiring/3m", "/organizations", "/organizations/directory/on", "/organizations/org-a000000001",
  "/organizations/org-a000000002", "/buyers", "/buyers/pwgsc-tpsgc", "/segments", "/segments/82", "/rankings",
  "/data", "/feeds", "/support", "/watchlist",
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
    expect(minWidths(cols)).toEqual({ all, xl, lg, md });
    expect(tableStyle(cols)).toBe(`--tmin:${all}px;--tmin-xl:${xl}px;--tmin-lg:${lg}px;--tmin-md:${md}px`);
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
            return { kind: k[0].slice(2), rest: cls.includes("mdh") ? "md" : cls.includes("lgh") ? "lg" : cls.includes("xlh") ? "xl" : undefined } as Column;
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
});
