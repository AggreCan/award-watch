// May follow on an open notice's page (src/pages/follows.tsx, src/lines.ts;
// docs/accounts.md, May follow), against a local records database built from
// pipeline/records_schema.sql. While FOLLOWS_PANEL is anything but "on" (it
// ships "off"): the notice page is the same for every reader whatever
// rec_follows holds, its batch is the one it read before (the state row and
// the earlier awards, never rec_follows), and no page says a word of may
// follow, the Methodology and the Terms included. With it on: a reader not
// signed in gets the page as before; Free the closest earlier contract and a
// line on what each plan shows; Pro up to three, each holder with its label
// and figure; each state of the panel; the disclaimer with its links and the
// licence's credit; no chip or filled button added; the table within the
// column system at every width; a private page.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { FOLLOWS_SQL } from "../src/records_tables";
import { orgNumber } from "../src/records_db";
import { decode, get, grantPro, nbsp, newEmail, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { applySql } from "./setup";
import { expectTablesFit } from "./table-fit";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const A1 = "org-a000000001"; // Exemplar Translation Services Inc.
const A2 = "org-a000000002"; // Sample Harbour Marine Ltd.
const NOTICE = "/tenders/cb-100-10000001";
const OTHER = "/tenders/cb-200-20005019";

// -- the records: three earlier contracts of the first notice, none of the second ----------------------------

const LINE = {
  v: 1, fy: [2017, 2026], buyer: "dfo-mpo", oid: orgNumber(A1),
  s: [{ src: 1, lvl: "class", key: ["821118"], held: 2, run: 1, first: "2025-11-17", total: 28, others: 20, c: 2, nc: 0, u: 0 }],
  own: { comp: 1, meth: "ST", bids: null, amd: 0, growth: null, end0: "2026-10-23", end: "2026-10-23" }, sim: [],
};
const follow = (o: Record<string, unknown>) => JSON.stringify({
  v: 1, src: 1, ref: "cb-725-74465042", t: ["Translation services, regional offices, one (1) year", "Services de traduction, bureaux régionaux"],
  oid: orgNumber(A1), wh: 0, end: "2026-10-23", deg: "close", sol: null, num: null, buyer: "dfo-mpo", client: 1, lvl: "class",
  code: ["821118"], words: [7, 8], days: -70, from: "start", line: LINE, ...o,
});
const ROWS: [number, string, number, string][] = [
  [31, "cb-100-10000001", 1, follow({})],
  [32, "cb-100-10000001", 2, follow({
    ref: "cb-691-38891244", t: ["Translation services, regional offices", null], oid: orgNumber(A2), end: "2027-10-27", deg: "number",
    sol: "EN578-260001", client: 0, buyer: "pwgsc-tpsgc", words: [3, 9], days: 300,
    line: { ...LINE, oid: orgNumber(A2), s: [{ ...LINE.s[0], held: 3, run: 3, c: 3 }], sim: [["org-b000000001", "Sample Harbour Marine Limited", 1, 2, "2024-04-01"]] },
  })],
  [33, "cb-100-10000001", 3, follow({
    src: 2, ref: "w8472-000633", t: ["Translation of reports", "Traduction de rapports"], oid: null, wh: 1, end: "2027-03-28", deg: "partial",
    client: 0, buyer: "pwgsc-tpsgc", lvl: "family", code: ["8211"], words: [5, 9], days: 86, from: "pub", line: null,
  })],
];

async function seed(asOf = "2026-10-31"): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["rec_follows", "rec_meta", "rec_buyers", "rec_orgs"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.batch([
    ...ROWS.map(([k, tref, rank, j]) => RECORDS.prepare("INSERT INTO rec_follows (k, tref, rank, j) VALUES (?, ?, ?, ?)").bind(k, tref, rank, j)),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(asOf),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (101, 'pwgsc-tpsgc', 'Public Services and Procurement Canada', " +
      "'Services publics et Approvisionnement Canada'), (103, 'dfo-mpo', 'Fisheries and Oceans Canada', 'Pêches et Océans Canada')"),
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, 'Exemplar Translation Services Inc.'), (?, 'Sample Harbour Marine Ltd.')")
      .bind(orgNumber(A1), orgNumber(A2)),
  ]);
}
beforeAll(() => seed());

// A records binding that reads the database as if the nightly had not made rec_follows yet.
const withoutFollows = (db: D1Database): D1Database => ({
  prepare: (sql: string) => db.prepare(sql.replaceAll("rec_follows", "rec_follows_not_made")),
  batch: (s: D1PreparedStatement[]) => db.batch(s),
}) as unknown as D1Database;
// One that cannot answer.
const failing = { prepare: (sql: string) => RECORDS.prepare(sql), batch: () => Promise.reject(new Error("D1 timed out")) } as unknown as D1Database;
// One that keeps each batch's statements (a batch's are the last it prepared:
// records_db.ts readRecords prepares them as it builds the batch).
function recording(db: D1Database): { binding: D1Database; batches: string[][] } {
  const batches: string[][] = [];
  const prepared: string[] = [];
  return {
    binding: {
      prepare: (sql: string) => (prepared.push(sql), db.prepare(sql)),
      batch: (s: D1PreparedStatement[]) => (batches.push(prepared.splice(0).slice(-s.length)), db.batch(s)),
    } as unknown as D1Database,
    batches,
  };
}

// A shard where the second notice carries no code, so it reads no earlier awards.
const tenders = FILES["tenders/20a.json"] as Record<string, Record<string, unknown>>;
const uncoded = { ...tenders, "cb-200-20005019": { ...tenders["cb-200-20005019"], codes: [] } };

type O = { panel?: string | undefined; records?: D1Database; assets?: Fetcher };
const E = (o: O = {}) => onEnv({
  ...("panel" in o ? { FOLLOWS_PANEL: o.panel } : { FOLLOWS_PANEL: "on" }), ...("records" in o ? { RECORDS: o.records } : {}),
  ...(o.assets ? { ASSETS: o.assets } : {}),
});
// The switch as wrangler.jsonc ships it, the accounts switch on.
const OFF = (o: O = {}) => onEnv({ ...("records" in o ? { RECORDS: o.records } : {}), ...(o.assets ? { ASSETS: o.assets } : {}) });

let free = "";
let pro = "";
async function readers(): Promise<void> {
  if (pro) return;
  free = await signIn(newEmail("follows-free"), { env: E() });
  const email = newEmail("follows-pro");
  pro = await signIn(email, { env: E() });
  await grantPro(email);
}

const open = async (path: string, o: { env?: object; cookie?: string } = {}) => {
  const res = await get(path, { env: o.env ?? E(), cookie: o.cookie });
  return { res, html: decode(nbsp(await res.text())).replace(/’/g, "'") };
};
const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const panelOf = (html: string) => {
  const at = html.indexOf('<h2 id="follows">');
  return at < 0 ? "" : html.slice(html.lastIndexOf("<section", at), html.indexOf("</section>", at));
};
const rowsOf = (panel: string) => [...panel.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((m) => m[0]).filter((r) => r.includes("<td"));
const items = (html: string) => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
// Any word of may follow, in either language.
const WORDS = /may follow|May Follow|pourrait faire suite|Earlier Contract|earlier contracts|Contrats antérieurs|contrats antérieurs|follow-disclaimer|id="follows"/;
const DISCLAIMER = "Award Watch finds these contracts by matching numbers, codes and title words in public records. A match does not mean this notice replaces a contract, is not advice and may be wrong. See the Terms of Use.";
const CREDIT = "Contains information licensed under the Open Government Licence, Canada.";

describe("while the switch is off", () => {
  it("leaves the notice page the same for every reader whatever rec_follows holds, and reads no rec_follows", async () => {
    await readers();
    for (const path of [NOTICE, `${NOTICE}?lang=fr`, OTHER]) {
      for (const cookie of [undefined, free, pro]) {
        const filled = await get(path, { env: OFF(), cookie });
        const absent = await get(path, { env: OFF({ records: withoutFollows(RECORDS) }), cookie });
        const body = await filled.text();
        expect(filled.status, path).toBe(200);
        expect(body, `${path} ${cookie ? "signed in" : "signed out"}`).toBe(await absent.text());
        expect(decode(nbsp(body)), path).not.toMatch(WORDS);
      }
    }
    // The batch is the one the page read before: the state row and the earlier awards, for each reader.
    for (const cookie of [undefined, free, pro]) {
      const { binding, batches } = recording(RECORDS);
      await get(NOTICE, { env: OFF({ records: binding }), cookie });
      expect(batches.map((b) => b.length)).toEqual([2]);
      expect(batches.flat().join("\n")).not.toContain("rec_follows");
    }
    // A notice without a class reads no statement at all, as before.
    const { binding, batches } = recording(RECORDS);
    await get(OTHER, { env: OFF({ records: binding, assets: makeFakeAssets({}, { "tenders/20a.json": uncoded }) }), cookie: pro });
    expect(batches).toEqual([]);
  });

  it("says nothing of may follow on the Methodology or the Terms", async () => {
    for (const path of ["/methodology", "/methodology?lang=fr", "/terms", "/terms?lang=fr"]) {
      const { html } = await open(path, { env: OFF() });
      expect(html, path).not.toMatch(/may follow|pourrait faire suite|Earlier Contracts|contrats antérieurs|id="follows"/);
    }
    const terms = (await open("/terms", { env: OFF() })).html;
    expect(terms).toContain("such as the notices that match the records of the organization a reader names and a contract holder's earlier records with the same buyer.");
  });
});

describe("with the switch on", () => {
  it("leaves the page as it was for a reader not signed in, public and cached", async () => {
    for (const path of [NOTICE, `${NOTICE}?lang=fr`]) {
      const on = await get(path, { env: E() });
      const off = await get(path, { env: OFF() });
      expect(on.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(await on.text(), path).toBe(await off.text());
    }
    const { binding, batches } = recording(RECORDS);
    await get(NOTICE, { env: E({ records: binding }) });
    expect(batches.flat().join("\n")).not.toContain("rec_follows");
  });

  it("shows Free the closest earlier contract and what each plan shows, in the earlier awards' batch", async () => {
    await readers();
    const { binding, batches } = recording(RECORDS);
    const { res, html } = await open(NOTICE, { cookie: free, env: E({ records: binding }) });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(batches.map((b) => b.length)).toEqual([3]);
    expect(batches[0][2]).toBe(FOLLOWS_SQL);
    const panel = panelOf(html);
    expect(panel).toContain('<h2 id="follows">Earlier Contracts This Notice May Follow</h2>');
    expect(panel).toContain('<span class="panel-count">1</span>');
    expect(panel).toContain("Contracts of the same buyer whose numbers, codes or title match this notice's and that end near its expected start. A match of text and codes, not a statement that this notice replaces any of them.");
    const rows = rowsOf(panel);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('<a href="/awards/cb-725-74465042">Translation services, regional offices, one (1) year</a>');
    expect(rows[0]).toContain("Award notices · Ended 2026-10-23");
    expect(rows[0]).toContain('<a href="/organizations/org-a000000001">Exemplar Translation Services Inc.</a>');
    // Free's holder carries no record.
    expect(rows[0]).not.toContain("line-mark");
    expect(rows[0]).toContain("<strong>Close text match</strong>");
    expect(items(rows[0])).toEqual([
      "Same client department, Fisheries and Oceans Canada", "Same UNSPSC class, 821118", "Titles share 7 of 8 words",
      "End date 70 days before this notice's expected start",
    ]);
    expect(panel).toContain('The Free plan shows 1 earlier contract, the closest. Pro shows up to 3, each with its holder\'s record. <a href="/account/billing">Plans and prices</a>');
    expect(panel.replace(/<[^>]+>/g, "")).toContain(DISCLAIMER);
    expect(panel).toContain('<a href="/terms#warranty">Terms of Use</a>');
    expect(panel).toContain('<a href="/methodology#follows">How earlier contracts are matched</a>');
    expect(panel).toContain(CREDIT);
    // After the instruments' holders, before the earlier awards.
    const m = main(html);
    expect(m.indexOf('<h2 id="follows">')).toBeLessThan(m.indexOf("<h2>Earlier Awards Like This One</h2>"));
    expectTablesFit(html, "free notice");
  });

  it("shows Pro up to three, each named holder with its label and figure, the withheld one named by no one", async () => {
    await readers();
    const { html } = await open(NOTICE, { cookie: pro });
    const panel = panelOf(html);
    const rows = rowsOf(panel);
    expect(rows).toHaveLength(3);
    expect(panel).toContain('<span class="panel-count">3</span>');
    expect(rows[0]).toContain('<span class="muted small line-mark">Earlier records · 1 earlier</span>');
    expect(rows[1]).toContain('<span class="muted small line-mark">Long run · 3 back to back · similar name</span>');
    expect(rows[1]).toContain("<strong>Number match</strong>");
    expect(items(rows[1])).toEqual([
      "Same solicitation number, EN578-260001", "Same buyer, Public Services and Procurement Canada", "Same UNSPSC class, 821118",
      "Titles share 3 of 9 words", "End date 300 days after this notice's expected start",
    ]);
    expect(rows[1]).toContain("Award notices · Ends 2027-10-27");
    expect(rows[2]).toContain("Individual, name withheld");
    expect(rows[2]).not.toMatch(/organizations\/|line-mark/);
    expect(rows[2]).toContain('<a href="/history/w8472-000633">Translation of reports</a>');
    expect(items(rows[2])).toEqual([
      "Same buyer, Public Services and Procurement Canada", "Same UNSPSC family, 8211", "Titles share 5 of 9 words",
      "End date 86 days after this notice was published",
    ]);
    expect(panel).not.toContain("The Free plan shows");
    expectTablesFit(html, "pro notice");
    const fr = await open(`${NOTICE}?lang=fr`, { cookie: pro });
    const fp = panelOf(fr.html);
    expect(fp).toContain('<h2 id="follows">Contrats antérieurs auxquels cet avis pourrait faire suite</h2>');
    expect(rowsOf(fp)[0]).toContain('<span class="muted small line-mark">Dossiers antérieurs · 1 antérieur</span>');
    expect(items(rowsOf(fp)[0])).toEqual([
      "Même ministère client, Pêches et Océans Canada", "Même classe UNSPSC, 821118", "Les titres ont 7 mots sur 8 en commun",
      "Date de fin 70 jours avant le début prévu de cet avis",
    ]);
    expect(rowsOf(fp)[0]).toContain("Avis d'attribution · Terminé le 2026-10-23");
    expect(fp.replace(/<[^>]+>/g, "")).toContain("Award Watch trouve ces contrats en rapprochant les numéros, les codes et les mots des titres de dossiers publics. Un rapprochement ne signifie pas que cet avis remplace un contrat, ne constitue pas un conseil et peut être erroné. Voir les Conditions d'utilisation.");
    expect(fp).toContain('<a href="/terms?lang=fr#warranty">Conditions d\'utilisation</a>');
    expectTablesFit(fr.html, "pro notice fr");
  });

  it("adds no chip and no filled button", async () => {
    await readers();
    const count = (html: string, re: RegExp) => main(html).match(re)?.length ?? 0;
    for (const cookie of [free, pro]) {
      const shown = (await open(NOTICE, { cookie })).html;
      const before = (await open(NOTICE, { cookie, env: OFF() })).html;
      expect(shown).not.toBe(before);
      expect(count(shown, /class="pro-tag"/g)).toBe(count(before, /class="pro-tag"/g));
      expect(count(shown, /btn-primary/g)).toBe(count(before, /btn-primary/g));
    }
  });

  it("says when no earlier contract matches, or when the notice is newer than the records, and reads alone for a notice without a class", async () => {
    await readers();
    const assets = makeFakeAssets({}, { "tenders/20a.json": uncoded });
    const { binding, batches } = recording(RECORDS);
    const none = await open(OTHER, { cookie: pro, env: E({ records: binding, assets }) });
    expect(batches).toEqual([[expect.stringContaining("FROM rec_meta"), FOLLOWS_SQL]]);
    const panel = panelOf(none.html);
    expect(panel).toContain("<p class=\"muted\">No earlier contract of this buyer matches this notice's numbers, codes and title near its expected start.</p>");
    expect(panel).toContain("follow-disclaimer");
    expect(panel).not.toContain(CREDIT);
    expect(panel).not.toContain("panel-count");
    await seed("2026-10-29");
    try {
      const pending = await open(OTHER, { cookie: pro });
      expect(panelOf(pending.html)).toContain("Earlier contracts are matched each night: a notice first seen today is matched after the next nightly update.");
    } finally {
      await seed();
    }
  });

  it("says in a line when the database cannot answer, and leaves the page as it was without rec_follows", async () => {
    await readers();
    const down = await open(NOTICE, { cookie: free, env: E({ records: failing }) });
    expect(down.res.status).toBe(200);
    expect(panelOf(down.html)).toContain('<h2 id="follows">Earlier Contracts This Notice May Follow</h2></div><p class="muted">Earlier contracts are not available right now.</p>');
    for (const cookie of [free, pro]) {
      const absent = await get(NOTICE, { cookie, env: E({ records: withoutFollows(RECORDS) }) });
      const off = await get(NOTICE, { cookie, env: OFF() });
      const body = await absent.text();
      expect(body).toBe(await off.text());
      expect(body).toContain("Earlier Awards Like This One");
    }
  });

  it("reads nothing for a closed notice", async () => {
    await readers();
    const shard = { ...tenders, "cb-100-10000001": { ...tenders["cb-100-10000001"], closing: "2026-10-20T14:00:00", status: "expired" } };
    const { binding, batches } = recording(RECORDS);
    const { html } = await open(NOTICE, { cookie: pro, env: E({ records: binding, assets: makeFakeAssets({}, { "tenders/20a.json": shard }) }) });
    expect(batches).toEqual([]);
    expect(html).not.toMatch(WORDS);
  });

  it("reads rec_follows through its index, bounded to three", async () => {
    expect(FOLLOWS_SQL).toMatch(/LIMIT 3$/);
    const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${FOLLOWS_SQL}`).bind("cb-100-10000001").all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    expect(steps.join("\n")).toContain("rec_follows_tref");
    expect(steps.filter((s) => /^SCAN (f|rec_follows)\b/.test(s)), steps.join("\n")).toEqual([]);
  });

  it("names may follow on the Methodology, its figures from the constants, and in the Terms", async () => {
    const html = (await open("/methodology", { env: E() })).html;
    const toc = /<nav class="toc"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(toc).toContain('<a href="#holders">Holder\'s Record and Earlier Contracts</a>');
    expect(html).toContain('<h2 id="holders">Holder\'s Record and Earlier Contracts</h2>');
    const para = /<p id="follows">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    for (const part of ["awarded in the last 10 fiscal years", "at least 50% of their distinct words", "between 180 days before and 120 days after",
      "close from 75% of the words, partial from 50%", "Up to 3 contracts are kept"]) {
      expect(para, part).toContain(part);
    }
    const fr = decode(nbsp(await (await get("/methodology?lang=fr", { env: E() })).text())).replace(/’/g, "'");
    expect(fr).toContain('<h2 id="holders">Dossiers du titulaire et contrats antérieurs</h2>');
    expect(fr).toContain("au moins 50 % de leurs mots distincts");
    const terms = (await open("/terms", { env: E() })).html;
    expect(terms).toContain("a contract holder's earlier records with the same buyer and the earlier contracts an open notice may follow.");
    const termsFr = decode(nbsp(await (await get("/terms?lang=fr", { env: E() })).text())).replace(/’/g, "'");
    expect(termsFr).toContain("et les contrats antérieurs auxquels un avis ouvert pourrait faire suite.");
  });
});
