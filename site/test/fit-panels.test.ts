// Matching notices where readers already are (src/account/fit_panels.tsx,
// public/fit-panel.js; docs/accounts.md, Matching notices): the panel on an
// open notice's page and the line that asks for a claim, the panel over
// /tenders that the browser fills, and the summary on /account/organization.
// Every state of each, each match with the disclaimer, both languages, Free
// and Pro alike. The pages are public: a response with a match is private
// and never stored, a signed-out one keeps its public headers and carries
// nothing of the feature, and one reader's organization never reaches
// another reader's page. The browser's short list reads as /account/matches
// words it, and the server draws the same list on the organization page.
import { describe, expect, it } from "vitest";
import fitPanelJs from "../public/fit-panel.js?raw";
import tendersJs from "../public/tenders.js?raw";
import { PANEL_ROWS, panelRows } from "../public/fit-panel.js";
import { rankNotices } from "../public/fit.js";
import { FIT_CLIENT_KEYS, fitClientData } from "../src/account/fit_panels";
import type { CodeLevel, TenderRow } from "../src/data";
import { bandText, reasonText } from "../src/fit";
import { allKeys, type Lang } from "../src/i18n";
import { ACCOUNTS, decode, get, grantPro, nbsp, newEmail, offEnv, onEnv, signIn, userId, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";

useAccountsDb();

const A1 = "org-a000000001"; // Exemplar Translation Services Inc., Ontario
const A2 = "org-a000000002"; // Sample Harbour Marine Ltd., British Columbia
const NAME1 = "Exemplar Translation Services Inc.";
const NAME2 = "Sample Harbour Marine Ltd.";
const OPEN_REF = "cb-100-10000001"; // closes 2026-11-04 14:00 ET, two business days after the tests' clock
const OTHER_REF = "cb-200-20005019"; // closes 2026-11-26
const LATER = "2026-11-05T16:00:00Z"; // the first notice has closed

// The first open notice (PSPC, 82111800, Ontario and Quebec, a Request for Proposal) is a 95-point close
// match for A1's block: 45 + 25 + 15 + 10. The second (DFO, 72101500, British Columbia) shares no segment with
// it, but its buyer (4 published contracts: 25) and its notice type (5 award notices: 10).
const BLOCK1 = {
  fy: [2022, 2026], n: [7, 3, 12], coded: [7, 3], newest: "2026-09-30",
  classes: [["821118", 5, 2], ["811015", 2, 0]],
  families: [["8211", 5, 2], ["8110", 2, 0]],
  segments: [["82", 5, 2], ["81", 2, 0]],
  buyers: [["pwgsc-tpsgc", 4, 3, 0], ["dfo-mpo", 1, 0, 4]],
  provinces: [["ON", 6, 2], ["QC", 1, 1]],
  types: [["Request for Proposal", 5, 1]],
  held: [["SA", "82", 1]],
};
// A2's: the second notice is its 95-point close match (class 721015, DFO 3, British Columbia 5, the type 3);
// the first shares only its notice type with it.
const BLOCK2 = {
  fy: [2022, 2026], n: [5, 0, 2], coded: [5, 0], newest: "2026-08-14",
  classes: [["721015", 4, 0]], families: [["7210", 4, 0]], segments: [["72", 4, 0]],
  buyers: [["dfo-mpo", 3, 0, 0]], provinces: [["BC", 5, 0]], types: [["Request for Proposal", 3, 0]], held: [],
};

const OPEN = FILES["tenders/open.json"] as Record<string, unknown>[];
const LEVELS = (FILES["tenders/open-levels.json"] as { levels: CodeLevel[] }).levels;
// n notices like the first, each a 95-point close match, closing later the same month.
const matching = (n: number) => Array.from({ length: n }, (_, i) => ({
  ...OPEN[0], reference: `cb-900-${String(i).padStart(8, "0")}`, title_en: `Matching notice ${i}`, title_fr: `Avis correspondant ${i}`,
  closing: "2026-11-20T14:00:00",
}));
const CLOSED = { ...OPEN[0], reference: "cb-900-closed", title_en: "Closed notice", closing: "2026-10-30T14:00:00" };
const STATS = { ...(FILES["stats.json"] as object), matching_fy: [2022, 2026] };

// Each organization's block; undefined leaves the profile without one.
function profiles(b1: unknown, b2: unknown, name1?: string): Record<string, any> {
  const p = structuredClone(FILES["profiles/a00.json"]) as Record<string, any>;
  if (name1) p[A1].organization.display_name = name1;
  if (b1 !== undefined) p[A1].matching = b1;
  if (b2 !== undefined) p[A2].matching = b2;
  return p;
}

type Files = { b1?: unknown; b2?: unknown; open?: unknown; stats?: unknown; shard?: unknown; name1?: string };
const files = (o: Files) => ({
  "profiles/a00.json": profiles("b1" in o ? o.b1 : BLOCK1, "b2" in o ? o.b2 : BLOCK2, o.name1),
  "stats.json": o.stats === undefined ? STATS : o.stats,
  ...("open" in o ? { "tenders/open.json": o.open } : {}),
  ...("shard" in o ? { "tenders/20a.json": o.shard } : {}),
});
// The switch on with the files given, and the clock at NOW when given.
const E = (o: Files & { now?: string } = {}) =>
  onEnv({ ASSETS: makeFakeAssets({}, files(o)), ...(o.now ? { NOW: o.now } : {}) });

// The paths the page asked the assets for, beside the environment.
function recording(o: Files = {}) {
  const inner = makeFakeAssets({}, files(o));
  const seen: string[] = [];
  const assets = {
    fetch: (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      seen.push(new URL(url).pathname);
      return inner.fetch(input as Request);
    },
  } as unknown as Fetcher;
  return { seen, env: onEnv({ ASSETS: assets }) };
}

async function reader(o: { pro?: boolean; org?: string | null } = {}): Promise<string> {
  const email = newEmail("fitpanel");
  const cookie = await signIn(email, { env: E() });
  if (o.pro) await grantPro(email);
  if (o.org !== null) {
    const now = new Date().toISOString();
    await ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?, ?, NULL, '[]', ?, ?)")
      .bind(await userId(email), o.org ?? A1, now, now).run();
  }
  return cookie;
}

const open = async (path: string, env: object, cookie?: string) => {
  const res = await get(path, { cookie, env });
  const raw = await res.text();
  return { res, raw, html: nbsp(decode(raw)).replace(/’/g, "'") };
};
const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const filled = (html: string) => main(html).match(/class="btn btn-primary"/g)?.length ?? 0;
const count = (html: string, s: string) => html.split(s).length - 1;
// The section that holds a panel's title.
const panel = (html: string, title: string) => {
  const at = html.indexOf(`<h2>${title}</h2>`);
  if (at < 0) return "";
  const start = html.lastIndexOf("<section", at);
  return html.slice(start, html.indexOf("</section>", at) + "</section>".length);
};
const text = (s: string) => s.replace(/<[^>]+>/g, "");

const DISCLAIMER = "Award Watch calculates matches from public records. A match is not advice and may be wrong. See the Terms of Use.";
function holdsDisclaimer(part: string, why: string) {
  expect(text(part), why).toContain(DISCLAIMER);
  expect(part, why).toContain('<a href="/terms#warranty">Terms of Use</a>');
  expect(part, why).toContain('<a href="/methodology#matching">How matches are counted</a>');
}

const NOTICE_PANEL = "Match With Your Organization";
const NUDGE = "Tell the site which organization is yours to see what this notice has in common with its records: " +
  '<a href="/account/organization">Your organization</a>.';
const FEATURE = /fit-data|fit-rows|fit-all|Match With Your Organization|Notices Matching|fit-panel|Tell the site which organization/;

// -- a notice's page -------------------------------------------------------------------------------

describe("an open notice's page", () => {
  it("shows a signed-in account its match: the band, the points, every reason with its points, the basis, the disclaimer", async () => {
    const cookie = await reader();
    const { res, html } = await open(`/tenders/${OPEN_REF}`, E(), cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const p = panel(main(html), NOTICE_PANEL);
    // The name's own period ends the sentence ("Inc."), with no second one after it.
    expect(p).toContain(`<p>What this notice has in common with the records of <a href="/organizations/${A1}">${NAME1}</a></p>`);
    expect(p).toContain('<p><strong>Close match</strong> <span class="muted small">95 of 100 points</span></p>');
    expect([...p.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]))).toEqual([
      "UNSPSC class 821118 Editorial and support services: 5 award notices, 2 PSPC contract history records +4545 points",
      "Buyer Public Services and Procurement Canada: 4 award notices, 3 PSPC contract history records +2525 points",
      "Province of delivery Ontario: 6 award notices, 2 PSPC contract history records +1515 points",
      "Notice type Request for Proposal: 5 award notices, 1 PSPC contract history record +1010 points",
    ]);
    expect(p).toContain('<span class="mono" aria-hidden="true">+45</span><span class="visually-hidden">45 points</span>');
    expect(p).toContain("From 7 award notices, 3 PSPC contract history records, 12 published contracts, fiscal years 2022-23 to 2026-27.");
    holdsDisclaimer(p, "notice match");
    // After the key dates and the buyer, before the documents; no line asking for a claim.
    const m = main(html);
    expect(m.indexOf(NOTICE_PANEL)).toBeGreaterThan(m.indexOf('class="panel-grid"'));
    expect(m.indexOf(NOTICE_PANEL)).toBeLessThan(m.indexOf('class="panel tender-documents"'));
    expect(html).not.toContain("Tell the site which organization");
    // The notice on CanadaBuys stays the page's one filled button.
    expect(filled(html)).toBe(1);
  });

  it("gives Pro the same panel as Free", async () => {
    const free = panel(main((await open(`/tenders/${OPEN_REF}`, E(), await reader())).html), NOTICE_PANEL);
    const pro = await open(`/tenders/${OPEN_REF}`, E(), await reader({ pro: true }));
    expect(pro.res.headers.get("cache-control")).toBe("private, no-store");
    expect(panel(main(pro.html), NOTICE_PANEL)).toBe(free);
    expect(free).not.toBe("");
  });

  it("says when a notice shares no work, and states without points what it still has in common", async () => {
    const cookie = await reader();
    const p = panel(main((await open(`/tenders/${OTHER_REF}`, E(), cookie)).html), NOTICE_PANEL);
    expect(p).toContain("<p><strong>No match</strong></p>");
    expect(p).not.toContain("of 100 points");
    expect(p).toContain(`<p>None of this notice's UNSPSC codes shares a segment with the award notices or PSPC contract history of ${NAME1}</p>`);
    expect(p).toContain("<p>Also in common:</p>");
    expect([...p.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1])).toEqual([
      "Buyer Fisheries and Oceans Canada: 1 award notice, 4 published contracts",
      "Notice type Request for Proposal: 5 award notices, 1 PSPC contract history record",
    ]);
    expect(p).not.toMatch(/\+\d|visually-hidden/);
    holdsDisclaimer(p, "no match");
    // A notice with nothing in common at all says only why.
    const bare = panel(main((await open(`/tenders/${OTHER_REF}`, E({ b1: { ...BLOCK1, buyers: [], types: [] } }), cookie)).html), NOTICE_PANEL);
    expect(bare).toContain("<p><strong>No match</strong></p>");
    expect(bare).not.toContain("Also in common:");
    holdsDisclaimer(bare, "nothing in common");
  });

  it("shows a partial or a weak match the same way, every reason with its points", async () => {
    const cookie = await reader();
    // Segment 72 in one award notice (5), DFO in 4 published contracts (25), the type in 5 award notices (10): 40.
    const partial = { ...BLOCK1, segments: [["72", 1, 0]] };
    const p = panel(main((await open(`/tenders/${OTHER_REF}`, E({ b1: partial }), cookie)).html), NOTICE_PANEL);
    expect(p).toContain('<p><strong>Partial match</strong> <span class="muted small">40 of 100 points</span></p>');
    expect([...p.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]))).toEqual([
      "UNSPSC segment 72 Building and Facility Construction and Maintenance Services: 1 award notice +55 points",
      "Buyer Fisheries and Oceans Canada: 1 award notice, 4 published contracts +2525 points",
      "Notice type Request for Proposal: 5 award notices, 1 PSPC contract history record +1010 points",
    ]);
    expect(p).not.toContain("Also in common:");
    holdsDisclaimer(p, "partial");
    // The segment alone: 5, a weak match, which no list carries but the notice's page shows.
    const weak = panel(main((await open(`/tenders/${OTHER_REF}`, E({ b1: { ...partial, buyers: [], types: [] } }), cookie)).html), NOTICE_PANEL);
    expect(weak).toContain('<p><strong>Weak match</strong> <span class="muted small">5 of 100 points</span></p>');
    holdsDisclaimer(weak, "weak");
  });

  it("ends a sentence on the organization's name with one period, the name's own or the sentence's", async () => {
    const cookie = await reader();
    const p = panel(main((await open(`/tenders/${OTHER_REF}`, E({ name1: "Exemplar Translation" }), cookie)).html), NOTICE_PANEL);
    expect(p).toContain(`<p>What this notice has in common with the records of <a href="/organizations/${A1}">Exemplar Translation</a>.</p>`);
    expect(p).toContain("of Exemplar Translation.</p>");
    expect(p).not.toContain("..");
    const inc = panel(main((await open(`/tenders/${OTHER_REF}`, E(), cookie)).html), NOTICE_PANEL);
    expect(text(inc)).not.toContain("Inc..");
  });

  it("says a notice without a UNSPSC code cannot be matched", async () => {
    const shard = structuredClone(FILES["tenders/20a.json"]) as Record<string, any>;
    shard[OTHER_REF].codes = [];
    const p = panel(main((await open(`/tenders/${OTHER_REF}`, E({ shard }), await reader())).html), NOTICE_PANEL);
    expect(p).toContain("<p><strong>No match</strong></p>");
    expect(p).toContain("<p>This notice carries no UNSPSC code, so it cannot be matched.</p>");
    expect(p).not.toContain("None of this notice's UNSPSC codes");
    holdsDisclaimer(p, "no codes");
  });

  it("asks a signed-in account without a claim to name its organization, in one line under the Follow control", async () => {
    const { res, html } = await open(`/tenders/${OPEN_REF}`, E(), await reader({ org: null }));
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const head = html.slice(html.indexOf('<header class="page-head"'), html.indexOf("</header>", html.indexOf('<header class="page-head"')));
    expect(head).toContain(`<p class="page-note">${NUDGE}</p>`);
    expect(head.indexOf(NUDGE)).toBeGreaterThan(head.indexOf('class="watch-control"'));
    expect(html).not.toContain(NOTICE_PANEL);
    expect(filled(html)).toBe(1);
  });

  it("shows nothing on a closed notice, signed in with a claim or without", async () => {
    for (const org of [A1, null]) {
      const { html } = await open(`/tenders/${OPEN_REF}`, E({ now: LATER }), await reader({ org }));
      expect(html, String(org)).toContain("Closed 2026-11-04");
      expect(html, String(org)).not.toMatch(FEATURE);
    }
  });

  it("shows nothing while the claimed organization's block cannot rank notices", async () => {
    const cookie = await reader();
    const states: [string, Files][] = [
      ["pending", { b1: undefined, stats: FILES["stats.json"] }],
      ["empty", { b1: undefined }],
      ["uncoded", { b1: { ...BLOCK1, n: [0, 0, 12], coded: [0, 0] } }],
      ["thin", { b1: { ...BLOCK1, n: [2, 1, 12], coded: [2, 1] } }],
      ["unreadable", { b1: { ...BLOCK1, n: "seven" } }],
    ];
    for (const [why, o] of states) {
      const { res, html } = await open(`/tenders/${OPEN_REF}`, E(o), cookie);
      expect(res.status, why).toBe(200);
      expect(html, why).not.toMatch(FEATURE);
    }
  });

  it("speaks French, the Terms linked in French", async () => {
    const { html } = await open(`/tenders/${OPEN_REF}?lang=fr`, E(), await reader());
    const p = panel(main(html), "Correspondance avec votre organisation");
    expect(p).toContain(`<p>Ce que cet avis a en commun avec les dossiers de <a href="/organizations/${A1}">${NAME1}</a></p>`);
    expect(p).toContain('<p><strong>Correspondance étroite</strong> <span class="muted small">95 points sur 100</span></p>');
    expect(text(p)).toContain("Classe UNSPSC 821118 Services de rédaction et de soutien : 5 avis d'attribution, 2 dossiers de l'historique des contrats de SPAC");
    expect(text(p)).toContain("D'après 7 avis d'attribution, 3 dossiers de l'historique des contrats de SPAC, 12 contrats publiés, exercices 2022-2023 à 2026-2027.");
    expect(text(p)).toContain(
      "Award Watch calcule les correspondances à partir de dossiers publics. Une correspondance ne constitue pas un conseil et peut être erronée. Voir les Conditions d'utilisation.");
    expect(p).toContain('<a href="/terms?lang=fr#warranty">Conditions d\'utilisation</a>');
    expect(p).not.toMatch(/Close match|award notices|What this notice/);
    const none = panel(main((await open(`/tenders/${OTHER_REF}?lang=fr`, E(), await reader())).html), "Correspondance avec votre organisation");
    expect(none).toContain("<p><strong>Aucune correspondance</strong></p>");
    expect(none).toContain("<p>Aussi en commun :</p>");
    const nudge = (await open(`/tenders/${OPEN_REF}?lang=fr`, E(), await reader({ org: null }))).html;
    expect(nudge).toContain("Indiquez au site quelle organisation est la vôtre pour voir ce que cet avis a en commun avec ses dossiers : " +
      '<a href="/account/organization">Votre organisation</a>.');
  });
});

// -- one reader's page never reaches another -----------------------------------------------------

describe("the public pages, read signed out and by two accounts with different claims", () => {
  it("give a notice's page three bodies: the public one, cacheable as before, and two private ones, each with its own organization only", async () => {
    const env = E();
    const out = await open(`/tenders/${OPEN_REF}`, env);
    const a = await open(`/tenders/${OPEN_REF}`, env, await reader({ org: A1 }));
    const b = await open(`/tenders/${OPEN_REF}`, env, await reader({ org: A2 }));
    expect(out.res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(out.res.headers.get("vary")).toContain("Cookie");
    for (const r of [a, b]) {
      expect(r.res.headers.get("cache-control")).toBe("private, no-store");
      expect(r.res.headers.get("vary")).toContain("Cookie");
    }
    expect(new Set([out.raw, a.raw, b.raw]).size).toBe(3);
    expect(out.html).not.toMatch(FEATURE);
    // A's panel: its close match; B's: no match, with the notice type it shares.
    expect(panel(main(a.html), NOTICE_PANEL)).toContain("<strong>Close match</strong>");
    expect(panel(main(a.html), NOTICE_PANEL)).toContain(NAME1);
    expect(panel(main(b.html), NOTICE_PANEL)).toContain("<strong>No match</strong>");
    expect(panel(main(b.html), NOTICE_PANEL)).toContain(NAME2);
    // Neither organization appears on the other reader's page beyond what the public page shows.
    for (const s of [NAME1, A1]) expect(count(b.html, s), s).toBe(count(out.html, s));
    for (const s of [NAME2, A2]) expect(count(a.html, s), s).toBe(count(out.html, s));
  });

  it("give /tenders three bodies the same way, the block and the name only in the claimant's own", async () => {
    const env = E();
    const out = await open("/tenders", env);
    const a = await open("/tenders", env, await reader({ org: A1 }));
    const b = await open("/tenders", env, await reader({ org: A2 }));
    expect(out.res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(out.res.headers.get("vary")).toContain("Cookie");
    for (const r of [a, b]) expect(r.res.headers.get("cache-control")).toBe("private, no-store");
    expect(new Set([out.raw, a.raw, b.raw]).size).toBe(3);
    expect(out.html).not.toMatch(FEATURE);
    expect(a.html).toContain(`<h2>Notices Matching ${NAME1}</h2>`);
    expect(b.html).toContain(`<h2>Notices Matching ${NAME2}</h2>`);
    for (const s of [NAME1, A1, '"821118"']) expect(count(b.html, s), s).toBe(count(out.html, s));
    for (const s of [NAME2, A2, '"721015"']) expect(count(a.html, s), s).toBe(count(out.html, s));
  });

  it("keep their signed-out headers with the switch off, and read nothing of the feature", async () => {
    for (const path of [`/tenders/${OPEN_REF}`, "/tenders"]) {
      const res = await get(path, { env: offEnv() });
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(res.headers.get("vary"), path).toBeNull();
      expect(await res.text(), path).not.toMatch(FEATURE);
    }
  });
});

// -- /tenders ----------------------------------------------------------------------------------------

const fitData = (raw: string) => {
  const m = /<script type="application\/json" id="fit-data">([\s\S]*?)<\/script>/.exec(raw);
  return m ? JSON.parse(m[1]) : null;
};

describe("/tenders", () => {
  it("writes the panel's frame and the organization's block for the browser, and never reads the full list", async () => {
    const cookie = await reader();
    const { seen, env } = recording();
    const { res, raw, html } = await open("/tenders", env, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(seen.filter((p) => /open\.json|open-levels\.json/.test(p))).toEqual([]);
    expect(seen).toContain("/data/tenders/open-first.json");
    const p = panel(main(html), `Notices Matching ${NAME1}`);
    expect(p).toContain('<a href="/account/matches" id="fit-all" hidden="">Matching notices</a>');
    expect(p).toContain('<div id="fit-rows"></div>');
    expect(p).toContain('<noscript><p><a href="/account/matches">Matching notices</a></p></noscript>');
    holdsDisclaimer(p, "tenders");
    // Over the toolbar, and Apply stays the page's one filled button.
    expect(main(html).indexOf(p)).toBeLessThan(main(html).indexOf('id="tender-filters"'));
    expect(filled(html)).toBe(1);
    expect(main(html)).toContain('id="tender-apply"');
    const data = fitData(raw);
    expect(data).toMatchObject({ lang: "en", locale: "en-CA", id: A1, name: NAME1, home: "ON", block: BLOCK1 });
    expect(Object.keys(data.strings).sort()).toEqual([...FIT_CLIENT_KEYS].sort());
    expect(data.segments).toEqual({ "82": "Editorial and Design and Graphic and Fine Art Services", "81": "Engineering and Research and Technology Based Services" });
    // The page's own strings for tenders.js are the same as a signed-out reader's.
    const i18n = (s: string) => /<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/.exec(s)?.[1];
    expect(i18n(raw)).toBe(i18n((await open("/tenders", E())).raw));
  });

  it("gives Pro the same panel, and nothing to an account without a claim or whose block cannot rank", async () => {
    const pro = await open("/tenders", E(), await reader({ pro: true }));
    expect(pro.html).toContain(`<h2>Notices Matching ${NAME1}</h2>`);
    expect(fitData(pro.raw)?.block).toEqual(BLOCK1);
    const none = await open("/tenders", E(), await reader({ org: null }));
    expect(none.res.headers.get("cache-control")).toBe("private, no-store");
    expect(none.html).not.toMatch(FEATURE);
    const thin = await open("/tenders", E({ b1: { ...BLOCK1, n: [2, 1, 12], coded: [2, 1] } }), await reader());
    expect(thin.html).not.toMatch(FEATURE);
  });

  it("speaks French", async () => {
    const { raw, html } = await open("/tenders?lang=fr", E(), await reader());
    const p = panel(main(html), `Avis correspondant à ${NAME1}`);
    expect(p).toContain('<a href="/account/matches" id="fit-all" hidden="">Avis correspondants</a>');
    expect(text(p)).toContain("Voir les Conditions d'utilisation.");
    const data = fitData(raw);
    expect(data.lang).toBe("fr");
    expect(data.strings["fit.tenders_all_many"]).toBe("Les {n} avis correspondants");
    expect(data.segments["82"]).toBe("Services de rédaction, de design, de graphisme et de beaux-arts");
  });
});

// -- the browser's short list ------------------------------------------------------------------------

describe("the short list public/fit-panel.js draws", () => {
  const rows = [...matching(8), CLOSED, ...OPEN] as unknown as TenderRow[];
  // The browser's data as the page writes it, read back from the page's JSON.
  const pageData = (lang: Lang) => JSON.parse(JSON.stringify(fitClientData(lang, { kind: "ready", id: A1, name: NAME1, home: "ON", block: BLOCK1 as any })));

  it("lists the first PANEL_ROWS matches as /account/matches ranks them, in /account/matches' words", () => {
    expect(PANEL_ROWS).toBe(5);
    for (const lang of ["en", "fr"] as const) {
      const still = rows.filter((r) => r.reference !== CLOSED.reference);
      const out = panelRows(pageData(lang), still, LEVELS);
      const ranked = rankNotices(BLOCK1 as any, still, "ON").matches;
      expect(out.total).toBe(ranked.length);
      expect(out.total).toBe(9);
      expect(out.rows.map((r) => r.href)).toEqual(ranked.slice(0, 5).map(({ row }) => `/tenders/${row.reference}`));
      out.rows.forEach((r, i) => {
        const { row, score } = ranked[i];
        expect(r.band, lang).toBe(bandText(lang, score.band));
        const reason = reasonText(lang, score.reasons[0], { name: NAME1, notice: row, levels: LEVELS });
        const buyer = lang === "fr" ? "Services publics et Approvisionnement Canada" : "Public Services and Procurement Canada";
        const closes = lang === "fr" ? `Clôture le ${row.closing!.slice(0, 10)}` : `Closes ${row.closing!.slice(0, 10)}`;
        expect(r.detail, lang).toBe(`${buyer} · ${closes} · ${reason}`);
      });
      // The soonest closing first among equal points: the fixture's notice, then the copies by reference.
      expect(out.rows[0].href).toBe(`/tenders/${OPEN_REF}`);
      expect(out.rows[0].title).toBe(lang === "fr" ? "Services de traduction pour les bureaux régionaux" : "Translation services for regional offices");
    }
    const en = panelRows(pageData("en"), rows.slice(0, 1), LEVELS).rows[0];
    expect(en.detail).toBe("Public Services and Procurement Canada · Closes 2026-11-20 · " +
      "UNSPSC class 821118 Editorial and support services: 5 award notices, 2 PSPC contract history records");
    // Without the levels file a class is named by its code alone, as on the server.
    expect(panelRows(pageData("en"), rows.slice(0, 1), null).rows[0].detail).toContain("UNSPSC class 821118: 5 award notices");
  });

  it("is loaded by tenders.js only for a page that carries the panel, and handed the list it fetched", () => {
    expect(tendersJs).toContain('var fitPanel = document.getElementById("fit-data")\n    ? import("./fit-panel.js")');
    expect(tendersJs).toMatch(/start\(data\.filter\([^\n]*\)\);\n {6}fitDraw\(rows\);/);
    expect(tendersJs).toMatch(/note\.textContent = tx\("tenders\.load_failed"\);\n {6}fitDraw\(null\);/);
    // Nothing on import: the module only defines.
    expect(fitPanelJs).not.toMatch(/^(?:document|window|fetch)\b/m);
    expect(fitPanelJs).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    expect(fitPanelJs).toContain('document.getElementById("fit-data")');
    expect(fitPanelJs).toContain('fetch("/data/tenders/open-levels.json")');
  });

  it("asks only for words the page supplies, and holds no sentence of its own", () => {
    const keys = new Set<string>(allKeys());
    const used = [...fitPanelJs.matchAll(/"([a-z_]+\.[a-z_]+)"/g)].map((m) => m[1]).filter((k) => keys.has(k));
    expect(used.length).toBeGreaterThan(10);
    for (const key of used) expect(FIT_CLIENT_KEYS, key).toContain(key);
    for (const key of FIT_CLIENT_KEYS) expect(keys.has(key), key).toBe(true);
    expect([...fitPanelJs.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((s) => /\b[A-Z][a-z]+(?: [a-z]+)+/.test(s))).toEqual([]);
    expect(fitPanelJs + tendersJs).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`));
  });
});

// -- /account/organization ---------------------------------------------------------------------------

const ORG_PANEL = `Notices Matching ${NAME1}`;

describe("the organization page's summary", () => {
  it("lists the closest open matches after the claim and compare panels, for Free and Pro, with the link to all", async () => {
    for (const pro of [false, true]) {
      const { res, html } = await open("/account/organization", E({ open: [...matching(8), CLOSED, ...OPEN] }), await reader({ pro }));
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const m = main(html);
      const p = panel(m, ORG_PANEL);
      expect(m.indexOf(p)).toBeGreaterThan(m.indexOf("<h2>Organizations to Compare</h2>"));
      expect(p).toContain('<a href="/account/matches">All 9 matching notices</a>');
      const items = [...p.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => x[1]);
      expect(items).toHaveLength(5);
      expect(items[0]).toBe(`<strong>Close match</strong> <a href="/tenders/${OPEN_REF}">Translation services for regional offices</a><br/>` +
        '<span class="muted small">Public Services and Procurement Canada · Closes 2026-11-04 · ' +
        "UNSPSC class 821118 Editorial and support services: 5 award notices, 2 PSPC contract history records</span>");
      expect(items.slice(1).map((x) => /href="\/tenders\/([^"]+)"/.exec(x)?.[1])).toEqual(matching(4).map((r) => r.reference));
      expect(p).not.toContain("cb-900-closed");
      expect(p).toContain('<ol class="statement-list">');
      holdsDisclaimer(p, `organization ${pro}`);
    }
  });

  it("draws the rows the browser draws on /tenders from the same data", async () => {
    const list = [...matching(3), ...OPEN];
    const { html } = await open("/account/organization", E({ open: list }), await reader());
    const p = panel(main(html), ORG_PANEL);
    const data = fitClientData("en", { kind: "ready", id: A1, name: NAME1, home: "ON", block: BLOCK1 as any });
    const drawn = panelRows(data, list as unknown as TenderRow[], LEVELS).rows
      .map((r) => `<li><strong>${r.band}</strong> <a href="${r.href}">${r.title}</a><br/><span class="muted small">${r.detail}</span></li>`);
    expect(p).toContain(`<ol class="statement-list">${drawn.join("")}</ol>`);
    expect(p).toContain('<a href="/account/matches">All 4 matching notices</a>');
  });

  it("says why it lists nothing: no open match, the open notices unreadable, or a block that cannot rank", async () => {
    const cookie = await reader();
    const cases: [string, Files, string][] = [
      ["none open", { open: OPEN.slice(1) }, `No open notice matches the records of ${NAME1} today.`],
      ["unreadable", { open: undefined }, "The open notices cannot be read right now."],
      ["pending", { b1: undefined, stats: FILES["stats.json"] }, "Matching notices appear here after the next nightly data refresh."],
      ["empty", { b1: undefined }, `${NAME1} has no award notice, PSPC contract history record or published contract in fiscal years 2022-23 to 2026-27.`],
      ["uncoded", { b1: { ...BLOCK1, n: [0, 0, 12], coded: [0, 0] } },
        `The records of ${NAME1} in fiscal years 2022-23 to 2026-27 are published contracts, which carry no UNSPSC codes, so notices cannot be ranked by kind of work yet.`],
      ["thin", { b1: { ...BLOCK1, n: [2, 1, 12], coded: [2, 1] } },
        `${NAME1} has too few records with UNSPSC codes to rank notices: 2 award notices, 1 PSPC contract history record, fiscal years 2022-23 to 2026-27. A ranking needs at least 3 in one source.`],
    ];
    for (const [why, o, line] of cases) {
      const { res, html } = await open("/account/organization", E(o), cookie);
      expect(res.status, why).toBe(200);
      const p = panel(main(html), ORG_PANEL);
      expect(p, why).toContain(`<p>${line}</p>`);
      expect(p, why).not.toContain("<ol");
      expect(p, why).toContain('<a href="/account/matches">Matching notices</a>');
      holdsDisclaimer(p, why);
    }
  });

  it("speaks French", async () => {
    const { html } = await open("/account/organization?lang=fr", E(), await reader());
    const p = panel(main(html), `Avis correspondant à ${NAME1}`);
    expect(p).toContain('<a href="/account/matches">1 avis correspondant</a>');
    expect(p).toContain("<strong>Correspondance étroite</strong>");
    expect(p).toContain("Services publics et Approvisionnement Canada · Clôture le 2026-11-04 · Classe UNSPSC 821118 Services de rédaction et de soutien : ");
    expect(p).toContain('<a href="/terms?lang=fr#warranty">Conditions d\'utilisation</a>');
  });
});
