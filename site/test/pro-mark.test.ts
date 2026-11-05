// The Pro mark (src/pro.tsx) and where it goes. The chip marks a boundary
// the reader is at: the rail's entries that lead to a page that comes with
// Pro, the radar's deep-window tabs and tiles, the links to the 12-month
// list, gate notes, tease panels, and a Free account's overview rows. Never
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
import { PRO_GLYPH_PATH, PRO_INCLUDES, proPrice } from "../src/pro";
import { routeTemplate } from "../src/views";
import { csrf, decode, get, grantPro, nbsp, newEmail, nextIp, onEnv, post, signIn, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import { applySql } from "./setup";

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

// The chip as ProTag writes it, in either language.
const CHIP_EN = `<span class="pro-tag"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="${PRO_GLYPH_PATH}"></path></svg>Pro<span class="visually-hidden"> (paid plan)</span></span>`;
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
    expect(decl(chip.body, "border")).toBe("1px solid var(--accent)");
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
    expect(decl(glyph.body, "width")).toBe("11px");
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

const PRO_PAGES = ["/expiring/6m", "/expiring/12m", "/tenders/same-day"];

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
      expect(overview, who).toContain(`<a class="tile" href="/expiring/6m"><span class="tile-label">Within 6 months ${CHIP_EN}</span>`);
      expect(overview, who).toContain(`<a class="tile" href="/expiring/12m"><span class="tile-label">Within 12 months ${CHIP_EN}</span>`);
      for (const path of ["/expiring/3m", "/expiring/6m", "/expiring/12m"]) {
        const tabs = tabsOf(await html(path, { env: on(), cookie }));
        expect(tabs, `${who} ${path}`).toContain(`>Within 6 months ${CHIP_EN}</a>`);
        expect(tabs, `${who} ${path}`).toContain(`>Within 12 months ${CHIP_EN}</a>`);
        expect(tabs, `${who} ${path}`).toMatch(/>Within 3 months<\/a>/);
      }
    }
    const fr = await html("/expiring?lang=fr", { env: on() });
    expect(fr).toContain(`<span class="tile-label">D’ici 6 mois ${CHIP_FR}</span>`);
  });

  it("name the price on the tease panel from the variables, whatever they hold, and leave it out when they do not read", async () => {
    const at = async (vars: Record<string, string>, lang = "en") =>
      /<p class="pro-price">[^<]*<\/p>/.exec(await html(`/expiring/6m?lang=${lang}`, { env: on(vars) }))?.[0] ?? null;
    expect(await at({})).toBe(`<p class="pro-price">Pro is CA$${PRICE[1]} a month or CA$${PRICE[2]} a year, taxes added at checkout.</p>`);
    expect(await at({ PRICE_MONTHLY_CAD: "12.00", PRICE_YEARLY_CAD: "120.50" })).toBe(
      '<p class="pro-price">Pro is CA$12.00 a month or CA$120.50 a year, taxes added at checkout.</p>');
    expect(await at({ PRICE_MONTHLY_CAD: "12.00", PRICE_YEARLY_CAD: "120.50" }, "fr")).toBe(
      '<p class="pro-price">Pro coûte 12,00 $ CA par mois ou 120,50 $ CA par année, taxes ajoutées au paiement.</p>');
    // A figure out of form, or a missing price the checkout would charge: no line, as the billing page offers nothing then.
    expect(await at({ PRICE_YEARLY_CAD: "about 120" })).toBeNull();
    expect(await at({ STRIPE_PRICE_MONTHLY: "" })).toBeNull();
    expect(proPrice({ ...testEnv(radar()), PRICE_MONTHLY_CAD: "" } as never)).toBeNull();
    // The price is never written as a figure in the code's strings.
    for (const key of ["pro.price"] as Key[]) expect(rawEntry(key).en + rawEntry(key).fr).not.toMatch(/[0-9]/);
  });

  it("lists what Pro includes, bug reports among it, each line a Pro feature", () => {
    expect(PRO_INCLUDES.map(([f]) => f)).toEqual(["radar_depth", "radar_depth", "intraday", "delivery", "bug_reports"]);
  });
});

describe("the links to the 12-month list", () => {
  it("carry the chip on profiles and buyer pages while the switch is on, and nothing while it is off", async () => {
    const profiles = clone(FILES["profiles/a00.json"]) as Record<string, any>;
    profiles["org-a000000001"].expiring.n = 30;
    const assets = radar({ "profiles/a00.json": profiles });
    const onPage = await html("/organizations/org-a000000001", { env: on({ ASSETS: assets }) });
    expect(onPage).toContain(`The other 29 are in <a href="/expiring/12m">the 12-month list ${CHIP_EN}</a>.`);
    const fr = await html("/organizations/org-a000000001?lang=fr", { env: on({ ASSETS: assets }) });
    expect(fr).toContain(`Les 29 autres se trouvent dans <a href="/expiring/12m">la liste de 12 mois ${CHIP_FR}</a>.`);
    const off = await html("/organizations/org-a000000001", { env: testEnv(assets) });
    expect(off).toContain('The other 29 are in <a href="/expiring/12m">the 12-month list</a>.');
    const buyer = await html("/buyers/pwgsc-tpsgc", { env: on() });
    expect(buyer).toContain(`<a href="/expiring/12m?buyer=pwgsc-tpsgc">This buyer's contracts in the 12-month list ${CHIP_EN}</a>`.replace("'", "&#39;"));
    const buyerFr = await html("/buyers/pwgsc-tpsgc?lang=fr", { env: on() });
    expect(buyerFr).toContain(`Les contrats de cet acheteur dans la liste de 12 mois ${CHIP_FR}</a>`);
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
      ? `<p class="pro-note">${CHIP_EN} <a href="/tenders/same-day">Same-day notices</a>: the notices CanadaBuys posts during the day show above this list, read every two hours.</p>`
      : `<p class="pro-note">${CHIP_FR} <a href="/tenders/same-day">Avis du jour</a> : les avis publiés sur AchatsCanada pendant la journée paraissent au-dessus de cette liste, lus toutes les deux heures.</p>`;
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
      const res = await get("/tenders/same-day", { env: on({ SEARCH: db }), cookie });
      expect(res.status, who).toBe(200);
      expect(res.headers.get("cache-control"), who).toBe(cookie ? "private, no-store" : "public, max-age=300");
      expect(res.headers.get("vary"), who).toBe("Cookie");
      const page = decode(nbsp(await res.text()));
      expect(used, who).toEqual([]);
      expect(page).toContain("<h1>Same-day Tender Notices</h1>");
      expect(page).toContain('<p class="lead">The notices CanadaBuys posts after the morning refresh, read every two hours through the Ottawa business day.</p>');
      expect(page).toContain('<a href="/tenders">Open tender notices</a>');
      expect(page).not.toContain('<meta name="robots" content="noindex');
      const panel = /<section class="panel pro-panel">[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
      expect(panel).toContain(`<h2>Part of Pro</h2><div class="panel-tools">${CHIP_EN}</div>`);
      expect(panel).toContain("<p>With Pro, this page lists them as they are read, and the same notices show above the tender lists until the next morning's refresh adds them there.</p>");
      expect(panel).toContain("<li>same-day tender notices on the tender lists, read from CanadaBuys every two hours</li>");
      expect(panel).toContain('<p>The <a href="/tenders">list of open notices</a>, the <a href="/tenders/new">new notices by day</a> and their feeds stay free, refreshed every morning.</p>');
      expect(panel).toContain(`<p class="pro-price">Pro is CA$${PRICE[1]} a month or CA$${PRICE[2]} a year, taxes added at checkout.</p>`);
      // A reader not signed in also gets the Pro page (pages/pro.tsx), as a second button.
      expect(panel.match(/class="btn/g), who).toHaveLength(cookie ? 1 : 2);
      expect(panel).toContain(cookie ? '<a href="/account" class="btn btn-primary">Your account</a>'
        : '<a href="/account/sign-in" class="btn btn-primary">Sign in or create an account</a> <a href="/pro" class="btn">About Pro</a>');
      expect(page).not.toContain("intraday");
    }
    const fr = decode(await html("/tenders/same-day?lang=fr", { env: on() }));
    expect(fr).toContain("<h1>Avis d’appel d’offres du jour</h1>");
    expect(fr).toContain(`<h2>Offert avec le forfait Pro</h2><div class="panel-tools">${CHIP_FR}</div>`);
    expect(fr).toContain("La <a href=\"/tenders\">liste des avis ouverts</a>, les <a href=\"/tenders/new\">nouveaux avis par jour</a> et leurs fils restent gratuits, mis à jour chaque matin.");
    expect(fr).toContain(`Pro coûte ${PRICE[1].replace(".", ",")} $ CA par mois`);
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
      expect(r, who).toContain(`one row each, listed once across sources ${CHIP_EN}<br/><span class="muted small">Part of Pro. The 3-month file is free.</span>`);
    }
    const pro = row(await html("/data", { env: on(), cookie: proCookie }));
    expect(pro).toContain('<a href="/downloads/expiring-12m.csv" class="mono">expiring-12m.csv</a>');
    expect(chips(pro)).toBe(1);
    const fr = row(await html("/data?lang=fr", { env: on() }));
    expect(fr).toContain(`${CHIP_FR}<br/><span class="muted small">Fait partie de Pro. Le fichier de 3 mois est gratuit.</span>`);
    // The file's own address still answers 404 to such a request.
    expect((await get("/downloads/expiring-12m.csv", { env: on() })).status).toBe(404);
    // Exactly two chips on the page outside the rail: the file's row and the line on keys.
    expect(chips(mainOf(await html("/data", { env: on() })))).toBe(2);
  });

  it("says in one line, with the chip, that API keys come with Pro", async () => {
    const en = decode(await html("/data", { env: on() }));
    expect(en).toContain(`<p class="pro-note">${CHIP_EN} <a href="/account/keys">API keys</a> come with Pro and open the keyed API below.</p>`);
    expect(en.indexOf("API keys</a> come with Pro")).toBeGreaterThan(en.indexOf("Each address may make 60 API requests a minute."));
    const fr = decode(await html("/data?lang=fr", { env: on() }));
    expect(fr).toContain(`<p class="pro-note">${CHIP_FR} Les <a href="/account/keys">clés d’API</a> sont offertes avec le forfait Pro et ouvrent l’API avec clé ci-dessous.</p>`);
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
    expect(en).toContain(`<p class="pro-note">${CHIP_EN} Delivery is part of Pro. <a href="/account/sign-in">Sign in</a> with this address to start it.</p>`);
    const fr = decode(nbsp(await (await choose("fr", newEmail("lists-pro-fr"), on())).text()));
    expect(fr).toContain(`<p class="pro-note">${CHIP_FR} L’envoi fait partie de Pro. <a href="/account/sign-in">Connectez-vous</a> avec cette adresse pour le lancer.</p>`);
    // The script's answer, the block alone, carries it too.
    const fragment = await choose("en", newEmail("lists-frag"), on(), { "x-interest-fragment": "1" });
    expect(fragment.headers.get("x-interest-fragment")).toBe("1");
    expect(decode(await fragment.text())).toContain(`<p class="pro-note">${CHIP_EN} Delivery is part of Pro.`);
    // Switch off: nothing to sign in to, so no line.
    expect(await (await choose("en", newEmail("lists-off"), testEnv(radar()))).text()).not.toContain("pro-note");
  });

  it("marks the section on what Pro delivers, the only chip in the page's body", async () => {
    const en = await html("/alerts", { env: on() });
    expect(en).toContain(`<h2 id="cover">What Pro Delivers ${CHIP_EN}</h2>`);
    expect(chips(mainOf(en))).toBe(1);
    expect(await html("/alerts?lang=fr", { env: on() })).toContain(`<h2 id="cover">Ce que Pro envoie ${CHIP_FR}</h2>`);
  });
});

// -- the account --------------------------------------------------------------------------------

describe("a Free account", () => {
  it("sees API keys and Report a bug on its overview with the chip; a Pro account sees them without", async () => {
    await sessions();
    const free = decode(await html("/account", { cookie: freeCookie }));
    expect(free).toContain(`<a href="/account/keys">API keys ${CHIP_EN}</a>`);
    expect(free).toContain(`<dd><a href="/account/bug">Report a bug ${CHIP_EN}</a></dd>`);
    const fr = decode(await html("/account?lang=fr", { cookie: freeCookie }));
    expect(fr).toContain(`<a href="/account/keys">Clés d’API ${CHIP_FR}</a>`);
    const pro = decode(await html("/account", { cookie: proCookie }));
    expect(pro).toContain('<a href="/account/keys">API keys</a>');
    expect(chips(mainOf(pro))).toBe(0);
  });

  it("gets gate notes on its searches: the cap at the panel's foot and delivery in each row", async () => {
    const email = newEmail("mark-searches");
    const cookie = await signIn(email);
    const token = await csrf(cookie, "/account/searches");
    for (const url of ["/tenders?segment=82", "/expiring", "/segments/82"]) await post("/account/searches", { csrf: token, url }, { cookie });
    const page = decode(await html("/account/searches", { cookie }));
    expect(page).toContain(`<div class="panel-foot"><p class="pro-note">${CHIP_EN} This account holds 3 of 3 saved searches. Pro holds up to 25 and sends them by email, daily or weekly. <a href="/account/billing">Plans and prices</a></p></div>`);
    // The tender list is a kind the delivery job serves: its delivery reads Off in a note, no select.
    expect(page).toContain(`<p class="pro-note">${CHIP_EN} Off. Email delivery is part of Pro. <a href="/account/billing">Plans and prices</a></p>`);
    expect(page).not.toContain('<select name="deliver"');
    const fr = decode(await html("/account/searches?lang=fr", { cookie }));
    expect(fr).toContain(`${CHIP_FR} Recherches enregistrées de ce compte : 3 sur 3. Pro en conserve jusqu’à 25 et les envoie par courriel, chaque jour ou chaque semaine.`);
    expect(fr).toContain(`${CHIP_FR} Désactivé. L’envoi par courriel fait partie de Pro.`);
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
    expect(bug).toContain(`<p class="pro-price">Pro is CA$${PRICE[1]} a month or CA$${PRICE[2]} a year, taxes added at checkout.</p>`);
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
