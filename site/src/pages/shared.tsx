// Pieces several pages render the same way: the tender and award tables,
// the organization totals, money in its currency, and the links to the
// government's own record of each row.

import type { FC, PropsWithChildren } from "hono/jsx";
import { ProTag } from "../pro";
import { type Column, type MaybeColumn, type Rest, Table, restClass } from "../columns";
import { MONEY_SOURCES, type MoneySource } from "../constants";
import { type AwardRow, type OrgTotal, type TenderRow, type YearFigure, publishedReference } from "../data";
import { buyerPath } from "../crosslinks";
import { fmtInt, fmtMoney, fmtPct, pick, provinceName, segmentLabel, segmentShort, sourceLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import { type Clock, closesAtUtc, closingText, closingTime, countdownLine, tenderState } from "../closing";
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

// A contract's instrument as the source names it, with CanadaBuys' English
// abbreviation spelled out ("Contract against SA"); the French is already whole.
export function instrumentText(lang: Lang, en: string | null | undefined, fr: string | null | undefined): string | null {
  const text = pick(lang, en, fr);
  if (text && /^contract against sa$/i.test(text.trim())) return t(lang, "instrument.contract_sa");
  return text;
}

// The CanadaBuys file a record was read from, as a reader knows it ("the
// CanadaBuys open tender notices file"), by the start of its name as the
// loaders match it (sources/canadabuys.py FILES); any other name as given.
export function sourceFileText(lang: Lang, file: string): string {
  const fy = /^([0-9]{4}-[0-9]{4})-(awardNotice|contractHistory)/.exec(file);
  if (fy) return t(lang, fy[2] === "awardNotice" ? "file.fy_awards" : "file.fy_history", { fy: fy[1] });
  const rules: [RegExp, Key][] = [
    [/^openTenderNotice/, "file.open_tenders"], [/^newTenderNotice/, "file.new_tenders"], [/^tenderNoticeComplete/, "file.all_tenders"],
    [/awardNoticeHistorical/, "file.old_awards"], [/^awardNoticeComplete/, "file.all_awards"],
    [/contractHistoryHistorical/, "file.old_history"], [/^contractHistoryComplete/, "file.all_history"],
  ];
  const key = rules.find(([re]) => re.test(file))?.[1];
  return key ? t(lang, key) : file;
}

// A list read as a sentence: "a, b or c" ("a, b ou c").
export function orList(lang: Lang, items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? "";
  return t(lang, "common.list_or", { list: items.slice(0, -1).join(", "), last: items[items.length - 1] });
}

// A count in a table of many figures: zero is a muted dash, so the figures
// that are not zero stand out; a screen reader still hears the zero.
export const Count: FC<{ lang: Lang; n: number | null | undefined }> = ({ lang, n }) =>
  n ? <>{fmtInt(n, lang)}</> : <span class="zero"><span aria-hidden="true">–</span><span class="visually-hidden">0</span></span>;

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
// omit is the segment of the page the list is on, whose chip every row would carry.
export const SegmentChips: FC<{ lang: Lang; codes: readonly string[]; omit?: string }> = ({ lang, codes, omit }) => (
  <>
    {codes.filter((code) => code !== omit).map((code) => (
      <a href={`/segments/${code}`} class="chip" title={segmentLabel(lang, code)}
        aria-label={t(lang, "segment.chip", { code, name: segmentShort(lang, code) })}>{`${code} ${segmentShort(lang, code)}`}</a>
    ))}
  </>
);

// The line under a list's head that explains the chips, when any row has one
// (other than the page's own segment, which no row shows). A page prints it once.
export const SegmentNote: FC<{ lang: Lang; rows: readonly { segments: readonly string[] }[]; omit?: string; id?: string; hidden?: boolean }> = ({
  lang, rows, omit, id, hidden,
}) => rows.some((r) => r.segments.some((s) => s !== omit)) ? <p class="muted small" id={id} hidden={hidden}>{t(lang, "common.segment_chips_note")}</p> : null;

// The page's one statement that the sources are never added together, with
// the counting rules linked.
// The way from a buyer, an organization or a segment to its analytics view
// (pages/analytics.tsx): listed for every reader once accounts are open and
// marked Pro, since a reader without Pro still opens the view's first chart;
// nothing while they are off, when the view does not exist. nofollow, since
// the view is not a page to index.
export const AnalyticsLink: FC<{ lang: Lang; href: string; on: boolean }> = ({ lang, href, on }) =>
  on ? <a href={href} class="btn" rel="nofollow">{t(lang, "analytics.link")}<ProTag lang={lang} /></a> : null;

export const SourcesSeparate: FC<{ lang: Lang }> = ({ lang }) => (
  <>{tj(lang, "common.sources_separate", { methodology: <a href="/methodology#counting">{t(lang, "nav.methodology")}</a> })}</>
);

// "3 (25%)": the share and its percentage of the whole, which the row's
// Records or Value cell beside it gives. No whole (grants carry no
// competitive flag, or a year with no amount) reads "not applicable"; a
// missing part of a known whole is none of it.
export function shareText(lang: Lang, part: number | null, whole: number | null, fmt: (v: number) => string): string {
  if (whole === null) return t(lang, "common.not_applicable");
  const p = part ?? 0;
  const pct = fmtPct(p, whole, lang);
  return pct ? `${fmt(p)} (${pct})` : fmt(p);
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

// A record list on a profile or a buyer page shows its first PHONE_ROWS rows
// below 700 px, with a button under it that shows the rest (public/pager.js).
export const PHONE_ROWS = 10;

// pages: a radar window read one server page at a time. Its phone pager
// counts contracts across the whole window from the page's offset and steps
// through the server pages at either end, in place of the window's own pager
// (the element with the id given), which wider screens keep.
export type ServerPages = { offset: number; total: number; prev: string | null; next: string | null; replaces: string };

export const PhonePages: FC<PropsWithChildren<{ lang: Lang; on?: boolean; rows?: number; pages?: ServerPages }>> = ({ on, rows, pages, children }) =>
  on ? (
    <div class="table-wrap bordered" data-phone-page={String(PHONE_PAGE_ROWS)}
      data-phone-offset={pages ? String(pages.offset) : undefined} data-phone-total={pages ? String(pages.total) : undefined}
      data-phone-prev={pages?.prev ?? undefined} data-phone-next={pages?.next ?? undefined} data-phone-replaces={pages?.replaces}>
      {children}
    </div>
  ) : <div class="table-wrap bordered" data-phone-rows={rows ? String(rows) : undefined}>{children}</div>;

// The script and its words, once per page that has a PhonePages table or a
// fold for phones.
export const PhonePagerScript: FC<{ lang: Lang }> = ({ lang }) => (
  <>
    <ClientData id="pager-i18n" data={{
      locale: lang === "fr" ? "fr-CA" : "en-CA",
      prev: t(lang, "tenders.prev"), next: t(lang, "tenders.next"), range: t(lang, "common.range"), nav: t(lang, "common.pagination"),
      rows: t(lang, "common.show_rows"),
    }} />
    <script src="/pager.js" defer></script>
  </>
);

// The filters' fold on a phone: its button names how many are on. Wider
// screens never see the button, and the filters stay open (public/pager.js
// closes the fold on a phone; without the script it stays open).
export const FiltersFold: FC<PropsWithChildren<{ lang: Lang; active: number; id?: string }>> = ({ lang, active, id, children }) => (
  <details class="phone-fold filters-fold" open data-phone-closed="">
    <summary class="btn" id={id}>
      {active === 0 ? t(lang, "filters.fold") : tn(lang, "filters.fold_one", "filters.fold_many", active, { n: fmtInt(active, lang) })}
    </summary>
    {children}
  </details>
);

// -- the yearly figures of a profile and a buyer page ----------------------------------

// Newest first, with the years after the data date's (dates as the source
// typed them) after the data year rather than above it; within a year the
// sources keep their order.
export function yearOrder<Y extends YearFigure>(years: readonly Y[], dataYear: number): Y[] {
  const rank = (y: number) => (y === dataYear ? [0, 0] : y > dataYear ? [1, y] : [2, -y]);
  return [...years].sort((a, b) => {
    const [ga, ka] = rank(a.year);
    const [gb, kb] = rank(b.year);
    return ga - gb || ka - kb || MONEY_SOURCES.indexOf(a.source) - MONEY_SOURCES.indexOf(b.source);
  });
}

// How many years the table shows before the fold: the data year and the nine before it.
export const YEARS_SHOWN = 10;

// The year table: a switch above it shows one source at a time (or all of
// them), so a reader follows one source down the years; the rows older than
// the last ten years wait under "Show all years". Both work from the
// stylesheet alone (:has); a browser without it shows every row.
export function YearsBox<Y extends YearFigure>({ lang, years, dataYear, cols, cells }: {
  lang: Lang; years: readonly Y[]; dataYear: number; cols: readonly MaybeColumn[]; cells: (y: Y) => unknown;
}) {
  const rows = yearOrder(years, dataYear);
  const sources = MONEY_SOURCES.filter((s) => rows.some((y) => y.source === s));
  const older = (y: Y) => y.year <= dataYear - YEARS_SHOWN;
  // The switch opens on the source with the most records, the one a reader most likely follows.
  const records = (s: string) => rows.filter((y) => y.source === s).reduce((n, y) => n + y.n, 0);
  const first = sources.reduce<string | undefined>((best, s) => (best === undefined || records(s) > records(best) ? s : best), undefined);
  return (
    <div class="years-box">
      {sources.length > 1 ? (
        <div class="ysw" role="radiogroup" aria-label={t(lang, "common.years_source")}>
          {[...sources, "all" as const].map((s) => (
            <label>
              <input type="radio" name="years-source" value={s} checked={s === first} />
              <span>{s === "all" ? t(lang, "common.years_all") : sourceLabel(lang, s)}</span>
            </label>
          ))}
        </div>
      ) : null}
      <div class="table-wrap bordered" data-phone-rows={String(PHONE_ROWS)}>
        <Table cols={cols}>
          <tbody>
            {rows.map((y) => <tr data-source={y.source} class={older(y) ? "older" : undefined}>{cells(y) as any}</tr>)}
          </tbody>
        </Table>
      </div>
      {rows.some(older) ? (
        <details class="years-more" data-older={sources.filter((s) => rows.some((y) => y.source === s && older(y))).join(" ")}>
          <summary class="btn">
            <span class="when-closed">{t(lang, "common.show_years")}</span>
            <span class="when-open">{t(lang, "common.show_recent_years", { n: YEARS_SHOWN })}</span>
          </summary>
        </details>
      ) : null}
    </div>
  );
}

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
// timeLeft: a list sorted by closing date, where every row near the top would
// carry the same closing-soon chip, shows the time left in its place (the
// chip waits hidden for public/countdown.js, which turns it on when the time
// comes). omit: the page's own segment, left out of the chips.
export const TenderTable: FC<{
  lang: Lang; rows: readonly TenderRow[]; clock: Clock; status?: boolean; selectable?: boolean; note?: boolean; timeLeft?: boolean; omit?: string;
}> = ({ lang, rows, clock, status, selectable, note = true, timeLeft = false, omit }) => (
  <>
  {note ? <SegmentNote lang={lang} rows={rows} omit={omit} /> : null}
  <div class="table-wrap bordered">
    <Table cols={tenderColumns(lang)} class="t-tenders">
      <tbody>
        {rows.map((r) => {
          const state = tenderState(status ? r.status ?? "open" : "open", r.closing, clock);
          const closes = state === "closing" ? closesAtUtc(r.closing) : null;
          const left = timeLeft && closes ? countdownLine(r.closing, clock, lang) : null;
          return (
            <tr data-ref={selectable ? r.reference.toLowerCase() : undefined}>
              <td data-label={t(lang, "col.notice")} class="c-notice">
                <a href={`/tenders/${r.reference.toLowerCase()}`}>{pick(lang, r.title_en, r.title_fr) ?? publishedReference(r)}</a>
                <br />
                <span class="mono id muted">{publishedReference(r)}</span> <SegmentChips lang={lang} codes={r.segments} omit={omit} />
              </td>
              <td data-label={t(lang, "col.buyer")} class="c-buyer">
                <BuyerLink lang={lang} id={r.buyer_id} en={r.buyer_en} fr={r.buyer_fr} />
                {/* Beside the detail panel the provinces column rests; they show here instead. */}
                <span class="split-only muted small">{provincesText(lang, r.provinces)}</span>
              </td>
              <td data-label={t(lang, "col.closing")} class="mono c-date" data-closes={closes ?? undefined}
                data-time={closes ? closingTime(r.closing, lang) ?? undefined : undefined} data-notice={closes ? r.reference.toLowerCase() : undefined}>
                {closingText(r.closing, lang)}{" "}
                <StatusBadge lang={lang} status={state} notice={closes ? r.reference.toLowerCase() : undefined} hidden={left !== null} />
                {left !== null ? <span class="countdown">{left}</span> : null}
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
export const AwardTable: FC<{ lang: Lang; rows: readonly AwardRow[]; href?: string; organization?: boolean; buyer?: boolean; phoneRows?: number }> = ({
  lang, rows, href = "/awards", organization = true, buyer = true, phoneRows,
}) => (
  <div class="table-wrap bordered" data-phone-rows={phoneRows ? String(phoneRows) : undefined}>
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
            <td data-label={t(lang, "col.contract")} class="lead-cell">
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
// A narrow table: on a phone it stays a table (rank, name, value, the
// records resting), so the values can still be compared down the column.
export const OrgTotalTable: FC<{ lang: Lang; rows: readonly OrgTotal[]; rank?: boolean }> = ({ lang, rows, rank }) => (
  <div class="table-wrap bordered">
    <Table restack={false} class="compact" cols={[
      rank && { kind: "count", label: t(lang, "col.rank"), class: "c-rank" },
      { kind: "main", label: t(lang, "col.organization") },
      { kind: "count", label: t(lang, "col.records"), class: "ph" },
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
            <td data-label={t(lang, "col.records")} class="mono num ph">{fmtInt(r.n, lang)}</td>
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
