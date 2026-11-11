// /account/matches (src/account/fit_pages.tsx; docs/accounts.md, Matching
// notices): every state of the page, each with the disclaimer and its link to
// the Terms' No Warranty section; Free lists RULES.free.matches and says
// what Pro lists, Pro pages of MATCH_PAGE up to RULES.pro.matches; the page
// is private and never stored; one filled button in the unclaimed state and
// none in the ranking; before the nightly writes the blocks it says when
// matches come and never errors. Then the strings: no word that reads as a
// judgement of a business or a chance of winning, and the overview's link.
import { describe, expect, it } from "vitest";
import { MATCH_PAGE, RULES } from "../src/account/entitlements";
import { allKeys, rawEntry, type Key } from "../src/i18n";
import { ACCOUNTS, decode, get, grantPro, nbsp, newEmail, offEnv, onEnv, signIn, userId, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";

useAccountsDb();

const A1 = "org-a000000001"; // Exemplar Translation Services Inc., in Ontario
const ALIAS = "org-a00000000f"; // a retired id that took A1's records (fixtures/aliases-a00.json)
const NAME1 = "Exemplar Translation Services Inc.";
const PATH = "/account/matches";

// The fixtures' first open notice (cb-100-10000001, PSPC, 82111800, Ontario and Quebec, a Request for
// Proposal) shares class 821118 with this block: 45 + 25 (PSPC, 4 award notices) + 15 (Ontario, 6) + 10 = 95.
// The second (segments 72 and 78) and the third (43) share no segment.
const BLOCK = {
  fy: [2022, 2026], n: [7, 3, 12], coded: [7, 3], newest: "2026-09-30",
  classes: [["821118", 5, 2], ["811015", 2, 0]],
  families: [["8211", 5, 2], ["8110", 2, 0]],
  segments: [["82", 5, 2], ["81", 2, 0]],
  buyers: [["pwgsc-tpsgc", 4, 3, 0], ["dfo-mpo", 1, 0, 4]],
  provinces: [["ON", 6, 2], ["QC", 1, 1]],
  types: [["Request for Proposal", 5, 1]],
  held: [["SA", "82", 1]],
};

const OPEN = FILES["tenders/open.json"] as Record<string, unknown>[];
// n notices like the first fixture, each a 95-point close match, closing on one day, so they stand in
// reference order; and one more whose closing time passed before the page's clock.
const matching = (n: number) => Array.from({ length: n }, (_, i) => ({
  ...OPEN[0], reference: `cb-900-${String(i).padStart(8, "0")}`, title_en: `Matching notice ${i}`, title_fr: `Avis correspondant ${i}`,
  closing: "2026-11-20T14:00:00",
}));
const CLOSED = { ...OPEN[0], reference: "cb-900-closed", title_en: "Closed notice", closing: "2026-10-30T14:00:00" };
const UNCODED = { ...OPEN[0], reference: "cb-900-uncoded", title_en: "Uncoded notice", codes: [], segments: [] };

const STATS = { ...(FILES["stats.json"] as object), matching_fy: [2022, 2026] };

function profiles(matching: unknown): Record<string, any> {
  const p = structuredClone(FILES["profiles/a00.json"]) as Record<string, any>;
  if (matching !== undefined) p[A1].matching = matching;
  return p;
}

// The environment with the switch on and the files given: the profile's block (undefined for none), the
// open list, and stats.json with or without the window of the night's blocks.
const E = (o: { block?: unknown; open?: unknown; stats?: unknown } = {}) => onEnv({
  ASSETS: makeFakeAssets({}, {
    "profiles/a00.json": profiles(o.block),
    "stats.json": o.stats === undefined ? STATS : o.stats,
    ...("open" in o ? { "tenders/open.json": o.open } : {}),
  }),
});

async function reader(o: { pro?: boolean; org?: string | null } = {}): Promise<string> {
  const email = newEmail("matches");
  const cookie = await signIn(email, { env: E() });
  if (o.pro) await grantPro(email);
  if (o.org !== null) {
    const now = new Date().toISOString();
    await ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?, ?, NULL, '[]', ?, ?)")
      .bind(await userId(email), o.org ?? A1, now, now).run();
  }
  return cookie;
}

const open = async (cookie: string, env: object, path = PATH) => {
  const res = await get(path, { cookie, env });
  return { res, html: nbsp(decode(await res.text())).replace(/’/g, "'") };
};
const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const filled = (html: string) => main(html).match(/class="btn btn-primary"/g)?.length ?? 0;
const rowsOf = (html: string) => [...main(html).matchAll(/<a href="\/tenders\/(cb-[^"]+)">/g)].map((m) => m[1]);

const DISCLAIMER = "Award Watch calculates matches from public records. A match is not advice and may be wrong. See the Terms of Use.";
const TERMS_LINK = '<a href="/terms#warranty">Terms of Use</a>';

function holdsDisclaimer(html: string, why: string) {
  expect(main(html).replace(/<[^>]+>/g, ""), why).toContain(DISCLAIMER);
  expect(main(html), why).toContain(TERMS_LINK);
  expect(main(html), why).toContain('<a href="/methodology#matching">How matches are counted</a>');
}

describe("the page", () => {
  it("is the site's 404 while the switch is off, and needs a session", async () => {
    expect((await get(PATH, { env: offEnv() })).status).toBe(404);
    const out = await get(PATH, { env: E() });
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/account/sign-in?next=%2Faccount%2Fmatches");
  });

  it("asks an account with no claim to choose its organization, with the page's one filled button", async () => {
    const cookie = await reader({ org: null });
    const { res, html } = await open(cookie, E({ block: BLOCK }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(html).toContain("<h1>Matching Notices</h1>");
    expect(html).toContain("Tell the site which organization is yours, and this page ranks the open notices by what each has in common with its records.");
    expect(main(html)).toContain('<a href="/account/organization" class="btn btn-primary">Choose Your Organization</a>');
    expect(filled(html)).toBe(1);
    holdsDisclaimer(html, "unclaimed");
  });

  it("says matches come with the next nightly refresh while the files predate the blocks, and never errors", async () => {
    const cookie = await reader();
    // No block and no window in stats.json: the night's export has not written them yet.
    const before = await open(cookie, E({ stats: FILES["stats.json"] }));
    expect(before.res.status).toBe(200);
    expect(before.html).toContain("Matching notices appear here after the next nightly data refresh.");
    expect(before.html).toContain(`<a href="/organizations/${A1}">${NAME1}</a>`);
    holdsDisclaimer(before.html, "pending");
    expect(rowsOf(before.html)).toEqual([]);
    // A block that does not read waits for the next night too, rather than say the organization has nothing.
    const broken = await open(cookie, E({ block: { ...BLOCK, n: "seven" } }));
    expect(broken.res.status).toBe(200);
    expect(broken.html).toContain("Matching notices appear here after the next nightly data refresh.");
    // Neither stats.json nor the open list: still the page.
    const bare = await open(cookie, E({ stats: null, open: undefined }));
    expect(bare.res.status).toBe(200);
    expect(bare.html).toContain("Matching notices appear here after the next nightly data refresh.");
  });

  it("says the organization has no record in the window once the night's export wrote the blocks", async () => {
    const cookie = await reader();
    const { res, html } = await open(cookie, E());
    expect(res.status).toBe(200);
    expect(html).toContain(`${NAME1} has no award notice, PSPC contract history record or published contract in fiscal years 2022-23 to 2026-27.`);
    holdsDisclaimer(html, "empty");
    // A block that counts nothing but a held instrument says the same.
    const held = await open(cookie, E({ block: { ...BLOCK, n: [0, 0, 0], coded: [0, 0], classes: [], families: [], segments: [], buyers: [], provinces: [], types: [] } }));
    expect(held.html).toContain(`${NAME1} has no award notice, PSPC contract history record or published contract in fiscal years 2022-23 to 2026-27.`);
  });

  it("says why it cannot rank: published contracts only, or too few records with codes", async () => {
    const cookie = await reader();
    const uncoded = await open(cookie, E({ block: { ...BLOCK, n: [0, 0, 12], coded: [0, 0] } }));
    expect(uncoded.html).toContain(`The records of ${NAME1} in fiscal years 2022-23 to 2026-27 are published contracts, which carry no UNSPSC codes, so notices cannot be ranked by kind of work yet.`);
    holdsDisclaimer(uncoded.html, "uncoded");
    const thin = await open(cookie, E({ block: { ...BLOCK, n: [2, 1, 12], coded: [2, 1] } }));
    expect(thin.html).toContain(`${NAME1} has too few records with UNSPSC codes to rank notices: 2 award notices, 1 PSPC contract history record, fiscal years 2022-23 to 2026-27. A ranking needs at least 3 in one source.`);
    holdsDisclaimer(thin.html, "thin");
    expect(rowsOf(thin.html)).toEqual([]);
  });

  it("ranks the open notices for a claim, each with its band, its total and every reason with its points", async () => {
    const cookie = await reader();
    const { res, html } = await open(cookie, E({ block: BLOCK }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // Only the first fixture shares a segment; the others are not listed.
    expect(rowsOf(html)).toEqual(["cb-100-10000001"]);
    expect(html).toContain('<span class="panel-count">1 match</span>');
    const row = /<tbody>[\s\S]*?<\/tbody>/.exec(main(html))?.[0] ?? "";
    expect(row).toContain("<strong>Close match</strong>");
    expect(row).toContain("95 of 100 points");
    const reasons = [...row.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
    expect(reasons).toEqual([
      "UNSPSC class 821118 Editorial and support services: 5 award notices, 2 PSPC contract history records +4545 points",
      "Buyer Public Services and Procurement Canada: 4 award notices, 3 PSPC contract history records +2525 points",
      "Province of delivery Ontario: 6 award notices, 2 PSPC contract history records +1515 points",
      "Notice type Request for Proposal: 5 award notices, 1 PSPC contract history record +1010 points",
    ]);
    expect(row).toContain('<span class="mono" aria-hidden="true">+45</span><span class="visually-hidden">45 points</span>');
    // What the ranking read, and from what.
    expect(html).toContain("What the Matches Read");
    expect(html).toContain("821118 Editorial and support services: 5 award notices, 2 PSPC contract history records");
    expect(html).toContain('<a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a>: 4 award notices, 3 PSPC contract history records');
    expect(html).toContain("From 7 award notices, 3 PSPC contract history records, 12 published contracts, fiscal years 2022-23 to 2026-27.");
    expect(html).toContain("The newest of these records is dated 2026-09-30.");
    expect(html).toContain("Supply arrangement, segment 82 Editorial and Design and Graphic and Fine Art Services: 1");
    // The lines under it.
    holdsDisclaimer(html, "ready");
    expect(html).toContain("A match is not a chance of winning: the federal files name the supplier a contract went to and no other bidder.");
    expect(html).toContain(`A notice with no match may still suit ${NAME1}: a match reads only UNSPSC codes, buyers, provinces and notice types.`);
    expect(html).toContain("Contains information licensed under the Open Government Licence, Canada.");
    expect(filled(html)).toBe(0);
  });

  it("follows a claim on a retired id to the profile that took its records", async () => {
    const cookie = await reader({ org: ALIAS });
    const { html } = await open(cookie, E({ block: BLOCK }));
    expect(html).toContain(`<a href="/organizations/${A1}">${NAME1}</a>`);
    expect(rowsOf(html)).toEqual(["cb-100-10000001"]);
  });

  it("lists the first RULES.free.matches on Free, with the plans' own figures under them", async () => {
    expect(RULES.free.matches).toBe(5);
    const cookie = await reader();
    const { html } = await open(cookie, E({ block: BLOCK, open: [...matching(8), CLOSED, UNCODED, ...OPEN.slice(1)] }));
    expect(rowsOf(html)).toEqual(matching(5).map((r) => r.reference));
    expect(html).toContain('<span class="panel-count">8 matches</span>');
    expect(html).toContain("The Free plan lists the first 5 matching notices. Pro lists up to 200, 50 a page.");
    expect(main(html)).toContain('<a href="/account/billing">Plans and prices</a>');
    // No chip on this page, and no pages to turn.
    expect(main(html)).not.toContain("pro-tag");
    expect(html).not.toContain('class="pagination"');
    // The notice without a code is counted, the closed one left out.
    expect(html).toContain("1 open notice carries no UNSPSC code and cannot be matched.");
    expect(html).not.toContain("cb-900-closed");
    expect(filled(html)).toBe(0);
  });

  it("lists up to RULES.pro.matches on Pro, MATCH_PAGE a page, the closest first", async () => {
    expect([RULES.pro.matches, MATCH_PAGE]).toEqual([200, 50]);
    const cookie = await reader({ pro: true });
    const env = E({ block: BLOCK, open: matching(230) });
    const first = await open(cookie, env);
    expect(rowsOf(first.html)).toEqual(matching(50).map((r) => r.reference));
    expect(first.html).toContain('<span class="panel-count">230 matches</span>');
    expect(first.html).toContain("Page 1 of 4");
    expect(first.html).toContain(`<a href="${PATH}?page=2" class="btn" rel="next">Next</a>`);
    expect(first.html).toContain("The first 200 of 230 matching notices are listed, the closest first.");
    expect(first.html).not.toContain("The Free plan lists");
    const last = await open(cookie, env, `${PATH}?page=4`);
    expect(rowsOf(last.html)).toEqual(matching(200).slice(150).map((r) => r.reference));
    expect(last.html).not.toContain('rel="next"');
    // A page past the last shows the last; anything else the first.
    expect(rowsOf((await open(cookie, env, `${PATH}?page=9`)).html)).toEqual(rowsOf(last.html));
    expect(rowsOf((await open(cookie, env, `${PATH}?page=x`)).html)).toEqual(rowsOf(first.html));
    expect(filled(first.html)).toBe(0);
  });

  it("says when no open notice matches, and when the open notices cannot be read", async () => {
    const cookie = await reader();
    const none = await open(cookie, E({ block: BLOCK, open: OPEN.slice(1) }));
    expect(none.html).toContain(`No open notice matches the records of ${NAME1} today. <a href="/tenders">All open notices</a>`);
    holdsDisclaimer(none.html, "none open");
    const down = await open(cookie, E({ block: BLOCK, open: undefined }));
    expect(down.res.status).toBe(200);
    expect(down.html).toContain("The open notices cannot be read right now.");
    holdsDisclaimer(down.html, "unavailable");
  });

  it("speaks French, the Terms linked in French", async () => {
    const cookie = await reader();
    const { html } = await open(cookie, E({ block: BLOCK }), `${PATH}?lang=fr`);
    expect(html).toContain("<h1>Avis correspondants</h1>");
    expect(html).toContain("<strong>Correspondance étroite</strong>");
    expect(html).toContain("95 points sur 100");
    expect(html).toContain("Classe UNSPSC 821118 Services de rédaction et de soutien : 5 avis d'attribution, 2 dossiers de l'historique des contrats de SPAC");
    // The basis panel's rows take the French colon too, and the notice types their French names.
    expect(html).toContain("<li>821118 Services de rédaction et de soutien : 5 avis d'attribution, 2 dossiers de l'historique des contrats de SPAC</li>");
    expect(html).toContain("<li>Demande de propositions : 5 avis d'attribution, 1 dossier de l'historique des contrats de SPAC</li>");
    expect(main(html).replace(/<[^>]+>/g, "")).toContain(
      "Award Watch calcule les correspondances à partir de dossiers publics. Une correspondance ne constitue pas un conseil et peut être erronée. Voir les Conditions d'utilisation.");
    expect(main(html)).toContain('<a href="/terms?lang=fr#warranty">Conditions d\'utilisation</a>');
    expect(main(html)).not.toMatch(/Close match|Matching Notices|award notices/);
  });
});

describe("around the page", () => {
  it("is linked from the overview beside the claimed organization, and not without a claim", async () => {
    const claimed = await reader();
    expect((await open(claimed, E(), "/account")).html).toContain('<li><a href="/account/matches">Matching notices</a></li>');
    const unclaimed = await reader({ org: null });
    expect((await open(unclaimed, E(), "/account")).html).not.toContain('href="/account/matches"');
  });

  it("are covered by a paragraph of the Terms' No Warranty section, in both languages, whatever the switch", async () => {
    for (const env of [offEnv(), E()]) {
      const en = nbsp(decode(await (await get("/terms", { env })).text()));
      const warranty = en.indexOf("The figures are drawn from the sources as published");
      const advisory = en.indexOf("Some features calculate, from public records, what may interest a reader");
      const liability = en.indexOf("Award Watch is not liable for any loss");
      expect(warranty).toBeGreaterThan(0);
      expect(advisory).toBeGreaterThan(warranty);
      expect(liability).toBeGreaterThan(advisory);
      expect(en).toContain('These calculations follow the fixed rules on the <a href="/methodology#matching">Methodology</a> page.');
      expect(en).toContain("Award Watch is not responsible for their accuracy or for any decision made on them, including a decision to bid or not to bid.");
      const fr = nbsp(decode(await (await get("/terms?lang=fr", { env })).text())).replace(/’/g, "'");
      expect(fr).toContain("Ces calculs suivent les règles fixes décrites à la page <a href=\"/methodology#matching\">Méthodologie</a>.");
      expect(fr).toContain("Award Watch n'est pas responsable de leur exactitude ni d'aucune décision prise sur leur base, y compris celle de soumissionner ou non.");
    }
  });

  it("are stated on the Methodology page from the scoring module's own figures, whatever the switch", async () => {
    for (const env of [offEnv(), E()]) {
      const html = nbsp(decode(await (await get("/methodology", { env })).text()));
      const toc = /<nav class="toc"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
      expect(toc.indexOf('<a href="#matching">Matching Notices</a>')).toBeGreaterThan(toc.indexOf('<a href="#analytics">'));
      expect(html).toContain('<h2 id="matching">Matching Notices</h2>');
      const section = html.slice(html.indexOf('<h2 id="matching">'), html.indexOf('<h2 id="people">'));
      const cells = [...section.matchAll(/<td data-label="Points" class="mono">([^<]*)<\/td>/g)].map((m) => m[1]);
      expect(cells).toEqual(["45 / 35", "25 / 20", "10 / 5", "25 / 15", "15 / 10 / 8 / 5", "15 / 10 / 5"]);
      expect(section).toContain("The notice shares a UNSPSC class with 3 or more records of one source; with 1 to 2");
      expect(section).toContain("dated in the 5 fiscal years ending with the data date's");
      expect(section).toContain("Its points, out of 100, name the match: close from 60, partial from 30, weak below.");
      expect(section).toContain("A ranking needs at least 3 records with UNSPSC codes in one source over the period.");
      expect(section).toContain("Grants and lobbying reports are not read.");
      expect(section).not.toContain("/account");
    }
    const fr = nbsp(decode(await (await get("/methodology?lang=fr", { env: offEnv() })).text()));
    expect(fr).toContain('<h2 id="matching">Avis correspondants</h2>');
  });

  it("keeps out of every matching string a word that reads as a judgement of the business or a chance of winning", () => {
    const EN = /\b(fit|qualified|eligible|capable|should|recommend\w*|likely|odds|probabl\w*)\b/i;
    const FR = /\b(qualifiée?s?|admissibles?|capables?|devrai\w*|recommand\w*|probab\w*)\b/i;
    // The week's mail (fit.mail_*) and its plan row are held to the same list.
    const keys = allKeys().filter((k) => k.startsWith("fit.") || k.startsWith("methodology.matching") || k === "plans.matches" ||
      k === "plans.match_mail") as Key[];
    expect(keys.length).toBeGreaterThan(40);
    for (const key of ["fit.mail_heading", "fit.mail_row", "fit.mail_detail", "fit.mail_more_one", "fit.mail_more_many", "fit.mail_subject_one",
      "fit.mail_subject_many", "fit.mail_free_note", "plans.match_mail"]) expect(keys, key).toContain(key);
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      expect(en, key).not.toMatch(EN);
      expect(fr, key).not.toMatch(FR);
      // No dash of either length in the prose.
      expect(en + fr, key).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`));
    }
  });
});
