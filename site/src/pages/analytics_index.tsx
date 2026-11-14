// /analytics: the index of the analytics views (pages/analytics.tsx,
// docs/analytics.md, "The index"), the page the rail's Analytics item opens.
// It lists the views a reader can open: every buyer with a record in the four
// money sources (buyers/index.json), every UNSPSC segment (the 57 codes the
// site knows, so the list never depends on a file), the organizations with
// the largest award values of the data year (stats.json) beside a word on
// finding the rest, and for a signed-in account that has named its
// organization (account/org_claim.ts) that organization's view and its page
// in the account, and for a signed-in account its saved views
// (account/saved_views.ts), read the way the claim is.
//
// The search box is a GET to this page (?q=). An organization, buyer or
// segment address, an organization id, a buyer id the list holds or a
// two-digit segment code goes straight to that view (302); so does a query
// that matches exactly one view. Anything else lists the matches: buyers and
// segments matched here from their names, organizations from the hosted
// search database (search_db.ts, the statements /search runs), the first
// ORG_MATCHES_SHOWN with a link to /search for the rest.
//
// The views are the paid tier's part, so while the accounts switch is off
// this address is the site's 404 and the rail has no item, as for the views
// themselves. With it on nothing is hidden: every reader gets the same
// lists, and a reader whose plan lacks the feature one gate note in the head
// (the only chip in the page's body). A missing file is a panel with a plain
// line, never an error; a search database that cannot answer is one line in
// the organizations' panel. The plain page is a section page for search
// engines (the sitemap lists it); a query is noindex and robots.txt keeps
// crawlers off it, since each one reads the search database. Nothing here
// reads the records database.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { checkOrganization, orgIdIn, readClaim } from "../account/org_claim";
import { type SavedView, listViews } from "../account/saved_views";
import { readSession } from "../account/session";
import { SavedViewsPanel } from "../account/view_pages";
import { savedViewCap } from "../account/entitlements";
import { MONEY_SOURCES, SEGMENTS, SEGMENT_CODES } from "../constants";
import { BUYER_ID_RE, SEGMENT_RE, loadBuyers, loadStats, type BuyerSummary, type OrgTotal } from "../data";
import type { AppEnv, Env } from "../env";
import { fmtInt, numberLocale, pick, segmentLabel, t, tj, type Lang } from "../i18n";
import { Layout, PageHead, Panel, page, todayOf } from "../layout";
import { analyticsAccess } from "../plan";
import { ProNote, SUBSCRIBE_PATH } from "../pro";
import { FREE_YEARS, MAX_YEARS } from "../records_db";
import {
  ANY_ROW_SQL, MAX_Q, counts, faultSummary, lineMatches, orgSelect, searchTerms, toOrgHit, type OrgHit, type SearchTerms,
} from "../search_db";
import { pageSeo, pageTitle } from "../seo";
import { searchPath } from "./search";

export const ANALYTICS_INDEX_PATH = "/analytics";

// The organizations a query lists before the link to the search page.
export const ORG_MATCHES_SHOWN = 25;

// -- the views' addresses ------------------------------------------------------------

export const buyerView = (id: string) => `/buyers/${id}/analytics`;
export const organizationView = (id: string) => `/organizations/${id}/analytics`;
export const segmentView = (code: string) => `/segments/${code}/analytics`;

// A buyer has a view worth listing when one of the four money sources names
// it; a buyer only the lobbying registry names would chart nothing.
export function buyerHasRecords(b: BuyerSummary): boolean {
  const n: Record<(typeof MONEY_SOURCES)[number], number> = { awards: b.n_awards, history: b.n_history, contracts: b.n_contracts, grants: b.n_grants };
  return MONEY_SOURCES.some((s) => (n[s] ?? 0) > 0);
}

const buyerName = (lang: Lang, b: BuyerSummary) => pick(lang, b.name_en, b.name_fr) ?? b.name_en;
const buyerAcronym = (lang: Lang, b: BuyerSummary) => pick(lang, b.acronym_en, b.acronym_fr);

// The view a query names outright, or null: an organization id or the address
// of a profile (orgIdIn), the address of a buyer or a segment page, a
// two-digit code of one of the 57 segments, or a buyer id the list holds
// (buyerIds; a bare word such as "health" reads as a buyer id, so only a
// listed one counts). The views themselves check an id they are sent to.
export function addressedView(raw: string, buyerIds: ReadonlySet<string>): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  const org = orgIdIn(v);
  if (org) return organizationView(org);
  const segment = /(?:^|\/)segments\/([0-9]{2})(?:[/?#]|$)/.exec(v)?.[1] ?? (SEGMENT_RE.test(v) ? v : null);
  if (segment && SEGMENT_CODES.includes(segment)) return segmentView(segment);
  const buyer = /(?:^|\/)buyers\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:[/?#]|$)/.exec(v)?.[1];
  if (buyer && buyer.length <= 80) return buyerView(buyer);
  if (BUYER_ID_RE.test(v) && buyerIds.has(v)) return buyerView(v);
  return null;
}

// The buyers whose names, acronyms or id hold every word of the query (the
// last as a prefix), as the search database matches a name.
export function matchBuyers(buyers: readonly BuyerSummary[], terms: SearchTerms): BuyerSummary[] {
  if (!terms.terms.length) return [];
  return buyers.filter((b) =>
    [b.name_en, b.name_fr, b.acronym_en, b.acronym_fr, b.id].some((line) => !!line && lineMatches(line, terms.terms)));
}

// The segments whose code or name, in either language, holds every word.
export function matchSegments(terms: SearchTerms): string[] {
  if (!terms.terms.length) return [];
  return SEGMENT_CODES.filter((code) => [code, SEGMENTS[code].en, SEGMENTS[code].fr].some((line) => lineMatches(line, terms.terms)));
}

export type OrgMatches = { rows: OrgHit[]; total: number };

// The organizations whose names match, from the hosted search database: its
// count and its first page, in one batch (the statements /search runs). Null
// when there is no database, a statement fails, or the database holds no row
// yet; the page then says the search is not available.
export async function matchOrganizations(env: Env, terms: SearchTerms): Promise<OrgMatches | null> {
  const db = env.SEARCH;
  if (!db || !terms.terms.length) return null;
  try {
    const stmts = [counts(terms)[0], orgSelect(terms, 1)];
    const res = await db.batch<Record<string, unknown>>(stmts.map((s) => db.prepare(s.sql).bind(...s.params)));
    const n = res[0]?.results?.[0]?.n;
    const total = typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
    if (!total) {
      const any = await db.prepare(ANY_ROW_SQL).first<Record<string, unknown>>();
      if (!any?.n) return null;
    }
    return { rows: (res[1]?.results ?? []).map((r) => toOrgHit(r, terms.terms)), total };
  } catch (e) {
    console.error(`analytics index: organization search failed (${faultSummary(e)})`);
    return null;
  }
}

// The organization the signed-in account has named as its own, with its
// display name; the id the profile now goes by when the claimed one was
// retired. Null without a session or a claim, and on any fault (the claim's
// table not yet made included): the panel is then left out.
async function ownOrganization(c: Context<AppEnv>): Promise<{ id: string; name: string } | null> {
  try {
    const read = await readSession(c);
    if (read.state !== "ok") return null;
    const claim = await readClaim(c.env, read.account.userId);
    if (!claim) return null;
    const live = await checkOrganization(c.env, claim.organizationId);
    return live ? { id: live.id, name: live.profile.organization.display_name } : { id: claim.organizationId, name: claim.organizationId };
  } catch {
    return null;
  }
}

// The signed-in account's saved views, oldest first, and its plan's figure.
// Null without a session and on any fault, the table not yet made included:
// the panel is then left out.
async function ownViews(c: Context<AppEnv>): Promise<{ views: SavedView[]; cap: number } | null> {
  try {
    const read = await readSession(c);
    if (read.state !== "ok") return null;
    const views = await listViews(c.env, read.account.userId);
    return views ? { views, cap: savedViewCap(read.account.plan) } : null;
  } catch {
    return null;
  }
}

// -- the pieces ------------------------------------------------------------------------

// The search box, a GET to this page; q fills it on a results page.
const FindForm: FC<{ lang: Lang; q: string }> = ({ lang, q }) => (
  <form method="get" action={ANALYTICS_INDEX_PATH} class="toolbar" role="search">
    <div class="toolbar-fields">
      <label class="field field-text">
        <span class="field-label">{t(lang, "analytics.find_label")}</span>
        <input type="search" name="q" value={q} maxlength={MAX_Q} autocomplete="off" />
      </label>
      <div class="toolbar-actions">
        <button type="submit" class="btn btn-primary">{t(lang, "analytics.find_submit")}</button>
      </div>
    </div>
    <p class="toolbar-note">{t(lang, "analytics.find_note")}</p>
  </form>
);

// The gate note: what a reader without the feature gets in each view, and the
// way to Pro (a signed-in Free reader goes straight to billing from there).
const FreeLine: FC<{ lang: Lang }> = ({ lang }) => (
  <ProNote lang={lang}>
    {t(lang, "analytics.index_free", { free: fmtInt(FREE_YEARS, lang), max: fmtInt(MAX_YEARS, lang) })}{" "}
    <a href={SUBSCRIBE_PATH}>{t(lang, "analytics.pro_sign_in")}</a>
  </ProNote>
);

const BuyerList: FC<{ lang: Lang; rows: readonly BuyerSummary[] }> = ({ lang, rows }) => (
  <ul class="view-list">
    {rows.map((b) => {
      const acronym = buyerAcronym(lang, b);
      return (
        <li>
          <a href={buyerView(b.id)} rel="nofollow">{buyerName(lang, b)}</a>
          {acronym ? <> <span class="muted">{acronym}</span></> : null}
        </li>
      );
    })}
  </ul>
);

const SegmentList: FC<{ lang: Lang; codes: readonly string[] }> = ({ lang, codes }) => (
  <ul class="view-list">
    {codes.map((code) => (
      <li><span class="mono">{code}</span> <a href={segmentView(code)} rel="nofollow">{segmentLabel(lang, code)}</a></li>
    ))}
  </ul>
);

const OrgList: FC<{ rows: readonly { id: string; name: string }[] }> = ({ rows }) => (
  <ul class="view-list">
    {rows.map((o) => <li><a href={organizationView(o.id)} rel="nofollow">{o.name}</a></li>)}
  </ul>
);

const directoryLink = (lang: Lang) => <a href="/organizations">{t(lang, "analytics.orgs_directory")}</a>;

const BuyersUnavailable: FC<{ lang: Lang }> = ({ lang }) => <p class="muted">{t(lang, "analytics.buyers_unavailable")}</p>;

// -- the page ----------------------------------------------------------------------------

export async function analyticsIndex(c: Context<AppEnv>): Promise<Response> {
  const access = await analyticsAccess(c);
  if (!access) return c.notFound();
  const lang = c.get("lang");
  const q = (c.req.query("q") ?? "").trim().slice(0, MAX_Q);
  // Each file read on its own, so a missing one leaves its own list empty.
  const [stats, index] = await Promise.all([loadStats(c.env).catch(() => null), loadBuyers(c.env).catch(() => null)]);
  const order = new Intl.Collator(numberLocale(lang));
  const buyers = (index?.buyers ?? []).filter(buyerHasRecords).sort((a, b) => order.compare(buyerName(lang, a), buyerName(lang, b)));
  const dataAsOf = stats?.data_as_of ?? null;
  const free = access !== "pro";
  const lead = t(lang, "analytics.index_lead");

  if (q) {
    const direct = addressedView(q, new Set((index?.buyers ?? []).map((b) => b.id)));
    if (direct) {
      c.header("Cache-Control", "public, max-age=300");
      return c.redirect(direct, 302);
    }
    const terms = searchTerms(q);
    const foundBuyers = matchBuyers(buyers, terms);
    const foundSegments = matchSegments(terms);
    const orgs = terms.terms.length ? await matchOrganizations(c.env, terms) : null;
    // One view in all, every list read: straight there.
    const matched = foundBuyers.length + foundSegments.length + (orgs?.total ?? 0);
    if (index && orgs && matched === 1) {
      const only = foundBuyers[0] ? buyerView(foundBuyers[0].id) : foundSegments[0] ? segmentView(foundSegments[0])
        : orgs.rows[0] ? organizationView(orgs.rows[0].id) : null;
      if (only) {
        c.header("Cache-Control", "public, max-age=300");
        return c.redirect(only, 302);
      }
    }
    const nothing = !!orgs && !!index && matched === 0;
    const shownOrgs = orgs?.rows.slice(0, ORG_MATCHES_SHOWN) ?? [];
    const res = await page(
      c,
      <Layout lang={lang} title={t(lang, "analytics.title")} dataAsOf={dataAsOf} active={ANALYTICS_INDEX_PATH}
        seo={pageSeo("analytics", lang, { noindex: true, title: pageTitle(t(lang, "analytics.title_of", { name: q })) })}>
        <PageHead lang={lang} title={t(lang, "analytics.title")} lead={lead}
          actions={<a href={ANALYTICS_INDEX_PATH} class="btn">{t(lang, "analytics.all_views")}</a>}>
          {free ? <FreeLine lang={lang} /> : null}
          {!terms.terms.length ? <p class="page-note">{t(lang, "search.no_terms")}</p> : null}
          {nothing ? <p class="page-note">{t(lang, "analytics.no_match", { q })}</p> : null}
        </PageHead>
        <FindForm lang={lang} q={q} />
        {!index ? (
          <Panel title={t(lang, "nav.buyers")}><BuyersUnavailable lang={lang} /></Panel>
        ) : foundBuyers.length ? (
          <Panel title={t(lang, "nav.buyers")} count={fmtInt(foundBuyers.length, lang)}><BuyerList lang={lang} rows={foundBuyers} /></Panel>
        ) : null}
        {!terms.terms.length ? null : !orgs ? (
          <Panel title={t(lang, "nav.organizations")}>
            <p class="muted">{tj(lang, "analytics.orgs_unavailable", { directory: directoryLink(lang) })}</p>
          </Panel>
        ) : orgs.total ? (
          <Panel title={t(lang, "nav.organizations")} count={fmtInt(orgs.total, lang)}
            foot={orgs.total > shownOrgs.length ? (
              <span>{tj(lang, "analytics.orgs_more", {
                n: fmtInt(shownOrgs.length, lang), total: fmtInt(orgs.total, lang),
                search: <a href={searchPath(q)}>{t(lang, "analytics.search_page")}</a>,
              })}</span>
            ) : undefined}>
            <OrgList rows={shownOrgs} />
          </Panel>
        ) : null}
        {foundSegments.length ? (
          <Panel title={t(lang, "nav.segments")} count={fmtInt(foundSegments.length, lang)}><SegmentList lang={lang} codes={foundSegments} /></Panel>
        ) : null}
      </Layout>,
    );
    // A list read while the organization search could not answer is not one to keep.
    if (!orgs && terms.terms.length) res.headers.set("Cache-Control", "no-store");
    return res;
  }

  const [own, saved] = await Promise.all([ownOrganization(c), ownViews(c)]);
  const year = todayOf(dataAsOf).slice(0, 4);
  const largest: OrgTotal[] = stats?.top_organizations_year ?? [];
  return page(
    c,
    <Layout lang={lang} title={t(lang, "analytics.title")} dataAsOf={dataAsOf} active={ANALYTICS_INDEX_PATH} seo={pageSeo("analytics", lang)}>
      <PageHead lang={lang} title={t(lang, "analytics.title")} lead={lead}>
        {free ? <FreeLine lang={lang} /> : null}
      </PageHead>
      <FindForm lang={lang} q="" />
      {own ? (
        <Panel title={t(lang, "orgclaim.title")}>
          <ul class="view-list">
            <li><a href={organizationView(own.id)} rel="nofollow">{own.name}</a></li>
            <li><a href="/account/organization">{t(lang, "analytics.yours_page")}</a></li>
          </ul>
        </Panel>
      ) : null}
      {saved ? <SavedViewsPanel lang={lang} views={saved.views} cap={saved.cap} /> : null}
      <Panel title={t(lang, "nav.buyers")} count={index ? fmtInt(buyers.length, lang) : undefined}>
        {index ? <BuyerList lang={lang} rows={buyers} /> : <BuyersUnavailable lang={lang} />}
      </Panel>
      <Panel title={t(lang, "nav.organizations")}>
        <p>{tj(lang, "analytics.orgs_text", { directory: directoryLink(lang) })}</p>
        {largest.length ? <>
          <p class="muted">{t(lang, "analytics.orgs_largest", { year })}</p>
          <OrgList rows={largest} />
        </> : null}
      </Panel>
      <Panel title={t(lang, "nav.segments")} count={fmtInt(SEGMENT_CODES.length, lang)}>
        <SegmentList lang={lang} codes={SEGMENT_CODES} />
      </Panel>
    </Layout>,
  );
}
