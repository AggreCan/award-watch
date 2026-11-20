/* The analytics builder's menus and the rules that keep a view honest
   (src/pages/builder.tsx; docs/analytics.md, "The builder"): which subjects,
   rows, figures and sources the builder offers together, as the design's
   matrix sets them, and why it offers no other. One copy for the Worker,
   which reads every address through it (src/builder.ts) and answers a
   combination outside the matrix with its reason, and for the page's script
   (public/builder.js), which hides what is not offered as the menus change.

   The menus are fixed lists, never a query: Subject, Rows, Figure (the
   measure), Source, Period, Show as, and the top N of a ranked list. The
   rules, in the order they are checked:
   - Rows are offered for a subject when some figure is (MATRIX).
   - A figure is offered for a subject and its rows when the matrix says so.
   - One source a view. Segments, provinces and amendments need a source
     that records them (award notices, PSPC history); the competitive flag
     and the method need one that flags them (not grants). The contracts
     ending follow the radar's rule whatever the source.
   - A figure that cannot be added (a median, a count of organizations, the
     largest organizations' share) is offered by fiscal year, or for one
     fiscal year when the rows are not years; fiscal quarters for periods of
     QUARTER_YEARS at most.
   - A comparison set holds buyers or organizations, never both, at most
     SET_MAX; each is a subject of its own (small multiples).
   Nothing here touches a page, a request, a file or a database, and it holds
   no text: a reason is a key of the site's dictionary. */

export const SUBJECTS = ["all", "buyer", "buyers", "segment", "buyer_segment", "organization", "organizations"];
export const ROWS = ["year", "quarter", "segment", "buyer", "province", "method", "competitive", "organization", "none"];
export const MEASURES = ["value", "records", "average", "median", "organizations", "noncompetitive", "largest", "amendments", "ending"];
export const SOURCES = ["awards", "history", "contracts", "grants"];
export const SHOWS = ["bars", "line", "ranked", "number", "table"];
// The rows a ranked list shows: the largest by value.
export const TOPS = [5, 10, 25];
export const TOP_DEFAULT = 10;
// The most buyers or organizations a comparison holds.
export const SET_MAX = 5;
// The longest period a view by fiscal quarter reads.
export const QUARTER_YEARS = 5;

// The subjects that are a set of buyers or of organizations.
export const SETS = ["buyers", "organizations"];
// The figures no reader may add across fiscal years.
export const UNADDABLE = ["median", "organizations", "largest"];
// The sources whose records carry UNSPSC codes, provinces of delivery and numbered versions.
export const PLACED_SOURCES = ["awards", "history"];
// The sources that flag a record competitive or not and name its method.
export const FLAGGED_SOURCES = ["awards", "history", "contracts"];

// The subjects a cube cell answers (cube_bs: every buyer, a buyer, a segment, a buyer in a segment), and with them the
// organizations, which records answers by the organization's index.
const CUBE = ["all", "buyer", "buyers", "segment", "buyer_segment"];
const ANY = [...CUBE, "organization", "organizations"];
// One buyer, one segment, or one buyer in one segment.
const ONE = ["buyer", "segment", "buyer_segment"];
const BY_SEGMENT = ["all", "buyer", "buyers"];
const BY_BUYER = ["all", "segment", "buyers"];
const BY_PLACE = ["all", "buyer", "buyers", "segment"];
const BY_ORG = ["buyer", "segment", "buyer_segment", "organizations"];

// Rows, then figure, then the subjects the cell is offered for; a figure a row does not list is not offered by it.
const YEAR = {
  value: ANY, records: ANY, average: CUBE, median: CUBE, organizations: CUBE, noncompetitive: ANY, largest: CUBE, amendments: ANY,
};
export const MATRIX = {
  year: YEAR,
  quarter: { value: ONE, records: ONE, ending: ONE },
  segment: {
    value: BY_SEGMENT, records: BY_SEGMENT, average: BY_SEGMENT, median: BY_SEGMENT, organizations: BY_SEGMENT,
    noncompetitive: BY_SEGMENT, largest: BY_SEGMENT, amendments: BY_SEGMENT, ending: ["all", "buyer"],
  },
  buyer: {
    value: BY_BUYER, records: BY_BUYER, average: BY_BUYER, median: BY_BUYER, organizations: BY_BUYER,
    noncompetitive: BY_BUYER, largest: BY_BUYER, amendments: BY_BUYER, ending: ["all", "segment"],
  },
  province: { value: BY_PLACE, records: BY_PLACE, average: BY_PLACE, median: BY_PLACE, noncompetitive: BY_PLACE },
  method: { value: ["buyer", "segment"], records: ["buyer", "segment"] },
  competitive: { value: CUBE, records: CUBE },
  organization: { value: BY_ORG, records: BY_ORG, noncompetitive: BY_ORG, amendments: BY_ORG },
  // One figure for the period: every figure by fiscal year, added over the years, and the contracts ending.
  none: { ...YEAR, ending: ONE },
};

/** @param {string} rows @param {string} measure @param {string} subject */
export function cellOffered(rows, measure, subject) {
  const row = MATRIX[rows];
  const subjects = row ? row[measure] : undefined;
  return !!subjects && subjects.includes(subject);
}

/** @param {string} subject @returns {string[]} */
export function rowsFor(subject) {
  return ROWS.filter((r) => MEASURES.some((m) => cellOffered(r, m, subject)));
}

/** @param {string} subject @param {string} rows @returns {string[]} */
export function measuresFor(subject, rows) {
  return MEASURES.filter((m) => cellOffered(rows, m, subject));
}

// Whether a view of these menus may read a source.
/** @param {{ subject: string, rows: string, measure: string }} c @param {string} source */
export function sourceOffered(c, source) {
  if (!SOURCES.includes(source)) return false;
  if (c.measure === "ending") return true;
  const placed = c.subject === "segment" || c.subject === "buyer_segment" || c.rows === "segment" || c.rows === "province" || c.measure === "amendments";
  if (placed && !PLACED_SOURCES.includes(source)) return false;
  const flagged = c.measure === "noncompetitive" || c.rows === "method" || c.rows === "competitive";
  return !(flagged && !FLAGGED_SOURCES.includes(source));
}

/** @param {{ subject: string, rows: string, measure: string }} c @returns {string[]} */
export function sourcesFor(c) {
  return SOURCES.filter((s) => sourceOffered(c, s));
}

// The most fiscal years a view of these menus reads, most being the reader's plan's figure; null when the view
// follows no period (the contracts ending count from the data date).
/** @param {{ rows: string, measure: string }} c @param {number} most @returns {number | null} */
export function longestSpan(c, most) {
  if (c.measure === "ending") return null;
  if (UNADDABLE.includes(c.measure) && c.rows !== "year") return 1;
  if (c.rows === "quarter") return Math.min(QUARTER_YEARS, most);
  return most;
}

// How a view of these rows may be drawn, the first its default but for the shares, the average and the median by
// time, which read as a line.
/** @param {string} rows @param {string} [measure] @returns {string[]} */
export function showsFor(rows, measure) {
  if (rows === "none") return ["number", "table"];
  if (rows === "year" || rows === "quarter") {
    const line = ["average", "median", "noncompetitive", "largest"].includes(measure ?? "");
    return line ? ["line", "bars", "table"] : ["bars", "line", "table"];
  }
  return ["ranked", "table"];
}

// Whether a ranked list of these rows takes a top N: the buyers, organizations, segments and provinces, but not the
// set itself when the rows are the set's own buyers or organizations.
/** @param {string} subject @param {string} rows */
export function topOffered(subject, rows) {
  if (rows === "segment" || rows === "province") return true;
  if (rows === "buyer" || rows === "organization") return !SETS.includes(subject);
  return false;
}

// Why the menus as chosen are not offered, the first rule they break, or null when they are: a key of the site's
// dictionary (build.why_*) and the figure it names. The period is checked last, against the most fiscal years the
// view could read (longestSpan).
/**
 * @param {{ subject: string, rows: string, measure: string, source: string, first: number, last: number }} c
 * @param {number} most
 * @returns {{ key: string, n?: number } | null}
 */
export function whyNot(c, most) {
  if (!rowsFor(c.subject).includes(c.rows)) return { key: "build.why_rows" };
  if (!cellOffered(c.rows, c.measure, c.subject)) return { key: "build.why_measure" };
  if (!sourceOffered(c, c.source)) return { key: "build.why_source" };
  const span = longestSpan(c, most);
  if (span !== null && c.last - c.first + 1 > span) return span === 1 ? { key: "build.why_sum" } : { key: "build.why_quarters", n: span };
  return null;
}
