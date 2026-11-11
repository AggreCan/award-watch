// Matching notices where readers already are (docs/accounts.md, Matching
// notices): the panel on an open notice's page, the panel over the /tenders
// list and the summary on /account/organization. public/fit.js scores,
// src/fit.tsx holds the words, public/fit-panel.js draws the short lists, and
// /account/matches (fit_pages.tsx) holds the whole ranking.
//
// The notice page and /tenders are public pages, kept by a shared cache for
// five minutes while no session is read (layout.tsx page). A panel here is
// drawn only for a request whose session reads (session.ts readSession, one
// read a request, shared with the shell), and page() then sends the response
// private, no-store, since the shell names the signed-in address. A request
// without a session reads nothing here and gets the same bytes as before.
// Only the account's own claim is read, so one reader's organization never
// reaches another's page.
//
// Reads, for a signed-in account: the claim (one accounts row,
// CLAIM_READ_SQL) and the claimed profile's shard entry (two more files for a
// retired id). The notice page adds tenders/open-levels.json only when a
// reason names a class or family. /tenders writes the block into the page,
// and the browser scores the list public/tenders.js already holds. The
// organization page reads tenders/open.json and open-levels.json, both kept
// parsed while their ETags hold. Never the records database, never a write;
// a fault leaves the panel out and the page as it would be without it.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { MATCH_MAX, MATCH_MIN, blockState, scoreNotice, type Score } from "../../public/fit.js";
import { panelRows } from "../../public/fit-panel.js";
import { clockOf, closingPassed } from "../closing";
import { type CodeLevel, type Profile, type TenderDetail, loadOpenLevels, loadOpenList, loadStats } from "../data";
import type { AppEnv } from "../env";
import {
  FitDisclaimer, MatchReasons, type MatchBlock, type ReasonContext, bandText, countsText, detailNotice, matchingWindow, profileMatching,
  reasonText,
} from "../fit";
import { clientStrings, fmtInt, numberLocale, segmentLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import { ClientData, Panel } from "../layout";
import { fiscalLabel } from "../records_db";
import { checkOrganization, readClaim } from "./org_claim";
import { missingTable } from "./records_deliveries";
import { readSession } from "./session";
import { accountsEnabled } from "./switch";

const MATCHES = "/account/matches";
const ORGANIZATION = "/account/organization";

// -- the reader's claim -------------------------------------------------------------------

// What a request's account gives the panels: null while the switch is off,
// without a session, when the claimed organization is gone from the data or
// its block cannot rank notices (no block yet, nothing in the window,
// published contracts only, too few records with codes: the account pages
// say which), and on any fault; "unclaimed" for an account that names none.
export type FitRead =
  | { kind: "unclaimed" }
  | { kind: "ready"; id: string; name: string; home: string | null; block: MatchBlock };

export async function readFit(c: Context<AppEnv>): Promise<FitRead | null> {
  if (!accountsEnabled(c.env)) return null;
  const read = await readSession(c).catch(() => ({ state: "unavailable" }) as const);
  if (read.state !== "ok") return null;
  try {
    let claim;
    try {
      claim = await readClaim(c.env, read.account.userId);
    } catch (e) {
      // Before the claims table exists no account has a claim, as /account/matches reads it.
      if (missingTable(e)) return { kind: "unclaimed" };
      throw e;
    }
    if (!claim) return { kind: "unclaimed" };
    const found = await checkOrganization(c.env, claim.organizationId);
    const block = found ? profileMatching(found.profile) : null;
    if (!found || !block || blockState(block) !== "ready") return null;
    const o = found.profile.organization;
    return { kind: "ready", id: found.id, name: o.display_name, home: o.province, block };
  } catch {
    return null;
  }
}

// A sentence that ends on the organization's name ends with the name's own
// period when it has one ("Inc."), not with a second.
const ownPeriod = (name: string, pieces: unknown[]): unknown[] =>
  name.endsWith(".") && pieces[pieces.length - 1] === "." ? pieces.slice(0, -1) : pieces;
const ownPeriodText = (name: string, s: string): string => (name.endsWith(".") && s.endsWith("..") ? s.slice(0, -1) : s);

const basis = (lang: Lang, block: MatchBlock) =>
  t(lang, "fit.basis", { counts: countsText(lang, block.n), first: fiscalLabel(lang, block.fy[0]), last: fiscalLabel(lang, block.fy[1]) });

// -- an open notice's page --------------------------------------------------------------------

export type NoticeFit = { kind: "unclaimed" } | (Extract<FitRead, { kind: "ready" }> & { score: Score; levels: readonly CodeLevel[] | null });

// The notice scored against the account's block. The caller asks only for an
// open notice: a match is about what can still be answered.
export async function noticeFit(c: Context<AppEnv>, d: TenderDetail): Promise<NoticeFit | null> {
  const fit = await readFit(c);
  if (fit?.kind !== "ready") return fit;
  const score = scoreNotice(fit.block, detailNotice(d), fit.home);
  // The open notices' levels name a class or family; a reason without one needs no file.
  const named = score.reasons.some((r) => r.kind === "class" || r.kind === "family");
  const levels = named ? await loadOpenLevels(c.env).catch(() => null) : null;
  return { ...fit, score, levels };
}

// The line under the Follow control for a signed-in account that names no
// organization yet.
export const FitNudge: FC<{ lang: Lang; fit: NoticeFit | null }> = ({ lang, fit }) =>
  fit?.kind === "unclaimed" ? (
    <p class="page-note">{tj(lang, "fit.nudge", { link: <a href={ORGANIZATION}>{t(lang, "orgclaim.title_short")}</a> })}</p>
  ) : null;

// The match: the band and the points out of the maximum, every reason with
// its points, the records it was counted from, the disclaimer. A notice that
// shares no work says so (or that it carries no code) and states the buyer,
// province or notice type it still shares, without points; a notice naming
// no province shares nothing by that.
export const NoticeMatchPanel: FC<{ lang: Lang; fit: NoticeFit | null; notice: TenderDetail }> = ({ lang, fit, notice }) => {
  if (fit?.kind !== "ready") return null;
  const { score } = fit;
  const ctx: ReasonContext = { name: fit.name, notice, levels: fit.levels };
  const matched = score.band !== "none";
  const also = matched ? [] : score.reasons.filter((r) => r.kind !== "national");
  return (
    <Panel title={t(lang, "fit.panel_notice")}>
      <p>{ownPeriod(fit.name, tj(lang, "fit.notice_lead", { name: <a href={`/organizations/${fit.id}`}>{fit.name}</a> }))}</p>
      <p>
        <strong>{bandText(lang, score.band)}</strong>
        {matched ? <> <span class="muted small">{t(lang, "fit.points", { n: fmtInt(score.points, lang), max: fmtInt(MATCH_MAX, lang) })}</span></> : null}
      </p>
      {matched ? <MatchReasons lang={lang} score={score} ctx={ctx} /> : (
        <>
          <p>{score.coded ? ownPeriodText(fit.name, t(lang, "fit.none_reason", { name: fit.name })) : t(lang, "fit.no_codes")}</p>
          {also.length ? (
            <>
              <p>{t(lang, "fit.also_common")}</p>
              <ul class="plain">{also.map((r) => <li>{reasonText(lang, r, ctx)}</li>)}</ul>
            </>
          ) : null}
        </>
      )}
      <p class="muted small">{basis(lang, fit.block)}</p>
      <FitDisclaimer lang={lang} />
    </Panel>
  );
};

// -- the short list: /tenders and the organization page --------------------------------------

// The words public/fit-panel.js draws, handed over in the page's data.
export const FIT_CLIENT_KEYS: readonly Key[] = [
  "fit.band_close", "fit.band_partial", "fit.r_class", "fit.r_family", "fit.r_segment",
  "orgclaim.week_awards_one", "orgclaim.week_awards_many", "orgclaim.week_history_one", "orgclaim.week_history_many",
  "orgclaim.week_contracts_one", "orgclaim.week_contracts_many",
  "fit.tenders_all_one", "fit.tenders_all_many", "fit.tenders_none", "fit.unavailable", "tenders.loading", "tender.lead_closes",
  "common.not_stated",
];

// The page's data for public/fit-panel.js: the block, the organization's
// name, id and province, the words and the titles of the block's segments.
// The block holds counts as public as the profile's own (docs/accounts.md).
export function fitClientData(lang: Lang, fit: Extract<FitRead, { kind: "ready" }>) {
  return {
    lang, locale: numberLocale(lang), id: fit.id, name: fit.name, home: fit.home, block: fit.block,
    strings: clientStrings(lang, FIT_CLIENT_KEYS),
    segments: Object.fromEntries(fit.block.segments.map(([code]) => [code, segmentLabel(lang, code)])),
  };
}

const AllLink: FC<{ lang: Lang; total: number }> = ({ lang, total }) => (
  <a href={MATCHES}>
    {total ? tn(lang, "fit.tenders_all_one", "fit.tenders_all_many", total, { n: fmtInt(total, lang) }) : t(lang, "fit.overview")}
  </a>
);

// Over the /tenders list: the panel's frame, which public/fit-panel.js fills
// from the open notices public/tenders.js fetches, with the link to every
// match once it has counted them; without the script, a link to the page that
// lists them. No filled button: Apply stays the page's one.
export const TendersFitPanel: FC<{ lang: Lang; fit: FitRead | null }> = ({ lang, fit }) => {
  if (fit?.kind !== "ready") return null;
  return (
    <>
      <Panel title={t(lang, "fit.tenders_panel", { name: fit.name })}
        tools={<a href={MATCHES} id="fit-all" hidden>{t(lang, "fit.overview")}</a>}>
        <div id="fit-rows"></div>
        <noscript><p><a href={MATCHES}>{t(lang, "fit.overview")}</a></p></noscript>
        <FitDisclaimer lang={lang} />
      </Panel>
      <ClientData id="fit-data" data={fitClientData(lang, fit)} />
    </>
  );
};

// The organization page's summary, as read: the state its block allows, and
// for a ranking the first PANEL_ROWS matches (null when the open notices
// cannot be read).
export type OrgMatches =
  | { kind: "pending" }
  | { kind: "empty"; name: string; fy: [number, number] }
  | { kind: "uncoded" | "thin"; name: string; block: MatchBlock }
  | { kind: "ready"; name: string; list: ReturnType<typeof panelRows> | null };

export async function readOrgMatches(c: Context<AppEnv>, id: string, profile: Profile): Promise<OrgMatches> {
  const lang = c.get("lang");
  const o = profile.organization;
  const block = profileMatching(profile);
  if (!block) {
    // As /account/matches reads it: nothing in the window once the night's export wrote the blocks, else a
    // file written before them, or a block that does not read, which waits for the next night.
    const window = matchingWindow(await loadStats(c.env).catch(() => null));
    return window && profile.matching === undefined ? { kind: "empty", name: o.display_name, fy: window } : { kind: "pending" };
  }
  const state = blockState(block);
  if (state === "none") return { kind: "empty", name: o.display_name, fy: block.fy };
  if (state === "uncoded" || state === "thin") return { kind: state, name: o.display_name, block };
  // The levels file names a class or family in a row's reason; without it the code stands alone.
  const [open, levels] = await Promise.all([loadOpenList(c.env).catch(() => null), loadOpenLevels(c.env).catch(() => null)]);
  if (!open) return { kind: "ready", name: o.display_name, list: null };
  // A notice whose closing time has passed by the page's clock can no longer be answered.
  const clock = clockOf(c.env);
  const rows = open.filter((r) => !closingPassed(r.closing, clock));
  const data = fitClientData(lang, { kind: "ready", id, name: o.display_name, home: o.province, block });
  return { kind: "ready", name: o.display_name, list: panelRows(data, rows, levels) };
}

// After the claim and compare panels on /account/organization, for Free and
// Pro alike: the closest matches, drawn as public/fit-panel.js draws them on
// /tenders, or the line that says why there are none.
export const OrgMatchesPanel: FC<{ lang: Lang; m: OrgMatches; name: string }> = ({ lang, m, name }) => {
  const fy = (v: [number, number]) => ({ first: fiscalLabel(lang, v[0]), last: fiscalLabel(lang, v[1]) });
  let body: unknown;
  switch (m.kind) {
    case "pending":
      body = <p>{t(lang, "fit.pending")}</p>;
      break;
    case "empty":
      body = <p>{t(lang, "fit.none_records", { name: m.name, ...fy(m.fy) })}</p>;
      break;
    case "uncoded":
      body = <p>{t(lang, "fit.uncoded", { name: m.name, ...fy(m.block.fy) })}</p>;
      break;
    case "thin":
      body = <p>{t(lang, "fit.thin", { name: m.name, counts: countsText(lang, m.block.coded), min: fmtInt(MATCH_MIN, lang), ...fy(m.block.fy) })}</p>;
      break;
    case "ready":
      body = !m.list ? <p>{t(lang, "fit.unavailable")}</p> : m.list.rows.length ? (
        <ol class="statement-list">
          {m.list.rows.map((r) => (
            <li><strong>{r.band}</strong> <a href={r.href}>{r.title}</a><br /><span class="muted small">{r.detail}</span></li>
          ))}
        </ol>
      ) : <p>{t(lang, "fit.tenders_none", { name: m.name })}</p>;
      break;
  }
  return (
    <Panel title={t(lang, "fit.tenders_panel", { name })} tools={<AllLink lang={lang} total={m.kind === "ready" ? m.list?.total ?? 0 : 0} />}>
      {body as any}
      <FitDisclaimer lang={lang} />
    </Panel>
  );
};
