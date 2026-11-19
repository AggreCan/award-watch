import type { Context, Next } from "hono";
import type { AppEnv, Env } from "./env";
import { t } from "./i18n";
import { paidAccountOf } from "./account/session";
import { accountsEnabled } from "./account/switch";
import { isNavigation, refusalPage } from "./limit_page";

// Which cap a request falls under. The API and the downloads get their own
// because a script can hammer them without ever looking like a visitor; form
// posts get the tightest because each one writes to the database; everything
// else (pages) gets a cap no reader reaches. The Atom feeds get a wide cap of
// their own: one feed service polls many of the feeds for all its readers
// from one address, and a 429 there would also hide those polls from the
// counts (views.ts). The radar's 6- and 12-month window files, which the
// Worker passes on (pages/expiring.tsx), count as pages. Other static files
// are served before the Worker runs and never arrive here.
//
// The sign-in posts of the accounts module (the address and the code) get
// the tightest cap of all, "auth", while the switch is on; while it is off
// they are unknown paths and count as pages, as they did before. The stop
// link of a delivery (/account/stop, both methods) gets "stop" on the same
// terms: every request there reads the accounts database, and its one-click
// posts come from mail providers' servers, so the cap sits between the
// pages' and the sign-in's. The accounts-open message's link off the email
// lists (/interest/stop, both methods) is the same kind of link and gets
// "stop" too. The payment service's webhook gets "hook" on the
// same terms: its posts come from the service's few addresses, which retry
// after a 429, and anything else posting there is refused at the signature.
// The bug report post of a Pro account (/account/bug) writes a row and sends
// a message, so it counts with the forms, on the same terms; so do the three
// billing posts (checkout, portal and refund), each of which calls the
// payment service, which no reader does five times a minute. The CSV
// files of the analytics views are downloads: each reads the records
// database, so a script asking for every table of every buyer meets the
// download cap rather than the pages'. A notice's or a contract's calendar
// file (pages/ics.ts) is a download too, and so is a block of an account's
// own organization as a file (/account/organization/<block>.csv), on the
// accounts terms. A Pro account's calendar feed
// (/account/calendar/<id>.ics, src/account/feeds.ts) gets "calendar", 20 a
// minute, on the accounts terms: each read checks the feed in the accounts
// database. The Atom feeds keep their wide cap of their own; the calendar
// services that poll a feed for many readers ask far less often (a
// subscribed calendar is read every few hours), so 20 a minute from one of
// their addresses holds for thousands of feeds.
//
// The dashboard's posts and the saved views' get "edit", 60 a minute, on the
// accounts terms: each writes rows of the account's own, and arranging a
// dashboard is a save a drop (the page's script waits for a pause) or, from
// a tile's menu, a post a step, so the forms' 5 would stop a reader
// mid-move and spend the cap a billing post or a bug report needs. The
// dashboard's one read, a tile at a new size after a resize, counts there
// too: it reads the account's rows and a tile's records. So does the
// overview's Sign out on another browser's row, which ends one session of
// the account's own.
//
// Which requests are downloads is bucketFor's decision alone. Who they are
// counted against is throttle's: a download whose session is signed in on Pro
// or Ultra is counted by the account (PAID_DOWNLOAD_LIMIT, 30 a minute, keyed
// by the user id), every other download by the address (DOWNLOAD_LIMIT, 10).
//
// A refusal to a browser's navigation (a form post, or a page a browser asks
// for) is a page in the site's shell with a link back (limit_page.tsx); a
// script, a feed reader or any other request keeps the plain text answer,
// and the API its JSON.
export type Bucket = "page" | "api" | "download" | "form" | "edit" | "feed" | "calendar" | "auth" | "stop" | "hook";

// A table of an analytics view as CSV (pages/analytics.tsx, analyticsCsv).
export const ANALYTICS_CSV = /^\/(?:buyers|organizations|segments)\/[^/]+\/analytics\/[a-z]+\.csv$/;
// A file of records from the records database (src/records_tables.ts): a
// filtered radar window's matches, a profile's or a buyer's record table.
// The standing offers' files (pages/instruments.tsx): a filtered list, and one instrument's holders.
export const INSTRUMENTS_CSV = /^\/instruments\/(?:rows|.+\/holders)\.csv$/;
export const RECORDS_CSV = /^\/(?:expiring\/(?:3m|6m|12m)\/rows|(?:buyers|organizations)\/[^/]+\/records)\.csv$/;
// A notice's or a contract's one-event calendar file.
export const RECORD_ICS = /^\/(?:(?:tenders|awards|history)\/[^/]+|contracts\/[^/]+\/.+)\.ics$/;
// A Pro account's calendar feed.
export const FEED_ICS = /^\/account\/calendar\/[^/]+\.ics$/;
// A block of an account's own organization as a file (src/account/org_pages.tsx):
// a download, on the accounts terms (a page while the switch is off).
export const ORG_CLAIM_CSV = /^\/account\/organization\/[a-z]+\.csv$/;

// The billing page's own posts (account/routes.tsx); the webhook has its bucket.
const BILLING_POSTS = new Set(["/account/billing/checkout", "/account/billing/portal", "/account/billing/change", "/account/billing/refund"]);
// The dashboard's posts (account/dashboard.tsx): each writes the account's
// layout or its dashboards (a new one, a name, an order, a deletion), so
// they count in the "edit" bucket, on the accounts terms (with them the
// checklist's add of tables and a starter's, account/dashboard_doors.tsx);
// so do the saved views' (account/view_pages.tsx): save one, its email,
// remove it; and the dashboard's reads (DASHBOARD_READS, GETs): one tile,
// the find page (the search database's batch) and a subject's checklist (a
// records batch).
const DASHBOARD_POSTS =
  /^\/account\/dashboard\/(?:panels(?:\/[^/]+\/(?:move|width|delete))?|layout|boards(?:\/[^/]+\/(?:rename|move|delete))?|tiles\/[^/]+\/(?:move|size|board|delete|text)|tables\/(?:buyers|organizations|segments)\/[^/]+|starter)$/;
const DASHBOARD_READS = /^\/account\/dashboard\/(?:tiles\/[^/]+|find|tables\/(?:buyers|organizations|segments)\/[^/]+)$/;
const VIEW_POSTS = /^\/account\/views(?:\/[^/]+(?:\/delete)?)?$/;
// The overview's Sign out on another of the account's browsers (account/routes.tsx).
const SESSION_POSTS = /^\/account\/sessions\/[^/]+\/sign-out$/;

// A HEAD request for a download (a link checker, a client asking a file's
// size before fetching it) moves no file, so it is not counted against the
// download cap; it is counted with the pages.
export function bucketFor(method: string, path: string): Bucket {
  if (path.startsWith("/data/feeds/")) return "feed";
  if (path.startsWith("/api/")) return "api";
  if (path.startsWith("/downloads/")) return method === "HEAD" ? "page" : "download";
  if (ANALYTICS_CSV.test(path) || RECORDS_CSV.test(path) || RECORD_ICS.test(path) || INSTRUMENTS_CSV.test(path) || ORG_CLAIM_CSV.test(path)) {
    return method === "HEAD" ? "page" : "download";
  }
  if (FEED_ICS.test(path)) return "calendar";
  if (method === "POST" && (path === "/account/sign-in" || path === "/account/check")) return "auth";
  if (path === "/account/stop" || path === "/interest/stop") return "stop";
  if (method === "POST" && path === "/account/billing/webhook") return "hook";
  if (method === "POST" && (DASHBOARD_POSTS.test(path) || VIEW_POSTS.test(path) || SESSION_POSTS.test(path))) return "edit";
  if (method === "GET" && DASHBOARD_READS.test(path)) return "edit";
  if (method === "POST" && (path === "/account/bug" || BILLING_POSTS.has(path))) return "form";
  if (method === "POST" && (path === "/corrections" || path === "/interest" || /^\/organizations\/[^/]+\/respond$/.test(path))) {
    return "form";
  }
  return "page";
}

// -- AI crawlers ------------------------------------------------------------------------------
//
// The crawlers that read the site for an AI search index, an answer engine or
// a model, by the token each writes in its user agent (lower case). Each has
// one budget for all its addresses: CRAWLER_LIMIT in wrangler.jsonc, counted
// by the crawler's name, since a crawler asks from hundreds of addresses and
// the per-address caps below never see it. In November 2026 Applebot went
// from 8,000 to 270,000 requests a day in two days, most of them single
// record pages, and with two other crawlers took most of the account's
// monthly request allowance; public/robots.txt closes those pages to them and
// asks for ten seconds between requests, which Apple's crawler does not
// follow (it "adjusts automatically when a site slows down or returns
// errors"), so the Worker answers 429 past the budget.
//
// Not here: the search engines' own crawlers (Googlebot, Bingbot, Yandex),
// which the site wants at their own pace, and an assistant fetching one page
// for a person who asked (ChatGPT-User, Claude-User, Perplexity-User,
// Keenable-User), which is a reader. The tokens are whole names, so none of
// those matches one.
export const AI_CRAWLERS: readonly string[] = [
  "applebot", "claude-searchbot", "claudebot", "anthropic-ai", "oai-searchbot", "gptbot", "perplexitybot", "keenablebot", "exasearchbot", "exabot",
  "amzn-searchbot", "meta-webindexer", "epochal-search", "reflectionbot", "youbot", "duckassistbot", "timpibot", "ai2bot", "bytespider", "amazonbot",
  "ccbot", "meta-externalagent", "facebookbot", "cohere-ai", "diffbot", "imagesiftbot", "omgili", "petalbot",
  // A headless browser built for AI agents and scrapers, which names itself and reads no robots.txt.
  "lightpanda",
];

// The crawler a user agent names, as its token; null for a reader, a search
// engine or an agent the list does not hold.
export function crawlerOf(userAgent: string | undefined): string | null {
  const ua = (userAgent ?? "").toLowerCase();
  if (!ua) return null;
  return AI_CRAWLERS.find((token) => ua.includes(token)) ?? null;
}

// What such a crawler may always read: the rules themselves and the map of
// the site, so one that is past its budget can still learn what to leave.
const CRAWLER_OPEN = new Set(["/robots.txt", "/llms.txt", "/sitemap.xml"]);

// The seconds a refused crawler is asked to wait: the budget's own period.
export const CRAWLER_RETRY_S = 60;

// The part of each minute in which such a crawler is served: its first
// CRAWLER_WINDOW_S seconds, by the UTC clock, a tenth of the time. Outside it
// the answer is 429 with the seconds to the next minute, before anything is
// read or counted. The limiter above cannot hold a crawler by itself: its
// counts "are local to the Cloudflare location" and approximate ("requests
// can exceed your configured limit", Cloudflare's rate limiting binding
// page), and on 2026-11-14 Applebot, arriving at four locations, was still
// served 124 pages a minute under a limit of ten, half the Worker's CPU time.
// The clock is the same everywhere, so this holds whatever the number of
// locations, with nothing shared to keep. Inside the window the limiter
// still counts.
export const CRAWLER_WINDOW_S = 6;

// Whether a crawler is served at this instant, and the seconds to wait when not.
export function crawlerWindow(nowMs: number): { open: boolean; wait: number } {
  const second = Math.floor(nowMs / 1000) % 60;
  return second < CRAWLER_WINDOW_S ? { open: true, wait: 0 } : { open: false, wait: 60 - second };
}

// -- search engines ---------------------------------------------------------------------------
//
// Googlebot and Bingbot index the site for people's searches, and the site
// wants every page they will take, at any pace. Google reads no Crawl-delay
// and, on meeting 429s, "reduces your site's crawl rate across the whole
// hostname"; Bing's group in robots.txt carries no delay. So a request that
// Cloudflare's edge has verified as a search engine's crawler, and whose user
// agent names one of the two, is never counted against the per-address page
// cap below. Neither test is enough alone: anyone can write the name, and the
// edge gives the same category to the crawlers of AI indexes (KeenableBot,
// ExaSearchBot and OAI-SearchBot on 2026-11-14), which keep their budget
// above. The other caps (the API, the downloads, the forms) hold for everyone.
export const SEARCH_ENGINES: readonly string[] = ["googlebot", "google-inspectiontool", "bingbot"];
export const SEARCH_ENGINE_CATEGORY = "Search Engine Crawler";

export function searchEngine(userAgent: string | undefined, verifiedBotCategory: unknown): boolean {
  if (verifiedBotCategory !== SEARCH_ENGINE_CATEGORY) return false;
  const ua = (userAgent ?? "").toLowerCase();
  return SEARCH_ENGINES.some((token) => ua.includes(token));
}

// The verified-bot category Cloudflare's edge gave the request, when it gave one.
function edgeCategory(c: Context<AppEnv>): unknown {
  return (c.req.raw as Request & { cf?: { verifiedBotCategory?: unknown } }).cf?.verifiedBotCategory;
}

const BINDING: Record<Bucket, keyof Env> = {
  page: "PAGE_LIMIT", api: "API_LIMIT", download: "DOWNLOAD_LIMIT", form: "FORM_LIMIT", edit: "EDIT_LIMIT", feed: "FEED_LIMIT",
  calendar: "CALENDAR_LIMIT", auth: "AUTH_LIMIT", stop: "STOP_LIMIT", hook: "WEBHOOK_LIMIT",
};

// The address Cloudflare saw. The edge sets this header itself and drops any
// copy a client sends, so it cannot be spoofed from outside.
export function clientKey(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

export async function throttle(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  // A crawler's own budget first, before anything is read for it: the answer
  // past it is a few bytes, and its addresses are never counted one by one.
  const crawler = crawlerOf(c.req.header("user-agent"));
  if (crawler && c.env.CRAWLER_LIMIT && !CRAWLER_OPEN.has(c.req.path)) {
    // Outside the crawlers' part of the minute: refused at once, the limiter not asked.
    const fixed = c.env.NOW ? Date.parse(c.env.NOW) : Number.NaN;
    const window = crawlerWindow(Number.isFinite(fixed) ? fixed : Date.now());
    if (!window.open) {
      c.header("Retry-After", String(window.wait));
      c.header("Cache-Control", "no-store");
      return c.text(t(c.get("lang") ?? "en", "limits.too_many"), 429);
    }
    let within = true;
    try {
      within = (await c.env.CRAWLER_LIMIT.limit({ key: `crawler:${crawler}` })).success;
    } catch {
      within = true; // a limiter fault must never take the site down
    }
    if (!within) {
      c.header("Retry-After", String(CRAWLER_RETRY_S));
      c.header("Cache-Control", "no-store");
      return c.text(t(c.get("lang") ?? "en", "limits.too_many"), 429);
    }
  }
  let bucket = bucketFor(c.req.method, c.req.path);
  const accountsOnly = bucket === "auth" || bucket === "stop" || bucket === "hook" || bucket === "calendar" || bucket === "edit" ||
    ((bucket === "form" || bucket === "download") && c.req.path.startsWith("/account/"));
  if (accountsOnly && !accountsEnabled(c.env)) bucket = "page";
  // A verified search engine's crawler reads the pages at its own pace.
  if (bucket === "page" && searchEngine(c.req.header("user-agent"), edgeCategory(c))) return next();
  let limiter = c.env[BINDING[bucket]] as RateLimit | undefined;
  let key = `${bucket}:${clientKey(c)}`;
  // A download by a session signed in on a paid plan counts against that
  // account's own cap, keyed by its user id, in place of the address's
  // (PAID_DOWNLOAD_LIMIT): one buyer's analytics view alone offers 8 files,
  // and colleagues behind one office address each have their own. An account
  // in a group counts against the subscription's, keyed by the holder's id.
  // The account comes from the request's one session read, which the route
  // reuses; without a session cookie nothing is read (paidAccountOf).
  let paid = false;
  if (bucket === "download" && c.env.PAID_DOWNLOAD_LIMIT) {
    const userId = await paidAccountOf(c);
    if (userId) {
      limiter = c.env.PAID_DOWNLOAD_LIMIT;
      key = `account:${userId}`;
      paid = true;
    }
  }
  if (!limiter) return next();
  let allowed = true;
  try {
    allowed = (await limiter.limit({ key })).success;
  } catch {
    allowed = true; // a limiter fault must never take the site down
  }
  if (allowed) return next();
  c.header("Retry-After", "60");
  c.header("Cache-Control", "no-store");
  const lang = c.get("lang") ?? "en";
  if (bucket === "api") {
    return c.json({ error: t(lang, "limits.too_many_api") }, 429);
  }
  // The account's refusal says the account, since its address may have made none of them.
  const line = paid ? "limits.too_many_account" : "limits.too_many";
  if (isNavigation(c)) return refusalPage(c, 429, line);
  return c.text(t(lang, line), 429);
}
