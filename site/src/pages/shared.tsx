// Pieces several pages render the same way: the tender and award tables,
// the organization totals, money in its currency, and the links to the
// government's own record of each row.

import type { FC } from "hono/jsx";
import type { AwardRow, OrgTotal, TenderRow } from "../data";
import { buyerPath } from "../crosslinks";
import { fmtInt, fmtMoney, pick, provinceName, segmentLabel, t, type Key, type Lang } from "../i18n";
import { CompetitiveFlag, StatusBadge, tenderState } from "../layout";

// -- links to the record ---------------------------------------------------------

// CanadaBuys serves each notice in English and, on its French host
// (AchatsCanada), in French; a lower-cased reference works on both, and each
// page links the notice in its own language.
export function tenderNoticeUrl(reference: string, lang: Lang = "en"): string {
  const ref = encodeURIComponent(reference.toLowerCase());
  return lang === "fr"
    ? `https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/${ref}`
    : `https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${ref}`;
}

export function awardNoticeUrl(reference: string, lang: Lang = "en"): string {
  const ref = encodeURIComponent(reference.toLowerCase());
  return lang === "fr"
    ? `https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/${ref}`
    : `https://canadabuys.canada.ca/en/tender-opportunities/award-notice/${ref}`;
}

// The open-data datasets behind each source, in the page's language.
const DATASET_IDS: Record<string, string> = {
  tenders: "6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2",
  awards: "a1acb126-9ce8-40a9-b889-5da2b1dd20cb",
  history: "4fe645a1-ffcd-40c1-9385-2c771be956a4",
  contracts: "d8f85d91-7dec-4fd1-8055-483b77225d8b",
  grants: "432527ab-7aac-45b5-81d6-7597107a7013",
  lobbying: "a34eb330-7136-4f5e-9f5f-3ba41df58b06",
};

const DATASET_NAME: Record<string, Key> = {
  tenders: "source.dataset.tenders",
  awards: "source.dataset.awards",
  history: "source.dataset.history",
  contracts: "source.dataset.contracts",
  grants: "source.dataset.grants",
  lobbying: "source.dataset.lobbying",
};

export function datasetUrl(source: string, lang: Lang): string {
  const id = DATASET_IDS[source] ?? DATASET_IDS.awards;
  return `https://open.canada.ca/data/${lang === "fr" ? "fr" : "en"}/dataset/${id}`;
}

// A published contract: the government's contracts search with the reference
// number as the query (a reference is unique within one department only, so
// the result list may hold more than one row).
export function contractSearchUrl(reference: string): string {
  return `https://search.open.canada.ca/contracts/?search_text=${encodeURIComponent(reference)}`;
}

// A grant or contribution: the record page in the government's grants
// search, in the form its own result links use: department, reference number
// and "current" (the agreement as last amended), joined by commas as one path
// segment.
export function grantUrl(ownerOrg: string, reference: string): string {
  return `https://search.open.canada.ca/grants/record/${encodeURIComponent(`${ownerOrg},${reference},current`)}`;
}

// A communication report in the Registry of Lobbyists' public view.
export function lobbyUrl(commNumber: string): string {
  return `https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/cmmLgPblcVw?comlogId=${encodeURIComponent(commNumber)}`;
}

// -- small formats ------------------------------------------------------------------

// An amount in its own currency; a missing amount reads "not stated".
export function money(lang: Lang, value: number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined) return t(lang, "common.not_stated");
  return fmtMoney(value, lang, currency);
}

// "2026-11-26T14:00:00" as published: the date and the time, no zone.
export function closingText(closing: string | null): string {
  if (!closing) return "";
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(closing);
  return m ? (m[2] ? `${m[1]} ${m[2]}` : m[1]) : closing;
}

export function provincesText(lang: Lang, provinces: readonly string[]): string {
  return provinces.length ? provinces.map((p) => provinceName(lang, p)).join(", ") : t(lang, "common.national");
}

export const BuyerLink: FC<{ lang: Lang; id: string | null; en: string | null; fr: string | null }> = ({ lang, id, en, fr }) => {
  const name = pick(lang, en, fr) ?? t(lang, "common.not_stated");
  const href = buyerPath(id);
  return href ? <a href={href}>{name}</a> : <>{name}</>;
};

export const SegmentChips: FC<{ lang: Lang; codes: readonly string[] }> = ({ lang, codes }) => (
  <>
    {codes.map((code) => (
      <a href={`/categories/${code}`} class="chip" title={segmentLabel(lang, code)}>{code}</a>
    ))}
  </>
);

// -- tables ---------------------------------------------------------------------------

export const TenderTable: FC<{ lang: Lang; rows: readonly TenderRow[]; today: string; status?: boolean }> = ({ lang, rows, today, status }) => (
  <div class="table-wrap bordered">
    <table class="restack">
      <thead>
        <tr>
          <th>{t(lang, "col.notice")}</th>
          <th>{t(lang, "col.buyer")}</th>
          <th>{t(lang, "col.closing")}</th>
          <th>{t(lang, "col.published")}</th>
          <th>{t(lang, "col.region")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr>
            <td data-label={t(lang, "col.notice")}>
              <a href={`/tenders/${r.reference.toLowerCase()}`}>{pick(lang, r.title_en, r.title_fr) ?? r.reference}</a>
              <br />
              <span class="mono id muted">{r.reference}</span> <SegmentChips lang={lang} codes={r.segments} />
            </td>
            <td data-label={t(lang, "col.buyer")}><BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} /></td>
            <td data-label={t(lang, "col.closing")} class="mono">
              {closingText(r.closing)}{" "}
              <StatusBadge lang={lang} status={tenderState(status ? r.status ?? "open" : "open", r.closing, today)} />
            </td>
            <td data-label={t(lang, "col.published")} class="mono">{r.published ?? ""}</td>
            <td data-label={t(lang, "col.region")}>{provincesText(lang, r.provinces)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// Award notices and contract history rows. href is the record page's
// prefix (/awards or /history); on history rows the buyer is the client
// department.
export const AwardTable: FC<{ lang: Lang; rows: readonly AwardRow[]; href?: string; organization?: boolean; buyer?: boolean }> = ({
  lang, rows, href = "/awards", organization = true, buyer = true,
}) => (
  <div class="table-wrap bordered">
    <table class="restack">
      <thead>
        <tr>
          <th>{t(lang, "col.awarded")}</th>
          <th>{t(lang, "col.contract")}</th>
          {organization ? <th>{t(lang, "col.organization")}</th> : null}
          {buyer ? <th>{t(lang, href === "/history" ? "col.client" : "col.buyer")}</th> : null}
          <th class="num">{t(lang, "col.value")}</th>
          <th>{t(lang, "col.method")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr>
            <td data-label={t(lang, "col.awarded")} class="mono">{r.awarded ?? ""}</td>
            <td data-label={t(lang, "col.contract")}>
              <a href={`${href}/${r.reference.toLowerCase()}`}>{pick(lang, r.title_en, r.title_fr) ?? r.reference}</a>
              <br />
              <span class="mono id muted">{r.reference}</span>
              {r.status === "cancelled" ? <> <StatusBadge lang={lang} status="cancelled" /></> : null}
            </td>
            {organization ? (
              <td data-label={t(lang, "col.organization")}>
                {r.organization_id ? <a href={`/organizations/${r.organization_id}`}>{r.organization ?? r.organization_id}</a> : r.organization ?? ""}
              </td>
            ) : null}
            {buyer ? (
              <td data-label={t(lang, href === "/history" ? "col.client" : "col.buyer")}>
                <BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} />
              </td>
            ) : null}
            <td data-label={t(lang, "col.value")} class="mono num">{money(lang, r.value, r.currency)}</td>
            <td data-label={t(lang, "col.method")}><CompetitiveFlag lang={lang} value={r.competitive} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// Organizations with their total in one source, ranked as the file ranks them.
export const OrgTotalTable: FC<{ lang: Lang; rows: readonly OrgTotal[]; rank?: boolean }> = ({ lang, rows, rank }) => (
  <div class="table-wrap bordered">
    <table class="restack">
      <thead>
        <tr>
          {rank ? <th class="num">{t(lang, "col.rank")}</th> : null}
          <th>{t(lang, "col.organization")}</th>
          <th class="num">{t(lang, "col.records")}</th>
          <th class="num">{t(lang, "col.value")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr>
            {rank ? <td data-label={t(lang, "col.rank")} class="mono num">{fmtInt(i + 1, lang)}</td> : null}
            <td data-label={t(lang, "col.organization")}>
              <a href={`/organizations/${r.id}`}>{r.name}</a>
              {r.province ? <span class="muted small"> {provinceName(lang, r.province)}</span> : null}
            </td>
            <td data-label={t(lang, "col.records")} class="mono num">{fmtInt(r.n, lang)}</td>
            <td data-label={t(lang, "col.value")} class="mono num">{money(lang, r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// The line under every record list: where the rows come from.
export const SourceLine: FC<{ lang: Lang; source: string; extra?: unknown }> = ({ lang, source, extra }) => (
  <p class="muted small">
    {t(lang, "common.source")}{lang === "fr" ? "\u202f: " : ": "}
    <a href={datasetUrl(source, lang)}>{t(lang, DATASET_NAME[source] ?? "source.dataset.awards")}</a>
    {extra ? <> {extra}</> : null}
  </p>
);
