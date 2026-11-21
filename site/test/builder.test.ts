// The analytics builder (src/pages/builder.tsx, src/builder.ts,
// src/builder_sql.ts, public/build-menu.js; docs/analytics.md, "The
// builder") against a records database filled as the nightly fills it, its
// cubes counted in test/builder-fixture.ts from the same rows. Every figure
// checked is worked out here from those rows, and the ones the analytics
// views also show are read from the views' own pages too.
//
// The switch: anything but BUILDER "on", or the accounts switch off, and both
// addresses are the site's 404, nothing is read, linked or named. On: the
// menus for every reader, the line that the builder is part of Ultra for any
// reader without it and no records read for them, the view for Ultra in one
// batch. The matrix: every cell either reads or is absent, and an absent one
// says why. The statements' plans and bounds, the missing tables, the
// preview's fragment, the CSV file, both languages, the tables' fit, and no
// evaluative word.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { MEASURES, ROWS, SET_MAX, SOURCES, SUBJECTS, cellOffered, longestSpan, sourcesFor, whyNot } from "../public/build-menu.js";
import { RULES, allowed } from "../src/account/entitlements";
import { BUILD_YEARS, type BuildChoice, buildProblem, buildQuery, readBuild } from "../src/builder";
import {
  BUILD_SQL, BUYERS_YEARS_SQL, CELL_YEARS_SQL, CUBE_META_SQL, EXPIRING_QUARTERS_SQL, PLACE_ALL_SQL, SEGMENTS_SQL, TOP_BUYERS_SQL, buildPlan, sumFigures,
} from "../src/builder_sql";
import { BUILDER_STRINGS } from "../src/builder_strings";
import { allKeys, rawEntry } from "../src/i18n";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { BUILDER_ROW, PLAN_LINE_MAX, PLAN_ROWS, planLine, planRows } from "../src/pro";
import { BUYER_DUE_SQL, BUYER_QUARTERS_SQL, SEGMENT_DUE_SQL, STATE_SQL, ULTRA_YEARS, readRecords } from "../src/records_db";
import { routeTemplate } from "../src/views";
import { STYLES_VERSION } from "../src/layout";
import robotsFile from "../public/robots.txt?raw";
import { get, grantPro, grantUltra, nbsp, newEmail, nextIp, onEnv, signIn, ultraEnv, useAccountsDb } from "./accounts-helpers";
import { testEnv } from "./assets";
import { DFO, DND, DUE, EXPIRING, ORGS, ORG_NAMES, PROVS, PSPC, RECORDS, RECS, type Rec, cellOf, median, oid, seedBuilder } from "./builder-fixture";
import { misfits, tablesIn } from "./table-fit";

useAccountsDb();
beforeAll(() => seedBuilder());

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const ON = { BUILDER: "on" };
const onWith = (extra: Record<string, unknown> = {}) => onEnv({ ...ON, RECORDS, ...extra });
const PATH = "/analytics/build";
const CSV = "/analytics/build.csv";

// -- readers ------------------------------------------------------------------------------

let who: { free: string; pro: string; ultra: string } | null = null;
async function readers(): Promise<{ free: string; pro: string; ultra: string }> {
  if (who) return who;
  const free = await signIn(newEmail("free-builder"));
  const proEmail = newEmail("pro-builder");
  const pro = await signIn(proEmail);
  await grantPro(proEmail);
  const ultraEmail = newEmail("ultra-builder");
  const ultra = await signIn(ultraEmail);
  await grantUltra(ultraEmail);
  who = { free, pro, ultra };
  return who;
}

// A D1 binding that writes down every batch it runs, by the statements' text (as test/analytics.test.ts's).
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

// A binding that notes every use and throws (as test/accounts-switch.test.ts's): proof that nothing reads it.
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

const view = async (query: string, o: { cookie?: string; env?: object; headers?: Record<string, string> } = {}) => {
  const res = await get(`${PATH}${query}`, { cookie: o.cookie ?? (await readers()).ultra, env: o.env ?? onWith(), headers: o.headers });
  return { res, html: nbsp(await res.text()) };
};

// -- worked out from the rows -----------------------------------------------------------------

const money = (cents: number) => nbsp(new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(cents / 100));
const pct = (part: number, whole: number) => {
  const p = (part / whole) * 100;
  return p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`;
};
const buyerYear = (bid: number, src: number, fy: number) => RECS.filter((r) => r.extra === 0 && r.bid === bid && r.src === src && r.fy === fy);
const positives = (rows: Rec[]) => rows.map((r) => r.cents ?? 0).filter((c) => c > 0);

// -- the switch ------------------------------------------------------------------------------

describe("the switch", () => {
  it("answers both addresses with the site's 404 and reads nothing, whatever the reader, unless BUILDER is on with the accounts switch", async () => {
    const r = await readers();
    const off = [onEnv(), onEnv({ BUILDER: "yes" }), onEnv({ BUILDER: "ON" }), { ...testEnv(), ...ON }];
    for (const base of off) {
      const notFound = await (await get("/nothing-here", { env: base })).text();
      const records = trap<D1Database>("the records database");
      for (const path of [PATH, `${PATH}?subject=buyer&b=pwgsc-tpsgc&measure=median`, CSV, `${CSV}?subject=all`]) {
        for (const cookie of [undefined, r.free, r.ultra]) {
          const res = await get(path, { cookie, env: { ...base, RECORDS: records.binding } });
          expect(res.status, path).toBe(404);
          if (!cookie) expect(await res.text(), path).toBe(notFound);
        }
      }
      expect(records.used).toEqual([]);
    }
  });

  it("leaves every page as it is without the switch: no link, no rail item, no plan line, the same bytes for off and absent", { timeout: 30_000 }, async () => {
    const r = await readers();
    const pages: [string, string | undefined][] = [
      ["/analytics", undefined], ["/analytics?q=defence", undefined], ["/analytics", r.ultra], ["/pro", undefined], ["/pro", r.pro],
      ["/methodology", undefined], ["/overview", undefined], ["/buyers/pwgsc-tpsgc", r.free], ["/nothing-here", undefined],
      ["/account/billing", r.ultra], ["/account/dashboard", r.free], ["/", r.ultra],
    ];
    for (const [path, cookie] of pages) {
      const off = await (await get(path, { cookie, env: ultraEnv({ BUILDER: "off", RECORDS }) })).text();
      const absent = await (await get(path, { cookie, env: ultraEnv({ BUILDER: undefined, RECORDS }) })).text();
      const other = await (await get(path, { cookie, env: ultraEnv({ BUILDER: "no", RECORDS }) })).text();
      expect(absent, path).toBe(off);
      expect(other, path).toBe(off);
      expect(off, path).not.toContain(`href="${PATH}"`);
      expect(off, path).not.toContain("Analytics builder: your charts and tables");
      expect(off, path).not.toContain("With the analytics builder");
      expect(off, path).not.toContain("Analytics builder");
    }
    // The landing page, its own document, with Ultra on sale and before.
    for (const base of [ultraEnv, onEnv]) {
      const landing = async (extra: Record<string, unknown>) =>
        (await app.request("/", { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, base(extra))).text();
      const off = await landing({ BUILDER: "off" });
      expect(await landing({ BUILDER: undefined })).toBe(off);
      expect(off).not.toContain("Analytics builder: your charts and tables");
    }
  });

  it("links the builder from the analytics index and the rail with Ultra's chip, and names it on Ultra's cards and the Methodology page", async () => {
    const r = await readers();
    for (const cookie of [undefined, r.free, r.ultra]) {
      const index = await (await get("/analytics", { cookie, env: ultraEnv({ ...ON, RECORDS }) })).text();
      expect(index).toContain(`<a href="${PATH}" class="btn">Analytics builder</a>`);
      const rail = index.slice(index.indexOf('id="rail-browse"'), index.indexOf('id="rail-lists"'));
      expect(rail).toContain(`<a class="rail-item" href="${PATH}"><span class="rail-label">Analytics builder</span><span class="ultra-tag">`);
      const query = await (await get("/analytics?q=defence", { cookie, env: ultraEnv({ ...ON, RECORDS }) })).text();
      expect(query).toContain(`<a href="${PATH}" class="btn">Analytics builder</a>`);
      // The footer links it too, after Analytics, for the phone, where the rail's Browse group is hidden; in French as well.
      for (const [path, label] of [["/overview", "Analytics builder"], ["/overview?lang=fr", "Générateur d’analyses"], ["/about", "Analytics builder"]]) {
        const page = await (await get(path, { cookie, env: ultraEnv({ ...ON, RECORDS }) })).text();
        const footer = page.slice(page.indexOf('<footer class="site-footer">'));
        expect(footer, path).toMatch(new RegExp(`<a href="/analytics">[^<]+</a><a href="${PATH}">${label}</a><a href="/monthly">`));
        expect(footer.match(/href="\/analytics\/build"/g), path).toHaveLength(1);
      }
    }
    // The landing page, which has no rail, keeps its footer without it.
    const front = await (await app.request("/", { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, ultraEnv({ ...ON, RECORDS }))).text();
    expect(front.slice(front.indexOf("footer"))).not.toContain(`href="${PATH}"`);
    // The rail marks the builder's own page as current.
    const own = (await view("")).html;
    expect(own).toContain(`<a class="rail-item" href="${PATH}" aria-current="page"><span class="rail-label">Analytics builder</span>`);
    // Ultra's card on /pro holds the line; Free's and Pro's mark it as theirs not to have.
    const pro = decode(await (await get("/pro", { env: ultraEnv({ ...ON, RECORDS }) })).text());
    expect(pro).toContain("<li><svg class=\"plan-mark\"");
    expect(pro.match(/Analytics builder: your charts and tables/g)?.length).toBe(3);
    expect(pro.match(/<li class="plan-lacks">(?:(?!<\/li>).)*Analytics builder: your charts and tables<\/span><\/li>/g)?.length).toBe(2);
    // The Ultra paragraph ends on its sentence on the builder, its figures BUILD_YEARS (20) and SET_MAX (5); in French too.
    expect(pro).toContain("With the analytics builder you choose what to count, how to group it, the source and up to 20 fiscal years, and compare up to 5 buyers or organizations side by side.</p>");
    const proFr = nbsp(decode(await (await get("/pro?lang=fr", { env: ultraEnv({ ...ON, RECORDS }) })).text()));
    expect(proFr).toContain("Avec le générateur d’analyses, vous choisissez quoi compter, comment le regrouper, la source et jusqu’à 20 exercices, et comparez jusqu’à 5 acheteurs ou organisations côte à côte.</p>");
    expect(proFr.match(/Générateur d’analyses : graphiques, tableaux/g)?.length).toBe(3);
    // The landing page's Ultra card: on sale, its rows; before, its last line. With the switch off the card names
    // no builder at all, not even as planned (the landing pass of 2026-11-20).
    const landing = async (env: object) => decode(await (await app.request("/", { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() } }, env)).text());
    expect(await landing(ultraEnv({ ...ON, RECORDS }))).toContain("<span>Analytics builder: your charts and tables</span>");
    const before = await landing(onEnv({ ...ON, RECORDS }));
    expect(before).toContain("<span>Analytics builder: your charts and tables</span>");
    expect(before).not.toContain("Planned: an analytics builder");
    const off = await landing(onEnv({ RECORDS }));
    expect(off).not.toContain("Planned: an analytics builder");
    expect(off).not.toContain("Analytics builder");
    const meth = decode(await (await get("/methodology", { env: onWith() })).text());
    expect(meth).toContain("The analytics builder, part of Ultra, counts by the same rules");
  });

  it("states the plan line from RULES: Ultra's alone, at most PLAN_LINE_MAX characters, never a comparison", () => {
    expect([RULES.free.builder, RULES.pro.builder, RULES.ultra.builder]).toEqual([false, false, true]);
    expect([allowed({ plan: "free" }, "builder"), allowed({ plan: "pro" }, "builder"), allowed({ plan: "ultra" }, "builder")]).toEqual([false, false, true]);
    expect({ ...BUILDER_ROW, ultra: { key: BUILDER_ROW.ultra.key } }).toEqual({ feature: "builder", free: null, pro: null, ultra: { key: "plans.builder" } });
    // The line names the builder as the rail does and says what it makes; it carries no figure of its own.
    expect(planLine("en", BUILDER_ROW.ultra)).toBe("Analytics builder: your charts and tables");
    expect(nbsp(planLine("fr", BUILDER_ROW.ultra)).replace("’", "'")).toBe("Générateur d'analyses : graphiques, tableaux");
    expect(planLine("fr", BUILDER_ROW.ultra).length).toBeLessThanOrEqual(PLAN_LINE_MAX);
    expect(BUILD_YEARS).toBe(ULTRA_YEARS);
    expect(PLAN_ROWS).not.toContain(BUILDER_ROW);
    expect(planRows(["free", "pro"], { builder: true })).toEqual(planRows(["free", "pro"]));
    expect(planRows(["free", "pro", "ultra"], { builder: true }).at(-1)).toBe(BUILDER_ROW);
    for (const lang of ["en", "fr"] as const) {
      const line = nbsp(planLine(lang, BUILDER_ROW.ultra));
      expect(line.length, line).toBeLessThanOrEqual(PLAN_LINE_MAX);
      expect(line).not.toMatch(/\b(more|than|above|plus|davantage|que Pro)\b/i);
    }
  });
});

// -- who sees what -------------------------------------------------------------------------------

// A D1 binding that writes down every batch it runs, each statement's text and what it was bound to.
function recordingBinds(db: D1Database): { binding: D1Database; batches: [string, unknown[]][][] } {
  const batches: [string, unknown[]][][] = [];
  const seen = new WeakMap<object, [string, unknown[]]>();
  const binding = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      seen.set(st, [sql, []]);
      const bind = st.bind.bind(st);
      (st as { bind: unknown }).bind = (...args: unknown[]) => {
        const bound = bind(...args);
        seen.set(bound, [sql, args]);
        return bound;
      };
      return st;
    },
    async batch(statements: D1PreparedStatement[]) {
      batches.push(statements.map((s) => seen.get(s) ?? ["?", []]));
      return db.batch(statements);
    },
  } as unknown as D1Database;
  return { binding, batches };
}

const mainOf = (html: string) => html.slice(html.indexOf('<main id="main">'), html.indexOf("</main>"));
const SAMPLE_ASKS = ["", "?subject=buyer&b=pwgsc-tpsgc&rows=year&measure=median&source=history&from=2024&to=2026&show=line", "?subject=all&rows=segment&measure=ending"];

describe("a reader without Ultra", () => {
  it("gets what the builder does, the plans as the one filled button, the menus locked, and one sample whatever the address asks", async () => {
    const r = await readers();
    for (const lang of ["en", "fr"] as const) {
      const mains: string[] = [];
      for (const [who, cookie] of [["signed out", ""], ["free", r.free], ["pro", r.pro]] as const) {
        for (const query of SAMPLE_ASKS) {
          const rec = recordingBinds(RECORDS);
          const ask = lang === "fr" ? (query ? `${query}&lang=fr` : "?lang=fr") : query;
          const { res, html } = await view(ask, { cookie, env: onWith({ RECORDS: rec.binding }) });
          expect(res.status, `${who} ${ask}`).toBe(200);
          // Signed out, the public cache a page has; signed in, the page names the account and is private.
          expect(res.headers.get("cache-control"), `${who} ${ask}`).toBe(who === "signed out" ? "public, max-age=300" : "private, no-store");
          // One records batch: the state row, cube_meta and every buyer's cells by fiscal year, award notices (src 1),
          // the BUILD_YEARS (20) fiscal years to the data date's (2026-27): 2007 to 2026.
          expect(rec.batches, `${who} ${ask}`).toEqual([[[STATE_SQL, []], [CUBE_META_SQL, []], [CELL_YEARS_SQL, [0, 1, 2007, 2026]]]]);
          const main = mainOf(html);
          mains.push(main);
          // The one filled button is the way to the plans; nothing in the page posts or downloads.
          expect(html.match(/class="btn btn-primary"/g), ask).toHaveLength(1);
          expect(main).toContain(`<a href="/pro" class="btn btn-primary">${lang === "fr" ? "Voir les forfaits" : "See the plans"}</a>`);
          for (const absent of ["/analytics/build.csv", 'method="post"', 'id="build-result"', 'id="build-form"', "/builder.js", "Add to dashboard", "Save this view"]) {
            expect(html, `${who} ${ask} ${absent}`).not.toContain(absent);
          }
          expect(main).not.toContain('class="pro-tag"');
          expect(main).not.toContain('class="ultra-tag"');
        }
      }
      // The same page for every reader and every address asked, in its language.
      expect(new Set(mains).size, lang).toBe(1);
      const main = decode(mains[0]);
      if (lang === "en") {
        expect(main).toContain("<p>The builder draws charts and tables of the figures you choose, over up to 20 fiscal years, and compares up to 5 buyers or organizations side by side. It comes with Ultra.</p>");
        expect(main).toContain("<h2>Sample: Value by fiscal year</h2>");
      } else {
        expect(nbsp(main)).toContain("<p>Le générateur dessine des graphiques et des tableaux des chiffres que vous choisissez, sur au plus 20 exercices, et compare jusqu’à 5 acheteurs ou organisations côte à côte. Il fait partie d’Ultra.</p>");
        expect(nbsp(main)).toContain("<h2>Exemple : Valeur par exercice</h2>");
      }
    }
  });

  it("draws the sample from the records as an Ultra reader's view of the same address, under its own title", async () => {
    const sample = mainOf((await view("", { cookie: "" })).html);
    const ultra = mainOf((await view("?subject=all&rows=year&measure=value&source=awards&from=2007&to=2026&show=bars")).html);
    // Award notices, every buyer, each fiscal year: DFO's three records (300,000,000 + fy, 100,000,000 + fy and
    // 50,000,000 cents) and PSPC's one (700,000,000 cents), 1,150,000,000 + 2 fy cents in four records. 2024-25:
    // $11,500,040.48; 2025-26: $11,500,040.50; 2026-27: $11,500,040.52, each written to the dollar.
    for (const [fy, value] of [["2024-25", "$11,500,040"], ["2025-26", "$11,500,041"], ["2026-27", "$11,500,041"]]) {
      expect(sample).toContain(`<td data-label="Value" class="mono num">${value}</td><td data-label="Records" class="mono num">4</td>`);
      expect(sample).toContain(fy);
    }
    expect(sample.match(/<tr><td data-label="Fiscal year"/g)).toHaveLength(3);
    expect(sample).toContain("Every buyer");
    expect(sample).toContain('class="chart-stack"');
    // The panel is the Ultra reader's but for its title and the tools (the CSV file, Add to dashboard): every byte
    // from the panel's body to its foot is the same.
    const body = (m: string) => m.slice(m.indexOf('<p>Every buyer</p>'), m.indexOf('<div class="panel-foot">'));
    expect(body(sample)).toBe(body(ultra));
    expect(body(sample).length).toBeGreaterThan(1000);
  });

  it("locks every control of the form in one disabled fieldset, with no button to send it", async () => {
    const r = await readers();
    for (const cookie of ["", r.free, r.pro]) {
      for (const lang of ["", "?lang=fr"]) {
        const { html } = await view(lang, { cookie });
        const start = html.indexOf('<form method="get" action="/analytics/build" class="toolbar build-form"');
        const form = html.slice(start, html.indexOf("</form>", start) + "</form>".length);
        expect(form).toMatch(/^<form method="get" action="\/analytics\/build" class="toolbar build-form" aria-label="[^"]+"><fieldset class="build-locked" disabled=""><div class="toolbar-fields">/);
        expect(form.endsWith("</div></fieldset></form>")).toBe(true);
        // The one fieldset closes only at the form's end, so every control is inside a disabled fieldset.
        const outer = form.slice(form.indexOf('<fieldset class="build-locked"'));
        expect(outer.match(/<fieldset\b/g)!.length).toBe(outer.match(/<\/fieldset>/g)!.length);
        expect(form).not.toContain("<button");
        expect(form).not.toContain('type="submit"');
        // Fourteen menus (subject, buyer, segment, four buyers to compare, rows, figure, source, from, to, show, rows
        // shown) and five boxes (an organization and four to compare).
        expect(form.match(/<select\b/g)!.length).toBe(14);
        expect(form.match(/<input\b/g)!.length).toBe(5);
        // The menus show the sample's choices.
        for (const [name, value] of [["subject", "all"], ["rows", "year"], ["measure", "value"], ["source", "awards"], ["from", "2007"], ["to", "2026"], ["show", "bars"]]) {
          expect(form, name).toMatch(new RegExp(`<select name="${name}"[^>]*>(?:(?!</select>).)*<option value="${value}" selected="">`));
        }
      }
    }
  });

  it("answers the preview's ask with an empty box and the file with the site's 404, reading nothing", async () => {
    const r = await readers();
    for (const cookie of [undefined, r.free, r.pro]) {
      // The preview's ask: an empty box, nothing read.
      const records = trap<D1Database>("the records database");
      const frag = await view("?subject=all", { cookie: cookie ?? "", env: onWith({ RECORDS: records.binding }), headers: { "x-build-fragment": "1" } });
      expect(frag.html).toBe('<div id="build-result" aria-live="polite" hidden=""></div>');
      expect(records.used).toEqual([]);
      // The file is Ultra's: the site's 404, nothing read.
      const csv = await get(`${CSV}?subject=all`, { cookie, env: onWith({ RECORDS: records.binding }) });
      expect(csv.status).toBe(404);
      expect(records.used).toEqual([]);
    }
  });
});

describe("an Ultra reader", () => {
  it("gets the default view (every buyer's award notice value by fiscal year) in one batch, private, noindex, one filled button", async () => {
    const rec = recording(RECORDS);
    const { res, html } = await view("", { env: onWith({ RECORDS: rec.binding }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(rec.batches).toEqual([[STATE_SQL, CUBE_META_SQL, CELL_YEARS_SQL]]);
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html.match(/class="btn btn-primary"/g)).toHaveLength(1);
    expect(html).toContain("<h2>Value by fiscal year</h2>");
    expect(html).toContain("Figures from the award notices, fiscal years 2017-18 to 2026-27, as of 2026-10-30.");
    expect(html).toContain('href="/analytics/build.csv?subject=all&amp;rows=year&amp;measure=value&amp;source=awards&amp;from=2017&amp;to=2026&amp;show=bars"');
    expect(html).toContain('class="chart-stack"');
    expect(html).toContain('<script type="module" src="/builder.js"></script>');
    // No chip in the page itself: the rail carries them.
    const main = html.slice(html.indexOf('<main id="main">'), html.indexOf("</main>"));
    expect(main).not.toContain('class="pro-tag"');
    expect(main).not.toContain('class="ultra-tag"');
    // Every buyer's award value for 2025-26, from the rows.
    const total = RECS.filter((r) => r.extra === 0 && r.src === 1 && r.fy === 2025).reduce((s, r) => s + (r.cents ?? 0), 0);
    expect(html).toContain(`<td data-label="Value" class="mono num">${money(total)}</td>`);
  });
});

// -- the figures: the cubes against the rows and the views ------------------------------------------

describe("the figures", () => {
  it("are the analytics views' own for the same buyer, source and fiscal year: median, average, shares, the largest organizations, growth", async () => {
    const { ultra } = await readers();
    const fy = 2025;
    const rows = buyerYear(PSPC, 2, fy);
    const pos = positives(rows);
    const views = nbsp(await (await get(`/buyers/pwgsc-tpsgc/analytics?source=history&from=${fy}&to=${fy}`, { cookie: ultra, env: onWith() })).text());
    const ask = (measure: string) => view(`?subject=buyer&b=pwgsc-tpsgc&rows=year&measure=${measure}&source=history&from=${fy}&to=${fy}&show=table`);

    const med = money(median(pos));
    expect((await ask("median")).html).toContain(`<td data-label="Median" class="mono num">${med}</td>`);
    expect(views).toContain(`<td data-label="Median" class="mono num">${med}</td>`);

    const avg = money(Math.round(pos.reduce((a, b) => a + b, 0) / pos.length));
    expect((await ask("average")).html).toContain(`<td data-label="Average" class="mono num">${avg}</td>`);
    expect(views).toContain(`<td data-label="Average" class="mono num">${avg}</td>`);

    const nc = rows.filter((r) => r.comp === 0).length;
    const byCount = `${nc} (${pct(nc, rows.length)})`;
    const posNc = rows.filter((r) => r.comp === 0 && (r.cents ?? 0) > 0).reduce((s, r) => s + (r.cents as number), 0);
    const byValue = `${money(posNc)} (${pct(posNc, pos.reduce((a, b) => a + b, 0))})`;
    const share = (await ask("noncompetitive")).html;
    for (const text of [byCount, byValue]) {
      expect(share).toContain(`>${text}</td>`);
      expect(views).toContain(`>${text}</td>`);
    }

    // The largest organizations' share of the year's value: the suppliers' ranking, the withheld supplier's value in the whole.
    const cell = cellOf(rows);
    const largest = (await ask("largest")).html;
    for (const [k, label, viewLabel] of [["top1", "Largest organization", "Largest organization:"], ["top5", "Five largest", "Five largest:"], ["top10", "Ten largest", "Ten largest:"]] as const) {
      const p = pct(cell[k] as number, cell.cents as number);
      expect(largest).toContain(`<td data-label="${label}" class="mono num">${p}</td>`);
      expect(views).toContain(`<span>${viewLabel} <b>${p}</b></span>`);
    }

    const amended = rows.filter((r) => (r.namd ?? 0) > 0 && (r.ocents ?? 0) > 0 && r.cents !== null);
    const first = amended.reduce((s, r) => s + (r.ocents as number), 0);
    const last = amended.reduce((s, r) => s + (r.cents as number), 0);
    const growth = `${last > first ? "+" : "-"}${Math.round(Math.abs(last / first - 1) * 100)}%`;
    expect((await ask("amendments")).html).toContain(`<td data-label="Change" class="mono num">${growth}</td>`);
    expect(views).toContain(`<td data-label="Change" class="mono num">${growth}<span`);
  });

  it("count a notice in each of its segments and each of its provinces, never total either, and say why", async () => {
    const segs = (await view("?subject=all&rows=segment&measure=value&source=history&from=2022&to=2026&show=ranked")).html;
    for (const sid of [82, 43]) {
      const total = RECS.filter((r) => r.sid === sid && r.src === 2).reduce((s, r) => s + (r.cents ?? 0), 0);
      expect(segs).toContain(`<td data-label="Value" class="mono num">${money(total)}</td>`);
    }
    expect(segs).toContain("A notice whose codes reach several segments counts in each, so the segments are not added together.");
    const all = RECS.filter((r) => r.extra === 0 && r.src === 2).reduce((s, r) => s + (r.cents ?? 0), 0);
    expect(segs).not.toContain(money(all));

    const places = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=province&measure=records&source=history&from=2022&to=2026")).html;
    const inProv = (code: string) => RECS.filter((r) => r.extra === 0 && r.bid === PSPC && r.src === 2 && (PROVS.get(r.rk) ?? []).includes(code)).length;
    expect(places).toContain(`<td data-label="Province of delivery">Ontario</td><td data-label="Records" class="mono num">${inProv("ON")}</td>`);
    expect(places).toContain(`<td data-label="Province of delivery">Quebec</td><td data-label="Records" class="mono num">${inProv("QC")}</td>`);
    expect(places).toContain('<td data-label="Province of delivery">No province named</td>');
    expect(places).toContain("A notice that names several provinces counts in each, so the provinces are not added together.");
    // One notice in two provinces: the provinces' counts add up to more than the buyer's records.
    const counted = [...places.matchAll(/data-label="Records" class="mono num">(\d+)</g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(counted).toBeGreaterThan(RECS.filter((r) => r.extra === 0 && r.bid === PSPC && r.src === 2).length);
  });

  it("name no supplier withheld as a person, count it in the totals, and keep the N largest by value", async () => {
    const rows = RECS.filter((r) => r.bid === PSPC && r.src === 2 && r.extra === 0);
    const orgs = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=organization&measure=value&source=history&from=2022&to=2026&top=5")).html;
    const named = [...orgs.matchAll(/<td data-label="Organization"><a href="\/organizations\/(org-[0-9a-f]{10})">([^<]*)<\/a><\/td>/g)];
    expect(named).toHaveLength(5);
    for (const [, id, name] of named) expect(name).toBe(ORG_NAMES[id]);
    expect(orgs).toContain("A supplier withheld as a person counts in the totals and is named in no row.");
    expect(orgs).toContain("The 5 with the largest values in the period, sorted by the figure.");
    // The withheld supplier's value is in every buyer total.
    const yearly = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=none&measure=value&source=history&from=2022&to=2026")).html;
    expect(yearly).toContain(money(rows.reduce((s, r) => s + (r.cents ?? 0), 0)));
    // An organization count leaves it out.
    const year = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=year&measure=organizations&source=history&from=2026&to=2026&show=table")).html;
    expect(year).toContain(`<td data-label="Organizations" class="mono num">${new Set(buyerYear(PSPC, 2, 2026).filter((r) => r.oid !== null).map((r) => r.oid)).size}</td>`);
  });

  it("read an organization from records as its view does, and compare up to five, each its own panel on one scale", async () => {
    const { ultra } = await readers();
    const a = ORGS[0];
    const fy = 2025;
    const own = RECS.filter((r) => r.oid === oid(a) && r.src === 2 && r.fy === fy && r.extra === 0).reduce((s, r) => s + (r.cents ?? 0), 0);
    const one = (await view(`?subject=organization&o=${a}&rows=year&measure=value&source=history&from=2022&to=2026`)).html;
    expect(one).toContain(`<td data-label="Value" class="mono num">${money(own)}</td>`);
    const orgView = nbsp(await (await get(`/organizations/${a}/analytics?source=history&from=2022&to=2026`, { cookie: ultra, env: onWith() })).text());
    expect(orgView).toContain(`<td data-label="Value" class="mono num">${money(own)}</td>`);
    // A profile's address names an organization as well as its id.
    expect((await view(`?subject=organization&o=https://awardwatch.ca/organizations/${a}&rows=year&measure=value&source=history&from=2022&to=2026`)).html)
      .toContain(`<td data-label="Value" class="mono num">${money(own)}</td>`);

    const set = (await view(`?subject=organizations&o=${ORGS[0]}&o=${ORGS[1]}&o=${ORGS[2]}&rows=year&measure=value&source=history&from=2022&to=2026&show=line`)).html;
    for (const id of ORGS.slice(0, 3)) expect(set).toContain(`<div class="chart-title">${ORG_NAMES[id]}</div>`);
    expect(set.match(/class="chart-stack"/g)).toHaveLength(1);
    expect(set).toContain('<th class="k-main"><button type="button" class="th-sort">About</button></th><th class="k-date">');

    const buyers = (await view("?subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&rows=segment&measure=value&source=awards&from=2024&to=2026")).html;
    expect(buyers).toContain('<p class="chart-title">Public Services and Procurement Canada</p>');
    expect(buyers).toContain('<p class="chart-title">Fisheries and Oceans Canada</p>');
    expect(buyers.match(/<ol class="rank-bars"/g)).toHaveLength(2);
  });

  it("split a period's records into competitive, non-competitive and not stated, and add one figure over the years", async () => {
    const rows = RECS.filter((r) => r.bid === PSPC && r.src === 2 && r.extra === 0 && r.fy >= 2024);
    const html = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=competitive&measure=records&source=history&from=2024&to=2026")).html;
    for (const [label, n] of [["Competitive", rows.filter((r) => r.comp === 1).length], ["Non-competitive", rows.filter((r) => r.comp === 0).length], ["Method not stated", rows.filter((r) => r.comp === null).length]] as const) {
      expect(html).toContain(`<td data-label="Competitive or not">${label}</td><td data-label="Records" class="mono num">${n}</td>`);
    }
    const number = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=none&measure=records&source=history&from=2024&to=2026&show=number")).html;
    expect(number).toContain(`<span class="tile-value">${rows.length}</span>`);
  });

  it("follow the radar's contracts ending: eight quarters by rec_due, four by rec_expiring for a buyer in a segment", async () => {
    const rec = recording(RECORDS);
    const buyer = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=quarter&measure=ending&show=table", { env: onWith({ RECORDS: rec.binding }) })).html;
    expect(rec.batches.at(-1)).toEqual([STATE_SQL, BUYER_DUE_SQL]);
    expect(buyer.match(/<tr><td data-label="Fiscal quarter"/g)).toHaveLength(8);
    for (const d of DUE.filter((x) => x.bid === PSPC)) expect(buyer).toContain(`<td data-label="Value" class="mono num">${money(d.cents)}</td>`);
    expect(decode(buyer)).toContain("Contracts ending by the radar's rule, each contract once across the three contract sources, as of 2026-10-31.");
    expect(buyer).not.toContain("Figures from");

    const both = (await view("?subject=buyer_segment&b=pwgsc-tpsgc&s=82&rows=quarter&measure=ending&show=table", { env: onWith({ RECORDS: rec.binding }) })).html;
    expect(rec.batches.at(-1)).toEqual([STATE_SQL, EXPIRING_QUARTERS_SQL]);
    expect(both.match(/<tr><td data-label="Fiscal quarter"/g)).toHaveLength(4);
    // 2027-09-30 falls in the fifth quarter from 2026-10-31: left out.
    const four = EXPIRING.filter((e) => e.buyer === "pwgsc-tpsgc" && e.segs.includes(" 82 ") && e.endd <= "2027-06-30");
    expect(both).toContain(`<td data-label="Contracts" class="mono num">${four.filter((e) => e.endd < "2027-01-01").length}</td>`);

    // Drawn, two charts, as the views' due panel draws them: the value of the contracts ending on its own scale
    // (110 px), then their count on another (80 px), each with a bar for the quarters that hold one: PSPC's Q3 2026-27
    // (2 contracts, $7,500,000) and Q1 2027-28 (3 contracts, $1,250,000).
    const drawn = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=quarter&measure=ending&show=bars")).html;
    const stacks = [...drawn.matchAll(/<div class="chart-stack">([\s\S]*?)<div class="chart-row" aria-hidden="true"><span><\/span><div class="chart-x">/g)].map((m) => m[1]);
    expect(stacks).toHaveLength(2);
    expect(stacks[0]).toContain('<div class="chart-title">Value of the contracts ending</div>');
    expect(stacks[0]).toContain('style="height:110px"');
    expect(stacks[1]).toContain('<div class="chart-title">Contracts ending</div>');
    expect(stacks[1]).toContain('style="height:80px"');
    for (const s of stacks) expect(s.match(/<title>/g), s.slice(0, 80)).toHaveLength(2);
    // Each tip: the series and the quarter on one line, the count under it.
    expect(stacks[1]).toMatch(/<title>Contracts ending, Q3 2026-27\s2 contracts<\/title>/);
    expect(stacks[1]).toMatch(/<title>Contracts ending, Q1 2027-28\s3 contracts<\/title>/);

    const segs = (await view("?subject=all&rows=segment&measure=ending")).html;
    expect(segs).toContain(`<td data-label="Value" class="mono num">${money(2_000_000_00)}</td>`);
    const bySeg = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=segment&measure=ending")).html;
    expect(bySeg).toContain('<a href="/segments/43"><span class="mono">43</span>');
  });

  it("add only what can be added: a median, a count of organizations and the largest shares never over two years", () => {
    const a = { n: 2, med: 5, n_orgs: 3, top1: 4, cents: 10 };
    const b = { n: 1, med: 7, n_orgs: 2, top1: 1, cents: null };
    expect(sumFigures([a, b])).toEqual({ n: 3, cents: 10 });
    expect(sumFigures([a])).toEqual(a);
  });
});

// -- the menus -------------------------------------------------------------------------------------

const choice = (c: Partial<BuildChoice>): BuildChoice => ({
  subject: "all", buyers: [], segment: "", orgs: [], rows: "year", measure: "value", source: "awards", first: 2022, last: 2026, capped: false,
  show: "bars", top: 10, ...c,
});
// A choice that names what its subject needs.
const named = (subject: string): Partial<BuildChoice> => ({
  subject: subject as BuildChoice["subject"],
  buyers: subject === "buyers" ? ["pwgsc-tpsgc", "dfo-mpo"] : ["buyer", "buyer_segment"].includes(subject) ? ["pwgsc-tpsgc"] : [],
  segment: ["segment", "buyer_segment"].includes(subject) ? "82" : "",
  orgs: subject === "organizations" ? [ORGS[0], ORGS[1]] : subject === "organization" ? [ORGS[0]] : [],
});
const REUSED = [BUYER_QUARTERS_SQL, BUYER_DUE_SQL, SEGMENT_DUE_SQL];
const placeholders = (sql: string) => Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));

describe("the menus", () => {
  it("offer each cell of the matrix and no other: an offered cell reads its statements, an absent one reads nothing and says why", { timeout: 30_000 }, async () => {
    const ids = new Set(["pwgsc-tpsgc", "dfo-mpo", "dnd-mdn"]);
    let offered = 0;
    let absent = 0;
    for (const subject of SUBJECTS) {
      for (const rows of ROWS) {
        for (const measure of MEASURES) {
          const span = longestSpan({ rows, measure }, BUILD_YEARS) ?? BUILD_YEARS;
          const c = choice({ ...named(subject), rows: rows as BuildChoice["rows"], measure: measure as BuildChoice["measure"], first: 2026 - Math.min(span, 5) + 1, last: 2026 });
          const sources = sourcesFor(c);
          if (!cellOffered(rows, measure, subject)) {
            absent++;
            for (const source of SOURCES) expect(buildProblem({ ...c, source: source as BuildChoice["source"] }, ids)?.kind, `${subject} ${rows} ${measure}`).toBe("not_offered");
            continue;
          }
          offered++;
          expect(sources.length, `${subject} ${rows} ${measure}`).toBeGreaterThan(0);
          for (const source of SOURCES) {
            const one = { ...c, source: source as BuildChoice["source"] };
            const problem = buildProblem(one, ids);
            if (!sources.includes(source)) {
              expect(problem, `${subject} ${rows} ${measure} ${source}`).toEqual({ kind: "not_offered", key: "build.why_source" });
              continue;
            }
            expect(problem, `${subject} ${rows} ${measure} ${source}`).toBeNull();
            const plan = buildPlan(one, { current: 2026, day: "2026-10-31" });
            expect(plan.queries.length, `${subject} ${rows} ${measure}`).toBeGreaterThan(0);
            expect(plan.queries.length).toBeLessThanOrEqual(2);
            for (const q of plan.queries) {
              expect([...BUILD_SQL, ...REUSED], q.sql).toContain(q.sql);
              expect(q.params.length, q.sql).toBe(placeholders(q.sql));
            }
            // The statements run on the database, in one batch with the state row (and cube_meta for a cube).
            const read = await readRecords({ RECORDS } as never, plan.cubes ? [{ sql: CUBE_META_SQL, params: [] }, ...plan.queries] : plan.queries);
            expect(read.state, `${subject} ${rows} ${measure} ${source}`).toBe("ready");
            if (read.state === "ready") plan.read(plan.cubes ? read.rows.slice(1) : read.rows);
          }
        }
      }
    }
    // 210 of the 567 cells: 48 by fiscal year, 51 as one figure, 26 each by segment and by buyer, 20 by province, 16 by
    // organization, 10 competitive or not, 9 by quarter, 4 by method.
    expect([offered, absent]).toEqual([210, SUBJECTS.length * ROWS.length * MEASURES.length - 210]);
  });

  it("hold the rules: one source, the unaddable figures by year or for one year, quarters for five years at most", () => {
    expect(whyNot({ subject: "all", rows: "segment", measure: "median", source: "awards", first: 2025, last: 2026 }, ULTRA_YEARS)).toEqual({ key: "build.why_sum" });
    expect(whyNot({ subject: "all", rows: "segment", measure: "median", source: "awards", first: 2026, last: 2026 }, ULTRA_YEARS)).toBeNull();
    expect(whyNot({ subject: "all", rows: "year", measure: "median", source: "awards", first: 2007, last: 2026 }, ULTRA_YEARS)).toBeNull();
    expect(whyNot({ subject: "all", rows: "none", measure: "largest", source: "awards", first: 2025, last: 2026 }, ULTRA_YEARS)).toEqual({ key: "build.why_sum" });
    expect(whyNot({ subject: "buyer", rows: "quarter", measure: "value", source: "awards", first: 2021, last: 2026 }, ULTRA_YEARS)).toEqual({ key: "build.why_quarters", n: 5 });
    expect(whyNot({ subject: "buyer", rows: "quarter", measure: "value", source: "awards", first: 2022, last: 2026 }, ULTRA_YEARS)).toBeNull();
    for (const source of ["contracts", "grants"]) {
      for (const c of [{ subject: "segment", rows: "year", measure: "value" }, { subject: "all", rows: "province", measure: "value" }, { subject: "all", rows: "year", measure: "amendments" }]) {
        expect(whyNot({ ...c, source, first: 2026, last: 2026 }, ULTRA_YEARS), `${source} ${JSON.stringify(c)}`).toEqual({ key: "build.why_source" });
      }
    }
    for (const c of [{ subject: "all", rows: "year", measure: "noncompetitive" }, { subject: "buyer", rows: "method", measure: "value" }, { subject: "all", rows: "competitive", measure: "records" }]) {
      expect(whyNot({ ...c, source: "grants", first: 2026, last: 2026 }, ULTRA_YEARS)).toEqual({ key: "build.why_source" });
      expect(whyNot({ ...c, source: "contracts", first: 2026, last: 2026 }, ULTRA_YEARS)).toBeNull();
    }
    // The contracts ending follow the radar whatever the source and period.
    expect(whyNot({ subject: "buyer", rows: "quarter", measure: "ending", source: "grants", first: 2007, last: 2026 }, ULTRA_YEARS)).toBeNull();
  });

  it("read a set as buyers or organizations, never both, each once, at most five; and an address back to itself", () => {
    const url = (q: string) => new URL(`https://x.invalid${PATH}?${q}`);
    const many = readBuild(url(`subject=buyers&${["a-b", "c-d", "a-b", "e-f", "g-h", "i-j", "k-l", "Bad id"].map((b) => `b=${encodeURIComponent(b)}`).join("&")}&o=${ORGS[0]}`), 2026);
    expect(many.buyers).toEqual(["a-b", "c-d", "e-f", "g-h", "i-j"]);
    expect(many.buyers.length).toBe(SET_MAX);
    expect(buildQuery(many)).not.toMatch(/(^|&)o=/);
    const orgs = readBuild(url(`subject=organizations&o=${ORGS[0]}&o=${ORGS[0]}&o=${ORGS[1]}&b=pwgsc-tpsgc`), 2026);
    expect(orgs.orgs).toEqual([ORGS[0], ORGS[1]]);
    expect(buildQuery(orgs)).not.toMatch(/(^|&)b=/);
    // The longest period is Ultra's figure, the latest of a longer one kept and said.
    const long = readBuild(url("subject=all&from=2000&to=2026"), 2026);
    expect([long.first, long.last, long.capped]).toEqual([2026 - ULTRA_YEARS + 1, 2026, true]);
    for (const q of [
      "subject=all&rows=year&measure=value&source=awards&from=2017&to=2026&show=bars",
      "subject=buyer_segment&b=pwgsc-tpsgc&s=82&rows=organization&measure=noncompetitive&source=history&from=2024&to=2026&show=ranked&top=25",
      "subject=segment&s=43&rows=quarter&measure=ending&show=line",
    ]) expect(buildQuery(readBuild(url(q), 2026))).toBe(q);
  });

  it("answer a combination the matrix does not hold with its reason, reading nothing", async () => {
    const cases: [string, string][] = [
      ["?subject=organization&o=org-a000000001&rows=segment&measure=value&source=history", "This combination is not offered: these rows are not offered for this subject."],
      ["?subject=all&rows=method&measure=value&source=history", "This combination is not offered: these rows are not offered for this subject."],
      ["?subject=all&rows=province&measure=largest&source=history&from=2026&to=2026", "This combination is not offered: this figure is not offered by these rows for this subject."],
      ["?subject=all&rows=segment&measure=median&source=history&from=2024&to=2026", "This combination is not offered: a median, a count of organizations or a share of the largest organizations cannot be added across years, so choose one fiscal year."],
      ["?subject=all&rows=segment&measure=value&source=grants", "This combination is not offered: Grants and contributions does not record this."],
      ["?subject=buyer&b=pwgsc-tpsgc&rows=quarter&measure=value&source=history&from=2017&to=2026", "This combination is not offered: fiscal quarters are offered for periods of up to 5 fiscal years."],
      ["?subject=buyer&b=no-such-buyer", "Choose a buyer from the list to see its figures."],
      ["?subject=segment", "Choose a segment to see its figures."],
      ["?subject=organization&o=nobody", "Enter an organization's id or the address of its page to see its figures."],
    ];
    for (const [query, line] of cases) {
      const records = trap<D1Database>("the records database");
      const { res, html } = await view(query, { env: onWith({ RECORDS: records.binding }) });
      expect(res.status, query).toBe(200);
      expect(decode(html), query).toContain(line);
      expect(html, query).not.toContain("/analytics/build.csv?");
      expect(records.used, query).toEqual([]);
      expect((await get(`${CSV}${query}`, { cookie: (await readers()).ultra, env: onWith({ RECORDS: records.binding }) })).status).toBe(404);
    }
  });
});

// -- the statements --------------------------------------------------------------------------------

describe("the statements", () => {
  it("each read through an index and end in a LIMIT", async () => {
    const binds = (sql: string): (string | number)[] => {
      if (sql === CUBE_META_SQL) return [];
      const json = sql.includes("json_each(?1)") ? (sql.includes("FROM cube") || sql.includes("rec_buyers WHERE id IN") ? JSON.stringify(["pwgsc-tpsgc"]) : JSON.stringify([oid(ORGS[0])])) : null;
      const n = placeholders(sql);
      const out: (string | number)[] = [];
      for (let i = 1; i <= n; i++) out.push(i === 1 && json ? json : i === 1 && /buyer = \?1|id = \?1/.test(sql) ? "pwgsc-tpsgc" : i === 1 && sql.includes("instr(segs, ?1)") ? " 82 " : 2025);
      return out;
    };
    for (const sql of BUILD_SQL) {
      expect(sql, sql).toMatch(/LIMIT (?:\d+|\?\d+)$/);
      const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds(sql)).all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail));
      const full = steps.filter((s) => /^SCAN (records|rec_\w+|cube_\w+)\b/.test(s) && !/USING/.test(s));
      expect(full, `${sql}\n${steps.join("\n")}`).toEqual([]);
      if (sql === CUBE_META_SQL) continue;
      const named = ["cube_bs_buyer", "cube_bs_segment", "cube_place_buyer", "cube_place_segment", "records_buyer", "records_org", "records_segment",
        "rec_due_buyer", "rec_due_segment", "rec_expiring_buyer", "rec_expiring_end", "sqlite_autoindex_rec_buyers_1"];
      expect(steps.some((s) => named.some((ix) => s.includes(` ${ix}`)) || /USING INTEGER PRIMARY KEY/.test(s)), `${sql}\n${steps.join("\n")}`).toBe(true);
    }
    // The bounds: a period of at most ULTRA_YEARS, five subjects, the largest top N.
    expect(CELL_YEARS_SQL).toMatch(new RegExp(`LIMIT ${ULTRA_YEARS}$`));
    expect(BUYERS_YEARS_SQL).toMatch(new RegExp(`LIMIT ${SET_MAX * ULTRA_YEARS}$`));
    expect(TOP_BUYERS_SQL).toMatch(/LIMIT 25$/);
    expect(SEGMENTS_SQL).toMatch(/LIMIT 57$/);
    expect(PLACE_ALL_SQL).toMatch(/LIMIT 14$/);
  });

  it("send one batch a page view: the state row, cube_meta for a cube, and the view's statements", async () => {
    for (const query of [
      "?subject=all&rows=segment&measure=median&source=history&from=2026&to=2026",
      "?subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&rows=province&measure=value&source=awards&from=2024&to=2026",
      "?subject=organizations&o=org-a000000001&o=org-e000000002&rows=organization&measure=amendments&source=history&from=2024&to=2026",
      "?subject=segment&s=82&rows=method&measure=records&source=history&from=2022&to=2026",
    ]) {
      const rec = recording(RECORDS);
      const { res } = await view(query, { env: onWith({ RECORDS: rec.binding }) });
      expect(res.status, query).toBe(200);
      expect(rec.batches, query).toHaveLength(1);
      expect(rec.batches[0][0]).toBe(STATE_SQL);
      expect(rec.batches[0].length, query).toBeLessThanOrEqual(4);
    }
  });
});

// -- a database without the cubes ---------------------------------------------------------------------

describe("without the cubes", () => {
  it("says the figures cannot be read, never a 500, and still draws a view that reads records alone", async () => {
    try {
      for (const o of [{ cubes: false }, { cubeDate: null }, { state: "loading" }]) {
        await seedBuilder(o);
        const { res, html } = await view("?subject=all&rows=year&measure=value&source=history");
        expect(res.status, JSON.stringify(o)).toBe(503);
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        expect(decode(html)).toContain("The builder's figures cannot be read right now.");
        const records = await view("?subject=segment&s=82&rows=method&measure=records&source=history&from=2022&to=2026");
        expect(records.res.status, JSON.stringify(o)).toBe(o.state === "loading" ? 503 : 200);
        const csv = await get(`${CSV}?subject=all&rows=year&measure=value&source=history`, { cookie: (await readers()).ultra, env: onWith() });
        expect(csv.status).toBe(503);
      }
    } finally {
      await seedBuilder();
    }
  });
});

// -- the page --------------------------------------------------------------------------------------------

describe("the page", () => {
  it("answers the preview with the result alone, private, marked as a fragment", async () => {
    const { res, html } = await view("?subject=buyer&b=pwgsc-tpsgc&rows=year&measure=value&source=history&from=2022&to=2026", { headers: { "x-build-fragment": "1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-build-fragment")).toBe("1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(html.startsWith('<div id="build-result" aria-live="polite"><section class="panel">')).toBe(true);
    expect(html).not.toContain("<html");
    // The menus are the page's, never the fragment's: what it holds of forms is the view's own posts (Add to
    // dashboard, Save this view, test/builder-tiles.test.ts), redrawn with it.
    expect(html).not.toContain('<form method="get"');
    expect([...html.matchAll(/<form method="post" action="([^"]+)"/g)].map((m) => m[1])).toEqual(["/account/dashboard/panels", "/account/dashboard/panels", "/account/views"]);
  });

  it("names the source in lower case with its article, and the link by where it leads, in both languages", async () => {
    const cases = [
      ["awards", "Figures from the award notices, fiscal years 2024-25 to 2026-27", "Chiffres tirés des avis d’attribution, exercices 2024-2025 à 2026-2027"],
      ["history", "Figures from the PSPC contract history, fiscal years 2024-25 to 2026-27", "Chiffres tirés de l’historique des contrats de SPAC, exercices 2024-2025 à 2026-2027"],
      ["contracts", "Figures from the published contracts, fiscal years 2024-25 to 2026-27", "Chiffres tirés des contrats publiés, exercices 2024-2025 à 2026-2027"],
      ["grants", "Figures from the grants and contributions, fiscal years 2024-25 to 2026-27", "Chiffres tirés des subventions et contributions, exercices 2024-2025 à 2026-2027"],
    ] as const;
    for (const [source, en, fr] of cases) {
      const ask = `?subject=all&rows=year&measure=records&source=${source}&from=2024&to=2026`;
      const eng = decode((await view(ask)).html);
      expect(eng, source).toContain(en);
      expect(eng).toContain('How the figures are counted: <a href="/methodology#analytics">the Analytics section of the Methodology page</a>.');
      const fre = nbsp(decode((await view(`${ask}&lang=fr`)).html));
      expect(fre, source).toContain(fr);
      expect(fre).toContain('Méthode de calcul des chiffres : <a href="/methodology#analytics">la section Analyses de la page Méthodologie</a>.');
    }
  });

  it("sets a figure's head over its numbers where it takes the widest column, and leaves a row with no figure out of the bars", async () => {
    // Every buyer's value by fiscal year: no column of words, so the value takes the room left; its head is a figure's.
    const years = (await view("?subject=all&rows=year&measure=value&source=awards&from=2024&to=2026")).html;
    expect(years).toContain('<th class="k-main num"><button type="button" class="th-sort">Value</button></th>');
    // The contracts ending by quarter: the count takes it.
    const ending = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=quarter&measure=ending&show=table")).html;
    expect(ending).toContain('<th class="k-main num"><button type="button" class="th-sort">Contracts</button></th>');
    // With a column of words, the words keep the room and no figure's head is main.
    const segs = (await view("?subject=all&rows=segment&measure=value&source=history&from=2022&to=2026")).html;
    expect(segs).not.toContain('class="k-main num"');
    // PSPC's contract history by procurement method: open bidding and non-competitive records with values, and one
    // record a year (2022-23 to 2026-27) naming no method and publishing no value. The bars: the two methods; the
    // table: the three rows, the last "Method not stated" with its value not stated.
    const methods = (await view("?subject=buyer&b=pwgsc-tpsgc&rows=method&measure=value&source=history&from=2022&to=2026&show=ranked")).html;
    const bars = methods.slice(methods.indexOf('<ol class="rank-bars"'), methods.indexOf("</ol>"));
    expect(bars.match(/<li /g)).toHaveLength(2);
    expect(bars).toContain("Open bidding");
    expect(bars).toContain("Non-competitive");
    expect(bars).not.toContain("Method not stated");
    expect(bars).not.toContain("Not stated");
    expect(methods.match(/<tr><td data-label="Procurement method">/g)).toHaveLength(3);
    const unstated = RECS.filter((x) => x.bid === PSPC && x.src === 2 && x.extra === 0 && x.meth === null);
    expect(unstated.map((x) => x.cents)).toEqual([null, null, null, null, null]);
    expect(methods).toContain(`<tr><td data-label="Procurement method">Method not stated</td><td data-label="Value" class="mono num">Not stated</td><td data-label="Records" class="mono num">${unstated.length}</td>`);
  });

  it("sets the form's fields level, the long menus wide, the boxes to compare two to a row with what each takes, each menu its row on a phone", async () => {
    const orgs = (await view("?subject=organizations&o=org-a000000001&rows=year&measure=value&source=history")).html;
    // The four boxes to compare, empty, each saying what it takes; the subject's own box has its hint instead.
    expect(orgs.match(/<input type="text" name="o" value="" [^>]*placeholder="org-… or its page&#39;s address"\/>/g)).toHaveLength(4);
    const form = orgs.slice(orgs.indexOf('<form method="get" action="/analytics/build"'), orgs.indexOf("</form>", orgs.indexOf('<form method="get" action="/analytics/build"')));
    expect(form.match(/placeholder=/g)).toHaveLength(4);
    const fr = nbsp(decode((await view("?lang=fr&subject=organizations&o=org-a000000001&rows=year&measure=value&source=history")).html));
    expect(fr.match(/placeholder="org-… ou l’adresse de sa page"/g)).toHaveLength(4);
    const buyer = (await view("?subject=buyer_segment&b=pwgsc-tpsgc&s=82&rows=year&measure=value&source=history")).html;
    expect(buyer).toContain('<label class="field field-wide" data-for="buyer"><span class="field-label">Buyer</span><select name="b">');
    expect(buyer).toContain('<label class="field field-wide" data-for="segment"><span class="field-label">Segment</span><select name="s">');
    const styles = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
    for (const rule of [
      ".build-form .toolbar-fields { align-items: flex-start; }", ".build-form .toolbar-actions { align-self: flex-end; }",
      ".toolbar-fields .field.field-wide { max-width: 480px; }", ".build-form fieldset.toolbar-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }",
      "  .build-form .field:not(.field-code) { grid-column: 1 / -1; }\n  .build-form .toolbar-fields .field { max-width: none; }",
    ]) expect(styles.replace(/\r\n/g, "\n"), rule).toContain(rule);
  });

  it("offers no action on a view with no record: no CSV file, no Add to dashboard, no figure to add, no Save", async () => {
    // National Defence holds no award notice in the fixture (its records are published contracts and a grant).
    const empty = "?subject=buyer&b=dnd-mdn&rows=year&measure=value&source=awards&from=2022&to=2026&show=bars";
    expect(RECS.filter((x) => x.bid === DND && x.src === 1)).toEqual([]);
    for (const lang of ["", "&lang=fr"]) {
      for (const headers of [undefined, { "x-build-fragment": "1" }]) {
        const { res, html } = await view(`${empty}${lang}`, { headers });
        expect(res.status).toBe(200);
        expect(html).toContain(lang ? "Aucun dossier pour cette vue et ces exercices." : "No record of this view in these fiscal years.");
        for (const absent of ["/analytics/build.csv", 'method="post"', "/account/dashboard/panels", "/account/views", 'class="panel-tools"']) expect(html, `${lang} ${absent}`).not.toContain(absent);
      }
    }
    // The same view with records offers all three, the figure's included (one subject by fiscal year).
    const { html } = await view(empty.replace("dnd-mdn", "dfo-mpo"));
    expect([...html.matchAll(/<form method="post" action="([^"]+)"/g)].map((m) => m[1])).toEqual(["/account/dashboard/panels", "/account/dashboard/panels", "/account/views"]);
    expect(html).toContain("/analytics/build.csv?");
  });

  it("offers no action on a view whose lines count no record: a set by its own rows, competitive or not, and its CSV file as an empty view's", async () => {
    // PSPC and Fisheries and Oceans give no grant in the fixture, National Defence holds no award notice, Builder Org 1
    // Ltd. holds no grant: each line is drawn for a subject the period holds nothing of.
    expect(RECS.filter((x) => (x.bid === PSPC || x.bid === DFO) && x.src === 4)).toEqual([]);
    expect(RECS.filter((x) => x.oid === oid(ORGS[0]) && x.src === 4)).toEqual([]);
    const views = [
      "?subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&rows=buyer&measure=value&source=grants&from=2017&to=2026&show=ranked",
      "?subject=buyers&b=dnd-mdn&rows=buyer&measure=value&source=awards&from=2022&to=2026&show=ranked",
      `?subject=organizations&o=${ORGS[0]}&rows=organization&measure=value&source=grants&from=2022&to=2026&show=ranked`,
      "?subject=buyer&b=dnd-mdn&rows=competitive&measure=value&source=awards&from=2022&to=2026&show=ranked",
      "?subject=all&rows=competitive&measure=records&source=awards&from=2007&to=2010&show=table",
    ];
    for (const q of views) {
      for (const lang of ["", "&lang=fr"]) {
        for (const headers of [undefined, { "x-build-fragment": "1" }]) {
          const { res, html } = await view(`${q}${lang}`, { headers });
          expect(res.status, q).toBe(200);
          const end = html.indexOf("</main>");
          const result = html.slice(html.indexOf('<div id="build-result"'), end > 0 ? end : undefined);
          expect(result, `${q}${lang}`).toContain(lang ? "Aucun dossier pour cette vue et ces exercices." : "No record of this view in these fiscal years.");
          for (const absent of ["/analytics/build.csv", 'method="post"', "/account/dashboard/panels", "/account/views", 'class="panel-tools"', '<ol class="rank-bars"', "<table"]) {
            expect(result, `${q}${lang} ${absent}`).not.toContain(absent);
          }
        }
      }
      // Its file is the head alone, as a view with no line's is.
      const csv = await get(`${CSV}${q}`, { cookie: (await readers()).ultra, env: onWith() });
      expect(csv.status, q).toBe(200);
      expect((await csv.text()).trim().split("\r\n"), q).toHaveLength(1);
    }
    const plain = await get(`${CSV}?subject=buyer&b=dnd-mdn&rows=year&measure=value&source=awards&from=2022&to=2026&show=bars`, { cookie: (await readers()).ultra, env: onWith() });
    expect((await plain.text()).trim().split("\r\n")).toHaveLength(1);
  });

  it("gives the view as a CSV file, private, a download under the per-address limit, its rows and their counts", async () => {
    const { ultra } = await readers();
    const res = await get(`${CSV}?subject=all&rows=segment&measure=value&source=history&from=2022&to=2026`, { cookie: ultra, env: onWith() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="build-all-segment-value-history-2022-2026.csv"');
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe("subject_id,subject,row,row_label,source,first_fiscal_year,last_fiscal_year,records,value_cad,records_without_value");
    const s82 = RECS.filter((r) => r.sid === 82 && r.src === 2);
    expect(lines).toContain(`all,,82,Editorial and Design and Graphic and Fine Art Services,history,2022,2026,${s82.length},${(s82.reduce((s, r) => s + (r.cents ?? 0), 0) / 100).toFixed(2)},${s82.filter((r) => r.vnote === 1).length}`);
    expect(bucketFor("GET", CSV)).toBe("download");
    expect(bucketFor("HEAD", CSV)).toBe("page");
    expect(bucketFor("GET", PATH)).toBe("page");
    expect(routeTemplate("GET", PATH)).toEqual({ route: PATH, kind: "page" });
    expect(routeTemplate("GET", CSV)).toEqual({ route: CSV, kind: "download" });
  });

  it("reads in French, with no English left, no em or en dash, and every string in both languages", async () => {
    const { html } = await view("?lang=fr&subject=buyer&b=pwgsc-tpsgc&rows=segment&measure=noncompetitive&source=history&from=2022&to=2026");
    expect(html).toContain('<html lang="fr">');
    for (const text of ["Générateur d\u2019analyses", "Part non concurrentielle, en nombre et en valeur", "Chiffres tirés de l\u2019historique des contrats de SPAC", "Afficher cette vue"]) expect(decode(html)).toContain(text);
    for (const english of ["Show this view", "Figures from", "Rows shown", "Every buyer", "not added together"]) expect(html).not.toContain(english);
    expect(html).not.toContain(EM_DASH);
    expect(html).not.toContain(EN_DASH);
    for (const key of Object.keys(BUILDER_STRINGS)) {
      const { en, fr } = rawEntry(key as never);
      for (const s of [en, fr]) {
        expect(s, key).not.toContain(EM_DASH);
        expect(s, key).not.toContain(EN_DASH);
      }
      expect(allKeys()).toContain(key);
    }
  });

  it("uses no evaluative word, in its strings or on any view", async () => {
    const FORBIDDEN = /\b(dominant|dominan\w*|domine\w*|concentration|risk|risque|best|worst|meilleur\w*|pire|leader\w*|top performer|winner|gagnant\w*|monopol\w*|excessive?|suspicious|suspect\w*|unfair|abusi\w*)\b/i;
    for (const key of Object.keys(BUILDER_STRINGS)) {
      const { en, fr } = rawEntry(key as never);
      expect(en, key).not.toMatch(FORBIDDEN);
      expect(fr, key).not.toMatch(FORBIDDEN);
    }
    for (const query of ["?subject=all&rows=buyer&measure=largest&source=history&from=2026&to=2026", "?lang=fr&subject=all&rows=year&measure=largest&source=history"]) {
      const text = (await view(query)).html.replace(/<[^>]*>/g, " ");
      expect(text).not.toMatch(FORBIDDEN);
    }
  });

  it("fits every table to its column from 700 px, and draws at most six columns", { timeout: 30_000 }, async () => {
    const queries = [
      "subject=all&rows=year&measure=value&source=history&from=2007&to=2026",
      "subject=buyer&b=pwgsc-tpsgc&rows=year&measure=noncompetitive&source=history",
      "subject=buyer&b=pwgsc-tpsgc&rows=year&measure=largest&source=history",
      "subject=buyer&b=pwgsc-tpsgc&rows=year&measure=amendments&source=history",
      "subject=buyer&b=pwgsc-tpsgc&rows=quarter&measure=value&source=history&from=2022&to=2026",
      "subject=buyer&b=pwgsc-tpsgc&rows=quarter&measure=ending",
      "subject=all&rows=segment&measure=noncompetitive&source=history",
      "subject=all&rows=segment&measure=largest&source=history&from=2026&to=2026",
      "subject=all&rows=buyer&measure=amendments&source=history",
      "subject=buyer&b=pwgsc-tpsgc&rows=organization&measure=noncompetitive&source=history",
      "subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&rows=year&measure=largest&source=awards",
      "subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&rows=year&measure=amendments&source=awards",
      "subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&rows=segment&measure=noncompetitive&source=awards",
      "subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&rows=province&measure=average&source=awards",
      "subject=organizations&o=org-a000000001&o=org-e000000002&rows=year&measure=noncompetitive&source=history",
      "subject=all&rows=none&measure=largest&source=history&from=2026&to=2026&show=number",
      "subject=all&rows=competitive&measure=value&source=history",
      "subject=segment&s=82&rows=method&measure=value&source=history",
    ];
    for (const lang of ["en", "fr"]) {
      for (const q of queries) {
        const { html } = await view(`?${q}&lang=${lang}`);
        const tables = tablesIn(html);
        expect(tables.length, q).toBe(1);
        expect(html.match(/<th class="k-/g)!.length, q).toBeLessThanOrEqual(6);
        expect(misfits(html), `${lang} ${q}`).toEqual([]);
      }
    }
  });
});

// -- the form, the link from the views and robots.txt -------------------------------------------------

// The field groups the form draws, each as shown or hidden, and whether every control in it is disabled.
function groups(html: string): Record<string, { hidden: boolean; disabled: boolean }> {
  const start = html.indexOf('<form method="get" action="/analytics/build"');
  const form = html.slice(start, html.indexOf("</form>", start));
  const out: Record<string, { hidden: boolean; disabled: boolean }> = {};
  for (const m of form.matchAll(/<(label|fieldset)([^>]*) data-for="([a-z]+)"([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const attrs = `${m[2]} ${m[4]}`;
    const controls = [...m[5].matchAll(/<(?:select|input)\b[^>]*>/g)].map((c) => c[0]);
    const prior = out[m[3]];
    const here = { hidden: /\bhidden=""/.test(attrs), disabled: controls.length > 0 && controls.every((c) => /\bdisabled=""/.test(c)) };
    out[m[3]] = prior ? { hidden: prior.hidden && here.hidden, disabled: prior.disabled && here.disabled } : here;
  }
  return out;
}

describe("the form", () => {
  it("draws hidden and disabled every group the view does not use, and shows the ones it does", async () => {
    const cases: [string, string[]][] = [
      ["", ["period"]],
      ["?subject=buyer&b=pwgsc-tpsgc&rows=organization&measure=value&source=history", ["buyer", "period", "top"]],
      ["?subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&rows=segment&measure=value&source=awards", ["buyer", "buyers", "period", "top"]],
      ["?subject=buyers&b=pwgsc-tpsgc&b=dfo-mpo&rows=buyer&measure=value&source=awards", ["buyer", "buyers", "period"]],
      ["?subject=buyer_segment&b=pwgsc-tpsgc&s=82&rows=quarter&measure=ending", ["buyer", "segment"]],
      ["?subject=organizations&o=org-a000000001&rows=year&measure=value&source=history", ["org", "orgs", "period"]],
      ["?subject=segment&s=82&rows=province&measure=records&source=history", ["segment", "period", "top"]],
    ];
    const all = ["buyer", "buyers", "segment", "org", "orgs", "period", "top"];
    // An Ultra reader's form (a reader without Ultra sees the sample's, test "a reader without Ultra").
    for (const [query, shown] of cases) {
      for (const cookie of [(await readers()).ultra]) {
        const g = groups((await view(query, { cookie })).html);
        expect(Object.keys(g).sort(), query).toEqual([...all].sort());
        for (const name of all) {
          const on = shown.includes(name);
          expect(g[name], `${query} ${name}`).toEqual({ hidden: !on, disabled: !on });
        }
      }
    }
  });

  it("names each figure alone in its menu, the rows only in the view's title: the contracts ending by each of their rows", async () => {
    // The contracts ending are offered by fiscal quarter, segment and buyer, and for the period (MATRIX); their menu
    // name says nothing of quarters, as no other figure's names its rows.
    expect(ROWS.filter((rows) => cellOffered(rows, "ending", "buyer") || cellOffered(rows, "ending", "all"))).toEqual(["quarter", "segment", "buyer", "none"]);
    for (const [lang, option, titles] of [
      ["en", "Contracts ending", ["Contracts ending by fiscal quarter", "Contracts ending by segment", "Contracts ending by buyer", "Contracts ending"]],
      ["fr", "Contrats prenant fin", ["Contrats prenant fin par trimestre d’exercice", "Contrats prenant fin par segment", "Contrats prenant fin par acheteur", "Contrats prenant fin"]],
    ] as const) {
      const q = lang === "fr" ? "&lang=fr" : "";
      const asks = ["?subject=buyer&b=pwgsc-tpsgc&rows=quarter&measure=ending", "?subject=all&rows=segment&measure=ending", "?subject=all&rows=buyer&measure=ending",
        "?subject=buyer&b=pwgsc-tpsgc&rows=none&measure=ending&show=table"];
      for (const [i, ask] of asks.entries()) {
        const { html } = await view(`${ask}${q}`);
        expect(html, ask).toContain(`<option value="ending" selected="">${option}</option>`);
        expect(html, ask).toContain(`<h2>${titles[i]}</h2>`);
      }
    }
  });

  it("offers each buyer by name in the page's language, the id as the value, first the empty choice, in every buyer menu", async () => {
    for (const lang of ["en", "fr"] as const) {
      const { html } = await view(`?lang=${lang}&subject=buyers&b=dfo-mpo&b=pwgsc-tpsgc&rows=year&measure=value&source=awards`);
      const menus = [...html.matchAll(/<select name="b"[^>]*>([\s\S]*?)<\/select>/g)].map((m) => m[1]);
      expect(menus).toHaveLength(SET_MAX);
      const first = new RegExp(`^<option value=""(?: selected="")?>${lang === "fr" ? "Choisir un acheteur" : "Choose a buyer"}</option>`);
      const names = lang === "fr" ? ["Pêches et Océans Canada", "Services publics et Approvisionnement Canada"] : ["Fisheries and Oceans Canada", "Public Services and Procurement Canada"];
      for (const menu of menus) {
        expect(decode(menu)).toMatch(first);
        const options = [...decode(menu).matchAll(/<option value="([a-z-]+)"(?: selected="")?>([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]);
        expect(options.map(([, n]) => n)).toEqual(names);
        expect(options.map(([id]) => id)).toEqual(["dfo-mpo", "pwgsc-tpsgc"]);
      }
      // The subject's menu holds the first buyer, the first box to compare the second, the others none.
      expect(menus[0]).toContain('<option value="dfo-mpo" selected="">');
      expect(menus[1]).toContain('<option value="pwgsc-tpsgc" selected="">');
      for (const menu of menus.slice(2)) expect(menu).toContain('<option value="" selected="">');
      expect(html).not.toContain("<datalist");
    }
    // The organization's hint is beside its own field, and only there.
    const orgs = (await view("?subject=organization&o=org-a000000001&rows=year&measure=value&source=history")).html;
    expect(orgs.match(/class="field-hint"/g)).toHaveLength(1);
    // For an Ultra reader, the dashboard's find page, whose matches open here (test/builder-tiles.test.ts).
    expect(orgs).toMatch(/<label class="field field-text" data-for="org"><span class="field-label">Organization<\/span><input type="text" name="o"[^>]*><span class="field-hint">Its id \(org- and ten characters\) or the address of its page\. <a href="\/account\/dashboard\/find\?kind=organization">Find an organization by name<\/a><\/span><\/label>/);
  });

  it("sets each fieldset with no frame and its legend as a field's label, the share chart's too, in a stylesheet whose version moved", () => {
    const styles = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
    expect(styles).toContain(".toolbar fieldset, .toolbar fieldset.toolbar-row, .toolbar fieldset.toolbar-fields { min-width: 0; margin: 0; padding: 0 0 8px; border: 0; }");
    expect(styles).toMatch(/\.toolbar fieldset > legend \{[^}]*font-size: 12px; line-height: 16px; font-weight: 500;[^}]*text-transform: none; color: var\(--muted\);/);
    // The stamp at which the builder's and the tiles' rules were last touched; a later stylesheet change raises it.
    expect(STYLES_VERSION).toBeGreaterThanOrEqual(76);
  });
});

describe("the link from the views", () => {
  it("gives an Ultra reader of a buyer's and an organization's view the same subject, source and period in the builder, while the switch is on", async () => {
    const r = await readers();
    const cases: [string, string][] = [
      ["/buyers/pwgsc-tpsgc/analytics?source=history&from=2019&to=2026",
        `${PATH}?subject=buyer&amp;b=pwgsc-tpsgc&amp;rows=year&amp;measure=value&amp;source=history&amp;from=2019&amp;to=2026&amp;show=bars`],
      [`/organizations/${ORGS[0]}/analytics?source=awards&years=5`,
        `${PATH}?subject=organization&amp;o=${ORGS[0]}&amp;rows=year&amp;measure=value&amp;source=awards&amp;from=2022&amp;to=2026&amp;show=bars`],
    ];
    for (const [path, href] of cases) {
      for (const lang of ["en", "fr"] as const) {
        const at = lang === "fr" ? `${path}&lang=fr` : path;
        const html = await (await get(at, { cookie: r.ultra, env: onWith() })).text();
        expect(html, at).toContain(`<p class="toolbar-note"><a href="${href}">${lang === "fr" ? "Ouvrir dans le générateur" : "Open in the builder"}</a></p>`);
        // Off, the page is as it was; on, a reader without Ultra gets the page as it is off but for the rail's item
        // and the footer's link.
        const railItem = /<li><a class="rail-item" href="\/analytics\/build"(?: aria-current="page")?>(?:(?!<\/li>).)*<\/li>/;
        const footerItem = /<a href="\/analytics\/build">[^<]+<\/a>/;
        for (const cookie of [r.ultra, r.pro, r.free, undefined]) {
          const off = await (await get(at, { cookie, env: onEnv({ RECORDS }) })).text();
          expect(off, at).not.toContain(PATH);
          if (cookie === r.ultra) continue;
          const on = await (await get(at, { cookie, env: onWith() })).text();
          expect(on, at).toMatch(railItem);
          expect(on, at).toMatch(footerItem);
          expect(on.replace(railItem, "").replace(footerItem, ""), at).toBe(off);
        }
      }
    }
    // A segment's view has no link: the builder's segment menu reaches it.
    const segment = await (await get("/segments/82/analytics?source=history", { cookie: r.ultra, env: onWith() })).text();
    expect(segment).not.toContain("Open in the builder");
    expect(segment).not.toContain(`href="${PATH}?`);
  });
});

describe("robots.txt", () => {
  it("closes the builder in each group that closes the analytics index's queries, in the file itself, whatever the switch says", async () => {
    const file = robotsFile;
    // The same bytes with the switch on, off and absent: the Worker adds nothing, so the file need not pass through it.
    for (const env of [onWith(), onEnv(), onEnv({ BUILDER: "off" }), { ...testEnv(), ...ON }]) {
      const res = await app.request("/robots.txt", {}, env);
      expect(await res.text()).toBe(file);
    }
    const groups = file.split(/\n\s*\n/).filter((g) => /^Disallow: \/analytics\?$/m.test(g));
    expect(groups.length).toBe(3);
    for (const g of groups) expect(g.split("\n")).toContain("Disallow: /analytics/build");
    expect(file.match(/^Disallow: \/analytics\/build$/gm)).toHaveLength(3);
  });
});
