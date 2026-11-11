// The week's matching notices by email (docs/accounts.md, Matching notices
// and Weekly email): the open tender notices first seen in the seven data
// dates ending with the run's that match the records of the organization the
// account claims (org_claim.ts), close and partial matches only, closest
// first, as public/fit.js ranks them for /account/matches. A Free account
// gets RULES.free.match_mail of them in its weekly email (weekly.ts); a Pro
// account RULES.pro.match_mail, in its weekly email when that is on, else in
// its watch mail (watch_mail.ts). digests.ts draws the block.
//
// Once a week and never twice: the weekly email goes once a week by its own
// claim, and the watch mail carries the block only in an account's first
// message of the week (watch_mail.ts) and only while the account's weekly
// email neither takes it this week nor took it (weeklyTakesMatches).
//
// The block reads the claim (one accounts row), the claimed profile's entry
// and, once a run, tenders/open.json and tenders/open-levels.json: static
// files only, never the records database. It never writes. Any fault, and
// every case with nothing to list, gives null, and the message goes without
// the block; nothing here throws and nothing is logged.

import { addDays, closingParts } from "../../public/closing.js";
import { blockState, rankNotices, type Score } from "../../public/fit.js";
import { clockAt, closingPassed } from "../closing";
import { type CodeLevel, type TenderRow, loadOpenLevels, loadOpenList, publishedReference } from "../data";
import type { Env } from "../env";
import { bandText, profileMatching, reasonText, termsWarrantyHref } from "../fit";
import { fmtInt, pick, t, tn, type Lang } from "../i18n";
import type { DigestMatches } from "./digests";
import { RULES, type Plan, matchMailCap } from "./entitlements";
import { siteLink } from "./mail_html";
import { WEEK_DAYS, checkOrganization, readClaim } from "./org_claim";
import { missingTable } from "./records_deliveries";

export const MATCHES_PATH = "/account/matches";

// -- the week's notices, read once a run ------------------------------------------------------

export type WeekNotices = { rows: readonly TenderRow[]; levels: readonly CodeLevel[] | null };
export type WeekNoticesRead = () => Promise<WeekNotices | null>;

// The open notices first seen in the WEEK_DAYS data dates ending with the
// data date whose closing time has not passed at the run's time, read on the
// first call and kept for the run's other accounts; null when the open list
// does not read. The levels only name a class or family in a reason, so a
// levels file that does not read leaves the codes alone, as the page does.
export function weekNotices(env: Env, dataDate: string, now: Date): WeekNoticesRead {
  let read: Promise<WeekNotices | null> | null = null;
  return () => (read ??= (async () => {
    try {
      const [open, levels] = await Promise.all([loadOpenList(env).catch(() => null), loadOpenLevels(env).catch(() => null)]);
      if (!open) return null;
      const first = addDays(dataDate, -(WEEK_DAYS - 1));
      const clock = clockAt(now.getTime());
      const rows = open.filter((r) => {
        const seen = (r.first_seen ?? "").slice(0, 10);
        return seen >= first && seen <= dataDate && !closingPassed(r.closing, clock);
      });
      return { rows, levels };
    } catch {
      return null;
    }
  })());
}

// -- the block's words --------------------------------------------------------------------------

type Ranked = { row: TenderRow; score: Score };

// Marks where the Terms link sits in the disclaimer's words.
const SLOT = "\u0001";

// The block from the ranked matches, in lang, or null when none matched: the
// first matchMailCap(plan), each its band and title and a line with its
// buyer, closing date and first reason (the work in common, which every
// listed match has) without its points; how many more on the site; for Free,
// Pro's own figures from RULES; the disclaimer with the Terms as a full
// address on the site; the data credit.
export function matchDigestBlock(
  lang: Lang, site: string, o: { plan: Plan; name: string; matches: readonly Ranked[]; levels: readonly CodeLevel[] | null },
): DigestMatches | null {
  const total = o.matches.length;
  if (!total) return null;
  const n = (v: number) => fmtInt(v, lang);
  const listed = o.matches.slice(0, matchMailCap(o.plan));
  const rest = total - listed.length;
  const rows = listed.map(({ row, score }) => {
    const title = pick(lang, row.title_en, row.title_fr) ?? publishedReference(row);
    const buyer = pick(lang, row.buyer_en, row.buyer_fr) ?? t(lang, "common.not_stated");
    const first = score.reasons[0];
    const reason = first ? reasonText(lang, first, { name: o.name, notice: row, levels: o.levels }) : "";
    const day = closingParts(row.closing)?.day ?? null;
    return {
      title: t(lang, "fit.mail_row", { band: bandText(lang, score.band), title }),
      url: siteLink(site, `/tenders/${row.reference.toLowerCase()}`, lang),
      detail: day ? t(lang, "fit.mail_detail", { buyer, date: day, reason }) : [buyer, reason].filter(Boolean).join(" · "),
    };
  });
  const [before, after] = t(lang, "fit.disclaimer", { terms: SLOT }).split(SLOT);
  return {
    heading: t(lang, "fit.mail_heading", { name: o.name }),
    subject: tn(lang, "fit.mail_subject_one", "fit.mail_subject_many", total, { n: n(total) }),
    rows,
    more: rest > 0
      ? { text: tn(lang, "fit.mail_more_one", "fit.mail_more_many", rest, { n: n(rest) }), url: siteLink(site, MATCHES_PATH, lang) }
      : null,
    note: o.plan === "free" ? t(lang, "fit.mail_free_note", { pro: n(RULES.pro.matches), mail: n(RULES.pro.match_mail) }) : null,
    disclaimer: { before, label: t(lang, "terms.title"), url: termsWarrantyHref(lang, site), after: after ?? "" },
    credit: t(lang, "data.credit"),
  };
}

// -- reading it for an account ----------------------------------------------------------------

// The block for an account's message: its claim followed to the live profile
// (a retired id to the one that took its records), the profile's matching
// block, the week's notices ranked against it. Null without a claim or its
// table, for an organization gone from the data, a profile with no block or
// one too thin, published-contract-only or empty to rank, a week with no new
// match, and any read that fails. notices is the run's once-a-run read;
// without it the files are read here.
export async function fitDigestBlock(
  env: Env,
  o: { userId: string; lang: Lang; site: string; dataDate: string; plan: Plan; now?: Date; notices?: WeekNoticesRead },
): Promise<DigestMatches | null> {
  try {
    let claim;
    try {
      claim = await readClaim(env, o.userId);
    } catch (e) {
      if (missingTable(e)) return null;
      throw e;
    }
    if (!claim) return null;
    const found = await checkOrganization(env, claim.organizationId);
    if (!found) return null;
    const block = profileMatching(found.profile);
    if (!block || blockState(block) !== "ready") return null;
    const week = await (o.notices ?? weekNotices(env, o.dataDate, o.now ?? new Date()))();
    if (!week) return null;
    const { matches } = rankNotices(block, week.rows, found.profile.organization.province);
    return matchDigestBlock(o.lang, o.site, {
      plan: o.plan, name: found.profile.organization.display_name, matches, levels: week.levels,
    });
  } catch {
    return null;
  }
}

// -- which message carries it ---------------------------------------------------------------

// The account's weekly email row, read by its key.
export const WEEKLY_MATCHES_SQL = "SELECT mail, on_at, last_week, last_status FROM weekly_mail WHERE user_id = ? LIMIT 1";

// Whether the account's weekly email carries the block in the week opening on
// `week` (briefings.ts weekAnchor): it is on and was turned on before that
// Monday, so this week's message goes to it (weekly.ts WEEKLY_DUE_SQL), or
// it went this week already. The watch mail then leaves the block out, so a
// Pro account with both is never sent the same matches twice in a week. A
// database without the table has no weekly email: false. Throws on any other
// fault, which the watch mail takes as leaving the block out.
export async function weeklyTakesMatches(env: Env, userId: string, week: string): Promise<boolean> {
  let row: { mail: string; on_at: string; last_week: string | null; last_status: string | null } | null;
  try {
    row = await env.ACCOUNTS!.prepare(WEEKLY_MATCHES_SQL).bind(userId)
      .first<{ mail: string; on_at: string; last_week: string | null; last_status: string | null }>();
  } catch (e) {
    if (missingTable(e)) return false;
    throw e;
  }
  if (!row) return false;
  return (row.mail === "on" && row.on_at < week) || (row.last_week === week && row.last_status === "sent");
}
