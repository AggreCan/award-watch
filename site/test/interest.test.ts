import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import nightly from "../../.github/workflows/nightly.yml?raw";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { allKeys, rawEntry } from "../src/i18n";
import { normalizeEmail } from "../src/pages/interest";
import { DESCRIPTION_MAX } from "../src/seo";
import { routeTemplate } from "../src/views";
import { testEnv } from "./assets";

// Each post comes from its own address, so the per-address form cap (5 a minute) never trips here.
let nextAddress = 1;
const post = (fields: Record<string, string>, headers: Record<string, string> = {}, e: object = testEnv()) =>
  app.request(
    "/interest",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": `203.0.113.${nextAddress++}`, ...headers },
      body: new URLSearchParams(fields).toString(),
    },
    e,
  );
const get = (path: string) => app.request(path, {}, testEnv());
// A post of the Email lists page's chooser: its fields as the form sends them,
// a field repeated for each box ticked and each option chosen. The
// Canada-wide box sends national=0 from a hidden field and national=1 when ticked.
const choose = (fields: [string, string][], headers: Record<string, string> = {}, e: object = testEnv()) =>
  app.request(
    "/interest",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": `203.0.113.${nextAddress++}`, ...headers },
      body: new URLSearchParams([
        ["place", "lists"], ["national", "0"], ...fields, ...(fields.some(([k]) => k === "website") ? [] : [["website", ""]]),
      ]).toString(),
    },
    e,
  );
const text = async (path: string) => (await get(path)).text();

const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const hidden = (html: string, name: string) =>
  decode(html.match(new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"`))?.[1] ?? "(none)");
const label = (html: string) => nbsp(decode(html.match(/<p class="interest-label">([^<]*)<\/p>/)?.[1] ?? "(none)"));

async function rows(email: string): Promise<Record<string, unknown>[]> {
  const res = await env.DB.prepare("SELECT * FROM interest WHERE email = ? ORDER BY id").bind(email).all();
  return (res.results ?? []) as Record<string, unknown>[];
}

describe("the alerts block on each page", () => {
  // [path, kind, params, English label, French label]
  const CASES: [string, string, string, string, string][] = [
    ["/expiring", "expiring", "/expiring/3m",
      "Contracts entering the 3-month window for every buyer and segment",
      "Contrats qui entrent dans la période de 3 mois pour tous les acheteurs et segments"],
    ["/expiring/3m?value=1m-10m&buyer=dnd-mdn&color=red", "expiring", "/expiring/3m?buyer=dnd-mdn&value=1m-10m",
      "Contracts entering the 3-month window for National Defence (Value: $1 million to under $10 million)",
      "Contrats qui entrent dans la période de 3 mois pour Défense nationale (Valeur : De 1 à moins de 10 millions de dollars)"],
    ["/expiring/3m?segment=43&competitive=no", "expiring", "/expiring/3m?competitive=no&segment=43",
      "Contracts entering the 3-month window in segment 43 Information Technology Broadcasting and Telecommunications (Competition: Non-competitive)",
      "Contrats qui entrent dans la période de 3 mois dans le segment 43 Technologies de l’information, radiodiffusion et télécommunications (Mise en concurrence : Non concurrentiel)"],
    ["/tenders", "tenders", "/tenders", "Every new tender notice", "Chaque nouvel avis d’appel d’offres"],
    ["/tenders?sort=published&segment=82&closing=7&page=3", "tenders", "/tenders?segment=82",
      "New tender notices matching UNSPSC segment: 82 Editorial and Design and Graphic and Fine Art Services",
      "Nouveaux avis d’appel d’offres correspondant à Segment UNSPSC : 82 Services de rédaction, de design, de graphisme et de beaux-arts"],
    ["/tenders?q=translation&buyer=pwgsc-tpsgc&province=QC", "tenders", "/tenders?buyer=pwgsc-tpsgc&province=QC&q=translation",
      "New tender notices with the searched words in the title, matching Province of delivery: Quebec; Buyer: Public Services and Procurement Canada",
      "Nouveaux avis d’appel d’offres dont le titre contient les mots recherchés, correspondant à Province de livraison : Québec; Acheteur : Services publics et Approvisionnement Canada"],
    ["/organizations/org-a000000001", "organization", "/organizations/org-a000000001",
      "When Exemplar Translation Services Inc. is named on a new award, contract or grant",
      "Quand Exemplar Translation Services Inc. figure dans une nouvelle attribution, un nouveau contrat ou une nouvelle subvention"],
    ["/buyers/pwgsc-tpsgc", "buyer", "/buyers/pwgsc-tpsgc",
      "New award notices and contracts from Public Services and Procurement Canada",
      "Nouveaux avis d’attribution et contrats de Services publics et Approvisionnement Canada"],
    ["/segments/82", "segment", "/segments/82",
      "New tender notices and award notices in segment 82 Editorial and Design and Graphic and Fine Art Services",
      "Nouveaux avis d’appel d’offres et d’attribution dans le segment 82 Services de rédaction, de design, de graphisme et de beaux-arts"],
  ];

  it("saves the page's filter, canonical, with the label in the page's language", async () => {
    for (const [path, kind, params, en, fr] of CASES) {
      const english = await text(path);
      expect(english, path).toContain('<h2>Email Lists</h2>');
      expect(hidden(english, "kind"), path).toBe(kind);
      expect(hidden(english, "params"), path).toBe(params);
      expect(hidden(english, "lang"), path).toBe("en");
      expect(label(english), path).toBe(en);
      const french = await text(`${path}${path.includes("?") ? "&" : "?"}lang=fr`);
      expect(french, path).toContain("<h2>Listes de diffusion</h2>");
      expect(french, path).toContain('<a href="/alerts">Comment fonctionnent les listes</a>');
      expect(hidden(french, "params"), path).toBe(params);
      expect(hidden(french, "lang"), path).toBe("fr");
      expect(label(french), path).toBe(fr);
    }
  });

  it("never puts the words of a title search in the label", async () => {
    const html = await text("/tenders?q=buy%20cheap%20pills");
    expect(hidden(html, "params")).toBe("/tenders?q=buy+cheap+pills");
    expect(label(html)).toBe("New tender notices with the searched words in the title");
    expect(html.match(/<p class="interest-label">[^<]*<\/p>/)?.[0]).not.toContain("pills");
  });

  it("says what the address is for, with one field and one button, a honeypot and no script required", async () => {
    const html = await text("/expiring");
    const block = html.match(/<section class="panel interest">[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(block).toContain('<form method="post" action="/interest" class="interest-form" data-interest-form="">');
    expect(block).toContain('<input name="email" type="email" required="" maxlength="254" autocomplete="email"');
    expect(block).toContain('<input name="website" type="text" tabindex="-1" autocomplete="off"/>');
    expect(block.match(/<button/g)).toHaveLength(1);
    expect(block.match(/<input name="email"/g)).toHaveLength(1);
    expect(block).toContain(
      'Email lists are part of Pro once accounts open, and your list will be waiting in your account; the <a href="/privacy#interest">Privacy</a> page says what the form keeps.',
    );
    expect(block).toContain('<a href="/alerts">How email lists work</a>');
    // The script only keeps the reader on the page; the form posts without it.
    expect(html).toContain('<script src="/interest.js" defer=""></script>');
    // Only the tender list follows the address the browser shows.
    expect(block).not.toContain("data-follow");
    const tenders = await text("/tenders");
    expect(tenders).toContain('data-follow="" data-keys="buyer category method province q segment type"');
    expect(tenders).toContain('data-label-all="Every new tender notice" data-label-some="New tender notices matching the filters above"');
  });
});

describe("POST /interest", () => {
  it("stores a row with the address normalized, the rebuilt filter, its label and a random token", async () => {
    const res = await post({
      email: "  Reader.One@Example.CA ", kind: "expiring", params: "/expiring/3m?buyer=dnd-mdn&lang=fr", lang: "en", website: "",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    // The line repeats the address as stored and the filter, so a mistyped address shows.
    expect(html).toContain('<p class="interest-done" role="status">Noted: reader.one@example.ca, for contracts entering the 3-month window for National Defence.</p>');
    expect(html).toContain('<a href="/expiring/3m?buyer=dnd-mdn" class="btn">Back to the page</a>');
    expect(html).not.toContain('name="email"');
    const [row] = await rows("reader.one@example.ca");
    expect(Object.keys(row).sort()).toEqual(
      ["confirmed_at", "created_at", "email", "id", "kind", "label", "lang", "params", "token", "unsubscribed_at"],
    );
    expect(row.kind).toBe("expiring");
    expect(row.params).toBe("/expiring/3m?buyer=dnd-mdn");
    expect(row.label).toBe("Contracts entering the 3-month window for National Defence");
    expect(row.lang).toBe("en");
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(row.token).toMatch(/^[0-9a-f]{32}$/);
    expect(row.confirmed_at).toBeNull();
    expect(row.unsubscribed_at).toBeNull();
  });

  it("writes the label in the form's language", async () => {
    const res = await post({ email: "lectrice@example.ca", kind: "buyer", params: "/buyers/pwgsc-tpsgc", lang: "fr" });
    expect(res.status).toBe(200);
    expect(nbsp(await res.text())).toContain("C’est noté : lectrice@example.ca, pour nouveaux avis d’attribution et contrats de Services publics et Approvisionnement Canada.</p>");
    const [row] = await rows("lectrice@example.ca");
    expect(row.lang).toBe("fr");
    expect(row.label).toBe("Nouveaux avis d’attribution et contrats de Services publics et Approvisionnement Canada");
  });

  it("answers a second post of the same address and filter the same, and stores nothing new", async () => {
    const fields = { kind: "tenders", params: "/tenders?segment=82", lang: "en" };
    const first = await post({ ...fields, email: "twice@example.ca" });
    const again = await post({ ...fields, email: " TWICE@example.ca", params: "/tenders?sort=published&segment=82" });
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(await again.text()).toContain("Noted: twice@example.ca, for new tender notices matching UNSPSC segment: 82 ");
    const stored = await rows("twice@example.ca");
    expect(stored).toHaveLength(1);
    // Another filter for the same address is a row of its own, with its own token.
    expect((await post({ ...fields, email: "twice@example.ca", params: "/tenders" })).status).toBe(200);
    const both = await rows("twice@example.ca");
    expect(both.map((r) => r.params)).toEqual(["/tenders?segment=82", "/tenders"]);
    expect(both[0].token).not.toBe(both[1].token);
  });

  it("refuses the honeypot and a bad address with a quiet line, and stores nothing", async () => {
    const bot = await post({ email: "bot@example.ca", kind: "tenders", params: "/tenders", lang: "en", website: "http://spam.example" });
    expect(bot.status).toBe(400);
    expect(await bot.text()).toContain('<p class="interest-error" role="alert">The form could not be sent. Try again.</p>');
    expect(await rows("bot@example.ca")).toHaveLength(0);
    for (const email of ["not-an-email", "a@b", "two@@example.ca", "dots..here@example.ca", `${"x".repeat(250)}@example.ca`, ""]) {
      const bad = await post({ email, kind: "tenders", params: "/tenders", lang: "en" });
      expect(bad.status, email).toBe(400);
      const html = await bad.text();
      expect(html, email).toContain('<p class="interest-error" role="alert">Enter a complete email address.</p>');
      // The form comes back with the address as typed, so it can be fixed.
      expect(html, email).toContain('name="email"');
    }
    for (const email of ["not-an-email", "two@@example.ca", "dots..here@example.ca"]) expect(await rows(email), email).toHaveLength(0);
  });

  it("drops filter keys outside the kind's list and values the page would not use", async () => {
    const res = await post({
      email: "allowlist@example.ca", kind: "tenders", lang: "en",
      params: "/tenders?segment=82&evil=%3Cscript%3E&sort=published&page=3&lang=fr&closing=7&type=Made%20up&province=ZZ",
    });
    expect(res.status).toBe(200);
    const [row] = await rows("allowlist@example.ca");
    expect(row.params).toBe("/tenders?segment=82");
    expect(row.label).toBe("New tender notices matching UNSPSC segment: 82 Editorial and Design and Graphic and Fine Art Services");
    const window = await post({ email: "allowlist@example.ca", kind: "expiring", lang: "en", params: "/expiring?buyer=nobody-here&kind=award&x=1" });
    expect(window.status).toBe(200);
    const year = await post({ email: "allowlist@example.ca", kind: "expiring", lang: "en", params: "/expiring/12m?page=4&segment=82&buyer=dnd-mdn" });
    expect(year.status).toBe(200);
    const stored = await rows("allowlist@example.ca");
    expect(stored[1].params).toBe("/expiring/3m?kind=award");
    expect(stored[1].label).toBe("Contracts entering the 3-month window for every buyer and segment (Source: Award notices)");
    expect(stored[2].params).toBe("/expiring/12m?buyer=dnd-mdn&segment=82");
    expect(stored[2].label).toBe(
      "Contracts entering the 12-month window for National Defence in segment 82 Editorial and Design and Graphic and Fine Art Services",
    );
  });

  it("refuses a filter that does not rebuild, a kind that does not match its page, and another host", async () => {
    for (const [kind, params] of [
      ["buyer", "/tenders"], ["tenders", "/tenders/new"], ["tenders", "//evil.example/tenders"], ["tenders", "https://evil.example/tenders"],
      ["organization", "/organizations/org-ffffffffff"], ["segment", "/segments/99"], ["buyer", "/buyers/no-such-buyer"],
      ["expiring", "/expiring/1m"], ["account", "/tenders"], ["tenders", "/\\evil.example/tenders"],
    ]) {
      const res = await post({ email: "refused@example.ca", kind, params, lang: "en" });
      expect(res.status, `${kind} ${params}`).toBe(400);
      expect(await res.text()).toBe("The form could not be read.");
    }
    expect(await rows("refused@example.ca")).toHaveLength(0);
  });

  it("refuses a body that is not a form, and a post from another site's page", async () => {
    const json = await app.request("/interest", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.250" },
      body: JSON.stringify({ email: "json@example.ca", kind: "tenders", params: "/tenders" }),
    }, testEnv());
    expect(json.status).toBe(400);
    expect(await rows("json@example.ca")).toHaveLength(0);
    for (const origin of ["https://evil.example", "null"]) {
      const cross = await post({ email: "cross@example.ca", kind: "tenders", params: "/tenders", lang: "en" }, { origin });
      expect(cross.status, origin).toBe(403);
    }
    expect(await rows("cross@example.ca")).toHaveLength(0);
    const own = await post({ email: "own@example.ca", kind: "tenders", params: "/tenders", lang: "en" }, { origin: "https://awardwatch.ca" });
    expect(own.status).toBe(200);
    expect(await rows("own@example.ca")).toHaveLength(1);
  });

  it("answers the script with the block alone, which carries the form again on an error", async () => {
    const ok = await post({ email: "fragment@example.ca", kind: "segment", params: "/segments/82", lang: "en" }, { "x-interest-fragment": "1" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-interest-fragment")).toBe("1");
    const html = await ok.text();
    expect(html.startsWith('<div class="interest-body" data-interest="">')).toBe(true);
    expect(html).not.toContain("<html");
    expect(html).toContain(
      '<p class="interest-done" role="status">Noted: fragment@example.ca, for new tender notices and award notices in segment 82 Editorial and Design and Graphic and Fine Art Services.</p>',
    );
    expect(html).toContain("Email lists are part of Pro once accounts open, and your list will be waiting in your account;");
    const bad = await post({ email: "nope", kind: "segment", params: "/segments/82", lang: "en" }, { "x-interest-fragment": "1" });
    expect(bad.status).toBe(400);
    const again = await bad.text();
    expect(again).toContain("Enter a complete email address.");
    expect(again).toContain('value="nope"');
  });

  it("keeps what was typed and asks to try again when the database cannot take the row", async () => {
    const broken = { ...testEnv(), DB: { prepare: () => { throw new Error("D1 is down"); } } };
    const res = await post({ email: "later@example.ca", kind: "tenders", params: "/tenders", lang: "en" }, {}, broken);
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(html).toContain("The message could not be saved just now. Try again in a moment.");
    expect(html).toContain('value="later@example.ca"');
  });

  it("falls under the form cap, counts as a form post, and sends a typed address to the alerts page", async () => {
    expect(bucketFor("POST", "/interest")).toBe("form");
    expect(bucketFor("GET", "/alerts")).toBe("page");
    expect(routeTemplate("POST", "/interest")).toEqual({ route: "/interest", kind: "form" });
    expect(routeTemplate("GET", "/alerts")).toEqual({ route: "/alerts", kind: "page" });
    const res = await get("/interest");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/alerts");
  });

  it("normalizes an address and caps its length", () => {
    expect(normalizeEmail("  A.B+tag@Sub.Example.CA ")).toBe("a.b+tag@sub.example.ca");
    expect(normalizeEmail("x@xn--p1ai.xn--p1ai")).toBe("x@xn--p1ai.xn--p1ai");
    for (const bad of ["", "a@b", "a b@example.ca", ".a@example.ca", "a.@example.ca", "a@-example.ca", "a@example.c", "<a>@example.ca", `${"a".repeat(65)}@example.ca`]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });
});

describe("the alerts page and the privacy page", () => {
  it("explain alerts in both languages, around the chooser", async () => {
    const res = await get("/alerts");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Email Lists</h1>");
    expect(html).toContain("<title>Email Lists | Award Watch</title>");
    expect(decode(html)).toContain(
      "Email lists are part of Pro, the site's paid plan, once accounts open. Sign up now and your lists will be waiting in your account. " +
      "Nothing is sent before then except one message saying accounts are open.",
    );
    // A few short sections: no contents box. The chooser comes first, the page's own action.
    expect(html).toContain('<div class="doc-layout doc-alone"><div class="doc"><h2 id="register">Choose Your Lists</h2>');
    expect(html).toContain('<h2 id="cover">What Pro Delivers</h2>');
    expect(html).toContain("On the Pro plan, each list is a saved search on your account, sent by email each day or each week with what is new in it.");
    expect(html).toContain("Contracts entering the 3-, 6- or 12-month window of contracts ending soon, for one buyer, one segment or every contract.");
    expect(html).toContain("New records naming an organization you watch: an award notice, a contract or a grant.");
    expect(html).toContain("The form keeps the address and each list chosen. When accounts open, one message will say so, with a link to unsubscribe. " +
      "Create an account with the same address and the lists will be there, ready to add to its saved searches. The address is never shown or shared.");
    // The chooser's note names the lists, several of them.
    expect(html).toContain(
      'Email lists are part of Pro once accounts open, and your lists will be waiting in your account; the <a href="/privacy#interest">Privacy</a> page says what the form keeps.',
    );
    for (const href of ["/tenders", "/expiring", "/organizations", "/buyers", "/segments", "/privacy#interest"]) {
      expect(html, href).toContain(`<a href="${href}">`);
    }
    // The Browse entry is named for the page and marks it; the Pro item under Your lists stays a plain link.
    expect(html).toContain('<a class="rail-item" href="/alerts" aria-current="page"><span class="rail-label">Email lists</span></a>');
    expect(html).toContain('<a class="rail-item rail-later" href="/alerts"><span class="rail-label">Email lists: Pro</span></a>');
    const footer = html.slice(html.indexOf('<footer class="site-footer">'));
    // The footer names the page as the rail does.
    expect(footer).toContain('<a href="/feeds">Feeds</a><a href="/alerts">Email lists</a>');
    const fr = await get("/alerts?lang=fr");
    expect(fr.status).toBe(200);
    const french = nbsp(await fr.text());
    expect(french).toContain("<h1>Listes de diffusion</h1>");
    expect(french).toContain("<title>Listes de diffusion | Award Watch</title>");
    expect(french).toContain("Les listes de diffusion font partie de Pro, le forfait payant du site, dès l’ouverture des comptes.");
    expect(french).toContain("D’ici là, rien n’est envoyé, sauf un message annonçant l’ouverture des comptes.");
    expect(french).toContain('<h2 id="cover">Ce que Pro envoie</h2>');
    expect(french).toContain('<h2 id="register">Choisissez vos listes</h2>');
    expect(french).toContain("Rien n’est encore envoyé.");
    expect(french).toContain('<a class="rail-item" href="/alerts" aria-current="page"><span class="rail-label">Listes de diffusion</span></a>');
    expect(french).toContain('<a class="rail-item rail-later" href="/alerts"><span class="rail-label">Listes de diffusion : Pro</span></a>');
    expect(french.slice(french.indexOf('<footer class="site-footer">'))).toContain('<a href="/alerts">Listes de diffusion</a>');
    // The description fits a result list in both languages.
    for (const page of [html, french]) {
      const description = decode(page.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "");
      expect(description.length).toBeGreaterThan(50);
      expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it("say what the interest table keeps, what it is for and how it is removed, in both languages", async () => {
    const html = await text("/privacy");
    expect(html).toContain('<h2 id="interest">Alert Interest</h2>');
    expect(html).toContain("The alerts form stores the email address, the saved filter and the site&#39;s wording of it, the language of the page, the time it was received and a random token for the links in later messages.");
    expect(html).toContain("It stores no IP address, browser identification or visitor code.");
    expect(html).toContain("The address is used for one message saying accounts are open, with a link to unsubscribe, and nothing else is sent to it.");
    expect(html).toContain("If an account is later made with the same address, the lists are offered to it as saved searches.");
    expect(html).toContain("The address is never shown or shared.");
    expect(html).toContain('To have it removed, use the unsubscribe link in that message or write to <a href="mailto:contact@awardwatch.ca">contact@awardwatch.ca</a>. Removal is free of charge.');
    // The sections already there stay.
    for (const id of ["accounts", "browser", "counting", "feeds", "forms", "third", "removal"]) expect(html, id).toContain(`<h2 id="${id}">`);
    const french = nbsp(await text("/privacy?lang=fr"));
    expect(french).toContain('<h2 id="interest">Intérêt pour les alertes</h2>');
    expect(french).toContain("L’adresse sert à un seul message annonçant l’ouverture des comptes, avec un lien de désabonnement, et rien d’autre n’y est envoyé.");
    expect(french).toContain("L’adresse n’est jamais affichée ni communiquée.");
    expect(french).toContain("Le retrait est gratuit.");
  });
});

describe("the email lists as part of Pro", () => {
  // The wording from before the lists became part of Pro (operator, 2026-11-03): alerts as a
  // feature being built, announced to every address. Compared without case, apostrophes
  // straightened and no-break spaces as spaces, as a reader would search for it.
  const OLD = [
    "Alerts are being built", "are being built", "One message will announce them", "One message will announce the alerts", "Alerts: soon",
    "Les alertes sont en préparation", "Un seul message les annoncera", "Un seul message annoncera les alertes", "Alertes : bientôt",
  ].map((s) => s.toLowerCase());
  const plain = (s: string) => nbsp(decode(s)).replace(/’/g, "'").toLowerCase();
  const BLOCK_PAGES = ["/tenders", "/expiring", "/expiring/3m", "/organizations/org-a000000001", "/buyers/pwgsc-tpsgc", "/segments/82"];
  const fr = (path: string) => `${path}${path.includes("?") ? "&" : "?"}lang=fr`;
  const block = (html: string) => html.match(/<section class="panel interest">[\s\S]*?<\/section>/)?.[0] ?? "(no block)";

  it("leaves the old wording on no page, in no answer and in no string, in either language", async () => {
    for (const path of ["/", ...BLOCK_PAGES, "/alerts", "/privacy", "/watchlist"]) {
      for (const p of [path, fr(path)]) {
        const html = plain(await text(p));
        for (const old of OLD) expect(html, `${p}: ${old}`).not.toContain(old);
      }
    }
    // The answers to both forms, in both languages.
    for (const lang of ["en", "fr"]) {
      const one = plain(await (await post({ email: `old.words.${lang}@example.ca`, kind: "tenders", params: "/tenders", lang })).text());
      const several = plain(await (await choose([["lang", lang], ["list", "tenders"], ["list", "expiring"], ["email", `old.lists.${lang}@example.ca`]])).text());
      for (const old of OLD) {
        expect(one, `${lang}: ${old}`).not.toContain(old);
        expect(several, `${lang}: ${old}`).not.toContain(old);
      }
    }
    for (const key of allKeys()) {
      const { en, fr: french } = rawEntry(key);
      for (const old of OLD) {
        expect(en.toLowerCase(), key).not.toContain(old);
        expect(french.toLowerCase(), key).not.toContain(old);
      }
    }
  });

  it("says Pro on the Email lists page, in the rail and under every page's form, in both languages, with no price", async () => {
    const en = decode(await text("/alerts"));
    expect(en).toContain("<p class=\"lead\">Email lists are part of Pro, the site's paid plan, once accounts open.");
    expect(en).toContain('<a class="rail-item rail-later" href="/alerts"><span class="rail-label">Email lists: Pro</span></a>');
    const french = nbsp(decode(await text("/alerts?lang=fr")));
    expect(french).toContain("<p class=\"lead\">Les listes de diffusion font partie de Pro, le forfait payant du site, dès l’ouverture des comptes.");
    expect(french).toContain('<a class="rail-item rail-later" href="/alerts"><span class="rail-label">Listes de diffusion : Pro</span></a>');
    // The page names no price and promises no delivery without the plan.
    for (const page of [en, french]) {
      const main = page.match(/<main id="main">[\s\S]*?<\/main>/)?.[0] ?? "(no main)";
      expect(main).not.toMatch(/\$\s?\d|\d\s?\$|CA\$|\bfree\b|gratuit/i);
    }
    // Every page's block says it in one sentence, the same in each place.
    for (const path of BLOCK_PAGES) {
      expect(block(await text(path)), path).toContain(
        'Email lists are part of Pro once accounts open, and your list will be waiting in your account; the <a href="/privacy#interest">Privacy</a> page says what the form keeps.',
      );
      expect(nbsp(block(await text(fr(path)))), path).toContain(
        "Les listes de diffusion font partie de Pro dès l’ouverture des comptes, et votre liste vous attendra dans votre compte; " +
        'la page <a href="/privacy#interest">Confidentialité</a> indique ce que conserve le formulaire.',
      );
    }
  });
});

describe("the Email lists page's chooser", () => {
  // The boxes and options as rendered: [name, value, ticked or chosen].
  const boxes = (html: string) =>
    [...html.matchAll(/<input type="checkbox" name="(list|category|national)" value="([^"]+)"( checked="")?/g)].map((m) => `${m[1]}=${m[2]}${m[3] ? " ticked" : ""}`);
  const options = (html: string, name: string) =>
    [...(html.match(new RegExp(`<select name="${name}" multiple="" size="\\d+">([\\s\\S]*?)</select>`))?.[1] ?? "").matchAll(/<option value="([^"]+)"( selected="")?>([^<]*)<\/option>/g)]
      .map((m) => `${m[1]}${m[2] ? " chosen" : ""}: ${nbsp(decode(m[3]))}`);

  it("offers three lists, none ticked, with the tender filters under the second, in both languages", async () => {
    const html = await text("/alerts");
    const form = html.match(/<form method="post" action="\/interest" class="lists-form" data-interest-form="" data-lists="">[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(form).toContain('<input type="hidden" name="place" value="lists"/><input type="hidden" name="lang" value="en"/>');
    expect(boxes(form)).toEqual([
      "list=tenders", "list=matching", "category=GD", "category=SRV", "category=CNST", "national=1 ticked", "list=expiring",
    ]);
    // Each list is named as its row will be; no list for every new award notice, which no kind covers.
    expect(form).toContain('value="tenders"/><span>Every new tender notice</span>');
    expect(form).toContain('value="matching"/><span>New tender notices matching filters</span>');
    expect(form).toContain('value="expiring"/><span>Contracts entering the 3-month window for every buyer and segment</span>');
    expect(form).not.toMatch(/value="awards?"/);
    expect(form).toContain("<span>Goods</span>");
    expect(form).toContain("<span>Include Canada-wide or not stated</span>");
    // The segments and provinces the tenders page offers, with its counts, several at once.
    expect(options(form, "segment")).toEqual([
      "43: 43 Information Technology Broadcasting and Telecommunications (1)", "72: 72 Building and Facility Construction and Maintenance Services (1)",
      "78: 78 Transportation and Storage and Mail Services (1)", "82: 82 Editorial and Design and Graphic and Fine Art Services (1)",
    ]);
    expect(options(form, "province")).toEqual(["BC: British Columbia (1)", "ON: Ontario (1)", "QC: Quebec (1)"]);
    expect(form).toContain("With no filter chosen, this list is every new tender notice.");
    // One address, the honeypot and one button, on the alerts form's line.
    expect(form.match(/<input name="email"/g)).toHaveLength(1);
    expect(form).toContain('<div class="hp"><label>Leave this field empty<input name="website" type="text" tabindex="-1" autocomplete="off"/></label></div>');
    expect(form).toContain('<div class="interest-form"><label class="field interest-field"><span class="field-label">Email address</span><input name="email" type="email" required="" maxlength="254" autocomplete="email"');
    expect(form.match(/<button/g)).toHaveLength(1);
    expect(form).toContain('<button type="submit" class="btn btn-primary">Sign me up</button>');
    expect(html).toContain('<script src="/interest.js" defer=""></script>');

    const french = nbsp(await text("/alerts?lang=fr"));
    const formFr = french.match(/<form method="post" action="\/interest" class="lists-form"[\s\S]*?<\/form>/)?.[0] ?? "";
    expect(boxes(formFr)).toEqual(boxes(form));
    expect(formFr).toContain('<input type="hidden" name="lang" value="fr"/>');
    expect(formFr).toContain("<span>Chaque nouvel avis d’appel d’offres</span>");
    expect(formFr).toContain("<span>Nouveaux avis d’appel d’offres correspondant à des filtres</span>");
    expect(formFr).toContain("<span>Contrats qui entrent dans la période de 3 mois pour tous les acheteurs et segments</span>");
    expect(formFr).toContain('<legend class="field-label">Catégorie</legend>');
    expect(formFr).toContain("<span>Biens</span>");
    expect(formFr).toContain('<span class="field-label">Segment UNSPSC</span>');
    expect(formFr).toContain('<span class="field-label">Province de livraison</span>');
    expect(options(formFr, "province")).toEqual(["BC: Colombie-Britannique (1)", "ON: Ontario (1)", "QC: Québec (1)"]);
    expect(formFr).toContain("Maintenez la touche Ctrl (Cmd sur un Mac) pour choisir plusieurs segments ou provinces.");
    expect(formFr).toContain('<button type="submit" class="btn btn-primary">Inscrivez-moi</button>');
  });

  it("saves one row per list ticked, with the kinds, filters and labels the pages' own blocks save", async () => {
    const res = await choose([
      ["lang", "en"], ["list", "tenders"], ["list", "matching"], ["list", "expiring"],
      ["category", "GD"], ["segment", "82"], ["province", "QC"], ["national", "1"], ["email", " Three.Lists@Example.CA "],
    ]);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    const html = decode(await res.text());
    // The page again, with the address and every list saved in place of the form.
    expect(html).toContain("<h1>Email Lists</h1>");
    expect(html).toContain(
      '<div class="interest-done" role="status"><p>Saved for three.lists@example.ca:</p><ul class="lists-saved">' +
      "<li>Every new tender notice</li>" +
      "<li>New tender notices matching Category: Goods; UNSPSC segment: 82 Editorial and Design and Graphic and Fine Art Services; Province of delivery: Quebec</li>" +
      "<li>Contracts entering the 3-month window for every buyer and segment</li></ul></div>",
    );
    expect(html).not.toContain('name="email"');
    const stored = await rows("three.lists@example.ca");
    expect(stored.map((r) => [r.kind, r.params, r.lang])).toEqual([
      ["tenders", "/tenders", "en"],
      ["tenders", "/tenders?category=GD&province=QC&segment=82", "en"],
      ["expiring", "/expiring/3m", "en"],
    ]);
    expect(stored[1].label).toBe(
      "New tender notices matching Category: Goods; UNSPSC segment: 82 Editorial and Design and Graphic and Fine Art Services; Province of delivery: Quebec",
    );
    expect(new Set(stored.map((r) => r.token)).size).toBe(3);
    for (const r of stored) {
      expect(r.token).toMatch(/^[0-9a-f]{32}$/);
      expect(r.confirmed_at).toBeNull();
      expect(r.unsubscribed_at).toBeNull();
    }
    // The block on the tenders page for the same view, and on /expiring, save the same rows: posting them adds nothing.
    const view = await text("/tenders?province=QC&category=GD&segment=82");
    expect(hidden(view, "params")).toBe(stored[1].params);
    expect(label(view)).toBe(stored[1].label);
    expect(hidden(await text("/expiring"), "params")).toBe(stored[2].params);
    for (const [kind, params] of [["tenders", String(stored[1].params)], ["expiring", "/expiring"], ["tenders", "/tenders"]]) {
      expect((await post({ email: "three.lists@example.ca", kind, params, lang: "en" })).status).toBe(200);
    }
    // The same lists from the chooser again: the same answer, nothing new.
    const again = await choose([["lang", "en"], ["list", "expiring"], ["list", "tenders"], ["email", "three.lists@example.ca"]]);
    expect(again.status).toBe(200);
    expect(await rows("three.lists@example.ca")).toHaveLength(3);
  });

  it("makes the filtered list one row from several values of each filter, labelled in the form's language", async () => {
    const res = await choose([
      ["lang", "en"], ["list", "matching"], ["list", "awards"],
      ["category", "SRV"], ["category", "GD"], ["category", "SRVTGD"], ["segment", "82"], ["segment", "43"], ["segment", "99"], ["segment", "82"],
      ["province", "QC"], ["province", "ON"], ["province", "ZZ"], ["email", "several@example.ca"],
    ]);
    expect(res.status).toBe(200);
    const [row, ...more] = await rows("several@example.ca");
    expect(more).toHaveLength(0);
    // Keys sorted, each key's values in the page's order, once; the box unticked, so national=0 beside the provinces, and the label says so.
    expect(row.params).toBe("/tenders?category=GD&category=SRV&national=0&province=ON&province=QC&segment=43&segment=82");
    expect(row.label).toBe(
      "New tender notices matching Category: Goods or Services; " +
      "UNSPSC segment: 43 Information Technology Broadcasting and Telecommunications or 82 Editorial and Design and Graphic and Fine Art Services; " +
      "Province of delivery: Ontario or Quebec; Canada-wide or not stated: left out",
    );
    const fr = await choose([
      ["lang", "fr"], ["list", "matching"], ["category", "CNST"], ["category", "GD"], ["category", "SRV"], ["segment", "43"], ["province", "BC"],
      ["national", "1"], ["email", "plusieurs@example.ca"],
    ]);
    expect(fr.status).toBe(200);
    const [french] = await rows("plusieurs@example.ca");
    expect(french.lang).toBe("fr");
    expect(french.params).toBe("/tenders?category=GD&category=SRV&category=CNST&province=BC&segment=43");
    expect(nbsp(String(french.label))).toBe(
      "Nouveaux avis d’appel d’offres correspondant à Catégorie : Biens, Services ou Construction; " +
      "Segment UNSPSC : 43 Technologies de l’information, radiodiffusion et télécommunications; Province de livraison : Colombie-Britannique",
    );
    expect(nbsp(decode(await fr.text()))).toContain("<p>C’est noté pour plusieurs@example.ca :</p>");
  });

  it("names the Canada-wide notices in the label when they are left out, so two lists never share a label", async () => {
    // [lang, box ticked, params, label]
    const cases: [string, boolean, string, string][] = [
      ["en", true, "/tenders?province=QC", "New tender notices matching Province of delivery: Quebec"],
      ["en", false, "/tenders?national=0&province=QC", "New tender notices matching Province of delivery: Quebec; Canada-wide or not stated: left out"],
      ["fr", true, "/tenders?province=QC", "Nouveaux avis d’appel d’offres correspondant à Province de livraison : Québec"],
      ["fr", false, "/tenders?national=0&province=QC",
        "Nouveaux avis d’appel d’offres correspondant à Province de livraison : Québec; Tout le Canada ou non indiqué : exclus"],
    ];
    for (const [lang, ticked, params, expected] of cases) {
      const email = `national.${lang}.${ticked ? "in" : "out"}@example.ca`;
      const res = await choose([["lang", lang], ["list", "matching"], ["province", "QC"], ...(ticked ? [["national", "1"] as [string, string]] : []), ["email", email]]);
      expect(res.status, email).toBe(200);
      const [row] = await rows(email);
      expect(row.params, email).toBe(params);
      expect(nbsp(String(row.label)), email).toBe(expected);
    }
    // The block on the tenders page names the view the same way.
    expect(label(await text("/tenders?province=QC&national=0"))).toBe("New tender notices matching Province of delivery: Quebec; Canada-wide or not stated: left out");
    expect(label(await text("/tenders?province=QC"))).toBe("New tender notices matching Province of delivery: Quebec");
  });

  it("saves the filtered list with no filter chosen as every new tender notice, once", async () => {
    const both = await choose([["lang", "en"], ["list", "tenders"], ["list", "matching"], ["email", "widest@example.ca"]]);
    expect(both.status).toBe(200);
    const html = await both.text();
    expect(html).toContain('<ul class="lists-saved"><li>Every new tender notice</li></ul>');
    const alone = await choose([["lang", "en"], ["list", "matching"], ["national", "1"], ["email", "widest.alone@example.ca"]]);
    expect(alone.status).toBe(200);
    for (const email of ["widest@example.ca", "widest.alone@example.ca"]) {
      expect((await rows(email)).map((r) => [r.kind, r.params, r.label])).toEqual([["tenders", "/tenders", "Every new tender notice"]]);
    }
  });

  it("answers a post with no list ticked with the chooser as sent and a line saying so, 400, and stores nothing", async () => {
    const res = await choose([["lang", "en"], ["category", "GD"], ["segment", "82"], ["province", "ON"], ["email", "none.ticked@example.ca"]]);
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain('<p class="interest-error" role="alert">Choose at least one list.</p>');
    // The form comes back as it was sent, the cursor's place marked for the script.
    expect(html).toContain('<input type="checkbox" name="list" value="tenders" data-focus=""/>');
    expect(boxes(html)).toEqual(["list=tenders", "list=matching", "category=GD ticked", "category=SRV", "category=CNST", "national=1", "list=expiring"]);
    expect(options(html, "segment").filter((o) => o.includes("chosen"))).toEqual(["82 chosen: 82 Editorial and Design and Graphic and Fine Art Services (1)"]);
    expect(options(html, "province").filter((o) => o.includes("chosen"))).toEqual(["ON chosen: Ontario (1)"]);
    expect(html).toContain('value="none.ticked@example.ca"');
    expect(await rows("none.ticked@example.ca")).toHaveLength(0);
    // A list the page does not offer counts as none; a bad address as well gets its own line.
    const both = await choose([["lang", "en"], ["list", "awards"], ["email", "nope"]]);
    expect(both.status).toBe(400);
    const lines = [...(await both.text()).matchAll(/<p class="interest-error" role="alert">([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(lines).toEqual(["Choose at least one list.", "Enter a complete email address."]);
    const fr = await choose([["lang", "fr"], ["email", "aucune@example.ca"]]);
    expect(fr.status).toBe(400);
    const french = nbsp(await fr.text());
    expect(french).toContain('<p class="interest-error" role="alert">Choisissez au moins une liste.</p>');
    expect(french).toContain("<h1>Listes de diffusion</h1>");
  });

  it("refuses the honeypot and a bad address with a line, keeping the lists ticked, and stores nothing", async () => {
    const bot = await choose([["lang", "en"], ["list", "tenders"], ["email", "bot.lists@example.ca"], ["website", "http://spam.example"]]);
    expect(bot.status).toBe(400);
    const html = await bot.text();
    expect(html).toContain('<p class="interest-error" role="alert">The form could not be sent. Try again.</p>');
    expect(await rows("bot.lists@example.ca")).toHaveLength(0);
    const bad = await choose([["lang", "en"], ["list", "expiring"], ["email", "two@@example.ca"]]);
    expect(bad.status).toBe(400);
    const again = await bad.text();
    expect(again).toContain('<p class="interest-error" role="alert">Enter a complete email address.</p>');
    expect(boxes(again)).toContain("list=expiring ticked");
    expect(again).toContain('value="two@@example.ca"');
  });

  it("answers the script with the chooser's block alone", async () => {
    const ok = await choose([["lang", "en"], ["list", "expiring"], ["email", "script.lists@example.ca"]], { "x-interest-fragment": "1" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-interest-fragment")).toBe("1");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const html = await ok.text();
    expect(html.startsWith('<div class="interest-body lists-body" data-interest="">')).toBe(true);
    expect(html).not.toContain("<html");
    expect(html).toContain("<p>Saved for script.lists@example.ca:</p>");
    const bad = await choose([["lang", "en"], ["email", "script.none@example.ca"]], { "x-interest-fragment": "1" });
    expect(bad.status).toBe(400);
    const block = await bad.text();
    expect(block.startsWith('<div class="interest-body lists-body" data-interest="">')).toBe(true);
    expect(block).toContain("Choose at least one list.");
    expect(block).toContain('<form method="post" action="/interest" class="lists-form" data-interest-form="" data-lists="">');
  });

  it("keeps the choice and asks to try again when the database cannot take the rows", async () => {
    const broken = { ...testEnv(), DB: { prepare: () => { throw new Error("D1 is down"); } } };
    const res = await choose([["lang", "en"], ["list", "tenders"], ["list", "expiring"], ["email", "later.lists@example.ca"]], {}, broken);
    expect(res.status).toBe(503);
    const html = await res.text();
    expect(html).toContain("The message could not be saved just now. Try again in a moment.");
    expect(boxes(html)).toEqual(["list=tenders ticked", "list=matching", "category=GD", "category=SRV", "category=CNST", "national=1", "list=expiring ticked"]);
    expect(html).toContain('value="later.lists@example.ca"');
  });

  it("refuses a post from another site's page and a body that is not a form", async () => {
    for (const origin of ["https://evil.example", "null"]) {
      const cross = await choose([["lang", "en"], ["list", "tenders"], ["email", "cross.lists@example.ca"]], { origin });
      expect(cross.status, origin).toBe(403);
    }
    const json = await app.request("/interest", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.251" },
      body: JSON.stringify({ place: "lists", list: ["tenders"], email: "json.lists@example.ca" }),
    }, testEnv());
    expect(json.status).toBe(400);
    for (const email of ["cross.lists@example.ca", "json.lists@example.ca"]) expect(await rows(email), email).toHaveLength(0);
  });

  it("adds a row per list to the nightly run's count of sign-ups", async () => {
    // The query the workflow's "Count the alert sign-ups" step runs against the forms database.
    const step = nightly.slice(nightly.indexOf("- name: Count the alert sign-ups"));
    const query = /--command "([^"]+)"/.exec(step)?.[1] ?? "";
    expect(query).toBe("SELECT COUNT(*) AS n, SUM(unsubscribed_at IS NULL) AS live FROM interest");
    const count = async () => (await env.DB.prepare(query).first<{ n: number; live: number }>())!;
    const before = await count();
    expect((await choose([["lang", "en"], ["list", "tenders"], ["list", "matching"], ["segment", "43"], ["list", "expiring"], ["email", "counted@example.ca"]])).status).toBe(200);
    const after = await count();
    expect(after.n - before.n).toBe(3);
    expect(after.live - before.live).toBe(3);
  });
});
