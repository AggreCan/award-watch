// /organizations: the directory's front page, one entry per province and
// territory plus addresses outside Canada (xx) and records with no usable
// address (un). /organizations/directory/:code[/:n]: that directory A to Z,
// 200 to a page. Until hosted search ships, this is how a reader finds an
// organization that no tender, award, buyer or ranking page lists.
//
// A page reads two small files the export writes: the directory's index
// (counts, each page's first and last name, the page on which each initial
// starts) and the page's own rows.

import type { Context } from "hono";
import { DIRECTORY_CODES } from "../constants";
import { directoryPath, loadDirectories } from "../crosslinks";
import { loadDirectoryPage, loadDirectoryPart, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, t, tn } from "../i18n";
import { Layout, PageHead, Panel, lowerRedirect, noDataPage, notFoundPage, page } from "../layout";
import { canonicalUrl, pageSeo, sectionSeo } from "../seo";
import { directoryName } from "./organization";

export async function organizationsIndex(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const directories = stats ? await loadDirectories(c.env) : null;
  if (!stats || !directories) return noDataPage(c, "directory.index_title");
  const listed = DIRECTORY_CODES.map((code) => directories.get(code)).filter((d) => d !== undefined);
  const total = listed.reduce((sum, d) => sum + d.organizations, 0);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "directory.index_title")} dataAsOf={stats.data_as_of} active="/organizations" seo={pageSeo("organizations", lang)}>
      <PageHead lang={lang} title={t(lang, "directory.index_title")} lead={t(lang, "directory.index_lead", { n: fmtInt(total, lang) })}
        actions={<a href="/downloads/organizations.csv" class="btn">{t(lang, "tenders.csv")}</a>}>
        <p class="page-note">{t(lang, "directory.index_note")}</p>
      </PageHead>
      <Panel title={t(lang, "directory.col_place")} count={fmtInt(total, lang)}
        foot={<span><a href="/rankings">{t(lang, "directory.to_rankings")}</a> · <a href="/buyers">{t(lang, "directory.to_buyers")}</a></span>}>
      <div class="table-wrap bordered narrow">
        <table class="restack">
          <thead>
            <tr>
              <th>{t(lang, "directory.col_place")}</th>
              <th class="num">{t(lang, "directory.col_organizations")}</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((d) => (
              <tr>
                <td data-label={t(lang, "directory.col_place")}>
                  {d.pages > 0 ? <a href={directoryPath(d.code)}>{directoryName(lang, d.code)}</a> : directoryName(lang, d.code)}
                </td>
                <td data-label={t(lang, "directory.col_organizations")} class="mono num">{fmtInt(d.organizations, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </Panel>
    </Layout>,
  );
}

export async function directoryPage(c: Context<AppEnv>): Promise<Response> {
  const raw = c.req.param("code") ?? "";
  const rawPage = c.req.param("page");
  const code = raw.toLowerCase();
  if (!DIRECTORY_CODES.includes(code)) return c.notFound();
  if (rawPage !== undefined && !/^[0-9]{1,6}$/.test(rawPage)) return c.notFound();
  const n = rawPage === undefined ? 1 : Number(rawPage);
  if (n < 1) return c.notFound();
  // Lower case, no leading zeros, and page 1 without its number.
  const redirect = lowerRedirect(c, directoryPath(code, n));
  if (redirect) return redirect;

  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "directory.index_title");
  const idx = await loadDirectoryPart(c.env, code);
  if (!idx) return noDataPage(c, "directory.index_title");
  const fmt = (v: number) => fmtInt(v, lang);
  const place = directoryName(lang, code);
  const heading = t(lang, "directory.heading", { place });
  const crumbsBase = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "nav.organizations"), path: "/organizations" }];

  // A directory with nobody in it yet: the page says so and stays out of the index.
  if (idx.pages === 0) {
    if (n !== 1) return notFoundPage(c, stats.data_as_of, "directory.not_found", directoryPath(code), "directory.back");
    const none = t(lang, "directory.none", { place });
    return page(
      c,
      <Layout lang={lang} title={heading} dataAsOf={stats.data_as_of} active="/organizations"
        seo={sectionSeo(directoryPath(code), heading, none, [...crumbsBase, { name: place }], true)}>
        <PageHead lang={lang} crumbs={[...crumbsBase, { name: place }]} title={heading} lead={none} />
      </Layout>,
    );
  }
  if (n > idx.pages) return notFoundPage(c, stats.data_as_of, "directory.not_found", directoryPath(code), "directory.back");
  const file = await loadDirectoryPage(c.env, code, n);
  if (!file) return noDataPage(c, "directory.index_title");

  const [first, last] = idx.ranges[n - 1];
  const title = idx.pages > 1 ? t(lang, "directory.title_paged", { heading, n: fmt(n), pages: fmt(idx.pages) }) : heading;
  const path = directoryPath(code, n);
  const description = t(lang, "directory.description", { place, first, last });
  const crumbs = [
    ...crumbsBase,
    ...(n === 1 ? [{ name: place }] : [{ name: place, path: directoryPath(code) }, { name: t(lang, "common.page_n", { n: fmt(n) }) }]),
  ];
  const prev = n > 1 ? directoryPath(code, n - 1) : null;
  const next = n < idx.pages ? directoryPath(code, n + 1) : null;
  // The neighbouring pages in the head as well as in the pager, each in the
  // page's own language, as the canonical URL is.
  const head = (
    <>
      {prev ? <link rel="prev" href={canonicalUrl(prev, lang)} /> : null}
      {next ? <link rel="next" href={canonicalUrl(next, lang)} /> : null}
    </>
  );

  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/organizations" seo={sectionSeo(path, title, description, crumbs)} head={head}>
      <PageHead lang={lang} crumbs={crumbs} title={title}
        lead={tn(lang, "directory.lead_one", "directory.lead_many", idx.organizations, { n: fmt(idx.organizations), place, size: fmt(idx.page_size) })}>
        <p class="page-note">{t(lang, "directory.records_note")}</p>
      </PageHead>
      <nav aria-label={t(lang, "directory.letters")} class="toolbar">
        <span class="toolbar-label">{t(lang, "directory.letters")}</span>
        <ul class="quick-links">
          {idx.letters.map(([letter, at]) => (
            <li><a href={directoryPath(code, at)} aria-current={at === n ? "page" : undefined}>{letter}</a></li>
          ))}
        </ul>
      </nav>
      <Panel title={place} count={t(lang, "directory.range", { first, last })}
        foot={<nav aria-label={t(lang, "common.pagination")} class="pagination">
          <span class="muted">{t(lang, "tenders.page_of", { page: fmt(n), pages: fmt(idx.pages) })}</span>
          <span class="pages">
            {prev ? <a href={prev} class="btn" rel="prev">{t(lang, "tenders.prev")}</a> : null}
            {next ? <a href={next} class="btn" rel="next">{t(lang, "tenders.next")}</a> : null}
          </span>
        </nav>}>
      <div class="table-wrap bordered">
        <table class="restack">
          <thead>
            <tr>
              <th>{t(lang, "col.organization")}</th>
              <th>{t(lang, "col.city")}</th>
              <th class="num">{t(lang, "col.records")}</th>
              <th>{t(lang, "directory.col_last_seen")}</th>
            </tr>
          </thead>
          <tbody>
            {file.rows.map((r) => (
              <tr>
                <td data-label={t(lang, "col.organization")}><a href={`/organizations/${r.id}`}>{r.name}</a></td>
                <td data-label={t(lang, "col.city")}>{r.city ?? <span class="muted">{t(lang, "common.na")}</span>}</td>
                <td data-label={t(lang, "col.records")} class="mono num">{fmt(r.n_records)}</td>
                <td data-label={t(lang, "directory.col_last_seen")} class="mono">{r.last_seen ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </Panel>
      {idx.pages > 1 ? (
        <nav aria-label={t(lang, "directory.pages")} class="toolbar">
          <span class="toolbar-label">{t(lang, "directory.pages")}</span>
          <ul class="quick-links">
            {idx.ranges.map(([from, to], i) => (
              <li>
                {i + 1 === n
                  ? <span class="mono" aria-current="page">{fmt(i + 1)}</span>
                  : <a href={directoryPath(code, i + 1)} class="mono" title={`${from} … ${to}`}>{fmt(i + 1)}</a>}
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </Layout>,
  );
}
