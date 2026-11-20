// Briefings and saved views by email grouped per account, as the saved searches are (docs/mail.md, docs/accounts.md):
// more than GROUP_OVER of an account's briefings with something to send in one run go as one message, and the same
// for its saved views; five or fewer go as they always went, each its own message.
//
// The first block holds a run of five or fewer of each kind to what main sent before this change
// (test/mail-group-today.ts, captured by running these same fixtures on main at 00301e1, never rebuilt from the code
// under test): every statement on the accounts and the records databases in order, and every message byte for byte
// (each stop link's secret taken out, since a secret made at the run is random).
//
// The blocks after it hold the grouped runs (claims, rows, the account's language, the labels, the stop links, the
// allowance before the grouping, the ceiling and the refusals), and a part that faults after it sent: every message it
// sent before the fault is in the run's row, in what a later run of the day reads, and in the room the next part gets.
import { env as testBindings } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_SECRETS_SQL as BRIEFING_SECRETS_SQL, GROUP_STOP_SQL as BRIEFING_GROUP_STOP_SQL } from "../src/account/briefings";
import { ACCOUNT_LANG_SQL, DAY_SENT_SQL, GROUP_OVER, GROUP_QUERIES, type RunReport, runDeliveries } from "../src/account/deliveries";
import { VIEW_GROUP_STOP_SQL } from "../src/account/saved_views";
import { GROUP_SECRETS_SQL as VIEW_SECRETS_SQL } from "../src/account/view_mail";
import { segmentShort, t } from "../src/i18n";
import { app } from "../src/index";
import { orgNumber } from "../src/records_db";
import { ACCOUNTS, PRO_SALE, ULTRA_VARS, decode, nbsp, nextIp, onEnv, useAccountsDb } from "./accounts-helpers";
import { makeFakeAssets } from "./assets";
import stats from "./fixtures/stats.json";
import { SAMPLE_ADDRESS, fakeMail, type Handed } from "./mail-fixtures";
import { RUN, RUN_MESSAGES, SIX_MESSAGES, STATEMENTS } from "./mail-group-today";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (testBindings as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (testBindings as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
// A Monday, the first of its month: the briefings, the weekly email and the weekly and monthly views are all due.
const DAY = "2026-11-02";
const SITE = "https://awardwatch.ca";
const FROM = "alerts@awardwatch.ca";
const ORG = "org-a000000001";
const DND = 3;

const pad = (n: number) => String(n).padStart(2, "0");
const hexOf = (tag: number, n: number) => `${tag.toString(16).padStart(8, "0")}${n.toString(16).padStart(24, "0")}`;
// A time in January 2026: each kind of item its own day, each item its minute and second.
const at = (day: number, minute: number, second = 0) => `2026-01-${pad(day)}T00:${pad(minute)}:${pad(second)}.000Z`;
const secretOf = (tag: number, n: number) => hexOf(tag + 0x5ec, n);

let quiet: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  quiet = (["log", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  for (const q of quiet) q.mockRestore();
});

// -- the records database at the data date ---------------------------------------------------------------

// The segments with a new notice in the week (one each, at National Defence), and the one with none.
const BUSY = ["81", "43", "72", "46", "25", "30", "31", "32", "39", "40", "41", "42"];
const QUIET_SEGMENT = "10";

async function insert(db: D1Database, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 50) {
    await db.batch(rows.slice(i, i + 50).map((r) => {
      const cols = Object.keys(r);
      return db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => r[c] ?? null));
    }));
  }
}

const ev = (r: Record<string, unknown>) => ({
  day: "2026-11-01", src: null, oid: null, buyer: null, sid: 81, cents: null, ocents: null, endd: null, oendd: null, closing: null, title: null,
  title_fr: null, other: null, more: null, ...r,
});

async function seedRecords(): Promise<void> {
  await applySql(RECORDS, RECORDS_SCHEMA);
  await RECORDS.batch(["rec_events", "rec_meta", "rec_expiring", "rec_due", "records", "rec_details", "rec_buyers", "rec_orgs", "rec_instruments",
    "rec_buyer_quarters", "rec_segment_years"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(DAY).run();
  await insert(RECORDS, "rec_buyers", [{ bid: DND, id: "dnd-mdn", name_en: "National Defence", name_fr: "Défense nationale" }]);
  await insert(RECORDS, "rec_orgs", [{ oid: orgNumber(ORG), name: "Exemplar Works Ltd." }]);
  let k = 0;
  await insert(RECORDS, "rec_events", [
    ...BUSY.map((s) => ev({
      k: ++k, kind: "notice", src: 5, sid: Number(s), buyer: "dnd-mdn", closing: "2026-11-20T14:00:00", title: `Survey services ${s}`,
      title_fr: `Services de levé ${s}`, ref: `tender:cb-${s}-1`, path: `/tenders/cb-${s}-1`,
    })),
    // An award to the organization a watch follows, and one whose supplier is a person, withheld (no organization).
    ev({ k: ++k, day: DAY, kind: "award", src: 1, oid: orgNumber(ORG), buyer: "dnd-mdn", cents: 420_000_000, title: "Engineering support",
      title_fr: "Soutien en ingénierie", ref: "award:w8486-1", path: "/awards/w8486-1" }),
    ev({ k: ++k, day: DAY, kind: "award", src: 1, buyer: "dnd-mdn", cents: 9_000_000, title: "Interpretation services", ref: "award:w8486-2",
      path: "/awards/w8486-2" }),
  ]);
  // The views' records at National Defence, award notices over three fiscal years, one whose supplier is withheld.
  const records = [
    { k: 1, src: 1, fy: 2026, fq: 2, bid: DND, oid: orgNumber(ORG), sid: 81, cents: 30_000_000, ref: "w8486-260001", title: "Hydrographic survey" },
    { k: 2, src: 1, fy: 2026, fq: 1, bid: DND, oid: null, sid: 81, cents: 12_000_000, ref: "w8486-260002", title: "Translation" },
    { k: 3, src: 1, fy: 2025, fq: 3, bid: DND, oid: orgNumber(ORG), sid: 43, cents: 50_000_000, ref: "w8486-250001", title: "Network services" },
    { k: 4, src: 1, fy: 2024, fq: 4, bid: DND, oid: orgNumber(ORG), sid: 72, cents: 7_000_000, ref: "w8486-240001", title: "Roof repair" },
  ];
  await insert(RECORDS, "records", records.map((r) => ({ ...r, extra: 0, vnote: 0, comp: 1 })));
  await RECORDS.batch([
    RECORDS.prepare("INSERT INTO rec_buyer_quarters (bid, src, fy, fq, n, cents, n_no_value) SELECT bid, src, fy, fq, COUNT(*), SUM(cents), 0 FROM records GROUP BY bid, src, fy, fq"),
    RECORDS.prepare("INSERT INTO rec_segment_years (sid, src, fy, n, cents, n_no_value, n_buyers, n_orgs, n_pos) SELECT sid, src, fy, COUNT(*), " +
      "SUM(cents), 0, COUNT(DISTINCT bid), COUNT(DISTINCT oid), COUNT(*) FROM records WHERE sid IS NOT NULL GROUP BY sid, src, fy"),
  ]);
}

beforeAll(seedRecords);

// -- the accounts, at fixed ids and times --------------------------------------------------------------

type Fixed = { id: string; email: string };

async function account(tag: number, email: string, plan: "free" | "pro" | "ultra", lang: "en" | "fr"): Promise<Fixed> {
  const id = hexOf(tag, 0);
  const stmts = [
    ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, ?, 'active', ?)")
      .bind(id, email, at(1, 0), lang, plan === "free" ? "free" : "pro"),
  ];
  if (plan !== "free") {
    const e = hexOf(tag, 1);
    stmts.push(ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'manual', ?, NULL, 'test', ?)",
    ).bind(e, id, at(1, 0), at(1, 0)));
    if (plan === "ultra") stmts.push(ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(e));
  }
  await ACCOUNTS.batch(stmts);
  return { id, email };
}

// n daily tender searches, each matching the data date's notice; the ones in `secrets` carry their stop secret already.
async function searches(tag: number, user: string, n: number, lang: "en" | "fr", secrets: (i: number) => boolean): Promise<string[]> {
  const ids = Array.from({ length: n }, (_, i) => hexOf(tag, 0x100 + i));
  await ACCOUNTS.batch(ids.flatMap((id, i) => [
    ACCOUNTS.prepare("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, ?, ?, 'daily')")
      .bind(id, user, `/tenders?segment=72&n=${i}`, lang === "fr" ? `Avis du segment 72 (${i + 1})` : `Notices in segment 72 (${i + 1})`, lang, at(2, 0, i)),
    ...(secrets(i) ? [ACCOUNTS.prepare("INSERT INTO delivery_tokens (search_id, secret, created_at) VALUES (?, ?, ?)").bind(id, secretOf(tag, 0x100 + i), at(2, 0, i))] : []),
  ]));
  return ids;
}

// A briefing of a segment ("81") or of a buyer ("buyer:dnd-mdn"), made at `made`, with its stop secret when `secret`.
type BriefingFix = { subject: string; made: string; secret: boolean; lang?: "en" | "fr" };
async function briefings(tag: number, user: string, list: readonly BriefingFix[], lang: "en" | "fr"): Promise<string[]> {
  const ids = list.map((_, i) => hexOf(tag, 0x200 + i));
  await ACCOUNTS.batch(list.map((b, i) => {
    const buyer = b.subject.startsWith("buyer:");
    const subject = buyer ? b.subject.slice(6) : b.subject;
    const l = b.lang ?? lang;
    const label = buyer ? (l === "fr" ? "Défense nationale" : "National Defence") : l === "fr" ? `Bulletin du segment ${subject}` : `Segment ${subject} briefing`;
    return ACCOUNTS.prepare(
      "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver, secret) VALUES (?, ?, ?, ?, '', ?, ?, ?, 'weekly', ?)",
    ).bind(ids[i], user, buyer ? "buyer" : "segment", subject, label, l, b.made, b.secret ? secretOf(tag, 0x200 + i) : null);
  }));
  return ids;
}

// A saved view of National Defence's award notices over `years` fiscal years (a buyer's view), or of the organization or a
// segment, weekly or monthly, made at `made`.
type ViewFix = { kind: "buyer" | "organization" | "segment" | "gone"; years: number; deliver: "weekly" | "monthly"; made: string; secret: boolean };
async function views(tag: number, user: string, list: readonly ViewFix[], lang: "en" | "fr"): Promise<string[]> {
  const ids = list.map((_, i) => hexOf(tag, 0x400 + i));
  await ACCOUNTS.batch(list.map((v, i) => {
    const address = v.kind === "buyer" ? `/buyers/dnd-mdn/analytics?source=awards&years=${v.years}`
      : v.kind === "organization" ? `/organizations/${ORG}/analytics?source=awards&years=${v.years}`
      : v.kind === "segment" ? `/segments/81/analytics?source=awards&years=${v.years}`
      : "/nothing-reads-this";
    const name = lang === "fr" ? `Vue ${i + 1} de la Défense` : `Defence view ${i + 1}`;
    return ACCOUNTS.prepare(
      "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at, secret) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(ids[i], user, v.kind === "gone" ? "buyer" : v.kind, address, name, lang, v.deliver, v.made, v.secret ? secretOf(tag, 0x400 + i) : null);
  }));
  return ids;
}

// The account's watch of the organization (an award on the data date), its watch mail on, and its weekly email on.
async function watchAndWeekly(tag: number, user: string): Promise<void> {
  await ACCOUNTS.batch([
    ACCOUNTS.prepare(
      "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'organization', ?, '', 'Exemplar Works Ltd.', 'award,amended', 'daily', ?, ?)",
    ).bind(hexOf(tag, 0x300), user, ORG, at(4, 0), "2026-11-01"),
    ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, secret, created_at) VALUES (?, 'on', ?, ?)").bind(user, secretOf(tag, 0x300), at(4, 0)),
    ACCOUNTS.prepare("INSERT INTO weekly_mail (user_id, mail, via, on_at, secret, created_at) VALUES (?, 'on', 'account', ?, ?, ?)")
      .bind(user, at(5, 0), secretOf(tag, 0x301), at(5, 0)),
  ]);
}

// The account's watch of the organization with its watch mail on, alone; and its weekly email on, alone.
const watchMail = (tag: number, user: string) => ACCOUNTS.batch([
  ACCOUNTS.prepare(
    "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'organization', ?, '', 'Exemplar Works Ltd.', 'award,amended', 'daily', ?, ?)",
  ).bind(hexOf(tag, 0x300), user, ORG, at(4, 0), "2026-11-01"),
  ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, secret, created_at) VALUES (?, 'on', ?, ?)").bind(user, secretOf(tag, 0x300), at(4, 0)),
]);
const weeklyMail = (tag: number, user: string) =>
  ACCOUNTS.prepare("INSERT INTO weekly_mail (user_id, mail, via, on_at, secret, created_at) VALUES (?, 'on', 'account', ?, ?, ?)")
    .bind(user, at(5, 0), secretOf(tag, 0x301), at(5, 0)).run();

// Every earlier fixture's mail turned off, so a run reads only what a test builds after it.
async function quietAll(): Promise<void> {
  await ACCOUNTS.batch([
    ACCOUNTS.prepare("UPDATE saved_searches SET deliver = 'off'"), ACCOUNTS.prepare("UPDATE briefings SET deliver = 'off'"),
    ACCOUNTS.prepare("UPDATE saved_views SET deliver = 'off'"), ACCOUNTS.prepare("UPDATE watch_mail SET mail = 'off'"),
    ACCOUNTS.prepare("UPDATE weekly_mail SET mail = 'off'"),
  ]);
}

// -- the run, every statement written down ------------------------------------------------------------------

// A binding with every statement prepared on it written down, in order, under the database's letter.
function recording(real: D1Database, letter: string, sent: string[]): D1Database {
  const native = new WeakMap<object, D1PreparedStatement>();
  return new Proxy(real, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          sent.push(`${letter} ${sql}`);
          const stmt = target.prepare(sql);
          const wrapped = new Proxy(stmt, {
            get(s, p) {
              const v = Reflect.get(s, p);
              return typeof v === "function" ? v.bind(s) : v;
            },
          });
          native.set(wrapped, stmt);
          return wrapped;
        };
      }
      if (prop === "batch") return (stmts: D1PreparedStatement[]) => target.batch(stmts.map((s) => native.get(s) ?? s));
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  }) as D1Database;
}

// The published files of the week to the data date: the day's one new notice (segment 72), the others empty.
function files(): Record<string, unknown> {
  const out: Record<string, unknown> = { "stats.json": { ...stats, data_as_of: DAY } };
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.parse(DAY) - i * 86_400_000).toISOString().slice(0, 10);
    out[`tenders/new/${day}.json`] = i === 0 ? [{
      reference: "cb-772-20261102", amendment: 0, title_en: "Facility maintenance", title_fr: "Entretien des installations", buyer_id: "dfo-mpo",
      buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada", published: DAY, closing: "2026-12-02T14:00:00", category: ["SRV"],
      notice_type_en: "Request for Proposal", notice_type_fr: "Demande de propositions", method_en: null, method_fr: null, segments: ["72"],
      provinces: ["BC"], first_seen: DAY, status: "open",
    }] : [];
  }
  return out;
}

type Mail = { binding: SendEmail; handed: Handed[] };
type RunOut = { sent: string[]; mail: Mail; report: RunReport };

// One run at the data date, 16:00 UTC; extra replaces any binding (a hooked accounts database, the ceiling's figures).
async function runOn(extra: Record<string, unknown> = {}, mail: Mail = fakeMail()): Promise<RunOut> {
  const sent: string[] = [];
  const report = await runDeliveries(onEnv({
    ...PRO_SALE, ...ULTRA_VARS, ACCOUNTS: recording(ACCOUNTS, "A", sent), RECORDS: recording(RECORDS, "R", sent), ASSETS: makeFakeAssets({}, files()),
    MAIL: mail.binding, MAIL_FROM: FROM, MAIL_SENDER: undefined, SITE_URL: SITE, NOW: `${DAY}T16:00:00Z`, MAIL_ADDRESS: SAMPLE_ADDRESS, ...extra,
  }) as never);
  return { sent, mail, report };
}

// A message as compared: what the binding was handed, each 32-hex stop secret taken out.
const steady = (m: Handed) => JSON.stringify({ to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers })
  .replace(/(t=)[0-9a-f]{32}/g, "$1SECRET");

async function sha(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const hashes = (handed: readonly Handed[]) => Promise.all(handed.map((m) => sha(steady(m))));

// =====================================================================================

describe("five or fewer of a kind", () => {
  it("sends every statement main sent, in the same order, and the same messages byte for byte", { timeout: 60_000 }, async () => {
    // A: Pro, two saved searches, a segment briefing and a buyer's, a watch and the weekly email.
    const a = await account(0xa1, "mg-a@example.com", "pro", "en");
    await searches(0xa1, a.id, 2, "en", (i) => i === 0);
    await briefings(0xa1, a.id, [{ subject: "81", made: at(3, 0, 0), secret: true }, { subject: "buyer:dnd-mdn", made: at(3, 0, 1), secret: false }], "en");
    await watchAndWeekly(0xa1, a.id);
    // B: Ultra in French, seven saved searches (grouped, as they always were), five briefings and five views with news, each
    // list made in turns with C's, so the run's lists hold the two accounts' items in turn.
    const b = await account(0xb1, "mg-b@example.com", "ultra", "fr");
    await searches(0xb1, b.id, 7, "en", () => true);
    await briefings(0xb1, b.id, ["43", "72", "46", "25", "30"].map((s, i) => ({ subject: s, made: at(3, 1, 2 * i), secret: i !== 2 })), "fr");
    await views(0xb1, b.id, [1, 2, 3, 4, 5].map((y, i) => ({ kind: "buyer" as const, years: y, deliver: i < 3 ? "weekly" as const : "monthly" as const,
      made: at(6, 1, 2 * i), secret: i !== 1 })), "fr");
    // C: Ultra, three briefings (one with nothing new) and two views, an organization's and a segment's.
    const c = await account(0xc1, "mg-c@example.com", "ultra", "en");
    await briefings(0xc1, c.id, [
      { subject: "81", made: at(3, 1, 1), secret: true }, { subject: QUIET_SEGMENT, made: at(3, 1, 3), secret: true },
      { subject: "buyer:dnd-mdn", made: at(3, 1, 5), secret: true },
    ], "en");
    await views(0xc1, c.id, [
      { kind: "organization", years: 2, deliver: "weekly", made: at(6, 1, 1), secret: true },
      { kind: "segment", years: 3, deliver: "weekly", made: at(6, 1, 3), secret: false },
    ], "en");
    // D: Free, a search and a briefing, each passed over.
    const d = await account(0xd1, "mg-d@example.com", "free", "en");
    await searches(0xd1, d.id, 1, "en", () => false);
    await briefings(0xd1, d.id, [{ subject: "81", made: at(3, 2, 0), secret: false }], "en");

    const { sent, mail } = await runOn();
    expect(sent).toEqual(RUN.map((i) => STATEMENTS[i]));
    expect(await hashes(mail.handed)).toEqual(RUN_MESSAGES);
  });

  it("with six due and five to send, of each kind, sends the five messages main sent, byte for byte", { timeout: 60_000 }, async () => {
    await quietAll();
    const e = await account(0xe1, "mg-e@example.com", "ultra", "en");
    // Six briefings, the fourth with nothing new; six views, the fifth at an address no view reads any more.
    await briefings(0xe1, e.id, ["81", "43", "72", QUIET_SEGMENT, "46", "25"].map((s, i) => ({ subject: s, made: at(3, 3, i), secret: true })), "en");
    await views(0xe1, e.id, [1, 2, 3, 4, 0, 5].map((y, i) => ({ kind: y ? "buyer" as const : "gone" as const, years: y || 1, deliver: "weekly" as const,
      made: at(6, 3, i), secret: true })), "en");
    const { mail } = await runOn();
    expect(await hashes(mail.handed)).toEqual(SIX_MESSAGES);
  });
});

// =====================================================================================
// The accounts database, hooked: every statement a run executes (alone, or a batch's) seen before it runs, which may
// throw as D1 would; each execution one entry of its statements' texts.

type Hook = (sqls: string[]) => void;

class Stmt {
  constructor(readonly sql: string, readonly inner: D1PreparedStatement, readonly hook: Hook) {}
  bind(...values: unknown[]) {
    return new Stmt(this.sql, this.inner.bind(...values), this.hook);
  }
  async first(column?: string) {
    this.hook([this.sql]);
    return column === undefined ? this.inner.first() : this.inner.first(column);
  }
  async run() {
    this.hook([this.sql]);
    return this.inner.run();
  }
  async all() {
    this.hook([this.sql]);
    return this.inner.all();
  }
  async raw(o?: { columnNames?: boolean }) {
    this.hook([this.sql]);
    return this.inner.raw(o as never);
  }
}

function hooked(real: D1Database, hook: Hook): D1Database {
  return {
    prepare: (q: string) => new Stmt(q, real.prepare(q), hook),
    batch: async (stmts: Stmt[]) => {
      hook(stmts.map((s) => s.sql));
      return real.batch(stmts.map((s) => s.inner));
    },
    exec: (q: string) => real.exec(q),
  } as unknown as D1Database;
}

// A stand-in for the MAIL binding: refuse names the error code for a message, or nothing to take it.
function mailer(refuse: (m: Handed) => string | undefined = () => undefined) {
  const handed: Handed[] = [];
  const sent: Handed[] = [];
  const binding = {
    async send(m: Handed) {
      handed.push(m);
      const code = refuse(m);
      if (code) throw Object.assign(new Error("refused"), { code });
      sent.push(m);
      return { messageId: "<g@awardwatch.ca>" };
    },
  } as unknown as SendEmail;
  return { handed, sent, binding, to: (email: string) => sent.filter((m) => m.to === email) };
}

const NOW_AT = `${DAY}T16:00:00.000Z`;
const one = <T>(sql: string, ...binds: unknown[]) => ACCOUNTS.prepare(sql).bind(...binds).first<T>();
const rowsOf = async <T>(sql: string, ...binds: unknown[]) => (await ACCOUNTS.prepare(sql).bind(...binds).all<T>()).results ?? [];
// The UTC day's sends as a later run of the day reads them (deliveries.ts DAY_SENT_SQL), and the run log's last row.
const daySent = async () => (await one<{ n: number }>(DAY_SENT_SQL, `${DAY}T00:00:00.000Z`, "2026-11-03T00:00:00.000Z"))!.n;
const lastRun = () => one<{ outcome: string; sent: number; failed: number }>("SELECT outcome, sent, failed FROM delivery_runs ORDER BY id DESC LIMIT 1");
// The day's ceiling set so the run may still send `room` messages (env.ts mailCeiling: the quota less the reserve).
const ceilingFor = async (room: number) => ({ MAIL_DAILY_QUOTA: String((await daySent()) + room + 40), MAIL_DAILY_RESERVE: "40" });
const stopLinkOf = (m: Handed, param: string) => new RegExp(`<(https:[^>]*\\/account\\/stop\\?${param}=[^>]*)>$`).exec(m.headers?.["List-Unsubscribe"] ?? "")?.[1] ?? null;
const pathOf = (link: string) => {
  const u = new URL(link);
  return `${u.pathname}${u.search}`;
};
const oneClick = (path: string) => app.request(path, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp() }, body: "List-Unsubscribe=One-Click",
}, onEnv());
const headings = (html = "") => [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((x) => nbsp(decode(x[1])));
// The executions from the one whose every statement starts with `first` (n of them) to the one with n statements
// starting with `last`, both counted: the queries a grouped message made from its claims to its last write.
function span(log: readonly string[][], n: number, first: string, last: string): number {
  const from = log.findIndex((e) => e.length === n && e.every((s) => s.startsWith(first)));
  const to = log.findIndex((e, k) => k > from && e.filter((s) => s.startsWith(last)).length === n);
  expect(from, first).toBeGreaterThanOrEqual(0);
  expect(to, last).toBeGreaterThan(from);
  return to - from + 1;
}

// =====================================================================================

describe("an account's briefings, more than five with something to send", () => {
  it("go as one message in the account's language, each claimed, recorded and named with its own stop link, counted once", { timeout: 60_000 }, async () => {
    await quietAll();
    // G: Ultra, French, its briefings saved from English pages: six segments and a buyer with news, a segment with none.
    const g = await account(0xf1, "mg-g@example.com", "ultra", "fr");
    const subjects = ["81", "43", "72", QUIET_SEGMENT, "46", "buyer:dnd-mdn", "25", "30"];
    const ids = await briefings(0xf1, g.id, subjects.map((s, i) => ({ subject: s, made: at(7, 0, 2 * i), secret: i % 2 === 0 })), "en");
    // H: two briefings with news, made among G's: each its own message, as before.
    const h = await account(0xf2, "mg-h@example.com", "ultra", "en");
    const hIds = await briefings(0xf2, h.id, [{ subject: "81", made: at(7, 0, 3), secret: true }, { subject: "43", made: at(7, 0, 9), secret: true }], "en");
    const log: string[][] = [];
    const mail = mailer();
    const before = await daySent();
    const { report } = await runOn({ ACCOUNTS: hooked(ACCOUNTS, (sqls) => log.push(sqls)) }, mail);

    // One message to G, two to H; three against the run's count and the day's.
    expect(mail.to(g.email)).toHaveLength(1);
    expect(mail.to(h.email)).toHaveLength(2);
    expect(report.briefing).toMatchObject({ sent: 3, failed: 0, groups: 1, grouped: 7, empty: 1 });
    expect(await lastRun()).toEqual({ outcome: "done", sent: 3, failed: 0 });
    expect((await daySent()) - before).toBe(3);
    const [m] = mail.to(g.email);
    // The account's language (users.lang), the sections in the account's order, each name as its rule gives it: a
    // segment's written again in French, the buyer's as saved.
    expect(m.subject).toBe(t("fr", "briefing.group_subject", { n: 7, date: DAY }));
    expect(m.html).toMatch(/<html lang="fr"/);
    const named = subjects.filter((s) => s !== QUIET_SEGMENT).map((s) => (s.startsWith("buyer:") ? "National Defence" : `${s} ${segmentShort("fr", s)}`));
    expect(headings(m.html)).toEqual(named.map(nbsp));
    // Every briefing it carried: claimed for the week, its sent row, its stop secret, its own stop link; the empty one its empty row.
    const after = await rowsOf<{ id: string; last: string; secret: string | null; rows: string }>(
      "SELECT b.id, b.last_delivered_at AS last, b.secret, (SELECT group_concat(status) FROM briefing_deliveries d WHERE d.briefing_id = b.id) AS rows " +
      "FROM briefings b WHERE b.user_id = ? ORDER BY b.created_at, b.id", g.id);
    for (const [k, r] of after.entries()) {
      expect(r.last, subjects[k]).toBe(NOW_AT);
      if (subjects[k] === QUIET_SEGMENT) {
        expect(r.rows).toBe("empty");
        expect(m.text).not.toContain(r.id);
        continue;
      }
      expect(r.rows, subjects[k]).toBe("sent");
      expect(r.secret).toMatch(/^[0-9a-f]{32}$/);
      expect(m.text).toContain(`${SITE}/account/stop?b=${r.id}&t=${r.secret}&lang=fr`);
    }
    expect(after.map((r) => r.id)).toEqual(ids);
    // From its claims to its last write, within GROUP_QUERIES: the claims, the secrets with the language, the rows.
    expect(span(log, 7, "UPDATE briefings SET last_delivered_at = ?1", "INSERT INTO briefing_deliveries")).toBeLessThanOrEqual(GROUP_QUERIES);
    // H's two are their own messages, as before grouping.
    for (const x of mail.to(h.email)) expect(x.headers?.["List-Unsubscribe"]).toMatch(new RegExp(`stop\\?b=(?:${hIds.join("|")})&t=`));

    // The message's own stop link: its page names the seven, a changed tag matches nothing, and a mail client's one-click
    // post turns off the email of the seven alone (not the empty one, which the message did not name, nor H's).
    const link = stopLinkOf(m, "gb");
    expect(link).toMatch(new RegExp(`^${SITE}/account/stop\\?gb=${g.id}&t=[A-Za-z0-9_-]{56}&lang=fr$`));
    const page = await app.request(pathOf(link!), { headers: { "cf-connecting-ip": nextIp(), "sec-fetch-mode": "navigate" } }, onEnv());
    expect(page.status).toBe(200);
    const norm = (s: string) => nbsp(decode(s)).replace(/’/g, "'");
    const body = norm(await page.text());
    expect(body).toContain(norm(t("fr", "briefing.stop_group_title")));
    for (const label of named) expect(body).toContain(norm(`<li>${label}</li>`));
    const delivers = async () => (await rowsOf<{ id: string; deliver: string }>(
      "SELECT id, deliver FROM briefings WHERE user_id IN (?, ?) ORDER BY created_at, id", g.id, h.id)).map((r) => [r.id, r.deliver]);
    const start = await delivers();
    // A tag changed matches nothing: the site's 404, and nothing changes.
    const tags = new URL(link!).searchParams.get("t")!;
    const forged = `${tags[0] === "A" ? "B" : "A"}${tags.slice(1, 8)}`;
    expect((await oneClick(pathOf(link!).replace(`t=${tags}`, `t=${forged}`))).status).toBe(404);
    expect(await delivers()).toEqual(start);
    // A link holding the first tag alone turns off the first briefing alone.
    expect((await oneClick(pathOf(link!).replace(`t=${tags}`, `t=${tags.slice(0, 8)}`))).status).toBe(200);
    expect((await delivers()).filter(([, d]) => d === "off").map(([id]) => id)).toEqual([ids[0]]);
    const res = await oneClick(pathOf(link!));
    expect(res.status).toBe(200);
    expect(nbsp(await res.text())).toBe(nbsp(t("fr", "briefing.stopped_group_one_click")));
    const quiet = ids[subjects.indexOf(QUIET_SEGMENT)];
    expect(await delivers()).toEqual(start.map(([id]) => [id, hIds.includes(id) || id === quiet ? "weekly" : "off"]));
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM audit WHERE user_id = ? AND event = 'briefing_stopped' AND detail = 'group_one_click'", g.id))!.n)
      .toBe(2);
  });

  it("are counted to the plan's figure and to a seat's allowance first, then grouped over the ones in service", { timeout: 60_000 }, async () => {
    await quietAll();
    // P: Pro (25 saved searches and briefings) holding 20 searches and 8 briefings: the first 5 briefings in service, each its own message.
    const p = await account(0xf3, "mg-p@example.com", "pro", "en");
    await ACCOUNTS.batch(Array.from({ length: 20 }, (_, i) => ACCOUNTS.prepare(
      "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, 'Off', 'en', ?, 'off')",
    ).bind(hexOf(0xf3, 0x900 + i), p.id, `/tenders?q=off${i}`, at(2, 1, i))));
    const pIds = await briefings(0xf3, p.id, BUSY.slice(0, 8).map((s, i) => ({ subject: s, made: at(7, 1, i), secret: true })), "en");
    // A group: the holder's 93 searches leave its member 7 of the 100, so 7 of the member's 9 briefings go, in one message.
    const holder = await account(0xf4, "mg-holder@example.com", "ultra", "en");
    const member = await account(0xf5, "mg-member@example.com", "free", "en");
    await ACCOUNTS.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").bind(member.id).run();
    await ACCOUNTS.prepare("INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id, joined_at) VALUES (?, ?, 'en', ?, ?, ?, ?)")
      .bind(hexOf(0xf5, 0xfff), holder.id, at(1, 1), "2026-12-31T00:00:00.000Z", member.id, at(1, 2)).run();
    for (let i = 0; i < 93; i += 50) {
      await ACCOUNTS.batch(Array.from({ length: Math.min(50, 93 - i) }, (_, k) => ACCOUNTS.prepare(
        "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, 'Off', 'en', ?, 'off')",
      ).bind(hexOf(0xf4, 0x900 + i + k), holder.id, `/tenders?q=pool${i + k}`, at(2, 2, (i + k) % 60))));
    }
    const mIds = await briefings(0xf5, member.id, BUSY.slice(0, 9).map((s, i) => ({ subject: s, made: at(7, 2, i), secret: true })), "en");
    const mail = mailer();
    const { report } = await runOn({}, mail);
    expect(report.briefing).toMatchObject({ sent: 6, groups: 1, grouped: 7, skipped: 5 });
    // P: five messages of a briefing each; the last three covered for the week with no row.
    const own = mail.to(p.email);
    expect(own).toHaveLength(5);
    for (const [k, x] of own.entries()) expect(x.headers?.["List-Unsubscribe"]).toContain(`stop?b=${pIds[k]}&t=`);
    const pRows = await rowsOf<{ last: string; n: number }>(
      "SELECT b.last_delivered_at AS last, (SELECT COUNT(*) FROM briefing_deliveries d WHERE d.briefing_id = b.id) AS n FROM briefings b WHERE b.user_id = ? ORDER BY b.created_at, b.id",
      p.id);
    expect(pRows.map((r) => r.n)).toEqual([1, 1, 1, 1, 1, 0, 0, 0]);
    expect(pRows.every((r) => r.last === NOW_AT)).toBe(true);
    // The member: one message carrying its first seven by creation; its last two passed over.
    const [grouped] = mail.to(member.email);
    expect(mail.to(member.email)).toHaveLength(1);
    expect(stopLinkOf(grouped, "gb")).toContain(`gb=${member.id}`);
    for (const [k, id] of mIds.entries()) expect((grouped.text ?? "").includes(`stop?b=${id}&`), String(k)).toBe(k < 7);
  });

  it("refused by the mail service, write each one's failed row and give every claim back; a sending limit gives them back alone", { timeout: 60_000 }, async () => {
    await quietAll();
    const r = await account(0xf6, "mg-refused@example.com", "ultra", "en");
    const rIds = await briefings(0xf6, r.id, BUSY.slice(0, 6).map((s, i) => ({ subject: s, made: at(7, 3, i), secret: true })), "en");
    const first = await runOn({}, mailer((m) => (m.to === r.email ? "E_RECIPIENT_SUPPRESSED" : undefined)));
    expect(first.report.briefing).toMatchObject({ sent: 0, failed: 1, groups: 0 });
    expect(await lastRun()).toEqual({ outcome: "done", sent: 0, failed: 1 });
    const rows = await rowsOf<{ last: string | null; rows: string }>(
      "SELECT b.last_delivered_at AS last, (SELECT group_concat(status) FROM briefing_deliveries d WHERE d.briefing_id = b.id) AS rows FROM briefings b WHERE b.user_id = ? ORDER BY b.created_at, b.id",
      r.id);
    expect(rows).toEqual(rIds.map(() => ({ last: null, rows: "failed" })));
    // The next run of the week passes them by: each waits for the next week.
    const again = await runOn({}, mailer());
    expect(again.report.briefing?.sent).toBe(0);
    // A sending limit: the claims given back, no row, and the run stops there.
    await quietAll();
    const l = await account(0xf7, "mg-limited@example.com", "ultra", "en");
    await briefings(0xf7, l.id, BUSY.slice(0, 6).map((s, i) => ({ subject: s, made: at(7, 4, i), secret: true })), "en");
    const limited = await runOn({}, mailer((m) => (m.to === l.email ? "E_DAILY_LIMIT_EXCEEDED" : undefined)));
    expect(limited.report.outcome).toBe("limited");
    expect(await lastRun()).toEqual({ outcome: "limited", sent: 0, failed: 0 });
    expect(await rowsOf("SELECT b.last_delivered_at AS last FROM briefings b WHERE b.user_id = ? AND b.last_delivered_at IS NOT NULL", l.id)).toEqual([]);
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM briefing_deliveries d JOIN briefings b ON b.id = d.briefing_id WHERE b.user_id = ?", l.id))!.n).toBe(0);
  });

  it("count once against the day's ceiling", { timeout: 60_000 }, async () => {
    await quietAll();
    const g = await account(0xf8, "mg-ceiling-g@example.com", "ultra", "en");
    await briefings(0xf8, g.id, BUSY.slice(0, 6).map((s, i) => ({ subject: s, made: at(7, 5, i), secret: true })), "en");
    const k = await account(0xf9, "mg-ceiling-k@example.com", "ultra", "en");
    await briefings(0xf9, k.id, BUSY.slice(6, 8).map((s, i) => ({ subject: s, made: at(7, 6, i), secret: true })), "en");
    // Room for two: the six in one message, then one of K's; the other waits for the next UTC day.
    const mail = mailer();
    const { report } = await runOn(await ceilingFor(2), mail);
    expect(mail.to(g.email)).toHaveLength(1);
    expect(mail.to(k.email)).toHaveLength(1);
    expect(report.outcome).toBe("limited");
    expect(await lastRun()).toMatchObject({ outcome: "limited", sent: 2 });
  });
});

describe("an account's saved views, more than five with new figures", () => {
  it("go as one message in the account's language, each claimed with its row and its hash, named with its own stop link", { timeout: 60_000 }, async () => {
    await quietAll();
    // VG: Ultra, French, seven views of National Defence's awards whose figures are new, and one at an address no view reads.
    const vg = await account(0xe2, "mg-vg@example.com", "ultra", "fr");
    const list = [1, 2, 3, 0, 4, 5, 6, 7];
    const ids = await views(0xe2, vg.id, list.map((y, i) => ({ kind: y ? "buyer" as const : "gone" as const, years: y || 1, deliver: i % 3 ? "weekly" as const : "monthly" as const,
      made: at(8, 0, 2 * i), secret: i % 2 === 0 })), "fr");
    // VH: two views, made among VG's: each its own message.
    const vh = await account(0xe3, "mg-vh@example.com", "ultra", "en");
    const hIds = await views(0xe3, vh.id, [1, 2].map((y, i) => ({ kind: "buyer" as const, years: y, deliver: "weekly" as const, made: at(8, 0, 4 * i + 1), secret: true })), "en");
    const log: string[][] = [];
    const mail = mailer();
    const { report } = await runOn({ ACCOUNTS: hooked(ACCOUNTS, (sqls) => log.push(sqls)) }, mail);
    expect(mail.to(vg.email)).toHaveLength(1);
    expect(mail.to(vh.email)).toHaveLength(2);
    expect(report.views).toMatchObject({ sent: 3, failed: 0, groups: 1, grouped: 7 });
    const [m] = mail.to(vg.email);
    expect(m.subject).toBe(t("fr", "view.group_subject", { n: 7, date: DAY }));
    expect(m.html).toMatch(/<html lang="fr"/);
    expect(headings(m.html)).toEqual(list.flatMap((y, i) => (y ? [`Vue ${i + 1} de la Défense`] : [])));
    // A record whose supplier the records do not name (a person) reads as the view's own message reads it, in French.
    expect(nbsp(m.text ?? "")).toContain(nbsp(t("fr", "briefing.withheld")));
    expect(m.text).not.toContain("undefined");
    const after = await rowsOf<{ id: string; last: string | null; hash: string | null; secret: string | null; rows: string | null }>(
      "SELECT v.id, v.last_delivered_at AS last, v.last_hash AS hash, v.secret, (SELECT group_concat(status) FROM view_deliveries d WHERE d.view_id = v.id) AS rows " +
      "FROM saved_views v WHERE v.user_id = ? ORDER BY v.created_at, v.id", vg.id);
    for (const [k, r] of after.entries()) {
      if (!list[k]) {
        expect(r).toMatchObject({ last: null, hash: null, rows: null });
        continue;
      }
      expect(r).toMatchObject({ last: NOW_AT, rows: "sent" });
      expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(m.text).toContain(`${SITE}/account/stop?v=${r.id}&t=${r.secret}&lang=fr`);
    }
    expect(after.map((r) => r.id)).toEqual(ids);
    expect(span(log, 7, "UPDATE saved_views SET last_delivered_at = ?1", "INSERT INTO view_deliveries")).toBeLessThanOrEqual(GROUP_QUERIES);
    for (const x of mail.to(vh.email)) expect(x.headers?.["List-Unsubscribe"]).toMatch(new RegExp(`stop\\?v=(?:${hIds.join("|")})&t=`));
    // The message's own stop link turns off the email of the seven it named, and nothing else.
    const link = stopLinkOf(m, "gv");
    expect(link).toMatch(new RegExp(`^${SITE}/account/stop\\?gv=${vg.id}&t=[A-Za-z0-9_-]{56}&lang=fr$`));
    const page = await app.request(pathOf(link!), { headers: { "cf-connecting-ip": nextIp(), "sec-fetch-mode": "navigate" } }, onEnv());
    expect(page.status).toBe(200);
    const res = await oneClick(pathOf(link!));
    expect(res.status).toBe(200);
    expect(nbsp(await res.text())).toBe(nbsp(t("fr", "views.stopped_group_one_click")));
    // VG's views turned off but the one the message did not name (index 3, monthly); VH's as they were.
    const now = await rowsOf<{ id: string; deliver: string }>("SELECT id, deliver FROM saved_views WHERE user_id IN (?, ?)", vg.id, vh.id);
    const expected = new Map<string, string>([...ids.map((id, i): [string, string] => [id, list[i] ? "off" : "monthly"]), ...hIds.map((id): [string, string] => [id, "weekly"])]);
    for (const r of now) expect(r.deliver, r.id).toBe(expected.get(r.id));
    expect((await one<{ n: number }>("SELECT COUNT(*) AS n FROM audit WHERE user_id = ? AND event = 'view_stopped' AND detail = 'group_one_click'", vg.id))!.n).toBe(1);
  });

  it("refused by the mail service, write each one's failed row, keep each hash and give every claim back", { timeout: 60_000 }, async () => {
    await quietAll();
    const r = await account(0xe4, "mg-vrefused@example.com", "ultra", "en");
    await views(0xe4, r.id, [1, 2, 3, 4, 5, 6].map((y, i) => ({ kind: "buyer" as const, years: y, deliver: "weekly" as const, made: at(8, 1, i), secret: true })), "en");
    const { report } = await runOn({}, mailer((m) => (m.to === r.email ? "E_RECIPIENT_SUPPRESSED" : undefined)));
    expect(report.views).toMatchObject({ sent: 0, failed: 1 });
    expect(await rowsOf("SELECT v.last_delivered_at AS last, v.last_hash AS hash, (SELECT group_concat(status) FROM view_deliveries d WHERE d.view_id = v.id) AS rows FROM saved_views v WHERE v.user_id = ?", r.id))
      .toEqual(Array.from({ length: 6 }, () => ({ last: null, hash: null, rows: "failed" })));
  });
});

// =====================================================================================

describe("a part that faults after it sent", () => {
  type Case = { name: string; build: (tag: number) => Promise<void>; fail: string };
  const ultra = (tag: number) => account(tag, `mg-fault-${tag.toString(16)}@example.com`, "ultra", "en");
  const CASES: Case[] = [
    { name: "a saved search, at its row", build: async (tag) => void (await searches(tag, (await ultra(tag)).id, 2, "en", () => true)), fail: "INSERT INTO deliveries" },
    { name: "a saved search, at the next one's claim", build: async (tag) => void (await searches(tag, (await ultra(tag)).id, 2, "en", () => true)),
      fail: "UPDATE saved_searches SET last_delivered_at = ? WHERE id = ? AND deliver IN" },
    { name: "a grouped saved-search message, at its rows", build: async (tag) => void (await searches(tag, (await ultra(tag)).id, GROUP_OVER + 1, "en", () => true)),
      fail: "INSERT INTO deliveries" },
    { name: "the watch mail, at its rows", build: async (tag) => {
      await watchMail(tag, (await ultra(tag)).id);
      await watchMail(tag + 1, (await ultra(tag + 1)).id);
    }, fail: "INSERT INTO watch_deliveries" },
    { name: "the watch mail, at the next account's claim", build: async (tag) => {
      await watchMail(tag, (await ultra(tag)).id);
      await watchMail(tag + 1, (await ultra(tag + 1)).id);
    }, fail: "UPDATE watch_mail SET last_day = ?1, last_at = ?2 WHERE user_id = ?3 AND mail" },
    { name: "a briefing, at its row", build: async (tag) => void (await briefings(tag, (await ultra(tag)).id, [{ subject: "81", made: at(9, 0, 0), secret: true },
      { subject: "43", made: at(9, 0, 1), secret: true }], "en")), fail: "INSERT INTO briefing_deliveries" },
    { name: "a briefing, at the next one's claim", build: async (tag) => void (await briefings(tag, (await ultra(tag)).id, [{ subject: "81", made: at(9, 0, 0), secret: true },
      { subject: "43", made: at(9, 0, 1), secret: true }], "en")), fail: "UPDATE briefings SET last_delivered_at = ?1 WHERE id = ?2 AND deliver" },
    { name: "a grouped briefing message, at its rows", build: async (tag) => void (await briefings(tag, (await ultra(tag)).id,
      BUSY.slice(0, GROUP_OVER + 1).map((s, i) => ({ subject: s, made: at(9, 1, i), secret: i > 0 })), "en")), fail: "INSERT INTO briefing_deliveries" },
    { name: "the weekly email, at its row", build: async (tag) => {
      await weeklyMail(tag, (await ultra(tag)).id);
      await weeklyMail(tag + 1, (await ultra(tag + 1)).id);
    }, fail: "UPDATE weekly_mail SET last_status = 'sent'" },
    { name: "a saved view, at its row", build: async (tag) => void (await views(tag, (await ultra(tag)).id, [1, 2].map((y, i) => ({ kind: "buyer" as const, years: y,
      deliver: "weekly" as const, made: at(9, 2, i), secret: true })), "en")), fail: "UPDATE saved_views SET last_hash" },
    { name: "a saved view, at the next one's claim", build: async (tag) => void (await views(tag, (await ultra(tag)).id, [1, 2].map((y, i) => ({ kind: "buyer" as const,
      years: y, deliver: "weekly" as const, made: at(9, 2, i), secret: true })), "en")), fail: "UPDATE saved_views SET last_delivered_at = ?1 WHERE id = ?2 AND deliver" },
    { name: "a grouped saved-view message, at its rows", build: async (tag) => void (await views(tag, (await ultra(tag)).id, [1, 2, 3, 4, 5, 6].map((y, i) => ({
      kind: "buyer" as const, years: y, deliver: "weekly" as const, made: at(9, 3, i), secret: i > 0 })), "en")), fail: "UPDATE saved_views SET last_hash" },
  ];

  for (const [k, c] of CASES.entries()) {
    it(`keeps the one message it sent in the run's row and the day's count: ${c.name}`, { timeout: 60_000 }, async () => {
      await quietAll();
      await c.build(0x7000 + 0x10 * k);
      const mail = mailer();
      // Once a message has gone, the statement named fails every time it runs (so afterSend's second try fails too).
      const accounts = hooked(ACCOUNTS, (sqls) => {
        if (mail.sent.length && sqls.some((s) => s.startsWith(c.fail))) throw new Error("D1_ERROR: Network connection lost.");
      });
      const before = await daySent();
      const { report } = await runOn({ ACCOUNTS: accounts }, mail);
      expect(mail.sent).toHaveLength(1);
      expect(report.outcome).toBe("fault");
      expect(await lastRun()).toEqual({ outcome: "fault", sent: 1, failed: 0 });
      // What a later run of the day reads, so it does not pass the day's ceiling by the message this one sent.
      expect((await daySent()) - before).toBe(1);
    });
  }

  it("keeps a refused message too: a later fault in the part leaves its failed count in the run's row", { timeout: 60_000 }, async () => {
    await quietAll();
    const a = await ultra(0x7f00);
    await briefings(0x7f00, a.id, [{ subject: "81", made: at(9, 4, 0), secret: true }, { subject: "43", made: at(9, 4, 1), secret: true }], "en");
    // The first refused (not a limit): its failed row written; then the second's claim fails.
    const mail = mailer(() => "E_RECIPIENT_SUPPRESSED");
    const accounts = hooked(ACCOUNTS, (sqls) => {
      if (mail.handed.length && sqls.some((s) => s.startsWith("UPDATE briefings SET last_delivered_at = ?1 WHERE id = ?2 AND deliver"))) {
        throw new Error("D1_ERROR: Network connection lost.");
      }
    });
    await runOn({ ACCOUNTS: accounts }, mail);
    expect(await lastRun()).toEqual({ outcome: "fault", sent: 0, failed: 1 });
  });

  it("hands the next part the room its sends left: a saved search sent, a file that did not read, then the watch mail at the ceiling", { timeout: 60_000 }, async () => {
    await quietAll();
    // P's search sends; Q's radar search reads a window whose index is not published, which ends the saved searches.
    const p = await ultra(0x7e00);
    await searches(0x7e00, p.id, 1, "en", () => true);
    const q = await ultra(0x7e10);
    await ACCOUNTS.prepare("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'expiring', '/expiring/3m', 'Radar', 'en', ?, 'daily')")
      .bind(hexOf(0x7e10, 0x100), q.id, at(2, 5, 0)).run();
    // Two accounts' watch mail, with room for two in the day: P's search and one of them.
    const w1 = await ultra(0x7e20);
    await watchMail(0x7e20, w1.id);
    const w2 = await ultra(0x7e30);
    await watchMail(0x7e30, w2.id);
    const mail = mailer();
    const ceiling = await ceilingFor(2);
    // The 3-month window's index taken out of the published files.
    const { report } = await runOn({ ...ceiling, ASSETS: makeFakeAssets({}, { ...files(), "expiring/3m/index.json": undefined }) }, mail);
    expect(report.sent).toBe(1);
    expect(report.watch?.sent).toBe(1);
    expect(mail.sent.map((m) => m.to)).toEqual([p.email, w1.email]);
    expect(report.outcome).toBe("fault");
    expect(await lastRun()).toMatchObject({ outcome: "fault", sent: 2 });
    // A later run of the day, at the same ceiling (Q's radar search turned off), reads the two and has no room: W2's
    // watch mail waits for the next UTC day.
    await ACCOUNTS.prepare("UPDATE saved_searches SET deliver = 'off' WHERE user_id = ?").bind(q.id).run();
    const later = mailer();
    const next = await runOn(ceiling, later);
    expect(later.sent).toHaveLength(0);
    expect(next.report.outcome).toBe("limited");
  });
});

// =====================================================================================

describe("the grouped messages' statements", () => {
  it("read through an index: the secrets and the account's language by the key, a stop link's items by the account", async () => {
    const id = hexOf(1, 1);
    const plans: [string, string, unknown[], RegExp][] = [
      ["briefings' secrets", BRIEFING_SECRETS_SQL, [JSON.stringify([id, hexOf(1, 2)])], /^SEARCH briefings USING (?:COVERING )?INDEX \w+ \(id=\?\)/],
      ["views' secrets", VIEW_SECRETS_SQL, [JSON.stringify([id, hexOf(1, 2)])], /^SEARCH saved_views USING (?:COVERING )?INDEX \w+ \(id=\?\)/],
      ["the account's language", ACCOUNT_LANG_SQL, [id], /^SEARCH users USING (?:COVERING )?INDEX \w+ \(id=\?\)/],
      ["the briefings a ?gb= link proves", BRIEFING_GROUP_STOP_SQL, [id, 100], /^SEARCH b USING INDEX idx_briefings_user \(user_id=\?\)/],
      ["the views a ?gv= link proves", VIEW_GROUP_STOP_SQL, [id, 100], /^SEARCH v USING INDEX idx_saved_views_user \(user_id=\?\)/],
    ];
    for (const [name, sql, binds, used] of plans) {
      const steps = ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all<{ detail: string }>()).results ?? []).map((r) => r.detail);
      expect(steps.some((d) => used.test(d)), `${name}: ${steps.join(" | ")}`).toBe(true);
      // No table read whole; json_each is the list of ids bound.
      expect(steps.filter((d) => /^SCAN (?!json_each)/.test(d)), name).toEqual([]);
    }
    // Each list read is held to a limit: an account's most briefings (with its searches) and its most views.
    expect(BRIEFING_GROUP_STOP_SQL).toMatch(/LIMIT \?$/);
    expect(VIEW_GROUP_STOP_SQL).toMatch(/LIMIT \?$/);
  });
});
