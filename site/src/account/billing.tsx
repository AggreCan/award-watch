// Phase 3: paying for Pro. The billing page, the posts that send a user to
// the payment service's checkout and portal, and the webhook that turns the
// service's notices into entitlement rows. routes.tsx mounts them behind the
// same guards as every account route (the switch, the session, Origin and
// CSRF on the user's posts); the webhook has no session and no Origin, and
// its signature is its only credential (stripe.ts).
//
// The rule from entitlements.ts holds: the plan is computed from the
// entitlements rows and nothing else. Every change a notice makes is a row
// written, extended or ended there (planFor then brings the users cache up
// to date); payment_customers only remembers which customer and
// subscription belong to whom, for the page and for the next notice.
//
// Fail open to outages: a notice the database cannot take answers 5xx, so
// Stripe sends it again (for up to three days), and a row's three days of
// grace past the paid period cover a renewal that arrives late. Fail closed
// to the end of a subscription: canceled, unpaid or expired ends the row at
// once.

import type { Context } from "hono";
import type { AppEnv, Env } from "../env";
import { fmtInt, t, tj, type Key, type Lang } from "../i18n";
import { PageHead, Panel } from "../layout";
import { audit } from "./audit";
import { RULES, planFor } from "./entitlements";
import { accountPage, planLine } from "./pages";
import { INTERVALS, type Interval, type Notice, type PaymentSource, type SubscriptionState, isInterval, paymentSource } from "./payments";
import { newId, plusDays } from "./secrets";
import type { Account } from "./session";

// Days of Pro past the end of a paid period: room for a renewal whose
// payment or notice is late, so a paying user is not dropped for an hour.
export const GRACE_DAYS = 3;
// Notices are kept this long against a second delivery; Stripe's own
// retries stop after three days and a manual resend after thirty.
export const EVENT_DAYS = 90;

// Statuses after which a subscription never bills again.
const ENDED = new Set(["canceled", "incomplete_expired"]);
// Statuses that end Pro at once: those two, and unpaid, which Stripe reaches
// once its retries of a renewal are spent (a later payment grants again).
const ENDS_PRO = new Set(["canceled", "unpaid", "incomplete_expired"]);

const STATUS_KEY: Record<string, Key> = {
  active: "billing.status_active", trialing: "billing.status_trialing", past_due: "billing.status_past_due",
  unpaid: "billing.status_unpaid", incomplete: "billing.status_incomplete", paused: "billing.status_paused",
};

export type PaymentRow = {
  user_id: string; customer_id: string; subscription_id: string | null; status: string | null; current_period_end: string | null;
};

export async function paymentRow(env: Env, userId: string): Promise<PaymentRow | null> {
  return env.ACCOUNTS!.prepare(
    "SELECT user_id, customer_id, subscription_id, status, current_period_end FROM payment_customers WHERE user_id = ?",
  ).bind(userId).first<PaymentRow>();
}

// A subscription that can still bill: bound and not ended.
export const liveSubscription = (row: PaymentRow | null): boolean => !!row?.subscription_id && !ENDED.has(row.status ?? "");

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const graceAfter = (periodEnd: string) => plusDays(new Date(periodEnd), GRACE_DAYS);
const langQuery = (lang: Lang, first: "?" | "&") => (lang === "fr" ? `${first}lang=fr` : "");

// -- the overview's line ---------------------------------------------------------------

export type BillingLine = { stripe: boolean; periodEnd: string | null };

// Whether the plan the overview shows comes from a live Stripe row (the
// latest live row, ordered as planFromRows orders them), and the end of the
// period paid. Null when the tables cannot be read: the overview then shows
// the plan as before, since the payment tables are applied by hand.
export async function billingLine(env: Env, userId: string, now = new Date()): Promise<BillingLine | null> {
  try {
    const row = await env.ACCOUNTS!.prepare(
      "SELECT (SELECT plan || ' ' || source FROM entitlements WHERE user_id = ?1 AND revoked_at IS NULL AND starts_at <= ?2 " +
      "AND (ends_at IS NULL OR ends_at > ?2) ORDER BY created_at DESC, id DESC LIMIT 1) AS top, " +
      "(SELECT current_period_end FROM payment_customers WHERE user_id = ?1) AS period_end",
    ).bind(userId, now.toISOString()).first<{ top: string | null; period_end: string | null }>();
    return { stripe: row?.top === "pro stripe", periodEnd: row?.period_end ?? null };
  } catch {
    return null;
  }
}

// -- the page ---------------------------------------------------------------------------

// The figure as the operator wrote it, with a decimal comma in French.
const figure = (lang: Lang, text: string) => (lang === "fr" ? text.replace(".", ",") : text);

// What every billing form carries: the session's CSRF value, and the page's
// language, which sets the language of Stripe's page too.
const Hidden = ({ account, lang }: { account: Account; lang: Lang }) => (
  <>
    <input type="hidden" name="csrf" value={account.csrf} />
    <input type="hidden" name="lang" value={lang} />
  </>
);

export function billingView(
  lang: Lang, account: Account,
  state: {
    offer: Readonly<Record<Interval, string>> | null; canManage: boolean; row: PaymentRow | null; line: BillingLine | null; errors?: Key[];
  },
) {
  const { offer, row, canManage } = state;
  const live = canManage && liveSubscription(row);
  const overdue = row?.status === "past_due" || row?.status === "unpaid";
  return (
    <>
      <PageHead lang={lang} title={t(lang, "billing.title")} lead={t(lang, "billing.lead", { plan: planLine(lang, account, state.line) })}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      {state.errors?.length ? <ul class="errors" role="alert">{state.errors.map((e) => <li>{t(lang, e)}</li>)}</ul> : null}
      {live && row ? (
        <Panel title={t(lang, "billing.panel_subscription")} class="panel-form">
          {overdue ? <p role="status"><strong>{t(lang, "billing.past_due_note")}</strong></p> : null}
          <dl class="wide">
            <dt>{t(lang, "billing.field_status")}</dt>
            <dd>{t(lang, STATUS_KEY[row.status ?? ""] ?? "billing.status_other")}</dd>
            {row.current_period_end ? (
              <>
                <dt>{t(lang, "billing.field_period")}</dt>
                <dd class="mono">{day(row.current_period_end)}</dd>
              </>
            ) : null}
          </dl>
          <p>{t(lang, "billing.manage_text")}</p>
          <form method="post" action="/account/billing/portal">
            <Hidden account={account} lang={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "billing.manage")}</button>
          </form>
        </Panel>
      ) : null}
      <Panel title={t(lang, "billing.panel_pro")}>
        <ul class="account-list">
          <li>{t(lang, "billing.pro_searches", { n: fmtInt(RULES.pro.saved_searches, lang), free: fmtInt(RULES.free.saved_searches, lang) })}</li>
          <li>{t(lang, "billing.pro_delivery")}</li>
          <li>{t(lang, "billing.pro_intraday")}</li>
        </ul>
      </Panel>
      {live ? null : (
        <Panel title={t(lang, "billing.panel_subscribe")} class="panel-form">
          {offer ? (
            <>
              <div class="account-actions">
                {INTERVALS.map((interval) => (
                  <form method="post" action="/account/billing/checkout">
                    <Hidden account={account} lang={lang} />
                    <input type="hidden" name="interval" value={interval} />
                    <button type="submit" class={interval === "monthly" ? "btn btn-primary" : "btn"}>
                      {t(lang, interval === "monthly" ? "billing.monthly" : "billing.yearly", { price: figure(lang, offer[interval]) })}
                    </button>
                  </form>
                ))}
              </div>
              <p class="muted small">{t(lang, "billing.taxes")}</p>
              <p class="muted small">{t(lang, "billing.renewal")}</p>
              <p class="muted small">{t(lang, "billing.processor")}</p>
              <p class="muted small">{tj(lang, "billing.terms", { terms: <a href="/terms">{t(lang, "footer.terms")}</a> })}</p>
            </>
          ) : (
            <p>{t(lang, "billing.unavailable")}</p>
          )}
        </Panel>
      )}
      {!live && canManage && row ? (
        <Panel title={t(lang, "billing.panel_receipts")} class="panel-form">
          <p>{t(lang, "billing.receipts_text")}</p>
          <form method="post" action="/account/billing/portal">
            <Hidden account={account} lang={lang} />
            <button type="submit" class="btn">{t(lang, "billing.receipts")}</button>
          </form>
        </Panel>
      ) : null}
    </>
  );
}

// The page for a signed-in user. With the stub source the payment tables are
// not read at all, so the page answers before the operator has applied them.
export async function billingPage(c: Context<AppEnv>, who: Account, extra: { errors?: Key[]; status?: number } = {}): Promise<Response> {
  const lang = c.get("lang");
  const source = paymentSource(c.env);
  const row = source.kind === "stub" ? null : await paymentRow(c.env, who.userId);
  const line = source.kind === "stub" ? null : await billingLine(c.env, who.userId);
  const view = billingView(lang, who, { offer: source.offer(), canManage: source.kind !== "stub", row, line, errors: extra.errors });
  return accountPage(c, t(lang, "billing.title"), view, extra.status ?? 200);
}

// -- checkout and the portal ------------------------------------------------------------

// POST /account/billing/checkout (session, CSRF and Origin already checked).
// A user whose subscription can still bill goes to the portal, where it is
// changed: a second checkout would start a second subscription (a page left
// open from before the first one, say).
export async function startCheckout(c: Context<AppEnv>, who: Account, fields: Record<string, string>, base: string): Promise<Response> {
  const lang = c.get("lang");
  const interval = fields.interval;
  if (!isInterval(interval)) return c.text(t(lang, "form.rejected"), 400);
  const source = paymentSource(c.env);
  if (!source.available()) return c.redirect("/account/billing", 303);
  const row = await paymentRow(c.env, who.userId);
  if (liveSubscription(row)) return openPortal(c, who, base);
  const url = await source.checkoutUrl({
    userId: who.userId, email: who.email, interval, lang, customerId: row?.customer_id ?? null,
    successUrl: `${base}/account?billing=done${langQuery(lang, "&")}`,
    cancelUrl: `${base}/account/billing${langQuery(lang, "?")}`,
  });
  if (!url) return billingPage(c, who, { errors: ["billing.err_service"], status: 503 });
  return c.redirect(url, 303);
}

// POST /account/billing/portal: the service's own page for the stored
// customer (change the interval, the card, see receipts, cancel).
export async function openPortal(c: Context<AppEnv>, who: Account, base: string): Promise<Response> {
  const lang = c.get("lang");
  const source = paymentSource(c.env);
  if (source.kind === "stub") return c.redirect("/account/billing", 303);
  const row = await paymentRow(c.env, who.userId);
  if (!row) return c.redirect("/account/billing", 303);
  const url = await source.portalUrl({ customerId: row.customer_id, returnUrl: `${base}/account/billing${langQuery(lang, "?")}`, lang });
  if (!url) return billingPage(c, who, { errors: ["billing.err_service"], status: 503 });
  return c.redirect(url, 303);
}

// -- deletion -----------------------------------------------------------------------------

// Before an account is deleted, its subscription is cancelled at once, so a
// deleted account is never charged again. False when the service could not
// confirm it; the account is then kept and the user asked to try again.
export async function endForDeletion(env: Env, userId: string, now = new Date()): Promise<boolean> {
  const source = paymentSource(env);
  if (source.kind === "stub") return true;
  const row = await paymentRow(env, userId);
  if (!row || !liveSubscription(row)) return true;
  if (!(await source.cancel(row.subscription_id!))) return false;
  await env.ACCOUNTS!.prepare("UPDATE payment_customers SET status = 'canceled', updated_at = ? WHERE user_id = ?")
    .bind(now.toISOString(), userId).run();
  await audit(env, userId, "plan_changed", "stripe cancelled with the account", now);
  return true;
}

// -- the webhook -------------------------------------------------------------------------

// POST /account/billing/webhook. Unverified: 400 and nothing written. A
// notice already taken: 200 and nothing done. Otherwise the notice is
// claimed by its id first, so two deliveries at once apply it once; a
// failure to apply it releases the claim and answers 500, and Stripe sends
// it again.
export async function billingWebhook(c: Context<AppEnv>): Promise<Response> {
  const now = new Date();
  const source = paymentSource(c.env);
  const read = await source.readNotice(c.req.raw, now);
  if (!read.ok) return c.text("Not verified.", 400);
  const db = c.env.ACCOUNTS!;
  const at = now.toISOString();
  try {
    const claim = await db.prepare("INSERT INTO payment_events (id, type, received_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .bind(read.id, read.type.slice(0, 100), at).run();
    if (!claim.meta?.changes) return c.text("Already received.", 200);
  } catch {
    console.error("billing webhook: notice not recorded");
    return c.text("Try again.", 503);
  }
  try {
    await apply({ env: c.env, db, source, now, at }, read.notice);
  } catch {
    console.error(`billing webhook: ${read.type} not applied`);
    await db.prepare("DELETE FROM payment_events WHERE id = ?").bind(read.id).run().catch(() => undefined);
    return c.text("Try again.", 500);
  }
  await db.prepare("DELETE FROM payment_events WHERE received_at < ?").bind(plusDays(now, -EVENT_DAYS)).run().catch(() => undefined);
  return c.text("Received.", 200);
}

type Run = { env: Env; db: D1Database; source: PaymentSource; now: Date; at: string };
type UserRow = { id: string; status: string; plan: string; plan_until: string | null };

function apply(run: Run, notice: Notice): Promise<void> {
  if (notice.kind === "checkout") return onCheckout(run, notice);
  if (notice.kind === "period_paid") return onPeriodPaid(run, notice);
  if (notice.kind === "subscription") return onSubscription(run, notice.subscription, notice.deleted);
  if (notice.kind === "reversed") return onReversed(run, notice);
  return Promise.resolve();
}

const userById = (db: D1Database, id: string) =>
  db.prepare("SELECT id, status, plan, plan_until FROM users WHERE id = ?").bind(id).first<UserRow>();

// The user a notice is about: the one already bound to the subscription (or
// else the customer), or the subscription's metadata hint if that user exists.
async function userFor(db: D1Database, subscriptionId: string, customerId: string, hint: string | null): Promise<UserRow | null> {
  const bound = await db.prepare(
    "SELECT user_id FROM payment_customers WHERE subscription_id = ?1 OR customer_id = ?2 ORDER BY subscription_id = ?1 DESC LIMIT 1",
  ).bind(subscriptionId, customerId).first<{ user_id: string }>();
  const id = bound?.user_id ?? hint;
  return id ? userById(db, id) : null;
}

function unmatched(type: string): void {
  console.error(`billing webhook: ${type} names no known account`);
}

// Records which subscription belongs to the user. The stored one is
// replaced when it is the same subscription, when there is none, or when it
// has ended; a notice about another subscription while a live one is bound
// leaves the binding alone (and says so). Returns the row as it was.
async function bind(
  run: Run, userId: string, s: { customerId: string; subscriptionId: string; status: string | null; periodEnd: string | null },
): Promise<{ bound: boolean; before: PaymentRow | null }> {
  const before = await paymentRow(run.env, userId);
  if (before?.subscription_id && before.subscription_id !== s.subscriptionId && !ENDED.has(before.status ?? "")) {
    return { bound: false, before };
  }
  await run.db.prepare(
    "INSERT INTO payment_customers (user_id, customer_id, subscription_id, status, current_period_end, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET customer_id = excluded.customer_id, subscription_id = excluded.subscription_id, " +
    "status = excluded.status, current_period_end = excluded.current_period_end, updated_at = excluded.updated_at",
  ).bind(userId, s.customerId, s.subscriptionId, s.status, s.periodEnd, run.at).run();
  return { bound: true, before };
}

// Pro until endsAt for the subscription: the live row with its reference is
// extended (never shortened), or a row is written when none is live.
async function grant(run: Run, user: UserRow, subscriptionId: string, endsAt: string, why: string): Promise<void> {
  if (endsAt <= run.at) return;
  const live = await run.db.prepare(
    "SELECT id, ends_at FROM entitlements WHERE user_id = ?1 AND source = 'stripe' AND reference = ?2 AND revoked_at IS NULL " +
    "AND starts_at <= ?3 AND (ends_at IS NULL OR ends_at > ?3) ORDER BY created_at DESC, id DESC LIMIT 1",
  ).bind(user.id, subscriptionId, run.at).first<{ id: string; ends_at: string | null }>();
  if (live) {
    if (live.ends_at === null || live.ends_at >= endsAt) return;
    await run.db.prepare("UPDATE entitlements SET ends_at = ? WHERE id = ?").bind(endsAt, live.id).run();
    await audit(run.env, user.id, "plan_changed", `stripe ${why}, extended`, run.now);
  } else {
    await run.db.prepare(
      "INSERT INTO entitlements (id, user_id, plan, source, starts_at, ends_at, reference, created_at) VALUES (?, ?, 'pro', 'stripe', ?, ?, ?, ?)",
    ).bind(newId(), user.id, run.at, endsAt, subscriptionId, run.at).run();
    await audit(run.env, user.id, "plan_changed", `stripe ${why}, granted`, run.now);
  }
  await planFor(run.env, user, run.now);
}

// Ends every live row of the subscription now.
async function endNow(run: Run, user: UserRow, subscriptionId: string, status: string): Promise<void> {
  const res = await run.db.prepare(
    "UPDATE entitlements SET ends_at = ?1 WHERE user_id = ?2 AND source = 'stripe' AND reference = ?3 AND revoked_at IS NULL " +
    "AND (ends_at IS NULL OR ends_at > ?1)",
  ).bind(run.at, user.id, subscriptionId).run();
  if (!res.meta?.changes) return;
  await audit(run.env, user.id, "plan_changed", `stripe ended, ${status}`, run.now);
  await planFor(run.env, user, run.now);
}

// checkout.session.completed: bind the customer and subscription to the
// user named by client_reference_id, and, once paid, grant Pro to the end of
// the subscription's current period plus the grace. The session names the
// subscription but not its period, so the subscription is read; a failed
// read answers 500 and the notice comes again.
async function onCheckout(run: Run, n: Extract<Notice, { kind: "checkout" }>): Promise<void> {
  const user = await userById(run.db, n.userId);
  if (!user) return unmatched("checkout.session.completed");
  if (user.status !== "active") {
    // Deleted while Stripe's page was open: no account is left to serve.
    if (!(await run.source.cancel(n.subscriptionId))) throw new Error("cancel failed");
    await audit(run.env, user.id, "plan_changed", "stripe cancelled, account deleted", run.now);
    return;
  }
  const state = await run.source.subscription(n.subscriptionId);
  if (state === null) throw new Error("subscription unreadable");
  const status = state === "missing" ? "canceled" : state.status;
  const periodEnd = state === "missing" ? null : state.periodEnd;
  const { bound } = await bind(run, user.id, { customerId: n.customerId, subscriptionId: n.subscriptionId, status, periodEnd });
  if (!bound) await audit(run.env, user.id, "plan_changed", "stripe second subscription", run.now);
  if (n.paid && (status === "active" || status === "trialing") && periodEnd) {
    await grant(run, user, n.subscriptionId, graceAfter(periodEnd), "checkout");
  } else {
    await audit(run.env, user.id, "plan_changed", "stripe checkout, awaiting payment", run.now);
  }
}

// invoice.paid: a period is paid. The live row is extended to the period's
// end plus the grace, or one is written when none is live (a first period
// whose checkout notice has not come yet, a renewal paid after a lapse). A
// subscription already ended grants nothing, whatever arrives late.
async function onPeriodPaid(run: Run, n: Extract<Notice, { kind: "period_paid" }>): Promise<void> {
  const user = await userFor(run.db, n.subscriptionId, n.customerId, n.userId);
  if (!user) return unmatched("invoice.paid");
  const row = await paymentRow(run.env, user.id);
  const same = row?.subscription_id === n.subscriptionId;
  if (same && ENDED.has(row!.status ?? "")) return;
  const kept = same ? row!.current_period_end : null;
  const periodEnd = n.periodEnd && (!kept || n.periodEnd > kept) ? n.periodEnd : kept;
  await bind(run, user.id, { customerId: n.customerId, subscriptionId: n.subscriptionId, status: same ? row!.status : null, periodEnd });
  if (n.periodEnd) await grant(run, user, n.subscriptionId, graceAfter(n.periodEnd), "renewed");
}

// charge.refunded (in full) and charge.dispute.created: the money for a
// period went back, or is being taken back, so the Stripe Pro of the account
// bound to the charge's customer ends now, every live Stripe row of it: a
// charge no longer names its subscription. The subscription itself is left
// as it is (the operator cancels it in the dashboard when it should not bill
// again), and a later invoice.paid grants again, being a new payment. A
// dispute's charge is read for its customer; a failed read answers 500, so
// the notice comes again.
async function onReversed(run: Run, n: Extract<Notice, { kind: "reversed" }>): Promise<void> {
  const type = n.why === "refunded" ? "charge.refunded" : "charge.dispute.created";
  let customerId = n.customerId;
  if (!customerId) {
    const read = await run.source.chargeCustomer(n.chargeId);
    if (read === null) throw new Error("charge unreadable");
    if (read === "missing") return unmatched(type);
    customerId = read;
  }
  const bound = await run.db.prepare("SELECT user_id FROM payment_customers WHERE customer_id = ? LIMIT 1")
    .bind(customerId).first<{ user_id: string }>();
  const user = bound ? await userById(run.db, bound.user_id) : null;
  if (!user) return unmatched(type);
  const res = await run.db.prepare(
    "UPDATE entitlements SET ends_at = ?1 WHERE user_id = ?2 AND source = 'stripe' AND revoked_at IS NULL " +
    "AND (ends_at IS NULL OR ends_at > ?1)",
  ).bind(run.at, user.id).run();
  if (!res.meta?.changes) return;
  await audit(run.env, user.id, "plan_changed", `stripe ended, ${n.why}`, run.now);
  await planFor(run.env, user, run.now);
}

// customer.subscription.updated and .deleted: the status and period end are
// recorded; canceled, unpaid or incomplete_expired (and every deletion) end
// the subscription's live row now. A renewal is granted by its invoice, not
// here: the period moves forward before the payment is taken.
async function onSubscription(run: Run, s: SubscriptionState, deleted: boolean): Promise<void> {
  const status = deleted ? "canceled" : s.status;
  const user = await userFor(run.db, s.id, s.customerId, s.userId);
  if (!user) return unmatched(deleted ? "customer.subscription.deleted" : "customer.subscription.updated");
  const { bound, before } = await bind(run, user.id, { customerId: s.customerId, subscriptionId: s.id, status, periodEnd: s.periodEnd });
  if (ENDS_PRO.has(status)) return endNow(run, user, s.id, status);
  if (bound && before?.status !== status) await audit(run.env, user.id, "plan_changed", `stripe status ${status.slice(0, 40)}`, run.now);
}
