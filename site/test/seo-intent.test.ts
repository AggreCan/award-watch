// Search framing (docs/seo.md): the result-list titles and descriptions of
// the section pages in both languages, the structured data, the Pro page and
// its price, the language alternates, the social card, the sitemaps with
// their French entries and the published contracts' parts, the footer's link
// and the home page's lines. test/seo.test.ts keeps the per-page metadata it already held.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { RULES } from "../src/account/entitlements";
import { app } from "../src/index";
import { homeRequest } from "./home";
import { CONTRACT_SITEMAP_SQL } from "../src/records_tables";
import { proIncludes } from "../src/pages/pro";
import { DESCRIPTION_MAX, TITLE_MAX, expiringWindowSeo } from "../src/seo";
import { CONTRACT_PARTS, SITEMAP_PART_MAX, SITEMAP_URL_MAX, contractPartKeys, withLanguages } from "../src/sitemaps";
import { onEnv, offEnv, useAccountsDb } from "./accounts-helpers";
import { testEnv } from "./assets";
import { applySql } from "./setup";
import sitemapPart from "./fixtures/sitemap-1.xml?raw";
import sitemapIndex from "./fixtures/sitemap-index.xml?raw";
import exportStatic from "../../pipeline/awardwatch_pipeline/export_static.py?raw";
import seoDoc from "../../docs/seo.md?raw";

useAccountsDb();

const O = "https://awardwatch.ca";
const EM_DASH = String.fromCharCode(0x2014);
const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;

let address = 0;
const get = (path: string, e: object = onEnv()) =>
  homeRequest(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `203.0.113.${(address++ % 250) + 1}` } }, e);
const html = async (path: string, e: object = onEnv()) => (await get(path, e)).text();
const headOf = (page: string) => page.slice(0, page.indexOf("</head>"));
const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const titleOf = (head: string) => decode(head.match(/<title>([^<]*)<\/title>/)?.[1] ?? "");
const metaOf = (head: string, name: string) =>
  decode(head.match(new RegExp(`<meta (?:name|property)="${name.replace(/[:.]/g, "\\$&")}" content="([^"]*)"`))?.[1] ?? "");
const jsonLd = (page: string): any[] =>
  [...headOf(page).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const alternatesOf = (head: string) =>
  Object.fromEntries([...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));

// Test figures, not the site's prices: the code holds none.
const PAY = {
  STRIPE_SECRET_KEY: "sk_test_fake0000", STRIPE_WEBHOOK_SECRET: "whsec_fake0000",
  STRIPE_PRICE_MONTHLY: "price_monthlyTEST", STRIPE_PRICE_YEARLY: "price_yearlyTEST",
  PRICE_MONTHLY_CAD: "21.50", PRICE_YEARLY_CAD: "215.00",
};
const payEnv = (extra: Record<string, unknown> = {}) => onEnv({ ...PAY, ...extra });

// The home page and every section page a result list should show. The 6-
// and 12-month windows have no fixture files here; their result-list titles
// come from the same function as the 3-month window's (checked below).
const SECTIONS = [
  "/", "/overview", "/tenders", "/tenders/new", "/tenders/same-day", "/awards", "/awards/erroneous", "/expiring", "/expiring/3m",
  "/organizations", "/buyers", "/segments", "/rankings", "/feeds", "/alerts", "/watchlist", "/methodology", "/data", "/cite",
  "/corrections", "/about", "/terms", "/privacy", "/pro", "/analytics",
];

describe("result-list titles and descriptions", () => {
  it("fit a result list and differ from page to page, in both languages", async () => {
    for (const lang of ["en", "fr"] as const) {
      const titles = new Map<string, string>();
      const descriptions = new Map<string, string>();
      for (const path of SECTIONS) {
        const url = lang === "fr" ? `${path}?lang=fr` : path;
        const res = await get(url, payEnv());
        expect(res.status, url).toBe(200);
        const head = headOf(await res.text());
        const title = titleOf(head);
        const description = metaOf(head, "description");
        expect(title.length, `${url}: ${title}`).toBeLessThanOrEqual(TITLE_MAX);
        expect(description.length, `${url}: ${description}`).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(description.length, url).toBeGreaterThanOrEqual(60);
        expect(head, url).not.toContain(EM_DASH);
        expect(titles.has(title), `${url} repeats ${titles.get(title)}'s title`).toBe(false);
        expect(descriptions.has(description), `${url} repeats ${descriptions.get(description)}'s description`).toBe(false);
        titles.set(title, url);
        descriptions.set(description, url);
      }
    }
  });

  it("name what a reader searches for", async () => {
    const titles = Object.fromEntries(await Promise.all(SECTIONS.map(async (p) => [p, titleOf(headOf(await html(p)))])));
    expect(titles["/"]).toBe("Award Watch: Federal Tenders, Awards and Contracts Ending");
    // The app home at its own address names the day, apart from the site's own title at "/".
    expect(titles["/overview"]).toBe("Today's Federal Tenders, Awards and Contracts Ending");
    expect(titles["/tenders"]).toContain("CanadaBuys");
    expect(titles["/awards"]).toContain("Who Won");
    expect(titles["/expiring/3m"]).toBe("Federal Contracts Ending Within 3 Months | Award Watch");
    for (const lang of ["en", "fr"] as const) {
      for (const w of ["3m", "6m", "12m"]) {
        const seo = expiringWindowSeo(`/expiring/${w}`, "heading", lang, [], { n: 12_345, months: "12", date: "2026-10-31", noindex: false });
        expect(seo.title!.length, `${lang} ${w}`).toBeLessThanOrEqual(TITLE_MAX);
        expect(seo.description.length, `${lang} ${w}`).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(seo.title, `${lang} ${w}`).not.toContain("heading");
      }
    }
    expect(expiringWindowSeo("/expiring/12m", "x", "en", [], { n: 1, months: "12", date: "2026-10-31", noindex: false }).title)
      .toBe("Federal Contracts Ending Within 12 Months | Award Watch");
    expect(titles["/pro"]).toBe("Pro: Federal Tender Alerts and Recompetes | Award Watch");
    const fr = nbsp(titleOf(headOf(await html("/tenders?lang=fr"))));
    expect(fr).toBe("Appels d’offres ouverts d’AchatsCanada | Award Watch");
    // The page's own heading stays as it was; only the result list changes.
    expect(await html("/expiring/3m")).toContain("<h1>Contracts Ending Within 3 Months</h1>");
  });
});

describe("structured data", () => {
  it("parses on every page that carries it, in both languages", async () => {
    const pages = ["/", "/data", "/pro", "/tenders/cb-100-10000001", "/awards/cb-400-40000004", "/organizations/org-a000000001",
      "/buyers/pwgsc-tpsgc", "/segments/82", "/expiring/3m", "/tenders/same-day"];
    for (const lang of ["en", "fr"] as const) {
      for (const path of pages) {
        const url = lang === "fr" ? `${path}?lang=fr` : path;
        const blocks = jsonLd(await html(url, payEnv()));
        expect(blocks.length, url).toBeGreaterThan(0);
        for (const b of blocks) {
          expect(b["@context"], url).toBe("https://schema.org");
          expect(JSON.stringify(b), url).not.toContain(EM_DASH);
        }
      }
    }
  });

  it("names the site with its search and Allwater Software Inc. as publisher on the home page", async () => {
    for (const lang of ["en", "fr"] as const) {
      const [graph] = jsonLd(await html(lang === "fr" ? "/?lang=fr" : "/"));
      const org = graph["@graph"].find((n: any) => n["@type"] === "Organization");
      expect(org.name).toBe("Allwater Software Inc.");
      expect(org.address).toEqual({ "@type": "PostalAddress", addressRegion: "BC", addressCountry: "CA" });
      expect(org.url).toBe(lang === "fr" ? `${O}/about?lang=fr` : `${O}/about`);
      const site = graph["@graph"].find((n: any) => n["@type"] === "WebSite");
      expect(site.potentialAction["@type"]).toBe("SearchAction");
      expect(site.potentialAction["query-input"]).toBe("required name=search_term_string");
      expect(site.potentialAction.target.urlTemplate).toBe(`${O}/search?q={search_term_string}${lang === "fr" ? "&lang=fr" : ""}`);
    }
    // The logo the markup names is served.
    const assets = (env as unknown as { ASSETS: Fetcher }).ASSETS;
    expect((await assets.fetch(new Request(`${O}/brand/mark-512.png`))).status).toBe(200);
  });

  it("describes each downloadable set on the Data page as a Dataset with its licence and its source", async () => {
    for (const lang of ["en", "fr"] as const) {
      const [dataset] = jsonLd(await html(lang === "fr" ? "/data?lang=fr" : "/data", offEnv()));
      const ogl = lang === "fr" ? "https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada"
        : "https://open.canada.ca/en/open-government-licence-canada";
      expect(dataset.hasPart.map((p: any) => p["@id"].split("#")[1])).toEqual([
        "open-tenders", "awards", "history", "contracts", "grants", "organizations", "organization-aliases", "buyers", "expiring-3m",
      ]);
      for (const part of dataset.hasPart) {
        expect(part["@type"]).toBe("Dataset");
        expect(part.license).toBe(ogl);
        expect(part.description.length, part.name).toBeGreaterThanOrEqual(50);
        expect(part.isBasedOn.length).toBeGreaterThan(0);
        for (const src of part.isBasedOn) expect(src).toMatch(/^https:\/\/open\.canada\.ca\/data\/(en|fr)\/dataset\//);
        for (const d of part.distribution) {
          expect(d.encodingFormat).toBe("text/csv");
          expect(d.license).toBe(ogl);
          expect(d.contentUrl).toBe(`${O}/downloads/${d.name}`);
        }
      }
      // A yearly set lists a file a year from its first year to the data year.
      const contracts = dataset.hasPart.find((p: any) => p["@id"].endsWith("#contracts"));
      expect(contracts.temporalCoverage).toBe("2004/..");
      expect(contracts.distribution[0].name).toBe("contracts-2026.csv");
      expect(contracts.distribution.at(-1).name).toBe("contracts-2004.csv");
      expect(JSON.stringify(dataset)).not.toContain("expiring-12m");
    }
  });

  it("carries a BreadcrumbList on record pages, each crumb but the last with its address", async () => {
    for (const path of ["/tenders/cb-100-10000001", "/awards/cb-400-40000004", "/history/w8472-000633", "/organizations/org-a000000001",
      "/buyers/pwgsc-tpsgc", "/segments/82"]) {
      const crumbs = jsonLd(await html(path)).find((b) => b["@type"] === "BreadcrumbList");
      expect(crumbs, path).toBeDefined();
      const items = crumbs.itemListElement;
      expect(items.map((i: any) => i.position)).toEqual(items.map((_: unknown, n: number) => n + 1));
      expect(items[0]).toEqual({ "@type": "ListItem", position: 1, name: "Home", item: `${O}/` });
      expect(items.at(-1).item, path).toBeUndefined();
    }
  });
});

describe("the Pro page", () => {
  it("states what Pro includes, who it is for, what stays free, the price from the variables, and the way in", async () => {
    const res = await get("/pro", payEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const page = decode(await res.text());
    expect(page).toContain("<h1>Pro: Email Alerts on Tenders, Awards and Contracts Ending</h1>");
    expect(page).toContain("Pro emails you new notices that match your saved searches, and each award, amendment or end date within 6 or 12 months");
    expect(page).toContain('<p class="pro-price">Pro is CA$21.50 a month or CA$215.00 a year, taxes added at checkout. ' +
      "The first payment is refunded in full if you ask within 14 days.</p>");
    // The refund is one of the page's questions, with the address to write to, and the Terms say the same.
    expect(page).toContain("Can I get a refund?");
    expect(page).toContain("Yes, of your first payment: write to contact@awardwatch.ca from your account's address within 14 days of it.");
    const terms = decode(await (await get("/terms", payEnv())).text());
    expect(terms).toContain("<h3>Refund of the First Payment</h3><p>If you ask within 14 days of your first payment for Pro, monthly or yearly, " +
      "Allwater refunds that payment in full, taxes included, to the payment method used, and ends the subscription. " +
      "Write to contact@awardwatch.ca from the account's address.");
    expect(terms).toContain("This applies once per account and to the first payment only");
    expect(terms).toContain("except under Refund of the First Payment and where the law requires a refund");
    expect(terms.indexOf("<h3>Cancellation</h3>")).toBeLessThan(terms.indexOf("<h3>Refund of the First Payment</h3>"));
    // The way in for a reader not signed in: Subscribe, through the sign-in page back to billing, the steps under it.
    expect(page).toContain('<a href="/account/sign-in?next=/account/billing" class="btn btn-primary">Subscribe to Pro</a>');
    expect(page).toContain("Enter your email, type the 6-digit code the site sends, then pay monthly or yearly on Stripe's page. There is no password.");
    expect(page).toContain("<h3>What arrives by email, and when?</h3>");
    expect(page).toContain("<h3>Can I cancel?</h3><p>Yes, at any time: Plan and Billing in your account opens Stripe's page, where you cancel.");
    // What Pro includes is the plan cards, straight under the section's head:
    // Free beside Pro, every line of the Pro card one of proIncludes, the
    // price on its price line, and no link to the page itself.
    expect(page).toContain('<h2 id="includes">What Pro Includes</h2><div class="plan-cards"');
    const cards = /<div class="plan-cards"[\s\S]*?<\/p><\/div><\/div><p>/.exec(page)?.[0] ?? "";
    const [free, pro] = cards.split(/(?=<div class="plan-card[ "])/).slice(1);
    expect(free).toContain("<h3>Free</h3>");
    expect(pro).toContain('<div class="plan-card plan-card-offer"><div class="plan-card-head"><h3>Pro</h3>');
    for (const i of proIncludes("en")) expect(pro).toContain(`<span>${i.text}</span>`);
    expect(pro.match(/<li/g)).toHaveLength(proIncludes("en").length);
    expect(free.match(/<li/g)).toHaveLength(proIncludes("en").length);
    expect(pro).toContain('<strong class="plan-amount">CA$21.50</strong> a month or CA$215.00 a year');
    expect(cards).not.toContain('href="/pro"');
    // The head carries no offer of its own: the cards follow it.
    expect(/<header class="page-head">[\s\S]*?<\/header>/.exec(page)?.[0]).not.toContain("pro-offer");
    expect(page).toContain("<h2 id=\"who\">Who It Is For</h2>");
    expect(page).toContain("<h2 id=\"free\">What Stays Free</h2>");
    expect(page).toContain("Allwater Software Inc.");
    expect(page).not.toContain(EM_DASH);
    for (const word of ["powerful", "seamless", "unlock", "leverage", "cutting-edge", "limited time", "hurry"]) {
      expect(page.toLowerCase(), word).not.toContain(word);
    }
    const [product, faq] = jsonLd(page);
    expect(product["@type"]).toBe("Product");
    expect(product.name).toBe("Award Watch Pro");
    expect(product.offers.map((o: any) => [o.price, o.priceCurrency, o.priceSpecification.referenceQuantity.unitCode])).toEqual([
      ["21.50", "CAD", "MON"], ["215.00", "CAD", "ANN"],
    ]);
    for (const o of product.offers) {
      expect(o.priceSpecification.valueAddedTaxIncluded).toBe(false);
      expect(o.seller.name).toBe("Allwater Software Inc.");
    }
    // The questions, word for word as the page shows them.
    expect(faq["@type"]).toBe("FAQPage");
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(4);
    // The price, when Pro is on sale, and seven standing questions, the refund of the first payment among them.
    expect(faq.mainEntity.length).toBeLessThanOrEqual(8);
    // The one page allowed the capture manager's word (the radar never says it).
    expect(page).toContain("the recompetes in their field");
    expect(page).toContain("<h3>Does Pro show recompetes?</h3>");
    for (const q of faq.mainEntity) {
      expect(page).toContain(`<h3>${q.name}</h3>`);
      expect(page).toContain(`<p>${q.acceptedAnswer.text}</p>`);
    }
    expect(faq.mainEntity[0].acceptedAnswer.text).toContain("CA$21.50 a month or CA$215.00 a year");
  });

  it("prints the figures with a decimal comma in French", async () => {
    const page = nbsp(decode(await html("/pro?lang=fr", payEnv())));
    expect(page).toContain("<h1>Pro : alertes par courriel sur les appels d’offres, attributions et fins de contrat</h1>");
    expect(page).toContain("Pro coûte 21,50 $ CA par mois ou 215,00 $ CA par année, taxes ajoutées au paiement.");
    const [product, faq] = jsonLd(page);
    // The markup keeps the decimal point, as schema.org reads a price.
    expect(product.offers[0].price).toBe("21.50");
    expect(faq.inLanguage).toBe("fr");
    expect(page).toContain("remises en concurrence");
  });

  it("names no price and carries no Product while the checkout is not configured", async () => {
    for (const e of [onEnv(), payEnv({ STRIPE_SECRET_KEY: "" }), payEnv({ PRICE_YEARLY_CAD: "" }), payEnv({ STRIPE_PRICE_MONTHLY: "monthly" })]) {
      const page = decode(await html("/pro", e));
      // Free's CA$0 is the only amount; the Pro card says it is not on sale.
      expect(page.match(/CA\$[0-9.]*/g)).toEqual(["CA$0"]);
      expect(page).not.toContain("pro-price");
      expect(page).toContain("Paying for Pro is not available yet.");
      expect(page).toContain('<span class="plan-figure"><span class="muted">Not on sale yet</span></span>');
      expect(page).not.toContain("Taxes added at checkout.");
      const blocks = jsonLd(page);
      expect(blocks.map((b) => b["@type"])).toEqual(["FAQPage"]);
      expect(blocks[0].mainEntity.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("lists only what the plans give Pro and not the Free plan", () => {
    for (const lang of ["en", "fr"] as const) {
      for (const { feature } of proIncludes(lang)) {
        const pro = RULES.pro[feature];
        const free = RULES.free[feature];
        expect(typeof pro === "number" ? pro > (free as number) : pro && !free, feature).toBe(true);
      }
    }
  });

  it("is the site's 404 while the accounts switch is off", async () => {
    const res = await get("/pro", { ...offEnv(), ...PAY });
    expect(res.status).toBe(404);
  });
});

describe("links to the Pro page", () => {
  it("sit in the footer while the switch is on, in both languages, and nowhere while it is off", async () => {
    for (const path of ["/", "/tenders", "/methodology", "/nothing-here"]) {
      expect(await html(path), path).toContain('<a href="/pro">Pro plan</a>');
      expect(await html(path, offEnv()), path).not.toContain('href="/pro"');
    }
    expect(await html("/data?lang=fr")).toContain('<a href="/pro">Forfait Pro</a>');
  });

  it("follow the sign-in button of a tease panel for a reader not signed in", async () => {
    const page = await html("/tenders/same-day");
    const panel = /<section class="panel pro-panel">[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";
    expect(panel).toContain('<a href="/account/sign-in?next=/account/billing" class="btn btn-primary">Subscribe to Pro</a> <a href="/pro" class="btn">About Pro</a>');
  });
});

describe("the home page", () => {
  it("leads with what a reader comes for, counting the contracts ending within 12 months from the expiring index", async () => {
    const page = decode(await html("/"));
    expect(page).toContain("<h1>Federal Tenders, Who Won, and Contracts Ending</h1>");
    expect(page).toContain("Every tender open on CanadaBuys, who won each federal contract, and the 8 contracts ending within 12 months with the supplier that holds each one.");
    const fr = nbsp(decode(await html("/?lang=fr")));
    expect(fr).toContain("et les 8 contrats qui prennent fin d’ici 12 mois, avec le fournisseur qui détient chacun.");
  });

  it("says what a reader can do, each line led by its link, with the email line only while Pro exists", async () => {
    const on = decode(await html("/"));
    const panel = /<section class="panel home-do">[\s\S]*?<\/section>/.exec(on)?.[0] ?? "";
    expect(panel).toContain("<h2>What You Can Do Here</h2>");
    for (const href of ["/tenders", "/awards", "/expiring"]) expect(panel).toContain(`<li><a href="${href}">`);
    expect(panel).toContain('<li class="home-do-pro"><a href="/pro">Get it by email with Pro</a>: new notices matching your searches, and the awards, ' +
      "amendments and end dates of what you follow, daily or weekly. Same-day notices show on the site every 2 hours.</li>");
    // The head's first button leads to the Pro page while the switch is on, to the feeds while it is off.
    expect(on).toContain('<a href="/pro" class="btn">Email alerts with Pro</a>');
    expect(panel).not.toContain("pro-tag");
    // The cards come first, then these lines, then the lists.
    expect(on.indexOf('class="tiles"')).toBeLessThan(on.indexOf("home-do"));
    expect(on.indexOf("home-do")).toBeLessThan(on.indexOf("New Tender Notices"));
    const off = decode(await html("/", offEnv()));
    expect(off).toContain("<h2>What You Can Do Here</h2>");
    expect(off).not.toContain("home-do-pro");
    expect(off).toContain('<a href="/feeds" class="btn">Atom feeds</a>');
    expect(off).not.toContain("Email alerts with Pro");
    const fr = nbsp(decode(await html("/?lang=fr")));
    expect(fr).toContain("<h2>Ce que vous pouvez faire ici</h2>");
    expect(fr).toContain('<a href="/pro">Tout recevoir par courriel avec Pro</a> :');
  });
});

describe("language alternates", () => {
  it("pair each page's two versions both ways, each naming itself as canonical", async () => {
    for (const path of ["/", "/overview", "/tenders", "/pro", "/data", "/organizations/org-a000000001", "/expiring/3m", "/segments/82", "/tenders/same-day"]) {
      const en = headOf(await html(path, payEnv()));
      const fr = headOf(await html(`${path}?lang=fr`, payEnv()));
      const pair = { en: `${O}${path}`, fr: `${O}${path}?lang=fr`, "x-default": `${O}${path}` };
      expect(alternatesOf(en), path).toEqual(pair);
      expect(alternatesOf(fr), path).toEqual(pair);
      expect(en, path).toContain(`<link rel="canonical" href="${O}${path}"/>`);
      expect(decode(fr), path).toContain(`<link rel="canonical" href="${O}${path}?lang=fr"/>`);
      expect(metaOf(fr, "og:locale")).toBe("fr_CA");
    }
  });
});

// -- social cards ------------------------------------------------------------------------------

// A PNG's width and height, from the IHDR chunk that follows the 8-byte signature.
const pngSize = (bytes: ArrayBuffer) => {
  const view = new DataView(bytes);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

describe("social cards", () => {
  it("share the 1200 x 630 card as a large-image card on every section page, in both languages", async () => {
    const card = `${O}/brand/og-home.png`;
    const alt = {
      en: "Award Watch: federal tenders, awards and contracts in Canada",
      fr: "Award Watch : appels d’offres, attributions et contrats fédéraux au Canada",
    };
    for (const lang of ["en", "fr"] as const) {
      for (const path of SECTIONS) {
        const url = lang === "fr" ? `${path}?lang=fr` : path;
        const head = headOf(await html(url, payEnv()));
        expect(metaOf(head, "twitter:card"), url).toBe("summary_large_image");
        expect(metaOf(head, "og:image"), url).toBe(card);
        expect(metaOf(head, "og:image:type"), url).toBe("image/png");
        expect(metaOf(head, "og:image:width"), url).toBe("1200");
        expect(metaOf(head, "og:image:height"), url).toBe("630");
        expect(metaOf(head, "twitter:image"), url).toBe(card);
        expect(nbsp(metaOf(head, "og:image:alt")), url).toBe(alt[lang]);
        expect(nbsp(metaOf(head, "twitter:image:alt")), url).toBe(alt[lang]);
        // No social tag names the square mark any more.
        expect(head, url).not.toMatch(/<meta (?:name|property)="(?:og|twitter):[^"]*" content="[^"]*mark-512/);
      }
    }
    // The card is served, at the size the tags state.
    const assets = (env as unknown as { ASSETS: Fetcher }).ASSETS;
    const res = await assets.fetch(new Request(card));
    expect(res.status).toBe(200);
    expect(pngSize(await res.arrayBuffer())).toEqual({ width: 1200, height: 630 });
  });

  it("keep the square mark as the publisher's logo in the structured data", async () => {
    const logo = { "@type": "ImageObject", url: `${O}/brand/mark-512.png`, width: 512, height: 512 };
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const [graph] = jsonLd(await html(`/${q}`));
      expect(graph["@graph"].find((n: any) => n["@type"] === "Organization").logo, lang).toEqual(logo);
      const [dataset] = jsonLd(await html(`/data${q}`, offEnv()));
      expect(dataset.publisher.logo, lang).toEqual(logo);
      const [product] = jsonLd(await html(`/pro${q}`, payEnv()));
      for (const o of product.offers) expect(o.seller.logo, lang).toEqual(logo);
    }
    const assets = (env as unknown as { ASSETS: Fetcher }).ASSETS;
    const res = await assets.fetch(new Request(`${O}/brand/mark-512.png`));
    expect(res.status).toBe(200);
    expect(pngSize(await res.arrayBuffer())).toEqual({ width: 512, height: 512 });
  });
});

// -- sitemaps ----------------------------------------------------------------------------------

const locsOf = (xml: string) => [...xml.matchAll(/<url><loc>([^<]*)<\/loc>/g)].map((m) => decode(m[1]));

describe("the sitemap parts", () => {
  it("list each page in English and in French, each with the alternates of both", async () => {
    const xml = await (await get("/sitemap-1.xml")).text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">')).toBe(true);
    const urls = [...xml.matchAll(/<url>[\s\S]*?<\/url>/g)].map((m) => m[0]);
    expect(urls).toHaveLength(2 * locsOf(sitemapPart).length);
    for (const u of urls) {
      const loc = decode(/<loc>([^<]*)<\/loc>/.exec(u)?.[1] ?? "");
      const path = loc.replace(O, "").replace("?lang=fr", "");
      const links = [...u.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)"\/>/g)].map((m) => [m[1], decode(m[2])]);
      expect(links).toEqual([["en", `${O}${path}`], ["fr", `${O}${path}?lang=fr`], ["x-default", `${O}${path}`]]);
    }
    expect((xml.match(/<url>/g) ?? []).length).toBe((xml.match(/<\/url>/g) ?? []).length);
    expect(xml).not.toContain(EM_DASH);
  });

  it("keep within the protocol's 50,000 URLs: a part over the pipeline's size keeps one entry a page", () => {
    const part = (n: number) =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
        Array.from({ length: n }, (_, i) => `<url><loc>${O}/organizations/org-${i.toString(16).padStart(10, "0")}</loc><lastmod>2026-10-31</lastmod></url>`).join("\n")
      }\n</urlset>\n`;
    const full = withLanguages(part(SITEMAP_PART_MAX));
    expect((full.match(/<url>/g) ?? []).length).toBe(SITEMAP_URL_MAX);
    const over = withLanguages(part(SITEMAP_PART_MAX + 1));
    expect((over.match(/<url>/g) ?? []).length).toBe(SITEMAP_PART_MAX + 1);
    expect(over).toContain(`<xhtml:link rel="alternate" hreflang="fr" href="${O}/organizations/org-0000000000?lang=fr"/>`);
    // Dates pass through; an address with a query is left as it was.
    expect(full).toContain("<lastmod>2026-10-31</lastmod>");
    expect(withLanguages(`<urlset><url><loc>${O}/tenders?segment=82</loc></url></urlset>`)).toContain(`<url><loc>${O}/tenders?segment=82</loc></url>`);
  });

  it("hold the pipeline to the same size, and list the Pro page, the same-day page, the analytics index and the overview", () => {
    expect(/^SITEMAP_MAX_URLS = ([0-9_]+)$/m.exec(exportStatic)?.[1]?.replace(/_/g, "")).toBe(String(SITEMAP_PART_MAX));
    const pages = /^SITEMAP_PAGES = \[([\s\S]*?)\]/m.exec(exportStatic)?.[1] ?? "";
    for (const path of ["/pro", "/tenders/same-day", "/analytics", "/expiring", "/data", "/overview"]) expect(pages).toContain(`"${path}"`);
    // The overview follows the night's data, so it carries the data date as "/" does.
    const dated = /^SITEMAP_DATED_PAGES = \{([\s\S]*?)\}/m.exec(exportStatic)?.[1] ?? "";
    for (const path of ["/", "/overview"]) expect(dated).toContain(`"${path}"`);
  });
});

// The published contracts' parts, from a records database built from
// pipeline/records_schema.sql. Keys at the edges of the 64-bit range go in
// as text, which SQLite stores as the exact integer.
const KEYS = {
  first: "-9223372036854775808",                       // part 1's first key
  firstLast: contractPartKeys(1)[1],                    // part 1's last key
  second: contractPartKeys(2)[0],                       // part 2's first key
  zero: "0",                                            // part 65's first key
  last: "9223372036854775807",                          // part 128's last key
};

async function seedRecords(state: string): Promise<void> {
  await applySql(RECORDS, RECORDS_SCHEMA);
  await RECORDS.batch(["rec_contracts", "rec_meta"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  const rows: [string, string, string][] = [
    [KEYS.first, "dnd-mdn", "C-FIRST"], [KEYS.firstLast, "hc-sc", "W8486-123456/001/ZM"], [KEYS.second, "dnd-mdn", "C-SECOND"],
    [KEYS.zero, "DND-MDN", "C-ZERO"], [KEYS.last, "dnd-mdn", "C-LAST"], ["12345", "Not a dept!", "C-BAD"],
  ];
  await RECORDS.batch([
    ...rows.map(([k, dept, ref]) => RECORDS.prepare("INSERT INTO rec_contracts (k, dept, ref) VALUES (CAST(?1 AS INTEGER), ?2, ?3)").bind(k, dept, ref)),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', ?1), ('as_of', '2026-10-31')").bind(state),
  ]);
}

describe("the published contracts' sitemaps", () => {
  beforeAll(() => seedRecords("ready"));

  it("cut the key space into equal ranges that cover it once", () => {
    expect(contractPartKeys(1)).toEqual([KEYS.first, "-9079256848778919937"]);
    expect(contractPartKeys(65)[0]).toBe("0");
    expect(contractPartKeys(CONTRACT_PARTS)[1]).toBe(KEYS.last);
    for (let n = 1; n < CONTRACT_PARTS; n++) expect(BigInt(contractPartKeys(n + 1)[0])).toBe(BigInt(contractPartKeys(n)[1]) + 1n);
  });

  it("list each contract of the part in both languages, at the page's own address", async () => {
    const one = await get("/sitemap-contracts-1.xml");
    expect(one.status).toBe(200);
    expect(one.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(locsOf(await one.text())).toEqual([
      `${O}/contracts/dnd-mdn/C-FIRST`, `${O}/contracts/dnd-mdn/C-FIRST?lang=fr`,
      `${O}/contracts/hc-sc/W8486-123456%2F001%2FZM`, `${O}/contracts/hc-sc/W8486-123456%2F001%2FZM?lang=fr`,
    ]);
    expect(locsOf(await html("/sitemap-contracts-2.xml"))).toEqual([`${O}/contracts/dnd-mdn/C-SECOND`, `${O}/contracts/dnd-mdn/C-SECOND?lang=fr`]);
    // A department in capitals at its lower-case address; one the page would refuse is left out.
    expect(locsOf(await html("/sitemap-contracts-65.xml"))).toEqual([`${O}/contracts/dnd-mdn/C-ZERO`, `${O}/contracts/dnd-mdn/C-ZERO?lang=fr`]);
    expect(locsOf(await html(`/sitemap-contracts-${CONTRACT_PARTS}.xml`))).toEqual([`${O}/contracts/dnd-mdn/C-LAST`, `${O}/contracts/dnd-mdn/C-LAST?lang=fr`]);
    expect(locsOf(await html("/sitemap-contracts-3.xml"))).toEqual([]);
    // The listed address is one the page answers.
    expect((await get("/contracts/hc-sc/W8486-123456%2F001%2FZM", offEnv())).status).not.toBe(400);
    for (const bad of ["/sitemap-contracts-0.xml", `/sitemap-contracts-${CONTRACT_PARTS + 1}.xml`, "/sitemap-contracts-01.xml", "/sitemap-contracts-x.xml"]) {
      expect((await get(bad)).status, bad).toBe(404);
    }
  });

  it("read one part through the primary key, bounded", async () => {
    expect(CONTRACT_SITEMAP_SQL).toMatch(/LIMIT 25000$/);
    const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${CONTRACT_SITEMAP_SQL}`).bind(...contractPartKeys(7)).all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail)).join("\n");
    expect(steps).toMatch(/SEARCH \w+ USING INTEGER PRIMARY KEY \(rowid>\? AND rowid<\?\)/);
  });

  it("are listed in the index after the pipeline's parts while the records database is ready, and not otherwise", async () => {
    const index = await (await get("/sitemap.xml")).text();
    const pipelineParts = [...sitemapIndex.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    const listed = [...index.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(listed).toEqual([...pipelineParts, ...Array.from({ length: CONTRACT_PARTS }, (_, i) => `${O}/sitemap-contracts-${i + 1}.xml`)]);
    expect(index).toContain(`<sitemap><loc>${O}/sitemap-contracts-1.xml</loc><lastmod>2026-10-31</lastmod></sitemap>`);
    expect(await (await get("/sitemap.xml", { ...onEnv(), RECORDS: undefined })).text()).toBe(sitemapIndex);
    await seedRecords("loading");
    try {
      expect(await (await get("/sitemap.xml")).text()).toBe(sitemapIndex);
      const part = await get("/sitemap-contracts-1.xml");
      expect(part.status).toBe(503);
      expect(part.headers.get("retry-after")).toBe("3600");
      expect(part.headers.get("cache-control")).toBe("no-store");
      expect((await get("/sitemap-contracts-1.xml", { ...onEnv(), RECORDS: undefined })).status).toBe(503);
    } finally {
      await seedRecords("ready");
    }
  });
});

describe("robots.txt and the writing", () => {
  it("keeps crawlers off the account and operator pages, and names the sitemap", async () => {
    const robots = await (await app.request("/robots.txt", {}, env)).text();
    expect(robots).toContain("Disallow: /account\n");
    expect(robots).toContain("Disallow: /admin\n");
    expect(robots).not.toMatch(/Disallow: \/pro\b/);
    expect(robots).toContain(`Sitemap: ${O}/sitemap.xml`);
  });

  it("adds no em-dash and no internal path to the public notes", () => {
    expect(seoDoc).not.toContain(EM_DASH);
    expect(seoDoc).not.toMatch(/site\/src|pipeline\/|\.tsx?\b|\.py\b|CLAUDE/);
  });

  it("keeps the old testEnv pages unchanged where the switch is off", async () => {
    // The test environment the other files use has the switch off: no footer link, no Pro line.
    const page = await html("/", testEnv());
    expect(page).not.toContain('href="/pro"');
  });
});
