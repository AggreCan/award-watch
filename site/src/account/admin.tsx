// The operator console, mounted at /admin by index.tsx. Every route answers
// the site's own 404, the same page any unknown address gets, unless all of
// these hold, in this order:
//
//   1. the accounts switch is on (switch.ts);
//   2. OPERATOR_EMAILS, a secret, names at least one address;
//   3. when ACCESS_AUD is set: the request carries a Cloudflare Access token
//      that verifies (admin_access.ts) and whose email claim is listed;
//   4. a session stands, read fresh from the database (not the outage
//      memory), and its address is listed;
//   5. when ACCESS_AUD is set: the token's address is the session's.
//
//   GET  /admin                                        counts, the last audit events, the search box (?q=)
//   GET  /admin/users/:id                              one account: rows, plan, subscription, activity, actions
//   POST /admin/users/:id/grant                        Pro by hand (end date optional, reference required)
//   POST /admin/users/:id/entitlements/:eid/revoke     revoke one row
//   POST /admin/users/:id/sign-out                     revoke every session
//   POST /admin/users/:id/unblock                      lift a block
//   GET  /admin/users/:id/block | email | cancel | refund | delete   what the action will do (confirm page)
//   POST /admin/users/:id/block | email | cancel | refund | delete   do it (confirm=yes from that page)
//
// Every POST needs an Origin header naming the site (a browser always sends
// one with a form post, so a post without one is refused here, unlike the
// account pages) and the session's CSRF value. Every answer past the guards
// is no-store and noindex. Every action writes an audit row naming the
// operator by user id (admin_ops.ts). The pages show no card data: Stripe
// keeps it, and nothing here asks for it (admin_stripe.ts).

import { Hono, type Context } from "hono";
import type { FC } from "hono/jsx";
import { isOwnAddress } from "../api";
import { readForm } from "../body";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, page } from "../layout";
import { CONTACT_EMAIL } from "../pages/docs";
import { EMAIL_MAX, normalizeEmail } from "../pages/interest";
import { accessEmail, accessRequired } from "./admin_access";
import {
  type BlockRow, type Overview, type UserDetail, type UserHit, type UserRow, ID_RE, USER_DELIVERY_ROWS, WEEK_DAYS, blockAccount,
  changeAddress, findUsers, grantPro, isBlocked, operatorAudit, operatorEmails, overview, revocable, revokeEntitlement, unblockAccount,
  userDetail,
} from "./admin_ops";
import { type LiveSubscription, type PaidCharge, operatorStripe } from "./admin_stripe";
import { endForDeletion } from "./billing";
import { type PlanState, planFor } from "./entitlements";
import { planLabel } from "./pages";
import { deleteAccount } from "./routes";
import { type MailMessage, isLocalHost, senderFor } from "./sender";
import { type Account, csrfValid, readSession, revokeAllSessions } from "./session";
import { accountsEnabled } from "./switch";

export const admin = new Hono<AppEnv>();

export const REFERENCE_MAX = 120;
export const REASON_MAX = 200;

// The operator a request was admitted for, set by the guard below.
const operators = new WeakMap<Request, Account>();

async function admitted(c: Context<AppEnv>): Promise<Account | null> {
  if (!accountsEnabled(c.env)) return null;
  const listed = operatorEmails(c.env);
  if (!listed.size) return null;
  // The token first, when one is required: a request without it reads nothing.
  let fromAccess: string | null = null;
  if (accessRequired(c.env)) {
    fromAccess = await accessEmail(c.env, c.req.raw.headers);
    if (!fromAccess || !listed.has(fromAccess)) return null;
  }
  // Read without extending the session: a touch would add a Set-Cookie to the
  // 404 a non-operator gets here, which an unknown address never carries.
  let read;
  try {
    read = await readSession(c);
  } catch {
    return null;
  }
  if (read.state !== "ok" || read.account.stale) return null;
  const email = read.account.email.toLowerCase();
  if (!listed.has(email)) return null;
  if (fromAccess !== null && fromAccess !== email) return null;
  return read.account;
}

admin.use("*", async (c, next) => {
  const op = await admitted(c);
  if (!op) return c.notFound();
  operators.set(c.req.raw, op);
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
});

const operatorOf = (c: Context<AppEnv>): Account => operators.get(c.req.raw)!;

// -- shared steps -------------------------------------------------------------------------

const CONTROL_RE = /[\u0000-\u001F\u007F]/g;

function clean(fields: Record<string, string>, key: string, max: number): string {
  const v = fields[key];
  return (typeof v === "string" ? v : "").replace(CONTROL_RE, " ").trim().slice(0, max);
}

async function adminPage(c: Context<AppEnv>, title: string, body: unknown, status = 200): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats?.data_as_of ?? null}
      seo={{ path: new URL(c.req.url).pathname, description: t(lang, "admin.description"), noindex: true }}>
      {body as any}
    </Layout>,
    status,
  );
}

function unavailable(c: Context<AppEnv>, e: unknown): Promise<Response> {
  console.error(`admin: ${String(e).slice(0, 120)}`);
  const lang = c.get("lang");
  return adminPage(c, t(lang, "account.unavailable_title"),
    <PageHead lang={lang} title={t(lang, "account.unavailable_title")} lead={t(lang, "account.unavailable_text")} />, 503);
}

// Any database fault inside a handler ends on the accounts' 503 page, never a 500.
async function guarded(c: Context<AppEnv>, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    return unavailable(c, e);
  }
}

type Post = { op: Account; fields: Record<string, string>; user: UserRow };

// A POST: its Origin, its body, the session's CSRF value, then the account
// it is about. A refusal is a 403 with one line; an unknown account the 404.
async function operatorPost(c: Context<AppEnv>): Promise<Post | Response> {
  const lang = c.get("lang");
  const origin = c.req.header("origin");
  if (!origin || !isOwnAddress(origin, c.req.url)) return c.text(t(lang, "form.rejected"), 403);
  const form = await readForm(c);
  if (!form.ok) return c.text(t(lang, "form.rejected"), form.status);
  const asked = form.fields.lang;
  if (asked === "en" || asked === "fr") c.set("lang", asked);
  const op = operatorOf(c);
  if (!csrfValid(op, form.fields.csrf)) return c.text(t(c.get("lang"), "form.rejected"), 403);
  let user: UserRow | null;
  try {
    user = await target(c);
  } catch (e) {
    return unavailable(c, e);
  }
  if (!user) return c.notFound();
  return { op, fields: form.fields, user };
}

async function target(c: Context<AppEnv>): Promise<UserRow | null> {
  const id = c.req.param("id") ?? "";
  if (!ID_RE.test(id)) return null;
  return c.env.ACCOUNTS!.prepare(
    "SELECT id, email, created_at, last_seen_at, lang, status, plan, plan_until, deleted_at FROM users WHERE id = ?",
  ).bind(id).first<UserRow>();
}

const userPath = (id: string, m?: string) => `/admin/users/${id}${m ? `?m=${m}` : ""}`;

// Where the address-change message's link points: the request's own origin
// on a local run, the site's address otherwise (routes.tsx does the same for
// the sign-in message).
function siteBase(c: Context<AppEnv>): string {
  if (isLocalHost(c.req.url) || !c.env.SITE_URL) return new URL(c.req.url).origin;
  return c.env.SITE_URL.replace(/\/+$/, "");
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const stamp = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "");
const isSelf = (op: Account, user: UserRow) => op.userId === user.id;

// -- small pieces of the pages ---------------------------------------------------------------

const Csrf: FC<{ op: Account }> = ({ op }) => <input type="hidden" name="csrf" value={op.csrf} />;

const Errors: FC<{ lang: Lang; errors?: Key[]; vars?: Record<string, string | number> }> = ({ lang, errors, vars }) =>
  errors?.length ? <ul class="errors" role="alert">{errors.map((e) => <li>{t(lang, e, vars)}</li>)}</ul> : null;

const Notice: FC<{ message?: string | null }> = ({ message }) =>
  message ? <p class="account-notice" role="status">{message}</p> : null;

const ConfirmBox: FC<{ lang: Lang }> = ({ lang }) => (
  <label class="account-check">
    <input type="checkbox" name="confirm" value="yes" required />
    <span>{t(lang, "admin.confirm_box")}</span>
  </label>
);

const UserLink: FC<{ id: string | null }> = ({ id }) =>
  id ? <a href={`/admin/users/${id}`} class="mono">{id}</a> : <span class="muted">-</span>;

const Table: FC<{ heads: string[]; rows: unknown[][] }> = ({ heads, rows }) => (
  <div class="table-wrap">
    <table class="restack">
      <thead><tr>{heads.map((h) => <th>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => <tr>{r.map((cell, i) => <td data-label={heads[i]}>{cell as any}</td>)}</tr>)}
      </tbody>
    </table>
  </div>
);

const statusWord = (lang: Lang, status: string) => t(lang, status === "deleted" ? "admin.status_deleted" : "admin.status_active");
const cachedPlan = (lang: Lang, u: { plan: string; plan_until: string | null }) =>
  planLabel(lang, { plan: u.plan === "pro" ? "pro" : "free", planUntil: u.plan_until });

function auditRows(lang: Lang, rows: Overview["audit"], withUser: boolean): unknown[][] {
  return rows.map((a) => [
    <span class="mono">{stamp(a.at)}</span>, <span class="mono">{a.event}</span>,
    ...(withUser ? [<UserLink id={a.user_id} />] : []),
    a.detail ?? "",
  ]);
}

// -- the overview ----------------------------------------------------------------------------

function overviewView(lang: Lang, o: Overview, search: { q: string; hits: UserHit[] | null }) {
  const subs = o.subscriptions.length
    ? o.subscriptions.map((s) => `${s.status} ${fmtInt(s.n, lang)}`).join(", ")
    : t(lang, "admin.none");
  return (
    <>
      <PageHead lang={lang} title={t(lang, "admin.title")} lead={t(lang, "admin.lead")} />
      <Panel title={t(lang, "admin.panel_find")} class="panel-form">
        <form method="get" action="/admin" class="stack" role="search">
          <label>
            {t(lang, "admin.find_label")}
            <input name="q" type="search" required maxlength={EMAIL_MAX} autocomplete="off" spellcheck={false} value={search.q} />
          </label>
          <button type="submit" class="btn btn-primary">{t(lang, "admin.find")}</button>
        </form>
      </Panel>
      {search.hits === null ? null : (
        <Panel title={t(lang, "admin.panel_hits")} count={fmtInt(search.hits.length, lang)}>
          {search.hits.length ? (
            <Table heads={[t(lang, "admin.col_address"), t(lang, "admin.col_user"), t(lang, "admin.col_status"), t(lang, "admin.col_plan"), t(lang, "admin.col_created")]}
              rows={search.hits.map((u) => [
                <a href={`/admin/users/${u.id}`}>{u.email}</a>, <UserLink id={u.id} />, statusWord(lang, u.status), cachedPlan(lang, u),
                <span class="mono">{day(u.created_at)}</span>,
              ])} />
          ) : <p class="muted">{t(lang, "admin.find_none")}</p>}
        </Panel>
      )}
      <Panel title={t(lang, "admin.panel_counts")}>
        <dl class="wide">
          <dt>{t(lang, "admin.count_accounts")}</dt><dd>{fmtInt(o.active, lang)}</dd>
          <dt>{t(lang, "admin.count_deleted")}</dt><dd>{fmtInt(o.deleted, lang)}</dd>
          {o.blocked === null ? null : <><dt>{t(lang, "admin.count_blocked")}</dt><dd>{fmtInt(o.blocked, lang)}</dd></>}
          <dt>{t(lang, "admin.count_sessions")}</dt><dd>{fmtInt(o.sessions, lang)}</dd>
          <dt>{t(lang, "admin.count_pro_manual")}</dt><dd>{fmtInt(o.proManual, lang)}</dd>
          <dt>{t(lang, "admin.count_pro_stripe")}</dt><dd>{fmtInt(o.proStripe, lang)}</dd>
          <dt>{t(lang, "admin.count_subscriptions")}</dt><dd>{subs}</dd>
          <dt>{t(lang, "admin.count_sent", { n: WEEK_DAYS })}</dt><dd>{fmtInt(o.sent, lang)}</dd>
          <dt>{t(lang, "admin.count_failed", { n: WEEK_DAYS })}</dt><dd>{fmtInt(o.failed, lang)}</dd>
          {o.bugs === null ? null : (
            <>
              <dt>{t(lang, "admin.count_bugs_week", { n: WEEK_DAYS })}</dt><dd>{fmtInt(o.bugs.week, lang)}</dd>
              <dt>{t(lang, "admin.count_bugs_all")}</dt><dd>{fmtInt(o.bugs.all, lang)}</dd>
            </>
          )}
          <dt>{t(lang, "admin.count_codes")}</dt><dd>{fmtInt(o.codesToday, lang)}</dd>
        </dl>
      </Panel>
      <Panel title={t(lang, "admin.panel_audit")} count={fmtInt(o.audit.length, lang)}>
        {o.audit.length ? (
          <Table heads={[t(lang, "admin.col_time"), t(lang, "admin.col_event"), t(lang, "admin.col_account"), t(lang, "admin.col_detail")]}
            rows={auditRows(lang, o.audit, true)} />
        ) : <p class="muted">{t(lang, "admin.audit_none")}</p>}
      </Panel>
      {o.latestBugs === null ? null : (
        <Panel title={t(lang, "admin.panel_bugs")} count={fmtInt(o.latestBugs.length, lang)}>
          {o.latestBugs.length ? (
            <Table heads={[t(lang, "admin.col_time"), t(lang, "admin.col_account"), t(lang, "admin.col_page"), t(lang, "admin.col_report")]}
              rows={o.latestBugs.map((b) => [<span class="mono">{stamp(b.created_at)}</span>, <UserLink id={b.user_id} />, b.page, b.text])} />
          ) : <p class="muted">{t(lang, "admin.bugs_none")}</p>}
        </Panel>
      )}
    </>
  );
}

admin.get("/", async (c) => {
  const lang = c.get("lang");
  return guarded(c, async () => {
    const q = (c.req.query("q") ?? "").trim().slice(0, EMAIL_MAX);
    const [o, hits] = await Promise.all([overview(c.env), q ? findUsers(c.env, q) : Promise.resolve(null)]);
    return adminPage(c, t(lang, "admin.title"), overviewView(lang, o, { q, hits }));
  });
});

// -- one account -------------------------------------------------------------------------------

const NOTICE: Record<string, Key> = {
  granted: "admin.msg_granted", revoked: "admin.msg_revoked", nothing: "admin.msg_nothing", cancel_end: "admin.msg_cancel_end",
  cancel_now: "admin.msg_cancel_now", refunded: "admin.msg_refunded", blocked: "admin.msg_blocked", already_blocked: "admin.msg_already_blocked",
  unblocked: "admin.msg_unblocked", not_blocked: "admin.msg_not_blocked", email: "admin.msg_email", email_unsent: "admin.msg_email_unsent",
  signed_out: "admin.msg_signed_out", deleted: "admin.msg_deleted",
};

const DELIVER_KEY: Record<string, Key> = { daily: "account.deliver_daily", weekly: "account.deliver_weekly", off: "account.deliver_off" };
const DEVICE_KEY: Record<string, Key> = { desktop: "admin.device_desktop", mobile: "admin.device_mobile", tablet: "admin.device_tablet" };

function entState(lang: Lang, e: UserDetail["entitlements"][number], now: Date): string {
  const at = now.toISOString();
  if (e.revoked_at) return t(lang, "admin.ent_revoked", { date: day(e.revoked_at) });
  if (e.ends_at !== null && e.ends_at <= at) return t(lang, "admin.ent_ended");
  if (e.starts_at > at) return t(lang, "admin.ent_future");
  return t(lang, "admin.ent_live");
}

function lastDelivery(lang: Lang, s: UserDetail["searches"][number]): string {
  if (!s.last_status || !s.last_at) return t(lang, "admin.never");
  const what = s.last_status === "sent" ? t(lang, "admin.d_sent", { n: fmtInt(s.last_items ?? 0, lang) })
    : s.last_status === "empty" ? t(lang, "admin.d_empty") : t(lang, "admin.d_failed");
  return `${stamp(s.last_at)}, ${what}`;
}

const deliveryWord = (lang: Lang, status: string, items: number) =>
  status === "sent" ? t(lang, "admin.d_sent", { n: fmtInt(items, lang) }) : status === "empty" ? t(lang, "admin.d_empty") : t(lang, "admin.d_failed");

type UserState = {
  plan: PlanState; stripeOn: boolean; live: LiveSubscription | "missing" | null | undefined;
  notice?: string | null; errors?: Key[]; until?: string; reference?: string;
};

function blockLine(lang: Lang, block: BlockRow | null): string {
  if (!block) return t(lang, "admin.no");
  return t(lang, "admin.blocked_since", { date: day(block.created_at), by: block.by_user_id, reason: block.reason ?? "" });
}

function subscriptionPanel(lang: Lang, d: UserDetail, s: UserState) {
  const p = d.payment;
  const id = d.user.id;
  const live = s.live;
  return (
    <Panel title={t(lang, "admin.panel_subscription")}>
      {p ? (
        <dl class="wide">
          <dt>{t(lang, "admin.field_customer")}</dt><dd class="mono">{p.customer_id}</dd>
          <dt>{t(lang, "admin.field_subscription")}</dt><dd class="mono">{p.subscription_id ?? t(lang, "admin.none")}</dd>
          <dt>{t(lang, "admin.field_stored_status")}</dt><dd class="mono">{p.status ?? t(lang, "admin.none")}</dd>
          <dt>{t(lang, "admin.field_stored_end")}</dt><dd class="mono">{day(p.current_period_end) || t(lang, "admin.none")}</dd>
          <dt>{t(lang, "admin.field_updated")}</dt><dd class="mono">{stamp(p.updated_at)}</dd>
          {live && live !== "missing" ? (
            <>
              <dt>{t(lang, "admin.field_live_status")}</dt><dd class="mono">{live.status}</dd>
              <dt>{t(lang, "admin.field_live_end")}</dt><dd class="mono">{day(live.periodEnd) || t(lang, "admin.none")}</dd>
              <dt>{t(lang, "admin.field_cancel_end")}</dt><dd>{t(lang, live.cancelAtPeriodEnd ? "admin.yes" : "admin.no")}</dd>
            </>
          ) : null}
        </dl>
      ) : <p class="muted">{t(lang, "admin.sub_none")}</p>}
      {p && !s.stripeOn ? <p class="muted small">{t(lang, "admin.sub_no_keys")}</p> : null}
      {p?.subscription_id && s.stripeOn && live === null ? <p class="muted small">{t(lang, "admin.sub_unread")}</p> : null}
      {p?.subscription_id && live === "missing" ? <p class="muted small">{t(lang, "admin.sub_missing")}</p> : null}
      {p?.subscription_id && s.stripeOn ? (
        <div class="account-actions">
          <a href={`/admin/users/${id}/cancel`} class="btn">{t(lang, "admin.cancel_link")}</a>
          <a href={`/admin/users/${id}/refund`} class="btn">{t(lang, "admin.refund_link")}</a>
        </div>
      ) : null}
      <p class="muted small">{t(lang, "admin.card_note")}</p>
    </Panel>
  );
}

function userView(lang: Lang, op: Account, d: UserDetail, s: UserState, now: Date) {
  const u = d.user;
  const deleted = u.status !== "active";
  const self = op.userId === u.id;
  const devices = d.sessions.classes.length
    ? d.sessions.classes.map((k) => `${t(lang, DEVICE_KEY[k.ua_class ?? ""] ?? "admin.device_unknown")} ${fmtInt(k.n, lang)}`).join(", ")
    : t(lang, "admin.none");
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      <PageHead lang={lang} eyebrow={t(lang, "admin.user_eyebrow")} title={deleted ? t(lang, "admin.deleted_title") : u.email}
        actions={<a href="/admin" class="btn">{t(lang, "admin.title")}</a>} />
      <Notice message={s.notice} />
      <Errors lang={lang} errors={s.errors} vars={{ n: REFERENCE_MAX }} />
      <Panel title={t(lang, "admin.panel_account")}>
        <dl class="wide">
          <dt>{t(lang, "admin.field_address")}</dt><dd>{u.email}</dd>
          <dt>{t(lang, "admin.field_user")}</dt><dd class="mono">{u.id}</dd>
          <dt>{t(lang, "admin.field_created")}</dt><dd class="mono">{stamp(u.created_at)}</dd>
          <dt>{t(lang, "admin.field_seen")}</dt><dd class="mono">{stamp(u.last_seen_at) || t(lang, "admin.never")}</dd>
          <dt>{t(lang, "admin.field_lang")}</dt><dd>{t(lang, u.lang === "fr" ? "admin.lang_fr" : "admin.lang_en")}</dd>
          <dt>{t(lang, "admin.field_status")}</dt><dd>{statusWord(lang, u.status)}{u.deleted_at ? ` (${day(u.deleted_at)})` : ""}</dd>
          <dt>{t(lang, "admin.field_cached")}</dt><dd>{cachedPlan(lang, u)}</dd>
          <dt>{t(lang, "admin.field_plan")}</dt><dd>{planLabel(lang, { plan: s.plan.plan, planUntil: s.plan.until })}</dd>
          <dt>{t(lang, "admin.field_blocked")}</dt><dd>{blockLine(lang, d.block)}</dd>
        </dl>
      </Panel>
      <Panel title={t(lang, "admin.panel_entitlements")} count={fmtInt(d.entitlements.length, lang)}>
        {d.entitlements.length ? (
          <Table heads={[t(lang, "admin.col_plan"), t(lang, "admin.col_source"), t(lang, "admin.col_starts"), t(lang, "admin.col_ends"),
            t(lang, "admin.col_reference"), t(lang, "admin.col_recorded"), t(lang, "admin.col_state")]}
            rows={d.entitlements.map((e) => [
              e.plan, t(lang, e.source === "stripe" ? "admin.source_stripe" : "admin.source_manual"), <span class="mono">{stamp(e.starts_at)}</span>,
              <span class="mono">{e.ends_at ? stamp(e.ends_at) : t(lang, "admin.none")}</span>, e.reference ?? "",
              <span class="mono">{stamp(e.created_at)}</span>,
              revocable(e, now) ? (
                <form method="post" action={`/admin/users/${u.id}/entitlements/${e.id}/revoke`} class="account-inline">
                  <Csrf op={op} />
                  <span>{entState(lang, e, now)}</span>
                  <button type="submit" class="btn-link">{t(lang, "admin.revoke")}</button>
                </form>
              ) : entState(lang, e, now),
            ])} />
        ) : <p class="muted">{t(lang, "admin.ent_none")}</p>}
        {deleted ? null : (
          <form method="post" action={`/admin/users/${u.id}/grant`} class="stack">
            <Csrf op={op} />
            <label>
              {t(lang, "admin.grant_until")}
              <input name="until" type="date" min={tomorrow} value={s.until ?? ""} />
            </label>
            <label>
              {t(lang, "admin.grant_reference")}
              <input name="reference" type="text" required maxlength={REFERENCE_MAX} autocomplete="off" value={s.reference ?? ""} />
            </label>
            <button type="submit" class="btn btn-primary">{t(lang, "admin.grant_button")}</button>
          </form>
        )}
      </Panel>
      {subscriptionPanel(lang, d, s)}
      <Panel title={t(lang, "admin.panel_sessions")}>
        <dl class="wide">
          <dt>{t(lang, "account.field_sessions")}</dt><dd>{fmtInt(d.sessions.live, lang)}</dd>
          <dt>{t(lang, "admin.field_newest")}</dt><dd class="mono">{stamp(d.sessions.newest) || t(lang, "admin.never")}</dd>
          <dt>{t(lang, "admin.field_devices")}</dt><dd>{devices}</dd>
        </dl>
        {deleted ? null : (
          <form method="post" action={`/admin/users/${u.id}/sign-out`}>
            <Csrf op={op} />
            <button type="submit" class="btn">{t(lang, "admin.sign_out_all")}</button>
          </form>
        )}
      </Panel>
      <Panel title={t(lang, "admin.panel_searches")} count={fmtInt(d.searches.length, lang)}>
        {d.searches.length ? (
          <Table heads={[t(lang, "admin.col_search"), t(lang, "admin.col_kind"), t(lang, "admin.col_delivery"), t(lang, "admin.col_last")]}
            rows={d.searches.map((x) => [
              <a href={x.params}>{x.label}</a>, <span class="mono">{x.kind}</span>, t(lang, DELIVER_KEY[x.deliver] ?? "account.deliver_off"),
              lastDelivery(lang, x),
            ])} />
        ) : <p class="muted">{t(lang, "admin.searches_none")}</p>}
      </Panel>
      <Panel title={t(lang, "admin.panel_keys")} count={fmtInt(d.keys.length, lang)}>
        {d.keys.length ? (
          <Table heads={[t(lang, "admin.col_prefix"), t(lang, "admin.col_created"), t(lang, "admin.col_last_used"), t(lang, "admin.col_revoked")]}
            rows={d.keys.map((k) => [
              <span class="mono">aw_{k.prefix}</span>, <span class="mono">{day(k.created_at)}</span>,
              <span class="mono">{k.last_used_at ? stamp(k.last_used_at) : t(lang, "admin.never")}</span>,
              <span class="mono">{k.revoked_at ? day(k.revoked_at) : t(lang, "admin.no")}</span>,
            ])} />
        ) : <p class="muted">{t(lang, "admin.keys_none")}</p>}
      </Panel>
      <Panel title={t(lang, "admin.panel_deliveries", { n: USER_DELIVERY_ROWS })} count={fmtInt(d.deliveries.length, lang)}>
        {d.deliveries.length ? (
          <Table heads={[t(lang, "admin.col_time"), t(lang, "admin.col_search"), t(lang, "admin.col_state")]}
            rows={d.deliveries.map((x) => [<span class="mono">{stamp(x.sent_at)}</span>, x.label, deliveryWord(lang, x.status, x.items)])} />
        ) : <p class="muted">{t(lang, "admin.deliveries_none")}</p>}
      </Panel>
      {d.bugs === null ? null : (
        <Panel title={t(lang, "admin.panel_bugs")} count={fmtInt(d.bugs.length, lang)}>
          {d.bugs.length ? (
            <Table heads={[t(lang, "admin.col_time"), t(lang, "admin.col_page"), t(lang, "admin.col_report")]}
              rows={d.bugs.map((b) => [<span class="mono">{stamp(b.created_at)}</span>, b.page, b.text])} />
          ) : <p class="muted">{t(lang, "admin.bugs_none")}</p>}
        </Panel>
      )}
      <Panel title={t(lang, "admin.panel_audit_user")} count={fmtInt(d.audit.length, lang)}>
        {d.audit.length ? (
          <Table heads={[t(lang, "admin.col_time"), t(lang, "admin.col_event"), t(lang, "admin.col_detail")]} rows={auditRows(lang, d.audit, false)} />
        ) : <p class="muted">{t(lang, "admin.audit_none")}</p>}
      </Panel>
      <Panel title={t(lang, "admin.panel_actions")}>
        {deleted ? <p>{t(lang, "admin.deleted_note")}</p> : self ? <p>{t(lang, "admin.self_note")}</p> : (
          <div class="account-actions">
            {d.block ? (
              <form method="post" action={`/admin/users/${u.id}/unblock`}>
                <Csrf op={op} />
                <button type="submit" class="btn">{t(lang, "admin.unblock_button")}</button>
              </form>
            ) : <a href={`/admin/users/${u.id}/block`} class="btn">{t(lang, "admin.block_link")}</a>}
            <a href={`/admin/users/${u.id}/email`} class="btn">{t(lang, "admin.email_link")}</a>
            <a href={`/admin/users/${u.id}/delete`} class="btn">{t(lang, "admin.delete_link")}</a>
          </div>
        )}
      </Panel>
    </>
  );
}

async function userPage(c: Context<AppEnv>, id: string, extra: Partial<UserState> & { status?: number } = {}): Promise<Response> {
  const lang = c.get("lang");
  const now = new Date();
  const d = await userDetail(c.env, id, now);
  if (!d) return c.notFound();
  const plan = await planFor(c.env, d.user, now);
  const stripe = operatorStripe(c.env);
  const live = stripe && d.payment?.subscription_id ? await stripe.subscription(d.payment.subscription_id) : undefined;
  const m = c.req.query("m") ?? "";
  const notice = extra.notice !== undefined ? extra.notice
    : NOTICE[m] ? t(lang, NOTICE[m], { n: fmtInt(Number(c.req.query("n") ?? "0") || 0, lang) }) : null;
  const title = d.user.status === "active" ? d.user.email : t(lang, "admin.deleted_title");
  return adminPage(c, title, userView(lang, operatorOf(c), d, { ...extra, plan, stripeOn: !!stripe, live, notice }, now), extra.status ?? 200);
}

admin.get("/users/:id", (c) => {
  const id = c.req.param("id") ?? "";
  if (!ID_RE.test(id)) return c.notFound();
  return guarded(c, () => userPage(c, id));
});

// -- plans ---------------------------------------------------------------------------------------

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// A reference is the operator's note or the payment's reference, never an
// address (accounts_schema.sql); a reason likewise.
const noteOk = (v: string, max: number) => v.length > 0 && v.length <= max && !v.includes("@");

admin.post("/users/:id/grant", async (c) => {
  const post = await operatorPost(c);
  if (post instanceof Response) return post;
  const { op, fields, user } = post;
  return guarded(c, async () => {
    const until = clean(fields, "until", 20);
    const reference = clean(fields, "reference", REFERENCE_MAX + 1);
    const now = new Date();
    const errors: Key[] = [];
    let endsAt: string | null = null;
    if (user.status !== "active") errors.push("admin.err_deleted");
    if (until) {
      endsAt = DATE_RE.test(until) && !Number.isNaN(Date.parse(`${until}T00:00:00.000Z`)) ? `${until}T00:00:00.000Z` : null;
      if (!endsAt || endsAt <= now.toISOString() || new Date(endsAt).toISOString().slice(0, 10) !== until) errors.push("admin.err_date");
    }
    if (!noteOk(reference, REFERENCE_MAX)) errors.push("admin.err_reference");
    if (errors.length) return userPage(c, user.id, { errors, until, reference: reference.slice(0, REFERENCE_MAX), status: 400, notice: null });
    await grantPro(c.env, user.id, op.userId, endsAt, reference, now);
    return c.redirect(userPath(user.id, "granted"), 303);
  });
});

admin.post("/users/:id/entitlements/:eid/revoke", async (c) => {
  const post = await operatorPost(c);
  if (post instanceof Response) return post;
  const { op, user } = post;
  return guarded(c, async () => {
    const eid = c.req.param("eid") ?? "";
    const done = ID_RE.test(eid) && (await revokeEntitlement(c.env, user.id, eid, op.userId));
    return c.redirect(userPath(user.id, done ? "revoked" : "nothing"), 303);
  });
});

admin.post("/users/:id/sign-out", async (c) => {
  const post = await operatorPost(c);
  if (post instanceof Response) return post;
  const { op, user } = post;
  return guarded(c, async () => {
    if (user.status !== "active") return userPage(c, user.id, { errors: ["admin.err_deleted"], status: 400, notice: null });
    const n = await revokeAllSessions(c.env, user.id);
    await operatorAudit(c.env, user.id, "operator_signed_out", op.userId, `${n} sessions`);
    return c.redirect(userPath(user.id, "signed_out"), 303);
  });
});

admin.post("/users/:id/unblock", async (c) => {
  const post = await operatorPost(c);
  if (post instanceof Response) return post;
  const { op, user } = post;
  return guarded(c, async () => {
    const done = await unblockAccount(c.env, user.id, op.userId);
    return c.redirect(done ? `${userPath(user.id, "unblocked")}&n=${done.restored}` : userPath(user.id, "not_blocked"), 303);
  });
});

// -- confirm pages -------------------------------------------------------------------------------

// What an action will do, and, unless refused, its form: the CSRF value, the
// box to tick and the button. A refusal (the operator's own account, a
// deleted one, no subscription) shows its reason and no form.
function confirmView(
  lang: Lang, op: Account, user: UserRow,
  o: { title: Key; lead?: unknown; items: unknown[]; action: string; button: Key; refusal?: Key | null; errors?: Key[]; fields?: unknown; extra?: unknown },
) {
  return (
    <>
      <PageHead lang={lang} eyebrow={user.status === "active" ? user.email : t(lang, "admin.deleted_title")} title={t(lang, o.title)}
        lead={o.lead} actions={<a href={`/admin/users/${user.id}`} class="btn">{t(lang, "admin.back_user")}</a>} />
      <Panel title={t(lang, "admin.panel_what")} class="panel-form">
        <Errors lang={lang} errors={o.refusal ? [o.refusal] : o.errors} vars={{ n: REASON_MAX }} />
        {o.extra as any}
        {o.items.length ? <ul class="account-list">{o.items.map((i) => <li>{i as any}</li>)}</ul> : null}
        {o.refusal ? null : (
          <form method="post" action={o.action} class="stack">
            <Csrf op={op} />
            {o.fields as any}
            <ConfirmBox lang={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, o.button)}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

// The refusal that applies before anything else to block, address and
// deletion: the operator's own account, or one already deleted.
const ownOrDeleted = (op: Account, user: UserRow): Key | null =>
  isSelf(op, user) ? "admin.err_self" : user.status !== "active" ? "admin.err_deleted" : null;

const confirmed = (fields: Record<string, string>) => fields.confirm === "yes";

// -- blocking --------------------------------------------------------------------------------------

function blockView(lang: Lang, op: Account, user: UserRow, extra: { errors?: Key[]; reason?: string; refusal?: Key | null } = {}) {
  return confirmView(lang, op, user, {
    title: "admin.block_title", lead: t(lang, "admin.block_lead"), action: `/admin/users/${user.id}/block`, button: "admin.block_button",
    items: [t(lang, "admin.block_sessions"), t(lang, "admin.block_delivery"), t(lang, "admin.block_keys"), t(lang, "admin.block_plan")],
    refusal: extra.refusal, errors: extra.errors,
    fields: (
      <label>
        {t(lang, "admin.block_reason")}
        <input name="reason" type="text" required maxlength={REASON_MAX} autocomplete="off" value={extra.reason ?? ""} />
      </label>
    ),
  });
}

admin.get("/users/:id/block", (c) =>
  guarded(c, async () => {
    const user = await target(c);
    if (!user) return c.notFound();
    const lang = c.get("lang");
    return adminPage(c, t(lang, "admin.block_title"), blockView(lang, operatorOf(c), user, { refusal: ownOrDeleted(operatorOf(c), user) }));
  }));

admin.post("/users/:id/block", async (c) => {
  const post = await operatorPost(c);
  if (post instanceof Response) return post;
  const { op, fields, user } = post;
  const lang = c.get("lang");
  return guarded(c, async () => {
    const refusal = ownOrDeleted(op, user);
    const reason = clean(fields, "reason", REASON_MAX + 1);
    const errors: Key[] = [];
    if (!refusal && !confirmed(fields)) errors.push("admin.err_confirm");
    if (!refusal && !noteOk(reason, REASON_MAX)) errors.push("admin.err_reason");
    if (refusal || errors.length) {
      return adminPage(c, t(lang, "admin.block_title"), blockView(lang, op, user, { refusal, errors, reason: reason.slice(0, REASON_MAX) }), 400);
    }
    const done = await blockAccount(c.env, user.id, op.userId, reason);
    return c.redirect(userPath(user.id, done === "blocked" ? "blocked" : "already_blocked"), 303);
  });
});

// -- the address -----------------------------------------------------------------------------------

function emailView(lang: Lang, op: Account, user: UserRow, mailOn: boolean, extra: { errors?: Key[]; typed?: string; refusal?: Key | null } = {}) {
  return confirmView(lang, op, user, {
    title: "admin.email_title", lead: tj(lang, "admin.email_lead", { email: <strong>{user.email}</strong> }),
    action: `/admin/users/${user.id}/email`, button: "admin.email_button", refusal: extra.refusal, errors: extra.errors,
    items: [
      t(lang, "admin.email_unique"), t(lang, "admin.email_sessions"), t(lang, mailOn ? "admin.email_notice" : "admin.email_no_mail"),
      t(lang, "admin.email_old"),
    ],
    fields: (
      <label>
        {t(lang, "admin.email_new")}
        <input name="email" type="email" required maxlength={EMAIL_MAX} autocomplete="off" spellcheck={false} value={extra.typed ?? ""} />
      </label>
    ),
  });
}

// Whether a message can go out from here: the log sender locally, the
// binding on the site; the stub (no binding or no sending address) cannot.
const mailOn = (c: Context<AppEnv>) => senderFor(c.env, c.req.url).kind !== "stub";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The notice to the new address: plain, in the account's language, with the
// sign-in page's address and the contact address. It names no other address.
export function addressNotice(lang: Lang, to: string, base: string): MailMessage {
  const link = `${base}/account/sign-in${lang === "fr" ? "?lang=fr" : ""}`;
  const body = t(lang, "admin.mail_body");
  const signIn = t(lang, "admin.mail_sign_in", { link });
  const contact = t(lang, "admin.mail_contact", { contact: CONTACT_EMAIL });
  const html =
    `<!doctype html><html lang="${lang}"><body style="font-family: sans-serif; line-height: 1.5;">` +
    `<p>${escapeHtml(body)}</p>` +
    `<p><a href="${escapeHtml(link)}">${escapeHtml(t(lang, "account.sign_in"))}</a></p>` +
    `<p>${escapeHtml(contact)}</p></body></html>`;
  return { to, subject: t(lang, "admin.mail_subject"), text: `${body}\n\n${signIn}\n\n${contact}\n`, html, lang };
}

admin.get("/users/:id/email", (c) =>
  guarded(c, async () => {
    const user = await target(c);
    if (!user) return c.notFound();
    const lang = c.get("lang");
    const op = operatorOf(c);
    return adminPage(c, t(lang, "admin.email_title"), emailView(lang, op, user, mailOn(c), { refusal: ownOrDeleted(op, user) }));
  }));

admin.post("/users/:id/email", async (c) => {
  const post = await operatorPost(c);
  if (post instanceof Response) return post;
  const { op, fields, user } = post;
  const lang = c.get("lang");
  return guarded(c, async () => {
    const refusal = ownOrDeleted(op, user);
    const typed = clean(fields, "email", EMAIL_MAX + 50);
    const again = (errors: Key[], status = 400) =>
      adminPage(c, t(lang, "admin.email_title"), emailView(lang, op, user, mailOn(c), { refusal, errors, typed: typed.slice(0, EMAIL_MAX) }), status);
    if (refusal) return again([]);
    if (!confirmed(fields)) return again(["admin.err_confirm"]);
    const email = normalizeEmail(typed);
    if (!email) return again(["admin.err_email"]);
    if (email === user.email) return again(["admin.err_email_same"]);
    const changed = await changeAddress(c.env, user.id, user.email, email);
    if (changed === "taken") return again(["admin.err_email_taken"], 409);
    if (changed === "missing") return again(["admin.err_deleted"]);
    let told = false;
    const sender = senderFor(c.env, c.req.url);
    if (sender.kind !== "stub") {
      const userLang: Lang = user.lang === "fr" ? "fr" : "en";
      const sent = await sender.send(addressNotice(userLang, email, siteBase(c))).catch(() => ({ sent: false }) as const);
      told = sent.sent;
    }
    await operatorAudit(c.env, user.id, "operator_email_changed", op.userId, told ? "notice sent" : "notice not sent");
    return c.redirect(userPath(user.id, told ? "email" : "email_unsent"), 303);
  });
});

// -- the subscription: cancel --------------------------------------------------------------------

type SubTarget = { subscriptionId: string; live: LiveSubscription | "missing" | null } | { refusal: Key };

async function subTarget(c: Context<AppEnv>, user: UserRow): Promise<SubTarget> {
  const stripe = operatorStripe(c.env);
  if (!stripe) return { refusal: "admin.err_no_keys" };
  const row = await c.env.ACCOUNTS!.prepare("SELECT subscription_id FROM payment_customers WHERE user_id = ?")
    .bind(user.id).first<{ subscription_id: string | null }>();
  if (!row?.subscription_id) return { refusal: "admin.err_no_subscription" };
  return { subscriptionId: row.subscription_id, live: await stripe.subscription(row.subscription_id) };
}

function cancelView(lang: Lang, op: Account, user: UserRow, s: SubTarget, errors?: Key[]) {
  const refusal = "refusal" in s ? s.refusal
    : s.live === null ? "admin.err_stripe"
    : s.live === "missing" || s.live.status === "canceled" || s.live.status === "incomplete_expired" ? "admin.err_no_subscription" : null;
  const live = "refusal" in s || !s.live || s.live === "missing" ? null : s.live;
  const subscriptionId = "refusal" in s ? null : s.subscriptionId;
  const option = (at: "period_end" | "now", text: Key, button: Key) => (
    <form method="post" action={`/admin/users/${user.id}/cancel`} class="stack">
      <Csrf op={op} />
      <input type="hidden" name="at" value={at} />
      <p>{t(lang, text, { date: day(live?.periodEnd) || t(lang, "admin.none") })}</p>
      <ConfirmBox lang={lang} />
      <button type="submit" class="btn btn-primary">{t(lang, button)}</button>
    </form>
  );
  return (
    <>
      <PageHead lang={lang} eyebrow={user.email} title={t(lang, "admin.cancel_title")} lead={t(lang, "admin.cancel_lead")}
        actions={<a href={`/admin/users/${user.id}`} class="btn">{t(lang, "admin.back_user")}</a>} />
      <Panel title={t(lang, "admin.panel_what")} class="panel-form">
        <Errors lang={lang} errors={refusal ? [refusal] : errors} />
        {subscriptionId ? (
          <dl class="wide">
            <dt>{t(lang, "admin.field_subscription")}</dt><dd class="mono">{subscriptionId}</dd>
            {live ? (
              <>
                <dt>{t(lang, "admin.field_live_status")}</dt><dd class="mono">{live.status}</dd>
                <dt>{t(lang, "admin.field_live_end")}</dt><dd class="mono">{day(live.periodEnd) || t(lang, "admin.none")}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {refusal || !live ? null : (
          <>
            {live.cancelAtPeriodEnd ? <p>{t(lang, "admin.cancel_already_end")}</p> : option("period_end", "admin.cancel_end_text", "admin.cancel_end_button")}
            {option("now", "admin.cancel_now_text", "admin.cancel_now_button")}
          </>
        )}
      </Panel>
    </>
  );
}

admin.get("/users/:id/cancel", (c) =>
  guarded(c, async () => {
    const user = await target(c);
    if (!user) return c.notFound();
    const lang = c.get("lang");
    return adminPage(c, t(lang, "admin.cancel_title"), cancelView(lang, operatorOf(c), user, await subTarget(c, user)));
  }));

admin.post("/users/:id/cancel", async (c) => {
  const post = await operatorPost(c);
  if (post instanceof Response) return post;
  const { op, fields, user } = post;
  const lang = c.get("lang");
  return guarded(c, async () => {
    const at = fields.at;
    if (at !== "period_end" && at !== "now") return c.text(t(lang, "form.rejected"), 400);
    const s = await subTarget(c, user);
    const page400 = (errors: Key[], status = 400) => adminPage(c, t(lang, "admin.cancel_title"), cancelView(lang, op, user, s, errors), status);
    if ("refusal" in s) return page400([]);
    if (!confirmed(fields)) return page400(["admin.err_confirm"]);
    const stripe = operatorStripe(c.env)!;
    if (!(await stripe.cancel(s.subscriptionId, at))) return page400(["admin.err_stripe"], 503);
    if (at === "now") {
      // As endForDeletion does: the billing page stops offering the portal for
      // it at once; the notice that follows ends Pro and records the rest.
      await c.env.ACCOUNTS!.prepare("UPDATE payment_customers SET status = 'canceled', updated_at = ? WHERE user_id = ? AND subscription_id = ?")
        .bind(new Date().toISOString(), user.id, s.subscriptionId).run();
    }
    await operatorAudit(c.env, user.id, "operator_cancelled", op.userId, at === "now" ? "at once" : "at period end");
    return c.redirect(userPath(user.id, at === "now" ? "cancel_now" : "cancel_end"), 303);
  });
});

// -- the subscription: refund ----------------------------------------------------------------------

type RefundTarget = { charge: PaidCharge } | { refusal: Key; charge?: PaidCharge };

async function refundTarget(c: Context<AppEnv>, user: UserRow): Promise<RefundTarget> {
  const stripe = operatorStripe(c.env);
  if (!stripe) return { refusal: "admin.err_no_keys" };
  const row = await c.env.ACCOUNTS!.prepare("SELECT subscription_id FROM payment_customers WHERE user_id = ?")
    .bind(user.id).first<{ subscription_id: string | null }>();
  if (!row?.subscription_id) return { refusal: "admin.err_no_charge" };
  const charge = await stripe.latestPaidCharge(row.subscription_id);
  if (charge === null) return { refusal: "admin.err_stripe" };
  if (charge === "none") return { refusal: "admin.err_no_charge" };
  if (charge.refunded >= charge.amount) return { refusal: "admin.err_refunded", charge };
  return { charge };
}

// An amount in the currency's smallest unit, as "19.00 CAD" ("19,00 CAD").
// Every currency Pro is sold in has two decimals.
const money = (lang: Lang, minor: number, currency: string) => {
  const text = (minor / 100).toFixed(2);
  return `${lang === "fr" ? text.replace(".", ",") : text} ${currency.toUpperCase()}`;
};

function refundView(lang: Lang, op: Account, user: UserRow, r: RefundTarget, errors?: Key[]) {
  const refusal = "refusal" in r ? r.refusal : null;
  const charge = r.charge ?? null;
  return confirmView(lang, op, user, {
    title: "admin.refund_title", lead: t(lang, "admin.refund_lead"), action: `/admin/users/${user.id}/refund`, button: "admin.refund_button",
    refusal, errors, items: charge ? [t(lang, "admin.refund_full"), t(lang, "admin.refund_pro"), t(lang, "admin.refund_subscription")] : [],
    extra: charge ? (
      <dl class="wide">
        <dt>{t(lang, "admin.field_invoice")}</dt><dd class="mono">{charge.invoiceId}</dd>
        <dt>{t(lang, "admin.field_charge")}</dt><dd class="mono">{charge.chargeId}</dd>
        <dt>{t(lang, "admin.field_amount")}</dt><dd class="mono">{money(lang, charge.amount, charge.currency)}</dd>
        <dt>{t(lang, "admin.field_refunded")}</dt><dd class="mono">{money(lang, charge.refunded, charge.currency)}</dd>
        <dt>{t(lang, "admin.field_paid")}</dt><dd class="mono">{day(charge.paidAt) || t(lang, "admin.none")}</dd>
      </dl>
    ) : null,
    fields: charge ? <input type="hidden" name="charge" value={charge.chargeId} /> : null,
  });
}

admin.get("/users/:id/refund", (c) =>
  guarded(c, async () => {
    const user = await target(c);
    if (!user) return c.notFound();
    const lang = c.get("lang");
    return adminPage(c, t(lang, "admin.refund_title"), refundView(lang, operatorOf(c), user, await refundTarget(c, user)));
  }));

admin.post("/users/:id/refund", async (c) => {
  const post = await operatorPost(c);
  if (post instanceof Response) return post;
  const { op, fields, user } = post;
  const lang = c.get("lang");
  return guarded(c, async () => {
    // The charge is found again: the post refunds the charge the page showed
    // only while it is still the latest paid one and not refunded in full.
    const r = await refundTarget(c, user);
    const again = (errors: Key[], status = 400) => adminPage(c, t(lang, "admin.refund_title"), refundView(lang, op, user, r, errors), status);
    if ("refusal" in r) return again([]);
    if (!confirmed(fields)) return again(["admin.err_confirm"]);
    if (fields.charge !== r.charge.chargeId) return again(["admin.err_charge_moved"], 409);
    const refund = await operatorStripe(c.env)!.refund(r.charge.chargeId);
    if (!refund) return again(["admin.err_stripe"], 503);
    await operatorAudit(c.env, user.id, "operator_refunded", op.userId, `refund ${refund.status.slice(0, 20)}`);
    return c.redirect(userPath(user.id, "refunded"), 303);
  });
});

// -- deletion ----------------------------------------------------------------------------------------

function deleteView(lang: Lang, op: Account, user: UserRow, blocked: boolean, extra: { errors?: Key[]; refusal?: Key | null } = {}) {
  return confirmView(lang, op, user, {
    title: "admin.delete_title", lead: t(lang, "admin.delete_lead"), action: `/admin/users/${user.id}/delete`, button: "admin.delete_button",
    refusal: extra.refusal, errors: extra.errors,
    items: [
      t(lang, "admin.delete_subscription"), t(lang, "admin.delete_rows"), t(lang, "admin.delete_email"), t(lang, "admin.delete_kept"),
      ...(blocked ? [t(lang, "admin.delete_blocked")] : []),
    ],
  });
}

admin.get("/users/:id/delete", (c) =>
  guarded(c, async () => {
    const user = await target(c);
    if (!user) return c.notFound();
    const lang = c.get("lang");
    const op = operatorOf(c);
    return adminPage(c, t(lang, "admin.delete_title"), deleteView(lang, op, user, await isBlocked(c.env, { id: user.id }), { refusal: ownOrDeleted(op, user) }));
  }));

// The path a reader's own deletion takes (routes.tsx): the subscription is
// cancelled first or nothing is deleted, then deleteAccount, then every
// session revoked.
admin.post("/users/:id/delete", async (c) => {
  const post = await operatorPost(c);
  if (post instanceof Response) return post;
  const { op, fields, user } = post;
  const lang = c.get("lang");
  return guarded(c, async () => {
    const refusal = ownOrDeleted(op, user);
    const blocked = await isBlocked(c.env, { id: user.id });
    const again = (errors: Key[], status = 400) =>
      adminPage(c, t(lang, "admin.delete_title"), deleteView(lang, op, user, blocked, { refusal, errors }), status);
    if (refusal) return again([]);
    if (!confirmed(fields)) return again(["admin.err_confirm"]);
    if (!(await endForDeletion(c.env, user.id))) return again(["billing.err_delete"], 503);
    const who: Account = {
      userId: user.id, email: user.email, lang: user.lang === "fr" ? "fr" : "en", createdAt: user.created_at, plan: "free", planUntil: null,
      sessionId: "", csrf: "", stale: false,
    };
    await deleteAccount(c, who);
    await revokeAllSessions(c.env, user.id);
    // A blocked reader cannot reach their own deletion, so only this path
    // meets a block: it ends with the account, as the confirm page says.
    if (blocked) await c.env.ACCOUNTS!.prepare("DELETE FROM account_blocks WHERE user_id = ?").bind(user.id).run();
    await operatorAudit(c.env, user.id, "operator_deleted", op.userId);
    return c.redirect(userPath(user.id, "deleted"), 303);
  });
});
