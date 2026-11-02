// Hosted search against a real local D1 database: pipeline/search_schema.sql
// applied below (its full-text indexes and the triggers that fill them), then
// rows inserted the way the nightly sync writes them. The query builder with
// injection payloads, the ranking, the page and its fallbacks, the top bar's
// field on every page, the limiter's bucket and the views' route.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import {
  ANY_ROW_SQL, BUYER_COUNT_SQL, BUYER_SELECT_SQL, MAX_TERMS, ORG_COUNT_SQL, ORG_SELECT_SQL, PAGE_SIZE, buyerSelect, counts,
  faultSummary, foldText, ftsExpression, lineMatches, orgSelect, runSearch, searchTerms,
} from "../src/search_db";
import { routeTemplate } from "../src/views";
import { applySql } from "./setup";
import { testEnv } from "./assets";

const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const SCHEMA = (env as unknown as { SEARCH_SCHEMA_SQL: string }).SEARCH_SCHEMA_SQL;

let address = 0;
const get = (path: string, e: object = testEnv(), headers: Record<string, string> = {}) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.19.1.${(address++ % 250) + 1}`, ...headers } }, e);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const EM_DASH = String.fromCharCode(0x2014);

interface Org {
  id: string; name: string; alt?: string; bn?: string; prov?: string; city?: string | null; records: number;
}

const ORGS: Org[] = [
  { id: "org-a000000001", name: "Exemplar Translation Services Inc.", alt: "Exemplar Traduction Inc.\nXMPLR Language Group", bn: "123456782", prov: "ON", city: "Ottawa", records: 12 },
  { id: "org-a000000002", name: "Exemplar", prov: "XX", city: "London", records: 1 },
  { id: "org-a000000003", name: "Exemplary Cleaning Ltd", prov: "BC", city: "Victoria", records: 50 },
  { id: "org-a000000004", name: "The Exemplar Group", prov: "UN", city: null, records: 99 },
  { id: "org-a000000005", name: "Northwind Holdings", alt: "Exemplar Holdings Old Name", prov: "AB", city: "Calgary", records: 500 },
  { id: "org-a000000006", name: "Exemplar Labs", prov: "QC", city: "Montréal", records: 30 },
  { id: "org-a000000007", name: "Ferme Éloïse Québec Inc.", prov: "QC", city: "Lévis", records: 3 },
  { id: "org-a000000008", name: `O'Brien "Quoted" <b>Bold</b> & Sons Ltd.`, prov: "NS", city: "Halifax", records: 2 },
  ...Array.from({ length: 120 }, (_, i): Org => ({
    id: `org-b${String(i).padStart(9, "0")}`, name: `Filler Holdings ${String(i).padStart(3, "0")}`, prov: "MB", city: "Brandon",
    records: i % 7,
  })),
];

const BUYERS = [
  {
    id: "dnd-mdn", name: "National Defence", name_fr: "Défense nationale", acronym_en: "DND", acronym_fr: "MDN",
    alt: "DND\nMDN\ndepartment-of-national-defence\nDepartment of National Defence (DND)", open: 2, records: 40,
  },
  {
    id: "pwgsc-tpsgc", name: "Public Services and Procurement Canada", name_fr: "Services publics et Approvisionnement Canada",
    acronym_en: "PSPC", acronym_fr: "SPAC", alt: "PSPC\nSPAC\nPublic Works and Government Services Canada", open: 5, records: 900,
  },
];

async function seed(): Promise<void> {
  await applySql(SEARCH, SCHEMA);
  await SEARCH.batch([SEARCH.prepare("DELETE FROM search_orgs"), SEARCH.prepare("DELETE FROM search_buyers")]);
  const orgSql = "INSERT INTO search_orgs (id, name, alt, bn, folds, prov, city, n_awards, n_history, n_contracts, n_grants, " +
    "n_lobbying, n_records, total_awards, total_history, total_contracts, total_grants, hash) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 1, ?, ?, NULL, ?, NULL, 'h')";
  await SEARCH.batch(ORGS.map((o) => SEARCH.prepare(orgSql).bind(
    o.id, o.name, o.alt ?? "", o.bn ?? "", foldText(o.name), o.prov ?? "UN", o.city ?? null, Math.max(o.records - 1, 0), 0,
    o.records, o.records * 1000.5, null)));
  const buyerSql = "INSERT INTO search_buyers (id, name, name_fr, acronym_en, acronym_fr, alt, folds, kind, n_tenders, " +
    "n_open_tenders, n_awards, n_history, n_contracts, n_grants, n_records, total_awards, total_history, total_contracts, " +
    "total_grants, hash) VALUES (?, ?, ?, ?, ?, ?, ?, 'department', 1, ?, ?, 0, 0, 0, ?, ?, NULL, NULL, NULL, 'h')";
  await SEARCH.batch(BUYERS.map((b) => SEARCH.prepare(buyerSql).bind(
    b.id, b.name, b.name_fr, b.acronym_en, b.acronym_fr, b.alt,
    [b.name, b.name_fr, b.acronym_en, b.acronym_fr].map(foldText).join("\n"), b.open, b.records - 1, b.records, 2_500_000)));
}

beforeAll(seed);

const tableCounts = async () => {
  const row = await SEARCH.prepare("SELECT (SELECT COUNT(*) FROM search_orgs) AS orgs, (SELECT COUNT(*) FROM search_buyers) AS buyers").first();
  return row as { orgs: number; buyers: number };
};

// Text a visitor might send to break out of the quoted phrases or the statement.
const PAYLOADS = [
  `"`, `""`, `' OR 1=1 --`, `'; DROP TABLE search_orgs; --`, `ibm" OR "a`, `name:ibm`, `alt : exemplar`, `{name alt}: x`,
  `NEAR(exemplar translation)`, `NEAR(a b, 2)`, `exemplar*`, `*`, `^exemplar`, `-exemplar`, `exemplar AND NOT group`,
  `(exemplar OR filler)`, `exemplar)`, `)(`, `\\`, `%_%`, `\u0000exemplar`, `exem​plar`, `ＥＸＥＭＰＬＡＲ`, `Québec`,
  `𝔢𝔵𝔢𝔪𝔭𝔩𝔞𝔯`, `😀 exemplar`, `שלום exemplar`, `<script>alert(1)</script>`, `a`.repeat(5000),
  Array.from({ length: 40 }, (_, i) => `w${i}`).join(" "), `1=1`, `?`, `?1`, `:1`, `@x`, `$x`, `char(10)`,
];

describe("the query builder", () => {
  it("folds as the pipeline does", () => {
    // pipeline/tests/test_search_db.py test_fold_is_the_sites_fold holds the same pairs.
    expect(foldText("Ferme Éloïse Québec Inc.")).toBe("ferme eloise quebec inc");
    expect(foldText("O'Brien & Sons, Ltd.")).toBe("o brien sons ltd");
    expect(foldText("  IBM_Canada  ")).toBe("ibm canada");
    expect(foldText("--")).toBe("");
  });

  it("keeps only words of letters and digits, at most eight, and quotes each", () => {
    expect(searchTerms("Tim Horton's (Canada)")).toEqual({ terms: ["tim", "horton", "s", "canada"], folded: "tim horton s canada" });
    expect(ftsExpression(["tim", "horton"])).toBe('"tim" "horton"*');
    // A one-letter last word is matched whole: a one-letter prefix lists every word with that letter.
    expect(ftsExpression(["tim", "h"])).toBe('"tim" "h"');
    expect(ftsExpression(["ibm"], "name")).toBe('name : "ibm"*');
    expect(ftsExpression(["ibm", "canada"], "{name name_fr}")).toBe('{name name_fr} : "ibm" {name name_fr} : "canada"*');
    expect(ftsExpression([])).toBe("");
    expect(searchTerms("a b c d e f g h i j").terms).toHaveLength(MAX_TERMS);
  });

  it("turns every injection payload into quoted words or nothing", () => {
    const phrase = /^"[\p{L}\p{N}]+"\*?$/u;
    for (const p of PAYLOADS) {
      const t = searchTerms(p);
      expect(t.terms.length, p).toBeLessThanOrEqual(MAX_TERMS);
      for (const term of t.terms) expect(term, p).toMatch(/^[\p{L}\p{N}]+$/u);
      const expr = ftsExpression(t.terms);
      if (expr) for (const part of expr.split(" ")) expect(part, p).toMatch(phrase);
      // Nothing a request holds reaches the SQL text: the statements are constants.
      const stmts = t.terms.length ? [orgSelect(t, 2), buyerSelect(t), ...counts(t)] : [];
      for (const s of stmts) {
        expect([ORG_SELECT_SQL, BUYER_SELECT_SQL, ORG_COUNT_SQL, BUYER_COUNT_SQL]).toContain(s.sql);
        for (const v of s.params) expect(["string", "number"]).toContain(typeof v);
      }
    }
    expect(searchTerms(`NEAR(exemplar translation)`).terms).toEqual(["near", "exemplar", "translation"]);
    expect(searchTerms(`name:ibm`).terms).toEqual(["name", "ibm"]);
    expect(searchTerms(`"`).terms).toEqual([]);
    expect(searchTerms(`\u0000exemplar`).terms).toEqual(["exemplar"]);
    for (const sql of [ORG_SELECT_SQL, BUYER_SELECT_SQL, ORG_COUNT_SQL, BUYER_COUNT_SQL, ANY_ROW_SQL]) {
      expect(sql).not.toMatch(/exemplar|drop|script|near\(/i);
    }
  });

  it("caps the page and binds the offset as a number", () => {
    const t = searchTerms("exemplar");
    expect(orgSelect(t, 1).params.slice(-2)).toEqual([PAGE_SIZE, 0]);
    expect(orgSelect(t, 3).params.slice(-2)).toEqual([PAGE_SIZE, 100]);
    expect(orgSelect(t, 10_000).params.slice(-1)[0]).toBe(199 * PAGE_SIZE);
    expect(orgSelect(t, -4).params.slice(-1)[0]).toBe(0);
    expect(orgSelect(t, Number.NaN).params.slice(-1)[0]).toBe(0);
  });

  it("names the spelling that holds every word", () => {
    expect(lineMatches("Exemplar Holdings Old Name", ["exemplar", "hold"])).toBe(true);
    expect(lineMatches("Exemplar Holdings Old Name", ["hold", "exemplar"])).toBe(false);
    expect(lineMatches("Québec Inc.", ["quebec"])).toBe(true);
    expect(lineMatches("anything", [])).toBe(false);
  });

  it("logs a failure without the visitor's text", () => {
    const summary = faultSummary(new Error('D1_ERROR: fts5: syntax error near "secret words": SQLITE_ERROR'));
    expect(summary).toBe("SQLITE_ERROR, syntax error");
    expect(summary).not.toContain("secret");
  });
});

describe("the search database", () => {
  it("ranks the exact name, then a leading name, then a name holding the words, then other spellings", async () => {
    const res = await runSearch(testEnv(), searchTerms("Exemplar"), 1);
    expect(res).not.toBeNull();
    const r = res!;
    expect(r.orgs.map((o) => [o.id, o.tier])).toEqual([
      ["org-a000000002", 0],
      // Two names that start with the word: more records first.
      ["org-a000000006", 1],
      ["org-a000000001", 1],
      ["org-a000000003", 2],
      ["org-a000000004", 3],
      ["org-a000000005", 4],
    ]);
    expect(r.orgTotal).toBe(6);
    expect(r.orgs[5].also).toBe("Exemplar Holdings Old Name");
    expect(r.orgs.slice(0, 5).every((o) => o.also === null)).toBe(true);
  });

  it("finds a business number, an accent-free spelling and a buyer by acronym or old id", async () => {
    const bn = (await runSearch(testEnv(), searchTerms("123456782"), 1))!;
    expect(bn.orgs.map((o) => [o.id, o.bn])).toEqual([["org-a000000001", "123456782"]]);
    const quebec = (await runSearch(testEnv(), searchTerms("quebec eloise"), 1))!;
    expect(quebec.orgs.map((o) => o.id)).toEqual(["org-a000000007"]);
    const dnd = (await runSearch(testEnv(), searchTerms("DND"), 1))!;
    expect(dnd.buyers.map((b) => [b.id, b.tier])).toEqual([["dnd-mdn", 0]]);
    const old = (await runSearch(testEnv(), searchTerms("department of national defence"), 1))!;
    expect(old.buyers.map((b) => b.id)).toEqual(["dnd-mdn"]);
    const works = (await runSearch(testEnv(), searchTerms("public works"), 1))!;
    expect(works.buyers.map((b) => [b.id, b.also])).toEqual([["pwgsc-tpsgc", "Public Works and Government Services Canada"]]);
    const french = (await runSearch(testEnv(), searchTerms("défense nationale"), 1))!;
    expect(french.buyers.map((b) => [b.id, b.tier])).toEqual([["dnd-mdn", 0]]);
  });

  it("pages organizations 50 at a time and shows the last page past the end", async () => {
    const one = (await runSearch(testEnv(), searchTerms("filler"), 1))!;
    expect([one.orgTotal, one.pages, one.page, one.orgs.length]).toEqual([120, 3, 1, 50]);
    const three = (await runSearch(testEnv(), searchTerms("filler"), 3))!;
    expect([three.page, three.orgs.length, three.buyers.length]).toEqual([3, 20, 0]);
    const past = (await runSearch(testEnv(), searchTerms("filler"), 99))!;
    expect([past.page, past.orgs.length]).toEqual([3, 20]);
    const seen = new Set([...one.orgs, ...(await runSearch(testEnv(), searchTerms("filler"), 2))!.orgs, ...three.orgs].map((o) => o.id));
    expect(seen.size).toBe(120);
  });

  it("answers every injection payload without an error and changes nothing", async () => {
    const before = await tableCounts();
    for (const p of PAYLOADS) {
      const t = searchTerms(p);
      if (!t.terms.length) continue;
      const res = await runSearch(testEnv(), t, 1);
      expect(res, p).not.toBeNull();
    }
    expect(await tableCounts()).toEqual(before);
  });
});

describe("/search", () => {
  it("renders both panels, the counts and the query as text", async () => {
    const res = await get("/search?q=exemplar");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const html = await res.text();
    expect(html).toContain("<h1>Search: exemplar</h1>");
    expect(html).toContain("6 organizations and 0 buyers match.");
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).toContain('<a href="/organizations/org-a000000002">Exemplar</a>');
    expect(html).toContain("Also recorded as: Exemplar Holdings Old Name");
    expect(html).toContain("London, Outside Canada");
    expect(html).toContain("No address recorded");
    expect(html).toContain("1 to 6 of 6");
    expect(html).not.toContain(EM_DASH);
    // The top bar's field holds the query.
    expect(html).toContain('<input type="search" name="q" value="exemplar" maxlength="200" autocomplete="off" placeholder="Search organizations and buyers"');
  });

  it("lists the buyers with their figures and links", async () => {
    const html = await (await get("/search?q=canada")).text();
    expect(html).toContain('<a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a>');
    expect(html).toContain('<a href="/tenders?buyer=pwgsc-tpsgc">5</a>');
    expect(html).toContain("$2,500,000");
    const fr = nbsp(await (await get("/search?q=canada&lang=fr")).text());
    expect(fr).toContain("<h1>Recherche : canada</h1>");
    expect(fr).toContain('<a href="/buyers/pwgsc-tpsgc">Services publics et Approvisionnement Canada</a>');
    expect(fr).toContain('placeholder="Rechercher des organisations et des acheteurs"');
    expect(fr).not.toContain("Search organizations and buyers");
  });

  it("escapes the query wherever it is echoed", async () => {
    const res = await get(`/search?q=${encodeURIComponent(`<script>alert(1)</script> exemplar`)}`);
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; exemplar");
    const quoted = await (await get(`/search?q=${encodeURIComponent("O'Brien")}`)).text();
    expect(quoted).toContain("O&#39;Brien &quot;Quoted&quot; &lt;b&gt;Bold&lt;/b&gt; &amp; Sons Ltd.");
  });

  it("pages with links that carry the query", async () => {
    const html = await (await get("/search?q=filler")).text();
    expect(html).toContain("1 to 50 of 120");
    expect(html).toContain('<a href="/search?q=filler&amp;page=2" class="btn" rel="next">Next</a>');
    const two = await (await get("/search?q=filler&page=2")).text();
    expect(two).toContain("51 to 100 of 120");
    expect(two).toContain('<a href="/search?q=filler" class="btn" rel="prev">Previous</a>');
    const past = await (await get("/search?q=filler&page=77")).text();
    expect(past).toContain("101 to 120 of 120");
    for (const bad of ["abc", "-1", "1e9", "99999"]) {
      expect((await get(`/search?q=filler&page=${bad}`)).status, bad).toBe(200);
    }
  });

  it("answers every injection payload with a page and no server error", async () => {
    const before = await tableCounts();
    for (const p of PAYLOADS) {
      const res = await get(`/search?q=${encodeURIComponent(p)}`);
      expect(res.status, p).toBe(200);
      const html = await res.text();
      expect(html, p).not.toContain("<script>alert");
    }
    expect(await tableCounts()).toEqual(before);
  });

  it("explains an empty query and one with no letter or digit", async () => {
    const empty = await get("/search");
    expect(empty.status).toBe(200);
    const html = await empty.text();
    expect(html).toContain("<h1>Search Organizations and Buyers</h1>");
    expect(html).toContain('<a href="/organizations">organization directory</a>');
    expect(html).not.toContain("A search needs at least one letter or digit.");
    expect(await (await get("/search?q=%22%28%29%2A")).text()).toContain("A search needs at least one letter or digit.");
  });

  it("says when nothing matches", async () => {
    const html = await (await get("/search?q=zzyzx")).text();
    expect(html).toContain("No organization or buyer name matches “zzyzx”.");
    expect(html).toContain('<a href="/buyers">list of federal buyers</a>');
  });

  it("sends an organization id to its profile", async () => {
    const res = await get("/search?q=ORG-A000000001");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/organizations/org-a000000001");
  });

  it("explains and links the directory when the database is missing, empty or failing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = { ...testEnv(), SEARCH: undefined };
    const empty = {
      ...testEnv(),
      SEARCH: {
        prepare: () => ({ bind: () => ({ first: async () => ({ n: 0 }), all: async () => ({ results: [] }) }), first: async () => ({ n: 0 }) }),
        batch: async () => [{ results: [{ n: 0 }] }, { results: [{ n: 0 }] }, { results: [] }, { results: [] }],
      },
    };
    const failing = {
      ...testEnv(),
      SEARCH: {
        prepare: () => ({ bind: () => ({}) }),
        batch: async () => { throw new Error('D1_ERROR: fts5: syntax error near "exemplar": SQLITE_ERROR'); },
      },
    };
    for (const e of [missing, empty, failing]) {
      const res = await get("/search?q=exemplar", e);
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      expect(html).toContain("<h1>Search Is Unavailable</h1>");
      expect(html).toContain('<a href="/organizations">organization directory</a>');
      expect(html).toContain('<a href="/buyers">list of federal buyers</a>');
    }
    expect(error.mock.calls.flat().join(" ")).not.toContain("exemplar");
    error.mockRestore();
  });
});

describe("the top bar and the counters", () => {
  it("puts the search field on every page, in the page's language", async () => {
    for (const path of ["/", "/tenders", "/organizations", "/methodology", "/nothing-here"]) {
      const html = await (await get(path)).text();
      expect(html, path).toContain('<form class="topbar-search" method="get" action="/search" role="search">');
      expect(html, path).toContain('placeholder="Search organizations and buyers"');
      expect(html.indexOf("brand-lockup"), path).toBeLessThan(html.indexOf("topbar-search"));
      expect(html.indexOf("topbar-search"), path).toBeLessThan(html.indexOf("topbar-meta"));
    }
    const fr = await (await get("/?lang=fr")).text();
    expect(fr).toContain('aria-label="Rechercher des organisations et des acheteurs par nom ou par numéro d’entreprise"');
  });

  it("counts /search as a page for the limiter and the views", () => {
    expect(bucketFor("GET", "/search")).toBe("page");
    expect(routeTemplate("GET", "/search")).toEqual({ route: "/search", kind: "page" });
  });
});
