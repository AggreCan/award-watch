// The records side of the watches (watches.ts keeps them, watch_mail.ts mails
// them, watch_pages.tsx shows them): the events the nightly sync writes to
// rec_events in the records database (pipeline records_db.derive_events, the
// rules in docs/analytics.md "Events"), read per subject and per day.
//
// Every statement is a constant here with ?N placeholders: DAY_SLOTS days
// (unused ones bound to "", which no day is) and TARGET_SLOTS subjects of one
// kind (unused ones bound to -1 or "", which no subject is), so a statement
// seeks each subject and day pair through the kind's index (rec_events_org,
// _buyer, _ref: the subject first) and reads nothing else; a buyer watch
// narrowed to a segment reads its own pair of statements, its buyer and
// segment bound. Each ends in a LIMIT. An account reads one batch: the state
// row and two statements per kind of watch it holds and per narrowed watch.
// The rows statement joins each standing offer or supply arrangement row
// (ref 'sosa:<agreement>') to its rec_instruments row through
// rec_instruments_agr, for the holders it counts now: one seek per row read,
// in the statement already read, so the count costs no statement of its own.

import { SEGMENT_CODES } from "../constants";
import { BUYER_ID_RE, ORG_ID_RE, REFERENCE_RE } from "../data";
import type { Env } from "../env";
import { STATE_SQL, orgIdOf, orgNumber } from "../records_db";
import { faultSummary } from "../search_db";
import type { RecordsWait } from "./records_deliveries";

// pipeline records_db.EVENT_KINDS holds the same list (test_records_events.py compares them).
export const EVENT_KINDS = [
  "award", "grant", "amended", "cancelled", "ends_12m", "ends_6m", "ended", "notice", "notice_amended", "notice_closed",
  "notice_cancelled", "notice_awarded", "instrument_gained", "instrument_lost", "instrument_expires_6m",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const isEventKind = (v: unknown): v is EventKind => typeof v === "string" && (EVENT_KINDS as readonly string[]).includes(v);

// The standing offers and supply arrangements an organization gains, no
// longer holds, or holds into the 6 months before their expiry.
export const INSTRUMENT_KINDS: readonly EventKind[] = ["instrument_gained", "instrument_lost", "instrument_expires_6m"];
export const isInstrumentKind = (k: EventKind): boolean => INSTRUMENT_KINDS.includes(k);
// An instrument event's ref: 'sosa:' and the agreement number as published.
export const INSTRUMENT_REF = "sosa:";

export const WATCH_KINDS = ["organization", "buyer", "contract", "tender"] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];
export const isWatchKind = (v: unknown): v is WatchKind => typeof v === "string" && (WATCH_KINDS as readonly string[]).includes(v);

// What each kind of watch can follow, in the order a message lists them. A
// buyer's label names no grants, as the records digest's rule already says.
// A watch made follows every kind of its own (watches.ts addWatch); a watch
// stored before a kind was added keeps its list until its reader ticks it.
export const KINDS_FOR: Readonly<Record<WatchKind, readonly EventKind[]>> = {
  organization: ["award", "grant", "amended", "cancelled", "ends_12m", "ends_6m", "ended", ...INSTRUMENT_KINDS],
  buyer: ["notice", "notice_amended", "award", "amended", "cancelled", "ends_12m", "ends_6m", "ended"],
  contract: ["amended", "cancelled", "ends_12m", "ends_6m", "ended"],
  tender: ["notice_amended", "notice_closed", "notice_cancelled", "notice_awarded"],
};

// The rec_events column a kind of watch is matched on, and its index.
const COLUMN: Readonly<Record<WatchKind, string>> = { organization: "oid", buyer: "buyer", contract: "ref", tender: "ref" };
export const INDEX_OF: Readonly<Record<WatchKind, string>> = {
  organization: "rec_events_org", buyer: "rec_events_buyer", contract: "rec_events_ref", tender: "rec_events_ref",
};

// The watches page reads 30 data dates; a message 7 at most (deliveries.ts SPAN_DAYS_MAX).
export const DAY_SLOTS = 30;
// One account's watches of one kind: the plans' ceiling (entitlements.ts WATCH_MAX).
export const TARGET_SLOTS = 25;
// The newest rows a watch lists of each kind; the rest are a count.
export const ROWS_PER_KIND = 10;
// A buyer watch not narrowed to a segment reports an amendment only when the
// value moved by at least this much or this share of the value before
// (organization, contract and narrowed buyer watches report every one).
export const EVENT_NOTABLE_CENTS = 10_000_000;
export const EVENT_NOTABLE_SHARE = 0.5;

const DAYS = Array.from({ length: DAY_SLOTS }, (_, i) => `?${i + 1}`).join(", ");
const TARGETS = Array.from({ length: TARGET_SLOTS }, (_, i) => `?${DAY_SLOTS + i + 1}`).join(", ");
const NOTABLE =
  ` AND (kind <> 'amended' OR cents IS NULL OR ocents IS NULL OR abs(cents - ocents) >= ${EVENT_NOTABLE_CENTS} ` +
  `OR abs(cents - ocents) >= ${EVENT_NOTABLE_SHARE} * abs(ocents))`;
const FIELDS = "day, kind, src, ref, cents, ocents, endd, oendd, closing, oclosing, namd, title, title_fr, other, other_fr, horizon, path";
const OUTER = FIELDS.split(", ").map((f) => `e.${f}`).join(", ");

// The newest ROWS_PER_KIND rows of each subject and kind on the days named;
// a count row (more) is left to the counts. An instrument's row carries its
// active holders (rec_instruments.n, persons withheld counted); any other
// row's ref names no instrument, so its holders are NULL.
const rowsSql = (col: string, where: string, slots: number) =>
  `SELECT ${OUTER}, e.t, i.n AS holders FROM (SELECT ${FIELDS}, ${col} AS t, ROW_NUMBER() OVER (PARTITION BY ${col}, kind ORDER BY day DESC, k) AS rn ` +
  `FROM rec_events WHERE ${where} AND more IS NULL) e ` +
  `LEFT JOIN rec_instruments i ON i.agr = CASE WHEN substr(e.ref, 1, ${INSTRUMENT_REF.length}) = '${INSTRUMENT_REF}' ` +
  `THEN substr(e.ref, ${INSTRUMENT_REF.length + 1}) END ` +
  `WHERE e.rn <= ${ROWS_PER_KIND} ORDER BY e.t, e.kind, e.rn LIMIT ${slots * EVENT_KINDS.length * ROWS_PER_KIND}`;

// How many each subject has of each kind on each day named (a count row
// counts the rows it stands for), so a watch counts its own days alone.
const countsSql = (col: string, where: string, slots: number) =>
  `SELECT ${col} AS t, kind, day, SUM(COALESCE(more, 1)) AS n FROM rec_events WHERE ${where} ` +
  `GROUP BY ${col}, kind, day ORDER BY t, kind, day LIMIT ${slots * EVENT_KINDS.length * DAY_SLOTS}`;

const whereOf = (kind: WatchKind) => `${COLUMN[kind]} IN (${TARGETS}) AND day IN (${DAYS})${kind === "buyer" ? NOTABLE : ""}`;
// A buyer narrowed to one segment: ?31 the buyer, ?32 the segment.
const NARROW = `buyer = ?${DAY_SLOTS + 1} AND sid = ?${DAY_SLOTS + 2} AND day IN (${DAYS})`;

export const EVENT_ROWS_SQL: Readonly<Record<WatchKind, string>> = {
  organization: rowsSql("oid", whereOf("organization"), TARGET_SLOTS), buyer: rowsSql("buyer", whereOf("buyer"), TARGET_SLOTS),
  contract: rowsSql("ref", whereOf("contract"), TARGET_SLOTS), tender: rowsSql("ref", whereOf("tender"), TARGET_SLOTS),
};
export const EVENT_COUNTS_SQL: Readonly<Record<WatchKind, string>> = {
  organization: countsSql("oid", whereOf("organization"), TARGET_SLOTS), buyer: countsSql("buyer", whereOf("buyer"), TARGET_SLOTS),
  contract: countsSql("ref", whereOf("contract"), TARGET_SLOTS), tender: countsSql("ref", whereOf("tender"), TARGET_SLOTS),
};
export const NARROW_ROWS_SQL = rowsSql("buyer", NARROW, 1);
export const NARROW_COUNTS_SQL = countsSql("buyer", NARROW, 1);

// The console's counts by kind for one data date (?1), through rec_events_day.
export const EVENT_DAY_SQL =
  `SELECT kind, COUNT(*) AS n, SUM(CASE WHEN more IS NULL THEN 0 ELSE 1 END) AS capped FROM rec_events WHERE day = ?1 ` +
  `GROUP BY kind ORDER BY kind LIMIT ${EVENT_KINDS.length}`;

// Every events statement, for the tests that read their plans and bounds.
export const WATCH_EVENTS_SQL: readonly string[] = [
  ...Object.values(EVENT_ROWS_SQL), ...Object.values(EVENT_COUNTS_SQL), NARROW_ROWS_SQL, NARROW_COUNTS_SQL,
];

// -- targets ---------------------------------------------------------------------------

// The longest reference a published contract's address takes (pages/published.tsx REF_MAX).
const CONTRACT_REF_MAX = 200;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

// A watch's target as its page names it, checked as the page checks it; null
// for anything else. A single record is its rec_events ref: 'award:<reference>',
// 'history:<reference>' (the URL form, in lower case) or
// 'contract:<department>:<reference>'; a tender notice 'tender:<reference>'.
export function targetOf(kind: WatchKind, raw: string): string | null {
  if (kind === "organization") return ORG_ID_RE.test(raw) ? raw : null;
  if (kind === "buyer") return BUYER_ID_RE.test(raw) && raw.length <= 80 ? raw : null;
  const at = raw.indexOf(":");
  const head = raw.slice(0, at);
  const rest = raw.slice(at + 1);
  if (kind === "tender") return head === "tender" && REFERENCE_RE.test(rest) ? `tender:${rest.toLowerCase()}` : null;
  if ((head === "award" || head === "history") && REFERENCE_RE.test(rest)) return `${head}:${rest.toLowerCase()}`;
  if (head !== "contract") return null;
  const cut = rest.indexOf(":");
  const dept = rest.slice(0, cut);
  const ref = rest.slice(cut + 1);
  if (cut <= 0 || !BUYER_ID_RE.test(dept) || dept.length > 80 || !ref || ref.length > CONTRACT_REF_MAX || CONTROL_RE.test(ref)) return null;
  return raw;
}

// A buyer watch's segment: '' for the whole buyer, else one of the 57 codes.
export const segmentOf = (raw: string | undefined): string | null => (!raw ? "" : SEGMENT_CODES.includes(raw) ? raw : null);

// The page a watch follows, as the site's links write it.
export function watchPath(kind: WatchKind, target: string): string {
  if (kind === "organization") return `/organizations/${target}`;
  if (kind === "buyer") return `/buyers/${target}`;
  const [head, ...rest] = target.split(":");
  if (head === "tender") return `/tenders/${rest.join(":")}`;
  if (head === "award") return `/awards/${rest.join(":")}`;
  if (head === "history") return `/history/${rest.join(":")}`;
  const ref = rest.slice(1).join(":");
  return `/contracts/${encodeURIComponent(rest[0])}/${encodeURIComponent(ref)}`;
}

const blank = (kind: WatchKind): number | string => (kind === "organization" ? -1 : "");

// -- reading ---------------------------------------------------------------------------------

export type EventRow = {
  day: string; kind: EventKind; src: number | null; ref: string; cents: number | null; ocents: number | null; endd: string | null;
  oendd: string | null; closing: string | null; oclosing: string | null; namd: number | null; title: string | null; title_fr: string | null;
  other: string | null; other_fr?: string | null; horizon: number | null; path: string;
  // An instrument's active holders now (rec_instruments.n); null for any other row.
  holders?: number | null;
  // The labels of the account's other watches the same event reached (watch_mail.ts).
  also?: string[];
};

// One watch's events on the days read: the newest rows of each kind, and the
// count of each kind on each day.
export type Found = { rows: EventRow[]; counts: Map<EventKind, Map<string, number>> };

export type EventsRead = { state: "ready"; asOf: string | null; found: Map<string, Found> } | { state: RecordsWait };

export type Subject = { kind: WatchKind; target: string; segment?: string };

// The key a watch's events are filed under.
export const foundKey = (w: Subject): string => `${w.kind}\n${w.target}\n${w.segment ?? ""}`;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// The events of up to TARGET_SLOTS watches of each kind on up to DAY_SLOTS
// days, in one batch with the state row; asOf is the database's data date.
// Nothing here throws.
export async function readEvents(env: Env, watches: readonly Subject[], days: readonly string[]): Promise<EventsRead> {
  const db = env.RECORDS;
  if (!db) return { state: "absent" };
  const dayBinds = Array.from({ length: DAY_SLOTS }, (_, i) => days[i] ?? "");
  type Plan = { rows: string; counts: string; binds: (number | string)[]; slot: (t: unknown) => Subject | null };
  const plans: Plan[] = [];
  for (const kind of WATCH_KINDS) {
    const own = watches.filter((w) => w.kind === kind && !w.segment).slice(0, TARGET_SLOTS);
    if (!own.length) continue;
    const bound = own.map((w) => (kind === "organization" ? orgNumber(w.target) : w.target)).filter((v) => v !== null) as (number | string)[];
    plans.push({
      rows: EVENT_ROWS_SQL[kind], counts: EVENT_COUNTS_SQL[kind],
      binds: [...dayBinds, ...Array.from({ length: TARGET_SLOTS }, (_, i) => bound[i] ?? blank(kind))],
      slot: (t) => {
        const target = kind === "organization" ? (num(t) === null ? null : orgIdOf(num(t)!)) : str(t);
        return target ? { kind, target } : null;
      },
    });
  }
  for (const w of watches.filter((x) => x.kind === "buyer" && x.segment).slice(0, TARGET_SLOTS)) {
    plans.push({ rows: NARROW_ROWS_SQL, counts: NARROW_COUNTS_SQL, binds: [...dayBinds, w.target, Number(w.segment)], slot: () => w });
  }
  let results: D1Result<Record<string, unknown>>[];
  try {
    results = await db.batch<Record<string, unknown>>([
      db.prepare(STATE_SQL),
      ...plans.flatMap((p) => [db.prepare(p.rows).bind(...p.binds), db.prepare(p.counts).bind(...p.binds)]),
    ]);
  } catch (e) {
    console.error(`[watches] records: query failed (${faultSummary(e)})`);
    return { state: "failed" };
  }
  const meta = new Map((results[0]?.results ?? []).map((r) => [String(r.key), String(r.value)]));
  if (meta.get("state") !== "ready") return { state: "loading" };
  const asOf = meta.get("as_of") ?? null;
  const found = new Map<string, Found>();
  const slot = (s: Subject | null): Found | null => {
    if (!s) return null;
    const key = foundKey(s);
    let f = found.get(key);
    if (!f) {
      f = { rows: [], counts: new Map() };
      found.set(key, f);
    }
    return f;
  };
  plans.forEach((p, i) => {
    for (const r of results[1 + 2 * i]?.results ?? []) {
      const f = slot(p.slot(r.t));
      const path = str(r.path);
      const day = str(r.day);
      const ref = str(r.ref);
      if (!f || !path || !ref || !day || !DAY_RE.test(day) || !isEventKind(r.kind)) continue;
      f.rows.push({
        day, kind: r.kind, src: num(r.src), ref, cents: num(r.cents), ocents: num(r.ocents), endd: str(r.endd), oendd: str(r.oendd),
        closing: str(r.closing), oclosing: str(r.oclosing), namd: num(r.namd), title: str(r.title), title_fr: str(r.title_fr),
        other: str(r.other), other_fr: str(r.other_fr), horizon: num(r.horizon), path, holders: num(r.holders),
      });
    }
    for (const r of results[2 + 2 * i]?.results ?? []) {
      const f = slot(p.slot(r.t));
      const day = str(r.day);
      const n = num(r.n);
      if (!f || !day || n === null || !isEventKind(r.kind)) continue;
      let byDay = f.counts.get(r.kind);
      if (!byDay) {
        byDay = new Map();
        f.counts.set(r.kind, byDay);
      }
      byDay.set(day, n);
    }
  });
  return { state: "ready", asOf: asOf && DAY_RE.test(asOf) ? asOf : null, found };
}

// A watch's events limited to the kinds it follows and the days given: per
// kind in the watch's order, the newest rows and how many in all.
export type Listed = { kind: EventKind; n: number; rows: EventRow[] }[];

export function listed(found: Found | undefined, follows: readonly EventKind[], kind: WatchKind, days: ReadonlySet<string>): Listed {
  if (!found) return [];
  const out: Listed = [];
  for (const k of KINDS_FOR[kind]) {
    if (!follows.includes(k)) continue;
    let n = 0;
    for (const [day, count] of found.counts.get(k) ?? []) if (days.has(day)) n += count;
    if (!n) continue;
    out.push({ kind: k, n, rows: found.rows.filter((r) => r.kind === k && days.has(r.day)) });
  }
  return out;
}

const CLOSING: readonly EventKind[] = ["notice_closed", "notice_cancelled"];

// The day a tender notice's closing (or cancellation) was found on, among the days read; null when none.
export function closedOn(found: Found | undefined): string | null {
  const days = CLOSING.flatMap((k) => [...(found?.counts.get(k)?.keys() ?? [])]).sort();
  return days.length ? days[days.length - 1] : null;
}

// The same event reached through two watches: its day, kind, page and figures,
// and the other party (an instrument's rows of one day differ by region there).
export const eventIdentity = (r: EventRow): string =>
  [r.day, r.kind, r.path, r.cents ?? "", r.endd ?? "", r.closing ?? "", r.other ?? ""].join("|");

// The console's view of the events: the records database's data date and,
// for it, the rows of each kind and the subjects past the per-day cap; null
// when the database cannot say.
export async function eventCounts(env: Env): Promise<{ asOf: string | null; byKind: { kind: string; n: number; capped: number }[] } | null> {
  const db = env.RECORDS;
  if (!db) return null;
  try {
    const meta = new Map(((await db.prepare(STATE_SQL).all<Record<string, unknown>>()).results ?? []).map((r) => [String(r.key), String(r.value)]));
    const asOf = meta.get("as_of") ?? null;
    if (meta.get("state") !== "ready" || !asOf || !DAY_RE.test(asOf)) return { asOf: null, byKind: [] };
    const rows = (await db.prepare(EVENT_DAY_SQL).bind(asOf).all<{ kind: string; n: number; capped: number }>()).results ?? [];
    return { asOf, byKind: rows };
  } catch (e) {
    console.error(`[watches] records: counts failed (${faultSummary(e)})`);
    return null;
  }
}
