// The first steps on the account overview (src/account/pages.tsx StartPanel):
// over the overview's own panels while the account follows no page or keeps
// no saved search, each step not done yet with its one action and its line,
// gone once the account holds both. The Follow step's search is the top
// bar's GET to /search; the searches step leads to the tender notices and
// says to press Save this search there; the organization step
// rides along only while the panel shows. One filled button on the page, on
// the first step shown; no Pro chip in the panel; a Pro account's lines name
// its own plan only. Every expected line is written out here, never read
// back from the code under test.
import { describe, expect, it } from "vitest";
import { csrf, decode, get, grantPro, nbsp, newEmail, post, signIn, useAccountsDb } from "./accounts-helpers";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const ORG = "org-a000000001"; // the fixtures' profile

const text = (html: string) => nbsp(decode(html)).replace(/’/g, "'");
const overview = async (cookie: string, lang: "en" | "fr" = "en") =>
  (await get(lang === "fr" ? "/account?lang=fr" : "/account", { cookie })).text();

const PANEL_RE = /<section class="panel"><div class="panel-head"><h2>(?:Start Here|Pour commencer)<\/h2><\/div><ul class="start-steps">[\s\S]*?<\/ul><\/section>/;
const panelOf = (html: string) => PANEL_RE.exec(html)?.[0] ?? "";
const mainOf = (html: string) => /<main id="main">([\s\S]*)<\/main>/.exec(html)?.[1] ?? "";
const stepsOf = (panel: string) => [...panel.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => text(m[1]));
const primaries = (html: string) => html.match(/class="[^"]*\bbtn-primary\b[^"]*"/g) ?? [];
// The muted line under each step, as a reader sees it.
const linesOf = (panel: string) => [...panel.matchAll(/<p class="muted small">([\s\S]*?)<\/p>/g)].map((m) => text(m[1].replace(/<[^>]+>/g, "")));

async function addWatch(cookie: string): Promise<void> {
  const res = await post("/account/watches", { csrf: await csrf(cookie), kind: "organization", target: ORG }, { cookie });
  expect(res.status).toBe(303);
}

async function addSearch(cookie: string): Promise<void> {
  const res = await post("/account/searches", { csrf: await csrf(cookie), url: "/tenders?segment=82" }, { cookie });
  expect(res.headers.get("location")).toBe("/account/searches?m=added");
}

describe("the first steps on the account overview", () => {
  it("show a new Free account all three steps above the Account panel, the search going where the top bar's goes", async () => {
    const email = newEmail("start");
    const cookie = await signIn(email);
    const html = await overview(cookie);
    const panel = panelOf(html);
    expect(panel).not.toBe("");
    expect(stepsOf(panel)).toEqual(["Follow an organization or a buyer", "Save a search of tender notices", "Choose your organization"]);
    // Under the page head and its notice, above the Account panel.
    const main = mainOf(html);
    expect(main.indexOf(panel)).toBeGreaterThan(main.indexOf("</header>"));
    expect(main.indexOf(panel)).toBeLessThan(main.indexOf("<h2>Account</h2>"));

    // The Follow step's form is the top bar's: a GET to /search with the words in q.
    const top = /<form class="topbar-search" method="get" action="([^"]+)" role="search"><input type="search" name="([^"]+)"/.exec(html);
    const own = /<form method="get" action="([^"]+)" class="start-search" role="search"><input type="search" name="([^"]+)" maxlength="200"/.exec(panel);
    expect(top?.slice(1)).toEqual(["/search", "q"]);
    expect(own?.slice(1)).toEqual(top?.slice(1));
    expect(panel).toContain('placeholder="Organization or buyer" aria-label="Search organizations and buyers by name or business number"/>');
    expect(panel).toContain('<button type="submit" class="btn btn-primary">Search</button></form>');
    // A GET form carries nothing of the session.
    expect(/<form method="get" action="\/search"[\s\S]*?<\/form>/.exec(panel)?.[0]).not.toContain("csrf");

    expect(panel).toContain('<a href="/tenders" class="btn">Filter the tender notices</a>');
    // The list saves its own filters now: the line names the button, not the searches page.
    expect(panel).not.toContain('href="/account/searches"');
    expect(panel).toContain('<a href="/account/organization" class="btn">Find your organization</a>');
    expect(linesOf(panel)).toEqual([
      "On a result's profile, use the Follow button. Its events then show on your watches page: a new award, an amendment, an end date near, " +
        "a new or closed notice. This account follows 0 of 3 pages. Pro follows up to 25 and sends their events by email.",
      "Set the filters there, then press Save this search. " +
        "This account holds 0 of 3 saved searches. Pro holds up to 25 and sends them by email, daily or weekly.",
      "Tell the site which organization is yours to see its records by fiscal year on one page. The choice is private to your account.",
    ]);
    // The figures, not the chip: the panel holds no Pro mark and no link to the plans.
    expect(panel).not.toContain("pro-tag");
    expect(panel).not.toContain("/account/billing");
    expect(primaries(html)).toEqual(['class="btn btn-primary"']);
    expect(html).not.toContain(EM_DASH);
    expect(html).not.toContain(EN_DASH);
  });

  it("leave the overview's own panels as they were", async () => {
    const email = newEmail("start");
    const cookie = await signIn(email);
    const before = mainOf(await overview(cookie));
    const lists = text(before);
    expect(lists).toContain('<li><a href="/account/searches">Saved searches</a><span class="num">0 of 3</span></li>');
    expect(lists).toContain('<li><a href="/account/watches">Watches</a><span class="num">0 of 3</span></li>');
    expect(lists).toContain('<a href="/account/organization">Your organization</a><span class="kv-note">None chosen yet</span>');
    await addWatch(cookie);
    await addSearch(cookie);
    const after = mainOf(await overview(cookie));
    expect(panelOf(after)).toBe("");
    // The page without the panel, its two counts read back to none: the same bytes, row for row.
    const cut = before.replace(panelOf(before), "");
    expect(after.replace(/<span class="num">1 of 3<\/span>/g, '<span class="num">0 of 3</span>')).toBe(cut);
  });

  it("offer an account with a watch and no saved search the searches step, with the filled button, and the organization", async () => {
    const email = newEmail("start");
    const cookie = await signIn(email);
    await addWatch(cookie);
    const html = await overview(cookie);
    const panel = panelOf(html);
    expect(stepsOf(panel)).toEqual(["Save a search of tender notices", "Choose your organization"]);
    expect(panel).not.toContain('action="/search"');
    expect(panel).toContain('<a href="/tenders" class="btn btn-primary">Filter the tender notices</a>');
    expect(panel).toContain('<a href="/account/organization" class="btn">Find your organization</a>');
    expect(primaries(html)).toEqual(['class="btn btn-primary"']);
    expect(html).not.toContain(EM_DASH);
    expect(html).not.toContain(EN_DASH);
  });

  it("offer an account with a saved search and no watch the Follow step, with the filled button", async () => {
    const email = newEmail("start");
    const cookie = await signIn(email);
    await addSearch(cookie);
    const html = await overview(cookie);
    const panel = panelOf(html);
    expect(stepsOf(panel)).toEqual(["Follow an organization or a buyer", "Choose your organization"]);
    expect(panel).not.toContain('href="/tenders"');
    expect(panel).toContain('<button type="submit" class="btn btn-primary">Search</button>');
    expect(primaries(html)).toEqual(['class="btn btn-primary"']);
  });

  it("are gone for an account with a watch and a saved search, leaving the page no filled button", async () => {
    const email = newEmail("start");
    const cookie = await signIn(email);
    await addWatch(cookie);
    await addSearch(cookie);
    for (const lang of ["en", "fr"] as const) {
      const html = await overview(cookie, lang);
      expect(panelOf(html), lang).toBe("");
      expect(html, lang).not.toContain("start-steps");
      expect(html, lang).not.toMatch(/<h2>(?:Start Here|Pour commencer)<\/h2>/);
      expect(primaries(html), lang).toEqual([]);
    }
  });

  it("count the chosen organization's watch as a watch, and drop the organization step once one is chosen", async () => {
    const email = newEmail("start");
    const cookie = await signIn(email);
    const res = await post("/account/organization", { csrf: await csrf(cookie), org: ORG }, { cookie });
    expect(res.status).toBe(303);
    const html = await overview(cookie);
    expect(text(html)).toContain('<span class="num">0 of 3, plus your organization</span>');
    const panel = panelOf(html);
    expect(stepsOf(panel)).toEqual(["Save a search of tender notices"]);
    expect(panel).toContain('<a href="/tenders" class="btn btn-primary">Filter the tender notices</a>');
    expect(primaries(html)).toEqual(['class="btn btn-primary"']);
  });

  it("tell a Pro account with nothing set up its own plan's figures and never point it at Pro", async () => {
    const email = newEmail("start");
    const cookie = await signIn(email);
    await grantPro(email);
    const html = await overview(cookie);
    const panel = panelOf(html);
    expect(stepsOf(panel)).toEqual(["Follow an organization or a buyer", "Save a search of tender notices", "Choose your organization"]);
    expect(linesOf(panel)).toEqual([
      "On a result's profile, use the Follow button. Its events then show on your watches page and come by email: a new award, an amendment, " +
        "an end date near, a new or closed notice. This account follows 0 of 25 pages.",
      "Set the filters there, then press Save this search. " +
        "This account holds 0 of 25 saved searches. Each can be sent by email, daily or weekly.",
      "Tell the site which organization is yours to see, on one page, its records by fiscal year and segment, its contracts ending within " +
        "12 months and the buyers it has won from. The choice is private to your account.",
    ]);
    expect(text(panel)).not.toMatch(/\bPro\b/);
    expect(panel).not.toContain("pro-tag");
    expect(panel).not.toContain("/account/billing");
    expect(panel).not.toContain("/pro");
    expect(primaries(html)).toEqual(['class="btn btn-primary"']);
    expect(html).not.toContain(EM_DASH);
    expect(html).not.toContain(EN_DASH);
  });

  it("read in French", async () => {
    const email = newEmail("start");
    const cookie = await signIn(email);
    const html = await overview(cookie, "fr");
    const panel = panelOf(html);
    expect(panel).toContain("<h2>Pour commencer</h2>");
    expect(stepsOf(panel)).toEqual(["Suivre une organisation ou un acheteur", "Enregistrer une recherche d'avis d'appel d'offres", "Choisir votre organisation"]);
    expect(text(panel)).toContain('placeholder="Organisation ou acheteur"');
    expect(panel).toContain('<button type="submit" class="btn btn-primary">Rechercher</button></form>');
    expect(text(panel)).toContain('<a href="/tenders" class="btn">Filtrer les avis d\'appel d\'offres</a>');
    expect(text(panel)).toContain('<a href="/account/organization" class="btn">Trouver votre organisation</a>');
    expect(linesOf(panel)).toEqual([
      "Sur le profil d'un résultat, utilisez le bouton Suivre. Ses événements s'affichent ensuite sur votre page des suivis : une nouvelle " +
        "attribution, une modification, une fin proche, un avis nouveau ou fermé. Pages suivies par ce compte : 0 sur 3. Pro en suit " +
        "jusqu'à 25 et envoie leurs événements par courriel.",
      "Choisissez-y les filtres, puis appuyez sur Enregistrer cette recherche. " +
        "Recherches enregistrées de ce compte : 0 sur 3. Pro en conserve jusqu'à 25 et les envoie par courriel, chaque jour ou chaque semaine.",
      "Indiquez au site quelle organisation est la vôtre pour voir ses dossiers par exercice sur une même page. Ce choix reste privé à votre compte.",
    ]);
    expect(text(html)).not.toMatch(/Start Here|Follow an organization|Save a search|Choose your organization/);
    expect(primaries(html)).toEqual(['class="btn btn-primary"']);
    expect(html).not.toContain(EM_DASH);
    expect(html).not.toContain(EN_DASH);
  });

  it("read in French for Pro, with no line pointing at Pro", async () => {
    const email = newEmail("start");
    const cookie = await signIn(email);
    await grantPro(email);
    const panel = panelOf(await overview(cookie, "fr"));
    expect(linesOf(panel)).toEqual([
      "Sur le profil d'un résultat, utilisez le bouton Suivre. Ses événements s'affichent ensuite sur votre page des suivis et arrivent par " +
        "courriel : une nouvelle attribution, une modification, une fin proche, un avis nouveau ou fermé. Pages suivies par ce compte : 0 sur 25.",
      "Choisissez-y les filtres, puis appuyez sur Enregistrer cette recherche. " +
        "Recherches enregistrées de ce compte : 0 sur 25. Chacune peut être envoyée par courriel, chaque jour ou chaque semaine.",
      "Indiquez au site quelle organisation est la vôtre pour voir au même endroit ses dossiers par exercice et par segment, ses contrats " +
        "prenant fin d'ici 12 mois et les acheteurs auprès desquels elle a obtenu des contrats. Ce choix reste privé à votre compte.",
    ]);
    expect(text(panel)).not.toMatch(/\bPro\b/);
  });
});
