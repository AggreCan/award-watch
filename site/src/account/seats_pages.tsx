// The seats' pages (docs/accounts.md, Seats), behind the seats' switch
// (seats.ts seatsOn; routes.tsx answers the site's 404 for every address
// under /account/seats and /account/seat while it is off, before anything is
// read). routes.tsx checks the session, the CSRF value and the Origin and
// hands each page and post here:
//
//   GET  /account/seats                the holder's Seats page, or a member's seat (seatsPage)
//   POST /account/seats/invite         an invitation, its message, its run row (invitePost)
//   POST /account/seats/:id/cancel     cancel an open invitation (cancelPost)
//   GET  /account/seats/:id/remove     what removing a member does (removeConfirm)
//   POST /account/seats/:id/remove     remove the member (removePost)
//   GET  /account/seats/join?i=&t=     the invitation's page; uses nothing up (joinPage)
//   POST /account/seats/join           take the seat or decline it (joinPost)
//   GET  /account/seat/leave           what leaving does (leaveConfirm)
//   POST /account/seat/leave           leave the seat (leavePost)
//
// Counts, never content: the holder's page reads its own seats rows, its
// members' addresses (it typed them) and the pool's counts by account
// (pool.ts POOL_COUNTS_SQL over the group its own session read gave); a
// member's reads the same counts over its own group and shows the totals and
// its own. No statement takes an account id from a form. The join page's What
// Fits is the pool's own rule (pool.ts allowanceIn over readPool), so it
// says what the pool then serves. The join page's GET writes nothing at all:
// it reads the holder's plan without bringing its cache up to date (planFor
// with write false), and it offers Take the seat only where the take could
// pass (the holder's plan has a seat for it, the holder is not blocked, the
// window's joins are not spent), so the GET and the take say the same.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import type { AppEnv } from "../env";
import { mailCeiling } from "../env";
import { fmtInt, t, tn, type Key, type Lang } from "../i18n";
import { PageHead, Panel } from "../layout";
import { EMAIL_MAX, normalizeEmail } from "../pages/interest";
import { PlanCards, ULTRA_OWN_ROWS, checkoutPrice, planCards, type PlanReader, ultraCheckoutPrice, ultraLines } from "../pro";
import { KEYS_MAX } from "./api_keys";
import { audit } from "./audit";
import { sharedCap } from "./briefings";
import { boardCap } from "./dashboard_rule";
import { dayRoom, writeInviteRun } from "./deliveries";
import { type Group, PLAN_SEATS, type Plan, isPaidPlan, memberSeats, planFor, savedViewCap, watchCap } from "./entitlements";
import { FEEDS_MAX } from "./feeds";
import { siteLink } from "./mail_html";
import { accountPage, unavailableView } from "./pages";
import { POOL_FIGURES, POOL_SLOTS, type Pool, type PoolFigure, allowanceIn, poolOf, poolOwn, poolTotal, readPool } from "./pool";
import { THINGS } from "./pool_lines";
import { isBlocked } from "./admin_ops";
import {
  type HolderSeats, type Invitation, type InviteRefusal, SEAT_INVITE_DAYS, cancelInvitation, declineInvitation, dropInvitation, holderSeats,
  invite, joinsAllowed, joinsInWindow, leaveSeat, readInvitation, removeSeat, seatMember, seatsInUse, seatsOn, takeSeat,
} from "./seats";
import { breakable } from "./seats_lines";
import { inviteMessage, senderFor } from "./sender";
import { type Account, readSession } from "./session";

export const SEATS_PATH = "/account/seats";
export const LEAVE_PATH = "/account/seat/leave";

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;
const clean = (v: string | undefined, max: number) => (typeof v === "string" ? v : "").replace(CONTROL_RE, "").trim().slice(0, max);

// A plan's name as a line says it: "Free", "Pro", "Ultra".
const planWord = (lang: Lang, plan: Plan): string =>
  plan === "ultra" ? t(lang, "ultra.tag") : plan === "pro" ? t(lang, "pro.tag") : t(lang, "account.plan_free");

// "1 seat", "5 seats": a plan's own figure.
const seatWords = (lang: Lang, n: number): string => t(lang, n === 1 ? "seats.seat_one" : "seats.seat_many", { n: fmtInt(n, lang) });

// The plan whose seats an account gives: its own, which is the plan the
// session read gave unless the account holds a seat (then the plan is the
// seat's, or its own while the seat gives nothing, and it gives no seat of
// its own either way: a member never invites).
const ownPlan = (who: Pick<Account, "plan" | "seat">): Plan | null => (who.seat ? null : who.plan);

// Each pooled figure's figure on a plan, from the helpers the pool's pages and
// the delivery run hold it with (pool.ts's callers): the shared figure of the
// searches and briefings, the watches, the views, the dashboards, the keys and
// the calendar feeds.
export function poolCap(plan: Plan, figure: PoolFigure): number {
  switch (figure) {
    case "searches": return sharedCap(plan);
    case "watches": return watchCap(plan);
    case "views": return savedViewCap(plan);
    case "dashboards": return boardCap(plan);
    case "keys": return KEYS_MAX;
    case "feeds": return FEEDS_MAX;
  }
}

// A pooled figure's name at the head of a row: the pool's own words, a capital first.
const figureName = (lang: Lang, figure: PoolFigure): string => {
  const s = t(lang, THINGS[figure]);
  return s.charAt(0).toLocaleUpperCase(lang === "fr" ? "fr-CA" : "en-CA") + s.slice(1);
};

const Notice: FC<{ message?: string | null }> = ({ message }) => (message ? <p class="account-notice" role="status">{message}</p> : null);
const Lines: FC<{ lines?: readonly string[] }> = ({ lines }) =>
  lines?.length ? <ul class="errors" role="alert">{lines.map((l) => <li>{l}</li>)}</ul> : null;
const Csrf: FC<{ account: Account }> = ({ account }) => <input type="hidden" name="csrf" value={account.csrf} />;
const langQuery = (lang: Lang) => (lang === "fr" ? "?lang=fr" : "");

// -- the overview's row and the billing page's link ------------------------------------------

// What the overview's Seats row says, while the switch is on: a member's own
// seat; a holder's seats in use against its plan's (the live seats and the
// open invitations, with its own) for a plan with member seats; or, for an
// account that still gives seats its plan does not hold (a holder that moved
// down or lapsed), that it does. null for every other account, and with the
// switch off, reading nothing.
export type SeatsRow = { kind: "member" } | { kind: "holder"; n: number; cap: number } | { kind: "fewer" };

export async function seatsRow(c: Context<AppEnv>, who: Account, now: Date = new Date()): Promise<SeatsRow | null> {
  if (!(await seatsOn(c.env, now))) return null;
  if (who.seat) return { kind: "member" };
  const used = await seatsInUse(c.env, who.userId, now);
  if (memberSeats(who.plan) > 0) return { kind: "holder", n: 1 + used, cap: PLAN_SEATS[who.plan] };
  return used > 0 ? { kind: "fewer" } : null;
}

// -- the delete page ---------------------------------------------------------------------------------

// What the delete page says of seats, while the switch is on: the address of
// the subscription whose seat the account holds (its own session's, read
// nothing), or how many seats the account gives (its live seats and open
// invitations, one statement), each ended with the account (seats.ts
// endSeatsOf). Nothing, and nothing read, while the switch is off or for an
// account with no seat on either side.
export async function deleteSeatFacts(c: Context<AppEnv>, who: Account, now: Date = new Date()): Promise<{ holder?: string; gives?: number }> {
  if (!(await seatsOn(c.env, now))) return {};
  if (who.seat) return { holder: who.seat.holderEmail };
  const gives = await seatsInUse(c.env, who.userId, now);
  return gives > 0 ? { gives } : {};
}

// -- the pool's table ------------------------------------------------------------------------------

type PoolColumn = { label: string; id: string };

// One row a pooled figure: its total against the plan's figure, then each
// column's own count (the holder's and each member's for the holder, the
// member's own for a member). Counts only. A column is headed by a person's
// address, so on a phone its label runs before its value rather than in the
// narrow label column (public/styles.css .seats-pool), and an address breaks
// only where the line cannot hold it whole.
const PoolTable: FC<{ lang: Lang; pool: Pool; plan: Plan; columns: readonly PoolColumn[] }> = ({ lang, pool, plan, columns }) => (
  <div class="table-wrap">
    <table class="restack seats-pool">
      <thead>
        <tr>
          <th>{t(lang, "seats.pool_col_figure")}</th>
          <th class="num">{t(lang, "seats.pool_col_total")}</th>
          {columns.map((col) => <th class="num">{breakable(col.label)}</th>)}
        </tr>
      </thead>
      <tbody>
        {POOL_FIGURES.map((figure) => (
          <tr>
            <td>{figureName(lang, figure)}</td>
            <td data-label={t(lang, "seats.pool_col_total")} class="num">
              {t(lang, "seats.pool_total", { n: fmtInt(poolTotal(pool, figure), lang), cap: fmtInt(poolCap(plan, figure), lang) })}
            </td>
            {columns.map((col) => <td data-label={col.label} class="num">{fmtInt(poolOwn(pool, figure, col.id), lang)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// How many items the group holds past the figures, all figures together.
const pastFigures = (pool: Pool, plan: Plan): number =>
  POOL_FIGURES.reduce((n, figure) => n + Math.max(0, poolTotal(pool, figure) - poolCap(plan, figure)), 0);

// -- the holder's page --------------------------------------------------------------------------------

type HolderState = {
  plan: Plan; seats: HolderSeats; group: Group | null; pool: Pool | null; notice?: string | null; errors?: string[];
  email?: string; inviteLang?: Lang; cards?: unknown;
};

function holderView(lang: Lang, who: Account, s: HolderState) {
  const room = memberSeats(s.plan);
  const covered = new Set(s.group?.ids.slice(1) ?? []);
  // Live seats the plan does not cover now (more people than its member seats): in the seats table, not in the pool's.
  const outside = s.seats.seats.filter((r) => !covered.has(r.member_id)).length;
  const used = 1 + s.seats.seats.length + s.seats.invitations.length;
  const emailOf = new Map(s.seats.seats.map((r) => [r.member_id, r.member_email]));
  // A plan with fewer seats than the account gives: Pro holds one; no paid plan holds none.
  const fewer = room === 0 && (s.seats.seats.length > 0 || s.seats.invitations.length > 0);
  return (
    <>
      <PageHead lang={lang} title={t(lang, "seats.title")} lead={t(lang, "seats.lead")}
        actions={<a href={`/account${langQuery(lang)}`} class="btn">{t(lang, "account.title")}</a>} />
      <Notice message={s.notice} />
      <Lines lines={s.errors} />
      {room === 0 ? (
        <p>{t(lang, "seats.pro_text", {
          pro_seats: seatWords(lang, PLAN_SEATS.pro), ultra_seats: seatWords(lang, PLAN_SEATS.ultra), others: fmtInt(memberSeats("ultra"), lang),
        })}</p>
      ) : null}
      {fewer ? (
        <p>{isPaidPlan(s.plan)
          ? t(lang, "seats.fewer", { plan: planWord(lang, s.plan), seats: seatWords(lang, PLAN_SEATS[s.plan]) })
          : t(lang, "seats.lapsed")}</p>
      ) : null}
      {room > 0 || fewer ? (
        <Panel title={t(lang, "seats.panel_seats")} count={tn(lang, "seats.count_one", "seats.count", used, { n: fmtInt(used, lang), cap: fmtInt(PLAN_SEATS[s.plan], lang) })}>
          <div class="table-wrap">
            <table class="restack">
              <thead>
                <tr>
                  <th>{t(lang, "seats.col_person")}</th><th>{t(lang, "seats.col_seat")}</th><th>{t(lang, "seats.col_since")}</th>
                  <th><span class="visually-hidden">{t(lang, "seats.col_action")}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t(lang, "seats.you", { email: who.email })}</td>
                  <td data-label={t(lang, "seats.col_seat")}>{t(lang, "seats.state_yours")}</td>
                  <td data-label={t(lang, "seats.col_since")} class="mono"></td>
                  <td></td>
                </tr>
                {s.seats.seats.map((r) => (
                  <tr>
                    <td>{r.member_email}</td>
                    <td data-label={t(lang, "seats.col_seat")}>{t(lang, covered.has(r.member_id) ? "seats.state_taken" : "seats.state_uncovered")}</td>
                    <td data-label={t(lang, "seats.col_since")} class="mono">{day(r.joined_at)}</td>
                    <td>
                      <a href={`${SEATS_PATH}/${r.id}/remove${langQuery(lang)}`} aria-label={`${t(lang, "seats.remove")} (${r.member_email})`}>
                        {t(lang, "seats.remove")}
                      </a>
                    </td>
                  </tr>
                ))}
                {s.seats.invitations.map((r) => (
                  <tr>
                    <td>{r.email}</td>
                    <td data-label={t(lang, "seats.col_seat")}>{t(lang, "seats.state_invited", { date: day(r.expires_at) })}</td>
                    <td data-label={t(lang, "seats.col_since")} class="mono">{day(r.invited_at)}</td>
                    <td>
                      <form method="post" action={`${SEATS_PATH}/${r.id}/cancel`} class="account-inline">
                        <Csrf account={who} />
                        <input type="hidden" name="lang" value={lang} />
                        <button type="submit" class="btn-link" aria-label={`${t(lang, "seats.cancel")} (${r.email})`}>{t(lang, "seats.cancel")}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {room > 0 ? (
            <p class="muted small">{t(lang, "seats.rule_joins", { n: fmtInt(joinsAllowed(s.plan), lang), used: fmtInt(s.seats.joins, lang) })}</p>
          ) : null}
        </Panel>
      ) : null}
      {s.pool && s.group ? (
        <Panel title={t(lang, "seats.pool_title")}>
          <p>{t(lang, "seats.pool_lead")}</p>
          {pastFigures(s.pool, s.plan) > 0 ? <p>{t(lang, "seats.pool_over", { n: fmtInt(pastFigures(s.pool, s.plan), lang) })}</p> : null}
          <PoolTable lang={lang} pool={s.pool} plan={s.plan} columns={[
            { label: t(lang, "seats.you", { email: who.email }), id: who.userId },
            ...s.group.ids.slice(1).map((id) => ({ label: emailOf.get(id) ?? "", id })),
          ]} />
          {outside > 0 ? <p class="muted small">{t(lang, "seats.pool_uncovered")}</p> : null}
        </Panel>
      ) : null}
      {room > 0 ? (
        <Panel title={t(lang, "seats.invite_title")} class="panel-form" id="invite">
          <p>{t(lang, "seats.invite_lead", { days: fmtInt(SEAT_INVITE_DAYS, lang) })}</p>
          <form method="post" action={`${SEATS_PATH}/invite`} class="stack">
            <Csrf account={who} />
            <input type="hidden" name="lang" value={lang} />
            <label>
              {t(lang, "seats.email")}
              <input name="email" type="email" required maxlength={EMAIL_MAX} autocomplete="off" spellcheck={false} value={s.email ?? ""} />
            </label>
            <label>
              {t(lang, "seats.lang")}
              <select name="message_lang">
                {(["en", "fr"] as const).map((l) => (
                  <option value={l} selected={(s.inviteLang ?? lang) === l}>{t(lang, l === "fr" ? "account.mail_lang_fr" : "account.mail_lang_en")}</option>
                ))}
              </select>
            </label>
            <button type="submit" class="btn btn-primary">{t(lang, "seats.send")}</button>
          </form>
        </Panel>
      ) : null}
      {s.cards ? <Panel title={t(lang, "billing.panel_plans")}>{s.cards as any}</Panel> : null}
    </>
  );
}

// -- a member's page ---------------------------------------------------------------------------------

function memberView(lang: Lang, who: Account, pool: Pool | null, notice: string | null) {
  const seat = who.seat!;
  const holder = seat.holderEmail;
  return (
    <>
      <PageHead lang={lang} title={t(lang, "seats.title")} lead={t(lang, "seats.lead")}
        actions={<a href={`/account${langQuery(lang)}`} class="btn">{t(lang, "account.title")}</a>} />
      <Notice message={notice} />
      <Panel title={t(lang, "seat.title")}>
        <p>{seat.covered ? t(lang, "seat.covered", { holder }) : t(lang, "seat.uncovered", { holder, plan: planWord(lang, who.plan) })}</p>
        {seat.covered ? null : <p>{t(lang, "seat.saved", { plan: planWord(lang, who.plan) })}</p>}
        <p>{t(lang, "seat.sees", { holder })}</p>
        <p>{t(lang, "seat.billing")}</p>
        <p><a href={`${LEAVE_PATH}${langQuery(lang)}`} class="btn">{t(lang, "seat.leave")}</a></p>
      </Panel>
      {pool && who.group ? (
        <Panel title={t(lang, "seat.pool_title")}>
          <p>{t(lang, "seat.pool_lead", { holder })}</p>
          <PoolTable lang={lang} pool={pool} plan={who.plan} columns={[{ label: t(lang, "seat.pool_col_yours"), id: who.userId }]} />
        </Panel>
      ) : null}
    </>
  );
}

// The Seats page for the account the session names: a member's seat, or the
// account's own seats as a holder (with the plan cards for a plan with no
// member seats). notice and errors are lines already in the page's language.
export async function seatsPage(
  c: Context<AppEnv>, who: Account, extra: { notice?: string | null; errors?: string[]; status?: number; email?: string; inviteLang?: Lang } = {},
): Promise<Response> {
  const lang = c.get("lang");
  const now = new Date();
  const m = c.req.query("m");
  const notice = extra.notice ?? (
    m === "cancelled" ? t(lang, "seats.msg_cancelled")
      : m === "left" && !who.seat ? t(lang, "seat.msg_left", { plan: planWord(lang, who.plan) })
      : m === "taken" && who.seat?.covered ? t(lang, "join.msg_taken")
      : null
  );
  if (who.seat) return accountPage(c, t(lang, "seats.title"), memberView(lang, who, await poolOf(c.env, who), notice), extra.status ?? 200);
  const plan = who.plan;
  const [seats, pool] = await Promise.all([holderSeats(c.env, who.userId, now), poolOf(c.env, who)]);
  // A plan with no member seats: the plans, Ultra's card with its own figures while it is on sale.
  const cards = memberSeats(plan) === 0
    ? <PlanCards lang={lang} plans={planCards(lang, {
      price: checkoutPrice(c.env), ultra: await ultraCheckoutPrice(c.env), reader: plan as PlanReader, place: "tease",
    })} />
    : null;
  const view = holderView(lang, who, {
    plan, seats, group: who.group ?? null, pool, notice, errors: extra.errors, email: extra.email, inviteLang: extra.inviteLang, cards,
  });
  return accountPage(c, t(lang, "seats.title"), view, extra.status ?? 200);
}

function unavailable(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  return accountPage(c, t(lang, "account.unavailable_title"), unavailableView(lang), 503);
}

// -- an invitation ------------------------------------------------------------------------------------

// A refusal's line, with the figures it names.
function refusalLine(lang: Lang, r: InviteRefusal, email: string, plan: Plan): string {
  switch (r.why) {
    case "member": return t(lang, "seats.err_member", { email });
    case "open": return t(lang, "seats.err_open", { email });
    case "full": return t(lang, "seats.err_full", { cap: fmtInt(PLAN_SEATS[plan], lang) });
    case "joins": return t(lang, "seats.err_joins", { n: fmtInt(r.n, lang), date: r.date });
    case "day": return t(lang, "seats.err_day", { n: fmtInt(r.n, lang) });
    case "address": return t(lang, "seats.err_address", { n: fmtInt(r.n, lang) });
  }
}

// POST /account/seats/invite: from a holder whose own plan has member seats,
// its session read from the database now (routes.tsx refuses one remembered
// through an outage). In order, nothing written before each: the address in
// form, not the holder's own; the day's mail ceiling has room (dayRoom); the
// insert with its six refusals (seats.ts invite). Then the message, through
// the sign-in message's path (senderFor), and the run row that counts it
// against the day's ceiling; a message that did not go removes the
// invitation. The page is drawn in this answer, not after a redirect, since
// its line names the address; posting it again finds the invitation waiting.
export async function invitePost(c: Context<AppEnv>, who: Account, fields: Record<string, string>, base: string): Promise<Response> {
  const lang = c.get("lang");
  const now = new Date();
  const plan = ownPlan(who);
  if (!plan || memberSeats(plan) === 0) return seatsPage(c, who, { status: 403 });
  const inviteLang: Lang | null = fields.message_lang === "fr" ? "fr" : fields.message_lang === "en" ? "en" : null;
  if (!inviteLang) return c.text(t(lang, "form.rejected"), 400);
  const typed = clean(fields.email, EMAIL_MAX + 50);
  const email = normalizeEmail(typed);
  const again = (line: string, status: number) => seatsPage(c, who, { errors: [line], email: typed.slice(0, EMAIL_MAX), inviteLang, status });
  if (!email) return again(t(lang, "interest.err_email"), 400);
  if (email === who.email) return again(t(lang, "seats.err_self"), 409);
  const ceiling = mailCeiling(c.env);
  if (ceiling && (await dayRoom(c.env, ceiling, now)) === 0) return again(t(lang, "seats.err_today"), 429);
  const made = await invite(c.env, { userId: who.userId, plan }, email, inviteLang, now);
  if (!("ok" in made)) return again(refusalLine(lang, made, email, plan), 409);
  const link = siteLink(base, `${SEATS_PATH}/join?i=${made.id}&t=${made.secret}`, inviteLang);
  const sent = await senderFor(c.env, c.req.url)
    .send(inviteMessage(inviteLang, email, who.email, link, made.expiresAt, base))
    .catch(() => ({ sent: false, reason: "failed" }) as const);
  await writeInviteRun(c.env, now, sent.sent);
  if (!sent.sent) {
    await dropInvitation(c.env, who.userId, made.id);
    if (sent.reason === "failed") await audit(c.env, who.userId, "mail_failed", null, now);
    return again(t(lang, "seats.err_send"), 503);
  }
  await audit(c.env, who.userId, "seat_invited", null, now);
  return seatsPage(c, who, { notice: t(lang, "seats.msg_sent", { email }) });
}

// POST /account/seats/:id/cancel: the same answer whatever the id names.
export async function cancelPost(c: Context<AppEnv>, who: Account, id: string): Promise<Response> {
  if (await cancelInvitation(c.env, who.userId, id)) await audit(c.env, who.userId, "seat_cancelled");
  return c.redirect(`${SEATS_PATH}?m=cancelled${c.get("lang") === "fr" ? "&lang=fr" : ""}`, 303);
}

// -- removing a member ----------------------------------------------------------------------------------

export async function removeConfirm(c: Context<AppEnv>, who: Account, id: string): Promise<Response> {
  const lang = c.get("lang");
  const email = await seatMember(c.env, who.userId, id);
  if (!email) return c.redirect(`${SEATS_PATH}${langQuery(lang)}`, 303);
  return accountPage(c, t(lang, "seats.remove_title", { email }), (
    <>
      <PageHead lang={lang} title={t(lang, "seats.remove_title", { email })} />
      <Panel title={t(lang, "seats.title")} class="panel-form">
        <p>{t(lang, "seats.remove_text", { email })}</p>
        <form method="post" action={`${SEATS_PATH}/${id}/remove`} class="account-actions">
          <Csrf account={who} />
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="confirm" value="yes" />
          <button type="submit" class="btn btn-primary">{t(lang, "seats.remove_confirm")}</button>
          <a href={`${SEATS_PATH}${langQuery(lang)}`} class="btn">{t(lang, "seats.keep")}</a>
        </form>
      </Panel>
    </>
  ));
}

export async function removePost(c: Context<AppEnv>, who: Account, id: string, fields: Record<string, string>): Promise<Response> {
  const lang = c.get("lang");
  if (fields.confirm !== "yes") return c.redirect(`${SEATS_PATH}/${id}/remove${langQuery(lang)}`, 303);
  const email = await removeSeat(c.env, who.userId, id);
  if (!email) return c.redirect(`${SEATS_PATH}${langQuery(lang)}`, 303);
  await audit(c.env, who.userId, "seat_removed");
  // The session was read before the removal: the page reads the plan again, so the group it shows is the one left.
  const plan = await planFor(c.env, { id: who.userId, plan: who.plan === "ultra" ? "pro" : who.plan, plan_until: who.planUntil });
  const after: Account = { ...who, plan: plan.plan, planUntil: plan.until, group: plan.group };
  if (!plan.group) delete after.group;
  return seatsPage(c, after, { notice: t(lang, "seats.msg_removed", { email }) });
}

// -- leaving a seat --------------------------------------------------------------------------------------

export async function leaveConfirm(c: Context<AppEnv>, who: Account): Promise<Response> {
  const lang = c.get("lang");
  if (!who.seat) return c.redirect(`${SEATS_PATH}${langQuery(lang)}`, 303);
  return accountPage(c, t(lang, "seat.leave_title"), (
    <>
      <PageHead lang={lang} title={t(lang, "seat.leave_title")} />
      <Panel title={t(lang, "seat.title")} class="panel-form">
        <p>{t(lang, "seat.leave_text", { holder: who.seat.holderEmail })}</p>
        <form method="post" action={LEAVE_PATH} class="account-actions">
          <Csrf account={who} />
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="confirm" value="yes" />
          <button type="submit" class="btn btn-primary">{t(lang, "seat.leave")}</button>
          <a href={`${SEATS_PATH}${langQuery(lang)}`} class="btn">{t(lang, "seats.keep")}</a>
        </form>
      </Panel>
    </>
  ));
}

export async function leavePost(c: Context<AppEnv>, who: Account, fields: Record<string, string>): Promise<Response> {
  const lang = c.get("lang");
  if (fields.confirm !== "yes") return c.redirect(`${LEAVE_PATH}${langQuery(lang)}`, 303);
  if (who.seat && (await leaveSeat(c.env, who.userId))) await audit(c.env, who.userId, "seat_left");
  return c.redirect(`${SEATS_PATH}?m=left${lang === "fr" ? "&lang=fr" : ""}`, 303);
}

// -- the invitation's page ---------------------------------------------------------------------------------

// What the join page shows of one figure: the account's own, how many would be
// in service, and how many saved and unavailable.
export type Fit = { figure: PoolFigure; own: number; fits: number; left: number };

// What would fit if the account took the seat now: the holder's group as its
// own plan reads it, the account placed after its members, and each figure's
// allowance by the pool's own rule (pool.ts allowanceIn over one
// POOL_COUNTS_SQL), the account's items by creation served first, as the pool
// then serves them. null when the take would refuse it now (join.no_room): the
// holder's plan has no seat for it, the holder is blocked, or the window's
// joins are spent, as TAKE_SQL and joinPost hold them. Reads the holder's plan
// (planFor with write false: a GET a link opens writes nothing at all), the
// block, the joins and the counts.
export async function whatFits(c: Context<AppEnv>, inv: Invitation, joiner: Account, now: Date = new Date()): Promise<Fit[] | null> {
  const holder = await planFor(c.env, { id: inv.holderId, plan: inv.holderPlan, plan_until: inv.holderUntil }, now, false);
  const plan: Plan = holder.seat ? "free" : holder.plan;
  const ids = holder.group?.ids ?? [inv.holderId];
  if (memberSeats(plan) === 0 || ids.length - 1 >= memberSeats(plan) || ids.length >= POOL_SLOTS) return null;
  if (await isBlocked(c.env, { id: inv.holderId })) return null;
  if ((await joinsInWindow(c.env, inv.holderId, now)) >= joinsAllowed(plan)) return null;
  const group: Group = { holderId: inv.holderId, ids: [...ids, joiner.userId], position: ids.length };
  const pool = await readPool(c.env.ACCOUNTS!, group);
  return POOL_FIGURES.map((figure) => {
    const own = poolOwn(pool, figure, joiner.userId);
    const fits = Math.min(own, allowanceIn(pool, group, figure, poolCap(plan, figure)));
    return { figure, own, fits, left: own - fits };
  });
}

type JoinState =
  | { kind: "stale" } | { kind: "out"; inv: Invitation; next: string } | { kind: "other"; inv: Invitation; you: string }
  | { kind: "own_plan"; inv: Invitation; who: Account; secret: string } | { kind: "seated"; inv: Invitation; who: Account; secret: string }
  | { kind: "no_room"; inv: Invitation; who: Account; secret: string } | { kind: "take"; inv: Invitation; who: Account; secret: string; fits: Fit[] }
  | { kind: "done"; message: string };

const JoinButtons: FC<{ lang: Lang; who: Account; inv: Invitation; secret: string; take: boolean }> = ({ lang, who, inv, secret, take }) => (
  <div class="account-actions">
    {take ? (
      <form method="post" action={`${SEATS_PATH}/join`}>
        <Csrf account={who} />
        <input type="hidden" name="lang" value={lang} />
        <input type="hidden" name="i" value={inv.id} />
        <input type="hidden" name="t" value={secret} />
        <input type="hidden" name="action" value="take" />
        <button type="submit" class="btn btn-primary">{t(lang, "join.take")}</button>
      </form>
    ) : null}
    <form method="post" action={`${SEATS_PATH}/join`}>
      <Csrf account={who} />
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="i" value={inv.id} />
      <input type="hidden" name="t" value={secret} />
      <input type="hidden" name="action" value="decline" />
      <button type="submit" class="btn">{t(lang, "join.decline")}</button>
    </form>
  </div>
);

function joinView(lang: Lang, s: JoinState) {
  if (s.kind === "stale" || s.kind === "done") {
    return (
      <>
        <PageHead lang={lang} title={t(lang, "join.title")} />
        <p class="account-notice" role="status">{s.kind === "stale" ? t(lang, "join.stale") : s.message}</p>
        <p><a href={`/account${langQuery(lang)}`} class="btn">{t(lang, "account.title")}</a></p>
      </>
    );
  }
  const holder = s.inv.holderEmail;
  const head = <PageHead lang={lang} title={t(lang, "join.title")} lead={t(lang, "join.lead", { holder, email: s.inv.email })} />;
  const what = <p>{t(lang, "join.what", { holder, lines: ultraLines(lang, SHARED_LINES).join("; ") })}</p>;
  if (s.kind === "out") {
    return (
      <>
        {head}
        <Panel title={t(lang, "join.what_title")}>{what}</Panel>
        <Panel title={t(lang, "account.email_panel")} class="panel-form">
          <p>{t(lang, "join.sign_in", { email: s.inv.email })}</p>
          <form method="post" action="/account/sign-in" class="stack">
            <input type="hidden" name="lang" value={lang} />
            <input type="hidden" name="next" value={s.next} />
            <label>
              {t(lang, "interest.email")}
              <input name="email" type="email" required maxlength={EMAIL_MAX} autocomplete="email" spellcheck={false} value={s.inv.email} />
            </label>
            <div class="hp"><label>{t(lang, "form.honeypot")}<input name="website" type="text" tabindex={-1} autocomplete="off" /></label></div>
            <button type="submit" class="btn btn-primary">{t(lang, "account.send_code")}</button>
          </form>
        </Panel>
      </>
    );
  }
  if (s.kind === "other") {
    return (
      <>
        {head}
        <p class="account-notice" role="status">{t(lang, "join.other", { email: s.inv.email, you: s.you })}</p>
      </>
    );
  }
  const line: Key | null = s.kind === "own_plan" ? "join.own_plan" : s.kind === "seated" ? "join.seated" : s.kind === "no_room" ? "join.no_room" : null;
  return (
    <>
      {head}
      <Panel title={t(lang, "join.what_title")}>{what}</Panel>
      {s.kind === "take" ? (
        <Panel title={t(lang, "join.room_title")}>
          {s.fits.some((f) => f.left > 0) ? (
            <>
              <p>{t(lang, "join.room_lead")}</p>
              <ul class="account-list">
                {s.fits.filter((f) => f.left > 0).map((f) => (
                  <li>{t(lang, "join.room_line", {
                    things: figureName(lang, f.figure), fits: fmtInt(f.fits, lang), own: fmtInt(f.own, lang), left: fmtInt(f.left, lang),
                  })}</li>
                ))}
              </ul>
            </>
          ) : <p>{t(lang, "join.room_none")}</p>}
        </Panel>
      ) : null}
      <Panel title={t(lang, "join.panel_answer")} class="panel-form">
        {line ? <p>{t(lang, line, { holder })}</p> : null}
        <JoinButtons lang={lang} who={s.who} inv={s.inv} secret={s.secret} take={s.kind === "take"} />
      </Panel>
    </>
  );
}

// The Ultra card's own lines that name a figure the subscription shares (pool.ts): the searches and briefings,
// the watches, the API keys, the saved views and the dashboards. The others (the analytics years, the matching
// notices, the views by email) are each person's, so join.what, which calls its lines the subscription's, leaves
// them out.
const SHARED_ROW_FEATURES: ReadonlySet<string> = new Set(["delivery", "watch_mail", "api", "saved_views", "dashboards"]);
const SHARED_LINES = ULTRA_OWN_ROWS.filter((r) => SHARED_ROW_FEATURES.has(r.feature)).map((r) => r.ultra.key);

const joinPageOf = (c: Context<AppEnv>, s: JoinState, status = 200) => accountPage(c, t(c.get("lang"), "join.title"), joinView(c.get("lang"), s), status);

// GET /account/seats/join?i=&t=: the link's secret first (a wrong, expired,
// used or cancelled one, or no such row, is join.stale, the same answer for
// each); then the reader. Nothing is used up and nothing of the invitation is
// written, so a mail scanner that opens the link changes nothing.
export async function joinPage(c: Context<AppEnv>): Promise<Response> {
  const i = c.req.query("i");
  const secret = c.req.query("t");
  const inv = await readInvitation(c.env, i, secret);
  if (!inv || !secret) return joinPageOf(c, { kind: "stale" }, 400);
  const read = await readSession(c);
  if (read.state === "unavailable") return unavailable(c);
  if (read.state !== "ok") return joinPageOf(c, { kind: "out", inv, next: `${SEATS_PATH}/join?i=${inv.id}&t=${secret}` });
  const who = read.account;
  if (who.email !== inv.email) return joinPageOf(c, { kind: "other", inv, you: who.email });
  if (who.seat) return joinPageOf(c, { kind: "seated", inv, who, secret });
  if (isPaidPlan(who.plan)) return joinPageOf(c, { kind: "own_plan", inv, who, secret });
  const fits = await whatFits(c, inv, who);
  return joinPageOf(c, fits ? { kind: "take", inv, who, secret, fits } : { kind: "no_room", inv, who, secret });
}

// POST /account/seats/join (session, CSRF, Origin checked): the link's secret
// again, the session's address the invitation's, then the action. Taking needs
// the session read from the database, no seat and no paid plan of the
// account's own, and the holder's own plan read now from the database (a
// remembered one through an outage grants nothing: the 503 page); then one
// statement takes it, counting the holder's seats and joins inside it.
export async function joinPost(c: Context<AppEnv>, who: Account, fields: Record<string, string>): Promise<Response> {
  const lang = c.get("lang");
  const now = new Date();
  const inv = await readInvitation(c.env, fields.i, fields.t, now);
  if (!inv) return joinPageOf(c, { kind: "stale" }, 400);
  if (who.email !== inv.email) return joinPageOf(c, { kind: "other", inv, you: who.email }, 403);
  const secret = fields.t!;
  if (fields.action === "decline") {
    if (!(await declineInvitation(c.env, inv, now))) return joinPageOf(c, { kind: "stale" }, 400);
    await audit(c.env, who.userId, "seat_declined", null, now);
    return joinPageOf(c, { kind: "done", message: t(lang, "join.msg_declined") });
  }
  if (fields.action !== "take") return c.text(t(lang, "form.rejected"), 400);
  if (who.stale) return unavailable(c);
  if (who.seat) return joinPageOf(c, { kind: "seated", inv, who, secret }, 409);
  if (isPaidPlan(who.plan)) return joinPageOf(c, { kind: "own_plan", inv, who, secret }, 409);
  const holder = await planFor(c.env, { id: inv.holderId, plan: inv.holderPlan, plan_until: inv.holderUntil }, now);
  if (holder.source !== "entitlements") return unavailable(c);
  const plan: Plan = holder.seat ? "free" : holder.plan;
  if (memberSeats(plan) === 0 || (await isBlocked(c.env, { id: inv.holderId }))) return joinPageOf(c, { kind: "no_room", inv, who, secret }, 409);
  const taken = await takeSeat(c.env, inv, who.userId, plan, now);
  if (taken === "taken") {
    await audit(c.env, who.userId, "seat_taken", null, now);
    return c.redirect(`${SEATS_PATH}?m=taken${lang === "fr" ? "&lang=fr" : ""}`, 303);
  }
  if (taken === "seated") return joinPageOf(c, { kind: "seated", inv, who, secret }, 409);
  if (taken === "no_room") return joinPageOf(c, { kind: "no_room", inv, who, secret }, 409);
  return joinPageOf(c, { kind: "stale" }, 400);
}
