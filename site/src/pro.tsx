// The Pro mark and the pieces that carry it: the chip, the one-line gate
// note and the tease panel; and the same-day mark, the bolt on the rows Pro
// adds to the tender lists, with its legend. The chip marks a boundary the
// reader is at (a rail entry, a tab, a tile or a link that leads to a page
// that comes with Pro, a gate note, a tease panel's head); it is never put
// in running prose, on anything free, in a table's records, twice on one
// line or alone on a control, and it is never interactive: the link it sits
// in takes the focus. One rendering for every plan, so a Pro reader sees
// the same chips and a page stays cacheable.
//
// While the accounts switch is off nothing is Pro, so no page draws a chip:
// the callers ask accountsEnabled() (or, in the rail, whether the shell
// carries an account) before they render one.

import type { FC } from "hono/jsx";
import { SAVED_SEARCH_MAX, type Feature } from "./account/entitlements";
import { stripeOffer } from "./account/stripe";
import type { Env } from "./env";
import { decimal, fmtInt, t, type Key, type Lang } from "./i18n";
import { Panel } from "./layout";

// The glyph before the word, one path on a 16-unit box drawn at 11 px in
// the chip's colour: a filled brilliant-cut gem. A different shape is a
// change to this path alone.
export const PRO_GLYPH_PATH = "M3 6.2 6 2h4l3 4.2L8 14.5z";

// The word, then the long form for assistive technology ("Pro (paid
// plan)"). The glyph is hidden from it, so it reads the word once.
export const ProTag: FC<{ lang: Lang }> = ({ lang }) => (
  <span class="pro-tag">
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d={PRO_GLYPH_PATH} /></svg>
    {t(lang, "pro.tag")}
    <span class="visually-hidden">{` ${t(lang, "pro.tag_hidden")}`}</span>
  </span>
);

// The same-day mark: a bolt before the title of each notice the day's
// same-day refresh brought (the band in src/pages/intraday.tsx, and the same
// notices in the day's list on /tenders/new), so a Pro reader sees which rows
// Pro added. The chip marks a boundary and stays out of a table's records;
// this marks the record itself, so it sits in one. The bolt is hidden
// from assistive technology, which reads the words in its place, and the
// legend under the band says what it means, so neither its colour nor a
// hover carries the meaning alone. The path is on the chip's 16-unit box,
// drawn at 11 px in the accent.
export const SAME_DAY_GLYPH_PATH = "M9.2 1 3 9.2h4.4L6.8 15 13 6.8H8.6z";

export const SameDayMark: FC<{ lang: Lang }> = ({ lang }) => (
  <span class="same-day-mark">
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d={SAME_DAY_GLYPH_PATH} /></svg>
    <span class="visually-hidden">{t(lang, "sameday.mark")}</span>
  </span>
);

// The legend, one sentence for a panel's foot: under the band, and on
// /tenders/same-day whatever the reader's plan, so the bolt is explained
// wherever it can be met.
export const SameDayLegend: FC<{ lang: Lang }> = ({ lang }) => <span>{t(lang, "sameday.legend")}</span>;

// A gate note: the chip, one sentence, and where to go from it. The
// children may be tj()'s pieces (a sentence with a link in it).
export const ProNote: FC<{ lang: Lang; children?: unknown }> = ({ lang, children }) => (
  <p class="pro-note"><ProTag lang={lang} />{" "}{children as any}</p>
);

// What Pro adds, each line under the feature that carries it, so a test can
// hold the list to the plans (test/radar-gate.test.ts).
export const PRO_INCLUDES: readonly (readonly [Feature, Key])[] = [
  ["radar_depth", "expiring.pro_radar"],
  ["radar_depth", "expiring.pro_csv"],
  ["intraday", "expiring.pro_intraday"],
  ["delivery", "expiring.pro_searches"],
  ["bug_reports", "pro.include_bugs"],
];

// The two figures, as the billing page offers them: the operator's text
// from wrangler.jsonc (PRICE_MONTHLY_CAD, PRICE_YEARLY_CAD), checked by the
// rule the checkout uses. Null when either is missing or out of form, or
// when the prices the checkout would charge are not set; the price line is
// then left out rather than show a figure the billing page does not offer.
export type ProPrice = { monthly: string; yearly: string };

export function proPrice(env: Env): ProPrice | null {
  const offer = stripeOffer(env);
  return offer ? { monthly: offer.monthly.figure, yearly: offer.yearly.figure } : null;
}

// "Pro is CA$18.99 a month or CA$189.99 a year, taxes added at checkout."
// The taxes are named with the price, so no amount appears only at checkout.
export const PriceLine: FC<{ lang: Lang; price: ProPrice | null }> = ({ lang, price }) =>
  price ? <p class="pro-price">{t(lang, "pro.price", { monthly: decimal(lang, price.monthly), yearly: decimal(lang, price.yearly) })}</p> : null;

// The tease panel at the foot of a Pro page's free view: "Part of Pro" with
// the chip, what the full page holds, what Pro includes, what stays free,
// the price and one button. Nothing to dismiss and nothing timed: the page
// was the reader's choice. foot is a note under the button (the same-day
// page's legend).
export const ProPanel: FC<{ lang: Lang; text: unknown; free?: unknown; price: ProPrice | null; signedIn: boolean; foot?: unknown }> = (
  { lang, text, free, price, signedIn, foot },
) => (
  <Panel title={t(lang, "expiring.pro_title")} class="pro-panel" tools={<ProTag lang={lang} />} foot={foot}>
    <p>{text as any}</p>
    <p>{t(lang, "expiring.pro_includes")}</p>
    <ul>
      {PRO_INCLUDES.map(([, key]) => <li>{t(lang, key, { cap: fmtInt(SAVED_SEARCH_MAX, lang) })}</li>)}
    </ul>
    {free ? <p>{free as any}</p> : null}
    <PriceLine lang={lang} price={price} />
    <p class="pro-panel-actions">
      <a href={signedIn ? "/account" : "/account/sign-in"} class="btn btn-primary">
        {t(lang, signedIn ? "expiring.pro_account" : "expiring.pro_sign_in")}
      </a>
      {/* A reader not signed in can read the whole plan first (pages/pro.tsx). */}
      {signedIn ? null : <>{" "}<a href="/pro" class="btn">{t(lang, "pro.about_button")}</a></>}
    </p>
  </Panel>
);
