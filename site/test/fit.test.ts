// Matching notices, the rules (public/fit.js) and their words (src/fit.tsx):
// every line of the points table, the largest count of one source never a
// sum, the best code and the best province, a notice naming no province, the
// profile's province, the supply arrangement line, a notice that shares no
// work never listed, the bands at their edges, the order of a list, the
// design's three worked examples and its weak case to the point, and the
// blocks the validator refuses. Every expected figure is worked out from the
// block written here, never read back from the module.
import { describe, expect, it } from "vitest";
import {
  BAND_CLOSE, BAND_PARTIAL, MATCH_MAX, MATCH_MIN, MATCH_POINTS, bandOf, blockState, rankNotices, scoreNotice, type MatchBlock,
} from "../public/fit.js";
import type { CodeLevel } from "../src/data";
import { countsText, levelText, matchingWindow, profileMatching, reasonText, type ReasonContext } from "../src/fit";

// Organization A of the design (notes, section 2.4): an engineering consultancy in Nova Scotia, invented.
const A: MatchBlock = {
  fy: [2022, 2026], n: [7, 3, 12], coded: [7, 3], newest: "2026-09-30",
  classes: [["811015", 5, 2], ["771015", 2, 0], ["801016", 1, 0]],
  families: [["8110", 5, 2], ["7710", 2, 0], ["8010", 1, 0]],
  segments: [["81", 5, 2], ["77", 2, 0], ["80", 1, 0]],
  buyers: [["dfo-mpo", 3, 0, 4], ["dnd-mdn", 2, 1, 6], ["pwgsc-tpsgc", 2, 3, 0]],
  provinces: [["NS", 6, 2], ["NB", 1, 1], ["NL", 0, 1]],
  types: [["Request for Proposal", 5, 1], ["Request for Standing Offer", 2, 0], ["Directed Contract", 0, 2]],
  held: [["RMSO", "81", 1]],
};
const HOME = "NS";

type N = Parameters<typeof scoreNotice>[1];
const notice = (o: Partial<N> & { codes?: string[] } = {}): N => {
  const codes = o.codes ?? [];
  return {
    codes, segments: o.segments ?? [...new Set(codes.map((c) => c.slice(0, 2)))], provinces: o.provinces ?? ["QC"],
    provinces_derived: o.provinces_derived, buyer_id: o.buyer_id ?? null, notice_type_en: o.notice_type_en ?? null,
  };
};
const part = (block: MatchBlock, n: N, which: string, home: string | null = HOME) =>
  scoreNotice(block, n, home).reasons.find((r) => r.part === which) ?? null;
const pts = (block: MatchBlock, n: N, which: string, home: string | null = HOME) => part(block, n, which, home)?.points ?? 0;

// A block of one class, family and segment each with the counts given.
const one = (counts: [number, number], extra: Partial<MatchBlock> = {}): MatchBlock => ({
  ...A, classes: [["811015", ...counts]], families: [["8110", ...counts]], segments: [["81", ...counts]], ...extra,
});

describe("the points table", () => {
  it("adds up to 100 at most, with the bands and the minimum the design set", () => {
    const P = MATCH_POINTS;
    expect(P.class[0] + P.buyer[0] + P.delivered[0] + Math.max(P.held, P.type[0])).toBe(MATCH_MAX);
    expect(MATCH_MAX).toBe(100);
    expect([BAND_CLOSE, BAND_PARTIAL, MATCH_MIN]).toEqual([60, 30, 3]);
    // A close match needs work in common: buyer, province and type alone reach 55.
    expect(P.buyer[0] + P.delivered[0] + Math.max(P.held, P.type[0])).toBe(55);
    expect(55).toBeLessThan(BAND_CLOSE);
  });

  it("gives a class 45 from 3 records of one source and 35 for 1 or 2", () => {
    expect(pts(one([3, 0]), notice({ codes: ["81101503"] }), "work")).toBe(45);
    expect(pts(one([0, 3]), notice({ codes: ["81101503"] }), "work")).toBe(45);
    expect(pts(one([2, 0]), notice({ codes: ["81101503"] }), "work")).toBe(35);
    expect(pts(one([0, 1]), notice({ codes: ["81101503"] }), "work")).toBe(35);
  });

  it("gives a family 25 or 20 and a segment 10 or 5 when nothing finer is shared", () => {
    expect(pts(one([4, 0]), notice({ codes: ["81101701"] }), "work")).toBe(25);
    expect(pts(one([1, 1]), notice({ codes: ["81101701"] }), "work")).toBe(20);
    expect(pts(one([3, 1]), notice({ codes: ["81111801"] }), "work")).toBe(10);
    expect(pts(one([2, 0]), notice({ codes: ["81111801"] }), "work")).toBe(5);
    // A notice whose file gives segments only is read by them.
    expect(pts(one([3, 0]), { segments: ["81"], provinces: [] }, "work")).toBe(10);
  });

  it("takes the largest count of one source, never a sum of two", () => {
    // 2 award notices and 2 history records: 4 in all, but no source holds 3.
    expect(pts(one([2, 2]), notice({ codes: ["81101503"] }), "work")).toBe(35);
    const buyers = { ...A, buyers: [["dfo-mpo", 1, 1, 1]] as MatchBlock["buyers"] };
    expect(pts(buyers, notice({ buyer_id: "dfo-mpo" }), "buyer")).toBe(15);
    const provinces = { ...A, provinces: [["NB", 2, 2]] as MatchBlock["provinces"] };
    expect(pts(provinces, notice({ provinces: ["NB"] }), "province")).toBe(10);
    const types = { ...A, types: [["Request for Proposal", 1, 2]] as MatchBlock["types"] };
    expect(pts(types, notice({ notice_type_en: "Request for Proposal" }), "type")).toBe(5);
  });

  it("gives a buyer in the records 25 from 3 records of one source and 15 for 1 or 2, and none for a buyer not in them", () => {
    expect(pts(A, notice({ buyer_id: "dnd-mdn" }), "buyer")).toBe(25);
    expect(pts({ ...A, buyers: [["dnd-mdn", 2, 1, 0]] }, notice({ buyer_id: "dnd-mdn" }), "buyer")).toBe(15);
    expect(part(A, notice({ buyer_id: "cbsa-asfc" }), "buyer")).toBeNull();
    expect(part(A, notice({ buyer_id: null }), "buyer")).toBeNull();
  });

  it("gives a province of delivery 15 or 10, the profile's province 8, a notice naming none 5, and another province nothing", () => {
    expect(pts(A, notice({ provinces: ["NS"] }), "province")).toBe(15);
    expect(pts(A, notice({ provinces: ["NB"] }), "province")).toBe(10);
    // Derived provinces count as stated ones.
    expect(pts(A, notice({ provinces: [], provinces_derived: ["NS"] }), "province")).toBe(15);
    // Ontario is in no record; the profile's province is Ontario here.
    expect(pts(A, notice({ provinces: ["ON"] }), "province", "ON")).toBe(8);
    expect(part(A, notice({ provinces: ["ON"] }), "province", "ON")?.kind).toBe("home");
    expect(pts(A, notice({ provinces: [] }), "province")).toBe(5);
    expect(part(A, notice({ provinces: [] }), "province")?.kind).toBe("national");
    expect(part(A, notice({ provinces: ["QC"] }), "province")).toBeNull();
    // Only the highest line counts: a province of delivery beats the profile's.
    expect(pts(A, notice({ provinces: ["NB", "NS"] }), "province", "NB")).toBe(15);
  });

  it("gives an RFP against a supply arrangement 15 only when one is held in a notice segment, else reads its type", () => {
    const sa = { ...A, held: [["SA", "81", 2], ["RMSO", "80", 1]] as MatchBlock["held"] };
    const rfpSa = (segments: string[]) => ({ segments, codes: [], provinces: [], notice_type_en: "RFP against Supply Arrangement" });
    expect(pts(sa, rfpSa(["43", "81"]), "type")).toBe(15);
    expect(part(sa, rfpSa(["43", "81"]), "type")).toMatchObject({ kind: "held", key: "81", counts: [2] });
    // A standing offer in the segment is not a supply arrangement; an arrangement in another segment does not count.
    expect(part(sa, rfpSa(["80"]), "type")).toBeNull();
    expect(part(A, rfpSa(["81"]), "type")).toBeNull();
    // Without an arrangement held there, the type line reads the records' notice types.
    const awardedUnder = { ...sa, types: [["RFP against Supply Arrangement", 3, 0]] as MatchBlock["types"] };
    expect(pts(awardedUnder, rfpSa(["43"]), "type")).toBe(10);
    // A notice type the organization was awarded under: 10 from 3, 5 for 1 or 2, compared without case.
    expect(pts(A, notice({ notice_type_en: "Request for Proposal" }), "type")).toBe(10);
    expect(pts(A, notice({ notice_type_en: "request for standing offer " }), "type")).toBe(5);
    expect(part(A, notice({ notice_type_en: "Invitation to Qualify" }), "type")).toBeNull();
  });

  it("takes the best code and the best province on a notice", () => {
    // 77101505 reaches class 771015 (2 records, 35); 81101503 class 811015 (5 records, 45).
    expect(part(A, notice({ codes: ["77101505", "81101503"] }), "work")).toMatchObject({ kind: "class", key: "811015", points: 45 });
    // A segment match on one code never hides a class match on another.
    expect(part(A, notice({ codes: ["80111600", "81101503"] }), "work")?.points).toBe(45);
    expect(part(A, notice({ provinces: ["NL", "NB", "NS"] }), "province")).toMatchObject({ key: "NS", points: 15 });
  });

  it("never matches a notice that shares no work, whatever else it shares", () => {
    const s = scoreNotice(A, notice({ codes: ["53111601"], buyer_id: "dnd-mdn", provinces: ["NS"], notice_type_en: "Request for Proposal" }), HOME);
    expect(s.band).toBe("none");
    expect(s.points).toBe(0);
    // The rest stay as facts in common.
    expect(s.reasons.map((r) => r.part)).toEqual(["buyer", "province", "type"]);
    expect(rankNotices(A, [{ reference: "x", closing: null, ...notice({ codes: ["53111601"], buyer_id: "dnd-mdn" }) }], HOME).matches).toEqual([]);
  });

  it("names the bands at their edges", () => {
    expect([29, 30, 59, 60, 100].map((p) => bandOf(p, 5))).toEqual(["weak", "partial", "partial", "close", "close"]);
    expect(bandOf(60, 0)).toBe("none");
    // 20 + 5 + 5 is partial; 45 + 15 is close; 20 + 8 is weak.
    expect(scoreNotice(one([1, 0]), notice({ codes: ["81101701"], provinces: [], notice_type_en: "Request for Standing Offer" }), HOME))
      .toMatchObject({ points: 30, band: "partial" });
    expect(scoreNotice(one([3, 0]), notice({ codes: ["81101503"], provinces: ["NS"] }), HOME)).toMatchObject({ points: 60, band: "close" });
    expect(scoreNotice(one([1, 0]), notice({ codes: ["81101701"], provinces: ["ON"] }), "ON")).toMatchObject({ points: 28, band: "weak" });
  });
});

describe("a list of notices", () => {
  const row = (reference: string, closing: string | null, o: Partial<N> & { codes?: string[] } = {}) =>
    ({ reference, closing, ...notice({ codes: ["81101503"], provinces: ["NS"], ...o }) });

  it("lists close and partial matches by points, then the soonest closing, then the reference, and counts the notices with no code", () => {
    const rows = [
      row("cb-3", "2026-11-20T14:00:00"),
      row("cb-1", "2026-11-20T14:00:00"),
      row("cb-0", null),
      row("cb-2", "2026-11-10T14:00:00"),
      // 95 points: first whatever its closing.
      row("cb-9", "2026-12-31T14:00:00", { buyer_id: "dfo-mpo", notice_type_en: "Request for Proposal" }),
      // Weak (segment 80 only, 5, and 0 for Quebec): not listed.
      row("cb-weak", "2026-11-01T14:00:00", { codes: ["80111600"], provinces: ["QC"] }),
      // No code at all.
      { reference: "cb-none", closing: "2026-11-01T14:00:00", codes: [], segments: [], provinces: ["NS"], buyer_id: "dfo-mpo" },
    ];
    const { matches, uncoded } = rankNotices(A, rows, HOME);
    expect(matches.map((m) => m.row.reference)).toEqual(["cb-9", "cb-2", "cb-1", "cb-3", "cb-0"]);
    expect(matches.map((m) => m.score.points)).toEqual([95, 60, 60, 60, 60]);
    expect(uncoded).toBe(1);
  });
});

describe("the design's worked examples", () => {
  const levels: CodeLevel[] = [{ code: "811015", en: "Civil engineering", fr: "Génie civil", n: 1 }];

  it("scores the wharf repairs 95, a close match, with the four lines the design prints", () => {
    const n = { codes: ["81101503"], segments: ["81"], provinces: ["NS"], buyer_id: "dfo-mpo", notice_type_en: "Request for Proposal",
      buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada", notice_type_fr: "Demande de propositions" };
    const s = scoreNotice(A, n, HOME);
    expect(s).toMatchObject({ points: 95, band: "close" });
    expect(s.reasons.map((r) => r.points)).toEqual([45, 25, 15, 10]);
    const ctx: ReasonContext = { name: "Organization A", notice: n, levels };
    expect(s.reasons.map((r) => reasonText("en", r, ctx))).toEqual([
      "UNSPSC class 811015 Civil engineering: 5 award notices, 2 PSPC contract history records",
      "Buyer Fisheries and Oceans Canada: 3 award notices, 4 published contracts",
      "Province of delivery Nova Scotia: 6 award notices, 2 PSPC contract history records",
      "Notice type Request for Proposal: 5 award notices, 1 PSPC contract history record",
    ]);
    expect(reasonText("fr", s.reasons[0], ctx).replace(/ /g, " ")).toBe(
      "Classe UNSPSC 811015 Génie civil : 5 avis d’attribution, 2 dossiers de l’historique des contrats de SPAC");
  });

  it("scores the HVAC review at Lacolle 35, a partial match: the family and the notice type", () => {
    const s = scoreNotice(A, { codes: ["81101605"], segments: ["81"], provinces: ["QC"], buyer_id: "cbsa-asfc", notice_type_en: "Request for Proposal" }, HOME);
    expect(s).toMatchObject({ points: 35, band: "partial" });
    expect(s.reasons.map((r) => [r.kind, r.key, r.points])).toEqual([["family", "8110", 25], ["type", "Request for Proposal", 10]]);
  });

  it("scores the Canada-wide network monitoring 15, a weak match, with no supply arrangement held", () => {
    const s = scoreNotice(A, { codes: ["81111801"], segments: ["81"], provinces: [], buyer_id: "ssc-spc", notice_type_en: "RFP against Supply Arrangement" }, HOME);
    expect(s).toMatchObject({ points: 15, band: "weak" });
    expect(s.reasons.map((r) => [r.kind, r.points])).toEqual([["segment", 10], ["national", 5]]);
  });

  it("finds no match in the winter boots, and states the shared buyer as a fact", () => {
    const n = { codes: ["53111601"], segments: ["53"], provinces: ["ON"], buyer_id: "dnd-mdn", notice_type_en: "Request for Standing Offer",
      buyer_en: "National Defence", buyer_fr: "Défense nationale" };
    const s = scoreNotice(A, n, HOME);
    expect(s).toMatchObject({ points: 0, band: "none" });
    const buyer = s.reasons.find((r) => r.kind === "buyer")!;
    expect(reasonText("en", buyer, { name: "Organization A", notice: n, levels: null }))
      .toBe("Buyer National Defence: 2 award notices, 1 PSPC contract history record, 6 published contracts");
  });
});

describe("the block", () => {
  const profile = (matching: unknown) => ({ organization: { display_name: "Organization A" }, matching });

  it("reads a block the export writes, and none from a profile without one", () => {
    expect(profileMatching(profile(A))).toEqual(A);
    expect(profileMatching(profile(undefined))).toBeNull();
    expect(profileMatching({})).toBeNull();
    expect(profileMatching(null)).toBeNull();
  });

  it("refuses a block that does not read in full", () => {
    const bad: [string, unknown][] = [
      ["no fy", { ...A, fy: undefined }],
      ["fy backwards", { ...A, fy: [2026, 2022] }],
      ["n of two", { ...A, n: [1, 2] }],
      ["coded missing", { ...A, coded: undefined }],
      ["a negative count", { ...A, classes: [["811015", -1, 0]] }],
      ["a fractional count", { ...A, classes: [["811015", 1.5, 0]] }],
      ["a five-digit class", { ...A, classes: [["81101", 1, 0]] }],
      ["a family as a number", { ...A, families: [[8110, 1, 0]] }],
      ["a segment that is not one", { ...A, segments: [["99", 1, 0]] }],
      ["a buyer id with a space", { ...A, buyers: [["dfo mpo", 1, 0, 0]] }],
      ["a buyer with two counts", { ...A, buyers: [["dfo-mpo", 1, 0]] }],
      ["a province that is not one", { ...A, provinces: [["XX", 1, 0]] }],
      ["a blank notice type", { ...A, types: [[" ", 1, 0]] }],
      ["a held row with a bad segment", { ...A, held: [["SA", "8", 1]] }],
      ["a held row with a lower-case type", { ...A, held: [["sa", "81", 1]] }],
      ["newest not a date", { ...A, newest: "yesterday" }],
      ["a list that is not a list", { ...A, types: {} }],
      ["not an object", [A]],
    ];
    for (const [why, v] of bad) expect(profileMatching(profile(v)), why).toBeNull();
  });

  it("says what a block allows: nothing counted, published contracts only, too few with codes, or a ranking", () => {
    const zero = { ...A, n: [0, 0, 0] as [number, number, number], coded: [0, 0] as [number, number] };
    expect(blockState(zero)).toBe("none");
    expect(blockState({ ...zero, n: [0, 0, 4] })).toBe("uncoded");
    expect(blockState({ ...A, coded: [2, 2] })).toBe("thin");
    // Award notices without a code are thin, not uncoded: the page names their count.
    expect(blockState({ ...zero, n: [2, 0, 4] })).toBe("thin");
    expect(blockState({ ...A, coded: [0, 3] })).toBe("ready");
    expect(blockState(A)).toBe("ready");
  });

  it("reads the window from stats.json, and none from an export written before the blocks", () => {
    expect(matchingWindow({ matching_fy: [2022, 2026] })).toEqual([2022, 2026]);
    expect(matchingWindow({})).toBeNull();
    expect(matchingWindow(null)).toBeNull();
    expect(matchingWindow({ matching_fy: ["2022", 2026] })).toBeNull();
  });

  it("writes counts each source apart, and a level with its name only when the notices give one", () => {
    expect(countsText("en", [5, 2])).toBe("5 award notices, 2 PSPC contract history records");
    expect(countsText("en", [0, 1, 4])).toBe("1 PSPC contract history record, 4 published contracts");
    expect(countsText("en", [0, 0])).toBe("0 award notices");
    expect(levelText("en", "81", null)).toBe("81 Engineering and Research and Technology Based Services");
    expect(levelText("en", "811015", null)).toBe("811015");
    expect(levelText("en", "811015", [{ code: "811015", en: null, fr: null, n: 1 }])).toBe("811015");
  });
});
