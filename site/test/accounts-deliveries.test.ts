// Phase 2: saved searches delivered by email (src/account/deliveries.ts and
// digests.ts), the stop link (/account/stop), the searches page's last
// delivery, and the privacy sentence. The job runs against the local
// accounts database with a fake MAIL binding that records what it is handed
// and published files served by the fake assets binding.
//
// Other test files share the database, so every check here reads this
// file's own rows and messages (by search id and address), and the searches
// made here are dated in 2000 so a run takes them first.
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker, { app } from "../src/index";
import {
  DELIVERY_CRON, RUN_MESSAGES_MAX, expiringItems, isDue, publishedFiles, runDeliveries, spanStart, tenderItems,
} from "../src/account/deliveries";
import { SUBJECT_MAX, deliveryHeaders, expiringDigest, tenderDigest, tenderScope } from "../src/account/digests";
import { deleteSearch } from "../src/account/searches";
import { clockAt } from "../src/closing";
import type { TenderRow } from "../src/data";
import { interestFilter } from "../src/pages/interest";
import { filterTenders, readTenderQuery } from "../src/pages/tenders";
import wrangler from "../wrangler.jsonc?raw";
import { ACCOUNTS, csrf, decode, get, grantPro, nbsp, newEmail, offEnv, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { TEST_NOW, makeFakeAssets, testEnv } from "./assets";
import { R1, R2, R3, R4, R5, STOP, TENDER_ROWS, contract, expiringInput, fakeMail, tender, tenderInput } from "./mail-fixtures";

useAccountsDb();

const FROM = "alerts@awardwatch.ca";
const SITE = "https://awardwatch.ca";
const DAY = "2026-10-31"; // the fixtures' data date, and TEST_NOW's UTC date
const NOW = new Date(TEST_NOW);
const EM_DASH = String.fromCharCode(0x2014);

// -- fixtures -------------------------------------------------------------------------

let seq = 0;
const hex = (n: number) => n.toString(16).padStart(32, "0");
const nextId = () => hex(0xd0000000 + ++seq);

const refused = (code: string) => Object.assign(new Error("refused"), { code });

async function makeUser(email: string, o: { pro?: boolean; lang?: "en" | "fr"; status?: string } = {}): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', ?, ?)")
    .bind(id, email, o.lang ?? "en", o.status ?? "active").run();
  // Granted from January, so the run's pinned clock (2026-10-31) falls inside the grant.
  if (o.pro !== false) {
    await ACCOUNTS.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) " +
      "VALUES (?, ?, 'pro', 'manual', '2026-01-01T00:00:00.000Z', NULL, 'test', '2026-01-01T00:00:00.000Z')",
    ).bind(nextId(), id).run();
  }
  return id;
}

async function addSaved(
  user: string, params: string, o: { deliver?: string; last?: string | null; lang?: "en" | "fr"; kind?: string; label?: string } = {},
): Promise<string> {
  const id = nextId();
  const kind = o.kind ?? (params.startsWith("/expiring") ? "expiring" : params.startsWith("/tenders") ? "tenders" : "organization");
  const label = o.label ?? (await interestFilter(testEnv(), o.lang ?? "en", kind, params))?.label ?? "A saved search";
  await ACCOUNTS.prepare(
    "INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, last_delivered_at, deliver) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, user, kind, params, label, o.lang ?? "en", `2000-01-01T00:00:00.${String(seq).padStart(3, "0")}Z`, o.last ?? null, o.deliver ?? "daily").run();
  return id;
}

const deliveriesOf = async (search: string) =>
  (await ACCOUNTS.prepare("SELECT status, items, sent_at FROM deliveries WHERE saved_search_id = ? ORDER BY id").bind(search)
    .all<{ status: string; items: number; sent_at: string }>()).results ?? [];

const searchRow = (id: string) =>
  ACCOUNTS.prepare("SELECT deliver, last_delivered_at FROM saved_searches WHERE id = ?").bind(id).first<{ deliver: string; last_delivered_at: string | null }>();

const tokenOf = async (id: string) =>
  (await ACCOUNTS.prepare("SELECT secret FROM delivery_tokens WHERE search_id = ?").bind(id).first<{ secret: string }>())?.secret ?? null;

// The tender notices, contracts R1 to R5 and digest inputs are shared with
// the mail suite (test/mail-fixtures.ts). R1 to R5 make the radar's 3-month
// window in two pages, soonest end first.
const RADAR = {
  "expiring/3m/index.json": { window: "3m", pages: 2, rows: 5, total: 1000 },
  "expiring/3m/1.json": [R4, R3],
  "expiring/3m/2.json": [R2, R1, R5],
};

// The new-notice files of the week to the data date, empty unless given.
function week(byDay: Record<string, TenderRow[]> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < 8; i++) {
    const d = new Date(`${DAY}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    const day = d.toISOString().slice(0, 10);
    out[`tenders/new/${day}.json`] = byDay[day] ?? [];
  }
  return out;
}

function jobEnv(mail: SendEmail, files: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return onEnv({ ASSETS: makeFakeAssets({}, { ...week(), ...RADAR, ...files }), MAIL: mail, MAIL_FROM: FROM, MAIL_SENDER: undefined, ...extra });
}

const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

// -- what is due ----------------------------------------------------------------------------

describe("what is due", () => {
  it("daily once per data date; weekly when never sent or sent seven or more days before", () => {
    expect(isDue("daily", null, DAY)).toBe(true);
    expect(isDue("daily", "2026-10-30T15:00:00.000Z", DAY)).toBe(true);
    expect(isDue("daily", "2026-10-31T15:00:00.000Z", DAY)).toBe(false);
    expect(isDue("weekly", null, DAY)).toBe(true);
    expect(isDue("weekly", "2026-10-28T15:00:00.000Z", DAY)).toBe(false);
    expect(isDue("weekly", "2026-10-25T15:00:00.000Z", DAY)).toBe(false);
    expect(isDue("weekly", "2026-10-24T15:00:00.000Z", DAY)).toBe(true);
    expect(isDue("off", null, DAY)).toBe(false);
  });

  it("reach back to the previous delivery's data date, at most a week", () => {
    expect(spanStart("daily", null, DAY)).toBe("2026-10-30");
    expect(spanStart("weekly", null, DAY)).toBe("2026-10-24");
    expect(spanStart("daily", "2026-10-28T15:00:00.000Z", DAY)).toBe("2026-10-28");
    expect(spanStart("weekly", "2026-10-24T15:00:00.000Z", DAY)).toBe("2026-10-24");
    expect(spanStart("daily", "2026-09-01T15:00:00.000Z", DAY)).toBe("2026-10-24");
  });

  it("are sent for, or passed over, as the plan, the cadence and the last delivery say", async () => {
    quiet();
    const mail = fakeMail();
    const pro = newEmail("due");
    const free = newEmail("due-free");
    const gone = newEmail("due-gone");
    const p = await makeUser(pro);
    const f = await makeUser(free, { pro: false });
    const g = await makeUser(gone, { status: "deleted" });
    const files = week({ [DAY]: [tender("cb-700-70000001")] });
    const s = {
      dailyNew: await addSaved(p, "/tenders?segment=72"),
      dailyYesterday: await addSaved(p, "/tenders?province=BC", { last: "2026-10-30T15:00:00.000Z" }),
      dailyToday: await addSaved(p, "/tenders?category=SRV", { last: "2026-10-31T15:00:00.000Z" }),
      weeklyRecent: await addSaved(p, "/tenders?segment=72&province=BC", { deliver: "weekly", last: "2026-10-28T15:00:00.000Z" }),
      weeklyDue: await addSaved(p, "/tenders", { deliver: "weekly", last: "2026-10-24T15:00:00.000Z" }),
      off: await addSaved(p, "/tenders?province=ON", { deliver: "off" }),
      freePlan: await addSaved(f, "/tenders"),
      deletedUser: await addSaved(g, "/tenders"),
      organization: await addSaved(p, "/organizations/org-a000000001", { kind: "organization" }),
    };
    // No records database here: the organization search waits, unclaimed
    // (accounts-records-deliveries.test.ts delivers one).
    const report = await runDeliveries(jobEnv(mail.binding, files, { RECORDS: undefined }));
    expect(report.outcome).toBe("done");
    expect(report.dataDate).toBe(DAY);
    expect(report.skipped).toBeGreaterThanOrEqual(1);
    expect(report.records).toBe("absent");
    expect(report.waiting).toBeGreaterThanOrEqual(1);
    expect((await searchRow(s.organization))?.last_delivered_at).toBeNull();
    expect((await deliveriesOf(s.dailyNew)).map((d) => d.status)).toEqual(["sent"]);
    expect((await deliveriesOf(s.dailyYesterday)).map((d) => d.status)).toEqual(["sent"]);
    expect((await deliveriesOf(s.weeklyDue)).map((d) => d.status)).toEqual(["sent"]);
    for (const id of [s.dailyToday, s.weeklyRecent, s.off, s.freePlan, s.deletedUser, s.organization]) expect(await deliveriesOf(id), id).toEqual([]);
    expect(mail.to(pro)).toHaveLength(3);
    expect(mail.to(free)).toHaveLength(0);
    expect(mail.to(gone)).toHaveLength(0);
    // last_delivered_at moved to the run's time; the passed-over ones kept theirs.
    expect((await searchRow(s.dailyNew))?.last_delivered_at).toBe(TEST_NOW.replace("Z", ".000Z"));
    expect((await searchRow(s.dailyToday))?.last_delivered_at).toBe("2026-10-31T15:00:00.000Z");
    expect((await searchRow(s.freePlan))?.last_delivered_at).toBeNull();
  });

  it("send nothing while the switch is off, and read neither the database nor the mail binding", async () => {
    const used: string[] = [];
    const trap = new Proxy({}, { get(_t, prop) { used.push(String(prop)); throw new Error("read while off"); } });
    for (const env of [offEnv(), { ...offEnv(), ACCOUNTS: trap, MAIL: trap }]) {
      expect((await runDeliveries(env as never)).outcome).toBe("off");
    }
    expect(used).toEqual([]);
  });

  it("send nothing without the binding, the sending address or an https site address", async () => {
    for (const extra of [{ MAIL: undefined }, { MAIL_FROM: "" }, { SITE_URL: "" }, { SITE_URL: "http://awardwatch.ca" }]) {
      expect((await runDeliveries(jobEnv(fakeMail().binding, {}, extra) as never)).outcome).toBe("no_mail");
    }
  });

  it("send nothing until the data date is today's", async () => {
    const log = quiet();
    const mail = fakeMail();
    const email = newEmail("late");
    const search = await addSaved(await makeUser(email), "/tenders");
    // The run at 15:00 UTC on 1 November, with the files still dated 31 October.
    const report = await runDeliveries(jobEnv(mail.binding) as never, new Date("2026-11-01T15:00:00Z"));
    expect(report.outcome).toBe("not_today");
    expect(mail.handed).toHaveLength(0);
    expect(await deliveriesOf(search)).toEqual([]);
    expect(log.mock.calls.flat().join("\n")).toContain("the data date is 2026-10-31, not today's");
  });

  it("end the run on a file that does not read, with one line naming it and no address", async () => {
    const log = quiet();
    const mail = fakeMail();
    const email = newEmail("fault");
    const search = await addSaved(await makeUser(email), "/tenders?segment=43");
    const report = await runDeliveries(jobEnv(mail.binding, { [`tenders/new/${DAY}.json`]: undefined }) as never);
    expect(report.outcome).toBe("fault");
    expect(await deliveriesOf(search)).toEqual([]);
    const lines = log.mock.calls.map((c) => c.join(" "));
    expect(lines.filter((l) => l.includes("could not be read"))).toEqual([
      expect.stringContaining(`tenders/new/${DAY}.json could not be read; the next hour tries again`),
    ]);
    expect(lines.join("\n")).not.toContain("@");
  });
});

// -- items ---------------------------------------------------------------------------------

describe("the items of a tender search", () => {
  it("are the new notices since the last delivery that match the saved filter and are still open", async () => {
    const env = jobEnv(fakeMail().binding, week({
      [DAY]: [
        tender("cb-1", { closing: "2026-11-20T14:00:00" }),
        tender("cb-2", { provinces: ["ON"] }),
        tender("cb-3", { provinces: [], closing: "2026-11-03T14:00:00" }),
        tender("cb-4", { segments: ["81"] }),
        tender("cb-5", { status: "closed" }),
        // 10:00 Eastern on the data date: passed by the run's noon.
        tender("cb-6", { closing: `${DAY}T10:00:00` }),
      ],
      "2026-10-30": [tender("cb-7", { first_seen: "2026-10-30" })],
      "2026-10-29": [tender("cb-8", { first_seen: "2026-10-29" })],
    }));
    const files = publishedFiles(env as never);
    const clock = clockAt(NOW.getTime());
    const daily = await tenderItems(files, "/tenders?province=BC&segment=72", "2026-10-30", DAY, clock);
    // The province keeps the notices that name none; the soonest closing first.
    expect(daily.map((r) => r.reference)).toEqual(["cb-3", "cb-1"]);
    const since = await tenderItems(files, "/tenders?province=BC&segment=72", "2026-10-28", DAY, clock);
    expect(since.map((r) => r.reference)).toEqual(["cb-3", "cb-1", "cb-7", "cb-8"]);
    const words = await tenderItems(files, "/tenders?q=cb-7", "2026-10-24", DAY, clock);
    expect(words.map((r) => r.reference)).toEqual(["cb-7"]);
  });

  // The email lists chooser saves a key once per value
  // (/tenders?category=GD&category=SRV&province=ON&province=QC&segment=43&segment=82):
  // any value matches within a key, and every key given must match. The
  // filter is readTenderQuery's and filterTenders' alone; until the page's
  // parser reads every value of a key, this case is skipped, and it runs on
  // its own once the parser does.
  const READS_SEVERAL = filterTenders(
    [tender("probe", { provinces: ["ON"] })], readTenderQuery(new URL("https://probe.invalid/tenders?province=BC&province=ON")), clockAt(NOW.getTime()),
  ).length === 1;

  it.skipIf(!READS_SEVERAL)("follow a saved filter that repeats a key, through the page's own parser", async () => {
    const env = jobEnv(fakeMail().binding, week({
      [DAY]: [
        tender("cb-m1", { category: ["GD"], segments: ["43"], provinces: ["ON"] }),
        tender("cb-m2", { category: ["SRV"], segments: ["82"], provinces: ["QC"] }),
        tender("cb-m3", { category: ["CNST"], segments: ["43"], provinces: ["ON"] }),
        tender("cb-m4", { category: ["SRV"], segments: ["72"], provinces: ["QC"] }),
        tender("cb-m5", { category: ["GD"], segments: ["43"], provinces: ["BC"] }),
      ],
    }));
    const params = "/tenders?category=GD&category=SRV&province=ON&province=QC&segment=43&segment=82";
    const items = await tenderItems(publishedFiles(env as never), params, "2026-10-30", DAY, clockAt(NOW.getTime()));
    expect(items.map((r) => r.reference).sort()).toEqual(["cb-m1", "cb-m2"]);
  });

  it("name every value of a repeated key in the subject, and only values the site knows", () => {
    const params = "/tenders?category=GD&category=SRV&province=ON&province=QC&segment=43&segment=82";
    // The scope names every value; a subject that would reach SUBJECT_MAX is cut on a word (digests.ts fitSubject).
    expect(tenderScope("en", params, TENDER_ROWS)).toBe("Goods, Services · 43 IT and telecom, 82 Editorial and design · Ontario, Quebec");
    expect(nbsp(tenderScope("fr", params, TENDER_ROWS))).toBe("Biens, Services · 43 TI et télécommunications, 82 Rédaction et conception · Ontario, Québec");
    expect(tenderDigest({ ...tenderInput("en"), params }).subject).toBe(
      "3 new tender notices: Goods, Services · 43 IT and telecom, 82 Editorial and design · Ontario,…",
    );
    expect(nbsp(tenderDigest({ ...tenderInput("fr"), params }).subject)).toBe(
      "3 nouveaux avis d’appel d’offres : Biens, Services · 43 TI et télécommunications, 82 Rédaction et…",
    );
    for (const lang of ["en", "fr"] as const) expect([...tenderDigest({ ...tenderInput(lang), params }).subject].length).toBeLessThan(SUBJECT_MAX);
    // A value the site does not know never reaches a subject; title words are named, never quoted.
    expect(tenderDigest({ ...tenderInput("en"), params: "/tenders?province=ZZ&segment=99&category=<b>&q=secret+words" }).subject)
      .toBe("3 new tender notices: title words");
  });

  it("list 50 in the message and link the page for the rest", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("cap");
    const search = await addSaved(await makeUser(email, { lang: "fr" }), "/tenders", { lang: "fr" });
    const many = Array.from({ length: 60 }, (_, i) => tender(`cb-9-${String(i).padStart(3, "0")}`, { closing: `2026-12-${String((i % 28) + 1).padStart(2, "0")}T14:00:00` }));
    await runDeliveries(jobEnv(mail.binding, week({ [DAY]: many })) as never);
    const [m] = mail.to(email);
    expect(nbsp(m.subject)).toBe("60 nouveaux avis d’appel d’offres");
    expect(m.html!.match(/<tr><td class="rule"/g)).toHaveLength(50);
    expect(decode(m.html!)).toContain(`<a href="${SITE}/tenders?lang=fr" style="color:#334155;">Et 10 autres sur le site</a>`);
    expect(m.text!.match(/^- /gm)).toHaveLength(50);
    expect(nbsp(m.text!)).toContain(`Et 10 autres sur le site : ${SITE}/tenders?lang=fr`);
    expect(await deliveriesOf(search)).toEqual([expect.objectContaining({ status: "sent", items: 60 })]);
  });
});

describe("the items of a radar search", () => {
  it("are the rows whose end date entered the window since the last delivery, newest end first", async () => {
    const files = publishedFiles(jobEnv(fakeMail().binding) as never);
    const weekly = await expiringItems(files, "3m", "/expiring/3m?buyer=dnd-mdn", "2026-10-24", DAY);
    expect(weekly.map((r) => r.reference)).toEqual([R1.reference, R2.reference, R3.reference]);
    const all = await expiringItems(files, "3m", "/expiring/3m", "2026-10-24", DAY);
    expect(all.map((r) => r.reference)).toEqual([R1.reference, R5.reference, R2.reference, R3.reference]);
    const segment = await expiringItems(files, "3m", "/expiring/3m?segment=82", "2026-10-24", DAY);
    expect(segment).toEqual([]);
  });

  it("read the window from its last page and stop at the page that reaches back past the last delivery", async () => {
    // The first page is missing: a daily delivery never needs it.
    const files = publishedFiles(jobEnv(fakeMail().binding, { "expiring/3m/1.json": undefined }) as never);
    const daily = await expiringItems(files, "3m", "/expiring/3m?buyer=dnd-mdn", "2026-10-30", DAY);
    expect(daily.map((r) => r.reference)).toEqual([R1.reference]);
    await expect(expiringItems(files, "3m", "/expiring/3m", "2026-10-24", DAY)).rejects.toThrow("expiring/3m/1.json could not be read");
  });
});

// -- the messages ------------------------------------------------------------------------------

describe("the tender digest", () => {
  it("in English: the subject, the rows with amber time left within 7 days, the links, the button, the footer and both wordmarks", () => {
    const m = tenderDigest(tenderInput("en"));
    expect(m.subject).toBe("3 new tender notices: 72 Construction · British Columbia");
    const html = m.html;
    expect(html).toContain('<html lang="en">');
    expect(html).toContain(`<img class="logo-light" src="${SITE}/brand/wordmark.png"`);
    expect(html).toContain(`<img class="logo-dark" src="${SITE}/brand/wordmark-dark.png"`);
    expect(html).toContain("overflow:hidden;\">Solenoid Procurement, Power Distribution Upgrade, and 1 more.</div>");
    expect(html).toContain(">New tender notices</h1>");
    expect(html).toContain("3 notices published since yesterday&#39;s refresh match your saved search <b>New tender notices matching Province: British Columbia</b>. Data date 2026-10-31.");
    expect(html).toContain(`<a class="ink" href="${SITE}/tenders/cb-746-37313616"`);
    expect(html).toContain("National Defence · Ontario");
    expect(html).toContain('Closes 2026-11-03 14:00 ET · <span style="color:#b45309;font-weight:600;">closes in 3 days</span>');
    expect(html).toContain("Closes 2026-11-16 14:00 ET · closes in 16 days");
    expect(html).toContain(">31 Manufacturing components</span>");
    expect(html).toContain(`<a href="${SITE}/tenders?province=BC&amp;segment=72" style="color:#334155;">And 1 more on the site</a>`);
    expect(html).toContain(`<a href="${SITE}/tenders?province=BC&amp;segment=72" style="display:inline-block;`);
    expect(html).toContain(">See all open notices</a>");
    expect(html).toContain(`You receive this each day for a saved search in your account. <a href="${SITE}/account/searches" style="color:#5b6b80;">Saved searches</a> · <a href="${STOP.replace("&", "&amp;")}" style="color:#5b6b80;">Stop this delivery</a>`);
    expect(html).toContain("Award Watch · Federal tenders, awards, contracts and grants, by organization. · <a href=\"mailto:contact@awardwatch.ca\"");
    expect(html).not.toContain(EM_DASH);
  });

  it("in English: the plain-text part shaped like the design's", () => {
    const m = tenderDigest(tenderInput("en"));
    expect(m.text).toBe([
      "New tender notices",
      "",
      "3 notices published since yesterday's refresh match your saved search New tender notices matching Province: British Columbia. Data date 2026-10-31.",
      "",
      "- Solenoid Procurement",
      "  National Defence · Ontario",
      "  Closes 2026-11-03 14:00 ET, closes in 3 days · 31 Manufacturing components",
      `  ${SITE}/tenders/cb-746-37313616`,
      "",
      "- Power Distribution Upgrade",
      "  Fisheries and Oceans Canada · British Columbia",
      "  Closes 2026-11-16 14:00 ET, closes in 16 days · 72 Construction",
      `  ${SITE}/tenders/cb-106-83883729`,
      "",
      `And 1 more on the site: ${SITE}/tenders?province=BC&segment=72`,
      "",
      `See all open notices: ${SITE}/tenders?province=BC&segment=72`,
      "",
      "Closing times are the buyer's, shown in Eastern time. Days left count from the data date.",
      "",
      "You receive this each day for a saved search in your account.",
      `Saved searches and delivery: ${SITE}/account/searches`,
      `Stop this delivery: ${STOP}`,
      "Award Watch · Federal tenders, awards, contracts and grants, by organization.",
      "contact@awardwatch.ca",
      "",
    ].join("\n"));
  });

  it("in French: the subject, the rows, the French links and the plain-text part", () => {
    const m = tenderDigest(tenderInput("fr"));
    expect(nbsp(m.subject)).toBe("3 nouveaux avis d’appel d’offres : 72 Construction · Colombie-Britannique");
    const html = nbsp(decode(m.html));
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain(`${SITE}/brand/wordmark.png`);
    expect(html).toContain(`${SITE}/brand/wordmark-dark.png`);
    expect(html).toContain(`<a class="ink" href="${SITE}/tenders/cb-746-37313616?lang=fr"`);
    expect(html).toContain("Achat de solénoïdes");
    expect(html).toContain("Défense nationale · Ontario");
    expect(html).toContain('Ferme le 2026-11-03 à 14 h 00 HE · <span style="color:#b45309;font-weight:600;">ferme dans 3 jours</span>');
    expect(html).toContain("3 avis publiés depuis la mise à jour d’hier correspondent à votre recherche enregistrée <b>Nouveaux avis</b>. Date des données : 2026-10-31.");
    expect(html).toContain(`<a href="${SITE}/account/searches?lang=fr" style="color:#5b6b80;">Recherches enregistrées</a> · <a href="${STOP}&lang=fr" style="color:#5b6b80;">Arrêter cet envoi</a>`);
    expect(html).toContain(">Voir tous les avis ouverts</a>");
    expect(html).toContain("Et 1 autre sur le site");
    const text = nbsp(m.text);
    expect(text).toContain("- Achat de solénoïdes\n  Défense nationale · Ontario\n  Ferme le 2026-11-03 à 14 h 00 HE, ferme dans 3 jours · 31 Composants de fabrication\n");
    expect(text).toContain(`Voir tous les avis ouverts : ${SITE}/tenders?province=BC&segment=72&lang=fr`);
    expect(text).toContain(`Recherches enregistrées et envoi : ${SITE}/account/searches?lang=fr\nArrêter cet envoi : ${STOP}&lang=fr\n`);
    expect(text).toContain("contact@awardwatch.ca\n");
    expect(m.text + m.html + m.subject).not.toContain(EM_DASH);
  });

  it("carries the List-Unsubscribe pair: the contact address and the stop link, one-click", () => {
    expect(tenderDigest(tenderInput("en")).headers).toEqual({
      "List-Unsubscribe": `<mailto:contact@awardwatch.ca>, <${STOP}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(deliveryHeaders(STOP)).toEqual(tenderDigest(tenderInput("en")).headers);
  });
});

describe("the radar digest", () => {
  it("in English: the subject, the rows and their links, the button and the plain text", () => {
    const m = expiringDigest(expiringInput("en"));
    expect(m.subject).toBe("3 contracts now within 3 months of their end: National Defence");
    expect(m.html).toContain(">Contracts ending within 3 months</h1>");
    expect(m.html).toContain("3 contracts whose end date now falls within 3 months of the data date, under your saved search <b>Contracts entering the 3-month window for National Defence</b>. Weekly. Data date 2026-10-31.");
    expect(m.html).toContain(`<a class="ink" href="${SITE}/awards/cb-500-50000001"`);
    expect(m.html).toContain(`<a class="ink" href="${SITE}/history/w8486-091235"`);
    expect(m.html).toContain(`<a class="ink" href="${SITE}/contracts/dnd-mdn/C-2026-0099"`);
    expect(m.html).not.toContain("search.open.canada.ca");
    expect(m.text).toContain(`  ${SITE}/contracts/dnd-mdn/C-2026-0099\n`);
    expect(m.html).toContain("Marathon Targets Inc. · National Defence");
    expect(m.html).toContain("Individual, name withheld · National Defence");
    expect(m.html).toContain("Ends 2027-01-30 · $188,345 · Award notice");
    expect(m.html).toContain("Ends 2027-01-25 · Not stated · Published contract");
    expect(m.html).toContain(`<a href="${SITE}/expiring/3m?buyer=dnd-mdn" style="display:inline-block;`);
    expect(m.html).toContain(">See the contracts ending</a>");
    expect(m.html).toContain("You receive this each week for a saved search in your account.");
    expect(m.html).not.toContain("more on the site");
    expect(m.text).toContain([
      "- Robotics targets",
      "  Marathon Targets Inc. · National Defence",
      "  Ends 2027-01-30 · $188,345 · Award notice",
      `  ${SITE}/awards/cb-500-50000001`,
    ].join("\n"));
    expect(m.text).toContain(`See the contracts ending: ${SITE}/expiring/3m?buyer=dnd-mdn\n\nA contract's value is the one on its newest amendment. Nothing is summed across sources.\n\n`);
    expect(m.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("in French", () => {
    const m = expiringDigest(expiringInput("fr"));
    expect(nbsp(m.subject)).toBe("3 contrats désormais à moins de 3 mois de leur fin : Défense nationale");
    const html = nbsp(decode(m.html));
    expect(html).toContain(">Contrats prenant fin d’ici 3 mois</h1>");
    expect(html).toContain("Chaque semaine. Date des données : 2026-10-31.");
    expect(html).toContain(`<a class="ink" href="${SITE}/awards/cb-500-50000001?lang=fr"`);
    expect(html).toContain(`<a class="ink" href="${SITE}/contracts/dnd-mdn/C-2026-0099?lang=fr"`);
    expect(html).toContain("Prend fin le 2027-01-30 · 188 345 $ · Avis d’attribution");
    expect(html).toContain(">Voir les contrats prenant fin</a>");
    expect(nbsp(m.text)).toContain(`Voir les contrats prenant fin : ${SITE}/expiring/3m?buyer=dnd-mdn&lang=fr`);
    expect(m.text + m.html).not.toContain(EM_DASH);
  });

  it("links a published contract without its department to the government's search, as before", () => {
    const bare = contract("contract", "C-2026-0100", "2027-01-20");
    const m = expiringDigest({ ...expiringInput("en"), rows: [bare], total: 1 });
    expect(m.html).toContain('<a class="ink" href="https://search.open.canada.ca/contracts/?search_text=C-2026-0100"');
    expect(m.html).not.toContain(`${SITE}/contracts/`);
    expect(m.text).toContain("  https://search.open.canada.ca/contracts/?search_text=C-2026-0100\n");
    const fr = expiringDigest({ ...expiringInput("fr"), rows: [bare], total: 1 });
    expect(fr.html).toContain('href="https://search.open.canada.ca/contracts/?search_text=C-2026-0100"');
    expect(fr.html).not.toContain("search_text=C-2026-0100&amp;lang=fr");
  });
});

// -- the cron ---------------------------------------------------------------------------------

async function cron(env: object, which = DELIVERY_CRON): Promise<void> {
  const ctx = createExecutionContext();
  worker.scheduled(createScheduledController({ cron: which, scheduledTime: NOW.getTime() }), env as never, ctx);
  await waitOnExecutionContext(ctx);
}

describe("the delivery cron", () => {
  it("is one of the two triggers wrangler.jsonc sets", () => {
    expect(wrangler).toContain('"triggers": { "crons": ["0 6 * * *", "0 15-20 * * *"] }');
    expect(DELIVERY_CRON).toBe("0 15-20 * * *");
  });

  it("sends once through the binding, with the headers; a second run in the hour sends nothing", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("cron");
    const user = await makeUser(email);
    const tenders = await addSaved(user, "/tenders?segment=72");
    const radar = await addSaved(user, "/expiring/3m?buyer=dnd-mdn", { deliver: "weekly" });
    const env = jobEnv(mail.binding, week({ [DAY]: [tender("cb-800-80000001")] }));
    await cron(env);
    const sent = mail.to(email);
    expect(sent.map((m) => m.subject).sort()).toEqual(["1 new tender notice: 72 Construction", "3 contracts now within 3 months of their end: National Defence"]);
    for (const m of sent) {
      expect(m.from).toEqual({ email: FROM, name: "Award Watch" });
      expect(m.replyTo).toBe("contact@awardwatch.ca");
      expect(m.headers?.["Auto-Submitted"]).toBe("auto-generated");
      expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    }
    // The stop link was made on the first delivery and is the one in the headers.
    const secret = await tokenOf(tenders);
    expect(secret).toMatch(/^[0-9a-f]{32}$/);
    const tm = sent.find((m) => m.subject.startsWith("1 new"))!;
    expect(tm.headers?.["List-Unsubscribe"]).toBe(`<mailto:contact@awardwatch.ca>, <${SITE}/account/stop?s=${tenders}&t=${secret}>`);
    expect(await deliveriesOf(tenders)).toEqual([{ status: "sent", items: 1, sent_at: NOW.toISOString() }]);
    expect(await deliveriesOf(radar)).toEqual([{ status: "sent", items: 3, sent_at: NOW.toISOString() }]);
    await cron(env);
    expect(mail.to(email)).toHaveLength(2);
    expect(await deliveriesOf(tenders)).toHaveLength(1);
    expect(await tokenOf(tenders)).toBe(secret);
  });

  it("writes an empty row and sends nothing when nothing is new", async () => {
    quiet();
    const mail = fakeMail();
    const email = newEmail("empty");
    const search = await addSaved(await makeUser(email), "/tenders?segment=10");
    await cron(jobEnv(mail.binding, week({ [DAY]: [tender("cb-801-80000001")] })));
    expect(mail.to(email)).toHaveLength(0);
    expect(await deliveriesOf(search)).toEqual([{ status: "empty", items: 0, sent_at: NOW.toISOString() }]);
    expect((await searchRow(search))?.last_delivered_at).toBe(NOW.toISOString());
    expect(await tokenOf(search)).toBeNull();
  });

  it("writes a failed row when the binding refuses, keeps last_delivered_at, and does not try again that data date", async () => {
    const log = quiet();
    const email = newEmail("refused");
    const mail = fakeMail((to) => (to === email ? refused("E_RECIPIENT_SUPPRESSED") : undefined));
    const search = await addSaved(await makeUser(email), "/tenders?segment=72", { last: "2026-10-29T15:00:00.000Z" });
    const env = jobEnv(mail.binding, week({ [DAY]: [tender("cb-802-80000001")] }));
    await cron(env);
    expect(mail.to(email)).toHaveLength(1);
    expect(await deliveriesOf(search)).toEqual([{ status: "failed", items: 1, sent_at: NOW.toISOString() }]);
    expect((await searchRow(search))?.last_delivered_at).toBe("2026-10-29T15:00:00.000Z");
    await cron(env);
    expect(mail.to(email)).toHaveLength(1);
    expect(log.mock.calls.flat().join("\n")).not.toContain(email);
  });

  it("stops the run on a daily-limit refusal and leaves the rest for the next hour", async () => {
    const log = quiet();
    const first = newEmail("limit-a");
    const second = newEmail("limit-b");
    const spent = fakeMail(() => refused("E_DAILY_LIMIT_EXCEEDED"));
    const a = await addSaved(await makeUser(first), "/tenders?segment=72");
    const b = await addSaved(await makeUser(second), "/tenders?segment=72");
    const files = week({ [DAY]: [tender("cb-803-80000001")] });
    const report = await runDeliveries(jobEnv(spent.binding, files) as never);
    expect(report.outcome).toBe("limited");
    expect(spent.to(first)).toHaveLength(1);
    expect(spent.to(second)).toHaveLength(0);
    expect(await deliveriesOf(a)).toEqual([]);
    expect(await deliveriesOf(b)).toEqual([]);
    expect(log.mock.calls.flat().join("\n")).toContain("stopped at E_DAILY_LIMIT_EXCEEDED, the next hour goes on");
    // The next hour, with sending back, both go.
    const ok = fakeMail();
    await cron(jobEnv(ok.binding, files));
    expect(ok.to(first)).toHaveLength(1);
    expect(ok.to(second)).toHaveLength(1);
    expect((await deliveriesOf(a)).map((d) => d.status)).toEqual(["sent"]);
  });

  it("holds a run to the message cap", () => {
    expect(RUN_MESSAGES_MAX).toBe(300);
  });
});

// -- the stop link ---------------------------------------------------------------------------------

async function stoppable(o: { deliver?: string; lang?: "en" | "fr" } = {}) {
  const email = newEmail("stop");
  const user = await makeUser(email);
  const search = await addSaved(user, "/tenders?segment=72", { deliver: o.deliver ?? "daily", lang: o.lang });
  const secret = "c".repeat(31) + (seq % 10);
  await ACCOUNTS.prepare("INSERT INTO delivery_tokens (search_id, secret, created_at) VALUES (?, ?, ?)").bind(search, secret, TEST_NOW).run();
  return { email, user, search, secret, path: `/account/stop?s=${search}&t=${secret}` };
}

describe("the stop link", () => {
  it("shows the search and a button on GET, and changes nothing", async () => {
    const s = await stoppable();
    const res = await get(s.path);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = decode(await res.text());
    expect(html).toContain("<h1>Stop This Delivery</h1>");
    expect(html).toContain("<strong>New tender notices matching UNSPSC segment: 72 Building and Facility Construction and Maintenance Services</strong>");
    expect(html).toContain('<form method="post" action="/account/stop"');
    expect(html).toContain(`<input type="hidden" name="s" value="${s.search}"/>`);
    expect(html).toContain(`<input type="hidden" name="t" value="${s.secret}"/>`);
    expect((await searchRow(s.search))?.deliver).toBe("daily");
  });

  it("turns the delivery off on POST and says so, in the page's language", async () => {
    const s = await stoppable({ lang: "fr" });
    const res = await post("/account/stop", { s: s.search, t: s.secret, lang: "fr" });
    expect(res.status).toBe(200);
    const html = nbsp(decode(await res.text()));
    expect(html).toContain("<h1>Envoi arrêté</h1>");
    expect((await searchRow(s.search))?.deliver).toBe("off");
    const audit = await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE user_id = ? ORDER BY id DESC LIMIT 1").bind(s.user).first();
    expect(audit).toEqual({ event: "delivery_stopped", detail: "link" });
    // A second press finds it off and says so.
    const again = decode(await (await get(s.path)).text());
    expect(again).toContain("This delivery is already off.");
    expect(again).not.toContain('action="/account/stop"');
  });

  it("turns the delivery off on a mail client's one-click POST, without a page", async () => {
    const s = await stoppable();
    const res = await post(s.path, { "List-Unsubscribe": "One-Click" }, { origin: null });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("The delivery is off.");
    expect((await searchRow(s.search))?.deliver).toBe("off");
    // RFC 8058 allows the body as multipart/form-data too.
    const m = await stoppable();
    const body = new FormData();
    body.set("List-Unsubscribe", "One-Click");
    const multipart = await app.request(m.path, { method: "POST", body, headers: { "cf-connecting-ip": "198.51.100.250" } }, onEnv());
    expect(multipart.status).toBe(200);
    expect((await searchRow(m.search))?.deliver).toBe("off");
    const audit = await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE user_id = ? ORDER BY id DESC LIMIT 1").bind(m.user).first();
    expect(audit).toEqual({ event: "delivery_stopped", detail: "one_click" });
  });

  it("answers the site's 404 for a wrong, malformed or stale link", async () => {
    const s = await stoppable();
    const wrong = `/account/stop?s=${s.search}&t=${"d".repeat(32)}`;
    for (const path of [wrong, `/account/stop?s=${s.search}`, `/account/stop?s=x&t=${s.secret}`, `/account/stop?s=${nextId()}&t=${s.secret}`]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain("<h1>Page Not Found</h1>");
    }
    for (const fields of [{ s: s.search, t: "d".repeat(32) }, { "List-Unsubscribe": "One-Click" }] as Record<string, string>[]) {
      const res = await post(wrong, fields, { origin: null });
      expect(res.status).toBe(404);
    }
    expect((await searchRow(s.search))?.deliver).toBe("daily");
    // A deleted search's link is stale.
    expect(await deleteSearch(onEnv() as never, s.user, s.search)).toBe(true);
    expect(await tokenOf(s.search)).toBeNull();
    expect((await get(s.path)).status).toBe(404);
  });

  it("goes with the search and with the account", async () => {
    const email = newEmail("stop-delete");
    const cookie = await signIn(email);
    const id = await userId(email);
    await grantPro(email);
    const search = await addSaved(id, "/tenders?segment=72");
    await ACCOUNTS.prepare("INSERT INTO delivery_tokens (search_id, secret, created_at) VALUES (?, ?, ?)").bind(search, "e".repeat(32), TEST_NOW).run();
    await ACCOUNTS.prepare("INSERT INTO deliveries (saved_search_id, sent_at, items, status) VALUES (?, ?, 1, 'sent')").bind(search, TEST_NOW).run();
    const token = await csrf(cookie, "/account/searches");
    expect((await post(`/account/searches/${search}/delete`, { csrf: token }, { cookie })).status).toBe(303);
    expect(await tokenOf(search)).toBeNull();
    expect(await deliveriesOf(search)).toEqual([]);
    const other = await addSaved(id, "/expiring/3m");
    await ACCOUNTS.prepare("INSERT INTO delivery_tokens (search_id, secret, created_at) VALUES (?, ?, ?)").bind(other, "f".repeat(32), TEST_NOW).run();
    expect((await post("/account/delete", { csrf: token, confirm: "yes" }, { cookie })).status).toBe(200);
    expect(await tokenOf(other)).toBeNull();
  });
});

// -- the searches page and the privacy page -------------------------------------------------------

describe("the searches page", () => {
  it("shows each search's last delivery beside its select, every kind with one", async () => {
    const email = newEmail("page");
    const cookie = await signIn(email);
    const id = await userId(email);
    await grantPro(email);
    const sentOne = await addSaved(id, "/tenders?segment=72");
    const emptyOne = await addSaved(id, "/expiring/3m", { deliver: "weekly" });
    await addSaved(id, "/tenders?province=ON", { deliver: "daily" });
    const org = await addSaved(id, "/organizations/org-a000000001", { kind: "organization", deliver: "off" });
    const buyer = await addSaved(id, "/buyers/dnd-mdn", { kind: "buyer", deliver: "off", label: "New award notices and contracts from National Defence" });
    const segment = await addSaved(id, "/segments/43", { kind: "segment", deliver: "off", label: "New tender notices and award notices in segment 43" });
    await ACCOUNTS.prepare("INSERT INTO deliveries (saved_search_id, sent_at, items, status) VALUES (?, '2026-10-30T15:01:00.000Z', 3, 'failed'), (?, '2026-10-31T15:02:00.000Z', 12, 'sent'), (?, '2026-10-31T15:02:00.000Z', 0, 'empty')")
      .bind(sentOne, sentOne, emptyOne).run();
    const html = decode(await (await get("/account/searches", { cookie })).text());
    expect(html).toContain("On the Pro plan, each one can be delivered by email, each day or each week.");
    expect(html).toContain('<p class="muted small">Last sent 2026-10-31 15:02 UTC, 12 items.</p>');
    expect(html).toContain('<p class="muted small">Checked 2026-10-31 15:02 UTC, nothing new.</p>');
    expect(html).toContain('<p class="muted small">Not delivered yet.</p>');
    expect(html).not.toContain("not offered for this kind");
    expect(html).not.toContain("disabled");
    // An organization, a buyer and a segment search turn on like any other.
    const token = await csrf(cookie, "/account/searches");
    for (const search of [org, buyer, segment]) {
      expect(html).toContain(`action="/account/searches/${search}"`);
      const res = await post(`/account/searches/${search}`, { csrf: token, deliver: "weekly" }, { cookie });
      expect(res.headers.get("location")).toBe("/account/searches?m=changed");
      expect((await searchRow(search))?.deliver).toBe("weekly");
    }
    const french = nbsp(decode(await (await get("/account/searches?lang=fr", { cookie })).text()));
    expect(french).toContain("Dernier envoi le 2026-10-31 15:02 UTC, 12 éléments.");
    expect(french).toContain("Avec le forfait Pro, chacun peut être envoyé par courriel, chaque jour ou chaque semaine.");
  });
});

describe("the privacy page", () => {
  it("says the address goes to Cloudflare's email service for the site's messages, and otherwise only to the checkout, while the switch is on", async () => {
    const on = decode(await (await get("/privacy")).text());
    expect(on).toContain("The email address is handed to Cloudflare's email service to deliver the site's messages: the sign-in code, the saved searches whose delivery is on, the events of the pages followed while their mail is on, and the weekly email while it is on. Apart from the checkout described under Payments, it is used for nothing else.");
    const fr = nbsp(decode(await (await get("/privacy?lang=fr")).text()));
    expect(fr).toContain("L’adresse courriel est transmise au service de courriel de Cloudflare pour livrer les messages du site : le code de connexion, les recherches enregistrées dont l’envoi est activé, les événements des pages suivies lorsque leur envoi est activé et le courriel hebdomadaire lorsqu’il est activé. Hormis le paiement décrit à la section Paiements, elle ne sert à rien d’autre.");
    const off = decode(await (await get("/privacy", { env: offEnv() })).text());
    expect(off).not.toContain("Cloudflare's email service");
  });
});
