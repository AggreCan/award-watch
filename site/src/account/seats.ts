// Seats (docs/accounts.md, Seats): the people a paid plan with more than one
// seat is given to, in the seats table (accounts_schema.sql). How a seat gives
// its member a plan, and the group it puts the member in, is read with the
// plan itself (entitlements.ts planFor). This file holds the seats' own
// statements: an invitation and its refusals, its cancellation, the join
// page's read of it, taking and declining it, leaving a seat and removing a
// member; what ends a seat with an account; the sweep of the rows past their
// keeping; and the reads of the Seats page, the overview and the console. The
// pages are seats_pages.tsx, behind the switch below.
//
// Every statement is bound to the account it is about, from the session's own
// read, never to an id a form names: a holder's statements carry holder_id, a
// member's member_id. Every cap is counted inside the statement that holds it,
// so two posts at once cannot pass it together (D1 writes one statement at a
// time). An invitation's secret is 32 random bytes shown once in its link and
// kept only as SHA-256 (token_hash), compared in constant time, and cleared by
// the statement that takes, declines or cancels it. Nothing here logs or
// audits an address, an id or a secret, and every read returns addresses and
// dates, never what an account keeps.

import type { Env } from "../env";
import type { Lang } from "../i18n";
import { type Plan, memberSeats, missingSeats, seatsReady } from "./entitlements";
import { newId, plusDays, randomHex, sameHash, sha256Hex } from "./secrets";
import { accountsEnabled } from "./switch";

// How long a seat is kept after it ends, and an invitation never taken after
// it was sent (signin.ts sweep): the joins of the last 30 days are counted
// from the rows, ended or not.
export const SEAT_KEEP_DAYS = 30;

// ?1 the moment SEAT_KEEP_DAYS ago.
export const SEATS_SWEEP_SQL =
  "DELETE FROM seats WHERE (member_id IS NULL AND invited_at < ?1) OR (ended_at IS NOT NULL AND ended_at < ?1)";

// -- the switch ------------------------------------------------------------------------------

// SEATS "on" in wrangler.jsonc, with the accounts switch on: what the limiter
// asks (limits.ts), which reads nothing.
export const seatsSwitched = (env: Pick<Env, "SEATS" | "ACCOUNTS_ENABLED" | "ACCOUNTS">): boolean =>
  env.SEATS === "on" && accountsEnabled(env);

// The switch as every seats page and post reads it: switched on and the
// table on the database (seatsReady, a true answer kept for the isolate's
// life). Off, nothing is read: the variable is asked first.
export async function seatsOn(env: Env, now: Date = new Date()): Promise<boolean> {
  return seatsSwitched(env) && (await seatsReady(env, now));
}

// -- the figures --------------------------------------------------------------------------------

// An invitation's link works this many days (the schema's expires_at).
export const SEAT_INVITE_DAYS = 7;
// Invitations a holder sends in any 24 hours, and to one address in any SEAT_WINDOW_DAYS.
export const SEAT_INVITES_PER_DAY = 10;
export const SEAT_INVITES_PER_ADDRESS = 2;
// The window of the per-address count and of the joins.
export const SEAT_WINDOW_DAYS = 30;
// The people a holder may replace in that window beyond its member seats (the
// operator's ruling of 2026-11-16, "Agree on 3"): Ultra 4 + 2 = 6 joins.
export const SEAT_SWAPS = 2;
export const joinsAllowed = (plan: Plan): number => (memberSeats(plan) > 0 ? memberSeats(plan) + SEAT_SWAPS : 0);

const HOUR_MS = 3_600_000;

// -- an invitation -----------------------------------------------------------------------------

// One statement, 13 bound values: ?1 the row's id, ?2 the holder, ?3 the
// invited address (normalized as sign-in normalizes it), ?4 SHA-256 of the
// link's secret, ?5 the message's language, ?6 now, ?7 the link's end, ?8 the
// member seats of the holder's own plan, ?9 24 hours ago, ?10
// SEAT_INVITES_PER_DAY, ?11 SEAT_WINDOW_DAYS ago, ?12 SEAT_INVITES_PER_ADDRESS,
// ?13 the joins the plan allows. The seats in use are the live seats and the
// open invitations; the joins are the seats joined in the window, ended or
// not, with the open invitations, each of which may become one. Every count
// reads through idx_seats_holder or idx_seats_email.
export const INVITE_SQL =
  "INSERT INTO seats (id, holder_id, email, token_hash, lang, invited_at, expires_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 " +
  "WHERE (SELECT COUNT(*) FROM seats WHERE holder_id = ?2 AND ended_at IS NULL AND (member_id IS NOT NULL OR expires_at > ?6)) < ?8 " +
  "AND (SELECT COUNT(*) FROM seats WHERE holder_id = ?2 AND invited_at > ?9) < ?10 " +
  "AND (SELECT COUNT(*) FROM seats WHERE holder_id = ?2 AND email = ?3 AND invited_at > ?11) < ?12 " +
  "AND (SELECT COUNT(*) FROM seats WHERE holder_id = ?2 AND joined_at > ?11) " +
  "+ (SELECT COUNT(*) FROM seats WHERE holder_id = ?2 AND member_id IS NULL AND ended_at IS NULL AND expires_at > ?6) < ?13 " +
  "AND NOT EXISTS (SELECT 1 FROM seats s JOIN users u ON u.id = s.member_id WHERE s.holder_id = ?2 AND s.ended_at IS NULL AND u.email = ?3) " +
  "AND NOT EXISTS (SELECT 1 FROM seats WHERE holder_id = ?2 AND email = ?3 AND member_id IS NULL AND ended_at IS NULL AND expires_at > ?6)";

// Why an invitation was not written, read once the insert has written nothing
// (?1 the holder, ?2 the address, ?3 now, ?4 24 hours ago, ?5 the window's
// start): the same counts the insert held, and the earliest of the joins and
// open invitations it counted, for the day the joins have room again.
export const INVITE_WHY_SQL =
  "SELECT (SELECT COUNT(*) FROM seats s JOIN users u ON u.id = s.member_id WHERE s.holder_id = ?1 AND s.ended_at IS NULL AND u.email = ?2) AS member, " +
  "(SELECT COUNT(*) FROM seats WHERE holder_id = ?1 AND email = ?2 AND member_id IS NULL AND ended_at IS NULL AND expires_at > ?3) AS open, " +
  "(SELECT COUNT(*) FROM seats WHERE holder_id = ?1 AND ended_at IS NULL AND (member_id IS NOT NULL OR expires_at > ?3)) AS used, " +
  "(SELECT COUNT(*) FROM seats WHERE holder_id = ?1 AND invited_at > ?4) AS day, " +
  "(SELECT COUNT(*) FROM seats WHERE holder_id = ?1 AND email = ?2 AND invited_at > ?5) AS address, " +
  "(SELECT COUNT(*) FROM seats WHERE holder_id = ?1 AND joined_at > ?5) AS joined, " +
  "(SELECT COUNT(*) FROM seats WHERE holder_id = ?1 AND member_id IS NULL AND ended_at IS NULL AND expires_at > ?3) AS waiting, " +
  "(SELECT MIN(joined_at) FROM seats WHERE holder_id = ?1 AND joined_at > ?5) AS first_join, " +
  "(SELECT MIN(expires_at) FROM seats WHERE holder_id = ?1 AND member_id IS NULL AND ended_at IS NULL AND expires_at > ?3) AS first_end";

// The refusals, each with its line (seats_pages.tsx): the address holds a seat
// of this holder (member), has an invitation of its waiting (open), every seat
// is in use (full), the joins of the window are spent (joins: n, and the day
// they have room), the day's invitations are spent (day: n), the address's are
// (address: n).
export type InviteRefusal =
  | { why: "member" } | { why: "open" } | { why: "full" } | { why: "joins"; n: number; date: string }
  | { why: "day"; n: number } | { why: "address"; n: number };
export type Invited = { ok: true; id: string; secret: string; expiresAt: string };

export type Holder = { userId: string; plan: Plan };

// An invitation from a holder whose own plan has member seats (the caller has
// checked that, the session read from the database, the address not the
// holder's own and the day's mail ceiling): the row and its secret, which goes
// into the link and nowhere else, or why none was written.
export async function invite(env: Env, holder: Holder, email: string, lang: Lang, now: Date = new Date()): Promise<Invited | InviteRefusal> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const id = newId();
  const secret = randomHex(32);
  const expiresAt = plusDays(now, SEAT_INVITE_DAYS);
  const day = new Date(now.getTime() - 24 * HOUR_MS).toISOString();
  const window = plusDays(now, -SEAT_WINDOW_DAYS);
  const res = await db.prepare(INVITE_SQL).bind(
    id, holder.userId, email, await sha256Hex(secret), lang, at, expiresAt, memberSeats(holder.plan), day, SEAT_INVITES_PER_DAY, window,
    SEAT_INVITES_PER_ADDRESS, joinsAllowed(holder.plan),
  ).run();
  if ((res.meta?.changes ?? 0) === 1) return { ok: true, id, secret, expiresAt };
  type Why = {
    member: number; open: number; used: number; day: number; address: number; joined: number; waiting: number;
    first_join: string | null; first_end: string | null;
  };
  const why = await db.prepare(INVITE_WHY_SQL).bind(holder.userId, email, at, day, window).first<Why>();
  if (!why) return { why: "full" };
  if (why.member) return { why: "member" };
  if (why.open) return { why: "open" };
  if (why.used >= memberSeats(holder.plan)) return { why: "full" };
  const joins = why.joined + why.waiting;
  if (joins >= joinsAllowed(holder.plan)) {
    // The first day one of those counted leaves the window: a join 30 days after it, an open invitation when its link ends.
    const ends = [why.first_join ? plusDays(new Date(why.first_join), SEAT_WINDOW_DAYS) : null, why.first_end].filter((d): d is string => !!d).sort();
    return { why: "joins", n: joins, date: (ends[0] ?? at).slice(0, 10) };
  }
  if (why.day >= SEAT_INVITES_PER_DAY) return { why: "day", n: why.day };
  if (why.address >= SEAT_INVITES_PER_ADDRESS) return { why: "address", n: why.address };
  // Changed between the two statements: the seats in use are the likeliest.
  return { why: "full" };
}

// An invitation whose message did not go: removed whole, as if never written,
// so it holds no seat and counts against nothing.
export async function dropInvitation(env: Env, holderId: string, id: string): Promise<void> {
  await env.ACCOUNTS!.prepare("DELETE FROM seats WHERE id = ?1 AND holder_id = ?2 AND member_id IS NULL").bind(id, holderId).run();
}

// The holder's Cancel on an invitation still open: ended, its link's hash
// cleared, so the link stops at once. The address stays on the row until the
// sweep (30 days after sending), so the per-address count still holds it.
// True when one was cancelled; the same answer otherwise whatever the id names.
export async function cancelInvitation(env: Env, holderId: string, id: string, now: Date = new Date()): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE seats SET ended_at = ?1, ended_why = 'cancelled', token_hash = NULL WHERE id = ?2 AND holder_id = ?3 AND member_id IS NULL AND ended_at IS NULL",
  ).bind(now.toISOString(), id, holderId).run();
  return (res.meta?.changes ?? 0) === 1;
}

// -- the holder's seats ----------------------------------------------------------------------------

// A live seat the holder gives: its member's id and address and when it was joined.
export type LiveSeat = { id: string; member_id: string; member_email: string; joined_at: string };
// An invitation still open: the address it went to, when, and when its link ends.
export type OpenInvitation = { id: string; email: string; invited_at: string; expires_at: string };
export type HolderSeats = { seats: LiveSeat[]; invitations: OpenInvitation[]; joins: number };

// The Seats page's read for a holder, one batch through idx_seats_holder: its
// live seats in the order its plan covers them (joined, then id), its open
// invitations by sending, and the joins of the window (ended rows counted).
export async function holderSeats(env: Env, holderId: string, now: Date = new Date()): Promise<HolderSeats> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const [seats, invitations, joins] = await db.batch([
    db.prepare(
      "SELECT s.id, s.member_id, u.email AS member_email, s.joined_at FROM seats s JOIN users u ON u.id = s.member_id " +
      "WHERE s.holder_id = ?1 AND s.ended_at IS NULL AND s.member_id IS NOT NULL ORDER BY s.joined_at, s.id",
    ).bind(holderId),
    db.prepare(
      "SELECT id, email, invited_at, expires_at FROM seats WHERE holder_id = ?1 AND member_id IS NULL AND ended_at IS NULL AND expires_at > ?2 " +
      "ORDER BY invited_at, id",
    ).bind(holderId, at),
    db.prepare("SELECT COUNT(*) AS n FROM seats WHERE holder_id = ?1 AND joined_at > ?2").bind(holderId, plusDays(now, -SEAT_WINDOW_DAYS)),
  ]);
  return {
    seats: (seats.results ?? []) as LiveSeat[],
    invitations: (invitations.results ?? []) as OpenInvitation[],
    joins: Number((joins.results?.[0] as { n?: number } | undefined)?.n ?? 0),
  };
}

// The seats an account gives that are in use, its own aside: the live seats
// and the open invitations. The overview's row and the billing page's link
// read it, while the switch is on.
export const SEATS_IN_USE_SQL =
  "SELECT COUNT(*) AS n FROM seats WHERE holder_id = ?1 AND ended_at IS NULL AND (member_id IS NOT NULL OR expires_at > ?2)";

export async function seatsInUse(env: Env, holderId: string, now: Date = new Date()): Promise<number> {
  const row = await env.ACCOUNTS!.prepare(SEATS_IN_USE_SQL).bind(holderId, now.toISOString()).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

// The member of one of the holder's live seats, by the seat's id, for the
// removal's page; null for any other id, whoever's it is.
export async function seatMember(env: Env, holderId: string, id: string): Promise<string | null> {
  const row = await env.ACCOUNTS!.prepare(
    "SELECT u.email FROM seats s JOIN users u ON u.id = s.member_id WHERE s.id = ?1 AND s.holder_id = ?2 AND s.member_id IS NOT NULL AND s.ended_at IS NULL",
  ).bind(id, holderId).first<{ email: string }>();
  return row?.email ?? null;
}

// The holder's removal of a member: the seat ended (removed), the member back on
// its own plan from its next read; told stays as it was, so the seat notices
// tell the member the seat ended. The member's address, for the page's line,
// when a seat was ended; null otherwise, whatever the id names.
export async function removeSeat(env: Env, holderId: string, id: string, now: Date = new Date()): Promise<string | null> {
  const email = await seatMember(env, holderId, id);
  if (!email) return null;
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE seats SET ended_at = ?1, ended_why = 'removed' WHERE id = ?2 AND holder_id = ?3 AND member_id IS NOT NULL AND ended_at IS NULL",
  ).bind(now.toISOString(), id, holderId).run();
  return (res.meta?.changes ?? 0) === 1 ? email : null;
}

// A member's Leave: its own live seat ended (left), told set to 0 so no notice
// follows (the page itself said so). True when a seat was ended.
export async function leaveSeat(env: Env, memberId: string, now: Date = new Date()): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE seats SET ended_at = ?1, ended_why = 'left', told = 0, told_at = ?1 WHERE member_id = ?2 AND ended_at IS NULL",
  ).bind(now.toISOString(), memberId).run();
  return (res.meta?.changes ?? 0) === 1;
}

// -- the join page -------------------------------------------------------------------------------

const ID_RE = /^[0-9a-f]{32}$/;
const SECRET_RE = /^[0-9a-f]{64}$/;

// An invitation as the join page reads it, once its link's secret has matched:
// its holder (id, address, the plan columns planFor reads), the address it went
// to, its language and when its link ends, and the hash the take and the
// decline are bound to.
export type Invitation = {
  id: string; holderId: string; holderEmail: string; holderPlan: string; holderUntil: string | null;
  email: string; lang: Lang; expiresAt: string; tokenHash: string;
};

type InvitationRow = {
  id: string; holder_id: string; email: string | null; token_hash: string | null; lang: string; expires_at: string;
  member_id: string | null; ended_at: string | null; holder_email: string; holder_status: string; holder_plan: string; holder_until: string | null;
};

// The invitation a link names, or null: an id or a secret of another shape, no
// such row, a secret that does not match (compared in constant time), and an
// invitation taken, declined, cancelled, run out or of a holder no longer
// active all answer null, the same way, so the page tells none of them apart
// and cannot be used to test ids. Reads one row by its key; writes nothing.
export async function readInvitation(env: Env, id: string | undefined, secret: string | undefined, now: Date = new Date()): Promise<Invitation | null> {
  if (!id || !secret || !ID_RE.test(id) || !SECRET_RE.test(secret)) return null;
  const row = await env.ACCOUNTS!.prepare(
    "SELECT s.id, s.holder_id, s.email, s.token_hash, s.lang, s.expires_at, s.member_id, s.ended_at, h.email AS holder_email, " +
    "h.status AS holder_status, h.plan AS holder_plan, h.plan_until AS holder_until FROM seats s JOIN users h ON h.id = s.holder_id WHERE s.id = ?1",
  ).bind(id).first<InvitationRow>();
  const hash = await sha256Hex(secret);
  if (!row || !row.token_hash || !sameHash(hash, row.token_hash)) return null;
  if (row.member_id || row.ended_at || !row.email || row.expires_at <= now.toISOString() || row.holder_status !== "active") return null;
  return {
    id: row.id, holderId: row.holder_id, holderEmail: row.holder_email, holderPlan: row.holder_plan, holderUntil: row.holder_until,
    email: row.email, lang: row.lang === "fr" ? "fr" : "en", expiresAt: row.expires_at, tokenHash: row.token_hash,
  };
}

// Taking the seat (the caller has checked the session's address is the
// invitation's, the session read from the database, the account holding no
// seat and no paid plan of its own, and read the holder's own plan): one
// statement, 7 bound values (?1 the member, ?2 now, ?3 the row, ?4 the member
// seats of the holder's plan, ?5 the window's start, ?6 the joins it allows,
// ?7 the link's hash the page compared). It writes the member and clears the
// address and the hash only while the invitation is still open, its hash the
// one compared, the holder's live seats below its plan's and the window's
// joins below the figure.
export const TAKE_SQL =
  "UPDATE seats SET member_id = ?1, joined_at = ?2, email = NULL, token_hash = NULL, told = 1, told_at = ?2 " +
  "WHERE id = ?3 AND member_id IS NULL AND ended_at IS NULL AND token_hash = ?7 AND expires_at > ?2 " +
  "AND (SELECT COUNT(*) FROM seats o WHERE o.holder_id = seats.holder_id AND o.member_id IS NOT NULL AND o.ended_at IS NULL) < ?4 " +
  "AND (SELECT COUNT(*) FROM seats o WHERE o.holder_id = seats.holder_id AND o.joined_at > ?5) < ?6";

// taken; seated (the account took another seat at the same moment: the unique
// index of live members refused this one); no_room (the invitation still open,
// but the holder's plan holds no seat for it now, or the window's joins are
// spent); stale (taken, declined or cancelled since the page read it).
export type Taken = "taken" | "seated" | "no_room" | "stale";

const uniqueMember = (e: unknown): boolean => /UNIQUE constraint failed:?\s*seats\.member_id/i.test(String((e as { message?: unknown })?.message ?? e));

export async function takeSeat(env: Env, inv: Invitation, memberId: string, holderPlan: Plan, now: Date = new Date()): Promise<Taken> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  let changes = 0;
  try {
    const res = await db.prepare(TAKE_SQL).bind(
      memberId, at, inv.id, memberSeats(holderPlan), plusDays(now, -SEAT_WINDOW_DAYS), joinsAllowed(holderPlan), inv.tokenHash,
    ).run();
    changes = res.meta?.changes ?? 0;
  } catch (e) {
    if (uniqueMember(e)) return "seated";
    throw e;
  }
  if (changes === 1) return "taken";
  // Still open with the same hash: the plan or the joins refused it; anything else ended it since.
  const open = await db.prepare(
    "SELECT 1 AS x FROM seats WHERE id = ?1 AND member_id IS NULL AND ended_at IS NULL AND token_hash = ?2 AND expires_at > ?3",
  ).bind(inv.id, inv.tokenHash, at).first();
  return open ? "no_room" : "stale";
}

// Declining: the invitation ended (declined) and its hash cleared, the seat
// free at once. Bound to the hash the page compared, so a link used once
// cannot decline again. True when it was declined.
export async function declineInvitation(env: Env, inv: Invitation, now: Date = new Date()): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE seats SET ended_at = ?1, ended_why = 'declined', token_hash = NULL WHERE id = ?2 AND member_id IS NULL AND ended_at IS NULL AND token_hash = ?3",
  ).bind(now.toISOString(), inv.id, inv.tokenHash).run();
  return (res.meta?.changes ?? 0) === 1;
}

// An account's deletion (routes.tsx deleteAccount), on both sides: the seats it
// gives end (closed) with every open invitation, each address on them cleared;
// the seat it holds ends (deleted), told set to 0 so no notice follows; and every
// invitation to its address that was never taken goes. In one batch of their
// own, before the account's row loses its address, so a database without the
// table still deletes everything else.
export async function endSeatsOf(env: Env, userId: string, email: string, now = new Date()): Promise<void> {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  try {
    await db.batch([
      db.prepare("UPDATE seats SET ended_at = ?1, ended_why = 'closed', email = NULL, token_hash = NULL WHERE holder_id = ?2 AND ended_at IS NULL")
        .bind(at, userId),
      db.prepare("UPDATE seats SET ended_at = ?1, ended_why = 'deleted', told = 0 WHERE member_id = ?2 AND ended_at IS NULL").bind(at, userId),
      db.prepare("DELETE FROM seats WHERE email = ?1 AND member_id IS NULL").bind(email),
    ]);
  } catch (e) {
    if (!missingSeats(e)) throw e;
  }
}

// -- the console's read ------------------------------------------------------------------

// A row the account gives as a holder: the member's id and address once
// taken, the invited address while an invitation, and its dates.
export type HeldSeat = {
  id: string; member_id: string | null; member_email: string | null; email: string | null;
  invited_at: string; expires_at: string; joined_at: string | null; ended_at: string | null; ended_why: string | null;
};
// The live seat the account holds as a member, with its holder's id and address.
export type MemberSeat = { id: string; holder_id: string; holder_email: string; joined_at: string };

export type AccountSeats = { held: HeldSeat[]; member: MemberSeat | null };

// The console's Seats panel (admin.tsx): the account's rows as a holder that
// are live, open, or ended in the last SEAT_KEEP_DAYS, and the live seat it
// holds as a member. null, and nothing read, while the table is not on the
// database; both empty for an account with no seat row on either side.
export async function seatsOfAccount(env: Env, userId: string, now = new Date()): Promise<AccountSeats | null> {
  if (!(await seatsReady(env, now))) return null;
  const db = env.ACCOUNTS!;
  const [held, member] = await db.batch([
    db.prepare(
      "SELECT s.id, s.member_id, u.email AS member_email, s.email, s.invited_at, s.expires_at, s.joined_at, s.ended_at, s.ended_why " +
      "FROM seats s LEFT JOIN users u ON u.id = s.member_id WHERE s.holder_id = ?1 AND (s.ended_at IS NULL OR s.ended_at >= ?2)",
    ).bind(userId, plusDays(now, -SEAT_KEEP_DAYS)),
    db.prepare(
      "SELECT s.id, s.holder_id, h.email AS holder_email, s.joined_at FROM seats s JOIN users h ON h.id = s.holder_id " +
      "WHERE s.member_id = ?1 AND s.ended_at IS NULL",
    ).bind(userId),
  ]);
  const rows = (held.results ?? []) as HeldSeat[];
  // Live seats in the order the plan covers them (joined, then id), then the
  // invitations by sending, then the ended rows, the latest first.
  const rank = (r: HeldSeat) => (r.ended_at ? 2 : r.member_id ? 0 : 1);
  const key = (r: HeldSeat) => (r.ended_at ? r.ended_at : r.joined_at ?? r.invited_at);
  rows.sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? cmp(key(b), key(a)) : cmp(key(a), key(b))) || cmp(a.id, b.id));
  return { held: rows, member: ((member.results ?? [])[0] ?? null) as MemberSeat | null };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
