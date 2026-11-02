import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { secureHeaders } from "hono/secure-headers";
import { api } from "./api";
import { conditional } from "./conditional";
import { YEAR_RE, loadStats } from "./data";
import type { AppEnv, Env } from "./env";
import { kofiWebhook } from "./hooks";
import { throttle } from "./limits";
import { measure } from "./views";
import { runWatchdog } from "./watchdog";
import { langFrom, t, tj } from "./i18n";
import { Layout, PageHead, page } from "./layout";
import { awardsPage, awardsYearPage } from "./pages/awards";
import { buyerPage, buyersIndex } from "./pages/buyers";
import { segmentPage, segmentsIndex } from "./pages/segments";
import { citePage } from "./pages/cite";
import { aboutPage, privacyPage, termsPage } from "./pages/docs";
import { contractPage } from "./pages/contract";
import { DOWNLOADS, YEARLY_DOWNLOAD, dataPage } from "./pages/data";
import { directoryPage, organizationsIndex } from "./pages/directory";
import { expiringPage, expiringWindowPage } from "./pages/expiring";
import { feedsPage } from "./pages/feeds";
import { correctionsForm, correctionsSubmit, respondPage, respondSubmit } from "./pages/forms";
import { homePage } from "./pages/home";
import { methodologyPage } from "./pages/methodology";
import { organizationPage } from "./pages/organization";
import { rankingsPage } from "./pages/rankings";
import { supportPage } from "./pages/support";
import { tenderPage } from "./pages/tender";
import { newTendersPage, tendersPage } from "./pages/tenders";
import { watchlistPage } from "./pages/watchlist";
import { llmsTxt, robotsTxt, sitemapFile } from "./seo";

const app = new Hono<AppEnv>();

// A permanent move to another path on the site, with the query string kept.
function movedTo(c: Context<AppEnv>, path: string): Response {
  c.header("Cache-Control", "public, max-age=300");
  return c.redirect(`${path}${new URL(c.req.url).search}`, 301);
}

// The pages load nothing from third parties, and the policy says exactly that.
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
    crossOriginResourcePolicy: false,
  }),
);

app.use("*", async (c, next) => {
  const q = c.req.query("lang");
  const lang = langFrom(q, getCookie(c, "lang"));
  if (q === "fr" || q === "en") {
    setCookie(c, "lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "Lax" });
  }
  c.set("lang", lang);
  await next();
});

// After the language middleware so a 429 page still knows its language later.
app.use("*", throttle);
app.use("*", measure);
// Inside measure, so a page answered 304 is counted with that status.
app.use("*", conditional);

app.route("/api", api);

app.get("/", homePage);
// The open notices, filtered in the browser after the first view; the
// notices first seen each day; one notice. /tenders/new is registered
// before /tenders/:reference, which would read "new" as a reference.
app.get("/tenders", tendersPage);
app.get("/tenders/new", newTendersPage);
app.get("/tenders/:reference", tenderPage);
// /awards/2026 is a year; anything else after /awards/ is a reference.
app.get("/awards", awardsPage);
app.get("/awards/:key", (c) => {
  const key = c.req.param("key") ?? "";
  return YEAR_RE.test(key) ? awardsYearPage(c, key) : contractPage(c, "award", key);
});
app.get("/history/:reference", (c) => contractPage(c, "history", c.req.param("reference") ?? ""));
// Contracts ending within 3, 6 and 12 months of the data date; anything
// after /expiring/ that is not a window is a 404.
app.get("/expiring", expiringPage);
app.get("/expiring/:window", (c) => expiringWindowPage(c, c.req.param("window") ?? ""));
// The directory's routes come before the profile's, which would read
// "directory" as an id.
app.get("/organizations", organizationsIndex);
app.get("/organizations/directory", (c) => c.redirect("/organizations", 301));
app.get("/organizations/directory/:code", directoryPage);
app.get("/organizations/directory/:code/:page", directoryPage);
app.get("/organizations/:id", organizationPage);
// A browser only: a plain HTTP client gets a 403 naming the profile (forms.tsx).
app.get("/organizations/:id/respond", respondPage);
app.post("/organizations/:id/respond", respondSubmit);
app.get("/buyers", buyersIndex);
app.get("/buyers/:id", buyerPage);
app.get("/segments", segmentsIndex);
app.get("/segments/:nn", segmentPage);
// The UNSPSC segment pages were /categories until "category" was kept for
// the CanadaBuys field alone; old links move for good, the query kept.
app.get("/categories", (c) => movedTo(c, "/segments"));
app.get("/categories/:nn", (c) => movedTo(c, `/segments/${encodeURIComponent(c.req.param("nn") ?? "")}`));
app.get("/rankings", rankingsPage);
app.get("/rankings/:year", rankingsPage);
// Feeds are static files under /data/feeds/; this page lists them. The
// watchlist lives in the visitor's browser; this page is its shell.
app.get("/feeds", feedsPage);
app.get("/watchlist", watchlistPage);
app.get("/data", dataPage);
app.get("/methodology", methodologyPage);
app.get("/support", supportPage);
app.get("/cite", citePage);
app.get("/about", aboutPage);
app.get("/terms", termsPage);
app.get("/privacy", privacyPage);
app.get("/corrections", (c) => correctionsForm(c));
app.post("/corrections", correctionsSubmit);
// Payment notices from a donation page, once there is one; see hooks.ts for what is kept.
app.post("/hooks/kofi", kofiWebhook);
app.get("/robots.txt", robotsTxt);
app.get("/llms.txt", llmsTxt);
app.get("/:file{sitemap(?:-[0-9]+)?\\.xml}", sitemapFile);

// The Atom feeds (feeds.py) are static files, but wrangler.jsonc runs the
// Worker first for /data/feeds/* so the measure middleware counts each poll
// and the subscriber count a reader states (views.ts). The file comes from
// the assets binding as it would have been served, the reader's conditional
// headers included so a reader that has the file still gets a 304, with a
// short cache added. A path with no file gets the site's 404 page, as it did
// when such a request fell through to the Worker.
const FEED_CACHE = "public, max-age=300";
app.get("/data/feeds/*", async (c) => {
  if (!c.env.ASSETS) return c.notFound();
  let res: Response;
  try {
    res = await c.env.ASSETS.fetch(c.req.raw);
  } catch (e) {
    console.error(`feed ${c.req.path}: ${String(e).slice(0, 200)}`);
    c.header("Retry-After", "300");
    c.header("Cache-Control", "no-store");
    return c.body(null, 503);
  }
  if (res.status === 404) return c.notFound();
  // The binding's headers cannot be changed in place, and the middleware
  // above adds its own after this returns.
  const headers = new Headers(res.headers);
  if (res.status === 200 || res.status === 304) headers.set("Cache-Control", FEED_CACHE);
  return new Response(res.body, { status: res.status, headers });
});

// The CSV files in R2: a name on the Data page's list, a yearly file, or a
// mirror file; nothing else is ever read from the bucket.
export function downloadAllowed(file: string): boolean {
  return DOWNLOADS.some((d) => d.file === file) || YEARLY_DOWNLOAD.test(file) || /^mirror\/[A-Za-z0-9._-]+$/.test(file);
}

app.get("/downloads/:file{.+}", async (c) => {
  const file = c.req.param("file");
  let object: R2ObjectBody | null = null;
  let unavailable = false;
  if (downloadAllowed(file) && c.env.DATA) {
    try {
      object = await c.env.DATA.get(file.startsWith("mirror/") ? file : `downloads/${file}`);
    } catch (e) {
      // Storage outage: the same page as a missing file, with a status that says try later.
      console.error(`download ${file}: ${String(e).slice(0, 200)}`);
      unavailable = true;
    }
  }
  if (!object) {
    const stats = await loadStats(c.env);
    const lang = c.get("lang");
    return page(
      c,
      <Layout lang={lang} title={t(lang, "error.file")} dataAsOf={stats?.data_as_of ?? null}>
        <PageHead lang={lang} title={t(lang, "error.file")} lead={tj(lang, "error.file_text", { file: <span class="mono">{file}</span> })}
          actions={<a href="/data#downloads" class="btn">{t(lang, "error.file_back")}</a>} />
      </Layout>,
      unavailable ? 503 : 404,
    );
  }
  const headers = new Headers();
  headers.set("Content-Type", file.endsWith(".csv") ? "text/csv; charset=utf-8" : file === "SHA256SUMS" ? "text/plain; charset=utf-8" : "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${file.split("/").pop()}"`);
  headers.set("Cache-Control", "public, max-age=3600");
  return new Response(object.body, { headers });
});

app.notFound(async (c) => {
  // Sub-app not-found handlers are not consulted, so the API's JSON 404 lives here.
  if (new URL(c.req.url).pathname.startsWith("/api/")) {
    return c.json({ error: "not found" }, 404);
  }
  const stats = await loadStats(c.env).catch(() => null);
  const lang = c.get("lang") ?? "en";
  return page(
    c,
    <Layout lang={lang} title={t(lang, "error.not_found")} dataAsOf={stats?.data_as_of ?? null}>
      <PageHead lang={lang} title={t(lang, "error.not_found")}
        lead={tj(lang, "error.not_found_text", {
          home: <a href="/">{t(lang, "error.not_found_home")}</a>,
          directory: <a href="/organizations">{t(lang, "error.not_found_directory")}</a>,
        })} />
    </Layout>,
    404,
  );
});

app.onError((err, c) => {
  console.error(err);
  c.header("Cache-Control", "no-store");
  const lang = c.get("lang") ?? "en";
  return c.html(
    html`<!doctype html>${(
      <Layout lang={lang} title={t(lang, "error.server")} dataAsOf={null}>
        <PageHead lang={lang} title={t(lang, "error.server")} lead={t(lang, "error.server_text")} />
      </Layout>
    ) as any}`,
    500,
  );
});

export { app };

export default {
  fetch: app.fetch,
  // The cron trigger from wrangler.jsonc: the daily check.
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runWatchdog(env));
  },
};
