// The watch mail: the delivery job's last part (deliveries.ts runDeliveries
// calls runWatchMail after the saved searches, inside the same run and the
// same cap of RUN_MESSAGES_MAX messages). docs/accounts.md, Watches.
//
// For each account whose watch mail is on, whose plan allows watch_mail
// (planFor, so a lapsed or revoked plan stops at once), that is not blocked,
// and not covered for today's data date yet: its watches, moved to the
// surviving id of any organization or buyer the nightly merged
// (followAliases); the ones due (daily: not covered for this data date;
// weekly: never, or seven or more days ago), each with its own days (since
// the data date it was last covered, at most SPAN_DAYS_MAX back). One message
// lists their events, grouped by watch in the order single records,
// organizations, buyers, notices; an event reached through two watches is
// listed once, under the first, which names the others; the kinds each
// follows only; ROWS_MAX rows in all. The account's first message of the
// week also carries the week's matching notices for the organization it
// claims (fit_mail.ts), unless its weekly email takes them. Nothing new
// writes "empty" and sends nothing. The account is claimed for the data date
// before its message goes and given back when the send does not go, as a
// saved search is. A refusal that is not a sending limit marks the data date
// failed, and the account waits for the next one. Each run of an account is
// a watch_deliveries row.
//
// Until the records database is ready at today's data date (no binding, a
// load under way, a statement that failed, tonight's sync not finished), the
// accounts wait unclaimed and the next hour reads it again. Then the run
// ends the watches of tender notices that closed: one whose closing event was
// covered by its account's message, or found seven or more days ago (shown
// on the watches page for a week), is deleted.
//
// Log lines name counts and dates only, never an address or a label.

import { addDays } from "../../public/closing.js";
import { clockAt } from "../closing";
import type { Env } from "../env";
import { segmentShort, type Lang } from "../i18n";
import { weekAnchor } from "./briefings";
import { ROWS_MAX, STOP_CODES, isDue, sendWithHeaders, spanStart } from "./deliveries";
import { type DigestMatches, type WatchGroup, siteLink, watchDigest } from "./digests";
import { fitDigestBlock, weekNotices, weeklyTakesMatches } from "./fit_mail";
import { orgWeekOpening } from "./org_claim";
import { allowed, planFor, type Plan } from "./entitlements";
import { type RecordsWait, missingTable } from "./records_deliveries";
import { randomHex } from "./secrets";
import { DAY_SLOTS, type EventRow, TARGET_SLOTS, closedOn, eventIdentity, foundKey, listed, readEvents, watchPath } from "./watch_events";
import { WATCH_DELIVERY_DAYS, type Watch, followAliases, listWatches } from "./watches";

// Accounts read in one run; the next hour reads the rest (each one covered
// for the data date leaves the list).
export const WATCH_ACCOUNTS_MAX = 1000;
// Tender notices' watches the run checks for a closing, oldest first: every
// notice closes, so the oldest leave and the list moves on.
export const TENDER_SWEEP_MAX = 250;
// How long a closed notice's watch stays when no message covered its closing.
export const CLOSED_GRACE_DAYS = 7;
// The order a message lists its watches in: single records, organizations, buyers, notices.
export const GROUP_ORDER = ["contract", "organization", "buyer", "tender"] as const;

export type WatchWait = RecordsWait | "no_table";

export interface WatchReport {
  sent: number;
  failed: number;
  empty: number;
  // Accounts with watches whose plan does not allow the mail.
  skipped: number;
  // Accounts left for a later run, and why; records is null when none waited.
  waiting: number;
  records: WatchWait | null;
  // Tender notices' watches ended because the notice closed.
  expired: number;
}

export const emptyWatchReport = (): WatchReport => ({ sent: 0, failed: 0, empty: 0, skipped: 0, waiting: 0, records: null, expired: 0 });

// The accounts that can be due on the data date, oldest first.
export const WATCH_DUE_SQL =
  "SELECT m.user_id, m.secret, m.last_day, m.last_at, u.email, u.lang, u.plan, u.plan_until FROM watch_mail m JOIN users u ON u.id = m.user_id " +
  "WHERE u.status = 'active' AND m.mail = 'on' AND (m.last_day IS NULL OR m.last_day < ?1) AND (m.failed_day IS NULL OR m.failed_day < ?1) " +
  "AND EXISTS (SELECT 1 FROM watches w WHERE w.user_id = m.user_id) AND NOT EXISTS (SELECT 1 FROM account_blocks b WHERE b.user_id = m.user_id) " +
  "ORDER BY m.created_at, m.user_id LIMIT ?2";

export const TENDER_WATCHES_SQL =
  "SELECT id, user_id, target, last_sent_day FROM watches WHERE kind = 'tender' ORDER BY created_at, id LIMIT ?";

type DueRow = {
  user_id: string; secret: string | null; last_day: string | null; last_at: string | null; email: string; lang: string; plan: string;
  plan_until: string | null;
};

// The days a watch's events are read on: after the day its last coverage
// reached (spanStart), up to the data date.
export function watchDays(w: Pick<Watch, "cadence" | "last_sent_day">, dataDate: string): string[] {
  const out: string[] = [];
  for (let d = addDays(spanStart(w.cadence, w.last_sent_day, dataDate), 1); d <= dataDate; d = addDays(d, 1)) out.push(d);
  return out;
}

// A watch's name in a message or on the page: a narrowed buyer with its segment.
export const watchLabel = (lang: Lang, w: Pick<Watch, "label" | "segment">): string =>
  w.segment ? `${w.label} · ${w.segment} ${segmentShort(lang, w.segment)}` : w.label;

// The message's groups: each due watch's events on its own days, the kinds it
// follows, in GROUP_ORDER; an event already listed under an earlier watch is
// left out of a later one and named on the first; ROWS_MAX rows in all.
export function groupsFor(
  lang: Lang, due: readonly Watch[], read: Extract<Awaited<ReturnType<typeof readEvents>>, { state: "ready" }>,
  spans: ReadonlyMap<string, ReadonlySet<string>>,
): { groups: WatchGroup[]; total: number } {
  const seen = new Map<string, EventRow>();
  const ordered = [...due].sort((a, b) => GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind));
  const groups: WatchGroup[] = [];
  let total = 0;
  let shown = 0;
  for (const w of ordered) {
    const label = watchLabel(lang, w);
    const events = listed(read.found.get(foundKey(w)), w.events, w.kind, spans.get(w.id)!).map((e) => {
      const rows: EventRow[] = [];
      let n = e.n;
      for (const r of e.rows) {
        const first = seen.get(eventIdentity(r));
        if (first) {
          first.also = [...(first.also ?? []), label];
          n--;
        } else {
          seen.set(eventIdentity(r), r);
          rows.push(r);
        }
      }
      return { ...e, n, rows };
    }).filter((e) => e.n > 0);
    const n = events.reduce((sum, e) => sum + e.n, 0);
    if (!n) continue;
    total += n;
    groups.push({
      kind: w.kind, label, path: watchPath(w.kind, w.target),
      events: events.map((e) => {
        const take = Math.max(0, Math.min(e.rows.length, ROWS_MAX - shown));
        shown += take;
        return { ...e, rows: e.rows.slice(0, take) };
      }),
    });
  }
  return { groups, total };
}

// -- writing what happened ----------------------------------------------------------------------

async function claim(env: Env, userId: string, dataDate: string, now: Date): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE watch_mail SET last_day = ?1, last_at = ?2 WHERE user_id = ?3 AND (last_day IS NULL OR last_day < ?1)",
  ).bind(dataDate, now.toISOString(), userId).run();
  return (res.meta?.changes ?? 0) === 1;
}

// The claim given back, while it is this run's: the account is due again.
async function release(env: Env, a: DueRow, dataDate: string, now: Date): Promise<void> {
  await env.ACCOUNTS!.prepare("UPDATE watch_mail SET last_day = ?1, last_at = ?2 WHERE user_id = ?3 AND last_day = ?4 AND last_at = ?5")
    .bind(a.last_day, a.last_at, a.user_id, dataDate, now.toISOString()).run();
}

const runRow = (env: Env, userId: string, now: Date, dataDate: string, items: number, status: string) =>
  env.ACCOUNTS!.prepare("INSERT INTO watch_deliveries (user_id, sent_at, day, items, status) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, now.toISOString(), dataDate, items, status);

// A run sent or with nothing new: the account's row, its run, each due watch
// covered to the data date, and the watches of notices whose closing it covered.
async function covered(
  env: Env, userId: string, status: "sent" | "empty", items: number, now: Date, dataDate: string, due: readonly Watch[],
  closed: readonly string[],
): Promise<void> {
  const db = env.ACCOUNTS!;
  await db.batch([
    db.prepare("UPDATE watch_mail SET last_status = ?, last_items = ?, last_at = ?, last_day = ? WHERE user_id = ?")
      .bind(status, items, now.toISOString(), dataDate, userId),
    runRow(env, userId, now, dataDate, items, status),
    ...due.map((w) => db.prepare("UPDATE watches SET last_sent_day = ? WHERE id = ? AND user_id = ?").bind(dataDate, w.id, userId)),
    ...closed.map((id) => db.prepare("DELETE FROM watches WHERE id = ? AND user_id = ? AND kind = 'tender'").bind(id, userId)),
  ]);
}

async function failed(env: Env, userId: string, items: number, now: Date, dataDate: string): Promise<void> {
  const db = env.ACCOUNTS!;
  await db.batch([
    db.prepare("UPDATE watch_mail SET last_status = 'failed', last_items = ?, failed_day = ?, last_at = ? WHERE user_id = ?")
      .bind(items, dataDate, now.toISOString(), userId),
    runRow(env, userId, now, dataDate, items, "failed"),
  ]);
}

// The stop link's secret, made with the account's first message.
async function mailSecret(env: Env, userId: string): Promise<string | null> {
  const db = env.ACCOUNTS!;
  const [, read] = await db.batch([
    db.prepare("UPDATE watch_mail SET secret = ? WHERE user_id = ? AND secret IS NULL").bind(randomHex(16), userId),
    db.prepare("SELECT secret FROM watch_mail WHERE user_id = ?").bind(userId),
  ]);
  return (read.results?.[0] as { secret?: string } | undefined)?.secret ?? null;
}

// -- the run --------------------------------------------------------------------------------------

// room: the messages the run may still send (the cap less what the saved
// searches sent). stop: why the run stopped early (a sending limit's code, or
// the cap), for the caller's report and log line.
// The weekday (Date.getUTCDay) the organization block opens a daily account's message: Monday, the weekly briefing's day.
export const WEEK_OPENING_DAY = 1;

export async function runWatchMail(
  env: Env, o: { site: string; dataDate: string; now: Date; plans: Map<string, Plan>; room: number; capText: string },
): Promise<{ report: WatchReport; stop: string | null; capped: boolean }> {
  const { site, dataDate, now } = o;
  const report = emptyWatchReport();
  let accounts: DueRow[];
  try {
    accounts = (await env.ACCOUNTS!.prepare(WATCH_DUE_SQL).bind(dataDate, WATCH_ACCOUNTS_MAX).all<DueRow>()).results ?? [];
    await env.ACCOUNTS!.prepare("DELETE FROM watch_deliveries WHERE sent_at < ?")
      .bind(new Date(now.getTime() - WATCH_DELIVERY_DAYS * 86_400_000).toISOString()).run();
  } catch (e) {
    if (!missingTable(e)) throw e;
    report.records = "no_table";
    return { report, stop: null, capped: false };
  }
  let stop: string | null = null;
  let capped = false;
  let ready = true;
  let held: DueRow | null = null;
  // The open notices of the week, read once for the accounts whose message carries the matching notices.
  const notices = weekNotices(env, dataDate, now);
  const week = weekAnchor(dataDate);
  try {
    for (const a of accounts) {
      let plan = o.plans.get(a.user_id);
      if (!plan) {
        plan = (await planFor(env, { id: a.user_id, plan: a.plan, plan_until: a.plan_until }, now)).plan;
        o.plans.set(a.user_id, plan);
      }
      if (!allowed({ plan }, "watch_mail")) {
        report.skipped++;
        continue;
      }
      const all = (await followAliases(env, a.user_id, await listWatches(env, a.user_id))).watches;
      const due = all.filter((w) => isDue(w.cadence, w.last_sent_day, dataDate));
      if (!due.length) continue;
      const spans = new Map(due.map((w) => [w.id, new Set(watchDays(w, dataDate))]));
      const days = [...new Set(due.flatMap((w) => [...spans.get(w.id)!]))].sort().reverse().slice(0, DAY_SLOTS);
      const read = await readEvents(env, due, days);
      if (read.state !== "ready" || read.asOf !== dataDate) {
        report.records = read.state === "ready" ? "stale" : read.state;
        report.waiting++;
        ready = false;
        break;
      }
      const lang = a.lang === "fr" ? "fr" : "en";
      // The "Your organization" block (org_claim.ts) opens the account's weekly
      // message: the day a weekly watch of its is due, or Monday (the
      // briefing's day) for an account whose watches are all daily. A fault
      // in reading it leaves the message without the block.
      const weekly = due.some((w) => w.cadence === "weekly") || new Date(`${dataDate}T00:00:00Z`).getUTCDay() === WEEK_OPENING_DAY;
      const opening = weekly ? await orgWeekOpening(env, { userId: a.user_id, lang, site, dataDate }).catch(() => null) : null;
      // The week's matching notices (fit_mail.ts) go in the account's first message of the week (no data date
      // of this week covered yet), and only while its weekly email does not take them, so a Pro account is
      // never sent the same matches twice in a week. A fault in reading them leaves the message without them.
      let matches: DigestMatches | null = null;
      if (a.last_day === null || a.last_day < week) {
        matches = await weeklyTakesMatches(env, a.user_id, week)
          .then((taken) => (taken ? null : fitDigestBlock(env, { userId: a.user_id, lang, site, dataDate, plan, now, notices })))
          .catch(() => null);
      }
      const closed = due.filter((w) => {
        const shut = w.kind === "tender" ? closedOn(read.found.get(foundKey(w))) : null;
        return !!shut && spans.get(w.id)!.has(shut);
      }).map((w) => w.id);
      const { groups, total } = groupsFor(lang, due, read, spans);
      // A message with nothing from the watches still goes when a block has something to say (the blocks
      // alone, under the opening's subject).
      if (!total && !opening?.lines.length && !matches) {
        if (!(await claim(env, a.user_id, dataDate, now))) continue;
        held = a;
        await covered(env, a.user_id, "empty", 0, now, dataDate, due, closed);
        held = null;
        report.empty++;
        continue;
      }
      if (report.sent + report.failed >= o.room) {
        stop = o.capText;
        capped = true;
        break;
      }
      if (!(await claim(env, a.user_id, dataDate, now))) continue;
      held = a;
      const secret = a.secret ?? (await mailSecret(env, a.user_id));
      if (!secret) {
        await release(env, a, dataDate, now);
        held = null;
        continue;
      }
      const stopUrl = siteLink(site, `/account/stop?w=${a.user_id}&t=${secret}`, lang);
      // The send time is the clock each notice's time left is read at.
      const message = watchDigest({
        lang, to: a.email, site, dataDate, stopUrl, groups, total, watched: all.length, opening, matches, clock: clockAt(now.getTime()),
      });
      const result = await sendWithHeaders(env, site, message);
      if (result.sent) {
        held = null;
        await covered(env, a.user_id, "sent", total, now, dataDate, due, closed);
        report.sent++;
      } else if (result.code && STOP_CODES.has(result.code)) {
        await release(env, a, dataDate, now);
        held = null;
        stop = result.code;
        break;
      } else {
        await release(env, a, dataDate, now);
        held = null;
        await failed(env, a.user_id, total, now, dataDate);
        report.failed++;
      }
    }
    if (ready && !stop) report.expired = await endClosedNotices(env, dataDate);
  } catch (e) {
    if (held) await release(env, held, dataDate, now).catch(() => undefined);
    throw e;
  }
  return { report, stop, capped };
}

// The watches of tender notices that closed, oldest TENDER_SWEEP_MAX first:
// deleted when the closing (or cancellation) found on day C was covered by the
// account's message (last_sent_day on or after C), or C is CLOSED_GRACE_DAYS
// or more before the data date. Returns how many went.
export async function endClosedNotices(env: Env, dataDate: string): Promise<number> {
  const db = env.ACCOUNTS!;
  const rows = (await db.prepare(TENDER_WATCHES_SQL).bind(TENDER_SWEEP_MAX)
    .all<{ id: string; user_id: string; target: string; last_sent_day: string | null }>()).results ?? [];
  if (!rows.length) return 0;
  const days = Array.from({ length: DAY_SLOTS }, (_, i) => addDays(dataDate, -i));
  const targets = [...new Set(rows.map((r) => r.target))];
  const closedDay = new Map<string, string>();
  for (let i = 0; i < targets.length; i += TARGET_SLOTS) {
    const read = await readEvents(env, targets.slice(i, i + TARGET_SLOTS).map((target) => ({ kind: "tender" as const, target })), days);
    if (read.state !== "ready") return 0;
    for (const target of targets.slice(i, i + TARGET_SLOTS)) {
      const day = closedOn(read.found.get(foundKey({ kind: "tender", target })));
      if (day) closedDay.set(target, day);
    }
  }
  const grace = addDays(dataDate, -CLOSED_GRACE_DAYS);
  const gone = rows.filter((r) => {
    const day = closedDay.get(r.target);
    return !!day && ((r.last_sent_day !== null && r.last_sent_day >= day) || day <= grace);
  });
  if (!gone.length) return 0;
  const res = await db.batch(gone.map((r) => db.prepare("DELETE FROM watches WHERE id = ? AND user_id = ? AND kind = 'tender'").bind(r.id, r.user_id)));
  return res.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}

export const WATCH_WAIT_WHY: Record<WatchWait, string> = {
  absent: "the records database is not bound",
  loading: "the records database is loading",
  failed: "the records database could not be read",
  stale: "the records database is not at today's data date",
  no_table: "the accounts database has no watch_mail table (apply accounts_schema.sql)",
};
