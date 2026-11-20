// Every message the site sends, in English and in French, through the log
// sender, held to checks.ts: the sign-in code (through the sign-in page
// itself), the saved-search deliveries daily and weekly (tender notices and
// contracts ending, from the delivery tests' fixtures), the records counts of
// a segment and of an organization, the watch mail (with and without the
// "Your organization" block it can open with), the weekly briefing, the
// weekly email (with the watches' news and with the site's week, on Free and
// on Pro), a saved analytics view weekly and monthly (with its years and its
// largest records, and with neither), the week's matching notices in the weekly email and in the watch
// mail (Free and Pro, with the disclaimer and the Terms' https address in
// both parts), the accounts-open and Ultra
// messages (through their console run), the address-change notice, a seat's
// invitation and its three notices (through the delivery run's part), and the
// live check's own messages (src/account/mail_check.ts), which the route
// sends to the test inbox only once they pass here.
import { describe, expect, it } from "vitest";
import { accountsOpenMessage, announceLinks, runAnnouncement, ultraLinks, ultraOpenMessage } from "../src/account/announce";
import { expiringDigest, recordsDigest, tenderDigest, viewDigest, watchDigest, weeklyDigest } from "../src/account/digests";
import { RULES } from "../src/account/entitlements";
import {
  MAIL_CHECK_HOLDER, MAIL_CHECK_LISTS, MAIL_CHECK_MARK, MAIL_CHECK_TEMPLATES, type MailCheckTemplate, mailCheckMessages,
} from "../src/account/mail_check";
import { weekOpening } from "../src/account/org_claim";
import { runSeatNotices } from "../src/account/seat_mail";
import { removeSeat } from "../src/account/seats";
import { addressNotice } from "../src/account/sender";
import { t, tn, type Lang } from "../src/i18n";
import { INSERT_INTEREST, newToken } from "../src/pages/interest";
import { ACCOUNTS, DB, csrf, decode, grantUltra, lastMail, nbsp, newEmail, onEnv, post, signIn, useAccountsDb } from "../test/accounts-helpers";
import {
  DAY, MATCH_NAME, SAMPLE_ADDRESS, SITE, STOP, expiringInput, matchesInput, tenderInput, viewInput, weeklyInput,
} from "../test/mail-fixtures";
import { LOCAL, type Sent, SHAPES, checkMessage, shapeOf, viaLogSender } from "./checks";

useAccountsDb();

const LANGS = ["en", "fr"] as const;

// The live check's templates as checkMessage reads them.
const CHECK_SHAPE: Record<MailCheckTemplate, keyof typeof SHAPES> = {
  sign_in: "sign_in", tenders_daily: "digest_daily", expiring_weekly: "digest_weekly", records: "digest_daily", group: "group", watch: "watch",
  briefing: "briefing", briefing_group: "briefing_group", view: "view_weekly", view_group: "view_group", weekly: "weekly",
  accounts_open: "accounts_open", ultra_open: "ultra_open", address_notice: "address_notice", invite: "invite", seat: "seat",
};

// What every message carrying the week's matching notices holds in both
// parts: the plan's rows (RULES.free.match_mail or RULES.pro.match_mail) of
// `total`, the rest counted with its link to /account/matches, for Free the
// line with Pro's own figures from RULES, the disclaimer with the Terms' No
// Warranty section as a full https address, and the data credit.
function holdsMatches(m: Sent, lang: Lang, plan: "free" | "pro", total: number): void {
  const what = `${plan} (${lang})`;
  const text = nbsp(m.text);
  const html = nbsp(decode(m.html));
  const visible = html.replace(/<[^>]+>/g, "");
  const listed = Math.min(total, RULES[plan].match_mail);
  expect((text.match(new RegExp(`${SITE}/tenders/cb-910-`, "g")) ?? []).length, `${what}: rows in the text part`).toBe(listed);
  expect((html.match(new RegExp(`href="${SITE}/tenders/cb-910-`, "g")) ?? []).length, `${what}: rows in the HTML part`).toBe(listed);
  const more = nbsp(tn(lang, "fit.mail_more_one", "fit.mail_more_many", total - listed, { n: total - listed }));
  const matchesPage = `${SITE}/account/matches${lang === "fr" ? "?lang=fr" : ""}`;
  expect(text, what).toContain(nbsp(t(lang, "digest.text_link", { label: more, url: matchesPage })));
  expect(html, what).toContain(`href="${matchesPage}"`);
  expect(visible, what).toContain(more);
  const note = nbsp(t(lang, "fit.mail_free_note", { pro: RULES.pro.matches, mail: RULES.pro.match_mail }));
  expect(text.includes(note), `${what}: the line on Pro in the text part`).toBe(plan === "free");
  expect(visible.includes(note), `${what}: the line on Pro in the HTML part`).toBe(plan === "free");
  const terms = `${SITE}/terms${lang === "fr" ? "?lang=fr" : ""}#warranty`;
  expect(terms.startsWith("https://")).toBe(true);
  const disclaimer = nbsp(t(lang, "fit.disclaimer", { terms: t(lang, "terms.title") }));
  expect(text, `${what}: the disclaimer in the text part`).toContain(disclaimer);
  expect(visible, `${what}: the disclaimer in the HTML part`).toContain(disclaimer);
  expect(text, `${what}: the Terms' address in the text part`).toContain(nbsp(t(lang, "digest.text_link", { label: t(lang, "terms.title"), url: terms })));
  expect(html, `${what}: the Terms' link in the HTML part`).toContain(`<a href="${terms}" style="color:#5b6b80;">${nbsp(t(lang, "terms.title"))}</a>`);
  for (const part of [text, visible]) expect(part, `${what}: the data credit`).toContain(nbsp(t(lang, "data.credit")));
}

// A sign-up on the email lists, as the interest form keeps it; the Ultra card's row with "ultra".
let clock = 0;
async function signUp(email: string, lang: Lang, rows: [kind: string, params: string, label: string][]): Promise<void> {
  for (const [kind, params, label] of rows) {
    const at = new Date(Date.UTC(2026, 9, 1) + ++clock * 1000).toISOString();
    await DB.prepare(INSERT_INTEREST).bind(email, kind, params, label, lang, at, newToken()).run();
  }
}

// Runs of a kind's message until the address has had it (other files' addresses may wait too).
async function announced(email: string, kind: "accounts" | "ultra"): Promise<Sent> {
  for (let i = 0; i < 20 && !(await lastMail(email)); i++) {
    await runAnnouncement(onEnv() as never, LOCAL, `${LOCAL}/admin/announce`, new Date(), 300, kind);
  }
  const row = await lastMail(email);
  if (!row) throw new Error("the run sent nothing to the address");
  return { to: row.to_addr, subject: row.subject, text: row.text, html: row.html, lang: row.lang as Lang };
}

describe.each(LANGS)("every message, in %s", (lang) => {
  it("the sign-in code, as the sign-in page sends it", async () => {
    const to = newEmail(`signin-${lang}`);
    expect((await post("/account/sign-in", { email: to, lang })).status).toBe(200);
    const row = await lastMail(to);
    expect(row?.to_addr).toBe(to);
    checkMessage({ to, subject: row!.subject, text: row!.text, html: row!.html, lang: row!.lang as Lang }, shapeOf("sign_in", "sign-in", LOCAL), lang);
  });

  it("a saved search's tender notices, daily and weekly", async () => {
    for (const cadence of ["daily", "weekly"] as const) {
      const m = tenderDigest({ ...tenderInput(lang), cadence, to: newEmail(`tenders-${cadence}-${lang}`) });
      checkMessage(await viaLogSender(m), shapeOf(cadence === "daily" ? "digest_daily" : "digest_weekly", `tenders ${cadence}`, SITE), lang);
    }
  });

  it("a saved search's contracts ending, weekly and daily", async () => {
    for (const cadence of ["weekly", "daily"] as const) {
      const m = expiringDigest({ ...expiringInput(lang), cadence, to: newEmail(`expiring-${cadence}-${lang}`) });
      checkMessage(await viaLogSender(m), shapeOf(cadence === "daily" ? "digest_daily" : "digest_weekly", `expiring ${cadence}`, SITE), lang);
    }
  });

  it("an organization's new records", async () => {
    const name = "Exemplar Works Ltd.";
    const m = recordsDigest({
      lang, to: newEmail(`records-org-${lang}`), site: SITE, label: t(lang, "interest.label_organization", { organization: name }),
      params: "/organizations/org-e000000001", cadence: "weekly", dataDate: DAY, stopUrl: STOP, total: 3, kind: "organization", name,
      rows: [{ src: "contracts", fy: 2026, more: 2, n: 5, cents: 5_000_000 }, { src: "grants", fy: 2026, more: 1, n: 1, cents: null }],
      more: 3, since: "2026-10-24", tenders: [], tenderTotal: 0, tenderSince: "2026-10-24",
    });
    checkMessage(await viaLogSender(m), shapeOf("digest_weekly", "records organization", SITE), lang);
  });

  it("the watch mail opening with the account's organization, alone and beside a watch", async () => {
    const opening = weekOpening(lang, SITE, "org-a000000001", "Exemplar Translation Services Inc.", {
      records: [{ src: 1, n: 1 }, { src: 3, n: 1 }], ending: { n: 2, cents: 50_000_000, soonest: "2027-01-15" },
      buyers: [{ id: "pwgsc-tpsgc", name_en: "Public Services and Procurement Canada", name_fr: "Services publics et Approvisionnement Canada", n: 5 }],
    });
    const base = { lang, site: SITE, dataDate: DAY, stopUrl: `${SITE}/account/stop?w=${"a".repeat(32)}&t=${"b".repeat(32)}`, watched: 1, opening };
    const alone = watchDigest({ ...base, to: newEmail(`watch-alone-${lang}`), groups: [], total: 0 });
    checkMessage(await viaLogSender(alone), shapeOf("watch", "watch mail, the block alone", SITE), lang);
    const groups = [{ kind: "organization" as const, label: "Sample Harbour Marine Ltd.", path: "/organizations/org-a000000002", events: [] }];
    const both = watchDigest({ ...base, to: newEmail(`watch-both-${lang}`), groups, total: 1 });
    checkMessage(await viaLogSender(both), shapeOf("watch", "watch mail, the block and a watch", SITE), lang);
  });

  it("the weekly email: the watches' news and the site's week, for an account that follows pages and one that follows none, Free and Pro", async () => {
    const cases: [string, Parameters<typeof weeklyInput>[1]][] = [
      ["watches, Free", {}], ["watches, Pro", { pro: true }], ["the site's week, nothing new on 3 pages", { news: false, watched: 3 }],
      ["the site's week, nothing new on 1 page", { news: false, watched: 1 }], ["the site's week, following nothing", { news: false, watched: 0 }],
      ["the site's week, Pro", { news: false, watched: 0, pro: true }],
    ];
    for (const [name, o] of cases) {
      const m = weeklyDigest({ ...weeklyInput(lang, o), to: newEmail(`weekly-${lang}`) });
      checkMessage(await viaLogSender(m), shapeOf("weekly", `weekly email, ${name}`, SITE), lang);
    }
    // A figure whose file did not read is left out, and the subject goes without the notices' count.
    const partial = weeklyDigest({
      ...weeklyInput(lang, { news: false }), to: newEmail(`weekly-partial-${lang}`), figures: { notices: null, closing: 5, awards: null, ending: null },
    });
    checkMessage(await viaLogSender(partial), shapeOf("weekly", "weekly email, one figure", SITE), lang);
  });

  it("the weekly email with the week's matching notices: the figures or the watches' news, Free and Pro", async () => {
    for (const plan of ["free", "pro"] as const) {
      const matches = matchesInput(lang, plan, 12);
      for (const news of [false, true]) {
        const m = weeklyDigest({ ...weeklyInput(lang, { news, pro: plan === "pro" }), to: newEmail(`weekly-matches-${lang}`), matches });
        checkMessage(await viaLogSender(m), shapeOf("weekly", `weekly email with matches, ${plan}, ${news ? "news" : "figures"}`, SITE), lang);
        holdsMatches(m, lang, plan, 12);
      }
    }
  });

  it("the watch mail with the week's matching notices: after the organization's block, alone, and beside a watch", async () => {
    const matches = matchesInput(lang, "pro", 12);
    const opening = weekOpening(lang, SITE, "org-a000000001", MATCH_NAME, { records: [], ending: { n: 0, cents: null, soonest: null }, buyers: [] });
    const base = { lang, site: SITE, dataDate: DAY, stopUrl: `${SITE}/account/stop?w=${"a".repeat(32)}&t=${"b".repeat(32)}`, watched: 1, matches };
    const groups = [{ kind: "organization" as const, label: "Sample Harbour Marine Ltd.", path: "/organizations/org-a000000002", events: [] }];
    const cases: [string, Parameters<typeof watchDigest>[0]][] = [
      ["after the organization's block", { ...base, to: newEmail(`watch-matches-open-${lang}`), groups: [], total: 0, opening }],
      ["alone", { ...base, to: newEmail(`watch-matches-alone-${lang}`), groups: [], total: 0 }],
      ["beside a watch", { ...base, to: newEmail(`watch-matches-both-${lang}`), groups, total: 1, opening }],
    ];
    for (const [name, input] of cases) {
      const m = watchDigest(input);
      checkMessage(await viaLogSender(m), shapeOf("watch", `watch mail with matches, ${name}`, SITE), lang);
      holdsMatches(m, lang, "pro", 12);
    }
  });

  it("a saved analytics view, weekly and monthly, with its figures and with none", async () => {
    for (const cadence of ["weekly", "monthly"] as const) {
      const m = viewDigest({ ...viewInput(lang), cadence, to: newEmail(`view-${cadence}-${lang}`) });
      checkMessage(await viaLogSender(m), shapeOf(cadence === "weekly" ? "view_weekly" : "view_monthly", `saved view ${cadence}`, SITE), lang);
    }
    // A view with no record in its period, and none of value in its last year: a line in each section, no row.
    const empty = viewDigest({ ...viewInput(lang), years: [], largest: [], csv: null, to: newEmail(`view-empty-${lang}`) });
    checkMessage(await viaLogSender(empty), shapeOf("view_weekly", "saved view, empty", SITE), lang);
    expect(nbsp(empty.text)).toContain(nbsp(t(lang, "view.mail_years_none")));
  });

  it("the accounts-open message, as its run sends it, and with an https stop link", async () => {
    const to = newEmail(`announce-${lang}`);
    const other = newEmail(`announce-other-${lang}`);
    const lists: [string, string, string][] = [
      ["tenders", "/tenders", lang === "fr" ? "Chaque nouvel avis d'appel d'offres" : "Every new tender notice"],
      ["segment", "/segments/43", lang === "fr" ? "Nouveaux avis dans le segment 43" : "New notices in segment 43"],
    ];
    await signUp(to, lang, lists);
    await signUp(other, lang === "fr" ? "en" : "fr", lists.slice(0, 1));
    // On a local run the stop link is http, so the message carries no List-Unsubscribe.
    checkMessage(await announced(to, "accounts"), shapeOf("accounts_open", "accounts-open run", LOCAL), lang, { others: [other] });
    const https = accountsOpenMessage(lang, newEmail(`announce-https-${lang}`), lists.map((l) => l[2]), announceLinks(SITE, lang, "c".repeat(32)));
    checkMessage(await viaLogSender(https), shapeOf("accounts_open", "accounts-open", SITE), lang);
  });

  it("the Ultra message, as its run sends it, and with an https stop link", async () => {
    const to = newEmail(`ultra-${lang}`);
    const other = newEmail(`ultra-other-${lang}`);
    await signUp(to, lang, [["ultra", "", "Ultra"]]);
    await signUp(other, lang, [["ultra", "", "Ultra"]]);
    checkMessage(await announced(to, "ultra"), shapeOf("ultra_open", "Ultra run", LOCAL), lang, { others: [other] });
    const https = ultraOpenMessage(lang, newEmail(`ultra-https-${lang}`), ultraLinks(SITE, lang, "d".repeat(32)));
    checkMessage(await viaLogSender(https), shapeOf("ultra_open", "Ultra", SITE), lang);
  });

  it("the address-change notice", async () => {
    checkMessage(await viaLogSender(addressNotice(lang, newEmail(`address-${lang}`), SITE)), shapeOf("address_notice", "address notice", SITE), lang);
  });

  it("a seat's invitation, as the Seats page sends it, in the language the holder chose, naming the holder alone", async () => {
    const holder = newEmail(`seat-holder-${lang}`);
    const cookie = await signIn(holder);
    await grantUltra(holder);
    const env = onEnv({ SEATS: "on" });
    const to = newEmail(`seat-invited-${lang}`);
    // The page is in English; the message is in the language the holder chose.
    const res = await post("/account/seats/invite", { csrf: await csrf(cookie, "/account/seats", { env }), email: to, message_lang: lang, lang: "en" },
      { cookie, env });
    expect(res.status).toBe(200);
    const row = await lastMail(to);
    expect(row?.to_addr).toBe(to);
    const m = { to, subject: row!.subject, text: row!.text, html: row!.html, lang: row!.lang as Lang };
    checkMessage(m, shapeOf("invite", "seat invitation", LOCAL), lang, { named: [holder] });
    // The holder's address in the body, never in the subject; the invited address nowhere in the message.
    expect(m.subject).not.toContain("@");
    expect(m.text).toContain(holder);
    expect(`${m.text}${m.html}`).not.toContain(to);
    const link = /\/account\/seats\/join\?i=[0-9a-f]{32}&t=[0-9a-f]{64}(&lang=fr)?\n/.exec(m.text);
    expect(link?.[0].startsWith("/account/seats/join"), "the link in the text part").toBe(true);
    expect(m.text).toContain(`${LOCAL}${link?.[0]}`);
    expect(link?.[1] === "&lang=fr").toBe(lang === "fr");
  });

  it("a seat's three notices (no longer gives Ultra, gives it again, has ended), as the delivery run's part sends them, in the member's language", async () => {
    // A holder on Ultra and a member in its seat, every row written at a fixed time before the part's runs.
    const at = (s: string) => `2026-${s}.000Z`;
    const id = () => crypto.randomUUID().replace(/-/g, "");
    const holder = { id: id(), email: newEmail(`seat-notice-holder-${lang}`) };
    const member = { id: id(), email: newEmail(`seat-notice-member-${lang}`) };
    const ultra = id();
    const seat = id();
    await ACCOUNTS.batch([
      ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, 'en', 'active', 'free')")
        .bind(holder.id, holder.email, at("09-01T00:00:00")),
      // The member's mail language is the message's.
      ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status, plan) VALUES (?, ?, ?, ?, 'active', 'free')")
        .bind(member.id, member.email, at("09-01T00:00:00"), lang),
      ACCOUNTS.prepare("INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'manual', ?, NULL, 'test', ?)")
        .bind(ultra, holder.id, at("10-01T00:00:00"), at("10-01T00:00:00")),
      ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(ultra),
      ACCOUNTS.prepare(
        "INSERT INTO seats (id, holder_id, lang, invited_at, expires_at, member_id, joined_at, told, told_at) VALUES (?, ?, 'en', ?, ?, ?, ?, 1, ?)",
      ).bind(seat, holder.id, at("10-15T00:00:00"), at("10-22T00:00:00"), member.id, at("10-15T00:00:00"), at("10-15T00:00:00")),
    ]);
    const env = onEnv({ SEATS: "on" }) as never;
    // The part on a local run: its messages leave through the log sender, as every message here does.
    const part = (now: string) => runSeatNotices(env, { site: LOCAL, dataDate: now.slice(0, 10), now: new Date(now), room: 300, capText: "the cap" });
    const notice = async (kind: "lost" | "back" | "ended", now: string, plan: string) => {
      const { report } = await part(now);
      expect(report?.[kind], kind).toBe(1);
      const row = await lastMail(member.email);
      expect(row?.to_addr).toBe(member.email);
      const m = { to: member.email, subject: row!.subject, text: row!.text, html: row!.html, lang: row!.lang as Lang };
      expect(m.subject).toBe(t(lang, `seatmail.subject_${kind}`));
      checkMessage(m, shapeOf("seat", `seat notice, ${kind}`, LOCAL), lang);
      expect(nbsp(m.text)).toContain(nbsp(kind === "back" ? t(lang, "seatmail.back", { date: now.slice(0, 10) })
        : t(lang, kind === "lost" ? "seatmail.lost" : "seatmail.ended", { plan, date: now.slice(0, 10) })));
      // It names no address, not the holder's either.
      expect(`${m.subject}${m.text}${m.html}`).not.toContain(holder.email);
      expect(`${m.subject}${m.text}${m.html}`).not.toContain(member.email);
    };
    // The holder's plan ends: the seat no longer gives Ultra.
    await ACCOUNTS.prepare("UPDATE entitlements SET ends_at = ? WHERE id = ?").bind(at("11-08T12:00:00"), ultra).run();
    await notice("lost", at("11-08T16:00:00"), t(lang, "account.plan_free"));
    // Ultra again: the seat gives it again.
    const again = id();
    await ACCOUNTS.batch([
      ACCOUNTS.prepare("INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'manual', ?, NULL, 'test', ?)")
        .bind(again, holder.id, at("11-09T10:00:00"), at("11-09T10:00:00")),
      ACCOUNTS.prepare("INSERT INTO entitlement_tiers (entitlement_id, tier) VALUES (?, 'ultra')").bind(again),
    ]);
    await notice("back", at("11-09T16:00:00"), t(lang, "ultra.tag"));
    // The holder removes the member: the seat has ended.
    expect(await removeSeat(env, holder.id, seat, new Date(at("11-10T10:00:00")))).toBe(member.email);
    await notice("ended", at("11-10T16:00:00"), t(lang, "account.plan_free"));
    // Each said once.
    expect((await part(at("11-10T17:00:00"))).report?.sent).toBe(0);
  });

  it("the live check's messages: one of each template, marked, to the one address", async () => {
    const to = newEmail(`mail-check-${lang}`);
    const messages = await mailCheckMessages(lang, to, SITE, new Date("2026-11-09T16:00:00Z"), SAMPLE_ADDRESS);
    expect(messages.map((m) => m.template)).toEqual([...MAIL_CHECK_TEMPLATES]);
    // Without the mailing address the weekly email is left out, and nothing else.
    expect((await mailCheckMessages(lang, to, SITE)).map((m) => m.template)).toEqual(MAIL_CHECK_TEMPLATES.filter((x) => x !== "weekly"));
    for (const { template, message } of messages) {
      expect(message.to, template).toBe(to);
      expect(message.subject.startsWith(`${MAIL_CHECK_MARK} `), template).toBe(true);
      expect(MAIL_CHECK_LISTS.has(template), template).toBe(SHAPES[CHECK_SHAPE[template]].list);
      checkMessage(await viaLogSender(message), shapeOf(CHECK_SHAPE[template], `mail check ${template}`, SITE), lang, { named: [MAIL_CHECK_HOLDER] });
    }
  });
});

describe("the live check's messages", () => {
  // The records digest, the watch mail and the briefing of the live check
  // are the catalogue's samples of those kinds; their stop links lead nowhere.
  // The grouped messages' own links (g=, gb=, gv=, their tags) are held in check-group.test.ts.
  it("point their stop links at an id and a secret no row holds", async () => {
    for (const lang of LANGS) {
      for (const { template, message } of await mailCheckMessages(lang, newEmail("stops"), SITE, new Date(), SAMPLE_ADDRESS)) {
        for (const stop of (message.text.match(/https:\/\/\S+\/(?:account|interest)\/stop\?\S+/g) ?? []).filter((u) => !/[?&]g[bv]?=/.test(u))) {
          expect(stop, template).toMatch(/[?&](?:s|w|b|e|v|t)=0{32}(?:&|$)/);
          const params = new URL(stop).searchParams;
          for (const key of ["s", "w", "b", "e", "v", "t"]) if (params.has(key)) expect(params.get(key), `${template} ${key}`).toBe("0".repeat(32));
        }
      }
    }
  });
});
