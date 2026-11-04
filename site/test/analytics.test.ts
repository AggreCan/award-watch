// The analytics views (src/pages/analytics.tsx, src/records_db.ts,
// docs/analytics.md) against a real local D1 database built from
// pipeline/records_schema.sql and filled the way the nightly sync fills it:
// the records, the names and the two summary tables (made here with the
// pipeline's own GROUP BY). Every figure checked is worked out in this file
// from the same rows, never read back from the page's own arithmetic.
//
// Switch off: every address is the site's 404 and no page links one. Switch
// on: a free reader (no session, or a Free session) gets the first chart for
// the latest three fiscal years, no table, every other chart named and marked
// Pro, a link to sign in or to the billing page, and one D1 batch of two
// statements; a Pro reader gets every chart, its table and its CSV file. The
// bounds, the ids, the database missing or loading or failing, the query
// plans and both languages.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { allowed } from "../src/account/entitlements";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { allowsAnalytics } from "../src/plan";
import {
  ALL_SQL, BUYER_QUARTERS_SQL, MAX_RIVALS, ORG_YEARS_SQL, SEGMENT_YEARS_SQL, STATE_SQL, fiscalLabel, fiscalYearOf, orgIdOf, orgNumber,
} from "../src/records_db";
import { csvCell } from "../src/pages/analytics";
import { routeTemplate } from "../src/views";
import { get, grantPro, newEmail, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { testEnv } from "./assets";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

// -- the rows ------------------------------------------------------------------------

const PSPC = 101;
const DND = 102;
const A1 = "org-a000000001";
const A2 = "org-a000000002";
const N1 = "org-d000000001"; // new to segment 82 in 2026-27
const OLD = "org-d000000002"; // a record in 2018-19 and in 2026-27: not new
const ODD = "org-c000000001"; // a name a spreadsheet would read as a formula, with markup in it
const RIVALS = Array.from({ length: 7 }, (_, i) => `org-b00000000${i + 1}`);
const NAMES: Record<string, string> = {
  [A1]: "Exemplar Translation Services Inc.", [A2]: "Sample Harbour Marine Ltd.", [N1]: "Newcomer Supply Co.", [OLD]: "Returning Works Ltd.",
  [ODD]: '=SUM(1) "Quoted" <b>Bold</b> & Sons',
  ...Object.fromEntries(RIVALS.map((id, i) => [id, `Rival ${i + 1} Inc.`])),
};
const oid = (id: string) => orgNumber(id) as number;

interface Rec { src: number; fy: number; fq: number; bid: number | null; oid: number | null; sid: number | null; extra: 0 | 1; cents: number | null; vnote: number; comp: number | null; meth: string | null }
const RECS: Rec[] = [];
const rec = (r: Partial<Rec> & Pick<Rec, "src" | "fy" | "fq">): void => {
  RECS.push({ bid: PSPC, oid: null, sid: null, extra: 0, cents: null, vnote: 0, comp: 1, meth: "OB", ...r });
};
// PSPC contract history (2), segment 82: the profile's organization every
// quarter from 2014-15 (years before any window) to 2026-27, its fourth
// quarter non-competitive; each of those notices also reaches segment 43.
for (let fy = 2014; fy <= 2026; fy++) {
  for (let fq = 1; fq <= 4; fq++) {
    const cents = (100_000 * fq + fy) * 100;
    rec({ src: 2, fy, fq, oid: oid(A1), sid: 82, cents, comp: fq === 4 ? 0 : 1, meth: fq === 4 ? "TN" : "OB" });
    rec({ src: 2, fy, fq, oid: oid(A1), sid: 43, extra: 1, cents, comp: fq === 4 ? 0 : 1, meth: fq === 4 ? "TN" : "OB" });
  }
}
// Seven others in segment 82, smaller the further down the list, 2020-21 to 2026-27.
RIVALS.forEach((id, i) => {
  for (let fy = 2020; fy <= 2026; fy++) rec({ src: 2, fy, fq: 2, oid: oid(id), sid: 82, cents: (8 - i) * 5_000_000 });
});
rec({ src: 2, fy: 2026, fq: 1, oid: oid(N1), sid: 82, cents: 700_000 });
rec({ src: 2, fy: 2018, fq: 1, oid: oid(OLD), sid: 82, cents: 100_000 });
rec({ src: 2, fy: 2026, fq: 1, oid: oid(OLD), sid: 82, cents: 200_000 });
rec({ src: 2, fy: 2026, fq: 3, oid: oid(ODD), sid: 82, cents: 90_000_000, bid: DND });
// A supplier withheld (no organization), a value not published, a method not stated.
rec({ src: 2, fy: 2025, fq: 1, sid: 82, cents: 500_000 });
rec({ src: 2, fy: 2026, fq: 2, oid: oid(A2), sid: 82, cents: null, vnote: 1, comp: null, meth: null });
// Published contracts (3) at National Defence, no segment; a grant (4) with no competitive flag.
for (let fy = 2025; fy <= 2026; fy++) rec({ src: 3, fy, fq: 3, bid: DND, oid: oid(A1), cents: 1_234_500, comp: 0, meth: "TN" });
rec({ src: 4, fy: 2026, fq: 1, bid: DND, oid: oid(A2), cents: 4_000_000, comp: null, meth: null });

async function seed(state = "ready"): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["records", "rec_orgs", "rec_buyers", "rec_buyer_quarters", "rec_segment_years", "rec_meta"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  const insert = "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote, comp, meth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  for (let i = 0; i < RECS.length; i += 50) {
    await RECORDS.batch(RECS.slice(i, i + 50).map((r) =>
      RECORDS.prepare(insert).bind(r.src, r.fy, r.fq, r.bid, r.oid, r.sid, r.extra, r.cents, r.vnote, r.comp, r.meth)));
  }
  await RECORDS.batch([
    ...Object.entries(NAMES).map(([id, name]) => RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, ?)").bind(oid(id), name)),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'pwgsc-tpsgc', 'Public Services and Procurement Canada', 'Services publics et Approvisionnement Canada')").bind(PSPC),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dnd-mdn', 'National Defence', 'Défense nationale')").bind(DND),
    // The summary tables as records_db.build makes them.
    RECORDS.prepare("INSERT INTO rec_buyer_quarters (bid, src, fy, fq, n, cents, n_no_value) SELECT bid, src, fy, fq, COUNT(*), SUM(cents), " +
      "SUM(CASE WHEN vnote = 1 THEN 1 ELSE 0 END) FROM records WHERE extra = 0 AND bid IS NOT NULL AND fy IS NOT NULL GROUP BY bid, src, fy, fq"),
    RECORDS.prepare("INSERT INTO rec_segment_years (sid, src, fy, n, cents, n_no_value, n_buyers, n_orgs) SELECT sid, src, fy, COUNT(*), SUM(cents), " +
      "SUM(CASE WHEN vnote = 1 THEN 1 ELSE 0 END), COUNT(DISTINCT bid), COUNT(DISTINCT oid) FROM records WHERE sid IS NOT NULL AND fy IS NOT NULL GROUP BY sid, src, fy"),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', ?), ('as_of', '2026-10-31'), ('rules', '2')").bind(state),
  ]);
}

beforeAll(() => seed());

// The fixtures' data date, 2026-10-31, falls in 2026-27.
const LAST = 2026;
const sum = (rows: Rec[]) => rows.reduce((s, r) => s + (r.cents ?? 0), 0) / 100;
const money = (v: number) => nbsp(new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(v));

// -- sessions and requests ---------------------------------------------------------------

let freeCookie = "";
let proCookie = "";
async function sessions(): Promise<void> {
  if (proCookie) return;
  freeCookie = await signIn(newEmail("free-analytics"));
  const pro = newEmail("pro-analytics");
  proCookie = await signIn(pro);
  await grantPro(pro);
}

// A D1 binding that writes down every batch it runs, by the statements' text.
function recording(db: D1Database): { binding: D1Database; batches: string[][] } {
  const batches: string[][] = [];
  const sqlOf = new WeakMap<object, string>();
  const binding = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      sqlOf.set(st, sql);
      const bind = st.bind.bind(st);
      (st as { bind: unknown }).bind = (...args: unknown[]) => {
        const bound = bind(...args);
        sqlOf.set(bound, sql);
        return bound;
      };
      return st;
    },
    async batch(statements: D1PreparedStatement[]) {
      batches.push(statements.map((s) => sqlOf.get(s) ?? "?"));
      return db.batch(statements);
    },
  } as unknown as D1Database;
  return { binding, batches };
}

const page = async (path: string, o: { cookie?: string; env?: object } = {}) => {
  const res = await get(path, { cookie: o.cookie, env: o.env ?? onEnv() });
  return { res, html: nbsp(await res.text()) };
};

const VIEWS = ["/buyers/pwgsc-tpsgc/analytics", `/organizations/${A1}/analytics`, "/segments/82/analytics"];
const CSVS = ["/buyers/pwgsc-tpsgc/analytics/quarters.csv", `/organizations/${A1}/analytics/years.csv`, "/segments/82/analytics/winners.csv"];

// -- the plans -------------------------------------------------------------------------

describe("the plans", () => {
  it("make analytics a Pro feature", () => {
    expect(allowed({ plan: "free" }, "analytics")).toBe(false);
    expect(allowed({ plan: "pro" }, "analytics")).toBe(true);
    expect(allowsAnalytics("free")).toBe(false);
    expect(allowsAnalytics("pro")).toBe(true);
  });

  it("count fiscal years from April and name them as the government does", () => {
    expect(fiscalYearOf("2026-10-31")).toBe(2026);
    expect(fiscalYearOf("2026-03-31")).toBe(2025);
    expect(fiscalYearOf("2026-04-01")).toBe(2026);
    expect(fiscalLabel("en", 2025)).toBe("2025-26");
    expect(fiscalLabel("en", 2099)).toBe("2099-00");
    expect(fiscalLabel("fr", 2025)).toBe("2025-2026");
    expect(orgNumber("org-00000000ff")).toBe(255);
    expect(orgIdOf(255)).toBe("org-00000000ff");
    expect(orgNumber("org-FFFFFFFFFF")).toBeNull();
  });
});

// -- the switch -------------------------------------------------------------------------

describe("with the switch off", () => {
  it("answers every view and file with the site's 404 and reads nothing", async () => {
    await sessions();
    const rec = recording(RECORDS);
    for (const path of [...VIEWS, ...CSVS]) {
      for (const cookie of [undefined, proCookie]) {
        const res = await get(path, { cookie, env: { ...testEnv(), RECORDS: rec.binding } });
        expect(res.status, path).toBe(404);
        expect(await res.text(), path).toContain("Page Not Found");
      }
    }
    expect(rec.batches).toEqual([]);
    for (const path of ["/buyers/pwgsc-tpsgc", `/organizations/${A1}`, "/segments/82"]) {
      expect(await (await get(path, { env: testEnv() })).text(), path).not.toContain("/analytics");
    }
  });
});

describe("the pages that link a view, switch on", () => {
  it("list it for every reader, marked Pro, and read nothing from the records database", async () => {
    await sessions();
    const rec = recording(RECORDS);
    for (const [path, view] of [["/buyers/pwgsc-tpsgc", VIEWS[0]], [`/organizations/${A1}`, VIEWS[1]], ["/segments/82", VIEWS[2]]]) {
      for (const cookie of [undefined, freeCookie, proCookie]) {
        const html = await (await get(path, { cookie, env: onEnv({ RECORDS: rec.binding }) })).text();
        expect(html, path).toContain(`<a href="${view}" class="btn" rel="nofollow">Analytics<span class="pro-tag">Pro</span></a>`);
      }
    }
    expect(rec.batches).toEqual([]);
  });
});

// -- the free view -----------------------------------------------------------------------

describe("the free view", () => {
  it("shows the first chart for three fiscal years, no table, the rest named and marked Pro, from one batch of two statements", async () => {
    await sessions();
    const first: Record<string, string> = { [VIEWS[0]]: BUYER_QUARTERS_SQL, [VIEWS[1]]: ORG_YEARS_SQL, [VIEWS[2]]: SEGMENT_YEARS_SQL };
    const locked: Record<string, string[]> = {
      [VIEWS[0]]: ["Value by Segment", "Non-Competitive Share by Fiscal Year", "Largest Organizations"],
      [VIEWS[1]]: ["Largest Buyers", "Value by Segment", "Share of a Segment"],
      [VIEWS[2]]: ["Largest Buyers in the Segment", "Largest Organizations in the Segment", "New to the Segment"],
    };
    for (const view of VIEWS) {
      for (const cookie of [undefined, freeCookie]) {
        const rec = recording(RECORDS);
        const { res, html } = await page(`${view}?source=history`, { cookie, env: onEnv({ RECORDS: rec.binding }) });
        const who = `${view} (${cookie ? "free session" : "no session"})`;
        expect(res.status, who).toBe(200);
        expect(rec.batches, who).toEqual([[STATE_SQL, first[view]]]);
        // Three fiscal years on the axis, none before.
        for (const fy of ["2024-25", "2025-26", "2026-27"]) expect(html, who).toContain(`>${fy}</span>`);
        expect(html, who).not.toContain(">2023-24<");
        expect(html, who).toContain('class="chart-stack"');
        expect(html, who).not.toContain("<table");
        expect(html, who).not.toContain(".csv");
        for (const title of locked[view]) expect(decode(html), who).toContain(`${title}<span class="pro-tag">Pro</span>`);
        expect(html, who).toContain('class="pro-note"');
        expect(html, who).toContain(cookie ? 'href="/account/billing">See the Pro plan on the billing page' : 'href="/account/sign-in">Sign in to subscribe to Pro');
        expect(html, who).toContain('<meta name="robots" content="noindex"/>');
        expect(res.headers.get("cache-control"), who).toBe(cookie ? "private, no-store" : "public, max-age=300");
        expect(res.headers.get("vary"), who).toContain("Cookie");
        expect(html, who).not.toContain(EM_DASH);
      }
    }
  });

  it("says a longer period or a comparison is part of Pro, and still reads three years", async () => {
    const rec = recording(RECORDS);
    const { html } = await page(`${VIEWS[1]}?source=history&years=10&segment=82&vs=${RIVALS[0]}`, { env: onEnv({ RECORDS: rec.binding }) });
    expect(html).toContain("Longer periods, other segments and comparisons are part of Pro");
    expect(rec.batches).toEqual([[STATE_SQL, ORG_YEARS_SQL]]);
    expect(html).not.toContain(">2023-24<");
  });
});

// -- the full views ------------------------------------------------------------------------

describe("the Pro view", () => {
  it("charts a buyer: quarters, segments, the non-competitive share and the largest organizations, each with its table and file", async () => {
    await sessions();
    const { res, html } = await page(`${VIEWS[0]}?source=history`, { cookie: proCookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const pspc = RECS.filter((r) => r.src === 2 && r.bid === PSPC && r.extra === 0 && r.fy >= LAST - 9);
    // Ten fiscal years on the axis; the oldest is 2017-18.
    expect(html).toContain(">2017-18</span>");
    expect(html).not.toContain(">2016-17<");
    // A year's value: its quarters added, the current year marked as to date.
    const fy2025 = sum(pspc.filter((r) => r.fy === 2025));
    expect(html).toContain(money(fy2025));
    expect(html).toContain("2026-27 (to date)");
    // Each segment counts the notice: 82 and 43 hold the profile's notices alike.
    expect(html).toContain('<a href="/segments/82"><span class="mono">82</span>');
    expect(html).toContain('<a href="/segments/43"><span class="mono">43</span>');
    // The non-competitive share by count in 2025-26: the profile's fourth quarters, over every record that year.
    const y25 = pspc.filter((r) => r.fy === 2025);
    const nc = y25.filter((r) => r.comp === 0).length;
    expect(html).toContain(`${nc} (${Math.round((nc / y25.length) * 100)}%)`);
    // The largest organization and the share it holds of the whole period's value.
    const total = sum(pspc);
    const a1 = sum(pspc.filter((r) => r.oid === oid(A1)));
    expect(html).toContain(`Largest organization: <b>${Math.round((a1 / total) * 100)}%</b>`);
    expect(html).toContain(`<a href="/organizations/${A1}">Exemplar Translation Services Inc.</a>`);
    for (const table of ["quarters", "segments", "competition", "suppliers"]) {
      expect(decode(html)).toContain(`/buyers/pwgsc-tpsgc/analytics/${table}.csv?source=history&years=10`);
    }
    expect((html.match(/<table/g) ?? []).length).toBe(4);
    expect(html).toContain("Records as of 2026-10-31.");
  });

  it("charts an organization, and its share of a segment beside the five largest others unless the reader chooses", async () => {
    const { html } = await page(`${VIEWS[1]}?source=history&years=10`, { cookie: proCookie });
    // Its largest segment by default (82 and 43 are equal in value; 82 is first by... count and number).
    expect(html).toMatch(/<option value="(82|43)" selected="">/);
    const seg = /<option value="(\d\d)" selected="">/.exec(html)?.[1];
    expect(seg).toBeDefined();
    // The five largest others in segment 82 over the period, compared by default.
    if (seg === "82") {
      for (const id of RIVALS.slice(0, 2)) expect(html).toContain(`<a href="/organizations/${id}">`);
    }
    const chosen = await page(`${VIEWS[1]}?source=history&years=10&segment=82&vs=${RIVALS[6]}&vs=${ODD}`, { cookie: proCookie });
    expect(chosen.html).toContain('<option value="82" selected="">');
    expect(chosen.html).toContain(`<a href="/organizations/${RIVALS[6]}">Rival 7 Inc.</a>`);
    expect(chosen.html).toContain(`value="${RIVALS[6]}" checked=""`);
    expect(chosen.html).not.toContain(`value="${RIVALS[0]}" checked=""`);
    // Markup in a name stays text.
    expect(chosen.html).toContain("=SUM(1) &quot;Quoted&quot; &lt;b&gt;Bold&lt;/b&gt; &amp; Sons");
    expect(chosen.html).not.toContain("<b>Bold</b>");
    // The organization's share of segment 82 in 2025-26.
    const seg82 = RECS.filter((r) => r.src === 2 && r.sid === 82 && r.fy === 2025);
    const mine = sum(seg82.filter((r) => r.oid === oid(A1)));
    expect(sum(seg82)).toBeGreaterThan(mine);
    // Its buyers and the published contracts at National Defence.
    const contracts = await page(`${VIEWS[1]}?source=contracts&years=5`, { cookie: proCookie });
    expect(contracts.html).toContain('<a href="/buyers/dnd-mdn">National Defence</a>');
    expect(contracts.html).toContain("Published contracts and grants carry no UNSPSC segment.");
    expect(contracts.html).toContain(money(sum(RECS.filter((r) => r.src === 3))));
  });

  it("charts a segment: buyers and organizations by year, the largest of each, and the organizations new in the latest year", async () => {
    const { html } = await page(`${VIEWS[2]}?source=history`, { cookie: proCookie });
    expect(html).toContain("Buyers and Organizations by Fiscal Year");
    // New in 2026-27: a record that year and none in the nine before (the newcomer, the formula-named one and the
    // one whose value was not published), never the returning one or anyone from earlier years.
    const inSeg = RECS.filter((r) => r.src === 2 && r.sid === 82 && r.oid !== null && r.fy >= LAST - 9);
    const fresh = [...new Set(inSeg.filter((r) => r.fy === LAST).map((r) => r.oid))].filter((o) => !inSeg.some((r) => r.oid === o && r.fy < LAST));
    expect(fresh.sort()).toEqual([oid(A2), oid(ODD), oid(N1)].sort());
    const entrants = html.split("New to the Segment")[1] ?? "";
    expect(entrants).toContain(`${fresh.length} organizations new to the segment in 2026-27 (to date).`);
    expect(entrants).toContain(`<a href="/organizations/${N1}">Newcomer Supply Co.</a>`);
    expect(entrants).not.toContain(OLD);
    expect(entrants).not.toContain(A1);
    // The largest buyers in the segment: both, PSPC first.
    const buyers = html.slice(html.indexOf("Largest Buyers in the Segment"), html.indexOf("Largest Organizations in the Segment"));
    expect(buyers.indexOf("/buyers/pwgsc-tpsgc")).toBeGreaterThan(-1);
    expect(buyers.indexOf("/buyers/pwgsc-tpsgc")).toBeLessThan(buyers.indexOf("/buyers/dnd-mdn"));
    // Distinct organizations in 2026-27 in segment 82.
    const y26 = new Set(RECS.filter((r) => r.src === 2 && r.sid === 82 && r.fy === 2026 && r.oid !== null).map((r) => r.oid)).size;
    expect(html).toMatch(new RegExp(`2026-27 \\(to date\\)</td>(?:<td[^>]*>[^<]*</td>){4}<td data-label="Organizations" class="mono num">${y26}</td>`));
  });

  it("reads the French view in French", async () => {
    for (const view of VIEWS) {
      const { html } = await page(`${view}?lang=fr&source=history`, { cookie: proCookie });
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain("Analyses");
      expect(html).toContain("2025-2026");
      expect(html).not.toMatch(/\{\w+\}/);
      for (const english of ["Value by Fiscal", "Largest Buyers", "Records as of", "fiscal years", "Back to the"]) expect(html, `${view}: ${english}`).not.toContain(english);
      expect(html).not.toContain(EM_DASH);
    }
    const free = (await page(`${VIEWS[0]}?lang=fr`)).html;
    expect(free).toContain("Se connecter pour s’abonner à Pro");
    expect(free).not.toContain("Sign in to subscribe");
  });
});

// -- the bounds ---------------------------------------------------------------------------

describe("the bounds", () => {
  it("read a value outside the lists as the default, never as an error", async () => {
    const rec = recording(RECORDS);
    const { res, html } = await page(`${VIEWS[0]}?source=everything&years=99`, { cookie: proCookie, env: onEnv({ RECORDS: rec.binding }) });
    expect(res.status).toBe(200);
    // pwgsc-tpsgc's page has as many award notices as history records: award notices come first, over ten years.
    expect(html).toContain('aria-current="page">Award notices</a>');
    expect(html).toContain('aria-current="page">10 fiscal years</a>');
    expect(html).toContain("No record of this source in these fiscal years.");
    for (const batch of rec.batches) {
      for (const sql of batch) expect(ALL_SQL, sql).toContain(sql);
    }
  });

  it("compare at most five organizations, chosen ones only once, never the profile itself, and only valid ids", async () => {
    const rec = recording(RECORDS);
    const vs = [A1, ...RIVALS, "org-ZZZZ", "not-an-org", RIVALS[0]].map((v) => `vs=${v}`).join("&");
    const { res } = await page(`${VIEWS[1]}?source=history&segment=82&${vs}`, { cookie: proCookie, env: onEnv({ RECORDS: rec.binding }) });
    expect(res.status).toBe(200);
    expect(rec.batches).toHaveLength(1);
    expect(MAX_RIVALS).toBe(5);
  });

  it("answer an id that is not one with the site's 404, a moved buyer with its new address, and an upper-case id with the lower-case one", async () => {
    for (const path of ["/buyers/NOT_A_BUYER!/analytics", "/organizations/org-zz/analytics", "/organizations/directory/analytics", "/segments/99/analytics",
      "/segments/7/analytics", "/segments/8a/analytics", "/buyers/pwgsc-tpsgc/analytics/nothing.csv", "/buyers/pwgsc-tpsgc/analytics/Quarters.csv"]) {
      expect((await get(path, { cookie: proCookie })).status, path).toBe(404);
    }
    const unknown = await get("/buyers/no-such-buyer/analytics", { cookie: proCookie });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("Buyer Not Found");
    const moved = await get("/buyers/public-works-and-government-services-canada/analytics?source=history", { cookie: proCookie });
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("/buyers/pwgsc-tpsgc/analytics?source=history");
    const upper = await get("/buyers/PWGSC-TPSGC/analytics", { cookie: proCookie });
    expect(upper.status).toBe(301);
    expect(upper.headers.get("location")).toBe("/buyers/pwgsc-tpsgc/analytics");
  });

  it("bound every statement: a LIMIT on each, ten fiscal years at most, and a plan through an index", async () => {
    // Every statement ends its outer query in a fixed LIMIT, and names no fiscal year but through ?3 and ?4.
    for (const sql of ALL_SQL) {
      expect(sql, sql).toMatch(/LIMIT \d+$/);
      if (sql !== STATE_SQL) expect(sql, sql).toContain("fy BETWEEN ?3 AND ?4");
    }
    const params: Record<string, (string | number)[]> = {};
    const plan = async (sql: string, binds: (string | number)[]) =>
      ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail));
    const four = (first: string | number) => [first, 2, 2017, 2026];
    const cases: [string, (string | number)[]][] = ALL_SQL.slice(1).map((sql) => {
      if (sql.includes("rec_buyers WHERE id = ?1")) return [sql, four("pwgsc-tpsgc")];
      if (sql.includes("oid IN (?5")) return [sql, [82, 2, 2017, 2026, oid(A1), -1, -1, -1, -1, -1, 5]];
      if (sql.startsWith("SELECT fy, COUNT(*) AS n, SUM(cents) AS cents, SUM(CASE WHEN vnote") || sql.includes("WHERE oid = ?1")) return [sql, four(oid(A1))];
      return [sql, four(82)];
    });
    for (const [sql, binds] of cases) {
      params[sql] = binds;
      const steps = await plan(sql, binds);
      // Every table is reached through an index (SEARCH ... USING), none is read whole (a bare SCAN).
      const full = steps.filter((s) => /^SCAN (records|rec_\w+)\b/.test(s) && !/USING/.test(s));
      expect(full, `${sql}\n${steps.join("\n")}`).toEqual([]);
      expect(steps.some((s) => /^SEARCH (records|rec_\w+) USING .*INDEX/.test(s)), `${sql}\n${steps.join("\n")}`).toBe(true);
      const named = ["records_buyer", "records_org", "records_segment", "rec_buyer_quarters_buyer", "rec_segment_years_segment"];
      expect(steps.some((s) => named.some((ix) => s.includes(` ${ix} `))), `${sql}\n${steps.join("\n")}`).toBe(true);
    }
  });
});

// -- the database missing, loading or failing ------------------------------------------------

describe("without a database to read", () => {
  it("answers 503 with a way back, kept by no cache, for each reader and each view", async () => {
    const failing = { batch: async () => { throw new Error("D1_ERROR: no such table: records: SQLITE_ERROR"); }, prepare: (s: string) => RECORDS.prepare(s) } as unknown as D1Database;
    for (const [envOf, text] of [
      [() => onEnv({ RECORDS: undefined }), "The records database could not be read."],
      [() => onEnv({ RECORDS: failing }), "The records database could not be read."],
    ] as const) {
      for (const view of VIEWS) {
        for (const cookie of [undefined, proCookie]) {
          const { res, html } = await page(view, { cookie, env: envOf() });
          expect(res.status, view).toBe(503);
          expect(res.headers.get("cache-control"), view).toBe(cookie ? "private, no-store" : "no-store");
          expect(html, view).toContain("Analytics Are Not Available Right Now");
          expect(html, view).toContain(text);
        }
      }
      expect((await get(CSVS[0], { cookie: proCookie, env: envOf() })).status).toBe(503);
    }
  });

  it("says so while a full reload is loading, and never shows a half-loaded figure", async () => {
    await seed("loading");
    try {
      const { res, html } = await page(VIEWS[0], { cookie: proCookie });
      expect(res.status).toBe(503);
      expect(html).toContain("The records database is being loaded again.");
      expect(html).not.toContain("<table");
    } finally {
      await seed();
    }
  });
});

// -- the CSV files ----------------------------------------------------------------------------

describe("the CSV files", () => {
  it("are Pro's: a table each, as figures, private, under the download cap", async () => {
    const free = await get(`${CSVS[0]}?source=history`, { cookie: freeCookie });
    expect(free.status).toBe(404);
    expect((await get(CSVS[0])).status).toBe(404);
    const rec = recording(RECORDS);
    const res = await get(`${CSVS[0]}?source=history&years=10`, { cookie: proCookie, env: onEnv({ RECORDS: rec.binding }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="pwgsc-tpsgc-quarters-history-2017-2026.csv"');
    // The table's statement alone, beside the state.
    expect(rec.batches).toEqual([[STATE_SQL, BUYER_QUARTERS_SQL]]);
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("fiscal_year,fiscal_year_label,quarter,records,value_cad,records_without_value");
    const q = RECS.filter((r) => r.src === 2 && r.bid === PSPC && r.extra === 0 && r.fy === 2025 && r.fq === 1);
    expect(lines).toContain(`2025,2025-26,1,${q.length},${sum(q).toFixed(2)},0`);
    expect(lines).toHaveLength(1 + 40);
    // A name a spreadsheet would run as a formula is written as text.
    const winners = await (await get(`${CSVS[2]}?source=history`, { cookie: proCookie })).text();
    expect(winners).toContain(`${ODD},"'=SUM(1) ""Quoted"" <b>Bold</b> & Sons",1,900000.00`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
    // The share of a segment, by fiscal year and organization.
    const share = await (await get(`/organizations/${A1}/analytics/share.csv?source=history&segment=82&vs=${RIVALS[0]}`, { cookie: proCookie })).text();
    expect(share.split("\r\n")[0]).toBe("segment,fiscal_year,fiscal_year_label,segment_value_cad,organization_id,records,value_cad");
    expect(share).toContain(`82,2025,2025-26,`);
    expect(share).toContain(RIVALS[0]);
    for (const path of CSVS) {
      expect(bucketFor("GET", path), path).toBe("download");
      expect(bucketFor("HEAD", path), path).toBe("page");
      expect(routeTemplate("GET", path).kind, path).toBe("download");
    }
    expect(routeTemplate("GET", VIEWS[0])).toEqual({ route: "/buyers/:id/analytics", kind: "page" });
    expect(routeTemplate("GET", VIEWS[2])).toEqual({ route: "/segments/:nn/analytics", kind: "page" });
    expect(routeTemplate("GET", CSVS[1])).toEqual({ route: "/organizations/:id/analytics/:table.csv", kind: "download" });
  });
});

describe("the rest of the site", () => {
  it("states the counting rules, lists the feature on the billing page and keeps crawlers off the views", async () => {
    const meth = nbsp(await (await get("/methodology", { env: onEnv() })).text());
    expect(meth).toContain('<h2 id="analytics">Analytics</h2>');
    expect(meth).toContain("none in the 9 fiscal years before");
    expect(meth).toContain("for the latest 3 fiscal years");
    const billing = await (await get("/account/billing", { cookie: freeCookie })).text();
    expect(decode(billing)).toContain("Analytics of each buyer, organization and segment over up to ten fiscal years");
    const robots = await (await app.request("/robots.txt", {}, env)).text();
    for (const rule of ["Disallow: /buyers/*/analytics", "Disallow: /organizations/*/analytics", "Disallow: /segments/*/analytics"]) {
      expect(robots.split(rule).length - 1, rule).toBe(2);
    }
  });
});
