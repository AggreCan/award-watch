// The line of guides on a record page or a list (docs/guides.md, Where the
// section is linked): "Guides:" and one to three of the guides that explain
// what the page shows, each by its own title as the guides' index gives it,
// in the page's language. Most readers from a search engine land on a record
// page, and before this line no record page linked a guide.
//
// One rule a kind of page, each a pure function of the fields it reads, so
// the tests call them directly: the most specific guide first, at most
// MAX_GUIDES, no guide twice, and never a guide the page links elsewhere in
// its body (a published contract's section 6 note links the guide on
// contracts without competition, so its rule leaves that guide out while the
// note shows). The rules read only what the page has already read: the line
// adds no query and no fetch. A guide is named by its address in src/guides.ts.

import type { FC } from "hono/jsx";
import { type Competitive, competitiveOf, isNoticeType } from "./data";
import {
  ACAN_PATH, ACAN_TYPE, BID_PATH, DEBRIEF_PATH, ENDING_PATH, LIMITS_PATH, PSIB_PATH, READING_PATH, RFSA_TYPE, RFSO_TYPE, SOSA_PATH, THREE_PATH,
  TRADE_PATH, type Guide, guideBySlug, slugOf,
} from "./guides";
import { tj, type Lang } from "./i18n";
import { guidePath, guideText } from "./pages/guides";

export const MAX_GUIDES = 3;

export const ACAN = slugOf(ACAN_PATH);
export const BID = slugOf(BID_PATH);
export const DEBRIEF = slugOf(DEBRIEF_PATH);
export const ENDING = slugOf(ENDING_PATH);
export const LIMITS = slugOf(LIMITS_PATH);
export const PSIB = slugOf(PSIB_PATH);
export const READING = slugOf(READING_PATH);
export const SOSA = slugOf(SOSA_PATH);
export const THREE = slugOf(THREE_PATH);
export const TRADE = slugOf(TRADE_PATH);

// The guides a rule names, in its order: each once, the first MAX_GUIDES, a
// condition that does not hold (false) left out. A guide past the third is
// what "while there is room" leaves out.
function chosen(slugs: readonly (string | false)[]): string[] {
  const out: string[] = [];
  for (const s of slugs) if (s && !out.includes(s) && out.length < MAX_GUIDES) out.push(s);
  return out;
}

// An end date on or after the data date, both ISO dates; a time after the date is not read.
function endsOnOrAfter(end: string | null, today: string): boolean {
  return end !== null && /^\d{4}-\d{2}-\d{2}/.test(end) && end.slice(0, 10) >= today;
}

// A tender notice (pages/tender.tsx). An advance contract award notice, or a
// request for standing offer or for supply arrangement, by the tender list's
// own type test; then how to read a notice and how to bid; then the trade
// agreements guide when the notice names an agreement in either language (the
// page shows the other language's list when its own is empty).
export function tenderGuides(n: {
  notice_type_en: string | null; trade_agreements_en: readonly string[] | null; trade_agreements_fr: readonly string[] | null;
}): string[] {
  const kind = isNoticeType(n, ACAN_TYPE) ? ACAN : isNoticeType(n, RFSO_TYPE) || isNoticeType(n, RFSA_TYPE) ? SOSA : false;
  const trade = (n.trade_agreements_en?.length ?? 0) > 0 || (n.trade_agreements_fr?.length ?? 0) > 0;
  return chosen([kind, READING, BID, trade && TRADE]);
}

// An award notice or a PSPC contract history record (pages/contract.tsx). The
// guide on contracts without competition when the record's competitive flag
// (the one its page shows) says non-competitive; the three records of one
// contract; then debriefings and bid challenges for an award notice, or, for a
// history record whose end date is on or after the data date, how a contract ends;
// a cancelled record has no end ahead of it (its page offers no calendar link either).
export function contractGuides(
  kind: "award" | "history", r: { competitive: Competitive; end: string | null; status?: string | null }, today: string,
): string[] {
  return chosen([
    competitiveOf(r.competitive) === false && LIMITS,
    THREE,
    kind === "award" ? DEBRIEF : r.status !== "cancelled" && endsOnOrAfter(r.end, today) && ENDING,
  ]);
}

// A published contract (pages/published.tsx). The guide on contracts without
// competition when the contract is non-competitive and the page does not show
// its section 6 exception (exception: the code the page shows, whose note
// links that guide); the set-asides guide for a set-aside under the
// Procurement Strategy for Indigenous Business (psib: the code the page
// names); the three records; how a contract ends, while the end date is on or
// after the data date and there is room.
export function publishedGuides(
  r: { competitive: Competitive; exception: string | null; psib: string | null; end: string | null }, today: string,
): string[] {
  return chosen([
    competitiveOf(r.competitive) === false && !r.exception && LIMITS,
    r.psib !== null && PSIB,
    THREE,
    endsOnOrAfter(r.end, today) && ENDING,
  ]);
}

// The radar (pages/expiring.tsx), on every view that lists contracts: how a contract ends, then its three records.
export function radarGuides(): string[] {
  return chosen([ENDING, THREE]);
}

// A standing offer's or supply arrangement's page (pages/instruments.tsx).
export function instrumentGuides(): string[] {
  return chosen([SOSA]);
}

// The tender lists (pages/tenders.tsx: /tenders with any filter, and /tenders/new).
export function tenderListGuides(): string[] {
  return chosen([READING, BID]);
}

// The award notices' lists (pages/awards.tsx: /awards, the newest, and a year's, /awards/<year>).
export function awardListGuides(): string[] {
  return chosen([THREE, DEBRIEF]);
}

// The line under the page's last panel, in the page's closing notes' style: a
// guide's title as the index shows it, the links a middle dot apart, the dot
// kept on the line of the title before it. Nothing when no guide is named.
export const GuideLine: FC<{ lang: Lang; slugs: readonly string[] }> = ({ lang, slugs }) => {
  const guides = slugs.map((s) => guideBySlug(s)).filter((g): g is Guide => g !== undefined);
  if (!guides.length) return null;
  return (
    <p class="page-foot-note">
      {tj(lang, "guides.line", {
        links: guides.map((g, i) => <>{i > 0 ? " · " : null}<a href={guidePath(g)}>{guideText(lang, g.title)}</a></>),
      })}
    </p>
  );
};
