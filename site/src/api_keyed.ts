// The keyed API under /api/v1: JSON for the API key of an account whose plan
// allows "api" (Pro). The open endpoints of src/api.ts stay as they are, with
// no key. The endpoint list, the page sizes and the limits are in
// src/api_keyed_spec.ts; the Data page's API section documents them
// (pages/keyed_api.tsx), and so does docs/accounts.md ("The keyed API").
//
// While the accounts switch is off every address here answers the open API's
// 404 and nothing is read: index.tsx mounts this sub-app after /api, whose
// middleware gives that 404 its headers, and the first middleware below
// returns it before requireApiKey (which would let the request through
// untouched while the switch is off).
//
// The checks run cheapest first: the per-address API cap (src/limits.ts,
// before any route, so a flood without a key meets it before anything is
// read), the key (requireApiKey: 401, 403, or 503 when the accounts database
// cannot say), the key's own rate limiter (KEY_LIMIT), then the day's count
// in api_usage (account/api_usage.ts). Only then does a route read anything.
//
// Every answer is for the key's holder alone, so it goes out private and
// no-store. Errors are {error} in English, as the open API's are.
//
// Bounds. A list answers PAGE_ROWS rows a page, page a whole number read
// strictly; a parameter an endpoint does not take, given twice when it takes
// one value, or with a value it cannot use is a 400 whose message names no
// value from the request. The free text is q: on /tenders/open at most
// OPEN_Q_MAX characters matched in memory against one file's rows, on
// /search folded by the hosted search to at most eight words of letters and
// digits (src/search_db.ts). The tender and radar endpoints read the static
// files the pages read; /search runs the hosted search's own statements; the
// two records endpoints run the constant statements below with ?N
// placeholders, ten fiscal years at most, through the records database's
// indexes (pipeline/records_schema.sql).

import { Hono, type Context, type MiddlewareHandler } from "hono";
import { KEY_RE, apiKeyOf, presentedKey, requireApiKey } from "./account/api_keys";
import { countRequest, nowOf, secondsToNextDay, utcDay } from "./account/api_usage";
import { allowed } from "./account/entitlements";
import { accountsEnabled } from "./account/switch";
import { withoutContacts } from "./api";
import { KEY_PER_DAY, KEY_PER_MINUTE, LIST_PAGES_MAX, OPEN_Q_MAX, PAGE_ROWS, RECORD_PAGES_MAX } from "./api_keyed_spec";
import { clockOf, closingPassed } from "./closing";
import { MONEY_SOURCES, PROVINCES, SEGMENT_CODES, type MoneySource } from "./constants";
import {
  BUYER_ID_RE, DAY_RE, EXPIRING_WINDOWS, type ExpiringWindow, type TenderRow, loadAlias, loadBuyerAlias, loadExpiringPage,
  loadExpiringWindow, loadNewTenders, loadOpenList, loadStats,
} from "./data";
import type { AppEnv } from "./env";
import { addDays, todayOf } from "./layout";
import { EXPIRING_PAGE_ROWS, soonestFirst } from "./pages/expiring";
import { CATEGORY_ORDER, CLOSING_WINDOWS, CODE_RE, NEW_DAYS, type TenderQuery, filterTenders } from "./pages/tenders";
import { DEEP_WINDOWS } from "./plan";
import { MAX_YEARS, SOURCE_NUMBER, dollars, fiscalYearOf, num, orgIdOf, orgNumber, readRecords, segmentCode } from "./records_db";
import { type BuyerHit, MAX_PAGE as SEARCH_PAGES_MAX, MAX_Q, type OrgHit, PAGE_SIZE as SEARCH_ROWS, runSearch, searchTerms } from "./search_db";

// -- the sub-app and its checks ------------------------------------------------------

type Ctx = Context<AppEnv>;

export const keyedApi = new Hono<AppEnv>();

keyedApi.use("*", async (c, next) => {
  if (!accountsEnabled(c.env)) return c.notFound();
  await next();
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Authorization, X-Api-Key");
});

keyedApi.use("*", requireApiKey("api"));

// The day's number of each counted request, for /me: null when the count
// could not be written.
const counted = new WeakMap<Request, number | null>();

const meter: MiddlewareHandler<AppEnv> = async (c, next) => {
  const holder = apiKeyOf(c);
  if (!holder) return next();
  // A limiter fault must never take the API down, as for the per-address caps.
  let within = true;
  try {
    if (c.env.KEY_LIMIT) within = (await c.env.KEY_LIMIT.limit({ key: `key:${holder.keyId}` })).success;
  } catch {
    within = true;
  }
  if (!within) {
    c.header("Retry-After", "60");
    return c.json({ error: `This key has made ${KEY_PER_MINUTE} requests in the last minute. Wait a minute and try again.` }, 429);
  }
  const now = nowOf(c.env);
  const n = await countRequest(c.env, holder.keyId, utcDay(now));
  if (n === "spent") {
    c.header("Retry-After", String(secondsToNextDay(now)));
    return c.json({ error: `This key has made its ${KEY_PER_DAY} requests for the day. The count starts again at 00:00 UTC.` }, 429);
  }
  counted.set(c.req.raw, n);
  await next();
};

keyedApi.use("*", meter);

// -- parameters ------------------------------------------------------------------------

type Param = { many?: true; ok: (v: string) => boolean; takes: string };
type Params = Record<string, string[]>;

// More values than any key has (57 segments), so a list stays bounded.
const MANY_MAX = 60;

const wholeIn = (max: number) => (v: string) => /^[1-9][0-9]{0,5}$/.test(v) && Number(v) <= max;
const pageParam = (max: number): Param => ({ ok: wholeIn(max), takes: `a whole number from 1 to ${max}` });
// Printable text up to max characters.
const textUpTo = (max: number) => (v: string) => v.length >= 1 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);

// The parameters the request gives, every one checked, or the 400's message.
// lang is the site's own (its middleware reads it) and is passed over.
export function readParams(url: URL, spec: Record<string, Param>): Params | string {
  const out: Params = {};
  for (const name of new Set(url.searchParams.keys())) {
    if (name === "lang") continue;
    const p = Object.hasOwn(spec, name) ? spec[name] : undefined;
    if (!p) {
      const names = Object.keys(spec);
      return names.length ? `unknown parameter; this endpoint takes ${names.join(", ")}` : "this endpoint takes no parameter";
    }
    const values = url.searchParams.getAll(name).map((v) => v.trim());
    if (!p.many && values.length > 1) return `${name}: give it once`;
    if (values.length > MANY_MAX) return `${name}: at most ${MANY_MAX} values`;
    if (!values.every(p.ok)) return `${name}: ${p.takes}`;
    out[name] = values;
  }
  return out;
}

const one = (p: Params, name: string): string | undefined => p[name]?.[0];
const bad = (c: Ctx, error: string) => c.json({ error }, 400);
const notFound = (c: Ctx, error = "not found") => c.json({ error }, 404);
const unpublished = (c: Ctx) => c.json({ error: "not published yet" }, 503);
const pageNumber = (p: Params) => Number(one(p, "page") ?? "1");

// One page of a list, or null when the page is past the last (page 1 of an
// empty list is an empty page).
export function pageOf<T>(rows: readonly T[], page: number): { total: number; page: number; pages: number; per_page: number; rows: T[] } | null {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_ROWS));
  if (page > pages) return null;
  return { total: rows.length, page, pages, per_page: PAGE_ROWS, rows: rows.slice((page - 1) * PAGE_ROWS, page * PAGE_ROWS) };
}

// -- tenders ---------------------------------------------------------------------------

const upperIn = (list: readonly string[]) => (v: string) => list.includes(v.toUpperCase());

// The /tenders page's filters.
export const OPEN_PARAMS: Record<string, Param> = {
  category: { many: true, ok: upperIn(CATEGORY_ORDER), takes: `one of ${CATEGORY_ORDER.join(", ")}` },
  segment: { many: true, ok: (v) => SEGMENT_CODES.includes(v), takes: "a two-digit UNSPSC segment" },
  province: { many: true, ok: upperIn(PROVINCES), takes: `a province or territory code (${PROVINCES.join(", ")})` },
  national: { ok: (v) => v === "0" || v === "1", takes: "0 or 1" },
  derived: { ok: (v) => v === "0" || v === "1", takes: "0 or 1" },
  code: { ok: (v) => CODE_RE.test(v), takes: "2 to 8 digits of a UNSPSC code" },
  buyer: { ok: (v) => BUYER_ID_RE.test(v) && v.length <= 80, takes: "a buyer id, as in /buyers/{id}" },
  type: { ok: textUpTo(200), takes: "a notice type as published in English, at most 200 characters" },
  method: { ok: textUpTo(200), takes: "a procurement method as published in English, at most 200 characters" },
  closing: { ok: (v) => (CLOSING_WINDOWS as readonly string[]).includes(v), takes: CLOSING_WINDOWS.join(" or ") },
  q: { ok: textUpTo(OPEN_Q_MAX), takes: `words to look for, at most ${OPEN_Q_MAX} characters` },
  sort: { ok: (v) => v === "closing" || v === "published", takes: "closing or published" },
  page: pageParam(LIST_PAGES_MAX),
};

function openQuery(p: Params): TenderQuery {
  const asked = (k: string) => new Set((p[k] ?? []).map((v) => v.toUpperCase()));
  const category = asked("category");
  const segment = asked("segment");
  const province = asked("province");
  return {
    q: one(p, "q") ?? "",
    category: CATEGORY_ORDER.filter((v) => category.has(v)),
    segment: SEGMENT_CODES.filter((v) => segment.has(v)),
    code: one(p, "code") ?? "",
    province: PROVINCES.filter((v) => province.has(v)),
    national: one(p, "national") !== "0",
    derived: one(p, "derived") !== "0",
    buyer: one(p, "buyer") ?? "",
    type: one(p, "type") ?? "",
    method: one(p, "method") ?? "",
    closing: one(p, "closing") ?? "",
    sort: one(p, "sort") === "published" ? "published" : "closing",
    page: pageNumber(p),
  };
}

// The government contact on a notice is never exported; should a file carry
// it anyway, the keyed API leaves it out as the open one does.
const listRows = (rows: readonly TenderRow[]) => rows.map((r) => withoutContacts(r));

keyedApi.get("/tenders/open", async (c) => {
  const p = readParams(new URL(c.req.url), OPEN_PARAMS);
  if (typeof p === "string") return bad(c, p);
  const [stats, rows] = await Promise.all([loadStats(c.env), loadOpenList(c.env)]);
  if (!stats || !rows) return unpublished(c);
  const page = pageOf(filterTenders(rows, openQuery(p), clockOf(c.env)), pageNumber(p));
  if (!page) return notFound(c, "page past the last");
  return c.json({ data_as_of: stats.data_as_of, ...page, rows: listRows(page.rows) });
});

// A day of the last NEW_DAYS, the newest by default, as /tenders/new offers.
const NEW_PARAMS: Record<string, Param> = {
  day: { ok: (v) => DAY_RE.test(v), takes: "a date as YYYY-MM-DD" },
  page: pageParam(LIST_PAGES_MAX),
};

keyedApi.get("/tenders/new", async (c) => {
  const p = readParams(new URL(c.req.url), NEW_PARAMS);
  if (typeof p === "string") return bad(c, p);
  const stats = await loadStats(c.env);
  if (!stats) return unpublished(c);
  const latest = todayOf(stats.data_as_of);
  const day = one(p, "day") ?? latest;
  if (day > latest || day <= addDays(latest, -NEW_DAYS)) return notFound(c, `day: one of the ${NEW_DAYS} days to the data date`);
  const loaded = await loadNewTenders(c.env, day);
  if (!loaded) return notFound(c, "no file for that day");
  // As the page orders them: a notice whose closing has passed goes last.
  const clock = clockOf(c.env);
  const passed = (r: TenderRow) => r.status === "closed" || (r.status === "open" && closingPassed(r.closing, clock));
  const page = pageOf([...loaded.filter((r) => !passed(r)), ...loaded.filter(passed)], pageNumber(p));
  if (!page) return notFound(c, "page past the last");
  return c.json({ data_as_of: stats.data_as_of, day, ...page, rows: listRows(page.rows) });
});

// -- the radar ---------------------------------------------------------------------------

// A window is published in files of EXPIRING_PAGE_ROWS rows, soonest end
// first, so a page of PAGE_ROWS lies inside one file and a request reads one.
// The deeper windows are radar_depth's, which Pro holds with the API; the
// check stands in case a plan ever holds one without the other.
keyedApi.get("/expiring/:window", async (c) => {
  const window = c.req.param("window") ?? "";
  if (!(EXPIRING_WINDOWS as readonly string[]).includes(window)) return notFound(c);
  const p = readParams(new URL(c.req.url), { page: pageParam(LIST_PAGES_MAX) });
  if (typeof p === "string") return bad(c, p);
  const holder = apiKeyOf(c);
  if ((DEEP_WINDOWS as readonly string[]).includes(window) && holder && !allowed(holder, "radar_depth")) {
    return c.json({ error: "the plan of the key's account does not include this window" }, 403);
  }
  const [stats, idx] = await Promise.all([loadStats(c.env), loadExpiringWindow(c.env, window)]);
  if (!stats || !idx) return unpublished(c);
  const n = pageNumber(p);
  const pages = Math.max(1, Math.ceil(idx.rows / PAGE_ROWS));
  if (n > pages) return notFound(c, "page past the last");
  const start = (n - 1) * PAGE_ROWS;
  const file = idx.rows === 0 ? [] : await loadExpiringPage(c.env, window, Math.floor(start / EXPIRING_PAGE_ROWS) + 1);
  if (!file) return unpublished(c);
  const at = start % EXPIRING_PAGE_ROWS;
  return c.json({
    data_as_of: stats.data_as_of, window: window as ExpiringWindow, total: idx.rows, value_total: idx.total, page: n, pages,
    per_page: PAGE_ROWS, rows: soonestFirst(file).slice(at, at + PAGE_ROWS),
  });
});

// -- the hosted search ---------------------------------------------------------------------

const SEARCH_PARAMS: Record<string, Param> = {
  q: { ok: textUpTo(MAX_Q), takes: `words to look for, at most ${MAX_Q} characters (required)` },
  page: pageParam(SEARCH_PAGES_MAX),
};

// The hit without its ranking tier, which orders the list and means nothing outside it.
const orgOut = ({ tier: _tier, ...hit }: OrgHit) => hit;
const buyerOut = ({ tier: _tier, ...hit }: BuyerHit) => hit;

keyedApi.get("/search", async (c) => {
  const p = readParams(new URL(c.req.url), SEARCH_PARAMS);
  if (typeof p === "string") return bad(c, p);
  const terms = searchTerms(one(p, "q") ?? "");
  if (!terms.terms.length) return bad(c, "q: at least one word of letters or digits (required)");
  const wanted = pageNumber(p);
  const res = await runSearch(c.env, terms, wanted);
  if (!res) {
    c.header("Retry-After", "300");
    return c.json({ error: "the search is not available just now" }, 503);
  }
  // runSearch shows the last page for one past it; the API says so instead.
  if (res.page !== wanted) return notFound(c, "page past the last");
  return c.json({
    q: terms.folded, page: res.page, pages: res.pages, per_page: SEARCH_ROWS,
    organizations: { total: res.orgTotal, rows: res.orgs.map(orgOut) },
    // The buyers are a short list, on the first page only, as on /search.
    buyers: { total: res.buyerTotal, rows: res.buyers.map(buyerOut) },
  });
});

// -- the records database --------------------------------------------------------------------

// A buyer's records: ?1 the buyer id, ?2 the source, ?3 and ?4 the first and
// last fiscal years, ?5 the offset. One row more than a page, to tell whether
// another page follows. Through records_buyer (bid, src, fy), whose entries
// end in the rowid k, so the order needs no sort; k orders the records within
// a fiscal year and is never sent. extra = 0: a notice's further segments
// are not records of their own.
export const BUYER_RECORDS_SQL =
  "SELECT r.fy AS fy, r.fq AS fq, r.oid AS oid, o.name AS org_name, r.sid AS sid, r.cents AS cents, r.vnote AS vnote, " +
  "r.comp AS comp, r.meth AS meth FROM records r LEFT JOIN rec_orgs o ON o.oid = r.oid " +
  "WHERE r.bid = (SELECT bid FROM rec_buyers WHERE id = ?1) AND r.src = ?2 AND r.fy BETWEEN ?3 AND ?4 AND r.extra = 0 " +
  `ORDER BY r.fy DESC, r.k DESC LIMIT ${PAGE_ROWS + 1} OFFSET ?5`;

// An organization's records: ?1 its number, then as above, through records_org.
export const ORG_RECORDS_SQL =
  "SELECT r.fy AS fy, r.fq AS fq, b.id AS buyer_id, b.name_en AS buyer_en, b.name_fr AS buyer_fr, r.sid AS sid, r.cents AS cents, " +
  "r.vnote AS vnote, r.comp AS comp, r.meth AS meth FROM records r LEFT JOIN rec_buyers b ON b.bid = r.bid " +
  "WHERE r.oid = ?1 AND r.src = ?2 AND r.fy BETWEEN ?3 AND ?4 AND r.extra = 0 " +
  `ORDER BY r.fy DESC, r.k DESC LIMIT ${PAGE_ROWS + 1} OFFSET ?5`;

// Whether the database names the buyer or the organization at all: one row
// through a unique key, so an id with no record is a 404, not an empty list.
export const BUYER_KNOWN_SQL = "SELECT 1 AS n FROM rec_buyers WHERE id = ?1 LIMIT 1";
export const ORG_KNOWN_SQL = "SELECT 1 AS n FROM rec_orgs WHERE oid = ?1 LIMIT 1";

// Every records statement of this file, for the tests that read their plans and bounds.
export const KEYED_RECORDS_SQL: readonly string[] = [BUYER_RECORDS_SQL, ORG_RECORDS_SQL, BUYER_KNOWN_SQL, ORG_KNOWN_SQL];

// records.vnote, in words.
const VALUE_NOTE = ["counted", "not_published", "other_currency", "flagged"] as const;

type RecordRow = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

function recordOut(r: RecordRow, kind: "buyer" | "organization") {
  const sid = num(r.sid);
  const comp = num(r.comp);
  const oid = num(r.oid);
  const common = {
    fiscal_year: num(r.fy), fiscal_quarter: num(r.fq), segment: sid === null ? null : segmentCode(sid), value: dollars(r.cents),
    value_note: VALUE_NOTE[num(r.vnote) ?? 0] ?? "counted", competitive: comp === null ? null : comp === 1, method: text(r.meth),
  };
  return kind === "buyer"
    ? { ...common, organization: oid === null ? null : { id: orgIdOf(oid), name: text(r.org_name) } }
    : { ...common, buyer: text(r.buyer_id) === null ? null : { id: text(r.buyer_id), name_en: text(r.buyer_en), name_fr: text(r.buyer_fr) } };
}

function recordsRoute(kind: "buyer" | "organization") {
  return async (c: Ctx) => {
    const id = c.req.param("id") ?? "";
    const key = kind === "buyer" ? (BUYER_ID_RE.test(id) && id.length <= 80 ? id : null) : orgNumber(id);
    if (key === null) return notFound(c);
    const stats = await loadStats(c.env);
    if (!stats) return unpublished(c);
    // The ten fiscal years ending with the data date's, as the analytics views read them.
    const last = fiscalYearOf(todayOf(stats.data_as_of));
    const first = last - MAX_YEARS + 1;
    const p = readParams(new URL(c.req.url), {
      source: { ok: (v) => (MONEY_SOURCES as readonly string[]).includes(v), takes: `one of ${MONEY_SOURCES.join(", ")} (required)` },
      year: {
        ok: (v) => /^[0-9]{4}$/.test(v) && Number(v) >= first && Number(v) <= last,
        takes: `a fiscal year from ${first} to ${last}, by the year it starts in`,
      },
      page: pageParam(RECORD_PAGES_MAX),
    });
    if (typeof p === "string") return bad(c, p);
    const source = one(p, "source") as MoneySource | undefined;
    if (!source) return bad(c, `source: one of ${MONEY_SOURCES.join(", ")} (required)`);
    const year = one(p, "year");
    const from = year ? Number(year) : first;
    const to = year ? Number(year) : last;
    const page = pageNumber(p);
    const read = await readRecords(c.env, [
      { sql: kind === "buyer" ? BUYER_KNOWN_SQL : ORG_KNOWN_SQL, params: [key] },
      { sql: kind === "buyer" ? BUYER_RECORDS_SQL : ORG_RECORDS_SQL, params: [key, SOURCE_NUMBER[source], from, to, (page - 1) * PAGE_ROWS] },
    ]);
    if (read.state !== "ready") {
      c.header("Retry-After", "300");
      return c.json({ error: read.state === "loading" ? "the records database is being loaded" : "the records database could not be read" }, 503);
    }
    const [known, rows] = read.rows;
    if (!known?.length) {
      // A retired id moves to the one that took its records, as the open API's profiles do.
      const moved = kind === "buyer" ? await loadBuyerAlias(c.env, id) : await loadAlias(c.env, id);
      if (moved) return c.redirect(`/api/v1/${kind === "buyer" ? "buyers" : "organizations"}/${moved}/records${new URL(c.req.url).search}`, 301);
      return notFound(c);
    }
    if (page > 1 && !rows?.length) return notFound(c, "page past the last");
    const more = (rows?.length ?? 0) > PAGE_ROWS;
    return c.json({
      [kind]: id, source, fiscal_years: { from, to }, data_as_of: read.asOf, page, per_page: PAGE_ROWS,
      next_page: more && page < RECORD_PAGES_MAX ? page + 1 : null,
      rows: (rows ?? []).slice(0, PAGE_ROWS).map((r) => recordOut(r, kind)),
    });
  };
}

keyedApi.get("/organizations/:id/records", recordsRoute("organization"));
keyedApi.get("/buyers/:id/records", recordsRoute("buyer"));

// -- the key itself ---------------------------------------------------------------------------

keyedApi.get("/me", (c) => {
  const p = readParams(new URL(c.req.url), {});
  if (typeof p === "string") return bad(c, p);
  const holder = apiKeyOf(c)!;
  const n = counted.get(c.req.raw) ?? null;
  const prefix = KEY_RE.exec(presentedKey(c.req.raw.headers) ?? "")?.[1];
  return c.json({
    key: prefix ? `aw_${prefix}` : null,
    plan: holder.plan,
    plan_until: holder.planUntil,
    // The day's count, this request included; null when it could not be written.
    usage: { day: utcDay(nowOf(c.env)), requests: n, remaining: n === null ? null : Math.max(0, KEY_PER_DAY - n) },
    limits: { per_minute: KEY_PER_MINUTE, per_day: KEY_PER_DAY },
  });
});
