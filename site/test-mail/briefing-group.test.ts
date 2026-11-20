// The grouped briefings message (src/account/digests.ts briefingGroupDigest; docs/accounts.md, Weekly briefings):
// more than five of an account's briefings with something to send in one run go in one message, a section a
// briefing, as its saved searches do (group.test.ts). Held here to the checks every message is held to (checks.ts),
// in English and French, with eight briefings of every kind; and to its size with an Ultra account's 100 briefings:
// the rows of the whole message held to the searches' budget, every briefing past it one line, the whole under the
// size at which a webmail client clips a message and hides the footer's stop link.
import { describe, expect, it } from "vitest";
import type { BriefingData, BriefingSubject } from "../src/account/briefings";
import { GROUP_OVER } from "../src/account/deliveries";
import { type BriefingGroupSection, GROUP_ROWS_MAX, GROUP_SECTION_ROWS, briefingGroupDigest, siteLink } from "../src/account/digests";
import { groupStopPath } from "../src/account/group_stop";
import { mailCheckBriefingData } from "../src/account/mail_check";
import { t, tn, type Lang } from "../src/i18n";
import { decode, nbsp, newEmail, useAccountsDb } from "../test/accounts-helpers";
import { DAY, SITE } from "../test/mail-fixtures";
import { checkMessage, shapeOf, viaLogSender } from "./checks";

useAccountsDb();

const LANGS = ["en", "fr"] as const;
// Under this many characters of HTML: Gmail clips a message's HTML at about 102 KB (watch-size.test.ts).
const HTML_MAX = 100_000;
const USER = "a".repeat(32);
const hex = (n: number) => n.toString(16).padStart(32, "0");
const stopOf = (lang: Lang, n: number) => siteLink(SITE, `/account/stop?b=${hex(n)}&t=${"b".repeat(32)}`, lang);

// The sample week, its new notices widened to `notices` rows. full: with its award (the supplier a person, no
// organization, withheld), its quarter's contract (held by a supplier the records withhold) and its amendment; else
// the notices alone.
function week(notices = 1, full = false): BriefingData {
  const d = mailCheckBriefingData(DAY);
  const first = d.notices.rows[0];
  const base = {
    ...d, notices: { n: notices + 1, rows: Array.from({ length: notices }, (_, i) => ({ ...first, ref: `cb-000-1000${i}`, path: `/tenders/cb-000-1000${i}` })) },
  };
  if (!full) {
    return { ...base, awards: { n: 0, sources: [], rows: [] }, ending: { ...d.ending, n: 0, cents: null, nv: 0, fresh: 0, rows: [] }, amended: { n: 0, rows: [] } };
  }
  return {
    ...base,
    awards: { ...d.awards, rows: [{ ...d.awards.rows[0], org: null }] },
    ending: { ...d.ending, rows: d.ending.rows.map((e) => ({ ...e, row: { ...e.row, organization: null, supplier_withheld: true } })) },
  };
}

// Eight briefings: segments, a buyer whole and a buyer narrowed to a segment, one with six new notices.
function eight(lang: Lang): BriefingGroupSection[] {
  const subjects: BriefingSubject[] = [
    { kind: "segment", subject: "81", segment: "" }, { kind: "buyer", subject: "dnd-mdn", segment: "" }, { kind: "segment", subject: "43", segment: "" },
    { kind: "buyer", subject: "dnd-mdn", segment: "72" }, { kind: "segment", subject: "72", segment: "" }, { kind: "segment", subject: "30", segment: "" },
    { kind: "segment", subject: "46", segment: "" }, { kind: "segment", subject: "25", segment: "" },
  ];
  const fr = lang === "fr";
  return subjects.map((briefing, i) => ({
    label: briefing.kind === "segment" ? `${briefing.subject} ${fr ? "Segment" : "Segment"} ${i}` : fr ? `Défense nationale ${i}` : `National Defence ${i}`,
    briefing, data: i === 0 ? week(1, true) : week(i === 2 ? 6 : 1), stopUrl: stopOf(lang, i + 1),
  }));
}

// An Ultra account's 100 briefings, every one with news, with labels as long as a buyer narrowed to a segment makes them.
function hundred(lang: Lang): BriefingGroupSection[] {
  const label = (i: number) => lang === "fr"
    ? `Services publics et Approvisionnement Canada · 72 Services de construction et d'entretien d'installations (${i})`
    : `Public Services and Procurement Canada · 72 Building and Facility Construction and Maintenance Services (${i})`;
  return Array.from({ length: 100 }, (_, i) => ({
    label: label(i), briefing: { kind: "buyer", subject: `buyer-${i}`, segment: "72" }, data: week(GROUP_SECTION_ROWS, true), stopUrl: stopOf(lang, i + 1),
  }));
}

async function message(lang: Lang, sections: BriefingGroupSection[], tag: string) {
  const members = sections.map((_, i) => ({ id: hex(i + 1), secret: "b".repeat(32) }));
  const stopUrl = siteLink(SITE, await groupStopPath(USER, members, "briefings"), lang);
  return { stopUrl, m: briefingGroupDigest({ lang, to: newEmail(`bgroup-${tag}-${lang}`), site: SITE, dataDate: DAY, stopUrl, sections, over: GROUP_OVER }) };
}

const headings = (html: string) => [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((x) => nbsp(decode(x[1])));
const pageOf = (s: BriefingGroupSection) => s.briefing.kind === "segment" ? `/segments/${s.briefing.subject}` : `/buyers/${s.briefing.subject}`;

describe("the grouped briefings message", () => {
  it.each(LANGS)("lays out eight briefings a section each, held to the checks every message is held to (%s)", async (lang) => {
    const sections = eight(lang);
    const { m, stopUrl } = await message(lang, sections, "eight");
    checkMessage(await viaLogSender(m), shapeOf("briefing_group", "grouped message of eight briefings", SITE), lang);
    expect(m.subject).toBe(t(lang, "briefing.group_subject", { n: 8, date: DAY }));
    // A section a briefing, in the order given, each headed by its name, its counts linking its page, and its own stop link.
    expect(headings(m.html)).toEqual(sections.map((s) => nbsp(s.label)));
    const html = decode(m.html);
    for (const s of sections) {
      expect(html).toContain(`href="${siteLink(SITE, pageOf(s), lang)}"`);
      expect(html).toContain(`href="${s.stopUrl}"`);
      expect(nbsp(m.text)).toContain(nbsp(t(lang, "digest.text_link", { label: t(lang, "briefing.stop_link"), url: s.stopUrl })));
    }
    // The message's own stop link: in the footer, in the text part, and the header's, with the one-click partner.
    expect(m.headers).toEqual({ "List-Unsubscribe": `<mailto:contact@awardwatch.ca>, <${stopUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
    expect(stopUrl).toMatch(/\/account\/stop\?gb=a{32}&t=[A-Za-z0-9_-]{64}/);
    expect(m.text).toContain(stopUrl);
    // Each section's rows, at most GROUP_SECTION_ROWS: the first its notice, award, quarter's contract and amendment (4),
    // the third 5 of its 6 notices, the others their one notice each.
    expect((m.html.match(/<tr><td class="rule"/g) ?? []).length).toBe(4 + GROUP_SECTION_ROWS + 6);
    const more = nbsp(tn(lang, "digest.more_one", "digest.more_many", 2, { n: 2 }));
    expect(nbsp(html)).toContain(`>${more}</a>`);
    // A supplier the records hold no organization for is never named: its place reads as its own message reads it.
    expect(nbsp(html)).toContain(nbsp(t(lang, "briefing.withheld")));
    expect(nbsp(html)).toContain(nbsp(t(lang, "expiring.withheld")));
    // The notes its briefings' own messages carry, once each: values, segment coding, a narrowed briefing.
    for (const key of ["briefing.note", "briefing.note_segment", "briefing.note_narrowed"] as const) {
      expect(nbsp(m.text).split(nbsp(t(lang, key))).length - 1, key).toBe(1);
    }
    // In the account's language throughout: the title, the lead and the reason.
    expect(m.text).toContain(t(lang, "briefing.group_title", { date: DAY }));
    expect(nbsp(m.text)).toContain(nbsp(t(lang, "briefing.group_why")));
  });

  it.each(LANGS)("stays under 100,000 characters of HTML with 100 briefings, every briefing named, the rows held to the budget (%s)", async (lang) => {
    const sections = hundred(lang);
    const { m, stopUrl } = await message(lang, sections, "hundred");
    expect(m.html.length).toBeLessThan(HTML_MAX);
    expect((m.html.match(/<tr><td class="rule"/g) ?? []).length).toBe(GROUP_ROWS_MAX);
    const full = Math.ceil(GROUP_ROWS_MAX / GROUP_SECTION_ROWS);
    const rest = nbsp(tn(lang, "briefing.group_rest_one", "briefing.group_rest_many", 100 - full, { n: 100 - full }));
    expect(headings(m.html)).toEqual([...sections.slice(0, full).map((s) => nbsp(s.label)), rest]);
    // Nothing left out: every briefing's name, in both parts, with its page's link.
    for (const [k, s] of sections.entries()) {
      expect(nbsp(decode(m.html)), s.label).toContain(nbsp(s.label));
      expect(nbsp(m.text), s.label).toContain(nbsp(k < full ? s.label.toLocaleUpperCase(lang) : s.label));
      expect(m.text).toContain(siteLink(SITE, pageOf(s), lang));
    }
    // The footer, the last part of the message, keeps the message's stop link in both parts and in the header.
    const footer = decode(m.html.slice(m.html.lastIndexOf(t(lang, "briefing.group_why").slice(0, 20))));
    expect(footer).toContain(stopUrl);
    expect(m.text).toContain(stopUrl);
    expect(m.headers["List-Unsubscribe"]).toContain(stopUrl);
    checkMessage(await viaLogSender(m), shapeOf("briefing_group", "grouped message of 100 briefings", SITE), lang);
  });
});
