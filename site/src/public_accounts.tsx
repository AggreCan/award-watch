// The Public Accounts of Canada on a profile and a buyer page: payments in a
// fiscal year, the site's one source of amounts paid. Every other source is a
// contract or agreement value, and nothing here is ever added to one: each
// panel has its own heading, its own columns, a line saying so, the source,
// the line that the copy is not the official record, and the licence. The
// blocks ride in the profile shard and the buyer file (the pipeline's
// sources/public_accounts.py profile_blocks and buyer_blocks), so a page
// fetches nothing more; a block that does not read, or a file written before
// the source, shows no panel and the page is as it was.

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
// window, a profile's rows a year, a buyer file's payees.
export const PA_FREE_YEARS = FREE_YEARS;
export const PA_MAX_YEARS = MAX_YEARS;
export const PA_PROFILE_ROWS = 100;
export const PA_BUYER_PAYEES = 50;

export const PA_DATASET = "ac597ff8-ee13-48c3-b315-42e528090af2";
export const paDatasetUrl = (lang: Lang): string => `https://open.canada.ca/data/${lang === "fr" ? "fr" : "en"}/dataset/${PA_DATASET}`;
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
export interface ProfilePa {
  services: PaYear[];
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
export interface BuyerPa { fy: number; classes: BuyerPaClass[]; payees: BuyerPaPayee[]; named_rows: number }

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

// A profile's block, or null: an export before the source, a profile with no
// payment linked to it, or a block of the wrong shape (which never takes the
// profile down with it). The years newest first, at most the free window.
export function profilePublicAccounts(profile: unknown): ProfilePa | null {
  const v = isObj(profile) ? profile.public_accounts : undefined;
  if (!isObj(v) || v.v !== 1 || !isListOf(v.services, isYear) || v.services.length < 1 || v.services.length > PA_MAX_YEARS) return null;
  if (!isObj(v.buyers) || !Object.values(v.buyers).every((n) => isPair(n, (x) => isTextOrNull(x)))) return null;
  if (!isObj(v.classes) || !Object.values(v.classes).every((n) => isPair(n, (x) => isText(x)))) return null;
  if (!Array.isArray(v.loaded) || v.loaded.length !== 2 || !isFy(v.loaded[0]) || !isFy(v.loaded[1])) return null;
  const services = [...(v.services as PaYear[])].sort((a, b) => b.fy - a.fy).slice(0, PA_FREE_YEARS);
  return { services, buyers: v.buyers, classes: v.classes, loaded: v.loaded as [number, number] };
}

const isSplit = (v: unknown, count: (x: unknown) => boolean): boolean => Array.isArray(v) && v.length === 2 && count(v[0]) && isNum(v[1]);
const isClass = (c: unknown): c is BuyerPaClass => isObj(c) && isText(c.cls, 12) && isText(c.en) && isText(c.fr) && isNum(c.total) &&
  isSplit(c.named, isCount) && isSplit(c.under, (x) => x === null || isCount(x)) && isSplit(c.federal, isCount) && isCount(c.withheld);
const isPayee = (r: unknown): r is BuyerPaPayee => Array.isArray(r) && r.length === 8 && isText(r[0]) && isTextOrNull(r[1]) &&
  (r[2] === null || (isStr(r[2]) && ORG_ID.test(r[2]))) && isText(r[3], 12) && isNum(r[4]) && isTextOrNull(r[5], 120) &&
  isTextOrNull(r[6], 120) && isPlace(r[7]);

// A buyer file's block, or null on the same terms.
export function buyerPublicAccounts(file: unknown): BuyerPa | null {
  const v = isObj(file) ? file.public_accounts : undefined;
  if (!isObj(v) || v.v !== 1 || !isFy(v.fy) || !isListOf(v.classes, isClass) || v.classes.length < 1) return null;
  if (!isListOf(v.payees, isPayee) || v.payees.length > PA_BUYER_PAYEES || !isCount(v.named_rows) || v.payees.length > v.named_rows) return null;
  return { fy: v.fy, classes: v.classes, payees: v.payees, named_rows: v.named_rows };
}

// -- what the panels show ----------------------------------------------------------------

// "Ottawa, Ontario", "Riga, Latvia", "Not stated": the row's place as published.
export function placeText(lang: Lang, city: string | null, cityFr: string | null, place: PaPlace): string {
  const where = place === null ? null : isStr(place) ? provinceName(lang, place) : pick(lang, place[0], place[1]);
  return [lang === "fr" ? cityFr ?? city : city, where].filter(Boolean).join(", ") || t(lang, "common.not_stated");
}

// The source, the line that the copy is not the official record, and the licence, linked.
export const PaFoot: FC<{ lang: Lang; years: readonly number[] }> = ({ lang, years }) => (
  <>
    <p class="muted small">
      {tj(lang, "pa.source", {
        fy: years.map((fy) => fiscalLabel(lang, fy)).join(", "),
        dataset: <a href={paDatasetUrl(lang)}>{t(lang, "pa.dataset_link")}</a>,
      })}
    </p>
    <p class="muted small">{tj(lang, "pa.not_official", { pac: <a href={PAC_URL[lang]}>{t(lang, "pa.pac_link")}</a> })}</p>
    <p class="muted small"><a href={OGL_URL[lang]}>{t(lang, "data.credit")}</a></p>
  </>
);

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
  return (
    <Panel id="public-accounts" title={t(lang, "pa.panel")} foot={<PaFoot lang={lang} years={pa.services.map((y) => y.fy)} />}>
      <p class="muted small">{t(lang, "pa.lead")}</p>
      <p class="muted small">{t(lang, "pa.apart")}</p>
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
    </Panel>
  );
};

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
  if (!pa) return null;
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
