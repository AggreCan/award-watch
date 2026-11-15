// The grouped saved-search email and four smaller items, approved by the operator on 2026-11-14:
// 1. an account with more than five saved searches with news in one run gets them in ONE message (a section a
//    search, one row budget, a stop link a section and one for the whole message in its headers), each search
//    keeping its own claim, row and mark; the message counts once against the run's cap, the day's ceiling and
//    the run log;
// 2. a downgraded account's saved searches leave the run's list once read, as the watch mail, the briefings
//    and the saved views do;
// 3. the console's bulk runs (the accounts-open and Ultra messages) read the day's room, stop at the ceiling
//    with a line that says so, and count for the rest of the day; the daily check reads their rows correctly;
// 4. the privacy page says how long a saved search's delivery history is kept;
// 5. three lines name the shared figure as saved searches and briefings, each plan its own figure.
//
// Storage is this file's own, and every run is narrowed to the test's own accounts (scope) on a day of its own.
import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "../public/closing.js";
import { overview } from "../src/account/admin_ops";
import * as announce from "../src/account/announce";
import { BRIEFINGS_DUE_SQL } from "../src/account/briefings";
import * as D from "../src/account/deliveries";
import { type RunReport, runDeliveries } from "../src/account/deliveries";
import { weeklyDigest } from "../src/account/digests";
import { RULES } from "../src/account/entitlements";
import { type Mark, markText } from "../src/account/records_deliveries";
import { VIEWS_DUE_SQL } from "../src/account/view_mail";
import { WATCH_DUE_SQL } from "../src/account/watch_mail";
import { WEEKLY_DUE_SQL } from "../src/account/weekly";
import type { TenderRow } from "../src/data";
import { t, type Lang } from "../src/i18n";
import { app } from "../src/index";
import { INSERT_INTEREST, interestFilter, newToken } from "../src/pages/interest";
import { fiscalYearOf, orgNumber } from "../src/records_db";
import { collectAlerts, gatherInputs } from "../src/watchdog";
import { ACCOUNTS, DB, csrf, decode, get, nbsp, newEmail, nextIp, onEnv, post, signIn, ultraEnv, useAccountsDb } from "./accounts-helpers";
import { makeFakeAssets, testEnv } from "./assets";
import stats from "./fixtures/stats.json";
import { contract, weeklyInput } from "./mail-fixtures";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const FROM = "alerts@awardwatch.ca";
const SITE = "https://awardwatch.ca";
// Email Sending's limit on a custom header's value, and RFC 5322's on a line, written out here
// (developers.cloudflare.com/email-service/reference/headers/; the List-Unsubscribe URI cannot be folded inside).
const HEADER_VALUE_MAX = 2048;
const LINE_MAX = 998;

beforeAll(() => applySql(RECORDS, RECORDS_SCHEMA));

let logs: ReturnType<typeof vi.spyOn>;
let quiet: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logs = vi.spyOn(console, "log").mockImplementation(() => {});
  quiet = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  logs.mockRestore();
  quiet.mockRestore();
});

// -- the databases, wrapped (a hook may wait, so a test can change a row between the run's read and its claim) --

type Hook = { rewrite?: (sql: string) => string; before?: (sqls: string[]) => void | Promise<void> };

class Stmt {
  constructor(readonly sql: string, readonly inner: D1PreparedStatement, readonly hook: Hook) {}
  bind(...values: unknown[]) {
    return new Stmt(this.sql, this.inner.bind(...values), this.hook);
  }
  async first(column?: string) {
    await this.hook.before?.([this.sql]);
    return column === undefined ? this.inner.first() : this.inner.first(column);
  }
  async run() {
    await this.hook.before?.([this.sql]);
    return this.inner.run();
  }
  async all() {
    await this.hook.before?.([this.sql]);
    return this.inner.all();
  }
  async raw(o?: { columnNames?: boolean }) {
    await this.hook.before?.([this.sql]);
    return this.inner.raw(o as never);
  }
}

function hooked(real: D1Database, hook: Hook): D1Database {
  return {
    prepare: (q: string) => {
      const sql = hook.rewrite ? hook.rewrite(q) : q;
      return new Stmt(sql, real.prepare(sql), hook);
    },
    batch: async (stmts: Stmt[]) => {
      await hook.before?.(stmts.map((s) => s.sql));
      return real.batch(stmts.map((s) => s.inner));
    },
    exec: (q: string) => real.exec(q),
  } as unknown as D1Database;
}

// Each part's list of what is due narrowed to these users.
function scope(users: string[]): (sql: string) => string {
  const list = users.map((u) => `'${u.replace(/[^0-9a-f]/g, "")}'`).join(", ");
  const narrow = (sql: string, alias: string) => {
    const at = sql.lastIndexOf("ORDER BY");
    return `${sql.slice(0, at)}AND ${alias}.user_id IN (${list}) ${sql.slice(at)}`;
  };
  return (sql) => {
    if (sql.includes("LEFT JOIN delivery_tokens k ON k.search_id = s.id")) return narrow(sql, "s");
    if (sql === WATCH_DUE_SQL) return narrow(sql, "m");
    if (sql === BRIEFINGS_DUE_SQL) return narrow(sql, "b");
    if (sql === VIEWS_DUE_SQL) return narrow(sql, "v");
    if (sql === WEEKLY_DUE_SQL) return narrow(sql, "m");
    return sql;
  };
}

// The claim's statement, as the job writes it for a search (deliveries.ts claim).
const CLAIM_PART = "UPDATE saved_searches SET last_delivered_at = ? WHERE id = ? AND deliver IN ('daily', 'weekly')";

// -- the accounts --------------------------------------------------------------------------------------

let seq = 0;
const nextId = () => (0xf0000000 + ++seq).toString(16).padStart(32, "0");
const createdAt = () => new Date(Date.UTC(2001, 0, 1) + ++seq * 1000).toISOString();

type User = { id: string; email: string };

// An account on a plan, its cached plan (users.plan) as given: pro for Pro and Ultra unless said otherwise.
function userRows(plan: "free" | "pro" | "ultra", o: { cached?: "free" | "pro"; lang?: Lang } = {}): { user: User; statements: D1PreparedStatement[] } {
  const id = nextId();
  const email = newEmail(`rg-${plan}`);
  const statements = [
    ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, '2026-01-01T00:00:00.000Z', ?, 'active', ?)")
      .bind(id, email, o.lang ?? "en", o.cached ?? (plan === "free" ? "free" : "pro")),
  ];
  if (plan !== "free") {
    const grant = nextId();
    statements.push(ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) " +
      "VALUES (?, ?, 'pro', 'manual', '2026-01-01T00:00:00.000Z', NULL, 'test', '2026-01-01T00:00:00.000Z')",
    ).bind(grant, id));
    if (plan === "ultra") statements.push(ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(grant));
  }
  return { user: { id, email }, statements };
}

async function user(plan: "free" | "pro" | "ultra", o: { cached?: "free" | "pro"; lang?: Lang } = {}): Promise<User> {
  const { user: u, statements } = userRows(plan, o);
  await ACCOUNTS.batch(statements);
  return u;
}

const lastDay = (day: string) => `${addDays(day, -1)}T16:00:00.000Z`;
const kindOf = (params: string) =>
  params.startsWith("/expiring") ? "expiring" : params.startsWith("/organizations") ? "organization" : params.startsWith("/buyers") ? "buyer"
    : params.startsWith("/segments") ? "segment" : "tenders";

type SearchOpts = { last?: string | null; lang?: Lang; label?: string; deliver?: string };

function searchRow(userId: string, params: string, o: SearchOpts = {}): { id: string; statement: D1PreparedStatement } {
  const id = nextId();
  return {
    id,
    statement: ACCOUNTS.prepare(
      "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, last_delivered_at, deliver) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, userId, kindOf(params), params, o.label ?? `Saved ${params}`, o.lang ?? "en", createdAt(), o.last === undefined ? null : o.last, o.deliver ?? "daily"),
  };
}

async function search(userId: string, params: string, o: SearchOpts = {}): Promise<string> {
  const { id, statement } = searchRow(userId, params, o);
  await statement.run();
  return id;
}

// n tender searches that all match the day's tender notice (tender() below), each its own filter.
async function tenderSearches(userId: string, n: number, last: string | null): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i += 50) {
    const rows = Array.from({ length: Math.min(50, n - i) }, (_, k) => searchRow(userId, `/tenders?segment=72&x=${i + k}`, { last }));
    await ACCOUNTS.batch(rows.map((r) => r.statement));
    out.push(...rows.map((r) => r.id));
  }
  return out;
}

const one = async <T>(sql: string, ...binds: unknown[]) => ACCOUNTS.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string, ...binds: unknown[]) => (await one<{ n: number }>(sql, ...binds))?.n ?? 0;
const rowsOf = async (id: string) =>
  (await ACCOUNTS.prepare("SELECT status, items, sent_at FROM deliveries WHERE saved_search_id = ? ORDER BY id").bind(id)
    .all<{ status: string; items: number; sent_at: string }>()).results ?? [];
const searchOf = (id: string) =>
  one<{ deliver: string; last_delivered_at: string | null }>("SELECT deliver, last_delivered_at FROM saved_searches WHERE id = ?", id);
const secretOf = async (id: string) => (await one<{ secret: string }>("SELECT secret FROM delivery_tokens WHERE search_id = ?", id))?.secret ?? null;
const markOf = async (id: string) => one<{ as_of: string }>("SELECT as_of FROM delivery_marks WHERE search_id = ?", id);

type RunRow = { at: string; data_date: string | null; outcome: string; sent: number; failed: number; left_due: number; detail: string | null };
const runRows = async (day: string) =>
  (await ACCOUNTS.prepare("SELECT at, data_date, outcome, sent, failed, left_due, detail FROM delivery_runs WHERE substr(at, 1, 10) = ? ORDER BY id")
    .bind(day).all<RunRow>()).results ?? [];
const runRow = (at: string, o: Partial<RunRow> & { outcome: string }) =>
  ACCOUNTS.prepare("INSERT INTO delivery_runs (at, data_date, outcome, sent, failed, left_due, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(at, o.data_date ?? null, o.outcome, o.sent ?? 0, o.failed ?? 0, o.left_due ?? 0, o.detail ?? null);

// -- the records database (an organization, a buyer and a segment, each with counts that rose) --------------

const ORG = "org-f000000001";
const DND = 102;
const TABLES = ["rec_events", "rec_meta", "records", "rec_orgs", "rec_buyers", "rec_buyer_quarters", "rec_segment_years", "rec_due", "rec_expiring",
  "rec_details", "rec_instruments"];

// Five records naming the organization at National Defence in the data date's fiscal year: three published
// contracts and two award notices in segment 43. Read at `day`. Others: more organizations with the same
// five records each (the budget test's eight).
async function seedRecords(day: string, others: readonly string[] = []): Promise<void> {
  const fy = fiscalYearOf(day);
  const oid = orgNumber(ORG);
  await RECORDS.batch(TABLES.map((x) => RECORDS.prepare(`DELETE FROM ${x}`)));
  const insert = "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote) VALUES (?, ?, 2, ?, ?, 43, 0, 1000000, 0)";
  const otherInsert = "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote) VALUES (?, ?, 2, NULL, ?, NULL, 0, 1000000, 0)";
  await RECORDS.batch([
    ...[3, 3, 3, 1, 1].map((src) => RECORDS.prepare(insert).bind(src, fy, DND, oid)),
    ...others.flatMap((o) => [3, 3, 3, 1, 1].map((src) => RECORDS.prepare(otherInsert).bind(src, fy, orgNumber(o)))),
    ...others.map((o) => RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, ?)").bind(orgNumber(o), `Sample Works ${o.slice(-1)}`)),
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, 'Exemplar Works Ltd.')").bind(oid),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dnd-mdn', 'National Defence', 'Défense nationale')").bind(DND),
    RECORDS.prepare("INSERT INTO rec_buyer_quarters (bid, src, fy, fq, n, cents, n_no_value) SELECT bid, src, fy, fq, COUNT(*), SUM(cents), 0 " +
      "FROM records WHERE extra = 0 AND bid IS NOT NULL AND fy IS NOT NULL GROUP BY bid, src, fy, fq"),
    RECORDS.prepare("INSERT INTO rec_segment_years (sid, src, fy, n, cents, n_no_value, n_buyers, n_orgs, n_pos, pos, med) SELECT sid, src, fy, COUNT(*), " +
      "SUM(cents), 0, COUNT(DISTINCT bid), COUNT(DISTINCT oid), COUNT(*), SUM(cents), NULL FROM records WHERE sid IS NOT NULL GROUP BY sid, src, fy"),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(day),
  ]);
}

// The mark a previous delivery left the day before, with nothing counted: every count read now rose.
async function emptyMark(searchId: string, day: string): Promise<void> {
  const fy = fiscalYearOf(day);
  const m: Mark = { asOf: addDays(day, -1), rules: "2", from: fy - 9, to: fy, counts: {} };
  await ACCOUNTS.prepare("INSERT INTO delivery_marks (search_id, as_of, counts, updated_at) VALUES (?, ?, ?, ?)")
    .bind(searchId, m.asOf, markText(m), `${m.asOf}T16:00:00.000Z`).run();
}

// -- the mail and the run -----------------------------------------------------------------------------------

type Handed = { to: string; subject: string; text?: string; html?: string; headers?: Record<string, string> };

// A stand-in for the MAIL binding; refuse names the error code for a message, or nothing to take it.
function fakeMail(refuse: (m: Handed) => string | undefined = () => undefined) {
  const handed: Handed[] = [];
  const tried: Handed[] = [];
  const binding = {
    async send(m: Handed) {
      tried.push(m);
      const code = refuse(m);
      if (code) throw Object.assign(new Error("refused"), { code });
      handed.push(m);
      return { messageId: "<g@awardwatch.ca>" };
    },
  } as unknown as SendEmail;
  return { handed, tried, binding, to: (email: string) => handed.filter((m) => m.to === email) };
}

function tender(reference: string, day: string, over: Partial<TenderRow> = {}): TenderRow {
  return {
    reference, amendment: 0, title_en: `Notice ${reference}`, title_fr: `Avis ${reference}`, buyer_id: "dfo-mpo",
    buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada", published: day, closing: `${addDays(day, 30)}T14:00:00`,
    category: ["SRV"], notice_type_en: "Request for Proposal", notice_type_fr: "Demande de propositions", method_en: null, method_fr: null,
    segments: ["72"], provinces: ["BC"], first_seen: day, status: "open", ...over,
  };
}

// The published files of the week to the data date: the day's new notices (one in segment 72, British Columbia,
// services; one in segment 43, Ontario, goods), the others empty; and the radar's 3-month window with two
// contracts at National Defence in segment 46 that entered it on the data date.
function files(day: string): Record<string, unknown> {
  const out: Record<string, unknown> = { "stats.json": { ...stats, data_as_of: day } };
  const notices = [tender(`cb-772-${day.replace(/-/g, "")}`, day), tender(`cb-743-${day.replace(/-/g, "")}`, day, {
    segments: ["43"], provinces: ["ON"], category: ["GD"], buyer_id: "dnd-mdn", buyer_en: "National Defence", buyer_fr: "Défense nationale",
  })];
  for (let i = 0; i <= 8; i++) out[`tenders/new/${addDays(day, -i)}.json`] = i === 0 ? notices : [];
  const end = addDays(day, 91);
  const radar = [contract("award", "cb-500-60000001", end), contract("history", "W8486-600002", end, { organization: "JHT Defense Inc." })];
  out["expiring/3m/index.json"] = { window: "3m", pages: 1, rows: radar.length, total: 1000 };
  out["expiring/3m/1.json"] = radar;
  return out;
}

type RunOpts = {
  mail?: SendEmail; day: string; hour: number; users: string[]; files?: Record<string, unknown>;
  before?: (sqls: string[]) => void | Promise<void>; extra?: Record<string, unknown>; ultra?: boolean; log?: string[][];
};

async function run(o: RunOpts): Promise<RunReport> {
  const before = async (sqls: string[]) => {
    o.log?.push(sqls);
    await o.before?.(sqls);
  };
  const vars = {
    ACCOUNTS: hooked(ACCOUNTS, { rewrite: scope(o.users), before }), RECORDS: hooked(RECORDS, { before }),
    ASSETS: makeFakeAssets({}, o.files ?? files(o.day)), MAIL: o.mail, MAIL_FROM: FROM, MAIL_SENDER: undefined,
    NOW: `${o.day}T${String(o.hour).padStart(2, "0")}:00:00Z`, ...o.extra,
  };
  return runDeliveries((o.ultra ? ultraEnv(vars) : onEnv(vars)) as never);
}

const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const headings = (html: string) => [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((m) => decode(m[1]));
const groupLinkOf = (m: Handed) => /<(https:\/\/[^>]*\/account\/stop\?g=[^>]*)>/.exec(m.headers?.["List-Unsubscribe"] ?? "")?.[1] ?? null;
const stopPost = (url: string, body = "List-Unsubscribe=One-Click") => app.request(new URL(url).pathname + new URL(url).search, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp() }, body,
}, onEnv());

// =========================================================================================
// 1. The grouped message
// =========================================================================================

describe("an account's saved searches with news in one run", () => {
  it("go one message each up to five, as today, and in one message past five, each search keeping its own row", async () => {
    const day = "2031-01-06";
    const five = await user("pro");
    const six = await user("pro");
    await tenderSearches(five.id, 5, lastDay(day));
    const ids = await tenderSearches(six.id, 6, lastDay(day));
    const mail = fakeMail();
    const report = await run({ mail: mail.binding, day, hour: 15, users: [five.id, six.id] });
    expect(mail.to(five.email)).toHaveLength(5);
    expect(mail.to(six.email)).toHaveLength(1);
    expect(report).toMatchObject({ outcome: "done", sent: 6, failed: 0 });
    expect((report as unknown as { groups: number; grouped: number })).toMatchObject({ groups: 1, grouped: 6 });
    // Each search of the group: its own sent row with its own count, and its coverage moved to the run's time.
    for (const id of ids) {
      expect((await rowsOf(id)).map((r) => [r.status, r.items, r.sent_at])).toEqual([["sent", 1, at(day, 15)]]);
      expect((await searchOf(id))?.last_delivered_at).toBe(at(day, 15));
    }
    // One message for the run log too.
    expect((await runRows(day)).map((r) => [r.outcome, r.sent])).toEqual([["done", 6]]);
    expect(D.GROUP_OVER).toBe(5);
  });

  it("are laid out a section a search in the account's order, every kind together, under a subject that counts them", async () => {
    const day = "2031-01-13";
    await seedRecords(day);
    const q = await user("pro");
    const params = [
      "/tenders?segment=72", "/expiring/3m?buyer=dnd-mdn", `/organizations/${ORG}`, "/tenders?province=BC", "/buyers/dnd-mdn",
      "/expiring/3m?segment=46", "/segments/43", "/tenders?category=SRV",
    ];
    const ids: string[] = [];
    for (const p of params) ids.push(await search(q.id, p, { last: lastDay(day) }));
    for (const id of [ids[2], ids[4], ids[6]]) await emptyMark(id, day);
    const mail = fakeMail();
    const report = await run({ mail: mail.binding, day, hour: 15, users: [q.id] });
    expect(mail.to(q.email)).toHaveLength(1);
    expect(report).toMatchObject({ outcome: "done", sent: 1 });
    const m = mail.to(q.email)[0];
    // A section a search, in the order they were saved, each headed by its label.
    expect(headings(m.html!)).toEqual(params.map((p) => `Saved ${p}`));
    // Each section carries its own stop link, and the message's headers carry the one for all of them.
    for (const id of ids) expect(decode(m.html!)).toContain(`${SITE}/account/stop?s=${id}&t=${await secretOf(id)}`);
    const group = groupLinkOf(m);
    expect(group).toMatch(new RegExp(`^${SITE}/account/stop\\?g=${q.id}&t=[A-Za-z0-9_-]{${8 * ids.length}}$`));
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.text).toContain(group!);
    // The subject counts the searches with news and names the data date.
    expect(m.subject).toBe(t("en", "digest.group_subject", { n: 8, date: day }));
    // Each search's row, and the records searches' marks moved to the data date.
    const items = [1, 2, 5, 1, 5, 2, 3, 1];
    for (const [k, id] of ids.entries()) expect((await rowsOf(id)).map((r) => [r.status, r.items]), params[k]).toEqual([["sent", items[k]]]);
    for (const id of [ids[2], ids[4], ids[6]]) expect((await markOf(id))?.as_of).toBe(day);
  });

  it("are in the account's mail language, each section's label and links in it too", async () => {
    const day = "2031-01-20";
    await seedRecords(day);
    const q = await user("pro", { lang: "fr" });
    const params = ["/tenders?segment=72", "/tenders?province=BC", "/tenders?category=SRV", "/expiring/3m?buyer=dnd-mdn", `/organizations/${ORG}`, "/segments/43"];
    // The labels each page wrote in English; an organization's from the name the records database holds.
    const site = { ...testEnv(), ASSETS: makeFakeAssets({}, files(day)) } as never;
    const known = (p: string) => (kindOf(p) === "organization" ? { name: "Exemplar Works Ltd." } : {});
    const labelIn = async (lang: Lang, p: string) => (await interestFilter(site, lang, kindOf(p), p, known(p)))?.label ?? `Saved ${p}`;
    const ids: string[] = [];
    for (const p of params) ids.push(await search(q.id, p, { last: lastDay(day), lang: "en", label: await labelIn("en", p) }));
    for (const id of [ids[4], ids[5]]) await emptyMark(id, day);
    const mail = fakeMail();
    await run({ mail: mail.binding, day, hour: 15, users: [q.id] });
    expect(mail.to(q.email)).toHaveLength(1);
    const m = mail.to(q.email)[0];
    expect(m.html).toMatch(/<html lang="fr"/);
    const french = [];
    for (const p of params) french.push(await labelIn("fr", p));
    expect(french.some((l, k) => l !== `Saved ${params[k]}`)).toBe(true);
    expect(headings(m.html!).map(nbsp)).toEqual(french.map(nbsp));
    for (const id of ids) expect(decode(m.html!)).toContain(`${SITE}/account/stop?s=${id}&t=${await secretOf(id)}&lang=fr`);
    expect(groupLinkOf(m)).toMatch(/&lang=fr$/);
  });

  it("leave out a search stopped between the run's read and its claim, and the rest still go as one message", async () => {
    const day = "2031-01-27";
    const q = await user("pro");
    const ids = await tenderSearches(q.id, 7, lastDay(day));
    let stopped = false;
    const before = async (sqls: string[]) => {
      if (!stopped && sqls.some((s) => s.includes(CLAIM_PART))) {
        stopped = true;
        await ACCOUNTS.prepare("UPDATE saved_searches SET deliver = 'off' WHERE id = ?").bind(ids[3]).run();
      }
    };
    const mail = fakeMail();
    await run({ mail: mail.binding, day, hour: 15, users: [q.id], before });
    expect(mail.to(q.email)).toHaveLength(1);
    expect(headings(mail.to(q.email)[0].html!)).toHaveLength(6);
    expect(await rowsOf(ids[3])).toEqual([]);
    expect(await searchOf(ids[3])).toEqual({ deliver: "off", last_delivered_at: lastDay(day) });
    for (const id of ids.filter((_, k) => k !== 3)) expect((await rowsOf(id)).map((r) => r.status)).toEqual(["sent"]);
  });

  it("give every claim back together when the send does not go: a refusal writes each search's failed row, a sending limit none", async () => {
    const day = "2031-02-03";
    await seedRecords(day);
    const q = await user("pro");
    const ids = [...await tenderSearches(q.id, 5, lastDay(day)), await search(q.id, `/organizations/${ORG}`, { last: lastDay(day) })];
    await emptyMark(ids[5], day);
    const refused = fakeMail((m) => (m.to === q.email ? "E_RECIPIENT_NOT_ALLOWED" : undefined));
    const report = await run({ mail: refused.binding, day, hour: 15, users: [q.id] });
    expect(refused.tried).toHaveLength(1);
    expect(report).toMatchObject({ outcome: "done", sent: 0, failed: 1 });
    for (const id of ids) {
      expect((await rowsOf(id)).map((r) => r.status)).toEqual(["failed"]);
      expect((await searchOf(id))?.last_delivered_at).toBe(lastDay(day));
    }
    // A failed row keeps the old mark, so the next delivery reports the same rise.
    expect((await markOf(ids[5]))?.as_of).toBe(addDays(day, -1));

    const day2 = "2031-02-10";
    await seedRecords(day2);
    const r = await user("pro");
    const rids = await tenderSearches(r.id, 6, lastDay(day2));
    const limited = fakeMail(() => "E_DAILY_LIMIT_EXCEEDED");
    const stop = await run({ mail: limited.binding, day: day2, hour: 15, users: [r.id] });
    expect(limited.tried).toHaveLength(1);
    expect(stop).toMatchObject({ outcome: "limited", sent: 0, failed: 0, left: 6 });
    for (const id of rids) {
      expect(await rowsOf(id)).toEqual([]);
      expect((await searchOf(id))?.last_delivered_at).toBe(lastDay(day2));
    }
  });

  it("count as one message against the day's ceiling and in the run log", async () => {
    const day = "2031-02-17";
    const q = await user("pro");
    const r = await user("pro");
    const s = await user("pro");
    await tenderSearches(q.id, 6, lastDay(day));
    await tenderSearches(r.id, 1, lastDay(day));
    const left = await tenderSearches(s.id, 1, lastDay(day));
    const mail = fakeMail();
    const report = await run({ mail: mail.binding, day, hour: 15, users: [q.id, r.id, s.id], extra: { MAIL_DAILY_QUOTA: "3", MAIL_DAILY_RESERVE: "1" } });
    expect(mail.to(q.email)).toHaveLength(1);
    expect(mail.to(r.email)).toHaveLength(1);
    expect(mail.to(s.email)).toHaveLength(0);
    expect(report).toMatchObject({ outcome: "limited", sent: 2, left: 1 });
    expect((await runRows(day)).map((x) => [x.outcome, x.sent])).toEqual([["limited", 2]]);
    expect(await rowsOf(left[0])).toEqual([]);
  });

  it("are counted on the console's overview a row a search, beside the run log's messages", async () => {
    const day = "2031-07-07";
    const q = await user("pro");
    const r = await user("pro");
    await tenderSearches(q.id, 6, lastDay(day));
    await tenderSearches(r.id, 1, lastDay(day));
    const report = await run({ mail: fakeMail().binding, day, hour: 15, users: [q.id, r.id] });
    expect(report).toMatchObject({ sent: 2, groups: 1, grouped: 6 });
    const o = await overview({ ...onEnv(), ACCOUNTS } as never, new Date(`${day}T22:00:00Z`));
    expect(o.sent).toBe(7);
    expect((o as unknown as { messages: number | null }).messages).toBe(2);
  });

  it("cost the same few queries from the claims to the last write, whatever the group's size", async () => {
    const measure = async (day: string, plan: "pro" | "ultra", n: number) => {
      const q = await user(plan);
      await tenderSearches(q.id, n, lastDay(day));
      const log: string[][] = [];
      const mail = fakeMail();
      await run({ mail: mail.binding, day, hour: 15, users: [q.id], log, ultra: plan === "ultra" });
      expect(mail.to(q.email)).toHaveLength(1);
      const first = log.findIndex((sqls) => sqls.some((s) => s.includes(CLAIM_PART)));
      const next = log.findIndex((sqls) => sqls.some((s) => s.includes("FROM watch_mail m JOIN users u")));
      expect(first).toBeGreaterThan(0);
      return next - first;
    };
    const six = await measure("2031-02-24", "pro", 6);
    const forty = await measure("2031-03-03", "ultra", 40);
    expect(six).toBe(forty);
    expect(six).toBeLessThanOrEqual(D.GROUP_QUERIES);
    // Inside what every claim holds back for its writes, so the claimable check covers a whole group.
    expect(D.GROUP_QUERIES).toBeLessThanOrEqual(D.CLAIM_QUERIES);
  });

  it("wait whole for the next run when the query budget runs out while they are read, then go as one message", async () => {
    const day = "2031-03-10";
    const orgs = Array.from({ length: 8 }, (_, i) => `org-f00000001${i}`);
    await seedRecords(day, orgs);
    // Accounts that moved down to Free with their cached plan still saying Pro, each read first (two queries:
    // its plan, and its cached plan put right), then the account whose eight organization searches, each with
    // records new since its last delivery, are read as the budget runs out (two queries each: the counts and
    // the mark).
    const stale: User[] = [];
    for (let b = 0; b < 422; b += 100) {
      const rows = Array.from({ length: Math.min(100, 422 - b) }, () => userRows("free", { cached: "pro" }));
      await ACCOUNTS.batch(rows.flatMap((r) => r.statements));
      await ACCOUNTS.batch(rows.map((r) => searchRow(r.user.id, "/tenders?segment=72", { last: lastDay(day) }).statement));
      stale.push(...rows.map((r) => r.user));
    }
    const q = await user("pro");
    const ids: string[] = [];
    for (const o of orgs) {
      const id = await search(q.id, `/organizations/${o}`, { last: lastDay(day) });
      await emptyMark(id, day);
      ids.push(id);
    }
    const users = [...stale.map((u) => u.id), q.id];
    const log: string[][] = [];
    const mail = fakeMail();
    const first = await run({ mail: mail.binding, day, hour: 15, users, log });
    // The budget ran out while the account's searches were read: some of them, not all.
    const reads = log.filter((sqls) => sqls.some((s) => s.includes("FROM records WHERE oid = ?1"))).length;
    expect(first.outcome).toBe("capped");
    expect(reads, "the account's searches read before the stop").toBeGreaterThan(0);
    expect(reads).toBeLessThan(ids.length);
    // Nothing of it sent or claimed.
    expect(mail.to(q.email)).toHaveLength(0);
    for (const id of ids) {
      expect(await rowsOf(id)).toEqual([]);
      expect((await searchOf(id))?.last_delivered_at).toBe(lastDay(day));
    }
    const second = await run({ mail: mail.binding, day, hour: 16, users });
    expect(second.outcome).toBe("done");
    expect(mail.to(q.email)).toHaveLength(1);
    expect(headings(mail.to(q.email)[0].html!)).toHaveLength(8);
    for (const id of ids) expect((await rowsOf(id)).map((r) => r.status)).toEqual(["sent"]);
  });

  it("may come in two messages when a run leaves some waiting, and no search is sent twice", async () => {
    const day = "2031-03-17";
    await seedRecords(day);
    const q = await user("pro");
    const ids = await tenderSearches(q.id, 7, lastDay(day));
    const org = await search(q.id, `/organizations/${ORG}`, { last: lastDay(day) });
    await emptyMark(org, day);
    const mail = fakeMail();
    // The records database is not bound in the first run: the organization search waits.
    const first = await run({ mail: mail.binding, day, hour: 15, users: [q.id], extra: { RECORDS: undefined } });
    expect(first).toMatchObject({ sent: 1, waiting: 1 });
    expect(headings(mail.to(q.email)[0].html!)).toHaveLength(7);
    const second = await run({ mail: mail.binding, day, hour: 16, users: [q.id] });
    expect(second).toMatchObject({ sent: 1 });
    expect(mail.to(q.email)).toHaveLength(2);
    for (const id of [...ids, org]) expect((await rowsOf(id)).map((r) => r.status)).toEqual(["sent"]);
  });
});

describe("the grouped message's stop links", () => {
  // An account with eight searches with news and a ninth whose email is on and that had nothing new.
  async function grouped(day: string) {
    const q = await user("pro");
    const ids = await tenderSearches(q.id, 8, lastDay(day));
    const quietSearch = await search(q.id, "/tenders?segment=43&province=BC", { last: lastDay(day) });
    const mail = fakeMail();
    await run({ mail: mail.binding, day, hour: 15, users: [q.id] });
    expect(mail.to(q.email)).toHaveLength(1);
    const m = mail.to(q.email)[0];
    return { q, ids, quietSearch, m, link: groupLinkOf(m)! };
  }

  it("show the searches on GET and change nothing; the one-click POST turns off every search in the message and no other", async () => {
    const { q, ids, quietSearch, link } = await grouped("2031-04-07");
    const page = await get(new URL(link).pathname + new URL(link).search);
    expect(page.status).toBe(200);
    const body = decode(await page.text());
    for (const k of [0, 7]) expect(body).toContain(`Saved /tenders?segment=72&x=${k}`);
    expect(body).not.toContain("Saved /tenders?segment=43&province=BC");
    for (const id of ids) expect((await searchOf(id))?.deliver).toBe("daily");
    const res = await stopPost(link);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(t("en", "account.stopped_group_one_click"));
    for (const id of ids) expect((await searchOf(id))?.deliver).toBe("off");
    expect((await searchOf(quietSearch))?.deliver).toBe("daily");
    // Still saved, turned back on from the account.
    expect(await count("SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?", q.id)).toBe(9);
    expect(await count("SELECT COUNT(*) AS n FROM audit WHERE user_id = ? AND event = 'delivery_stopped' AND detail = 'group_one_click'", q.id)).toBe(1);
  });

  it("leave each section's own link stopping its search alone", async () => {
    const { ids } = await grouped("2031-04-14");
    const own = `${SITE}/account/stop?s=${ids[2]}&t=${await secretOf(ids[2])}`;
    expect((await stopPost(own)).status).toBe(200);
    for (const [k, id] of ids.entries()) expect((await searchOf(id))?.deliver).toBe(k === 2 ? "off" : "daily");
  });

  it("let a forwarded link stop only the searches it proves, and nothing of another account", async () => {
    const { ids, link } = await grouped("2031-04-21");
    const other = await grouped("2031-04-28");
    const u = new URL(link);
    const tags = u.searchParams.get("t")!;
    // The first three tags alone: those three.
    const three = `${SITE}/account/stop?g=${u.searchParams.get("g")}&t=${tags.slice(0, 24)}`;
    expect((await stopPost(three)).status).toBe(200);
    for (const [k, id] of ids.entries()) expect((await searchOf(id))?.deliver, `search ${k}`).toBe(k < 3 ? "off" : "daily");
    // A made-up tag beside a real one: the real one's search alone.
    const added = `${SITE}/account/stop?g=${u.searchParams.get("g")}&t=${tags.slice(24, 32)}AAAAAAAA`;
    expect((await stopPost(added)).status).toBe(200);
    for (const [k, id] of ids.entries()) expect((await searchOf(id))?.deliver, `search ${k}`).toBe(k < 4 ? "off" : "daily");
    // This account's tags under the other account's id, made-up tags, and malformed links: the site's 404, nothing stopped.
    const otherId = other.q.id;
    for (const bad of [
      `${SITE}/account/stop?g=${otherId}&t=${tags}`, `${SITE}/account/stop?g=${u.searchParams.get("g")}&t=AAAAAAAABBBBBBBB`,
      `${SITE}/account/stop?g=${u.searchParams.get("g")}&t=${tags.slice(0, 7)}`, `${SITE}/account/stop?g=nothex&t=${tags}`,
      `${SITE}/account/stop?g=${u.searchParams.get("g")}&t=${"AAAAAAAA".repeat(101)}`, `${SITE}/account/stop?g=${u.searchParams.get("g")}&t=${tags.slice(0, 8)}*******+`,
    ]) {
      expect((await stopPost(bad)).status, bad).toBe(404);
      expect((await get(new URL(bad).pathname + new URL(bad).search)).status, bad).toBe(404);
    }
    for (const id of other.ids) expect((await searchOf(id))?.deliver).toBe("daily");
    for (const [k, id] of ids.entries()) expect((await searchOf(id))?.deliver, `search ${k}`).toBe(k < 4 ? "off" : "daily");
  });

  it("fit Email Sending's header value with 100 searches, and a line of the header", async () => {
    const members = Array.from({ length: 100 }, (_, i) => ({ id: nextId(), secret: (i + 1).toString(16).padStart(32, "a") }));
    const path = await D.groupStopPath(nextId(), members);
    for (const lang of ["en", "fr"] as const) {
      const url = `${SITE}${path}${lang === "fr" ? "&lang=fr" : ""}`;
      const value = `<mailto:contact@awardwatch.ca>, <${url}>`;
      expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(HEADER_VALUE_MAX);
      expect(`List-Unsubscribe: ${value}`.length).toBeLessThanOrEqual(LINE_MAX);
    }
    // Each tag is its search's alone: a different secret gives a different tag.
    expect(await D.groupTag(members[0].id, members[0].secret)).not.toBe(await D.groupTag(members[0].id, members[1].secret));
  });
});

// =========================================================================================
// 2. A downgraded account's saved searches leave the run's list
// =========================================================================================

describe("a saved search whose account's plan no longer sends it", () => {
  it("leaves the run's list once read, marked for the data date with no row, a search past the plan's figure too", async () => {
    const day = "2031-05-05";
    const down = await user("free", { cached: "pro" });
    const downSearch = await search(down.id, "/tenders?segment=72", { last: lastDay(day) });
    // A Pro account holding one search past Pro's figure (after a move down from Ultra), nothing new in any of them.
    const pro = await user("pro");
    const held: string[] = [];
    for (let i = 0; i <= RULES.pro.saved_searches; i++) held.push(await search(pro.id, `/tenders?segment=43&province=BC&x=${i}`, { last: lastDay(day) }));
    const past = held[held.length - 1];
    const mail = fakeMail();
    const first = await run({ mail: mail.binding, day, hour: 15, users: [down.id, pro.id] });
    expect(first.skipped).toBe(2);
    expect(mail.handed).toHaveLength(0);
    for (const id of [downSearch, past]) {
      expect((await searchOf(id))?.last_delivered_at, id).toBe(at(day, 15));
      expect(await rowsOf(id)).toEqual([]);
    }
    // The next run of the day does not read them again.
    const second = await run({ mail: mail.binding, day, hour: 16, users: [down.id, pro.id] });
    expect(second.skipped).toBe(0);
  });
});

// =========================================================================================
// 3. The console's bulk mail and the day's ceiling
// =========================================================================================

let clock = 0;
async function waiting(n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const email = newEmail("rg-list");
    const at = new Date(Date.UTC(2026, 9, 1) + ++clock * 1000).toISOString();
    await DB.prepare(INSERT_INTEREST).bind(email, "tenders", "/tenders", "Every new tender notice", "en", at, newToken()).run();
    out.push(email);
  }
  return out;
}

const sentTo = async (email: string) => (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sent_mail WHERE to_addr = ?").bind(email).first<{ n: number }>())?.n ?? 0;

describe("a bulk run from the console", () => {
  it("reads the day's room, stops at the ceiling with a line that says so, and counts for the rest of the day", async () => {
    const day = "2031-06-02";
    const now = new Date(`${day}T10:00:00Z`);
    await ACCOUNTS.batch([runRow(`${day}T09:00:00.000Z`, { outcome: "done", data_date: day, sent: 2 })]);
    const emails = await waiting(4);
    const ceiling = { MAIL_DAILY_QUOTA: "5", MAIL_DAILY_RESERVE: "1" };
    const report = await announce.runAnnouncement(onEnv(ceiling) as never, "http://localhost", "http://localhost/admin/announce", now, 300, "accounts");
    expect(report.sent).toBe(2);
    expect((report as unknown as { ceiling: boolean }).ceiling).toBe(true);
    expect((await Promise.all(emails.map(sentTo))).reduce((a, b) => a + b, 0)).toBe(2);
    // Its own row in the run log, of its own outcome, naming no address.
    const rows = await runRows(day);
    expect(rows.map((r) => [r.outcome, r.sent, r.data_date])).toEqual([["done", 2, day], ["console", 2, null]]);
    expect(rows[1].detail).not.toContain("@");
    // The delivery job that day finds the ceiling reached.
    const p = await user("pro");
    await tenderSearches(p.id, 1, lastDay(day));
    const job = await run({ mail: fakeMail().binding, day, hour: 15, users: [p.id], extra: ceiling });
    expect(job).toMatchObject({ outcome: "limited", sent: 0 });
    // A run with no room sends nothing.
    const again = await announce.runAnnouncement(onEnv(ceiling) as never, "http://localhost", "http://localhost/admin/announce", now, 300, "accounts");
    expect(again.sent).toBe(0);
    expect((again as unknown as { ceiling: boolean }).ceiling).toBe(true);
  });

  it("shows the console the day's room, and says when a run stopped at the ceiling", async () => {
    const email = newEmail("rg-op");
    const opEnv = onEnv({ OPERATOR_EMAILS: email, MAIL_DAILY_QUOTA: "3", MAIL_DAILY_RESERVE: "1" });
    const cookie = await signIn(email, { env: opEnv });
    const token = await csrf(cookie, "/account", { env: opEnv });
    const today = new Date().toISOString().slice(0, 10);
    await ACCOUNTS.batch([runRow(`${today}T00:00:00.000Z`, { outcome: "done", data_date: today, sent: 1 })]);
    await waiting(2);
    const page = nbsp(decode(await (await get("/admin/announce", { cookie, env: opEnv })).text()));
    expect(page).toContain("Messages the day's sending ceiling, shared with the delivery job, still allows today (UTC): 1. A run stops there.");
    const res = await post("/admin/announce", { csrf: token, confirm: "yes" }, { cookie, env: opEnv });
    expect(res.status).toBe(303);
    const back = res.headers.get("location")!;
    expect(back).toContain("ceiling=1");
    const done = nbsp(decode(await (await get(back, { cookie, env: opEnv })).text()));
    expect(done).toContain("The run stopped at the day's sending ceiling of 2 messages (MAIL_DAILY_QUOTA 3 less MAIL_DAILY_RESERVE 1, the rest kept " +
      "for sign-in codes), shared with the delivery job; the addresses left wait for the next UTC day.");
    expect((await runRows(today)).map((r) => [r.outcome, r.sent])).toEqual([["done", 1], ["console", 1]]);
  });

  it("is read by the daily check as the day's sends and nothing more", async () => {
    const checkEnv = { ...testEnv(), ACCOUNTS_ENABLED: "true", ACCOUNTS, SEARCH: undefined, DATA: undefined, MAIL_DAILY_QUOTA: "200", MAIL_DAILY_RESERVE: "40" };
    const lines = async (day: string) =>
      collectAlerts(await gatherInputs(checkEnv as never, new Date(`${addDays(day, 1)}T06:00:00Z`))).filter((a) => /delivery (run|job)/.test(a));
    // A day with no run of the job, only the console's: no run was recorded.
    const day1 = "2031-06-09";
    await ACCOUNTS.batch([runRow(`${day1}T10:00:00.000Z`, { outcome: "console", sent: 30, detail: "the accounts-open message from the console" })]);
    expect(await lines(day1)).toEqual([
      `No delivery run was recorded on ${day1} (UTC): the hourly job (cron 0 15-20 * * *) did not run, or none of its runs could write the run log ` +
      "(delivery_runs). Check the Worker's cron triggers and its logs.",
    ]);
    // The job's last run left items due; a console run after it does not hide that.
    const day2 = "2031-06-10";
    await ACCOUNTS.batch([
      runRow(`${day2}T20:00:00.000Z`, { outcome: "capped", data_date: day2, sent: 60, left_due: 12, detail: "the budget of 850 database queries" }),
      runRow(`${day2}T21:00:00.000Z`, { outcome: "console", sent: 10, detail: "the Ultra message from the console" }),
    ]);
    expect(await lines(day2)).toEqual([
      `The last delivery run on ${day2} (20:00 UTC) ended capped with 12 items still due: the budget of 850 database queries. The next day's runs take them up.`,
    ]);
    // The day's ceiling counts the console's sends with the job's.
    const day3 = "2031-06-11";
    const text = "the day's sending ceiling of 160 messages (MAIL_DAILY_QUOTA 200 less MAIL_DAILY_RESERVE 40)";
    await ACCOUNTS.batch([
      runRow(`${day3}T10:00:00.000Z`, { outcome: "console", sent: 100, detail: "the accounts-open message from the console" }),
      runRow(`${day3}T15:00:00.000Z`, { outcome: "limited", data_date: day3, sent: 60, left_due: 5, detail: text }),
    ]);
    expect(await lines(day3)).toEqual([
      `The delivery job reached the day's sending ceiling on ${day3}: 160 messages sent of the 160 it allows (MAIL_DAILY_QUOTA 200 less ` +
      "MAIL_DAILY_RESERVE 40, kept for sign-in codes; 100 of them from the console), and 5 items waited for the next day. Ask Cloudflare for a higher " +
      "Email Sending daily limit (its Limit Increase Request Form), then raise MAIL_DAILY_QUOTA in wrangler.jsonc.",
    ]);
  });
});

// =========================================================================================
// 4. The privacy page
// =========================================================================================

describe("the privacy page", () => {
  it.each(["en", "fr"] as const)("says a saved search's delivery history is kept for 90 days (%s)", async (lang) => {
    const res = await get(`/privacy${lang === "fr" ? "?lang=fr" : ""}`);
    expect(res.status).toBe(200);
    const body = nbsp(decode(await res.text()));
    expect(D.DELIVERY_ROW_DAYS).toBe(90);
    const words = lang === "fr" ? "pendant 90 jours, chaque envoi de leur courriel" : "for 90 days, each delivery of their email";
    expect(body).toContain(words);
    expect(body).toContain(nbsp(t(lang, "account.privacy_kept", { days: 90 })));
  });
});

// =========================================================================================
// 5. The shared figure, named as the plan rows name it
// =========================================================================================

describe("the lines naming the figure saved searches and briefings share", () => {
  it.each(["en", "fr"] as const)("on the sign-in page, with Pro's own figures (%s)", async (lang) => {
    const body = nbsp(decode(await (await get(`/account/sign-in${lang === "fr" ? "?lang=fr" : ""}`)).text()));
    const n = RULES.pro.saved_searches;
    expect(body).toContain(lang === "fr" ? `Pro : ${n} recherches et bulletins, par courriel` : `Pro: ${n} saved searches and briefings, by email`);
  });

  it.each(["en", "fr"] as const)("on the radar's Pro line and the weekly email's plan line, each plan its own figure (%s)", (lang) => {
    const pro = RULES.pro.saved_searches;
    expect(nbsp(t(lang, "expiring.pro_searches", { cap: pro })).replace(/’/g, "'")).toBe(
      lang === "fr" ? `jusqu'à ${pro} recherches et bulletins, par courriel` : `up to ${pro} saved searches and briefings, by email`,
    );
    const m = weeklyDigest({ ...weeklyInput(lang, { news: false }), to: "reader@example.com" });
    const free = RULES.free.saved_searches;
    const line = lang === "fr"
      ? `Gratuit : ${RULES.free.watchlists} suivis et ${free} recherches et bulletins, sur le site. Pro : ${RULES.pro.watchlists} suivis, chaque changement par courriel, et ${pro} recherches et bulletins, par courriel.`
      : `Free: ${RULES.free.watchlists} watches and ${free} saved searches and briefings, on the site. Pro: ${RULES.pro.watchlists} watches, each change by email, and ${pro} saved searches and briefings, by email.`;
    expect(nbsp(m.text).replace(/’/g, "'")).toContain(line);
  });
});
