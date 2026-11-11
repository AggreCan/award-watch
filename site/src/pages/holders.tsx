// The holder's record on a contract's page (/awards/:ref, /history/:ref,
// /contracts/:dept/:ref; docs/accounts.md, Holder's record): for a
// signed-in reader and a contract on the radar, its holder's contracts of
// the same kind with the same buyer, each source apart, with the label and
// its figure, how this contract was awarded and amended, and the similar
// names listed apart. Free sees it for contracts ending within the 3-month
// list's days and Pro within the 12-month list's (lineDays); beyond Free's,
// a line says what each plan shows. A reader not signed in, a contract not
// on the radar, a supplier withheld as a person and a records database
// without rec_lines all show the page as it was.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { railAccount } from "../account/session";
import { accountsEnabled } from "../account/switch";
import { type CodeLevel, loadOpenLevels } from "../data";
import type { AppEnv } from "../env";
import { AdvisoryDisclaimer, levelText } from "../fit";
import { competitiveLabel, fmtInt, numberLocale, pick, sourceLabel, t, tj, tn, type Lang } from "../i18n";
import { Panel } from "../layout";
import { LINE_SOURCE, LINE_YEARS, RUN_GAP_DAYS, type LineOwn, type LineRecord, type LineSource, lineLabel, parseLine } from "../lines";
import { BAND_KEY, shortFigure } from "../lines_view";
import type { Plan } from "../plan";
import { fiscalLabel } from "../records_db";
import { type Read, readLine } from "../records_tables";
import { WINDOW_DAYS, growthPct, lineDays } from "./expiring";

export type HolderState =
  | { state: "none" }
  | { state: "unavailable" }
  | { state: "free_window" }
  | { state: "ready"; j: LineRecord; buyer: string | null; holder: string | null; levels: readonly CodeLevel[] | null };

const NONE: HolderState = { state: "none" };

// The plan of a signed-in reader while the accounts switch is on, else null:
// a reader not signed in reads nothing here and sees the page as it was.
export async function holderAccess(c: Context<AppEnv>): Promise<{ plan: Plan } | null> {
  if (!accountsEnabled(c.env)) return null;
  const account = await railAccount(c).catch(() => undefined);
  return account?.email ? { plan: account.plan ?? "free" } : null;
}

// Whether a contract can have a record at all: its holder named, not
// cancelled, and ending within the radar's horizon from the data date.
export function inRadar(daysLeft: number | null, named: boolean, live: boolean): daysLeft is number {
  return named && live && daysLeft !== null && daysLeft >= 0 && daysLeft <= WINDOW_DAYS["12m"];
}

// The state a read of rec_lines leaves (rows[at], LINE_BY_KEY_SQL): none for a
// contract it does not hold or a row that does not read in full; the window
// line for Free past its days; the record otherwise, with the open notices'
// class and family names for its kinds of work.
export async function holderFromRead(c: Context<AppEnv>, read: Read & { noLines?: true }, at: number, daysLeft: number, plan: Plan): Promise<HolderState> {
  if (read.noLines || (read.state === "failed" && read.noTable)) return NONE;
  if (read.state !== "ready") return { state: "unavailable" };
  const row = read.rows[at]?.[0];
  const j = row ? parseLine(row.j) : null;
  if (!row || !j) return NONE;
  if (daysLeft > lineDays(plan)) return { state: "free_window" };
  const levels = j.s.some((e) => e.lvl !== "code") ? await loadOpenLevels(c.env).catch(() => null) : null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  return { state: "ready", j, buyer: pick(c.get("lang"), text(row.buyer_en), text(row.buyer_fr)) ?? j.buyer, holder: text(row.holder), levels };
}

// An award notice's or a history record's page: one statement, only for a
// signed-in reader and a contract that can be on the radar.
export async function holderOfNotice(c: Context<AppEnv>, key: string, daysLeft: number | null, named: boolean, live: boolean): Promise<HolderState> {
  const access = await holderAccess(c);
  if (!access || !inRadar(daysLeft, named, live)) return NONE;
  return holderFromRead(c, await readLine(c.env, key), 0, daysLeft, access.plan);
}

// -- the words -------------------------------------------------------------------------

function kindText(lang: Lang, e: LineSource, levels: readonly CodeLevel[] | null): string {
  if (e.lvl === "code") return t(lang, "line.kind_code", { code: e.key[0] });
  const codes = e.key.map((k) => levelText(lang, k, levels)).join(", ");
  if (e.lvl === "class") return t(lang, e.key.length === 1 ? "line.kind_class" : "line.kind_classes", { code: codes });
  return t(lang, e.key.length === 1 ? "line.kind_family" : "line.kind_families", { code: codes });
}

const lowerFirst = (lang: Lang, s: string) => s.charAt(0).toLocaleLowerCase(numberLocale(lang)) + s.slice(1);

// "non-competitive (TN), 1 bid received": the source's own term, the TBS code a
// published contract states, and its bids.
function methodText(lang: Lang, own: LineOwn, published: boolean): string {
  const method = lowerFirst(lang, competitiveLabel(lang, own.comp)) + (published && own.meth ? ` (${own.meth})` : "");
  const bids = own.bids === null ? "" : tn(lang, "line.bids_one", "line.bids_many", own.bids, { n: fmtInt(own.bids, lang) });
  return t(lang, "line.r_last", { method, bids });
}

function methodParts(lang: Lang, e: LineSource): string {
  return ([["line.method_nc", e.nc], ["line.method_c", e.c], ["line.method_u", e.u]] as const)
    .filter(([, n]) => n > 0).map(([key, n]) => t(lang, key, { n: fmtInt(n, lang) })).join(", ");
}

const SourceLines: FC<{ lang: Lang; e: LineSource; holder: string; levels: readonly CodeLevel[] | null }> = ({ lang, e, holder, levels }) => {
  const vars = { source: sourceLabel(lang, LINE_SOURCE[e.src]), kind: kindText(lang, e, levels), holder };
  return (
    <>
      <li>{e.held === 1 ? t(lang, "line.r_held_one", vars)
        : t(lang, "line.r_held_many", { ...vars, n: fmtInt(e.held, lang), date: e.first ?? "" })}</li>
      {e.held > 1 ? (
        <li>{e.run > 1 ? t(lang, "line.r_run", { n: fmtInt(e.run, lang), gap: fmtInt(RUN_GAP_DAYS, lang) }) : t(lang, "line.r_run_none")}</li>
      ) : null}
      <li>{e.others === 0 ? t(lang, "line.r_cell_none")
        : t(lang, e.others === 1 ? "line.r_cell_one" : "line.r_cell_many", { total: fmtInt(e.total, lang), others: fmtInt(e.others, lang) })}</li>
      {e.held > 1 ? <li>{t(lang, "line.r_method", { n: fmtInt(e.held, lang), parts: methodParts(lang, e) })}</li> : null}
    </>
  );
};

// The panel. uncoded: whether the contract carries only a UNSPSC segment
// ("segment") or no code that names its kind of work ("none"), for a record
// with no source to compare.
export const HolderPanel: FC<{ lang: Lang; state: HolderState; published: boolean; supplier: string | null; uncoded: "segment" | "none" }> = (
  { lang, state, published, supplier, uncoded },
) => {
  if (state.state === "none") return null;
  if (state.state === "unavailable") {
    return <Panel title={t(lang, "line.panel")}><p class="muted">{t(lang, "line.unavailable")}</p></Panel>;
  }
  if (state.state === "free_window") {
    return (
      <Panel title={t(lang, "line.panel")}>
        <p class="muted">
          {tj(lang, "line.free_window", {
            free: fmtInt(WINDOW_DAYS["3m"], lang), pro: fmtInt(WINDOW_DAYS["12m"], lang),
            plans: <a href="/account/billing">{t(lang, "billing.link_plans")}</a>,
          })}
        </p>
      </Panel>
    );
  }
  const { j, levels } = state;
  const holder = state.holder ?? supplier ?? "";
  const label = lineLabel(j);
  const short = label ? shortFigure(lang, label.band, label.figure) : null;
  const own = j.own;
  return (
    <Panel title={t(lang, "line.panel")}>
      <p>{t(lang, "line.lead", { buyer: state.buyer ?? "", holder, first: fiscalLabel(lang, j.fy[0]), last: fiscalLabel(lang, j.fy[1]) })}</p>
      {label ? (
        <p>
          <strong>{t(lang, BAND_KEY[label.band])}</strong>
          {short ? <> <span class="muted">{short} {label.first ? t(lang, "line.since", { date: label.first }) : ""}</span></> : null}
        </p>
      ) : null}
      <ul class="plain">
        {j.s.map((e) => <SourceLines lang={lang} e={e} holder={holder} levels={levels} />)}
        <li>{methodText(lang, own, published)}</li>
        {own.amd > 0 ? (
          <>
            <li>{own.growth === null ? t(lang, "line.r_amend_count", { n: fmtInt(own.amd, lang) })
              : t(lang, "line.r_amend", { n: fmtInt(own.amd, lang), pct: growthPct(lang, own.growth) })}</li>
            {own.end0 && own.end && own.end0 !== own.end ? <li>{t(lang, "line.r_end_moved", { from: own.end0, to: own.end })}</li> : null}
          </>
        ) : <li>{t(lang, "line.r_amend_none")}</li>}
        {j.sim.map(([id, name, , n, last]) => (
          <li>
            {tj(lang, n === 1 ? "line.r_similar_one" : "line.r_similar", {
              name: <a href={`/organizations/${id}`}>{name}</a>, n: fmtInt(n, lang), date: last,
            })}
          </li>
        ))}
      </ul>
      {j.s.length ? null : <p>{t(lang, uncoded === "segment" ? "line.uncoded" : "line.uncoded_none")}</p>}
      <p class="muted small">{t(lang, "line.basis", { years: fmtInt(LINE_YEARS, lang) })}</p>
      <p class="muted small">{t(lang, "line.not_odds")}</p>
      <AdvisoryDisclaimer lang={lang} kind="line" />
      <p class="muted small">{t(lang, "data.credit")}</p>
    </Panel>
  );
};
