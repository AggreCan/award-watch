// /account/matches: the open tender notices ranked by what each has in common
// with the records of the organization the account claims (org_claim.ts),
// scored at request time by public/fit.js against the profile's "matching"
// block (docs/accounts.md, Matching notices). routes.tsx mounts the page.
//
// The page reads the claim (one accounts row), the profile entry, stats.json
// and, once the block allows a ranking, tenders/open.json and
// tenders/open-levels.json, both kept parsed while their ETags hold. It never
// reads the records database and never writes. Free lists the first
// RULES.free.matches notices; Pro up to RULES.pro.matches, MATCH_PAGE a page;
// Ultra up to RULES.ultra.matches (matchCap reads the reader's own plan).
//
// The states, each with the disclaimer: no claim (the page's one filled
// button leads to the claim), the profile gone from the data, a profile
// written before the block existed (matches come with the next nightly), no
// record in the window, published contracts only, too few records with codes,
// and the ranking. A match is never a statement about the business: the band
// names the match, every reason is a record count with its points, and the
// lines under the list say what a match is not.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { MATCH_MIN, blockState, rankNotices, type Score } from "../../public/fit.js";
import { clockOf, closingPassed, closingText } from "../closing";
import { Table } from "../columns";
import { type Profile, type TenderRow, loadBuyers, loadOpenLevels, loadOpenList, loadStats, publishedReference } from "../data";
import type { AppEnv } from "../env";
import {
  FitDisclaimer, MatchBand, MatchReasons, type MatchBlock, type ReasonContext, countsText, levelText, matchingWindow, profileMatching,
} from "../fit";
import { fmtInt, pick, provinceName, t, tj, tn, type Lang } from "../i18n";
import { PageHead, Panel } from "../layout";
import { typeLabel } from "../pages/instruments";
import { TYPE_CODES, type TypeCode } from "../instruments";
import { fiscalLabel } from "../records_db";
import { MATCH_PAGE, type Plan, RULES, matchCap } from "./entitlements";
import { checkOrganization, readClaim } from "./org_claim";
import { ORG_PATH } from "./org_pages";
import { accountPage } from "./pages";
import { missingTable } from "./records_deliveries";
import type { Account } from "./session";

export const MATCH_PATH = "/account/matches";
// The entries of each kind the basis panel names; the counts line under it covers them all.
export const BASIS_SHOWN = 5;

type Ranked = { row: TenderRow; score: Score };

// What the page shows, once read.
export type MatchesState =
  | { kind: "unclaimed" }
  | { kind: "gone"; id: string }
  | { kind: "pending"; id: string; name: string }
  | { kind: "empty"; id: string; name: string; fy: [number, number] }
  | { kind: "uncoded" | "thin"; id: string; name: string; block: MatchBlock }
  | {
    // The reader's plan, whose cap the list keeps (matchCap); pro: a paid plan, which pages the list.
    kind: "ready"; id: string; name: string; block: MatchBlock; profile: Profile; plan: Plan; pro: boolean;
    // null when the open notices cannot be read.
    list: { matches: Ranked[]; uncoded: number } | null;
    page: number; levels: Parameters<typeof levelText>[2]; buyerNames: Map<string, string>; typeNames: Map<string, string>;
  };

const fy = (lang: Lang, block: { fy: [number, number] } | [number, number]) => {
  const [first, last] = Array.isArray(block) ? block : block.fy;
  return { first: fiscalLabel(lang, first), last: fiscalLabel(lang, last) };
};

// -- the panels ------------------------------------------------------------------------

// The organization's side: its classes, buyers, provinces, notice types and
// held instruments, the first BASIS_SHOWN of each by the block's order, then
// what they were counted from.
const BasisPanel: FC<{ lang: Lang; s: Extract<MatchesState, { kind: "ready" }> }> = ({ lang, s }) => {
  const b = s.block;
  const lines = (items: unknown[]) => (items.length ? <ul class="plain">{items.map((x) => <li>{x as any}</li>)}</ul> : null);
  const row = (label: unknown, counts: readonly number[]) => tj(lang, "fit.basis_row", { label, counts: countsText(lang, counts) });
  const classes = b.classes.slice(0, BASIS_SHOWN).map(([code, ...n]) => row(levelText(lang, code, s.levels), n));
  const buyers = b.buyers.slice(0, BASIS_SHOWN).map(([id, ...n]) => row(<a href={`/buyers/${id}`}>{s.buyerNames.get(id) ?? id}</a>, n));
  const provinces = b.provinces.slice(0, BASIS_SHOWN).map(([code, ...n]) => row(provinceName(lang, code), n));
  const types = b.types.slice(0, BASIS_SHOWN).map(([type, ...n]) => row(s.typeNames.get(type) ?? type, n));
  const held = b.held.map(([type, code, n]) => t(lang, "fit.held_row", {
    type: typeLabel(lang, ((TYPE_CODES as readonly string[]).includes(type) ? type : "OTHER") as TypeCode),
    code: levelText(lang, code, null), n: fmtInt(n, lang),
  }));
  return (
    <Panel title={t(lang, "fit.panel_basis")}>
      <dl class="wide">
        {classes.length ? <><dt>{t(lang, "fit.basis_classes")}</dt><dd>{lines(classes)}</dd></> : null}
        {buyers.length ? <><dt>{t(lang, "fit.basis_buyers")}</dt><dd>{lines(buyers)}</dd></> : null}
        {provinces.length ? <><dt>{t(lang, "fit.basis_provinces")}</dt><dd>{lines(provinces)}</dd></> : null}
        {types.length ? <><dt>{t(lang, "fit.basis_types")}</dt><dd>{lines(types)}</dd></> : null}
        {held.length ? <><dt>{t(lang, "orgclaim.panel_instruments")}</dt><dd>{lines(held)}</dd></> : null}
      </dl>
      <p class="muted small">
        {t(lang, "fit.basis", { counts: countsText(lang, b.n), ...fy(lang, b) })}
        {b.newest ? ` ${t(lang, "fit.newest", { date: b.newest })}` : null}
      </p>
    </Panel>
  );
};

// One page of the ranking, with the plan's cap under it.
const ListPanel: FC<{ lang: Lang; s: Extract<MatchesState, { kind: "ready" }> }> = ({ lang, s }) => {
  const n = (v: number) => fmtInt(v, lang);
  if (!s.list) return <Panel title={t(lang, "fit.panel_list")}><p>{t(lang, "fit.unavailable")}</p></Panel>;
  const total = s.list.matches.length;
  const cap = matchCap(s.plan);
  const listed = Math.min(total, cap);
  const size = s.pro ? MATCH_PAGE : cap;
  const pages = Math.max(1, Math.ceil(listed / size));
  const page = Math.min(Math.max(1, s.page), pages);
  const rows = s.list.matches.slice((page - 1) * size, Math.min(page * size, listed));
  const href = (p: number) => `${MATCH_PATH}?page=${p}${lang === "fr" ? "&lang=fr" : ""}`;
  const pager = pages > 1 ? (
    <nav aria-label={t(lang, "common.pagination")} class="pagination">
      <span class="muted">{t(lang, "tenders.page_of", { page: n(page), pages: n(pages) })}</span>
      <span class="pages">
        {page > 1 ? <a href={href(page - 1)} class="btn" rel="prev">{t(lang, "tenders.prev")}</a> : null}
        {page < pages ? <a href={href(page + 1)} class="btn" rel="next">{t(lang, "tenders.next")}</a> : null}
      </span>
    </nav>
  ) : undefined;
  // Three columns, so the table fits its panel from 700 px of window up: the
  // closing time is a line of the notice's cell, and the reasons take the
  // room left, each a sentence with its counts.
  const cols = [
    { kind: "label" as const, label: t(lang, "fit.col_match") },
    { kind: "org" as const, label: t(lang, "fit.col_notice") },
    { kind: "main" as const, label: t(lang, "fit.col_common") },
  ];
  return (
    <Panel title={t(lang, "fit.panel_list")} count={tn(lang, "fit.count_one", "fit.count_many", total, { n: n(total) })} foot={pager}>
      {rows.length ? (
        <div class="table-wrap bordered">
          {/* The ranking is the order: no head sorts it. */}
          <Table cols={cols} sorting="none">
            <tbody>
              {rows.map(({ row, score }) => {
                const ctx: ReasonContext = { name: s.name, notice: row, levels: s.levels };
                const type = pick(lang, row.notice_type_en, row.notice_type_fr);
                const buyer = pick(lang, row.buyer_en, row.buyer_fr);
                return (
                  <tr>
                    <td data-label={t(lang, "fit.col_match")}><MatchBand lang={lang} score={score} /></td>
                    <td data-label={t(lang, "fit.col_notice")}>
                      <a href={`/tenders/${row.reference.toLowerCase()}`}>{pick(lang, row.title_en, row.title_fr) ?? publishedReference(row)}</a>
                      {row.closing ? <><br /><span class="small">{t(lang, "tender.lead_closes", { date: closingText(row.closing, lang) })}</span></> : null}
                      <br /><span class="mono id muted">{publishedReference(row)}</span>
                      {buyer || type ? <><br /><span class="muted small">{[buyer, type].filter(Boolean).join(" · ")}</span></> : null}
                    </td>
                    <td data-label={t(lang, "fit.col_common")}><MatchReasons lang={lang} score={score} ctx={ctx} /></td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      ) : (
        <p>{tj(lang, "fit.none_open", { name: s.name, all: <a href="/tenders">{t(lang, "fit.all_open")}</a> })}</p>
      )}
      {!s.pro && total > cap ? (
        <p class="muted small">
          {t(lang, "fit.free_cap", { free: n(RULES.free.matches), pro: n(RULES.pro.matches), page: n(MATCH_PAGE) })}{" "}
          <a href="/account/billing">{t(lang, "billing.link_plans")}</a>
        </p>
      ) : null}
      {s.pro && total > cap ? <p class="muted small">{t(lang, "fit.pro_cap", { pro: n(cap), n: n(total) })}</p> : null}
      {s.list.uncoded ? (
        <p class="muted small">{tn(lang, "fit.uncoded_count_one", "fit.uncoded_count_many", s.list.uncoded, { n: n(s.list.uncoded) })}</p>
      ) : null}
    </Panel>
  );
};

// -- the page --------------------------------------------------------------------------

export function matchesView(lang: Lang, s: MatchesState) {
  const back = <a href="/account" class="btn">{t(lang, "account.title")}</a>;
  if (s.kind === "unclaimed") {
    return (
      <>
        <PageHead lang={lang} title={t(lang, "fit.title")} actions={back} />
        <FitDisclaimer lang={lang} />
        <Panel title={t(lang, "orgclaim.title")}>
          <p>{t(lang, "fit.unclaimed_lead")}</p>
          <p><a href={ORG_PATH} class="btn btn-primary">{t(lang, "fit.choose")}</a></p>
        </Panel>
      </>
    );
  }
  const name = s.kind === "gone" ? s.id : s.name;
  const lead = tj(lang, "fit.lead", { name: <a href={`/organizations/${s.id}`}>{name}</a> });
  const panel = (body: unknown) => <Panel title={t(lang, "fit.panel_list")}><p>{body as any}</p></Panel>;
  let body: unknown;
  switch (s.kind) {
    case "gone":
      body = (
        <Panel title={t(lang, "orgclaim.gone_title")}>
          <p>{t(lang, "orgclaim.gone_text")} <a href={`${ORG_PATH}?change=1`}>{t(lang, "orgclaim.title_short")}</a></p>
        </Panel>
      );
      break;
    case "pending":
      body = panel(t(lang, "fit.pending"));
      break;
    case "empty":
      body = panel(t(lang, "fit.none_records", { name: s.name, ...fy(lang, s.fy) }));
      break;
    case "uncoded":
      body = panel(t(lang, "fit.uncoded", { name: s.name, ...fy(lang, s.block) }));
      break;
    case "thin":
      body = panel(t(lang, "fit.thin", {
        name: s.name, counts: countsText(lang, s.block.coded), min: fmtInt(MATCH_MIN, lang), ...fy(lang, s.block),
      }));
      break;
    case "ready":
      body = <><BasisPanel lang={lang} s={s} /><ListPanel lang={lang} s={s} /></>;
      break;
  }
  return (
    <>
      <PageHead lang={lang} title={t(lang, "fit.title")} lead={lead} actions={back} />
      {/* The disclaimer stands above the matches, where a reader meets it before the first one. */}
      <FitDisclaimer lang={lang} />
      {body as any}
      {s.kind === "ready" ? (
        <>
          <p class="muted small">{t(lang, "fit.not_odds")}</p>
          <p class="muted small">{t(lang, "fit.not_all", { name: s.name })}</p>
        </>
      ) : null}
      {s.kind === "gone" ? null : <p class="muted small">{t(lang, "data.credit")}</p>}
    </>
  );
}

// -- reading it ------------------------------------------------------------------------

const PAGE_RE = /^[1-9][0-9]{0,3}$/;

// The claimed organization as the data now stands: a retired id is followed
// to the one that took its records, as a profile's address is; the claim's
// row is left as it is (the organization page points it there), so this page
// never writes. Null without a claim, or before the claims table exists.
async function claimedProfile(c: Context<AppEnv>, userId: string): Promise<{ id: string; profile: Profile | null } | null> {
  let claim;
  try {
    claim = await readClaim(c.env, userId);
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
  if (!claim) return null;
  const live = await checkOrganization(c.env, claim.organizationId).catch(() => null);
  return live ?? { id: claim.organizationId, profile: null };
}

// The names the basis panel prints: each buyer's from the profile's own top
// buyers and the open notices, the buyers index only for one still unnamed;
// each notice type's in the reader's language from the open notices (the
// block keeps the English as published).
async function namesFor(c: Context<AppEnv>, lang: Lang, block: MatchBlock, profile: Profile, open: readonly TenderRow[] | null) {
  const buyerNames = new Map<string, string>();
  const typeNames = new Map<string, string>();
  for (const b of profile.buyers ?? []) {
    const name = pick(lang, b.buyer_en, b.buyer_fr);
    if (name) buyerNames.set(b.buyer_id, name);
  }
  for (const r of open ?? []) {
    const name = pick(lang, r.buyer_en, r.buyer_fr);
    if (r.buyer_id && name && !buyerNames.has(r.buyer_id)) buyerNames.set(r.buyer_id, name);
    const type = pick(lang, r.notice_type_en, r.notice_type_fr);
    if (r.notice_type_en && type && !typeNames.has(r.notice_type_en)) typeNames.set(r.notice_type_en, type);
  }
  const unnamed = block.buyers.slice(0, BASIS_SHOWN).some(([id]) => !buyerNames.has(id));
  if (unnamed) {
    const index = await loadBuyers(c.env).catch(() => null);
    for (const b of index?.buyers ?? []) {
      const name = pick(lang, b.name_en, b.name_fr);
      if (name && !buyerNames.has(b.id)) buyerNames.set(b.id, name);
    }
  }
  return { buyerNames, typeNames };
}

export async function readMatches(c: Context<AppEnv>, who: Account): Promise<MatchesState> {
  const lang = c.get("lang");
  const claimed = await claimedProfile(c, who.userId);
  if (!claimed) return { kind: "unclaimed" };
  const { id, profile } = claimed;
  if (!profile) return { kind: "gone", id };
  const name = profile.organization.display_name;
  const block = profileMatching(profile);
  if (!block) {
    // No block: nothing in the window when the night's export wrote the blocks, else a file written before
    // them. One that does not read waits for the next night too, rather than say the organization has nothing.
    const window = matchingWindow(await loadStats(c.env).catch(() => null));
    return window && profile.matching === undefined ? { kind: "empty", id, name, fy: window } : { kind: "pending", id, name };
  }
  const state = blockState(block);
  if (state === "none") return { kind: "empty", id, name, fy: block.fy };
  if (state === "uncoded" || state === "thin") return { kind: state, id, name, block };
  const [open, levels] = await Promise.all([loadOpenList(c.env).catch(() => null), loadOpenLevels(c.env).catch(() => null)]);
  // A notice whose closing time has passed by the page's clock can no longer be answered.
  const clock = clockOf(c.env);
  const list = open ? rankNotices(block, open.filter((r) => !closingPassed(r.closing, clock)), profile.organization.province) : null;
  const raw = c.req.query("page") ?? "";
  return {
    kind: "ready", id, name, block, profile, plan: who.plan, pro: who.plan !== "free", list, page: PAGE_RE.test(raw) ? Number(raw) : 1, levels,
    ...(await namesFor(c, lang, block, profile, open)),
  };
}

export async function matchesPage(c: Context<AppEnv>, who: Account): Promise<Response> {
  const lang = c.get("lang");
  return accountPage(c, t(lang, "fit.title"), matchesView(lang, await readMatches(c, who)));
}
