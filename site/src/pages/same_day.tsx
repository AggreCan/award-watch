// /tenders/same-day: the same-day tender notices at an address of their own
// (docs/intraday.md), so the rail's entry and the line in the tender lists'
// head lead somewhere for every reader.
//
// A request whose plan carries the feature (src/plan.ts) gets the band
// /tenders draws above its list (intradayBand in src/pages/intraday.tsx),
// or a line saying none has been read yet. Any other request gets the head,
// the cadence line and what Pro adds with its price (src/pro.tsx); that view
// reads nothing past what every page reads: no D1 query and no notice file.
// Every view ends on the legend of the same-day mark, the bolt on the band's
// rows, so the page explains it to a reader who has not met it yet.
// While the accounts switch is off the address is the site's 404, since
// nothing is Pro then and nothing links here.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { railAccount } from "../account/session";
import { accountsEnabled } from "../account/switch";
import { clockOf } from "../closing";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { t, tj, type Lang } from "../i18n";
import { Layout, PageHead, Panel, noDataPage, page } from "../layout";
import { allowsIntraday, requestPlan } from "../plan";
import { ProNote, ProPanel, SameDayLegend, checkoutPrice } from "../pro";
import { breadcrumbJsonLd, pageSeo } from "../seo";
import { intradayBand } from "./intraday";

export const SAME_DAY_PATH = "/tenders/same-day";

// The gate note in the head of /tenders and /tenders/new, where a Pro
// reader gets the band instead: one line, no box, linking this page.
export const SameDayNote: FC<{ lang: Lang }> = ({ lang }) => (
  <ProNote lang={lang}>
    {tj(lang, "sameday.tenders_note", { link: <a href={SAME_DAY_PATH}>{t(lang, "rail.same_day_full")}</a> })}
  </ProNote>
);

// Whether a tender list's head carries that note: the switch is on and the
// plan lacks the feature. The plan is the session the page already read
// (readSession keeps one answer per request); without a session nothing is read.
export async function sameDayNoted(c: Context<AppEnv>): Promise<boolean> {
  return accountsEnabled(c.env) && !allowsIntraday(await requestPlan(c));
}

export async function sameDayPage(c: Context<AppEnv>): Promise<Response> {
  if (!accountsEnabled(c.env)) return c.notFound();
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "sameday.title");
  const title = t(lang, "sameday.title");
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "rail.open"), path: "/tenders" }, { name: title }];
  let body: unknown;
  if (allowsIntraday(await requestPlan(c))) {
    const band = await intradayBand(c, stats.data_as_of, clockOf(c.env));
    body = band ?? (
      <Panel title={t(lang, "rail.same_day_full")} foot={<SameDayLegend lang={lang} />}>
        <p class="muted">{t(lang, "sameday.none")}</p>
      </Panel>
    );
  } else {
    const account = await railAccount(c).catch(() => undefined);
    body = (
      <ProPanel lang={lang} signedIn={!!account?.email} price={checkoutPrice(c.env)} text={t(lang, "sameday.pro_text")}
        foot={<SameDayLegend lang={lang} />}
        free={tj(lang, "sameday.free", {
          open: <a href="/tenders">{t(lang, "sameday.free_open")}</a>,
          new: <a href="/tenders/new">{t(lang, "sameday.free_new")}</a>,
        })} />
    );
  }
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/tenders"
      seo={pageSeo("same_day", lang, { jsonLd: [breadcrumbJsonLd(crumbs)] })}>
      <PageHead lang={lang} title={title} crumbs={crumbs} lead={t(lang, "sameday.lead")} />
      {body as any}
    </Layout>,
  );
}
