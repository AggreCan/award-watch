// Two follow-ups to the grouped saved-search message (src/account/deliveries.ts sendGroup):
// 2. a group that its claims leave at GROUP_OVER or fewer (stop links clicked between the run's read and its
//    claims) goes as each search's own message, as five or fewer with news always do, each one held to the
//    run's cap, the day's ceiling and the query budget; when one of them stops the run, the claims not yet
//    sent are given back, so no search is sent twice and none is lost;
// 3. the dictionary keeps no line that nothing reads and that compares two plans (billing.pro_searches).
//
// Storage is this file's own, and every run is narrowed to the test's own accounts (scope) on a day of its own.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "../public/closing.js";
import { type RunReport, runDeliveries } from "../src/account/deliveries";
import { ACCOUNT_STRINGS } from "../src/account/strings";
import { WATCH_DUE_SQL } from "../src/account/watch_mail";
import type { TenderRow } from "../src/data";
import { ACCOUNTS, newEmail, onEnv, useAccountsDb } from "./accounts-helpers";
import { makeFakeAssets } from "./assets";
import stats from "./fixtures/stats.json";

useAccountsDb();

const FROM = "alerts@awardwatch.ca";

let logs: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logs = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => logs.mockRestore());

// -- the database, wrapped (a hook may wait, so a test can change a row between the run's read and its claims) --

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

// The saved searches' list and the watch mail's narrowed to these users (the other parts read nothing of them).
function scope(users: string[]): (sql: string) => string {
  const list = users.map((u) => `'${u.replace(/[^0-9a-f]/g, "")}'`).join(", ");
  const narrow = (sql: string, alias: string) => {
    const at = sql.lastIndexOf("ORDER BY");
    return `${sql.slice(0, at)}AND ${alias}.user_id IN (${list}) ${sql.slice(at)}`;
  };
  return (sql) => {
    if (sql.includes("LEFT JOIN delivery_tokens k ON k.search_id = s.id")) return narrow(sql, "s");
    if (sql === WATCH_DUE_SQL) return narrow(sql, "m");
    return sql;
  };
}

const CLAIM_PART = "UPDATE saved_searches SET last_delivered_at = ? WHERE id = ? AND deliver IN ('daily', 'weekly')";

// -- the accounts --------------------------------------------------------------------------------------

let seq = 0;
const nextId = () => (0xf1000000 + ++seq).toString(16).padStart(32, "0");
const createdAt = () => new Date(Date.UTC(2001, 0, 1) + ++seq * 1000).toISOString();
type User = { id: string; email: string };

async function proUser(): Promise<User> {
  const id = nextId();
  const email = newEmail("rgf");
  await ACCOUNTS.batch([
    ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active', 'pro')").bind(id, email),
    ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) " +
      "VALUES (?, ?, 'pro', 'manual', '2026-01-01T00:00:00.000Z', NULL, 'test', '2026-01-01T00:00:00.000Z')",
    ).bind(nextId(), id),
  ]);
  return { id, email };
}

const lastDay = (day: string) => `${addDays(day, -1)}T16:00:00.000Z`;

// n tender searches that all match the day's notice, each its own filter.
async function searches(userId: string, n: number, day: string): Promise<string[]> {
  const ids = Array.from({ length: n }, () => nextId());
  await ACCOUNTS.batch(ids.map((id, i) => ACCOUNTS.prepare(
    "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, last_delivered_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, ?, 'daily')",
  ).bind(id, userId, `/tenders?segment=72&x=${i}`, `Saved /tenders?segment=72&x=${i}`, createdAt(), lastDay(day))));
  return ids;
}

const rowsOf = async (id: string) =>
  (await ACCOUNTS.prepare("SELECT status FROM deliveries WHERE saved_search_id = ? ORDER BY id").bind(id).all<{ status: string }>()).results?.map((r) => r.status) ?? [];
const lastOf = async (id: string) =>
  (await ACCOUNTS.prepare("SELECT last_delivered_at FROM saved_searches WHERE id = ?").bind(id).first<{ last_delivered_at: string | null }>())?.last_delivered_at;

// Turned off between the run's read and its claims, as a stop link clicked then would.
function stopBeforeClaims(ids: readonly string[]): (sqls: string[]) => Promise<void> {
  let done = false;
  return async (sqls) => {
    if (done || !sqls.some((s) => s.includes(CLAIM_PART))) return;
    done = true;
    for (const id of ids) await ACCOUNTS.prepare("UPDATE saved_searches SET deliver = 'off' WHERE id = ?").bind(id).run();
  };
}

// -- the mail and the run -----------------------------------------------------------------------------------

type Handed = { to: string; subject: string; text?: string; headers?: Record<string, string> };

function fakeMail(refuse: (m: Handed, n: number) => string | undefined = () => undefined) {
  const handed: Handed[] = [];
  let tries = 0;
  const binding = {
    async send(m: Handed) {
      const code = refuse(m, ++tries);
      if (code) throw Object.assign(new Error("refused"), { code });
      handed.push(m);
      return { messageId: "<f@awardwatch.ca>" };
    },
  } as unknown as SendEmail;
  return { handed, binding };
}

function tender(reference: string, day: string): TenderRow {
  return {
    reference, amendment: 0, title_en: `Notice ${reference}`, title_fr: `Avis ${reference}`, buyer_id: "dfo-mpo",
    buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada", published: day, closing: `${addDays(day, 30)}T14:00:00`,
    category: ["SRV"], notice_type_en: "Request for Proposal", notice_type_fr: "Demande de propositions", method_en: null, method_fr: null,
    segments: ["72"], provinces: ["BC"], first_seen: day, status: "open",
  };
}

function files(day: string): Record<string, unknown> {
  const out: Record<string, unknown> = { "stats.json": { ...stats, data_as_of: day } };
  for (let i = 0; i <= 8; i++) out[`tenders/new/${addDays(day, -i)}.json`] = i === 0 ? [tender(`cb-772-${day.replace(/-/g, "")}`, day)] : [];
  return out;
}

async function run(o: { mail: SendEmail; day: string; hour: number; users: string[]; before?: (sqls: string[]) => Promise<void>; extra?: Record<string, unknown> }): Promise<RunReport> {
  const before = async (sqls: string[]) => o.before?.(sqls);
  return runDeliveries(onEnv({
    ACCOUNTS: hooked(ACCOUNTS, { rewrite: scope(o.users), before }), ASSETS: makeFakeAssets({}, files(o.day)), MAIL: o.mail, MAIL_FROM: FROM,
    MAIL_SENDER: undefined, NOW: `${o.day}T${String(o.hour).padStart(2, "0")}:00:00Z`, ...o.extra,
  }) as never);
}

const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
// A single search's message names its own stop link in List-Unsubscribe; a grouped one the account's (g=).
const single = (m: Handed) => /\/account\/stop\?s=[0-9a-f]{32}&t=[0-9a-f]{32}>$/.test(m.headers?.["List-Unsubscribe"] ?? "");

// =========================================================================================
// 2. A group that its claims leave at five or fewer
// =========================================================================================

describe("a group that its claims leave at five or fewer searches", () => {
  it("left with one, goes as that search's own message", async () => {
    const day = "2032-01-05";
    const q = await proUser();
    const ids = await searches(q.id, 6, day);
    const mail = fakeMail();
    const report = await run({ mail: mail.binding, day, hour: 15, users: [q.id], before: stopBeforeClaims(ids.slice(1)) });
    expect(mail.handed).toHaveLength(1);
    expect(single(mail.handed[0])).toBe(true);
    expect(mail.handed[0].subject.startsWith("1 new tender notice")).toBe(true);
    expect(report).toMatchObject({ sent: 1, groups: 0, grouped: 0 });
    expect(await rowsOf(ids[0])).toEqual(["sent"]);
    for (const id of ids.slice(1)) expect(await rowsOf(id)).toEqual([]);
  });

  it("left with five, goes as five messages, each its own", async () => {
    const day = "2032-01-12";
    const q = await proUser();
    const ids = await searches(q.id, 6, day);
    const mail = fakeMail();
    const report = await run({ mail: mail.binding, day, hour: 15, users: [q.id], before: stopBeforeClaims([ids[2]]) });
    expect(mail.handed).toHaveLength(5);
    expect(mail.handed.every(single)).toBe(true);
    expect(report).toMatchObject({ outcome: "done", sent: 5, groups: 0 });
    for (const [k, id] of ids.entries()) expect(await rowsOf(id), `search ${k}`).toEqual(k === 2 ? [] : ["sent"]);
  });

  it("gives the claims not yet sent back when the day's ceiling stops the run, and sends them later, none twice", async () => {
    const day = "2032-01-19";
    const q = await proUser();
    const ids = await searches(q.id, 7, day);
    const mail = fakeMail();
    const first = await run({
      mail: mail.binding, day, hour: 15, users: [q.id], before: stopBeforeClaims(ids.slice(5)), extra: { MAIL_DAILY_QUOTA: "3", MAIL_DAILY_RESERVE: "1" },
    });
    expect(mail.handed).toHaveLength(2);
    expect(first).toMatchObject({ outcome: "limited", sent: 2, left: 3 });
    for (const id of ids.slice(0, 2)) expect(await rowsOf(id)).toEqual(["sent"]);
    // The three not sent: their claims given back, no row.
    for (const id of ids.slice(2, 5)) {
      expect(await rowsOf(id)).toEqual([]);
      expect(await lastOf(id)).toBe(lastDay(day));
    }
    const second = await run({ mail: mail.binding, day, hour: 16, users: [q.id], extra: { MAIL_DAILY_QUOTA: "10", MAIL_DAILY_RESERVE: "1" } });
    expect(second).toMatchObject({ outcome: "done", sent: 3 });
    for (const id of ids.slice(0, 5)) expect(await rowsOf(id)).toEqual(["sent"]);
    expect(mail.handed).toHaveLength(5);
  });

  it("gives back the one a sending limit refused and the rest, and stops the run", async () => {
    const day = "2032-01-26";
    const q = await proUser();
    const ids = await searches(q.id, 6, day);
    const mail = fakeMail((_m, n) => (n === 2 ? "E_DAILY_LIMIT_EXCEEDED" : undefined));
    const report = await run({ mail: mail.binding, day, hour: 15, users: [q.id], before: stopBeforeClaims([ids[5]]) });
    expect(mail.handed).toHaveLength(1);
    expect(report).toMatchObject({ outcome: "limited", sent: 1, failed: 0, left: 4 });
    expect(await rowsOf(ids[0])).toEqual(["sent"]);
    expect(await lastOf(ids[0])).toBe(at(day, 15));
    for (const id of ids.slice(1, 5)) {
      expect(await rowsOf(id)).toEqual([]);
      expect(await lastOf(id)).toBe(lastDay(day));
    }
  });
});

// =========================================================================================
// 3. No dictionary line that nothing reads and that compares two plans
// =========================================================================================

describe("the dictionary", () => {
  it("holds no line comparing Pro's saved searches with the Free plan's (billing.pro_searches, read by nothing)", () => {
    expect(Object.keys(ACCOUNT_STRINGS)).not.toContain("billing.pro_searches");
  });
});
