import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { secureHeaders } from "hono/secure-headers";
import { api } from "./api";
import { keyedApi } from "./api_keyed";
import { conditional } from "./conditional";
import { YEAR_RE, loadStats } from "./data";
import type { AppEnv, Env } from "./env";
import { throttle } from "./limits";
import { measure } from "./views";
import { DEEP_WINDOWS, radarWindowLocked } from "./plan";
import { accountsEnabled } from "./account/switch";
import { runWatchdog } from "./watchdog";
import { langFrom, t, tj } from "./i18n";
import { Layout, PageHead, page } from "./layout";
import { analyticsCsv, buyerAnalytics, organizationAnalytics, segmentAnalytics } from "./pages/analytics";
import { awardsPage, awardsYearPage, erroneousAwardsPage } from "./pages/awards";
import { buyerPage, buyersIndex } from "./pages/buyers";
import { segmentPage, segmentsIndex } from "./pages/segments";
import { citePage } from "./pages/cite";
import { alertsPage, listsSubmit } from "./pages/alerts";
import { aboutPage, privacyPage, termsPage } from "./pages/docs";
import { contractPage } from "./pages/contract";
import { DOWNLOADS, YEARLY_DOWNLOAD, dataPage } from "./pages/data";
import { directoryPage, organizationsIndex } from "./pages/directory";
import { EXPIRING_CSV, expiringFile, expiringPage, expiringRowsCsv, expiringWindowPage } from "./pages/expiring";
import { feedsPage } from "./pages/feeds";
import { correctionsForm, correctionsSubmit, respondPage, respondSubmit } from "./pages/forms";
import { homePage } from "./pages/home";
import { contractIcs, publishedContractIcs, tenderIcs } from "./pages/ics";
import { interestSubmit, readInterestPost } from "./pages/interest";
import { methodologyPage } from "./pages/methodology";
import { organizationPage } from "./pages/organization";
import { publishedContractPage } from "./pages/published";
import { orgFeed } from "./pages/backbone";
import { buyerRecords, buyerRecordsCsv, organizationRecords, organizationRecordsCsv } from "./pages/records";
import { rankingsPage } from "./pages/rankings";
import { sameDayPage } from "./pages/same_day";
import { searchPage } from "./pages/search";
import { tenderPage } from "./pages/tender";
import { newTendersPage, tendersPage } from "./pages/tenders";
import { watchlistPage } from "./pages/watchlist";
import { llmsTxt, robotsTxt } from "./seo";
import { refreshStampsRoute } from "./refresh";
import { contractSitemap, sitemapFile } from "./sitemaps";
import { proPage } from "./pages/pro";
import { instrumentRoute, instrumentsCsv, instrumentsIndex } from "./pages/instruments";
import { SAMPLE_PATH, briefingSamplePage } from "./account/briefing_pages";
import { account } from "./account/routes";
import { admin } from "./account/admin";
import { interestStopPage, interestStopPost } from "./account/announce";
import { DELIVERY_CRON, runDeliveries } from "./account/deliveries";
import { billingFormAction } from "./account/stripe";

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
      // 'self' on every page; the billing pages add Stripe's checkout and
      // portal hosts while payments are set up, since a browser applies
      // form-action to the redirect after a form post (account/stripe.ts).
      formAction: [billingFormAction],
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
// The keyed API (src/api_keyed.ts): after /api, whose middleware gives its
// 404 the open API's headers while the accounts switch is off.
app.route("/api/v1", keyedApi);
// Accounts (src/account/routes.tsx): every route is the site's 404 while
// ACCOUNTS_ENABLED is not "true".
app.route("/account", account);
app.route("/admin", admin);

app.get("/", homePage);
// The open notices, filtered in the browser after the first view; the
// notices first seen each day; one notice. /tenders/new is registered
// before /tenders/:reference, which would read "new" as a reference.
app.get("/tenders", tendersPage);
app.get("/tenders/new", newTendersPage);
app.get("/tenders/same-day", sameDayPage);
// The one-event calendar files (pages/ics.ts), public whatever the accounts
// switch says; each before the page route that would read "<reference>.ics"
// as a reference.
app.get("/tenders/:file{[A-Za-z0-9._-]+\\.ics}", tenderIcs);
app.get("/tenders/:reference", tenderPage);
// /awards/2026 is a year; anything else after /awards/ is a reference.
// /awards/erroneous is registered before /awards/:key, which would read it as one.
app.get("/awards", awardsPage);
app.get("/awards/erroneous", erroneousAwardsPage);
app.get("/awards/:file{[A-Za-z0-9._-]+\\.ics}", (c) => contractIcs(c, "award"));
app.get("/awards/:key", (c) => {
  const key = c.req.param("key") ?? "";
  return YEAR_RE.test(key) ? awardsYearPage(c, key) : contractPage(c, "award", key);
});
app.get("/history/:file{[A-Za-z0-9._-]+\\.ics}", (c) => contractIcs(c, "history"));
app.get("/history/:reference", (c) => contractPage(c, "history", c.req.param("reference") ?? ""));
// One published contract, from the records database (pages/published.tsx):
// the department, then the reference as published, which may hold an
// escaped slash, hence the pattern.
app.get("/contracts/:dept/:file{.+\\.ics}", publishedContractIcs);
app.get("/contracts/:dept/:reference{.+}", publishedContractPage);
// Contracts ending within 3, 6 and 12 months of the data date; anything
// after /expiring/ that is not a window is a 404.
app.get("/expiring", expiringPage);
app.get("/expiring/:window", (c) => expiringWindowPage(c, c.req.param("window") ?? ""));
// A filtered window's matches as CSV, from the records database: Pro's
// (export_filtered) once the accounts switch is on, the site's 404 otherwise.
app.get("/expiring/:window/rows.csv", expiringRowsCsv);
// The directory's routes come before the profile's, which would read
// "directory" as an id.
app.get("/organizations", organizationsIndex);
app.get("/organizations/directory", (c) => c.redirect("/organizations", 301));
app.get("/organizations/directory/:code", directoryPage);
app.get("/organizations/directory/:code/:page", directoryPage);
app.get("/organizations/:id", organizationPage);
// The record tables (pages/records.tsx, docs/analytics.md) and their CSV
// files, from the records database.
app.get("/organizations/:id/records", organizationRecords);
app.get("/organizations/:id/records.csv", organizationRecordsCsv);
app.get("/buyers/:id/records", buyerRecords);
app.get("/buyers/:id/records.csv", buyerRecordsCsv);
// The analytics views (pages/analytics.tsx, docs/analytics.md) and the CSV
// file of each of their tables: the site's 404 while the accounts switch is
// off; with it on, in full for Pro and the first chart for anyone else.
app.get("/organizations/:id/analytics", organizationAnalytics);
app.get("/organizations/:id/analytics/:table{[a-z]+\\.csv}", (c) => analyticsCsv(c, "organization"));
// A browser only: a plain HTTP client gets a 403 naming the profile (forms.tsx).
app.get("/organizations/:id/respond", respondPage);
app.post("/organizations/:id/respond", respondSubmit);
app.get("/buyers", buyersIndex);
app.get("/buyers/:id", buyerPage);
app.get("/buyers/:id/analytics", buyerAnalytics);
app.get("/buyers/:id/analytics/:table{[a-z]+\\.csv}", (c) => analyticsCsv(c, "buyer"));
app.get("/segments", segmentsIndex);
app.get("/segments/:nn", segmentPage);
app.get("/segments/:nn/analytics", segmentAnalytics);
app.get("/segments/:nn/analytics/:table{[a-z]+\\.csv}", (c) => analyticsCsv(c, "segment"));
// The UNSPSC segment pages were /categories until "category" was kept for
// the CanadaBuys field alone; old links move for good, the query kept.
app.get("/categories", (c) => movedTo(c, "/segments"));
app.get("/categories/:nn", (c) => movedTo(c, `/segments/${encodeURIComponent(c.req.param("nn") ?? "")}`));
app.get("/rankings", rankingsPage);
// Standing offers and supply arrangements (pages/instruments.tsx, docs/sosa.md):
// the list from its static index, its CSV (Pro), then one instrument from the
// records database, its number escaped as one path segment, and its holders'
// CSV (Pro) at <number>/holders.csv. rows.csv comes before the instrument,
// which would read it as a number.
app.get("/instruments", instrumentsIndex);
app.get("/instruments/rows.csv", instrumentsCsv);
app.get("/instruments/:agreement{.+}", instrumentRoute);
app.get("/rankings/:year", rankingsPage);
// Organizations and buyers by name, from the hosted search database (D1
// SEARCH); the top bar's field on every page submits here. A page for the
// rate limiter and the views like any other.
app.get("/search", searchPage);
// Feeds are static files under /data/feeds/; this page lists them. The
// watchlist lives in the visitor's browser; this page is its shell.
app.get("/feeds", feedsPage);
app.get("/watchlist", watchlistPage);
// Interest in email alerts: the Email lists page, and the post of both forms,
// read once: the page's chooser saves several lists at once (place=lists,
// pages/alerts.tsx), every other page's block saves its own filter
// (pages/interest.tsx). The post answers in place; an address typed or
// reloaded as a GET lands on the page.
app.get("/alerts", alertsPage);
app.post("/interest", async (c) => {
  const post = await readInterestPost(c);
  if (post instanceof Response) return post;
  return post.place === "lists" ? listsSubmit(c, post) : interestSubmit(c, post);
});
app.get("/interest", (c) => c.redirect("/alerts", 302));
// The link in the accounts-open message that takes an address off the email
// lists (account/announce.tsx): open whatever the accounts switch says.
app.get("/interest/stop", interestStopPage);
app.post("/interest/stop", interestStopPost);
// What the paid plan adds and costs (pages/pro.tsx): the site's 404 while the
// accounts switch is off, as /tenders/same-day is.
app.get("/pro", proPage);
// This week's weekly briefing for one segment, built live, the same for every
// reader (account/briefing_pages.tsx); the 404 while the switch is off.
app.get(SAMPLE_PATH, briefingSamplePage);
app.get("/data", dataPage);
app.get("/methodology", methodologyPage);
app.get("/cite", citePage);
app.get("/about", aboutPage);
app.get("/terms", termsPage);
app.get("/privacy", privacyPage);
app.get("/corrections", (c) => correctionsForm(c));
app.post("/corrections", correctionsSubmit);
// The data stamps the top bar's timers ask for while a run is under way
// (src/refresh.tsx): public, a minute's cache, the pages' rate cap.
app.get("/refresh.json", refreshStampsRoute);
app.get("/robots.txt", robotsTxt);
app.get("/llms.txt", llmsTxt);
app.get("/:file{sitemap(?:-[0-9]+)?\\.xml}", sitemapFile);
// The published contracts' parts, read from the records database (src/sitemaps.ts).
app.get("/:file{sitemap-contracts-[0-9]+\\.xml}", contractSitemap);

// The Atom feeds (feeds.py) are static files, but wrangler.jsonc runs the
// Worker first for /data/feeds/* so the measure middleware counts each poll
// and the subscriber count a reader states (views.ts). The file comes from
// the assets binding as it would have been served, the reader's conditional
// headers included so a reader that has the file still gets a 304, with a
// short cache added. A path with no file gets the site's 404 page, as it did
// when such a request fell through to the Worker.
const FEED_CACHE = "public, max-age=300";
// An organization's records feed is made here from the records database
// (pages/backbone.tsx), in the same feed bucket.
app.get("/data/feeds/organizations/:file{org-[0-9a-f]{10}\\.xml}", orgFeed);
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

// The 6- and 12-month windows' files: wrangler.jsonc runs the Worker first
// for these two folders, the radar's paid part once the accounts switch is
// on (pages/expiring.tsx). Every other file under /data/ is served before
// the Worker runs.
for (const window of DEEP_WINDOWS) app.get(`/data/expiring/${window}/*`, (c) => expiringFile(c, window));

// The CSV files in R2: a name on the Data page's list, a yearly file, or a
// mirror file; nothing else is ever read from the bucket.
export function downloadAllowed(file: string): boolean {
  return DOWNLOADS.some((d) => d.file === file) || YEARLY_DOWNLOAD.test(file) || /^mirror\/[A-Za-z0-9._-]+$/.test(file);
}

app.get("/downloads/:file{.+}", async (c) => {
  const file = c.req.param("file");
  // A HEAD reads the object's metadata only.
  const head = c.req.method === "HEAD";
  // The 12-month radar file is part of Pro once the accounts switch is on,
  // by the rule the 12-month window's files follow (pages/expiring.tsx): a
  // request whose plan lacks it gets this route's 404, as for a file that is
  // not there, and nothing is read from the bucket; a Pro request gets the
  // file marked private, so no shared cache hands it on. While the switch is
  // off it is served as every other file.
  const gated = file === EXPIRING_CSV;
  const locked = gated && (await radarWindowLocked(c, "12m"));
  let object: R2Object | R2ObjectBody | null = null;
  let unavailable = false;
  if (!locked && downloadAllowed(file) && c.env.DATA) {
    try {
      const key = file.startsWith("mirror/") ? file : `downloads/${file}`;
      object = head ? await c.env.DATA.head(key) : await c.env.DATA.get(key);
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
  headers.set("Cache-Control", gated && accountsEnabled(c.env) ? "private, no-store" : "public, max-age=3600");
  headers.set("Content-Length", String(object.size));
  return new Response(head ? null : (object as R2ObjectBody).body, { headers });
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
  // The cron triggers from wrangler.jsonc: the hourly one from 15:00 to 20:00
  // UTC delivers saved searches (src/account/deliveries.ts, which does
  // nothing while the accounts switch is off); any other is the daily check,
  // as every trigger was before deliveries existed.
  scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): void {
    if (event.cron === DELIVERY_CRON) ctx.waitUntil(runDeliveries(env).then(() => undefined));
    else ctx.waitUntil(runWatchdog(env));
  },
};
