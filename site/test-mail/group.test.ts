// The grouped saved-search message (src/account/digests.ts groupDigest; docs/accounts.md, Phase 2:
// delivery): more than five of an account's saved searches with news in one run go in one message, a
// section a search. Held here to the checks every message is held to (checks.ts), in English and French,
// with eight searches of every kind; and to its size with an Ultra account's 100 searches: the rows of the
// whole message held to a budget, every search past it one line, the whole under the size at which a
// webmail client clips a message and hides the footer's stop link.
import { describe, expect, it } from "vitest";
import { GROUP_OVER, groupStopPath } from "../src/account/deliveries";
import { GROUP_ROWS_MAX, GROUP_SECTION_ROWS, type GroupSection, groupDigest, siteLink } from "../src/account/digests";
import type { Rise } from "../src/account/records_deliveries";
import type { TenderRow } from "../src/data";
import { t, tn, type Lang } from "../src/i18n";
import { decode, nbsp, newEmail, useAccountsDb } from "../test/accounts-helpers";
import { DAY, R1, R2, R3, SITE, contract, tender } from "../test/mail-fixtures";
import { checkMessage, shapeOf, viaLogSender } from "./checks";

useAccountsDb();

const LANGS = ["en", "fr"] as const;
// Under this many characters of HTML: Gmail clips a message's HTML at about 102 KB (watch-size.test.ts).
const HTML_MAX = 100_000;
const USER = "a".repeat(32);
const hex = (n: number) => n.toString(16).padStart(32, "0");
const stopOf = (lang: Lang, n: number) => siteLink(SITE, `/account/stop?s=${hex(n)}&t=${"b".repeat(32)}`, lang);

const rise = (src: Rise["src"], fy: number, more: number, n: number): Rise => ({ src, fy, more, n, cents: n * 1_000_000 });
const notices = (n: number, seg = "72"): TenderRow[] =>
  Array.from({ length: n }, (_, i) => tender(`cb-${seg}-${String(i).padStart(8, "0")}`, {
    title_en: `Sample works ${seg}-${i}`, title_fr: `Travaux types ${seg}-${i}`, segments: [seg, "43", "81"],
  }));

// The eight searches of the layout test: two of each list kind, and one of each records kind, in the order saved.
function eight(lang: Lang): GroupSection[] {
  const fr = lang === "fr";
  return [
    { kind: "tenders", label: fr ? "Nouveaux avis, segment 72" : "New notices in segment 72", params: "/tenders?segment=72", stopUrl: stopOf(lang, 1),
      rows: notices(3), total: 3 },
    { kind: "expiring", label: fr ? "Contrats de la Défense nationale" : "National Defence contracts", params: "/expiring/3m?buyer=dnd-mdn",
      stopUrl: stopOf(lang, 2), rows: [R1, R2, R3], total: 3, months: 3 },
    { kind: "organization", label: fr ? "Quand Exemplar Works Ltd. est nommée" : "When Exemplar Works Ltd. is named", params: "/organizations/org-e000000001",
      stopUrl: stopOf(lang, 3), rises: [rise("contracts", 2026, 2, 5), rise("grants", 2026, 1, 1)], more: 3, tenders: [], tenderTotal: 0 },
    { kind: "tenders", label: fr ? "Nouveaux avis en Colombie-Britannique" : "New notices in British Columbia", params: "/tenders?province=BC",
      stopUrl: stopOf(lang, 4), rows: notices(8), total: 8 },
    { kind: "buyer", label: fr ? "Défense nationale" : "National Defence", params: "/buyers/dnd-mdn", stopUrl: stopOf(lang, 5),
      rises: [rise("awards", 2026, 4, 40)], more: 4, tenders: [], tenderTotal: 0 },
    { kind: "expiring", label: fr ? "Contrats du segment 46" : "Segment 46 contracts", params: "/expiring/6m?segment=46", stopUrl: stopOf(lang, 6),
      rows: [contract("award", "cb-500-70000001", "2027-04-01")], total: 1, months: 6 },
    { kind: "segment", label: fr ? "Segment 43 Technologies de l'information" : "Segment 43 Information Technology", params: "/segments/43",
      stopUrl: stopOf(lang, 7), rises: [rise("awards", 2026, 2, 12)], more: 2, tenders: notices(2, "43"), tenderTotal: 2 },
    { kind: "tenders", label: fr ? "Services, segment 72" : "Services in segment 72", params: "/tenders?category=SRV&segment=72", stopUrl: stopOf(lang, 8),
      rows: notices(1), total: 1 },
  ];
}

// An Ultra account's 100 searches, every one busy, with labels as long as a filter on several provinces makes them.
function hundred(lang: Lang): GroupSection[] {
  const fr = lang === "fr";
  const label = (i: number) => fr
    ? `Nouveaux avis d'appel d'offres correspondant au segment 72 Services de construction et d'entretien, Colombie-Britannique, Alberta (${i})`
    : `New tender notices matching UNSPSC segment 72 Building and facility construction and maintenance services, British Columbia, Alberta (${i})`;
  return Array.from({ length: 100 }, (_, i): GroupSection => {
    const base = { label: label(i), params: `/tenders?segment=72&province=BC&province=AB&n=${i}`, stopUrl: stopOf(lang, i + 1) };
    switch (i % 4) {
      case 0: return { ...base, kind: "tenders", rows: notices(GROUP_SECTION_ROWS), total: 40 };
      case 1: return { ...base, kind: "expiring", params: `/expiring/12m?buyer=dnd-mdn&n=${i}`, rows: [R1, R2, R3, R1, R2], total: 25, months: 12 };
      case 2: return {
        ...base, kind: "organization", params: `/organizations/org-e0000000${String(i).padStart(2, "0")}`,
        rises: [rise("awards", 2026, 3, 9), rise("history", 2026, 2, 7), rise("contracts", 2026, 5, 40), rise("grants", 2025, 1, 2), rise("contracts", 2024, 1, 3)],
        more: 12, tenders: [], tenderTotal: 0,
      };
      default: return {
        ...base, kind: "segment", params: "/segments/43", rises: [rise("awards", 2026, 3, 30)], more: 3, tenders: notices(GROUP_SECTION_ROWS, "43"), tenderTotal: 30,
      };
    }
  });
}

async function message(lang: Lang, sections: GroupSection[], tag: string) {
  const members = sections.map((_, i) => ({ id: hex(i + 1), secret: "b".repeat(32) }));
  const stopUrl = siteLink(SITE, await groupStopPath(USER, members), lang);
  return { stopUrl, m: groupDigest({ lang, to: newEmail(`group-${tag}-${lang}`), site: SITE, dataDate: DAY, stopUrl, sections, over: GROUP_OVER }) };
}

const headings = (html: string) => [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((x) => nbsp(decode(x[1])));

describe("the grouped message", () => {
  it.each(LANGS)("lays out eight searches of every kind a section each, held to the checks every message is held to (%s)", async (lang) => {
    const sections = eight(lang);
    const { m, stopUrl } = await message(lang, sections, "eight");
    checkMessage(await viaLogSender(m), shapeOf("group", "grouped message of eight searches", SITE), lang);
    expect(m.subject).toBe(t(lang, "digest.group_subject", { n: 8, date: DAY }));
    // A section a search, in the order given, each headed by its label, with its count linking its list and its own stop link.
    expect(headings(m.html)).toEqual(sections.map((s) => nbsp(s.label)));
    const html = decode(m.html);
    for (const s of sections) {
      expect(html).toContain(`href="${siteLink(SITE, s.params, lang)}"`);
      expect(html).toContain(`href="${s.stopUrl}"`);
      expect(nbsp(m.text)).toContain(nbsp(t(lang, "digest.text_link", { label: t(lang, "digest.group_stop_one"), url: s.stopUrl })));
    }
    // The message's own stop link: in the footer, in the text part, and the header's.
    expect(m.headers["List-Unsubscribe"]).toBe(`<mailto:contact@awardwatch.ca>, <${stopUrl}>`);
    expect(m.text).toContain(stopUrl);
    // The rows each section lists, at most GROUP_SECTION_ROWS: 3, 3, 2, 5 of 8, 1, 1, 3 (two notices then the count), 1.
    expect((m.html.match(/<tr><td class="rule"/g) ?? []).length).toBe(3 + 3 + 2 + 5 + 1 + 1 + 3 + 1);
    const more = nbsp(tn(lang, "digest.more_one", "digest.more_many", 3, { n: 3 }));
    expect(nbsp(html)).toContain(`>${more}</a>`);
    // The notes of the kinds it carries, once each.
    for (const key of ["digest.tenders_note", "digest.expiring_note", "digest.records_note"] as const) {
      expect(nbsp(m.text).split(nbsp(t(lang, key))).length - 1, key).toBe(1);
    }
  });

  it.each(LANGS)("stays under 100,000 characters of HTML with 100 searches, every search named, the rows held to the budget (%s)", async (lang) => {
    const sections = hundred(lang);
    const { m, stopUrl } = await message(lang, sections, "hundred");
    expect(m.html.length).toBeLessThan(HTML_MAX);
    // The rows of the whole message, then the searches past them one line each under one band.
    expect((m.html.match(/<tr><td class="rule"/g) ?? []).length).toBe(GROUP_ROWS_MAX);
    const full = Math.ceil(GROUP_ROWS_MAX / GROUP_SECTION_ROWS);
    const rest = nbsp(tn(lang, "digest.group_rest_one", "digest.group_rest_many", 100 - full, { n: 100 - full }));
    expect(headings(m.html)).toEqual([...sections.slice(0, full).map((s) => nbsp(s.label)), rest]);
    // Nothing left out: every search's label, in both parts (the text part writes a section's heading in
    // capitals, as its band shows it), with its list's link.
    for (const [k, s] of sections.entries()) {
      expect(nbsp(decode(m.html)), s.label).toContain(nbsp(s.label));
      expect(nbsp(m.text), s.label).toContain(nbsp(k < full ? s.label.toLocaleUpperCase(lang) : s.label));
      expect(m.text).toContain(siteLink(SITE, s.params, lang));
    }
    // The footer, the last part of the message, keeps the message's stop link in both parts and in the header.
    const footer = decode(m.html.slice(m.html.lastIndexOf(t(lang, "digest.group_why").slice(0, 20))));
    expect(footer).toContain(stopUrl);
    expect(m.text).toContain(stopUrl);
    expect(m.headers["List-Unsubscribe"]).toContain(stopUrl);
    checkMessage(await viaLogSender(m), shapeOf("group", "grouped message of 100 searches", SITE), lang);
  });
});
