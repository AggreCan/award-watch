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
//      holds every kind), whose owner's plan allows delivery, and that is
//      due: not delivered for this data date, and for weekly, never
//      delivered or delivered seven or more days ago; one that failed once
//      for this data date waits for the next one.
//
// A tender or radar search's items are the records since the previous
// delivery's data date, at most SPAN_DAYS_MAX days back (one day for a first
// daily delivery, seven for a first weekly one), read from the published
// files. An organization, buyer or segment search reads the records database
// instead (records_deliveries.ts): the sources and fiscal years whose count
// rose since the counts its previous delivery kept, plus, for a segment, the
// segment's new tender notices from the files. Until that database is ready
// at today's data date (no binding, a load under way, a failed statement, a
// sync that did not finish tonight), those searches wait, unclaimed, and the
// run's report and log line say why; the next hour reads it again.
//
// Nothing new writes an "empty" row and sends nothing. Otherwise one
// message, in the search's language, goes through the
// accounts sender, and a "sent" or "failed" row is written; "sent" and
// "empty" move last_delivered_at to the run's time, "failed" leaves it, so
// the next delivery covers what this one missed. At most RUN_MESSAGES_MAX
// messages a run; a daily-limit or rate-limit refusal stops the run and the
// next hour goes on from there. A file or the database failing logs one line
// and ends the run; the next hour tries again. A second run in the same hour
// finds nothing due, and two runs at the same moment (a trigger fired twice)
// send each search once: a run claims a search for the data date before
// sending (claim), and gives it back when the send does not go (release).
//
// After the saved searches, the same run sends the watch mail (watch_mail.ts):
// one message per account with watches, inside the same cap, and a sending
// limit met there stops the run the same way. A file that did not read stops
// the saved searches only, since the watches read the records database alone.
// Then the weekly briefings (briefings.ts runBriefings), the same way.
//
// Log lines name counts and dates only, never an address or a label.

import { addDays } from "../../public/closing.js";
import { clockAt, closingPassed, type Clock } from "../closing";
import {
  type ExpiringRow, type ExpiringWindow, type TenderRow, isExpiringWindow, loadExpiringPage, loadExpiringWindow, loadNewTenders, loadStats,
} from "../data";
import type { Env } from "../env";
import { pick, segmentShort, type Lang } from "../i18n";
import { WINDOW_DAYS, filterExpiring, readExpiringQuery } from "../pages/expiring";
import { filterTenders, readTenderQuery } from "../pages/tenders";
import { type Cadence, type DigestMessage, expiringDigest, recordsDigest, siteLink, tenderDigest } from "./digests";
import { allowed, planFor, type Plan } from "./entitlements";
import {
  type Entity, type Mark, type RecordsWait, type Rise, MARK_WRITE_SQL, entityOf, isRecordsKind, loadMark, markText, missingTable, readCounts,
  rises,
} from "./records_deliveries";
import { type BriefingReport, briefingActive, briefingCounts, runBriefings } from "./briefings";
import { DELIVERABLE_KINDS } from "./searches";
import { randomHex } from "./secrets";
import { type MailMessage, senderFor } from "./sender";
import { accountsEnabled } from "./switch";
import { WATCH_WAIT_WHY, type WatchReport, runWatchMail } from "./watch_mail";

// The hourly trigger in wrangler.jsonc; any other trigger is the daily check.
export const DELIVERY_CRON = "0 15-20 * * *";

export const RUN_MESSAGES_MAX = 300;
// Rows listed in one message; the rest are a line linking the page.
export const ROWS_MAX = 50;
// The most days one delivery reaches back, whatever the gap since the last.
export const SPAN_DAYS_MAX = 7;
// A weekly search is due again this many days after its last delivery.
export const WEEK_DAYS = 7;
// The messages a run may still send once the parts named have run: the cap
// less every message they sent or tried, never below zero. The watch mail
// gets roomAfter(the saved searches) and the briefings roomAfter(the saved
// searches, the watch mail), so the three parts share the one cap
// (test-mail/caps.test.ts holds the arithmetic).
export const roomAfter = (...parts: ({ sent: number; failed: number } | null | undefined)[]): number =>
  Math.max(0, RUN_MESSAGES_MAX - parts.reduce((n, p) => n + (p ? p.sent + p.failed : 0), 0));
// Refusals that mean the account's sending is spent for now: the run stops
// and the next hour goes on. Any other refusal fails that one message.
export const STOP_CODES: ReadonlySet<string> = new Set(["E_DAILY_LIMIT_EXCEEDED", "E_RATE_LIMIT_EXCEEDED"]);

const BASE = "https://deliveries.invalid";

export type RunOutcome = "off" | "no_mail" | "no_data" | "not_today" | "fault" | "limited" | "capped" | "done";

export interface RunReport {
  outcome: RunOutcome;
  dataDate: string | null;
  sent: number;
  failed: number;
  empty: number;
  // Due searches whose owner's plan does not allow delivery.
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
}

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
};

// The searches that can be due on the data date, oldest first; isDue then
// applies the weekly rule. A search that failed once for this data date is
// left for the next one, so an address the mail service refuses is not
// tried every hour.
async function candidates(env: Env, dataDate: string): Promise<DueRow[]> {
  const res = await env.ACCOUNTS!.prepare(
    "SELECT s.id, s.user_id, s.kind, s.params, s.label, s.lang, s.deliver, s.last_delivered_at, u.email, u.plan, u.plan_until, " +
    "k.secret FROM saved_searches s JOIN users u ON u.id = s.user_id LEFT JOIN delivery_tokens k ON k.search_id = s.id " +
    "WHERE u.status = 'active' AND s.deliver IN ('daily', 'weekly') " +
    `AND s.kind IN (${DELIVERABLE_KINDS.map(() => "?").join(", ")}) ` +
    "AND (s.last_delivered_at IS NULL OR substr(s.last_delivered_at, 1, 10) < ?) " +
    "AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.saved_search_id = s.id AND d.status = 'failed' AND d.sent_at >= ?) " +
    "ORDER BY s.created_at, s.id",
  ).bind(...DELIVERABLE_KINDS, dataDate, dataDate).all<DueRow>();
  return res.results ?? [];
}

// -- the published files, each read once a run ------------------------------------------------

export function publishedFiles(env: Env) {
  const days = new Map<string, readonly TenderRow[]>();
  const pages = new Map<string, readonly ExpiringRow[]>();
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
      const index = await loadExpiringWindow(env, window);
      if (!index) throw new Fault(`expiring/${window}/index.json could not be read; the next hour tries again`);
      const out: ExpiringRow[] = [];
      for (let n = index.pages; n >= 1; n--) {
        const key = `${window}/${n}`;
        let rows = pages.get(key);
        if (!rows) {
          const loaded = await loadExpiringPage(env, window, n);
          if (!loaded) throw new Fault(`expiring/${key}.json could not be read; the next hour tries again`);
          rows = loaded;
          pages.set(key, rows);
        }
        let reachesBack = rows.length === 0;
        for (const r of rows) {
          if (r.end.slice(0, 10) > after) out.push(r);
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

// The saved window's rows that entered it since `start`: inside the window
// at the data date (end at most its length past it) and outside at `start`
// (end more than its length past that), with the filters the radar's form
// saved. Newest end first.
export async function expiringItems(files: Files, window: ExpiringWindow, params: string, start: string, dataDate: string): Promise<ExpiringRow[]> {
  const q = readExpiringQuery(new URL(params, BASE));
  const days = WINDOW_DAYS[window];
  const outsideBefore = addDays(start, days);
  const insideNow = addDays(dataDate, days);
  const rows = (await files.endingAfter(window, outsideBefore)).filter((r) => {
    const end = r.end.slice(0, 10);
    return end <= insideNow && end >= dataDate;
  });
  return filterExpiring(rows, q).sort((a, b) => {
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
};

export async function recordsItems(
  env: Env, files: Files, s: { id: string; kind: string; params: string }, lang: Lang, start: string, dataDate: string, clock: Clock,
): Promise<RecordsItems | { wait: RecordsWait | "no_marks" } | null> {
  const entity = entityOf(s.kind, s.params);
  if (!entity) return null;
  const read = await readCounts(env, entity, dataDate);
  if (read.state !== "ready") return { wait: read.state };
  let prev: Mark | null;
  try {
    prev = await loadMark(env, s.id);
  } catch (e) {
    if (missingTable(e)) return { wait: "no_marks" };
    throw e;
  }
  const name = entity.kind === "segment"
    ? `${entity.id} ${segmentShort(lang, entity.id)}`
    : (read.name ? pick(lang, read.name.en, read.name.fr) : null) ?? entity.id;
  const tenders = entity.kind === "segment" ? await tenderItems(files, `/tenders?segment=${entity.id}`, start, dataDate, clock) : [];
  return { entity, name, rises: rises(prev, read.mark) ?? [], since: prev?.asOf ?? dataDate, tenders, mark: read.mark };
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

// One deliveries row, and for "sent" and "empty" the search's
// last_delivered_at and, for a records search, its new mark, in one batch.
// Written only while the search exists, so a search deleted during the run
// is passed over rather than failing it. A "failed" row keeps the old mark,
// so the next delivery reports what this one did not send.
async function record(
  env: Env, searchId: string, status: "sent" | "failed" | "empty", items: number, now: Date, mark: Mark | null = null,
): Promise<void> {
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
  await db.batch(statements);
}

// A search taken for the data date by this run: last_delivered_at set to the
// run's time in one statement that holds only while no run has delivered it
// for this data date, so of two runs at once exactly one goes on.
async function claim(env: Env, searchId: string, dataDate: string, now: Date): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE saved_searches SET last_delivered_at = ? WHERE id = ? AND (last_delivered_at IS NULL OR substr(last_delivered_at, 1, 10) < ?)",
  ).bind(now.toISOString(), searchId, dataDate).run();
  return (res.meta?.changes ?? 0) === 1;
}

// A claim given back: last_delivered_at as it was before, if this run's claim
// still stands, so the next delivery covers what this one did not send.
async function release(env: Env, searchId: string, before: string | null, now: Date): Promise<void> {
  await env.ACCOUNTS!.prepare("UPDATE saved_searches SET last_delivered_at = ? WHERE id = ? AND last_delivered_at = ?")
    .bind(before, searchId, now.toISOString()).run();
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

export async function runDeliveries(env: Env, now: Date = nowOf(env)): Promise<RunReport> {
  const report: RunReport = {
    outcome: "done", dataDate: null, sent: 0, failed: 0, empty: 0, skipped: 0, waiting: 0, records: null, watch: null,
  };
  if (!accountsEnabled(env)) return { ...report, outcome: "off" };
  const site = siteOf(env);
  if (!env.MAIL || !env.MAIL_FROM?.trim() || !site) return { ...report, outcome: "no_mail" };
  const stats = await loadStats(env).catch(() => null);
  const dataDate = stats?.data_as_of ? stats.data_as_of.slice(0, 10) : null;
  if (!dataDate) {
    log("stats.json could not be read; the next hour tries again");
    return { ...report, outcome: "no_data" };
  }
  report.dataDate = dataDate;
  if (dataDate !== now.toISOString().slice(0, 10)) {
    log(`the data date is ${dataDate}, not today's; nothing to send`);
    return { ...report, outcome: "not_today" };
  }
  const clock = clockAt(now.getTime());
  const files = publishedFiles(env);
  const plans = new Map<string, Plan>();
  let stop: string | null = null;
  // The search this run has claimed and not yet recorded or given back: a
  // fault in between gives it back too, so the next hour covers it.
  let held: { id: string; before: string | null } | null = null;
  try {
    for (const s of await candidates(env, dataDate)) {
      if (!isDue(s.deliver, s.last_delivered_at, dataDate)) continue;
      let plan = plans.get(s.user_id);
      if (!plan) {
        plan = (await planFor(env, { id: s.user_id, plan: s.plan, plan_until: s.plan_until }, now)).plan;
        plans.set(s.user_id, plan);
      }
      if (!allowed({ plan }, "delivery")) {
        report.skipped++;
        continue;
      }
      const cadence = s.deliver as Cadence;
      const lang = asLang(s.lang);
      const start = spanStart(cadence, s.last_delivered_at, dataDate);
      const win = s.kind === "expiring" ? /^\/expiring\/(3m|6m|12m)(?:\?|$)/.exec(s.params)?.[1] : null;
      let items: TenderRow[] | ExpiringRow[] = [];
      let found: RecordsItems | null = null;
      if (s.kind === "tenders") items = await tenderItems(files, s.params, start, dataDate, clock);
      else if (win && isExpiringWindow(win)) items = await expiringItems(files, win, s.params, start, dataDate);
      else if (isRecordsKind(s.kind)) {
        // Once the records database (or the marks table) is found wanting, the
        // run's other records searches wait without asking it again.
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
        found = got;
      } else continue;
      const more = found ? found.rises.reduce((n, r) => n + r.more, 0) : 0;
      const total = found ? more + found.tenders.length : items.length;
      const mark = found?.mark ?? null;
      if (total === 0) {
        if (!(await claim(env, s.id, dataDate, now))) continue;
        held = { id: s.id, before: s.last_delivered_at };
        await record(env, s.id, "empty", 0, now, mark);
        held = null;
        report.empty++;
        continue;
      }
      if (report.sent + report.failed >= RUN_MESSAGES_MAX) {
        stop = `the cap of ${RUN_MESSAGES_MAX} messages`;
        report.outcome = "capped";
        break;
      }
      // Another run at the same moment has it: that run sends it.
      if (!(await claim(env, s.id, dataDate, now))) continue;
      held = { id: s.id, before: s.last_delivered_at };
      const secret = s.secret ?? (await stopSecret(env, s.id, now));
      if (!secret) {
        await release(env, s.id, s.last_delivered_at, now);
        held = null;
        continue;
      }
      const stopUrl = siteLink(site, `/account/stop?s=${s.id}&t=${secret}`, lang);
      const base = { lang, to: s.email, site, label: s.label, params: s.params, cadence, dataDate, stopUrl, total };
      let message: DigestMessage;
      if (found) {
        // At most ROWS_MAX rows in all: the counts (40 at most) first, then the
        // segment's notices, whose rest a line links.
        const rows = found.rises.slice(0, ROWS_MAX);
        message = recordsDigest({
          ...base, kind: found.entity.kind, name: found.name, rows, more, since: found.since,
          tenders: found.tenders.slice(0, ROWS_MAX - rows.length), tenderTotal: found.tenders.length, tenderSince: start,
        });
      } else if (s.kind === "tenders") {
        message = tenderDigest({ ...base, rows: (items as TenderRow[]).slice(0, ROWS_MAX), since: start });
      } else {
        message = expiringDigest({
          ...base, rows: (items as ExpiringRow[]).slice(0, ROWS_MAX), months: WINDOW_MONTHS[win as ExpiringWindow],
          query: readExpiringQuery(new URL(s.params, BASE)),
        });
      }
      const result = await send(env, site, message);
      if (result.sent) {
        // Sent: the claim stands, whatever happens to the row that records it.
        held = null;
        await record(env, s.id, "sent", total, now, mark);
        report.sent++;
      } else if (result.code && STOP_CODES.has(result.code)) {
        await release(env, s.id, s.last_delivered_at, now);
        held = null;
        stop = result.code;
        report.outcome = "limited";
        break;
      } else {
        await release(env, s.id, s.last_delivered_at, now);
        held = null;
        await record(env, s.id, "failed", total, now);
        report.failed++;
      }
    }
  } catch (e) {
    if (held) await release(env, held.id, held.before, now).catch(() => undefined);
    const why = e instanceof Fault ? e.message : "the accounts database could not be read or written; the next hour tries again";
    log(`${dataDate}: ${why} (${counts(report)} before it)`);
    if (!(e instanceof Fault)) return { ...report, outcome: "fault" };
    report.outcome = "fault";
  }
  if (!stop) {
    try {
      const watch = await runWatchMail(env, {
        site, dataDate, now, plans, room: roomAfter(report), capText: `the cap of ${RUN_MESSAGES_MAX} messages`,
      });
      report.watch = watch.report;
      if (watch.stop) {
        stop = watch.stop;
        if (report.outcome === "done") report.outcome = watch.capped ? "capped" : "limited";
      }
    } catch {
      log(`${dataDate}: the watch mail could not read or write the accounts database; the next hour tries again`);
      return { ...report, outcome: "fault" };
    }
  }
  if (!stop) {
    try {
      const brief = await runBriefings(env, {
        site, dataDate, now, plans, room: roomAfter(report, report.watch), capText: `the cap of ${RUN_MESSAGES_MAX} messages`,
      });
      report.briefing = brief.report;
      if (brief.stop) {
        stop = brief.stop;
        if (report.outcome === "done") report.outcome = brief.capped ? "capped" : "limited";
      }
    } catch {
      log(`${dataDate}: the briefings could not read or write the accounts database; the next hour tries again`);
      return { ...report, outcome: "fault" };
    }
  }
  if (report.outcome === "fault") {
    if (report.watch && watchActive(report.watch)) log(`${dataDate}: ${watchCounts(report.watch)}`);
    if (report.briefing && briefingActive(report.briefing)) log(`${dataDate}: ${briefingCounts(report.briefing)}`);
    return report;
  }
  log(`${dataDate}: ${counts(report)}${stop ? `; stopped at ${stop}, the next hour goes on` : ""}`);
  return report;
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
  `${r.sent} sent, ${r.failed} failed, ${r.empty} with nothing new, ${r.skipped} not on a plan with delivery` +
  (r.records ? `, ${r.waiting} organization, buyer or segment searches waiting: ${WAIT_WHY[r.records]}` : "") +
  (r.watch && watchActive(r.watch) ? `; ${watchCounts(r.watch)}` : "") +
  (r.briefing && briefingActive(r.briefing) ? `; ${briefingCounts(r.briefing)}` : "");
