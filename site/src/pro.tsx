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
//
// The plan cards (PlanCards) put Free beside Pro as two checklists of the
// same rows, PLAN_ROWS, on the tease panels, the Pro page and the billing
// page; a third plan is one more card and one more wording a row.

import type { FC } from "hono/jsx";
import { PLANS, RULES, type Feature, type Plan } from "./account/entitlements";
import { paymentSource } from "./account/payments";
import { stripeOffer } from "./account/stripe";
import { KEY_PER_DAY } from "./api_keyed_spec";
import { EXPIRING_WINDOWS } from "./data";
import type { Env } from "./env";
import { decimal, fmtInt, numberLocale, t, tj, type Key, type Lang } from "./i18n";
import { Panel } from "./layout";
import { FREE_YEARS, MAX_RIVALS, MAX_YEARS } from "./records_db";
import { SAME_DAY_RUNS_UTC } from "./refresh";

// The glyph before the word, one path on a 16-unit box drawn at 12 px in
// the chip's colour: a filled brilliant-cut gem. A different shape is a
// change to this path alone.
export const PRO_GLYPH_PATH = "M3 6.2 6 2h4l3 4.2L8 14.5z";

// The word, then the long form for assistive technology ("Pro (paid
// plan)"). The glyph is hidden from it, so it reads the word once. A
// caller puts no word space beside the chip: its margins make the 6 px
// on either side (public/styles.css), and a space would add to them.
export const ProTag: FC<{ lang: Lang }> = ({ lang }) => (
  <span class="pro-tag">
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d={PRO_GLYPH_PATH} /></svg>
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
  <p class="pro-note"><ProTag lang={lang} />{children as any}</p>
);

// -- the plans, row by row --------------------------------------------------------

// A row's wording on one plan: a key, and the figures it names, read from
// the plans (RULES) and the constants when the row is drawn, so no figure is
// typed into a row.
export type Wording = { key: Key; vars?: (lang: Lang) => Record<string, string> };

// One line of the plan cards: the feature the plans grant for it (one Pro
// has and Free has not, or for a counted feature one Pro gives a larger
// figure, so test/seo-intent.test.ts and test/radar-gate.test.ts can hold
// every row to RULES), and each plan's wording, null where the plan has none
// of it. Every card draws every row in this order, so the lists
// line up across the cards.
export type PlanRow = { feature: Feature; free: Wording | null; pro: Wording };

// The longest a row's line may run, in characters, in either language: one
// line at a card's narrowest (300 px, 13 px type, the mark beside it). The
// stylesheet cuts a longer one with an ellipsis rather than wrap it.
export const PLAN_LINE_MAX = 44;

// The window of contracts ending at an index of EXPIRING_WINDOWS, in months
// ("3m" is 3), and the same-day cadence in hours, from the first two cuts of
// its schedule (src/refresh.tsx); read when a row is drawn.
const windowMonths = (i: number, lang: Lang) => fmtInt(Number(EXPIRING_WINDOWS[i].slice(0, -1)), lang);
export const sameDayHours = (lang: Lang) => {
  const [a, b] = SAME_DAY_RUNS_UTC.slice(0, 2).map((s) => Number(s.slice(0, 2)));
  return fmtInt(b - a, lang);
};
const count = (n: () => number) => (lang: Lang) => ({ n: fmtInt(n(), lang) });

// The rows Free has come first, then those Pro adds, so the hollow marks
// gather at the foot of the Free card and what each plan adds reads down the
// page (operator, 2026-11-06); a third plan's rows would follow Pro's. Each
// line names the figure its own plan gets and never compares the plans.
export const PLAN_ROWS: readonly PlanRow[] = [
  { feature: "intraday", free: { key: "plans.free_tenders" }, pro: { key: "plans.pro_tenders", vars: (lang) => ({ h: sameDayHours(lang) }) } },
  {
    feature: "radar_depth",
    free: { key: "plans.free_radar", vars: (lang) => ({ m: windowMonths(0, lang) }) },
    pro: { key: "plans.pro_radar", vars: (lang) => ({ a: windowMonths(1, lang), b: windowMonths(2, lang) }) },
  },
  {
    feature: "radar_depth",
    free: { key: "plans.radar_csv", vars: (lang) => ({ m: windowMonths(0, lang) }) },
    pro: { key: "plans.radar_csv", vars: (lang) => ({ m: windowMonths(2, lang) }) },
  },
  // Each plan's own count of searches and of watches; the mail is what Free lacks.
  {
    feature: "delivery",
    free: { key: "plans.free_searches", vars: count(() => RULES.free.saved_searches) },
    pro: { key: "plans.pro_searches", vars: count(() => RULES.pro.saved_searches) },
  },
  {
    feature: "watch_mail",
    free: { key: "plans.free_watches", vars: count(() => RULES.free.watchlists) },
    pro: { key: "plans.pro_watches", vars: count(() => RULES.pro.watchlists) },
  },
  // A calendar feed is a delivery, as mail is (src/account/feeds.ts); a record's own file stays free.
  { feature: "delivery", free: { key: "plans.free_feeds" }, pro: { key: "plans.pro_feeds" } },
  {
    feature: "analytics",
    free: { key: "plans.free_analytics", vars: count(() => FREE_YEARS) },
    pro: { key: "plans.pro_analytics", vars: count(() => MAX_YEARS) },
  },
  // The matching notices /account/matches lists (src/account/fit_pages.tsx): a count, as the watches are.
  { feature: "matches", free: { key: "plans.matches", vars: count(() => RULES.free.matches) }, pro: { key: "plans.matches", vars: count(() => RULES.pro.matches) } },
  { feature: "api", free: { key: "plans.free_api" }, pro: { key: "plans.pro_api", vars: (lang) => ({ day: fmtInt(KEY_PER_DAY, lang) }) } },
  { feature: "export_filtered", free: { key: "plans.free_instruments" }, pro: { key: "plans.pro_instruments" } },
  // A weekly briefing is a delivery, as a saved search's mail is (src/account/briefings.ts).
  { feature: "delivery", free: null, pro: { key: "plans.pro_briefing" } },
  // The blocks of "Your organization" past its first (src/account/org_pages.tsx),
  // with the organizations it sits beside (COMPETITORS_MAX in account/org_claim.ts is MAX_RIVALS).
  { feature: "analytics", free: null, pro: { key: "plans.pro_org", vars: count(() => MAX_RIVALS) } },
  { feature: "bug_reports", free: null, pro: { key: "plans.pro_bugs" } },
];

// What Pro adds, each line under the feature that carries it, so a test can
// hold the list to the plans (test/radar-gate.test.ts): the rows' Pro column.
export const PRO_INCLUDES: readonly (readonly [Feature, Key])[] = PLAN_ROWS.map((r) => [r.feature, r.pro.key] as const);

// A row's text on a card: the wording with its figures, a capital first and
// no closing period, whatever key a row is given.
export function planLine(lang: Lang, w: Wording): string {
  const s = t(lang, w.key, w.vars?.(lang)).replace(/\.$/, "");
  return s.charAt(0).toLocaleUpperCase(numberLocale(lang)) + s.slice(1);
}

// What a plan's card shows on a row: its own wording, or where it has none
// the wording of the first plan above it that has one, marked as lacking.
export function rowFor(row: PlanRow, plan: Plan): { wording: Wording; has: boolean } {
  const own = row[plan];
  if (own) return { wording: own, has: true };
  const above = PLANS.slice(PLANS.indexOf(plan) + 1).map((p) => row[p]).find((w): w is Wording => w !== null);
  return { wording: above ?? row.pro, has: false };
}

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

// The two figures while a checkout can be made (the payment source is set
// up), else null: the plan cards then say Pro is not on sale yet, as the
// billing page does.
export function checkoutPrice(env: Env): ProPrice | null {
  return paymentSource(env).available() ? proPrice(env) : null;
}

// "Pro is CA$18.99 a month or CA$189.99 a year, taxes added at checkout."
// The taxes are named with the price, so no amount appears only at checkout,
// and the refund of the first payment is stated with it (the Terms, Refund of
// the First Payment), so a reader weighing the price sees the way back.
export const PriceLine: FC<{ lang: Lang; price: ProPrice | null }> = ({ lang, price }) =>
  price ? (
    <p class="pro-price">
      {t(lang, "pro.price", { monthly: decimal(lang, price.monthly), yearly: decimal(lang, price.yearly) })} {t(lang, "pro.refund")}
    </p>
  ) : null;

// -- the plan cards ---------------------------------------------------------------

export type PlanAction = { href: string; label: string; primary?: boolean };

// One card: whose wording of PLAN_ROWS it draws; its name, with the chip in
// the head band when tag is set; whether the page offers it (framed in the
// accent, its head tinted, its checks in the accent); the price slot; one
// line on whom it is for; whether it is the reader's own plan (marked, and
// no way to buy it again); its links; and a muted line under them.
export type PlanCard = {
  plan: Plan; name: string; tag?: boolean; offered?: boolean; price: unknown; forLine: string;
  current?: boolean; actions: readonly PlanAction[]; note?: string | null;
};

// The rows of every card: the head band, the price, the "for" line, one a
// PLAN_ROWS entry, the buttons and the note under them. Every card spans
// them all (a card without a note leaves the last empty), so the stylesheet's
// subgrid puts each row at one height across the cards (.plan-cards).
export const PLAN_CARD_ROWS = 3 + PLAN_ROWS.length + 2;

// The marks before a row, on a 16-unit box drawn at 12 px: a check for what
// the plan has (in the accent on the plan offered, muted on the others) and
// a hollow ring for what it lacks. Hidden from assistive technology; a row
// the plan lacks says so in words instead.
const CHECK_PATH = "M6.5 11.3 3.2 8l1.1-1.1 2.2 2.2 5.2-5.2 1.1 1.1z";

const Mark: FC<{ has: boolean }> = ({ has }) => has
  ? <svg class="plan-mark" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d={CHECK_PATH} /></svg>
  : <svg class="plan-mark plan-mark-none" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /></svg>;

const PlanCardView: FC<{ lang: Lang; card: PlanCard }> = ({ lang, card }) => (
  <div class={card.offered ? "plan-card plan-card-offer" : "plan-card"}>
    <div class="plan-card-head">
      <h3>{card.name}</h3>
      {card.tag ? <ProTag lang={lang} /> : null}
      {card.current ? <span class="plan-current">{t(lang, "plans.current")}</span> : null}
    </div>
    <p class="plan-price"><span class="plan-name">{card.name}</span> <span class="plan-figure">{card.price as any}</span></p>
    <p class="plan-for">{card.forLine}</p>
    <ul class="plan-list">
      {PLAN_ROWS.map((row) => {
        const { wording, has } = rowFor(row, card.plan);
        return has ? (
          <li><Mark has /><span>{planLine(lang, wording)}</span></li>
        ) : (
          <li class="plan-lacks"><Mark has={false} /><span><span class="visually-hidden">{`${t(lang, "plans.lacks")} `}</span>{planLine(lang, wording)}</span></li>
        );
      })}
    </ul>
    {/* Drawn when empty too, so the note keeps the last row. */}
    <p class="plan-buttons">
      {card.actions.map((a, i) => <>{i ? " " : null}<a href={a.href} class={a.primary ? "btn btn-primary" : "btn"}>{a.label}</a></>)}
    </p>
    {card.note ? <p class="plan-note">{card.note}</p> : null}
  </div>
);

// The cards side by side, in the order given, the same height and every
// row at one height across them (public/styles.css .plan-cards). A third
// plan is one more card.
export const PlanCards: FC<{ lang: Lang; plans: readonly PlanCard[] }> = ({ lang, plans }) => (
  <div class="plan-cards" style={`--plan-rows:${PLAN_ROWS.length};--plan-card-rows:${PLAN_CARD_ROWS}`}>
    {plans.map((card) => <PlanCardView lang={lang} card={card} />)}
  </div>
);

// Who reads the cards, and where: a tease panel (a reader without the
// page's feature, so signed out or Free), the Pro page, the billing page.
export type PlanReader = "out" | "free" | "pro";
export type PlanPlace = "tease" | "pro_page" | "billing";

// Free and Pro as every page draws them. The links: an account is made at
// the sign-in page; Pro's button for a reader not signed in is the sign-in
// page returning to billing (SUBSCRIBE_PATH), with the three steps under it
// while Pro is on sale; a Free account goes to its billing page, or on that
// page to its Subscribe panel while Pro is on sale; a reader's own plan has
// no way to buy it; the Pro page is offered everywhere but on itself. The
// billing page's head already links the account, so its cards do not.
export const SUBSCRIBE_PATH = "/account/sign-in?next=/account/billing";

export function planCards(lang: Lang, o: { price: ProPrice | null; reader: PlanReader; place: PlanPlace }): PlanCard[] {
  const { price, reader, place } = o;
  const go = (href: string, key: Key, primary = false): PlanAction => ({ href, label: t(lang, key), primary });
  const account = place === "billing" ? [] : [go("/account", "expiring.pro_account")];
  const about = reader !== "pro" && place !== "pro_page" ? [go("/pro", "pro.about_button")] : [];
  const buy = reader === "out" ? [go(SUBSCRIBE_PATH, "expiring.pro_sign_in", true)]
    : place !== "billing" ? [go("/account/billing", "propage.billing", true)]
    : price ? [go("#subscribe", "billing.panel_subscribe", true)] : [];
  const figure = (n: string) => t(lang, "plans.figure", { n: decimal(lang, n) });
  return [
    {
      plan: "free",
      name: t(lang, "plans.free"),
      price: <strong class="plan-amount">{figure("0")}</strong>,
      forLine: t(lang, "plans.free_for"),
      current: reader === "free",
      actions: reader === "out" ? [go("/account/sign-in", "plans.create_free")] : reader === "free" ? account : [],
      note: reader === "out" ? t(lang, "propage.sign_in_note") : null,
    },
    {
      plan: "pro",
      name: t(lang, "pro.tag"),
      tag: true,
      offered: true,
      price: price
        ? tj(lang, "plans.price", { monthly: <strong class="plan-amount">{figure(price.monthly)}</strong>, yearly: figure(price.yearly) })
        : <span class="muted">{t(lang, "plans.unavailable")}</span>,
      forLine: t(lang, "plans.pro_for"),
      current: reader === "pro",
      actions: reader === "pro" ? account : [...buy, ...about],
      // The taxes named with the price, so no amount appears only at checkout, and who sells it;
      // for a reader not signed in, the steps from the button to Stripe's page first.
      note: price && reader !== "pro"
        ? (reader === "out" ? `${t(lang, "propage.subscribe_steps")} ${t(lang, "plans.seller")}` : t(lang, "plans.seller"))
        : null,
    },
  ];
}

// The tease panel at the foot of a Pro page's free view: "Part of Pro" with
// the chip, what the full page holds, what stays free of it, then the plan
// cards with the price and the way in. Nothing to dismiss and nothing timed:
// the page was the reader's choice. foot is a note under the cards (the
// same-day page's legend). A reader here lacks the page's feature, so a
// session is a Free one.
export const ProPanel: FC<{ lang: Lang; text: unknown; free?: unknown; price: ProPrice | null; signedIn: boolean; foot?: unknown }> = (
  { lang, text, free, price, signedIn, foot },
) => (
  <Panel title={t(lang, "expiring.pro_title")} class="pro-panel" tools={<ProTag lang={lang} />} foot={foot}>
    <p>{text as any}</p>
    {free ? <p>{free as any}</p> : null}
    <PlanCards lang={lang} plans={planCards(lang, { price, reader: signedIn ? "free" : "out", place: "tease" })} />
  </Panel>
);
