// /provinces: the thirteen provinces and territories with the open tender
// notices placed in each (provinces/index.json, the home map's open layer in
// a file of its own). /provinces/:slug: one province's open notices, the
// buyers with the most of them and the UNSPSC segments they carry
// (provinces/<code>.json). A notice is placed by a stated or a derived
// province, as the tender list's province filter reads it with the notices
// that name none left out, so the list a page links
// (/tenders?province=XX&national=0) holds exactly the page's count. A notice
// delivered in several provinces is on each page: the counts overlap and are
// never added up. The address is the province's English name in both
// languages (constants.ts PROVINCE_SLUGS).

import type { Context } from "hono";
import { Table } from "../columns";
import { PROVINCES, PROVINCE_SLUGS, provinceOfSlug } from "../constants";
import { loadProvince, loadProvinces, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, provinceIn, provinceName, segmentLabel, t, tn, type Lang } from "../i18n";
import { clockOf, closingPassed, tenderState } from "../closing";
import { Layout, PageHead, Panel, noDataPage, notFoundPage, page } from "../layout";
import { pageSeo, provinceSeo } from "../seo";
import { InterestPanel, interestFilter } from "./interest";
import { Count, CountdownScript, PhonePagerScript, TenderTable } from "./shared";

// How many open notices a province's page lists, the soonest to close, and
// how many of them a phone shows before the button for the rest; the tender
// list filtered to the province has them all.
export const PROVINCE_OPEN_ROWS = 25;
export const PROVINCE_OPEN_PHONE_ROWS = 10;

const SLUG_RE = /^[a-z]+(?:-[a-z]+)*$/;

// The tender list that holds a province's notices and no other: the notices
// that name no province are left out, as the home map's links leave them.
export const provinceList = (code: string, more = ""): string => `/tenders?province=${code}&national=0${more}`;

const byName = (lang: Lang) => (a: string, b: string) => provinceName(lang, a).localeCompare(provinceName(lang, b), lang);

export async function provincesIndex(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env);
  const counts = stats ? await loadProvinces(c.env) : null;
  if (!stats || !counts) return noDataPage(c, "provinces.title");
  const n = (v: number) => fmtInt(v, lang);
  const open = (code: string) => counts.provinces[code] ?? 0;
  // The provinces with the most open notices first, ties by name.
  const codes = [...PROVINCES].sort((a, b) => open(b) - open(a) || byName(lang)(a, b));
  return page(
    c,
    <Layout lang={lang} title={t(lang, "provinces.title")} dataAsOf={stats.data_as_of} active="/provinces" seo={pageSeo("provinces", lang)}>
      <PageHead lang={lang} title={t(lang, "provinces.title")} lead={t(lang, "provinces.lead")}>
        <p class="page-note">{t(lang, "map.several")}</p>
      </PageHead>
      <Panel title={t(lang, "provinces.panel")} count={n(PROVINCES.length)}>
      <div class="table-wrap bordered">
        <Table restack={false} class="compact" cols={[
          { kind: "main", label: t(lang, "provinces.col_province") },
          { kind: "count", label: t(lang, "segments.col_open") },
        ]}>
          <tbody>
            {codes.map((code) => (
              <tr>
                <td data-label={t(lang, "provinces.col_province")}>
                  <a href={`/provinces/${PROVINCE_SLUGS[code]}`}>{provinceName(lang, code)}</a>
                </td>
                <td data-label={t(lang, "segments.col_open")} class="mono num">
                  {open(code) ? <a href={provinceList(code)}>{n(open(code))}</a> : <Count lang={lang} n={0} />}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      <p class="muted small">
        {counts.not_stated
          ? `${tn(lang, "provinces.not_stated_one", "provinces.not_stated_many", counts.not_stated, { n: n(counts.not_stated) })} `
          : null}
        <a href="/tenders">{t(lang, "provinces.all_open", { n: n(counts.n) })}</a>
      </p>
      </Panel>
    </Layout>,
  );
}

export async function provincePage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const slug = c.req.param("slug") ?? "";
  if (!SLUG_RE.test(slug) || slug.length > 40) return c.notFound();
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "provinces.title");
  const code = provinceOfSlug(slug);
  if (!code) return notFoundPage(c, stats.data_as_of, "province.not_found", "/provinces", "province.back");
  const prov = await loadProvince(c.env, code);
  if (!prov) return noDataPage(c, "provinces.title");
  const where = provinceIn(lang, code);
  const heading = t(lang, "province.heading", { where });
  const crumbs = [
    { name: t(lang, "common.home"), path: "/" }, { name: t(lang, "provinces.panel"), path: "/provinces" }, { name: provinceName(lang, code) },
  ];
  const n = (v: number) => fmtInt(v, lang);
  const clock = clockOf(c.env);
  // An open list: a notice whose closing time has passed goes after the ones still open.
  const open = [...prov.open_notices.filter((r) => !closingPassed(r.closing, clock)), ...prov.open_notices.filter((r) => closingPassed(r.closing, clock))];
  const shown = open.slice(0, PROVINCE_OPEN_ROWS);
  const list = provinceList(code);
  // The email list of the province's new notices: the tender list's own filter, saved from here.
  const interest = await interestFilter(c.env, lang, "tenders", list);
  const lead = prov.open_tenders
    ? tn(lang, "province.lead_one", "province.lead_many", prov.open_tenders, { n: n(prov.open_tenders), where })
    : t(lang, "province.lead_none", { where });
  const first = (shownRows: number, total: number) =>
    total > shownRows ? ` ${t(lang, "province.first", { n: n(shownRows), total: n(total) })}` : "";
  const others = PROVINCES.filter((p) => p !== code).sort(byName(lang));
  return page(
    c,
    <Layout lang={lang} title={heading} dataAsOf={stats.data_as_of} active="/provinces" seo={provinceSeo(code, prov.open_tenders, lang, crumbs)}>
      <PageHead lang={lang} crumbs={crumbs} title={heading} lead={lead}>
        <p class="page-note">{t(lang, "province.note")}</p>
      </PageHead>

      <Panel id="open" title={t(lang, "buyer.open_title")} count={n(prov.open_tenders)}
        foot={prov.open_tenders ? <a href={list} class="btn btn-primary">{t(lang, "segment.all_open", { n: n(prov.open_tenders) })}</a> : undefined}>
      {shown.length && prov.open_tenders > shown.length ? <p class="muted small">{t(lang, "segment.open_first", { n: n(shown.length) })}</p> : null}
      {shown.length ? (
        <TenderTable lang={lang} rows={shown} clock={clock} timeLeft phoneRows={PROVINCE_OPEN_PHONE_ROWS} />
      ) : <p class="muted">{t(lang, "province.open_none", { where })}</p>}
      </Panel>

      {prov.buyers.length || prov.segments.length ? (
        <div class="panel-grid stretch">
          <Panel title={t(lang, "province.buyers")} count={n(prov.n_buyers)}>
          <p class="muted small">{t(lang, "province.buyers_note")}{first(prov.buyers.length, prov.n_buyers)}</p>
          <div class="table-wrap bordered">
            <Table restack={false} class="compact" cols={[
              { kind: "main", label: t(lang, "col.buyer") },
              { kind: "count", label: t(lang, "segments.col_open") },
            ]}>
              <tbody>
                {prov.buyers.map((b) => (
                  <tr>
                    <td data-label={t(lang, "col.buyer")}><a href={`/buyers/${b.id}`}>{pick(lang, b.name_en, b.name_fr) ?? b.id}</a></td>
                    <td data-label={t(lang, "segments.col_open")} class="mono num"><a href={provinceList(code, `&buyer=${b.id}`)}>{n(b.n)}</a></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          </Panel>

          <Panel title={t(lang, "province.segments")} count={n(prov.n_segments)}>
          <p class="muted small">{t(lang, "province.segments_note")}{first(prov.segments.length, prov.n_segments)}</p>
          <div class="table-wrap bordered">
            <Table restack={false} class="compact" cols={[
              { kind: "main", label: t(lang, "col.segment") },
              { kind: "count", label: t(lang, "segments.col_open") },
            ]}>
              <tbody>
                {prov.segments.map((g) => (
                  <tr>
                    <td data-label={t(lang, "col.segment")}>
                      <span class="mono">{g.code}</span> <a href={`/segments/${g.code}`}>{segmentLabel(lang, g.code)}</a>
                    </td>
                    <td data-label={t(lang, "segments.col_open")} class="mono num"><a href={provinceList(code, `&segment=${g.code}`)}>{n(g.n)}</a></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          </Panel>
        </div>
      ) : null}

      <InterestPanel lang={lang} filter={interest} />

      <Panel title={t(lang, "province.others")}>
        <p>
          {others.map((p, i) => <>{i ? ", " : ""}<a href={`/provinces/${PROVINCE_SLUGS[p]}`}>{provinceName(lang, p)}</a></>)}
        </p>
      </Panel>
      {shown.some((r) => tenderState("open", r.closing, clock) === "closing") ? <CountdownScript lang={lang} /> : null}
      {/* The fold of the notices' table on a phone (public/pager.js); a page with no table has nothing to fold. */}
      {shown.length ? <PhonePagerScript lang={lang} /> : null}
    </Layout>,
  );
}
