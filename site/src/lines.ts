// The holder's record (docs/accounts.md, Holder's record): for a contract on
// the radar, its holder's contracts of the same kind with the same buyer,
// each source counted apart. The pipeline counts them each night
// (pipeline/awardwatch_pipeline/lines.py) and the records sync sends them to
// rec_lines; this module holds the rules' constants (the pipeline's test
// holds the two sets equal), the check of a row's JSON, and the label rule.
// The words are in src/lines_view.tsx and src/pages/holders.tsx.
//
// A label names the records (a run of contracts, earlier records, none),
// never the business or the buyer, and always stands with its figure.

import { BUYER_ID_RE, DAY_RE, ORG_ID_RE } from "./data";
import { isObj, isStr } from "./valid";

// The rules (pipeline lines.py repeats each; its test compares them).
export const LINE_YEARS = 10;
export const RUN_GAP_DAYS = 120;
export const RUN_OVERLAP_DAYS = 60;
export const LONG_RUN = 3;
export const CODE_CHARS = 4;
export const SIMILAR_PREFIX = 20;
// An opening more holders of a line share than this is a common phrase (the
// harbour authorities'), and lists no one there.
export const SIMILAR_GROUP_MAX = 12;
// The form of j the pipeline writes; a row of another form is not read.
export const J_VERSION = 1;

// records.src: 1 award notices, 2 PSPC contract history, 3 published contracts.
export type LineSrc = 1 | 2 | 3;
export const LINE_SOURCE: Readonly<Record<LineSrc, "awards" | "history" | "contracts">> = { 1: "awards", 2: "history", 3: "contracts" };
export type LineLevel = "class" | "family" | "code";

// One source's figures: its kind of work (level and keys), the holder's
// records in it (held, this one included), how many ran back to back, the
// first start, the line's records whoever held them and the other
// organizations among them, and how the held ones were awarded.
export interface LineSource {
  src: LineSrc; lvl: LineLevel; key: string[]; held: number; run: number; first: string | null; total: number; others: number;
  c: number; nc: number; u: number;
}
// The contract's own: competitive or not, its method's TBS code, the bids a
// published contract states, its amendments and its first and newest ends.
export interface LineOwn {
  comp: 0 | 1 | null; meth: string | null; bids: number | null; amd: number; growth: number | null; end0: string | null; end: string | null;
}
// An organization of a similar name in a line: its id, name, the source, how
// many of its records start on or before this one, and the last start.
export type SimilarName = [id: string, name: string, src: LineSrc, n: number, last: string];

export interface LineRecord {
  v: number; fy: [number, number]; buyer: string | null; oid: number | null; s: LineSource[]; own: LineOwn; sim: SimilarName[];
}

// -- the check -----------------------------------------------------------------------

const isInt = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;
const isDayOrNull = (v: unknown): boolean => v === null || (isStr(v) && DAY_RE.test(v) && v.length === 10);
const isSrc = (v: unknown): v is LineSrc => v === 1 || v === 2 || v === 3;
const KEY_RE: Readonly<Record<LineLevel, RegExp>> = {
  class: /^[0-9]{6}$/, family: /^[0-9]{4}$/, code: new RegExp(`^[A-Z0-9]{${CODE_CHARS}}$`),
};
// The bounds stop a runaway row: a notice names a handful of classes, a line
// a few similar names (the pipeline keeps the SIM_MAX with the most records).
const KEYS_MAX = 40;
export const SIM_MAX = 50;
const METH_RE = /^(OB|TC|ST|TN|AC)$/;

function isSource(v: unknown): v is LineSource {
  if (!isObj(v) || !isSrc(v.src) || !(v.lvl === "class" || v.lvl === "family" || v.lvl === "code")) return false;
  const re = KEY_RE[v.lvl as LineLevel];
  if (!Array.isArray(v.key) || v.key.length < 1 || v.key.length > KEYS_MAX || !v.key.every((k) => isStr(k) && re.test(k))) return false;
  if ((v.lvl === "code") !== (v.src === 3)) return false;
  return isInt(v.held, 1) && isInt(v.run, 1) && v.run <= v.held && isDayOrNull(v.first) && isInt(v.total, 1) && v.total >= v.held &&
    isInt(v.others) && isInt(v.c) && isInt(v.nc) && isInt(v.u) && v.c + v.nc + v.u === v.held;
}

function isOwn(v: unknown): v is LineOwn {
  return isObj(v) && (v.comp === 0 || v.comp === 1 || v.comp === null) && (v.meth === null || (isStr(v.meth) && METH_RE.test(v.meth))) &&
    (v.bids === null || isInt(v.bids)) && isInt(v.amd) && (v.growth === null || (typeof v.growth === "number" && Number.isFinite(v.growth))) &&
    isDayOrNull(v.end0) && isDayOrNull(v.end);
}

const isSimilar = (v: unknown): v is SimilarName =>
  Array.isArray(v) && v.length === 5 && isStr(v[0]) && ORG_ID_RE.test(v[0]) && isStr(v[1]) && v[1].trim() !== "" && v[1].length <= 300 &&
  isSrc(v[2]) && isInt(v[3], 1) && isStr(v[4]) && DAY_RE.test(v[4]);

// A row's j, read and checked whole, or null: a row that does not read in
// full is never shown in part, as a profile's matching block is not.
export function parseLine(text: unknown): LineRecord | null {
  if (!isStr(text) || text.length > 20_000) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(v) || v.v !== J_VERSION) return null;
  const fy = v.fy;
  const ok = Array.isArray(fy) && fy.length === 2 && isInt(fy[0], 2000) && isInt(fy[1], 2000) && fy[0] <= fy[1] && fy[1] <= 2200 &&
    (v.buyer === null || (isStr(v.buyer) && v.buyer.length <= 80 && BUYER_ID_RE.test(v.buyer))) && (v.oid === null || isInt(v.oid)) &&
    Array.isArray(v.s) && v.s.length <= 3 && v.s.every(isSource) && new Set(v.s.map((e: LineSource) => e.src)).size === v.s.length &&
    isOwn(v.own) && Array.isArray(v.sim) && v.sim.length <= SIM_MAX && v.sim.every(isSimilar);
  return ok ? (v as unknown as LineRecord) : null;
}

// -- the label -----------------------------------------------------------------------

export type Band = "run" | "earlier" | "none";

// The label, its figure and the source that decided it, as the pipeline's
// lines.label reads them: a long run when one source has LONG_RUN or more
// back to back (the longest run), else earlier records when one source has
// at least one (the most), else no earlier record; null when no source has a
// kind of work. Sources are never added: each figure is one source's, the
// lowest source number taking a tie.
export interface LineLabel { band: Band; figure: number; src: LineSrc | null; first: string | null }

export function lineLabel(j: LineRecord): LineLabel | null {
  const s = j.s;
  if (!s.length) return null;
  const best = (score: (e: LineSource) => number) =>
    s.reduce((a, b) => (score(b) > score(a) || (score(b) === score(a) && b.src < a.src) ? b : a));
  const run = best((e) => e.run);
  if (run.run >= LONG_RUN) return { band: "run", figure: run.run, src: run.src, first: run.first };
  const earlier = best((e) => e.held - 1);
  if (earlier.held - 1 >= 1) return { band: "earlier", figure: earlier.held - 1, src: earlier.src, first: earlier.first };
  return { band: "none", figure: 0, src: null, first: null };
}

// The key a radar row and a record's page ask rec_lines by: the row's kind
// and its reference in the site's URL form, in lower case
// ('contract:<department>:<reference>' for a published contract).
export function lineKey(kind: "award" | "history" | "contract", reference: string): string {
  return `${kind}:${reference}`.toLowerCase();
}
