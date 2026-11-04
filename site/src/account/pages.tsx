// The account pages: the Console system's head band and panels, with forms in
// panels and data in definition lists and tables. Every page is noindex and
// never stored by a cache (routes.tsx sets the headers). Every form that
// changes something carries the session's CSRF value.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, page } from "../layout";
import { EMAIL_MAX } from "../pages/interest";
import { ProNote, ProTag } from "../pro";
import { KEYS_MAX, KEY_NAME_MAX, type KeyRow } from "./api_keys";
import type { BillingLine } from "./billing";
import { SAVED_SEARCH_MAX, allowed } from "./entitlements";
import { DELIVERY, type Delivery, type InterestRow, type LastDelivery, type SavedSearch, isDeliverable } from "./searches";
import type { Account } from "./session";
import { CODE_MINUTES } from "./signin";

export async function accountPage(c: Context<AppEnv>, title: string, body: unknown, status = 200): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats?.data_as_of ?? null} active="/account"
      seo={{ path: new URL(c.req.url).pathname, description: t(lang, "account.description"), noindex: true }}>
      {body as any}
    </Layout>,
    status,
  );
}

const Errors: FC<{ lang: Lang; errors?: Key[] }> = ({ lang, errors }) =>
  errors?.length ? <ul class="errors" role="alert">{errors.map((e) => <li>{t(lang, e)}</li>)}</ul> : null;

// A line saying what the last action did, already in the page's language.
const Notice: FC<{ message?: string | null }> = ({ message }) =>
  message ? <p class="account-notice" role="status">{message}</p> : null;

const Csrf: FC<{ account: Account }> = ({ account }) => <input type="hidden" name="csrf" value={account.csrf} />;

const Honeypot: FC<{ lang: Lang }> = ({ lang }) => (
  <div class="hp"><label>{t(lang, "form.honeypot")}<input name="website" type="text" tabindex={-1} autocomplete="off" /></label></div>
);

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

// -- sign-in ------------------------------------------------------------------------

export function signInView(lang: Lang, state: { errors?: Key[]; email?: string; notice?: string | null; limitN?: number } = {}) {
  const errors = state.errors ?? [];
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.sign_in_title")} lead={t(lang, "account.sign_in_lead")} />
      <Notice message={state.notice} />
      <Panel title={t(lang, "account.email_panel")} class="panel-form">
        {errors.length ? (
          <ul class="errors" role="alert">
            {errors.map((e) => <li>{e === "account.err_limited" ? t(lang, e, { n: state.limitN ?? 0 }) : t(lang, e)}</li>)}
          </ul>
        ) : null}
        <form method="post" action="/account/sign-in" class="stack">
          <input type="hidden" name="lang" value={lang} />
          <label>
            {t(lang, "interest.email")}
            <input name="email" type="email" required maxlength={EMAIL_MAX} autocomplete="email" spellcheck={false} value={state.email ?? ""} />
          </label>
          <Honeypot lang={lang} />
          <button type="submit" class="btn btn-primary">{t(lang, "account.send_code")}</button>
        </form>
        <p class="muted small">{tj(lang, "account.sign_in_privacy", { privacy: <a href="/privacy#accounts">{t(lang, "footer.privacy")}</a> })}</p>
      </Panel>
    </>
  );
}

// The code form: after a request (email hidden, the lead names it), or typed
// from scratch (the email as a field).
export function codeView(lang: Lang, state: { email?: string; sent?: boolean; errors?: Key[] } = {}) {
  const sent = !!state.sent && !!state.email;
  return (
    <>
      <PageHead lang={lang}
        title={t(lang, sent ? "account.check_title" : "account.enter_title")}
        lead={sent ? tj(lang, "account.check_lead", { email: <strong>{state.email}</strong>, minutes: CODE_MINUTES }) : t(lang, "account.enter_lead")} />
      <Panel title={t(lang, "account.code_panel")} class="panel-form">
        <Errors lang={lang} errors={state.errors} />
        <form method="post" action="/account/check" class="stack">
          <input type="hidden" name="lang" value={lang} />
          {sent ? (
            <>
              <input type="hidden" name="email" value={state.email} />
              <input type="hidden" name="sent" value="1" />
            </>
          ) : (
            <label>
              {t(lang, "interest.email")}
              <input name="email" type="email" required maxlength={EMAIL_MAX} autocomplete="email" spellcheck={false} value={state.email ?? ""} />
            </label>
          )}
          <label>
            {t(lang, "account.code")}
            <input name="code" type="text" required inputmode="numeric" pattern="[0-9]{6}" maxlength={6} autocomplete="one-time-code"
              spellcheck={false} class="account-code" />
          </label>
          <button type="submit" class="btn btn-primary">{t(lang, "account.sign_in")}</button>
        </form>
        <p class="muted small">{tj(lang, "account.code_again", { again: <a href="/account/sign-in">{t(lang, "account.code_again_link")}</a> })}</p>
      </Panel>
    </>
  );
}

// The link from the message opens this page; the button posts the token, so a
// mail scanner that fetches the link signs no one in and uses nothing up.
export function linkView(lang: Lang, token: string, errors?: Key[]) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.link_title")} lead={t(lang, "account.link_lead")} />
      <Panel title={t(lang, "account.link_panel")} class="panel-form">
        <Errors lang={lang} errors={errors} />
        {errors?.length ? (
          <p><a href="/account/sign-in" class="btn">{t(lang, "account.code_again_link")}</a></p>
        ) : (
          <form method="post" action="/account/check" class="stack">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="token" value={token} />
            <button type="submit" class="btn btn-primary">{t(lang, "account.sign_in")}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

// -- the overview ----------------------------------------------------------------------

export function planLabel(lang: Lang, account: Pick<Account, "plan" | "planUntil">): string {
  if (account.plan === "free") return t(lang, "account.plan_free");
  return account.planUntil ? t(lang, "account.plan_pro_until", { date: day(account.planUntil) }) : t(lang, "account.plan_pro_open");
}

// The plan as the overview and the billing page state it: a live Stripe
// subscription names the end of the period paid (billing.tsx), not the end
// of its grace; any other plan reads as planLabel.
export function planLine(lang: Lang, account: Pick<Account, "plan" | "planUntil">, billing?: BillingLine | null): string {
  if (billing?.stripe && account.plan === "pro") return t(lang, "billing.plan_stripe", { date: day(billing.periodEnd ?? account.planUntil) });
  return planLabel(lang, account);
}

export function overviewView(
  lang: Lang, account: Account, counts: { sessions: number; searches: number; cap: number; keys: number },
  extra: { billing?: BillingLine | null; notice?: string | null } = {},
) {
  const stripe = extra.billing?.stripe && account.plan === "pro";
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.title")} lead={t(lang, "account.lead", { email: account.email })} />
      <Notice message={extra.notice} />
      <Panel title={t(lang, "account.panel_account")}>
        <dl class="wide">
          <dt>{t(lang, "account.field_email")}</dt><dd>{account.email}</dd>
          <dt>{t(lang, "account.field_plan")}</dt>
          <dd>{planLine(lang, account, extra.billing)}</dd>
          <dt>{t(lang, "billing.field")}</dt>
          <dd><a href="/account/billing">{t(lang, stripe ? "billing.manage" : "billing.link_plans")}</a></dd>
          <dt>{t(lang, "account.field_since")}</dt><dd class="mono">{day(account.createdAt)}</dd>
          <dt>{t(lang, "account.field_sessions")}</dt><dd>{fmtInt(counts.sessions, lang)}</dd>
          {/* A Free account sees the row too, with the Pro chip, leading to the page's notice (bugs.tsx). */}
          <dt>{t(lang, "bugs.field")}</dt>
          <dd>
            <a href="/account/bug">
              {t(lang, "bugs.link")}{allowed(account, "bug_reports") ? null : <>{" "}<ProTag lang={lang} /></>}
            </a>
          </dd>
        </dl>
      </Panel>
      <Panel title={t(lang, "rail.lists")}>
        <ul class="kv">
          <li>
            <a href="/account/searches">{t(lang, "account.searches")}</a>
            <span class="num">{t(lang, "account.searches_n", { n: fmtInt(counts.searches, lang), cap: fmtInt(counts.cap, lang) })}</span>
          </li>
          <li>
            <a href="/account/keys">{t(lang, "account.keys")}{allowed(account, "api") ? null : <>{" "}<ProTag lang={lang} /></>}</a>
            <span class="num">{fmtInt(counts.keys, lang)}</span>
          </li>
        </ul>
      </Panel>
      <Panel title={t(lang, "account.panel_sign_out")}>
        <p>{t(lang, "account.sign_out_text")}</p>
        <div class="account-actions">
          <form method="post" action="/account/sign-out">
            <Csrf account={account} />
            <button type="submit" class="btn">{t(lang, "account.sign_out")}</button>
          </form>
          <form method="post" action="/account/sign-out">
            <Csrf account={account} />
            <input type="hidden" name="scope" value="all" />
            <button type="submit" class="btn">{t(lang, "account.sign_out_all")}</button>
          </form>
        </div>
      </Panel>
      <Panel title={t(lang, "account.delete_title")}>
        <p>{t(lang, "account.delete_text")}</p>
        <p><a href="/account/delete" class="btn">{t(lang, "account.delete_button")}</a></p>
      </Panel>
    </>
  );
}

// -- saved searches ------------------------------------------------------------------------

const DELIVERY_KEY: Record<Delivery, Key> = { daily: "account.deliver_daily", weekly: "account.deliver_weekly", off: "account.deliver_off" };

// "2026-11-03 15:02 UTC", the time of a delivery row.
const stamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

// The newest delivery of a search, under its delivery select: when it ran
// and what it did. Nothing for a search never delivered and switched off.
const LastDeliveryLine: FC<{ lang: Lang; last: LastDelivery | null; deliver: Delivery }> = ({ lang, last, deliver }) => {
  if (!last) return deliver === "off" ? null : <p class="muted small">{t(lang, "account.last_none")}</p>;
  const time = stamp(last.sent_at);
  const line = last.status === "sent"
    ? t(lang, last.items === 1 ? "account.last_sent_one" : "account.last_sent_many", { time, n: fmtInt(last.items, lang) })
    : last.status === "empty" ? t(lang, "account.last_empty", { time }) : t(lang, "account.last_failed", { time });
  return <p class="muted small">{line}</p>;
};

// The foot of a Free account's searches: how many it holds of its cap, what
// Pro holds and sends, and the billing page.
const CapNote: FC<{ lang: Lang; n: number; cap: number }> = ({ lang, n, cap }) => (
  <ProNote lang={lang}>
    {t(lang, "account.cap_note", { n: fmtInt(n, lang), cap: fmtInt(cap, lang), max: fmtInt(SAVED_SEARCH_MAX, lang) })}{" "}
    <a href="/account/billing">{t(lang, "billing.link_plans")}</a>
  </ProNote>
);

export function searchesView(
  lang: Lang, account: Account,
  state: {
    searches: (SavedSearch & { last?: LastDelivery | null })[]; cap: number; pending: InterestRow[]; notice?: string | null;
    errors?: Key[]; url?: string;
  },
) {
  const { searches, cap, pending } = state;
  const canDeliver = allowed(account, "delivery");
  const full = searches.length >= cap;
  const capLine = t(lang, account.plan === "free" ? "account.cap_free" : "account.cap_pro", { cap: fmtInt(cap, lang) });
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.searches_title")} lead={t(lang, "account.searches_lead_deliver")}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      <Notice message={state.notice} />
      {pending.length ? (
        <Panel title={t(lang, "account.panel_import")} count={fmtInt(pending.length, lang)}>
          <p>{t(lang, "account.import_text")}</p>
          <ul class="account-list">{pending.map((r) => <li><a href={r.params}>{r.label}</a></li>)}</ul>
          <form method="post" action="/account/searches/import">
            <Csrf account={account} />
            <button type="submit" class="btn btn-primary">{t(lang, "account.import_button")}</button>
          </form>
        </Panel>
      ) : null}
      <Panel title={t(lang, "account.searches_title")}
        count={t(lang, "account.searches_n", { n: fmtInt(searches.length, lang), cap: fmtInt(cap, lang) })}
        foot={canDeliver ? <p>{capLine}</p> : <CapNote lang={lang} n={searches.length} cap={cap} />}>
        {searches.length ? (
          <div class="table-wrap">
            <table class="restack">
              <thead>
                <tr><th>{t(lang, "account.col_search")}</th><th>{t(lang, "account.col_delivery")}</th><th>{t(lang, "account.col_remove")}</th></tr>
              </thead>
              <tbody>
                {searches.map((s) => (
                  <tr>
                    <td data-label={t(lang, "account.col_search")}><a href={s.params}>{s.label}</a></td>
                    <td data-label={t(lang, "account.col_delivery")}>
                      {!isDeliverable(s.kind) ? (
                        // The published files cannot tell this kind's new records yet (searches.ts).
                        <>
                          {canDeliver ? (
                            <div class="account-inline">
                              <select aria-label={t(lang, "account.col_delivery")} disabled>
                                <option value="off" selected>{t(lang, "account.deliver_off")}</option>
                              </select>
                            </div>
                          ) : <span class="muted">{t(lang, "account.deliver_off")}</span>}
                          <p class="muted small">{t(lang, "account.deliver_not_yet")}</p>
                        </>
                      ) : canDeliver ? (
                        <>
                          <form method="post" action={`/account/searches/${s.id}`} class="account-inline">
                            <Csrf account={account} />
                            <select name="deliver" aria-label={t(lang, "account.col_delivery")}>
                              {DELIVERY.map((d) => <option value={d} selected={d === s.deliver}>{t(lang, DELIVERY_KEY[d])}</option>)}
                            </select>
                            <button type="submit" class="btn">{t(lang, "account.deliver_save")}</button>
                          </form>
                          <LastDeliveryLine lang={lang} last={s.last ?? null} deliver={s.deliver} />
                        </>
                      ) : (
                        // A Free account: delivery reads "Off" in a gate note, not a disabled select.
                        <>
                          <ProNote lang={lang}>{t(lang, "account.deliver_gate")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></ProNote>
                          {s.last ? <LastDeliveryLine lang={lang} last={s.last} deliver={s.deliver} /> : null}
                        </>
                      )}
                    </td>
                    <td data-label={t(lang, "account.col_remove")}>
                      <form method="post" action={`/account/searches/${s.id}/delete`} class="account-inline">
                        <Csrf account={account} />
                        <button type="submit" class="btn-link">{t(lang, "account.delete")}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="muted">{t(lang, "account.searches_none")}</p>
        )}
      </Panel>
      <Panel title={t(lang, "account.panel_add")} class="panel-form">
        <Errors lang={lang} errors={state.errors} />
        {full ? (
          <p>{capLine}</p>
        ) : (
          <form method="post" action="/account/searches" class="stack">
            <Csrf account={account} />
            <label>
              {t(lang, "account.add_url")}
              <input name="url" type="text" required maxlength={2100} spellcheck={false} autocomplete="off"
                placeholder="https://awardwatch.ca/tenders?segment=43" value={state.url ?? ""} />
              <span class="muted small">{t(lang, "account.add_note")}</span>
            </label>
            <button type="submit" class="btn btn-primary">{t(lang, "account.add_button")}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

// -- stopping a delivery from its message ----------------------------------------------------------

// The stop link's page: the search's label and one button that posts the
// link's values back. No session is needed; the secret is the proof.
export function stopView(lang: Lang, state: { searchId: string; secret: string; label: string; off: boolean }) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.stop_title")} lead={t(lang, "account.stop_lead")} />
      <Panel title={t(lang, "account.stop_panel")} class="panel-form">
        <p><strong>{state.label}</strong></p>
        {state.off ? (
          <p>{t(lang, "account.stop_already")}</p>
        ) : (
          <form method="post" action="/account/stop" class="stack">
            <input type="hidden" name="s" value={state.searchId} />
            <input type="hidden" name="t" value={state.secret} />
            <input type="hidden" name="lang" value={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "account.stop_button")}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

export function stoppedView(lang: Lang, label: string) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.stopped_title")} lead={t(lang, "account.stopped_lead")}
        actions={<a href="/account/searches" class="btn">{t(lang, "account.searches_title")}</a>} />
      <Panel title={t(lang, "account.stop_panel")}>
        <p><strong>{label}</strong></p>
      </Panel>
    </>
  );
}

// -- API keys ----------------------------------------------------------------------------------

export function keysView(lang: Lang, account: Account, state: { keys: KeyRow[]; created?: string; notice?: string | null; errors?: Key[] }) {
  const live = state.keys.filter((k) => !k.revoked_at).length;
  const canCreate = allowed(account, "api");
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.keys_title")} lead={t(lang, "account.keys_lead")}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      <Notice message={state.notice} />
      {state.created ? (
        <Panel title={t(lang, "account.panel_new_key")}>
          <p>{t(lang, "account.new_key_text")}</p>
          <pre class="cite-block account-key">{state.created}</pre>
        </Panel>
      ) : null}
      <Panel title={t(lang, "account.panel_create_key")} class="panel-form" tools={canCreate ? undefined : <ProTag lang={lang} />}>
        <Errors lang={lang} errors={state.errors} />
        {!canCreate ? (
          <p>{t(lang, "account.keys_pro")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></p>
        ) : live >= KEYS_MAX ? (
          <p>{t(lang, "account.keys_limit", { n: KEYS_MAX })}</p>
        ) : (
          <form method="post" action="/account/keys" class="stack">
            <Csrf account={account} />
            <label>
              {t(lang, "account.key_name")}
              <input name="name" type="text" required maxlength={KEY_NAME_MAX} autocomplete="off" placeholder={t(lang, "account.key_name_placeholder")} />
            </label>
            <button type="submit" class="btn btn-primary">{t(lang, "account.create_key")}</button>
          </form>
        )}
      </Panel>
      <Panel title={t(lang, "account.panel_keys")} count={fmtInt(live, lang)}>
        {state.keys.length ? (
          <div class="table-wrap">
            <table class="restack">
              <thead>
                <tr>
                  <th>{t(lang, "account.key_name")}</th><th>{t(lang, "account.col_prefix")}</th><th>{t(lang, "account.col_created")}</th>
                  <th>{t(lang, "account.col_last_used")}</th><th>{t(lang, "account.col_status")}</th>
                </tr>
              </thead>
              <tbody>
                {state.keys.map((k) => (
                  <tr>
                    <td data-label={t(lang, "account.key_name")}>{k.name}</td>
                    <td data-label={t(lang, "account.col_prefix")} class="mono">aw_{k.prefix}</td>
                    <td data-label={t(lang, "account.col_created")} class="mono">{day(k.created_at)}</td>
                    <td data-label={t(lang, "account.col_last_used")} class="mono">{k.last_used_at ? day(k.last_used_at) : t(lang, "account.key_never")}</td>
                    <td data-label={t(lang, "account.col_status")}>
                      {k.revoked_at ? (
                        <span class="muted">{t(lang, "account.key_revoked", { date: day(k.revoked_at) })}</span>
                      ) : (
                        <form method="post" action={`/account/keys/${k.id}/revoke`} class="account-inline">
                          <Csrf account={account} />
                          <span>{t(lang, "account.key_active")}</span>
                          <button type="submit" class="btn-link">{t(lang, "account.revoke")}</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="muted">{t(lang, "account.keys_none")}</p>
        )}
      </Panel>
    </>
  );
}

// -- deletion -----------------------------------------------------------------------------------

export function deleteView(lang: Lang, account: Account, errors?: Key[]) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "account.delete_title")} lead={t(lang, "account.delete_lead")}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      <Panel title={t(lang, "account.panel_delete_what")} class="panel-form">
        <Errors lang={lang} errors={errors} />
        <ul class="account-list">
          <li>{t(lang, "account.delete_subscription")}</li>
          <li>{t(lang, "account.delete_searches")}</li>
          <li>{t(lang, "bugs.delete")}</li>
          <li>{t(lang, "account.delete_sessions")}</li>
          <li>{t(lang, "account.delete_interest")}</li>
          <li>{t(lang, "account.delete_email")}</li>
        </ul>
        <p class="muted small">{t(lang, "account.delete_kept")}</p>
        <form method="post" action="/account/delete" class="stack">
          <Csrf account={account} />
          <label class="account-check">
            <input type="checkbox" name="confirm" value="yes" required />
            <span>{t(lang, "account.delete_confirm")}</span>
          </label>
          <button type="submit" class="btn btn-primary">{t(lang, "account.delete_button")}</button>
        </form>
      </Panel>
    </>
  );
}

export function deletedView(lang: Lang) {
  return (
    <PageHead lang={lang} title={t(lang, "account.deleted_title")} lead={t(lang, "account.deleted_lead")}
      actions={<a href="/" class="btn">{t(lang, "account.home")}</a>} />
  );
}

export function unavailableView(lang: Lang) {
  return <PageHead lang={lang} title={t(lang, "account.unavailable_title")} lead={t(lang, "account.unavailable_text")} />;
}
