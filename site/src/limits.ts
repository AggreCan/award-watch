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
// pages' and the sign-in's. The payment service's webhook gets "hook" on the
// same terms: its posts come from the service's few addresses, which retry
// after a 429, and anything else posting there is refused at the signature.
// The bug report post of a Pro account (/account/bug) writes a row and sends
// a message, so it counts with the forms, on the same terms; so do the two
// billing posts (checkout and portal), each of which opens a session with
// the payment service, which no reader does five times a minute. The CSV
// files of the analytics views are downloads: each reads the records
// database, so a script asking for every table of every buyer meets the
// download cap rather than the pages'.
export type Bucket = "page" | "api" | "download" | "form" | "feed" | "auth" | "stop" | "hook";

// A table of an analytics view as CSV (pages/analytics.tsx, analyticsCsv).
export const ANALYTICS_CSV = /^\/(?:buyers|organizations|segments)\/[^/]+\/analytics\/[a-z]+\.csv$/;

// A HEAD request for a download (a link checker, a client asking a file's
// size before fetching it) moves no file, so it is not counted against the
// download cap; it is counted with the pages.
export function bucketFor(method: string, path: string): Bucket {
  if (path.startsWith("/data/feeds/")) return "feed";
  if (path.startsWith("/api/")) return "api";
  if (path.startsWith("/downloads/")) return method === "HEAD" ? "page" : "download";
  if (ANALYTICS_CSV.test(path)) return method === "HEAD" ? "page" : "download";
  if (method === "POST" && (path === "/account/sign-in" || path === "/account/check")) return "auth";
  if (path === "/account/stop") return "stop";
  if (method === "POST" && path === "/account/billing/webhook") return "hook";
  if (method === "POST" && (path === "/account/bug" || path === "/account/billing/checkout" || path === "/account/billing/portal")) return "form";
  if (method === "POST" && (path === "/corrections" || path === "/interest" || /^\/organizations\/[^/]+\/respond$/.test(path))) {
    return "form";
  }
  return "page";
}

const BINDING: Record<Bucket, keyof Env> = {
  page: "PAGE_LIMIT", api: "API_LIMIT", download: "DOWNLOAD_LIMIT", form: "FORM_LIMIT", feed: "FEED_LIMIT", auth: "AUTH_LIMIT",
  stop: "STOP_LIMIT", hook: "WEBHOOK_LIMIT",
};

// The address Cloudflare saw. The edge sets this header itself and drops any
// copy a client sends, so it cannot be spoofed from outside.
export function clientKey(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

export async function throttle(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  let bucket = bucketFor(c.req.method, c.req.path);
  const accountsOnly = bucket === "auth" || bucket === "stop" || bucket === "hook" || (bucket === "form" && c.req.path.startsWith("/account/"));
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
