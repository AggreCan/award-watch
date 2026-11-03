import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import accountsSchema from "../accounts_schema.sql?raw";
import { LIVE_PRO_SQL, planFromRows, type EntitlementRow } from "../src/account/entitlements";
import {
  BACKUP_KEY, INTRADAY_RUNS_SQL, INTRADAY_STEP_NOTICES, LOOKUP_MAX_BYTES, buildEmail, collectAlerts, collectNotices,
  gatherInputs, readIntradayRuns, readStatus, runWatchdog,
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
    // The backup is in parts; the first part's upload time is the backup's.
    expect(asked).toEqual(["awardwatch.sqlite.gz.000"]);
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

describe("daily check: the same-day refresh's runs", () => {
  const runs = (answer: Record<string, unknown>, livePro: number | null = 1) => ({
    ...healthy, intraday: readIntradayRuns(answer), intradayProblem: null, livePro,
  });

  it("reads the last 24 hours of runs and the live paid plans with one prepared statement each", async () => {
    const search = fakeD1(cleanRuns);
    const accounts = fakeD1({ n: 2 });
    const inputs = await gatherInputs({ ...testEnv(), SEARCH: search.db, ACCOUNTS: accounts.db }, now);
    // The window's bound written as intraday_runs writes its times; the plans' instant as toISOString writes it.
    expect(search.calls).toEqual([{ sql: INTRADAY_RUNS_SQL, params: ["2026-10-19T06:00:00Z"] }]);
    expect(accounts.calls).toEqual([{ sql: LIVE_PRO_SQL, params: ["2026-10-20T06:00:00.000Z"] }]);
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
