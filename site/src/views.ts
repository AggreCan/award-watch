import type { Context, Next } from "hono";
import { isOwnAddress } from "./api";
import type { AppEnv } from "./env";
import { GUIDE_SLUGS } from "./guides";
import { DOWNLOADS, YEARLY_DOWNLOAD } from "./pages/data";

// Aggregate counts of what the Worker serves, written to Workers Analytics
// Engine (the VIEWS binding in wrangler.jsonc): one data point per response,
// holding the route template, the kind of request, the page language, the
// country code Cloudflare's edge attaches, the referring site's host name,
// the status code, the class of client that asked (a crawler, a person's
// browser, or one of two classes counted apart from both: a browser-shaped
// request from a hosting network, and one that opens a page robots.txt
// closes without following the site's link to it), and the device class
// read from the user agent. No address, user agent, network number, cookie,
// full referrer or raw path is written (a mistyped or pasted
// URL could carry anything, so a path that matches no route is stored as
// "other"). No script runs in the browser for this.
//
// Blob positions are fixed, because the roll-up reads older days with the
// same columns: blob1 route, blob2 kind, blob3 language, blob4 country,
// blob5 referring host, blob6 method, blob7 feed file (empty except for a
// feed), blob8 the class ("bot", "human", "hosted" or "closed", below),
// blob9 device ("desktop", "mobile" or "tablet"; empty for a bot), blob10
// the visitor code (people only, and empty when VIEWS_SALT_KEY is not set),
// blob11 the edge's verified-bot category, blob12 the version of the rule
// that set blob8 (AGENT_RULE). Points written before 2026-10-30 stop at
// blob6 or blob7 and read back as empty strings in the later columns; points
// written before the "hosted" and "closed" classes have an empty blob12.
//
// The visitor code counts people per day without keeping anything that
// identifies them: SHA-256 of the day's salt, the client address and the
// user agent, cut to 16 hex characters, where the salt is HMAC-SHA-256 of
// the UTC date under the Worker secret VIEWS_SALT_KEY. The address and the
// user agent are hashed and dropped; the code changes at midnight UTC; and
// without the secret no one can compute a code from an address. Whoever
// holds the secret could recompute a past day's salt, so the secret stays in
// the Worker and nowhere else.
//
// The Atom feeds are the one static file counted: wrangler.jsonc runs the
// Worker first for /data/feeds/*, so a feed reader's poll passes through
// here. Its point also holds the feed's file name (only when the file was
// served, so a typed path is never stored) and the subscriber count the
// reader states in its user agent. A feed poll is always a bot: a reader
// polls on a schedule whoever reads the result.
//
// The radar's 6- and 12-month window files pass through the Worker as well
// (the paid part of the radar once accounts open) and are counted as files.
// Other static files under /data/ and /fonts/ never reach the Worker, and a
// request the per-address limits answer with 429 stops before this
// middleware, so neither is counted. The plan's included data points match
// its included requests (100,000 a day on the free plan, 10 million a month
// on the paid one), so one point per response cannot exceed them. Data
// points are kept for three months; the nightly run keeps a daily roll-up in
// R2 (pipeline/awardwatch_pipeline/views_rollup.py).

// "hook" is the payment service's notices (POST /account/billing/webhook).
export type Kind = "page" | "api" | "download" | "form" | "file" | "feed" | "hook" | "other";

// /categories (and /categories/:nn below) now answer with a redirect to
// /segments; they stay so the counts of old links keep their route.
// /interest is the alerts form's post (kind form); a GET there is sent to /alerts.
const PAGES = new Set([
  "/", "/tenders", "/tenders/new", "/awards", "/expiring", "/organizations", "/buyers", "/segments", "/categories", "/rankings",
  "/feeds", "/watchlist", "/data", "/methodology", "/cite", "/corrections", "/about", "/terms", "/privacy",
  "/alerts", "/interest",
  // The plans page (pages/pro.tsx) and the weekly briefing's sample (account/briefing_pages.tsx SAMPLE_PATH).
  "/pro", "/pro/briefing-sample",
  // The stop link of the accounts-open message (account/announce.tsx): GET the page, POST the form.
  "/interest/stop",
  // The directory's old address, a redirect to /organizations, which /organizations/:id would otherwise count.
  "/organizations/directory",
  // The same-day notices' page (src/pages/same_day.tsx), which /tenders/:reference would otherwise count.
  "/tenders/same-day",
  // The award notices dated after the data date (pages/awards.tsx), which /awards/:reference would otherwise count.
  "/awards/erroneous",
  // The search page: its query string is never stored, only the route.
  "/search",
  // The index of the analytics views (pages/analytics_index.tsx); its query is never stored either.
  "/analytics",
  // The analytics builder (pages/builder.tsx), its view's query never stored.
  "/analytics/build",
  // The app home at its own address (pages/home.tsx), counted apart from "/", where a reader without a session gets the landing page.
  "/overview",
  // The guides' index (pages/guides.tsx); each guide is counted at its own address below.
  "/guides",
]);
const API_FIXED = new Set(["/api/stats"]);
const DOWNLOAD_FILES = new Set(DOWNLOADS.map((d) => d.file));
// The feed files feeds.py writes: feeds/<scope folders>/<event>.xml.
const FEED_PATH = /^\/data\/(feeds\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.xml)$/;

// The account's addresses (account/routes.tsx), counted by section as every
// other page is, never by an id or a secret: the pages a reader without an
// account meets (/account/sign-in, /account/check, a delivery's
// /account/stop), the account's own pages, the calendar feeds and the
// payment service's notices. A first segment this list does not name is
// "other", as any path that matches no route.
const ACCOUNT_SECTIONS = new Set([
  "sign-in", "check", "stop", "weekly", "mail-language", "sign-out", "sessions", "searches", "keys", "api", "bug", "delete",
  "calendar", "briefings", "watches", "organization", "matches", "billing", "dashboard", "views", "seats", "seat",
]);
// The dashboard's three reads (limits.ts DASHBOARD_READS), fetched by its
// script: parts of the dashboard page, so not page views of their own.
const DASHBOARD_READ = /^\/account\/dashboard\/(?:tiles\/[^/]+|find|tables\/[^/]+\/[^/]+)$/;
const ACCOUNT_PATH = /^\/account\/([a-z-]+)(\/.*)?$/;

function accountTemplate(method: string, path: string): { route: string; kind: Kind } {
  const kind: Kind = method === "POST" ? "form" : "page";
  if (path === "/account") return { route: path, kind };
  if (path === "/account/billing/webhook") return { route: path, kind: "hook" };
  if (/^\/account\/calendar\/[^/]+\.ics$/.test(path)) return { route: "/account/calendar/:id.ics", kind: "download" };
  if (method !== "POST" && DASHBOARD_READ.test(path)) return { route: "/account/dashboard/:read", kind: "file" };
  const m = ACCOUNT_PATH.exec(path);
  if (!m || !ACCOUNT_SECTIONS.has(m[1])) return { route: "other", kind: "other" };
  // A file of the account's own (account/org_pages.tsx: a block of the claimed organization as CSV).
  if (m[2] && method !== "POST" && path.endsWith(".csv")) return { route: `/account/${m[1]}/:file.csv`, kind: "download" };
  return { route: m[2] ? `/account/${m[1]}/:rest` : `/account/${m[1]}`, kind };
}

export function routeTemplate(method: string, path: string): { route: string; kind: Kind } {
  if (PAGES.has(path)) return { route: path, kind: method === "POST" ? "form" : "page" };
  if (path === "/account" || path.startsWith("/account/")) return accountTemplate(method, path);
  // The operator's console (account/admin.tsx): one template for its pages, one for everything under them, of kind
  // "other", so the operator's own work never counts among readers' page views or form posts.
  if (path === "/admin") return { route: path, kind: "other" };
  if (path.startsWith("/admin/")) return { route: "/admin/:rest", kind: "other" };
  // The briefing sample's message, the document the sample page shows in a frame: part of that page, not a page view.
  if (/^\/pro\/briefing-sample\/message\/[^/]+$/.test(path)) return { route: "/pro/briefing-sample/message/:scheme", kind: "file" };
  // A notice's or a contract's calendar file (pages/ics.ts), a download.
  const ics = /^\/(tenders|awards|history)\/[^/]+\.ics$/.exec(path);
  if (ics) return { route: `/${ics[1]}/:reference.ics`, kind: "download" };
  if (/^\/contracts\/[^/]+\/.+\.ics$/.test(path)) return { route: "/contracts/:dept/:reference.ics", kind: "download" };
  // One published contract (pages/published.tsx), the department then the reference as one escaped segment.
  if (/^\/contracts\/[^/]+\/.+$/.test(path)) return { route: "/contracts/:dept/:reference", kind: "page" };
  if (/^\/tenders\/[^/]+$/.test(path)) return { route: "/tenders/:reference", kind: "page" };
  if (/^\/awards\/[0-9]{4}$/.test(path)) return { route: "/awards/:year", kind: "page" };
  if (/^\/awards\/[^/]+$/.test(path)) return { route: "/awards/:reference", kind: "page" };
  if (/^\/history\/[^/]+$/.test(path)) return { route: "/history/:reference", kind: "page" };
  if (/^\/expiring\/[^/]+$/.test(path)) return { route: "/expiring/:window", kind: "page" };
  // A filtered window's matches as CSV (pages/expiring.tsx expiringRowsCsv).
  if (/^\/expiring\/[^/]+\/rows\.csv$/.test(path)) return { route: "/expiring/:window/rows.csv", kind: "download" };
  if (/^\/organizations\/directory\/[^/]+$/.test(path)) return { route: "/organizations/directory/:code", kind: "page" };
  if (/^\/organizations\/directory\/[^/]+\/[^/]+$/.test(path)) return { route: "/organizations/directory/:code/:page", kind: "page" };
  if (/^\/organizations\/[^/]+$/.test(path)) return { route: "/organizations/:id", kind: "page" };
  if (/^\/organizations\/[^/]+\/respond$/.test(path)) return { route: "/organizations/:id/respond", kind: method === "POST" ? "form" : "page" };
  // The analytics views and their CSV files (pages/analytics.tsx).
  const analytics = /^\/(buyers|organizations|segments)\/[^/]+\/analytics(\/[a-z]+\.csv)?$/.exec(path);
  if (analytics) {
    const param = analytics[1] === "segments" ? ":nn" : ":id";
    return analytics[2]
      ? { route: `/${analytics[1]}/${param}/analytics/:table.csv`, kind: "download" }
      : { route: `/${analytics[1]}/${param}/analytics`, kind: "page" };
  }
  // The record tables and their CSV files (pages/records.tsx).
  const records = /^\/(organizations|buyers)\/[^/]+\/records(\.csv)?$/.exec(path);
  if (records) {
    return records[2]
      ? { route: `/${records[1]}/:id/records.csv`, kind: "download" }
      : { route: `/${records[1]}/:id/records`, kind: "page" };
  }
  // The analytics builder's view as CSV (pages/builder.tsx).
  if (path === "/analytics/build.csv") return { route: path, kind: "download" };
  if (/^\/buyers\/[^/]+$/.test(path)) return { route: "/buyers/:id", kind: "page" };
  if (/^\/segments\/[^/]+$/.test(path)) return { route: "/segments/:nn", kind: "page" };
  if (/^\/categories\/[^/]+$/.test(path)) return { route: "/categories/:nn", kind: "page" };
  if (/^\/rankings\/[^/]+$/.test(path)) return { route: "/rankings/:year", kind: "page" };
  if (path.startsWith("/api/")) {
    if (API_FIXED.has(path)) return { route: path, kind: "api" };
    // The keyed API (src/api_keyed.ts): ids and windows folded into their templates.
    if (/^\/api\/v1\/(?:tenders\/open|tenders\/new|search|me)$/.test(path)) return { route: path, kind: "api" };
    if (/^\/api\/v1\/expiring\/[^/]+$/.test(path)) return { route: "/api/v1/expiring/:window", kind: "api" };
    const records = /^\/api\/v1\/(organizations|buyers)\/[^/]+\/records$/.exec(path);
    if (records) return { route: `/api/v1/${records[1]}/:id/records`, kind: "api" };
    if (path.startsWith("/api/v1/")) return { route: "/api/v1/other", kind: "api" };
    if (/^\/api\/organizations\/[^/]+$/.test(path)) return { route: "/api/organizations/:id", kind: "api" };
    if (/^\/api\/tenders\/[^/]+$/.test(path)) return { route: "/api/tenders/:reference", kind: "api" };
    if (/^\/api\/buyers\/[^/]+$/.test(path)) return { route: "/api/buyers/:id", kind: "api" };
    if (/^\/api\/categories\/[^/]+$/.test(path)) return { route: "/api/categories/:nn", kind: "api" };
    return { route: "/api/other", kind: "api" };
  }
  if (path.startsWith("/downloads/")) {
    const file = path.slice("/downloads/".length);
    if (DOWNLOAD_FILES.has(file)) return { route: path, kind: "download" };
    const yearly = YEARLY_DOWNLOAD.exec(file);
    if (yearly) return { route: `/downloads/${yearly[1]}-:year.csv`, kind: "download" };
    if (/^mirror\/[A-Za-z0-9._-]+$/.test(file)) return { route: "/downloads/mirror/:file", kind: "download" };
    return { route: "/downloads/other", kind: "download" };
  }
  if (FEED_PATH.test(path)) return { route: "/data/feeds/:file", kind: "feed" };
  if (path === "/data/feeds/index.json") return { route: path, kind: "file" };
  const radar = /^\/data\/expiring\/(6m|12m)\/[^/]+$/.exec(path);
  if (radar) return { route: `/data/expiring/${radar[1]}/:file`, kind: "file" };
  // The timers' stamps (src/refresh.tsx), which a page asks for while a run is under way.
  if (path === "/robots.txt" || path === "/llms.txt" || path === "/refresh.json") return { route: path, kind: "file" };
  if (/^\/sitemap(?:-[0-9]+|-guides)?\.xml$/.test(path)) return { route: "/sitemap.xml", kind: "file" };
  // The published contracts' parts (src/sitemaps.ts contractSitemap), apart from the others: their own crawl.
  if (/^\/sitemap-contracts-[0-9]+\.xml$/.test(path)) return { route: "/sitemap-contracts-:n.xml", kind: "file" };
  // One guide at its own address, so the views say which guides are read; any other path under it is one template.
  const guide = /^\/guides\/([^/]+)$/.exec(path);
  if (guide) return { route: GUIDE_SLUGS.has(guide[1]) ? path : "/guides/:slug", kind: "page" };
  // The standing offers and supply arrangements (pages/instruments.tsx): the numbers folded into the template.
  if (path === "/instruments") return { route: path, kind: "page" };
  if (path === "/instruments/rows.csv") return { route: path, kind: "download" };
  if (/^\/instruments\/.+\/holders\.csv$/.test(path)) return { route: "/instruments/:agreement/holders.csv", kind: "download" };
  if (/^\/instruments\/.+$/.test(path)) return { route: "/instruments/:agreement", kind: "page" };
  return { route: "other", kind: "other" };
}

// The host name of an http(s) referrer, lower case, and nothing else: no
// path, no query, no port. Anything else is "".
export function referrerHost(header: string | undefined | null): string {
  if (!header) return "";
  try {
    const url = new URL(header);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const host = url.hostname.toLowerCase();
    return /^[a-z0-9.-]{1,100}$/.test(host) ? host : "";
  } catch {
    return "";
  }
}

export function countryCode(value: unknown): string {
  return typeof value === "string" && /^[A-Z0-9]{2}$/.test(value) ? value : "";
}

// Readers that poll a feed for many people say how many in their user agent:
// "Feedly/1.0 (+https://feedly.com/poller.html; 12 subscribers; like
// FeedFetcher-Google)", "inoreader.com; 9 subscribers". Only the number before
// the word is read; 0 when there is none. The cap keeps a forged header from
// writing an absurd figure.
export function subscriberCount(userAgent: string | undefined | null): number {
  if (!userAgent) return 0;
  const m = /(?:^|[^0-9])([0-9]{1,9})\s+subscribers?\b/i.exec(userAgent.slice(0, 512));
  return m ? Number(m[1]) : 0;
}

// The feed's path under /data/, kept only when the file was served (200, or
// 304 to a reader that already has it): the file names are the pipeline's,
// while a path that found no file could hold whatever was typed.
export function feedFile(path: string, status: number): string {
  if (status !== 200 && status !== 304) return "";
  const m = FEED_PATH.exec(path);
  return m && m[1].length <= 120 ? m[1] : "";
}

export type Agent = "bot" | "human";
// The class a data point records (blob8): a bot or a person as agentClass
// says, or one of the two classes below for a request agentClass would call
// a person. Neither of those is counted as a person or as a bot.
export type Audience = Agent | "hosted" | "closed";
export type Device = "desktop" | "mobile" | "tablet" | "";

// Words that crawlers, link previews, monitors and scripts put in their user
// agents. "bot" is not matched inside "Cubot", a phone maker whose model names
// appear in ordinary Android user agents. "awardwatch" is the site's
// own client (the nightly smoke test and key check).
const BOT_UA = new RegExp(
  [
    "(?<!cu)bot", "crawl", "spider", "slurp", "fetch", "python-requests", "curl", "wget", "headless", "awardwatch",
    "http-client", "okhttp", "axios", "libwww", "scrapy", "httpx", "aiohttp", "java/", "facebookexternalhit",
    "embedly", "whatsapp", "preview", "lighthouse", "pingdom", "uptime", "monitor", "archiver", "validator",
    "googleother", "google-", "feed", "rss", "phantomjs", "selenium", "puppeteer", "playwright",
  ].join("|"),
  "i",
);
// Every browser in use names itself "Mozilla/5.0 (...)" (old Opera: "Opera/9.80"),
// so an agent that does not is a program: Go-http-client, Dart, PostmanRuntime.
const BROWSER_UA = /^(?:Mozilla|Opera)\//;

// Fetch Metadata: every current browser sends these three headers with a
// navigation and with its pages' own requests (over HTTPS, which the zone
// enforces). A plain HTTP client sends none of them, even when it borrows a
// browser's user agent. Browsers from before them (Chrome before 76, Firefox
// before 90, Safari before 16.4) send none either, so the few still in use
// are undercounted as people.
const FETCH_METADATA = ["sec-fetch-mode", "sec-fetch-dest", "sec-fetch-site"];

export function hasFetchMetadata(headers: Headers): boolean {
  return FETCH_METADATA.some((name) => headers.has(name));
}

// "bot" when Cloudflare's edge names the request a verified bot (any
// category: search engine, monitoring, feed fetcher and so on), when the
// user agent is missing, is not shaped like a browser's or carries one of the
// words above, when a browser-shaped agent comes with no Fetch Metadata
// header, and for every feed poll (a program by nature).
// Everything else is "human": a person's browser, or a crawler that copies
// a browser's headers too, which no header can tell apart. fetchMetadata says
// whether the request carried any of the three headers; it defaults to true
// so a test of the user agent alone reads it as a browser would send it.
export function agentClass(
  userAgent: string | undefined | null, verifiedBotCategory: unknown, kind?: Kind, fetchMetadata = true,
): Agent {
  if (kind === "feed") return "bot";
  if (typeof verifiedBotCategory === "string" && verifiedBotCategory.trim() !== "") return "bot";
  const ua = (userAgent ?? "").slice(0, 512);
  if (!ua.trim() || !BROWSER_UA.test(ua) || BOT_UA.test(ua)) return "bot";
  if (!fetchMetadata) return "bot";
  return "human";
}

// The version of the rule that sets blob8, written on every point as blob12.
// "2" (since 2026-11-19) adds "hosted" and "closed" to "bot" and "human"; a
// point without it was written under the first rule, which counted both as
// people. The roll-up fills its counts of the two classes only for a day on
// which every page view carries this version (views_rollup.AGENT_RULE, a
// pipeline test holds the two equal).
export const AGENT_RULE = "2";

// "hosted": a request agentClass would call a person that comes from one of
// the largest hosting and cloud networks, named by the autonomous system
// number Cloudflare's edge gives it (request.cf.asn). People browse from
// home, office and mobile networks; programs run in data centres. A person
// behind a company's cloud desktop or proxy is counted here as well, so the
// class stands apart from both "human" and "bot". The number is read and
// dropped: the point keeps the class alone.
//
// Holders as registered with ARIN, RIPE NCC and APNIC (whois), listed on
// HOSTED_ASNS_LISTED. Left out on purpose, because they carry people's own
// browsing through a relay or a VPN: Cloudflare 13335 (the WARP app), Akamai
// 20940 and 36183 and Fastly 54113 (Apple's iCloud Private Relay), M247 9009
// and Datacamp 60068 (commercial VPNs).
export const HOSTED_ASNS_LISTED = "2026-11-19";
export const HOSTED_ASNS: ReadonlyMap<number, string> = new Map([
  [16509, "Amazon Web Services"],
  [14618, "Amazon Web Services"],
  [8075, "Microsoft (Azure)"],
  [15169, "Google"],
  [396982, "Google Cloud"],
  [31898, "Oracle Cloud"],
  [45102, "Alibaba Cloud"],
  [37963, "Alibaba Cloud (China)"],
  [132203, "Tencent Cloud"],
  [45090, "Tencent (China)"],
  [136907, "Huawei Cloud"],
  [55990, "Huawei Cloud (China)"],
  [14061, "DigitalOcean"],
  [63949, "Akamai Connected Cloud (Linode)"],
  [20473, "Vultr"],
  [16276, "OVH"],
  [24940, "Hetzner"],
  [51167, "Contabo"],
  [12876, "Scaleway"],
  [21859, "Zenlayer"],
]);

export function isHostedNetwork(asn: unknown): boolean {
  return typeof asn === "number" && HOSTED_ASNS.has(asn);
}

// "closed": a GET or HEAD of the response form, /organizations/:id/respond,
// a page robots.txt closes to every crawler and that only its organization's
// page links to, from anywhere but that page (or the form itself, which its
// language link opens again). A person reaches the form by that link, and
// the browser names the page in Referer (the site's policy keeps the path on
// its own pages); a crawler that ignores robots.txt asks for the form
// directly. A browser or an extension that drops Referer on the site's own
// pages counts here too, which is rare.
const RESPOND_PATH = /^\/organizations\/([^/]+)\/respond$/;

export function opensClosedPage(method: string, path: string, referer: string | null | undefined, requestUrl: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const m = RESPOND_PATH.exec(path);
  if (!m) return false;
  if (!referer || !isOwnAddress(referer, requestUrl)) return true;
  let from: string;
  try {
    from = new URL(referer).pathname;
  } catch {
    return true;
  }
  return from !== `/organizations/${m[1]}` && from !== path;
}

export type EdgeProps = { country?: unknown; verifiedBotCategory?: unknown; asn?: unknown };

// The class of one request: agentClass first, so every bot stays a bot; then,
// for what it calls a person, "hosted" before "closed", so the closed count
// is the form's requests that the network list does not catch.
export function audienceClass(
  cf: EdgeProps | undefined, kind: Kind, method: string, path: string, headers: Headers, requestUrl: string,
): Audience {
  const agent = agentClass(headers.get("user-agent"), cf?.verifiedBotCategory, kind, hasFetchMetadata(headers));
  if (agent !== "human") return agent;
  if (isHostedNetwork(cf?.asn)) return "hosted";
  return opensClosedPage(method, path, headers.get("referer"), requestUrl) ? "closed" : "human";
}

// The device class a user agent states. iPadOS asks for desktop pages and
// says "Macintosh", so most iPads count as desktop; Chromium's client hint
// Sec-CH-UA-Mobile ("?1") marks a phone that asked for the desktop site.
export function deviceClass(userAgent: string | undefined | null, mobileHint?: string | null): Device {
  const ua = (userAgent ?? "").slice(0, 512);
  if (!ua.trim()) return "";
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (/Mobi|iPhone|iPod|Windows Phone|BlackBerry|BB10|Opera Mini/i.test(ua) || mobileHint?.trim() === "?1") return "mobile";
  return "desktop";
}

// The UTC date a request belongs to, as YYYY-MM-DD. Inside a request the
// Worker's clock stands at the request's start.
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const encoder = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// One salt per UTC day per isolate: HMAC-SHA-256 of the date under the secret.
let saltCache: { day: string; secret: string; salt: string } | null = null;

export async function dailySalt(secret: string, day: string): Promise<string> {
  if (saltCache && saltCache.day === day && saltCache.secret === secret) return saltCache.salt;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const salt = hex(await crypto.subtle.sign("HMAC", key, encoder.encode(day)));
  saltCache = { day, secret, salt };
  return salt;
}

// The visitor code: SHA-256 of salt, address and user agent (newline
// separated, so no two different inputs run together into the same text),
// cut to 16 hex characters. "" without a secret: then no uniques are counted.
export async function visitorHash(secret: string | undefined | null, day: string, ip: string, userAgent: string): Promise<string> {
  if (!secret) return "";
  const salt = await dailySalt(secret, day);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${salt}\n${ip}\n${userAgent}`));
  return hex(digest).slice(0, 16);
}

function edge(c: Context<AppEnv>): EdgeProps | undefined {
  return (c.req.raw as Request & { cf?: EdgeProps }).cf;
}

type Classed = { route: string; kind: Kind; audience: Audience };

function classify(c: Context<AppEnv>): Classed {
  const { route, kind } = routeTemplate(c.req.method, c.req.path);
  return { route, kind, audience: audienceClass(edge(c), kind, c.req.method, c.req.path, c.req.raw.headers, c.req.url) };
}

export function requestClass(c: Context<AppEnv>): Audience {
  return classify(c).audience;
}

// The data point for the response in c. visitor is the visitor code, written
// for a person's request only.
export function viewPoint(c: Context<AppEnv>, visitor = "", known?: Classed): AnalyticsEngineDataPoint {
  const { route, kind, audience } = known ?? classify(c);
  const cf = edge(c);
  const lang = c.get("lang") === "fr" ? "fr" : "en";
  const ua = c.req.header("user-agent");
  const blobs = [
    route, kind, lang, countryCode(cf?.country), referrerHost(c.req.header("referer")), c.req.method.slice(0, 8),
    kind === "feed" ? feedFile(c.req.path, c.res.status) : "",
    // The device is read from a browser-shaped agent, so a bot leaves it empty; the visitor code is a person's alone.
    audience, audience === "bot" ? "" : deviceClass(ua, c.req.header("sec-ch-ua-mobile")),
    audience === "human" && /^[0-9a-f]{16}$/.test(visitor) ? visitor : "",
    // The verified-bot category the edge gave the request ("Search Engine Crawler", "AI Search"), empty when it
    // gave none: which kind of crawler a bot's request was. It names a crawler's kind, never a person's anything.
    typeof cf?.verifiedBotCategory === "string" ? cf.verifiedBotCategory.trim().slice(0, 40) : "",
    AGENT_RULE,
  ];
  const doubles = [c.res.status];
  // double2 for a feed only; every other point leaves it empty (read back as 0).
  if (kind === "feed") doubles.push(subscriberCount(ua));
  return { indexes: [route], blobs, doubles };
}

export async function recordView(c: Context<AppEnv>): Promise<void> {
  const dataset = c.env.VIEWS;
  if (!dataset) return; // tests and local development have no binding
  try {
    const known = classify(c);
    let visitor = "";
    if (known.audience === "human") {
      try {
        visitor = await visitorHash(c.env.VIEWS_SALT_KEY, utcDay(), c.req.header("cf-connecting-ip") ?? "", c.req.header("user-agent") ?? "");
      } catch (e) {
        // The point is still written, with no code; that day's uniques read blank.
        console.error(`views: no visitor code: ${String(e).slice(0, 200)}`);
      }
    }
    dataset.writeDataPoint(viewPoint(c, visitor, known));
  } catch (e) {
    // A counting fault must never cost a reader the page.
    console.error(`views: ${String(e).slice(0, 200)}`);
  }
}

export async function measure(c: Context<AppEnv>, next: Next): Promise<void> {
  try {
    await next();
  } finally {
    await recordView(c);
  }
}
