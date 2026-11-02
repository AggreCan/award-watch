// /search?q=: organizations and buyers by name, from the hosted search
// database (src/search_db.ts). Server-rendered, 50 organizations to a page
// (?page=), the matching buyers on the first page, the query echoed as text.
//
// A query that is exactly an organization id goes to that profile, which
// sends a retired id on to the organization that took its records. With no
// query, or none with a letter or digit, the page says what it searches and
// links the directory. When the database does not answer (no binding, a
// failed query, or no row loaded yet) the page explains, links the directory
// and the buyers list, and answers 503 so nothing keeps it.

import type { Context } from "hono";
import { Table } from "../columns";
import { MONEY_SOURCES } from "../constants";
import { ORG_ID_RE, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, provinceName, sourceLabel, t, tj, tn, type Lang } from "../i18n";
import { Layout, PageHead, Panel, page } from "../layout";
import { BUYER_ROWS, MAX_PAGE, MAX_Q, PAGE_SIZE, type BuyerHit, type Figures, type OrgHit, runSearch, searchTerms } from "../search_db";
import type { Seo } from "../seo";
import { directoryName } from "./organization";
import { money } from "./shared";

export function searchPath(q: string, n = 1): string {
  const params = new URLSearchParams({ q });
  if (n > 1) params.set("page", String(n));
  return `/search?${params.toString()}`;
}

function readPage(raw: string | undefined): number {
  if (!raw || !/^[0-9]{1,4}$/.test(raw)) return 1;
  return Math.min(Math.max(1, Number(raw)), MAX_PAGE);
}

// The search page is never a page to index: every query would be one.
function seo(lang: Lang): Seo {
  return { path: "/search", description: t(lang, "search.description"), noindex: true };
}

// The page's own form, the same GET as the top bar's.
const SearchForm = ({ lang, q }: { lang: Lang; q: string }) => (
  <form method="get" action="/search" class="toolbar" role="search">
    <div class="toolbar-fields">
      <label class="field field-text">
        <span class="field-label">{t(lang, "search.label")}</span>
        <input type="search" name="q" value={q} maxlength={MAX_Q} autocomplete="off" />
      </label>
      <div class="toolbar-actions">
        <button type="submit" class="btn btn-primary">{t(lang, "search.submit")}</button>
      </div>
    </div>
  </form>
);

const links = (lang: Lang) => ({
  directory: <a href="/organizations">{t(lang, "error.not_found_directory")}</a>,
  buyers: <a href="/buyers">{t(lang, "search.buyers_link")}</a>,
});

// A source's count with its total under it, as the buyers list writes them.
function SourceCell({ lang, n, total }: { lang: Lang; n: number; total: number | null }) {
  return (
    <>
      {fmtInt(n, lang)}
      {total ? <><br /><span class="muted small">{money(lang, total)}</span></> : null}
    </>
  );
}

const SOURCE_KEYS: Record<(typeof MONEY_SOURCES)[number], [keyof Figures, keyof Figures]> = {
  awards: ["n_awards", "total_awards"],
  history: ["n_history", "total_history"],
  contracts: ["n_contracts", "total_contracts"],
  grants: ["n_grants", "total_grants"],
};

function sourceCells(lang: Lang, f: Figures) {
  return MONEY_SOURCES.map((s) => {
    const [n, total] = SOURCE_KEYS[s];
    return (
      <td data-label={sourceLabel(lang, s)} class="mono num">
        <SourceCell lang={lang} n={f[n] as number} total={f[total] as number | null} />
      </td>
    );
  });
}

const sourceColumns = (lang: Lang) => MONEY_SOURCES.map((s) => ({ kind: "total" as const, label: sourceLabel(lang, s) }));

function place(lang: Lang, o: OrgHit): string {
  const code = o.prov.toLowerCase();
  const where = code === "xx" || code === "un" ? directoryName(lang, code) : provinceName(lang, o.prov);
  return [o.city, where].filter(Boolean).join(", ");
}

function OrgRow({ lang, o }: { lang: Lang; o: OrgHit }) {
  return (
    <tr>
      <td data-label={t(lang, "col.organization")}>
        <a href={`/organizations/${o.id}`}>{o.name}</a>
        <span class="muted small nw-block">{place(lang, o)}</span>
        {o.also ? <span class="muted small nw-block">{t(lang, "org.also_recorded")} {o.also}</span> : null}
        {o.bn ? <span class="muted small nw-block">{t(lang, "org.business_number", { bn: o.bn })}</span> : null}
      </td>
      <td data-label={t(lang, "col.records")} class="mono num">{fmtInt(o.n_records, lang)}</td>
      {sourceCells(lang, o)}
      <td data-label={t(lang, "search.col_lobbying")} class="mono num lgh">{fmtInt(o.n_lobbying, lang)}</td>
    </tr>
  );
}

function BuyerRow({ lang, b }: { lang: Lang; b: BuyerHit }) {
  const name = pick(lang, b.name, b.name_fr) ?? b.name;
  const acronym = pick(lang, b.acronym_en, b.acronym_fr);
  return (
    <tr>
      <td data-label={t(lang, "col.buyer")}>
        <a href={`/buyers/${b.id}`}>{name}</a>
        {acronym ? <span class="muted"> ({acronym})</span> : null}
        {b.also ? <span class="muted small nw-block">{t(lang, "org.also_recorded")} {b.also}</span> : null}
      </td>
      <td data-label={t(lang, "buyers.col_open")} class="mono num">
        {b.n_open_tenders ? <a href={`/tenders?buyer=${b.id}`}>{fmtInt(b.n_open_tenders, lang)}</a> : fmtInt(0, lang)}
      </td>
      {sourceCells(lang, b)}
    </tr>
  );
}

export async function searchPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const q = (c.req.query("q") ?? "").trim().slice(0, MAX_Q);
  // An organization id, pasted from a link: its profile, which redirects a retired id.
  const id = q.toLowerCase();
  if (ORG_ID_RE.test(id)) {
    c.header("Cache-Control", "public, max-age=300");
    return c.redirect(`/organizations/${id}`, 302);
  }
  const terms = searchTerms(q);
  const wanted = readPage(c.req.query("page"));
  const stats = await loadStats(c.env).catch(() => null);
  const dataAsOf = stats?.data_as_of ?? null;

  if (!terms.terms.length) {
    return page(
      c,
      <Layout lang={lang} title={t(lang, "search.title")} dataAsOf={dataAsOf} seo={seo(lang)} query={q}>
        <PageHead lang={lang} title={t(lang, "search.title")} lead={t(lang, "search.empty_lead")}>
          {q ? <p class="page-note">{t(lang, "search.no_terms")}</p> : null}
        </PageHead>
        <SearchForm lang={lang} q={q} />
        <p class="page-foot-note">{t(lang, "search.what")}</p>
        <p class="page-foot-note">{tj(lang, "search.none_hint", links(lang))}</p>
      </Layout>,
    );
  }

  const title = t(lang, "search.title_q", { q });
  const result = await runSearch(c.env, terms, wanted);
  if (!result) {
    c.header("Retry-After", "300");
    return page(
      c,
      <Layout lang={lang} title={t(lang, "search.unavailable")} dataAsOf={dataAsOf} seo={seo(lang)} query={q}>
        <PageHead lang={lang} title={t(lang, "search.unavailable")} lead={tj(lang, "search.unavailable_text", links(lang))} />
        <SearchForm lang={lang} q={q} />
      </Layout>,
      503,
    );
  }

  const n = (v: number) => fmtInt(v, lang);
  const lead = t(lang, "search.lead", {
    orgs: tn(lang, "search.orgs_one", "search.orgs_many", result.orgTotal, { n: n(result.orgTotal) }),
    buyers: tn(lang, "search.buyers_one", "search.buyers_many", result.buyerTotal, { n: n(result.buyerTotal) }),
  });
  const shownPage = result.page;
  const from = (shownPage - 1) * PAGE_SIZE + 1;
  const to = (shownPage - 1) * PAGE_SIZE + result.orgs.length;
  const prev = shownPage > 1 ? searchPath(q, shownPage - 1) : null;
  const next = shownPage < result.pages ? searchPath(q, shownPage + 1) : null;
  const capped = result.orgTotal > MAX_PAGE * PAGE_SIZE;

  if (result.orgTotal + result.buyerTotal === 0) {
    return page(
      c,
      <Layout lang={lang} title={title} dataAsOf={dataAsOf} seo={seo(lang)} query={q}>
        <PageHead lang={lang} title={title} lead={t(lang, "search.none", { q })}>
          <p class="page-note">{tj(lang, "search.none_hint", links(lang))}</p>
        </PageHead>
        <SearchForm lang={lang} q={q} />
        <p class="page-foot-note">{t(lang, "search.what")}</p>
      </Layout>,
    );
  }

  const buyersPanel = shownPage === 1 && result.buyers.length ? (
    <Panel title={t(lang, "nav.buyers")}
      count={result.buyerTotal > result.buyers.length ? t(lang, "search.buyers_shown", { n: n(result.buyers.length), total: n(result.buyerTotal) }) : n(result.buyerTotal)}
      foot={result.buyerTotal > BUYER_ROWS ? <span>{t(lang, "search.buyers_narrow")}</span> : undefined}>
      <div class="table-wrap bordered">
        <Table cols={[
          { kind: "main", label: t(lang, "col.buyer") },
          { kind: "count", label: t(lang, "buyers.col_open") },
          ...sourceColumns(lang),
        ]}>
          <tbody>
            {result.buyers.map((b) => <BuyerRow lang={lang} b={b} />)}
          </tbody>
        </Table>
      </div>
    </Panel>
  ) : null;

  const pager = result.pages > 1 || capped ? (
    <nav aria-label={t(lang, "common.pagination")} class="pagination">
      <span class="muted">
        {t(lang, "tenders.page_of", { page: n(shownPage), pages: n(result.pages) })}
        {capped ? <> · {t(lang, "search.page_cap", { n: n(MAX_PAGE * PAGE_SIZE) })}</> : null}
      </span>
      <span class="pages">
        {prev ? <a href={prev} class="btn" rel="prev">{t(lang, "tenders.prev")}</a> : null}
        {next ? <a href={next} class="btn" rel="next">{t(lang, "tenders.next")}</a> : null}
      </span>
    </nav>
  ) : undefined;

  const orgsPanel = result.orgTotal > 0 ? (
    <Panel title={t(lang, "nav.organizations")}
      count={t(lang, "search.range", { from: n(from), to: n(to), total: n(result.orgTotal) })} foot={pager}>
      <div class="table-wrap bordered">
        <Table cols={[
          { kind: "main", label: t(lang, "col.organization") },
          { kind: "count", label: t(lang, "col.records") },
          ...sourceColumns(lang),
          { kind: "count", label: t(lang, "search.col_lobbying"), rest: "lg" },
        ]}>
          <tbody>
            {result.orgs.map((o) => <OrgRow lang={lang} o={o} />)}
          </tbody>
        </Table>
      </div>
    </Panel>
  ) : (
    <Panel title={t(lang, "nav.organizations")} count={n(0)}>
      <p class="muted">{t(lang, "search.no_orgs")}</p>
    </Panel>
  );

  return page(
    c,
    <Layout lang={lang} title={shownPage > 1 ? `${title}, ${t(lang, "common.page_n", { n: n(shownPage) })}` : title}
      dataAsOf={dataAsOf} seo={seo(lang)} query={q}>
      <PageHead lang={lang} title={title} lead={lead}>
        <p class="page-note">{t(lang, "search.what")}</p>
      </PageHead>
      {buyersPanel}
      {shownPage > 1 && result.buyerTotal > 0 ? <p class="page-foot-note">{t(lang, "search.buyers_first_page")}</p> : null}
      {orgsPanel}
    </Layout>,
  );
}
