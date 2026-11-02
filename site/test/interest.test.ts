import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { normalizeEmail } from "../src/pages/interest";
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
      expect(english, path).toContain('<h2>Get Alerts by Email</h2>');
      expect(hidden(english, "kind"), path).toBe(kind);
      expect(hidden(english, "params"), path).toBe(params);
      expect(hidden(english, "lang"), path).toBe("en");
      expect(label(english), path).toBe(en);
      const french = await text(`${path}${path.includes("?") ? "&" : "?"}lang=fr`);
      expect(french, path).toContain("<h2>Recevoir des alertes par courriel</h2>");
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
    expect(block).toContain("Alerts are being built. One message will announce them, with a link to unsubscribe; nothing else is sent.");
    expect(block).toContain('<a href="/privacy#interest">Privacy</a>');
    expect(block).toContain('<a href="/alerts">How alerts will work</a>');
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
    expect(html).toContain('<p class="interest-done" role="status">Noted: reader.one@example.ca, for contracts entering the 3-month window for National Defence. One message will announce the alerts.</p>');
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
    expect(nbsp(await res.text())).toContain("C’est noté : lectrice@example.ca, pour nouveaux avis d’attribution et contrats de Services publics et Approvisionnement Canada. Un seul message annoncera les alertes.");
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
    expect(html).toContain("Noted: fragment@example.ca, for ");
    expect(html).toContain("One message will announce the alerts.");
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
  it("explain alerts in both languages and carry the general form", async () => {
    const res = await get("/alerts");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Email Alerts</h1>");
    // About one screen: no contents box.
    expect(html).toContain('<div class="doc-layout doc-alone"><div class="doc">');
    expect(html).toContain('<h2 id="cover">What Alerts Will Cover</h2>');
    expect(html).toContain("Contracts entering the 3-, 6- or 12-month window of contracts ending soon, for one buyer, one segment or every contract.");
    expect(html).toContain("New records naming an organization you watch: an award notice, a contract or a grant.");
    expect(hidden(html, "kind")).toBe("tenders");
    expect(hidden(html, "params")).toBe("/tenders");
    expect(label(html)).toBe("Every new tender notice");
    for (const href of ["/tenders", "/expiring", "/organizations", "/buyers", "/segments", "/privacy#interest"]) {
      expect(html, href).toContain(`<a href="${href}">`);
    }
    // The Browse entry marks the page; the "soon" item under Your lists is a plain link.
    expect(html).toContain('href="/alerts" aria-current="page"');
    expect(html).toContain('<a class="rail-item rail-later" href="/alerts">');
    const footer = html.slice(html.indexOf('<footer class="site-footer">'));
    expect(footer).toContain('<a href="/feeds">Feeds</a><a href="/alerts">Alerts</a>');
    const fr = await get("/alerts?lang=fr");
    expect(fr.status).toBe(200);
    const french = nbsp(await fr.text());
    expect(french).toContain("<h1>Alertes par courriel</h1>");
    expect(french).toContain("Rien n’est encore envoyé.");
    expect(label(french)).toBe("Chaque nouvel avis d’appel d’offres");
    expect(french).toContain('<span class="rail-label">Alertes : bientôt</span>');
  });

  it("say what the interest table keeps, what it is for and how it is removed, in both languages", async () => {
    const html = await text("/privacy");
    expect(html).toContain('<h2 id="interest">Alert Interest</h2>');
    expect(html).toContain("The alerts form stores the email address, the saved filter and the site&#39;s wording of it, the language of the page, the time it was received and a random token for the links in later messages.");
    expect(html).toContain("It stores no IP address, browser identification or visitor code.");
    expect(html).toContain("The address is used for one message announcing the alerts, with a link to unsubscribe, and then for the alerts asked for once they exist.");
    expect(html).toContain("The address is never shown or shared.");
    expect(html).toContain('To have it removed, use the unsubscribe link in that message or write to <a href="mailto:contact@awardwatch.ca">contact@awardwatch.ca</a>. Removal is free of charge.');
    // The sections already there stay.
    for (const id of ["accounts", "browser", "counting", "feeds", "forms", "third", "removal"]) expect(html, id).toContain(`<h2 id="${id}">`);
    const french = nbsp(await text("/privacy?lang=fr"));
    expect(french).toContain('<h2 id="interest">Intérêt pour les alertes</h2>');
    expect(french).toContain("L’adresse n’est jamais affichée ni communiquée.");
    expect(french).toContain("Le retrait est gratuit.");
  });
});
