// The /account routes, mounted by index.tsx. While the switch is off every one
// of them answers the site's own 404 before anything is read. While it is on:
//
//   GET  /account/sign-in              the address form (a session goes to /account)
//   POST /account/sign-in              makes a code and a link, sends them; the same page for any address
//   GET  /account/check                the code form; with ?token= the link's confirm button
//   POST /account/check                a code (with the address) or the link's token; starts the session,
//                                      then follows the page a Follow form named (follow), within the plan's cap,
//                                      saves the briefing a Save this briefing link named (brief), within the shared cap,
//                                      and turns on the weekly email when the sign-in form's box was ticked (weekly)
//   GET  /account                      the overview                                   (session)
//   POST /account/weekly               the weekly email on or off                     (session, CSRF)
//   POST /account/sign-out             this browser, or every browser (scope=all)     (session, CSRF)
//   GET  /account/searches             saved searches, the alerts form's rows to add  (session)
//   POST /account/searches             add from a page address, or Save this search   (session, CSRF)
//   POST /account/searches/import      add the alerts form's rows                     (session, CSRF)
//   POST /account/searches/:id         email delivery                                 (session, CSRF)
//   POST /account/searches/:id/delete  remove one                                     (session, CSRF)
//   GET  /account/keys                 API keys, each with its counts, the endpoints  (session)
//   POST /account/keys                 create one, shown once                         (session, CSRF, plan)
//   POST /account/keys/:id/revoke      revoke one                                     (session, CSRF)
//   GET  /account/api                  each key's requests a day, the plan's limits   (session; plan, else to /account/keys)
//   GET  /account/bug                  the bug report form, or Pro's notice           (session)
//   POST /account/bug                  store a report, send it to the operator        (session, CSRF, plan, FORM_LIMIT)
//   GET  /account/delete               what deleting removes                          (session)
//   POST /account/delete               delete, after cancelling a subscription        (session, CSRF)
//   GET  /account/calendar/:id.ics?t=  a calendar feed, read by a calendar app        (the feed's secret, plan)
//   POST /account/calendar             make a feed: a saved tender search, the watches or "all" (session, CSRF, plan)
//   POST /account/calendar/:id/rotate  a new secret; the old address stops            (session, CSRF)
//   POST /account/calendar/:id/delete  remove the feed; its address stops             (session, CSRF)
//   GET  /account/stop?s=&t=           a delivery's stop page, from its message       (the link's secret)
//   POST /account/stop?s=&t=           turn that delivery off; also RFC 8058 one-click (the link's secret)
//   GET  /account/stop?w=&t=           the watch mail's stop page, from its message    (the link's secret)
//   POST /account/stop?w=&t=           turn the account's watch mail off; one-click too (the link's secret)
//   POST /account/briefings            subscribe to a segment's or a buyer's briefing  (session, CSRF, the shared cap)
//   POST /account/briefings/:id        a briefing's delivery, weekly or off            (session, CSRF, plan to turn on)
//   POST /account/briefings/:id/delete remove a briefing                               (session, CSRF)
//   GET  /account/stop?b=&t=           a briefing's stop page, from its message        (the link's secret)
//   POST /account/stop?b=&t=           turn that briefing's email off; one-click too   (the link's secret)
//   GET  /account/stop?e=&t=           the weekly email's unsubscribe page              (the link's secret)
//   POST /account/stop?e=&t=           turn the weekly email off; one-click too        (the link's secret)
//   GET  /account/watches              watches with their last 14 days of events, the calendar feed (session)
//   POST /account/watches              watch a page (kind, target)                     (session, CSRF, plan's cap)
//   POST /account/watches/mail         the watch mail on or off                        (session, CSRF, plan to turn on)
//   POST /account/watches/:id          the events a watch follows and its cadence      (session, CSRF)
//   POST /account/watches/:id/delete   stop watching                                   (session, CSRF)
//   GET  /account/organization         your organization: the claim and its blocks     (session; blocks Pro)
//   POST /account/organization         claim one, checked against the profiles        (session, CSRF)
//   POST /account/organization/compare         add one to compare, at most five        (session, CSRF)
//   POST /account/organization/compare/remove  take one out                            (session, CSRF)
//   POST /account/organization/segment the share block's segment                       (session, CSRF)
//   POST /account/organization/delete  remove the claim                                (session, CSRF)
//   GET  /account/organization/:block.csv  a block as a file                           (session, plan)
//   GET  /account/matches              the open notices matching the claimed organization (session; plan's count)
//   GET  /account/billing              the plan, the prices or the subscription; with ?refund=confirm
//                                      the refund's confirmation step                 (session)
//   POST /account/billing/checkout     to the payment service's checkout              (session, CSRF)
//   POST /account/billing/portal       to the payment service's portal                (session, CSRF)
//   POST /account/billing/change       a move between Pro and Ultra, on the portal    (session, CSRF)
//   POST /account/billing/refund       refund the first payment, then cancel at once  (session read from the database, CSRF)
//   POST /account/billing/webhook      the payment service's notices                  (signature only)
//   GET  /account/dashboard            the dashboard's panels; ?edit=1 its controls   (session; Ultra, else what it holds
//                                      while Ultra is on sale, else the site's 404)
//   POST /account/dashboard/panels     add a panel (kind and ref, or panel)            (session, CSRF, plan's figure)
//   POST /account/dashboard/panels/:id/move    one place up or down (dir)              (session, CSRF)
//   POST /account/dashboard/panels/:id/width   full or half width (wide)               (session, CSRF)
//   POST /account/dashboard/panels/:id/delete  remove it                               (session, CSRF)
//   GET  /account/views                saved analytics views, each with its email      (session; the site's 404 until
//                                      the schema holds saved_views)
//   POST /account/views                save a view's own address, with a name          (session, CSRF, plan's figure)
//   POST /account/views/:id            a view's email: weekly, monthly or off          (session, CSRF, Ultra on sale to turn on)
//   POST /account/views/:id/delete     remove a view                                   (session, CSRF)
//   GET  /account/stop?v=&t=           a saved view's stop page, from its message      (the link's secret)
//   POST /account/stop?v=&t=           turn that view's email off; one-click too       (the link's secret)
//
// Every POST but the stop link's and the webhook's (which Stripe sends,
// signed; billing.tsx) is refused with a 403 when its Origin names another
// site (or "null"); a client that sends no Origin is let through, as
// interest.tsx does, since a browser always sends one with a form post; a
// sign-in post that carries follow (a public page's Follow form) or brief (a
// page's Save this briefing link) must say it comes from the site's page, or
// it sends nothing (POST /sign-in below). The
// two sign-in posts are capped per address by AUTH_LIMIT (limits.ts); the
// codes per address are capped in the database (signin.ts). Every response is
// no-store and noindex. The site's referrer policy already keeps a link's
// token off any request to another site.

import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { addDays } from "../../public/closing.js";
import { fromOwnPage, isOwnAddress } from "../api";
import { readForm } from "../body";
import { FEED_EVENTS_MAX, ICS_TYPE, closingStart } from "../calendar";
import { type Clock, clockOf, tenderState } from "../closing";
import { loadBuyer, loadContract, loadOpenList, loadProfile, loadStats, loadTender } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, t, type Key, type Lang } from "../i18n";
import { todayOf } from "../layout";
import { FEED_ICS } from "../limits";
import { readPublishedContract } from "../records_tables";
import { EMAIL_MAX, interestFilter, kindOfPath, normalizeEmail } from "../pages/interest";
import { deviceClass } from "../views";
import { KEY_NAME_MAX, createKey, listKeys, revokeKey } from "./api_keys";
import { keyUsage, nowOf } from "./api_usage";
import { usagePage } from "./api_usage_page";
import { audit } from "./audit";
import { billingLine, billingPage, billingWebhook, endForDeletion, moveBetweenPlans, openPortal, startCheckout } from "./billing";
import { pressRefund } from "./refund";
import { BriefingsPanel, briefingLabel, briefingStopView, briefingStoppedView } from "./briefing_pages";
import {
  type Brief, type BriefingSubject, addBriefing, briefOf, briefValue, briefingName, briefingPath, deleteBriefing, deleteBriefingsOf,
  isBriefingDelivery, isBriefingKind, lastBriefingRuns, listBriefings, narrowOf, setBriefingDelivery, subjectOf,
} from "./briefings";
import { bugPage, fileBug } from "./bugs";
import { type EditOp, addPanelPost, dashboardOpen, dashboardPage, deletePanelsFor, deletePanelsOf, editPanelPost } from "./dashboard";
import { DASHBOARD_PATH } from "./dashboard_rule";
import { type Plan, RULES, allowed, planFor, savedViewCap, watchCap } from "./entitlements";
import {
  FEEDS_MAX, FEED_SEARCH_KIND, type FeedKind, type FeedRead, type FeedRow, createFeed, deleteFeeds, feedAddress, feedCalendar, feedName,
  feedSize, feedWatches, isFeedKind, listFeeds, readFeed, removeFeed, rotateFeed, searchMatches,
} from "./feeds";
import {
  type CalendarRow, type CalendarView, accountPage, codeView, deleteView, deletedView, keysView, linkView, overviewView, searchesView,
  signInView, stopView, stoppedView, unavailableView, weeklyStopView, weeklyStoppedView,
} from "./pages";
import {
  type SavedSearch, addSearch, capFor, deleteSearch, importInterest, isDelivery, lastDeliveries, listSearches, pendingInterest, setDelivery,
} from "./searches";
import { randomHex, sameHash, sha256Hex, ipHash } from "./secrets";
import { isLocalHost, senderFor, signInMessage } from "./sender";
import {
  type Account, type UaClass, SESSION_COOKIE, clearSessionCookie, csrfValid, markSignedOut, readSession, revokeAllSessions,
  revokeSession, startSession,
} from "./session";
import {
  BRIEF_CODE_DETAIL, CODE_MINUTES, CODES_PER_HOUR, CODE_TRIES, type Checked, FOLLOW_CODES_PER_HOUR, FOLLOW_CODE_DETAIL, checkCode, checkLink,
  findOrCreateUser, followCodesInHour, issueCode, sweep,
} from "./signin";
import { accountsEnabled } from "./switch";
import {
  changeCompetitors, checkOrganization, claimOrganization, claimSummary, deleteClaim, deleteClaimOf, followClaimedId, isClaimBlock,
  isShareSource, orgIdIn, readClaim, setClaimSegment,
} from "./org_claim";
import { ORG_PATH, orgCsv, orgPage, segmentChoice, yearChoice } from "./org_pages";
import { checkoutPrice, planCards, ultraCheckoutPrice } from "../pro";
import { fiscalYearOf, planYears } from "../records_db";
import { readViewAddress } from "../view_address";
import {
  addView, cleanName, deleteView as deleteSavedView, deleteViewsOf, followViewAliases, isViewDelivery, lastViewRuns, listViews, missingViews, setViewDelivery,
  subjectName, viewLabel,
} from "./saved_views";
import { VIEWS_PATH, viewStopView, viewStoppedView, viewsView } from "./view_pages";
import { MATCH_PATH, matchesPage } from "./fit_pages";
import {
  DAY_SLOTS, type Follow, type WatchKind, followOf, followValue, isWatchKind, readEvents, segmentOf, targetOf, watchPath,
} from "./watch_events";
import { type WatchCalendar, watchStopView, watchStoppedView, watchesView } from "./watch_pages";
import {
  addWatch, countedWatches, deleteWatch, deleteWatchesOf, followAliases, isCadence, listWatches, mailOf, setMail, setWatch, watchCount,
  withinCap,
} from "./watches";
import { ultraOnSale } from "./payments";
import { deleteWeeklyOf, turnWeeklyOff, turnWeeklyOn, weeklyReady, weeklyState, weeklyStopRow } from "./weekly";

export const account = new Hono<AppEnv>();

account.use("*", async (c, next) => {
  if (!accountsEnabled(c.env)) return c.notFound();
  await next();
  // A calendar feed is read by a calendar app, never a page: private as
  // well; so is the organization an account claims, its page and its files,
  // and the notices matching it; and the dashboard, whose 404 stays as it was.
  const own = FEED_ICS.test(c.req.path) || c.req.path === ORG_PATH || c.req.path.startsWith(`${ORG_PATH}/`) || c.req.path === MATCH_PATH ||
    (c.req.path === DASHBOARD_PATH && c.res.status === 200);
  c.header("Cache-Control", own ? "private, no-store" : "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
});

// -- shared steps --------------------------------------------------------------------

const CONTROL_RE = /[\u0000-\u001F\u007F]/g;

function clean(fields: Record<string, string>, key: string, max: number): string {
  const v = fields[key];
  return (typeof v === "string" ? v : "").replace(CONTROL_RE, "").trim().slice(0, max);
}

// The body of a POST from the site's own pages, or the refusal.
async function postFields(c: Context<AppEnv>): Promise<Record<string, string> | Response> {
  const origin = c.req.header("origin");
  if (origin !== undefined && !isOwnAddress(origin, c.req.url)) return c.text(t(c.get("lang"), "form.rejected"), 403);
  const form = await readForm(c);
  if (!form.ok) return c.text(t(c.get("lang"), "form.rejected"), form.status);
  const asked = form.fields.lang;
  if (asked === "en" || asked === "fr") c.set("lang", asked);
  return form.fields;
}

function unavailable(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  return accountPage(c, t(lang, "account.unavailable_title"), unavailableView(lang), 503);
}

// The signed-in account, or the answer for a request without one: the
// sign-in page (cookie cleared) when the session does not stand, the 503
// page when the database cannot say.
async function signedIn(c: Context<AppEnv>): Promise<Account | Response> {
  const read = await readSession(c, { touch: true });
  if (read.state === "ok") return read.account;
  if (read.state === "unavailable") return unavailable(c);
  if (getCookie(c, SESSION_COOKIE)) clearSessionCookie(c);
  return c.redirect(signInFor(c), 303);
}

// Where a request without a session is sent. A page asked for by its address
// (a bookmark, a link in a message, a session that ran out) is carried as
// next, so signing in ends on that page and not on the overview; safeNext
// holds it to a path on this site. The overview is where sign-in ends anyway,
// and a form's press has no page of its own to return to: both go to the
// plain sign-in page.
function signInFor(c: Context<AppEnv>): string {
  if (c.req.method !== "GET") return "/account/sign-in";
  const url = new URL(c.req.url);
  const next = safeNext(url.pathname + url.search);
  return next && url.pathname !== "/account" ? `/account/sign-in?next=${encodeURIComponent(next)}` : "/account/sign-in";
}

// A POST that needs the session: the Origin, then the session, then the CSRF
// value the page's form carried.
async function signedInPost(c: Context<AppEnv>): Promise<{ account: Account; fields: Record<string, string> } | Response> {
  const fields = await postFields(c);
  if (fields instanceof Response) return fields;
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  if (!csrfValid(who, fields.csrf)) return c.text(t(c.get("lang"), "form.rejected"), 403);
  return { account: who, fields };
}

// Any database fault inside a handler ends on the 503 page, never a 500.
async function guarded(c: Context<AppEnv>, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    console.error(`account: ${String(e).slice(0, 120)}`);
    return unavailable(c);
  }
}

function uaClass(c: Context<AppEnv>): UaClass | null {
  return deviceClass(c.req.header("user-agent"), c.req.header("sec-ch-ua-mobile")) || null;
}

// Where the message's link and its wordmark images point: the request's own
// origin on a local run, the site's address otherwise.
function siteBase(c: Context<AppEnv>): string {
  if (isLocalHost(c.req.url) || !c.env.SITE_URL) return new URL(c.req.url).origin;
  return c.env.SITE_URL.replace(/\/+$/, "");
}

// -- sign-in ----------------------------------------------------------------------------

// The page to return to after signing in (?next=, from a page's Follow link):
// a path on this site only, never another host, never the sign-in pages.
const NEXT_MAX = 300;
export function safeNext(raw: string | undefined | null): string | null {
  if (!raw || raw.length > NEXT_MAX || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw) || raw.startsWith("/account/sign-in") || raw.startsWith("/account/check")) return null;
  return raw;
}

// ?follow= (or the follow field) is carried the same way, beside next: what a
// public page's Follow form asked to follow (watch_events.ts followOf), added
// once the address has proved itself (followAtSignIn). An invalid one is
// dropped without a word, as an unsafe next is. A GET only carries it: a
// reader already signed in goes back to the page, which offers its own
// Follow form, and nothing is added on a GET.
//
// ?brief= (or the brief field) goes the same way beside them: the briefing a
// segment or buyer page's Save this briefing link named (briefings.ts
// briefOf), saved once the address has proved itself (briefAtSignIn), held to
// the same guards as follow. No page carries both; a sign-in that does
// carries both on and adds each by its own steps.
//
// The weekly email's box (weekly.ts) is on the sign-in page's own form only,
// never ticked by the site, and only while its table is on the database
// (weeklyReady, one statement whatever the address). A tick rides on as
// weekly=1 the way the fields above do (the code form, the emailed link and
// its page) and is recorded only once the address has proved itself
// (weeklyAtSignIn). No GET reads it: an address cannot tick the box for
// anyone.
account.get("/sign-in", async (c) => {
  const lang = c.get("lang");
  const next = safeNext(c.req.query("next"));
  if ((await readSession(c)).state === "ok") return c.redirect(next ?? "/account", 303);
  const follow = followOf(c.req.query("follow"));
  const brief = briefOf(c.req.query("brief"));
  const m = c.req.query("m");
  const notice = m === "out" ? t(lang, "account.msg_signed_out") : m === "out_all" ? t(lang, "account.msg_signed_out_all") : null;
  const offerWeekly = await weeklyReady(c.env);
  return accountPage(c, t(lang, "account.sign_in_title"), signInView(lang, { notice, next, follow, brief, offerWeekly }));
});

account.post("/sign-in", async (c) => {
  const fields = await postFields(c);
  if (fields instanceof Response) return fields;
  const lang = c.get("lang");
  const typed = clean(fields, "email", EMAIL_MAX + 50);
  const next = safeNext(fields.next);
  const follow = followOf(fields.follow);
  const brief = briefOf(fields.brief);
  const offerWeekly = await weeklyReady(c.env);
  const weekly = offerWeekly && fields.weekly === "1";
  const again = (errors: Key[], status: number, limitN?: number) => accountPage(c, t(lang, "account.sign_in_title"),
    signInView(lang, { errors, email: typed.slice(0, EMAIL_MAX), limitN, next, follow, brief, offerWeekly }), status);
  if (clean(fields, "website", 10)) return again(["interest.err_rejected"], 400);
  const email = normalizeEmail(typed);
  if (!email) return again(["interest.err_email"], 400);
  // The Follow form sits on every public page, where crawlers read it. A post
  // that carries follow from a browser on the site's page says so in
  // Sec-Fetch-Site, Origin or Referer (api.ts fromOwnPage); one that says
  // none of them was most likely sent by a script that read the form, so no
  // message goes out: the sign-in page answers with the address kept and the
  // follow dropped. A reader on a browser that sends none of the three signs
  // in from there as before (its post carries no follow), and follows after.
  // Any client can send those headers, so the Follow posts of the whole site
  // also have a ceiling an hour (signin.ts FOLLOW_CODES_PER_HOUR), past which
  // one is answered the same way; the caps per address and per email stand
  // beside it (docs/accounts.md, Security posture). The sign-in page says how
  // to follow after signing in, and its own post is held to neither.
  // A post that carries brief is held to both rules alike, and the same
  // ceiling counts it (signin.ts); the page then says how to save the
  // briefing after signing in, and drops it too.
  const signInOnly = () => accountPage(c, t(lang, "account.sign_in_title"), signInView(lang, {
    email: typed.slice(0, EMAIL_MAX), next, offerWeekly,
    notice: [follow ? t(lang, "account.follow_after") : "", brief ? t(lang, "account.brief_after") : ""].filter(Boolean).join(" "),
  }));
  // The console lines name Follow whenever the post carries follow, as before.
  const what = follow ? "Follow" : "briefing";
  if ((follow || brief) && !fromOwnPage(c.req.raw.headers, c.req.url)) {
    console.log(`account sign-in: a ${what} post without a page's headers, answered with the sign-in page`);
    return signInOnly();
  }
  return guarded(c, async () => {
    const now = new Date();
    await sweep(c.env, now);
    if ((follow || brief) && (await followCodesInHour(c.env, now)) >= FOLLOW_CODES_PER_HOUR) {
      console.log(`account sign-in: the hour's ${follow ? "Follow" : "Follow and briefing"} requests are spent, answered with the sign-in page`);
      return signInOnly();
    }
    const issued = await issueCode(c.env, email, await ipHash(c.env.VIEWS_SALT_KEY, c.req.header("cf-connecting-ip"), now), now);
    if (issued === "limited") {
      await audit(c.env, null, "code_limited", null, now);
      return again(["account.err_limited"], 429, CODES_PER_HOUR);
    }
    // A Follow form's request, or one carrying a briefing, is marked, which is
    // what the hour's ceiling counts; one carrying both is marked once.
    await audit(c.env, issued.userId, "code_requested", follow ? FOLLOW_CODE_DETAIL : brief ? BRIEF_CODE_DETAIL : null, now);
    const base = siteBase(c);
    const link = `${base}/account/check?token=${issued.token}${lang === "fr" ? "&lang=fr" : ""}${next ? `&next=${encodeURIComponent(next)}` : ""}` +
      `${follow ? `&follow=${encodeURIComponent(followValue(follow.kind, follow.target))}` : ""}` +
      `${brief ? `&brief=${encodeURIComponent(briefValue(brief.kind, brief.subject))}` : ""}${weekly ? "&weekly=1" : ""}`;
    const sent = await senderFor(c.env, c.req.url)
      .send(signInMessage(lang, email, issued.code, link, CODE_MINUTES, base))
      .catch(() => ({ sent: false, reason: "failed" }) as const);
    if (!sent.sent) {
      if (sent.reason === "failed") await audit(c.env, issued.userId, "mail_failed", null, now);
      return again([sent.reason === "not_configured" ? "account.err_not_sent" : "account.err_send_failed"], 503);
    }
    return accountPage(c, t(lang, "account.check_title"), codeView(lang, { email, sent: true, next, follow, brief, weekly }));
  });
});

const TOKEN_RE = /^[0-9a-f]{32}\.[0-9a-f]{64}$/;

// The link is not used here: the page holds a button that posts it.
account.get("/check", async (c) => {
  const lang = c.get("lang");
  const token = c.req.query("token");
  if (token !== undefined) {
    const ok = TOKEN_RE.test(token);
    return accountPage(c, t(lang, "account.link_title"), linkView(lang, ok ? token : "", ok ? undefined : ["account.err_stale"],
      safeNext(c.req.query("next")), followOf(c.req.query("follow")), briefOf(c.req.query("brief")), c.req.query("weekly") === "1"), ok ? 200 : 400);
  }
  return accountPage(c, t(lang, "account.enter_title"), codeView(lang));
});

const CHECK_ERROR: Record<Exclude<Checked, { ok: true }>["reason"], Key> = {
  wrong: "account.err_code", locked: "account.err_locked", stale: "account.err_stale",
};

account.post("/check", async (c) => {
  const fields = await postFields(c);
  if (fields instanceof Response) return fields;
  const lang = c.get("lang");
  const token = clean(fields, "token", 200);
  const typed = clean(fields, "email", EMAIL_MAX + 50);
  const sentForm = clean(fields, "sent", 1) === "1";
  const next = safeNext(fields.next);
  const follow = followOf(fields.follow);
  const brief = briefOf(fields.brief);
  const weekly = fields.weekly === "1";
  return guarded(c, async () => {
    const now = new Date();
    let checked: Checked;
    let email: string | null = null;
    if (token) {
      checked = await checkLink(c.env, token, now);
    } else {
      email = normalizeEmail(typed);
      checked = email ? await checkCode(c.env, email, clean(fields, "code", 20).replace(/\s+/g, ""), now) : { ok: false, reason: "wrong", left: CODE_TRIES };
    }
    if (!checked.ok) {
      // The third and fourth wrong codes of the hour say how many tries are left.
      const left = checked.reason === "wrong" ? checked.left : null;
      const errors: Key[] = [left === 2 ? "account.err_code_two" : left === 1 ? "account.err_code_one" : CHECK_ERROR[checked.reason]];
      if (token) return accountPage(c, t(lang, "account.link_title"), linkView(lang, "", errors, next, follow, brief, weekly), 400);
      const title = t(lang, sentForm ? "account.check_title" : "account.enter_title");
      // A mistyped code keeps the page to return to, what to follow, the briefing to save and the weekly email's tick, for the next try.
      return accountPage(c, title,
        codeView(lang, { email: email ?? typed.slice(0, EMAIL_MAX), sent: sentForm && !!email, errors, next, follow, brief, weekly }), 400);
    }
    const user = await findOrCreateUser(c.env, checked.email, lang, now);
    if (user.created) await audit(c.env, user.id, "user_created", null, now);
    // The session this browser held until now (the same account or another)
    // ends here rather than living on unseen until its 30 days run out: its
    // cookie is about to be replaced.
    const before = await readSession(c);
    if (before.state === "ok") {
      await revokeSession(c.env, before.account.sessionId, now);
      await audit(c.env, before.account.userId, "signed_out", "replaced", now);
    }
    await startSession(c, user.id, uaClass(c), now);
    await audit(c.env, user.id, "signed_in", token ? "link" : "code", now);
    if (follow) await followAtSignIn(c, user.id, follow, lang, now);
    if (brief) await briefAtSignIn(c, user.id, brief, lang, now);
    if (weekly) await weeklyAtSignIn(c, user.id, now);
    if (next) return c.redirect(next, 303);
    const pending = await pendingInterest(c.env, checked.email, user.id).catch(() => []);
    return c.redirect(pending.length ? "/account/searches" : "/account", 303);
  });
});

account.post("/sign-out", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  return guarded(c, async () => {
    const all = fields.scope === "all";
    if (all) await revokeAllSessions(c.env, who.userId);
    else await revokeSession(c.env, who.sessionId);
    await audit(c.env, who.userId, all ? "signed_out_everywhere" : "signed_out");
    clearSessionCookie(c);
    markSignedOut(c);
    return c.redirect(`/account/sign-in?m=${all ? "out_all" : "out"}`, 303);
  });
});

// -- the overview ------------------------------------------------------------------------------

account.get("/", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  const lang = c.get("lang");
  return guarded(c, async () => {
    const counts = await c.env.ACCOUNTS!.prepare(
      "SELECT (SELECT COUNT(*) FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2) AS sessions, " +
      "(SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1) AS searches, " +
      "(SELECT COUNT(*) FROM api_keys WHERE user_id = ?1 AND revoked_at IS NULL) AS keys",
    ).bind(who.userId, new Date().toISOString()).first<{ sessions: number; searches: number; keys: number }>();
    const watching = await watchCount(c.env, who.userId);
    const org = await claimSummary(c.env, who.userId);
    const m = c.req.query("m");
    return accountPage(c, t(lang, "account.title"), overviewView(lang, who, {
      sessions: counts?.sessions ?? 0, searches: counts?.searches ?? 0, cap: capFor(who), keys: counts?.keys ?? 0,
      watches: watching?.n ?? null, watchesOwn: watching?.own ?? false, org,
    }, {
      billing: await billingLine(c.env, who.userId),
      // Stripe's checkout returns here; the plan changes when its notice lands, often a moment later.
      notice: c.req.query("billing") === "done" ? t(lang, "billing.msg_done", { plan: t(lang, "pro.tag") })
        : c.req.query("billing") === "done_ultra" ? t(lang, "billing.msg_done", { plan: t(lang, "ultra.tag") })
        : m === "weekly_on" ? t(lang, "weekly.msg_on") : m === "weekly_off" ? t(lang, "weekly.msg_off") : null,
      // The weekly email's control; null leaves it out while its table is not on the database.
      weekly: await weeklyState(c.env, who.userId),
    }));
  });
});

// The overview's weekly email control: on or off, by the account's own
// choice. An email turned on is due from the first Monday after today
// (weekly.ts).
account.post("/weekly", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  if (fields.mail !== "on" && fields.mail !== "off") return c.text(t(c.get("lang"), "form.rejected"), 400);
  const on = fields.mail === "on";
  return guarded(c, async () => {
    const changed = on ? await turnWeeklyOn(c.env, who.userId, "account") : await turnWeeklyOff(c.env, who.userId);
    // No table on the database yet: the page has no control to answer.
    if (changed === null) return c.redirect("/account", 303);
    if (changed) await audit(c.env, who.userId, on ? "weekly_on" : "weekly_off", "account");
    return c.redirect(`/account?m=${on ? "weekly_on" : "weekly_off"}`, 303);
  });
});

// -- saved searches ------------------------------------------------------------------------------

const SEARCH_NOTICE: Record<string, Key> = {
  added: "account.msg_added", exists: "account.msg_exists", deleted: "account.msg_deleted", changed: "account.msg_changed",
  imported: "account.msg_imported", imported_some: "account.msg_imported_some", pro: "account.deliver_pro",
  // The calendar feeds' panel (feeds.ts).
  feed_added: "calfeed.msg_added", feed_exists: "calfeed.msg_exists", feed_cap: "calfeed.msg_cap", feed_missing: "calfeed.msg_missing",
  feed_pro: "calfeed.msg_pro", feed_rotated: "calfeed.msg_rotated", feed_removed: "calfeed.msg_removed",
  // The weekly briefings' panel (briefings.ts).
  b_added: "briefing.msg_added", b_exists: "briefing.msg_exists", b_removed: "briefing.msg_removed", b_changed: "briefing.msg_changed",
  b_pro: "briefing.msg_pro", b_cap: "briefing.msg_cap", b_gone: "briefing.msg_gone",
};

// A stored label is in the language of the page it was saved from; the page
// shows each one rebuilt in its own language, the stored label when the
// filter no longer rebuilds (a name the data no longer holds).
async function labelIn(c: Context<AppEnv>, lang: Lang, row: { kind: string; params: string; label: string; lang: string }): Promise<string> {
  if (row.lang === lang) return row.label;
  const rebuilt = await interestFilter(c.env, lang, row.kind, row.params).catch(() => null);
  return rebuilt?.label ?? row.label;
}

async function searchesPage(c: Context<AppEnv>, who: Account, extra: { errors?: Key[]; url?: string; status?: number } = {}) {
  const lang = c.get("lang");
  const [stored, waiting, last, feeds, briefings] = await Promise.all([
    listSearches(c.env, who.userId), pendingInterest(c.env, who.email, who.userId), lastDeliveries(c.env, who.userId),
    listFeeds(c.env, who.userId), listBriefings(c.env, who.userId),
  ]);
  // No briefings table on the database yet: the page leaves the panel out.
  const runs = briefings?.length ? await lastBriefingRuns(c.env, who.userId) : new Map();
  const briefed = briefings === null ? null : {
    n: briefings.length,
    panel: <BriefingsPanel lang={lang} account={who} briefings={briefings.map((b) => ({ ...b, last: runs.get(b.id) ?? null }))} />,
  };
  const searches = await Promise.all(stored.map(async (s) => ({ ...s, label: await labelIn(c, lang, s), last: last.get(s.id) ?? null })));
  const pending = await Promise.all(waiting.map(async (r) => ({ ...r, label: await labelIn(c, lang, r) })));
  const cap = capFor(who);
  const m = c.req.query("m") ?? "";
  const notice = m === "cap"
    ? t(lang, who.plan === "free" ? "account.cap_free" : "account.cap_pro", { cap })
    : SEARCH_NOTICE[m] ? t(lang, SEARCH_NOTICE[m]) : null;
  // No feeds table on the database yet: the page leaves the feeds out.
  const calendar = feeds === null ? null : await calendarView(c, lang, who, searches, feeds);
  // Ultra's figure beside a Pro account's, only while Ultra can be bought (payments.ts ultraOnSale).
  const ultra = RULES.ultra.saved_searches > cap && allowed(who, "delivery") && (await ultraOnSale(c.env)) ? RULES.ultra.saved_searches : null;
  return accountPage(c, t(lang, "account.searches_title"),
    searchesView(lang, who, { searches, cap, pending, notice, errors: extra.errors, url: extra.url, calendar, briefings: briefed, ultra }),
    extra.status ?? 200);
}

// What a page counts a feed's events with, as the feed reads them: the
// page's language, the site's address, the clock and the data date.
async function eventContext(c: Context<AppEnv>, lang: Lang): Promise<{ lang: Lang; base: string; clock: Clock; dataDate: string }> {
  const stats = await loadStats(c.env).catch(() => null);
  return { lang, base: siteBase(c), clock: clockOf(c.env), dataDate: todayOf(stats?.data_as_of) };
}

// The feeds panel's rows: each saved tender search with its feed, then the
// "all" feed (feeds.ts), each with how many events it holds now (null when
// what it reads cannot be read): a search's counted from the open notices,
// the "all" feed's as the feed reads it, with the account's watches.
async function calendarView(
  c: Context<AppEnv>, lang: Lang, who: Pick<Account, "userId" | "plan">, searches: SavedSearch[], feeds: FeedRow[],
): Promise<CalendarView> {
  const tenders = searches.filter((s) => s.kind === FEED_SEARCH_KIND);
  const open = tenders.length ? await loadOpenList(c.env).catch(() => null) : null;
  const clock = clockOf(c.env);
  const matches = new Map(tenders.map((s) => [
    s.id, open ? searchMatches(open, s.params, clock).filter((r) => closingStart(r.closing)).length : null,
  ]));
  const base = siteBase(c);
  const cell = (row: FeedRow | undefined, n: number | null): CalendarRow["feed"] => row ? {
    id: row.id, address: feedAddress(base, row, lang), lastRead: row.last_read_day, events: n === null ? null : Math.min(n, FEED_EVENTS_MAX),
  } : null;
  const rows: CalendarRow[] = tenders.map((s) => ({
    kind: "search", searchId: s.id, label: s.label, href: s.params,
    feed: cell(feeds.find((f) => f.kind === "search" && f.search_id === s.id), matches.get(s.id) ?? null),
  }));
  const allFeed = feeds.find((f) => f.kind === "all");
  if (tenders.length || allFeed) {
    const watches = allFeed ? await feedWatches(c.env, who.userId, who.plan).catch(() => null) : null;
    const n = watches ? await feedSize(c.env, {
      kind: "all", searches: tenders.map(({ id, params, label, lang: l }) => ({ id, params, label, lang: l })), watches,
    }, await eventContext(c, lang)) : null;
    rows.push({ kind: "all", searchId: null, label: t(lang, "calfeed.kind_all"), href: null, feed: cell(allFeed, n) });
  }
  return { rows, live: feeds.length };
}

account.get("/searches", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => searchesPage(c, who));
});

// A page address as the user pasted it: a path on the site, or a full
// address on the site's host. Anything else is not a page to save.
function sitePath(raw: string, requestUrl: string): string | null {
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    return isOwnAddress(url.origin, requestUrl) ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

// The page a press of Save this search returns to, in the page's language: a
// French page's address says so, as the watch post's return does, in case the
// browser keeps no language cookie.
function inLang(path: string, lang: Lang): string {
  const cut = path.includes("#") ? path.indexOf("#") : path.length;
  const before = path.slice(0, cut);
  if (lang !== "fr" || /[?&]lang=/.test(before)) return path;
  return `${before}${before.includes("?") ? "&" : "?"}lang=fr${path.slice(cut)}`;
}

// Add a Search posts the address typed or pasted; a page's Save this search
// (search_control.tsx) posts the page's own address and next, the page to
// return to. One path for both: the filter is rebuilt from the address
// (interestFilter), the insert is held to the plan's cap and stores a filter
// saved already once (searches.ts addSearch), and an address that is not a
// page with a filter is refused with the searches page's own line. A press
// then goes back to next, which safeNext holds to a path on this site (an
// unsafe one is dropped for the filter's own page), where the control reads
// saved, or shows the cap when nothing was added; the audit's detail says
// which form added the search.
account.post("/searches", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const lang = c.get("lang");
  const raw = clean(fields, "url", 2100);
  const pressed = typeof fields.next === "string";
  return guarded(c, async () => {
    const path = sitePath(raw, c.req.url);
    const kind = path ? kindOfPath(path.split("?")[0]) : null;
    const filter = path && kind ? await interestFilter(c.env, lang, kind, path) : null;
    if (!filter) return searchesPage(c, who, { errors: ["account.err_url"], url: raw, status: 400 });
    const result = await addSearch(c.env, who, filter, lang);
    if (result === "added") await audit(c.env, who.userId, "search_added", pressed ? `${filter.kind} on its page` : filter.kind);
    if (pressed) return c.redirect(inLang(safeNext(fields.next) ?? filter.params, lang), 303);
    return c.redirect(`/account/searches?m=${result === "added" ? "added" : result}`, 303);
  });
});

account.post("/searches/import", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    const { imported, left } = await importInterest(c.env, who);
    await audit(c.env, who.userId, "searches_imported", `${imported} added, ${left} left`);
    return c.redirect(`/account/searches?m=${left ? "imported_some" : "imported"}`, 303);
  });
});

account.post("/searches/:id/delete", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    const id = c.req.param("id") ?? "";
    if (await deleteSearch(c.env, who.userId, id)) {
      await audit(c.env, who.userId, "search_deleted");
      // Its dashboard panel goes with it (dashboard.tsx).
      await deletePanelsFor(c.env, who.userId, ["tenders", "radar", "records"], id);
    }
    return c.redirect("/account/searches?m=deleted", 303);
  });
});

account.post("/searches/:id", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const deliver = fields.deliver;
  if (!isDelivery(deliver)) return c.text(t(c.get("lang"), "form.rejected"), 400);
  if (deliver !== "off" && !allowed(who, "delivery")) return c.redirect("/account/searches?m=pro", 303);
  return guarded(c, async () => {
    // Nothing changes for a search of a kind that cannot be delivered yet (searches.ts).
    if (!(await setDelivery(c.env, who.userId, c.req.param("id") ?? "", deliver))) return c.redirect("/account/searches", 303);
    await audit(c.env, who.userId, "search_changed", deliver);
    return c.redirect("/account/searches?m=changed", 303);
  });
});

// -- weekly briefings (briefings.ts, briefing_pages.tsx) ------------------------------------------

// A briefing's label, the site's and never typed: a segment's code and name,
// a buyer's name as the data holds it (and a narrowed one's segment); null
// for a buyer the data no longer holds, for which nothing is added.
async function briefingLabelOf(c: Context<AppEnv>, s: BriefingSubject, lang: Lang): Promise<string | null> {
  if (s.kind !== "buyer") return briefingName(lang, s, "");
  const b = await loadBuyer(c.env, s.subject).catch(() => null);
  return b ? briefingName(lang, s, pick(lang, b.buyer.name_en, b.buyer.name_fr) ?? b.buyer.id) : null;
}

// The page's own form posts the kind, the subject and, on a buyer page, a
// segment; the label is the site's, read from the data. A Free account's
// briefing is kept with its email off. The answer goes back to the page,
// which then reads "Subscribed".
account.post("/briefings", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const lang = c.get("lang");
  const kind = fields.kind;
  const subject = isBriefingKind(kind) ? subjectOf(kind, clean(fields, "subject", 100)) : null;
  const segment = kind === "buyer" ? narrowOf(fields.segment) : "";
  if (!isBriefingKind(kind) || !subject || segment === null) return c.text(t(lang, "form.rejected"), 400);
  return guarded(c, async () => {
    const s = { kind, subject, segment };
    const label = await briefingLabelOf(c, s, lang);
    if (label === null) return c.redirect("/account/searches?m=b_gone#briefings", 303);
    const result = await addBriefing(c.env, who, { ...s, label }, lang);
    if (result === "added") await audit(c.env, who.userId, "briefing_added", kind);
    if (result === "cap") return c.redirect("/account/searches?m=b_cap#briefings", 303);
    return c.redirect(`${briefingPath(s)}${lang === "fr" ? "?lang=fr" : ""}`, 303);
  });
});

account.post("/briefings/:id/delete", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    const id = c.req.param("id") ?? "";
    if (await deleteBriefing(c.env, who.userId, id)) {
      await audit(c.env, who.userId, "briefing_removed");
      // Its dashboard panel goes with it (dashboard.tsx).
      await deletePanelsFor(c.env, who.userId, ["briefing"], id);
    }
    return c.redirect("/account/searches?m=b_removed#briefings", 303);
  });
});

account.post("/briefings/:id", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const deliver = fields.deliver;
  if (!isBriefingDelivery(deliver)) return c.text(t(c.get("lang"), "form.rejected"), 400);
  if (deliver !== "off" && !allowed(who, "delivery")) return c.redirect("/account/searches?m=b_pro#briefings", 303);
  return guarded(c, async () => {
    if (!(await setBriefingDelivery(c.env, who.userId, c.req.param("id") ?? "", deliver))) return c.redirect("/account/searches#briefings", 303);
    await audit(c.env, who.userId, "briefing_changed", deliver);
    return c.redirect("/account/searches?m=b_changed#briefings", 303);
  });
});

// -- calendar feeds (feeds.ts) ------------------------------------------------------------------

// A calendar app reads the feed: no session, no cookie, the secret in the
// address is the proof. A feed that does not stand (a wrong or rotated
// secret, a removed feed, a deleted search or account, a plan without
// delivery, a blocked account) is the site's 404; a database or a file that
// cannot be read is a 503 a calendar app retries, never an empty calendar.
// ?alarm=1d adds a reminder a day before each event.
account.get("/calendar/:file", async (c) => {
  const m = /^([0-9a-f]{32})\.ics$/.exec(c.req.param("file") ?? "");
  if (!m) return c.notFound();
  const lang = c.get("lang");
  const unread = () => {
    c.header("Retry-After", "600");
    return c.text(t(lang, "calfeed.unavailable"), 503);
  };
  let read: FeedRead;
  try {
    read = await readFeed(c.env, m[1], c.req.query("t") ?? "");
  } catch {
    read = { state: "unavailable" };
  }
  if (read.state === "none") return c.notFound();
  if (read.state === "unavailable") return unread();
  const stats = await loadStats(c.env).catch(() => null);
  if (!stats?.data_as_of) return unread();
  const feed = read.feed;
  const first = feed.searches[0];
  const label = feed.kind === "search" && first ? await labelIn(c, lang, { ...first, kind: FEED_SEARCH_KIND }) : undefined;
  try {
    const body = await feedCalendar(c.env, feed, {
      lang, base: siteBase(c), clock: clockOf(c.env), dataDate: todayOf(stats.data_as_of), alarm: c.req.query("alarm") === "1d",
      name: feedName(lang, feed, label),
    });
    c.header("Content-Type", ICS_TYPE);
    return c.body(body);
  } catch (e) {
    console.error(`calendar feed: ${String(e).slice(0, 120)}`);
    return unread();
  }
});

account.post("/calendar", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const kind = fields.kind;
  if (!isFeedKind(kind)) return c.text(t(c.get("lang"), "form.rejected"), 400);
  if (!allowed(who, "delivery")) return c.redirect(feedBack(kind, "feed_pro"), 303);
  return guarded(c, async () => {
    const result = await createFeed(c.env, who.userId, kind, kind === "search" ? clean(fields, "search", 64) : null);
    if (result === "added") await audit(c.env, who.userId, "feed_created", kind);
    return c.redirect(feedBack(kind, `feed_${result}`), 303);
  });
});

// The page a feed's row is on, with the line saying what was done: the
// watches page for the watchlist's feed, the searches page for the others
// (and for an id that names no live feed of the account's).
function feedBack(kind: FeedKind | null, m: string): string {
  return `${kind === "watchlist" ? "/account/watches" : "/account/searches"}?m=${m}#calendar`;
}

account.post("/calendar/:id/rotate", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    const kind = await rotateFeed(c.env, who.userId, c.req.param("id") ?? "");
    if (kind) await audit(c.env, who.userId, "feed_rotated");
    return c.redirect(feedBack(kind, "feed_rotated"), 303);
  });
});

account.post("/calendar/:id/delete", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    const kind = await removeFeed(c.env, who.userId, c.req.param("id") ?? "");
    if (kind) await audit(c.env, who.userId, "feed_removed");
    return c.redirect(feedBack(kind, "feed_removed"), 303);
  });
});

// -- stopping a delivery from its message ------------------------------------------------------

// Each message carries a stop link, /account/stop?s=<search id>&t=<secret>,
// in its footer and in its List-Unsubscribe header (deliveries.ts). The
// secret is the credential, so no session is asked for; the GET only shows
// the page (a mail scanner that opens the link changes nothing), and a POST
// turns the delivery off. A mail client's one-click POST (RFC 8058, the body
// List-Unsubscribe=One-Click) comes from the mail provider's servers with no
// page and no Origin of the site, so neither is asked for: a post from
// anywhere that holds the secret may turn that one delivery off, and no
// more. A link that matches nothing is the site's 404.
const STOP_VALUE_RE = /^[0-9a-f]{32}$/;

type StopRow = { id: string; user_id: string; kind: string; params: string; label: string; lang: string; deliver: string; secret: string };

async function stopTarget(c: Context<AppEnv>, searchId: string, secret: string): Promise<StopRow | null> {
  if (!STOP_VALUE_RE.test(searchId) || !STOP_VALUE_RE.test(secret)) return null;
  const row = await c.env.ACCOUNTS!.prepare(
    "SELECT s.id, s.user_id, s.kind, s.params, s.label, s.lang, s.deliver, k.secret FROM delivery_tokens k " +
    "JOIN saved_searches s ON s.id = k.search_id JOIN users u ON u.id = s.user_id WHERE k.search_id = ? AND u.status = 'active'",
  ).bind(searchId).first<StopRow>();
  return row && sameHash(row.secret, secret) ? row : null;
}

// The watch mail's stop link, /account/stop?w=<user id>&t=<secret>: the
// same rules, for the account's watch mail as a whole (watch_mail.ts). It
// turns the mail off; the watches stay.
type WatchStopRow = { user_id: string; mail: string; secret: string | null };

async function watchStopTarget(c: Context<AppEnv>, userId: string, secret: string): Promise<WatchStopRow | null> {
  if (!STOP_VALUE_RE.test(userId) || !STOP_VALUE_RE.test(secret)) return null;
  const row = await c.env.ACCOUNTS!.prepare(
    "SELECT m.user_id, m.mail, m.secret FROM watch_mail m JOIN users u ON u.id = m.user_id WHERE m.user_id = ? AND u.status = 'active'",
  ).bind(userId).first<WatchStopRow>();
  return row?.secret && sameHash(row.secret, secret) ? row : null;
}

// A briefing's stop link, /account/stop?b=<briefing id>&t=<secret>: the same
// rules, for that briefing alone (briefings.ts). It turns the briefing's email
// off; the briefing stays on the searches page.
type BriefingStopRow = {
  id: string; user_id: string; kind: string; subject: string; segment: string; label: string; lang: string; deliver: string; secret: string | null;
};

async function briefingStopTarget(c: Context<AppEnv>, id: string, secret: string): Promise<BriefingStopRow | null> {
  if (!STOP_VALUE_RE.test(id) || !STOP_VALUE_RE.test(secret)) return null;
  const row = await c.env.ACCOUNTS!.prepare(
    "SELECT b.id, b.user_id, b.kind, b.subject, b.segment, b.label, b.lang, b.deliver, b.secret FROM briefings b JOIN users u ON u.id = b.user_id " +
    "WHERE b.id = ? AND u.status = 'active'",
  ).bind(id).first<BriefingStopRow>();
  return row?.secret && sameHash(row.secret, secret) && isBriefingKind(row.kind) ? row : null;
}

const stopLabel = (lang: Lang, row: BriefingStopRow) =>
  isBriefingKind(row.kind) ? briefingLabel(lang, { ...row, kind: row.kind, lang: row.lang === "fr" ? "fr" : "en" }) : row.label;

// A saved view's stop link, /account/stop?v=<view id>&t=<secret>: the same
// rules, for that view alone (view_mail.ts). It turns the view's email off;
// the view stays on the saved views page. A database without the table
// matches nothing, as a wrong link does.
type ViewStopRow = { id: string; user_id: string; name: string; deliver: string; secret: string | null };

async function viewStopTarget(c: Context<AppEnv>, id: string, secret: string): Promise<ViewStopRow | null> {
  if (!STOP_VALUE_RE.test(id) || !STOP_VALUE_RE.test(secret)) return null;
  try {
    const row = await c.env.ACCOUNTS!.prepare(
      "SELECT v.id, v.user_id, v.name, v.deliver, v.secret FROM saved_views v JOIN users u ON u.id = v.user_id WHERE v.id = ? AND u.status = 'active'",
    ).bind(id).first<ViewStopRow>();
    return row?.secret && sameHash(row.secret, secret) ? row : null;
  } catch (e) {
    if (missingViews(e)) return null;
    throw e;
  }
}

// The weekly email's unsubscribe link, /account/stop?e=<user id>&t=<secret>:
// the same rules, for the account's weekly email (weekly.ts). It turns the
// email off; the row stays, off, and the account page turns it back on. A
// database without the table matches nothing, as a wrong link does.
async function weeklyStopTarget(c: Context<AppEnv>, userId: string, secret: string) {
  if (!STOP_VALUE_RE.test(userId) || !STOP_VALUE_RE.test(secret)) return null;
  const row = await weeklyStopRow(c.env, userId);
  return row?.secret && sameHash(row.secret, secret) ? row : null;
}

account.get("/stop", async (c) => {
  const lang = c.get("lang");
  const searchId = c.req.query("s") ?? "";
  const secret = c.req.query("t") ?? "";
  const watcher = c.req.query("w");
  const briefing = c.req.query("b");
  const weekly = c.req.query("e");
  const view = c.req.query("v");
  return guarded(c, async () => {
    if (view !== undefined && !searchId && watcher === undefined && briefing === undefined && weekly === undefined) {
      const mine = await viewStopTarget(c, view, secret);
      if (!mine) return c.notFound();
      return accountPage(c, t(lang, "views.stop_title"), viewStopView(lang, { id: mine.id, secret, name: mine.name, off: mine.deliver === "off" }));
    }
    if (weekly !== undefined && !searchId && watcher === undefined && briefing === undefined) {
      const mine = await weeklyStopTarget(c, weekly, secret);
      if (!mine) return c.notFound();
      return accountPage(c, t(lang, "weekly.stop_title"), weeklyStopView(lang, { userId: mine.user_id, secret, off: mine.mail === "off" }));
    }
    if (briefing !== undefined && !searchId) {
      const mine = await briefingStopTarget(c, briefing, secret);
      if (!mine) return c.notFound();
      return accountPage(c, t(lang, "briefing.stop_title"),
        briefingStopView(lang, { id: mine.id, secret, label: stopLabel(lang, mine), off: mine.deliver === "off" }));
    }
    if (watcher !== undefined && !searchId) {
      const mine = await watchStopTarget(c, watcher, secret);
      if (!mine) return c.notFound();
      return accountPage(c, t(lang, "watches.stop_title"), watchStopView(lang, { userId: mine.user_id, secret, off: mine.mail === "off" }));
    }
    const row = await stopTarget(c, searchId, secret);
    if (!row) return c.notFound();
    return accountPage(c, t(lang, "account.stop_title"),
      stopView(lang, { searchId, secret, label: await labelIn(c, lang, row), off: row.deliver === "off" }));
  });
});

account.post("/stop", async (c) => {
  const form = await readForm(c);
  if (!form.ok) return c.text(t(c.get("lang"), "form.rejected"), form.status);
  const fields = form.fields;
  if (fields.lang === "en" || fields.lang === "fr") c.set("lang", fields.lang);
  const lang = c.get("lang");
  const searchId = clean(fields, "s", 64) || (c.req.query("s") ?? "");
  const secret = clean(fields, "t", 64) || (c.req.query("t") ?? "");
  const watcher = clean(fields, "w", 64) || (c.req.query("w") ?? "");
  const briefing = clean(fields, "b", 64) || (c.req.query("b") ?? "");
  const weekly = clean(fields, "e", 64) || (c.req.query("e") ?? "");
  const view = clean(fields, "v", 64) || (c.req.query("v") ?? "");
  const oneClick = fields["List-Unsubscribe"] === "One-Click";
  return guarded(c, async () => {
    if (view && !searchId && !watcher && !briefing && !weekly) {
      const mine = await viewStopTarget(c, view, secret);
      if (!mine) return c.notFound();
      if (mine.deliver !== "off") {
        await c.env.ACCOUNTS!.prepare("UPDATE saved_views SET deliver = 'off' WHERE id = ?").bind(mine.id).run();
        await audit(c.env, mine.user_id, "view_stopped", oneClick ? "one_click" : "link");
      }
      if (oneClick) return c.text(t(lang, "views.stopped_one_click"), 200);
      return accountPage(c, t(lang, "views.stopped_title"), viewStoppedView(lang, mine.name));
    }
    if (weekly && !searchId && !watcher && !briefing) {
      const mine = await weeklyStopTarget(c, weekly, secret);
      if (!mine) return c.notFound();
      if (mine.mail !== "off") {
        await turnWeeklyOff(c.env, mine.user_id);
        await audit(c.env, mine.user_id, "weekly_stopped", oneClick ? "one_click" : "link");
      }
      if (oneClick) return c.text(t(lang, "weekly.stopped_one_click"), 200);
      return accountPage(c, t(lang, "weekly.stopped_title"), weeklyStoppedView(lang));
    }
    if (briefing && !searchId && !watcher) {
      const mine = await briefingStopTarget(c, briefing, secret);
      if (!mine) return c.notFound();
      if (mine.deliver !== "off") {
        await c.env.ACCOUNTS!.prepare("UPDATE briefings SET deliver = 'off' WHERE id = ?").bind(mine.id).run();
        await audit(c.env, mine.user_id, "briefing_stopped", oneClick ? "one_click" : "link");
      }
      if (oneClick) return c.text(t(lang, "briefing.stopped_one_click"), 200);
      return accountPage(c, t(lang, "briefing.stopped_title"), briefingStoppedView(lang, stopLabel(lang, mine)));
    }
    if (watcher && !searchId) {
      const mine = await watchStopTarget(c, watcher, secret);
      if (!mine) return c.notFound();
      if (mine.mail !== "off") {
        await c.env.ACCOUNTS!.prepare("UPDATE watch_mail SET mail = 'off' WHERE user_id = ?").bind(mine.user_id).run();
        await audit(c.env, mine.user_id, "watch_mail_stopped", oneClick ? "one_click" : "link");
      }
      if (oneClick) return c.text(t(lang, "watches.stopped_one_click"), 200);
      return accountPage(c, t(lang, "watches.stopped_title"), watchStoppedView(lang));
    }
    const row = await stopTarget(c, searchId, secret);
    if (!row) return c.notFound();
    if (row.deliver !== "off") {
      await c.env.ACCOUNTS!.prepare("UPDATE saved_searches SET deliver = 'off' WHERE id = ?").bind(row.id).run();
      await audit(c.env, row.user_id, "delivery_stopped", oneClick ? "one_click" : "link");
    }
    if (oneClick) return c.text(t(lang, "account.stopped_one_click"), 200);
    return accountPage(c, t(lang, "account.stopped_title"), stoppedView(lang, await labelIn(c, lang, row)));
  });
});

// -- watches (watches.ts, watch_pages.tsx, watch_mail.ts) -------------------------------------------

const WATCH_NOTICE: Record<string, Key> = {
  added: "watches.msg_added", exists: "watches.msg_exists", removed: "watches.msg_removed", changed: "watches.msg_changed",
  unchanged: "watches.msg_unchanged", mail: "watches.msg_mail", pro: "watches.msg_pro", gone: "watches.msg_gone",
  // The watches' calendar feed (feeds.ts).
  feed_added: "calfeed.msg_added", feed_exists: "calfeed.msg_exists", feed_cap: "calfeed.msg_cap", feed_pro: "calfeed.msg_pro",
  feed_rotated: "calfeed.msg_rotated", feed_removed: "calfeed.msg_removed",
};

// The page's name as the site writes it, read from the data the page reads;
// null when the page no longer reads (a notice must still be open to be watched).
async function watchLabel(c: Context<AppEnv>, kind: WatchKind, target: string, lang: Lang): Promise<string | null> {
  if (kind === "organization") return (await loadProfile(c.env, target).catch(() => null))?.organization.display_name ?? null;
  if (kind === "buyer") {
    const b = await loadBuyer(c.env, target).catch(() => null);
    return b ? pick(lang, b.buyer.name_en, b.buyer.name_fr) ?? b.buyer.id : null;
  }
  const [head, ...rest] = target.split(":");
  if (kind === "tender") {
    const d = await loadTender(c.env, rest.join(":")).catch(() => null);
    if (!d) return null;
    const state = tenderState(d.status, d.closing, clockOf(c.env));
    if (state !== "open" && state !== "closing") return null;
    return pick(lang, d.title_en, d.title_fr) ?? d.reference;
  }
  if (head === "award" || head === "history") {
    const d = await loadContract(c.env, head, rest.join(":")).catch(() => null);
    return d ? pick(lang, d.title_en, d.title_fr) ?? d.reference : null;
  }
  const ref = rest.slice(1).join(":");
  const read = await readPublishedContract(c.env, rest[0], ref);
  if (read.state !== "ready") return ref;
  const row = (read.rows[0] ?? []).find((r) => r.self === 1);
  if (!row) return null;
  const description = pick(lang, typeof row.desc_en === "string" ? row.desc_en : null, typeof row.desc_fr === "string" ? row.desc_fr : null);
  return description ? description.split("\n")[0].slice(0, 200) : ref;
}

// The account's watches and its claim pointed at the ids the nightly's merges
// left (watches.ts followAliases, org_claim.ts followClaimedId), so the watch
// of the claimed organization, the one outside the cap, is compared on
// surviving ids before anything is counted or added.
async function alignWatches(c: Context<AppEnv>, userId: string) {
  const [listed, claimed] = await Promise.all([listWatches(c.env, userId), followClaimedId(c.env, userId)]);
  return { claimed, ...(await followAliases(c.env, userId, listed)) };
}

async function watchesPage(c: Context<AppEnv>, who: Account, said?: string, status = 200): Promise<Response> {
  const lang = c.get("lang");
  const [aligned, mail, stats, feeds] = await Promise.all([
    alignWatches(c, who.userId), mailOf(c.env, who.userId), loadStats(c.env).catch(() => null), listFeeds(c.env, who.userId),
  ]);
  // A watch on an organization or buyer the nightly merged follows the surviving id from this view on.
  const { watches, moved, merged, claimed } = aligned;
  const dataDate = stats?.data_as_of?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: DAY_SLOTS }, (_, i) => addDays(dataDate, -i));
  const cap = watchCap(who.plan);
  // Past the plan's figure (after a move to a smaller plan), events for the first ones by creation date only.
  const covered = withinCap(watches, cap, claimed);
  const read = covered.length ? await readEvents(c.env, covered, days) : null;
  const m = said ?? c.req.query("m") ?? "";
  const notice = m === "cap"
    ? allowed(who, "watch_mail") ? t(lang, "watches.control_cap_pro", { cap: fmtInt(cap, lang) })
      : t(lang, "watches.cap_free", { n: fmtInt(countedWatches(watches, claimed), lang), cap: fmtInt(cap, lang), max: fmtInt(RULES.pro.watchlists, lang) })
    : WATCH_NOTICE[m] ? t(lang, WATCH_NOTICE[m]) : null;
  // The watches' calendar feed, with how many events it holds now; no feeds
  // table on the database yet leaves it out.
  const row = feeds?.find((f) => f.kind === "watchlist");
  const calendar: WatchCalendar | null = feeds === null ? null : {
    feed: row ? {
      id: row.id, address: feedAddress(siteBase(c), row, lang), lastRead: row.last_read_day,
      events: allowed(who, "delivery") ? await feedSize(c.env, { kind: "watchlist", searches: [], watches: covered }, await eventContext(c, lang)) : null,
    } : null,
    full: feeds.length >= FEEDS_MAX,
  };
  // Ultra's figure beside a Pro account's, only while Ultra can be bought (payments.ts ultraOnSale).
  const ultra = RULES.ultra.watchlists > cap && allowed(who, "watch_mail") && (await ultraOnSale(c.env)) ? RULES.ultra.watchlists : null;
  return accountPage(c, t(lang, "watches.title"),
    watchesView(lang, who, { watches, read, days, mail, notice, moved, merged, calendar, claimed, covered, ultra }), status);
}

account.get("/watches", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => watchesPage(c, who));
});

// The page's own form posts the kind and the target; the label is read from
// the data, and the answer goes back to the page, which then reads "Watching".
account.post("/watches", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const lang = c.get("lang");
  const kind = fields.kind;
  const target = isWatchKind(kind) ? targetOf(kind, clean(fields, "target", 300)) : null;
  const segment = kind === "buyer" ? segmentOf(fields.segment) : "";
  if (!isWatchKind(kind) || !target || segment === null) return c.text(t(lang, "form.rejected"), 400);
  return guarded(c, async () => {
    const label = await watchLabel(c, kind, target, lang);
    if (!label) return c.redirect("/account/watches?m=gone", 303);
    const [stats] = await Promise.all([loadStats(c.env).catch(() => null), alignWatches(c, who.userId)]);
    const result = await addWatch(c.env, who, { kind, target, segment, label }, stats?.data_as_of?.slice(0, 10) ?? null);
    if (result === "added") await audit(c.env, who.userId, "watch_added", kind);
    // At the plan's cap the post is refused with the page's own line.
    if (result === "cap") return watchesPage(c, who, "cap", 403);
    return c.redirect(`${watchPath(kind, target)}${lang === "fr" ? "?lang=fr" : ""}`, 303);
  });
});

// The page a public page's Follow form named (follow), followed for the
// account whose address has just proved itself (POST /account/check, after
// the session starts): the watch post's own steps, for that account only.
// The label is read from the data (a page that no longer reads, or a notice
// no longer open, adds nothing), the watches are aligned on the merges, and
// the insert is held to the account's plan's cap (watches.ts addWatch): at
// the cap nothing is added and the page shows the cap; a page followed
// already stays as it is. A buyer is followed whole. The audit says the
// watch came with the sign-in. Nothing here may fail the sign-in: a fault is
// logged without detail and the reader goes on to the page.
async function followAtSignIn(c: Context<AppEnv>, userId: string, follow: Follow, lang: Lang, now: Date): Promise<void> {
  try {
    const label = await watchLabel(c, follow.kind, follow.target, lang);
    if (!label) return;
    const plan = await planAtSignIn(c, userId, now);
    if (!plan) return;
    const [stats] = await Promise.all([loadStats(c.env).catch(() => null), alignWatches(c, userId)]);
    const result = await addWatch(c.env, { userId, plan }, { ...follow, segment: "", label }, stats?.data_as_of?.slice(0, 10) ?? null, now);
    if (result === "added") await audit(c.env, userId, "watch_added", `${follow.kind} at sign-in`, now);
  } catch {
    console.error("account sign-in: the page named by Follow was not followed");
  }
}

// The plan of the account the address has just signed in to, as the session
// would read it; null when the row is not there.
async function planAtSignIn(c: Context<AppEnv>, userId: string, now: Date): Promise<Plan | null> {
  const user = await c.env.ACCOUNTS!.prepare("SELECT plan, plan_until FROM users WHERE id = ?").bind(userId)
    .first<{ plan: string; plan_until: string | null }>();
  return user ? (await planFor(c.env, { id: userId, ...user }, now)).plan : null;
}

// The briefing a segment or buyer page's Save this briefing link named
// (brief), saved for the account whose address has just proved itself (POST
// /account/check, after the session starts): the briefing post's own steps,
// for that account only. The label is read from the data (a buyer no longer
// in it adds nothing), and the insert is held to the cap the saved searches
// and the briefings share, keeps one briefing of a subject (one already there
// stays as it is) and is weekly on a plan with delivery, off otherwise
// (briefings.ts addBriefing); at the cap nothing is added and the page shows
// the cap. A buyer's is the whole buyer. The audit says the briefing came
// with the sign-in. Nothing here may fail the sign-in: a fault is logged
// without detail and the reader goes on to the page, which offers its own
// Subscribe form.
async function briefAtSignIn(c: Context<AppEnv>, userId: string, brief: Brief, lang: Lang, now: Date): Promise<void> {
  try {
    const s: BriefingSubject = { ...brief, segment: "" };
    const label = await briefingLabelOf(c, s, lang);
    if (!label) return;
    const plan = await planAtSignIn(c, userId, now);
    if (!plan) return;
    const result = await addBriefing(c.env, { userId, plan }, { ...s, label }, lang, now);
    if (result === "added") await audit(c.env, userId, "briefing_added", `${brief.kind} at sign-in`, now);
  } catch {
    console.error("account sign-in: the briefing named by Save this briefing was not saved");
  }
}

// The weekly email, turned on for the account whose address has just proved
// itself (POST /account/check, after the session starts), when the sign-in
// form's box was ticked: the choice and its time are recorded with "sign_in"
// (weekly.ts turnWeeklyOn), and the audit says it came with the sign-in. An
// email already on stays as it is. Nothing here may fail the sign-in: a
// table not there yet adds nothing, and any other fault is logged without
// detail.
async function weeklyAtSignIn(c: Context<AppEnv>, userId: string, now: Date): Promise<void> {
  try {
    if (await turnWeeklyOn(c.env, userId, "sign_in", now)) await audit(c.env, userId, "weekly_on", "at sign-in", now);
  } catch {
    console.error("account sign-in: the weekly email was not turned on");
  }
}

account.post("/watches/mail", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  if (fields.mail !== "on" && fields.mail !== "off") return c.text(t(c.get("lang"), "form.rejected"), 400);
  if (fields.mail === "on" && !allowed(who, "watch_mail")) return c.redirect("/account/watches?m=pro", 303);
  return guarded(c, async () => {
    await setMail(c.env, who.userId, fields.mail === "on");
    await audit(c.env, who.userId, "watch_mail", fields.mail);
    return c.redirect("/account/watches?m=mail", 303);
  });
});

account.post("/watches/:id/delete", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    if (await deleteWatch(c.env, who.userId, c.req.param("id") ?? "")) await audit(c.env, who.userId, "watch_removed");
    return c.redirect("/account/watches?m=removed", 303);
  });
});

// Each kind a checkbox of its own (ev_<kind>=1); at least one stays chosen.
account.post("/watches/:id", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const cadence = fields.cadence ?? "daily";
  if (!isCadence(cadence)) return c.text(t(c.get("lang"), "form.rejected"), 400);
  const events = Object.keys(fields).filter((k) => k.startsWith("ev_") && fields[k] === "1").map((k) => k.slice(3));
  return guarded(c, async () => {
    const saved = await setWatch(c.env, who.userId, c.req.param("id") ?? "", events, cadence);
    if (saved) await audit(c.env, who.userId, "watch_changed", cadence);
    return c.redirect(`/account/watches?m=${saved ? "changed" : "unchanged"}`, 303);
  });
});

// -- your organization (org_claim.ts, org_pages.tsx) ---------------------------------------------

// Back to the page with the line of what the post did, in the reader's language.
function orgBack(c: Context<AppEnv>, m: string, more = ""): Response {
  const q = [m ? `m=${m}` : "", more, c.get("lang") === "fr" ? "lang=fr" : ""].filter(Boolean).join("&");
  return c.redirect(`${ORG_PATH}${q ? `?${q}` : ""}`, 303);
}

account.get("/organization", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => orgPage(c, who));
});

// A claim: the id the page's button carries (or a pasted profile address),
// checked against the profiles; only the checked id is kept. A second claim
// replaces the first.
account.post("/organization", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  return guarded(c, async () => {
    const id = orgIdIn(clean(fields, "org", 300));
    const found = id ? await checkOrganization(c.env, id) : null;
    if (!found) return orgPage(c, who, { errors: ["orgclaim.err_org"], status: 400 });
    await claimOrganization(c.env, who.userId, found.id);
    await audit(c.env, who.userId, "org_claimed", found.id);
    const watched = await followClaimed(c, who, found.id, found.profile.organization.display_name);
    return orgBack(c, watched === "cap" ? "claimed_cap" : "claimed");
  });
});

// The claimed organization followed as a watch, outside the plan's cap
// (watches.ts ADD_WATCH_SQL): added with the default kinds when the account
// has no watch on it, under the account's own mail setting (addWatch keeps a
// watch_mail row that exists), and audited as the watch post audits its own.
// After the claim is written, so the insert reads it; "cap" only when the
// account is already over its plan's cap. A watch the account holds stays as
// it is: nothing here deletes or changes one.
async function followClaimed(c: Context<AppEnv>, who: Account, id: string, label: string): Promise<"added" | "exists" | "cap"> {
  const [stats] = await Promise.all([loadStats(c.env).catch(() => null), alignWatches(c, who.userId)]);
  const result = await addWatch(c.env, who, { kind: "organization", target: id, segment: "", label }, stats?.data_as_of?.slice(0, 10) ?? null);
  if (result === "added") await audit(c.env, who.userId, "watch_added", "organization");
  return result;
}

// One organization more to compare with (at most five, held inside the
// update), or one fewer.
account.post("/organization/compare/remove", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  return guarded(c, async () => {
    const claim = await readClaim(c.env, who.userId);
    const id = orgIdIn(clean(fields, "org", 300));
    if (!claim || !id) return orgBack(c, "");
    const result = await changeCompetitors(c.env, who.userId, claim, id, false);
    if (result === "removed") await audit(c.env, who.userId, "org_compare", "removed");
    return orgBack(c, result === "removed" ? "removed" : result === "busy" ? "busy" : "");
  });
});

account.post("/organization/compare", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  return guarded(c, async () => {
    const claim = await readClaim(c.env, who.userId);
    if (!claim) return orgBack(c, "");
    const id = orgIdIn(clean(fields, "org", 300));
    const found = id ? await checkOrganization(c.env, id) : null;
    if (!found) return orgPage(c, who, { errors: ["orgclaim.err_org"], status: 400 });
    const result = await changeCompetitors(c.env, who.userId, claim, found.id, true);
    if (result === "added") await audit(c.env, who.userId, "org_compare", "added");
    return orgBack(c, result === "none" ? "" : result);
  });
});

account.post("/organization/segment", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const segment = segmentChoice(fields.segment);
  if (segment === false) return c.text(t(c.get("lang"), "form.rejected"), 400);
  // Back to the source and fiscal year the block showed; the page drops a year outside its span.
  const year = yearChoice(fields.year);
  const shown = [isShareSource(fields.source) && fields.source !== "awards" ? `source=${fields.source}` : "", year !== null ? `year=${year}` : ""]
    .filter(Boolean).join("&");
  return guarded(c, async () => {
    const saved = await setClaimSegment(c.env, who.userId, segment);
    return orgBack(c, saved ? "segment" : "", shown);
  });
});

account.post("/organization/delete", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    if (await deleteClaim(c.env, who.userId)) await audit(c.env, who.userId, "org_unclaimed");
    return orgBack(c, "unclaimed");
  });
});

account.get("/organization/:file{[a-z]+\\.csv}", async (c) => {
  const block = (c.req.param("file") ?? "").replace(/\.csv$/, "");
  if (!isClaimBlock(block)) return c.notFound();
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => orgCsv(c, who, block));
});

// -- matching notices (fit_pages.tsx) --------------------------------------------------------------

account.get("/matches", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => matchesPage(c, who));
});

// -- API keys ----------------------------------------------------------------------------------------

async function keysPage(c: Context<AppEnv>, who: Account, extra: { created?: string; errors?: Key[]; status?: number } = {}) {
  const lang = c.get("lang");
  const keys = await listKeys(c.env, who.userId);
  // The counts are read only when there is a key to count; null says they cannot be read.
  const usage = keys.length ? await keyUsage(c.env, who.userId, nowOf(c.env)) : new Map();
  const notice = c.req.query("m") === "revoked" && !extra.created ? t(lang, "account.msg_key_revoked") : null;
  return accountPage(c, t(lang, "account.keys_title"),
    keysView(lang, who, { keys, usage, created: extra.created, notice, errors: extra.errors }), extra.status ?? 200);
}

account.get("/keys", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => keysPage(c, who));
});

// The new key is in this response's body and nowhere else: no redirect, no
// cache, never in an address.
account.post("/keys", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  return guarded(c, async () => {
    if (!allowed(who, "api")) {
      await audit(c.env, who.userId, "key_refused", "plan");
      return keysPage(c, who, { status: 403 });
    }
    const name = clean(fields, "name", KEY_NAME_MAX);
    if (!name) return keysPage(c, who, { errors: ["account.err_key_name"], status: 400 });
    const made = await createKey(c.env, who.userId, name);
    if (made === "limit") return keysPage(c, who, { status: 409 });
    await audit(c.env, who.userId, "key_created", made.prefix);
    return keysPage(c, who, { created: made.key });
  });
});

account.post("/keys/:id/revoke", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    if (await revokeKey(c.env, who.userId, c.req.param("id") ?? "")) await audit(c.env, who.userId, "key_revoked");
    return c.redirect("/account/keys?m=revoked", 303);
  });
});

// The keys' usage (api_usage_page.tsx); a plan without the keyed API goes to the keys page.
account.get("/api", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => usagePage(c, who));
});

// -- bug reports (bugs.tsx) ------------------------------------------------------------------

account.get("/bug", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => bugPage(c, who));
});

account.post("/bug", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  return guarded(c, () => fileBug(c, post.account, post.fields));
});

// -- the dashboard (dashboard.tsx) -------------------------------------------------------------

// While Ultra is not on sale the address is the site's 404 for anyone who does
// not hold it (dashboardOpen), so it reads as it did before Ultra; a reader
// signed out signs in and comes back (?next).
account.get("/dashboard", async (c) => {
  const open = await dashboardOpen(c, async () => {
    if (!getCookie(c, SESSION_COOKIE)) return { state: "none" };
    const read = await readSession(c);
    return read.state === "ok" ? { state: "ok", plan: read.account.plan } : read;
  });
  if (!open) return c.notFound();
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => dashboardPage(c, who));
});

account.post("/dashboard/panels", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  return guarded(c, () => addPanelPost(c, post.account, post.fields));
});

// The three changes of a panel: one place up or down, full or half width, removed.
const PANEL_OPS: Record<string, (fields: Record<string, string>) => EditOp | null> = {
  move: (f) => (f.dir === "up" || f.dir === "down" ? { op: "move", dir: f.dir } : null),
  width: (f) => (f.wide === "1" || f.wide === "0" ? { op: "width", wide: f.wide === "1" } : null),
  delete: () => ({ op: "delete" }),
};

account.post("/dashboard/panels/:id/:op{move|width|delete}", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const op = PANEL_OPS[c.req.param("op") ?? ""]?.(post.fields) ?? null;
  if (!op) return c.text(t(c.get("lang"), "form.rejected"), 400);
  return guarded(c, () => editPanelPost(c, post.account, c.req.param("id") ?? "", op, post.fields));
});

// -- saved analytics views (saved_views.ts, view_pages.tsx, view_mail.ts) -----------------------------

const VIEW_NOTICE: Record<string, Key> = { removed: "views.msg_removed", changed: "views.msg_changed" };

// The account's views, each with its newest run; a buyer's or an
// organization's view the nightly merged points at the surviving id first
// (its dashboard panel goes when it merged into another). The site's 404
// until the schema holds saved_views. A plan that keeps none reads what keeps
// them, with the plan cards, beside any it holds from a larger plan.
async function viewsPage(c: Context<AppEnv>, who: Account): Promise<Response> {
  const lang = c.get("lang");
  const listed = await listViews(c.env, who.userId);
  if (listed === null) return c.notFound();
  const { views, merged } = await followViewAliases(c.env, who.userId, listed);
  for (const id of merged) await deletePanelsFor(c.env, who.userId, ["view"], id);
  const runs = views.length ? await lastViewRuns(c.env, who.userId) : new Map();
  const ultra = await ultraOnSale(c.env).catch(() => false);
  const cards = savedViewCap(who.plan) ? null
    : planCards(lang, { price: checkoutPrice(c.env), ultra: await ultraCheckoutPrice(c.env), reader: "free", place: "tease" });
  const m = c.req.query("m") ?? "";
  return accountPage(c, t(lang, "views.title"), viewsView(lang, who, {
    views: views.map((v) => ({ ...v, last: runs.get(v.id) ?? null })), notice: VIEW_NOTICE[m] ? t(lang, VIEW_NOTICE[m]) : null, ultra, cards,
  }));
}

account.get("/views", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => viewsPage(c, who));
});

// Save this view posts the address the view wrote for itself and the name
// typed. The address is read as the view reads it at the data date, for the
// account's plan, and written again as the view writes it; anything that
// does not come back unchanged, or names a buyer or an organization the data
// no longer holds, is refused. A plan that keeps no view goes to the saved
// views page, which says what keeps them. The insert holds the plan's figure
// and keeps an address once; the answer goes back to the view, which then
// reads saved, or full.
account.post("/views", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const lang = c.get("lang");
  return guarded(c, async () => {
    const stats = await loadStats(c.env).catch(() => null);
    if (!stats?.data_as_of) return unavailable(c);
    const read = readViewAddress(typeof fields.address === "string" ? fields.address : "", {
      current: fiscalYearOf(todayOf(stats.data_as_of)), most: planYears(who.plan),
    });
    if (!read) return c.text(t(lang, "form.rejected"), 400);
    if (!savedViewCap(who.plan)) return c.redirect(inLang(VIEWS_PATH, lang), 303);
    const subject = await subjectName(c.env, lang, read.kind, read.id);
    if (!subject) return c.text(t(lang, "form.rejected"), 400);
    const name = cleanName(fields.name) || viewLabel(lang, subject, read.frame);
    const result = await addView(c.env, who, { kind: read.kind, address: read.address, name }, lang);
    if (result === "missing") return c.notFound();
    if (result === "added") await audit(c.env, who.userId, "view_saved", read.kind);
    return c.redirect(inLang(read.address, lang), 303);
  });
});

account.post("/views/:id/delete", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    const id = c.req.param("id") ?? "";
    if (await deleteSavedView(c.env, who.userId, id)) {
      await audit(c.env, who.userId, "view_removed");
      // Its dashboard panel goes with it (dashboard.tsx).
      await deletePanelsFor(c.env, who.userId, ["view"], id);
    }
    return c.redirect(`${VIEWS_PATH}?m=removed`, 303);
  });
});

// A view's email: off for any account; weekly or monthly for one whose plan
// sends saved views (Ultra) while Ultra is on sale, since the run sends
// nothing before that.
account.post("/views/:id", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const deliver = fields.deliver;
  if (!isViewDelivery(deliver)) return c.text(t(c.get("lang"), "form.rejected"), 400);
  return guarded(c, async () => {
    if (deliver !== "off" && !(allowed(who, "view_mail") && (await ultraOnSale(c.env)))) return c.redirect(VIEWS_PATH, 303);
    if (!(await setViewDelivery(c.env, who.userId, c.req.param("id") ?? "", deliver))) return c.redirect(VIEWS_PATH, 303);
    await audit(c.env, who.userId, "view_changed", deliver);
    return c.redirect(`${VIEWS_PATH}?m=changed`, 303);
  });
});

// -- deletion ----------------------------------------------------------------------------------------

account.get("/delete", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  const lang = c.get("lang");
  return accountPage(c, t(lang, "account.delete_title"), deleteView(lang, who));
});

// The user row stays, marked deleted, its email replaced by "deleted:" and
// SHA-256 of a random salt and the address, the salt thrown away: the row
// cannot be matched to the address, and the address can sign up afresh.
// Sessions are revoked; calendar feeds, saved searches (with their stop
// links, delivery rows and records marks), keys, bug reports, the claim of
// an organization, the weekly email's row and sign-in requests are deleted;
// so are the address's rows in the alerts form's table. The entitlement rows
// stay, tied to the id alone, as the record of what was granted. The
// dashboard's panels, the saved views (with their runs), the watches, the
// claim, the briefings, the weekly email and the feeds go first, each on its
// own, so a database without their tables yet still deletes the rest.
export async function deleteAccount(c: Context<AppEnv>, who: Account, now = new Date()): Promise<void> {
  const db = c.env.ACCOUNTS!;
  const at = now.toISOString();
  const tomb = `deleted:${await sha256Hex(`${randomHex(32)}\n${who.email}`)}`;
  await deletePanelsOf(c.env, who.userId);
  await deleteViewsOf(c.env, who.userId);
  await deleteWatchesOf(c.env, who.userId);
  await deleteClaimOf(c.env, who.userId);
  await deleteBriefingsOf(c.env, who.userId);
  await deleteWeeklyOf(c.env, who.userId);
  await deleteFeeds(c.env, { userId: who.userId });
  await db.batch([
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, who.userId),
    db.prepare("DELETE FROM delivery_tokens WHERE search_id IN (SELECT id FROM saved_searches WHERE user_id = ?)").bind(who.userId),
    db.prepare("DELETE FROM deliveries WHERE saved_search_id IN (SELECT id FROM saved_searches WHERE user_id = ?)").bind(who.userId),
    db.prepare("DELETE FROM delivery_marks WHERE search_id IN (SELECT id FROM saved_searches WHERE user_id = ?)").bind(who.userId),
    db.prepare("DELETE FROM saved_searches WHERE user_id = ?").bind(who.userId),
    db.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(who.userId),
    db.prepare("DELETE FROM bug_reports WHERE user_id = ?").bind(who.userId),
    db.prepare("DELETE FROM magic_codes WHERE user_id = ? OR email = ?").bind(who.userId, who.email),
    db.prepare("DELETE FROM code_misses WHERE email = ?").bind(who.email),
    db.prepare(
      "UPDATE users SET email = ?, status = 'deleted', deleted_at = ?, last_seen_at = NULL, plan = 'free', plan_until = NULL WHERE id = ?",
    ).bind(tomb, at, who.userId),
  ]);
  try {
    await c.env.DB.prepare("DELETE FROM interest WHERE email = ?").bind(who.email).run();
  } catch {
    console.error("account deletion: alert requests not removed");
  }
  await audit(c.env, who.userId, "deleted", null, now);
}

account.post("/delete", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const lang = c.get("lang");
  if (fields.confirm !== "yes") return accountPage(c, t(lang, "account.delete_title"), deleteView(lang, who, ["account.err_confirm"]), 400);
  return guarded(c, async () => {
    // A deleted account must not be charged again: its subscription is cancelled first, or nothing is deleted.
    if (!(await endForDeletion(c.env, who.userId))) {
      return accountPage(c, t(lang, "account.delete_title"), deleteView(lang, who, ["billing.err_delete"]), 503);
    }
    await deleteAccount(c, who);
    await revokeAllSessions(c.env, who.userId);
    clearSessionCookie(c);
    markSignedOut(c);
    return accountPage(c, t(lang, "account.deleted_title"), deletedView(lang));
  });
});

// -- billing (billing.tsx) ------------------------------------------------------------------

account.get("/billing", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => billingPage(c, who));
});

account.post("/billing/checkout", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  return guarded(c, () => startCheckout(c, post.account, post.fields, siteBase(c)));
});

account.post("/billing/portal", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  return guarded(c, () => openPortal(c, post.account, siteBase(c)));
});

// A move between Pro and Ultra, on Stripe's portal (billing.tsx moveBetweenPlans).
account.post("/billing/change", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  return guarded(c, () => moveBetweenPlans(c, post.account, post.fields, siteBase(c)));
});

// Money moves on this post, so a session remembered through a database
// outage does not count: the 503 page, and nothing asked of Stripe.
account.post("/billing/refund", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  if (post.account.stale) return unavailable(c);
  return guarded(c, () => pressRefund(c, post.account, post.fields));
});

// Stripe posts here: no session, no Origin, no form; the signature decides.
account.post("/billing/webhook", (c) => billingWebhook(c));
