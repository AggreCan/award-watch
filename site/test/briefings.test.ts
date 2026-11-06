// Weekly briefings (src/account/briefings.ts, briefing_pages.tsx, digests.ts
// briefingDigest; docs/accounts.md, Weekly briefings): the shared cap counted
// over both tables, Free kept with its email off and the Pro chip, Pro kept
// weekly; the weekly due rule and the span; the fiscal quarter across the
// March 31 turn; the message read from a local records database built from
// pipeline/records_schema.sql with rows written here, in English and French
// byte for byte, with the "new this week" marks and the notable threshold; a
// briefing with only the quarter's contracts sent, one with nothing written
// empty; the run's claim and stop link; the public sample, the same with and
// without a session; and every statement's plan. Every expected line is
// written out from the rows below, never read back from the code under test.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addBriefing, BRIEFINGS_DUE_SQL, BUYER_BRIEFING_SQL, SEGMENT_BRIEFING_SQL, briefingDue, briefingStart, nextQuarter, quarterTurn,
  readBriefing, runBriefings, weekAnchor } from "../src/account/briefings";
import { runDeliveries } from "../src/account/deliveries";
import { briefingDigest, quarterMonths, quarterName } from "../src/account/digests";
import { addSearch } from "../src/account/searches";
import { BUYER_DUE_SQL, SEGMENT_DUE_SQL } from "../src/records_db";
import { ACCOUNTS, csrf, decode, get, grantPro, nbsp, newEmail, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
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
  await RECORDS.batch(["rec_events", "rec_meta", "rec_expiring", "rec_due", "records", "rec_details", "rec_buyers", "rec_orgs"]
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
}

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
On the 6-month radar: https://awardwatch.ca/expiring/6m?segment=81

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
Dans le radar sur 6 mois : https://awardwatch.ca/expiring/6m?segment=81&lang=fr

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
    expect(en.subject).toBe("Weekly briefing, 81 Engineering: 2 new notices, 2 awards, 3 contracts ending next quarter");
    expect(en.text).toBe(EXPECTED_EN);
    expect(en.html).toContain(">Awards this week: 2. Next quarter, Q4 2026-27: 3 contracts ending, $1.1M; new to the list: 2.</div>");
    expect(en.headers).toEqual({
      "List-Unsubscribe": `<mailto:contact@awardwatch.ca>, <${SITE}/account/stop?b=B&t=T>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    const fr = briefingDigest({
      lang: "fr", to: "a@example.com", site: SITE, stopUrl: `${SITE}/account/stop?b=B&t=T&lang=fr`, briefing: segment81, name: "81 Ingénierie", data: read.data,
    });
    expect(nbsp(fr.subject)).toBe("Bulletin hebdomadaire, 81 Ingénierie : 2 nouveaux avis, 2 attributions, 3 contrats prenant fin le trimestre prochain");
    expect(nbsp(fr.text)).toBe(EXPECTED_FR);
    for (const m of [en, fr]) for (const part of [m.subject, m.text, m.html]) expect(part).not.toContain(EM_DASH);
    // The marks and the totals are in the HTML part too, each value escaped.
    expect(en.html).toContain("Supplier not named");
    expect(decode(en.html)).toContain(">Engineering support, Esquimalt Graving Dock</a>");
    expect(en.html).toContain(">new this week</span>");
    expect(decode(fr.html)).toContain(">Soutien en ingénierie, cale sèche d'Esquimalt</a>");
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
    expect(m.text).toContain("On the 6-month radar: https://awardwatch.ca/expiring/6m?buyer=dfo-mpo&segment=81");
    // The whole buyer: its quarter from rec_due, no grant, and a published contract's award among its own.
    const whole = await readBriefing(env as never, { kind: "buyer", subject: "pspc-spac", segment: "" }, D, "2026-10-26");
    if (whole.state !== "ready") throw new Error(whole.state);
    expect(whole.data.awards.sources.map((s) => s.src)).toEqual([1, 3]);
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
    expect(m.subject).toBe("Weekly briefing, 81 Engineering: 2 new notices, 2 awards, 3 contracts ending next quarter");
    expect(m.headers?.["List-Unsubscribe"]).toBe(`<mailto:contact@awardwatch.ca>, <${SITE}/account/stop?b=${id}&t=${row!.secret}>`);
    expect(m.text).toContain(`Stop this briefing: ${SITE}/account/stop?b=${id}&t=${row!.secret}`);
    expect(row!.last_delivered_at?.slice(0, 10)).toBe(D);
    // 2 notices, 2 awards, 3 contracts ending, 2 amendments, 2 records.
    expect(await runs(id)).toEqual([{ day: D, items: 11, status: "sent" }]);
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
    expect(m.subject).toBe("Weekly briefing, 72 Construction: 1 contract ending next quarter");
    for (const line of ["New notices this week: none", "Awards this week: none", "Notable amendments this week: none",
      "Contracts ending next quarter, Q4 2026-27 (January to March 2027): 1, $200,000", "- Roof repair\n  Roofing Ltd. · Public Services and Procurement Canada · ends 2027-02-01 · $200,000"]) {
      expect(m.text).toContain(line);
    }
    expect((await runs(only))[0]).toMatchObject({ status: "sent" });
    expect(await runs(none)).toEqual([{ day: D, items: 0, status: "empty" }]);
    expect((await stateOf(none))!.last_delivered_at?.slice(0, 10)).toBe(D);
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
    expect(after).toContain(">Subscribed</a>");
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

  it("sends a reader not signed in to sign in and back", async () => {
    const html = await (await get("/segments/82")).text();
    expect(html).toContain('<a href="/account/sign-in?next=%2Fsegments%2F82" class="btn">Subscribe</a>');
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
  it("is built from this week's data, the same with and without a session, cached for an hour", async () => {
    const cookie = await signIn(newEmail("brief-sample"));
    const bare = await get("/pro/briefing-sample");
    const signed = await get("/pro/briefing-sample", { cookie });
    expect(bare.status).toBe(200);
    expect(bare.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(signed.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await bare.text();
    expect(await signed.text()).toBe(body);
    expect(body).toContain("A Sample of the Weekly Briefing");
    // The site's data date is 2026-10-31: the week from 2026-10-25, the quarter after Q3.
    expect(decode(body)).toContain("81 Engineering, week to 2026-10-31");
    expect(decode(body)).toContain("Contracts ending next quarter, Q4 2026-27 (January to March 2027): 3, $1,050,000 (1 without a value)");
    expect(body).not.toContain("aw_session");
    expect(body).not.toContain(EM_DASH);
    const fr = await (await get("/pro/briefing-sample?lang=fr")).text();
    expect(nbsp(decode(fr))).toContain("81 Ingénierie, semaine se terminant le 2026-10-31");
    // A records database that cannot answer: the page's shell and one line, never stored.
    const down = await get("/pro/briefing-sample", { env: onEnv({ RECORDS: undefined }) });
    expect(down.status).toBe(503);
    expect(down.headers.get("cache-control")).toBe("no-store");
    expect(await down.text()).toContain("The sample is not available right now");
  });

  it("is linked from the Pro page and the email lists page", async () => {
    expect(await (await get("/pro")).text()).toContain('<a href="/pro/briefing-sample">A sample of the weekly briefing</a>');
    expect(await (await get("/alerts")).text()).toContain('<a href="/pro/briefing-sample">this week&#39;s sample</a>');
  });
});
