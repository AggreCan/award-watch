// The same-day notices band on /tenders and /tenders/new (docs/intraday.md):
// the notices CanadaBuys posted since the nightly's refresh, which the
// intraday workflow reads every two hours, drawn above the page's list for a
// request whose plan carries the feature (src/plan.ts). The rows sit in the
// tender list's columns, so the widths match the table below; each carries
// the same-day mark before its title (src/pro.tsx, explained by the legend
// at the band's foot) and a chip saying it is from the same day or amended
// today. The site has no page for such a notice until the next nightly, so
// its title opens the notice on CanadaBuys; a buyer the lookup could not
// match shows its name as published, without a link.
//
// sameDayView is the pages' one call (intradayBand when a page needs only
// the band). A free request returns null before anything is read (no D1
// query, no file), so its page is the page without the feature. A paid
// request whose D1 query fails gets the free view too: the failure is
// logged by its code alone and the page carries no error.
//
// The one other reader is sameDayMapCounts, for the home page's map: the
// same rows counted by province for every reader, figures only, read at
// most once an isolate every few minutes.

import type { Context } from "hono";
import type { Child, FC } from "hono/jsx";
import { accountsEnabled } from "../account/switch";
import { Table } from "../columns";
import { type Clock, closesAtUtc, closingText, closingTime, tenderState } from "../closing";
import { DAY_RE, type ProvinceCounts, loadNewTenders, loadOpenFirst, provinceCounts, publishedReference } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, t, tn, type Key, type Lang } from "../i18n";
import { type IntradayView, loadIntraday, loadLastCut, mergeIntraday } from "../intraday";
import { Panel, StatusBadge } from "../layout";
import { type PlaceQuery, placedIn } from "../places";
import { allowsIntraday, requestPlan } from "../plan";
import { SameDayLegend, SameDayMark } from "../pro";
import { faultSummary } from "../search_db";
import { BuyerLink, SegmentChips, provincesText, tenderColumns, tenderNoticeUrl } from "./shared";

const CHIP: Record<IntradayView["intraday"], Key> = { new: "intraday.new", amended: "intraday.amended" };

export const IntradayBand: FC<{ lang: Lang; rows: readonly IntradayView[]; clock: Clock }> = ({ lang, rows, clock }) => (
  <Panel class="intraday" title={tn(lang, "intraday.heading_one", "intraday.heading_many", rows.length, { n: fmtInt(rows.length, lang) })}
    foot={<SameDayLegend lang={lang} />}>
    <p class="muted small">{t(lang, "intraday.note")}</p>
    <div class="table-wrap bordered">
      <Table cols={tenderColumns(lang)} class="t-tenders">
        <tbody>
          {rows.map((r) => {
            const state = tenderState("open", r.closing, clock);
            const closes = state === "closing" ? closesAtUtc(r.closing) : null;
            const shown = publishedReference(r);
            return (
              <tr data-intraday={r.intraday}>
                <td data-label={t(lang, "col.notice")} class="c-notice">
                  <SameDayMark lang={lang} /><a href={tenderNoticeUrl(shown, lang)} rel="noopener">{pick(lang, r.title_en, r.title_fr) ?? shown}</a>
                  <br />
                  <span class="mono id muted">{shown}</span> <span class="tag">{t(lang, CHIP[r.intraday])}</span>{" "}
                  <SegmentChips lang={lang} codes={r.segments} />
                </td>
                <td data-label={t(lang, "col.buyer")} class="c-buyer"><BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} /></td>
                <td data-label={t(lang, "col.closing")} class="mono c-date" data-closes={closes ?? undefined}
                  data-time={closes ? closingTime(r.closing, lang) ?? undefined : undefined} data-notice={closes ? r.reference.toLowerCase() : undefined}>
                  {closingText(r.closing, lang)}{" "}
                  <StatusBadge lang={lang} status={state} notice={closes ? r.reference.toLowerCase() : undefined} />
                </td>
                <td data-label={t(lang, "col.published")} class="mono c-pub mdh">{r.published ?? ""}</td>
                <td data-label={t(lang, "col.region")} class="c-region">{provincesText(lang, r.provinces)}</td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  </Panel>
);

// The band for this request, with the references of its rows in lower case
// (a list on the same page marks those rows too), or null. The rows are set
// against what the nightly published: the notices it first saw on its data date
// (tenders/new/<data date>.json, where every notice the intraday job read
// before the nightly took it in lands) and the first open notices
// (tenders/open-first.json, which /tenders renders), so a notice the
// nightly holds is never shown twice. Both files are the pages' own, read
// through the parsed-file cache. The full open list (tenders/open.json,
// about 1 MB) stays the browser's: the Worker never parses it.
export type SameDayView = { band: Child; marked: ReadonlySet<string> };

// places: the province filter of the page the band sits on (a list the home
// page's map opened), which keeps the band's rows placed there. The rows
// carry the provinces their notices state; the intraday job derives none.
export async function sameDayView(
  c: Context<AppEnv>, dataAsOf: string | null | undefined, clock: Clock, places?: PlaceQuery,
): Promise<SameDayView | null> {
  if (!allowsIntraday(await requestPlan(c))) return null;
  const db = c.env.SEARCH;
  if (!db || !dataAsOf || !DAY_RE.test(dataAsOf)) return null;
  let rows;
  let cut: string | null;
  try {
    [rows, cut] = await Promise.all([loadIntraday(db, dataAsOf), loadLastCut(db)]);
  } catch (e) {
    console.error(`intraday: query failed (${faultSummary(e)})`);
    return null;
  }
  // The page now shows the cuts read up to this one, with or without rows:
  // its stamp for the top bar's sub-daily timer (src/refresh.tsx), which
  // page() hands to the shell. No other page carries one.
  if (cut) c.set("sameDayAt", cut);
  if (!rows.length) return null;
  const [firstSeen, first] = await Promise.all([loadNewTenders(c.env, dataAsOf), loadOpenFirst(c.env)]);
  const merged = mergeIntraday([...(firstSeen ?? []), ...(first?.rows ?? [])], rows);
  const shown = places ? merged.filter((r) => placedIn(r, places)) : merged;
  if (!shown.length) return null;
  return {
    band: <IntradayBand lang={c.get("lang")} rows={shown} clock={clock} />,
    marked: new Set(shown.map((r) => r.reference.toLowerCase())),
  };
}

export async function intradayBand(c: Context<AppEnv>, dataAsOf: string | null | undefined, clock: Clock): Promise<Child> {
  return (await sameDayView(c, dataAsOf, clock))?.band ?? null;
}

// -- the home page's map ----------------------------------------------------------------

// The same-day layer of the home page's map (src/pages/home_map.tsx), shown
// to every reader as a count: the band's notices, the ones /tenders/same-day
// lists to a Pro reader, by the provinces they state. Figures only: no row
// leaves this function. The rows come through the band's own statement, read
// at most once an isolate in SAME_DAY_COUNTS_MS for a data date (the cuts
// come every two hours), so the home page does not read the table on every
// request; at most MAX_ROWS rows (src/intraday.ts), so the count is bounded.
// Null, and nothing read, while the accounts switch is off (nothing is Pro,
// and the map draws no same-day layer), without the binding or a data date;
// null when the read fails, kept for the same time so an outage is not
// retried on every request.
export const SAME_DAY_COUNTS_MS = 10 * 60 * 1000;

let keptCounts: { day: string; at: number; counts: ProvinceCounts | null } | null = null;

// For the tests: the next call reads the rows again.
export function forgetSameDayCounts(): void {
  keptCounts = null;
}

export async function sameDayMapCounts(c: Context<AppEnv>, dataAsOf: string | null | undefined): Promise<ProvinceCounts | null> {
  if (!accountsEnabled(c.env)) return null;
  const db = c.env.SEARCH;
  if (!db || !dataAsOf || !DAY_RE.test(dataAsOf)) return null;
  const now = Date.now();
  if (keptCounts && keptCounts.day === dataAsOf && now - keptCounts.at < SAME_DAY_COUNTS_MS) return keptCounts.counts;
  let counts: ProvinceCounts | null = null;
  try {
    const rows = await loadIntraday(db, dataAsOf);
    const [firstSeen, first] = rows.length ? await Promise.all([loadNewTenders(c.env, dataAsOf), loadOpenFirst(c.env)]) : [null, null];
    counts = provinceCounts(mergeIntraday([...(firstSeen ?? []), ...(first?.rows ?? [])], rows));
  } catch (e) {
    console.error(`intraday: map counts failed (${faultSummary(e)})`);
  }
  keptCounts = { day: dataAsOf, at: now, counts };
  return counts;
}
