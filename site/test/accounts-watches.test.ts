// Watches (src/account/watches.ts, watch_events.ts, watch_pages.tsx,
// watch_mail.ts; docs/accounts.md, Watches): the routes for Free and Pro,
// the caps held inside the insert, CSRF, deletion, the return after sign-in,
// the merges followed; the watch mail against a local records database built
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
  DAY_SLOTS, EVENT_COUNTS_SQL, EVENT_KINDS, EVENT_ROWS_SQL, INDEX_OF, NARROW_COUNTS_SQL, NARROW_ROWS_SQL, TARGET_SLOTS, WATCH_EVENTS_SQL,
  WATCH_KINDS, eventCounts, segmentOf, targetOf, watchPath,
} from "../src/account/watch_events";
import { watchDetail, watchOverview } from "../src/account/watches";
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
  oclosing?: string | null; namd?: number | null; title?: string | null; other?: string | null; more?: number | null; path: string;
};
let k = 0;
const COLS = ["day", "kind", "src", "oid", "buyer", "sid", "ref", "cents", "ocents", "endd", "oendd", "closing", "oclosing", "namd", "title",
  "other", "more", "path"] as const;

async function seedRecords(state = "ready", asOf = DAY): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.batch(["rec_events", "rec_meta"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
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

const ALL: Record<string, string> = {
  organization: "award,grant,amended,cancelled,ends_12m,ends_6m,ended",
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
        expect(sql, sql).toContain(`?${DAY_SLOTS + TARGET_SLOTS}`);
        expect(sql, sql).not.toContain(`?${DAY_SLOTS + TARGET_SLOTS + 1}`);
        const targets = Array.from({ length: TARGET_SLOTS }, (_, i) => (kind === "organization" ? (i === 0 ? ORG_N : -1) : i === 0 ? "x" : ""));
        const steps = await plan(sql, [...days, ...targets]);
        expect(steps.filter((s) => /^SCAN rec_events\b/.test(s)), `${sql}\n${steps.join("\n")}`).toEqual([]);
        expect(steps.some((s) => s.includes(`SEARCH rec_events USING INDEX ${INDEX_OF[kind]}`)), `${sql}\n${steps.join("\n")}`).toBe(true);
      }
    }
    for (const sql of [NARROW_ROWS_SQL, NARROW_COUNTS_SQL]) {
      expect(sql).toMatch(/LIMIT \d+$/);
      const steps = await plan(sql, [...days, "dnd-mdn", 43]);
      expect(steps.filter((s) => /^SCAN rec_events\b/.test(s))).toEqual([]);
      // Either subject-first index seeks the pairs: the buyer and the day, or the segment and the day.
      expect(steps.some((s) => /SEARCH rec_events USING INDEX rec_events_(buyer|segment) /.test(s)), steps.join("\n")).toBe(true);
    }
    expect(DAY_SLOTS + TARGET_SLOTS).toBeLessThanOrEqual(100);
    expect(EVENT_KINDS).toEqual(["award", "grant", "amended", "cancelled", "ends_12m", "ends_6m", "ended", "notice", "notice_amended",
      "notice_closed", "notice_cancelled", "notice_awarded"]);
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
  it("send a reader not signed in to sign in and back, and give a signed-in reader the form", async () => {
    const out = await (await get(`/organizations/${ORG}`)).text();
    expect(out).toContain(`<div class="watch-control"><a href="/account/sign-in?next=%2Forganizations%2F${ORG}" class="btn">Follow</a>`);
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
    expect(m.subject).toBe("3 watchlist events: Exemplar Works Ltd., National Defence");
    const text = m.text!;
    expect(text).toContain("3 events on 2 of the 4 pages you follow. Data date 2026-10-31.");
    expect(text.indexOf("Exemplar Works Ltd. · Organization")).toBeLessThan(text.indexOf("National Defence · Buyer"));
    expect(text).toContain("- Hull repair\n  New award or contract · Value $1,250,000\n  First seen 2026-10-31 · Also on your watch of National Defence\n  https://awardwatch.ca/awards/aw-1");
    expect(text.split("- Hull repair").length).toBe(2);
    expect(text).toContain("- Boots\n  Contract amended · $120,000 to $268,000 (+$148,000, +123%) · end moved from 2026-12-31 to 2027-01-20 · amendment 1\n  First seen 2026-10-31");
    expect(text).not.toContain("Small change");
    expect(text).not.toContain("Old notice");
    expect(text).toContain("- Survey services\n  New tender notice · Closes 2026-11-20\n  First seen 2026-10-31");
    expect(text).not.toContain("- Translation");
    const row = await mailRow(user);
    expect(row).toMatchObject({ last_day: DAY, last_status: "sent", last_items: 3 });
    expect(await runs(user)).toEqual([{ day: DAY, items: 3, status: "sent" }]);
    expect(m.headers?.["List-Unsubscribe"]).toBe(`<mailto:contact@awardwatch.ca>, <${SITE}/account/stop?w=${user}&t=${row!.secret}>`);
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(text).toContain(`Stop watch mail: ${SITE}/account/stop?w=${user}&t=${row!.secret}`);
    for (const part of [m.subject, m.html!, text]) expect(part).not.toContain(EM_DASH);
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
    expect(m.subject).toBe("2 watchlist events: National Defence · 43 IT and telecom");
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
    expect(text).toContain("Tender notice amended · Closing moved from 2026-11-05 to 2026-11-20");
    expect(text).toContain("Tender notice awarded · Awarded to Harbour Survey Inc. · Value $25,000");
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
    expect(nbsp(m.subject)).toBe("1 événement de suivi : Défense nationale");
    const text = nbsp(m.text!);
    expect(text).toContain("1 événement sur 1 des 1 pages que vous suivez. Date des données : 2026-10-31.");
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
    expect(m.subject).toBe("152 watchlist events: National Defence");
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
    expect(m.subject.startsWith("72 watchlist events: Busy 1, Busy 2")).toBe(true);
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
    const ov = await watchOverview(onEnv() as never);
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
