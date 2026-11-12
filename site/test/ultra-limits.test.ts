// Ultra's own figures (docs/accounts.md, Ultra, Its figures): the figures in
// RULES and the named constants and the plan lines that print them; the watch
// statements in groups of TARGET_CHUNK under D1's 100 bound values, held to
// one statement over every subject on a fixture, the events and the calendar
// feed's rows alike; the keyed API's count, 429 and /me by the holder's plan;
// the account pages' lines while Ultra is on sale, and nothing of them while
// it is not; and what a move to a smaller plan keeps, lists and sends. The
// twenty fiscal years of analytics are in test/analytics.test.ts.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { addDays } from "../public/closing.js";
import { KEYS_MAX } from "../src/account/api_keys";
import { BRIEFINGS_DUE_SQL, sharedCap } from "../src/account/briefings";
import { runDeliveries } from "../src/account/deliveries";
import { PLANS, RULES, SAVED_SEARCH_MAX, WATCH_MAX, watchCap } from "../src/account/entitlements";
import {
  ENDS_SLOTS, INSTRUMENT_SLOTS, type FeedWatch, WATCH_ENDS_SQL, WATCH_INSTRUMENTS_SQL, endsBinds, horizonDays, instrumentBinds, mergeEnds,
  watchEnds, watchInstrumentsSqlOver,
} from "../src/account/feeds";
import {
  D1_BINDS_MAX, DAY_SLOTS, type Found, KINDS_FOR, type Subject, TARGET_CHUNK, TARGET_SLOTS, WATCH_EVENTS_SQL, type WatchKind, eventStatementsOver,
  foundKey, readEvents,
} from "../src/account/watch_events";
import { withinCap } from "../src/account/watches";
import { KEY_PER_DAY, KEY_PER_DAY_ULTRA, KEY_PER_MINUTE, keyQuota } from "../src/api_keyed_spec";
import { FEED_EVENTS_MAX, contractEvent, expiringFacts, instrumentEvent, instrumentFacts } from "../src/calendar";
import { LONG_AXIS_YEARS, fiscalAxis } from "../src/chart";
import { clockAt } from "../src/closing";
import { app } from "../src/index";
import { radarRow } from "../src/pages/expiring";
import { PLAN_LINE_MAX, PLAN_ROWS, planLine } from "../src/pro";
import { MAX_RIVALS, type Row, planYears } from "../src/records_db";
import {
  ACCOUNTS, PRO_SALE, csrf, decode, get, grantPro, grantUltra, nbsp, newEmail, nextIp, onEnv, post, signIn, ultraEnv, useAccountsDb, userId,
  withoutTiers,
} from "./accounts-helpers";
import { TEST_NOW, makeFakeAssets } from "./assets";
import { fakeMail } from "./mail-fixtures";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const DAY = "2026-10-31"; // TEST_NOW's UTC date and the fixtures' data date
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const text = (s: string) => nbsp(decode(s)).replace(/’/g, "'");

// A statement with its placeholders past the first `keep` written as the values they stand for: the one statement
// over every subject the groups are held to, which D1 (the local database too) could not take with more than 100
// bound values. The values are this file's own fixtures; a string is quoted as SQLite reads one.
function inlined(sql: string, binds: readonly (string | number)[], keep = 0): { sql: string; binds: (string | number)[] } {
  const literal = (v: string | number) => (typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
  return {
    sql: sql.replace(/\?(\d+)/g, (m, n: string) => (Number(n) > keep ? literal(binds[Number(n) - 1]) : m)),
    binds: binds.slice(0, keep),
  };
}
const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

// A D1 binding that writes down how many values each statement it prepares is bound to.
function counting(db: D1Database): { binding: D1Database; binds: { sql: string; n: number }[] } {
  const binds: { sql: string; n: number }[] = [];
  const binding = {
    prepare(sql: string) {
      const st = db.prepare(sql);
      const bind = st.bind.bind(st);
      (st as { bind: unknown }).bind = (...args: unknown[]) => {
        binds.push({ sql, n: args.length });
        return bind(...args);
      };
      return st;
    },
    batch: (statements: D1PreparedStatement[]) => db.batch(statements),
  } as unknown as D1Database;
  return { binding, binds };
}

const highest = (sql: string) => Math.max(0, ...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])));

// =====================================================================================

describe("the figures", () => {
  it("are each plan's own, in RULES or a named constant: 3, 25, 100 searches and watches; 5, 200, 500 and 3, 10, 25 matches", () => {
    const of = (f: "saved_searches" | "watchlists" | "matches" | "match_mail") => PLANS.map((p) => RULES[p][f]);
    expect(of("saved_searches")).toEqual([3, 25, 100]);
    expect(of("watchlists")).toEqual([3, 25, 100]);
    expect(of("matches")).toEqual([5, 200, 500]);
    expect(of("match_mail")).toEqual([3, 10, 25]);
    // The ceilings are Ultra's; a plan's own figure is read from RULES.
    expect(SAVED_SEARCH_MAX).toBe(RULES.ultra.saved_searches);
    expect(WATCH_MAX).toBe(RULES.ultra.watchlists);
    expect(PLANS.map(watchCap)).toEqual([3, 25, 100]);
    expect(PLANS.map(sharedCap)).toEqual([3, 25, 100]);
    // The keyed API: five keys on either paid plan, the day by plan, the minute the same.
    expect(KEYS_MAX).toBe(5);
    expect(PLANS.map(keyQuota)).toEqual([null, { perDay: KEY_PER_DAY, perMinute: KEY_PER_MINUTE }, { perDay: KEY_PER_DAY_ULTRA, perMinute: KEY_PER_MINUTE }]);
    expect([KEY_PER_DAY, KEY_PER_DAY_ULTRA, KEY_PER_MINUTE]).toEqual([20_000, 50_000, 600]);
    // The analytics years, and the organizations compared, unchanged.
    expect(PLANS.map(planYears)).toEqual([3, 10, 20]);
    expect(MAX_RIVALS).toBe(5);
  });

  it("are printed by the plan lines, each plan's own, within PLAN_LINE_MAX in both languages", () => {
    const line = (lang: "en" | "fr", plan: "pro" | "ultra", key: string) =>
      nbsp(planLine(lang, PLAN_ROWS.find((r) => (r[plan]?.key ?? "") === key)![plan]!));
    expect(line("en", "ultra", "plans.pro_searches")).toBe("100 saved searches, by email");
    expect(line("en", "ultra", "plans.pro_watches")).toBe("100 watches, each change by email");
    expect(line("en", "ultra", "plans.pro_analytics")).toBe("Analytics: every view, 20 fiscal years");
    expect(line("en", "ultra", "plans.matches")).toBe("500 matching notices for your organization");
    expect(line("en", "ultra", "plans.match_mail")).toBe("25 matching notices a week, by email");
    expect(line("en", "ultra", "plans.api_keys")).toBe("API: 5 keys of 50,000 requests a day");
    expect(line("en", "pro", "plans.api_keys")).toBe("API: 5 keys of 20,000 requests a day");
    expect(line("en", "pro", "plans.pro_analytics")).toBe("Analytics: every view, 10 fiscal years");
    expect(line("fr", "ultra", "plans.pro_searches")).toBe("100 recherches enregistrées, par courriel");
    expect(line("fr", "ultra", "plans.pro_watches")).toBe("100 suivis, chaque changement par courriel");
    expect(line("fr", "ultra", "plans.pro_analytics")).toBe("Analyses : toutes les vues, 20 exercices");
    expect(line("fr", "ultra", "plans.matches")).toBe("500 avis correspondant à votre organisation");
    expect(line("fr", "ultra", "plans.match_mail")).toBe("25 correspondances par semaine, par courriel");
    expect(line("fr", "ultra", "plans.api_keys")).toBe("API : 5 clés de 50 000 requêtes par jour");
    expect(line("fr", "pro", "plans.api_keys")).toBe("API : 5 clés de 20 000 requêtes par jour");
    for (const row of PLAN_ROWS) {
      for (const plan of ["free", "pro", "ultra"] as const) {
        const w = row[plan];
        if (!w) continue;
        for (const lang of ["en", "fr"] as const) {
          const s = planLine(lang, w);
          expect(s.length, `${lang} ${plan} ${w.key}`).toBeLessThanOrEqual(PLAN_LINE_MAX);
          expect(s).not.toContain(EM_DASH);
          expect(s).not.toContain(EN_DASH);
        }
      }
    }
  });
});

describe("the analytics charts' axis over twenty years", () => {
  it("draws every other fiscal year and the first, so a label has the room a ten-year axis gives it; ten years as before", () => {
    const long = fiscalAxis(2007, 2026, (y) => String(y));
    expect(long.labels).toHaveLength(20);
    const drawn = long.labels.filter((l) => !l.hidden);
    expect(drawn.map((l) => l.text)).toEqual(["2007", ...Array.from({ length: 10 }, (_, i) => String(2008 + 2 * i))]);
    // Below 1200 px every other one of those rests; a phone shows the first and the last.
    expect(drawn.filter((l) => l.minor).map((l) => l.text)).toEqual(["2008", "2012", "2016", "2020", "2024"]);
    expect(long.labels.filter((l) => l.phone).map((l) => l.text)).toEqual(["2007", "2026"]);
    // Up to LONG_AXIS_YEARS nothing is hidden, and the labels are what they were.
    expect(LONG_AXIS_YEARS).toBe(12);
    expect(fiscalAxis(2017, 2026, (y) => String(y)).labels.every((l) => !("hidden" in l))).toBe(true);
    expect(fiscalAxis(2017, 2026, (y) => String(y)).labels.filter((l) => l.minor).map((l) => l.text))
      .toEqual(["2017", "2019", "2021", "2023", "2025"]);
  });
});

// -- the statements, in groups under D1's bound values ------------------------------------------

const ORG_BASE = 0xf000000000;
const orgOf = (i: number) => `org-${(ORG_BASE + i).toString(16)}`;
const buyerOf = (i: number) => `zz-buyer-${i}`;
const contractOf = (i: number) => `award:ref-${i}`;
const tenderOf = (i: number) => `tender:cb-${i}`;
// Every subject an account can hold of each kind: the ceiling and the claimed organization's beside it.
const N = TARGET_SLOTS;
const targetOf = (kind: WatchKind, i: number) =>
  kind === "organization" ? orgOf(i) : kind === "buyer" ? buyerOf(i) : kind === "contract" ? contractOf(i) : tenderOf(i);
const subjects = (kind: WatchKind, n = N): Subject[] => Array.from({ length: n }, (_, i) => ({ kind, target: targetOf(kind, i) }));
const DAYS = Array.from({ length: DAY_SLOTS }, (_, i) => addDays(DAY, -i));

type Ev = {
  day?: string; kind: string; src?: number | null; oid?: number | null; buyer?: string | null; ref: string; cents?: number | null;
  ocents?: number | null; title?: string; path: string; more?: number | null;
};
const COLS = ["day", "kind", "src", "oid", "buyer", "ref", "cents", "ocents", "title", "path", "more"] as const;

// For each subject a few events of its kinds on the data date and the day
// before: some subjects more than ROWS_PER_KIND of one kind, some a count
// row, a day the reader does not read, and, for buyers, an amendment too
// small to report beside one that is not.
function eventRows(): Ev[] {
  const out: Ev[] = [];
  for (let i = 0; i < N; i++) {
    const oid = ORG_BASE + i;
    for (let j = 0; j < i % 13; j++) {
      out.push({ day: j % 2 ? addDays(DAY, -1) : DAY, kind: "award", src: 1, oid, ref: `award:o${i}-${j}`, cents: 100_000 + j, title: `O${i} ${j}`, path: `/awards/o${i}-${j}` });
    }
    if (i % 5 === 0) out.push({ kind: "award", oid, ref: `count:award:o${i}`, path: `/organizations/${orgOf(i)}`, more: 7 });
    out.push({ day: addDays(DAY, -40), kind: "grant", src: 4, oid, ref: `grant:o${i}`, title: "Too old", path: "/x" });
    const buyer = buyerOf(i);
    for (let j = 0; j < i % 12; j++) out.push({ kind: "notice", src: 5, buyer, ref: `tender:b${i}-${j}`, title: `B${i} ${j}`, path: `/tenders/b${i}-${j}` });
    out.push({ kind: "amended", src: 3, buyer, ref: `contract:${buyer}:small`, cents: 11_000_000, ocents: 10_000_000, title: "Small", path: "/c/s" });
    out.push({ kind: "amended", src: 3, buyer, ref: `contract:${buyer}:big`, cents: 90_000_000, ocents: 10_000_000, title: "Big", path: "/c/b" });
    for (let j = 0; j < i % 3; j++) out.push({ day: addDays(DAY, -j), kind: "amended", src: 1, ref: contractOf(i), cents: 5_000 + j, title: `C${i}`, path: `/awards/ref-${i}` });
    if (i % 2 === 1) out.push({ kind: "notice_amended", src: 5, ref: tenderOf(i), title: `T${i}`, path: `/tenders/cb-${i}` });
    // Something no watch here follows.
    out.push({ kind: "award", src: 1, oid: ORG_BASE + 5000 + i, ref: `award:stranger-${i}`, path: "/awards/s" });
  }
  return out;
}

async function seedEvents(): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["rec_events", "rec_meta", "rec_expiring", "rec_instruments", "rec_holders"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(DAY).run();
  const rows = eventRows();
  for (let i = 0; i < rows.length; i += 100) {
    await RECORDS.batch(rows.slice(i, i + 100).map((r, j) => {
      const v: Record<string, unknown> = { ...r, day: r.day ?? DAY };
      return RECORDS.prepare(`INSERT INTO rec_events (k, ${COLS.join(", ")}) VALUES (?, ${COLS.map(() => "?").join(", ")})`)
        .bind(i + j + 1, ...COLS.map((c) => v[c] ?? null));
    }));
  }
}

// What a subject's events read as, to compare two reads: its rows in order and its counts by kind and day.
const shape = (f: Found | undefined) => ({
  rows: (f?.rows ?? []).map((r) => [r.day, r.kind, r.ref, r.path, r.cents, r.holders ?? null].join("|")),
  counts: [...(f?.counts ?? new Map())].flatMap(([kind, byDay]) => [...byDay].map(([day, n]) => `${kind}|${day}|${n}`)).sort(),
});

// The same read as one statement per kind over every subject at once (DAY_SLOTS + N values: more than D1 binds,
// so the subjects are written into it, inlined), filed as readEvents files a statement's rows.
async function unchunked(kind: WatchKind, list: Subject[]): Promise<Map<string, ReturnType<typeof shape>>> {
  const { rows, counts } = eventStatementsOver(kind, list.length);
  const binds = [...DAYS, ...list.map((s) => (kind === "organization" ? Number.parseInt(s.target.slice(4), 16) : s.target))];
  const one = (sql: string) => {
    const x = inlined(sql, binds, DAY_SLOTS);
    return RECORDS.prepare(x.sql).bind(...x.binds);
  };
  const [r, c] = await RECORDS.batch<Record<string, unknown>>([one(rows), one(counts)]);
  const found = new Map<string, Found>();
  const key = (t: unknown) => foundKey({ kind, target: kind === "organization" ? `org-${Number(t).toString(16)}` : String(t) });
  const at = (t: unknown) => {
    const k = key(t);
    if (!found.has(k)) found.set(k, { rows: [], counts: new Map() });
    return found.get(k)!;
  };
  for (const row of r.results ?? []) {
    at(row.t).rows.push({ day: String(row.day), kind: row.kind as never, ref: String(row.ref), path: String(row.path), cents: (row.cents as number | null) ?? null,
      holders: (row.holders as number | null) ?? null } as never);
  }
  for (const row of c.results ?? []) {
    const f = at(row.t);
    const byDay = f.counts.get(row.kind as never) ?? new Map<string, number>();
    byDay.set(String(row.day), Number(row.n));
    f.counts.set(row.kind as never, byDay);
  }
  return new Map([...found].map(([k, f]) => [k, shape(f)]));
}

describe("the events statements, in groups", () => {
  beforeAll(() => seedEvents());

  it("bind at most 100 values each, as written and as sent for every watch an account can hold", async () => {
    expect(TARGET_CHUNK).toBe(25);
    expect(D1_BINDS_MAX).toBe(100);
    for (const sql of [...WATCH_EVENTS_SQL, WATCH_ENDS_SQL, WATCH_INSTRUMENTS_SQL]) expect(highest(sql), sql.slice(0, 60)).toBeLessThanOrEqual(D1_BINDS_MAX);
    expect(highest(WATCH_ENDS_SQL)).toBe(2 + 3 * ENDS_SLOTS);
    expect(highest(WATCH_INSTRUMENTS_SQL)).toBe(2 + INSTRUMENT_SLOTS);
    // Every kind at its fullest, and as many buyers narrowed to a segment: each statement read, none past D1's bound values.
    const rec = counting(RECORDS);
    const all: Subject[] = [
      ...subjects("organization"), ...subjects("buyer"), ...subjects("contract"), ...subjects("tender"),
      ...Array.from({ length: N }, (_, i) => ({ kind: "buyer" as const, target: buyerOf(i), segment: "43" })),
    ];
    const read = await readEvents(onEnv({ RECORDS: rec.binding }) as never, all, DAYS);
    expect(read.state).toBe("ready");
    expect(rec.binds.length).toBe(4 * 2 * Math.ceil(N / TARGET_CHUNK) + 2 * N);
    for (const b of rec.binds) expect(b.n, b.sql.slice(0, 60)).toBeLessThanOrEqual(D1_BINDS_MAX);
    // The calendar feed's statements for 100 organization and 100 buyer watches, the organizations' instruments too.
    const feed = counting(RECORDS);
    const watches: FeedWatch[] = [
      ...subjects("organization", WATCH_MAX).map((s) => ({ kind: s.kind, target: s.target, segment: "", events: [...KINDS_FOR.organization] })),
      ...subjects("buyer", WATCH_MAX).map((s, i) => ({ kind: s.kind, target: s.target, segment: i % 2 ? "43" : "", events: [...KINDS_FOR.buyer] })),
    ];
    await watchEnds(onEnv({ RECORDS: feed.binding, ASSETS: makeFakeAssets({}, {}) }) as never, watches, ctx);
    expect(feed.binds.filter((b) => b.sql === WATCH_ENDS_SQL)).toHaveLength(Math.ceil((2 * WATCH_MAX) / ENDS_SLOTS));
    expect(feed.binds.filter((b) => b.sql === WATCH_INSTRUMENTS_SQL)).toHaveLength(Math.ceil(WATCH_MAX / INSTRUMENT_SLOTS));
    for (const b of feed.binds) expect(b.n, b.sql.slice(0, 60)).toBeLessThanOrEqual(D1_BINDS_MAX);
  });

  it("give for every subject of each kind the rows and counts one statement over all of them gives", async () => {
    for (const kind of ["organization", "buyer", "contract", "tender"] as const) {
      const list = subjects(kind);
      const read = await readEvents(onEnv() as never, list, DAYS);
      if (read.state !== "ready") throw new Error(read.state);
      const reference = await unchunked(kind, list);
      expect(reference.size, kind).toBeGreaterThan(TARGET_CHUNK);
      for (const s of list) {
        const key = foundKey(s);
        expect(shape(read.found.get(key)), `${kind} ${s.target}`).toEqual(reference.get(key) ?? shape(undefined));
      }
      // Nothing is filed under a subject no watch names.
      expect([...read.found.keys()].every((k) => list.some((s) => foundKey(s) === k))).toBe(true);
    }
    // The fixture reaches past ROWS_PER_KIND, holds count rows and filters the small amendment, so the groups are held to all of it.
    const many = await readEvents(onEnv() as never, subjects("organization"), DAYS);
    if (many.state !== "ready") throw new Error(many.state);
    expect(many.found.get(foundKey({ kind: "organization", target: orgOf(12) }))?.rows).toHaveLength(10);
    expect(many.found.get(foundKey({ kind: "organization", target: orgOf(100) }))?.counts.get("award")?.get(DAY)).toBe(7 + 5);
    const buyers = await readEvents(onEnv() as never, subjects("buyer"), DAYS);
    if (buyers.state !== "ready") throw new Error(buyers.state);
    expect(buyers.found.get(foundKey({ kind: "buyer", target: buyerOf(99) }))?.rows.map((r) => r.ref)).not.toContain(`contract:${buyerOf(99)}:small`);
  });
});

// -- the calendar feed's rows -------------------------------------------------------------------

const ctx = { lang: "en" as const, base: "https://awardwatch.ca", clock: clockAt(Date.parse(TEST_NOW)), dataDate: DAY };

// A contract in the radar's 12-month window, as rec_expiring holds it (as test/calendar.test.ts writes one).
type Ending = { k: number; end: string; oid: number | null; buyer: string; segs?: string[] };
const windowRow = (e: Ending) => ({
  kind: "award", reference: `RADAR-${e.k}`, title_en: `Contract ${e.k}`, title_fr: `Contrat ${e.k}`,
  organization_id: e.oid === null ? null : `org-${e.oid.toString(16)}`, organization: e.oid === null ? null : "A holder", supplier_withheld: e.oid === null,
  buyer_id: e.buyer, buyer_en: "A buyer", buyer_fr: null, start: "2025-04-01", end: e.end, value: 100_000, currency: "CAD", competitive: 1,
  method_en: null, method_fr: null, instrument_en: "Contract", instrument_fr: null, n_amendments: 0, value_growth: null, segments: e.segs ?? [],
  provinces: [], client_buyer_id: e.buyer, client_buyer_name: null,
});

// Contracts held by the followed organizations at the followed buyers: a row two groups reach (an organization in
// the first group, a buyer in the last), rows past an organization's 6-month horizon, rows past every horizon, rows of
// a segment a narrowed buyer watch takes and one it does not; and instruments of the organizations.
async function seedFeed(): Promise<void> {
  await RECORDS.batch(["rec_expiring", "rec_instruments", "rec_holders"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  const rows: Ending[] = [];
  for (let i = 0; i < WATCH_MAX; i++) {
    rows.push({ k: 1000 + i, end: addDays(DAY, 10 + i), oid: ORG_BASE + i, buyer: buyerOf(WATCH_MAX - 1 - i), segs: [i % 2 ? "43" : "81"] });
    rows.push({ k: 2000 + i, end: addDays(DAY, 200 + i), oid: ORG_BASE + i, buyer: "elsewhere" });
    rows.push({ k: 3000 + i, end: addDays(DAY, 30 + (i % 7)), oid: null, buyer: buyerOf(i), segs: ["43"] });
  }
  rows.push({ k: 9000, end: addDays(DAY, 400), oid: ORG_BASE, buyer: buyerOf(0) });
  for (let i = 0; i < rows.length; i += 100) {
    await RECORDS.batch(rows.slice(i, i + 100).map((e) => RECORDS.prepare(
      "INSERT INTO rec_expiring (k, endd, oid, buyer, client, segs, kind, comp, cad, cents, nv, so, m31, j) VALUES (?, ?, ?, ?, ?, ?, 1, 1, 10000000, 10000000, 0, 0, 0, ?)",
    ).bind(e.k, e.end, e.oid, e.buyer, e.buyer, e.segs?.length ? ` ${e.segs.join(" ")} ` : "", JSON.stringify(windowRow(e)))));
  }
  const inst = Array.from({ length: 30 }, (_, i) => i);
  await RECORDS.batch([
    ...inst.map((i) => RECORDS.prepare("INSERT INTO rec_instruments (k, agr, type_en, start, expiry, n, nw) VALUES (?, ?, 'Supply Arrangement', '2024-04-01', ?, 2, 0)")
      .bind(50_000 + i, `E60PQ-${100 + i}`, addDays(DAY, 20 + i))),
    // Each instrument held by an organization of the first group and one of the last, one region each.
    ...inst.flatMap((i) => [i, WATCH_MAX - 1 - i].map((o, j) => RECORDS.prepare(
      "INSERT INTO rec_holders (k, ik, oid, name, region, region_en, region_fr, seen) VALUES (?, ?, ?, ?, 'ON', 'Ontario', 'Ontario', '2026-10-30')",
    ).bind(60_000 + 2 * i + j, 50_000 + i, ORG_BASE + o, `Holder ${o}`))),
  ]);
}

describe("the calendar feed's statements, in groups", () => {
  beforeAll(async () => {
    await seedEvents();
    await seedFeed();
  });

  it("give the events and the count beyond them one statement over every watch gives, a row two groups reach once", async () => {
    const watches: FeedWatch[] = [
      ...subjects("organization", WATCH_MAX).map((s, i) => ({ kind: s.kind, target: s.target, segment: "",
        events: i % 3 ? [...KINDS_FOR.organization] : ["award", "ends_6m", "instrument_expires_6m"] as never })),
      ...subjects("buyer", WATCH_MAX).map((s, i) => ({ kind: s.kind, target: s.target, segment: i % 2 ? "43" : "", events: [...KINDS_FOR.buyer] })),
    ];
    const got = await watchEnds(onEnv({ ASSETS: makeFakeAssets({}, {}) }) as never, watches, ctx);
    // Every slot as watchEnds makes them.
    const slots = watches.filter((w) => horizonDays(w.events)).map((w) => ({
      target: w.kind === "organization" ? Number.parseInt(w.target.slice(4), 16) : w.target, mark: w.segment ? ` ${w.segment} ` : "",
      last: addDays(DAY, horizonDays(w.events)),
    }));
    const owners = watches.filter((w) => w.kind === "organization" && w.events.includes("instrument_expires_6m"))
      .map((w) => Number.parseInt(w.target.slice(4), 16));
    // The contracts ending as one statement over every slot would give them, which D1 cannot run (its OR of 200
    // slots passes SQLite's expression depth): the window's rows, the statement's own rule for each slot applied
    // here, soonest end first then by key, cut at FEED_EVENTS_MAX. The statement over 25 slots is the one
    // test/calendar.test.ts holds to the rule.
    const last = slots.reduce((m, s) => (s.last > m ? s.last : m), DAY);
    const window = (await RECORDS.prepare(
      "SELECT endd, j, CAST(k AS TEXT) AS kt, oid, buyer, client, segs FROM rec_expiring WHERE endd BETWEEN ?1 AND ?2 ORDER BY endd, k",
    ).bind(DAY, last).all<Row>()).results ?? [];
    const matches = window.filter((r) => slots.some((s) => String(r.endd) <= s.last
      && (typeof s.target === "number" ? r.oid === s.target : r.buyer === s.target || r.client === s.target)
      && (s.mark === "" || String(r.segs).includes(s.mark))));
    const endRows = matches.slice(0, FEED_EVENTS_MAX);
    // The instruments as one statement over every organization: an IN list, which D1 takes with the values written in.
    const x = inlined(watchInstrumentsSqlOver(owners.length), instrumentBinds(DAY, owners, owners.length), 2);
    const heldRows = (await RECORDS.prepare(x.sql).bind(...x.binds).all<Row>()).results ?? [];
    expect(endsBinds(DAY, slots.slice(0, ENDS_SLOTS))).toHaveLength(2 + 3 * ENDS_SLOTS);
    const events = [
      ...endRows.map((r) => contractEvent("en", expiringFacts("en", radarRow(r, DAY)!), ctx.base)),
      ...heldRows.map((r) => instrumentEvent("en", instrumentFacts("en", r)!, ctx.base)),
    ].filter((e) => e !== null);
    expect(endRows.length).toBeGreaterThan(2 * ENDS_SLOTS);
    expect(endRows.length).toBeLessThan(FEED_EVENTS_MAX);
    expect(heldRows.length).toBe(60);
    // The row both groups reach is there once.
    expect(got.events.filter((e) => e?.uid.startsWith("contract-award-radar-1000@"))).toHaveLength(1);
    expect(got.events).toEqual(events);
    expect(got.beyond).toBe(matches.length - endRows.length);
    expect(got.beyond).toBe(0);
  });

  it("merge the groups as one statement sorts and cuts them, a row's key read as text past what a number holds", () => {
    // Two keys a JavaScript number cannot tell apart, one end date: ordered as SQLite orders the integers.
    const a = { endd: "2027-01-01", j: "{}", kt: "9007199254740993", n: 2 };
    const b = { endd: "2027-01-01", j: "{}", kt: "9007199254740992", n: 2 };
    const c = { endd: "2026-12-01", j: "{}", kt: "-5", n: 1 };
    expect(mergeEnds([[a, b], [c, b]])).toEqual({ rows: [c, b, a], beyond: 0 });
    // A group cut at the cap: its rows past the cut count beyond the rows kept.
    const many = Array.from({ length: FEED_EVENTS_MAX }, (_, i) => ({ endd: addDays(DAY, i), j: "{}", kt: String(i), n: FEED_EVENTS_MAX + 7 }));
    const merged = mergeEnds([many, [{ endd: addDays(DAY, 1), j: "{}", kt: "1", n: 1 }]]);
    expect(merged.rows).toHaveLength(FEED_EVENTS_MAX);
    expect(merged.beyond).toBe(7);
  });
});

// -- the keyed API by plan ---------------------------------------------------------------------

describe("the keyed API's day by plan", () => {
  type Made = { cookie: string; key: string; keyId: string };
  async function keyFor(tag: string, ultra: boolean): Promise<Made> {
    const email = newEmail(tag);
    const cookie = await signIn(email);
    await (ultra ? grantUltra(email) : grantPro(email));
    const html = await (await post("/account/keys", { csrf: await csrf(cookie), name: tag }, { cookie })).text();
    const key = /(aw_[0-9a-f]{8}_[0-9a-f]{64})/.exec(html)![1];
    const row = await ACCOUNTS.prepare("SELECT id FROM api_keys WHERE prefix = ?").bind(key.slice(3, 11)).first<{ id: string }>();
    return { cookie, key, keyId: row!.id };
  }
  const call = (path: string, key: string) =>
    app.request(path, { headers: { "cf-connecting-ip": nextIp(), authorization: `Bearer ${key}` } }, onEnv());
  const json = async (res: Response) => (await res.json()) as Record<string, any>;

  it("answers 429 at 20,000 for a Pro key and at 50,000 for an Ultra key, and /me states the holder's figure", async () => {
    for (const [ultra, cap] of [[false, KEY_PER_DAY], [true, KEY_PER_DAY_ULTRA]] as const) {
      const made = await keyFor(ultra ? "ultra-key" : "pro-key", ultra);
      const me = await json(await call("/api/v1/me", made.key));
      expect(me.limits).toEqual({ per_minute: KEY_PER_MINUTE, per_day: cap });
      expect(me.usage.remaining).toBe(cap - 1);
      await ACCOUNTS.prepare("UPDATE api_usage SET n = ? WHERE key_id = ? AND day = ?").bind(cap - 1, made.keyId, DAY).run();
      const last = await call("/api/v1/me", made.key);
      expect(last.status).toBe(200);
      expect((await json(last)).usage).toEqual({ day: DAY, requests: cap, remaining: 0 });
      const spent = await call("/api/v1/me", made.key);
      expect(spent.status).toBe(429);
      expect((await json(spent)).error).toBe(`This key has made its ${cap} requests for the day. The count starts again at 00:00 UTC.`);
      // The usage page's tile and the keys page's line give the same figure.
      const usage = text(await (await get("/account/api", { cookie: made.cookie })).text());
      expect(usage).toContain(`<span class="tile-value">${cap.toLocaleString("en-CA")}</span>`);
      const keys = text(await (await get("/account/keys", { cookie: made.cookie })).text());
      expect(keys).toContain(`Each key may make ${cap.toLocaleString("en-CA")} a day and ${KEY_PER_MINUTE} a minute.`);
    }
  });
});

// -- the account pages while Ultra is on sale, and while it is not --------------------------------

describe("the account pages' Ultra lines", () => {
  const payEnv = () => onEnv({ ...PRO_SALE });
  const saleEnv = () => ultraEnv();

  it("give a Pro account Ultra's figures beside its own, with Plans and Prices, only while Ultra is on sale", async () => {
    const email = newEmail("pages-pro");
    const cookie = await signIn(email, { env: payEnv() });
    await grantPro(email);
    const searches = text(await (await get("/account/searches", { cookie, env: saleEnv() })).text());
    expect(searches).toContain('<p>This account holds 0 of 25 saved searches. Ultra holds up to 100. <a href="/account/billing">Plans and prices</a></p>');
    const watches = text(await (await get("/account/watches", { cookie, env: saleEnv() })).text());
    expect(watches).toContain('<p>This account follows 0 of 25 pages. Ultra follows up to 100. <a href="/account/billing">Plans and prices</a></p>');
    const fr = text(await (await get("/account/watches?lang=fr", { cookie, env: saleEnv() })).text());
    expect(fr).toContain("Pages suivies par ce compte : 0 sur 25. Ultra en suit jusqu'à 100.");
    // The usage page, with a key to show.
    await post("/account/keys", { csrf: await csrf(cookie, "/account", { env: payEnv() }), name: "k" }, { cookie, env: payEnv() });
    const usage = text(await (await get("/account/api", { cookie, env: saleEnv() })).text());
    expect(usage).toContain(`Ultra's keys make up to 50,000 requests a day each. <a href="/account/billing">Plans and prices</a>`);
    // Off sale, and without the tier table: none of it, and the pages as they were.
    for (const path of ["/account/searches", "/account/watches", "/account/api"]) {
      const plain = await (await get(path, { cookie, env: payEnv() })).text();
      expect(plain, path).not.toContain("Ultra");
      await withoutTiers(async () => expect(await (await get(path, { cookie, env: saleEnv() })).text(), path).toBe(plain));
    }
    expect(text(await (await get("/account/searches", { cookie, env: payEnv() })).text())).toContain("<p>An account keeps up to 25 saved searches.</p>");
  });

  it("give an Ultra account its own figures and no line about Ultra, on sale or not", async () => {
    const email = newEmail("pages-ultra");
    const cookie = await signIn(email, { env: payEnv() });
    await grantUltra(email);
    for (const e of [payEnv(), saleEnv()]) {
      const searches = text(await (await get("/account/searches", { cookie, env: e })).text());
      expect(searches).toContain("<p>An account keeps up to 100 saved searches.</p>");
      expect(searches).toContain('<span class="panel-count">0 of 100</span>');
      const watches = text(await (await get("/account/watches", { cookie, env: e })).text());
      expect(watches).toContain("<p>Up to 100 pages.</p>");
      expect(watches).not.toContain("Ultra follows");
    }
  });
});

// -- after a move to a smaller plan --------------------------------------------------------------

let seq = 0;
const nextId = () => (0xe1000000 + ++seq).toString(16).padStart(32, "0");
const stamp = (i: number) => `2000-01-01T00:00:${String(Math.floor(i / 1000)).padStart(2, "0")}.${String(i % 1000).padStart(3, "0")}Z`;

async function makeUser(email: string, plan: "free" | "pro"): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active')").bind(id, email).run();
  if (plan === "pro") {
    await ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) " +
      "VALUES (?, ?, 'pro', 'manual', '2026-01-01T00:00:00.000Z', NULL, 'test', '2026-01-01T00:00:00.000Z')",
    ).bind(nextId(), id).run();
  }
  return id;
}

describe("after a move to a smaller plan", () => {
  beforeAll(() => seedEvents());

  it("keeps and lists every saved search, sends the first ones by creation date up to the figure, and says how many wait", async () => {
    quiet();
    // Pro from January, so the run's pinned clock (2026-10-31) falls inside the grant; the sign-in finds the same account.
    const email = newEmail("over-searches");
    const user = await makeUser(email, "pro");
    const cookie = await signIn(email);
    const ids: string[] = [];
    for (let i = 0; i < 27; i++) {
      const id = nextId();
      ids.push(id);
      await ACCOUNTS.prepare(
        "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, 'daily')",
      ).bind(id, user, `/tenders?q=ultra${i}`, `Search number ${i + 1}`, stamp(i)).run();
    }
    const html = text(await (await get("/account/searches", { cookie })).text());
    expect(html).toContain("<p>This account holds 27 saved searches, past the 25 of its plan. The first 25 are sent; remove some to choose which.</p>");
    for (let i = 1; i <= 27; i++) expect(html).toContain(`>Search number ${i}</a>`);
    expect(html).toContain('<span class="panel-count">27 of 25</span>');
    const fr = text(await (await get("/account/searches?lang=fr", { cookie })).text());
    expect(fr).toContain("Ce compte conserve 27 recherches enregistrées, au-delà des 25 de son forfait. Les 25 premières sont envoyées; retirez-en pour choisir lesquelles.");
    // The run: a delivery row for each of the first 25, none for the two after them.
    const mail = fakeMail();
    await runDeliveries(onEnv({ ASSETS: makeFakeAssets({}, week()), MAIL: mail.binding, MAIL_FROM: "alerts@awardwatch.ca", MAIL_SENDER: undefined, RECORDS: undefined }));
    const rows = async (id: string) => ((await ACCOUNTS.prepare("SELECT status FROM deliveries WHERE saved_search_id = ?").bind(id).all()).results ?? []).length;
    for (const [i, id] of ids.entries()) expect(await rows(id), `search ${i + 1}`).toBe(i < 25 ? 1 : 0);
    // A Free account past its 3 sends nothing, so its foot's own line gives the figures.
    const freeEmail = newEmail("over-searches-free");
    const freeUser = await makeUser(freeEmail, "free");
    for (let i = 0; i < 4; i++) {
      await ACCOUNTS.prepare("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, ?, 'en', ?, 'daily')")
        .bind(nextId(), freeUser, `/tenders?q=free${i}`, `Free search ${i + 1}`, stamp(i)).run();
    }
    const free = text(await (await get("/account/searches", { cookie: await signIn(freeEmail) })).text());
    expect(free).toContain("This account holds 4 of 3 saved searches. Pro holds up to 25");
    expect(free).not.toContain("past the 3 of its plan");
    for (let i = 1; i <= 4; i++) expect(free).toContain(`>Free search ${i}</a>`);
  });

  it("counts the briefings with the searches, by creation date, for the cap they share", async () => {
    const user = await makeUser(newEmail("over-briefings"), "pro");
    for (let i = 0; i < 24; i++) {
      await ACCOUNTS.prepare(
        "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', ?, 'x', 'en', ?, 'off')",
      ).bind(nextId(), user, `/tenders?q=b${i}`, stamp(10 + i)).run();
    }
    const briefing = (code: string, at: string) => ACCOUNTS.prepare(
      "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'segment', ?, '', 'x', 'en', ?, 'weekly')",
    ).bind(nextId(), user, code, at).run();
    await briefing("43", stamp(5));
    await briefing("81", stamp(500));
    const due = ((await ACCOUNTS.prepare(BRIEFINGS_DUE_SQL).bind("2026-10-26", 5000).all<{ user_id: string; subject: string; n_before: number }>()).results ?? [])
      .filter((r) => r.user_id === user);
    // The first briefing is the first row the account made; the second has 24 searches and a briefing before it.
    expect(due.map((r) => [r.subject, r.n_before])).toEqual([["43", 0], ["81", 25]]);
    expect(due.map((r) => r.n_before < sharedCap("pro"))).toEqual([true, false]);
  });

  it("keeps and lists every watch, reads the events of the first ones by creation date up to the figure, and says how many wait", async () => {
    const follow = async (user: string, n: number) => {
      for (let i = 1; i <= n; i++) {
        await ACCOUNTS.prepare(
          "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'organization', ?, '', ?, 'award', 'daily', ?, ?)",
        ).bind(nextId(), user, orgOf(i), `Watched org ${i}`, stamp(i), DAY).run();
      }
    };
    // Pro holding 27 (after Ultra): every one listed, the line saying which are covered.
    const proEmail = newEmail("over-watches-pro");
    await makeUser(proEmail, "pro");
    const proCookie = await signIn(proEmail);
    await follow(await userId(proEmail), 27);
    const pro = text(await (await get("/account/watches", { cookie: proCookie })).text());
    expect(pro).toContain("<p>This account follows 27 pages, past the 25 of its plan. Events are listed and sent for the first 25; remove some to choose which.</p>");
    for (let i = 1; i <= 27; i++) expect(pro).toContain(`>Watched org ${i}</a>`);
    // Organization 25's events (25 % 13 awards on the data date and the day before) and none of organization 27's, which has one.
    expect(pro).toContain('<a href="/awards/o25-0">O25 0</a>');
    expect(pro).not.toContain("/awards/o27-0");
    const fr = text(await (await get("/account/watches?lang=fr", { cookie: proCookie })).text());
    expect(fr).toContain("Ce compte suit 27 pages, au-delà des 25 de son forfait. Les événements sont présentés et envoyés pour les 25 premières; retirez-en pour choisir lesquelles.");
    // Free holding 5 (after Pro): the first three's events; the foot's own line gives the figures, since nothing is sent.
    const email = newEmail("over-watches");
    const cookie = await signIn(email);
    await follow(await userId(email), 5);
    const html = text(await (await get("/account/watches", { cookie })).text());
    expect(html).toContain("This account follows 5 of 3 pages. Pro follows up to 25 and sends their events by email.");
    expect(html).not.toContain("past the 3 of its plan");
    for (let i = 1; i <= 5; i++) expect(html).toContain(`>Watched org ${i}</a>`);
    for (const i of [1, 2, 3]) expect(html).toContain(`<a href="/awards/o${i}-0">O${i} 0</a>`);
    for (const i of [4, 5]) expect(html).not.toContain(`/awards/o${i}-0`);
  });

  it("mails the events of the first watches by creation date up to the plan's figure, and no more", async () => {
    quiet();
    const email = newEmail("over-mail");
    const user = await makeUser(email, "pro");
    await ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'on', '2026-01-01T00:00:00.000Z')").bind(user).run();
    // 27 organizations of their own, each with one award on the data date.
    const MAIL_BASE = 3000;
    await RECORDS.batch(Array.from({ length: 27 }, (_, i) => RECORDS.prepare(
      "INSERT INTO rec_events (k, day, kind, src, oid, ref, cents, title, path) VALUES (?, ?, 'award', 1, ?, ?, 100000, ?, ?)",
    ).bind(900_000 + i, DAY, ORG_BASE + MAIL_BASE + i, `award:mail-${i}`, `Mail award ${i + 1}`, `/awards/mail-${i}`)));
    for (let i = 0; i < 27; i++) {
      await ACCOUNTS.prepare(
        "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'organization', ?, '', ?, 'award', 'daily', ?, ?)",
      ).bind(nextId(), user, orgOf(MAIL_BASE + i), `Mail org ${i + 1}`, stamp(i), addDays(DAY, -1)).run();
    }
    const mail = fakeMail();
    await runDeliveries(onEnv({ ASSETS: makeFakeAssets({}, week()), MAIL: mail.binding, MAIL_FROM: "alerts@awardwatch.ca", MAIL_SENDER: undefined }));
    const [m] = mail.to(email);
    expect(m).toBeDefined();
    for (let i = 1; i <= 25; i++) expect(m.text, `award ${i}`).toContain(`- Mail award ${i}\n`);
    for (const i of [26, 27]) expect(m.text, `award ${i}`).not.toContain(`- Mail award ${i}\n`);
    expect(m.text).toContain("25 updates on 25 of the 27 pages you follow.");
  });

  it("covers the claimed organization's watch beside the first ones, whatever its place", () => {
    const w = (target: string) => ({ kind: "organization" as const, target });
    const list = [w("a"), w("b"), w("own"), w("c"), w("d")];
    expect(withinCap(list, 2, "own").map((x) => x.target)).toEqual(["a", "b", "own"]);
    expect(withinCap(list, 2, null).map((x) => x.target)).toEqual(["a", "b"]);
    expect(withinCap(list, 10, "own")).toEqual(list);
  });
});

// The new-notice files of the week to the data date, empty.
function week(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < 8; i++) out[`tenders/new/${addDays(DAY, -i)}.json`] = [];
  return out;
}
