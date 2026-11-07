// The same-day tender notices (docs/intraday.md): the rows the intraday
// workflow writes to the hosted search database (D1 awardwatch-search,
// binding SEARCH, table intraday_tenders, schema
// pipeline/intraday_schema.sql) after each cut of CanadaBuys' new notices
// file, which the nightly reads once a day. A paid request reads them
// (src/plan.ts decides) and sets them against the list the nightly
// published; src/pages/intraday.tsx draws the band.
//
// One constant statement, prepared; the bound values are the data date
// (checked as a date) and the row cap, never anything from the request.
// Every row is checked as the export's list rows are (isTenderRow's rules in
// src/data.ts) and one that fails is left out.

import { CATEGORIES, PROVINCES, SEGMENTS } from "./constants";
import { BUYER_ID_RE, DAY_RE, REFERENCE_RE, type TenderRow } from "./data";

// More than a day of new notices on CanadaBuys' busiest days.
export const MAX_ROWS = 500;

export const INTRADAY_SQL =
  "SELECT reference, reference_published, amendment, seen_at, published, closing, title_en, title_fr, buyer_id, " +
  "buyer_name, buyer_name_fr, category, notice_type_en, notice_type_fr, method_en, method_fr, segments, provinces, " +
  "codes, excerpt_en, excerpt_fr FROM intraday_tenders WHERE seen_at >= ? " +
  "ORDER BY seen_at DESC, reference, amendment DESC LIMIT ?";

// A version as the open list carries it, with the time the intraday job
// first read it (UTC, "2026-11-02T13:45:30Z").
export interface IntradayRow extends TenderRow {
  seen_at: string;
}

// "new": the nightly's list does not hold the notice. "amended": it holds an
// earlier amendment, which this version replaces in the band.
export type IntradayKind = "new" | "amended";

export interface IntradayView extends IntradayRow {
  intraday: IntradayKind;
}

const SEEN_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CODE_RE = /^[0-9]{2,8}$/;
const CATEGORY_SET: ReadonlySet<string> = new Set(CATEGORIES);
const PROVINCE_SET: ReadonlySet<string> = new Set(PROVINCES);

const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

// A JSON list column: the items that pass keep, in order; anything else is an empty list.
function listOf(v: unknown, keep: (s: string) => boolean): string[] {
  if (typeof v !== "string" || !v) return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && keep(x)) : [];
  } catch {
    return [];
  }
}

// One D1 row as a list row, or null when its key or its time does not read.
export function toIntradayRow(r: Record<string, unknown>): IntradayRow | null {
  const { reference, amendment, seen_at: seen } = r;
  if (typeof reference !== "string" || !REFERENCE_RE.test(reference)) return null;
  if (typeof amendment !== "number" || !Number.isInteger(amendment) || amendment < 0) return null;
  if (typeof seen !== "string" || !SEEN_RE.test(seen)) return null;
  const published = textOrNull(r.reference_published);
  const buyer = typeof r.buyer_id === "string" && BUYER_ID_RE.test(r.buyer_id) && r.buyer_id.length <= 80 ? r.buyer_id : null;
  const row: IntradayRow = {
    reference,
    amendment,
    title_en: textOrNull(r.title_en),
    title_fr: textOrNull(r.title_fr),
    buyer_id: buyer,
    buyer_en: textOrNull(r.buyer_name),
    buyer_fr: textOrNull(r.buyer_name_fr),
    published: textOrNull(r.published),
    closing: textOrNull(r.closing),
    category: listOf(r.category, (x) => CATEGORY_SET.has(x)),
    notice_type_en: textOrNull(r.notice_type_en),
    notice_type_fr: textOrNull(r.notice_type_fr),
    method_en: textOrNull(r.method_en),
    method_fr: textOrNull(r.method_fr),
    segments: listOf(r.segments, (x) => x in SEGMENTS),
    provinces: listOf(r.provinces, (x) => PROVINCE_SET.has(x)),
    first_seen: seen.slice(0, 10),
    excerpt_en: textOrNull(r.excerpt_en),
    excerpt_fr: textOrNull(r.excerpt_fr),
    codes: listOf(r.codes, (x) => CODE_RE.test(x)),
    seen_at: seen,
  };
  if (published && published !== reference && published.length <= 200) row.reference_published = published;
  return row;
}

// The versions first read on or after the data date (the nightly's list
// holds what came before), newest first. A D1 fault throws; the caller
// shows the free view.
export async function loadIntraday(db: D1Database, dataAsOf: string): Promise<IntradayRow[]> {
  if (!DAY_RE.test(dataAsOf)) return [];
  const res = await db.prepare(INTRADAY_SQL).bind(dataAsOf, MAX_ROWS).all<Record<string, unknown>>();
  return (res.results ?? []).flatMap((r) => {
    const row = toIntradayRow(r);
    return row ? [row] : [];
  });
}

// The last cut's time: when the newest run of the intraday workflow that
// went through ended (intraday_runs.at, UTC with seconds and a Z), the
// stamp of the same-day data a page shows (the sub-daily timer in
// src/refresh.tsx). Constant, nothing bound; a run that failed is left out,
// since its notices are not in.
export const LAST_CUT_SQL = "SELECT MAX(at) AS at FROM intraday_runs WHERE ok = 1";

// The stamp, or null for none, one that does not read, or a fault: a timer
// without it counts down as it did before stamps, so a fault is not logged
// on every request that asks.
export async function loadLastCut(db: D1Database): Promise<string | null> {
  try {
    const row = await db.prepare(LAST_CUT_SQL).first<Record<string, unknown>>();
    const at = row?.at;
    return typeof at === "string" && SEEN_RE.test(at) ? at : null;
  } catch {
    return null;
  }
}

// The band's rows: each notice at the newest version read, set against the
// list the nightly published (open). A reference that list does not hold is
// new; one it holds at a lower amendment is amended, and its version here
// takes the place of the listed one; one it holds at the same amendment or
// a higher one is already listed and left out. References compare in lower
// case, as the site's URLs do. Newest first, then by reference.
export function mergeIntraday(open: readonly TenderRow[], intraday: readonly IntradayRow[]): IntradayView[] {
  const listed = new Map<string, number>();
  for (const r of open) {
    const key = r.reference.toLowerCase();
    const have = listed.get(key);
    if (have === undefined || r.amendment > have) listed.set(key, r.amendment);
  }
  const newest = new Map<string, IntradayRow>();
  for (const r of intraday) {
    const key = r.reference.toLowerCase();
    const have = newest.get(key);
    if (!have || r.amendment > have.amendment) newest.set(key, r);
  }
  const out: IntradayView[] = [];
  for (const [key, r] of newest) {
    const have = listed.get(key);
    if (have === undefined) out.push({ ...r, intraday: "new" });
    else if (r.amendment > have) out.push({ ...r, intraday: "amended" });
  }
  return out.sort((a, b) =>
    a.seen_at !== b.seen_at ? (a.seen_at < b.seen_at ? 1 : -1) : a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0);
}
