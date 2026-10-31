import { describe, expect, it } from "vitest";
import tendersJs from "../public/tenders.js?raw";
import watchlistJs from "../public/watchlist.js?raw";
import { SEGMENTS } from "../src/constants";
import { app } from "../src/index";
import {
  SAME_IN_BOTH, allKeys, categoryLabel, competitiveLabel, fmtInt, fmtMoney, fmtMoneyShort, fmtPct, frTypography, pick,
  provinceName, rawEntry, segmentLabel, sourceLabel, statusLabel, t, type Key,
} from "../src/i18n";
import { TENDERS_CLIENT_KEYS } from "../src/pages/tenders";
import { WATCHLIST_CLIENT_KEYS } from "../src/pages/watchlist";
import { emptyAssets, testEnv } from "./assets";

const EM_DASH = String.fromCharCode(0x2014);
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

// A browser's navigation: the response form's GET answers browsers only (forms.tsx).
const get = (path: string, headers: Record<string, string> = {}, env: object = testEnv()) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", ...headers } }, env);
const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      body: new URLSearchParams(fields).toString(),
    },
    testEnv(),
  );

// English phrases that must never reach a French page. Each one appears on
// an English page (checked below), so the list cannot go stale silently.
const SENTINELS = [
  "Support the Site",
  "What the Site Holds Today",
  "Data Not Published Yet",
  "Page Not Found",
  "Respond as the Organization",
  "Report a Correction",
  "Open Tender Notices",
  "Closing soon",
  "Figures by Year and Source",
  "How to Read This Site",
  "Not yet funded",
  "Card processing fee",
  "is a secondary source",
  "Counting Money",
  "Also recorded as",
  "Largest Award Values",
  "Organizations A to Z",
  "Amendment History",
  "Value counted",
  "Rank by source",
  "Contracts Ending Soon",
  "days left",
  "Individual, name withheld",
  "Amendments and growth",
];

const FRENCH_PAGES = [
  "/?lang=fr",
  "/tenders?lang=fr",
  "/tenders?lang=fr&segment=82&sort=published",
  "/tenders/new?lang=fr",
  "/tenders/cb-100-10000001?lang=fr",
  "/tenders/cb-200-20005019?lang=fr",
  "/awards?lang=fr",
  "/awards/2026?lang=fr",
  "/awards/2026?lang=fr&page=2",
  "/awards/cb-400-40000004?lang=fr",
  "/expiring?lang=fr",
  "/expiring/3m?lang=fr",
  "/expiring/3m?lang=fr&buyer=dnd-mdn&value=1m-10m",
  "/expiring/3m?lang=fr&value=over-10m",
  "/expiring/1m?lang=fr",
  "/history/w8472-000633?lang=fr",
  "/organizations?lang=fr",
  "/organizations/directory/on?lang=fr",
  "/organizations/directory/yt?lang=fr",
  "/organizations/org-a000000001?lang=fr",
  "/organizations/org-a000000002?lang=fr",
  "/organizations/org-ffffffffff?lang=fr",
  "/organizations/org-a000000001/respond?lang=fr",
  "/buyers?lang=fr",
  "/buyers/pwgsc-tpsgc?lang=fr",
  "/categories?lang=fr",
  "/categories/82?lang=fr",
  "/rankings?lang=fr",
  "/rankings/2026?lang=fr&source=contracts&by=count",
  "/feeds?lang=fr",
  "/watchlist?lang=fr",
  "/methodology?lang=fr",
  "/data?lang=fr",
  "/support?lang=fr",
  "/cite?lang=fr",
  "/corrections?lang=fr",
  "/nothing-here?lang=fr",
  "/downloads/organizations.csv?lang=fr",
];

// The data blocks hold {name} templates on purpose; the API table shows
// endpoint patterns with braces, and a BibTeX entry on the citation page
// (a block that starts with @) braces its fields. Everything else must be
// filled in.
function visible(html: string): string {
  return html
    .replace(/<script type="application\/(?:ld\+)?json"[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<pre class="cite-block">@[\s\S]*?<\/pre>/g, "")
    .replace(/\{(id|reference|nn)\}/g, "");
}

describe("dictionary", () => {
  it("has a French string for every key, different from the English unless listed", () => {
    const keys = allKeys();
    expect(keys.length).toBeGreaterThan(500);
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      expect(en.trim(), key).not.toBe("");
      expect(fr.trim(), key).not.toBe("");
      if (SAME_IN_BOTH.has(key)) expect(fr, key).toBe(en);
      else expect(fr, `${key} has no French yet`).not.toBe(en);
    }
  });

  it("has no em-dash in either language", () => {
    for (const key of allKeys()) {
      const { en, fr } = rawEntry(key);
      expect(en, key).not.toContain(EM_DASH);
      expect(fr, key).not.toContain(EM_DASH);
    }
  });

  it("keeps the same placeholders in both languages", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of allKeys()) {
      const { en, fr } = rawEntry(key);
      expect(names(fr), key).toEqual(names(en));
    }
  });

  it("follows Canadian French punctuation", () => {
    for (const key of allKeys()) {
      const { fr } = rawEntry(key);
      expect(fr, `${key}: no space before ; ! ?`).not.toMatch(/\s[;!?]/);
      expect(fr, `${key}: a space before every colon`).not.toMatch(/[^ ]:/);
      expect(fr, `${key}: guillemets, not straight quotes`).not.toContain('"');
      expect(fr, `${key}: a space inside guillemets`).not.toMatch(/«(?! )|(?<! )»/);
    }
    expect(frTypography("Sources : « AchatsCanada » d'ouvert, 5 $ US")).toBe("Sources\u00a0: «\u00a0AchatsCanada\u00a0» d’ouvert, 5\u00a0$\u00a0US");
  });

  it("keeps the site's name in English in French strings, as a proper name", () => {
    expect(t("fr", "site.name")).toBe("Award Watch");
    expect(nbsp(t("fr", "citepage.lead"))).toContain("Award Watch est une source secondaire.");
  });

  it("fills placeholders and leaves English as written", () => {
    expect(t("en", "tenders.page_of", { page: 1, pages: 3 })).toBe("Page 1 of 3");
    expect(t("fr", "tenders.page_of", { page: 1, pages: 3 })).toBe("Page 1 sur 3");
    expect(t("en", "home.read_competitive")).toContain('"Non-competitive" is the sources');
  });
});

describe("formats", () => {
  it("groups numbers the way each language does", () => {
    expect(fmtInt(166497, "en")).toBe("166,497");
    expect(nbsp(fmtInt(166497, "fr"))).toBe("166 497");
    expect(fmtInt(null)).toBe("0");
  });

  it("writes money in Canadian dollars, whole dollars from 1,000 up, cents below", () => {
    expect(fmtMoney(1875000.25, "en")).toBe("$1,875,000");
    expect(nbsp(fmtMoney(1875000.25, "fr"))).toBe("1 875 000 $");
    expect(fmtMoney(999.5, "en")).toBe("$999.50");
    expect(nbsp(fmtMoney(999.5, "fr"))).toBe("999,50 $");
    expect(fmtMoney(250, "en")).toBe("$250");
    // Another currency keeps its own sign, so it never reads as Canadian dollars.
    expect(fmtMoney(5000, "en", "USD")).toBe("US$5,000");
    expect(nbsp(fmtMoney(5000, "fr", "USD"))).toBe("5 000 $ US");
    expect(fmtMoney(5000, "en", "cad")).toBe("$5,000");
  });

  it("uses the short forms, M and B (M$ and G$), for tiles", () => {
    expect(fmtMoneyShort(1875000.25, "en")).toBe("$1.9M");
    expect(nbsp(fmtMoneyShort(1875000.25, "fr"))).toBe("1,9 M$");
    expect(fmtMoneyShort(2_400_000_000, "en")).toBe("$2.4B");
    expect(nbsp(fmtMoneyShort(2_400_000_000, "fr"))).toBe("2,4 G$");
    expect(fmtMoneyShort(250_000_000, "en")).toBe("$250M");
    expect(fmtMoneyShort(250000, "en")).toBe("$250,000");
    expect(fmtMoneyShort(0, "en")).toBe("$0");
  });

  it("writes a share as a whole percentage, empty when there is nothing to share", () => {
    expect(fmtPct(3, 12, "en")).toBe("25%");
    expect(nbsp(fmtPct(3, 12, "fr"))).toBe("25 %");
    expect(fmtPct(1, 400, "en")).toBe("<1%");
    expect(fmtPct(0, 12, "en")).toBe("0%");
    expect(fmtPct(3, 0, "en")).toBe("");
  });

  it("names provinces, segments, categories, sources, statuses and the competitive flag in both languages", () => {
    expect(provinceName("fr", "BC")).toBe("Colombie-Britannique");
    expect(provinceName("en", "xx")).toBe("Outside Canada");
    expect(provinceName("fr", "UN")).toBe("Aucune adresse au dossier");
    expect(provinceName("en", "ZZ")).toBe("ZZ");
    expect(Object.keys(SEGMENTS)).toHaveLength(57);
    expect(segmentLabel("en", "43")).toBe("Information Technology Broadcasting and Telecommunications");
    expect(segmentLabel("fr", "43")).toBe("Technologies de l’information, radiodiffusion et télécommunications");
    expect(segmentLabel("en", "99")).toBe("99");
    expect(categoryLabel("fr", "GD")).toBe("Biens");
    expect(sourceLabel("fr", "history")).toBe("Historique des contrats de SPAC");
    expect(statusLabel("fr", "closing")).toBe("Clôture prochaine");
    expect(statusLabel("en", "made-up")).toBe("Status unknown");
    expect(competitiveLabel("en", 0)).toBe("Non-competitive");
    expect(competitiveLabel("fr", true)).toBe("Concurrentiel");
    expect(competitiveLabel("en", null)).toBe("Method not stated");
  });

  it("picks the page language of a bilingual field, and the other when it is blank", () => {
    expect(pick("fr", "Goods", "Biens")).toBe("Biens");
    expect(pick("fr", "Goods", "  ")).toBe("Goods");
    expect(pick("en", null, "Biens")).toBe("Biens");
    expect(pick("en", null, null)).toBeNull();
  });
});

describe("client scripts", () => {
  // Literal keys only; a key built from a prefix ("source." + s) is checked below.
  const literalKeys = (src: string) => [...src.matchAll(/\btx\("([^"]+)"/g)].map((m) => m[1]).filter((k) => !k.endsWith("."));
  const sentenceLiterals = (src: string) =>
    [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((s) => /\b[A-Z][a-z]+(?: [a-z]+)+/.test(s));

  it("ask only for strings their page supplies", () => {
    const tenders = new Set<string>(TENDERS_CLIENT_KEYS);
    for (const key of literalKeys(tendersJs)) expect(tenders.has(key), `tenders.js uses ${key}`).toBe(true);
    for (const key of ["status.open", "status.closing", "col.notice", "col.region"]) expect(tenders.has(key), key).toBe(true);
    const watch = new Set<string>(WATCHLIST_CLIENT_KEYS);
    for (const key of literalKeys(watchlistJs)) expect(watch.has(key), `watchlist.js uses ${key}`).toBe(true);
    for (const s of ["awards", "history", "contracts", "grants", "lobbying"]) expect(watch.has(`source.${s}`), s).toBe(true);
    for (const key of [...TENDERS_CLIENT_KEYS, ...WATCHLIST_CLIENT_KEYS]) expect(allKeys()).toContain(key);
  });

  it("hold no English sentences of their own", () => {
    expect(sentenceLiterals(tendersJs)).toEqual([]);
    expect(sentenceLiterals(watchlistJs)).toEqual([]);
  });

  it("get their strings from a JSON block, with no inline executable script", async () => {
    for (const [path, keys] of [["/tenders?lang=fr", TENDERS_CLIENT_KEYS], ["/watchlist?lang=fr", WATCHLIST_CLIENT_KEYS]] as const) {
      const html = await (await get(path)).text();
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
        expect(/\bsrc="|type="application\/json"/.test(tag), tag).toBe(true);
      }
      const block = html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)?.[1] ?? "";
      expect(block).not.toMatch(/[<>&]/);
      const data = JSON.parse(block) as { lang: string; locale: string; strings: Record<string, string> };
      expect(data.lang).toBe("fr");
      expect(data.locale).toBe("fr-CA");
      expect(Object.keys(data.strings)).toEqual([...keys]);
      for (const key of keys) expect(data.strings[key]).toBe(t("fr", key as Key));
    }
    const tenders = JSON.parse(
      (await (await get("/tenders?lang=fr")).text()).match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)?.[1] ?? "{}",
    );
    expect(tenders.strings["tenders.none_match"]).toBe("Aucun avis ouvert ne correspond à ces filtres.");
    expect(tenders.labels.segments["82"]).toBe("Services de rédaction, de design, de graphisme et de beaux-arts");
    expect(tenders.labels.provinces.QC).toBe("Québec");
  });
});

describe("rendered French pages", () => {
  it("carry no leftover English, no unfilled placeholder and no em-dash", async () => {
    for (const path of FRENCH_PAGES) {
      const res = await get(path);
      const html = await res.text();
      expect(html, path).toContain('<html lang="fr">');
      for (const s of SENTINELS) expect(html, `${path} still says "${s}"`).not.toContain(s);
      expect(visible(html), `${path} has an unfilled placeholder`).not.toMatch(/\{\w+\}/);
      expect(html, path).not.toContain(EM_DASH);
    }
  });

  it("say the expected French on the main pages", async () => {
    const home = nbsp(await (await get("/?lang=fr")).text());
    expect(home).toContain("<h1>Appels d’offres, contrats et subventions du fédéral, par organisation</h1>");
    expect(home).toContain("Avis d’appel d’offres ouverts");
    expect(home).toContain("5 883");
    expect(home).toContain("Clôture prochaine");
    expect(home).toContain("Services publics et Approvisionnement Canada");
    expect(home).toContain("Valeurs attribuées les plus élevées en 2026");

    const tender = nbsp(await (await get("/tenders/cb-100-10000001?lang=fr")).text());
    expect(tender).toContain("<h1>Services de traduction pour les bureaux régionaux</h1>");
    expect(tender).toContain("Concurrentielle - Appel d&#39;offres ouvert");
    expect(tender).toContain("Région de la capitale nationale (RCN)");
    expect(tender).toContain("Ministère des Pêches et des Océans (MPO)");
    expect(tender).toContain("Historique des modifications");

    const org = nbsp(await (await get("/organizations/org-a000000001?lang=fr")).text());
    expect(org).toContain("Chiffres par année et par source");
    expect(org).toContain("Contrats publiés");
    expect(org).toContain("3 sur 60 (5 %)");
    expect(org).toContain("Services de traduction");
    expect(org).toContain("1 ligne dans une autre devise est affichée avec sa devise et exclue des totaux.");

    const meth = nbsp(await (await get("/methodology?lang=fr")).text());
    expect(meth).toContain('<h2 id="counting">Calcul des montants</h2>');
    expect(meth).toContain("Un avis annulé compte pour zéro.");
    expect(meth).toContain("TN et AC sont non concurrentiels; OB, TC et ST sont concurrentiels");

    const support = nbsp(await (await get("/support?lang=fr")).text());
    expect(support).toContain("<h1>Soutenir le site</h1>");
    expect(support).toContain("Ce que le site contient aujourd’hui");
    expect(support).toContain("Frais de traitement par carte : 0,59 $ (2,9 % plus 30 cents)");
    expect(support).toContain("Réserve détenue : 0 sur 12 mois.");
    expect(support).toContain("Les dons ne sont pas encore ouverts.");
  });

  it("show the 503 page and form errors in French", async () => {
    const empty = await get("/?lang=fr", {}, testEnv(emptyAssets));
    expect(empty.status).toBe(503);
    expect(await empty.text()).toContain("Données pas encore publiées");

    const bad = await post("/organizations/org-a000000001/respond", { text: "short", contact: "nope" }, { cookie: "lang=fr" });
    expect(bad.status).toBe(400);
    const html = await bad.text();
    expect(html).toContain("L’adresse courriel semble incomplète.");
    expect(html).toContain("La déclaration doit compter au moins 20 caractères.");
    expect(html).not.toContain("does not look complete");

    const ok = await post("/corrections", { page: "cb-100-10000001", text: "The region of delivery is wrong." }, { cookie: "lang=fr" });
    expect(await ok.text()).toContain("La correction a été reçue et sera examinée.");
  });

  it("keep the sentinel list honest: each phrase is on an English page", async () => {
    const pages = await Promise.all(
      [
        "/", "/tenders", "/methodology", "/support", "/cite", "/organizations/org-a000000001", "/organizations/directory/on",
        "/nothing-here", "/organizations/org-a000000001/respond", "/tenders/cb-100-10000001", "/awards/cb-400-40000004",
        "/rankings", "/corrections", "/expiring",
      ].map(async (p) => (await get(p)).text()),
    );
    pages.push(await (await get("/", {}, testEnv(emptyAssets))).text());
    const all = pages.join("\n").replace(/&#39;/g, "'");
    for (const s of SENTINELS) expect(all, s).toContain(s);
  });
});
