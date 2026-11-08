// The landing page: what "/" shows a reader without a signed-in session
// (docs/landing.md). A document of its own, not the railed app shell: a navy
// hero with the Canada map of open tenders, the scrolling band of the largest
// award holders, four figures, three feature bands with product shots built
// from the live rows, the three steps, the plan cards and a closing band,
// then the site's footer. A signed-in reader gets the app home
// (pages/home.tsx) at the same address, so both answers carry Vary: Cookie
// while the accounts switch is on.
//
// It reads stats.json (a missing file is the no-data page, as on the app
// home), the expiring index and the 3-month window's first page (the free
// window the radar page reads too), and one profile entry: the organization
// with the largest award value this year. Any of the last three missing
// leaves its section without its rows; nothing here answers 500 for one.
//
// While the switch is off nothing is Pro: no plan cards, chip, price or Pro
// line, no link to /pro or /analytics outside the footer (where the footer
// has none either), no sign-in. The pieces that change between the two
// states each have their own class, so the switch guards
// (test/accounts-switch.test.ts, test/radar-gate.test.ts) can name them.
//
// The band's logos come from Brandfetch's Logo API, embedded as <img> links
// only while the Worker has a client id (env.BRANDFETCH_CLIENT_ID); the site
// never fetches or stores a logo. The copy says the site holds records on
// these organizations and never implies that they use or endorse it
// (counsel's condition, 2026-11-08).

import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { html } from "hono/html";
import type { FC } from "hono/jsx";
import { RULES } from "../account/entitlements";
import { SESSION_COOKIE, readSession } from "../account/session";
import { accountsEnabled } from "../account/switch";
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
  type Lang,
} from "../i18n";
import { BrandMark, BrandWordmark, FooterRow, MetaTags, noDataPage, todayOf, varyOnCookie } from "../layout";
import { LANDING_ORGS_A, LANDING_ORGS_B, type LandingOrg, brandfetchLogoUrl } from "../landing_orgs";
import { type ProPrice, PLAN_ROWS, ProTag, SUBSCRIBE_PATH, checkoutPrice, planLine, rowFor, sameDayHours } from "../pro";
import { MAX_YEARS } from "../records_db";
import { DAILY_RUNS_UTC } from "../refresh";
import { homeJsonLd, pageSeo } from "../seo";
import { newestFirst } from "./awards";
import { soonestFirst } from "./expiring";
import { FeedLinks } from "./feeds";
import { homePage } from "./home";
import { mapStep, stepRanges } from "./home_map";
import { money, provincesText } from "./shared";

// The stylesheet's version: bump it with any change to public/landing.css so
// a cached copy is never paired with new markup.
export const LANDING_VERSION = 1;

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
  return (await signedIn(c)) ? homePage(c) : landingPage(c);
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

// Ultra's chip: the word and the 2 x 2 tiles in sapphire (operator's ruling of
// 2026-11-06), with the long form for assistive technology. Drawn on the
// Ultra card alone, since chips live in the rail, the window tabs and the
// plan cards only.
export const ULTRA_GLYPH_PATH = "M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z";
const UltraTag: FC<{ lang: Lang }> = ({ lang }) => (
  <span class="ultra-tag">
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d={ULTRA_GLYPH_PATH} /></svg>
    {t(lang, "landing.ultra")}
    <span class="visually-hidden">{` ${t(lang, "landing.ultra_hidden")}`}</span>
  </span>
);

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
  return (
    <div class="lp-shot" aria-hidden="true">
      <div class="lp-profile">
        <div class="lp-nm">{org.display_name}</div>
        {others.length ? <p class="lp-al">{`${t(lang, "org.also_recorded")} ${others.join(", ")}`}</p> : null}
        <div class="lp-acts">
          {on
            ? <><span class="lp-btn lp-btn-sm lp-btn-fill">{t(lang, "watches.button")}</span><span class="lp-btn lp-btn-sm">{t(lang, "rail.analytics")}</span></>
            : <span class="lp-btn lp-btn-sm lp-btn-fill">{t(lang, "watch.off")}</span>}
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

// -- the plans -------------------------------------------------------------------------

const PlanList: FC<{ lang: Lang; plan: "free" | "pro" }> = ({ lang, plan }) => (
  <ul class="lp-plan-list">
    {PLAN_ROWS.map((row) => {
      const { wording, has } = rowFor(row, plan);
      return has ? (
        <li><Check /><span>{planLine(lang, wording)}</span></li>
      ) : (
        <li class="lp-lacks"><Ring /><span><span class="visually-hidden">{`${t(lang, "plans.lacks")} `}</span>{planLine(lang, wording)}</span></li>
      );
    })}
  </ul>
);

// Ultra's rows: the planned scope, its unset figures saying so (operator's
// ruling on tier lines, 2026-11-06). Every row is one Ultra will have.
export const ULTRA_ROWS = [
  "landing.everything_pro", "landing.ultra_builder", "landing.ultra_schedule", "landing.ultra_dashboard", "landing.ultra_caps",
] as const;

const Plans: FC<{ lang: Lang; price: ProPrice | null }> = ({ lang, price }) => {
  const figure = (n: string) => t(lang, "plans.figure", { n: decimal(lang, n) });
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
            <PlanList lang={lang} plan="free" />
            <p class="lp-plan-acts"><a class="lp-btn" href="/account/sign-in">{t(lang, "plans.create_free")}</a></p>
          </div>
          <div class="lp-plan lp-plan-pro">
            <h3 class="lp-plan-nm">{t(lang, "pro.tag")}<ProTag lang={lang} /></h3>
            {price
              ? <p class="lp-pr">{figure(price.monthly)}<small>{t(lang, "landing.price_rest", { yearly: figure(price.yearly) })}</small></p>
              : <p class="lp-pr lp-pr-unset">{t(lang, "plans.unavailable")}</p>}
            <p class="lp-for">{t(lang, "plans.pro_for")}</p>
            <PlanList lang={lang} plan="pro" />
            <p class="lp-plan-acts">
              <a class="lp-btn lp-btn-fill" href={SUBSCRIBE_PATH}>{t(lang, "expiring.pro_sign_in")}</a>
              <a class="lp-btn" href="/pro">{t(lang, "landing.everything_pro")}</a>
            </p>
          </div>
          <div class="lp-plan lp-plan-ultra">
            <h3 class="lp-plan-nm">{t(lang, "landing.ultra")}<UltraTag lang={lang} /></h3>
            <p class="lp-pr lp-pr-unset">{t(lang, "landing.ultra_price")} <span class="lp-soon-tag">{t(lang, "landing.ultra_soon")}</span></p>
            <p class="lp-for">{t(lang, "landing.ultra_for")}</p>
            <ul class="lp-plan-list lp-plan-list-wrap">
              {ULTRA_ROWS.map((k) => <li><Check /><span>{t(lang, k)}</span></li>)}
            </ul>
            <p class="lp-plan-acts"><a class="lp-btn" href="/alerts">{t(lang, "landing.ultra_button")}</a></p>
          </div>
        </div>
        {price ? <p class="lp-plans-note">{t(lang, "plans.seller")}</p> : null}
      </div>
    </section>
  );
};

// -- the page ------------------------------------------------------------------------------

export async function landingPage(c: Context<AppEnv>): Promise<Response> {
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
  c.header("Cache-Control", "public, max-age=300");
  varyOnCookie(c);
  return c.html(html`<!doctype html>${(
    <LandingDoc lang={lang} on={accountsEnabled(c.env)} stats={stats} clock={clock} endingN={three?.n} ending={firstEnding ?? []}
      profile={profile} price={checkoutPrice(c.env)} logo={c.env.BRANDFETCH_CLIENT_ID?.trim() || null} />
  ) as any}`);
}

type DocProps = {
  lang: Lang; on: boolean; stats: Stats; clock: Clock; endingN: number | undefined; ending: readonly ExpiringRow[];
  profile: Profile | null; price: ProPrice | null; logo: string | null;
};

export const LandingDoc: FC<DocProps> = ({ lang, on, stats, clock, endingN, ending, profile, price, logo }) => {
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
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <MetaTags seo={seo} lang={lang} title={t(lang, "site.name")} />
        <FeedLinks lang={lang} />
      </head>
      <body class="lp">
        <a class="skip" href="#main">{t(lang, "nav.skip")}</a>
        <header class="lp-nav">
          <div class="lp-wrap">
            <a class="lp-brand" href="/" aria-label={t(lang, "site.name")}><BrandWordmark name={t(lang, "site.name")} /><BrandMark /></a>
            <nav class="lp-links" aria-label={t(lang, "nav.main_label")}>
              <a href="/tenders">{t(lang, "nav.tenders")}</a>
              <a href="/awards">{t(lang, "nav.awards")}</a>
              <a href="/expiring">{t(lang, "rail.expiring")}</a>
              {on ? <a class="lp-on" href="/analytics">{t(lang, "rail.analytics")}</a> : null}
              {on ? <a class="lp-on" href="/pro">{t(lang, "pro.tag")}</a> : null}
            </nav>
            <div class="lp-nav-actions">
              <a href={`?lang=${lang === "fr" ? "en" : "fr"}`} class="lang-toggle" rel="nofollow">{t(lang, "nav.lang")}</a>
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

          {on ? <Plans lang={lang} price={price} /> : null}

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
