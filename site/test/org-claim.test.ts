// Your organization (src/account/org_claim.ts, org_pages.tsx; docs/accounts.md,
// Your organization): the claim stores only a checked id, a second replaces
// the first, five competitors and no more, merges followed; the claimed
// organization followed as a watch, made once; the page for Free (the first
// block, the chips) and Pro (every block, one records batch), the standing
// offers and supply arrangements held among them; the files, Pro and
// private; the public profile unchanged by a claim; deletion; the console;
// the statements' plans and bounds; the weekly block of the watch mail in
// both languages. The records database is built here
// from pipeline/records_schema.sql with rows written below, and every
// expected figure is worked out from those rows, never read back from the
// code under test.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { watchDigest, type WatchDigest } from "../src/account/digests";
import {
  BUYERS_SHOWN, CLAIM_ACCOUNTS_SQL, CLAIM_BATCH_MAX, CLAIM_INSTRUMENTS_SQL, CLAIM_RECORDS_SQL, CLAIM_SHARE_LARGEST_SQL, CLAIM_SHARE_SQL,
  COMPETITORS_MAX, INSTRUMENTS_SHOWN, claimFrame, endingParams, orgWeekOpening, readWeek, weekOpening,
} from "../src/account/org_claim";
import { bucketFor } from "../src/limits";
import { radarParams, readExpiringQuery } from "../src/pages/expiring";
import { ORG_SHARE_SQL, orgNumber } from "../src/records_db";
import { foldText } from "../src/search_db";
import { ACCOUNTS, csrf, decode, get, grantPro, nbsp, newEmail, offEnv, onEnv, post, signIn, userId, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const SEARCH_SCHEMA = (env as unknown as { SEARCH_SCHEMA_SQL: string }).SEARCH_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);
const DAY = "2026-10-31"; // the fixtures' data date, in fiscal year 2026-27
const SITE = "https://awardwatch.ca";

const A1 = "org-a000000001"; // Exemplar Translation Services Inc. (the fixtures' profile; org-a00000000f is an alias of it)
const A2 = "org-a000000002"; // Sample Harbour Marine Ltd.
const MORE = ["org-a000000003", "org-a000000004", "org-a000000005", "org-a000000006", "org-a000000007"];
const NAME1 = "Exemplar Translation Services Inc.";
const NAME2 = "Sample Harbour Marine Ltd.";
const n = (id: string) => orgNumber(id) as number;

// The fixtures' profiles and five more, copies of the second under new ids,
// so a comparison can reach its cap.
const PROFILES = structuredClone(FILES["profiles/a00.json"]) as Record<string, any>;
MORE.forEach((id, i) => {
  const p = structuredClone(PROFILES[A2]);
  p.organization.id = id;
  p.organization.display_name = `Compared Organization ${i + 3}`;
  PROFILES[id] = p;
});
const ASSETS = makeFakeAssets({}, { "profiles/a00.json": PROFILES });
const E = (extra: Record<string, unknown> = {}) => onEnv({ ASSETS, ...extra });

const text = async (res: Response) => nbsp(decode(await res.text())).replace(/’/g, "'");

// -- the records database --------------------------------------------------------------------

const PSPC = 101;
const DND = 102;
const DFO = 103;
type Rec = { src: number; fy: number; fq: number; bid: number; oid: number | null; sid: number | null; extra?: number; cents: number };
const RECS: Rec[] = [
  // Award notices in segment 81 (one of them reaching segment 77 too), at PSPC.
  { src: 1, fy: 2024, fq: 2, bid: PSPC, oid: n(A1), sid: 81, cents: 100_000_000 },
  { src: 1, fy: 2024, fq: 2, bid: PSPC, oid: n(A1), sid: 77, extra: 1, cents: 100_000_000 },
  { src: 1, fy: 2025, fq: 1, bid: PSPC, oid: n(A1), sid: 81, cents: 50_000_000 },
  { src: 1, fy: 2025, fq: 3, bid: PSPC, oid: n(A2), sid: 81, cents: 50_000_000 },
  // A supplier withheld: in the segment's value, in nobody's share.
  { src: 1, fy: 2025, fq: 4, bid: DFO, oid: null, sid: 81, cents: 100_000_000 },
  // Before the ten fiscal years.
  { src: 1, fy: 2015, fq: 1, bid: PSPC, oid: n(A1), sid: 81, cents: 9_999_900 },
  // PSPC contract history in segment 43, at Fisheries and Oceans.
  { src: 2, fy: 2020, fq: 2, bid: DFO, oid: n(A1), sid: 43, cents: 20_000_000 },
  // A published contract and a grant: no segment.
  { src: 3, fy: 2026, fq: 2, bid: DFO, oid: n(A1), sid: null, cents: 1_234_500 },
  { src: 4, fy: 2018, fq: 1, bid: PSPC, oid: n(A1), sid: null, cents: 4_000_000 },
];
// The record tables' rows (rec_details), the buyers block's source.
const DETAILS = [
  { src: 1, day: "2024-08-01", bid: PSPC, oid: n(A1), cents: 100_000_000 },
  { src: 1, day: "2025-04-15", bid: PSPC, oid: n(A1), cents: 50_000_000 },
  { src: 2, day: "2020-08-01", bid: DFO, oid: n(A1), cents: 20_000_000 },
  { src: 3, day: "2026-07-01", bid: DFO, oid: n(A1), cents: 1_234_500 },
  { src: 4, day: "2018-05-01", bid: PSPC, oid: n(A1), cents: 4_000_000 },
  { src: 1, day: "2025-12-01", bid: PSPC, oid: n(A2), cents: 50_000_000 },
];

// A radar row as rec_expiring keeps it (the window file's row without days_left).
function radar(ref: string, end: string, kind: "award" | "history", value: number, buyer: string, org: string): string {
  return JSON.stringify({
    kind, reference: ref, title_en: `Contract ${ref}`, title_fr: `Contrat ${ref}`, organization_id: org, organization: org === A1 ? NAME1 : NAME2,
    buyer_id: buyer, buyer_en: buyer, buyer_fr: buyer, start: "2024-01-01", end, value, currency: "CAD", competitive: 1,
    method_en: "Competitive", method_fr: "Concurrentielle", instrument_en: "Contract", instrument_fr: "Contrat", n_amendments: 1,
    value_growth: 0.25, tender_reference: null, segments: ["81"], provinces: ["ON"],
  });
}
const EXPIRING = [
  { endd: "2027-01-15", oid: n(A1), buyer: "pwgsc-tpsgc", kind: 1, cents: 30_000_000, m31: 0, j: radar("EN578-111111-001", "2027-01-15", "award", 300_000, "pwgsc-tpsgc", A1) },
  { endd: "2027-03-31", oid: n(A1), buyer: "dfo-mpo", kind: 2, cents: 20_000_000, m31: 1, j: radar("F1700-222222", "2027-03-31", "history", 200_000, "dfo-mpo", A1) },
  // Past the 12-month window, and another organization's.
  { endd: "2028-02-01", oid: n(A1), buyer: "pwgsc-tpsgc", kind: 1, cents: 1_000_000, m31: 0, j: radar("EN578-333333-001", "2028-02-01", "award", 10_000, "pwgsc-tpsgc", A1) },
  { endd: "2027-02-01", oid: n(A2), buyer: "dfo-mpo", kind: 1, cents: 5_000_000, m31: 0, j: radar("F1700-444444-001", "2027-02-01", "award", 50_000, "dfo-mpo", A2) },
];
// The week's events (2026-10-25 to 2026-10-31) and some outside it.
const EVENTS = [
  { day: "2026-10-30", kind: "award", src: 1, oid: n(A1), buyer: "pwgsc-tpsgc", ref: "award:a1", more: null },
  { day: "2026-10-29", kind: "award", src: 3, oid: n(A1), buyer: "dfo-mpo", ref: "contract:dfo-mpo:c1", more: null },
  { day: "2026-10-20", kind: "award", src: 1, oid: n(A1), buyer: "pwgsc-tpsgc", ref: "award:old", more: null },
  { day: "2026-10-30", kind: "notice", src: 5, oid: null, buyer: "pwgsc-tpsgc", ref: "tender:t1", more: null },
  { day: "2026-10-27", kind: "notice", src: 5, oid: null, buyer: "pwgsc-tpsgc", ref: "tender:t2", more: null },
  { day: "2026-10-30", kind: "notice", src: 5, oid: null, buyer: "pwgsc-tpsgc", ref: "count:notice:pwgsc-tpsgc", more: 3 },
  { day: "2026-10-28", kind: "notice", src: 5, oid: null, buyer: "dfo-mpo", ref: "tender:t3", more: null },
  { day: "2026-10-20", kind: "notice", src: 5, oid: null, buyer: "dfo-mpo", ref: "tender:old", more: null },
  { day: "2026-10-30", kind: "notice", src: 5, oid: null, buyer: "dnd-mdn", ref: "tender:t4", more: null },
];

// Standing offers and supply arrangements as the nightly keeps them
// (rec_instruments, rec_holders): the organization holds three, the
// regional offer in two regions and the arrangement with no expiry; another
// organization and a holder with no profile hold two of them too; a fifth
// organization holds 27, more than the page shows.
const AGR = { rmso: "E60ZT-120002/001/ZT", nmso: "EZ899-250380/001/ZM", sa: "E60ZT-777777/001/ZT" };
const MANY = MORE[2];
const MANY_N = 27;
const manyAgr = (i: number) => `W0000-${String(i).padStart(6, "0")}/001/ZZ`;
const INSTRUMENTS = [
  { k: 1, agr: AGR.rmso, type_en: "Regional Master Standing Offer", type_fr: "Offre à commandes principale régionale",
    desc_en: "Environmental consulting services", desc_fr: "Services d'experts-conseils en environnement",
    user_en: "Public Services and Procurement Canada", user_fr: "Services publics et Approvisionnement Canada", buyer: "pwgsc-tpsgc",
    start: "2024-04-01", expiry: "2028-03-31" },
  { k: 2, agr: AGR.nmso, type_en: "National Master Standing Offer", type_fr: null, desc_en: "Translation services", desc_fr: "Services de traduction",
    user_en: "All government departments", user_fr: "Tous les ministères", buyer: null, start: "2025-06-01", expiry: "2027-06-30" },
  { k: 3, agr: AGR.sa, type_en: "Supply Arrangement", type_fr: null, desc_en: "Geospatial data services", desc_fr: null, user_en: null, user_fr: null,
    buyer: null, start: null, expiry: null },
  ...Array.from({ length: MANY_N }, (_, i) => ({
    k: 100 + i, agr: manyAgr(i + 1), type_en: "Supply Arrangement", type_fr: null, desc_en: `Arrangement ${i + 1}`, desc_fr: null, user_en: null,
    user_fr: null, buyer: null, start: null, expiry: `2027-01-${String(i + 1).padStart(2, "0")}`,
  })),
];
const HOLDERS = [
  { ik: 1, oid: n(A1), name: NAME1, region: "AB" }, { ik: 1, oid: n(A1), name: NAME1, region: "BC" },
  { ik: 1, oid: null, name: "Unprofiled Consulting", region: "AB" },
  { ik: 2, oid: n(A1), name: NAME1, region: "NC" }, { ik: 2, oid: n(MORE[1]), name: "Compared Organization 4", region: "NC" },
  { ik: 3, oid: n(A1), name: NAME1, region: "NA" },
  ...Array.from({ length: MANY_N }, (_, i) => ({ ik: 100 + i, oid: n(MANY), name: "Compared Organization 5", region: "ON" })),
];

async function seedInstruments(): Promise<void> {
  await RECORDS.batch([
    ...INSTRUMENTS.map((x) => RECORDS.prepare(
      "INSERT INTO rec_instruments (k, agr, type_en, type_fr, desc_en, desc_fr, user_en, user_fr, buyer, start, expiry, n, nw, seen, last) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, '2026-10-30', '2026-10-30')",
    ).bind(x.k, x.agr, x.type_en, x.type_fr, x.desc_en, x.desc_fr, x.user_en, x.user_fr, x.buyer, x.start, x.expiry)),
    ...HOLDERS.map((h, i) => RECORDS.prepare(
      "INSERT INTO rec_holders (k, ik, oid, name, op, region, region_en, region_fr, seen) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, '2026-10-30')",
    ).bind(i + 1, h.ik, h.oid, h.name, h.region)),
  ]);
}

async function seedRecords(asOf = DAY): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["records", "rec_orgs", "rec_buyers", "rec_segment_years", "rec_details", "rec_expiring", "rec_events", "rec_meta",
    "rec_instruments", "rec_holders"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await seedInstruments();
  await RECORDS.batch([
    ...RECS.map((r, i) => RECORDS.prepare(
      "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote, comp, ref, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)",
    ).bind(r.src, r.fy, r.fq, r.bid, r.oid, r.sid, r.extra ?? 0, r.cents, `REF-${i}`, `Record ${i}`)),
    RECORDS.prepare("INSERT INTO rec_segment_years (sid, src, fy, n, cents, n_no_value, n_buyers, n_orgs, n_pos) SELECT sid, src, fy, COUNT(*), " +
      "SUM(cents), 0, COUNT(DISTINCT bid), COUNT(DISTINCT oid), COUNT(*) FROM records WHERE sid IS NOT NULL GROUP BY sid, src, fy"),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'pwgsc-tpsgc', 'Public Services and Procurement Canada', " +
      "'Services publics et Approvisionnement Canada')").bind(PSPC),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dnd-mdn', 'National Defence', 'Défense nationale')").bind(DND),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dfo-mpo', 'Fisheries and Oceans Canada', 'Pêches et Océans Canada')").bind(DFO),
    ...DETAILS.map((d, i) => RECORDS.prepare(
      "INSERT INTO rec_details (k, src, day, bid, oid, cents, vnote, comp, ref, title_en) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)",
    ).bind(i + 1, d.src, d.day, d.bid, d.oid, d.cents, `ref-${i}`, `Detail ${i}`)),
    ...EXPIRING.map((x, i) => RECORDS.prepare(
      "INSERT INTO rec_expiring (k, endd, oid, buyer, client, segs, kind, comp, cad, cents, nv, so, m31, j) VALUES (?, ?, ?, ?, NULL, ' 81 ', ?, 1, ?, ?, 0, 0, ?, ?)",
    ).bind(i + 1, x.endd, x.oid, x.buyer, x.kind, x.cents, x.cents, x.m31, x.j)),
    ...EVENTS.map((x, i) => RECORDS.prepare(
      "INSERT INTO rec_events (k, day, kind, src, oid, buyer, ref, more, path, title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '/x', 'An event')",
    ).bind(i + 1, x.day, x.kind, x.src, x.oid, x.buyer, x.ref, x.more)),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(asOf),
  ]);
}

// Two names the hosted search finds.
async function seedSearch(): Promise<void> {
  await applySql(SEARCH, SEARCH_SCHEMA);
  await SEARCH.batch([SEARCH.prepare("DELETE FROM search_orgs"), SEARCH.prepare("DELETE FROM search_buyers")]);
  const sql = "INSERT INTO search_orgs (id, name, alt, bn, folds, prov, city, n_awards, n_history, n_contracts, n_grants, n_lobbying, " +
    "n_records, total_awards, total_history, total_contracts, total_grants, hash) VALUES (?, ?, '', '', ?, ?, ?, 3, 0, 1, 1, 0, 5, NULL, NULL, NULL, NULL, 'h')";
  await SEARCH.batch([
    SEARCH.prepare(sql).bind(A1, NAME1, foldText(NAME1), "ON", "Ottawa"),
    SEARCH.prepare(sql).bind(A2, NAME2, foldText(NAME2), "BC", "Victoria"),
  ]);
}

beforeAll(async () => {
  await seedRecords();
  await seedSearch();
});

// -- accounts ----------------------------------------------------------------------------------

type Reader = { email: string; id: string; cookie: string; csrf: string };

async function reader(tag: string, pro = false): Promise<Reader> {
  const email = newEmail(tag);
  const cookie = await signIn(email, { env: E() });
  if (pro) await grantPro(email);
  return { email, id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env: E() }) };
}

const page = (r: Reader, path = "/account/organization", extra: Record<string, unknown> = {}) => get(path, { cookie: r.cookie, env: E(extra) });
const send = (r: Reader, path: string, fields: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  post(path, { csrf: r.csrf, ...fields }, { cookie: r.cookie, env: E(extra) });

type ClaimRow = { organization_id: string; segment: string | null; competitors: string; created_at: string; updated_at: string };
const claimRow = (id: string) => ACCOUNTS.prepare("SELECT organization_id, segment, competitors, created_at, updated_at FROM org_claims WHERE user_id = ?")
  .bind(id).first<ClaimRow>();
const claimRows = async (id: string) => ((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM org_claims WHERE user_id = ?").bind(id).first<{ n: number }>())?.n ?? 0);

// -- the claim ---------------------------------------------------------------------------------

describe("the claim", () => {
  it("is the site's 404 while the switch is off, and needs a session", async () => {
    expect((await get("/account/organization", { env: offEnv() })).status).toBe(404);
    const out = await get("/account/organization", { env: E() });
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/account/sign-in?next=%2Faccount%2Forganization");
  });

  it("stores only a checked id: a pasted profile address, an alias followed; anything else refused and nothing stored", async () => {
    const r = await reader("claim-checked");
    const first = await page(r);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.headers.get("x-robots-tag")).toContain("noindex");
    const html = await text(first);
    expect(html).toContain("Your choice is private to your account and changes nothing public");
    for (const bad of ["not an id", "org-ffffffffff", "https://example.com/organizations/org-ffffffffff", "org-a00000000d", ""]) {
      const res = await send(r, "/account/organization", { org: bad });
      expect(res.status, bad).toBe(400);
      expect(await text(res)).toContain("No organization profile has that address.");
    }
    expect(await claimRows(r.id)).toBe(0);
    // A pasted address of a retired id: the surviving profile's id is what is kept.
    const ok = await send(r, "/account/organization", { org: `${SITE}/organizations/org-a00000000f?lang=fr` });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/account/organization?m=claimed");
    const row = await claimRow(r.id);
    expect(row?.organization_id).toBe(A1);
    expect(row?.competitors).toBe("[]");
    expect(row?.segment).toBeNull();
    const audit = await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = 'org_claimed'").bind(r.id).first<{ detail: string }>();
    expect(audit?.detail).toBe(A1);
    const after = await text(await page(r));
    expect(after).toContain("You have told the site this is your organization. The site does not check this and shows it to no one else.");
    expect(after).toContain(`<a href="/organizations/${A1}">${NAME1}</a>`);
  });

  it("finds the organization by name through the hosted search, each result with its button", async () => {
    const r = await reader("claim-search");
    const html = await text(await page(r, "/account/organization?q=exemplar"));
    expect(html).toContain("1 organization matches.");
    expect(html).toContain(NAME1);
    expect(html).toContain("Ottawa, Ontario");
    expect(html).toContain(`<input type="hidden" name="org" value="${A1}"/>`);
    expect(html).toContain("This is us");
    expect(html).not.toContain(NAME2);
    // No search database: the page says so and points to the pasted address.
    const without = await text(await page(r, "/account/organization?q=exemplar", { SEARCH: undefined }));
    expect(without).toContain("The search is not available right now.");
    // A pasted address finds its profile without the search.
    const pasted = await text(await page(r, `/account/organization?q=${encodeURIComponent(`/organizations/${A2}`)}`, { SEARCH: undefined }));
    expect(pasted).toContain(NAME2);
    expect(pasted).toContain("Victoria, British Columbia");
  });

  it("replaces the first claim with a second", async () => {
    const r = await reader("claim-second", true);
    await send(r, "/account/organization", { org: A1 });
    await send(r, "/account/organization/segment", { segment: "81" });
    const before = await claimRow(r.id);
    expect(before?.segment).toBe("81");
    // The same organization again keeps its time and segment.
    await send(r, "/account/organization", { org: A1 });
    expect((await claimRow(r.id))?.segment).toBe("81");
    await send(r, "/account/organization", { org: A2 });
    expect(await claimRows(r.id)).toBe(1);
    const after = await claimRow(r.id);
    expect(after?.organization_id).toBe(A2);
    expect(after?.segment).toBeNull();
    expect(after!.created_at >= before!.created_at).toBe(true);
    // A bad segment is refused; "" is the largest.
    expect((await send(r, "/account/organization/segment", { segment: "99" })).status).toBe(400);
    expect((await send(r, "/account/organization/segment", { segment: "" })).status).toBe(303);
    expect((await claimRow(r.id))?.segment).toBeNull();
  });

  it(`holds ${COMPETITORS_MAX} competitors and no more, in the order chosen`, async () => {
    const r = await reader("claim-compare");
    // Nothing to compare before a claim.
    expect((await send(r, "/account/organization/compare", { org: A2 })).headers.get("location")).toBe("/account/organization");
    await send(r, "/account/organization", { org: A1 });
    const where = async (org: string) => (await send(r, "/account/organization/compare", { org })).headers.get("location");
    for (const org of [A2, ...MORE.slice(0, 4)]) expect(await where(org)).toBe("/account/organization?m=added");
    expect(await where(MORE[4])).toBe("/account/organization?m=full");
    expect(await where(A1)).toBe("/account/organization?m=self");
    expect(JSON.parse((await claimRow(r.id))!.competitors)).toEqual([A2, ...MORE.slice(0, 4)]);
    expect((await send(r, "/account/organization/compare", { org: "org-ffffffffff" })).status).toBe(400);
    // Out with one, then a duplicate refused, then the fifth again.
    expect((await send(r, "/account/organization/compare/remove", { org: MORE[0] })).headers.get("location")).toBe("/account/organization?m=removed");
    expect(await where(A2)).toBe("/account/organization?m=exists");
    expect(await where(MORE[4])).toBe("/account/organization?m=added");
    expect(JSON.parse((await claimRow(r.id))!.competitors)).toEqual([A2, ...MORE.slice(1, 5)]);
    // The table holds the cap too, whatever writes to it.
    const six = JSON.stringify([A2, ...MORE]);
    await expect(ACCOUNTS.prepare("UPDATE org_claims SET competitors = ? WHERE user_id = ?").bind(six, r.id).run()).rejects.toThrow();
    // The page lists them in that order, each with its button.
    const html = await text(await page(r));
    expect(html).toContain("5 of 5");
    const order = [NAME2, ...MORE.slice(1, 5).map((_, i) => `Compared Organization ${i + 4}`)].map((name) => html.indexOf(`>${name}</a>`));
    expect(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]))).toBe(true);
    expect(html).toContain("The comparison holds 5, the most it takes.");
  });

  it("follows a merged organization and drops a competitor that is gone, with a line", async () => {
    const r = await reader("claim-merge");
    await ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)")
      .bind(r.id, "org-a00000000f", JSON.stringify([A2, "org-ffffffffff"]), "2026-10-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z").run();
    const html = await text(await page(r));
    expect(html).toContain("The organization you chose was merged into another profile; your choice now follows that profile.");
    expect(html).toContain("1 organization is no longer in the data and was taken out of the comparison.");
    const row = await claimRow(r.id);
    expect(row?.organization_id).toBe(A1);
    expect(JSON.parse(row!.competitors)).toEqual([A2]);
    expect(row?.created_at).toBe("2026-10-01T00:00:00.000Z");
  });

  it("goes with the account on deletion, and with the remove button before that", async () => {
    const r = await reader("claim-delete");
    await send(r, "/account/organization", { org: A1 });
    expect((await send(r, "/account/organization/delete")).headers.get("location")).toBe("/account/organization?m=unclaimed");
    expect(await claimRows(r.id)).toBe(0);
    await send(r, "/account/organization", { org: A1 });
    expect(await claimRows(r.id)).toBe(1);
    expect(await text(await page(r, "/account/delete"))).toContain("The organization you told the site is yours");
    expect((await send(r, "/account/delete", { confirm: "yes" })).status).toBe(200);
    expect(await claimRows(r.id)).toBe(0);
  });
});

// -- the claimed organization's watch -----------------------------------------------------------

type WatchRow = { kind: string; target: string; segment: string; label: string; events: string; cadence: string };
const watchRows = async (id: string) =>
  (await ACCOUNTS.prepare("SELECT kind, target, segment, label, events, cadence FROM watches WHERE user_id = ? ORDER BY created_at, id").bind(id)
    .all<WatchRow>()).results ?? [];
// A new organization watch follows every kind of its own (watch_events.ts KINDS_FOR), the instrument kinds included.
const ORG_KINDS = "award,grant,amended,cancelled,ends_12m,ends_6m,ended,instrument_gained,instrument_lost,instrument_expires_6m";

describe("the claimed organization's watch", () => {
  it("is made on the claim with the default kinds, audited, and made once for the same organization", async () => {
    const r = await reader("watch-made");
    await send(r, "/account/organization", { org: A1 });
    expect(await watchRows(r.id)).toEqual([{ kind: "organization", target: A1, segment: "", label: NAME1, events: ORG_KINDS, cadence: "daily" }]);
    const added = async () => ((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM audit WHERE user_id = ? AND event = 'watch_added' AND detail = 'organization'")
      .bind(r.id).first<{ n: number }>())?.n ?? 0);
    expect(await added()).toBe(1);
    // The same organization again, and its retired id: no second watch, no second audit row.
    await send(r, "/account/organization", { org: A1 });
    await send(r, "/account/organization", { org: "org-a00000000f" });
    expect(await watchRows(r.id)).toHaveLength(1);
    expect(await added()).toBe(1);
    // The watch mail row the first watch makes, on.
    expect((await ACCOUNTS.prepare("SELECT mail FROM watch_mail WHERE user_id = ?").bind(r.id).first<{ mail: string }>())?.mail).toBe("on");
  });

  it("keeps the account's mail setting and every watch it held, when the claim changes or goes", async () => {
    const r = await reader("watch-keep", true);
    await ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'off', ?)").bind(r.id, `${DAY}T00:00:00.000Z`).run();
    await send(r, "/account/organization", { org: A1 });
    await send(r, "/account/organization", { org: A2 });
    expect((await watchRows(r.id)).map((w) => w.target)).toEqual([A1, A2]);
    expect((await ACCOUNTS.prepare("SELECT mail FROM watch_mail WHERE user_id = ?").bind(r.id).first<{ mail: string }>())?.mail).toBe("off");
    await send(r, "/account/organization/delete");
    expect((await watchRows(r.id)).map((w) => w.target)).toEqual([A1, A2]);
  });

  it("follows the claim's merge: a retired id claimed is watched as the surviving one", async () => {
    const r = await reader("watch-merge");
    await send(r, "/account/organization", { org: `${SITE}/organizations/org-a00000000f` });
    expect((await watchRows(r.id)).map((w) => w.target)).toEqual([A1]);
  });
});

// -- the page ------------------------------------------------------------------------------------

// A records binding that writes down the size of each batch it runs.
function counting(db: D1Database): { binding: D1Database; sizes: number[] } {
  const sizes: number[] = [];
  return { sizes, binding: { prepare: (s: string) => db.prepare(s), batch: (st: D1PreparedStatement[]) => (sizes.push(st.length), db.batch(st)) } as unknown as D1Database };
}

describe("the page", () => {
  let free: Reader;
  let pro: Reader;
  beforeAll(async () => {
    free = await reader("page-free");
    pro = await reader("page-pro", true);
    for (const r of [free, pro]) await send(r, "/account/organization", { org: A1 });
    await send(pro, "/account/organization/compare", { org: A2 });
  });

  it("gives a Free account the first block for the latest three fiscal years, and every other block's title with the chip", async () => {
    const html = await text(await page(free));
    expect(html).toContain("Records by Fiscal Year");
    expect(html).toContain("2024-25");
    expect(html).toContain("2026-27 (to date)");
    expect(html).not.toContain("2020-21");
    // The award notices of 2024-25 and 2025-26 and the published contract of 2026-27; no history or grant in those years.
    expect(html).toContain("$1,000,000");
    expect(html).toContain("$500,000");
    expect(html).toContain("$12,345");
    expect(html).not.toContain(">PSPC contract history</button></th>");
    expect(html).toContain("The Free plan shows the latest 3 fiscal years; Pro shows 10 and the blocks below.");
    for (const title of ["Records by Segment", "Share of a Segment", "Contracts Ending Within 12 Months", "Buyers It Has Won From", "Registry Match"]) {
      expect(html, title).toMatch(new RegExp(`<h2>${title}<span class="pro-tag">`));
    }
    expect(html).not.toContain("/account/organization/years.csv");
    expect(html).not.toContain('href="/segments/81"');
    expect(html).not.toContain(EM_DASH);
  });

  it("gives Pro every block in one records batch, with its CSV file", async () => {
    const recorded = counting(RECORDS);
    const res = await page(pro, "/account/organization", { RECORDS: recorded.binding });
    expect(res.status).toBe(200);
    expect(recorded.sizes).toHaveLength(1);
    expect(recorded.sizes[0]).toBeLessThanOrEqual(1 + CLAIM_BATCH_MAX);
    const html = await text(res);
    expect(html).not.toContain(EM_DASH);
    for (const block of ["years", "segments", "share", "ending", "buyers"]) expect(html, block).toContain(`/account/organization/${block}.csv`);
    // Ten fiscal years, each source apart; the year before them left out.
    expect(html).toContain("2017-18");
    expect(html).toContain("2020-21");
    expect(html).not.toContain("2015-16");
    expect(html).toContain(">PSPC contract history</button></th>");
    // By segment: each record once, in its first segment (77 is a further one), the two sources apart.
    expect(html).toContain('href="/segments/81"');
    expect(html).toContain('href="/segments/43"');
    expect(html).not.toContain('href="/segments/77"');
    expect(html).toContain("(published contracts: 1; grants: 1)");
    // The share of segment 81 (its largest, no segment chosen): 2024-25 all of $1,000,000; 2025-26 a quarter of
    // $2,000,000 each, the withheld $1,000,000 in the denominator alone; over the period 50% and 17% of $3,000,000.
    expect(html).toContain("The largest: 81");
    expect(html).toContain("Records whose supplier is withheld count in the segment's value and in no organization's share");
    expect(html).toMatch(/2025-26<\/td><td[^>]*>\$2,000,000<\/td><td[^>]*>25%<br\/><span class="muted small">\$500,000<\/span><\/td><td[^>]*>25%<br\/>/);
    expect(html).toMatch(/2024-25<\/td><td[^>]*>\$1,000,000<\/td><td[^>]*>100%<br\/><span class="muted small">\$1,000,000<\/span><\/td><td[^>]*>0%<br\/>/);
    expect(html).toMatch(/10 fiscal years<\/strong><\/td><td[^>]*>\$3,000,000<\/td><td[^>]*>50%<br\/>.*?<\/td><td[^>]*>17%<br\/>/);
    // The table's columns are the organization's, then the competitors in the order chosen.
    expect(html.indexOf(`<th class="k-share num"><button type="button" class="th-sort">${NAME1}</button></th>`)).toBeLessThan(html.indexOf(`<th class="k-share num"><button type="button" class="th-sort">${NAME2}</button></th>`));
    // Its contracts ending within 12 months: two of the three, the soonest first, and the radar's own filter for all of them.
    expect(html).toContain("2 contracts of this organization end within 12 months of the data date, the soonest on 2027-01-15; their counted value is $500,000.");
    expect(html.indexOf("Contract EN578-111111-001")).toBeLessThan(html.indexOf("Contract F1700-222222"));
    expect(html).not.toContain("Contract EN578-333333-001");
    expect(html).toContain(`href="/expiring/12m?supplier=${A1}"`);
    // The buyers: PSPC with three records (award notices and a grant apart), Fisheries and Oceans with two; their open
    // notices from the buyers index and their contracts ending within 12 months, whoever holds them.
    expect(html.indexOf(">Public Services and Procurement Canada</a>")).toBeLessThan(html.indexOf(">Fisheries and Oceans Canada</a>"));
    expect(html).toContain("Award notices: </span><span class=\"mono small\">2 · $1,500,000</span>");
    expect(html).toContain("Grants and contributions: </span><span class=\"mono small\">1 · $40,000</span>");
    expect(html).toContain('<a href="/tenders?buyer=pwgsc-tpsgc">1</a>');
    expect(html).toContain('<a href="/expiring/12m?buyer=pwgsc-tpsgc">1</a>');
    expect(html).toContain('<a href="/expiring/12m?buyer=dfo-mpo">2</a>');
    expect(html).toContain(`the first 2 here`);
    // The registry match, as the profile shows it.
    expect(html).toContain("Exact name match · <span class=\"mono\">0000001</span>");
    expect(BUYERS_SHOWN).toBe(25);
  });

  // The tips (src/chart.tsx, public/tooltip.js): each bar's SVG <title> is the
  // series and the fiscal year over the exact figures.
  it("gives the charts' bars their exact figures as their tip: the value and its records, the share and its parts", async () => {
    const marks = (html: string) => [...html.matchAll(/<path\b[^>]*><title>([^<]*)<\/title>/g)].map((m) => decode(m[1]));
    const tips = marks(await text(await page(pro)));
    expect(tips).toContain("Award notices: value by fiscal year, 2024-25\n$1,000,000\n1 record");
    expect(tips).toContain("Published contracts: value by fiscal year, 2026-27 (to date)\n$12,345\n1 record");
    // The share of segment 81: a quarter of $2,000,000 in 2025-26, all of $1,000,000 in 2024-25.
    expect(tips).toContain(`${NAME1}, 2025-26\n$500,000 of $2,000,000 (25%)`);
    expect(tips).toContain(`${NAME1}, 2024-25\n$1,000,000 of $1,000,000 (100%)`);
    for (const t of tips) expect(t, t).not.toMatch(/\d[MB]\b/);
    // text() reads the typographic apostrophe as a straight one.
    const fr = marks(await text(await page(pro, "/account/organization?lang=fr")));
    expect(fr).toContain("Avis d'attribution : valeur par exercice, 2024-2025\n1 000 000 $\n1 dossier");
    expect(fr).toContain(`${NAME1}, 2025-2026\n500 000 $ sur 2 000 000 $ (25 %)`);
  });

  it("shows the share of a chosen segment and source, and says when there is no record to compare", async () => {
    await send(pro, "/account/organization/segment", { segment: "43" });
    const html = await text(await page(pro, "/account/organization?source=history"));
    expect(html).toMatch(/<a href="\/account\/organization\?source=history" rel="nofollow" aria-current="page">PSPC contract history<\/a>/);
    expect(html).toMatch(/2020-21<\/td><td[^>]*>\$200,000<\/td><td[^>]*>100%<br\/>/);
    expect(html).toContain("/account/organization/share.csv?source=history");
    const awards = await text(await page(pro));
    // Segment 43 holds no award notice: the share block says the segment has no value.
    expect(awards).toContain("The segment has no counted value in these fiscal years.");
    await send(pro, "/account/organization/segment", { segment: "" });
  });

  it("keeps the claim and the comparison when the records database cannot answer", async () => {
    const html = await text(await page(pro, "/account/organization", { RECORDS: undefined }));
    expect(html).toContain("Figures Not Available Right Now");
    expect(html).toContain(`>${NAME2}</a>`);
    expect(html).toContain(`<a href="/organizations/${A1}">${NAME1}</a>`);
    const csv = await page(pro, "/account/organization/years.csv", { RECORDS: undefined });
    expect(csv.status).toBe(503);
    expect(csv.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is French on a French request, with no em-dash", async () => {
    const html = await text(await page(pro, "/account/organization?lang=fr"));
    expect(html).toContain("Votre organisation");
    expect(html).toContain("Dossiers par exercice");
    expect(html).toContain("Part d'un segment");
    expect(html).not.toContain("Records by Fiscal Year");
    expect(html).not.toContain(EM_DASH);
  });

  it("links the page from the account's overview, with the organization's name", async () => {
    const html = await text(await page(pro, "/account"));
    expect(html).toContain('<a href="/account/organization">Your organization</a><span class="kv-note">Exemplar Translation Services Inc.</span>');
    const none = await reader("page-none");
    expect(await text(await page(none, "/account"))).toContain('<span class="kv-note">None chosen yet</span>');
  });
});

// -- the standing offers and supply arrangements ----------------------------------------------------

describe("the standing offers and supply arrangements block", () => {
  let free: Reader;
  let pro: Reader;
  beforeAll(async () => {
    free = await reader("sosa-free");
    pro = await reader("sosa-pro", true);
    for (const r of [free, pro]) await send(r, "/account/organization", { org: A1 });
  });
  const link = (agr: string) => `/instruments/${encodeURIComponent(agr)}`;

  it("lists for Pro the instruments the organization holds, soonest expiry first, in the page's one batch", async () => {
    const recorded = counting(RECORDS);
    const html = await text(await page(pro, "/account/organization", { RECORDS: recorded.binding }));
    expect(recorded.sizes).toEqual([1 + 7]);
    // Three held: the other organization's and the unprofiled holder's rows add none; the CSV file in the head.
    expect(html).toMatch(/<h2>Standing Offers and Supply Arrangements<\/h2><div class="panel-tools"><span class="panel-count">3<\/span>/);
    expect(html).toContain('<a href="/account/organization/instruments.csv" rel="nofollow">');
    const at = [AGR.nmso, AGR.rmso, AGR.sa].map((a) => html.indexOf(`<a href="${link(a)}" class="mono">${a}</a>`));
    expect(at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1])), at.join(",")).toBe(true);
    expect(link(AGR.rmso)).toBe("/instruments/E60ZT-120002%2F001%2FZT");
    // Each instrument's type, description, regions, end user and expiry.
    expect(html).toContain("Regional master standing offer");
    expect(html).toContain("Environmental consulting services");
    expect(html).toContain("Alberta, British Columbia");
    expect(html).toContain('<a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a>');
    expect(html).toContain(">All government departments</td>");
    expect(html).toContain("2027-06-30 (242 days left)");
    expect(html).toContain("2028-03-31 (517 days left)");
    expect(html).toContain("National Capital Region");
    expect(html).toContain("National (all regions)");
    expect(html).toContain(`the first 3 here, all of them in the CSV file and in <a href="/organizations/${A1}#instruments">its profile's section</a>`);
    // It comes after the buyers block and before the registry match.
    expect(html.indexOf("Buyers It Has Won From")).toBeLessThan(html.indexOf("<h2>Standing Offers and Supply Arrangements</h2>"));
    expect(html.indexOf("<h2>Standing Offers and Supply Arrangements</h2>")).toBeLessThan(html.indexOf("<h2>Registry Match</h2>"));
    expect(html).not.toContain(EM_DASH);
  });

  it(`shows ${INSTRUMENTS_SHOWN} and links the profile's section for the rest`, async () => {
    const r = await reader("sosa-many", true);
    await send(r, "/account/organization", { org: MANY });
    const html = await text(await page(r));
    expect(html).toMatch(new RegExp(`<h2>Standing Offers and Supply Arrangements</h2><div class="panel-tools"><span class="panel-count">${MANY_N}</span>`));
    expect(html).toContain(link(manyAgr(INSTRUMENTS_SHOWN)));
    expect(html).not.toContain(link(manyAgr(INSTRUMENTS_SHOWN + 1)));
    expect(html).toContain(`<a href="/organizations/${MANY}#instruments">All ${MANY_N} on its profile</a>`);
    expect(html).toContain(`the first ${INSTRUMENTS_SHOWN} here`);
    const csv = (await (await page(r, "/account/organization/instruments.csv")).text()).trim().split("\r\n");
    expect(csv).toHaveLength(1 + MANY_N);
  });

  it("says when the organization holds none", async () => {
    const r = await reader("sosa-none", true);
    await send(r, "/account/organization", { org: A2 });
    const html = await text(await page(r));
    expect(html).toContain("This organization holds no active standing offer or supply arrangement.");
    expect(html).not.toContain("/account/organization/instruments.csv");
  });

  it("gives Free the title with the chip and one line", async () => {
    const html = await text(await page(free));
    expect(html).toMatch(/<h2>Standing Offers and Supply Arrangements<span class="pro-tag">/);
    expect(html).toContain("The standing offers and supply arrangements it holds now, soonest expiry first, with the type, regions and end user of each and the CSV file.");
    expect(html).not.toContain(link(AGR.nmso));
    expect(html).not.toContain("/account/organization/instruments.csv");
  });

  it("is French on a French request, with no em-dash", async () => {
    const html = await text(await page(pro, "/account/organization?lang=fr"));
    expect(html).toContain("<h2>Offres à commandes et arrangements en matière d'approvisionnement</h2>");
    expect(html).toContain("Offre à commandes principale régionale");
    expect(html).toContain("2027-06-30 (242 jours restants)");
    expect(html).toContain(">Tous les ministères</td>");
    expect(html).toContain("Alberta, Colombie-Britannique");
    expect(html).not.toContain("Standing Offers and Supply Arrangements");
    expect(html).not.toContain(EM_DASH);
    const tease = await text(await page(free, "/account/organization?lang=fr"));
    expect(tease).toMatch(/<h2>Offres à commandes et arrangements en matière d'approvisionnement<span class="pro-tag">/);
    expect(tease).not.toContain(EM_DASH);
  });

  it("is a CSV file for Pro, private and never kept, a download; the site's 404 for Free", async () => {
    expect((await page(free, "/account/organization/instruments.csv")).status).toBe(404);
    const res = await page(pro, "/account/organization/instruments.csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="organization-${A1}-instruments-${DAY}.csv"`);
    expect(bucketFor("GET", "/account/organization/instruments.csv")).toBe("download");
    expect((await res.text()).trim().split("\r\n")).toEqual([
      "agreement_number,type,type_en,type_fr,description_en,description_fr,end_user_en,end_user_fr,end_user_buyer_id,regions,start,expiry,days_left,url",
      `${AGR.nmso},NMSO,National Master Standing Offer,,Translation services,Services de traduction,All government departments,Tous les ministères,,NC,` +
        `2025-06-01,2027-06-30,242,http://localhost${link(AGR.nmso)}`,
      `${AGR.rmso},RMSO,Regional Master Standing Offer,Offre à commandes principale régionale,Environmental consulting services,` +
        "Services d'experts-conseils en environnement,Public Services and Procurement Canada,Services publics et Approvisionnement Canada," +
        `pwgsc-tpsgc,AB BC,2024-04-01,2028-03-31,517,http://localhost${link(AGR.rmso)}`,
      `${AGR.sa},SA,Supply Arrangement,,Geospatial data services,,,,,NA,,,,http://localhost${link(AGR.sa)}`,
    ]);
    // The records database not answering: 503, still private.
    const down = await page(pro, "/account/organization/instruments.csv", { RECORDS: undefined });
    expect(down.status).toBe(503);
    expect(down.headers.get("cache-control")).toBe("private, no-store");
  });

  it("reads rec_holders through its organization index, each instrument by its key, and bounded", async () => {
    const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${CLAIM_INSTRUMENTS_SQL}`).bind(n(A1)).all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    // rec_holders_org (records_schema.sql) finds the organization's rows; rec_instruments is sought by its integer key.
    expect(steps.some((s) => /^SEARCH h USING INDEX rec_holders_org/.test(s)), steps.join("\n")).toBe(true);
    expect(steps.filter((s) => /^SCAN /.test(s)), steps.join("\n")).toEqual([]);
    expect(steps.some((s) => /^SEARCH i USING INTEGER PRIMARY KEY/.test(s)), steps.join("\n")).toBe(true);
    expect(CLAIM_INSTRUMENTS_SQL).toMatch(/LIMIT 10000$/);
    expect(CLAIM_RECORDS_SQL).not.toContain(CLAIM_INSTRUMENTS_SQL);
  });
});

// -- the files ------------------------------------------------------------------------------------

describe("the files", () => {
  let free: Reader;
  let pro: Reader;
  beforeAll(async () => {
    free = await reader("csv-free");
    pro = await reader("csv-pro", true);
    for (const r of [free, pro]) await send(r, "/account/organization", { org: A1 });
    await send(pro, "/account/organization/compare", { org: A2 });
  });

  it("are Pro, private and never kept, and count as downloads", async () => {
    for (const block of ["years", "segments", "share", "ending", "buyers"]) {
      expect((await page(free, `/account/organization/${block}.csv`)).status, block).toBe(404);
      const res = await page(pro, `/account/organization/${block}.csv`);
      expect(res.status, block).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("content-disposition")).toBe(`attachment; filename="organization-${A1}-${block}${block === "share" ? "-awards" : ""}-${DAY}.csv"`);
    }
    expect((await page(pro, "/account/organization/other.csv")).status).toBe(404);
    expect(bucketFor("GET", "/account/organization/years.csv")).toBe("download");
    expect(bucketFor("HEAD", "/account/organization/years.csv")).toBe("page");
  });

  it("write each block's rows: each source apart, the share with every organization in every year", async () => {
    const lines = async (block: string) => (await (await page(pro, `/account/organization/${block}.csv`)).text()).trim().split("\r\n");
    expect(await lines("years")).toEqual([
      "fiscal_year,fiscal_year_label,source,records,value_cad",
      "2024,2024-25,awards,1,1000000.00", "2025,2025-26,awards,1,500000.00", "2020,2020-21,history,1,200000.00",
      "2026,2026-27,contracts,1,12345.00", "2018,2018-19,grants,1,40000.00",
    ]);
    expect(await lines("segments")).toEqual([
      "segment,segment_title,source,records,value_cad", expect.stringMatching(/^81,.*,awards,2,1500000\.00$/), expect.stringMatching(/^43,.*,history,1,200000\.00$/),
    ]);
    const share = await lines("share");
    expect(share[0]).toBe("segment,source,fiscal_year,fiscal_year_label,segment_value_cad,organization_id,organization,records,value_cad,share_pct");
    expect(share).toHaveLength(1 + 10 * 2);
    expect(share).toContain(`81,awards,2025,2025-26,2000000.00,${A1},${NAME1},1,500000.00,25.0`);
    expect(share).toContain(`81,awards,2025,2025-26,2000000.00,${A2},${NAME2},1,500000.00,25.0`);
    expect(share).toContain(`81,awards,2024,2024-25,1000000.00,${A2},${NAME2},0,0.00,0.0`);
    expect(share).toContain(`81,awards,2019,2019-20,0.00,${A1},${NAME1},0,0.00,`);
    const ending = await lines("ending");
    expect(ending[0]).toContain("kind,reference,title_en");
    expect(ending.slice(1).map((l) => l.split(",")[1])).toEqual(["EN578-111111-001", "F1700-222222"]);
    const buyers = await lines("buyers");
    expect(buyers[0]).toBe("buyer_id,buyer,buyer_fr,records,records_awards,value_awards_cad,records_history,value_history_cad,records_contracts," +
      "value_contracts_cad,records_grants,value_grants_cad,open_notices,contracts_ending_12m");
    expect(buyers[1]).toBe("pwgsc-tpsgc,Public Services and Procurement Canada,Services publics et Approvisionnement Canada,3,2,1500000.00,0,,0,,1,40000.00,1,1");
    expect(buyers[2]).toBe("dfo-mpo,Fisheries and Oceans Canada,Pêches et Océans Canada,2,0,,1,200000.00,1,12345.00,0,,1,2");
  });
});

// -- the public profile ------------------------------------------------------------------------------

describe("the public profile", () => {
  it("is byte-identical for a reader without the claim, before and after it", async () => {
    const other = await reader("profile-other");
    const read = async (cookie?: string) => (await get(`/organizations/${A1}`, { cookie, env: E() })).text();
    const before = [await read(), await read(other.cookie)];
    const claimant = await reader("profile-claimant", true);
    await send(claimant, "/account/organization", { org: A1 });
    await send(claimant, "/account/organization/compare", { org: A2 });
    expect(await read()).toBe(before[0]);
    expect(await read(other.cookie)).toBe(before[1]);
    // Nothing on the profile names a claim, for the claimant either.
    const own = await read(claimant.cookie);
    expect(own).not.toContain("/account/organization");
    expect(own).not.toContain("This is us");
  });
});

// -- the console --------------------------------------------------------------------------------------

describe("the console", () => {
  it("counts the claims, names the most-claimed ids, and shows one account's claim", async () => {
    const email = newEmail("op-claims");
    const opEnv = E({ OPERATOR_EMAILS: email });
    const cookie = await signIn(email, { env: opEnv });
    const r = await reader("console-claimant");
    await send(r, "/account/organization", { org: A2 });
    await send(r, "/account/organization/compare", { org: MORE[0] });
    const overview = await text(await get("/admin", { cookie, env: opEnv }));
    expect(overview).toContain("Organizations Chosen");
    expect(overview).toMatch(new RegExp(`<a href="/organizations/${A1}">${A1}</a> \\d+`));
    expect(overview).toContain(`<a href="/organizations/${A2}">${A2}</a>`);
    const user = await text(await get(`/admin/users/${r.id}`, { cookie, env: opEnv }));
    expect(user).toContain(`<a href="/organizations/${A2}" class="mono">${A2}</a>`);
    expect(user).toContain(`<a href="/organizations/${MORE[0]}">${MORE[0]}</a>`);
    expect(user).toContain("largest (default)");
  });
});

// -- the statements --------------------------------------------------------------------------------

describe("the statements", () => {
  const plan = async (db: D1Database, sql: string, binds: (string | number)[]) =>
    ((await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail));
  const slots = (sql: string) => Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));

  it("are bounded, and read every table through an index", async () => {
    const f = claimFrame(DAY);
    for (const sql of CLAIM_RECORDS_SQL) {
      expect(sql, sql).toMatch(/LIMIT \d+(?: OFFSET \?13)?$/);
      const binds = Array.from({ length: slots(sql) }, (_, i) => (i === 0 ? n(A1) : i < 3 ? f.first : i === 3 ? f.current : -1));
      const steps = await plan(RECORDS, sql, binds);
      expect(steps.filter((s) => /^SCAN (records|rec_\w+|d|e|b|rb|p|y|r)\b/.test(s) && !/USING|SUBQUERY/.test(s) && !/^SCAN (p|r)$/.test(s)), `${sql}\n${steps.join("\n")}`)
        .toEqual([]);
      expect(steps.some((s) => /USING (COVERING )?INDEX/.test(s)), `${sql}\n${steps.join("\n")}`).toBe(true);
    }
  });

  it("reads the share of six organizations through records_org, with the organization view's rows", async () => {
    const f = claimFrame(DAY);
    const six = [n(A1), n(A2), ...MORE.slice(0, 4).map(n)];
    for (const sql of [CLAIM_SHARE_SQL, CLAIM_SHARE_LARGEST_SQL]) {
      const steps = await plan(RECORDS, sql, [81, 1, f.first, f.current, ...six]);
      expect(steps.some((s) => s.includes(" records_org ")), steps.join("\n")).toBe(true);
      expect(steps.some((s) => s.includes(" records_segment ")), steps.join("\n")).toBe(false);
      expect(steps.some((s) => s.includes(" rec_segment_years_segment ")), steps.join("\n")).toBe(true);
    }
    // The same rows as the organization view's statement when it compares the same six and no others.
    const rows = async (sql: string, binds: (string | number)[]) => (await RECORDS.prepare(sql).bind(...binds).all()).results;
    for (const [sid, src] of [[81, 1], [43, 2], [77, 1]]) {
      const binds = [sid, src, f.first, f.current, ...six];
      const mine = await rows(CLAIM_SHARE_SQL, binds);
      expect(mine.length, `${sid}`).toBeGreaterThan(0);
      expect(mine).toEqual(await rows(ORG_SHARE_SQL, [...binds, 0]));
    }
    // The largest, unnamed: segment 81 for the award notices (77 is a further segment of a notice whose first is 81).
    expect(await rows(CLAIM_SHARE_LARGEST_SQL, [-1, 1, f.first, f.current, ...six])).toEqual(await rows(CLAIM_SHARE_SQL, [81, 1, f.first, f.current, ...six]));
  });

  it("name the indexes the spec gives them", async () => {
    const f = claimFrame(DAY);
    const named: [string, (string | number)[], string[]][] = [
      [CLAIM_RECORDS_SQL[7], [n(A1), f.firstDay, DAY, DAY, f.endLast], ["rec_details_org", "rec_expiring_buyer"]],
      [CLAIM_RECORDS_SQL[8], [n(A1), "2026-10-25", DAY], ["rec_events_org"]],
      [CLAIM_RECORDS_SQL[9], [DAY, f.endLast, n(A1)], ["rec_expiring_end"]],
      [CLAIM_RECORDS_SQL[10], [n(A1), f.firstDay, DAY, "2026-10-25", DAY], ["rec_details_org", "rec_events_buyer"]],
    ];
    for (const [sql, binds, indexes] of named) {
      const steps = (await plan(RECORDS, sql, binds)).join("\n");
      for (const ix of indexes) expect(steps, `${sql}\n${steps}`).toContain(ix);
    }
    // The accounts side: the claim by its key, the console's figures by their indexes.
    const reads = CLAIM_ACCOUNTS_SQL.filter((s) => s.startsWith("SELECT"));
    expect(reads).toHaveLength(3);
    for (const sql of reads) {
      const steps = await plan(ACCOUNTS, sql, sql.includes("?1") ? ["2026-10-24T00:00:00.000Z"] : sql.includes("?") ? ["x"] : []);
      expect(steps.filter((s) => /^SCAN org_claims$/.test(s)), `${sql}\n${steps.join("\n")}`).toEqual([]);
    }
  });

  it("read the radar's own window for the organization's contracts ending", () => {
    const f = claimFrame(DAY);
    const asked = readExpiringQuery(new URL(`${SITE}/expiring/12m?supplier=${A1}`));
    expect(endingParams(n(A1), f)).toEqual(radarParams("12m", DAY, asked));
  });
});

// -- the weekly block ------------------------------------------------------------------------------------

describe("the weekly block of the watch mail", () => {
  const base = (lang: "en" | "fr", opening: WatchDigest["opening"], groups: WatchDigest["groups"] = []): WatchDigest => ({
    lang, to: "reader@example.com", site: SITE, dataDate: DAY, stopUrl: `${SITE}/account/stop?w=x&t=y`, groups, total: groups.length ? 1 : 0,
    watched: 3, opening,
  });

  it("reads the week's three facts", async () => {
    const week = await readWeek(E() as never, n(A1), DAY);
    expect(week).toEqual({
      state: "ready",
      facts: {
        records: [{ src: 1, n: 1 }, { src: 3, n: 1 }],
        ending: { n: 2, cents: 50_000_000, soonest: "2027-01-15" },
        buyers: [
          { id: "pwgsc-tpsgc", name_en: "Public Services and Procurement Canada", name_fr: "Services publics et Approvisionnement Canada", n: 5 },
          { id: "dfo-mpo", name_en: "Fisheries and Oceans Canada", name_fr: "Pêches et Océans Canada", n: 1 },
        ],
      },
    });
    expect((await readWeek(E() as never, n(A1), "2026-11-01")).state).toBe("stale");
    expect((await readWeek(E({ RECORDS: undefined }) as never, n(A1), DAY)).state).toBe("absent");
  });

  it("renders in both languages with no em-dash, and opens the message before the watches", async () => {
    const week = await readWeek(E() as never, n(A1), DAY);
    if (week.state !== "ready") throw new Error("not ready");
    const en = watchDigest(base("en", weekOpening("en", SITE, A1, NAME1, week.facts)));
    expect(en.subject).toBe(`Your organization this week: ${NAME1}`);
    expect(en.text.startsWith([
      `Your organization: ${NAME1}`,
      `  New records naming you this week: 2 (1 award notice, 1 published contract) · ${SITE}/organizations/${A1}/records`,
      `  Your contracts ending within 12 months: 2, soonest 2027-01-15 ($500,000 in all) · ${SITE}/expiring/12m?supplier=${A1}`,
      "  Buyers you have won from with new notices this week: Public Services and Procurement Canada (5), Fisheries and Oceans Canada (1)" +
        ` · ${SITE}/account/organization`,
    ].join("\n"))).toBe(true);
    // Alone, the message has no watch lead.
    expect(en.text).not.toContain("Your Watches");
    const fr = watchDigest(base("fr", weekOpening("fr", SITE, A1, NAME1, week.facts)));
    const frText = nbsp(fr.text).replace(/’/g, "'");
    expect(nbsp(fr.subject)).toBe(`Votre organisation cette semaine : ${NAME1}`);
    expect(frText.startsWith([
      `Votre organisation : ${NAME1}`,
      `  Nouveaux dossiers vous nommant cette semaine : 2 (1 avis d'attribution, 1 contrat publié) · ${SITE}/organizations/${A1}/records?lang=fr`,
      `  Vos contrats prenant fin d'ici 12 mois : 2, le plus proche le 2027-01-15 (500 000 $ en tout) · ${SITE}/expiring/12m?supplier=${A1}&lang=fr`,
      "  Acheteurs dont vous avez déjà obtenu des contrats et qui ont publié de nouveaux avis cette semaine : " +
        `Services publics et Approvisionnement Canada (5), Pêches et Océans Canada (1) · ${SITE}/account/organization?lang=fr`,
    ].join("\n"))).toBe(true);
    for (const m of [en, fr]) {
      expect(m.text).not.toContain(EM_DASH);
      expect(m.html).not.toContain(EM_DASH);
      expect(m.html).toContain(`href="${SITE}/organizations/${A1}/records${m === fr ? "?lang=fr" : ""}"`);
    }
    // Beside watch events the block comes first and the watches' own subject stays.
    const group = { kind: "organization" as const, label: NAME2, path: `/organizations/${A2}`, events: [] };
    const both = watchDigest({ ...base("en", weekOpening("en", SITE, A1, NAME1, week.facts), [group]), total: 1 });
    expect(both.subject).toBe(`1 update on what you follow: ${NAME2}`);
    expect(both.text.indexOf(`Your organization: ${NAME1}`)).toBeLessThan(both.text.indexOf("Your Watches"));
    // Without a block the message is what it was.
    const plain = { ...base("en", undefined, [group]), total: 1 };
    expect(watchDigest({ ...plain, opening: null })).toEqual(watchDigest(plain));
  });

  it("is one line on a week with nothing in it", () => {
    const zero = weekOpening("en", SITE, A1, NAME1, { records: [], ending: { n: 0, cents: null, soonest: null }, buyers: [] });
    expect(zero.lines).toEqual([]);
    expect(zero.heading).toBe("Your organization: nothing new this week.");
    expect(watchDigest(base("en", zero)).text.startsWith("Your organization: nothing new this week.\n\n")).toBe(true);
    const fr = weekOpening("fr", SITE, A1, NAME1, { records: [], ending: { n: 0, cents: null, soonest: null }, buyers: [] });
    expect(nbsp(fr.heading)).toBe("Votre organisation : rien de nouveau cette semaine.");
  });

  it("is built for an account's claim, and left out without one or with the records database behind", async () => {
    const r = await reader("week-claimant", true);
    expect(await orgWeekOpening(E() as never, { userId: r.id, lang: "en", site: SITE, dataDate: DAY })).toBeNull();
    await send(r, "/account/organization", { org: "org-a00000000f" });
    const block = await orgWeekOpening(E() as never, { userId: r.id, lang: "en", site: SITE, dataDate: DAY });
    expect(block?.heading).toBe(`Your organization: ${NAME1}`);
    expect(block?.lines).toHaveLength(3);
    expect(await orgWeekOpening(E() as never, { userId: r.id, lang: "en", site: SITE, dataDate: "2026-11-01" })).toBeNull();
  });
});
