// "Add to dashboard": the one control an Ultra account gets beside what can
// become a panel (an analytics view's head, a saved search's row, a
// briefing's row, a saved view's row). It posts the panel's kind and its ref to the dashboard
// (dashboard.tsx addPanelPost), which keeps it within the plan's figure and
// answers on the dashboard itself. Callers draw it only for an account that
// holds the dashboard (dashboard_rule.ts holdsDashboard), so nothing changes
// for any other reader.

import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { FC } from "hono/jsx";
import type { AppEnv } from "../env";
import { t, type Lang } from "../i18n";
import { DASHBOARD_PATH, holdsDashboard } from "./dashboard_rule";
import { type Account, SESSION_COOKIE, readSession } from "./session";
import { accountsEnabled } from "./switch";

export const AddToDashboard: FC<{ lang: Lang; account: Pick<Account, "csrf">; kind: string; panelRef: string; button?: boolean }> = (
  { lang, account, kind, panelRef, button },
) => (
  <form method="post" action={`${DASHBOARD_PATH}/panels`} class="account-inline dash-add">
    <input type="hidden" name="csrf" value={account.csrf} />
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="ref" value={panelRef} />
    <button type="submit" class={button ? "btn" : "btn-link"}>{t(lang, "dash.add_here")}</button>
  </form>
);

// The request's account when it holds the dashboard, else null: nothing is
// read while the switch is off or without a session cookie, and the session
// is the one the page's shell reads (readSession keeps one answer a request).
export async function dashboardAccount(c: Context<AppEnv>): Promise<Account | null> {
  if (!accountsEnabled(c.env) || !getCookie(c, SESSION_COOKIE)) return null;
  const read = await readSession(c).catch(() => null);
  return read?.state === "ok" && holdsDashboard(read.account.plan) ? read.account : null;
}

// An analytics view's address as a panel's ref (dashboard.tsx viewRef reads it
// back): its path, then its source and its period, the keys in order.
export function viewPanelRef(base: string, f: { source: string; years: number; first: number; last: number; custom: boolean }): string {
  return f.custom ? `${base}?from=${f.first}&source=${f.source}&to=${f.last}` : `${base}?source=${f.source}&years=${f.years}`;
}
