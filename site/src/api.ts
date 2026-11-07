import { Hono, type Context } from "hono";
import { BUYER_ID_RE, SEGMENT_RE, assetResponse, loadAlias, loadBuyerAlias, loadProfile, loadTender, tenderAttachments } from "./data";
import { SEGMENTS } from "./constants";
import type { AppEnv } from "./env";
import { SITE_ORIGIN } from "./seo";

// Every endpoint is a view over the static JSON files and costs no database
// reads. A whole file passes through with its body as is; a shard answers
// with the one entry asked for, read with the same shard logic as the pages.
// The data changes once a night, so responses may be cached for five
// minutes, unless a handler says otherwise.
export const api = new Hono<AppEnv>();

api.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "public, max-age=300");
});

export async function passThrough(c: Context<AppEnv>, path: string, missing: 404 | 503 = 503): Promise<Response> {
  const res = await assetResponse(c.env, path);
  if (!res) return c.json({ error: missing === 503 ? "not published yet" : "not found" }, missing);
  return new Response(res.body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

api.get("/stats", (c) => passThrough(c, "stats.json"));

// A retired id redirects to the id that took its records, as the profile page does.
api.get("/organizations/:id", async (c) => {
  const id = c.req.param("id") ?? "";
  const profile = await loadProfile(c.env, id);
  if (profile) return c.json(profile);
  const live = await loadAlias(c.env, id);
  if (live) return c.redirect(`/api/organizations/${live}`, 301);
  return c.json({ error: "not found" }, 404);
});

// The government contact on a notice is never exported; should a file carry
// it anyway, the API leaves it out as the page does.
export function withoutContacts<T extends object>(record: T): Partial<T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => !k.startsWith("contact"))) as Partial<T>;
}

// References match in any case, as on the notice pages. The documents are
// the ones the page links, each checked the same way (data.tenderAttachments).
api.get("/tenders/:reference", async (c) => {
  const tender = await loadTender(c.env, c.req.param("reference") ?? "");
  if (!tender) return c.json({ error: "not found" }, 404);
  const out: Record<string, unknown> = withoutContacts(tender);
  if ("attachments" in tender) out.attachments = tenderAttachments(tender);
  return c.json(out);
});

// A buyer id the pipeline retired (merged into another: a former name, a
// second spelling, a CKAN organization listed twice) redirects to the id that
// took its records, as the buyer page does (buyers/aliases.json).
api.get("/buyers/:id", async (c) => {
  const id = c.req.param("id") ?? "";
  if (!BUYER_ID_RE.test(id) || id.length > 80) return c.json({ error: "not found" }, 404);
  const res = await assetResponse(c.env, `buyers/${id}.json`);
  if (res) return new Response(res.body, { status: 200, headers: { "Content-Type": "application/json; charset=utf-8" } });
  const live = await loadBuyerAlias(c.env, id);
  if (live) return c.redirect(`/api/buyers/${live}`, 301);
  return c.json({ error: "not found" }, 404);
});

api.get("/categories/:nn", (c) => {
  const nn = c.req.param("nn") ?? "";
  if (!SEGMENT_RE.test(nn) || !(nn in SEGMENTS)) return c.json({ error: "not found" }, 404);
  return passThrough(c, `categories/${nn}.json`, 404);
});

const SITE_HOST = new URL(SITE_ORIGIN).host;

// Whether an Origin or Referer value is an http(s) address on the site: its
// host, the www form, or the request's own host, so a local or preview run of
// the site counts its own pages too.
export function isOwnAddress(value: string | null | undefined, requestUrl: string): boolean {
  if (!value) return false;
  const own = new Set([SITE_HOST, `www.${SITE_HOST}`]);
  try {
    own.add(new URL(requestUrl).host);
  } catch {
    // An unreadable request URL adds nothing.
  }
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && own.has(url.host);
  } catch {
    // Not a URL: not the site's page.
    return false;
  }
}

// A browser says where a request comes from in Sec-Fetch-Site; one too old to
// send it still sends the page's address as Referer (the site's policy is
// strict-origin-when-cross-origin, which keeps the full address on its own
// pages), or Origin. Any client can forge these headers, so this only keeps
// casual reuse off a route; the per-address API limit (src/limits.ts) stays
// the brake. The hosted search route of the next slice uses it.
export function fromOwnPage(headers: Headers, requestUrl: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin" || site === "same-site";
  return ["origin", "referer"].some((name) => isOwnAddress(headers.get(name), requestUrl));
}

// The refusal for anything but the site's own page, or null to go on. It
// varies on the headers checked and no shared cache may keep it, so a refusal
// can never be served to the page's own request.
export function pageOnly(c: Context<AppEnv>): Response | null {
  if (fromOwnPage(c.req.raw.headers, c.req.url)) return null;
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Sec-Fetch-Site, Origin, Referer");
  return c.json({ error: "this route answers the site's own pages only" }, 403);
}
