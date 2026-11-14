// A tender notice's documents (pages/tender.tsx DocumentsPanel): the links the
// export carries for the notice (export_static.tender_attachments), each
// checked again before it renders; the line beside them saying when the notice
// closes, which is the lists' figure (closing.ts closesLine, countdownText) in
// the page's clock, live while the notice closes soon; the fallback to the
// CanadaBuys notice when the file names none or predates the field; both
// languages, no em-dash and no contact detail.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { clockAt, closesLine, countdownLine } from "../src/closing";
import { documentUrl, tenderAttachments, type TenderDetail } from "../src/data";
import { app } from "../src/index";
import rowsPy from "../../pipeline/awardwatch_pipeline/sources/canadabuys_rows.py?raw";
import { DESCRIPTION_KEPT_UNMARKED, DESCRIPTION_SLACK, descriptionCut, publishedText, shownDescription } from "../src/pages/shared";
import { FILES, TEST_NOW, makeFakeAssets, testEnv } from "./assets";

const EM_DASH = String.fromCharCode(0x2014);
const CB = "https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/";
const SSC = "https://sscp2pspc.ssc-spc.gc.ca/page.aspx/en/fil/download_public/359FE376-8B8E-4262-8BA7-FF84512C5F6C";
// Kept apart so a link with a user name in it reads as no address in this file.
const AT = "@";
const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

let address = 0;
const page = async (path: string, now: string = TEST_NOW, overrides: Record<string, unknown> = {}) => {
  const res = await app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.18.9.${(address++ % 250) + 1}` } },
    testEnv(makeFakeAssets({}, overrides), now));
  expect(res.status, path).toBe(200);
  return res.text();
};

// The fixture shard with one notice's entry changed.
const shard = (ref: string, patch: (entry: Record<string, unknown>) => void) => {
  const s = clone(FILES["tenders/20a.json"]) as Record<string, Record<string, unknown>>;
  patch(s[ref]);
  return { "tenders/20a.json": s };
};

const DOCUMENTS = [
  { url: `${CB}111717/w8703-270117-rfp-demo-kit%2C-bangalore-torpedo-en.pdf`, name: "w8703-270117-rfp-demo-kit,-bangalore-torpedo-en.pdf" },
  { url: SSC, name: "359FE376-8B8E-4262-8BA7-FF84512C5F6C" },
  // Never rendered: another host, an address, a plain-http link, a script, the first again.
  { url: "https://example.com/elsewhere.pdf", name: "elsewhere.pdf" },
  { url: `${CB}1/officer%40example.invalid.pdf`, name: "officer@example.invalid.pdf" },
  { url: "http://canadabuys.canada.ca/plain.pdf", name: "plain.pdf" },
  { url: "javascript:alert(1)", name: "script" },
  { url: `${CB}111717/w8703-270117-rfp-demo-kit%2C-bangalore-torpedo-en.pdf`, name: "again.pdf" },
];
const withDocuments = shard("cb-200-20005019", (e) => {
  e.attachments = DOCUMENTS;
  e.description_en = "Hull inspection and repair.";
  e.description_fr = "Inspection et réparation de coques.";
});

// The Documents panel of a page.
const panel = (html: string) => {
  const start = html.indexOf('<section class="panel tender-documents"');
  expect(start, "the Documents panel").toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</section>", start) + "</section>".length);
};

describe("a description the site keeps only the start of", () => {
  const WORDS = "The work includes mechanical systems for the ablutions building and related site services. ";
  // The pipeline's figures (sources/canadabuys_rows.py): what a tender notice keeps, what an award notice and
  // a history record keep, and what a row stored before the cut was recorded holds.
  const figure = (name: string) => Number(new RegExp(`^${name} = ([0-9_]+)$`, "m").exec(rowsPy)?.[1].replace(/_/g, ""));
  const TENDER_MAX = figure("TENDER_DESCRIPTION_MAX");
  const AWARD_MAX = figure("DESCRIPTION_MAX");
  // As the pipeline stores a long one today: the start, ending on a whole word, with the cut recorded.
  const kept = `First paragraph.\n\n${WORDS.repeat(9)}`.trim();
  // As a row stored before the cut was recorded holds one: its first 600 characters, ending inside a word.
  const oldCut = `First paragraph.\n\n${WORDS.repeat(9)}`.slice(0, DESCRIPTION_KEPT_UNMARKED);
  const whole = "A short description, whole as published.";
  const described = (text: string | null, cut?: unknown) => shard("cb-200-20005019", (e) => {
    e.description_en = text;
    e.description_fr = null;
    if (cut !== undefined) e.description_cut = cut;
  });
  const descriptionPanel = (html: string) => {
    const at = html.indexOf("<h2>Description as Published</h2>");
    return html.slice(at, html.indexOf("</section>", at));
  };

  it("reads a row stored before the mark at the length the pipeline stored it", () => {
    expect(figure("UNMARKED_DESCRIPTION_MAX")).toBe(DESCRIPTION_KEPT_UNMARKED);
    expect(TENDER_MAX).toBe(10000);
    expect(AWARD_MAX).toBe(600);
    // The pipeline's description_cut, as the site reads it.
    expect(descriptionCut({ en: TENDER_MAX }, "en")).toBe(TENDER_MAX);
    expect(descriptionCut({ en: TENDER_MAX }, "fr")).toBe(0);
    expect(descriptionCut({}, "en")).toBe(0);
    for (const bad of [undefined, null, [], "600", { en: "600" }, { en: 0 }, { en: -5 }, { en: 1.5 }, { de: 600 }]) {
      expect(descriptionCut(bad, "en"), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("marks a text the pipeline cut, with the figure it kept, in both languages", async () => {
    const shown = publishedText(kept, TENDER_MAX);
    expect(shown).toEqual({ text: `${kept.replace(/[.\s]+$/, "")}…`, cut: true, kept: TENDER_MAX });
    const panelHtml = descriptionPanel(await page("/tenders/cb-200-20005019", TEST_NOW, described(kept, { en: TENDER_MAX })));
    expect(panelHtml).toContain("<p>First paragraph.</p>");
    expect(panelHtml).toContain("site services…</p></div>");
    expect(panelHtml).toMatch(/<p class="muted small">The site keeps the first 10,000 characters of a description\. The whole text is on <a href="https:\/\/canadabuys\.canada\.ca\/[^"]+" rel="noopener">the CanadaBuys notice<\/a>\.<\/p>/);
    const fr = nbsp(await page("/tenders/cb-200-20005019?lang=fr", TEST_NOW, shard("cb-200-20005019", (e) => {
      e.description_fr = kept;
      e.description_cut = { fr: TENDER_MAX };
    })));
    // The apostrophe is typeset on a French page, so it is matched as any one character.
    expect(fr).toMatch(/Le site conserve les 10 000 premiers caractères d(.|&#39;)une description\. Le texte complet se trouve dans <a href=/);
    expect(fr).not.toContain(EM_DASH);
  });

  it("shows a text the pipeline kept whole as it is, whatever its length", async () => {
    // 600 characters long, which the length rule would read as cut.
    const long = `${WORDS.repeat(6)}${"x".repeat(600 - WORDS.length * 6)}`;
    expect(long).toHaveLength(600);
    expect(publishedText(long).cut).toBe(true);
    expect(publishedText(long, 0)).toEqual({ text: long, cut: false });
    const html = await page("/tenders/cb-200-20005019", TEST_NOW, described(long, {}));
    expect(html).toContain(`<div class="prose"><p>${long}</p></div></section>`);
    expect(html).not.toContain("The site keeps the first");
  });

  it("follows the language the page shows when its own is blank", () => {
    const d = { description_en: null, description_fr: kept, description_cut: { fr: TENDER_MAX } };
    expect(shownDescription("en", d)).toEqual({ text: kept, cut: TENDER_MAX });
    expect(shownDescription("fr", d)).toEqual({ text: kept, cut: TENDER_MAX });
    const both = { description_en: whole, description_fr: kept, description_cut: { fr: TENDER_MAX } };
    expect(shownDescription("en", both)).toEqual({ text: whole, cut: 0 });
    expect(shownDescription("en", { description_en: whole, description_fr: null })).toEqual({ text: whole, cut: undefined });
  });

  it("reads a row stored before the mark by its length: to its last whole word, with the figure it was stored at", async () => {
    expect(oldCut).toHaveLength(DESCRIPTION_KEPT_UNMARKED);
    const shown = publishedText(oldCut);
    expect(shown.cut).toBe(true);
    expect(shown.text.endsWith("…")).toBe(true);
    // Nothing of the half word the cut left, and no punctuation before the ellipsis.
    expect(oldCut.startsWith(shown.text.slice(0, -1))).toBe(true);
    expect(shown.text).toMatch(/\w…$/);
    expect(oldCut[shown.text.length - 1]).toMatch(/[\s,;:.]/);
    // A cut that ended on spaces is stored shorter; it still reads as cut.
    expect(publishedText(oldCut.slice(0, DESCRIPTION_KEPT_UNMARKED - DESCRIPTION_SLACK)).cut).toBe(true);
    expect(publishedText(oldCut.slice(0, DESCRIPTION_KEPT_UNMARKED - DESCRIPTION_SLACK - 1)).cut).toBe(false);
    // A mark that does not read is no mark.
    for (const mark of [undefined, { en: "all" }]) {
      const panelHtml = descriptionPanel(await page("/tenders/cb-200-20005019", TEST_NOW, described(oldCut, mark)));
      expect(panelHtml).toContain("…</p></div>");
      expect(panelHtml).toContain("The site keeps the first 600 characters of a description.");
    }
    const fr = nbsp(await page("/tenders/cb-200-20005019?lang=fr", TEST_NOW, shard("cb-200-20005019", (e) => { e.description_fr = oldCut; })));
    expect(fr).toMatch(/Le site conserve les 600 premiers caractères d(.|&#39;)une description\. Le texte complet se trouve dans <a href=/);
  });

  it("leaves a shorter description as it is, with no line under it", async () => {
    expect(publishedText(whole)).toEqual({ text: whole, cut: false });
    for (const mark of [undefined, {}]) {
      const html = await page("/tenders/cb-200-20005019", TEST_NOW, described(whole, mark));
      expect(html).toContain(`<div class="prose"><p>${whole}</p></div></section>`);
      expect(html).not.toContain("The site keeps the first");
    }
  });

  it("marks an award notice's and a history record's cut at the figure they keep", async () => {
    const contracts = (key: string, cut: unknown) => {
      const s = clone(FILES["contracts/637.json"]) as Record<string, Record<string, unknown>>;
      s[key].description_en = oldCut;
      s[key].description_cut = cut;
      return { "contracts/637.json": s };
    };
    const award = await page("/awards/cb-400-40000004", TEST_NOW, contracts("award:cb-400-40000004", { en: AWARD_MAX }));
    expect(award).toMatch(/<p class="muted small">The site keeps the first 600 characters of a description\. The whole text is on <a href="https:\/\/canadabuys\.canada\.ca\/[^"]+" rel="noopener">/);
    const history = await page("/history/w8472-000633", TEST_NOW, contracts("history:W8472-000633", { en: AWARD_MAX }));
    expect(history).toContain('<p class="muted small">The site keeps the first 600 characters of a description.</p>');
    // Kept whole: no line, though the length rule would have read it as cut.
    const wholeAward = await page("/awards/cb-400-40000004", TEST_NOW, contracts("award:cb-400-40000004", {}));
    expect(wholeAward).not.toContain("The site keeps the first");
    expect(wholeAward).not.toContain("…</p></div>");
    expect(publishedText(oldCut).cut).toBe(true);
  });

  it("breaks a long link in a description rather than widen the page", async () => {
    // A quarter of the open notices' first 10,000 characters hold a word too long for a phone's line.
    const styles = (env as unknown as { STYLES_CSS: string }).STYLES_CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(/\n\.prose \{([^}]*)\}/.exec(styles)?.[1]).toContain("overflow-wrap: anywhere;");
    const link = `https://canadabuys.canada.ca/${"a".repeat(120)}.pdf`;
    const html = await page("/tenders/cb-200-20005019", TEST_NOW, described(`See ${link} for the plans.`, {}));
    expect(html).toContain(`<div class="prose"><p>See ${link} for the plans.</p></div>`);
  });

  it("gives the API the mark with the text", async () => {
    const res = await app.request("/api/tenders/cb-200-20005019", { headers: { "cf-connecting-ip": `198.18.9.${(address++ % 250) + 1}` } },
      testEnv(makeFakeAssets({}, described(kept, { en: TENDER_MAX }))));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.description_cut).toEqual({ en: TENDER_MAX });
    expect(body.description_en).toBe(kept);
  });
});

describe("the Documents panel", () => {
  it("lists each document the notice names, under the key facts and above the description", async () => {
    const html = await page("/tenders/cb-200-20005019", TEST_NOW, withDocuments);
    const p = panel(html);
    expect(p).toContain('<h2>Documents</h2>');
    expect(p).toContain('<span class="panel-count">2 documents</span>');
    expect(p).toContain('<ul class="plain documents"><li><a href="https://canadabuys.canada.ca/sites/default/files/webform/tender_notice/111717/' +
      'w8703-270117-rfp-demo-kit%2C-bangalore-torpedo-en.pdf" rel="nofollow noopener">w8703-270117-rfp-demo-kit,-bangalore-torpedo-en.pdf</a></li>' +
      `<li><a href="${SSC}" rel="nofollow noopener">359FE376-8B8E-4262-8BA7-FF84512C5F6C</a></li></ul>`);
    // The hosts once, muted in the foot: CanadaBuys by its name, another government host as written.
    expect(p).toContain('<div class="panel-foot">On CanadaBuys, sscp2pspc.ssc-spc.gc.ca</div>');
    for (const never of ["example.com", "officer", "http://", "javascript:", "again.pdf"]) expect(p, never).not.toContain(never);
    // Under the key facts, above the description.
    expect(html.indexOf("tender-documents")).toBeGreaterThan(html.indexOf("<h2>Buyer</h2>"));
    expect(html.indexOf("tender-documents")).toBeLessThan(html.indexOf("<h2>Description as Published</h2>"));
    // The button keeps its name.
    expect(html).toContain(">Open the notice on CanadaBuys</a>");
  });

  it("reads in French", async () => {
    const p = nbsp(panel(await page("/tenders/cb-200-20005019?lang=fr", TEST_NOW, withDocuments)));
    expect(p).toContain('<h2>Documents</h2>');
    expect(p).toContain('<span class="panel-count">2 documents</span>');
    expect(p).toContain('<div class="panel-foot">Sur AchatsCanada, sscp2pspc.ssc-spc.gc.ca</div>');
    expect(p).toContain("Clôture dans 26 jours");
  });

  it("names one document in the singular, and shows only CanadaBuys in the foot when every file is there", async () => {
    const one = shard("cb-200-20005019", (e) => { e.attachments = [DOCUMENTS[0]]; });
    expect(panel(await page("/tenders/cb-200-20005019", TEST_NOW, one))).toContain('<span class="panel-count">1 document</span>');
    expect(panel(await page("/tenders/cb-200-20005019", TEST_NOW, one))).toContain('<div class="panel-foot">On CanadaBuys</div>');
  });

  it("points at the CanadaBuys notice when the notice names none, or its file predates the field", async () => {
    // The fixture's entries carry no attachments: an export from before the field.
    const html = await page("/tenders/cb-100-10000001");
    const p = panel(html);
    expect(p).toContain('<p>The documents are on <a href="https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-100-10000001" ' +
      'rel="noopener">the CanadaBuys notice</a>.</p>');
    expect(p).not.toContain("panel-count");
    expect(p).not.toContain("panel-foot");
    const fr = nbsp(panel(await page("/tenders/cb-100-10000001?lang=fr")));
    expect(fr).toContain('<p>Les documents se trouvent dans <a href="https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/cb-100-10000001" ' +
      'rel="noopener">l’avis publié sur AchatsCanada</a>.</p>');
    // An empty list, a field that does not read, or a list with no usable link: the same line, and the page stands.
    for (const bad of [[], "not a list", { url: `${CB}1/a.pdf` }, [null, 5, { url: 7 }, { url: "https://example.com/a.pdf", name: "a.pdf" }]]) {
      const p2 = panel(await page("/tenders/cb-200-20005019", TEST_NOW, shard("cb-200-20005019", (e) => { e.attachments = bad; })));
      expect(p2, JSON.stringify(bad)).toContain("The documents are on");
    }
  });

  it("names a document from its link when the file gives no name", () => {
    const d = { attachments: [{ url: `${CB}111714/30008413---rfq-%28en_final.pdf` }, { url: `${CB}2/`, name: " " }] } as unknown as TenderDetail;
    expect(tenderAttachments(d)).toEqual([
      { url: `${CB}111714/30008413---rfq-%28en_final.pdf`, name: "30008413---rfq-(en_final.pdf" },
      { url: `${CB}2/`, name: "2" },
    ]);
    // Fifty at most.
    const many = { attachments: Array.from({ length: 60 }, (_, i) => ({ url: `${CB}9/${i}.pdf`, name: `${i}.pdf` })) } as unknown as TenderDetail;
    expect(tenderAttachments(many)).toHaveLength(50);
  });

  it("links only https on a Government of Canada host", () => {
    for (const ok of [`${CB}1/a.pdf`, SSC, "https://canada.ca/en/a.pdf", "https://www.tpsgc-pwgsc.gc.ca/a.pdf", "https://achatscanada.canada.ca:443/a.pdf"]) {
      expect(documentUrl(ok), ok).not.toBeNull();
    }
    for (const bad of [
      "http://canadabuys.canada.ca/a.pdf", "https://example.com/a.pdf", "https://canadabuys.canada.ca.example.com/a.pdf",
      "https://notgc.ca/a.pdf", "https://gc.ca/a.pdf", `https://someone${AT}canadabuys.canada.ca/a.pdf`, "https://canadabuys.canada.ca:8443/a.pdf",
      "mailto:officer@example.invalid", `${CB}1/officer%40example.invalid.pdf`, "javascript:alert(1)", "data:text/html,x", "/relative.pdf",
      "https://canadabuys.canada.ca/a b.pdf", 7, null,
    ]) {
      expect(documentUrl(bad), String(bad)).toBeNull();
    }
  });

  it("gives the API the same documents the page links", async () => {
    const api = async (overrides: Record<string, unknown>) => {
      const res = await app.request("/api/tenders/cb-200-20005019", { headers: { "cf-connecting-ip": `198.18.9.${(address++ % 250) + 1}` } },
        testEnv(makeFakeAssets({}, overrides)));
      expect(res.status).toBe(200);
      return (await res.json()) as Record<string, unknown>;
    };
    const body = await api(withDocuments);
    expect(body.attachments).toEqual([DOCUMENTS[0], DOCUMENTS[1]]);
    // A file from before the field: no key, as exported.
    expect("attachments" in (await api({}))).toBe(false);
  });

  it("never shows a contact, an em-dash or advice", async () => {
    const contact = shard("cb-200-20005019", (e) => {
      e.attachments = DOCUMENTS;
      // A file that carried a contact, against the export's rule: the page still shows none.
      e.contact_name = "Pat Officer";
      e.contact_email = "pat.officer@example.invalid";
      e.contact_phone = "613-555-0100";
    });
    for (const lang of ["en", "fr"]) {
      const html = await page(`/tenders/cb-200-20005019?lang=${lang}`, TEST_NOW, contact);
      for (const secret of ["Pat Officer", "pat.officer", "613-555-0100", "officer@"]) expect(html, secret).not.toContain(secret);
      const p = panel(html);
      expect(p).not.toContain(EM_DASH);
      expect(p).not.toMatch(/opportunit|bid now|you should|soumissionnez/i);
    }
  });
});

describe("the closing line beside the documents", () => {
  const line = (html: string) => panel(html).match(/<p class="documents-closing"[^>]*>[\s\S]*?<\/p>/)?.[0] ?? "";

  it("says how many days are left, the figure the lists show", async () => {
    // 2026-11-26 14:00 Eastern from noon Eastern on 2026-10-31: 26 days and 3 hours.
    const html = await page("/tenders/cb-200-20005019", TEST_NOW, withDocuments);
    expect(line(html)).toBe('<p class="documents-closing"><span class="countdown countdown-far">Closes in 26 days</span></p>');
    const clock = clockAt(Date.parse(TEST_NOW));
    expect(countdownLine("2026-11-26T14:00:00", clock, "en")).toBe("closes in 26 days");
    // Not within the closing-soon window: no countdown script for the line to wait on.
    expect(html).not.toContain("/countdown.js");
  });

  it("is kept live by the countdown while the notice closes soon", async () => {
    // cb-100-10000001 closes 2026-11-04 at 14:00 Eastern (19:00 UTC).
    const html = await page("/tenders/cb-100-10000001", "2026-11-04T15:00:00Z");
    expect(line(html)).toBe('<p class="documents-closing" data-closes="2026-11-04T19:00:00Z" data-time="14:00 ET" data-notice="cb-100-10000001" ' +
      'data-words="line"><span class="countdown">Closes in 4 h 0 min</span></p>');
    const block = JSON.parse(html.match(/<script type="application\/json" id="countdown-i18n">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
    expect(block.line).toEqual({
      in_min: "Closes in {m} min", in_hm: "Closes in {h} h {m} min", in_day: "Closes in 1 day", in_days: "Closes in {n} days",
      today_at: "Closes today at {time}",
    });
    // The lists' words stay as they were.
    expect(block.words.in_days).toBe("closes in {n} days");
    expect(html).toContain('<script type="module" src="/countdown.js"></script>');
    expect(line(await page("/tenders/cb-100-10000001", "2026-11-02T12:00:00Z"))).toContain(">Closes in 2 days</span>");
  });

  it("says today on the closing day, and the date has passed after it", async () => {
    expect(line(await page("/tenders/cb-100-10000001", "2026-11-04T12:00:00Z"))).toContain(">Closes today at 14:00 ET</span>");
    const gone = await page("/tenders/cb-100-10000001", "2026-11-04T19:00:00Z");
    expect(line(gone)).toBe('<p class="documents-closing"><span class="countdown countdown-far">Closing date passed</span></p>');
    expect(gone).not.toContain("data-closes=");
    // A closing with a date and no time lasts the Eastern day.
    const dayOnly = shard("cb-200-20005019", (e) => { e.closing = "2026-10-31"; });
    // Closing soon, so amber as the lists mark it; with no time to count down to, no countdown hook.
    expect(line(await page("/tenders/cb-200-20005019", TEST_NOW, dayOnly))).toBe('<p class="documents-closing"><span class="countdown">Closes today</span></p>');
    expect(line(await page("/tenders/cb-200-20005019", "2026-11-01T16:00:00Z", dayOnly))).toContain(">Closing date passed</span>");
  });

  it("reads in French", async () => {
    const fr = (now: string) => page("/tenders/cb-100-10000001?lang=fr", now).then((h) => nbsp(line(h)));
    expect(await fr("2026-11-04T15:00:00Z")).toContain(">Clôture dans 4 h 0 min</span>");
    expect(await fr("2026-11-04T12:00:00Z")).toContain(">Clôture aujourd’hui à 14 h 00 HE</span>");
    expect(await fr("2026-11-02T12:00:00Z")).toContain(">Clôture dans 2 jours</span>");
    expect(await fr("2026-11-04T19:00:00Z")).toContain(">Date de clôture passée</span>");
    const html = await page("/tenders/cb-100-10000001?lang=fr", "2026-11-04T15:00:00Z");
    const block = JSON.parse(html.match(/<script type="application\/json" id="countdown-i18n">([\s\S]*?)<\/script>/)?.[1] ?? "{}");
    expect(block.line.in_days).toBe("Clôture dans {n} jours");
  });

  it("moves with an amended closing, and stays away from a notice no longer open", async () => {
    // The newest amendment moved the closing to 2026-12-01 at 14:00 Eastern: 31 days and 3 hours out.
    const amended = shard("cb-200-20005019", (e) => { e.closing = "2026-12-01T14:00:00"; });
    expect(line(await page("/tenders/cb-200-20005019", TEST_NOW, amended))).toContain(">Closes in 31 days</span>");
    const cancelled = shard("cb-200-20005019", (e) => { e.status = "cancelled"; });
    expect(line(await page("/tenders/cb-200-20005019", TEST_NOW, cancelled))).toBe("");
  });

  it("is the same rule on the server as in closing.ts", () => {
    const at = (iso: string) => clockAt(Date.parse(iso));
    expect(closesLine("open", "2026-11-04T14:00:00", at("2026-11-04T18:48:00Z"), "en")).toBe("Closes in 12 min");
    expect(closesLine("open", "2026-11-04T14:00:00", at("2026-11-03T12:00:00Z"), "en")).toBe("Closes in 1 day");
    expect(closesLine("open", "2026-11-04T14:00:00", at("2026-11-04T19:00:00Z"), "en")).toBe("Closing date passed");
    expect(closesLine("expired", "2026-11-04T14:00:00", at("2026-11-05T19:00:00Z"), "en")).toBe("Closing date passed");
    expect(closesLine("awarded", "2026-11-04T14:00:00", at("2026-11-01T19:00:00Z"), "en")).toBeNull();
    expect(closesLine("open", null, at("2026-11-01T19:00:00Z"), "en")).toBeNull();
    expect(closesLine("open", "2026-11-26", at("2026-11-01T19:00:00Z"), "en")).toBe("Closes 2026-11-26");
  });
});
