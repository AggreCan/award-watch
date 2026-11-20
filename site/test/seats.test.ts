// Seats, the table and the plan read through a seat (docs/accounts.md, Seats):
// planFor's one statement and what it answers for a holder, a member and an
// account with neither (src/account/entitlements.ts); the site before the
// table is on the database (withSeats, seatsReady), with the tier table there
// and not; LIVE_PRO_SQL; deletion and the sweep (src/account/seats.ts); the
// member's plan line on the overview; and the console's read-only Seats panel.
// No page creates a seat yet, so every seat here is written by fixture.
// test/seats-unchanged.test.ts holds every page byte for byte with the table
// present and absent.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENTITLEMENTS_SQL, ENTITLEMENTS_SQL_NO_TIERS, LIVE_PRO_SQL, PLAN_ROWS_SQL, PLAN_ROWS_SQL_NO_TIERS, PLAN_SEATS, SEATS_RECHECK_MS,
  type EntitlementRow, type PlanHolder, type PlanState, planFor, planFromRows, seatsReady,
} from "../src/account/entitlements";
import { SEAT_KEEP_DAYS, SEATS_SWEEP_SQL } from "../src/account/seats";
import { sweep } from "../src/account/signin";
import {
  ACCOUNTS, SEATS_SCHEMA, csrf, decode, get, nbsp, newEmail, onEnv, post, signIn, useAccountsDb, userId, withoutSeats, withoutTiers,
} from "./accounts-helpers";

useAccountsDb();

afterEach(() => {
  vi.restoreAllMocks();
});

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const NOW = new Date();
const iso = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();
const day = (days: number) => iso(days).slice(0, 10);
const hexId = () => crypto.randomUUID().replace(/-/g, "");
const text = (s: string) => nbsp(decode(s)).replace(/’/g, "'");

// -- fixtures ------------------------------------------------------------------------------

type Who = { id: string; email: string };

// An account as a users row, active, its address fresh, its cached plan free.
async function account(tag: string): Promise<Who> {
  const id = hexId();
  const email = newEmail(tag);
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, 'en', 'active', 'free')")
    .bind(id, email, iso(-400)).run();
  return { id, email };
}

// An entitlement as the console's grant writes it: a pro row, with its tier row for Ultra.
async function grant(user: string, plan: "pro" | "ultra", o: { starts?: string; ends?: string | null; created?: string; revoked?: string } = {}): Promise<string> {
  const id = hexId();
  const statements = [ACCOUNTS.prepare(
    "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at, revoked_at) VALUES (?, ?, 'pro', 'manual', ?, ?, 'fixture', ?, ?)",
  ).bind(id, user, o.starts ?? iso(-60), o.ends ?? null, o.created ?? iso(-60), o.revoked ?? null)];
  if (plan === "ultra") statements.push(ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(id));
  await ACCOUNTS.batch(statements);
  return id;
}

// A taken seat, joined `joined` days from now (a day after its invitation), ended `ended` days from now if given.
async function seat(holder: string, member: string, joined: number, o: { id?: string; ended?: number; why?: string } = {}): Promise<string> {
  const id = o.id ?? hexId();
  await ACCOUNTS.prepare(
    "INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id, joined_at, ended_at, ended_why) VALUES (?, ?, 'en', ?, ?, ?, ?, ?, ?)",
  ).bind(id, holder, iso(joined - 1), iso(joined + 6), member, iso(joined), o.ended === undefined ? null : iso(o.ended), o.why ?? null).run();
  return id;
}

// An invitation never taken, sent `sent` days from now, its link good for 7 days; ended if given.
async function invite(holder: string, email: string, sent: number, o: { ended?: number; why?: string } = {}): Promise<string> {
  const id = hexId();
  await ACCOUNTS.prepare(
    "INSERT INTO seats (id, holder_id, email, token_hash, lang, invited_at, expires_at, ended_at, ended_why) VALUES (?, ?, ?, ?, 'en', ?, ?, ?, ?)",
  ).bind(id, holder, email, o.ended === undefined ? "f".repeat(64) : null, iso(sent), iso(sent + 7), o.ended === undefined ? null : iso(o.ended), o.why ?? null).run();
  return id;
}

const holderOf = async (id: string): Promise<PlanHolder> =>
  (await ACCOUNTS.prepare("SELECT id, plan, plan_until FROM users WHERE id = ?").bind(id).first<PlanHolder>())!;
const plan = async (id: string, at: Date = NOW): Promise<PlanState> => planFor(onEnv() as never, await holderOf(id), at);

// The accounts database with every statement prepared on it written down.
function recording(): { env: never; sql: string[] } {
  const sql: string[] = [];
  const db = new Proxy(ACCOUNTS, {
    get(target, prop) {
      if (prop === "prepare") return (s: string) => (sql.push(s), target.prepare(s));
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { env: onEnv({ ACCOUNTS: db }) as never, sql };
}

// planFor as it read before seats: today's statement, and the same rule over its rows.
async function todayPlan(id: string, at: Date = NOW): Promise<PlanState> {
  const rows = (await ACCOUNTS.prepare(ENTITLEMENTS_SQL).bind(id).all<EntitlementRow>()).results ?? [];
  return { ...planFromRows(rows, at), source: "entitlements" };
}

// =====================================================================================

describe("the table", () => {
  it("is exactly the four statements the operator applies, each idempotent", () => {
    expect(SEATS_SCHEMA.map((s) => s.slice(0, s.indexOf("(")).replace(/\s+/g, " ").trim())).toEqual([
      "CREATE TABLE IF NOT EXISTS seats",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_seats_member_live ON seats",
      "CREATE INDEX IF NOT EXISTS idx_seats_holder ON seats",
      "CREATE INDEX IF NOT EXISTS idx_seats_email ON seats",
    ]);
  });

  it("holds one live seat a person, and a member always with its join date", async () => {
    const h = await account("t-holder");
    const g = await account("t-other");
    const m = await account("t-member");
    await seat(h.id, m.id, -3);
    await expect(seat(g.id, m.id, -1)).rejects.toThrow(/UNIQUE/);
    // An ended seat leaves the person free for another.
    await ACCOUNTS.prepare("UPDATE seats SET ended_at = ?, ended_why = 'left' WHERE member_id = ? AND ended_at IS NULL").bind(iso(0), m.id).run();
    await seat(g.id, m.id, 0);
    await expect(ACCOUNTS.prepare(
      "INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id) VALUES (?, ?, 'en', ?, ?, ?)",
    ).bind(hexId(), h.id, iso(0), iso(7), g.id).run()).rejects.toThrow(/CHECK/);
  });
});

describe("the plan through a seat", () => {
  it("gives a covered member Ultra until the holder's end, in a group of the holder, then the members by join order", async () => {
    const h = await account("g-holder");
    const end = iso(40);
    await grant(h.id, "ultra", { ends: end });
    const [a, b, c] = [await account("g-a"), await account("g-b"), await account("g-c")];
    const sb = await seat(h.id, b.id, -20);
    // a and c joined at the same moment: their seats' ids order them.
    const sa = await seat(h.id, a.id, -10, { id: "1".repeat(32) });
    await seat(h.id, c.id, -10, { id: "2".repeat(32) });
    const ids = [h.id, b.id, a.id, c.id];
    expect(await plan(b.id)).toStrictEqual({
      plan: "ultra", until: end, source: "entitlements",
      seat: { id: sb, holderId: h.id, holderEmail: h.email, covered: true },
      group: { holderId: h.id, ids, position: 1 },
    });
    expect(await plan(a.id)).toStrictEqual({
      plan: "ultra", until: end, source: "entitlements",
      seat: { id: sa, holderId: h.id, holderEmail: h.email, covered: true },
      group: { holderId: h.id, ids, position: 2 },
    });
    expect((await plan(c.id)).group).toStrictEqual({ holderId: h.id, ids, position: 3 });
    // The holder reads its own plan, leads the group and holds no seat.
    expect(await plan(h.id)).toStrictEqual({ plan: "ultra", until: end, source: "entitlements", group: { holderId: h.id, ids, position: 0 } });
    // A member's cache says pro with the holder's end, as an Ultra holder's does.
    expect(await ACCOUNTS.prepare("SELECT plan, plan_until FROM users WHERE id = ?").bind(b.id).first()).toEqual({ plan: "pro", plan_until: end });
  });

  it("gives nothing from a holder on Pro, ended, revoked, blocked or deleted: each member keeps its own plan, in no group", async () => {
    const cases: [string, (h: Who) => Promise<void>][] = [
      ["pro", async (h) => void (await grant(h.id, "pro"))],
      ["ended", async (h) => void (await grant(h.id, "ultra", { ends: iso(-1) }))],
      ["revoked", async (h) => void (await grant(h.id, "ultra", { revoked: iso(-1) }))],
      ["blocked", async (h) => {
        await grant(h.id, "ultra");
        await ACCOUNTS.prepare("INSERT INTO account_blocks (user_id, reason, created_at, by_user_id) VALUES (?, 'fixture', ?, ?)").bind(h.id, iso(-1), h.id).run();
      }],
      ["deleted", async (h) => {
        await grant(h.id, "ultra");
        await ACCOUNTS.prepare("UPDATE users SET status = 'deleted', email = ? WHERE id = ?").bind(`deleted:${h.id}`, h.id).run();
      }],
    ];
    for (const [what, make] of cases) {
      const h = await account(`n-${what}`);
      await make(h);
      const address = (await ACCOUNTS.prepare("SELECT email FROM users WHERE id = ?").bind(h.id).first<{ email: string }>())!.email;
      const free = await account(`n-free-${what}`);
      const pro = await account(`n-pro-${what}`);
      const proEnd = iso(20);
      await grant(pro.id, "pro", { ends: proEnd });
      const sFree = await seat(h.id, free.id, -5);
      const sPro = await seat(h.id, pro.id, -4);
      expect(await plan(free.id), what).toStrictEqual({
        plan: "free", until: null, source: "entitlements", seat: { id: sFree, holderId: h.id, holderEmail: address, covered: false },
      });
      expect(await plan(pro.id), what).toStrictEqual({
        plan: "pro", until: proEnd, source: "entitlements", seat: { id: sPro, holderId: h.id, holderEmail: address, covered: false },
      });
    }
  });

  it("reads an ended seat as none: the member's own plan, and no group on either side", async () => {
    const h = await account("e-holder");
    await grant(h.id, "ultra");
    const m = await account("e-member");
    await seat(h.id, m.id, -10, { ended: -1, why: "left" });
    expect(await plan(m.id)).toStrictEqual({ plan: "free", until: null, source: "entitlements" });
    expect(await plan(h.id)).toStrictEqual({ plan: "ultra", until: null, source: "entitlements" });
  });

  it("lets a member's own Ultra grant win over the seat and leave the group, and a lower plan of its own give way", async () => {
    const h = await account("o-holder");
    const end = iso(30);
    await grant(h.id, "ultra", { ends: end });
    const granted = await account("o-granted");
    const ownEnd = iso(90);
    await grant(granted.id, "ultra", { ends: ownEnd });
    const lower = await account("o-lower");
    await grant(lower.id, "pro", { ends: iso(200) });
    const sg = await seat(h.id, granted.id, -9);
    const sl = await seat(h.id, lower.id, -8);
    expect(await plan(granted.id)).toStrictEqual({
      plan: "ultra", until: ownEnd, source: "entitlements", seat: { id: sg, holderId: h.id, holderEmail: h.email, covered: false },
    });
    const l = await plan(lower.id);
    expect([l.plan, l.until, l.seat]).toStrictEqual(["ultra", end, { id: sl, holderId: h.id, holderEmail: h.email, covered: true }]);
    expect(l.group?.holderId).toBe(h.id);
    expect(l.group?.ids[l.group.position]).toBe(lower.id);
  });

  it("reads a seat whose holder has no entitlement row as giving no plan", async () => {
    const h = await account("r-holder");
    const m = await account("r-member");
    const s = await seat(h.id, m.id, -3);
    expect(await plan(m.id)).toStrictEqual({
      plan: "free", until: null, source: "entitlements", seat: { id: s, holderId: h.id, holderEmail: h.email, covered: false },
    });
    expect(await plan(h.id)).toStrictEqual({ plan: "free", until: null, source: "entitlements" });
  });

  it("covers four member seats on Ultra's five: a fifth live member reads its own plan", async () => {
    expect(PLAN_SEATS).toEqual({ free: 1, pro: 1, ultra: 5 });
    const h = await account("f-holder");
    await grant(h.id, "ultra");
    const members: Who[] = [];
    for (let i = 0; i < 5; i++) {
      members.push(await account(`f-${i}`));
      await seat(h.id, members[i].id, -50 + i * 10);
    }
    const ids = [h.id, ...members.slice(0, 4).map((m) => m.id)];
    for (let i = 0; i < 4; i++) {
      const p = await plan(members[i].id);
      expect([p.plan, p.seat?.covered, p.group], `member ${i + 1}`).toStrictEqual(["ultra", true, { holderId: h.id, ids, position: i + 1 }]);
    }
    const fifth = await plan(members[4].id);
    expect([fifth.plan, fifth.seat?.covered, fifth.group]).toStrictEqual(["free", false, undefined]);
    expect((await plan(h.id)).group).toStrictEqual({ holderId: h.id, ids, position: 0 });
    // The first to leave makes room: the fifth is covered from the next read.
    await ACCOUNTS.prepare("UPDATE seats SET ended_at = ?, ended_why = 'left' WHERE member_id = ?").bind(iso(0), members[0].id).run();
    expect((await plan(members[4].id)).group?.position).toBe(4);
  });

  it("sends one statement a call, holder, member or neither, bound to the account's id alone", async () => {
    const h = await account("one-holder");
    await grant(h.id, "ultra");
    const m = await account("one-member");
    await seat(h.id, m.id, -2);
    const lapsed = await account("one-lapsed-holder");
    const u = await account("one-uncovered");
    await seat(lapsed.id, u.id, -2);
    const pro = await account("one-pro");
    await grant(pro.id, "pro");
    const free = await account("one-free");
    expect([...PLAN_ROWS_SQL.matchAll(/\?\d*/g)].map((x) => x[0])).toEqual(["?1", "?1", "?1", "?1"]);
    for (const who of [h, m, u, pro, free]) {
      // The first read may bring the cache up to date, as it always could; nothing else is sent.
      const first = recording();
      await planFor(first.env, await holderOf(who.id));
      expect(first.sql[0], who.email).toBe(PLAN_ROWS_SQL);
      expect(first.sql.slice(1).every((s) => s.startsWith("UPDATE users SET plan = ?, plan_until = ?")), who.email).toBe(true);
      expect(first.sql.length).toBeLessThanOrEqual(2);
      const r = recording();
      await planFor(r.env, await holderOf(who.id));
      expect(r.sql, who.email).toEqual([PLAN_ROWS_SQL]);
    }
  });

  it("answers exactly what today's statement answers for every account with no seat and no member, from the same rows", async () => {
    const fixtures: Record<string, (me: Who) => Promise<unknown>> = {
      none: async () => undefined,
      pro_open: (me) => grant(me.id, "pro"),
      pro_until: (me) => grant(me.id, "pro", { ends: iso(10) }),
      pro_ended: (me) => grant(me.id, "pro", { ends: iso(-1) }),
      pro_revoked: (me) => grant(me.id, "pro", { revoked: iso(-2) }),
      pro_later: (me) => grant(me.id, "pro", { starts: iso(5) }),
      ultra: (me) => grant(me.id, "ultra", { ends: iso(300) }),
      ultra_then_pro: async (me) => {
        await grant(me.id, "ultra", { created: iso(-50) });
        await grant(me.id, "pro", { created: iso(-20), starts: iso(-20), ends: iso(15) });
      },
      // A holder whose seats have all ended, and one with only invitations: neither has a member.
      holder_ended: async (me) => {
        await grant(me.id, "ultra");
        await seat(me.id, (await account("eq-gone")).id, -40, { ended: -2, why: "removed" });
      },
      holder_invited: async (me) => {
        await grant(me.id, "ultra");
        await invite(me.id, newEmail("eq-invited"), -1);
      },
      // An account whose own seat ended, and one an invitation was sent to and never taken.
      seat_ended: async (me) => {
        const h = await account("eq-old-holder");
        await grant(h.id, "ultra");
        await seat(h.id, me.id, -30, { ended: -3, why: "left" });
        await grant(me.id, "pro", { ends: iso(8) });
      },
      invited: async (me) => {
        const h = await account("eq-inviter");
        await grant(h.id, "ultra");
        await invite(h.id, me.email, -1);
      },
    };
    const moments = [NOW, new Date(NOW.getTime() + 12 * 86_400_000), new Date(NOW.getTime() - 90 * 86_400_000)];
    const byId = (a: Record<string, unknown>, b: Record<string, unknown>) => (String(a.id) < String(b.id) ? -1 : 1);
    for (const [what, make] of Object.entries(fixtures)) {
      const me = await account(`eq-${what}`);
      await make(me);
      for (const at of moments) {
        expect(await plan(me.id, at), `${what} at ${at.toISOString()}`).toStrictEqual(await todayPlan(me.id, at));
      }
      // The statement's own half is today's statement's rows, and it finds nothing else.
      const rows = (await ACCOUNTS.prepare(PLAN_ROWS_SQL).bind(me.id).all<Record<string, unknown>>()).results ?? [];
      const today = (await ACCOUNTS.prepare(ENTITLEMENTS_SQL).bind(me.id).all<Record<string, unknown>>()).results ?? [];
      expect(rows.every((r) => r.via === "own"), what).toBe(true);
      const own = rows.map(({ via: _v, holder_id: _h, holder_email: _e, holder_ok: _o, member_id: _m, joined_at: _j, seat_id: _s, ...r }) => r);
      expect(own.sort(byId), what).toEqual([...today].sort(byId));
    }
  });

  it("reads every seat through an index: no part of the statement scans the table", async () => {
    const steps = ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${PLAN_ROWS_SQL}`).bind(hexId()).all<{ detail: string }>()).results ?? [])
      .map((r) => r.detail);
    expect(steps.filter((d) => d.includes("idx_seats_member_live"))).toHaveLength(2);
    expect(steps.some((d) => d.includes("idx_seats_holder"))).toBe(true);
    expect(steps.filter((d) => /^SCAN/.test(d))).toEqual([]);
  });

  it("leaves LIVE_PRO_SQL counting the holder once and no member", async () => {
    const at = iso(0);
    const count = async () => (await ACCOUNTS.prepare(LIVE_PRO_SQL).bind(at).first<{ n: number }>())!.n;
    const before = await count();
    const h = await account("live-holder");
    await grant(h.id, "ultra");
    expect(await count()).toBe(before + 1);
    const members: Who[] = [];
    for (let i = 0; i < 4; i++) {
      members.push(await account(`live-${i}`));
      await seat(h.id, members[i].id, -4 + i);
    }
    expect((await plan(members[3].id)).plan).toBe("ultra");
    expect(await count()).toBe(before + 1);
  });
});

describe("before the table is on the database", () => {
  it("reads every account as before, says so in one line, and asks again only after ten minutes, the tier table present", async () => {
    const u = await account("fb-ultra");
    await grant(u.id, "ultra");
    await plan(u.id);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await withoutSeats(async () => {
      const r = recording();
      const t0 = new Date();
      expect(await planFor(r.env, await holderOf(u.id), t0)).toStrictEqual(await todayPlan(u.id, t0));
      expect(r.sql).toEqual([PLAN_ROWS_SQL, ENTITLEMENTS_SQL]);
      const soon = new Date(t0.getTime() + SEATS_RECHECK_MS - 60_000);
      r.sql.length = 0;
      expect(await planFor(r.env, await holderOf(u.id), soon)).toStrictEqual({ plan: "ultra", until: null, source: "entitlements" });
      expect(r.sql).toEqual([ENTITLEMENTS_SQL]);
      // seatsReady asks nothing while the table is remembered missing.
      r.sql.length = 0;
      expect(await seatsReady(r.env, soon)).toBe(false);
      expect(r.sql).toEqual([]);
      const later = new Date(t0.getTime() + SEATS_RECHECK_MS + 60_000);
      expect((await planFor(r.env, await holderOf(u.id), later)).plan).toBe("ultra");
      expect(r.sql).toEqual([PLAN_ROWS_SQL, ENTITLEMENTS_SQL]);
      const lines = error.mock.calls.map((c) => String(c[0]));
      expect(lines.filter((l) => l.includes("seats missing"))).toEqual([
        "account plan: seats missing, every account read without a seat until accounts_schema.sql is applied",
      ]);
      for (const l of lines) {
        expect(l).not.toContain("@");
        expect(l).not.toContain(u.id);
      }
    });
    // With the table back, the statement with seats is sent again, alone.
    const r = recording();
    await planFor(r.env, await holderOf(u.id));
    expect(r.sql).toEqual([PLAN_ROWS_SQL]);
    expect(await seatsReady(r.env)).toBe(true);
  });

  it("falls back the same way with the tier table missing too: today's two statements, each table's line once", async () => {
    const u = await account("fb-both");
    await grant(u.id, "ultra");
    await plan(u.id);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await withoutTiers(() => withoutSeats(async () => {
      const r = recording();
      const t0 = new Date();
      // Without the tier table an Ultra row reads as Pro, as before.
      expect(await planFor(r.env, await holderOf(u.id), t0)).toStrictEqual({ plan: "pro", until: null, source: "entitlements" });
      expect(r.sql[0]).toBe(PLAN_ROWS_SQL);
      expect(r.sql.at(-1)).toBe(ENTITLEMENTS_SQL_NO_TIERS);
      expect(r.sql).toHaveLength(3);
      r.sql.length = 0;
      expect((await planFor(r.env, await holderOf(u.id), new Date(t0.getTime() + 60_000))).plan).toBe("pro");
      expect(r.sql).toEqual([ENTITLEMENTS_SQL, ENTITLEMENTS_SQL_NO_TIERS]);
      const lines = error.mock.calls.map((c) => String(c[0]));
      expect(lines.filter((l) => l.includes("seats missing"))).toHaveLength(1);
      expect(lines.filter((l) => l.includes("entitlement_tiers missing"))).toHaveLength(1);
    }));
    expect((await plan(u.id)).plan).toBe("ultra");
  });

  it("keeps the tier table's fallback with the seats table present: Ultra reads as Pro and so covers no seat", async () => {
    const h = await account("ft-holder");
    await grant(h.id, "ultra");
    const m = await account("ft-member");
    const s = await seat(h.id, m.id, -1);
    await plan(h.id);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withoutTiers(async () => {
      const r = recording();
      expect(await planFor(r.env, await holderOf(h.id))).toStrictEqual({ plan: "pro", until: null, source: "entitlements" });
      expect(r.sql).toEqual([PLAN_ROWS_SQL, PLAN_ROWS_SQL_NO_TIERS]);
      expect(await plan(m.id)).toStrictEqual({
        plan: "free", until: null, source: "entitlements", seat: { id: s, holderId: h.id, holderEmail: h.email, covered: false },
      });
    });
    expect((await plan(m.id)).plan).toBe("ultra");
  });
});

describe("deletion and the sweep", () => {
  it("ends the seats an account gives and the one it holds, and removes the invitations to its address", async () => {
    const email = newEmail("del");
    const cookie = await signIn(email);
    const me = await userId(email);
    await grant(me, "ultra");
    const member = await account("del-member");
    const given = await seat(me, member.id, -5);
    const open = await invite(me, newEmail("del-invitee"), -1);
    const before = await seat(me, (await account("del-earlier")).id, -20, { ended: -10, why: "left" });
    const g = await account("del-holder");
    await grant(g.id, "ultra");
    const held = await seat(g.id, me, -4);
    const toMe = await invite(g.id, email, -2);
    const declined = await invite(g.id, email, -6, { ended: -5, why: "declined" });
    const other = await invite(g.id, newEmail("del-other"), -2);
    expect((await plan(member.id)).group?.holderId).toBe(me);
    const res = await post("/account/delete", { csrf: await csrf(cookie), confirm: "yes" }, { cookie });
    expect(res.status).toBe(200);
    const row = (id: string) => ACCOUNTS.prepare("SELECT ended_at, ended_why, email, token_hash, told FROM seats WHERE id = ?").bind(id)
      .first<{ ended_at: string | null; ended_why: string | null; email: string | null; token_hash: string | null; told: number }>();
    for (const id of [given, open]) {
      expect(await row(id)).toMatchObject({ ended_why: "closed", email: null, token_hash: null });
      expect((await row(id))?.ended_at).not.toBeNull();
    }
    expect(await row(before)).toMatchObject({ ended_at: iso(-10), ended_why: "left" });
    expect(await row(held)).toMatchObject({ ended_why: "deleted", told: 0 });
    expect((await row(held))?.ended_at).not.toBeNull();
    expect(await row(toMe)).toBeNull();
    expect(await row(declined)).toBeNull();
    expect(await row(other)).toMatchObject({ ended_at: null, ended_why: null });
    // Neither side reads a seat now.
    expect(await plan(member.id)).toStrictEqual({ plan: "free", until: null, source: "entitlements" });
    expect((await plan(g.id)).group).toBeUndefined();
    expect(JSON.stringify(await ACCOUNTS.prepare("SELECT * FROM seats WHERE holder_id = ?1 OR member_id = ?1").bind(me).all())).not.toContain(email);
  });

  it("still deletes everything else while the table is missing", async () => {
    const email = newEmail("del-no-table");
    const cookie = await signIn(email);
    const me = await userId(email);
    const token = await csrf(cookie);
    await post("/account/searches", { csrf: token, url: "/segments/82" }, { cookie });
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?").bind(me).first<{ n: number }>())?.n).toBe(1);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withoutSeats(async () => {
      expect((await post("/account/delete", { csrf: token, confirm: "yes" }, { cookie })).status).toBe(200);
    });
    expect(await ACCOUNTS.prepare("SELECT status FROM users WHERE id = ?").bind(me).first()).toEqual({ status: "deleted" });
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM saved_searches WHERE user_id = ?").bind(me).first<{ n: number }>())?.n).toBe(0);
  });

  it("keeps a seat 30 days after it ends and an invitation 30 days after it was sent, and a live seat whatever its age", async () => {
    expect(SEAT_KEEP_DAYS).toBe(30);
    const h = await account("sweep");
    const ids = {
      old_invite: await invite(h.id, newEmail("sw-1"), -31),
      new_invite: await invite(h.id, newEmail("sw-2"), -29),
      old_declined: await invite(h.id, newEmail("sw-3"), -29.5, { ended: -29, why: "declined" }),
      old_ended: await seat(h.id, (await account("sw-4")).id, -90, { ended: -31, why: "left" }),
      new_ended: await seat(h.id, (await account("sw-5")).id, -90, { ended: -29, why: "removed" }),
      live: await seat(h.id, (await account("sw-6")).id, -400),
    };
    await sweep(onEnv() as never, NOW);
    const left = ((await ACCOUNTS.prepare("SELECT id FROM seats WHERE holder_id = ?").bind(h.id).all<{ id: string }>()).results ?? []).map((r) => r.id);
    // The declined invitation was sent 29.5 days ago: kept, as an invitation is, until 30 days after it was sent.
    expect(Object.entries(ids).filter(([, id]) => left.includes(id)).map(([k]) => k)).toEqual(["new_invite", "old_declined", "new_ended", "live"]);
    await sweep(onEnv() as never, new Date(NOW.getTime() + 2 * 86_400_000));
    const after = ((await ACCOUNTS.prepare("SELECT id FROM seats WHERE holder_id = ?").bind(h.id).all<{ id: string }>()).results ?? []).map((r) => r.id);
    expect(after).toEqual([ids.live]);
  });

  it("sweeps without a line while the table is missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await withoutSeats(() => sweep(onEnv() as never, NOW));
    expect(error.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("seats"))).toEqual([]);
    expect(SEATS_SWEEP_SQL).toContain("?1");
  });
});

describe("the overview's plan line", () => {
  it("names the holder for a member whose seat gives the plan, in place of the end date, in both languages", async () => {
    const h = await account("ov-holder");
    await grant(h.id, "ultra", { ends: iso(45) });
    const email = newEmail("ov-member");
    const cookie = await signIn(email);
    await seat(h.id, await userId(email), -2);
    const en = text(await (await get("/account", { cookie })).text());
    expect(en).toContain(`<dd>Ultra, a seat on the subscription of ${h.email}</dd>`);
    expect(en).not.toContain(day(45));
    const fr = text(await (await get("/account?lang=fr", { cookie })).text());
    expect(fr).toContain(`<dd>Ultra, siège de l'abonnement de ${h.email}</dd>`);
    expect(fr).not.toContain(day(45));
    for (const page of [en, fr]) {
      expect(page).not.toContain(EM_DASH);
      expect(page).not.toContain(EN_DASH);
    }
  });

  it("tells a member whose seat gives no plan now, beside its own plan line, in both languages", async () => {
    const h = await account("ov-lapsed");
    await grant(h.id, "ultra", { ends: iso(-1) });
    const email = newEmail("ov-uncovered");
    const cookie = await signIn(email);
    const me = await userId(email);
    await seat(h.id, me, -20);
    expect(text(await (await get("/account", { cookie })).text()))
      .toContain(`<dd>You hold a seat on the subscription of ${h.email}, which gives no plan now. Your account is on Free.</dd>`);
    expect(text(await (await get("/account?lang=fr", { cookie })).text())).toContain(
      `<dd>Vous occupez un siège de l'abonnement de ${h.email}, qui ne donne aucun forfait pour le moment. Votre compte est au forfait Gratuit.</dd>`,
    );
    // A plan of its own keeps its own line inside the sentence.
    await grant(me, "pro", { ends: iso(25) });
    expect(text(await (await get("/account", { cookie })).text()))
      .toContain(`<dd>You hold a seat on the subscription of ${h.email}, which gives no plan now. Your account is on Pro, until ${day(25)}.</dd>`);
  });
});

describe("the console's Seats panel", () => {
  async function operator() {
    const email = newEmail("op");
    const env = onEnv({ OPERATOR_EMAILS: email });
    const cookie = await signIn(email, { env });
    return { cookie, env };
  }
  type Op = Awaited<ReturnType<typeof operator>>;
  const userPage = async (op: Op, id: string, lang = "") => {
    const res = await get(`/admin/users/${id}${lang ? `?lang=${lang}` : ""}`, { cookie: op.cookie, env: op.env });
    expect(res.status).toBe(200);
    return text(await res.text());
  };
  const panelOf = (html: string) => {
    const at = html.indexOf("<h2>Seats</h2>") >= 0 ? html.indexOf("<h2>Seats</h2>") : html.indexOf("<h2>Sièges</h2>");
    return at < 0 ? null : html.slice(at, html.indexOf("</section>", at));
  };

  it("lists the seats a holder gives, by address, with their states and dates, and the seat a member holds", async () => {
    const op = await operator();
    const h = await account("c-holder");
    await grant(h.id, "ultra");
    const m = await account("c-member");
    await seat(h.id, m.id, -10);
    const invitee = newEmail("c-invitee");
    await invite(h.id, invitee, -1);
    const stale = newEmail("c-stale");
    await invite(h.id, stale, -10);
    const gone = await account("c-gone");
    await seat(h.id, gone.id, -20, { ended: -2, why: "left" });
    const panel = panelOf(await userPage(op, h.id))!;
    // Beside a seat row the panel has its actions column (whatever the seats' switch says: a live seat gives the plan
    // either way, so the operator can always end one), and an address may break after its "@" and dots to keep the
    // table in its box.
    const broken = (address: string) => address.split(/(?<=[@.])/).join("<wbr/>");
    expect(panel).toContain("3 of 5 seats: this account, 1 members, 1 invitations open");
    expect(panel).toContain(`<a href="/admin/users/${m.id}">${broken(m.email)}</a>`);
    expect(panel).toContain("Taken, gives the plan");
    expect(panel).toContain(broken(invitee));
    expect(panel).toContain(`Invited, link works until ${day(6)}`);
    expect(panel).toContain(broken(stale));
    expect(panel).toContain("Invitation expired");
    expect(panel).toContain(`<span class="muted"><a href="/admin/users/${gone.id}">${broken(gone.email)}</a></span>`);
    expect(panel).toContain('<span class="muted">left</span>');
    // One action a row still open: the live seat's and the open invitation's, none for the expired or the ended.
    expect(panel.match(/\/seats\/[0-9a-f]{32}\/end"/g)).toHaveLength(1);
    expect(panel.match(/\/seats\/[0-9a-f]{32}\/invite-cancel"/g)).toHaveLength(1);
    // The member's page names the holder and whether the seat gives the plan, in both languages.
    expect(panelOf(await userPage(op, m.id))).toContain(
      `A seat on <a href="/admin/users/${h.id}">${h.email}</a> since <span class="mono">${day(-10)}</span>; it gives Ultra now`,
    );
    expect(panelOf(await userPage(op, m.id, "fr"))).toContain(
      `Un siège de <a href="/admin/users/${h.id}">${h.email}</a> depuis le <span class="mono">${day(-10)}</span>; il donne Ultra maintenant`,
    );
    // A seat its holder's plan no longer covers reads so on both pages.
    await ACCOUNTS.prepare("UPDATE entitlements SET revoked_at = ? WHERE user_id = ?").bind(iso(0), h.id).run();
    expect(panelOf(await userPage(op, h.id))).toContain("Taken, without the plan for now");
    expect(panelOf(await userPage(op, m.id))).toContain("; it gives no plan now");
    for (const html of [await userPage(op, h.id), await userPage(op, m.id)]) expect(panelOf(html)).not.toMatch(/<form|<button/);
  });

  it("is left out for an account with neither, and the page reads the same with the table present and absent", async () => {
    const op = await operator();
    const plain = await account("c-plain");
    await grant(plain.id, "ultra");
    // The first view brings the cached plan up to date, which the page shows; the second is the one held.
    await userPage(op, plain.id);
    const html = await userPage(op, plain.id);
    expect(panelOf(html)).toBeNull();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withoutSeats(async () => expect(await userPage(op, plain.id)).toBe(html));
  });
});
