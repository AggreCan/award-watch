// Watches (src/account/watches.ts, watch_events.ts, watch_pages.tsx,
// watch_mail.ts; docs/accounts.md, Watches): the routes for Free and Pro,
// the caps held inside the insert, the claimed organization's watch outside
// them, CSRF, deletion, the return after sign-in, the merges followed; the watch mail against a local records database built
// from pipeline/records_schema.sql with rec_events rows written here (one
// message per account, grouped by watch, an event listed once across
// watches, a buyer's segment and threshold, count rows, the claim, the cap on
// rows, a stale or absent database, the stop link); the statements' plans
// and bounds; the console's figures. Every expected line is written out from
// the rows below, never read back from the code under test.
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runDeliveries } from "../src/account/deliveries";
import { valueChange } from "../src/account/digests";
import {
  DAY_SLOTS, EVENT_COUNTS_SQL, EVENT_KINDS, EVENT_ROWS_SQL, INDEX_OF, KINDS_FOR, NARROW_COUNTS_SQL, NARROW_ROWS_SQL, TARGET_CHUNK,
  WATCH_EVENTS_SQL, WATCH_KINDS, eventCounts, segmentOf, targetOf, watchPath,
} from "../src/account/watch_events";
import { ADD_WATCH_SQL, watchDetail, watchOverview } from "../src/account/watches";
import { ACCOUNTS, csrf, decode, get, grantPro, lastMail, nbsp, newEmail, onEnv, post, requestCode, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { makeFakeAssets } from "./assets";
import { applySql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const DAY = "2026-10-31"; // TEST_NOW's UTC date and the fixtures' data date
const SITE = "https://awardwatch.ca";
const FROM = "alerts@awardwatch.ca";
const EM_DASH = String.fromCharCode(0x2014);
const ORG = "org-a000000001"; // a profile the fixtures hold; org-a00000000f is an alias of it
const ORG_N = parseInt(ORG.slice(4), 16);

// -- the records database ------------------------------------------------------------------

type Ev = {
  day?: string; kind: string; src?: number | null; oid?: number | null; buyer?: string | null; sid?: number | null; ref?: string;
  cents?: number | null; ocents?: number | null; endd?: string | null; oendd?: string | null; closing?: string | null;
  oclosing?: string | null; namd?: number | null; title?: string | null; title_fr?: string | null; other?: string | null;
  other_fr?: string | null; horizon?: number | null; more?: number | null; path: string;
};
let k = 0;
const COLS = ["day", "kind", "src", "oid", "buyer", "sid", "ref", "cents", "ocents", "endd", "oendd", "closing", "oclosing", "namd", "title",
  "title_fr", "other", "other_fr", "horizon", "more", "path"] as const;

async function seedRecords(state = "ready", asOf = DAY): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["rec_events", "rec_meta", "rec_instruments"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', ?), ('as_of', ?), ('rules', '2')").bind(state, asOf).run();
}

async function events(rows: Ev[]): Promise<void> {
  await RECORDS.batch(rows.map((r) => {
    const v: Record<string, unknown> = { ...r, day: r.day ?? DAY, ref: r.ref ?? `event:${k + 1}` };
    return RECORDS.prepare(`INSERT INTO rec_events (k, ${COLS.join(", ")}) VALUES (?, ${COLS.map(() => "?").join(", ")})`)
      .bind(++k, ...COLS.map((c) => v[c] ?? null));
  }));
}

beforeAll(() => seedRecords());

// -- the accounts side ---------------------------------------------------------------------

let seq = 0;
const nextId = () => (0xa0000000 + ++seq).toString(16).padStart(32, "0");

async function makeUser(email: string, o: { lang?: "en" | "fr"; pro?: boolean; mail?: "on" | "off" } = {}): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', ?, 'active')")
    .bind(id, email, o.lang ?? "en").run();
  if (o.pro !== false) {
    await ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) " +
      "VALUES (?, ?, 'pro', 'manual', '2026-01-01T00:00:00.000Z', NULL, 'test', '2026-01-01T00:00:00.000Z')",
    ).bind(nextId(), id).run();
  }
  await ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, ?, ?)").bind(id, o.mail ?? "on", `2026-01-01T00:00:00.${String(seq).padStart(3, "0")}Z`).run();
  return id;
}

// What an organization watch stored before the standing offers' kinds followed; a new one follows them too.
const ORG_BEFORE = "award,grant,amended,cancelled,ends_12m,ends_6m,ended";
const ALL: Record<string, string> = {
  organization: `${ORG_BEFORE},instrument_gained,instrument_lost,instrument_expires_6m`,
  buyer: "notice,notice_amended,award,amended,cancelled,ends_12m,ends_6m,ended",
  contract: "amended,cancelled,ends_12m,ends_6m,ended",
  tender: "notice_amended,notice_closed,notice_cancelled,notice_awarded",
};

async function watch(user: string, kind: string, target: string, label: string,
  o: { events?: string; cadence?: string; last?: string | null; segment?: string } = {}) {
  const id = nextId();
  await ACCOUNTS.prepare(
    "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, user, kind, target, o.segment ?? "", label, o.events ?? ALL[kind], o.cadence ?? "daily",
    `2026-01-01T00:00:00.${String(seq).padStart(3, "0")}Z`, o.last === undefined ? "2026-10-30" : o.last).run();
  return id;
}

type Handed = { to: string; subject: string; text?: string; html?: string; headers?: Record<string, string> };

function fakeMail(fail: (to: string) => unknown = () => undefined) {
  const handed: Handed[] = [];
  const binding = {
    async send(message: Handed) {
      handed.push(message);
      const error = fail(message.to);
      if (error !== undefined) throw error;
      return { messageId: "<test@awardwatch.ca>" };
    },
  } as unknown as SendEmail;
  return { handed, binding, to: (email: string) => handed.filter((m) => m.to === email) };
}

const jobEnv = (mail: SendEmail, extra: Record<string, unknown> = {}) =>
  onEnv({ ASSETS: makeFakeAssets({}, {}), MAIL: mail, MAIL_FROM: FROM, MAIL_SENDER: undefined, ...extra });

const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

const mailRow = (user: string) =>
  ACCOUNTS.prepare("SELECT mail, secret, last_day, last_status, last_items, failed_day FROM watch_mail WHERE user_id = ?").bind(user)
    .first<{ mail: string; secret: string | null; last_day: string | null; last_status: string | null; last_items: number | null; failed_day: string | null }>();
const watchRows = async (user: string) =>
  (await ACCOUNTS.prepare("SELECT kind, target, label, events, cadence, last_sent_day FROM watches WHERE user_id = ? ORDER BY created_at, id").bind(user)
    .all<{ kind: string; target: string; label: string; events: string; cadence: string; last_sent_day: string | null }>()).results ?? [];
const runs = async (user: string) =>
  (await ACCOUNTS.prepare("SELECT day, items, status FROM watch_deliveries WHERE user_id = ? ORDER BY id").bind(user)
    .all<{ day: string; items: number; status: string }>()).results ?? [];

// -- the statements --------------------------------------------------------------------------

describe("the events statements", () => {
  const plan = async (sql: string, binds: (string | number)[]) =>
    ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...binds).all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail));
  const days = Array.from({ length: DAY_SLOTS }, (_, i) => (i === 0 ? DAY : ""));

  it("are bounded and seek each subject and day through the kind's index", async () => {
    expect(WATCH_EVENTS_SQL).toHaveLength(2 * WATCH_KINDS.length + 2);
    for (const kind of WATCH_KINDS) {
      for (const sql of [EVENT_ROWS_SQL[kind], EVENT_COUNTS_SQL[kind]]) {
        expect(sql, sql).toMatch(/LIMIT \d+$/);
        expect(sql, sql).toContain(`?${DAY_SLOTS + TARGET_CHUNK}`);
        expect(sql, sql).not.toContain(`?${DAY_SLOTS + TARGET_CHUNK + 1}`);
        const targets = Array.from({ length: TARGET_CHUNK }, (_, i) => (kind === "organization" ? (i === 0 ? ORG_N : -1) : i === 0 ? "x" : ""));
        const steps = await plan(sql, [...days, ...targets]);
        expect(steps.filter((s) => /^SCAN rec_events\b/.test(s)), `${sql}\n${steps.join("\n")}`).toEqual([]);
        expect(steps.some((s) => s.includes(`SEARCH rec_events USING INDEX ${INDEX_OF[kind]}`)), `${sql}\n${steps.join("\n")}`).toBe(true);
      }
      // An instrument's holders: one seek of its row per event row read, never a scan.
      const steps = await plan(EVENT_ROWS_SQL[kind], [...days, ...Array.from({ length: TARGET_CHUNK }, () => (kind === "organization" ? ORG_N : "x"))]);
      expect(steps.filter((s) => /^SCAN i\b|^SCAN rec_instruments\b/.test(s)), steps.join("\n")).toEqual([]);
      expect(steps.some((s) => /SEARCH i USING (COVERING )?INDEX rec_instruments_agr \(agr=\?\)/.test(s)), steps.join("\n")).toBe(true);
    }
    for (const sql of [NARROW_ROWS_SQL, NARROW_COUNTS_SQL]) {
      expect(sql).toMatch(/LIMIT \d+$/);
      const steps = await plan(sql, [...days, "dnd-mdn", 43]);
      expect(steps.filter((s) => /^SCAN rec_events\b/.test(s))).toEqual([]);
      // Either subject-first index seeks the pairs: the buyer and the day, or the segment and the day.
      expect(steps.some((s) => /SEARCH rec_events USING INDEX rec_events_(buyer|segment) /.test(s)), steps.join("\n")).toBe(true);
    }
    expect(DAY_SLOTS + TARGET_CHUNK).toBeLessThanOrEqual(100);
    expect(EVENT_KINDS).toEqual(["award", "grant", "amended", "cancelled", "ends_12m", "ends_6m", "ended", "notice", "notice_amended",
      "notice_closed", "notice_cancelled", "notice_awarded", "instrument_gained", "instrument_lost", "instrument_expires_6m"]);
  });

  it("take a target only as its page names it, a record by its rec_events ref", () => {
    expect(targetOf("organization", ORG)).toBe(ORG);
    expect(targetOf("organization", "org-A000000001")).toBeNull();
    expect(targetOf("buyer", "dnd-mdn")).toBe("dnd-mdn");
    expect(targetOf("contract", "contract:dnd-mdn:23240-220799/001/IM")).toBe("contract:dnd-mdn:23240-220799/001/IM");
    expect(targetOf("contract", "award:CB-400-1")).toBe("award:cb-400-1");
    expect(targetOf("contract", "history:h-1")).toBe("history:h-1");
    expect(targetOf("contract", "dnd-mdn:C-1")).toBeNull();
    expect(targetOf("contract", "contract::C-1")).toBeNull();
    expect(targetOf("tender", "tender:CB-100-1")).toBe("tender:cb-100-1");
    expect(targetOf("tender", "cb-100-1")).toBeNull();
    expect(segmentOf("43")).toBe("43");
    expect(segmentOf("")).toBe("");
    expect(segmentOf("99")).toBeNull();
    expect(watchPath("contract", "contract:dnd-mdn:23240-220799/001/IM")).toBe("/contracts/dnd-mdn/23240-220799%2F001%2FIM");
    expect(watchPath("contract", "award:cb-1")).toBe("/awards/cb-1");
    expect(watchPath("tender", "tender:cb-1")).toBe("/tenders/cb-1");
  });

  it("write an amendment's change in dollars and percent, in each language's form", () => {
    expect(valueChange("en", 12_000_000, 26_800_000)).toBe("+$148,000, +123%");
    expect(nbsp(valueChange("fr", 12_000_000, 26_800_000))).toBe("+148 000 $, +123 %");
    expect(valueChange("en", 10_000_000, 9_000_000)).toBe("-$10,000, -10%");
    expect(valueChange("en", 0, 500_000)).toBe("+$5,000");
  });
});

// -- the routes ----------------------------------------------------------------------------------

describe("the Follow control and the watch routes", () => {
  it("ask a reader not signed in for an address on the page, and give a signed-in reader the form", async () => {
    // The whole path of the signed-out form is test/accounts-follow.test.ts.
    const out = await (await get(`/organizations/${ORG}`)).text();
    expect(out).toContain('<form method="post" action="/account/sign-in" class="watch-control watch-signin">');
    expect(out).toContain(`<input type="hidden" name="next" value="/organizations/${ORG}"/><input type="hidden" name="follow" value="organization:${ORG}"/>`);
    const cookie = await signIn(newEmail("w-form"));
    const page = await (await get(`/organizations/${ORG}`, { cookie })).text();
    expect(page).toContain('<form method="post" action="/account/watches" class="watch-control">');
    expect(page).toContain(`<input type="hidden" name="target" value="${ORG}"/>`);
    // A buyer's form offers the whole buyer or one segment; an award notice's names its record.
    const buyer = await (await get("/buyers/pwgsc-tpsgc", { cookie })).text();
    expect(buyer).toContain('<select name="segment" aria-label="Follow"><option value="">The whole buyer</option><option value="10">');
    const award = await (await get("/awards/cb-400-40000004", { cookie })).text();
    expect(award).toContain('<input type="hidden" name="target" value="award:cb-400-40000004"/>');
  });

  it("return to the page asked for after signing in, and only to a page of the site", async () => {
    const email = newEmail("w-next");
    const form = await (await get(`/account/sign-in?next=%2Forganizations%2F${ORG}`)).text();
    expect(form).toContain(`<input type="hidden" name="next" value="/organizations/${ORG}"/>`);
    await post("/account/sign-in", { email, next: `/organizations/${ORG}` });
    expect((await lastMail(email))?.text).toContain(`&next=%2Forganizations%2F${ORG}`);
    const { code } = await requestCode(email);
    const res = await post("/account/check", { email, code, sent: "1", next: `/organizations/${ORG}` });
    expect(res.headers.get("location")).toBe(`/organizations/${ORG}`);
    const other = newEmail("w-next-bad");
    const second = await requestCode(other);
    const bad = await post("/account/check", { email: other, code: second.code, sent: "1", next: "//evil.example/x" });
    expect(bad.headers.get("location")).toBe("/account");
  });

  it("let a Free account follow a page, which then reads Following, and keep the label the site wrote", async () => {
    const email = newEmail("w-free");
    const cookie = await signIn(email);
    const token = await csrf(cookie);
    const res = await post("/account/watches", { csrf: token, kind: "organization", target: ORG }, { cookie });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/organizations/${ORG}`);
    const rows = await watchRows(await userId(email));
    expect(rows).toEqual([{ kind: "organization", target: ORG, label: rows[0].label, events: ALL.organization, cadence: "daily", last_sent_day: DAY }]);
    expect(rows[0].label.length).toBeGreaterThan(0);
    expect(await (await get(`/organizations/${ORG}`, { cookie })).text()).toContain('<a href="/account/watches" class="btn watch-on">');
    await post("/account/watches", { csrf: token, kind: "organization", target: ORG }, { cookie });
    expect(await watchRows(await userId(email))).toHaveLength(1);
  });

  it("refuse a Free account's fourth watch with the page's line, the Pro chip and a 403", async () => {
    const email = newEmail("w-cap");
    const cookie = await signIn(email);
    const id = await userId(email);
    for (const t of ["org-a000000002", "org-a000000003", "org-a000000004"]) await watch(id, "organization", t, t);
    const res = await post("/account/watches", { csrf: await csrf(cookie), kind: "organization", target: ORG }, { cookie });
    expect(res.status).toBe(403);
    const html = decode(await res.text());
    expect(html).toContain("This account follows 3 of 3 pages. Pro follows up to 25 and sends their events by email.");
    expect(html).toContain('class="pro-tag"');
    expect(await watchRows(id)).toHaveLength(3);
    const page = decode(await (await get(`/organizations/${ORG}`, { cookie })).text());
    expect(page).toContain('<p class="pro-note"><span class="pro-tag">');
    expect(page).not.toContain('action="/account/watches"');
  });

  it("hold the cap inside the insert when two posts come at once", async () => {
    const email = newEmail("w-race");
    const cookie = await signIn(email);
    const id = await userId(email);
    await watch(id, "organization", "org-a000000002", "x");
    await watch(id, "organization", "org-a000000003", "y");
    const token = await csrf(cookie);
    await Promise.all([
      post("/account/watches", { csrf: token, kind: "organization", target: ORG }, { cookie }),
      post("/account/watches", { csrf: token, kind: "buyer", target: "pwgsc-tpsgc" }, { cookie }),
    ]);
    expect(await watchRows(id)).toHaveLength(3);
  });

  it("refuse a post without the session's CSRF value, from another site, naming no page or no segment", async () => {
    const email = newEmail("w-csrf");
    const cookie = await signIn(email);
    expect((await post("/account/watches", { kind: "organization", target: ORG }, { cookie })).status).toBe(403);
    expect((await post("/account/watches", { csrf: await csrf(cookie), kind: "organization", target: ORG }, { cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await post("/account/watches", { csrf: await csrf(cookie), kind: "segment", target: "43" }, { cookie })).status).toBe(400);
    expect((await post("/account/watches", { csrf: await csrf(cookie), kind: "organization", target: "ORG-1" }, { cookie })).status).toBe(400);
    expect((await post("/account/watches", { csrf: await csrf(cookie), kind: "buyer", target: "pwgsc-tpsgc", segment: "99" }, { cookie })).status).toBe(400);
    expect(await watchRows(await userId(email))).toEqual([]);
  });

  it("keep a buyer watch narrowed to a segment apart from the whole buyer's", async () => {
    const email = newEmail("w-seg");
    const cookie = await signIn(email);
    const token = await csrf(cookie);
    await post("/account/watches", { csrf: token, kind: "buyer", target: "pwgsc-tpsgc", segment: "43" }, { cookie });
    await post("/account/watches", { csrf: token, kind: "buyer", target: "pwgsc-tpsgc", segment: "" }, { cookie });
    const segs = (await ACCOUNTS.prepare("SELECT segment FROM watches WHERE user_id = ? ORDER BY segment").bind(await userId(email))
      .all<{ segment: string }>()).results?.map((r) => r.segment);
    expect(segs).toEqual(["", "43"]);
  });

  it("let Pro follow 25, choose the events and the cadence of each, and turn the mail off", async () => {
    const email = newEmail("w-pro");
    const cookie = await signIn(email);
    await grantPro(email);
    const id = await userId(email);
    for (let i = 2; i <= 25; i++) await watch(id, "organization", `org-a0000000${String(i).padStart(2, "0")}`, `Org ${i}`);
    const token = await csrf(cookie);
    expect((await post("/account/watches", { csrf: token, kind: "buyer", target: "pwgsc-tpsgc" }, { cookie })).status).toBe(303);
    expect((await post("/account/watches", { csrf: token, kind: "organization", target: ORG }, { cookie })).status).toBe(403);
    const buyer = (await ACCOUNTS.prepare("SELECT id FROM watches WHERE user_id = ? AND kind = 'buyer'").bind(id).first<{ id: string }>())!.id;
    const saved = await post(`/account/watches/${buyer}`, { csrf: token, ev_notice: "1", ev_award: "1", ev_ends_6m: "0", cadence: "weekly" }, { cookie });
    expect(saved.headers.get("location")).toBe("/account/watches?m=changed");
    expect((await watchRows(id)).find((w) => w.kind === "buyer")).toMatchObject({ events: "notice,award", cadence: "weekly" });
    expect((await post(`/account/watches/${buyer}`, { csrf: token, cadence: "daily" }, { cookie })).headers.get("location"))
      .toBe("/account/watches?m=unchanged");
    expect((await post("/account/watches/mail", { csrf: token, mail: "off" }, { cookie })).status).toBe(303);
    expect((await mailRow(id))?.mail).toBe("off");
    expect((await post(`/account/watches/${buyer}/delete`, { csrf: token }, { cookie })).headers.get("location")).toBe("/account/watches?m=removed");
    expect(await watchRows(id)).toHaveLength(24);
  });

  it("keep the mail off for Free", async () => {
    const email = newEmail("w-free-mail");
    const cookie = await signIn(email);
    await post("/account/watches", { csrf: await csrf(cookie), kind: "organization", target: ORG }, { cookie });
    expect((await post("/account/watches/mail", { csrf: await csrf(cookie), mail: "on" }, { cookie })).headers.get("location"))
      .toBe("/account/watches?m=pro");
  });

  it("show the watches page with each watch's events, in both languages, private and unindexed", async () => {
    const email = newEmail("w-page");
    const cookie = await signIn(email);
    const id = await userId(email);
    await watch(id, "organization", ORG, "Exemplar Works Ltd.");
    await events([{ kind: "award", src: 1, oid: ORG_N, buyer: "pwgsc-tpsgc", cents: 4_000_000, endd: "2027-04-30", title: "Bridge inspection",
      path: "/awards/aw-9", ref: "award:aw-9", day: "2026-10-20" }]);
    const res = await get("/account/watches", { cookie });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const en = decode(await res.text());
    expect(en).toContain("<h1>Watches</h1>");
    expect(en).toContain('<a href="/awards/aw-9">Bridge inspection</a>');
    expect(en).toContain("New award or contract · Value $40,000 · Ends 2027-04-30 · First seen 2026-10-20");
    expect(en).toContain("Last event 2026-10-20");
    expect(en).toContain("Email of these events is part of Pro");
    const fr = nbsp(decode(await (await get("/account/watches?lang=fr", { cookie })).text()));
    expect(fr).toContain("<h1>Suivis</h1>");
    expect(fr).toContain("Nouvelle attribution ou nouveau contrat · Valeur : 40 000 $ · Prend fin le 2027-04-30 · Vu pour la première fois le 2026-10-20");
    for (const page of [en, fr]) expect(page).not.toContain(EM_DASH);
  });

  it("follow a merge: a watch on a retired id moves to the surviving one, or merges into the account's watch of it", async () => {
    const email = newEmail("w-alias");
    const cookie = await signIn(email);
    const id = await userId(email);
    await watch(id, "organization", "org-a00000000f", "Old name Ltd.");
    await watch(id, "buyer", "department-of-national-defence", "DND");
    await watch(id, "buyer", "dnd-mdn", "National Defence");
    const page = decode(await (await get("/account/watches", { cookie })).text());
    expect(page).toContain("Watches now following the organization or buyer theirs was merged into: 1.");
    expect(page).toContain("Watches removed because the account already followed the record theirs was merged into: 1.");
    expect((await watchRows(id)).map((w) => `${w.kind} ${w.target}`)).toEqual(["organization org-a000000001", "buyer dnd-mdn"]);
  });

  it("go with the account", async () => {
    const email = newEmail("w-delete");
    const cookie = await signIn(email);
    const id = await userId(email);
    await post("/account/watches", { csrf: await csrf(cookie), kind: "organization", target: ORG }, { cookie });
    await ACCOUNTS.prepare("INSERT INTO watch_deliveries (user_id, sent_at, day, items, status) VALUES (?, ?, ?, 1, 'sent')").bind(id, `${DAY}T15:00:00.000Z`, DAY).run();
    expect(await watchRows(id)).toHaveLength(1);
    const token = await csrf(cookie, "/account/delete");
    expect((await post("/account/delete", { csrf: token, confirm: "yes" }, { cookie })).status).toBe(200);
    expect(await watchRows(id)).toEqual([]);
    expect(await mailRow(id)).toBeNull();
    expect(await runs(id)).toEqual([]);
  });
});

// -- standing offers and supply arrangements ----------------------------------------------------

describe("an organization's standing offers and supply arrangements", () => {
  beforeEach(() => seedRecords());

  const RMSO = "E60ZT-120002/001/ZT";
  const SA = "E60ZT-120003/001/ZT";
  const RMSO_PATH = "/instruments/E60ZT-120002%2F001%2FZT";
  const SA_PATH = "/instruments/E60ZT-120003%2F001%2FZT";
  const DESC = { title: "Environmental consulting services", title_fr: "Services d'experts-conseils en environnement" };
  const RMSO_EN = "Regional Master Standing Offer";
  const RMSO_FR = "Offre à commandes principale régionale";

  // The three kinds for one organization: a gain in British Columbia, a loss in
  // Alberta, and a supply arrangement whose expiry entered the 6 months. The
  // regional offer has 14 holders in rec_instruments; the arrangement has no
  // row there, so its line names no count.
  const rows = (oid: number): Ev[] => [
    { kind: "instrument_gained", oid, ref: `sosa:${RMSO}`, endd: "2028-03-31", ...DESC, other: `${RMSO_EN} · British Columbia`,
      other_fr: `${RMSO_FR} · Colombie-Britannique`, path: RMSO_PATH },
    { kind: "instrument_lost", oid, ref: `sosa:${RMSO}`, endd: "2028-03-31", ...DESC, other: `${RMSO_EN} · Alberta`,
      other_fr: `${RMSO_FR} · Alberta`, path: RMSO_PATH },
    { kind: "instrument_expires_6m", oid, ref: `sosa:${SA}`, endd: "2027-04-30", horizon: 182, title: "Geospatial data services",
      title_fr: "Services de données géospatiales", other: "Supply Arrangement · National",
      other_fr: "Arrangement en matière d'approvisionnement · National", path: SA_PATH },
  ];
  const holders = () => RECORDS.prepare("INSERT INTO rec_instruments (k, agr, n, nw) VALUES (?, ?, 14, 1)").bind(++k, RMSO).run();

  it("are followed by a new organization watch, listed on its form, and left out of a watch stored before them", async () => {
    expect(KINDS_FOR.organization).toEqual(["award", "grant", "amended", "cancelled", "ends_12m", "ends_6m", "ended", "instrument_gained",
      "instrument_lost", "instrument_expires_6m"]);
    for (const kind of ["buyer", "contract", "tender"] as const) {
      expect(KINDS_FOR[kind].some((x) => x.startsWith("instrument_")), kind).toBe(false);
    }
    const email = newEmail("i-form");
    const cookie = await signIn(email);
    const id = await userId(email);
    await watch(id, "organization", ORG, "Exemplar Works Ltd.", { events: ORG_BEFORE });
    await events(rows(ORG_N));
    const page = decode(await (await get("/account/watches", { cookie })).text());
    for (const [kind, label] of [["instrument_gained", "Gained a standing offer or supply arrangement"],
      ["instrument_lost", "No longer holds a standing offer or supply arrangement"],
      ["instrument_expires_6m", "Instrument expires within 6 months"]]) {
      // Offered, unticked: the stored list stands until its reader ticks the box.
      expect(page).toMatch(new RegExp(`<input type="checkbox" name="ev_${kind}" value="1"/><span>${label}</span>`));
    }
    expect(page).not.toContain(RMSO_PATH);
    expect((await watchRows(id))[0].events).toBe(ORG_BEFORE);
    const token = await csrf(cookie);
    const watchId = (await ACCOUNTS.prepare("SELECT id FROM watches WHERE user_id = ?").bind(id).first<{ id: string }>())!.id;
    await post(`/account/watches/${watchId}`, { csrf: token, ev_award: "1", ev_instrument_gained: "1", cadence: "daily" }, { cookie });
    expect((await watchRows(id))[0].events).toBe("award,instrument_gained");
    const after = decode(await (await get("/account/watches", { cookie })).text());
    expect(after).toContain(`<a href="${RMSO_PATH}">${RMSO}</a>`);
    expect(after).toMatch(/<input type="checkbox" name="ev_instrument_gained" value="1" checked=""\/>/);
    expect(after).not.toContain("No longer holds a standing offer or supply arrangement · ");
  });

  it("show on the watches page of a Free account, each row under its agreement number, in both languages", async () => {
    const email = newEmail("i-page");
    const cookie = await signIn(email);
    await post("/account/watches", { csrf: await csrf(cookie), kind: "organization", target: ORG }, { cookie });
    await holders();
    await events(rows(ORG_N));
    const en = decode(await (await get("/account/watches", { cookie })).text());
    expect(en).toContain(`<li><a href="${RMSO_PATH}">${RMSO}</a><br/><span class="muted small">Gained a standing offer or supply arrangement · ` +
      `${RMSO_EN} · British Columbia · Environmental consulting services · expires 2028-03-31 · 14 holders · First seen ${DAY}</span></li>`);
    expect(en).toContain(`No longer holds a standing offer or supply arrangement · ${RMSO_EN} · Alberta · Environmental consulting services · ` +
      "expires 2028-03-31 · 14 holders");
    expect(en).toContain(`<a href="${SA_PATH}">${SA}</a><br/><span class="muted small">Instrument expires within 6 months · ` +
      `Supply Arrangement · National · Geospatial data services · expires 2027-04-30 · First seen ${DAY}</span>`);
    const fr = nbsp(decode(await (await get("/account/watches?lang=fr", { cookie })).text()));
    expect(fr).toContain(`<a href="${RMSO_PATH}">${RMSO}</a><br/><span class="muted small">A obtenu une offre à commandes ou un arrangement ` +
      `en matière d’approvisionnement · ${RMSO_FR} · Colombie-Britannique · Services d'experts-conseils en environnement · ` +
      `expire le 2028-03-31 · 14 titulaires · Vu pour la première fois le ${DAY}</span>`);
    expect(fr).toContain("Ne détient plus d’offre à commandes ou d’arrangement en matière d’approvisionnement · ");
    expect(fr).toContain("Instrument expirant d’ici 6 mois · Arrangement en matière d'approvisionnement · National · ");
    for (const page of [en, fr]) expect(page).not.toContain(EM_DASH);
  });

  it("are mailed to Pro as the specification's rows, the agreement number linking its page, in both languages", async () => {
    quiet();
    const mail = fakeMail();
    const en = newEmail("i-mail");
    const fr = newEmail("i-mail-fr");
    for (const [email, lang] of [[en, "en"], [fr, "fr"]] as const) {
      await watch(await makeUser(email, { lang }), "organization", "org-e000000006", "Exemplar Environmental Consulting Ltd.");
    }
    await holders();
    await events(rows(0xe000000006));
    await runDeliveries(jobEnv(mail.binding));
    const [m] = mail.to(en);
    expect(m.subject).toBe("3 updates on what you follow: Exemplar Environmental Consulting Ltd.");
    expect(m.text).toContain(`- ${RMSO}\n  Gained a standing offer or supply arrangement · ${RMSO_EN} · British Columbia · ` +
      `Environmental consulting services · expires 2028-03-31 · 14 holders\n  First seen ${DAY}\n  ${SITE}/instruments/E60ZT-120002%2F001%2FZT`);
    expect(m.text).toContain(`- ${RMSO}\n  No longer holds a standing offer or supply arrangement · ${RMSO_EN} · Alberta · ` +
      `Environmental consulting services · expires 2028-03-31 · 14 holders\n  First seen ${DAY}\n  ${SITE}${RMSO_PATH}`);
    expect(m.text).toContain(`- ${SA}\n  Instrument expires within 6 months · Supply Arrangement · National · Geospatial data services · ` +
      `expires 2027-04-30\n  First seen ${DAY}\n  ${SITE}${SA_PATH}`);
    expect(m.html).toContain(`href="${SITE}${RMSO_PATH}"`);
    const [f] = mail.to(fr);
    const text = nbsp(f.text!);
    expect(text).toContain(`- ${RMSO}\n  A obtenu une offre à commandes ou un arrangement en matière d’approvisionnement · ${RMSO_FR} · ` +
      `Colombie-Britannique · Services d'experts-conseils en environnement · expire le 2028-03-31 · 14 titulaires\n  ` +
      `Vu pour la première fois le ${DAY}\n  ${SITE}/instruments/E60ZT-120002%2F001%2FZT?lang=fr`);
    expect(text).toContain(`- ${SA}\n  Instrument expirant d’ici 6 mois · Arrangement en matière d'approvisionnement · National · ` +
      `Services de données géospatiales · expire le 2027-04-30\n`);
    for (const part of [m.subject, m.html!, m.text!, f.subject, f.html!, f.text!]) expect(part).not.toContain(EM_DASH);
  });

  it("list one offer gained in two regions on one day as two rows, neither taken for the other reached twice", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("i-regions");
    await watch(await makeUser(email), "organization", "org-e000000008", "Two Regions Ltd.");
    const [bc] = rows(0xe000000008);
    await events([bc, { ...bc, other: `${RMSO_EN} · Saskatchewan`, other_fr: `${RMSO_FR} · Saskatchewan` }]);
    await runDeliveries(jobEnv(mail.binding));
    const [m] = mail.to(email);
    expect(m.subject).toBe("2 updates on what you follow: Two Regions Ltd.");
    expect(m.text).toContain(`${RMSO_EN} · British Columbia · Environmental consulting services`);
    expect(m.text).toContain(`${RMSO_EN} · Saskatchewan · Environmental consulting services`);
    expect(m.text).not.toContain("Also on your watch");
  });

  it("count one holder in the singular", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("i-one");
    await watch(await makeUser(email), "organization", "org-e000000007", "Sole Holder Inc.");
    await RECORDS.prepare("INSERT INTO rec_instruments (k, agr, n, nw) VALUES (?, ?, 1, 0)").bind(++k, SA).run();
    await events([rows(0xe000000007)[2]]);
    await runDeliveries(jobEnv(mail.binding));
    expect(mail.to(email)[0].text).toContain("Geospatial data services · expires 2027-04-30 · 1 holder\n");
  });
});

// -- the claimed organization's watch -----------------------------------------------------------

describe("the claimed organization's watch, outside the cap", () => {
  const A2 = "org-a000000002"; // a second profile the fixtures hold
  const claim = (cookie: string, token: string, org: string) => post("/account/organization", { csrf: token, org }, { cookie });
  const follow = (cookie: string, token: string, kind: string, target: string) => post("/account/watches", { csrf: token, kind, target }, { cookie });
  const claimed = async (id: string) =>
    (await ACCOUNTS.prepare("SELECT organization_id FROM org_claims WHERE user_id = ?").bind(id).first<{ organization_id: string }>())?.organization_id;
  const OWN = "Your organization, outside the limit";

  it("is held by a Free account at its cap; a fourth ordinary watch is refused; once the claim goes it counts", async () => {
    const email = newEmail("w-own-free");
    const cookie = await signIn(email);
    const id = await userId(email);
    const others = ["org-a000000003", "org-a000000004", "org-a000000005"];
    for (const t of others) await watch(id, "organization", t, t);
    const token = await csrf(cookie);
    // The claim makes the organization's watch, at the cap.
    expect((await claim(cookie, token, ORG)).headers.get("location")).toBe("/account/organization?m=claimed");
    expect((await watchRows(id)).map((w) => w.target)).toEqual([...others, ORG]);
    const en = decode(await (await get("/account/watches", { cookie })).text());
    expect(en).toContain('<span class="panel-count">3 of 3, plus your organization</span>');
    expect(en.split(OWN)).toHaveLength(2);
    expect(en).toContain("This account follows 3 of 3 pages.");
    const fr = nbsp(decode(await (await get("/account/watches?lang=fr", { cookie })).text()));
    expect(fr).toContain('<span class="panel-count">3 sur 3, plus votre organisation</span>');
    expect(fr).toContain("Votre organisation, hors de la limite");
    for (const page of [en, fr]) expect(page).not.toContain(EM_DASH);
    expect(decode(await (await get("/account", { cookie })).text())).toContain('<span class="num">3 of 3, plus your organization</span>');
    // A fourth ordinary watch is refused with the page's line.
    const fourth = await follow(cookie, token, "buyer", "pwgsc-tpsgc");
    expect(fourth.status).toBe(403);
    expect(decode(await fourth.text())).toContain("This account follows 3 of 3 pages.");
    // Removed, the organization's page still offers the button at the cap, and the post passes; another page shows the cap.
    const own = (await ACCOUNTS.prepare("SELECT id FROM watches WHERE user_id = ? AND target = ?").bind(id, ORG).first<{ id: string }>())!.id;
    await post(`/account/watches/${own}/delete`, { csrf: token }, { cookie });
    expect(await (await get(`/organizations/${ORG}`, { cookie })).text()).toContain('<form method="post" action="/account/watches" class="watch-control">');
    expect(await (await get("/buyers/pwgsc-tpsgc", { cookie })).text()).not.toContain('action="/account/watches"');
    expect((await follow(cookie, token, "organization", ORG)).status).toBe(303);
    expect(await watchRows(id)).toHaveLength(4);
    // The claim removed: the watch stays and counts, the account is over its cap, and the next add is refused.
    await post("/account/organization/delete", { csrf: token }, { cookie });
    expect(await watchRows(id)).toHaveLength(4);
    const over = decode(await (await get("/account/watches", { cookie })).text());
    expect(over).toContain('<span class="panel-count">4 of 3</span>');
    expect(over).not.toContain(OWN);
    expect((await follow(cookie, token, "buyer", "pwgsc-tpsgc")).status).toBe(403);
    // A claim made while over the cap is saved, and its watch waits: moving the claim cannot pile watches up.
    expect((await claim(cookie, token, A2)).headers.get("location")).toBe("/account/organization?m=claimed_cap");
    expect(await claimed(id)).toBe(A2);
    expect(await watchRows(id)).toHaveLength(4);
    expect(decode(await (await get("/account/organization?m=claimed_cap", { cookie })).text()))
      .toContain("so the organization's watch was not added; remove a watch, then use Follow on its profile.");
  });

  it("is held by Pro beside its 25, every one listed and its events read", async () => {
    const email = newEmail("w-own-pro");
    const cookie = await signIn(email);
    await grantPro(email);
    const id = await userId(email);
    for (let i = 1; i <= 25; i++) await watch(id, "organization", `org-b0000000${String(i).padStart(2, "0")}`, `Org ${i}`);
    const token = await csrf(cookie);
    expect((await claim(cookie, token, ORG)).headers.get("location")).toBe("/account/organization?m=claimed");
    // The newest of 26 organization watches: listed and read like the others.
    expect(await watchRows(id)).toHaveLength(26);
    await events([{ kind: "award", src: 1, oid: ORG_N, buyer: "pwgsc-tpsgc", cents: 2_000_000, title: "Own organization award",
      path: "/awards/aw-own", ref: "award:aw-own", day: "2026-10-29" }]);
    const html = decode(await (await get("/account/watches", { cookie })).text());
    expect(html).toContain('<span class="panel-count">25 of 25, plus your organization</span>');
    expect(html).toContain(">Org 1</a>");
    expect(html).toContain('<a href="/awards/aw-own">Own organization award</a>');
    expect(html.split(OWN)).toHaveLength(2);
    expect((await follow(cookie, token, "buyer", "pwgsc-tpsgc")).status).toBe(403);
    expect(await watchRows(id)).toHaveLength(26);
  });

  it("compares surviving ids: the claim and the watches are moved past a merge before anything is counted", async () => {
    const insertClaim = (id: string, org: string) => ACCOUNTS.prepare(
      "INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?, ?, NULL, '[]', ?, ?)",
    ).bind(id, org, `${DAY}T00:00:00.000Z`, `${DAY}T00:00:00.000Z`).run();
    // The claim on the retired id, the watch on the surviving one.
    const one = newEmail("w-own-merge-1");
    const c1 = await signIn(one);
    const u1 = await userId(one);
    await insertClaim(u1, "org-a00000000f");
    await watch(u1, "organization", ORG, "Exemplar");
    await watch(u1, "organization", "org-a000000003", "x");
    await watch(u1, "organization", "org-a000000004", "y");
    expect((await follow(c1, await csrf(c1), "buyer", "pwgsc-tpsgc")).status).toBe(303);
    expect(await claimed(u1)).toBe(ORG);
    expect(await watchRows(u1)).toHaveLength(4);
    // The watch on the retired id, the claim on the surviving one.
    const two = newEmail("w-own-merge-2");
    const c2 = await signIn(two);
    const u2 = await userId(two);
    await insertClaim(u2, ORG);
    await watch(u2, "organization", "org-a00000000f", "Old name Ltd.");
    await watch(u2, "organization", "org-a000000003", "x");
    await watch(u2, "organization", "org-a000000004", "y");
    expect((await follow(c2, await csrf(c2), "buyer", "pwgsc-tpsgc")).status).toBe(303);
    expect((await watchRows(u2)).map((w) => w.target)).toEqual([ORG, "org-a000000003", "org-a000000004", "pwgsc-tpsgc"]);
    const page = decode(await (await get("/account/watches", { cookie: c2 })).text());
    expect(page).toContain('<span class="panel-count">3 of 3, plus your organization</span>');
  });

  it("reads the claim by its key and the watches through the account's index, in the one insert", async () => {
    const steps = ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${ADD_WATCH_SQL}`)
      .bind("w", "u", "organization", ORG, "label", "award", DAY, 3, DAY, "").all()).results ?? []).map((r) => String((r as { detail?: unknown }).detail));
    expect(steps.filter((x) => /^SCAN (watches|w|c|org_claims)\b/.test(x)), steps.join("\n")).toEqual([]);
    expect(steps.some((x) => /SEARCH c USING INDEX sqlite_autoindex_org_claims_1/.test(x)), steps.join("\n")).toBe(true);
  });
});

// -- the mail ---------------------------------------------------------------------------------

describe("the watch mail", () => {
  beforeEach(() => seedRecords());

  it("sends one message per account, grouped by watch, each event once, the kinds each follows and a buyer's notable amendments", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-one");
    const user = await makeUser(email);
    await watch(user, "buyer", "dnd-mdn", "National Defence");
    await watch(user, "organization", "org-e000000001", "Exemplar Works Ltd.", { events: "award" });
    await watch(user, "contract", "contract:dnd-mdn:C-1", "Translation", { cadence: "weekly", last: "2026-10-28" });
    await watch(user, "organization", "org-e000000002", "Harbour Survey Inc.");
    await events([
      { kind: "award", src: 1, oid: 0xe000000001, buyer: "dnd-mdn", cents: 125_000_000, title: "Hull repair", path: "/awards/aw-1", ref: "award:aw-1" },
      { kind: "amended", src: 2, oid: 0xe000000001, buyer: "dnd-mdn", cents: 26_800_000, ocents: 12_000_000, endd: "2027-01-20", oendd: "2026-12-31",
        namd: 1, title: "Boots", path: "/history/h-1", ref: "history:h-1" },
      { kind: "notice", buyer: "dnd-mdn", closing: "2026-11-20T14:00:00", title: "Survey services", path: "/tenders/cb-1", ref: "tender:cb-1" },
      { kind: "amended", src: 3, buyer: "dnd-mdn", cents: 11_000_000, ocents: 10_000_000, title: "Small change", path: "/contracts/dnd-mdn/C-9" },
      { kind: "notice", buyer: "dnd-mdn", day: "2026-10-30", title: "Old notice", path: "/tenders/cb-0" },
      { kind: "amended", src: 3, ref: "contract:dnd-mdn:C-1", cents: 15_000_000, ocents: 13_000_000, title: "Translation", path: "/contracts/dnd-mdn/C-3" },
    ]);
    const report = await runDeliveries(jobEnv(mail.binding));
    expect(report.watch).toMatchObject({ sent: 1, failed: 0, records: null });
    expect(mail.to(email)).toHaveLength(1);
    const [m] = mail.to(email);
    // The organization comes before the buyer, so the award both reach is listed under it and named on the buyer's.
    expect(m.subject).toBe("3 updates on what you follow: Exemplar Works Ltd., National Defence");
    const text = m.text!;
    expect(text).toContain("3 updates on 2 of the 4 pages you follow. Data date 2026-10-31.");
    expect(text.indexOf("\n\nEXEMPLAR WORKS LTD. · ORGANIZATION\n")).toBeLessThan(text.indexOf("\n\nNATIONAL DEFENCE · BUYER\n"));
    expect(text.indexOf("\n\nEXEMPLAR WORKS LTD. · ORGANIZATION\n")).toBeGreaterThan(0);
    expect(text).toContain("- Hull repair\n  New award or contract · Value $1,250,000\n  First seen 2026-10-31 · Also on your watch of National Defence\n  https://awardwatch.ca/awards/aw-1");
    expect(text.split("- Hull repair").length).toBe(2);
    expect(text).toContain("- Boots\n  Contract amended · $120,000 to $268,000 (+$148,000, +123%) · end moved from 2026-12-31 to 2027-01-20 · amendment 1\n  First seen 2026-10-31");
    expect(text).not.toContain("Small change");
    expect(text).not.toContain("Old notice");
    // The time left is read at the send time (TEST_NOW, noon Eastern on the data date) by the tender page's rule.
    expect(text).toContain("- Survey services\n  New tender notice · Closing date 2026-11-20 · Closes in 20 days\n  First seen 2026-10-31");
    expect(text).not.toContain("- Translation");
    const row = await mailRow(user);
    expect(row).toMatchObject({ last_day: DAY, last_status: "sent", last_items: 3 });
    expect(await runs(user)).toEqual([{ day: DAY, items: 3, status: "sent" }]);
    expect(m.headers?.["List-Unsubscribe"]).toBe(`<mailto:contact@awardwatch.ca>, <${SITE}/account/stop?w=${user}&t=${row!.secret}>`);
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(text).toContain(`Stop watch mail: ${SITE}/account/stop?w=${user}&t=${row!.secret}`);
    for (const part of [m.subject, m.html!, text]) expect(part).not.toContain(EM_DASH);
  });

  it("opens the weekly message with the account's organization block, and sends the block alone when the watches have nothing", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-org");
    const user = await makeUser(email);
    const at = "2026-10-01T00:00:00.000Z";
    await ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?, ?, NULL, '[]', ?, ?)")
      .bind(user, ORG, at, at).run();
    // A weekly watch due today with no event of its own; an award naming the organization in the week.
    await watch(user, "buyer", "dnd-mdn", "National Defence", { cadence: "weekly", last: "2026-10-23" });
    await events([{ kind: "award", src: 1, oid: ORG_N, cents: 50_000_000, title: "Survey", path: "/awards/aw-9", ref: "award:aw-9" }]);
    const report = await runDeliveries(jobEnv(mail.binding));
    expect(report.watch).toMatchObject({ sent: 1, empty: 0 });
    const [m] = mail.to(email);
    expect(m.subject).toMatch(/^Your organization this week: /);
    expect(m.text).toMatch(/^YOUR ORGANIZATION: EXEMPLAR TRANSLATION SERVICES INC\.\n  New records naming you this week: 1 \(1 award notice\) · https:\/\/awardwatch\.ca\/organizations\/org-a000000001\/records\n/);
    expect(m.text).not.toContain("updates on");
    for (const part of [m.subject, m.html!, m.text!]) expect(part).not.toContain(EM_DASH);
    // The data date is a Saturday: a daily account gets no block on it, and an empty daily message stays unsent.
    const other = newEmail("m-org-daily");
    const daily = await makeUser(other);
    await ACCOUNTS.prepare("INSERT INTO org_claims (user_id, organization_id, segment, competitors, created_at, updated_at) VALUES (?, ?, NULL, '[]', ?, ?)")
      .bind(daily, ORG, at, at).run();
    await watch(daily, "buyer", "dnd-mdn", "National Defence");
    const second = await runDeliveries(jobEnv(mail.binding));
    expect(second.watch).toMatchObject({ sent: 0, empty: 1 });
    expect(mail.to(other)).toHaveLength(0);
  });

  it("reads a buyer narrowed to a segment on that segment alone, every amendment in it", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-seg");
    const user = await makeUser(email);
    await watch(user, "buyer", "dnd-mdn", "National Defence", { segment: "43" });
    await events([
      { kind: "notice", buyer: "dnd-mdn", sid: 43, title: "Servers", path: "/tenders/cb-43", ref: "tender:cb-43" },
      { kind: "notice", buyer: "dnd-mdn", sid: 72, title: "Hull plates", path: "/tenders/cb-72", ref: "tender:cb-72" },
      { kind: "amended", src: 2, buyer: "dnd-mdn", sid: 43, cents: 11_000_000, ocents: 10_000_000, title: "Small IT change", path: "/history/h-43" },
    ]);
    await runDeliveries(jobEnv(mail.binding));
    const [m] = mail.to(email);
    expect(m.subject).toBe("2 updates on what you follow: National Defence · 43 IT and telecom");
    expect(m.text).toContain("Servers");
    expect(m.text).toContain("Small IT change");
    expect(m.text).not.toContain("Hull plates");
  });

  it("writes each kind's own line: cancelled, ended, a notice's closing moved and its award", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-kinds");
    const user = await makeUser(email);
    await watch(user, "contract", "history:h-5", "Boots");
    await watch(user, "tender", "tender:cb-5", "Dredging");
    await events([
      { kind: "cancelled", src: 2, ref: "history:h-5", ocents: 30_000_000, title: "Boots", path: "/history/h-5" },
      { kind: "ended", src: 2, ref: "history:h-5", endd: "2026-10-30", cents: 30_000_000, other: "Acme Defence Inc.", title: "Boots", path: "/history/h-5" },
      { kind: "notice_amended", src: 5, ref: "tender:cb-5", closing: "2026-11-20T14:00:00", oclosing: "2026-11-05T14:00:00", namd: 1, title: "Dredging", path: "/tenders/cb-5" },
      { kind: "notice_awarded", src: 5, ref: "tender:cb-5", other: "Harbour Survey Inc.", cents: 2_500_000, title: "Dredging", path: "/tenders/cb-5" },
    ]);
    await runDeliveries(jobEnv(mail.binding));
    const text = mail.to(email)[0].text!;
    expect(text).toContain("Contract cancelled · Value before $300,000");
    expect(text).toContain("Contract ended · Ended 2026-10-30 · Value $300,000 · Acme Defence Inc.");
    expect(text).toContain("Tender notice amended · Closing moved from 2026-11-05 to 2026-11-20 · Closes in 20 days\n");
    expect(text).toContain("Tender notice awarded · Awarded to Harbour Survey Inc. · Value $25,000\n");
  });

  it("says the time left on each new or amended notice's closing at the send time, as the tender page does, in both languages", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-closing");
    const user = await makeUser(email);
    const french = newEmail("m-closing-fr");
    const userFr = await makeUser(french, { lang: "fr" });
    for (const u of [user, userFr]) await watch(u, "buyer", "dnd-mdn", "National Defence", { events: "notice,notice_amended" });
    // TEST_NOW is 2026-10-31 16:00 UTC, noon Eastern: 20 days and 3 hours before the first closing (EST after November 1).
    await events([
      { kind: "notice", buyer: "dnd-mdn", closing: "2026-11-20T14:00:00", title: "Far closing", path: "/tenders/cb-c1", ref: "tender:cb-c1" },
      { kind: "notice", buyer: "dnd-mdn", closing: "2026-10-31T18:00:00", title: "Closing this afternoon", path: "/tenders/cb-c2", ref: "tender:cb-c2" },
      { kind: "notice", buyer: "dnd-mdn", closing: "2026-10-31T12:30:00", title: "Closing within the hour", path: "/tenders/cb-c3", ref: "tender:cb-c3" },
      { kind: "notice", buyer: "dnd-mdn", closing: "2026-10-30T14:00:00", title: "Closed yesterday", path: "/tenders/cb-c4", ref: "tender:cb-c4" },
      { kind: "notice", buyer: "dnd-mdn", closing: "2026-10-31", title: "Date only today", path: "/tenders/cb-c5", ref: "tender:cb-c5" },
      { kind: "notice", buyer: "dnd-mdn", closing: "2026-11-25", title: "Date only later", path: "/tenders/cb-c6", ref: "tender:cb-c6" },
      { kind: "notice_amended", buyer: "dnd-mdn", closing: "2026-11-02T14:00:00", oclosing: "2026-11-01T14:00:00", title: "Moved closing",
        path: "/tenders/cb-c7", ref: "tender:cb-c7" },
    ]);
    await runDeliveries(jobEnv(mail.binding));
    const text = mail.to(email)[0].text!;
    expect(text).toContain("- Far closing\n  New tender notice · Closing date 2026-11-20 · Closes in 20 days\n");
    expect(text).toContain("- Closing this afternoon\n  New tender notice · Closing date 2026-10-31 · Closes today at 18:00 ET\n");
    expect(text).toContain("- Closing within the hour\n  New tender notice · Closing date 2026-10-31 · Closes in 30 min\n");
    expect(text).toContain("- Closed yesterday\n  New tender notice · Closing date 2026-10-30 · Closing date passed\n");
    expect(text).toContain("- Date only today\n  New tender notice · Closing date 2026-10-31 · Closes today\n");
    // A date with no time that is not today says nothing the date does not.
    expect(text).toContain("- Date only later\n  New tender notice · Closing date 2026-11-25\n");
    // 2026-11-02 14:00 EST is 19:00 UTC: 2 days and 3 hours out.
    expect(text).toContain("- Moved closing\n  Tender notice amended · Closing moved from 2026-11-01 to 2026-11-02 · Closes in 2 days\n");
    // The HTML part carries the same line.
    expect(mail.to(email)[0].html).toContain("New tender notice · Closing date 2026-11-20 · Closes in 20 days");
    const fr = nbsp(mail.to(french)[0].text!);
    expect(fr).toContain(" · Date de clôture : 2026-11-20 · Clôture dans 20 jours\n");
    expect(fr).toContain("Date de clôture : 2026-10-30 · Date de clôture passée\n");
    expect(fr).toContain("Clôture aujourd");
    expect(fr).not.toContain("Closes in");
    for (const m of [mail.to(email)[0], mail.to(french)[0]]) for (const part of [m.subject, m.html!, m.text!]) expect(part).not.toContain(EM_DASH);
  });

  it("is written in the account's language", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-fr");
    const user = await makeUser(email, { lang: "fr" });
    await watch(user, "buyer", "dnd-mdn", "Défense nationale");
    await events([{ kind: "amended", src: 2, buyer: "dnd-mdn", cents: 26_800_000, ocents: 12_000_000, title: "Bottes", path: "/history/h-1" }]);
    await runDeliveries(jobEnv(mail.binding));
    const [m] = mail.to(email);
    expect(nbsp(m.subject)).toBe("1 nouveauté sur ce que vous suivez : Défense nationale");
    const text = nbsp(m.text!);
    expect(text).toContain("1 nouveauté sur 1 des 1 pages que vous suivez. Date des données : 2026-10-31.");
    expect(text).toContain("Contrat modifié · de 120 000 $ à 268 000 $ (+148 000 $, +123 %)");
    expect(text).toContain(`${SITE}/history/h-1?lang=fr`);
    expect(text).toContain("« Vu pour la première fois »");
  });

  it("turns a count row into how many more of the kind, with the page", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-count");
    const user = await makeUser(email);
    await watch(user, "buyer", "dnd-mdn", "National Defence");
    await events([
      { kind: "notice", buyer: "dnd-mdn", title: "One", path: "/tenders/cb-a", ref: "tender:cb-a" },
      { kind: "notice", buyer: "dnd-mdn", title: "Two", path: "/tenders/cb-b", ref: "tender:cb-b" },
      { kind: "notice", buyer: "dnd-mdn", more: 150, ref: "count:notice:dnd-mdn", path: "/buyers/dnd-mdn" },
    ]);
    await runDeliveries(jobEnv(mail.binding));
    const [m] = mail.to(email);
    expect(m.subject).toBe("152 updates on what you follow: National Defence");
    expect(m.text).toContain(`New tender notice: 150 more on the page: ${SITE}/buyers/dnd-mdn`);
  });

  it("follows a merge before reading: the event of the surviving id reaches the watch of the retired one", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-alias");
    const user = await makeUser(email);
    await watch(user, "organization", "org-a00000000f", "Old name Ltd.");
    await events([{ kind: "award", src: 1, oid: ORG_N, title: "Merged award", path: "/awards/aw-m", ref: "award:aw-m" }]);
    await runDeliveries(jobEnv(mail.binding));
    expect(mail.to(email)[0].text).toContain("Merged award");
    expect((await watchRows(user))[0].target).toBe(ORG);
  });

  it("never sends an empty message: nothing new covers the day and sends nothing", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-empty");
    const user = await makeUser(email);
    await watch(user, "organization", "org-e000000003", "Nobody Ltd.");
    const report = await runDeliveries(jobEnv(mail.binding));
    expect(mail.to(email)).toHaveLength(0);
    expect(report.watch?.empty).toBeGreaterThanOrEqual(1);
    expect(await mailRow(user)).toMatchObject({ last_day: DAY, last_status: "empty" });
    expect(await runs(user)).toEqual([{ day: DAY, items: 0, status: "empty" }]);
  });

  it("sends once when two runs meet, and not again in a later run the same day", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-claim");
    const user = await makeUser(email);
    await watch(user, "organization", "org-e000000004", "Twice Ltd.");
    await events([{ kind: "award", src: 1, oid: 0xe000000004, title: "Once", path: "/awards/aw-4" }]);
    const e = jobEnv(mail.binding);
    await Promise.all([runDeliveries(e), runDeliveries(e)]);
    await runDeliveries(e);
    expect(mail.to(email)).toHaveLength(1);
  });

  it("is not sent to Free accounts or a mail turned off", async () => {
    quiet();
    const mail = fakeMail();
    const free = await makeUser(newEmail("m-free"), { pro: false });
    const off = await makeUser(newEmail("m-off"), { mail: "off" });
    for (const u of [free, off]) await watch(u, "organization", "org-e000000005", "Quiet Ltd.");
    await events([{ kind: "award", src: 1, oid: 0xe000000005, title: "Unsent", path: "/awards/aw-5" }]);
    const report = await runDeliveries(jobEnv(mail.binding));
    expect(mail.handed.filter((m) => m.text?.includes("Unsent"))).toEqual([]);
    expect(report.watch?.skipped).toBeGreaterThanOrEqual(1);
  });

  it("lists ROWS_MAX rows in all, then a line per kind with how many more", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-rows");
    const user = await makeUser(email);
    const rows: Ev[] = [];
    for (let w = 1; w <= 6; w++) {
      await watch(user, "organization", `org-f00000000${w}`, `Busy ${w}`);
      for (let i = 0; i < 12; i++) rows.push({ kind: "award", src: 1, oid: 0xf000000000 + w, title: `Award ${w}.${i}`, path: `/awards/b${w}-${i}` });
    }
    await events(rows);
    await runDeliveries(jobEnv(mail.binding));
    const [m] = mail.to(email);
    expect(m.subject.startsWith("72 updates on what you follow: Busy 1, Busy 2")).toBe(true);
    expect(m.html!.match(/<tr><td class="rule"/g)).toHaveLength(50);
    expect(m.text).toContain("New award or contract: 2 more on the page");
    expect(m.text).toContain("New award or contract: 12 more on the page");
  });

  it("waits, unclaimed, while the records database is absent or behind, and the saved searches go on", async () => {
    const log = quiet();
    const mail = fakeMail();
    const email = newEmail("m-wait");
    const user = await makeUser(email);
    await watch(user, "organization", "org-e000000006", "Waiting Ltd.");
    let report = await runDeliveries(jobEnv(mail.binding, { RECORDS: undefined }));
    expect(report.outcome).toBe("done");
    expect(report.watch?.records).toBe("absent");
    expect((await mailRow(user))?.last_day).toBeNull();
    await seedRecords("ready", "2026-10-30");
    report = await runDeliveries(jobEnv(mail.binding));
    expect(report.watch?.records).toBe("stale");
    expect((await mailRow(user))?.last_day).toBeNull();
    const lines = log.mock.calls.flat().join("\n");
    expect(lines).toContain("accounts waiting: the records database is not at today's data date");
    expect(lines).not.toContain(email);
  });

  it("gives the claim back when the message is refused, and waits for the next data date", async () => {
    quiet();
    const email = newEmail("m-refused");
    const mail = fakeMail((to) => (to === email ? Object.assign(new Error("refused"), { code: "E_RECIPIENT_SUPPRESSED" }) : undefined));
    const user = await makeUser(email);
    await watch(user, "organization", "org-e000000007", "Refused Ltd.");
    await events([{ kind: "award", src: 1, oid: 0xe000000007, title: "Refused", path: "/awards/aw-7" }]);
    await runDeliveries(jobEnv(mail.binding));
    expect(await mailRow(user)).toMatchObject({ last_day: null, last_status: "failed", failed_day: DAY });
    expect(await runs(user)).toEqual([{ day: DAY, items: 1, status: "failed" }]);
    await runDeliveries(jobEnv(mail.binding));
    expect(mail.to(email)).toHaveLength(1);
  });

  it("ends a closed notice's watch after the message that carried its closing", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("m-closed");
    const user = await makeUser(email);
    await watch(user, "tender", "tender:cb-9-1", "Dredging");
    await events([{ kind: "notice_closed", src: 5, ref: "tender:cb-9-1", closing: "2026-10-30T14:00:00", title: "Dredging", path: "/tenders/cb-9-1" }]);
    await runDeliveries(jobEnv(mail.binding));
    expect(mail.to(email)[0].text).toContain("Tender notice closed · Closing date 2026-10-30\n  First seen 2026-10-31");
    expect(await watchRows(user)).toEqual([]);
  });

  it("ends a Free account's closed notice watch a week after the closing was found", async () => {
    quiet();
    const user = await makeUser(newEmail("m-free-closed"), { pro: false });
    await watch(user, "tender", "tender:cb-9-2", "Old dredging", { last: null });
    await watch(user, "tender", "tender:cb-9-3", "New dredging", { last: null });
    await events([
      { kind: "notice_closed", ref: "tender:cb-9-2", day: "2026-10-24", title: "Old dredging", path: "/tenders/cb-9-2" },
      { kind: "notice_cancelled", ref: "tender:cb-9-3", day: "2026-10-30", title: "New dredging", path: "/tenders/cb-9-3" },
    ]);
    await runDeliveries(jobEnv(fakeMail().binding));
    expect((await watchRows(user)).map((w) => w.target)).toEqual(["tender:cb-9-3"]);
  });
});

describe("the console's figures", () => {
  beforeEach(() => seedRecords());

  it("count watches by kind, accounts with mail on, the week's runs, and the data date's events by kind", async () => {
    quiet();
    const email = newEmail("c-one");
    const user = await makeUser(email);
    await watch(user, "organization", "org-e000000009", "Counted Ltd.");
    await events([
      { kind: "award", src: 1, oid: 0xe000000009, title: "Counted", path: "/awards/aw-c" },
      { kind: "notice", buyer: "dnd-mdn", more: 5, ref: "count:notice:dnd-mdn", path: "/buyers/dnd-mdn" },
    ]);
    await runDeliveries(jobEnv(fakeMail().binding));
    // The week is counted from the fixtures' clock, not the machine's: the runs above are stamped on the data date.
    const ov = await watchOverview(onEnv() as never, new Date(`${DAY}T23:59:59Z`));
    expect(ov?.byKind.find((k) => k.kind === "organization")?.n).toBeGreaterThanOrEqual(1);
    expect(ov?.mailOn).toBeGreaterThanOrEqual(1);
    expect(ov?.week.find((r) => r.status === "sent")?.n).toBeGreaterThanOrEqual(1);
    expect(await eventCounts(onEnv() as never)).toEqual({ asOf: DAY, byKind: [{ kind: "award", n: 1, capped: 0 }, { kind: "notice", n: 1, capped: 1 }] });
    const detail = await watchDetail(onEnv() as never, user);
    expect(detail?.watches.map((w) => w.target)).toEqual(["org-e000000009"]);
    expect(detail?.runs).toEqual([expect.objectContaining({ day: DAY, items: 1, status: "sent" })]);
  });
});

describe("the watch mail's stop link", () => {
  async function stoppable() {
    const user = await makeUser(newEmail("m-stop"));
    const secret = "d".repeat(31) + (seq % 10);
    await ACCOUNTS.prepare("UPDATE watch_mail SET secret = ? WHERE user_id = ?").bind(secret, user).run();
    return { user, secret, path: `/account/stop?w=${user}&t=${secret}` };
  }

  it("shows a button on GET and changes nothing; a POST turns the mail off and keeps the watches", async () => {
    const s = await stoppable();
    await watch(s.user, "organization", ORG, "Kept Ltd.");
    const page = await get(s.path);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Turn watch mail off");
    expect((await mailRow(s.user))?.mail).toBe("on");
    const done = await post("/account/stop", { w: s.user, t: s.secret }, { origin: null });
    expect(await done.text()).toContain("The email of your watches is off.");
    expect((await mailRow(s.user))?.mail).toBe("off");
    expect(await watchRows(s.user)).toHaveLength(1);
  });

  it("acts on a one-click post and answers a wrong secret with the site's 404", async () => {
    const s = await stoppable();
    const res = await post(s.path, { "List-Unsubscribe": "One-Click" }, { origin: null });
    expect(await res.text()).toBe("Watch mail is off.");
    expect((await mailRow(s.user))?.mail).toBe("off");
    expect((await get(`/account/stop?w=${s.user}&t=${"e".repeat(32)}`)).status).toBe(404);
  });
});
