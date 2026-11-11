// The panel grids and two table details from the review of tables and grids
// (2026-11-11): a profile's addresses across the full width in columns, its
// registry, responses and corrections in one row of three; an odd last panel
// taking its row, and three ranked lists side by side on a wide screen; a
// segment's pair ending on one line; a record page's short panels stacked
// beside its procurement details; the
// rank column's own width; and a zero among counts written as a muted 0.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Profile } from "../src/data";
import { COLUMN_WIDTHS } from "../src/columns";
import { PLACES_IN_COLUMNS } from "../src/pages/organization";
import { homeRequest } from "./home";
import { makeFakeAssets, testEnv } from "./assets";
import profiles from "./fixtures/profiles-a00.json";

const styles = env.STYLES_CSS;
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);
let address = 0;
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const text = async (path: string, e = testEnv()) =>
  nbsp(await (await homeRequest(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.12.${(address++ % 250) + 1}` } }, e)).text());
const withFiles = (overrides: Record<string, unknown>) => testEnv(makeFakeAssets({}, overrides));

// One block of the stylesheet, from the start given (a media query and its first selector) to the brace that closes it.
const block = (head: string): string => {
  const at = styles.indexOf(head);
  expect(at, head).toBeGreaterThanOrEqual(0);
  return styles.slice(at, styles.indexOf("\n}\n", at) + 2);
};

const base = (profiles as Record<string, any>)["org-a000000001"] as Profile;
const place = (city: string, province: string, n: number) => ({ country: "CA", province, city, n });
const profileWith = (extra: Partial<Profile>) => withFiles({ "profiles/a00.json": { ...profiles, "org-a000000001": { ...base, ...extra } } });

describe("a profile's last panels", () => {
  it("give the addresses the whole width, in columns from three places, and the registry, responses and corrections one row of three", async () => {
    const three = [place("Ottawa", "ON", 90), place("Gatineau", "QC", 12), place("Laval", "QC", 3)];
    expect(three.length).toBe(PLACES_IN_COLUMNS);
    for (const lang of ["en", "fr"] as const) {
      const html = await text(`/organizations/org-a000000001?lang=${lang}`, profileWith({ places: three }));
      const [places, registry, responses, corrections] = lang === "en"
        ? ["Addresses on the Records", "Corporate Registry", "Responses from the Organization", "Corrections Log"]
        : ["Adresses aux dossiers", "Registre des sociétés", "Réponses de l’organisation", "Journal des corrections"];
      // The addresses are a panel of their own, ahead of the page's one grid, their list in columns.
      expect(html).toContain(`<section class="panel"><div class="panel-head"><h2>${places}</h2></div><ul class="kv kv-cols">`);
      // One grid on the page: the row of three, in this order.
      expect(html.match(/<div class="panel-grid/g)).toHaveLength(1);
      const row = html.slice(html.indexOf('<div class="panel-grid thirds">'));
      expect(row.startsWith(`<div class="panel-grid thirds"><section class="panel"><div class="panel-head"><h2>${registry}</h2>`)).toBe(true);
      const at = [`<h2>${registry}</h2>`, `<h2 id="responses">${responses}</h2>`, `<h2 id="corrections">${corrections}</h2>`].map((h) => row.indexOf(h));
      expect(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), at.join(",")).toBe(true);
      expect(html.indexOf(`<h2>${places}</h2>`)).toBeLessThan(html.indexOf('<div class="panel-grid thirds">'));
      // The registered date never breaks inside itself in a third of a row.
      expect(row).toContain(lang === "en" ? 'registered <span class="nw">2009-05-01</span>' : 'constituée le <span class="nw">2009-05-01</span>');
      expect(html).not.toContain(EM_DASH);
    }
  });

  it("keep a list of one or two places in one column", async () => {
    const two = await text("/organizations/org-a000000001");
    expect(two).toContain('<h2>Addresses on the Records</h2></div><ul class="kv"><li>');
    const one = await text("/organizations/org-a000000001", profileWith({ places: [place("Ottawa", "ON", 90)] }));
    expect(one).toContain('<h2>Addresses on the Records</h2></div><ul class="kv"><li>');
    expect(one).not.toContain("kv-cols");
  });

  it("put a corporate family between the addresses and the row of three", async () => {
    const family = { name: "Exemplar Group", members: [
      { id: "org-a000000001", display_name: "Exemplar Translation Services Inc.", note: "subsidiary", n_records: 12 },
      { id: "org-a000000002", display_name: "Exemplar Words Ltd.", note: "affiliate", n_records: 3 },
    ] };
    const html = await text("/organizations/org-a000000001", profileWith({ family } as Partial<Profile>));
    const at = ["<h2>Addresses on the Records</h2>", '<h2 id="family">Corporate Family</h2>', '<div class="panel-grid thirds">'].map((h) => html.indexOf(h));
    expect(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), at.join(",")).toBe(true);
  });

  it("are laid out by the stylesheet from 1200 px, three columns of addresses from 1600 px, and nothing below", () => {
    const wide = block("@media (min-width: 1200px) {\n  .panel-grid");
    expect(wide).toContain(".panel-grid.thirds { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: stretch; }");
    // The three end on one line, and so do their foot links.
    expect(wide).toContain(".panel-grid.thirds > .panel { display: flex; flex-direction: column; }");
    expect(wide).toContain(".panel-grid.thirds > .panel > .panel-foot { margin-top: auto; }");
    // In a third a registry's label goes over its value, so "Corporations" never breaks inside itself.
    expect(wide).toContain(".panel-grid.thirds dl { grid-template-columns: minmax(0, 1fr); }");
    expect(wide).toContain(".panel-grid.thirds dd { padding-top: 0; border-top: 0; }");
    const cols = block("@media (min-width: 1200px) {\n  ul.kv-cols");
    expect(cols).toContain("ul.kv-cols { columns: 2; column-gap: 0; column-rule: 1px solid var(--border); }");
    expect(cols).toContain(".kv-cols li { break-inside: avoid; }");
    expect(block("@media (min-width: 1600px) {\n  ul.kv-cols")).toContain("ul.kv-cols { columns: 3; }");
    // Below 1200 px every panel stacks: no rule for either outside those blocks.
    const outside = styles.replace(wide, "").replace(cols, "").replace(block("@media (min-width: 1600px) {\n  ul.kv-cols"), "");
    expect(outside).not.toMatch(/\.thirds|kv-cols \{|kv-cols li/);
  });
});

describe("a grid that ends on an odd panel", () => {
  it("lets the last panel take the row, and on a wide screen puts three panels side by side", () => {
    const wide = block("@media (min-width: 1200px) {\n  .panel-grid");
    expect(wide).toContain(".panel-grid:not(.thirds) > :last-child:nth-child(odd):not(:first-child) { grid-column: 1 / -1; }");
    const widest = block("@media (min-width: 1840px) {\n  .panel-grid");
    expect(widest).toContain(".panel-grid:has(> :nth-child(3):last-child) { grid-template-columns: repeat(3, minmax(0, 1fr)); }");
    // The override outweighs the spanning rule (one more pseudo-class) and comes after it.
    expect(widest).toContain(".panel-grid:has(> :nth-child(3):last-child) > :last-child:nth-child(odd):not(:first-child) { grid-column: auto; }");
    expect(styles.indexOf(widest)).toBeGreaterThan(styles.indexOf(wide));
  });

  it("holds a buyer page's ranked lists as panels of one grid, each with the narrow rank column", async () => {
    const html = await text("/buyers/pwgsc-tpsgc");
    const grid = html.slice(html.indexOf('<div class="panel-grid">'));
    expect(grid).toMatch(/^<div class="panel-grid"><section class="panel"><div class="panel-head"><h2 id="top-[a-z]+">/);
    expect(grid).toContain('<th class="k-rank num"><button type="button" class="th-sort">Rank</button></th>');
    expect(html).not.toContain('class="k-count num c-rank"');
  });
});

describe("a segment page's pair", () => {
  it("ends on one line: the ranked organizations and the years are as tall as each other", async () => {
    const html = await text("/segments/82");
    expect(html).toMatch(/<div class="panel-grid stretch"><section class="panel"><div class="panel-head"><h2>Organizations by Award Value<\/h2>/);
    expect(html).toContain("<h2>Award Notices by Year</h2>");
    expect(styles).toContain(".panel-grid.stretch { align-items: stretch; }");
  });
});

describe("a record page's grid", () => {
  it("stacks the parties, the value and the dates on the left of the procurement details, in that order", async () => {
    for (const path of ["/awards/cb-400-40000004", "/awards/cb-400-40000004?lang=fr"]) {
      const html = await text(path);
      const fr = path.endsWith("fr");
      const heads = fr
        ? ["Fournisseur et acheteur", "Valeur du contrat", "Dates clés", "Approvisionnement"]
        : ["Supplier and Buyer", "Contract Value", "Key Dates", "Procurement"];
      const grid = html.slice(html.indexOf('<div class="panel-grid">'));
      expect(grid.startsWith(`<div class="panel-grid"><div class="panel-stack"><section class="panel"><div class="panel-head"><h2>${heads[0]}</h2>`), path).toBe(true);
      const at = heads.map((h) => grid.indexOf(`<h2>${h}</h2>`));
      expect(at.every((x, i) => x >= 0 && (i === 0 || x > at[i - 1])), `${path} ${at.join(",")}`).toBe(true);
      // The stack closes before the procurement panel, which is the grid's second cell.
      expect(grid).toContain(`</section></div><section class="panel"><div class="panel-head"><h2>${heads[3]}</h2>`);
      expect(html.match(/<div class="panel-grid/g)).toHaveLength(1);
    }
    expect(styles).toContain(".panel-stack { display: grid; gap: var(--gutter); align-content: start; min-width: 0; }");
    expect(styles).toContain(".panel-grid > .panel, .panel-stack > .panel { margin: 0; }");
  });
});

describe("the rank column", () => {
  it("is a kind of its own, 56 px, a figure's, 48 px in a phone's compact table", () => {
    expect(COLUMN_WIDTHS.rank).toBe(56);
    expect(styles).toContain(".k-rank { width: 56px; }");
    expect(styles).toMatch(/@media \(max-width: 699px\) \{[\s\S]*\.compact \.k-rank \{ width: 48px; \}/);
    expect(styles).not.toContain("c-rank");
  });

  it("heads the rankings' tables", async () => {
    const html = await text("/rankings");
    const heads = html.match(/<th class="k-rank num">/g) ?? [];
    expect(heads.length).toBeGreaterThanOrEqual(2);
  });
});

describe("a zero among counts", () => {
  // The search results' zeros are held in test/search.test.ts, which has the search database.
  it("is a muted 0, with no dash, on the segments list", async () => {
    for (const path of ["/segments", "/segments?lang=fr"]) {
      const html = await text(path);
      expect(html, path).toContain('<span class="zero">0</span>');
      expect(html, path).not.toContain(`<span aria-hidden="true">${EN_DASH}</span>`);
    }
  });
});
