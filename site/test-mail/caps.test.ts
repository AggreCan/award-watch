// The caps on what the site sends, and their arithmetic, through the log
// sender where a run sends (docs/mail.md): the delivery job's one cap shared
// by the saved searches, the watch mail and the briefings; the rows a message
// lists and the line that counts the rest; the subject's length; the
// accounts-open and Ultra runs' cap a run, run again until no address waits;
// the sign-in codes an address may ask for in an hour; and the live check's
// one message per template. Then the checks themselves, each made to fail on
// a message planted with the fault it looks for.
import { describe, expect, it } from "vitest";
import { ANNOUNCE_MAX, LISTS_SHOWN, announceCounts, runAnnouncement } from "../src/account/announce";
import { BRIEFINGS_RUN_MAX, SECTION_ROWS } from "../src/account/briefings";
import { ROWS_MAX, RUN_MESSAGES_MAX, roomAfter } from "../src/account/deliveries";
import { SUBJECT_MAX, briefingDigest, fitCounts, fitSubject, recordsDigest, tenderDigest, watchDigest } from "../src/account/digests";
import { MAIL_CHECK_MARK, MAIL_CHECK_TEMPLATES, mailCheckBriefingData, mailCheckMessages, runMailCheck } from "../src/account/mail_check";
import { CODES_PER_HOUR } from "../src/account/signin";
import { ROWS_PER_KIND, type EventRow, type Found, foundKey } from "../src/account/watch_events";
import { WATCH_ACCOUNTS_MAX, groupsFor } from "../src/account/watch_mail";
import type { Watch } from "../src/account/watches";
import { t, type Lang } from "../src/i18n";
import { INSERT_INTEREST, newToken } from "../src/pages/interest";
import { ACCOUNTS, DB, decode, nbsp, newEmail, onEnv, post, useAccountsDb } from "../test/accounts-helpers";
import { DAY, SITE, tender, tenderInput } from "../test/mail-fixtures";
import { LOCAL, type Sent, checkMessage, shapeOf, viaLogSender } from "./checks";

useAccountsDb();

const LANGS = ["en", "fr"] as const;
const rowsIn = (html: string) => (html.match(/<tr><td class="rule"/g) ?? []).length;
const itemsIn = (text: string) => (text.match(/^- /gm) ?? []).length;
const outbox = async (to?: string) =>
  (await (to
    ? ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sent_mail WHERE to_addr = ?").bind(to)
    : ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sent_mail")).first<{ n: number }>())?.n ?? 0;

describe("the caps", () => {
  it("are the figures the code and docs/mail.md state", () => {
    expect(RUN_MESSAGES_MAX).toBe(300);
    expect(ROWS_MAX).toBe(50);
    expect(ANNOUNCE_MAX).toBe(300);
    expect(LISTS_SHOWN).toBe(10);
    expect(SECTION_ROWS).toBe(10);
    expect(ROWS_PER_KIND).toBe(10);
    expect(CODES_PER_HOUR).toBe(5);
    expect(WATCH_ACCOUNTS_MAX).toBe(1000);
    expect(BRIEFINGS_RUN_MAX).toBe(1000);
    expect(SUBJECT_MAX).toBe(100);
    expect(MAIL_CHECK_TEMPLATES).toHaveLength(9);
  });
});

describe("the delivery job's one cap", () => {
  it("leaves the watch mail what the saved searches did not use, and the briefings what neither used, never below zero", () => {
    expect(roomAfter()).toBe(RUN_MESSAGES_MAX);
    expect(roomAfter({ sent: 120, failed: 3 })).toBe(177);
    expect(roomAfter({ sent: 120, failed: 3 }, null)).toBe(177);
    expect(roomAfter({ sent: 120, failed: 3 }, { sent: 77, failed: 0 })).toBe(100);
    expect(roomAfter({ sent: 300, failed: 0 })).toBe(0);
    expect(roomAfter({ sent: 250, failed: 0 }, { sent: 80, failed: 0 })).toBe(0);
  });

  it("holds the three parts together to RUN_MESSAGES_MAX, each stopping at the room it is given", () => {
    // Each part sends until it has as many as it wants or reaches its room
    // (the `>= room` rule of deliveries.ts, watch_mail.ts and briefings.ts).
    const part = (want: number, room: number) => ({ sent: Math.min(want, room), failed: 0 });
    for (const [a, b, c] of [[10, 20, 30], [290, 20, 30], [100, 250, 5], [0, 0, 400], [301, 1, 1], [150, 150, 150]]) {
      const searches = part(a, RUN_MESSAGES_MAX);
      const watch = part(b, roomAfter(searches));
      const briefings = part(c, roomAfter(searches, watch));
      const total = searches.sent + watch.sent + briefings.sent;
      expect(total, `${a}, ${b}, ${c}`).toBe(Math.min(a + b + c, RUN_MESSAGES_MAX));
      expect(total).toBeLessThanOrEqual(RUN_MESSAGES_MAX);
    }
  });
});

describe("the rows a message lists", () => {
  it.each(LANGS)("a saved search lists ROWS_MAX notices and counts the rest in both parts (%s)", async (lang) => {
    const all = Array.from({ length: 120 }, (_, i) => tender(`cb-900-9${String(i).padStart(7, "0")}`));
    // As deliveries.ts hands them over: the first ROWS_MAX, and the total.
    const m = tenderDigest({ ...tenderInput(lang), to: newEmail(`rows-${lang}`), rows: all.slice(0, ROWS_MAX), total: all.length });
    expect(rowsIn(m.html)).toBe(ROWS_MAX);
    expect(itemsIn(m.text)).toBe(ROWS_MAX);
    const more = nbsp(t(lang, "digest.more_many", { n: all.length - ROWS_MAX }));
    expect(nbsp(m.text)).toContain(more);
    expect(nbsp(decode(m.html))).toContain(more);
    checkMessage(await viaLogSender(m), shapeOf("digest_daily", "tenders at the cap", SITE), lang);
  });

  it.each(LANGS)("an organization, buyer or segment search lists ROWS_MAX rows in all, the counts first (%s)", async (lang) => {
    const rises = Array.from({ length: 20 }, (_, i) => ({ src: i % 2 ? "history" : "awards", fy: 2026 - Math.floor(i / 2), more: 1, n: 3, cents: 100 } as const));
    const notices = Array.from({ length: 60 }, (_, i) => tender(`cb-943-1${String(i).padStart(6, "0")}`, { segments: ["43"] }));
    // As deliveries.ts slices them: the counts (40 at most), then ROWS_MAX less those of the notices.
    const shown = notices.slice(0, ROWS_MAX - rises.length);
    const m = recordsDigest({
      lang, to: newEmail(`records-rows-${lang}`), site: SITE, label: t(lang, "interest.label_segment", { segment: "43" }), params: "/segments/43",
      cadence: "daily", dataDate: DAY, stopUrl: `${SITE}/account/stop?s=${"a".repeat(32)}&t=${"b".repeat(32)}`, total: 80, kind: "segment",
      name: "43", rows: rises, more: 20, since: "2026-10-30", tenders: shown, tenderTotal: notices.length, tenderSince: "2026-10-30",
    });
    expect(rowsIn(m.html)).toBe(ROWS_MAX);
    expect(itemsIn(m.text)).toBe(ROWS_MAX);
    expect(nbsp(m.text)).toContain(nbsp(t(lang, "digest.more_many", { n: notices.length - shown.length })));
    checkMessage(await viaLogSender(m), shapeOf("digest_daily", "records at the cap", SITE), lang);
  });

  it.each(LANGS)("the watch mail lists ROWS_MAX events across every watch, and counts each kind's rest on its line (%s)", async (lang) => {
    // Three organizations, 30 awards each on the data date: 90 events, 50 listed (30, 20, 0).
    const watches: Watch[] = [1, 2, 3].map((i) => ({
      id: `w${i}`, kind: "organization", target: `org-a00000000${i}`, segment: "", label: `Sample Works ${i}`, events: ["award"],
      cadence: "daily", created_at: `2026-01-0${i}T00:00:00Z`, last_sent_day: null,
    }));
    const event = (w: number, i: number): EventRow => ({
      day: DAY, kind: "award", src: 1, ref: `award:cb-90${w}-${String(i).padStart(8, "0")}`, cents: 100_000 * (i + 1), ocents: null, endd: null,
      oendd: null, closing: null, oclosing: null, namd: null, title: `Award ${w}-${i}`, title_fr: `Attribution ${w}-${i}`, other: null,
      horizon: null, path: `/awards/cb-90${w}-${String(i).padStart(8, "0")}`,
    });
    const found = new Map<string, Found>(watches.map((w, k) => [
      foundKey(w), { rows: Array.from({ length: 30 }, (_, i) => event(k + 1, i)), counts: new Map([["award", new Map([[DAY, 30]])]]) },
    ]));
    const spans = new Map(watches.map((w) => [w.id, new Set([DAY])]));
    const { groups, total } = groupsFor(lang, watches, { state: "ready", asOf: DAY, found }, spans);
    expect(total).toBe(90);
    const listed = groups.map((g) => g.events.reduce((n, e) => n + e.rows.length, 0));
    expect(listed).toEqual([30, 20, 0]);
    expect(listed.reduce((a, b) => a + b, 0)).toBe(ROWS_MAX);
    const m = watchDigest({
      lang, to: newEmail(`watch-rows-${lang}`), site: SITE, dataDate: DAY, stopUrl: `${SITE}/account/stop?w=${"a".repeat(32)}&t=${"b".repeat(32)}`,
      groups, total, watched: 3,
    });
    expect(rowsIn(m.html)).toBe(ROWS_MAX);
    expect(itemsIn(m.text)).toBe(ROWS_MAX);
    for (const rest of [10, 30]) {
      expect(nbsp(m.text)).toContain(nbsp(t(lang, "watches.more_many", { kind: t(lang, "watches.ev_award"), n: rest })));
    }
    checkMessage(await viaLogSender(m), shapeOf("watch", "watch mail at the cap", SITE), lang);
  });

  it.each(LANGS)("a briefing's section lists SECTION_ROWS rows and counts the rest of the week (%s)", async (lang) => {
    // The statements read SECTION_ROWS rows of a section and count them all; 25 new notices, 10 read.
    const d = mailCheckBriefingData(DAY);
    const notice = d.notices.rows[0];
    const ref = (i: number) => `cb-000-1${String(i).padStart(7, "0")}`;
    d.notices = {
      n: 25,
      rows: Array.from({ length: SECTION_ROWS }, (_, i) => ({ ...notice, ref: ref(i), path: `/tenders/${ref(i)}`, title: `Notice ${i}`, title_fr: `Avis ${i}` })),
    };
    const m = briefingDigest({
      lang, to: newEmail(`briefing-rows-${lang}`), site: SITE, stopUrl: `${SITE}/account/stop?b=${"a".repeat(32)}&t=${"b".repeat(32)}`,
      briefing: { kind: "segment", subject: "81", segment: "" }, name: "81", data: d,
    });
    for (let i = 0; i < SECTION_ROWS; i++) expect(m.text).toContain(`- ${lang === "fr" ? "Avis" : "Notice"} ${i}\n`);
    const more = nbsp(t(lang, "briefing.more_many", { n: 25 - SECTION_ROWS }));
    expect(nbsp(m.text)).toContain(more);
    expect(nbsp(decode(m.html))).toContain(more);
    checkMessage(await viaLogSender(m), shapeOf("briefing", "briefing at the cap", SITE), lang);
  });
});

describe("the subject", () => {
  it.each(LANGS)("stays under SUBJECT_MAX characters however long the saved filter, cut on a word (%s)", (lang) => {
    const provinces = ["BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL"].map((p) => `province=${p}`).join("&");
    const long = tenderDigest({ ...tenderInput(lang), params: `/tenders?segment=72&segment=81&${provinces}` });
    expect([...long.subject].length).toBeLessThan(SUBJECT_MAX);
    expect(long.subject.endsWith("…")).toBe(true);
    const plain = tenderDigest(tenderInput(lang));
    expect(plain.subject.endsWith("…")).toBe(false);
    expect(fitSubject(plain.subject)).toBe(plain.subject);
    // The live check's mark counts too.
    expect([...fitSubject(`${MAIL_CHECK_MARK} ${long.subject}`)].length).toBeLessThan(SUBJECT_MAX);
    expect(fitSubject("x".repeat(SUBJECT_MAX - 2))).toBe("x".repeat(SUBJECT_MAX - 2));
    expect([...fitSubject("x".repeat(SUBJECT_MAX - 1))].length).toBeLessThan(SUBJECT_MAX);
  });

  it("names the counts that fit, the last ones left out first, and cuts one that does not fit alone", () => {
    const subject = (shown: readonly string[]) => `Segment this week: ${shown.join(", ")}`;
    const counts = ["a".repeat(30), "b".repeat(30), "c".repeat(30)];
    // 19 + 30 * 3 + 4 = 113 characters with all three, 81 with two.
    expect(fitCounts(counts, subject)).toBe(subject(counts.slice(0, 2)));
    expect(fitCounts(counts.slice(0, 2), subject)).toBe(subject(counts.slice(0, 2)));
    expect(fitCounts([], subject)).toBe(subject([]));
    const alone = fitCounts([Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ")], subject);
    expect([...alone].length).toBeLessThan(SUBJECT_MAX);
    expect(alone.endsWith("…")).toBe(true);
    // The live check's French briefing has three counts and names the two that fit, with its mark.
    const fr = mailCheckMessages("fr", "", SITE).find((m) => m.template === "briefing")!.message.subject;
    expect([...fr].length).toBeLessThan(SUBJECT_MAX);
    expect(fr.endsWith("…")).toBe(false);
  });
});

// -- the runs that send under the log sender ------------------------------------------------------------

let clock = 0;
async function signUp(email: string, lang: Lang, kind: string, labels: string[]): Promise<void> {
  for (const label of labels) {
    const at = new Date(Date.UTC(2026, 9, 2) + ++clock * 1000).toISOString();
    await DB.prepare(INSERT_INTEREST).bind(email, kind, kind === "ultra" ? "" : `/tenders?q=${clock}`, label, lang, at, newToken()).run();
  }
}

const lastTo = async (to: string): Promise<Sent> => {
  const row = await ACCOUNTS.prepare("SELECT to_addr, subject, text, html, lang FROM sent_mail WHERE to_addr = ? ORDER BY id DESC LIMIT 1")
    .bind(to).first<{ to_addr: string; subject: string; text: string; html: string; lang: Lang }>();
  return { to: row!.to_addr, subject: row!.subject, text: row!.text, html: row!.html, lang: row!.lang };
};

// Runs of a kind with a cap of `max` until one sends nothing; each run's
// figures, and the waiting count's arithmetic checked after every run.
async function runsOf(kind: "accounts" | "ultra", max: number) {
  const env = onEnv() as never;
  let waiting = (await announceCounts(env, kind)).waiting;
  const runs: { sent: number; failed: number; accounts: number; left: number }[] = [];
  for (let i = 0; i < 50; i++) {
    const r = await runAnnouncement(env, LOCAL, `${LOCAL}/admin/announce`, new Date(), max, kind);
    expect(r.sent + r.failed).toBeLessThanOrEqual(max);
    expect(r.stopped).toBeNull();
    // What waited, less what this run sent, is what waits now.
    expect(r.left).toBe(waiting - r.sent);
    waiting = r.left;
    runs.push(r);
    if (r.sent + r.failed === 0) break;
  }
  return runs;
}

describe("the accounts-open run", () => {
  it("sends at most its cap a run, each address once, in its language, until only account holders wait", async () => {
    const tag = `cap-${Date.now().toString(36)}`;
    const addresses = Array.from({ length: 5 }, (_, i) => newEmail(`${tag}-${i}`));
    const langs: Lang[] = ["en", "fr", "en", "fr", "en"];
    for (let i = 0; i < addresses.length; i++) await signUp(addresses[i], langs[i], "tenders", [`List ${i}`]);
    // One address on twelve lists: the message names LISTS_SHOWN and counts the rest.
    const many = newEmail(`${tag}-many`);
    await signUp(many, "en", "tenders", Array.from({ length: 12 }, (_, i) => `List ${i + 1} of many`));
    // One address holding an account: passed over every run, still waiting at the end.
    const holder = newEmail(`${tag}-holder`);
    await signUp(holder, "fr", "tenders", ["Holder's list"]);
    await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'fr', 'active')")
      .bind(newToken(), holder).run();

    const before = (await announceCounts(onEnv() as never, "accounts")).waiting;
    const runs = await runsOf("accounts", 2);
    const sent = runs.reduce((n, r) => n + r.sent, 0);
    expect(runs.length).toBeGreaterThanOrEqual(4);
    // The last run reads every address that waits and sends none: the holder alone, passed over.
    expect(runs[runs.length - 1].accounts).toBeGreaterThanOrEqual(1);
    expect(sent + runs[runs.length - 1].left).toBe(before);
    expect(await outbox(holder)).toBe(0);
    const everyone = [...addresses, many];
    for (let i = 0; i < everyone.length; i++) {
      const to = everyone[i];
      expect(await outbox(to), to).toBe(1);
      const m = await lastTo(to);
      checkMessage(m, shapeOf("accounts_open", "accounts-open at the cap", LOCAL), i < langs.length ? langs[i] : "en", {
        others: [...everyone.filter((x) => x !== to), holder],
      });
    }
    const listed = await lastTo(many);
    expect(itemsIn(listed.text)).toBe(LISTS_SHOWN);
    expect((listed.html.match(/<li>/g) ?? []).length).toBe(LISTS_SHOWN);
    expect(listed.text).toContain(t("en", "announce.lists_more_many", { n: 12 - LISTS_SHOWN }));
  });
});

describe("the Ultra run", () => {
  it("sends at most its cap a run, each address once, account holders included", async () => {
    const tag = `ultra-cap-${Date.now().toString(36)}`;
    const addresses = Array.from({ length: 5 }, (_, i) => newEmail(`${tag}-${i}`));
    for (const [i, a] of addresses.entries()) await signUp(a, i % 2 ? "fr" : "en", "ultra", ["Ultra"]);
    await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active')")
      .bind(newToken(), addresses[0]).run();
    const before = (await announceCounts(onEnv() as never, "ultra")).waiting;
    const runs = await runsOf("ultra", 2);
    expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(before);
    expect(runs[runs.length - 1].left).toBe(0);
    for (const [i, a] of addresses.entries()) {
      expect(await outbox(a), a).toBe(1);
      checkMessage(await lastTo(a), shapeOf("ultra_open", "Ultra at the cap", LOCAL), i % 2 ? "fr" : "en", { others: addresses.filter((x) => x !== a) });
    }
  });
});

describe("the sign-in code", () => {
  it("goes to an address CODES_PER_HOUR times an hour, and the next request sends nothing", async () => {
    const to = newEmail("codes-cap");
    for (let i = 0; i < CODES_PER_HOUR; i++) expect((await post("/account/sign-in", { email: to })).status).toBe(200);
    expect(await outbox(to)).toBe(CODES_PER_HOUR);
    expect((await post("/account/sign-in", { email: to })).status).toBe(429);
    expect(await outbox(to)).toBe(CODES_PER_HOUR);
  });
});

describe("the live check's run", () => {
  it.each(LANGS)("sends one message of each template to the one address and to no other (%s)", async (lang) => {
    const to = newEmail(`mail-check-run-${lang}`);
    const all = await outbox();
    const run = await runMailCheck(onEnv() as never, `${LOCAL}/admin/mail-check`, { to, site: SITE, lang });
    expect(run.sender).toBe("log");
    expect(run.results.map((r) => r.template)).toEqual([...MAIL_CHECK_TEMPLATES]);
    expect(run.results.every((r) => r.result === "sent" && r.reason === null)).toBe(true);
    expect(await outbox(to)).toBe(MAIL_CHECK_TEMPLATES.length);
    expect(await outbox()).toBe(all + MAIL_CHECK_TEMPLATES.length);
    const subjects = (await ACCOUNTS.prepare("SELECT subject FROM sent_mail WHERE to_addr = ? ORDER BY id").bind(to).all<{ subject: string }>())
      .results?.map((r) => r.subject) ?? [];
    expect(subjects).toHaveLength(MAIL_CHECK_TEMPLATES.length);
    for (const s of subjects) {
      expect(s.startsWith(`${MAIL_CHECK_MARK} `)).toBe(true);
      expect([...s].length).toBeLessThan(SUBJECT_MAX);
    }
  });
});

// -- the checks themselves ---------------------------------------------------------------------------------

describe("the checks", () => {
  const good = () => tenderDigest({ ...tenderInput("en"), to: "reader@example.com" });
  const shape = shapeOf("digest_daily", "planted", SITE);
  const stop = good().headers["List-Unsubscribe"];

  it("pass the message as built", () => {
    expect(() => checkMessage(good(), shape, "en")).not.toThrow();
  });

  const PLANTED: [string, (m: ReturnType<typeof good>) => Sent][] = [
    ["an em-dash", (m) => ({ ...m, text: m.text.replace("Closing times", `Closing times ${String.fromCharCode(0x2014)}`) })],
    ["another reader's address", (m) => ({ ...m, html: m.html.replace("</h1>", " other.reader@example.com</h1>") })],
    ["a link in one part only", (m) => ({ ...m, html: m.html.replace("</h1>", `<a href="${SITE}/elsewhere">x</a></h1>`) })],
    ["a line dropped from the text part", (m) => ({ ...m, text: m.text.replace("Power Distribution Upgrade\n", "\n") })],
    ["a line only in the text part", (m) => ({ ...m, text: m.text.replace("New tender notices\n", "New tender notices\nA line of its own\n") })],
    ["the reason line removed", (m) => ({ ...m, text: m.text.replace("You receive this each day", "You receive") })],
    ["the stop link removed", (m) => ({ ...m, html: m.html.replaceAll("/account/stop?", "/account/x?"), text: m.text.replaceAll("/account/stop?", "/account/x?") })],
    ["List-Unsubscribe missing", (m) => ({ ...m, headers: {} })],
    ["List-Unsubscribe naming another link", (m) => ({ ...m, headers: { ...m.headers, "List-Unsubscribe": stop.replace("t=b", "t=c") } })],
    ["a subject of SUBJECT_MAX characters", (m) => ({ ...m, subject: "x".repeat(SUBJECT_MAX) })],
    ["an empty subject", (m) => ({ ...m, subject: " " })],
  ];

  it.each(PLANTED)("fail a message planted with %s", (_label, plant) => {
    expect(() => checkMessage(plant(good()), shape, "en")).toThrow();
  });
});
