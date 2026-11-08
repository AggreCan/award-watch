// The home page's two tender lists: a Type column (the notice type's short
// form over the method) in place of Published, the time left on every row,
// the Open chip gone and the passed one kept, the provinces under the buyer
// while their column rests, and the segment note in the first list's foot.
import { describe, expect, it } from "vitest";
import { METHOD_SHORT, NOTICE_TYPE_SHORT } from "../src/constants";
import type { TenderRow } from "../src/data";
import { allKeys, t, type Key } from "../src/i18n";
import { app } from "../src/index";
import { homeRequest } from "./home";
import { methodShort, noticeTypeShort } from "../src/pages/shared";
import { makeFakeAssets, testEnv } from "./assets";
import stats from "./fixtures/stats.json";

let address = 0;
const text = async (path: string, overrides: Record<string, unknown> = {}) =>
  (await homeRequest(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.11.${(address++ % 250) + 1}` } },
    testEnv(makeFakeAssets({}, overrides)))).text();
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
// One list's panel, from its head to the next panel.
const panel = (html: string, heading: string) => {
  const from = html.indexOf(`<h2>${heading}</h2>`);
  return html.slice(from, html.indexOf('<section class="panel', from + 1));
};
const rowOf = (html: string, ref: string) => html.match(new RegExp(`<tr>(?:(?!</tr>)[\\s\\S])*?/tenders/${ref}"[\\s\\S]*?</tr>`))?.[0] ?? "";

const base = (stats.new_tenders as unknown as TenderRow[])[0];
const row = (reference: string, over: Partial<TenderRow>): TenderRow => ({ ...base, reference, ...over });
// The clock is noon Eastern on 2026-10-31 (test/assets.ts TEST_NOW).
const ROWS: TenderRow[] = [
  row("cb-900-90000001", {
    notice_type_en: "Request for Supply Arrangement", notice_type_fr: "Demande d'arrangement en matière d'approvisionnement",
    method_en: "Competitive - Selective tendering", method_fr: "Concurrentielle - Appel d'offres sélectif", closing: "2026-11-26T14:00:00",
  }),
  row("cb-900-90000002", { method_en: "Competitive - Open bidding", method_fr: "Concurrentielle - Invitation ouverte à soumissionner", closing: "2026-11-02T14:00:00" }),
  row("cb-900-90000003", { closing: "2026-10-30T14:00:00" }),
  row("cb-900-90000004", {
    notice_type_en: "Advance Contract Award Notice", notice_type_fr: "Préavis d'attribution du contrat",
    method_en: "Advance contract award notice", method_fr: "Préavis d'attribution du contrat", closing: "2026-11-20T14:00:00",
  }),
  row("cb-900-90000005", {
    notice_type_en: "Request for Expression of Interest", notice_type_fr: "Demande de manifestation d'intérêt",
    method_en: "Competitive - Something new", method_fr: "Concurrentielle - Quelque chose de nouveau", closing: "2026-11-20T14:00:00",
  }),
];
const withRows = { "stats.json": { ...stats, new_tenders: ROWS, counts: { ...stats.counts, tenders_new_today: ROWS.length } } };

describe("the short forms", () => {
  it("have a published value behind each and both languages, and no entry without a value", () => {
    const keys = new Set<string>(allKeys());
    const typeIds = Object.values(NOTICE_TYPE_SHORT).filter((id): id is string => id !== null);
    const methodIds = Object.values(METHOD_SHORT);
    for (const id of typeIds) expect(keys.has(`type.${id}`), id).toBe(true);
    for (const id of methodIds) expect(keys.has(`method.${id}`), id).toBe(true);
    // Every type.* and method.* entry is reached from a published value.
    expect([...keys].filter((k) => k.startsWith("type.")).sort()).toEqual(typeIds.map((id) => `type.${id}`).sort());
    expect([...keys].filter((k) => k.startsWith("method.")).sort()).toEqual(methodIds.map((id) => `method.${id}`).sort());
    for (const k of [...typeIds.map((id) => `type.${id}`), ...methodIds.map((id) => `method.${id}`)] as Key[]) {
      expect(t("en", k), k).toMatch(/\S/);
      expect(t("fr", k), k).toMatch(/\S/);
      expect(t("fr", k), k).not.toBe(t("en", k));
    }
    // A Type cell is 112 px of text: every short form fits on its line.
    for (const id of typeIds) expect(t("en", `type.${id}` as Key).length, id).toBeLessThanOrEqual(8);
  });

  it("read the published values, in either case, and print an unknown value as published", () => {
    expect(noticeTypeShort("en", "Request for Proposal", "Demande de propositions")).toEqual({ text: "RFP", short: true });
    expect(noticeTypeShort("fr", "RFP against Supply Arrangement", null)).toEqual({ text: "DP (AMA)", short: true });
    expect(noticeTypeShort("en", "Not Applicable", "Sans objet")).toBeNull();
    expect(noticeTypeShort("en", null, null)).toBeNull();
    expect(noticeTypeShort("fr", "Request for Expression of Interest", "Demande de manifestation d'intérêt"))
      .toEqual({ text: "Demande de manifestation d'intérêt", short: false });
    expect(methodShort("en", "Competitive - Open bidding", null, "Request for Proposal")).toBe("Open bidding");
    expect(nbsp(methodShort("fr", "Competitive - Selective tendering", null, "Request for Proposal") ?? "")).toBe("Appel d’offres sélectif");
    expect(methodShort("en", "Non-competitive", null, null)).toBe("Non-competitive");
    // An advance contract award notice's method says what its type already says.
    expect(methodShort("en", "Advance contract award notice", null, "Advance Contract Award Notice")).toBeNull();
    expect(methodShort("en", "Advance contract award notice", null, "Request for Proposal")).toBe("ACAN");
    expect(methodShort("en", "Competitive - Something new", "Concurrentielle - Autre", null)).toBe("Competitive - Something new");
    expect(methodShort("fr", "Competitive - Something new", "Concurrentielle - Autre", null)).toBe("Concurrentielle - Autre");
  });
});

describe("the home lists' rows", () => {
  it("carry the type over the method, the published name on hover", async () => {
    const html = await text("/", withRows);
    const list = panel(html, "New Tender Notices Today");
    expect(rowOf(list, "cb-900-90000001")).toContain(
      '<td data-label="Type" class="c-type mdh"><abbr class="type-name" title="Request for Supply Arrangement">RFSA</abbr><span class="type-method">Selective tendering</span></td>');
    expect(rowOf(list, "cb-900-90000004")).toContain(
      '<td data-label="Type" class="c-type mdh"><abbr class="type-name" title="Advance Contract Award Notice">ACAN</abbr></td>');
    expect(rowOf(list, "cb-900-90000005")).toContain(
      '<td data-label="Type" class="c-type mdh"><span class="type-name">Request for Expression of Interest</span><span class="type-method">Competitive - Something new</span></td>');
    const fr = nbsp(panel(await text("/?lang=fr", withRows), "Nouveaux avis d’appel d’offres aujourd’hui"));
    expect(rowOf(fr, "cb-900-90000001")).toContain(
      '<abbr class="type-name" title="Demande d&#39;arrangement en matière d&#39;approvisionnement">DAMA</abbr><span class="type-method">Appel d’offres sélectif</span>');
  });

  it("say how long is left on every open row, live and amber within the week, and keep the passed chip", async () => {
    const list = panel(await text("/", withRows), "New Tender Notices Today");
    // Beyond the closing-soon window: a day count, static, no chip.
    const far = rowOf(list, "cb-900-90000001");
    expect(far).toContain('<td data-label="Closing" class="mono c-date">2026-11-26 14:00 ET <span class="countdown countdown-far">closes in 26 days</span></td>');
    expect(far).not.toContain("badge");
    // Within it: the countdown's marks, the chip waiting hidden for the script.
    const soon = rowOf(list, "cb-900-90000002");
    expect(soon).toContain('data-closes="2026-11-02T19:00:00Z" data-time="14:00 ET" data-notice="cb-900-90000002"');
    expect(soon).toContain('<span class="badge badge-closing" data-notice="cb-900-90000002" hidden="">Closing soon</span><span class="countdown">closes in 2 days</span>');
    // Passed: the chip, no line; and it sorts last.
    const passed = rowOf(list, "cb-900-90000003");
    expect(passed).toContain('<span class="badge badge-closed">Closing date passed</span>');
    expect(passed).not.toContain("countdown");
    expect(list.indexOf("cb-900-90000003")).toBeGreaterThan(list.indexOf("cb-900-90000005"));
    // No Open chip on either list.
    expect(list).not.toContain("badge-open");
    expect(panel(await text("/", withRows), "Closing Within 7 Days")).not.toContain("badge-open");
  });

  it("drop the Published column, which /tenders/new keeps, and put the provinces under the buyer for medium screens", async () => {
    const html = await text("/");
    for (const heading of ["New Tender Notices Today", "Closing Within 7 Days"]) {
      const list = panel(html, heading);
      expect(list, heading).not.toContain("c-pub");
      expect(list, heading).toContain('<th class="k-region mdh c-region"><button type="button" class="th-sort">Provinces of delivery</button></th>');
      expect(list, heading).toContain('<span class="split-only md-only muted small">');
    }
    const day = await text("/tenders/new");
    expect(day).toContain('<th class="k-date mdh c-pub"><button type="button" class="th-sort">Published</button></th>');
    expect(day).not.toContain("md-only");
    expect(day).not.toContain('class="c-type');
  });

  it("put the segment note in the first list's foot, once", async () => {
    const html = await text("/");
    const note = "The tags after a reference are UNSPSC segments (the categories buyers code each notice with), by number and short name.";
    expect(html.split(note)).toHaveLength(2);
    expect(panel(html, "New Tender Notices Today")).toContain(`<div class="panel-foot"><p class="muted small">${note}</p></div>`);
    // A day with no segment on its new notices: the note goes to the closing-soon list's foot.
    const bare = await text("/", { "stats.json": { ...stats, new_tenders: stats.new_tenders.map((r) => ({ ...r, segments: [] })) } });
    expect(bare.split(note)).toHaveLength(2);
    expect(panel(bare, "Closing Within 7 Days")).toContain(`<div class="panel-foot"><p class="muted small">${note}</p></div>`);
  });
});
