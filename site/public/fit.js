/* Matching notices: the one copy of the rules, for the Worker and the browser.

   An account that names its organization sees the open tender notices
   ranked by what each has in common with that organization's records. The
   pipeline counts the records once a night, as the profile's "matching"
   block (pipeline/awardwatch_pipeline/profile_matching.py has its shape);
   this module scores a notice against that block. The Worker imports it for
   /account/matches and a notice's page (src/fit.tsx and
   src/account/fit_panels.tsx), and public/fit-panel.js imports it in the
   browser to score the list public/tenders.js already holds. The
   Methodology page prints its points
   table from MATCH_POINTS. Nothing here touches the page, so the tests
   import it as it is.

   Four parts, out of MATCH_MAX. In each only the highest line that applies
   counts, and a line that reads a count takes the largest count of any one
   source, never a sum of two (a source's count is how many of its records
   share the thing). With several codes or provinces on a notice, the best
   one counts.

     work      a notice code shares a UNSPSC class with the records, else a
               family, else a segment: MATCH_POINTS.class, .family, .segment
     buyer     the notice's buyer is in the records
     province  a province the notice names (stated or derived) is a province
               of delivery in the records; else it is the province on the
               organization's profile; else the notice names none
     type      an RFP against a supply arrangement while the organization
               holds a supply arrangement in one of its segments; else a
               notice type it was awarded under

   Each pair is [3 or more, 1 or 2]: MATCH_MANY records of one source take
   the first figure. A notice is matched only when it shares at least a
   segment (work above zero): a frequent buyer in the home province posts
   many notices that have nothing to do with the firm's work. The band names
   the match, never the business: close from BAND_CLOSE, partial from
   BAND_PARTIAL, weak below. Lists carry close and partial matches. No part
   is a chance of winning, and grants and lobbying are never read. */

// The fiscal years the pipeline counts (profile_matching.MATCH_YEARS).
export const MATCH_YEARS = 5;
// A count from here up takes a pair's first figure.
export const MATCH_MANY = 3;
// Records of one source with UNSPSC codes the organization needs before its notices are ranked.
export const MATCH_MIN = 3;
export const MATCH_MAX = 100;
export const BAND_CLOSE = 60;
export const BAND_PARTIAL = 30;
export const MATCH_POINTS = Object.freeze({
  class: Object.freeze([45, 35]),
  family: Object.freeze([25, 20]),
  segment: Object.freeze([10, 5]),
  buyer: Object.freeze([25, 15]),
  delivered: Object.freeze([15, 10]),
  home: 8,
  national: 5,
  held: 15,
  type: Object.freeze([10, 5]),
});
// The bands a list or an email carries.
export const LISTED_BANDS = Object.freeze(["close", "partial"]);
// The notice type the supply arrangement line reads, as CanadaBuys publishes it (compared in lower case).
export const RFP_AGAINST_SA = "rfp against supply arrangement";
// The instrument type of a supply arrangement in the block's held rows (sources/sosa.py TYPES).
export const SA_TYPE = "SA";

/**
 * @typedef {[string, number, number]} PairRow  a key and its award notice and history counts
 * @typedef {{
 *   fy: [number, number], n: [number, number, number], coded: [number, number], newest: string | null,
 *   classes: PairRow[], families: PairRow[], segments: PairRow[],
 *   buyers: [string, number, number, number][], provinces: PairRow[], types: PairRow[],
 *   held: [string, string, number][]
 * }} MatchBlock
 * @typedef {{
 *   codes?: readonly string[] | null, segments?: readonly string[] | null, provinces?: readonly string[] | null,
 *   provinces_derived?: readonly string[] | null, buyer_id?: string | null, notice_type_en?: string | null
 * }} FitNotice
 * @typedef {{
 *   part: "work" | "buyer" | "province" | "type",
 *   kind: "class" | "family" | "segment" | "buyer" | "delivered" | "home" | "national" | "held" | "type",
 *   key: string | null, counts: number[], points: number
 * }} Reason
 * @typedef {"close" | "partial" | "weak" | "none"} Band
 * @typedef {{ points: number, band: Band, coded: boolean, reasons: Reason[] }} Score
 */

/** A pair's figure for a count: the first from MATCH_MANY up, the second for 1 or 2, none for 0. */
function tier(/** @type {readonly number[]} */ pair, /** @type {number} */ count) {
  return count >= MATCH_MANY ? pair[0] : count > 0 ? pair[1] : 0;
}

/** The largest count of one source. */
export function largest(/** @type {readonly number[]} */ counts) {
  let n = 0;
  for (const c of counts) if (c > n) n = c;
  return n;
}

// The block's lists as maps, made once per block: scoring a thousand notices
// reads them a few thousand times.
const TABLES = new WeakMap();

/** @param {MatchBlock} block */
function tablesOf(block) {
  let t = TABLES.get(block);
  if (t) return t;
  const counts = (/** @type {readonly (readonly [string, ...number[]])[]} */ rows) => new Map(rows.map((r) => [r[0], r.slice(1)]));
  /** @type {Map<string, number>} */
  const held = new Map();
  for (const [type, segment, n] of block.held) if (type === SA_TYPE) held.set(segment, (held.get(segment) ?? 0) + n);
  t = {
    class: counts(block.classes), family: counts(block.families), segment: counts(block.segments), buyer: counts(block.buyers),
    province: counts(block.provinces), type: new Map(block.types.map((r) => [r[0].trim().toLowerCase(), r.slice(1)])), held,
  };
  TABLES.set(block, t);
  return t;
}

/** Whether a reason beats the best so far: more points, then the larger count, then the smaller key. */
function better(/** @type {Reason} */ r, /** @type {Reason | null} */ best) {
  if (!best) return true;
  if (r.points !== best.points) return r.points > best.points;
  const a = largest(r.counts);
  const b = largest(best.counts);
  if (a !== b) return a > b;
  return (r.key ?? "") < (best.key ?? "");
}

/**
 * The work part: for each code the notice carries, its class, else its family, else its segment, as the
 * records hold it (a class's points always top a family's, and a family's a segment's); the best code wins.
 * A notice without full codes is read by its segments.
 * @param {ReturnType<typeof tablesOf>} t @param {FitNotice} notice @returns {Reason | null}
 */
function workOf(t, notice) {
  /** @type {Reason | null} */
  let best = null;
  const codes = [...(notice.codes ?? []), ...(notice.segments ?? [])];
  for (const code of codes) {
    if (typeof code !== "string" || !/^[0-9]{2}/.test(code)) continue;
    for (const [kind, digits] of /** @type {const} */ ([["class", 6], ["family", 4], ["segment", 2]])) {
      if (code.length < digits) continue;
      const key = code.slice(0, digits);
      const counts = t[kind].get(key);
      if (!counts) continue;
      const points = tier(MATCH_POINTS[kind], largest(counts));
      if (!points) continue;
      /** @type {Reason} */
      const r = { part: "work", kind, key, counts, points };
      if (better(r, best)) best = r;
      break;
    }
  }
  return best;
}

/** @param {ReturnType<typeof tablesOf>} t @param {FitNotice} notice @returns {Reason | null} */
function buyerOf(t, notice) {
  const counts = notice.buyer_id ? t.buyer.get(notice.buyer_id) : undefined;
  const points = counts ? tier(MATCH_POINTS.buyer, largest(counts)) : 0;
  return points ? { part: "buyer", kind: "buyer", key: /** @type {string} */ (notice.buyer_id), counts, points } : null;
}

/**
 * @param {ReturnType<typeof tablesOf>} t @param {FitNotice} notice @param {string | null | undefined} home
 * @returns {Reason | null}
 */
function provinceOf(t, notice, home) {
  const named = [...new Set([...(notice.provinces ?? []), ...(notice.provinces_derived ?? [])])];
  /** @type {Reason | null} */
  let best = null;
  for (const p of named) {
    const counts = t.province.get(p);
    const points = counts ? tier(MATCH_POINTS.delivered, largest(counts)) : 0;
    /** @type {Reason} */
    const r = { part: "province", kind: "delivered", key: p, counts: counts ?? [], points };
    if (points && better(r, best)) best = r;
  }
  if (best) return best;
  if (home && named.includes(home)) return { part: "province", kind: "home", key: home, counts: [], points: MATCH_POINTS.home };
  if (!named.length) return { part: "province", kind: "national", key: null, counts: [], points: MATCH_POINTS.national };
  return null;
}

/** @param {ReturnType<typeof tablesOf>} t @param {FitNotice} notice @returns {Reason | null} */
function typeOf(t, notice) {
  const type = (notice.notice_type_en ?? "").trim().toLowerCase();
  if (!type) return null;
  if (type === RFP_AGAINST_SA) {
    /** @type {Reason | null} */
    let best = null;
    for (const s of notice.segments ?? []) {
      const n = t.held.get(s);
      /** @type {Reason} */
      const r = { part: "type", kind: "held", key: s, counts: [n ?? 0], points: MATCH_POINTS.held };
      if (n && better(r, best)) best = r;
    }
    if (best) return best;
  }
  const counts = t.type.get(type);
  const points = counts ? tier(MATCH_POINTS.type, largest(counts)) : 0;
  return points ? { part: "type", kind: "type", key: notice.notice_type_en ?? null, counts, points } : null;
}

/** The band a total names; "none" when the notice shares no work with the records. */
export function bandOf(/** @type {number} */ points, /** @type {number} */ work) {
  if (!work) return "none";
  return points >= BAND_CLOSE ? "close" : points >= BAND_PARTIAL ? "partial" : "weak";
}

/**
 * One notice against the block. reasons hold every part that applies, work first; a notice that shares no
 * work with the records scores 0 in the band "none", and its other reasons stay as facts in common.
 * coded is false for a notice with no UNSPSC code at all, which cannot be matched.
 * @param {MatchBlock} block @param {FitNotice} notice @param {string | null | undefined} home the province on the profile
 * @returns {Score}
 */
export function scoreNotice(block, notice, home) {
  const t = tablesOf(block);
  const coded = (notice.codes ?? []).length > 0 || (notice.segments ?? []).length > 0;
  const reasons = /** @type {Reason[]} */ ([workOf(t, notice), buyerOf(t, notice), provinceOf(t, notice, home), typeOf(t, notice)]
    .filter((r) => r !== null));
  const work = reasons[0]?.part === "work" ? reasons[0].points : 0;
  const total = reasons.reduce((s, r) => s + r.points, 0);
  const band = bandOf(total, work);
  return { points: band === "none" ? 0 : total, band, coded, reasons };
}

/**
 * What a block allows: "none" when nothing is counted, "uncoded" when the records are published contracts
 * only (no UNSPSC code to compare), "thin" when no source holds MATCH_MIN records with codes, else "ready".
 * @param {MatchBlock} block @returns {"none" | "uncoded" | "thin" | "ready"}
 */
export function blockState(block) {
  if (!block.n.some((n) => n > 0)) return "none";
  if (block.n[0] + block.n[1] === 0) return "uncoded";
  return largest(block.coded) >= MATCH_MIN ? "ready" : "thin";
}

/**
 * The listed matches of a list of notices, closest first: the bands of LISTED_BANDS, by points, then the
 * soonest closing (a notice without one last), then the reference. uncoded counts the notices with no
 * UNSPSC code, which no rule can read.
 * @template {FitNotice & { reference: string, closing?: string | null }} R
 * @param {MatchBlock} block @param {readonly R[]} rows @param {string | null | undefined} home
 * @returns {{ matches: { row: R, score: Score }[], uncoded: number }}
 */
export function rankNotices(block, rows, home) {
  /** @type {{ row: R, score: Score }[]} */
  const matches = [];
  let uncoded = 0;
  for (const row of rows) {
    const score = scoreNotice(block, row, home);
    if (!score.coded) uncoded += 1;
    else if (LISTED_BANDS.includes(score.band)) matches.push({ row, score });
  }
  matches.sort((a, b) => {
    if (a.score.points !== b.score.points) return b.score.points - a.score.points;
    const ca = a.row.closing ?? "";
    const cb = b.row.closing ?? "";
    if (ca !== cb) return !ca ? 1 : !cb ? -1 : ca < cb ? -1 : 1;
    return a.row.reference < b.row.reference ? -1 : a.row.reference > b.row.reference ? 1 : 0;
  });
  return { matches, uncoded };
}
