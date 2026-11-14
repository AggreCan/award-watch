// Three changes to the scheduled mail, approved by the operator on 2026-11-14, each held here:
// 1. the delivery job's run log (delivery_runs), one row a run past the switch; the daily check's lines
//    on the previous UTC day's rows; the 90-day pruning of delivery_runs and deliveries; and the plans of
//    the two reads idx_deliveries_search serves;
// 2. a reserve of the day's Email Sending quota for sign-in codes (MAIL_DAILY_QUOTA, MAIL_DAILY_RESERVE);
// 3. paying accounts first in the lists of what is due, the cached plan an ordering hint only.
//
// Storage is this file's own (each test file gets its own), and every run here is narrowed to the test's
// own accounts (scope) and dated on a day of its own, so a day's run log holds only that test's runs.
import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import accountsSchema from "../accounts_schema.sql?raw";
import { addDays } from "../public/closing.js";
import { BRIEFINGS_DUE_SQL } from "../src/account/briefings";
import {
  CLAIM_QUERIES, D1_QUERIES_MAX, DAY_SENT_SQL, DELIVERIES_PRUNE_SQL, QueryCount, RUN_LOG_QUERIES, type RunReport, candidatesSql, runDeliveries,
} from "../src/account/deliveries";
import { DELIVERABLE_KINDS, LAST_DELIVERIES_SQL } from "../src/account/searches";
import { VIEWS_DUE_SQL } from "../src/account/view_mail";
import { WATCH_DUE_SQL } from "../src/account/watch_mail";
import { WEEKLY_DUE_SQL } from "../src/account/weekly";
import type { TenderRow } from "../src/data";
import { mailCeiling } from "../src/env";
import { app } from "../src/index";
import { orgNumber } from "../src/records_db";
import { DELIVERY_RUNS_SQL, collectAlerts, gatherInputs } from "../src/watchdog";
import wranglerConfig from "../wrangler.jsonc?raw";
import { ACCOUNTS, newEmail, nextIp, offEnv, onEnv, ultraEnv, useAccountsDb } from "./accounts-helpers";
import { makeFakeAssets, testEnv } from "./assets";
import stats from "./fixtures/stats.json";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const FROM = "alerts@awardwatch.ca";
const ORG_KINDS = "award,grant,amended,cancelled,ends_12m,ends_6m,ended,instrument_gained,instrument_lost,instrument_expires_6m";

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
const logged = (): string[] => (logs.mock.calls as unknown[][]).map((c) => c.map(String).join(" "));

// -- the databases, wrapped -------------------------------------------------------------------------

type Hook = { rewrite?: (sql: string) => string; before?: (sqls: string[]) => void };

class Stmt {
  constructor(readonly sql: string, readonly inner: D1PreparedStatement, readonly hook: Hook) {}
  bind(...values: unknown[]) {
    return new Stmt(this.sql, this.inner.bind(...values), this.hook);
  }
  async first(column?: string) {
    this.hook.before?.([this.sql]);
    return column === undefined ? this.inner.first() : this.inner.first(column);
  }
  async run() {
    this.hook.before?.([this.sql]);
    return this.inner.run();
  }
  async all() {
    this.hook.before?.([this.sql]);
    return this.inner.all();
  }
  async raw(o?: { columnNames?: boolean }) {
    this.hook.before?.([this.sql]);
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
      hook.before?.(stmts.map((s) => s.sql));
      return real.batch(stmts.map((s) => s.inner));
    },
    exec: (q: string) => real.exec(q),
  } as unknown as D1Database;
}

// Each part's list of what is due narrowed to these users; limits lowers a list's cap.
type Limits = { watch?: number; briefings?: number; views?: number };

function scope(users: string[], limits: Limits = {}): (sql: string) => string {
  const list = users.map((u) => `'${u.replace(/[^0-9a-f]/g, "")}'`).join(", ");
  const narrow = (sql: string, alias: string) => {
    const at = sql.lastIndexOf("ORDER BY");
    return `${sql.slice(0, at)}AND ${alias}.user_id IN (${list}) ${sql.slice(at)}`;
  };
  const capped = (sql: string, param: string, n: number | undefined) => (n ? sql.replace(`LIMIT ${param}`, `LIMIT min(${param}, ${n})`) : sql);
  return (sql) => {
    if (sql.includes("LEFT JOIN delivery_tokens k ON k.search_id = s.id")) return narrow(sql, "s");
    if (sql === WATCH_DUE_SQL) return capped(narrow(sql, "m"), "?2", limits.watch);
    if (sql === BRIEFINGS_DUE_SQL) return capped(narrow(sql, "b"), "?2", limits.briefings);
    if (sql === VIEWS_DUE_SQL) return capped(narrow(sql, "v"), "?3", limits.views);
    if (sql === WEEKLY_DUE_SQL) return narrow(sql, "m");
    return sql;
  };
}

// A fault on the first query whose text holds `part` (every time when always), as D1 would throw it.
function failOn(part: string, always = false): (sqls: string[]) => void {
  let done = false;
  return (sqls) => {
    if ((always || !done) && sqls.some((s) => s.includes(part))) {
      done = true;
      throw new Error("D1_ERROR: Network connection lost.");
    }
  };
}

// -- the accounts --------------------------------------------------------------------------------------

let seq = 0;
const nextId = () => (0xe0000000 + ++seq).toString(16).padStart(32, "0");
const createdAt = () => new Date(Date.UTC(2001, 0, 1) + ++seq * 1000).toISOString();

type User = { id: string; email: string };

// An account on a plan, its cached plan (users.plan) as given: pro for Pro and Ultra unless said otherwise.
function userRows(plan: "free" | "pro" | "ultra", cached?: "free" | "pro"): { user: User; statements: D1PreparedStatement[] } {
  const id = nextId();
  const email = newEmail(`ro-${plan}`);
  const statements = [
    ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active', ?)")
      .bind(id, email, cached ?? (plan === "free" ? "free" : "pro")),
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

async function user(plan: "free" | "pro" | "ultra", cached?: "free" | "pro"): Promise<User> {
  const { user: u, statements } = userRows(plan, cached);
  await ACCOUNTS.batch(statements);
  return u;
}

const lastDay = (day: string) => `${addDays(day, -1)}T16:00:00.000Z`;

async function search(userId: string, params = "/tenders?segment=72", last: string | null = null, kind = "tenders"): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare(
    "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, last_delivered_at, deliver) VALUES (?, ?, ?, ?, ?, 'en', ?, ?, 'daily')",
  ).bind(id, userId, kind, params, `Saved ${params}`, createdAt(), last).run();
  return id;
}

async function watcher(plan: "free" | "pro", target: string, day: string, cached?: "free" | "pro"): Promise<User> {
  const u = await user(plan, cached);
  await ACCOUNTS.batch([
    ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'on', ?)").bind(u.id, createdAt()),
    ACCOUNTS.prepare(
      "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'organization', ?, '', ?, ?, 'daily', ?, ?)",
    ).bind(nextId(), u.id, target, `Watched ${target}`, ORG_KINDS, createdAt(), addDays(day, -1)),
  ]);
  return u;
}

async function briefing(userId: string): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare(
    "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver, last_delivered_at) VALUES (?, ?, 'segment', '81', '', 'Briefing 81', 'en', ?, 'weekly', NULL)",
  ).bind(id, userId, createdAt()).run();
  return id;
}

const VIEW_ORG = "org-a000000001";

async function view(userId: string): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare(
    "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'organization', ?, 'Exemplar awards', 'en', 'weekly', ?)",
  ).bind(id, userId, `/organizations/${VIEW_ORG}/analytics?source=awards&years=3`, createdAt()).run();
  return id;
}

const one = async <T>(sql: string, ...binds: unknown[]) => ACCOUNTS.prepare(sql).bind(...binds).first<T>();
const count = async (sql: string, ...binds: unknown[]) => (await one<{ n: number }>(sql, ...binds))?.n ?? 0;

type RunRow = { at: string; data_date: string | null; outcome: string; sent: number; failed: number; left_due: number; detail: string | null };

const runRows = async (day: string) =>
  (await ACCOUNTS.prepare("SELECT at, data_date, outcome, sent, failed, left_due, detail FROM delivery_runs WHERE substr(at, 1, 10) = ? ORDER BY id")
    .bind(day).all<RunRow>()).results ?? [];

const runRow = (at: string, o: Partial<RunRow> & { outcome: string }) =>
  ACCOUNTS.prepare("INSERT INTO delivery_runs (at, data_date, outcome, sent, failed, left_due, detail) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(at, o.data_date ?? null, o.outcome, o.sent ?? 0, o.failed ?? 0, o.left_due ?? 0, o.detail ?? null);

// -- the records database --------------------------------------------------------------------------------

const TABLES = ["rec_events", "rec_meta", "records", "rec_orgs", "rec_buyers", "rec_buyer_quarters", "rec_segment_years", "rec_due", "rec_expiring",
  "rec_details", "rec_instruments"];

async function seedRecords(asOf: string): Promise<void> {
  await RECORDS.batch(TABLES.map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(asOf).run();
}

let k = 0;
const EVENT_COLS = ["day", "kind", "src", "oid", "buyer", "sid", "ref", "cents", "closing", "title", "path"] as const;
type Ev = Partial<Record<(typeof EVENT_COLS)[number], string | number | null>> & { day: string; kind: string; ref: string; path: string };

async function events(rows: Ev[]): Promise<void> {
  await RECORDS.batch(rows.map((r) => RECORDS.prepare(
    `INSERT INTO rec_events (k, ${EVENT_COLS.join(", ")}) VALUES (?, ${EVENT_COLS.map(() => "?").join(", ")})`,
  ).bind(++k, ...EVENT_COLS.map((c) => r[c] ?? null))));
}

const award = (day: string, org: string): Ev =>
  ({ day, kind: "award", src: 1, oid: orgNumber(org), ref: `award:${org}-${day}`, cents: 1_000_000, title: `Award ${org}`, path: `/awards/${org}-${day}` });

// -- the mail and the run -----------------------------------------------------------------------------------

type Handed = { to: string; subject: string; text?: string; headers?: Record<string, string> };

// A stand-in for the MAIL binding; refuse names the error code for a message, or nothing to take it.
function fakeMail(refuse: (m: Handed) => string | undefined = () => undefined) {
  const handed: Handed[] = [];
  const binding = {
    async send(m: Handed) {
      const code = refuse(m);
      if (code) throw Object.assign(new Error("refused"), { code });
      handed.push(m);
      return { messageId: "<r@awardwatch.ca>" };
    },
  } as unknown as SendEmail;
  return { handed, binding, to: (email: string) => handed.filter((m) => m.to === email) };
}

function tender(reference: string, day: string): TenderRow {
  return {
    reference, amendment: 0, title_en: `Notice ${reference}`, title_fr: `Avis ${reference}`, buyer_id: "dfo-mpo",
    buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada", published: day, closing: `${addDays(day, 30)}T14:00:00`,
    category: ["SRV"], notice_type_en: "Request for Proposal", notice_type_fr: "Demande de propositions", method_en: null, method_fr: null,
    segments: ["72"], provinces: ["BC"], first_seen: day, status: "open",
  };
}

// The published files of the week to the data date: the day's new notices, the others empty.
function files(day: string, notices: TenderRow[] = [tender(`cb-772-${day.replace(/-/g, "")}`, day)]): Record<string, unknown> {
  const out: Record<string, unknown> = { "stats.json": { ...stats, data_as_of: day } };
  for (let i = 0; i <= 8; i++) out[`tenders/new/${addDays(day, -i)}.json`] = i === 0 ? notices : [];
  return out;
}

type RunOpts = {
  mail?: SendEmail; day: string; hour: number; users: string[]; limits?: Limits; files?: Record<string, unknown>;
  fail?: (sqls: string[]) => void; extra?: Record<string, unknown>; ultra?: boolean;
};

async function run(o: RunOpts): Promise<RunReport> {
  const before = (sqls: string[]) => o.fail?.(sqls);
  const vars = {
    ACCOUNTS: hooked(ACCOUNTS, { rewrite: scope(o.users, o.limits), before }), RECORDS: hooked(RECORDS, { before }),
    ASSETS: makeFakeAssets({}, o.files ?? files(o.day)), MAIL: o.mail, MAIL_FROM: FROM, MAIL_SENDER: undefined,
    NOW: `${o.day}T${String(o.hour).padStart(2, "0")}:00:00Z`, ...o.extra,
  };
  return runDeliveries((o.ultra ? ultraEnv(vars) : onEnv(vars)) as never);
}

const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;

// =========================================================================================
// 1. The run log
// =========================================================================================

describe("the delivery job's run log", () => {
  it("is one row a run past the switch, on every way the run ends, with its data date and counts, and none while the switch is off", async () => {
    const day = "2030-01-07";
    const a = await user("pro");
    const b = await user("pro");
    await search(a.id, "/tenders?segment=72", lastDay(day));
    await search(b.id, "/tenders?segment=72", lastDay(day));
    const users = [a.id, b.id];
    const before = await count("SELECT COUNT(*) AS n FROM delivery_runs");
    expect((await runDeliveries({ ...offEnv(), NOW: at(day, 14) } as never)).outcome).toBe("off");
    expect(await count("SELECT COUNT(*) AS n FROM delivery_runs")).toBe(before);

    const mail = fakeMail((m) => (m.to === b.email ? "E_RECIPIENT_NOT_ALLOWED" : undefined));
    expect((await run({ day, hour: 15, users })).outcome).toBe("no_mail");
    expect((await run({ mail: mail.binding, day, hour: 16, users, files: { ...files(day), "stats.json": undefined } })).outcome).toBe("no_data");
    expect((await run({ mail: mail.binding, day, hour: 17, users, files: files(addDays(day, -1)) })).outcome).toBe("not_today");
    const done = await run({ mail: mail.binding, day, hour: 18, users });
    expect(done).toMatchObject({ outcome: "done", sent: 1, failed: 1, left: 0 });

    const rows = await runRows(day);
    expect(rows.map((r) => ({ ...r, detail: r.detail === null ? null : "text" }))).toEqual([
      { at: at(day, 15), data_date: null, outcome: "no_mail", sent: 0, failed: 0, left_due: 0, detail: "text" },
      { at: at(day, 16), data_date: null, outcome: "no_data", sent: 0, failed: 0, left_due: 0, detail: "text" },
      { at: at(day, 17), data_date: addDays(day, -1), outcome: "not_today", sent: 0, failed: 0, left_due: 0, detail: "text" },
      { at: at(day, 18), data_date: day, outcome: "done", sent: 1, failed: 1, left_due: 0, detail: null },
    ]);
    expect(rows[0].detail).toContain("MAIL");
    expect(rows[1].detail).toContain("stats.json");
    expect(rows[2].detail).toContain(addDays(day, -1));
  });

  it("counts what a sending limit, a fault or a wait left due, and says why in at most 120 characters naming no account or address", async () => {
    // A sending limit's refusal on the second of three: one sent, two left, nothing claimed for them.
    const day1 = "2030-01-14";
    const trio = [await user("pro"), await user("pro"), await user("pro")];
    for (const u of trio) await search(u.id, "/tenders?segment=72", lastDay(day1));
    const limitMail = fakeMail((m) => (m.to === trio[1].email ? "E_DAILY_LIMIT_EXCEEDED" : undefined));
    const limited = await run({ mail: limitMail.binding, day: day1, hour: 15, users: trio.map((u) => u.id) });
    expect(limited).toMatchObject({ outcome: "limited", sent: 1, left: 2 });

    // A file that did not read: the saved searches stop there.
    const day2 = "2030-01-15";
    const f = await user("pro");
    await search(f.id, "/tenders?segment=72", lastDay(day2));
    const noFile = { ...files(day2), [`tenders/new/${day2}.json`]: undefined };
    const fault = await run({ mail: fakeMail().binding, day: day2, hour: 15, users: [f.id], files: noFile });
    expect(fault).toMatchObject({ outcome: "fault", sent: 0, left: 1 });

    // The accounts database failing on the claim.
    const day3 = "2030-01-16";
    const g = await user("pro");
    await search(g.id, "/tenders?segment=72", lastDay(day3));
    const dbFault = await run({ mail: fakeMail().binding, day: day3, hour: 15, users: [g.id], fail: failOn("UPDATE saved_searches SET last_delivered_at") });
    expect(dbFault).toMatchObject({ outcome: "fault", left: 1 });

    // An organization search waiting for the records database.
    const day4 = "2030-01-17";
    const h = await user("pro");
    await search(h.id, "/organizations/org-e000000001", lastDay(day4), "organization");
    const waiting = await run({ mail: fakeMail().binding, day: day4, hour: 15, users: [h.id], extra: { RECORDS: undefined } });
    expect(waiting).toMatchObject({ outcome: "done", left: 1, waiting: 1 });

    const rows = [...await runRows(day1), ...await runRows(day2), ...await runRows(day3), ...await runRows(day4)];
    expect(rows.map((r) => [r.outcome, r.sent, r.left_due])).toEqual([["limited", 1, 2], ["fault", 0, 1], ["fault", 0, 1], ["done", 0, 1]]);
    expect(rows[0].detail).toBe("E_DAILY_LIMIT_EXCEEDED");
    expect(rows[1].detail).toBe(`tenders/new/${day2}.json could not be read; the next hour tries again`);
    expect(rows[2].detail).toBe("the accounts database could not be read or written; the next hour tries again");
    expect(rows[3].detail).toBe("waiting: the records database is not bound");
    for (const r of rows) {
      expect(r.detail!.length).toBeLessThanOrEqual(120);
      expect(r.detail).not.toContain("@");
    }
  });

  it("keeps the run's report and its mail when its row cannot be written, with one log line", async () => {
    const day = "2030-01-21";
    const p = await user("pro");
    await search(p.id, "/tenders?segment=72", lastDay(day));
    const mail = fakeMail();
    const report = await run({ mail: mail.binding, day, hour: 15, users: [p.id], fail: failOn("INSERT INTO delivery_runs", true) });
    expect(report).toMatchObject({ outcome: "done", sent: 1 });
    expect(mail.to(p.email)).toHaveLength(1);
    expect(await runRows(day)).toEqual([]);
    expect(logged().filter((l) => l.includes("[deliveries]") && l.includes("run log"))).toHaveLength(1);
  });

  it("holds the row's one query back from every claim, so a run at D1's figure can still write it", () => {
    expect(RUN_LOG_QUERIES).toBe(1);
    const q = new QueryCount();
    q.n = D1_QUERIES_MAX - CLAIM_QUERIES;
    expect(q.claimable).toBe(false);
    q.n = D1_QUERIES_MAX - CLAIM_QUERIES - RUN_LOG_QUERIES;
    expect(q.claimable).toBe(true);
  });
});

// The daily check on the morning after `day`, with the switch on and this file's accounts database; its delivery lines only.
const checkEnv = (extra: Record<string, unknown> = {}) =>
  ({ ...testEnv(), ACCOUNTS_ENABLED: "true", ACCOUNTS, SEARCH: undefined, DATA: undefined, MAIL_DAILY_QUOTA: "200", MAIL_DAILY_RESERVE: "40", ...extra });
const morningAfter = (day: string) => new Date(`${addDays(day, 1)}T06:00:00Z`);
const deliveryLines = (alerts: string[]) => alerts.filter((a) => /delivery (run|job)/.test(a));

async function checkLines(day: string, extra: Record<string, unknown> = {}): Promise<string[]> {
  return deliveryLines(collectAlerts(await gatherInputs(checkEnv(extra) as never, morningAfter(day))));
}

describe("the daily check on the delivery job's day", () => {
  it("says when no run was recorded at all", async () => {
    const day = "2030-02-02";
    expect(await checkLines(day)).toEqual([
      "No delivery run was recorded on 2030-02-02 (UTC): the hourly job (cron 0 15-20 * * *) did not run, or none of its runs could write the run log " +
      "(delivery_runs). Check the Worker's cron triggers and its logs.",
    ]);
  });

  it("says when no run read the day's data, so nothing was mailed", async () => {
    const day = "2030-02-03";
    await ACCOUNTS.batch([15, 16, 17, 18, 19, 20].map((h) => runRow(at(day, h), { outcome: "not_today", data_date: addDays(day, -1), detail: "x" })));
    expect(await checkLines(day)).toEqual([
      "No delivery run on 2030-02-03 read that day's data, so nothing was mailed (6 runs: 6 found an older data date). The nightly published late or " +
      "not at all; the next day's runs cover both days.",
    ]);
    // A Worker without its mail settings says so instead.
    const day2 = "2030-02-04";
    await ACCOUNTS.batch([runRow(at(day2, 15), { outcome: "no_mail", detail: "x" }), runRow(at(day2, 16), { outcome: "no_data", detail: "x" })]);
    expect(await checkLines(day2)).toEqual([
      "No delivery run on 2030-02-04 read that day's data, so nothing was mailed (2 runs: 1 could not read stats.json, 1 found no MAIL binding, " +
      "MAIL_FROM or https SITE_URL). Set the MAIL binding, MAIL_FROM and an https SITE_URL on the Worker.",
    ]);
  });

  it("says when the day ended with items still due, and when a run faulted, one line each", async () => {
    const day = "2030-02-05";
    await ACCOUNTS.batch([
      runRow(at(day, 15), { outcome: "capped", data_date: day, sent: 120, left_due: 40, detail: "the budget of 850 database queries" }),
      runRow(at(day, 16), { outcome: "fault", data_date: day, sent: 30, left_due: 12, detail: `tenders/new/${day}.json could not be read; the next hour tries again` }),
      runRow(at(day, 20), { outcome: "capped", data_date: day, sent: 60, left_due: 12, detail: "the budget of 850 database queries" }),
    ]);
    expect(await checkLines(day)).toEqual([
      "The last delivery run on 2030-02-05 (20:00 UTC) ended capped with 12 items still due: the budget of 850 database queries. The next day's runs " +
      "take them up.",
      "1 of 3 delivery runs on 2030-02-05 faulted; the first: tenders/new/2030-02-05.json could not be read; the next hour tries again. The Worker's " +
      "logs hold a [deliveries] line for each.",
    ]);
  });

  it("says nothing when the day went well", async () => {
    const day = "2030-02-06";
    await ACCOUNTS.batch([
      runRow(at(day, 15), { outcome: "not_today", data_date: addDays(day, -1), detail: "x" }),
      runRow(at(day, 16), { outcome: "done", data_date: day, sent: 80 }),
      runRow(at(day, 17), { outcome: "done", data_date: day }),
    ]);
    expect(await checkLines(day)).toEqual([]);
  });

  it("reads nothing while the switch is off, and never alarms on a database without the table (one log line)", async () => {
    const day = "2030-02-07";
    const asked: string[] = [];
    const answer = (sql: string, missing: boolean) => {
      asked.push(sql);
      if (sql.includes("delivery_runs") && missing) throw new Error("D1_ERROR: no such table: delivery_runs: SQLITE_ERROR");
      if (!missing) throw new Error("D1_ERROR: the switch is off");
      return null;
    };
    const fake = (missing: boolean) => ({
      prepare: (sql: string) => ({
        bind: () => ({ first: async () => answer(sql, missing), all: async () => ({ results: [answer(sql, missing)].filter(Boolean) }) }),
      }),
    }) as unknown as D1Database;
    expect(await checkLines(day, { ACCOUNTS_ENABLED: "false", ACCOUNTS: fake(false) })).toEqual([]);
    expect(asked.filter((s) => s.includes("delivery_runs"))).toEqual([]);
    logs.mockClear();
    expect(await checkLines(day, { ACCOUNTS: fake(true) })).toEqual([]);
    expect(asked.filter((s) => s.includes("delivery_runs"))).toHaveLength(1);
    expect(logged().filter((l) => l.includes("delivery_runs"))).toHaveLength(1);
  });
});

describe("the run log and the deliveries rows", () => {
  it("lose their rows older than 90 days with each run, and keep the rest", async () => {
    // A day later than every other here: each row this file wrote before is older than its 90 days.
    const day = "2031-03-03";
    const p = await user("pro");
    const id = await search(p.id, "/tenders?segment=72", lastDay(day));
    const old = `${addDays(day, -91)}T16:00:00.000Z`;
    const kept = `${addDays(day, -89)}T16:00:00.000Z`;
    await ACCOUNTS.batch([
      runRow(old, { outcome: "done", data_date: addDays(day, -91) }),
      runRow(kept, { outcome: "done", data_date: addDays(day, -89) }),
      ACCOUNTS.prepare("INSERT INTO deliveries (saved_search_id, sent_at, items, status) VALUES (?, ?, 1, 'sent')").bind(id, `${addDays(day, -100)}T16:00:00.000Z`),
      ACCOUNTS.prepare("INSERT INTO deliveries (saved_search_id, sent_at, items, status) VALUES (?, ?, 1, 'sent')").bind(id, `${addDays(day, -10)}T16:00:00.000Z`),
    ]);
    expect((await run({ mail: fakeMail().binding, day, hour: 15, users: [p.id] })).outcome).toBe("done");
    expect(await count("SELECT COUNT(*) AS n FROM delivery_runs WHERE at = ?", old)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM delivery_runs WHERE at = ?", kept)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM delivery_runs WHERE at = ?", at(day, 15))).toBe(1);
    expect((await ACCOUNTS.prepare("SELECT substr(sent_at, 1, 10) AS day FROM deliveries WHERE saved_search_id = ? ORDER BY id").bind(id)
      .all<{ day: string }>()).results?.map((r) => r.day)).toEqual([addDays(day, -10), day]);
    expect(await count("SELECT COUNT(*) AS n FROM delivery_runs WHERE at < ?", `${addDays(day, -90)}T15:00:00.000Z`)).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM deliveries WHERE sent_at < ?", `${addDays(day, -90)}T15:00:00.000Z`)).toBe(0);
  });
});

describe("the reads of the deliveries and the run log", () => {
  const plan = async (sql: string, ...binds: unknown[]) =>
    ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail));

  it("go through their indexes: the job's candidates and the searches page's newest delivery by idx_deliveries_search", async () => {
    const candidates = await plan(candidatesSql(), ...DELIVERABLE_KINDS, "2030-01-01", "2030-01-01");
    const candidateDeliveries = candidates.filter((s) => /\bd\b|deliveries/.test(s));
    expect(candidateDeliveries.length, candidates.join("\n")).toBeGreaterThan(0);
    expect(candidateDeliveries.every((s) => s.includes("idx_deliveries_search")), candidates.join("\n")).toBe(true);

    const last = await plan(LAST_DELIVERIES_SQL, "u");
    expect(last.some((s) => /^SEARCH x USING (COVERING )?INDEX idx_deliveries_search/.test(s)), last.join("\n")).toBe(true);
    expect(last.filter((s) => /^SCAN (d|x)\b/.test(s)), last.join("\n")).toEqual([]);

    // The pruning reads the rows it removes and one more, by the table's own order, and removes by the key.
    const prune = await plan(DELIVERIES_PRUNE_SQL, "2030-01-01T00:00:00.000Z");
    expect(prune.some((s) => /^SEARCH deliveries USING INTEGER PRIMARY KEY \(rowid<\?\)/.test(s)), prune.join("\n")).toBe(true);
    expect(prune.filter((s) => s.includes("TEMP B-TREE")), prune.join("\n")).toEqual([]);

    // The day's sends and the daily check's rows, by idx_delivery_runs_at.
    const bounds = ["2030-01-01T00:00:00.000Z", "2030-01-02T00:00:00.000Z"];
    for (const sql of [DAY_SENT_SQL, DELIVERY_RUNS_SQL]) {
      const binds = bounds;
      const steps = await plan(sql, ...binds);
      expect(steps.some((s) => s.includes("idx_delivery_runs_at")), steps.join("\n")).toBe(true);
      expect(steps.filter((s) => /^SCAN delivery_runs/.test(s)), steps.join("\n")).toEqual([]);
    }
  });
});

// =========================================================================================
// 2. The day's sending ceiling
// =========================================================================================

describe("the day's sending ceiling", () => {
  it("reads MAIL_DAILY_QUOTA and MAIL_DAILY_RESERVE, and anything that does not read means no ceiling", () => {
    expect(mailCeiling({ MAIL_DAILY_QUOTA: "200", MAIL_DAILY_RESERVE: "40" })).toEqual({ quota: 200, reserve: 40, ceiling: 160 });
    expect(mailCeiling({ MAIL_DAILY_QUOTA: " 200 ", MAIL_DAILY_RESERVE: "" })).toEqual({ quota: 200, reserve: 0, ceiling: 200 });
    expect(mailCeiling({ MAIL_DAILY_QUOTA: "200" })).toEqual({ quota: 200, reserve: 0, ceiling: 200 });
    for (const quota of [undefined, "", "0", "-5", "200.5", "2e2", "abc", "1000000000"]) {
      expect(mailCeiling({ MAIL_DAILY_QUOTA: quota, MAIL_DAILY_RESERVE: "40" }), String(quota)).toBeNull();
    }
    for (const reserve of ["-1", "4.5", "x", "200", "300"]) {
      expect(mailCeiling({ MAIL_DAILY_QUOTA: "200", MAIL_DAILY_RESERVE: reserve }), reserve).toBeNull();
    }
    // As wrangler.jsonc ships them.
    expect(wranglerConfig).toContain('"MAIL_DAILY_QUOTA": "200"');
    expect(wranglerConfig).toContain('"MAIL_DAILY_RESERVE": "40"');
  });

  it("stops the run as limited at the quota less the reserve, counting the day's earlier runs, with nothing claimed and unsent", async () => {
    const day = "2030-04-01";
    await ACCOUNTS.batch([runRow(at(day, 15), { outcome: "done", data_date: day, sent: 3 })]);
    const trio = [await user("pro"), await user("pro"), await user("pro")];
    const ids = [];
    for (const u of trio) ids.push(await search(u.id, "/tenders?segment=72", lastDay(day)));
    const mail = fakeMail();
    const users = trio.map((u) => u.id);
    const ceiling = { MAIL_DAILY_QUOTA: "6", MAIL_DAILY_RESERVE: "2" };
    const first = await run({ mail: mail.binding, day, hour: 16, users, extra: ceiling });
    expect(first).toMatchObject({ outcome: "limited", sent: 1, left: 2 });
    expect(mail.handed).toHaveLength(1);
    // The two left: not claimed, no row.
    for (const id of ids.slice(1)) {
      expect((await one<{ last_delivered_at: string }>("SELECT last_delivered_at FROM saved_searches WHERE id = ?", id))?.last_delivered_at).toBe(lastDay(day));
      expect(await count("SELECT COUNT(*) AS n FROM deliveries WHERE saved_search_id = ?", id)).toBe(0);
    }
    const second = await run({ mail: mail.binding, day, hour: 17, users, extra: ceiling });
    expect(second).toMatchObject({ outcome: "limited", sent: 0, left: 2 });
    expect(mail.handed).toHaveLength(1);
    const rows = await runRows(day);
    expect(rows.slice(1).map((r) => [r.outcome, r.sent, r.left_due, r.detail])).toEqual([
      ["limited", 1, 2, "the day's sending ceiling of 4 messages (MAIL_DAILY_QUOTA 6 less MAIL_DAILY_RESERVE 2)"],
      ["limited", 0, 2, "the day's sending ceiling of 4 messages (MAIL_DAILY_QUOTA 6 less MAIL_DAILY_RESERVE 2)"],
    ]);
    // The next UTC day starts afresh.
    const next = addDays(day, 1);
    await seedRecords(next);
    const third = await run({ mail: mail.binding, day: next, hour: 15, users, extra: ceiling });
    expect(third).toMatchObject({ outcome: "done", sent: 3 });
  });

  it("is shared by the parts of the run: the watch mail stops where the saved searches left it", async () => {
    const day = "2030-04-08";
    await seedRecords(day);
    const p = await user("pro");
    await search(p.id, "/tenders?segment=72", lastDay(day));
    const w1 = await watcher("pro", "org-e0000000b1", day);
    const w2 = await watcher("pro", "org-e0000000b1", day);
    await events([award(day, "org-e0000000b1")]);
    const mail = fakeMail();
    const report = await run({ mail: mail.binding, day, hour: 15, users: [p.id, w1.id, w2.id], extra: { MAIL_DAILY_QUOTA: "3", MAIL_DAILY_RESERVE: "1" } });
    expect(report).toMatchObject({ outcome: "limited", sent: 1, left: 1 });
    expect(report.watch).toMatchObject({ sent: 1 });
    expect(mail.handed).toHaveLength(2);
    expect(mail.to(w2.email)).toHaveLength(0);
    expect((await one<{ last_day: string | null }>("SELECT last_day FROM watch_mail WHERE user_id = ?", w2.id))?.last_day).toBeNull();
  });

  it("leaves the sign-in code alone: not counted and never limited", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await ACCOUNTS.batch([runRow(`${today}T00:00:00.000Z`, { outcome: "limited", data_date: today, sent: 999 })]);
    const runs = await count("SELECT COUNT(*) AS n FROM delivery_runs");
    const mail = fakeMail();
    const email = newEmail("ro-signin");
    const res = await app.request("/account/sign-in", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp(), origin: "http://localhost" },
      body: new URLSearchParams({ email }).toString(),
    }, onEnv({ MAIL: mail.binding, MAIL_FROM: FROM, MAIL_SENDER: undefined, MAIL_DAILY_QUOTA: "6", MAIL_DAILY_RESERVE: "2" }));
    expect(res.status).toBe(200);
    expect(mail.to(email)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) AS n FROM delivery_runs")).toBe(runs);
  });

  it("is not kept without the delivery_runs table: no ceiling, one log line, and the run goes on", async () => {
    const day = "2030-04-15";
    const pair = [await user("pro"), await user("pro")];
    for (const u of pair) await search(u.id, "/tenders?segment=72", lastDay(day));
    const table = accountsSchema.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").split(/;\s*\n/).map((s) => s.trim())
      .filter((s) => s.includes("delivery_runs"));
    expect(table).toHaveLength(2);
    await ACCOUNTS.prepare("DROP TABLE delivery_runs").run();
    try {
      const report = await run({ mail: fakeMail().binding, day, hour: 15, users: pair.map((u) => u.id), extra: { MAIL_DAILY_QUOTA: "1", MAIL_DAILY_RESERVE: "0" } });
      expect(report).toMatchObject({ outcome: "done", sent: 2 });
      expect(logged().filter((l) => l.includes("delivery_runs") && l.includes("ceiling"))).toHaveLength(1);
    } finally {
      await ACCOUNTS.batch(table.map((s) => ACCOUNTS.prepare(s)));
    }
  });

  it("is named by the daily check on the day it was reached, with the figures", async () => {
    const day = "2030-04-22";
    const text = "the day's sending ceiling of 160 messages (MAIL_DAILY_QUOTA 200 less MAIL_DAILY_RESERVE 40)";
    await ACCOUNTS.batch([
      runRow(at(day, 15), { outcome: "done", data_date: day, sent: 100 }),
      runRow(at(day, 16), { outcome: "limited", data_date: day, sent: 60, left_due: 30, detail: text }),
      runRow(at(day, 17), { outcome: "limited", data_date: day, sent: 0, left_due: 30, detail: text }),
    ]);
    expect(await checkLines(day)).toEqual([
      "The delivery job reached the day's sending ceiling on 2030-04-22: 160 messages sent of the 160 it allows (MAIL_DAILY_QUOTA 200 less " +
      "MAIL_DAILY_RESERVE 40, kept for sign-in codes), and 30 items waited for the next day. Ask Cloudflare for a higher Email Sending daily " +
      "limit (its Limit Increase Request Form), then raise MAIL_DAILY_QUOTA in wrangler.jsonc.",
    ]);
  });
});

// =========================================================================================
// 3. Paying accounts first
// =========================================================================================

describe("the lists of what is due, paying accounts first", () => {
  it("reach a Pro account's watch mail behind many Free followers in the first run, the cached plan never the gate", async () => {
    const day = "2030-06-03";
    await seedRecords(day);
    const target = "org-e0000000c1";
    const free = [];
    for (let i = 0; i < 5; i++) free.push(await watcher("free", target, day));
    // Cached as paid, but Free now; Pro; and Pro whose cache still says Free.
    const stale = await watcher("free", target, day, "pro");
    const pro = await watcher("pro", target, day);
    const unread = await watcher("pro", target, day, "free");
    await events([award(day, target)]);
    const mail = fakeMail();
    const users = [...free, stale, pro, unread].map((u) => u.id);
    const first = await run({ mail: mail.binding, day, hour: 15, users, limits: { watch: 3 } });
    expect(mail.to(pro.email)).toHaveLength(1);
    expect(mail.to(stale.email)).toHaveLength(0);
    expect(first.watch).toMatchObject({ sent: 1, skipped: 2 });
    await run({ mail: mail.binding, day, hour: 16, users, limits: { watch: 3 } });
    await run({ mail: mail.binding, day, hour: 17, users, limits: { watch: 3 } });
    expect(mail.to(unread.email)).toHaveLength(1);
    expect(mail.handed).toHaveLength(2);
  });

  it("do the same for the briefings and the saved views", async () => {
    const day = "2030-06-10";
    await seedRecords(day);
    await events([{ day, kind: "notice", src: 5, sid: 81, buyer: "dfo-mpo", closing: `${addDays(day, 20)}T14:00:00`, title: "Hydrographic survey",
      ref: "tender:cb-81-9", path: "/tenders/cb-81-9" }]);
    await RECORDS.prepare(
      "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote, comp, ref, title) VALUES (1, 2026, 3, NULL, ?, 81, 0, 30000000, 0, 1, 'cb-100-00000009', 'Translation')",
    ).bind(orgNumber(VIEW_ORG)).run();
    const downB = [await user("free"), await user("free"), await user("free")];
    for (const u of downB) await briefing(u.id);
    const proB = await user("pro");
    await briefing(proB.id);
    const downV = [await user("free"), await user("free"), await user("free")];
    for (const u of downV) await view(u.id);
    const ultraV = await user("ultra");
    await view(ultraV.id);
    const mail = fakeMail();
    const users = [...downB, proB, ...downV, ultraV].map((u) => u.id);
    await run({ mail: mail.binding, day, hour: 15, users, limits: { briefings: 2, views: 2 }, ultra: true });
    expect(mail.to(proB.email)).toHaveLength(1);
    expect(mail.to(ultraV.email)).toHaveLength(1);
    expect(mail.handed).toHaveLength(2);
  });

  it("put the paid accounts' saved searches first among the candidates too", async () => {
    const day = "2030-06-17";
    const free = [await user("free"), await user("free")];
    for (const u of free) await search(u.id, "/tenders?segment=72", lastDay(day));
    const pro = await user("pro");
    const proSearch = await search(pro.id, "/tenders?segment=72", lastDay(day));
    const rows = (await ACCOUNTS.prepare(scope([...free, pro].map((u) => u.id))(candidatesSql()))
      .bind(...DELIVERABLE_KINDS, day, day).all<{ id: string }>()).results ?? [];
    expect(rows.map((r) => r.id)[0]).toBe(proSearch);
    expect(rows).toHaveLength(3);
  });
});
