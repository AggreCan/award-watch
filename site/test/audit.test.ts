// The fixes from the consistency audit of 2026-11-01 and the changes that
// came with them: the closing-date-passed state, the required email on the
// response form, the UNSPSC segment pages under their own name, sources never
// read, the rail as a tree, the three document pages, CanadaBuys addresses
// without colons, buyer ids that moved, and the smaller copy and layout fixes.
import { describe, expect, it } from "vitest";
import wrangler from "../wrangler.jsonc?raw";
import { clearOfAnchors } from "../src/chart";
import { sourceLoaded, type Profile, type TenderRow } from "../src/data";
import { t } from "../src/i18n";
import { app } from "../src/index";
import { homeRequest } from "./home";
import { closingPassed, tenderState } from "../src/closing";
import { viewKey } from "../src/layout";
import { publisherDay } from "../src/pages/data";
import { REQUEST_LIMITS } from "../src/pages/docs";
import { awardNoticeUrl, closingText, shareText, tenderNoticeUrl } from "../src/pages/shared";
import { filterTenders, readTenderQuery } from "../src/pages/tenders";
import { makeFakeAssets, testClock, testEnv } from "./assets";
import expiring3mPage1 from "./fixtures/expiring-3m-1.json";
import profiles from "./fixtures/profiles-a00.json";
import stats from "./fixtures/stats.json";
import openFirst from "./fixtures/tenders-open-first.json";

let address = 0;
const NAVIGATE = { "sec-fetch-mode": "navigate" };
const get = (path: string, env = testEnv(), headers: Record<string, string> = {}) =>
  homeRequest(path, { headers: { ...NAVIGATE, "cf-connecting-ip": `198.51.100.${(address++ % 250) + 1}`, ...headers } }, env);
const text = async (path: string, env = testEnv()) => (await get(path, env)).text();
const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  homeRequest(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": `198.51.100.${(address++ % 250) + 1}`, ...headers },
    body: new URLSearchParams(fields).toString(),
  }, testEnv());
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const withFiles = (overrides: Record<string, unknown>) => testEnv(makeFakeAssets({}, overrides));
const rail = (html: string) => html.match(/<nav class="rail"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";

const TODAY = testClock;
const firstRows = openFirst.rows as unknown as TenderRow[];
// The first open notice with its closing date moved before the data date.
const passedRow: TenderRow = { ...firstRows[0], closing: "2026-10-20T14:00:00" };

describe("a notice whose closing date has passed", () => {
  it("reads closed (closing date passed) once its closing time has passed, closing soon until then", () => {
    expect(tenderState("open", "2026-10-20T14:00:00", TODAY)).toBe("closed");
    // The clock is at noon Eastern time on 2026-10-31: 09:00 has passed, 14:00 has not.
    expect(tenderState("open", "2026-10-31T09:00:00", TODAY)).toBe("closed");
    expect(tenderState("open", "2026-10-31T14:00:00", TODAY)).toBe("closing");
    expect(tenderState("open", "2026-11-20T14:00:00", TODAY)).toBe("open");
    // The export's own "closed" passes through, and other statuses stay as they are.
    expect(tenderState("closed", "2026-10-20T14:00:00", TODAY)).toBe("closed");
    expect(tenderState("awarded", "2026-10-20T14:00:00", TODAY)).toBe("awarded");
    expect(closingPassed(null, TODAY)).toBe(false);
    expect(t("en", "status.closed")).toBe("Closing date passed");
    expect(t("fr", "status.closed")).toBe("Date de clôture passée");
  });

  it("sorts last by closing date", () => {
    const rows = [passedRow, ...firstRows.slice(1)];
    const sorted = filterTenders(rows, readTenderQuery(new URL("https://x.invalid/tenders")), TODAY);
    expect(sorted.map((r) => r.reference)).toEqual([...firstRows.slice(1).map((r) => r.reference), passedRow.reference]);
  });

  it("shows the state on the open list, last, in both languages", async () => {
    const env = withFiles({ "tenders/open-first.json": { ...openFirst, rows: [passedRow, ...firstRows.slice(1)] } });
    const html = await text("/tenders", env);
    expect(html).toContain('<span class="badge badge-closed">Closing date passed</span>');
    const at = (ref: string) => html.indexOf(`data-ref="${ref}"`);
    expect(at(passedRow.reference)).toBeGreaterThan(at(firstRows[2].reference));
    expect(await text("/tenders?lang=fr", env)).toContain('<span class="badge badge-closed">Date de clôture passée</span>');
  });

  it("is left out of the closing-soon list and its count", async () => {
    const soon = stats.closing_soon[0] as unknown as TenderRow;
    const past = { ...soon, reference: "cb-900-90000009", closing: "2026-10-29T14:00:00" };
    const html = await text("/", withFiles({ "stats.json": { ...stats, closing_soon: [soon, past] } }));
    expect(rail(html)).toContain('<span class="rail-label">Closing within 7 days</span><span class="rail-n" data-soon-count="">1</span>');
    const panel = html.slice(html.indexOf("Closing Within 7 Days"), html.indexOf("Recent Award Notices"));
    expect(panel).toContain(soon.reference);
    expect(panel).not.toContain("cb-900-90000009");
  });

  it("puts a notice the file marks closed after the others on a day's list of new notices", async () => {
    const day = [{ ...firstRows[0], status: "closed", source_status: "open" }, { ...firstRows[1], status: "open" }];
    const html = await text("/tenders/new", withFiles({ "tenders/new/2026-10-31.json": day }));
    expect(html.indexOf(firstRows[1].reference)).toBeLessThan(html.indexOf(firstRows[0].reference));
    expect(html).toContain('<span class="badge badge-closed">Closing date passed</span>');
  });
});

describe("the response form asks for an email address", () => {
  it("marks the address required, says why, in both languages", async () => {
    const en = await text("/organizations/org-a000000001/respond");
    expect(en).toContain("Email address (needed to confirm the statement, never shown)");
    expect(en).toMatch(/<input name="contact" type="email" required="" maxlength="200"/);
    expect(en).toContain("<h1>Respond as This Organization</h1>");
    const fr = nbsp(await text("/organizations/org-a000000001/respond?lang=fr"));
    expect(fr).toContain("Adresse courriel (nécessaire pour confirmer la déclaration, jamais affichée)");
  });

  it("refuses a statement without one, and keeps what was typed", async () => {
    const statement = "Our standing offer covers three departments, each reported separately.";
    const res = await post("/organizations/org-a000000001/respond", { text: statement });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Give an email address so the site can confirm the statement.");
    expect(html).toContain(statement);
    const fr = await post("/organizations/org-a000000001/respond", { text: statement }, { cookie: "lang=fr" });
    expect(await fr.text()).toContain("Indiquez une adresse courriel pour que le site puisse confirmer la déclaration.");
  });

  it("leaves the address optional on the corrections form", async () => {
    const html = await text("/corrections");
    expect(html).toContain("Email address (optional, never shown)");
    expect(html).not.toMatch(/<input name="contact" type="email" required/);
    expect(html).toContain("Correction Request");
    const res = await post("/corrections", { page: "cb-100-10000001", text: "The region of delivery is wrong." });
    expect(res.status).toBe(200);
  });
});

describe("the UNSPSC segment pages", () => {
  it("are named Segments in both languages, apart from the CanadaBuys category", async () => {
    const en = await text("/segments");
    expect(en).toContain("<h1>Procurement by Segment</h1>");
    expect(en).toContain("UNSPSC Segments");
    expect(rail(en)).toContain('<a class="rail-item" href="/segments" aria-current="page"><span class="rail-label">Segments</span></a>');
    const fr = nbsp(await text("/segments?lang=fr"));
    expect(fr).toContain("<h1>Approvisionnement par segment</h1>");
    expect(rail(fr)).toContain('<span class="rail-label">Segments</span>');
    expect(fr).toContain("Avis d’attribution en 2026");
    // The tender list keeps "Category" for CanadaBuys' goods, services and construction.
    const tenders = await text("/tenders");
    expect(tenders).toContain('<span class="field-label">Category</span>');
    expect(tenders).toContain('<span class="field-label">UNSPSC segment</span>');
  });

  it("move the old /categories addresses for good, the query kept", async () => {
    for (const [from, to] of [["/categories", "/segments"], ["/categories?lang=fr", "/segments?lang=fr"], ["/categories/82", "/segments/82"]]) {
      const res = await get(from);
      expect(res.status, from).toBe(301);
      expect(res.headers.get("location"), from).toBe(to);
    }
    expect((await get("/segments/99")).status).toBe(404);
  });

  it("explain the segment chips once on a page, name each chip by number and short name, and leave out the page's own", async () => {
    const note = /The tags after a reference are UNSPSC segments \(the categories buyers code each notice with\), by number and short name\./g;
    // The segment's own page: every row would carry its chip, so none does, and nothing is left to explain.
    const own = await text("/segments/82");
    expect(own).not.toContain('<a href="/segments/82" class="chip"');
    expect(own).not.toMatch(note);
    const html = await text("/tenders");
    expect(html.match(note)).toHaveLength(1);
    // The full title on hover; the accessible name holds the visible text.
    expect(html).toContain('<a href="/segments/82" class="chip" title="Editorial and Design and Graphic and Fine Art Services" aria-label="UNSPSC segment 82 Editorial and design">82 Editorial and design</a>');
    // Two lists of notices on the home page, one note.
    expect((await text("/")).match(note)?.length ?? 0).toBeLessThanOrEqual(1);
    const fr = nbsp(await text("/tenders?lang=fr"));
    expect(fr).toContain('aria-label="Segment UNSPSC 82 Rédaction et conception">82 Rédaction et conception</a>');
  });
});

describe("a source never read", () => {
  const notRead = { ...stats, sources: [...stats.sources, { source: "lobbying", file: "communications_ocl_cal.zip", last_read: null, last_modified: null, loaded: false }, { source: "registry", file: "corporations-active-cbca-en.csv", last_read: null, last_modified: null, loaded: false }] };

  it("is told by the profile's own flag, else by stats.json, else not at all", () => {
    const profile = (extra: object) => ({ ...(profiles as Record<string, unknown>)["org-a000000002"] as object, ...extra }) as unknown as Profile;
    expect(sourceLoaded("lobbying", profile({ sources: { lobbying: { loaded: false } } }), null)).toBe(false);
    expect(sourceLoaded("lobbying", profile({ loaded: { lobbying: false } }), null)).toBe(false);
    expect(sourceLoaded("registry", profile({ registry_loaded: false }), null)).toBe(false);
    expect(sourceLoaded("lobbying", profile({}), notRead)).toBe(false);
    expect(sourceLoaded("lobbying", profile({ sources: { lobbying: { loaded: true } } }), notRead)).toBe(true);
    expect(sourceLoaded("lobbying", profile({}), stats)).toBeUndefined();
  });

  it("shows n/a and says the source has not been loaded, in both languages", async () => {
    // As the export writes it: "<source>_loaded": false on the profile, and the registry's row on the Data page.
    const shard = profiles as Record<string, object>;
    const env = withFiles({
      "stats.json": notRead,
      "profiles/a00.json": { ...shard, "org-a000000002": { ...shard["org-a000000002"], lobbying_loaded: false, grants_loaded: false } },
    });
    const html = await text("/organizations/org-a000000002", env);
    // The tile says the source is not loaded, with no note and no link to a list it does not have.
    expect(html).toContain('<div class="tile"><span class="tile-label">Lobbying communications</span><span class="tile-value">Not loaded</span><span class="tile-note"></span></div>');
    expect(html).toContain('<div class="tile"><span class="tile-label">Grants and contributions</span><span class="tile-value">Not loaded</span><span class="tile-note"></span></div>');
    // The line after the lists names the sources never read; the registry's panel says so too.
    expect(html).toContain("Not loaded yet: grants and contributions, lobbying communications.");
    expect(html).toContain("This source has not been loaded yet.");
    expect(html).not.toContain("No lobbying communication report names this organization as a client.");
    expect(html).not.toContain("No match in the federal corporate registry.");
    expect(html).not.toContain('id="grants"');
    // A source the profile does not flag reads as before, whatever stats.json says of it.
    expect(html).toMatch(/No record in [^<]*published contracts[^<]* names this organization\./);
    const fr = nbsp(await text("/organizations/org-a000000002?lang=fr", env));
    expect(fr).toContain("Pas encore chargées : les subventions et contributions, les communications de lobbying.");
    expect(fr).toContain("Cette source n’a pas encore été chargée.");
  });

  it("reads as before when nothing says", async () => {
    const html = await text("/organizations/org-a000000002");
    expect(html).toContain('<div class="tile"><span class="tile-label">Lobbying communications</span><span class="tile-value">0</span><span class="tile-note">0 reports</span></div>');
    // A source read with nothing in it joins the one line after the lists.
    expect(html).toMatch(/<p class="sources-line">No record in [^<]*lobbying communications names this organization\.<\/p>/);
    expect(html).toContain("No match in the federal corporate registry.");
    expect(html).not.toContain("This source has not been loaded yet.");
    // A money source with nothing in it still reads in dollars.
    expect(html).toMatch(/<span class="tile-value">\$0<\/span>/);
  });

  it("reads as not read on the Data page, and the publisher's date prints as an ISO date from either form", async () => {
    expect(publisherDay("Sun, 01 Nov 2026 17:15:06 GMT")).toBe("2026-11-01");
    expect(publisherDay("2026-10-30T02:05:00Z")).toBe("2026-10-30");
    expect(publisherDay("2026-10-30")).toBe("2026-10-30");
    expect(publisherDay("not a date")).toBeNull();
    const sources = [
      { source: "tenders", file: "openTenderNotice-ouvertAvisAppelOffres.csv", last_read: "2026-10-31T00:40:00Z", last_modified: "Sun, 01 Nov 2026 17:15:06 GMT", loaded: true },
      { source: "lobbying", file: "communications_ocl_cal.zip", last_read: null, last_modified: null, loaded: false },
    ];
    const html = await text("/data", withFiles({ "stats.json": { ...stats, sources } }));
    expect(html).toContain("(publisher&#39;s date 2026-11-01)");
    expect(html).not.toContain("Sun, 01 No");
    // The file's own row under Files Read; the source's row has no read to give.
    expect(html).toMatch(/communications_ocl_cal\.zip<\/td><td data-label="Dataset">Registry of Lobbyists, communication reports<\/td><td data-label="Last read" class="mono wrap"><span class="muted">Not read yet<\/span>/);
  });
});

describe("the rail's overview", () => {
  const current = (nav: string) => [...nav.matchAll(/<a class="([^"]*)" href="([^"]+)" aria-current="page">/g)].map((m) => [m[1], m[2]]);
  const ancestors = (nav: string) => [...nav.matchAll(/<a class="[^"]*rail-ancestor[^"]*" href="([^"]+)"/g)].map((m) => m[1]);

  it("marks exactly the item that leads to the page, and its parent as an ancestor, in both languages", async () => {
    for (const lang of ["", "?lang=fr"]) {
      const tenders = rail(await text(`/tenders${lang}`));
      expect(current(tenders)).toEqual([["rail-item", "/tenders"]]);
      expect(ancestors(tenders)).toEqual([]);
      const fresh = rail(await text(`/tenders/new${lang}`));
      expect(current(fresh)).toEqual([["rail-item rail-child", "/tenders/new"]]);
      expect(ancestors(fresh)).toEqual(["/tenders"]);
      const ending = rail(await text(`/expiring/3m${lang}`));
      expect(current(ending)).toEqual([["rail-item rail-child", "/expiring/3m"]]);
      expect(ancestors(ending)).toEqual(["/expiring"]);
    }
    const fr = nbsp(rail(await text("/expiring/3m?lang=fr")));
    expect(fr).toContain('<span class="rail-label">Contrats prenant fin</span>');
    expect(fr).toContain('<span class="rail-short">3 mois</span><span class="rail-full">Fin d’ici 3 mois</span>');
    expect(fr).toContain('<span class="rail-short">12 mois</span><span class="rail-full">Fin d’ici 12 mois</span>');
    expect(fr).toContain('<span class="rail-short">En 2026</span><span class="rail-full">Avis d’attribution en 2026</span>');
  });

  it("marks the closing-soon view, the year of award notices, and a page's section when no item leads there", async () => {
    expect(current(rail(await text("/tenders?closing=7")))).toEqual([["rail-item rail-child soon", "/tenders?closing=7"]]);
    const year = rail(await text("/awards/2026?page=2"));
    expect(current(year)).toEqual([["rail-item rail-child", "/awards/2026"]]);
    expect(ancestors(year)).toEqual(["/awards"]);
    const notice = rail(await text("/tenders/cb-100-10000001"));
    expect(current(notice)).toEqual([]);
    expect(ancestors(notice)).toEqual(["/tenders"]);
    const filtered = rail(await text("/tenders?segment=82"));
    expect(current(filtered)).toEqual([]);
    expect(ancestors(filtered)).toEqual(["/tenders"]);
  });

  it("compares addresses without the language and the page number", () => {
    expect(viewKey("/tenders?lang=fr")).toBe("/tenders");
    expect(viewKey("/awards/2026?page=3&lang=en")).toBe("/awards/2026");
    expect(viewKey("/tenders?sort=published&closing=7")).toBe("/tenders?closing=7&sort=published");
  });
});

describe("the about, terms and privacy pages", () => {
  const PAGES: [string, string, string][] = [
    ["/about", "<h1>About Award Watch</h1>", "<h1>À propos d’Award Watch</h1>"],
    ["/terms", "<h1>Terms of Use</h1>", "<h1>Conditions d’utilisation</h1>"],
    ["/privacy", "<h1>Privacy</h1>", "<h1>Confidentialité</h1>"],
  ];

  it("answer in both languages and name the publisher, the company that sells Pro", async () => {
    for (const [path, en, fr] of PAGES) {
      const english = await get(path);
      expect(english.status, path).toBe(200);
      const html = await english.text();
      expect(html, path).toContain(en);
      expect(html, path).toContain("Published by Allwater Software Inc., a British Columbia corporation.");
      if (path === "/terms") {
        // The paid plan made Terms longer than about two screens: a contents box.
        expect(html, path).toContain('<div class="doc-layout"><nav class="toc"');
        expect(html, path).toContain('<a href="#pro">Paid Plan (Pro)</a>');
      } else {
        // About and Privacy are shorter than about two screens: no contents box.
        expect(html, path).toContain('<div class="doc-layout doc-alone"><div class="doc">');
        expect(html, path).not.toContain('<nav class="toc"');
      }
      const french = await get(`${path}?lang=fr`);
      expect(french.status, path).toBe(200);
      const page = nbsp(await french.text());
      expect(page, path).toContain(fr);
      expect(page, path).toContain("Publié par Allwater Software Inc., une société de la Colombie-Britannique.");
    }
  });

  it("name Allwater Software Inc. on all three in both languages, Link as the merchant of record on Terms, and carry no em-dash", async () => {
    const EM_DASH = String.fromCharCode(0x2014);
    for (const [path] of PAGES) {
      for (const lang of ["en", "fr"]) {
        const html = nbsp(await text(`${path}?lang=${lang}`));
        expect(html, `${path} ${lang}`).toContain("Allwater Software Inc.");
        expect(html, `${path} ${lang}`).not.toContain(EM_DASH);
      }
    }
    const about = await text("/about");
    expect(about).toContain("Award Watch is published by Allwater Software Inc., a British Columbia corporation. It is not affiliated with any government body, supplier or buyer.");
    expect(nbsp(await text("/about?lang=fr"))).toContain("Award Watch est publié par Allwater Software Inc., une société de la Colombie-Britannique.");

    const terms = (await text("/terms")).replace(/&#39;/g, "'");
    const pro = terms.slice(terms.indexOf('<h2 id="pro">'), terms.indexOf("</main>"));
    expect(pro).toContain("<h2 id=\"pro\">Paid Plan (Pro)</h2>");
    expect(pro).toContain("Link, the merchant of record operated by Stripe");
    expect(pro).toContain("reads LINK.COM followed by Allwater's name");
    expect(pro).toContain("The site never receives card details.");
    expect(pro).toContain('Questions about a charge go to <a href="mailto:contact@awardwatch.ca">contact@awardwatch.ca</a> or to Link');
    expect(pro).toContain('The <a href="#warranty">No Warranty</a> terms above, liability included, apply to Pro');
    expect(pro).toContain("The prices are shown on the site, on the account's billing page, in Canadian dollars.");
    expect(pro).toContain("at least 30 days after notice by email to the account's address");
    expect(pro).toContain("The current period is not refunded, in whole or in part, except under Refund of the First Payment and where the law requires a refund.");
    // The refund the operator promised (2026-11-11): the first payment, within 14 days, once per account,
    // with the billing page's Refund now button, or by writing to the contact address.
    expect(pro).toContain("<h3>Refund of the First Payment</h3><p>If you ask within 14 days of your first payment for Pro, monthly or yearly, Allwater refunds that payment in full");
    expect(pro).toContain("This applies once per account and to the first payment only");
    expect(pro).toContain("If Allwater ends Pro for any other reason, it refunds the unused part of the current period.");
    expect(pro).toContain("Deleting the account cancels the subscription at once, without refund.");
    // The prices live on the billing page: the only figures in the section are the notice period and the refund's 14 days.
    expect(pro).not.toContain("$");
    expect([...pro.replace(/<[^>]+>/g, "").matchAll(/\d+/g)].map((m) => m[0])).toEqual(["30", "14", "30"]);
    // The billing page is named, never linked: no public page links to /account while the switch is off.
    expect(pro).not.toContain("/account");
    // The sections that were there stay, the paid plan last.
    expect([...terms.matchAll(/<h2 id="(\w+)">/g)].map((m) => m[1])).toEqual(["use", "files", "authority", "warranty", "changes", "automated", "code", "pro"]);

    const termsFr = nbsp(await text("/terms?lang=fr"));
    expect(termsFr).toContain("<h2 id=\"pro\">Forfait payant (Pro)</h2>");
    expect(termsFr).toContain("Link, le marchand officiel exploité par Stripe");
    expect(termsFr).toContain("La suppression du compte annule l’abonnement immédiatement, sans remboursement.");
    expect(termsFr).toContain('<a href="#warranty">Aucune garantie</a>');
  });

  it("say what the about page promises: the contact, the turnaround and the licences", async () => {
    const html = await text("/about");
    expect(html).toContain('<a href="mailto:contact@awardwatch.ca">contact@awardwatch.ca</a>');
    expect(html).toContain("A correction is reviewed within seven days.");
    expect(html).toContain("It is not affiliated with any government body, supplier or buyer.");
    expect(html).toContain("source-available");
    expect(html).toContain('href="/methodology#claims"');
    expect(html).toContain('href="/cite"');
  });

  it("quote the request limits wrangler.jsonc sets, and the attribution", async () => {
    const limit = (name: string) => Number(new RegExp(`"name": "${name}"[^}]*"limit": (\\d+)`).exec(wrangler)?.[1]);
    expect(REQUEST_LIMITS).toEqual({ page: limit("PAGE_LIMIT"), api: limit("API_LIMIT"), download: limit("DOWNLOAD_LIMIT") });
    const html = await text("/terms");
    expect(html).toContain(`${REQUEST_LIMITS.page} page requests, ${REQUEST_LIMITS.api} API requests and ${REQUEST_LIMITS.download} downloads a minute`);
    expect(html).toContain("<blockquote>Contains information licensed under the Open Government Licence, Canada.</blockquote>");
  });

  it("state what is kept: one language cookie, no address, the forms, removal at no charge", async () => {
    const html = await text("/privacy");
    expect(html).toContain("The site sets one cookie, lang,");
    expect(html).toContain("The site keeps no IP address, browser identification or cookie with the counts.");
    expect(html).toContain("The email address is used only to confirm that the statement comes from the organization, and it is never shown.");
    expect(html).toContain("A removal request is never charged for.");
  });

  it("are linked from the footer, and the about page from the home page's reading notes", async () => {
    const home = await text("/");
    expect(home).toContain('<li>The <a href="/about">About</a> page says who publishes the site and how to reach it.</li>');
    const footer = home.slice(home.indexOf('<footer class="site-footer">'));
    for (const [href, label] of [["/about", "About"], ["/terms", "Terms"], ["/privacy", "Privacy"]]) {
      expect(footer).toContain(`<a href="${href}">${label}</a>`);
    }
  });
});

describe("CanadaBuys addresses", () => {
  it("drop a colon and keep a slash as a path segment, on both hosts", () => {
    expect(tenderNoticeUrl("ssc-26-00035339:t")).toBe("https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/ssc-26-00035339t");
    expect(tenderNoticeUrl("SSC-26-00040563:A:1", "fr")).toBe("https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/ssc-26-00040563a1");
    expect(awardNoticeUrl("ssc-26-00040563:a:1")).toBe("https://canadabuys.canada.ca/en/tender-opportunities/award-notice/ssc-26-00040563a1");
    expect(awardNoticeUrl("01044-221065/001/PI")).toBe("https://canadabuys.canada.ca/en/tender-opportunities/award-notice/01044-221065/001/pi");
    expect(tenderNoticeUrl("01044-221065/001/pi", "fr")).toBe("https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/01044-221065/001/pi");
  });
});

describe("buyer ids that moved", () => {
  it("answer with a 301 to the new id, the language kept, and a 404 when neither exists", async () => {
    for (const [from, to] of [
      ["/buyers/public-works-and-government-services-canada", "/buyers/pwgsc-tpsgc"],
      ["/buyers/department-of-national-defence?lang=fr", "/buyers/dnd-mdn?lang=fr"],
    ]) {
      const res = await get(from);
      expect(res.status, from).toBe(301);
      expect(res.headers.get("location"), from).toBe(to);
    }
    expect((await get("/buyers/no-such-buyer")).status).toBe(404);
    expect((await get("/buyers/public-works-and-government-services-canada", withFiles({ "buyers/aliases.json": undefined }))).status).toBe(404);
  });
});

describe("smaller fixes", () => {
  it("writes the closing time the way each language does, with the zone when the value has one", () => {
    // CanadaBuys' times name no zone and are Eastern time.
    expect(closingText("2026-11-26T14:00:00")).toBe("2026-11-26 14:00 ET");
    expect(closingText("2026-11-26T14:00:00", "fr")).toBe("2026-11-26 14 h 00 HE");
    expect(closingText("2026-11-26T14:00:00Z")).toBe("2026-11-26 14:00 UTC");
    expect(closingText("2026-11-26T14:00:00-05:00")).toBe("2026-11-26 14:00 -05:00");
    expect(closingText("2026-11-26")).toBe("2026-11-26");
  });

  it("reads a missing non-competitive part of a known whole as none of it", () => {
    const money = (v: number) => `$${v.toLocaleString("en-CA")}`;
    // The whole is the Records or Value cell beside it, so the share gives the part and its percentage.
    expect(shareText("en", null, 16809952, money)).toBe("$0 (0%)");
    expect(shareText("en", null, null, money)).toBe("Not applicable");
    expect(shareText("en", 3, 60, String)).toBe("3 (5%)");
  });

  it("leaves out the axis labels within two slots of an anchored end label", () => {
    const lefts = Array.from({ length: 31 }, (_, i) => ((i + 0.5) / 31) * 100);
    const shown = clearOfAnchors(lefts);
    expect(shown.slice(0, 4)).toEqual([true, false, false, true]);
    expect(shown.slice(-4)).toEqual([true, false, false, true]);
    // Short axes have no anchored label and keep every one.
    expect(clearOfAnchors([10, 30, 50, 70, 90]).every(Boolean)).toBe(true);
  });

  it("says a contract ends today rather than in 0 days", async () => {
    const page = Array.isArray(expiring3mPage1) ? expiring3mPage1 : (expiring3mPage1 as { rows: unknown[] }).rows;
    const rows = (page as { days_left: number }[]).map((r, i) => (i === 0 ? { ...r, days_left: 0 } : r));
    const html = await text("/expiring/3m", withFiles({ "expiring/3m/1.json": rows }));
    expect(html).toContain("Ends today");
    expect(html).not.toContain(">0 days left");
  });

  it("names the window in its crumb, gives a tender its eyebrow, and keeps the crumbs off /rankings", async () => {
    expect(await text("/expiring/3m")).toContain('<a href="/expiring">Contracts Ending Soon</a> / Contracts Ending Within 3 Months</nav>');
    expect(await text("/tenders/cb-100-10000001")).toContain('<p class="eyebrow">Tender Notice</p>');
    expect(await text("/rankings")).not.toContain('class="breadcrumb"');
    expect(await text("/rankings/2026")).toContain('class="breadcrumb"');
  });

  it("agrees the French All with a feminine filter", async () => {
    const html = nbsp(await text("/tenders?lang=fr"));
    expect(html).toContain('<select name="category"><option value="">Toutes</option>');
    expect(html).toContain('<select name="segment"><option value="">Tous</option>');
    expect(html).toContain('<select name="method"><option value="">Toutes</option>');
  });

  it("pages the long lists on a phone and folds the segment feeds there", async () => {
    for (const path of ["/buyers", "/expiring/3m"]) {
      const html = await text(path);
      expect(html, path).toContain('data-phone-page="50"');
      expect(html, path).toContain('<script src="/pager.js" defer=""></script>');
      expect(html, path).toContain('<script type="application/json" id="pager-i18n">');
    }
    const feeds = await text("/feeds");
    expect(feeds).toMatch(/<details class="phone-fold" open="" data-phone-closed="">/);
  });
});
