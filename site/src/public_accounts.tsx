// The Public Accounts of Canada on a profile and a buyer page: payments in a
// fiscal year, the site's one source of amounts paid, and the works file's
// contracts of $250,000 or more with what the department spent on each. Every
// other source is a contract or agreement value, and nothing here is ever
// added to one, nor a works figure to a payment for services: each part has
// its own heading, its own columns, a line saying so, the source, the line
// that the copy is not the official record, and the licence. The blocks ride
// in the profile shard and the buyer file (the pipeline's
// sources/public_accounts.py profile_blocks and buyer_blocks), so a page
// fetches nothing more; a block that does not read, or a file written before
// the source, shows no panel and the page is as it was. A works part that
// does not read is left out and the services part stays; a block written
// before the works file has none.

import type { FC } from "hono/jsx";
import { Table } from "./columns";
import { PROVINCES } from "./constants";
import { buyerPath } from "./crosslinks";
import { fmtInt, pick, provinceName, t, tj, tn, type Lang } from "./i18n";
import { Panel } from "./layout";
import { PHONE_ROWS, PhonePages, money } from "./pages/shared";
import { FREE_YEARS, MAX_YEARS, fiscalLabel } from "./records_db";
import { OGL_URL } from "./seo";
import { isListOf, isNum, isObj, isStr } from "./valid";

// The pipeline's figures (sources/public_accounts.py; its tests hold the two
// equal): the newest fiscal years a block carries, as the analytics' free
// window, a profile's rows a year (of each file), a buyer file's payees and
// its works contracts.
export const PA_FREE_YEARS = FREE_YEARS;
export const PA_MAX_YEARS = MAX_YEARS;
export const PA_PROFILE_ROWS = 100;
export const PA_BUYER_PAYEES = 50;
export const PA_BUYER_WORKS = 25;

export const PA_DATASET = "ac597ff8-ee13-48c3-b315-42e528090af2";
export const paDatasetUrl = (lang: Lang): string => `https://open.canada.ca/data/${lang === "fr" ? "fr" : "en"}/dataset/${PA_DATASET}`;
// Acquisition of land, buildings and works.
export const PA_WORKS_DATASET = "8776785b-445c-42bb-bb53-c29a1bff44dd";
export const paWorksDatasetUrl = (lang: Lang): string => `https://open.canada.ca/data/${lang === "fr" ? "fr" : "en"}/dataset/${PA_WORKS_DATASET}`;
// The Receiver General's Public Accounts page, where the official version is.
export const PAC_URL: Readonly<Record<Lang, string>> = {
  en: "https://www.canada.ca/en/public-services-procurement/services/payments-accounting/public-accounts.html",
  fr: "https://www.canada.ca/fr/services-publics-approvisionnement/services/paiements-comptabilite/comptes-publics.html",
};

// -- the blocks as the export writes them ------------------------------------------------

// A province's code, a country (or a state abroad) in English and French, or nothing stated.
export type PaPlace = string | [string, string] | null;
// [department key, class code, paid, payee, payee in French (null: the same), city, city in French, place, flag]
export type PaRow = [string, string, number, string, string | null, string | null, string | null, PaPlace, 0 | 1];
export interface PaYear { fy: number; n: number; total: number; d: number; rows: PaRow[] }
// A works contract on a profile: [department key, amount contracted, spent in the year, spent to date,
// contractor, contractor in French, city, city in French, place, description, description in French,
// project city, project city in French, project place, flag]. No sum: a works year has its count alone.
export type PaWorkRow = [string, number | null, number | null, number | null, string, string | null, string | null, string | null, PaPlace,
  string | null, string | null, string | null, string | null, PaPlace, 0 | 1];
export interface PaWorksYear { fy: number; n: number; rows: PaWorkRow[] }
export interface ProfilePa {
  services: PaYear[];
  // Empty for a block written before the works file, or one whose works part does not read.
  works: PaWorksYear[];
  buyers: Record<string, [string, string | null]>;
  classes: Record<string, [string, string]>;
  loaded: [number, number];
}
export interface BuyerPaClass {
  cls: string; en: string; fr: string; total: number;
  named: [number, number]; under: [number | null, number]; federal: [number, number]; withheld: number;
}
// [payee, payee in French, organization id (null: no profile), class code, paid, city, city in French, place]
export type BuyerPaPayee = [string, string | null, string | null, string, number, string | null, string | null, PaPlace];
// A works contract on a buyer page: [contractor, in French, organization id (null: no profile), city, in French,
// place, description, in French, project city, in French, project place, amount contracted, spent in the year,
// spent to date, 1 when the contractor is a federal institution].
export type BuyerPaWork = [string | null, string | null, string | null, string | null, string | null, PaPlace, string | null, string | null,
  string | null, string | null, PaPlace, number | null, number | null, number | null, 0 | 1];
// The newest works file's contracts of the department, the largest amount contracted first, how many it names,
// and its line under the threshold ([contractors or null, spent in the year], or null).
export interface BuyerPaWorks { fy: number; n: number; rows: BuyerPaWork[]; under: [number | null, number] | null }
// classes, payees and named_rows are the services file's: empty for a department it does not name.
export interface BuyerPa { fy: number; classes: BuyerPaClass[]; payees: BuyerPaPayee[]; named_rows: number; works: BuyerPaWorks | null }

const TEXT_MAX = 300;
const isText = (v: unknown, max = TEXT_MAX): v is string => isStr(v) && v.trim() !== "" && v.length <= max;
const isTextOrNull = (v: unknown, max = TEXT_MAX): boolean => v === null || isText(v, max);
const isCount = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;
const isFy = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 2000 && v <= 2999;
const isPlace = (v: unknown): boolean => v === null || (isStr(v) && (PROVINCES as readonly string[]).includes(v)) ||
  (Array.isArray(v) && v.length === 2 && isText(v[0], 120) && isText(v[1], 120));
const isPair = (v: unknown, second: (x: unknown) => boolean): boolean => Array.isArray(v) && v.length === 2 && isText(v[0]) && second(v[1]);
const ORG_ID = /^org-[0-9a-f]{10}$/;

const isRow = (r: unknown): r is PaRow => Array.isArray(r) && r.length === 9 && isText(r[0], 80) && isText(r[1], 12) && isNum(r[2]) &&
  isText(r[3]) && isTextOrNull(r[4]) && isTextOrNull(r[5], 120) && isTextOrNull(r[6], 120) && isPlace(r[7]) && (r[8] === 0 || r[8] === 1);

const isYear = (y: unknown): y is PaYear => isObj(y) && isFy(y.fy) && isCount(y.n) && isNum(y.total) && isCount(y.d) &&
  isListOf(y.rows, isRow) && y.rows.length >= 1 && y.rows.length <= Math.min(PA_PROFILE_ROWS, y.n);

const isAmount = (v: unknown): v is number | null => v === null || isNum(v);
const isWorkRow = (r: unknown): r is PaWorkRow => Array.isArray(r) && r.length === 15 && isText(r[0], 80) && isAmount(r[1]) &&
  isAmount(r[2]) && isAmount(r[3]) && isText(r[4]) && isTextOrNull(r[5]) && isTextOrNull(r[6], 120) && isTextOrNull(r[7], 120) &&
  isPlace(r[8]) && isTextOrNull(r[9]) && isTextOrNull(r[10]) && isTextOrNull(r[11], 120) && isTextOrNull(r[12], 120) && isPlace(r[13]) &&
  (r[14] === 0 || r[14] === 1);
const isWorksYear = (y: unknown): y is PaWorksYear => isObj(y) && isFy(y.fy) && isCount(y.n) && isListOf(y.rows, isWorkRow) &&
  y.rows.length >= 1 && y.rows.length <= Math.min(PA_PROFILE_ROWS, y.n);
const newestFirst = <T extends { fy: number }>(years: T[]): T[] => [...years].sort((a, b) => b.fy - a.fy).slice(0, PA_FREE_YEARS);

// A profile's block, or null: an export before the source, a profile with no
// payment or contract linked to it, or a block of the wrong shape (which never
// takes the profile down with it). The years newest first, at most the free
// window. A works part that does not read is dropped and the services part
// shown alone; a block with neither shows no panel.
export function profilePublicAccounts(profile: unknown): ProfilePa | null {
  const v = isObj(profile) ? profile.public_accounts : undefined;
  if (!isObj(v) || v.v !== 1 || !isListOf(v.services, isYear) || v.services.length > PA_MAX_YEARS) return null;
  const works = isListOf(v.works, isWorksYear) && v.works.length <= PA_MAX_YEARS ? newestFirst(v.works as PaWorksYear[]) : [];
  if (v.services.length < 1 && works.length < 1) return null;
  if (!isObj(v.buyers) || !Object.values(v.buyers).every((n) => isPair(n, (x) => isTextOrNull(x)))) return null;
  if (!isObj(v.classes) || !Object.values(v.classes).every((n) => isPair(n, (x) => isText(x)))) return null;
  if (!Array.isArray(v.loaded) || v.loaded.length !== 2 || !isFy(v.loaded[0]) || !isFy(v.loaded[1])) return null;
  return { services: newestFirst(v.services as PaYear[]), works, buyers: v.buyers, classes: v.classes, loaded: v.loaded as [number, number] };
}

const isSplit = (v: unknown, count: (x: unknown) => boolean): boolean => Array.isArray(v) && v.length === 2 && count(v[0]) && isNum(v[1]);
const isClass = (c: unknown): c is BuyerPaClass => isObj(c) && isText(c.cls, 12) && isText(c.en) && isText(c.fr) && isNum(c.total) &&
  isSplit(c.named, isCount) && isSplit(c.under, (x) => x === null || isCount(x)) && isSplit(c.federal, isCount) && isCount(c.withheld);
const isPayee = (r: unknown): r is BuyerPaPayee => Array.isArray(r) && r.length === 8 && isText(r[0]) && isTextOrNull(r[1]) &&
  (r[2] === null || (isStr(r[2]) && ORG_ID.test(r[2]))) && isText(r[3], 12) && isNum(r[4]) && isTextOrNull(r[5], 120) &&
  isTextOrNull(r[6], 120) && isPlace(r[7]);

const isBuyerWork = (r: unknown): r is BuyerPaWork => Array.isArray(r) && r.length === 15 && isTextOrNull(r[0]) && isTextOrNull(r[1]) &&
  (r[2] === null || (isStr(r[2]) && ORG_ID.test(r[2]))) && isTextOrNull(r[3], 120) && isTextOrNull(r[4], 120) && isPlace(r[5]) &&
  isTextOrNull(r[6]) && isTextOrNull(r[7]) && isTextOrNull(r[8], 120) && isTextOrNull(r[9], 120) && isPlace(r[10]) && isAmount(r[11]) &&
  isAmount(r[12]) && isAmount(r[13]) && (r[14] === 0 || (r[14] === 1 && r[2] === null));
const isBuyerWorks = (w: unknown): w is BuyerPaWorks => isObj(w) && isFy(w.fy) && isCount(w.n) && isListOf(w.rows, isBuyerWork) &&
  w.rows.length <= Math.min(PA_BUYER_WORKS, w.n) && (w.under === null || isSplit(w.under, (x) => x === null || isCount(x))) &&
  (w.rows.length > 0 || w.under !== null);

// A buyer file's block, or null on the same terms: a works part that does not
// read is dropped, and a block with no class and no works shows nothing.
export function buyerPublicAccounts(file: unknown): BuyerPa | null {
  const v = isObj(file) ? file.public_accounts : undefined;
  if (!isObj(v) || v.v !== 1 || !isFy(v.fy) || !isListOf(v.classes, isClass)) return null;
  if (!isListOf(v.payees, isPayee) || v.payees.length > PA_BUYER_PAYEES || !isCount(v.named_rows) || v.payees.length > v.named_rows) return null;
  const works = isBuyerWorks(v.works) ? v.works : null;
  if (v.classes.length < 1 && !works) return null;
  return { fy: v.fy, classes: v.classes, payees: v.payees, named_rows: v.named_rows, works };
}

// -- what the panels show ----------------------------------------------------------------

// "Ottawa, Ontario", "Riga, Latvia", "Not stated": the row's place as published.
export function placeText(lang: Lang, city: string | null, cityFr: string | null, place: PaPlace): string {
  const where = place === null ? null : isStr(place) ? provinceName(lang, place) : pick(lang, place[0], place[1]);
  return [lang === "fr" ? cityFr ?? city : city, where].filter(Boolean).join(", ") || t(lang, "common.not_stated");
}

const fyList = (lang: Lang, years: readonly number[]): string => years.map((fy) => fiscalLabel(lang, fy)).join(", ");

// The source of each file shown (the services file's years, the works file's),
// each with its dataset, then the line that the copy is not the official
// record and the licence, once.
export const PaFoot: FC<{ lang: Lang; years: readonly number[]; works?: readonly number[] }> = ({ lang, years, works = [] }) => (
  <>
    {years.length ? (
      <p class="muted small">
        {tj(lang, "pa.source", { fy: fyList(lang, years), dataset: <a href={paDatasetUrl(lang)}>{t(lang, "pa.dataset_link")}</a> })}
      </p>
    ) : null}
    {works.length ? (
      <p class="muted small">
        {tj(lang, "pa.works_source", { fy: fyList(lang, works), dataset: <a href={paWorksDatasetUrl(lang)}>{t(lang, "pa.dataset_link")}</a> })}
      </p>
    ) : null}
    <p class="muted small">{tj(lang, "pa.not_official", { pac: <a href={PAC_URL[lang]}>{t(lang, "pa.pac_link")}</a> })}</p>
    <p class="muted small"><a href={OGL_URL[lang]}>{t(lang, "data.credit")}</a></p>
  </>
);

// An amount spent to date in the range its column rests (700 to 1279 px), under the year's figure.
const ToDateUnder: FC<{ lang: Lang; value: number | null }> = ({ lang, value }) => (
  <span class="md-only muted small">{t(lang, "common.labelled", { label: t(lang, "pa.col_spent_to_date"), value: money(lang, value) })}</span>
);

// A description as the file writes it, in the page's language when it has one.
const described = (lang: Lang, en: string | null, fr: string | null): string =>
  (lang === "fr" ? fr ?? en : en) ?? t(lang, "common.not_stated");

const RowsCap: FC<{ lang: Lang; shown: number; n: number }> = ({ lang, shown, n }) =>
  n > shown ? <p class="muted small">{t(lang, "pa.rows_cap", { shown: fmtInt(shown, lang), n: fmtInt(n, lang) })}</p> : null;

// A profile's panel, after its record panels: each fiscal year's rows, the
// department under the buyer's own name (linked to its page when it has
// one), the payee as the Public Accounts write it with its place, and a row
// whose province is not among the profile's addresses saying so.
export const PublicAccountsPanel: FC<{ lang: Lang; pa: ProfilePa | null }> = ({ lang, pa }) => {
  if (!pa) return null;
  const dept = (key: string) => {
    const names = pa.buyers[key];
    const name = names ? pick(lang, names[0], names[1]) ?? names[0] : key;
    const href = buyerPath(key);
    return href ? <a href={href}>{name}</a> : <>{name}</>;
  };
  const cls = (code: string) => {
    const names = pa.classes[code];
    return names ? pick(lang, names[0], names[1]) ?? names[0] : code;
  };
  const paid = pa.services.length > 0;
  return (
    <Panel id="public-accounts" title={t(lang, "pa.panel")}
      foot={<PaFoot lang={lang} years={pa.services.map((y) => y.fy)} works={pa.works.map((y) => y.fy)} />}>
      {/* The services lines only over services rows: a profile with works contracts alone has none. */}
      {paid ? (
        <>
          <p class="muted small">{t(lang, "pa.lead")}</p>
          <p class="muted small">{t(lang, "pa.apart")}</p>
        </>
      ) : null}
      <p class="muted small">{t(lang, "pa.matched")}</p>
      {pa.services.map((y) => (
        <>
          <h3>
            {t(lang, "pa.fy_head", { fy: fiscalLabel(lang, y.fy) })}{" "}
            <span class="muted">{tn(lang, "pa.year_total_one", "pa.year_total_many", y.d, { amount: money(lang, y.total), n: fmtInt(y.d, lang) })}</span>
          </h3>
          <PhonePages lang={lang} rows={PHONE_ROWS}>
            {/* Four columns from 700 px: the payee's place on a line of its own in its cell. */}
            <Table cols={[
              { kind: "buyer", label: t(lang, "grant.department") },
              { kind: "label", label: t(lang, "pa.col_class") },
              { kind: "main", label: t(lang, "pa.col_payee") },
              { kind: "value", label: t(lang, "pa.col_paid") },
            ]}>
              <tbody>
                {y.rows.map(([key, code, paid, payee, payeeFr, city, cityFr, place, flag]) => (
                  <tr>
                    <td data-label={t(lang, "grant.department")}>{dept(key)}</td>
                    <td data-label={t(lang, "pa.col_class")}>{cls(code)}</td>
                    <td data-label={t(lang, "pa.col_payee")} class="lead-cell">
                      {lang === "fr" ? payeeFr ?? payee : payee}
                      <span class="nw-block muted small">{placeText(lang, city, cityFr, place)}</span>
                      {flag ? <span class="nw-block muted small">{t(lang, "pa.place_differs")}</span> : null}
                    </td>
                    <td data-label={t(lang, "pa.col_paid")} class="mono num">{money(lang, paid)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </PhonePages>
          <RowsCap lang={lang} shown={y.rows.length} n={y.n} />
        </>
      ))}
      {pa.works.length ? <ProfileWorks lang={lang} works={pa.works} dept={dept} after={paid} /> : null}
    </Panel>
  );
};

// A profile's works contracts, under their own heading after the payments:
// the department, the project with its place, the contractor as the file
// writes it with its own place (the name the match read), the amount
// contracted and what was spent in the year and to date. Never a sum. The
// line apart names the payments above only when the panel shows them.
const ProfileWorks: FC<{ lang: Lang; works: PaWorksYear[]; dept: (key: string) => unknown; after: boolean }> = ({ lang, works, dept, after }) => (
  <>
    <h3>{t(lang, "pa.works_head")}</h3>
    <p class="muted small">{t(lang, "pa.works_lead", { fy: fyList(lang, works.map((y) => y.fy)) })}</p>
    <p class="muted small">{t(lang, after ? "pa.works_apart" : "pa.works_apart_alone")}</p>
    {works.map((y) => {
      const spentYear = t(lang, "pa.col_spent_year", { fy: fiscalLabel(lang, y.fy) });
      return (
        <>
          {works.length > 1 ? <p class="muted small">{t(lang, "pa.fy_head", { fy: fiscalLabel(lang, y.fy) })}</p> : null}
          <PhonePages lang={lang} rows={PHONE_ROWS}>
            {/* Five columns from 1280 px; from 700 to 1279 px the spending to date rests and shows under the year's. */}
            <Table cols={[
              { kind: "buyer", label: t(lang, "grant.department") },
              { kind: "main", label: t(lang, "pa.col_project") },
              { kind: "value", label: t(lang, "pa.col_contracted") },
              { kind: "value", label: spentYear },
              { kind: "value", label: t(lang, "pa.col_spent_to_date"), rest: "md" },
            ]}>
              <tbody>
                {y.rows.map(([key, contracted, spent, toDate, name, nameFr, city, cityFr, place, desc, descFr, pcity, pcityFr, pplace, flag]) => {
                  const where = city || cityFr || place ? `, ${placeText(lang, city, cityFr, place)}` : "";
                  return (
                    <tr>
                      <td data-label={t(lang, "grant.department")}>{dept(key)}</td>
                      <td data-label={t(lang, "pa.col_project")} class="lead-cell">
                        {described(lang, desc, descFr)}
                        <span class="nw-block muted small">{placeText(lang, pcity, pcityFr, pplace)}</span>
                        <span class="nw-block muted small">
                          {t(lang, "common.labelled", { label: t(lang, "pa.col_contractor"), value: `${lang === "fr" ? nameFr ?? name : name}${where}` })}
                        </span>
                        {flag ? <span class="nw-block muted small">{t(lang, "pa.place_differs")}</span> : null}
                      </td>
                      <td data-label={t(lang, "pa.col_contracted")} class="mono num">{money(lang, contracted)}</td>
                      <td data-label={spentYear} class="mono num">{money(lang, spent)}<ToDateUnder lang={lang} value={toDate} /></td>
                      <td data-label={t(lang, "pa.col_spent_to_date")} class="mono num mdh">{money(lang, toDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </PhonePages>
          <RowsCap lang={lang} shown={y.rows.length} n={y.n} />
        </>
      );
    })}
  </>
);

// The line under a profile's tiles when it has the panel; nothing otherwise,
// so a profile without payments renders as it did.
export const PaTilesNote: FC<{ lang: Lang; pa: ProfilePa | null }> = ({ lang, pa }) =>
  pa ? <>{" "}{tj(lang, "pa.tiles_note", { below: <a href="#public-accounts">{t(lang, "pa.below")}</a> })}</> : null;

const cell = (lang: Lang, n: number | null, amount: number) =>
  n === null ? money(lang, amount) : t(lang, "pa.cell_count", { n: fmtInt(n, lang), amount: money(lang, amount) });

// A buyer page's panel, the last of the page: each class of service's total
// as published and how it splits, the persons withheld as a count (their
// amount stays inside the total), the federal payees apart, and the payees
// named, largest first, each linked to its profile when one holds it.
export const BuyerPaymentsPanel: FC<{ lang: Lang; pa: BuyerPa | null; buyer: string }> = ({ lang, pa, buyer }) => {
  // A department the services file does not name (its block holds the works part alone) has no such panel.
  if (!pa || !pa.classes.length) return null;
  const fy = fiscalLabel(lang, pa.fy);
  const withheld = pa.classes.reduce((n, c) => n + c.withheld, 0);
  const federal = pa.classes.some((c) => c.federal[0] > 0);
  const names = new Map(pa.classes.map((c) => [c.cls, pick(lang, c.en, c.fr) ?? c.en]));
  return (
    <Panel id="public-accounts" title={t(lang, "pa.buyer_panel")} foot={<PaFoot lang={lang} years={[pa.fy]} />}>
      <p>{t(lang, "pa.buyer_lead", { buyer, fy })}</p>
      <div class="table-wrap bordered">
        {/* From 700 to 1279 px the federal column rests and shows under the payees under $100,000. */}
        <Table cols={[
          { kind: "main", label: t(lang, "pa.col_class") },
          { kind: "total", label: t(lang, "pa.col_class_total") },
          { kind: "value", label: t(lang, "pa.col_listed") },
          { kind: "value", label: t(lang, "pa.col_under") },
          { kind: "value", label: t(lang, "pa.col_federal"), rest: "md" },
        ]}>
          <tbody>
            {pa.classes.map((c) => (
              <tr>
                <td data-label={t(lang, "pa.col_class")}>{names.get(c.cls)}</td>
                <td data-label={t(lang, "pa.col_class_total")} class="mono num">{money(lang, c.total)}</td>
                <td data-label={t(lang, "pa.col_listed")} class="mono num">{cell(lang, c.named[0], c.named[1])}</td>
                <td data-label={t(lang, "pa.col_under")} class="mono num">
                  {cell(lang, c.under[0], c.under[1])}
                  <span class="md-only muted small">{t(lang, "common.labelled", { label: t(lang, "pa.col_federal"), value: cell(lang, c.federal[0], c.federal[1]) })}</span>
                </td>
                <td data-label={t(lang, "pa.col_federal")} class="mono num mdh">{cell(lang, c.federal[0], c.federal[1])}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
      {withheld ? <p class="muted small">{tn(lang, "pa.withheld_one", "pa.withheld_many", withheld, { n: fmtInt(withheld, lang) })}</p> : null}
      {federal ? <p class="muted small">{t(lang, "pa.federal_note")}</p> : null}
      {pa.payees.length ? (
        <>
          <h3>{t(lang, "pa.buyer_payees", { fy })}</h3>
          <PhonePages lang={lang} rows={PHONE_ROWS}>
            <Table cols={[
              { kind: "main", label: t(lang, "pa.col_payee") },
              { kind: "label", label: t(lang, "pa.col_class") },
              { kind: "value", label: t(lang, "pa.col_paid") },
            ]}>
              <tbody>
                {pa.payees.map(([payee, payeeFr, org, code, paid, city, cityFr, place]) => {
                  const name = lang === "fr" ? payeeFr ?? payee : payee;
                  return (
                    <tr>
                      <td data-label={t(lang, "pa.col_payee")} class="lead-cell">
                        {org ? <a href={`/organizations/${org}#public-accounts`}>{name}</a> : name}
                        <span class="nw-block muted small">{placeText(lang, city, cityFr, place)}</span>
                      </td>
                      <td data-label={t(lang, "pa.col_class")}>{names.get(code) ?? code}</td>
                      <td data-label={t(lang, "pa.col_paid")} class="mono num">{money(lang, paid)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </PhonePages>
          <RowsCap lang={lang} shown={pa.payees.length} n={pa.named_rows} />
        </>
      ) : null}
    </Panel>
  );
};

// A buyer page's works contracts, a panel of its own after the payments for
// services: the newest works file's largest contracts by amount contracted
// (a contractor linked to its profile when one holds it), what was spent on
// each in the year and to date, and the department's line under the
// threshold. Never a sum of the contracts, and never beside the payments in
// one: the line apart names the payments above only when the page shows them.
export const BuyerWorksPanel: FC<{ lang: Lang; pa: BuyerPa | null }> = ({ lang, pa }) => {
  const w = pa?.works;
  if (!pa || !w) return null;
  const fy = fiscalLabel(lang, w.fy);
  const spentYear = t(lang, "pa.col_spent_year", { fy });
  const under = w.under;
  return (
    <Panel id="public-accounts-works" title={t(lang, "pa.buyer_works", { fy })} foot={<PaFoot lang={lang} years={[]} works={[w.fy]} />}>
      <p>{t(lang, "pa.works_lead", { fy })}</p>
      <p class="muted small">{t(lang, pa.classes.length ? "pa.works_apart" : "pa.works_apart_alone")}</p>
      {w.rows.length ? (
        <>
          <PhonePages lang={lang} rows={PHONE_ROWS}>
            {/* Five columns from 1280 px; from 700 to 1279 px the spending to date rests and shows under the year's. */}
            <Table cols={[
              { kind: "main", label: t(lang, "pa.col_contractor") },
              { kind: "text", label: t(lang, "pa.col_project") },
              { kind: "value", label: t(lang, "pa.col_contracted") },
              { kind: "value", label: spentYear },
              { kind: "value", label: t(lang, "pa.col_spent_to_date"), rest: "md" },
            ]}>
              <tbody>
                {w.rows.map(([name, nameFr, org, city, cityFr, place, desc, descFr, pcity, pcityFr, pplace, contracted, spent, toDate, federal]) => {
                  const shown = (lang === "fr" ? nameFr ?? name : name) ?? t(lang, "common.not_stated");
                  return (
                    <tr>
                      <td data-label={t(lang, "pa.col_contractor")} class="lead-cell">
                        {org ? <a href={`/organizations/${org}#public-accounts`}>{shown}</a> : shown}
                        <span class="nw-block muted small">{placeText(lang, city, cityFr, place)}</span>
                        {/* Another federal institution as the contractor: apart from the organizations, as on the payments. */}
                        {federal ? <span class="nw-block muted small">{t(lang, "pa.works_federal")}</span> : null}
                      </td>
                      <td data-label={t(lang, "pa.col_project")}>
                        {described(lang, desc, descFr)}
                        <span class="nw-block muted small">{placeText(lang, pcity, pcityFr, pplace)}</span>
                      </td>
                      <td data-label={t(lang, "pa.col_contracted")} class="mono num">{money(lang, contracted)}</td>
                      <td data-label={spentYear} class="mono num">{money(lang, spent)}<ToDateUnder lang={lang} value={toDate} /></td>
                      <td data-label={t(lang, "pa.col_spent_to_date")} class="mono num mdh">{money(lang, toDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </PhonePages>
          <RowsCap lang={lang} shown={w.rows.length} n={w.n} />
        </>
      ) : null}
      {under ? (
        <p class="muted small">
          {under[0] === null
            ? t(lang, "pa.works_under_nocount", { amount: money(lang, under[1]), fy })
            : tn(lang, "pa.works_under_one", "pa.works_under", under[0], { n: fmtInt(under[0], lang), amount: money(lang, under[1]), fy })}
        </p>
      ) : null}
    </Panel>
  );
};
