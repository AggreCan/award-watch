import type { Context, Next } from "hono";
import type { AppEnv, Env } from "./env";
import { t } from "./i18n";
import { accountsEnabled } from "./account/switch";

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
export type Bucket = "page" | "api" | "download" | "form" | "feed" | "calendar" | "auth" | "stop" | "hook";

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
const BILLING_POSTS = new Set(["/account/billing/checkout", "/account/billing/portal", "/account/billing/refund"]);
// The dashboard's posts (account/dashboard.tsx): each writes the account's
// layout, so they count with the forms, on the accounts terms; so do the
// saved views' (account/view_pages.tsx): save one, its email, remove it.
const DASHBOARD_POSTS = /^\/account\/dashboard\/panels(?:\/[^/]+\/(?:move|width|delete))?$/;
const VIEW_POSTS = /^\/account\/views(?:\/[^/]+(?:\/delete)?)?$/;

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
  if (method === "POST" && (path === "/account/bug" || BILLING_POSTS.has(path) || DASHBOARD_POSTS.test(path) || VIEW_POSTS.test(path))) return "form";
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

const BINDING: Record<Bucket, keyof Env> = {
  page: "PAGE_LIMIT", api: "API_LIMIT", download: "DOWNLOAD_LIMIT", form: "FORM_LIMIT", feed: "FEED_LIMIT", calendar: "CALENDAR_LIMIT",
  auth: "AUTH_LIMIT", stop: "STOP_LIMIT", hook: "WEBHOOK_LIMIT",
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
  const accountsOnly = bucket === "auth" || bucket === "stop" || bucket === "hook" || bucket === "calendar" ||
    ((bucket === "form" || bucket === "download") && c.req.path.startsWith("/account/"));
  if (accountsOnly && !accountsEnabled(c.env)) bucket = "page";
  const limiter = c.env[BINDING[bucket]] as RateLimit | undefined;
  if (!limiter) return next();
  let allowed = true;
  try {
    allowed = (await limiter.limit({ key: `${bucket}:${clientKey(c)}` })).success;
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
  return c.text(t(lang, "limits.too_many"), 429);
}
