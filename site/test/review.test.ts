// The reviewer items of 2026-11-02 that needed no new backbone: the select
// menus' padding, the alerts form's field and button, the home tile notes,
// the segment chips, the radar's two filters and tags, the non-competitive
// share over positive values, the places a profile counts, the buyer pages'
// award order, the footer's sources, and HEAD requests for downloads.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ExpiringRow, Profile, YearFigure } from "../src/data";
import { t } from "../src/i18n";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { filterExpiring, fiscalYearEnd, readExpiringQuery, expiringQueryString, standingOffer } from "../src/pages/expiring";
import { addressCount, mergedPlaces, placeKey, valueShare } from "../src/pages/organization";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import expiringPage1 from "./fixtures/expiring-3m-1.json";
import profiles from "./fixtures/profiles-a00.json";
import stats from "./fixtures/stats.json";

const styles = env.STYLES_CSS;
let address = 0;
const get = (path: string, envOver = testEnv(), init: RequestInit = {}) =>
  app.request(path, { ...init, headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.9.${(address++ % 250) + 1}` } }, envOver);
const text = async (path: string, envOver = testEnv()) => (await get(path, envOver)).text();
const withFiles = (overrides: Record<string, unknown>) => testEnv(makeFakeAssets({}, overrides));
const nbsp = (s: string) => s.replace(/[  ]/g, " ");

describe("controls", () => {
  it("give a select the same room on both sides of its text, with the chevron in the right-hand padding", () => {
    // 8 px left; on the right 8 px, a 10 px chevron and an 8 px gap.
    const select = styles.match(/\nselect \{[^}]*\}/)?.[0] ?? "";
    expect(select).toContain("appearance: none;");
    expect(select).toContain("padding-right: 26px;");
    expect(select).toContain("background-position: calc(100% - 13px) 50%, calc(100% - 8px) 50%;");
    expect(select).toContain("var(--ink-2)");
    // Fields and selects keep the field border token and one height.
    expect(styles).toMatch(/select, textarea \{\n  max-width: 100%; min-height: var\(--field-h\); padding: 5px 8px;\n  border: 1px solid var\(--field-border\);/);
    expect(styles).toContain("--field-h: 32px;");
  });

  it("set the alerts form's field and button to one height and one border token, side by side, stacked on a phone", async () => {
    expect(styles).toContain('.interest-form input[type="email"], .interest-form .btn { height: var(--field-h); min-height: 0; border: 1px solid var(--field-border); }');
    // The button is pinned to the input's top (the label line plus its 4 px), not to the column's
    // bottom: a password manager's zero-height element after the input would otherwise push it down.
    expect(styles).toContain('.interest-form .interest-field { flex: 0 1 320px; gap: 0; }');
    expect(styles).toContain('.interest-form .interest-field > .field-label { margin-bottom: 4px; }');
    expect(styles).toContain('.interest-form .btn { flex: none; align-self: flex-start; margin-top: 20px; justify-content: center; white-space: nowrap; }');
    expect(styles).toMatch(/@media \(max-width: 699px\) \{[\s\S]*\.interest-form \.btn \{ margin-top: 0; \}/);
    expect(styles).toMatch(/@media \(max-width: 699px\) \{[\s\S]*\.interest-form \.interest-field, \.interest-form \.btn \{ flex: 1 1 100%; width: 100%; \}/);
    // The Email lists page's chooser ends on the same line, under the same rules.
    expect(styles).toContain(".interest-body > .interest-form, .lists-form > .interest-form { display: flex;");
    const fr = nbsp(await text("/alerts?lang=fr"));
    expect(fr).toMatch(/<form method="post" action="\/interest" class="lists-form"[^>]*>[\s\S]*<div class="interest-form"><label class="field interest-field">/);
    expect(fr).toContain('<button type="submit" class="btn btn-primary">Inscrivez-moi</button>');
  });

  it("give a select that takes several values the same room on both sides and no chevron", () => {
    const list = styles.match(/\nselect\[multiple\] \{[^}]*\}/)?.[0] ?? "";
    expect(list).toContain("padding: 4px 8px;");
    expect(list).toContain("background-image: none;");
    expect(list).toContain("height: auto;");
  });
});

describe("the home tiles", () => {
  it("carry what the rail beside them does not, each note short enough for one line at 1440 px, in both languages", async () => {
    const notes = (html: string) => [...html.matchAll(/<span class="tile-note">([^<]*)<\/span>/g)].map((m) => nbsp(m[1]));
    // How many of the notices closing soon close today, and the value of the year's award notices and of the contracts ending.
    expect(notes(await text("/"))).toEqual(["None closes today", "Published on CanadaBuys this year", "Worth $4.9M"]);
    expect(notes(await text("/?lang=fr"))).toEqual(["Aucun ne ferme aujourd’hui", "Publiés sur AchatsCanada cette année", "Valeur : 4,9 M$"]);
    const withTotal = await text("/", testEnv(makeFakeAssets({}, { "stats.json": { ...stats, totals: { awards_year: 518_923_210 } } })));
    expect(notes(withTotal)[1]).toBe("Worth $519M");
    // About 230 px of 12 px type: 42 characters in English at the most, as measured in Chrome.
    for (const key of ["home.tile_closing_none", "home.tile_closing_many", "home.tile_awards_year_note", "home.tile_value", "home.tile_expiring_note"] as const) {
      expect(t("en", key).length, key).toBeLessThanOrEqual(42);
      expect(t("fr", key).length, key).toBeLessThanOrEqual(42);
    }
    // The side figures' labels share the tile's width with the figure and its note: 20 characters at the most.
    const sides = (html: string) => [...html.matchAll(/<span class="tile-side-label">([^<]*)<\/span>/g)].map((m) => nbsp(m[1]));
    const en = sides(await text("/"));
    const fr = sides(await text("/?lang=fr"));
    expect(en).toEqual(["Tomorrow", "In 2 days", "Days 3 to 7", "Last 30 days", "Worth", "Suppliers", "Within 6 months", "Within 12 months", "No value stated"]);
    expect(fr).toEqual(["Demain", "Dans 2 jours", "Jours 3 à 7", "30 derniers jours", "Valeur", "Fournisseurs", "D’ici 6 mois", "D’ici 12 mois", "Sans valeur indiquée"]);
    for (const label of [...en, ...fr]) {
      expect(label.length, label).toBeLessThanOrEqual(20);
      expect(label, label).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe("the radar's fiscal-year ends and standing offers", () => {
  const rows = expiringPage1 as unknown as ExpiringRow[];
  const q = (s: string) => readExpiringQuery(new URL(`https://x/expiring/3m${s}`));

  it("tells a March 31 end and a standing offer or supply arrangement apart", () => {
    expect(fiscalYearEnd({ end: "2027-03-31" })).toBe(true);
    expect(fiscalYearEnd({ end: "2027-03-30" })).toBe(false);
    expect(standingOffer({ instrument_en: "Standing Offer" })).toBe(true);
    expect(standingOffer({ instrument_en: "Supply Arrangement" })).toBe(true);
    expect(standingOffer({ instrument_en: "Standing offer or supply arrangement" })).toBe(true);
    expect(standingOffer({ instrument_en: "Contract against SA" })).toBe(false);
    expect(standingOffer({ instrument_en: null })).toBe(false);
  });

  it("keeps both in by default and leaves either out on request, with the box as the form sends it", () => {
    const march = rows.map((r, i) => (i === 0 ? { ...r, end: "2027-03-31" } : r));
    expect(filterExpiring(march, q(""))).toHaveLength(3);
    expect(filterExpiring(march, q("?fye=0")).map((r) => r.reference)).toEqual(["dnd-mdn:C-2026-0042", "cb-400-40000004"]);
    expect(filterExpiring(march, q("?sosa=0")).map((r) => r.reference)).toEqual(["W8472-000777", "dnd-mdn:C-2026-0042"]);
    expect(filterExpiring(march, q("?fye=0&fye=1&sosa=0&sosa=1"))).toHaveLength(3);
    expect(expiringQueryString(q("?sosa=0&fye=1"))).toBe("?sosa=0");
  });

  it("offers the two boxes with their counts, tags such rows, and says when one is left out", async () => {
    const html = nbsp(await text("/expiring/3m"));
    expect(html).toContain('<input type="checkbox" name="fye" value="1" checked=""/>');
    expect(html).toContain("<span>Fiscal-year-end dates (0)</span>");
    expect(html).toContain("<span>Standing offers and supply arrangements (1)</span>");
    expect(html).toContain('<span class="tag">Standing Offer</span>');
    const out = nbsp(await text("/expiring/3m?sosa=0&lang=fr"));
    expect(out).toContain("<span>Offres à commandes et arrangements</span> <b>exclues</b>");
    expect(out).not.toContain("cb-400-40000004");
  });
});

describe("the non-competitive share by value", () => {
  const year = (extra: Partial<YearFigure>): YearFigure => ({
    year: 2018, source: "contracts", n: 40, total: -20_474_204 + 215_748_311, n_non_competitive: 5,
    total_non_competitive: -20_474_204, ...extra,
  });

  it("is taken over positive values when the export gives them, with a mark when a record is below zero", () => {
    const y = year({ total_positive: 215_748_311, total_non_competitive_positive: 1_000_000, n_negative: 3 });
    expect(valueShare("en", y)).toBe("$1,000,000 (<1%) *");
    expect(valueShare("en", { ...y, n_negative: 0 })).toBe("$1,000,000 (<1%)");
    // In French the "<" never ends a line apart from its figure.
    expect(valueShare("fr", { ...y, n_negative: 0 })).toContain("(<\u00a01\u00a0%)");
  });

  it("never reads below zero on an older export: the part stands without a percentage", () => {
    expect(valueShare("en", year({}))).toBe("-$20,474,204");
    expect(valueShare("en", year({ source: "grants" }))).toBe("Not applicable");
  });

  it("explains the mark under the table when a year carries one", async () => {
    const base = (profiles as Record<string, any>)["org-a000000001"];
    const marked = {
      ...profiles,
      "org-a000000001": { ...base, years: base.years.map((y: YearFigure) => ({ ...y, total_positive: 1_200_000, total_non_competitive_positive: 54_000, n_negative: y.source === "contracts" ? 1 : 0 })) },
    };
    const html = await text("/organizations/org-a000000001", withFiles({ "profiles/a00.json": marked }));
    expect(html).toContain("The non-competitive share by value counts positive values only");
    expect(await text("/organizations/org-a000000001")).not.toContain("counts positive values only");
  });
});

describe("the addresses on a profile", () => {
  const place = (city: string, province = "QC", n = 1) => ({ country: "CA", province, city, n });

  it("match when they differ only in case, accents, punctuation, a postal code or a province after the city", () => {
    expect(placeKey(place("Pointe-Claire"))).toBe(placeKey(place("pointe claire")));
    expect(placeKey(place("Québec"))).toBe(placeKey(place("Quebec")));
    expect(placeKey(place("Markham Ontario", "ON"))).toBe(placeKey(place("Markham, Ontario", "ON")));
    expect(placeKey(place("Markham ON", "ON"))).toBe(placeKey(place("Markham", "ON")));
    expect(placeKey(place("Toronto2C4", "ON"))).toBe(placeKey(place("Toronto", "ON")));
    expect(placeKey(place("Montréal"))).not.toBe(placeKey(place("Laval")));
  });

  it("are listed and counted once each, and the note says the page may be shared", async () => {
    const merged = mergedPlaces([place("Pointe-Claire", "QC", 73), place("Pointe Claire", "QC", 10), place("Laval", "QC", 2)]);
    expect(merged.map((p) => [p.city, p.n])).toEqual([["Pointe-Claire", 83], ["Laval", 2]]);
    // A place with no city adds nothing; places past the ten listed count as they are.
    expect(addressCount([place("Pointe-Claire"), place("Pointe Claire"), { country: "CA", province: "", city: "", n: 4 }])).toBe(1);
    expect(addressCount([place("Pointe-Claire"), place("Laval")], 14)).toBe(14);
    const base = (profiles as Record<string, any>)["org-a000000001"] as Profile;
    const variants = { ...profiles, "org-a000000001": { ...base, places: [place("Ottawa", "ON", 90), place("OTTAWA, Ontario", "ON", 3)] } };
    const one = await text("/organizations/org-a000000001", withFiles({ "profiles/a00.json": variants }));
    expect(one).not.toContain("Records under this name at");
    const two = await text("/organizations/org-a000000001");
    expect(two).toContain("Records under this name at 2 addresses. Two organizations with the same legal name may share this page");
  });
});

describe("smaller review items", () => {
  it("lists a buyer's newest award notices in the order of their award dates", async () => {
    const buyer = FILES["buyers/pwgsc-tpsgc.json"] as Record<string, any>;
    const award = buyer.recent_awards[0];
    const older = { ...award, reference: "cb-400-40000099", awarded: "2025-01-10" };
    const newer = { ...award, reference: "cb-400-40000098", awarded: "2026-10-20" };
    const page = await text("/buyers/pwgsc-tpsgc", withFiles({ "buyers/pwgsc-tpsgc.json": { ...buyer, recent_awards: [older, award, newer] } }));
    const html = page.slice(page.indexOf("<h2>Newest Award Notices</h2>"));
    const at = (ref: string) => html.indexOf(`/awards/${ref}"`);
    expect(at("cb-400-40000098")).toBeGreaterThan(0);
    expect(at("cb-400-40000098")).toBeLessThan(at(award.reference.toLowerCase()));
    expect(at(award.reference.toLowerCase())).toBeLessThan(at("cb-400-40000099"));
  });

  it("names in the footer only the sources that have been read", async () => {
    const footer = (html: string) => html.match(/<span class="footer-sources">([\s\S]*?)<a /)?.[1] ?? "";
    expect(footer(await text("/"))).toContain("Records from CanadaBuys and open.canada.ca.");
    const read = { ...stats, sources: [...stats.sources, { source: "lobbying", file: "communications_ocl_cal.zip", last_read: "2026-10-31T01:00:00Z", last_modified: null, loaded: true }] };
    expect(footer(await text("/", withFiles({ "stats.json": read })))).toContain("Records from CanadaBuys, open.canada.ca and the Registry of Lobbyists.");
    expect(nbsp(footer(await text("/?lang=fr")))).toContain("Dossiers d’AchatsCanada et d’ouvert.canada.ca.");
  });

  it("counts a HEAD request for a download with the pages, not against the download cap", () => {
    expect(bucketFor("GET", "/downloads/awards-2026.csv")).toBe("download");
    expect(bucketFor("HEAD", "/downloads/awards-2026.csv")).toBe("page");
    expect(bucketFor("HEAD", "/api/stats")).toBe("api");
  });
});
