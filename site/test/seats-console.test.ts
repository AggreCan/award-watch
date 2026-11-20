// Seats, slice E (the seats design's 5.7 and 9.2): the console's signals and the closes left after slice D.
//
// 1. The overview's counts (admin_ops.ts SEAT_SIGNALS_SQL, CAP_SIGNALS_SQL): the live seats and the holders giving
//    them, the open invitations, the joins of the window, the browsers the cap signed out and the accounts at 10 or
//    more of them; counts alone, whenever the seats table is on the database, the switch on or off; without the
//    table, no panel and nothing more read.
// 2. The accounts table's Seat column and its filter of three values; without the table, neither, and nothing read.
// 3. The console's grant to an account that holds a seat: a page that names the holder first, then the grant and
//    the seat's end in one batch with End this seat's audit rows; nothing granted when the seat cannot be read or
//    ended; an account with no seat row, and a database without the table, granted as before.
// 4. Add a Tile and the rows' Add to dashboard leave out what is past a member's allowance.
// 5. The weekly email says how many of a member's watches wait for room.
//
// The console reads the real clock, so its fixtures are placed relative to it; the delivery run's clock is fixed
// (NOW), and its fixtures are written at fixed times before it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAP_SIGNALS_SQL, CAPPED_ACCOUNT_MIN, CAPPED_DAYS, SEAT_SIGNALS_SQL, grantPlan } from "../src/account/admin_ops";
import { runDeliveries } from "../src/account/deliveries";
import { PLAN_ROWS_SQL, planFor } from "../src/account/entitlements";
import { POOL_COUNTS_SQL } from "../src/account/pool";
import { GRANT_ENDS_SEAT_SQL, MEMBER_SEAT_SQL, SEAT_WINDOW_DAYS } from "../src/account/seats";
import { fmtInt, t, type Key, type Lang } from "../src/i18n";
import { app } from "../src/index";
import { ACCOUNTS, csrf, decode, get, grantUltra, nbsp, newEmail, nextIp, onEnv, post, signIn, useAccountsDb, userId, withoutSeats } from "./accounts-helpers";
import { makeFakeAssets } from "./assets";
import stats from "./fixtures/stats.json";
import { fakeMail } from "./mail-fixtures";
import { type Fixed, RECORDS, account, hexOf, recording, recordsAt, sale } from "./seats-rest-fixtures";

useAccountsDb();

afterEach(() => {
  vi.restoreAllMocks();
});

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const DAY_MS = 86_400_000;
const iso = (days: number, ms = 0) => new Date(Date.now() + days * DAY_MS + ms).toISOString();
const hexId = () => crypto.randomUUID().replace(/-/g, "");
const text = (s: string) => nbsp(decode(s)).replace(/’/g, "'");
const line = (lang: Lang, key: Key, vars?: Record<string, string | number>) => text(t(lang, key, vars));
const read = async (res: Response) => text(await res.text());
const broken = (address: string) => address.split(/(?<=[@.])/).join("<wbr/>");

type Operator = { email: string; id: string; cookie: string; csrf: string; env: Record<string, unknown> };
async function operator(seats: "on" | "off" = "on", extra: Record<string, unknown> = {}): Promise<Operator> {
  const email = newEmail("e-op");
  const env = onEnv({ SEATS: seats, OPERATOR_EMAILS: email, ...extra });
  const cookie = await signIn(email, { env });
  return { email, id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env }), env };
}
const opGet = (op: Operator, path: string, env: Record<string, unknown> = op.env) => get(path, { cookie: op.cookie, env });
const opPost = (op: Operator, path: string, fields: Record<string, string>, env: Record<string, unknown> = op.env) =>
  post(path, { csrf: op.csrf, ...fields }, { cookie: op.cookie, env });

// An account by its row alone (no sign-in), made at a fixed point before now.
async function plainUser(email: string, days = -100): Promise<string> {
  const id = hexId();
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, 'en', 'active', 'free')")
    .bind(id, email, iso(days)).run();
  return id;
}

// A seat row: a live or ended seat (member), or an invitation (no member), each dated in days from now.
async function seatRow(holder: string, o: { member?: string; joined?: number; ended?: number; why?: string; invited?: number; expires?: number }): Promise<string> {
  const id = hexId();
  const invited = o.invited ?? (o.joined !== undefined ? o.joined - 1 : 0);
  await ACCOUNTS.prepare(
    "INSERT INTO seats (id, holder_id, email, token_hash, lang, invited_at, expires_at, member_id, joined_at, ended_at, ended_why) " +
    "VALUES (?, ?, ?, ?, 'en', ?, ?, ?, ?, ?, ?)",
  ).bind(
    id, holder, o.member ? null : newEmail("e-invited"), o.member ? null : "f".repeat(64), iso(invited), iso(o.expires ?? invited + 7),
    o.member ?? null, o.member ? iso(o.joined ?? 0) : null, o.ended === undefined ? null : iso(o.ended), o.ended === undefined ? null : o.why ?? "removed",
  ).run();
  return id;
}

// A database binding that writes down every statement prepared on it, and each batch by its statements' text.
function batchRecording(base: D1Database): { db: D1Database; sent: string[]; batches: string[][] } {
  const sent: string[] = [];
  const batches: string[][] = [];
  const sqlOf = new WeakMap<object, string>();
  const native = new WeakMap<object, D1PreparedStatement>();
  const wrap = (stmt: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const w = new Proxy(stmt, {
      get(s, p) {
        const v = Reflect.get(s, p);
        if (p === "bind") return (...a: unknown[]) => wrap((v as (...x: unknown[]) => D1PreparedStatement).apply(s, a), sql);
        return typeof v === "function" ? v.bind(s) : v;
      },
    });
    sqlOf.set(w, sql);
    native.set(w, stmt);
    return w;
  };
  const db = new Proxy(base, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          sent.push(sql);
          return wrap(target.prepare(sql), sql);
        };
      }
      if (prop === "batch") {
        return (stmts: D1PreparedStatement[]) => {
          batches.push(stmts.map((s) => sqlOf.get(s) ?? ""));
          return target.batch(stmts.map((s) => native.get(s) ?? s));
        };
      }
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { db: db as D1Database, sent, batches };
}

// One audit row of the browsers the cap signed out, as sign-in writes it (routes.tsx), days from now.
const capped = (user: string, n: number, days: number) =>
  ACCOUNTS.prepare("INSERT INTO audit (user_id, event, at, detail) VALUES (?, 'signed_out', ?, ?)").bind(user, iso(days), `cap ${n}`).run();

const PANEL: Record<Lang, string> = { en: "Seats and Signed-In Browsers", fr: "Sièges et navigateurs connectés" };
const panelOf = (html: string, lang: Lang = "en"): string | null => {
  const at = html.indexOf(`<h2>${PANEL[lang]}</h2>`);
  return at < 0 ? null : html.slice(at, html.indexOf("</section>", at));
};
// The figure under a label in a panel's list.
const figure = (panel: string, label: string): number => {
  const at = panel.indexOf(`<dt>${label}</dt>`);
  if (at < 0) throw new Error(`no row ${label}`);
  const m = /^<dd>([0-9 ,]+)<\/dd>/.exec(panel.slice(at + label.length + 9).trimStart());
  if (!m) throw new Error(`no figure for ${label}`);
  return Number(m[1].replace(/[ ,]/g, ""));
};
const LABELS = (lang: Lang) => ({
  seats: line(lang, "admin.overview_seats"), holders: line(lang, "admin.overview_holders"), open: line(lang, "admin.overview_open"),
  joins: line(lang, "admin.overview_joins", { n: SEAT_WINDOW_DAYS }), capped: line(lang, "admin.overview_capped", { n: CAPPED_DAYS }),
  accounts: line(lang, "admin.overview_capped_accounts", { min: CAPPED_ACCOUNT_MIN, n: CAPPED_DAYS }),
});
async function signals(op: Operator, lang: Lang = "en"): Promise<Record<keyof ReturnType<typeof LABELS>, number>> {
  const panel = panelOf(await read(await opGet(op, lang === "fr" ? "/admin?lang=fr" : "/admin")), lang);
  if (!panel) throw new Error("no signals panel");
  const labels = LABELS(lang);
  return Object.fromEntries(Object.entries(labels).map(([k, label]) => [k, figure(panel, label)])) as Record<keyof typeof labels, number>;
}

// =====================================================================================================================
// 1. The overview
// =====================================================================================================================

describe("the console's overview", () => {
  it("counts the live seats and their holders, the open invitations, the joins of the window and the browsers the cap signed out", async () => {
    const op = await operator();
    const before = await signals(op);
    // A holder with two live seats, an open invitation, an expired one and a seat that ended inside the window; another
    // holder with one seat joined before the window.
    const h1 = await plainUser(newEmail("e-h1"));
    const h2 = await plainUser(newEmail("e-h2"));
    const members = await Promise.all([1, 2, 3, 4].map((i) => plainUser(newEmail(`e-m${i}`))));
    await seatRow(h1, { member: members[0], joined: -5 });
    await seatRow(h1, { member: members[1], joined: -2 });
    await seatRow(h1, { member: members[2], joined: -10, ended: -3 });
    await seatRow(h1, { invited: -1 });
    await seatRow(h1, { invited: -9, expires: -2 });
    await seatRow(h2, { member: members[3], joined: -(SEAT_WINDOW_DAYS + 10) });
    // The cap: one account at the mark (4 + 6), one under it (9), one over it but outside the window, one whose rows
    // straddle the window's start (4 inside, 8 outside); a sign-out of another kind is no cap's.
    const a = await plainUser(newEmail("e-cap-a"));
    const b = await plainUser(newEmail("e-cap-b"));
    const c = await plainUser(newEmail("e-cap-c"));
    const d = await plainUser(newEmail("e-cap-d"));
    await capped(a, 4, -2);
    await capped(a, 6, -20);
    await capped(b, 9, -1);
    await capped(c, 12, -(CAPPED_DAYS + 1));
    await capped(d, 4, -3);
    await capped(d, 8, -(CAPPED_DAYS + 2));
    await ACCOUNTS.prepare("INSERT INTO audit (user_id, event, at, detail) VALUES (?, 'signed_out', ?, 'replaced')").bind(b, iso(-1)).run();
    const after = await signals(op);
    expect({
      seats: after.seats - before.seats, holders: after.holders - before.holders, open: after.open - before.open, joins: after.joins - before.joins,
      capped: after.capped - before.capped, accounts: after.accounts - before.accounts,
    }).toEqual({ seats: 3, holders: 2, open: 1, joins: 3, capped: 4 + 6 + 9 + 4, accounts: 1 });
    // In French, the same figures under the panel's own words.
    expect(await signals(op, "fr")).toEqual(after);
  });

  it("names no address and no id in the panel, and reads it with the switch off", async () => {
    const op = await operator("off");
    const h = await plainUser(newEmail("e-names-h"));
    const m = await plainUser(newEmail("e-names-m"));
    await seatRow(h, { member: m, joined: -1 });
    await capped(m, 11, -1);
    for (const lang of ["en", "fr"] as const) {
      const html = await read(await opGet(op, lang === "fr" ? "/admin?lang=fr" : "/admin"));
      const panel = panelOf(html, lang)!;
      expect(panel, lang).toBeTruthy();
      expect(panel).not.toMatch(/@/);
      expect(panel).not.toMatch(/[0-9a-f]{32}/);
      expect(panel).not.toContain("<a ");
      expect(panel).not.toContain(EM_DASH);
      expect(panel).not.toContain(EN_DASH);
      // The panel sits after the counts, before the watches.
      expect(html.indexOf(`<h2>${PANEL[lang]}</h2>`)).toBeGreaterThan(html.indexOf(lang === "en" ? "<h2>Counts</h2>" : "<h2>Chiffres</h2>"));
    }
  });

  it("adds its two statements to the batch the overview sends, each through an index, and nothing without the seats table", async () => {
    const op = await operator();
    const r = batchRecording(ACCOUNTS);
    const res = await opGet(op, "/admin", { ...op.env, ACCOUNTS: r.db });
    expect(res.status).toBe(200);
    // One batch holds both, beside the overview's own four.
    const overview = r.batches.find((b) => b.includes(SEAT_SIGNALS_SQL));
    expect(overview).toBeDefined();
    expect(overview).toContain(CAP_SIGNALS_SQL);
    expect(overview).toHaveLength(6);
    expect(r.sent.filter((s) => s === SEAT_SIGNALS_SQL || s === CAP_SIGNALS_SQL)).toHaveLength(2);
    // Each subquery's plan: an index, or the small table's own covering index; the audit's window by its index on at.
    const plan = async (sql: string, ...binds: unknown[]) =>
      ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all<{ detail: string }>()).results ?? []).map((x) => x.detail);
    const seats = await plan(SEAT_SIGNALS_SQL, iso(0), iso(-SEAT_WINDOW_DAYS));
    expect(seats.filter((d) => /^SCAN seats$/.test(d)), seats.join(" | ")).toEqual([]);
    expect(seats.some((d) => /idx_seats_member_live/.test(d)), seats.join(" | ")).toBe(true);
    expect(seats.some((d) => /idx_seats_email/.test(d)), seats.join(" | ")).toBe(true);
    const cap = await plan(CAP_SIGNALS_SQL, iso(-CAPPED_DAYS), CAPPED_ACCOUNT_MIN);
    expect(cap.some((d) => /SEARCH audit USING INDEX idx_audit_at \(at>\?\)/.test(d)), cap.join(" | ")).toBe(true);
    expect(cap.filter((d) => /^SCAN audit/.test(d))).toEqual([]);
    // Without the table: no panel, neither statement, and nothing names the seats but the session's own plan read.
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withoutSeats(async () => {
      const r2 = recording(ACCOUNTS);
      const html = await read(await opGet(op, "/admin", { ...op.env, ACCOUNTS: r2.db }));
      expect(panelOf(html)).toBeNull();
      expect(html).toContain("<h2>Counts</h2>");
      expect(r2.sent).not.toContain(SEAT_SIGNALS_SQL);
      expect(r2.sent).not.toContain(CAP_SIGNALS_SQL);
      expect(r2.sent.filter((s) => /\bseats\b/.test(s) && s !== PLAN_ROWS_SQL)).toEqual([]);
    });
  });
});

// =====================================================================================================================
// 2. The accounts table
// =====================================================================================================================

describe("the accounts table's Seat column", () => {
  const listed = (html: string) => [...html.matchAll(/<a href="\/admin\/users\/([0-9a-f]{32})">/g)].map((m) => m[1]);
  function cells(html: string, id: string): Record<string, string> {
    const at = html.indexOf(`<a href="/admin/users/${id}">`);
    const row = html.slice(html.lastIndexOf("<tr>", at), html.indexOf("</tr>", at));
    return Object.fromEntries([...row.matchAll(/<td data-label="([^"]*)"(?: class="[^"]*")?>(.*?)<\/td>/g)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, "")]));
  }
  let seq = 0;
  // Six accounts under one tag, a day apart (p the oldest): one that gives a live seat, one that gives only an open
  // invitation, one that gave only an invitation now expired, one in a live seat, one whose seat ended, one with none.
  async function seeded() {
    const tag = `seatcol${++seq}x${Date.now().toString(36)}`;
    const mail = (k: string) => `${tag}-${k}@example.com`;
    const p = await plainUser(mail("p"), -60);
    const e = await plainUser(mail("e"), -59);
    const x = await plainUser(mail("x"), -58);
    const i = await plainUser(mail("i"), -57);
    const m = await plainUser(mail("m"), -56);
    const h = await plainUser(mail("h"), -55);
    await seatRow(h, { member: m, joined: -4 });
    await seatRow(h, { member: e, joined: -10, ended: -2 });
    await seatRow(i, { invited: -1 });
    await seatRow(x, { invited: -20, expires: -13 });
    return { tag, p, e, x, i, m, h };
  }

  it("says each account's side of a seat and narrows by each of the three values, in both languages", async () => {
    const op = await operator();
    const s = await seeded();
    const html = await read(await opGet(op, `/admin/accounts?q=${s.tag}`));
    expect(listed(html)).toEqual([s.h, s.m, s.i, s.x, s.e, s.p]);
    const heads = [...html.matchAll(/<th[^>]*><a [^>]*>([^<]+)/g)].map((m) => m[1]);
    expect(heads.slice(0, 4)).toEqual(["Address", "Plan", "Seat", "Status"]);
    // Twelve columns do not fit the content column from 700 to 1,279 px: four rest there (styles.css mdh), shown again
    // on a phone's restacked rows and from 1,280 px, and an address may break after its "@" and dots.
    for (const label of ["Last sign-in", "Delivery on", "API keys", "Language"]) expect(html, label).toContain(`<td data-label="${label}" class="mdh">`);
    expect(html.match(/<th[^>]* class="mdh"/g)).toHaveLength(4);
    expect(html).toContain(`<a href="/admin/users/${s.h}">${broken(`${s.tag}-h@example.com`)}</a>`);
    const seat = (id: string) => cells(html, id).Seat;
    expect([seat(s.h), seat(s.i), seat(s.m), seat(s.x), seat(s.e), seat(s.p)]).toEqual(["Gives seats", "Gives seats", "Holds a seat", "None", "None", "None"]);
    const ids = async (query: string) => listed(await read(await opGet(op, `/admin/accounts?q=${s.tag}&${query}`)));
    expect(await ids("seat=holder")).toEqual([s.h, s.i]);
    expect(await ids("seat=member")).toEqual([s.m]);
    expect(await ids("seat=none")).toEqual([s.x, s.e, s.p]);
    expect(await ids("seat=any")).toEqual([s.h, s.m, s.i, s.x, s.e, s.p]);
    expect(await ids("seat=holder&plan=free")).toEqual([s.h, s.i]);
    // Sorted by it, each side together, the id breaking ties.
    const bySeat = await ids("sort=seat");
    expect(bySeat.slice(0, 2).sort()).toEqual([s.h, s.i].sort());
    expect(bySeat[2]).toBe(s.m);
    expect(bySeat.slice(3).sort()).toEqual([s.x, s.e, s.p].sort());
    // The select offers the three values and shows the one in force; the CSV keeps the filter.
    const filtered = await read(await opGet(op, `/admin/accounts?q=${s.tag}&seat=member`));
    expect(filtered).toContain('<option value="member" selected="">Holds a seat</option>');
    expect(filtered).toContain('<option value="holder">Gives seats</option>');
    expect(filtered).toContain('<option value="none">None</option>');
    expect(filtered).toContain(`href="/admin/accounts.csv?q=${s.tag}&seat=member"`);
    const csv = (await (await opGet(op, `/admin/accounts.csv?q=${s.tag}&seat=holder`)).text()).split("\r\n");
    expect(csv.slice(1, -1).map((l) => l.split(",")[0])).toEqual([s.h, s.i]);
    const fr = await read(await opGet(op, `/admin/accounts?lang=fr&q=${s.tag}`));
    for (const w of ["Siège", "Donne des sièges", "Occupe un siège", "Aucun"]) expect(fr, w).toContain(w);
    expect(cells(fr, s.m)["Siège"]).toBe("Occupe un siège");
    for (const page of [html, fr, filtered]) {
      expect(page).not.toContain(EM_DASH);
      expect(page).not.toContain(EN_DASH);
    }
  });

  it("is left out with its filter while the seats table is not on the database, which then reads nothing for it", async () => {
    const op = await operator();
    const s = await seeded();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withoutSeats(async () => {
      const r = recording(ACCOUNTS);
      const env = { ...op.env, ACCOUNTS: r.db };
      const html = await read(await opGet(op, `/admin/accounts?q=${s.tag}&seat=holder&sort=seat`, env));
      // The filter and the order it names read as unset: every account, newest first.
      expect(listed(html)).toEqual([s.h, s.m, s.i, s.x, s.e, s.p]);
      expect(html).not.toContain(">Seat<");
      expect(html).not.toContain('name="seat"');
      expect(r.sent.filter((q) => /\bseats\b/.test(q) && q !== PLAN_ROWS_SQL)).toEqual([]);
      const csv = await opGet(op, `/admin/accounts.csv?q=${s.tag}&seat=member`, env);
      expect(csv.status).toBe(200);
      expect((await csv.text()).split("\r\n").length - 2).toBe(6);
    });
  });
});

// =====================================================================================================================
// 3. The grant to an account that holds a seat
// =====================================================================================================================

describe("the console's grant to an account that holds a seat", () => {
  async function person(tag: string, plan: "free" | "ultra" = "free"): Promise<{ email: string; id: string; cookie: string }> {
    const email = newEmail(tag);
    const cookie = await signIn(email, { env: onEnv({ SEATS: "on" }) });
    if (plan === "ultra") await grantUltra(email);
    return { email, id: await userId(email), cookie };
  }
  const ents = async (user: string) =>
    ((await ACCOUNTS.prepare("SELECT e.plan, e.source, e.reference, t.tier FROM entitlements e LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id WHERE e.user_id = ?")
      .bind(user).all<{ plan: string; source: string; reference: string; tier: string | null }>()).results ?? []);
  const seatOf = (id: string) => ACCOUNTS.prepare("SELECT * FROM seats WHERE id = ?").bind(id).first<Record<string, unknown>>();
  const auditOf = async (user: string, event: string) =>
    ((await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = ? ORDER BY id").bind(user, event).all<{ detail: string | null }>()).results ?? [])
      .map((r) => r.detail);
  const FIELDS = { plan: "ultra", until: "", reference: "member trial" };

  it("first says the grant ends the seat, naming the holder; then grants and ends it at once, with End this seat's audit rows", async () => {
    const op = await operator();
    const h = await person("g-holder", "ultra");
    const m = await person("g-member");
    const seat = await seatRow(h.id, { member: m.id, joined: -3 });
    const path = `/admin/users/${m.id}/grant`;
    // The user page's form posts the grant: a page of what it does, nothing written.
    const ask = await opPost(op, path, FIELDS);
    expect(ask.status).toBe(200);
    const page = await read(ask);
    expect(page).toContain(`<h1>${line("en", "admin.grant_seat_title")}</h1>`);
    expect(page).toContain(line("en", "admin.grant_seat_lead"));
    expect(page).toContain(`The seat is on the subscription of <a href="/admin/users/${h.id}">${broken(h.email)}</a>.`);
    expect(page).toContain(line("en", "admin.grant_seat_ends", { plan: "Ultra" }));
    expect(page).toContain(line("en", "admin.grant_seat_told"));
    for (const [k, v] of Object.entries({ ...FIELDS, seat })) expect(page, k).toContain(`<input type="hidden" name="${k}" value="${v}"/>`);
    expect(page).toContain('name="confirm" value="yes"');
    expect(page).toContain(`>${line("en", "admin.grant_seat_button")}</button>`);
    expect(page.match(/class="btn btn-primary"/g)).toHaveLength(1);
    expect(await ents(m.id)).toEqual([]);
    expect((await seatOf(seat))?.ended_at).toBeNull();
    // The box unticked, and a seat that is not the account's live one: refused, nothing written.
    const unticked = await opPost(op, path, { ...FIELDS, seat });
    expect(unticked.status).toBe(400);
    expect(await read(unticked)).toContain(line("en", "admin.err_confirm"));
    const moved = await opPost(op, path, { ...FIELDS, seat: hexId(), confirm: "yes" });
    expect(moved.status).toBe(409);
    expect(await read(moved)).toContain(line("en", "admin.err_seat_changed"));
    // No Origin, or another account's CSRF value: refused as every console post is.
    expect((await post(path, { csrf: op.csrf, ...FIELDS, seat, confirm: "yes" }, { cookie: op.cookie, env: op.env, origin: null })).status).toBe(403);
    expect((await opPost(op, path, { ...FIELDS, seat, confirm: "yes", csrf: "0".repeat(32) })).status).toBe(403);
    expect(await ents(m.id)).toEqual([]);
    expect((await seatOf(seat))?.ended_at).toBeNull();
    // Confirmed for this seat: the grant and the end together.
    const done = await opPost(op, path, { ...FIELDS, seat, confirm: "yes" });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/admin/users/${m.id}?m=granted_ultra_seat`);
    expect(await ents(m.id)).toEqual([{ plan: "pro", source: "manual", reference: "member trial", tier: "ultra" }]);
    expect(await seatOf(seat)).toMatchObject({ ended_why: "operator", member_id: m.id, told: 1 });
    expect(await auditOf(m.id, "operator_granted")).toEqual([`by ${op.id}, ultra, no end`]);
    expect(await auditOf(h.id, "operator_seat_ended")).toEqual([`by ${op.id}`]);
    expect(await auditOf(m.id, "operator_seat_ended")).toEqual([`by ${op.id}`]);
    // The account is on its own Ultra, in no group; the holder's group no longer counts it.
    const mine = await planFor(onEnv() as never, { id: m.id, plan: "free", plan_until: null });
    expect(mine).toEqual({ plan: "ultra", until: null, source: "entitlements" });
    const holder = await planFor(onEnv() as never, { id: h.id, plan: "pro", plan_until: null });
    expect(holder.group).toBeUndefined();
    expect(await read(await opGet(op, `/admin/users/${m.id}?m=granted_ultra_seat`))).toContain(line("en", "admin.msg_granted_ultra_seat"));
    // Again, with nothing left to end: an account with no seat is granted as before.
    const again = await opPost(op, path, { ...FIELDS, reference: "again" });
    expect(again.headers.get("location")).toBe(`/admin/users/${m.id}?m=granted_ultra`);
    expect(await auditOf(m.id, "operator_seat_ended")).toHaveLength(1);
  });

  it("ends the seat on a grant of Pro too, says so in French, and names no address or seat id in a log line or audit detail", async () => {
    const logged = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const op = await operator("off");
    const h = await person("g-pro-holder", "ultra");
    const m = await person("g-pro-member");
    const seat = await seatRow(h.id, { member: m.id, joined: -3 });
    const ask = await read(await opPost(op, `/admin/users/${m.id}/grant`, { plan: "pro", until: iso(40).slice(0, 10), reference: "pro by hand", lang: "fr" }));
    expect(ask).toContain(`<h1>${line("fr", "admin.grant_seat_title")}</h1>`);
    expect(ask).toContain(line("fr", "admin.grant_seat_ends", { plan: "Pro" }));
    expect(ask).toContain(`<a href="/admin/users/${h.id}">${broken(h.email)}</a>`);
    expect(ask).not.toContain(EM_DASH);
    expect(ask).not.toContain(EN_DASH);
    const done = await opPost(op, `/admin/users/${m.id}/grant`, { plan: "pro", until: iso(40).slice(0, 10), reference: "pro by hand", seat, confirm: "yes" });
    expect(done.headers.get("location")).toBe(`/admin/users/${m.id}?m=granted_seat`);
    expect(await seatOf(seat)).toMatchObject({ ended_why: "operator" });
    const mine = await planFor(onEnv() as never, { id: m.id, plan: "free", plan_until: null });
    expect([mine.plan, mine.seat]).toEqual(["pro", undefined]);
    const all = logged.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" "))).join("\n");
    for (const secret of [h.email, m.email, seat]) expect(all).not.toContain(secret);
    const details = (await ACCOUNTS.prepare("SELECT detail FROM audit WHERE event LIKE 'operator_%' AND user_id IN (?, ?)").bind(h.id, m.id)
      .all<{ detail: string }>()).results ?? [];
    expect(details).toHaveLength(3);
    for (const d of details) {
      expect(d.detail.startsWith(`by ${op.id}`)).toBe(true);
      expect(d.detail).not.toContain("@");
      expect(d.detail).not.toContain(seat);
    }
  });

  it("grants nothing when the seat cannot be read, or cannot be ended in the grant's batch", async () => {
    const op = await operator();
    const h = await person("g-fault-holder", "ultra");
    const m = await person("g-fault-member");
    const seat = await seatRow(h.id, { member: m.id, joined: -3 });
    vi.spyOn(console, "error").mockImplementation(() => {});
    // The read refused: the console's 503 page, nothing written, whatever the form says.
    const failing = new Proxy(ACCOUNTS, {
      get(target, prop) {
        if (prop === "prepare") {
          return (q: string) => (q === MEMBER_SEAT_SQL ? { bind: () => ({ first: () => Promise.reject(new Error("D1_ERROR: a planted fault")) }) } : target.prepare(q));
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const unread = await opPost(op, `/admin/users/${m.id}/grant`, { ...FIELDS, seat, confirm: "yes" }, { ...op.env, ACCOUNTS: failing });
    expect(unread.status).toBe(503);
    expect(await ents(m.id)).toEqual([]);
    // The seat's end refused inside the batch (a planted trigger): the grant rolls back with it.
    await ACCOUNTS.prepare(
      `CREATE TRIGGER planted_seat_fault BEFORE UPDATE OF ended_at ON seats WHEN OLD.member_id = '${m.id}' BEGIN SELECT RAISE(ABORT, 'planted fault'); END`,
    ).run();
    try {
      const unended = await opPost(op, `/admin/users/${m.id}/grant`, { ...FIELDS, seat, confirm: "yes" });
      expect(unended.status).toBe(503);
    } finally {
      await ACCOUNTS.prepare("DROP TRIGGER IF EXISTS planted_seat_fault").run();
    }
    expect(await ents(m.id)).toEqual([]);
    expect((await seatOf(seat))?.ended_at).toBeNull();
    expect(await auditOf(m.id, "operator_granted")).toEqual([]);
  });

  it("grants as before to an account with no seat row, and with the seats table absent", async () => {
    const op = await operator();
    const plain = await person("g-plain");
    const r = recording(ACCOUNTS);
    const res = await opPost(op, `/admin/users/${plain.id}/grant`, FIELDS, { ...op.env, ACCOUNTS: r.db });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/admin/users/${plain.id}?m=granted_ultra`);
    expect(await ents(plain.id)).toHaveLength(1);
    expect(await auditOf(plain.id, "operator_seat_ended")).toEqual([]);
    // The seat read first, and the seat's end in the grant's batch, which ends nothing here.
    const at = r.sent.indexOf(MEMBER_SEAT_SQL);
    expect(at).toBeGreaterThan(-1);
    expect(r.sent.indexOf(GRANT_ENDS_SEAT_SQL)).toBeGreaterThan(at);
    expect(r.sent.findIndex((s) => s.startsWith("INSERT INTO entitlements"))).toBeGreaterThan(at);
    // Through the member's index, one probe.
    const plan = ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${GRANT_ENDS_SEAT_SQL}`).bind(iso(0), plain.id).all<{ detail: string }>()).results ?? [])
      .map((x) => x.detail).join(" | ");
    expect(plan).toMatch(/SEARCH seats USING INDEX idx_seats_member_live \(member_id=\?\)/);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withoutSeats(async () => {
      const other = await person("g-no-table");
      const r2 = recording(ACCOUNTS);
      const done = await opPost(op, `/admin/users/${other.id}/grant`, { plan: "pro", until: "", reference: "no table" }, { ...op.env, ACCOUNTS: r2.db });
      expect(done.headers.get("location")).toBe(`/admin/users/${other.id}?m=granted`);
      expect(await ents(other.id)).toEqual([{ plan: "pro", source: "manual", reference: "no table", tier: null }]);
      expect(r2.sent).not.toContain(GRANT_ENDS_SEAT_SQL);
    });
  });

  it("ends a seat taken after the read in the same batch as the grant", async () => {
    const op = await operator();
    const h = await person("g-race-holder", "ultra");
    const m = await person("g-race-member");
    // The grant read no seat (seats true: the table is there); the seat is the account's by the time the batch runs.
    const seat = await seatRow(h.id, { member: m.id, joined: -1 });
    const done = await grantPlan(onEnv() as never, m.id, op.id, "pro", null, "race", new Date(), true);
    expect(done).toEqual({ result: "granted", ended: 1 });
    expect(await seatOf(seat)).toMatchObject({ ended_why: "operator" });
    expect(await auditOf(h.id, "operator_seat_ended")).toEqual([`by ${op.id}`]);
  });
});

// =====================================================================================================================
// 4 and 5. A member's dashboard, its rows' Add to dashboard, and its weekly email
// =====================================================================================================================

const T0 = Date.UTC(2026, 1, 1);
const when = (minutes: number, i = 0) => new Date(T0 + minutes * 60_000 + i * 1000).toISOString();

// An Ultra holder and n members on Free of their own, covered by its plan, joined in order (seats-rest.test.ts's).
async function groupOf(tag: number, n: number): Promise<{ holder: Fixed; members: Fixed[] }> {
  const holder = await account(tag, `cons-g${tag.toString(16)}-h@example.com`, "ultra");
  const members: Fixed[] = [];
  for (let i = 1; i <= n; i++) {
    const m = await account(tag + i, `cons-g${tag.toString(16)}-m${i}@example.com`, "free");
    await ACCOUNTS.prepare("INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id, joined_at) VALUES (?, ?, 'en', ?, ?, ?, ?)")
      .bind(hexOf(tag + i, 0xfff), holder.id, when(i * 60 - 1), "2026-12-31T00:00:00.000Z", m.id, when(i * 60)).run();
    members.push(m);
  }
  return { holder, members };
}
async function rows(n: number, f: (i: number) => D1PreparedStatement): Promise<void> {
  for (let i = 0; i < n; i += 50) await ACCOUNTS.batch(Array.from({ length: Math.min(50, n - i) }, (_, k) => f(i + k)));
}
const searchesOf = (user: string, tag: number, n: number) => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, 'off')",
).bind(hexOf(tag, 0x1000 + i), user, `/tenders?q=zzcons${tag.toString(16)}n${i}`, `Fill search ${i + 1}`, when(1000, i)));
const watchesOf = (user: string, tag: number, n: number) => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'buyer', ?, '', ?, 'award', 'daily', ?, '2026-10-30')",
).bind(hexOf(tag, 0x3000 + i), user, `fill-${tag.toString(16)}-${i}`, `Fill watch ${i + 1}`, when(1000, i)));
const viewsOf = (user: string, tag: number, n: number) => rows(n, (i) => ACCOUNTS.prepare(
  "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, ?, 'en', 'off', ?)",
).bind(hexOf(tag, 0x4000 + i), user, `/buyers/pwgsc-tpsgc/analytics?source=awards&years=${(i % 20) + 1}&from=x${i}`, `Fill view ${i + 1}`, when(1000, i)));
const search = (user: string, id: string, kind: string, params: string, label: string, minute: number) => ACCOUNTS.prepare(
  "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, ?, ?, ?, 'en', ?, 'off')",
).bind(id, user, kind, params, label, when(minute)).run();
const watch = (user: string, id: string, target: string, label: string, minute: number) => ACCOUNTS.prepare(
  "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'buyer', ?, '', ?, 'award', 'daily', ?, '2026-10-30')",
).bind(id, user, target, label, when(minute)).run();

async function pageOf(path: string, cookie: string) {
  const a = recording(ACCOUNTS);
  const res = await app.request(path, { headers: { cookie, "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, sale({ ACCOUNTS: a.db, RECORDS }));
  return { status: res.status, body: text(await res.text()), accounts: a.sent };
}
const MARK = { en: "Saved, unavailable until there is room", fr: "Enregistré, indisponible jusqu'à ce qu'il y ait de la place" } as const;
// The Add to dashboard form that names an item.
const addsItem = (body: string, ref: string) => body.includes(`<input type="hidden" name="ref" value="${ref}"/>`);
// The row of a table that holds a mark (an item's own removal form), from its <tr> to its </tr>.
const rowOf = (body: string, mark: string) => {
  const at = body.indexOf(mark);
  return at < 0 ? "" : body.slice(body.lastIndexOf("<tr>", at), body.indexOf("</tr>", at));
};

describe("a member's Add a Tile and its rows' Add to dashboard", () => {
  it("offer nothing past the member's allowance, its mark in the control's place, from the page's one read of the counts", { timeout: 60_000 }, async () => {
    await recordsAt("2026-10-31");
    const g = await groupOf(0x6100, 1);
    const m = g.members[0];
    const T = 0x6101;
    const id = (n: number) => hexOf(T, n);
    // The holder's fills: 98 searches (the member's allowance 2), 100 watches (none), 49 views (1).
    await searchesOf(g.holder.id, 0x6100, 98);
    await watchesOf(g.holder.id, 0x6100, 100);
    await viewsOf(g.holder.id, 0x6100, 49);
    // The member's own, oldest first: two tender searches in service; a briefing, an expiring search and a buyer's
    // records search past; one watch past; one view in service and one past.
    await search(m.id, id(0x101), "tenders", "/tenders?q=translation", "Cons tenders 1", 2000);
    await search(m.id, id(0x102), "tenders", "/tenders?q=hull", "Cons tenders 2", 2001);
    await ACCOUNTS.prepare("INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'segment', '81', '', '81 Engineering', 'en', ?, 'off')")
      .bind(id(0x103), m.id, when(2002)).run();
    await search(m.id, id(0x104), "expiring", "/expiring/3m", "Cons ending", 2003);
    await search(m.id, id(0x105), "buyer", "/buyers/dnd-mdn", "Cons records", 2004);
    await watch(m.id, id(0x301), "cons-watch-1", "Cons watch 1", 3000);
    await ACCOUNTS.batch([0, 1].map((i) => ACCOUNTS.prepare(
      "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, ?, 'en', 'off', ?)",
    ).bind(id(0x401 + i), m.id, `/buyers/pwgsc-tpsgc/analytics?source=awards&years=${3 + i}`, `Cons view ${i + 1}`, when(4000 + i))));
    // A stored dashboard holding a text tile alone, so the select lists every item the member may add.
    await ACCOUNTS.batch([
      ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', 0, ?)").bind(id(0x700), m.id, when(7000)),
      ACCOUNTS.prepare("INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, 'text', ?, ?, 0, 0, 12, 4, ?)")
        .bind(id(0x780), id(0x700), m.id, id(0x7f0), JSON.stringify({ text: "A note" }), when(7000)),
    ]);
    const cookie = await signIn(m.email);
    const options = (body: string) => {
      const select = /<select name="panel">([\s\S]*?)<\/select>/.exec(body)?.[1] ?? "";
      return [...select.matchAll(/<option value="([^"]*)">/g)].map((x) => x[1]);
    };
    for (const lang of ["en", "fr"] as const) {
      const q = lang === "fr" ? "?lang=fr" : "";
      const board = await pageOf(`/account/dashboard${q}`, cookie);
      expect(board.status).toBe(200);
      // The tender searches in service, the three windows, the view in service: nothing past, and no watches while
      // the allowance covers none of the member's.
      expect(options(board.body)).toEqual([`tenders:${id(0x101)}`, `tenders:${id(0x102)}`, "radar:3m", "radar:6m", "radar:12m", `view:${id(0x401)}`]);
      expect(board.accounts.filter((s) => s === POOL_COUNTS_SQL)).toHaveLength(1);
      // The searches page: a row past the allowance has its mark in the control's place; one in service its control.
      const searches = await pageOf(`/account/searches${q}`, cookie);
      const searchRow = (ref: string) => rowOf(searches.body, `action="/account/searches/${ref}/delete"`);
      for (const ref of [id(0x101), id(0x102)]) {
        expect(addsItem(searchRow(ref), ref), ref).toBe(true);
        expect(searchRow(ref)).not.toContain(MARK[lang]);
      }
      for (const ref of [id(0x104), id(0x105)]) {
        expect(searchRow(ref), ref).not.toBe("");
        expect(addsItem(searches.body, ref), ref).toBe(false);
        expect(searchRow(ref)).toContain(`<span class="muted small">${MARK[lang]}</span>`);
      }
      // The briefings panel's row, past: its mark, no control.
      expect(addsItem(searches.body, id(0x103))).toBe(false);
      expect(rowOf(searches.body, `action="/account/briefings/${id(0x103)}/delete"`)).toContain(`<span class="muted small">${MARK[lang]}</span>`);
      expect(searches.accounts.filter((s) => s === POOL_COUNTS_SQL)).toHaveLength(1);
      // The saved views page: the view in service has its control, the one past its mark alone.
      const views = await pageOf(`/account/views${q}`, cookie);
      expect(addsItem(views.body, id(0x401))).toBe(true);
      expect(addsItem(views.body, id(0x402))).toBe(false);
      expect(rowOf(views.body, `action="/account/views/${id(0x402)}/delete"`)).toContain(MARK[lang]);
      // Its tables' checklist stays, on a line of its own under the mark.
      expect(rowOf(views.body, `action="/account/views/${id(0x402)}/delete"`)).toMatch(/<\/span><br\/><a href="[^"]*" class="dash-pick">/);
      expect(views.accounts.filter((s) => s === POOL_COUNTS_SQL)).toHaveLength(1);
      for (const p of [board, searches, views]) {
        expect(p.body).not.toContain(EM_DASH);
        expect(p.body).not.toContain(EN_DASH);
      }
    }
    // The holder's own Add a Tile offers its every search: its allowance is the whole figure.
    await ACCOUNTS.batch([
      ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', 0, ?)").bind(hexOf(0x6100, 0x700), g.holder.id, when(7100)),
    ]);
    const holder = await pageOf("/account/dashboard", await signIn(g.holder.email));
    expect(options(holder.body).filter((v) => v.startsWith("tenders:"))).toHaveLength(98);
    expect(options(holder.body)).toContain("watches:");
  });
});

describe("a member's weekly email", () => {
  it("says, after its lead, how many of its watches wait for room, in its language; an account in no group past its figure reads as before", { timeout: 60_000 }, async () => {
    const day = "2026-11-02";
    await recordsAt(day);
    const g = await groupOf(0x6200, 2);
    const [m1, m2] = g.members;
    // The holder 99 watches: the first member's allowance is 1 of its 3; the second's none of its 1.
    await watchesOf(g.holder.id, 0x6200, 99);
    const targets = ["cons-buyer-a", "cons-buyer-b", "cons-buyer-c"];
    for (let i = 0; i < 3; i++) await watch(m1.id, hexOf(0x6201, 0x300 + i), targets[i], `Cons watch ${i + 1}`, 3000 + i);
    await watch(m2.id, hexOf(0x6202, 0x300), "cons-buyer-d", "Second's watch", 3100);
    await ACCOUNTS.prepare("UPDATE users SET lang = 'fr' WHERE id = ?").bind(m2.id).run();
    // An account in no group, on Free, with 4 watches past its plan's 3.
    const alone = await account(0x6300, "cons-alone@example.com", "free");
    for (let i = 0; i < 4; i++) await watch(alone.id, hexOf(0x6300, 0x300 + i), `cons-alone-${i}`, `Alone watch ${i + 1}`, 3200 + i);
    const ev = (k: number, buyer: string) => RECORDS.prepare(
      "INSERT INTO rec_events (k, day, kind, src, buyer, ref, title, path) VALUES (?, '2026-10-29', 'award', 1, ?, ?, ?, ?)",
    ).bind(k, buyer, `award:cons-${k}`, `Award to ${buyer}`, `/awards/cons-${k}`);
    await RECORDS.batch([...targets.map((b, i) => ev(9200 + i, b)), ev(9210, "cons-buyer-d"), ev(9211, "cons-alone-0")]);
    for (const u of [m1.id, m2.id, alone.id]) {
      await ACCOUNTS.prepare("INSERT INTO weekly_mail (user_id, mail, via, on_at, created_at) VALUES (?, 'on', 'account', '2026-10-20T09:00:00.000Z', '2026-10-20T09:00:00.000Z')")
        .bind(u).run();
    }
    const files: Record<string, unknown> = { "stats.json": { ...stats, data_as_of: day } };
    for (let i = 0; i < 8; i++) files[`tenders/new/${new Date(Date.parse(day) - i * 86_400_000).toISOString().slice(0, 10)}.json`] = [];
    const mail = fakeMail();
    await runDeliveries(sale({
      ASSETS: makeFakeAssets({}, files), MAIL: mail.binding, MAIL_FROM: "alerts@awardwatch.ca", MAIL_SENDER: undefined,
      SITE_URL: "https://awardwatch.ca", RECORDS, NOW: `${day}T16:00:00Z`, MAIL_ADDRESS: "1 Example Street, Example City",
    }) as never);
    const weekly = (who: Fixed) => mail.to(who.email).find((x) => /^(Your week|Votre semaine|The week|La semaine)/.test(x.subject));
    const over = (lang: Lang, n: number) => text(t(lang, n === 1 ? "pool.over_one" : "pool.over", { n: fmtInt(n, lang), things: t(lang, "pool.f_watches"), cap: fmtInt(100, lang) }));
    // The first member: news on the one page its allowance covers, then the line for the two that wait.
    const first = weekly(m1)!;
    expect(first, mail.handed.map((x) => `${x.to} ${x.subject}`).join("\n")).toBeDefined();
    const lead = text(t("en", "weekly.lead_page_one", { n: 1 }));
    const body = text(first.text ?? "");
    expect(body).toContain(`${lead}\n\n${over("en", 2)}`);
    expect(text(first.html ?? "")).toContain(over("en", 2));
    expect(body).not.toContain("Cons watch 2");
    // The second member, in French: none of its pages is covered, so the site's week, and the line in place of the
    // invitation to follow a page.
    const second = weekly(m2)!;
    expect(second).toBeDefined();
    expect(text(second.text ?? "")).toContain(over("fr", 1));
    expect(text(second.text ?? "")).not.toContain(text(t("fr", "weekly.follow_none")));
    expect(text(second.html ?? "")).toContain(over("fr", 1));
    // The account in no group: the plan's figure past, and no such line, as before.
    const own = weekly(alone)!;
    expect(own).toBeDefined();
    expect(text(`${own.text}${own.html}`)).not.toMatch(/saved and unavailable|indisponible/);
    // Its lead counts the 3 pages its plan covers, as it did.
    expect(text(own.text ?? "")).toContain(text(t("en", "weekly.lead_one", { n: 1, w: 1, all: 3 })));
    for (const x of [first, second, own]) {
      expect(`${x.text}${x.html}`).not.toContain(EM_DASH);
      expect(`${x.text}${x.html}`).not.toContain(EN_DASH);
    }
  });
});
