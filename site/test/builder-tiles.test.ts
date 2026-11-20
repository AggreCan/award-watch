// The analytics builder's views kept on an account (src/account/build_views.tsx;
// docs/accounts.md, Dashboard and Saved views; docs/analytics.md, "The
// builder"): the dashboard's tiles of kind "build" (a view's chart, sorted bars,
// figures or table at the tile's size) and "number" (its latest figure with
// its change from the fiscal year before), Add a Tile's third door, the
// builder page's Add to dashboard and Save this view, the find page's "Open in
// the builder", and the saved views of kind "build", which are never sent by
// email.
//
// The switch first: with BUILDER off, absent or anything but "on", every page
// keeps every byte whatever the account holds, nothing new is offered or taken,
// and a tile kept from before reads nothing. Then, with it on, against the
// records database of test/builder-fixture.ts: the tiles' statements in the
// dashboard's one records batch, their figures worked out here from the rows,
// a tile that cannot be read leaving the others, the posts' checks, the saved
// view, its email never offered nor sent, both languages, no em or en dash and
// no evaluative word.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { LEAST, START_H } from "../public/dash-grid.js";
import { BUILD_KINDS, buildRef, buildSizeKey } from "../src/account/build_views";
import { PANEL_KINDS, TEASE_KINDS, specOf, teaseKinds } from "../src/account/dashboard";
import { OPTS_MAX } from "../src/account/dashboard_rule";
import { DASHBOARD_STRINGS } from "../src/account/dashboard_strings";
import { LABEL_MAX, SET_DELIVERY_SQL, viewLabel } from "../src/account/saved_views";
import { VIEWS_DUE_SQL, runViewMail } from "../src/account/view_mail";
import { BUILD_PATH, type BuildChoice, buildAddress, buildShape, figureChoice, figureOffered, readBuild, readBuildAddress } from "../src/builder";
import { CUBE_META_SQL, CELL_YEARS_SQL, BUYERS_YEARS_SQL } from "../src/builder_sql";
import { BUILDER_STRINGS } from "../src/builder_strings";
import { fmtMoneyShort, rawEntry, t, type Key } from "../src/i18n";
import { bucketFor } from "../src/limits";
import { EARLIEST_FY, STATE_SQL } from "../src/records_db";
import {
  ACCOUNTS, csrf, decode, get, grantPro, grantUltra, nbsp, newEmail, post, signIn, ultraEnv, useAccountsDb, userId,
} from "./accounts-helpers";
import { testEnv } from "./assets";
import { PSPC, RECORDS, RECS, cellOf, seedBuilder } from "./builder-fixture";
import { fakeMail } from "./mail-fixtures";

useAccountsDb();
beforeAll(() => seedBuilder());

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const ON = { BUILDER: "on" };
// Ultra on sale (its variables and the payments), the records of the fixture; the builder's switch as given.
const sale = (extra: Record<string, unknown> = {}) => ultraEnv({ RECORDS, ...extra });
const on = (extra: Record<string, unknown> = {}) => sale({ ...ON, ...extra });
const text = async (res: Response) => nbsp(decode(await res.text())).replace(/\u2019/g, "'");
const mainOf = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));

// -- readers and their rows -------------------------------------------------------------------------

type Reader = { email: string; id: string; cookie: string; csrf: string };
async function reader(tag: string, plan: "free" | "pro" | "ultra" = "ultra"): Promise<Reader> {
  const email = newEmail(tag);
  const cookie = await signIn(email, { env: sale() });
  if (plan === "pro") await grantPro(email);
  if (plan === "ultra") await grantUltra(email);
  return { email, id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env: sale() }) };
}

let boards = 0;
// The account's first dashboard, stored and empty, so a page shows only the tiles a test puts there.
async function freshBoard(r: Reader): Promise<string> {
  const id = `${(++boards).toString(16).padStart(8, "0")}${"b".repeat(24)}`;
  await ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, '', 0, ?)").bind(id, r.id, new Date(Date.UTC(2026, 9, 1)).toISOString()).run();
  return id;
}
let tiles = 0;
// A tile as stored, its ref as given (a test's own, never checked on the way in).
async function putTile(r: Reader, board: string, kind: string, ref: string, at: { x: number; y: number; w: number; h: number }): Promise<string> {
  const id = `${(++tiles).toString(16).padStart(8, "0")}${"c".repeat(24)}`;
  await ACCOUNTS.prepare("INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)")
    .bind(id, board, r.id, kind, ref, at.x, at.y, at.w, at.h, new Date(Date.UTC(2026, 9, 1, 0, 0, tiles)).toISOString()).run();
  return id;
}
const tileRows = async (r: Reader) =>
  ((await ACCOUNTS.prepare("SELECT id, kind, ref FROM dashboard_tiles WHERE user_id = ?").bind(r.id).all<{ id: string; kind: string; ref: string }>()).results ?? []);
const viewRows = async (r: Reader) =>
  ((await ACCOUNTS.prepare("SELECT id, kind, address, name, deliver, last_delivered_at FROM saved_views WHERE user_id = ?").bind(r.id)
    .all<{ id: string; kind: string; address: string; name: string; deliver: string; last_delivered_at: string | null }>()).results ?? []);

const page = async (r: Reader | null, path: string, env: object) => get(path, { cookie: r?.cookie, env });
const addTile = (r: Reader, kind: string, ref: string, env: object, extra: Record<string, string> = {}) =>
  post("/account/dashboard/panels", { csrf: r.csrf, kind, ref, ...extra }, { cookie: r.cookie, env });

// A D1 binding that writes down every batch it runs, by the statements' text (as test/builder.test.ts's).
function recording(db: D1Database): { binding: D1Database; batches: string[][] } {
  const batches: string[][] = [];
  const sqlOf = new WeakMap<object, string>();
  const binding = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      sqlOf.set(st, sql);
      const bind = st.bind.bind(st);
      (st as { bind: unknown }).bind = (...args: unknown[]) => {
        const bound = bind(...args);
        sqlOf.set(bound, sql);
        return bound;
      };
      return st;
    },
    async batch(statements: D1PreparedStatement[]) {
      batches.push(statements.map((s) => sqlOf.get(s) ?? "?"));
      return db.batch(statements);
    },
  } as unknown as D1Database;
  return { binding, batches };
}

// A binding that notes every use and throws: proof that nothing reads it.
function trap<T>(what: string) {
  const used: string[] = [];
  const binding = new Proxy({}, {
    get(_t, prop) {
      used.push(String(prop));
      throw new Error(`${what} was read`);
    },
  }) as T;
  return { used, binding };
}

// -- the views the tests keep ---------------------------------------------------------------------

const B = (q: string) => `${BUILD_PATH}?${q}`;
// A chart: PSPC's contract history value by fiscal year. A figure of it: records. Sorted bars: every buyer by segment.
// A table: a segment's records by procurement method. A comparison: two buyers' award notices.
const CHART = B("subject=buyer&b=pwgsc-tpsgc&rows=year&measure=value&source=history&from=2022&to=2026&show=bars");
const RECORDS_YEARS = B("subject=buyer&b=pwgsc-tpsgc&rows=year&measure=records&source=history&from=2022&to=2026&show=bars");
const RANKED = B("subject=all&rows=segment&measure=value&source=history&from=2022&to=2026&show=ranked&top=10");
const TABLE = B("subject=segment&s=82&rows=method&measure=records&source=history&from=2022&to=2026&show=table");
const MEDIAN = B("subject=all&rows=year&measure=median&source=history&from=2017&to=2026&show=line");
const NC = B("subject=buyer&b=pwgsc-tpsgc&rows=none&measure=noncompetitive&source=history&from=2022&to=2026&show=number");
const PAIR = B("subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&rows=year&measure=value&source=awards&from=2024&to=2026&show=bars");
// A combination the menus do not offer (a median by segment over five years) and a buyer the list does not hold.
const NOT_OFFERED = B("subject=all&rows=segment&measure=median&source=history&from=2022&to=2026&show=ranked&top=10");
const GONE = B("subject=buyer&b=no-such-buyer&rows=year&measure=value&source=history&from=2022&to=2026&show=bars");

const readAt = (address: string) => readBuildAddress(address, 2026, { max: OPTS_MAX })!;
const cents = (rows: typeof RECS) => rows.reduce((s, r) => s + (r.cents ?? 0), 0);
const pspc = (fy: number) => RECS.filter((r) => r.extra === 0 && r.bid === PSPC && r.src === 2 && r.fy === fy);
const everyRecord = (fy: number) => RECS.filter((r) => r.extra === 0 && r.src === 2 && r.fy === fy);
const signed = (d: number) => `${d > 0 ? "+" : "-"}${Math.abs(d)}`;
// The non-competitive share by count of PSPC's contract history in a fiscal year, in per cent.
const shareOf = (fy: number) => (pspc(fy).filter((x) => x.comp === 0).length / pspc(fy).length) * 100;
// A figure's tile among the dashboard's: by its title and its item, and the address's last year where two share both.
const figureOf = (html: string, title: string, item: string, to?: string) => html.split("<section ")
  .find((x) => x.includes(`data-title="${title}"`) && x.includes(`<span class="dash-item">${item}</span>`) && (!to || x.includes(`to=${to}&`))) ?? "";
// Words that weigh a figure rather than describe it, in either language.
const FIGURE_FORBIDDEN = /\b(better|worse|strong|weak|good|bad|improv\w*|declin\w*|best|worst|healthy|concerning|dominant|risk|meilleur\w*|pire|fort|faible|risque)\b/i;
// A change as a percentage, with its sign, whole, "<1" for one that rounds to none.
const pctOf = (ratio: number) => `${ratio > 0 ? "+" : "-"}${Math.round(Math.abs(ratio) * 100) || "<1"}%`;
// A string as the page's text reads once decoded (no-break spaces as spaces, straight apostrophes).
const norm = (s: string) => nbsp(s).replace(/\u2019/g, "'");

// -- the model ------------------------------------------------------------------------------------

describe("a view kept on an account", () => {
  it("keeps an address in its one form, a figure only of a view with one figure a fiscal year, and reads a stored one without trusting it", () => {
    const ids = new Set(["pwgsc-tpsgc", "dfo-mpo", "dnd-mdn"]);
    for (const address of [CHART, RANKED, TABLE, MEDIAN, NC, PAIR]) {
      expect(buildRef("build", address, 2026, ids), address).toBe(address);
      expect(buildAddress(readAt(address))).toBe(address);
    }
    // Not in its one form (another order, a value read otherwise), past the bound, another path, a fragment.
    for (const raw of [
      B("rows=year&subject=buyer&b=pwgsc-tpsgc&measure=value&source=history&from=2022&to=2026&show=bars"), `${CHART}&extra=1`, `${CHART}#x`,
      CHART.replace("show=bars", "show=pie"), CHART.replace("to=2026", "to=2031"), `/analytics/build.csv?${CHART.split("?")[1]}`,
      `${CHART}${"&b=dfo-mpo".repeat(200)}`, `https://elsewhere.example${CHART}`, 42, null,
    ]) expect(buildRef("build", raw, 2026, ids), String(raw)).toBeNull();
    expect(`${CHART}${"x".repeat(OPTS_MAX)}`.length).toBeGreaterThan(OPTS_MAX);
    // Not offered, a buyer the list does not hold, a subject not chosen.
    expect(buildRef("build", NOT_OFFERED, 2026, ids)).toBeNull();
    expect(buildRef("build", GONE, 2026, ids)).toBeNull();
    expect(buildRef("build", B("subject=segment&rows=year&measure=value&source=awards&from=2022&to=2026&show=bars"), 2026, ids)).toBeNull();
    // A figure: by fiscal year or for the period, of one subject, never the contracts ending nor a comparison.
    expect(buildRef("number", CHART, 2026, ids)).toBe(CHART);
    expect(buildRef("number", NC, 2026, ids)).toBe(NC);
    for (const address of [RANKED, TABLE, PAIR, B("subject=buyer&b=pwgsc-tpsgc&rows=none&measure=ending&show=number")]) {
      expect(buildRef("number", address, 2026, ids), address).toBeNull();
    }
    expect(figureOffered(readAt(B("subject=buyer&b=pwgsc-tpsgc&rows=none&measure=ending&show=number")))).toBe(false);
    // The figure's view: the same by fiscal year over the last year and the one before; one year at the earliest.
    const fig = figureChoice(readAt(NC));
    expect([fig.rows, fig.first, fig.last, fig.measure, fig.source, fig.subject]).toEqual(["year", 2025, 2026, "noncompetitive", "history", "buyer"]);
    expect(figureChoice({ ...readAt(CHART), first: EARLIEST_FY, last: EARLIEST_FY } as BuildChoice).first).toBe(EARLIEST_FY);
    // A stored address is read as the page reads it (a stale period is read at the data date's year), never refused by its form.
    const later = readBuildAddress(CHART, 2030, { max: OPTS_MAX });
    expect(later?.last).toBe(2026);
    expect(readBuildAddress(CHART, 2026, { max: CHART.length - 1 })).toBeNull();
    expect(readBuild(new URL(CHART, "https://x.invalid"), 2026)).toEqual(readAt(CHART));
  });

  it("sizes each shape apart, the least sizes and starting heights listed for each, the stored bound the dashboard's own", () => {
    expect(buildSizeKey("build", CHART)).toBe("build:chart");
    expect(buildSizeKey("build", PAIR)).toBe("build:two");
    expect(buildSizeKey("build", B("subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&b=dnd-mdn&rows=year&measure=value&source=awards&from=2024&to=2026&show=line"))).toBe("build:panels");
    expect(buildSizeKey("build", B("subject=buyer&b=pwgsc-tpsgc&rows=year&measure=largest&source=history&from=2022&to=2026&show=line"))).toBe("build:panels");
    expect(buildSizeKey("build", RANKED)).toBe("build:ranked");
    expect(buildSizeKey("build", TABLE)).toBe("build:table");
    expect(buildSizeKey("build", NC)).toBe("build:number");
    expect(buildSizeKey("build", "not a view")).toBe("build:table");
    expect(buildSizeKey("number", CHART)).toBe("number");
    for (const key of ["build:chart", "build:two", "build:panels", "build:ranked", "build:number", "build:table", "number"]) {
      expect(LEAST[key as keyof typeof LEAST], key).toBeDefined();
      expect(START_H[key as keyof typeof START_H], key).toBeGreaterThanOrEqual(LEAST[key as keyof typeof LEAST].hn);
    }
    expect(buildShape(readAt(B("subject=buyer&b=pwgsc-tpsgc&rows=quarter&measure=ending&show=bars")))).toEqual({ shape: "chart", panels: 2 });
    expect(PANEL_KINDS).toEqual(expect.arrayContaining([...BUILD_KINDS]));
  });
});

// -- the switch ---------------------------------------------------------------------------------

describe("the switch", () => {
  it("leaves every page byte for byte for off, absent and any other value, offers nothing new, and a kept tile reads nothing", { timeout: 30_000 }, async () => {
    const ultra = await reader("tiles-off-ultra");
    const free = await reader("tiles-off-free", "free");
    // What an account kept while the builder was on: a view's tile, a figure's, and a saved view.
    const board = await freshBoard(ultra);
    await putTile(ultra, board, "build", CHART, { x: 0, y: 0, w: 6, h: 13 });
    await putTile(ultra, board, "number", CHART, { x: 6, y: 0, w: 3, h: 5 });
    await ACCOUNTS.prepare("INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'build', ?, 'My builder view', 'en', 'off', ?)")
      .bind(`${"d".repeat(31)}1`, ultra.id, CHART, "2026-10-01T00:00:00.000Z").run();
    const paths: [Reader, string][] = [
      [ultra, "/account/dashboard"], [ultra, `/account/dashboard/find?q=engineering&kind=segment`], [ultra, "/account/views"], [ultra, "/analytics"],
      [ultra, "/account/dashboard?lang=fr"], [free, "/account/dashboard"], [free, "/account/dashboard?lang=fr"],
    ];
    for (const [r, path] of paths) {
      const records = trap<D1Database>("the records database");
      const off = await (await page(r, path, sale({ BUILDER: "off", RECORDS: records.binding }))).text();
      const absent = await (await page(r, path, sale({ BUILDER: undefined, RECORDS: records.binding }))).text();
      const other = await (await page(r, path, sale({ BUILDER: "ON", RECORDS: records.binding }))).text();
      const clean = (s: string) => s.replace(/name="csrf" value="[0-9a-f]{32}"/g, "").replace(/"csrf":"[0-9a-f]{32}"/g, "");
      expect(clean(absent), path).toBe(clean(off));
      expect(clean(other), path).toBe(clean(off));
      // Nothing of the builder named or linked from the page, the kept tiles drawn as unreadable, no records read.
      expect(mainOf(off), path).not.toContain(BUILD_PATH);
      for (const key of ["dash.add_build", "dash.what_build", "dash.what_number", "build.open", "build.view_no_mail"] as Key[]) {
        expect(mainOf(off), `${path} ${key}`).not.toContain(nbsp(t(path.includes("fr") ? "fr" : "en", key)));
      }
      expect(records.used, path).toEqual([]);
    }
    const dash = await text(await page(ultra, "/account/dashboard", sale({ BUILDER: "off" })));
    expect(dash.match(new RegExp(`<p>${t("en", "dash.unavailable")}</p>`, "g"))).toHaveLength(2);
    // The saved view is listed, counted and removable, named and not linked, with no Add to dashboard.
    const views = await text(await page(ultra, "/account/views", sale({ BUILDER: "off" })));
    expect(views).toContain("My builder view<br/><span class=\"muted small\">Analytics builder</span>");
    expect(views).not.toContain(`value="${CHART}"`);
    // Nothing of either kind is taken, nor a view of the builder saved.
    for (const kind of BUILD_KINDS) expect((await addTile(ultra, kind, RECORDS_YEARS, sale({ BUILDER: "off" }))).status).toBe(400);
    expect((await post("/account/views", { csrf: ultra.csrf, address: RECORDS_YEARS, name: "" }, { cookie: ultra.cookie, env: sale({ BUILDER: "off" }) })).status).toBe(400);
    expect((await tileRows(ultra)).map((x) => x.ref)).toEqual([CHART, CHART]);
    // The tease names the kinds there are; the builder's two only while its switch is on.
    expect(TEASE_KINDS).not.toContain("build");
    expect(teaseKinds(true)).toEqual([...TEASE_KINDS.slice(0, TEASE_KINDS.indexOf("analytic") + 1), "build", "number", ...TEASE_KINDS.slice(TEASE_KINDS.indexOf("analytic") + 1)]);
    for (const lang of ["en", "fr"] as const) {
      const tease = await text(await page(free, `/account/dashboard${lang === "fr" ? "?lang=fr" : ""}`, on()));
      for (const k of ["build", "number"]) expect(tease).toContain(`<li>${nbsp(t(lang, `dash.what_${k}` as Key)).replace(/\u2019/g, "'")}</li>`);
      expect(tease.slice(tease.indexOf("<ul>"), tease.indexOf("</ul>", tease.indexOf("<ul>"))).match(/<li>/g)).toHaveLength(teaseKinds(true).length);
    }
  });
});

// -- the dashboard ---------------------------------------------------------------------------------

describe("the tiles", () => {
  it("add a view and its figure through the dashboard's post, in its edit bucket, each checked, the same item once", async () => {
    const r = await reader("tiles-add");
    await freshBoard(r);
    expect(bucketFor("POST", "/account/dashboard/panels")).toBe("edit");
    const added = await addTile(r, "build", CHART, on());
    expect(added.status).toBe(303);
    expect(added.headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    expect((await addTile(r, "number", CHART, on())).headers.get("location")).toMatch(/\?m=added#tile-/);
    expect((await addTile(r, "build", CHART, on())).headers.get("location")).toMatch(/\?m=exists#tile-/);
    // Refused: not in its form, not offered, a buyer the list does not hold, a figure of a view with none a year.
    for (const [kind, ref] of [["build", `${CHART}&x=1`], ["build", NOT_OFFERED], ["build", GONE], ["number", RANKED], ["number", PAIR]]) {
      expect((await addTile(r, kind, ref, on())).status, `${kind} ${ref}`).toBe(400);
    }
    // Every post with its csrf.
    expect((await post("/account/dashboard/panels", { csrf: "0".repeat(32), kind: "build", ref: TABLE }, { cookie: r.cookie, env: on() })).status).toBe(403);
    // A reader whose plan has no builder holds no dashboard: the post goes back to the dashboard's address, nothing kept.
    const pro = await reader("tiles-add-pro", "pro");
    expect((await addTile(pro, "build", TABLE, on())).status).toBe(303);
    expect(await tileRows(pro)).toEqual([]);
    expect((await tileRows(r)).map((x) => `${x.kind} ${x.ref}`).sort()).toEqual([`build ${CHART}`, `number ${CHART}`]);
  });

  it("draw a chart, sorted bars, a table and figures from the page's one records batch, private, with their Open", { timeout: 30_000 }, async () => {
    const r = await reader("tiles-draw");
    const board = await freshBoard(r);
    await putTile(r, board, "build", CHART, { x: 0, y: 0, w: 6, h: 14 });
    await putTile(r, board, "build", RANKED, { x: 6, y: 0, w: 6, h: 14 });
    await putTile(r, board, "build", TABLE, { x: 0, y: 14, w: 6, h: 10 });
    await putTile(r, board, "number", RECORDS_YEARS, { x: 6, y: 14, w: 3, h: 5 });
    await putTile(r, board, "number", CHART, { x: 9, y: 14, w: 3, h: 5 });
    await putTile(r, board, "number", MEDIAN, { x: 6, y: 19, w: 3, h: 5 });
    await putTile(r, board, "number", NC, { x: 9, y: 19, w: 3, h: 5 });
    const rec = recording(RECORDS);
    const res = await page(r, "/account/dashboard", on({ RECORDS: rec.binding }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const html = await text(res);
    // One batch: the state row, then each tile's statements, cube_meta before a cube's.
    expect(rec.batches).toHaveLength(1);
    expect(rec.batches[0][0]).toBe(STATE_SQL);
    expect(rec.batches[0].filter((s) => s === CUBE_META_SQL).length).toBe(rec.batches[0].filter((s) => s.includes("FROM cube_bs")).length);
    expect(rec.batches[0]).toContain(BUYERS_YEARS_SQL);
    expect(rec.batches[0]).toContain(CELL_YEARS_SQL);
    expect(rec.batches[0].length).toBeLessThanOrEqual(1 + 7 * 3);
    expect(html.match(/class="btn btn-primary"/g)).toHaveLength(1);
    // Each tile headed by its view's title, its subject the item, its source and period in the foot, its Open the view.
    expect(html).toContain('Value by fiscal year<span class="dash-item">Public Services and Procurement Canada</span>');
    expect(html).toContain('Value by segment<span class="dash-item">Every buyer</span>');
    expect(html).toContain("PSPC contract history, federal fiscal years 2022-23 to 2026-27.");
    for (const address of [CHART, RANKED, TABLE, RECORDS_YEARS, MEDIAN, NC]) expect(html, address).toContain(`<a href="${address}">Open</a>`);
    // The chart and its table, the sorted bars, the table alone.
    const tileOf = (title: string) => {
      const at = html.indexOf(`data-title="${title}"`);
      return html.slice(at, html.indexOf("</section>", at));
    };
    expect(tileOf("Value by fiscal year")).toContain('class="chart-stack"');
    expect(tileOf("Value by fiscal year")).toContain('class="dash-body dash-rest dash-stack-540"');
    expect(tileOf("Value by segment")).toContain('<ol class="rank-bars"');
    expect(tileOf("Records by procurement method")).not.toContain('class="chart');
    expect(tileOf("Records by procurement method")).toContain("<table");
    // The value of 2026-27 (to date) on the chart's table, from the rows.
    expect(tileOf("Value by fiscal year")).toContain(nbsp(new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(cents(pspc(2026)) / 100)));
    // The figures of the year to date (2026-27): records, value, a median (one year's, never added), the
    // non-competitive share. Part of a year is never set against a whole one: no change line, and under each the
    // year before in full, its own figure in its own form.
    const recs = figureOf(html, "Records", "Public Services and Procurement Canada");
    expect(recs).toContain(`<span class="tile-label">Records, 2026-27 (to date)</span><span class="tile-value">${pspc(2026).length}</span>`);
    expect(recs).toContain(`<span class="tile-note">2025-26, the full year: ${pspc(2025).length}</span>`);
    const value = figureOf(html, "Value", "Public Services and Procurement Canada");
    expect(value).toContain(`<span class="tile-note">2025-26, the full year: ${nbsp(fmtMoneyShort(cents(pspc(2025)) / 100, "en"))}</span>`);
    const med = figureOf(html, "Median value", "Every buyer");
    const m26 = cellOf(everyRecord(2026)).med as number;
    expect(med).toContain(`title="${nbsp(new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(m26 / 100))}"`);
    expect(med).toContain(`<span class="tile-note">2025-26, the full year: ${nbsp(fmtMoneyShort((cellOf(everyRecord(2025)).med as number) / 100, "en"))}</span>`);
    const nc = figureOf(html, "Non-competitive share", "Public Services and Procurement Canada");
    expect(nc).toContain(`<span class="tile-label">${t("en", "analytics.nc_by_count")}, 2026-27 (to date)</span>`);
    expect(nc).toContain(`<span class="tile-note">2025-26, the full year: ${Math.round(shareOf(2025))}%</span>`);
    for (const x of [recs, value, med, nc]) {
      // No change line, no word of one, nothing that weighs.
      expect(x).not.toContain("from 2025-26");
      const body = x.slice(x.indexOf('<div class="dash-body'), x.indexOf('<div class="dash-foot'));
      expect(body.replace(/<[^>]*>/g, " ")).not.toMatch(/\b(up|down|change|percentage point)\b/i);
      expect(x.replace(/<[^>]*>/g, " ")).not.toMatch(FIGURE_FORBIDDEN);
    }
  });

  it("set two whole fiscal years against each other with the change and its sign, and the year to date never, in both languages", async () => {
    const r = await reader("tiles-figures");
    const board = await freshBoard(r);
    const whole = (q: string) => B(`subject=buyer&b=pwgsc-tpsgc&${q}&source=history&from=2022&to=2025`);
    await putTile(r, board, "number", whole("rows=year&measure=records&show=bars"), { x: 0, y: 0, w: 3, h: 5 });
    await putTile(r, board, "number", whole("rows=year&measure=value&show=bars"), { x: 3, y: 0, w: 3, h: 5 });
    await putTile(r, board, "number", B("subject=all&rows=year&measure=median&source=history&from=2016&to=2025&show=line"), { x: 6, y: 0, w: 3, h: 5 });
    await putTile(r, board, "number", whole("rows=none&measure=noncompetitive&show=number"), { x: 9, y: 0, w: 3, h: 5 });
    await putTile(r, board, "number", RECORDS_YEARS, { x: 0, y: 5, w: 3, h: 5 });
    const m25 = cellOf(everyRecord(2025)).med as number;
    const m24 = cellOf(everyRecord(2024)).med as number;
    const points = shareOf(2025) - shareOf(2024);
    const ratio = cents(pspc(2025)) / cents(pspc(2024)) - 1;
    for (const lang of ["en", "fr"] as const) {
      const html = await text(await page(r, `/account/dashboard${lang === "fr" ? "?lang=fr" : ""}`, on()));
      const fy = lang === "fr" ? "2024-2025" : "2024-25";
      const from = (change: string) => (lang === "fr" ? `${change} par rapport à ${fy}` : `${change} from ${fy}`);
      const pctIn = (x: number) => (lang === "fr" ? pctOf(x).replace("%", " %").replace("<", "< ") : pctOf(x));
      const title = (en: string, fr: string) => (lang === "fr" ? fr : en);
      const item = title("Public Services and Procurement Canada", "Services publics et Approvisionnement Canada");
      const recs = figureOf(html, title("Records", "Dossiers"), item, "2025");
      expect(recs, lang).toContain(`<span class="tile-note">${from(signed(pspc(2025).length - pspc(2024).length))}</span>`);
      expect(recs, lang).toContain(`<span class="tile-label">${title("Records", "Dossiers")}, ${lang === "fr" ? "2025-2026" : "2025-26"}</span>`);
      const value = figureOf(html, title("Value", "Valeur"), item, "2025");
      expect(value, lang).toContain(`<span class="tile-note">${from(pctIn(ratio))}</span>`);
      const med = figureOf(html, title("Median value", "Valeur médiane"), title("Every buyer", "Tous les acheteurs"), "2025");
      expect(med, lang).toContain(`<span class="tile-note">${m25 === m24 ? norm(t(lang, "build.change_same", { fy })) : from(pctIn(m25 / m24 - 1))}</span>`);
      const nc = figureOf(html, title("Non-competitive share", "Part non concurrentielle"), item, "2025");
      const whole = Math.round(Math.abs(points));
      const unit = lang === "fr" ? (whole > 1 ? "points de pourcentage" : "point de pourcentage") : whole > 1 ? "percentage points" : "percentage point";
      expect(nc, lang).toContain(`<span class="tile-note">${from(`${points > 0 ? "+" : "-"}${whole} ${unit}`)}</span>`);
      // The year to date beside them: the year before in full, never a change.
      const now = figureOf(html, title("Records", "Dossiers"), item, "2026");
      expect(now, lang).toContain(`<span class="tile-note">${lang === "fr" ? `2025-2026, l'exercice complet : ${pspc(2025).length}` : `2025-26, the full year: ${pspc(2025).length}`}</span>`);
      for (const x of [recs, value, med, nc, now]) expect(x.replace(/<[^>]*>/g, " ")).not.toMatch(FIGURE_FORBIDDEN);
    }
  });

  it("leave the others when one cannot be read: a cube missing, a combination no longer offered, a buyer gone", { timeout: 30_000 }, async () => {
    const r = await reader("tiles-faults");
    const board = await freshBoard(r);
    await putTile(r, board, "build", CHART, { x: 0, y: 0, w: 6, h: 14 });
    await putTile(r, board, "build", TABLE, { x: 6, y: 0, w: 6, h: 10 });
    await putTile(r, board, "build", NOT_OFFERED, { x: 0, y: 14, w: 6, h: 13 });
    await putTile(r, board, "build", GONE, { x: 6, y: 14, w: 6, h: 13 });
    await putTile(r, board, "number", B("subject=organization&o=org-a000000001&rows=year&measure=value&source=history&from=2022&to=2026&show=bars"), { x: 0, y: 27, w: 3, h: 5 });
    const html = await text(await page(r, "/account/dashboard", on()));
    expect(html).toContain(`This combination is not offered: ${t("en", "build.why_sum")}`);
    expect(html).toContain(`<p>${t("en", "dash.gone")}</p>`);
    expect(html).toContain('class="chart-stack"');
    // The organization's figure names it as its rows do.
    expect(html).toContain('<span class="dash-item">Builder Org 1 Ltd.</span>');
    try {
      await seedBuilder({ cubes: false });
      const missing = await text(await page(r, "/account/dashboard", on()));
      // The chart reads a cube: it cannot be read; the method table and the organization read records alone and stand.
      expect(missing.match(new RegExp(`<p class="muted">${t("en", "dash.unavailable")}</p>`, "g"))).toHaveLength(1);
      expect(missing).toContain("Records by procurement method");
      expect(missing).toContain("<table");
      expect(missing).toContain('<span class="dash-item">Builder Org 1 Ltd.</span>');
    } finally {
      await seedBuilder();
    }
  });

  it("reads one tile at a size for the page's script, and Add a Tile opens the builder from its third door", async () => {
    const r = await reader("tiles-one");
    const board = await freshBoard(r);
    const id = await putTile(r, board, "build", CHART, { x: 0, y: 0, w: 12, h: 16 });
    const res = await get(`/account/dashboard/tiles/${id}?w=4&h=13`, { cookie: r.cookie, env: on(), headers: { "x-csrf-token": r.csrf } });
    expect(res.status).toBe(200);
    const one = await text(res);
    expect(one).toContain(`data-w="4" data-h="13"`);
    expect(one).toContain('class="chart-stack"');
    for (const lang of ["en", "fr"] as const) {
      const html = await text(await page(r, `/account/dashboard${lang === "fr" ? "?lang=fr" : ""}`, on()));
      const adder = html.slice(html.indexOf('id="dash-add"'), html.indexOf("</details>", html.indexOf('id="dash-add"')));
      const parts = [...adder.matchAll(/<p class="dash-adder-part" id="([a-z-]+)">/g)].map((m) => m[1]);
      expect(parts).toEqual(["dash-add-lists", "dash-add-analytics", "dash-add-build", "dash-add-text"]);
      expect(adder).toContain(`<a href="${BUILD_PATH}" class="btn" aria-describedby="dash-add-build-line">${nbsp(t(lang, "dash.add_build_open")).replace(/\u2019/g, "'")}</a>`);
    }
  });
});

// -- the builder's page ----------------------------------------------------------------------------

describe("the builder's page", () => {
  it("gives an Ultra reader's view Add to dashboard, its figure's too where it has one, and the dashboards to choose from", async () => {
    const r = await reader("page-add");
    const one = await text(await page(r, CHART, on()));
    const tools = one.slice(one.indexOf('<div class="panel-tools">'), one.indexOf("</div>", one.indexOf('<div class="panel-tools">')));
    expect([...tools.matchAll(/name="kind" value="([a-z]+)"/g)].map((m) => m[1])).toEqual(["build", "number"]);
    expect(tools).toContain(`<input type="hidden" name="ref" value="${CHART}"/>`);
    expect(tools).toContain(`name="csrf" value="${r.csrf}"`);
    expect(tools).toContain('<button type="submit" class="btn-link">Add its latest figure to dashboard</button>');
    expect(one.match(/class="btn btn-primary"/g)).toHaveLength(1);
    // A view with no figure a year: the view alone.
    const ranked = await text(await page(r, RANKED, on()));
    expect([...ranked.matchAll(/name="kind" value="([a-z]+)"/g)].map((m) => m[1])).toEqual(["build"]);
    // With several dashboards, each control opens on their names.
    await freshBoard(r);
    await ACCOUNTS.prepare("INSERT INTO dashboards (id, user_id, name, pos, created_at) VALUES (?, ?, 'Second', 1, '2026-10-02T00:00:00.000Z')").bind("e".repeat(32), r.id).run();
    const several = await text(await page(r, CHART, on()));
    expect(several.match(/<details class="dash-add dash-add-menu">/g)).toHaveLength(2);
    expect(several).toContain(`<button type="submit" name="board" value="${"e".repeat(32)}" class="dash-menu-item">Second</button>`);
    // Posted, it lands on the dashboard chosen.
    expect((await addTile(r, "build", CHART, on(), { board: "e".repeat(32) })).headers.get("location")).toMatch(new RegExp(`^/account/dashboard/${"e".repeat(32)}\\?m=added`));
  });

  it("saves the view as a saved view of kind build, named as typed or by the site, held to the plan's figure, and lists it", async () => {
    const r = await reader("page-save");
    const html = await text(await page(r, CHART, on()));
    // The site's label: what the view is about and its title, then its source and period, cut to the saved views' bound.
    const label = viewLabel("en", "Public Services and Procurement Canada: Value by fiscal year", { source: "history", first: 2022, last: 2026 });
    expect(label.length).toBeLessThanOrEqual(LABEL_MAX);
    expect(label.startsWith("Public Services and Procurement Canada: Value")).toBe(true);
    expect(html).toContain('<div class="toolbar build-save"><form method="post" action="/account/views" class="save-view">');
    expect(html).toContain(`<input type="hidden" name="address" value="${CHART}"/>`);
    expect(html).toContain(`placeholder="${label}"`);
    expect(bucketFor("POST", "/account/views")).toBe("edit");
    const saved = await post("/account/views", { csrf: r.csrf, address: CHART, name: "" }, { cookie: r.cookie, env: on() });
    expect(saved.status).toBe(303);
    expect(saved.headers.get("location")).toBe(CHART);
    const named = await post("/account/views", { csrf: r.csrf, address: TABLE, name: "  Methods\u0007 of 82  " }, { cookie: r.cookie, env: on() });
    expect(named.status).toBe(303);
    const rows = await viewRows(r);
    expect(rows.map((v) => [v.kind, v.address, v.name, v.deliver]).sort()).toEqual([
      ["build", CHART, label, "off"], ["build", TABLE, "Methods of 82", "off"],
    ].sort());
    // Saved: the page says so.
    expect(await text(await page(r, CHART, on()))).toContain(`<p class="toolbar-note save-view">${t("en", "views.saved")} <a href="/account/views">`);
    // Refused: not in its one form, not offered, Pro, the switch off.
    for (const address of [`${CHART}&x=1`, NOT_OFFERED, GONE]) {
      expect((await post("/account/views", { csrf: r.csrf, address, name: "" }, { cookie: r.cookie, env: on() })).status, address).toBe(400);
    }
    const pro = await reader("page-save-pro", "pro");
    expect((await post("/account/views", { csrf: pro.csrf, address: CHART, name: "" }, { cookie: pro.cookie, env: on() })).status).toBe(400);
    expect(await viewRows(pro)).toEqual([]);
    // Listed with its link back to the builder, its kind, Add to dashboard as a tile of its own, and no email select.
    for (const lang of ["en", "fr"] as const) {
      const list = await text(await page(r, `/account/views${lang === "fr" ? "?lang=fr" : ""}`, on()));
      const row = list.slice(list.indexOf(`<a href="${CHART}">`), list.indexOf("</tr>", list.indexOf(`<a href="${CHART}">`)));
      expect(row).toContain(`${label}</a><br/><span class="muted small">${norm(t(lang, "rail.builder"))}</span>`);
      expect(row).toContain('<input type="hidden" name="kind" value="build"/>');
      expect(row).toContain(`<input type="hidden" name="ref" value="${CHART}"/>`);
      expect(row).not.toContain("<select");
      expect(row).not.toContain(norm(t(lang, "dash.choose_tables")));
      expect(row).toContain(`<p class="muted small">${norm(t(lang, "build.view_no_mail"))}</p>`);
    }
    // The dashboard's Add select offers it as a tile of its own.
    const dash = await text(await page(r, "/account/dashboard", on()));
    expect(dash).toContain(`<optgroup label="${t("en", "dash.saved_builds")}"><option value="build:${CHART}">${label}</option>`);
  });

  it("never sends a builder's view by email: the post leaves it off, and the delivery run takes up none of it", async () => {
    const r = await reader("page-mail");
    expect((await post("/account/views", { csrf: r.csrf, address: CHART, name: "" }, { cookie: r.cookie, env: on() })).status).toBe(303);
    const [v] = await viewRows(r);
    const changed = await post(`/account/views/${v.id}`, { csrf: r.csrf, deliver: "weekly" }, { cookie: r.cookie, env: on() });
    expect(changed.status).toBe(303);
    expect(changed.headers.get("location")).toBe("/account/views");
    expect((await viewRows(r))[0].deliver).toBe("off");
    expect(SET_DELIVERY_SQL).toContain("(?1 = 'off' OR kind <> 'build')");
    // Put on by hand (nothing in the site can): still never sent, never claimed, no run of it written.
    await ACCOUNTS.prepare("UPDATE saved_views SET deliver = 'weekly' WHERE id = ?").bind(v.id).run();
    const due = (await ACCOUNTS.prepare(VIEWS_DUE_SQL).bind("2026-10-26", "2026-10-01", 500).all<{ id: string }>()).results ?? [];
    expect(due.map((x) => x.id)).toContain(v.id);
    const mail = fakeMail();
    const run = await runViewMail(sale({ ...ON, MAIL: mail.binding, MAIL_FROM: "alerts@awardwatch.ca", MAIL_SENDER: undefined }) as never,
      // The account's plan as the run reads it (Ultra, which sends saved views), whatever the grant's own time.
      { site: "https://awardwatch.ca", dataDate: "2026-10-31", now: new Date("2026-10-31T16:00:00.000Z"), plans: new Map([[r.id, "ultra"]]), room: 300, capText: "the cap" });
    expect(mail.to(r.email)).toEqual([]);
    expect(run.report?.sent ?? 0).toBe(0);
    expect((await viewRows(r))[0].last_delivered_at).toBeNull();
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM view_deliveries WHERE view_id = ?").bind(v.id).first<{ n: number }>())?.n).toBe(0);
  });
});

// -- the find page ---------------------------------------------------------------------------------

describe("the find page", () => {
  it("gives each match its builder view beside its checklist while the builder is on, and is as it was without it", async () => {
    const r = await reader("find-open");
    const path = "/account/dashboard/find?q=engineering&kind=segment";
    const html = await text(await page(r, path, on()));
    // Each segment listed, its checklist and, beside it, its value by fiscal year in the builder, at the source the checklist opens on.
    const codes = [...html.matchAll(/<a href="\/account\/dashboard\/tables\/segments\/(\d\d)\?/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(html, code).toContain(`<a href="${B(`subject=segment&s=${code}&rows=year&measure=value&source=awards&from=2017&to=2026&show=bars`)}" class="dash-pick">Open in the builder</a>`);
    }
    const fr = await text(await page(r, `${path}&lang=fr`, on()));
    expect(fr).toContain(">Ouvrir dans le générateur</a>");
    // Every link it opens is one the builder offers.
    for (const m of html.matchAll(/<a href="(\/analytics\/build\?[^"]+)" class="dash-pick">/g)) {
      expect(buildRef("build", decode(m[1]), 2026, null), m[1]).toBe(decode(m[1]));
    }
    // The builder's organization field leads here, for an Ultra reader.
    const builder = await text(await page(r, B("subject=organization&rows=year&measure=value&source=history"), on()));
    expect(builder).toContain('<a href="/account/dashboard/find?kind=organization">Find an organization by name</a>');
    const free = await reader("find-open-free", "free");
    expect(await text(await page(free, B("subject=organization&rows=year&measure=value&source=history"), on()))).not.toContain("/account/dashboard/find");
  });
});

// -- the words ---------------------------------------------------------------------------------------

describe("the words", () => {
  const KEYS = [
    "build.add_figure", "build.find_org", "build.change", "build.change_same", "build.change_none", "build.points_one", "build.points", "build.view_no_mail", "build.label_name", "build.full_year", "build.full_year_none",
    "dash.add_build", "dash.add_build_open", "dash.add_build_line", "dash.saved_builds", "dash.kind_build", "dash.kind_number", "dash.what_build", "dash.what_number",
  ] as const;

  it("hold every new string in both languages, the same placeholders, no em or en dash, no evaluative word", () => {
    const FORBIDDEN = /\b(better|worse|strong|weak|good|bad|best|worst|dominant|risk|concerning|healthy|meilleur\w*|pire|fort|faible|risque)\b/i;
    for (const key of KEYS) {
      const { en, fr } = rawEntry(key as Key);
      expect(key in BUILDER_STRINGS || key in DASHBOARD_STRINGS, key).toBe(true);
      expect(fr, key).not.toBe(en);
      expect([...fr.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key).toEqual([...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
      for (const s of [en, fr]) {
        expect(s, key).not.toContain(EM_DASH);
        expect(s, key).not.toContain(EN_DASH);
        expect(s, key).not.toMatch(FORBIDDEN);
      }
    }
  });

  it("draws the tiles in French with no English left and no dash", async () => {
    const r = await reader("words-fr");
    const board = await freshBoard(r);
    await putTile(r, board, "build", CHART, { x: 0, y: 0, w: 6, h: 14 });
    await putTile(r, board, "number", RECORDS_YEARS, { x: 6, y: 0, w: 3, h: 5 });
    const html = await text(await page(r, "/account/dashboard?lang=fr", on()));
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("Valeur par exercice");
    expect(html).toContain(`Dossiers, 2026-2027 (à ce jour)`);
    expect(html).toContain("2025-2026, l'exercice complet : ");
    for (const english of ["Value by fiscal year", "from 2025", "Build a View", "Open the analytics builder", "(to date)"]) expect(html).not.toContain(english);
    expect(html).not.toContain(EM_DASH);
    expect(html).not.toContain(EN_DASH);
  });
});

// The dashboard's posts are the edit bucket's; a test env without the builder's switch reads it as off.
describe("the edges", () => {
  it("count the builder's posts in the edit bucket and take nothing without the accounts switch", async () => {
    expect(bucketFor("POST", "/account/views")).toBe("edit");
    expect(bucketFor("POST", "/account/dashboard/panels")).toBe("edit");
    const r = await reader("edges");
    const res = await post("/account/dashboard/panels", { csrf: r.csrf, kind: "build", ref: CHART }, { cookie: r.cookie, env: { ...testEnv(), ...ON } });
    expect(res.status).toBe(404);
    expect(specOf("build", CHART, { searches: [], briefings: [] })).toBeNull();
    expect(specOf("build", CHART, { searches: [], briefings: [] }, { current: 2026, buyerIds: null })?.ref).toBe(CHART);
    expect(specOf("view", "f".repeat(32), { searches: [], briefings: [], views: [{ id: "f".repeat(32), kind: "build" }] })).toBeNull();
  });
});
