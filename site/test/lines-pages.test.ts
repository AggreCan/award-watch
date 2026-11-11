// The holder's record on the pages (src/pages/expiring.tsx radarLines,
// src/lines_view.tsx, src/pages/holders.tsx; docs/accounts.md, Holder's
// record), against a local records database built from
// pipeline/records_schema.sql. A reader not signed in gets the contract
// pages as they were, byte for byte whatever rec_lines holds, and on a
// radar window's page one line more; a Free reader the marks of the rows
// ending within 91 days, Pro within 365; a contract's page the panel in each
// of its states; a records database without rec_lines yet the pages as they
// were. Every surface showing a record carries the disclaimer, its link to
// the Terms' No Warranty section and the licence's credit; none adds a chip
// or a filled button; every page carrying a record is private.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ExpiringRow } from "../src/data";
import { LINES_BY_KEY_SQL, LINE_BY_KEY_SQL } from "../src/records_tables";
import { orgNumber } from "../src/records_db";
import { decode, get, grantPro, nbsp, newEmail, offEnv, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import { applySql } from "./setup";
import { expectTablesFit } from "./table-fit";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const A1 = "org-a000000001"; // Exemplar Translation Services Inc.
const A2 = "org-a000000002"; // Sample Harbour Marine Ltd.
const AWARD = "/awards/cb-400-40000004";
const PUBLISHED = "/contracts/dnd-mdn/C-2026-0042";

// -- the files: the fixtures' 3-month window, and 6- and 12-month windows with rows at the plans' edges ----------

const base = FILES["expiring/3m/1.json"] as ExpiringRow[];
const awardRow = base.find((r) => r.kind === "award")!;
const row = (reference: string, end: string, days: number, org = A1): ExpiringRow =>
  ({ ...awardRow, reference, end, days_left: days, organization_id: org, tender_reference: null } as ExpiringRow);
const R91 = row("r6-91", "2027-01-30", 91);
const R92 = row("r6-92", "2027-01-31", 92);
const R365 = row("r12-365", "2027-10-31", 365, A2);
const window = (name: string, rows: ExpiringRow[]) => ({
  [`expiring/${name}/index.json`]: { window: name, pages: 1, rows: rows.length, total: 1_000_000 },
  [`expiring/${name}/1.json`]: rows,
});
const contracts = FILES["contracts/637.json"] as Record<string, Record<string, unknown>>;
// The award notice's page as the radar row reads it: ending in 20 days, or in 107 (past Free's 91).
const shard = (end: string) => ({ ...contracts, "award:cb-400-40000004": { ...contracts["award:cb-400-40000004"], end } });
const FILES_ON = { ...window("6m", [...base, R91, R92]), ...window("12m", [...base, R91, R92, R365]) };
const assets = (end = "2026-11-20") => makeFakeAssets({}, { ...FILES_ON, "contracts/637.json": shard(end) });

// A records binding that reads the database as if the nightly had not made rec_lines yet.
const withoutLines = (db: D1Database): D1Database => ({
  prepare: (sql: string) => db.prepare(sql.replaceAll("rec_lines", "rec_lines_not_made")),
  batch: (s: D1PreparedStatement[]) => db.batch(s),
}) as unknown as D1Database;
// One that cannot answer.
const failing = { prepare: (sql: string) => RECORDS.prepare(sql), batch: () => Promise.reject(new Error("D1 timed out")) } as unknown as D1Database;
// One that counts its batches and their statements.
function counting(db: D1Database): { binding: D1Database; batches: number[] } {
  const batches: number[] = [];
  return { binding: { prepare: (sql: string) => db.prepare(sql), batch: (s: D1PreparedStatement[]) => (batches.push(s.length), db.batch(s)) } as unknown as D1Database, batches };
}

const E = (o: { end?: string; records?: D1Database | undefined } = {}) =>
  onEnv({ ASSETS: assets(o.end), ...("records" in o ? { RECORDS: o.records } : {}) });
const OFF = (o: { records?: D1Database } = {}) => ({ ...testEnv(assets()), ...("records" in o ? { RECORDS: o.records } : {}) });

// -- the records ------------------------------------------------------------------------

const j = (o: Record<string, unknown>) => JSON.stringify({
  v: 1, fy: [2017, 2026], buyer: "pwgsc-tpsgc", oid: orgNumber(A1),
  s: [{ src: 1, lvl: "class", key: ["821118"], held: 9, run: 1, first: "2026-04-27", total: 43, others: 17, c: 9, nc: 0, u: 0 }],
  own: { comp: 1, meth: "OB", bids: null, amd: 2, growth: 0.25, end0: "2026-09-30", end: "2026-11-20" }, sim: [], ...o,
});
const LINES: [number, string, string][] = [
  [11, "award:cb-400-40000004", j({})],
  [12, "contract:dnd-mdn:c-2026-0042", j({
    buyer: "dnd-mdn", oid: orgNumber(A2), s: [{ src: 3, lvl: "code", key: ["N583"], held: 1, run: 1, first: "2025-02-01", total: 10, others: 1, c: 0, nc: 1, u: 0 }],
    own: { comp: null, meth: "TN", bids: 1, amd: 1, growth: -0.1, end0: "2026-12-31", end: "2027-01-20" },
    sim: [["org-b000000001", "Sample Harbour Marine Limited", 3, 9, "2024-04-01"]],
  })],
  [13, "award:r6-91", j({ s: [{ src: 1, lvl: "class", key: ["821118"], held: 4, run: 4, first: "2022-04-01", total: 6, others: 1, c: 4, nc: 0, u: 0 }] })],
  [14, "award:r6-92", j({})],
  [15, "award:r12-365", j({ oid: orgNumber(A2) })],
];

async function seed(): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["rec_lines", "rec_meta", "rec_buyers", "rec_orgs", "rec_contracts"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.batch([
    ...LINES.map(([k, sk, text]) => RECORDS.prepare("INSERT INTO rec_lines (k, sk, j) VALUES (?, ?, ?)").bind(k, sk, text)),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', '2026-10-31'), ('rules', '2')"),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (101, 'pwgsc-tpsgc', 'Public Services and Procurement Canada', " +
      "'Services publics et Approvisionnement Canada'), (102, 'dnd-mdn', 'National Defence', 'Défense nationale')"),
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, 'Exemplar Translation Services Inc.'), (?, 'Sample Harbour Marine Ltd.')")
      .bind(orgNumber(A1), orgNumber(A2)),
    RECORDS.prepare("INSERT INTO rec_contracts (k, dept, ref, pid, bid, oid, wh, cdate, start, endd, value, orig, proc, comp, ctype, gsin, inst, bids, " +
      "desc_en, desc_fr) VALUES (21, 'dnd-mdn', 'C-2026-0042', NULL, 102, ?, 0, '2025-01-15', '2025-02-01', '2027-01-20', 450000000, 500000000, 'TN', 0, " +
      "'S', 'N5830', 'C', 1, 'Satellite communications terminal maintenance', 'Entretien de terminaux')").bind(orgNumber(A2)),
  ]);
}
beforeAll(() => seed());

let free = "";
let pro = "";
async function readers(): Promise<void> {
  if (pro) return;
  free = await signIn(newEmail("lines-free"), { env: E() });
  const email = newEmail("lines-pro");
  pro = await signIn(email, { env: E() });
  await grantPro(email);
}

const open = async (path: string, o: { env?: object; cookie?: string } = {}) => {
  const res = await get(path, { env: o.env ?? E(), cookie: o.cookie });
  return { res, html: decode(nbsp(await res.text())).replace(/’/g, "'") };
};
const main = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const marks = (html: string) => [...html.matchAll(/<span class="muted small line-mark">([^<]*)<\/span>/g)].map((m) => m[1]);
// The table row of a radar reference, as the row shows it.
const rowOf = (html: string, ref: string) => [...html.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((m) => m[0]).find((r) => r.includes(`>${ref}<`)) ?? "";
const SIGNED_OUT = "Signed-in readers see each holder's record with the buyer under its name.";
const DISCLAIMER = "Award Watch counts these records from public files. The counts and their labels are not advice and may be wrong or incomplete. See the Terms of Use.";
const CREDIT = "Contains information licensed under the Open Government Licence, Canada.";

function carriesDisclaimer(html: string, why: string, lang: "en" | "fr" = "en") {
  const m = main(html);
  if (lang === "en") {
    expect(m.replace(/<[^>]+>/g, ""), why).toContain(DISCLAIMER);
    expect(m, why).toContain('<a href="/terms#warranty">Terms of Use</a>');
    expect(m, why).toContain('<a href="/methodology#holders">How the holder\'s record is counted</a>');
    expect(m, why).toContain(CREDIT);
  } else {
    expect(m.replace(/<[^>]+>/g, ""), why).toContain("Award Watch compte ces dossiers à partir de fichiers publics. Les nombres et leurs libellés ne constituent pas un conseil et peuvent être erronés ou incomplets. Voir les Conditions d'utilisation.");
    expect(m, why).toContain('<a href="/terms?lang=fr#warranty">Conditions d\'utilisation</a>');
    expect(m, why).toContain("Contient des informations visées par la Licence du gouvernement ouvert, Canada.");
  }
}

describe("a reader not signed in", () => {
  it("gets each contract page byte for byte as it was, whatever rec_lines holds, and the published contract in one batch of three", async () => {
    for (const path of [AWARD, PUBLISHED, `${AWARD}?lang=fr`]) {
      for (const environment of [E, OFF]) {
        const filled = await get(path, { env: environment() });
        const absent = await get(path, { env: environment({ records: withoutLines(RECORDS) }) });
        expect(filled.status, path).toBe(200);
        expect(filled.headers.get("cache-control"), path).toBe("public, max-age=300");
        const body = await filled.text();
        expect(body, path).toBe(await absent.text());
        expect(body, path).not.toMatch(/Holder&#39;s Record|Dossiers du titulaire|line-mark|line-signin|line-disclaimer/);
      }
    }
    const { binding, batches } = counting(RECORDS);
    await get(PUBLISHED, { env: E({ records: binding }) });
    expect(batches).toEqual([3]);
  });

  it("gets one line more on a radar window's page, the same for everyone, and the page stays public", async () => {
    for (const path of ["/expiring/3m", "/expiring/6m", "/expiring/12m", "/expiring/3m?lang=fr"]) {
      const { res, html } = await open(path);
      expect(res.headers.get("cache-control"), path).toBe("public, max-age=300");
      expect(res.headers.get("vary"), path).toBe("Cookie");
      expect(html.match(/class="muted small line-signin"/g), path).toHaveLength(1);
      expect(marks(html), path).toEqual([]);
      expect(html, path).not.toMatch(/line-disclaimer|Under each holder/);
      if (path.endsWith("fr")) {
        expect(html, path).toContain("Les lecteurs connectés voient, sous le nom de chaque titulaire, ses dossiers auprès de l'acheteur. <a href=\"/account/sign-in\">Se connecter</a>");
      } else {
        expect(html, path).toContain(`${SIGNED_OUT} <a href="/account/sign-in">Sign in</a>`);
      }
    }
    // The overview gets nothing, and neither does any page while the switch is off.
    expect((await open("/expiring")).html).not.toContain("line-signin");
    for (const path of ["/expiring/3m", "/expiring/6m"]) expect((await open(path, { env: OFF() })).html).not.toContain("line-signin");
  });
});

describe("a Free reader", () => {
  it("sees the mark of each row ending within 91 days whose holder is named, and none past", async () => {
    await readers();
    const { res, html } = await open("/expiring/6m", { cookie: free });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // The free view of the 6-month window: its five rows, marked to 91 days.
    expect(rowOf(html, "cb-400-40000004")).toContain('<span class="muted small line-mark">Earlier records · 8 earlier</span>');
    expect(rowOf(html, "C-2026-0042")).toContain('<span class="muted small line-mark">No earlier record · similar name</span>');
    expect(rowOf(html, "r6-91")).toContain('<span class="muted small line-mark">Long run · 4 back to back</span>');
    expect(rowOf(html, "r6-92")).not.toContain("line-mark");
    // The withheld supplier's row is never asked for.
    expect(rowOf(html, "W8472-000777")).not.toContain("line-mark");
    expect(marks(html)).toHaveLength(3);
    expect(html).toContain("Under each holder's name: its record with the buyer for the same kind of work over the last 10 fiscal years.");
    carriesDisclaimer(html, "free 6m");
    expect(html).not.toContain("line-signin");
    // The mark sits under the holder's name, in the cell the table already has.
    expect(rowOf(html, "cb-400-40000004")).toMatch(/<a href="\/organizations\/org-a000000001">Exemplar Translation Services Inc\.<\/a><br\/?><span class="muted small line-mark">/);
    const three = await open("/expiring/3m", { cookie: free });
    expect(marks(three.html)).toEqual(["Earlier records · 8 earlier", "No earlier record · similar name"]);
  });

  it("sees the panel on a contract's page ending within 91 days, and the plans' line past it", async () => {
    await readers();
    const ready = await open(AWARD, { cookie: free });
    expect(ready.res.headers.get("cache-control")).toBe("private, no-store");
    const m = main(ready.html);
    expect(m).toContain("<h2>The Holder's Record With This Buyer</h2>");
    expect(m).toContain("<p>Contracts of this kind with Public Services and Procurement Canada held by Exemplar Translation Services Inc., fiscal years 2017-18 to 2026-27.</p>");
    expect(m).toContain('<p><strong>Earlier records</strong> <span class="muted">8 earlier since 2026-04-27</span></p>');
    expect(m).toContain("<li>Amendments published: 2; value +25% on the original amount.</li>");
    expect(m).toContain("<li>End date moved from 2026-09-30 to 2026-11-20.</li>");
    expect(m).toContain("<li>This contract: competitive.</li>");
    carriesDisclaimer(ready.html, "free award");
    // After the dates, before the procurement details.
    expect(m.indexOf("<h2>Key Dates</h2>")).toBeLessThan(m.indexOf("<h2>The Holder's Record With This Buyer</h2>"));
    expect(m.indexOf("<h2>The Holder's Record With This Buyer</h2>")).toBeLessThan(m.indexOf("<h2>Procurement</h2>"));
    const past = await open(AWARD, { cookie: free, env: E({ end: "2027-02-15" }) });
    const panel = main(past.html);
    expect(panel).toContain("<h2>The Holder's Record With This Buyer</h2>");
    expect(panel).toContain('The Free plan shows the holder\'s record for contracts ending within 91 days; Pro shows it for those ending within 365 days. <a href="/account/billing">Plans and prices</a>');
    expect(panel).not.toMatch(/Earlier records|line-disclaimer|class="pro-tag"/);
  });
});

describe("a Pro reader", () => {
  it("sees the marks to 365 days, on the full lists", async () => {
    await readers();
    const six = await open("/expiring/6m", { cookie: pro });
    expect(six.res.headers.get("cache-control")).toBe("private, no-store");
    expect(rowOf(six.html, "r6-92")).toContain('<span class="muted small line-mark">Earlier records · 8 earlier</span>');
    expect(marks(six.html)).toHaveLength(4);
    const twelve = await open("/expiring/12m", { cookie: pro });
    expect(rowOf(twelve.html, "r12-365")).toContain("line-mark");
    carriesDisclaimer(twelve.html, "pro 12m");
    const fr = await open("/expiring/12m?lang=fr", { cookie: pro });
    expect(rowOf(fr.html, "cb-400-40000004")).toContain('<span class="muted small line-mark">Dossiers antérieurs · 8 antérieurs</span>');
    carriesDisclaimer(fr.html, "pro 12m fr", "fr");
    for (const page of [six.html, twelve.html, fr.html]) expectTablesFit(page, "radar with marks");
  });

  it("sees the panel past 91 days, and on a published contract's page in the page's one batch", async () => {
    await readers();
    const past = await open(AWARD, { cookie: pro, env: E({ end: "2027-02-15" }) });
    expect(main(past.html)).toContain('<p><strong>Earlier records</strong> <span class="muted">8 earlier since 2026-04-27</span></p>');
    const { binding, batches } = counting(RECORDS);
    const published = await open(PUBLISHED, { cookie: pro, env: E({ records: binding }) });
    expect(batches).toEqual([4]);
    const m = main(published.html);
    expect(m).toContain("<p>Contracts of this kind with National Defence held by Sample Harbour Marine Ltd., fiscal years 2017-18 to 2026-27.</p>");
    expect(m).toContain("<p><strong>No earlier record</strong></p>");
    expect(m).toContain("<li>Published contracts, commodity codes starting N583: this is the only contract of this kind with this buyer held by Sample Harbour Marine Ltd. in the period.</li>");
    expect(m).toContain("<li>This contract: method not stated (TN), 1 bid received.</li>");
    expect(m).toContain('<li>Under a similar name, counted apart: <a href="/organizations/org-b000000001">Sample Harbour Marine Limited</a>, 9 contracts of this kind with this buyer, the last starting 2024-04-01.</li>');
    carriesDisclaimer(published.html, "pro published");
    const fr = await open(`${PUBLISHED}?lang=fr`, { cookie: pro });
    expect(main(fr.html)).toContain("<h2>Dossiers du titulaire auprès de cet acheteur</h2>");
    carriesDisclaimer(fr.html, "pro published fr", "fr");
  });
});

describe("the states without a record to show", () => {
  it("leave every page as it was while the records database holds no rec_lines, with no error and no empty panel", async () => {
    await readers();
    for (const [path, cookie] of [[AWARD, free], [PUBLISHED, pro], ["/expiring/6m", pro], ["/expiring/3m", free]] as const) {
      const { res, html } = await open(path, { cookie, env: E({ records: withoutLines(RECORDS) }) });
      expect(res.status, path).toBe(200);
      expect(html, path).not.toMatch(/Holder's Record|line-mark|line-disclaimer|not available right now|line-signin|after the next nightly/);
    }
  });

  it("say in a line when the database cannot answer, and nothing for a contract the radar does not hold", async () => {
    await readers();
    const radar = await open("/expiring/3m", { cookie: free, env: E({ records: failing }) });
    expect(radar.res.status).toBe(200);
    expect(radar.html).toContain("The holders' records are not available right now.");
    expect(marks(radar.html)).toEqual([]);
    const award = await open(AWARD, { cookie: free, env: E({ records: failing }) });
    expect(main(award.html)).toContain("<h2>The Holder's Record With This Buyer</h2></div><p class=\"muted\">The holders' records are not available right now.</p>");
    // A history record that ended: not on the radar, nothing read, nothing shown.
    const { binding, batches } = counting(RECORDS);
    const ended = await open("/history/w8472-000633", { cookie: free, env: E({ records: binding }) });
    expect(batches).toEqual([]);
    expect(ended.html).not.toContain("Holder's Record");
  });

  it("say the records come after the next night when the rows the plan covers have none yet", async () => {
    await readers();
    await RECORDS.prepare("DELETE FROM rec_lines").run();
    try {
      const { html } = await open("/expiring/3m", { cookie: free });
      expect(html).toContain("Holders' records appear here after the next nightly update.");
      expect(marks(html)).toEqual([]);
      expect(html).not.toContain("line-disclaimer");
      expect(main((await open(AWARD, { cookie: free })).html)).not.toContain("Holder's Record");
    } finally {
      await seed();
    }
  });

  it("give an uncoded contract its reason and no label", async () => {
    await readers();
    await RECORDS.prepare("UPDATE rec_lines SET j = ? WHERE k = 11").bind(j({ s: [] })).run();
    try {
      const html = (await open(AWARD, { cookie: free })).html;
      const m = main(html);
      expect(m).toContain("<p>This contract carries only a UNSPSC segment, so its kind of work is not compared and no label is given.</p>");
      expect(m).not.toContain("<strong>Earlier records</strong>");
      carriesDisclaimer(html, "uncoded");
      expect(marks((await open("/expiring/3m", { cookie: free })).html)).toEqual(["No earlier record · similar name"]);
    } finally {
      await seed();
    }
  });
});

describe("around the pages", () => {
  it("add no chip and no filled button anywhere a record shows", async () => {
    await readers();
    const count = (html: string, re: RegExp) => main(html).match(re)?.length ?? 0;
    for (const [path, cookie] of [[AWARD, free], [PUBLISHED, pro], ["/expiring/6m", pro], ["/expiring/6m", free], ["/expiring/3m", free]] as const) {
      const shown = (await open(path, { cookie })).html;
      const before = (await open(path, { cookie, env: E({ records: withoutLines(RECORDS) }) })).html;
      expect(shown, path).not.toBe(before);
      expect(count(shown, /class="pro-tag"/g), path).toBe(count(before, /class="pro-tag"/g));
      expect(count(shown, /btn-primary/g), path).toBe(count(before, /btn-primary/g));
    }
  });

  it("read rec_lines through its unique index, bounded", async () => {
    const plan = async (sql: string, ...binds: unknown[]) =>
      ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail));
    for (const [sql, binds] of [[LINES_BY_KEY_SQL, [JSON.stringify(["award:cb-400-40000004"])]], [LINE_BY_KEY_SQL, ["award:cb-400-40000004"]]] as const) {
      expect(sql).toMatch(/LIMIT \d+$/);
      const steps = await plan(sql, ...binds);
      expect(steps.join("\n"), sql).toContain("rec_lines_sk");
      expect(steps.filter((s) => /^SCAN (l|rec_lines)\b/.test(s)), steps.join("\n")).toEqual([]);
    }
    expect(LINES_BY_KEY_SQL).toContain("LIMIT 500");
  });

  it("state the rules on the Methodology page from the constants, after the matching notices, whatever the switch", async () => {
    for (const environment of [offEnv(), E()]) {
      const html = decode(nbsp(await (await get("/methodology", { env: environment })).text())).replace(/’/g, "'");
      const toc = /<nav class="toc"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
      expect(toc.indexOf('<a href="#holders">Holder\'s Record</a>')).toBeGreaterThan(toc.indexOf('<a href="#matching">'));
      const section = html.slice(html.indexOf('<h2 id="holders">'), html.indexOf('<h2 id="people">'));
      expect(section).toContain("a commodity code with the same first 4 characters");
      expect(section).toContain("Records count from the 10 fiscal years ending with the data date's.");
      expect(section).toContain("no more than 120 days after the earlier one ends and no more than 60 days before");
      expect(section).toContain("begins with the same 20 characters");
      expect([...section.matchAll(/<td data-label="Label">([^<]*)<\/td>/g)].map((m) => m[1])).toEqual(["Long run", "Earlier records", "No earlier record"]);
      expect(section).toContain("3 or more of the holder's contracts back to back, this one included, in one source");
      expect(section).not.toContain("/account");
      expectTablesFit(html, "methodology");
    }
    const fr = decode(nbsp(await (await get("/methodology?lang=fr", { env: offEnv() })).text()));
    expect(fr).toContain('<h2 id="holders">Dossiers du titulaire</h2>');
  });
});
