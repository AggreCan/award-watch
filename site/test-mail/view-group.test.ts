// The grouped saved views message (src/account/digests.ts viewGroupDigest; docs/accounts.md, Saved views): more
// than five of an account's saved views with new figures in one run go in one message, a section a view, as its saved
// searches do (group.test.ts). Held here to the checks every message is held to (checks.ts), in English and French,
// with eight views; and to its size with an Ultra account's 50 views: the records of the whole message held to the
// searches' budget, every view past it one line, the whole under the size at which a webmail client clips a message.
import { describe, expect, it } from "vitest";
import { GROUP_OVER } from "../src/account/deliveries";
import { GROUP_ROWS_MAX, GROUP_SECTION_ROWS, VIEW_MAIL_ROWS, type ViewGroupSection, siteLink, viewGroupDigest } from "../src/account/digests";
import { SAVED_VIEW_MAX } from "../src/account/entitlements";
import { groupStopPath } from "../src/account/group_stop";
import { fmtInt, fmtMoney, t, tn, type Lang } from "../src/i18n";
import { fiscalLabel } from "../src/records_db";
import { decode, nbsp, newEmail, useAccountsDb } from "../test/accounts-helpers";
import { DAY, SITE } from "../test/mail-fixtures";
import { checkMessage, shapeOf, viaLogSender } from "./checks";

useAccountsDb();

const LANGS = ["en", "fr"] as const;
// Under this many characters of HTML: Gmail clips a message's HTML at about 102 KB (watch-size.test.ts).
const HTML_MAX = 100_000;
const USER = "a".repeat(32);
const FY = 2026;
const hex = (n: number) => n.toString(16).padStart(32, "0");
const stopOf = (lang: Lang, n: number) => siteLink(SITE, `/account/stop?v=${hex(n)}&t=${"b".repeat(32)}`, lang);

// A view's section: its years and `records` largest records, the second with no organization named (a person, withheld).
function view(lang: Lang, i: number, records: number, name?: string): ViewGroupSection {
  return {
    name: name ?? (lang === "fr" ? `Vue de la Défense ${i + 1}` : `Defence view ${i + 1}`),
    address: `/buyers/dnd-mdn/analytics?source=awards&years=${(i % 18) + 3}`, stopUrl: stopOf(lang, i + 1), source: "awards", first: FY - 2, last: FY,
    years: [{ fy: FY - 2, n: 41, cents: 912_000_000 }, { fy: FY - 1, n: 37, cents: 845_500_000 }, { fy: FY, n: 12 + i, cents: 48_500_000 }],
    largest: Array.from({ length: records }, (_, k) => ({
      src: 1, ref: `w8486-${i}-${k}`, title: `Hydrographic survey ${i}-${k}`, cents: 10_000_000 - k, party: k === 1 ? null : "Exemplar Works Ltd.",
      path: `/awards/w8486-${i}-${k}`,
    })),
  };
}

async function message(lang: Lang, sections: ViewGroupSection[], tag: string) {
  const members = sections.map((_, i) => ({ id: hex(i + 1), secret: "b".repeat(32) }));
  const stopUrl = siteLink(SITE, await groupStopPath(USER, members, "views"), lang);
  return {
    stopUrl,
    m: viewGroupDigest({ lang, to: newEmail(`vgroup-${tag}-${lang}`), site: SITE, dataDate: DAY, current: FY, stopUrl, sections, over: GROUP_OVER }),
  };
}

const headings = (html: string) => [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((x) => nbsp(decode(x[1])));

describe("the grouped saved views message", () => {
  it.each(LANGS)("lays out eight views a section each, held to the checks every message is held to (%s)", async (lang) => {
    // Two records each, and the fourth view none.
    const sections = Array.from({ length: 8 }, (_, i) => view(lang, i, i === 3 ? 0 : 2));
    const { m, stopUrl } = await message(lang, sections, "eight");
    checkMessage(await viaLogSender(m), shapeOf("view_group", "grouped message of eight views", SITE), lang);
    expect(m.subject).toBe(t(lang, "view.group_subject", { n: 8, date: DAY }));
    expect(headings(m.html)).toEqual(sections.map((s) => nbsp(s.name)));
    const html = decode(m.html);
    for (const s of sections) {
      expect(html).toContain(`href="${siteLink(SITE, s.address, lang)}"`);
      expect(html).toContain(`href="${s.stopUrl}"`);
      expect(nbsp(m.text)).toContain(nbsp(t(lang, "digest.text_link", { label: t(lang, "view.mail_stop"), url: s.stopUrl })));
    }
    expect(m.headers).toEqual({ "List-Unsubscribe": `<mailto:contact@awardwatch.ca>, <${stopUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(stopUrl).toMatch(/\/account\/stop\?gv=a{32}&t=[A-Za-z0-9_-]{64}/);
    expect(m.text).toContain(stopUrl);
    expect((m.html.match(/<tr><td class="rule"/g) ?? []).length).toBe(7 * 2);
    // The newest fiscal year's figures of each view, to date; a record with no organization named reads as its own message reads it.
    expect(nbsp(m.text)).toContain(nbsp(t(lang, "view.mail_pre", {
      fy: t(lang, "analytics.to_date", { fy: fiscalLabel(lang, FY) }), records: tn(lang, "org.tile_records_one", "org.tile_records_many", 12, { n: fmtInt(12, lang) }),
      value: fmtMoney(485_000, lang),
    })));
    expect(nbsp(html)).toContain(nbsp(t(lang, "briefing.withheld")));
    expect(nbsp(m.text)).toContain(nbsp(t(lang, "view.group_why")));
  });

  it.each(LANGS)("stays under 100,000 characters of HTML with 50 views, every view named, the records held to the budget (%s)", async (lang) => {
    const long = (i: number) => (lang === "fr"
      ? `Services publics et Approvisionnement Canada, attributions par exercice, segment 72 (${i})`
      : `Public Services and Procurement Canada, award notices by fiscal year, segment 72 (${i})`).slice(0, 100);
    const sections = Array.from({ length: SAVED_VIEW_MAX }, (_, i) => view(lang, i, VIEW_MAIL_ROWS, long(i)));
    const { m, stopUrl } = await message(lang, sections, "fifty");
    expect(m.html.length).toBeLessThan(HTML_MAX);
    expect((m.html.match(/<tr><td class="rule"/g) ?? []).length).toBe(GROUP_ROWS_MAX);
    const full = Math.ceil(GROUP_ROWS_MAX / GROUP_SECTION_ROWS);
    const rest = nbsp(tn(lang, "view.group_rest_one", "view.group_rest_many", SAVED_VIEW_MAX - full, { n: SAVED_VIEW_MAX - full }));
    expect(headings(m.html)).toEqual([...sections.slice(0, full).map((s) => nbsp(s.name)), rest]);
    for (const [k, s] of sections.entries()) {
      expect(nbsp(decode(m.html)), s.name).toContain(nbsp(s.name));
      expect(nbsp(m.text), s.name).toContain(nbsp(k < full ? s.name.toLocaleUpperCase(lang) : s.name));
      expect(m.text).toContain(siteLink(SITE, s.address, lang));
    }
    const footer = decode(m.html.slice(m.html.lastIndexOf(t(lang, "view.group_why").slice(0, 20))));
    expect(footer).toContain(stopUrl);
    expect(m.headers["List-Unsubscribe"]).toContain(stopUrl);
    checkMessage(await viaLogSender(m), shapeOf("view_group", "grouped message of 50 views", SITE), lang);
  });
});
