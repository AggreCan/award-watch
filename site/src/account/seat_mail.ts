// The seat notices (docs/accounts.md, Seats, The seat notices; docs/mail.md):
// the sixth part of the hourly delivery run (deliveries.ts runDeliveries calls
// runSeatNotices after the saved views, inside the same cap of
// RUN_MESSAGES_MAX messages, the day's ceiling and the query budget), and only
// while the seats' switch is on (seats.ts seatsSwitched; the seats table's
// presence is the due statement's own, which answers "no such table" without
// it). With the switch off the run never calls it, so it reads nothing.
//
// A member is told, by one message to its own address in its mail language
// (users.lang), when what its seat gives it changes: the seat no longer gives
// the plan ("lost"), gives it again ("back"), or has ended ("ended": removed by
// the holder, closed with the holder's account, ended by the operator). The
// seats table keeps what the member was last told (told: 1 the seat gives the
// plan, which taking it says; 0 it gives none, or it ended) and when (told_at);
// an ended seat has been told its end once told_at is at or after ended_at. A
// seat a member left, or whose member deleted the account, is set told 0 at its
// end and is never read here; an invitation (no member, the operator's
// cancellation among them) is never read either.
//
// The part reads the live seats and the ended ones not yet told, of members
// that are active and not blocked, at most SEATS_RUN_MAX a run (SEATS_DUE_SQL).
// For a live seat it reads the holder's plan once a run (planFor, which names
// the holder's group: the members its own plan covers), so a seat whose told
// already says what is true costs nothing more. A seat to tell reads its
// member's plan (planFor), which decides the message and names the plan the
// account is on now: what the site serves the member is what the message says.
// A plan that could not be read from the database now (planFor's last known
// plan) tells nobody anything, and the seat waits: a remembered plan is never
// grounds to tell a person their plan is gone. A member whose own plan is
// Ultra (the operator's grant) is told nothing of the seat while it lasts.
//
// Each message is claimed before its send by writing told and told_at, in a
// statement that holds only while the row is as the part read it, and given
// back when the send does not go, as a briefing's is. A sending limit's
// refusal stops the run and the seat is read again by the next. Any other
// refusal is counted as failed once, and the claim is given back with told_at
// set to the next UTC day, written as a date alone (SEAT_WAIT_RE): the seat is
// not read again before that day (the other parts remember a refusal for their
// own period the same way: a briefing's failed row, the weekly email's
// failed_week), and a date alone is never read as a message told, so an end
// that comes meanwhile is still told. A message is counted before anything
// after it, in the report the run hands the part, so a fault keeps its count. The message
// never says why the holder's plan changed (that is the holder's billing), and
// names no address and no other account's figure.
//
// Log lines and the run's row name counts only, never an address or an id.

import type { Env } from "../env";
import { t, type Key, type Lang } from "../i18n";
import { type Ceiling, type QueryCount, STOP_CODES, type Tally, budgetStop, sendWithHeaders, unfinished } from "./deliveries";
import type { DigestMessage } from "./digests";
import { type Plan, type PlanState, missingSeats, planFor } from "./entitlements";
import { button, escapeHtml, h1, para, shell, siteLink, textFooter, whyLine } from "./mail_html";
import { seatsSwitched } from "./seats";
import { randomHex } from "./secrets";

// Seats the part reads in one run; the next hour reads them again.
export const SEATS_RUN_MAX = 200;

// -- the message ---------------------------------------------------------------------------

export type SeatNoticeKind = "lost" | "back" | "ended";

const SUBJECT: Record<SeatNoticeKind, Key> = {
  lost: "seatmail.subject_lost", back: "seatmail.subject_back", ended: "seatmail.subject_ended",
};

// A plan's name as the message says it: "Free", "Pro", "Ultra".
const planWord = (lang: Lang, plan: Plan): string =>
  plan === "ultra" ? t(lang, "ultra.tag") : plan === "pro" ? t(lang, "pro.tag") : t(lang, "account.plan_free");

// lang: the member's mail language; plan: the plan the account is on now (for
// lost and ended); date: the day the change took effect (the seat's end for
// ended, the run's day for lost and back), as YYYY-MM-DD; site: the site's
// address with no trailing slash.
export type SeatNotice = { lang: Lang; to: string; site: string; kind: SeatNoticeKind; plan: Plan; date: string };

// One message about one seat, in the mail shell (mail_html.ts): the heading
// (the subject's words), what changed and from when, what the account keeps
// (lost and ended), the button to the account, and the footer with the reason
// and the plan and billing page. No stop link and no List-Unsubscribe: it is
// one message about one change to the account's own plan, sent once (the
// headers are the sender's own: Auto-Submitted, Reply-To the contact address).
export function seatNotice(o: SeatNotice): DigestMessage {
  const { lang } = o;
  const subject = t(lang, SUBJECT[o.kind]);
  const plan = planWord(lang, o.plan);
  const lead = o.kind === "back"
    ? t(lang, "seatmail.back", { date: o.date })
    : t(lang, o.kind === "lost" ? "seatmail.lost" : "seatmail.ended", { plan, date: o.date });
  const kept = o.kind === "back" ? null : t(lang, "seatmail.kept", { plan });
  const account = siteLink(o.site, "/account", lang);
  const billing = siteLink(o.site, "/account/billing", lang);
  const open = t(lang, "seatmail.open");
  const why = t(lang, "seatmail.why");
  const billingLabel = t(lang, "billing.title");
  const link = (label: string, url: string) => t(lang, "digest.text_link", { label, url });
  const body = [h1(subject), para(escapeHtml(lead)), kept ? para(escapeHtml(kept)) : "", button(account, open)].join("");
  const html = shell({ lang, site: o.site, subject, preheader: lead, body, why: whyLine(why, [{ href: billing, label: billingLabel }]) });
  const text = [subject, lead, ...(kept ? [kept] : []), link(open, account), `${why}\n${link(billingLabel, billing)}\n${textFooter(lang)}`].join("\n\n");
  return { to: o.to, subject, text, html, lang, headers: {} };
}

// -- what the part reads and writes -------------------------------------------------------------

// The seats that may have something to tell, at most ?1 (SEATS_RUN_MAX): every
// live seat, and every seat ended by its holder's removal, the holder's
// deletion or the operator whose end has not been told (told still 1, or told
// before the seat ended), each of a member that is active and not blocked. An
// invitation has no member and is never read. Ended seats first, by their end;
// then the live seats a holder at a time, starting at ?2 (a random id each run)
// and wrapping round, so that when more than ?1 are live every holder's are
// read in turn. holder_ok: the holder is active and not blocked, as planFor's
// own read of a member's seat says it. A seat whose last message was refused
// waits for the day its told_at names (a date alone, ?3 now): until then it is
// not read, and its told_at never counts as an end told. The table holds the
// live seats and the rows of the last 30 days (the sweep), so it is read whole;
// the two accounts by their keys.
export const SEATS_DUE_SQL =
  "SELECT s.id, s.holder_id, s.member_id, s.ended_at, s.told, s.told_at, m.email, m.lang, m.plan, m.plan_until, " +
  "h.plan AS holder_plan, h.plan_until AS holder_until, " +
  "COALESCE(h.status = 'active' AND NOT EXISTS (SELECT 1 FROM account_blocks b WHERE b.user_id = s.holder_id), 0) AS holder_ok " +
  "FROM seats s JOIN users m ON m.id = s.member_id LEFT JOIN users h ON h.id = s.holder_id " +
  "WHERE s.member_id IS NOT NULL AND m.status = 'active' AND NOT EXISTS (SELECT 1 FROM account_blocks x WHERE x.user_id = s.member_id) " +
  "AND (s.ended_at IS NULL OR (s.ended_why IN ('removed', 'closed', 'operator') " +
  "AND (s.told = 1 OR s.told_at IS NULL OR s.told_at < s.ended_at OR length(s.told_at) = 10))) " +
  "AND (s.told_at IS NULL OR length(s.told_at) <> 10 OR s.told_at <= ?3) " +
  "ORDER BY s.ended_at IS NULL, s.ended_at, s.holder_id < ?2, s.holder_id, s.joined_at, s.id LIMIT ?1";

// A refused message's mark (?2 of SEAT_RELEASE_SQL in place of the told_at it had): the next UTC day after now,
// as YYYY-MM-DD. Ten characters, where a time told is an ISO moment of 24, so the two are never taken for each
// other; it sorts before every moment of its own day, so the seat is read again from that day's first run.
export function seatWaitDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10);
}

type DueRow = {
  id: string; holder_id: string; member_id: string; ended_at: string | null; told: number; told_at: string | null;
  email: string; lang: string; plan: string; plan_until: string | null; holder_plan: string | null; holder_until: string | null; holder_ok: number;
};

// The claim: told and told_at written (?1 what the message says, ?2 now, ?3 the
// seat) only while the row is as the part read it (?4 told, ?5 told_at, ?6
// ended_at), so two runs at once send one message, and a seat ended since the
// read is told its end by the next run rather than what it was.
export const SEAT_CLAIM_SQL =
  "UPDATE seats SET told = ?1, told_at = ?2 WHERE id = ?3 AND member_id IS NOT NULL AND told = ?4 AND told_at IS ?5 AND ended_at IS ?6";

// The claim given back (?1 told, ?2 told_at as they were, or after a refusal that is not a sending limit the day
// the seat waits for, seatWaitDay; ?3 the seat), while it is this run's (?4, ?5 the claim's).
export const SEAT_RELEASE_SQL = "UPDATE seats SET told = ?1, told_at = ?2 WHERE id = ?3 AND told = ?4 AND told_at = ?5";

// -- the run ------------------------------------------------------------------------------------

export type SeatWait = "no_table";

export interface SeatReport {
  sent: number;
  failed: number;
  // Of the messages sent, each kind.
  lost: number;
  back: number;
  ended: number;
  // Seats left as they were because a plan could not be read from the database now.
  unread: number;
  // The seats table is not on the database (the part reads nothing more).
  records: SeatWait | null;
}

export const emptySeatReport = (): SeatReport => ({ sent: 0, failed: 0, lost: 0, back: 0, ended: 0, unread: 0, records: null });

export const SEAT_WAIT_WHY: Record<SeatWait, string> = {
  no_table: "the accounts database has no seats table (apply accounts_schema.sql)",
};

export const seatActive = (r: SeatReport) => r.sent + r.failed + r.unread > 0 || r.records !== null;

export const seatCounts = (r: SeatReport) =>
  `seat notices: ${r.sent} sent (${r.lost} lost, ${r.back} back, ${r.ended} ended), ${r.failed} failed, ${r.unread} waiting on a plan not read` +
  (r.records ? `, ${SEAT_WAIT_WHY[r.records]}` : "");

// site, dataDate, now: the run's; room: the messages the run may still send
// (the cap less what the five parts before it sent or tried); capText: the
// cap's words for the run log; queries: the run's count (deliveries.ts
// QueryCount); tally: what the run left due, which this part adds to on every
// way out; ceiling: what the day's ceiling still allows (deliveries.ts
// Ceiling); report: the report to fill, the caller's, so a fault keeps what
// was sent before it (deliveries.ts partFault); a part run alone makes its own.
// report null: the switch is off, and nothing was read.
export async function runSeatNotices(
  env: Env,
  o: {
    site: string; dataDate: string; now: Date; room: number; capText: string; queries?: QueryCount; tally?: Tally; ceiling?: Ceiling;
    report?: SeatReport;
  },
): Promise<{ report: SeatReport | null; stop: string | null; capped: boolean }> {
  if (!seatsSwitched(env)) return { report: null, stop: null, capped: false };
  const { site, now } = o;
  const report = o.report ?? emptySeatReport();
  const at = now.toISOString();
  let due: DueRow[];
  try {
    due = (await env.ACCOUNTS!.prepare(SEATS_DUE_SQL).bind(SEATS_RUN_MAX, randomHex(16), at).all<DueRow>()).results ?? [];
  } catch (e) {
    if (!missingSeats(e)) throw e;
    report.records = "no_table";
    return { report, stop: null, capped: false };
  }
  const today = at.slice(0, 10);
  let stop = null as string | null;
  let capped = false;
  // The claim this run holds and has not yet sent or given back: a fault in between gives it back.
  let held = null as { row: DueRow; told: number } | null;
  // Each holder's plan, read once a run; each member's, read once a run where a seat of it is to be told.
  const holders = new Map<string, PlanState>();
  const members = new Map<string, PlanState>();
  // The rows known to wait for a message and not yet dealt with, and those found due that waited on a member's plan
  // not read, for what the run leaves due.
  const pending = new Set<string>();
  let waited = 0;

  // Past the run's query budget (claiming: too little left for a claim and its writes), nothing more is taken up.
  const pause = (claiming = false): boolean => {
    const why = budgetStop(o.queries, claiming);
    if (why) {
      stop = why;
      capped = true;
    }
    return why !== null;
  };
  // Under the room, under the day's ceiling, with the queries for a claim and its writes left.
  const mayTakeUp = (): boolean => {
    if (report.sent + report.failed >= o.room) {
      stop = o.capText;
      capped = true;
      return false;
    }
    // The day's ceiling reached: stopped before the claim, as a sending limit stops the run.
    if (o.ceiling && report.sent >= o.ceiling.room) {
      stop = o.ceiling.text;
      return false;
    }
    return !pause(true);
  };
  const planOf = async (cache: Map<string, PlanState>, user: { id: string; plan: string | null; plan_until: string | null }) => {
    let read = cache.get(user.id);
    if (!read) {
      read = await planFor(env, { id: user.id, plan: user.plan ?? "free", plan_until: user.plan_until }, now);
      cache.set(user.id, read);
    }
    return read;
  };
  // The claim given back as the row was; toldAt the day the seat waits for after a refusal that is not a limit.
  const release = (row: DueRow, told: number, toldAt: string | null = row.told_at) =>
    env.ACCOUNTS!.prepare(SEAT_RELEASE_SQL).bind(row.told, toldAt, row.id, told, at).run();

  // One seat: what is true now, and the message when it differs from what the member was told.
  const tell = async (row: DueRow): Promise<"next" | "stop"> => {
    if (!row.ended_at) {
      // What the holder's plan gives the seat: the holder active and not blocked, and the seat among those its own
      // plan covers (its group). A holder that holds a seat itself names another's group: its members are read alone.
      let gives: boolean | null = false;
      if (row.holder_ok) {
        if (pause()) return "stop";
        const hp = await planOf(holders, { id: row.holder_id, plan: row.holder_plan, plan_until: row.holder_until });
        if (hp.source !== "entitlements") {
          report.unread++;
          return "next";
        }
        gives = hp.seat ? null : !!hp.group && hp.group.holderId === row.holder_id && hp.group.ids.includes(row.member_id);
      }
      if (gives !== null && (gives ? 1 : 0) === row.told) return "next";
    }
    pending.add(row.id);
    // The member's plan decides: what the site serves the account is what the message says.
    if (pause()) return "stop";
    const mp = await planOf(members, { id: row.member_id, plan: row.plan, plan_until: row.plan_until });
    if (mp.source !== "entitlements") {
      pending.delete(row.id);
      report.unread++;
      waited++;
      return "next";
    }
    let kind: SeatNoticeKind;
    if (row.ended_at) kind = "ended";
    else {
      const mine = mp.seat?.id === row.id;
      const covered = mine && !!mp.seat?.covered;
      // A seat that stopped giving the plan to an account on Ultra of its own changes nothing it is served.
      if (row.told === 1 && mine && !covered && mp.plan !== "ultra") kind = "lost";
      else if (row.told === 0 && covered) kind = "back";
      else {
        pending.delete(row.id);
        return "next";
      }
    }
    if (!mayTakeUp()) return "stop";
    const told = kind === "back" ? 1 : 0;
    const claimed = await env.ACCOUNTS!.prepare(SEAT_CLAIM_SQL).bind(told, at, row.id, row.told, row.told_at, row.ended_at).run();
    // Another run told it, or the seat changed since the read: the next run reads it again.
    if ((claimed.meta?.changes ?? 0) !== 1) {
      pending.delete(row.id);
      return "next";
    }
    held = { row, told };
    const lang: Lang = row.lang === "fr" ? "fr" : "en";
    const message = seatNotice({ lang, to: row.email, site, kind, plan: mp.plan, date: kind === "ended" ? row.ended_at!.slice(0, 10) : today });
    const result = await sendWithHeaders(env, site, message);
    if (result.sent) {
      // Sent: the claim is the record, and the message is counted before anything else is read or written.
      held = null;
      pending.delete(row.id);
      report.sent++;
      report[kind]++;
      return "next";
    }
    const limited = !!result.code && STOP_CODES.has(result.code);
    // A refusal that is not a limit is a message tried: counted before the claim is given back, which then marks
    // the seat to wait for the next UTC day, so it is tried once a day and not every run.
    if (!limited) report.failed++;
    await release(row, told, limited ? row.told_at : seatWaitDay(now));
    held = null;
    if (limited) {
      stop = result.code;
      return "stop";
    }
    pending.delete(row.id);
    return "next";
  };

  // Whether a seat not dealt with is due, as far as the run knows without reading more: an ended one by its row, a live
  // one found due, or one whose holder's plan the run has read (or whose holder is no longer active or is blocked).
  const knownDue = (r: DueRow): boolean => {
    if (r.ended_at || pending.has(r.id)) return true;
    if (!r.holder_ok) return r.told === 1;
    const hp = holders.get(r.holder_id);
    if (!hp || hp.source !== "entitlements" || hp.seat) return false;
    return (!!hp.group && hp.group.holderId === r.holder_id && hp.group.ids.includes(r.member_id) ? 1 : 0) !== r.told;
  };

  let i = 0;
  try {
    for (; i < due.length; i++) {
      if ((await tell(due[i])) === "stop") break;
    }
  } catch (e) {
    if (held) await release(held.row, held.told).catch(() => undefined);
    throw e;
  } finally {
    // From the seat in hand on, those known to be due, and those that waited on a plan not read.
    if (o.tally) o.tally.left += waited + unfinished(due, i, knownDue);
  }
  return { report, stop, capped };
}
