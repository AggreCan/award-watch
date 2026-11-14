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
// the surviving id (saved_views.ts survivingAddress), as its page reads it.
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
import { STOP_CODES, sendWithHeaders } from "./deliveries";
import { type ViewRecord, type ViewYear, VIEW_MAIL_ROWS, siteLink, viewDigest } from "./digests";
import { allowed, planFor, savedViewCap, type Plan } from "./entitlements";
import { ultraOnSale } from "./payments";
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
  // Due views whose figures had not changed: no message.
  same: number;
  // Due views whose owner's plan does not send them (no view_mail, or past its figure).
  skipped: number;
  // Views left for a later run, and why; records is null when none waited.
  waiting: number;
  records: ViewWait | null;
}

export const emptyViewReport = (): ViewReport => ({ sent: 0, failed: 0, same: 0, skipped: 0, waiting: 0, records: null });

// The views that can be due on the data date, oldest first (?1 the week's
// anchor, ?2 the month's, ?3 the cap): weekly or monthly, an active account
// that is not blocked, not covered since its cadence's anchor, and no message
// refused for it since then. n_before counts the account's views made before
// it: past the plan's figure, after a move to a smaller plan, only the first
// ones by creation date are sent.
export const VIEWS_DUE_SQL =
  "SELECT v.id, v.user_id, v.kind, v.address, v.name, v.lang, v.deliver, v.last_delivered_at, v.last_hash, v.secret, u.email, u.plan, u.plan_until, " +
  "(SELECT COUNT(*) FROM saved_views x WHERE x.user_id = v.user_id AND (x.created_at < v.created_at OR (x.created_at = v.created_at AND x.id < v.id))) AS n_before " +
  "FROM saved_views v JOIN users u ON u.id = v.user_id WHERE v.deliver IN ('weekly', 'monthly') AND u.status = 'active' " +
  "AND (v.last_delivered_at IS NULL OR substr(v.last_delivered_at, 1, 10) < (CASE v.deliver WHEN 'weekly' THEN ?1 ELSE ?2 END)) " +
  "AND NOT EXISTS (SELECT 1 FROM view_deliveries d WHERE d.view_id = v.id AND d.status = 'failed' AND d.sent_at >= (CASE v.deliver WHEN 'weekly' THEN ?1 ELSE ?2 END)) " +
  "AND NOT EXISTS (SELECT 1 FROM account_blocks x WHERE x.user_id = v.user_id) ORDER BY v.created_at, v.id LIMIT ?3";

type DueRow = {
  id: string; user_id: string; kind: string; address: string; name: string; lang: string; deliver: string; last_delivered_at: string | null;
  last_hash: string | null; secret: string | null; email: string; plan: string; plan_until: string | null; n_before: number;
};

// The view taken for its period by this run: one statement that holds only
// while no run has covered it since the anchor.
async function claim(env: Env, id: string, anchor: string, now: Date): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(
    "UPDATE saved_views SET last_delivered_at = ?1 WHERE id = ?2 AND deliver IN ('weekly', 'monthly') " +
    "AND (last_delivered_at IS NULL OR substr(last_delivered_at, 1, 10) < ?3)",
  ).bind(now.toISOString(), id, anchor).run();
  return (res.meta?.changes ?? 0) === 1;
}

// The claim given back, while it is this run's.
async function release(env: Env, id: string, before: string | null, now: Date): Promise<void> {
  await env.ACCOUNTS!.prepare("UPDATE saved_views SET last_delivered_at = ?1 WHERE id = ?2 AND last_delivered_at = ?3")
    .bind(before, id, now.toISOString()).run();
}

// One run row, written only while the view exists; a sent message keeps its hash beside it.
async function record(env: Env, id: string, status: "sent" | "failed" | "same", now: Date, dataDate: string, hash: string | null = null): Promise<void> {
  const db = env.ACCOUNTS!;
  const row = db.prepare(
    "INSERT INTO view_deliveries (view_id, sent_at, day, status) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM saved_views WHERE id = ?1)",
  ).bind(id, now.toISOString(), dataDate, status);
  if (status === "sent" && hash) await db.batch([row, db.prepare("UPDATE saved_views SET last_hash = ? WHERE id = ?").bind(hash, id)]);
  else await row.run();
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

// room: the messages the run may still send (the cap less what the four parts
// before it sent or tried). stop: why the run stopped early. report null: the
// part did not run, Ultra not being on sale; without the tables it runs no
// further than saying so (records "no_table").
export async function runViewMail(
  env: Env, o: { site: string; dataDate: string; now: Date; plans: Map<string, Plan>; room: number; capText: string },
): Promise<{ report: ViewReport | null; stop: string | null; capped: boolean }> {
  if (!(await ultraOnSale(env).catch(() => false))) return { report: null, stop: null, capped: false };
  const { site, dataDate, now } = o;
  const report = emptyViewReport();
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
  let held: { id: string; before: string | null } | null = null;
  try {
    for (const row of due) {
      if (!viewDue(row.deliver, row.last_delivered_at, dataDate)) continue;
      const cadence = row.deliver as ViewCadence;
      let plan = o.plans.get(row.user_id);
      if (!plan) {
        plan = (await planFor(env, { id: row.user_id, plan: row.plan, plan_until: row.plan_until }, now)).plan;
        o.plans.set(row.user_id, plan);
      }
      if (!allowed({ plan }, "view_mail") || (row.n_before ?? 0) >= savedViewCap(plan)) {
        report.skipped++;
        continue;
      }
      const address = (await survivingAddress(env, row.address)) ?? row.address;
      const v = viewOf(address);
      const frame = v ? viewFrame(v.kind, v.url, current, planYears(plan)) : null;
      const queries = v && frame ? viewQueries(v.kind, v.id, frame) : null;
      // An address no view reads any more is passed over, as a search whose page no longer reads is.
      if (!v || !frame || !queries) continue;
      const key = `${address}\n${frame.first}\n${frame.last}`;
      let read = reads.get(key);
      if (!read) {
        read = await readRecords(env, queries);
        reads.set(key, read);
      }
      if (read.state !== "ready" || read.asOf !== dataDate) {
        report.records = read.state === "ready" ? "stale" : read.state;
        report.waiting += due.length - due.indexOf(row);
        break;
      }
      const lang: Lang = row.lang === "fr" ? "fr" : "en";
      const figures = viewFigures(v.kind, lang, read.rows[0] ?? [], read.rows[1] ?? []);
      const hash = await figuresHash(frame, figures);
      const anchor = anchorOf(cadence, dataDate);
      if (hash === row.last_hash) {
        if (!(await claim(env, row.id, anchor, now))) continue;
        held = { id: row.id, before: row.last_delivered_at };
        await record(env, row.id, "same", now, dataDate);
        held = null;
        report.same++;
        continue;
      }
      if (report.sent + report.failed >= o.room) {
        stop = o.capText;
        capped = true;
        break;
      }
      if (!(await claim(env, row.id, anchor, now))) continue;
      held = { id: row.id, before: row.last_delivered_at };
      const secret = row.secret ?? (await stopSecret(env, row.id));
      if (!secret) {
        await release(env, row.id, row.last_delivered_at, now);
        held = null;
        continue;
      }
      const message = viewDigest({
        lang, to: row.email, site, stopUrl: siteLink(site, `/account/stop?v=${row.id}&t=${secret}`, lang), cadence, name: row.name, address,
        csv: viewCsv(v.kind, address), source: frame.source, first: frame.first, last: frame.last, current, dataDate, ...figures,
      });
      const result = await sendWithHeaders(env, site, message);
      if (result.sent) {
        held = null;
        await record(env, row.id, "sent", now, dataDate, hash);
        report.sent++;
      } else if (result.code && STOP_CODES.has(result.code)) {
        await release(env, row.id, row.last_delivered_at, now);
        held = null;
        stop = result.code;
        break;
      } else {
        await release(env, row.id, row.last_delivered_at, now);
        held = null;
        await record(env, row.id, "failed", now, dataDate);
        report.failed++;
      }
    }
  } catch (e) {
    if (held) await release(env, held.id, held.before, now).catch(() => undefined);
    throw e;
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
  `saved views: ${r.sent} sent, ${r.failed} failed, ${r.same} unchanged, ${r.skipped} not on a plan with their email` +
  (r.records ? `, ${r.waiting} waiting: ${VIEW_WAIT_WHY[r.records]}` : "");
