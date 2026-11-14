// The saved views' pages (docs/accounts.md, Saved views): the Save control
// on an analytics view (pages/analytics.tsx), /account/views with each view,
// its email and its count against the plan's figure, the Saved Views panel of
// the analytics index (pages/analytics_index.tsx), and the stop pages of a
// view's email. routes.tsx mounts the page, its posts and the stop link.
//
// The control reads the session the page's shell already read (readSession
// keeps one answer a request) and one statement on the accounts database. It
// renders only for a signed-in reader, so its CSRF value only reaches a page
// the layout makes private. While the switch is off, for a reader not signed
// in, and while the saved_views table is not on the database, it renders
// nothing and the page keeps every byte.
//
// Nothing here names Ultra while Ultra is not on sale (payments.ts
// ultraOnSale): the gate names Pro alone, and the email's column, its gate
// and its select are left out, since the run sends nothing then.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { Table } from "../columns";
import type { AppEnv } from "../env";
import { fmtInt, t, type Key, type Lang } from "../i18n";
import { PageHead, Panel } from "../layout";
import { PlanCards, type PlanCard } from "../pro";
import type { View } from "../view_address";
import { AddToDashboard } from "./dashboard_add";
import { holdsDashboard } from "./dashboard_rule";
import { RULES, allowed, savedViewCap } from "./entitlements";
import { VIEW_DELIVERY, type SavedView, type ViewDelivery, type ViewRun, NAME_MAX, viewState } from "./saved_views";
import { type Account, readSession } from "./session";
import { accountsEnabled } from "./switch";

export const VIEWS_PATH = "/account/views";

const Csrf: FC<{ account: Account }> = ({ account }) => <input type="hidden" name="csrf" value={account.csrf} />;

// The gate line: plain muted text and the way to the plans, naming Ultra
// only while it is on sale.
const Gate: FC<{ lang: Lang; ultra: boolean; class?: string }> = ({ lang, ultra, class: cls }) => (
  <p class={cls ?? "muted"}>
    {ultra
      ? t(lang, "views.gate", { pro: fmtInt(RULES.pro.saved_views, lang), ultra: fmtInt(RULES.ultra.saved_views, lang) })
      : t(lang, "views.gate_pro", { pro: fmtInt(RULES.pro.saved_views, lang) })}{" "}
    <a href="/account/billing">{t(lang, "billing.link_plans")}</a>
  </p>
);

// -- the control on a view ------------------------------------------------------------------

export type SaveViewState = {
  account: Account;
  // The address the view writes for itself, which the post saves, and the site's label of it.
  address: string; label: string;
  saved: boolean; n: number; cap: number;
};

// What the control shows for this request: null while the switch is off, for
// a reader not signed in, and when the accounts database cannot say, cannot be
// read or has no saved_views table yet.
export async function saveViewControl(c: Context<AppEnv>, address: string, label: string): Promise<SaveViewState | null> {
  if (!accountsEnabled(c.env)) return null;
  const read = await readSession(c).catch(() => ({ state: "unavailable" }) as const);
  if (read.state !== "ok") return null;
  try {
    const s = await viewState(c.env, read.account.userId, address);
    if (!s) return null;
    return { account: read.account, address, label, saved: s.saved, n: s.n, cap: savedViewCap(read.account.plan) };
  } catch {
    return null;
  }
}

// A row of the view's toolbar, under its period: the name and Save this view
// (a flat button: a view keeps no filled one); the saved state; the plan's
// figure reached; or, on a plan that keeps none, Save this view leading to
// the saved views page, which says what keeps them.
export const SaveViewRow: FC<{ lang: Lang; state: SaveViewState | null }> = ({ lang, state }) => {
  if (!state) return null;
  const manage = <a href={VIEWS_PATH}>{t(lang, "views.manage")}</a>;
  if (state.saved) return <p class="toolbar-note save-view">{t(lang, "views.saved")} {manage}</p>;
  if (!state.cap) {
    return <div class="toolbar-row save-view"><a href={VIEWS_PATH} class="btn">{t(lang, "views.save")}</a></div>;
  }
  if (state.n >= state.cap) return <p class="toolbar-note save-view">{t(lang, "views.full", { cap: fmtInt(state.cap, lang) })} {manage}</p>;
  return (
    <form method="post" action={VIEWS_PATH} class="save-view">
      <Csrf account={state.account} />
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="address" value={state.address} />
      <div class="toolbar-fields">
        <label class="field field-text">
          <span class="field-label">{t(lang, "views.name")}</span>
          <input type="text" name="name" maxlength={NAME_MAX} autocomplete="off" placeholder={state.label} aria-describedby="save-view-hint" />
        </label>
        <div class="toolbar-actions">
          <button type="submit" class="btn">{t(lang, "views.save")}</button>
        </div>
      </div>
      <p class="toolbar-note" id="save-view-hint">{t(lang, "views.name_hint")}</p>
    </form>
  );
};

// -- /account/views ---------------------------------------------------------------------------

const DELIVER_KEY: Readonly<Record<ViewDelivery, Key>> = {
  weekly: "views.deliver_weekly", monthly: "views.deliver_monthly", off: "views.deliver_off",
};
const KIND_KEY: Readonly<Record<View, Key>> = { buyer: "col.buyer", organization: "col.organization", segment: "col.segment" };

// "2026-11-03 15:02 UTC", the time of a run.
const stamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

// The newest run of a view, under its select: when it ran and what it did.
// Nothing for a view never sent and switched off.
const LastRun: FC<{ lang: Lang; last: ViewRun | null; deliver: ViewDelivery }> = ({ lang, last, deliver }) => {
  if (!last) return deliver === "off" ? null : <p class="muted small">{t(lang, "views.last_none")}</p>;
  const time = stamp(last.sent_at);
  const key: Key = last.status === "sent" ? "views.last_sent" : last.status === "same" ? "views.last_same" : "views.last_failed";
  return <p class="muted small">{t(lang, key, { time })}</p>;
};

export type ViewsPageState = {
  views: (SavedView & { last: ViewRun | null })[];
  notice?: string | null;
  // Ultra is on sale: the email's column, and the gate naming Ultra.
  ultra: boolean;
  // The plan cards for an account whose plan keeps no view; null otherwise.
  cards: PlanCard[] | null;
};

export function viewsView(lang: Lang, account: Account, s: ViewsPageState) {
  const cap = savedViewCap(account.plan);
  const n = s.views.length;
  const mail = s.ultra && allowed(account, "view_mail");
  const dash = holdsDashboard(account.plan);
  return (
    <>
      <PageHead lang={lang} title={t(lang, "views.title")} lead={t(lang, "views.lead")}
        actions={<a href="/analytics" class="btn">{t(lang, "rail.analytics")}</a>} />
      {s.notice ? <p class="account-notice" role="status">{s.notice}</p> : null}
      {cap ? null : <Gate lang={lang} ultra={s.ultra} />}
      {cap || n ? (
        <Panel title={t(lang, "views.title")} count={cap ? t(lang, "views.count", { n: fmtInt(n, lang), cap: fmtInt(cap, lang) }) : fmtInt(n, lang)}>
          {/* Past the plan's figure (after a move to a smaller plan): nothing deleted, the ones past it marked. */}
          {n > cap && cap ? <p>{t(lang, "views.over_cap", { n: fmtInt(n, lang), cap: fmtInt(cap, lang) })}</p> : null}
          {n ? (
            <div class="table-wrap">
              {/* In the order they were saved, which decides the ones within the plan; the cells are forms. */}
              <Table sorting="none" cols={[
                { kind: "main", label: t(lang, "views.col_view") },
                s.ultra ? { kind: "text", label: t(lang, "views.col_email") } : null,
                { kind: "label", label: t(lang, "views.col_remove") },
              ]}>
                <tbody>
                  {s.views.map((v, i) => (
                    <tr>
                      <td data-label={t(lang, "views.col_view")}>
                        <a href={v.address}>{v.name}</a>
                        <br /><span class="muted small">{t(lang, KIND_KEY[v.kind])}</span>
                        {i >= cap ? <><br /><span class="muted small">{t(lang, "views.past")}</span></> : null}
                        {dash ? <AddToDashboard lang={lang} account={account} kind="view" panelRef={v.id} /> : null}
                      </td>
                      {s.ultra ? (
                        <td data-label={t(lang, "views.col_email")}>
                          {mail ? (
                            <>
                              <form method="post" action={`${VIEWS_PATH}/${v.id}`} class="watch-settings">
                                <Csrf account={account} />
                                <select name="deliver" aria-label={t(lang, "views.col_email")}>
                                  {VIEW_DELIVERY.map((d) => <option value={d} selected={d === v.deliver}>{t(lang, DELIVER_KEY[d])}</option>)}
                                </select>
                                <button type="submit" class="btn">{t(lang, "views.deliver_save")}</button>
                              </form>
                              <LastRun lang={lang} last={v.last} deliver={v.deliver} />
                            </>
                          ) : (
                            <p class="muted small">{t(lang, "views.deliver_gate")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></p>
                          )}
                        </td>
                      ) : null}
                      <td data-label={t(lang, "views.col_remove")}>
                        <form method="post" action={`${VIEWS_PATH}/${v.id}/delete`} class="account-inline">
                          <Csrf account={account} />
                          <button type="submit" class="btn-link">{t(lang, "views.remove")}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : <p class="muted">{t(lang, "views.none")}</p>}
        </Panel>
      ) : null}
      {s.cards ? <PlanCards lang={lang} plans={s.cards} /> : null}
    </>
  );
}

// -- the analytics index's panel --------------------------------------------------------------

// The account's saved views on /analytics, each opening as saved, and the
// way to the page that manages them; one line on saving one while it holds
// none. A plan that keeps none and holds none has no panel.
export const SavedViewsPanel: FC<{ lang: Lang; views: readonly SavedView[]; cap: number }> = ({ lang, views, cap }) =>
  cap || views.length ? (
    <Panel title={t(lang, "views.title")} count={cap ? t(lang, "views.count", { n: fmtInt(views.length, lang), cap: fmtInt(cap, lang) }) : fmtInt(views.length, lang)}
      tools={<a href={VIEWS_PATH}>{t(lang, "views.manage")}</a>}>
      {views.length ? (
        <ul class="view-list">{views.map((v) => <li><a href={v.address} rel="nofollow">{v.name}</a></li>)}</ul>
      ) : <p class="muted">{t(lang, "views.index_none")}</p>}
    </Panel>
  ) : null;

// -- the stop link's pages ---------------------------------------------------------------------

export function viewStopView(lang: Lang, state: { id: string; secret: string; name: string; off: boolean }) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "views.stop_title")} lead={t(lang, "views.stop_lead")} />
      <Panel title={t(lang, "views.stop_panel")} class="panel-form">
        <p><strong>{state.name}</strong></p>
        {state.off ? (
          <p>{t(lang, "views.stop_already")}</p>
        ) : (
          <form method="post" action="/account/stop" class="stack">
            <input type="hidden" name="v" value={state.id} />
            <input type="hidden" name="t" value={state.secret} />
            <input type="hidden" name="lang" value={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "views.stop_button")}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

export function viewStoppedView(lang: Lang, name: string) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "views.stopped_title")} lead={t(lang, "views.stopped_lead")}
        actions={<a href={VIEWS_PATH} class="btn">{t(lang, "views.title")}</a>} />
      <Panel title={t(lang, "views.stop_panel")}>
        <p><strong>{name}</strong></p>
      </Panel>
    </>
  );
}
