// The week's matching notices by email (src/account/fit_mail.ts, digests.ts;
// docs/accounts.md, Matching notices and Weekly email): the open notices first
// seen in the seven data dates ending with the run's that match the claimed
// organization's records, close and partial only, closest first; Free lists
// RULES.free.match_mail with the rest counted and Pro's own figures under
// them, Pro RULES.pro.match_mail; the disclaimer with the Terms as a full
// https address and the data credit in every message that carries a match;
// no block without a claim, without a block, for a thin, published-contract
// or empty record, for a week with no new match, or when a file or the
// accounts database does not read, and the message goes whole without it;
// the open list read once a run; the weekly email's subject with the count;
// a Free account's block in its weekly email, a Pro account's in its weekly
// email when that is on and else in its first watch message of the week, and
// never twice in a week. Every expected line is written out here.
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import accountsSchema from "../accounts_schema.sql?raw";
import { runDeliveries } from "../src/account/deliveries";
import { watchDigest, weeklyDigest } from "../src/account/digests";
import { RULES } from "../src/account/entitlements";
import { WEEKLY_MATCHES_SQL, fitDigestBlock, weekNotices, weeklyTakesMatches } from "../src/account/fit_mail";
import { KINDS_FOR } from "../src/account/watch_events";
import { ACCOUNTS, decode, nbsp, newEmail, onEnv, useAccountsDb } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { SAMPLE_ADDRESS, fakeMail, weeklyInput } from "./mail-fixtures";
import { applySql, splitSql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const SITE = "https://awardwatch.ca";
const FROM = "alerts@awardwatch.ca";
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const D = "2026-11-02"; // a Monday, the week's opening day; the week's notices are first seen 2026-10-27 to 2026-11-02
const A1 = "org-a000000001"; // Exemplar Translation Services Inc., in Ontario
const NAME1 = "Exemplar Translation Services Inc.";

const plain = (s: string) => nbsp(s).replace(/’/g, "'");

// The block of fit-pages.test.ts: a notice like the fixtures' first open one
// (PSPC, code 82111800, Ontario and Quebec, a Request for Proposal) is a
// close match at 95 points, its first reason the class 821118.
const BLOCK = {
  fy: [2022, 2026], n: [7, 3, 12], coded: [7, 3], newest: "2026-09-30",
  classes: [["821118", 5, 2], ["811015", 2, 0]],
  families: [["8211", 5, 2], ["8110", 2, 0]],
  segments: [["82", 5, 2], ["81", 2, 0]],
  buyers: [["pwgsc-tpsgc", 4, 3, 0], ["dfo-mpo", 1, 0, 4]],
  provinces: [["ON", 6, 2], ["QC", 1, 1]],
  types: [["Request for Proposal", 5, 1]],
  held: [["SA", "82", 1]],
};

const OPEN = FILES["tenders/open.json"] as Record<string, unknown>[];
// n close matches first seen in the week, closing on one day, so they stand in reference order.
const matching = (n: number, o: { from?: number; seen?: string; closing?: string } = {}) =>
  Array.from({ length: n }, (_, k) => {
    const i = (o.from ?? 0) + k;
    return {
      ...OPEN[0], reference: `cb-910-${String(i).padStart(8, "0")}`, title_en: `Matching notice ${i}`, title_fr: `Avis correspondant ${i}`,
      first_seen: o.seen ?? "2026-10-30", closing: o.closing ?? "2026-11-20T14:00:00",
    };
  });
// Each one left out: first seen before the week, closing before the run's time (11:00 in Ottawa), first
// seen after the data date, a weak match (segment 81 alone, twice: 5 + 5 for naming no province), and
// a notice that shares nothing.
const OLD = { ...matching(1)[0], reference: "cb-910-old", first_seen: "2026-10-26" };
const PASSED = { ...matching(1)[0], reference: "cb-910-passed", closing: "2026-11-02T10:00:00" };
const LATER = { ...matching(1)[0], reference: "cb-910-later", first_seen: "2026-11-03" };
const WEAK = {
  ...matching(1)[0], reference: "cb-910-weak", codes: ["81141500"], segments: ["81"], provinces: [], buyer_id: "dnd-mdn",
  notice_type_en: "Invitation to Qualify",
};
const NONE = { ...OPEN[1], first_seen: "2026-10-31" };
const OUTSIDE = [OLD, PASSED, LATER, WEAK, NONE];

function profiles(block: unknown): Record<string, any> {
  const p = structuredClone(FILES["profiles/a00.json"]) as Record<string, any>;
  if (block !== undefined) p[A1].matching = block;
  return p;
}

// The files a run reads: stats.json at the data date, the profile with its block (undefined for none),
// the open notices.
const files = (o: { block?: unknown; open?: unknown; day?: string } = {}) => ({
  "stats.json": { ...(FILES["stats.json"] as object), data_as_of: o.day ?? D },
  "profiles/a00.json": profiles("block" in o ? o.block : BLOCK),
  "tenders/open.json": "open" in o ? o.open : [...matching(5), ...OUTSIDE],
});

// An assets binding that counts the requests for each path.
function counted(overrides: Record<string, unknown>) {
  const inner = makeFakeAssets({}, overrides);
  const seen = new Map<string, number>();
  const assets = {
    fetch: (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname.replace(/^\/data\//, "");
      seen.set(path, (seen.get(path) ?? 0) + 1);
      return inner.fetch(input as RequestInfo);
    },
  } as unknown as Fetcher;
  return { assets, seen };
}

const E = (o: Parameters<typeof files>[0] = {}, extra: Record<string, unknown> = {}) =>
  onEnv({ ASSETS: makeFakeAssets({}, files(o)), NOW: `${o.day ?? D}T16:00:00Z`, ...extra });

// -- the accounts ------------------------------------------------------------------------------------

let seq = 0;
const nextId = () => (0xf1000000 + ++seq).toString(16).padStart(32, "0");
const AT = "2026-10-01T00:00:00.000Z";

// An account: its plan, its claim (A1 unless null), its weekly email (on before the week unless said),
// and a daily watch of A1 with its watch mail on.
async function account(o: {
  lang?: string; pro?: boolean; claim?: string | null; weekly?: { mail: string; on?: string; lastWeek?: string; status?: string } | null;
  watch?: boolean;
} = {}): Promise<{ id: string; email: string }> {
  const id = nextId();
  const email = newEmail("fitmail");
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, ?, ?, 'active')").bind(id, email, AT, o.lang ?? "en").run();
  if (o.pro) {
    await ACCOUNTS.prepare("INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) " +
      "VALUES (?, ?, 'pro', 'manual', ?, NULL, 'test', ?)").bind(nextId(), id, AT, AT).run();
  }
  if (o.claim !== null) {
    await ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?, ?, NULL, '[]', ?, ?)")
      .bind(id, o.claim ?? A1, AT, AT).run();
  }
  if (o.weekly) {
    await ACCOUNTS.prepare("INSERT INTO weekly_mail (user_id, mail, via, on_at, created_at, last_week, last_status) VALUES (?, ?, 'account', ?, ?, ?, ?)")
      .bind(id, o.weekly.mail, o.weekly.on ?? "2026-10-20T09:00:00.000Z", AT, o.weekly.lastWeek ?? null, o.weekly.status ?? null).run();
  }
  if (o.watch) {
    await ACCOUNTS.prepare(
      "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'organization', ?, '', ?, ?, 'daily', ?, NULL)",
    ).bind(nextId(), id, A1, NAME1, KINDS_FOR.organization.join(","), AT).run();
    await ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'on', ?)").bind(id, AT).run();
  }
  return { id, email };
}

// Each run test starts from no list mail and no claim, so the accounts of one do not reach the next.
async function clean(): Promise<void> {
  await ACCOUNTS.batch(["weekly_mail", "watch_mail", "watch_deliveries", "watches", "org_claims"].map((t) => ACCOUNTS.prepare(`DELETE FROM ${t}`)));
}

// The records database at a data date, with no record of the week: the runs wait for it, and the
// "Your organization" block reads it.
async function seedRecords(asOf: string): Promise<void> {
  await applySql(RECORDS, RECORDS_SCHEMA);
  await RECORDS.batch(["rec_events", "rec_meta"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(asOf).run();
}

const jobEnv = (mail: SendEmail, o: Parameters<typeof files>[0] = {}) => onEnv({
  ASSETS: makeFakeAssets({}, files(o)), NOW: `${o.day ?? D}T16:00:00Z`, MAIL: mail, MAIL_FROM: FROM, MAIL_SENDER: undefined,
  MAIL_ADDRESS: SAMPLE_ADDRESS,
});

// A table taken off the accounts database for the length of fn, then made again from the schema.
async function withoutTable<T>(table: string, fn: () => Promise<T>): Promise<T> {
  await ACCOUNTS.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  try {
    return await fn();
  } finally {
    await ACCOUNTS.batch(splitSql(accountsSchema).filter((s) => s.includes(` ${table}`)).map((s) => ACCOUNTS.prepare(s)));
  }
}

const block = (id: string, o: { lang?: "en" | "fr"; plan?: "free" | "pro"; env?: object } = {}) =>
  fitDigestBlock((o.env ?? E()) as never, { userId: id, lang: o.lang ?? "en", site: SITE, dataDate: D, plan: o.plan ?? "free", now: new Date(`${D}T16:00:00Z`) });

// -- the block -----------------------------------------------------------------------------------------

const DETAIL = "Public Services and Procurement Canada · closes 2026-11-20 · " +
  "UNSPSC class 821118 Editorial and support services: 5 award notices, 2 PSPC contract history records";
const DETAIL_FR = "Services publics et Approvisionnement Canada · clôture le 2026-11-20 · " +
  "Classe UNSPSC 821118 Services de rédaction et de soutien : 5 avis d'attribution, 2 dossiers de l'historique des contrats de SPAC";

const FREE_EN = `New open notices this week that match ${NAME1}

- Close match: Matching notice 0
  ${DETAIL}
  ${SITE}/tenders/cb-910-00000000

- Close match: Matching notice 1
  ${DETAIL}
  ${SITE}/tenders/cb-910-00000001

- Close match: Matching notice 2
  ${DETAIL}
  ${SITE}/tenders/cb-910-00000002

2 more on the site: ${SITE}/account/matches
Pro lists up to 200 matching notices on the site and 10 a week here.

Award Watch calculates matches from public records. A match is not advice and may be wrong. See the Terms of Use.
Terms of Use: ${SITE}/terms#warranty
Contains information licensed under the Open Government Licence, Canada.`;

const FREE_FR = `Nouveaux avis ouverts cette semaine qui correspondent à ${NAME1}

- Correspondance étroite : Avis correspondant 0
  ${DETAIL_FR}
  ${SITE}/tenders/cb-910-00000000?lang=fr

- Correspondance étroite : Avis correspondant 1
  ${DETAIL_FR}
  ${SITE}/tenders/cb-910-00000001?lang=fr

- Correspondance étroite : Avis correspondant 2
  ${DETAIL_FR}
  ${SITE}/tenders/cb-910-00000002?lang=fr

2 de plus sur le site : ${SITE}/account/matches?lang=fr
Pro présente jusqu'à 200 avis correspondants sur le site et 10 par semaine ici.

Award Watch calcule les correspondances à partir de dossiers publics. Une correspondance ne constitue pas un conseil et peut être erronée. Voir les Conditions d'utilisation.
Conditions d'utilisation : ${SITE}/terms?lang=fr#warranty
Contient des informations visées par la Licence du gouvernement ouvert, Canada.`;

describe("the block", () => {
  it("lists the week's new matches for Free, RULES.free.match_mail of them, the rest counted, and Pro's own figures, in English and French", async () => {
    expect([RULES.free.match_mail, RULES.pro.match_mail]).toEqual([3, 10]);
    const { id } = await account();
    const en = await block(id);
    expect(en?.subject).toBe("5 matching notices");
    expect(en?.rows).toHaveLength(RULES.free.match_mail);
    expect(en?.note).toBe(`Pro lists up to ${RULES.pro.matches} matching notices on the site and ${RULES.pro.match_mail} a week here.`);
    const m = weeklyDigest({ ...weeklyInput("en", { news: false }), matches: en });
    expect(m.text).toContain(`\n\n${FREE_EN}\n\n`);
    const fr = await block(id, { lang: "fr" });
    expect(plain(fr!.subject)).toBe("5 avis correspondants");
    const mf = weeklyDigest({ ...weeklyInput("fr", { news: false }), matches: fr });
    expect(plain(mf.text)).toContain(`\n\n${FREE_FR}\n\n`);
    for (const x of [m, mf]) {
      for (const part of [x.subject, x.text, x.html]) {
        expect(part).not.toContain(EM_DASH);
        expect(part).not.toContain(EN_DASH);
      }
    }
  });

  it("lists RULES.pro.match_mail for Pro, with no line on what Pro lists", async () => {
    const { id } = await account();
    const env = E({ open: matching(12) });
    const pro = await block(id, { plan: "pro", env });
    expect(pro?.rows.map((r) => r.title)).toEqual(Array.from({ length: RULES.pro.match_mail }, (_, i) => `Close match: Matching notice ${i}`));
    expect(pro?.more).toEqual({ text: "2 more on the site", url: `${SITE}/account/matches` });
    expect(pro?.note).toBeNull();
    // As many as fit: no line for the rest.
    const few = await block(id, { plan: "pro", env: E({ open: matching(4) }) });
    expect(few?.rows).toHaveLength(4);
    expect(few?.more).toBeNull();
    expect(few?.subject).toBe("4 matching notices");
    const one = await block(id, { env: E({ open: matching(1) }) });
    expect(one?.subject).toBe("1 matching notice");
  });

  it("lists only open notices first seen in the week that are close or partial matches, the closest first", async () => {
    const { id } = await account();
    // A partial match (no buyer, no province or type in common: 45 + 5 for naming no province = 50) after a close one.
    const partial = { ...matching(1, { from: 7 })[0], buyer_id: "dnd-mdn", buyer_en: "National Defence", provinces: [], notice_type_en: "Invitation to Qualify" };
    const m = await block(id, { plan: "pro", env: E({ open: [partial, ...OUTSIDE, ...matching(2)] }) });
    expect(m?.rows.map((r) => r.title)).toEqual(["Close match: Matching notice 0", "Close match: Matching notice 1", "Partial match: Matching notice 7"]);
    expect(m?.rows[2].detail).toBe("National Defence · closes 2026-11-20 · " +
      "UNSPSC class 821118 Editorial and support services: 5 award notices, 2 PSPC contract history records");
    // The week ends with the data date: a week later only that week's notices are new.
    const next = await fitDigestBlock(E({ day: "2026-11-09", open: [...matching(2), ...matching(1, { from: 5, seen: "2026-11-05", closing: "2026-11-27T14:00:00" })] }) as never, {
      userId: id, lang: "en", site: SITE, dataDate: "2026-11-09", plan: "free", now: new Date("2026-11-09T16:00:00Z"),
    });
    expect(next?.rows.map((r) => r.title)).toEqual(["Close match: Matching notice 5"]);
  });

  it("is null without a claim, without a block, for a record too thin, published contracts only or empty, and for a week with no new match", async () => {
    const unclaimed = await account({ claim: null });
    expect(await block(unclaimed.id)).toBeNull();
    const { id } = await account();
    // A profile written before the blocks, and one whose block does not read.
    expect(await block(id, { env: E({ block: undefined }) })).toBeNull();
    expect(await block(id, { env: E({ block: { ...BLOCK, n: "seven" } }) })).toBeNull();
    expect(await block(id, { env: E({ block: { ...BLOCK, n: [2, 1, 12], coded: [2, 1] } }) })).toBeNull();
    expect(await block(id, { env: E({ block: { ...BLOCK, n: [0, 0, 12], coded: [0, 0] } }) })).toBeNull();
    expect(await block(id, { env: E({ block: { ...BLOCK, n: [0, 0, 0], coded: [0, 0] } }) })).toBeNull();
    expect(await block(id, { env: E({ open: OUTSIDE }) })).toBeNull();
    expect(await block(id, { env: E({ open: [] }) })).toBeNull();
    // The organization claimed is gone from the data.
    const gone = await account({ claim: "org-a0000000ee" });
    expect(await block(gone.id)).toBeNull();
    // And the block reads for the same account when nothing stands in the way.
    expect(await block(id)).not.toBeNull();
  });

  it("is null when a file or the accounts database does not read, and never throws", async () => {
    const { id } = await account();
    expect(await block(id, { env: E({ open: "[{not json" }) })).toBeNull();
    expect(await block(id, { env: E({ open: undefined }) })).toBeNull();
    expect(await block(id, { env: onEnv({ ASSETS: makeFakeAssets({}, { ...files(), "profiles/a00.json": undefined }), NOW: `${D}T16:00:00Z` }) })).toBeNull();
    const broken = { prepare: () => { throw new Error("D1_ERROR: the database is not available"); } };
    expect(await block(id, { env: E({}, { ACCOUNTS: broken }) })).toBeNull();
    // The levels file only names a class: without it the code stands alone.
    const bare = await block(id, { env: E({}, { ASSETS: makeFakeAssets({}, { ...files(), "tenders/open-levels.json": undefined }) }) });
    expect(bare?.rows[0].detail).toBe("Public Services and Procurement Canada · closes 2026-11-20 · " +
      "UNSPSC class 821118: 5 award notices, 2 PSPC contract history records");
    // Before the claims table exists (the claim goes with it here).
    expect(await withoutTable("org_claims", () => block(id))).toBeNull();
  });

  it("reads the open notices once a run, whatever the accounts", async () => {
    const { assets, seen } = counted(files());
    const env = onEnv({ ASSETS: assets, NOW: `${D}T16:00:00Z` });
    const notices = weekNotices(env as never, D, new Date(`${D}T16:00:00Z`));
    for (let i = 0; i < 3; i++) {
      const { id } = await account();
      const m = await fitDigestBlock(env as never, { userId: id, lang: "en", site: SITE, dataDate: D, plan: "free", notices });
      expect(m?.rows).toHaveLength(3);
    }
    expect(seen.get("tenders/open.json")).toBe(1);
    expect(seen.get("tenders/open-levels.json")).toBe(1);
  });
});

// -- the messages -----------------------------------------------------------------------------------

describe("the messages", () => {
  it("put the block after the weekly email's figures and before the line on Pro, and add its count to the subject", async () => {
    const { id } = await account();
    const matches = await block(id);
    const site = weeklyDigest({ ...weeklyInput("en", { news: false }), matches });
    expect(site.subject).toBe("The week on Award Watch: 412 new tender notices, 5 matching notices");
    const figures = site.text.indexOf("1,250 contracts ending within 3 months");
    const heading = site.text.indexOf(`New open notices this week that match ${NAME1}`);
    expect(heading).toBeGreaterThan(figures);
    expect(site.text.indexOf("Free: 3 watches")).toBeGreaterThan(heading);
    const watch = weeklyDigest({ ...weeklyInput("en"), matches });
    expect(watch.subject).toBe("Your week: 8 updates on what you follow, 5 matching notices");
    expect(weeklyDigest({ ...weeklyInput("en", { news: false }), figures: { notices: null, closing: 1, awards: 0, ending: null }, matches }).subject)
      .toBe("The week on Award Watch, to 2026-10-31, 5 matching notices");
    const fr = weeklyDigest({ ...weeklyInput("fr", { news: false }), matches: await block(id, { lang: "fr" }) });
    expect(plain(fr.subject)).toBe("La semaine sur Award Watch : 412 nouveaux avis d'appel d'offres, 5 avis correspondants");
    // The HTML part: the rows link the notices, the disclaimer links the Terms' No Warranty section in full.
    const html = decode(site.html);
    expect(html).toContain(`<h2 class="ink" style="margin:18px 0 6px 0;`);
    expect(html).toContain(`href="${SITE}/tenders/cb-910-00000000"`);
    expect(html).toContain(`See the <a href="${SITE}/terms#warranty" style="color:#5b6b80;">Terms of Use</a>.`);
    expect(html).toContain(`<a href="${SITE}/account/matches" style="color:#334155;">2 more on the site</a>`);
    // Without a block the message is what it was.
    expect(weeklyDigest({ ...weeklyInput("en"), matches: null })).toEqual(weeklyDigest(weeklyInput("en")));
  });

  it("put the block in the watch mail after the organization's, alone under the organization's subject, or the block's heading alone", async () => {
    const { id } = await account();
    const matches = await block(id, { plan: "pro" });
    const opening = { subject: `Your organization this week: ${NAME1}`, heading: "Your organization: nothing new this week.", lines: [] };
    const base = { lang: "en" as const, to: "reader@example.com", site: SITE, dataDate: D, stopUrl: `${SITE}/account/stop?w=x&t=y`, watched: 1 };
    const both = watchDigest({ ...base, groups: [], total: 0, opening, matches });
    expect(both.subject).toBe(`Your organization this week: ${NAME1}`);
    expect(both.text.startsWith(`Your organization: nothing new this week.\n\nNew open notices this week that match ${NAME1}\n\n- Close match: Matching notice 0\n`)).toBe(true);
    expect(both.text).not.toContain("Your Watches");
    const alone = watchDigest({ ...base, groups: [], total: 0, matches });
    expect(alone.subject).toBe(`New open notices this week that match ${NAME1}`);
    // Beside watch events: the block before the watches, the watches' own subject.
    const group = { kind: "organization" as const, label: "Sample Harbour Marine Ltd.", path: "/organizations/org-a000000002", events: [] };
    const beside = watchDigest({ ...base, groups: [group], total: 1, opening, matches });
    expect(beside.subject).toBe("1 update on what you follow: Sample Harbour Marine Ltd.");
    expect(beside.text.indexOf("New open notices this week that match")).toBeLessThan(beside.text.indexOf("Your Watches"));
    expect(watchDigest({ ...base, groups: [group], total: 1, opening, matches: null })).toEqual(watchDigest({ ...base, groups: [group], total: 1, opening }));
  });
});

// -- which message, and when ----------------------------------------------------------------------------

const logLines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => c.join(" ")).join("\n");

describe("the runs", () => {
  it("read the weekly email's row by its key", async () => {
    const plan = ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${WEEKLY_MATCHES_SQL}`).bind("x").all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    expect(plan.some((s) => /weekly_mail USING INDEX sqlite_autoindex_weekly_mail_1/.test(s)), plan.join("\n")).toBe(true);
    expect(WEEKLY_MATCHES_SQL).toMatch(/LIMIT 1$/);
  });

  it("give the block to the weekly email while it is on from before the week or went this week, and to nothing else", async () => {
    await clean();
    const takes = async (weekly: NonNullable<Parameters<typeof account>[0]>["weekly"]) =>
      weeklyTakesMatches(onEnv() as never, (await account({ weekly })).id, D);
    expect(await takes({ mail: "on" })).toBe(true);
    // Turned on this Monday: its first message goes next week, so this week's block is the watch mail's.
    expect(await takes({ mail: "on", on: `${D}T08:00:00.000Z` })).toBe(false);
    // Turned off after this week's message went: that message had the block.
    expect(await takes({ mail: "off", lastWeek: D, status: "sent" })).toBe(true);
    expect(await takes({ mail: "off", lastWeek: "2026-10-26", status: "sent" })).toBe(false);
    expect(await takes({ mail: "off", lastWeek: D, status: "failed" })).toBe(false);
    expect(await takes(null)).toBe(false);
    expect(await withoutTable("weekly_mail", () => weeklyTakesMatches(onEnv() as never, "x", D))).toBe(false);
  });

  it("send a Free account's block in its weekly email, at its figure, with the subject's count and nothing new in the log", async () => {
    await clean();
    await seedRecords(D);
    const free = await account({ weekly: { mail: "on" } });
    const other = await account({ weekly: { mail: "on" }, claim: null });
    const mail = fakeMail();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = await runDeliveries(jobEnv(mail.binding));
      expect(report.weekly).toEqual({ sent: 2, failed: 0, waiting: 0, records: null });
      const [m] = mail.to(free.email);
      expect(m.subject).toBe("The week on Award Watch, to 2026-11-02, 5 matching notices");
      expect(m.text).toContain(`\n\n${FREE_EN}\n\n`);
      expect(m.html).toContain(`${SITE}/terms#warranty`);
      // An account that names no organization gets the message as it was.
      const [o] = mail.to(other.email);
      expect(o.subject).toBe("The week on Award Watch, to 2026-11-02");
      expect(o.text).not.toContain("matching");
      expect(o.text).not.toContain("Terms of Use");
      expect(logLines(log)).toContain("weekly email: 2 sent, 0 failed");
      expect(logLines(log)).not.toMatch(/match/i);
    } finally {
      log.mockRestore();
    }
  });

  it("send a Pro account's block in its weekly email when that is on, at Pro's figure, and leave its watch mail without it", async () => {
    await clean();
    await seedRecords(D);
    const pro = await account({ pro: true, weekly: { mail: "on" }, watch: true });
    const mail = fakeMail();
    const report = await runDeliveries(jobEnv(mail.binding, { open: matching(12) }));
    // The watch mail had nothing to say once the block was the weekly email's: no watch message.
    expect(report.watch).toMatchObject({ sent: 0, empty: 1 });
    expect(report.weekly).toMatchObject({ sent: 1 });
    const sent = mail.to(pro.email);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("The week on Award Watch, to 2026-11-02, 12 matching notices");
    expect((sent[0].text?.match(/^- Close match: /gm) ?? []).length).toBe(RULES.pro.match_mail);
    expect(sent[0].text).toContain(`2 more on the site: ${SITE}/account/matches`);
    expect(sent[0].text).not.toContain("Pro lists up to");
  });

  it("send a Pro account's block in its first watch message of the week when its weekly email is off, and never twice in the week", async () => {
    await clean();
    await seedRecords(D);
    const pro = await account({ pro: true, watch: true, weekly: { mail: "off" } });
    const open = [...matching(12), ...matching(1, { from: 20, seen: "2026-11-05", closing: "2026-11-27T14:00:00" })];
    const mail = fakeMail();
    const monday = await runDeliveries(jobEnv(mail.binding, { open }));
    expect(monday.watch).toMatchObject({ sent: 1 });
    const [m] = mail.to(pro.email);
    expect(m.subject).toBe(`Your organization this week: ${NAME1}`);
    expect(m.text).toContain(`Your organization: nothing new this week.\n\nNew open notices this week that match ${NAME1}\n\n`);
    expect((m.text?.match(/^- Close match: /gm) ?? []).length).toBe(RULES.pro.match_mail);
    expect(m.text).toContain(`Terms of Use: ${SITE}/terms#warranty`);
    expect(m.text).toContain("Contains information licensed under the Open Government Licence, Canada.");
    // The same day again, then Tuesday: nothing more, though a notice of the week is new on Tuesday's.
    await runDeliveries(jobEnv(mail.binding, { open }));
    await seedRecords("2026-11-05");
    const thursday = await runDeliveries(jobEnv(mail.binding, { open, day: "2026-11-05" }));
    expect(thursday.watch).toMatchObject({ sent: 0 });
    expect(mail.to(pro.email)).toHaveLength(1);
    // The next Monday: that week's first message carries that week's new match.
    await seedRecords("2026-11-09");
    await runDeliveries(jobEnv(mail.binding, { open, day: "2026-11-09" }));
    const sent = mail.to(pro.email);
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain("- Close match: Matching notice 20\n");
    expect(sent[1].text).not.toContain("Matching notice 0\n");
  });

  it("send the message whole, without the block, when a file the block reads does not", async () => {
    await clean();
    await seedRecords(D);
    const free = await account({ weekly: { mail: "on" } });
    const mail = fakeMail();
    const report = await runDeliveries(jobEnv(mail.binding, { open: "[{not json" }));
    expect(report.weekly).toMatchObject({ sent: 1, failed: 0 });
    const [m] = mail.to(free.email);
    expect(m.subject).toBe("The week on Award Watch, to 2026-11-02");
    expect(m.text).not.toContain("New open notices this week that match");
    expect(m.text).toContain("You receive this because you turned on the weekly email for your account.");
  });
});
