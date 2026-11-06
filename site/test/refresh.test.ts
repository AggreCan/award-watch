// The top bar's two timers (src/refresh.tsx, public/refresh.js): the
// schedules match the workflows that run them, the line counts whole minutes
// down to "now", and the page around them keeps its caching: the same
// headers, and the same ETag from one minute to the next.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import nightly from "../../.github/workflows/nightly.yml?raw";
import intraday from "../../.github/workflows/intraday.yml?raw";
import { nextRunAt, refreshText, templatePieces } from "../public/refresh.js";
import { t } from "../src/i18n";
import { app } from "../src/index";
import { DAILY_RUNS_UTC, SAME_DAY_HREF, SAME_DAY_RUNS_UTC } from "../src/refresh";
import { fakeAssets, testEnv } from "./assets";

let address = 0;
const get = (path: string, now?: string, headers: Record<string, string> = {}) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.12.${(address++ % 250) + 1}`, ...headers } },
    testEnv(fakeAssets, now));
// The same request with the accounts switch on (the site runs that way): the
// same-day timer then carries the Pro chip and leads to the tease page.
const getOn = (path: string, now?: string) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.13.${(address++ % 250) + 1}` } },
    { ...testEnv(fakeAssets, now), ACCOUNTS_ENABLED: "true" });
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const timers = (html: string) => html.match(/<span class="refresh-timers"[\s\S]*?<script type="module" src="\/refresh.js"><\/script><\/span>/)?.[0] ?? "";
const lines = (html: string) => [...timers(html).matchAll(/<span class="refresh-line">([^<]*)<\/span>/g)].map((m) => nbsp(m[1]));

// A workflow's cron schedules, in order.
const crons = (yml: string) => [...yml.matchAll(/^\s*- cron: "([^"]+)"/gm)].map((m) => m[1]);

// The minute and hour fields of a cron expression as the UTC times it runs
// ("HH:MM"): a number, a list, a range and a step, which is all the two
// workflows use. Day, month and weekday must be "*": the timers assume every day.
function cronTimes(expr: string): string[] {
  const [minute, hour, ...rest] = expr.trim().split(/\s+/);
  expect(rest, expr).toEqual(["*", "*", "*"]);
  const field = (f: string, max: number) => f.split(",").flatMap((part) => {
    const [range, step] = part.split("/");
    const [lo, hi] = range === "*" ? [0, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), step ? max : Number(range)];
    const out: number[] = [];
    for (let v = lo; v <= hi; v += step ? Number(step) : 1) out.push(v);
    return out;
  });
  const pad = (n: number) => String(n).padStart(2, "0");
  return field(hour, 23).flatMap((h) => field(minute, 59).map((m) => `${pad(h)}:${pad(m)}`));
}

describe("the schedules", () => {
  it("are the nightly run's main schedule and every same-day schedule, as the workflows set them", () => {
    // The nightly's first schedule is its run; the two after it are retries the gate skips after a clean run.
    const night = crons(nightly);
    expect(night[0]).toBe("30 12 * * *");
    expect(cronTimes(night[0])).toEqual([...DAILY_RUNS_UTC]);
    const day = crons(intraday).flatMap(cronTimes).sort();
    expect(day).toEqual([...SAME_DAY_RUNS_UTC].sort());
    expect(day).toHaveLength(9);
  });

  it("read a cron's ranges and steps as cron does", () => {
    expect(cronTimes("45 11-23/2 * * *")).toEqual(["11:45", "13:45", "15:45", "17:45", "19:45", "21:45", "23:45"]);
    expect(cronTimes("45 1-3/2 * * *")).toEqual(["01:45", "03:45"]);
    expect(cronTimes("0,30 6 * * *")).toEqual(["06:00", "06:30"]);
  });
});

describe("the line", () => {
  const words = (lang: "en" | "fr", key: "refresh.daily" | "refresh.same_day") => ({
    in: templatePieces(t(lang, key)), now: t(lang, `${key}_now`), hm: templatePieces(t(lang, "refresh.hm")), m: templatePieces(t(lang, "refresh.m")),
  });
  const at = (iso: string) => Date.parse(iso);

  it("finds the next run today or tomorrow, across midnight UTC", () => {
    expect(nextRunAt(at("2026-11-04T01:54:00Z"), DAILY_RUNS_UTC)).toBe(at("2026-11-04T12:30:00Z"));
    expect(nextRunAt(at("2026-11-04T12:30:00Z"), DAILY_RUNS_UTC)).toBe(at("2026-11-04T12:30:00Z"));
    expect(nextRunAt(at("2026-11-04T12:30:01Z"), DAILY_RUNS_UTC)).toBe(at("2026-11-05T12:30:00Z"));
    expect(nextRunAt(at("2026-11-04T23:50:00Z"), SAME_DAY_RUNS_UTC)).toBe(at("2026-11-05T01:45:00Z"));
    expect(nextRunAt(at("2026-11-05T04:00:00Z"), SAME_DAY_RUNS_UTC)).toBe(at("2026-11-05T11:45:00Z"));
    expect(nextRunAt(0, ["noon"])).toBeNull();
  });

  it("counts whole minutes down, then reads now within the last minute, in both languages", () => {
    const daily = words("en", "refresh.daily");
    expect(refreshText(at("2026-11-04T01:53:30Z"), DAILY_RUNS_UTC, daily)).toBe("Daily refresh in 10h 36m");
    expect(refreshText(at("2026-11-04T12:05:00Z"), DAILY_RUNS_UTC, daily)).toBe("Daily refresh in 25m");
    expect(refreshText(at("2026-11-04T11:30:00Z"), DAILY_RUNS_UTC, daily)).toBe("Daily refresh in 1h 0m");
    expect(refreshText(at("2026-11-04T12:29:01Z"), DAILY_RUNS_UTC, daily)).toBe("Daily refresh now");
    expect(refreshText(at("2026-11-04T12:30:00Z"), DAILY_RUNS_UTC, daily)).toBe("Daily refresh now");
    expect(refreshText(at("2026-11-04T12:31:00Z"), DAILY_RUNS_UTC, daily)).toBe("Daily refresh in 23h 59m");
    expect(refreshText(at("2026-11-04T11:54:00Z"), SAME_DAY_RUNS_UTC, words("en", "refresh.same_day"))).toBe("Sub-daily refresh in 1h 51m");
    expect(nbsp(refreshText(at("2026-11-04T01:53:30Z"), DAILY_RUNS_UTC, words("fr", "refresh.daily")) ?? ""))
      .toBe("Actualisation quotidienne dans 10 h 36 min");
    expect(nbsp(refreshText(at("2026-11-04T11:54:00Z"), SAME_DAY_RUNS_UTC, words("fr", "refresh.same_day")) ?? ""))
      .toBe("Actualisation en journée dans 1 h 51 min");
    expect(refreshText(at("2026-11-04T13:44:30Z"), SAME_DAY_RUNS_UTC, words("fr", "refresh.same_day"))).toBe("Actualisation en journée maintenant");
  });

  it("carries its words as pieces, so no page holds an unfilled placeholder", () => {
    expect(templatePieces("Daily refresh in {left}")).toEqual(["Daily refresh in ", "left", ""]);
    expect(templatePieces("{h} h {m} min")).toEqual(["", "h", " h ", "m", " min"]);
  });
});

describe("the top bar", () => {
  it("shows both timers from the page's clock, the same-day one marked Pro and linked while the switch is on", async () => {
    // 16:00 UTC on 2026-10-31: the nightly at 12:30 tomorrow, the next cut at 17:45.
    const html = await (await getOn("/")).text();
    expect(lines(html)).toEqual(["Daily refresh in 20h 30m", "Sub-daily refresh in 1h 45m"]);
    const bar = timers(html);
    expect(html.indexOf('<span class="asof">')).toBeLessThan(html.indexOf('<span class="refresh-timers"'));
    expect(bar).toContain(`<a class="refresh" href="${SAME_DAY_HREF}" data-refresh-runs="${SAME_DAY_RUNS_UTC.join(" ")}"`);
    // The chip is the shared one (src/pro.tsx); its markup is held by test/pro-mark.test.ts.
    expect(bar).toContain('<span class="refresh-line">Sub-daily refresh in 1h 45m</span> <span class="pro-tag">');
    expect(bar).toContain('data-refresh-runs="12:30"');
    // The same on every page, in French too.
    const fr = await (await getOn("/methodology?lang=fr")).text();
    expect(lines(fr)).toEqual(["Actualisation quotidienne dans 20 h 30 min", "Actualisation en journée dans 1 h 45 min"]);
    expect(timers(fr)).toContain('<span class="pro-tag">');
    // With the switch off nothing is Pro: the same-day timer carries no chip and leads to the tender list.
    const off = timers(await (await get("/")).text());
    expect(off).toContain('<a class="refresh" href="/tenders"');
    expect(off).not.toContain("pro-tag");
    expect(off).not.toContain("/tenders/same-day");
    const late = await (await get("/", "2026-11-01T12:29:30Z")).text();
    expect(lines(late)).toEqual(["Daily refresh now", "Sub-daily refresh in 1h 15m"]);
  });

  it("keeps the page's cache headers and its ETag from one minute to the next", async () => {
    const a = await get("/methodology", "2026-10-31T16:00:00Z");
    const b = await get("/methodology", "2026-10-31T16:07:00Z");
    expect(lines(await a.clone().text())).not.toEqual(lines(await b.clone().text()));
    expect(a.headers.get("cache-control")).toBe("public, max-age=300");
    expect(a.headers.get("vary")).toBeNull();
    expect(a.headers.get("etag")).toBe(b.headers.get("etag"));
    const again = await get("/methodology", "2026-10-31T16:09:00Z", { "if-none-match": a.headers.get("etag") ?? "" });
    expect(again.status).toBe(304);
  });

  it("hides the timers below 1200 px, stacks them below 1440 and sets them side by side above", () => {
    const css = env.STYLES_CSS;
    expect(css).toMatch(/\n\.refresh-timers \{ display: none; \}\n@media \(min-width: 1200px\) \{\n  \.refresh-timers \{ display: flex; flex-direction: column;/);
    expect(css).toMatch(/@media \(min-width: 1440px\) \{\n  \.refresh-timers \{ flex-direction: row;/);
  });
});
