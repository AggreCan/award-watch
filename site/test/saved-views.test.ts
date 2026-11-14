// Saved analytics views (src/account/saved_views.ts, view_pages.tsx,
// view_mail.ts, src/view_address.ts; docs/accounts.md, Saved views): the
// address read and written as each view reads and writes it, and anything
// else refused; the Save control on each kind of view keeping its period and
// choices; Free's way to the plans; Pro's 10 and Ultra's 50 held inside the
// insert, two posts at once included; names cut and cleaned; the page, its
// count, its Email column and gate while Ultra is on sale and none of either
// while it is not; a move down keeping the views and marking them; the
// email's weekly and monthly due dates, the unchanged figures writing "same",
// the stop link and List-Unsubscribe, nothing at all while Ultra is off sale;
// the dashboard's view panel taking a saved view; every table missing; the
// plan cards, the privacy page, deletion and both languages. The records
// database is built here from pipeline/records_schema.sql with the rows below.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ADD_VIEW_SQL, LABEL_MAX, NAME_MAX, addView, cleanName, setViewDelivery, viewLabel, withinViewCap } from "../src/account/saved_views";
import { RULES, SAVED_VIEW_MAX, savedViewCap } from "../src/account/entitlements";
import { VIEWS_DUE_SQL, monthAnchor, runViewMail, viewCsv, viewDue } from "../src/account/view_mail";
import { VIEWS_STRINGS } from "../src/account/views_strings";
import { runDeliveries } from "../src/account/deliveries";
import { allKeys, rawEntry, t, type Key } from "../src/i18n";
import { bucketFor } from "../src/limits";
import { PLAN_LINE_MAX, PLAN_ROWS, planLine } from "../src/pro";
import { orgNumber } from "../src/records_db";
import { readViewAddress, viewQuery } from "../src/view_address";
import accountsSchema from "../accounts_schema.sql?raw";
import {
  ACCOUNTS, PRO_SALE, csrf, decode, get, nbsp, newEmail, offEnv, onEnv, post, signIn, ultraEnv, useAccountsDb, userId,
} from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { fakeMail } from "./mail-fixtures";
import { applySql, splitSql } from "./setup";
import { expectTablesFit } from "./table-fit";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const DAY = "2026-10-31"; // the fixtures' data date (a Saturday), in fiscal year 2026-27
const SITE = "https://awardwatch.ca";
const FROM = "alerts@awardwatch.ca";

const A1 = "org-a000000001"; // Exemplar Translation Services Inc., the fixtures' profile
const A2 = "org-a000000002";
const NAME1 = "Exemplar Translation Services Inc.";
const BUYER = "/buyers/pwgsc-tpsgc/analytics";
const ORG = `/organizations/${A1}/analytics`;
const SEGMENT = "/segments/81/analytics";

const norm = (s: string) => nbsp(s).replace(/’/g, "'");
const text = async (res: Response) => norm(decode(await res.text()));
const mainOf = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));

// -- the records database ------------------------------------------------------------------

const PSPC = 101;
const DFO = 103;
const RECS = [
  { src: 1, fy: 2025, fq: 1, bid: PSPC, oid: orgNumber(A1)!, sid: 81, cents: 50_000_000, ref: "cb-100-00000001", title: "Translation, 2025" },
  { src: 1, fy: 2026, fq: 2, bid: PSPC, oid: orgNumber(A1)!, sid: 81, cents: 30_000_000, ref: "cb-100-00000002", title: "Translation, the largest" },
  { src: 1, fy: 2026, fq: 2, bid: DFO, oid: orgNumber(A1)!, sid: 81, cents: 10_000_000, ref: "cb-100-00000003", title: "Translation, the second" },
];

async function seedRecords(asOf = DAY, extra: typeof RECS = []): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["records", "rec_orgs", "rec_buyers", "rec_segment_years", "rec_buyer_quarters", "rec_meta"].map((x) => RECORDS.prepare(`DELETE FROM ${x}`)));
  await RECORDS.batch([
    ...[...RECS, ...extra].map((r) => RECORDS.prepare(
      "INSERT INTO records (src, fy, fq, bid, oid, sid, extra, cents, vnote, comp, ref, title) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 1, ?, ?)",
    ).bind(r.src, r.fy, r.fq, r.bid, r.oid, r.sid, r.cents, r.ref, r.title)),
    RECORDS.prepare("INSERT INTO rec_segment_years (sid, src, fy, n, cents, n_no_value, n_buyers, n_orgs, n_pos) SELECT sid, src, fy, COUNT(*), " +
      "SUM(cents), 0, COUNT(DISTINCT bid), COUNT(DISTINCT oid), COUNT(*) FROM records WHERE sid IS NOT NULL GROUP BY sid, src, fy"),
    RECORDS.prepare("INSERT INTO rec_buyer_quarters (bid, src, fy, fq, n, cents, n_no_value) SELECT bid, src, fy, fq, COUNT(*), SUM(cents), 0 FROM records GROUP BY bid, src, fy, fq"),
    RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, ?)").bind(orgNumber(A1), NAME1),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'pwgsc-tpsgc', 'Public Services and Procurement Canada', " +
      "'Services publics et Approvisionnement Canada')").bind(PSPC),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dfo-mpo', 'Fisheries and Oceans Canada', 'Pêches et Océans Canada')").bind(DFO),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(asOf),
  ]);
}

beforeAll(async () => {
  await seedRecords();
});

// -- accounts ------------------------------------------------------------------------------------

type Reader = { email: string; id: string; cookie: string; csrf: string };

// Ultra on sale (its variables and the payments), or off sale (Pro's alone); the switch on in both.
const sale = (extra: Record<string, unknown> = {}) => ultraEnv(extra);
const off = (extra: Record<string, unknown> = {}) => onEnv({ ...PRO_SALE, ...extra });

// A plan by hand from the start of 2026, so it holds at the fixtures' data date as well as today, the
// newest grant deciding (an Ultra grant is a pro row with its tier row, as the console writes it).
async function grant(email: string, plan: "pro" | "ultra"): Promise<void> {
  const user = await userId(email);
  const id = crypto.randomUUID().replace(/-/g, "");
  const row = ACCOUNTS.prepare(
    "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'manual', '2026-01-01T00:00:00.000Z', NULL, 'test', ?)",
  ).bind(id, user, new Date().toISOString());
  await ACCOUNTS.batch(plan === "ultra" ? [row, ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(id)] : [row]);
}

async function reader(tag: string, plan: "free" | "pro" | "ultra" = "pro"): Promise<Reader> {
  const email = newEmail(tag);
  const cookie = await signIn(email, { env: off() });
  if (plan !== "free") await grant(email, plan);
  return { email, id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env: off() }) };
}

const open = (r: Reader | null, path: string, e: object = off()) => get(path, { cookie: r?.cookie, env: e });
const send = (r: Reader, path: string, fields: Record<string, string> = {}, e: object = off()) =>
  post(path, { csrf: r.csrf, ...fields }, { cookie: r.cookie, env: e });
const save = (r: Reader, address: string, name = "", e: object = off()) => send(r, "/account/views", { address, name }, e);

type Row = { id: string; kind: string; address: string; name: string; lang: string; deliver: string; last_hash: string | null; secret: string | null };
const rowsOf = (id: string) => ACCOUNTS.prepare("SELECT id, kind, address, name, lang, deliver, last_hash, secret FROM saved_views WHERE user_id = ? ORDER BY created_at, id")
  .bind(id).all<Row>().then((r) => r.results ?? []);
const runsOf = (viewId: string) => ACCOUNTS.prepare("SELECT status, day FROM view_deliveries WHERE view_id = ? ORDER BY id").bind(viewId)
  .all<{ status: string; day: string }>().then((r) => r.results ?? []);

// The two tables taken off the database for the length of fn, then made again from accounts_schema.sql, their rows
// kept aside and put back: the database before the operator applies the schema.
const VIEWS_SCHEMA = splitSql(accountsSchema).filter((s) => /saved_views|view_deliveries/.test(s));
async function withoutViews<T>(fn: () => Promise<T>): Promise<T> {
  const views = (await ACCOUNTS.prepare("SELECT * FROM saved_views").all<Record<string, unknown>>()).results ?? [];
  const runs = (await ACCOUNTS.prepare("SELECT * FROM view_deliveries").all<Record<string, unknown>>()).results ?? [];
  await ACCOUNTS.batch([ACCOUNTS.prepare("DROP TABLE IF EXISTS view_deliveries"), ACCOUNTS.prepare("DROP TABLE IF EXISTS saved_views")]);
  try {
    return await fn();
  } finally {
    await ACCOUNTS.batch(VIEWS_SCHEMA.map((s) => ACCOUNTS.prepare(s)));
    const put = (table: string, rows: Record<string, unknown>[]) => rows.map((r) => {
      const cols = Object.keys(r);
      return ACCOUNTS.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => r[c]));
    });
    const all = [...put("saved_views", views), ...put("view_deliveries", runs)];
    if (all.length) await ACCOUNTS.batch(all);
  }
}

// The hidden address and the form of a view's Save this view row, as the page writes them.
const saveForm = (html: string) => /<form method="post" action="\/account\/views" class="save-view">[\s\S]*?<\/form>/.exec(html)?.[0] ?? null;
const postedAddress = (html: string) => /<input type="hidden" name="address" value="([^"]*)"\/>/.exec(saveForm(html) ?? "")?.[1] ?? null;

// =====================================================================================

describe("a view's address", () => {
  const at = { current: 2026, most: 10 };

  it("is kept only as the view writes it, its period and choices with it", () => {
    for (const address of [
      `${BUYER}?source=awards&years=5`, `${BUYER}?source=grants&from=2019&to=2024`, `${SEGMENT}?source=history&years=3`,
      `${ORG}?source=awards&years=10&segment=81&vs=${A2}`, `${ORG}?source=contracts&years=10`, `${SEGMENT}?source=awards&from=2017&to=2026`,
    ]) {
      const read = readViewAddress(address, at);
      expect(read?.address, address).toBe(address);
    }
    const org = readViewAddress(`${ORG}?source=awards&from=2020&to=2023&segment=81&vs=${A2}`, at)!;
    expect(org).toMatchObject({ kind: "organization", id: A1, frame: { source: "awards", first: 2020, last: 2023, custom: true } });
    // The view's own writing is the one form: the source, the period, then the rest.
    expect(viewQuery(ORG, org.frame, { segment: "81", vs: [A2] })).toBe(`${ORG}?source=awards&from=2020&to=2023&segment=81&vs=${A2}`);
  });

  it("refuses an address a view would not write", () => {
    for (const bad of [
      `${BUYER}?years=5&source=awards`, `${BUYER}?source=awards&years=5&lang=fr`, `${BUYER}?source=awards&years=5&evil=1`,
      `${BUYER}?source=Awards&years=5`, `${BUYER}?source=awards&source=grants&years=5`, `${BUYER}?source=awards&years=7`,
      `${BUYER}?source=awards&years=05`, `${BUYER}?source=lobbying&years=5`, `${BUYER}?source=awards`, `${BUYER}`,
      `${BUYER}?source=awards&from=2024&to=2019`, `${BUYER}?source=awards&years=5#chart`, `${SEGMENT}?source=contracts&years=5`,
      "/segments/99/analytics?source=awards&years=5", "/organizations/org-zz/analytics?source=awards&years=5", `/buyers/PWGSC-TPSGC/analytics?source=awards&years=5`,
      `${ORG}?source=awards&years=10&vs=${A2}`, `${ORG}?source=awards&years=10&segment=99`, `${ORG}?source=awards&years=10&segment=81&vs=${A1}`,
      `${ORG}?source=awards&years=10&segment=81&vs=${A2.toUpperCase()}`, "/buyers/pwgsc-tpsgc?source=awards&years=5",
      `https://evil.example${BUYER}?source=awards&years=5`, `//evil.example${BUYER}?source=awards&years=5`, `${BUYER}?source=awards&years=5&x=${"a".repeat(2000)}`,
    ]) expect(readViewAddress(bad, at), bad).toBeNull();
    // The period a plan shows: twenty years for Ultra, refused for Pro, whose view writes ten.
    expect(readViewAddress(`${BUYER}?source=awards&years=20`, at)).toBeNull();
    expect(readViewAddress(`${BUYER}?source=awards&years=20`, { current: 2026, most: 20 })?.frame.first).toBe(2007);
    expect(readViewAddress(`${BUYER}?source=awards&from=2010&to=2025`, at)).toBeNull();
  });
});

describe("Save this view", () => {
  it("is on each kind of view for a signed-in reader, posting the view's own address with its period and choices", async () => {
    const r = await reader("views-control");
    const cases: [string, string][] = [
      [`${BUYER}?source=awards&years=5`, `${BUYER}?source=awards&years=5`],
      // The organization's view writes the share chart's segment and the organizations it compares after the period.
      [`${ORG}?years=10&source=awards&segment=81&vs=${A2}`, `${ORG}?source=awards&years=10&segment=81&vs=${A2}`],
      [`${SEGMENT}?source=history&from=2019&to=2022`, `${SEGMENT}?source=history&from=2019&to=2022`],
    ];
    for (const [page, written] of cases) {
      const html = await text(await open(r, page));
      expect(postedAddress(html), page).toBe(written);
      expect(saveForm(html), page).toContain(`<button type="submit" class="btn">${t("en", "views.save")}</button>`);
      expect(saveForm(html), page).toContain(`maxlength="${NAME_MAX}"`);
      // The address it posts is one the route keeps.
      expect(readViewAddress(written, { current: 2026, most: 10 })?.address).toBe(written);
      // The control adds no filled button: a view keeps at most its own one.
      expect((mainOf(html).match(/btn-primary/g) ?? []).length).toBeLessThanOrEqual(1);
      expect(saveForm(html)).not.toContain("btn-primary");
    }
    // The site's label as the name field's placeholder.
    const buyer = await text(await open(r, `${BUYER}?source=contracts&years=10`));
    // Past 60 characters the buyer's name is cut on a word, so the source and the period stay whole.
    expect(saveForm(buyer)).toContain('placeholder="Public Services and Procurement Canada, published contracts, 2017-18 to 2026-27"');
    // Signed out, or with the switch off: nothing.
    expect(await text(await open(null, `${BUYER}?source=awards&years=5`))).not.toContain("save-view");
    expect(await text(await get(`${BUYER}?source=awards&years=5`, { cookie: r.cookie, env: offEnv() }))).not.toContain("save-view");
  });

  it("saves the view as written, with the site's label for an empty name, back on the view reading saved", async () => {
    const r = await reader("views-save");
    const address = `${ORG}?source=awards&years=10&segment=81&vs=${A2}`;
    const res = await save(r, address);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(address);
    const rows = await rowsOf(r.id);
    expect(rows).toEqual([expect.objectContaining({ kind: "organization", address, name: "Exemplar Translation Services Inc., award notices, 2017-18 to 2026-27", lang: "en", deliver: "off" })]);
    const html = await text(await open(r, address));
    expect(html).toContain(`<p class="toolbar-note save-view">${t("en", "views.saved")} <a href="/account/views">${t("en", "views.manage")}</a></p>`);
    expect(saveForm(html)).toBeNull();
    // The same address again adds nothing; the audit names the kind, never the address.
    await save(r, address, "again");
    expect(await rowsOf(r.id)).toHaveLength(1);
    const audit = await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = 'view_saved'").bind(r.id).all<{ detail: string }>();
    expect(audit.results).toEqual([{ detail: "organization" }]);
    // A French page's post returns to the French view, the label in French; one that would not fit whole ends on its last whole part.
    const fr = await send(r, "/account/views", { address: `${SEGMENT}?source=history&years=3`, name: "", lang: "fr" });
    expect(fr.headers.get("location")).toBe(`${SEGMENT}?source=history&years=3&lang=fr`);
    expect(norm((await rowsOf(r.id))[1].name)).toBe("81 Ingénierie, historique des contrats de SPAC, 2024-2025 à 2026-2027");
    expect((await rowsOf(r.id))[1].lang).toBe("fr");
    // A label that fits is whole.
    expect(viewLabel("en", "81 Engineering", { source: "awards", first: 2022, last: 2026 })).toBe("81 Engineering, award notices, 2022-23 to 2026-27");
  });

  it("refuses an address the view would not write, and a buyer the data does not hold, writing nothing", async () => {
    const r = await reader("views-refuse");
    for (const bad of [`${BUYER}?years=5&source=awards`, `${BUYER}?source=awards&years=5&lang=fr`, `${BUYER}?source=awards&years=20`,
      "/buyers/no-such-buyer/analytics?source=awards&years=5", "/tenders?segment=81", ""]) {
      expect((await save(r, bad)).status, bad).toBe(400);
    }
    expect(await rowsOf(r.id)).toEqual([]);
  });

  it("cuts a typed name to 60 characters and drops its control characters", async () => {
    expect(cleanName("  Fleet\u0000 view\u0007\u009f  ")).toBe("Fleet view");
    expect(cleanName("x".repeat(80))).toBe("x".repeat(NAME_MAX));
    // A character outside the basic plane counts once and is never cut in half.
    expect(cleanName(`${"y".repeat(59)}😀😀`)).toBe(`${"y".repeat(59)}😀`);
    const r = await reader("views-name");
    await save(r, `${BUYER}?source=awards&years=5`, `\u0001Mine${"z".repeat(70)}\n`);
    expect((await rowsOf(r.id))[0].name).toBe(`Mine${"z".repeat(56)}`);
    // The site's label has its own, longer figure: the subject's name gives way on a whole word, the source and the period stay.
    expect(viewLabel("en", "x".repeat(70), { source: "awards", first: 2020, last: 2026 })).toHaveLength(LABEL_MAX);
    expect(viewLabel("en", "Public Services and Procurement Canada", { source: "history", first: 2017, last: 2026 }))
      .toBe("Public Services and Procurement Canada, PSPC contract history, 2017-18 to 2026-27");
    expect(viewLabel("en", `${"Department of Something Long ".repeat(3)}and Rural Affairs Canada`, { source: "contracts", first: 2017, last: 2026 }))
      .toBe("Department of Something Long Department of Something Long\u2026, published contracts, 2017-18 to 2026-27");
  });

  it("leads a Free reader to the page that says what keeps views, which saves nothing", async () => {
    const r = await reader("views-free", "free");
    const html = await text(await open(r, `${BUYER}?source=awards`));
    expect(html).toContain(`<div class="toolbar-row save-view"><a href="/account/views" class="btn">${t("en", "views.save")}</a></div>`);
    const res = await save(r, `${BUYER}?source=awards&years=3`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/views");
    expect(await rowsOf(r.id)).toEqual([]);
    // Off sale the gate names Pro alone; on sale Pro and Ultra, each with its own figure.
    const offPage = await text(await open(r, "/account/views"));
    expect(mainOf(offPage)).toContain(`<p class="muted">${t("en", "views.gate_pro", { pro: "10" })} <a href="/account/billing">Plans and prices</a></p>`);
    expect(mainOf(offPage)).not.toContain("Ultra");
    expect(mainOf(offPage).match(/class="plan-card[ "]/g)).toHaveLength(2);
    const onPage = await text(await open(r, "/account/views", sale()));
    expect(mainOf(onPage)).toContain(t("en", "views.gate", { pro: "10", ultra: "50" }));
    expect(mainOf(onPage).match(/class="plan-card[ "]/g)).toHaveLength(3);
    for (const p of [offPage, onPage]) expect(mainOf(p).match(/btn-primary/g)).toHaveLength(1);
  });
});

describe("the plan's figure", () => {
  it("is Pro's 10 and Ultra's 50, Free's none, held inside the insert so posts at once cannot pass it", async () => {
    expect([savedViewCap("free"), savedViewCap("pro"), savedViewCap("ultra")]).toEqual([0, 10, 50]);
    expect([RULES.free.saved_views, RULES.pro.saved_views, RULES.ultra.saved_views]).toEqual([0, 10, SAVED_VIEW_MAX]);
    expect([RULES.free.view_mail, RULES.pro.view_mail, RULES.ultra.view_mail]).toEqual([false, false, true]);
    expect(ADD_VIEW_SQL).toContain("WHERE (SELECT COUNT(*) FROM saved_views WHERE user_id = ?2) < ?8");
    for (const [plan, cap] of [["pro", 10], ["ultra", 50]] as const) {
      const r = await reader(`views-cap-${plan}`, plan);
      const who = { userId: r.id, plan };
      for (let i = 0; i < cap - 1; i++) {
        expect(await addView(onEnv() as never, who, { kind: "buyer", address: `${BUYER}?source=awards&from=${1950 + i}&to=2026`, name: `v${i}` }, "en")).toBe("added");
      }
      // Three at once with one place left: one is added.
      const results = await Promise.all([0, 1, 2].map((i) =>
        addView(onEnv() as never, who, { kind: "buyer", address: `${BUYER}?source=grants&years=${[3, 5, 10][i]}`, name: `last ${i}` }, "en")));
      expect(results.filter((x) => x === "added"), plan).toHaveLength(1);
      expect(results.filter((x) => x === "full"), plan).toHaveLength(2);
      expect(await rowsOf(r.id)).toHaveLength(cap);
      // Through the page: the view reads full, and the post adds nothing.
      const html = await text(await open(r, `${SEGMENT}?source=awards&years=5`));
      expect(html).toContain(t("en", "views.full", { cap: String(cap) }));
      await save(r, `${SEGMENT}?source=awards&years=5`);
      expect(await rowsOf(r.id)).toHaveLength(cap);
    }
  });

  it("after a move down keeps every view, listed and marked past the figure, and the first by creation within it", async () => {
    const r = await reader("views-down", "ultra");
    for (let i = 0; i < 12; i++) {
      await addView(onEnv() as never, { userId: r.id, plan: "ultra" }, { kind: "segment", address: `${SEGMENT}?source=awards&from=${2000 + i}&to=2026`, name: `View ${i}` }, "en",
        new Date(Date.UTC(2026, 9, 1, 0, 0, i)));
    }
    await grant(r.email, "pro");
    const html = await text(await open(r, "/account/views"));
    const main = mainOf(html);
    expect(main).toContain('<span class="panel-count">12 of 10 views</span>');
    expect(main).toContain(t("en", "views.over_cap", { n: "12", cap: "10" }));
    expect(main.split(t("en", "views.past")).length - 1).toBe(2);
    // The marks are on the two saved last.
    expect(main.indexOf("View 10")).toBeLessThan(main.indexOf(t("en", "views.past")));
    expect(withinViewCap((await rowsOf(r.id)).map((x) => x.name), "pro")).toEqual(Array.from({ length: 10 }, (_, i) => `View ${i}`));
    expect(await rowsOf(r.id)).toHaveLength(12);
  });
});

describe("the saved views page", () => {
  it("lists the views with their count, and the Email column only while Ultra is on sale: Ultra's select, Pro's gate", async () => {
    const pro = await reader("views-page-pro");
    const ultra = await reader("views-page-ultra", "ultra");
    for (const r of [pro, ultra]) await save(r, `${BUYER}?source=awards&years=5`, "Fleet");
    // Off sale: no Email column, no word of Ultra, for either.
    for (const r of [pro, ultra]) {
      const main = mainOf(await text(await open(r, "/account/views")));
      expect(main).toContain(`<a href="${BUYER}?source=awards&years=5">Fleet</a>`);
      expect(main).not.toContain(t("en", "views.col_email"));
      expect(main).not.toContain("Ultra");
      expect(main).not.toContain('name="deliver"');
    }
    expect(mainOf(await text(await open(pro, "/account/views")))).toContain('<span class="panel-count">1 of 10 views</span>');
    // On sale: Ultra chooses, Pro reads the gate.
    const u = mainOf(await text(await open(ultra, "/account/views", sale())));
    expect(u).toContain('<span class="panel-count">1 of 50 views</span>');
    expect(u).toContain('<select name="deliver"');
    expect(u).toContain(`<option value="monthly">${t("en", "views.deliver_monthly")}</option>`);
    const p = mainOf(await text(await open(pro, "/account/views", sale())));
    expect(p).toContain(`<p class="muted small">${t("en", "views.deliver_gate")} <a href="/account/billing">Plans and prices</a></p>`);
    expect(p).not.toContain('<select name="deliver"');
    for (const [r, e] of [[pro, off()], [ultra, off()], [ultra, sale()], [pro, sale()]] as const) {
      for (const lang of ["en", "fr"] as const) {
        const html = await text(await open(r, `/account/views?lang=${lang}`, e));
        expectTablesFit(html, `${r.email} ${lang}`);
        expect(html).not.toContain(EM_DASH);
        expect(html).not.toContain(EN_DASH);
        expect(mainOf(html).match(/btn-primary/g) ?? []).toEqual([]);
      }
    }
    expect((await open(ultra, "/account/views")).headers.get("cache-control")).toBe("no-store");
    // Signed out: the sign-in page, and back here.
    const out = await open(null, "/account/views");
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/account/sign-in?next=%2Faccount%2Fviews");
  });

  it("turns a view's email on for Ultra while Ultra is on sale, never for Pro or off sale, and off for anyone", async () => {
    const pro = await reader("views-deliver-pro");
    const ultra = await reader("views-deliver-ultra", "ultra");
    for (const r of [pro, ultra]) await save(r, `${BUYER}?source=awards&years=3`);
    const idOf = async (r: Reader) => (await rowsOf(r.id))[0].id;
    expect((await send(pro, `/account/views/${await idOf(pro)}`, { deliver: "weekly" }, sale())).headers.get("location")).toBe("/account/views");
    expect((await send(ultra, `/account/views/${await idOf(ultra)}`, { deliver: "weekly" }, off())).headers.get("location")).toBe("/account/views");
    expect((await rowsOf(pro.id))[0].deliver).toBe("off");
    expect((await rowsOf(ultra.id))[0].deliver).toBe("off");
    const on = await send(ultra, `/account/views/${await idOf(ultra)}`, { deliver: "monthly" }, sale());
    expect(on.headers.get("location")).toBe("/account/views?m=changed");
    expect((await rowsOf(ultra.id))[0].deliver).toBe("monthly");
    expect((await send(ultra, `/account/views/${await idOf(ultra)}`, { deliver: "daily" }, sale())).status).toBe(400);
    await send(ultra, `/account/views/${await idOf(ultra)}`, { deliver: "off" }, off());
    expect((await rowsOf(ultra.id))[0].deliver).toBe("off");
    // Behind the CSRF value and the Origin, in the form bucket.
    expect((await post(`/account/views/${await idOf(ultra)}`, { csrf: "0".repeat(32), deliver: "off" }, { cookie: ultra.cookie, env: sale() })).status).toBe(403);
    expect((await post("/account/views", { csrf: ultra.csrf, address: `${BUYER}?source=awards&years=5` }, { cookie: ultra.cookie, env: sale(), origin: "https://elsewhere.example" })).status).toBe(403);
    for (const path of ["/account/views", "/account/views/abc", "/account/views/abc/delete"]) expect(bucketFor("POST", path), path).toBe("form");
    expect(bucketFor("GET", "/account/views")).toBe("page");
  });

  it("removes a view with its runs and its dashboard panel", async () => {
    const r = await reader("views-remove", "ultra");
    await save(r, `${ORG}?source=awards&years=3`, "Mine");
    const [v] = await rowsOf(r.id);
    await ACCOUNTS.prepare("INSERT INTO view_deliveries (view_id, sent_at, day, status) VALUES (?, ?, ?, 'same')").bind(v.id, `${DAY}T16:00:00.000Z`, DAY).run();
    // The dashboard's view panel takes the saved view: its name heads the panel.
    expect((await send(r, "/account/dashboard/panels", { kind: "view", ref: v.id }, sale())).headers.get("location")).toBe("/account/dashboard?m=added");
    const panels = () => ACCOUNTS.prepare("SELECT kind, ref FROM dashboard_panels WHERE user_id = ?").bind(r.id).all<{ kind: string; ref: string }>().then((x) => x.results ?? []);
    expect(await panels()).toContainEqual({ kind: "view", ref: v.id });
    const dash = mainOf(await text(await open(r, "/account/dashboard", sale())));
    expect(dash).toContain(`${t("en", "dash.kind_view")}<span class="dash-item">Mine</span>`);
    expect(dash).toContain(`<a href="${ORG}?source=awards&years=3">${t("en", "dash.see_all")}</a>`);
    // Add to dashboard on each row of the page, for Ultra.
    expect(mainOf(await text(await open(r, "/account/views")))).toContain(`<input type="hidden" name="ref" value="${v.id}"/>`);
    const res = await send(r, `/account/views/${v.id}/delete`);
    expect(res.headers.get("location")).toBe("/account/views?m=removed");
    expect(await rowsOf(r.id)).toEqual([]);
    expect(await runsOf(v.id)).toEqual([]);
    expect((await panels()).filter((p) => p.kind === "view")).toEqual([]);
    // Another account's view is not removed by a post naming it.
    const other = await reader("views-remove-other");
    await save(other, `${BUYER}?source=awards&years=3`);
    await send(r, `/account/views/${(await rowsOf(other.id))[0].id}/delete`);
    expect(await rowsOf(other.id)).toHaveLength(1);
  });

  it("follows an organization the nightly merged into another, and merges a view the account then holds twice", async () => {
    const r = await reader("views-alias", "ultra");
    // The fixtures' alias file retires org-a00000000f into the profile org-a000000001.
    const put = (address: string, name: string, at: string) => ACCOUNTS.prepare(
      "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'organization', ?, ?, 'en', 'off', ?)",
    ).bind(crypto.randomUUID().replace(/-/g, ""), r.id, address, name, at).run();
    await put("/organizations/org-a00000000f/analytics?source=awards&years=3", "Retired, 3 years", "2026-10-01T00:00:00.000Z");
    await put("/organizations/org-a00000000f/analytics?source=awards&years=5", "Retired, 5 years", "2026-10-02T00:00:00.000Z");
    await put(`${ORG}?source=awards&years=5`, "Surviving, 5 years", "2026-10-03T00:00:00.000Z");
    const main = mainOf(await text(await open(r, "/account/views")));
    expect(main).toContain(`<a href="${ORG}?source=awards&years=3">Retired, 3 years</a>`);
    expect(main).not.toContain("org-a00000000f");
    expect((await rowsOf(r.id)).map((x) => [x.name, x.address])).toEqual([
      ["Retired, 3 years", `${ORG}?source=awards&years=3`], ["Surviving, 5 years", `${ORG}?source=awards&years=5`],
    ]);
  });

  it("is listed on the analytics index's Saved Views panel", async () => {
    const r = await reader("views-index");
    const none = mainOf(await text(await open(r, "/analytics")));
    expect(none).toContain(`<h2>${t("en", "views.title")}</h2>`);
    expect(none).toContain(t("en", "views.index_none"));
    await save(r, `${SEGMENT}?source=awards&years=5`, "Engineering");
    const one = mainOf(await text(await open(r, "/analytics")));
    expect(one).toContain(`<a href="${SEGMENT}?source=awards&years=5" rel="nofollow">Engineering</a>`);
    // No panel for a reader signed out, or on Free holding none.
    expect(mainOf(await text(await open(null, "/analytics")))).not.toContain(`<h2>${t("en", "views.title")}</h2>`);
    const free = await reader("views-index-free", "free");
    expect(mainOf(await text(await open(free, "/analytics")))).not.toContain(`<h2>${t("en", "views.title")}</h2>`);
  });
});

describe("the email", () => {
  const ASSETS = makeFakeAssets({}, {});
  const jobEnv = (mail: SendEmail, extra: Record<string, unknown> = {}) =>
    sale({ ASSETS, MAIL: mail, MAIL_FROM: FROM, MAIL_SENDER: undefined, ...extra });
  const run = (mail: SendEmail, dataDate: string, extra: Record<string, unknown> = {}) =>
    runViewMail(jobEnv(mail, extra) as never, { site: SITE, dataDate, now: new Date(`${dataDate}T16:00:00.000Z`), plans: new Map(), room: 300, capText: "the cap" });

  async function weekly(tag: string, address = `${ORG}?source=awards&years=3`, deliver: "weekly" | "monthly" = "weekly") {
    const r = await reader(tag, "ultra");
    await save(r, address, "Exemplar's awards", sale());
    const [v] = await rowsOf(r.id);
    expect(await setViewDelivery(onEnv() as never, r.id, v.id, deliver)).toBe(true);
    return { r, v };
  }

  it("is due weekly from the briefings' Monday, monthly from the month's first Monday", () => {
    expect(monthAnchor("2026-11-13")).toBe("2026-11-02");
    expect(monthAnchor("2026-11-02")).toBe("2026-11-02");
    expect(monthAnchor("2026-11-01")).toBe("2026-10-05");
    expect(monthAnchor("2026-12-01")).toBe("2026-11-02");
    expect(monthAnchor("2027-01-04")).toBe("2027-01-04");
    expect(monthAnchor("2027-01-03")).toBe("2026-12-07");
    expect(viewDue("weekly", null, DAY)).toBe(true);
    expect(viewDue("weekly", "2026-10-26T16:00:00.000Z", DAY)).toBe(false);
    expect(viewDue("weekly", "2026-10-24T16:00:00.000Z", DAY)).toBe(true);
    expect(viewDue("monthly", "2026-10-31T16:00:00.000Z", "2026-11-01")).toBe(false);
    expect(viewDue("monthly", "2026-10-31T16:00:00.000Z", "2026-11-02")).toBe(true);
    expect(viewDue("monthly", "2026-11-02T16:00:00.000Z", "2026-11-30")).toBe(false);
    expect(viewDue("off", null, DAY)).toBe(false);
    expect(VIEWS_DUE_SQL).toMatch(/LIMIT \?3$/);
    expect(viewCsv("buyer", `${BUYER}?source=awards&years=5`)).toBe("/buyers/pwgsc-tpsgc/analytics/quarters.csv?source=awards&years=5");
    expect(viewCsv("organization", `${ORG}?source=awards&years=10&segment=81`)).toBe(`/organizations/${A1}/analytics/years.csv?source=awards&years=10&segment=81`);
  });

  it("sends the view's figures with its stop link and List-Unsubscribe, then nothing while they stay the same, and again when they change", async () => {
    const mail = fakeMail();
    const { r, v } = await weekly("views-mail");
    const first = await run(mail.binding, DAY);
    expect(first.report?.sent).toBeGreaterThanOrEqual(1);
    const [m] = mail.to(r.email);
    expect(m.subject).toBe(`Exemplar's awards: figures to ${DAY}`);
    const row = (await rowsOf(r.id))[0];
    expect(row.secret).toMatch(/^[0-9a-f]{32}$/);
    expect(row.last_hash).toMatch(/^[0-9a-f]{64}$/);
    const stop = `${SITE}/account/stop?v=${v.id}&t=${row.secret}`;
    expect(m.headers).toMatchObject({ "List-Unsubscribe": `<mailto:contact@awardwatch.ca>, <${stop}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(m.text).toContain(`Your saved view as of the data date ${DAY}: Award notices, fiscal years 2024-25 to 2026-27.`);
    expect(m.text).toContain("- 2026-27 (to date) · 2 records · $400,000");
    expect(m.text).toContain("- 2025-26 · 1 record · $500,000");
    expect(m.text).toContain(`- Translation, the largest\n  Public Services and Procurement Canada · $300,000\n  ${SITE}/awards/cb-100-00000002`);
    expect(m.text).toContain(`Open the view: ${SITE}${ORG}?source=awards&years=3`);
    expect(m.text).toContain(`The table as a CSV file (signed in): ${SITE}/organizations/${A1}/analytics/years.csv?source=awards&years=3`);
    expect(m.text).toContain(`Stop this view's email: ${stop}`);
    expect(m.text).toContain(t("en", "view.mail_why_weekly"));
    expect((m.html?.match(/<td class="btn"/g) ?? []).length).toBe(1);
    expect(await runsOf(v.id)).toEqual([{ status: "sent", day: DAY }]);
    // The same week: nothing due.
    await run(mail.binding, DAY);
    expect(mail.to(r.email)).toHaveLength(1);
    // The next Monday, the figures unchanged: "same", and no message.
    await seedRecords("2026-11-02");
    const same = await run(mail.binding, "2026-11-02");
    expect(same.report?.same).toBeGreaterThanOrEqual(1);
    expect(mail.to(r.email)).toHaveLength(1);
    expect((await runsOf(v.id)).map((x) => x.status)).toEqual(["sent", "same"]);
    // A new record: the next week sends again, with the new figure.
    await seedRecords("2026-11-09", [{ src: 1, fy: 2026, fq: 3, bid: DFO, oid: orgNumber(A1)!, sid: 81, cents: 70_000_000, ref: "cb-100-00000004", title: "Translation, new" }]);
    await run(mail.binding, "2026-11-09");
    expect(mail.to(r.email)).toHaveLength(2);
    expect(mail.to(r.email)[1].text).toContain("- 2026-27 (to date) · 3 records · $1,100,000");
    expect((await runsOf(v.id)).map((x) => x.status)).toEqual(["sent", "same", "sent"]);
    await seedRecords();
  });

  it("goes monthly on the month's first Monday, and waits while the records database is not at the data date", async () => {
    const mail = fakeMail();
    const { r, v } = await weekly("views-monthly", `${SEGMENT}?source=awards&years=3`, "monthly");
    // The records database a day behind: the view waits, unclaimed.
    await seedRecords("2026-10-30");
    const waiting = await run(mail.binding, DAY);
    expect(waiting.report?.records).toBe("stale");
    expect(mail.to(r.email)).toHaveLength(0);
    expect(await runsOf(v.id)).toEqual([]);
    await seedRecords();
    await run(mail.binding, DAY);
    expect(mail.to(r.email)).toHaveLength(1);
    expect(mail.to(r.email)[0].text).toContain(t("en", "view.mail_why_monthly"));
    // The next Monday is not the month's first: nothing; the month's first Monday sends (the figures as they stand).
    await seedRecords("2026-11-02", [{ src: 1, fy: 2026, fq: 3, bid: DFO, oid: orgNumber(A1)!, sid: 81, cents: 5_000_000, ref: "cb-100-00000009", title: "x" }]);
    await run(mail.binding, "2026-11-02");
    expect(mail.to(r.email)).toHaveLength(2);
    await seedRecords("2026-11-09", [{ src: 1, fy: 2026, fq: 3, bid: DFO, oid: orgNumber(A1)!, sid: 81, cents: 6_000_000, ref: "cb-100-00000010", title: "y" }]);
    await run(mail.binding, "2026-11-09");
    expect(mail.to(r.email)).toHaveLength(2);
    await seedRecords();
  });

  it("sends nothing while Ultra is off sale, a view granted by hand included, and stops for a view's account moved to Pro", async () => {
    const mail = fakeMail();
    const { r } = await weekly("views-off-sale");
    const offSale = await runViewMail(onEnv({ ...PRO_SALE, MAIL: mail.binding, MAIL_FROM: FROM, MAIL_SENDER: undefined }) as never,
      { site: SITE, dataDate: DAY, now: new Date(`${DAY}T16:00:00.000Z`), plans: new Map(), room: 300, capText: "the cap" });
    expect(offSale).toEqual({ report: null, stop: null, capped: false });
    expect(mail.handed).toEqual([]);
    // Through the whole run: no fifth part off sale.
    const stats = FILES["stats.json"] as Record<string, unknown>;
    const whole = await runDeliveries(onEnv({
      ...PRO_SALE, ASSETS: makeFakeAssets({}, { "stats.json": { ...stats, data_as_of: DAY } }), MAIL: mail.binding, MAIL_FROM: FROM, MAIL_SENDER: undefined,
      NOW: `${DAY}T16:00:00Z`,
    }) as never);
    expect(whole.views ?? null).toBeNull();
    expect(mail.to(r.email)).toHaveLength(0);
    // Moved to Pro: kept, its email set, and skipped.
    await grant(r.email, "pro");
    const moved = await run(mail.binding, DAY);
    expect(moved.report?.skipped).toBeGreaterThanOrEqual(1);
    expect(mail.to(r.email)).toHaveLength(0);
    expect((await rowsOf(r.id))[0].deliver).toBe("weekly");
  });

  it("is the whole run's fifth part, within its one cap, while Ultra is on sale", async () => {
    const mail = fakeMail();
    const { r } = await weekly("views-whole");
    const stats = FILES["stats.json"] as Record<string, unknown>;
    const report = await runDeliveries(jobEnv(mail.binding, { ASSETS: makeFakeAssets({}, { "stats.json": { ...stats, data_as_of: DAY } }), NOW: `${DAY}T16:00:00Z` }) as never);
    expect(report.views?.sent).toBeGreaterThanOrEqual(1);
    expect(mail.to(r.email)).toHaveLength(1);
    // With no room left, the part sends nothing and says the cap stopped it.
    const other = await weekly("views-no-room");
    const full = await runViewMail(jobEnv(mail.binding) as never, { site: SITE, dataDate: DAY, now: new Date(`${DAY}T17:00:00.000Z`), plans: new Map(), room: 0, capText: "the cap" });
    expect(full.stop).toBe("the cap");
    expect(full.capped).toBe(true);
    expect(mail.to(other.r.email)).toHaveLength(0);
    expect((await rowsOf(other.r.id))[0]).toMatchObject({ last_hash: null });
  });

  it("stops from its link: the page, then the post or a mail client's one-click post, which turn that view's email off alone", async () => {
    const mail = fakeMail();
    const { r, v } = await weekly("views-stop");
    await run(mail.binding, DAY);
    const secret = (await rowsOf(r.id))[0].secret!;
    const page = await get(`/account/stop?v=${v.id}&t=${secret}`, { env: sale() });
    expect(page.status).toBe(200);
    const html = await text(page);
    expect(html).toContain(`<h1>${t("en", "views.stop_title")}</h1>`);
    expect(html).toContain("<strong>Exemplar's awards</strong>");
    expect((await rowsOf(r.id))[0].deliver).toBe("weekly");
    expect((await get(`/account/stop?v=${v.id}&t=${"0".repeat(32)}`, { env: sale() })).status).toBe(404);
    const oneClick = await post(`/account/stop?v=${v.id}&t=${secret}`, { "List-Unsubscribe": "One-Click" }, { env: sale(), origin: null });
    expect(oneClick.status).toBe(200);
    expect(await oneClick.text()).toBe(t("en", "views.stopped_one_click"));
    expect((await rowsOf(r.id))[0].deliver).toBe("off");
    const audit = await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = 'view_stopped'").bind(r.id).all<{ detail: string }>();
    expect(audit.results).toEqual([{ detail: "one_click" }]);
  });
});

describe("the tables missing", () => {
  it("leave every page answering, the control and the panel out, the page the site's 404, and the run saying so", async () => {
    const r = await reader("views-missing", "ultra");
    await save(r, `${BUYER}?source=awards&years=5`);
    await withoutViews(async () => {
      const view = await open(r, `${BUYER}?source=awards&years=5`);
      expect(view.status).toBe(200);
      expect(await text(view)).not.toContain("save-view");
      expect((await open(r, "/account/views")).status).toBe(404);
      expect((await save(r, `${BUYER}?source=awards&years=3`)).status).toBe(404);
      expect((await send(r, `/account/views/${"a".repeat(32)}`, { deliver: "off" })).status).toBe(303);
      expect((await send(r, `/account/views/${"a".repeat(32)}/delete`)).status).toBe(303);
      expect((await get(`/account/stop?v=${"a".repeat(32)}&t=${"b".repeat(32)}`, { env: sale() })).status).toBe(404);
      const index = await open(r, "/analytics");
      expect(index.status).toBe(200);
      expect(await text(index)).not.toContain(`<h2>${t("en", "views.title")}</h2>`);
      expect((await open(r, "/account/dashboard", sale())).status).toBe(200);
      expect((await open(r, "/privacy", sale())).status).toBe(200);
      const mail = fakeMail();
      const report = await runViewMail(sale({ MAIL: mail.binding, MAIL_FROM: FROM, MAIL_SENDER: undefined }) as never,
        { site: SITE, dataDate: DAY, now: new Date(`${DAY}T16:00:00.000Z`), plans: new Map(), room: 300, capText: "the cap" });
      expect(report.report?.records).toBe("no_table");
      expect(mail.handed).toEqual([]);
      // Deleting the account still deletes the rest.
      const gone = await reader("views-missing-delete");
      expect((await send(gone, "/account/delete", { confirm: "yes" })).status).toBe(200);
    });
    expect(await rowsOf(r.id)).toHaveLength(1);
  });
});

describe("deleting the account", () => {
  it("removes its saved views and their runs", async () => {
    const r = await reader("views-delete", "ultra");
    await save(r, `${BUYER}?source=awards&years=5`);
    const [v] = await rowsOf(r.id);
    await ACCOUNTS.prepare("INSERT INTO view_deliveries (view_id, sent_at, day, status) VALUES (?, ?, ?, 'sent')").bind(v.id, `${DAY}T16:00:00.000Z`, DAY).run();
    expect((await send(r, "/account/delete", { confirm: "yes" })).status).toBe(200);
    expect(await rowsOf(r.id)).toEqual([]);
    expect(await runsOf(v.id)).toEqual([]);
  });
});

describe("what the site says of them", () => {
  it("states each paid plan's own figure on the plan cards, Ultra's email on Ultra's card alone and only while on sale", async () => {
    const proRow = PLAN_ROWS.find((r) => r.feature === "saved_views")!;
    const mailRow = PLAN_ROWS.find((r) => r.feature === "view_mail")!;
    expect(proRow.free).toBeNull();
    expect(planLine("en", proRow.pro!)).toBe(`${RULES.pro.saved_views} saved analytics views`);
    expect(planLine("en", proRow.ultra)).toBe(`${RULES.ultra.saved_views} saved analytics views`);
    expect(norm(planLine("fr", proRow.ultra))).toBe(`${RULES.ultra.saved_views} vues d'analyse enregistrées`);
    expect([mailRow.free, mailRow.pro]).toEqual([null, null]);
    for (const lang of ["en", "fr"] as const) {
      for (const w of [proRow.pro!, proRow.ultra, mailRow.ultra]) expect(planLine(lang, w).length).toBeLessThanOrEqual(PLAN_LINE_MAX);
    }
    const offPro = norm(decode(await (await get("/pro", { env: off() })).text()));
    expect(offPro).toContain(`<span>${RULES.pro.saved_views} saved analytics views</span>`);
    expect(offPro).not.toContain("Saved views by email");
    const onPro = norm(decode(await (await get("/pro", { env: sale() })).text()));
    expect(onPro).toContain(`<span>${RULES.ultra.saved_views} saved analytics views</span>`);
    expect(onPro).toContain("<span>Saved views by email, weekly or monthly</span>");
  });

  it("says on the privacy page what a saved view keeps, and what its email keeps only while Ultra is on sale", async () => {
    const kept = t("en", "views.privacy");
    const mailKept = t("en", "views.privacy_mail", { days: "90" });
    const offPage = await text(await get("/privacy", { env: off() }));
    expect(offPage).toContain(kept);
    expect(offPage).not.toContain(mailKept);
    const onPage = await text(await get("/privacy", { env: sale() }));
    expect(onPage).toContain(kept);
    expect(onPage).toContain(mailKept);
    expect(await text(await get("/privacy", { env: offEnv() }))).not.toContain(kept);
  });

  it("has every string in both languages, with no dash and straight apostrophes in the source", () => {
    const keys = Object.keys(VIEWS_STRINGS) as Key[];
    expect(keys.every((k) => allKeys().includes(k))).toBe(true);
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      for (const s of [en, fr]) {
        expect(s, key).not.toContain(EM_DASH);
        expect(s, key).not.toContain(EN_DASH);
        expect(s, key).not.toContain("’");
      }
      expect(fr, key).not.toBe(en);
    }
    // The gate lines name their plans' own figures, never a comparison.
    for (const key of ["views.gate", "views.gate_pro", "plans.saved_views", "plans.view_mail"] as Key[]) {
      expect(rawEntry(key).en + rawEntry(key).fr, key).not.toMatch(/\b(more|higher|above|unlimited|plus|davantage)\b/i);
    }
  });

  it("draws the saved views page and a view's control in French", async () => {
    const r = await reader("views-fr", "ultra");
    await send(r, "/account/views", { address: `${BUYER}?source=awards&years=5`, name: "", lang: "fr" });
    const html = await text(await open(r, "/account/views?lang=fr", sale()));
    expect(html).toContain(`<h1>${norm(t("fr", "views.title"))}</h1>`);
    expect(html).toContain(norm(t("fr", "views.deliver_monthly")));
    expect(html).toContain("Services publics et Approvisionnement Canada, avis d'attribution, 2022-2023 à 2026-2027");
    const view = await text(await open(r, `${SEGMENT}?source=awards&years=5&lang=fr`));
    expect(saveForm(view)).toContain(`>${norm(t("fr", "views.save"))}</button>`);
    for (const p of [html, view]) {
      expect(p).not.toContain(EM_DASH);
      expect(p).not.toContain(EN_DASH);
    }
  });
});
