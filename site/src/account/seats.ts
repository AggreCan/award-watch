// Seats (docs/accounts.md, Seats): the people a paid plan with more than one
// seat is given to, in the seats table (accounts_schema.sql). How a seat gives
// its member a plan, and the group it puts the member in, is read with the
// plan itself (entitlements.ts planFor). This file holds what ends a seat with
// an account, the sweep of the rows past their keeping, and the console's
// read of an account's seats. No page creates a seat yet: an invitation, its
// page and the holder's Seats page come later, behind a switch of their own.
//
// Every statement is bound to the account it is about, and every read here
// returns the console's own view: addresses and dates, never what an account
// keeps.

import type { Env } from "../env";
import { missingSeats, seatsReady } from "./entitlements";
import { plusDays } from "./secrets";

// How long a seat is kept after it ends, and an invitation never taken after
// it was sent (signin.ts sweep): the joins of the last 30 days are counted
// from the rows, ended or not.
export const SEAT_KEEP_DAYS = 30;

// ?1 the moment SEAT_KEEP_DAYS ago.
export const SEATS_SWEEP_SQL =
  "DELETE FROM seats WHERE (member_id IS NULL AND invited_at < ?1) OR (ended_at IS NOT NULL AND ended_at < ?1)";

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
