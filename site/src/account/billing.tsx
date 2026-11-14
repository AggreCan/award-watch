// Phase 3: paying for Pro. The billing page, the posts that send a user to
// the payment service's checkout and portal, and the webhook that turns the
// service's notices into entitlement rows. The page also offers the refund of
// the first payment, which refund.ts makes. routes.tsx mounts them behind the
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
//
// Two paid plans, Pro and Ultra (docs/accounts.md, Ultra). The plan a
// subscription pays for is its product's (stripe.ts planOfSubscription), and
// money decides which way it may move: only a paid notice (a paid checkout,
// invoice.paid) raises a plan, and only for an active subscription with no
// pending update naming Ultra; an update notice can only lower one, once
// Stripe confirms it; a product the site does not know never grants Ultra;
// and a notice that cannot be confirmed with Stripe changes nothing and
// answers 5xx, so Stripe sends it again.

import type { Context } from "hono";
import type { AppEnv, Env } from "../env";
import { decimal, t, tj, type Key, type Lang } from "../i18n";
import { PageHead, Panel } from "../layout";
import { CONTACT_EMAIL } from "../contact";
import { PlanCards, planCards, type PlanReader } from "../pro";
import { audit } from "./audit";
import { type PaidPlan, type Plan, entitlementWrites, isPaidPlan, planFor, planRank, withTiers } from "./entitlements";
import { type DeleteFacts, accountPage, planLine } from "./pages";
import {
  INTERVALS, type Interval, type Notice, type PaymentSource, type SubscriptionState, isInterval, paymentSource, ultraOnSale,
} from "./payments";
import { newId, plusDays } from "./secrets";
import type { Account } from "./session";
import { SESSION_RE, pendingUltra, planOfSubscription } from "./stripe";

// Days of Pro past the end of a paid period: room for a renewal whose
// payment or notice is late, so a paying user is not dropped for an hour.
export const GRACE_DAYS = 3;
// Notices are kept this long against a second delivery; Stripe's own
// retries stop after three days and a manual resend after thirty.
export const EVENT_DAYS = 90;
// The refund of the first payment (the Terms, Refund of the First Payment):
// offered on this page for this many days after it, once per account.
// refund.ts makes it.
export const REFUND_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

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
export const langQuery = (lang: Lang, first: "?" | "&") => (lang === "fr" ? `${first}lang=fr` : "");

// -- the overview's line ---------------------------------------------------------------

export type BillingLine = { stripe: boolean; periodEnd: string | null };

// Whether the plan the overview shows comes from a live Stripe row (the
// latest live row, ordered as planFromRows orders them), and the end of the
// period paid. Null when the tables cannot be read: the overview then shows
// the plan as before, since the payment tables are applied by hand. An
// Ultra row says pro in entitlements (its tier is beside it), so it reads as
// a Stripe row here too.
//
// The period paid is the row's own end less the grace: a row is written and
// extended only by a paid notice, to the paid period's end plus GRACE_DAYS
// (grant, switchPlan, lowerTo), so it never names a period not paid yet.
// The subscription's current_period_end moves forward at the renewal, before
// its payment is taken, and stays there through past_due.
export async function billingLine(env: Env, userId: string, now = new Date()): Promise<BillingLine | null> {
  try {
    const row = await env.ACCOUNTS!.prepare(
      "SELECT plan, source, ends_at FROM entitlements WHERE user_id = ?1 AND revoked_at IS NULL AND starts_at <= ?2 " +
      "AND (ends_at IS NULL OR ends_at > ?2) ORDER BY created_at DESC, id DESC LIMIT 1",
    ).bind(userId, now.toISOString()).first<{ plan: string; source: string; ends_at: string | null }>();
    const stripe = row?.plan === "pro" && row.source === "stripe";
    const end = stripe && row.ends_at ? Date.parse(row.ends_at) : NaN;
    return { stripe, periodEnd: Number.isFinite(end) ? plusDays(new Date(end), -GRACE_DAYS) : null };
  } catch {
    return null;
  }
}

// The paid plan the bound subscription last paid for: its newest Stripe row,
// ended or not, read through the tier table; null when it has none or the
// rows cannot be read. For the lines that name the plan once it has ended
// (the overdue note, the delete page), when the account's plan is Free.
export async function subscriptionPlan(env: Env, userId: string, subscriptionId: string | null): Promise<PaidPlan | null> {
  if (!subscriptionId) return null;
  try {
    const row = await withTiers((tiers) => env.ACCOUNTS!.prepare(
      `SELECT ${tiers ? "COALESCE(t.tier, e.plan)" : "e.plan"} AS plan FROM entitlements e ` +
      (tiers ? "LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id " : "") +
      "WHERE e.user_id = ?1 AND e.source = 'stripe' AND e.reference = ?2 ORDER BY e.created_at DESC, e.id DESC LIMIT 1",
    ).bind(userId, subscriptionId).first<{ plan: string }>());
    return isPaidPlan(row?.plan) ? row.plan : null;
  } catch {
    return null;
  }
}

// -- the refund of the first payment: who is offered it ----------------------------------

// What the site's own rows say of the refund, in one statement: when the
// account's first Stripe row was written (the first payment's notice wrote
// it), its Stripe rows that name another subscription, renewals recorded
// since (grant's "stripe renewed, extended": a second payment on the same
// subscription), moves between Pro and Ultra (grant's "stripe moved to ...":
// a move up is a second paid invoice), refunds made from this page
// (refund.ts), and the customer's charges refunded in full or disputed
// (payment_reversals).
export const REFUND_FACTS_SQL =
  "SELECT (SELECT MIN(created_at) FROM entitlements WHERE user_id = ?1 AND source = 'stripe') AS first, " +
  "(SELECT COUNT(*) FROM entitlements WHERE user_id = ?1 AND source = 'stripe' AND (reference IS NULL OR reference <> ?2)) AS others, " +
  "(SELECT COUNT(*) FROM audit WHERE user_id = ?1 AND event = 'plan_changed' AND detail = 'stripe renewed, extended') AS renewals, " +
  "(SELECT COUNT(*) FROM audit WHERE user_id = ?1 AND event = 'plan_changed' AND detail LIKE 'stripe moved%') AS moves, " +
  "(SELECT COUNT(*) FROM audit WHERE user_id = ?1 AND event = 'refund_made') AS made, " +
  "(SELECT COUNT(*) FROM payment_reversals WHERE customer_id = ?3 AND why = 'refunded') AS refunded, " +
  "(SELECT COUNT(*) FROM payment_reversals WHERE customer_id = ?3) AS reversals";

type RefundFacts = {
  first: string | null; others: number; renewals: number; moves: number; made: number; refunded: number; reversals: number;
};

// "offer": the page shows Refund now. Every one of these holds: the paid
// plan (Pro or Ultra) comes from a live Stripe row now; the bound
// subscription is active; every Stripe row the account has ever had names
// that subscription, so no earlier subscription was paid for (entitlement
// rows are never deleted, which makes this the lasting half of "once per
// account"); no renewal and no move between plans was recorded (the refund
// covers the first payment only, and a move up is a payment of its own); the
// first of those rows was written within REFUND_DAYS; and no refund or
// dispute is on record (the audit and payment_reversals keep 90 days, which
// covers the 14). "refunded": a refund is on record. "window": everything
// holds but the days. "none": anything else. The page asks Stripe nothing;
// the press reads Stripe and decides again (refund.ts). A fault reading the
// rows offers nothing, and the Terms' address stays the way to ask.
export type RefundState = "offer" | "refunded" | "window" | "none";

export async function refundState(
  env: Env, userId: string, row: PaymentRow | null, line: BillingLine | null, now = new Date(),
): Promise<RefundState> {
  if (!row) return "none";
  let facts: RefundFacts | null;
  try {
    facts = await env.ACCOUNTS!.prepare(REFUND_FACTS_SQL).bind(userId, row.subscription_id, row.customer_id).first<RefundFacts>();
  } catch {
    console.error("billing: refund state not read");
    return "none";
  }
  if (!facts) return "none";
  if (facts.made || facts.refunded) return "refunded";
  if (!row.subscription_id || row.status !== "active" || !line?.stripe) return "none";
  if (!facts.first || facts.others || facts.renewals || facts.moves || facts.reversals) return "none";
  const first = Date.parse(facts.first);
  if (!Number.isFinite(first)) return "none";
  return now.getTime() - first <= REFUND_DAYS * DAY_MS ? "offer" : "window";
}

// -- the page ---------------------------------------------------------------------------

// The figure as the operator wrote it, with a decimal comma in French: the
// same helper as the Pro tease panels' price line (src/pro.tsx), so the two
// pages can never print one figure two ways.
const figure = decimal;

// The yearly price's monthly equivalent, to the cent, from the configured
// figure ("189.99" is "15.83"), so the yearly button names both.
export function perMonth(yearly: string): string {
  return (Math.round(Number(yearly) * 100 / 12) / 100).toFixed(2);
}

// What every billing form carries: the session's CSRF value, and the page's
// language, which sets the language of Stripe's page too.
const Hidden = ({ account, lang }: { account: Account; lang: Lang }) => (
  <>
    <input type="hidden" name="csrf" value={account.csrf} />
    <input type="hidden" name="lang" value={lang} />
  </>
);

// A paid plan's name as the lines that name it say it ("Pro", "Ultra").
export const planName = (lang: Lang, plan: Plan): string => t(lang, plan === "ultra" ? "ultra.tag" : "pro.tag");

// The plan the cards mark as the reader's own.
const readerOf = (plan: Plan): PlanReader => (plan === "ultra" ? "ultra" : plan === "pro" ? "pro" : "free");

// The refund's panel: the offer, one line and the Refund now link, which
// leads to the confirmation on this same page (?refund=confirm); or that
// confirmation, which says what cannot be undone and posts only with its box
// ticked. Neither button is filled: the page's one filled button stays
// Manage the subscription, and a refund is not what the page invites. plan
// is the paid plan's name, which the lines say ends.
const RefundPanel = ({ lang, account, step, plan }: { lang: Lang; account: Account; step: "offer" | "confirm"; plan: string }) => (
  <Panel title={t(lang, "terms.pro_refund_title")} id="refund" class="panel-form">
    {step === "offer" ? (
      <>
        <p>{t(lang, "billing.refund_text", { plan })}</p>
        <p><a href={`/account/billing?refund=confirm${langQuery(lang, "&")}#refund`} class="btn">{t(lang, "billing.refund_now")}</a></p>
      </>
    ) : (
      <form method="post" action="/account/billing/refund" class="stack">
        <Hidden account={account} lang={lang} />
        <p>{t(lang, "billing.refund_confirm_text", { plan })}</p>
        <label class="account-check">
          <input type="checkbox" name="confirm" value="yes" required />
          <span>{t(lang, "billing.refund_confirm", { plan })}</span>
        </label>
        <div class="account-actions">
          <button type="submit" class="btn">{t(lang, "billing.refund_button")}</button>
          <a href={`/account/billing${langQuery(lang, "?")}`} class="btn">{t(lang, "billing.refund_keep", { plan })}</a>
        </div>
      </form>
    )}
  </Panel>
);

// A move between plans (moveBetweenPlans): up from a Stripe Pro subscription
// while Ultra is on sale, down from a Stripe Ultra one. Its button is plain:
// the subscription's Manage button stays the page's filled one.
export type Move = "up" | "down";

const MovePanel = ({ lang, account, move, ultra }: { lang: Lang; account: Account; move: Move; ultra: Readonly<Record<Interval, string>> | null }) => (
  <Panel title={t(lang, move === "up" ? "billing.panel_move" : "plans.move_pro")} id="move" class="panel-form">
    <p>
      {move === "up" && ultra
        ? t(lang, "billing.move_text", { monthly: figure(lang, ultra.monthly), yearly: figure(lang, ultra.yearly) })
        : t(lang, "billing.move_down_text")}
    </p>
    <form method="post" action="/account/billing/change">
      <Hidden account={account} lang={lang} />
      <input type="hidden" name="plan" value={move === "up" ? "ultra" : "pro"} />
      <button type="submit" class="btn">{t(lang, move === "up" ? "plans.move_ultra" : "plans.move_pro")}</button>
    </form>
  </Panel>
);

// The Subscribe panel's address for a plan: Pro's by default, Ultra's with ?plan=ultra.
const subscribeHref = (lang: Lang, plan: PaidPlan) =>
  plan === "ultra" ? `/account/billing?plan=ultra${langQuery(lang, "&")}#subscribe` : `/account/billing${langQuery(lang, "?")}#subscribe`;

export function billingView(
  lang: Lang, account: Account,
  state: {
    offer: Readonly<Record<Interval, string>> | null; canManage: boolean; row: PaymentRow | null; line: BillingLine | null; errors?: Key[];
    // The refund's panel, when the account is offered it (refundState); and
    // the line saying what the last press did, already in the page's language.
    refund?: "offer" | "confirm" | null; notice?: string | null;
    // Ultra's two figures while it is on sale (ultraOnSale), else null; and
    // the plan the Subscribe panel offers (?plan=ultra, Pro otherwise).
    ultra?: Readonly<Record<Interval, string>> | null; chosen?: PaidPlan;
    // The plan the bound subscription last paid for (subscriptionPlan), for
    // the overdue note once the account's own plan has ended.
    lastPlan?: PaidPlan | null;
  },
) {
  const { offer, row, canManage } = state;
  const ultra = state.ultra ?? null;
  const chosen: PaidPlan = state.chosen === "ultra" && ultra ? "ultra" : "pro";
  const chosenOffer = chosen === "ultra" ? ultra : offer;
  const live = canManage && liveSubscription(row);
  const overdue = row?.status === "past_due" || row?.status === "unpaid";
  const paid = isPaidPlan(account.plan) ? account.plan : null;
  // A move needs a live Stripe subscription deciding the plan: up from Pro while Ultra is on sale, down from Ultra while Pro is.
  const move: Move | null = live && state.line?.stripe
    ? (paid === "pro" && ultra ? "up" : paid === "ultra" && offer ? "down" : null)
    : null;
  // The refund's messages name the contact address, the days and the plan; the other errors have none of them to fill.
  const vars = { email: CONTACT_EMAIL, days: REFUND_DAYS, plan: planName(lang, paid ?? "pro") };
  // A subscription that can still bill while the plan is Free (past_due past
  // its grace, unpaid, a payment refunded or disputed): its plan is named by
  // what it paid for, and the note says how to get that plan back.
  const ended = live && !paid;
  const notePlan = ended ? planName(lang, state.lastPlan ?? "pro") : vars.plan;
  // Stripe's page moves between the plans too while both are on sale, or for an Ultra subscriber.
  const manageKey: Key = ultra || paid === "ultra" ? "billing.manage_text_ultra" : "billing.manage_text";
  return (
    <>
      <PageHead lang={lang} title={t(lang, "billing.title")} lead={t(lang, "billing.lead", { plan: planLine(lang, account, state.line) })}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      {state.errors?.length ? <ul class="errors" role="alert">{state.errors.map((e) => <li>{t(lang, e, vars)}</li>)}</ul> : null}
      {state.notice ? <p class="account-notice" role="status">{state.notice}</p> : null}
      {live && row ? (
        <Panel title={t(lang, "billing.panel_subscription")} id="subscription" class="panel-form">
          {overdue ? (
            <p role="status"><strong>{t(lang, ended ? "billing.past_due_note_ended" : "billing.past_due_note", { plan: notePlan })}</strong></p>
          ) : null}
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
          <p>{t(lang, manageKey)}</p>
          <form method="post" action="/account/billing/portal">
            <Hidden account={account} lang={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "billing.manage")}</button>
          </form>
        </Panel>
      ) : null}
      {move ? <MovePanel lang={lang} account={account} move={move} ultra={ultra} /> : null}
      {live && state.refund ? <RefundPanel lang={lang} account={account} step={state.refund} plan={vars.plan} /> : null}
      {/* Free beside Pro (and Ultra while it is on sale), the account's own plan marked; a plan's link leads to its Subscribe
          panel below, or, while a subscription can still bill and that panel is not drawn, to the subscription's own panel. */}
      <Panel title={t(lang, ultra ? "billing.panel_plans" : "billing.panel_pro")}>
        <PlanCards lang={lang} plans={planCards(lang, { price: offer, ultra, reader: readerOf(account.plan), place: "billing", chosen, move, live })} />
      </Panel>
      {live ? null : (
        <Panel title={t(lang, chosen === "ultra" ? "billing.panel_subscribe_ultra" : "billing.panel_subscribe")} id="subscribe" class="panel-form">
          {chosenOffer ? (
            <>
              <div class="account-actions">
                {INTERVALS.map((interval) => (
                  <form method="post" action="/account/billing/checkout">
                    <Hidden account={account} lang={lang} />
                    {/* Pro is the default plan of a checkout, so its forms carry no plan field. */}
                    {chosen === "ultra" ? <input type="hidden" name="plan" value="ultra" /> : null}
                    <input type="hidden" name="interval" value={interval} />
                    <button type="submit" class={interval === "monthly" ? "btn btn-primary" : "btn"}>
                      {t(lang, interval === "monthly" ? "billing.monthly" : "billing.yearly", {
                        price: figure(lang, chosenOffer[interval]), per_month: figure(lang, perMonth(chosenOffer.yearly)),
                      })}
                    </button>
                  </form>
                ))}
              </div>
              {ultra ? (
                <p>
                  <a href={subscribeHref(lang, chosen === "ultra" ? "pro" : "ultra")}>
                    {t(lang, "billing.other_plan", { plan: planName(lang, chosen === "ultra" ? "pro" : "ultra") })}
                  </a>
                </p>
              ) : null}
              <p class="muted small">{t(lang, "billing.taxes")}</p>
              <p class="muted small">{t(lang, "billing.renewal")}</p>
              <p class="muted small">{t(lang, "billing.processor", { plan: planName(lang, chosen) })}</p>
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

// What ?refund= asks of the page: the confirmation step, or the line after a
// press that took the refund (done: the subscription cancelled too; sent:
// its cancellation still to be made by hand, refund.ts).
const refundNotice = (asked: string): Key | null =>
  asked === "done" ? "billing.refund_done" : asked === "sent" ? "billing.refund_sent" : null;

// What ?move= says after Stripe's page returns from a move (the flow's own
// address, moveBetweenPlans): up waits for the payment, down for the period's end.
const moveNotice = (asked: string): Key | null =>
  asked === "sent" ? "billing.move_sent" : asked === "down" ? "billing.move_down_text" : null;

// The page for a signed-in user. With the stub source the payment tables are
// not read at all, so the page answers before the operator has applied them.
// confirm: the refund's confirmation step, for a press that came without its box ticked.
export async function billingPage(
  c: Context<AppEnv>, who: Account, extra: { errors?: Key[]; status?: number; confirm?: boolean } = {},
): Promise<Response> {
  const lang = c.get("lang");
  const source = paymentSource(c.env);
  const row = source.kind === "stub" ? null : await paymentRow(c.env, who.userId);
  const line = source.kind === "stub" ? null : await billingLine(c.env, who.userId);
  const asked = c.req.query("refund") ?? "";
  const offered = source.kind !== "stub" && (await refundState(c.env, who.userId, row, line)) === "offer";
  const refund = offered ? (extra.confirm || asked === "confirm" ? "confirm" : "offer") : null;
  const ultra = (await ultraOnSale(c.env)) ? source.offerFor("ultra") : null;
  const noticeKey = refundNotice(asked) ?? (ultra || who.plan === "ultra" ? moveNotice(c.req.query("move") ?? "") : null);
  const notice = noticeKey ? t(lang, noticeKey, { plan: planName(lang, isPaidPlan(who.plan) ? who.plan : "pro") }) : null;
  const lastPlan = !isPaidPlan(who.plan) && liveSubscription(row) ? await subscriptionPlan(c.env, who.userId, row!.subscription_id) : null;
  const view = billingView(lang, who, {
    offer: source.offer(), canManage: source.kind !== "stub", row, line, errors: extra.errors, refund, notice,
    ultra, chosen: c.req.query("plan") === "ultra" ? "ultra" : "pro", lastPlan,
  });
  return accountPage(c, t(lang, "billing.title"), view, extra.status ?? 200);
}

// -- checkout and the portal ------------------------------------------------------------

// The plan a form names: Pro when it names none (the forms before Ultra, and
// Pro's own, carry no plan field), Ultra when it says so, null for anything else.
const planField = (v: string | undefined): PaidPlan | null => (v === undefined || v === "pro" ? "pro" : v === "ultra" ? "ultra" : null);

// POST /account/billing/checkout (session, CSRF and Origin already checked).
// A user whose subscription can still bill goes to the portal, where it is
// changed: a second checkout would start a second subscription (a page left
// open from before the first one, say). Ultra is bought only while it is on
// sale; the idempotency key names the user, the plan, the interval, the
// language and the ten minutes (stripe.ts), so another choice starts its own
// checkout and a returning customer's other open one is expired. The success
// address carries Stripe's {CHECKOUT_SESSION_ID} template ("Add the
// {CHECKOUT_SESSION_ID} template variable to the success_url when you create
// the Checkout Session ... this happens automatically after your customer
// pays and is redirected to the success page",
// docs.stripe.com/payments/checkout/custom-success-page), which the
// overview reads on the way back (bindReturn).
export const CHECKOUT_SESSION_TEMPLATE = "{CHECKOUT_SESSION_ID}";

export async function startCheckout(c: Context<AppEnv>, who: Account, fields: Record<string, string>, base: string): Promise<Response> {
  const lang = c.get("lang");
  const interval = fields.interval;
  const plan = planField(fields.plan);
  if (!isInterval(interval) || !plan) return c.text(t(lang, "form.rejected"), 400);
  const source = paymentSource(c.env);
  if (!source.available()) return c.redirect("/account/billing", 303);
  if (plan === "ultra" && !(await ultraOnSale(c.env))) return c.redirect("/account/billing", 303);
  const row = await paymentRow(c.env, who.userId);
  if (liveSubscription(row)) return openPortal(c, who, base);
  const url = await source.checkoutUrl({
    userId: who.userId, email: who.email, plan, interval, lang, customerId: row?.customer_id ?? null,
    successUrl: `${base}/account?billing=${plan === "ultra" ? "done_ultra" : "done"}${langQuery(lang, "&")}&session=${CHECKOUT_SESSION_TEMPLATE}`,
    cancelUrl: plan === "ultra" ? `${base}/account/billing?plan=ultra${langQuery(lang, "&")}` : `${base}/account/billing${langQuery(lang, "?")}`,
  });
  if (url === "busy") return billingPage(c, who, { errors: ["billing.err_busy"], status: 409 });
  if (!url) return billingPage(c, who, { errors: ["billing.err_service"], status: 503 });
  return c.redirect(url, 303);
}

// The way back from Stripe's checkout (/account?billing=done&session=<id>):
// the session is read from Stripe and, when it was made for this account and
// is complete, its customer and subscription are bound with the
// subscription's status as Stripe gives it, the way the checkout notice's
// bind does. So a payer whose first notices failed (Stripe retries them for
// up to three days) is sent to the portal by Subscribe instead of starting a
// second subscription. Nothing is granted here: the plan stays with the
// signed notices. Any failure (an id of another shape, Stripe unreachable,
// another account's session, a session not complete, a fault) binds nothing
// and the page answers as before; nothing is logged but the call's status.
export async function bindReturn(env: Env, who: Account, sessionId: string, now = new Date()): Promise<void> {
  if (!SESSION_RE.test(sessionId)) return;
  const source = paymentSource(env);
  if (source.kind === "stub") return;
  try {
    const session = await source.checkoutSession(sessionId);
    if (!session || session === "missing" || !session.complete || session.userId !== who.userId) return;
    if (!session.customerId || !session.subscriptionId) return;
    const state = await source.subscription(session.subscriptionId);
    if (!state || state === "missing" || state.customerId !== session.customerId) return;
    if (state.userId !== null && state.userId !== who.userId) return;
    const run: Run = { env, db: env.ACCOUNTS!, source, now, at: now.toISOString() };
    const { bound, before } = await bind(run, who.userId, {
      customerId: session.customerId, subscriptionId: session.subscriptionId, status: state.status, periodEnd: state.periodEnd,
    });
    if (bound && before?.subscription_id !== session.subscriptionId) {
      await audit(env, who.userId, "plan_changed", "stripe checkout return, bound", now);
    }
  } catch {
    console.error("billing: checkout return not bound");
  }
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

// POST /account/billing/change (session, CSRF and Origin already checked):
// a move between Pro and Ultra, opened on Stripe's portal at the move itself.
// The subscription is read for its one item, and the portal's flow moves
// that item to the other plan's price of the same interval; Stripe's page
// shows the amount due before the reader confirms (a move up is prorated and
// charged at once, a move down waits for the period's end, as the portal's
// configuration sets them), and returns to ?move=sent or ?move=down. Nothing
// is written here: the webhook changes the plan when Stripe says so, Ultra
// only on a paid notice. Ultra is moved to only while it is on sale. When the
// subscription cannot be moved by a flow (no single item read, a price the
// site does not know, a plan it is already on) the plain portal opens, as
// Manage does, and so it does when Stripe refuses the flow (stripe.ts).
export async function moveBetweenPlans(c: Context<AppEnv>, who: Account, fields: Record<string, string>, base: string): Promise<Response> {
  const lang = c.get("lang");
  const plan = fields.plan === "pro" || fields.plan === "ultra" ? fields.plan : null;
  if (!plan) return c.text(t(lang, "form.rejected"), 400);
  const source = paymentSource(c.env);
  if (source.kind === "stub" || !source.available()) return c.redirect("/account/billing", 303);
  if (plan === "ultra" && !(await ultraOnSale(c.env))) return c.redirect("/account/billing", 303);
  const row = await paymentRow(c.env, who.userId);
  if (!row || !liveSubscription(row)) return c.redirect(`/account/billing${langQuery(lang, "?")}`, 303);
  const state = await source.subscription(row.subscription_id!);
  if (state === null) return billingPage(c, who, { errors: ["billing.err_service"], status: 503 });
  if (state === "missing" || !state.item || !state.item.interval) return openPortal(c, who, base);
  if (planOfSubscription(c.env, state) === plan) return c.redirect(`/account/billing${langQuery(lang, "?")}`, 303);
  const priceId = source.priceFor(plan, state.item.interval);
  if (!priceId) return openPortal(c, who, base);
  const url = await source.portalUrl({
    customerId: row.customer_id, returnUrl: `${base}/account/billing${langQuery(lang, "?")}`, lang,
    flow: {
      subscriptionId: state.id, itemId: state.item.id, priceId,
      doneUrl: `${base}/account/billing?move=${plan === "ultra" ? "sent" : "down"}${langQuery(lang, "&")}`,
    },
  });
  if (!url) return billingPage(c, who, { errors: ["billing.err_service"], status: 503 });
  return c.redirect(url, 303);
}

// -- deletion -----------------------------------------------------------------------------

// What the delete page says of payments (pages.tsx deleteView): the plan a
// subscription of the account pays for, named as it is (the account's own
// paid plan, else the plan its bound subscription last paid for while that
// subscription can still bill), and whether the billing page offers Refund
// now, so the page can point to it: deleting refunds nothing. The stub reads
// no payment table; a fault reading them names the account's own plan only
// and offers no pointer.
export async function deleteFacts(env: Env, who: Account): Promise<DeleteFacts> {
  const own = isPaidPlan(who.plan) ? who.plan : null;
  if (paymentSource(env).kind === "stub") return { paid: own, refund: false };
  try {
    const row = await paymentRow(env, who.userId);
    const refund = (await refundState(env, who.userId, row, await billingLine(env, who.userId))) === "offer";
    const paid = own ?? (liveSubscription(row) ? (await subscriptionPlan(env, who.userId, row!.subscription_id)) ?? "pro" : null);
    return { paid, refund };
  } catch {
    return { paid: own, refund: false };
  }
}

// Before an account is deleted, every subscription of it that can still
// bill is cancelled at once: the bound one first, then every other one a
// live Stripe row names (a second subscription from a checkout started
// beside the first). False when the service could not confirm one; the
// account is then kept and the user asked to try again. A subscription the
// site has no live row for (its notices not taken yet) is cancelled when its
// first notice lands on the deleted account (onCheckout, onPeriodPaid,
// onSubscription).
export async function endForDeletion(env: Env, userId: string, now = new Date()): Promise<boolean> {
  const source = paymentSource(env);
  if (source.kind === "stub") return true;
  const row = await paymentRow(env, userId);
  const at = now.toISOString();
  const refs = new Set<string>();
  if (row && liveSubscription(row)) refs.add(row.subscription_id!);
  const rows = (await env.ACCOUNTS!.prepare(
    "SELECT DISTINCT reference FROM entitlements WHERE user_id = ?1 AND source = 'stripe' AND revoked_at IS NULL " +
    "AND reference IS NOT NULL AND starts_at <= ?2 AND (ends_at IS NULL OR ends_at > ?2) ORDER BY reference",
  ).bind(userId, at).all<{ reference: string }>()).results ?? [];
  for (const r of rows) refs.add(r.reference);
  for (const id of refs) {
    if (!(await source.cancel(id))) return false;
    if (id === row?.subscription_id) {
      await env.ACCOUNTS!.prepare("UPDATE payment_customers SET status = 'canceled', updated_at = ? WHERE user_id = ? AND subscription_id = ?")
        .bind(at, userId, id).run();
    }
    await audit(env, userId, "plan_changed", "stripe cancelled with the account", now);
  }
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
  await db.batch([
    db.prepare("DELETE FROM payment_events WHERE received_at < ?").bind(plusDays(now, -EVENT_DAYS)),
    db.prepare("DELETE FROM payment_reversals WHERE at < ?").bind(plusDays(now, -EVENT_DAYS)),
  ]).catch(() => undefined);
  return c.text("Received.", 200);
}

type Run = { env: Env; db: D1Database; source: PaymentSource; now: Date; at: string };
type UserRow = { id: string; status: string; plan: string; plan_until: string | null };

function apply(run: Run, notice: Notice): Promise<void> {
  if (notice.kind === "checkout") return onCheckout(run, notice);
  if (notice.kind === "period_paid") return onPeriodPaid(run, notice);
  if (notice.kind === "subscription") return onSubscription(run, notice.subscription, notice.deleted);
  if (notice.kind === "reversed") return onReversed(run, notice);
  if (notice.kind === "refund_failed") return onRefundFailed(run, notice);
  return Promise.resolve();
}

// A notice for an account no longer active (deleted while Stripe's page was
// open, or after a second subscription's checkout, or with notices still on
// their way): the subscription is cancelled at once, nothing is granted, and
// the audit row names it, which the daily check reads (watchdog.ts
// MONEY_ITEMS_SQL). paid: the notice reports a payment ("stripe paid on a
// deleted account"); otherwise a subscription that could still bill ("stripe
// live on a deleted account"). Whether a payment is refunded is the
// operator's decision; nothing here refunds. A cancellation Stripe cannot
// confirm, or a row the database does not take, is thrown, so the notice
// answers 500 and comes again (a second cancellation is one already made).
async function cancelForDeleted(run: Run, user: UserRow, subscriptionId: string, paid: boolean): Promise<void> {
  if (!(await run.source.cancel(subscriptionId))) throw new Error("cancel failed");
  await run.db.prepare("INSERT INTO audit (user_id, event, at, detail) VALUES (?, 'plan_changed', ?, ?)")
    .bind(user.id, run.at, `stripe ${paid ? "paid" : "live"} on a deleted account, cancelled ${subscriptionId}`.slice(0, 120)).run();
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
// leaves the binding alone (and says so). A terminal status of the same
// subscription is never replaced: canceled "is a terminal state that can't
// be updated", and incomplete_expired "is a terminal status"
// (docs.stripe.com/billing/subscriptions/overview,
// docs.stripe.com/api/subscriptions/object), so a notice that says
// otherwise afterwards was sent before it (Stripe does not keep their order).
// Returns the row as it was, and whether anything was written.
async function bind(
  run: Run, userId: string, s: { customerId: string; subscriptionId: string; status: string | null; periodEnd: string | null },
): Promise<{ bound: boolean; before: PaymentRow | null; wrote: boolean }> {
  const before = await paymentRow(run.env, userId);
  if (before?.subscription_id && before.subscription_id !== s.subscriptionId && !ENDED.has(before.status ?? "")) {
    return { bound: false, before, wrote: false };
  }
  if (before?.subscription_id === s.subscriptionId && ENDED.has(before.status ?? "")) return { bound: true, before, wrote: false };
  await run.db.prepare(
    "INSERT INTO payment_customers (user_id, customer_id, subscription_id, status, current_period_end, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id) DO UPDATE SET customer_id = excluded.customer_id, subscription_id = excluded.subscription_id, " +
    "status = excluded.status, current_period_end = excluded.current_period_end, updated_at = excluded.updated_at",
  ).bind(userId, s.customerId, s.subscriptionId, s.status, s.periodEnd, run.at).run();
  return { bound: true, before, wrote: true };
}

type LiveRow = { id: string; ends_at: string | null; plan: PaidPlan };

// The subscription's live Stripe row, with its plan (the tier beside it;
// without the tier table, the row's own pro).
async function liveRow(run: Run, userId: string, subscriptionId: string): Promise<LiveRow | null> {
  const row = await withTiers((tiers) => run.db.prepare(
    `SELECT e.id, e.ends_at, ${tiers ? "COALESCE(t.tier, e.plan)" : "e.plan"} AS plan FROM entitlements e ` +
    (tiers ? "LEFT JOIN entitlement_tiers t ON t.entitlement_id = e.id " : "") +
    "WHERE e.user_id = ?1 AND e.source = 'stripe' AND e.reference = ?2 AND e.revoked_at IS NULL " +
    "AND e.starts_at <= ?3 AND (e.ends_at IS NULL OR e.ends_at > ?3) ORDER BY e.created_at DESC, e.id DESC LIMIT 1",
  ).bind(userId, subscriptionId, run.at).first<{ id: string; ends_at: string | null; plan: string }>());
  return row ? { id: row.id, ends_at: row.ends_at, plan: isPaidPlan(row.plan) ? row.plan : "pro" } : null;
}

const later = (a: string | null, b: string): string => (a !== null && a > b ? a : b);

// A switch between the plans in one batch: the live row ends now, and a row
// of the new plan (with its tier row for Ultra) runs from now to endsAt.
async function switchPlan(run: Run, user: UserRow, subscriptionId: string, live: LiveRow, plan: PaidPlan, endsAt: string): Promise<void> {
  await run.db.batch([
    run.db.prepare("UPDATE entitlements SET ends_at = ? WHERE id = ?").bind(run.at, live.id),
    ...entitlementWrites(run.db, {
      id: newId(), userId: user.id, plan, source: "stripe", startsAt: run.at, endsAt, reference: subscriptionId, createdAt: run.at,
    }),
  ]);
  await audit(run.env, user.id, "plan_changed", `stripe moved to ${plan}`, run.now);
}

// The plan a paid notice asks for: the subscription's, and whether Stripe
// confirmed it (an active or trialing subscription with no pending update
// naming Ultra). null keeps the live row's plan (Pro when none is live):
// the subscription could not be read for its plan.
type Want = { plan: PaidPlan; confirmed: boolean } | null;

// The plan until endsAt for the subscription. The live row of the same plan
// is extended (never shortened); one of the other plan is switched in a
// batch (the old row ends now, the new one runs to the later of the old
// row's end and endsAt, "stripe moved to <plan>"); a row is written when none
// is live. An unconfirmed want never raises a plan above the live row's (or
// above Pro when none is live).
async function grant(run: Run, user: UserRow, subscriptionId: string, endsAt: string, why: string, want: Want): Promise<void> {
  if (endsAt <= run.at) return;
  const live = await liveRow(run, user.id, subscriptionId);
  const cap: PaidPlan = live?.plan ?? "pro";
  const plan: PaidPlan = !want ? cap : want.confirmed || planRank(want.plan) <= planRank(cap) ? want.plan : cap;
  if (live && live.plan === plan) {
    if (live.ends_at === null || live.ends_at >= endsAt) return;
    await run.db.prepare("UPDATE entitlements SET ends_at = ? WHERE id = ?").bind(endsAt, live.id).run();
    await audit(run.env, user.id, "plan_changed", `stripe ${why}, extended`, run.now);
  } else if (live) {
    await switchPlan(run, user, subscriptionId, live, plan, later(live.ends_at, endsAt));
  } else {
    await run.db.batch(entitlementWrites(run.db, {
      id: newId(), userId: user.id, plan, source: "stripe", startsAt: run.at, endsAt, reference: subscriptionId, createdAt: run.at,
    }));
    await audit(run.env, user.id, "plan_changed", `stripe ${why}, granted`, run.now);
  }
  await planFor(run.env, user, run.now);
}

// The plan a subscription read from Stripe asks for: its product's, confirmed
// for an active or trialing subscription. A pending update naming Ultra (a
// move not paid for yet) is thrown, so the notice answers 500 and comes again.
function wantOf(run: Run, state: SubscriptionState): Want {
  if (pendingUltra(run.env, state)) throw new Error("pending update");
  return { plan: planOfSubscription(run.env, state), confirmed: state.status === "active" || state.status === "trialing" };
}

// A move down the notice shows (the subscription's plan ranks below its live
// row's): applied at once, keeping the row's end, once Stripe confirms it by
// reading the subscription again, so a notice delivered late, from before a
// move up, cannot take a paid Ultra away. Never raises a plan. A read that
// fails is thrown: the notice answers 500 and comes again.
async function lowerTo(run: Run, user: UserRow, subscriptionId: string, plan: PaidPlan): Promise<void> {
  const live = await liveRow(run, user.id, subscriptionId);
  if (!live || planRank(plan) >= planRank(live.plan)) return;
  const state = await run.source.subscription(subscriptionId);
  if (state === null) throw new Error("subscription unreadable");
  if (state === "missing") return;
  const confirmed = planOfSubscription(run.env, state);
  if (planRank(confirmed) >= planRank(live.plan)) return;
  await switchPlan(run, user, subscriptionId, live, confirmed, live.ends_at ?? graceAfter(state.periodEnd ?? run.at));
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

// Whether a payment was taken back: its charge is a recorded reversal, or the
// customer has a reversal made at or after the moment it was paid, which is
// how a notice delayed past its own refund reads when it names no charge
// (current invoices do not). A reversal is recorded at the time it was made
// (onReversed), so a payment made after it (the next period's, or a
// subscription bought after a Refund now) is not caught by it, whenever
// either notice is taken.
async function reversed(run: Run, customerId: string, chargeId: string | null, paidAt: string | null): Promise<boolean> {
  const row = await run.db.prepare(
    "SELECT 1 AS x FROM payment_reversals WHERE charge_id = ?1 OR (customer_id = ?2 AND ?3 IS NOT NULL AND at >= ?3) LIMIT 1",
  ).bind(chargeId, customerId, paidAt).first();
  return row !== null;
}

// checkout.session.completed: bind the customer and subscription to the
// user named by client_reference_id, and, once paid, grant the plan bought
// (the subscription's product: Ultra, or Pro) to the end of the
// subscription's current period plus the grace. The session names the
// subscription but not its period, so the subscription is read; a failed
// read answers 500 and the notice comes again.
async function onCheckout(run: Run, n: Extract<Notice, { kind: "checkout" }>): Promise<void> {
  const user = await userById(run.db, n.userId);
  if (!user) return unmatched("checkout.session.completed");
  if (user.status !== "active") {
    // Deleted while Stripe's page was open: no account is left to serve. A
    // paid session put money on it, which the daily check names.
    if (n.paid) return cancelForDeleted(run, user, n.subscriptionId, true);
    if (!(await run.source.cancel(n.subscriptionId))) throw new Error("cancel failed");
    await audit(run.env, user.id, "plan_changed", "stripe cancelled, account deleted", run.now);
    return;
  }
  const state = await run.source.subscription(n.subscriptionId);
  if (state === null) throw new Error("subscription unreadable");
  const status = state === "missing" ? "canceled" : state.status;
  const periodEnd = state === "missing" ? null : state.periodEnd;
  // The plan bought, from the subscription's product; a pending update naming Ultra answers 500 before anything is written.
  const want = state !== "missing" && n.paid && (status === "active" || status === "trialing") && periodEnd ? wantOf(run, state) : null;
  const { bound } = await bind(run, user.id, { customerId: n.customerId, subscriptionId: n.subscriptionId, status, periodEnd });
  if (!bound) await audit(run.env, user.id, "plan_changed", "stripe second subscription", run.now);
  if (want && periodEnd) {
    if (await reversed(run, n.customerId, null, n.createdAt)) {
      await audit(run.env, user.id, "plan_changed", "stripe payment reversed, not granted", run.now);
      return;
    }
    await grant(run, user, n.subscriptionId, graceAfter(periodEnd), "checkout", want);
  } else {
    await audit(run.env, user.id, "plan_changed", "stripe checkout, awaiting payment", run.now);
  }
}

// invoice.paid: a period is paid. The live row is extended to the period's
// end plus the grace, or one is written when none is live (a first period
// whose checkout notice has not come yet, a renewal paid after a lapse). A
// subscription already ended grants nothing, whatever arrives late. The
// subscription is read for its plan first (one call; unreachable answers 500
// and nothing is written): an active one grants its product's plan,
// switching the live row when the plan differs (a move up is paid on this
// notice), and a pending update naming Ultra answers 500 so the notice comes
// again once it is settled. One Stripe no longer knows keeps the live row's
// plan, as before Ultra.
//
// The status written is the one Stripe gave on that read, never the one the
// site held before it: a checkout notice or an update taken while the read
// was on its way (Stripe keeps no order between notices) would otherwise be
// written over by an older status. When the subscription is not read (no
// period on the invoice) or Stripe no longer knows it, the held one stays.
// An account no longer active has the subscription cancelled and nothing
// granted (cancelForDeleted).
async function onPeriodPaid(run: Run, n: Extract<Notice, { kind: "period_paid" }>): Promise<void> {
  const user = await userFor(run.db, n.subscriptionId, n.customerId, n.userId);
  if (!user) return unmatched("invoice.paid");
  const row = await paymentRow(run.env, user.id);
  const same = row?.subscription_id === n.subscriptionId;
  if (same && ENDED.has(row!.status ?? "")) return;
  if (user.status !== "active") return cancelForDeleted(run, user, n.subscriptionId, true);
  let want: Want = null;
  let fresh: string | null = null;
  if (n.periodEnd) {
    const state = await run.source.subscription(n.subscriptionId);
    if (state === null) throw new Error("subscription unreadable");
    if (state !== "missing") {
      want = wantOf(run, state);
      fresh = state.status;
    }
  }
  const kept = same ? row!.current_period_end : null;
  const periodEnd = n.periodEnd && (!kept || n.periodEnd > kept) ? n.periodEnd : kept;
  const status = fresh ?? (same ? row!.status : null);
  await bind(run, user.id, { customerId: n.customerId, subscriptionId: n.subscriptionId, status, periodEnd });
  if (!n.periodEnd) return;
  // A notice delayed past the refund or dispute of the payment it reports.
  if (await reversed(run, n.customerId, n.chargeId, n.paidAt)) {
    await audit(run.env, user.id, "plan_changed", "stripe payment reversed, not granted", run.now);
    return;
  }
  await grant(run, user, n.subscriptionId, graceAfter(n.periodEnd), "renewed", want);
}

// charge.refunded (in full) and charge.dispute.created: the money for a
// period went back, or is being taken back, so the Stripe Pro of the account
// bound to the charge's customer ends now: every Stripe row of it that
// existed when the refund or dispute was made (a charge no longer names its
// subscription). That moment is the event's own time (stripe.ts readEvent),
// not when the notice is taken, which can be later and out of order: a
// subscription bought after a Refund now, on the same customer, keeps its
// row whenever the refund's notice lands. A row written after that moment
// is its subscription's: when Stripe made the subscription after the
// reversal it is kept (no charge made before could pay for it); otherwise
// (a payment notice delayed past the refund, Stripe's own time unknown) it
// ends too, so a refunded payment never keeps a plan. The subscription
// itself is left as it is (the operator cancels it in the dashboard when it
// should not bill again), and a later invoice.paid grants again, being a new
// payment. A dispute's charge is read for its customer, and a later row's
// subscription for its time; a failed read answers 500, so the notice comes
// again. A notice without its time is read as made when taken, as before.
async function onReversed(run: Run, n: Extract<Notice, { kind: "reversed" }>): Promise<void> {
  const type = n.why === "refunded" ? "charge.refunded" : "charge.dispute.created";
  const madeAt = n.at ?? run.at;
  let customerId = n.customerId;
  if (!customerId) {
    const read = await run.source.chargeCustomer(n.chargeId);
    if (read === null) throw new Error("charge unreadable");
    if (read === "missing") return unmatched(type);
    customerId = read;
  }
  // Kept whether or not an account is bound yet, at the reversal's own time,
  // so a checkout or invoice notice that arrives after it grants nothing for
  // a payment made before it, and one made after it grants (reversed()).
  await run.db.prepare("INSERT INTO payment_reversals (charge_id, customer_id, why, at) VALUES (?, ?, ?, ?) ON CONFLICT(charge_id) DO NOTHING")
    .bind(n.chargeId, customerId, n.why, madeAt).run();
  const bound = await run.db.prepare("SELECT user_id FROM payment_customers WHERE customer_id = ? LIMIT 1")
    .bind(customerId).first<{ user_id: string }>();
  const user = bound ? await userById(run.db, bound.user_id) : null;
  if (!user) return unmatched(type);
  const live = (await run.db.prepare(
    "SELECT id, reference, created_at FROM entitlements WHERE user_id = ?1 AND source = 'stripe' AND revoked_at IS NULL " +
    "AND (ends_at IS NULL OR ends_at > ?2) ORDER BY created_at, id",
  ).bind(user.id, run.at).all<{ id: string; reference: string | null; created_at: string }>()).results ?? [];
  const end: string[] = [];
  const after = new Map<string, string[]>();
  for (const r of live) {
    if (r.created_at <= madeAt || !r.reference) end.push(r.id);
    else after.set(r.reference, [...(after.get(r.reference) ?? []), r.id]);
  }
  for (const [subscriptionId, rows] of after) {
    const state = await run.source.subscription(subscriptionId);
    if (state === null) throw new Error("subscription unreadable");
    const madeLater = state !== "missing" && !!state.createdAt && state.createdAt > madeAt;
    if (!madeLater) end.push(...rows);
  }
  if (!end.length) return;
  const ended = await run.db.batch(end.map((id) =>
    run.db.prepare("UPDATE entitlements SET ends_at = ?1 WHERE id = ?2 AND (ends_at IS NULL OR ends_at > ?1)").bind(run.at, id)));
  if (!ended.some((r) => r.meta?.changes)) return;
  await audit(run.env, user.id, "plan_changed", `stripe ended, ${n.why}`, run.now);
  await planFor(run.env, user, run.now);
}

// refund.failed: a refund Stripe took (a pending refund the balance never
// covered within 45 days, a closed card) did not reach the person. "In the
// rare instance that a refund fails, Stripe notifies you using the
// refund.failed event ... you need to arrange an alternative way to provide
// your customer with a refund" (docs.stripe.com/refunds, Handle failed
// refunds). The plan is not changed (it ended with the refund's notice, and
// what follows is the operator's decision): an audit row refund_failed names
// the charge and Stripe's reason, under the account's id, and the daily check
// names the account (watchdog.ts MONEY_ITEMS_SQL). The row is written so a
// fault answers 500 and the notice comes again. The customer is the refund's
// own, or the charge's, read from Stripe (a failed read answers 500).
async function onRefundFailed(run: Run, n: Extract<Notice, { kind: "refund_failed" }>): Promise<void> {
  let customerId = n.customerId;
  if (!customerId && n.chargeId) {
    const read = await run.source.chargeCustomer(n.chargeId);
    if (read === null) throw new Error("charge unreadable");
    if (read === "missing") return unmatched("refund.failed");
    customerId = read;
  }
  const bound = customerId
    ? await run.db.prepare("SELECT user_id FROM payment_customers WHERE customer_id = ? LIMIT 1").bind(customerId).first<{ user_id: string }>()
    : null;
  if (!bound) return unmatched("refund.failed");
  await run.db.prepare("INSERT INTO audit (user_id, event, at, detail) VALUES (?, 'refund_failed', ?, ?)")
    .bind(bound.user_id, run.at, `${n.chargeId ?? n.refundId ?? "unknown"} ${n.reason}`.slice(0, 120)).run();
}

// customer.subscription.updated and .deleted: the status and period end are
// recorded; canceled, unpaid or incomplete_expired (and every deletion) end
// the subscription's live row now. A renewal is granted by its invoice, not
// here: the period moves forward before the payment is taken. Nor is a move
// up: the items change before the payment is taken, so an update naming
// Ultra raises nothing, and invoice.paid raises the plan once it is paid. A
// move down (the subscription's product ranks below its live row's) is
// applied at once, keeping the row's end (lowerTo). A notice after the bound
// subscription has ended (a retried update sent before its cancellation)
// changes nothing (bind). On an account no longer active, a subscription
// that Stripe says can still bill is cancelled (cancelForDeleted); one that
// has ended, the cancellation's own notice among them, is recorded as before.
async function onSubscription(run: Run, s: SubscriptionState, deleted: boolean): Promise<void> {
  const status = deleted ? "canceled" : s.status;
  const user = await userFor(run.db, s.id, s.customerId, s.userId);
  if (!user) return unmatched(deleted ? "customer.subscription.deleted" : "customer.subscription.updated");
  if (user.status !== "active" && !ENDED.has(status)) {
    const now = await run.source.subscription(s.id);
    if (now === null) throw new Error("subscription unreadable");
    if (now === "missing" || ENDED.has(now.status)) return;
    return cancelForDeleted(run, user, s.id, false);
  }
  const { bound, before, wrote } = await bind(run, user.id, { customerId: s.customerId, subscriptionId: s.id, status, periodEnd: s.periodEnd });
  if (ENDS_PRO.has(status)) return endNow(run, user, s.id, status);
  if (bound && !wrote) return;
  if (bound && before?.status !== status) await audit(run.env, user.id, "plan_changed", `stripe status ${status.slice(0, 40)}`, run.now);
  await lowerTo(run, user, s.id, planOfSubscription(run.env, s));
}
