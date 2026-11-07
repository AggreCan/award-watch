// The organization, buyer and segment deliveries (src/account/records_deliveries.ts,
// the records part of deliveries.ts, digests.ts recordsDigest) against a
// local records database built from pipeline/records_schema.sql and filled
// here, with the summary tables made by the pipeline's own GROUP BY (as
// analytics.test.ts makes them). Every expected count is written out from
// the rows below, never read back from the code under test.
//
// The records database names no day a record was first seen, so a delivery
// compares the counts by source and fiscal year with the ones its previous
// delivery kept (the mark) and reports those that rose. The tests set a
// previous mark by hand to stand for that delivery.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ROWS_MAX, runDeliveries } from "../src/account/deliveries";
import { recordsDigest } from "../src/account/digests";
import {
  BUYER_COUNTS_SQL, KIND_SOURCES, MARK_READ_SQL, ORG_COUNTS_SQL, RECORDS_DELIVERY_SQL, SEGMENT_COUNTS_SQL, type Mark, entityOf, markText,
  readMark, rises,
} from "../src/account/records_deliveries";
import { deleteSearch } from "../src/account/searches";
import type { TenderRow } from "../src/data";
import { MAX_YEARS, orgNumber } from "../src/records_db";
import { ACCOUNTS, csrf, decode, nbsp, newEmail, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { TEST_NOW, makeFakeAssets } from "./assets";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const FROM = "alerts@awardwatch.ca";
const SITE = "https://awardwatch.ca";
const DAY = "2026-10-31"; // the fixtures' data date and TEST_NOW's UTC date; fiscal year 2026 (2026-27)
const YESTERDAY = "2026-10-30";
const NOW = new Date(TEST_NOW);
const EM_DASH = String.fromCharCode(0x2014);

// -- the records ------------------------------------------------------------------------

const ORG = "org-e000000001";
const OTHER = "org-e000000002";
const DND = 102;
const oid = (id: string) => orgNumber(id) as number;

interface Rec { src: number; fy: number | null; fq: number; bid: number | null; oid: number | null; sid: number | null; extra: 0 | 1; cents: number | null; vnote: number }
const RECS: Rec[] = [];
const rec = (r: Partial<Rec> & Pick<Rec, "src" | "fy">): void => {
  RECS.push({ fq: 2, bid: DND, oid: oid(ORG), sid: null, extra: 0, cents: 1_000_000, vnote: 0, ...r });
};
// The organization at National Defence: five published contracts in 2026-27
// ($10,000 each), two in 2025-26, one grant in 2026-27, one award notice in
// 2024-25 in segment 43 that also reaches segment 82 (extra), one published
// contract in 2015-16 (before the ten years read) and one with no date.
for (let i = 0; i < 5; i++) rec({ src: 3, fy: 2026 });
for (let i = 0; i < 2; i++) rec({ src: 3, fy: 2025 });
rec({ src: 4, fy: 2026, cents: 25_000_000 });
rec({ src: 1, fy: 2024, sid: 43 });
rec({ src: 1, fy: 2024, sid: 82, extra: 1 });
rec({ src: 3, fy: 2015 });
rec({ src: 3, fy: null });
// Another organization in segment 43, for another buyer: three PSPC history
// contracts in 2026-27, one with no value published.
for (let i = 0; i < 2; i++) rec({ src: 2, fy: 2026, bid: 103, oid: oid(OTHER), sid: 43, cents: 4_000_000 });
rec({ src: 2, fy: 2026, bid: 103, oid: oid(OTHER), sid: 43, cents: null, vnote: 1 });

async function seed(state = "ready", asOf = DAY, rules = "2"): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["records", "rec_orgs", "rec_buyers", "rec_buyer_quarters", "rec_segment_years", "rec_meta"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  const insert = "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
  await RECORDS.batch(RECS.map((r) => RECORDS.prepare(insert).bind(r.src, r.fy, r.fy === null ? null : r.fq, r.bid, r.oid, r.sid, r.extra, r.cents, r.vnote)));
  await RECORDS.batch([
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, 'Exemplar Works Ltd.'), (?, 'Harbour Survey Inc.')").bind(oid(ORG), oid(OTHER)),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dnd-mdn', 'National Defence', 'Défense nationale')").bind(DND),
    RECORDS.prepare("INSERT INTO rec_buyer_quarters (bid, src, fy, fq, n, cents, n_no_value) SELECT bid, src, fy, fq, COUNT(*), SUM(cents), " +
      "SUM(CASE WHEN vnote = 1 THEN 1 ELSE 0 END) FROM records WHERE extra = 0 AND bid IS NOT NULL AND fy IS NOT NULL GROUP BY bid, src, fy, fq"),
    // The phase 2 columns (records_schema.sql): the count and sum of the counted values above zero; the median is left null here.
    RECORDS.prepare("INSERT INTO rec_segment_years (sid, src, fy, n, cents, n_no_value, n_buyers, n_orgs, n_pos, pos, med) SELECT sid, src, fy, COUNT(*), SUM(cents), " +
      "SUM(CASE WHEN vnote = 1 THEN 1 ELSE 0 END), COUNT(DISTINCT bid), COUNT(DISTINCT oid), SUM(CASE WHEN cents > 0 THEN 1 ELSE 0 END), " +
      "SUM(CASE WHEN cents > 0 THEN cents END), NULL FROM records WHERE sid IS NOT NULL AND fy IS NOT NULL GROUP BY sid, src, fy"),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', ?), ('as_of', ?), ('rules', ?)").bind(state, asOf, rules),
  ]);
}

beforeAll(() => seed());

// The counts the database holds now, by "<source number>:<fiscal year>", worked out from RECS by hand.
const ORG_NOW = { "3:2026": [5, 5_000_000], "3:2025": [2, 2_000_000], "4:2026": [1, 25_000_000], "1:2024": [1, 1_000_000] };
const SEGMENT_NOW = { "1:2024": [1, 1_000_000], "2:2026": [3, 8_000_000] };

// -- the accounts side --------------------------------------------------------------------

let seq = 0;
const nextId = () => (0xe0000000 + ++seq).toString(16).padStart(32, "0");

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

async function makeUser(email: string, lang: "en" | "fr" = "en"): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', ?, 'active')")
    .bind(id, email, lang).run();
  await ACCOUNTS.prepare(
    "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) " +
    "VALUES (?, ?, 'pro', 'manual', '2026-01-01T00:00:00.000Z', NULL, 'test', '2026-01-01T00:00:00.000Z')",
  ).bind(nextId(), id).run();
  return id;
}

const LABEL: Record<string, string> = {
  tenders: "New tender notices matching UNSPSC segment: 43 Information Technology",
  organization: "When Exemplar Works Ltd. is named on a new award, contract or grant",
  buyer: "New award notices and contracts from National Defence",
  segment: "New tender notices and award notices in segment 43 Information Technology",
};

async function addSaved(user: string, kind: string, params: string, o: { last?: string | null; lang?: "en" | "fr"; deliver?: string } = {}): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare(
    "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, last_delivered_at, deliver) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, user, kind, params, LABEL[kind], o.lang ?? "en", `2000-01-01T00:00:00.${String(seq).padStart(3, "0")}Z`, o.last ?? null, o.deliver ?? "daily").run();
  return id;
}

// The mark a previous delivery left, read at `asOf`.
async function setMark(search: string, counts: Record<string, number[]>, o: { asOf?: string; rules?: string | null; from?: number; to?: number } = {}) {
  const mark: Mark = {
    asOf: o.asOf ?? YESTERDAY, rules: o.rules === undefined ? "2" : o.rules, from: o.from ?? 2017, to: o.to ?? 2026,
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, [v[0], v[1] ?? null] as [number, number | null]])),
  };
  await ACCOUNTS.prepare("INSERT INTO delivery_marks (search_id, as_of, counts, updated_at) VALUES (?, ?, ?, ?)")
    .bind(search, mark.asOf, markText(mark), `${mark.asOf}T15:00:00.000Z`).run();
}

const markOf = async (search: string) => {
  const row = await ACCOUNTS.prepare(MARK_READ_SQL).bind(search).first<{ as_of: string; counts: string }>();
  return row ? readMark(row.as_of, row.counts) : null;
};

const deliveriesOf = async (search: string) =>
  (await ACCOUNTS.prepare("SELECT status, items FROM deliveries WHERE saved_search_id = ? ORDER BY id").bind(search)
    .all<{ status: string; items: number }>()).results ?? [];

const lastDelivered = async (search: string) =>
  (await ACCOUNTS.prepare("SELECT last_delivered_at FROM saved_searches WHERE id = ?").bind(search).first<{ last_delivered_at: string | null }>())
    ?.last_delivered_at ?? null;

function tender(reference: string, over: Partial<TenderRow> = {}): TenderRow {
  return {
    reference, amendment: 0, title_en: `Notice ${reference}`, title_fr: `Avis ${reference}`, buyer_id: "dnd-mdn",
    buyer_en: "National Defence", buyer_fr: "Défense nationale", published: DAY, closing: "2026-11-26T14:00:00",
    category: ["SRV"], notice_type_en: "Request for Proposal", notice_type_fr: "Demande de propositions",
    method_en: "Competitive - Open bidding", method_fr: "Concurrentielle - Appel d'offres ouvert", segments: ["43"], provinces: ["ON"],
    first_seen: DAY, status: "open", ...over,
  };
}

// The new-notice files of the week to the data date, empty unless given.
function week(byDay: Record<string, TenderRow[]> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < 8; i++) {
    const d = new Date(`${DAY}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    out[`tenders/new/${day}.json`] = byDay[day] ?? [];
  }
  return out;
}

function jobEnv(mail: SendEmail, files: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return onEnv({ ASSETS: makeFakeAssets({}, { ...week(), ...files }), MAIL: mail, MAIL_FROM: FROM, MAIL_SENDER: undefined, ...extra });
}

const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

// -- the pieces -----------------------------------------------------------------------------

describe("the entity a search follows", () => {
  it("is read from the saved page and checked as the pages check ids", () => {
    expect(entityOf("organization", `/organizations/${ORG}`)).toEqual({ kind: "organization", key: oid(ORG), id: ORG });
    expect(entityOf("buyer", "/buyers/dnd-mdn")).toEqual({ kind: "buyer", key: "dnd-mdn", id: "dnd-mdn" });
    expect(entityOf("segment", "/segments/43")).toEqual({ kind: "segment", key: 43, id: "43" });
    for (const [kind, params] of [
      ["organization", "/organizations/org-E000000001"], ["organization", `/organizations/${ORG}?x=1`], ["buyer", "/buyers/DND"],
      ["buyer", "/buyers/a--b"], ["segment", "/segments/99"], ["segment", "/segments/4"], ["tenders", "/tenders"], ["buyer", "/segments/43"],
    ]) expect(entityOf(kind, params), `${kind} ${params}`).toBeNull();
  });
});

describe("the counts compared", () => {
  const mark = (counts: Record<string, [number, number | null]>, o: Partial<Mark> = {}): Mark =>
    ({ asOf: YESTERDAY, rules: "2", from: 2017, to: 2026, counts, ...o });

  it("report each source and year whose count rose, newest year first, and nothing that fell", () => {
    const prev = mark({ "3:2026": [3, 300], "3:2025": [4, 400], "1:2024": [1, 100] });
    const now = mark({ "3:2026": [5, 500], "3:2025": [2, 200], "4:2026": [1, 900], "1:2024": [1, 150], "1:2025": [2, null] }, { asOf: DAY });
    expect(rises(prev, now)).toEqual([
      { src: "contracts", fy: 2026, more: 2, n: 5, cents: 500 },
      { src: "grants", fy: 2026, more: 1, n: 1, cents: 900 },
      { src: "awards", fy: 2025, more: 2, n: 2, cents: null },
    ]);
  });

  it("have nothing to compare on a first delivery or across counting rules, and skip a year the mark did not read", () => {
    const now = mark({ "3:2027": [4, 400], "3:2026": [1, 100] }, { asOf: DAY, from: 2018, to: 2027 });
    expect(rises(null, now)).toBeNull();
    expect(rises(mark({}, { rules: "1" }), now)).toBeNull();
    // The mark read 2017 to 2026: 2027 is outside it, so its four are not new; 2026's one is.
    expect(rises(mark({}), now)).toEqual([{ src: "contracts", fy: 2026, more: 1, n: 1, cents: 100 }]);
  });

  it("keep through their stored form, and a damaged one reads as none", () => {
    const m = mark({ "3:2026": [5, 500], "2:2019": [1, null] });
    expect(readMark(YESTERDAY, markText(m))).toEqual(m);
    for (const text of ["", "{", "[]", '{"rules":"2","from":2017,"to":2026,"counts":{"9:2026":[1,1]}}',
      '{"rules":"2","from":2017,"to":2026,"counts":{"3:2026":[-1,1]}}', '{"rules":2,"from":2017,"to":2026,"counts":{}}']) {
      expect(readMark(YESTERDAY, text), text).toBeNull();
    }
    expect(readMark("yesterday", markText(m))).toBeNull();
  });
});

describe("the records statements", () => {
  it("are bounded: a LIMIT on each, ten fiscal years at most, one entity, and a plan through an index", async () => {
    for (const sql of RECORDS_DELIVERY_SQL) {
      expect(sql, sql).toMatch(/LIMIT \d+$/);
      expect(sql, sql).toContain("= ?1");
    }
    for (const sql of [ORG_COUNTS_SQL, BUYER_COUNTS_SQL, SEGMENT_COUNTS_SQL]) {
      expect(sql, sql).toContain("fy BETWEEN ?2 AND ?3");
      expect(Number(/LIMIT (\d+)$/.exec(sql)?.[1])).toBeLessThanOrEqual(4 * MAX_YEARS);
    }
    expect(KIND_SOURCES).toEqual({
      organization: ["awards", "history", "contracts", "grants"], buyer: ["awards", "history", "contracts"], segment: ["awards", "history"],
    });
    const binds: Record<string, (string | number)[]> = {
      [ORG_COUNTS_SQL]: [oid(ORG), 2017, 2026], [BUYER_COUNTS_SQL]: ["dnd-mdn", 2017, 2026], [SEGMENT_COUNTS_SQL]: [43, 2017, 2026],
    };
    for (const sql of RECORDS_DELIVERY_SQL) {
      const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...(binds[sql] ?? [sql.includes("rec_buyers") ? "dnd-mdn" : oid(ORG)])).all()).results ?? [])
        .map((r) => String((r as { detail?: unknown }).detail));
      expect(steps.filter((s) => /^SCAN (records|rec_\w+)\b/.test(s) && !/USING/.test(s)), `${sql}\n${steps.join("\n")}`).toEqual([]);
      expect(steps.some((s) => /^SEARCH (records|rec_\w+) USING .*(INDEX|PRIMARY KEY)/.test(s)), `${sql}\n${steps.join("\n")}`).toBe(true);
    }
    const plan = async (sql: string) =>
      ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds[sql]).all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail)).join("\n");
    expect(await plan(ORG_COUNTS_SQL)).toContain("records_org");
    expect(await plan(BUYER_COUNTS_SQL)).toContain("rec_buyer_quarters_buyer");
    expect(await plan(SEGMENT_COUNTS_SQL)).toContain("rec_segment_years_segment");
  });
});

// -- the runs --------------------------------------------------------------------------------

describe("an organization search", () => {
  it("keeps the counts on its first delivery and sends nothing", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("rec-first");
    const search = await addSaved(await makeUser(email), "organization", `/organizations/${ORG}`);
    const report = await runDeliveries(jobEnv(mail.binding));
    expect(report.records).toBeNull();
    expect(mail.to(email)).toHaveLength(0);
    expect(await deliveriesOf(search)).toEqual([{ status: "empty", items: 0 }]);
    expect(await lastDelivered(search)).toBe(NOW.toISOString());
    expect(await markOf(search)).toEqual({ asOf: DAY, rules: "2", from: 2017, to: 2026, counts: ORG_NOW });
  });

  it("reports the counts that rose since the last delivery, and keeps the new ones", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("rec-org");
    const search = await addSaved(await makeUser(email), "organization", `/organizations/${ORG}`, { last: `${YESTERDAY}T15:00:00.000Z` });
    await setMark(search, { "3:2026": [3, 3_000_000], "3:2025": [2, 2_000_000], "1:2024": [1, 1_000_000] });
    const report = await runDeliveries(jobEnv(mail.binding));
    expect(report.outcome).toBe("done");
    const [m] = mail.to(email);
    expect(m.subject).toBe("3 new records: Exemplar Works Ltd.");
    expect(await deliveriesOf(search)).toEqual([{ status: "sent", items: 3 }]);
    expect((await markOf(search))?.counts).toEqual(ORG_NOW);
    expect((await markOf(search))?.asOf).toBe(DAY);
    const stop = (await ACCOUNTS.prepare("SELECT secret FROM delivery_tokens WHERE search_id = ?").bind(search).first<{ secret: string }>())!.secret;
    expect(m.headers?.["List-Unsubscribe"]).toBe(`<mailto:contact@awardwatch.ca>, <${SITE}/account/stop?s=${search}&t=${stop}>`);
    const html = decode(m.html!);
    expect(html).toContain("New records naming Exemplar Works Ltd.");
    expect(html).toContain("3 more records than at yesterday's refresh, by source and federal fiscal year.");
    // Contracts before grants within 2026-27; the 2025-26 count did not move and the 2015-16 record is outside the years read.
    expect(html.match(/<tr><td class="rule"/g)).toHaveLength(2);
    expect(html.indexOf("Published contracts, 2026-27")).toBeLessThan(html.indexOf("Grants and contributions, 2026-27"));
    expect(html).toContain(`href="${SITE}/organizations/${ORG}/analytics?source=contracts"`);
    expect(html).toContain("2 more, 5 in all");
    expect(html).toContain("Counted value $50,000");
    expect(html).toContain("1 more, 1 in all");
    expect(html).toContain("Counted value $250,000");
    expect(html).toContain(`<a href="${SITE}/organizations/${ORG}" style="display:inline-block;`);
    expect(html).not.toContain("2025-26");
    const text = m.text!;
    expect(text).toContain("- Published contracts, 2026-27\n  2 more, 5 in all\n  Counted value $50,000\n");
    expect(text).toContain(`Open the profile: ${SITE}/organizations/${ORG}`);
    expect(text).toContain(`Stop this delivery: ${SITE}/account/stop?s=${search}&t=${stop}`);
    for (const part of [m.subject, html, text]) expect(part).not.toContain(EM_DASH);
  });

  it("sends nothing when no count rose, and moves its mark to today's counts", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("rec-same");
    const search = await addSaved(await makeUser(email), "organization", `/organizations/${ORG}`, { last: `${YESTERDAY}T15:00:00.000Z` });
    // A count that fell (a record withdrawn) is not news either.
    await setMark(search, { ...ORG_NOW, "3:2025": [3, 3_000_000] });
    await runDeliveries(jobEnv(mail.binding));
    expect(mail.to(email)).toHaveLength(0);
    expect(await deliveriesOf(search)).toEqual([{ status: "empty", items: 0 }]);
    expect((await markOf(search))?.asOf).toBe(DAY);
  });

  it("starts again from today's counts after the counting rules changed", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("rec-rules");
    const search = await addSaved(await makeUser(email), "organization", `/organizations/${ORG}`, { last: `${YESTERDAY}T15:00:00.000Z` });
    await setMark(search, {}, { rules: "1" });
    await runDeliveries(jobEnv(mail.binding));
    expect(mail.to(email)).toHaveLength(0);
    expect(await deliveriesOf(search)).toEqual([{ status: "empty", items: 0 }]);
    expect((await markOf(search))?.rules).toBe("2");
  });

  it("keeps the old mark when the message is refused, so the next delivery reports the same rise", async () => {
    quiet();
    const email = newEmail("rec-refused");
    const mail = fakeMail((to) => (to === email ? Object.assign(new Error("refused"), { code: "E_RECIPIENT_SUPPRESSED" }) : undefined));
    const search = await addSaved(await makeUser(email), "organization", `/organizations/${ORG}`, { last: `${YESTERDAY}T15:00:00.000Z` });
    // One more contract in 2026-27; the keys the mark lacks (2025-26, the grant, the award notice) count whole: 1 + 2 + 1 + 1.
    await setMark(search, { "3:2026": [4, 4_000_000] });
    await runDeliveries(jobEnv(mail.binding));
    expect(mail.to(email)).toHaveLength(1);
    expect(await deliveriesOf(search)).toEqual([{ status: "failed", items: 5 }]);
    expect((await markOf(search))?.asOf).toBe(YESTERDAY);
    expect(await lastDelivered(search)).toBe(`${YESTERDAY}T15:00:00.000Z`);
  });

  it("is written in the search's language", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("rec-fr");
    const search = await addSaved(await makeUser(email, "fr"), "organization", `/organizations/${ORG}`, { last: "2026-10-28T15:00:00.000Z", lang: "fr" });
    await setMark(search, { "3:2026": [3, 3_000_000], "3:2025": [2, 2_000_000] }, { asOf: "2026-10-28" });
    await runDeliveries(jobEnv(mail.binding));
    const [m] = mail.to(email);
    expect(nbsp(m.subject)).toBe("4 nouveaux dossiers : Exemplar Works Ltd.");
    const text = nbsp(m.text!);
    expect(text).toContain("Nouveaux dossiers qui nomment Exemplar Works Ltd.");
    expect(text).toContain("4 dossiers de plus qu’à la mise à jour du 2026-10-28, par source et par exercice financier fédéral.");
    expect(text).toContain("- Contrats publiés, 2026-2027\n  2 de plus, 5 au total\n  Valeur comptée : 50 000 $\n");
    expect(text).toContain("- Avis d’attribution, 2024-2025\n  1 de plus, 1 au total");
    expect(text).toContain(`${SITE}/organizations/${ORG}/analytics?source=grants&lang=fr`);
    expect(text).toContain(`Ouvrir le profil : ${SITE}/organizations/${ORG}?lang=fr`);
  });
});

describe("a buyer search", () => {
  it("counts the buyer's award notices, contract history and published contracts from its summary rows, not its grants", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("rec-buyer");
    const search = await addSaved(await makeUser(email), "buyer", "/buyers/dnd-mdn", { last: `${YESTERDAY}T15:00:00.000Z` });
    await setMark(search, { "3:2026": [4, 4_000_000], "3:2025": [2, 2_000_000], "1:2024": [1, 1_000_000] });
    await runDeliveries(jobEnv(mail.binding));
    const [m] = mail.to(email);
    expect(m.subject).toBe("1 new record: National Defence");
    expect(decode(m.html!)).toContain("New records from National Defence");
    expect(m.text).toContain("- Published contracts, 2026-27\n  1 more, 5 in all");
    expect(m.text).not.toContain("Grants");
    expect(m.text).toContain(`Open the buyer page: ${SITE}/buyers/dnd-mdn`);
    // History (2) appears as soon as the buyer has a row of it; this one has none.
    expect((await markOf(search))?.counts).toEqual({ "3:2026": [5, 5_000_000], "3:2025": [2, 2_000_000], "1:2024": [1, 1_000_000] });
  });
});

describe("a segment search", () => {
  it("sends the segment's new tender notices and the records counts that rose, as two parts of one message", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("rec-seg");
    const search = await addSaved(await makeUser(email), "segment", "/segments/43", { last: `${YESTERDAY}T15:00:00.000Z` });
    await setMark(search, { "1:2024": [1, 1_000_000], "2:2026": [1, 4_000_000] });
    const files = week({ [DAY]: [tender("cb-43-0001"), tender("cb-72-0001", { segments: ["72"] })] });
    await runDeliveries(jobEnv(mail.binding, files));
    const [m] = mail.to(email);
    expect(m.subject).toBe("1 new tender notice, 2 new records: 43 IT and telecom");
    const html = decode(m.html!);
    expect(html).toContain("New in segment 43 IT and telecom");
    expect(html.indexOf("New tender notices")).toBeLessThan(html.indexOf("Records counted"));
    expect(html).toContain("1 notice published since yesterday's refresh.");
    expect(html).toContain(`href="${SITE}/tenders/cb-43-0001"`);
    expect(html).not.toContain("cb-72-0001");
    expect(html).toContain("PSPC contract history, 2026-27");
    expect(html).toContain("2 more, 3 in all");
    expect(html).toContain(`href="${SITE}/segments/43/analytics?source=history"`);
    expect(await deliveriesOf(search)).toEqual([{ status: "sent", items: 3 }]);
    expect((await markOf(search))?.counts).toEqual(SEGMENT_NOW);
  });

  it("sends its tender notices on a first delivery, while the counts become the mark", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("rec-seg-first");
    const search = await addSaved(await makeUser(email), "segment", "/segments/43");
    await runDeliveries(jobEnv(mail.binding, week({ [DAY]: [tender("cb-43-0002")] })));
    const [m] = mail.to(email);
    expect(m.subject).toBe("1 new tender notice: 43 IT and telecom");
    expect(m.text).not.toContain("Records counted");
    expect(await deliveriesOf(search)).toEqual([{ status: "sent", items: 1 }]);
    expect((await markOf(search))?.counts).toEqual(SEGMENT_NOW);
  });
});

describe("the message's rows", () => {
  it("are at most ROWS_MAX in all, the counts first, with a line linking the segment's notices for the rest", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ src: i % 2 ? "history" : "awards", fy: 2026 - Math.floor(i / 2), more: 1, n: 3, cents: 100 } as const));
    const tenders = Array.from({ length: ROWS_MAX - rows.length }, (_, i) => tender(`cb-43-1${String(i).padStart(3, "0")}`));
    const m = recordsDigest({
      lang: "en", to: "reader@example.com", site: SITE, label: LABEL.segment, params: "/segments/43", cadence: "daily", dataDate: DAY,
      stopUrl: `${SITE}/account/stop?s=x&t=y`, total: 80, kind: "segment", name: "43 IT and telecom", rows, more: 20, since: YESTERDAY,
      tenders, tenderTotal: 60, tenderSince: YESTERDAY,
    });
    expect(m.html.match(/<tr><td class="rule"/g)).toHaveLength(ROWS_MAX);
    expect(decode(m.html)).toContain(`<a href="${SITE}/tenders?segment=43" style="color:#334155;">And 30 more on the site</a>`);
    expect(m.subject).toBe("60 new tender notices, 20 new records: 43 IT and telecom");
  });
});

describe("a records database that is not ready", () => {
  async function waitingRun(extra: Record<string, unknown>, expected: string, line: string) {
    const log = quiet();
    const mail = fakeMail();
    const email = newEmail("rec-wait");
    const user = await makeUser(email);
    const org = await addSaved(user, "organization", `/organizations/${ORG}`);
    const buyer = await addSaved(user, "buyer", "/buyers/dnd-mdn");
    const tenders = await addSaved(user, "tenders", "/tenders?segment=43");
    const report = await runDeliveries(jobEnv(mail.binding, week({ [DAY]: [tender("cb-43-0003")] }), extra));
    expect(report.records).toBe(expected);
    expect(report.waiting).toBeGreaterThanOrEqual(2);
    // The two wait unclaimed for the next hour; the tender search goes as usual.
    for (const id of [org, buyer]) {
      expect(await deliveriesOf(id)).toEqual([]);
      expect(await lastDelivered(id)).toBeNull();
    }
    expect(await deliveriesOf(tenders)).toEqual([{ status: "sent", items: 1 }]);
    expect(mail.to(email)).toHaveLength(1);
    const lines = log.mock.calls.flat().join("\n");
    expect(lines).toContain(`organization, buyer or segment searches waiting: ${line}`);
    expect(lines).not.toContain(email);
  }

  it("leaves those searches for the next hour when there is no binding", () =>
    waitingRun({ RECORDS: undefined }, "absent", "the records database is not bound"));

  it("leaves them while a load is under way", async () => {
    await seed("loading");
    try {
      await waitingRun({}, "loading", "the records database is loading");
    } finally {
      await seed();
    }
  });

  it("leaves them while the database is at an earlier data date", async () => {
    await seed("ready", YESTERDAY);
    try {
      await waitingRun({}, "stale", "the records database is not at today's data date");
    } finally {
      await seed();
    }
  });

  it("leaves them when a statement fails, with a log line that names no address", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = { prepare: (s: string) => RECORDS.prepare(s), batch: async () => { throw new Error("D1_ERROR: no such table: records: SQLITE_ERROR"); } };
    await waitingRun({ RECORDS: failing }, "failed", "the records database could not be read");
  });

  it("leaves them when the accounts database has no delivery_marks table yet", async () => {
    const missing = new Proxy(ACCOUNTS, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => (sql === MARK_READ_SQL
            ? { bind: () => ({ first: async () => { throw new Error("D1_ERROR: no such table: delivery_marks: SQLITE_ERROR"); } }) }
            : target.prepare(sql));
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await waitingRun({ ACCOUNTS: missing }, "no_marks", "the accounts database has no delivery_marks table");
  });
});

describe("a mark", () => {
  it("goes with its search and with the account", async () => {
    const email = newEmail("rec-delete");
    const cookie = await signIn(email);
    const id = await userId(email);
    const one = await addSaved(id, "organization", `/organizations/${ORG}`);
    const two = await addSaved(id, "segment", "/segments/43");
    await setMark(one, ORG_NOW);
    await setMark(two, SEGMENT_NOW);
    expect(await deleteSearch(onEnv() as never, id, one)).toBe(true);
    expect(await markOf(one)).toBeNull();
    expect(await markOf(two)).not.toBeNull();
    const token = await csrf(cookie, "/account/delete");
    expect((await post("/account/delete", { csrf: token, confirm: "yes" }, { cookie })).status).toBe(200);
    expect(await markOf(two)).toBeNull();
  });
});
