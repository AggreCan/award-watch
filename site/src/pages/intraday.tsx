// The same-day notices band on /tenders and /tenders/new (docs/intraday.md):
// the notices CanadaBuys posted since the nightly's refresh, which the
// intraday workflow reads every two hours, drawn above the page's list for a
// request whose plan carries the feature (src/plan.ts). The rows sit in the
// tender list's columns, so the widths match the table below; each carries
// a chip saying it is from the same day or amended today. The site has no
// page for such a notice until the next nightly, so its title opens the
// notice on CanadaBuys; a buyer the lookup could not match shows its name
// as published, without a link.
//
// intradayBand is the pages' one call. A free request returns null before
// anything is read (no D1 query, no file), so its page is the page without
// the feature. A paid request whose D1 query fails gets the free view too:
// the failure is logged by its code alone and the page carries no error.

import type { Context } from "hono";
import type { Child, FC } from "hono/jsx";
import { Table } from "../columns";
import { type Clock, closesAtUtc, closingText, closingTime, tenderState } from "../closing";
import { DAY_RE, loadNewTenders, loadOpenFirst, publishedReference } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, t, tn, type Key, type Lang } from "../i18n";
import { type IntradayView, loadIntraday, mergeIntraday } from "../intraday";
import { Panel, StatusBadge } from "../layout";
import { allowsIntraday, requestPlan } from "../plan";
import { faultSummary } from "../search_db";
import { BuyerLink, SegmentChips, provincesText, tenderColumns, tenderNoticeUrl } from "./shared";

const CHIP: Record<IntradayView["intraday"], Key> = { new: "intraday.new", amended: "intraday.amended" };

export const IntradayBand: FC<{ lang: Lang; rows: readonly IntradayView[]; clock: Clock }> = ({ lang, rows, clock }) => (
  <Panel class="intraday" title={tn(lang, "intraday.heading_one", "intraday.heading_many", rows.length, { n: fmtInt(rows.length, lang) })}>
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
                  <a href={tenderNoticeUrl(shown, lang)} rel="noopener">{pick(lang, r.title_en, r.title_fr) ?? shown}</a>
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

// The band for this request, or null. The rows are set against what the
// nightly published: the notices it first saw on its data date
// (tenders/new/<data date>.json, where every notice the intraday job read
// before the nightly took it in lands) and the first open notices
// (tenders/open-first.json, which /tenders renders), so a notice the
// nightly holds is never shown twice. Both files are the pages' own, read
// through the parsed-file cache. The full open list (tenders/open.json,
// about 1 MB) stays the browser's: the Worker never parses it.
export async function intradayBand(c: Context<AppEnv>, dataAsOf: string | null | undefined, clock: Clock): Promise<Child> {
  if (!allowsIntraday(await requestPlan(c))) return null;
  const db = c.env.SEARCH;
  if (!db || !dataAsOf || !DAY_RE.test(dataAsOf)) return null;
  let rows;
  try {
    rows = await loadIntraday(db, dataAsOf);
  } catch (e) {
    console.error(`intraday: query failed (${faultSummary(e)})`);
    return null;
  }
  if (!rows.length) return null;
  const [firstSeen, first] = await Promise.all([loadNewTenders(c.env, dataAsOf), loadOpenFirst(c.env)]);
  const shown = mergeIntraday([...(firstSeen ?? []), ...(first?.rows ?? [])], rows);
  return shown.length ? <IntradayBand lang={c.get("lang")} rows={shown} clock={clock} /> : null;
}
