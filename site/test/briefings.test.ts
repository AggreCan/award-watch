// Weekly briefings (src/account/briefings.ts, briefing_pages.tsx, digests.ts
// briefingDigest; docs/accounts.md, Weekly briefings): the shared cap counted
// over both tables, Free kept with its email off and the Pro chip, Pro kept
// weekly; the weekly due rule and the span; the fiscal quarter across the
// March 31 turn; the message read from a local records database built from
// pipeline/records_schema.sql with rows written here, in English and French
// byte for byte, with the "new this week" marks and the notable threshold; a
// briefing with only the quarter's contracts sent, one with nothing written
// empty; the standing offers and supply arrangements ending within 6 months,
// their window, their "See all" link and its filters, their empty line; the
// run's claim and stop link; the public sample, the same with and without a
// session, and its message's frame, a subscriber's message line for line but
// for the lines the sample changes; and every statement's plan. Every expected line is written out
// from the rows below, never read back from the code under test.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addBriefing, BRIEFINGS_DUE_SQL, BUYER_BRIEFING_SQL, SEGMENT_BRIEFING_SQL, briefingDue, briefingStart, nextQuarter, quarterTurn,
  readBriefing, runBriefings, weekAnchor } from "../src/account/briefings";
import { runDeliveries } from "../src/account/deliveries";
import { briefingDigest, quarterMonths, quarterName } from "../src/account/digests";
import { addSearch } from "../src/account/searches";
import { readInstrumentQuery } from "../src/instruments";
import { BUYER_DUE_SQL, SEGMENT_DUE_SQL } from "../src/records_db";
import { ACCOUNTS, csrf, decode, get, grantPro, nbsp, newEmail, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { SAMPLE_ADDRESS } from "./mail-fixtures";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const D = "2026-11-02"; // a Monday, the briefings' weekday
const SITE = "https://awardwatch.ca";
const FROM = "alerts@awardwatch.ca";
const EM_DASH = String.fromCharCode(0x2014);
const KWL = 0xe000000001;
const DAVIE = 0xe000000002;

// -- the records database ------------------------------------------------------------------

const ev = (r: Record<string, unknown>) => ({
  day: D, src: null, oid: null, buyer: null, sid: 81, cents: null, ocents: null, endd: null, oendd: null, closing: null, title: null,
  title_fr: null, other: null, more: null, ...r,
});
let k = 0;
async function insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  await RECORDS.batch(rows.map((r) => {
    const cols = Object.keys(r);
    return RECORDS.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => r[c] ?? null));
  }));
}

const row = (o: Record<string, unknown>) => JSON.stringify({
  supplier_withheld: false, organization_id: null, buyer_id: null, start: null, currency: "CAD", competitive: null, method_en: null,
  method_fr: null, instrument_en: null, instrument_fr: null, segments: [], provinces: [], ...o,
});

async function seed(asOf = D, state = "ready"): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["rec_events", "rec_meta", "rec_expiring", "rec_due", "records", "rec_details", "rec_buyers", "rec_orgs", "rec_instruments"]
    .map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', ?), ('as_of', ?), ('rules', '2')").bind(state, asOf).run();
  await insert("rec_buyers", [
    { bid: 1, id: "dfo-mpo", name_en: "Fisheries and Oceans Canada", name_fr: "Pêches et Océans Canada" },
    { bid: 2, id: "pspc-spac", name_en: "Public Services and Procurement Canada", name_fr: "Services publics et Approvisionnement Canada" },
    { bid: 3, id: "dnd-mdn", name_en: "National Defence", name_fr: "Défense nationale" },
  ]);
  await insert("rec_orgs", [{ oid: KWL, name: "Kerr Wood Leidal Associates Ltd." }, { oid: DAVIE, name: "Chantier Davie Canada Inc." }]);
  await insert("rec_events", [
    // Section 1: two notices in the span, one the day before it, one in another segment.
    ev({ k: ++k, day: "2026-10-30", kind: "notice", src: 5, buyer: "dfo-mpo", closing: "2026-11-23T14:00:00", title: "Hydrographic survey, Strait of Georgia",
      title_fr: "Levé hydrographique, détroit de Géorgie", ref: "tender:cb-1", path: "/tenders/cb-1" }),
    ev({ k: ++k, day: "2026-11-01", kind: "notice", src: 5, buyer: "pspc-spac", closing: "2026-11-05T14:00:00", title: "Geotechnical services",
      title_fr: "Services géotechniques", ref: "tender:cb-2", path: "/tenders/cb-2" }),
    ev({ k: ++k, day: "2026-10-26", kind: "notice", src: 5, buyer: "dfo-mpo", closing: "2026-11-20T14:00:00", title: "Before the span", ref: "tender:cb-0",
      path: "/tenders/cb-0" }),
    ev({ k: ++k, day: "2026-11-01", kind: "notice", src: 5, sid: 43, buyer: "dfo-mpo", title: "Another segment", ref: "tender:cb-9", path: "/tenders/cb-9" }),
    // Section 2: an award notice with its value, a history record without one; a published contract has no segment.
    ev({ k: ++k, kind: "award", src: 1, oid: KWL, buyer: "pspc-spac", cents: 420_000_000, title: "Engineering support, Esquimalt Graving Dock",
      title_fr: "Soutien en ingénierie, cale sèche d'Esquimalt", ref: "award:ez899-270448-001", path: "/awards/ez899-270448-001" }),
    ev({ k: ++k, day: "2026-10-28", kind: "award", src: 2, buyer: "dfo-mpo", title: "Field survey", title_fr: "Levé sur le terrain",
      ref: "history:f1700-260001-001", path: "/history/f1700-260001-001" }),
    ev({ k: ++k, day: "2026-11-01", kind: "award", src: 3, sid: null, buyer: "pspc-spac", cents: 5_000_000, title: "Bridge inspection",
      ref: "contract:pspc-spac:C-77", path: "/contracts/pspc-spac/C-77" }),
    // Section 4: notable by value, notable by share, not notable, and an end moved within the quarter.
    ev({ k: ++k, day: "2026-10-29", kind: "amended", src: 1, oid: KWL, buyer: "dfo-mpo", cents: 26_800_000, ocents: 12_000_000, endd: "2027-03-31",
      oendd: "2026-03-31", title: "Hydrotechnical assessment, Big Qualicum River", title_fr: "Évaluation hydrotechnique, rivière Big Qualicum",
      ref: "award:f1700-240456-001", path: "/awards/f1700-240456-001" }),
    ev({ k: ++k, kind: "amended", src: 1, buyer: "dfo-mpo", cents: 3_000_000, ocents: 1_000_000, title: "Small study", ref: "award:aw-small",
      path: "/awards/aw-small" }),
    ev({ k: ++k, kind: "amended", src: 1, buyer: "dfo-mpo", cents: 11_000_000, ocents: 10_000_000, title: "Small change", ref: "award:aw-change",
      path: "/awards/aw-change" }),
    ev({ k: ++k, kind: "amended", src: 2, buyer: "dnd-mdn", endd: "2027-01-10", oendd: "2027-01-05", title: "Ground survey", ref: "history:w8486-1234",
      path: "/history/w8486-1234" }),
    // The end date of the quarter's largest contract moved into the quarter this week: new to the list.
    ev({ k: ++k, kind: "amended", src: 1, oid: KWL, buyer: "dfo-mpo", cents: 100_000_000, ocents: 100_000_000, endd: "2027-03-31", oendd: "2026-12-31",
      title: "Fisheries Engineering Services, Pacific Region", ref: "award:f1700-250123-001", path: "/awards/f1700-250123-001" }),
  ]);
  // Section 3: the quarter after the data date's (Q4 2026-27, January to March 2027).
  await insert("rec_due", [
    { k: 1, sid: 81, fy: 2026, fq: 3, n: 7, cents: 900_000_000, n_no_value: 0 },
    { k: 2, sid: 81, fy: 2026, fq: 4, n: 3, cents: 105_000_000, n_no_value: 1 },
    { k: 3, bid: 1, fy: 2026, fq: 4, n: 1, cents: 100_000_000, n_no_value: 0 },
    { k: 4, sid: 72, fy: 2026, fq: 4, n: 1, cents: 20_000_000, n_no_value: 0 },
  ]);
  await insert("rec_expiring", [
    { k: 1, endd: "2027-03-31", oid: KWL, buyer: "dfo-mpo", segs: " 81 ", kind: 1, cad: 100_000_000, cents: 100_000_000, nv: 0,
      j: row({ kind: "award", reference: "f1700-250123-001", title_en: "Fisheries Engineering Services, Pacific Region",
        title_fr: "Services d'ingénierie des pêches, région du Pacifique", organization: "Kerr Wood Leidal Associates Ltd.", buyer_en: "Fisheries and Oceans Canada",
        buyer_fr: "Pêches et Océans Canada", end: "2027-03-31", value: 1_000_000, n_amendments: 2, value_growth: 1.63 }) },
    { k: 2, endd: "2027-02-15", buyer: "pspc-spac", segs: " 43 81 ", kind: 3, cad: 5_000_000, cents: 5_000_000, nv: 0,
      j: row({ kind: "contract", reference: "pspc-spac:C-77", title_en: "Bridge inspection", title_fr: "Inspection de pont", organization: null,
        buyer_en: "Public Services and Procurement Canada", buyer_fr: "Services publics et Approvisionnement Canada", end: "2027-02-15", value: 50_000,
        n_amendments: 0, value_growth: null }) },
    { k: 3, endd: "2027-01-10", buyer: "dnd-mdn", segs: " 81 ", kind: 2, cad: null, cents: null, nv: 1,
      j: row({ kind: "history", reference: "w8486-1234", title_en: "Ground survey", title_fr: "Levé au sol", organization: "Harbour Survey Inc.",
        buyer_en: "National Defence", buyer_fr: "Défense nationale", end: "2027-01-10", value: null, n_amendments: 1, value_growth: null }) },
    { k: 4, endd: "2026-12-31", buyer: "dfo-mpo", segs: " 81 ", kind: 1, cad: 9_000_000, cents: 9_000_000, nv: 0,
      j: row({ kind: "award", reference: "this-quarter", title_en: "Ends this quarter", end: "2026-12-31", value: 90_000, n_amendments: 0, value_growth: null }) },
    { k: 5, endd: "2027-02-01", buyer: "dfo-mpo", segs: " 43 ", kind: 1, cad: 7_000_000, cents: 7_000_000, nv: 0,
      j: row({ kind: "award", reference: "other-segment", title_en: "Another segment", end: "2027-02-01", value: 70_000, n_amendments: 0, value_growth: null }) },
    { k: 6, endd: "2027-02-01", buyer: "pspc-spac", segs: " 72 ", kind: 1, cad: 20_000_000, cents: 20_000_000, nv: 0,
      j: row({ kind: "award", reference: "roof-72", title_en: "Roof repair", end: "2027-02-01", value: 200_000, n_amendments: 0, value_growth: null,
        organization: "Roofing Ltd.", buyer_en: "Public Services and Procurement Canada" }) },
  ]);
  // Section 5: the fiscal year's (2026-27) largest; a notice's row for a further segment has no date.
  await insert("records", [
    { k: 101, src: 1, fy: 2026, fq: 2, bid: 3, oid: DAVIE, sid: 81, extra: 0, cents: 3_890_000_000, vnote: 0, ref: "w8472-210001-001",
      title: "Joint Support Ship engineering services" },
    { k: 102, src: 2, fy: 2026, fq: 1, bid: 1, oid: KWL, sid: 81, extra: 1, cents: 50_000_000, vnote: 0, ref: "f1700-230001-001", title: "Coastal engineering" },
    { k: 103, src: 1, fy: 2025, fq: 4, bid: 1, oid: KWL, sid: 81, extra: 0, cents: 9_000_000_000, vnote: 0, ref: "last-year", title: "Last year" },
    { k: 104, src: 1, fy: 2026, fq: 2, bid: 1, oid: KWL, sid: 81, extra: 0, cents: null, vnote: 1, ref: "no-value", title: "No value" },
    { k: 105, src: 1, fy: 2026, fq: 2, bid: 1, oid: KWL, sid: 43, extra: 0, cents: 7_000_000_000, vnote: 0, ref: "other-segment", title: "Other segment" },
  ]);
  await insert("rec_details", [
    { k: 101, src: 1, day: "2026-07-14", bid: 3, oid: DAVIE, cents: 3_890_000_000, ref: "w8472-210001-001", title_en: "Joint Support Ship engineering services",
      title_fr: "Services d'ingénierie, navires de soutien interarmées" },
  ]);
  // Section 6: the active instruments expiring from the data date to 182 days on (2026-11-02 to 2027-05-03), the soonest first.
  await insert("rec_instruments", [...INSTRUMENTS]);
}

const instrument = (o: Record<string, unknown>) => ({ type_fr: null, desc_fr: null, user_fr: null, buyer: null, nw: 0, ...o });
const INSTRUMENTS = [
  instrument({ k: 1, agr: "EN578-170432/005/EI", type_en: "Supply Arrangement", type_fr: "Arrangement en matière d'approvisionnement",
    desc_en: "Engineering services", desc_fr: "Services d'ingénierie", user_en: "Public Services and Procurement Canada",
    user_fr: "Services publics et Approvisionnement Canada", buyer: "pspc-spac", expiry: "2026-12-15", segs: " 81 ", n: 1 }),
  instrument({ k: 2, agr: "E60ZT-120002/001/ZT", type_en: "Regional Master Standing Offer", type_fr: "Offre à commandes principale régionale",
    desc_en: "Environmental consulting services", desc_fr: "Services d'experts-conseils en environnement", user_en: "Fisheries and Oceans Canada",
    user_fr: "Pêches et Océans Canada", buyer: "dfo-mpo", expiry: "2027-03-31", segs: " 77 81 ", n: 14, nw: 1 }),
  // The window's last day, 182 days on: in, as the index's 6-month filter counts it.
  instrument({ k: 3, agr: "F5211-200001/002/VAN", type_en: "Regional Individual Standing Offer", type_fr: "Offre à commandes individuelle régionale",
    desc_en: "Hydrometric station maintenance", desc_fr: "Entretien de stations hydrométriques", user_en: "Fisheries and Oceans Canada",
    user_fr: "Pêches et Océans Canada", buyer: "dfo-mpo", expiry: "2027-05-03", segs: " 81 ", n: 3 }),
  // A day past the window; the day before the data date (in the sample's window, which starts on 2026-10-31); lapsed, with no active holder.
  instrument({ k: 4, agr: "W8486-180001/001/QD", type_en: "National Master Standing Offer", desc_en: "Survey equipment", user_en: "National Defence",
    buyer: "dnd-mdn", expiry: "2027-05-04", segs: " 81 ", n: 5 }),
  instrument({ k: 5, agr: "W8486-150001/001/QD", type_en: "Departmental Individual Standing Offer", desc_en: "Calibration services",
    user_en: "National Defence", buyer: "dnd-mdn", expiry: "2026-11-01", segs: " 81 ", n: 2 }),
  instrument({ k: 6, agr: "F1700-190001/001/VAN", type_en: "Supply Arrangement", desc_en: "Lapsed", user_en: "Fisheries and Oceans Canada",
    buyer: "dfo-mpo", expiry: "2027-01-31", segs: " 81 ", n: 0 }),
  // Another segment of the same buyer, and the only instrument of segment 10.
  instrument({ k: 7, agr: "F1700-200002/001/VAN", type_en: "Supply Arrangement", desc_en: "Fishing gear", user_en: "Fisheries and Oceans Canada",
    buyer: "dfo-mpo", expiry: "2027-02-01", segs: " 43 ", n: 4 }),
  instrument({ k: 8, agr: "01B68-210001/001/ZF", type_en: "Supply Arrangement", desc_en: "Laboratory animals", user_en: "Canadian Food Inspection Agency",
    expiry: "2027-01-05", segs: " 10 ", n: 2 }),
];

beforeAll(() => seed());

// -- the accounts side -----------------------------------------------------------------------

let seq = 0;
const nextId = () => (0xb0000000 + ++seq).toString(16).padStart(32, "0");

async function makeUser(email: string, pro = true): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active')").bind(id, email).run();
  if (pro) {
    await ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) " +
      "VALUES (?, ?, 'pro', 'manual', '2026-01-01T00:00:00.000Z', NULL, 'test', '2026-01-01T00:00:00.000Z')",
    ).bind(nextId(), id).run();
  }
  return id;
}

async function brief(user: string, o: { kind?: string; subject?: string; segment?: string; label?: string; lang?: string; deliver?: string; last?: string | null } = {}) {
  const id = nextId();
  await ACCOUNTS.prepare(
    "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver, last_delivered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, user, o.kind ?? "segment", o.subject ?? "81", o.segment ?? "", o.label ?? "81 Engineering", o.lang ?? "en",
    `2026-01-01T00:00:00.${String(seq).padStart(3, "0")}Z`, o.deliver ?? "weekly", o.last ?? null).run();
  return id;
}

type Handed = { to: string; subject: string; text?: string; html?: string; headers?: Record<string, string> };

function fakeMail(fail: (to: string) => unknown = () => undefined) {
  const handed: Handed[] = [];
  const binding = {
    async send(message: Handed) {
      handed.push(message);
      const error = fail(message.to);
      if (error !== undefined) throw error;
      return { messageId: "<test@awardwatch.ca>" };
    },
  } as unknown as SendEmail;
  return { handed, binding, to: (email: string) => handed.filter((m) => m.to === email) };
}

const jobEnv = (mail: SendEmail, extra: Record<string, unknown> = {}) =>
  onEnv({ ASSETS: makeFakeAssets({}, {}), MAIL: mail, MAIL_FROM: FROM, MAIL_SENDER: undefined, ...extra });

const runAt = (mail: SendEmail, dataDate = D, room = 300) =>
  runBriefings(jobEnv(mail), { site: SITE, dataDate, now: new Date(`${dataDate}T16:00:00.000Z`), plans: new Map(), room, capText: "the cap" });

const runs = async (id: string) =>
  (await ACCOUNTS.prepare("SELECT day, items, status FROM briefing_deliveries WHERE briefing_id = ? ORDER BY id").bind(id)
    .all<{ day: string; items: number; status: string }>()).results ?? [];
const stateOf = (id: string) =>
  ACCOUNTS.prepare("SELECT deliver, last_delivered_at, secret FROM briefings WHERE id = ?").bind(id)
    .first<{ deliver: string; last_delivered_at: string | null; secret: string | null }>();

// -- the calendar ----------------------------------------------------------------------------

describe("the week and the fiscal quarter", () => {
  it("send on Monday, or the first data date after it a briefing was not covered on, once a week", () => {
    expect(weekAnchor("2026-11-02")).toBe("2026-11-02");
    expect(weekAnchor("2026-11-05")).toBe("2026-11-02");
    expect(weekAnchor("2026-11-08")).toBe("2026-11-02");
    expect(weekAnchor("2026-11-09")).toBe("2026-11-09");
    expect(briefingDue("weekly", null, "2026-11-05")).toBe(true);
    expect(briefingDue("off", null, "2026-11-02")).toBe(false);
    expect(briefingDue("weekly", "2026-11-02T15:00:00.000Z", "2026-11-02")).toBe(false);
    expect(briefingDue("weekly", "2026-11-02T15:00:00.000Z", "2026-11-08")).toBe(false);
    expect(briefingDue("weekly", "2026-11-02T15:00:00.000Z", "2026-11-09")).toBe(true);
    // Monday's nightly was late: Tuesday's data date sends the week's briefing.
    expect(briefingDue("weekly", "2026-10-26T15:00:00.000Z", "2026-11-03")).toBe(true);
  });

  it("cover the seven data dates ending with the data date, and back to the last one covered after a failure, at most two weeks", () => {
    expect(briefingStart(null, D)).toBe("2026-10-26");
    expect(briefingStart("2026-10-26T15:00:00.000Z", D)).toBe("2026-10-26");
    expect(briefingStart("2026-10-29T15:00:00.000Z", D)).toBe("2026-10-26");
    expect(briefingStart("2026-10-19T15:00:00.000Z", D)).toBe("2026-10-19");
    expect(briefingStart("2026-10-01T15:00:00.000Z", D)).toBe("2026-10-19");
  });

  it("name the next fiscal quarter across the March 31 turn, and the turn itself on the quarter's last briefing", () => {
    expect(nextQuarter("2027-03-31")).toEqual({ fy: 2027, fq: 1, first: "2027-04-01", last: "2027-06-30" });
    expect(quarterName("en", nextQuarter("2027-03-31"))).toBe("Q1 2027-28");
    expect(nextQuarter("2027-04-01")).toEqual({ fy: 2027, fq: 2, first: "2027-07-01", last: "2027-09-30" });
    expect(quarterName("en", nextQuarter("2027-04-01"))).toBe("Q2 2027-28");
    expect(nextQuarter("2026-11-05")).toEqual({ fy: 2026, fq: 4, first: "2027-01-01", last: "2027-03-31" });
    expect(quarterName("fr", nextQuarter("2026-11-05"))).toBe("T4 2026-2027");
    expect(quarterMonths("en", nextQuarter("2026-11-05"))).toBe("January to March 2027");
    expect(quarterMonths("fr", nextQuarter("2026-12-20"))).toBe("janvier à mars 2027");
    expect(quarterTurn("2027-03-22")).toBeNull();
    expect(quarterTurn("2027-03-29")).toEqual({ on: "2027-04-01", quarter: { fy: 2027, fq: 2, first: "2027-07-01", last: "2027-09-30" } });
  });
});

// -- the statements --------------------------------------------------------------------------

describe("the briefing's statements", () => {
  const plan = async (sql: string, binds: (string | number)[]) =>
    ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail));
  const span = ["2026-10-26", D];
  const quarter = ["2027-01-01", "2027-03-31"];
  const cases: [string, string, (string | number)[], RegExp[]][] = [
    ["segment notices", SEGMENT_BRIEFING_SQL.notices, [81, ...span], [/rec_events USING INDEX rec_events_segment/]],
    ["segment awards", SEGMENT_BRIEFING_SQL.awards, [81, ...span], [/rec_events USING INDEX rec_events_segment/]],
    ["segment sources", SEGMENT_BRIEFING_SQL.sources, [81, ...span], [/rec_events USING INDEX rec_events_segment/]],
    ["segment amended", SEGMENT_BRIEFING_SQL.amended, [81, ...span], [/rec_events USING INDEX rec_events_segment/]],
    ["segment ending", SEGMENT_BRIEFING_SQL.ending, [" 81 ", ...span, ...quarter], [/x USING INDEX rec_expiring_end/, /v USING (COVERING )?INDEX rec_events_ref/]],
    ["segment largest", SEGMENT_BRIEFING_SQL.largest, [81, 2026], [/records USING INDEX records_segment/]],
    ["segment due", SEGMENT_DUE_SQL, [81, 2026, 2026], [/rec_due USING INDEX rec_due_segment/]],
    ["buyer notices", BUYER_BRIEFING_SQL.notices, ["dfo-mpo", -1, ...span], [/rec_events USING INDEX rec_events_buyer/]],
    ["narrowed notices", BUYER_BRIEFING_SQL.notices, ["dfo-mpo", 81, ...span], [/rec_events USING INDEX rec_events_buyer/]],
    ["buyer awards", BUYER_BRIEFING_SQL.awards, ["dfo-mpo", -1, ...span], [/rec_events USING INDEX rec_events_buyer/]],
    ["buyer sources", BUYER_BRIEFING_SQL.sources, ["dfo-mpo", -1, ...span], [/rec_events USING INDEX rec_events_buyer/]],
    ["buyer amended", BUYER_BRIEFING_SQL.amended, ["dfo-mpo", 81, ...span], [/rec_events USING INDEX rec_events_buyer/]],
    ["buyer ending", BUYER_BRIEFING_SQL.ending, ["dfo-mpo", "", ...span, ...quarter], [/x USING INDEX rec_expiring_buyer/, /v USING (COVERING )?INDEX rec_events_ref/]],
    ["buyer largest", BUYER_BRIEFING_SQL.largest, ["dfo-mpo", -1, 2026], [/records USING INDEX records_buyer/]],
    ["buyer due", BUYER_DUE_SQL, ["dfo-mpo", 2026, 2026], [/rec_due USING INDEX rec_due_buyer/]],
  ];

  it("are bounded and each read through the subject's index, never a scan of a records table", async () => {
    for (const [name, sql, binds, indexes] of cases) {
      expect(sql, name).toMatch(/LIMIT \d+$/);
      const steps = await plan(sql, binds);
      expect(steps.filter((s) => /^SCAN (rec_events|rec_expiring|records|rec_due|rec_details|rec_buyers|rec_orgs|x|v|d|o|b)\b(?! USING)/.test(s)),
        `${name}\n${steps.join("\n")}`).toEqual([]);
      for (const index of indexes) expect(steps.some((s) => index.test(s)), `${name}: ${index}\n${steps.join("\n")}`).toBe(true);
    }
    // The run's own list of due briefings ends in its bound too.
    expect(BRIEFINGS_DUE_SQL).toMatch(/LIMIT \?2$/);
  });

  it("read the instruments from rec_instruments alone, in one pass with no index, and list 10 of any number while counting all", async () => {
    const window = [D, "2027-05-03"];
    for (const [name, sql, binds] of [
      ["segment instruments", SEGMENT_BRIEFING_SQL.instruments, [" 81 ", ...window]],
      ["buyer instruments", BUYER_BRIEFING_SQL.instruments, ["dfo-mpo", "", ...window]],
      ["narrowed instruments", BUYER_BRIEFING_SQL.instruments, ["dfo-mpo", " 81 ", ...window]],
    ] as [string, string, string[]][]) {
      expect(sql, name).toMatch(/LIMIT 10$/);
      const steps = await plan(sql, binds);
      // The expiry index (or the buyer-and-expiry one) narrows the window; the one table is the only one touched.
      const reads = steps.filter((s) => /^(SCAN|SEARCH) (?!\(subquery)/.test(s));
      expect(reads, `${name}\n${steps.join("\n")}`).toHaveLength(1);
      expect(reads[0], name).toMatch(/^SEARCH rec_instruments USING INDEX rec_instruments_(expiry|buyer) /);
    }
    // Twelve of one segment in the window: ten listed, the soonest first, all twelve counted and linked.
    const extra = Array.from({ length: 12 }, (_, i) => instrument({
      k: 900 + i, agr: `EP000-26${String(i).padStart(4, "0")}/001/XL`, type_en: "Supply Arrangement", desc_en: `Item ${i}`,
      expiry: `2027-01-${String(12 - i).padStart(2, "0")}`, segs: " 95 ", n: i + 1,
    }));
    await insert("rec_instruments", extra);
    try {
      const subject = { kind: "segment" as const, subject: "95", segment: "" };
      const read = await readBriefing(env as never, subject, D, "2026-10-26");
      if (read.state !== "ready") throw new Error(read.state);
      expect(read.data.instruments.n).toBe(12);
      expect(read.data.instruments.rows.map((r) => r.expiry)).toEqual(Array.from({ length: 10 }, (_, i) => `2027-01-${String(i + 1).padStart(2, "0")}`));
      const m = briefingDigest({ lang: "en", to: "a@example.com", site: SITE, stopUrl: `${SITE}/s`, briefing: subject, name: "95 Land", data: read.data });
      expect(m.text).toContain("Standing offers and supply arrangements ending within 6 months: 12\n- EP000-260011/001/XL · Supply Arrangement · Item 11 · expires 2027-01-01 · 12 holders\n");
      expect(m.text).toContain("\nSee all 12: https://awardwatch.ca/instruments?segment=95&within=6\n");
      expect(m.text.match(/^- EP000-/gm)).toHaveLength(10);
    } finally {
      await RECORDS.prepare("DELETE FROM rec_instruments WHERE k >= 900").run();
    }
  });
});

// -- the message -------------------------------------------------------------------------------

const EXPECTED_EN = `81 Engineering, week to 2026-11-02
Data dates 2026-10-27 to 2026-11-02.

New notices this week: 2
- Geotechnical services
  Public Services and Procurement Canada · Closes 2026-11-05 14:00 ET, closes in 3 days
  https://awardwatch.ca/tenders/cb-2
- Hydrographic survey, Strait of Georgia
  Fisheries and Oceans Canada · Closes 2026-11-23 14:00 ET, closes in 21 days
  https://awardwatch.ca/tenders/cb-1

Awards this week: 2
Award notices: 1, $4,200,000
PSPC contract history: 1 (1 without a value)
- Engineering support, Esquimalt Graving Dock
  Kerr Wood Leidal Associates Ltd. · Public Services and Procurement Canada · $4,200,000 · Award notice
  https://awardwatch.ca/awards/ez899-270448-001
- Field survey
  Supplier not named · Fisheries and Oceans Canada · No counted value · PSPC contract history
  https://awardwatch.ca/history/f1700-260001-001

Contracts ending next quarter, Q4 2026-27 (January to March 2027): 3, $1,050,000 (1 without a value)
New to the list this week: 2.
- Fisheries Engineering Services, Pacific Region
  Kerr Wood Leidal Associates Ltd. · Fisheries and Oceans Canada · ends 2027-03-31 · $1,000,000 · 2 amendments, +163% · new this week
  https://awardwatch.ca/awards/f1700-250123-001
- Bridge inspection
  Not stated · Public Services and Procurement Canada · ends 2027-02-15 · $50,000 · new this week
  https://awardwatch.ca/contracts/pspc-spac/C-77
- Ground survey
  Harbour Survey Inc. · National Defence · ends 2027-01-10 · Not stated · 1 amendment
  https://awardwatch.ca/history/w8486-1234
In the 6-month list of contracts ending: https://awardwatch.ca/expiring/6m?segment=81

Notable amendments this week: 2
- Hydrotechnical assessment, Big Qualicum River
  Kerr Wood Leidal Associates Ltd. · Fisheries and Oceans Canada · $120,000 to $268,000 (+$148,000, +123%) · end moved from 2026-03-31 to 2027-03-31
  https://awardwatch.ca/awards/f1700-240456-001
- Small study
  Supplier not named · Fisheries and Oceans Canada · $10,000 to $30,000 (+$20,000, +200%)
  https://awardwatch.ca/awards/aw-small

Largest records this fiscal year (2026-27 to date): 2
- Joint Support Ship engineering services · Chantier Davie Canada Inc. · National Defence · $38,900,000 · 2026-07-14 · Award notice
- Coastal engineering · Kerr Wood Leidal Associates Ltd. · Fisheries and Oceans Canada · $500,000 · PSPC contract history
Analytics for this segment: https://awardwatch.ca/segments/81/analytics

Standing offers and supply arrangements ending within 6 months: 3
- EN578-170432/005/EI · Supply Arrangement · Engineering services · Public Services and Procurement Canada · expires 2026-12-15 · 1 holder
  https://awardwatch.ca/instruments/EN578-170432%2F005%2FEI
- E60ZT-120002/001/ZT · Regional Master Standing Offer · Environmental consulting services · Fisheries and Oceans Canada · expires 2027-03-31 · 14 holders
  https://awardwatch.ca/instruments/E60ZT-120002%2F001%2FZT
- F5211-200001/002/VAN · Regional Individual Standing Offer · Hydrometric station maintenance · Fisheries and Oceans Canada · expires 2027-05-03 · 3 holders
  https://awardwatch.ca/instruments/F5211-200001%2F002%2FVAN
See all 3: https://awardwatch.ca/instruments?segment=81&within=6

A contract's value is its newest amendment's. Nothing is added across sources. "Ends" is the date the record states. Segment coding is the buyer's; a record can carry several segments, and the week's lines list it under the lowest of them.

You receive this each week for a briefing in your account.
Briefings and delivery: https://awardwatch.ca/account/searches
Stop this briefing: https://awardwatch.ca/account/stop?b=B&t=T
Award Watch · Federal tenders, awards, contracts and grants, by organization.
contact@awardwatch.ca
`;

// French as the dictionary writes it, with the no-break spaces read as spaces (nbsp).
const EXPECTED_FR = `81 Ingénierie, semaine se terminant le 2026-11-02
Dates des données : du 2026-10-27 au 2026-11-02.

Nouveaux avis cette semaine : 2
- Services géotechniques
  Services publics et Approvisionnement Canada · Ferme le 2026-11-05 à 14 h 00 HE, ferme dans 3 jours
  https://awardwatch.ca/tenders/cb-2?lang=fr
- Levé hydrographique, détroit de Géorgie
  Pêches et Océans Canada · Ferme le 2026-11-23 à 14 h 00 HE, ferme dans 21 jours
  https://awardwatch.ca/tenders/cb-1?lang=fr

Attributions cette semaine : 2
Avis d’attribution : 1, 4 200 000 $
Historique des contrats de SPAC : 1 (1 sans valeur)
- Soutien en ingénierie, cale sèche d'Esquimalt
  Kerr Wood Leidal Associates Ltd. · Services publics et Approvisionnement Canada · 4 200 000 $ · Avis d’attribution
  https://awardwatch.ca/awards/ez899-270448-001?lang=fr
- Levé sur le terrain
  Fournisseur non nommé · Pêches et Océans Canada · Aucune valeur comptée · Historique des contrats de SPAC
  https://awardwatch.ca/history/f1700-260001-001?lang=fr

Contrats prenant fin le trimestre prochain, T4 2026-2027 (janvier à mars 2027) : 3, 1 050 000 $ (1 sans valeur)
Nouveaux dans la liste cette semaine : 2.
- Services d'ingénierie des pêches, région du Pacifique
  Kerr Wood Leidal Associates Ltd. · Pêches et Océans Canada · prend fin le 2027-03-31 · 1 000 000 $ · 2 modifications, +163 % · nouveau cette semaine
  https://awardwatch.ca/awards/f1700-250123-001?lang=fr
- Inspection de pont
  Non indiqué · Services publics et Approvisionnement Canada · prend fin le 2027-02-15 · 50 000 $ · nouveau cette semaine
  https://awardwatch.ca/contracts/pspc-spac/C-77?lang=fr
- Levé au sol
  Harbour Survey Inc. · Défense nationale · prend fin le 2027-01-10 · Non indiqué · 1 modification
  https://awardwatch.ca/history/w8486-1234?lang=fr
Dans la liste de 6 mois des contrats prenant fin : https://awardwatch.ca/expiring/6m?segment=81&lang=fr

Modifications notables cette semaine : 2
- Évaluation hydrotechnique, rivière Big Qualicum
  Kerr Wood Leidal Associates Ltd. · Pêches et Océans Canada · de 120 000 $ à 268 000 $ (+148 000 $, +123 %) · fin reportée du 2026-03-31 au 2027-03-31
  https://awardwatch.ca/awards/f1700-240456-001?lang=fr
- Small study
  Fournisseur non nommé · Pêches et Océans Canada · de 10 000 $ à 30 000 $ (+20 000 $, +200 %)
  https://awardwatch.ca/awards/aw-small?lang=fr

Dossiers les plus importants de l’exercice (2026-2027 à ce jour) : 2
- Services d'ingénierie, navires de soutien interarmées · Chantier Davie Canada Inc. · Défense nationale · 38 900 000 $ · 2026-07-14 · Avis d’attribution
- Coastal engineering · Kerr Wood Leidal Associates Ltd. · Pêches et Océans Canada · 500 000 $ · Historique des contrats de SPAC
Analyse de ce segment : https://awardwatch.ca/segments/81/analytics?lang=fr

Offres à commandes et arrangements en matière d’approvisionnement prenant fin d’ici 6 mois : 3
- EN578-170432/005/EI · Arrangement en matière d'approvisionnement · Services d'ingénierie · Services publics et Approvisionnement Canada · expire le 2026-12-15 · 1 titulaire
  https://awardwatch.ca/instruments/EN578-170432%2F005%2FEI?lang=fr
- E60ZT-120002/001/ZT · Offre à commandes principale régionale · Services d'experts-conseils en environnement · Pêches et Océans Canada · expire le 2027-03-31 · 14 titulaires
  https://awardwatch.ca/instruments/E60ZT-120002%2F001%2FZT?lang=fr
- F5211-200001/002/VAN · Offre à commandes individuelle régionale · Entretien de stations hydrométriques · Pêches et Océans Canada · expire le 2027-05-03 · 3 titulaires
  https://awardwatch.ca/instruments/F5211-200001%2F002%2FVAN?lang=fr
Voir les 3 : https://awardwatch.ca/instruments?segment=81&within=6&lang=fr

La valeur d’un contrat est celle de sa plus récente modification. Rien n’est additionné entre les sources. « Prend fin » est la date que le dossier indique. Le codage par segment est celui de l’acheteur; un dossier peut porter plusieurs segments, et les lignes de la semaine le placent sous le plus bas.

Vous recevez ce message chaque semaine pour un bulletin de votre compte.
Bulletins et envoi : https://awardwatch.ca/account/searches?lang=fr
Arrêter ce bulletin : https://awardwatch.ca/account/stop?b=B&t=T&lang=fr
Award Watch · Appels d’offres, attributions, contrats et subventions du fédéral, par organisation.
contact@awardwatch.ca
`;

describe("the message", () => {
  const segment81 = { kind: "segment" as const, subject: "81", segment: "" };

  it("is written line by line in English and in French, with no em-dash", async () => {
    const read = await readBriefing(env as never, segment81, D, "2026-10-26");
    expect(read.state).toBe("ready");
    if (read.state !== "ready") return;
    const en = briefingDigest({ lang: "en", to: "a@example.com", site: SITE, stopUrl: `${SITE}/account/stop?b=B&t=T`, briefing: segment81, name: "81 Engineering", data: read.data });
    expect(en.subject).toBe("81 Engineering this week: 2 new notices, 2 awards, 3 contracts ending next quarter");
    expect(en.text).toBe(EXPECTED_EN);
    expect(en.html).toContain(">Awards this week: 2. Next quarter, Q4 2026-27: 3 contracts ending, $1.1M; new to the list: 2.</div>");
    expect(en.headers).toEqual({
      "List-Unsubscribe": `<mailto:contact@awardwatch.ca>, <${SITE}/account/stop?b=B&t=T>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    const fr = briefingDigest({
      lang: "fr", to: "a@example.com", site: SITE, stopUrl: `${SITE}/account/stop?b=B&t=T&lang=fr`, briefing: segment81, name: "81 Ingénierie", data: read.data,
    });
    // The three counts would take the French subject past SUBJECT_MAX: it names the two that fit (digests.ts fitCounts).
    expect(nbsp(fr.subject)).toBe("81 Ingénierie cette semaine : 2 nouveaux avis, 2 attributions");
    expect(nbsp(fr.text)).toBe(EXPECTED_FR);
    for (const m of [en, fr]) for (const part of [m.subject, m.text, m.html]) expect(part).not.toContain(EM_DASH);
    // The marks and the totals are in the HTML part too, each value escaped.
    expect(en.html).toContain("Supplier not named");
    expect(decode(en.html)).toContain(">Engineering support, Esquimalt Graving Dock</a>");
    expect(en.html).toContain(">new this week</span>");
    expect(decode(fr.html)).toContain(">Soutien en ingénierie, cale sèche d'Esquimalt</a>");
    // Section 6 in the HTML part: the agreement number links its page, the rest of the list its index view.
    expect(decode(en.html)).toContain(`href="${SITE}/instruments/E60ZT-120002%2F001%2FZT" style="font:600 15px/1.4`);
    expect(decode(en.html)).toContain(">E60ZT-120002/001/ZT</a>");
    expect(decode(en.html)).toContain("Regional Master Standing Offer · Environmental consulting services · Fisheries and Oceans Canada · expires 2027-03-31 · 14 holders</div>");
    expect(decode(en.html)).toMatch(new RegExp(`href="${SITE}/instruments\\?segment=81&within=6" [^>]*>See all 3</a>`));
    expect(decode(fr.html)).toContain(`href="${SITE}/instruments?segment=81&within=6&lang=fr"`);
  });

  it("lists the instruments ending within 6 months of the data date, active ones only, the soonest first", async () => {
    const read = await readBriefing(env as never, segment81, D, "2026-10-26");
    if (read.state !== "ready") throw new Error(read.state);
    // Not the day before the data date, a day past the window, a lapsed one, nor another segment's.
    expect(read.data.instruments.rows.map((r) => r.agr)).toEqual(["EN578-170432/005/EI", "E60ZT-120002/001/ZT", "F5211-200001/002/VAN"]);
    expect(read.data.instruments.n).toBe(3);
    expect(read.data.instruments.rows[1]).toEqual({
      agr: "E60ZT-120002/001/ZT", type_en: "Regional Master Standing Offer", type_fr: "Offre à commandes principale régionale",
      desc_en: "Environmental consulting services", desc_fr: "Services d'experts-conseils en environnement", user_en: "Fisheries and Oceans Canada",
      user_fr: "Pêches et Océans Canada", expiry: "2027-03-31", n: 14,
    });
    // The window moves with the data date: on 2026-10-31 it runs to 2027-05-01.
    const earlier = await readBriefing(env as never, segment81, "2026-10-31", "2026-10-24");
    if (earlier.state !== "ready") throw new Error(earlier.state);
    expect(earlier.data.instruments.rows.map((r) => r.agr)).toEqual(["W8486-150001/001/QD", "EN578-170432/005/EI", "E60ZT-120002/001/ZT"]);
  });

  it("links the rest of the instruments to the index filtered by the segment or the end user and the 6-month window", async () => {
    const linkOf = async (s: { kind: "segment" | "buyer"; subject: string; segment: string }, lang: "en" | "fr" = "en") => {
      const read = await readBriefing(env as never, s, D, "2026-10-26");
      if (read.state !== "ready") throw new Error(read.state);
      const m = briefingDigest({ lang, to: "a@example.com", site: SITE, stopUrl: `${SITE}/s`, briefing: s, name: "Name", data: read.data });
      return nbsp(m.text).split("\n").find((l) => l.includes("/instruments?")) ?? "";
    };
    expect(await linkOf(segment81)).toBe("See all 3: https://awardwatch.ca/instruments?segment=81&within=6");
    expect(await linkOf({ kind: "buyer", subject: "dfo-mpo", segment: "" })).toBe("See all 3: https://awardwatch.ca/instruments?user=dfo-mpo&within=6");
    expect(await linkOf({ kind: "buyer", subject: "dfo-mpo", segment: "81" }, "fr"))
      .toBe("Voir les 2 : https://awardwatch.ca/instruments?segment=81&user=dfo-mpo&within=6&lang=fr");
    expect(await linkOf({ kind: "buyer", subject: "pspc-spac", segment: "" })).toBe("See the list: https://awardwatch.ca/instruments?user=pspc-spac&within=6");
    // The index page reads those parameters as its own filters (pages/instruments.tsx readInstrumentQuery).
    const q = readInstrumentQuery(new URL("https://awardwatch.ca/instruments?segment=81&user=dfo-mpo&within=6&lang=fr"));
    expect(q).toMatchObject({ segment: "81", user: "dfo-mpo", within: "6", type: "", region: "", commodity: "", sort: "" });
  });

  it("says no instrument ends within 6 months, in both languages, with no link", async () => {
    const s = { kind: "segment" as const, subject: "72", segment: "" };
    const read = await readBriefing(env as never, s, D, "2026-10-26");
    if (read.state !== "ready") throw new Error(read.state);
    expect(read.data.instruments).toMatchObject({ n: 0, rows: [] });
    const en = briefingDigest({ lang: "en", to: "a@example.com", site: SITE, stopUrl: `${SITE}/s`, briefing: s, name: "72 Construction", data: read.data });
    const fr = briefingDigest({ lang: "fr", to: "a@example.com", site: SITE, stopUrl: `${SITE}/s`, briefing: s, name: "72 Construction", data: read.data });
    expect(en.text).toContain("\n\nStanding offers and supply arrangements ending within 6 months: none\n\nA contract's value");
    expect(nbsp(fr.text)).toContain("\n\nOffres à commandes et arrangements en matière d’approvisionnement prenant fin d’ici 6 mois : aucun\n\nLa valeur");
    for (const m of [en, fr]) {
      expect(m.text).not.toContain("/instruments");
      expect(m.html).not.toContain("/instruments");
      for (const part of [m.subject, m.text, m.html]) expect(part).not.toContain(EM_DASH);
    }
  });

  it("marks a contract new to the quarter's list only for an award or an end date moved into the quarter this week", async () => {
    const read = await readBriefing(env as never, segment81, D, "2026-10-26");
    if (read.state !== "ready") throw new Error(read.state);
    expect(read.data.ending.rows.map((r) => [r.row.reference, r.fresh])).toEqual([
      ["f1700-250123-001", true], ["pspc-spac:C-77", true], ["w8486-1234", false],
    ]);
    expect(read.data.ending.fresh).toBe(2);
    // A week later the same events are behind the span: nothing is new.
    const later = await readBriefing(env as never, segment81, "2026-11-09", "2026-11-02");
    if (later.state !== "ready") throw new Error(later.state);
    expect(later.data.ending.rows.every((r) => !r.fresh)).toBe(true);
  });

  it("lists an amendment only when its value moved by the notable amount or share", async () => {
    const read = await readBriefing(env as never, segment81, D, "2026-10-26");
    if (read.state !== "ready") throw new Error(read.state);
    expect(read.data.amended.rows.map((r) => r.ref)).toEqual(["award:f1700-240456-001", "award:aw-small"]);
    expect(read.data.amended.n).toBe(2);
  });

  it("reads a buyer narrowed to a segment on that segment alone, and says so once in the note", async () => {
    const narrowed = { kind: "buyer" as const, subject: "dfo-mpo", segment: "81" };
    const read = await readBriefing(env as never, narrowed, D, "2026-10-26");
    if (read.state !== "ready") throw new Error(read.state);
    expect(read.data.notices.rows.map((r) => r.ref)).toEqual(["tender:cb-1"]);
    expect(read.data.awards.rows.map((r) => r.ref)).toEqual(["history:f1700-260001-001"]);
    // Ending: the buyer's rows in the segment, counted from the list itself (rec_due holds no buyer and segment together).
    expect(read.data.ending.rows.map((r) => r.row.reference)).toEqual(["f1700-250123-001"]);
    expect(read.data.ending).toMatchObject({ n: 1, cents: 100_000_000, nv: 0, fresh: 1 });
    const m = briefingDigest({ lang: "en", to: "a@example.com", site: SITE, stopUrl: `${SITE}/s`, briefing: narrowed, name: "Fisheries and Oceans Canada · 81 Engineering", data: read.data });
    expect(m.text.split("Published contracts and grants carry no segment, so a briefing narrowed to one leaves them out.").length).toBe(2);
    expect(m.text).toContain("In the 6-month list of contracts ending: https://awardwatch.ca/expiring/6m?buyer=dfo-mpo&segment=81");
    // Its instruments: the buyer's as end user, in the segment; the end user is the buyer, so the line leaves it out.
    expect(read.data.instruments.rows.map((r) => r.agr)).toEqual(["E60ZT-120002/001/ZT", "F5211-200001/002/VAN"]);
    expect(m.text).toContain("Standing offers and supply arrangements ending within 6 months: 2\n" +
      "- E60ZT-120002/001/ZT · Regional Master Standing Offer · Environmental consulting services · expires 2027-03-31 · 14 holders\n" +
      "  https://awardwatch.ca/instruments/E60ZT-120002%2F001%2FZT\n" +
      "- F5211-200001/002/VAN · Regional Individual Standing Offer · Hydrometric station maintenance · expires 2027-05-03 · 3 holders\n" +
      "  https://awardwatch.ca/instruments/F5211-200001%2F002%2FVAN\n" +
      "See all 2: https://awardwatch.ca/instruments?segment=81&user=dfo-mpo&within=6\n");
    // The whole buyer: its quarter from rec_due, no grant, and a published contract's award among its own.
    const whole = await readBriefing(env as never, { kind: "buyer", subject: "pspc-spac", segment: "" }, D, "2026-10-26");
    if (whole.state !== "ready") throw new Error(whole.state);
    expect(whole.data.awards.sources.map((s) => s.src)).toEqual([1, 3]);
    // The whole buyer's instruments, every segment of them.
    const dfo = await readBriefing(env as never, { kind: "buyer", subject: "dfo-mpo", segment: "" }, D, "2026-10-26");
    if (dfo.state !== "ready") throw new Error(dfo.state);
    expect(dfo.data.instruments.rows.map((r) => r.agr)).toEqual(["F1700-200002/001/VAN", "E60ZT-120002/001/ZT", "F5211-200001/002/VAN"]);
  });
});

// -- the run -----------------------------------------------------------------------------------

describe("the run", () => {
  it("sends one message per briefing on the weekly day, through the delivery job, with its stop link, once a week", async () => {
    await seed();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const mail = fakeMail();
    const email = newEmail("brief-run");
    const user = await makeUser(email);
    const id = await brief(user);
    const stats = { ...(FILES["stats.json"] as object), data_as_of: D };
    const envAt = (day: string) => jobEnv(mail.binding, { ASSETS: makeFakeAssets({}, { "stats.json": { ...stats, data_as_of: day } }), NOW: `${day}T16:00:00Z` });
    const report = await runDeliveries(envAt(D));
    expect(report.briefing).toMatchObject({ sent: 1, failed: 0, empty: 0, records: null });
    expect(mail.to(email)).toHaveLength(1);
    const [m] = mail.to(email);
    const row = await stateOf(id);
    expect(m.subject).toBe("81 Engineering this week: 2 new notices, 2 awards, 3 contracts ending next quarter");
    expect(m.headers?.["List-Unsubscribe"]).toBe(`<mailto:contact@awardwatch.ca>, <${SITE}/account/stop?b=${id}&t=${row!.secret}>`);
    expect(m.text).toContain(`Stop this briefing: ${SITE}/account/stop?b=${id}&t=${row!.secret}`);
    expect(row!.last_delivered_at?.slice(0, 10)).toBe(D);
    // 2 notices, 2 awards, 3 contracts ending, 2 amendments, 2 records, 3 instruments.
    expect(await runs(id)).toEqual([{ day: D, items: 14, status: "sent" }]);
    expect(log.mock.calls.flat().join("\n")).toContain("briefings: 1 sent, 0 failed, 0 with nothing new, 0 not on a plan with delivery");
    // The same day again, and the rest of the week: nothing more.
    await runDeliveries(envAt(D));
    await seed("2026-11-05");
    await runDeliveries(envAt("2026-11-05"));
    expect(mail.to(email)).toHaveLength(1);
    // Next Monday: the next one.
    await seed("2026-11-09");
    await runDeliveries(envAt("2026-11-09"));
    expect(mail.to(email)).toHaveLength(2);
    await seed();
  });

  it("sends a briefing whose only rows are the quarter's contracts, and writes empty for one with nothing anywhere", async () => {
    const mail = fakeMail();
    const email = newEmail("brief-72");
    const user = await makeUser(email);
    const only = await brief(user, { subject: "72", label: "72 Construction" });
    const none = await brief(user, { subject: "10", label: "10 Live material" });
    const report = await runAt(mail.binding);
    expect(report.report).toMatchObject({ sent: 1, empty: 1 });
    const [m] = mail.to(email);
    expect(m.subject).toBe("72 Construction this week: 1 contract ending next quarter");
    for (const line of ["New notices this week: none", "Awards this week: none", "Notable amendments this week: none",
      "Standing offers and supply arrangements ending within 6 months: none",
      "Contracts ending next quarter, Q4 2026-27 (January to March 2027): 1, $200,000", "- Roof repair\n  Roofing Ltd. · Public Services and Procurement Canada · ends 2027-02-01 · $200,000"]) {
      expect(m.text).toContain(line);
    }
    expect((await runs(only))[0]).toMatchObject({ status: "sent" });
    expect(await runs(none)).toEqual([{ day: D, items: 0, status: "empty" }]);
    expect((await stateOf(none))!.last_delivered_at?.slice(0, 10)).toBe(D);
    // Segment 10 has an instrument ending within 6 months: a standing list, like the year's largest records, so not news on its own.
    const ten = await readBriefing(env as never, { kind: "segment", subject: "10", segment: "" }, D, "2026-10-26");
    if (ten.state !== "ready") throw new Error(ten.state);
    expect(ten.data.instruments.rows.map((r) => r.agr)).toEqual(["01B68-210001/001/ZF"]);
  });

  it("is not sent on Free or with delivery off, and waits unclaimed while the records database is behind", async () => {
    const mail = fakeMail();
    const free = await makeUser(newEmail("brief-free"), false);
    const offUser = await makeUser(newEmail("brief-off"));
    await brief(free, { subject: "43", label: "43 IT and telecom" });
    await brief(offUser, { subject: "43", label: "43 IT and telecom", deliver: "off" });
    const first = await runAt(mail.binding);
    expect(first.report.skipped).toBe(1);
    expect(mail.handed.filter((x) => x.subject.includes("43 IT"))).toHaveLength(0);
    const waiting = await makeUser(newEmail("brief-wait"));
    const id = await brief(waiting, { subject: "82", label: "82 Editorial and design" });
    await seed("2026-11-01");
    const behind = await runAt(mail.binding);
    expect(behind.report).toMatchObject({ records: "stale", sent: 0 });
    expect((await stateOf(id))!.last_delivered_at).toBeNull();
    await seed();
  });

  it("gives the claim back when the message is refused, and waits for next week, which covers both", async () => {
    const email = newEmail("brief-refused");
    const mail = fakeMail((to) => (to === email ? Object.assign(new Error("refused"), { code: "E_RECIPIENT_SUPPRESSED" }) : undefined));
    const user = await makeUser(email);
    const last = "2026-10-26T16:00:00.000Z";
    const id = await brief(user, { subject: "71", label: "71 Mining", last });
    const due71 = () => insert("rec_due", [{ k: 99, sid: 71, fy: 2026, fq: 4, n: 2, cents: null, n_no_value: 2 }]);
    await due71();
    const first = await runAt(mail.binding);
    expect(first.report.failed).toBe(1);
    expect((await stateOf(id))!.last_delivered_at).toBe(last);
    expect(await runs(id)).toEqual([{ day: D, items: 0, status: "failed" }]);
    // Not tried again the same week.
    await seed("2026-11-03");
    await due71();
    await runAt(mail.binding, "2026-11-03");
    expect(mail.to(email)).toHaveLength(1);
    // Next Monday's message covers both weeks, and says so in its lead.
    await seed("2026-11-09");
    await due71();
    const good = fakeMail();
    await runAt(good.binding, "2026-11-09");
    expect(good.to(email)).toHaveLength(1);
    expect(good.to(email)[0].text).toContain("71 Mining, week to 2026-11-09\nData dates 2026-10-27 to 2026-11-09.");
    expect(good.to(email)[0].text).toContain("Contracts ending next quarter, Q4 2026-27 (January to March 2027): 2 (2 without a value)");
    await seed();
  });
});

// -- the pages and routes ----------------------------------------------------------------------------

describe("subscribing", () => {
  it("counts the saved searches and the briefings against one cap, inside each insert", async () => {
    const email = newEmail("brief-cap");
    const user = await makeUser(email, false);
    const filter = (n: number) => ({ kind: "tenders" as const, params: `/tenders?segment=4${n}`, label: `Search ${n}` });
    expect(await addSearch(env as never, { userId: user, plan: "free" }, filter(1), "en")).toBe("added");
    expect(await addBriefing(env as never, { userId: user, plan: "free" }, { kind: "segment", subject: "81", segment: "", label: "81 Engineering" }, "en")).toBe("added");
    expect(await addSearch(env as never, { userId: user, plan: "free" }, filter(2), "en")).toBe("added");
    // Free holds 3 in all: a fourth of either kind is refused.
    expect(await addSearch(env as never, { userId: user, plan: "free" }, filter(3), "en")).toBe("cap");
    expect(await addBriefing(env as never, { userId: user, plan: "free" }, { kind: "segment", subject: "43", segment: "", label: "43 IT" }, "en")).toBe("cap");
    expect(await addBriefing(env as never, { userId: user, plan: "free" }, { kind: "segment", subject: "81", segment: "", label: "81 Engineering" }, "en")).toBe("exists");
  });

  it("keeps a Free account's briefing with its email off and the Pro chip, and a Pro account's weekly", async () => {
    const email = newEmail("brief-free-page");
    const cookie = await signIn(email);
    const before = await (await get("/segments/82", { cookie })).text();
    const panel = /<section class="panel briefing"[\s\S]*?<\/section>/.exec(before)?.[0] ?? "";
    expect(panel).toContain('action="/account/briefings"');
    expect(panel).toContain('class="pro-tag"');
    expect(panel).toContain("the weekly email is part of Pro");
    const token = await csrf(cookie, "/segments/82");
    const res = await post("/account/briefings", { csrf: token, kind: "segment", subject: "82", lang: "en" }, { cookie });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/segments/82");
    const user = await userId(email);
    const row = await ACCOUNTS.prepare("SELECT kind, subject, segment, label, deliver FROM briefings WHERE user_id = ?").bind(user).first();
    expect(row).toEqual({ kind: "segment", subject: "82", segment: "", label: "82 Editorial and design", deliver: "off" });
    const after = await (await get("/segments/82", { cookie })).text();
    expect(after).toContain(">Briefing saved</a>");
    // The searches page lists it with the gate note; turning it on is Pro's.
    const searches = await (await get("/account/searches", { cookie })).text();
    expect(searches).toContain('id="briefings"');
    const id = /action="\/account\/briefings\/([0-9a-f]{32})\/delete"/.exec(searches)?.[1] ?? "";
    expect(id).not.toBe("");
    const on = await post(`/account/briefings/${id}`, { csrf: token, deliver: "weekly" }, { cookie });
    expect(on.headers.get("location")).toBe("/account/searches?m=b_pro#briefings");

    const proEmail = newEmail("brief-pro-page");
    const proCookie = await signIn(proEmail);
    await grantPro(proEmail);
    const proToken = await csrf(proCookie, "/buyers/pwgsc-tpsgc");
    const proPage = await (await get("/buyers/pwgsc-tpsgc", { cookie: proCookie })).text();
    expect(proPage).toContain("Sent each Monday by email.");
    const posted = await post("/account/briefings", { csrf: proToken, kind: "buyer", subject: "pwgsc-tpsgc", segment: "81", lang: "en" }, { cookie: proCookie });
    expect(posted.status).toBe(303);
    const proRow = await ACCOUNTS.prepare("SELECT kind, subject, segment, deliver FROM briefings WHERE user_id = ?").bind(await userId(proEmail)).first();
    expect(proRow).toEqual({ kind: "buyer", subject: "pwgsc-tpsgc", segment: "81", deliver: "weekly" });
    // A post naming no known segment or subject is refused.
    expect((await post("/account/briefings", { csrf: proToken, kind: "segment", subject: "99" }, { cookie: proCookie })).status).toBe(400);
  });

  it("sends a reader not signed in to sign in and back, the briefing carried (test/accounts-brief.test.ts)", async () => {
    const html = await (await get("/segments/82")).text();
    expect(html).toContain('<a href="/account/sign-in?next=%2Fsegments%2F82&amp;brief=segment%3A82" class="btn">Save this briefing</a>');
  });

  it("stops a briefing from its link, on a POST or a one-click post, and keeps it on the searches page", async () => {
    const user = await makeUser(newEmail("brief-stop"));
    const id = await brief(user, { subject: "70", label: "70 Farming" });
    const secret = "c".repeat(32);
    await ACCOUNTS.prepare("UPDATE briefings SET secret = ? WHERE id = ?").bind(secret, id).run();
    const page = await get(`/account/stop?b=${id}&t=${secret}`);
    expect(page.status).toBe(200);
    expect((await stateOf(id))!.deliver).toBe("weekly");
    expect((await get(`/account/stop?b=${id}&t=${"d".repeat(32)}`)).status).toBe(404);
    const done = await post("/account/stop", { b: id, t: secret, "List-Unsubscribe": "One-Click" }, { origin: null });
    expect(await done.text()).toBe("The briefing is off.");
    expect((await stateOf(id))!.deliver).toBe("off");
  });
});

describe("the public sample", () => {
  const PAGE = "/pro/briefing-sample";
  const MESSAGE = "/pro/briefing-sample/message";
  const LOCAL = "http://localhost";
  const segment81 = { kind: "segment" as const, subject: "81", segment: "" };
  const SANDBOX = 'sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"';
  const FRAME_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'";
  // The site's data date is 2026-10-31: the week from 2026-10-25, the quarter after Q3.
  const sampleData = async () => {
    const read = await readBriefing(env as never, segment81, "2026-10-31", "2026-10-24");
    if (read.state !== "ready") throw new Error(read.state);
    return read.data;
  };

  it("is the same page with and without a session, cached for an hour: the inbox's line, the tabs and the two frames", async () => {
    const cookie = await signIn(newEmail("brief-sample"));
    const bare = await get(PAGE);
    const signed = await get(PAGE, { cookie });
    expect(bare.status).toBe(200);
    expect(bare.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(signed.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await bare.text();
    expect(await signed.text()).toBe(body);
    expect(body).toContain("A Sample of the Weekly Briefing");
    // The page keeps the site's own headers; only the message route has its own.
    expect(bare.headers.get("x-frame-options")).toBe("DENY");
    expect(bare.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    // The inbox's line: the sender's name and MAIL_FROM as wrangler.jsonc sets it, the subject, the preview line.
    expect(body).toContain('<dd class="inbox-from"><strong>Award Watch</strong> <span class="inbox-address">&lt;alerts@awardwatch.ca&gt;</span></dd>');
    expect(body).toContain('<dt class="visually-hidden">From</dt>');
    expect(decode(body)).toMatch(/<dd class="inbox-subject">81 Engineering this week: [^<]*3 contracts ending next quarter<\/dd>/);
    expect(decode(body)).toMatch(/<dd class="inbox-preview">[^<]*Next quarter, Q4 2026-27: 3 contracts ending, [^<]*<\/dd>/);
    // No scheme in the address: both frames, the stylesheet showing the one of the site's theme.
    expect(body).toContain('<section class="panel inbox" data-scheme="auto" aria-labelledby="inbox-title">');
    expect(body).toContain(`<iframe class="inbox-frame inbox-light" src="${MESSAGE}/light" title="The message in a light inbox" ${SANDBOX} loading="lazy"></iframe>`);
    expect(body).toContain(`<iframe class="inbox-frame inbox-dark" src="${MESSAGE}/dark" title="The message in a dark inbox" ${SANDBOX} loading="lazy"></iframe>`);
    expect(body).toContain(`<a href="${PAGE}?scheme=light" class="inbox-tab-light" data-scheme="light">Light inbox</a>`);
    expect(body).toContain(`<a href="${PAGE}?scheme=dark" class="inbox-tab-dark" data-scheme="dark">Dark inbox</a>`);
    expect(body).toContain('<script src="/briefing-sample.js" defer=""></script>');
    expect(decode(body)).toContain('Here "Stop this briefing" opens the <a href="/alerts">Email Lists</a> page;');
    // The message is in the frames alone: the page carries none of its markup.
    expect(body).not.toContain('class="briefing-sample"');
    expect(body).not.toContain("81 Engineering, week to 2026-10-31");
    expect(body).not.toContain("aw_session");
    expect(body).not.toContain(EM_DASH);
    // ?scheme= names the inbox and its tab; any other value names none.
    const dark = await (await get(`${PAGE}?scheme=dark`)).text();
    expect(dark).toContain('<section class="panel inbox" data-scheme="dark"');
    expect(dark).toContain(`<a href="${PAGE}?scheme=dark" class="inbox-tab-dark" data-scheme="dark" aria-current="page">Dark inbox</a>`);
    expect(dark).toContain(`<a href="${PAGE}?scheme=light" class="inbox-tab-light" data-scheme="light">Light inbox</a>`);
    expect(await (await get(`${PAGE}?scheme=sepia`)).text()).toContain('data-scheme="auto"');
    // French: the French message in both frames, whatever the cookie says.
    const fr = nbsp(decode(await (await get(`${PAGE}?lang=fr`)).text()));
    expect(fr).toContain(`src="${MESSAGE}/light?lang=fr" title="Le message dans une messagerie claire"`);
    expect(fr).toContain(`src="${MESSAGE}/dark?lang=fr" title="Le message dans une messagerie sombre"`);
    expect(fr).toContain(">Messagerie claire</a>");
    expect(fr).toContain(">Messagerie sombre</a>");
    expect(fr).toMatch(/<dd class="inbox-subject">81 Ingénierie cette semaine : /);
    expect(fr).toContain("Ici, « Arrêter ce bulletin » ouvre la page <a href=\"/alerts\">Listes de diffusion</a>;");
    // A records database that cannot answer: the page's shell and one line, never stored, and no frame.
    const down = await get(PAGE, { env: onEnv({ RECORDS: undefined }) });
    expect(down.status).toBe(503);
    expect(down.headers.get("cache-control")).toBe("no-store");
    const downText = await down.text();
    expect(downText).toContain("The sample is not available right now");
    expect(downText).not.toContain("<iframe");
  });

  it("serves the message a subscriber is sent, line for line, but for the forced scheme, the new-tab links and the stop link", async () => {
    const data = await sampleData();
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const name = lang === "fr" ? "81 Ingénierie" : "81 Engineering";
      // A subscriber's message for the same segment and week, from the subscriber's own builder.
      const sent = briefingDigest({
        lang, to: "a@example.com", site: LOCAL, stopUrl: `${LOCAL}/account/stop?b=B&t=T${lang === "fr" ? "&lang=fr" : ""}`, briefing: segment81, name, data,
      }).html;
      // The dark rules a dark client applies: the ones under the message's own query.
      const query = /\n {2}@media \(prefers-color-scheme: dark\)\{ ([^\n]*) \}\n/.exec(sent);
      expect(query, lang).not.toBeNull();
      const rules = query![1];
      expect(rules).toContain(".bg{background:#0b1220!important}");
      // Every line the sample changes, written out: the scheme, the links' target, the rules, the stop link.
      const stop = `${LOCAL}/account/stop?b=B&amp;t=T${lang === "fr" ? "&amp;lang=fr" : ""}`;
      expect(sent.split(stop)).toHaveLength(2);
      const asSample = (scheme: "light" | "dark") => sent
        .replace('<meta name="color-scheme" content="light dark">', `<meta name="color-scheme" content="${scheme}">`)
        .replace('<meta name="supported-color-schemes" content="light dark">', `<meta name="supported-color-schemes" content="${scheme}">`)
        .replace("</title>\n", '</title>\n<base target="_blank">\n')
        .replace(query![0], scheme === "dark" ? `\n  ${rules}\n` : "\n")
        .replace(stop, `${LOCAL}/alerts${q}`);
      for (const scheme of ["light", "dark"] as const) {
        const res = await get(`${MESSAGE}/${scheme}${q}`);
        expect(res.status, `${lang} ${scheme}`).toBe(200);
        const doc = await res.text();
        expect(doc, `${lang} ${scheme}`).toBe(asSample(scheme));
        expect(doc).not.toContain("prefers-color-scheme");
        expect(doc).not.toContain("/account/stop");
        expect(doc).not.toContain("a@example.com");
        expect(doc).not.toContain(EM_DASH);
        // Dark: the dark rules stand in the head's style with no query around them; light: none of them.
        if (scheme === "dark") expect(doc).toContain(`<style>\n  body{margin:0;padding:0;background:#f8fafc;}\n  table{border-collapse:collapse;}\n  img{border:0;outline:none;text-decoration:none;}\n  ${rules}\n  @media only screen`);
        else expect(doc).not.toContain(".logo-dark{display:block!important}");
        // The message route's own headers: its policy, framed by the site alone, kept out of search results, cached as the page is.
        expect(res.headers.get("content-security-policy")).toBe(FRAME_CSP);
        expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
        expect(res.headers.get("x-robots-tag")).toBe("noindex");
        expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
        expect(res.headers.get("content-type")).toBe("text/html; charset=UTF-8");
      }
    }
    // The week as the mail writes it, from the site's data date; section 6 from 2026-10-31 to 2027-05-01.
    const en = decode(await (await get(`${MESSAGE}/light`)).text());
    expect(en).toContain("81 Engineering, week to 2026-10-31");
    expect(en).toContain("Contracts ending next quarter, Q4 2026-27 (January to March 2027): 3, $1,050,000 (1 without a value)");
    expect(en).toContain("Standing offers and supply arrangements ending within 6 months: 3</h2>");
    expect(en).toContain(">W8486-150001/001/QD</a>");
    expect(en).toContain("Departmental Individual Standing Offer · Calibration services · National Defence · expires 2026-11-01 · 2 holders</div>");
    expect(en).toMatch(/href="[^"]*\/instruments\?segment=81&within=6" [^>]*>See all 3<\/a>/);
    expect(en).not.toContain("F5211-200001");
    const fr = nbsp(decode(await (await get(`${MESSAGE}/dark?lang=fr`)).text()));
    expect(fr).toContain("81 Ingénierie, semaine se terminant le 2026-10-31");
    expect(fr).toContain("Offres à commandes et arrangements en matière d’approvisionnement prenant fin d’ici 6 mois : 3</h2>");
    expect(fr).toMatch(/href="[^"]*\/instruments\?segment=81&within=6&lang=fr" [^>]*>Voir les 3<\/a>/);
  });

  it("prints no mailing address, whatever MAIL_ADDRESS holds, and answers one line, 503, when the records cannot", async () => {
    const withAddress = onEnv({ MAIL_ADDRESS: SAMPLE_ADDRESS });
    for (const path of [PAGE, `${MESSAGE}/light`, `${MESSAGE}/dark?lang=fr`]) {
      const res = await get(path, { env: withAddress });
      expect(res.status, path).toBe(200);
      const text = await res.text();
      expect(text, path).not.toContain(SAMPLE_ADDRESS);
      expect(text, path).not.toContain("Exampletown");
    }
    for (const path of [`${MESSAGE}/light`, `${MESSAGE}/dark?lang=fr`]) {
      const down = await get(path, { env: onEnv({ RECORDS: undefined }) });
      expect(down.status, path).toBe(503);
      expect(down.headers.get("cache-control"), path).toBe("no-store");
      expect(down.headers.get("content-security-policy"), path).toBe(FRAME_CSP);
      const text = nbsp(await down.text());
      expect(text, path).toContain(path.endsWith("fr")
        ? "<p>L’exemple n’est pas disponible pour le moment : la base des dossiers ne répond pas. Réessayez dans quelques minutes.</p>"
        : "<p>The sample is not available right now: the records database cannot answer. Try again in a few minutes.</p>");
      expect(text, path).toContain(`<meta name="color-scheme" content="${path.includes("dark") ? "dark" : "light"}">`);
    }
    // A scheme the route does not know is the site's 404, under the site's own headers.
    const other = await get(`${MESSAGE}/sepia`);
    expect(other.status).toBe(404);
    expect(other.headers.get("x-frame-options")).toBe("DENY");
    expect(other.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(other.headers.get("x-robots-tag")).toBeNull();
  });

  it("is linked from the Pro page and the email lists page", async () => {
    expect(await (await get("/pro")).text()).toContain('<a href="/pro/briefing-sample">a sample of the weekly briefing</a>');
    expect(await (await get("/alerts")).text()).toContain('<a href="/pro/briefing-sample">this week&#39;s sample</a>');
  });
});
