// /contracts/:dept/:reference: one published contract (the proactive
// disclosure of contracts over $10,000), from the records database
// (src/records_tables.ts PUBLISHED_CONTRACT_SQL, one bounded statement), with
// the other rows of the same contract (its amendments: the rows sharing the
// department and procurement_id). A reference is unique within one
// department only, so the address names both. The government's contracts
// search stays linked as the source, a secondary link: it often lists
// nothing yet for a new quarter.
//
// The records database missing, loading or failing answers 503 with that
// search; a row it does not hold answers 404 with the same link.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { Table } from "../columns";
import { BUYER_ID_RE, loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, pick, t, tj, tn, type Key, type Lang } from "../i18n";
import { CompetitiveFlag, Layout, PageHead, Panel, noDataPage, page, todayOf } from "../layout";
import { dollars, num } from "../records_db";
import { CONTRACT_VERSIONS_MAX, readPublishedContract, type Row } from "../records_tables";
import { breadcrumbJsonLd, clip, pageTitle, type Seo } from "../seo";
import { windowOf } from "./expiring";
import { BuyerLink, contractPath, contractSearchUrl, datasetUrl, money, otherLanguageMark } from "./shared";

// The longest reference the address takes (records_db.REF_MAX in the pipeline).
export const REF_MAX = 200;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

// The solicitation procedure codes (TBS guide) and their names on the site.
const PROCEDURE: Record<string, Key> = {
  OB: "method.open", TC: "method.traditional", ST: "method.selective", TN: "method.non_competitive", AC: "method.acan",
};
const COMMODITY: Record<string, Key> = { G: "cat.GD", S: "cat.SRV", C: "cat.CNST" };
const INSTRUMENT: Record<string, Key> = {
  C: "published.inst_C", A: "published.inst_A", SO: "published.inst_SO", SA: "published.inst_SA",
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const Item: FC<{ lang: Lang; k: Key; v: unknown }> = ({ lang, k, v }) =>
  v === null || v === undefined || v === "" ? null : (
    <>
      <dt>{t(lang, k)}</dt>
      <dd>{v as any}</dd>
    </>
  );

// A code and its name: "TN Non-competitive"; the code alone when the site has no name for it.
function coded(lang: Lang, code: string | null, names: Record<string, Key>): unknown {
  if (!code) return null;
  const key = names[code.toUpperCase()];
  return <><span class="mono">{code}</span>{key ? ` ${t(lang, key)}` : ""}</>;
}

// Cents as published, in Canadian dollars (the dataset's amounts are).
const cad = (lang: Lang, cents: unknown): string | null => {
  const v = dollars(cents);
  return v === null ? null : money(lang, v);
};

const Paragraphs: FC<{ text: string }> = ({ text }) => <div class="prose">{text.split(/\n{2,}/).map((p) => <p>{p}</p>)}</div>;

function supplierOf(lang: Lang, r: Row): unknown {
  if (num(r.wh) === 1) return <span class="muted">{t(lang, "expiring.withheld")}</span>;
  const oid = num(r.oid);
  if (oid === null) return <span class="muted">{t(lang, "common.not_stated")}</span>;
  const id = `org-${oid.toString(16).padStart(10, "0")}`;
  return <a href={`/organizations/${id}`}>{str(r.org_name) ?? id}</a>;
}

export async function publishedContractPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const rawDept = c.req.param("dept") ?? "";
  const ref = c.req.param("reference") ?? "";
  const dept = rawDept.toLowerCase();
  if (!BUYER_ID_RE.test(dept) || dept.length > 80 || !ref || ref.length > REF_MAX || CONTROL_RE.test(ref)) return c.notFound();
  const path = contractPath(dept, ref);
  if (rawDept !== dept) {
    c.header("Cache-Control", "public, max-age=300");
    return c.redirect(`${path}${new URL(c.req.url).search}`, 301);
  }
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "published.title");
  const search = contractSearchUrl(ref);
  const read = await readPublishedContract(c.env, dept, ref);
  if (read.state !== "ready") {
    c.header("Retry-After", "3600");
    return page(
      c,
      <Layout lang={lang} title={t(lang, "published.title")} dataAsOf={stats.data_as_of}>
        <PageHead lang={lang} eyebrow={t(lang, "published.title")} title={ref}
          lead={t(lang, read.state === "loading" ? "analytics.unavailable_loading" : "published.unavailable")}
          actions={<a href={search} class="btn" rel="nofollow noopener">{t(lang, "published.search")}</a>} />
      </Layout>,
      503,
    );
  }
  const rows = read.rows[0] ?? [];
  const d = rows.find((r) => num(r.self) === 1);
  if (!d) {
    return page(
      c,
      <Layout lang={lang} title={t(lang, "published.not_found")} dataAsOf={stats.data_as_of}>
        <PageHead lang={lang} title={t(lang, "published.not_found")}
          lead={tj(lang, "published.not_found_text", {
            reference: <span class="mono">{ref}</span>,
            search: <a href={search} rel="nofollow noopener">{t(lang, "published.search")}</a>,
          })} />
      </Layout>,
      404,
    );
  }
  const others = rows.filter((r) => num(r.self) !== 1);
  const more = others.length > CONTRACT_VERSIONS_MAX;
  const shown = others.slice(0, CONTRACT_VERSIONS_MAX);
  // Every version, oldest first: the radar reads the contract's end from its newest.
  const versions = [...shown, d].sort((a, b) => {
    const x = `${str(a.cdate) ?? ""}|${String(a.ref)}`;
    const y = `${str(b.cdate) ?? ""}|${String(b.ref)}`;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const newest = more ? null : versions[versions.length - 1];
  const isNewest = !more && newest === d;

  const description = pick(lang, str(d.desc_en), str(d.desc_fr));
  const descriptionMark = otherLanguageMark(lang, str(d.desc_en), str(d.desc_fr));
  const comments = pick(lang, str(d.com_en), str(d.com_fr));
  const commentsMark = otherLanguageMark(lang, str(d.com_en), str(d.com_fr));
  const title = description ? description.split("\n")[0].slice(0, 200) : ref;
  const buyerName = pick(lang, str(d.buyer_en), str(d.buyer_fr)) ?? dept;
  const buyerId = str(d.buyer_id);
  const crumbs = [
    { name: t(lang, "common.home"), path: "/" },
    { name: buyerName, path: buyerId ? `/buyers/${buyerId}` : undefined },
    { name: ref },
  ];
  const today = todayOf(stats.data_as_of);
  const end = str(d.endd);
  const daysLeft = end ? daysBetween(today, end) : null;
  // The radar window, read from this row's end only when it is the contract's
  // newest version, as the radar reads it.
  const window = daysLeft !== null && (isNewest || versions.length === 1) ? windowOf(daysLeft) : null;
  const daysText = daysLeft === null ? "" : daysLeft === 0 ? t(lang, "contract.ends_today")
    : tn(lang, "contract.days_left_one", "contract.days_left_many", daysLeft, { n: fmtInt(daysLeft, lang) });
  const counted = dollars(d.counted);
  const vnote = num(d.vnote);
  // The contract's value as the radar adds it: the versions' counted values, when every version is listed.
  const groupTotal = versions.length > 1 && !more ? versions.reduce((s, v) => s + (num(v.counted) ?? 0), 0) / 100 : null;
  const source = stats.sources.find((s) => s.source === "contracts");
  const lastRead = source?.last_read ? source.last_read.slice(0, 10) : null;
  const supplier = supplierOf(lang, d);
  const seo: Seo = {
    path,
    title: pageTitle(clip(title, 90)),
    socialTitle: title,
    description: clip(t(lang, "published.description", {
      reference: ref, buyer: buyerName, date: str(d.cdate) ?? t(lang, "common.na"),
      supplier: num(d.wh) === 1 ? t(lang, "expiring.withheld") : str(d.org_name) ?? t(lang, "common.na"),
    })),
    jsonLd: [breadcrumbJsonLd(crumbs)],
  };

  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats.data_as_of} seo={seo}>
      <PageHead lang={lang} crumbs={crumbs} eyebrow={t(lang, "published.title")} title={title}
        lead={<>
          {[
            supplier,
            num(d.value) !== null ? cad(lang, d.value) : null,
            end ? t(lang, daysLeft !== null && daysLeft < 0 ? "contract.lead_ended" : "contract.lead_ends", { date: end }) : null,
          ].filter((x) => x !== null).map((x, i) => <>{i > 0 ? " · " : null}{x}</>)}
        </>}
        actions={<>
          <a href={search} class="btn" rel="nofollow noopener">{t(lang, "published.search")}</a>
          <a href={datasetUrl("contracts", lang)} class="btn" rel="noopener">{t(lang, "contract.history_dataset")}</a>
        </>}>
        <p class="page-note"><span class="mono">{ref}</span> <CompetitiveFlag lang={lang} value={num(d.comp) as 0 | 1 | null} /></p>
      </PageHead>

      <div class="panel-grid">
        <Panel title={t(lang, "contract.parties")}>
          <dl>
            <Item lang={lang} k="contract.supplier" v={supplier} />
            <Item lang={lang} k="grant.department" v={<BuyerLink lang={lang} id={buyerId} en={str(d.buyer_en) ?? dept} fr={str(d.buyer_fr)} />} />
          </dl>
        </Panel>
        <Panel title={t(lang, "contract.value")}>
          <dl>
            <Item lang={lang} k="published.value" v={cad(lang, d.value)} />
            <Item lang={lang} k="published.original" v={cad(lang, d.orig)} />
            <Item lang={lang} k="published.amendment" v={cad(lang, d.amend)} />
            <Item lang={lang} k="contract.value_counted" v={counted === null ? t(lang, vnote === 3 ? "published.counted_flagged" : "common.not_stated") : money(lang, counted)} />
            <Item lang={lang} k="published.group_total" v={groupTotal === null ? null : money(lang, groupTotal)} />
          </dl>
          <p class="muted small">{tj(lang, "published.value_note", { rules: <a href="/methodology#counting">{t(lang, "expiring.rules_link")}</a> })}</p>
        </Panel>
      </div>

      <div class="panel-grid">
        <Panel title={t(lang, "tender.dates")}>
          <dl>
            <Item lang={lang} k="published.contract_date" v={str(d.cdate)} />
            <Item lang={lang} k="contract.start" v={str(d.start)} />
            <Item lang={lang} k="contract.end" v={end ? <>
              {end}
              {window ? <> · <a href={`/expiring/${window}`} class="small">{daysText}</a></> : null}
            </> : null} />
            <Item lang={lang} k="published.period" v={str(d.period)} />
          </dl>
          {end && !window && versions.length > 1 ? <p class="muted small">{t(lang, "published.window_newest")}</p> : null}
        </Panel>
        <Panel title={t(lang, "tender.procurement")}>
          <dl>
            <Item lang={lang} k="published.procedure" v={coded(lang, str(d.proc), PROCEDURE)} />
            <Item lang={lang} k="col.method" v={<CompetitiveFlag lang={lang} value={num(d.comp) as 0 | 1 | null} />} />
            <Item lang={lang} k="contract.instrument" v={coded(lang, str(d.inst), INSTRUMENT)} />
            <Item lang={lang} k="published.commodity" v={coded(lang, str(d.ctype), COMMODITY)} />
            <Item lang={lang} k="tender.gsin" v={str(d.gsin) ? <><span class="mono">{str(d.gsin)}</span> {pick(lang, str(d.gsin_en), str(d.gsin_fr)) ?? ""}</> : null} />
            <Item lang={lang} k="published.agreement" v={str(d.agr) ? <span class="mono">{str(d.agr)}</span> : null} />
            <Item lang={lang} k="tender.trade_agreements" v={str(d.trade) ? <span class="mono">{str(d.trade)}</span> : null} />
            <Item lang={lang} k="published.limited_reason" v={str(d.ltr) ? <span class="mono">{str(d.ltr)}</span> : null} />
            <Item lang={lang} k="published.bids" v={num(d.bids) === null ? null : fmtInt(num(d.bids), lang)} />
            <Item lang={lang} k="published.standing_offer" v={str(d.so_no) ? <span class="mono">{str(d.so_no)}</span> : null} />
            <Item lang={lang} k="contract.procurement_number" v={str(d.pid) ? <span class="mono">{str(d.pid)}</span> : null} />
          </dl>
          <p class="muted small">{t(lang, "published.codes_note")}</p>
        </Panel>
      </div>

      {description ? (
        <Panel title={descriptionMark ? `${t(lang, "tender.description_heading")} ${descriptionMark}` : t(lang, "tender.description_heading")}>
          <Paragraphs text={description} />
        </Panel>
      ) : null}

      {comments ? (
        <Panel title={commentsMark ? `${t(lang, "published.comments")} ${commentsMark}` : t(lang, "published.comments")}>
          <Paragraphs text={comments} />
        </Panel>
      ) : null}

      {versions.length > 1 ? (
        <Panel title={t(lang, "published.versions")} count={more ? t(lang, "published.versions_more", { n: fmtInt(CONTRACT_VERSIONS_MAX + 1, lang) }) : fmtInt(versions.length, lang)}
          foot={more ? t(lang, "published.versions_cut", { n: fmtInt(CONTRACT_VERSIONS_MAX, lang) }) : undefined}>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "date", label: t(lang, "published.contract_date") },
              { kind: "main", label: t(lang, "col.record") },
              { kind: "label", label: t(lang, "contract.instrument") },
              { kind: "value", label: t(lang, "published.amendment") },
              { kind: "value", label: t(lang, "published.value") },
              { kind: "value", label: t(lang, "contract.value_counted") },
            ]}>
              <tbody>
                {versions.map((v) => {
                  const vref = String(v.ref);
                  const self = num(v.self) === 1;
                  return (
                    <tr>
                      <td data-label={t(lang, "published.contract_date")} class="mono">{str(v.cdate) ?? ""}</td>
                      <td data-label={t(lang, "col.record")} class="mono">
                        {self ? <strong>{vref}</strong> : <a href={contractPath(dept, vref)}>{vref}</a>}
                        {v === newest ? <> <span class="tag">{t(lang, "published.newest")}</span></> : null}
                      </td>
                      <td data-label={t(lang, "contract.instrument")}>{str(v.inst) ? (INSTRUMENT[String(v.inst).toUpperCase()] ? t(lang, INSTRUMENT[String(v.inst).toUpperCase()]) : String(v.inst)) : ""}</td>
                      <td data-label={t(lang, "published.amendment")} class="mono num">{cad(lang, v.amend) ?? ""}</td>
                      <td data-label={t(lang, "published.value")} class="mono num">{cad(lang, v.value) ?? ""}</td>
                      <td data-label={t(lang, "contract.value_counted")} class="mono num">{cad(lang, v.counted) ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </Panel>
      ) : null}

      <p class="page-foot-note">
        {tj(lang, "published.provenance", {
          dataset: <a href={datasetUrl("contracts", lang)} rel="noopener">{t(lang, "source.dataset.contracts")}</a>,
          file: <span class="mono">{source?.file ?? "contracts.csv"}</span>,
          read: lastRead ?? t(lang, "common.na"),
          as_of: read.asOf ?? t(lang, "common.na"),
          data: <a href="/data#sources">{t(lang, "nav.data")}</a>,
        })}
      </p>
    </Layout>,
  );
}

// Re-exported for the tests, which build addresses as the links do.
export { contractPath };
