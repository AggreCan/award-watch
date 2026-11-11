// The API usage page, /account/api (src/account/api_usage_page.tsx, the read
// DAILY_SQL in src/account/api_usage.ts, keyQuota in src/api_keyed_spec.ts;
// docs/accounts.md, The usage page), against the local accounts database with
// keys made through the keys page and rows written as the count writes them.
// The clock is the fixtures' (test/assets.ts): 16:00 UTC on 2026-10-31.
//
// The series (60 UTC days ending today, a day with no row at 0, one series a
// key and the total only past one key); the cap's dashed line only when the
// axis reaches it, a line saying the cap otherwise; the plan's figures; a
// Free reader's and a signed-out reader's answers; the read's bound and plan;
// the table that cannot be read; both languages; and the links to the page.
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { KEYS_MAX, type KeyRow } from "../src/account/api_keys";
import { DAILY_SQL, USAGE_KEEP_DAYS, dayPlus } from "../src/account/api_usage";
import { AXIS_FLOOR, axisTop, usageDays, usageSeries, weekLabels } from "../src/account/api_usage_page";
import { PLANS, allowed } from "../src/account/entitlements";
import { KEY_PER_DAY, KEY_PER_MINUTE, keyQuota } from "../src/api_keyed_spec";
import { ACCOUNTS, csrf, decode, get, grantPro, nbsp, newEmail, onEnv, post, signIn, useAccountsDb } from "./accounts-helpers";

useAccountsDb();

const TODAY = "2026-10-31";
const FIRST = dayPlus(TODAY, -(USAGE_KEEP_DAYS - 1));
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const STYLES = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;

const mainOf = (html: string) => /<main id="main">[\s\S]*?<\/main>/.exec(html)?.[0] ?? "";
const page = async (path: string, o: { cookie?: string; env?: object } = {}) => decode(nbsp(await (await get(path, o)).text()));
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
// A panel of the chart, from its title to the end of its plot.
const panelOf = (html: string, title: string) => {
  const at = html.indexOf(`<div class="chart-title">${title}</div>`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</svg>", at) + "</svg>".length);
};
const RULE = /<line class="mark mark-rule" x1="0" x2="1000" y1="([0-9.]+)" y2="\1" vector-effect="non-scaling-stroke"\/>/g;

type Made = { email: string; cookie: string; keys: { id: string; name: string; prefix: string }[] };

// A Pro account with keys of these names, made through the keys page, oldest first.
async function proWithKeys(tag: string, names: string[]): Promise<Made> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  await grantPro(email);
  const token = await csrf(cookie);
  for (const name of names) expect((await post("/account/keys", { csrf: token, name }, { cookie })).status).toBe(200);
  const res = await ACCOUNTS.prepare(
    "SELECT k.id, k.name, k.prefix FROM api_keys k JOIN users u ON u.id = k.user_id WHERE u.email = ? ORDER BY k.created_at, k.id",
  ).bind(email).all<{ id: string; name: string; prefix: string }>();
  return { email, cookie, keys: res.results ?? [] };
}

// Rows as the count writes them: [key id, day, n].
async function seed(rows: [string, string, number][]): Promise<void> {
  for (let i = 0; i < rows.length; i += 50) {
    await ACCOUNTS.batch(rows.slice(i, i + 50).map(([k, day, n]) => ACCOUNTS.prepare("INSERT INTO api_usage (key_id, day, n) VALUES (?, ?, ?)").bind(k, day, n)));
  }
}

// The accounts database with one statement failing, every other one passed on; used lists every statement prepared.
function failing(sql: string): { db: D1Database; used: string[] } {
  const used: string[] = [];
  const db = {
    prepare(s: string) {
      used.push(s);
      if (s === sql) throw new Error("D1_ERROR: no such table: api_usage: SQLITE_ERROR");
      return ACCOUNTS.prepare(s);
    },
    batch: (s: D1PreparedStatement[]) => ACCOUNTS.batch(s),
  } as unknown as D1Database;
  return { db, used };
}

const key = (id: string, name: string, revoked: string | null = null): KeyRow => ({
  id, name, prefix: id.padEnd(8, "0").slice(0, 8), created_at: "2026-09-01T00:00:00.000Z", last_used_at: null, revoked_at: revoked,
});

// -- the series --------------------------------------------------------------------------------

describe("the series", () => {
  const days = usageDays(TODAY);

  it("run over the 60 UTC days ending today, oldest first, one day apart", () => {
    expect(days).toHaveLength(USAGE_KEEP_DAYS);
    expect(days[0]).toBe("2026-09-02");
    expect(days[days.length - 1]).toBe(TODAY);
    for (let i = 1; i < days.length; i++) expect(days[i], days[i]).toBe(dayPlus(days[i - 1], 1));
    // Across a month's end and a DST change, still UTC days.
    expect(usageDays("2026-03-09")[0]).toBe("2026-01-09");
  });

  it("put a day with no row at 0, one series a key, and the total first only past one key", () => {
    const keys = [key("aaaaaaaa", "Nightly sync"), key("bbbbbbbb", "Mirror"), key("cccccccc", "Old sync", "2026-10-12T09:00:00.000Z"),
      key("dddddddd", "Never used", "2026-10-20T09:00:00.000Z")];
    const rows = [
      { key_id: "aaaaaaaa", day: TODAY, n: 5 }, { key_id: "aaaaaaaa", day: FIRST, n: 3 },
      { key_id: "bbbbbbbb", day: "2026-10-15", n: 7 }, { key_id: "cccccccc", day: "2026-10-10", n: 2 },
      // Outside the window: no slot holds it.
      { key_id: "aaaaaaaa", day: dayPlus(FIRST, -1), n: 1000 },
    ];
    const series = usageSeries("en", keys, rows, days);
    // The total, the two keys in use, then the revoked key that has rows; the revoked one without rows has none.
    expect(series.map((s) => [s.id, s.label, s.revoked])).toEqual([
      [null, "All keys", false], ["aaaaaaaa", "Nightly sync", false], ["bbbbbbbb", "Mirror", false], ["cccccccc", "Old sync (revoked)", true],
    ]);
    for (const s of series) expect(s.values, s.label).toHaveLength(USAGE_KEEP_DAYS);
    const at = (d: string) => days.indexOf(d);
    expect(series[1].values[at(TODAY)]).toBe(5);
    expect(series[1].values[0]).toBe(3);
    expect(series[1].values[at("2026-10-15")]).toBe(0);
    expect(series[1].values.reduce((a, b) => a + b, 0)).toBe(8);
    expect(series[2].values[at("2026-10-15")]).toBe(7);
    expect(series[3].values[at("2026-10-10")]).toBe(2);
    // The total is each day's sum.
    for (let i = 0; i < days.length; i++) expect(series[0].values[i]).toBe(series[1].values[i] + series[2].values[i] + series[3].values[i]);
    expect(series[0].values.reduce((a, b) => a + b, 0)).toBe(17);
  });

  it("are one series and no total for one key, every day 0 when it has no row", () => {
    const series = usageSeries("en", [key("aaaaaaaa", "Only")], [], days);
    expect(series).toHaveLength(1);
    expect(series[0].id).toBe("aaaaaaaa");
    expect(series[0].values).toEqual(days.map(() => 0));
    // A revoked key without a row in the window is not a series; nothing is left to total.
    expect(usageSeries("en", [key("aaaaaaaa", "Only"), key("bbbbbbbb", "Gone", "2026-10-01T00:00:00.000Z")], [], days)).toHaveLength(1);
    expect(usageSeries("en", [], [], days)).toEqual([]);
  });

  it("tell apart two keys of one name by their prefixes, in French as well", () => {
    const keys = [key("aaaaaaaa", "Sync"), key("bbbbbbbb", "Sync", "2026-10-30T00:00:00.000Z"), key("cccccccc", "Other")];
    const series = usageSeries("fr", keys, [{ key_id: "bbbbbbbb", day: "2026-10-29", n: 1 }], days);
    expect(series.map((s) => s.label)).toEqual(["Toutes les clés", "Sync, aw_aaaaaaaa", "Other", "Sync, aw_bbbbbbbb (révoquée)"]);
  });

  it("scale each panel's axis to its data, at least to the floor, with weekly labels that leave today's end alone", () => {
    expect(axisTop([])).toBe(AXIS_FLOOR);
    expect(axisTop([0, 0, 3])).toBe(AXIS_FLOOR);
    expect(axisTop([200, 150])).toBe(200);
    expect(axisTop([2950])).toBe(3000);
    expect(axisTop([19000])).toBe(20000);
    const labels = weekLabels(days);
    expect(labels.map((l) => l.text)).toEqual([3, 10, 17, 24, 31, 38, 45, 52].map((i) => days[i]));
    // Every other one rests on a tablet, and a phone shows three, the newest among them.
    expect(labels.filter((l) => !l.minor).map((l) => l.text)).toEqual([10, 24, 38, 52].map((i) => days[i]));
    expect(labels.filter((l) => l.phone).map((l) => l.text)).toEqual([10, 31, 52].map((i) => days[i]));
  });
});

// -- the plan's figures ---------------------------------------------------------------------------

describe("the quota", () => {
  it("is the keyed API's limits for Pro, and none for a plan without the api feature", () => {
    expect(keyQuota("pro")).toEqual({ perDay: KEY_PER_DAY, perMinute: KEY_PER_MINUTE });
    expect(keyQuota("pro")).toEqual({ perDay: 20_000, perMinute: 600 });
    expect(keyQuota("free")).toBeNull();
    for (const plan of PLANS) expect(keyQuota(plan) !== null, plan).toBe(allowed({ plan }, "api"));
  });
});

// -- the page ----------------------------------------------------------------------------------

describe("the page", () => {
  it("shows a Pro account its limits, today against the cap, each key's days and the same figures in a table", async () => {
    const made = await proWithKeys("usage-two", ["Nightly sync", "Mirror"]);
    const [sync, mirror] = made.keys;
    const rows: [string, string, number][] = [];
    for (let i = 0; i < USAGE_KEEP_DAYS; i++) {
      const day = dayPlus(TODAY, -i);
      if (i % 7 !== 3) rows.push([sync.id, day, 2_000 + 10 * i]);
      if (i % 5 === 0) rows.push([mirror.id, day, 40 + i]);
    }
    await seed(rows);
    const res = await get("/account/api?chart=lines", { cookie: made.cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const html = decode(nbsp(await res.text()));
    const main = mainOf(html);
    expect(main).toContain("<h1>API Usage</h1>");
    // The four tiles: the cap a day and the limit a minute, then today's and the window's requests over every key.
    const today = 2_000 + 40;
    const windowTotal = rows.reduce((n, r) => n + r[2], 0);
    expect(main).toContain('<span class="tile-label">Requests a day, per key</span><span class="tile-value">20,000</span>');
    expect(main).toContain('<span class="tile-label">Requests a minute, per key</span><span class="tile-value">600</span>');
    expect(main).toContain(`<span class="tile-label">Requests today</span><span class="tile-value">${today.toLocaleString("en-CA")}</span><span class="tile-note">All keys, <span class="nw">${TODAY}</span> UTC</span>`);
    expect(main).toContain(`<span class="tile-label">Requests in 60 days</span><span class="tile-value">${windowTotal.toLocaleString("en-CA")}</span><span class="tile-note">All keys, <span class="nw">${FIRST}</span> to <span class="nw">${TODAY}</span></span>`);
    // Today against the cap: each key in use, its figures as text beside the bar.
    expect(main).toContain('<ol class="rank-bars of-cap" aria-label="Requests today by key, against the daily cap" data-tip="">');
    expect(main).toContain('<span class="rank-label">Nightly sync</span><span class="rank-track" aria-hidden="true"><span class="rank-bar" style="width:10%"></span></span><span class="rank-value">2,000 of 20,000 (10%)</span>');
    expect(main).toContain('<span class="rank-value">40 of 20,000 (<1%)</span>');
    // The chart: the total, then one panel a key, each with 60 points carrying their exact figures.
    expect(count(main, /<div class="chart-title">/g)).toBe(3);
    // The keys in the keys page's order, the newest first.
    expect(main).toMatch(/<div class="chart-title">All keys<\/div>[\s\S]*<div class="chart-title">Mirror<\/div>[\s\S]*<div class="chart-title">Nightly sync<\/div>/);
    expect(count(main, /<polyline class="line"/g)).toBe(3);
    // Sixty points a line: every one a mark for the pointer, the last one alone a dot that shows, on its ring.
    expect(count(main, /<line class="dot(?: dot-quiet)?"/g)).toBe(3 * USAGE_KEEP_DAYS);
    expect(count(main, /<line class="dot"/g)).toBe(3);
    expect(count(main, /<line class="dot-ring"/g)).toBe(3);
    expect(count(main, /<path class="area"/g)).toBe(3);
    expect(main).toContain(`<title>Nightly sync, ${TODAY}\n2,000 requests</title>`);
    expect(main).toContain(`<title>Nightly sync, ${dayPlus(TODAY, -3)}\n0 requests</title>`);
    expect(main).toContain(`<title>All keys, ${TODAY}\n2,040 requests</title>`);
    expect(main).toContain(`<title>Mirror, ${dayPlus(TODAY, -1)}\n0 requests</title>`);
    // Each panel on its own scale: about 2,600 a day at most takes the total's and Nightly sync's axes to 3,000, and Mirror's
    // hundred or less to 100, so its line stays readable. Every top is well under the cap: no dashed line, and the line
    // under the chart says so.
    const tops = [...main.matchAll(/<span style="bottom:100%">([0-9,]+)<\/span>/g)].map((m) => m[1]);
    expect(tops).toEqual(["3,000", "100", "3,000"]);
    expect(count(main, RULE)).toBe(0);
    expect(main).toContain("The cap, 20,000 requests a key a day, is above the top of each key's scale.");
    expect(main).not.toContain("The dashed line");
    // The table: a row a day, newest first, a column a series, sorted in the page.
    const table = /<table class="restack cols"[\s\S]*?<\/table>/.exec(main)?.[0] ?? "";
    expect(table).toContain('data-sorting="client"');
    expect(table).toMatch(/<th class="k-main"><button type="button" class="th-sort">Day \(UTC\)<\/button><\/th><th class="k-count num"><button type="button" class="th-sort">All keys<\/button><\/th>/);
    const days = [...table.matchAll(/<td data-label="Day \(UTC\)" class="mono">([0-9-]+)<\/td>/g)].map((m) => m[1]);
    expect(days).toEqual(usageDays(TODAY).reverse());
    expect(table).toContain(`<td data-label="Day (UTC)" class="mono">${TODAY}</td><td data-label="All keys" class="mono num">2,040</td><td data-label="Mirror" class="mono num">40</td><td data-label="Nightly sync" class="mono num">2,000</td>`);
    expect(table).toContain(`<td data-label="Day (UTC)" class="mono">${dayPlus(TODAY, -3)}</td><td data-label="All keys" class="mono num">0</td>`);
    expect(html).toContain('<script type="module" src="/sort.js"></script>');
    expect(html).toContain('<script type="module" src="/tooltip.js"></script>');
    // Back to the keys page, at the foot.
    expect(main).toContain('<p class="muted small">The keys, their names and the endpoints are on the <a href="/account/keys">API Keys</a> page.</p>');
    expect(html).not.toContain(EM_DASH);
    expect(main).not.toContain(EN_DASH);
  });

  it("draws a bar a day unless asked for the lines, today's in the pale step, with both forms one press apart", async () => {
    const made = await proWithKeys("usage-forms", ["Solo"]);
    const [solo] = made.keys;
    await seed([[solo.id, TODAY, 120], [solo.id, dayPlus(TODAY, -1), 900], [solo.id, dayPlus(TODAY, -3), 19_500]]);
    const bars = mainOf(await page("/account/api", { cookie: made.cookie }));
    // A bar for each day with a request, faded as the site's other amounts are; today's, a part day, pale and flat.
    expect(count(bars, /<path class="bar" style="fill:url\(#cf-\d+-\d+\) var\(--chart-bar\)"/g)).toBe(2);
    expect(count(bars, /<path class="bar bar-light"/g)).toBe(1);
    expect(bars).not.toContain("<polyline");
    expect(bars).toContain("Solo, 2026-10-30\n900 requests");
    // The cap's line is drawn in either form.
    expect([...bars.matchAll(RULE)]).toHaveLength(1);
    expect(bars).toContain('<nav aria-label="Chart form" class="tabs tabs-small"><a href="/account/api" aria-current="page">Bars</a>' +
      '<a href="/account/api?chart=lines">Lines</a></nav>');
    expect(bars).toContain("<p>The pale bar is today, a day still under way.</p>");
    const lines = mainOf(await page("/account/api?chart=lines", { cookie: made.cookie }));
    expect(count(lines, /<polyline class="line"/g)).toBe(1);
    expect(lines).not.toContain('<path class="bar');
    expect([...lines.matchAll(RULE)]).toHaveLength(1);
    expect(lines).toContain('<a href="/account/api">Bars</a><a href="/account/api?chart=lines" aria-current="page">Lines</a>');
    expect(lines).not.toContain("The pale bar");
    // Any other value is the bars, and the figures under the chart are the same in both forms.
    expect(mainOf(await page("/account/api?chart=pie", { cookie: made.cookie }))).toContain('<a href="/account/api" aria-current="page">Bars</a>');
    const table = (html: string) => /<table[\s\S]*<\/table>/.exec(html)?.[0];
    expect(table(bars)).toBe(table(lines));
    const fr = mainOf(await page("/account/api?lang=fr", { cookie: made.cookie }));
    expect(fr).toContain('<nav aria-label="Forme du graphique" class="tabs tabs-small"><a href="/account/api" aria-current="page">Barres</a>' +
      '<a href="/account/api?chart=lines">Lignes</a></nav>');
    expect(fr).toContain("La barre pâle est aujourd’hui, une journée en cours.");
  });

  it("says nothing of a pale bar on a day with no request yet", async () => {
    const made = await proWithKeys("usage-quiet", ["Solo"]);
    await seed([[made.keys[0].id, dayPlus(TODAY, -2), 50]]);
    const main = mainOf(await page("/account/api", { cookie: made.cookie }));
    expect(count(main, /<path class="bar"/g)).toBe(1);
    expect(main).not.toContain("bar-light");
    expect(main).not.toContain("The pale bar");
  });

  it("draws the cap's dashed line on a key's panel when its axis reaches it, never on the total's", async () => {
    const made = await proWithKeys("usage-near", ["Heavy", "Light"]);
    const [heavy, light] = made.keys;
    await seed([[heavy.id, TODAY, 19_000], [light.id, TODAY, 300], [heavy.id, dayPlus(TODAY, -1), 9_000]]);
    const main = mainOf(await page("/account/api?chart=lines", { cookie: made.cookie }));
    // The panels in order: the total (19,300 a day, its axis to 20,000), Light (to 300), Heavy (to 20,000).
    const tops = [...main.matchAll(/<span style="bottom:100%">([0-9,]+)<\/span>/g)].map((m) => m[1]);
    expect(tops).toEqual(["20,000", "300", "20,000"]);
    // Heavy's axis reaches the cap, so the line sits at its top; Light's does not, and the total of two keys has no cap.
    expect([...main.matchAll(RULE)].map((m) => m[1])).toEqual(["0"]);
    expect(panelOf(main, "Heavy")).toContain("mark-rule");
    for (const title of ["All keys", "Light"]) {
      expect(panelOf(main, title), title).toContain("<polyline");
      expect(panelOf(main, title), title).not.toContain("mark-rule");
    }
    expect(main).toContain("The dashed line marks the cap of 20,000 requests a key a day, on each key's chart whose scale reaches it.");
    expect(main).not.toContain("is above the top");
  });

  it("draws it on a single key's panel at the axis's top, with no total", async () => {
    const made = await proWithKeys("usage-one-near", ["Bulk"]);
    await seed([[made.keys[0].id, TODAY, 19_000]]);
    const main = mainOf(await page("/account/api", { cookie: made.cookie }));
    expect(count(main, /<div class="chart-title">/g)).toBe(1);
    expect(main).not.toContain("All keys</div>");
    expect([...main.matchAll(RULE)].map((m) => m[1])).toEqual(["0"]);
    expect(main).toContain("The dashed line marks the cap of 20,000 requests a key a day.");
  });

  it("keeps a light account readable: 200 a day draws on a scale of 200 and states the cap in figures", async () => {
    const made = await proWithKeys("usage-light", ["Small"]);
    await seed(Array.from({ length: 30 }, (_, i): [string, string, number] => [made.keys[0].id, dayPlus(TODAY, -i), 150 + (i % 6) * 10]));
    const main = mainOf(await page("/account/api", { cookie: made.cookie }));
    expect(main).toContain('<span style="bottom:100%">200</span>');
    expect(count(main, RULE)).toBe(0);
    expect(main).toContain("The cap, 20,000 requests a key a day, is above the top of this scale.");
    expect(main).toContain('<span class="rank-value">150 of 20,000 (<1%)</span>');
  });

  it("draws the empty chart for keys with no rows: zero lines on the floor's scale, zeros in the tiles and the table", async () => {
    const made = await proWithKeys("usage-empty", ["Fresh"]);
    const main = mainOf(await page("/account/api?chart=lines", { cookie: made.cookie }));
    expect(main).toContain(`<span style="bottom:100%">${AXIS_FLOOR}</span>`);
    expect(main).toContain('<span class="tile-label">Requests today</span><span class="tile-value">0</span>');
    expect(main).toContain('<span class="tile-label">Requests in 60 days</span><span class="tile-value">0</span>');
    expect(main).toContain('<span class="rank-value">0 of 20,000 (0%)</span>');
    expect(count(main, /<polyline class="line"/g)).toBe(1);
    expect(count(main, /class="mono num">0<\/td>/g)).toBe(USAGE_KEEP_DAYS);
    expect(main).toContain("The cap, 20,000 requests a key a day, is above the top of this scale.");
  });

  it("draws the empty chart for an account with no key, with the way to make one and no table", async () => {
    const made = await proWithKeys("usage-none", []);
    const main = mainOf(await page("/account/api", { cookie: made.cookie }));
    expect(main).toContain('<p class="muted">No key is in use. Keys are made on the <a href="/account/keys">API Keys</a> page.</p>');
    expect(main).toContain('<div class="chart-title">All keys</div>');
    expect(main).not.toContain("<polyline");
    expect(main).not.toContain("<table");
    expect(main).toContain('<span class="tile-value">20,000</span>');
  });

  it("names a revoked key that has rows in the window, and leaves out a revoked key without any", async () => {
    const made = await proWithKeys("usage-revoked", ["Old sync", "Unused", "New sync"]);
    const [old, unused, fresh] = made.keys;
    const token = await csrf(made.cookie, "/account/keys");
    for (const k of [old, unused]) await post(`/account/keys/${k.id}/revoke`, { csrf: token }, { cookie: made.cookie });
    await seed([[old.id, "2026-10-01", 300], [fresh.id, TODAY, 12]]);
    const main = mainOf(await page("/account/api", { cookie: made.cookie }));
    expect(main).toContain('<div class="chart-title">Old sync (revoked)</div>');
    expect(main).not.toContain("Unused");
    // Today's bars are the keys in use alone.
    expect(count(main, /<span class="rank-label">/g)).toBe(1);
    expect(main).toContain('<span class="rank-label">New sync</span>');
    expect(main).toContain('<td data-label="Old sync (revoked)" class="mono num">300</td>');
    expect(main).toContain('<span class="tile-label">Requests in 60 days</span><span class="tile-value">312</span>');
  });
});

// -- the read ----------------------------------------------------------------------------------

describe("the read", () => {
  it("takes at most KEYS_MAX keys, the ones in use first, and the page says when a revoked key may be left out", async () => {
    const made = await proWithKeys("usage-bound", ["k1", "k2", "k3", "k4", "k5"]);
    const token = await csrf(made.cookie, "/account/keys");
    await post(`/account/keys/${made.keys[0].id}/revoke`, { csrf: token }, { cookie: made.cookie });
    await post("/account/keys", { csrf: token, name: "k6" }, { cookie: made.cookie });
    const all = await ACCOUNTS.prepare("SELECT k.id, k.name, k.revoked_at FROM api_keys k JOIN users u ON u.id = k.user_id WHERE u.email = ?")
      .bind(made.email).all<{ id: string; name: string; revoked_at: string | null }>();
    const keys = all.results ?? [];
    expect(keys).toHaveLength(KEYS_MAX + 1);
    const rows: [string, string, number][] = [];
    for (const k of keys) for (let i = 0; i < USAGE_KEEP_DAYS + 2; i++) rows.push([k.id, dayPlus(TODAY, -i), 1]);
    await seed(rows);
    const userId = (await ACCOUNTS.prepare("SELECT id FROM users WHERE email = ?").bind(made.email).first<{ id: string }>())!.id;
    const read = await ACCOUNTS.prepare(DAILY_SQL).bind(userId, TODAY, FIRST, KEYS_MAX).all<{ key_id: string; day: string }>();
    const results = read.results ?? [];
    // Five keys, sixty days each: the window's rows alone, and the revoked key's left for the five in use.
    expect(results).toHaveLength(KEYS_MAX * USAGE_KEEP_DAYS);
    expect(new Set(results.map((r) => r.key_id))).toEqual(new Set(keys.filter((k) => !k.revoked_at).map((k) => k.id)));
    expect(results.every((r) => r.day >= FIRST && r.day <= TODAY)).toBe(true);
    const main = mainOf(await page("/account/api", { cookie: made.cookie }));
    expect(main).not.toContain("k1 (revoked)");
    expect(main).toContain("The chart and the totals count at most 5 keys with requests in these days, the keys in use first, then the ones revoked most recently.");
    // With room (a key in use without a request in the window), the revoked key's days come back and the line goes.
    await ACCOUNTS.prepare("DELETE FROM api_usage WHERE key_id = ?").bind(keys.find((k) => k.name === "k6")!.id).run();
    const again = mainOf(await page("/account/api", { cookie: made.cookie }));
    expect(again).toContain('<div class="chart-title">k1 (revoked)</div>');
    expect(again).toContain('<div class="chart-title">k6</div>');
    expect(again).not.toContain("at most 5 keys");
  });

  it("is a constant with ?N placeholders that reads api_usage through its primary key, never the whole table", async () => {
    expect(DAILY_SQL).not.toMatch(/\?(?!\d)/);
    expect(DAILY_SQL).toContain("LIMIT ?4");
    const plan = ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${DAILY_SQL}`).bind("u", TODAY, FIRST, KEYS_MAX).all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    const detail = plan.join("\n");
    expect(plan.filter((s) => /^SCAN (api_usage|u)\b/.test(s) && !/USING/.test(s)), detail).toEqual([]);
    expect(plan.filter((s) => /api_usage|\bu\b/.test(s)).every((s) => s.includes("sqlite_autoindex_api_usage_1")), detail).toBe(true);
    expect(plan.some((s) => s.includes("idx_api_keys_user")), detail).toBe(true);
  });
});

// -- the readers -------------------------------------------------------------------------------

describe("the readers", () => {
  it("sends a Free account to the keys page without reading the counts, and its keys page has no button to it", async () => {
    const cookie = await signIn(newEmail("usage-free"));
    const trap = failing(DAILY_SQL);
    const res = await get("/account/api", { cookie, env: onEnv({ ACCOUNTS: trap.db }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/keys");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(trap.used).not.toContain(DAILY_SQL);
    const keys = await page("/account/keys", { cookie });
    expect(keys).not.toContain('href="/account/api"');
    // The overview lists the page with the chip, as it lists the keys (test/pro-mark.test.ts).
    expect(await page("/account", { cookie })).toContain('<a href="/account/api">API usage<span class="pro-tag">');
  });

  it("sends a reader who is not signed in to the sign-in page", async () => {
    const res = await get("/account/api");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/sign-in?next=%2Faccount%2Fapi");
  });

  it("answers 200 when the counts cannot be read: the limits, the empty chart and the line saying so", async () => {
    const made = await proWithKeys("usage-unread", ["Broken"]);
    await seed([[made.keys[0].id, TODAY, 50]]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const trap = failing(DAILY_SQL);
      const res = await get("/account/api", { cookie: made.cookie, env: onEnv({ ACCOUNTS: trap.db }) });
      expect(res.status).toBe(200);
      expect(trap.used).toContain(DAILY_SQL);
      const main = mainOf(decode(nbsp(await res.text())));
      expect(main).toContain('<span class="tile-value">20,000</span>');
      expect(main).toContain('<span class="tile-value">600</span>');
      expect(main).not.toContain("Requests today</span>");
      expect(count(main, /The counts cannot be read just now\./g)).toBe(2);
      expect(main).toContain('<div class="chart-title">All keys</div>');
      expect(main).not.toContain("<polyline");
      expect(main).not.toContain("<table");
      expect(main).not.toContain("rank-bars");
      expect(error).toHaveBeenCalledWith("api usage: not readable for the usage page");
    } finally {
      error.mockRestore();
    }
  });
});

// -- the languages -----------------------------------------------------------------------------

describe("the languages", () => {
  it("render the page in English and in French, with no em-dash and no placeholder left", async () => {
    const made = await proWithKeys("usage-lang", ["Synchro", "Miroir"]);
    await seed([[made.keys[0].id, TODAY, 1234], [made.keys[1].id, dayPlus(TODAY, -2), 56]]);
    // The lines, whose marks include the days at 0 (a bar is drawn only for a day with a request).
    const en = await page("/account/api?chart=lines", { cookie: made.cookie });
    const fr = await page("/account/api?lang=fr&chart=lines", { cookie: made.cookie });
    expect(en).toContain('<html lang="en">');
    expect(fr).toContain('<html lang="fr">');
    const main = mainOf(fr);
    expect(main).toContain("<h1>Utilisation de l’API</h1>");
    expect(main).toContain('<span class="tile-label">Requêtes par jour, par clé</span><span class="tile-value">20 000</span>');
    expect(main).toContain('<span class="tile-note">Chaque adresse : au plus 60 par minute</span>');
    expect(main).toContain('<div class="chart-title">Toutes les clés</div>');
    expect(main).toContain(`<title>Synchro, ${TODAY}\n1 234 requêtes</title>`);
    expect(main).toContain(`<title>Miroir, ${TODAY}\n0 requête</title>`);
    expect(main).toContain('<span class="rank-value">1 234 sur 20 000 (6 %)</span>');
    expect(main).toContain("Le plafond, 20 000 requêtes par clé par jour, dépasse le haut de l’échelle de chaque clé.");
    expect(main).toContain(`<span class="panel-count">du <span class="nw">${FIRST}</span> au <span class="nw">${TODAY}</span></span>`);
    for (const english of ["Requests a day", "All keys", "Today Against the Cap", "API Usage", "is above the top"]) expect(main, english).not.toContain(english);
    for (const html of [en, fr]) {
      expect(html).not.toContain(EM_DASH);
      expect(mainOf(html)).not.toContain(EN_DASH);
      expect(mainOf(html)).not.toMatch(/\{\w+\}/);
    }
  });
});

// -- the links ---------------------------------------------------------------------------------

describe("the links to the page", () => {
  it("are a button in the keys page's head and a line of the overview, without the chip, for a Pro account", async () => {
    const made = await proWithKeys("usage-links", []);
    const keys = mainOf(await page("/account/keys", { cookie: made.cookie }));
    expect(keys).toContain('<div class="page-actions"><a href="/account/api" class="btn">API usage</a><a href="/account" class="btn">Your Account</a></div>');
    const home = mainOf(await page("/account", { cookie: made.cookie }));
    expect(home).toContain('<a href="/account/keys">API keys</a><span class="num">0</span></li><li><a href="/account/api">API usage</a></li>');
    const fr = mainOf(await page("/account/keys?lang=fr", { cookie: made.cookie }));
    expect(fr).toContain('<a href="/account/api" class="btn">Utilisation de l’API</a>');
    for (const html of [keys, home]) expect(html).not.toContain('class="pro-tag"');
  });

  it("leave the bar's track to a token of the stylesheet, so it reads in both themes", () => {
    const rule = /\.rank-bars\.of-cap \.rank-track \{([^}]*)\}/.exec(STYLES)?.[1] ?? "";
    expect(rule.trim()).toBe("background: var(--chart-bar-light); border-left: 0; border-radius: 4px;");
  });
});
