// The account pages: the Console system's head band and panels, with forms in
// panels and data in definition lists and tables. Every page is noindex and
// never stored by a cache (routes.tsx sets the headers). Every form that
// changes something carries the session's CSRF value.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { SortHead } from "../columns";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, t, tj, tn, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, page } from "../layout";
import { EMAIL_MAX } from "../pages/interest";
import { CHECK_PATH, PLAN_ROWS, ProNote, ProTag, planLine as planRowLine } from "../pro";
import { KEYED_ENDPOINTS, KEY_PER_DAY, KEY_PER_MINUTE, keyQuota } from "../api_keyed_spec";
import { MAX_Q } from "../search_db";
import { REQUEST_LIMITS } from "../pages/docs";
import { KEYS_MAX, KEY_NAME_MAX, type KeyRow } from "./api_keys";
import type { KeyUsage } from "./api_usage";
import type { BillingLine } from "./billing";
import { type Brief, briefValue } from "./briefings";
import { AddToDashboard, type BoardChoice } from "./dashboard_add";
import { holdsDashboard } from "./dashboard_rule";
import { RULES, allowed, watchCap } from "./entitlements";
import { FEEDS_MAX, type FeedKind } from "./feeds";
import type { PoolLine } from "./pool";
import { PoolLines, PoolMark, poolCount, poolOver } from "./pool_lines";
import { DELIVERY, type Delivery, type InterestRow, type LastDelivery, type SavedSearch, paidCapLine } from "./searches";
import { PoolFull } from "./seats_lines";
import type { SeatsRow } from "./seats_pages";
import { type Account, type LiveSession, SESSIONS_MAX } from "./session";
import { CODE_MINUTES } from "./signin";
import { type Follow, followValue } from "./watch_events";

export async function accountPage(c: Context<AppEnv>, title: string, body: unknown, status = 200): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats?.data_as_of ?? null} active="/account"
      seo={{ path: new URL(c.req.url).pathname, description: t(lang, "account.description"), noindex: true }}>
      {body as any}
    </Layout>,
    status,
  );
}

const Errors: FC<{ lang: Lang; errors?: Key[] }> = ({ lang, errors }) =>
  errors?.length ? <ul class="errors" role="alert">{errors.map((e) => <li>{t(lang, e)}</li>)}</ul> : null;

// A line saying what the last action did, already in the page's language: text,
// or a line with a link in it (seats_lines.tsx poolFullLine, the holder's).
const Notice: FC<{ message?: unknown }> = ({ message }) =>
  message ? <p class="account-notice" role="status">{message as any}</p> : null;

const Csrf: FC<{ account: Account }> = ({ account }) => <input type="hidden" name="csrf" value={account.csrf} />;

// Also on the Follow form a public page shows a reader not signed in (watch_pages.tsx).
export const Honeypot: FC<{ lang: Lang }> = ({ lang }) => (
  <div class="hp"><label>{t(lang, "form.honeypot")}<input name="website" type="text" tabindex={-1} autocomplete="off" /></label></div>
);

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

// -- sign-in ------------------------------------------------------------------------

// next: the page to return to after signing in (routes.tsx safeNext), carried as a hidden field.
const Next: FC<{ next?: string | null }> = ({ next }) => (next ? <input type="hidden" name="next" value={next} /> : null);

// follow: the page a public page's Follow form named (watch_events.ts
// followOf), carried beside next and followed once the address has proved
// itself; the line says so, so the reader knows the Follow was not lost.
const FollowField: FC<{ follow?: Follow | null }> = ({ follow }) =>
  follow ? <input type="hidden" name="follow" value={followValue(follow.kind, follow.target)} /> : null;
const FollowNote: FC<{ lang: Lang; follow?: Follow | null }> = ({ lang, follow }) =>
  follow ? <p class="muted small">{t(lang, "account.follow_pending")}</p> : null;
// brief: the briefing a segment or buyer page's Save this briefing link named
// (briefings.ts briefOf), carried and announced the same way, and saved once
// the address has proved itself.
const BriefField: FC<{ brief?: Brief | null }> = ({ brief }) =>
  brief ? <input type="hidden" name="brief" value={briefValue(brief.kind, brief.subject)} /> : null;
const BriefNote: FC<{ lang: Lang; brief?: Brief | null }> = ({ lang, brief }) =>
  brief ? <p class="muted small">{t(lang, "account.brief_pending")}</p> : null;
// weekly: the reader ticked the sign-in form's box for the weekly email
// (weekly.ts), carried as a field to the code form and the link's page and
// turned on once the address has proved itself; the line says so.
const WeeklyField: FC<{ weekly?: boolean }> = ({ weekly }) => (weekly ? <input type="hidden" name="weekly" value="1" /> : null);
const WeeklyNote: FC<{ lang: Lang; weekly?: boolean }> = ({ lang, weekly }) =>
  weekly ? <p class="muted small">{t(lang, "weekly.pending")}</p> : null;
// The sign-in page for "Ask for a new code", with the page to return to, what
// to follow and the briefing to save carried on (routes.tsx reads them from the
// address), so a reader whose message did not come, or whose link went stale,
// still ends on the page they started from, following it or with its briefing.
// The weekly email's choice is not carried: the sign-in form's box is never
// ticked for the reader, so it is ticked again there.
const againHref = (next?: string | null, follow?: Follow | null, brief?: Brief | null): string => {
  const query = [
    next ? `next=${encodeURIComponent(next)}` : "",
    follow ? `follow=${encodeURIComponent(followValue(follow.kind, follow.target))}` : "",
    brief ? `brief=${encodeURIComponent(briefValue(brief.kind, brief.subject))}` : "",
  ].filter(Boolean).join("&");
  return query ? `/account/sign-in?${query}` : "/account/sign-in";
};

// What a free account gives, beside the form from 1200 px and under it below
// (public/styles.css .signin-grid), for a first visit and a return alike: the
// Free plan card's own lines (src/pro.tsx PLAN_ROWS, their figures read from
// RULES when drawn, so the card and this list never disagree), the weekly
// email while the form offers its box, then one line with Pro's own figures
// and the plans' page. No chip and no filled button: Send the code stays the
// page's one.
// The holder's record stays on the plan cards: its line means nothing to a reader who has not met it.
export const FREE_LINES: readonly Key[] = ["plans.free_searches", "plans.free_watches", "plans.matches", "plans.match_mail"];

export function freeLines(lang: Lang, weekly: boolean): string[] {
  const lines = FREE_LINES.map((key) => {
    const row = PLAN_ROWS.find((r) => r.free?.key === key);
    return row?.free ? planRowLine(lang, row.free) : "";
  }).filter(Boolean);
  return weekly ? [...lines, t(lang, "account.free_weekly")] : lines;
}

const FreePanel: FC<{ lang: Lang; weekly: boolean }> = ({ lang, weekly }) => {
  const n = (v: number) => fmtInt(v, lang);
  return (
    <Panel title={t(lang, "account.free_title")} class="free-panel">
      <ul class="plain free-lines">
        {freeLines(lang, weekly).map((line) => (
          <li><svg class="plan-mark" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d={CHECK_PATH} /></svg><span>{line}</span></li>
        ))}
      </ul>
      <p class="muted small">
        {tj(lang, "account.free_pro", {
          searches: n(RULES.pro.saved_searches), watches: n(RULES.pro.watchlists), matches: n(RULES.pro.matches), mail: n(RULES.pro.match_mail),
          plans: <a href="/pro">{t(lang, "billing.link_plans")}</a>,
        })}
      </p>
    </Panel>
  );
};

// offerWeekly: the box for the weekly email, while its table is on the
// database (weekly.ts weeklyReady). Never ticked by the site, on a first view
// or after an error.
export function signInView(
  lang: Lang,
  state: {
    errors?: Key[]; email?: string; notice?: string | null; limitN?: number; next?: string | null; follow?: Follow | null; brief?: Brief | null;
    offerWeekly?: boolean;
  } = {},
) {
  const errors = state.errors ?? [];
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.sign_in_title")} lead={t(lang, "account.sign_in_lead")} />
      <Notice message={state.notice} />
      {/* The form first, so the line that a Follow or a briefing rides along stays above the general list. */}
      <div class="signin-grid">
        <Panel title={t(lang, "account.email_panel")} class="panel-form">
          {errors.length ? (
            <ul class="errors" role="alert">
              {errors.map((e) => <li>{e === "account.err_limited" ? t(lang, e, { n: state.limitN ?? 0 }) : t(lang, e)}</li>)}
            </ul>
          ) : null}
          <FollowNote lang={lang} follow={state.follow} />
          <BriefNote lang={lang} brief={state.brief} />
          <form method="post" action="/account/sign-in" class="stack">
            <input type="hidden" name="lang" value={lang} />
            <Next next={state.next} />
            <FollowField follow={state.follow} />
            <BriefField brief={state.brief} />
            <label>
              {t(lang, "interest.email")}
              <input name="email" type="email" required maxlength={EMAIL_MAX} autocomplete="email" spellcheck={false} value={state.email ?? ""} />
            </label>
            <Honeypot lang={lang} />
            {state.offerWeekly ? (
              <label class="account-check">
                <input type="checkbox" name="weekly" value="1" />
                <span>{t(lang, "weekly.opt_in")}</span>
              </label>
            ) : null}
            <button type="submit" class="btn btn-primary">{t(lang, "account.send_code")}</button>
          </form>
          <p class="muted small">{tj(lang, "account.sign_in_privacy", { privacy: <a href="/privacy#accounts">{t(lang, "footer.privacy")}</a> })}</p>
        </Panel>
        <FreePanel lang={lang} weekly={!!state.offerWeekly} />
      </div>
    </>
  );
}

// The code field's pattern: six digits, spaces allowed around and between them.
const CODE_PATTERN = "\\s*([0-9]\\s*){6}";

// A code or link that answers stale in a browser already signed in (routes.tsx
// POST /account/check): the session's own address, which the rail of the same
// page names already, and the one way on, the page the sign-in was heading for
// (next) or the overview. Drawn in place of the stale line on either page.
export type SignedInHere = { email: string; href: string; next: boolean };
const SignedInLine: FC<{ lang: Lang; here: SignedInHere }> = ({ lang, here }) => (
  <p class="account-notice" role="status">
    {tj(lang, "account.stale_signed_in", {
      email: here.email, link: <a href={here.href}>{t(lang, here.next ? "account.stale_signed_in_next" : "account.title")}</a>,
    })}
  </p>
);

// The code form: after a request (email hidden, the lead names it), or typed
// from scratch (the email as a field).
export function codeView(
  lang: Lang,
  state: {
    email?: string; sent?: boolean; errors?: Key[]; next?: string | null; follow?: Follow | null; brief?: Brief | null; weekly?: boolean;
    signedIn?: SignedInHere;
  } = {},
) {
  const sent = !!state.sent && !!state.email;
  return (
    <>
      <PageHead lang={lang}
        title={t(lang, sent ? "account.check_title" : "account.enter_title")}
        lead={sent ? tj(lang, "account.check_lead", { email: <strong>{state.email}</strong>, minutes: CODE_MINUTES }) : t(lang, "account.enter_lead")} />
      <Panel title={t(lang, "account.code_panel")} class="panel-form">
        {state.signedIn ? <SignedInLine lang={lang} here={state.signedIn} /> : <Errors lang={lang} errors={state.errors} />}
        <FollowNote lang={lang} follow={state.follow} />
        <BriefNote lang={lang} brief={state.brief} />
        <WeeklyNote lang={lang} weekly={state.weekly} />
        <form method="post" action="/account/check" class="stack">
          <input type="hidden" name="lang" value={lang} />
          <Next next={state.next} />
          <FollowField follow={state.follow} />
          <BriefField brief={state.brief} />
          <WeeklyField weekly={state.weekly} />
          {sent ? (
            <>
              <input type="hidden" name="email" value={state.email} />
              <input type="hidden" name="sent" value="1" />
            </>
          ) : (
            <label>
              {t(lang, "interest.email")}
              <input name="email" type="email" required maxlength={EMAIL_MAX} autocomplete="email" spellcheck={false} value={state.email ?? ""} />
            </label>
          )}
          {/* Six digits, with any spaces a pasted code carries around or inside it, which the check strips (routes.tsx). */}
          <label>
            {t(lang, "account.code")}
            <input name="code" type="text" required inputmode="numeric" pattern={CODE_PATTERN} maxlength={20} autocomplete="one-time-code"
              spellcheck={false} class="account-code" />
          </label>
          <button type="submit" class="btn btn-primary">{t(lang, "account.sign_in")}</button>
        </form>
        <p class="muted small">
          {tj(lang, "account.code_again", { again: <a href={againHref(state.next, state.follow, state.brief)}>{t(lang, "account.code_again_link")}</a> })}
        </p>
      </Panel>
    </>
  );
}

// The link from the message opens this page; the button posts the token, so a
// mail scanner that fetches the link signs no one in and uses nothing up.
export function linkView(
  lang: Lang, token: string, errors?: Key[], next?: string | null, follow?: Follow | null, brief?: Brief | null, weekly?: boolean,
  signedIn?: SignedInHere,
) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.link_title")} lead={t(lang, "account.link_lead")} />
      <Panel title={t(lang, "account.link_panel")} class="panel-form">
        {signedIn ? <SignedInLine lang={lang} here={signedIn} /> : <Errors lang={lang} errors={errors} />}
        {errors?.length || signedIn ? (
          <p><a href={againHref(next, follow, brief)} class="btn">{t(lang, "account.code_again_link")}</a></p>
        ) : (
          <>
            <FollowNote lang={lang} follow={follow} />
            <BriefNote lang={lang} brief={brief} />
            <WeeklyNote lang={lang} weekly={weekly} />
            <form method="post" action="/account/check" class="stack">
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="token" value={token} />
              <Next next={next} />
              <FollowField follow={follow} />
              <BriefField brief={brief} />
              <WeeklyField weekly={weekly} />
              <button type="submit" class="btn btn-primary">{t(lang, "account.sign_in")}</button>
            </form>
          </>
        )}
      </Panel>
    </>
  );
}

// -- the overview ----------------------------------------------------------------------

export function planLabel(lang: Lang, account: Pick<Account, "plan" | "planUntil">): string {
  if (account.plan === "free") return t(lang, "account.plan_free");
  if (account.plan === "ultra") {
    return account.planUntil ? t(lang, "account.plan_ultra_until", { date: day(account.planUntil) }) : t(lang, "account.plan_ultra_open");
  }
  return account.planUntil ? t(lang, "account.plan_pro_until", { date: day(account.planUntil) }) : t(lang, "account.plan_pro_open");
}

// The plan as the overview and the billing page state it: a live Stripe
// subscription names the end of the period paid (billing.tsx), not the end
// of its grace, as the date the plan ends when a cancellation is set for it
// (billingLine ends); any other plan reads as planLabel.
export function planLine(lang: Lang, account: Pick<Account, "plan" | "planUntil">, billing?: BillingLine | null): string {
  if (billing?.stripe && account.plan !== "free") {
    const ultra = account.plan === "ultra";
    const key = billing.ends
      ? (ultra ? "billing.plan_stripe_ultra_ends" : "billing.plan_stripe_ends")
      : (ultra ? "billing.plan_stripe_ultra" : "billing.plan_stripe");
    return t(lang, key, { date: day(billing.periodEnd ?? account.planUntil) });
  }
  return planLabel(lang, account);
}

// The overview's plan line (docs/accounts.md, Seats). An account whose plan is
// a seat's names the subscription's holder in place of the end date, which is
// the holder's billing; an account holding a seat that gives it no plan is
// told so, with its own plan line. Every other account reads planLine.
export function overviewPlanLine(lang: Lang, account: Pick<Account, "plan" | "planUntil" | "seat" | "group">, billing?: BillingLine | null): string {
  const seat = account.seat;
  if (seat && account.group && account.group.position > 0) {
    const plan = account.plan === "ultra" ? t(lang, "ultra.tag") : account.plan === "pro" ? t(lang, "pro.tag") : t(lang, "account.plan_free");
    return t(lang, "account.plan_seat", { plan, holder: seat.holderEmail });
  }
  if (seat && !seat.covered) return t(lang, "seat.uncovered", { holder: seat.holderEmail, plan: planLine(lang, account, billing) });
  return planLine(lang, account, billing);
}

type OverviewCounts = {
  // searches: the saved searches and the briefings, which share cap (searches.ts heldCount).
  sessions: number; searches: number; cap: number; keys: number;
  // The watches that count toward the cap, and whether the claimed organization's is held beside them (watches.ts watchCount).
  watches?: number | null; watchesOwn?: boolean;
  // The organization the account claims (org_claim.ts claimSummary): false for none, undefined before its table exists.
  org?: { id: string; name: string | null } | false;
};

// The first steps, over the overview's own panels while the account follows
// no page or keeps no saved search or briefing (counts.searches is both, the
// one count every page states: searches.ts heldCount): a reader who signed in to track tenders
// otherwise lands on settings with nothing to do next. Each step not done
// yet, with its one action and a line on what it leads to; the panel goes by
// itself once the account holds both. The claimed organization's watch counts
// as a watch, since its events show on the watches page like any other.
// Choosing the organization rides along only while the panel shows. Watches
// that cannot be counted (the table not there yet) offer no Follow step. The
// first step shown holds the page's one filled button; the steps are not
// numbered, as nothing orders them. No Pro chip: a Free account's figures are
// the watches and searches pages' own sentences, and a Pro account's lines
// name its own plan only.
const StartPanel: FC<{ lang: Lang; account: Account; counts: OverviewCounts }> = ({ lang, account, counts }) => {
  const follow = counts.watches === 0 && !counts.watchesOwn;
  const save = counts.searches === 0;
  if (!follow && !save) return null;
  const n = (v: number) => fmtInt(v, lang);
  const mail = allowed(account, "watch_mail");
  const deliver = allowed(account, "delivery");
  const watching = { n: n(counts.watches ?? 0), cap: n(watchCap(account.plan)) };
  const held = { n: n(counts.searches), cap: n(counts.cap) };
  // A Free account's lines name Pro's own figures, from the plans.
  const watchFigures = mail
    ? t(lang, "account.start_follow_cap", watching)
    : t(lang, "watches.cap_free", { ...watching, max: n(RULES.pro.watchlists) });
  const searchFigures = deliver
    ? t(lang, "account.start_search_cap", held)
    : t(lang, "account.cap_note", { ...held, max: n(RULES.pro.saved_searches) });
  return (
    <Panel title={t(lang, "account.start_panel")}>
      <ul class="start-steps">
        {follow ? (
          <li>
            <h3>{t(lang, "account.start_follow")}</h3>
            {/* The top bar's search (layout.tsx TopbarSearch), with its button: a name leads to the results, a result to its profile and its Follow. */}
            <form method="get" action="/search" class="start-search" role="search">
              <input type="search" name="q" maxlength={MAX_Q} autocomplete="off"
                placeholder={t(lang, "search.placeholder")} aria-label={t(lang, "search.label")} />
              <button type="submit" class="btn btn-primary">{t(lang, "search.submit")}</button>
            </form>
            <p class="muted small">{t(lang, mail ? "account.start_follow_text_pro" : "account.start_follow_text")} {watchFigures}</p>
          </li>
        ) : null}
        {save ? (
          <li>
            <h3>{t(lang, "account.start_search")}</h3>
            {/* The tender list saves its filters to the account with its own Save this search (search_control.tsx). */}
            <a href="/tenders" class={follow ? "btn" : "btn btn-primary"}>{t(lang, "account.start_search_button")}</a>
            <p class="muted small">{t(lang, "account.start_search_text")} {searchFigures}</p>
          </li>
        ) : null}
        {counts.org === false ? (
          <li>
            <h3>{t(lang, "account.start_org")}</h3>
            <a href="/account/organization" class="btn">{t(lang, "account.start_org_button")}</a>
            <p class="muted small">{t(lang, allowed(account, "analytics") ? "account.start_org_text_pro" : "account.start_org_text")}</p>
          </li>
        ) : null}
      </ul>
    </Panel>
  );
};

// The weekly email's row (weekly.ts): its state and the one control that
// turns it the other way, a plain link-styled button, so the page keeps its
// one filled button. Left out while the table is not on the database.
const WeeklyRow: FC<{ lang: Lang; account: Account; on: boolean }> = ({ lang, account, on }) => (
  <>
    <dt>{t(lang, "weekly.field")}</dt>
    <dd>
      <form method="post" action="/account/weekly" class="account-inline">
        <Csrf account={account} />
        <input type="hidden" name="mail" value={on ? "off" : "on"} />
        <span>{t(lang, on ? "weekly.state_on" : "weekly.state_off")}</span>
        <button type="submit" class="btn-link">{t(lang, on ? "weekly.turn_off" : "weekly.turn_on")}</button>
      </form>
      <span class="kv-note">{t(lang, "weekly.field_note")}</span>
    </dd>
  </>
);

// The language of the account's own mail (users.lang: the watch mail and the
// weekly email): set by the sign-in that made the account, and changed here
// only, with one link-styled button that switches it, as the weekly row's does.
const MailLangRow: FC<{ lang: Lang; account: Account }> = ({ lang, account }) => {
  const other: Lang = account.lang === "fr" ? "en" : "fr";
  return (
    <>
      <dt>{t(lang, "account.field_mail_lang")}</dt>
      <dd>
        <form method="post" action="/account/mail-language" class="account-inline">
          <Csrf account={account} />
          <input type="hidden" name="mail_lang" value={other} />
          <span>{t(lang, account.lang === "fr" ? "account.mail_lang_fr" : "account.mail_lang_en")}</span>
          <button type="submit" class="btn-link">{t(lang, other === "fr" ? "account.mail_lang_to_fr" : "account.mail_lang_to_en")}</button>
        </form>
        <span class="kv-note">{t(lang, "account.mail_lang_note")}</span>
      </dd>
    </>
  );
};

// The device word the console already uses for a session's class, capitalized for a cell.
const DEVICE_KEY: Record<string, Key> = { desktop: "admin.device_desktop", mobile: "admin.device_mobile", tablet: "admin.device_tablet" };

function deviceWord(lang: Lang, ua: string | null): string {
  const word = t(lang, DEVICE_KEY[ua ?? ""] ?? "admin.device_unknown");
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// The account's live sessions (session.ts liveSessions), this browser marked
// and each other one with its Sign out (routes.tsx, POST
// /account/sessions/:id/sign-out), a link-styled button so the page keeps its
// one filled button; the Sign Out panel below holds this browser's own. The
// table restacks below 700 px as the account's other tables do. Each button's
// accessible name carries its row, since the word alone repeats down the column.
const SessionsPanel: FC<{ lang: Lang; account: Account; sessions: readonly LiveSession[] }> = ({ lang, account, sessions }) => (
  <Panel title={t(lang, "account.sessions_title")} id="browsers">
    <div class="table-wrap">
      <table class="restack">
        <thead>
          <tr>
            <th>{t(lang, "account.session_col_device")}</th><th>{t(lang, "account.session_col_start")}</th>
            <th>{t(lang, "account.col_last_used")}</th><th><span class="visually-hidden">{t(lang, "account.session_out")}</span></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const device = deviceWord(lang, s.ua_class);
            const start = stamp(s.created_at);
            const last = stamp(s.last_seen_at);
            const out = t(lang, "account.session_out");
            return (
              <tr>
                <td>{device}</td>
                <td data-label={t(lang, "account.session_col_start")} class="mono">{start}</td>
                <td data-label={t(lang, "account.col_last_used")} class="mono">{last}</td>
                <td>
                  {s.id === account.sessionId ? <span>{t(lang, "account.session_this")}</span> : (
                    <form method="post" action={`/account/sessions/${s.id}/sign-out`} class="account-inline">
                      <Csrf account={account} />
                      <button type="submit" class="btn-link" aria-label={`${out} (${t(lang, "account.session_row", { device, start, last })})`}>{out}</button>
                    </form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <p class="muted small">{t(lang, "account.sessions_rule", { cap: fmtInt(SESSIONS_MAX, lang) })}</p>
  </Panel>
);

export function overviewView(
  lang: Lang, account: Account,
  counts: OverviewCounts,
  extra: {
    billing?: BillingLine | null; notice?: string | null; weekly?: { on: boolean } | null;
    // The account's live sessions for the Signed-In Browsers panel; absent, the panel is left out.
    sessions?: readonly LiveSession[];
    // The Seats row (seats_pages.tsx seatsRow): absent while the seats' switch is off and for an account with no seat.
    seats?: SeatsRow | null;
  } = {},
) {
  const stripe = extra.billing?.stripe && account.plan !== "free";
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.title")} lead={t(lang, "account.lead", { email: account.email })} />
      <Notice message={extra.notice} />
      <StartPanel lang={lang} account={account} counts={counts} />
      <Panel title={t(lang, "account.panel_account")}>
        <dl class="wide">
          <dt>{t(lang, "account.field_email")}</dt><dd>{account.email}</dd>
          <dt>{t(lang, "account.field_plan")}</dt>
          <dd>{overviewPlanLine(lang, account, extra.billing)}</dd>
          <dt>{t(lang, "billing.field")}</dt>
          <dd><a href="/account/billing">{t(lang, stripe ? "billing.manage" : "billing.link_plans")}</a></dd>
          {extra.seats ? (
            <>
              <dt>{t(lang, "account.field_seats")}</dt>
              <dd>
                <a href="/account/seats">
                  {extra.seats.kind === "member" ? t(lang, "seat.link")
                    : extra.seats.kind === "fewer" ? t(lang, "seats.overview_fewer")
                    : tn(lang, "seats.count_one", "seats.count", extra.seats.n, { n: fmtInt(extra.seats.n, lang), cap: fmtInt(extra.seats.cap, lang) })}
                </a>
              </dd>
            </>
          ) : null}
          <dt>{t(lang, "account.field_since")}</dt><dd class="mono">{day(account.createdAt)}</dd>
          <dt>{t(lang, "account.field_sessions")}</dt>
          <dd>{t(lang, "account.sessions_count", { n: fmtInt(counts.sessions, lang), cap: fmtInt(SESSIONS_MAX, lang) })}</dd>
          {extra.weekly ? <WeeklyRow lang={lang} account={account} on={extra.weekly.on} /> : null}
          <MailLangRow lang={lang} account={account} />
          {/* A Free account sees the row too, with the Pro chip, leading to the page's notice (bugs.tsx). */}
          <dt>{t(lang, "bugs.field")}</dt>
          <dd>
            <a href="/account/bug">
              {t(lang, "bugs.link")}{allowed(account, "bug_reports") ? null : <ProTag lang={lang} />}
            </a>
          </dd>
        </dl>
      </Panel>
      <Panel title={t(lang, "rail.lists")}>
        <ul class="kv">
          <li>
            <a href="/account/searches">{t(lang, "account.searches")}</a>
            <span class="num">{t(lang, "account.searches_n", { n: fmtInt(counts.searches, lang), cap: fmtInt(counts.cap, lang) })}</span>
          </li>
          <li>
            <a href="/account/keys">{t(lang, "account.keys")}{allowed(account, "api") ? null : <ProTag lang={lang} />}</a>
            <span class="num">{fmtInt(counts.keys, lang)}</span>
          </li>
          {/* The keys' usage (api_usage_page.tsx), marked as the keys are; without the api feature it leads to the keys page. */}
          <li>
            <a href="/account/api">{t(lang, "apiusage.link")}{allowed(account, "api") ? null : <ProTag lang={lang} />}</a>
          </li>
          {counts.watches === undefined || counts.watches === null ? null : (
            <li>
              <a href="/account/watches">{t(lang, "watches.title")}</a>
              <span class="num">
                {t(lang, counts.watchesOwn ? "watches.n_own" : "watches.n", { n: fmtInt(counts.watches, lang), cap: fmtInt(watchCap(account.plan), lang) })}
              </span>
            </li>
          )}
          {counts.org === undefined ? null : (
            <li>
              <span>
                <a href="/account/organization">{t(lang, "orgclaim.title_short")}</a>
                <span class="kv-note">{counts.org ? counts.org.name ?? counts.org.id : t(lang, "orgclaim.overview_none")}</span>
              </span>
            </li>
          )}
          {/* The open notices matching that organization (fit_pages.tsx); no count, so the overview never reads the open list. */}
          {counts.org ? <li><a href="/account/matches">{t(lang, "fit.overview")}</a></li> : null}
        </ul>
      </Panel>
      {extra.sessions ? <SessionsPanel lang={lang} account={account} sessions={extra.sessions} /> : null}
      <Panel title={t(lang, "account.panel_sign_out")}>
        <p>{t(lang, "account.sign_out_text")}</p>
        <div class="account-actions">
          <form method="post" action="/account/sign-out">
            <Csrf account={account} />
            <button type="submit" class="btn">{t(lang, "account.sign_out")}</button>
          </form>
          <form method="post" action="/account/sign-out">
            <Csrf account={account} />
            <input type="hidden" name="scope" value="all" />
            <button type="submit" class="btn">{t(lang, "account.sign_out_all")}</button>
          </form>
        </div>
      </Panel>
      <Panel title={t(lang, "account.delete_title")}>
        <p>{t(lang, "account.delete_text")}</p>
        <p><a href="/account/delete" class="btn">{t(lang, "account.delete_button")}</a></p>
      </Panel>
    </>
  );
}

// -- saved searches ------------------------------------------------------------------------

const DELIVERY_KEY: Record<Delivery, Key> = { daily: "account.deliver_daily", weekly: "account.deliver_weekly", off: "account.deliver_off" };

// "2026-11-03 15:02 UTC", the time of a delivery row.
const stamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

// The newest delivery of a search, under its delivery select: when it ran
// and what it did. Nothing for a search never delivered and switched off.
const LastDeliveryLine: FC<{ lang: Lang; last: LastDelivery | null; deliver: Delivery }> = ({ lang, last, deliver }) => {
  if (!last) return deliver === "off" ? null : <p class="muted small">{t(lang, "account.last_none")}</p>;
  const time = stamp(last.sent_at);
  const line = last.status === "sent"
    ? t(lang, last.items === 1 ? "account.last_sent_one" : "account.last_sent_many", { time, n: fmtInt(last.items, lang) })
    : last.status === "empty" ? t(lang, "account.last_empty", { time }) : t(lang, "account.last_failed", { time });
  return <p class="muted small">{line}</p>;
};

// The dashboard's panel each kind of saved search becomes (dashboard.tsx PANEL_KINDS).
const DASH_KINDS: Readonly<Partial<Record<string, string>>> = {
  tenders: "tenders", expiring: "radar", organization: "records", buyer: "records", segment: "records",
};

// The foot of a Free account's searches: how many it holds of its cap, what
// Pro holds and sends, and the billing page.
const CapNote: FC<{ lang: Lang; n: number; cap: number }> = ({ lang, n, cap }) => (
  <ProNote lang={lang}>
    {t(lang, "account.cap_note", { n: fmtInt(n, lang), cap: fmtInt(cap, lang), max: fmtInt(RULES.pro.saved_searches, lang) })}{" "}
    <a href="/account/billing">{t(lang, "billing.link_plans")}</a>
  </ProNote>
);

// -- calendar feeds (feeds.ts) ----------------------------------------------------------------

// One row of the feeds panel: a saved tender search, or the "all" feed, with
// its feed when it has one (the watches' feed is on the watches page,
// watch_pages.tsx). events is how many the feed holds now, null when what it
// reads could not be read for the count.
// past: in a group, a feed the subscription has no room for, or whose search is past the account's allowance.
export type CalendarRow = {
  kind: FeedKind; searchId: string | null; label: string; href: string | null;
  feed: { id: string; address: string; lastRead: string | null; events: number | null; past?: true } | null;
};
// pool: in a group, the subscription's feeds and how many of the account's are past its allowance.
export type CalendarView = { rows: CalendarRow[]; live: number; pool?: { line: PoolLine; past: number } };

// The feed's own cell: the address to copy (calendar.js adds the copy
// button), when a calendar last read it and how many events it holds, and
// the two buttons. The watches page shows its feed in the same cell.
export const FeedCell: FC<{ lang: Lang; account: Account; feed: NonNullable<CalendarRow["feed"]> }> = ({ lang, account, feed }) => (
  <div class="feed-cell">
    <input class="calendar-address mono" type="text" readonly value={feed.address} aria-label={t(lang, "calfeed.address")}
      spellcheck={false} data-copy={t(lang, "calfeed.copy")} data-copied={t(lang, "calfeed.copied")} />
    <p class="muted small">
      {feed.lastRead ? t(lang, "calfeed.last_read", { date: feed.lastRead }) : t(lang, "calfeed.not_read")}
      {feed.events === null ? null : <>{" · "}{tn(lang, "calfeed.events_one", "calfeed.events_many", feed.events, { n: fmtInt(feed.events, lang) })}</>}
    </p>
    {feed.past ? <p class="muted small">{t(lang, "pool.mark")}</p> : null}
    <div class="account-inline">
      <form method="post" action={`/account/calendar/${feed.id}/rotate`} class="account-inline">
        <Csrf account={account} />
        <button type="submit" class="btn-link">{t(lang, "calfeed.rotate")}</button>
      </form>
      <form method="post" action={`/account/calendar/${feed.id}/delete`} class="account-inline">
        <Csrf account={account} />
        <button type="submit" class="btn-link">{t(lang, "calfeed.remove")}</button>
      </form>
    </div>
  </div>
);

// The searches page's feeds: for a Free account the Pro chip and one line;
// for Pro a row per saved tender search and one for all of them, each with
// its feed or the button that makes one, then how to subscribe.
const CalendarPanel: FC<{ lang: Lang; account: Account; view: CalendarView }> = ({ lang, account, view }) => {
  if (!allowed(account, "delivery")) {
    return (
      <Panel title={t(lang, "calfeed.panel")} id="calendar" tools={<ProTag lang={lang} />}>
        <ProNote lang={lang}>{t(lang, "calfeed.gate")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></ProNote>
      </Panel>
    );
  }
  // In a group the figure is the subscription's: its feeds, the account's own among them.
  const held = view.pool ? view.pool.line.total : view.live;
  const full = held >= FEEDS_MAX;
  return (
    <Panel title={t(lang, "calfeed.panel")} id="calendar"
      count={t(lang, "calfeed.count", { n: fmtInt(held, lang), max: fmtInt(FEEDS_MAX, lang) })}
      foot={<>
        <p>{t(lang, "calfeed.route_google")}</p>
        <p>{t(lang, "calfeed.route_outlook")}</p>
        <p>{t(lang, "calfeed.route_apple")}</p>
        <p>{t(lang, "calfeed.refresh")}</p>
      </>}>
      <p>{t(lang, "calfeed.lead")}</p>
      {view.pool ? <PoolLines lang={lang} figure="feeds" line={view.pool.line} past={view.pool.past} /> : null}
      {/* In a group at the subscription's figure, while the seats' switch is on: why no row offers a feed (seats_lines.tsx). */}
      {view.pool && full ? <PoolFull lang={lang} who={account} figure="feeds" cap={FEEDS_MAX} p /> : null}
      {view.rows.length ? (
        <div class="table-wrap">
          {/* Sorted in the page by the feed's name; the address cell holds a form, with nothing to sort by. */}
          <table class="restack" data-sorting="client">
            <thead><tr><SortHead>{t(lang, "calfeed.col_feed")}</SortHead><th>{t(lang, "calfeed.col_address")}</th></tr></thead>
            <tbody>
              {view.rows.map((r) => (
                <tr>
                  <td data-label={t(lang, "calfeed.col_feed")}>{r.href ? <a href={r.href}>{r.label}</a> : r.label}</td>
                  <td data-label={t(lang, "calfeed.col_address")}>
                    {/* In a group, at the subscription's figure, the line above the rows says so and the cell holds nothing. */}
                    {r.feed ? <FeedCell lang={lang} account={account} feed={r.feed} /> : full ? (
                      view.pool ? null : <p class="muted small">{t(lang, "calfeed.cap", { n: fmtInt(FEEDS_MAX, lang) })}</p>
                    ) : (
                      <form method="post" action="/account/calendar" class="account-inline">
                        <Csrf account={account} />
                        <input type="hidden" name="kind" value={r.kind} />
                        {r.searchId ? <input type="hidden" name="search" value={r.searchId} /> : null}
                        <button type="submit" class="btn">{t(lang, "calfeed.make")}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p class="muted">{t(lang, "calfeed.none")}</p>}
      <p class="muted small">{t(lang, "calfeed.privacy")}</p>
      <script src="/calendar.js" defer></script>
    </Panel>
  );
};

export function searchesView(
  lang: Lang, account: Account,
  state: {
    searches: (SavedSearch & { last?: LastDelivery | null })[]; cap: number; pending: InterestRow[]; notice?: unknown;
    errors?: Key[]; url?: string; calendar?: CalendarView | null;
    // The weekly briefings' panel (briefing_pages.tsx) and how many the account holds: they share the cap.
    briefings?: { n: number; panel: unknown } | null;
    // Ultra's figure, for a paid account on a smaller one while Ultra is on sale; null or absent otherwise.
    ultra?: number | null;
    // The account's dashboards when it holds several, for Add to dashboard's choice (dashboard_add.tsx boardChoices).
    boards?: readonly BoardChoice[];
    // In a group (pool.ts): the subscription's searches and briefings, and the account's own past its allowance.
    pool?: { line: PoolLine; past: ReadonlySet<string> };
  },
) {
  const { searches, cap, pending } = state;
  const canDeliver = allowed(account, "delivery");
  const dash = holdsDashboard(account.plan);
  const pool = state.pool;
  const held = pool ? pool.line.total : searches.length + (state.briefings?.n ?? 0);
  const full = held >= cap;
  // A paid account's line states what it holds of its figure (searches.ts paidCapLine), Ultra's while on sale above it; an
  // account in a group, what the subscription holds and how much is its own.
  const capLine = pool ? poolCount(lang, "searches", pool.line)
    : account.plan === "free" ? t(lang, "account.cap_free", { cap: fmtInt(cap, lang) }) : paidCapLine(lang, held, cap, state.ultra ?? null);
  const over = pool ? poolOver(lang, "searches", pool.line, pool.past.size) : null;
  const foot = !canDeliver ? <CapNote lang={lang} n={held} cap={cap} />
    : state.ultra ? (
      <p>
        {capLine}{" "}
        <a href="/account/billing">{t(lang, "billing.link_plans")}</a>
      </p>
    ) : <p>{capLine}</p>;
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.searches_title")} lead={t(lang, "account.searches_lead_deliver")}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      <Notice message={state.notice} />
      {pending.length ? (
        <Panel title={t(lang, "account.panel_import")} count={fmtInt(pending.length, lang)}>
          <p>{t(lang, "account.import_text")}</p>
          <ul class="account-list">{pending.map((r) => <li><a href={r.params}>{r.label}</a></li>)}</ul>
          {/* At the figure the button would add nothing (the rows past it stay pending): the page's own cap line and
              its plans link stand in its place, or in a group whom to ask, as Add a Search below says. */}
          {full ? (pool ? <p><PoolFull lang={lang} who={account} figure="searches" cap={cap} otherwise={capLine} /></p> : foot) : (
            <form method="post" action="/account/searches/import">
              <Csrf account={account} />
              <button type="submit" class="btn btn-primary">{t(lang, "account.import_button")}</button>
            </form>
          )}
        </Panel>
      ) : null}
      <Panel title={t(lang, "account.searches_title")}
        count={t(lang, "account.searches_n", { n: fmtInt(held, lang), cap: fmtInt(cap, lang) })}
        foot={foot}>
        {/* Past the plan's figure (after a move to a smaller plan): nothing deleted, and the line says which are sent.
            A Free account sends none, so its foot's own line ("n of cap") says it instead. */}
        {pool ? (over ? <p>{over}</p> : null)
          : held > cap && canDeliver ? <p>{t(lang, "account.over_cap", { n: fmtInt(held, lang), cap: fmtInt(cap, lang) })}</p> : null}
        {searches.length ? (
          <div class="table-wrap">
            {/* Sorted in the page by the search; the other cells are forms. */}
            <table class="restack" data-sorting="client">
              <thead>
                <tr><SortHead>{t(lang, "account.col_search")}</SortHead><th>{t(lang, "account.col_delivery")}</th><th>{t(lang, "account.col_remove")}</th></tr>
              </thead>
              <tbody>
                {searches.map((s) => (
                  <tr>
                    {/* An Ultra account adds a search to its dashboard from its row (dashboard.tsx); the sort reads the label alone.
                        A search past a group member's allowance offers no tile, whose body would say it is unavailable: its mark
                        stands in the control's place. */}
                    {dash && DASH_KINDS[s.kind] ? (
                      <td data-label={t(lang, "account.col_search")} data-sort={s.label}>
                        <a href={s.params}>{s.label}</a>
                        {pool?.past.has(s.id) ? <PoolMark lang={lang} />
                          : <AddToDashboard lang={lang} account={account} kind={DASH_KINDS[s.kind]!} panelRef={s.id} boards={state.boards} />}
                      </td>
                    ) : <td data-label={t(lang, "account.col_search")}><a href={s.params}>{s.label}</a>{pool?.past.has(s.id) ? <PoolMark lang={lang} /> : null}</td>}
                    <td data-label={t(lang, "account.col_delivery")}>
                      {canDeliver ? (
                        <>
                          <form method="post" action={`/account/searches/${s.id}`} class="account-inline">
                            <Csrf account={account} />
                            <select name="deliver" aria-label={t(lang, "account.col_delivery")}>
                              {DELIVERY.map((d) => <option value={d} selected={d === s.deliver}>{t(lang, DELIVERY_KEY[d])}</option>)}
                            </select>
                            <button type="submit" class="btn">{t(lang, "account.deliver_save")}</button>
                          </form>
                          {/* Saved with its email off on every plan, and nothing turns it on by itself: the line says so above the run's. */}
                          {s.deliver === "off" ? <p class="muted small">{t(lang, "account.save_mail_off")}</p> : null}
                          <LastDeliveryLine lang={lang} last={s.last ?? null} deliver={s.deliver} />
                        </>
                      ) : (
                        // A Free account: delivery reads "Off" in a gate note, not a disabled select.
                        <>
                          <ProNote lang={lang}>{t(lang, "account.deliver_gate")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></ProNote>
                          {s.last ? <LastDeliveryLine lang={lang} last={s.last} deliver={s.deliver} /> : null}
                        </>
                      )}
                    </td>
                    <td data-label={t(lang, "account.col_remove")}>
                      <form method="post" action={`/account/searches/${s.id}/delete`} class="account-inline">
                        <Csrf account={account} />
                        <button type="submit" class="btn-link">{t(lang, "account.delete")}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="muted">{t(lang, "account.searches_none")}</p>
        )}
      </Panel>
      {state.briefings ? (state.briefings.panel as any) : null}
      {state.calendar ? <CalendarPanel lang={lang} account={account} view={state.calendar} /> : null}
      <Panel title={t(lang, "account.panel_add")} class="panel-form">
        <Errors lang={lang} errors={state.errors} />
        {/* In a group, while the seats' switch is on, the subscription is full: whom to ask (seats_lines.tsx). */}
        {full ? (
          <p>{pool ? <PoolFull lang={lang} who={account} figure="searches" cap={cap} otherwise={capLine} /> : capLine}</p>
        ) : (
          <form method="post" action="/account/searches" class="stack">
            <Csrf account={account} />
            <label>
              {t(lang, "account.add_url")}
              <input name="url" type="text" required maxlength={2100} spellcheck={false} autocomplete="off"
                placeholder="https://awardwatch.ca/tenders?segment=43" value={state.url ?? ""} />
              <span class="muted small">{t(lang, "account.add_note")}</span>
            </label>
            <button type="submit" class="btn btn-primary">{t(lang, "account.add_button")}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

// -- stopping a delivery from its message ----------------------------------------------------------

// The stop link's page: the search's label and one button that posts the
// link's values back. No session is needed; the secret is the proof.
export function stopView(lang: Lang, state: { searchId: string; secret: string; label: string; off: boolean }) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.stop_title")} lead={t(lang, "account.stop_lead")} />
      <Panel title={t(lang, "account.stop_panel")} class="panel-form">
        <p><strong>{state.label}</strong></p>
        {state.off ? (
          <p>{t(lang, "account.stop_already")}</p>
        ) : (
          <form method="post" action="/account/stop" class="stack">
            <input type="hidden" name="s" value={state.searchId} />
            <input type="hidden" name="t" value={state.secret} />
            <input type="hidden" name="lang" value={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "account.stop_button")}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

export function stoppedView(lang: Lang, label: string) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.stopped_title")} lead={t(lang, "account.stopped_lead")}
        actions={<a href="/account/searches" class="btn">{t(lang, "account.searches_title")}</a>} />
      <Panel title={t(lang, "account.stop_panel")}>
        <p><strong>{label}</strong></p>
      </Panel>
    </>
  );
}

// A grouped message's stop page (/account/stop?g=&t=, group_stop.ts): the
// labels of the searches its link proves, and one button that posts the
// link's values back. No session is needed; the tags are the proof.
export function groupStopView(lang: Lang, state: { userId: string; tags: string; labels: readonly string[]; off: boolean }) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.stop_group_title")} lead={t(lang, "account.stop_group_lead")} />
      <Panel title={t(lang, "account.stop_group_panel")} class="panel-form">
        <ul class="account-list">{state.labels.map((label) => <li>{label}</li>)}</ul>
        {state.off ? (
          <p>{t(lang, "account.stop_group_already")}</p>
        ) : (
          <form method="post" action="/account/stop" class="stack">
            <input type="hidden" name="g" value={state.userId} />
            <input type="hidden" name="t" value={state.tags} />
            <input type="hidden" name="lang" value={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "account.stop_group_button")}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

export function groupStoppedView(lang: Lang, labels: readonly string[]) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.stopped_group_title")} lead={t(lang, "account.stopped_group_lead")}
        actions={<a href="/account/searches" class="btn">{t(lang, "account.searches_title")}</a>} />
      <Panel title={t(lang, "account.stop_group_panel")}>
        <ul class="account-list">{labels.map((label) => <li>{label}</li>)}</ul>
      </Panel>
    </>
  );
}

// The weekly email's unsubscribe page (/account/stop?e=&t=), the same way:
// one button that posts the link's values back, no session needed.
export function weeklyStopView(lang: Lang, state: { userId: string; secret: string; off: boolean }) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "weekly.stop_title")} lead={t(lang, "weekly.stop_lead")} />
      <Panel title={t(lang, "weekly.panel")} class="panel-form">
        {state.off ? (
          <p>{t(lang, "weekly.stop_already")}</p>
        ) : (
          <form method="post" action="/account/stop" class="stack">
            <input type="hidden" name="e" value={state.userId} />
            <input type="hidden" name="t" value={state.secret} />
            <input type="hidden" name="lang" value={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "weekly.stop_button")}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

export function weeklyStoppedView(lang: Lang) {
  return (
    <PageHead lang={lang} title={t(lang, "weekly.stopped_title")} lead={t(lang, "weekly.stopped_lead")}
      actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
  );
}

// -- API keys ----------------------------------------------------------------------------------

// usage: each key's count today and over the last 30 days (api_usage.ts); null
// when the counts cannot be read, and a key with none in the period is absent.
export function keysView(
  lang: Lang, account: Account,
  state: {
    keys: KeyRow[]; usage?: Map<string, KeyUsage> | null; created?: string; notice?: string | null; errors?: Key[];
    // In a group (pool.ts): the subscription's keys, and the account's own live keys past its allowance.
    pool?: { line: PoolLine; past: ReadonlySet<string> };
  },
) {
  const live = state.keys.filter((k) => !k.revoked_at).length;
  const pool = state.pool;
  // In a group the keys are the subscription's: the form while it has room, and its count in either case.
  const full = pool ? pool.line.total >= KEYS_MAX : live >= KEYS_MAX;
  const canCreate = allowed(account, "api");
  const count = (k: KeyRow, which: keyof KeyUsage) => (state.usage ? fmtInt(state.usage.get(k.id)?.[which] ?? 0, lang) : "");
  return (
    <>
      {/* The usage page's button for a plan with the keyed API; any other plan is sent back here from it. */}
      <PageHead lang={lang} title={t(lang, "account.keys_title")} lead={t(lang, "account.keys_lead")}
        actions={<>
          {canCreate ? <a href="/account/api" class="btn">{t(lang, "apiusage.link")}</a> : null}
          <a href="/account" class="btn">{t(lang, "account.title")}</a>
        </>} />
      <Notice message={state.notice} />
      {state.created ? (
        <Panel title={t(lang, "account.panel_new_key")}>
          <p>{t(lang, "account.new_key_text")}</p>
          {/* calendar.js adds the Copy button, as it does beside a calendar feed's address. */}
          <div class="copy-block" data-copy={t(lang, "calfeed.copy")} data-copied={t(lang, "calfeed.copied")}>
            <pre class="cite-block account-key">{state.created}</pre>
          </div>
          <script src="/calendar.js" defer></script>
        </Panel>
      ) : null}
      <Panel title={t(lang, "account.panel_create_key")} class="panel-form" tools={canCreate ? undefined : <ProTag lang={lang} />}>
        <Errors lang={lang} errors={state.errors} />
        {pool && canCreate ? <p>{poolCount(lang, "keys", pool.line)}</p> : null}
        {!canCreate ? (
          <p>{t(lang, "account.keys_pro")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></p>
        ) : full ? (
          // In a group the count is said above; while the seats' switch is on, the subscription is full (seats_lines.tsx).
          pool ? <PoolFull lang={lang} who={account} figure="keys" cap={KEYS_MAX} p /> : <p>{t(lang, "account.keys_limit", { n: KEYS_MAX })}</p>
        ) : (
          <form method="post" action="/account/keys" class="stack">
            <Csrf account={account} />
            <label>
              {t(lang, "account.key_name")}
              <input name="name" type="text" required maxlength={KEY_NAME_MAX} autocomplete="off" placeholder={t(lang, "account.key_name_placeholder")} />
            </label>
            <button type="submit" class="btn btn-primary">{t(lang, "account.create_key")}</button>
          </form>
        )}
      </Panel>
      <Panel title={t(lang, "account.panel_keys")} count={fmtInt(live, lang)}>
        {pool && poolOver(lang, "keys", pool.line, pool.past.size) ? <p>{poolOver(lang, "keys", pool.line, pool.past.size)}</p> : null}
        {state.keys.length ? (
          <div class="table-wrap">
            <table class="restack" data-sorting="client">
              <thead>
                <tr>
                  <SortHead>{t(lang, "account.key_name")}</SortHead><SortHead>{t(lang, "account.col_prefix")}</SortHead>
                  <SortHead kind="date">{t(lang, "account.col_created")}</SortHead><SortHead kind="date">{t(lang, "account.col_last_used")}</SortHead>
                  <SortHead class="num">{t(lang, "account.col_today")}</SortHead><SortHead class="num">{t(lang, "account.col_30_days")}</SortHead>
                  <SortHead>{t(lang, "account.col_status")}</SortHead>
                </tr>
              </thead>
              <tbody>
                {state.keys.map((k) => (
                  <tr>
                    <td data-label={t(lang, "account.key_name")}>{k.name}</td>
                    <td data-label={t(lang, "account.col_prefix")} class="mono">aw_{k.prefix}</td>
                    <td data-label={t(lang, "account.col_created")} class="mono">{day(k.created_at)}</td>
                    <td data-label={t(lang, "account.col_last_used")} class="mono">{k.last_used_at ? day(k.last_used_at) : t(lang, "account.key_never")}</td>
                    <td data-label={t(lang, "account.col_today")} class="num">{count(k, "today")}</td>
                    <td data-label={t(lang, "account.col_30_days")} class="num">{count(k, "last30")}</td>
                    <td data-label={t(lang, "account.col_status")}>
                      {k.revoked_at ? (
                        <span class="muted">{t(lang, "account.key_revoked", { date: day(k.revoked_at) })}</span>
                      ) : (
                        <form method="post" action={`/account/keys/${k.id}/revoke`} class="account-inline">
                          <Csrf account={account} />
                          {/* In a group, a key past the account's allowance is not served (the API answers it 403): its status says so. */}
                          {pool?.past.has(k.id) ? <span class="muted">{t(lang, "pool.mark")}</span> : <span>{t(lang, "account.key_active")}</span>}
                          <button type="submit" class="btn-link">{t(lang, "account.revoke")}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="muted">{t(lang, "account.keys_none")}</p>
        )}
        {state.keys.length ? (
          <p class="muted small">
            {state.usage === null ? `${t(lang, "account.keys_usage_unread")} ` : ""}
            {t(lang, "account.keys_usage_note", {
              day: fmtInt(keyQuota(account.plan)?.perDay ?? KEY_PER_DAY, lang), minute: fmtInt(KEY_PER_MINUTE, lang), address: fmtInt(REQUEST_LIMITS.api, lang),
            })}
          </p>
        ) : null}
      </Panel>
      <Panel title={t(lang, "account.panel_endpoints")}>
        <dl>
          {KEYED_ENDPOINTS.map((e) => <><dt class="mono">GET {e.path}</dt><dd>{t(lang, e.text)}</dd></>)}
        </dl>
        <p class="muted small">{tj(lang, "account.endpoints_more", { data: <a href="/data#api-keyed">{t(lang, "nav.data")}</a> })}</p>
      </Panel>
    </>
  );
}

// -- deletion -----------------------------------------------------------------------------------

// paid: the plan a subscription of the account pays for (its own paid plan,
// or the one its bound subscription last paid for), null for none; refund:
// the billing page offers Refund now (billing.tsx refundState), which a line
// points to, since deleting refunds nothing. While the seats' switch is on
// (seats_pages.tsx deleteSeatFacts): holder, the address of the subscription
// whose seat the account holds, from its own session; gives, how many seats it
// gives (live seats and open invitations), each ended with it.
export type DeleteFacts = { paid: "pro" | "ultra" | null; refund: boolean; holder?: string; gives?: number };

export function deleteView(lang: Lang, account: Account, errors?: Key[], facts: DeleteFacts = { paid: null, refund: false }) {
  const plan = facts.paid ? t(lang, facts.paid === "ultra" ? "ultra.tag" : "pro.tag") : null;
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.delete_title")} lead={t(lang, "account.delete_lead")}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      <Panel title={t(lang, "account.panel_delete_what")} class="panel-form">
        <Errors lang={lang} errors={errors} />
        {facts.refund ? (
          <p>{tj(lang, "account.delete_refund", {
            page: <a href={`/account/billing${lang === "fr" ? "?lang=fr" : ""}#refund`}>{t(lang, "account.delete_refund_page")}</a>,
          })}</p>
        ) : null}
        {facts.holder ? <p>{t(lang, "account.delete_seat", { holder: facts.holder })}</p> : null}
        {facts.gives ? <p>{tn(lang, "account.delete_seats_one", "account.delete_seats", facts.gives, { n: fmtInt(facts.gives, lang) })}</p> : null}
        <ul class="account-list">
          <li>{plan ? t(lang, "account.delete_subscription", { plan }) : t(lang, "account.delete_subscription_any")}</li>
          <li>{t(lang, "account.delete_searches")}</li>
          <li>{t(lang, "watches.delete")}</li>
          <li>{t(lang, "orgclaim.delete")}</li>
          <li>{t(lang, "briefing.delete")}</li>
          <li>{t(lang, "weekly.delete")}</li>
          <li>{t(lang, "calfeed.delete")}</li>
          <li>{t(lang, "bugs.delete")}</li>
          <li>{t(lang, "account.delete_sessions")}</li>
          <li>{t(lang, "account.delete_interest")}</li>
          <li>{t(lang, "account.delete_email")}</li>
        </ul>
        <p class="muted small">{t(lang, "account.delete_kept")}</p>
        <form method="post" action="/account/delete" class="stack">
          <Csrf account={account} />
          <label class="account-check">
            <input type="checkbox" name="confirm" value="yes" required />
            <span>{t(lang, "account.delete_confirm")}</span>
          </label>
          <button type="submit" class="btn btn-primary">{t(lang, "account.delete_button")}</button>
        </form>
      </Panel>
    </>
  );
}

export function deletedView(lang: Lang) {
  return (
    <PageHead lang={lang} title={t(lang, "account.deleted_title")} lead={t(lang, "account.deleted_lead")}
      actions={<a href="/" class="btn">{t(lang, "account.home")}</a>} />
  );
}

// A signed-in form sent with a CSRF value that is not this session's
// (routes.tsx signedInPost): the line, and the page the form was on to reload.
export function staleFormView(lang: Lang, back: string) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.stale_form_title")} />
      <p class="account-notice" role="status">{t(lang, "account.stale_form")} <a href={back}>{t(lang, "account.stale_form_reload")}</a></p>
    </>
  );
}

export function unavailableView(lang: Lang) {
  return <PageHead lang={lang} title={t(lang, "account.unavailable_title")} lead={t(lang, "account.unavailable_text")} />;
}
