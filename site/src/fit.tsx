// Matching notices on the site's pages (docs/accounts.md, Matching notices).
// public/fit.js holds the rules and the points, one copy for the Worker and
// the browser; the pipeline's profile_matching.py writes the block they read
// on each profile. Here: the block read off a profile and checked, the
// window stats.json says the night's export counted, a notice's page read as
// the rules read a list row, the words of a band and
// of each reason, and FitDisclaimer, the line every surface that shows a
// match carries. A band names the match between a notice and records, never
// the business, and a reason states record counts, each source apart.

import type { FC } from "hono/jsx";
import { type FitNotice, type MatchBlock, type Reason, type Score, MATCH_MAX } from "../public/fit.js";
import { PROVINCES, SEGMENT_CODES } from "./constants";
import { BUYER_ID_RE, type CodeLevel, DAY_RE, type TenderDetail } from "./data";
import { fmtInt, pick, provinceName, segmentLabel, t, tj, tn, type Key, type Lang } from "./i18n";
import { isObj, isStr } from "./valid";

export type { MatchBlock, Reason, Score };

// -- the block --------------------------------------------------------------------

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isYear = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 2000 && v <= 2200;
const isDigits = (n: number) => (v: unknown): boolean => isStr(v) && v.length === n && /^[0-9]+$/.test(v);
const isSegment = (v: unknown): boolean => isStr(v) && SEGMENT_CODES.includes(v);
const isProvince = (v: unknown): boolean => isStr(v) && (PROVINCES as readonly string[]).includes(v);
const isBuyer = (v: unknown): boolean => isStr(v) && v.length <= 80 && BUYER_ID_RE.test(v);
const isType = (v: unknown): boolean => isStr(v) && v.trim() !== "" && v.length <= 200;
const isTypeCode = (v: unknown): boolean => isStr(v) && /^[A-Z]{2,8}$/.test(v);

// A list of [key, count...] rows; the bound only stops a runaway file (the
// export writes 40 classes at most, and 57 segments).
const LIST_MAX = 100;
const isRows = (v: unknown, key: (k: unknown) => boolean, counts: number): boolean =>
  Array.isArray(v) && v.length <= LIST_MAX &&
  v.every((r) => Array.isArray(r) && r.length === counts + 1 && key(r[0]) && r.slice(1).every(isCount));
const isCounts = (v: unknown, n: number): boolean => Array.isArray(v) && v.length === n && v.every(isCount);

// The profile's block, or null: absent from an export written before it and
// from a profile with nothing in the window, and any block that does not
// read in full is refused rather than scored in part.
export function profileMatching(profile: unknown): MatchBlock | null {
  const v = isObj(profile) ? profile.matching : undefined;
  if (!isObj(v)) return null;
  const ok = Array.isArray(v.fy) && v.fy.length === 2 && isYear(v.fy[0]) && isYear(v.fy[1]) && v.fy[0] <= v.fy[1] &&
    isCounts(v.n, 3) && isCounts(v.coded, 2) && (v.newest === null || (isStr(v.newest) && DAY_RE.test(v.newest))) &&
    isRows(v.classes, isDigits(6), 2) && isRows(v.families, isDigits(4), 2) && isRows(v.segments, isSegment, 2) &&
    isRows(v.buyers, isBuyer, 3) && isRows(v.provinces, isProvince, 2) && isRows(v.types, isType, 2) &&
    Array.isArray(v.held) && v.held.length <= LIST_MAX &&
    v.held.every((r: unknown) => Array.isArray(r) && r.length === 3 && isTypeCode(r[0]) && isSegment(r[1]) && isCount(r[2]));
  return ok ? (v as MatchBlock) : null;
}

// The fiscal years the night's export counted (stats.json matching_fy), or
// null when the export predates the blocks: a profile without one then says
// nothing yet, rather than that its organization has nothing.
export function matchingWindow(stats: { matching_fy?: unknown } | null | undefined): [number, number] | null {
  const v = stats?.matching_fy;
  return Array.isArray(v) && v.length === 2 && isYear(v[0]) && isYear(v[1]) && v[0] <= v[1] ? [v[0], v[1]] : null;
}

// A notice's page as the rules read a list row: its codes, and its segments
// as the export derives a row's (the first two digits of each code, within
// the 57), so the page scores the notice as /account/matches does.
export function detailNotice(d: TenderDetail): FitNotice {
  const codes = d.codes.map((c) => c.code);
  return {
    codes, segments: [...new Set(codes.map((c) => c.slice(0, 2)).filter((s) => SEGMENT_CODES.includes(s)))].sort(),
    provinces: d.provinces, provinces_derived: d.provinces_derived ?? null, buyer_id: d.buyer_id, notice_type_en: d.notice_type_en,
  };
}

// -- the words ----------------------------------------------------------------------

// Each source's count, as the weekly block of the watch mail writes them:
// the block's count lists are [awards, history] or [awards, history,
// contracts]. A source with none is left out; when every one is zero, the
// first is named with its zero.
const SOURCE_COUNTS: readonly (readonly [Key, Key])[] = [
  ["orgclaim.week_awards_one", "orgclaim.week_awards_many"],
  ["orgclaim.week_history_one", "orgclaim.week_history_many"],
  ["orgclaim.week_contracts_one", "orgclaim.week_contracts_many"],
];

export function countsText(lang: Lang, counts: readonly number[]): string {
  const part = (n: number, i: number) => tn(lang, SOURCE_COUNTS[i][0], SOURCE_COUNTS[i][1], n, { n: fmtInt(n, lang) });
  const parts = counts.slice(0, SOURCE_COUNTS.length).map((n, i) => (n > 0 ? part(n, i) : null)).filter((s): s is string => s !== null);
  return parts.length ? parts.join(", ") : part(0, 0);
}

// A UNSPSC level with its name: a segment's title, or a family's or class's
// name as the open notices give it (tenders/open-levels.json); the code alone
// when no notice named it.
export function levelText(lang: Lang, code: string, levels: readonly CodeLevel[] | null): string {
  if (code.length === 2) return SEGMENT_CODES.includes(code) ? `${code} ${segmentLabel(lang, code)}` : code;
  const level = levels?.find((l) => l.code === code);
  const name = level ? pick(lang, level.en, level.fr) : null;
  return name ? `${code} ${name}` : code;
}

// What a reason's words need beyond the reason: the organization's name and
// the notice's own buyer and type names.
export type ReasonContext = {
  name: string;
  notice: { buyer_en?: string | null; buyer_fr?: string | null; notice_type_en?: string | null; notice_type_fr?: string | null };
  levels: readonly CodeLevel[] | null;
};

export function reasonText(lang: Lang, r: Reason, ctx: ReasonContext): string {
  const counts = () => countsText(lang, r.counts);
  switch (r.kind) {
    case "class":
    case "family":
    case "segment":
      return t(lang, `fit.r_${r.kind}`, { code: levelText(lang, r.key ?? "", ctx.levels), counts: counts() });
    case "buyer":
      return t(lang, "fit.r_buyer", { buyer: pick(lang, ctx.notice.buyer_en, ctx.notice.buyer_fr) ?? r.key ?? "", counts: counts() });
    case "delivered":
      return t(lang, "fit.r_delivered", { province: provinceName(lang, r.key ?? ""), counts: counts() });
    case "home":
      return t(lang, "fit.r_home", { province: provinceName(lang, r.key ?? ""), name: ctx.name });
    case "national":
      return t(lang, "fit.r_national");
    case "held":
      return t(lang, "fit.r_held", { code: levelText(lang, r.key ?? "", null), n: fmtInt(r.counts[0] ?? 0, lang) });
    case "type":
      return t(lang, "fit.r_type", { type: pick(lang, ctx.notice.notice_type_en, ctx.notice.notice_type_fr) ?? r.key ?? "", counts: counts() });
  }
}

const BAND_KEY: Readonly<Record<Score["band"], Key>> = {
  close: "fit.band_close", partial: "fit.band_partial", weak: "fit.band_weak", none: "fit.band_none",
};

// The band's word alone, for a line of text (the week's mail, account/fit_mail.ts).
export const bandText = (lang: Lang, band: Score["band"]): string => t(lang, BAND_KEY[band]);

// The band's word, then the total out of MATCH_MAX in small type: the total
// is the sum of the reasons' points printed beside it, so the order of a list
// can be checked by hand. No total for a notice that is not matched.
export const MatchBand: FC<{ lang: Lang; score: Score }> = ({ lang, score }) => (
  <>
    <strong>{t(lang, BAND_KEY[score.band])}</strong>
    {score.band === "none" ? null : (
      <><br /><span class="muted small">{t(lang, "fit.points", { n: fmtInt(score.points, lang), max: fmtInt(MATCH_MAX, lang) })}</span></>
    )}
  </>
);

// Every reason with its points. The sign and figure are drawn; assistive
// technology reads "45 points" instead.
export const MatchReasons: FC<{ lang: Lang; score: Score; ctx: ReasonContext }> = ({ lang, score, ctx }) => (
  <ul class="plain">
    {score.reasons.map((r) => (
      <li>
        {reasonText(lang, r, ctx)}{" "}
        <span class="mono" aria-hidden="true">{t(lang, "fit.pts", { n: fmtInt(r.points, lang) })}</span>
        <span class="visually-hidden">{t(lang, "fit.pts_aria", { n: fmtInt(r.points, lang) })}</span>
      </li>
    ))}
  </ul>
);

// -- the disclaimer -----------------------------------------------------------------

// The Terms' No Warranty section, which holds the paragraph on these
// calculations; site makes it a full address (an email).
export function termsWarrantyHref(lang: Lang, site = ""): string {
  return `${site}/terms${lang === "fr" ? "?lang=fr" : ""}#warranty`;
}

export const METHOD_HREF = "/methodology#matching";

// The advisory features (the Terms' paragraph on calculations covers each):
// the line every surface showing one carries, the link to its rules, and
// the Methodology section the link opens. A later feature adds its kind here.
export type AdvisoryKind = "fit" | "line" | "follow";
const ADVISORY: Readonly<Record<AdvisoryKind, { text: Key; how: Key; href: string; cls: string }>> = {
  fit: { text: "fit.disclaimer", how: "fit.how", href: METHOD_HREF, cls: "fit-disclaimer" },
  line: { text: "line.disclaimer", how: "line.how", href: "/methodology#holders", cls: "line-disclaimer" },
  // Only while FOLLOWS_PANEL is "on", when the Methodology holds the paragraph it links (pages/follows.tsx).
  follow: { text: "follow.disclaimer", how: "follow.how", href: "/methodology#follows", cls: "follow-disclaimer" },
};

// The line beside every calculation the site shows, with the way to its
// rules after it unless how is false.
export const AdvisoryDisclaimer: FC<{ lang: Lang; kind: AdvisoryKind; site?: string; how?: boolean }> = ({ lang, kind, site = "", how = true }) => {
  const a = ADVISORY[kind];
  return (
    <p class={`muted small ${a.cls}`}>
      {tj(lang, a.text, { terms: <a href={termsWarrantyHref(lang, site)}>{t(lang, "terms.title")}</a> })}
      {how ? <> · <a href={`${site}${a.href}`}>{t(lang, a.how)}</a></> : null}
    </p>
  );
};

// The matching notices' line, as every match carries it.
export const FitDisclaimer: FC<{ lang: Lang; site?: string; how?: boolean }> = (p) => <AdvisoryDisclaimer {...p} kind="fit" />;
