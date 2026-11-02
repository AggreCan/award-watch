// Pieces several pages render the same way: the tender and award tables,
// the organization totals, money in its currency, and the links to the
// government's own record of each row.

import type { FC, PropsWithChildren } from "hono/jsx";
import { type Column, type Rest, Table, restClass } from "../columns";
import { MONEY_SOURCES, type MoneySource } from "../constants";
import { type AwardRow, type OrgTotal, type TenderRow, publishedReference } from "../data";
import { buyerPath } from "../crosslinks";
import { fmtInt, fmtMoney, fmtPct, pick, provinceName, segmentLabel, segmentShort, sourceLabel, t, tj, type Key, type Lang } from "../i18n";
import { type Clock, closesAtUtc, closingText, closingTime, tenderState } from "../closing";
import { ClientData, CompetitiveFlag, StatusBadge } from "../layout";

// -- links to the record ---------------------------------------------------------

// CanadaBuys serves each notice in English and, on its French host
// (AchatsCanada), in French; a lower-cased reference works on both, and each
// page links the notice in its own language. Callers pass the reference as
// published (publishedReference), not the site's URL-safe form; a "/" in it
// stays a path separator, as CanadaBuys writes it. CanadaBuys drops a colon
// from the address (ssc-26-00035339:t is served at .../ssc-26-00035339t, and
// the escaped colon answers 404), so the colon goes too; anything else that
// cannot sit in a path is escaped.
export function noticePath(reference: string): string {
  return encodeURIComponent(reference.toLowerCase().replace(/:/g, "")).replace(/%2F/gi, "/");
}

export function tenderNoticeUrl(reference: string, lang: Lang = "en"): string {
  const ref = noticePath(reference);
  return lang === "fr"
    ? `https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/${ref}`
    : `https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/${ref}`;
}

export function awardNoticeUrl(reference: string, lang: Lang = "en"): string {
  const ref = noticePath(reference);
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

// Closing times print with their zone (src/closing.ts); the pages import them from here.
export { closingHasZone, closingText } from "../closing";

// The language a bilingual text is shown in when the page's own is blank:
// the marker after it, or null when the text is in the page's language.
export function otherLanguageMark(lang: Lang, en: string | null | undefined, fr: string | null | undefined): string | null {
  const mine = lang === "fr" ? fr : en;
  const other = lang === "fr" ? en : fr;
  return !(mine && mine.trim()) && other && other.trim() ? t(lang, "common.other_lang_only") : null;
}

export function provincesText(lang: Lang, provinces: readonly string[]): string {
  return provinces.length ? provinces.map((p) => provinceName(lang, p)).join(", ") : t(lang, "common.national");
}

export const BuyerLink: FC<{ lang: Lang; id: string | null; en: string | null; fr: string | null }> = ({ lang, id, en, fr }) => {
  const name = pick(lang, en, fr) ?? t(lang, "common.not_stated");
  const href = buyerPath(id);
  return href ? <a href={href}>{name}</a> : <>{name}</>;
};

// A notice's UNSPSC segments as chips, the number and a short name ("86
// Education"). The title gives the segment's full name on hover; the label
// says what the chip is for a screen reader and holds its visible text, and
// SegmentNote says it once above the list.
export const SegmentChips: FC<{ lang: Lang; codes: readonly string[] }> = ({ lang, codes }) => (
  <>
    {codes.map((code) => (
      <a href={`/segments/${code}`} class="chip" title={segmentLabel(lang, code)}
        aria-label={t(lang, "segment.chip", { code, name: segmentShort(lang, code) })}>{`${code} ${segmentShort(lang, code)}`}</a>
    ))}
  </>
);

// The line under a list's head that explains the chips, when any row has one.
export const SegmentNote: FC<{ lang: Lang; rows: readonly { segments: readonly string[] }[] }> = ({ lang, rows }) =>
  rows.some((r) => r.segments.length) ? <p class="muted small">{t(lang, "common.segment_chips_note")}</p> : null;

// The page's one statement that the sources are never added together, with
// the counting rules linked.
export const SourcesSeparate: FC<{ lang: Lang }> = ({ lang }) => (
  <>{tj(lang, "common.sources_separate", { methodology: <a href="/methodology#counting">{t(lang, "nav.methodology")}</a> })}</>
);

// "3 of 12 (25%)": the share and what it is a share of. No whole (grants
// carry no competitive flag, or a year with no amount) reads "not
// applicable"; a missing part of a known whole is none of it.
export function shareText(lang: Lang, part: number | null, whole: number | null, fmt: (v: number) => string): string {
  if (whole === null) return t(lang, "common.not_applicable");
  const p = part ?? 0;
  const pct = fmtPct(p, whole, lang);
  return t(lang, "org.share", { part: fmt(p), whole: fmt(whole), pct: pct ? ` (${pct})` : "" });
}

// -- tables ---------------------------------------------------------------------------

// The four money sources as columns of their own, each head the source's
// name over its figure (the tally kind, wide enough for the longest name on
// one line). Where a table is too wide for the window, the sources a table's
// rows use least rest first: on the buyers lists, grants and then published
// contracts (the fewest buyers have them; 51 and 99 of 599 on 2026-11-01).
export type SourceRests = Partial<Record<MoneySource, Rest>>;
export const BUYER_SOURCE_RESTS: SourceRests = { grants: "lg", contracts: "md" };

export function sourceColumns(lang: Lang, rests: SourceRests = {}): Column[] {
  return MONEY_SOURCES.map((s) => ({ kind: "tally" as const, label: sourceLabel(lang, s), rest: rests[s], class: "num" }));
}

// The class a source's cells carry so they rest with their head.
export function sourceCellClass(s: MoneySource, rests: SourceRests, base = "mono num"): string {
  const rest = restClass(rests[s]);
  return rest ? `${base} ${rest}` : base;
}

// A long list on a phone: below 700 px public/pager.js shows a table marked
// with data-phone-page this many rows at a time, with its own Previous and
// Next under it. Wider screens, and phones without the script, show every row.
export const PHONE_PAGE_ROWS = 50;

export const PhonePages: FC<PropsWithChildren<{ lang: Lang; on?: boolean }>> = ({ on, children }) =>
  on ? <div class="table-wrap bordered" data-phone-page={String(PHONE_PAGE_ROWS)}>{children}</div>
    : <div class="table-wrap bordered">{children}</div>;

// The script and its words, once per page that has a PhonePages table.
export const PhonePagerScript: FC<{ lang: Lang }> = ({ lang }) => (
  <>
    <ClientData id="pager-i18n" data={{
      locale: lang === "fr" ? "fr-CA" : "en-CA",
      prev: t(lang, "tenders.prev"), next: t(lang, "tenders.next"), range: t(lang, "common.range"), nav: t(lang, "common.pagination"),
    }} />
    <script src="/pager.js" defer></script>
  </>
);

// The tender list's columns. The c- classes name each column for the split
// view, which hides the published date and the region beside its detail
// panel; the kinds set the widths (src/columns.tsx).
export function tenderColumns(lang: Lang): Column[] {
  return [
    { kind: "main", label: t(lang, "col.notice"), class: "c-notice" },
    { kind: "buyer", label: t(lang, "col.buyer"), class: "c-buyer" },
    { kind: "datetime", label: t(lang, "col.closing"), class: "c-date" },
    { kind: "date", label: t(lang, "col.published"), rest: "md", class: "c-pub" },
    { kind: "region", label: t(lang, "col.region"), class: "c-region" },
  ];
}

// public/tenders.js draws the same markup; selectable rows carry their
// reference for it. The state is the notice's at the page's clock; a notice
// closing soon carries its closing instant for public/countdown.js, which
// writes the time left under it (CountdownScript, once per page).
export const TenderTable: FC<{ lang: Lang; rows: readonly TenderRow[]; clock: Clock; status?: boolean; selectable?: boolean; note?: boolean }> = ({
  lang, rows, clock, status, selectable, note = true,
}) => (
  <>
  {note ? <SegmentNote lang={lang} rows={rows} /> : null}
  <div class="table-wrap bordered">
    <Table cols={tenderColumns(lang)} class="t-tenders">
      <tbody>
        {rows.map((r) => {
          const state = tenderState(status ? r.status ?? "open" : "open", r.closing, clock);
          const closes = state === "closing" ? closesAtUtc(r.closing) : null;
          return (
            <tr data-ref={selectable ? r.reference.toLowerCase() : undefined}>
              <td data-label={t(lang, "col.notice")} class="c-notice">
                <a href={`/tenders/${r.reference.toLowerCase()}`}>{pick(lang, r.title_en, r.title_fr) ?? publishedReference(r)}</a>
                <br />
                <span class="mono id muted">{publishedReference(r)}</span> <SegmentChips lang={lang} codes={r.segments} />
              </td>
              <td data-label={t(lang, "col.buyer")} class="c-buyer"><BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} /></td>
              <td data-label={t(lang, "col.closing")} class="mono c-date" data-closes={closes ?? undefined}
                data-time={closes ? closingTime(r.closing, lang) ?? undefined : undefined} data-notice={closes ? r.reference.toLowerCase() : undefined}>
                {closingText(r.closing, lang)}{" "}
                <StatusBadge lang={lang} status={state} notice={closes ? r.reference.toLowerCase() : undefined} />
              </td>
              <td data-label={t(lang, "col.published")} class="mono c-pub mdh">{r.published ?? ""}</td>
              <td data-label={t(lang, "col.region")} class="c-region">{provincesText(lang, r.provinces)}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  </div>
  </>
);

// The countdown under each closing-soon time (public/countdown.js) and the
// words it writes, once per page that shows one. Without the script the
// server's chip stands.
export const COUNTDOWN_KEYS: readonly Key[] = [
  "countdown.in_min", "countdown.in_hm", "countdown.in_day", "countdown.in_days", "countdown.today_at", "status.closed",
];

export const CountdownScript: FC<{ lang: Lang }> = ({ lang }) => (
  <>
    <ClientData id="countdown-i18n" data={{
      locale: lang === "fr" ? "fr-CA" : "en-CA",
      words: Object.fromEntries(COUNTDOWN_KEYS.map((k) => [k.replace(/^countdown\./, ""), t(lang, k)])),
    }} />
    <script type="module" src="/countdown.js"></script>
  </>
);

// Award notices and contract history rows. href is the record page's
// prefix (/awards or /history); on history rows the buyer is the client
// department.
export const AwardTable: FC<{ lang: Lang; rows: readonly AwardRow[]; href?: string; organization?: boolean; buyer?: boolean }> = ({
  lang, rows, href = "/awards", organization = true, buyer = true,
}) => (
  <div class="table-wrap bordered">
    <Table cols={[
      { kind: "date", label: t(lang, "col.awarded") },
      { kind: "main", label: t(lang, "col.contract") },
      organization && { kind: "org", label: t(lang, "col.supplier") },
      buyer && { kind: "buyer", label: t(lang, href === "/history" ? "col.client" : "col.buyer"), rest: "md" },
      { kind: "value", label: t(lang, "col.value") },
      { kind: "comp", label: t(lang, "col.method") },
    ]}>
      <tbody>
        {rows.map((r) => (
          <tr>
            <td data-label={t(lang, "col.awarded")} class="mono">{r.awarded ?? ""}</td>
            <td data-label={t(lang, "col.contract")}>
              <a href={`${href}/${r.reference.toLowerCase()}`}>{pick(lang, r.title_en, r.title_fr) ?? publishedReference(r)}</a>
              <br />
              <span class="mono id muted">{publishedReference(r)}</span>
              {r.status === "cancelled" ? <> <StatusBadge lang={lang} status="cancelled" /></> : null}
            </td>
            {organization ? (
              <td data-label={t(lang, "col.supplier")}>
                {r.organization_id ? <a href={`/organizations/${r.organization_id}`}>{r.organization ?? r.organization_id}</a> : r.organization ?? ""}
              </td>
            ) : null}
            {buyer ? (
              <td data-label={t(lang, href === "/history" ? "col.client" : "col.buyer")} class="mdh">
                <BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} />
              </td>
            ) : null}
            <td data-label={t(lang, "col.value")} class="mono num">{money(lang, r.value, r.currency)}</td>
            <td data-label={t(lang, "col.method")}><CompetitiveFlag lang={lang} value={r.competitive} /></td>
          </tr>
        ))}
      </tbody>
    </Table>
  </div>
);

// Organizations with their total in one source, ranked as the file ranks them.
export const OrgTotalTable: FC<{ lang: Lang; rows: readonly OrgTotal[]; rank?: boolean }> = ({ lang, rows, rank }) => (
  <div class="table-wrap bordered">
    <Table cols={[
      rank && { kind: "count", label: t(lang, "col.rank") },
      { kind: "main", label: t(lang, "col.organization") },
      { kind: "count", label: t(lang, "col.records") },
      { kind: "total", label: t(lang, "col.value") },
    ]}>
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
    </Table>
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
