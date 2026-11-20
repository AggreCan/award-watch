// Saved views by email (docs/accounts.md, Saved views): the fifth part of the
// hourly delivery run (deliveries.ts runDeliveries calls runViewMail after the
// weekly email, inside the same cap of RUN_MESSAGES_MAX messages). Ultra's
// (entitlements.ts view_mail), and only while Ultra is on sale
// (payments.ts ultraOnSale): before that the part reads and sends nothing.
//
// A view set to weekly is due on the first run of its week (the briefings'
// weekday, briefings.ts weekAnchor); one set to monthly on the first run on or
// after the month's first Monday (monthAnchor). It is due while not covered
// since that day, its account is active, not blocked, on a plan with view_mail,
// and the view is one of the first by creation date within the plan's figure,
// and no message was refused for it since that day (it waits for the next).
// Its figures are read from the records database in one batch of two
// statements (the view's first chart and its largest records of the period's
// last fiscal year) and hashed; a view whose figures hash as its last message's
// did writes "same" and sends nothing. Claimed for its period before its
// message goes and given back when the send does not go, as a briefing is.
// Until the records database is ready at today's data date every view waits,
// unclaimed. A view whose buyer or organization the nightly merged is read at
// the surviving id (saved_views.ts survivingAddress), as its page reads it. A
// view whose account's plan does not send it is marked for its period with no
// run row (passedOver), so it leaves the list. More than GROUP_OVER of an
// account's views with new figures in one run go as one message
// (digests.ts viewGroupDigest), as its saved searches do.
//
// Log lines name counts and dates only, never an address, a name or a view.

import { addDays } from "../../public/closing.js";
import type { Env } from "../env";
import { pick, type Lang } from "../i18n";
import {
  BUYER_QUARTERS_SQL, BUYER_RECORDS_SQL, ORG_RECORDS_SQL, ORG_YEARS_SQL, SEGMENT_RECORDS_SQL, SEGMENT_YEARS_SQL, SOURCE_NUMBER, type Query, type Row,
  fiscalYearOf, num, orgNumber, planYears, readRecords, segmentNumber,
} from "../records_db";
import { type Frame, type View, viewFrame, viewOf } from "../view_address";
import { BRIEFING_WEEKDAY, type BriefingWait, recordPath, weekAnchor } from "./briefings";
import {
  ACCOUNT_LANG_SQL, type Ceiling, GROUP_OVER, type QueryCount, STOP_CODES, type Tally, afterSend, budgetStop, likelyServed, sendWithHeaders,
  unfinished,
} from "./deliveries";
import { type ViewRecord, type ViewYear, VIEW_MAIL_ROWS, siteLink, viewDigest, viewGroupDigest } from "./digests";
import { allowed, savedViewCap, type Plan } from "./entitlements";
import { groupStopPath } from "./group_stop";
import { ultraOnSale } from "./payments";
import { RunPool } from "./pool";
import { VIEW_DELIVERY_DAYS, missingViews, survivingAddress } from "./saved_views";
import { randomHex, sha256Hex } from "./secrets";

// Views the job reads in one run; the next hour reads the rest.
export const VIEWS_RUN_MAX = 1000;
// The version of the figures a hash is made of: a change to what a message
// carries changes it, so every view sends once more rather than stay silent.
export const VIEW_HASH_VERSION = 1;

export type ViewCadence = "weekly" | "monthly";

// -- the calendar --------------------------------------------------------------------------------

const firstMonday = (year: number, month: number): string => {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const day = new Date(`${first}T00:00:00Z`).getUTCDay();
  return addDays(first, (BRIEFING_WEEKDAY - day + 7) % 7);
};

// The month's first Monday on or before the data date: this month's when it
// has come, else the month before's. A monthly view covered on or after it
// waits for the next one.
export function monthAnchor(dataDate: string): string {
  const year = Number(dataDate.slice(0, 4));
  const month = Number(dataDate.slice(5, 7));
  const here = firstMonday(year, month);
  return here <= dataDate ? here : month === 1 ? firstMonday(year - 1, 12) : firstMonday(year, month - 1);
}

export const anchorOf = (cadence: ViewCadence, dataDate: string): string => (cadence === "weekly" ? weekAnchor(dataDate) : monthAnchor(dataDate));

// Whether a view is due on a data date: weekly or monthly, and not covered since its period's anchor.
export function viewDue(deliver: string, lastDelivered: string | null, dataDate: string): boolean {
  if (deliver !== "weekly" && deliver !== "monthly") return false;
  return !lastDelivered || lastDelivered.slice(0, 10) < anchorOf(deliver, dataDate);
}

// -- the figures -------------------------------------------------------------------------------------

// The two statements of a view: its first chart's (a buyer's by fiscal
// quarter, added up by fiscal year here; an organization's and a segment's by
// fiscal year), at the view's source and period, and its largest records of
// the period's last fiscal year. null for an id the records database cannot
// key (an organization or a segment it does not name).
export function viewQueries(kind: View, id: string, frame: Pick<Frame, "source" | "first" | "last">): Query[] | null {
  const src = SOURCE_NUMBER[frame.source];
  const key = kind === "buyer" ? id : kind === "organization" ? orgNumber(id) : segmentNumber(id);
  if (key === null) return null;
  const chart = kind === "buyer" ? BUYER_QUARTERS_SQL : kind === "organization" ? ORG_YEARS_SQL : SEGMENT_YEARS_SQL;
  const largest = kind === "buyer" ? BUYER_RECORDS_SQL : kind === "organization" ? ORG_RECORDS_SQL : SEGMENT_RECORDS_SQL;
  return [{ sql: chart, params: [key, src, frame.first, frame.last] }, { sql: largest, params: [key, src, frame.last, frame.last] }];
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

// The rows as the message lists them: the years (a buyer's quarters added up
// by year; a sum with no counted value stays null), and the largest records,
// each with the other party in the message's language.
export function viewFigures(kind: View, lang: Lang, chart: Row[], top: Row[]): { years: ViewYear[]; largest: ViewRecord[] } {
  const byYear = new Map<number, ViewYear>();
  for (const r of chart) {
    const fy = num(r.fy);
    if (fy === null) continue;
    const y = byYear.get(fy) ?? { fy, n: 0, cents: null };
    y.n += num(r.n) ?? 0;
    const cents = num(r.cents);
    if (cents !== null) y.cents = (y.cents ?? 0) + cents;
    byYear.set(fy, y);
  }
  const largest = top.slice(0, VIEW_MAIL_ROWS).flatMap((r): ViewRecord[] => {
    const src = num(r.src);
    const cents = num(r.cents);
    if (src === null || cents === null) return [];
    const buyer = pick(lang, str(r.name_en), str(r.name_fr));
    const org = str(r.name);
    const party = kind === "organization" ? buyer : kind === "segment" ? [org, buyer].filter(Boolean).join(" · ") || null : org;
    return [{ src, ref: str(r.ref), title: str(r.title), cents, party, path: recordPath(src, str(r.ref)) }];
  });
  return { years: [...byYear.values()].sort((a, b) => a.fy - b.fy), largest };
}

// The SHA-256 of what a message carries, so an unchanged view sends nothing:
// the source and the period's fiscal years, each year's records and value,
// and the largest records by reference and value. Public figures only.
export async function figuresHash(frame: Pick<Frame, "source" | "first" | "last">, f: { years: readonly ViewYear[]; largest: readonly ViewRecord[] }): Promise<string> {
  return sha256Hex(JSON.stringify({
    v: VIEW_HASH_VERSION, source: frame.source, first: frame.first, last: frame.last,
    years: f.years.map((y) => [y.fy, y.n, y.cents]), largest: f.largest.map((r) => [r.src, r.ref, r.cents]),
  }));
}

// The first chart's table as a file (pages/analytics.tsx analyticsCsv): the
// address with the table's name before its query.
export function viewCsv(kind: View, address: string): string | null {
  const at = address.indexOf("/analytics?");
  if (at < 0) return null;
  const table = kind === "buyer" ? "quarters" : "years";
  return `${address.slice(0, at)}/analytics/${table}.csv${address.slice(at + "/analytics".length)}`;
}

// -- the run ------------------------------------------------------------------------------------------

export type ViewWait = BriefingWait;

export interface ViewReport {
  sent: number;
  failed: number;
  // Of the messages sent, the grouped ones, and the views they carried (each grouped message counts once in sent).
  groups: number;
  grouped: number;
  // Due views whose figures had not changed: no message.
  same: number;
  // Due views whose owner's plan does not send them (no view_mail, or past its figure).
  skipped: number;
  // Views left for a later run, and why; records is null when none waited.
  waiting: number;
  records: ViewWait | null;
}

export const emptyViewReport = (): ViewReport => ({ sent: 0, failed: 0, groups: 0, grouped: 0, same: 0, skipped: 0, waiting: 0, records: null });

// The views that can be due on the data date, those of accounts whose cached
// plan is paid first, then oldest first (?1 the week's anchor, ?2 the month's,
// ?3 the cap): weekly or monthly, an active account that is not blocked, not
// covered since its cadence's anchor, and no message refused for it since
// then. n_before counts the account's views made before it: past the plan's
// figure, after a move to a smaller plan, only the first ones by creation
// date are sent. The cached plan (users.plan) only orders the list, and holds
// Ultra as pro, so it puts the views of accounts that moved down to Free after
// the others and cannot tell Ultra from Pro; planFor at the send decides.
export const VIEWS_DUE_SQL =
  "SELECT v.id, v.user_id, v.kind, v.address, v.name, v.lang, v.deliver, v.last_delivered_at, v.last_hash, v.secret, u.email, u.plan, u.plan_until, " +
  "(SELECT COUNT(*) FROM saved_views x WHERE x.user_id = v.user_id AND (x.created_at < v.created_at OR (x.created_at = v.created_at AND x.id < v.id))) AS n_before " +
  "FROM saved_views v JOIN users u ON u.id = v.user_id WHERE v.deliver IN ('weekly', 'monthly') AND u.status = 'active' " +
  "AND (v.last_delivered_at IS NULL OR substr(v.last_delivered_at, 1, 10) < (CASE v.deliver WHEN 'weekly' THEN ?1 ELSE ?2 END)) " +
  "AND NOT EXISTS (SELECT 1 FROM view_deliveries d WHERE d.view_id = v.id AND d.status = 'failed' AND d.sent_at >= (CASE v.deliver WHEN 'weekly' THEN ?1 ELSE ?2 END)) " +
  "AND NOT EXISTS (SELECT 1 FROM account_blocks x WHERE x.user_id = v.user_id) ORDER BY u.plan = 'free', v.created_at, v.id LIMIT ?3";

type DueRow = {
  id: string; user_id: string; kind: string; address: string; name: string; lang: string; deliver: string; last_delivered_at: string | null;
  last_hash: string | null; secret: string | null; email: string; plan: string; plan_until: string | null; n_before: number;
};

// The view taken for its period by this run: one statement that holds only
// while no run has covered it since the anchor. The same statement covers a
// view passed over (passedOver below), and a group's claims are made with it,
// one each, in one batch (claimAll).
const CLAIM_SQL =
  "UPDATE saved_views SET last_delivered_at = ?1 WHERE id = ?2 AND deliver IN ('weekly', 'monthly') " +
  "AND (last_delivered_at IS NULL OR substr(last_delivered_at, 1, 10) < ?3)";

async function claim(env: Env, id: string, anchor: string, now: Date): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(CLAIM_SQL).bind(now.toISOString(), id, anchor).run();
  return (res.meta?.changes ?? 0) === 1;
}

// A group's claims: each view its own statement at its own period's anchor, in one batch (one query); whether each
// one holds, in order.
async function claimAll(env: Env, views: readonly { id: string; anchor: string }[], now: Date): Promise<boolean[]> {
  const db = env.ACCOUNTS!;
  const results = await db.batch(views.map((v) => db.prepare(CLAIM_SQL).bind(now.toISOString(), v.id, v.anchor)));
  return results.map((r) => (r.meta?.changes ?? 0) === 1);
}

// The claim given back, while it is this run's.
const RELEASE_SQL = "UPDATE saved_views SET last_delivered_at = ?1 WHERE id = ?2 AND last_delivered_at = ?3";

async function release(env: Env, id: string, before: string | null, now: Date): Promise<void> {
  await env.ACCOUNTS!.prepare(RELEASE_SQL).bind(before, id, now.toISOString()).run();
}

// The views read and passed over because their account's plan does not send
// them (no view_mail, or past the plan's figure after a move to a smaller
// plan): covered for their period as a claim would cover them, with no run
// row, so they leave the list and do not fill it ahead of the views that are
// paid for. A plan restored within the period sends from the next one. One
// D1 batch of at most MARKS_BATCH statements a query.
export const MARKS_BATCH = 100;

async function passedOver(env: Env, views: readonly { id: string; anchor: string }[], now: Date): Promise<void> {
  const db = env.ACCOUNTS!;
  for (let i = 0; i < views.length; i += MARKS_BATCH) {
    await db.batch(views.slice(i, i + MARKS_BATCH).map((v) => db.prepare(CLAIM_SQL).bind(now.toISOString(), v.id, v.anchor)));
  }
}

// One run row, written only while the view exists; a sent message keeps its hash beside it.
function recordStatements(env: Env, id: string, status: "sent" | "failed" | "same", now: Date, dataDate: string, hash: string | null = null): D1PreparedStatement[] {
  const db = env.ACCOUNTS!;
  const row = db.prepare(
    "INSERT INTO view_deliveries (view_id, sent_at, day, status) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM saved_views WHERE id = ?1)",
  ).bind(id, now.toISOString(), dataDate, status);
  return status === "sent" && hash ? [row, db.prepare("UPDATE saved_views SET last_hash = ? WHERE id = ?").bind(hash, id)] : [row];
}

async function record(env: Env, id: string, status: "sent" | "failed" | "same", now: Date, dataDate: string, hash: string | null = null): Promise<void> {
  const statements = recordStatements(env, id, status, now, dataDate, hash);
  if (statements.length > 1) await env.ACCOUNTS!.batch(statements);
  else await statements[0].run();
}

// Every claim of a group given back together, and, when the mail service
// refused the message, each view's failed row with it: one batch.
async function releaseAll(
  env: Env, held: readonly { id: string; before: string | null }[], now: Date, dataDate: string, failed: readonly string[] = [],
): Promise<void> {
  const db = env.ACCOUNTS!;
  await db.batch([
    ...held.map((h) => db.prepare(RELEASE_SQL).bind(h.before, h.id, now.toISOString())),
    ...failed.flatMap((id) => recordStatements(env, id, "failed", now, dataDate)),
  ]);
}

// The stop link's secret, made with the view's first message.
async function stopSecret(env: Env, id: string): Promise<string | null> {
  const db = env.ACCOUNTS!;
  const [, read] = await db.batch([
    db.prepare("UPDATE saved_views SET secret = ? WHERE id = ? AND secret IS NULL").bind(randomHex(16), id),
    db.prepare("SELECT secret FROM saved_views WHERE id = ?").bind(id),
  ]);
  return (read.results?.[0] as { secret?: string } | undefined)?.secret ?? null;
}

// What a grouped message needs after its claims, in one batch (one query):
// the stop secrets of its views that have none yet, made as stopSecret makes
// one (a view deleted while the run was going has none), and the account's
// mail language (users.lang), which a grouped message takes. The secrets
// are read by the primary key, at most an account's 50.
export const GROUP_SECRETS_SQL = "SELECT id, secret FROM saved_views WHERE id IN (SELECT value FROM json_each(?))";

async function groupSecrets(env: Env, userId: string, ids: readonly string[]): Promise<{ secrets: Map<string, string>; lang: Lang }> {
  const db = env.ACCOUNTS!;
  const results = await db.batch([
    ...ids.map((id) => db.prepare("UPDATE saved_views SET secret = ? WHERE id = ? AND secret IS NULL").bind(randomHex(16), id)),
    ...(ids.length ? [db.prepare(GROUP_SECRETS_SQL).bind(JSON.stringify(ids))] : []),
    db.prepare(ACCOUNT_LANG_SQL).bind(userId),
  ]);
  const rows = (ids.length ? results[results.length - 2]?.results ?? [] : []) as { id: string; secret: string | null }[];
  const lang = (results[results.length - 1]?.results?.[0] as { lang?: string } | undefined)?.lang === "fr" ? "fr" : "en";
  return { secrets: new Map(rows.filter((r) => r.secret).map((r) => [r.id, r.secret!])), lang };
}

// room: the messages the run may still send (the cap less what the four parts
// before it sent or tried). stop: why the run stopped early. report null: the
// part did not run, Ultra not being on sale; without the tables it runs no
// further than saying so (records "no_table"). queries: the run's count
// (deliveries.ts QueryCount); tally: what the run left due, which this part
// adds to on every way out; ceiling: what the day's ceiling still allows
// (deliveries.ts Ceiling); report: the report to fill, the caller's, so a
// fault keeps what was sent before it (deliveries.ts partFault); a part run
// alone makes its own.
//
// Grouping, as the saved searches and the briefings group: an account with
// more than GROUP_OVER views due in the list is taken up whole where its first
// one stands, each read before any is sent; when more than GROUP_OVER of them
// have new figures (passed over, unreadable and unchanged ones out), they go
// as one message (digests.ts viewGroupDigest, sendGroup below), weekly and
// monthly together, counted once against the cap, the day's ceiling and the
// run log, each view keeping its own claim, its own run row and its own hash.
// Every other account's views go in the list's order, one message each,
// exactly as before grouping.
export async function runViewMail(
  env: Env,
  o: {
    site: string; dataDate: string; now: Date; plans: Map<string, Plan>; room: number; capText: string; queries?: QueryCount; tally?: Tally;
    ceiling?: Ceiling;
    // The run's groups and their counts (pool.ts RunPool); a part run alone keeps its own.
    pool?: RunPool;
    report?: ViewReport;
  },
): Promise<{ report: ViewReport | null; stop: string | null; capped: boolean }> {
  if (!(await ultraOnSale(env).catch(() => false))) return { report: null, stop: null, capped: false };
  const { site, dataDate, now } = o;
  const pool = o.pool ?? new RunPool();
  const report = o.report ?? emptyViewReport();
  const week = weekAnchor(dataDate);
  const month = monthAnchor(dataDate);
  let due: DueRow[];
  try {
    due = (await env.ACCOUNTS!.prepare(VIEWS_DUE_SQL).bind(week, month, VIEWS_RUN_MAX).all<DueRow>()).results ?? [];
    await env.ACCOUNTS!.prepare("DELETE FROM view_deliveries WHERE sent_at < ?")
      .bind(new Date(now.getTime() - VIEW_DELIVERY_DAYS * 86_400_000).toISOString()).run();
  } catch (e) {
    if (!missingViews(e)) throw e;
    report.records = "no_table";
    return { report, stop: null, capped: false };
  }
  const current = fiscalYearOf(dataDate);
  // Two views of one address and plan read the records database once.
  const reads = new Map<string, Awaited<ReturnType<typeof readRecords>>>();
  let stop: string | null = null;
  let capped = false;
  // The claims this run holds and has not yet recorded or given back: a fault in between gives them back.
  let held: { id: string; before: string | null }[] = [];
  const unhold = (id: string) => {
    held = held.filter((h) => h.id !== id);
  };
  const passed: { id: string; anchor: string }[] = [];
  // Past the run's query budget (deliveries.ts QueryCount), nothing more is taken up; the next hour goes on.
  const pause = (claiming = false): boolean => {
    const why = budgetStop(o.queries, claiming);
    if (why) {
      stop = why;
      capped = true;
    }
    return why !== null;
  };
  const dueOn = (r: DueRow) => viewDue(r.deliver, r.last_delivered_at, dataDate);
  // The due views of each account in the list, and the rows an account taken up whole has dealt with (handled), so
  // the list's later rows of it are passed by and what the part leaves due counts them only while they wait.
  const perAccount = new Map<string, number>();
  for (const r of due) if (dueOn(r)) perAccount.set(r.user_id, (perAccount.get(r.user_id) ?? 0) + 1);
  const taken = new Set<string>();
  const handled = new Set<string>();
  const left = (from: number) => due.slice(from).filter((r) => !handled.has(r.id)).length;

  // A view read for its message: its address at the surviving id, its frame, the rows its figures come from (kept, so
  // a grouped message names the other party in its own language), its figures in the view's language and their hash.
  type Readied = {
    row: DueRow; kind: View; address: string; frame: Frame; anchor: string; cadence: ViewCadence; rows: [Row[], Row[]];
    figures: { years: ViewYear[]; largest: ViewRecord[] }; hash: string;
  };
  type Step = { go: "next" } | { go: "stop" } | { go: "send"; item: Readied };
  // One view read: its plan, its place within the figure, its records, its hash; an unchanged one's row written.
  // "stop" when the part must stop (the budget, or the records database not ready: every view from `from` on waits).
  const readOne = async (row: DueRow, from: number): Promise<Step> => {
    if (!dueOn(row)) return { go: "next" };
    if (pause()) return { go: "stop" };
    const cadence = row.deliver as ViewCadence;
    const plan = await pool.plan(env, o.plans, { id: row.user_id, plan: row.plan, plan_until: row.plan_until }, now);
    // In a group, past the account's allowance of the subscription's figure (pool.ts).
    if (!allowed({ plan }, "view_mail") || (row.n_before ?? 0) >= (await pool.allowance(env, row.user_id, "views", savedViewCap(plan)))) {
      report.skipped++;
      passed.push({ id: row.id, anchor: anchorOf(cadence, dataDate) });
      return { go: "next" };
    }
    const address = (await survivingAddress(env, row.address)) ?? row.address;
    const v = viewOf(address);
    const frame = v ? viewFrame(v.kind, v.url, current, planYears(plan)) : null;
    const queries = v && frame ? viewQueries(v.kind, v.id, frame) : null;
    // An address no view reads any more is passed over, as a search whose page no longer reads is.
    if (!v || !frame || !queries) return { go: "next" };
    const key = `${address}\n${frame.first}\n${frame.last}`;
    let read = reads.get(key);
    if (!read) {
      read = await readRecords(env, queries);
      reads.set(key, read);
    }
    if (read.state !== "ready" || read.asOf !== dataDate) {
      report.records = read.state === "ready" ? "stale" : read.state;
      report.waiting += left(from);
      return { go: "stop" };
    }
    const lang: Lang = row.lang === "fr" ? "fr" : "en";
    const rows: [Row[], Row[]] = [read.rows[0] ?? [], read.rows[1] ?? []];
    const figures = viewFigures(v.kind, lang, rows[0], rows[1]);
    const hash = await figuresHash(frame, figures);
    const anchor = anchorOf(cadence, dataDate);
    if (hash === row.last_hash) {
      if (pause(true)) return { go: "stop" };
      if (!(await claim(env, row.id, anchor, now))) return { go: "next" };
      held = [{ id: row.id, before: row.last_delivered_at }];
      await record(env, row.id, "same", now, dataDate);
      held = [];
      report.same++;
      return { go: "next" };
    }
    return { go: "send", item: { row, kind: v.kind, address, frame, anchor, cadence, rows, figures, hash } };
  };

  // Whether the part may take up one more message: under the room, under the day's ceiling, with the queries for a
  // claim and its writes left.
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

  // A view's own message, its claim held by this run and its stop secret known: sent and recorded, or its claim given
  // back. Counted before the writes after it, so a fault there cannot take it out of the run's count.
  const sendClaimed = async (x: Readied, secret: string): Promise<"next" | "stop"> => {
    const { row, frame } = x;
    const lang: Lang = row.lang === "fr" ? "fr" : "en";
    const message = viewDigest({
      lang, to: row.email, site, stopUrl: siteLink(site, `/account/stop?v=${row.id}&t=${secret}`, lang), cadence: x.cadence, name: row.name,
      address: x.address, csv: viewCsv(x.kind, x.address), source: frame.source, first: frame.first, last: frame.last, current, dataDate, ...x.figures,
    });
    const result = await sendWithHeaders(env, site, message);
    if (result.sent) {
      unhold(row.id);
      report.sent++;
      // The hash with its row, tried once more on a fault, so an unchanged view does not send again.
      await afterSend(() => record(env, row.id, "sent", now, dataDate, x.hash));
      return "next";
    }
    if (result.code && STOP_CODES.has(result.code)) {
      await release(env, row.id, row.last_delivered_at, now);
      unhold(row.id);
      stop = result.code;
      return "stop";
    }
    report.failed++;
    await release(env, row.id, row.last_delivered_at, now);
    unhold(row.id);
    await record(env, row.id, "failed", now, dataDate);
    return "next";
  };

  // A view's own message, as before grouping: taken up, claimed, its secret made with the first message.
  const sendOne = async (x: Readied): Promise<"next" | "stop"> => {
    const { row } = x;
    if (!mayTakeUp()) return "stop";
    if (!(await claim(env, row.id, x.anchor, now))) return "next";
    held = [{ id: row.id, before: row.last_delivered_at }];
    const secret = row.secret ?? (await stopSecret(env, row.id));
    if (!secret) {
      await release(env, row.id, row.last_delivered_at, now);
      held = [];
      return "next";
    }
    return sendClaimed(x, secret);
  };

  // More than GROUP_OVER of an account's views with new figures: one message, one against the room and the day's
  // ceiling, all or nothing, as deliveries.ts sendGroup sends an account's saved searches. Each view keeps its own
  // claim (one batch), its own run row and hash (one batch after the send); a send that does not go gives every claim
  // back together. At most GROUP_QUERIES queries from the claims on (the claims, the secrets and the account's
  // language, the rows and their one retry), inside what mayTakeUp holds back. When the claims leave GROUP_OVER or
  // fewer (a stop link clicked since the list was read), each goes as its own message, the second and later each held
  // to mayTakeUp again.
  const sendGroup = async (items: Readied[]): Promise<"next" | "stop"> => {
    if (!mayTakeUp()) return "stop";
    const claimed = await claimAll(env, items.map((x) => ({ id: x.row.id, anchor: x.anchor })), now);
    const members = items.filter((_, k) => claimed[k]);
    for (const x of items) if (!members.includes(x)) handled.add(x.row.id);
    if (!members.length) return "next";
    held = members.map((x) => ({ id: x.row.id, before: x.row.last_delivered_at }));
    const userId = members[0].row.user_id;
    const made = await groupSecrets(env, userId, members.filter((x) => !x.row.secret).map((x) => x.row.id));
    const secretOf = (x: Readied) => x.row.secret ?? made.secrets.get(x.row.id) ?? null;
    // A view deleted while the run was going has no secret any more, and its claim went with its row.
    const kept = members.filter((x) => secretOf(x));
    for (const x of members) if (!kept.includes(x)) handled.add(x.row.id);
    held = held.filter((h) => kept.some((x) => x.row.id === h.id));
    if (!kept.length) return "next";
    if (kept.length <= GROUP_OVER) {
      for (const [k, x] of kept.entries()) {
        // The first was taken up with the group (mayTakeUp above); each later one is a message of its own.
        const went = k > 0 && !mayTakeUp() ? "stop" : await sendClaimed(x, secretOf(x)!);
        if (went === "stop") {
          if (held.length) await releaseAll(env, held, now, dataDate);
          held = [];
          return "stop";
        }
        handled.add(x.row.id);
      }
      return "next";
    }
    const lang = made.lang;
    const sections = kept.map((x) => ({
      name: x.row.name, address: x.address, stopUrl: siteLink(site, `/account/stop?v=${x.row.id}&t=${secretOf(x)}`, lang),
      source: x.frame.source, first: x.frame.first, last: x.frame.last,
      // The other party of each record in the message's language; the hash, made of none of it, is the view's own.
      ...viewFigures(x.kind, lang, x.rows[0], x.rows[1]),
    }));
    const stopUrl = siteLink(site, await groupStopPath(userId, kept.map((x) => ({ id: x.row.id, secret: secretOf(x)! })), "views"), lang);
    const message = viewGroupDigest({ lang, to: kept[0].row.email, site, dataDate, current, stopUrl, sections, over: GROUP_OVER });
    const result = await sendWithHeaders(env, site, message);
    if (result.sent) {
      // Sent: the claims stand, whatever happens to the rows that record them, and the message is counted first.
      held = [];
      for (const x of kept) handled.add(x.row.id);
      report.sent++;
      report.groups++;
      report.grouped += kept.length;
      await afterSend(() => env.ACCOUNTS!.batch(kept.flatMap((x) => recordStatements(env, x.row.id, "sent", now, dataDate, x.hash))));
      return "next";
    }
    if (result.code && STOP_CODES.has(result.code)) {
      await releaseAll(env, held, now, dataDate);
      held = [];
      stop = result.code;
      return "stop";
    }
    report.failed++;
    await releaseAll(env, held, now, dataDate, kept.map((x) => x.row.id));
    held = [];
    for (const x of kept) handled.add(x.row.id);
    return "next";
  };

  // An account taken up whole (more than GROUP_OVER of its views due): each read in the list's order, then grouped
  // or sent one by one. `from` is where its first one stands.
  const takeAccount = async (userId: string, from: number): Promise<"next" | "stop"> => {
    const rows = due.slice(from).filter((r) => r.user_id === userId);
    const items: Readied[] = [];
    for (const r of rows) {
      taken.add(r.id);
      const step = await readOne(r, from);
      if (step.go === "stop") return "stop";
      if (step.go === "send") items.push(step.item);
      else handled.add(r.id);
    }
    if (items.length > GROUP_OVER) return sendGroup(items);
    for (const x of items) {
      if ((await sendOne(x)) === "stop") return "stop";
      handled.add(x.row.id);
    }
    return "next";
  };

  let i = 0;
  try {
    for (; i < due.length; i++) {
      const row = due[i];
      if (taken.has(row.id)) continue;
      if ((perAccount.get(row.user_id) ?? 0) > GROUP_OVER) {
        if ((await takeAccount(row.user_id, i)) === "stop") break;
        continue;
      }
      const step = await readOne(row, i);
      if (step.go === "stop") break;
      if (step.go === "next") continue;
      if ((await sendOne(step.item)) === "stop") break;
    }
    await passedOver(env, passed, now);
  } catch (e) {
    if (held.length === 1) await release(env, held[0].id, held[0].before, now).catch(() => undefined);
    else if (held.length) await releaseAll(env, held, now, dataDate).catch(() => undefined);
    throw e;
  } finally {
    // From the view in hand on (a wait, a stop or a fault), those due whose plan would send them; an account taken up
    // whole counts its own that it has not dealt with.
    if (o.tally) {
      o.tally.left += unfinished(due, i, (r) => !handled.has(r.id) && dueOn(r) && likelyServed(o.plans, r.user_id, r.plan, "view_mail"));
    }
  }
  return { report, stop, capped };
}

export const VIEW_WAIT_WHY: Record<ViewWait, string> = {
  absent: "the records database is not bound",
  loading: "the records database is loading",
  failed: "the records database could not be read",
  stale: "the records database is not at today's data date",
  no_table: "the accounts database has no saved_views table (apply accounts_schema.sql)",
};

export const viewActive = (r: ViewReport) => r.sent + r.failed + r.same + r.skipped + r.waiting > 0 || r.records !== null;

export const viewCounts = (r: ViewReport) =>
  `saved views: ${r.sent} sent${r.groups ? ` (${r.groups} of them grouped, carrying ${r.grouped} views)` : ""}, ${r.failed} failed, ` +
  `${r.same} unchanged, ${r.skipped} not on a plan with their email` +
  (r.records ? `, ${r.waiting} waiting: ${VIEW_WAIT_WHY[r.records]}` : "");
