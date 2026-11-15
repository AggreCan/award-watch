// Phase 2 of the accounts: saved searches delivered by email, run by the
// Worker's hourly cron from 15:00 to 20:00 UTC (wrangler.jsonc; index.tsx
// dispatches on the cron). The nightly run publishes the day's data at about
// 12:30 UTC; the first hour after it sends, and the later ones pick up a
// nightly that ran late, a run cut short, or the rest after a daily limit.
//
// Each run, in order, and nothing at all unless every step holds:
//   1. the accounts switch is on, the MAIL binding and MAIL_FROM are set, and
//      SITE_URL is an https address (the messages' links are the site's);
//   2. stats.json reads and its data date is today's UTC date, so the nightly
//      has published today's files;
//   3. each saved search with delivery daily or weekly (DELIVERABLE_KINDS
//      holds every kind), whose owner's plan allows delivery and covers it
//      (one of the first of the account's saved searches and briefings by
//      creation date, as many as the plan's figure; an account holds more only
//      after a move to a smaller plan), and that is due: not delivered for
//      this data date, and for weekly, never delivered or delivered seven or
//      more days ago; one that failed once for this data date waits for the
//      next one.
//
// A tender or radar search's items are the records since the previous
// delivery's data date, at most SPAN_DAYS_MAX days back (one day for a first
// daily delivery, seven for a first weekly one), read from the published
// files; for the radar, the contracts whose end date came inside the window
// and those first seen while they already ended inside it (expiringItems).
// An organization, buyer or segment search reads the records database
// instead (records_deliveries.ts): the sources and fiscal years whose count
// rose since the counts its previous delivery kept, plus, for a segment, the
// segment's new tender notices from the files. Until that database is ready
// at today's data date (no binding, a load under way, a failed statement, a
// sync that did not finish tonight), those searches wait, unclaimed, and the
// run's report and log line say why; the next hour reads it again.
//
// The list is read account by account (byAccount), and all of an account's
// due searches are read before any of them is sent. Nothing new writes an
// "empty" row and sends nothing. Up to GROUP_OVER searches with news go one
// message each, in the search's language; past it, all of them go in one
// message in the account's mail language (users.lang), a section a search,
// with a stop link a section and one for the whole message
// (group_stop.ts); it counts as one message against the cap, the day's
// ceiling and the run log, and each search keeps its own claim, row and
// mark. Each search's message goes through the accounts sender, and a
// "sent" or "failed" row is written; "sent" and
// "empty" move last_delivered_at to the run's time, "failed" leaves it, so
// the next delivery covers what this one missed. A search whose account's
// plan does not send it is marked for the data date with no row (passedOver),
// so it leaves the list. At most RUN_MESSAGES_MAX
// messages a run; a daily-limit or rate-limit refusal stops the run and the
// next hour goes on from there. A file or the database failing logs one line
// and ends the run; the next hour tries again. A second run in the same hour
// finds nothing due, and two runs at the same moment (a trigger fired twice)
// send each search once: a run claims a search for the data date before
// sending (claim), and gives it back when the send does not go (release).
// The claim holds only while the search's delivery is on, so a stop link
// clicked after the run read its list stops that run's message; the row after
// a send is written once more when it fails (afterSend). An organization or
// buyer the nightly merged is read at the surviving id (survivingEntity,
// survivingParams); the search's row keeps the id saved.
//
// The run is one invocation of the scheduled handler, and D1 holds an
// invocation to its queries: every query on the accounts and the records
// databases is counted (QueryCount), and past RUN_QUERY_BUDGET no part takes
// up another item; the run stops as the message cap stops it and the next
// hour goes on from the claims.
//
// Every run past the switch writes one row to delivery_runs when it ends,
// whatever the way (writeRunLog below): the data date it read, how it ended,
// the messages sent and refused across every part, what it left due, and why
// it stopped early in a few words that name no account and no address. The
// daily check reads the previous UTC day's rows (watchdog.ts). Rows go after
// RUN_LOG_DAYS, and deliveries rows after DELIVERY_ROW_DAYS (each run).
//
// The day's ceiling (env.ts mailCeiling, MAIL_DAILY_QUOTA less
// MAIL_DAILY_RESERVE): once the UTC day's sends, the earlier runs' from
// delivery_runs and this run's, reach it, the run stops as a sending limit's
// refusal stops it ("limited"), before a claim, and the rest waits for the
// next UTC day. The reserve is for the sign-in code, which goes through the
// same MAIL binding and is neither counted nor held here.
//
// After the saved searches, the same run sends the watch mail (watch_mail.ts):
// one message per account with watches, inside the same cap, and a sending
// limit met there stops the run the same way. A file that did not read stops
// the saved searches only, since the watches read the records database alone.
// Then the weekly briefings (briefings.ts runBriefings), the same way, the
// weekly email any account can turn on (weekly.ts runWeekly), and last the
// saved analytics views by email (view_mail.ts runViewMail), Ultra's, which
// reads and sends nothing while Ultra is not on sale.
//
// Log lines name counts and dates only, never an address or a label.

import { addDays } from "../../public/closing.js";
import { clockAt, closingPassed, type Clock } from "../closing";
import {
  type ExpiringRow, type ExpiringWindow, type ExpiringWindowIndex, type TenderRow, isExpiringWindow, loadExpiringNewPage, loadExpiringPage,
  loadExpiringWindow, loadNewTenders, loadStats, newRowPages,
} from "../data";
import { type Env, type MailCeiling, mailCeiling } from "../env";
import { pick, segmentShort, type Lang } from "../i18n";
import { WINDOW_DAYS, filterExpiring, readExpiringQuery } from "../pages/expiring";
import { interestFilter } from "../pages/interest";
import { filterTenders, readTenderQuery } from "../pages/tenders";
import { faultSummary } from "../search_db";
import {
  type Cadence, type DigestMessage, type GroupSection, GROUP_SECTION_ROWS, ROWS_MAX, expiringDigest, groupDigest, recordsDigest, siteLink, tenderDigest,
} from "./digests";
import { allowed, planFor, type Feature, type Plan } from "./entitlements";
import { groupStopPath } from "./group_stop";
import {
  type Entity, type Mark, type RecordsWait, type Rise, MARK_WRITE_SQL, entityOf, isRecordsKind, loadMark, markText, missingTable, readCounts,
  rises,
} from "./records_deliveries";
import { survivorOf } from "./watches";
import { BRIEFING_WAIT_WHY, type BriefingReport, briefingActive, briefingCounts, madeBefore, runBriefings, sharedCap } from "./briefings";
import { DELIVERABLE_KINDS, DELIVERY_ROW_DAYS } from "./searches";
import { randomHex } from "./secrets";
import { type MailMessage, senderFor } from "./sender";
import { accountsEnabled } from "./switch";
import { VIEW_WAIT_WHY, type ViewReport, runViewMail, viewActive, viewCounts } from "./view_mail";
import { WATCH_WAIT_WHY, type WatchReport, runWatchMail } from "./watch_mail";
import { WEEKLY_WAIT_WHY, type WeeklyReport, runWeekly, weeklyActive, weeklyCounts } from "./weekly";

// The hourly trigger in wrangler.jsonc; any other trigger is the daily check.
export const DELIVERY_CRON = "0 15-20 * * *";

export const RUN_MESSAGES_MAX = 300;
// Rows listed in one message; the rest are a line linking the page. Set with
// the messages (digests.ts), which hold the watch mail to it too.
export { ROWS_MAX };
// An account's saved searches with news in one run go one message each up to
// this many; past it, all of them go in one message (groupDigest), so an
// account at Ultra's 100 daily searches sends one message a day, not 100, of
// the day's Email Sending quota (docs/accounts.md, Phase 2: delivery).
export const GROUP_OVER = 5;
// The most queries a grouped message makes from its claims to its last write,
// whatever its size: the claims (one batch, each search its own statement and
// its own condition), the stop secrets it lacks (one batch), then the rows and
// marks after the send (one batch, tried once more on a fault), or the claims
// given back with the failed rows (one batch). Within CLAIM_QUERIES, which the
// run holds back before any claim, so a group is taken up whole or not at all.
// A group its claims leave at GROUP_OVER or fewer goes as each search's own
// message instead, the second and later each taken up as a message of its own.
export const GROUP_QUERIES = 4;
export { groupStopPath, groupTag } from "./group_stop";
export { DELIVERY_ROW_DAYS };
// The most days one delivery reaches back, whatever the gap since the last.
export const SPAN_DAYS_MAX = 7;
// A weekly search is due again this many days after its last delivery.
export const WEEK_DAYS = 7;
// The messages a run may still send once the parts named have run: the cap
// less every message they sent or tried, never below zero. The watch mail
// gets roomAfter(the saved searches), the briefings roomAfter(the saved
// searches, the watch mail), the weekly email roomAfter(all three) and the
// saved views roomAfter(all four), so the five parts share the one cap
// (test-mail/caps.test.ts holds the arithmetic).
export const roomAfter = (...parts: ({ sent: number; failed: number } | null | undefined)[]): number =>
  Math.max(0, RUN_MESSAGES_MAX - parts.reduce((n, p) => n + (p ? p.sent + p.failed : 0), 0));
// Refusals that mean the account's sending is spent for now: the run stops
// and the next hour goes on. Any other refusal fails that one message.
export const STOP_CODES: ReadonlySet<string> = new Set(["E_DAILY_LIMIT_EXCEEDED", "E_RATE_LIMIT_EXCEEDED"]);

// -- the run's queries ------------------------------------------------------------------------

// D1 holds each Worker invocation to a number of queries. Its limits page
// (https://developers.cloudflare.com/d1/platform/limits/, read 2026-11-14)
// gives the row "Queries per Worker invocation" as "1000 (Workers Paid) / 50
// (Free)", says a db.batch() call "counts as a single query against it, not
// one query per statement", and that 2,000 single queries in one invocation
// fail with "Too many API requests by single Worker invocation". The
// Workers limits page (https://developers.cloudflare.com/workers/platform/limits/)
// counts D1 calls as subrequests (10,000 an invocation on Workers Paid) and
// gives a cron of an hour or more 15 minutes of CPU: neither binds first. The
// site is on Workers Paid, and each hourly
// run is one invocation of the scheduled handler reading two databases (the
// accounts and the records), so the run counts its queries on both
// (QueryCount) and keeps under the figure:
export const D1_QUERIES_MAX = 1000;
// No part takes up another item (a saved search, an account's watch mail, a
// briefing, an account's weekly email, a view) once the run has made this
// many: it stops as the message cap stops it ("capped"), and the next hour
// goes on from the claims. What lies between it and D1's figure covers the
// reads of the item in hand (an account's watches moved after a merge, one
// statement each) and the writes a part ends with. Six runs a data date
// (DELIVERY_CRON) make 5,100 queries a day.
export const RUN_QUERY_BUDGET = 850;
// The most queries an item makes from its claim to its last write: the
// claim, the stop link's secret, the row after the send and its one retry,
// or the release and the failed row. An item is claimed only while this many
// remain under D1's figure, so a run never stops between a claim and the row
// that records it.
export const CLAIM_QUERIES = 8;
// The run log's row (writeRunLog), the run's last query, one batch: held back
// from every claim with CLAIM_QUERIES, so a run that claims at D1's figure
// still has the query to write it.
export const RUN_LOG_QUERIES = 1;
export const BUDGET_TEXT = `the budget of ${RUN_QUERY_BUDGET} database queries`;

class CountedStatement {
  constructor(readonly inner: D1PreparedStatement, private readonly count: QueryCount) {}
  bind(...values: unknown[]): CountedStatement {
    return new CountedStatement(this.inner.bind(...values), this.count);
  }
  first<T>(column?: string): Promise<T | null> {
    this.count.n++;
    return column === undefined ? this.inner.first<T>() : this.inner.first<T>(column);
  }
  run<T>(): Promise<D1Result<T>> {
    this.count.n++;
    return this.inner.run<T>();
  }
  all<T>(): Promise<D1Result<T>> {
    this.count.n++;
    return this.inner.all<T>();
  }
  raw<T>(options?: { columnNames?: false }): Promise<T[]> {
    this.count.n++;
    return this.inner.raw<T>(options);
  }
}

// The queries one run has made, on every binding passed through db().
export class QueryCount {
  n = 0;
  // Nothing more is taken up.
  get spent(): boolean {
    return this.n >= RUN_QUERY_BUDGET;
  }
  // Room under D1's figure for a claim, every write after it, and the run log's row.
  get claimable(): boolean {
    return this.n + CLAIM_QUERIES + RUN_LOG_QUERIES <= D1_QUERIES_MAX;
  }
  // The binding with each query counted: a statement's first, run, all or raw, and a batch as one.
  db(real: D1Database): D1Database {
    const inner = (s: D1PreparedStatement) => ((s as unknown) instanceof CountedStatement ? (s as unknown as CountedStatement).inner : s);
    return {
      prepare: (query: string) => new CountedStatement(real.prepare(query), this),
      batch: <T>(statements: D1PreparedStatement[]) => {
        this.n++;
        return real.batch<T>(statements.map(inner));
      },
      exec: (query: string) => {
        this.n++;
        return real.exec(query);
      },
    } as unknown as D1Database;
  }
}

// Why a part stops before its next item, or null: the budget spent (claiming:
// too little left for a claim and its writes). A part called without a count
// (a test of the part alone) never stops for it.
export function budgetStop(queries: QueryCount | undefined, claiming = false): string | null {
  if (!queries) return null;
  return (claiming ? !queries.claimable : queries.spent) ? BUDGET_TEXT : null;
}

// The writes after a message went (its row, its coverage, its mark): tried
// once more when they fail, so a passing fault does not leave the message
// unrecorded and the next delivery repeating it. A second fault ends the run
// as any fault does. The batches are transactions, so a failed one wrote
// nothing (https://developers.cloudflare.com/d1/worker-api/d1-database/,
// "Batched statements are SQL transactions").
export async function afterSend(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch {
    await write();
  }
}

// -- what a run leaves due, and the day's ceiling ------------------------------------------------

// What the run left due (RunReport.left), which each part adds to on every
// way out, a fault included: the items of its list from the one it stopped
// at, and those that waited. A best count: a row past the stop counts when
// its plan would send it (the plan read this run, else the cached plan, a
// hint), a part's list holds at most its own cap, and the parts a stop kept
// the run from are not read, so not counted.
export type Tally = { left: number };

export function unfinished<T>(rows: readonly T[], from: number, counts: (r: T) => boolean): number {
  let n = 0;
  for (let i = from; i < rows.length; i++) if (counts(rows[i])) n++;
  return n;
}

export const likelyServed = (plans: ReadonlyMap<string, Plan>, userId: string, cached: string, feature: Feature): boolean => {
  const plan = plans.get(userId);
  return plan ? allowed({ plan }, feature) : cached !== "free";
};

// The messages a part may still send under the day's ceiling, and its stop's
// words; absent when there is no ceiling. A part stops before the claim once
// it has sent room messages, as a sending limit's refusal stops it.
export type Ceiling = { room: number; text: string };

export const CEILING_TEXT_START = "the day's sending ceiling";
export const ceilingText = (c: MailCeiling): string =>
  `${CEILING_TEXT_START} of ${c.ceiling} messages (MAIL_DAILY_QUOTA ${c.quota} less MAIL_DAILY_RESERVE ${c.reserve})`;

// -- the run log ---------------------------------------------------------------------------------

export const RUN_LOG_DAYS = 90;
// The deliveries rows are kept DELIVERY_ROW_DAYS (searches.ts, which the
// privacy page reads too). Nothing reads an older one: the run asks for a
// failed row of the data date, the searches page and the console for each
// search's newest row and the account's last 20, and the console's overview
// for the last 7 days.

// The longest reason a row keeps.
export const RUN_DETAIL_MAX = 120;

export const RUN_LOG_SQL =
  "INSERT INTO delivery_runs (at, data_date, outcome, sent, failed, left_due, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)";
export const RUN_LOG_PRUNE_SQL = "DELETE FROM delivery_runs WHERE at < ?1";
// The UTC day's sends so far, as the earlier runs' rows hold them (?1 the
// day's start, ?2 the next day's), through idx_delivery_runs_at.
export const DAY_SENT_SQL = "SELECT COALESCE(SUM(sent), 0) AS n FROM delivery_runs WHERE at >= ?1 AND at < ?2";
// The deliveries rows sent before ?1, as the other delivery tables are pruned
// each run, but by the key: deliveries has no index on sent_at, and
// "sent_at < ?" would read the whole table every hour. Each row's id is
// higher than every row's before it and its sent_at is its run's time, so
// the rows below the first one sent at ?1 or later are the old ones (all of
// them when none is that recent). The statement reads them and that one row
// in the table's own order, and deletes by the key; a row out of that order
// (two runs at once) goes with the next run instead.
export const DELIVERIES_PRUNE_SQL =
  "DELETE FROM deliveries WHERE id < COALESCE((SELECT id FROM deliveries WHERE sent_at >= ?1 ORDER BY id LIMIT 1), " +
  "(SELECT MAX(id) + 1 FROM deliveries))";

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const partsSum = (r: RunReport, key: "sent" | "failed") =>
  r[key] + (r.watch?.[key] ?? 0) + (r.briefing?.[key] ?? 0) + (r.weekly?.[key] ?? 0) + (r.views?.[key] ?? 0);

// Why the run stopped early (its stop or its fault), else why items waited;
// fixed words, dates and counts, never an account or an address.
function runDetail(r: RunReport): string | null {
  const wait = r.records ? WAIT_WHY[r.records]
    : r.watch?.records ? WATCH_WAIT_WHY[r.watch.records]
    : r.briefing?.records ? BRIEFING_WAIT_WHY[r.briefing.records]
    : r.weekly?.records ? WEEKLY_WAIT_WHY[r.weekly.records]
    : r.views?.records ? VIEW_WAIT_WHY[r.views.records]
    : null;
  const why = r.why ?? (wait && r.left > 0 ? `waiting: ${wait}` : null);
  return why ? why.slice(0, RUN_DETAIL_MAX) : null;
}

// The run's row, with the run log's rows past RUN_LOG_DAYS removed in the
// same batch (one query, RUN_LOG_QUERIES). A row that cannot be written logs
// one line and changes nothing else: the run's report and its mail stand.
async function writeRunLog(env: Env, now: Date, r: RunReport): Promise<void> {
  const db = env.ACCOUNTS!;
  try {
    await db.batch([
      db.prepare(RUN_LOG_SQL).bind(now.toISOString(), r.dataDate, r.outcome, partsSum(r, "sent"), partsSum(r, "failed"), r.left, runDetail(r)),
      db.prepare(RUN_LOG_PRUNE_SQL).bind(daysBefore(now, RUN_LOG_DAYS)),
    ]);
  } catch (e) {
    log(missingTable(e)
      ? "the run log was not written: the accounts database has no delivery_runs table (apply accounts_schema.sql)"
      : `the run log was not written (${faultSummary(e)})`);
  }
}

// The console's bulk runs (announce.tsx runAnnouncement: the accounts-open and
// Ultra messages) go through the same MAIL binding, so they spend the same
// quota: each run that sent or tried a message writes a row of its own
// outcome to the run log, with no data date and nothing left due, and
// DAY_SENT_SQL counts its sends with the job's for the rest of the UTC day.
// The daily check reads these rows as the day's sends and nothing more
// (watchdog.ts): they are not runs of the job.
export const CONSOLE_OUTCOME = "console";

export async function writeConsoleRun(env: Env, now: Date, o: { sent: number; failed: number; detail: string }): Promise<void> {
  try {
    await env.ACCOUNTS!.prepare(RUN_LOG_SQL)
      .bind(now.toISOString(), null, CONSOLE_OUTCOME, o.sent, o.failed, 0, o.detail.slice(0, RUN_DETAIL_MAX)).run();
  } catch (e) {
    log(missingTable(e)
      ? "the console's run was not logged: the accounts database has no delivery_runs table (apply accounts_schema.sql)"
      : `the console's run was not logged (${faultSummary(e)})`);
  }
}

// The messages the day's ceiling still allows this run: the ceiling less the
// day's sends so far. null without the delivery_runs table, since the day's
// sends cannot be counted then: no ceiling, and one log line. The console's
// bulk runs read it too.
export async function dayRoom(env: Env, c: MailCeiling, now: Date): Promise<number | null> {
  try {
    const start = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const row = await env.ACCOUNTS!.prepare(DAY_SENT_SQL).bind(new Date(start).toISOString(), new Date(start + 86_400_000).toISOString())
      .first<{ n: number }>();
    return Math.max(0, c.ceiling - (row?.n ?? 0));
  } catch (e) {
    if (!missingTable(e)) throw e;
    log("the accounts database has no delivery_runs table, so the day's sends cannot be counted: no daily ceiling this run (apply accounts_schema.sql)");
    return null;
  }
}

const BASE = "https://deliveries.invalid";

export type RunOutcome = "off" | "no_mail" | "no_data" | "not_today" | "fault" | "limited" | "capped" | "done";

export interface RunReport {
  outcome: RunOutcome;
  dataDate: string | null;
  // Messages: a grouped message counts once here, as it does against the cap,
  // the day's ceiling and the run log; each search it carried has its own
  // deliveries row.
  sent: number;
  failed: number;
  // Of the messages sent, the grouped ones, and the searches they carried.
  groups: number;
  grouped: number;
  empty: number;
  // Due searches whose owner's plan does not allow delivery, or does not
  // cover them (past the plan's figure, after a move to a smaller plan).
  skipped: number;
  // Organization, buyer and segment searches left for a later run, and why
  // (records): the records database was not ready at today's data date, or
  // the accounts database lacks delivery_marks ("no_marks", the schema not
  // yet applied again); records is null when none waited.
  waiting: number;
  records: RecordsWait | "no_marks" | null;
  // The watch mail's part (watch_mail.ts); null when the run did not reach it.
  watch: WatchReport | null;
  // The weekly briefings' part (briefings.ts); absent or null when the run did not reach it.
  briefing?: BriefingReport | null;
  // The weekly email's part (weekly.ts); absent or null when the run did not
  // reach it or the accounts database has no weekly_mail table yet.
  weekly?: WeeklyReport | null;
  // The saved views' part (view_mail.ts); absent or null when the run did not
  // reach it or Ultra is not on sale.
  views?: ViewReport | null;
  // Items still due when the run ended (Tally): 0 when it finished.
  left: number;
  // Why it stopped early or never began (a stop, a fault, a missing setting,
  // the data date), or null; the run log's detail.
  why: string | null;
}

const emptyReport = (): RunReport => ({
  outcome: "done", dataDate: null, sent: 0, failed: 0, groups: 0, grouped: 0, empty: 0, skipped: 0, waiting: 0, records: null, watch: null, left: 0,
  why: null,
});

// A file or the database could not be read: the message is the run's one log line.
class Fault extends Error {}

const log = (line: string) => console.log(`[deliveries] ${line}`);

// -- what is due ----------------------------------------------------------------------

// Whether a search is due on a data date: daily once per data date; weekly
// when never delivered or last delivered seven or more days before it.
export function isDue(deliver: string, lastDelivered: string | null, dataDate: string): boolean {
  if (deliver !== "daily" && deliver !== "weekly") return false;
  if (!lastDelivered) return true;
  const prev = lastDelivered.slice(0, 10);
  if (prev >= dataDate) return false;
  return deliver === "daily" || prev <= addDays(dataDate, -WEEK_DAYS);
}

// The day the items start after (exclusive): the previous delivery's data
// date, at most SPAN_DAYS_MAX days back; for a first delivery, the day
// before (daily) or a week before (weekly).
export function spanStart(deliver: Cadence, lastDelivered: string | null, dataDate: string): string {
  const floor = addDays(dataDate, -SPAN_DAYS_MAX);
  if (!lastDelivered) return addDays(dataDate, deliver === "daily" ? -1 : -WEEK_DAYS);
  const prev = lastDelivered.slice(0, 10);
  return prev > floor ? prev : floor;
}

type DueRow = {
  id: string; user_id: string; kind: string; params: string; label: string; lang: string; deliver: string;
  last_delivered_at: string | null; email: string; plan: string; plan_until: string | null; secret: string | null;
  // The account's mail language (users.lang), a grouped message's language.
  user_lang: string;
  // How many of the account's saved searches and briefings were made before this one (the cap they share).
  n_before: number;
};

// The searches that can be due on the data date, the accounts whose cached
// plan is paid first, then oldest first; isDue then applies the weekly rule.
// The cached plan (users.plan, which holds Ultra as pro) orders the list and
// nothing more: a downgraded account's searches, read and passed over each
// run, then come after the ones paid for, and planFor at the send still
// decides every one (a stale cache only moves a search in the list). A search
// that failed once for this data date is left for the next one, so an address
// the mail service refuses is not tried every hour; that read and the
// searches page's newest delivery go through idx_deliveries_search. n_before
// counts the briefings too (briefings false: the searches alone, while the
// briefings table is not on the database yet). A function, called at the
// read, since madeBefore comes from briefings.ts, which imports this module.
export const candidatesSql = (briefings = true) =>
  "SELECT s.id, s.user_id, s.kind, s.params, s.label, s.lang, s.deliver, s.last_delivered_at, u.email, u.plan, u.plan_until, k.secret, u.lang AS user_lang, " +
  `${briefings ? `${madeBefore("s", "saved_searches")} + ${madeBefore("s", "briefings")}` : madeBefore("s", "saved_searches")} AS n_before ` +
  "FROM saved_searches s JOIN users u ON u.id = s.user_id LEFT JOIN delivery_tokens k ON k.search_id = s.id " +
  "WHERE u.status = 'active' AND s.deliver IN ('daily', 'weekly') " +
  `AND s.kind IN (${DELIVERABLE_KINDS.map(() => "?").join(", ")}) ` +
  "AND (s.last_delivered_at IS NULL OR substr(s.last_delivered_at, 1, 10) < ?) " +
  "AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.saved_search_id = s.id AND d.status = 'failed' AND d.sent_at >= ?) " +
  "ORDER BY u.plan = 'free', s.created_at, s.id";

async function candidates(env: Env, dataDate: string): Promise<DueRow[]> {
  const binds = [...DELIVERABLE_KINDS, dataDate, dataDate];
  const res = await env.ACCOUNTS!.prepare(candidatesSql()).bind(...binds).all<DueRow>()
    .catch((e) => {
      if (!missingTable(e)) throw e;
      return env.ACCOUNTS!.prepare(candidatesSql(false)).bind(...binds).all<DueRow>();
    });
  return res.results ?? [];
}

// The candidates account by account, so a run sees all of an account's
// searches with news before it sends any: each account where its first search
// stood in the list (paid accounts first, then oldest), its searches in their
// own order (created_at, id), which the list already has.
export function byAccount<T extends { user_id: string }>(rows: readonly T[]): T[] {
  const accounts = new Map<string, T[]>();
  for (const r of rows) {
    const mine = accounts.get(r.user_id);
    if (mine) mine.push(r);
    else accounts.set(r.user_id, [r]);
  }
  return [...accounts.values()].flat();
}

// -- the published files, each read once a run ------------------------------------------------

export function publishedFiles(env: Env) {
  const days = new Map<string, readonly TenderRow[]>();
  const indexes = new Map<ExpiringWindow, ExpiringWindowIndex>();
  const pages = new Map<string, readonly ExpiringRow[]>();
  const windowIndex = async (window: ExpiringWindow): Promise<ExpiringWindowIndex> => {
    let index = indexes.get(window);
    if (!index) {
      const loaded = await loadExpiringWindow(env, window);
      if (!loaded) throw new Fault(`expiring/${window}/index.json could not be read; the next hour tries again`);
      index = loaded;
      indexes.set(window, index);
    }
    return index;
  };
  const page = async (key: string, load: () => Promise<ExpiringRow[] | null>): Promise<readonly ExpiringRow[]> => {
    let rows = pages.get(key);
    if (!rows) {
      const loaded = await load();
      if (!loaded) throw new Fault(`expiring/${key}.json could not be read; the next hour tries again`);
      rows = loaded;
      pages.set(key, rows);
    }
    return rows;
  };
  return {
    // Every day of the last 30 has a file (an empty list on a day with no new
    // notice), so a day that does not read is a fault, not a quiet day.
    async newDay(day: string): Promise<readonly TenderRow[]> {
      let rows = days.get(day);
      if (!rows) {
        const loaded = await loadNewTenders(env, day);
        if (!loaded) throw new Fault(`tenders/new/${day}.json could not be read; the next hour tries again`);
        rows = loaded;
        days.set(day, rows);
      }
      return rows;
    },
    // A window's rows ending after `after`. The pages run soonest end first,
    // so they are read from the last, and reading stops at the first page
    // that reaches back to `after`: every page before it ends earlier still.
    async endingAfter(window: ExpiringWindow, after: string): Promise<ExpiringRow[]> {
      const index = await windowIndex(window);
      const out: ExpiringRow[] = [];
      for (let n = index.pages; n >= 1; n--) {
        const rows = await page(`${window}/${n}`, () => loadExpiringPage(env, window, n));
        let reachesBack = rows.length === 0;
        for (const r of rows) {
          if (r.end.slice(0, 10) > after) out.push(r);
          else reachesBack = true;
        }
        if (reachesBack) break;
      }
      return out;
    },
    // A window's rows whose contract the site first saw after `after`, from
    // its list of new rows (expiring/<window>/new/<n>.json). That list holds
    // the rows first seen in the SPAN_DAYS_MAX days to the data date, newest
    // day first, so it is read from its first page and reading stops at the
    // first page that reaches back to `after`: a delivery the day after the
    // previous one reads the pages holding the data date's rows and one more
    // at most. A window index without the list (written before it) gives none.
    async seenAfter(window: ExpiringWindow, after: string): Promise<ExpiringRow[]> {
      const index = await windowIndex(window);
      const count = newRowPages(index) ?? 0;
      const out: ExpiringRow[] = [];
      for (let n = 1; n <= count; n++) {
        const rows = await page(`${window}/new/${n}`, () => loadExpiringNewPage(env, window, n));
        let reachesBack = rows.length === 0;
        for (const r of rows) {
          if (r.seen! > after) out.push(r);
          else reachesBack = true;
        }
        if (reachesBack) break;
      }
      return out;
    },
  };
}

export type Files = ReturnType<typeof publishedFiles>;

// -- items by kind ----------------------------------------------------------------------------

// The new notices of each day after `start` up to the data date that match
// the saved filter, read the way /tenders reads its address: readTenderQuery
// and filterTenders are the one implementation of the filter, repeated keys
// (one per value, as the email lists chooser saves them) included. A notice that
// is no longer open (closed or cancelled on the data date, or its closing
// time passed since) is left out: the saved search is a list of open notices.
export async function tenderItems(files: Files, params: string, start: string, dataDate: string, clock: Clock): Promise<TenderRow[]> {
  const q = readTenderQuery(new URL(params, BASE));
  const seen = new Set<string>();
  const rows: TenderRow[] = [];
  for (let day = addDays(start, 1); day <= dataDate; day = addDays(day, 1)) {
    for (const r of await files.newDay(day)) {
      if (seen.has(r.reference)) continue;
      seen.add(r.reference);
      if (r.status !== undefined && r.status !== "open") continue;
      if (closingPassed(r.closing, clock)) continue;
      rows.push(r);
    }
  }
  return filterTenders(rows, q, clock);
}

const KIND_ORDER: Record<ExpiringRow["kind"], number> = { award: 0, history: 1, contract: 2 };

// The saved window's rows that entered it since `start`, with the filters
// the radar's form saved: each row inside the window at the data date (end
// from the data date to the window's length past it) that was outside it at
// `start` (end more than the window's length past that), or whose contract
// the site first saw after `start` and by the data date (a new award notice
// or history record, or a published contract: the window's list of new
// rows). A row that entered both ways is listed once. Newest end first.
export async function expiringItems(files: Files, window: ExpiringWindow, params: string, start: string, dataDate: string): Promise<ExpiringRow[]> {
  const q = readExpiringQuery(new URL(params, BASE));
  const days = WINDOW_DAYS[window];
  const outsideBefore = addDays(start, days);
  const insideNow = addDays(dataDate, days);
  const inside = (r: ExpiringRow) => {
    const end = r.end.slice(0, 10);
    return end <= insideNow && end >= dataDate;
  };
  const entered = new Map<string, ExpiringRow>();
  for (const r of await files.endingAfter(window, outsideBefore)) if (inside(r)) entered.set(`${r.kind}:${r.reference}`, r);
  for (const r of await files.seenAfter(window, start)) {
    const key = `${r.kind}:${r.reference}`;
    if (!entered.has(key) && r.seen! <= dataDate && inside(r)) entered.set(key, r);
  }
  return filterExpiring([...entered.values()], q).sort((a, b) => {
    const x = a.end.slice(0, 10);
    const y = b.end.slice(0, 10);
    if (x !== y) return x < y ? 1 : -1;
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    return a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0;
  });
}

// What an organization, buyer or segment search delivers this run: the
// counts that rose since its mark (none on a first delivery, or after the
// counting rules changed: the counts read become the mark), a segment's new
// tender notices since `start` (read as a tender search on /tenders?segment=
// reads them), and the counts to keep as the next mark. A wait when the
// records database is not ready at the data date, or the accounts database
// has no delivery_marks table; null for a search whose page no longer reads
// as one (it is passed over, as a kind the job cannot serve was).
export type RecordsItems = {
  entity: Entity; name: string; rises: Rise[]; since: string; tenders: TenderRow[]; mark: Mark;
  // An organization's or a buyer's name in each language, as the records database holds it (null when it
  // holds none): a grouped message in the other language writes the search's label with it.
  names: Record<Lang, string> | null;
};

export async function recordsItems(
  env: Env, files: Files, s: { id: string; kind: string; params: string }, lang: Lang, start: string, dataDate: string, clock: Clock,
): Promise<RecordsItems | { wait: RecordsWait | "no_marks" } | null> {
  const saved = entityOf(s.kind, s.params);
  if (!saved) return null;
  const entity = await survivingEntity(env, saved);
  const read = await readCounts(env, entity, dataDate);
  if (read.state !== "ready") return { wait: read.state };
  let prev: Mark | null;
  try {
    prev = await loadMark(env, s.id);
  } catch (e) {
    if (missingTable(e)) return { wait: "no_marks" };
    throw e;
  }
  // Counts read at another id do not compare: the first delivery after a
  // merge keeps the counts and reports nothing, as a first delivery does,
  // since the merge moved records into the surviving id that were never new.
  // A mark names the id only when it is not the saved one (a mark without it
  // was read at the saved id).
  const comparable = prev && (prev.at ?? saved.id) === entity.id ? prev : null;
  const mark: Mark = entity.id === saved.id ? read.mark : { ...read.mark, at: entity.id };
  const name = entity.kind === "segment"
    ? `${entity.id} ${segmentShort(lang, entity.id)}`
    : (read.name ? pick(lang, read.name.en, read.name.fr) : null) ?? entity.id;
  const tenders = entity.kind === "segment" ? await tenderItems(files, `/tenders?segment=${entity.id}`, start, dataDate, clock) : [];
  const held = entity.kind !== "segment" && read.name && (read.name.en || read.name.fr) ? read.name : null;
  const names = held ? { en: pick("en", held.en, held.fr)!, fr: pick("fr", held.en, held.fr)! } : null;
  return { entity, name, rises: rises(comparable, mark) ?? [], since: comparable?.asOf ?? dataDate, tenders, mark, names };
}

// -- merged organizations and buyers ---------------------------------------------------------

// The entity of an organization or buyer search at the id the nightly merged
// its saved id into (watches.ts survivorOf, as a watch and a saved view
// follow it), read at each delivery; the search's row and label keep the id
// saved. A segment, and an id that stands, read as saved.
export async function survivingEntity(env: Env, e: Entity): Promise<Entity> {
  if (e.kind === "segment") return e;
  const next = await survivorOf(env, e.kind, e.id);
  if (!next) return e;
  return entityOf(e.kind, e.kind === "organization" ? `/organizations/${next}` : `/buyers/${next}`) ?? e;
}

// A tender or radar search's filters on an organization or a buyer the
// nightly merged, moved to the surviving ids for this delivery's reading and
// its links; the stored page is not rewritten.
const MOVED_KEYS: readonly [string, "organization" | "buyer"][] = [["buyer", "buyer"], ["client", "buyer"], ["supplier", "organization"]];

export async function survivingParams(env: Env, params: string): Promise<string> {
  const url = new URL(params, BASE);
  let moved = false;
  for (const [key, kind] of MOVED_KEYS) {
    const id = (url.searchParams.get(key) ?? "").trim().toLowerCase();
    const next = id ? await survivorOf(env, kind, id) : null;
    if (!next) continue;
    url.searchParams.set(key, next);
    moved = true;
  }
  return moved ? `${url.pathname}${url.search}` : params;
}

// -- writing what happened -----------------------------------------------------------------

// The stop link's secret for a search, made on its first delivery; null when
// the search was deleted while the run was going.
async function stopSecret(env: Env, searchId: string, now: Date): Promise<string | null> {
  const db = env.ACCOUNTS!;
  const [, read] = await db.batch([
    db.prepare(
      "INSERT INTO delivery_tokens (search_id, secret, created_at) SELECT ?1, ?2, ?3 " +
      "WHERE EXISTS (SELECT 1 FROM saved_searches WHERE id = ?1) ON CONFLICT (search_id) DO NOTHING",
    ).bind(searchId, randomHex(16), now.toISOString()),
    db.prepare("SELECT secret FROM delivery_tokens WHERE search_id = ?").bind(searchId),
  ]);
  return (read.results?.[0] as { secret?: string } | undefined)?.secret ?? null;
}

// The stop secrets of a group's searches that have none yet, made in one
// batch, as stopSecret makes one; a search deleted while the run was going
// has none.
async function stopSecrets(env: Env, searchIds: readonly string[], now: Date): Promise<Map<string, string>> {
  if (!searchIds.length) return new Map();
  const db = env.ACCOUNTS!;
  const results = await db.batch([
    ...searchIds.map((id) => db.prepare(
      "INSERT INTO delivery_tokens (search_id, secret, created_at) SELECT ?1, ?2, ?3 " +
      "WHERE EXISTS (SELECT 1 FROM saved_searches WHERE id = ?1) ON CONFLICT (search_id) DO NOTHING",
    ).bind(id, randomHex(16), now.toISOString())),
    db.prepare("SELECT search_id, secret FROM delivery_tokens WHERE search_id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(searchIds)),
  ]);
  const rows = (results[results.length - 1]?.results ?? []) as { search_id: string; secret: string }[];
  return new Map(rows.map((r) => [r.search_id, r.secret]));
}

// One deliveries row, and for "sent" and "empty" the search's
// last_delivered_at and, for a records search, its new mark, in one batch.
// Written only while the search exists, so a search deleted during the run
// is passed over rather than failing it. A "failed" row keeps the old mark,
// so the next delivery reports what this one did not send.
function recordStatements(
  env: Env, searchId: string, status: "sent" | "failed" | "empty", items: number, now: Date, mark: Mark | null = null,
): D1PreparedStatement[] {
  const db = env.ACCOUNTS!;
  const at = now.toISOString();
  const statements = [
    db.prepare(
      "INSERT INTO deliveries (saved_search_id, sent_at, items, status) SELECT ?1, ?2, ?3, ?4 " +
      "WHERE EXISTS (SELECT 1 FROM saved_searches WHERE id = ?1)",
    ).bind(searchId, at, items, status),
  ];
  if (status !== "failed") {
    statements.push(db.prepare("UPDATE saved_searches SET last_delivered_at = ? WHERE id = ?").bind(at, searchId));
    if (mark) statements.push(db.prepare(MARK_WRITE_SQL).bind(searchId, mark.asOf, markText(mark), at));
  }
  return statements;
}

async function record(
  env: Env, searchId: string, status: "sent" | "failed" | "empty", items: number, now: Date, mark: Mark | null = null,
): Promise<void> {
  await env.ACCOUNTS!.batch(recordStatements(env, searchId, status, items, now, mark));
}

// A search taken for the data date by this run: last_delivered_at set to the
// run's time in one statement that holds only while its delivery is on and no
// run has delivered it for this data date, so of two runs at once exactly one
// goes on, and a stop link clicked after the run read its list stops it.
const CLAIM_SQL =
  "UPDATE saved_searches SET last_delivered_at = ? WHERE id = ? AND deliver IN ('daily', 'weekly') " +
  "AND (last_delivered_at IS NULL OR substr(last_delivered_at, 1, 10) < ?)";

async function claim(env: Env, searchId: string, dataDate: string, now: Date): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(CLAIM_SQL).bind(now.toISOString(), searchId, dataDate).run();
  return (res.meta?.changes ?? 0) === 1;
}

// A group's claims: each search its own statement, on the same conditions,
// in one batch (one query); whether each one holds, in order. A search
// stopped or delivered since the list was read drops out of the group.
async function claimAll(env: Env, searchIds: readonly string[], dataDate: string, now: Date): Promise<boolean[]> {
  const db = env.ACCOUNTS!;
  const results = await db.batch(searchIds.map((id) => db.prepare(CLAIM_SQL).bind(now.toISOString(), id, dataDate)));
  return results.map((r) => (r.meta?.changes ?? 0) === 1);
}

// A claim given back: last_delivered_at as it was before, if this run's claim
// still stands, so the next delivery covers what this one did not send.
const RELEASE_SQL = "UPDATE saved_searches SET last_delivered_at = ? WHERE id = ? AND last_delivered_at = ?";

async function release(env: Env, searchId: string, before: string | null, now: Date): Promise<void> {
  await env.ACCOUNTS!.prepare(RELEASE_SQL).bind(before, searchId, now.toISOString()).run();
}

// Every claim of a group given back together, and, when the mail service
// refused the message, each search's failed row with it: one batch.
async function releaseAll(
  env: Env, held: readonly { id: string; before: string | null }[], now: Date, failed: readonly { id: string; items: number }[] = [],
): Promise<void> {
  const db = env.ACCOUNTS!;
  await db.batch([
    ...held.map((h) => db.prepare(RELEASE_SQL).bind(h.before, h.id, now.toISOString())),
    ...failed.flatMap((f) => recordStatements(env, f.id, "failed", f.items, now)),
  ]);
}

// The searches read and passed over because their account's plan does not
// send them (no delivery, or past the plan's figure after a move to a smaller
// plan): covered for the data date as a claim would cover them, with no
// deliveries row, so they leave the run's list and are not read again every
// hour, as the watch mail, the briefings and the saved views pass theirs
// over. A plan restored that day sends from the next data date on (a weekly
// search, a week after). MARKS_BATCH statements a batch, each batch one
// query, and none once too little is left for a claim and the run log's row:
// the rest are read again the next hour.
export const MARKS_BATCH = 100;
export const PASSED_OVER_SQL =
  "UPDATE saved_searches SET last_delivered_at = ?1 WHERE id = ?2 AND deliver IN ('daily', 'weekly') " +
  "AND (last_delivered_at IS NULL OR substr(last_delivered_at, 1, 10) < ?3)";

async function passedOver(env: Env, ids: readonly string[], dataDate: string, now: Date, queries: QueryCount): Promise<void> {
  const db = env.ACCOUNTS!;
  for (let i = 0; i < ids.length; i += MARKS_BATCH) {
    if (!queries.claimable) return;
    await db.batch(ids.slice(i, i + MARKS_BATCH).map((id) => db.prepare(PASSED_OVER_SQL).bind(now.toISOString(), id, dataDate)));
  }
}

// -- sending ---------------------------------------------------------------------------------

// The accounts sender (sender.ts) adds its own headers and reports a refusal
// as "failed" without its code. This wraps the binding it is given, so the
// message leaves through that one path with the List-Unsubscribe pair added,
// and the binding's error code is kept for the stop rule.
function bindingWith(mail: SendEmail, headers: Record<string, string>, refused: { code: string | null }): SendEmail {
  return {
    async send(message: Parameters<SendEmail["send"]>[0]) {
      const m = message as { headers?: Record<string, string> };
      try {
        return await mail.send({ ...(message as object), headers: { ...m.headers, ...headers } } as Parameters<SendEmail["send"]>[0]);
      } catch (e) {
        const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
        refused.code = typeof code === "string" && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
        throw e;
      }
    },
  } as SendEmail;
}

// Also the accounts-open message's path (announce.tsx), whose requestUrl is
// the console's own, so a local run with MAIL_SENDER=log writes to the
// development outbox as the sign-in message does.
export async function sendWithHeaders(
  env: Env, requestUrl: string, message: MailMessage & { headers: Record<string, string> },
): Promise<{ sent: boolean; code: string | null }> {
  const refused = { code: null as string | null };
  const mail = env.MAIL ? bindingWith(env.MAIL, message.headers, refused) : undefined;
  const sender = senderFor({ ...env, MAIL: mail }, requestUrl);
  const result = await sender.send(message).catch(() => ({ sent: false }) as const);
  return { sent: result.sent, code: refused.code };
}

const send = (env: Env, site: string, message: DigestMessage) => sendWithHeaders(env, site, message);

// -- the run ---------------------------------------------------------------------------------

// The run's instant: NOW when the environment names one (the tests pin it, as
// they pin the pages' clock), else the time the trigger fired.
function nowOf(env: Env): Date {
  const fixed = env.NOW ? Date.parse(env.NOW) : Number.NaN;
  return new Date(Number.isFinite(fixed) ? fixed : Date.now());
}

const asLang = (v: string): Lang => (v === "fr" ? "fr" : "en");
const WINDOW_MONTHS: Record<ExpiringWindow, number> = { "3m": 3, "6m": 6, "12m": 12 };

// The site's address for the messages' links, or null when SITE_URL is not
// an https address: the stop link goes in List-Unsubscribe, which Email
// Sending accepts with https links only.
function siteOf(env: Env): string | null {
  const site = (env.SITE_URL ?? "").trim().replace(/\/+$/, "");
  try {
    return new URL(site).protocol === "https:" ? site : null;
  } catch {
    return null;
  }
}

// A search with news, read and not yet sent: what its own message or its
// section of a grouped one is built from.
type Ready = {
  s: DueRow; lang: Lang; cadence: Cadence; start: string;
  // Its page at the surviving ids (survivingParams), and a radar search's window.
  params: string; win: string | null;
  items: TenderRow[] | ExpiringRow[]; found: RecordsItems | null;
  // Records matched (for the records kinds, the records added plus the notices), and the records added.
  total: number; more: number; mark: Mark | null;
};

// A search's label in the grouped message's language: as saved when the
// search was saved from a page in that language, else written again in it by
// interestFilter, as the searches page writes it (an organization or a buyer
// by the name the records database holds), and as saved when it no longer
// writes.
async function labelFor(env: Env, lang: Lang, r: Ready): Promise<string> {
  if (r.s.lang === lang) return r.s.label;
  const known = r.found?.names ? { name: r.found.names[lang] } : {};
  const rebuilt = await interestFilter(env, lang, r.s.kind, r.s.params, known).catch(() => null);
  return rebuilt?.label ?? r.s.label;
}

// A search's section of a grouped message: its label, its page and its own
// stop link in the message's language, and its rows (digests.ts groupDigest
// lists GROUP_SECTION_ROWS of them at most).
async function groupSection(env: Env, site: string, lang: Lang, r: Ready, secret: string): Promise<GroupSection> {
  const base = { label: await labelFor(env, lang, r), params: r.params, stopUrl: siteLink(site, `/account/stop?s=${r.s.id}&t=${secret}`, lang) };
  if (r.found) {
    return {
      ...base, kind: r.found.entity.kind, rises: r.found.rises, more: r.more, tenders: r.found.tenders.slice(0, GROUP_SECTION_ROWS),
      tenderTotal: r.found.tenders.length,
    };
  }
  if (r.s.kind === "tenders") return { ...base, kind: "tenders", rows: (r.items as TenderRow[]).slice(0, GROUP_SECTION_ROWS), total: r.total };
  return {
    ...base, kind: "expiring", rows: (r.items as ExpiringRow[]).slice(0, GROUP_SECTION_ROWS), total: r.total, months: WINDOW_MONTHS[r.win as ExpiringWindow],
  };
}

// One run: the delivery itself (deliver), then its row in the run log,
// whatever way it ended. Nothing while the switch is off.
export async function runDeliveries(env: Env, now: Date = nowOf(env)): Promise<RunReport> {
  if (!accountsEnabled(env)) return { ...emptyReport(), outcome: "off" };
  const tally: Tally = { left: 0 };
  let report: RunReport;
  try {
    report = await deliver(env, now, tally);
  } catch (e) {
    // deliver ends every fault it expects; anything else still gets its row, then goes on as it would have.
    await writeRunLog(env, now, { ...emptyReport(), outcome: "fault", left: tally.left, why: "the run stopped on an error it did not expect" });
    throw e;
  }
  report.left = tally.left;
  await writeRunLog(env, now, report);
  return report;
}

async function deliver(env: Env, now: Date, tally: Tally): Promise<RunReport> {
  const report = emptyReport();
  const site = siteOf(env);
  if (!env.MAIL || !env.MAIL_FROM?.trim() || !site) {
    const missing = [!env.MAIL && "the MAIL binding", !env.MAIL_FROM?.trim() && "MAIL_FROM", !site && "an https SITE_URL"].filter(Boolean);
    return { ...report, outcome: "no_mail", why: `nothing can be sent: missing ${missing.join(", ")}` };
  }
  const stats = await loadStats(env).catch(() => null);
  const dataDate = stats?.data_as_of ? stats.data_as_of.slice(0, 10) : null;
  if (!stats || !dataDate) {
    log("stats.json could not be read; the next hour tries again");
    return { ...report, outcome: "no_data", why: "stats.json could not be read" };
  }
  report.dataDate = dataDate;
  if (dataDate !== now.toISOString().slice(0, 10)) {
    log(`the data date is ${dataDate}, not today's; nothing to send`);
    return { ...report, outcome: "not_today", why: `the data date is ${dataDate}, not today's` };
  }
  // Every query from here on is counted, on both databases, against D1's per invocation.
  const queries = new QueryCount();
  env = { ...env, ACCOUNTS: queries.db(env.ACCOUNTS!), RECORDS: env.RECORDS ? queries.db(env.RECORDS) : env.RECORDS };
  const clock = clockAt(now.getTime());
  const files = publishedFiles(env);
  const plans = new Map<string, Plan>();
  let stop: string | null = null;
  // The fault that ended a part, for the run log.
  let fault: string | null = null;
  // The day's ceiling, and what it still allows this run (read in the try
  // below, so a fault reading it ends the run as any fault does).
  const ceiling = mailCeiling(env);
  if (!ceiling && (env.MAIL_DAILY_QUOTA ?? "").trim()) {
    log("MAIL_DAILY_QUOTA or MAIL_DAILY_RESERVE does not read as a whole number within the quota; no daily ceiling this run");
  }
  const ceilingWords = ceiling ? ceilingText(ceiling) : "";
  let room: number | null = null;
  // The ceiling's room for a part: what the run may still send less what the parts before it sent.
  const ceilingAfter = (...parts: ({ sent: number } | null | undefined)[]): Ceiling | undefined =>
    room === null ? undefined : { room: Math.max(0, room - parts.reduce((n, p) => n + (p ? p.sent : 0), 0)), text: ceilingWords };
  const partFault = (part: string): RunReport => {
    fault = `${part} could not read or write the accounts database; the next hour tries again`;
    log(`${dataDate}: ${fault}`);
    return { ...report, outcome: "fault", why: fault };
  };
  // Past the query budget (claiming: too little left for a claim and its
  // writes), the run stops before the next search, as the message cap stops it.
  const pause = (claiming = false): boolean => {
    const why = budgetStop(queries, claiming);
    if (why) {
      stop = why;
      report.outcome = "capped";
    }
    return why !== null;
  };
  const capText = `the cap of ${RUN_MESSAGES_MAX} messages`;
  // The searches this run has claimed and not yet recorded or given back (one,
  // or a group's): a fault in between gives them back too, so the next hour
  // covers them.
  let held: { id: string; before: string | null }[] = [];
  let list: DueRow[] = [];
  // The first row of the account in hand: the list runs account by account (byAccount).
  let i = 0;
  // The rows this run has dealt with (recorded, given to another run or a stop
  // link, waiting, passed over), left out of what it leaves due.
  const done = new Set<string>();
  const passed: string[] = [];

  // Whether the run may take up one more message: under the cap, under the
  // day's ceiling, and with the queries for a claim and its writes left.
  const mayTakeUp = (): boolean => {
    if (report.sent + report.failed >= RUN_MESSAGES_MAX) {
      stop = capText;
      report.outcome = "capped";
      return false;
    }
    // The day's ceiling reached: stopped before the claim, as a sending limit stops the run.
    if (room !== null && report.sent >= room) {
      stop = ceilingWords;
      report.outcome = "limited";
      return false;
    }
    return !pause(true);
  };

  // One search's own message, as before grouping; false when the run must stop.
  const sendOne = async (r: Ready): Promise<boolean> => {
    const s = r.s;
    if (!mayTakeUp()) return false;
    // Another run at the same moment has it (that run sends it), or its delivery was turned off since the list was read.
    if (!(await claim(env, s.id, dataDate, now))) {
      done.add(s.id);
      return true;
    }
    held = [{ id: s.id, before: s.last_delivered_at }];
    const secret = s.secret ?? (await stopSecret(env, s.id, now));
    if (!secret) {
      await release(env, s.id, s.last_delivered_at, now);
      held = [];
      done.add(s.id);
      return true;
    }
    return sendClaimed(r, secret);
  };

  // A search's own message, its claim held by this run (in `held`) and its
  // stop secret known: built, sent, and recorded, or its claim given back.
  // False when a sending limit stops the run.
  const sendClaimed = async (r: Ready, secret: string): Promise<boolean> => {
    const s = r.s;
    const unhold = () => {
      held = held.filter((h) => h.id !== s.id);
    };
    const stopUrl = siteLink(site, `/account/stop?s=${s.id}&t=${secret}`, r.lang);
    const base = { lang: r.lang, to: s.email, site, label: s.label, params: r.params, cadence: r.cadence, dataDate, stopUrl, total: r.total };
    let message: DigestMessage;
    if (r.found) {
      // At most ROWS_MAX rows in all: the counts (40 at most) first, then the
      // segment's notices, whose rest a line links.
      const rows = r.found.rises.slice(0, ROWS_MAX);
      message = recordsDigest({
        ...base, kind: r.found.entity.kind, name: r.found.name, rows, more: r.more, since: r.found.since,
        tenders: r.found.tenders.slice(0, ROWS_MAX - rows.length), tenderTotal: r.found.tenders.length, tenderSince: r.start,
      });
    } else if (s.kind === "tenders") {
      message = tenderDigest({ ...base, rows: (r.items as TenderRow[]).slice(0, ROWS_MAX), since: r.start });
    } else {
      message = expiringDigest({
        ...base, rows: (r.items as ExpiringRow[]).slice(0, ROWS_MAX), months: WINDOW_MONTHS[r.win as ExpiringWindow],
        query: readExpiringQuery(new URL(r.params, BASE)),
      });
    }
    const result = await send(env, site, message);
    if (result.sent) {
      // Sent: the claim stands, whatever happens to the row that records it.
      unhold();
      done.add(s.id);
      await afterSend(() => record(env, s.id, "sent", r.total, now, r.mark));
      report.sent++;
      return true;
    }
    await release(env, s.id, s.last_delivered_at, now);
    unhold();
    if (result.code && STOP_CODES.has(result.code)) {
      stop = result.code;
      report.outcome = "limited";
      return false;
    }
    done.add(s.id);
    await record(env, s.id, "failed", r.total, now);
    report.failed++;
    return true;
  };

  // More than GROUP_OVER of an account's searches with news: one message, one
  // against the cap and the day's ceiling, all or nothing. Each search keeps
  // its own claim (one batch), its own row and its own mark (one batch after
  // the send); a send that does not go gives every claim back together. At
  // most GROUP_QUERIES queries from the claims on, inside what mayTakeUp
  // holds back. When the claims leave GROUP_OVER or fewer (stop links clicked
  // since the list was read), those are five or fewer with news, as the
  // subscriber was told, and each goes as its own message (sendClaimed, on the
  // claim already held), the second and later each held to mayTakeUp again;
  // when one of them stops the run, the claims not yet sent are given back
  // together, so none is lost and none is sent twice. False when the run must
  // stop.
  const sendGroup = async (rs: Ready[]): Promise<boolean> => {
    if (!mayTakeUp()) return false;
    const claimed = await claimAll(env, rs.map((r) => r.s.id), dataDate, now);
    const members = rs.filter((_, k) => claimed[k]);
    for (const r of rs) if (!members.includes(r)) done.add(r.s.id);
    if (!members.length) return true;
    held = members.map((r) => ({ id: r.s.id, before: r.s.last_delivered_at }));
    const made = await stopSecrets(env, members.filter((r) => !r.s.secret).map((r) => r.s.id), now);
    const secretOf = (r: Ready) => r.s.secret ?? made.get(r.s.id) ?? null;
    // A search deleted while the run was going has no secret any more, and its claim went with its row.
    const kept = members.filter((r) => secretOf(r));
    if (!kept.length) {
      await releaseAll(env, held, now);
      held = [];
      for (const r of members) done.add(r.s.id);
      return true;
    }
    if (kept.length <= GROUP_OVER) {
      // A deleted search's claim went with its row: nothing of it to give back.
      for (const r of members) if (!kept.includes(r)) done.add(r.s.id);
      held = held.filter((h) => kept.some((r) => r.s.id === h.id));
      for (const [k, r] of kept.entries()) {
        // The first was taken up with the group (mayTakeUp above); each later one is a message of its own.
        if ((k > 0 && !mayTakeUp()) || !(await sendClaimed(r, secretOf(r)!))) {
          if (held.length) await releaseAll(env, held, now);
          held = [];
          return false;
        }
      }
      return true;
    }
    const first = kept[0].s;
    const lang = asLang(first.user_lang);
    const sections = await Promise.all(kept.map((r) => groupSection(env, site, lang, r, secretOf(r)!)));
    const stopUrl = siteLink(site, await groupStopPath(first.user_id, kept.map((r) => ({ id: r.s.id, secret: secretOf(r)! }))), lang);
    const message = groupDigest({ lang, to: first.email, site, dataDate, stopUrl, sections, over: GROUP_OVER });
    const result = await send(env, site, message);
    if (result.sent) {
      // Sent: the claims stand, whatever happens to the rows that record them.
      held = [];
      for (const r of members) done.add(r.s.id);
      await afterSend(() => env.ACCOUNTS!.batch(kept.flatMap((r) => recordStatements(env, r.s.id, "sent", r.total, now, r.mark))));
      report.sent++;
      report.groups++;
      report.grouped += kept.length;
      return true;
    }
    if (result.code && STOP_CODES.has(result.code)) {
      await releaseAll(env, held, now);
      held = [];
      stop = result.code;
      report.outcome = "limited";
      return false;
    }
    await releaseAll(env, held, now, kept.map((r) => ({ id: r.s.id, items: r.total })));
    held = [];
    for (const r of members) done.add(r.s.id);
    report.failed++;
    return true;
  };

  try {
    if (ceiling) room = await dayRoom(env, ceiling, now);
    list = byAccount(await candidates(env, dataDate));
    await env.ACCOUNTS!.prepare(DELIVERIES_PRUNE_SQL).bind(daysBefore(now, DELIVERY_ROW_DAYS)).run();
    accounts: while (i < list.length) {
      let end = i;
      while (end < list.length && list[end].user_id === list[i].user_id) end++;
      // The account's searches with news, read before any is sent, in the account's order.
      const ready: Ready[] = [];
      for (let k = i; k < end; k++) {
        const s = list[k];
        if (!isDue(s.deliver, s.last_delivered_at, dataDate)) continue;
        // Past the budget the account waits whole, nothing of it claimed but the empty rows written already.
        if (pause()) break accounts;
        let plan = plans.get(s.user_id);
        if (!plan) {
          plan = (await planFor(env, { id: s.user_id, plan: s.plan, plan_until: s.plan_until }, now)).plan;
          plans.set(s.user_id, plan);
        }
        // Past the plan's figure (after a move to a smaller plan), the first ones by creation date only.
        if (!allowed({ plan }, "delivery") || (s.n_before ?? 0) >= sharedCap(plan)) {
          report.skipped++;
          passed.push(s.id);
          done.add(s.id);
          continue;
        }
        const cadence = s.deliver as Cadence;
        const lang = asLang(s.lang);
        const start = spanStart(cadence, s.last_delivered_at, dataDate);
        const win = s.kind === "expiring" ? (/^\/expiring\/(3m|6m|12m)(?:\?|$)/.exec(s.params)?.[1] ?? null) : null;
        // A filter on a merged organization or buyer reads the surviving id.
        const params = s.kind === "tenders" || win ? await survivingParams(env, s.params) : s.params;
        let items: TenderRow[] | ExpiringRow[] = [];
        let found: RecordsItems | null = null;
        if (s.kind === "tenders") items = await tenderItems(files, params, start, dataDate, clock);
        else if (win && isExpiringWindow(win)) items = await expiringItems(files, win, params, start, dataDate);
        else if (isRecordsKind(s.kind)) {
          // Once the records database (or the marks table) is found wanting, the
          // run's other records searches wait without asking it again.
          done.add(s.id);
          if (report.records) {
            report.waiting++;
            continue;
          }
          const got = await recordsItems(env, files, s, lang, start, dataDate, clock);
          if (!got) continue;
          if ("wait" in got) {
            report.records = got.wait;
            report.waiting++;
            continue;
          }
          done.delete(s.id);
          found = got;
        } else {
          done.add(s.id);
          continue;
        }
        const more = found ? found.rises.reduce((n, r) => n + r.more, 0) : 0;
        const total = found ? more + found.tenders.length : items.length;
        const mark = found?.mark ?? null;
        if (total === 0) {
          if (pause(true)) break accounts;
          done.add(s.id);
          if (!(await claim(env, s.id, dataDate, now))) continue;
          held = [{ id: s.id, before: s.last_delivered_at }];
          await record(env, s.id, "empty", 0, now, mark);
          held = [];
          report.empty++;
          continue;
        }
        ready.push({ s, lang, cadence, start, params, win, items, found, total, more, mark });
      }
      if (ready.length > GROUP_OVER) {
        if (!(await sendGroup(ready))) break accounts;
      } else {
        for (const r of ready) if (!(await sendOne(r))) break accounts;
      }
      i = end;
    }
    await passedOver(env, passed, dataDate, now, queries);
  } catch (e) {
    if (held.length) await releaseAll(env, held, now).catch(() => undefined);
    fault = e instanceof Fault ? e.message : "the accounts database could not be read or written; the next hour tries again";
    log(`${dataDate}: ${fault} (${counts(report)} before it)`);
    report.outcome = "fault";
    if (!(e instanceof Fault)) return { ...report, why: fault };
  } finally {
    // What the saved searches left: the ones that waited, and from the account in hand on, those still due.
    tally.left += report.waiting + unfinished(list, i, (s) =>
      !done.has(s.id) && isDue(s.deliver, s.last_delivered_at, dataDate) && likelyServed(plans, s.user_id, s.plan, "delivery"));
  }
  if (!stop) {
    try {
      const watch = await runWatchMail(env, {
        site, dataDate, now, plans, room: roomAfter(report), capText, queries, tally, ceiling: ceilingAfter(report),
      });
      report.watch = watch.report;
      if (watch.stop) {
        stop = watch.stop;
        if (report.outcome === "done") report.outcome = watch.capped ? "capped" : "limited";
      }
    } catch {
      return partFault("the watch mail");
    }
  }
  if (!stop) {
    try {
      const brief = await runBriefings(env, {
        site, dataDate, now, plans, room: roomAfter(report, report.watch), capText, queries, tally, ceiling: ceilingAfter(report, report.watch),
      });
      report.briefing = brief.report;
      if (brief.stop) {
        stop = brief.stop;
        if (report.outcome === "done") report.outcome = brief.capped ? "capped" : "limited";
      }
    } catch {
      return partFault("the briefings");
    }
  }
  if (!stop) {
    try {
      const weekly = await runWeekly(env, {
        site, dataDate, now, plans, room: roomAfter(report, report.watch, report.briefing), capText, queries, files, stats, tally,
        ceiling: ceilingAfter(report, report.watch, report.briefing),
      });
      report.weekly = weekly.report;
      if (weekly.stop) {
        stop = weekly.stop;
        if (report.outcome === "done") report.outcome = weekly.capped ? "capped" : "limited";
      }
    } catch {
      return partFault("the weekly email");
    }
  }
  // A stop at the weekly email's own ceiling (WEEKLY_RUN_MAX) holds the weekly
  // email alone: the saved views still get what the shared cap has left.
  const viewRoom = roomAfter(report, report.watch, report.briefing, report.weekly);
  if (!stop || (report.outcome === "capped" && viewRoom > 0 && !queries.spent)) {
    try {
      const views = await runViewMail(env, {
        site, dataDate, now, plans, room: viewRoom, capText, queries, tally, ceiling: ceilingAfter(report, report.watch, report.briefing, report.weekly),
      });
      report.views = views.report;
      if (views.stop) {
        stop = views.stop;
        if (report.outcome === "done") report.outcome = views.capped ? "capped" : "limited";
      }
    } catch {
      return partFault("the saved views");
    }
  }
  if (report.outcome === "fault") {
    if (report.watch && watchActive(report.watch)) log(`${dataDate}: ${watchCounts(report.watch)}`);
    if (report.briefing && briefingActive(report.briefing)) log(`${dataDate}: ${briefingCounts(report.briefing)}`);
    if (report.weekly && weeklyActive(report.weekly)) log(`${dataDate}: ${weeklyCounts(report.weekly)}`);
    if (report.views && viewActive(report.views)) log(`${dataDate}: ${viewCounts(report.views)}`);
    return { ...report, why: fault };
  }
  const after = stop === ceilingWords ? "; the rest waits for the next UTC day" : ", the next hour goes on";
  log(`${dataDate}: ${counts(report)}${stop ? `; stopped at ${stop}${after}` : ""}`);
  return { ...report, why: stop };
}

const WAIT_WHY: Record<RecordsWait | "no_marks", string> = {
  absent: "the records database is not bound",
  loading: "the records database is loading",
  failed: "the records database could not be read",
  stale: "the records database is not at today's data date",
  no_marks: "the accounts database has no delivery_marks table (apply accounts_schema.sql)",
};

const watchActive = (w: WatchReport) => w.sent + w.failed + w.empty + w.skipped + w.waiting + w.expired > 0 || w.records !== null;

const watchCounts = (w: WatchReport) =>
  `watch mail: ${w.sent} sent, ${w.failed} failed, ${w.empty} with nothing new, ${w.skipped} not on a plan with it, ` +
  `${w.expired} closed notices' watches ended` + (w.records ? `, ${w.waiting} accounts waiting: ${WATCH_WAIT_WHY[w.records]}` : "");

const counts = (r: RunReport) =>
  `${r.sent} sent${r.groups ? ` (${r.groups} of them grouped, carrying ${r.grouped} searches)` : ""}, ${r.failed} failed, ` +
  `${r.empty} with nothing new, ${r.skipped} not on a plan with delivery` +
  (r.records ? `, ${r.waiting} organization, buyer or segment searches waiting: ${WAIT_WHY[r.records]}` : "") +
  (r.watch && watchActive(r.watch) ? `; ${watchCounts(r.watch)}` : "") +
  (r.briefing && briefingActive(r.briefing) ? `; ${briefingCounts(r.briefing)}` : "") +
  (r.weekly && weeklyActive(r.weekly) ? `; ${weeklyCounts(r.weekly)}` : "") +
  (r.views && viewActive(r.views) ? `; ${viewCounts(r.views)}` : "");
