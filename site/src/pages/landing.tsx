// The landing page: what "/" shows a reader without a signed-in session
// (docs/landing.md). A document of its own, not the railed app shell: a navy
// hero with the Canada map of open tenders, the scrolling band of the largest
// award holders, four figures, three feature bands with product shots built
// from the live rows, a band on matching notices with one example match drawn
// from sample values (switch on only), the three steps, the plan cards and a
// closing band, then the site's footer. A signed-in reader gets the app home
// (pages/home.tsx) at the same address, so both answers carry Vary: Cookie
// while the accounts switch is on. Every reader finds the app home at
// /overview too, the nav's first link and the footer's.
//
// It reads stats.json (a missing file is the no-data page, as on the app
// home), the expiring index and the 3-month window's first page (the free
// window the radar page reads too), and one profile entry: the organization
// with the largest award value this year. Any of the last three missing
// leaves its section without its rows; nothing here answers 500 for one.
//
// While the switch is off nothing is Pro: no plan cards, chip, price or Pro
// line, no link to /pro or /analytics outside the footer (where the footer
// has none either), no sign-in, and no band on matching notices, which a
// free account makes. The pieces that change between the two
// states each have their own class, so the switch guards
// (test/accounts-switch.test.ts, test/radar-gate.test.ts) can name them.
//
// The band's logos come from Brandfetch's Logo API, embedded as <img> links
// only while the Worker has a client id (env.BRANDFETCH_CLIENT_ID); the site
// never fetches or stores a logo. The copy says the site holds records on
// these organizations and never implies that they use or endorse it
// (counsel's condition, 2026-11-08).
//
// The Ultra card holds a one-field form in its button's place (operator,
// 2026-11-08): the address goes to /interest with kind=ultra (ultraSubmit
// below), a row of the forms database's interest table like every email
// list's, read later only by the Ultra message (account/announce.tsx).

import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { html } from "hono/html";
import type { FC } from "hono/jsx";
import { MATCH_MAX, type FitNotice, type MatchBlock, type Score, scoreNotice } from "../../public/fit.js";
import { type Plan, RULES } from "../account/entitlements";
import { signInTo } from "../account/fit_panels";
import { SESSION_COOKIE, readSession } from "../account/session";
import { ultraFigures } from "../account/stripe";
import { accountsEnabled } from "../account/switch";
import { followValue } from "../account/watch_events";
import { INSET_EXTENT, INSET_FRAME, INSET_PATHS, MAP_HEIGHT, MAP_LABELS, MAP_PATHS, MAP_WIDTH, type MaritimeProvince } from "../canada_map";
import { recordsText } from "../chart";
import { type Clock, clockOf, tenderState } from "../closing";
import { CLOSING_SOON_DAYS, PROVINCES } from "../constants";
import {
  type AwardRow, type ExpiringRow, type Profile, type ProvinceCounts, type Stats, type TenderRow, EXPIRING_WINDOWS, competitiveOf,
  loadExpiringIndex, loadExpiringPage, loadProfile, loadStats, sourceLoaded,
} from "../data";
import type { AppEnv } from "../env";
import {
  competitiveLabel, decimal, fmtInt, fmtMoney, fmtMoneyShort, fmtPct, pick, provinceName, sourceLabel, t, tj, tn,
  type Key, type Lang,
} from "../i18n";
import { FitDisclaimer, type ReasonContext, bandText, reasonText } from "../fit";
import { BrandMark, BrandWordmark, FooterRow, ICONS_VERSION, MetaTags, noDataPage, todayOf, varyOnCookie } from "../layout";
import { LANDING_ORGS_A, LANDING_ORGS_B, type LandingOrg, brandfetchLogoUrl } from "../landing_orgs";
import {
  type ProPrice, ProTag, SUBSCRIBE_PATH, ULTRA_SUBSCRIBE_PATH, UltraTag, checkoutPrice, planLine, planRows, rowFor, sameDayHours, ultraCheckoutPrice,
  ultraLines,
} from "../pro";
import { MAX_YEARS } from "../records_db";
import { DAILY_RUNS_UTC } from "../refresh";
import { homeJsonLd, pageSeo } from "../seo";
import { newestFirst } from "./awards";
import { soonestFirst } from "./expiring";
import { FeedLinks } from "./feeds";
import { homePage } from "./home";
import { mapStep, stepRanges } from "./home_map";
import {
  EMAIL_MAX, INSERT_INTEREST, type InterestPost, ULTRA_KIND, ULTRA_PARAMS, field, newToken, normalizeEmail,
} from "./interest";
import { money, provincesText } from "./shared";

// The stylesheet's version: bump it with any change to public/landing.css so
// a cached copy is never paired with new markup.
export const LANDING_VERSION = 6;

// The display face, self-hosted beside Inter (public/fonts, SIL Open Font
// License in BricolageGrotesque-OFL.txt), preloaded by this page alone.
export const DISPLAY_FONT = "/fonts/BricolageGrotesque-Variable.woff2";

// How many rows each product shot shows.
const NEW_ROWS = 5;
const AWARD_ROWS = 3;
const ENDING_ROWS = 3;
// The names a profile shot lists after "Also recorded as:".
const ALSO_NAMES = 4;

// -- the route -----------------------------------------------------------------------

// "/": the app home for a signed-in reader, the landing page for anyone else.
// Nothing about a session is read while the accounts switch is off, or
// without the session cookie. A session the accounts database cannot confirm
// during an outage (the reader holds a cookie the isolate has not verified)
// gets the app home too: it is a reader's tool, and the landing page only
// introduces it.
export async function rootPage(c: Context<AppEnv>): Promise<Response> {
  return (await signedIn(c)) ? homePage(c) : landingPage(c, null, 200);
}

async function signedIn(c: Context<AppEnv>): Promise<boolean> {
  if (!accountsEnabled(c.env) || !getCookie(c, SESSION_COOKIE)) return false;
  try {
    return (await readSession(c)).state !== "none";
  } catch {
    return false;
  }
}

// -- small pieces --------------------------------------------------------------------

// A count in the figures' short form from a million up ("1.34M", "1,34 M"),
// with the exact count as its title; below a million the whole count.
function shortCount(n: number, lang: Lang): { text: string; exact?: string } {
  if (n < 1_000_000) return { text: fmtInt(n, lang) };
  return { text: t(lang, "landing.count_m", { n: decimal(lang, (n / 1_000_000).toFixed(2)) }), exact: fmtInt(n, lang) };
}

// Whole days from the clock's date to a date ("2026-11-23"), never below zero.
function daysTo(day: string, clock: Clock): number {
  const d = (Date.parse(`${day.slice(0, 10)}T00:00:00Z`) - Date.parse(`${clock.today}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(d) && d > 0 ? Math.round(d) : 0;
}

const ARROW = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;

// The plan cards' marks, on the site's 16-unit box (src/pro.tsx): a check for
// what the plan has, a hollow ring for what it lacks.
const CHECK_PATH = "M6.5 11.3 3.2 8l1.1-1.1 2.2 2.2 5.2-5.2 1.1 1.1z";
const Check: FC = () => <svg class="lp-ck" viewBox="0 0 16 16" aria-hidden="true"><path d={CHECK_PATH} /></svg>;
const Ring: FC = () => <svg class="lp-ck lp-ck-none" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" /></svg>;

// Ultra's chip is the site's own (src/pro.tsx UltraTag), drawn on the Ultra
// card alone at this page's 11 px, since chips live in the rail, the window
// tabs and the plan cards only.
export { ULTRA_GLYPH_PATH } from "../pro";

// -- the hero's map ------------------------------------------------------------------

const MARITIMES: readonly MaritimeProvince[] = ["NB", "NS", "PE"];
// The two lines of a label sit around its point: the code above, the count below.
const LABEL_UP = 2;
const LABEL_LINE = 24;

const MapCard: FC<{ lang: Lang; open: ProvinceCounts }> = ({ lang, open }) => {
  const count = (p: string) => open.provinces[p] ?? 0;
  const top = Math.max(0, ...PROVINCES.map(count));
  const n = fmtInt(open.n, lang);
  return (
    <div class="lp-mapcard">
      <div class="lp-map-head">
        <b class="num">{tn(lang, "landing.map_head_one", "landing.map_head_many", open.n, { n })}</b>
        <span>{t(lang, "landing.map_sub")}</span>
      </div>
      <svg class="lp-map" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label={t(lang, "landing.map_label", { n })}>
        {PROVINCES.map((p) => (
          <path class={`pv s${mapStep(count(p), top)}`} d={MAP_PATHS[p]}>
            <title>{tn(lang, "landing.map_title_one", "landing.map_title_many", count(p), { province: provinceName(lang, p), n: fmtInt(count(p), lang) })}</title>
          </path>
        ))}
        <rect class="lp-extent" x={INSET_EXTENT.x} y={INSET_EXTENT.y} width={INSET_EXTENT.w} height={INSET_EXTENT.h} />
        <rect class="lp-inset" x={INSET_FRAME.x} y={INSET_FRAME.y} width={INSET_FRAME.w} height={INSET_FRAME.h} />
        {MARITIMES.map((p) => <path class={`pv s${mapStep(count(p), top)}`} d={INSET_PATHS[p]} />)}
        {/* Each label carries its province's step, so the brightest step can take dark labels. */}
        {PROVINCES.map((p) => {
          const { x, y } = MAP_LABELS[p];
          const step = mapStep(count(p), top);
          return (
            <>
              <text class={`lb t${step}`} x={x} y={y - LABEL_UP}>{p}</text>
              <text class={`ln t${step}`} x={x} y={y - LABEL_UP + LABEL_LINE}>{fmtInt(count(p), lang)}</text>
            </>
          );
        })}
      </svg>
      <ul class="lp-legend" aria-label={t(lang, "map.legend")}>
        <li><i class="s0"></i>{fmtInt(0, lang)}</li>
        {stepRanges(top).map((r) => (
          <li><i class={`s${r.step}`}></i>{r.lo === r.hi ? fmtInt(r.lo, lang) : t(lang, "map.range", { lo: fmtInt(r.lo, lang), hi: fmtInt(r.hi, lang) })}</li>
        ))}
        <li class="lp-national">{t(lang, "map.national", { n: fmtInt(open.not_stated, lang) })}</li>
      </ul>
    </div>
  );
};

// -- the band --------------------------------------------------------------------------

// The marks' type styles, in turn, so the names read as a band of different
// wordmarks without imitating any.
const MARK_STYLES = ["", "caps", "light", "serifish", "wide"];

const Marks: FC<{ orgs: readonly LandingOrg[]; logo: string | null; copy?: boolean }> = ({ orgs, logo, copy }) => (
  <>
    {orgs.map((o, i) => (
      <a class={`lp-mark ${MARK_STYLES[i % MARK_STYLES.length]}`.trim()} href={`/organizations/${o.id}`} tabindex={copy ? -1 : undefined}>
        {logo ? <img class="lp-logo" src={brandfetchLogoUrl(o.domain, logo)} width="40" height="40" alt="" loading="lazy" /> : null}
        {o.name}
      </a>
    ))}
  </>
);

// One row of the band: the names, then the same names again (hidden from
// assistive technology and the tab order) so the scroll loops without a gap.
const Marquee: FC<{ orgs: readonly LandingOrg[]; logo: string | null; rev?: boolean }> = ({ orgs, logo, rev }) => (
  <div class="lp-marquee">
    <div class={rev ? "lp-track lp-rev" : "lp-track"}>
      <Marks orgs={orgs} logo={logo} />
      <span class="lp-dup" aria-hidden="true"><Marks orgs={orgs} logo={logo} copy /></span>
    </div>
  </div>
);

// -- the product shots -----------------------------------------------------------------

type ShotRow = { title: string; right: string; small?: string; sub: string; soon?: boolean };

const Shot: FC<{ head: string; n?: string; rows: readonly ShotRow[]; class?: string }> = ({ head, n, rows, class: cls }) => (
  <div class={cls ? `lp-shot ${cls}` : "lp-shot"}>
    <div class="lp-shot-head"><span>{head}</span>{n !== undefined ? <span class="lp-n num">{n}</span> : null}</div>
    {rows.map((r) => (
      <div class="lp-row">
        <span class="lp-ti">{r.title}</span>
        <span class={r.soon ? "lp-rt lp-soon" : "lp-rt"}>{r.right}{r.small ? <small>{r.small}</small> : null}</span>
        <span class="lp-su">{r.sub}</span>
      </div>
    ))}
  </div>
);

const join = (parts: readonly (string | null | undefined)[]) => parts.filter((p): p is string => !!p).join(" · ");

function newRows(lang: Lang, rows: readonly TenderRow[], clock: Clock): ShotRow[] {
  return rows.map((r) => {
    const day = r.closing && /^\d{4}-\d{2}-\d{2}/.test(r.closing) ? r.closing.slice(0, 10) : null;
    const days = day ? daysTo(day, clock) : null;
    return {
      title: pick(lang, r.title_en, r.title_fr) ?? r.reference,
      right: day ? t(lang, "tender.lead_closes", { date: day }) : "",
      small: days !== null ? tn(lang, "landing.days_one", "landing.days_many", days, { n: fmtInt(days, lang) }) : undefined,
      sub: join([pick(lang, r.buyer_en, r.buyer_fr), provincesText(lang, r.provinces, r.provinces_derived)]),
      soon: tenderState("open", r.closing, clock) === "closing",
    };
  });
}

function awardRows(lang: Lang, rows: readonly AwardRow[]): ShotRow[] {
  return rows.map((r) => ({
    title: r.organization ?? t(lang, "common.not_stated"),
    right: money(lang, r.value, r.currency),
    sub: join([pick(lang, r.title_en, r.title_fr), pick(lang, r.buyer_en, r.buyer_fr), competitiveOf(r.competitive) === false ? competitiveLabel(lang, r.competitive) : null]),
  }));
}

function endingRows(lang: Lang, rows: readonly ExpiringRow[]): ShotRow[] {
  return rows.map((r) => {
    const growth = r.value_growth !== null && r.value_growth > 0 ? `+${fmtPct(r.value_growth, 1, lang)}` : null;
    const amended = r.n_amendments > 0
      ? join([tn(lang, "expiring.amendments_one", "expiring.amendments_many", r.n_amendments, { n: fmtInt(r.n_amendments, lang) }), growth])
      : null;
    return {
      title: r.organization ?? t(lang, r.supplier_withheld ? "expiring.withheld" : "common.not_stated"),
      right: r.days_left === 0 ? t(lang, "expiring.ends_today")
        : tn(lang, "expiring.days_left_one", "expiring.days_left_many", r.days_left, { n: fmtInt(r.days_left, lang) }),
      small: r.value !== null ? money(lang, r.value, r.currency) : undefined,
      sub: join([pick(lang, r.buyer_en, r.buyer_fr), amended, competitiveOf(r.competitive) === false ? competitiveLabel(lang, r.competitive) : null]),
      soon: r.days_left <= CLOSING_SOON_DAYS,
    };
  });
}

// The profile shot: the organization's name, the other names its records
// carry, its buttons as its page draws them, and a tile a source.
const ProfileShot: FC<{ lang: Lang; profile: Profile; on: boolean; lobbying: boolean }> = ({ lang, profile, on, lobbying }) => {
  const org = profile.organization;
  const others = [...new Set(profile.names.map((n) => n.name).filter((n) => n && n !== org.display_name))].slice(0, ALSO_NAMES);
  const tiles: { label: string; value: string; note: string }[] = [];
  for (const [source, n, total] of [
    ["awards", org.n_awards, org.total_awards], ["contracts", org.n_contracts, org.total_contracts], ["history", org.n_history, org.total_history],
  ] as const) {
    if (n > 0) tiles.push({ label: sourceLabel(lang, source), value: total !== null ? fmtMoneyShort(total, lang) : fmtInt(n, lang), note: recordsText(lang, n) });
  }
  if (lobbying && org.n_lobbying > 0) {
    tiles.push({ label: sourceLabel(lang, "lobbying"), value: fmtInt(org.n_lobbying, lang), note: t(lang, "landing.tile_reports") });
  }
  // The shot's controls lead where the profile's own would: Follow to the
  // sign-in with the profile as the way back and as what to follow (what the
  // profile's own form posts for a reader without a session,
  // account/watch_pages.tsx, so signing in follows it), Analytics to the
  // organization's view, and with the switch off the watchlist's button to
  // the profile, where the watchlist script runs. Links, so the shot is not
  // hidden from assistive technology.
  const profilePath = `/organizations/${org.id}`;
  const followPath = `/account/sign-in?next=${encodeURIComponent(profilePath)}&follow=${encodeURIComponent(followValue("organization", org.id))}`;
  return (
    <div class="lp-shot">
      <div class="lp-profile">
        <div class="lp-nm"><a href={profilePath}>{org.display_name}</a></div>
        {others.length ? <p class="lp-al">{`${t(lang, "org.also_recorded")} ${others.join(", ")}`}</p> : null}
        <div class="lp-acts">
          {on
            ? <>
              <a class="lp-btn lp-btn-sm lp-btn-fill" href={followPath}>{t(lang, "watches.button")}</a>
              <a class="lp-btn lp-btn-sm" href={`${profilePath}/analytics`} rel="nofollow">{t(lang, "rail.analytics")}</a>
            </>
            : <a class="lp-btn lp-btn-sm lp-btn-fill" href={profilePath}>{t(lang, "watch.off")}</a>}
        </div>
      </div>
      {tiles.length ? (
        <div class="lp-tiles">
          {tiles.map((x) => <div class="lp-tile"><span>{x.label}</span><b class="num">{x.value}</b><small>{x.note}</small></div>)}
        </div>
      ) : null}
    </div>
  );
};

// -- the matching notices' example ---------------------------------------------------------

// One match as /account/matches draws it (account/fit_pages.tsx): the band,
// the points out of MATCH_MAX, every reason with its record counts and its
// points, then the line every match carries. Scored by the rules themselves
// (public/fit.js) from fixed sample values, so its points add up as the
// rules count them; the organization and the notice are made up, as the
// tests' fixtures are, and the card's head says it is an example. The class's
// name is UNSPSC's, as the open notices give it. Nothing is read.
export const SAMPLE_ORG = "Sample Facility Services Ltd.";
export const SAMPLE_BLOCK: MatchBlock = {
  fy: [2021, 2025], n: [12, 4, 0], coded: [12, 4], newest: null,
  classes: [["721015", 9, 3]], families: [["7210", 10, 4]], segments: [["72", 12, 4]],
  buyers: [], provinces: [["ON", 8, 2]], types: [["Request for Proposal", 6, 1]], held: [],
};
export const SAMPLE_NOTICE: FitNotice = {
  codes: ["72101507"], segments: ["72"], provinces: ["ON"], provinces_derived: null, buyer_id: null, notice_type_en: "Request for Proposal",
};
const SAMPLE_CONTEXT: ReasonContext = {
  name: SAMPLE_ORG,
  notice: { notice_type_en: "Request for Proposal", notice_type_fr: "Demande de propositions" },
  levels: [{ code: "721015", en: "Building support services", fr: "Services de soutien des bâtiments", n: 1 }],
};
let sample: Score | null = null;
export const sampleScore = (): Score => (sample ??= scoreNotice(SAMPLE_BLOCK, SAMPLE_NOTICE, null));

// The section's action: the sign-in, returning to the page that names the organization.
export const MATCH_SIGN_IN = signInTo("/account/organization");

const MatchShot: FC<{ lang: Lang }> = ({ lang }) => {
  const score = sampleScore();
  return (
    <div class="lp-shot lp-match">
      <div class="lp-shot-head"><span>{t(lang, "landing.match_example")}</span></div>
      <div class="lp-match-body">
        <p class="lp-match-band">
          <b>{bandText(lang, score.band)}</b> <span>{t(lang, "fit.points", { n: fmtInt(score.points, lang), max: fmtInt(MATCH_MAX, lang) })}</span>
        </p>
        <p class="lp-match-ti">{t(lang, "landing.match_title")}</p>
        <p class="lp-match-su">{t(lang, "landing.match_for", { name: SAMPLE_ORG })}</p>
      </div>
      <ul class="lp-reasons">
        {score.reasons.map((r) => (
          <li>
            <span>{reasonText(lang, r, SAMPLE_CONTEXT)}</span>
            <b class="num" aria-hidden="true">{t(lang, "fit.pts", { n: fmtInt(r.points, lang) })}</b>
            <span class="visually-hidden">{t(lang, "fit.pts_aria", { n: fmtInt(r.points, lang) })}</span>
          </li>
        ))}
      </ul>
      <FitDisclaimer lang={lang} />
    </div>
  );
};

// -- the plans -------------------------------------------------------------------------

// A plan's rows, as the cards on /pro draw them (src/pro.tsx planRows and
// rowFor): the rows one of the plans on sale has, each in this plan's own
// wording, a row it lacks marked so. While Ultra is on sale all three cards
// draw the same rows, so their lists stay level and none can differ from
// /pro's; before, the two cards draw the rows Free or Pro has, and Ultra's
// card lists its own lines (ultraRows).
const PlanList: FC<{ lang: Lang; plan: Plan; plans: readonly Plan[]; wrap?: boolean }> = ({ lang, plan, plans, wrap }) => (
  <ul class={wrap ? "lp-plan-list lp-plan-list-wrap" : "lp-plan-list"}>
    {planRows(plans).map((row) => {
      const { wording, has } = rowFor(row, plan);
      return has ? (
        <li><Check /><span>{planLine(lang, wording)}</span></li>
      ) : (
        <li class="lp-lacks"><Ring /><span><span class="visually-hidden">{`${t(lang, "plans.lacks")} `}</span>{planLine(lang, wording)}</span></li>
      );
    })}
  </ul>
);

// Ultra's rows while it is not on sale: "Everything in Pro", then what is
// built, in Ultra's own lines with its figures (src/pro.tsx ultraLines, the
// lines the card lists once it is on sale, the saved views by email among
// them since they shipped), then the part still planned, saying so. Every row
// is one Ultra will have (operator's ruling on tier lines, 2026-11-06). Once
// it is on sale (ultraOnSale), the card lists what Ultra holds that day, and
// the planned line leaves it.
export const ULTRA_PLANNED = ["landing.ultra_builder"] as const;
export const ultraRows = (lang: Lang): string[] =>
  [t(lang, "landing.everything_pro"), ...ultraLines(lang), ...ULTRA_PLANNED.map((k) => t(lang, k))];

// The Ultra card's form and what stands in its place after a post: the line
// that says the address is kept, or the form again with the address as typed
// and a line saying what to fix.
export type UltraState = { done?: boolean; error?: Key; email?: string };

// The anchor the form's address carries, so a post without the script lands
// back on the card.
export const ULTRA_ANCHOR = "ultra";

// One address and the card's button, with the honeypot every form carries.
// public/interest.js posts it with the x-interest-fragment header and puts
// the block it answers with in this one's place; without the script the
// answer is this page with the card in its new state. The error line carries
// interest-error too, the class the script looks for to put the cursor back
// in the field.
export const UltraBox: FC<{ lang: Lang } & UltraState> = ({ lang, done, error, email }) => (
  <div class="lp-ultra" data-interest="">
    {error ? <p class="lp-ultra-error interest-error" role="alert">{t(lang, error)}</p> : null}
    {done ? (
      <div class="lp-ultra-done" role="status">
        <p class="lp-ultra-thanks">{t(lang, "landing.ultra_done")}</p>
        <p class="lp-ultra-noted">{t(lang, "landing.ultra_noted", { email: email ?? "" })}</p>
      </div>
    ) : (
      <form method="post" action={`/interest#${ULTRA_ANCHOR}`} class="lp-ultra-form" data-interest-form="">
        <input type="hidden" name="kind" value={ULTRA_KIND} />
        <input type="hidden" name="lang" value={lang} />
        <div class="hp"><label>{t(lang, "form.honeypot")}<input name="website" type="text" tabindex={-1} autocomplete="off" /></label></div>
        <label class="lp-ultra-field">
          <span class="visually-hidden">{t(lang, "interest.email")}</span>
          <input name="email" type="email" required maxlength={EMAIL_MAX} autocomplete="email" spellcheck={false}
            placeholder={t(lang, "interest.email")} value={email ?? ""} />
        </label>
        <button type="submit" class="lp-btn lp-ultra-btn">{t(lang, "landing.ultra_button")}</button>
      </form>
    )}
  </div>
);

// The Ultra card. While Ultra is not on sale: the "Coming soon" tag, with
// the price once its two figures are set (planned; "Price to be set" until
// then), its rows and the one-field form. While it is (sale holds its
// figures): the monthly figure large and the yearly beside it, the "for"
// line, every row of the plan cards in Ultra's own wording (the rows of its
// card on /pro, in the same order), and Subscribe to Ultra
// through the sign-in page, outlined in sapphire as the form's button is;
// the form leaves the card, and the addresses it kept stay for the message.
const UltraCard: FC<{ lang: Lang; ultra: UltraState; sale: ProPrice | null; planned: ProPrice | null }> = ({ lang, ultra, sale, planned }) => {
  const figure = (n: string) => t(lang, "plans.figure", { n: decimal(lang, n) });
  return sale ? (
    <div class="lp-plan lp-plan-ultra" id={ULTRA_ANCHOR}>
      <h3 class="lp-plan-nm">{t(lang, "ultra.tag")}<UltraTag lang={lang} size={11} /></h3>
      <p class="lp-pr">{figure(sale.monthly)}<small>{t(lang, "landing.price_rest", { yearly: figure(sale.yearly) })}</small></p>
      <p class="lp-for">{t(lang, "plans.ultra_for")}</p>
      <PlanList lang={lang} plan="ultra" plans={ON_SALE} wrap />
      <p class="lp-plan-acts"><a class="lp-btn" href={ULTRA_SUBSCRIBE_PATH}>{t(lang, "plans.ultra_subscribe")}</a></p>
    </div>
  ) : (
    <div class="lp-plan lp-plan-ultra" id={ULTRA_ANCHOR}>
      <h3 class="lp-plan-nm">{t(lang, "ultra.tag")}<UltraTag lang={lang} size={11} /></h3>
      {planned ? (
        <p class="lp-pr">
          {figure(planned.monthly)} <span class="lp-soon-tag">{t(lang, "landing.ultra_soon")}</span>
          <small>{t(lang, "landing.price_rest", { yearly: figure(planned.yearly) })}</small>
        </p>
      ) : (
        <p class="lp-pr lp-pr-unset">{t(lang, "landing.ultra_price")} <span class="lp-soon-tag">{t(lang, "landing.ultra_soon")}</span></p>
      )}
      <p class="lp-for">{t(lang, "plans.ultra_for")}</p>
      <ul class="lp-plan-list lp-plan-list-wrap">
        {ultraRows(lang).map((line) => <li><Check /><span>{line}</span></li>)}
      </ul>
      <UltraBox lang={lang} {...ultra} />
    </div>
  );
};

// The plans whose rows the cards draw: all three while Ultra is on sale, the
// two before.
const ON_SALE: readonly Plan[] = ["free", "pro", "ultra"];
const BEFORE_ULTRA: readonly Plan[] = ["free", "pro"];

const Plans: FC<{ lang: Lang; price: ProPrice | null; ultra: UltraState; sale: ProPrice | null; planned: ProPrice | null }> = ({ lang, price, ultra, sale, planned }) => {
  const figure = (n: string) => t(lang, "plans.figure", { n: decimal(lang, n) });
  const plans = sale ? ON_SALE : BEFORE_ULTRA;
  return (
    <section class="lp-pricing" aria-labelledby="lp-plans-h">
      <div class="lp-wrap">
        <p class="lp-eyebrow">{t(lang, "landing.plans_eyebrow")}</p>
        <h2 id="lp-plans-h">{t(lang, "landing.plans_heading")}</h2>
        <p class="lp-sub">{t(lang, "landing.plans_sub")}</p>
        <div class="lp-plans">
          <div class="lp-plan">
            <h3 class="lp-plan-nm">{t(lang, "plans.free")}</h3>
            <p class="lp-pr">{figure("0")}</p>
            <p class="lp-for">{t(lang, "plans.free_for")}</p>
            <PlanList lang={lang} plan="free" plans={plans} />
            <p class="lp-plan-acts"><a class="lp-btn" href="/account/sign-in">{t(lang, "plans.create_free")}</a></p>
          </div>
          <div class="lp-plan lp-plan-pro">
            <h3 class="lp-plan-nm">{t(lang, "pro.tag")}<ProTag lang={lang} /></h3>
            {price
              ? <p class="lp-pr">{figure(price.monthly)}<small>{t(lang, "landing.price_rest", { yearly: figure(price.yearly) })}</small></p>
              : <p class="lp-pr lp-pr-unset">{t(lang, "plans.unavailable")}</p>}
            <p class="lp-for">{t(lang, "plans.pro_for")}</p>
            <PlanList lang={lang} plan="pro" plans={plans} />
            <p class="lp-plan-acts">
              <a class="lp-btn lp-btn-fill" href={SUBSCRIBE_PATH}>{t(lang, "expiring.pro_sign_in")}</a>
              <a class="lp-btn" href="/pro">{t(lang, "landing.everything_pro")}</a>
            </p>
          </div>
          <UltraCard lang={lang} ultra={ultra} sale={sale} planned={planned} />
        </div>
        {price ? <p class="lp-plans-note">{t(lang, "plans.seller")}</p> : null}
      </div>
      {/* Inside the section, so it comes and goes with the plan cards (test/home.ts LANDING_SWITCH_PIECES). */}
      <script src="/interest.js" defer></script>
    </section>
  );
};

// -- the page ------------------------------------------------------------------------------

// ultra is the Ultra card's state after a post without the script, answered
// at the post's address and never cached; null for the page as "/" serves it.
export async function landingPage(c: Context<AppEnv>, ultra: UltraState | null, status: 200 | 400 | 503): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "site.name");
  const clock = clockOf(c.env);
  const top = stats.top_organizations_year[0];
  const [index, profile] = await Promise.all([
    loadExpiringIndex(c.env).catch(() => null),
    top ? loadProfile(c.env, top.id).catch(() => null) : Promise.resolve(null),
  ]);
  const three = index?.windows.find((w) => w.window === "3m");
  // The 3-month window's first page, as the radar's overview reads it: none
  // to read when the window is empty, null when the file is missing.
  const firstEnding = three && three.n > 0 ? await loadExpiringPage(c.env, "3m", 1).catch(() => null) : [];
  const ultraPrice = await ultraCheckoutPrice(c.env);
  c.header("Cache-Control", ultra ? "no-store" : "public, max-age=300");
  varyOnCookie(c);
  return c.html(html`<!doctype html>${(
    <LandingDoc lang={lang} on={accountsEnabled(c.env)} stats={stats} clock={clock} endingN={three?.n} ending={firstEnding ?? []}
      profile={profile} price={checkoutPrice(c.env)} logo={c.env.BRANDFETCH_CLIENT_ID?.trim() || null} ultra={ultra} ultraPrice={ultraPrice} ultraPlanned={ultraFigures(c.env)} />
  ) as any}`, status);
}

// -- the Ultra card's post -----------------------------------------------------------------

// The card's block alone for interest.js, or the page with the card in its
// new state. Never cached.
async function ultraAnswer(c: Context<AppEnv>, state: UltraState, status: 200 | 400 | 503, fragment: boolean): Promise<Response> {
  if (!fragment) return landingPage(c, state, status);
  c.header("Cache-Control", "no-store");
  c.header("X-Interest-Fragment", "1");
  return c.html(<UltraBox lang={c.get("lang")} {...state} />, status);
}

// POST /interest with kind=ultra (index.tsx), after readInterestPost has
// refused another site's page and read the form; the form cap holds the
// route as it holds every interest post. The address is checked as every
// email list checks it and kept as one row of the interest table: the kind
// ULTRA_KIND, no filter, the plan's name as the label (the same word in both
// languages) and a token for the link off the lists, so no text a visitor
// typed reaches a later message. The same address again stores nothing and
// answers the same. The card exists only with the accounts switch on: with
// it off the post is refused as unreadable, as a kind the site does not
// know is.
export async function ultraSubmit(c: Context<AppEnv>, post: InterestPost): Promise<Response> {
  const { body, fragment } = post;
  const lang = c.get("lang");
  if (!accountsEnabled(c.env)) return c.text(t(lang, "form.rejected"), 400);
  const typed = field(body, "email", EMAIL_MAX + 50);
  if (field(body, "website", 10)) return ultraAnswer(c, { error: "interest.err_rejected", email: typed.slice(0, EMAIL_MAX) }, 400, fragment);
  const email = normalizeEmail(typed);
  if (!email) return ultraAnswer(c, { error: "interest.err_email", email: typed.slice(0, EMAIL_MAX) }, 400, fragment);
  try {
    await c.env.DB.prepare(INSERT_INTEREST)
      .bind(email, ULTRA_KIND, ULTRA_PARAMS, t(lang, "ultra.tag"), lang, new Date().toISOString(), newToken()).run();
  } catch (e) {
    console.error(`interest not stored: ${String(e).slice(0, 200)}`);
    return ultraAnswer(c, { error: "form.err_unavailable", email }, 503, fragment);
  }
  return ultraAnswer(c, { done: true, email }, 200, fragment);
}

// ultraPrice: Ultra's figures while it is on sale (src/pro.tsx
// ultraCheckoutPrice), which turn its card from the waitlist to the price.
// ultraPlanned: the same two figures before it is on sale (account/stripe.ts
// ultraFigures), which the waitlist card shows beside "Coming soon".
type DocProps = {
  lang: Lang; on: boolean; stats: Stats; clock: Clock; endingN: number | undefined; ending: readonly ExpiringRow[];
  profile: Profile | null; price: ProPrice | null; logo: string | null; ultra?: UltraState | null; ultraPrice?: ProPrice | null;
  ultraPlanned?: ProPrice | null;
};

export const LandingDoc: FC<DocProps> = ({ lang, on, stats, clock, endingN, ending, profile, price, logo, ultra = null, ultraPrice = null, ultraPlanned = null }) => {
  const counts = stats.counts;
  const seo = pageSeo("home", lang, { jsonLd: [homeJsonLd(lang)] });
  const lobbying = sourceLoaded("lobbying", null, stats) === true;
  // Track tenders free: a free account while accounts exist, the Atom feeds while they do not.
  const track = on ? "/account/sign-in" : "/feeds";
  const openN = counts.tenders_open ?? stats.map?.open.n;
  const date = todayOf(stats.data_as_of);
  const [deepA, deepB] = [EXPIRING_WINDOWS[1], EXPIRING_WINDOWS[2]].map((w) => fmtInt(Number(w.slice(0, -1)), lang));
  const [hh, mm] = DAILY_RUNS_UTC[0].split(":");

  // The four figures, each from a count the export writes; one it lacks is left out.
  const figures: { text: string; exact?: string; label: string }[] = [];
  if (counts.contracts !== undefined) figures.push({ ...shortCount(counts.contracts, lang), label: t(lang, "landing.stat_contracts") });
  if (counts.grants !== undefined) figures.push({ ...shortCount(counts.grants, lang), label: t(lang, "landing.stat_grants") });
  if (counts.organizations !== undefined) figures.push({ ...shortCount(counts.organizations, lang), label: t(lang, "landing.stat_orgs") });
  const yearTotal = stats.totals?.awards_year;
  if (typeof yearTotal === "number" && counts.awards_year !== undefined) {
    figures.push({
      text: fmtMoneyShort(yearTotal, lang), exact: fmtMoney(yearTotal, lang),
      label: t(lang, "landing.stat_awarded", { n: fmtInt(counts.awards_year, lang) }),
    });
  }
  const asof = counts.awards === undefined || counts.buyers === undefined ? t(lang, "landing.asof_date", { date })
    : lobbying && counts.lobbying !== undefined
      ? t(lang, "landing.asof", { date, awards: fmtInt(counts.awards, lang), lobbying: fmtInt(counts.lobbying, lang), buyers: fmtInt(counts.buyers, lang) })
      : t(lang, "landing.asof_no_lobbying", { date, awards: fmtInt(counts.awards, lang), buyers: fmtInt(counts.buyers, lang) });

  // The shots' rows: the day's new notices still open, the newest award
  // notices, the contracts ending soonest.
  const fresh = stats.new_tenders.filter((r) => tenderState("open", r.closing, clock) !== "closed").slice(0, NEW_ROWS);
  const newN = counts.tenders_new_today ?? stats.new_tenders.length;
  const awards = newestFirst(stats.recent_awards).slice(0, AWARD_ROWS);
  const endingShown = soonestFirst(ending).slice(0, ENDING_ROWS);
  const n = (v: number | undefined) => (v === undefined ? undefined : fmtInt(v, lang));

  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{seo.title}</title>
        <link rel="stylesheet" href={`/landing.css?v=${LANDING_VERSION}`} />
        <script src="/theme.js"></script>
        <link rel="preload" href={DISPLAY_FONT} as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="preload" href="/fonts/InterVariable.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="icon" href={`/favicon.ico?v=${ICONS_VERSION}`} sizes="48x48" />
        <link rel="icon" href={`/favicon.svg?v=${ICONS_VERSION}`} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={`/apple-touch-icon.png?v=${ICONS_VERSION}`} />
        <MetaTags seo={seo} lang={lang} title={t(lang, "site.name")} />
        <FeedLinks lang={lang} />
      </head>
      <body class="lp">
        <a class="skip" href="#main">{t(lang, "nav.skip")}</a>
        <header class="lp-nav">
          <div class="lp-wrap">
            <a class="lp-brand" href="/" aria-label={t(lang, "site.name")}><BrandWordmark name={t(lang, "site.name")} /><BrandMark /></a>
            <nav class="lp-links" aria-label={t(lang, "nav.main_label")}>
              {/* The app home's own address, worded as the rail's group (pages/home.tsx overviewPage). */}
              <a href="/overview">{t(lang, "landing.nav_overview")}</a>
              <a href="/tenders">{t(lang, "nav.tenders")}</a>
              <a href="/awards">{t(lang, "nav.awards")}</a>
              <a href="/expiring">{t(lang, "rail.expiring")}</a>
              {on ? <a class="lp-on" href="/analytics">{t(lang, "rail.analytics")}</a> : null}
              {on ? <a class="lp-on" href="/pro">{t(lang, "pro.tag")}</a> : null}
            </nav>
            <div class="lp-nav-actions">
              {/* An answer to the Ultra card's post sits at /interest, so its switch names "/" outright. */}
              <a href={`${ultra ? "/" : ""}?lang=${lang === "fr" ? "en" : "fr"}`} class="lang-toggle" rel="nofollow">{t(lang, "nav.lang")}</a>
              <button type="button" class="theme-toggle">
                <span class="when-light">{t(lang, "nav.dark")}</span>
                <span class="when-dark">{t(lang, "nav.light")}</span>
              </button>
              {on ? <a class="lp-btn lp-btn-sm lp-on" href="/account/sign-in">{t(lang, "account.sign_in")}</a> : null}
              <a class="lp-btn lp-btn-sm lp-btn-fill lp-nav-cta" href={track}>{t(lang, "landing.cta_track_nav")}</a>
            </div>
          </div>
        </header>

        <main id="main">
          <section class={stats.map ? "lp-hero" : "lp-hero lp-hero-solo"} aria-labelledby="lp-h1">
            <div class="lp-wrap">
              <div class="lp-hero-copy">
                <p class="lp-eyebrow">{t(lang, "landing.eyebrow")}</p>
                <h1 id="lp-h1">{t(lang, "landing.h1_first")}<br />{tj(lang, "landing.h1_second", { last: <em>{t(lang, "landing.h1_last")}</em> })}</h1>
                <p class="lp-lead">{tj(lang, "landing.lead", { free: <b>{t(lang, "landing.lead_free")}</b> })}</p>
                <div class="lp-cta">
                  <a class="lp-btn lp-btn-fill" href={track}>{t(lang, "landing.cta_track")}</a>
                  {on ? <a class="lp-btn lp-on" href="/pro">{t(lang, "landing.cta_plans")}</a> : null}
                </div>
                <form class="lp-search" method="get" action="/search" role="search">
                  <input type="search" name="q" maxlength={200} autocomplete="off" placeholder={t(lang, "search.placeholder")}
                    aria-label={t(lang, "search.label")} />
                  <button type="submit" class="lp-btn">{t(lang, "search.submit")}</button>
                </form>
                <p class="lp-note">
                  {t(lang, "landing.note_search")}
                  {on ? <span class="lp-note-account">{` ${t(lang, "landing.note_account")}`}</span> : null}
                </p>
              </div>
              {stats.map ? <MapCard lang={lang} open={stats.map.open} /> : null}
            </div>
          </section>

          <section class="lp-band" aria-labelledby="lp-band-h">
            <div class="lp-wrap lp-band-head">
              <h2 id="lp-band-h">{t(lang, "landing.band_heading")}</h2>
              <p class="lp-sub">{t(lang, "landing.band_sub")}</p>
            </div>
            <Marquee orgs={LANDING_ORGS_A} logo={logo} />
            <Marquee orgs={LANDING_ORGS_B} logo={logo} rev />
            <div class="lp-wrap"><p class="lp-band-foot">{t(lang, "landing.band_foot")}</p></div>
          </section>

          <section class="lp-stats" aria-label={t(lang, "landing.stats_label")}>
            <div class="lp-wrap">
              {figures.length ? (
                <div class="lp-stat-grid">
                  {figures.map((f) => <div class="lp-stat"><b class="num" title={f.exact}>{f.text}</b><span>{f.label}</span></div>)}
                </div>
              ) : null}
              <p class="lp-asof">{asof}</p>
            </div>
          </section>

          <section class="lp-feat" aria-labelledby="lp-f1">
            <div class="lp-wrap">
              <div class="lp-copy">
                <p class="lp-eyebrow">{t(lang, "nav.tenders")}</p>
                <h2 id="lp-f1">{t(lang, "landing.f1_heading")}</h2>
                <p class="lp-t">{t(lang, "landing.f1_text")}</p>
                <div class="lp-acts">
                  <a class="lp-btn lp-btn-fill" href="/tenders">
                    {openN !== undefined ? t(lang, "landing.f1_button", { n: fmtInt(openN, lang) }) : t(lang, "landing.browse_open")}
                  </a>
                  <a class="lp-link" href="/tenders/new">{t(lang, "map.layer_new_today")}{ARROW}</a>
                </div>
                {on ? <p class="lp-pro">{t(lang, "landing.f1_pro", { h: sameDayHours(lang) })}</p> : null}
              </div>
              {fresh.length ? (
                <div aria-hidden="true"><Shot head={t(lang, "map.layer_new_today")} n={n(newN)} rows={newRows(lang, fresh, clock)} /></div>
              ) : null}
            </div>
          </section>

          <section class="lp-feat lp-paper lp-flip" aria-labelledby="lp-f2">
            <div class="lp-wrap">
              {awards.length || endingShown.length ? (
                <div class="lp-shot-grid" aria-hidden="true">
                  {awards.length ? <Shot head={t(lang, "landing.shot_awarded")} n={n(counts.awards_30d)} rows={awardRows(lang, awards)} /> : null}
                  {endingShown.length ? <Shot head={t(lang, "home.tile_expiring")} n={n(endingN)} rows={endingRows(lang, endingShown)} /> : null}
                </div>
              ) : null}
              <div class="lp-copy">
                <p class="lp-eyebrow">{t(lang, "landing.f2_eyebrow")}</p>
                <h2 id="lp-f2">{t(lang, "landing.f2_heading")}</h2>
                <p class="lp-t">{t(lang, "landing.f2_text")}</p>
                <div class="lp-acts">
                  <a class="lp-btn lp-btn-fill" href="/awards">{t(lang, "landing.f2_button")}</a>
                  <a class="lp-link" href="/expiring">{t(lang, "rail.expiring")}{ARROW}</a>
                </div>
                {on ? <p class="lp-pro">{t(lang, "landing.f2_pro", { a: deepA, b: deepB })}</p> : null}
              </div>
            </div>
          </section>

          <section class="lp-feat" aria-labelledby="lp-f3">
            <div class="lp-wrap">
              <div class="lp-copy">
                <p class="lp-eyebrow">{t(lang, "landing.f3_eyebrow")}</p>
                <h2 id="lp-f3">{t(lang, "landing.f3_heading")}</h2>
                <p class="lp-t">
                  {t(lang, "landing.f3_text")}
                  {on ? <span class="lp-watch">{` ${t(lang, "landing.f3_watch")}`}</span> : null}
                </p>
                <div class="lp-acts">
                  <a class="lp-btn lp-btn-fill" href="/search">{t(lang, "landing.f3_button")}</a>
                  <a class="lp-link" href="/buyers">
                    {counts.buyers !== undefined ? t(lang, "landing.f3_buyers", { n: fmtInt(counts.buyers, lang) }) : t(lang, "landing.f3_buyers_plain")}
                    {ARROW}
                  </a>
                </div>
                {on ? <p class="lp-pro">{t(lang, "landing.f3_pro", { years: fmtInt(MAX_YEARS, lang), n: fmtInt(RULES.pro.watchlists, lang) })}</p> : null}
              </div>
              {profile ? <ProfileShot lang={lang} profile={profile} on={on} lobbying={lobbying} /> : null}
            </div>
          </section>

          {/* With the accounts switch on only: a free account names its organization (test/home.ts LANDING_SWITCH_PIECES). */}
          {on ? (
            <section class="lp-feat lp-paper lp-flip lp-fit" aria-labelledby="lp-f4">
              <div class="lp-wrap">
                <MatchShot lang={lang} />
                <div class="lp-copy">
                  <p class="lp-eyebrow">{t(lang, "landing.f4_eyebrow")}</p>
                  <h2 id="lp-f4">{t(lang, "landing.f4_heading")}</h2>
                  <p class="lp-t">{t(lang, "landing.f4_text")}</p>
                  <div class="lp-acts">
                    <a class="lp-btn lp-btn-fill" href={MATCH_SIGN_IN}>{t(lang, "landing.f4_button")}</a>
                  </div>
                  <p class="lp-pro">
                    {t(lang, "landing.f4_plans", {
                      free: fmtInt(RULES.free.matches, lang), free_mail: fmtInt(RULES.free.match_mail, lang),
                      pro: fmtInt(RULES.pro.matches, lang), pro_mail: fmtInt(RULES.pro.match_mail, lang),
                    })}
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section class="lp-steps" aria-labelledby="lp-how-h">
            <div class="lp-wrap">
              <p class="lp-eyebrow">{t(lang, "landing.how_eyebrow")}</p>
              <h2 id="lp-how-h">{t(lang, "landing.how_heading")}</h2>
              <div class="lp-step-grid">
                <div class="lp-step">
                  <b>{fmtInt(1, lang)}</b>
                  <h3>{t(lang, "landing.step1_heading")}</h3>
                  <p>{t(lang, lobbying ? "landing.step1_text" : "landing.step1_text_no_lobbying", { time: t(lang, "common.time", { hh, mm }) })}</p>
                </div>
                <div class="lp-step">
                  <b>{fmtInt(2, lang)}</b>
                  <h3>{t(lang, "landing.step2_heading")}</h3>
                  <p>{t(lang, "landing.step2_text")}</p>
                </div>
                <div class="lp-step">
                  <b>{fmtInt(3, lang)}</b>
                  <h3>{t(lang, "landing.step3_heading")}</h3>
                  <p class="lp-step3">{on ? t(lang, "landing.step3_text", { h: sameDayHours(lang) }) : t(lang, "landing.step3_text_off")}</p>
                </div>
              </div>
            </div>
          </section>

          {on ? <Plans lang={lang} price={price} ultra={ultra ?? {}} sale={ultraPrice} planned={ultraPlanned} /> : null}

          <section class="lp-close" aria-labelledby="lp-close-h">
            <div class="lp-wrap">
              <div>
                <h2 id="lp-close-h">{t(lang, "landing.close_heading")}</h2>
                <p>{t(lang, "landing.close_text")}</p>
              </div>
              <div class="lp-cta">
                <a class="lp-btn lp-btn-fill" href={track}>{t(lang, "landing.cta_track")}</a>
                <a class="lp-btn" href="/tenders">{t(lang, "landing.browse_open")}</a>
              </div>
            </div>
          </section>
        </main>

        <footer class="site-footer lp-footer">
          <div class="lp-wrap">
            <FooterRow lang={lang} lobbyingLoaded={lobbying} on={on} bugLink={false} />
          </div>
        </footer>
      </body>
    </html>
  );
};
