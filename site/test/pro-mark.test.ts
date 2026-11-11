// The Pro mark (src/pro.tsx) and where it goes. The chip marks a boundary
// the reader is at: the rail's entries that lead to a page that comes with
// Pro, the radar's deep-window tabs and tiles, the links to the 12-month
// list, gate notes, tease panels, a Free account's overview rows, and the
// Same day button of the home page's Canada map. Never
// on anything free, never in a table's records, never twice in one panel
// head or one link, never in a hover-only surface, never interactive on its
// own, and nowhere at all while the accounts switch is off.
//
// The drift guards come first: the stylesheet's rules for the chip hold to
// the theme's tokens, the markup is the component's, the free pages carry
// no chip outside the rail and the window tabs, and every rail entry that
// leads to a Pro page carries exactly one. Then each placement, for a
// reader without a session, a Free session and a Pro session where they
// differ, in both languages, and the strings each one adds.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wrangler from "../wrangler.jsonc?raw";
import { allKeys, rawEntry, SAME_IN_BOTH, t, type Key } from "../src/i18n";
import { app } from "../src/index";
import { STYLES_VERSION } from "../src/layout";
import { RULES } from "../src/account/entitlements";
import { COMPETITORS_MAX } from "../src/account/org_claim";
import { KEY_PER_DAY } from "../src/api_keyed_spec";
import { EXPIRING_WINDOWS } from "../src/data";
import { PLAN_CARD_ROWS, PLAN_LINE_MAX, PLAN_ROWS, PRO_GLYPH_PATH, PRO_INCLUDES, planLine, proPrice } from "../src/pro";
import { FREE_YEARS, MAX_YEARS } from "../src/records_db";
import { SAME_DAY_RUNS_UTC } from "../src/refresh";
import { routeTemplate } from "../src/views";
import { csrf, decode, get, grantPro, nbsp, newEmail, nextIp, onEnv, post, signIn, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import STATS_MAP from "./fixtures/stats-map.json";
import { applySql } from "./setup";
import { forgetSameDayCounts } from "../src/pages/intraday";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const INTRADAY_SCHEMA = (env as unknown as { INTRADAY_SCHEMA_SQL: string }).INTRADAY_SCHEMA_SQL;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// The fixtures with the 6- and 12-month windows written, each the 3-month
// rows, so the deep windows' pages render; on() is the switch on with them.
const DEEP_FILES: Record<string, unknown> = Object.fromEntries((["6m", "12m"] as const).flatMap((w) => [
  [`expiring/${w}/index.json`, { ...(FILES["expiring/3m/index.json"] as object), window: w }],
  [`expiring/${w}/1.json`, FILES["expiring/3m/1.json"]],
]));
const radar = (extra: Record<string, unknown> = {}) => makeFakeAssets({}, { ...DEEP_FILES, ...extra });
const on = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS: radar(), ...extra });
// The switch on with the payment service's two secrets set, so a checkout can
// be made and the plan cards name the price from wrangler.jsonc's figures.
const paid = (extra: Record<string, unknown> = {}) => on({ STRIPE_SECRET_KEY: "sk_test_fake0000", STRIPE_WEBHOOK_SECRET: "whsec_fake0000", ...extra });
// A tease panel, and its plan cards: Free, then Pro to the panel's end.
const teaseOf = (html: string) => /<section class="panel pro-panel">[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
const cardsOf = (panel: string) => panel.split(/(?=<div class="plan-card[ "])/).slice(1);

// The chip as ProTag writes it, in either language.
const CHIP_EN = `<span class="pro-tag"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="${PRO_GLYPH_PATH}"></path></svg>Pro<span class="visually-hidden"> (paid plan)</span></span>`;
const CHIP_FR = CHIP_EN.replace("(paid plan)", "(forfait payant)");
const chips = (html: string) => (html.match(/<span class="pro-tag">/g) ?? []).length;
const railOf = (html: string) => /<nav class="rail"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
const mainOf = (html: string) => /<main id="main">[\s\S]*?<\/main>/.exec(html)?.[0] ?? "";
const tabsOf = (html: string) => /<nav aria-label="(?:Windows|Périodes)" class="tabs toolbar-row">[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
const html = async (path: string, o: { env?: object; cookie?: string } = {}) => nbsp(await (await get(path, o)).text());

// The figures in wrangler.jsonc, which the price line must name and never write itself.
const PRICE = /"PRICE_MONTHLY_CAD":\s*"([0-9.]+)"[\s\S]*?"PRICE_YEARLY_CAD":\s*"([0-9.]+)"/.exec(wrangler) ?? ["", "", ""];

let freeCookie = "";
let proCookie = "";
async function sessions(): Promise<void> {
  if (proCookie) return;
  freeCookie = await signIn(newEmail("mark-free"));
  const pro = newEmail("mark-pro");
  proCookie = await signIn(pro);
  await grantPro(pro);
}
const READERS = () => [["no session", undefined], ["free", freeCookie], ["pro", proCookie]] as const;

// -- the stylesheet ------------------------------------------------------------------

// The declarations of every rule whose selector names one of the classes.
function rulesFor(...classes: string[]): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const css = STYLES.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (classes.some((c) => new RegExp(`\\.${c}\\b`).test(selector))) out.push({ selector, body: m[2] });
  }
  return out;
}
const decl = (body: string, prop: string) => new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1].trim();

describe("the chip's stylesheet", () => {
  it("draws the chip in the accent on the panel ground, with the subscript's type, and nothing but tokens", () => {
    const [chip] = rulesFor("pro-tag").filter((r) => r.selector === ".pro-tag");
    expect(chip).toBeDefined();
    expect(decl(chip.body, "color")).toBe("var(--accent)");
    expect(decl(chip.body, "background")).toBe("var(--panel)");
    // 2 px, as a control's edge is, so the curve of its corners holds; the padding gives up the pixel.
    expect(decl(chip.body, "border")).toBe("2px solid var(--accent)");
    expect(decl(chip.body, "padding")).toBe("0 5px");
    expect(decl(chip.body, "height")).toBe("20px");
    expect(decl(chip.body, "font-size")).toBe("11px");
    expect(decl(chip.body, "font-weight")).toBe("600");
    expect(decl(chip.body, "letter-spacing")).toBe("0.04em");
    expect(decl(chip.body, "gap")).toBe("4px");
    expect(decl(chip.body, "white-space")).toBe("nowrap");
    // The same type as the plan subscript after the wordmark, so the two read as one family.
    const [plan] = rulesFor("brand-plan").filter((r) => r.selector === ".brand-plan");
    for (const prop of ["font-size", "font-weight", "letter-spacing"]) expect(decl(chip.body, prop), prop).toBe(decl(plan.body, prop));
    // The glyph is the SVG in currentColor, so it follows the chip's colour in both themes.
    const [glyph] = rulesFor("pro-tag").filter((r) => r.selector === ".pro-tag svg");
    expect(decl(glyph.body, "fill")).toBe("currentColor");
    // 12 px in the chip's 16 px of room: 2 px above and below, so it centres on whole pixels.
    expect(decl(glyph.body, "width")).toBe("12px");
    expect(decl(glyph.body, "height")).toBe("12px");
  });

  it("names no colour of its own in any Pro rule, and gives the chip no hover, focus or pseudo-element", () => {
    const rules = rulesFor("pro-tag", "pro-note", "pro-panel");
    expect(rules.length).toBeGreaterThanOrEqual(5);
    for (const { selector, body } of rules) {
      expect(body, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      for (const v of body.match(/var\(--[a-z0-9-]+\)/g) ?? []) {
        expect(["var(--accent)", "var(--panel)", "var(--muted)"], `${selector}: ${v}`).toContain(v);
      }
      expect(selector, "no state of its own").not.toMatch(/pro-tag[^,]*:(hover|focus|active)/);
      expect(selector, "the glyph is markup, not a pseudo-element").not.toMatch(/pro-tag::?(before|after)/);
    }
    // The tease panel's edge is the accent, as on the account notice.
    const [panel] = rulesFor("pro-panel");
    expect(decl(panel.body, "border-left")).toBe("2px solid var(--accent)");
    // The dashed rail item is retired with the ": Pro" suffix.
    expect(STYLES).not.toContain("rail-later");
    expect(allKeys()).not.toContain("rail.lists_pro" as Key);
    expect(STYLES_VERSION).toBeGreaterThanOrEqual(14);
  });

  it("stands 6 px from whatever is beside it by its own margins, every exception in the Pro mark's block and none in a page's rule", () => {
    const [chip] = rulesFor("pro-tag").filter((r) => r.selector === ".pro-tag");
    expect(decl(chip.body, "margin")).toBe("0 6px");
    // Every rule in the stylesheet that sets a margin on the chip, and the margins it sets: the chip's
    // 6 px, or none on the side something else already spaces (the end of a link, the start of a
    // gate note, a box with a gap of its own, the rail's count slot).
    const margins = rulesFor("pro-tag")
      .map((r) => [r.selector, r.body.split(";").map((d) => d.trim()).filter((d) => /^margin(?:-[a-z]+)?\s*:/.test(d)).join("; ")])
      .filter(([, m]) => m);
    expect(margins).toEqual([
      [".pro-tag", "margin: 0 6px"],
      ["a > .pro-tag:last-child", "margin-right: 0"],
      [".pro-note .pro-tag", "margin-left: 0"],
      [".btn > .pro-tag, a.tile .tile-label > .pro-tag, .plan-card-head > .pro-tag, .panel-tools > .pro-tag, a.refresh > .pro-tag", "margin: 0"],
      [".rail-item > .pro-tag", "margin: 0 0 0 auto"],
      [".eyebrow > .pro-tag", "margin: 0"],
    ]);
    const block = /\/\* -- the Pro mark[\s\S]*?(?=\/\* -- )/.exec(STYLES)?.[0] ?? "";
    for (const [selector] of margins) expect(block, selector).toContain(`\n${selector} {`);
    // An eyebrow that carries the chip spaces it with the same 6 px, as a gap.
    const [eyebrow] = rulesFor("pro-tag").filter((r) => r.selector === ".eyebrow:has(> .pro-tag)");
    expect(decl(eyebrow.body, "gap")).toBe("6px");
  });

  it("swaps with the theme through the tokens alone, both of which every theme defines", () => {
    for (const block of [/:root \{[\s\S]*?\n\}/, /:root\[data-theme="dark"\] \{[\s\S]*?\n\}/]) {
      const body = block.exec(STYLES)?.[0] ?? "";
      expect(body).toMatch(/--accent: #[0-9a-f]{6};/);
      expect(body).toMatch(/--panel: #[0-9a-f]{6};/);
    }
  });
});

// -- the markup ------------------------------------------------------------------------

describe("the chip's markup", () => {
  it("is the word, a hidden long form in the page's language, and a glyph hidden from assistive technology", async () => {
    const en = await html("/expiring", { env: on() });
    expect(en).toContain(CHIP_EN);
    const fr = await html("/expiring?lang=fr", { env: on() });
    expect(fr).toContain(CHIP_FR);
    expect(fr).not.toContain("(paid plan)");
    // The operator's glyph: a filled brilliant-cut gem, one path.
    expect(PRO_GLYPH_PATH).toBe("M3 6.2 6 2h4l3 4.2L8 14.5z");
    // Never a hover-only surface: no chip carries a title, and no title names the plan.
    for (const page of [en, fr]) {
      expect(page).not.toMatch(/<span class="pro-tag"[^>]*title=/);
      expect(page).not.toMatch(/title="[^"]*\bPro\b[^"]*"/);
    }
  });

  it("appears on no page while the accounts switch is off", async () => {
    for (const path of ["/", "/tenders", "/tenders/new", "/expiring", "/expiring/6m", "/expiring/12m", "/data", "/alerts",
      "/organizations/org-a000000001", "/buyers/pwgsc-tpsgc", "/?lang=fr", "/data?lang=fr"]) {
      const page = await html(path, { env: testEnv(radar()) });
      expect(chips(page), path).toBe(0);
      expect(page, path).not.toContain("pro-note");
      expect(page, path).not.toContain("pro-panel");
    }
    const sameDay = await get("/tenders/same-day", { env: testEnv(radar()) });
    expect(sameDay.status).toBe(404);
    expect(await sameDay.text()).toContain("<h1>Page Not Found</h1>");
  });

  it("has no word space on either side on the pages that draw it, so its margins alone make the gap", async () => {
    await sessions();
    const profiles = clone(FILES["profiles/a00.json"]) as Record<string, any>;
    profiles["org-a000000001"].expiring.n = 30;
    const pages: [string, object, string | undefined][] = [
      ["/expiring", on(), undefined], ["/expiring/6m", paid(), freeCookie], ["/tenders", on(), undefined], ["/tenders/same-day", paid(), undefined],
      ["/data", on(), undefined], ["/alerts", on(), undefined], ["/buyers/pwgsc-tpsgc", on(), undefined],
      ["/organizations/org-a000000001", on({ ASSETS: radar({ "profiles/a00.json": profiles }) }), undefined],
      ["/account", on(), freeCookie], ["/account/keys", on(), freeCookie], ["/pro", paid(), freeCookie], ["/account/billing", paid(), freeCookie],
    ];
    for (const lang of ["en", "fr"]) {
      for (const [path, e, cookie] of pages) {
        const page = await (await get(`${path}?lang=${lang}`, { env: e, cookie })).text();
        expect(chips(page), `${path} ${lang}`).toBeGreaterThan(0);
        expect(page, `${path} ${lang}`).not.toMatch(/[\s  ]<span class="pro-tag">/);
        expect(page, `${path} ${lang}`).not.toMatch(/<span class="visually-hidden"> \((?:paid plan|forfait payant)\)<\/span><\/span>[\s  ]/);
      }
    }
  });
});

// -- where it must not go ---------------------------------------------------------------------

describe("free pages", () => {
  it("carry no chip outside the rail and the window tabs: the 3-month window, search, home and the document pages", async () => {
    await sessions();
    for (const [, cookie] of READERS()) {
      for (const path of ["/expiring/3m", "/expiring/3m?lang=fr", "/search", "/search?q=translation", "/", "/methodology", "/about",
        "/terms", "/privacy", "/cite", "/feeds", "/methodology?lang=fr"]) {
        const page = await html(path, { env: on(), cookie });
        const rest = mainOf(page).replace(tabsOf(page), "");
        expect(chips(rest), `${path} (${cookie ? "session" : "no session"})`).toBe(0);
        // Inside a document's panel, none at all.
        for (const doc of page.match(/<div class="doc">[\s\S]*?<\/div>\s*<\/div>/g) ?? []) expect(chips(doc), path).toBe(0);
      }
    }
    // On the 3-month page the tabs mark the deep windows only, never the free one.
    const tabs = tabsOf(await html("/expiring/3m", { env: on() }));
    expect(tabs).toContain('<a href="/expiring/3m" aria-current="page">Within 3 months</a>');
    expect(chips(tabs)).toBe(2);
  });

  it("leave the home page one chip, on its Canada map's Same day button, for every reader, and none while the switch is off", async () => {
    await sessions();
    await applySql(SEARCH, INTRADAY_SCHEMA);
    const files = { "stats.json": { ...(FILES["stats.json"] as object), map: STATS_MAP } };
    for (const [, cookie] of READERS()) {
      for (const path of ["/", "/?lang=fr"]) {
        forgetSameDayCounts();
        const rest = mainOf(await html(path, { env: on({ ASSETS: radar(files) }), cookie }));
        expect(chips(rest), path).toBe(1);
        const button = /<button type="button" class="btn" data-map-layer="same_day"[^>]*>[\s\S]*?<\/button>/.exec(rest)?.[0] ?? "";
        expect(chips(button), path).toBe(1);
      }
    }
    forgetSameDayCounts();
    const switchedOff = await html("/", { env: testEnv(radar(files)) });
    expect(chips(switchedOff)).toBe(0);
    expect(switchedOff).toContain('id="canada-map"');
  });

  it("never put the chip inside the teaser's records, and never twice in a link or a panel head", async () => {
    await sessions();
    for (const path of ["/expiring/6m", "/expiring/12m?lang=fr", "/expiring", "/data", "/tenders/same-day", "/account", "/account/searches",
      "/account/keys", "/account/bug"]) {
      const page = await html(path, { env: on(), cookie: freeCookie });
      for (const body of page.match(/<tbody>[\s\S]*?<\/tbody>/g) ?? []) {
        if (!body.includes("pro-note") && !body.includes("expiring-12m.csv")) expect(chips(body), path).toBe(0);
      }
      for (const a of page.match(/<a [^>]*>[\s\S]*?<\/a>/g) ?? []) expect(chips(a), `${path}: ${a.slice(0, 80)}`).toBeLessThanOrEqual(1);
      for (const head of page.match(/<div class="panel-head">[\s\S]*?<\/div>(?:<\/div>)?/g) ?? []) expect(chips(head), path).toBeLessThanOrEqual(1);
      expect(page, path).not.toContain(EM_DASH);
    }
  });
});

// -- the rail ---------------------------------------------------------------------------------

// The index of the analytics views (pages/analytics_index.tsx) is one: the views come with Pro.
const PRO_PAGES = ["/expiring/6m", "/expiring/12m", "/tenders/same-day", "/analytics"];

describe("the rail", () => {
  it("lists every Pro entry, clickable, with exactly one chip, for every reader and in both languages", async () => {
    await sessions();
    for (const [who, cookie] of READERS()) {
      for (const lang of ["en", "fr"] as const) {
        const rail = railOf(await html(`/tenders?lang=${lang}`, { env: on(), cookie }));
        const items = [...rail.matchAll(/<a class="rail-item[^"]*" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1], body: m[2] }));
        for (const href of PRO_PAGES) {
          const entry = items.filter((i) => i.href === href);
          expect(entry, `${who} ${lang} ${href}`).toHaveLength(1);
          expect(chips(entry[0].body), `${who} ${lang} ${href}`).toBe(1);
          expect(entry[0].body, href).toContain(lang === "fr" ? CHIP_FR : CHIP_EN);
        }
        // Email lists under Your lists carries one too; no other entry does.
        const lists = items.filter((i) => i.href === "/alerts");
        expect(lists.map((i) => chips(i.body)), `${who} ${lang}`).toEqual([0, 1]);
        const others = items.filter((i) => !PRO_PAGES.includes(i.href) && i.href !== "/alerts");
        for (const i of others) expect(chips(i.body), `${who} ${lang} ${i.href}`).toBe(0);
      }
    }
  });

  it("gives Contracts ending three children, short labels, the chip before each deep window's count, and no count on the parent", async () => {
    const rail = railOf(await html("/", { env: on() }));
    expect(rail).toContain('<a class="rail-item" href="/expiring"><span class="rail-label">Contracts ending</span></a>');
    expect(rail).toContain('<a class="rail-item rail-child" href="/expiring/3m"><span class="rail-label"><span class="rail-short">3 months</span><span class="rail-full">Ending within 3 months</span></span><span class="rail-n">3</span></a>');
    expect(rail).toContain(`<a class="rail-item rail-child" href="/expiring/6m"><span class="rail-label"><span class="rail-short">6 months</span><span class="rail-full">Ending within 6 months</span></span>${CHIP_EN}<span class="rail-n">5</span></a>`);
    expect(rail).toContain(`<a class="rail-item rail-child" href="/expiring/12m"><span class="rail-label"><span class="rail-short">12 months</span><span class="rail-full">Ending within 12 months</span></span>${CHIP_EN}<span class="rail-n">8</span></a>`);
    // The same-day entry after the closing-soon view, with no count: a count would read the database on every page.
    expect(rail).toContain(`<a class="rail-item rail-child" href="/tenders/same-day"><span class="rail-label"><span class="rail-short">Same-day</span><span class="rail-full">Same-day notices</span></span>${CHIP_EN}</a>`);
    expect(rail.indexOf('href="/tenders/same-day"')).toBeGreaterThan(rail.indexOf('href="/tenders?closing=7"'));
    expect(rail).toContain(`<a class="rail-item" href="/alerts"><span class="rail-label">Email lists</span>${CHIP_EN}</a>`);
    expect(rail).not.toContain("Email lists: Pro");
    const fr = railOf(await html("/?lang=fr", { env: on() }));
    expect(fr).toContain(`<span class="rail-short">6 mois</span><span class="rail-full">Fin d’ici 6 mois</span></span>${CHIP_FR}<span class="rail-n">5</span>`);
    expect(fr).toContain(`<span class="rail-short">Du jour</span><span class="rail-full">Avis du jour</span></span>${CHIP_FR}</a>`);
    expect(fr).toContain(`<span class="rail-label">Listes de diffusion</span>${CHIP_FR}</a>`);
  });

  it("marks the deep window's own item as the page, with the parent as its ancestor", async () => {
    const rail = railOf(await html("/expiring/12m", { env: on() }));
    expect(rail).toContain('<a class="rail-item rail-child" href="/expiring/12m" aria-current="page">');
    expect(rail).toContain('<a class="rail-item rail-ancestor" href="/expiring">');
    const same = railOf(await html("/tenders/same-day", { env: on() }));
    expect(same).toContain('<a class="rail-item rail-child" href="/tenders/same-day" aria-current="page">');
  });
});

// -- the radar ----------------------------------------------------------------------------------

describe("the radar's tabs and tiles", () => {
  it("mark the 6- and 12-month windows and never the 3-month one, for every reader, in both languages", async () => {
    await sessions();
    for (const [who, cookie] of READERS()) {
      const overview = await html("/expiring", { env: on(), cookie });
      expect(overview, who).toContain('<a class="tile" href="/expiring/3m"><span class="tile-label">Within 3 months</span>');
      expect(overview, who).toContain(`<a class="tile" href="/expiring/6m"><span class="tile-label">Within 6 months${CHIP_EN}</span>`);
      expect(overview, who).toContain(`<a class="tile" href="/expiring/12m"><span class="tile-label">Within 12 months${CHIP_EN}</span>`);
      for (const path of ["/expiring/3m", "/expiring/6m", "/expiring/12m"]) {
        const tabs = tabsOf(await html(path, { env: on(), cookie }));
        expect(tabs, `${who} ${path}`).toContain(`>Within 6 months${CHIP_EN}</a>`);
        expect(tabs, `${who} ${path}`).toContain(`>Within 12 months${CHIP_EN}</a>`);
        expect(tabs, `${who} ${path}`).toMatch(/>Within 3 months<\/a>/);
      }
    }
    const fr = await html("/expiring?lang=fr", { env: on() });
    expect(fr).toContain(`<span class="tile-label">D’ici 6 mois${CHIP_FR}</span>`);
  });

  it("name the price on the tease panel's Pro card from the variables while a checkout can be made, and say Pro is not on sale otherwise", async () => {
    const figure = (page: string) => /<span class="plan-figure">([\s\S]*?)<\/span><\/p>/.exec(cardsOf(teaseOf(page))[1] ?? "")?.[1] ?? null;
    const at = async (vars: Record<string, string>, lang = "en", e = paid) => figure(nbsp(await html(`/expiring/6m?lang=${lang}`, { env: e(vars) })));
    expect(await at({})).toBe(`<strong class="plan-amount">CA$${PRICE[1]}</strong> a month or CA$${PRICE[2]} a year`);
    expect(await at({ PRICE_MONTHLY_CAD: "12.00", PRICE_YEARLY_CAD: "120.50" })).toBe(
      '<strong class="plan-amount">CA$12.00</strong> a month or CA$120.50 a year');
    expect(await at({ PRICE_MONTHLY_CAD: "12.00", PRICE_YEARLY_CAD: "120.50" }, "fr")).toBe(
      '<strong class="plan-amount">12,00 $ CA</strong> par mois ou 120,50 $ CA par année');
    // A figure out of form, a missing price the checkout would charge, or no
    // payment service: no figure, as the billing page offers nothing then.
    const none = '<span class="muted">Not on sale yet</span>';
    expect(await at({ PRICE_YEARLY_CAD: "about 120" })).toBe(none);
    expect(await at({ STRIPE_PRICE_MONTHLY: "" })).toBe(none);
    expect(await at({}, "en", on)).toBe(none);
    expect(await at({}, "fr", on)).toBe('<span class="muted">Pas encore en vente</span>');
    expect(proPrice({ ...testEnv(radar()), PRICE_MONTHLY_CAD: "" } as never)).toBeNull();
    // The taxes are named with the price, in the note under the buttons, and only with it; a reader
    // not signed in reads the steps from the Subscribe button to Stripe's page first.
    const withPrice = cardsOf(teaseOf(await html("/expiring/6m", { env: paid() })))[1];
    expect(withPrice).toContain('<p class="plan-for">For people who bid, or follow who wins.</p>');
    expect(withPrice).toContain('<p class="plan-note">Enter your email, type the 6-digit code the site sends, then pay monthly or yearly on Stripe&#39;s page. There is no password. ' +
      'Taxes added at checkout. Monthly or yearly, cancel any time. Sold through Link on behalf of Allwater Software Inc.</p>');
    const withoutPrice = cardsOf(teaseOf(await html("/expiring/6m", { env: on() })))[1];
    expect(withoutPrice).toContain('<p class="plan-for">For people who bid, or follow who wins.</p>');
    expect(withoutPrice).not.toContain("plan-note");
    // The price is never written as a figure in the code's strings.
    for (const key of ["pro.price", "plans.price", "plans.figure"] as Key[]) expect(rawEntry(key).en + rawEntry(key).fr).not.toMatch(/[0-9]/);
  });

  it("lists what Pro includes, watches, calendar feeds, your organization, the weekly briefing, the keyed API, instrument files and bug reports among it, each line a Pro feature", () => {
    expect(PRO_INCLUDES.map(([f]) => f)).toEqual([
      "intraday", "radar_depth", "radar_depth", "delivery", "watch_mail", "delivery", "analytics", "matches", "match_mail", "radar_depth", "api",
      "export_filtered", "delivery", "analytics", "bug_reports",
    ]);
    expect(PRO_INCLUDES.map(([, key]) => key)).toContain("plans.pro_briefing");
    expect(PRO_INCLUDES).toEqual(PLAN_ROWS.map((r) => [r.feature, r.pro.key]));
    // The rows Free has come first, then the rows only Pro has, so the hollow marks gather at the foot.
    const firstLack = PLAN_ROWS.findIndex((r) => !r.free);
    expect(firstLack).toBeGreaterThan(0);
    expect(PLAN_ROWS.slice(firstLack).every((r) => !r.free)).toBe(true);
  });
});

// -- the plan cards (src/pro.tsx PlanCards) ---------------------------------------------------

// A card's rows: whether each is marked as lacking, and its words as read.
const rowsOf = (card: string) => [...card.matchAll(/<li( class="plan-lacks")?>([\s\S]*?)<\/li>/g)].map((m) => ({
  lacks: !!m[1],
  hollow: m[2].includes('class="plan-mark plan-mark-none"'),
  text: m[2].replace(/<span class="visually-hidden">[^<]*<\/span>/, "").replace(/<[^>]+>/g, ""),
  said: /<span class="visually-hidden">([^<]*)<\/span>/.exec(m[2])?.[1] ?? null,
}));

describe("the plan cards", () => {
  const TEASES = ["/tenders/same-day", "/expiring/6m", "/expiring/12m"];

  it("put Free beside Pro on both tease pages, the same rows in the same order, Free's lacks in a hollow ring, in both languages", async () => {
    await sessions();
    for (const path of TEASES) {
      for (const lang of ["en", "fr"] as const) {
        for (const [who, cookie] of [["no session", undefined], ["free", freeCookie]] as const) {
          const at = `${path} ${lang} ${who}`;
          const page = nbsp(decode(await html(`${path}?lang=${lang}`, { env: paid(), cookie })));
          const panel = teaseOf(page);
          // One span for every card: the head band, the price, the "for" line,
          // one row an entry, the buttons and the note (the stylesheet reads it).
          expect(PLAN_CARD_ROWS).toBe(3 + PLAN_ROWS.length + 2);
          expect(panel, at).toContain(`<div class="plan-cards" style="--plan-rows:${PLAN_ROWS.length};--plan-card-rows:${PLAN_CARD_ROWS}">`);
          const cards = cardsOf(panel);
          expect(cards, at).toHaveLength(2);
          // Every card exactly one <li> an entry, and no row span of its own.
          for (const card of cards) {
            expect(card.match(/<li[ >]/g), at).toHaveLength(PLAN_ROWS.length);
            expect(card, at).not.toContain("style=");
          }
          const [free, pro] = cards;
          // Pro is the plan on offer: framed through its class; Free is not.
          expect(free, at).toMatch(/^<div class="plan-card"><div class="plan-card-head"><h3>(Free|Gratuit)<\/h3>/);
          expect(pro, at).toMatch(/^<div class="plan-card plan-card-offer"><div class="plan-card-head"><h3>Pro<\/h3><span class="pro-tag">/);
          const freeRows = rowsOf(free);
          const proRows = rowsOf(pro);
          expect(freeRows, at).toHaveLength(PLAN_ROWS.length);
          expect(proRows, at).toHaveLength(PLAN_ROWS.length);
          PLAN_ROWS.forEach((row, i) => {
            // Pro has every row, in its own words with a check.
            expect(proRows[i], `${at} row ${i}`).toEqual({ lacks: false, hollow: false, text: nbsp(planLine(lang, row.pro)), said: null });
            // Free has its own words with a check, or Pro's in a hollow ring, said in words for a screen reader.
            expect(freeRows[i], `${at} row ${i}`).toEqual(row.free
              ? { lacks: false, hollow: false, text: nbsp(planLine(lang, row.free)), said: null }
              : { lacks: true, hollow: true, text: nbsp(planLine(lang, row.pro)), said: nbsp(`${t(lang, "plans.lacks")} `) });
          });
          expect(freeRows.filter((r) => r.lacks).length, at).toBe(PLAN_ROWS.filter((r) => !r.free).length);
          expect(freeRows.filter((r) => r.lacks).length, at).toBeGreaterThan(0);
          expect(panel, at).not.toContain(EM_DASH);
        }
      }
    }
  });

  it("state each plan's own figure on its own line, read from RULES and the constants, and never compare the plans", async () => {
    const at = async (lang: "en" | "fr") => cardsOf(teaseOf(nbsp(decode(await html(`/tenders/same-day?lang=${lang}`, { env: paid() })))));
    const [free, pro] = await at("en");
    // Saved searches and watches: each plan's count, from RULES.
    expect(free).toContain(`<span>${RULES.free.saved_searches} saved searches, on the site</span>`);
    expect(pro).toContain(`<span>${RULES.pro.saved_searches} saved searches, by email</span>`);
    expect(free).toContain(`<span>${RULES.free.watchlists} watches, on the site</span>`);
    expect(pro).toContain(`<span>${RULES.pro.watchlists} watches, each change by email</span>`);
    // Analytics: the fiscal years Free sees against every view.
    expect(free).toContain(`<span>Analytics: first chart, ${FREE_YEARS} fiscal years</span>`);
    expect(pro).toContain(`<span>Analytics: every view, ${MAX_YEARS} fiscal years</span>`);
    // The keyed API's daily limit, from api_keyed_spec, against the open API.
    expect(free).toContain("<span>Open JSON API</span>");
    expect(pro).toContain(`<span>Keyed API: ${KEY_PER_DAY.toLocaleString("en-CA")} requests a day</span>`);
    // Contracts ending: the windows by name, from EXPIRING_WINDOWS; same-day notices every 2 hours, from the schedule.
    expect(free).toContain("<span>Contracts ending: the 3-month list</span>");
    expect(pro).toContain("<span>Contracts ending: 6- and 12-month lists</span>");
    expect(free).toContain("<span>Contracts ending: the 3-month CSV</span>");
    expect(pro).toContain("<span>Contracts ending: the 12-month CSV</span>");
    // The holder's record: the radar's windows, the 3-month list's on Free and the 12-month list's on Pro.
    expect(free).toContain("<span>Holder's record: the 3-month list</span>");
    expect(pro).toContain("<span>Holder's record: the 12-month list</span>");
    expect(EXPIRING_WINDOWS).toEqual(["3m", "6m", "12m"]);
    const hours = Number(SAME_DAY_RUNS_UTC[1].slice(0, 2)) - Number(SAME_DAY_RUNS_UTC[0].slice(0, 2));
    expect(pro).toContain(`<span>Tender notices, same day, every ${hours} hours</span>`);
    expect(free).toContain('<strong class="plan-amount">CA$0</strong>');
    const [freeFr, proFr] = await at("fr");
    expect(freeFr).toContain(`<span>${RULES.free.saved_searches} recherches enregistrées, sur le site</span>`);
    expect(proFr).toContain(`<span>${RULES.pro.saved_searches} recherches enregistrées, par courriel</span>`);
    expect(proFr).toContain(`<span>API avec clé : ${KEY_PER_DAY.toLocaleString("fr-CA").replace(/\s/g, " ")} requêtes par jour</span>`);
    // Your organization's page beside the competitors it compares, as many as org_claim allows.
    expect(pro).toContain(`<span>Your organization beside ${COMPETITORS_MAX} others</span>`);
    // The week's matching notices by email: each plan's own count, from RULES, on the same wording.
    expect(free).toContain(`<span>${RULES.free.match_mail} matching notices a week, by email</span>`);
    expect(pro).toContain(`<span>${RULES.pro.match_mail} matching notices a week, by email</span>`);
    expect(freeFr).toContain(`<span>${RULES.free.match_mail} correspondances par semaine, par courriel</span>`);
    expect(proFr).toContain(`<span>${RULES.pro.match_mail} correspondances par semaine, par courriel</span>`);
    // Every figure on a card is one of the plans' or the constants', or a window's months.
    const figures = new Set([RULES.free.saved_searches, RULES.pro.saved_searches, RULES.free.watchlists, RULES.pro.watchlists,
      RULES.free.matches, RULES.pro.matches, RULES.free.match_mail, RULES.pro.match_mail, FREE_YEARS, MAX_YEARS,
      KEY_PER_DAY, hours, COMPETITORS_MAX, 3, 6, 12].map(String));
    for (const card of [free, pro, freeFr, proFr]) {
      for (const { text } of rowsOf(card)) {
        for (const n of text.match(/[0-9][0-9 ,]*[0-9]|[0-9]/g) ?? []) expect(figures, `${n} in "${text}"`).toContain(n.replace(/[ ,]/g, ""));
      }
    }
    // No comparative: a line names what its own plan gets.
    const COMPARATIVE = /\b(more|higher|above|unlimited|limits above|plus|davantage|supérieure?s?|au-dessus|illimitée?s?)\b/i;
    for (const card of [free, pro, freeFr, proFr]) expect(card.replace(/<[^>]+>/g, " "), card.slice(0, 60)).not.toMatch(COMPARATIVE);
    for (const key of allKeys().filter((k) => k.startsWith("plans."))) expect(rawEntry(key).en + " " + rawEntry(key).fr, key).not.toMatch(COMPARATIVE);
    // Every row is one the plans give Pro and not Free, or for a counted feature a larger figure on Pro.
    for (const row of PLAN_ROWS) {
      const pro = RULES.pro[row.feature];
      const free = RULES.free[row.feature];
      if (typeof pro === "number") {
        expect(pro, row.pro.key).toBeGreaterThan(free as number);
      } else {
        expect(pro, row.pro.key).toBe(true);
        expect(free, row.pro.key).toBe(false);
      }
    }
  });

  it("are drawn in the theme's tokens: Pro framed 2 px in the accent with its head on the accent's soft ground, the heights held by the grid", () => {
    const rule = (selector: string) => rulesFor(...selector.split(/[ .]+/).filter(Boolean)).find((r) => r.selector === selector)?.body ?? "";
    expect(decl(rule(".plan-card.plan-card-offer"), "border")).toBe("2px solid var(--accent)");
    expect(decl(rule(".plan-card-offer .plan-card-head"), "background")).toBe("var(--accent-soft)");
    expect(decl(rule(".plan-cards"), "grid-template-columns")).toBe("repeat(auto-fit, minmax(300px, 1fr))");
    expect(decl(rule(".plan-cards"), "align-items")).toBe("stretch");
    // No row gap in the grid: under subgrid it would set a floor under every row of the cards.
    expect(decl(rule(".plan-cards"), "gap")).toBe("0 var(--gutter)");
    expect(decl(rule(".plan-card"), "margin-bottom")).toBe("var(--gutter)");
    // Without subgrid: a flex column, the buttons pushed to the foot.
    expect(decl(rule(".plan-card"), "flex-direction")).toBe("column");
    expect(decl(rule(".plan-card .plan-buttons"), "margin")).toMatch(/^auto /);
    // One line each, tight: no wrap (an ellipsis at worst), no padding and no rule between rows.
    for (const selector of [".plan-card .plan-for", ".plan-card .plan-list li"]) {
      expect(decl(rule(selector), "white-space"), selector).toBe("nowrap");
    }
    expect(decl(rule(".plan-card .plan-for"), "overflow")).toBe("hidden");
    expect(decl(rule(".plan-card .plan-for"), "text-overflow")).toBe("ellipsis");
    // Below a line height of 1 the row lets its mark and tall letters show; the text span clips for its ellipsis,
    // with padding and a matching negative margin so the clip cuts no letter.
    expect(decl(rule(".plan-card .plan-list li"), "overflow")).toBe("visible");
    const span = rule(".plan-card .plan-list li > span");
    expect(decl(span, "overflow")).toBe("hidden");
    expect(decl(span, "text-overflow")).toBe("ellipsis");
    expect(decl(span, "white-space")).toBe("nowrap");
    expect(decl(span, "padding")).toBe("3px 0");
    expect(decl(span, "margin")).toBe("-3px 0");
    expect(decl(rule(".plan-card .plan-list li"), "padding")).toBe("0");
    expect(rule(".plan-card .plan-list li")).not.toContain("border");
    expect(decl(rule(".plan-mark"), "width")).toBe("12px");
    // The spacing values are named once on the grid and read by the rules.
    const cards = rule(".plan-cards");
    // A plain number, the one spacing value the operator is still settling (0.9 at the last step).
    expect(decl(cards, "--plan-row-lh")).toMatch(/^[0-9.]+$/);
    expect(decl(cards, "--plan-head-h")).toBe("28px");
    expect(decl(rule(".plan-card .plan-list li"), "line-height")).toBe("var(--plan-row-lh)");
    expect(decl(rule(".plan-card .plan-list li:first-child"), "padding-top")).toBe("var(--plan-row-first)");
    expect(decl(rule(".plan-card .plan-card-head"), "min-height")).toBe("var(--plan-head-h)");
    expect(decl(rule(".plan-card .plan-buttons"), "padding-top")).toBe("var(--plan-buttons-above)");
    for (const v of ["--plan-head-pad", "--plan-name-above", "--plan-for-below", "--plan-row-first", "--plan-buttons-above", "--plan-foot"]) {
      expect(decl(cards, v), v).toMatch(/^[0-9]+px$/);
      expect(STYLES.split(`var(${v})`).length - 1, v).toBeGreaterThanOrEqual(1);
    }
    // With it: every card spans the same rows, its list one row an entry, each a subgrid, so the rows align across the cards.
    const supports = /@supports \(grid-template-rows: subgrid\) \{\n {2}\.plan-card \{[\s\S]*?\n\}/.exec(STYLES)?.[0] ?? "";
    const inner = (selector: string) => new RegExp(`\\n {2}${selector.replace(/\./g, "\\.")} \\{([^}]*)\\}`).exec(supports)?.[1] ?? "";
    expect(decl(inner(".plan-card"), "grid-row")).toBe("span var(--plan-card-rows)");
    expect(decl(inner(".plan-card"), "grid-template-rows")).toBe("subgrid");
    expect(decl(inner(".plan-card .plan-list"), "grid-row")).toBe("span var(--plan-rows)");
    expect(decl(inner(".plan-card .plan-list"), "grid-template-rows")).toBe("subgrid");
    expect(decl(inner(".plan-card .plan-buttons"), "align-self")).toBe("start");
    // Each theme defines the soft ground.
    for (const block of [/:root \{[\s\S]*?\n\}/, /:root\[data-theme="dark"\] \{[\s\S]*?\n\}/, /:root:not\(\[data-theme="light"\]\) \{[\s\S]*?\n {2}\}/]) {
      expect(block.exec(STYLES)?.[0] ?? "").toMatch(/--accent-soft: #[0-9a-f]{6};/);
    }
    // The marks are inline SVG in the markup, never a character or a pseudo-element.
    for (const { selector, body } of rulesFor("plan-mark", "plan-card", "plan-cards")) {
      expect(selector).not.toMatch(/::?(before|after)/);
      expect(body, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
    expect(STYLES_VERSION).toBeGreaterThanOrEqual(25);
  });

  it("keep every row and the two \"for\" lines to one short line in both languages", () => {
    for (const lang of ["en", "fr"] as const) {
      for (const row of PLAN_ROWS) {
        for (const w of [row.free, row.pro]) {
          if (!w) continue;
          const line = planLine(lang, w);
          expect(line.length, `${lang} "${line}"`).toBeLessThanOrEqual(PLAN_LINE_MAX);
          expect(line, lang).not.toMatch(/\{\w+\}/);
        }
      }
      for (const key of ["plans.free_for", "plans.pro_for"] as Key[]) expect(t(lang, key).length, `${lang} ${key}`).toBeLessThanOrEqual(PLAN_LINE_MAX);
    }
    expect(PLAN_LINE_MAX).toBeLessThanOrEqual(44);
  });

  it("have their strings in both languages, French apart, with no em-dash, no price figure and no sales words", () => {
    const keys = allKeys().filter((k) => k.startsWith("plans."));
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      expect(fr, key).not.toBe(en);
      expect(en + fr, key).not.toContain(EM_DASH);
      expect(en + fr, key).not.toMatch(/\$\s?[0-9]|[0-9]\s?\$/);
      for (const word of ["powerful", "seamless", "unlock", "best", "ultimate", "premium", "exclusive"]) expect(en.toLowerCase(), `${key}: ${word}`).not.toContain(word);
    }
  });
});

describe("the links to the 12-month list", () => {
  it("carry the chip on profiles and buyer pages while the switch is on, and nothing while it is off", async () => {
    const profiles = clone(FILES["profiles/a00.json"]) as Record<string, any>;
    profiles["org-a000000001"].expiring.n = 30;
    const assets = radar({ "profiles/a00.json": profiles });
    const onPage = await html("/organizations/org-a000000001", { env: on({ ASSETS: assets }) });
    expect(onPage).toContain(`The other 29 are in <a href="/expiring/12m">the 12-month list${CHIP_EN}</a>.`);
    const fr = await html("/organizations/org-a000000001?lang=fr", { env: on({ ASSETS: assets }) });
    expect(fr).toContain(`Les 29 autres se trouvent dans <a href="/expiring/12m">la liste de 12 mois${CHIP_FR}</a>.`);
    const off = await html("/organizations/org-a000000001", { env: testEnv(assets) });
    expect(off).toContain('The other 29 are in <a href="/expiring/12m">the 12-month list</a>.');
    const buyer = await html("/buyers/pwgsc-tpsgc", { env: on() });
    expect(buyer).toContain(`<a href="/expiring/12m?buyer=pwgsc-tpsgc">This buyer's contracts in the 12-month list${CHIP_EN}</a>`.replace("'", "&#39;"));
    const buyerFr = await html("/buyers/pwgsc-tpsgc?lang=fr", { env: on() });
    expect(buyerFr).toContain(`Les contrats de cet acheteur dans la liste de 12 mois${CHIP_FR}</a>`);
    expect(chips(await html("/buyers/pwgsc-tpsgc", { env: testEnv(radar()) }))).toBe(0);
  });
});

// -- same-day notices ---------------------------------------------------------------------------

const DATA_DATE = "2026-10-31";
async function seedSameDay(): Promise<void> {
  await applySql(SEARCH, INTRADAY_SCHEMA);
  await SEARCH.prepare("DELETE FROM intraday_tenders").run();
  await SEARCH.prepare(
    "INSERT INTO intraday_tenders (reference, amendment, seen_at, published, closing, title_en, title_fr, buyer_id, buyer_name, buyer_name_fr, " +
    "category, segments, provinces, codes) VALUES (?, 0, ?, ?, ?, ?, ?, NULL, ?, NULL, '[]', '[]', '[\"NS\"]', '[]')",
  ).bind("cb-950-95000001", `${DATA_DATE}T15:45:10Z`, DATA_DATE, "2026-11-20T14:00:00", "Same-day harbour dredging", "Dragage du port du jour",
    "Some Harbour Office").run();
}

// A D1 binding that notes any use and refuses it: a free request must not touch it.
function refusing(): { db: D1Database; used: string[] } {
  const used: string[] = [];
  const db = new Proxy({}, { get: (_t, p) => { used.push(String(p)); return () => { throw new Error("SEARCH was used"); }; } }) as unknown as D1Database;
  return { db, used };
}

describe("same-day notices", () => {
  it("add one gate note to the tender lists' head for a reader without the feature, linking the page", async () => {
    await sessions();
    const note = (lang: "en" | "fr") => lang === "en"
      ? `<p class="pro-note">${CHIP_EN}<a href="/tenders/same-day">Same-day notices</a>: the notices CanadaBuys posts during the day show above this list, read every two hours.</p>`
      : `<p class="pro-note">${CHIP_FR}<a href="/tenders/same-day">Avis du jour</a> : les avis publiés sur AchatsCanada pendant la journée paraissent au-dessus de cette liste, lus toutes les deux heures.</p>`;
    for (const [who, cookie] of [["no session", undefined], ["free", freeCookie]] as const) {
      for (const lang of ["en", "fr"] as const) {
        for (const path of ["/tenders", "/tenders/new"]) {
          const { db, used } = refusing();
          const page = decode(await html(`${path}?lang=${lang}`, { env: on({ SEARCH: db }), cookie }));
          const head = /<header class="page-head">[\s\S]*?<\/header>/.exec(page)?.[0] ?? "";
          expect(head, `${who} ${lang} ${path}`).toContain(decode(note(lang)));
          expect(chips(head), path).toBe(1);
          expect(used, `${who} ${path}: no database read for a free reader`).toEqual([]);
        }
      }
    }
    // A Pro reader gets the band instead, and no note.
    for (const path of ["/tenders", "/tenders/new"]) {
      expect(await html(path, { env: on(), cookie: proCookie }), path).not.toContain("pro-note");
    }
  });

  it("have a page whose free view is the head, the cadence line and what Pro adds, and reads no notice", async () => {
    await sessions();
    for (const [who, cookie] of [["no session", undefined], ["free", freeCookie]] as const) {
      const { db, used } = refusing();
      const res = await get("/tenders/same-day", { env: paid({ SEARCH: db }), cookie });
      expect(res.status, who).toBe(200);
      expect(res.headers.get("cache-control"), who).toBe(cookie ? "private, no-store" : "public, max-age=300");
      expect(res.headers.get("vary"), who).toBe("Cookie");
      const page = decode(nbsp(await res.text()));
      expect(used, who).toEqual([]);
      expect(page).toContain("<h1>Same-day Tender Notices</h1>");
      expect(page).toContain('<p class="lead">The notices CanadaBuys posts after the morning refresh, read every two hours through the Ottawa business day.</p>');
      expect(page).toContain('<a href="/tenders">Open tender notices</a>');
      expect(page).not.toContain('<meta name="robots" content="noindex');
      const panel = teaseOf(page);
      expect(panel).toContain(`<h2>Part of Pro</h2><div class="panel-tools">${CHIP_EN}</div>`);
      expect(panel).toContain("<p>With Pro, this page lists them as they are read, and the same notices show above the tender lists until the next morning's refresh adds them there.</p>");
      expect(panel).toContain('<p>The <a href="/tenders">list of open notices</a>, the <a href="/tenders/new">new notices by day</a> and their feeds stay free, refreshed every morning.</p>');
      const [free, pro] = cardsOf(panel);
      expect(free).toContain("<span>Tender notices, nightly</span>");
      expect(pro).toContain("<span>Tender notices, same day, every 2 hours</span>");
      expect(pro).toContain(`<strong class="plan-amount">CA$${PRICE[1]}</strong> a month or CA$${PRICE[2]} a year`);
      // Signed out, the steps from the Subscribe button to Stripe's page come first.
      const steps = cookie ? "" : "Enter your email, type the 6-digit code the site sends, then pay monthly or yearly on Stripe's page. There is no password. ";
      expect(pro).toContain(`<p class="plan-note">${steps}Taxes added at checkout. Monthly or yearly, cancel any time. Sold through Link on behalf of Allwater Software Inc.</p>`);
      // Signed out: an account on Free's card, sign-in and the Pro page
      // (pages/pro.tsx) on Pro's. A Free session: its account, the billing page.
      expect(free.match(/class="btn/g), who).toHaveLength(1);
      expect(pro.match(/class="btn/g), who).toHaveLength(2);
      expect(free).toContain(cookie ? '<a href="/account" class="btn">Your account</a>' : '<a href="/account/sign-in" class="btn">Create a free account</a>');
      expect(pro).toContain(cookie ? '<a href="/account/billing" class="btn btn-primary">Plan and billing</a> <a href="/pro" class="btn">About Pro</a>'
        : '<a href="/account/sign-in?next=/account/billing" class="btn btn-primary">Subscribe to Pro</a> <a href="/pro" class="btn">About Pro</a>');
      expect(free.includes('<span class="plan-current">Your plan</span>'), who).toBe(!!cookie);
      expect(page).not.toContain("intraday");
    }
    const fr = decode(nbsp(await html("/tenders/same-day?lang=fr", { env: paid() })));
    expect(fr).toContain("<h1>Avis d’appel d’offres du jour</h1>");
    expect(fr).toContain(`<h2>Offert avec le forfait Pro</h2><div class="panel-tools">${CHIP_FR}</div>`);
    expect(fr).toContain("La <a href=\"/tenders\">liste des avis ouverts</a>, les <a href=\"/tenders/new\">nouveaux avis par jour</a> et leurs fils restent gratuits, mis à jour chaque matin.");
    expect(fr).toContain(`<strong class="plan-amount">${PRICE[1].replace(".", ",")} $ CA</strong> par mois`);
    expect(fr).toContain('<a href="/account/sign-in" class="btn">Créer un compte gratuit</a>');
  });

  it("show a Pro reader the band's notices as a page, or a line when none has been read", async () => {
    await sessions();
    await seedSameDay();
    const res = await get("/tenders/same-day", { env: on(), cookie: proCookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const page = decode(await res.text());
    expect(page).toContain('<section class="panel intraday">');
    expect(page).toContain("Same-day harbour dredging");
    expect(page).not.toContain("pro-panel");
    expect(chips(mainOf(page))).toBe(0);
    const fr = decode(nbsp(await (await get("/tenders/same-day?lang=fr", { env: on(), cookie: proCookie })).text()));
    expect(fr).toContain("Dragage du port du jour");
    // No rows (or no database): the line, never an error.
    const none = decode(await (await get("/tenders/same-day", { env: on({ SEARCH: undefined }), cookie: proCookie })).text());
    expect(none).toContain("<p class=\"muted\">No notice posted since this morning's refresh has been read yet.</p>");
  });

  it("count as a page of their own in the views, not as a notice", () => {
    expect(routeTemplate("GET", "/tenders/same-day")).toEqual({ route: "/tenders/same-day", kind: "page" });
  });
});

// -- the Data page --------------------------------------------------------------------------------

describe("the Data page", () => {
  const row = (page: string) => /<tr><td data-label="[^"]*"><a href="[^"]*" class="mono">expiring-12m\.csv<\/a>[\s\S]*?<\/tr>/.exec(page)?.[0] ?? "";

  it("marks the 12-month file and sends a reader without the radar's depth to the list's free view", async () => {
    await sessions();
    for (const [who, cookie] of [["no session", undefined], ["free", freeCookie]] as const) {
      const r = row(await html("/data", { env: on(), cookie }));
      expect(r, who).toContain('<a href="/expiring/12m" class="mono">expiring-12m.csv</a>');
      expect(r, who).toContain(`one row each, listed once across sources<p class="pro-note">${CHIP_EN}Part of Pro. The 3-month file is free.</p>`);
    }
    const pro = row(await html("/data", { env: on(), cookie: proCookie }));
    expect(pro).toContain('<a href="/downloads/expiring-12m.csv" class="mono">expiring-12m.csv</a>');
    expect(chips(pro)).toBe(1);
    const fr = row(await html("/data?lang=fr", { env: on() }));
    expect(fr).toContain(`<p class="pro-note">${CHIP_FR}Fait partie de Pro. Le fichier de 3 mois est gratuit.</p>`);
    // The file's own address still answers 404 to such a request.
    expect((await get("/downloads/expiring-12m.csv", { env: on() })).status).toBe(404);
    // Exactly two chips on the page outside the rail: the file's row and the line on keys.
    expect(chips(mainOf(await html("/data", { env: on() })))).toBe(2);
  });

  it("says in one line, with the chip, that API keys come with Pro", async () => {
    const en = decode(await html("/data", { env: on() }));
    expect(en).toContain(`<p class="pro-note">${CHIP_EN}<a href="/account/keys">API keys</a> come with Pro and open the keyed API below.</p>`);
    expect(en.indexOf("API keys</a> come with Pro")).toBeGreaterThan(en.indexOf("Each address may make 60 API requests a minute."));
    const fr = decode(await html("/data?lang=fr", { env: on() }));
    expect(fr).toContain(`<p class="pro-note">${CHIP_FR}Les <a href="/account/keys">clés d’API</a> sont offertes avec le forfait Pro et ouvrent l’API avec clé ci-dessous.</p>`);
  });
});

// -- the Email lists page ---------------------------------------------------------------------------

describe("the Email lists page", () => {
  const choose = (lang: string, email: string, e: object, headers: Record<string, string> = {}) =>
    app.request("/interest", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp(), ...headers },
      body: new URLSearchParams([["place", "lists"], ["national", "0"], ["list", "tenders"], ["email", email], ["lang", lang], ["website", ""]]).toString(),
    }, e);

  it("adds, after the lists saved, one line saying delivery is part of Pro, with the sign-in link", async () => {
    const en = decode(await (await choose("en", newEmail("lists-pro"), on())).text());
    expect(en).toContain(`<p class="pro-note">${CHIP_EN}Delivery is part of Pro. <a href="/account/sign-in">Sign in</a> with this address to start it.</p>`);
    const fr = decode(nbsp(await (await choose("fr", newEmail("lists-pro-fr"), on())).text()));
    expect(fr).toContain(`<p class="pro-note">${CHIP_FR}L’envoi fait partie de Pro. <a href="/account/sign-in">Connectez-vous</a> avec cette adresse pour le lancer.</p>`);
    // The script's answer, the block alone, carries it too.
    const fragment = await choose("en", newEmail("lists-frag"), on(), { "x-interest-fragment": "1" });
    expect(fragment.headers.get("x-interest-fragment")).toBe("1");
    expect(decode(await fragment.text())).toContain(`<p class="pro-note">${CHIP_EN}Delivery is part of Pro.`);
    // Switch off: nothing to sign in to, so no line.
    expect(await (await choose("en", newEmail("lists-off"), testEnv(radar()))).text()).not.toContain("pro-note");
  });

  it("marks the section on what Pro delivers, the only chip in the page's body", async () => {
    const en = await html("/alerts", { env: on() });
    expect(en).toContain(`<h2 id="cover">What Pro Delivers${CHIP_EN}</h2>`);
    expect(chips(mainOf(en))).toBe(1);
    expect(await html("/alerts?lang=fr", { env: on() })).toContain(`<h2 id="cover">Ce que Pro envoie${CHIP_FR}</h2>`);
  });
});

// -- the account --------------------------------------------------------------------------------

describe("a Free account", () => {
  it("sees API keys, API usage and Report a bug on its overview with the chip; a Pro account sees them without", async () => {
    await sessions();
    const free = decode(await html("/account", { cookie: freeCookie }));
    expect(free).toContain(`<a href="/account/keys">API keys${CHIP_EN}</a>`);
    expect(free).toContain(`<li><a href="/account/api">API usage${CHIP_EN}</a></li>`);
    expect(free).toContain(`<dd><a href="/account/bug">Report a bug${CHIP_EN}</a></dd>`);
    const fr = decode(await html("/account?lang=fr", { cookie: freeCookie }));
    expect(fr).toContain(`<a href="/account/keys">Clés d’API${CHIP_FR}</a>`);
    expect(fr).toContain(`<a href="/account/api">Utilisation de l’API${CHIP_FR}</a>`);
    const pro = decode(await html("/account", { cookie: proCookie }));
    expect(pro).toContain('<a href="/account/keys">API keys</a>');
    expect(pro).toContain('<li><a href="/account/api">API usage</a></li>');
    expect(chips(mainOf(pro))).toBe(0);
  });

  it("gets gate notes on its searches: the cap at the panel's foot and delivery in each row", async () => {
    const email = newEmail("mark-searches");
    const cookie = await signIn(email);
    const token = await csrf(cookie, "/account/searches");
    for (const url of ["/tenders?segment=82", "/expiring", "/segments/82"]) await post("/account/searches", { csrf: token, url }, { cookie });
    const page = decode(await html("/account/searches", { cookie }));
    expect(page).toContain(`<div class="panel-foot"><p class="pro-note">${CHIP_EN}This account holds 3 of 3 saved searches. Pro holds up to 25 and sends them by email, daily or weekly. <a href="/account/billing">Plans and prices</a></p></div>`);
    // The tender list is a kind the delivery job serves: its delivery reads Off in a note, no select.
    expect(page).toContain(`<p class="pro-note">${CHIP_EN}Off. Email delivery is part of Pro. <a href="/account/billing">Plans and prices</a></p>`);
    expect(page).not.toContain('<select name="deliver"');
    const fr = decode(await html("/account/searches?lang=fr", { cookie }));
    expect(fr).toContain(`${CHIP_FR}Recherches enregistrées de ce compte : 3 sur 3. Pro en conserve jusqu’à 25 et les envoie par courriel, chaque jour ou chaque semaine.`);
    expect(fr).toContain(`${CHIP_FR}Désactivé. L’envoi par courriel fait partie de Pro.`);
    // Pro: the select, the plain cap line, no chip.
    await grantPro(email);
    const pro = decode(await html("/account/searches", { cookie }));
    expect(pro).toContain('<select name="deliver"');
    expect(chips(mainOf(pro))).toBe(0);
  });

  it("finds the chip in the head of the key panel and the bug page's tease, with the billing link and the price", async () => {
    await sessions();
    const keys = decode(await html("/account/keys", { cookie: freeCookie }));
    expect(keys).toContain(`<h2>Create a Key</h2><div class="panel-tools">${CHIP_EN}</div>`);
    expect(keys).toContain('<p>API keys come with the Pro plan. <a href="/account/billing">Plans and prices</a></p>');
    const bug = decode(await html("/account/bug", { cookie: freeCookie }));
    expect(bug).toContain(`<section class="panel pro-panel"><div class="panel-head"><h2>Part of Pro</h2><div class="panel-tools">${CHIP_EN}</div></div>`);
    expect(bug).toContain(`<p class="pro-price">Pro is CA$${PRICE[1]} a month or CA$${PRICE[2]} a year, taxes added at checkout. The first payment is refunded in full if you ask within 14 days.</p>`);
    const bugFr = decode(nbsp(await html("/account/bug?lang=fr", { cookie: freeCookie })));
    expect(bugFr).toContain(`<h2>Offert avec le forfait Pro</h2><div class="panel-tools">${CHIP_FR}</div>`);
    expect(chips(mainOf(decode(await html("/account/keys", { cookie: proCookie }))))).toBe(0);
  });
});

// -- the strings ----------------------------------------------------------------------------------

describe("the strings the mark adds", () => {
  const NEW: Key[] = [
    "rail.ending_6m_full", "rail.ending_12m_full", "rail.same_day", "rail.same_day_full", "sameday.title", "sameday.lead",
    "sameday.description", "sameday.pro_text", "sameday.free", "sameday.free_open", "sameday.free_new", "sameday.none",
    "sameday.tenders_note", "pro.tag", "pro.tag_hidden", "pro.price", "pro.include_bugs", "data.file.pro_on", "data.api_keys",
    "data.api_keys_link", "lists.done_pro", "lists.done_sign_in", "account.cap_note", "account.deliver_gate",
  ] as Key[];

  it("are in both languages, French apart from the plan's name, with no em-dash and no figure of a price", () => {
    for (const key of NEW) {
      expect(allKeys(), key).toContain(key);
      const { en, fr } = rawEntry(key);
      expect(en.trim(), key).not.toBe("");
      expect(fr.trim(), key).not.toBe("");
      if (key === "pro.tag") expect(SAME_IN_BOTH.has(key)).toBe(true);
      else expect(fr, key).not.toBe(en);
      expect(en + fr, key).not.toContain(EM_DASH);
      expect(en + fr, key).not.toMatch(/\$\s?[0-9]|[0-9]\s?\$/);
    }
    expect(t("fr", "pro.tag")).toBe("Pro");
  });

  it("render in French on the French pages, with no English left", async () => {
    await sessions();
    const pages = [
      ["/?lang=fr", undefined], ["/tenders?lang=fr", undefined], ["/tenders/same-day?lang=fr", undefined], ["/data?lang=fr", undefined],
      ["/expiring/6m?lang=fr", undefined], ["/account/searches?lang=fr", freeCookie], ["/account?lang=fr", freeCookie],
    ] as const;
    const english = NEW.filter((k) => k !== "pro.tag").map((k) => rawEntry(k).en.split("{")[0].trim()).filter((s) => s.length > 6);
    for (const [path, cookie] of pages) {
      const page = decode(await html(path, { env: on(), cookie }));
      for (const s of english) expect(page, `${path}: "${s}"`).not.toContain(s);
      expect(page, path).not.toContain(EM_DASH);
    }
  });
});
