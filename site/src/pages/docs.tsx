// /about, /terms and /privacy: three short documents on the same layout as
// the Methodology page. The publisher is named as the company that sells Pro,
// Allwater Software Inc.; no person appears.
// The request limits /terms quotes are wrangler.jsonc's (a test holds the
// two together), and /privacy states what views.ts, forms.tsx and
// interest.tsx keep, in the words of their own comments.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, page } from "../layout";
import { OGL_URL, pageSeo, type PageKey } from "../seo";
import { AccountsPrivacy, PaymentsPrivacy } from "../account/privacy";
import { PLAN_SEATS, memberSeats } from "../account/entitlements";
import { ultraOnSale } from "../account/payments";
import { SEAT_INVITE_DAYS, SEAT_WINDOW_DAYS, joinsAllowed, seatsOn } from "../account/seats";
import { SESSIONS_MAX } from "../account/session";
import { accountsEnabled } from "../account/switch";
import { CONTACT_EMAIL } from "../contact";
import { followsPanelOn } from "../lines";

export { CONTACT_EMAIL };

// Requests a minute per address, as the rate-limit bindings in wrangler.jsonc set them.
export const REQUEST_LIMITS = { page: 120, api: 60, download: 10 } as const;
// Downloads a minute per account signed in on Pro or Ultra, counted by the
// account in place of the address while the accounts switch is on, as
// PAID_DOWNLOAD_LIMIT in wrangler.jsonc sets it (src/limits.ts throttle).
export const PAID_DOWNLOADS_PER_MINUTE = 30;

type Section = { id: string; title: Key; body: unknown };

const Mail: FC = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

const link = (href: string, text: string) => <a href={href}>{text}</a>;

// toc: the contents box, left out of a page shorter than about two screens
// (About and Privacy are, at 1440 px: 1,289 to 1,883 px tall). Terms has
// one since the paid plan's section nearly quadrupled its text.
async function doc(
  c: Context<AppEnv>, key: PageKey, title: Key, lead: Key, sections: (lang: Lang) => Section[], toc = false,
): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  const list = sections(lang);
  return page(
    c,
    <Layout lang={lang} title={t(lang, title)} dataAsOf={stats?.data_as_of ?? null} active={`/${key}`} seo={pageSeo(key, lang)}>
      <PageHead lang={lang} title={t(lang, title)} lead={t(lang, lead)}>
        <p class="page-note">{t(lang, "docs.publisher")}</p>
      </PageHead>
      <div class={toc ? "doc-layout" : "doc-layout doc-alone"}>
        {toc ? (
          <nav class="toc" aria-label={t(lang, "toc.label")}>
            <span class="toc-title">{t(lang, "toc.title")}</span>
            {list.map((s) => <a href={`#${s.id}`}>{t(lang, s.title)}</a>)}
          </nav>
        ) : null}
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

// The paid plan's parts after "Who Sells It", each a heading and a paragraph
// with no link in it. The refund's paragraph names the billing page's button
// and the address to write to, as text.
const PRO_TERMS: [Key, Key][] = [
  ["terms.pro_includes_title", "terms.pro_includes"],
  ["terms.pro_prices_title", "terms.pro_prices"],
  ["terms.pro_renewal_title", "terms.pro_renewal"],
  ["terms.pro_cancel_title", "terms.pro_cancel"],
  ["terms.pro_refund_title", "terms.pro_refund"],
  ["terms.pro_failed_title", "terms.pro_failed"],
  ["terms.pro_abuse_title", "terms.pro_abuse"],
  ["terms.pro_law_title", "terms.pro_law"],
  ["terms.pro_changes_title", "terms.pro_changes"],
];

// The same parts once Ultra can be bought (account/payments.ts ultraOnSale):
// the paid plans, Pro and Ultra, with Moving Between Plans after the renewal.
// Until then the page keeps the Pro terms above, word for word, so the terms
// change on the day Ultra opens and not before.
const PAID_TERMS: [Key, Key][] = [
  ["terms.pro_includes_title_ultra", "terms.pro_includes_ultra"],
  ["terms.pro_prices_title", "terms.pro_prices_ultra"],
  ["terms.pro_renewal_title", "terms.pro_renewal"],
  ["terms.pro_change_title", "terms.pro_change"],
  ["terms.pro_cancel_title", "terms.pro_cancel_ultra"],
  ["terms.pro_refund_title", "terms.pro_refund_ultra"],
  ["terms.pro_failed_title", "terms.pro_failed_ultra"],
  ["terms.pro_abuse_title", "terms.pro_abuse_ultra"],
  ["terms.pro_law_title", "terms.pro_law"],
  ["terms.pro_changes_title", "terms.pro_changes"],
];

// The paid plans' parts while the seats' switch is on as well (account/seats.ts
// seatsOn; the seats design's 6.3): Seats after What the Paid Plans Include,
// and the abuse paragraph naming a seat beside an account. With the switch off
// the paid terms above stand word for word. Cleared by the operator 2026-11-21.
const SEATS_TERMS: [Key, Key][] = PAID_TERMS.flatMap(([title, body]): [Key, Key][] =>
  body === "terms.pro_includes_ultra" ? [[title, body], ["terms.pro_seats_title", "terms.pro_seats"]]
    : body === "terms.pro_abuse_ultra" ? [[title, "terms.pro_abuse_seats"]]
    : [[title, body]]);

// The figures the Seats section names, read when the page is drawn: each plan's
// own seats, the seats a subscriber gives, the link's days, the joins and their
// window, and the signed-in browsers an account keeps.
const seatsFigures = (lang: Lang): Record<string, string> => {
  const seats = (n: number) => t(lang, n === 1 ? "seats.seat_one" : "seats.seat_many", { n: fmtInt(n, lang) });
  return {
    pro_seats: seats(PLAN_SEATS.pro), ultra_seats: seats(PLAN_SEATS.ultra), others: fmtInt(memberSeats("ultra"), lang),
    days: fmtInt(SEAT_INVITE_DAYS, lang), joins: fmtInt(joinsAllowed("ultra"), lang), window: fmtInt(SEAT_WINDOW_DAYS, lang),
    devices: fmtInt(SESSIONS_MAX, lang),
  };
};

export async function termsPage(c: Context<AppEnv>): Promise<Response> {
  const ultra = await ultraOnSale(c.env);
  const followsOn = followsPanelOn(c.env);
  const accountsOpen = accountsEnabled(c.env);
  // The Seats section only beside Ultra's terms, which it describes; nothing is read for it while its switch is off.
  const seats = ultra && (await seatsOn(c.env).catch(() => false));
  const parts = ultra ? (seats ? SEATS_TERMS : PAID_TERMS) : PRO_TERMS;
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
      // The advisory paragraph covers what the site calculates for a reader (matching notices, the holder's record), between
      // the warranty and the liability, so the Pro section's reference to this section covers it too.
      id: "warranty", title: "terms.toc_warranty", body: (
        <>
          <p>{t(lang, "terms.warranty")}</p>
          {/* The Methodology page as a whole: its contents name each calculation's section. */}
          {/* May follow is named only while its switch is on (pages/follows.tsx). */}
          <p>{tj(lang, followsOn ? "terms.advisory_follows" : "terms.advisory", { methodology: link("/methodology", t(lang, "nav.methodology")) })}</p>
          <p>{t(lang, "terms.liability")}</p>
        </>
      ),
    },
    { id: "changes", title: "terms.toc_changes", body: <p>{tj(lang, "terms.changes", { data: link("/data#changes", t(lang, "nav.data")) })}</p> },
    {
      id: "automated", title: "terms.toc_automated", body: (
        <p>
          {/* A paying account's own download limit exists only while accounts are open; Ultra is named once on sale. */}
          {tj(lang, !accountsOpen ? "terms.automated" : ultra ? "terms.automated_paid" : "terms.automated_pro", {
            robots: <a href="/robots.txt" class="mono">robots.txt</a>,
            pages: REQUEST_LIMITS.page, api: REQUEST_LIMITS.api, downloads: REQUEST_LIMITS.download, paid: PAID_DOWNLOADS_PER_MINUTE,
          })}
        </p>
      ),
    },
    { id: "code", title: "terms.toc_code", body: <p>{tj(lang, "terms.code", { about: link("/about#licences", t(lang, "footer.about")) })}</p> },
    {
      // The billing page is named in words only: with the switch off no
      // public page may link to /account (test/accounts-switch.test.ts).
      id: "pro", title: ultra ? "terms.toc_pro_ultra" : "terms.toc_pro", body: (
        <>
          <p>{tj(lang, ultra ? "terms.pro_intro_ultra" : "terms.pro_intro", { warranty: link("#warranty", t(lang, "terms.toc_warranty")) })}</p>
          <h3>{t(lang, "terms.pro_seller_title")}</h3>
          <p>{tj(lang, ultra ? "terms.pro_seller_ultra" : "terms.pro_seller", { email: <Mail /> })}</p>
          {parts.map(([title, body]) => (
            <>
              <h3>{t(lang, title)}</h3>
              <p>{t(lang, body, body === "terms.pro_seats" ? seatsFigures(lang) : { email: CONTACT_EMAIL })}</p>
            </>
          ))}
        </>
      ),
    },
  ], true);
}

export async function privacyPage(c: Context<AppEnv>): Promise<Response> {
  // While accounts are open (src/account/switch.ts) the first section says what an account keeps,
  // and the second what paying for Pro gives Stripe and leaves on the site.
  const accounts = accountsEnabled(c.env);
  // Once Ultra can be bought the accounts section also says what a dashboard keeps.
  const dashboard = accounts && (await ultraOnSale(c.env));
  // While the seats' switch is on, what an invitation and a seat keep (account/privacy.tsx); nothing is read for it while off.
  const seats = accounts && (await seatsOn(c.env).catch(() => false));
  const logos = !!c.env.BRANDFETCH_CLIENT_ID;
  return doc(c, "privacy", "privacy.title", "privacy.lead", (lang) => [
    accounts
      ? { id: "accounts", title: "account.privacy_toc", body: <AccountsPrivacy lang={lang} dashboard={dashboard} seats={seats} /> }
      : { id: "accounts", title: "privacy.toc_accounts", body: <p>{t(lang, "privacy.accounts")}</p> },
    ...(accounts ? [{ id: "payments", title: "billing.privacy_toc", body: <PaymentsPrivacy lang={lang} ultra={dashboard} /> } satisfies Section] : []),
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
          <p>{t(lang, "privacy.form_merge")}</p>
          <p>{t(lang, "privacy.form_review")}</p>
        </>
      ),
    },
    {
      id: "interest", title: "privacy.toc_interest", body: (
        <>
          <p>{t(lang, "privacy.interest_kept")}</p>
          <p>{t(lang, "privacy.interest_use")}</p>
          {/* The landing page's Ultra card keeps addresses in the same table; it exists only while accounts are open. */}
          {accounts ? <p>{t(lang, "privacy.interest_ultra")}</p> : null}
          <p>{t(lang, "privacy.interest_shown")}</p>
          <p>{tj(lang, "privacy.interest_removal", { email: <Mail /> })}</p>
        </>
      ),
    },
    {
      id: "third", title: "privacy.toc_third", body: (
        <>
          <p>{t(lang, "privacy.third")}</p>
          {/* The landing page's logos (pages/landing.tsx), only while the Worker has a Brandfetch client id. */}
          {logos ? <p>{t(lang, "privacy.logos")}</p> : null}
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
