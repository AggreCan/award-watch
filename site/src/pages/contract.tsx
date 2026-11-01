// /awards/:reference and /history/:reference: one award notice or one PSPC
// contract history record, at its newest amendment, with its amendments and
// codes, from the shared contracts/<abc>.json shards. An award notice links
// to its CanadaBuys page; a contract history record has no page of its own
// there, so it links to the dataset it was read from. Contact fields are
// never shown.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { Table } from "../columns";
import { REFERENCE_RE, loadContract, loadStats, publishedReference, type ContractDetail } from "../data";
import type { AppEnv } from "../env";
import { categoryLabel, fmtInt, pick, provinceName, segmentLabel, statusLabel, t, type Key, type Lang } from "../i18n";
import { CompetitiveFlag, Layout, PageHead, Panel, StatusBadge, lowerRedirect, noDataPage, notFoundPage, page } from "../layout";
import { contractSeo } from "../seo";
import { BuyerLink, awardNoticeUrl, datasetUrl, money, provincesText } from "./shared";

const Row: FC<{ lang: Lang; k: Key; v: unknown }> = ({ lang, k, v }) =>
  v === null || v === undefined || v === "" ? null : (
    <>
      <dt>{t(lang, k)}</dt>
      <dd>{v as any}</dd>
    </>
  );

function listOf(lang: Lang, en: readonly string[] | null | undefined, fr: readonly string[] | null | undefined): string {
  const mine = lang === "fr" ? fr : en;
  const other = lang === "fr" ? en : fr;
  return (mine && mine.length ? mine : other ?? []).join("; ");
}

export async function contractPage(c: Context<AppEnv>, kind: "award" | "history", raw: string): Promise<Response> {
  const lang = c.get("lang");
  if (!REFERENCE_RE.test(raw)) return c.notFound();
  const base = kind === "award" ? "/awards" : "/history";
  const redirect = lowerRedirect(c, `${base}/${raw.toLowerCase()}`);
  if (redirect) return redirect;
  const titleKey: Key = kind === "award" ? "contract.title_award" : "contract.title_history";
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, titleKey);
  const d: ContractDetail | null = await loadContract(c.env, kind, raw);
  if (!d) {
    return notFoundPage(c, stats.data_as_of, kind === "award" ? "contract.award_not_found" : "contract.history_not_found",
      kind === "award" ? "/awards" : "/", kind === "award" ? "awards.back" : "common.back_home");
  }
  const shownRef = publishedReference(d);
  const title = pick(lang, d.title_en, d.title_fr) ?? shownRef;
  const crumbs = kind === "award"
    ? [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "awards.title"), path: "/awards" }, { name: shownRef }]
    : [{ name: t(lang, "common.home"), path: "/" }, { name: t(lang, "contract.title_history") }, { name: shownRef }];
  const supplierPlace = [d.supplier_city, d.supplier_province ? provinceName(lang, d.supplier_province) : null,
    d.supplier_country && d.supplier_country !== "CA" ? d.supplier_country : null].filter(Boolean).join(", ");
  const versions = [...d.amendments].sort((a, b) => b.amendment - a.amendment);
  const description = pick(lang, d.description_en, d.description_fr);
  const nonCad = d.currency && d.currency !== "CAD";

  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} active={kind === "award" ? "/awards" : undefined} seo={contractSeo(d, lang, crumbs)}>
      <PageHead lang={lang} crumbs={crumbs} eyebrow={t(lang, titleKey)} title={title}
        lead={<>
          <StatusBadge lang={lang} status={d.status} /> <span class="mono id">{shownRef}</span>{" "}
          <CompetitiveFlag lang={lang} value={d.competitive} />
        </>}
        actions={<>
          {kind === "award" ? (
            <a href={awardNoticeUrl(shownRef, lang)} class="btn btn-primary" rel="noopener">{t(lang, "contract.on_canadabuys")}</a>
          ) : (
            <a href={datasetUrl("history", lang)} class="btn btn-primary" rel="noopener">{t(lang, "contract.history_dataset")}</a>
          )}
          {d.tender_reference ? <a href={`/tenders/${d.tender_reference.toLowerCase()}`} class="btn">{t(lang, "contract.tender_link")}</a> : null}
        </>} />

      <div class="panel-grid">
        <Panel title={t(lang, "contract.parties")}>
          <dl>
            <Row lang={lang} k="contract.supplier" v={d.organization_id ? <a href={`/organizations/${d.organization_id}`}>{d.supplier ?? d.organization_id}</a> : d.supplier} />
            <Row lang={lang} k="contract.operating_name" v={d.supplier_operating} />
            <Row lang={lang} k="contract.supplier_place" v={supplierPlace} />
            <Row lang={lang} k={kind === "history" ? "contract.contracting" : "col.buyer"} v={<BuyerLink lang={lang} id={d.buyer_id} en={d.buyer_en} fr={d.buyer_fr} />} />
            {kind === "history" ? (
              <Row lang={lang} k="col.client" v={d.client_en || d.client_fr ? <BuyerLink lang={lang} id={d.client_id ?? null} en={d.client_en ?? null} fr={d.client_fr ?? null} /> : null} />
            ) : (
              <Row lang={lang} k="tender.end_users" v={listOf(lang, d.end_users_en, d.end_users_fr)} />
            )}
          </dl>
        </Panel>
        <Panel title={t(lang, "contract.value")}>
          <dl>
            <Row lang={lang} k="contract.value_counted" v={money(lang, d.value, d.currency)} />
            <Row lang={lang} k="contract.total_value" v={d.total_value === null ? null : money(lang, d.total_value, d.currency)} />
            <Row lang={lang} k="contract.amount" v={d.amount === null ? null : money(lang, d.amount, d.currency)} />
          </dl>
          <p class="muted small">{t(lang, d.status === "cancelled" ? "contract.value_cancelled" : "contract.value_note")}</p>
          {nonCad ? <p class="muted small">{t(lang, "contract.non_cad", { currency: d.currency ?? "" })}</p> : null}
        </Panel>
      </div>

      <Panel title={t(lang, "contract.details")}>
      <dl class="wide">
        <Row lang={lang} k="col.awarded" v={d.awarded} />
        <Row lang={lang} k="col.published" v={d.published} />
        <Row lang={lang} k="tender.amended" v={d.amended} />
        <Row lang={lang} k="contract.start" v={d.start} />
        <Row lang={lang} k="contract.end" v={d.end} />
        <Row lang={lang} k="contract.number" v={d.contract_number ? <span class="mono">{d.contract_number}</span> : null} />
        <Row lang={lang} k="contract.procurement_number" v={d.procurement_number ? <span class="mono">{d.procurement_number}</span> : null} />
        <Row lang={lang} k="tender.solicitation" v={d.solicitation ? <span class="mono">{d.solicitation}</span> : null} />
        <Row lang={lang} k="contract.instrument" v={pick(lang, d.instrument_type_en, d.instrument_type_fr)} />
        <Row lang={lang} k="contract.amendment_type" v={pick(lang, d.amendment_type_en, d.amendment_type_fr)} />
        <Row lang={lang} k="tender.category" v={d.category.map((code) => categoryLabel(lang, code)).join(", ")} />
        <Row lang={lang} k="tender.notice_type" v={pick(lang, d.notice_type_en, d.notice_type_fr)} />
        <Row lang={lang} k="tender.method" v={pick(lang, d.method_en, d.method_fr)} />
        <Row lang={lang} k="tender.selection" v={pick(lang, d.selection_en, d.selection_fr)} />
        <Row lang={lang} k="tender.limited_reason" v={pick(lang, d.limited_reason_en, d.limited_reason_fr)} />
        <Row lang={lang} k="tender.trade_agreements" v={listOf(lang, d.trade_agreements_en, d.trade_agreements_fr)} />
        <Row lang={lang} k="tender.regions_delivery" v={listOf(lang, d.regions_delivery_en, d.regions_delivery_fr)} />
        <Row lang={lang} k="col.region" v={provincesText(lang, d.provinces)} />
        <Row lang={lang} k="tender.gsin" v={d.gsin ? `${d.gsin} ${pick(lang, d.gsin_desc_en, d.gsin_desc_fr) ?? ""}`.trim() : null} />
      </dl>
      </Panel>

      {d.codes.length ? (
        <Panel title={t(lang, "tender.codes")} count={fmtInt(d.codes.length, lang)}>
          <ul class="plain">
            {d.codes.map((code) => (
              <li>
                <span class="mono">{code.code}</span> {pick(lang, code.desc_en, code.desc_fr) ?? ""}{" "}
                <a href={`/categories/${code.code.slice(0, 2)}`} class="muted small">{segmentLabel(lang, code.code.slice(0, 2))}</a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {description ? (
        <Panel title={t(lang, "tender.description_heading")}>
          <div class="prose">{description.split(/\n{2,}/).map((p) => <p>{p}</p>)}</div>
        </Panel>
      ) : null}

      <Panel title={t(lang, "contract.amendments")} count={fmtInt(versions.length, lang)}>
      <div class="table-wrap bordered">
        <Table cols={[
          { kind: "count", label: t(lang, "col.amendment") },
          { kind: "date", label: t(lang, "tender.amended") },
          { kind: "main", label: t(lang, "contract.amendment_type") },
          { kind: "value", label: t(lang, "contract.amount") },
          { kind: "value", label: t(lang, "contract.total_value") },
          { kind: "label", label: t(lang, "col.status") },
        ]}>
          <tbody>
            {versions.map((v) => (
              <tr>
                <td data-label={t(lang, "col.amendment")} class="mono num">{fmtInt(v.amendment, lang)}</td>
                <td data-label={t(lang, "tender.amended")} class="mono">{v.amended ?? ""}</td>
                <td data-label={t(lang, "contract.amendment_type")}>{pick(lang, v.amendment_type_en, v.amendment_type_fr) ?? ""}</td>
                <td data-label={t(lang, "contract.amount")} class="mono num">{v.amount === null ? "" : money(lang, v.amount, d.currency)}</td>
                <td data-label={t(lang, "contract.total_value")} class="mono num">{v.total_value === null ? "" : money(lang, v.total_value, d.currency)}</td>
                <td data-label={t(lang, "col.status")}>{v.status ? statusLabel(lang, v.status) : ""}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      </Panel>

      <p class="page-foot-note">{t(lang, "tender.provenance", { file: d.source_file, first: d.first_seen, last: d.last_seen })}</p>
    </Layout>,
  );
}
