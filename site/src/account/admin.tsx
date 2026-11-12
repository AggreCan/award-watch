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
//   GET  /admin                                        counts, the last audit events, the search box (?q=),
//                                                      the newest corrections and merge reports (forms database)
//   GET  /admin/accounts                               every account, filtered, sorted, 50 to a page
//   GET  /admin/accounts.csv                           the same view as CSV, at most 10,000 rows
//   GET  /admin/users/:id                              one account: rows, plan, subscription, activity, actions
//   POST /admin/users/:id/grant                        Pro or Ultra by hand (end date optional, reference required)
//   POST /admin/users/:id/entitlements/:eid/revoke     revoke one row
//   POST /admin/users/:id/sign-out                     revoke every session
//   POST /admin/users/:id/unblock                      lift a block
//   GET  /admin/users/:id/block | email | cancel | refund | delete   what the action will do (confirm page)
//   POST /admin/users/:id/block | email | cancel | refund | delete   do it (confirm=yes from that page)
//   GET  /admin/announce                               the accounts-open message: counts, preview, confirm form
//   POST /admin/announce                               send the next run of it (confirm=yes; announce.tsx)
//   GET  /admin/announce?kind=ultra                    the same for the Ultra message (the Ultra card's addresses)
//   POST /admin/announce with kind=ultra               send the next run of that one
//   GET  /admin/mail-check                             the live mail check: what it sends, the form
//   POST /admin/mail-check                             one message of each template to MAIL_TEST_TO (mail_check.ts), JSON
//
// One address has a second way in: a POST to /admin/mail-check that carries
// an Authorization header is judged by the mail-check workflow's token alone
// (mail_check.ts mailCheckTokenAdmits: conditions 1 and 2, the token, and,
// while ACCESS_AUD is set, a token Access signed, a service token's
// included), never by a session, and needs no CSRF value since no cookie
// admits it. No other address reads that header.
//
// Every POST needs an Origin header naming the site (a browser always sends
// one with a form post, so a post without one is refused here, unlike the
// account pages) and the session's CSRF value. Every answer past the guards
// is no-store and noindex. Every action writes an audit row naming the
// operator by user id (admin_ops.ts). The pages show no card data: Stripe
// keeps it, and nothing here asks for it (admin_stripe.ts).

import { WATCH_KIND_KEY } from "./digests";
import { eventCounts, isWatchKind, watchPath } from "./watch_events";
import { type WatchOverview, watchOverview } from "./watches";
import { Hono, type Context } from "hono";
import type { FC } from "hono/jsx";
import { isOwnAddress } from "../api";
import { readForm } from "../body";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, t, tj, tn, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, page } from "../layout";
import { type CorrectionListRow, latestCorrections } from "../pages/forms";
import { EMAIL_MAX, normalizeEmail } from "../pages/interest";
import { accessEmail, accessRequired } from "./admin_access";
import {
  ANNOUNCE_MAX, type AnnounceCounts, type AnnounceKind, accountsOpenMessage, announceCounts, announceKindOf, announceLinks, missingColumn,
  runAnnouncement, ultraLinks, ultraMessageAllowed, ultraOpenMessage,
} from "./announce";
import {
  type AccountFilter, type AccountListRow, type AccountQuery, type AccountSort, type AccountsPage, type BlockRow, type Overview,
  type UserDetail, type UserHit, type UserRow, ACCOUNT_CSV_ROWS, ACCOUNT_FILTERS, ACCOUNT_FILTER_NAMES, ACCOUNT_MAX_PAGE,
  ACCOUNT_PAGE_SIZE, DEFAULT_SORT, ID_RE, USER_DELIVERY_ROWS, WEEK_DAYS, accountsForCsv, accountsPage, blockAccount, changeAddress,
  findUsers, firstDir, grantPlan, isBlocked, operatorAudit, operatorEmails, overview, readAccountQuery, revocable, revokeEntitlement,
  unblockAccount, userDetail,
} from "./admin_ops";
import { type LiveSubscription, type PaidCharge, operatorStripe } from "./admin_stripe";
import { endForDeletion } from "./billing";
import { BriefingsOverviewPanel, BriefingsUserPanels } from "./briefing_pages";
import { type BriefingOverview, briefingOverview, userBriefings } from "./briefings";
import { type PlanState, isPlan, planFor } from "./entitlements";
import { type FeedCounts, type FeedView, feedCounts, userFeeds } from "./feeds";
import { CLAIM_TOP_N, type Claim, type ClaimOverview, claimDetail, claimOverview } from "./org_claim";
import { planLabel } from "./pages";
import { deleteAccount } from "./routes";
import {
  MAIL_CHECK_TEMPLATES, type MailCheckOutcome, type MailCheckTemplate, mailCheckTo, mailCheckTokenAdmits, runMailCheck,
} from "./mail_check";
import { addressNotice, isLocalHost, senderFor } from "./sender";
import { type Account, csrfValid, readSession, revokeAllSessions } from "./session";
import { accountsEnabled } from "./switch";

export const admin = new Hono<AppEnv>();

export const REFERENCE_MAX = 120;
export const REASON_MAX = 200;

// The operator a request was admitted for, set by the guard below.
const operators = new WeakMap<Request, Account>();
// The requests the mail-check workflow's token admitted: POST
// /admin/mail-check alone, with no session and so no operator.
const byToken = new WeakSet<Request>();
const MAIL_CHECK_PATH = "/admin/mail-check";

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
  if (c.req.method === "POST" && c.req.path === MAIL_CHECK_PATH && c.req.header("authorization") !== undefined) {
    if (!(await mailCheckTokenAdmits(c.env, c.req.raw.headers))) return c.notFound();
    byToken.add(c.req.raw);
  } else {
    const op = await admitted(c);
    if (!op) return c.notFound();
    operators.set(c.req.raw, op);
  }
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

// A POST: its Origin, its body and the session's CSRF value. A refusal is a
// 403 with one line.
async function operatorForm(c: Context<AppEnv>): Promise<{ op: Account; fields: Record<string, string> } | Response> {
  const lang = c.get("lang");
  const origin = c.req.header("origin");
  if (!origin || !isOwnAddress(origin, c.req.url)) return c.text(t(lang, "form.rejected"), 403);
  const form = await readForm(c);
  if (!form.ok) return c.text(t(lang, "form.rejected"), form.status);
  const asked = form.fields.lang;
  if (asked === "en" || asked === "fr") c.set("lang", asked);
  const op = operatorOf(c);
  if (!csrfValid(op, form.fields.csrf)) return c.text(t(c.get("lang"), "form.rejected"), 403);
  return { op, fields: form.fields };
}

// operatorForm, then the account the post is about; an unknown account is the 404.
async function operatorPost(c: Context<AppEnv>): Promise<Post | Response> {
  const form = await operatorForm(c);
  if (form instanceof Response) return form;
  const { op } = form;
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

// th, when given, writes each heading cell (the accounts table's sort links);
// heads stay the labels a restacked row shows beside its cells.
const Table: FC<{ heads: string[]; rows: unknown[][]; th?: (label: string, i: number) => unknown }> = ({ heads, rows, th }) => (
  <div class="table-wrap">
    <table class="restack">
      <thead><tr>{heads.map((h, i) => (th ? th(h, i) : <th>{h}</th>))}</tr></thead>
      <tbody>
        {rows.map((r) => <tr>{r.map((cell, i) => <td data-label={heads[i]}>{cell as any}</td>)}</tr>)}
      </tbody>
    </table>
  </div>
);

const statusWord = (lang: Lang, status: string) => t(lang, status === "deleted" ? "admin.status_deleted" : "admin.status_active");
// A plan as a row states it: the users cache (free or pro, an Ultra account
// cached as pro), or the accounts table's plan read through the tier.
const cachedPlan = (lang: Lang, u: { plan: string; plan_until: string | null }) =>
  planLabel(lang, { plan: isPlan(u.plan) ? u.plan : "free", planUntil: u.plan_until });

function auditRows(lang: Lang, rows: Overview["audit"], withUser: boolean): unknown[][] {
  return rows.map((a) => [
    <span class="mono">{stamp(a.at)}</span>, <span class="mono">{a.event}</span>,
    ...(withUser ? [<UserLink id={a.user_id} />] : []),
    a.detail ?? "",
  ]);
}

// -- the overview ----------------------------------------------------------------------------

// The watches' part of the overview (watches.ts watchOverview, watch_events.ts eventCounts).
type WatchesSeen = { ov: WatchOverview | null; events: Awaited<ReturnType<typeof eventCounts>> };

const WatchesPanel = ({ lang, w }: { lang: Lang; w: WatchesSeen }) => {
  if (!w.ov) return null;
  const runs = (status: string) => fmtInt(w.ov!.week.find((r) => r.status === status)?.n ?? 0, lang);
  return (
    <Panel title={t(lang, "watches.admin_panel")}>
      <dl class="wide">
        {w.ov.byKind.map((k) => <><dt>{isWatchKind(k.kind) ? t(lang, WATCH_KIND_KEY[k.kind]) : k.kind}</dt><dd>{fmtInt(k.n, lang)}</dd></>)}
        <dt>{t(lang, "watches.admin_mail_on")}</dt><dd>{fmtInt(w.ov.mailOn, lang)}</dd>
        <dt>{t(lang, "watches.admin_runs", { n: 7 })}</dt>
        <dd>{t(lang, "watches.admin_runs_value", { sent: runs("sent"), empty: runs("empty"), failed: runs("failed") })}</dd>
        <dt>{w.events?.asOf ? t(lang, "watches.admin_events", { date: w.events.asOf }) : t(lang, "watches.admin_events", { date: "" })}</dt>
        <dd>
          {w.events === null || !w.events.asOf ? t(lang, "watches.admin_events_none")
            : w.events.byKind.map((k) => <span class="mono nw-block">{`${k.kind} ${fmtInt(k.n, lang)}${k.capped ? ` (${fmtInt(k.capped, lang)})` : ""}`}</span>)}
        </dd>
      </dl>
    </Panel>
  );
};

// The claims of "Your organization" (org_claim.ts claimOverview): how many,
// how many this week, and the most-claimed organization ids. A spike on one
// id is the thing to look at; the claim grants no data the profile does not show.
const ClaimsPanel = ({ lang, c }: { lang: Lang; c: ClaimOverview | null }) => (c ? (
  <Panel title={t(lang, "orgclaim.admin_panel")}>
    <dl class="wide">
      <dt>{t(lang, "orgclaim.admin_all")}</dt><dd>{fmtInt(c.n, lang)}</dd>
      <dt>{t(lang, "orgclaim.admin_week", { n: WEEK_DAYS })}</dt><dd>{fmtInt(c.week, lang)}</dd>
      <dt>{t(lang, "orgclaim.admin_top", { n: CLAIM_TOP_N })}</dt>
      <dd>
        {c.top.length ? c.top.map((x) => <span class="mono nw-block"><a href={`/organizations/${x.id}`}>{x.id}</a> {fmtInt(x.n, lang)}</span>)
          : t(lang, "admin.none")}
      </dd>
    </dl>
  </Panel>
) : null);

// One account's claim on its console page.
const ClaimPanel = ({ lang, claim }: { lang: Lang; claim: Claim | false | null | undefined }) => (claim == null ? null : (
  <Panel title={t(lang, "orgclaim.admin_panel")}>
    {claim ? (
      <dl class="wide">
        <dt>{t(lang, "col.organization")}</dt><dd><a href={`/organizations/${claim.organizationId}`} class="mono">{claim.organizationId}</a></dd>
        <dt>{t(lang, "orgclaim.admin_competitors")}</dt>
        <dd>{claim.competitors.length ? claim.competitors.map((x) => <span class="mono nw-block"><a href={`/organizations/${x}`}>{x}</a></span>) : t(lang, "admin.none")}</dd>
        <dt>{t(lang, "col.segment")}</dt><dd class="mono">{claim.segment ?? t(lang, "orgclaim.admin_largest")}</dd>
        <dt>{t(lang, "orgclaim.field_since")}</dt><dd class="mono">{day(claim.createdAt)}</dd>
      </dl>
    ) : <p class="muted">{t(lang, "orgclaim.admin_none")}</p>}
  </Panel>
));

// The newest rows of the forms database's corrections table, both kinds
// (pages/forms.tsx latestCorrections): a correction's page and text, a merge
// report's name and note, each with the profile it names linked, so the
// operator reads the profile before deciding. Publishing a row, or keeping
// two names apart in the seed, is done by hand; the Row column is the id an
// UPDATE names.
export const OVERVIEW_CORRECTION_ROWS = 20;

const CorrectionsPanel = ({ lang, rows }: { lang: Lang; rows: CorrectionListRow[] | null }) => (rows === null ? null : (
  <Panel title={t(lang, "admin.panel_corrections")} count={fmtInt(rows.length, lang)}>
    {rows.length ? (
      <Table heads={[t(lang, "admin.col_time"), t(lang, "admin.col_kind"), t(lang, "admin.col_profile"), t(lang, "admin.col_page"),
        t(lang, "admin.col_report"), t(lang, "admin.col_published"), t(lang, "admin.col_row")]}
        rows={rows.map((r) => [
          <span class="mono">{stamp(r.submitted_at)}</span>,
          t(lang, r.kind === "merge" ? "admin.kind_merge" : "admin.kind_correction"),
          r.organization_id ? <a href={`/organizations/${r.organization_id}`} class="mono">{r.organization_id}</a> : <span class="muted">-</span>,
          r.page ?? "",
          r.kind === "merge"
            ? <>{t(lang, "admin.merge_name", { name: r.name ?? "" })}{r.text ? <><br /><span class="muted">{r.text}</span></> : null}</>
            : r.text,
          t(lang, r.published ? "admin.yes" : "admin.no"),
          <span class="mono">{String(r.id)}</span>,
        ])} />
    ) : <p class="muted">{t(lang, "admin.corrections_none")}</p>}
  </Panel>
));

// "search 3, all 1": the live calendar feeds by kind, as stored.
const feedKinds = (lang: Lang, f: FeedCounts) =>
  f.byKind.length ? f.byKind.map((k) => `${k.kind} ${fmtInt(k.n, lang)}`).join(", ") : t(lang, "admin.none");

function overviewView(
  lang: Lang, o: Overview, search: { q: string; hits: UserHit[] | null }, w: WatchesSeen = { ov: null, events: null }, feeds: FeedCounts | null = null,
  claims: ClaimOverview | null = null,
  briefings: BriefingOverview | null = null,
  corrections: CorrectionListRow[] | null = null,
) {
  const subs = o.subscriptions.length
    ? o.subscriptions.map((s) => `${s.status} ${fmtInt(s.n, lang)}`).join(", ")
    : t(lang, "admin.none");
  return (
    <>
      <PageHead lang={lang} title={t(lang, "admin.title")} lead={t(lang, "admin.lead")}
        actions={<>
          <a href="/admin/accounts" class="btn">{t(lang, "admin.accounts_link")}</a>
          <a href="/admin/announce" class="btn">{t(lang, "admin.announce_link")}</a>
          <a href="/admin/announce?kind=ultra" class="btn">{t(lang, "admin.announce_ultra_link")}</a>
          <a href={MAIL_CHECK_PATH} class="btn">{t(lang, "admin.mail_check_link")}</a>
        </>} />
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
          {o.ultraManual === null || o.ultraStripe === null ? null : (
            <>
              <dt>{t(lang, "admin.count_ultra_manual")}</dt><dd>{fmtInt(o.ultraManual, lang)}</dd>
              <dt>{t(lang, "admin.count_ultra_stripe")}</dt><dd>{fmtInt(o.ultraStripe, lang)}</dd>
            </>
          )}
          <dt>{t(lang, "admin.count_subscriptions")}</dt><dd>{subs}</dd>
          <dt>{t(lang, "admin.count_sent", { n: WEEK_DAYS })}</dt><dd>{fmtInt(o.sent, lang)}</dd>
          <dt>{t(lang, "admin.count_failed", { n: WEEK_DAYS })}</dt><dd>{fmtInt(o.failed, lang)}</dd>
          {o.bugs === null ? null : (
            <>
              <dt>{t(lang, "admin.count_bugs_week", { n: WEEK_DAYS })}</dt><dd>{fmtInt(o.bugs.week, lang)}</dd>
              <dt>{t(lang, "admin.count_bugs_all")}</dt><dd>{fmtInt(o.bugs.all, lang)}</dd>
            </>
          )}
          {feeds === null ? null : (
            <>
              <dt>{t(lang, "admin.count_feeds")}</dt><dd class="mono">{feedKinds(lang, feeds)}</dd>
              <dt>{t(lang, "admin.count_feeds_read", { n: WEEK_DAYS })}</dt><dd>{fmtInt(feeds.readWeek, lang)}</dd>
            </>
          )}
          <dt>{t(lang, "admin.count_codes")}</dt><dd>{fmtInt(o.codesToday, lang)}</dd>
        </dl>
      </Panel>
      <WatchesPanel lang={lang} w={w} />
      <ClaimsPanel lang={lang} c={claims} />
      <BriefingsOverviewPanel lang={lang} ov={briefings} />
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
      <CorrectionsPanel lang={lang} rows={corrections} />
    </>
  );
}

admin.get("/", async (c) => {
  const lang = c.get("lang");
  return guarded(c, async () => {
    const q = (c.req.query("q") ?? "").trim().slice(0, EMAIL_MAX);
    const [o, hits, ov, events, feeds, claims, briefings, corrections] = await Promise.all([
      overview(c.env), q ? findUsers(c.env, q) : Promise.resolve(null), watchOverview(c.env), eventCounts(c.env), feedCounts(c.env),
      claimOverview(c.env), briefingOverview(c.env), latestCorrections(c.env, OVERVIEW_CORRECTION_ROWS),
    ]);
    return adminPage(c, t(lang, "admin.title"), overviewView(lang, o, { q, hits }, { ov, events }, feeds, claims, briefings, corrections));
  });
});

// -- every account -----------------------------------------------------------------------------

// The table's columns in order: the sort key each heading sets, and its label.
const ACCOUNT_COLUMNS: [AccountSort, Key][] = [
  ["address", "admin.col_address"], ["plan", "admin.col_plan"], ["status", "admin.col_status"], ["blocked", "admin.field_blocked"],
  ["created", "admin.col_signed_up"], ["sign_in", "admin.col_sign_in"], ["searches", "admin.col_searches"],
  ["delivery", "admin.col_delivery_on"], ["keys", "admin.col_keys"], ["subscription", "admin.col_subscription"],
  ["language", "admin.field_lang"],
];

const FILTER_LABEL: Record<AccountFilter, Key> = {
  plan: "admin.col_plan", status: "admin.col_status", blocked: "admin.field_blocked", delivery: "admin.col_delivery",
  subscription: "admin.col_subscription", language: "admin.field_lang",
};

// A value without a word here is a Stripe status, shown as Stripe writes it.
const OPTION_LABEL: { [K in AccountFilter]?: Partial<Record<string, Key>> } = {
  plan: { free: "admin.plan_free_now", pro: "admin.plan_pro_now", ultra: "admin.plan_ultra_now" },
  status: { active: "admin.status_active", deleted: "admin.status_deleted" },
  blocked: { yes: "admin.yes", no: "admin.no" },
  delivery: { on: "admin.delivery_some", off: "admin.delivery_none" },
  subscription: { none: "admin.sub_filter_none" },
  language: { en: "admin.lang_en", fr: "admin.lang_fr" },
};

const optionLabel = (lang: Lang, name: AccountFilter, value: string) => {
  const key = OPTION_LABEL[name]?.[value];
  return key ? t(lang, key) : value;
};

// A view's query string without its defaults (no filter, the default order,
// page 1), so the plain view is /admin/accounts.
function accountsQuery(a: AccountQuery, page = a.page): string {
  const p = new URLSearchParams();
  if (a.q) p.set("q", a.q);
  for (const name of ACCOUNT_FILTER_NAMES) {
    const v = a.filters[name];
    if (v) p.set(name, v);
  }
  if (a.sort !== DEFAULT_SORT) p.set("sort", a.sort);
  if (a.dir !== firstDir(a.sort)) p.set("dir", a.dir);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

// A heading's link: the same filters from the first page, its column's order
// reversed when it is the current one.
const sortHref = (a: AccountQuery, sort: AccountSort) =>
  `/admin/accounts${accountsQuery({ ...a, sort, dir: a.sort === sort ? (a.dir === "asc" ? "desc" : "asc") : firstDir(sort) }, 1)}`;

const FilterSelect: FC<{ lang: Lang; name: AccountFilter; value: string | null }> = ({ lang, name, value }) => (
  <label class="field">
    <span class="field-label">{t(lang, FILTER_LABEL[name])}</span>
    <select name={name}>
      <option value="">{t(lang, "admin.any")}</option>
      {(ACCOUNT_FILTERS[name] as readonly string[]).map((v) => <option value={v} selected={v === value}>{optionLabel(lang, name, v)}</option>)}
    </select>
  </label>
);

function accountCells(lang: Lang, r: AccountListRow): unknown[] {
  const count = (v: number) => <span class="mono">{fmtInt(v, lang)}</span>;
  const dash = () => <span class="muted">-</span>;
  return [
    <a href={`/admin/users/${r.id}`}>{r.email}</a>, cachedPlan(lang, r), statusWord(lang, r.status),
    r.blocked_at ? t(lang, "admin.blocked_on", { date: day(r.blocked_at) }) : t(lang, "admin.no"),
    <span class="mono">{day(r.created_at)}</span>, r.last_sign_in ? <span class="mono">{day(r.last_sign_in)}</span> : dash(),
    count(r.searches), count(r.delivering), count(r.live_keys), r.sub_status ? <span class="mono">{r.sub_status}</span> : dash(),
    t(lang, r.lang === "fr" ? "admin.lang_fr" : "admin.lang_en"),
  ];
}

function accountsView(lang: Lang, a: AccountQuery, p: AccountsPage) {
  const n = (v: number) => fmtInt(v, lang);
  const from = (p.page - 1) * ACCOUNT_PAGE_SIZE + 1;
  const to = (p.page - 1) * ACCOUNT_PAGE_SIZE + p.rows.length;
  const capped = p.total > ACCOUNT_MAX_PAGE * ACCOUNT_PAGE_SIZE;
  const prev = p.page > 1 ? `/admin/accounts${accountsQuery(a, p.page - 1)}` : null;
  const next = p.page < p.pages ? `/admin/accounts${accountsQuery(a, p.page + 1)}` : null;
  const pager = p.pages > 1 || capped ? (
    <nav aria-label={t(lang, "common.pagination")} class="pagination">
      <span class="muted">
        {t(lang, "tenders.page_of", { page: n(p.page), pages: n(p.pages) })}
        {capped ? <> · {t(lang, "admin.accounts_cap", { n: n(ACCOUNT_MAX_PAGE * ACCOUNT_PAGE_SIZE) })}</> : null}
      </span>
      <span class="pages">
        {prev ? <a href={prev} class="btn" rel="prev">{t(lang, "tenders.prev")}</a> : null}
        {next ? <a href={next} class="btn" rel="next">{t(lang, "tenders.next")}</a> : null}
      </span>
    </nav>
  ) : undefined;
  return (
    <>
      <PageHead lang={lang} title={t(lang, "admin.accounts_title")} lead={t(lang, "admin.accounts_lead", { n: n(ACCOUNT_CSV_ROWS) })}
        actions={<>
          <a href="/admin" class="btn">{t(lang, "admin.title")}</a>
          <a href={`/admin/accounts.csv${accountsQuery(a, 1)}`} class="btn">{t(lang, "admin.accounts_csv")}</a>
        </>} />
      <form method="get" action="/admin/accounts" class="toolbar" aria-label={t(lang, "admin.accounts_filters")}>
        <div class="toolbar-fields">
          <label class="field field-text">
            <span class="field-label">{t(lang, "admin.filter_address")}</span>
            <input type="search" name="q" value={a.q} maxlength={EMAIL_MAX} autocomplete="off" spellcheck={false} />
          </label>
          {ACCOUNT_FILTER_NAMES.map((name) => <FilterSelect lang={lang} name={name} value={a.filters[name]} />)}
          {/* The order stays when the filters change; the page goes back to the first. */}
          {a.sort !== DEFAULT_SORT ? <input type="hidden" name="sort" value={a.sort} /> : null}
          {a.dir !== firstDir(a.sort) ? <input type="hidden" name="dir" value={a.dir} /> : null}
          <div class="toolbar-actions">
            <button type="submit" class="btn btn-primary">{t(lang, "tenders.apply")}</button>
            <a href="/admin/accounts" class="btn">{t(lang, "tenders.reset")}</a>
          </div>
        </div>
      </form>
      <Panel title={t(lang, "admin.accounts_title")} foot={pager}
        count={p.total ? tn(lang, "admin.accounts_count_one", "admin.accounts_count_many", p.total, { n: n(p.total), from: n(from), to: n(to) }) : n(0)}>
        {p.rows.length ? (
          <Table heads={ACCOUNT_COLUMNS.map(([, key]) => t(lang, key))} rows={p.rows.map((r) => accountCells(lang, r))}
            th={(label, i) => {
              const key = ACCOUNT_COLUMNS[i][0];
              const on = a.sort === key;
              return (
                <th aria-sort={on ? (a.dir === "asc" ? "ascending" : "descending") : undefined}>
                  <a href={sortHref(a, key)}>{label}{on ? <span aria-hidden="true">{a.dir === "asc" ? " ↑" : " ↓"}</span> : null}</a>
                </th>
              );
            }} />
        ) : <p class="muted">{t(lang, "admin.find_none")}</p>}
      </Panel>
    </>
  );
}

const readAccounts = (c: Context<AppEnv>) => readAccountQuery((name) => c.req.query(name));

admin.get("/accounts", (c) => {
  const lang = c.get("lang");
  return guarded(c, async () => {
    const a = readAccounts(c);
    const p = await accountsPage(c.env, a);
    const title = t(lang, "admin.accounts_title");
    return adminPage(c, p.page > 1 ? `${title}, ${t(lang, "common.page_n", { n: fmtInt(p.page, lang) })}` : title, accountsView(lang, a, p));
  });
});

export const ACCOUNT_CSV_HEAD = [
  "user_id", "address", "plan", "plan_until", "status", "blocked", "blocked_at", "signed_up", "last_sign_in", "saved_searches",
  "delivery_on", "api_keys", "subscription", "language",
];

// Quoted as RFC 4180 has it. A cell a spreadsheet would read as a formula
// gets a leading apostrophe: an address may start with =, + or -.
const csvCell = (v: string | number | null): string => {
  const s = v === null ? "" : /^[=+\-@\t\r]/.test(String(v)) ? `'${v}` : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The view's rows from the first, whatever page it showed. The user id
// stands in for the link each address carries on the page.
admin.get("/accounts.csv", (c) =>
  guarded(c, async () => {
    const rows = await accountsForCsv(c.env, readAccounts(c));
    const lines = rows.map((r) => [
      r.id, r.email, r.plan, r.plan_until, r.status, r.blocked_at ? "yes" : "no", r.blocked_at, r.created_at, r.last_sign_in,
      r.searches, r.delivering, r.live_keys, r.sub_status, r.lang,
    ].map(csvCell).join(","));
    return c.body([ACCOUNT_CSV_HEAD.join(","), ...lines, ""].join("\r\n"), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="accounts-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    });
  }));

// -- one account -------------------------------------------------------------------------------

const NOTICE: Record<string, Key> = {
  granted: "admin.msg_granted", granted_ultra: "admin.msg_granted_ultra", revoked: "admin.msg_revoked", nothing: "admin.msg_nothing", cancel_end: "admin.msg_cancel_end",
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
  notice?: string | null; errors?: Key[]; until?: string; reference?: string; grantPlan?: "pro" | "ultra";
  // The account's calendar feeds (feeds.ts), never their secrets; null without the table.
  feeds?: FeedView[] | null;
  // The organization the account claims (org_claim.ts); false for none, null without the table.
  claim?: Claim | false | null;
  // The account's weekly briefings and their runs (briefings.ts), never the stop secret; null without the tables.
  briefings?: Awaited<ReturnType<typeof userBriefings>>;
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
          {d.watches ? (
            <>
              <dt>{t(lang, "watches.admin_field")}</dt>
              <dd>{t(lang, "watches.admin_value", {
                n: fmtInt(d.watches.n, lang), mail: t(lang, d.watches.mail === "off" ? "watches.mail_off" : "watches.mail_on"),
              })}</dd>
            </>
          ) : null}
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
            {/* Ultra by hand works whether or not Ultra is on sale, once entitlement_tiers is on the database. */}
            <label>
              {t(lang, "admin.grant_plan")}
              <select name="plan">
                <option value="pro" selected={s.grantPlan !== "ultra"}>{t(lang, "pro.tag")}</option>
                <option value="ultra" selected={s.grantPlan === "ultra"}>{t(lang, "ultra.tag")}</option>
              </select>
            </label>
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
      {d.watchDetail ? (
        <>
          <Panel title={t(lang, "watches.admin_panel")} count={fmtInt(d.watchDetail.watches.length, lang)}>
            {d.watchDetail.watches.length ? (
              <Table heads={[t(lang, "admin.col_kind"), t(lang, "watches.admin_col_subject"), t(lang, "watches.admin_col_segment"),
                t(lang, "watches.admin_col_cadence"), t(lang, "watches.admin_col_since"), t(lang, "watches.admin_col_covered")]}
                rows={d.watchDetail.watches.map((x) => [
                  t(lang, WATCH_KIND_KEY[x.kind]), <a href={watchPath(x.kind, x.target)} class="mono">{x.target}</a>,
                  <span class="mono">{x.segment}</span>, t(lang, x.cadence === "weekly" ? "watches.cadence_weekly" : "watches.cadence_daily"),
                  <span class="mono">{day(x.created_at)}</span>, <span class="mono">{x.last_sent_day ?? ""}</span>,
                ])} />
            ) : <p class="muted">{t(lang, "watches.admin_none")}</p>}
            <p class="muted small">{t(lang, "watches.mail_label")}: {t(lang, d.watchDetail.mail?.mail === "off" ? "watches.mail_off" : "watches.mail_on")}</p>
          </Panel>
          <Panel title={t(lang, "watches.admin_runs_title")} count={fmtInt(d.watchDetail.runs.length, lang)}>
            {d.watchDetail.runs.length ? (
              <Table heads={[t(lang, "admin.col_time"), t(lang, "watches.admin_col_covered"), t(lang, "admin.col_state")]}
                rows={d.watchDetail.runs.map((r) => [<span class="mono">{stamp(r.sent_at)}</span>, <span class="mono">{r.day}</span>,
                  deliveryWord(lang, r.status, r.items)])} />
            ) : <p class="muted">{t(lang, "admin.deliveries_none")}</p>}
          </Panel>
        </>
      ) : null}
      <ClaimPanel lang={lang} claim={s.claim} />
      <Panel title={t(lang, "admin.panel_searches")} count={fmtInt(d.searches.length, lang)}>
        {d.searches.length ? (
          <Table heads={[t(lang, "admin.col_search"), t(lang, "admin.col_kind"), t(lang, "admin.col_delivery"), t(lang, "admin.col_last")]}
            rows={d.searches.map((x) => [
              <a href={x.params}>{x.label}</a>, <span class="mono">{x.kind}</span>, t(lang, DELIVER_KEY[x.deliver] ?? "account.deliver_off"),
              lastDelivery(lang, x),
            ])} />
        ) : <p class="muted">{t(lang, "admin.searches_none")}</p>}
      </Panel>
      <BriefingsUserPanels lang={lang} detail={s.briefings ?? null} />
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
      {s.feeds == null ? null : (
        <Panel title={t(lang, "admin.panel_feeds")} count={fmtInt(s.feeds.length, lang)}>
          {s.feeds.length ? (
            <Table heads={[t(lang, "admin.col_kind"), t(lang, "admin.col_created"), t(lang, "admin.col_revoked"), t(lang, "admin.col_last_read")]}
              rows={s.feeds.map((f) => [
                <span class="mono">{f.kind}</span>, <span class="mono">{day(f.created_at)}</span>,
                <span class="mono">{f.revoked_at ? day(f.revoked_at) : t(lang, "admin.no")}</span>,
                <span class="mono">{f.last_read_day ?? t(lang, "admin.never")}</span>,
              ])} />
          ) : <p class="muted">{t(lang, "admin.feeds_none")}</p>}
        </Panel>
      )}
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
  const feeds = await userFeeds(c.env, id);
  const claim = await claimDetail(c.env, id);
  const briefings = await userBriefings(c.env, id);
  const plan = await planFor(c.env, d.user, now);
  const stripe = operatorStripe(c.env);
  const live = stripe && d.payment?.subscription_id ? await stripe.subscription(d.payment.subscription_id) : undefined;
  const m = c.req.query("m") ?? "";
  const notice = extra.notice !== undefined ? extra.notice
    : NOTICE[m] ? t(lang, NOTICE[m], { n: fmtInt(Number(c.req.query("n") ?? "0") || 0, lang) }) : null;
  const title = d.user.status === "active" ? d.user.email : t(lang, "admin.deleted_title");
  return adminPage(c, title, userView(lang, operatorOf(c), d, { ...extra, plan, stripeOn: !!stripe, live, notice, feeds, claim, briefings }, now), extra.status ?? 200);
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
    // The plan granted: Pro unless the form names Ultra (a form from before the plan select names none).
    const raw = clean(fields, "plan", 10);
    const plan = raw === "ultra" ? "ultra" : raw === "" || raw === "pro" ? "pro" : null;
    const now = new Date();
    const errors: Key[] = [];
    let endsAt: string | null = null;
    if (user.status !== "active") errors.push("admin.err_deleted");
    if (!plan) errors.push("form.rejected");
    if (until) {
      endsAt = DATE_RE.test(until) && !Number.isNaN(Date.parse(`${until}T00:00:00.000Z`)) ? `${until}T00:00:00.000Z` : null;
      if (!endsAt || endsAt <= now.toISOString() || new Date(endsAt).toISOString().slice(0, 10) !== until) errors.push("admin.err_date");
    }
    if (!noteOk(reference, REFERENCE_MAX)) errors.push("admin.err_reference");
    const again = (e: Key[]) => userPage(c, user.id, {
      errors: e, until, reference: reference.slice(0, REFERENCE_MAX), grantPlan: plan ?? "pro", status: 400, notice: null,
    });
    if (errors.length || !plan) return again(errors);
    // Without entitlement_tiers an Ultra grant writes nothing and says which file to apply.
    if ((await grantPlan(c.env, user.id, op.userId, plan, endsAt, reference, now)) === "no_tiers") return again(["admin.err_no_tiers"]);
    return c.redirect(userPath(user.id, plan === "ultra" ? "granted_ultra" : "granted"), 303);
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

// The notice to the new address lives in sender.ts beside the other messages
// (the live mail check sends it too); exported here as before.
export { addressNotice };

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

// -- the accounts-open message and the Ultra message (announce.tsx) -----------------------------------

type AnnounceState = { counts: AnnounceCounts | null; refusal: Key | null; errors?: Key[]; notice?: string | null };

// Each kind's page wording; the accounts-open message keeps the words it had.
const ANNOUNCE_WORDS: Record<AnnounceKind, { title: Key; lead: Key; waiting: Key; preview: Key }> = {
  accounts: { title: "admin.announce_title", lead: "admin.announce_lead", waiting: "admin.announce_waiting", preview: "admin.announce_preview" },
  ultra: {
    title: "admin.announce_ultra_title", lead: "admin.announce_ultra_lead", waiting: "admin.announce_ultra_waiting", preview: "admin.announce_ultra_preview",
  },
};

// Mail that cannot leave (the stub sender) and a forms database without
// notice_at are refusals: the page says so and offers no form. So is the
// Ultra message while Ultra cannot be bought (announce.tsx ultraMessageAllowed):
// the message says Ultra is open.
async function announceState(c: Context<AppEnv>, kind: AnnounceKind): Promise<AnnounceState> {
  if (kind === "ultra" && !(await ultraMessageAllowed(c.env))) return { counts: null, refusal: "admin.announce_ultra_off_sale" };
  let counts: AnnounceCounts;
  try {
    counts = await announceCounts(c.env, kind);
  } catch (e) {
    if (missingColumn(e)) return { counts: null, refusal: "admin.announce_no_column" };
    throw e;
  }
  return { counts, refusal: mailOn(c) ? null : "admin.announce_no_mail" };
}

// What a run will do, the counts, the form, and the message in both
// languages: the accounts-open message as an address with one list would get
// it, or the Ultra message. The form names the Ultra kind in a hidden field;
// the accounts-open form names none, since that is the default.
function announceView(lang: Lang, op: Account, base: string, s: AnnounceState, kind: AnnounceKind = "accounts") {
  const n = (v: number) => fmtInt(v, lang);
  const words = ANNOUNCE_WORDS[kind];
  return (
    <>
      <PageHead lang={lang} title={t(lang, words.title)} lead={t(lang, words.lead, { n: n(ANNOUNCE_MAX) })}
        actions={<a href="/admin" class="btn">{t(lang, "admin.title")}</a>} />
      <Notice message={s.notice} />
      <Panel title={t(lang, "admin.panel_what")} class="panel-form">
        <Errors lang={lang} errors={s.refusal ? [s.refusal] : s.errors} />
        {s.counts ? (
          <ul class="account-list">
            <li>{t(lang, words.waiting, { n: n(s.counts.waiting) })}</li>
            <li>{t(lang, "admin.announce_sent", { n: n(s.counts.sent) })}</li>
            <li>{t(lang, "admin.announce_mark")}</li>
            <li>{t(lang, "admin.announce_limit")}</li>
          </ul>
        ) : null}
        {s.refusal ? null : (
          <form method="post" action="/admin/announce" class="stack">
            <Csrf op={op} />
            {kind === "ultra" ? <input type="hidden" name="kind" value="ultra" /> : null}
            <ConfirmBox lang={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "admin.announce_button", { n: n(ANNOUNCE_MAX) })}</button>
          </form>
        )}
      </Panel>
      {(["en", "fr"] as const).map((l) => {
        // The preview shows the subject and the text, never a recipient.
        const token = "0".repeat(32);
        const m = kind === "ultra"
          ? ultraOpenMessage(l, "", ultraLinks(base, l, token))
          : accountsOpenMessage(l, "", [t(l, "interest.label_tenders_all")], announceLinks(base, l, token));
        return (
          <Panel title={t(lang, words.preview, { lang: t(lang, l === "fr" ? "admin.lang_fr" : "admin.lang_en") })}>
            <p><strong>{m.subject}</strong></p>
            <pre class="cite-block">{m.text}</pre>
          </Panel>
        );
      })}
    </>
  );
}

const STOP_CODE_RE = /^[A-Z0-9_]{1,64}$/;

// The last run's figures come back in the address of the redirect after it.
function announceNotice(c: Context<AppEnv>, lang: Lang, kind: AnnounceKind = "accounts"): string | null {
  if (c.req.query("m") !== "done") return null;
  const count = (k: string) => fmtInt(Math.max(0, Math.trunc(Number(c.req.query(k) ?? "0")) || 0), lang);
  const done = kind === "ultra"
    ? t(lang, "admin.announce_ultra_done", { sent: count("sent"), failed: count("failed"), left: count("left") })
    : t(lang, "admin.announce_done", { sent: count("sent"), failed: count("failed"), accounts: count("accounts"), left: count("left") });
  const code = c.req.query("stopped") ?? "";
  return STOP_CODE_RE.test(code) ? `${done} ${t(lang, "admin.announce_stopped", { code })}` : done;
}

// ?kind=ultra (or kind=ultra in the post) is the Ultra message; anything else the accounts-open one.
admin.get("/announce", (c) =>
  guarded(c, async () => {
    const lang = c.get("lang");
    const kind = announceKindOf(c.req.query("kind"));
    const s = await announceState(c, kind);
    return adminPage(c, t(lang, ANNOUNCE_WORDS[kind].title),
      announceView(lang, operatorOf(c), siteBase(c), { ...s, notice: announceNotice(c, lang, kind) }, kind));
  }));

admin.post("/announce", async (c) => {
  const form = await operatorForm(c);
  if (form instanceof Response) return form;
  const { op, fields } = form;
  const lang = c.get("lang");
  const kind = announceKindOf(fields.kind);
  return guarded(c, async () => {
    const s = await announceState(c, kind);
    const again = (errors: Key[]) =>
      adminPage(c, t(lang, ANNOUNCE_WORDS[kind].title), announceView(lang, op, siteBase(c), { ...s, errors }, kind), 400);
    if (s.refusal) return again([]);
    if (!confirmed(fields)) return again(["admin.err_confirm"]);
    const r = await runAnnouncement(c.env, siteBase(c), c.req.url, new Date(), ANNOUNCE_MAX, kind);
    if (kind === "ultra") {
      await operatorAudit(c.env, null, "operator_announced_ultra", op.userId,
        `${r.sent} sent, ${r.failed} not sent, ${r.left} left${r.stopped ? ", stopped at a limit" : ""}`);
    } else {
      await operatorAudit(c.env, null, "operator_announced", op.userId,
        `${r.sent} sent, ${r.failed} not sent, ${r.accounts} holding an account, ${r.left} left${r.stopped ? ", stopped at a limit" : ""}`);
    }
    const p = new URLSearchParams({ m: "done", sent: String(r.sent), failed: String(r.failed), accounts: String(r.accounts), left: String(r.left) });
    if (kind === "ultra") {
      p.delete("accounts");
      p.set("kind", "ultra");
    }
    if (r.stopped) p.set("stopped", r.stopped);
    return c.redirect(`/admin/announce?${p}`, 303);
  });
});

// -- the live mail check (mail_check.ts, docs/mail.md) -------------------------------------------------

const MAIL_CHECK_NAME: Record<MailCheckTemplate, Key> = {
  sign_in: "admin.mail_check_t_sign_in", tenders_daily: "admin.mail_check_t_tenders", expiring_weekly: "admin.mail_check_t_expiring",
  records: "admin.mail_check_t_records", watch: "admin.mail_check_t_watch", briefing: "admin.mail_check_t_briefing",
  weekly: "admin.mail_check_t_weekly", accounts_open: "admin.mail_check_t_accounts_open", ultra_open: "admin.mail_check_t_ultra_open",
  address_notice: "admin.mail_check_t_address",
};

// What the check sends and where, never the address itself, and the form.
// The answer to the form is the route's JSON.
function mailCheckView(lang: Lang, op: Account, s: { addressSet: boolean; sender: string }) {
  const n = fmtInt(MAIL_CHECK_TEMPLATES.length, lang);
  return (
    <>
      <PageHead lang={lang} title={t(lang, "admin.mail_check_title")} lead={t(lang, "admin.mail_check_lead", { n })}
        actions={<a href="/admin" class="btn">{t(lang, "admin.title")}</a>} />
      <Panel title={t(lang, "admin.panel_what")} class="panel-form">
        <ul class="account-list">
          <li>{t(lang, s.addressSet ? "admin.mail_check_address_set" : "admin.mail_check_address_unset")}</li>
          <li>{t(lang, "admin.mail_check_sender", { kind: s.sender })}</li>
          <li>{t(lang, "admin.mail_check_answer")}</li>
        </ul>
        <ol class="account-list">{MAIL_CHECK_TEMPLATES.map((k) => <li>{t(lang, MAIL_CHECK_NAME[k])}</li>)}</ol>
        {s.addressSet ? (
          <form method="post" action={MAIL_CHECK_PATH} class="stack">
            <Csrf op={op} />
            <label>
              {t(lang, "admin.mail_check_language")}
              <select name="language">
                <option value="en" selected={lang === "en"}>{t(lang, "admin.lang_en")}</option>
                <option value="fr" selected={lang === "fr"}>{t(lang, "admin.lang_fr")}</option>
              </select>
            </label>
            <button type="submit" class="btn btn-primary">{t(lang, "admin.mail_check_button", { n })}</button>
          </form>
        ) : null}
      </Panel>
    </>
  );
}

admin.get("/mail-check", (c) => {
  const lang = c.get("lang");
  return adminPage(c, t(lang, "admin.mail_check_title"),
    mailCheckView(lang, operatorOf(c), { addressSet: mailCheckTo(c.env) !== null, sender: senderFor(c.env, c.req.url).kind }));
});

// The workflow's post (byToken) is a form with language=en|fr, or no body at
// all; the console's is operatorForm's, Origin and CSRF checked. Either way
// the messages go to MAIL_TEST_TO alone, and an audit row records the run by
// its counts (by the operator's user id, or by "token"), never an address.
admin.post("/mail-check", async (c) => {
  let by: string;
  let fields: Record<string, string> = {};
  if (byToken.has(c.req.raw)) {
    by = "token";
    if (c.req.header("content-type") !== undefined) {
      const form = await readForm(c);
      if (!form.ok) return c.json({ ok: false, error: "not_a_form" }, form.status);
      fields = form.fields;
    }
  } else {
    const form = await operatorForm(c);
    if (form instanceof Response) return form;
    by = form.op.userId;
    fields = form.fields;
  }
  const lang = c.get("lang");
  const language: Lang = fields.language === "fr" ? "fr" : "en";
  return guarded(c, async () => {
    const to = mailCheckTo(c.env);
    if (!to) {
      await operatorAudit(c.env, null, "operator_mail_check", by, "no test address, nothing sent");
      return c.json({ ok: false, error: "no_test_address", message: t(lang, "admin.mail_check_no_address") }, 400);
    }
    const run = await runMailCheck(c.env, c.req.url, { to, site: siteBase(c), lang: language });
    const count = (r: MailCheckOutcome) => run.results.filter((x) => x.result === r).length;
    await operatorAudit(c.env, null, "operator_mail_check", by, `${count("sent")} sent, ${count("refused")} refused, ${count("stubbed")} stubbed`);
    return c.json({
      ok: run.results.every((r) => r.result === "sent"), sender: run.sender, language,
      results: run.results.map((r) => (r.reason === null ? { template: r.template, result: r.result } : r)),
    });
  });
});
