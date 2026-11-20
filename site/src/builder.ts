// The analytics builder's menu model (docs/analytics.md, "The builder"): a
// view as its address reads and writes it, and the check that says whether
// the builder offers it. The menus are fixed lists (public/build-menu.js holds
// them and the matrix of what goes with what, one copy for this module and
// the page's script); the address is the view, a GET form's. Nothing here
// reads a request, a file or a database: the page (pages/builder.tsx) hands
// in the address, the data date's fiscal year and the buyers its file lists.
//
// A value the menus do not hold reads as the menu's default, as the analytics
// views read theirs (view_address.ts); a combination of values the matrix
// does not hold is answered with its reason (buildProblem), never drawn.

import {
  MEASURES, ROWS, SET_MAX, SETS, SOURCES, SUBJECTS, TOPS, TOP_DEFAULT, showsFor, topOffered, whyNot,
} from "../public/build-menu.js";
import { orgIdIn } from "./account/org_claim";
import { SEGMENT_CODES, type MoneySource } from "./constants";
import { BUYER_ID_RE } from "./data";
import { EARLIEST_FY, ULTRA_YEARS, choosePeriod } from "./records_db";
import { DEFAULT_YEARS } from "./view_address";

export type Subject = "all" | "buyer" | "buyers" | "segment" | "buyer_segment" | "organization" | "organizations";
export type Rows = "year" | "quarter" | "segment" | "buyer" | "province" | "method" | "competitive" | "organization" | "none";
export type Measure = "value" | "records" | "average" | "median" | "organizations" | "noncompetitive" | "largest" | "amendments" | "ending";
export type Show = "bars" | "line" | "ranked" | "number" | "table";

export const BUILD_PATH = "/analytics/build";
export const BUILD_CSV_PATH = "/analytics/build.csv";
// The header the page's script sends for the result alone (the preview), and the one the answer carries back.
export const FRAGMENT_HEADER = "x-build-fragment";

// The longest period a view reads: Ultra's figure, the one the analytics views hold (records_db.ts).
export const BUILD_YEARS = ULTRA_YEARS;

// A view: its subject (every buyer, one or several buyers, a segment, a buyer
// in a segment, one or several organizations, by the ids the address names),
// its rows, its figure, its source, its period (first and last fiscal year,
// capped when the address asked for more than BUILD_YEARS), how it is drawn
// and, for a ranked list, how many rows.
export interface BuildChoice {
  subject: Subject;
  buyers: string[];
  segment: string;
  orgs: string[];
  rows: Rows;
  measure: Measure;
  source: MoneySource;
  first: number;
  last: number;
  capped: boolean;
  show: Show;
  top: number;
}

const oneOf = <T extends string>(list: readonly string[], v: string | null, fallback: T): T => {
  const x = (v ?? "").trim().toLowerCase();
  return (list.includes(x) ? x : fallback) as T;
};

// Each id once, in the order given, at most SET_MAX.
function distinct(values: readonly (string | null)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v && !out.includes(v)) out.push(v);
    if (out.length === SET_MAX) break;
  }
  return out;
}

// The view an address names, at the data date's fiscal year (current). The
// defaults: every buyer's award notice value by fiscal year over the latest
// DEFAULT_YEARS, as bars.
export function readBuild(url: URL, current: number): BuildChoice {
  const q = url.searchParams;
  const subject = oneOf<Subject>(SUBJECTS, q.get("subject"), "all");
  const buyers = distinct(q.getAll("b").map((v) => {
    const id = v.trim().toLowerCase();
    return BUYER_ID_RE.test(id) && id.length <= 80 ? id : null;
  }));
  const orgs = distinct(q.getAll("o").map((v) => orgIdIn(v)));
  const code = (q.get("s") ?? "").trim();
  const rows = oneOf<Rows>(ROWS, q.get("rows"), "year");
  const measure = oneOf<Measure>(MEASURES, q.get("measure"), "value");
  const source = oneOf<MoneySource>(SOURCES, q.get("source"), "awards");
  const chosen = choosePeriod(q.get("from"), q.get("to"), current, BUILD_YEARS);
  const first = chosen?.first ?? Math.max(EARLIEST_FY, current - DEFAULT_YEARS + 1);
  const last = chosen?.last ?? current;
  const shows = showsFor(rows, measure);
  const show = oneOf<Show>(shows, q.get("show"), shows[0] as Show);
  const top = Number(q.get("top"));
  return {
    subject, buyers: subject === "buyer" || subject === "buyer_segment" ? buyers.slice(0, 1) : buyers, segment: SEGMENT_CODES.includes(code) ? code : "",
    orgs: subject === "organization" ? orgs.slice(0, 1) : orgs, rows, measure, source, first, last, capped: chosen?.capped ?? false, show,
    top: (TOPS as readonly number[]).includes(top) ? top : TOP_DEFAULT,
  };
}

// What a subject names: its buyers, its segment, its organizations.
export const usesBuyers = (s: Subject): boolean => s === "buyer" || s === "buyers" || s === "buyer_segment";
export const usesSegment = (s: Subject): boolean => s === "segment" || s === "buyer_segment";
export const usesOrgs = (s: Subject): boolean => s === "organization" || s === "organizations";
export const isSet = (s: Subject): boolean => (SETS as readonly string[]).includes(s);

// The view's address in its one form: the subject and the ids it names, the
// rows, the figure, the source and the period (none for the contracts ending,
// which follow the radar's), how it is drawn and the top N where the rows
// take one. readBuild of this address gives the same view.
export function buildQuery(c: BuildChoice): string {
  const p = new URLSearchParams({ subject: c.subject });
  if (usesBuyers(c.subject)) for (const b of c.buyers) p.append("b", b);
  if (usesSegment(c.subject) && c.segment) p.set("s", c.segment);
  if (usesOrgs(c.subject)) for (const o of c.orgs) p.append("o", o);
  p.set("rows", c.rows);
  p.set("measure", c.measure);
  if (c.measure !== "ending") {
    p.set("source", c.source);
    p.set("from", String(c.first));
    p.set("to", String(c.last));
  }
  p.set("show", c.show);
  if (topOffered(c.subject, c.rows)) p.set("top", String(c.top));
  return p.toString();
}

// The builder's address for one buyer or one organization over a source and a period, its value by fiscal year:
// the link a buyer's or an organization's analytics view gives an Ultra reader (pages/analytics.tsx).
export function buildLink(subject: { buyer: string } | { org: string }, source: MoneySource, first: number, last: number): string {
  const buyer = "buyer" in subject;
  return `${BUILD_PATH}?${buildQuery({
    subject: buyer ? "buyer" : "organization", buyers: buyer ? [subject.buyer] : [], segment: "", orgs: buyer ? [] : [subject.org], rows: "year",
    measure: "value", source, first, last, capped: false, show: "bars", top: TOP_DEFAULT,
  })}`;
}

// Why a view cannot be drawn: a combination the menus do not offer (its rule,
// public/build-menu.js whyNot), or a subject not yet chosen in full (a buyer
// the list does not hold, no segment, no organization). Null when it can.
export type Problem =
  | { kind: "not_offered"; key: "build.why_rows" | "build.why_measure" | "build.why_source" | "build.why_sum" | "build.why_quarters"; n?: number }
  | { kind: "choose"; key: "build.choose_buyer" | "build.choose_segment" | "build.choose_org" };

export function buildProblem(c: BuildChoice, buyerIds: ReadonlySet<string> | null): Problem | null {
  const why = whyNot(c, BUILD_YEARS);
  if (why) return { kind: "not_offered", key: why.key as Extract<Problem, { kind: "not_offered" }>["key"], ...(why.n ? { n: why.n } : {}) };
  if (usesBuyers(c.subject) && (!c.buyers.length || (buyerIds && c.buyers.some((b) => !buyerIds.has(b))))) return { kind: "choose", key: "build.choose_buyer" };
  if (usesSegment(c.subject) && !c.segment) return { kind: "choose", key: "build.choose_segment" };
  if (usesOrgs(c.subject) && !c.orgs.length) return { kind: "choose", key: "build.choose_org" };
  return null;
}
