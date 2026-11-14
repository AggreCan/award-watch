// May follow on an open notice's page (/tenders/:reference; docs/accounts.md,
// May follow): for a signed-in reader, the earlier contracts of the same
// buyer the notice may follow, as the pipeline's follows.py matched them
// each night (rec_follows), each with what matched. Free sees the closest
// one; Pro and Ultra up to FOLLOW_MAX, each with its holder's label and
// figure under the holder's name (the radar's mark, src/lines_view.tsx).
//
// Behind a switch of its own, FOLLOWS_PANEL: anything but "on" leaves the
// notice page byte for byte as it was for every reader, runs no records
// statement for it, and shows no word of may follow on any page (the
// Methodology and the Terms read the same switch). A reader not signed in,
// a notice that is not open and a records database without rec_follows also
// leave the page as it was.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { followCap, isPaidPlan } from "../account/entitlements";
import { Table } from "../columns";
import type { AppEnv } from "../env";
import { AdvisoryDisclaimer } from "../fit";
import { fmtInt, pick, sourceLabel, t, tj, tn, type Key, type Lang } from "../i18n";
import { Panel } from "../layout";
import { type FollowRecord, LINE_SOURCE, followsPanelOn, parseFollow } from "../lines";
import { RadarMark, markText } from "../lines_view";
import type { Plan } from "../plan";
import { orgIdOf } from "../records_db";
import type { FollowsRead } from "./backbone";
import { holderAccess } from "./holders";
import { recordHref, shownReference } from "./records";

// The plan of a signed-in reader while both switches are on, else null; the
// switch is read first, so while it is off nothing here reads the session.
export async function followsAccess(c: Context<AppEnv>): Promise<{ plan: Plan } | null> {
  if (!followsPanelOn(c.env)) return null;
  return holderAccess(c);
}

export type FollowRow = { j: FollowRecord; holder: string | null; buyer: string | null };

// none: nothing is shown (no read was asked for, or the database holds no
// rec_follows yet). unavailable: the database could not answer. ready: the
// rows the plan shows, how many the night kept, whether each carries its
// holder's record (a paid plan), and pending when none is kept yet for a
// notice first seen after the records database's data date.
export type FollowsState =
  | { state: "none" }
  | { state: "unavailable" }
  | { state: "ready"; rows: FollowRow[]; kept: number; records: boolean; pending: boolean };

const NONE: FollowsState = { state: "none" };
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

// firstSeen: the day the notice was first seen (its first version's), set
// against the data date the records database describes.
export function followsFromRead(read: FollowsRead, plan: Plan, lang: Lang, firstSeen: string | null): FollowsState {
  if (read === null || read.noFollows || (read.state === "failed" && read.noTable)) return NONE;
  if (read.state !== "ready") return { state: "unavailable" };
  // A row that does not read in full is left out, never shown in part.
  const rows = (read.rows[0] ?? []).flatMap((r): FollowRow[] => {
    const j = parseFollow(r.j);
    return j ? [{ j, holder: str(r.holder), buyer: pick(lang, str(r.buyer_en), str(r.buyer_fr)) }] : [];
  });
  const pending = !rows.length && !!firstSeen && !!read.asOf && read.asOf < firstSeen;
  return { state: "ready", rows: rows.slice(0, followCap(plan)), kept: rows.length, records: isPaidPlan(plan), pending };
}

// -- the words ---------------------------------------------------------------------------

const DEGREE: Readonly<Record<FollowRecord["deg"], Key>> = {
  number: "follow.degree_number", close: "follow.degree_close", partial: "follow.degree_partial",
};

const daysText = (lang: Lang, n: number) => tn(lang, "follow.days_one", "follow.days_many", n, { n: fmtInt(n, lang) });

// What matched, one line each: the number, the buyer, the codes, the words,
// the end against the notice's expected start (or its publication).
export function matchedLines(lang: Lang, row: FollowRow): string[] {
  const { j } = row;
  const out: string[] = [];
  if (j.sol) out.push(t(lang, "follow.m_solicitation", { number: j.sol }));
  if (j.num) out.push(t(lang, "follow.m_number", { number: j.num }));
  out.push(t(lang, j.client ? "follow.m_client" : "follow.m_buyer", { buyer: row.buyer ?? j.buyer }));
  if (j.lvl) {
    const many = j.code.length > 1;
    const key: Key = j.lvl === "class" ? (many ? "follow.m_classes" : "follow.m_class") : many ? "follow.m_families" : "follow.m_family";
    out.push(t(lang, key, { code: j.code.join(", ") }));
  }
  const [shared, all] = j.words;
  if (shared > 0) out.push(tn(lang, "follow.m_words_one", "follow.m_words", shared, { shared: fmtInt(shared, lang), all: fmtInt(all, lang) }));
  if (j.days !== null) {
    const start = j.from === "start";
    if (j.days === 0) out.push(t(lang, start ? "follow.m_on_start" : "follow.m_on_pub"));
    else {
      const key: Key = j.days < 0 ? (start ? "follow.m_before_start" : "follow.m_before_pub") : start ? "follow.m_after_start" : "follow.m_after_pub";
      out.push(t(lang, key, { days: daysText(lang, Math.abs(j.days)) }));
    }
  }
  return out;
}

const Contract: FC<{ lang: Lang; j: FollowRecord; today: string }> = ({ lang, j, today }) => {
  const href = recordHref(j.src, j.ref);
  const title = pick(lang, j.t[0], j.t[1]) ?? (shownReference(j.ref) || t(lang, "common.not_stated"));
  const end = j.end ? t(lang, j.end < today ? "follow.ended" : "follow.ends", { date: j.end }) : null;
  return (
    <>
      {href ? <a href={href}>{title}</a> : title}
      <br />
      {href ? null : <><span class="mono id muted">{shownReference(j.ref)}</span> </>}
      <span class="muted small">{[sourceLabel(lang, LINE_SOURCE[j.src]), end].filter(Boolean).join(" · ")}</span>
    </>
  );
};

const Holder: FC<{ lang: Lang; row: FollowRow; records: boolean }> = ({ lang, row, records }) => {
  const { j } = row;
  if (j.wh) return <span class="muted">{t(lang, "expiring.withheld")}</span>;
  if (j.oid === null) return <span class="muted">{t(lang, "common.not_stated")}</span>;
  const id = orgIdOf(j.oid);
  const mark = records && j.line ? markText(lang, j.line) : null;
  return (
    <>
      <a href={`/organizations/${id}`}>{row.holder ?? id}</a>
      {mark ? <RadarMark text={mark} /> : null}
    </>
  );
};

// The panel, after the instruments' current holders and before the earlier
// awards like this one. today: the data date, which sets "Ended" or "Ends".
export const FollowsPanel: FC<{ lang: Lang; state: FollowsState; today: string }> = ({ lang, state, today }) => {
  if (state.state === "none") return null;
  if (state.state === "unavailable") {
    return <Panel id="follows" title={t(lang, "follow.panel")}><p class="muted">{t(lang, "follow.unavailable")}</p></Panel>;
  }
  const { rows, kept, records } = state;
  return (
    <Panel id="follows" title={t(lang, "follow.panel")} count={rows.length ? fmtInt(rows.length, lang) : undefined}>
      {rows.length ? (
        <>
          <p class="muted small">{t(lang, "follow.lead")}</p>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "main", label: t(lang, "follow.col_contract") },
              { kind: "org", label: t(lang, "follow.col_holder") },
              { kind: "text", label: t(lang, "follow.col_matched") },
            ]}>
              <tbody>
                {rows.map((row) => (
                  <tr>
                    <td data-label={t(lang, "follow.col_contract")} class="lead-cell"><Contract lang={lang} j={row.j} today={today} /></td>
                    <td data-label={t(lang, "follow.col_holder")}><Holder lang={lang} row={row} records={records} /></td>
                    <td data-label={t(lang, "follow.col_matched")}>
                      <strong>{t(lang, DEGREE[row.j.deg])}</strong>
                      <ul class="plain small">{matchedLines(lang, row).map((line) => <li>{line}</li>)}</ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          {!records && kept > rows.length ? (
            <p class="muted small">
              {tj(lang, "follow.free_cap", {
                free: fmtInt(followCap("free"), lang), pro: fmtInt(followCap("pro"), lang),
                plans: <a href="/account/billing">{t(lang, "billing.link_plans")}</a>,
              })}
            </p>
          ) : null}
        </>
      ) : (
        <p class="muted">{t(lang, state.pending ? "follow.pending" : "follow.none")}</p>
      )}
      <AdvisoryDisclaimer lang={lang} kind="follow" />
      {rows.length ? <p class="muted small">{t(lang, "data.credit")}</p> : null}
    </Panel>
  );
};
