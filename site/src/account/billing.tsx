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
import { accountPage, planLine } from "./pages";
import {
  INTERVALS, type Interval, type Notice, type PaymentSource, type SubscriptionState, isInterval, paymentSource, ultraOnSale,
} from "./payments";
import { newId, plusDays } from "./secrets";
import type { Account } from "./session";
import { pendingUltra, planOfSubscription } from "./stripe";

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
  // Stripe's page moves between the plans too while both are on sale, or for an Ultra subscriber.
  const manageKey: Key = ultra || paid === "ultra" ? "billing.manage_text_ultra" : "billing.manage_text";
  return (
    <>
      <PageHead lang={lang} title={t(lang, "billing.title")} lead={t(lang, "billing.lead", { plan: planLine(lang, account, state.line) })}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      {state.errors?.length ? <ul class="errors" role="alert">{state.errors.map((e) => <li>{t(lang, e, vars)}</li>)}</ul> : null}
      {state.notice ? <p class="account-notice" role="status">{state.notice}</p> : null}
      {live && row ? (
        <Panel title={t(lang, "billing.panel_subscription")} class="panel-form">
          {overdue ? <p role="status"><strong>{t(lang, "billing.past_due_note", { plan: vars.plan })}</strong></p> : null}
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
      {/* Free beside Pro (and Ultra while it is on sale), the account's own plan marked; a plan's link leads to its Subscribe panel below. */}
      <Panel title={t(lang, ultra ? "billing.panel_plans" : "billing.panel_pro")}>
        <PlanCards lang={lang} plans={planCards(lang, { price: offer, ultra, reader: readerOf(account.plan), place: "billing", chosen, move })} />
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
  const view = billingView(lang, who, {
    offer: source.offer(), canManage: source.kind !== "stub", row, line, errors: extra.errors, refund, notice,
    ultra, chosen: c.req.query("plan") === "ultra" ? "ultra" : "pro",
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
// sale; the idempotency key names the user and the minutes, not the plan, so
// a checkout of the other plan in the same ten minutes answers busy.
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
    successUrl: `${base}/account?billing=${plan === "ultra" ? "done_ultra" : "done"}${langQuery(lang, "&")}`,
    cancelUrl: plan === "ultra" ? `${base}/account/billing?plan=ultra${langQuery(lang, "&")}` : `${base}/account/billing${langQuery(lang, "?")}`,
  });
  if (url === "busy") return billingPage(c, who, { errors: ["billing.err_busy"], status: 409 });
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
// customer has a reversal taken at or after the moment it was paid, which is
// how a notice delayed past its own refund reads when it names no charge
// (current invoices do not). A payment made after the reversal was taken (the
// next period's) is not caught by it.
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
    // Deleted while Stripe's page was open: no account is left to serve.
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
async function onPeriodPaid(run: Run, n: Extract<Notice, { kind: "period_paid" }>): Promise<void> {
  const user = await userFor(run.db, n.subscriptionId, n.customerId, n.userId);
  if (!user) return unmatched("invoice.paid");
  const row = await paymentRow(run.env, user.id);
  const same = row?.subscription_id === n.subscriptionId;
  if (same && ENDED.has(row!.status ?? "")) return;
  let want: Want = null;
  if (n.periodEnd) {
    const state = await run.source.subscription(n.subscriptionId);
    if (state === null) throw new Error("subscription unreadable");
    if (state !== "missing") want = wantOf(run, state);
  }
  const kept = same ? row!.current_period_end : null;
  const periodEnd = n.periodEnd && (!kept || n.periodEnd > kept) ? n.periodEnd : kept;
  await bind(run, user.id, { customerId: n.customerId, subscriptionId: n.subscriptionId, status: same ? row!.status : null, periodEnd });
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
  // Kept whether or not an account is bound yet, so a checkout or invoice
  // notice that arrives after it grants nothing for the charge.
  await run.db.prepare("INSERT INTO payment_reversals (charge_id, customer_id, why, at) VALUES (?, ?, ?, ?) ON CONFLICT(charge_id) DO NOTHING")
    .bind(n.chargeId, customerId, n.why, run.at).run();
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
// here: the period moves forward before the payment is taken. Nor is a move
// up: the items change before the payment is taken, so an update naming
// Ultra raises nothing, and invoice.paid raises the plan once it is paid. A
// move down (the subscription's product ranks below its live row's) is
// applied at once, keeping the row's end (lowerTo).
async function onSubscription(run: Run, s: SubscriptionState, deleted: boolean): Promise<void> {
  const status = deleted ? "canceled" : s.status;
  const user = await userFor(run.db, s.id, s.customerId, s.userId);
  if (!user) return unmatched(deleted ? "customer.subscription.deleted" : "customer.subscription.updated");
  const { bound, before } = await bind(run, user.id, { customerId: s.customerId, subscriptionId: s.id, status, periodEnd: s.periodEnd });
  if (ENDS_PRO.has(status)) return endNow(run, user, s.id, status);
  if (bound && before?.status !== status) await audit(run.env, user.id, "plan_changed", `stripe status ${status.slice(0, 40)}`, run.now);
  await lowerTo(run, user, s.id, planOfSubscription(run.env, s));
}
