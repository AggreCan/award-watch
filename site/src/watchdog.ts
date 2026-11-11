import type { Env } from "./env";
import { LIVE_PRO_SQL } from "./account/entitlements";
import { loadStats } from "./data";
import { faultSummary } from "./search_db";

// A daily check, run by the cron trigger, that emails the operator when the
// site needs a hand: data that stopped refreshing, a backup that stopped
// arriving, a refresh whose stages failed, a search or records database sync
// or audience roll-up that failed, or a deploy the run rolled back because the site
// answered with server errors after it. The run's notices (a buyer spelling
// no seed maps, a source that refused the download) are information, not
// alerts: the email carries them in a section of their own, and a morning
// with notices and no alert still sends one, with a subject that says notices.
// Of the nightly it reads only what the run leaves behind (the stats file,
// the backup's timestamp, status.json in R2), so a run that never happened is
// caught as well as one that failed. Sending goes through Cloudflare's email
// binding to a destination verified in the zone's Email Routing; with no
// binding or no address the check still runs and only logs.
//
// A refund pressed on the billing page (src/account/refund.ts) whose
// subscription can still bill is an alert, one line per account, naming the
// account's id and the subscription's Stripe id and nothing else, until the
// subscription is cancelled (REFUNDS_TO_CANCEL_SQL below).
//
// The same-day refresh (docs/intraday.md) sends no email of its own: a
// failed cut is a row in intraday_runs, not a red workflow run, so this
// check is where it shows. It reads that table in the search database (one
// prepared statement) and, for the line that needs it, the count of live
// paid plans in the accounts database (another); a fault reading either
// never stops the check. From status.json it reads the refresh's two nightly
// steps (a failed one is a notice, as the nightly calls it) and the size of
// the buyer lookup the nightly saved.
//
// The day's figures (pipeline/awardwatch_pipeline/funnel.py): the nightly
// keeps one line for the last finished UTC day, the account funnel's counts
// and that day's audience figures, in R2 under the private views/ prefix
// (FIGURES_KEY), apart from status.json, whose text the run prints in its
// public log. On the night the monthly audience report is written, the line
// also carries the month's figures (funnel.with_month), so they reach the
// operator once, the morning after. The check adds the line to the email,
// and a morning with the line and nothing else still sends one, so the
// operator reads the figures each day without asking for them. A line too
// old to be the last night's, or of another shape, is left out; it is never
// an alert.

export const DATA_STALE_HOURS = 36;
// The backup is uploaded in parts of at most 250 MiB (the nightly pack); the
// first part goes up first, so its upload time is the backup's.
export const BACKUP_KEY = "awardwatch.sqlite.gz.000";
export const BACKUP_STALE_HOURS = 36;
const HOUR = 60 * 60 * 1000;

// The same-day refresh's last run of the day is at 03:45 UTC, 2 h 15 before
// this check: a newest run that went through more than 4 hours back means
// that run did not.
export const INTRADAY_STALE_HOURS = 4;
// Failed runs are counted over the day before the check: nine scheduled runs.
export const INTRADAY_WINDOW_HOURS = 24;
// The buyer lookup the nightly saves for the same-day refresh, gzipped. It was
// 58,773 bytes on 2026-11-03; each run of the refresh downloads and parses
// it, so past this bound the lookup should keep only recent spellings
// (docs/intraday.md).
export const LOOKUP_MAX_BYTES = 2_000_000;

// The day's figures. The nightly at 12:30 UTC writes the line for the day
// before, and this check at 06:00 reads it the morning after, two calendar
// days after the line's date; a manual run after midnight makes it one. An
// older line means the nightly did not write one since.
export const FIGURES_KEY = "views/funnel_line.txt";
export const FIGURES_MAX_DAYS = 2;
// funnel.line (funnel.with_month on a report night): the date, " (UTC): ",
// then printable ASCII on one line. funnel.FIGURES_PATTERN is the same text,
// and a pipeline test (test_funnel.py) holds the two together.
const FIGURES_RE = /^(\d{4}-\d{2}-\d{2}) \(UTC\): [ -~]{1,600}$/;

// The same-day refresh's runs in one statement over intraday_runs
// (pipeline/intraday_schema.sql): the time of the newest run that went
// through, of any age (the table keeps 30 days of runs), so a line can name
// it after a day of failures; and over the 24 hours from ?1, the runs
// recorded, those with ok 0, and the new versions the others wrote. A run
// whose state read failed leaves no row: it shows only as time passing
// without a run that went through.
export const INTRADAY_RUNS_SQL =
  "SELECT (SELECT MAX(at) FROM intraday_runs WHERE ok = 1) AS last_ok, COUNT(*) AS runs, " +
  "COALESCE(SUM(ok = 0), 0) AS failed, COALESCE(SUM(CASE WHEN ok = 1 THEN rows_new ELSE 0 END), 0) AS rows_new " +
  "FROM intraday_runs WHERE at >= ?1";

export type IntradayRuns = {
  lastOk: string | null; // newest run that went through (intraday_runs.at), or null for none
  runs: number; // runs recorded in the window
  failed: number; // of them, ok 0
  rowsNew: number; // new versions written by the ones that went through
};

// Refunds pressed on the billing page whose subscription can still bill, in
// one statement over the accounts database: a press that took the refund and
// could not cancel (refund_cancel_failed), or a press followed by a full
// refund of the customer's charge in payment_reversals, which is how a
// refund whose answer never reached the site reads once Stripe's notice
// arrives. Both audit rows name the subscription in their detail; an item
// stands while payment_customers still binds that subscription to the
// account with a status that bills, so cancelling it (the console, Stripe's
// dashboard and its notice) clears it. Over the audit's 90 days from ?1, at
// most REFUND_ITEMS_MAX, as "<user id> <subscription id>" joined by commas.
export const REFUND_ITEMS_MAX = 20;
export const REFUNDS_TO_CANCEL_SQL =
  "SELECT group_concat(item, ',') AS items FROM (SELECT DISTINCT a.user_id || ' ' || p.subscription_id AS item " +
  "FROM audit a JOIN payment_customers p ON p.user_id = a.user_id AND p.subscription_id = a.detail " +
  "WHERE a.event IN ('refund_cancel_failed', 'refund_requested') AND a.at >= ?1 " +
  "AND (p.status IS NULL OR p.status NOT IN ('canceled', 'incomplete_expired')) " +
  "AND (a.event = 'refund_cancel_failed' OR EXISTS (SELECT 1 FROM payment_reversals r " +
  "WHERE r.customer_id = p.customer_id AND r.why = 'refunded' AND r.at >= a.at)) " +
  `ORDER BY item LIMIT ${REFUND_ITEMS_MAX})`;
export const REFUND_LOOKBACK_DAYS = 90;

export type RefundToCancel = { userId: string; subscriptionId: string };

export type RunStatus = {
  run_at?: string;
  ok?: boolean;
  search_sync?: string;
  // The records database's sync, which the analytics views read ("synced",
  // "nothing to send", "failed", "no database", "not run").
  records_sync?: string;
  views_rollup?: string;
  search_console?: string;
  views_report?: string;
  // The same-day refresh's two nightly steps ("saved" or "pruned", "failed",
  // "not run") and the size in bytes of the lookup the night saved.
  intraday_lookup?: string;
  intraday_prune?: string;
  intraday_lookup_bytes?: number;
  deploy_rolled_back?: boolean;
  stages?: { source: string; ok: boolean; detail?: string }[];
  // Information from the run that is not a failure (status.json "notices"); never an alert.
  notices?: { source: string; detail: string }[];
};

export type Inputs = {
  now: Date;
  dataAsOf: string | null; // YYYY-MM-DD from stats.json, or null when missing
  backupUploaded: Date | null; // upload time of the backup's first part in R2
  status: RunStatus | null; // status.json from R2
  statusProblem?: string | null; // why status.json could not be read in full
  // The same-day refresh's runs, or null when they were not read
  // (intradayProblem then says why).
  intraday?: IntradayRuns | null;
  intradayProblem?: string | null;
  // Live pro entitlements (LIVE_PRO_SQL), or null when not counted (no
  // ACCOUNTS binding, or a fault). The 4-hour line needs a count above zero.
  livePro?: number | null;
  // Refunds whose subscription can still bill (REFUNDS_TO_CANCEL_SQL), or
  // null when not read (no ACCOUNTS binding, or a fault).
  refundsToCancel?: RefundToCancel[] | null;
  // The last finished day's figures (readFigures), or null when there is no current line.
  figures?: string | null;
};

const count = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

// status.json is written by the workflow, so its shape is checked here rather
// than trusted: a field of the wrong type must produce an alert, never an
// exception that stops the check from sending anything. A stage entry that
// cannot be read counts as a failed stage.
export function readStatus(raw: unknown): { status: RunStatus | null; problem: string | null } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: null, problem: "The run status (status.json) in R2 is not a JSON object." };
  }
  const r = raw as Record<string, unknown>;
  const unreadable: string[] = [];
  const status: RunStatus = {};
  if (typeof r.run_at === "string" && !Number.isNaN(Date.parse(r.run_at))) status.run_at = r.run_at;
  else unreadable.push("run_at");
  if (typeof r.ok === "boolean") status.ok = r.ok;
  if (typeof r.search_sync === "string") status.search_sync = r.search_sync;
  if (typeof r.records_sync === "string") status.records_sync = r.records_sync;
  if (typeof r.views_rollup === "string") status.views_rollup = r.views_rollup;
  if (typeof r.search_console === "string") status.search_console = r.search_console;
  if (typeof r.views_report === "string") status.views_report = r.views_report;
  if (typeof r.intraday_lookup === "string") status.intraday_lookup = r.intraday_lookup;
  if (typeof r.intraday_prune === "string") status.intraday_prune = r.intraday_prune;
  // A size that is not a whole number of bytes is dropped, never alerted on:
  // intraday_lookup already says whether the lookup was saved.
  const bytes = count(r.intraday_lookup_bytes);
  if (bytes !== null) status.intraday_lookup_bytes = bytes;
  // Only a real true counts: a rollback alert from a field of the wrong type
  // would send the operator after a deploy that never happened.
  if (typeof r.deploy_rolled_back === "boolean") status.deploy_rolled_back = r.deploy_rolled_back;
  if (Array.isArray(r.stages)) {
    status.stages = r.stages.map((s) => {
      if (!s || typeof s !== "object") return { source: "unknown", ok: false, detail: "unreadable stage entry" };
      const e = s as Record<string, unknown>;
      return {
        source: typeof e.source === "string" ? e.source : "unknown",
        ok: e.ok === true,
        detail: typeof e.detail === "string" ? e.detail : undefined,
      };
    });
  } else if (r.stages !== undefined) {
    unreadable.push("stages");
  }
  // A notice that cannot be read is dropped rather than alerted on: it is
  // advice, and the stages above already alert on anything that failed.
  if (Array.isArray(r.notices)) {
    status.notices = r.notices.flatMap((n) => {
      if (!n || typeof n !== "object") return [];
      const e = n as Record<string, unknown>;
      return typeof e.detail === "string" && e.detail ? [{ source: typeof e.source === "string" ? e.source : "notice", detail: e.detail }] : [];
    });
  }
  const problem = unreadable.length
    ? `The run status (status.json) in R2 has unreadable fields (${unreadable.join(", ")}).`
    : null;
  return { status, problem };
}

const RUN_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// The row INTRADAY_RUNS_SQL answers, checked like status.json: null when any
// field does not read, which the check reports as runs it could not read.
export function readIntradayRuns(row: unknown): IntradayRuns | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const runs = count(r.runs);
  const failed = count(r.failed);
  const rowsNew = count(r.rows_new);
  const lastOk = r.last_ok === null ? null : typeof r.last_ok === "string" && RUN_AT_RE.test(r.last_ok) ? r.last_ok : undefined;
  if (runs === null || failed === null || rowsNew === null || lastOk === undefined || failed > runs) return null;
  return { lastOk, runs, failed, rowsNew };
}

const grouped = (n: number) => n.toLocaleString("en-US");

// The figures line as the nightly wrote it, or null when it is not one line
// of that shape or not from the last night or the one before (by its date
// against the check's UTC day).
export function readFigures(text: unknown, now: Date): string | null {
  if (typeof text !== "string") return null;
  const line = text.trim();
  const m = FIGURES_RE.exec(line);
  if (!m) return null;
  const days = (Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${m[1]}T00:00:00Z`)) / (24 * HOUR);
  return days >= 1 && days <= FIGURES_MAX_DAYS ? line : null;
}

export function collectAlerts(i: Inputs): string[] {
  const out: string[] = [];
  if (!i.dataAsOf) {
    out.push("The site has no data file (stats.json is missing): the pages show Data Not Published Yet.");
  } else {
    const age = (i.now.getTime() - Date.parse(`${i.dataAsOf}T00:00:00Z`)) / HOUR;
    if (Number.isNaN(age)) {
      out.push(`The data date in stats.json (${String(i.dataAsOf).slice(0, 40)}) is not a date.`);
    } else if (age > DATA_STALE_HOURS + 24) {
      out.push(`The data is dated ${i.dataAsOf}, ${Math.floor(age / 24)} days old: the nightly refresh has not published since.`);
    }
  }
  if (i.statusProblem) out.push(i.statusProblem);
  if (!i.backupUploaded) {
    out.push(`No database backup (${BACKUP_KEY}) is in R2.`);
  } else if ((i.now.getTime() - i.backupUploaded.getTime()) / HOUR > BACKUP_STALE_HOURS) {
    out.push(`The database backup in R2 was last saved ${i.backupUploaded.toISOString().slice(0, 16)} UTC, more than ${BACKUP_STALE_HOURS} hours ago.`);
  }
  if (!i.status) {
    out.push("No run status (status.json) is in R2: the nightly workflow has not completed a run with the current version.");
  } else {
    if (i.status.run_at && (i.now.getTime() - Date.parse(i.status.run_at)) / HOUR > DATA_STALE_HOURS) {
      out.push(`The last completed run was ${i.status.run_at.slice(0, 16)} UTC.`);
    }
    for (const s of i.status.stages ?? []) {
      if (!s.ok) out.push(`Stage "${s.source}" failed in the last run${s.detail ? `: ${s.detail.slice(0, 160)}` : ""}.`);
    }
    if (i.status.search_sync === "failed") {
      out.push("The search database sync failed. The next run sends the same changes again; check the run log.");
    }
    // "no database" is the nightly's notice, carried with the others; only a
    // failure is an alert, as in the run's attention issue.
    if (i.status.records_sync === "failed") {
      out.push("The records database sync failed. The analytics views answer from what the database holds (or say it is being loaded) and the next run sends the same changes again; check the run log.");
    }
    if (i.status.views_rollup === "failed") {
      out.push("The audience roll-up failed. The next run catches up; check the CLOUDFLARE_ANALYTICS_TOKEN secret and the run log.");
    }
    if (i.status.search_console === "failed") {
      out.push("The Search Console import failed. The next run catches up; check the GSC_SERVICE_ACCOUNT_JSON secret and the run log.");
    }
    if (i.status.views_report === "failed") {
      out.push("The monthly audience report was not written. The next run tries again; check the run log.");
    }
    if (i.status.deploy_rolled_back === true) {
      out.push("The site answered with server errors after the last deploy, so the run rolled the Worker back to the version before it. The site shows the previous data until a later run deploys again; check the run log.");
    }
    const bytes = i.status.intraday_lookup_bytes;
    if (bytes !== undefined && bytes > LOOKUP_MAX_BYTES) {
      out.push(`The buyer lookup for the same-day refresh is ${grouped(bytes)} bytes, over the ${grouped(LOOKUP_MAX_BYTES)}-byte bound; every run of the refresh downloads and parses it. Keep only the spellings seen in the last 24 months (docs/intraday.md).`);
    }
  }
  out.push(...intradayAlerts(i));
  for (const r of i.refundsToCancel ?? []) {
    out.push(`A refund of a first payment pressed on the billing page went through, but its subscription can still bill: account ${r.userId}, subscription ${r.subscriptionId}. Cancel it at once in the operator console (the account's page, Cancel the subscription, At once) or in Stripe's dashboard.`);
  }
  return out;
}

const USER_RE = /^[0-9a-f]{32}$/;
const SUBSCRIPTION_RE = /^sub_[A-Za-z0-9]{1,100}$/;

// The row REFUNDS_TO_CANCEL_SQL answers: its items, each an account id and a
// subscription id in their own shapes; anything else in the text is dropped.
export function readRefundsToCancel(row: unknown): RefundToCancel[] {
  const items = row && typeof row === "object" ? (row as Record<string, unknown>).items : null;
  if (typeof items !== "string") return [];
  return items.split(",").flatMap((item) => {
    const [userId, subscriptionId, rest] = item.split(" ");
    return rest === undefined && USER_RE.test(userId ?? "") && SUBSCRIPTION_RE.test(subscriptionId ?? "") ? [{ userId, subscriptionId }] : [];
  });
}

// The same-day refresh's lines. Runs that cannot be read are one line and
// nothing more. The 4-hour line only while a paid plan is live: the
// workflow's gate stops the runs when none is, and then no run going
// through is the plan working, not a fault.
function intradayAlerts(i: Inputs): string[] {
  if (i.intradayProblem) return [i.intradayProblem];
  const r = i.intraday;
  if (!r) return [];
  const out: string[] = [];
  if ((i.livePro ?? 0) > 0) {
    if (!r.lastOk) {
      out.push("No same-day refresh has gone through while a paid plan is live: the search database holds no run that did. Check the intraday workflow's runs.");
    } else if ((i.now.getTime() - Date.parse(r.lastOk)) / HOUR > INTRADAY_STALE_HOURS) {
      out.push(`No same-day refresh has gone through since ${r.lastOk.slice(0, 16)} UTC, more than ${INTRADAY_STALE_HOURS} hours before this check, while a paid plan is live. Check the intraday workflow's runs.`);
    }
  }
  if (r.failed > 0) {
    const through = r.runs - r.failed;
    const rest = through === 0
      ? "none went through"
      : `${through === 1 ? "the one" : `the ${through}`} that went through wrote ${plural(r.rowsNew, "new notice version")}`;
    out.push(`${r.failed} of ${r.runs} same-day ${r.runs === 1 ? "refresh" : "refreshes"} failed since yesterday; ${rest}. A later run writes the day's notices again; intraday_runs.detail names the step that failed.`);
  }
  return out;
}

// A government notice carries its full title and link, so a notice may be long.
export const NOTICE_CHARS = 1200;

// The same-day refresh's two nightly steps. The nightly calls a failed one a
// notice (neither changes what the site publishes) and lists it among the
// run's notices in these words. The line is made here from the step's own
// field, so it shows even from a status whose notices lack it, and the
// nightly's notice of the same source is left out, so it is said once.
export const INTRADAY_STEP_NOTICES = {
  intraday_lookup: "the buyer lookup for the same-day refresh was not saved; the intraday job keeps the one R2 has",
  intraday_prune: "the same-day notices older than two days were not pruned; the next run prunes them",
} as const;
type IntradayStep = keyof typeof INTRADAY_STEP_NOTICES;
const INTRADAY_STEPS = Object.keys(INTRADAY_STEP_NOTICES) as IntradayStep[];

// The last run's notices, one line each. Only from a run recent enough to be
// the last night's: an older status is an alert of its own, and its notices
// went out the morning after it.
export function collectNotices(i: Inputs): string[] {
  const runAt = i.status?.run_at;
  if (!runAt) return [];
  const age = (i.now.getTime() - Date.parse(runAt)) / HOUR;
  if (!(age >= 0 && age <= DATA_STALE_HOURS)) return [];
  const failed = INTRADAY_STEPS.filter((k) => i.status?.[k] === "failed");
  const said = new Set<string>(failed);
  return [
    ...(i.status?.notices ?? []).filter((n) => !said.has(n.source)).map((n) => `${n.source}: ${n.detail.slice(0, NOTICE_CHARS)}`),
    ...failed.map((k) => `${k}: ${INTRADAY_STEP_NOTICES[k]}`),
  ];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The run log and site addresses come from the Worker's variables (RUN_LOG_URL,
// SITE_URL), so the repository names neither; a line whose variable is unset
// is left out.
export function buildEmail(
  from: string, to: string, alerts: string[], now: Date, notices: string[] = [],
  links: { runLog?: string; site?: string } = {}, figures: string | null = null,
): string {
  const subject = alerts.length
    ? `Award Watch: ${plural(alerts.length, "item")} need attention${notices.length ? `, ${plural(notices.length, "notice")}` : ""}`
    : notices.length || !figures
      ? `Award Watch: ${plural(notices.length, "notice")} from the last run`
      : `Award Watch: figures for ${figures.slice(0, 10)}`;
  const linkLines = [
    ...(links.runLog ? [`Run log: ${links.runLog}`] : []),
    ...(links.site ? [`Site: ${links.site}`] : []),
  ];
  const when = `Daily check at ${now.toISOString().slice(0, 16)} UTC`;
  const lines = [
    ...(alerts.length ? [`${when} found:`, "", ...alerts.map((a, n) => `${n + 1}. ${a}`)] : [`${when}: nothing needs attention.`]),
    ...(notices.length
      ? ["", "Notices from the last run (information; nothing failed):", "", ...notices.map((n) => `- ${n}`)]
      : []),
    // Kept in R2 under views/ and published nowhere.
    ...(figures ? ["", "The last finished day (private figures from the nightly run):", "", `- ${figures}`] : []),
    ...(linkLines.length ? ["", ...linkLines] : []),
    "",
    alerts.length
      ? "This message is sent by the site's own daily check; it repeats each day while an item remains."
      : figures
        ? "This message is sent by the site's own daily check each morning the nightly run has left the day's figures."
        : "This message is sent by the site's own daily check when the last run recorded notices.",
  ];
  return [
    `From: Award Watch <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${now.toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    ...lines,
  ].join("\r\n");
}

// An instant as intraday_runs writes its times (seconds and a Z), so the
// window's bound compares with them as text.
const runStamp = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

// The same-day refresh's runs, or the one line that says they could not be
// read. A missing binding is such a line too: the check would otherwise be
// blind without saying so.
async function readIntraday(env: Env, now: Date): Promise<{ intraday: IntradayRuns | null; intradayProblem: string | null }> {
  if (!env.SEARCH) {
    return { intraday: null, intradayProblem: "The same-day refresh runs could not be read: the Worker has no SEARCH binding." };
  }
  try {
    const since = runStamp(new Date(now.getTime() - INTRADAY_WINDOW_HOURS * HOUR));
    const intraday = readIntradayRuns(await env.SEARCH.prepare(INTRADAY_RUNS_SQL).bind(since).first());
    return intraday
      ? { intraday, intradayProblem: null }
      : { intraday: null, intradayProblem: "The same-day refresh runs could not be read: the search database's answer did not read." };
  } catch (e) {
    // By its code only, as the site logs every D1 fault (search_db.faultSummary).
    return { intraday: null, intradayProblem: `The same-day refresh runs could not be read from the search database (${faultSummary(e)}).` };
  }
}

// The live paid plans, or null: no binding or a fault means the 4-hour line
// is not checked, never a line of its own (the accounts may be switched off).
async function countLivePro(env: Env, now: Date): Promise<number | null> {
  if (!env.ACCOUNTS) return null;
  try {
    const row = await env.ACCOUNTS.prepare(LIVE_PRO_SQL).bind(now.toISOString()).first<Record<string, unknown>>();
    return count(row?.n);
  } catch (e) {
    console.log(`watchdog: live paid plans not counted (${faultSummary(e)})`);
    return null;
  }
}

// The refunds to cancel, or null: as with the paid plans, no binding or a
// fault is logged and never a line of its own (the accounts may be switched
// off, or the payment tables never applied).
async function readRefunds(env: Env, now: Date): Promise<RefundToCancel[] | null> {
  if (!env.ACCOUNTS) return null;
  try {
    const since = new Date(now.getTime() - REFUND_LOOKBACK_DAYS * 24 * HOUR).toISOString();
    return readRefundsToCancel(await env.ACCOUNTS.prepare(REFUNDS_TO_CANCEL_SQL).bind(since).first());
  } catch (e) {
    console.log(`watchdog: refunds to cancel not read (${faultSummary(e)})`);
    return null;
  }
}

export async function gatherInputs(env: Env, now: Date): Promise<Inputs> {
  const stats = await loadStats(env).catch(() => null);
  let backupUploaded: Date | null = null;
  let status: RunStatus | null = null;
  let figures: string | null = null;
  const problems: string[] = [];
  if (env.DATA) {
    try {
      const head = await env.DATA.head(BACKUP_KEY);
      backupUploaded = head ? head.uploaded : null;
    } catch (e) {
      backupUploaded = null;
      problems.push(`The data bucket (R2) could not be read: ${String(e).slice(0, 120)}`);
    }
    try {
      const obj = await env.DATA.get("status.json");
      if (obj) {
        const read = readStatus(JSON.parse(await obj.text()));
        status = read.status;
        if (read.problem) problems.push(read.problem);
      }
    } catch (e) {
      status = null;
      problems.push(`The run status (status.json) in R2 could not be read: ${String(e).slice(0, 120)}`);
    }
    // Information only: a line that cannot be read is left out, never an alert.
    try {
      const obj = await env.DATA.get(FIGURES_KEY);
      figures = obj ? readFigures(await obj.text(), now) : null;
    } catch (e) {
      console.log(`watchdog: the day's figures not read (${String(e).slice(0, 120)})`);
    }
  }
  const raw = stats?.data_as_of;
  const dataAsOf = typeof raw === "string" ? raw : raw == null ? null : String(raw);
  const { intraday, intradayProblem } = await readIntraday(env, now);
  const livePro = await countLivePro(env, now);
  const refundsToCancel = await readRefunds(env, now);
  return {
    now, dataAsOf, backupUploaded, status, statusProblem: problems.join(" ") || null, intraday, intradayProblem, livePro,
    figures, refundsToCancel,
  };
}

export async function runWatchdog(
  env: Env, now: Date = new Date(),
): Promise<{ alerts: string[]; notices: string[]; sent: boolean; error?: string }> {
  const inputs = await gatherInputs(env, now);
  const alerts = collectAlerts(inputs);
  const notices = collectNotices(inputs);
  const figures = inputs.figures ?? null;
  if (alerts.length === 0 && notices.length === 0 && !figures) return { alerts, notices, sent: false };
  // The log says whether figures went, never what they are.
  const counts = `${alerts.length} alert(s), ${notices.length} notice(s)${figures ? ", the day's figures" : ""}`;
  const to = (env.ALERT_EMAIL ?? "").trim();
  const from = (env.ALERT_FROM ?? "").trim();
  if (!env.ALERTS || !to || !from) {
    console.log(`watchdog: ${counts}, no email binding or address configured`);
    return { alerts, notices, sent: false };
  }
  try {
    const { EmailMessage } = await import("cloudflare:email");
    const links = { runLog: (env.RUN_LOG_URL ?? "").trim() || undefined, site: (env.SITE_URL ?? "").trim() || undefined };
    await env.ALERTS.send(new EmailMessage(from, to, buildEmail(from, to, alerts, now, notices, links, figures)));
    console.log(`watchdog: ${counts}, email sent`);
    return { alerts, notices, sent: true };
  } catch (e) {
    console.log(`watchdog: ${counts}, email failed: ${String(e).slice(0, 200)}`);
    return { alerts, notices, sent: false, error: String(e).slice(0, 300) };
  }
}
