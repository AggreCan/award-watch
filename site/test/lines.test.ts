// The holder's record, its rules and words (src/lines.ts, src/lines_view.tsx,
// src/pages/holders.tsx): the check that refuses a row that does not read in
// full, the label at its edges (a run of 2 and 3, 0 and 1 earlier), the
// largest figure of one source never a sum, the design's four worked
// examples in the words of the mark and the panel in both languages (their
// figures as the pipeline counts them on the development copy; the names
// made up), and the strings: no word of section 3.3 of the design, no dash.
import { describe, expect, it } from "vitest";
import { allKeys, rawEntry, type Key } from "../src/i18n";
import { type FollowRecord, LONG_RUN, type LineRecord, type LineSource, lineKey, lineLabel, parseFollow, parseLine } from "../src/lines";
import { markText } from "../src/lines_view";
import { matchedLines } from "../src/pages/follows";
import { HolderPanel, type HolderState } from "../src/pages/holders";

const src3 = (o: Partial<LineSource>): LineSource => ({
  src: 3, lvl: "code", key: ["D317"], held: 1, run: 1, first: "2026-04-01", total: 1, others: 0, c: 0, nc: 1, u: 0, ...o,
});
const own = { comp: 0, meth: "TN", bids: 1, amd: 0, growth: 0, end0: "2027-03-31", end: "2027-03-31" } as const;
const rec = (s: LineSource[], o: Partial<LineRecord> = {}): LineRecord => ({
  v: 1, fy: [2017, 2026], buyer: "atssc-scdata", oid: 1, s, own: { ...own }, sim: [], ...o,
});

// The design's four examples (section 3.4), as lines.py writes them from the development copy.
const A_RUN = rec([src3({ held: 7, run: 7, first: "2018-04-01", total: 37, others: 7, nc: 7 })]);
// As published, the last two of A are call-ups against one standing offer: run 1 (pipeline test_lines.py).
const A_AS_PUBLISHED = rec([src3({ held: 7, run: 1, first: "2018-04-01", total: 37, others: 7, nc: 7 })]);
const B = rec([{ src: 1, lvl: "class", key: ["401416"], held: 9, run: 1, first: "2026-04-27", total: 43, others: 17, c: 9, nc: 0, u: 0 }],
  { buyer: "dnd-mdn", own: { comp: 1, meth: "TC", bids: null, amd: 0, growth: null, end0: "2027-05-14", end: "2027-05-14" } });
const C = rec([src3({ key: ["K105"], total: 10, others: 1 })], { sim: [["org-bc930e6499", "THE EXAMPLE CORPS OF GUARD SERVICES OF CANADA", 3, 9, "2024-04-01"]] });
const D = rec([src3({ key: ["T009"], first: "2026-09-28", total: 9, others: 6, c: 1, nc: 0 })],
  { own: { comp: 1, meth: "ST", bids: 4, amd: 0, growth: 0, end0: "2026-12-31", end: "2026-12-31" } });

const ready = (j: LineRecord, buyer: string, holder: string): HolderState => ({ state: "ready", j, buyer, holder, levels: null });
const panel = (lang: "en" | "fr", state: HolderState, published = true) =>
  String(HolderPanel({ lang, state, published, supplier: null, uncoded: "none" })).replace(/[  ]/g, " ").replace(/’/g, "'")
    .replace(/&#39;/g, "'");
const items = (html: string) => [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

describe("the check", () => {
  it("reads the four examples and refuses a row that does not read in full", () => {
    for (const j of [A_RUN, A_AS_PUBLISHED, B, C, D]) expect(parseLine(JSON.stringify(j)), JSON.stringify(j)).toEqual(j);
    const bad: [string, unknown][] = [
      ["not JSON", "{"], ["another form", { ...B, v: 2 }], ["a run longer than held", rec([src3({ held: 2, run: 3 })])],
      ["held unlike its methods", rec([src3({ held: 2, nc: 1 })])], ["a code at class level", rec([src3({ lvl: "class" })])],
      ["a class at code level", rec([{ ...B.s[0], lvl: "code" }])], ["no key", rec([src3({ key: [] })])],
      ["a source twice", rec([src3({}), src3({})])], ["a total under held", rec([src3({ held: 3, nc: 3, run: 1, total: 2 })])],
      ["a bad day", rec([src3({ first: "2026-4-1" })])], ["a bad method", { ...D, own: { ...D.own, meth: "XX" } }],
      ["a similar name without an id", { ...C, sim: [["Someone", "THE EXAMPLE", 3, 9, "2024-04-01"]] }],
      ["fiscal years out of order", { ...B, fy: [2026, 2017] }], ["a buyer that is no id", { ...B, buyer: "DND MDN" }],
    ];
    for (const [why, v] of bad) expect(parseLine(typeof v === "string" ? v : JSON.stringify(v)), why).toBeNull();
    expect(parseLine(null)).toBeNull();
    expect(parseLine("x".repeat(20_001))).toBeNull();
  });

  it("asks by the row's kind and URL reference in lower case", () => {
    expect(lineKey("contract", "dnd-mdn:C-2026-0042")).toBe("contract:dnd-mdn:c-2026-0042");
    expect(lineKey("award", "cb-400-40000004")).toBe("award:cb-400-40000004");
  });
});

describe("the label", () => {
  it("is a long run from LONG_RUN back to back, earlier records from one earlier, at their edges", () => {
    expect(LONG_RUN).toBe(3);
    expect(lineLabel(rec([src3({ held: 3, run: 3, nc: 3 })]))).toEqual({ band: "run", figure: 3, src: 3, first: "2026-04-01" });
    expect(lineLabel(rec([src3({ held: 3, run: 2, nc: 3 })]))?.band).toBe("earlier");
    expect(lineLabel(rec([src3({ held: 2, run: 1, nc: 2 })]))).toEqual({ band: "earlier", figure: 1, src: 3, first: "2026-04-01" });
    expect(lineLabel(rec([src3({ held: 1 })]))).toEqual({ band: "none", figure: 0, src: null, first: null });
    expect(lineLabel(rec([]))).toBeNull();
  });

  it("takes the largest figure of one source, never a sum, the lower source on a tie", () => {
    const award = { ...B.s[0], held: 3, run: 2, c: 3, first: "2024-04-01" };
    const history = { ...B.s[0], src: 2 as const, held: 4, run: 1, c: 4, first: "2023-01-01" };
    expect(lineLabel(rec([award, history]))).toEqual({ band: "earlier", figure: 3, src: 2, first: "2023-01-01" });
    expect(lineLabel(rec([award, { ...history, held: 3, c: 3 }]))).toEqual({ band: "earlier", figure: 2, src: 1, first: "2024-04-01" });
    expect(lineLabel(rec([{ ...award, run: 2 }, src3({ held: 5, run: 3, nc: 5 })]))).toEqual({ band: "run", figure: 3, src: 3, first: "2026-04-01" });
  });
});

describe("the four worked examples in words", () => {
  it("mark a radar row with the label and its figure, the similar name after it", () => {
    expect(markText("en", A_RUN)).toBe("Long run · 7 back to back");
    expect(markText("en", A_AS_PUBLISHED)).toBe("Earlier records · 6 earlier");
    expect(markText("en", B)).toBe("Earlier records · 8 earlier");
    expect(markText("en", C)).toBe("No earlier record · similar name");
    expect(markText("en", D)).toBe("No earlier record");
    expect(markText("fr", A_RUN)).toBe("Longue série · 7 à la suite");
    expect(markText("fr", B)).toBe("Dossiers antérieurs · 8 antérieurs");
    expect(markText("fr", rec([src3({ held: 2, nc: 2 })]))).toBe("Dossiers antérieurs · 1 antérieur");
    expect(markText("fr", C)).toBe("Aucun dossier antérieur · nom semblable");
    expect(markText("en", rec([]))).toBeNull();
  });

  it("give A's panel as section 3.4 writes it", () => {
    const html = panel("en", ready(A_RUN, "Administrative Tribunals Support Service of Canada", "Example Legal Publishing Inc."));
    expect(html).toContain("<h2>The Holder's Record With This Buyer</h2>");
    expect(html).toContain("<p>Contracts of this kind with Administrative Tribunals Support Service of Canada held by Example Legal Publishing Inc., fiscal years 2017-18 to 2026-27.</p>");
    expect(html).toContain('<p><strong>Long run</strong> <span class="muted">7 back to back since 2018-04-01</span></p>');
    expect(items(html)).toEqual([
      "Published contracts, commodity codes starting D317: Example Legal Publishing Inc. held 7 contracts of this kind with this buyer, this one included, the first starting 2018-04-01.",
      "7 of them back to back, each starting within 120 days of the previous one's end.",
      "In all, 37 contracts of this kind with this buyer in the period; 7 other suppliers held some of them.",
      "How the 7 were awarded: non-competitive: 7.",
      "This contract: non-competitive (TN), 1 bid received.",
      "No amendment published; the end date is as first published.",
    ]);
    expect(html).toContain("Counted from the award notices, PSPC contract history and published contracts of the last 10 fiscal years. Each source is counted apart and never added to another.");
    expect(html).toContain("These counts say nothing about the chances of any bid");
    expect(html).toContain('Award Watch counts these records from public files. The counts and their labels are not advice and may be wrong or incomplete. See the <a href="/terms#warranty">Terms of Use</a>. · <a href="/methodology#holders">How the holder\'s record is counted</a>');
    expect(html).toContain("Contains information licensed under the Open Government Licence, Canada.");
    // As published: the standing offer stops the run at once.
    const published = items(panel("en", ready(A_AS_PUBLISHED, "Tribunals", "Example Legal Publishing Inc.")));
    expect(published[1]).toBe("None of them runs back to back into this one.");
  });

  it("give B, C and D their own lines", () => {
    const b = panel("en", ready(B, "National Defence", "Example Valve Supply Inc."), false);
    expect(b).toContain('<p><strong>Earlier records</strong> <span class="muted">8 earlier since 2026-04-27</span></p>');
    expect(items(b)).toEqual([
      "Award notices, UNSPSC class 401416: Example Valve Supply Inc. held 9 contracts of this kind with this buyer, this one included, the first starting 2026-04-27.",
      "None of them runs back to back into this one.",
      "In all, 43 contracts of this kind with this buyer in the period; 17 other suppliers held some of them.",
      "How the 9 were awarded: competitive: 9.",
      "This contract: competitive.",
      "No amendment published; the end date is as first published.",
    ]);
    const c = panel("en", ready(C, "Administrative Tribunals Support Service of Canada", "THE EXAMPLE CORPS OF GUARD SERVICES"));
    expect(c).toContain("<p><strong>No earlier record</strong></p>");
    expect(items(c)).toEqual([
      "Published contracts, commodity codes starting K105: this is the only contract of this kind with this buyer held by THE EXAMPLE CORPS OF GUARD SERVICES in the period.",
      "In all, 10 contracts of this kind with this buyer in the period; 1 other supplier held some of them.",
      "This contract: non-competitive (TN), 1 bid received.",
      "No amendment published; the end date is as first published.",
      "Under a similar name, counted apart: THE EXAMPLE CORPS OF GUARD SERVICES OF CANADA, 9 contracts of this kind with this buyer, the last starting 2024-04-01.",
    ]);
    // The similar name links its own profile, under its own name.
    expect(c).toContain('<a href="/organizations/org-bc930e6499">THE EXAMPLE CORPS OF GUARD SERVICES OF CANADA</a>');
    const d = items(panel("en", ready(D, "Tribunals", "Example Audiovisual Inc.")));
    expect(d).toContain("This contract: competitive (ST), 4 bids received.");
    expect(d).toContain("In all, 9 contracts of this kind with this buyer in the period; 6 other suppliers held some of them.");
  });

  it("speak French, the Terms linked in French", () => {
    const html = panel("fr", ready(A_RUN, "Service canadien d'appui aux tribunaux administratifs", "Exemple Édition juridique inc."));
    expect(html).toContain("<h2>Dossiers du titulaire auprès de cet acheteur</h2>");
    expect(html).toContain("<p>Contrats de ce genre auprès de Service canadien d'appui aux tribunaux administratifs détenus par Exemple Édition juridique inc., exercices 2017-2018 à 2026-2027.</p>");
    expect(html).toContain('<p><strong>Longue série</strong> <span class="muted">7 à la suite depuis le 2018-04-01</span></p>');
    expect(items(html)).toEqual([
      "Contrats publiés, codes de marchandise commençant par D317 : Exemple Édition juridique inc. a détenu 7 contrats de ce genre auprès de cet acheteur, celui-ci compris, le premier commençant le 2018-04-01.",
      "7 d'entre eux à la suite, chacun commençant à moins de 120 jours de la fin du précédent.",
      "Au total, 37 contrats de ce genre auprès de cet acheteur pendant la période; 7 autres fournisseurs en ont détenu.",
      "Mode d'attribution des 7 : non concurrentiels : 7.",
      "Ce contrat : non concurrentiel (TN), 1 soumission reçue.",
      "Aucune modification publiée; la date de fin est celle publiée au départ.",
    ]);
    expect(html).toContain('Voir les <a href="/terms?lang=fr#warranty">Conditions d\'utilisation</a>.');
    expect(html).not.toMatch(/Long run|Published contracts|back to back/);
  });

  it("say what an amendment did and when a contract's end moved, and why an uncoded contract has no label", () => {
    const amended = rec([src3({})], { own: { ...own, amd: 2, growth: 0.25, end0: "2026-03-31", end: "2027-03-31" } });
    expect(items(panel("en", ready(amended, "B", "H")))).toContain("Amendments published: 2; value +25% on the original amount.");
    expect(items(panel("en", ready(amended, "B", "H")))).toContain("End date moved from 2026-03-31 to 2027-03-31.");
    expect(items(panel("en", ready({ ...amended, own: { ...amended.own, growth: null } }, "B", "H")))).toContain("Amendments published: 2.");
    const uncoded = String(HolderPanel({ lang: "en", state: ready(rec([]), "B", "H"), published: false, supplier: null, uncoded: "segment" }));
    expect(uncoded).toContain("This contract carries only a UNSPSC segment, so its kind of work is not compared and no label is given.");
    expect(uncoded).not.toContain("<strong>");
    // A contract coded in two classes names both.
    const two = rec([{ ...B.s[0], key: ["401416", "401417"] }], { buyer: "dnd-mdn", own: B.own });
    expect(items(panel("en", ready(two, "National Defence", "H"), false))[0]).toContain("Award notices, UNSPSC classes 401416, 401417: H held 9");
  });
});

// -- the words -------------------------------------------------------------------------

// Section 3.3 of the design: a judgement of a business or of a buyer, a chance or a forecast, a word of the trade
// press for a holder. "Chance" only where a line says the counts say nothing of it; "advice" and "conseil" only
// where a line says the counts are not that.
const EN = /\b(strong|weak|entrench\w*|dominan\w*|vulnerab\w*|risk\w*|safe|beatable|winnable|contest\w*|uncontested|challeng\w*|lock\w*|captive|stronghold|grip|favour\w*|favor\w*|prefer\w*|insider|monopol\w*|sole[ -]source|low competition|uncompetitive|suspicious|questionable|red flag|opportunit\w*|likely|odds|probabl\w*|predict\w*|forecast\w*|should|recommend\w*|renew\w*|incumbent\w*)\b/i;
const FR = /(?<![\p{L}\p{N}])(fort|forte|faibles?|enracin\p{L}*|dominan\p{L}*|vulnérab\p{L}*|risqu\p{L}*|contest\p{L}*|verrouill\p{L}*|captif|captive|bastion|favori\p{L}*|privilégi\p{L}*|initié\p{L}*|monopol\p{L}*|fournisseur unique|faible concurrence|suspect\p{L}*|douteu\p{L}*|occasion\p{L}*|probab\p{L}*|prédi\p{L}*|prévision\p{L}*|recommand\p{L}*|devrai\p{L}*|reconduct\p{L}*|reconduit\p{L}*|renouvel\p{L}*)(?![\p{L}\p{N}])/iu;
const CHANCE_KEYS: Key[] = ["line.not_odds", "methodology.holders_what"];
const ADVICE_KEYS: Key[] = ["line.disclaimer", "methodology.holders_what", "terms.advisory", "follow.disclaimer", "terms.advisory_follows"];

describe("the strings", () => {
  const keys = allKeys().filter((k) => k.startsWith("line.") || k.startsWith("follow.") || k.startsWith("methodology.holders") ||
    k.startsWith("methodology.toc_holders") || k === "plans.lines" || k.startsWith("terms.advisory")) as Key[];

  it("keep every word of section 3.3 out, in both languages", () => {
    expect(keys.length).toBeGreaterThan(90);
    for (const key of [
      "line.panel", "line.signed_out", "line.free_window", "methodology.holders_limits", "plans.lines", "terms.advisory", "follow.panel",
      "follow.lead", "follow.free_cap", "follow.disclaimer", "methodology.holders_follow", "methodology.toc_holders_follows", "terms.advisory_follows",
    ] as Key[]) {
      expect(keys, key).toContain(key);
    }
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      expect(en, key).not.toMatch(EN);
      expect(fr, key).not.toMatch(FR);
      if (!CHANCE_KEYS.includes(key)) expect(en + fr, key).not.toMatch(/\bchances?\b/i);
      if (!ADVICE_KEYS.includes(key)) expect(en + " " + fr, key).not.toMatch(/\b(advice|conseil)\b/i);
      // No dash of either length in the prose.
      expect(en + fr, key).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`));
      // Straight apostrophes in the source; the French typography turns them.
      expect(en + fr, key).not.toContain("’");
    }
  });

  it("are in both languages, French apart from English", () => {
    for (const key of keys) {
      const { en, fr } = rawEntry(key);
      expect(en.trim(), key).not.toBe("");
      expect(fr.trim(), key).not.toBe("");
      expect(fr, key).not.toBe(en);
      expect([...fr.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key).toEqual([...en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });

  it("put the Terms paragraph as section 9.2 writes it while may follow shows, and without it otherwise", () => {
    const off = rawEntry("terms.advisory");
    expect(off.en).toBe("Some features calculate, from public records, what may interest a reader, such as the notices that match the records of the organization a reader names and a contract holder's earlier records with the same buyer. These calculations follow the fixed rules on the {methodology} page. They do not constitute advice, they say nothing about the merit of any organization or about how any buyer procures, and they may be wrong or incomplete. They are Award Watch's own and are neither produced nor endorsed by the Government of Canada. Award Watch is not responsible for their accuracy or for any decision made on them, including a decision to bid or not to bid.");
    expect(off.fr).toBe("Certaines fonctions calculent, à partir de dossiers publics, ce qui peut intéresser un lecteur, comme les avis qui correspondent aux dossiers de l'organisation qu'il indique et les dossiers antérieurs du titulaire d'un contrat auprès du même acheteur. Ces calculs suivent les règles fixes décrites à la page {methodology}. Ils ne constituent pas un conseil, ne disent rien du mérite d'une organisation ni de la façon dont un acheteur passe ses marchés, et peuvent être erronés ou incomplets. Ils sont propres à Award Watch et ne sont ni produits ni approuvés par le gouvernement du Canada. Award Watch n'est pas responsable de leur exactitude ni d'aucune décision prise sur leur base, y compris celle de soumissionner ou non.");
    expect(off.en + off.fr).not.toMatch(/may follow|faire suite/);
    const { en, fr } = rawEntry("terms.advisory_follows");
    expect(en).toBe("Some features calculate, from public records, what may interest a reader, such as the notices that match the records of the organization a reader names, a contract holder's earlier records with the same buyer and the earlier contracts an open notice may follow. These calculations follow the fixed rules on the {methodology} page. They do not constitute advice, they say nothing about the merit of any organization or about how any buyer procures, and they may be wrong or incomplete. They are Award Watch's own and are neither produced nor endorsed by the Government of Canada. Award Watch is not responsible for their accuracy or for any decision made on them, including a decision to bid or not to bid.");
    expect(fr).toBe("Certaines fonctions calculent, à partir de dossiers publics, ce qui peut intéresser un lecteur, comme les avis qui correspondent aux dossiers de l'organisation qu'il indique, les dossiers antérieurs du titulaire d'un contrat auprès du même acheteur et les contrats antérieurs auxquels un avis ouvert pourrait faire suite. Ces calculs suivent les règles fixes décrites à la page {methodology}. Ils ne constituent pas un conseil, ne disent rien du mérite d'une organisation ni de la façon dont un acheteur passe ses marchés, et peuvent être erronés ou incomplets. Ils sont propres à Award Watch et ne sont ni produits ni approuvés par le gouvernement du Canada. Award Watch n'est pas responsable de leur exactitude ni d'aucune décision prise sur leur base, y compris celle de soumissionner ou non.");
  });
});

// -- may follow -------------------------------------------------------------------------

// The design's worked example (section 4.3) as the pipeline's follows.py writes its closest row on the development
// copy: a close text match, 7 of 8 words, ending 31 days before the expected start; the holder's record, run 1.
const THS: FollowRecord = {
  v: 1, src: 1, ref: "cb-725-74465042", t: ["NPP S5678424 - THS SA - One (1) Computer Application Support.", null], oid: 7, wh: 0,
  end: "2026-10-23", deg: "close", sol: null, num: null, buyer: "dnd-mdn", client: 0, lvl: "class", code: ["801116"], words: [7, 8],
  days: -31, from: "start",
  line: rec([{ src: 1, lvl: "class", key: ["801116"], held: 2, run: 1, first: "2025-11-17", total: 28, others: 20, c: 2, nc: 0, u: 0 }],
    { buyer: "dnd-mdn", own: { comp: 1, meth: "ST", bids: null, amd: 0, growth: null, end0: "2026-10-23", end: "2026-10-23" } }),
};
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ").replace(/\u2019/g, "'");

describe("may follow's rows", () => {
  it("read the worked example and refuse a row that does not read in full", () => {
    expect(parseFollow(JSON.stringify(THS))).toEqual(THS);
    const withheld = { ...THS, oid: null, wh: 1, line: null };
    expect(parseFollow(JSON.stringify(withheld))).toEqual(withheld);
    const number = { ...THS, deg: "number", sol: "W8486-207442/A", lvl: null, code: [] };
    expect(parseFollow(JSON.stringify(number))).toEqual(number);
    const bad: [string, unknown][] = [
      ["another form", { ...THS, v: 2 }], ["a number match naming no number", { ...THS, deg: "number" }],
      ["a text match naming a number", { ...THS, num: "W8486-207442" }], ["a text match sharing no code", { ...THS, lvl: null, code: [] }],
      ["a withheld holder named", { ...THS, wh: 1 }], ["a withheld holder with a record", { ...THS, oid: null, wh: 1 }],
      ["a family at class level", { ...THS, code: ["8011"] }], ["more words shared than all", { ...THS, words: [9, 8] }],
      ["a broken record", { ...THS, line: { ...THS.line, v: 2 } }], ["a buyer that is no id", { ...THS, buyer: "DND MDN" }],
      ["a source out of range", { ...THS, src: 4 }], ["a bad end", { ...THS, end: "2026-10" }],
    ];
    for (const [why, v] of bad) expect(parseFollow(JSON.stringify(v)), why).toBeNull();
    expect(parseFollow("{")).toBeNull();
    expect(parseFollow("x".repeat(20_001))).toBeNull();
  });

  it("say what matched in the worked example's words, in both languages", () => {
    expect(matchedLines("en", { j: THS, holder: "H", buyer: "National Defence" })).toEqual([
      "Same buyer, National Defence", "Same UNSPSC class, 801116", "Titles share 7 of 8 words",
      "End date 31 days before this notice's expected start",
    ]);
    expect(matchedLines("fr", { j: THS, holder: "H", buyer: "Défense nationale" }).map(plain)).toEqual([
      "Même acheteur, Défense nationale", "Même classe UNSPSC, 801116", "Les titres ont 7 mots sur 8 en commun",
      "Date de fin 31 jours avant le début prévu de cet avis",
    ]);
    const one: FollowRecord = { ...THS, words: [1, 3], days: 1, from: "pub", code: ["801116", "801117"] };
    expect(matchedLines("fr", { j: one, holder: null, buyer: null }).map(plain)).toEqual([
      "Même acheteur, dnd-mdn", "Mêmes classes UNSPSC, 801116, 801117", "Les titres ont 1 mot sur 3 en commun",
      "Date de fin 1 jour après la publication de cet avis",
    ]);
    expect(matchedLines("en", { j: { ...THS, days: 0 }, holder: null, buyer: "B" }).at(-1)).toBe("End date on this notice's expected start");
    expect(markText("en", THS.line!)).toBe("Earlier records · 1 earlier");
  });
});
