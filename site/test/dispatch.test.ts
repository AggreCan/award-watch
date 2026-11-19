// What starts the runs (src/dispatch.ts, docs/site-deploy.md): the Worker's
// own cron starts the nightly and the same-day job through GitHub's API. The
// one request, its address, method, body and headers; nothing sent without
// the secret or the variable; every answer and every fault one log line
// without the token; the time limit; the scheduled handler's routing by the
// exact expression, the four cron constants held to wrangler.jsonc and to the
// workflows' schedules; and no request to the site starting a run. Every
// token here is made up, and fetch is a fake: nothing reaches GitHub.
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { app } from "../src/index";
import { DELIVERY_CRON } from "../src/account/deliveries";
import { DISPATCH_REF, NIGHTLY_CRON, NIGHTLY_INPUTS, SAME_DAY_CRON, startWorkflow } from "../src/dispatch";
import { GITHUB_API, GITHUB_TIMEOUT_MS, GITHUB_USER_AGENT, INTRADAY_WORKFLOW, NIGHTLY_WORKFLOW, type WorkflowFile, workflowRepo } from "../src/github";
import { DAILY_RUNS_UTC, SAME_DAY_RUNS_UTC } from "../src/refresh";
import { BACKUP_KEY, WATCHDOG_CRON } from "../src/watchdog";
import nightlyYml from "../../.github/workflows/nightly.yml?raw";
import intradayYml from "../../.github/workflows/intraday.yml?raw";
import wrangler from "../wrangler.jsonc?raw";
import { testEnv } from "./assets";

const TOKEN = "made-up-token-for-tests-0000";
const REPO = "AggreCan/award-watch";
const BASE = `${GITHUB_API}/repos/${REPO}/actions/workflows`;

afterEach(() => {
  vi.restoreAllMocks();
});

type Call = { url: string; method: string; headers: Record<string, string>; body: string | null; signal: AbortSignal | null };

// fetch replaced by a fake that records each request and answers with
// answer(call), or throws what it throws.
function fakeGitHub(answer: (call: Call) => Response | Promise<Response> = () => new Response(null, { status: 204 })) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const call: Call = {
      url,
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : null,
      signal: init?.signal ?? null,
    };
    calls.push(call);
    return answer(call);
  });
  return calls;
}

// Every console line the code writes, as one text.
function logged() {
  const spies = (["log", "error", "warn", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  return () => spies.flatMap((s) => s.mock.calls.flat().map(String)).join("\n");
}

const withToken = (extra: object = {}) => ({ ...testEnv(), WORKFLOW_RUN: TOKEN, ...extra }) as never;

describe("starting a workflow", () => {
  it("sends one request: the address, the method, the body and the headers", async () => {
    const calls = fakeGitHub();
    const log = logged();
    expect(await startWorkflow(withToken(), NIGHTLY_WORKFLOW, { ...NIGHTLY_INPUTS })).toBe("started");
    expect(await startWorkflow(withToken(), INTRADAY_WORKFLOW)).toBe("started");
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", `${BASE}/nightly.yml/dispatches`],
      ["POST", `${BASE}/intraday.yml/dispatches`],
    ]);
    // The body as GitHub takes it: the branch, and the nightly's one input; the same-day job gets none.
    expect(calls[0].body).toBe('{"ref":"main","inputs":{"gate":"true"}}');
    expect(calls[1].body).toBe('{"ref":"main"}');
    expect(DISPATCH_REF).toBe("main");
    for (const c of calls) {
      expect(c.headers).toEqual({
        authorization: `Bearer ${TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "awardwatch.ca",
        "content-type": "application/json",
      });
      expect(c.signal).toBeInstanceOf(AbortSignal);
    }
    // The site's name, no person and no address.
    expect(GITHUB_USER_AGENT).not.toMatch(/@|\s/);
    expect(log()).toBe("dispatch: nightly.yml started (HTTP 204)\ndispatch: intraday.yml started (HTTP 204)");
  });

  it("sends nothing without the secret or the repository, and says which is missing", async () => {
    const calls = fakeGitHub();
    const log = logged();
    // The variable ships in wrangler.jsonc; the test runtime reads it from there.
    expect(workflowRepo(testEnv() as never)).toBe(REPO);
    for (const token of [undefined, "", "   "]) {
      expect(await startWorkflow({ ...testEnv(), WORKFLOW_RUN: token } as never, NIGHTLY_WORKFLOW, { ...NIGHTLY_INPUTS })).toBe("not set");
    }
    for (const repo of [undefined, "", "award-watch", "AggreCan/award-watch/extra", "AggreCan/..", "https://evil.example/x", "Aggre Can/award-watch"]) {
      expect(await startWorkflow(withToken({ WORKFLOW_REPO: repo }), INTRADAY_WORKFLOW), String(repo)).toBe("not set");
    }
    expect(calls).toEqual([]);
    const lines = log().split("\n");
    expect(lines.slice(0, 3)).toEqual(Array(3).fill("dispatch: nightly.yml not started: no WORKFLOW_RUN secret; GitHub's own schedule starts it"));
    expect(new Set(lines.slice(3))).toEqual(new Set(["dispatch: intraday.yml not started: no WORKFLOW_REPO variable; GitHub's own schedule starts it"]));
  });

  it("logs every answer by its workflow and status, never the token, the answer's body or the request's headers", async () => {
    const body = JSON.stringify({ message: "Bad credentials", echoed: `Bearer ${TOKEN}`, documentation_url: "https://docs.github.com/rest" });
    for (const [status, outcome] of [[204, "started"], [200, "started"], [401, "refused"], [403, "refused"], [422, "refused"], [500, "refused"]] as const) {
      vi.restoreAllMocks();
      fakeGitHub(() => new Response(status === 204 ? null : body, { status, headers: { "x-echo": TOKEN } }));
      const log = logged();
      expect(await startWorkflow(withToken(), NIGHTLY_WORKFLOW, { ...NIGHTLY_INPUTS }), String(status)).toBe(outcome);
      const text = log();
      expect(text, String(status)).toBe(outcome === "started"
        ? `dispatch: nightly.yml started (HTTP ${status})`
        : `dispatch: nightly.yml refused (HTTP ${status}); GitHub's own schedule starts it`);
      for (const secret of [TOKEN, "Bad credentials", "Bearer", "x-echo"]) expect(text, `${status}: ${secret}`).not.toContain(secret);
    }
  });

  it("takes a fault reaching GitHub as one line by the fault's kind, and never throws", async () => {
    fakeGitHub((c) => {
      throw new TypeError(`fetch to ${c.url} failed with ${c.headers.authorization}`);
    });
    const log = logged();
    await expect(startWorkflow(withToken(), INTRADAY_WORKFLOW)).resolves.toBe("failed");
    expect(log()).toBe("dispatch: intraday.yml not started (TypeError); GitHub's own schedule starts it");
    // A fault that is not an Error, or whose name is not a word, is named Error.
    vi.restoreAllMocks();
    fakeGitHub(() => {
      throw { name: `Bearer ${TOKEN}` };
    });
    const again = logged();
    await expect(startWorkflow(withToken(), NIGHTLY_WORKFLOW, { ...NIGHTLY_INPUTS })).resolves.toBe("failed");
    expect(again()).toBe("dispatch: nightly.yml not started (object); GitHub's own schedule starts it");
    expect(again()).not.toContain(TOKEN);
  });

  it("gives up after its time limit of 10 seconds", async () => {
    expect(GITHUB_TIMEOUT_MS).toBe(10_000);
    // The limit is the signal handed to fetch; a signal that has fired stops the request as fetch would.
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() =>
      AbortSignal.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")));
    const calls = fakeGitHub((c) => {
      if (c.signal?.aborted) throw c.signal.reason;
      return new Response(null, { status: 204 });
    });
    const log = logged();
    expect(await startWorkflow(withToken(), NIGHTLY_WORKFLOW, { ...NIGHTLY_INPUTS })).toBe("failed");
    expect(timeout).toHaveBeenCalledWith(GITHUB_TIMEOUT_MS);
    expect(calls).toHaveLength(1);
    expect(log()).toBe("dispatch: nightly.yml not started (TimeoutError); GitHub's own schedule starts it");
  });

  it("starts only the two workflows it names", async () => {
    const calls = fakeGitHub();
    const log = logged();
    expect(await startWorkflow(withToken(), "deploy-site.yml" as WorkflowFile)).toBe("failed");
    expect(calls).toEqual([]);
    expect(log()).toBe("dispatch: not a workflow this Worker starts; nothing sent");
  });
});

// -- the scheduled handler ---------------------------------------------------------------------

async function fire(cron: string, env: object): Promise<void> {
  const ctx = createExecutionContext();
  worker.scheduled(createScheduledController({ cron, scheduledTime: Date.parse("2026-11-19T12:30:00Z") }), env as never, ctx);
  await waitOnExecutionContext(ctx);
}

// An environment whose databases and bucket record what is asked of them: the
// delivery job writes its run row to ACCOUNTS (no MAIL binding, so it sends
// nothing), the daily check heads the backup in DATA, and a start asks fetch.
function recordingEnv() {
  const seen: string[] = [];
  const db = (name: string) => {
    const statement = (sql: string) => {
      seen.push(`${name}: ${sql.slice(0, 32)}`);
      const s = { bind: () => s, first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) };
      return s;
    };
    return { prepare: statement, batch: async () => [] };
  };
  const bucket = {
    head: async (key: string) => (seen.push(`DATA head ${key}`), null),
    get: async (key: string) => (seen.push(`DATA get ${key}`), null),
  };
  const env = {
    ...testEnv(), ACCOUNTS_ENABLED: "true", ACCOUNTS: db("ACCOUNTS"), SEARCH: db("SEARCH"), DATA: bucket, MAIL: undefined,
    WORKFLOW_RUN: TOKEN, ALERT_EMAIL: "", ALERT_FROM: "",
  };
  return { seen, env };
}

describe("the scheduled handler", () => {
  it("runs each job for its own expression, and nothing for any other", async () => {
    const answer = (c: Call) => new Response(c.method === "GET" ? "{}" : null, { status: c.method === "GET" ? 200 : 204 });

    // The deliveries: their run row, and nothing else.
    let calls = fakeGitHub(answer);
    let log = logged();
    let r = recordingEnv();
    await fire(DELIVERY_CRON, r.env);
    expect(r.seen.filter((s) => s.startsWith("ACCOUNTS: INSERT INTO delivery_runs"))).toHaveLength(1);
    expect(r.seen.filter((s) => s.startsWith("DATA"))).toEqual([]);
    expect(calls).toEqual([]);

    // The daily check: the backup's head, its one read of the token (a GET), and no delivery row.
    vi.restoreAllMocks();
    calls = fakeGitHub(answer);
    log = logged();
    r = recordingEnv();
    await fire(WATCHDOG_CRON, r.env);
    expect(r.seen).toContain(`DATA head ${BACKUP_KEY}`);
    expect(r.seen.filter((s) => s.includes("INSERT INTO delivery_runs"))).toEqual([]);
    expect(calls.map((c) => [c.method, c.url])).toEqual([["GET", `${BASE}/nightly.yml`]]);

    // The nightly's slots: one start of nightly.yml with the gate's input, and nothing read.
    vi.restoreAllMocks();
    calls = fakeGitHub(answer);
    log = logged();
    r = recordingEnv();
    await fire(NIGHTLY_CRON, r.env);
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([["POST", `${BASE}/nightly.yml/dispatches`, '{"ref":"main","inputs":{"gate":"true"}}']]);
    expect(r.seen).toEqual([]);

    // The same-day job's: one start of intraday.yml without an input.
    vi.restoreAllMocks();
    calls = fakeGitHub(answer);
    log = logged();
    r = recordingEnv();
    await fire(SAME_DAY_CRON, r.env);
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([["POST", `${BASE}/intraday.yml/dispatches`, '{"ref":"main"}']]);
    expect(r.seen).toEqual([]);
    expect(log()).toBe("dispatch: intraday.yml started (HTTP 204)");

    // Any other expression, GitHub's own schedule strings and near misses included: nothing, and one line.
    for (const cron of ["0 7 * * *", "30 12 * * *", "45 11-23/2 * * *", "0 6 * * * ", " 0 6 * * *", "0 15-20 * * 1", ""]) {
      vi.restoreAllMocks();
      calls = fakeGitHub(answer);
      log = logged();
      r = recordingEnv();
      await fire(cron, r.env);
      expect(calls, JSON.stringify(cron)).toEqual([]);
      expect(r.seen, JSON.stringify(cron)).toEqual([]);
      expect(log(), JSON.stringify(cron)).toBe(`scheduled: no job for the cron "${cron}"; nothing run`);
    }
  });

  it("never throws when GitHub cannot be reached, and logs no token", async () => {
    fakeGitHub(() => {
      throw new TypeError(`connection refused, ${TOKEN}`);
    });
    const log = logged();
    await fire(NIGHTLY_CRON, recordingEnv().env);
    await fire(SAME_DAY_CRON, recordingEnv().env);
    expect(log()).toBe([
      "dispatch: nightly.yml not started (TypeError); GitHub's own schedule starts it",
      "dispatch: intraday.yml not started (TypeError); GitHub's own schedule starts it",
    ].join("\n"));
  });
});

// -- the constants, wrangler.jsonc and the workflows --------------------------------------------

// The minute and hour fields of a cron expression as the UTC times it runs
// ("HH:MM"): numbers, lists, ranges and steps; day, month and weekday "*".
function cronTimes(expr: string): string[] {
  const [minute, hour, ...rest] = expr.split(" ");
  expect(rest, expr).toEqual(["*", "*", "*"]);
  const field = (f: string, max: number) => f.split(",").flatMap((part) => {
    const [range, step] = part.split("/");
    const [lo, hi] = range === "*" ? [0, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), step ? max : Number(range)];
    const out: number[] = [];
    for (let v = lo; v <= hi; v += step ? Number(step) : 1) out.push(v);
    return out;
  });
  const pad = (n: number) => String(n).padStart(2, "0");
  return field(hour, 23).flatMap((h) => field(minute, 59).map((m) => `${pad(h)}:${pad(m)}`)).sort();
}

const schedules = (yml: string) => [...yml.matchAll(/^\s*- cron: "([^"]+)"/gm)].map((m) => m[1]);

describe("the cron triggers", () => {
  it("are the four constants, in wrangler.jsonc's order, each routed to its own job", () => {
    const crons = JSON.parse(`[${/"triggers": \{ "crons": \[([^\]]*)\] \}/.exec(wrangler)?.[1] ?? ""}]`) as string[];
    expect(crons).toEqual([WATCHDOG_CRON, DELIVERY_CRON, NIGHTLY_CRON, SAME_DAY_CRON]);
    expect([WATCHDOG_CRON, DELIVERY_CRON, NIGHTLY_CRON, SAME_DAY_CRON]).toEqual([
      "0 6 * * *", "0 15-20 * * *", "30 12,16,20 * * *", "45 1,3,11,13,15,17,19,21,23 * * *",
    ]);
    // Five fields of what Cloudflare's cron takes (numbers, "*", ",", "-", "/"), every one apart.
    for (const cron of crons) expect(cron).toMatch(/^[0-9*,/-]+( [0-9*,/-]+){4}$/);
    expect(new Set(crons).size).toBe(4);
  });

  it("start the workflows at the times their own schedules give", () => {
    // The nightly: its three schedules, the run and the two retries; the top bar's timer names the first.
    expect(cronTimes(NIGHTLY_CRON)).toEqual(schedules(nightlyYml).flatMap(cronTimes).sort());
    expect(cronTimes(NIGHTLY_CRON)).toEqual(["12:30", "16:30", "20:30"]);
    expect(cronTimes(NIGHTLY_CRON)[0]).toBe(DAILY_RUNS_UTC[0]);
    // The same-day job: its two schedules, which are the top bar's nine times.
    expect(cronTimes(SAME_DAY_CRON)).toEqual(schedules(intradayYml).flatMap(cronTimes).sort());
    expect(cronTimes(SAME_DAY_CRON)).toEqual([...SAME_DAY_RUNS_UTC].sort());
  });

  it("start the repository the run log names", () => {
    expect(/"WORKFLOW_REPO": "([^"]+)"/.exec(wrangler)?.[1]).toBe(REPO);
    expect(wrangler).toContain(`"RUN_LOG_URL": "https://github.com/${REPO}/actions/workflows/nightly.yml"`);
    // The token is a secret, never a variable.
    expect(wrangler).not.toMatch(/"WORKFLOW_RUN":/);
  });
});

// -- no request starts a run --------------------------------------------------------------------

const SOURCES = import.meta.glob("../src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
// A file's code without its comments.
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("no request to the site", () => {
  it("reaches the dispatch: one importer, the scheduled handler, and one host", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30);
    const importers = Object.keys(SOURCES).filter((f) => /from\s+["'](?:\.\.?\/)+dispatch["']/.test(code(SOURCES[f])));
    expect(importers).toEqual(["../src/index.tsx"]);
    const naming = Object.keys(SOURCES).filter((f) => /\bstartWorkflow\b/.test(code(SOURCES[f])));
    expect(naming.sort()).toEqual(["../src/dispatch.ts", "../src/index.tsx"]);
    // In index.tsx, only inside the default export's scheduled handler, past every route.
    const index = code(SOURCES["../src/index.tsx"]);
    const handler = index.indexOf("scheduled(event: ScheduledController");
    expect(handler).toBeGreaterThan(index.lastIndexOf("app.get("));
    expect(handler).toBeGreaterThan(index.indexOf("export default {"));
    const uses = [...index.matchAll(/\bstartWorkflow\(/g)].map((m) => m.index!);
    expect(uses).toHaveLength(2);
    for (const at of uses) expect(at).toBeGreaterThan(handler);
    // The token is read in the dispatch and the daily check's one read, and declared in env.ts.
    const reading = Object.keys(SOURCES).filter((f) => /\bWORKFLOW_RUN\b/.test(code(SOURCES[f])));
    expect(reading.sort()).toEqual(["../src/dispatch.ts", "../src/env.ts", "../src/watchdog.ts"]);
    expect(code(SOURCES["../src/env.ts"])).toMatch(/^\s*WORKFLOW_RUN\?: string;$/m);
    // One host: the only address either module can send to is GitHub's API.
    for (const f of ["../src/dispatch.ts", "../src/github.ts"]) {
      expect(code(SOURCES[f]).match(/https?:\/\/[^\s"'`]*/g) ?? [], f).toEqual(f.endsWith("github.ts") ? [GITHUB_API] : []);
    }
    expect(GITHUB_API).toBe("https://api.github.com");
    expect(code(SOURCES["../src/dispatch.ts"]).match(/\bfetch\(/g)).toHaveLength(1);
  });

  it("sends anything to GitHub, whatever the route, with the token set", async () => {
    const calls = fakeGitHub();
    logged();
    const env = { ...withToken() as object, ACCOUNTS_ENABLED: "true" };
    for (const [method, path] of [
      ["GET", "/"], ["GET", "/tenders"], ["GET", "/overview"], ["GET", "/api/stats"], ["GET", "/refresh.json"], ["GET", "/account"],
      ["GET", "/admin"], ["POST", "/admin/mail-check"], ["POST", "/interest"], ["GET", "/no-such-page"], ["GET", "/dispatches"],
    ] as const) {
      await app.request(path, { method, headers: { "cf-connecting-ip": "198.18.200.1", "sec-fetch-mode": "navigate" } }, env as never);
    }
    expect(calls.filter((c) => c.url.startsWith(GITHUB_API))).toEqual([]);
  });
});
