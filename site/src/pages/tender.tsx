// /tenders/:reference: one notice as it stands (its newest amendment), its
// amendment history, its codes and the award notices that name the same
// solicitation. The government contact on a notice is never shown here, even
// if a file carried it: the CanadaBuys notice page is the place for it, and
// the page links there.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { Table } from "../columns";
import { REFERENCE_RE, loadOpenFirst, loadStats, loadTender, publishedReference, type TenderDetail } from "../data";
import { buyerPath } from "../crosslinks";
import type { AppEnv } from "../env";
import { categoryLabel, fmtInt, pick, segmentLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import { clockOf, closesAtUtc, closingTime, tenderState } from "../closing";
import { Layout, PageHead, Panel, StatusBadge, lowerRedirect, noDataPage, notFoundPage, page } from "../layout";
import { tenderSeo } from "../seo";
import {
  BuyerLink, CountdownScript, closingHasZone, closingText, money, otherLanguageMark, provincesText, sourceFileText, tenderNoticeUrl,
} from "./shared";

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

// One item to a line; an empty list is no value, so its row is left out.
function lines(items: readonly string[]): unknown {
  return items.length ? <ul class="plain">{items.map((s) => <li>{s}</li>)}</ul> : null;
}

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

  const clock = clockOf(c.env);
  const state = tenderState(d.status, d.closing, clock);
  // A notice closing soon: the countdown goes under its closing time.
  const closes = state === "closing" ? closesAtUtc(d.closing) : null;
  const notice = closes ? d.reference.toLowerCase() : undefined;
  const shownRef = publishedReference(d);
  const title = pick(lang, d.title_en, d.title_fr) ?? shownRef;
  const crumbs = [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "tenders.title"), path: "/tenders" }, { name: shownRef }];
  const description = pick(lang, d.description_en, d.description_fr);
  const descriptionMark = otherLanguageMark(lang, d.description_en, d.description_fr);
  const versions = [...d.amendments].sort((a, b) => b.amendment - a.amendment);
  const endUsers = listOf(lang, d.end_users_en, d.end_users_fr);
  const buyerName = pick(lang, d.buyer_en, d.buyer_fr);
  // The buyer's open notices, from the facet counts over the open list; this
  // notice alone among them is no lead to follow.
  const facets = d.buyer_id && buyerPath(d.buyer_id) ? (await loadOpenFirst(c.env).catch(() => null))?.facets : null;
  const buyerOpen = facets?.buyer.find((f) => f.value === d.buyer_id)?.n ?? 0;
  const otherOpen = buyerOpen > 1 || (buyerOpen === 1 && state !== "open" && state !== "closing");
  const categories = d.category.map((code) => categoryLabel(lang, code)).join(", ");
  const description_ = description ? (
    <Panel title={descriptionMark ? `${t(lang, "tender.description_heading")} ${descriptionMark}` : t(lang, "tender.description_heading")}>
      <div class="prose">{description.split(/\n{2,}/).map((p) => <p>{p}</p>)}</div>
    </Panel>
  ) : null;

  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active="/tenders" seo={tenderSeo(d, lang, crumbs)}>
      <PageHead lang={lang} crumbs={crumbs} eyebrow={t(lang, "tender.title")} title={title}
        lead={<>
          <StatusBadge lang={lang} status={state} notice={notice} />{" "}
          {[
            d.closing ? t(lang, state === "closed" ? "tender.lead_closed" : "tender.lead_closes", { date: closingText(d.closing, lang) }) : null,
            buyerName ? <BuyerLink lang={lang} id={d.buyer_id} en={d.buyer_en} fr={d.buyer_fr} /> : null,
            categories || null,
          ].filter((x) => x !== null).map((x, i) => <>{i > 0 ? " · " : null}{x}</>)}
        </>}
        actions={<a href={tenderNoticeUrl(shownRef, lang)} class="btn btn-primary" rel="noopener">{t(lang, "tender.on_canadabuys")}</a>}>
        <p class="page-note">
          <span class="mono">{shownRef}</span>
          {d.amendment > 0 ? ` · ${t(lang, "tender.amendment_n", { n: d.amendment })}` : null}
        </p>
        <p class="page-note">{t(lang, "tender.contact_note")}</p>
      </PageHead>

      <div class="panel-grid">
        <Panel title={t(lang, "tender.dates")}>
          <dl>
            <Row lang={lang} k="col.published" v={d.published} />
            {closes ? (
              <>
                <dt>{t(lang, "col.closing")}</dt>
                <dd data-closes={closes} data-time={closingTime(d.closing, lang) ?? undefined} data-notice={notice}>{closingText(d.closing, lang)}</dd>
              </>
            ) : <Row lang={lang} k="col.closing" v={closingText(d.closing, lang)} />}
            <Row lang={lang} k="tender.amended" v={d.amended} />
            <Row lang={lang} k="tender.start_expected" v={d.start_expected} />
            <Row lang={lang} k="tender.end_expected" v={d.end_expected} />
          </dl>
          {d.closing && !closingHasZone(d.closing) ? <p class="muted small">{t(lang, "tender.closing_zone")}</p> : null}
        </Panel>
        <Panel title={t(lang, "tender.buyer")}>
          <dl>
            <Row lang={lang} k="col.buyer" v={<>
              <BuyerLink lang={lang} id={d.buyer_id} en={d.buyer_en} fr={d.buyer_fr} />
              {otherOpen && d.buyer_id ? (
                <span class="nw-block small">
                  <a href={`/tenders?buyer=${d.buyer_id}`}>
                    {tn(lang, "tender.buyer_open_one", "tender.buyer_open_many", buyerOpen, { n: fmtInt(buyerOpen, lang), buyer: buyerName ?? "" })}
                  </a>
                </span>
              ) : null}
            </>} />
            <Row lang={lang} k="tender.end_users" v={endUsers.length ? lines(endUsers) : t(lang, "common.not_stated")} />
            <Row lang={lang} k="tender.solicitation" v={d.solicitation ? <span class="mono">{d.solicitation}</span> : null} />
          </dl>
        </Panel>
      </div>

      {description_}

      <Panel title={t(lang, "tender.procurement")}>
      <dl class="wide">
        <Row lang={lang} k="tender.category" v={d.category.map((code) => categoryLabel(lang, code)).join(", ")} />
        <Row lang={lang} k="tender.notice_type" v={pick(lang, d.notice_type_en, d.notice_type_fr)} />
        <Row lang={lang} k="tender.method" v={pick(lang, d.method_en, d.method_fr)} />
        <Row lang={lang} k="tender.selection" v={pick(lang, d.selection_en, d.selection_fr)} />
        <Row lang={lang} k="tender.limited_reason" v={pick(lang, d.limited_reason_en, d.limited_reason_fr)} />
        <Row lang={lang} k="tender.trade_agreements" v={lines(listOf(lang, d.trade_agreements_en, d.trade_agreements_fr))} />
        <Row lang={lang} k="tender.regions_opportunity" v={lines(listOf(lang, d.regions_opportunity_en, d.regions_opportunity_fr))} />
        <Row lang={lang} k="tender.regions_delivery" v={lines(listOf(lang, d.regions_delivery_en, d.regions_delivery_fr))} />
        <Row lang={lang} k="col.region" v={provincesText(lang, d.provinces)} />
        <Row lang={lang} k="tender.gsin" v={d.gsin ? `${d.gsin} ${pick(lang, d.gsin_desc_en, d.gsin_desc_fr) ?? ""}`.trim() : null} />
      </dl>
      </Panel>

      {d.codes.length ? (
        <Panel title={t(lang, "tender.codes")} count={fmtInt(d.codes.length, lang)}>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "label", label: t(lang, "col.code") },
              { kind: "main", label: t(lang, "col.description") },
              { kind: "text", label: t(lang, "col.segment") },
            ]}>
              <tbody>
                {d.codes.map((code) => {
                  const seg = code.code.slice(0, 2);
                  return (
                    <tr>
                      <td data-label={t(lang, "col.code")} class="mono">{code.code}</td>
                      <td data-label={t(lang, "col.description")}>{pick(lang, code.desc_en, code.desc_fr) ?? ""}</td>
                      <td data-label={t(lang, "col.segment")}><a href={`/segments/${seg}`}>{`${seg} ${segmentLabel(lang, seg)}`}</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </Panel>
      ) : null}

      <Panel title={t(lang, "tender.history")} count={fmtInt(versions.length, lang)}>
      <p class="muted small">{t(lang, "tender.history_note")}</p>
      <div class="table-wrap bordered">
        <Table cols={[
          { kind: "count", label: t(lang, "col.amendment") },
          { kind: "date", label: t(lang, "col.published") },
          { kind: "date", label: t(lang, "tender.amended") },
          { kind: "datetime", label: t(lang, "col.closing") },
          { kind: "main", label: t(lang, "col.title") },
          { kind: "date", label: t(lang, "tender.first_seen") },
        ]}>
          <tbody>
            {versions.map((v) => (
              <tr>
                <td data-label={t(lang, "col.amendment")} class="mono num">{fmtInt(v.amendment, lang)}</td>
                <td data-label={t(lang, "col.published")} class="mono">{v.published ?? ""}</td>
                <td data-label={t(lang, "tender.amended")} class="mono">{v.amended ?? ""}</td>
                <td data-label={t(lang, "col.closing")} class="mono">{closingText(v.closing, lang)}</td>
                <td data-label={t(lang, "col.title")} class="lead-cell">{pick(lang, v.title_en, v.title_fr) ?? ""}</td>
                <td data-label={t(lang, "tender.first_seen")} class="mono">{v.first_seen}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      </Panel>

      <Panel title={t(lang, "tender.related")} count={fmtInt(d.related_awards.length, lang)}>
      {d.related_awards.length ? (
        <>
          <p class="muted small">{t(lang, "tender.related_note")}</p>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "date", label: t(lang, "col.awarded") },
              { kind: "main", label: t(lang, "col.contract") },
              { kind: "org", label: t(lang, "col.supplier") },
              { kind: "value", label: t(lang, "col.value") },
            ]}>
              <tbody>
                {d.related_awards.map((a) => (
                  <tr>
                    <td data-label={t(lang, "col.awarded")} class="mono">{a.awarded ?? ""}</td>
                    <td data-label={t(lang, "col.contract")}>
                      <a href={`/awards/${a.reference.toLowerCase()}`}>{pick(lang, a.title_en, a.title_fr) ?? publishedReference(a)}</a>
                    </td>
                    <td data-label={t(lang, "col.supplier")}>
                      {a.organization_id ? <a href={`/organizations/${a.organization_id}`}>{a.organization ?? a.organization_id}</a> : a.organization ?? ""}
                    </td>
                    <td data-label={t(lang, "col.value")} class="mono num">{money(lang, a.value, a.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      ) : (
        <p class="muted">{t(lang, "tender.related_none")}</p>
      )}
      </Panel>

      <p class="page-foot-note">
        {tj(lang, "tender.provenance", {
          file: <span title={d.source_file}>{sourceFileText(lang, d.source_file)}</span>,
          data: <a href="/data#sources">{t(lang, "nav.data")}</a>, first: d.first_seen, last: d.last_seen,
        })}{" "}
        {tn(lang, "tender.versions_one", "tender.versions_many", versions.length, { n: fmtInt(versions.length, lang) })}
      </p>
      {closes ? <CountdownScript lang={lang} /> : null}
    </Layout>,
  );
}
