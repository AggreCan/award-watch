// Every message the site sends, in English and in French, through the log
// sender, held to checks.ts: the sign-in code (through the sign-in page
// itself), the saved-search deliveries daily and weekly (tender notices and
// contracts ending, from the delivery tests' fixtures), the records counts of
// a segment and of an organization, the watch mail (with and without the
// "Your organization" block it can open with), the weekly briefing, the
// weekly email (with the watches' news and with the site's week, on Free and
// on Pro), the week's matching notices in the weekly email and in the watch
// mail (Free and Pro, with the disclaimer and the Terms' https address in
// both parts), the accounts-open and Ultra
// messages (through their console run), the address-change notice, and the
// live check's own messages (src/account/mail_check.ts), which the route
// sends to the test inbox only once they pass here.
import { describe, expect, it } from "vitest";
import { accountsOpenMessage, announceLinks, runAnnouncement, ultraLinks, ultraOpenMessage } from "../src/account/announce";
import { expiringDigest, recordsDigest, tenderDigest, watchDigest, weeklyDigest } from "../src/account/digests";
import { RULES } from "../src/account/entitlements";
import { MAIL_CHECK_LISTS, MAIL_CHECK_MARK, MAIL_CHECK_TEMPLATES, type MailCheckTemplate, mailCheckMessages } from "../src/account/mail_check";
import { weekOpening } from "../src/account/org_claim";
import { addressNotice } from "../src/account/sender";
import { t, tn, type Lang } from "../src/i18n";
import { INSERT_INTEREST, newToken } from "../src/pages/interest";
import { DB, decode, lastMail, nbsp, newEmail, onEnv, post, useAccountsDb } from "../test/accounts-helpers";
import {
  DAY, MATCH_NAME, SAMPLE_ADDRESS, SITE, STOP, expiringInput, matchesInput, tenderInput, weeklyInput,
} from "../test/mail-fixtures";
import { LOCAL, type Sent, SHAPES, checkMessage, shapeOf, viaLogSender } from "./checks";

useAccountsDb();

const LANGS = ["en", "fr"] as const;

// The live check's templates as checkMessage reads them.
const CHECK_SHAPE: Record<MailCheckTemplate, keyof typeof SHAPES> = {
  sign_in: "sign_in", tenders_daily: "digest_daily", expiring_weekly: "digest_weekly", records: "digest_daily", watch: "watch",
  briefing: "briefing", weekly: "weekly", accounts_open: "accounts_open", ultra_open: "ultra_open", address_notice: "address_notice",
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

  it("the live check's messages: one of each template, marked, to the one address", async () => {
    const to = newEmail(`mail-check-${lang}`);
    const messages = mailCheckMessages(lang, to, SITE, new Date("2026-11-09T16:00:00Z"), SAMPLE_ADDRESS);
    expect(messages.map((m) => m.template)).toEqual([...MAIL_CHECK_TEMPLATES]);
    // Without the mailing address the weekly email is left out, and nothing else.
    expect(mailCheckMessages(lang, to, SITE).map((m) => m.template)).toEqual(MAIL_CHECK_TEMPLATES.filter((x) => x !== "weekly"));
    for (const { template, message } of messages) {
      expect(message.to, template).toBe(to);
      expect(message.subject.startsWith(`${MAIL_CHECK_MARK} `), template).toBe(true);
      expect(MAIL_CHECK_LISTS.has(template), template).toBe(SHAPES[CHECK_SHAPE[template]].list);
      checkMessage(await viaLogSender(message), shapeOf(CHECK_SHAPE[template], `mail check ${template}`, SITE), lang);
    }
  });
});

describe("the live check's messages", () => {
  // The records digest, the watch mail and the briefing of the live check
  // are the catalogue's samples of those kinds; their stop links lead nowhere.
  it("point their stop links at an id and a secret no row holds", () => {
    for (const lang of LANGS) {
      for (const { template, message } of mailCheckMessages(lang, newEmail("stops"), SITE, new Date(), SAMPLE_ADDRESS)) {
        for (const stop of message.text.match(/https:\/\/\S+\/(?:account|interest)\/stop\?\S+/g) ?? []) {
          expect(stop, template).toMatch(/[?&](?:s|w|b|e|t)=0{32}(?:&|$)/);
          const params = new URL(stop).searchParams;
          for (const key of ["s", "w", "b", "e", "t"]) if (params.has(key)) expect(params.get(key), `${template} ${key}`).toBe("0".repeat(32));
        }
      }
    }
  });
});
