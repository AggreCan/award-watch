// The page of "Your organization", /account/organization (org_claim.ts holds
// the claim and the statements; routes.tsx mounts the page and its posts).
// Unclaimed: a search for the organization, each result with its "This is
// us" button. Claimed: the organization, the up to five it is compared with,
// then the blocks: records by fiscal year for any account (the latest three
// fiscal years on Free, as the free analytics view shows), and for Pro the
// records by segment, the share of a segment, the contracts ending within 12
// months, the buyers won from and the registry match, each with its CSV file.
// A Free account sees each Pro block's title with the chip and one line of
// what it holds, as the analytics views do. No ranking words, nothing said
// about being ahead or behind: the figures, their denominators, and the
// order of the competitors the account chose.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { ChartStack, barGap, fiscalAxis, type Panel as ChartPanel } from "../chart";
import { Table } from "../columns";
import { MONEY_SOURCES, SEGMENT_CODES, type MoneySource } from "../constants";
import { type ExpiringRow, type Profile, loadBuyers, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, fmtMoneyShort, fmtPct, pick, provinceName, segmentLabel, sourceLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import { PageHead, Panel, todayOf } from "../layout";
import { csvCell } from "../pages/analytics";
import { ExpiringNote, ExpiringTable, RADAR_CSV_COLUMNS, contractReference, radarRow } from "../pages/expiring";
import { money } from "../pages/shared";
import { ProNote, ProTag } from "../pro";
import { FREE_YEARS, MAX_YEARS, SOURCE_NUMBER, type Row, dollars, fiscalLabel, num, orgNumber, segmentCode } from "../records_db";
import { allowed } from "./entitlements";
import {
  BUYERS_MAX, BUYERS_SHOWN, COMPETITORS_MAX, ENDING_SHOWN, type BlockRows, type BlocksRead, type ClaimBlock, type ClaimFrame, type Found,
  SHARE_SOURCES, claimFrame, findOrganizations, followClaim, isShareSource, readBlockCsv, readBlocks, readClaim, shareSegment,
} from "./org_claim";
import { accountPage } from "./pages";
import type { Account } from "./session";

export const ORG_PATH = "/account/organization";

const Csrf: FC<{ account: Account }> = ({ account }) => <input type="hidden" name="csrf" value={account.csrf} />;

const int = (v: unknown): number => num(v) ?? 0;
const day = (iso: string) => iso.slice(0, 10);

// A fiscal year's label, the data date's marked as counted to date.
const fyLabel = (lang: Lang, fy: number, current: number) =>
  fy === current ? t(lang, "analytics.to_date", { fy: fiscalLabel(lang, fy) }) : fiscalLabel(lang, fy);

// The source a record row names, by its number.
const SOURCE_OF: Readonly<Record<number, MoneySource>> = Object.fromEntries(
  Object.entries(SOURCE_NUMBER).map(([s, n]) => [n, s as MoneySource]),
) as Record<number, MoneySource>;

const REGISTRY_NAME: Readonly<Record<string, Key>> = {
  corporations_canada: "registry.corporations_canada", bc_orgbook: "registry.bc_orgbook", quebec_req: "registry.quebec_req",
};
const GRADE: Readonly<Record<string, Key>> = { exact: "registry.grade_exact", probable: "registry.grade_probable", possible: "registry.grade_possible" };

function place(lang: Lang, city: string | null, prov: string | null): string {
  return [city, prov ? provinceName(lang, prov) : null].filter(Boolean).join(", ");
}

// The figures of one source over a span: the records and their counted value.
const Figure: FC<{ lang: Lang; n: number; cents: unknown }> = ({ lang, n, cents }) => (
  <>
    <span class="mono">{tn(lang, "orgclaim.records_one", "orgclaim.records_many", n, { n: fmtInt(n, lang) })}</span>
    {n ? <><br /><span class="muted small mono">{money(lang, dollars(cents))}</span></> : null}
  </>
);

// -- the search and its results -------------------------------------------------------

const SearchForm: FC<{ lang: Lang; q: string; change?: boolean; label: Key }> = ({ lang, q, change, label }) => (
  <form method="get" action={ORG_PATH} class="stack" role="search">
    {change ? <input type="hidden" name="change" value="1" /> : null}
    {lang === "fr" ? <input type="hidden" name="lang" value="fr" /> : null}
    <label>
      {t(lang, label)}
      <input name="q" type="search" maxlength={300} autocomplete="off" spellcheck={false} value={q} />
    </label>
    <p class="muted small">{t(lang, "orgclaim.search_note")}</p>
    <button type="submit" class="btn btn-primary">{t(lang, "orgclaim.search_button")}</button>
  </form>
);

// The results of a search, each with its button: "This is us" to claim it,
// or "Compare" to add it to the organizations compared.
const Results: FC<{ lang: Lang; account: Account; found: Found | undefined; q: string; action: "claim" | "compare"; skip?: readonly string[]; full?: boolean }> = ({
  lang, account, found, q, action, skip = [], full = false,
}) => {
  if (found === undefined || !q.trim()) return null;
  if (found === null) return <p class="muted">{t(lang, "orgclaim.search_unavailable")}</p>;
  if (!found.hits.length) return <p class="muted">{t(lang, "orgclaim.search_none")}</p>;
  const head = t(lang, action === "claim" ? "orgclaim.col_claim" : "orgclaim.col_compare");
  return (
    <>
      <p class="muted small">
        {found.total > found.hits.length
          ? t(lang, "orgclaim.search_first", { n: fmtInt(found.hits.length, lang), total: fmtInt(found.total, lang) })
          : tn(lang, "orgclaim.search_count_one", "orgclaim.search_count_many", found.total, { n: fmtInt(found.total, lang) })}
      </p>
      <div class="table-wrap">
        <Table cols={[
          { kind: "main", label: t(lang, "col.organization") },
          { kind: "region", label: t(lang, "col.city") },
          { kind: "count", label: t(lang, "col.records") },
          { kind: "label", label: head },
        ]}>
          <tbody>
            {found.hits.map((h) => (
              <tr>
                <td data-label={t(lang, "col.organization")}><a href={`/organizations/${h.id}`}>{h.name}</a><br /><span class="mono id muted">{h.id}</span></td>
                <td data-label={t(lang, "col.city")}>{place(lang, h.city, h.prov)}</td>
                <td data-label={t(lang, "col.records")} class="mono num">{fmtInt(h.n, lang)}</td>
                <td data-label={head}>
                  {skip.includes(h.id) ? <span class="muted small">{t(lang, action === "claim" ? "orgclaim.is_yours" : "orgclaim.in_set")}</span>
                    : full ? <span class="muted small">{t(lang, "orgclaim.set_full_short")}</span> : (
                      <form method="post" action={action === "claim" ? ORG_PATH : `${ORG_PATH}/compare`} class="account-inline">
                        <Csrf account={account} />
                        <input type="hidden" name="org" value={h.id} />
                        <input type="hidden" name="lang" value={lang} />
                        <button type="submit" class="btn">{t(lang, action === "claim" ? "orgclaim.this_is_us" : "orgclaim.compare")}</button>
                      </form>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
};

const Notices: FC<{ lines: readonly string[] }> = ({ lines }) => <>{lines.map((m) => <p class="account-notice" role="status">{m}</p>)}</>;

// -- unclaimed --------------------------------------------------------------------------

export function unclaimedView(
  lang: Lang, account: Account, s: { q: string; found: Found | undefined; notices: string[]; errors?: Key[]; current?: { id: string; name: string } | null },
) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "orgclaim.title")} lead={t(lang, "orgclaim.lead")}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      <Notices lines={s.notices} />
      {s.errors?.length ? <ul class="errors" role="alert">{s.errors.map((e) => <li>{t(lang, e)}</li>)}</ul> : null}
      <Panel title={t(lang, "orgclaim.panel_find")} class="panel-form">
        {s.current ? (
          <p>{tj(lang, "orgclaim.changing", { name: <a href={`/organizations/${s.current.id}`}>{s.current.name}</a> })} <a href={ORG_PATH}>{t(lang, "orgclaim.keep")}</a></p>
        ) : null}
        <SearchForm lang={lang} q={s.q} change={!!s.current} label="orgclaim.search_label" />
        <p class="muted small">{t(lang, "orgclaim.private")}</p>
      </Panel>
      {s.q.trim() ? (
        <Panel title={t(lang, "orgclaim.panel_results")}>
          <Results lang={lang} account={account} found={s.found} q={s.q} action="claim" skip={s.current ? [s.current.id] : []} />
        </Panel>
      ) : null}
    </>
  );
}

// -- the blocks ----------------------------------------------------------------------------

const CsvLink: FC<{ lang: Lang; block: ClaimBlock; source?: MoneySource }> = ({ lang, block, source }) => (
  <a href={`${ORG_PATH}/${block}.csv${source && source !== "awards" ? `?source=${source}` : ""}`} rel="nofollow">{t(lang, "analytics.csv")}</a>
);

// A block a Free account does not get: its title with the chip and one line.
const Locked: FC<{ lang: Lang; title: Key; text: string }> = ({ lang, title, text }) => (
  <Panel title={<>{t(lang, title)}<ProTag lang={lang} /></>}>
    <div class="pro-note"><p>{text}</p></div>
  </Panel>
);

// Bars a fiscal year apart, one panel each (one scale when shared): the
// analytics views' chart (pages/analytics.tsx YearChart) on the same pieces.
const YearBars: FC<{ lang: Lang; first: number; last: number; panels: { title: string; values: [number, number][] }[]; fmt: (v: number) => string; shared?: boolean }> = ({
  lang, first, last, panels, fmt, shared,
}) => {
  const axis = fiscalAxis(first, last, (y) => fiscalLabel(lang, y));
  const stack: ChartPanel[] = panels.map((p) => ({
    title: p.title,
    bars: p.values.filter(([, v]) => v > 0).map(([year, v]) => ({ x0: year, x1: year + 1, value: v, title: `${fiscalLabel(lang, year)}: ${fmt(v)}` })),
  }));
  return (
    <div class="chart">
      <ChartStack domain={[first, last + 1]} panels={stack} height={110} xLabels={axis.labels} fmt={fmt}
        aria={t(lang, "analytics.chart_aria")} shared={shared} gap={barGap(last - first + 1)} />
    </div>
  );
};

const none = (lang: Lang, years: number) => <p class="muted">{t(lang, "orgclaim.none_years", { n: fmtInt(years, lang) })}</p>;

// Records by fiscal year, each source apart (ORG_COUNTS_SQL).
const YearsBlock: FC<{ lang: Lang; rows: Row[]; first: number; current: number; pro: boolean }> = ({ lang, rows, first, current, pro }) => {
  const sources = MONEY_SOURCES.filter((s) => rows.some((r) => int(r.src) === SOURCE_NUMBER[s] && int(r.n) > 0));
  const cell = (s: MoneySource, fy: number) => rows.find((r) => int(r.src) === SOURCE_NUMBER[s] && int(r.fy) === fy);
  const years: number[] = [];
  for (let fy = current; fy >= first; fy--) years.push(fy);
  return (
    <Panel title={t(lang, "orgclaim.panel_years")} tools={pro && sources.length ? <CsvLink lang={lang} block="years" /> : undefined}
      foot={pro ? <span>{t(lang, "orgclaim.foot_years")}</span> : (
        <ProNote lang={lang}>
          {t(lang, "orgclaim.free_years", { n: fmtInt(FREE_YEARS, lang), max: fmtInt(MAX_YEARS, lang) })}{" "}
          <a href="/account/billing">{t(lang, "billing.link_plans")}</a>
        </ProNote>
      )}>
      {sources.length ? <>
        <p>{t(lang, "orgclaim.years_lead", { first: fiscalLabel(lang, first), last: fiscalLabel(lang, current) })}</p>
        <YearBars lang={lang} first={first} last={current} fmt={(v) => fmtMoneyShort(v, lang)}
          panels={sources.map((s) => ({
            title: t(lang, "analytics.chart_years", { source: sourceLabel(lang, s) }),
            values: rows.filter((r) => int(r.src) === SOURCE_NUMBER[s]).map((r): [number, number] => [int(r.fy), int(r.cents) / 100]),
          }))} />
        <div class="table-wrap">
          <Table cols={[
            { kind: "main", label: t(lang, "analytics.col_fy") },
            ...sources.map((s) => ({ kind: "tally" as const, label: sourceLabel(lang, s) })),
          ]}>
            <tbody>
              {years.map((fy) => (
                <tr>
                  <td data-label={t(lang, "analytics.col_fy")} class="mono">{fyLabel(lang, fy, current)}</td>
                  {sources.map((s) => {
                    const r = cell(s, fy);
                    return <td data-label={sourceLabel(lang, s)}><Figure lang={lang} n={r ? int(r.n) : 0} cents={r?.cents ?? null} /></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </> : none(lang, current - first + 1)}
    </Panel>
  );
};

// Records by segment, award notices and PSPC history apart, each record once
// (CLAIM_SEGMENTS_SQL); the published contracts and grants, which carry no
// segment, counted beside from the first block.
const SegmentsBlock: FC<{ lang: Lang; rows: Row[]; years: Row[]; f: ClaimFrame }> = ({ lang, rows, years, f }) => {
  const sids = [...new Set(rows.map((r) => int(r.sid)))];
  const of = (src: number, sid: number) => rows.find((r) => int(r.src) === src && int(r.sid) === sid);
  const cents = (src: number, sid: number) => int(of(src, sid)?.cents);
  sids.sort((a, b) => cents(1, b) - cents(1, a) || cents(2, b) - cents(2, a) || a - b);
  const without = (src: number) => years.filter((r) => int(r.src) === src).reduce((sum, r) => sum + int(r.n), 0);
  const cols = SHARE_SOURCES.filter((s) => rows.some((r) => int(r.src) === SOURCE_NUMBER[s]));
  return (
    <Panel title={t(lang, "orgclaim.panel_segments")} tools={rows.length ? <CsvLink lang={lang} block="segments" /> : undefined}
      foot={<span>{t(lang, "orgclaim.foot_segments", { contracts: fmtInt(without(3), lang), grants: fmtInt(without(4), lang) })}</span>}>
      {sids.length ? (
        <div class="table-wrap">
          <Table cols={[{ kind: "main", label: t(lang, "col.segment") }, ...cols.map((s) => ({ kind: "tally" as const, label: sourceLabel(lang, s) }))]}>
            <tbody>
              {sids.map((sid) => {
                const code = segmentCode(sid);
                return (
                  <tr>
                    <td data-label={t(lang, "col.segment")}><a href={`/segments/${code}`}><span class="mono">{code}</span> {segmentLabel(lang, code)}</a></td>
                    {cols.map((s) => {
                      const r = of(SOURCE_NUMBER[s], sid);
                      return <td data-label={sourceLabel(lang, s)}><Figure lang={lang} n={r ? int(r.n) : 0} cents={r?.cents ?? null} /></td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      ) : <p class="muted">{t(lang, "orgclaim.none_segments", { n: fmtInt(MAX_YEARS, lang) })}</p>}
    </Panel>
  );
};

// The organization's share of one segment's counted value by fiscal year,
// beside the organizations the account chose, in its order (ORG_SHARE_SQL,
// ?11 = 0): small multiples on one scale, then the table with the
// segment's whole value, the denominator, in its own column.
const ShareBlock: FC<{
  lang: Lang; account: Account; rows: Row[]; segments: Row[]; f: ClaimFrame; source: MoneySource; chosen: string | null;
  orgs: { oid: number; id: string; name: string }[];
}> = ({ lang, account, rows, segments, f, source, chosen, orgs }) => {
  const segment = shareSegment(chosen, segments, source);
  const options = segments.filter((r) => int(r.src) === SOURCE_NUMBER[source]).map((r) => int(r.sid));
  const largest = options[0] ?? null;
  if (segment !== null && !options.includes(segment)) options.push(segment);
  const years: number[] = [];
  for (let fy = f.current; fy >= f.first; fy--) years.push(fy);
  const whole = new Map<number, number>();
  for (const r of rows) whole.set(int(r.fy), int(r.seg_cents));
  const part = (oid: number, fy: number) => rows.find((r) => num(r.oid) === oid && int(r.fy) === fy);
  const periodWhole = [...whole.values()].reduce((a, b) => a + b, 0);
  const pct = (v: number) => t(lang, "pct", { n: Math.round(v) });
  const tabs = (
    <nav class="tabs toolbar-row" aria-label={t(lang, "analytics.sources_nav")}>
      {SHARE_SOURCES.map((s) => (
        <a href={`${ORG_PATH}${s === "awards" ? "" : `?source=${s}`}`} rel="nofollow" aria-current={s === source ? "page" : undefined}>{sourceLabel(lang, s)}</a>
      ))}
    </nav>
  );
  return (
    <Panel title={t(lang, "orgclaim.panel_share")} tools={segment !== null ? <CsvLink lang={lang} block="share" source={source} /> : undefined}
      foot={<span>{t(lang, "orgclaim.foot_share")}</span>}>
      {tabs}
      {segment === null ? <p class="muted">{t(lang, "orgclaim.none_share", { source: sourceLabel(lang, source), n: fmtInt(MAX_YEARS, lang) })}</p> : <>
        <form method="post" action={`${ORG_PATH}/segment`} class="account-inline">
          <Csrf account={account} />
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="source" value={source} />
          <label class="field">
            <span class="field-label">{t(lang, "col.segment")}</span>
            <select name="segment">
              {largest !== null ? (
                <option value="" selected={chosen === null}>
                  {t(lang, "orgclaim.segment_largest", { segment: `${segmentCode(largest)} ${segmentLabel(lang, segmentCode(largest))}` })}
                </option>
              ) : null}
              {options.map((sid) => (
                <option value={segmentCode(sid)} selected={chosen !== null && Number(chosen) === sid}>{`${segmentCode(sid)} ${segmentLabel(lang, segmentCode(sid))}`}</option>
              ))}
            </select>
          </label>
          <button type="submit" class="btn">{t(lang, "analytics.share_apply")}</button>
        </form>
        <p>{tj(lang, "orgclaim.share_lead", {
          source: sourceLabel(lang, source),
          segment: <a href={`/segments/${segmentCode(segment)}`}><span class="mono">{segmentCode(segment)}</span> {segmentLabel(lang, segmentCode(segment))}</a>,
        })}</p>
        <p class="muted small">{t(lang, "orgclaim.share_caveat")}</p>
        {orgs.length < 2 ? <p class="muted small">{t(lang, "orgclaim.share_alone", { n: fmtInt(COMPETITORS_MAX, lang) })}</p> : null}
        {periodWhole > 0 ? <>
          <YearBars lang={lang} first={f.first} last={f.current} shared fmt={pct}
            panels={orgs.map((o) => ({
              title: o.name,
              values: years.filter((fy) => (whole.get(fy) ?? 0) > 0).map((fy): [number, number] => [fy, (int(part(o.oid, fy)?.cents) / (whole.get(fy) ?? 1)) * 100]),
            }))} />
          <div class="table-wrap">
            <Table cols={[
              { kind: "main", label: t(lang, "analytics.col_fy") },
              { kind: "total", label: t(lang, "orgclaim.col_segment_value") },
              ...orgs.map((o) => ({ kind: "share" as const, label: o.name })),
            ]}>
              <tbody>
                {years.map((fy) => {
                  const w = whole.get(fy) ?? 0;
                  return (
                    <tr>
                      <td data-label={t(lang, "analytics.col_fy")} class="mono">{fyLabel(lang, fy, f.current)}</td>
                      <td data-label={t(lang, "orgclaim.col_segment_value")} class="mono num">{money(lang, w / 100)}</td>
                      {orgs.map((o) => {
                        const c = int(part(o.oid, fy)?.cents);
                        // A year the segment has no counted value has no share to state.
                        return (
                          <td data-label={o.name} class="mono num">
                            {w > 0 ? <>{fmtPct(c, w, lang) || pct(0)}<br /></> : null}<span class="muted small">{money(lang, c / 100)}</span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                <tr>
                  <td data-label={t(lang, "analytics.col_fy")}><strong>{t(lang, "orgclaim.share_period", { n: fmtInt(years.length, lang) })}</strong></td>
                  <td data-label={t(lang, "orgclaim.col_segment_value")} class="mono num">{money(lang, periodWhole / 100)}</td>
                  {orgs.map((o) => {
                    const c = rows.filter((r) => num(r.oid) === o.oid).reduce((sum, r) => sum + int(r.cents), 0);
                    return <td data-label={o.name} class="mono num">{fmtPct(c, periodWhole, lang) || pct(0)}<br /><span class="muted small">{money(lang, c / 100)}</span></td>;
                  })}
                </tr>
              </tbody>
            </Table>
          </div>
        </> : <p class="muted">{t(lang, "orgclaim.none_share_value")}</p>}
      </>}
    </Panel>
  );
};

// The organization's own contracts ending within 12 months: the radar's
// rows for it (/expiring/12m?supplier=), soonest first.
const EndingBlock: FC<{ lang: Lang; id: string; rows: ExpiringRow[]; total: Row | undefined }> = ({ lang, id, rows, total }) => {
  const n = int(total?.n);
  const shown = rows.slice(0, ENDING_SHOWN);
  const all = `/expiring/12m?supplier=${id}`;
  return (
    <Panel title={t(lang, "orgclaim.panel_ending")} count={fmtInt(n, lang)} tools={n ? <CsvLink lang={lang} block="ending" /> : undefined}
      foot={n ? <ExpiringNote lang={lang} /> : undefined}>
      {n && shown.length ? <>
        <p>{tn(lang, "orgclaim.ending_lead_one", "orgclaim.ending_lead_many", n, {
          n: fmtInt(n, lang), date: shown[0].end.slice(0, 10), total: money(lang, dollars(total?.cents)),
        })}</p>
        <ExpiringTable lang={lang} rows={shown} organization={false} csv="list" />
        <p>{n > shown.length
          ? <a href={all}>{t(lang, "orgclaim.ending_all", { n: fmtInt(n, lang) })}</a>
          : <a href={all}>{t(lang, "orgclaim.ending_list")}</a>}</p>
      </> : <p class="muted">{t(lang, "orgclaim.none_ending")}</p>}
    </Panel>
  );
};

// The buyers the organization has records with, each source's records and
// value apart, with what each buyer has open now and ending within 12 months.
const BuyersBlock: FC<{ lang: Lang; id: string; rows: Row[]; open: Map<string, number> | null }> = ({ lang, id, rows, open }) => {
  const shown = rows.slice(0, BUYERS_SHOWN);
  const records = `/organizations/${id}/records`;
  return (
    <Panel title={t(lang, "orgclaim.panel_buyers")} count={fmtInt(rows.length, lang)} tools={rows.length ? <CsvLink lang={lang} block="buyers" /> : undefined}
      foot={rows.length ? <span>{tj(lang, "orgclaim.foot_buyers", {
        n: fmtInt(BUYERS_MAX, lang), shown: fmtInt(shown.length, lang), records: <a href={records}>{t(lang, "orgclaim.records_link")}</a>,
      })}</span> : undefined}>
      {shown.length ? (
        <div class="table-wrap">
          <Table cols={[
            { kind: "main", label: t(lang, "col.buyer") },
            { kind: "tally", label: t(lang, "orgclaim.col_its_records") },
            { kind: "count", label: t(lang, "orgclaim.col_open") },
            { kind: "count", label: t(lang, "orgclaim.col_ending") },
          ]}>
            <tbody>
              {shown.map((r) => {
                const bid = String(r.id);
                const name = pick(lang, typeof r.name_en === "string" ? r.name_en : null, typeof r.name_fr === "string" ? r.name_fr : null) ?? bid;
                const openN = open?.get(bid) ?? null;
                const ending = int(r.n_ending);
                return (
                  <tr>
                    <td data-label={t(lang, "col.buyer")}><a href={`/buyers/${bid}`}>{name}</a></td>
                    <td data-label={t(lang, "orgclaim.col_its_records")}>
                      {[1, 2, 3, 4].filter((s) => int(r[`n${s}`]) > 0).map((s, i) => (
                        <>{i ? <br /> : null}<span class="small">{sourceLabel(lang, SOURCE_OF[s])}: </span><span class="mono small">
                          {fmtInt(int(r[`n${s}`]), lang)} · {money(lang, dollars(r[`c${s}`]))}</span></>
                      ))}
                    </td>
                    <td data-label={t(lang, "orgclaim.col_open")} class="mono num">
                      {openN === null ? "" : openN > 0 ? <a href={`/tenders?buyer=${bid}`}>{fmtInt(openN, lang)}</a> : fmtInt(0, lang)}
                    </td>
                    <td data-label={t(lang, "orgclaim.col_ending")} class="mono num">
                      {ending > 0 ? <a href={`/expiring/12m?buyer=${bid}`}>{fmtInt(ending, lang)}</a> : fmtInt(0, lang)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      ) : <p class="muted">{t(lang, "orgclaim.none_buyers", { n: fmtInt(MAX_YEARS, lang) })}</p>}
    </Panel>
  );
};

// The corporate registry entries matched to the organization, as the profile shows them.
const RegistryBlock: FC<{ lang: Lang; profile: Profile }> = ({ lang, profile }) => (
  <Panel title={t(lang, "orgclaim.panel_registry")}>
    {profile.registry.length ? (
      <dl class="wide">
        {profile.registry.map((r) => (
          <>
            <dt>{REGISTRY_NAME[r.registry] ? t(lang, REGISTRY_NAME[r.registry]) : r.registry}</dt>
            <dd>
              {GRADE[r.grade] ? t(lang, GRADE[r.grade]) : r.grade} · <span class="mono">{r.registry_id}</span>
              {r.legal_name ? ` · ${r.legal_name}` : ""}{r.status ? ` · ${r.status}` : ""}
              {r.registered_on ? ` · ${t(lang, "registry.registered", { date: r.registered_on })}` : ""}
            </dd>
          </>
        ))}
      </dl>
    ) : <p class="muted">{t(lang, "registry.none")}</p>}
  </Panel>
);

// -- claimed -----------------------------------------------------------------------------------

export interface ClaimedState {
  id: string;
  profile: Profile | null;
  createdAt: string;
  competitors: { id: string; name: string }[];
  notices: string[];
  q: string;
  found: Found | undefined;
  pro: boolean;
  frame: ClaimFrame;
  source: MoneySource;
  segment: string | null;
  // null when the profile is gone and nothing was read.
  read: BlocksRead | null;
  open: Map<string, number> | null;
  errors?: Key[];
}

export function claimedView(lang: Lang, account: Account, s: ClaimedState) {
  const name = s.profile?.organization.display_name ?? s.id;
  const o = s.profile?.organization;
  const full = s.competitors.length >= COMPETITORS_MAX;
  const rows: BlockRows = s.read?.state === "ready" ? s.read.rows : {};
  const orgs = [{ oid: orgNumber(s.id) ?? -1, id: s.id, name }, ...s.competitors.map((c) => ({ oid: orgNumber(c.id) ?? -1, id: c.id, name: c.name }))];
  const ending = (rows.ending ?? []).map((r) => radarRow(r, s.frame.today)).filter((r): r is ExpiringRow => r !== null);
  return (
    <>
      <PageHead lang={lang} title={t(lang, "orgclaim.title")}
        lead={tj(lang, "orgclaim.lead_claimed", { name: <a href={`/organizations/${s.id}`}>{name}</a> })}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      <Notices lines={s.notices} />
      {s.errors?.length ? <ul class="errors" role="alert">{s.errors.map((e) => <li>{t(lang, e)}</li>)}</ul> : null}
      <Panel title={t(lang, "orgclaim.panel_claim")}>
        <dl class="wide">
          <dt>{t(lang, "col.organization")}</dt>
          <dd><a href={`/organizations/${s.id}`}>{name}</a> <span class="mono id muted">{s.id}</span></dd>
          {o && place(lang, o.city, o.province) ? <><dt>{t(lang, "col.city")}</dt><dd>{place(lang, o.city, o.province)}</dd></> : null}
          <dt>{t(lang, "orgclaim.field_since")}</dt><dd class="mono">{day(s.createdAt)}</dd>
        </dl>
        <p>{t(lang, "orgclaim.private_claimed")}</p>
        <div class="account-actions">
          <a href={`${ORG_PATH}?change=1`} class="btn">{t(lang, "orgclaim.change")}</a>
          <form method="post" action={`${ORG_PATH}/delete`}>
            <Csrf account={account} />
            <input type="hidden" name="lang" value={lang} />
            <button type="submit" class="btn">{t(lang, "orgclaim.remove_claim")}</button>
          </form>
        </div>
      </Panel>
      <Panel title={t(lang, "orgclaim.panel_compare")} count={t(lang, "orgclaim.compare_n", { n: fmtInt(s.competitors.length, lang), max: fmtInt(COMPETITORS_MAX, lang) })}
        foot={<span>{t(lang, "orgclaim.foot_compare", { n: fmtInt(COMPETITORS_MAX, lang) })}</span>}>
        {s.competitors.length ? (
          <ul class="kv">
            {s.competitors.map((c) => (
              <li>
                <a href={`/organizations/${c.id}`}>{c.name}</a>
                <form method="post" action={`${ORG_PATH}/compare/remove`} class="account-inline">
                  <Csrf account={account} />
                  <input type="hidden" name="org" value={c.id} />
                  <input type="hidden" name="lang" value={lang} />
                  <button type="submit" class="btn-link">{t(lang, "orgclaim.compare_remove")}</button>
                </form>
              </li>
            ))}
          </ul>
        ) : <p class="muted">{t(lang, "orgclaim.compare_none", { n: fmtInt(COMPETITORS_MAX, lang) })}</p>}
        {full ? <p class="muted small">{t(lang, "orgclaim.set_full", { n: fmtInt(COMPETITORS_MAX, lang) })}</p>
          : <SearchForm lang={lang} q={s.q} label="orgclaim.compare_label" />}
        <Results lang={lang} account={account} found={s.found} q={s.q} action="compare" skip={[s.id, ...s.competitors.map((c) => c.id)]} full={full} />
      </Panel>
      {s.read === null ? (
        <Panel title={t(lang, "orgclaim.gone_title")}><p>{t(lang, "orgclaim.gone_text")}</p></Panel>
      ) : s.read.state !== "ready" ? (
        <Panel title={t(lang, "orgclaim.unavailable_title")}>
          <p>{t(lang, s.read.state === "loading" ? "analytics.unavailable_loading" : "orgclaim.unavailable_text")}</p>
        </Panel>
      ) : <>
        <YearsBlock lang={lang} rows={rows.years ?? []} first={s.pro ? s.frame.first : s.frame.freeFirst} current={s.frame.current} pro={s.pro} />
        {s.pro ? <>
          <SegmentsBlock lang={lang} rows={rows.segments ?? []} years={rows.years ?? []} f={s.frame} />
          <ShareBlock lang={lang} account={account} rows={rows.share ?? []} segments={rows.segments ?? []} f={s.frame} source={s.source}
            chosen={s.segment} orgs={orgs} />
          <EndingBlock lang={lang} id={s.id} rows={ending} total={rows.endingTotal?.[0]} />
          <BuyersBlock lang={lang} id={s.id} rows={rows.buyers ?? []} open={s.open} />
          {s.profile ? <RegistryBlock lang={lang} profile={s.profile} /> : null}
        </> : <>
          <Locked lang={lang} title="orgclaim.panel_segments" text={t(lang, "orgclaim.tease_segments")} />
          <Locked lang={lang} title="orgclaim.panel_share" text={t(lang, "orgclaim.tease_share", { n: fmtInt(COMPETITORS_MAX, lang) })} />
          <Locked lang={lang} title="orgclaim.panel_ending" text={t(lang, "orgclaim.tease_ending")} />
          <Locked lang={lang} title="orgclaim.panel_buyers" text={t(lang, "orgclaim.tease_buyers")} />
          <Locked lang={lang} title="orgclaim.panel_registry" text={t(lang, "orgclaim.tease_registry")} />
        </>}
        <p class="muted small">
          {s.read.asOf ? t(lang, "analytics.as_of", { date: s.read.asOf }) : null}{" "}
          {tj(lang, "analytics.rules", { methodology: <a href="/methodology#analytics">{t(lang, "analytics.rules_link")}</a> })}
        </p>
      </>}
    </>
  );
}

// -- the page --------------------------------------------------------------------------------

// The line after a post (?m=), by what it did.
const NOTICE: Readonly<Record<string, Key>> = {
  claimed: "orgclaim.msg_claimed", unclaimed: "orgclaim.msg_unclaimed", added: "orgclaim.msg_added", removed: "orgclaim.msg_compare_removed",
  exists: "orgclaim.msg_exists", self: "orgclaim.msg_self", full: "orgclaim.msg_full", busy: "orgclaim.msg_busy", segment: "orgclaim.msg_segment",
};

const sourceOf = (c: Context<AppEnv>): MoneySource => {
  const v = (c.req.query("source") ?? "").trim().toLowerCase();
  return isShareSource(v) ? v : "awards";
};

async function dataDate(c: Context<AppEnv>): Promise<string> {
  const stats = await loadStats(c.env).catch(() => null);
  return todayOf(stats?.data_as_of ?? new Date().toISOString());
}

// The open notices of each buyer now, from the buyers index; null when it cannot be read.
async function openNotices(c: Context<AppEnv>): Promise<Map<string, number> | null> {
  const index = await loadBuyers(c.env).catch(() => null);
  return index ? new Map(index.buyers.map((b) => [b.id, b.n_open_tenders ?? 0])) : null;
}

// /account/organization: the claim (followed to the live profiles), the
// search the address asks for, and the blocks in one records batch.
export async function orgPage(c: Context<AppEnv>, who: Account, extra: { errors?: Key[]; status?: number } = {}): Promise<Response> {
  const lang = c.get("lang");
  const q = (c.req.query("q") ?? "").slice(0, 300);
  const m = c.req.query("m") ?? "";
  const notices = NOTICE[m] ? [t(lang, NOTICE[m])] : [];
  const stored = await readClaim(c.env, who.userId);
  const change = c.req.query("change") === "1";
  if (!stored || change) {
    const found = q.trim() ? await findOrganizations(c.env, q) : undefined;
    let current: { id: string; name: string } | null = null;
    if (stored) {
      const f = await followClaim(c.env, who.userId, stored);
      current = { id: f.claim.organizationId, name: f.own?.organization.display_name ?? f.claim.organizationId };
    }
    return accountPage(c, t(lang, "orgclaim.title"), unclaimedView(lang, who, { q, found, notices, errors: extra.errors, current }), extra.status ?? 200);
  }
  const f = await followClaim(c.env, who.userId, stored);
  if (f.moved) notices.push(t(lang, "orgclaim.msg_moved"));
  if (f.repointed) notices.push(tn(lang, "orgclaim.msg_repointed_one", "orgclaim.msg_repointed_many", f.repointed, { n: fmtInt(f.repointed, lang) }));
  if (f.dropped) notices.push(tn(lang, "orgclaim.msg_dropped_one", "orgclaim.msg_dropped_many", f.dropped, { n: fmtInt(f.dropped, lang) }));
  const id = f.claim.organizationId;
  const oid = orgNumber(id);
  const pro = allowed(who, "analytics");
  const frame = claimFrame(await dataDate(c));
  const source = sourceOf(c);
  const segment = f.claim.segment;
  const competitors = f.competitors.map((x) => ({ id: x.id, name: x.profile.organization.display_name }));
  const [read, found, open] = await Promise.all([
    f.own && oid !== null
      ? readBlocks(c.env, oid, competitors.map((x) => orgNumber(x.id) ?? -1), { pro, source, segment: segment === null ? null : Number(segment), frame })
      : Promise.resolve(null),
    q.trim() ? findOrganizations(c.env, q) : Promise.resolve(undefined),
    pro && f.own ? openNotices(c) : Promise.resolve(null),
  ]);
  return accountPage(c, t(lang, "orgclaim.title"), claimedView(lang, who, {
    id, profile: f.own, createdAt: f.claim.createdAt, competitors, notices, q, found, pro, frame, source, segment, read, open, errors: extra.errors,
  }), extra.status ?? 200);
}

// -- the CSV files ---------------------------------------------------------------------------

const cad = (cents: unknown) => {
  const v = num(cents);
  return v === null ? null : (v / 100).toFixed(2);
};

function csvTable(block: ClaimBlock, rows: Row[][], ctx: {
  frame: ClaimFrame; source: MoneySource; chosen: string | null; orgs: { oid: number; id: string; name: string }[]; open: Map<string, number> | null;
}): [string[], unknown[][]] {
  const list = rows[0] ?? [];
  const fy = (y: number) => [y, fiscalLabel("en", y)];
  if (block === "years") {
    return [["fiscal_year", "fiscal_year_label", "source", "records", "value_cad"],
      list.map((r) => [...fy(int(r.fy)), SOURCE_OF[int(r.src)] ?? "", int(r.n), cad(r.cents)])];
  }
  if (block === "segments") {
    return [["segment", "segment_title", "source", "records", "value_cad"],
      list.map((r) => [segmentCode(int(r.sid)), segmentLabel("en", segmentCode(int(r.sid))), SOURCE_OF[int(r.src)] ?? "", int(r.n), cad(r.cents)])];
  }
  if (block === "share") {
    const segment = shareSegment(ctx.chosen, rows[1] ?? [], ctx.source);
    const whole = new Map(list.map((r) => [int(r.fy), int(r.seg_cents)]));
    const out: unknown[][] = [];
    for (let y = ctx.frame.first; y <= ctx.frame.current; y++) {
      const w = whole.get(y) ?? 0;
      for (const o of ctx.orgs) {
        const r = list.find((x) => num(x.oid) === o.oid && int(x.fy) === y);
        const c = int(r?.cents);
        out.push([segment === null ? "" : segmentCode(segment), ctx.source, ...fy(y), cad(w), o.id, o.name, int(r?.n), cad(c),
          w > 0 ? ((c / w) * 100).toFixed(1) : null]);
      }
    }
    return [["segment", "source", "fiscal_year", "fiscal_year_label", "segment_value_cad", "organization_id", "organization", "records", "value_cad",
      "share_pct"], out];
  }
  if (block === "ending") {
    const ending = list.map((r) => radarRow(r, ctx.frame.today)).filter((r): r is ExpiringRow => r !== null);
    const cell = (r: ExpiringRow, k: (typeof RADAR_CSV_COLUMNS)[number]): unknown => {
      const v = (r as unknown as Record<string, unknown>)[k];
      if (k === "reference") return contractReference(r);
      if (Array.isArray(v)) return v.join(" ");
      if (k === "competitive") return v === true || v === 1 ? 1 : v === false || v === 0 ? 0 : null;
      return v;
    };
    return [[...RADAR_CSV_COLUMNS], ending.map((r) => RADAR_CSV_COLUMNS.map((k) => cell(r, k)))];
  }
  const head = ["buyer_id", "buyer", "buyer_fr", "records"];
  for (const s of MONEY_SOURCES) head.push(`records_${s}`, `value_${s}_cad`);
  head.push("open_notices", "contracts_ending_12m");
  return [head, list.map((r) => [
    String(r.id), r.name_en ?? "", r.name_fr ?? "", int(r.n),
    ...MONEY_SOURCES.flatMap((s) => [int(r[`n${SOURCE_NUMBER[s]}`]), cad(r[`c${SOURCE_NUMBER[s]}`])]),
    ctx.open?.get(String(r.id)) ?? null, int(r.n_ending),
  ])];
}

// A block as a CSV file: Pro only (anyone else gets the site's 404, as the
// analytics files do), the claimed organization's alone, read with that
// block's statement, sent private and never kept; 503 while the records
// database cannot answer.
export async function orgCsv(c: Context<AppEnv>, who: Account, block: ClaimBlock): Promise<Response> {
  const lang = c.get("lang");
  if (!allowed(who, "analytics")) return c.notFound();
  const stored = await readClaim(c.env, who.userId);
  if (!stored) return c.notFound();
  const f = await followClaim(c.env, who.userId, stored);
  const id = f.claim.organizationId;
  const oid = orgNumber(id);
  if (!f.own || oid === null) return c.notFound();
  const frame = claimFrame(await dataDate(c));
  const source = sourceOf(c);
  const orgs = [{ oid, id, name: f.own.organization.display_name },
    ...f.competitors.map((x) => ({ oid: orgNumber(x.id) ?? -1, id: x.id, name: x.profile.organization.display_name }))];
  const segment = f.claim.segment === null ? null : Number(f.claim.segment);
  const [read, open] = await Promise.all([
    readBlockCsv(c.env, block, oid, orgs.slice(1).map((o) => o.oid), { source, segment, frame }),
    block === "buyers" ? openNotices(c) : Promise.resolve(null),
  ]);
  if (read.state !== "ready") {
    c.header("Retry-After", "3600");
    c.header("Cache-Control", "private, no-store");
    return c.text(t(lang, read.state === "loading" ? "analytics.unavailable_loading" : "orgclaim.unavailable_text"), 503);
  }
  const [head, body] = csvTable(block, read.rows, { frame, source, chosen: f.claim.segment, orgs, open });
  const text = [head, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const name = `organization-${id}-${block}${block === "share" ? `-${source}` : ""}-${frame.today}.csv`;
  return new Response(text, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name.replace(/[^a-z0-9.-]/gi, "-")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

// The page's segment choice: one of the 57, or "" for the organization's largest.
export const segmentChoice = (raw: string | undefined): string | null | false =>
  !raw ? null : SEGMENT_CODES.includes(raw) ? raw : false;
