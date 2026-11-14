// Hardening of the scheduled mail (the review of 2026-11-14): the delivery
// job's five parts as a paying account meets them. Free and downgraded rows
// leave the day's lists so the accounts behind them are reached; the hourly
// run stays under D1's queries per invocation and stops cleanly; a merged
// organization or buyer goes on being read at the id that took its records;
// a stop link clicked while the run goes stops that run's message; a write
// that fails once after a send is tried again; a weekly email refused this
// week leaves the matching notices to the watch mail.
//
// Every run here is held to this file's own accounts (scope(), which narrows
// each part's list of what is due), against local accounts and records
// databases built from the schemas and filled here.
import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "../public/closing.js";
import { BRIEFINGS_DUE_SQL, briefingStart } from "../src/account/briefings";
import { D1_QUERIES_MAX, RUN_QUERY_BUDGET, type RunReport, runDeliveries } from "../src/account/deliveries";
import { weeklyTakesMatches } from "../src/account/fit_mail";
import { type Mark, markText } from "../src/account/records_deliveries";
import { VIEWS_DUE_SQL } from "../src/account/view_mail";
import { WATCH_DUE_SQL } from "../src/account/watch_mail";
import { WEEKLY_DUE_SQL } from "../src/account/weekly";
import type { TenderRow } from "../src/data";
import { app } from "../src/index";
import { orgNumber } from "../src/records_db";
import { ACCOUNTS, newEmail, nextIp, onEnv, ultraEnv, useAccountsDb } from "./accounts-helpers";
import { makeFakeAssets } from "./assets";
import stats from "./fixtures/stats.json";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const FROM = "alerts@awardwatch.ca";
// D1's queries per Worker invocation on Workers Paid (developers.cloudflare.com/d1/platform/limits/), written
// out here rather than read from the code under test.
const D1_LIMIT = 1000;
const ORG_KINDS = "award,grant,amended,cancelled,ends_12m,ends_6m,ended,instrument_gained,instrument_lost,instrument_expires_6m";

beforeAll(() => applySql(RECORDS, SCHEMA));

let quiet: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  quiet = (["log", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  for (const q of quiet) q.mockRestore();
});

// -- the databases, wrapped --------------------------------------------------------------------

// What a test does with each query the job makes: rewrite its text before it
// is prepared, and see it (every statement of a batch) before it runs, which
// may throw as D1 would.
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

// Each part's list of what is due narrowed to these users; limits replaces a
// list's cap (WATCH_ACCOUNTS_MAX, BRIEFINGS_RUN_MAX, VIEWS_RUN_MAX) with a
// smaller one, so a full list is a few rows.
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

// D1 past its queries per invocation: every query of one run counted, on both databases.
type Counter = { n: number; most: number };
const counter = (): Counter => ({ n: 0, most: 0 });

// A fault on the first query whose text holds `part`, then none: a passing D1 fault.
function failOnce(part: string): (sqls: string[]) => void {
  let done = false;
  return (sqls) => {
    if (!done && sqls.some((s) => s.includes(part))) {
      done = true;
      throw new Error("D1_ERROR: Network connection lost.");
    }
  };
}

// -- the accounts --------------------------------------------------------------------------------

let seq = 0;
const nextId = () => (0xd0000000 + ++seq).toString(16).padStart(32, "0");
const createdAt = () => new Date(Date.UTC(2001, 0, 1) + ++seq * 1000).toISOString();

type User = { id: string; email: string };

function userRows(plan: "free" | "pro" | "ultra"): { user: User; statements: D1PreparedStatement[] } {
  const id = nextId();
  const email = newEmail(`hm-${plan}`);
  const statements = [
    ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active')").bind(id, email),
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

async function user(plan: "free" | "pro" | "ultra"): Promise<User> {
  const { user: u, statements } = userRows(plan);
  await ACCOUNTS.batch(statements);
  return u;
}

const mailOnRow = (userId: string) =>
  ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'on', ?)").bind(userId, createdAt());

const watchRow = (userId: string, target: string, day: string) =>
  ACCOUNTS.prepare(
    "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'organization', ?, '', ?, ?, 'daily', ?, ?)",
  ).bind(nextId(), userId, target, `Watched ${target}`, ORG_KINDS, createdAt(), addDays(day, -1));

async function watcher(plan: "free" | "pro", target: string, day: string): Promise<User> {
  const u = await user(plan);
  await ACCOUNTS.batch([mailOnRow(u.id), watchRow(u.id, target, day)]);
  return u;
}

async function search(userId: string, kind: string, params: string, last: string | null): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare(
    "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, last_delivered_at, deliver) VALUES (?, ?, ?, ?, ?, 'en', ?, ?, 'daily')",
  ).bind(id, userId, kind, params, `Saved ${params}`, createdAt(), last).run();
  return id;
}

async function mark(searchId: string, asOf: string, counts: Mark["counts"]): Promise<void> {
  const m: Mark = { asOf, rules: "2", from: 2017, to: 2026, counts };
  await ACCOUNTS.prepare("INSERT INTO delivery_marks (search_id, as_of, counts, updated_at) VALUES (?, ?, ?, ?)")
    .bind(searchId, asOf, markText(m), `${asOf}T15:00:00.000Z`).run();
}

async function briefing(userId: string, kind: "segment" | "buyer", subject: string): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare(
    "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver, last_delivered_at) VALUES (?, ?, ?, ?, '', ?, 'en', ?, 'weekly', NULL)",
  ).bind(id, userId, kind, subject, `Briefing ${subject}`, createdAt()).run();
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

const count = async (sql: string, ...binds: unknown[]) => (await ACCOUNTS.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0;

// -- the records database --------------------------------------------------------------------------

const TABLES = ["rec_events", "rec_meta", "records", "rec_orgs", "rec_buyers", "rec_buyer_quarters", "rec_segment_years", "rec_due", "rec_expiring",
  "rec_details", "rec_instruments"];

async function seedRecords(asOf: string): Promise<void> {
  await RECORDS.batch(TABLES.map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(asOf).run();
}

const setAsOf = (asOf: string) => RECORDS.prepare("UPDATE rec_meta SET value = ? WHERE key = 'as_of'").bind(asOf).run();

let k = 0;
const EVENT_COLS = ["day", "kind", "src", "oid", "buyer", "sid", "ref", "cents", "closing", "title", "path"] as const;
type Ev = Partial<Record<(typeof EVENT_COLS)[number], string | number | null>> & { day: string; kind: string; ref: string; path: string };

async function events(rows: Ev[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 50) {
    await RECORDS.batch(rows.slice(i, i + 50).map((r) => RECORDS.prepare(
      `INSERT INTO rec_events (k, ${EVENT_COLS.join(", ")}) VALUES (?, ${EVENT_COLS.map(() => "?").join(", ")})`,
    ).bind(++k, ...EVENT_COLS.map((c) => r[c] ?? null))));
  }
}

const award = (day: string, org: string, n = 1): Ev =>
  ({ day, kind: "award", src: 1, oid: orgNumber(org), ref: `award:${org}-${n}`, cents: 1_000_000, title: `Award ${org} ${n}`, path: `/awards/${org}-${n}` });

// Records counted for an organization: n published contracts in 2026-27.
async function orgRecords(org: string, name: string, n: number): Promise<void> {
  await RECORDS.batch([
    RECORDS.prepare("DELETE FROM records WHERE oid = ?").bind(orgNumber(org)),
    RECORDS.prepare("INSERT OR REPLACE INTO rec_orgs (oid, name) VALUES (?, ?)").bind(orgNumber(org), name),
    ...Array.from({ length: n }, () => RECORDS.prepare(
      "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote) VALUES (3, 2026, 3, NULL, ?, NULL, 0, 1000000, 0)",
    ).bind(orgNumber(org))),
  ]);
}

// -- the mail and the run -----------------------------------------------------------------------------

type Handed = { to: string; subject: string; text?: string; html?: string; headers?: Record<string, string> };

function fakeMail(onSend?: (m: Handed) => Promise<void> | void) {
  const handed: Handed[] = [];
  const binding = {
    async send(m: Handed) {
      handed.push(m);
      await onSend?.(m);
      return { messageId: "<h@awardwatch.ca>" };
    },
  } as unknown as SendEmail;
  const about = (id: string) => handed.filter((m) => (m.headers?.["List-Unsubscribe"] ?? "").includes(`=${id}&`));
  return { handed, binding, to: (email: string) => handed.filter((m) => m.to === email), about };
}

function tender(reference: string, day: string, over: Partial<TenderRow> = {}): TenderRow {
  return {
    reference, amendment: 0, title_en: `Notice ${reference}`, title_fr: `Avis ${reference}`, buyer_id: "dfo-mpo",
    buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada", published: day, closing: `${addDays(day, 30)}T14:00:00`,
    category: ["SRV"], notice_type_en: "Request for Proposal", notice_type_fr: "Demande de propositions", method_en: null, method_fr: null,
    segments: ["72"], provinces: ["BC"], first_seen: day, status: "open", ...over,
  };
}

// The published files of the week to the data date: the day's new notices, the others empty.
function files(day: string, o: { notices?: TenderRow[]; extra?: Record<string, unknown> } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { "stats.json": { ...stats, data_as_of: day } };
  for (let i = 0; i <= 8; i++) out[`tenders/new/${addDays(day, -i)}.json`] = i === 0 ? o.notices ?? [] : [];
  return { ...out, ...o.extra };
}

type RunOpts = {
  mail: SendEmail; day: string; hour: number; users: string[]; limits?: Limits; files?: Record<string, unknown>;
  count?: Counter; fail?: (sqls: string[]) => void; ultra?: boolean;
};

async function run(o: RunOpts): Promise<RunReport> {
  if (o.count) o.count.n = 0;
  const before = (sqls: string[]) => {
    if (o.count && ++o.count.n > D1_LIMIT) throw new Error("D1_ERROR: Too many API requests by single Worker invocation");
    o.fail?.(sqls);
  };
  const vars = {
    ACCOUNTS: hooked(ACCOUNTS, { rewrite: scope(o.users, o.limits), before }), RECORDS: hooked(RECORDS, { before }),
    ASSETS: makeFakeAssets({}, o.files ?? files(o.day)), MAIL: o.mail, MAIL_FROM: FROM, MAIL_SENDER: undefined,
    NOW: `${o.day}T${String(o.hour).padStart(2, "0")}:00:00Z`,
  };
  const report = await runDeliveries((o.ultra ? ultraEnv(vars) : onEnv(vars)) as never);
  if (o.count) o.count.most = Math.max(o.count.most, o.count.n);
  return report;
}

const stopPost = (path: string) => app.request(path, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp() }, body: "List-Unsubscribe=One-Click",
}, onEnv());

// =========================================================================================
// 1. Free and downgraded rows leave the day's lists
// =========================================================================================

describe("the lists of what is due", () => {
  it("leave a Free or downgraded account's rows once read, so the paying accounts behind them are reached the next hour", async () => {
    const day = "2026-12-09";
    await seedRecords(day);
    const mail = fakeMail();
    // The watch mail: two Free accounts that follow a page (their row is made with the first watch), then a Pro account.
    const freeW = [await watcher("free", "org-c0000000a1", day), await watcher("free", "org-c0000000a1", day)];
    const proW = await watcher("pro", "org-c0000000a1", day);
    // The briefings: two on accounts moved down to Free (delivery still weekly), then a Pro account's.
    const freeB = [await user("free"), await user("free")];
    const freeBriefs = [await briefing(freeB[0].id, "segment", "81"), await briefing(freeB[1].id, "segment", "81")];
    const proB = await user("pro");
    await briefing(proB.id, "segment", "81");
    // The saved views: two on accounts moved down from Ultra to Pro, then an Ultra account's.
    const proV = [await user("pro"), await user("pro")];
    const downViews = [await view(proV[0].id), await view(proV[1].id)];
    const ultraV = await user("ultra");
    await view(ultraV.id);
    await events([
      award(day, "org-c0000000a1"),
      { day, kind: "notice", src: 5, sid: 81, buyer: "dfo-mpo", closing: `${addDays(day, 20)}T14:00:00`, title: "Hydrographic survey", ref: "tender:cb-81-1",
        path: "/tenders/cb-81-1" },
    ]);
    await RECORDS.prepare(
      "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote, comp, ref, title) VALUES (1, 2026, 3, NULL, ?, 81, 0, 30000000, 0, 1, 'cb-100-00000009', 'Translation')",
    ).bind(orgNumber(VIEW_ORG)).run();
    const users = [...freeW, proW, ...freeB, proB, ...proV, ultraV].map((u) => u.id);
    const limits = { watch: 2, briefings: 2, views: 2 };

    const first = await run({ mail: mail.binding, day, hour: 16, users, limits, ultra: true });
    expect([first.watch?.skipped, first.briefing?.skipped, first.views?.skipped]).toEqual([2, 2, 2]);
    await run({ mail: mail.binding, day, hour: 17, users, limits, ultra: true });

    expect(mail.to(proW.email)).toHaveLength(1);
    expect(mail.to(proB.email)).toHaveLength(1);
    expect(mail.to(ultraV.email)).toHaveLength(1);
    expect(mail.handed).toHaveLength(3);
    // Marked for the data date (the watch mail) or the period (a briefing, a view), with no run row: nothing was sent or checked.
    for (const f of freeW) {
      expect((await ACCOUNTS.prepare("SELECT last_day, last_at, last_status FROM watch_mail WHERE user_id = ?").bind(f.id).first())).toEqual({
        last_day: day, last_at: null, last_status: null,
      });
      expect(await count("SELECT COUNT(*) AS n FROM watch_deliveries WHERE user_id = ?", f.id)).toBe(0);
    }
    for (const b of freeBriefs) {
      expect((await ACCOUNTS.prepare("SELECT last_delivered_at FROM briefings WHERE id = ?").bind(b).first<{ last_delivered_at: string }>())?.last_delivered_at
        .slice(0, 10)).toBe(day);
      expect(await count("SELECT COUNT(*) AS n FROM briefing_deliveries WHERE briefing_id = ?", b)).toBe(0);
    }
    for (const v of downViews) {
      expect((await ACCOUNTS.prepare("SELECT last_delivered_at FROM saved_views WHERE id = ?").bind(v).first<{ last_delivered_at: string }>())?.last_delivered_at
        .slice(0, 10)).toBe(day);
      expect(await count("SELECT COUNT(*) AS n FROM view_deliveries WHERE view_id = ?", v)).toBe(0);
    }
  });
});

// =========================================================================================
// 2. One invocation, D1's queries per invocation
// =========================================================================================

describe("the hourly run against D1's queries per invocation", () => {
  it("stops cleanly before the limit, leaves nothing claimed without its row, and the next hours send the rest once", async () => {
    expect(D1_QUERIES_MAX).toBe(D1_LIMIT);
    expect(RUN_QUERY_BUDGET).toBeLessThan(D1_LIMIT);
    const day = "2026-12-10";
    await seedRecords(day);
    const mail = fakeMail();
    // 400 Free followers, older than every paying account, then 40 Pro accounts with 3 daily searches and 10 watches each.
    const free: User[] = [];
    for (let b = 0; b < 4; b++) {
      const rows = Array.from({ length: 100 }, () => userRows("free"));
      await ACCOUNTS.batch(rows.flatMap((r) => r.statements));
      await ACCOUNTS.batch(rows.flatMap((r) => [mailOnRow(r.user.id), watchRow(r.user.id, "org-c0000000b0", day)]));
      free.push(...rows.map((r) => r.user));
    }
    const pro: User[] = [];
    const searches: string[] = [];
    for (let b = 0; b < 4; b++) {
      const rows = Array.from({ length: 10 }, () => userRows("pro"));
      await ACCOUNTS.batch(rows.flatMap((r) => r.statements));
      const stmts: D1PreparedStatement[] = [];
      for (const r of rows) {
        stmts.push(mailOnRow(r.user.id));
        for (let w = 0; w < 10; w++) stmts.push(watchRow(r.user.id, `org-c0000${String(pro.length).padStart(3, "0")}${w}0`, day));
        for (const params of ["/tenders?segment=72", "/tenders?segment=72&province=BC", "/tenders?category=SRV"]) {
          const id = nextId();
          searches.push(id);
          stmts.push(ACCOUNTS.prepare(
            "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, last_delivered_at, deliver) VALUES (?, ?, 'tenders', ?, 'Load', 'en', ?, ?, 'daily')",
          ).bind(id, r.user.id, params, createdAt(), `${addDays(day, -1)}T16:00:00.000Z`));
        }
        pro.push(r.user);
      }
      await ACCOUNTS.batch(stmts);
    }
    await events(pro.map((_, i) => award(day, `org-c0000${String(i).padStart(3, "0")}00`)));
    const users = [...free, ...pro].map((u) => u.id);
    const notices = [tender("cb-772-77200001", day)];
    const counted = counter();
    const reports: RunReport[] = [];
    for (let hour = 15; hour <= 20; hour++) {
      const report = await run({ mail: mail.binding, day, hour, users, files: files(day, { notices }), count: counted });
      reports.push(report);
      expect(report.outcome, `${hour}:00`).not.toBe("fault");
      expect(counted.n, `${hour}:00`).toBeLessThanOrEqual(D1_LIMIT);
      // Nothing claimed at this run's time without the row that records it.
      const at = `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
      expect(await count(
        "SELECT COUNT(*) AS n FROM saved_searches s WHERE s.last_delivered_at = ? AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.saved_search_id = s.id AND d.sent_at = ?)",
        at, at,
      ), `${hour}:00 searches`).toBe(0);
      expect(await count(
        "SELECT COUNT(*) AS n FROM watch_mail m WHERE m.last_at = ? AND NOT EXISTS (SELECT 1 FROM watch_deliveries d WHERE d.user_id = m.user_id AND d.sent_at = ?)",
        at, at,
      ), `${hour}:00 watch mail`).toBe(0);
      if (report.outcome === "done") break;
    }
    // The first run stopped at the query budget (160 messages are well inside the cap of 300), under D1's figure.
    expect(reports[0].outcome).toBe("capped");
    expect(counted.most).toBeGreaterThanOrEqual(RUN_QUERY_BUDGET);
    expect(counted.most).toBeLessThan(D1_LIMIT);
    expect(reports[reports.length - 1].outcome).toBe("done");
    // Every search once, every Pro account's watch mail once, no Free follower.
    for (const id of searches) expect(mail.about(id), id).toHaveLength(1);
    for (const u of pro) expect(mail.handed.filter((m) => m.to === u.email && m.subject.includes("what you follow")), u.email).toHaveLength(1);
    for (const u of free) expect(mail.to(u.email)).toHaveLength(0);
    expect(mail.handed).toHaveLength(searches.length + pro.length);
  });
});

// =========================================================================================
// 3. Merged organizations and buyers
// =========================================================================================

describe("a saved search or briefing whose organization or buyer the nightly merged", () => {
  it("is read at the surviving id, its row and label kept as saved, beside a search on the surviving id", async () => {
    const day1 = "2026-12-15";
    const day2 = "2026-12-16";
    const OLD = "org-c100000001";
    const NEW = "org-c100000002";
    const aliases = { "aliases/c1.json": { [OLD]: NEW }, "buyers/aliases.json": { aliases: { "old-works-office": "new-works-office" } } };
    await seedRecords(day1);
    await orgRecords(NEW, "New Works Ltd.", 3);
    await RECORDS.batch([
      RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (501, 'new-works-office', 'New Works Office', 'Bureau des nouveaux travaux')"),
      RECORDS.prepare("INSERT INTO rec_buyer_quarters (bid, src, fy, fq, n, cents, n_no_value) VALUES (501, 1, 2026, 3, 2, 2000000, 0)"),
    ]);
    await events([{ day: day1, kind: "notice", src: 5, sid: 72, buyer: "new-works-office", closing: `${addDays(day1, 20)}T14:00:00`,
      title: "Merged buyer notice", ref: "tender:cb-501-1", path: "/tenders/cb-501-1" }]);
    const mail = fakeMail();
    const p = await user("pro");
    const last = `${addDays(day1, -1)}T16:00:00.000Z`;
    const orgOld = await search(p.id, "organization", `/organizations/${OLD}`, last);
    await mark(orgOld, addDays(day1, -1), { "3:2026": [1, 1_000_000] });
    const orgNew = await search(p.id, "organization", `/organizations/${NEW}`, last);
    await mark(orgNew, addDays(day1, -1), { "3:2026": [3, 3_000_000] });
    const buyerOld = await search(p.id, "buyer", "/buyers/old-works-office", last);
    await mark(buyerOld, addDays(day1, -1), { "1:2026": [1, 1_000_000] });
    const tenders = await search(p.id, "tenders", "/tenders?buyer=old-works-office", last);
    const brief = await briefing(p.id, "buyer", "old-works-office");
    const notice = tender("cb-501-50100001", day1, { buyer_id: "new-works-office", buyer_en: "New Works Office", title_en: "Merged buyer tender" });

    await run({ mail: mail.binding, day: day1, hour: 16, users: [p.id], files: files(day1, { notices: [notice], extra: aliases }) });
    // The tender search's filter and the briefing read the buyer at its surviving id.
    expect(mail.about(tenders)).toHaveLength(1);
    expect(mail.about(tenders)[0].text).toContain("Merged buyer tender");
    expect(mail.about(brief)).toHaveLength(1);
    expect(mail.about(brief)[0].text).toContain("Merged buyer notice");
    // The first reading at the surviving id keeps its counts: the merge moved records that were never new.
    expect([mail.about(orgOld), mail.about(buyerOld), mail.about(orgNew)].map((m) => m.length)).toEqual([0, 0, 0]);

    // The next data date, one more record at each: every one of them reports it.
    await setAsOf(day2);
    await orgRecords(NEW, "New Works Ltd.", 4);
    await RECORDS.prepare("UPDATE rec_buyer_quarters SET n = 3 WHERE bid = 501").run();
    await run({ mail: mail.binding, day: day2, hour: 16, users: [p.id], files: files(day2, { extra: aliases }) });
    for (const id of [orgOld, buyerOld, orgNew]) {
      expect(mail.about(id), id).toHaveLength(1);
      expect(mail.about(id)[0].subject, id).toContain("1 new record");
    }
    // Nothing stored was rewritten.
    expect(await ACCOUNTS.prepare("SELECT params, label FROM saved_searches WHERE id = ?").bind(orgOld).first())
      .toEqual({ params: `/organizations/${OLD}`, label: `Saved /organizations/${OLD}` });
    expect(await ACCOUNTS.prepare("SELECT subject, label FROM briefings WHERE id = ?").bind(brief).first())
      .toEqual({ subject: "old-works-office", label: "Briefing old-works-office" });
  });
});

// =========================================================================================
// 4. A stop link clicked while the run goes
// =========================================================================================

describe("a stop link clicked while the run goes", () => {
  it("stops that run's message: a saved search's, and the watch mail's", async () => {
    const day = "2026-12-17";
    await seedRecords(day);
    const p = await user("pro");
    const last = `${addDays(day, -1)}T16:00:00.000Z`;
    await search(p.id, "tenders", "/tenders?segment=72", last);
    const second = await search(p.id, "tenders", "/tenders?segment=72&province=BC", last);
    const searchSecret = "e".repeat(32);
    await ACCOUNTS.prepare("INSERT INTO delivery_tokens (search_id, secret, created_at) VALUES (?, ?, ?)").bind(second, searchSecret, last).run();
    const w1 = await watcher("pro", "org-c0000000d1", day);
    const w2 = await watcher("pro", "org-c0000000d1", day);
    const watchSecret = "f".repeat(32);
    await ACCOUNTS.prepare("UPDATE watch_mail SET secret = ? WHERE user_id = ?").bind(watchSecret, w2.id).run();
    await events([award(day, "org-c0000000d1")]);
    // A reader clicks Stop (or a mail client posts one-click) the moment the first message of each kind leaves.
    const clicked: number[] = [];
    const mail = fakeMail(async (m) => {
      const list = m.headers?.["List-Unsubscribe"] ?? "";
      if (list.includes("stop?s=") && !clicked.includes(1)) {
        clicked.push(1);
        expect((await stopPost(`/account/stop?s=${second}&t=${searchSecret}`)).status).toBe(200);
      }
      if (list.includes("stop?w=") && !clicked.includes(2)) {
        clicked.push(2);
        expect((await stopPost(`/account/stop?w=${w2.id}&t=${watchSecret}`)).status).toBe(200);
      }
    });
    await run({ mail: mail.binding, day, hour: 16, users: [p.id, w1.id, w2.id], files: files(day, { notices: [tender("cb-772-77200009", day)] }) });
    expect(clicked).toEqual([1, 2]);
    expect(mail.about(second)).toHaveLength(0);
    expect(await count("SELECT COUNT(*) AS n FROM deliveries WHERE saved_search_id = ?", second)).toBe(0);
    expect(mail.to(w1.email)).toHaveLength(1);
    expect(mail.to(w2.email)).toHaveLength(0);
    expect(await count("SELECT COUNT(*) AS n FROM watch_deliveries WHERE user_id = ?", w2.id)).toBe(0);
    expect(mail.handed).toHaveLength(2);
  });
});

// =========================================================================================
// 5. A write that fails once after a message went
// =========================================================================================

describe("a write that fails once after a message went", () => {
  it("is tried again, so the watch mail of the next data date does not repeat the events", async () => {
    const day1 = "2026-12-22";
    const day2 = "2026-12-23";
    await seedRecords(day1);
    const w = await watcher("pro", "org-c0000000e1", day1);
    await events([award(day1, "org-c0000000e1")]);
    const mail = fakeMail();
    const fail = failOnce("UPDATE watches SET last_sent_day");
    await run({ mail: mail.binding, day: day1, hour: 16, users: [w.id], fail });
    expect(mail.to(w.email)).toHaveLength(1);
    // The next data date has nothing new for the watch.
    await setAsOf(day2);
    await run({ mail: mail.binding, day: day2, hour: 16, users: [w.id], files: files(day2) });
    expect(mail.to(w.email)).toHaveLength(1);
  });

  it("is tried again, so an organization search's next delivery does not report the same records again", async () => {
    const day1 = "2026-12-28";
    const day2 = "2026-12-29";
    await seedRecords(day1);
    await orgRecords("org-c0000000e2", "Counted Works Ltd.", 2);
    const p = await user("pro");
    const id = await search(p.id, "organization", "/organizations/org-c0000000e2", `${addDays(day1, -1)}T16:00:00.000Z`);
    await mark(id, addDays(day1, -1), { "3:2026": [1, 1_000_000] });
    const mail = fakeMail();
    await run({ mail: mail.binding, day: day1, hour: 16, users: [p.id], fail: failOnce("INSERT INTO delivery_marks") });
    expect(mail.about(id)).toHaveLength(1);
    expect(mail.about(id)[0].subject).toContain("1 new record");
    await setAsOf(day2);
    await run({ mail: mail.binding, day: day2, hour: 16, users: [p.id], files: files(day2) });
    expect(mail.about(id)).toHaveLength(1);
  });
});

// =========================================================================================
// 10. A weekly email refused this week
// =========================================================================================

describe("a weekly email refused this week", () => {
  it("does not take the week's matching notices away from the watch mail", async () => {
    const u = await user("pro");
    const week = "2026-12-07";
    await ACCOUNTS.prepare(
      "INSERT INTO weekly_mail (user_id, mail, via, on_at, created_at, last_week, last_status, failed_week) VALUES (?, 'on', 'account', ?, ?, ?, 'failed', ?)",
    ).bind(u.id, "2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z", "2026-11-30", week).run();
    expect(await weeklyTakesMatches(onEnv() as never, u.id, week)).toBe(false);
    // The week after, the email takes them again.
    expect(await weeklyTakesMatches(onEnv() as never, u.id, addDays(week, 7))).toBe(true);
  });
});

// =========================================================================================
// 11. A Monday with no run
// =========================================================================================

describe("the watch mail of a week whose Monday had no run", () => {
  it("opens with the organization's block on the account's first message of the week, and not again that week", async () => {
    // Monday 2026-12-14's nightly came after the last run: no message that day. Tuesday is the week's first.
    const tue = "2026-12-15";
    const wed = "2026-12-16";
    await seedRecords(tue);
    const w = await watcher("pro", "org-c0000000f1", tue);
    await ACCOUNTS.batch([
      ACCOUNTS.prepare("UPDATE watch_mail SET last_day = '2026-12-13' WHERE user_id = ?").bind(w.id),
      ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?, 'org-a000000001', NULL, '[]', ?, ?)")
        .bind(w.id, "2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"),
    ]);
    await events([award(tue, "org-c0000000f1", 1), award(wed, "org-c0000000f1", 2)]);
    const mail = fakeMail();
    await run({ mail: mail.binding, day: tue, hour: 16, users: [w.id] });
    await setAsOf(wed);
    await run({ mail: mail.binding, day: wed, hour: 16, users: [w.id], files: files(wed) });
    const [first, second] = mail.to(w.email);
    // The block's heading, in capitals in the text part as in the HTML part's band.
    expect(first.text).toMatch(/your organization/i);
    expect(second.text).not.toMatch(/your organization/i);
  });
});

describe("a briefing sent late in the week", () => {
  it("starts the next week's span after the last data date it covered, so no day is reported twice", () => {
    // Monday's nightly was late: the briefing went on Tuesday 2026-12-08; the next Monday covers from the Wednesday.
    expect(briefingStart("2026-12-08T16:00:00.000Z", "2026-12-14")).toBe("2026-12-08");
    // On time: the seven data dates ending with the data date, as before.
    expect(briefingStart("2026-12-07T16:00:00.000Z", "2026-12-14")).toBe("2026-12-07");
    expect(briefingStart(null, "2026-12-14")).toBe("2026-12-07");
  });
});
