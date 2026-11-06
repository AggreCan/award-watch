// The top bar's two timers (src/refresh.tsx, public/refresh.js): the
// schedules match the workflows that run them, each timer is a label over a
// figure that counts whole minutes down to "now", and the page around them
// keeps its caching: the same headers, and the same ETag from one minute to
// the next.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import nightly from "../../.github/workflows/nightly.yml?raw";
import intraday from "../../.github/workflows/intraday.yml?raw";
import { nextRunAt, refreshText, templatePieces } from "../public/refresh.js";
import { bodyEtag } from "../src/conditional";
import { app } from "../src/index";
import { DAILY_RUNS_UTC, SAME_DAY_HREF, SAME_DAY_RUNS_UTC, refreshWords } from "../src/refresh";
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
// Each timer as [label, figure]; a label that carries a short form reads "short | full".
const lines = (html: string) =>
  [...timers(html).matchAll(/<span class="refresh-line"><span class="refresh-label">(.*?)<\/span> <span class="refresh-left">([^<]*)<\/span><\/span>/g)]
    .map((m) => [nbsp(m[1].replace(/^<span class="refresh-short">([^<]*)<\/span><span class="refresh-full">([^<]*)<\/span>$/, "$1 | $2")), nbsp(m[2])]);

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

describe("the figure", () => {
  const en = refreshWords("en");
  const fr = refreshWords("fr");
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
    expect(refreshText(at("2026-11-04T01:53:30Z"), DAILY_RUNS_UTC, en)).toBe("10h 36m");
    expect(refreshText(at("2026-11-04T12:05:00Z"), DAILY_RUNS_UTC, en)).toBe("25m");
    expect(refreshText(at("2026-11-04T11:30:00Z"), DAILY_RUNS_UTC, en)).toBe("1h 0m");
    expect(refreshText(at("2026-11-04T12:29:01Z"), DAILY_RUNS_UTC, en)).toBe("now");
    expect(refreshText(at("2026-11-04T12:30:00Z"), DAILY_RUNS_UTC, en)).toBe("now");
    expect(refreshText(at("2026-11-04T12:31:00Z"), DAILY_RUNS_UTC, en)).toBe("23h 59m");
    expect(refreshText(at("2026-11-04T11:54:00Z"), SAME_DAY_RUNS_UTC, en)).toBe("1h 51m");
    expect(nbsp(refreshText(at("2026-11-04T01:53:30Z"), DAILY_RUNS_UTC, fr) ?? "")).toBe("10 h 36 min");
    expect(nbsp(refreshText(at("2026-11-04T12:05:00Z"), DAILY_RUNS_UTC, fr) ?? "")).toBe("25 min");
    expect(nbsp(refreshText(at("2026-11-04T11:54:00Z"), SAME_DAY_RUNS_UTC, fr) ?? "")).toBe("1 h 51 min");
    expect(refreshText(at("2026-11-04T13:44:30Z"), SAME_DAY_RUNS_UTC, fr)).toBe("maintenant");
  });

  it("carries its words as pieces, so no page holds an unfilled placeholder", () => {
    expect(templatePieces("{m}m")).toEqual(["", "m", "m"]);
    expect(templatePieces("{h} h {m} min")).toEqual(["", "h", " h ", "m", " min"]);
  });
});

describe("the top bar", () => {
  it("shows both timers from the page's clock, the same-day one marked Pro and linked while the switch is on", async () => {
    // 16:00 UTC on 2026-10-31: the nightly at 12:30 tomorrow, the next cut at 17:45.
    const html = await (await getOn("/")).text();
    expect(lines(html)).toEqual([["Daily refresh", "20h 30m"], ["Sub-daily refresh", "1h 45m"]]);
    const bar = timers(html);
    expect(html.indexOf('<span class="asof">')).toBeLessThan(html.indexOf('<span class="refresh-timers"'));
    expect(bar).toContain(`<a class="refresh" href="${SAME_DAY_HREF}" data-refresh-runs="${SAME_DAY_RUNS_UTC.join(" ")}" data-now="now">`);
    // The chip is the shared one (src/pro.tsx), after the label and the figure; its markup is held by test/pro-mark.test.ts.
    expect(bar).toContain('<span class="refresh-left">1h 45m</span></span> <span class="pro-tag">');
    expect(bar).toContain('<span class="refresh" data-refresh-runs="12:30" data-now="now">');
    // The script needs no label: the figure's forms only, no template with the words around it.
    expect(bar).toContain(`data-hm="${JSON.stringify(["", "h", "h ", "m", "m"]).replace(/"/g, "&quot;")}"`);
    expect(bar).not.toContain("data-in=");
    // The same on every page, in French too, each label with its short form for 1200 to 1439 px.
    const fr = await (await getOn("/methodology?lang=fr")).text();
    expect(lines(fr)).toEqual([
      ["Quotidienne | Actualisation quotidienne", "20 h 30 min"],
      ["En journée | Actualisation en journée", "1 h 45 min"],
    ]);
    expect(timers(fr)).toContain('data-now="maintenant"');
    expect(timers(fr)).toContain('<span class="pro-tag">');
    // With the switch off nothing is Pro: the same-day timer carries no chip and leads to the tender list.
    const off = timers(await (await get("/")).text());
    expect(off).toContain('<a class="refresh" href="/tenders"');
    expect(off).not.toContain("pro-tag");
    expect(off).not.toContain("/tenders/same-day");
    const late = await (await get("/", "2026-11-01T12:29:30Z")).text();
    expect(lines(late)).toEqual([["Daily refresh", "now"], ["Sub-daily refresh", "1h 15m"]]);
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
    // Only the figures are left out of the tag: a changed label is a changed page.
    const page = (label: string, left: string) => new TextEncoder().encode(
      `<p><span class="refresh-line"><span class="refresh-label">${label}</span> <span class="refresh-left">${left}</span></span></p>`).buffer as ArrayBuffer;
    expect(await bodyEtag(page("Daily refresh", "9h 48m"))).toBe(await bodyEtag(page("Daily refresh", "now")));
    expect(await bodyEtag(page("Daily refresh", "9h 48m"))).not.toBe(await bodyEtag(page("Nightly refresh", "9h 48m")));
  });

  it("hides the timers below 1200 px and sets them side by side from there, 24 px apart, each a label over a figure", () => {
    const css = env.STYLES_CSS;
    expect(css).toMatch(/\n\.refresh-timers \{ display: none; \}\n@media \(min-width: 1200px\) \{\n  \.refresh-timers \{ display: flex; align-items: center; gap: 24px; margin-left: 8px; white-space: nowrap; \}\n\}/);
    expect(css).not.toMatch(/\.refresh-timers \{[^}]*flex-direction: column/);
    // 16 px from the second block's lines to its chip, in place of the 2 px a chip takes after a label.
    expect(css).toMatch(/\n\.refresh \{ display: flex; align-items: center; gap: 16px; \}/);
    expect(css).toMatch(/\na\.refresh > \.pro-tag \{ margin-left: 0; \}/);
    expect(css).toMatch(/\n\.refresh-line \{ display: flex; flex-direction: column; align-items: flex-start; \}/);
    expect(css).toMatch(/\n\.refresh-label \{ font-size: 10px; line-height: 12px; font-weight: 600; letter-spacing: 0\.06em; text-transform: uppercase; color: var\(--muted\); \}/);
    expect(css).toMatch(/\n\.refresh-left \{ font-size: 14px; line-height: 18px; font-weight: 600; color: var\(--ink\); font-variant-numeric: tabular-nums; \}/);
    // A French label's short form from 1200 to 1439 px, the whole label from 1440.
    expect(css).toMatch(/\n\.refresh-full \{ display: none; \}\n@media \(min-width: 1440px\) \{\n  \.refresh-short \{ display: none; \}\n  \.refresh-full \{ display: inline; \}\n\}/);
  });
});
