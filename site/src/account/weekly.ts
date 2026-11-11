// The weekly email (docs/accounts.md, Weekly email): one message a week to
// any account, Free or Pro, that turned it on, either with the box on the
// sign-in form or with the control on the account page. No account is ever
// enrolled otherwise. The accounts database keeps the choice in weekly_mail
// (accounts_schema.sql); the message is digests.ts weeklyDigest.
//
// The message: what happened in the week on the pages the account follows
// (its watches, grouped as the watch mail groups them, watch_mail.ts
// groupsFor), or, when it follows nothing or nothing happened, the week on
// the site in figures; for an account that names its organization, the
// week's matching notices (fit_mail.ts, at its plan's match_mail figure, Pro
// included: a Pro account whose weekly email is on gets them here and not in
// its watch mail); one line on what Pro adds for an account without
// Pro's mail; and a footer with the sender's name and mailing address
// (MAIL_ADDRESS), why it came, and the unsubscribe link.
//
// The run is the delivery job's last part (deliveries.ts runDeliveries calls
// runWeekly after the briefings, inside the same cap of RUN_MESSAGES_MAX
// messages, and holds itself to WEEKLY_RUN_MAX of them). An account is due
// once a week: on the week's opening day (briefings.ts weekAnchor, Monday), or
// on the next data date of the same week when Monday's nightly came late or
// the run's ceiling left it waiting; never when the week is covered already,
// never in the week a message to it was refused, and only from the first
// opening day after the email was turned on. It is claimed for the week
// before its message goes and given back when the send does not go, as a
// saved search is, so two runs at once send it once. A deleted or blocked
// account is never due.
//
// Until the table exists on the database the feature is left out whole: the
// sign-in form has no box, the account page no control, the run reads nothing
// and logs nothing new. With MAIL_ADDRESS unset, nothing is sent and the
// run's line says so.
//
// Log lines name counts and dates only, never an address.

import { addDays } from "../../public/closing.js";
import { clockAt } from "../closing";
import { type Stats, closingSoonTotal, loadExpiringIndex } from "../data";
import type { Env } from "../env";
import type { Lang } from "../i18n";
import { num, readRecords } from "../records_db";
import { WEEK_DAYS, weekAnchor } from "./briefings";
import { type Files, STOP_CODES, sendWithHeaders } from "./deliveries";
import { WEEKLY_ENDING_MONTHS, type WatchGroup, type WeekFigures, siteLink, weeklyDigest } from "./digests";
import { allowed, planFor, type Plan } from "./entitlements";
import { fitDigestBlock, weekNotices } from "./fit_mail";
import { type RecordsWait, missingTable } from "./records_deliveries";
import { randomHex } from "./secrets";
import { readEvents } from "./watch_events";
import { groupsFor } from "./watch_mail";
import { followAliases, listWatches } from "./watches";

// Accounts the run reads, and messages it sends, in one run; the next hour
// (or the next data date of the week) goes on with the rest.
export const WEEKLY_ACCOUNTS_MAX = 1000;
export const WEEKLY_RUN_MAX = 100;
// The longest mailing address the footer prints.
export const MAIL_ADDRESS_MAX = 200;

// Where the email was turned on, kept with the time as the record of the choice.
export type WeeklyVia = "sign_in" | "account";

// -- the address ----------------------------------------------------------------------------------

// The sender's mailing address as the footer prints it: MAIL_ADDRESS on one
// line, spaces collapsed, no closing period (the sentence adds its own), at
// most MAIL_ADDRESS_MAX characters; null when unset or blank. Kept out of the
// repository: a Worker secret, set by the operator.
export function mailAddress(env: Pick<Env, "MAIL_ADDRESS">): string | null {
  const one = (env.MAIL_ADDRESS ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[\s.]+$/, "");
  return one ? one.slice(0, MAIL_ADDRESS_MAX) : null;
}

// -- the choice -------------------------------------------------------------------------------------

// Whether the table is on the database, for the pages that offer the email:
// a missing table, or any fault reading it, leaves the box and the control
// out. The same statement whatever the address, so the sign-in page answers
// an address with an account and one without alike.
export async function weeklyReady(env: Env): Promise<boolean> {
  try {
    await env.ACCOUNTS!.prepare("SELECT 1 AS x FROM weekly_mail LIMIT 1").first();
    return true;
  } catch {
    return false;
  }
}

// Turns the email on for an account: writes the row, or turns an off row
// back on, with where and when (the record of the choice, kept while the row
// is). true when something changed, false when it was on already, null
// before the table exists.
export function turnWeeklyOn(env: Env, userId: string, via: WeeklyVia, now = new Date()): Promise<boolean | null> {
  return changed(() => env.ACCOUNTS!.prepare(
    "INSERT INTO weekly_mail (user_id, mail, via, on_at, created_at) VALUES (?1, 'on', ?2, ?3, ?3) " +
    "ON CONFLICT (user_id) DO UPDATE SET mail = 'on', via = excluded.via, on_at = excluded.on_at, off_at = NULL WHERE weekly_mail.mail = 'off'",
  ).bind(userId, via, now.toISOString()).run());
}

// Turns it off (the account page or the unsubscribe link): the row stays,
// off, with when. The same answers.
export function turnWeeklyOff(env: Env, userId: string, now = new Date()): Promise<boolean | null> {
  return changed(() => env.ACCOUNTS!.prepare("UPDATE weekly_mail SET mail = 'off', off_at = ?2 WHERE user_id = ?1 AND mail = 'on'")
    .bind(userId, now.toISOString()).run());
}

async function changed(write: () => Promise<D1Result>): Promise<boolean | null> {
  try {
    return ((await write()).meta?.changes ?? 0) === 1;
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// Whether the account's email is on, for the account page; null before the table exists.
export async function weeklyState(env: Env, userId: string): Promise<{ on: boolean } | null> {
  try {
    const row = await env.ACCOUNTS!.prepare("SELECT mail FROM weekly_mail WHERE user_id = ?").bind(userId).first<{ mail: string }>();
    return { on: row?.mail === "on" };
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// What deleting an account removes (routes.tsx deleteAccount): the row. A
// database without the table holds none, so a missing table is no fault.
export async function deleteWeeklyOf(env: Env, userId: string): Promise<void> {
  try {
    await env.ACCOUNTS!.prepare("DELETE FROM weekly_mail WHERE user_id = ?").bind(userId).run();
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

// The unsubscribe link's row, /account/stop?e=<user id>&t=<secret>: the
// account's row while the account stands; null for a missing table, as for
// a link that matches nothing.
export type WeeklyStopRow = { user_id: string; mail: string; secret: string | null };

export async function weeklyStopRow(env: Env, userId: string): Promise<WeeklyStopRow | null> {
  try {
    return await env.ACCOUNTS!.prepare(
      "SELECT m.user_id, m.mail, m.secret FROM weekly_mail m JOIN users u ON u.id = m.user_id WHERE m.user_id = ? AND u.status = 'active'",
    ).bind(userId).first<WeeklyStopRow>();
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
}

// -- the site's week --------------------------------------------------------------------------------

// The award notices new to the records in the span (?1 the day before it,
// ?2 the data date), through rec_events_day (day, kind): an award notice is
// one row whatever subjects it names, and a count row (more) stands for rows
// a subject lost past its daily cap, which are still rows of their own.
export const WEEK_AWARDS_SQL =
  "SELECT COUNT(*) AS n FROM rec_events WHERE day > ?1 AND day <= ?2 AND kind = 'award' AND src = 1 AND more IS NULL LIMIT 1";

export type WeekRead = { state: "ready"; figures: WeekFigures } | { state: RecordsWait };

// The four figures, each null when its file does not read: the new tender
// notices of the span's days (tenders/new/<day>.json, each notice once, as
// /tenders/new lists them), the open notices closing within CLOSING_SOON_DAYS
// at the run's time (stats.json, as the rail counts them), the award notices
// new to the records (the records database, which must be at the data
// date: the watches read it too, so the run waits for it), and the contracts
// in the radar's 3-month window (expiring/index.json).
export async function readWeek(env: Env, o: { files: Files; stats: Stats; dataDate: string; now: Date }): Promise<WeekRead> {
  const start = addDays(o.dataDate, -WEEK_DAYS);
  const read = await readRecords(env, [{ sql: WEEK_AWARDS_SQL, params: [start, o.dataDate] }]);
  if (read.state !== "ready") return { state: read.state };
  if (read.asOf !== o.dataDate) return { state: "stale" };
  let notices: number | null = null;
  try {
    const seen = new Set<string>();
    for (let day = addDays(start, 1); day <= o.dataDate; day = addDays(day, 1)) for (const r of await o.files.newDay(day)) seen.add(r.reference);
    notices = seen.size;
  } catch {
    notices = null;
  }
  const index = await loadExpiringIndex(env).catch(() => null);
  return {
    state: "ready",
    figures: {
      notices, closing: closingSoonTotal(o.stats, clockAt(o.now.getTime())) ?? null, awards: num(read.rows[0]?.[0]?.n),
      ending: index?.windows.find((w) => w.window === `${WEEKLY_ENDING_MONTHS}m`)?.n ?? null,
    },
  };
}

// -- the run --------------------------------------------------------------------------------------

export type WeeklyWait = RecordsWait | "no_address" | "no_figures";

export interface WeeklyReport {
  sent: number;
  failed: number;
  // Accounts due and left for a later run, and why; records is null when none waited.
  waiting: number;
  records: WeeklyWait | null;
}

export const emptyWeeklyReport = (): WeeklyReport => ({ sent: 0, failed: 0, waiting: 0, records: null });

// The accounts due this week, oldest choice first (?1 the week's opening day
// on or before the data date, ?2 the cap): the email on, an active account
// that is not blocked, not covered since ?1, no message refused for it since
// ?1, and turned on before ?1 (the first message goes on the first opening
// day after the choice).
export const WEEKLY_DUE_SQL =
  "SELECT m.user_id, m.secret, m.last_week, m.last_at, u.email, u.lang, u.plan, u.plan_until FROM weekly_mail m JOIN users u ON u.id = m.user_id " +
  "WHERE m.mail = 'on' AND u.status = 'active' AND (m.last_week IS NULL OR m.last_week < ?1) AND (m.failed_week IS NULL OR m.failed_week < ?1) " +
  "AND m.on_at < ?1 AND NOT EXISTS (SELECT 1 FROM account_blocks b WHERE b.user_id = m.user_id) ORDER BY m.on_at, m.user_id LIMIT ?2";

type DueRow = {
  user_id: string; secret: string | null; last_week: string | null; last_at: string | null; email: string; lang: string; plan: string;
  plan_until: string | null;
};

// The account taken for the week by this run: one statement that holds only
// while the email is on, the account active and no run has covered the week.
async function claim(env: Env, userId: string, week: string, now: Date): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE weekly_mail SET last_week = ?1, last_at = ?2 WHERE user_id = ?3 AND mail = 'on' AND (last_week IS NULL OR last_week < ?1) " +
    "AND EXISTS (SELECT 1 FROM users u WHERE u.id = ?3 AND u.status = 'active')",
  ).bind(week, now.toISOString(), userId).run();
  return (res.meta?.changes ?? 0) === 1;
}

// The claim given back, while it is this run's: the account is due again.
async function release(env: Env, a: DueRow, week: string, now: Date): Promise<void> {
  await env.ACCOUNTS!.prepare("UPDATE weekly_mail SET last_week = ?1, last_at = ?2 WHERE user_id = ?3 AND last_week = ?4 AND last_at = ?5")
    .bind(a.last_week, a.last_at, a.user_id, week, now.toISOString()).run();
}

// A refusal that is not a sending limit: the claim given back and the week
// marked, so the account waits for next week.
async function refused(env: Env, a: DueRow, week: string, now: Date): Promise<void> {
  await env.ACCOUNTS!.prepare(
    "UPDATE weekly_mail SET last_week = ?1, last_status = 'failed', failed_week = ?4 WHERE user_id = ?3 AND last_week = ?4 AND last_at = ?2",
  ).bind(a.last_week, now.toISOString(), a.user_id, week).run();
}

// The unsubscribe link's secret, made with the account's first message.
async function stopSecret(env: Env, userId: string): Promise<string | null> {
  const db = env.ACCOUNTS!;
  const [, read] = await db.batch([
    db.prepare("UPDATE weekly_mail SET secret = ? WHERE user_id = ? AND secret IS NULL").bind(randomHex(16), userId),
    db.prepare("SELECT secret FROM weekly_mail WHERE user_id = ?").bind(userId),
  ]);
  return (read.results?.[0] as { secret?: string } | undefined)?.secret ?? null;
}

// The seven data dates a message covers: the week ending with the data date.
export const weekDays = (dataDate: string): string[] => Array.from({ length: WEEK_DAYS }, (_, i) => addDays(dataDate, -i));

// room: the messages the run may still send (the cap less what the earlier
// parts sent or tried). stop: why the run stopped early. report is null when
// the table is not on the database: the feature is not there, and the run
// says nothing of it.
export async function runWeekly(
  env: Env,
  o: { site: string; dataDate: string; now: Date; plans: Map<string, Plan>; room: number; capText: string; files: Files; stats: Stats },
): Promise<{ report: WeeklyReport | null; stop: string | null; capped: boolean }> {
  const { site, dataDate, now } = o;
  const week = weekAnchor(dataDate);
  let due: DueRow[];
  try {
    due = (await env.ACCOUNTS!.prepare(WEEKLY_DUE_SQL).bind(week, WEEKLY_ACCOUNTS_MAX).all<DueRow>()).results ?? [];
  } catch (e) {
    if (missingTable(e)) return { report: null, stop: null, capped: false };
    throw e;
  }
  const report = emptyWeeklyReport();
  if (!due.length) return { report, stop: null, capped: false };
  const wait = (why: WeeklyWait, n: number) => {
    report.records = why;
    report.waiting += n;
  };
  const address = mailAddress(env);
  if (!address) {
    wait("no_address", due.length);
    return { report, stop: null, capped: false };
  }
  const read = await readWeek(env, { files: o.files, stats: o.stats, dataDate, now });
  if (read.state !== "ready") {
    wait(read.state, due.length);
    return { report, stop: null, capped: false };
  }
  const figures = read.figures;
  const room = Math.min(o.room, WEEKLY_RUN_MAX);
  const days = weekDays(dataDate);
  // The open notices of the week, read once for every account that names its organization (fit_mail.ts).
  const notices = weekNotices(env, dataDate, now);
  let stop: string | null = null;
  let capped = false;
  let held: DueRow | null = null;
  try {
    for (const [i, a] of due.entries()) {
      let plan = o.plans.get(a.user_id);
      if (!plan) {
        plan = (await planFor(env, { id: a.user_id, plan: a.plan, plan_until: a.plan_until }, now)).plan;
        o.plans.set(a.user_id, plan);
      }
      const lang: Lang = a.lang === "fr" ? "fr" : "en";
      // The account's watches, on the ids the nightly's merges left, each read over the whole week.
      const watches = (await followAliases(env, a.user_id, await listWatches(env, a.user_id))).watches;
      let groups: WatchGroup[] = [];
      let total = 0;
      if (watches.length) {
        const events = await readEvents(env, watches, days);
        if (events.state !== "ready" || events.asOf !== dataDate) {
          wait(events.state === "ready" ? "stale" : events.state, due.length - i);
          break;
        }
        const span = new Set(days);
        ({ groups, total } = groupsFor(lang, watches, events, new Map(watches.map((w) => [w.id, span]))));
      }
      // The week's matching notices for an account that names its organization, on any plan at its own
      // figure; null leaves them out, and never fails the message.
      const matches = await fitDigestBlock(env, { userId: a.user_id, lang, site, dataDate, plan, now, notices });
      // Nothing from the watches, no figure and no match to show: nothing to send, so the account waits.
      if (!total && !matches && Object.values(figures).every((v) => v === null)) {
        wait("no_figures", 1);
        continue;
      }
      if (report.sent + report.failed >= room) {
        stop = room < o.room ? `the weekly email's cap of ${WEEKLY_RUN_MAX} messages` : o.capText;
        capped = true;
        break;
      }
      if (!(await claim(env, a.user_id, week, now))) continue;
      held = a;
      const secret = a.secret ?? (await stopSecret(env, a.user_id));
      if (!secret) {
        await release(env, a, week, now);
        held = null;
        continue;
      }
      const message = weeklyDigest({
        lang, to: a.email, site, dataDate, address, stopUrl: siteLink(site, `/account/stop?e=${a.user_id}&t=${secret}`, lang),
        watches: { groups, total, watched: watches.length }, figures, pro: allowed({ plan }, "watch_mail"), matches,
      });
      const result = await sendWithHeaders(env, site, message);
      if (result.sent) {
        held = null;
        await env.ACCOUNTS!.prepare("UPDATE weekly_mail SET last_status = 'sent' WHERE user_id = ?").bind(a.user_id).run();
        report.sent++;
      } else if (result.code && STOP_CODES.has(result.code)) {
        await release(env, a, week, now);
        held = null;
        stop = result.code;
        break;
      } else {
        await refused(env, a, week, now);
        held = null;
        report.failed++;
      }
    }
  } catch (e) {
    if (held) await release(env, held, week, now).catch(() => undefined);
    throw e;
  }
  return { report, stop, capped };
}

export const WEEKLY_WAIT_WHY: Record<WeeklyWait, string> = {
  absent: "the records database is not bound",
  loading: "the records database is loading",
  failed: "the records database could not be read",
  stale: "the records database is not at today's data date",
  no_address: "MAIL_ADDRESS is not set, so no weekly email can carry the mailing address",
  no_figures: "neither the watches nor the site's files gave anything to send",
};

export const weeklyActive = (r: WeeklyReport) => r.sent + r.failed + r.waiting > 0 || r.records !== null;

export const weeklyCounts = (r: WeeklyReport) =>
  `weekly email: ${r.sent} sent, ${r.failed} failed` + (r.records ? `, ${r.waiting} waiting: ${WEEKLY_WAIT_WHY[r.records]}` : "");
