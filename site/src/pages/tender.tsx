// /tenders/:reference: one notice as it stands (its newest amendment), its
// amendment history, its codes and the award notices that name the same
// solicitation. The government contact on a notice is never shown here, even
// if a file carried it: the CanadaBuys notice page is the place for it, and
// the page links there.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { REFERENCE_RE, loadStats, loadTender, type TenderDetail } from "../data";
import type { AppEnv } from "../env";
import { categoryLabel, fmtInt, pick, segmentLabel, t, tn, type Key, type Lang } from "../i18n";
import { Breadcrumb, Layout, StatusBadge, lowerRedirect, noDataPage, notFoundPage, page, tenderState, todayOf } from "../layout";
import { tenderSeo } from "../seo";
import { BuyerLink, closingText, money, provincesText, tenderNoticeUrl } from "./shared";

// A field and its value as a definition-list row; an empty value leaves the
// row out rather than printing a blank.
const Row: FC<{ lang: Lang; k: Key; v: unknown }> = ({ lang, k, v }) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) ? null : (
    <>
      <dt>{t(lang, k)}</dt>
      <dd>{v as any}</dd>
    </>
  );

// A bilingual list column in the page language, the other language when the
// page's is empty.
function listOf(lang: Lang, en: readonly string[] | null | undefined, fr: readonly string[] | null | undefined): readonly string[] {
  const mine = lang === "fr" ? fr : en;
  const other = lang === "fr" ? en : fr;
  return mine && mine.length ? mine : other ?? [];
}

const Lines: FC<{ items: readonly string[] }> = ({ items }) =>
  items.length ? <ul class="plain">{items.map((s) => <li>{s}</li>)}</ul> : null;

export async function tenderPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const raw = c.req.param("reference") ?? "";
  if (!REFERENCE_RE.test(raw)) return c.notFound();
  const redirect = lowerRedirect(c, `/tenders/${raw.toLowerCase()}`);
  if (redirect) return redirect;
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "tender.title");
  const d: TenderDetail | null = await loadTender(c.env, raw);
  if (!d) return notFoundPage(c, stats.data_as_of, "tender.not_found", "/tenders", "tender.back");

  const today = todayOf(stats.data_as_of);
  const title = pick(lang, d.title_en, d.title_fr) ?? d.reference;
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "tenders.title"), path: "/tenders" }, { name: d.reference }];
  const description = pick(lang, d.description_en, d.description_fr);
  const versions = [...d.amendments].sort((a, b) => b.amendment - a.amendment);

  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/tenders" seo={tenderSeo(d, lang, crumbs)}>
      <Breadcrumb lang={lang} crumbs={crumbs} />
      <h1>{title}</h1>
      <p class="record-meta">
        <StatusBadge lang={lang} status={tenderState(d.status, d.closing, today)} />{" "}
        <span class="mono id">{d.reference}</span>
        {d.amendment > 0 ? <span class="muted"> {t(lang, "tender.amendment_n", { n: d.amendment })}</span> : null}
      </p>
      <p class="links">
        <a href={tenderNoticeUrl(d.reference, lang)} class="btn btn-primary" rel="noopener">{t(lang, "tender.on_canadabuys")}</a>
      </p>
      <p class="muted small">{t(lang, "tender.contact_note")}</p>

      <div class="cards">
        <section class="card">
          <h2>{t(lang, "tender.dates")}</h2>
          <dl>
            <Row lang={lang} k="col.published" v={d.published} />
            <Row lang={lang} k="col.closing" v={closingText(d.closing)} />
            <Row lang={lang} k="tender.amended" v={d.amended} />
            <Row lang={lang} k="tender.start_expected" v={d.start_expected} />
            <Row lang={lang} k="tender.end_expected" v={d.end_expected} />
          </dl>
          {d.closing ? <p class="muted small">{t(lang, "tender.closing_zone")}</p> : null}
        </section>
        <section class="card">
          <h2>{t(lang, "tender.buyer")}</h2>
          <dl>
            <Row lang={lang} k="col.buyer" v={<BuyerLink lang={lang} id={d.buyer_id} en={d.buyer_en} fr={d.buyer_fr} />} />
            <Row lang={lang} k="tender.end_users" v={<Lines items={listOf(lang, d.end_users_en, d.end_users_fr)} />} />
            <Row lang={lang} k="tender.solicitation" v={d.solicitation ? <span class="mono">{d.solicitation}</span> : null} />
          </dl>
        </section>
      </div>

      <h2>{t(lang, "tender.procurement")}</h2>
      <dl class="wide">
        <Row lang={lang} k="tender.category" v={d.category.map((code) => categoryLabel(lang, code)).join(", ")} />
        <Row lang={lang} k="tender.notice_type" v={pick(lang, d.notice_type_en, d.notice_type_fr)} />
        <Row lang={lang} k="tender.method" v={pick(lang, d.method_en, d.method_fr)} />
        <Row lang={lang} k="tender.selection" v={pick(lang, d.selection_en, d.selection_fr)} />
        <Row lang={lang} k="tender.limited_reason" v={pick(lang, d.limited_reason_en, d.limited_reason_fr)} />
        <Row lang={lang} k="tender.trade_agreements" v={<Lines items={listOf(lang, d.trade_agreements_en, d.trade_agreements_fr)} />} />
        <Row lang={lang} k="tender.regions_opportunity" v={<Lines items={listOf(lang, d.regions_opportunity_en, d.regions_opportunity_fr)} />} />
        <Row lang={lang} k="tender.regions_delivery" v={<Lines items={listOf(lang, d.regions_delivery_en, d.regions_delivery_fr)} />} />
        <Row lang={lang} k="col.region" v={provincesText(lang, d.provinces)} />
        <Row lang={lang} k="tender.gsin" v={d.gsin ? `${d.gsin} ${pick(lang, d.gsin_desc_en, d.gsin_desc_fr) ?? ""}`.trim() : null} />
      </dl>

      {d.codes.length ? (
        <>
          <h2>{t(lang, "tender.codes")}</h2>
          <div class="table-wrap bordered">
            <table class="restack">
              <thead>
                <tr>
                  <th>{t(lang, "col.code")}</th>
                  <th>{t(lang, "col.description")}</th>
                  <th>{t(lang, "col.segment")}</th>
                </tr>
              </thead>
              <tbody>
                {d.codes.map((code) => {
                  const seg = code.code.slice(0, 2);
                  return (
                    <tr>
                      <td data-label={t(lang, "col.code")} class="mono">{code.code}</td>
                      <td data-label={t(lang, "col.description")}>{pick(lang, code.desc_en, code.desc_fr) ?? ""}</td>
                      <td data-label={t(lang, "col.segment")}><a href={`/categories/${seg}`}>{`${seg} ${segmentLabel(lang, seg)}`}</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {description ? (
        <>
          <h2>{t(lang, "tender.description_heading")}</h2>
          <div class="prose">{description.split(/\n{2,}/).map((p) => <p>{p}</p>)}</div>
        </>
      ) : null}

      <h2>{t(lang, "tender.history")}</h2>
      <p class="muted small">{t(lang, "tender.history_note")}</p>
      <div class="table-wrap bordered">
        <table class="restack">
          <thead>
            <tr>
              <th class="num">{t(lang, "col.amendment")}</th>
              <th>{t(lang, "col.published")}</th>
              <th>{t(lang, "tender.amended")}</th>
              <th>{t(lang, "col.closing")}</th>
              <th>{t(lang, "col.title")}</th>
              <th>{t(lang, "tender.first_seen")}</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr>
                <td data-label={t(lang, "col.amendment")} class="mono num">{fmtInt(v.amendment, lang)}</td>
                <td data-label={t(lang, "col.published")} class="mono">{v.published ?? ""}</td>
                <td data-label={t(lang, "tender.amended")} class="mono">{v.amended ?? ""}</td>
                <td data-label={t(lang, "col.closing")} class="mono">{closingText(v.closing)}</td>
                <td data-label={t(lang, "col.title")}>{pick(lang, v.title_en, v.title_fr) ?? ""}</td>
                <td data-label={t(lang, "tender.first_seen")} class="mono">{v.first_seen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{t(lang, "tender.related")}</h2>
      {d.related_awards.length ? (
        <>
          <p class="muted small">{t(lang, "tender.related_note")}</p>
          <div class="table-wrap bordered">
            <table class="restack">
              <thead>
                <tr>
                  <th>{t(lang, "col.awarded")}</th>
                  <th>{t(lang, "col.contract")}</th>
                  <th>{t(lang, "col.organization")}</th>
                  <th class="num">{t(lang, "col.value")}</th>
                </tr>
              </thead>
              <tbody>
                {d.related_awards.map((a) => (
                  <tr>
                    <td data-label={t(lang, "col.awarded")} class="mono">{a.awarded ?? ""}</td>
                    <td data-label={t(lang, "col.contract")}>
                      <a href={`/awards/${a.reference.toLowerCase()}`}>{pick(lang, a.title_en, a.title_fr) ?? a.reference}</a>
                    </td>
                    <td data-label={t(lang, "col.organization")}>
                      {a.organization_id ? <a href={`/organizations/${a.organization_id}`}>{a.organization ?? a.organization_id}</a> : a.organization ?? ""}
                    </td>
                    <td data-label={t(lang, "col.value")} class="mono num">{money(lang, a.value, a.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p class="muted">{t(lang, "tender.related_none")}</p>
      )}

      <p class="muted small top-gap">
        {t(lang, "tender.provenance", { file: d.source_file, first: d.first_seen, last: d.last_seen })}{" "}
        {tn(lang, "tender.versions_one", "tender.versions_many", versions.length, { n: fmtInt(versions.length, lang) })}
      </p>
    </Layout>,
  );
}
