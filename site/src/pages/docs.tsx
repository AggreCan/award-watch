// /about, /terms and /privacy: three short documents on the same layout as
// the Methodology page. The publisher is named as the project only ("Award
// Watch, an independent Canadian project"); no person or company appears.
// The request limits /terms quotes are wrangler.jsonc's (a test holds the
// two together), and /privacy states what views.ts, forms.tsx, interest.tsx
// and the Ko-fi hook keep, in the words of their own comments.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, page } from "../layout";
import { OGL_URL, pageSeo, type PageKey } from "../seo";

export const CONTACT_EMAIL = "contact@awardwatch.ca";

// Requests a minute per address, as the rate-limit bindings in wrangler.jsonc set them.
export const REQUEST_LIMITS = { page: 120, api: 60, download: 10 } as const;

type Section = { id: string; title: Key; body: unknown };

const Mail: FC = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

const link = (href: string, text: string) => <a href={href}>{text}</a>;

async function doc(c: Context<AppEnv>, key: PageKey, title: Key, lead: Key, sections: (lang: Lang) => Section[]): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  const list = sections(lang);
  return page(
    c,
    <Layout lang={lang} title={t(lang, title)} dataAsOf={stats?.data_as_of ?? null} active={`/${key}`} seo={pageSeo(key, lang)}>
      <PageHead lang={lang} title={t(lang, title)} lead={t(lang, lead)}>
        <p class="page-note">{t(lang, "docs.publisher")}</p>
      </PageHead>
      <div class="doc-layout">
        <nav class="toc" aria-label={t(lang, "toc.label")}>
          <span class="toc-title">{t(lang, "toc.title")}</span>
          {list.map((s) => <a href={`#${s.id}`}>{t(lang, s.title)}</a>)}
        </nav>
        <div class="doc">
          {list.map((s) => (
            <>
              <h2 id={s.id}>{t(lang, s.title)}</h2>
              {s.body as any}
            </>
          ))}
        </div>
      </div>
    </Layout>,
  );
}

export function aboutPage(c: Context<AppEnv>): Promise<Response> {
  return doc(c, "about", "about.title", "about.lead", (lang) => [
    { id: "what", title: "about.toc_what", body: <p>{t(lang, "about.what")}</p> },
    { id: "who", title: "about.toc_who", body: <p>{t(lang, "about.who")}</p> },
    {
      id: "data", title: "about.toc_data", body: (
        <>
          <p>{tj(lang, "about.data", { data: link("/data#sources", t(lang, "nav.data")) })}</p>
          <p>{tj(lang, "about.methods", { methodology: link("/methodology", t(lang, "nav.methodology")) })}</p>
          <p>{tj(lang, "about.claims", { claims: link("/methodology#claims", t(lang, "methodology.toc_claims")) })}</p>
        </>
      ),
    },
    {
      id: "contact", title: "about.toc_contact", body: (
        <>
          <p>{tj(lang, "about.contact", { email: <Mail /> })}</p>
          <p>{tj(lang, "about.corrections", { form: link("/corrections", t(lang, "about.form_link")) })}</p>
          <p>{t(lang, "about.turnaround")}</p>
        </>
      ),
    },
    { id: "cite", title: "about.toc_cite", body: <p>{tj(lang, "about.cite", { cite: link("/cite", t(lang, "cite.title")) })}</p> },
    {
      id: "licences", title: "about.toc_licence", body: (
        <>
          <p>{t(lang, "about.licence_code")}</p>
          <p>{tj(lang, "about.licence_data", { ogl: link(OGL_URL[lang], t(lang, "data.ogl")) })}</p>
        </>
      ),
    },
  ]);
}

export function termsPage(c: Context<AppEnv>): Promise<Response> {
  return doc(c, "terms", "terms.title", "terms.lead", (lang) => [
    { id: "use", title: "terms.toc_use", body: <p>{t(lang, "terms.use")}</p> },
    {
      id: "files", title: "terms.toc_files", body: (
        <>
          <p>{tj(lang, "terms.files", { ogl: link(OGL_URL[lang], t(lang, "data.ogl")), data: link("/data#licence", t(lang, "nav.data")) })}</p>
          <blockquote>{t(lang, "data.credit")}</blockquote>
        </>
      ),
    },
    { id: "authority", title: "terms.toc_authority", body: <p>{t(lang, "terms.authority")}</p> },
    {
      id: "warranty", title: "terms.toc_warranty", body: (
        <>
          <p>{t(lang, "terms.warranty")}</p>
          <p>{t(lang, "terms.liability")}</p>
        </>
      ),
    },
    { id: "changes", title: "terms.toc_changes", body: <p>{tj(lang, "terms.changes", { data: link("/data#changes", t(lang, "nav.data")) })}</p> },
    {
      id: "automated", title: "terms.toc_automated", body: (
        <p>
          {tj(lang, "terms.automated", {
            robots: <a href="/robots.txt" class="mono">robots.txt</a>,
            pages: REQUEST_LIMITS.page, api: REQUEST_LIMITS.api, downloads: REQUEST_LIMITS.download,
          })}
        </p>
      ),
    },
    { id: "code", title: "terms.toc_code", body: <p>{tj(lang, "terms.code", { about: link("/about#licences", t(lang, "footer.about")) })}</p> },
  ]);
}

export function privacyPage(c: Context<AppEnv>): Promise<Response> {
  return doc(c, "privacy", "privacy.title", "privacy.lead", (lang) => [
    { id: "accounts", title: "privacy.toc_accounts", body: <p>{t(lang, "privacy.accounts")}</p> },
    { id: "browser", title: "privacy.toc_browser", body: <p>{t(lang, "privacy.cookie")}</p> },
    {
      id: "counting", title: "privacy.toc_counting", body: (
        <>
          <p>{t(lang, "privacy.counting")}</p>
          <p>{t(lang, "privacy.visitor")}</p>
          <p>{tj(lang, "privacy.retention", { data: link("/data#views", t(lang, "nav.data")) })}</p>
        </>
      ),
    },
    { id: "feeds", title: "privacy.toc_feeds", body: <p>{t(lang, "privacy.feeds")}</p> },
    {
      id: "forms", title: "privacy.toc_forms", body: (
        <>
          <p>{t(lang, "privacy.form_response")}</p>
          <p>{t(lang, "privacy.form_correction")}</p>
          <p>{t(lang, "privacy.form_review")}</p>
          <p>{t(lang, "privacy.donations")}</p>
        </>
      ),
    },
    {
      id: "interest", title: "privacy.toc_interest", body: (
        <>
          <p>{t(lang, "privacy.interest_kept")}</p>
          <p>{t(lang, "privacy.interest_use")}</p>
          <p>{t(lang, "privacy.interest_shown")}</p>
          <p>{tj(lang, "privacy.interest_removal", { email: <Mail /> })}</p>
        </>
      ),
    },
    {
      id: "third", title: "privacy.toc_third", body: (
        <>
          <p>{t(lang, "privacy.third")}</p>
          <p>{t(lang, "privacy.hosting")}</p>
        </>
      ),
    },
    {
      id: "removal", title: "privacy.toc_removal", body: (
        <p>{tj(lang, "privacy.removal", { form: link("/corrections", t(lang, "about.form_link")), email: <Mail /> })}</p>
      ),
    },
  ]);
}
