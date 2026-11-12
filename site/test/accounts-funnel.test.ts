// The first step: what a reader not signed in is told where an account would
// help. The sign-in page says what a free account gives, beside the form; the
// landing page has a band on matching notices with one example match drawn
// from sample values; an open notice's page says, in the match panel's place,
// what an account that names its organization sees there; a profile asks
// whether the organization is the reader's; a guide ends on its email list.
// Each is the same for every reader not signed in, so the public pages keep
// their headers; with the accounts switch off none of them shows.
import { describe, expect, it } from "vitest";
import interestJs from "../public/interest.js?raw";
import { MATCH_MAX } from "../public/fit.js";
import { RULES } from "../src/account/entitlements";
import { FREE_LINES, freeLines } from "../src/account/pages";
import { GUIDES, type Guide } from "../src/guides";
import { t, type Lang } from "../src/i18n";
import { app } from "../src/index";
import { interestFilter } from "../src/pages/interest";
import { MATCH_SIGN_IN, SAMPLE_ORG, sampleScore } from "../src/pages/landing";
import { PLAN_ROWS, planLine } from "../src/pro";
import { ACCOUNTS, DB, decode, get, nbsp, newEmail, nextIp, offEnv, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const read = async (res: Response) => nbsp(decode(await res.text())).replace(/’/g, "'");
const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const text = (s: string) => s.replace(/<[^>]+>/g, "");
const filled = (html: string) => main(html).match(/class="btn btn-primary"/g)?.length ?? 0;
// The section that holds a panel's title.
const panel = (html: string, title: string) => {
  const at = html.indexOf(`<h2>${title}</h2>`);
  if (at < 0) return "";
  const start = html.lastIndexOf("<section", at);
  return html.slice(start, html.indexOf("</section>", at) + "</section>".length);
};
const stale = "__Host-aw_session=" + "a".repeat(32) + "." + "b".repeat(64);
const COMPARATIVE = /\b(more|higher|above|unlimited|plus|davantage|supérieure?s?|au-dessus|illimitée?s?)\b/i;

// -- A. the sign-in page --------------------------------------------------------------------------

describe("the sign-in page", () => {
  it("names both acts, one form for a new account and a return, and says it is free, with no card and no password", async () => {
    const en = await read(await get("/account/sign-in"));
    expect(en).toContain("<h1>Create a Free Account or Sign In</h1>");
    expect(en).toContain("<title>Create a Free Account or Sign In");
    expect(en).toContain("An account is free and needs no card or password. Enter your email address and the site sends a 6-digit code and a link. " +
      "Either one signs you in, and the first sign-in creates the account.");
    const fr = await read(await get("/account/sign-in?lang=fr"));
    expect(fr).toContain("<h1>Créer un compte gratuit ou se connecter</h1>");
    expect(fr).toContain("Un compte est gratuit et ne demande ni carte ni mot de passe.");
    for (const page of [en, fr]) {
      expect(page).not.toContain(EM_DASH);
      expect(page).not.toContain(EN_DASH);
    }
  });

  it("lists what a free account gives in the Free card's own words, figures from RULES, the weekly email, then Pro's own figures", async () => {
    const html = await read(await get("/account/sign-in"));
    const p = panel(main(html), "What a Free Account Gives You");
    expect(p).not.toBe("");
    const lines = [...p.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
    expect(lines).toEqual(freeLines("en", true).map(nbsp));
    expect(lines).toEqual([
      `${RULES.free.saved_searches} saved searches, on the site`,
      `${RULES.free.watchlists} watches, on the site`,
      `${RULES.free.matches} matching notices for your organization`,
      `${RULES.free.match_mail} matching notices a week, by email`,
      "The weekly email, each Monday",
    ]);
    // Each line but the weekly email's is the Free plan card's own, so the two never disagree.
    for (const key of FREE_LINES) {
      const row = PLAN_ROWS.find((r) => r.free?.key === key)!;
      expect(lines, key).toContain(nbsp(planLine("en", row.free!)));
    }
    expect(text(p)).toContain(`Pro: ${RULES.pro.saved_searches} saved searches and ${RULES.pro.watchlists} watches, each change by email; ` +
      `${RULES.pro.matches} matching notices, ${RULES.pro.match_mail} a week by email. Plans and prices`);
    expect(p).toContain('<a href="/pro">Plans and prices</a>');
    expect(text(p)).not.toMatch(COMPARATIVE);
    // No chip, no second filled button: Send the code stays the page's one.
    expect(main(html)).not.toContain("pro-tag");
    expect(filled(html)).toBe(1);
    expect(main(html)).toContain('<button type="submit" class="btn btn-primary">Send the code</button>');
    // The form first, then the list, inside the one grid.
    const grid = main(html).slice(main(html).indexOf('<div class="signin-grid">'));
    expect(grid.indexOf("<h2>Email Address</h2>")).toBeGreaterThan(0);
    expect(grid.indexOf("<h2>Email Address</h2>")).toBeLessThan(grid.indexOf("<h2>What a Free Account Gives You</h2>"));
  });

  it("speaks French, the lines the Free card's own", async () => {
    const html = await read(await get("/account/sign-in?lang=fr"));
    const p = panel(main(html), "Ce que donne un compte gratuit");
    expect([...p.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]))).toEqual(freeLines("fr", true).map((s) => nbsp(s).replace(/’/g, "'")));
    expect(text(p)).toContain(`${RULES.free.saved_searches} recherches enregistrées, sur le site`);
    expect(text(p)).toContain("Le courriel hebdomadaire, chaque lundi");
    expect(text(p)).toContain(`Pro : ${RULES.pro.saved_searches} recherches enregistrées et ${RULES.pro.watchlists} suivis, chaque changement par courriel; ` +
      `${RULES.pro.matches} avis correspondants, ${RULES.pro.match_mail} par semaine par courriel.`);
    expect(p).toContain('<a href="/pro">Forfaits et prix</a>');
    expect(text(p)).not.toMatch(COMPARATIVE);
  });

  it("keeps what the form carries, and the line that a Follow or a briefing rides along above the general list", async () => {
    const org = "org-a000000001";
    const follow = await read(await get(`/account/sign-in?next=%2Forganizations%2F${org}&follow=organization%3A${org}`));
    expect(follow).toContain(`<input type="hidden" name="next" value="/organizations/${org}"/>`);
    expect(follow).toContain(`<input type="hidden" name="follow" value="organization:${org}"/>`);
    expect(follow).toContain('<input type="checkbox" name="weekly" value="1"/>');
    const note = follow.indexOf("Signing in also follows the page where you pressed Follow.");
    expect(note).toBeGreaterThan(0);
    expect(note).toBeLessThan(follow.indexOf("<h2>What a Free Account Gives You</h2>"));
    const brief = await read(await get("/account/sign-in?next=%2Fsegments%2F82&brief=segment%3A82"));
    expect(brief).toContain('<input type="hidden" name="brief" value="segment:82"/>');
    const briefNote = brief.indexOf("Signing in also saves the weekly briefing");
    expect(briefNote).toBeGreaterThan(0);
    expect(briefNote).toBeLessThan(brief.indexOf("<h2>What a Free Account Gives You</h2>"));
  });

  it("leaves the code step and its error lines as they were, without the list", async () => {
    const email = newEmail("funnel-code");
    const sent = await read(await post("/account/sign-in", { email, lang: "en", weekly: "1" }));
    expect(sent).toContain("<h1>Check Your Email</h1>");
    expect(sent).toContain('<input type="hidden" name="weekly" value="1"/>');
    expect(sent).not.toContain("What a Free Account Gives You");
    const wrong = await read(await post("/account/check", { email, code: "000000", sent: "1", lang: "en" }));
    expect(wrong).toContain("<h1>Check Your Email</h1>");
    expect(wrong).toContain('<ul class="errors" role="alert">');
    expect(wrong).not.toContain("What a Free Account Gives You");
  });

  it("leaves the weekly email out of the list while the form does not offer its box", async () => {
    expect(freeLines("en", false)).toEqual(freeLines("en", true).slice(0, -1));
    expect(freeLines("en", false)).toHaveLength(FREE_LINES.length);
  });
});

// -- B. the landing page --------------------------------------------------------------------------

const landing = (path: string, env: object) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, env);
const band = (page: string) => /<section class="lp-feat lp-paper lp-flip lp-fit"[\s\S]*?<\/section>/.exec(page)?.[0] ?? "";

describe("the landing page's band on matching notices", () => {
  it("scores its example by the rules themselves: a close match, the reasons adding up to the points", () => {
    const score = sampleScore();
    expect(score.band).toBe("close");
    expect(score.points).toBe(score.reasons.reduce((s, r) => s + r.points, 0));
    expect(score.reasons.map((r) => [r.kind, r.points])).toEqual([["class", 45], ["delivered", 15], ["type", 10]]);
  });

  it("says what a free account gets, Free's and Pro's figures from RULES, its one action to the sign-in for the claim page", async () => {
    const res = await landing("/", onEnv());
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const page = await read(res);
    const b = band(page);
    expect(b).not.toBe("");
    expect(b).toContain('<p class="lp-eyebrow">Matching notices</p>');
    expect(b).toContain('<h2 id="lp-f4">See which open tenders match your records</h2>');
    expect(b).toContain("Name your organization in a free account. The site ranks the open notices by what each has in common with its award notices " +
      "and contract history, and shows every reason with its record counts.");
    expect(MATCH_SIGN_IN).toBe("/account/sign-in?next=%2Faccount%2Forganization");
    // The band's one action, styled as every band's is.
    expect(b.match(/class="lp-btn[^"]*"/g)).toEqual(['class="lp-btn lp-btn-fill"']);
    expect(b).toContain(`<a class="lp-btn lp-btn-fill" href="${MATCH_SIGN_IN}">Name your organization</a>`);
    expect(b).toContain(`<p class="lp-pro">Free lists ${RULES.free.matches} matching notices and emails ${RULES.free.match_mail} a week. ` +
      `Pro lists ${RULES.pro.matches} and emails ${RULES.pro.match_mail} a week.</p>`);
    expect(text(b)).not.toMatch(COMPARATIVE);
    expect(b).not.toContain("pro-tag");
    // After the companies' band, before the steps.
    expect(page.indexOf('aria-labelledby="lp-f4"')).toBeGreaterThan(page.indexOf('aria-labelledby="lp-f3"'));
    expect(page.indexOf('aria-labelledby="lp-f4"')).toBeLessThan(page.indexOf('aria-labelledby="lp-how-h"'));
  });

  it("draws one match as the account's page does, labelled as an example, with the line every match carries", async () => {
    const b = band(await read(await landing("/", onEnv())));
    const card = b.slice(b.indexOf('<div class="lp-shot lp-match">'), b.indexOf('<div class="lp-copy">'));
    const score = sampleScore();
    expect(card).toContain('<div class="lp-shot-head"><span>Example, with sample values</span></div>');
    expect(card).toContain(`<p class="lp-match-band"><b>Close match</b> <span>${score.points} of ${MATCH_MAX} points</span></p>`);
    expect(card).toContain('<p class="lp-match-ti">Building maintenance services</p>');
    expect(card).toContain(`<p class="lp-match-su">Compared with the records of ${SAMPLE_ORG}</p>`);
    expect([...card.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]))).toEqual([
      "UNSPSC class 721015 Building support services: 9 award notices, 3 PSPC contract history records+4545 points",
      "Province of delivery Ontario: 8 award notices, 2 PSPC contract history records+1515 points",
      "Notice type Request for Proposal: 6 award notices, 1 PSPC contract history record+1010 points",
    ]);
    expect(card).toContain('<b class="num" aria-hidden="true">+45</b><span class="visually-hidden">45 points</span>');
    expect(text(card)).toContain("Award Watch calculates matches from public records. A match is not advice and may be wrong. See the Terms of Use.");
    expect(card).toContain('<a href="/terms#warranty">Terms of Use</a>');
    expect(card).toContain('<a href="/methodology#matching">How matches are counted</a>');
    // A made-up organization, as the fixtures' are: no name from the records' band.
    expect(SAMPLE_ORG).toMatch(/^Sample /);
  });

  it("speaks French", async () => {
    const b = band(await read(await landing("/?lang=fr", onEnv())));
    expect(b).toContain('<h2 id="lp-f4">Voyez quels appels d\'offres ouverts correspondent à vos dossiers</h2>');
    expect(b).toContain("<span>Exemple, avec des valeurs fictives</span>");
    expect(b).toContain(`<b>Correspondance étroite</b> <span>${sampleScore().points} points sur ${MATCH_MAX}</span>`);
    expect(text(b)).toContain("Classe UNSPSC 721015 Services de soutien des bâtiments : 9 avis d'attribution, 3 dossiers de l'historique des contrats de SPAC");
    expect(text(b)).toContain("Type d'avis Demande de propositions : 6 avis d'attribution, 1 dossier de l'historique des contrats de SPAC");
    expect(b).toContain('<a href="/terms?lang=fr#warranty">Conditions d\'utilisation</a>');
    expect(b).toContain(`Le forfait Gratuit présente ${RULES.free.matches} avis correspondants`);
    expect(text(b)).not.toMatch(/Close match|award notices|Example/);
  });

  it("is not there while the switch is off", async () => {
    for (const path of ["/", "/?lang=fr"]) {
      const page = await (await landing(path, offEnv())).text();
      expect(band(page), path).toBe("");
      expect(page, path).not.toContain("lp-match");
    }
  });
});

// -- C. an open notice's page ---------------------------------------------------------------------

const OPEN_REF = "cb-100-10000001"; // closes 2026-11-04, after the tests' clock
const LATER = "2026-11-05T16:00:00Z"; // the notice has closed
const INVITE_TITLE = "Match With Your Organization";
const INVITE = "A free account that names its organization sees here what this notice has in common with that organization's records, " +
  "each reason with its record counts.";

describe("an open notice's page for a reader not signed in", () => {
  it("says in the match panel's place what a free account that names its organization sees there, with the sign-in back to the notice", async () => {
    const res = await get(`/tenders/${OPEN_REF}`);
    expect(res.status).toBe(200);
    const html = await read(res);
    const p = panel(main(html), INVITE_TITLE);
    expect(p).toBe(
      `<section class="panel"><div class="panel-head"><h2>${INVITE_TITLE}</h2></div>` +
      `<p>${INVITE} <a href="/account/sign-in?next=%2Ftenders%2F${OPEN_REF}">Create a free account or sign in</a></p></section>`,
    );
    // Where the match panel stands for an account, and the notice on CanadaBuys still the one filled button.
    const m = main(html);
    expect(m.indexOf(INVITE_TITLE)).toBeGreaterThan(m.indexOf('class="panel-grid"'));
    expect(m.indexOf(INVITE_TITLE)).toBeLessThan(m.indexOf('class="panel tender-documents"'));
    expect(filled(html)).toBe(1);
    expect(p).not.toMatch(/fit-disclaimer|points|Close match/);
  });

  it("keeps the page's public headers, the same bytes for every reader not signed in", async () => {
    const a = await get(`/tenders/${OPEN_REF}`);
    const b = await get(`/tenders/${OPEN_REF}`, { cookie: stale });
    for (const r of [a, b]) {
      expect(r.headers.get("cache-control")).toBe("public, max-age=300");
      expect(r.headers.get("vary")).toContain("Cookie");
    }
    const [ta, tb] = [await a.text(), await b.text()];
    expect(ta).toBe(tb);
    expect(ta).toContain(INVITE_TITLE);
  });

  it("speaks French", async () => {
    const html = await read(await get(`/tenders/${OPEN_REF}?lang=fr`));
    const p = panel(main(html), "Correspondance avec votre organisation");
    expect(p).toContain("Un compte gratuit qui indique son organisation voit ici ce que cet avis a en commun avec les dossiers de cette organisation");
    expect(p).toContain(`<a href="/account/sign-in?next=%2Ftenders%2F${OPEN_REF}">Créer un compte gratuit ou se connecter</a>`);
  });

  it("shows nothing on a closed notice, or while the switch is off", async () => {
    const closed = await read(await get(`/tenders/${OPEN_REF}`, { env: onEnv({ NOW: LATER }) }));
    expect(closed).toContain("Closed 2026-11-04");
    expect(closed).not.toContain(INVITE_TITLE);
    const off = await get(`/tenders/${OPEN_REF}`, { env: offEnv() });
    expect(off.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await off.text()).not.toContain(INVITE_TITLE);
  });

  it("gives a signed-in reader no invitation, the panel or the line as before", async () => {
    const html = await read(await get(`/tenders/${OPEN_REF}`, { cookie: await signIn(newEmail("funnel-notice")) }));
    expect(html).not.toContain(INVITE);
    expect(html).toContain("Tell the site which organization is yours to see what this notice has in common with its records");
  });
});

// -- D. a profile --------------------------------------------------------------------------------

const ORG = "org-a000000001"; // award notices and published contracts
const OTHER = "org-a000000002";
const CLAIM = `/account/organization?q=${ORG}`;
const ASK = /<p class="page-note claim-ask">([\s\S]*?)<\/p>/;

async function claim(email: string, id: string) {
  const now = new Date().toISOString();
  await ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?, ?, NULL, '[]', ?, ?)")
    .bind(await userId(email), id, now, now).run();
}

describe("a profile's line asking whether the organization is the reader's", () => {
  it("asks a reader not signed in, with the sign-in back to the claim page opened on this profile", async () => {
    const res = await get(`/organizations/${ORG}`);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const html = await read(res);
    const line = ASK.exec(html)?.[0] ?? "";
    expect(line).toBe(
      '<p class="page-note claim-ask">Is this your organization? ' +
      `<a href="/account/sign-in?next=${encodeURIComponent(CLAIM)}">Name it in a free account</a> and see the open tender notices that match its records.</p>`,
    );
    // Near the head, after the Follow control; Follow stays the profile's one filled button.
    const head = html.slice(html.indexOf('<header class="page-head"'), html.indexOf("</header>", html.indexOf('<header class="page-head"')));
    expect(head).toContain(line);
    expect(head.indexOf(line)).toBeGreaterThan(head.indexOf("watch-signin"));
    expect(filled(html)).toBe(1);
    // The same bytes for every reader not signed in.
    expect(await (await get(`/organizations/${ORG}`, { cookie: stale })).text()).toBe(await (await get(`/organizations/${ORG}`)).text());
  });

  it("leads, once signed in, to the claim page with this profile as its one result and its button", async () => {
    const cookie = await signIn(newEmail("funnel-claim"));
    const html = await read(await get(CLAIM, { cookie }));
    expect(html).toContain(`<a href="/organizations/${ORG}">Exemplar Translation Services Inc.</a>`);
    expect(html).toContain(`<input type="hidden" name="org" value="${ORG}"/>`);
    expect(html.match(/name="org" value=/g)).toHaveLength(1);
    expect(html).toContain('<button type="submit" class="btn">This is us</button>');
  });

  it("gives a signed-in account that names no organization the same line, straight to the claim page", async () => {
    const res = await get(`/organizations/${ORG}`, { cookie: await signIn(newEmail("funnel-none")) });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(ASK.exec(await read(res))?.[1]).toBe(
      `Is this your organization? <a href="${CLAIM}">Name it in your account</a> and see the open tender notices that match its records.`,
    );
  });

  it("gives an account that names this organization, or another, nothing new", async () => {
    for (const id of [ORG, OTHER]) {
      const email = newEmail("funnel-named");
      const cookie = await signIn(email);
      await claim(email, id);
      const html = await read(await get(`/organizations/${ORG}`, { cookie }));
      expect(html, id).not.toMatch(ASK);
      expect(html, id).not.toContain("Is this your organization");
    }
  });

  it("asks nothing on a profile of grants or lobbying alone, which a match does not read", async () => {
    const profiles = structuredClone(FILES["profiles/a00.json"]) as Record<string, any>;
    Object.assign(profiles[OTHER].organization, { n_awards: 0, n_history: 0, n_contracts: 0 });
    expect(profiles[OTHER].organization.n_grants).toBeGreaterThan(0);
    const env = onEnv({ ASSETS: makeFakeAssets({}, { "profiles/a00.json": profiles }) });
    const html = await read(await get(`/organizations/${OTHER}`, { env }));
    expect(html).toContain("Sample Harbour Marine Ltd.");
    expect(html).not.toMatch(ASK);
    // The fixture as it is has an award notice and a history record, and asks.
    expect(await read(await get(`/organizations/${OTHER}`))).toMatch(ASK);
  });

  it("speaks French, and is not there while the switch is off", async () => {
    const fr = await read(await get(`/organizations/${ORG}?lang=fr`));
    expect(ASK.exec(fr)?.[1]).toBe(
      `Est-ce votre organisation? <a href="/account/sign-in?next=${encodeURIComponent(CLAIM)}">Indiquez-la dans un compte gratuit</a> ` +
      "et voyez les avis d'appel d'offres ouverts qui correspondent à ses dossiers.",
    );
    const off = await get(`/organizations/${ORG}`, { env: offEnv() });
    expect(off.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await off.text()).not.toContain("claim-ask");
  });
});

// -- E. the guides --------------------------------------------------------------------------------

const pathOf = (g: Guide) => `/guides/${g.slug}`;
const listOf = (html: string) => /<div class="interest-body" data-interest="">[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
const fieldOf = (form: string, name: string) => decode(new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"/>`).exec(form)?.[1] ?? "");
const ACAN_TYPE = "Advance Contract Award Notice";
const RFSO_TYPE = "Request for Standing Offer";

// The open notices' facets with an advance contract award notice and a request for standing offers among them.
function typedEnv(extra: Record<string, unknown> = {}) {
  const first = structuredClone(FILES["tenders/open-first.json"]) as Record<string, any>;
  first.facets.notice_type.push(
    { en: ACAN_TYPE, fr: "Préavis d'attribution du contrat", n: 1, value: ACAN_TYPE },
    { en: RFSO_TYPE, fr: "Demande d'offre à commandes", n: 1, value: RFSO_TYPE },
  );
  return onEnv({ ASSETS: makeFakeAssets({}, { "tenders/open-first.json": first }), ...extra });
}

describe("a guide's email list", () => {
  it("ends every guide on the list it declares, after its last section and before its sources, while the switch is on", async () => {
    const env = typedEnv();
    for (const g of GUIDES) {
      expect(g.action, g.slug).toBeDefined();
      for (const lang of ["en", "fr"] as Lang[]) {
        const res = await get(lang === "fr" ? `${pathOf(g)}?lang=fr` : pathOf(g), { env });
        expect(res.headers.get("cache-control"), g.slug).toBe("public, max-age=300");
        const html = await read(res);
        const form = listOf(html);
        expect(form, g.slug).not.toBe("");
        const want = (await interestFilter(env as never, lang, g.action!.list.kind, g.action!.list.path))!;
        expect(fieldOf(form, "kind"), g.slug).toBe(want.kind);
        expect(fieldOf(form, "params"), g.slug).toBe(want.params);
        expect(form, g.slug).toContain(`<p class="interest-label">${nbsp(want.label).replace(/’/g, "'")}</p>`);
        const at = html.indexOf('<div class="interest-body"');
        expect(at, g.slug).toBeGreaterThan(html.indexOf(`<h2 id="${g.sections.at(-1)!.id}">`));
        expect(at, g.slug).toBeLessThan(html.indexOf('<h2 id="sources">'));
        // The band, the guide's sentence and the lists' page, then the form; no Pro line and no account link.
        const band = lang === "fr" ? "<h2>Listes de diffusion</h2>" : "<h2>Email Lists</h2>";
        expect(html.lastIndexOf(band, at), g.slug).toBeGreaterThan(0);
        const sentence = nbsp(lang === "fr" ? g.action!.text.fr : g.action!.text.en);
        expect(html, g.slug).toContain(`<p>${sentence} <a href="/alerts">${lang === "fr" ? "Comment fonctionnent les listes" : "How email lists work"}</a></p>`);
        expect(main(html), g.slug).not.toContain("interest-pro");
        expect(main(html), g.slug).not.toContain("/account");
        expect(html, g.slug).toContain('<script src="/interest.js" defer=""></script>');
      }
    }
  });

  it("saves each guide's list: new tender notices, of one notice type where the open notices carry it, or the contracts within 3 months of their end", async () => {
    const env = typedEnv();
    const params = async (slug: string, e: object) => fieldOf(listOf(await read(await get(`/guides/${slug}`, { env: e }))), "params");
    expect(await params("reading-a-canadabuys-tender-notice", env)).toBe("/tenders");
    expect(await params("indigenous-business-set-asides-psib", env)).toBe("/tenders");
    expect(await params("advance-contract-award-notices-acan", env)).toBe(`/tenders?type=${encodeURIComponent(ACAN_TYPE).replace(/%20/g, "+")}`);
    expect(await params("standing-offers-and-supply-arrangements", env)).toBe(`/tenders?type=${encodeURIComponent(RFSO_TYPE).replace(/%20/g, "+")}`);
    const ending = (await interestFilter(env as never, "en", "expiring", "/expiring"))!.params;
    expect(await params("three-records-of-one-federal-contract", env)).toBe(ending);
    expect(await params("when-a-federal-contract-ends", env)).toBe(ending);
    const acan = await read(await get("/guides/advance-contract-award-notices-acan", { env }));
    expect(acan).toContain(`<p class="interest-label">New tender notices matching Notice type: ${ACAN_TYPE}</p>`);
    // While no open notice carries the type, the list is every new tender notice, as on the tender list itself.
    expect(await params("advance-contract-award-notices-acan", onEnv())).toBe("/tenders");
  });

  it("reads no file for a plain list, and the open notices' facets for a list of one type", async () => {
    // The files a guide's page asks for, with the switch on (the list drawn) and off (as before).
    const seen = async (slug: string, on: boolean) => {
      const inner = typedEnv().ASSETS as Fetcher;
      const paths: string[] = [];
      const assets = { fetch: (r: Request) => (paths.push(new URL(r.url).pathname), inner.fetch(r)) } as unknown as Fetcher;
      await (await get(`/guides/${slug}`, { env: on ? onEnv({ ASSETS: assets }) : testEnv(assets) })).text();
      return [...new Set(paths)].sort();
    };
    for (const slug of ["reading-a-canadabuys-tender-notice", "indigenous-business-set-asides-psib", "three-records-of-one-federal-contract",
      "when-a-federal-contract-ends"]) {
      expect(await seen(slug, true), slug).toEqual(await seen(slug, false));
    }
    for (const slug of ["advance-contract-award-notices-acan", "standing-offers-and-supply-arrangements"]) {
      expect(await seen(slug, true), slug).toEqual([...(await seen(slug, false)), "/data/tenders/open-first.json"].sort());
    }
  });

  it("posts where the lists' forms post, and saves the list it was served with", async () => {
    const form = listOf(await read(await get("/guides/when-a-federal-contract-ends")));
    const email = newEmail("funnel-guide");
    const res = await post("/interest", { kind: fieldOf(form, "kind"), params: fieldOf(form, "params"), lang: "en", email, website: "" },
      { headers: { "x-interest-fragment": "1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-interest-fragment")).toBe("1");
    expect(await res.text()).toContain('<p class="interest-done" role="status">Noted: ');
    const row = await DB.prepare("SELECT kind, params FROM interest WHERE email = ?").bind(email).first<{ kind: string; params: string }>();
    expect(row).toEqual({ kind: "expiring", params: fieldOf(form, "params") });
    // The lists' script follows the address only on the list's own page, so a guide's form keeps its list.
    expect(interestJs).toContain('if (params.value.split("?")[0] !== location.pathname) return;');
  });

  it("is not there while the switch is off, or for a signed-in reader: their guides are as they were", async () => {
    const cookie = await signIn(newEmail("funnel-guide-in"));
    for (const g of GUIDES) {
      const off = await (await get(pathOf(g), { env: testEnv() })).text();
      expect(off, g.slug).not.toContain('action="/interest"');
      expect(off, g.slug).not.toContain("interest.js");
      const signed = await get(pathOf(g), { cookie });
      expect(signed.headers.get("cache-control"), g.slug).toBe("private, no-store");
      const html = await signed.text();
      expect(html, g.slug).not.toContain('action="/interest"');
      expect(html, g.slug).not.toContain("interest.js");
      // The same document as the switch-off page, but for the shell that names the account.
      expect(main(html), g.slug).toBe(main(off));
    }
  });
});
