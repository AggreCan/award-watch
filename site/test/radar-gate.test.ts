// The radar's depth as a paid feature (src/plan.ts radarWindowLocked,
// src/pages/expiring.tsx expiringTeaser and expiringFile, the downloads route
// in src/index.tsx): from the day the accounts switch is on, the 6- and
// 12-month windows and the 12-month CSV are Pro; the overview, the 3-month
// window, its CSV and every window's count and total stay free. Until then
// the gate closes nothing.
//
// Switch off, the window pages and the overview are proved unchanged by the
// gate the way the intraday tests prove the free page: the same bytes
// whatever session cookie comes with the request and whatever the accounts
// binding holds or does, and the full list (every row of the page, the
// filters, the pager) where the free view would cut it. The 6- and 12-month
// pages were also compared, hash for hash, against the code before the gate
// when it was written. Switch on, each of no session, a Free session and a
// Pro session gets its view in both languages with its own caching rule, and
// the window files and the 12-month CSV answer 404 or pass through. The feeds
// cover the 3-month window only, so they do not change. Last, every GET route
// the app has is asked with a free request, and none but the window page
// reads a deep window's file or shows one of its rows past the free ones.
import { describe, expect, it } from "vitest";
import wrangler from "../wrangler.jsonc?raw";
import { allowed } from "../src/account/entitlements";
import type { ExpiringRow } from "../src/data";
import { t } from "../src/i18n";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { EXPIRING_TEASER_ROWS } from "../src/pages/expiring";
import { DEEP_WINDOWS, allowsRadarDepth } from "../src/plan";
import { PRO_INCLUDES } from "../src/pro";
import { routeTemplate } from "../src/views";
import { get, grantPro, nbsp, newEmail, nextIp, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { contentEtag, makeFakeAssets, testEnv } from "./assets";
import { landingCore } from "./home";
import page1 from "./fixtures/expiring-3m-1.json";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const base = page1 as unknown as ExpiringRow[];

// -- the deep windows as the export writes them -------------------------------------

// A PSPC history row ending on the given day; the reference is the row's
// mark in the pages (shown as written, linked in lower case).
const DATA_DATE = Date.parse("2026-10-31T00:00:00Z");
function extra(prefix: string, i: number, end: string): ExpiringRow {
  return {
    kind: "history", reference: `${prefix}-${String(i).padStart(2, "0")}`, title_en: `Test contract ${i}`, title_fr: `Contrat d'essai ${i}`,
    organization_id: null, organization: "Sample Works Ltd.", buyer_id: "dnd-mdn", buyer_en: "National Defence", buyer_fr: "Défense nationale",
    start: "2025-01-01", end, days_left: Math.round((Date.parse(`${end}T00:00:00Z`) - DATA_DATE) / 86_400_000), value: 100_000 * i,
    currency: "CAD", competitive: 1, method_en: "Competitive", method_fr: "Concurrentielle", instrument_en: "Contract", instrument_fr: "Contrat",
    n_amendments: 0, value_growth: 0, tender_reference: null, segments: ["43"], provinces: ["ON"],
  };
}
const dayAfter = (from: string, days: number) => new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// A window of two pages: the first holds the 3-month rows and nine of its
// own, out of order (the page sorts them), the second the rest. Sorted, the
// free view shows the 3-month rows and the window's first seven; the rest are
// the rows a free request must never see.
function deepWindow(window: "6m" | "12m", prefix: string, from: string, step: number, count: number) {
  const extras = Array.from({ length: count }, (_, k) => extra(prefix, k + 1, dayAfter(from, step * (k + 1))));
  const all = [...base, ...extras];
  return {
    rows: all.length,
    files: {
      [`expiring/${window}/index.json`]: { window, pages: 2, rows: all.length, total: all.reduce((s, r) => s + (r.value ?? 0), 0) },
      [`expiring/${window}/1.json`]: [...extras.slice(0, 9).reverse(), ...base],
      [`expiring/${window}/2.json`]: extras.slice(9),
    } as Record<string, unknown>,
    shown: [...BASE_SHOWN, ...extras.slice(0, EXPIRING_TEASER_ROWS - BASE_SHOWN.length).map((r) => r.reference)],
    hidden: extras.slice(EXPIRING_TEASER_ROWS - BASE_SHOWN.length).map((r) => r.reference),
  };
}
// The 3-month rows by the reference the table shows (a published contract's
// without its department), soonest end first.
const BASE_SHOWN = ["cb-400-40000004", "W8472-000777", "C-2026-0042"];
const SIX = deepWindow("6m", "R6M", "2027-01-29", 3, 11);
const TWELVE = deepWindow("12m", "R12", "2027-03-22", 10, 13);
const WINDOWS = { "6m": SIX, "12m": TWELVE } as const;
const DEEP = ["6m", "12m"] as const;
const HIDDEN = [...SIX.hidden, ...TWELVE.hidden];
const FEED_XML = '<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Contracts ending within 3 months</title></feed>';
const RADAR_FILES: Record<string, unknown> = { ...SIX.files, ...TWELVE.files, "feeds/canada/expiring.xml": FEED_XML };

// The fixtures plus the deep windows, with the header the static layer sends
// on every file, so a test can see whether a response kept it. paths, when
// given, collects every path asked for.
function radarAssets(paths?: string[]): Fetcher {
  const inner = makeFakeAssets({}, RADAR_FILES);
  return {
    fetch: async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      paths?.push(new URL(url).pathname);
      const res = await inner.fetch(input as RequestInfo);
      const headers = new Headers(res.headers);
      if (res.ok) headers.set("cache-control", "public, max-age=0, must-revalidate");
      return new Response(res.body, { status: res.status, headers });
    },
  } as unknown as Fetcher;
}

// The two radar CSVs as R2 holds them under downloads/: the 12-month file
// carries every row of the 12-month window, the 3-month one the 3-month rows.
// keys, when given, collects every key asked for.
const csvOf = (rows: readonly ExpiringRow[]) => `kind,reference,end\n${rows.map((r) => `${r.kind},${r.reference},${r.end}`).join("\n")}\n`;
const CSV_12M = csvOf([...(TWELVE.files["expiring/12m/1.json"] as ExpiringRow[]), ...(TWELVE.files["expiring/12m/2.json"] as ExpiringRow[])]);
const CSV_3M = csvOf(base);
function csvBucket(keys?: string[]): R2Bucket {
  const objects: Record<string, string> = { "downloads/expiring-12m.csv": CSV_12M, "downloads/expiring-3m.csv": CSV_3M };
  const read = (key: string, withBody: boolean) => {
    keys?.push(key);
    const text = objects[key];
    if (text === undefined) return null;
    const bytes = new TextEncoder().encode(text);
    return withBody ? { size: bytes.length, body: new Response(bytes).body } : { size: bytes.length };
  };
  return { get: async (key: string) => read(key, true), head: async (key: string) => read(key, false) } as unknown as R2Bucket;
}

const off = (assets: Fetcher = radarAssets(), bucket: R2Bucket = csvBucket()) => ({ ...testEnv(assets), DATA: bucket });
const on = (assets: Fetcher = radarAssets(), bucket: R2Bucket = csvBucket()) => onEnv({ ASSETS: assets, DATA: bucket });
// The switch on with the payment service's two secrets set, so a checkout can
// be made and the plan cards name the price from wrangler.jsonc's figures.
const paid = () => ({ ...on(), STRIPE_SECRET_KEY: "sk_test_fake0000", STRIPE_WEBHOOK_SECRET: "whsec_fake0000" });

// An accounts binding that refuses any use: the switch-off pages must not touch it.
const refusingDb = new Proxy({}, { get: () => () => { throw new Error("the accounts database was read"); } }) as unknown as D1Database;

let freeCookie = "";
let proCookie = "";
async function sessions(): Promise<void> {
  if (proCookie) return;
  freeCookie = await signIn(newEmail("radar-free"));
  const pro = newEmail("radar-pro");
  proCookie = await signIn(pro);
  await grantPro(pro);
}

const html = async (path: string, env: object, cookie?: string) => (await get(path, { env, cookie })).text();
// Once the switch is on, the rail carries the signed-in address (or "Sign
// in"), the wordmark a signed-in reader's plan, the footer a Pro reader's
// bug report link and the analytics index's link, and the tabs and tiles
// of the deep windows the Pro chip (for every reader); the rest of the
// page is what is compared.
const CHIP = /<span class="pro-tag"><svg[^>]*><path[^>]*><\/path><\/svg>Pro<span class="visually-hidden"> \((?:paid plan|forfait payant)\)<\/span><\/span>/g;
const noRail = (page: string) =>
  page.replace(/<nav class="rail"[\s\S]*?<\/nav>/, "").replace(/<span class="brand-plan brand-plan-(?:free|pro)">[^<]*<\/span>/, "")
    .replace(/<a href="\/account\/bug">[^<]*<\/a>/, "").replace(/<a href="\/pro">[^<]*<\/a>/, "").replace(/<a href="\/analytics">[^<]*<\/a>/, "")
    .replace(CHIP, "")
    .replace(/<p class="interest-pro">[\s\S]*?<\/p>/g, "")
    // The top bar's same-day timer leads to the tease while the switch is on and to the list while it is off.
    .replace('<a class="refresh" href="/tenders/same-day"', '<a class="refresh" href="/tenders"');
const pageHead = (page: string) => /<header class="page-head">[\s\S]*?<\/header>/.exec(page)?.[0] ?? "";
// The head without its CSV button, which names the file each view links.
const headText = (page: string) => pageHead(page).replace(/<div class="page-actions">[\s\S]*?<\/div>/, "");
const csvButton = (page: string) => /<div class="page-actions">([\s\S]*?)<\/div>/.exec(pageHead(page))?.[1] ?? "";
// The references the radar table shows, in order.
const shownRefs = (page: string) => [...page.matchAll(/<span class="mono id muted">([^<]+)<\/span>/g)].map((m) => m[1]);
const proPanel = (page: string) =>
  /<section class="panel pro-panel"><div class="panel-head"><h2>(?:Part of Pro|Offert avec le forfait Pro)<\/h2>[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
// The panel's plan cards (src/pro.tsx PlanCards): Free first, then Pro to the panel's end.
const cardsOf = (panel: string) => panel.split(/(?=<div class="plan-card[ "])/).slice(1);
const freeCard = (panel: string) => cardsOf(panel)[0] ?? "";
const proCard = (panel: string) => cardsOf(panel)[1] ?? "";
// The price as the panel names it: the two figures wrangler.jsonc carries,
// whatever they are, never a figure written in the code.
const PRICE = /"PRICE_MONTHLY_CAD":\s*"([0-9.]+)"[\s\S]*?"PRICE_YEARLY_CAD":\s*"([0-9.]+)"/.exec(wrangler) ?? ["", "", ""];
const [MONTHLY, YEARLY] = [PRICE[1], PRICE[2]];
const hasHidden = (body: string) => HIDDEN.filter((ref) => body.toLowerCase().includes(ref.toLowerCase()));

const PAGES = [
  "/expiring", "/expiring?lang=fr", "/expiring/3m", "/expiring/3m?lang=fr",
  "/expiring/6m", "/expiring/6m?lang=fr", "/expiring/6m?page=2", "/expiring/6m?buyer=dnd-mdn&fye=0",
  "/expiring/12m", "/expiring/12m?lang=fr", "/expiring/12m?page=2&lang=fr", "/expiring/12m?segment=43",
];
const FILE_PATHS = ["/data/expiring/6m/index.json", "/data/expiring/6m/1.json", "/data/expiring/6m/2.json", "/data/expiring/12m/index.json",
  "/data/expiring/12m/1.json", "/data/expiring/12m/2.json"];
const bodyOf = (path: string) => JSON.stringify(RADAR_FILES[path.slice("/data/".length)]);

describe("the plans", () => {
  it("make radar_depth a Pro feature for the 6- and 12-month windows", () => {
    expect(DEEP_WINDOWS).toEqual(DEEP);
    expect(allowed({ plan: "free" }, "radar_depth")).toBe(false);
    expect(allowed({ plan: "pro" }, "radar_depth")).toBe(true);
    expect(allowsRadarDepth("free")).toBe(false);
    expect(allowsRadarDepth("pro")).toBe(true);
    expect(EXPIRING_TEASER_ROWS).toBe(10);
  });

  it("list in the Pro panel only what Pro has and Free does not", () => {
    expect(PRO_INCLUDES.map(([feature]) => feature)).toContain("radar_depth");
    for (const [feature] of PRO_INCLUDES) {
      expect(allowed({ plan: "pro" }, feature), feature).toBe(true);
      expect(allowed({ plan: "free" }, feature), feature).toBe(false);
    }
  });
});

describe("with the switch off", () => {
  it("serves the same window pages and overview whatever the session or the accounts binding", async () => {
    await sessions();
    for (const path of PAGES) {
      const res = await get(path, { env: off() });
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(res.headers.get("vary"), path).toBeNull();
      const page = await res.text();
      for (const cookie of [freeCookie, proCookie]) expect(await html(path, off(), cookie), path).toBe(page);
      expect(await html(path, { ...off(), ACCOUNTS: refusingDb }, proCookie), path).toBe(page);
      expect(page, path).not.toContain("Part of Pro");
      expect(page, path).not.toContain("Offert avec le forfait Pro");
    }
  });

  it("lists the whole page of a deep window, with its filters and its pager", async () => {
    for (const window of DEEP) {
      const page = await html(`/expiring/${window}`, off());
      const { files, hidden } = WINDOWS[window];
      // Every row of the first page file, the free view's ten and the two after.
      expect(shownRefs(page)).toHaveLength((files[`expiring/${window}/1.json`] as unknown[]).length);
      expect(page).toContain(hidden[0]);
      expect(page).toContain(`<form method="get" action="/expiring/${window}" class="toolbar">`);
      expect(page).toContain(`<a href="/expiring/${window}?page=2" class="btn" rel="next">`);
      expect(await html(`/expiring/${window}?page=2`, off())).toContain(hidden[hidden.length - 1]);
    }
  });

  it("passes each window file on as the static layer serves it, to any request", async () => {
    await sessions();
    for (const path of FILE_PATHS) {
      for (const cookie of [undefined, freeCookie, proCookie]) {
        const res = await get(path, { env: off(), cookie });
        expect(res.status, path).toBe(200);
        const body = await res.text();
        expect(body, path).toBe(bodyOf(path));
        expect(res.headers.get("etag"), path).toBe(await contentEtag(body));
        expect(res.headers.get("content-type"), path).toBe("application/json");
        expect(res.headers.get("cache-control"), path).toBe("public, max-age=0, must-revalidate");
      }
    }
    // A file the export did not write is the site's 404, as when the request fell through to the Worker.
    const missing = await get("/data/expiring/6m/9.json", { env: off() });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("<h1>Page Not Found</h1>");
  });
});

describe("with the switch on and no session", () => {
  it("shows a deep window's count, total and first ten rows, then what Pro adds", async () => {
    for (const window of DEEP) {
      const path = `/expiring/${window}`;
      const res = await get(path, { env: paid() });
      expect(res.status, path).toBe(200);
      // A page public caches may keep; a browser asks again once the cookie changes.
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(res.headers.get("vary"), path).toBe("Cookie");
      const page = await res.text();
      const full = await html(path, off());
      // The head as the full list has it, the count and the value, with the
      // free 3-month CSV where the full list offers the 12-month one.
      expect(headText(page), path).toBe(headText(full));
      expect(pageHead(page), path).toContain(`<p class="lead">${WINDOWS[window].rows} contracts end within`);
      expect(csvButton(page), path).toBe('<a href="/downloads/expiring-3m.csv" class="btn">Download contracts ending within 3 months (CSV)</a>');
      expect(csvButton(full), path).toBe('<a href="/downloads/expiring-12m.csv" class="btn">Download contracts ending within 12 months (CSV)</a>');
      expect(page, path).not.toContain("/downloads/expiring-12m.csv");
      // The ten soonest, in end order, and none after them.
      expect(shownRefs(page), path).toEqual(WINDOWS[window].shown);
      expect(hasHidden(page), path).toEqual([]);
      expect(page, path).toContain("The first 10 by end date, the same as the 3-month list.");
      // No filters, no pages: the tabs to the other windows stay.
      expect(page, path).not.toContain('<form method="get"');
      expect(page, path).not.toContain('id="radar-pager"');
      expect(page, path).not.toContain("?page=2");
      expect(page, path).not.toContain('rel="next"');
      expect(page, path).toContain('<nav aria-label="Windows" class="tabs toolbar-row"><a href="/expiring/3m">Within 3 months</a>');
      // What Pro adds, as the plan cards: Free beside Pro, the price and where to sign in.
      const panel = proPanel(page);
      // In figures: all the window's contracts, and those beyond the free 3-month list (the 3 base rows) with their value.
      // The value in short form, its exact figure as its title for the tip.
      const value = window === "6m" ? '<span title="$6,600,000" data-tip="">$6.6M</span>' : '<span title="$9,100,000" data-tip="">$9.1M</span>';
      expect(panel, path).toContain(`<p>Pro lists all ${WINDOWS[window].rows}, ${WINDOWS[window].rows - 3} of them ending 3 to ${window === "6m" ? 6 : 12} months out (${value}), with every filter and the 12-month CSV.</p>`);
      expect(panel, path).toContain('<p>The <a href="/expiring/3m">3-month list</a>, its feeds and every window&#39;s count and total stay free.</p>');
      const pro = proCard(panel);
      expect(pro, path).toContain("<span>Contracts ending: 6- and 12-month lists</span>");
      expect(pro, path).toContain("<span>Contracts ending: the 12-month CSV</span>");
      expect(pro, path).toContain("<span>Tender notices, same day, every 2 hours</span>");
      expect(pro, path).toContain("<span>25 saved searches, by email</span>");
      expect(pro, path).toContain("<span>A form to report a site problem</span>");
      expect(freeCard(panel), path).toContain("<span>Contracts ending: the 3-month list</span>");
      expect(pro, path).toContain('<a href="/account/sign-in?next=/account/billing" class="btn btn-primary">Subscribe to Pro</a>');
      // The chip in the head's tools, beside the title, and on the Pro card's head band.
      expect(panel, path).toContain('<h2>Part of Pro</h2><div class="panel-tools"><span class="pro-tag">');
      expect(panel.match(/class="pro-tag"/g), path).toHaveLength(2);
      expect(pro, path).toMatch(/^<div class="plan-card plan-card-offer"><div class="plan-card-head"><h3>Pro<\/h3><span class="pro-tag">/);
      // The price, from the two figures in wrangler.jsonc, on the Pro card's
      // price line before the button, the taxes named in the note under it.
      expect(MONTHLY).toMatch(/^[0-9]+\.[0-9]{2}$/);
      const price = `<span class="plan-figure"><strong class="plan-amount">CA$${MONTHLY}</strong> a month or CA$${YEARLY} a year</span>`;
      expect(pro, path).toContain(price);
      expect(pro, path).toContain('<p class="plan-for">For people who bid, or follow who wins.</p>');
      expect(pro, path).toContain('<p class="plan-note">Enter your email, type the 6-digit code the site sends, then pay monthly or yearly on Stripe');
      expect(pro, path).toContain("There is no password. Taxes added at checkout.");
      expect(pro.indexOf(price), path).toBeLessThan(pro.indexOf("btn-primary"));
      // Two figures for Pro and Free's CA$0, nothing else.
      expect(panel.match(/CA\$/g), path).toHaveLength(3);
      expect(page, path).not.toContain(EM_DASH);
      // The rows' panel comes before the Pro panel.
      expect(page.indexOf("<h2>Part of Pro</h2>"), path).toBeGreaterThan(page.indexOf('<span class="mono id muted">'));
    }
  });

  it("speaks French", async () => {
    for (const window of DEEP) {
      const page = nbsp(await html(`/expiring/${window}?lang=fr`, paid()));
      expect(headText(page)).toBe(headText(nbsp(await html(`/expiring/${window}?lang=fr`, off()))));
      expect(csvButton(page)).toBe('<a href="/downloads/expiring-3m.csv" class="btn">Télécharger les contrats prenant fin d’ici 3 mois (CSV)</a>');
      expect(shownRefs(page)).toEqual(WINDOWS[window].shown);
      expect(page).toContain("Les 10 premiers par date de fin, les mêmes que dans la liste de 3 mois.");
      const panel = proPanel(page);
      expect(panel).toContain("<h2>Offert avec le forfait Pro</h2>");
      const value = window === "6m" ? '<span title="6 600 000 $" data-tip="">6,6 M$</span>' : '<span title="9 100 000 $" data-tip="">9,1 M$</span>';
      expect(panel).toContain(`<p>Pro les énumère tous les ${WINDOWS[window].rows}, dont ${WINDOWS[window].rows - 3} prennent fin dans 3 à ${window === "6m" ? 6 : 12} mois (${value}), avec tous les filtres et le CSV de 12 mois.</p>`);
      expect(freeCard(panel)).toContain("<h3>Gratuit</h3>");
      const pro = proCard(panel);
      expect(pro).toContain("<span>25 recherches enregistrées, par courriel</span>");
      expect(pro).toContain("<span>Contrats prenant fin : CSV de 12 mois</span>");
      expect(panel).toContain('<a href="/expiring/3m">liste de 3 mois</a>');
      expect(pro).toContain('<a href="/account/sign-in?next=/account/billing" class="btn btn-primary">S’abonner à Pro</a>');
      expect(pro).toContain("<span>Formulaire pour signaler un problème</span>");
      // The figures with a decimal comma, as the billing page prints them.
      const fr = (s: string) => s.replace(".", ",");
      expect(pro).toContain(`<strong class="plan-amount">${fr(MONTHLY)} $ CA</strong> par mois ou ${fr(YEARLY)} $ CA par année</span>`);
      expect(pro).toContain('<p class="plan-note">Entrez votre adresse courriel, saisissez le code à 6 chiffres');
      expect(pro).toContain("Il n’y a pas de mot de passe. Taxes ajoutées au paiement.");
      expect(panel).toContain('<span class="visually-hidden"> (forfait payant)</span>');
      expect(page).not.toContain("Part of Pro");
      expect(page).not.toContain(EM_DASH);
    }
  });

  it("sets filters and later pages aside, says so, and keeps such an address out of the index", async () => {
    for (const path of ["/expiring/12m?buyer=dnd-mdn&page=2", "/expiring/6m?page=2", "/expiring/6m?segment=43", "/expiring/12m?page=99"]) {
      const res = await get(path, { env: on() });
      expect(res.status, path).toBe(200);
      const page = await res.text();
      const window = path.startsWith("/expiring/6m") ? "6m" : "12m";
      expect(shownRefs(page), path).toEqual(WINDOWS[window].shown);
      expect(hasHidden(page), path).toEqual([]);
      expect(page, path).toContain("Filters and later pages are part of Pro, so this address shows the window&#39;s first contracts.");
      expect(page, path).toContain('<meta name="robots" content="noindex');
    }
    const bare = await html("/expiring/6m", on());
    expect(bare).not.toContain("Filters and later pages are part of Pro");
    expect(bare).not.toContain('<meta name="robots" content="noindex');
  });

  it("leaves the overview and the 3-month window as they are", async () => {
    for (const path of ["/expiring", "/expiring?lang=fr", "/expiring/3m", "/expiring/3m?lang=fr", "/expiring/3m?kind=award&page=1"]) {
      const res = await get(path, { env: on() });
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(noRail(await res.text()), path).toBe(noRail(await html(path, off())));
    }
  });

  // The landing page (src/pages/landing.tsx), "/" for a reader not signed in:
  // its ending shot is the 3-month window's first page; the deep windows are
  // named only in its Pro line and the plan cards' rows; and with the
  // switch's pieces stripped (test/home.ts LANDING_SWITCH_PIECES) it is the
  // page a reader gets with the switch off.
  it("keeps the landing page to the 3-month window, the deep ones named only in its Pro line and plan rows", async () => {
    const landing = async (path: string, env: object) =>
      app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, env);
    for (const path of ["/", "/?lang=fr"]) {
      const paths: string[] = [];
      const res = await landing(path, on(radarAssets(paths)));
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=300");
      const body = await res.text();
      expect(hasHidden(body), path).toEqual([]);
      expect([...new Set(paths.filter((p) => p.startsWith("/data/expiring/")))].sort(), path)
        .toEqual(["/data/expiring/3m/1.json", "/data/expiring/index.json"]);
      expect(landingCore(body), path).toBe(landingCore(await (await landing(path, off())).text()));
    }
    const page = await (await landing("/", on())).text();
    expect(page).toContain('<p class="lp-pro">Pro opens the 6- and 12-month lists and the CSV.</p>');
    const pricing = /<section class="lp-pricing"[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
    expect(pricing).toContain("<span>Contracts ending: 6- and 12-month lists</span>");
    expect(pricing).toContain("<span>Contracts ending: the 12-month CSV</span>");
    // Outside those two, the page names no deep window.
    const rest = page.replace(pricing, "").replace(/<p class="lp-pro">[^<]*<\/p>/g, "");
    expect(rest).not.toMatch(/6-month|12-month|\/expiring\/(?:6m|12m)/);
  });

  it("answers the site's 404 for a deep window's files, and reads none of them", async () => {
    for (const path of FILE_PATHS) {
      const paths: string[] = [];
      const res = await get(path, { env: on(radarAssets(paths)) });
      expect(res.status, path).toBe(404);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      const body = await res.text();
      expect(body, path).toContain("<h1>Page Not Found</h1>");
      expect(hasHidden(body), path).toEqual([]);
      expect(paths.filter((p) => /^\/data\/expiring\/(6m|12m)\//.test(p)), path).toEqual([]);
    }
  });
});

describe("with the switch on and a Free session", () => {
  it("shows the free view, privately, with a link to the account and one to the billing page", async () => {
    await sessions();
    for (const path of ["/expiring/6m", "/expiring/12m?lang=fr"]) {
      const res = await get(path, { env: on(), cookie: freeCookie });
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
      const page = nbsp(await res.text());
      expect(shownRefs(page), path).toEqual(WINDOWS[path.includes("12m") ? "12m" : "6m"].shown);
      expect(hasHidden(page), path).toEqual([]);
      // The Free card is the account's own plan; Pro leads to the billing page.
      const panel = proPanel(page);
      expect(freeCard(panel), path).toMatch(/<span class="plan-current">(Your plan|Votre forfait)<\/span>/);
      expect(freeCard(panel), path).toMatch(/<a href="\/account" class="btn">(Your account|Votre compte)<\/a>/);
      expect(proCard(panel), path).toMatch(/<a href="\/account\/billing" class="btn btn-primary">(Plan and billing|Forfait et facturation)<\/a>/);
      expect(page, path).not.toContain('href="/account/sign-in" class="btn');
    }
  });

  it("answers 404 for the files", async () => {
    await sessions();
    for (const path of FILE_PATHS) {
      const res = await get(path, { env: on(), cookie: freeCookie });
      expect(res.status, path).toBe(404);
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
      expect(hasHidden(await res.text()), path).toEqual([]);
    }
  });
});

describe("with the switch on and a Pro session", () => {
  it("shows the full window pages as they are today, privately", async () => {
    await sessions();
    for (const path of PAGES) {
      const res = await get(path, { env: on(), cookie: proCookie });
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
      const page = await res.text();
      expect(noRail(page), path).toBe(noRail(await html(path, off())));
      expect(page, path).not.toContain("Part of Pro");
    }
  });

  it("gets the files, marked private", async () => {
    await sessions();
    for (const path of FILE_PATHS) {
      const res = await get(path, { env: on(), cookie: proCookie });
      expect(res.status, path).toBe(200);
      const body = await res.text();
      expect(body, path).toBe(bodyOf(path));
      expect(res.headers.get("etag"), path).toBe(await contentEtag(body));
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
    }
  });
});

describe("routing", () => {
  // The static layer's own rule (run_worker_first): a glob over the path.
  const RUN_FIRST = JSON.parse(/"run_worker_first":\s*(\[[^\]]*\])/.exec(wrangler)?.[1] ?? "[]") as string[];
  const first = (path: string) =>
    RUN_FIRST.some((glob) => new RegExp(`^${glob.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join(".*")}$`).test(path));

  it("sends only the feeds, the deep windows' files and the 12-month CSV through the Worker first", () => {
    expect(RUN_FIRST).toEqual(["/data/feeds/*", "/data/expiring/6m/*", "/data/expiring/12m/*", "/downloads/expiring-12m.csv"]);
    for (const path of [...FILE_PATHS, "/downloads/expiring-12m.csv"]) expect(first(path), path).toBe(true);
    expect(first("/downloads/expiring-3m.csv")).toBe(false);
    // The overview's and the 3-month window's files, and the files the
    // browser's scripts fetch (tenders.js, watchlist.js), stay static.
    for (const path of [
      "/data/expiring/index.json", "/data/expiring/3m/index.json", "/data/expiring/3m/1.json", "/data/tenders/open.json",
      "/data/tenders/20a.json", "/data/profiles/a00.json", "/data/stats.json", "/fonts/InterVariable.woff2",
    ]) {
      expect(first(path), path).toBe(false);
    }
  });

  it("counts the files by window in the views, and the CSVs as downloads under the download cap", () => {
    expect(routeTemplate("GET", "/data/expiring/6m/1.json")).toEqual({ route: "/data/expiring/6m/:file", kind: "file" });
    expect(routeTemplate("GET", "/data/expiring/12m/index.json")).toEqual({ route: "/data/expiring/12m/:file", kind: "file" });
    expect(routeTemplate("GET", "/data/expiring/3m/1.json")).toEqual({ route: "other", kind: "other" });
    for (const file of ["expiring-3m.csv", "expiring-12m.csv"]) {
      expect(routeTemplate("GET", `/downloads/${file}`)).toEqual({ route: `/downloads/${file}`, kind: "download" });
      expect(bucketFor("GET", `/downloads/${file}`)).toBe("download");
    }
  });
});

describe("the radar CSVs", () => {
  const GATED = "/downloads/expiring-12m.csv";
  const FREE = "/downloads/expiring-3m.csv";

  it("serve the 12-month file as before while the switch is off, whatever the session", async () => {
    await sessions();
    for (const cookie of [undefined, freeCookie, proCookie]) {
      const res = await get(GATED, { env: off(), cookie });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="expiring-12m.csv"');
      expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(await res.text()).toBe(CSV_12M);
    }
  });

  it("answer the download route's 404 for the 12-month file without the feature once the switch is on, reading nothing", async () => {
    await sessions();
    for (const [cookie, cache] of [[undefined, "no-store"], [freeCookie, "private, no-store"]] as const) {
      for (const method of ["GET", "HEAD"]) {
        const keys: string[] = [];
        const headers: Record<string, string> = { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() };
        if (cookie) headers.cookie = cookie;
        const res = await app.request(GATED, { method, headers }, on(radarAssets(), csvBucket(keys)));
        expect(res.status, method).toBe(404);
        expect(res.headers.get("cache-control"), method).toBe(cache);
        expect(keys, method).toEqual([]);
        const body = await res.text();
        if (method === "GET") expect(body).toContain("<h1>File Not Available</h1>");
        expect(hasHidden(body), method).toEqual([]);
      }
    }
  });

  it("serve the 12-month file to Pro, marked private, and the 3-month file to anyone", async () => {
    await sessions();
    const pro = await get(GATED, { env: on(), cookie: proCookie });
    expect(pro.status).toBe(200);
    expect(pro.headers.get("cache-control")).toBe("private, no-store");
    expect(await pro.text()).toBe(CSV_12M);
    for (const env of [off(), on()]) {
      for (const cookie of [undefined, freeCookie]) {
        const res = await get(FREE, { env, cookie });
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
        expect(await res.text()).toBe(CSV_3M);
      }
    }
  });

  it("are both on the Data page, the 12-month file marked as part of Pro, in both languages", async () => {
    const en = await html("/data", off());
    expect(en).toContain('<a href="/downloads/expiring-3m.csv" class="mono">expiring-3m.csv</a>');
    expect(en).toMatch(/<a href="\/downloads\/expiring-12m.csv" class="mono">expiring-12m.csv<\/a><\/td><td data-label="Contents">Every contract ending within 12 months of the data date, one row each, listed once across sources<br\/><span class="muted small">Part of Pro.<\/span><\/td>/);
    expect(en.indexOf("expiring-3m.csv</a>")).toBeLessThan(en.indexOf("expiring-12m.csv</a>"));
    const fr = nbsp(await html("/data?lang=fr", off()));
    expect(fr).toContain('<span class="muted small">Fait partie de Pro.</span>');
    expect(fr).toContain("Tous les contrats prenant fin dans les 3 mois suivant la date des données, avec les colonnes du fichier de 12 mois");
    // The mark says when, never what it costs.
    for (const lang of ["en", "fr"] as const) expect(t(lang, "data.file.pro")).not.toMatch(/\$|[0-9]|price|prix|month|mois/i);
    // The dataset metadata for search engines names the free files only, the
    // 3-month radar file where the 12-month one stood, so a crawler never meets the gate.
    const dataset = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(en)?.[1] ?? "{}");
    const files = dataset.hasPart.flatMap((p: { distribution: { name: string }[] }) => p.distribution.map((d) => d.name));
    for (const f of ["open-tenders.csv", "organizations.csv", "buyers.csv", "expiring-3m.csv"]) expect(files).toContain(f);
    expect(JSON.stringify(dataset)).not.toContain("expiring-12m");
    // The crawlers' list says the same.
    const llms = await html("/llms.txt", off());
    expect(llms).toContain("https://awardwatch.ca/downloads/expiring-3m.csv: every contract ending within 3 months of the data date");
    expect(llms).toContain("https://awardwatch.ca/downloads/expiring-12m.csv: every contract ending within 12 months of the data date, each listed once across sources (part of Pro once accounts open)");
    // The free views link only the 3-month file; the full deep lists the 12-month one.
    for (const path of ["/expiring", "/expiring/3m"]) {
      const page = await html(path, on());
      expect(page, path).toContain(FREE);
      expect(page, path).not.toContain(GATED);
    }
    for (const path of ["/expiring/6m", "/expiring/12m"]) expect(await html(path, off()), path).toContain(`<a href="${GATED}" class="btn">`);
  });
});

describe("the feeds", () => {
  // feeds.py writes the expiring feeds from the rows that entered the 3-month
  // window, linked to /expiring/3m; the methodology page says the same. So
  // the gate leaves them alone.
  it("cover the 3-month window, and stay open and listed for a free request", async () => {
    await sessions();
    const methodology = await html("/methodology", off());
    expect(methodology).toContain("The feeds carry the contracts that came within 3 months of their end since the previous run");
    for (const cookie of [undefined, freeCookie]) {
      const feed = await get("/data/feeds/canada/expiring.xml", { env: on(), cookie });
      expect(feed.status).toBe(200);
      expect(await feed.text()).toBe(FEED_XML);
      expect(noRail(await html("/feeds", on(), cookie))).toBe(noRail(await html("/feeds", off())));
    }
    const overview = await html("/expiring", on());
    expect(overview).toContain('<a href="/data/feeds/canada/expiring.xml" class="btn">Atom feed of contracts now within 3 months of their end</a>');
  });
});

describe("the methodology page", () => {
  it("says, in both languages and with no price, that the deep windows are part of Pro", async () => {
    const en = await html("/methodology", off());
    expect(en).toContain("<li>The full 6-month and 12-month lists and the 12-month CSV file are part of Pro, the site&#39;s paid plan; every reader still sees their counts, their totals and their first 10 contracts.</li>");
    const fr = nbsp(await html("/methodology?lang=fr", off()));
    expect(fr).toContain("<li>Les listes complètes de 6 et de 12 mois et le fichier CSV de 12 mois font partie de Pro, le forfait payant du site; chaque lecteur en voit toujours le nombre, le total et les 10 premiers contrats.</li>");
    // The sentence follows the one that defines the windows.
    expect(en.indexOf("The full 6-month and 12-month lists")).toBeGreaterThan(en.indexOf("The windows are cumulative"));
  });
});

describe("no route but the window page serves a deep window's rows to a free request", () => {
  // Every GET route the app has, each with sample values; a route this list
  // does not know yet is still asked, its parameters filled with "x".
  const SAMPLES: Record<string, string[]> = {
    "/tenders/:reference": ["/tenders/cb-100-10000001"],
    "/awards/:key": ["/awards/2026", "/awards/cb-400-40000004"],
    "/history/:reference": ["/history/w8472-000633"],
    "/expiring/:window": ["/expiring/3m", "/expiring/6m", "/expiring/12m", "/expiring/6m?page=2", "/expiring/12m?buyer=dnd-mdn&page=2&lang=fr"],
    "/organizations/directory/:code": ["/organizations/directory/on"],
    "/organizations/directory/:code/:page": ["/organizations/directory/on/1"],
    "/organizations/:id": ["/organizations/org-a000000001"],
    "/organizations/:id/respond": ["/organizations/org-a000000001/respond"],
    "/buyers/:id": ["/buyers/pwgsc-tpsgc", "/buyers/dnd-mdn"],
    "/segments/:nn": ["/segments/82", "/segments/43"],
    "/categories/:nn": ["/categories/82"],
    "/rankings/:year": ["/rankings/2026"],
    "/api/organizations/:id": ["/api/organizations/org-a000000001"],
    "/api/tenders/:reference": ["/api/tenders/cb-100-10000001"],
    "/api/buyers/:id": ["/api/buyers/pwgsc-tpsgc", "/api/buyers/dnd-mdn"],
    "/api/categories/:nn": ["/api/categories/82"],
    "/data/feeds/*": ["/data/feeds/canada/expiring.xml", "/data/feeds/canada/tenders.xml"],
    "/data/expiring/6m/*": FILE_PATHS.filter((p) => p.includes("/6m/")),
    "/data/expiring/12m/*": FILE_PATHS.filter((p) => p.includes("/12m/")),
    "/downloads/:file{.+}": ["/downloads/expiring-12m.csv", "/downloads/expiring-3m.csv"],
  };
  const samplesOf = (route: string): string[] => {
    if (SAMPLES[route]) return SAMPLES[route];
    if (route.includes("sitemap")) return ["/sitemap.xml", "/sitemap-1.xml"];
    return [route.replace(/:[A-Za-z_]+(\{[^}]*\})?/g, "x").replace(/\*/g, "x")];
  };
  const routes = [...new Set(app.routes.filter((r) => r.method === "GET" && r.path !== "*" && r.path !== "/*").map((r) => r.path))];

  it("asks every GET route, the window page and the window files among them", () => {
    for (const route of ["/expiring", "/expiring/:window", "/data/expiring/6m/*", "/data/expiring/12m/*", "/api/stats", "/account/sign-in"]) {
      expect(routes, route).toContain(route);
    }
  });

  it("reads a deep window's files only on its own page (the index and the first page), and shows none of the rows past the free ones", async () => {
    await sessions();
    const readers = new Map<string, string[]>();
    for (const route of routes) {
      for (const path of samplesOf(route)) {
        for (const cookie of [undefined, freeCookie]) {
          const paths: string[] = [];
          const keys: string[] = [];
          const res = await get(path, { env: on(radarAssets(paths), csvBucket(keys)), cookie });
          const body = await res.text();
          const who = `${path} (${cookie ? "free session" : "no session"})`;
          expect(hasHidden(body), who).toEqual([]);
          // Nothing reads the 12-month CSV from the bucket for such a request.
          expect(keys, who).not.toContain("downloads/expiring-12m.csv");
          const deep = paths.filter((p) => /^\/data\/expiring\/(6m|12m)\//.test(p));
          if (deep.length) readers.set(path, [...new Set([...(readers.get(path) ?? []), ...deep])]);
        }
      }
    }
    expect(Object.fromEntries(readers)).toEqual({
      "/expiring/6m": ["/data/expiring/6m/index.json", "/data/expiring/6m/1.json"],
      "/expiring/12m": ["/data/expiring/12m/index.json", "/data/expiring/12m/1.json"],
      "/expiring/6m?page=2": ["/data/expiring/6m/index.json", "/data/expiring/6m/1.json"],
      "/expiring/12m?buyer=dnd-mdn&page=2&lang=fr": ["/data/expiring/12m/index.json", "/data/expiring/12m/1.json"],
    });
  });
});
