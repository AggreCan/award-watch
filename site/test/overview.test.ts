// The app home at its own address (src/pages/home.tsx overviewPage,
// docs/landing.md): /overview answers every reader, with no session, a Free
// session or a Pro one, in both languages and both switch states, with the
// body "/" gives the same reader where "/" shows the app home, cached as "/"
// is for that reader; its head is its own (title, description, canonical,
// alternates, no structured data) while "/" keeps the site's. The landing
// page's nav and footer and every railed page's footer link to it, worded as
// the rail's Overview group, and the views count it under its own route. What
// the accounts switch adds to it is held with the other public pages in
// test/accounts-switch.test.ts.
import { describe, expect, it } from "vitest";
import { t, type Lang } from "../src/i18n";
import { app } from "../src/index";
import { DESCRIPTION_MAX, TITLE_MAX } from "../src/seo";
import { routeTemplate } from "../src/views";
import { decode, grantPro, newEmail, nbsp, nextIp, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { testEnv } from "./assets";
import { homeRequest } from "./home";

useAccountsDb();

const O = "https://awardwatch.ca";
const EM_DASH = String.fromCharCode(0x2014);
const LANGS = ["en", "fr"] as const;
const READERS = ["none", "free", "pro"] as const;
type Reader = (typeof READERS)[number];

// The result-list text, as a reader of each language sees it (French spaces made plain).
const TITLE: Record<Lang, string> = {
  en: "Today's Federal Tenders, Awards and Contracts Ending",
  fr: "Appels d’offres, attributions et fins de contrat du jour",
};
const DESCRIPTION: Record<Lang, string> = {
  en: "The day's overview: open federal tenders by province on a map, the notices new today and closing soon, the newest awards and contracts ending in 3 months.",
  fr: "Vue d’ensemble du jour : appels d’offres fédéraux ouverts par province, avis nouveaux et sur le point de fermer, attributions récentes et fins de contrat.",
};

// One Free and one Pro session, made once with the switch on.
let sessions: Promise<Record<Exclude<Reader, "none">, string>> | null = null;
function cookies() {
  sessions ??= (async () => {
    const free = await signIn(newEmail("overview-free"));
    const proEmail = newEmail("overview-pro");
    const pro = await signIn(proEmail);
    await grantPro(proEmail);
    return { free, pro };
  })();
  return sessions;
}

// "app": the site as it runs; "home": test/home.ts, where "/" is the app home whatever the session.
function request(path: string, env: object, cookie?: string, via: "app" | "home" = "app"): Promise<Response> {
  const headers: Record<string, string> = { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() };
  if (cookie) headers.cookie = cookie;
  return Promise.resolve(via === "home" ? homeRequest(path, { headers }, env) : app.request(path, { headers }, env));
}
const q = (lang: Lang) => (lang === "fr" ? "?lang=fr" : "");
const headOf = (page: string) => page.slice(0, page.indexOf("</head>"));
const bodyOf = (page: string) => page.slice(page.indexOf("<body"));
const plain = (s: string) => nbsp(decode(s));
const titleOf = (head: string) => plain(/<title>([^<]*)<\/title>/.exec(head)?.[1] ?? "");
const metaOf = (head: string, name: string) =>
  plain(new RegExp(`<meta (?:name|property)="${name.replace(/[:.]/g, "\\$&")}" content="([^"]*)"`).exec(head)?.[1] ?? "");
const alternatesOf = (head: string) =>
  Object.fromEntries([...head.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
const railOf = (page: string) => /<nav class="rail"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? "";
const footerLinks = (page: string) => /<span class="footer-links">([\s\S]*?)<\/span>/.exec(page)?.[1] ?? "";
const hrefs = (html: string) => [...html.matchAll(/<a [^>]*?href="([^"]+)"/g)].map((m) => m[1]);
const overviewLink = (lang: Lang) => `<a href="/overview">${t(lang, "rail.index")}</a>`;
// The landing page's nav uses the short word, so the French bar keeps one line.
const navLink = (lang: Lang) => `<a href="/overview">${t(lang, "landing.nav_overview")}</a>`;

describe("the route", () => {
  it("serves the app home to every reader, in both languages and both switch states, with the body and the caching \"/\" gives that reader", async () => {
    const c = await cookies();
    for (const on of [false, true]) {
      for (const lang of LANGS) {
        for (const reader of READERS) {
          const env = on ? onEnv() : testEnv();
          const cookie = reader === "none" ? undefined : c[reader];
          const who = `switch ${on ? "on" : "off"}, ${lang}, ${reader}`;
          const res = await request(`/overview${q(lang)}`, env, cookie);
          expect(res.status, who).toBe(200);
          const page = await res.text();
          expect(page, who).toContain(`<html lang="${lang}">`);
          expect(plain(page), who).toContain(`<h1>${plain(t(lang, "home.title"))}</h1>`);
          expect(page, who).toContain('<nav class="rail"');
          expect(page, who).toContain('<section class="tiles"');
          expect(page, who).not.toContain('<body class="lp">');
          expect(page, who).not.toContain(EM_DASH);
          // The session is read only with the switch on, as on every railed page.
          const signedIn = on && reader !== "none";
          if (signedIn) expect(page, who).toContain(`<span class="brand-plan brand-plan-${reader}">`);
          else expect(page, who).not.toContain("brand-plan");
          // "/" is the app home for a signed-in reader; for anyone else it is the
          // landing page, so the app home's body is test/home.ts's "/".
          const root = await request(`/${q(lang)}`, env, cookie, signedIn ? "app" : "home");
          expect(root.status, who).toBe(200);
          expect(bodyOf(page), who).toBe(bodyOf(await root.text()));
          expect(res.headers.get("cache-control"), who).toBe(signedIn ? "private, no-store" : "public, max-age=300");
          expect(res.headers.get("cache-control"), who).toBe(root.headers.get("cache-control"));
          expect(res.headers.get("vary"), who).toBe(root.headers.get("vary"));
          if (on) expect(res.headers.get("vary"), who).toContain("Cookie");
          else expect(res.headers.get("vary"), who).toBeNull();
        }
      }
    }
  });

  it("leaves \"/\" as it was: the landing page without a session, the app home with one", async () => {
    const c = await cookies();
    for (const lang of LANGS) {
      for (const env of [testEnv(), onEnv()]) expect(await (await request(`/${q(lang)}`, env)).text(), lang).toContain('<body class="lp">');
      const home = await (await request(`/${q(lang)}`, onEnv(), c.free)).text();
      expect(home, lang).toContain('<nav class="rail"');
      expect(home, lang).not.toContain('<body class="lp">');
    }
  });

  it("marks no rail item as the page, as at \"/\", under the rail's Overview group", async () => {
    for (const lang of LANGS) {
      for (const env of [testEnv(), onEnv()]) {
        const rail = railOf(await (await request(`/overview${q(lang)}`, env)).text());
        expect(rail, lang).toContain(`<p class="rail-head" id="rail-index">${t(lang, "rail.index")}</p>`);
        expect(rail, lang).not.toContain('aria-current="page"');
        expect(rail, lang).toBe(railOf(await (await request(`/${q(lang)}`, env, undefined, "home")).text()));
      }
    }
  });
});

describe("the head", () => {
  it("names the day's overview at its own canonical address, with the language pair and no structured data", async () => {
    const c = await cookies();
    for (const lang of LANGS) {
      for (const [env, cookie] of [[testEnv(), undefined], [onEnv(), undefined], [onEnv(), c.free], [onEnv(), c.pro]] as const) {
        const head = headOf(await (await request(`/overview${q(lang)}`, env, cookie)).text());
        const url = `${O}/overview${q(lang)}`;
        const who = `${lang} ${cookie ? "signed in" : "no session"}`;
        expect(titleOf(head), who).toBe(TITLE[lang]);
        expect(metaOf(head, "description"), who).toBe(DESCRIPTION[lang]);
        expect(head, who).toContain(`<link rel="canonical" href="${url}"/>`);
        expect(alternatesOf(head), who).toEqual({ en: `${O}/overview`, fr: `${O}/overview?lang=fr`, "x-default": `${O}/overview` });
        expect(metaOf(head, "og:url"), who).toBe(url);
        expect(metaOf(head, "og:title"), who).toBe(TITLE[lang]);
        expect(metaOf(head, "og:description"), who).toBe(DESCRIPTION[lang]);
        expect(metaOf(head, "og:locale"), who).toBe(lang === "fr" ? "fr_CA" : "en_CA");
        // The WebSite and publisher markup stays with "/", as the section pages leave it.
        expect(head, who).not.toContain("application/ld+json");
        expect(head, who).not.toContain('name="robots"');
        expect(head, who).not.toContain(EM_DASH);
      }
      expect(TITLE[lang].length).toBeLessThanOrEqual(TITLE_MAX);
      expect(DESCRIPTION[lang].length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it("leaves \"/\" its own title, canonical and WebSite markup for a signed-in reader as for the landing page", async () => {
    const c = await cookies();
    for (const lang of LANGS) {
      for (const cookie of [undefined, c.free]) {
        const head = headOf(await (await request(`/${q(lang)}`, onEnv(), cookie)).text());
        expect(head, lang).toContain(`<link rel="canonical" href="${O}/${q(lang)}"/>`);
        expect(head, lang).toContain('"@type":"WebSite"');
        expect(titleOf(head), lang).not.toBe(TITLE[lang]);
        expect(metaOf(head, "description"), lang).not.toBe(DESCRIPTION[lang]);
      }
    }
  });
});

describe("the links", () => {
  it("lead the landing page's nav and footer, in both languages and both switch states", async () => {
    for (const lang of LANGS) {
      for (const env of [testEnv(), onEnv()]) {
        const page = await (await request(`/${q(lang)}`, env)).text();
        expect(page, lang).toContain('<body class="lp">');
        const nav = /<nav class="lp-links"[^>]*>([\s\S]*?)<\/nav>/.exec(page)?.[1] ?? "";
        expect(hrefs(nav).slice(0, 2), lang).toEqual(["/overview", "/tenders"]);
        expect(nav, lang).toContain(navLink(lang));
        const footer = footerLinks(page);
        expect(hrefs(footer)[0], lang).toBe("/overview");
        expect(footer, lang).toContain(overviewLink(lang));
      }
    }
    expect(overviewLink("en")).toBe('<a href="/overview">Overview</a>');
    expect(overviewLink("fr")).toBe('<a href="/overview">Vue d’ensemble</a>');
    expect(navLink("en")).toBe('<a href="/overview">Overview</a>');
    expect(navLink("fr")).toBe('<a href="/overview">Aperçu</a>');
  });

  it("lead the app shell's footer links, beside the other sections, on every railed page", async () => {
    const c = await cookies();
    for (const lang of LANGS) {
      for (const [env, cookie] of [[testEnv(), undefined], [onEnv(), undefined], [onEnv(), c.pro]] as const) {
        for (const path of ["/overview", "/tenders", "/about", "/nothing-here"]) {
          const page = await (await request(`${path}${q(lang)}`, env, cookie)).text();
          const footer = footerLinks(page);
          expect(hrefs(footer).slice(0, 3), `${path} ${lang}`).toEqual(["/overview", "/segments", "/rankings"]);
          expect(footer, `${path} ${lang}`).toContain(overviewLink(lang));
        }
      }
    }
  });
});

describe("the views", () => {
  it("count /overview under its own route, apart from \"/\"", async () => {
    expect(routeTemplate("GET", "/overview")).toEqual({ route: "/overview", kind: "page" });
    expect(routeTemplate("GET", "/")).toEqual({ route: "/", kind: "page" });
    const points: AnalyticsEngineDataPoint[] = [];
    const VIEWS = { writeDataPoint: (p?: AnalyticsEngineDataPoint) => void (p && points.push(p)) } as AnalyticsEngineDataset;
    const res = await request("/overview?lang=fr", { ...testEnv(), VIEWS });
    expect(res.status).toBe(200);
    expect(points.map((p) => [p.blobs?.[0], p.blobs?.[1], p.blobs?.[2], p.doubles?.[0]])).toEqual([["/overview", "page", "fr", 200]]);
  });
});
