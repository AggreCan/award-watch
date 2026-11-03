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
// they are unknown paths and count as pages, as they did before.
export type Bucket = "page" | "api" | "download" | "form" | "feed" | "auth";

// A HEAD request for a download (a link checker, a client asking a file's
// size before fetching it) moves no file, so it is not counted against the
// download cap; it is counted with the pages.
export function bucketFor(method: string, path: string): Bucket {
  if (path.startsWith("/data/feeds/")) return "feed";
  if (path.startsWith("/api/")) return "api";
  if (path.startsWith("/downloads/")) return method === "HEAD" ? "page" : "download";
  if (method === "POST" && (path === "/account/sign-in" || path === "/account/check")) return "auth";
  if (method === "POST" && (path === "/corrections" || path === "/interest" || /^\/organizations\/[^/]+\/respond$/.test(path))) {
    return "form";
  }
  return "page";
}

const BINDING: Record<Bucket, keyof Env> = {
  page: "PAGE_LIMIT", api: "API_LIMIT", download: "DOWNLOAD_LIMIT", form: "FORM_LIMIT", feed: "FEED_LIMIT", auth: "AUTH_LIMIT",
};

// The address Cloudflare saw. The edge sets this header itself and drops any
// copy a client sends, so it cannot be spoofed from outside.
export function clientKey(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

export async function throttle(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  let bucket = bucketFor(c.req.method, c.req.path);
  if (bucket === "auth" && !accountsEnabled(c.env)) bucket = "page";
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
