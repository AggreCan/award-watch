// An analytics view's address (docs/analytics.md): how a view reads its
// source, its period and its choices from the address, and how it writes them
// back. pages/analytics.tsx draws every view from these, and a view saved to
// an account (account/saved_views.ts) is checked by the same two halves: the
// address is read as the view reads it and written again as the view writes
// it, and only an address that comes back unchanged is kept. So a saved view
// is always an address a view itself writes, in its one form.
//
// Nothing here reads a request, a file or a database.

import { MONEY_SOURCES, type MoneySource } from "./constants";
import { BUYER_ID_RE, ORG_ID_RE, SEGMENT_RE } from "./data";
import {
  EARLIEST_FY, FREE_YEARS, MAX_RIVALS, PERIODS, SEGMENT_SOURCES, ULTRA_YEARS, choosePeriod, orgNumber, segmentCode, segmentNumber,
} from "./records_db";

export type View = "buyer" | "organization" | "segment";

// The period a view opens on when the address names none, on every plan.
export const DEFAULT_YEARS = 10;

export interface Frame {
  source: MoneySource;
  years: number;
  first: number;
  last: number;
  // The fiscal year the data date falls in, counted to date.
  current: number;
  // The period was chosen by its first and last fiscal year (?from, ?to)
  // rather than as the latest n, and capped: it was longer than the reader's
  // plan gives (most, records_db.ts planYears), so its latest most are shown.
  custom: boolean;
  capped: boolean;
  // The free view was asked for something it does not give (a longer period,
  // a segment or organizations to compare), and says so.
  asked: boolean;
  // The fiscal years the reader's plan shows at once (planYears).
  most: number;
  // The address asked for a period longer than the plan gives that Ultra
  // gives (ULTRA_YEARS); the view says so while Ultra is on sale.
  longer: boolean;
}

// The view's frame from its address: the source (the fallback when the
// address names none the view allows), the current fiscal year, whether the
// reader has the paid view (pro), and most, the fiscal years the reader's
// plan shows at once; a period longer than that reads as the plan's own, the
// latest most years. A value the view cannot use reads as the default.
export function frameOf(
  url: URL, o: { current: number; pro: boolean; allowed: readonly MoneySource[]; fallback: MoneySource; most: number },
): Frame {
  const { current, pro, most } = o;
  const raw = (url.searchParams.get("source") ?? "").trim().toLowerCase();
  const source = (o.allowed as readonly string[]).includes(raw) ? (raw as MoneySource) : o.fallback;
  const latest = (years: number): Frame => ({
    source, years, first: current - years + 1, last: current, current, custom: false, capped: false, asked: false, most, longer: false,
  });
  const asked = Number(url.searchParams.get("years"));
  // Ultra's period asked by a plan that does not give it.
  const ultraAsked = asked === ULTRA_YEARS && most < ULTRA_YEARS;
  if (!pro) {
    const extra = ["years", "from", "to", "segment", "vs"].some((k) => url.searchParams.has(k));
    return { ...latest(FREE_YEARS), asked: extra, longer: ultraAsked };
  }
  const chosen = choosePeriod(url.searchParams.get("from"), url.searchParams.get("to"), current, most);
  if (chosen) {
    return {
      ...latest(chosen.last - chosen.first + 1), first: chosen.first, last: chosen.last, custom: true, capped: chosen.capped,
      longer: chosen.capped && most < ULTRA_YEARS,
    };
  }
  const years = (PERIODS as readonly number[]).includes(asked) ? Math.min(asked, most) : DEFAULT_YEARS;
  return { ...latest(years), longer: ultraAsked };
}

// A view's address: the source, then the period as the reader chose it
// (the latest n fiscal years, or the first and last one), then the rest.
export type Link = Pick<Frame, "source" | "years" | "first" | "last" | "custom">;
export type More = Record<string, string | readonly string[]>;

export function viewQuery(base: string, f: Link, more: More = {}): string {
  const p = new URLSearchParams({ source: f.source });
  if (f.custom) {
    p.set("from", String(f.first));
    p.set("to", String(f.last));
  } else {
    p.set("years", String(f.years));
  }
  for (const [k, v] of Object.entries(more)) for (const one of typeof v === "string" ? [v] : v) p.append(k, one);
  return `${base}?${p.toString()}`;
}

// The organizations to compare on a profile: up to MAX_RIVALS valid ids, each
// once, never the profile's own.
export function rivalsOf(url: URL, self: string): string[] {
  const out: string[] = [];
  for (const v of url.searchParams.getAll("vs")) {
    const id = v.trim().toLowerCase();
    if (ORG_ID_RE.test(id) && id !== self && !out.includes(id)) out.push(id);
    if (out.length === MAX_RIVALS) break;
  }
  return out;
}

// The share chart's segment as the address names it: one of the 57, or null.
export function shareSegmentOf(url: URL): number | null {
  const raw = (url.searchParams.get("segment") ?? "").trim();
  return SEGMENT_RE.test(raw) ? segmentNumber(raw) : null;
}

// What an organization's paid view writes after its period: the share
// chart's segment (the one asked for, or the one the view settled on) and the
// organizations it compares; nothing while it has no segment.
export function orgMore(segment: number | null, rivals: readonly string[]): More {
  return segment !== null ? { segment: segmentCode(segment), vs: rivals } : {};
}

// -- a view as an address ------------------------------------------------------------

const VIEW_BASE: Readonly<Record<View, string>> = { buyer: "buyers", organization: "organizations", segment: "segments" };
const VIEW_OF: Readonly<Record<string, View>> = { buyers: "buyer", organizations: "organization", segments: "segment" };

export const viewBase = (kind: View, id: string): string => `/${VIEW_BASE[kind]}/${id}/analytics`;

// The sources a view offers: a segment's carry UNSPSC codes only.
export const viewSources = (kind: View): readonly MoneySource[] => (kind === "segment" ? SEGMENT_SOURCES : MONEY_SOURCES);

// The longest address a saved view keeps (accounts_schema.sql saved_views.address).
export const VIEW_ADDRESS_MAX = 2000;

const PATH_RE = /^\/(buyers|organizations|segments)\/([^/]{1,80})\/analytics$/;

// The id each kind of view is served under, checked as the view checks it.
function idHolds(kind: View, id: string): boolean {
  if (kind === "buyer") return BUYER_ID_RE.test(id) && id.length <= 80;
  if (kind === "organization") return orgNumber(id) !== null;
  return SEGMENT_RE.test(id) && segmentNumber(id) !== null;
}

// The view an address names and the address read as a URL: a path on the
// site to one of the three views of an id the view serves, no fragment, no
// longer than VIEW_ADDRESS_MAX; null for anything else.
export function viewOf(raw: string): { kind: View; id: string; url: URL } | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.length > VIEW_ADDRESS_MAX) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://view.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "https://view.invalid" || url.hash) return null;
  const m = PATH_RE.exec(url.pathname);
  if (!m) return null;
  const kind = VIEW_OF[m[1]];
  const id = m[2];
  return kind && idHolds(kind, id) ? { kind, id, url } : null;
}

// The paid view's frame of an address, at a data date's fiscal year
// (current) for a plan showing `most` fiscal years, as the view reads it.
export function viewFrame(kind: View, url: URL, current: number, most: number): Frame {
  const allowed = viewSources(kind);
  return frameOf(url, { current, pro: true, allowed, fallback: allowed[0], most });
}

export type ViewAddress = { kind: View; id: string; frame: Frame; address: string };

// raw read as the paid view reads its address (viewFrame), then written as
// the view writes it: the view, its id and its frame when the two are the
// same string, null for anything else (another path, a key the view does not
// write, a value it would read otherwise, another order, a period longer than
// the plan shows).
export function readViewAddress(raw: string, o: { current: number; most: number }): ViewAddress | null {
  const v = viewOf(raw);
  if (!v) return null;
  const frame = viewFrame(v.kind, v.url, o.current, o.most);
  if (frame.first < EARLIEST_FY) return null;
  const more = v.kind === "organization" ? orgMore(shareSegmentOf(v.url), rivalsOf(v.url, v.id)) : {};
  const address = viewQuery(viewBase(v.kind, v.id), frame, more);
  return address === raw ? { kind: v.kind, id: v.id, frame, address } : null;
}
