// The seat notices, slice D (src/account/seat_mail.ts; the seats design's 1.3, 5.5, 7 and 9.1; docs/accounts.md,
// Seats, The seat notices): the sixth part of the delivery run, which tells a seat's member, in one message to its own
// address and in its own mail language, that the seat no longer gives Ultra, gives it again, or has ended. Every row
// of the design's table of the subscription's and the seat's edges that tells a person something is a test here, and
// every one that tells nobody: each message once, and nothing twice. Then the part inside the run: the claim given
// back when a send does not go, the run's cap, the day's ceiling and the query budget, the run log, a fault after a
// send, a plan that cannot be read now, the switch off and the table missing. Last, the holder's lines before the act
// on the billing page and the refund's confirmation.
//
// The part's clock is fixed (NOW): every row it reads is written at a fixed time before it, the entitlements among
// them (grantUltra stamps the real clock, so it is not used here). The billing page reads the real clock, so its
// fixtures are placed relative to it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Ceiling, QueryCount, RUN_QUERY_BUDGET, BUDGET_TEXT, runDeliveries } from "../src/account/deliveries";
import { PLAN_ROWS_SQL, PLAN_SEATS } from "../src/account/entitlements";
import { SEATS_DUE_SQL, SEATS_RUN_MAX, SEAT_CLAIM_SQL, runSeatNotices } from "../src/account/seat_mail";
import { endSeatsOf, leaveSeat, operatorCancelInvitation, operatorEndSeat, removeSeat } from "../src/account/seats";
import { fmtInt, t, tn, type Lang } from "../src/i18n";
import {
  ACCOUNTS, PRO_SALE, ULTRA_VARS, decode, get, nbsp, newEmail, onEnv, signIn, useAccountsDb, userId, withoutSeats,
} from "./accounts-helpers";
import { makeFakeAssets } from "./assets";
import stats from "./fixtures/stats.json";
import { fakeMail, type Handed } from "./mail-fixtures";

useAccountsDb();

const SITE = "https://awardwatch.ca";
const FROM = "alerts@awardwatch.ca";
const DAY = "2026-11-09";
const NOW = new Date(`${DAY}T16:00:00.000Z`);
// Times before the run, on its day and the days before.
const T = (s: string) => `2026-${s}.000Z`;
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const hexId = () => crypto.randomUUID().replace(/-/g, "");
const text = (s: string) => nbsp(decode(s)).replace(/’/g, "'");

let quiet: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(async () => {
  quiet = (["log", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  // Each test reads only the seats it writes.
  await ACCOUNTS.prepare("DELETE FROM seats").run();
});
afterEach(() => {
  for (const q of quiet) q.mockRestore();
});

// -- the accounts ----------------------------------------------------------------------------------------------

type Who = { id: string; email: string };

async function user(tag: string, lang: Lang = "en"): Promise<Who> {
  const id = hexId();
  const email = newEmail(tag);
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, ?, 'active', 'free')")
    .bind(id, email, T("09-01T00:00:00"), lang).run();
  return { id, email };
}

// A plan by hand, written at a fixed time: Ultra is a pro row with its tier row beside it.
async function grant(who: string, plan: "pro" | "ultra", o: { created?: string; ends?: string | null } = {}): Promise<string> {
  const id = hexId();
  const at = o.created ?? T("10-01T00:00:00");
  await ACCOUNTS.batch([
    ACCOUNTS.prepare("INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'manual', ?, ?, 'test', ?)")
      .bind(id, who, at, o.ends ?? null, at),
    ...(plan === "ultra" ? [ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(id)] : []),
  ]);
  return id;
}

// A live seat, told what taking it says (it gives the plan), at its join.
async function seat(holder: string, member: string, joined = T("10-15T00:00:00")): Promise<string> {
  const id = hexId();
  await ACCOUNTS.prepare(
    "INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id, joined_at, told, told_at) VALUES (?, ?, 'en', ?, ?, ?, ?, 1, ?)",
  ).bind(id, holder, joined, joined, member, joined, joined).run();
  return id;
}

// An Ultra holder and its members, each a seat it covers.
async function subscription(tag: string, langs: Lang[] = ["en", "fr"]): Promise<{ holder: Who; members: Who[]; seats: string[] }> {
  const holder = await user(`${tag}-holder`);
  await grant(holder.id, "ultra");
  const members: Who[] = [];
  const seats: string[] = [];
  for (const [i, lang] of langs.entries()) {
    const m = await user(`${tag}-member-${i}`, lang);
    members.push(m);
    seats.push(await seat(holder.id, m.id, T(`10-15T00:00:0${i}`)));
  }
  return { holder, members, seats };
}

type SeatRow = { told: number; told_at: string | null; ended_at: string | null; ended_why: string | null };
// What the i-th member of a subscription was told at its join, as subscription() writes it.
const untold = (i: number) => ({ told: 1, told_at: T(`10-15T00:00:0${i}`) });
const seatRow = (id: string) => ACCOUNTS.prepare("SELECT told, told_at, ended_at, ended_why FROM seats WHERE id = ?").bind(id).first<SeatRow>();

// -- the part, alone --------------------------------------------------------------------------------------------

type Mail = ReturnType<typeof fakeMail>;
const ON = (extra: Record<string, unknown> = {}) => onEnv({ SEATS: "on", MAIL_FROM: FROM, MAIL_SENDER: undefined, ...extra });

async function run(o: {
  mail?: Mail; now?: Date; room?: number; ceiling?: Ceiling; queries?: QueryCount; env?: Record<string, unknown>;
} = {}) {
  const mail = o.mail ?? fakeMail();
  const now = o.now ?? NOW;
  const tally = { left: 0 };
  const out = await runSeatNotices(ON({ MAIL: mail.binding, ...o.env }) as never, {
    site: SITE, dataDate: now.toISOString().slice(0, 10), now, room: o.room ?? 300, capText: "the cap of 300 messages", queries: o.queries, tally,
    ceiling: o.ceiling,
  });
  return { ...out, mail, tally };
}

const textOf = (m: Handed) => nbsp(m.text ?? "");
const htmlOf = (m: Handed) => nbsp(decode(m.html ?? ""));

// The one message a member got, of the kind and in the language named, with the plan and the day it names.
function holdsNotice(m: Handed, lang: Lang, kind: "lost" | "back" | "ended", plan: string, date: string): void {
  const subject = t(lang, kind === "lost" ? "seatmail.subject_lost" : kind === "back" ? "seatmail.subject_back" : "seatmail.subject_ended");
  expect(m.subject).toBe(subject);
  const lead = kind === "back" ? t(lang, "seatmail.back", { date }) : t(lang, kind === "lost" ? "seatmail.lost" : "seatmail.ended", { plan, date });
  for (const part of [textOf(m), htmlOf(m)]) {
    expect(part).toContain(nbsp(lead));
    expect(part.includes(nbsp(t(lang, "seatmail.kept", { plan })))).toBe(kind !== "back");
    expect(part).toContain(nbsp(t(lang, "seatmail.why")));
  }
  expect(m.html).toContain(`<html lang="${lang}">`);
  // The account's page as the button, and the plan and billing page in the footer, in the message's language.
  const q = lang === "fr" ? "?lang=fr" : "";
  expect(m.text).toContain(`${SITE}/account${q}\n`);
  expect(m.text).toContain(`${SITE}/account/billing${q}\n`);
  expect((m.html?.match(/<td class="btn"/g) ?? []).length).toBe(1);
  // One recipient, no stop link, no List-Unsubscribe: the sender's own header alone.
  expect(m.headers).toEqual({ "Auto-Submitted": "auto-generated" });
  expect(`${m.text}${m.html}`).not.toMatch(/\/account\/stop\?/);
  // No address but the site's two, and never why the holder's plan changed.
  for (const a of `${m.subject}\n${m.text}\n${m.html}`.match(/[\w.+%-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
    expect(["contact@awardwatch.ca", "alerts@awardwatch.ca"], a).toContain(a);
  }
  expect(`${m.subject} ${textOf(m)}`).not.toMatch(/refund|cancel|block|revok|dispute|renew|payment|rembours|annul|bloqu|révoq|litige|renouvel|paiement/i);
  for (const part of [m.subject, m.text ?? "", m.html ?? ""]) {
    expect(part).not.toContain(EM_DASH);
    expect(part).not.toContain(EN_DASH);
  }
}

const one = (mail: Mail, who: Who): Handed => {
  const got = mail.to(who.email);
  expect(got, who.email).toHaveLength(1);
  return got[0];
};

// =====================================================================================

describe("what the members are told", () => {
  // The ways a holder's own plan stops covering its seats (the design's 1.3): each tells every covered member "lost"
  // once, in the member's language, and names nothing of why.
  const STOPS: [string, (holder: Who) => Promise<void>][] = [
    ["the plan ends (cancelled at its period's end and past its grace, a renewal not paid, Refund now)", (h) =>
      ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), h.id).run().then(() => undefined)],
    ["the operator revokes the plan, or a dispute ends it", (h) =>
      ACCOUNTS.prepare("UPDATE entitlements SET revoked_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), h.id).run().then(() => undefined)],
    ["the holder moves to Pro, which holds no seat but the subscriber's", async (h) => {
      await grant(h.id, "pro", { created: T("11-09T12:00:00") });
    }],
    ["the operator blocks the holder", async (h) => {
      const op = await user("operator");
      await ACCOUNTS.prepare("INSERT INTO account_blocks (user_id, reason, created_at, by_user_id) VALUES (?, 'test', ?, ?)")
        .bind(h.id, T("11-09T12:00:00"), op.id).run();
    }],
  ];

  for (const [name, stop] of STOPS) {
    it(`when ${name}: "lost" once to each covered member, in its language, and nothing twice`, async () => {
      const { holder, members, seats } = await subscription("lost");
      // Nothing has changed yet: nothing to tell.
      expect((await run()).mail.handed).toEqual([]);
      await stop(holder);
      const { report, mail } = await run();
      expect(report).toMatchObject({ sent: 2, failed: 0, lost: 2, back: 0, ended: 0, unread: 0, records: null });
      for (const [i, lang] of (["en", "fr"] as const).entries()) {
        const m = one(mail, members[i]);
        holdsNotice(m, lang, "lost", t(lang, "account.plan_free"), DAY);
        expect(await seatRow(seats[i])).toEqual({ told: 0, told_at: NOW.toISOString(), ended_at: null, ended_why: null });
      }
      expect(mail.handed.map((m) => m.to).sort()).toEqual(members.map((m) => m.email).sort());
      expect((await run()).mail.handed).toEqual([]);
    });
  }

  it('when Ultra returns, by a move back or a new purchase: "back" once to each, and no join counted', async () => {
    const { holder, members, seats } = await subscription("back");
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-08T12:00:00"), holder.id).run();
    const lost = await run({ now: new Date(T("11-08T16:00:00")) });
    expect(lost.report?.lost).toBe(2);
    const joined = await ACCOUNTS.prepare("SELECT joined_at FROM seats WHERE holder_id = ? ORDER BY joined_at").bind(holder.id).all<{ joined_at: string }>();
    await grant(holder.id, "ultra", { created: T("11-09T10:00:00") });
    const { report, mail } = await run();
    expect(report).toMatchObject({ sent: 2, lost: 0, back: 2, ended: 0 });
    for (const [i, lang] of (["en", "fr"] as const).entries()) {
      holdsNotice(one(mail, members[i]), lang, "back", t(lang, "ultra.tag"), DAY);
      expect(await seatRow(seats[i])).toMatchObject({ told: 1, told_at: NOW.toISOString(), ended_at: null });
    }
    // The seats are the same rows, joined when they were: Ultra's return is no new join.
    expect((await ACCOUNTS.prepare("SELECT joined_at FROM seats WHERE holder_id = ? ORDER BY joined_at").bind(holder.id).all()).results).toEqual(joined.results);
    expect((await run()).mail.handed).toEqual([]);
  });

  it('when the holder removes a member, deletes the account, or the operator ends a seat: "ended" once, dated the seat\'s end', async () => {
    const env = ON() as never;
    const removed = await subscription("removed", ["fr"]);
    expect(await removeSeat(env, removed.holder.id, removed.seats[0], new Date(T("11-09T10:00:00")))).toBe(removed.members[0].email);
    const closed = await subscription("closed", ["en", "en"]);
    await endSeatsOf(env, closed.holder.id, closed.holder.email, new Date(T("11-09T11:00:00")));
    const operator = await subscription("operator", ["en"]);
    expect(await operatorEndSeat(env, operator.holder.id, operator.seats[0], new Date(T("11-09T12:00:00")))).toBe(operator.members[0].id);
    const { report, mail } = await run();
    expect(report).toMatchObject({ sent: 4, lost: 0, back: 0, ended: 4, failed: 0 });
    holdsNotice(one(mail, removed.members[0]), "fr", "ended", t("fr", "account.plan_free"), DAY);
    for (const m of [...closed.members, ...operator.members]) holdsNotice(one(mail, m), "en", "ended", t("en", "account.plan_free"), DAY);
    for (const id of [...removed.seats, ...closed.seats, ...operator.seats]) {
      expect(await seatRow(id)).toMatchObject({ told: 0, told_at: NOW.toISOString() });
    }
    expect((await run()).mail.handed).toEqual([]);
  });

  it('tells a member told "lost" earlier that the seat ended when it is removed, as the removal page promises', async () => {
    const { holder, members, seats } = await subscription("lost-then-removed", ["en"]);
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-08T12:00:00"), holder.id).run();
    expect((await run({ now: new Date(T("11-08T16:00:00")) })).report?.lost).toBe(1);
    await removeSeat(ON() as never, holder.id, seats[0], new Date(T("11-09T10:00:00")));
    const { report, mail } = await run();
    expect(report).toMatchObject({ sent: 1, ended: 1 });
    holdsNotice(one(mail, members[0]), "en", "ended", t("en", "account.plan_free"), DAY);
    expect((await run()).mail.handed).toEqual([]);
  });

  it("names the plan the account is on now: an account with Pro of its own reads Pro", async () => {
    const { holder, members } = await subscription("own-pro", ["en"]);
    await grant(members[0].id, "pro", { created: T("10-20T00:00:00") });
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), holder.id).run();
    const { mail } = await run();
    holdsNotice(one(mail, members[0]), "en", "lost", t("en", "pro.tag"), DAY);
  });

  it("tells nobody of a seat its member left or deleted, an invitation the operator cancelled, or a blocked or deleted member", async () => {
    const env = ON() as never;
    const holder = await user("quiet-holder");
    await grant(holder.id, "ultra");
    // Left, and deleted with the member's account (deleteAccount ends it, then marks the account deleted).
    const left = await user("quiet-left");
    await seat(holder.id, left.id);
    expect(await leaveSeat(env, left.id, new Date(T("11-09T10:00:00")))).toBe(true);
    const gone = await user("quiet-gone");
    await seat(holder.id, gone.id);
    await endSeatsOf(env, gone.id, gone.email, new Date(T("11-09T10:00:00")));
    await ACCOUNTS.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").bind(gone.id).run();
    // An invitation the operator cancelled: ended operator, as an ended seat is, but with no member.
    const invitation = hexId();
    await ACCOUNTS.prepare("INSERT INTO seats (id, holder_id, email, token_hash, lang, invited_at, expires_at) VALUES (?, ?, ?, ?, 'en', ?, ?)")
      .bind(invitation, holder.id, newEmail("quiet-invited"), "f".repeat(64), T("11-08T00:00:00"), T("11-15T00:00:00")).run();
    expect(await operatorCancelInvitation(env, holder.id, invitation, new Date(T("11-09T10:00:00")))).toBe(true);
    // A blocked member and a member whose account is no longer active, each in a covered seat when the plan ends.
    const blocked = await user("quiet-blocked");
    const blockedSeat = await seat(holder.id, blocked.id);
    await ACCOUNTS.prepare("INSERT INTO account_blocks (user_id, reason, created_at, by_user_id) VALUES (?, 'test', ?, ?)")
      .bind(blocked.id, T("11-01T00:00:00"), holder.id).run();
    const inactive = await user("quiet-inactive");
    const inactiveSeat = await seat(holder.id, inactive.id);
    await ACCOUNTS.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").bind(inactive.id).run();
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), holder.id).run();
    const { report, mail } = await run();
    expect(mail.handed).toEqual([]);
    expect(report).toMatchObject({ sent: 0, failed: 0 });
    // Passed over as the other parts pass such accounts over: nothing written either.
    expect(await seatRow(blockedSeat)).toMatchObject({ told: 1, told_at: T("10-15T00:00:00") });
    expect(await seatRow(inactiveSeat)).toMatchObject({ told: 1, told_at: T("10-15T00:00:00") });
  });

  it("tells a member with Ultra of its own nothing while it lasts, and \"lost\" once it ends", async () => {
    const { holder, members, seats } = await subscription("own-ultra", ["en"]);
    await grant(members[0].id, "ultra", { created: T("10-20T00:00:00"), ends: T("11-10T00:00:00") });
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-08T12:00:00"), holder.id).run();
    // Its own Ultra is served whatever the seat gives: nothing to tell, nothing written.
    expect((await run({ now: new Date(T("11-08T16:00:00")) })).mail.handed).toEqual([]);
    // Ultra coming back to the holder changes nothing it is served either.
    await grant(holder.id, "ultra", { created: T("11-09T00:00:00"), ends: T("11-09T12:00:00") });
    expect((await run({ now: new Date(T("11-09T06:00:00")) })).mail.handed).toEqual([]);
    expect(await seatRow(seats[0])).toMatchObject({ told: 1, told_at: T("10-15T00:00:00") });
    // Its own grant ends after the holder's plan has: the seat gives nothing, so it is on Free.
    const { mail } = await run({ now: new Date(T("11-10T16:00:00")) });
    holdsNotice(one(mail, members[0]), "en", "lost", t("en", "account.plan_free"), "2026-11-10");
  });

  it("tells nobody anything while a plan cannot be read from the database, and waits", async () => {
    const { holder, members, seats } = await subscription("unread", ["en", "en"]);
    await removeSeat(ON() as never, holder.id, seats[1], new Date(T("11-09T10:00:00")));
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), holder.id).run();
    // Every plan read fails: planFor answers the last known plan, which grants and takes away nothing here.
    const failing = statementFailing(PLAN_ROWS_SQL, () => true);
    const { report, mail } = await run({ env: { ACCOUNTS: failing } });
    expect(mail.handed).toEqual([]);
    expect(report).toMatchObject({ sent: 0, failed: 0, unread: 2 });
    expect(await seatRow(seats[0])).toMatchObject(untold(0));
    expect(await seatRow(seats[1])).toMatchObject(untold(1));
    // Read again, the plans tell both.
    const again = await run();
    expect(again.report).toMatchObject({ sent: 2, lost: 1, ended: 1 });
    expect(again.mail.to(members[0].email)).toHaveLength(1);
    expect(again.mail.to(members[1].email)).toHaveLength(1);
  });
});

// A binding whose statement of the given text fails (each read and each run of it, while fail says so), every
// other statement the real database's own.
function statementFailing(sql: string, fail: () => boolean): D1Database {
  const wrap = (s: D1PreparedStatement): D1PreparedStatement => ({
    bind: (...v: unknown[]) => wrap(s.bind(...v)),
    first: (...a: unknown[]) => (fail() ? Promise.reject(new Error("D1_ERROR: a planted fault")) : (s.first as (...x: unknown[]) => unknown)(...a)),
    all: () => (fail() ? Promise.reject(new Error("D1_ERROR: a planted fault")) : s.all()),
    run: () => (fail() ? Promise.reject(new Error("D1_ERROR: a planted fault")) : s.run()),
    raw: (...a: unknown[]) => (s.raw as (...x: unknown[]) => unknown)(...a),
  }) as unknown as D1PreparedStatement;
  return new Proxy(ACCOUNTS, {
    get(target, prop) {
      if (prop === "prepare") return (q: string) => (q === sql ? wrap(target.prepare(q)) : target.prepare(q));
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

// =====================================================================================

describe("the part inside the run", () => {
  it("gives the claim back when a send does not go: a refusal waits for the next run, a sending limit stops the run", async () => {
    const { holder, members, seats } = await subscription("refused", ["en", "en"]);
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), holder.id).run();
    const refusal = Object.assign(new Error("refused"), { code: "E_RECIPIENT_SUPPRESSED" });
    const refused = await run({ mail: fakeMail((to) => (to === members[0].email ? refusal : undefined)) });
    expect(refused.report).toMatchObject({ sent: 1, failed: 1, lost: 1 });
    expect(refused.stop).toBeNull();
    expect(await seatRow(seats[0])).toMatchObject(untold(0));
    expect(await seatRow(seats[1])).toMatchObject({ told: 0, told_at: NOW.toISOString() });
    // The next run tells it.
    const next = await run();
    expect(next.report).toMatchObject({ sent: 1, failed: 0 });
    expect(next.mail.to(members[0].email)).toHaveLength(1);

    const other = await subscription("limited", ["en", "en"]);
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), other.holder.id).run();
    const limit = Object.assign(new Error("limit"), { code: "E_DAILY_LIMIT_EXCEEDED" });
    const limited = await run({ mail: fakeMail(() => limit) });
    expect(limited.stop).toBe("E_DAILY_LIMIT_EXCEEDED");
    expect(limited.capped).toBe(false);
    expect(limited.report).toMatchObject({ sent: 0, failed: 0 });
    expect(limited.mail.handed).toHaveLength(1);
    for (const [k, id] of other.seats.entries()) expect(await seatRow(id)).toMatchObject(untold(k));
    expect(limited.tally.left).toBe(2);
    expect((await run()).report?.sent).toBe(2);
  });

  it("stops at the room the run gives it and at the day's ceiling, the rest told by a later run", async () => {
    const { holder } = await subscription("room", ["en", "en", "en"]);
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), holder.id).run();
    const capped = await run({ room: 1 });
    expect([capped.report?.sent, capped.stop, capped.capped]).toEqual([1, "the cap of 300 messages", true]);
    // The two left, each known due from the holder's plan the run read.
    expect(capped.tally.left).toBe(2);
    const ceiling = await run({ ceiling: { room: 1, text: "the day's sending ceiling of 1 message" } });
    expect([ceiling.report?.sent, ceiling.stop, ceiling.capped]).toEqual([1, "the day's sending ceiling of 1 message", false]);
    const rest = await run();
    expect([rest.report?.sent, rest.stop]).toEqual([1, null]);
    expect((await run()).mail.handed).toEqual([]);
  });

  it("stops before it reads a plan once the run's queries are spent", async () => {
    const { holder } = await subscription("budget", ["en"]);
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), holder.id).run();
    const queries = new QueryCount();
    queries.n = RUN_QUERY_BUDGET;
    const spent = await run({ queries });
    expect([spent.report?.sent, spent.stop, spent.capped]).toEqual([0, BUDGET_TEXT, true]);
    expect((await run()).report?.sent).toBe(1);
  });

  it(`reads at most SEATS_RUN_MAX (${SEATS_RUN_MAX}) seats a run, the rest the next`, { timeout: 30_000 }, async () => {
    // One member in many ended seats (only a live seat is one a person): each one's end is told once.
    const holder = await user("many-holder");
    const member = await user("many-member");
    const rows = Array.from({ length: SEATS_RUN_MAX + 5 }, (_, i) => ACCOUNTS.prepare(
      "INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id, joined_at, ended_at, ended_why, told, told_at) " +
      "VALUES (?, ?, 'en', ?, ?, ?, ?, ?, 'removed', 1, ?)",
    ).bind(hexId(), holder.id, T("10-01T00:00:00"), T("10-01T00:00:00"), member.id, T("10-01T00:00:00"), T(`11-09T10:${String(i % 60).padStart(2, "0")}:00`), T("10-01T00:00:00")));
    for (let i = 0; i < rows.length; i += 50) await ACCOUNTS.batch(rows.slice(i, i + 50));
    const first = await run();
    expect(first.report?.sent).toBe(SEATS_RUN_MAX);
    const second = await run();
    expect(second.report?.sent).toBe(5);
    expect((await run()).report?.sent).toBe(0);
  });

  it("reads the seats with one statement under its limit, the accounts by their keys, and claims a seat by its key", async () => {
    const plan = async (sql: string, ...binds: unknown[]) =>
      ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all<{ detail: string }>()).results ?? []).map((r) => r.detail).join("\n");
    const due = await plan(SEATS_DUE_SQL, SEATS_RUN_MAX, "0".repeat(32));
    expect(SEATS_DUE_SQL).toMatch(/ LIMIT \?1$/);
    // The seats table is read whole (its live rows and those of the last 30 days); each account by its key.
    expect(due).not.toMatch(/SCAN (m|h)\b/);
    expect(due).toMatch(/SEARCH m USING INDEX sqlite_autoindex_users_1 \(id=\?\)/);
    const claim = await plan(SEAT_CLAIM_SQL, 0, NOW.toISOString(), "a".repeat(32), 1, null, null);
    expect(claim).toMatch(/SEARCH seats USING INDEX sqlite_autoindex_seats_1 \(id=\?\)/);
  });
});

// =====================================================================================

describe("the sixth part of the delivery run", () => {
  const assets = makeFakeAssets({}, { "stats.json": { ...stats, data_as_of: DAY } });
  const runEnv = (mail: Mail, extra: Record<string, unknown> = {}) => onEnv({
    ASSETS: assets, MAIL: mail.binding, MAIL_FROM: FROM, MAIL_SENDER: undefined, SITE_URL: SITE, NOW: NOW.toISOString(), SEATS: "on", ...extra,
  }) as never;
  const lastRun = () => ACCOUNTS.prepare("SELECT outcome, sent, failed, left_due, detail FROM delivery_runs ORDER BY id DESC LIMIT 1")
    .first<{ outcome: string; sent: number; failed: number; left_due: number; detail: string | null }>();
  const daySent = async () => Number((await ACCOUNTS.prepare("SELECT COALESCE(SUM(sent), 0) AS n FROM delivery_runs WHERE at >= ? AND at < ?")
    .bind(`${DAY}T00:00:00.000Z`, "2026-11-10T00:00:00.000Z").first<{ n: number }>())?.n ?? 0);

  it("counts its sends in the run's row, after the saved views, and the day's ceiling holds it", async () => {
    const { holder, members } = await subscription("run", ["en", "fr"]);
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), holder.id).run();
    const mail = fakeMail();
    const report = await runDeliveries(runEnv(mail));
    expect(report.outcome).toBe("done");
    expect(report.seats).toMatchObject({ sent: 2, lost: 2 });
    expect(mail.handed.map((m) => m.to).sort()).toEqual(members.map((m) => m.email).sort());
    expect(await lastRun()).toMatchObject({ outcome: "done", sent: 2, failed: 0, left_due: 0 });

    // The day's ceiling: room for one more message today.
    const next = await subscription("ceiling", ["en", "en"]);
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), next.holder.id).run();
    const quota = 40 + (await daySent()) + 1;
    const capped = fakeMail();
    const limited = await runDeliveries(runEnv(capped, { MAIL_DAILY_QUOTA: String(quota), MAIL_DAILY_RESERVE: "40" }));
    expect(limited.outcome).toBe("limited");
    expect(limited.seats?.sent).toBe(1);
    expect(capped.handed).toHaveLength(1);
    expect(await lastRun()).toMatchObject({ outcome: "limited", sent: 1, left_due: 1 });
    expect((await lastRun())?.detail).toMatch(/^the day's sending ceiling/);
    // Another run that day sends nothing; the next day's tells the rest.
    const later = fakeMail();
    await runDeliveries(runEnv(later, { MAIL_DAILY_QUOTA: String(quota), MAIL_DAILY_RESERVE: "40" }));
    expect(later.handed).toEqual([]);
    const tomorrow = fakeMail();
    await runDeliveries(runEnv(tomorrow, {
      ASSETS: makeFakeAssets({}, { "stats.json": { ...stats, data_as_of: "2026-11-10" } }), NOW: "2026-11-10T16:00:00.000Z",
    }));
    expect(tomorrow.handed).toHaveLength(1);
  });

  it("keeps the messages it sent before a fault in the run's row", async () => {
    const { holder } = await subscription("fault", ["en", "en"]);
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), holder.id).run();
    let claims = 0;
    const accounts = statementFailing(SEAT_CLAIM_SQL, () => ++claims === 2);
    const mail = fakeMail();
    const report = await runDeliveries(runEnv(mail, { ACCOUNTS: accounts }));
    expect(report.outcome).toBe("fault");
    expect(report.why).toBe("the seat notices could not read or write the accounts database; the next hour tries again");
    expect(report.seats).toMatchObject({ sent: 1 });
    expect(mail.handed).toHaveLength(1);
    expect(await lastRun()).toMatchObject({ outcome: "fault", sent: 1 });
  });

  it("with the switch off, reads no seat and sends nothing; the part alone reads nothing at all", async () => {
    const { holder } = await subscription("off", ["en"]);
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE user_id = ?").bind(T("11-09T12:00:00"), holder.id).run();
    const sent: string[] = [];
    const recording = new Proxy(ACCOUNTS, {
      get(target, prop) {
        if (prop === "prepare") return (q: string) => {
          sent.push(q);
          return target.prepare(q);
        };
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    for (const off of ["off", undefined, "ON", "true"]) {
      sent.length = 0;
      const mail = fakeMail();
      const report = await runDeliveries(runEnv(mail, { ACCOUNTS: recording, SEATS: off }));
      expect(report.outcome, String(off)).toBe("done");
      expect(report.seats, String(off)).toBeUndefined();
      expect(mail.handed, String(off)).toEqual([]);
      expect(sent.some((q) => /\bseats\b/.test(q)), String(off)).toBe(false);
    }
    // The part run alone with the switch off: a database that throws on any use is never touched.
    const trap = new Proxy({}, { get() { throw new Error("read while the switch is off"); } });
    const alone = await runSeatNotices(onEnv({ SEATS: "off", ACCOUNTS: trap }) as never, {
      site: SITE, dataDate: DAY, now: NOW, room: 300, capText: "the cap",
    });
    expect(alone).toEqual({ report: null, stop: null, capped: false });
  });

  it("without the seats table, reads one statement, sends nothing and says so", async () => {
    await withoutSeats(async () => {
      const mail = fakeMail();
      const report = await runDeliveries(runEnv(mail));
      expect(report.seats).toMatchObject({ sent: 0, records: "no_table" });
      expect(mail.handed).toEqual([]);
      expect(report.outcome).toBe("done");
    });
  });
});

// =====================================================================================
// The holder's lines before the act (the seats design's 5.5): the billing page's subscription panel, where Stripe's
// page cancels it, the move down to Pro, and the refund's confirmation, each naming the people in the other seats the
// plan covers now, only while the switch is on and only when there are any. The billing page reads the real clock.

describe("the holder's lines before the act", () => {
  const DAY_MS = 86_400_000;
  const iso = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString();
  // seats null: the variable absent.
  const env = (seats: string | null) => onEnv({ ...PRO_SALE, ...ULTRA_VARS, SEATS: seats ?? undefined });
  const read = async (path: string, cookie: string, seats: string | null = "on") => text(await (await get(path, { cookie, env: env(seats) })).text());

  // A holder signed in, on Ultra through a live Stripe subscription paid two days ago (so the refund is offered),
  // with n members in seats its plan covers.
  async function stripeHolder(tag: string, n: number): Promise<{ cookie: string; id: string }> {
    const email = newEmail(tag);
    const cookie = await signIn(email);
    const id = await userId(email);
    const e = hexId();
    const sub = `sub_${hexId().slice(0, 14)}`;
    await ACCOUNTS.batch([
      ACCOUNTS.prepare("INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'stripe', ?, ?, ?, ?)")
        .bind(e, id, iso(-2), iso(31), sub, iso(-2)),
      ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(e),
      ACCOUNTS.prepare(
        "INSERT INTO payment_customers (user_id, customer_id, subscription_id, status, current_period_end, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
      ).bind(id, `cus_${hexId().slice(0, 14)}`, sub, iso(28), iso(-2)),
    ]);
    for (let i = 0; i < n; i++) {
      const m = await user(`${tag}-member-${i}`);
      await seat(id, m.id, iso(-1 + i / 100));
    }
    return { cookie, id };
  }

  const seatWords = (lang: Lang, n: number) => t(lang, n === 1 ? "seats.seat_one" : "seats.seat_many", { n });
  const linesFor = (lang: Lang, n: number) => [
    text(tn(lang, "billing.seats_ends_one", "billing.seats_ends", n, { n: fmtInt(n, lang) })),
    text(tn(lang, "billing.seats_down_one", "billing.seats_down", n, { n: fmtInt(n, lang), pro_seats: seatWords(lang, PLAN_SEATS.pro) })),
  ];

  for (const n of [2, 1]) {
    it(`name the ${n === 1 ? "one person" : `${n} people`} in the other seats on the subscription's panel, the move to Pro and the refund's confirmation, in both languages`, async () => {
      const h = await stripeHolder(`lines-${n}`, n);
      for (const lang of ["en", "fr"] as const) {
        const q = lang === "fr" ? "?lang=fr" : "";
        const page = await read(`/account/billing${q}`, h.cookie);
        const [ends, down] = linesFor(lang, n);
        expect(page).toContain(`<p>${ends}</p>`);
        expect(page).toContain(`<p>${down}</p>`);
        // In the panels where the holder acts: before Manage the subscription, and in the move to Pro's panel.
        const subscription = page.slice(page.indexOf('id="subscription"'), page.indexOf('action="/account/billing/portal"'));
        expect(subscription).toContain(ends);
        const move = page.slice(page.indexOf('id="move"'));
        expect(move.slice(0, move.indexOf("</form>"))).toContain(down);
        const confirm = await read(`/account/billing?refund=confirm${lang === "fr" ? "&lang=fr" : ""}`, h.cookie);
        const refund = text(tn(lang, "refund.seats_one", "refund.seats", n, { n: fmtInt(n, lang) }));
        const panel = confirm.slice(confirm.indexOf('id="refund"'));
        expect(panel.slice(0, panel.indexOf("</form>"))).toContain(`<p>${refund}</p>`);
        // The offer before the confirmation names nobody.
        expect(page).not.toContain(refund);
        for (const s of [ends, down, refund]) {
          expect(s).not.toContain(EM_DASH);
          expect(s).not.toContain(EN_DASH);
        }
      }
    });
  }

  it("are absent with the switch off, and for a holder whose plan covers no other seat", async () => {
    const h = await stripeHolder("lines-off", 2);
    const alone = await stripeHolder("lines-alone", 0);
    // Every line names the other seats; nothing else on these pages does.
    const OTHER: Record<Lang, RegExp> = { en: /\bits other seats?\b|\byour other seats?\b/, fr: /\b(?:votre|vos|son|ses) autres? sièges?\b/ };
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "&lang=fr" : "";
      for (const n of [1, 2]) for (const l of linesFor(lang, n)) expect(l).toMatch(OTHER[lang]);
      for (const [who, seats] of [[h, "off"], [h, null], [alone, "on"]] as const) {
        for (const path of [`/account/billing?x=1${q}`, `/account/billing?refund=confirm${q}`]) {
          const page = await read(path, who.cookie, seats);
          // The page is the one with the subscription, the move and the refund drawn.
          expect(page, path).toContain('id="subscription"');
          expect(page, path).toContain('id="move"');
          expect(page, path).toContain('id="refund"');
          expect(page, `${path} ${String(seats)}`).not.toMatch(OTHER[lang]);
        }
      }
      // The switch off draws the page it drew before this slice: no Seats link either.
      expect(await read(`/account/billing${q.replace("&", "?")}`, h.cookie, "off")).not.toContain('href="/account/seats"');
    }
  });
});
