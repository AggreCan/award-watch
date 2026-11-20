// Seats, slice C1, with the switch on (SEATS "on"; the seats design's 1.3, 1.4, 2.3, 4.5, 5.1 to 5.4, 7 and 8):
// the invitation and its six refusals, held inside its insert; its message, counted against the day's mail
// ceiling and written to the run log; the join page, which uses nothing up; taking and declining a seat, bound to
// the invited address and to the link's secret; What Fits, which is the pool's own rule; the Seats page of a
// holder and of a member, counts and never content; leaving and removing; a member's billing page and checkout;
// the posts' guards. Every clock here is the real one: each row a fixture writes is placed relative to it.
// test/seats-switch.test.ts holds the site with the switch off.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAY_SENT_SQL } from "../src/account/deliveries";
import { PLAN_SEATS, RULES, planFor } from "../src/account/entitlements";
import { SEATS_STRINGS } from "../src/account/seats_strings";
import {
  INVITE_SQL, SEAT_INVITES_PER_ADDRESS, SEAT_INVITES_PER_DAY, SEAT_INVITE_DAYS, SEAT_SWAPS, SEAT_WINDOW_DAYS, TAKE_SQL, joinsAllowed,
} from "../src/account/seats";
import { t, type Key, type Lang } from "../src/i18n";
import { collectAlerts, gatherInputs } from "../src/watchdog";
import { testEnv } from "./assets";
import {
  ACCOUNTS, PRO_SALE, codeIn, csrf, decode, get, grantPro, grantUltra, lastMail, nbsp, newEmail, onEnv, post, sessionCookie, signIn,
  useAccountsDb, userId, withoutSeats,
} from "./accounts-helpers";

useAccountsDb();

afterEach(() => {
  vi.restoreAllMocks();
});

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const ON = (extra: Record<string, unknown> = {}) => onEnv({ SEATS: "on", ...extra });
const DAY_MS = 86_400_000;
const iso = (days: number, ms = 0) => new Date(Date.now() + days * DAY_MS + ms).toISOString();
const hexId = () => crypto.randomUUID().replace(/-/g, "");
const text = (s: string) => nbsp(decode(s)).replace(/’/g, "'");
const line = (lang: Lang, key: Key, vars?: Record<string, string | number>) => text(t(lang, key, vars));
const read = async (res: Response) => text(await res.text());

async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// -- people --------------------------------------------------------------------------------------------

type Person = { email: string; id: string; cookie: string };

// A signed-in account, Free unless a plan is given (granted by hand, as the console does).
async function person(tag: string, plan: "free" | "pro" | "ultra" = "free"): Promise<Person> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  if (plan === "ultra") await grantUltra(email);
  if (plan === "pro") await grantPro(email);
  return { email, id: await userId(email), cookie };
}

// An account as a users row only, never signed in.
async function bare(tag: string): Promise<{ id: string; email: string }> {
  const id = hexId();
  const email = newEmail(tag);
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, 'en', 'active', 'free')").bind(id, email, iso(-400)).run();
  return { id, email };
}

const token = (p: Person) => csrf(p.cookie, "/account", { env: ON() });

function invitePost(h: Person, csrfValue: string, email: string, o: { lang?: Lang; env?: object; page?: Lang } = {}) {
  return post("/account/seats/invite", { csrf: csrfValue, email, message_lang: o.lang ?? "en", lang: o.page ?? "en" }, { cookie: h.cookie, env: o.env ?? ON() });
}
async function invite(h: Person, email: string, o: { lang?: Lang; env?: object; page?: Lang } = {}) {
  return invitePost(h, await token(h), email, o);
}

type Link = { i: string; t: string };
async function linkTo(email: string): Promise<Link> {
  const mail = await lastMail(email);
  const m = /\/account\/seats\/join\?i=([0-9a-f]{32})&t=([0-9a-f]{64})/.exec(mail?.text ?? "");
  if (!m) throw new Error("no invitation link");
  return { i: m[1], t: m[2] };
}
const joinGet = (l: Link, cookie?: string, lang?: Lang) =>
  get(`/account/seats/join?i=${l.i}&t=${l.t}${lang === "fr" ? "&lang=fr" : ""}`, { cookie, env: ON() });
async function joinPost(p: Person, l: Link, action: string, csrfValue?: string) {
  return post("/account/seats/join", { csrf: csrfValue ?? (await token(p)), i: l.i, t: l.t, action }, { cookie: p.cookie, env: ON() });
}

type SeatRow = {
  id: string; holder_id: string; email: string | null; token_hash: string | null; lang: string; invited_at: string; expires_at: string;
  member_id: string | null; joined_at: string | null; ended_at: string | null; ended_why: string | null; told: number; told_at: string | null;
};
const rowsOf = async (holderId: string) =>
  (await ACCOUNTS.prepare("SELECT * FROM seats WHERE holder_id = ? ORDER BY invited_at, id").bind(holderId).all<SeatRow>()).results ?? [];
const rowById = async (id: string) => ACCOUNTS.prepare("SELECT * FROM seats WHERE id = ?").bind(id).first<SeatRow>();
const one = async (sql: string, ...binds: unknown[]) => Number((await ACCOUNTS.prepare(sql).bind(...binds).first<{ n: number }>())?.n ?? 0);
const mailsTo = (email: string) => one("SELECT COUNT(*) AS n FROM sent_mail WHERE to_addr = ?", email);
const inviteRuns = () => one("SELECT COUNT(*) AS n FROM delivery_runs WHERE outcome = 'invite'");

// Seat rows by fixture, at times relative to now.
async function seatRow(holder: string, o: {
  member?: string; joined?: number; ended?: number; why?: string; email?: string; invited?: number; expires?: number; hash?: string | null;
}): Promise<string> {
  const id = hexId();
  const invited = o.invited ?? (o.joined !== undefined ? o.joined - 1 : 0);
  await ACCOUNTS.prepare(
    "INSERT INTO seats (id, holder_id, email, token_hash, lang, invited_at, expires_at, member_id, joined_at, ended_at, ended_why) VALUES (?, ?, ?, ?, 'en', ?, ?, ?, ?, ?, ?)",
  ).bind(
    id, holder, o.member ? null : o.email ?? newEmail("fixture"), o.member ? null : o.hash === undefined ? "f".repeat(64) : o.hash, iso(invited),
    iso(o.expires ?? invited + SEAT_INVITE_DAYS), o.member ?? null, o.member ? iso(o.joined ?? 0) : null, o.ended === undefined ? null : iso(o.ended),
    o.why ?? null,
  ).run();
  return id;
}

// Saved searches by fixture, made at fixed steps after `from` days ago, labelled as given.
async function searches(user: string, n: number, from: number, label = "Fixture search") {
  const stmts = Array.from({ length: n }, (_, i) => ACCOUNTS.prepare(
    "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, 'off')",
  ).bind(hexId(), user, `/tenders?segment=${10 + (i % 80)}&n=${i}`, `${label} ${i + 1}`, iso(-from, i * 1000)));
  for (let i = 0; i < stmts.length; i += 50) await ACCOUNTS.batch(stmts.slice(i, i + 50));
}

// =========================================================================================================
// 1. The invitation
// =========================================================================================================

describe("an invitation", () => {
  it("sends one message to an address with no account, keeps the address and its link's hash alone, and counts it as a send", async () => {
    const h = await person("inv-holder", "ultra");
    const to = newEmail("inv-new");
    const runs = await inviteRuns();
    const res = await invite(h, to);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const page = await read(res);
    expect(page).toContain(line("en", "seats.msg_sent", { email: to }));
    const [row] = await rowsOf(h.id);
    expect(row).toMatchObject({ email: to, lang: "en", member_id: null, joined_at: null, ended_at: null, told: 1 });
    expect(Date.parse(row.expires_at) - Date.parse(row.invited_at)).toBe(SEAT_INVITE_DAYS * DAY_MS);
    // The secret is in the link alone; the row keeps SHA-256 of it.
    const link = await linkTo(to);
    expect(link.i).toBe(row.id);
    expect(row.token_hash).toBe(await sha256Hex(link.t));
    expect(JSON.stringify(row)).not.toContain(link.t);
    expect(await mailsTo(to)).toBe(1);
    expect(await inviteRuns()).toBe(runs + 1);
    const run = await ACCOUNTS.prepare("SELECT outcome, sent, failed, left_due, data_date, detail FROM delivery_runs WHERE outcome = 'invite' ORDER BY id DESC LIMIT 1").first();
    expect(run).toEqual({ outcome: "invite", sent: 1, failed: 0, left_due: 0, data_date: null, detail: "a seat's invitation" });
    expect(await ACCOUNTS.prepare("SELECT user_id, detail FROM audit WHERE event = 'seat_invited' AND user_id = ?").bind(h.id).first()).toEqual({ user_id: h.id, detail: null });
    // The page lists it, with when its link ends, and its Cancel.
    expect(page).toContain(to);
    expect(page).toContain(line("en", "seats.state_invited", { date: row.expires_at.slice(0, 10) }));
    expect(page).toContain(`action="/account/seats/${row.id}/cancel"`);
  });

  it("answers the holder the same for an address with an account as for one without", async () => {
    const known = await person("inv-known");
    const pages: string[] = [];
    for (const to of [known.email, newEmail("inv-unknown")]) {
      const h = await person("inv-same", "ultra");
      const res = await invite(h, to);
      expect(res.status).toBe(200);
      pages.push((await read(res)).split(h.email).join("HOLDER").split(to).join("INVITED").replace(/[0-9a-f]{32}/g, "ID"));
    }
    expect(pages[0]).toBe(pages[1]);
  });

  it("refuses the holder's own address before anything is written", async () => {
    const h = await person("inv-self", "ultra");
    const before = [await mailsTo(h.email), await inviteRuns()];
    const res = await invite(h, h.email.toUpperCase());
    expect(res.status).toBe(409);
    expect(await read(res)).toContain(line("en", "seats.err_self"));
    expect(await rowsOf(h.id)).toEqual([]);
    expect([await mailsTo(h.email), await inviteRuns()]).toEqual(before);
  });

  it("refuses an address in form only, and a language not offered", async () => {
    const h = await person("inv-form", "ultra");
    const bad = await invite(h, "not an address");
    expect(bad.status).toBe(400);
    expect(await read(bad)).toContain(line("en", "interest.err_email"));
    const res = await post("/account/seats/invite", { csrf: await token(h), email: newEmail("x"), message_lang: "de" }, { cookie: h.cookie, env: ON() });
    expect(res.status).toBe(400);
    expect(await rowsOf(h.id)).toEqual([]);
  });

  it("holds each of the insert's six refusals with its line, writing nothing and sending nothing", { timeout: 30_000 }, async () => {
    const cases: [string, (h: Person) => Promise<string>, (to: string) => string][] = [
      // An address that holds a seat of this holder.
      ["member", async (h) => {
        const m = await bare("ref-member");
        await seatRow(h.id, { member: m.id, joined: -3 });
        return m.email;
      }, (to) => line("en", "seats.err_member", { email: to })],
      // An address with an invitation of this holder waiting.
      ["open", async (h) => {
        const to = newEmail("ref-open");
        await seatRow(h.id, { email: to, invited: -1 });
        return to;
      }, (to) => line("en", "seats.err_open", { email: to })],
      // Every seat in use: four, live seats and open invitations together.
      ["full", async (h) => {
        for (let i = 0; i < 2; i++) await seatRow(h.id, { member: (await bare("ref-full-m")).id, joined: -5 + i });
        for (let i = 0; i < 2; i++) await seatRow(h.id, { invited: -1 });
        return newEmail("ref-full");
      }, () => line("en", "seats.err_full", { cap: PLAN_SEATS.ultra })],
      // Six joins in the window, every one of them ended: counted across ended rows.
      ["joins", async (h) => {
        for (let i = 0; i < 6; i++) await seatRow(h.id, { member: (await bare("ref-joins-m")).id, joined: -20 + i, ended: -19 + i, why: "left" });
        return newEmail("ref-joins");
      }, () => line("en", "seats.err_joins", { n: 6, date: iso(-20 + SEAT_WINDOW_DAYS).slice(0, 10) })],
      // Ten invitations in 24 hours, each cancelled, so no seat is in use.
      ["day", async (h) => {
        for (let i = 0; i < SEAT_INVITES_PER_DAY; i++) await seatRow(h.id, { invited: 0, ended: 0, why: "cancelled", hash: null });
        return newEmail("ref-day");
      }, () => line("en", "seats.err_day", { n: SEAT_INVITES_PER_DAY })],
      // Two invitations to one address in 30 days, both cancelled, three days ago.
      ["address", async (h) => {
        const to = newEmail("ref-address");
        for (let i = 0; i < SEAT_INVITES_PER_ADDRESS; i++) await seatRow(h.id, { email: to, invited: -3, ended: -3, why: "cancelled", hash: null });
        return to;
      }, () => line("en", "seats.err_address", { n: SEAT_INVITES_PER_ADDRESS })],
    ];
    for (const [name, arrange, words] of cases) {
      const h = await person(`ref-${name}`, "ultra");
      const to = await arrange(h);
      const rows = await rowsOf(h.id);
      const runs = await inviteRuns();
      const res = await invite(h, to);
      expect(res.status, name).toBe(409);
      const page = await read(res);
      expect(page, name).toContain(words(to));
      expect(await rowsOf(h.id), name).toEqual(rows);
      expect(await mailsTo(to), name).toBe(0);
      expect(await inviteRuns(), name).toBe(runs);
    }
    expect([SEAT_INVITES_PER_DAY, SEAT_INVITES_PER_ADDRESS, SEAT_SWAPS, joinsAllowed("ultra"), joinsAllowed("pro")]).toEqual([10, 2, 2, 6, 0]);
  });

  it("counts the seats in use inside the insert: two invitations at once for the last free seat, one goes", async () => {
    const h = await person("inv-race", "ultra");
    for (let i = 0; i < 3; i++) await seatRow(h.id, { invited: -1 });
    const c = await token(h);
    const [a, b] = [newEmail("race-a"), newEmail("race-b")];
    const answers = await Promise.all([invitePost(h, c, a), invitePost(h, c, b)]);
    expect(answers.map((r) => r.status).sort()).toEqual([200, 409]);
    const open = (await rowsOf(h.id)).filter((r) => !r.ended_at && !r.member_id);
    expect(open).toHaveLength(4);
    expect((await mailsTo(a)) + (await mailsTo(b))).toBe(1);
    // The statement itself, twice at once on the database: one row.
    const h2 = await bare("inv-race-sql");
    for (let i = 0; i < 3; i++) await seatRow(h2.id, { invited: -1 });
    const now = new Date();
    const at = now.toISOString();
    const bind = (to: string) => ACCOUNTS.prepare(INVITE_SQL).bind(
      hexId(), h2.id, to, "e".repeat(64), "en", at, iso(7), 4, iso(-1), SEAT_INVITES_PER_DAY, iso(-30), SEAT_INVITES_PER_ADDRESS, joinsAllowed("ultra"),
    ).run();
    const both = await Promise.all([bind(newEmail("sql-a")), bind(newEmail("sql-b"))]);
    expect(both.map((r) => r.meta.changes).sort()).toEqual([0, 1]);
  });

  it("is refused once the day's mail ceiling is reached, writing no row and sending nothing", async () => {
    const h = await person("inv-ceiling", "ultra");
    const start = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
    const sent = await one(DAY_SENT_SQL, start, new Date(Date.parse(start) + DAY_MS).toISOString());
    // A ceiling with room for one more message today.
    const env = ON({ MAIL_DAILY_QUOTA: String(sent + 2), MAIL_DAILY_RESERVE: "1" });
    expect((await invite(h, newEmail("ceil-a"), { env })).status).toBe(200);
    const runs = await inviteRuns();
    const to = newEmail("ceil-b");
    const rows = await rowsOf(h.id);
    const res = await invite(h, to, { env });
    expect(res.status).toBe(429);
    expect(await read(res)).toContain(line("en", "seats.err_today"));
    expect(await rowsOf(h.id)).toEqual(rows);
    expect(await inviteRuns()).toBe(runs);
    expect(await mailsTo(to)).toBe(0);
  });

  it("goes out as the sign-in message does: one recipient, no List-Unsubscribe, Auto-Submitted, the reply to the contact address", async () => {
    const h = await person("inv-headers", "ultra");
    const handed: Record<string, unknown>[] = [];
    const MAIL = { send: async (m: Record<string, unknown>) => { handed.push(m); return { messageId: "x" }; } };
    const env = ON({ MAIL, MAIL_SENDER: undefined, MAIL_FROM: "alerts@awardwatch.ca", SITE_URL: "https://awardwatch.ca" });
    const to = newEmail("inv-headers-to");
    expect((await invite(h, to, { env, lang: "fr" })).status).toBe(200);
    expect(handed).toHaveLength(1);
    const m = handed[0] as { to: string; from: unknown; replyTo: string; subject: string; headers: Record<string, string>; text: string };
    expect(m.to).toBe(to);
    expect(m.from).toEqual({ email: "alerts@awardwatch.ca", name: "Award Watch" });
    expect(m.replyTo).toBe("contact@awardwatch.ca");
    expect(m.headers).toEqual({ "Auto-Submitted": "auto-generated" });
    expect(m.subject).toBe(t("fr", "invite.subject"));
    expect(m.text).toContain(h.email);
    // A local run links its own origin, as the sign-in message does.
    expect(m.text).toMatch(/http:\/\/localhost\/account\/seats\/join\?i=[0-9a-f]{32}&t=[0-9a-f]{64}&lang=fr\n/);
  });

  it("keeps nothing when the message does not go: the row removed, a failed run row, the holder told", async () => {
    const h = await person("inv-fail", "ultra");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const MAIL = { send: async () => { throw Object.assign(new Error(`refused for ${h.email}`), { code: "E_SENDER_NOT_VERIFIED" }); } };
    const env = ON({ MAIL, MAIL_SENDER: undefined, MAIL_FROM: "alerts@awardwatch.ca" });
    const runs = await inviteRuns();
    const res = await invite(h, newEmail("inv-fail-to"), { env });
    expect(res.status).toBe(503);
    expect(await read(res)).toContain(line("en", "seats.err_send"));
    expect(await rowsOf(h.id)).toEqual([]);
    expect(await inviteRuns()).toBe(runs + 1);
    expect(await ACCOUNTS.prepare("SELECT sent, failed FROM delivery_runs WHERE outcome = 'invite' ORDER BY id DESC LIMIT 1").first()).toEqual({ sent: 0, failed: 1 });
  });

  it("is refused to a member, to Free and Pro, and to a post without the CSRF value or from another site", async () => {
    const holder = await bare("inv-guard-h");
    await grantUltra(holder.email);
    const member = await person("inv-guard-m");
    await seatRow(holder.id, { member: member.id, joined: -2 });
    for (const who of [member, await person("inv-guard-free"), await person("inv-guard-pro", "pro")]) {
      const to = newEmail("inv-guard-to");
      const res = await invite(who, to);
      expect(res.status).toBe(403);
      expect(await rowsOf(who.id)).toEqual([]);
      expect(await mailsTo(to)).toBe(0);
    }
    const h = await person("inv-guard-ultra", "ultra");
    const to = newEmail("inv-guard-csrf");
    expect((await invitePost(h, "0".repeat(32), to)).status).toBe(403);
    expect((await post("/account/seats/invite", { csrf: await token(h), email: to, message_lang: "en" }, { cookie: h.cookie, env: ON(), origin: "https://elsewhere.example" })).status).toBe(403);
    expect((await post("/account/seats/invite", { email: to, message_lang: "en" }, { env: ON() })).status).toBe(303);
    expect(await rowsOf(h.id)).toEqual([]);
  });
});

// =========================================================================================================
// 2. The invitation's page
// =========================================================================================================

describe("the invitation's page", () => {
  it("uses nothing up: a GET signed out or signed in, as often as it is opened, changes no row", async () => {
    const h = await person("join-get", "ultra");
    const to = newEmail("join-get-to");
    await invite(h, to);
    const l = await linkTo(to);
    const before = await rowById(l.i);
    const out = await read(await joinGet(l));
    expect(out).toContain(line("en", "join.lead", { holder: h.email, email: to }));
    expect(out).toContain(line("en", "join.sign_in", { email: to }));
    expect(out).toContain(`name="next" value="/account/seats/join?i=${l.i}&amp;t=${l.t}"`.replace("&amp;", "&"));
    expect(out).not.toContain(t("en", "join.take"));
    // What a seat gives: the Ultra card's own lines of the figures the subscription shares, none of each person's own.
    const gives = out.slice(out.indexOf(line("en", "join.what_title")));
    expect(gives).toContain(`${RULES.ultra.saved_searches} saved searches and briefings`);
    expect(gives).toContain(`${RULES.ultra.dashboards} dashboards`);
    expect(gives.slice(0, gives.indexOf(line("en", "account.email_panel")))).not.toMatch(/matching notices|fiscal years/);
    for (let i = 0; i < 3; i++) await joinGet(l);
    const invited = await person("join-get-in");
    await ACCOUNTS.prepare("UPDATE seats SET email = ? WHERE id = ?").bind(invited.email, l.i).run();
    const mid = await rowById(l.i);
    for (let i = 0; i < 2; i++) expect((await joinGet(l, invited.cookie)).status).toBe(200);
    expect(await rowById(l.i)).toEqual(mid);
    expect({ ...before, email: invited.email }).toEqual(mid);
    expect(await one("SELECT COUNT(*) AS n FROM audit WHERE event IN ('seat_taken', 'seat_declined') AND user_id = ?", invited.id)).toBe(0);
  });

  it("answers join.stale alike for a wrong, malformed, unknown, run out, cancelled, declined or taken link", { timeout: 30_000 }, async () => {
    const h = await person("join-stale", "ultra");
    const link = async (tag: string) => {
      const to = newEmail(tag);
      await invite(h, to);
      return { to, l: await linkTo(to) };
    };
    const good = await link("stale-good");
    const ran = await link("stale-ran");
    await ACCOUNTS.prepare("UPDATE seats SET expires_at = ? WHERE id = ?").bind(iso(0, -60_000), ran.l.i).run();
    const cancelled = await link("stale-cancel");
    await post(`/account/seats/${cancelled.l.i}/cancel`, { csrf: await token(h) }, { cookie: h.cookie, env: ON() });
    const declined = await link("stale-decline");
    const d = await person("stale-decliner");
    await ACCOUNTS.prepare("UPDATE seats SET email = ? WHERE id = ?").bind(d.email, declined.l.i).run();
    expect((await joinPost(d, declined.l, "decline")).status).toBe(200);
    const taken = await link("stale-taken");
    const tk = await person("stale-taker");
    await ACCOUNTS.prepare("UPDATE seats SET email = ? WHERE id = ?").bind(tk.email, taken.l.i).run();
    expect((await joinPost(tk, taken.l, "take")).status).toBe(303);
    const cases: Link[] = [
      { i: good.l.i, t: "0".repeat(64) }, { i: good.l.i, t: good.l.t.slice(0, 63) }, { i: "x".repeat(32), t: good.l.t }, { i: hexId(), t: good.l.t },
      ran.l, cancelled.l, declined.l, taken.l,
    ];
    const bodies = new Set<string>();
    for (const l of cases) {
      for (const cookie of [undefined, tk.cookie]) {
        const res = await joinGet(l, cookie);
        expect(res.status).toBe(400);
        const body = await read(res);
        expect(body).toContain(line("en", "join.stale"));
        expect(body).not.toContain(h.email);
        bodies.add(`${cookie ? "in" : "out"} ${body.replace(/name="csrf" value="[0-9a-f]{32}"/g, "")}`);
      }
    }
    // One page signed out, one signed in, whatever the link.
    expect(bodies.size).toBe(2);
    // The post answers the same for each.
    for (const l of cases) {
      const res = await joinPost(tk, l, "take");
      expect(res.status).toBe(400);
      expect(await read(res)).toContain(line("en", "join.stale"));
    }
  });

  it("takes the seat only for a session of the invited address, through its own sign-in: the link alone gives nothing", async () => {
    const h = await person("take-holder", "ultra");
    const to = newEmail("take-to");
    await invite(h, to);
    const l = await linkTo(to);
    // Another account with the link: told whose it is, and its post changes nothing.
    const other = await person("take-other");
    const seen = await read(await joinGet(l, other.cookie));
    expect(seen).toContain(line("en", "join.other", { email: to, you: other.email }));
    expect(seen).not.toContain(t("en", "join.take"));
    const before = await rowById(l.i);
    const refused = await joinPost(other, l, "take");
    expect(refused.status).toBe(403);
    expect(await rowById(l.i)).toEqual(before);
    expect((await joinPost(other, l, "decline")).status).toBe(403);
    expect(await rowById(l.i)).toEqual(before);
    // The invited address signs in from the page: the code's message carries the page back, and the sign-in ends on it.
    const next = `/account/seats/join?i=${l.i}&t=${l.t}`;
    expect((await post("/account/sign-in", { email: to, next }, { env: ON() })).status).toBe(200);
    const mail = await lastMail(to);
    expect(mail?.text).toContain(`next=${encodeURIComponent(next)}`);
    const check = await post("/account/check", { email: to, code: codeIn(mail?.text ?? ""), sent: "1", next }, { env: ON() });
    expect(check.status).toBe(303);
    expect(check.headers.get("location")).toBe(next);
    const member: Person = { email: to, id: await userId(to), cookie: sessionCookie(check) };
    const page = await read(await joinGet(l, member.cookie));
    expect(page).toContain(t("en", "join.take"));
    expect(page).toContain(line("en", "join.room_none"));
    const res = await joinPost(member, l, "take");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/seats?m=taken");
    const row = await rowById(l.i);
    expect(row).toMatchObject({ member_id: member.id, email: null, token_hash: null, ended_at: null, told: 1 });
    expect(row?.joined_at).toBeTruthy();
    expect(await ACCOUNTS.prepare("SELECT detail FROM audit WHERE event = 'seat_taken' AND user_id = ?").bind(member.id).first()).toEqual({ detail: null });
    // The member reads Ultra through the seat, and its Seats page says so.
    const seats = await read(await get("/account/seats?m=taken", { cookie: member.cookie, env: ON() }));
    expect(seats).toContain(line("en", "join.msg_taken"));
    expect(seats).toContain(line("en", "seat.covered", { holder: h.email }));
    const overview = await read(await get("/account", { cookie: member.cookie, env: ON() }));
    expect(overview).toContain(line("en", "account.plan_seat", { plan: "Ultra", holder: h.email }));
    expect(overview).toContain('<dt>Seats</dt><dd><a href="/account/seats">Your seat</a></dd>');
    // Single use: the link is stale now, for anyone.
    expect((await joinGet(l, member.cookie)).status).toBe(400);
  });

  it("refuses an account with its own paid plan and one seated elsewhere, offering Decline alone; a decline frees the seat at once", async () => {
    const h = await person("own-holder", "ultra");
    const pro = await person("own-pro", "pro");
    await invite(h, pro.email);
    const l = await linkTo(pro.email);
    const page = await read(await joinGet(l, pro.cookie));
    expect(page).toContain(line("en", "join.own_plan", { holder: h.email }));
    expect(page).not.toContain(t("en", "join.take"));
    expect(page).toContain(t("en", "join.decline"));
    const before = await rowById(l.i);
    const res = await joinPost(pro, l, "take");
    expect(res.status).toBe(409);
    expect(await read(res)).toContain(line("en", "join.own_plan", { holder: h.email }));
    expect(await rowById(l.i)).toEqual(before);
    // Seated on another holder's subscription.
    const other = await bare("own-other-holder");
    await grantUltra(other.email);
    const seated = await person("own-seated");
    await seatRow(other.id, { member: seated.id, joined: -4 });
    await invite(h, seated.email);
    const l2 = await linkTo(seated.email);
    expect(await read(await joinGet(l2, seated.cookie))).toContain(line("en", "join.seated"));
    expect((await joinPost(seated, l2, "take")).status).toBe(409);
    // Declining: ended, the hash cleared, the seat free at once.
    const used = (await rowsOf(h.id)).filter((r) => !r.ended_at).length;
    const declined = await joinPost(pro, l, "decline");
    expect(declined.status).toBe(200);
    expect(await read(declined)).toContain(line("en", "join.msg_declined"));
    expect(await rowById(l.i)).toMatchObject({ ended_why: "declined", token_hash: null, member_id: null });
    expect((await rowsOf(h.id)).filter((r) => !r.ended_at)).toHaveLength(used - 1);
    expect(await ACCOUNTS.prepare("SELECT detail FROM audit WHERE event = 'seat_declined' AND user_id = ?").bind(pro.id).first()).toEqual({ detail: null });
  });

  it("lets two presses of Take the seat take it once, the second reading join.stale", async () => {
    const h = await person("twice-holder", "ultra");
    const m = await person("twice-m");
    await invite(h, m.email);
    const l = await linkTo(m.email);
    const c = await token(m);
    const answers = await Promise.all([joinPost(m, l, "take", c), joinPost(m, l, "take", c)]);
    expect(answers.map((r) => r.status).sort()).toEqual([303, 400]);
    expect(await read(answers.find((r) => r.status === 400)!)).toContain(line("en", "join.stale"));
    expect((await rowsOf(h.id)).filter((r) => r.member_id === m.id)).toHaveLength(1);
  });

  it("lets one person take one seat of two holders' at once: the other meets the unique index, join.seated", async () => {
    const [h1, h2] = [await person("uniq-h1", "ultra"), await person("uniq-h2", "ultra")];
    const m = await person("uniq-m");
    await invite(h1, m.email);
    const l1 = await linkTo(m.email);
    await invite(h2, m.email);
    const l2 = await linkTo(m.email);
    const c = await token(m);
    const answers = await Promise.all([joinPost(m, l1, "take", c), joinPost(m, l2, "take", c)]);
    expect(answers.map((r) => r.status).sort()).toEqual([303, 409]);
    expect(await read(answers.find((r) => r.status === 409)!)).toContain(line("en", "join.seated"));
    expect(await one("SELECT COUNT(*) AS n FROM seats WHERE member_id = ? AND ended_at IS NULL", m.id)).toBe(1);
    // The statement alone: the index refuses a second live seat.
    const loser = answers[0].status === 409 ? l1 : l2;
    await expect(ACCOUNTS.prepare(TAKE_SQL).bind(m.id, new Date().toISOString(), loser.i, 4, iso(-30), 6, await sha256Hex(loser.t)).run()).rejects.toThrow(/UNIQUE/);
  });

  it("answers join.no_room once the holder's plan holds no seat for it, its seats are all taken, or the window's joins are spent", { timeout: 30_000 }, async () => {
    const cases: [string, (h: { id: string; email: string; entitlement: string }) => Promise<void>][] = [
      ["the plan dropped", async (h) => {
        await ACCOUNTS.prepare("UPDATE entitlements SET revoked_at = ? WHERE id = ?").bind(iso(0), h.entitlement).run();
      }],
      ["the seats taken", async (h) => {
        for (let i = 0; i < 4; i++) await seatRow(h.id, { member: (await bare("noroom-m")).id, joined: -5 + i });
      }],
      ["the joins spent", async (h) => {
        for (let i = 0; i < 6; i++) await seatRow(h.id, { member: (await bare("noroom-j")).id, joined: -10 + i, ended: -9 + i, why: "removed" });
      }],
      ["the holder blocked", async (h) => {
        const op = await bare("noroom-op");
        await ACCOUNTS.prepare("INSERT INTO account_blocks (user_id, reason, created_at, by_user_id) VALUES (?, 'test', ?, ?)").bind(h.id, iso(0), op.id).run();
      }],
    ];
    for (const [name, arrange] of cases) {
      const holder = await bare("noroom-h");
      const entitlement = await grantUltra(holder.email);
      const m = await person("noroom-to");
      const secret = "1".repeat(64);
      const id = await seatRow(holder.id, { email: m.email, invited: 0, hash: await sha256Hex(secret) });
      await arrange({ ...holder, entitlement });
      const l = { i: id, t: secret };
      // The page reads what the take reads (the holder's plan and seats, the joins, a block) and offers Take the seat only where it could pass.
      const page = await read(await joinGet(l, m.cookie));
      expect(page, name).toContain(line("en", "join.no_room", { holder: holder.email }));
      expect(page, name).not.toContain(t("en", "join.take"));
      const before = await rowById(id);
      const res = await joinPost(m, l, "take");
      expect(res.status, name).toBe(409);
      expect(await read(res), name).toContain(line("en", "join.no_room", { holder: holder.email }));
      expect(await rowById(id), name).toEqual(before);
    }
  });

  it("frees its seat when its link runs out, with no write; the sweep takes it and its address 30 days after it was sent", async () => {
    const h = await person("ranout-holder", "ultra");
    for (let i = 0; i < 3; i++) await seatRow(h.id, { invited: -1 });
    const old = await seatRow(h.id, { invited: -8 });
    // Run out a day ago: it holds no seat, so the fourth goes.
    expect((await invite(h, newEmail("ranout-to"))).status).toBe(200);
    expect((await rowById(old))?.ended_at).toBeNull();
    const { sweep } = await import("../src/account/signin");
    await sweep(ON() as never, new Date(Date.now() + 23 * DAY_MS));
    expect(await rowById(old)).toBeNull();
  });

  it("stops every link of a holder whose account is deleted, its invitations' addresses cleared", async () => {
    const h = await person("gone-holder", "ultra");
    const to = newEmail("gone-to");
    await invite(h, to);
    const l = await linkTo(to);
    const res = await post("/account/delete", { csrf: await token(h), confirm: "yes" }, { cookie: h.cookie, env: ON() });
    expect(res.status).toBe(200);
    expect(await rowById(l.i)).toMatchObject({ ended_why: "closed", email: null, token_hash: null });
    expect((await joinGet(l)).status).toBe(400);
  });

  it("is never taken by a blocked account: its sign-in answers as a stale code does", async () => {
    const h = await person("blocked-holder", "ultra");
    const b = await person("blocked-to");
    await invite(h, b.email);
    await ACCOUNTS.prepare("INSERT INTO account_blocks (user_id, reason, created_at, by_user_id) VALUES (?, 'test', ?, ?)").bind(b.id, iso(0), h.id).run();
    await post("/account/sign-in", { email: b.email }, { env: ON() });
    const res = await post("/account/check", { email: b.email, code: codeIn((await lastMail(b.email))?.text ?? ""), sent: "1" }, { env: ON() });
    expect(res.status).toBe(400);
    expect(await read(res)).toContain(line("en", "account.err_stale"));
  });
});

// =========================================================================================================
// 3. What Fits, and the pool after the take
// =========================================================================================================

describe("What Fits", () => {
  it("says what the pool then serves: the newest member's items past its allowance are saved and unavailable", { timeout: 60_000 }, async () => {
    const h = await person("fits-holder", "ultra");
    await searches(h.id, 90, 100, "Holder secret label");
    const m = await person("fits-member");
    await searches(m.id, 30, 50, "Member secret label");
    await invite(h, m.email);
    const l = await linkTo(m.email);
    const before = await rowById(l.i);
    const page = await read(await joinGet(l, m.cookie));
    const things = text(t("en", "pool.f_searches"));
    expect(page).toContain(line("en", "join.room_line", { things: things.charAt(0).toUpperCase() + things.slice(1), fits: 10, own: 30, left: 20 }));
    expect(page).not.toContain("Holder secret label");
    expect(await rowById(l.i)).toEqual(before);
    expect((await joinPost(m, l, "take")).status).toBe(303);
    // The member's own list: the first 10 by creation in service, 20 marked, the line above them.
    const list = await read(await get("/account/searches", { cookie: m.cookie, env: ON() }));
    expect(list.split(line("en", "pool.mark")).length - 1).toBe(20);
    expect(list).toContain(line("en", "pool.over", { n: 20, things, cap: 100 }));
    // Each row from its label to the next one's: the 20 made last carry the mark.
    const at = Array.from({ length: 30 }, (_, i) => list.indexOf(`Member secret label ${i + 1}<`));
    for (const [i, p] of at.entries()) expect(p, `search ${i + 1}`).toBeGreaterThan(-1);
    const order = [...at].sort((a, b) => a - b);
    for (const [i, p] of at.entries()) {
      const end = order[order.indexOf(p) + 1] ?? list.length;
      expect(list.slice(p, end).includes(line("en", "pool.mark")), `search ${i + 1}`).toBe(i + 1 > 10);
    }
    expect(list).not.toContain("Holder secret label");
    // The holder's Seats page: the subscription's total and each account's count, never a label.
    const seats = await read(await get("/account/seats", { cookie: h.cookie, env: ON() }));
    expect(seats).toContain(line("en", "seats.pool_total", { n: 120, cap: 100 }));
    expect(seats).toContain(line("en", "seats.pool_over", { n: 20 }));
    expect(seats).toContain(m.email);
    expect(seats).not.toContain("Member secret label");
    // The member's: the totals and its own, never the holder's labels or address beyond the line that names it.
    const mine = await read(await get("/account/seats", { cookie: m.cookie, env: ON() }));
    expect(mine).toContain(line("en", "seats.pool_total", { n: 120, cap: 100 }));
    expect(mine).toContain(`<td data-label="Yours" class="num">30</td>`);
    expect(mine).not.toContain("Holder secret label");
  });

  it("matches the pool's allowance figure by figure for every split of a group", { timeout: 30_000 }, async () => {
    const h = await person("fits-split-h", "ultra");
    const member = await bare("fits-split-m1");
    await seatRow(h.id, { member: member.id, joined: -5 });
    await searches(h.id, 60, 100, "Split holder");
    await searches(member.id, 25, 90, "Split first");
    const m = await person("fits-split-m2");
    await searches(m.id, 40, 50, "Split second");
    await invite(h, m.email);
    const l = await linkTo(m.email);
    const page = await read(await joinGet(l, m.cookie));
    const things = text(t("en", "pool.f_searches"));
    // 100 less 60 less 25 leaves 15 of the 40.
    expect(page).toContain(line("en", "join.room_line", { things: things.charAt(0).toUpperCase() + things.slice(1), fits: 15, own: 40, left: 25 }));
    expect((await joinPost(m, l, "take")).status).toBe(303);
    const list = await read(await get("/account/searches", { cookie: m.cookie, env: ON() }));
    expect(list.split(line("en", "pool.mark")).length - 1).toBe(25);
  });
});

// =========================================================================================================
// 4. The Seats page, cancelling, removing, leaving
// =========================================================================================================

describe("the Seats page", () => {
  it("lists the holder, its seats and its invitations, the seats in use and the joins; the overview and the billing page link it", async () => {
    const h = await person("page-holder", "ultra");
    const m = await bare("page-member");
    await seatRow(h.id, { member: m.id, joined: -3 });
    const to = newEmail("page-invited");
    await invite(h, to);
    const page = await read(await get("/account/seats", { cookie: h.cookie, env: ON() }));
    expect(page).toContain(line("en", "seats.you", { email: h.email }));
    expect(page).toContain(line("en", "seats.state_yours"));
    expect(page).toContain(m.email);
    expect(page).toContain(line("en", "seats.state_taken"));
    expect(page).toContain(to);
    expect(page).toContain(line("en", "seats.count", { n: 3, cap: 5 }));
    expect(page).toContain(line("en", "seats.rule_joins", { n: 6, used: 1 }));
    expect(page).toContain(line("en", "seats.invite_lead", { days: SEAT_INVITE_DAYS }));
    expect(page.match(/class="btn btn-primary"/g)).toHaveLength(1);
    const overview = await read(await get("/account", { cookie: h.cookie, env: ON() }));
    expect(overview).toContain('<dt>Seats</dt><dd><a href="/account/seats">3 of 5 seats</a></dd>');
    const billing = await read(await get("/account/billing", { cookie: h.cookie, env: ON() }));
    expect(billing).toContain('<a href="/account/seats" class="btn">Seats</a>');
    // French.
    const fr = await read(await get("/account/seats?lang=fr", { cookie: h.cookie, env: ON() }));
    expect(fr).toContain(line("fr", "seats.lead"));
    expect(fr).toContain(line("fr", "seats.count", { n: 3, cap: 5 }));
    expect(fr).toContain(line("fr", "seats.invite_title"));
  });

  it("cancels an open invitation: its link stops at once, the address kept for its count; another id changes nothing", async () => {
    const h = await person("cancel-holder", "ultra");
    const to = newEmail("cancel-to");
    await invite(h, to);
    const l = await linkTo(to);
    const stranger = await person("cancel-stranger", "ultra");
    const tried = await post(`/account/seats/${l.i}/cancel`, { csrf: await token(stranger) }, { cookie: stranger.cookie, env: ON() });
    expect(tried.status).toBe(303);
    expect((await rowById(l.i))?.ended_at).toBeNull();
    const res = await post(`/account/seats/${l.i}/cancel`, { csrf: await token(h) }, { cookie: h.cookie, env: ON() });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/seats?m=cancelled");
    expect(await rowById(l.i)).toMatchObject({ ended_why: "cancelled", token_hash: null, email: to, member_id: null });
    expect((await joinGet(l)).status).toBe(400);
    expect(await read(await get("/account/seats?m=cancelled", { cookie: h.cookie, env: ON() }))).toContain(line("en", "seats.msg_cancelled"));
    expect(await one("SELECT COUNT(*) AS n FROM audit WHERE event = 'seat_cancelled' AND user_id = ? AND detail IS NULL", h.id)).toBe(1);
    expect(await one("SELECT COUNT(*) AS n FROM audit WHERE event = 'seat_cancelled' AND user_id = ?", stranger.id)).toBe(0);
  });

  it("removes a member after its page asks, the seat ended and the member on its own plan; another holder's post changes nothing", async () => {
    const h = await person("remove-holder", "ultra");
    const m = await person("remove-member");
    const id = await seatRow(h.id, { member: m.id, joined: -3 });
    expect((await planFor(ON() as never, { id: m.id, plan: "free", plan_until: null })).plan).toBe("ultra");
    const ask = await read(await get(`/account/seats/${id}/remove`, { cookie: h.cookie, env: ON() }));
    expect(ask).toContain(line("en", "seats.remove_title", { email: m.email }));
    expect(ask).toContain(line("en", "seats.remove_text", { email: m.email }));
    const stranger = await person("remove-stranger", "ultra");
    expect((await get(`/account/seats/${id}/remove`, { cookie: stranger.cookie, env: ON() })).status).toBe(303);
    expect((await post(`/account/seats/${id}/remove`, { csrf: await token(stranger), confirm: "yes" }, { cookie: stranger.cookie, env: ON() })).status).toBe(303);
    expect((await rowById(id))?.ended_at).toBeNull();
    expect((await post(`/account/seats/${id}/remove`, { csrf: await token(h) }, { cookie: h.cookie, env: ON() })).headers.get("location")).toBe(`/account/seats/${id}/remove`);
    const res = await post(`/account/seats/${id}/remove`, { csrf: await token(h), confirm: "yes" }, { cookie: h.cookie, env: ON() });
    expect(res.status).toBe(200);
    const page = await read(res);
    expect(page).toContain(line("en", "seats.msg_removed", { email: m.email }));
    expect(await rowById(id)).toMatchObject({ ended_why: "removed", told: 1 });
    expect((await planFor(ON() as never, { id: m.id, plan: "pro", plan_until: null })).plan).toBe("free");
    expect(await one("SELECT COUNT(*) AS n FROM audit WHERE event = 'seat_removed' AND user_id = ? AND detail IS NULL", h.id)).toBe(1);
  });

  it("lets a member leave after its page asks: the seat ended, no notice owed, the account on its own plan", async () => {
    const h = await person("leave-holder", "ultra");
    const m = await person("leave-member");
    const id = await seatRow(h.id, { member: m.id, joined: -3 });
    const ask = await read(await get("/account/seat/leave", { cookie: m.cookie, env: ON() }));
    expect(ask).toContain(line("en", "seat.leave_text", { holder: h.email }));
    expect((await post("/account/seat/leave", { csrf: await token(m) }, { cookie: m.cookie, env: ON() })).headers.get("location")).toBe("/account/seat/leave");
    expect((await rowById(id))?.ended_at).toBeNull();
    const res = await post("/account/seat/leave", { csrf: await token(m), confirm: "yes" }, { cookie: m.cookie, env: ON() });
    expect(res.headers.get("location")).toBe("/account/seats?m=left");
    expect(await rowById(id)).toMatchObject({ ended_why: "left", told: 0 });
    expect(await read(await get("/account/seats?m=left", { cookie: m.cookie, env: ON() }))).toContain(line("en", "seat.msg_left", { plan: "Free" }));
    // An account with no seat is sent to the Seats page.
    expect((await get("/account/seat/leave", { cookie: m.cookie, env: ON() })).status).toBe(303);
    expect(await one("SELECT COUNT(*) AS n FROM audit WHERE event = 'seat_left' AND user_id = ? AND detail IS NULL", m.id)).toBe(1);
  });

  it("shows Free and Pro the plans' seats and the cards; a holder that moved down, its members without the plan for now", async () => {
    const free = await person("page-free");
    const page = await read(await get("/account/seats", { cookie: free.cookie, env: ON() }));
    expect(page).toContain(line("en", "seats.pro_text", { pro_seats: "1 seat", ultra_seats: "5 seats", others: 4 }));
    expect(page).not.toContain('action="/account/seats/invite"');
    expect(page).toContain('class="plan-cards"');
    const pro = await person("page-pro", "pro");
    const m = await bare("page-pro-member");
    await seatRow(pro.id, { member: m.id, joined: -3 });
    const down = await read(await get("/account/seats", { cookie: pro.cookie, env: ON() }));
    expect(down).toContain(line("en", "seats.fewer", { plan: "Pro", seats: "1 seat" }));
    expect(down).toContain(line("en", "seats.state_uncovered"));
    expect(down).toContain(`/account/seats/`);
    const overview = await read(await get("/account", { cookie: pro.cookie, env: ON() }));
    expect(overview).toContain('<dt>Seats</dt><dd><a href="/account/seats">Seats this plan does not hold</a></dd>');
    // Free with no seat: no row.
    expect(await read(await get("/account", { cookie: free.cookie, env: ON() }))).not.toContain("/account/seats");
  });

  it("gives a member's billing page no Subscribe, and refuses its checkout without a word to the payment service", async () => {
    const h = await bare("bill-holder");
    await grantUltra(h.email);
    const m = await person("bill-member");
    await seatRow(h.id, { member: m.id, joined: -2 });
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("no payment call expected"); });
    const env = ON(PRO_SALE);
    const page = await read(await get("/account/billing", { cookie: m.cookie, env }));
    expect(page).toContain(line("en", "seat.billing"));
    expect(page).not.toContain('action="/account/billing/checkout"');
    expect(page).toContain(line("en", "account.plan_seat", { plan: "Ultra", holder: h.email }));
    const res = await post("/account/billing/checkout", { csrf: await csrf(m.cookie, "/account", { env }), interval: "monthly" }, { cookie: m.cookie, env });
    expect(res.status).toBe(409);
    expect(await read(res)).toContain(line("en", "seat.billing"));
    expect(fetched).not.toHaveBeenCalled();
  });

  it("answers the site's 404 while the table is not on the database, whatever the switch says", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await person("missing-holder", "ultra");
    await withoutSeats(async () => {
      for (const path of ["/account/seats", "/account/seat/leave", `/account/seats/join?i=${hexId()}&t=${"a".repeat(64)}`]) {
        expect((await get(path, { cookie: h.cookie, env: ON() })).status, path).toBe(404);
      }
      expect(await read(await get("/account", { cookie: h.cookie, env: ON() }))).not.toContain("/account/seats");
    });
  });
});

// =========================================================================================================
// 5. The day's sends, the logs, the strings
// =========================================================================================================

describe("the invitations among the day's sends", () => {
  it("are read by the daily check as sends and never as a run of the job", async () => {
    const env = { ...testEnv(), ACCOUNTS_ENABLED: "true", ACCOUNTS, SEARCH: undefined, DATA: undefined, MAIL_DAILY_QUOTA: "200", MAIL_DAILY_RESERVE: "40" };
    const row = (at: string, o: { outcome: string; data_date?: string; sent?: number; left_due?: number; detail?: string }) =>
      ACCOUNTS.prepare("INSERT INTO delivery_runs (at, data_date, outcome, sent, failed, left_due, detail) VALUES (?, ?, ?, ?, 0, ?, ?)")
        .bind(at, o.data_date ?? null, o.outcome, o.sent ?? 0, o.left_due ?? 0, o.detail ?? null);
    // The check at 06:00 UTC the morning after.
    const lines = async (day: string) =>
      collectAlerts(await gatherInputs(env as never, new Date(Date.parse(`${day}T06:00:00Z`) + DAY_MS))).filter((a) => /delivery (run|job)/.test(a));
    // A day of invitations alone: no run of the job was recorded.
    const day1 = "2032-03-01";
    await ACCOUNTS.batch([row(`${day1}T10:00:00.000Z`, { outcome: "invite", sent: 1, detail: "a seat's invitation" })]);
    expect(await lines(day1)).toEqual([
      `No delivery run was recorded on ${day1} (UTC): the hourly job (cron 0 15-20 * * *) did not run, or none of its runs could write the run log ` +
      "(delivery_runs). Check the Worker's cron triggers and its logs.",
    ]);
    // The day's ceiling counts the invitations with the job's sends.
    const day2 = "2032-03-02";
    const ceiling = "the day's sending ceiling of 160 messages (MAIL_DAILY_QUOTA 200 less MAIL_DAILY_RESERVE 40)";
    await ACCOUNTS.batch([
      ...Array.from({ length: 4 }, (_, i) => row(`${day2}T0${i}:00:00.000Z`, { outcome: "invite", sent: 1, detail: "a seat's invitation" })),
      row(`${day2}T15:00:00.000Z`, { outcome: "limited", data_date: day2, sent: 156, left_due: 3, detail: ceiling }),
    ]);
    expect(await lines(day2)).toEqual([
      `The delivery job reached the day's sending ceiling on ${day2}: 160 messages sent of the 160 it allows (MAIL_DAILY_QUOTA 200 less ` +
      "MAIL_DAILY_RESERVE 40, kept for sign-in codes), and 3 items waited for the next day. Ask Cloudflare for a higher " +
      "Email Sending daily limit (its Limit Increase Request Form), then raise MAIL_DAILY_QUOTA in wrangler.jsonc.",
    ]);
  });
});

describe("what is logged and recorded", () => {
  it("names no address, no id and no secret in a log line or an audit detail, through an invitation, a take and a leave", async () => {
    const logged = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const h = await person("log-holder", "ultra");
    const m = await person("log-member");
    await invite(h, m.email);
    const l = await linkTo(m.email);
    await joinGet(l);
    await joinGet(l, m.cookie);
    await joinPost(m, l, "take");
    await post("/account/seat/leave", { csrf: await token(m), confirm: "yes" }, { cookie: m.cookie, env: ON() });
    const all = logged.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" "))).join("\n");
    for (const secret of [h.email, m.email, l.i, l.t, h.id, m.id]) expect(all).not.toContain(secret);
    const details = (await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE event LIKE 'seat_%' AND user_id IN (?, ?)").bind(h.id, m.id).all<{ event: string; detail: string | null }>()).results ?? [];
    expect(details.map((d) => d.event).sort()).toEqual(["seat_invited", "seat_left", "seat_taken"]);
    for (const d of details) expect(d.detail).toBeNull();
  });
});

describe("the seats' words", () => {
  it("are in English and French, with no dash, straight apostrophes in the French as written, and each line its own figure", () => {
    for (const [key, entry] of Object.entries(SEATS_STRINGS) as [string, { en: string; fr: string }][]) {
      for (const s of [entry.en, entry.fr]) {
        expect(s, key).not.toContain(EM_DASH);
        expect(s, key).not.toContain(EN_DASH);
      }
      expect(entry.fr, key).not.toContain("’");
      expect(entry.fr, key).not.toBe(entry.en);
      expect(`${entry.en} ${entry.fr}`, key).not.toMatch(/\bmore than Pro|\babove Pro|\bthan Pro\b/);
    }
    expect(t("fr", "seats.count_one", { n: 1, cap: 5 })).toBe("1 siège sur 5");
  });
});
