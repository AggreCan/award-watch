// /pro: what the paid plan adds, who it is for, what stays free, its price
// and the way in, for a reader who has not signed in and for a search engine
// (docs/seo.md). What Pro includes is the plan cards under the head (Free
// beside Pro, src/pro.tsx PlanCards): every row is a feature the plans grant
// Pro and not Free (account/entitlements.ts RULES); test/seo-intent.test.ts
// holds the two together. The price is the billing page's: the operator's
// two figures, shown only while a checkout can be made (the payment source
// is available). Without one the page says Pro is not on sale yet and
// carries no Product markup.
//
// The rail is unchanged; the footer and the tease panels link here. While
// the accounts switch is off the address is the site's 404, as
// /tenders/same-day is: nothing is Pro then and the sign-in page does not
// exist.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { SampleLine } from "../account/briefing_pages";
import { RULES, type Feature } from "../account/entitlements";
import { railAccount } from "../account/session";
import { accountsEnabled } from "../account/switch";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { decimal, fmtInt, t, type Key, type Lang } from "../i18n";
import { Layout, PageHead, page } from "../layout";
import { PLAN_ROWS, PlanCards, PriceLine, ProTag, type PlanReader, type ProPrice, checkoutPrice, planCards, planLine } from "../pro";
import { type Faq, pageSeo, proJsonLd } from "../seo";

export const PRO_PATH = "/pro";

// What Pro includes: the Pro card's lines, each beside the feature the plans
// grant for it.
export function proIncludes(lang: Lang): { feature: Feature; text: string }[] {
  return PLAN_ROWS.map((row) => ({ feature: row.feature, text: planLine(lang, row.pro) }));
}

// The questions, word for word as the page shows them and as the FAQPage
// markup carries them. The price question only with a price.
export function proFaq(lang: Lang, price: ProPrice | null): Faq[] {
  const qa = (q: Key, a: string): Faq => ({ q: t(lang, q), a });
  return [
    ...(price
      ? [qa("propage.q_price", t(lang, "propage.a_price", { monthly: decimal(lang, price.monthly), yearly: decimal(lang, price.yearly) }))]
      : []),
    qa("propage.q_free", t(lang, "propage.a_free")),
    qa("propage.q_alerts", t(lang, "propage.a_alerts", { n: fmtInt(RULES.pro.saved_searches, lang) })),
    qa("propage.q_recompete", t(lang, "propage.a_recompete")),
    qa("propage.q_source", t(lang, "propage.a_source")),
    qa("propage.q_cancel", t(lang, "billing.renewal")),
    qa("propage.q_seller", t(lang, "propage.a_seller")),
  ];
}

type Reader = PlanReader;

// The way in: sign in (an account is made the same way), the billing page for
// a free account, the account for a Pro one.
const Action: FC<{ lang: Lang; reader: Reader }> = ({ lang, reader }) =>
  reader === "pro" ? <a href="/account" class="btn">{t(lang, "expiring.pro_account")}</a>
    : reader === "free" ? <a href="/account/billing" class="btn btn-primary">{t(lang, "propage.billing")}</a>
    : <a href="/account/sign-in" class="btn btn-primary">{t(lang, "expiring.pro_sign_in")}</a>;

const Offer: FC<{ lang: Lang; price: ProPrice | null; reader: Reader }> = ({ lang, price, reader }) => (
  <div class="pro-offer">
    {price ? <PriceLine lang={lang} price={price} /> : <p>{t(lang, "billing.unavailable")}</p>}
    {price || reader !== "out" ? <p class="pro-offer-actions"><Action lang={lang} reader={reader} /></p> : null}
    {price && reader === "out" ? <p class="muted small">{t(lang, "propage.sign_in_note")}</p> : null}
  </div>
);

export async function proPage(c: Context<AppEnv>): Promise<Response> {
  if (!accountsEnabled(c.env)) return c.notFound();
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  const price = checkoutPrice(c.env);
  const account = await railAccount(c).catch(() => undefined);
  const reader: Reader = !account?.email ? "out" : account.plan === "pro" ? "pro" : "free";
  const faq = proFaq(lang, price);
  const base = pageSeo("pro", lang);
  const seo = { ...base, jsonLd: proJsonLd(lang, { price, description: base.description, faq }) };
  const title = t(lang, "propage.title");
  // The cards come straight under the head with the price and the way in,
  // so the head carries no offer of its own; the questions end on one.
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats?.data_as_of ?? null} seo={seo}>
      <PageHead lang={lang} eyebrow={<ProTag lang={lang} />} title={title} lead={t(lang, "propage.lead")} />
      <div class="doc-layout doc-alone">
        <div class="doc">
          <h2 id="includes">{t(lang, "billing.panel_pro")}</h2>
          <PlanCards lang={lang} plans={planCards(lang, { price, reader, place: "pro_page" })} />
          <p><SampleLine lang={lang} text="briefing.pro_sample" link="briefing.sample_link_text" /></p>
          <h2 id="who">{t(lang, "propage.who_title")}</h2>
          <ul>
            <li>{t(lang, "propage.who_bid")}</li>
            <li>{t(lang, "propage.who_capture")}</li>
            <li>{t(lang, "propage.who_research")}</li>
          </ul>
          <h2 id="free">{t(lang, "propage.free_title")}</h2>
          <p>{t(lang, "propage.free_text")}</p>
          <h2 id="questions">{t(lang, "propage.faq_title")}</h2>
          {faq.map((f) => (
            <>
              <h3>{f.q}</h3>
              <p>{f.a}</p>
            </>
          ))}
          <Offer lang={lang} price={price} reader={reader} />
        </div>
      </div>
    </Layout>,
  );
}
