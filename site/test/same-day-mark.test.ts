// The same-day mark (SameDayMark and SameDayLegend in src/pro.tsx): the bolt
// before the title of each notice the day's same-day refresh brought, on the
// band's rows on /tenders and /tenders/new and on the same notices in the
// day's list under the band, and nowhere else; the words assistive
// technology reads in its place; the legend at the band's foot, on every view
// of /tenders/same-day and among the Methodology page's sources.
//
// The drift guards come first (the stylesheet holds to the tokens, the path
// is the bolt the operator chose), then the placements for a Pro reader in
// both languages, then their absence for every other reader.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { allKeys, rawEntry, type Key } from "../src/i18n";
import { STYLES_VERSION } from "../src/layout";
import { SAME_DAY_GLYPH_PATH } from "../src/pro";
import { decode, get, grantPro, nbsp, newEmail, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import { applySql } from "./setup";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const INTRADAY_SCHEMA = (env as unknown as { INTRADAY_SCHEMA_SQL: string }).INTRADAY_SCHEMA_SQL;

// The bolt the operator chose (option B on the row-mark sheet), written out
// here rather than imported, so a change to the path fails this file.
const BOLT = "M9.2 1 3 9.2h4.4L6.8 15 13 6.8H8.6z";
const mark = (words: string) =>
  `<span class="same-day-mark"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="${BOLT}"></path></svg>` +
  `<span class="visually-hidden">${words}</span></span>`;
const MARK = { en: mark("Same-day notice"), fr: mark("Avis du jour") };
const LEGEND = {
  en: "A bolt marks a notice from today's same-day refresh, part of Pro.",
  fr: "Un éclair marque un avis de l’actualisation du jour, offerte avec Pro.",
};
const footOf = (lang: Lang) => `<div class="panel-foot"><span>${LEGEND[lang]}</span></div>`;
const NOTICE_URL = { en: "https://canadabuys.canada.ca/en/", fr: "https://achatscanada.canada.ca/fr/" };
const LANGS = ["en", "fr"] as const;
type Lang = (typeof LANGS)[number];

const marks = (html: string) => (html.match(/<span class="same-day-mark">/g) ?? []).length;
const count = (html: string, s: string) => html.split(s).length - 1;
const mainOf = (html: string) => /<main id="main">[\s\S]*?<\/main>/.exec(html)?.[0] ?? "";
const bandOf = (html: string) => /<section class="panel intraday">[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
const bodyRows = (html: string) => (/<tbody>[\s\S]*?<\/tbody>/.exec(html)?.[0] ?? "").match(/<tr[ >][\s\S]*?<\/tr>/g) ?? [];
const rowFor = (html: string, href: string) => bodyRows(html).find((r) => r.includes(`href="${href}"`)) ?? "";

// The day's list with a second notice the band does not hold, so the row the
// mark must skip sits beside the one it marks.
const DAY = FILES["tenders/new/2026-10-31.json"] as Record<string, unknown>[];
const OTHER = { ...DAY[0], reference: "cb-300-30000009", title_en: "Wharf fender replacement", title_fr: "Remplacement des défenses du quai" };
const ASSETS = makeFakeAssets({}, { "tenders/new/2026-10-31.json": [...DAY, OTHER] });
const on = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS, ...extra });
const page = async (path: string, o: { env?: object; cookie?: string } = {}) =>
  nbsp(decode(await (await get(path, { env: o.env ?? on(), cookie: o.cookie })).text()));

// Three versions read since the data date: a notice neither of the nightly's
// lists holds (new); a later amendment of cb-200-20005019, which the day's
// list holds at 0; and a later amendment of cb-100-10000001, which only the
// open list holds (at 1). The band shows all three; the day's list holds the
// second as well.
const DATA_DATE = "2026-10-31";
const SEED: [string, number, string, string, string][] = [
  ["cb-950-95000001", 0, "15:45:10", "Same-day harbour dredging", "Dragage du port du jour"],
  ["cb-200-20005019", 1, "13:45:05", "Hull inspection and repair, amended", "Inspection et réparation de coques, modifié"],
  ["cb-100-10000001", 2, "11:45:00", "Translation services, amended", "Services de traduction, modifié"],
];
async function seed(): Promise<void> {
  await applySql(SEARCH, INTRADAY_SCHEMA);
  await SEARCH.prepare("DELETE FROM intraday_tenders").run();
  const sql =
    "INSERT INTO intraday_tenders (reference, amendment, seen_at, published, closing, title_en, title_fr, buyer_id, buyer_name, " +
    "buyer_name_fr, category, segments, provinces, codes) VALUES (?, ?, ?, ?, '2026-11-20T14:00:00', ?, ?, NULL, 'Some Harbour Office', " +
    "NULL, '[]', '[]', '[\"NS\"]', '[]')";
  await SEARCH.batch(SEED.map(([ref, amendment, time, en, fr]) =>
    SEARCH.prepare(sql).bind(ref, amendment, `${DATA_DATE}T${time}Z`, DATA_DATE, en, fr)));
}

let freeCookie = "";
let proCookie = "";
async function sessions(): Promise<void> {
  if (proCookie) return;
  freeCookie = await signIn(newEmail("bolt-free"));
  const pro = newEmail("bolt-pro");
  proCookie = await signIn(pro);
  await grantPro(pro);
}

// -- the stylesheet and the glyph ------------------------------------------------------------

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

describe("the mark's stylesheet", () => {
  it("fills the bolt in the accent through currentColor, 4 px before the title", () => {
    const [rule] = rulesFor("same-day-mark").filter((r) => r.selector === ".same-day-mark");
    expect(rule).toBeDefined();
    expect(decl(rule.body, "color")).toBe("var(--accent)");
    expect(decl(rule.body, "fill")).toBe("currentColor");
    expect(decl(rule.body, "margin-right")).toBe("4px");
    // The title after the mark keeps the weight the notice cell gives its first link.
    const [title] = rulesFor("same-day-mark").filter((r) => r.selector === ".same-day-mark + a");
    expect(decl(title.body, "font-weight")).toBe(decl(rulesFor("c-notice").find((r) => r.selector === "td.c-notice a:first-child")!.body, "font-weight"));
  });

  it("names only the accent token, with no colour of its own, no corner, shadow, state or dark rule", () => {
    const rules = rulesFor("same-day-mark");
    expect(rules.length).toBe(2);
    for (const { selector, body } of rules) {
      expect(body, selector).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      for (const v of body.match(/var\(--[a-z0-9-]+\)/g) ?? []) expect(v, selector).toBe("var(--accent)");
      expect(body, selector).not.toMatch(/border-radius|box-shadow|border\s*:/);
      expect(selector, "no hover or focus of its own").not.toMatch(/:(hover|focus|active)/);
      expect(selector, "the bolt is markup, not a pseudo-element").not.toMatch(/::?(before|after)/);
      expect(selector, "the token swaps with the theme, so no theme rule").not.toContain("data-theme");
    }
    // Both themes define the accent, so the bolt follows the mode.
    for (const block of [/:root \{[\s\S]*?\n\}/, /:root\[data-theme="dark"\] \{[\s\S]*?\n\}/]) {
      expect(block.exec(STYLES)?.[0] ?? "").toMatch(/--accent: #[0-9a-f]{6};/);
    }
    expect(STYLES_VERSION).toBeGreaterThanOrEqual(16);
  });

  it("draws the bolt the operator chose", () => {
    expect(SAME_DAY_GLYPH_PATH).toBe(BOLT);
  });
});

// -- a Pro reader --------------------------------------------------------------------------------

describe("a Pro reader", () => {
  it("sees the mark before the title of every row of the band on /tenders, and on no other row, in both languages", async () => {
    await sessions();
    await seed();
    for (const lang of LANGS) {
      const html = await page(`/tenders?lang=${lang}`, { cookie: proCookie });
      const band = bandOf(html);
      const rows = bodyRows(band);
      expect(rows, lang).toHaveLength(SEED.length);
      for (const row of rows) {
        expect(row, lang).toContain(`class="c-notice">${MARK[lang]}<a href="${NOTICE_URL[lang]}`);
        expect(marks(row), lang).toBe(1);
      }
      // The open list under the band holds cb-200 and cb-100 at their earlier amendments, unmarked.
      expect(marks(mainOf(html).replace(band, "")), lang).toBe(0);
      expect(marks(html), lang).toBe(SEED.length);
    }
  });

  it("sees it on /tenders/new on the band's rows and on the day's row of the notice the band amends, and on no other", async () => {
    await sessions();
    await seed();
    for (const lang of LANGS) {
      const html = await page(`/tenders/new?lang=${lang}`, { cookie: proCookie });
      const band = bandOf(html);
      expect(bodyRows(band), lang).toHaveLength(SEED.length);
      for (const row of bodyRows(band)) expect(row, lang).toContain(`class="c-notice">${MARK[lang]}<a href="${NOTICE_URL[lang]}`);
      const list = mainOf(html).replace(band, "");
      expect(rowFor(list, "/tenders/cb-200-20005019"), lang).toContain(`class="c-notice">${MARK[lang]}<a href="/tenders/cb-200-20005019">`);
      expect(rowFor(list, "/tenders/cb-300-30000009"), lang).toContain('class="c-notice"><a href="/tenders/cb-300-30000009">');
      expect(marks(list), lang).toBe(1);
    }
    // An older day has no band, so nothing on it is marked.
    expect(marks(await page("/tenders/new?day=2026-10-30", { cookie: proCookie }))).toBe(0);
  });

  it("reads the legend once, at the band's foot, in the page's language", async () => {
    await sessions();
    await seed();
    for (const lang of LANGS) {
      for (const path of ["/tenders", "/tenders/new", "/tenders/same-day"]) {
        const html = await page(`${path}?lang=${lang}`, { cookie: proCookie });
        expect(bandOf(html), `${path} ${lang}`).toContain(`</div>${footOf(lang)}</section>`);
        expect(count(html, LEGEND[lang]), `${path} ${lang}`).toBe(1);
      }
    }
  });

  it("gets the legend on /tenders/same-day when no notice has been read yet, with no mark", async () => {
    await sessions();
    for (const lang of LANGS) {
      const html = await page(`/tenders/same-day?lang=${lang}`, { env: on({ SEARCH: undefined }), cookie: proCookie });
      expect(html, lang).toContain(`</p>${footOf(lang)}</section>`);
      expect(count(html, LEGEND[lang]), lang).toBe(1);
      expect(marks(html), lang).toBe(0);
    }
  });
});

// -- every other reader ----------------------------------------------------------------------------

describe("a reader without Pro", () => {
  it("gets no mark on any page, and the legend only on /tenders/same-day, under the tease", async () => {
    await sessions();
    await seed();
    for (const [who, cookie] of [["no session", undefined], ["free", freeCookie]] as const) {
      for (const lang of LANGS) {
        for (const path of ["/tenders", "/tenders/new", "/tenders/same-day", "/", "/methodology"]) {
          const html = await page(`${path}?lang=${lang}`, { cookie });
          const at = `${who} ${lang} ${path}`;
          expect(marks(html), at).toBe(0);
          expect(html, at).not.toContain(MARK[lang]);
          if (path === "/tenders/same-day") {
            const tease = /<section class="panel pro-panel">[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
            expect(tease, at).toContain(`</p>${footOf(lang)}</section>`);
            expect(count(html, LEGEND[lang]), at).toBe(1);
          } else {
            expect(html, at).not.toContain(LEGEND[lang]);
          }
        }
      }
    }
  });

  it("gets neither while the accounts switch is off", async () => {
    await seed();
    for (const path of ["/tenders", "/tenders/new", "/tenders?lang=fr", "/tenders/new?lang=fr"]) {
      const html = await page(path, { env: testEnv(ASSETS) });
      expect(marks(html), path).toBe(0);
      expect(html, path).not.toContain(LEGEND.en);
      expect(html, path).not.toContain(LEGEND.fr);
    }
  });
});

// -- the Methodology page and the strings -----------------------------------------------------------

describe("the Methodology page", () => {
  it("lists same-day notices among the sources, after the tender notices, naming the bolt", async () => {
    const en = await page("/methodology", { env: testEnv() });
    const item = "<li>Same-day tender notices, part of Pro: CanadaBuys' file of the day's new notices, read every two hours through the Ottawa business day. They show above the tender lists, each marked with a bolt, until the next morning's refresh adds them there.</li>";
    expect(en).toContain(item);
    expect(en.indexOf(item)).toBeGreaterThan(en.indexOf("<li>CanadaBuys tender notices:"));
    expect(en.indexOf(item)).toBeLessThan(en.indexOf("<li>CanadaBuys award notices:"));
    const fr = await page("/methodology?lang=fr", { env: testEnv() });
    expect(fr).toContain("<li>Avis d’appel d’offres du jour, offerts avec Pro : le fichier des nouveaux avis du jour d’AchatsCanada");
    expect(fr).toContain("chacun marqué d’un éclair");
  });
});

describe("the strings the mark adds", () => {
  const NEW = ["sameday.mark", "sameday.legend", "methodology.src_same_day"] as Key[];

  it("are in both languages, French of their own, with no em-dash", () => {
    for (const key of NEW) {
      expect(allKeys(), key).toContain(key);
      const { en, fr } = rawEntry(key);
      expect(en.trim(), key).not.toBe("");
      expect(fr.trim(), key).not.toBe("");
      expect(fr, key).not.toBe(en);
      expect(en + fr, key).not.toContain(EM_DASH);
    }
  });

  it("leave no English on the French pages that carry them", async () => {
    await sessions();
    await seed();
    for (const cookie of [proCookie, freeCookie]) {
      for (const path of ["/tenders?lang=fr", "/tenders/new?lang=fr", "/tenders/same-day?lang=fr", "/methodology?lang=fr"]) {
        const html = await page(path, { cookie });
        for (const s of ["Same-day notice<", "A bolt marks", "Same-day tender notices, part of Pro"]) expect(html, `${path}: ${s}`).not.toContain(s);
      }
    }
  });
});
