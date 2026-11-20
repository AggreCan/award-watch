// "Add to dashboard": the one control an Ultra account gets beside what can
// become a tile (each panel of an analytics view, a saved search's row, a
// briefing's row, a saved view's row). It posts the tile's kind and its ref to the dashboard
// (dashboard.tsx addPanelPost), which keeps it within the plan's figure and
// answers on the dashboard itself. Callers draw it only for an account that
// holds the dashboard (dashboard_rule.ts holdsDashboard), so nothing changes
// for any other reader.
//
// An account with one dashboard (or none stored yet) gets the one button, and
// the tile goes on its first dashboard. An account with several gets the same
// words as a details element, which opens without the script on the
// dashboards' names, each a submit button of one form naming its dashboard:
// a choice, and still no filled button on the page.
//
// The dashboards' names live here too (boardLabels), so the pages that carry
// the control read them without importing the dashboard's page.

import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { FC } from "hono/jsx";
import type { AppEnv, Env } from "../env";
import { t, type Lang } from "../i18n";
import { viewBase, viewOf } from "../view_address";
import { DASHBOARD_PATH, TABLES_PATH, holdsDashboard, missingTiles } from "./dashboard_rule";
import { type Account, SESSION_COOKIE, readSession } from "./session";
import { accountsEnabled } from "./switch";

// A dashboard as a choice: its id and the name it goes by.
export type BoardChoice = { id: string; label: string };

// label: the control's words where one thing offers two tiles (a view of the analytics builder and its latest
// figure, pages/builder.tsx); "Add to dashboard" otherwise.
export const AddToDashboard: FC<{
  lang: Lang; account: Pick<Account, "csrf">; kind: string; panelRef: string; button?: boolean; boards?: readonly BoardChoice[]; label?: string;
}> = ({ lang, account, kind, panelRef, button, boards, label }) => {
  const words = label ?? t(lang, "dash.add_here");
  const fields = <>
    <input type="hidden" name="csrf" value={account.csrf} />
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="ref" value={panelRef} />
  </>;
  if (boards && boards.length > 1) {
    return (
      <details class="dash-add dash-add-menu">
        <summary class={button ? "btn" : "btn-link"}>{words}</summary>
        <form method="post" action={`${DASHBOARD_PATH}/panels`} class="dash-add-list">
          {fields}
          {boards.map((b) => <button type="submit" name="board" value={b.id} class="dash-menu-item">{b.label}</button>)}
        </form>
      </details>
    );
  }
  return (
    <form method="post" action={`${DASHBOARD_PATH}/panels`} class="account-inline dash-add">
      {fields}
      <button type="submit" class={button ? "btn" : "btn-link"}>{words}</button>
    </form>
  );
};

// The request's account when it holds the dashboard, else null: nothing is
// read while the switch is off or without a session cookie, and the session
// is the one the page's shell reads (readSession keeps one answer a request).
export async function dashboardAccount(c: Context<AppEnv>): Promise<Account | null> {
  if (!accountsEnabled(c.env) || !getCookie(c, SESSION_COOKIE)) return null;
  const read = await readSession(c).catch(() => null);
  return read?.state === "ok" && holdsDashboard(read.account.plan) ? read.account : null;
}

// An analytics view's address as a tile's ref (dashboard.tsx viewRef reads it
// back): its path, then its source and its period, the keys in order.
export function viewPanelRef(base: string, f: { source: string; years: number; first: number; last: number; custom: boolean }): string {
  return f.custom ? `${base}?from=${f.first}&source=${f.source}&to=${f.last}` : `${base}?source=${f.source}&years=${f.years}`;
}

// A saved view's checklist of tables (dashboard_doors.tsx tablesPage), for
// its row on the saved views page: the view's subject at the source, period
// and choices its address names; null for an address that names no view.
export function savedViewTables(address: string): string | null {
  const v = viewOf(address);
  return v ? `${TABLES_PATH}${viewBase(v.kind, v.id).replace(/\/analytics$/, "")}${v.url.search}` : null;
}

// The anchor of a table's panel on its analytics page, which the table's tile
// opens at: drawn only for an account that holds the dashboard.
export const anchorOf = (table: string): string => `table-${table}`;

// One table of an analytics view as a tile's ref (dashboard.tsx analyticRef
// reads it back): the view's address as viewPanelRef writes it, then what
// the table keeps of the rest of the address (the share table's segment and
// organizations, in the view's own order), then the table's anchor. So two
// tables of one view are two items, and the ref is the address the tile opens.
export function analyticPanelRef(
  base: string, f: { source: string; years: number; first: number; last: number; custom: boolean }, table: string,
  more: Readonly<Record<string, string | readonly string[]>> = {},
): string {
  const rest = Object.entries(more).flatMap(([k, v]) => (typeof v === "string" ? [v] : [...v]).map((one) => `&${k}=${encodeURIComponent(one)}`)).join("");
  return `${viewPanelRef(base, f)}${rest}#${anchorOf(table)}`;
}

// -- the dashboards' names ---------------------------------------------------------------------

// A dashboard's row as its names need it: name '' goes by the site's label.
export type NamedBoard = { id: string; name: string; created_at: string };

// The longest name a reader types for a dashboard, in characters.
export const BOARD_NAME_MAX = 40;

// The name each dashboard goes by: the reader's, or the site's label, "Dashboard 2", numbered in the order the
// account made them, so moving a tab leaves its label as it was. By id.
export function boardLabels(lang: Lang, boards: readonly NamedBoard[]): Map<string, string> {
  const made = [...boards].sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.created_at < b.created_at ? -1 : 1));
  return new Map(made.map((b, i) => [b.id, b.name || t(lang, "dash.board_n", { n: i + 1 })]));
}

// The account's dashboards in their order, as few as the ceiling and room for rows a smaller ceiling would leave.
export const BOARD_LIST_SQL = "SELECT id, name, pos, created_at FROM dashboards WHERE user_id = ? ORDER BY pos, created_at, id LIMIT 20";

// The account's dashboards as choices, in order: none while the tables are not on the database, and none to
// choose from with one (the caller then draws the one button). One statement.
export async function boardChoices(env: Env, userId: string, lang: Lang): Promise<BoardChoice[]> {
  try {
    const rows = (await env.ACCOUNTS!.prepare(BOARD_LIST_SQL).bind(userId).all<NamedBoard>()).results ?? [];
    if (rows.length < 2) return [];
    const labels = boardLabels(lang, rows);
    return rows.map((r) => ({ id: r.id, label: labels.get(r.id) ?? "" }));
  } catch (e) {
    if (missingTiles(e)) return [];
    throw e;
  }
}
