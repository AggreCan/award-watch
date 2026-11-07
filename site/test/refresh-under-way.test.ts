// The top bar's timers while a run is under way (src/refresh.tsx,
// public/refresh.js): the state rule against the data stamp, the server's
// first render in both states and both languages, /refresh.json, the
// script's loop (a request only while a run is under way, the reload link
// once), the width rule for the under-way figure, and no em-dash.
import { env } from "cloudflare:test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DAILY_RUN_MINUTES, POLL_MS, RUN_MINUTES, SAME_DAY_RUN_MINUTES, STAMPS_PATH, clockTime, fetchStamps, lastRunBefore, nextRunAt, refreshLoop,
  refreshState, refreshText, runningText, stampMs,
} from "../public/refresh.js";
import { bodyEtag } from "../src/conditional";
import { dataStamp } from "../src/data";
import { t } from "../src/i18n";
import { app } from "../src/index";
import { LAST_CUT_SQL, loadLastCut } from "../src/intraday";
import { bucketFor } from "../src/limits";
import {
  DAILY_RUNS_UTC, SAME_DAY_RUNS_UTC, SAME_DAY_STAMP_MAX_HOURS, STAMPS_MAX_AGE, forgetRefreshStamps, refreshFigure, refreshWords,
} from "../src/refresh";
import { routeTemplate } from "../src/views";
import { FILES, emptyAssets, makeFakeAssets, testEnv } from "./assets";
import { applySql } from "./setup";

const at = (iso: string) => Date.parse(iso);
const EM_DASH = String.fromCharCode(0x2014);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const INTRADAY_SCHEMA = (env as unknown as { INTRADAY_SCHEMA_SQL: string }).INTRADAY_SCHEMA_SQL;

const running = (since: string) => ({ state: "running", since: at(since) });
const countdown = (target: string) => ({ state: "countdown", target: at(target) });

describe("the state rule", () => {
  // The nightly's stamp from the day before: the run of 2026-11-06 12:30 ended its stages at 13:02.
  const YESTERDAY = "2026-11-06T13:02:11Z";

  it("counts down to the run while the data is from the run before", () => {
    expect(refreshState(at("2026-11-07T10:00:00Z"), DAILY_RUNS_UTC, YESTERDAY)).toEqual(countdown("2026-11-07T12:30:00Z"));
    expect(refreshState(at("2026-11-07T12:29:59Z"), DAILY_RUNS_UTC, YESTERDAY)).toEqual(countdown("2026-11-07T12:30:00Z"));
  });

  it("reads the run as under way from its scheduled time while the data is older", () => {
    expect(refreshState(at("2026-11-07T12:30:00Z"), DAILY_RUNS_UTC, YESTERDAY)).toEqual(running("2026-11-07T12:30:00Z"));
    // GitHub started the job late and the deploy is not out yet: still under way, since the scheduled time.
    expect(refreshState(at("2026-11-07T13:40:00Z"), DAILY_RUNS_UTC, YESTERDAY)).toEqual(running("2026-11-07T12:30:00Z"));
    expect(refreshState(at("2026-11-07T23:59:00Z"), DAILY_RUNS_UTC, YESTERDAY)).toEqual(running("2026-11-07T12:30:00Z"));
  });

  it("resumes the countdown to the next run once data later than the run is in, however late it came", () => {
    // The late start's data, stamped 13:55, an hour and a half after the schedule.
    expect(refreshState(at("2026-11-07T14:00:00Z"), DAILY_RUNS_UTC, "2026-11-07T13:55:00Z")).toEqual(countdown("2026-11-08T12:30:00Z"));
    // A retry's data (the 16:30 schedule) counts the same.
    expect(refreshState(at("2026-11-07T17:00:00Z"), DAILY_RUNS_UTC, "2026-11-07T16:41:00Z")).toEqual(countdown("2026-11-08T12:30:00Z"));
  });

  it("counts down from data newer than the run, a stamp ahead of a slow clock included", () => {
    expect(refreshState(at("2026-11-07T16:00:00Z"), DAILY_RUNS_UTC, "2026-11-07T12:58:00Z")).toEqual(countdown("2026-11-08T12:30:00Z"));
    // The visitor's clock is five minutes slow: the stamp reads later than now, and the run is still delivered.
    expect(refreshState(at("2026-11-07T13:20:00Z"), DAILY_RUNS_UTC, "2026-11-07T13:25:00Z")).toEqual(countdown("2026-11-08T12:30:00Z"));
  });

  it("reads two missed runs as one refresh under way since the first of them", () => {
    expect(refreshState(at("2026-11-07T14:00:00Z"), DAILY_RUNS_UTC, "2026-11-05T13:02:00Z")).toEqual(running("2026-11-06T12:30:00Z"));
    // Same-day: the 11:45 cut is in, the 13:45 and 15:45 ones are not.
    expect(refreshState(at("2026-11-07T16:00:00Z"), SAME_DAY_RUNS_UTC, "2026-11-07T11:52:00Z")).toEqual(running("2026-11-07T13:45:00Z"));
  });

  it("follows the same-day cuts through the day, across midnight and the night's gap", () => {
    const cut1345 = "2026-11-07T13:51:30Z";
    expect(refreshState(at("2026-11-07T14:30:00Z"), SAME_DAY_RUNS_UTC, cut1345)).toEqual(countdown("2026-11-07T15:45:00Z"));
    expect(refreshState(at("2026-11-07T15:45:00Z"), SAME_DAY_RUNS_UTC, cut1345)).toEqual(running("2026-11-07T15:45:00Z"));
    expect(refreshState(at("2026-11-07T16:00:00Z"), SAME_DAY_RUNS_UTC, "2026-11-07T15:58:00Z")).toEqual(countdown("2026-11-07T17:45:00Z"));
    expect(refreshState(at("2026-11-08T01:00:00Z"), SAME_DAY_RUNS_UTC, "2026-11-07T23:52:00Z")).toEqual(countdown("2026-11-08T01:45:00Z"));
    expect(refreshState(at("2026-11-08T02:00:00Z"), SAME_DAY_RUNS_UTC, "2026-11-07T23:52:00Z")).toEqual(running("2026-11-08T01:45:00Z"));
    // The day's last cut at 03:45, then nothing until 11:45.
    expect(refreshState(at("2026-11-08T11:00:00Z"), SAME_DAY_RUNS_UTC, "2026-11-08T03:50:00Z")).toEqual(countdown("2026-11-08T11:45:00Z"));
    expect(refreshState(at("2026-11-08T11:45:00Z"), SAME_DAY_RUNS_UTC, "2026-11-08T03:50:00Z")).toEqual(running("2026-11-08T11:45:00Z"));
    // A stamp at the scheduled minute itself is not later than the run: still under way.
    expect(refreshState(at("2026-11-07T13:50:00Z"), SAME_DAY_RUNS_UTC, "2026-11-07T13:45:00Z")).toEqual(running("2026-11-07T13:45:00Z"));
  });

  it("counts down as before when the stamp is missing or does not read", () => {
    for (const stamp of [null, undefined, "", "2026-11-07", "yesterday", "2026-11-07 13:02:11", "2026-11-07T13:02:11+01:00"]) {
      const now = at("2026-11-07T13:40:00Z");
      expect(refreshState(now, DAILY_RUNS_UTC, stamp), String(stamp)).toEqual(countdown("2026-11-08T12:30:00Z"));
      expect(refreshState(at("2026-11-07T12:30:00Z"), DAILY_RUNS_UTC, stamp), String(stamp)).toEqual(countdown("2026-11-07T12:30:00Z"));
    }
    expect(refreshState(0, ["noon"], "2026-11-07T13:02:11Z")).toBeNull();
    expect(refreshState(0, ["noon"], null)).toBeNull();
  });

  it("finds the last run before an instant, yesterday's when today's has not come", () => {
    expect(lastRunBefore(at("2026-11-07T12:30:00Z"), DAILY_RUNS_UTC)).toBe(at("2026-11-06T12:30:00Z"));
    expect(lastRunBefore(at("2026-11-07T12:30:01Z"), DAILY_RUNS_UTC)).toBe(at("2026-11-07T12:30:00Z"));
    expect(lastRunBefore(at("2026-11-07T00:10:00Z"), SAME_DAY_RUNS_UTC)).toBe(at("2026-11-06T23:45:00Z"));
    expect(lastRunBefore(at("2026-11-07T05:00:00Z"), SAME_DAY_RUNS_UTC)).toBe(at("2026-11-07T03:45:00Z"));
    expect(stampMs("2026-11-07T13:02:11Z")).toBe(at("2026-11-07T13:02:11Z"));
    expect(stampMs("2026-11-07T13:02:11.250Z")).toBe(at("2026-11-07T13:02:11.250Z"));
    expect(stampMs(1762520531000)).toBeNull();
  });

  it("writes the under-way figure in both forms and both languages, the time in UTC on the server", () => {
    const since = at("2026-11-07T12:30:00Z");
    expect(clockTime(since, true)).toBe("12:30");
    expect(runningText(since, refreshWords("en"), true)).toEqual({ full: "Under way since 12:30", short: "Since 12:30" });
    expect(runningText(since, refreshWords("fr"), true)).toEqual({ full: "En cours depuis 12:30", short: "Depuis 12:30" });
    expect(refreshFigure(at("2026-11-07T13:00:00Z"), DAILY_RUNS_UTC, "2026-11-06T13:02:11Z", refreshWords("en")))
      .toEqual({ full: "Under way since 12:30", short: "Since 12:30" });
    expect(refreshFigure(at("2026-11-07T13:00:00Z"), DAILY_RUNS_UTC, "2026-11-07T12:58:00Z", refreshWords("en"))).toEqual({ text: "23h 30m" });
    // Without a stamp the figure is the countdown refreshText always gave.
    for (const iso of ["2026-11-07T10:00:00Z", "2026-11-07T12:29:30Z", "2026-11-07T12:30:00Z", "2026-11-07T23:50:00Z"]) {
      for (const runs of [DAILY_RUNS_UTC, SAME_DAY_RUNS_UTC]) {
        expect(refreshFigure(at(iso), runs, null, refreshWords("en"))).toEqual({ text: refreshText(at(iso), runs, refreshWords("en")) });
      }
    }
  });
});

// -- the server's first render -----------------------------------------------------------

// The fixture's nightly stamp is 2026-10-31T12:44:03Z (its newest run row); the tests' clock is 16:00 that day.
const withRuns = (runs: unknown[]) => makeFakeAssets({}, { "stats.json": { ...(FILES["stats.json"] as object), runs } });
const OLD = withRuns([{ run_at: "2026-10-30T12:47:00Z", source: "tenders", detail: null, rows_new: 1, ok: 1 }]);
const NO_RUNS = withRuns([]);

let address = 0;
const get = (path: string, opts: { now?: string; assets?: Fetcher; on?: boolean; headers?: Record<string, string> } = {}) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.40.${(address++ % 250) + 1}`, ...opts.headers } },
    { ...testEnv(opts.assets, opts.now), ...(opts.on ? { ACCOUNTS_ENABLED: "true" } : {}) });
const timers = (html: string) => html.match(/<span class="refresh-timers"[\s\S]*?<script type="module" src="\/refresh.js"><\/script><\/span>/)?.[0] ?? "";
// One timer, from its opening tag to the end of its figure.
const timerOf = (html: string, key: string) =>
  timers(html).match(new RegExp(`<(?:span|a) class="refresh"[^>]*data-refresh-key="${key}"[^>]*><span class="refresh-line">[\\s\\S]*?` +
    `<span class="refresh-left">(?:[^<]|<span class="refresh-(?:short|full)">[^<]*<\\/span>)*<\\/span>`))?.[0] ?? "";
const figureOf = (block: string) => block.match(/<span class="refresh-left">((?:[^<]|<span class="refresh-(?:short|full)">[^<]*<\/span>)*)<\/span>/)?.[1] ?? null;
const labelOf = (block: string) => block.match(/<span class="refresh-label">(.*?)<\/span> /)?.[1] ?? null;

describe("the first render", () => {
  it("carries the nightly's stamp and counts down once the run's data is in", async () => {
    const html = await (await get("/")).text();
    const daily = timerOf(html, "daily");
    expect(daily).toContain('data-refresh-key="daily" data-data-at="2026-10-31T12:44:03Z"');
    expect(figureOf(daily)).toBe("20h 30m");
    expect(dataStamp(FILES["stats.json"] as Parameters<typeof dataStamp>[0])).toBe("2026-10-31T12:44:03Z");
    // The newest row whatever the order, seconds and a Z whatever the row wrote; none that reads, no stamp.
    const rows = (...times: string[]) => ({ runs: times.map((run_at) => ({ run_at, source: "x", detail: null, rows_new: null, ok: 1 })) });
    expect(dataStamp(rows("2026-11-07T13:02:11.512Z", "2026-11-07T12:58:00Z"))).toBe("2026-11-07T13:02:11Z");
    expect(dataStamp(rows("not a time", ""))).toBeNull();
  });

  it("reads the daily run as under way while the page's data is older, in English and in French, the labels unchanged", async () => {
    const en = await (await get("/", { assets: OLD })).text();
    const daily = timerOf(en, "daily");
    expect(daily).toContain('data-data-at="2026-10-30T12:47:00Z"');
    expect(figureOf(daily)).toBe('<span class="refresh-short">Since 12:30</span><span class="refresh-full">Under way since 12:30</span>');
    expect(labelOf(daily)).toBe("Daily refresh");
    // The sub-daily timer has no stamp on a page without the band: its countdown as before.
    expect(figureOf(timerOf(en, "same_day"))).toBe("1h 45m");
    expect(timerOf(en, "same_day")).not.toContain("data-data-at");
    const fr = await (await get("/methodology?lang=fr", { assets: OLD })).text();
    const frDaily = timerOf(fr, "daily");
    expect(nbsp(figureOf(frDaily) ?? "")).toBe('<span class="refresh-short">Depuis 12:30</span><span class="refresh-full">En cours depuis 12:30</span>');
    expect(labelOf(frDaily)).toBe('<span class="refresh-short">Quotidienne</span><span class="refresh-full">Actualisation quotidienne</span>');
    expect(nbsp(figureOf(timerOf(fr, "same_day")) ?? "")).toBe("1 h 45 min");
    // The script's words travel on the group as pieces, and the reload link's words beside them.
    expect(timers(en)).toContain(`data-since="${JSON.stringify(["Under way since ", "time", ""]).replace(/"/g, "&quot;")}"`);
    expect(timers(en)).toContain('data-reload="Reload for the new data" data-reload-short="Reload"');
    expect(timers(fr)).toContain('data-reload="Recharger pour les nouvelles données" data-reload-short="Recharger"');
    // The server never draws the reload link: a page it renders carries the newest data it has.
    expect(en).not.toContain("refresh-reload");
  });

  it("counts down as before when stats.json has no run to stamp it", async () => {
    const html = await (await get("/", { assets: NO_RUNS })).text();
    expect(timers(html)).not.toContain("data-data-at");
    expect(figureOf(timerOf(html, "daily"))).toBe("20h 30m");
  });

  it("keeps one ETag across the run's start, the figure left out in both states, and a new one for new data", async () => {
    const before = await get("/methodology", { assets: OLD, now: "2026-10-31T12:29:00Z" });
    const during = await get("/methodology", { assets: OLD, now: "2026-10-31T12:31:00Z" });
    expect(figureOf(timerOf(await before.clone().text(), "daily"))).toBe("1m");
    expect(figureOf(timerOf(await during.clone().text(), "daily"))).toContain("Under way since 12:30");
    expect(before.headers.get("etag")).toBe(during.headers.get("etag"));
    const again = await get("/methodology", { assets: OLD, now: "2026-10-31T12:40:00Z", headers: { "if-none-match": before.headers.get("etag") ?? "" } });
    expect(again.status).toBe(304);
    // The new data's page (another stamp) is another page: a reload gets it, not a 304.
    const fresh = await get("/methodology", { headers: { "if-none-match": before.headers.get("etag") ?? "" } });
    expect(fresh.status).toBe(200);
    // The rule on its own: both figure forms are blanked, the label and the stamp are not.
    const page = (stamp: string, left: string) => new TextEncoder().encode(
      `<span class="refresh" data-data-at="${stamp}"><span class="refresh-line"><span class="refresh-label">Daily refresh</span> <span class="refresh-left">${left}</span></span></span>`).buffer as ArrayBuffer;
    const a = "2026-11-06T13:02:11Z";
    expect(await bodyEtag(page(a, '<span class="refresh-short">Since 12:30</span><span class="refresh-full">Under way since 12:30</span>')))
      .toBe(await bodyEtag(page(a, "9h 48m")));
    expect(await bodyEtag(page(a, "9h 48m"))).not.toBe(await bodyEtag(page("2026-11-07T13:02:11Z", "9h 48m")));
  });
});

// -- the width rule ------------------------------------------------------------------------

describe("the under-way figure in the top bar", () => {
  it("never wraps, and stays within the lengths measured to fit the bar at every width the timers show", async () => {
    const css = env.STYLES_CSS;
    // The figure and the group both hold their lines whole.
    expect(css).toMatch(/\n\.refresh-left \{[^}]*white-space: nowrap; \}/);
    expect(css).toMatch(/\n  \.refresh-timers \{[^}]*white-space: nowrap; \}/);
    // The short forms from 1200 to 1439 px (the rule the French labels use), the whole ones from 1440.
    expect(css).toMatch(/\n\.refresh-full \{ display: none; \}\n@media \(min-width: 1440px\) \{\n  \.refresh-short \{ display: none; \}\n  \.refresh-full \{ display: inline; \}\n\}/);
    // The reload link's short form to 1599 px.
    expect(css).toMatch(/\n\.refresh-reload \.refresh-short \{ display: inline; \}\n\.refresh-reload \.refresh-full \{ display: none; \}\n@media \(min-width: 1600px\) \{\n  \.refresh-reload \.refresh-short \{ display: none; \}\n  \.refresh-reload \.refresh-full \{ display: inline; \}\n\}/);
    for (const lang of ["en", "fr"] as const) {
      // Both states rendered at their widest: the countdown at 23 h 59 min, and a run under way.
      const q = lang === "fr" ? "?lang=fr" : "";
      const widest = figureOf(timerOf(await (await get(`/methodology${q}`, { now: "2026-10-31T12:31:00Z" })).text(), "daily")) ?? "";
      const under = figureOf(timerOf(await (await get(`/methodology${q}`, { assets: OLD })).text(), "daily")) ?? "";
      expect(nbsp(widest)).toBe(lang === "fr" ? "23 h 59 min" : "23h 59m");
      const [, short, full] = /^<span class="refresh-short">([^<]*)<\/span><span class="refresh-full">([^<]*)<\/span>$/.exec(under) ?? [];
      // One run of text per form: nothing that could break a line.
      expect(short).toMatch(/^[^\n<]+$/);
      expect(full).toMatch(/^[^\n<]+$/);
      // In characters a time with its word is longer than the longest countdown (the short form
      // 11 against 7 in English, 12 against 11 in French), so the bounds here are the lengths
      // measured to fit (public/styles.css, 2026-11-07): with them the search field keeps 233 px
      // or more in that state at every width from 1200 px. Below 1440 px the English short form
      // is narrower than its label and leaves each block as wide as before; the French one
      // widens each block by 10 px. The whole forms show from 1440 px, where the bar has room.
      expect(short.length).toBeLessThanOrEqual(12);
      expect(full.length).toBeLessThanOrEqual(21);
    }
  });
});

// -- /refresh.json -------------------------------------------------------------------------

describe("/refresh.json", () => {
  beforeAll(async () => {
    await applySql(SEARCH, INTRADAY_SCHEMA);
  });
  beforeEach(async () => {
    forgetRefreshStamps();
    await SEARCH.prepare("DELETE FROM intraday_runs WHERE id LIKE 'refresh-test-%'").run();
  });
  afterAll(async () => {
    await SEARCH.prepare("DELETE FROM intraday_runs WHERE id LIKE 'refresh-test-%'").run();
  });
  const run = (id: string, at: string, ok: number) =>
    SEARCH.prepare("INSERT INTO intraday_runs (id, at, ok) VALUES (?, ?, ?)").bind(`refresh-test-${id}`, at, ok).run();

  it("gives the two stamps from the pages' sources, public for a minute, with no session read", async () => {
    // A trap for the accounts database: the endpoint reads no session, signed in or not.
    const used: string[] = [];
    const ACCOUNTS = new Proxy({}, { get(_t, prop) { used.push(String(prop)); throw new Error("ACCOUNTS was used"); } });
    await run("a", "2026-10-31T13:51:02Z", 1);
    await run("b", "2026-10-31T15:52:40Z", 1);
    await run("c", "2026-10-31T15:58:00Z", 0);
    const res = await app.request(STAMPS_PATH, { headers: { cookie: "aw_session=a.b" } },
      { ...testEnv(), ACCOUNTS_ENABLED: "true", ACCOUNTS });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(`public, max-age=${STAMPS_MAX_AGE}`);
    expect(STAMPS_MAX_AGE).toBe(60);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("vary")).toBeNull();
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.getSetCookie()).toEqual([]);
    const body = await res.json();
    // The failed run's time is not the data's: the newest run that went through is.
    expect(body).toEqual({ daily: "2026-10-31T12:44:03Z", same_day: "2026-10-31T15:52:40Z" });
    expect(Object.keys(body as object)).toEqual(["daily", "same_day"]);
    expect(used).toEqual([]);
  });

  it("reads the run log at most once a minute an isolate, and not at all while the accounts switch is off", async () => {
    await run("a", "2026-10-31T15:52:40Z", 1);
    const sql: string[] = [];
    const recording = { prepare: (q: string) => { sql.push(q); return SEARCH.prepare(q); } } as unknown as D1Database;
    const on = { ...testEnv(), ACCOUNTS_ENABLED: "true", SEARCH: recording };
    expect(await (await app.request(STAMPS_PATH, {}, on)).json()).toEqual({ daily: "2026-10-31T12:44:03Z", same_day: "2026-10-31T15:52:40Z" });
    expect(await (await app.request(STAMPS_PATH, {}, on)).json()).toEqual({ daily: "2026-10-31T12:44:03Z", same_day: "2026-10-31T15:52:40Z" });
    expect(sql).toEqual([LAST_CUT_SQL]);
    forgetRefreshStamps();
    sql.length = 0;
    const off = await (await app.request(STAMPS_PATH, {}, { ...testEnv(), SEARCH: recording })).json();
    expect(off).toEqual({ daily: "2026-10-31T12:44:03Z", same_day: null });
    expect(sql).toEqual([]);
  });

  it("answers null for a stamp it cannot read, never an error", async () => {
    const failing = { prepare: () => { throw new Error("D1_ERROR: no such table: intraday_runs: SQLITE_ERROR"); } } as unknown as D1Database;
    const res = await app.request(STAMPS_PATH, {}, { ...testEnv(emptyAssets), ACCOUNTS_ENABLED: "true", SEARCH: failing });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ daily: null, same_day: null });
    forgetRefreshStamps();
    expect(await (await app.request(STAMPS_PATH, {}, { ...testEnv(), ACCOUNTS_ENABLED: "true", SEARCH: undefined })).json())
      .toEqual({ daily: "2026-10-31T12:44:03Z", same_day: null });
    // A value that is not a stamp reads as none.
    const odd = { prepare: () => ({ first: async () => ({ at: "yesterday" }) }) } as unknown as D1Database;
    expect(await loadLastCut(odd)).toBeNull();
    expect(await (await app.request(STAMPS_PATH, {}, { ...testEnv(NO_RUNS) })).json()).toEqual({ daily: null, same_day: null });
  });

  it("answers no same-day stamp once the last cut is too old to say a cut is under way", async () => {
    // The tests' clock is 16:00: a run ended 11 h 50 min before still counts, one 12 h 10 min before does not.
    const on = { ...testEnv(), ACCOUNTS_ENABLED: "true" };
    await run("a", "2026-10-31T04:10:00Z", 1);
    expect(await (await app.request(STAMPS_PATH, {}, on)).json()).toEqual({ daily: "2026-10-31T12:44:03Z", same_day: "2026-10-31T04:10:00Z" });
    await SEARCH.prepare("DELETE FROM intraday_runs WHERE id LIKE 'refresh-test-%'").run();
    await run("b", "2026-10-31T03:50:00Z", 1);
    forgetRefreshStamps();
    expect(await (await app.request(STAMPS_PATH, {}, on)).json()).toEqual({ daily: "2026-10-31T12:44:03Z", same_day: null });
    expect(SAME_DAY_STAMP_MAX_HOURS).toBe(12);
  });

  it("falls under the pages' rate cap and is counted as a file", () => {
    expect(bucketFor("GET", STAMPS_PATH)).toBe("page");
    expect(routeTemplate("GET", STAMPS_PATH)).toEqual({ route: "/refresh.json", kind: "file" });
  });
});

// -- the script's loop ---------------------------------------------------------------------

type Shown = { text: string } | { full: string; short: string };

// The loop with a fake page: a clock the test moves, the waits it asks for
// held until the test runs them, and a mocked fetch behind the script's own
// fetchStamps that answers from a list (an Error rejects, a number is a
// status with no body, anything else a JSON body).
function harness(
  timers: { key: string; runs: readonly string[]; dataAt: string | null }[], answers: unknown[],
  opts: { active?: boolean; start?: string } = {},
) {
  const clock = { now: at(opts.start ?? "2026-11-07T10:00:00Z") };
  const waits: { fn: () => void; ms: number }[] = [];
  const fetched: number[] = [];
  const urls: string[] = [];
  const shown: Shown[][] = timers.map(() => []);
  let reloads = 0;
  const mockFetch = async (url: string, init: { headers: Record<string, string> }) => {
    fetched.push(clock.now);
    urls.push(`${url} ${init.headers.accept}`);
    const next = answers.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "number") return new Response(null, { status: next });
    return new Response(JSON.stringify(next ?? null), { headers: { "content-type": "application/json" } });
  };
  const loop = refreshLoop({
    timers: timers.map((tm, i) => ({ ...tm, show: (f: Shown) => { shown[i].push(f); } })),
    words: refreshWords("en"),
    now: () => clock.now,
    fetchStamps: () => fetchStamps(mockFetch),
    reload: () => { reloads++; },
    wait: (fn, ms) => { waits.push({ fn, ms }); },
    active: opts.active === undefined ? undefined : () => !!opts.active,
  });
  // Runs the waits due, as the browser's timer would, POLL_MS after each was asked for.
  const runWaits = async () => {
    const due = waits.splice(0);
    for (const w of due) {
      expect(w.ms).toBe(POLL_MS);
      clock.now += w.ms;
      w.fn();
      await loop.idle();
    }
  };
  // The minute ticks from now to an instant, as the page's timer runs them.
  const tickTo = (iso: string) => {
    while (clock.now + 60000 <= at(iso)) {
      clock.now += 60000;
      loop.tick();
    }
  };
  return { clock, waits, fetched, urls, shown, loop, runWaits, tickTo, reloads: () => reloads };
}

describe("the script's loop", () => {
  const OLD_DAILY = "2026-11-06T13:02:11Z";

  it("never asks while every timer counts down, nor before a run's time on a timer without a stamp", () => {
    const h = harness([{ key: "daily", runs: DAILY_RUNS_UTC, dataAt: OLD_DAILY }, { key: "same_day", runs: SAME_DAY_RUNS_UTC, dataAt: null }], []);
    // 10:00: the last cut was 03:45, more than an hour back, so the load asks nothing either.
    expect(h.loop.begin()).toBe(false);
    h.tickTo("2026-11-07T11:44:30Z");
    expect(h.shown[0].at(-1)).toEqual({ text: "46m" });
    expect(h.shown[1].at(-1)).toEqual({ text: "1m" });
    expect(h.waits).toEqual([]);
    expect(h.fetched).toEqual([]);
  });


  it("asks every three minutes while the run is under way, then resumes the countdown and offers the reload once", async () => {
    const h = harness([{ key: "daily", runs: DAILY_RUNS_UTC, dataAt: OLD_DAILY }], [
      { daily: OLD_DAILY, same_day: null },
      null,
      new Error("offline"),
      { daily: "2026-11-07T13:02:00Z", same_day: null },
    ]);
    h.clock.now = at("2026-11-07T12:30:00Z");
    expect(h.loop.tick()).toBe(true);
    expect(h.shown[0].at(-1)).toEqual(runningText(at("2026-11-07T12:30:00Z"), refreshWords("en"), false));
    // The minute ticks while a request is pending ask for nothing more.
    h.loop.tick();
    h.loop.tick();
    expect(h.waits).toHaveLength(1);
    expect(h.fetched).toEqual([]);
    // Three answers that change nothing: the old stamp, nothing, a failed request.
    for (let i = 1; i <= 3; i++) {
      await h.runWaits();
      expect(h.fetched).toHaveLength(i);
      expect(h.reloads()).toBe(0);
      expect(h.waits).toHaveLength(1);
    }
    expect(h.fetched).toEqual([at("2026-11-07T12:33:00Z"), at("2026-11-07T12:36:00Z"), at("2026-11-07T12:39:00Z")]);
    // The fourth: the new data is in.
    await h.runWaits();
    expect(h.fetched).toHaveLength(4);
    expect(h.reloads()).toBe(1);
    expect(h.shown[0].at(-1)).toEqual({ text: "23h 48m" });
    expect(h.waits).toEqual([]);
    // Ticks after it: the countdown, no request.
    for (let minute = 1; minute < 60; minute++) {
      h.clock.now += 60000;
      expect(h.loop.tick()).toBe(false);
    }
    expect(h.fetched).toHaveLength(4);
  });

  it("offers the reload once for the page's life, whichever timer's data comes in", async () => {
    const h = harness([
      { key: "daily", runs: DAILY_RUNS_UTC, dataAt: OLD_DAILY },
      { key: "same_day", runs: SAME_DAY_RUNS_UTC, dataAt: "2026-11-07T11:52:00Z" },
    ], [
      { daily: OLD_DAILY, same_day: "2026-11-07T11:52:00Z" },
      { daily: "2026-11-07T13:20:00Z", same_day: "2026-11-07T11:52:00Z" },
      { daily: "2026-11-07T13:20:00Z", same_day: "2026-11-07T13:52:00Z" },
    ]);
    h.clock.now = at("2026-11-07T13:46:00Z");
    expect(h.loop.tick()).toBe(true);
    await h.runWaits();
    expect(h.reloads()).toBe(0);
    await h.runWaits();
    // The daily data is in; the sub-daily cut is still under way, so the requests go on.
    expect(h.reloads()).toBe(1);
    expect(h.shown[0].at(-1)).toEqual({ text: "22h 38m" });
    expect(h.waits).toHaveLength(1);
    await h.runWaits();
    expect(h.reloads()).toBe(1);
    expect(h.shown[1].at(-1)).toEqual({ text: "1h 50m" });
    expect(h.waits).toEqual([]);
    expect(h.fetched).toHaveLength(3);
  });

  it("asks nothing while the timers are off screen (below 1200 px)", () => {
    const h = harness([{ key: "daily", runs: DAILY_RUNS_UTC, dataAt: OLD_DAILY }], [], { active: false });
    h.clock.now = at("2026-11-07T13:00:00Z");
    expect(h.loop.tick()).toBe(true);
    expect(h.waits).toEqual([]);
    expect(h.fetched).toEqual([]);
  });
});

// A timer the page gave no stamp: the sub-daily one on every page without
// the same-day band (and the daily one if stats.json had no run row).
describe("the script's loop, for a timer without a stamp", () => {
  const OLD_DAILY = "2026-11-06T13:02:11Z";
  const SAME_DAY = [{ key: "same_day", runs: SAME_DAY_RUNS_UTC, dataAt: null }];
  const under = (iso: string) => runningText(at(iso), refreshWords("en"), false);

  it("reads it as under way when its run's time comes on an open page, asks, and lets the first stamp decide", async () => {
    const h = harness(SAME_DAY, [
      // The cut is not in yet: the last one in is the night's, so the timer stays under way, with a stamp now.
      { daily: OLD_DAILY, same_day: "2026-11-07T03:51:00Z" },
      { daily: OLD_DAILY, same_day: "2026-11-07T11:53:20Z" },
    ], { start: "2026-11-07T11:30:00Z" });
    // 11:30: the last cut (03:45) is long past, so the load asks nothing; nor does any minute before 11:45.
    expect(h.loop.begin()).toBe(false);
    h.tickTo("2026-11-07T11:44:59Z");
    expect(h.shown[0].at(-1)).toEqual({ text: "1m" });
    expect(h.fetched).toEqual([]);
    expect(h.waits).toEqual([]);
    // The cut's time: under way since 11:45, provisionally, and the first request three minutes on.
    h.clock.now = at("2026-11-07T11:45:00.050Z");
    expect(h.loop.tick()).toBe(true);
    expect(h.shown[0].at(-1)).toEqual(under("2026-11-07T11:45:00Z"));
    expect(h.waits).toHaveLength(1);
    expect(h.fetched).toEqual([]);
    await h.runWaits();
    expect(h.urls).toEqual([`${STAMPS_PATH} application/json`]);
    expect(h.shown[0].at(-1)).toEqual(under("2026-11-07T11:45:00Z"));
    expect(h.reloads()).toBe(0);
    expect(h.waits).toHaveLength(1);
    // The cut is in: the countdown to 13:45 and the reload link, as for a stamp the page carried.
    await h.runWaits();
    expect(h.reloads()).toBe(1);
    expect(h.shown[0].at(-1)).toEqual({ text: "1h 53m" });
    expect(h.waits).toEqual([]);
    expect(h.fetched).toHaveLength(2);
  });

  it("returns it to its countdown when the answer has no stamp for it, keeps asking through a failed request, and goes under way again at the next run", async () => {
    const h = harness(SAME_DAY, [
      { daily: OLD_DAILY, same_day: null },
      503,
      { daily: OLD_DAILY, same_day: null },
    ], { start: "2026-11-07T11:30:00Z" });
    h.loop.begin();
    h.clock.now = at("2026-11-07T11:45:00.050Z");
    expect(h.loop.tick()).toBe(true);
    await h.runWaits();
    // No stamp known (the switch off, or the cuts stopped): the countdown as before, no reload, no more requests.
    expect(h.shown[0].at(-1)).toEqual({ text: "1h 56m" });
    expect(h.reloads()).toBe(0);
    expect(h.waits).toEqual([]);
    h.tickTo("2026-11-07T13:44:30Z");
    expect(h.fetched).toHaveLength(1);
    expect(h.waits).toEqual([]);
    // 13:45: under way again; a 503 changes nothing and the next request goes out three minutes on.
    h.clock.now = at("2026-11-07T13:45:00.050Z");
    expect(h.loop.tick()).toBe(true);
    await h.runWaits();
    expect(h.shown[0].at(-1)).toEqual(under("2026-11-07T13:45:00Z"));
    expect(h.waits).toHaveLength(1);
    await h.runWaits();
    expect(h.shown[0].at(-1)).toEqual({ text: "1h 53m" });
    expect(h.fetched).toHaveLength(3);
    expect(h.reloads()).toBe(0);
  });

  it("asks once at load when the run may still be going, and learns the state from the answer", async () => {
    expect(RUN_MINUTES).toEqual({ daily: DAILY_RUN_MINUTES, same_day: SAME_DAY_RUN_MINUTES });
    expect([DAILY_RUN_MINUTES, SAME_DAY_RUN_MINUTES]).toEqual([180, 60]);
    // 12:10, 25 minutes after the 11:45 cut's time, and the cut is in: one request at once, then the countdown, no reload.
    const done = harness(SAME_DAY, [{ daily: OLD_DAILY, same_day: "2026-11-07T11:52:00Z" }], { start: "2026-11-07T12:10:00Z" });
    expect(done.loop.begin()).toBe(false);
    expect(done.fetched).toEqual([at("2026-11-07T12:10:00Z")]);
    expect(done.waits).toEqual([]);
    await done.loop.idle();
    expect(done.shown[0].at(-1)).toEqual({ text: "1h 35m" });
    expect(done.reloads()).toBe(0);
    done.tickTo("2026-11-07T13:44:00Z");
    expect(done.fetched).toHaveLength(1);
    expect(done.waits).toEqual([]);
    // The same visit while the cut is not in: under way since 11:45, the requests every three minutes, the reload once it is.
    const mid = harness(SAME_DAY, [
      { daily: OLD_DAILY, same_day: "2026-11-07T03:51:00Z" },
      { daily: OLD_DAILY, same_day: "2026-11-07T12:14:10Z" },
    ], { start: "2026-11-07T12:10:00Z" });
    mid.loop.begin();
    await mid.loop.idle();
    expect(mid.shown[0].at(-1)).toEqual(under("2026-11-07T11:45:00Z"));
    expect(mid.waits).toHaveLength(1);
    expect(mid.reloads()).toBe(0);
    await mid.runWaits();
    expect(mid.reloads()).toBe(1);
    expect(mid.shown[0].at(-1)).toEqual({ text: "1h 32m" });
    expect(mid.fetched).toEqual([at("2026-11-07T12:10:00Z"), at("2026-11-07T12:13:00Z")]);
    // A daily timer without a stamp: within 180 minutes of 12:30 it asks, from 180 on it does not.
    const daily = [{ key: "daily", runs: DAILY_RUNS_UTC, dataAt: null }];
    const soon = harness(daily, [{ daily: "2026-11-07T13:10:00Z", same_day: null }], { start: "2026-11-07T15:29:00Z" });
    soon.loop.begin();
    await soon.loop.idle();
    expect(soon.fetched).toHaveLength(1);
    expect(soon.shown[0].at(-1)).toEqual({ text: "21h 1m" });
    for (const start of ["2026-11-07T15:30:00Z", "2026-11-07T20:00:00Z", "2026-11-07T11:00:00Z"]) {
      const late = harness(daily, [], { start });
      late.loop.begin();
      expect(late.fetched, start).toEqual([]);
    }
  });

  it("asks nothing at load after the run's usual length, for a timer with a stamp, or off screen", () => {
    // 12:50: 65 minutes after the 11:45 cut.
    const after = harness(SAME_DAY, [], { start: "2026-11-07T12:50:00Z" });
    after.loop.begin();
    expect(after.fetched).toEqual([]);
    // A stamp on the page says what it says: no request before its next run.
    const stamped = harness([{ key: "same_day", runs: SAME_DAY_RUNS_UTC, dataAt: "2026-11-07T11:52:00Z" }], [], { start: "2026-11-07T12:10:00Z" });
    stamped.loop.begin();
    expect(stamped.fetched).toEqual([]);
    const hidden = harness(SAME_DAY, [], { start: "2026-11-07T12:10:00Z", active: false });
    hidden.loop.begin();
    expect(hidden.fetched).toEqual([]);
  });
});

describe("the words", () => {
  it("carry no em-dash, in either language, nor does a page under way", async () => {
    for (const lang of ["en", "fr"] as const) {
      for (const key of ["refresh.since", "refresh.since_short", "refresh.reload", "refresh.reload_short"] as const) {
        expect(t(lang, key), `${lang} ${key}`).not.toContain(EM_DASH);
      }
      expect(timers(await (await get(`/${lang === "fr" ? "?lang=fr" : ""}`, { assets: OLD })).text())).not.toContain(EM_DASH);
    }
  });

  it("are the operator's: Under way since / En cours depuis, Since / Depuis, and the reload link", () => {
    expect([t("en", "refresh.since"), t("en", "refresh.since_short")]).toEqual(["Under way since {time}", "Since {time}"]);
    expect([t("fr", "refresh.since"), t("fr", "refresh.since_short")]).toEqual(["En cours depuis {time}", "Depuis {time}"]);
    expect([t("en", "refresh.reload"), t("fr", "refresh.reload")]).toEqual(["Reload for the new data", "Recharger pour les nouvelles données"]);
    expect(nextRunAt(at("2026-11-07T12:30:00Z"), DAILY_RUNS_UTC)).toBe(at("2026-11-07T12:30:00Z"));
  });
});
