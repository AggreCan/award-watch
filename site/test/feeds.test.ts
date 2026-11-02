import { describe, expect, it } from "vitest";
import watchlistJs from "../public/watchlist.js?raw";
import { app } from "../src/index";
import { t, type Key } from "../src/i18n";
import { FEED_EVENTS, nationalFeedPath } from "../src/pages/feeds";
import { WATCH_MAX, WATCHLIST_CLIENT_KEYS } from "../src/pages/watchlist";
import { assetsWithout, makeFakeAssets, testEnv } from "./assets";

const EM_DASH = String.fromCharCode(0x2014);
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const html = async (path: string, env = testEnv()) => (await app.request(path, {}, env)).text();

describe("feeds page", () => {
  it("lists the national feeds with their addresses and the scoped feeds from the index", async () => {
    const res = await app.request("/feeds", {}, testEnv());
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<h1>Atom Feeds</h1>");
    expect(FEED_EVENTS).toEqual(["tenders", "awards"]);
    for (const e of FEED_EVENTS) {
      expect(page).toContain(`<a href="/data/${nationalFeedPath(e)}" class="mono wrap" style="overflow-wrap:anywhere">https://awardwatch.ca/data/feeds/canada/${e}.xml</a>`);
    }
    // One row per scope, one column per event.
    expect(page).toContain('<td data-label="Segment">82 Editorial and Design and Graphic and Fine Art Services</td>');
    expect(page).toContain('<a href="/data/feeds/segment/82/tenders.xml" class="mono" aria-label="82 Editorial and Design and Graphic and Fine Art Services: New tender notices">tenders.xml</a>');
    expect(page).toContain('<a href="/data/feeds/segment/82/awards.xml"');
    expect(page).toContain('<td data-label="Province">British Columbia</td>');
    expect(page).toContain('<td data-label="Buyer">Fisheries and Oceans Canada</td>');
    // A scope the page does not know is left out rather than shown raw.
    expect(page).not.toContain("feeds/x/tenders.xml");
    expect(page).toContain("each holding the 50 newest entries");
  });

  it("still lists the national feeds when the index is missing or unreadable", async () => {
    for (const assets of [assetsWithout("feeds/index.json"), makeFakeAssets({}, { "feeds/index.json": "{" })]) {
      const page = await html("/feeds", testEnv(assets));
      expect(page).toContain("https://awardwatch.ca/data/feeds/canada/tenders.xml");
      expect(page).toContain("The feed list is not published yet.");
    }
  });

  it("adds Atom autodiscovery for the national feeds to the home, tender, award and feeds pages", async () => {
    for (const path of ["/", "/tenders", "/tenders/new", "/awards", "/feeds"]) {
      const page = await html(path);
      expect(page, path).toContain('<link rel="alternate" type="application/atom+xml" title="New tender notices (Atom feed)" href="/data/feeds/canada/tenders.xml"/>');
      expect(page, path).toContain('href="/data/feeds/canada/awards.xml"');
    }
  });

  it("serves a feed file through the Worker with a short cache, and the site's 404 for a missing one", async () => {
    const res = await app.request("/data/feeds/canada/tenders.xml", {}, testEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.text()).toContain("<title>New tender notices</title>");
    const missing = await app.request("/data/feeds/canada/nothing.xml", {}, testEnv());
    expect(missing.status).toBe(404);
  });
});

describe("watchlist page", () => {
  it("renders a shell that reads as a document without scripts", async () => {
    const res = await app.request("/watchlist", {}, testEnv());
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("<h1>Watchlist</h1>");
    expect(page).toContain('No organization yet. Use the Watch button on a profile. The <a href="/organizations">directory</a> lists every organization.');
    expect(page).toContain("<noscript> The watchlist needs JavaScript.</noscript>");
    expect(page).toContain('<div id="watch-move" hidden="">');
    expect(page).toContain('<script src="/watchlist.js" defer=""></script>');
    expect(page).toContain(`data-max="${WATCH_MAX}"`);
    expect(page).toContain("Nothing about it is sent to the site.");
    expect(page).toContain('<link rel="canonical" href="https://awardwatch.ca/watchlist"');
  });

  it("hands its strings to the script in a JSON block, with no inline executable script", async () => {
    for (const lang of ["en", "fr"] as const) {
      const page = await html(`/watchlist?lang=${lang}`);
      for (const tag of page.match(/<script\b[^>]*>/g) ?? []) {
        expect(/\bsrc="|type="application\/(?:ld\+)?json"/.test(tag), tag).toBe(true);
      }
      const block = page.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)?.[1] ?? "";
      expect(block).not.toMatch(/[<>&]/);
      const data = JSON.parse(block) as { lang: string; locale: string; max: number; strings: Record<string, string> };
      expect(data.lang).toBe(lang);
      expect(data.max).toBe(WATCH_MAX);
      expect(Object.keys(data.strings)).toEqual([...WATCHLIST_CLIENT_KEYS]);
      for (const key of WATCHLIST_CLIENT_KEYS) expect(data.strings[key]).toBe(t(lang, key as Key));
    }
  });
});

describe("watch button on the profile", () => {
  it("carries its labels and stays hidden until the script shows it", async () => {
    const page = await html("/organizations/org-a000000001");
    // "Add to watchlist", titled with where the list is kept, so it reads apart from the email alerts.
    expect(page).toContain('id="watch-toggle" style="display:none" title="Kept in this browser" data-organization="org-a000000001"');
    expect(page).toContain('data-label-on="On your watchlist" data-label-off="Add to watchlist"');
    expect(page).toContain(`data-label-full="Watchlist full (${WATCH_MAX})"`);
    expect(page).toContain('<script src="/watchlist.js" defer=""></script>');
    expect(page).toContain("For a list in this browser without email, use Add to watchlist.");
    const fr = await html("/organizations/org-a000000001?lang=fr");
    expect(fr).toContain('data-label-on="Dans votre liste de suivi" data-label-off="Ajouter à la liste de suivi"');
  });
});

describe("watchlist.js", () => {
  const literalKeys = [...watchlistJs.matchAll(/\btxn?\("([^"]+)"(?:, "([^"]+)")?/g)].flatMap((m) => [m[1], m[2]]).filter(Boolean);
  const markKeys = [...watchlistJs.matchAll(/"(watch\.[a-z_]+)"/g)].map((m) => m[1]);

  it("asks only for strings its page supplies", () => {
    const keys = new Set<string>(WATCHLIST_CLIENT_KEYS);
    expect(literalKeys.length).toBeGreaterThan(10);
    for (const key of [...literalKeys, ...markKeys]) expect(keys.has(key), `watchlist.js uses ${key}`).toBe(true);
    for (const s of ["awards", "history", "contracts", "grants", "lobbying"]) {
      expect(keys.has(`watch.new_${s}_one`), s).toBe(true);
      expect(keys.has(`source.${s}`), s).toBe(true);
    }
  });

  it("reads organization ids and profiles, and holds no English sentences of its own", () => {
    expect(watchlistJs).toContain("var ID_RE = /^org-[0-9a-f]{10}$/;");
    expect(watchlistJs).toContain('fetch("/data/profiles/" + key + ".json")');
    expect(watchlistJs).not.toMatch(/emp-|employer/);
    const sentences = [...watchlistJs.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((s) => /\b[A-Z][a-z]+(?: [a-z]+)+/.test(s));
    expect(sentences).toEqual([]);
    expect(watchlistJs).not.toContain(EM_DASH);
    // Data reaches the page as text, never as markup.
    expect(watchlistJs).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });

  it("wraps every storage call", () => {
    const calls = watchlistJs.match(/localStorage\.\w+\(/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const line of watchlistJs.split("\n").filter((l) => /localStorage\.\w+\(/.test(l))) {
      expect(/try \{|^\s+localStorage\.(setItem|removeItem)\("watchlist-probe"/.test(line), line.trim()).toBe(true);
    }
  });
});

describe("French versions", () => {
  it("speak French", async () => {
    const feeds = nbsp(await html("/feeds?lang=fr"));
    expect(feeds).toContain("<h1>Fils Atom</h1>");
    expect(feeds).toContain(">Colombie-Britannique</td>");
    expect(feeds).toContain(">Pêches et Océans Canada</td>");
    expect(feeds).toContain("82 Services de rédaction, de design, de graphisme et de beaux-arts : Nouveaux avis d’appel d’offres");
    const watch = nbsp(await html("/watchlist?lang=fr"));
    expect(watch).toContain("<h1>Liste de suivi</h1>");
    expect(watch).toContain("Aucune organisation pour l’instant.");
  });
});
