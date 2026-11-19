import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import accountsSchema from "../accounts_schema.sql?raw";
import { LIVE_PRO_SQL, planFromRows, type EntitlementRow } from "../src/account/entitlements";
import {
  ACCOUNTS_BACKUP_KEY, ACCOUNTS_BACKUP_STALE_DAYS, BACKUP_KEY, FIGURES_KEY, INTRADAY_RUNS_SQL, INTRADAY_STEP_NOTICES, LATE_END_UTC, LATE_START_HOURS,
  LOOKUP_MAX_BYTES, MONEY_ITEMS_SQL, NIGHTLY_SLOT_UTC, REFUNDS_TO_CANCEL_SQL, WORKFLOW_TOKEN_WARN_DAYS, buildEmail, collectAlerts, collectNotes,
  collectNotices, gatherInputs, lateNight, readFigures, readIntradayRuns, readStatus, readTokenExpiry, readWorkflowToken, runWatchdog,
} from "../src/watchdog";
import { testEnv } from "./assets";
import { applySql } from "./setup";

const now = new Date("2026-10-20T06:00:00Z");
const healthy = {
  now,
  dataAsOf: "2026-10-20",
  backupUploaded: new Date("2026-10-20T00:50:00Z"),
  status: { run_at: "2026-10-20T00:48:00Z", ok: true, stages: [{ source: "tenders", ok: true }, { source: "awards", ok: true }] },
};

// A stand-in for a D1 binding: answers the one statement it is given with the
// row (or throws the error) and records the statement and its bound values.
function fakeD1(answer: Record<string, unknown> | null | Error) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...params: unknown[]) => ({
        first: async () => {
          calls.push({ sql, params });
          if (answer instanceof Error) throw answer;
          return answer;
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, calls };
}

// The answer to INTRADAY_RUNS_SQL on a clean day: the 03:45 run went through
// and none of the nine failed.
const cleanRuns = { last_ok: "2026-10-20T03:45:30Z", runs: 9, failed: 0, rows_new: 12 };

describe("daily check", () => {
  it("finds nothing wrong on a healthy morning", () => {
    expect(collectAlerts(healthy)).toEqual([]);
  });

  it("flags stale data, a stale or missing backup, a missing status and failed stages", () => {
    expect(collectAlerts({ ...healthy, dataAsOf: "2026-10-16" })[0]).toContain("4 days old");
    expect(collectAlerts({ ...healthy, dataAsOf: null })[0]).toContain("no data file");
    expect(collectAlerts({ ...healthy, backupUploaded: new Date("2026-10-18T00:50:00Z") })[0]).toContain("more than 36 hours");
    expect(collectAlerts({ ...healthy, backupUploaded: null })[0]).toContain("No database backup");
    expect(collectAlerts({ ...healthy, status: null })[0]).toContain("No run status");
    expect(collectAlerts({ ...healthy, backupUploaded: null })[0]).toContain(BACKUP_KEY);
    const failed = collectAlerts({ ...healthy, status: { ...healthy.status, stages: [{ source: "tenders", ok: false, detail: "HTTP 503" }] } });
    expect(failed).toEqual(['Stage "tenders" failed in the last run: HTTP 503.']);
    expect(collectAlerts({ ...healthy, status: { ...healthy.status, run_at: "2026-10-17T00:48:00Z" } })[0]).toContain("last completed run was 2026-10-17");
  });

  it("flags a failed search sync, a failed roll-up and a rolled-back deploy, and nothing else they report", () => {
    const with_ = (extra: object) => collectAlerts({ ...healthy, status: { ...healthy.status, ...extra } });
    expect(with_({ search_sync: "failed" })).toEqual([
      "The search database sync failed. The next run sends the same changes again; check the run log.",
    ]);
    expect(with_({ views_rollup: "failed" })).toEqual([
      "The audience roll-up failed. The next run catches up; check the CLOUDFLARE_ANALYTICS_TOKEN secret and the run log.",
    ]);
    expect(with_({ deploy_rolled_back: true })).toEqual([
      "The site answered with server errors after the last deploy, so the run rolled the Worker back to the version before it. The site shows the previous data until a later run deploys again; check the run log.",
    ]);
    for (const quiet of ["synced", "nothing to send", "not run"]) {
      expect(with_({ search_sync: quiet }), quiet).toEqual([]);
    }
    for (const quiet of ["rolled up", "no data", "no token", "not run"]) {
      expect(with_({ views_rollup: quiet }), quiet).toEqual([]);
    }
    expect(with_({ deploy_rolled_back: false })).toEqual([]);
    expect(with_({ search_sync: "failed", views_rollup: "failed", deploy_rolled_back: true })).toHaveLength(3);
  });

  it("flags a failed records database sync, reads the field, and leaves its other outcomes alone", () => {
    const with_ = (extra: object) => collectAlerts({ ...healthy, status: { ...healthy.status, ...extra } });
    const line = "The records database sync failed. The analytics views answer from what the database holds (or say it is being loaded) and the next run sends the same changes again; check the run log.";
    expect(with_({ records_sync: "failed" })).toEqual([line]);
    // "no database" reaches the email as the nightly's notice, never as an alert.
    for (const quiet of ["synced", "nothing to send", "no database", "not run"]) {
      expect(with_({ records_sync: quiet }), quiet).toEqual([]);
    }
    const read = readStatus({ ...healthy.status, records_sync: "failed" });
    expect(read).toEqual({ status: { ...healthy.status, records_sync: "failed" }, problem: null });
    expect(readStatus({ ...healthy.status, records_sync: ["failed"] }).status).toEqual(healthy.status);
    // The email names it among the items.
    const raw = buildEmail("a@b.ca", "c@d.ca", collectAlerts({ ...healthy, status: read.status! }), now);
    expect(raw).toContain(`1. ${line}`);
    expect(raw).not.toContain(String.fromCharCode(0x2014));
  });

  it("flags a failed Search Console import and an unwritten monthly report, and nothing else they report", () => {
    const with_ = (extra: object) => collectAlerts({ ...healthy, status: { ...healthy.status, ...extra } });
    expect(with_({ search_console: "failed" })).toEqual([
      "The Search Console import failed. The next run catches up; check the GSC_SERVICE_ACCOUNT_JSON secret and the run log.",
    ]);
    expect(with_({ views_report: "failed" })).toEqual([
      "The monthly audience report was not written. The next run tries again; check the run log.",
    ]);
    for (const quiet of ["imported 3 days", "up to date", "no credentials", "not run"]) {
      expect(with_({ search_console: quiet }), quiet).toEqual([]);
    }
    for (const quiet of ["written", "not due", "waiting", "no data", "not run"]) {
      expect(with_({ views_report: quiet }), quiet).toEqual([]);
    }
    const read = readStatus({ ...healthy.status, search_console: "failed", views_report: 3 });
    expect(read.status).toEqual({ ...healthy.status, search_console: "failed" });
  });

  it("reads the resilience fields from status.json and drops them when they have the wrong type", () => {
    const fields = { search_sync: "failed", views_rollup: "rolled up", deploy_rolled_back: true };
    const read = readStatus({ ...healthy.status, ...fields, smoke: "broken", checks: { due: false } });
    expect(read).toEqual({ status: { ...healthy.status, ...fields }, problem: null });
    expect(collectAlerts({ ...healthy, status: read.status })).toHaveLength(2);
    // "true" as text, or a number, is not a rollback.
    const odd = readStatus({ ...healthy.status, search_sync: 0, views_rollup: ["failed"], deploy_rolled_back: "true" });
    expect(odd).toEqual({ status: healthy.status, problem: null });
    expect(collectAlerts({ ...healthy, status: odd.status })).toEqual([]);
  });

  it("ignores fields of workflow steps this site does not run", () => {
    const read = readStatus({ ...healthy.status, x_post: "failed", zenodo_deposit: "failed" });
    expect(read).toEqual({ status: healthy.status, problem: null });
    expect(collectAlerts({ ...healthy, status: read.status })).toEqual([]);
  });

  it("builds a plain-text email that names every item", () => {
    const raw = buildEmail("alerts@example.invalid", "owner@example.com", ["one thing", "another"], now, [], {
      runLog: "https://runs.example.invalid/actions",
      site: "https://awardwatch.ca/data",
    });
    expect(raw).toContain("From: Award Watch <alerts@example.invalid>\r\nTo: owner@example.com\r\nSubject: Award Watch: 2 items need attention");
    expect(raw).toContain("Content-Type: text/plain; charset=utf-8\r\n\r\nDaily check at 2026-10-20T06:00 UTC found:");
    expect(raw).toContain("1. one thing\r\n2. another");
    expect(raw).toContain("Run log: https://runs.example.invalid/actions\r\nSite: https://awardwatch.ca/data");
    expect(buildEmail("a@b.ca", "c@d.ca", ["x"], now)).toContain("1 item need attention");
    // Without the two variables the lines are left out, never filled with a guess.
    expect(buildEmail("a@b.ca", "c@d.ca", ["x"], now)).not.toContain("Run log:");
    expect(buildEmail("a@b.ca", "c@d.ca", ["x"], now)).not.toMatch(/https?:/);
  });
});

describe("daily check: notices", () => {
  const notices = [
    { source: "buyers", detail: "Unmapped buyer spelling: Example Agency (EXA)" },
    { source: "lobbying", detail: "The registry host refused the download" },
  ];
  const withNotices = { ...healthy, status: { ...healthy.status, notices } };

  it("lists the run's notices apart from the alerts, and never as an alert", () => {
    expect(collectAlerts(withNotices)).toEqual([]);
    expect(collectNotices(withNotices)).toEqual([
      "buyers: Unmapped buyer spelling: Example Agency (EXA)",
      "lobbying: The registry host refused the download",
    ]);
    // A status older than the last night is an alert of its own; its notices went out the morning after it.
    const stale = { ...withNotices, status: { ...withNotices.status, run_at: "2026-10-18T00:48:00Z" } };
    expect(collectNotices(stale)).toEqual([]);
    expect(collectNotices({ ...healthy, status: null })).toEqual([]);
  });

  it("sends notices alone with a subject that says notices", () => {
    const raw = buildEmail("a@b.ca", "c@d.ca", [], now, collectNotices(withNotices));
    expect(raw).toContain("Subject: Award Watch: 2 notices from the last run");
    expect(raw).not.toContain("need attention");
    expect(raw).toContain("Daily check at 2026-10-20T06:00 UTC: nothing needs attention.");
    expect(raw).toContain("Notices from the last run (information; nothing failed):");
    expect(raw).toContain("- buyers: Unmapped buyer spelling: Example Agency (EXA)");
    expect(raw).toContain("when the last run recorded notices.");
  });

  it("puts alerts first and notices after them when there are both", () => {
    const raw = buildEmail("a@b.ca", "c@d.ca", ["one thing"], now, ["registers: read again"]);
    expect(raw).toContain("Subject: Award Watch: 1 item need attention, 1 notice");
    expect(raw.indexOf("1. one thing")).toBeLessThan(raw.indexOf("- registers: read again"));
    expect(raw).toContain("it repeats each day while an item remains.");
  });

  it("decides to send on a morning with notices and no alert", async () => {
    // The morning after the fixture's data date (stats.json: 2026-10-31).
    const morning = new Date("2026-11-01T06:00:00Z");
    const asked: string[] = [];
    const bucket = {
      head: async (key: string) => {
        asked.push(key);
        return { uploaded: new Date("2026-11-01T00:50:00Z") };
      },
      get: async () => ({ text: async () => JSON.stringify({ ...withNotices.status, run_at: "2026-11-01T00:48:00Z" }) }),
    } as unknown as R2Bucket;
    // The same-day refresh went through at 03:45 and a paid plan is live: nothing to say about it.
    const search = fakeD1({ ...cleanRuns, last_ok: "2026-11-01T03:45:30Z" }).db;
    const env = { ...testEnv(), DATA: bucket, SEARCH: search, ACCOUNTS: fakeD1({ n: 1 }).db, ALERT_EMAIL: "", ALERT_FROM: "" };
    const result = await runWatchdog(env as never, morning);
    expect(result.alerts).toEqual([]);
    expect(result.notices).toHaveLength(2);
    // No address configured in the test: the email is composed but not sent.
    expect(result.sent).toBe(false);
    // The backup is in parts; the first part's upload time is the backup's. Then the accounts database's export.
    expect(asked).toEqual(["awardwatch.sqlite.gz.000", "backups/weekly/accounts-latest.sql.gz"]);
  });
});

describe("daily check against a status file of unexpected shape", () => {
  it("reads a well-formed status unchanged", () => {
    expect(readStatus(healthy.status)).toEqual({ status: healthy.status, problem: null });
  });

  it("turns every odd shape into an alert, never an exception", () => {
    for (const raw of [null, [], "text", 42, true]) {
      const { status, problem } = readStatus(raw);
      expect(status).toBeNull();
      expect(problem).toContain("not a JSON object");
    }
    const odd = readStatus({ run_at: 1760000000, stages: { tenders: true } });
    expect(odd.problem).toContain("run_at, stages");
    const alerts = collectAlerts({ ...healthy, status: odd.status, statusProblem: odd.problem });
    expect(alerts).toEqual(["The run status (status.json) in R2 has unreadable fields (run_at, stages)."]);
    const chars = readStatus({ run_at: "2026-10-20T00:48:00Z", stages: "ok" });
    expect(chars.problem).toContain("stages");
    expect(collectAlerts({ ...healthy, status: chars.status, statusProblem: chars.problem })).toHaveLength(1);
  });

  it("counts an unreadable stage entry as a failed stage", () => {
    const { status, problem } = readStatus({
      run_at: "2026-10-20T00:48:00Z",
      stages: [null, "x", { source: 5, ok: "yes", detail: { long: true } }, { source: "awards", ok: true }],
    });
    expect(problem).toBeNull();
    expect(collectAlerts({ ...healthy, status })).toEqual([
      'Stage "unknown" failed in the last run: unreadable stage entry.',
      'Stage "unknown" failed in the last run: unreadable stage entry.',
      'Stage "unknown" failed in the last run.',
    ]);
  });

  it("flags a data date that is not a date", () => {
    expect(collectAlerts({ ...healthy, dataAsOf: "yesterday" })).toEqual(["The data date in stats.json (yesterday) is not a date."]);
  });

  it("gathers from a bucket that returns junk or fails", async () => {
    const bucket = (statusBody: string | null, headFails = false) =>
      ({
        head: async () => {
          if (headFails) throw new Error("R2 down");
          return { uploaded: new Date("2026-10-20T00:50:00Z") };
        },
        get: async () => (statusBody === null ? null : { text: async () => statusBody }),
      }) as unknown as R2Bucket;
    const base = testEnv();
    const junk = await gatherInputs({ ...base, DATA: bucket("{not json") }, now);
    expect(junk.status).toBeNull();
    expect(junk.statusProblem).toContain("could not be read");
    expect(collectAlerts(junk).join(" ")).toContain("could not be read");
    const down = await gatherInputs({ ...base, DATA: bucket(JSON.stringify(healthy.status), true) }, now);
    expect(down.statusProblem).toContain("The data bucket (R2) could not be read");
    const shapes = await runWatchdog({ ...base, DATA: bucket('{"stages":{"a":1}}') }, now);
    expect(shapes.sent).toBe(false);
    expect(shapes.alerts.join(" ")).toContain("unreadable fields (run_at, stages)");
  });
});

describe("daily check: the accounts database's weekly backup", () => {
  const line = (saved: string) =>
    `The accounts database's weekly backup in R2 (backups/weekly/accounts-latest.sql.gz) was last saved ${saved} UTC, ` +
    `more than 9 days ago. Check the nightly's Sunday export of it in the run log.`;

  it("names a copy older than nine days, and says nothing of a newer one or of none", () => {
    expect(ACCOUNTS_BACKUP_KEY).toBe("backups/weekly/accounts-latest.sql.gz");
    expect(ACCOUNTS_BACKUP_STALE_DAYS).toBe(9);
    // now is 2026-10-20T06:00Z: a Sunday export of 2026-10-11 13:50 is 8 days and 16 hours old.
    expect(collectAlerts({ ...healthy, accountsBackupUploaded: new Date("2026-10-11T13:50:00Z") })).toEqual([]);
    // Exactly nine days is not more than nine.
    expect(collectAlerts({ ...healthy, accountsBackupUploaded: new Date("2026-10-11T06:00:00Z") })).toEqual([]);
    expect(collectAlerts({ ...healthy, accountsBackupUploaded: new Date("2026-10-11T05:59:00Z") })).toEqual([line("2026-10-11T05:59")]);
    // A Sunday went by without an export.
    expect(collectAlerts({ ...healthy, accountsBackupUploaded: new Date("2026-10-04T13:50:00Z") })).toEqual([line("2026-10-04T13:50")]);
    // No copy yet, or one that was not read: nothing.
    for (const none of [null, undefined]) expect(collectAlerts({ ...healthy, accountsBackupUploaded: none })).toEqual([]);
    // After the database backup's own lines.
    const both = collectAlerts({ ...healthy, backupUploaded: null, accountsBackupUploaded: new Date("2026-10-04T13:50:00Z") });
    expect(both[0]).toContain(BACKUP_KEY);
    expect(both[1]).toBe(line("2026-10-04T13:50"));
  });

  // A bucket that answers a head by key: a Date, null for no object, or an Error to throw.
  function bucketOf(heads: Record<string, Date | null | Error>) {
    const asked: string[] = [];
    const bucket = {
      head: async (key: string) => {
        asked.push(key);
        const answer = heads[key] ?? null;
        if (answer instanceof Error) throw answer;
        return answer ? { uploaded: answer } : null;
      },
      get: async (key: string) => (key === "status.json" ? { text: async () => JSON.stringify(healthy.status) } : null),
    } as unknown as R2Bucket;
    return { bucket, asked };
  }

  it("heads the newest copy, and takes an absent one or a fault reading it as nothing to say", async () => {
    const env = (bucket: R2Bucket) => ({ ...testEnv(), DATA: bucket, SEARCH: fakeD1(cleanRuns).db, ACCOUNTS: undefined });
    const old = new Date("2026-10-04T13:50:00Z");
    const stale = bucketOf({ [BACKUP_KEY]: healthy.backupUploaded, [ACCOUNTS_BACKUP_KEY]: old });
    const inputs = await gatherInputs(env(stale.bucket), now);
    expect(stale.asked).toEqual([BACKUP_KEY, ACCOUNTS_BACKUP_KEY]);
    expect(inputs.accountsBackupUploaded).toEqual(old);
    expect(collectAlerts(inputs)).toEqual([line("2026-10-04T13:50")]);
    // The first Sunday has not come: no object, no line.
    const absent = await gatherInputs(env(bucketOf({ [BACKUP_KEY]: healthy.backupUploaded }).bucket), now);
    expect(absent.accountsBackupUploaded).toBeNull();
    expect(collectAlerts(absent)).toEqual([]);
    // A fault reading it is a log line; the rest of the check goes on.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const fault = await gatherInputs(env(bucketOf({ [BACKUP_KEY]: healthy.backupUploaded, [ACCOUNTS_BACKUP_KEY]: new Error("R2 down") }).bucket), now);
      expect(fault.accountsBackupUploaded).toBeNull();
      expect(fault.backupUploaded).toEqual(healthy.backupUploaded);
      expect(fault.statusProblem).toBeNull();
      expect(collectAlerts(fault)).toEqual([]);
      expect(log.mock.calls.flat().join(" ")).toContain("watchdog: the accounts database's backup not read (Error: R2 down)");
    } finally {
      log.mockRestore();
    }
    // No bucket bound at all: nothing read and nothing said of it.
    const unbound = await gatherInputs({ ...testEnv(), DATA: undefined, SEARCH: fakeD1(cleanRuns).db, ACCOUNTS: undefined }, now);
    expect(unbound.accountsBackupUploaded).toBeNull();
    expect(collectAlerts(unbound).filter((a) => a.includes("accounts database"))).toEqual([]);
  });
});

describe("daily check: the same-day refresh's runs", () => {
  const runs = (answer: Record<string, unknown>, livePro: number | null = 1) => ({
    ...healthy, intraday: readIntradayRuns(answer), intradayProblem: null, livePro,
  });

  it("reads the last 24 hours of runs and the live paid plans with one prepared statement each", async () => {
    const search = fakeD1(cleanRuns);
    const accounts = fakeD1({ n: 2 });
    const inputs = await gatherInputs({ ...testEnv(), SEARCH: search.db, ACCOUNTS: accounts.db }, now);
    // The window's bound written as intraday_runs writes its times; the plans' instant as toISOString writes it.
    // The accounts database also answers the refunds to cancel (test/accounts-refund.test.ts), over the audit's 90 days.
    expect(search.calls).toEqual([{ sql: INTRADAY_RUNS_SQL, params: ["2026-10-19T06:00:00Z"] }]);
    // And the money items (test/hardening-money.test.ts): the check's instant, and their 14 days.
    expect(accounts.calls).toEqual([
      { sql: LIVE_PRO_SQL, params: ["2026-10-20T06:00:00.000Z"] },
      { sql: REFUNDS_TO_CANCEL_SQL, params: ["2026-07-22T06:00:00.000Z"] },
      { sql: MONEY_ITEMS_SQL, params: ["2026-10-20T06:00:00.000Z", "2026-10-06T06:00:00.000Z"] },
    ]);
    expect(inputs.refundsToCancel).toEqual([]);
    expect(inputs.money).toEqual({ second: [], deleted: [], failed: [] });
    expect(inputs.intraday).toEqual({ lastOk: "2026-10-20T03:45:30Z", runs: 9, failed: 0, rowsNew: 12 });
    expect(inputs.intradayProblem).toBeNull();
    expect(inputs.livePro).toBe(2);
  });

  it("says nothing on a clean day, and the clean day's message is unchanged", async () => {
    expect(collectAlerts(runs(cleanRuns))).toEqual([]);
    // No run in the last day at all (a quiet weekend before a plan went live): nothing failed.
    expect(collectAlerts(runs({ last_ok: "2026-10-20T03:45:30Z", runs: 0, failed: 0, rows_new: 0 }))).toEqual([]);
    // The whole check on a clean morning (the one after the fixture's data date,
    // stats.json: 2026-10-31), with a paid plan live and both nightly steps
    // done: no alert, no notice, so no message at all, as before.
    const morning = new Date("2026-11-01T06:00:00Z");
    const status = { ...healthy.status, run_at: "2026-11-01T00:48:00Z", intraday_lookup: "saved", intraday_prune: "pruned", intraday_lookup_bytes: 58773 };
    const bucket = {
      head: async () => ({ uploaded: new Date("2026-11-01T00:50:00Z") }),
      get: async () => ({ text: async () => JSON.stringify(status) }),
    } as unknown as R2Bucket;
    const search = fakeD1({ ...cleanRuns, last_ok: "2026-11-01T03:45:30Z" }).db;
    const clean = await runWatchdog({ ...testEnv(), DATA: bucket, SEARCH: search, ACCOUNTS: fakeD1({ n: 1 }).db } as never, morning);
    expect(clean).toEqual({ alerts: [], notices: [], sent: false });
    // A morning with notices only opens with the same words as before.
    expect(buildEmail("a@b.ca", "c@d.ca", [], morning, ["buyers: one"])).toContain(
      "Daily check at 2026-11-01T06:00 UTC: nothing needs attention.");
  });

  it("names a refresh that has not gone through for 4 hours, only while a paid plan is live", () => {
    const late = { ...cleanRuns, last_ok: "2026-10-20T01:45:30Z" };
    expect(collectAlerts(runs(late))).toEqual([
      "No same-day refresh has gone through since 2026-10-20T01:45 UTC, more than 4 hours before this check, while a paid plan is live. Check the intraday workflow's runs.",
    ]);
    // Exactly 4 hours is not more than 4.
    expect(collectAlerts(runs({ ...cleanRuns, last_ok: "2026-10-20T02:00:00Z" }))).toEqual([]);
    // No run that went through in the 30 days the table keeps.
    expect(collectAlerts(runs({ ...cleanRuns, last_ok: null }))).toEqual([
      "No same-day refresh has gone through while a paid plan is live: the search database holds no run that did. Check the intraday workflow's runs.",
    ]);
    // No live plan, or a count that could not be read: the workflow's gate stops the runs, so silence is expected.
    for (const livePro of [0, null]) {
      expect(collectAlerts(runs(late, livePro)), String(livePro)).toEqual([]);
      expect(collectAlerts(runs({ ...cleanRuns, last_ok: null }, livePro)), String(livePro)).toEqual([]);
    }
  });

  it("counts the refreshes that failed since yesterday, whether or not a plan is live", () => {
    const some = { last_ok: "2026-10-20T03:45:30Z", runs: 9, failed: 2, rows_new: 14 };
    const line = "2 of 9 same-day refreshes failed since yesterday; the 7 that went through wrote 14 new notice versions. " +
      "A later run writes the day's notices again; intraday_runs.detail names the step that failed.";
    expect(collectAlerts(runs(some))).toEqual([line]);
    expect(collectAlerts(runs(some, 0))).toEqual([line]);
    expect(collectAlerts(runs({ last_ok: "2026-10-19T03:45:30Z", runs: 1, failed: 1, rows_new: 0 }, 0))).toEqual([
      "1 of 1 same-day refresh failed since yesterday; none went through. A later run writes the day's notices again; intraday_runs.detail names the step that failed.",
    ]);
    expect(collectAlerts(runs({ last_ok: "2026-10-20T03:45:30Z", runs: 2, failed: 1, rows_new: 1 }))[0]).toContain(
      "1 of 2 same-day refreshes failed since yesterday; the one that went through wrote 1 new notice version.");
    // Both lines when the day's runs failed from the afternoon on, with a plan live.
    const both = collectAlerts(runs({ last_ok: "2026-10-19T19:45:30Z", runs: 9, failed: 5, rows_new: 30 }));
    expect(both.map((a) => a.slice(0, 40))).toEqual([
      "No same-day refresh has gone through sin", "5 of 9 same-day refreshes failed since y"]);
  });

  it("makes a fault reading the runs one line, never a thrown check", async () => {
    const error = new Error("D1_ERROR: no such table: intraday_runs: SQLITE_ERROR");
    const failing = fakeD1(error);
    const inputs = await gatherInputs({ ...testEnv(), SEARCH: failing.db, ACCOUNTS: fakeD1({ n: 1 }).db }, now);
    expect(inputs.intraday).toBeNull();
    const fault = "The same-day refresh runs could not be read from the search database (SQLITE_ERROR, no such table).";
    expect(inputs.intradayProblem).toBe(fault);
    expect(collectAlerts({ ...healthy, intraday: null, intradayProblem: fault, livePro: 1 })).toEqual([fault]);
    // An answer of the wrong shape, and no binding at all, are the same one line in other words.
    for (const answer of [null, { runs: "9" }, { ...cleanRuns, failed: 10 }, { ...cleanRuns, last_ok: "yesterday" }]) {
      const read = await gatherInputs({ ...testEnv(), SEARCH: fakeD1(answer).db, ACCOUNTS: undefined }, now);
      expect(read.intradayProblem, JSON.stringify(answer)).toBe(
        "The same-day refresh runs could not be read: the search database's answer did not read.");
    }
    const unbound = await gatherInputs({ ...testEnv(), SEARCH: undefined, ACCOUNTS: undefined }, now);
    expect(unbound.intradayProblem).toBe("The same-day refresh runs could not be read: the Worker has no SEARCH binding.");
    // The whole check still finishes and decides.
    const result = await runWatchdog({ ...testEnv(), SEARCH: failing.db, ACCOUNTS: undefined, ALERT_EMAIL: "", ALERT_FROM: "" } as never, now);
    expect(result.sent).toBe(false);
    expect(result.alerts.filter((a) => a.includes("same-day refresh"))).toEqual([fault]);
  });

  it("takes a fault counting the paid plans as no plan, with no line of its own", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const late = { ...cleanRuns, last_ok: "2026-10-20T01:45:30Z" };
      const inputs = await gatherInputs({
        ...testEnv(), SEARCH: fakeD1(late).db, ACCOUNTS: fakeD1(new Error("D1_ERROR: overloaded")).db,
      }, now);
      expect(inputs.livePro).toBeNull();
      expect(collectAlerts(inputs).filter((a) => a.includes("same-day"))).toEqual([]);
      expect(log.mock.calls.flat().join(" ")).toContain("watchdog: live paid plans not counted (D1_ERROR, overloaded)");
      const odd = await gatherInputs({ ...testEnv(), SEARCH: fakeD1(late).db, ACCOUNTS: fakeD1({ n: "1" }).db }, now);
      expect(odd.livePro).toBeNull();
    } finally {
      log.mockRestore();
    }
  });

  it("runs both statements against the real tables", async () => {
    // intraday_runs as pipeline/intraday_schema.sql makes it, in the local search database.
    const search = (env as unknown as { SEARCH: D1Database; INTRADAY_SCHEMA_SQL: string });
    await applySql(search.SEARCH, search.INTRADAY_SCHEMA_SQL);
    await search.SEARCH.prepare("DELETE FROM intraday_runs").run();
    const rows: [string, string, number, number][] = [
      ["1-1", "2026-10-18T23:45:30Z", 1, 40], // before the window: its rows_new is not counted
      ["2-1", "2026-10-19T11:45:30Z", 1, 6],
      ["3-1", "2026-10-19T13:45:30Z", 0, 3], // failed after its parse: its rows_new is not counted
      ["4-1", "2026-10-19T15:45:30Z", 1, 2],
      ["5-1", "2026-10-20T01:45:30Z", 0, 0],
    ];
    await search.SEARCH.batch(rows.map(([id, at, ok, n]) =>
      search.SEARCH.prepare("INSERT INTO intraday_runs (id, at, ok, rows_new) VALUES (?, ?, ?, ?)").bind(id, at, ok, n)));
    const inputs = await gatherInputs({ ...testEnv(), SEARCH: search.SEARCH, ACCOUNTS: undefined }, now);
    expect(inputs.intradayProblem).toBeNull();
    expect(inputs.intraday).toEqual({ lastOk: "2026-10-19T15:45:30Z", runs: 4, failed: 2, rowsNew: 8 });
    await search.SEARCH.prepare("DELETE FROM intraday_runs").run();
    const empty = await gatherInputs({ ...testEnv(), SEARCH: search.SEARCH, ACCOUNTS: undefined }, now);
    expect(empty.intraday).toEqual({ lastOk: null, runs: 0, failed: 0, rowsNew: 0 });

    // The live paid plans, in the local accounts database, against planFromRows row by row.
    const accounts = (env as unknown as { ACCOUNTS: D1Database }).ACCOUNTS;
    await applySql(accounts, accountsSchema);
    await accounts.prepare("DELETE FROM entitlements").run();
    await accounts.prepare("INSERT OR IGNORE INTO users (id, email, created_at) VALUES ('u1', 'reader@example.com', '2026-10-01T00:00:00.000Z')").run();
    const at = now.toISOString();
    const grants: EntitlementRow[] = [
      { id: "e1", plan: "pro", starts_at: "2026-10-01T00:00:00.000Z", ends_at: null, created_at: "2026-10-01T00:00:00.000Z", revoked_at: null },
      { id: "e2", plan: "pro", starts_at: "2026-10-01T00:00:00.000Z", ends_at: "2026-11-01T00:00:00.000Z", created_at: "2026-10-01T00:00:01.000Z", revoked_at: null },
      { id: "e3", plan: "pro", starts_at: "2026-10-01T00:00:00.000Z", ends_at: at, created_at: "2026-10-01T00:00:02.000Z", revoked_at: null },
      { id: "e4", plan: "pro", starts_at: at, ends_at: null, created_at: "2026-10-01T00:00:03.000Z", revoked_at: null },
      { id: "e5", plan: "pro", starts_at: "2026-10-21T00:00:00.000Z", ends_at: null, created_at: "2026-10-01T00:00:04.000Z", revoked_at: null },
      { id: "e6", plan: "pro", starts_at: "2026-10-01T00:00:00.000Z", ends_at: null, created_at: "2026-10-01T00:00:05.000Z", revoked_at: "2026-10-02T00:00:00.000Z" },
      { id: "e7", plan: "free", starts_at: "2026-10-01T00:00:00.000Z", ends_at: null, created_at: "2026-10-01T00:00:06.000Z", revoked_at: null },
    ];
    await accounts.batch(grants.map((g) => accounts.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, created_at, revoked_at) VALUES (?, 'u1', ?, 'manual', ?, ?, ?, ?)",
    ).bind(g.id, g.plan, g.starts_at, g.ends_at, g.created_at, g.revoked_at)));
    // Each row alone gives pro by planFromRows exactly when the statement counts it.
    const pro = grants.filter((g) => planFromRows([g], now).plan === "pro").map((g) => g.id);
    expect(pro).toEqual(["e1", "e2", "e4"]);
    const counted = await gatherInputs({ ...testEnv(), SEARCH: fakeD1(cleanRuns).db, ACCOUNTS: accounts }, now);
    expect(counted.livePro).toBe(pro.length);
    await accounts.prepare("DELETE FROM entitlements").run();
  });
});

describe("daily check: the same-day refresh's nightly steps", () => {
  const withStatus = (extra: object) => ({ ...healthy, status: { ...healthy.status, ...extra } });

  it("reads the two outcomes and the lookup's size, and drops a size that is not a byte count", () => {
    const fields = { intraday_lookup: "saved", intraday_prune: "pruned", intraday_lookup_bytes: 58773 };
    expect(readStatus({ ...healthy.status, ...fields })).toEqual({ status: { ...healthy.status, ...fields }, problem: null });
    for (const odd of ["58773", -1, 1.5, null, true]) {
      expect(readStatus({ ...healthy.status, intraday_lookup_bytes: odd }), String(odd)).toEqual({ status: healthy.status, problem: null });
    }
    expect(readStatus({ ...healthy.status, intraday_lookup: 1, intraday_prune: ["failed"] }).status).toEqual(healthy.status);
  });

  it("gives a failed lookup save or prune one notice line each, never an alert", () => {
    const failed = withStatus({ intraday_lookup: "failed", intraday_prune: "failed" });
    expect(collectAlerts(failed)).toEqual([]);
    expect(collectNotices(failed)).toEqual([
      `intraday_lookup: ${INTRADAY_STEP_NOTICES.intraday_lookup}`,
      `intraday_prune: ${INTRADAY_STEP_NOTICES.intraday_prune}`,
    ]);
    // The nightly lists the same notices; each is said once, after the run's other notices.
    const nightly = withStatus({
      intraday_lookup: "failed", intraday_prune: "pruned",
      notices: [
        { source: "buyers", detail: "Unmapped buyer spelling: Example Agency (EXA)" },
        { source: "intraday_lookup", detail: INTRADAY_STEP_NOTICES.intraday_lookup },
      ],
    });
    expect(collectNotices(nightly)).toEqual([
      "buyers: Unmapped buyer spelling: Example Agency (EXA)",
      `intraday_lookup: ${INTRADAY_STEP_NOTICES.intraday_lookup}`,
    ]);
    for (const quiet of ["saved", "pruned", "not run"]) {
      expect(collectNotices(withStatus({ intraday_lookup: quiet, intraday_prune: quiet })), quiet).toEqual([]);
    }
    // From a status older than last night, nothing: the stale run is an alert of its own.
    expect(collectNotices(withStatus({ intraday_lookup: "failed", run_at: "2026-10-18T00:48:00Z" }))).toEqual([]);
  });

  it("flags a lookup over 2,000,000 bytes and no smaller one", () => {
    expect(LOOKUP_MAX_BYTES).toBe(2_000_000);
    expect(collectAlerts(withStatus({ intraday_lookup: "saved", intraday_lookup_bytes: 2_000_001 }))).toEqual([
      "The buyer lookup for the same-day refresh is 2,000,001 bytes, over the 2,000,000-byte bound; every run of the refresh downloads and parses it. Keep only the spellings seen in the last 24 months (docs/intraday.md).",
    ]);
    for (const bytes of [58_773, 2_000_000]) {
      expect(collectAlerts(withStatus({ intraday_lookup: "saved", intraday_lookup_bytes: bytes })), String(bytes)).toEqual([]);
    }
  });
});

describe("daily check: the day's figures", () => {
  // The line pipeline/awardwatch_pipeline/funnel.py writes for 2026-10-18, read the morning of the 20th.
  const line =
    "2026-10-18 (UTC): accounts 12 (new 2), sign-in codes asked for 3, sign-ins 2, Pro 1, saved searches 4, watches 7; " +
    "page views by people 120, engaged visitors 7, from search 9, on a phone or tablet 6";

  // A bucket holding the backup, a status and the figures line under their own keys.
  function bucketWith(figures: string | null | Error, status: object = healthy.status) {
    const asked: string[] = [];
    const bucket = {
      head: async () => ({ uploaded: new Date("2026-10-20T00:50:00Z") }),
      get: async (key: string) => {
        asked.push(key);
        if (key === "status.json") return { text: async () => JSON.stringify(status) };
        if (key !== FIGURES_KEY || figures === null) return null;
        if (figures instanceof Error) throw figures;
        return { text: async () => `${figures}\n` };
      },
    } as unknown as R2Bucket;
    return { bucket, asked };
  }

  // A stand-in for the ALERTS binding that keeps each message (the local runtime keeps its text under "EmailMessage::raw").
  function fakeAlerts() {
    const handed: string[] = [];
    const binding = {
      async send(message: unknown) {
        handed.push((message as Record<string, string>)["EmailMessage::raw"]);
      },
    } as unknown as SendEmail;
    return { handed, binding };
  }

  it("reads one line from the last night or the one before, and nothing else", () => {
    expect(FIGURES_KEY.startsWith("views/")).toBe(true);
    expect(readFigures(`${line}\n`, now)).toBe(line);
    expect(readFigures(line.replace("2026-10-18", "2026-10-19"), now)).not.toBeNull();
    // Older than the night before, from today, or from the future: left out.
    for (const day of ["2026-10-17", "2026-10-20", "2026-10-21"]) {
      expect(readFigures(line.replace("2026-10-18", day), now), day).toBeNull();
    }
    // Another shape: two lines, a character outside printable ASCII, no date, empty, not text.
    for (const odd of [`${line}\nsecond line`, line.replace("; ", `${String.fromCharCode(0x2014)} `), line.slice(18), "", null, 42]) {
      expect(readFigures(odd, now)).toBeNull();
    }
  });

  it("puts the line in its own section and sends it alone with a subject that names the day", () => {
    const raw = buildEmail("a@b.ca", "c@d.ca", [], now, [], {}, line);
    expect(raw).toContain("Subject: Award Watch: figures for 2026-10-18\r\n");
    expect(raw).toContain("Daily check at 2026-10-20T06:00 UTC: nothing needs attention.");
    expect(raw).toContain(`The last finished day (private figures from the nightly run):\r\n\r\n- ${line}`);
    expect(raw).toContain("each morning the nightly run has left the day's figures.");
    // With alerts and notices, after both and with their subject.
    const both = buildEmail("a@b.ca", "c@d.ca", ["one thing"], now, ["buyers: one"], {}, line);
    expect(both).toContain("Subject: Award Watch: 1 item need attention, 1 notice\r\n");
    expect(both.indexOf("1. one thing")).toBeLessThan(both.indexOf("- buyers: one"));
    expect(both.indexOf("- buyers: one")).toBeLessThan(both.indexOf(`- ${line}`));
    expect(buildEmail("a@b.ca", "c@d.ca", [], now, ["buyers: one"], {}, line)).toContain(
      "Subject: Award Watch: 1 notice from the last run\r\n");
    // Without a line nothing changes.
    expect(buildEmail("a@b.ca", "c@d.ca", [], now, ["buyers: one"])).not.toContain("private figures");
  });

  it("sends a morning that has the figures and nothing else, and logs no figure", async () => {
    const { bucket, asked } = bucketWith(line);
    const alerts = fakeAlerts();
    const env = {
      ...testEnv(), DATA: bucket, SEARCH: fakeD1(cleanRuns).db, ACCOUNTS: fakeD1({ n: 1 }).db,
      ALERTS: alerts.binding, ALERT_EMAIL: "owner@example.com", ALERT_FROM: "alerts@example.invalid",
    };
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await runWatchdog(env as never, now);
    expect(result).toEqual({ alerts: [], notices: [], sent: true });
    expect(asked).toEqual(["status.json", FIGURES_KEY]);
    expect(alerts.handed).toHaveLength(1);
    expect(alerts.handed[0]).toContain(`- ${line}`);
    expect(logs.mock.calls.flat().join(" ")).toContain("the day's figures, email sent");
    expect(logs.mock.calls.flat().join(" ")).not.toContain("engaged");
    logs.mockRestore();
  });

  it("leaves out a line that is missing, stale or unreadable, and stays quiet with nothing else to say", async () => {
    for (const figures of [null, line.replace("2026-10-18", "2026-10-10"), "not the line", new Error("R2 down")]) {
      const { bucket } = bucketWith(figures);
      const alerts = fakeAlerts();
      const env = {
        ...testEnv(), DATA: bucket, SEARCH: fakeD1(cleanRuns).db, ACCOUNTS: fakeD1({ n: 1 }).db,
        ALERTS: alerts.binding, ALERT_EMAIL: "owner@example.com", ALERT_FROM: "alerts@example.invalid",
      };
      const inputs = await gatherInputs(env as never, now);
      expect(inputs.figures, String(figures)).toBeNull();
      // Not an alert of its own.
      expect(collectAlerts(inputs), String(figures)).toEqual([]);
      const result = await runWatchdog(env as never, now);
      expect(result, String(figures)).toEqual({ alerts: [], notices: [], sent: false });
      expect(alerts.handed).toEqual([]);
    }
  });
});

// -- what starts the runs (src/dispatch.ts) ---------------------------------------------------------

// The Worker's own cron starts the nightly and the same-day job with the token
// WORKFLOW_RUN; the check reads it once a morning. Every token here is made up,
// and fetch is a fake: nothing reaches GitHub.
const TOKEN = "made-up-token-for-tests-1111";
const READ_URL = "https://api.github.com/repos/AggreCan/award-watch/actions/workflows/nightly.yml";
const TOKEN_HOW = "make a new one and set it with wrangler secret put WORKFLOW_RUN (docs/site-deploy.md, What starts the runs).";
const refusedLine = (status: number) =>
  `GitHub refused the token that starts the nightly and the same-day job (WORKFLOW_RUN, HTTP ${status}); until it is replaced ` +
  `the runs start on GitHub's own schedule, which can be hours late. To replace it, ${TOKEN_HOW}`;
const expiryLine = (day: string) =>
  `The token that starts the nightly and the same-day job (WORKFLOW_RUN) expires on ${day} (UTC); from then the runs start on ` +
  `GitHub's own schedule alone, which can be hours late. Before that day, ${TOKEN_HOW}`;
const NO_SECRET = "The Worker has no WORKFLOW_RUN secret, so the nightly and the same-day job start on GitHub's own schedule alone, " +
  "which can be hours late (docs/site-deploy.md, What starts the runs).";

type GitHubCall = { url: string; method: string; headers: Record<string, string> };

// fetch replaced by a fake that records each request and answers with answer(), or throws what it throws.
function fakeGitHub(answer: () => Response) {
  const calls: GitHubCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    return answer();
  });
  return calls;
}
const answers = (status: number, headers: Record<string, string> = {}) => () =>
  new Response(status === 200 ? '{"id":1,"name":"nightly"}' : `{"message":"Bad credentials","echo":"${TOKEN}"}`, { status, headers });
// A healthy bucket: the backup saved at 00:50 and the healthy status, so only the token can make a line.
const healthyBucket = {
  head: async () => ({ uploaded: healthy.backupUploaded }),
  get: async (key: string) => (key === "status.json" ? { text: async () => JSON.stringify(healthy.status) } : null),
} as unknown as R2Bucket;
const tokenEnv = (extra: object = {}) =>
  ({ ...testEnv(), DATA: healthyBucket, SEARCH: fakeD1(cleanRuns).db, ACCOUNTS: undefined, WORKFLOW_RUN: TOKEN, ...extra }) as never;

// The clean morning after the fixture's data date (stats.json: 2026-10-31): a
// night that started at 12:44 and finished at 14:48, the same-day refresh
// through at 03:45, and, unless given, no figures line.
const morning = new Date("2026-11-01T06:00:00Z");
function cleanMorning(extra: object = {}, figures: string | null = null) {
  const status = { ...healthy.status, run_started: "2026-10-31T12:44:10+00:00", run_at: "2026-10-31T14:48:00+00:00" };
  const bucket = {
    head: async () => ({ uploaded: new Date("2026-11-01T00:50:00Z") }),
    get: async (key: string) => (key === "status.json" ? { text: async () => JSON.stringify(status) }
      : key === FIGURES_KEY && figures ? { text: async () => figures } : null),
  } as unknown as R2Bucket;
  const handed: string[] = [];
  const binding = { async send(m: unknown) { handed.push((m as Record<string, string>)["EmailMessage::raw"]); } } as unknown as SendEmail;
  const env = {
    ...testEnv(), DATA: bucket, SEARCH: fakeD1({ ...cleanRuns, last_ok: "2026-11-01T03:45:30Z" }).db, ACCOUNTS: fakeD1({ n: 1 }).db,
    ALERTS: binding, ALERT_EMAIL: "owner@example.com", ALERT_FROM: "alerts@example.invalid", ...extra,
  };
  return { env: env as never, handed };
}

describe("daily check: the token that starts the runs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the nightly's workflow once, with the dispatch's headers, and says nothing when all is well", async () => {
    const calls = fakeGitHub(answers(200, { "github-authentication-token-expiration": "2027-01-15 00:00:00 UTC" }));
    const inputs = await gatherInputs(tokenEnv(), now);
    expect(calls).toEqual([{
      url: READ_URL, method: "GET",
      headers: { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "awardwatch.ca" },
    }]);
    expect(inputs.workflowToken).toEqual({ state: "accepted", expires: new Date("2027-01-15T00:00:00Z") });
    expect(collectAlerts(inputs)).toEqual([]);
    expect(collectNotes(inputs)).toEqual([]);
    // A token with no end date (no header): nothing either.
    vi.restoreAllMocks();
    fakeGitHub(answers(200));
    const forever = await gatherInputs(tokenEnv(), now);
    expect(forever.workflowToken).toEqual({ state: "accepted", expires: null });
    expect(collectAlerts(forever)).toEqual([]);
    // The whole clean morning with the token: no line, no note, so no message, as before.
    const { env, handed } = cleanMorning({ WORKFLOW_RUN: TOKEN });
    expect(await runWatchdog(env, morning)).toEqual({ alerts: [], notices: [], sent: false });
    expect(handed).toEqual([]);
  });

  it("names a refused token by its status, in the email, never the token", async () => {
    for (const status of [401, 403]) {
      vi.restoreAllMocks();
      fakeGitHub(answers(status));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const inputs = await gatherInputs(tokenEnv(), now);
      expect(inputs.workflowToken).toEqual({ state: "refused", status });
      expect(collectAlerts(inputs)).toEqual([refusedLine(status)]);
      expect(collectNotes(inputs)).toEqual([]);
      // The whole check: one item, and the message carries it.
      const { env, handed } = cleanMorning({ WORKFLOW_RUN: TOKEN });
      const result = await runWatchdog(env, morning);
      expect(result).toEqual({ alerts: [refusedLine(status)], notices: [], sent: true });
      expect(handed[0]).toContain(`Subject: Award Watch: 1 item need attention\r\n`);
      expect(handed[0]).toContain(`1. ${refusedLine(status)}`);
      for (const text of [handed[0], log.mock.calls.flat().join(" ")]) {
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain("Bad credentials");
      }
    }
  });

  it("names the day the token expires from 14 days before it", async () => {
    expect(WORKFLOW_TOKEN_WARN_DAYS).toBe(14);
    const at = (header: string) => collectAlerts({ ...healthy, workflowToken: { state: "accepted", expires: readTokenExpiry(header) } });
    // now is 2026-10-20T06:00Z: exactly 14 days ahead is within, a second more is not.
    expect(at("2026-11-03 06:00:00 UTC")).toEqual([expiryLine("2026-11-03")]);
    expect(at("2026-11-03 06:00:01 UTC")).toEqual([]);
    expect(at("2026-10-21 00:00:00 UTC")).toEqual([expiryLine("2026-10-21")]);
    // The day is UTC's: 23:30 at -07:00 is the next day.
    expect(at("2026-10-25 23:30:00 -0700")).toEqual([expiryLine("2026-10-26")]);
    // From the answer's header, through the read.
    fakeGitHub(answers(200, { "github-authentication-token-expiration": "2026-10-30 12:00:00 UTC" }));
    expect(collectAlerts(await gatherInputs(tokenEnv(), now))).toEqual([expiryLine("2026-10-30")]);
  });

  it("reads the end date as GitHub writes it, and nothing else", () => {
    expect(readTokenExpiry("2026-12-01 00:00:00 UTC")).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(readTokenExpiry("2026-12-01 00:00:00 -0700")).toEqual(new Date("2026-12-01T07:00:00Z"));
    expect(readTokenExpiry("2026-12-01 00:00:00 +05:30")).toEqual(new Date("2026-11-30T18:30:00Z"));
    expect(readTokenExpiry(" 2026-12-01T00:00:00Z ")).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(readTokenExpiry("2026-12-01 00:00:00")).toEqual(new Date("2026-12-01T00:00:00Z"));
    for (const odd of [null, "", "soon", "2026-12-01", "2026-13-01 00:00:00 UTC", "2026-12-01 24:00:00 UTC", `2026-12-01 00:00:00 UTC ${TOKEN}`]) {
      expect(readTokenExpiry(odd), String(odd)).toBeNull();
    }
  });

  it("logs an end date that does not read and says nothing of it", async () => {
    fakeGitHub(answers(200, { "github-authentication-token-expiration": "next spring" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const inputs = await gatherInputs(tokenEnv(), now);
    expect(inputs.workflowToken).toEqual({ state: "accepted", expires: null });
    expect(collectAlerts(inputs)).toEqual([]);
    expect(log.mock.calls.flat().join(" ")).toContain("watchdog: the WORKFLOW_RUN token's end date did not read");
  });

  it("notes a Worker without the secret or the repository quietly: no read, no item, never the reason to send", async () => {
    const calls = fakeGitHub(answers(200));
    const unset = await gatherInputs({ ...testEnv(), DATA: healthyBucket, SEARCH: fakeD1(cleanRuns).db, ACCOUNTS: undefined }, now);
    expect(unset.workflowToken).toEqual({ state: "unset", missing: "WORKFLOW_RUN" });
    const noRepo = await gatherInputs(tokenEnv({ WORKFLOW_REPO: "" }), now);
    expect(noRepo.workflowToken).toEqual({ state: "unset", missing: "WORKFLOW_REPO" });
    expect(calls).toEqual([]);
    expect(collectAlerts(unset)).toEqual([]);
    expect(collectNotices(unset)).toEqual([]);
    expect(collectNotes(unset)).toEqual([NO_SECRET]);
    expect(collectNotes(noRepo)).toEqual([NO_SECRET.replace("no WORKFLOW_RUN secret", "no WORKFLOW_REPO variable")]);
    // A morning with nothing else to say sends nothing.
    const quiet = cleanMorning();
    expect(await runWatchdog(quiet.env, morning)).toEqual({ alerts: [], notices: [], sent: false });
    expect(quiet.handed).toEqual([]);
    // A message that goes anyway (the day's figures) carries it at its foot, counted in nothing.
    const line = "2026-10-31 (UTC): accounts 12 (new 2), sign-in codes asked for 3";
    const figures = cleanMorning({}, line);
    expect(await runWatchdog(figures.env, morning)).toEqual({ alerts: [], notices: [], sent: true });
    expect(figures.handed[0]).toContain("Subject: Award Watch: figures for 2026-10-31\r\n");
    expect(figures.handed[0]).toContain(`- ${line}\r\n\r\nNote: ${NO_SECRET}\r\n\r\nRun log:`);
    // buildEmail without notes is the message as it was.
    expect(buildEmail("a@b.ca", "c@d.ca", ["x"], now, [], {}, null, [])).toBe(buildEmail("a@b.ca", "c@d.ca", ["x"], now));
  });

  it("makes a fault reaching GitHub, or an answer of another kind, a log line and nothing in the email", async () => {
    const cases: [() => Response, string][] = [
      [() => {
        throw new TypeError(`fetch to ${READ_URL} failed with Bearer ${TOKEN}`);
      }, "watchdog: the WORKFLOW_RUN token not checked (TypeError)"],
      [answers(404), "watchdog: the WORKFLOW_RUN token not checked (HTTP 404)"],
      [answers(500), "watchdog: the WORKFLOW_RUN token not checked (HTTP 500)"],
    ];
    for (const [answer, said] of cases) {
      vi.restoreAllMocks();
      fakeGitHub(answer);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const inputs = await gatherInputs(tokenEnv(), now);
      expect(inputs.workflowToken, said).toBeNull();
      expect(collectAlerts(inputs), said).toEqual([]);
      expect(collectNotes(inputs), said).toEqual([]);
      const text = log.mock.calls.flat().join("\n");
      expect(text).toContain(said);
      expect(text).not.toContain(TOKEN);
      // The read never throws out of the check.
      await expect(readWorkflowToken(tokenEnv())).resolves.toBeNull();
    }
  });
});

describe("daily check: a late night", () => {
  const night = (runStarted: string | undefined, runAt: string) =>
    ({ ...healthy, status: { ...healthy.status, run_at: runAt, ...(runStarted ? { run_started: runStarted } : {}) } });
  const WHY = " Either the slot's run failed and a later slot ran the night, or no run started on time: check the nightly's runs, " +
    "the Worker's dispatch lines in its logs and the WORKFLOW_RUN token (docs/site-deploy.md, What starts the runs).";
  const started = (at: string) => `The last nightly refresh started at ${at} UTC, more than 3 hours after its day's 12:30 UTC slot.${WHY}`;

  it("names a refresh that started more than 3 hours after its day's 12:30 slot, and no other", () => {
    expect([NIGHTLY_SLOT_UTC, LATE_START_HOURS, LATE_END_UTC]).toEqual(["12:30", 3, "17:00"]);
    // now is 2026-10-20T06:00Z. The Worker's 12:30 start on a normal day: nothing.
    expect(collectAlerts(night("2026-10-19T12:44:10Z", "2026-10-19T14:48:00Z"))).toEqual([]);
    // Exactly 3 hours after the slot is not more than 3.
    expect(collectAlerts(night("2026-10-19T15:30:00Z", "2026-10-19T17:40:00Z"))).toEqual([]);
    expect(collectAlerts(night("2026-10-19T15:30:01Z", "2026-10-19T17:40:00Z"))).toEqual([started("2026-10-19T15:30")]);
    // GitHub's schedule alone, as on 2026-11-18, or the 20:30 slot after two failed runs.
    expect(collectAlerts(night("2026-10-19T20:49:10Z", "2026-10-19T23:02:00Z"))).toEqual([started("2026-10-19T20:49")]);
    expect(collectAlerts(night("2026-10-19T20:44:00+00:00", "2026-10-19T22:58:00+00:00"))).toEqual([started("2026-10-19T20:44")]);
    // A run started by hand in the night, or a stray trigger after midnight: before its day's slot, nothing.
    expect(collectAlerts(night("2026-10-20T01:56:00Z", "2026-10-20T04:10:00Z"))).toEqual([]);
    expect(collectAlerts(night("2026-10-20T03:08:00Z", "2026-10-20T05:15:00Z"))).toEqual([]);
  });

  it("reads a status written before the start was recorded by its end, after 17:00 UTC", () => {
    expect(collectAlerts(healthy)).toEqual([]);
    expect(collectAlerts(night(undefined, "2026-10-19T17:00:00Z"))).toEqual([]);
    expect(collectAlerts(night(undefined, "2026-10-19T21:30:00Z"))).toEqual([
      `The last nightly refresh finished at 2026-10-19T21:30 UTC, after 17:00 UTC.${WHY}`]);
  });

  it("says nothing of a status older than the last night, which the stale line already dates", () => {
    expect(collectAlerts(night("2026-10-17T20:49:10Z", "2026-10-17T23:02:00Z"))).toEqual(["The last completed run was 2026-10-17T23:02 UTC."]);
    expect(lateNight({ run_started: "2026-10-20T20:49:10Z", run_at: "2026-10-20T23:02:00Z" }, now)).toBeNull();
    expect(lateNight({ run_started: "2026-10-19T20:49:10Z" }, now)).toBeNull();
  });

  it("reads run_started from status.json, and drops one that does not read without an alert", () => {
    expect(readStatus({ ...healthy.status, run_started: "2026-10-19T12:44:10+00:00" })).toEqual({
      status: { ...healthy.status, run_started: "2026-10-19T12:44:10+00:00" }, problem: null,
    });
    for (const odd of [null, 5, "soon", "", ["2026-10-19T12:44:10Z"]]) {
      expect(readStatus({ ...healthy.status, run_started: odd }), JSON.stringify(odd)).toEqual({ status: healthy.status, problem: null });
    }
  });

  it("comes from the status in R2 into the email", async () => {
    const status = { ...healthy.status, run_started: "2026-10-19T20:49:10+00:00", run_at: "2026-10-19T23:02:00+00:00" };
    const bucket = {
      head: async () => ({ uploaded: new Date("2026-10-20T00:50:00Z") }),
      get: async (key: string) => (key === "status.json" ? { text: async () => JSON.stringify(status) } : null),
    } as unknown as R2Bucket;
    const inputs = await gatherInputs({ ...testEnv(), DATA: bucket, SEARCH: fakeD1(cleanRuns).db, ACCOUNTS: undefined }, now);
    expect(collectAlerts(inputs)).toEqual([started("2026-10-19T20:49")]);
  });
});
