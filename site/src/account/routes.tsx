// The /account routes, mounted by index.tsx. While the switch is off every one
// of them answers the site's own 404 before anything is read. While it is on:
//
//   GET  /account/sign-in              the address form (a session goes to /account)
//   POST /account/sign-in              makes a code and a link, sends them; the same page for any address
//   GET  /account/check                the code form; with ?token= the link's confirm button
//   POST /account/check                a code (with the address) or the link's token; starts the session,
//                                      then follows the page a Follow form named (follow), within the plan's cap
//   GET  /account                      the overview                                   (session)
//   POST /account/sign-out             this browser, or every browser (scope=all)     (session, CSRF)
//   GET  /account/searches             saved searches, the alerts form's rows to add  (session)
//   POST /account/searches             add from a page address                        (session, CSRF)
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
//   GET  /account/billing              the plan, the prices or the subscription       (session)
//   POST /account/billing/checkout     to the payment service's checkout              (session, CSRF)
//   POST /account/billing/portal       to the payment service's portal                (session, CSRF)
//   POST /account/billing/webhook      the payment service's notices                  (signature only)
//
// Every POST but the stop link's and the webhook's (which Stripe sends,
// signed; billing.tsx) is refused with a 403 when its Origin names another
// site (or "null"); a client that sends no Origin is let through, as
// interest.tsx does, since a browser always sends one with a form post; a
// sign-in post that carries follow (a public page's Follow form) must say it
// comes from the site's page, or it sends nothing (POST /sign-in below). The
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
import { billingLine, billingPage, billingWebhook, endForDeletion, openPortal, startCheckout } from "./billing";
import { BriefingsPanel, briefingLabel, briefingStopView, briefingStoppedView } from "./briefing_pages";
import {
  addBriefing, briefingName, briefingPath, deleteBriefing, deleteBriefingsOf, isBriefingDelivery, isBriefingKind, lastBriefingRuns,
  listBriefings, narrowOf, setBriefingDelivery, subjectOf,
} from "./briefings";
import { bugPage, fileBug } from "./bugs";
import { WATCH_MAX, allowed, planFor, watchCap } from "./entitlements";
import {
  FEEDS_MAX, FEED_SEARCH_KIND, type FeedKind, type FeedRead, type FeedRow, createFeed, deleteFeeds, feedAddress, feedCalendar, feedName,
  feedSize, feedWatches, isFeedKind, listFeeds, readFeed, removeFeed, rotateFeed, searchMatches,
} from "./feeds";
import {
  type CalendarRow, type CalendarView, accountPage, codeView, deleteView, deletedView, keysView, linkView, overviewView, searchesView,
  signInView, stopView, stoppedView, unavailableView,
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
  CODE_MINUTES, CODES_PER_HOUR, CODE_TRIES, type Checked, FOLLOW_CODES_PER_HOUR, FOLLOW_CODE_DETAIL, checkCode, checkLink, findOrCreateUser,
  followCodesInHour, issueCode, sweep,
} from "./signin";
import { accountsEnabled } from "./switch";
import {
  changeCompetitors, checkOrganization, claimOrganization, claimSummary, deleteClaim, deleteClaimOf, followClaimedId, isClaimBlock,
  isShareSource, orgIdIn, readClaim, setClaimSegment,
} from "./org_claim";
import { ORG_PATH, orgCsv, orgPage, segmentChoice } from "./org_pages";
import {
  DAY_SLOTS, type Follow, type WatchKind, followOf, followValue, isWatchKind, readEvents, segmentOf, targetOf, watchPath,
} from "./watch_events";
import { type WatchCalendar, watchStopView, watchStoppedView, watchesView } from "./watch_pages";
import {
  addWatch, countedWatches, deleteWatch, deleteWatchesOf, followAliases, isCadence, listWatches, mailOf, setMail, setWatch, watchCount,
} from "./watches";

export const account = new Hono<AppEnv>();

account.use("*", async (c, next) => {
  if (!accountsEnabled(c.env)) return c.notFound();
  await next();
  // A calendar feed is read by a calendar app, never a page: private as
  // well; so is the organization an account claims, its page and its files.
  const own = FEED_ICS.test(c.req.path) || c.req.path === ORG_PATH || c.req.path.startsWith(`${ORG_PATH}/`);
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
  return c.redirect("/account/sign-in", 303);
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
account.get("/sign-in", async (c) => {
  const lang = c.get("lang");
  const next = safeNext(c.req.query("next"));
  if ((await readSession(c)).state === "ok") return c.redirect(next ?? "/account", 303);
  const follow = followOf(c.req.query("follow"));
  const m = c.req.query("m");
  const notice = m === "out" ? t(lang, "account.msg_signed_out") : m === "out_all" ? t(lang, "account.msg_signed_out_all") : null;
  return accountPage(c, t(lang, "account.sign_in_title"), signInView(lang, { notice, next, follow }));
});

account.post("/sign-in", async (c) => {
  const fields = await postFields(c);
  if (fields instanceof Response) return fields;
  const lang = c.get("lang");
  const typed = clean(fields, "email", EMAIL_MAX + 50);
  const next = safeNext(fields.next);
  const follow = followOf(fields.follow);
  const again = (errors: Key[], status: number, limitN?: number) =>
    accountPage(c, t(lang, "account.sign_in_title"), signInView(lang, { errors, email: typed.slice(0, EMAIL_MAX), limitN, next, follow }), status);
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
  const signInOnly = () => accountPage(c, t(lang, "account.sign_in_title"),
    signInView(lang, { email: typed.slice(0, EMAIL_MAX), next, notice: t(lang, "account.follow_after") }));
  if (follow && !fromOwnPage(c.req.raw.headers, c.req.url)) {
    console.log("account sign-in: a Follow post without a page's headers, answered with the sign-in page");
    return signInOnly();
  }
  return guarded(c, async () => {
    const now = new Date();
    await sweep(c.env, now);
    if (follow && (await followCodesInHour(c.env, now)) >= FOLLOW_CODES_PER_HOUR) {
      console.log("account sign-in: the hour's Follow requests are spent, answered with the sign-in page");
      return signInOnly();
    }
    const issued = await issueCode(c.env, email, await ipHash(c.env.VIEWS_SALT_KEY, c.req.header("cf-connecting-ip"), now), now);
    if (issued === "limited") {
      await audit(c.env, null, "code_limited", null, now);
      return again(["account.err_limited"], 429, CODES_PER_HOUR);
    }
    // A Follow form's request is marked, which is what the hour's ceiling counts.
    await audit(c.env, issued.userId, "code_requested", follow ? FOLLOW_CODE_DETAIL : null, now);
    const base = siteBase(c);
    const link = `${base}/account/check?token=${issued.token}${lang === "fr" ? "&lang=fr" : ""}${next ? `&next=${encodeURIComponent(next)}` : ""}` +
      `${follow ? `&follow=${encodeURIComponent(followValue(follow.kind, follow.target))}` : ""}`;
    const sent = await senderFor(c.env, c.req.url)
      .send(signInMessage(lang, email, issued.code, link, CODE_MINUTES, base))
      .catch(() => ({ sent: false, reason: "failed" }) as const);
    if (!sent.sent) {
      if (sent.reason === "failed") await audit(c.env, issued.userId, "mail_failed", null, now);
      return again([sent.reason === "not_configured" ? "account.err_not_sent" : "account.err_send_failed"], 503);
    }
    return accountPage(c, t(lang, "account.check_title"), codeView(lang, { email, sent: true, next, follow }));
  });
});

const TOKEN_RE = /^[0-9a-f]{32}\.[0-9a-f]{64}$/;

// The link is not used here: the page holds a button that posts it.
account.get("/check", async (c) => {
  const lang = c.get("lang");
  const token = c.req.query("token");
  if (token !== undefined) {
    const ok = TOKEN_RE.test(token);
    return accountPage(c, t(lang, "account.link_title"),
      linkView(lang, ok ? token : "", ok ? undefined : ["account.err_stale"], safeNext(c.req.query("next")), followOf(c.req.query("follow"))),
      ok ? 200 : 400);
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
      if (token) return accountPage(c, t(lang, "account.link_title"), linkView(lang, "", errors, next, follow), 400);
      const title = t(lang, sentForm ? "account.check_title" : "account.enter_title");
      // A mistyped code keeps the page to return to and what to follow, for the next try.
      return accountPage(c, title, codeView(lang, { email: email ?? typed.slice(0, EMAIL_MAX), sent: sentForm && !!email, errors, next, follow }), 400);
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
    return accountPage(c, t(lang, "account.title"), overviewView(lang, who, {
      sessions: counts?.sessions ?? 0, searches: counts?.searches ?? 0, cap: capFor(who), keys: counts?.keys ?? 0,
      watches: watching?.n ?? null, watchesOwn: watching?.own ?? false, org,
    }, {
      billing: await billingLine(c.env, who.userId),
      // Stripe's checkout returns here; the plan changes when its notice lands, often a moment later.
      notice: c.req.query("billing") === "done" ? t(lang, "billing.msg_done") : null,
    }));
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
  const calendar = feeds === null ? null : await calendarView(c, lang, who.userId, searches, feeds);
  return accountPage(c, t(lang, "account.searches_title"),
    searchesView(lang, who, { searches, cap, pending, notice, errors: extra.errors, url: extra.url, calendar, briefings: briefed }), extra.status ?? 200);
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
async function calendarView(c: Context<AppEnv>, lang: Lang, userId: string, searches: SavedSearch[], feeds: FeedRow[]): Promise<CalendarView> {
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
    const watches = allFeed ? await feedWatches(c.env, userId).catch(() => null) : null;
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

account.post("/searches", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const lang = c.get("lang");
  const raw = clean(fields, "url", 2100);
  return guarded(c, async () => {
    const path = sitePath(raw, c.req.url);
    const kind = path ? kindOfPath(path.split("?")[0]) : null;
    const filter = path && kind ? await interestFilter(c.env, lang, kind, path) : null;
    if (!filter) return searchesPage(c, who, { errors: ["account.err_url"], url: raw, status: 400 });
    const result = await addSearch(c.env, who, filter, lang);
    if (result === "added") await audit(c.env, who.userId, "search_added", filter.kind);
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
    if (await deleteSearch(c.env, who.userId, c.req.param("id") ?? "")) await audit(c.env, who.userId, "search_deleted");
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
    let name = "";
    if (kind === "buyer") {
      const b = await loadBuyer(c.env, subject).catch(() => null);
      if (!b) return c.redirect("/account/searches?m=b_gone#briefings", 303);
      name = pick(lang, b.buyer.name_en, b.buyer.name_fr) ?? b.buyer.id;
    }
    const result = await addBriefing(c.env, who, { ...s, label: briefingName(lang, s, name) }, lang);
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
    if (await deleteBriefing(c.env, who.userId, c.req.param("id") ?? "")) await audit(c.env, who.userId, "briefing_removed");
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

account.get("/stop", async (c) => {
  const lang = c.get("lang");
  const searchId = c.req.query("s") ?? "";
  const secret = c.req.query("t") ?? "";
  const watcher = c.req.query("w");
  const briefing = c.req.query("b");
  return guarded(c, async () => {
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
  const oneClick = fields["List-Unsubscribe"] === "One-Click";
  return guarded(c, async () => {
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
  const read = watches.length ? await readEvents(c.env, watches, days) : null;
  const m = said ?? c.req.query("m") ?? "";
  const cap = watchCap(who.plan);
  const notice = m === "cap"
    ? allowed(who, "watch_mail") ? t(lang, "watches.control_cap_pro", { cap: fmtInt(cap, lang) })
      : t(lang, "watches.cap_free", { n: fmtInt(countedWatches(watches, claimed), lang), cap: fmtInt(cap, lang), max: fmtInt(WATCH_MAX, lang) })
    : WATCH_NOTICE[m] ? t(lang, WATCH_NOTICE[m]) : null;
  // The watches' calendar feed, with how many events it holds now; no feeds
  // table on the database yet leaves it out.
  const row = feeds?.find((f) => f.kind === "watchlist");
  const calendar: WatchCalendar | null = feeds === null ? null : {
    feed: row ? {
      id: row.id, address: feedAddress(siteBase(c), row, lang), lastRead: row.last_read_day,
      events: allowed(who, "delivery") ? await feedSize(c.env, { kind: "watchlist", searches: [], watches }, await eventContext(c, lang)) : null,
    } : null,
    full: feeds.length >= FEEDS_MAX,
  };
  return accountPage(c, t(lang, "watches.title"),
    watchesView(lang, who, { watches, read, days, mail, notice, moved, merged, calendar, claimed }), status);
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
    const user = await c.env.ACCOUNTS!.prepare("SELECT plan, plan_until FROM users WHERE id = ?").bind(userId)
      .first<{ plan: string; plan_until: string | null }>();
    if (!user) return;
    const { plan } = await planFor(c.env, { id: userId, ...user }, now);
    const [stats] = await Promise.all([loadStats(c.env).catch(() => null), alignWatches(c, userId)]);
    const result = await addWatch(c.env, { userId, plan }, { ...follow, segment: "", label }, stats?.data_as_of?.slice(0, 10) ?? null, now);
    if (result === "added") await audit(c.env, userId, "watch_added", `${follow.kind} at sign-in`, now);
  } catch {
    console.error("account sign-in: the page named by Follow was not followed");
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
  const source = isShareSource(fields.source) && fields.source !== "awards" ? `source=${fields.source}` : "";
  return guarded(c, async () => {
    const saved = await setClaimSegment(c.env, who.userId, segment);
    return orgBack(c, saved ? "segment" : "", source);
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
// an organization and sign-in requests are deleted; so are the address's
// rows in the alerts form's table. The entitlement rows stay, tied to the
// id alone, as the record of what was granted. The watches, the claim and
// the feeds go first, each on its own, so a database without their tables
// yet still deletes the rest.
export async function deleteAccount(c: Context<AppEnv>, who: Account, now = new Date()): Promise<void> {
  const db = c.env.ACCOUNTS!;
  const at = now.toISOString();
  const tomb = `deleted:${await sha256Hex(`${randomHex(32)}\n${who.email}`)}`;
  await deleteWatchesOf(c.env, who.userId);
  await deleteClaimOf(c.env, who.userId);
  await deleteBriefingsOf(c.env, who.userId);
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

// Stripe posts here: no session, no Origin, no form; the signature decides.
account.post("/billing/webhook", (c) => billingWebhook(c));
