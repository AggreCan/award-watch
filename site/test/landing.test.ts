// The landing page (src/pages/landing.tsx, docs/landing.md): "/" for a reader
// without a signed-in session, the app home for a signed-in one; both
// languages and both switch states; the scrolling band's forty organizations,
// its approved wording and the Brandfetch logos only with a client id; the
// map, the figures and the plan rows from their sources; the search form; the
// head the app home carries; the no-data page; the stylesheet and the fonts.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import wrangler from "../wrangler.jsonc?raw";
import { PROVINCES } from "../src/constants";
import { MAP_LABELS } from "../src/canada_map";
import { t } from "../src/i18n";
import { app } from "../src/index";
import { LANDING_ORGS, LANDING_ORGS_A, LANDING_ORGS_B, brandfetchLogoUrl } from "../src/landing_orgs";
import { DISPLAY_FONT, LANDING_VERSION, ULTRA_GLYPH_PATH, ULTRA_ROWS } from "../src/pages/landing";
import { PLAN_ROWS, planLine, rowFor } from "../src/pro";
import { nbsp, newEmail, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { FILES, assetsWithout, emptyAssets, makeFakeAssets, testEnv } from "./assets";
import { LANDING_SWITCH_PIECES, homeRequest, landingCore } from "./home";
import STATS_MAP from "./fixtures/stats-map.json";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const LANDING_CSS = (env as unknown as { LANDING_CSS: string }).LANDING_CSS;
const PUBLIC_FILES = JSON.parse((env as unknown as { PUBLIC_FILES: string }).PUBLIC_FILES) as { path: string; bytes: number; magic: string }[];
const CLIENT_ID = "test-client-0001";

const stats = FILES["stats.json"] as Record<string, any>;
const withMap = (extra: Record<string, unknown> = {}) => makeFakeAssets({}, { "stats.json": { ...stats, map: STATS_MAP }, ...extra });

let address = 0;
const request = (path: string, env: object, cookie?: string) => {
  const headers: Record<string, string> = { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.60.${(address++ % 250) + 1}` };
  if (cookie) headers.cookie = cookie;
  return app.request(path, { headers }, env);
};
const html = async (path: string, env: object, cookie?: string) => (await request(path, env, cookie)).text();
const off = (extra: Record<string, unknown> = {}) => ({ ...testEnv(withMap()), ...extra });
const on = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS: withMap(), ...extra });
// The switch on with the payment service's two secrets, so the Pro card names the price.
const paid = (extra: Record<string, unknown> = {}) => on({ STRIPE_SECRET_KEY: "sk_test_fake0000", STRIPE_WEBHOOK_SECRET: "whsec_fake0000", ...extra });
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const textOf = (s: string) => decode(s.replace(/<[^>]+>/g, ""));
const section = (page: string, cls: string) => new RegExp(`<section class="${cls}"[\\s\\S]*?</section>`).exec(page)?.[0] ?? "";
const PRICE = /"PRICE_MONTHLY_CAD":\s*"([0-9.]+)"[\s\S]*?"PRICE_YEARLY_CAD":\s*"([0-9.]+)"/.exec(wrangler) ?? ["", "", ""];

describe("the route", () => {
  it("serves the landing page to a reader without a session, in English and in French", async () => {
    for (const env of [off(), on()]) {
      const en = await request("/", env);
      expect(en.status).toBe(200);
      const page = await en.text();
      expect(page).toContain('<html lang="en">');
      expect(page).toContain('<body class="lp">');
      expect(page).toContain('<h1 id="lp-h1">Find your next federal tender.<br/>See who won <em>the last one.</em></h1>');
      expect(page).toContain(`<link rel="stylesheet" href="/landing.css?v=${LANDING_VERSION}"/>`);
      // A document of its own: no rail, no top bar, no Console stylesheet.
      expect(page).not.toContain('<nav class="rail"');
      expect(page).not.toContain("/styles.css");
      const fr = nbsp(await html("/?lang=fr", env));
      expect(fr).toContain('<html lang="fr">');
      expect(fr).toContain("Trouvez votre prochain appel d’offres fédéral.");
      expect(fr).toContain("Nous avons les dossiers des entreprises qui remportent les plus gros contrats fédéraux");
      expect(fr).not.toContain("Find your next federal tender");
    }
  });

  it("gives a signed-in reader the app home at the same address, kept apart by Vary: Cookie", async () => {
    const cookie = await signIn(newEmail("landing"));
    const home = await request("/", on(), cookie);
    expect(home.status).toBe(200);
    const page = await home.text();
    expect(page).toContain("<h1>Federal Tenders, Who Won, and Contracts Ending</h1>");
    expect(page).toContain('<nav class="rail"');
    expect(page).not.toContain('<body class="lp">');
    expect(home.headers.get("cache-control")).toBe("private, no-store");
    expect(home.headers.get("vary")).toContain("Cookie");
    // The landing page, cacheable, answers the same address without a session or with one that does not stand.
    for (const c of [undefined, "__Host-aw_session=" + "a".repeat(32) + "." + "b".repeat(64)]) {
      const res = await request("/", on(), c);
      expect(await res.text(), String(c)).toContain('<body class="lp">');
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
      expect(res.headers.get("vary")).toContain("Cookie");
    }
    // With the switch off nothing is read and nothing varies: the landing page for everyone.
    const offRes = await request("/", off(), cookie);
    expect(await offRes.text()).toContain('<body class="lp">');
    expect(offRes.headers.get("vary")).toBeNull();
  });

  it("reads stats.json, the expiring index, the 3-month window's first page and one profile, and no database", async () => {
    const paths: string[] = [];
    const base = withMap();
    const recording = { fetch: (input: Request) => (paths.push(new URL(input.url).pathname), base.fetch(input)) } as unknown as Fetcher;
    const trap = new Proxy({}, { get: () => { throw new Error("a database was read"); } }) as unknown as D1Database;
    const res = await request("/", on({ ASSETS: recording, ACCOUNTS: trap, SEARCH: trap, RECORDS: trap, DB: trap }));
    expect(res.status).toBe(200);
    expect([...new Set(paths)].sort()).toEqual(["/data/expiring/3m/1.json", "/data/expiring/index.json", "/data/profiles/a00.json", "/data/stats.json"]);
  });

  it("answers the no-data page without stats.json, as the app home does, and stands without any other file", async () => {
    for (const [path, words] of [["/", "Data Not Published Yet"], ["/?lang=fr", "Données pas encore publiées"]]) {
      const res = await request(path, off({ ASSETS: emptyAssets }));
      expect(res.status, path).toBe(503);
      expect(await res.text(), path).toContain(words);
    }
    const bare = await request("/", on({ ASSETS: assetsWithout("expiring/index.json", "expiring/3m/1.json", "profiles/a00.json") }));
    expect(bare.status).toBe(200);
    const page = await bare.text();
    expect(page).toContain('<h2 id="lp-f2">See who won, and what&#39;s about to end</h2>');
    expect(page).not.toContain("Ending within 3 months");
    expect(page).not.toContain('class="lp-profile"');
    // The award notices' shot still stands beside it.
    expect(page).toContain("Awarded, last 30 days");
    // A stats.json without a map: the hero without its map card.
    const noMap = await html("/", testEnv());
    expect(noMap).toContain('<section class="lp-hero lp-hero-solo"');
    expect(noMap).not.toContain("lp-mapcard");
    // A stats.json whose parts do not read is repaired as for every page; one of the wrong shape is the no-data page.
    const partial = JSON.stringify({ data_as_of: "2026-10-31", counts: { awards: "many", tenders_open: 3 }, new_tenders: "x", closing_soon: [{ reference: 1 }] });
    const repaired = await request("/", off({ ASSETS: makeFakeAssets({}, { "stats.json": partial }) }));
    expect(repaired.status).toBe(200);
    expect(await repaired.text()).toContain("Browse 3 open tenders");
    expect((await request("/", off({ ASSETS: makeFakeAssets({}, { "stats.json": '{"counts":[]}' }) }))).status).toBe(503);
  });

  it("carries the app home's head: title, description, canonical, alternates, social card and structured data", async () => {
    const tags = (page: string) => {
      const head = /<head>[\s\S]*?<\/head>/.exec(page)?.[0] ?? "";
      return [
        /<title>[^<]*<\/title>/.exec(head)?.[0],
        ...(head.match(/<meta (?:name|property)="[^"]*" content="[^"]*"\/>/g) ?? []),
        ...(head.match(/<link rel="(?:canonical|alternate)"[^>]*\/>/g) ?? []),
        ...(head.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) ?? []),
      ];
    };
    for (const path of ["/", "/?lang=fr"]) {
      const landing = tags(await html(path, on()));
      const home = tags(await (await homeRequest(path, { headers: { "sec-fetch-mode": "navigate" } }, on())).text());
      expect(landing, path).toEqual(home);
      expect(landing.some((x) => x?.startsWith('<link rel="canonical" href="https://awardwatch.ca/'))).toBe(true);
      expect(landing.some((x) => x?.includes('"@type":"WebSite"'))).toBe(true);
    }
  });

  it("sets the policy that names Brandfetch's image host, and the referrer rule its terms allow", async () => {
    for (const path of ["/", "/tenders", "/about"]) {
      const res = await request(path, off());
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp, path).toContain("img-src 'self' data: https://cdn.brandfetch.io");
      expect(csp, path).toContain("script-src 'self'");
      expect(res.headers.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
    }
  });
});

describe("the scrolling band", () => {
  const band = async (env: object, path = "/") => section(await html(path, env), "lp-band");

  it("links the forty organizations to their profiles, once each for the tab order, with the copy hidden", async () => {
    expect(LANDING_ORGS).toHaveLength(40);
    expect(LANDING_ORGS_A).toHaveLength(20);
    expect(LANDING_ORGS_B).toHaveLength(20);
    expect(new Set(LANDING_ORGS.map((o) => o.id)).size).toBe(40);
    for (const o of LANDING_ORGS) {
      expect(o.id).toMatch(/^org-[0-9a-f]{10}$/);
      expect(o.domain).toMatch(/^[a-z0-9.-]+\.[a-z]+$/);
    }
    expect(LANDING_ORGS.find((o) => o.name === "General Dynamics")?.domain).toBe("gd.com");
    const b = await band(on());
    // The links outside the hidden copies: forty, in the band's order.
    const shown = b.replace(/<span class="lp-dup" aria-hidden="true">[\s\S]*?<\/span>(?=<\/div><\/div>)/g, "");
    const hrefs = [...shown.matchAll(/<a class="lp-mark[^"]*" href="([^"]+)">/g)].map((m) => m[1]);
    expect(hrefs).toEqual(LANDING_ORGS.map((o) => `/organizations/${o.id}`));
    // The copies that let the scroll loop: out of the tab order, hidden from assistive technology.
    const copies = [...b.matchAll(/<span class="lp-dup" aria-hidden="true">([\s\S]*?)<\/span>(?=<\/div><\/div>)/g)].map((m) => m[1]);
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy.match(/<a /g)).toHaveLength(20);
      expect(copy.match(/tabindex="-1"/g)).toHaveLength(20);
    }
    for (const o of LANDING_ORGS) expect(textOf(b)).toContain(o.name);
  });

  it("says, word for word, that the site holds records on them and implies no endorsement", async () => {
    const b = await band(off());
    expect(b).toContain('<h2 id="lp-band-h">We have the records on the companies winning the biggest federal contracts</h2>');
    expect(b).toContain('<p class="lp-sub">Click one for its awards, contracts, grants and lobbying, year by year.</p>');
    expect(b).toContain('<p class="lp-band-foot">Forty of the largest award holders in the public records. Names and logos belong to their owners and appear here because the records cover these organizations. No endorsement is implied.</p>');
    for (const page of [b, await band(off(), "/?lang=fr"), await band(on({ BRANDFETCH_CLIENT_ID: CLIENT_ID }))]) {
      expect(page).not.toMatch(/trust|used by|our (?:customers|clients|partners)|partenaires|nos clients|font confiance/i);
    }
  });

  it("shows each organization's logo from Brandfetch only while the Worker has a client id", async () => {
    for (const env of [off(), on(), on({ BRANDFETCH_CLIENT_ID: "" })]) {
      const page = await html("/", env);
      expect(page).not.toContain("<img");
      expect(page).not.toContain("brandfetch");
    }
    const page = await html("/", on({ BRANDFETCH_CLIENT_ID: CLIENT_ID }));
    const imgs = page.match(/<img [^>]*>/g) ?? [];
    // Each logo in the band and in its hidden copy.
    expect(imgs).toHaveLength(80);
    for (const o of LANDING_ORGS) {
      const url = `https://cdn.brandfetch.io/domain/${o.domain}/w/80/h/80/fallback/lettermark?c=${CLIENT_ID}`;
      expect(brandfetchLogoUrl(o.domain, CLIENT_ID)).toBe(url);
      expect(page).toContain(`<img class="lp-logo" src="${url}" width="40" height="40" alt="" loading="lazy"/>${o.name}</a>`);
    }
    // The privacy page says so while the logos show, and not otherwise.
    expect(await html("/privacy", on({ BRANDFETCH_CLIENT_ID: CLIENT_ID }))).toContain("logos from Brandfetch&#39;s logo service");
    expect(await html("/privacy", on())).not.toContain("Brandfetch");
  });
});

describe("the hero, the figures and the shots", () => {
  it("fills the map from stats.json's open notices, the counts as labels, with the not-stated line", async () => {
    for (const lang of ["en", "fr"] as const) {
      const page = nbsp(await html(lang === "fr" ? "/?lang=fr" : "/", off()));
      const card = /<div class="lp-mapcard">[\s\S]*?<\/ul><\/div>/.exec(page)?.[0] ?? "";
      expect(card).toContain(lang === "fr" ? "854 appels d’offres ouverts" : "854 open tenders");
      for (const p of PROVINCES) {
        const { x, y } = MAP_LABELS[p];
        const n = STATS_MAP.open.provinces[p as keyof typeof STATS_MAP.open.provinces];
        expect(card, p).toMatch(new RegExp(`<text class="lb t\\d" x="${x}" y="${y - 2}">${p}</text><text class="ln t\\d" x="${x}" y="${y + 22}">${n}</text>`));
      }
      expect(card).toContain(lang === "fr" ? "Tout le Canada ou non indiqué : 300" : "Canada-wide or not stated: 300");
      // Ontario, the most, takes the brightest step; the steps start at nothing.
      expect(card).toMatch(/<text class="ln t4" x="543" y="704">260<\/text>/);
      expect(card).toContain('<li><i class="s0"></i>0</li>');
    }
  });

  // The nightly's smoke test (pipeline resilience.DATED_PAGES) checks that "/" shows tonight's data date.
  it("prints the data date on every form of the page, as the nightly's smoke test looks for it", async () => {
    const counts = { ...stats.counts };
    delete counts.awards;
    const bare = makeFakeAssets({}, { "stats.json": { ...stats, counts } });
    for (const env of [off(), on(), off({ ASSETS: bare }), on({ ASSETS: assetsWithout("expiring/index.json", "profiles/a00.json") })]) {
      for (const path of ["/", "/?lang=fr"]) {
        expect(await html(path, env), path).toContain(`${path === "/" ? "Counted on" : "Comptés le"} ${stats.data_as_of}.`);
      }
    }
  });

  it("states the figures stats.json counts, short from a million up with the exact count as the title", async () => {
    const plain = nbsp(section(await html("/", off()), "lp-stats"));
    expect(plain).toContain('<b class="num">101</b><span>published contracts</span>');
    expect(plain).toContain('<b class="num">1</b><span>grants and contributions</span>');
    expect(plain).toContain('<b class="num">2</b><span>organizations, each with a page</span>');
    // The fixture has no year total: no money figure, never a guess.
    expect(plain).not.toContain("awarded this year");
    // The registry is not read in the fixture, so the line leaves lobbying out.
    expect(plain).toContain("Counted on 2026-10-31. Plus 5,883 award notices and 3 federal buyers.");
    const big = { ...stats, counts: { ...stats.counts, contracts: 1336126, grants: 1071841, organizations: 328804, awards_year: 5668, lobbying: 388062 },
      totals: { ...stats.totals, awards_year: 23341776690.67 }, sources: [...stats.sources, { source: "lobbying", file: "x.csv", last_read: "2026-10-31", last_modified: null, loaded: true }] };
    const assets = makeFakeAssets({}, { "stats.json": big });
    const en = section(await html("/", off({ ASSETS: assets })), "lp-stats");
    expect(en).toContain('<b class="num" title="1,336,126">1.34M</b><span>published contracts</span>');
    expect(en).toContain('<b class="num" title="1,071,841">1.07M</b><span>grants and contributions</span>');
    expect(en).toContain('<b class="num">328,804</b><span>organizations, each with a page</span>');
    expect(en).toContain('<b class="num" title="$23,341,776,691">$23.3B</b><span>awarded this year, in 5,668 notices</span>');
    expect(en).toContain("Counted on 2026-10-31. Plus 5,883 award notices, 388,062 lobbying records and 3 federal buyers.");
    const fr = nbsp(section(await html("/?lang=fr", off({ ASSETS: assets })), "lp-stats"));
    expect(fr).toContain('<b class="num" title="1 336 126">1,34 M</b><span>contrats publiés</span>');
    expect(fr).toContain('<b class="num" title="23 341 776 691 $">23,3 G$</b><span>attribués cette année, en 5 668 avis</span>');
  });

  it("builds the shots from the live rows: the day's notices, the newest awards, the contracts ending soonest, the year's largest holder", async () => {
    const page = decode(await html("/", on()));
    expect(page).toContain('<span>New today</span><span class="lp-n num">1</span>');
    expect(page).toContain('<span class="lp-ti">Hull inspection and repair, coastal patrol vessels</span>');
    expect(page).toContain('<span>Awarded, last 30 days</span><span class="lp-n num">2</span>');
    expect(page).toContain('<span class="lp-ti">Exemplar Translation Services Inc.</span><span class="lp-rt">$250,000</span>');
    // The 3-month window's count, and its rows soonest first: 20 days, then 45 (a supplier withheld).
    expect(page).toContain('<span>Ending within 3 months</span><span class="lp-n num">3</span>');
    const ending = /<span>Ending within 3 months<\/span>[\s\S]*?<\/div><\/div>(?=<\/div>)/.exec(page)?.[0] ?? "";
    expect([...ending.matchAll(/<span class="lp-rt[^"]*">([^<]*)</g)].map((m) => m[1])).toEqual(["20 days left", "45 days left", "81 days left"]);
    // The profile of stats.json's first organization of the year, with the other names its records carry.
    expect(page).toContain(`<div class="lp-nm"><a href="/organizations/${(FILES["stats.json"] as any).top_organizations_year[0].id}">Exemplar Translation Services Inc.</a></div>`);
    expect(page).toContain('<p class="lp-al">Also recorded as: EXEMPLAR TRANSLATION SERVICES INC</p>');
    expect(page).toContain("<span>Published contracts</span><b class=\"num\">$1.9M</b><small>101 records</small>");
  });

  it("searches by GET at /search, the field worded as the site's search", async () => {
    for (const lang of ["en", "fr"] as const) {
      const page = await html(lang === "fr" ? "/?lang=fr" : "/", off());
      const form = /<form class="lp-search"[\s\S]*?<\/form>/.exec(page)?.[0] ?? "";
      expect(form).toContain('<form class="lp-search" method="get" action="/search" role="search">');
      expect(form).toContain('<input type="search" name="q" maxlength="200" autocomplete="off"');
      expect(decode(form)).toContain(`placeholder="${t(lang, "search.placeholder")}"`);
      expect(decode(form)).toContain(`aria-label="${t(lang, "search.label")}"`);
      expect(form).toContain(`<button type="submit" class="lp-btn">${t(lang, "search.submit")}</button>`);
    }
  });

  it("carries the theme switch the app pages use, and the language switch", async () => {
    const page = await html("/", off());
    expect(page).toContain('<script src="/theme.js"></script>');
    expect(page).toContain('<button type="button" class="theme-toggle"><span class="when-light">Dark</span><span class="when-dark">Light</span></button>');
    expect(page).toContain('<a href="?lang=fr" class="lang-toggle" rel="nofollow">Français</a>');
    expect(await html("/?lang=fr", off())).toContain('<a href="?lang=en" class="lang-toggle" rel="nofollow">English</a>');
  });
});

describe("the two switch states", () => {
  it("with the switch off: no plan cards, chip, price, Pro line, sign-in or link to Pro or Analytics, in either language", async () => {
    for (const path of ["/", "/?lang=fr"]) {
      const page = await html(path, off({ BRANDFETCH_CLIENT_ID: CLIENT_ID }));
      for (const word of ["lp-pricing", "pro-tag", "ultra-tag", "class=\"lp-pro\"", "lp-on", "lp-note-account", "lp-watch", "/account", 'href="/pro"', 'href="/analytics"', "CA$", "$ CA", "Ultra"]) {
        expect(page, `${path} ${word}`).not.toContain(word);
      }
      for (const piece of LANDING_SWITCH_PIECES.filter((p) => p.onOnly)) expect(page.match(piece.re), `${path} ${piece.what}`).toBeNull();
      // Track tenders free leads to the Atom feeds, three times.
      expect(page.match(/<a class="[^"]*" href="\/feeds">/g), path).toHaveLength(3);
    }
  });

  it("with the switch on: the three plan cards, the Pro lines, the sign-in and the Pro and Analytics links, and nothing else", async () => {
    for (const path of ["/", "/?lang=fr"]) {
      const a = await html(path, on());
      const b = await html(path, off());
      for (const piece of LANDING_SWITCH_PIECES.filter((p) => p.onOnly)) expect(a.match(piece.re), `${path} ${piece.what}`).not.toBeNull();
      expect(landingCore(a), path).toBe(landingCore(b));
    }
    const page = await html("/", on());
    expect(page).toContain('<a class="lp-on" href="/analytics">Analytics</a>');
    expect(page).toContain('<a class="lp-on" href="/pro">Pro</a>');
    expect(page).toContain('<a class="lp-btn lp-btn-sm lp-on" href="/account/sign-in">Sign in</a>');
    expect(page).toContain('<a class="lp-btn lp-on" href="/pro">See Pro plans</a>');
    expect(page).toContain('<p class="lp-pro">Pro sees new notices within 2 hours of posting.</p>');
    expect(page).toContain('<p class="lp-pro">Pro opens the 6- and 12-month lists and the CSV.</p>');
    expect(page).toContain('<p class="lp-pro">Pro charts 10 fiscal years and watches 25 companies by email.</p>');
    // The chips sit on the plan cards and nowhere else.
    const pricing = section(page, "lp-pricing");
    expect(page.match(/class="pro-tag"/g)).toHaveLength(1);
    expect(page.match(/class="ultra-tag"/g)).toHaveLength(1);
    expect(pricing).toContain('class="pro-tag"');
    expect(pricing).toContain('class="ultra-tag"');
    // No email or watch line carries a chip, and "recompete" stays on /pro.
    expect(page.toLowerCase()).not.toContain("recompete");
    expect(nbsp(await html("/?lang=fr", on())).toLowerCase()).not.toContain("remise en concurrence");
  });

  it("draws Free and Pro row by row from PLAN_ROWS, and Ultra's rows, in both languages", async () => {
    for (const lang of ["en", "fr"] as const) {
      const pricing = nbsp(section(await html(lang === "fr" ? "/?lang=fr" : "/", paid()), "lp-pricing"));
      const cards = [...pricing.matchAll(/<div class="lp-plan(?: [^"]*)?"(?: id="[^"]*")?>([\s\S]*?)<\/div>/g)].map((m) => m[1]);
      expect(cards).toHaveLength(3);
      const rows = (card: string) => [...card.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
        .map((m) => nbsp(textOf(m[1])).replace(nbsp(`${t(lang, "plans.lacks")} `), ""));
      for (const [i, plan] of (["free", "pro"] as const).entries()) {
        expect(rows(cards[i]), `${lang} ${plan}`).toEqual(PLAN_ROWS.map((r) => nbsp(planLine(lang, rowFor(r, plan).wording))));
        // A row the plan lacks is marked so in words and by the ring.
        expect(cards[i].match(/class="lp-lacks"/g)?.length ?? 0).toBe(PLAN_ROWS.filter((r) => !rowFor(r, plan).has).length);
      }
      expect(rows(cards[2])).toEqual(ULTRA_ROWS.map((k) => nbsp(t(lang, k))));
      const monthly = lang === "fr" ? `${PRICE[1].replace(".", ",")} $ CA` : `CA$${PRICE[1]}`;
      const yearly = lang === "fr" ? `${PRICE[2].replace(".", ",")} $ CA` : `CA$${PRICE[2]}`;
      expect(cards[1]).toContain(`<p class="lp-pr">${monthly}<small>${nbsp(t(lang, "landing.price_rest", { yearly }))}</small></p>`);
      expect(pricing).toContain(nbsp(decode(t(lang, "plans.seller"))).replace(/'/g, "&#39;"));
    }
    const pricing = decode(section(await html("/", paid()), "lp-pricing"));
    expect(pricing).toContain(`<h3 class="lp-plan-nm">Ultra<span class="ultra-tag"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="${ULTRA_GLYPH_PATH}"></path></svg>Ultra<span class="visually-hidden"> (custom plan)</span></span></h3>`);
    expect(ULTRA_GLYPH_PATH).toBe("M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z");
    expect(pricing).toContain('<p class="lp-pr lp-pr-unset">Price to be set <span class="lp-soon-tag">Coming soon</span></p>');
    // The button is the Ultra card's form now (operator, 2026-11-08), not a link to the email lists.
    expect(pricing).toContain('<button type="submit" class="lp-btn lp-ultra-btn">Tell me when Ultra opens</button>');
    expect(pricing).not.toContain('href="/alerts"');
    expect(pricing).toContain('<a class="lp-btn lp-btn-fill" href="/account/sign-in?next=/account/billing">Subscribe to Pro</a>');
    // Without a checkout the Pro card says Pro is not on sale and names no figure.
    const unpriced = section(await html("/", on()), "lp-pricing");
    expect(unpriced).toContain('<p class="lp-pr lp-pr-unset">Not on sale yet</p>');
    expect(unpriced).not.toContain(`CA$${PRICE[1]}`);
    // Ultra is sapphire in both modes.
    expect(LANDING_CSS).toContain(".ultra-tag { border-color: var(--sap); color: var(--sap); }");
    expect(LANDING_CSS).toMatch(/:root \{[^}]*--sap: #0f52ba;/);
    expect(LANDING_CSS).toMatch(/:root\[data-theme="dark"\] \{[^}]*--sap: #7eb0ff;/);
  });
});

describe("the Ultra card's form", () => {
  // The card's block: the form in the button's place (test/interest-ultra.test.ts holds its post).
  const box = (page: string) => /<div class="lp-ultra" data-interest="">[\s\S]*?<\/form><\/div>/.exec(page)?.[0] ?? "(no form)";

  it("holds one address field and the card's button, posting kind=ultra to /interest, in both languages", async () => {
    for (const lang of ["en", "fr"] as const) {
      const page = nbsp(await html(lang === "fr" ? "/?lang=fr" : "/", on()));
      const form = decode(box(page));
      const email = nbsp(t(lang, "interest.email"));
      expect(form).toBe(
        '<div class="lp-ultra" data-interest="">' +
        '<form method="post" action="/interest#ultra" class="lp-ultra-form" data-interest-form="">' +
        `<input type="hidden" name="kind" value="ultra"/><input type="hidden" name="lang" value="${lang}"/>` +
        `<div class="hp"><label>${nbsp(t(lang, "form.honeypot"))}<input name="website" type="text" tabindex="-1" autocomplete="off"/></label></div>` +
        `<label class="lp-ultra-field"><span class="visually-hidden">${email}</span>` +
        `<input name="email" type="email" required="" maxlength="254" autocomplete="email" spellcheck="false" placeholder="${email}" value=""/></label>` +
        `<button type="submit" class="lp-btn lp-ultra-btn">${nbsp(t(lang, "landing.ultra_button"))}</button>` +
        "</form></div>",
      );
      // The block sits in the card's last row, under its list, on the card's anchor.
      const card = /<div class="lp-plan lp-plan-ultra" id="ultra">[\s\S]*?<\/form><\/div><\/div>/.exec(page)?.[0] ?? "";
      expect(card.indexOf("</ul>")).toBeGreaterThan(0);
      expect(card.indexOf("</ul>")).toBeLessThan(card.indexOf('<div class="lp-ultra"'));
      expect(page.match(/<input name="email"/g)).toHaveLength(1);
    }
    expect(decode(box(await html("/", on())))).toContain(">Tell me when Ultra opens</button>");
    expect(nbsp(decode(box(await html("/?lang=fr", on()))))).toContain(">M’avertir à l’ouverture d’Ultra</button>");
  });

  it("loads the script that keeps the reader on the page inside the plan cards, so it comes and goes with them", async () => {
    const page = await html("/", on());
    expect(section(page, "lp-pricing")).toContain('<script src="/interest.js" defer=""></script>');
    expect(page.match(/\/interest\.js/g)).toHaveLength(1);
    for (const path of ["/", "/?lang=fr"]) {
      const off_ = await html(path, off());
      expect(off_, path).not.toContain("interest.js");
      expect(off_, path).not.toContain("lp-ultra");
      expect(off_, path).not.toContain('action="/interest');
    }
  });

  it("styles the field, the button and the thanks line in the card's own classes, under a new stylesheet version", () => {
    // 3 brought the card's rules; 4 and 5 the nav with Overview (a wider bar, the short French word; no wrap). 5 is the version once Overview joined them (test/overview.test.ts).
    // 6 brought the matching notices' example card (test/accounts-funnel.test.ts).
    expect(LANDING_VERSION).toBe(6);
    for (const rule of [".lp-ultra {", ".lp-ultra-form {", ".lp-ultra .hp {", ".lp-ultra-field input {", ".lp-ultra-btn {", ".lp-ultra-error {",
      ".lp-ultra-done {", ".lp-ultra-thanks {", ".lp-ultra-noted {", ".lp-plan-ultra { scroll-margin-top:"]) {
      expect(LANDING_CSS, rule).toContain(rule);
    }
    // The honeypot stays off screen, as on the Console pages.
    expect(LANDING_CSS).toContain(".lp-ultra .hp { position: absolute; left: -9999px; }");
  });
});

describe("the writing and the files", () => {
  it("has no em-dash and no unfilled placeholder anywhere, in either language or state", async () => {
    for (const env of [off(), on(), paid({ BRANDFETCH_CLIENT_ID: CLIENT_ID })]) {
      for (const path of ["/", "/?lang=fr"]) {
        const page = await html(path, env);
        expect(page, path).not.toContain(EM_DASH);
        const visible = page.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
        expect(visible, path).not.toMatch(/\{\w+\}/);
      }
    }
    expect(LANDING_CSS).not.toContain(EM_DASH);
  });

  it("ships its stylesheet and the self-hosted display face, swapped in and preloaded", async () => {
    const files = new Map(PUBLIC_FILES.map((f) => [f.path, f]));
    expect(files.get("landing.css")?.bytes).toBeGreaterThan(1000);
    const font = files.get(DISPLAY_FONT.slice(1));
    expect(font?.magic).toBe("wOF2");
    expect(font!.bytes).toBeGreaterThan(20_000);
    expect(font!.bytes).toBeLessThan(200_000);
    expect(files.get("fonts/BricolageGrotesque-OFL.txt")?.bytes).toBeGreaterThan(1000);
    expect(files.get("fonts/InterVariable.woff2")?.magic).toBe("wOF2");
    // The static layer serves public/ as it is; neither file goes through the Worker.
    expect(wrangler).toContain('"directory": "./public"');
    const first = JSON.parse(/"run_worker_first":\s*(\[[^\]]*\])/.exec(wrangler)?.[1] ?? "[]") as string[];
    expect(first.some((g) => g.startsWith("/fonts") || g.startsWith("/landing"))).toBe(false);
    expect(LANDING_CSS).toContain(`src: url("${DISPLAY_FONT}") format("woff2");`);
    expect(LANDING_CSS.match(/font-display: swap;/g)).toHaveLength(2);
    const page = await html("/", off());
    expect(page).toContain(`<link rel="preload" href="${DISPLAY_FONT}" as="font" type="font/woff2" crossorigin="anonymous"/>`);
    // The app pages set their titles and tile figures in the same face since the identity pass of
    // 2026-11-08 (public/styles.css declares it as this stylesheet does, test/identity.test.ts), and
    // preload the same file; they never load this page's stylesheet.
    const other = await html("/tenders", off());
    expect(other).toContain(`<link rel="preload" href="${DISPLAY_FONT}" as="font" type="font/woff2" crossorigin="anonymous"/>`);
    expect(other).not.toContain("landing.css");
  });

  it("keys light and dark as the site does, keeping the hero and the closing band navy in both", () => {
    expect(LANDING_CSS).toContain(':root[data-theme="dark"] {');
    expect(LANDING_CSS).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {');
    const dark = /:root\[data-theme="dark"\] \{([^}]*)\}/.exec(LANDING_CSS)?.[1] ?? "";
    const media = /:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/.exec(LANDING_CSS)?.[1] ?? "";
    expect(media.replace(/\s+/g, " ").trim()).toBe(dark.replace(/\s+/g, " ").trim());
    expect(LANDING_CSS).toContain("body { margin: 0; background: var(--page);");
    expect(LANDING_CSS).toMatch(/\.lp-hero \{ background: radial-gradient\([^)]*var\(--navy-2\), var\(--navy\)/);
    expect(LANDING_CSS).toContain(".lp-close { background: var(--navy);");
    // Motion stops for a reader who asks for less of it.
    expect(LANDING_CSS).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("links the company shot's name, Follow and Analytics where the profile's own controls lead, in both switch states", async () => {
    const stats = FILES["stats.json"] as any;
    const id = stats.top_organizations_year[0].id as string;
    const onPage = await html("/", on());
    expect(onPage).toContain(`<div class="lp-nm"><a href="/organizations/${id}">`);
    // Follow leads to the sign-in with the profile as the way back and as what to follow, so signing in follows it.
    expect(onPage).toContain(`<a class="lp-btn lp-btn-sm lp-btn-fill" href="/account/sign-in?next=${encodeURIComponent(`/organizations/${id}`)}` +
      `&amp;follow=${encodeURIComponent(`organization:${id}`)}">Follow</a>`);
    expect(onPage).toContain(`<a class="lp-btn lp-btn-sm" href="/organizations/${id}/analytics" rel="nofollow">Analytics</a>`);
    expect(onPage).not.toContain('<div class="lp-shot" aria-hidden="true"><div class="lp-profile">');
    const offPage = await html("/", off());
    expect(offPage).toContain(`<a class="lp-btn lp-btn-sm lp-btn-fill" href="/organizations/${id}">`);
    expect(offPage).not.toContain(`/organizations/${id}/analytics`);
  });
});
