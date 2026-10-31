import type { Context } from "hono";
import { html } from "hono/html";
import type { FC, PropsWithChildren } from "hono/jsx";
import { CLOSING_SOON_DAYS } from "./constants";
import { type Competitive, competitiveOf } from "./data";
import type { AppEnv } from "./env";
import { competitiveLabel, statusLabel, t, type Key, type Lang } from "./i18n";
import { type Seo, absoluteUrl, alternates, canonicalUrl, defaultDescription, pageTitle } from "./seo";

// The formatting helpers live with the dictionary; pages import them from here.
export { fmtInt, fmtMoney, fmtMoneyShort, pick } from "./i18n";

// Strings for a client script, as a JSON data block the script reads by id.
// A JSON block is never executed, so the script-src policy is untouched.
// Escaping < > & and the two line separators keeps the text from closing the
// element or being read as markup. The JSON-LD blocks in the head use the
// same escaper.
export function scriptJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export const ClientData: FC<{ id: string; data: unknown }> = ({ id, data }) => (
  <script type="application/json" id={id} dangerouslySetInnerHTML={{ __html: scriptJson(data) }}></script>
);

// The mark: a lowercase "aw" set in Inter Bold, the second stroke of the w
// drawn as a check in the emerald token (--check in public/styles.css). Two
// paths on a 32-unit box, the ink in currentColor so it follows the dark
// scheme. The path data is brand/mark-two-tone.svg's (brand/make_mark.py
// regenerates it); public/favicon.svg carries the same two shapes on a white
// tile, and scripts/make-icons.py renders the raster icons from it.
export const MARK_INK_PATH =
  "M4.35 24.79 L4.14 24.78 L3.75 24.76 L3.37 24.70 L3.01 24.62 L2.66 24.51 L2.33 24.37 L2.03 24.21 L1.73 24.02 L1.60 23.91 L1.53 23.86 L1.40 23.74 L1.28 23.62 L1.17 23.49 L1.07 23.36 L0.97 23.21 L0.89 23.06 L0.81 22.91 L0.71 22.66 L0.61 22.31 L0.54 21.94 L0.50 21.53 L0.50 21.32 L0.50 21.16 L0.52 20.86 L0.56 20.57 L0.62 20.30 L0.70 20.04 L0.79 19.81 L0.91 19.59 L1.04 19.39 L1.12 19.29 L1.20 19.20 L1.37 19.03 L1.54 18.87 L1.73 18.73 L1.94 18.59 L2.15 18.47 L2.37 18.36 L2.61 18.26 L2.73 18.22 L2.98 18.14 L3.50 18.00 L4.03 17.88 L4.58 17.80 L4.86 17.77 L5.22 17.74 L5.86 17.66 L6.40 17.59 L6.83 17.51 L7.01 17.47 L7.09 17.45 L7.23 17.39 L7.35 17.33 L7.46 17.25 L7.54 17.16 L7.60 17.05 L7.64 16.94 L7.66 16.81 L7.67 16.74 L7.67 16.69 L7.66 16.60 L7.65 16.42 L7.62 16.26 L7.58 16.11 L7.52 15.97 L7.44 15.83 L7.36 15.71 L7.25 15.60 L7.20 15.55 L7.14 15.50 L7.01 15.41 L6.86 15.34 L6.71 15.27 L6.54 15.22 L6.36 15.19 L6.17 15.16 L5.96 15.15 L5.86 15.15 L5.74 15.15 L5.53 15.16 L5.33 15.18 L5.13 15.22 L4.95 15.27 L4.78 15.33 L4.62 15.40 L4.48 15.49 L4.41 15.54 L4.34 15.59 L4.21 15.69 L4.10 15.80 L4.00 15.91 L3.91 16.03 L3.83 16.15 L3.76 16.28 L3.70 16.41 L3.67 16.48 L0.83 16.01 L0.89 15.82 L1.03 15.47 L1.19 15.13 L1.39 14.82 L1.61 14.53 L1.86 14.26 L2.14 14.01 L2.44 13.78 L2.60 13.68 L2.77 13.58 L3.12 13.40 L3.49 13.24 L3.88 13.11 L4.29 13.01 L4.72 12.93 L5.16 12.88 L5.63 12.85 L5.87 12.85 L6.02 12.85 L6.33 12.86 L6.63 12.89 L6.93 12.92 L7.22 12.97 L7.52 13.04 L7.80 13.11 L8.09 13.20 L8.23 13.24 L8.37 13.29 L8.64 13.41 L8.89 13.53 L9.13 13.68 L9.36 13.83 L9.58 14.01 L9.78 14.19 L9.97 14.39 L10.06 14.50 L10.15 14.61 L10.30 14.84 L10.44 15.09 L10.55 15.36 L10.64 15.64 L10.70 15.95 L10.75 16.26 L10.77 16.60 L10.77 16.77 L10.77 24.56 L7.83 24.56 L7.83 22.96 L7.73 22.96 L7.67 23.06 L7.56 23.25 L7.42 23.43 L7.28 23.61 L7.12 23.77 L6.95 23.93 L6.77 24.07 L6.57 24.21 L6.47 24.27 L6.36 24.34 L6.14 24.45 L5.90 24.55 L5.65 24.63 L5.38 24.69 L5.11 24.74 L4.81 24.77 L4.50 24.79 L4.35 24.79 M5.23 22.60 L5.36 22.60 L5.62 22.58 L5.87 22.54 L6.10 22.48 L6.32 22.40 L6.53 22.31 L6.73 22.19 L6.91 22.05 L7.00 21.97 L7.08 21.89 L7.23 21.73 L7.36 21.55 L7.47 21.37 L7.55 21.17 L7.62 20.97 L7.66 20.76 L7.68 20.54 L7.69 20.42 L7.69 19.17 L7.64 19.20 L7.51 19.27 L7.36 19.32 L7.18 19.38 L7.08 19.40 L6.87 19.45 L6.43 19.54 L6.20 19.58 L5.76 19.65 L5.39 19.70 L5.18 19.73 L4.79 19.82 L4.53 19.91 L4.37 19.98 L4.21 20.06 L4.07 20.14 L4.01 20.18 L3.94 20.23 L3.83 20.33 L3.73 20.44 L3.65 20.56 L3.58 20.70 L3.53 20.84 L3.50 20.99 L3.48 21.15 L3.48 21.24 L3.48 21.32 L3.50 21.48 L3.53 21.63 L3.57 21.77 L3.63 21.89 L3.71 22.01 L3.80 22.12 L3.91 22.21 L3.97 22.26 L4.03 22.30 L4.16 22.38 L4.30 22.44 L4.45 22.49 L4.61 22.54 L4.77 22.57 L4.95 22.59 L5.13 22.60 L5.23 22.60 Z M15.83 24.56 L12.41 12.99 L15.67 12.99 L16.67 17.27 L16.89 18.26 L17.13 19.34 L17.25 19.90 L17.50 21.10 L17.62 21.74 L17.74 21.11 L17.99 19.93 L18.12 19.36 L18.38 18.28 L18.62 17.27 L19.52 13.65 L20.77 18.01 L20.68 18.43 L20.57 18.89 L20.37 19.72 L20.27 20.10 L18.98 24.56 L15.83 24.56 Z";
export const MARK_CHECK_PATH =
  "M19.87 12.99 L22.53 12.99 L23.57 17.27 L23.79 18.28 L24.05 19.36 L24.18 19.92 L24.43 21.12 L24.56 21.75 L24.67 21.12 L24.89 19.92 L25.01 19.36 L25.25 18.28 L25.48 17.27 L26.48 12.99 L28.20 7.21 L31.50 7.21 L26.35 24.56 L23.19 24.56 L21.91 20.10 L21.80 19.72 L21.59 18.88 L21.49 18.43 L21.29 17.50 L21.08 16.59 L21.00 16.95 L19.87 12.99 Z";
export const MARK_CHECK_COLOUR = "#0f7b4f";

export const BrandMark: FC = () => (
  <svg class="brand-mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
    <path fill="currentColor" fill-rule="evenodd" d={MARK_INK_PATH} />
    <path class="mark-check" fill={MARK_CHECK_COLOUR} fill-rule="evenodd" d={MARK_CHECK_PATH} />
  </svg>
);

// The day a page counts "closing soon" from: the data's own date when it has
// one, so a page and the file it reads agree, else today in UTC.
export function todayOf(dataAsOf: string | null | undefined): string {
  return dataAsOf && /^\d{4}-\d{2}-\d{2}/.test(dataAsOf) ? dataAsOf.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// An open notice closing within the window reads as closing soon; the tag's
// colour differs from the open one in lightness as well as hue.
export function tenderState(status: string, closing: string | null, today: string): string {
  if (status !== "open" || !closing) return status;
  const day = closing.slice(0, 10);
  return day >= today && day <= addDays(today, CLOSING_SOON_DAYS) ? "closing" : "open";
}

export const StatusBadge: FC<{ status: string; lang: Lang }> = ({ status, lang }) => (
  <span class={`badge badge-${/^[a-z]+$/.test(status) ? status : "unknown"}`}>{statusLabel(lang, status)}</span>
);

// "Non-competitive" is the source's own term: the definition rides along as
// the tag's tooltip and is spelled out on the Methodology page it links to.
export const CompetitiveFlag: FC<{ value: Competitive; lang: Lang }> = ({ value, lang }) => {
  const v = competitiveOf(value);
  const kind = v === true ? "yes" : v === false ? "no" : "unstated";
  const tip: Key = v === true ? "competitive.def_yes" : v === false ? "competitive.def_no" : "competitive.def_unstated";
  return (
    <span class={`flag flag-${kind}`} title={t(lang, tip)}>
      {competitiveLabel(lang, value)}
    </span>
  );
};

export const Breadcrumb: FC<{ lang: Lang; crumbs: { name: string; path?: string }[] }> = ({ lang, crumbs }) => (
  <nav aria-label={t(lang, "common.breadcrumb")} class="breadcrumb">
    {crumbs.map((c, i) => (
      <>
        {i > 0 ? " / " : ""}
        {c.path ? <a href={c.path}>{c.name}</a> : c.name}
      </>
    ))}
  </nav>
);

// Search and social metadata. A page without an Seo object (errors, the
// thank-you page) gets only the site description: no canonical, no cards.
const MetaTags: FC<{ seo?: Seo; lang: Lang; title: string }> = ({ seo, lang, title }) => {
  if (!seo) return <meta name="description" content={defaultDescription(lang)} />;
  if (seo.noindex) {
    return (
      <>
        <meta name="description" content={seo.description} />
        <meta name="robots" content="noindex" />
      </>
    );
  }
  const url = canonicalUrl(seo.path, lang);
  const socialTitle = seo.socialTitle ?? title;
  return (
    <>
      <meta name="description" content={seo.description} />
      <link rel="canonical" href={url} />
      {alternates(seo.path).map((a) => (
        <link rel="alternate" hreflang={a.hreflang} href={a.href} />
      ))}
      <meta property="og:site_name" content={t(lang, "site.name")} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={socialTitle} />
      <meta property="og:description" content={seo.description} />
      <meta property="og:locale" content={lang === "fr" ? "fr_CA" : "en_CA"} />
      <meta property="og:locale:alternate" content={lang === "fr" ? "en_CA" : "fr_CA"} />
      <meta property="og:image" content={absoluteUrl("/apple-touch-icon.png")} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={socialTitle} />
      <meta name="twitter:description" content={seo.description} />
      {(seo.jsonLd ?? []).map((data) => (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: scriptJson(data) }}></script>
      ))}
    </>
  );
};

const NAV: readonly [string, Key][] = [
  ["/tenders", "nav.tenders"],
  ["/awards", "nav.awards"],
  ["/expiring", "nav.expiring"],
  ["/organizations", "nav.organizations"],
  ["/buyers", "nav.buyers"],
  ["/categories", "nav.categories"],
  ["/rankings", "nav.rankings"],
  ["/data", "nav.data"],
];

// The stylesheet's version: bump it with any change to public/styles.css so a
// cached copy is never paired with new markup.
export const STYLES_VERSION = 1;

export const Layout: FC<
  PropsWithChildren<{ lang: Lang; title: string; dataAsOf: string | null; active?: string; head?: unknown; seo?: Seo }>
> = (props) => {
  const { lang, active } = props;
  const title = props.seo?.title ?? pageTitle(props.title);
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="stylesheet" href={`/styles.css?v=${STYLES_VERSION}`} />
        <script src="/theme.js"></script>
        <script src="/links.js" defer></script>
        <link rel="preload" href="/fonts/public-sans-latin-var.woff2" as="font" type="font/woff2" crossorigin="anonymous" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <MetaTags seo={props.seo} lang={lang} title={props.title} />
        {props.head as any}
      </head>
      <body>
        <header class="site-header">
          <div class="header-top">
            <div class="container header-row">
              <a href="/" class="brand">
                <BrandMark />
                <span class="brand-name">{t(lang, "site.name")}</span>
              </a>
              <span class="tagline">{t(lang, "site.tagline")}</span>
              <div class="header-meta">
                <span class="mono">
                  {t(lang, "nav.data_as_of")} {props.dataAsOf ?? t(lang, "common.na")}
                </span>
                <button type="button" class="theme-toggle">
                  <span class="when-light">{t(lang, "nav.dark")}</span>
                  <span class="when-dark">{t(lang, "nav.light")}</span>
                </button>
                <a href={`?lang=${lang === "fr" ? "en" : "fr"}`} class="lang-toggle" rel="nofollow">
                  {t(lang, "nav.lang")}
                </a>
              </div>
            </div>
          </div>
          <nav aria-label={t(lang, "nav.main_label")} class="main-nav">
            <div class="container">
              <ul>
                {NAV.map(([href, key]) => (
                  <li>
                    <a href={href} class={active === href ? "active" : undefined} aria-current={active === href ? "page" : undefined}>
                      {t(lang, key)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </header>
        <main class="container">{props.children}</main>
        <footer class="site-footer">
          <div class="container footer-row">
            <span>
              {t(lang, "footer.sources")} <a href="/data#sources">{t(lang, "footer.sources_link")}</a>
            </span>
            <a href="/methodology">{t(lang, "footer.methodology")}</a>
            <a href="/data#downloads">{t(lang, "footer.download")}</a>
            <a href="/feeds">{t(lang, "footer.feeds")}</a>
            <a href="/watchlist">{t(lang, "footer.watchlist")}</a>
            <a href="/corrections">{t(lang, "footer.corrections")}</a>
            <a href="/cite">{t(lang, "footer.cite")}</a>
            <a href="/support">{t(lang, "footer.support")}</a>
          </div>
        </footer>
      </body>
    </html>
  );
};

export function page(c: Context<AppEnv>, body: unknown, status = 200): Response | Promise<Response> {
  c.header("Cache-Control", status === 200 ? "public, max-age=300" : "no-store");
  return c.html(html`<!doctype html>${body as any}`, status as any);
}

// Shown while the data files have not been published yet (before the first
// nightly run, or on a dev checkout without `npm run data:local`).
export function noDataPage(c: Context<AppEnv>, title: Key): Response | Promise<Response> {
  const lang = c.get("lang") ?? "en";
  return page(
    c,
    <Layout lang={lang} title={t(lang, title)} dataAsOf={null}>
      <h1>{t(lang, "error.no_data")}</h1>
      <p>{t(lang, "error.no_data_text")}</p>
    </Layout>,
    503,
  );
}

// A 404 for a well-formed id or reference that no file holds, with a way back.
export function notFoundPage(
  c: Context<AppEnv>, dataAsOf: string | null, title: Key, back: string, backKey: Key,
): Response | Promise<Response> {
  const lang = c.get("lang") ?? "en";
  return page(
    c,
    <Layout lang={lang} title={t(lang, title)} dataAsOf={dataAsOf}>
      <h1>{t(lang, title)}</h1>
      <p>
        <a href={back}>{t(lang, backKey)}</a>
      </p>
    </Layout>,
    404,
  );
}

// The canonical form of a path is lower case; anything else is sent there,
// with the language query kept.
export function lowerRedirect(c: Context<AppEnv>, path: string): Response | null {
  const url = new URL(c.req.url);
  if (url.pathname === path) return null;
  c.header("Cache-Control", "public, max-age=300");
  return c.redirect(`${path}${url.search}`, 301);
}
