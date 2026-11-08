// The accounts-open message: the one message the email lists' sign-up
// promised (the Email lists page, the privacy page), sent once to each address
// on the lists that holds no account. The operator starts it from the console
// (/admin/announce, admin.tsx), at most ANNOUNCE_MAX messages a run, and runs
// it again until no address is left; nothing sends it on a schedule.
//
// The addresses are the interest table's, in the forms database (DB): each
// address with a row not unsubscribed and no row marked (the Ultra card's
// rows aside, which are the Ultra message's; see below), read in address
// order from a cursor, so a run moves past an address it passes over or that
// the mail service refuses. An address holding an active account (the
// accounts database's users) is passed over: its lists were offered to it at
// sign-in already. Before its message goes, an address is claimed: one
// statement sets notice_at on its rows only while none of them has one, so
// two runs at once send it once; a send that does not go gives the claim
// back, and the address waits for the next run. A daily or rate limit of the
// mail service ends the run there.
//
// The message is in the site's one mail shell (mail_html.ts), in the
// language of the address's first sign-up: accounts are open, the lists it
// signed up for, that signing in with the address offers them as saved
// searches, the sign-in page as the button, and the link that takes the
// address off the lists. That link is /interest/stop?t=<token of the address's first row>,
// also in List-Unsubscribe with its one-click partner (RFC 8058). It works
// whatever the accounts switch says, since leaving the lists must never
// depend on it: the GET shows the lists and a button and changes nothing, so
// a mail scanner that opens it removes nothing; the POST, or a mail client's
// one-click POST, marks every row of the address unsubscribed and replaces
// the address with "removed:" and a hash under a random salt that is thrown
// away, which is what the privacy page promises.
//
// The Ultra message is the second kind of run (kind "ultra", started from
// /admin/announce?kind=ultra, never on a schedule): one message to each
// address the landing page's Ultra card kept (the rows of kind ULTRA_KIND,
// pages/landing.tsx), saying Ultra is open, with a link to the plans and the
// same link off the lists. Each kind reads, claims and marks its own rows
// only: the accounts-open message every row but the Ultra card's, the Ultra
// message those alone, so one never marks the other's rows and an address on
// both gets each once. An address holding an account is not passed over for
// the Ultra message, since it asked for that message on the card.

import type { Context } from "hono";
import { readForm } from "../body";
import { loadStats } from "../data";
import type { AppEnv, Env } from "../env";
import { t, tn, type Lang } from "../i18n";
import { Layout, PageHead, Panel, page } from "../layout";
import { CONTACT_EMAIL } from "../pages/docs";
import { ULTRA_KIND } from "../pages/interest";
import { STOP_CODES, sendWithHeaders } from "./deliveries";
import { deliveryHeaders } from "./digests";
import { button, escapeHtml, list, mutedLink, para, shell } from "./mail_html";
import { randomHex, sha256Hex } from "./secrets";
import type { MailMessage } from "./sender";

export const ANNOUNCE_MAX = 300;
// Addresses read at a time: each page's two IN lists stay under D1's 100 bound values.
export const PAGE_SIZE = 50;
// Lists named in a message; a line counts the rest.
export const LISTS_SHOWN = 10;

// The two messages a run can send; "accounts" when nothing names one.
export const ANNOUNCE_KINDS = ["accounts", "ultra"] as const;
export type AnnounceKind = (typeof ANNOUNCE_KINDS)[number];
export const announceKindOf = (v: unknown): AnnounceKind => (v === "ultra" ? "ultra" : "accounts");

// -- the forms database --------------------------------------------------------------------

// The rows each kind reads, claims and marks. ULTRA_KIND is a fixed word of
// the site's, never a visitor's, so it is written into the statements.
const SCOPE: Record<AnnounceKind, string> = { accounts: `kind <> '${ULTRA_KIND}'`, ultra: `kind = '${ULTRA_KIND}'` };

// Each waiting address's first live row of the kind's, for its token and its
// language, in address order after ?1.
export const waitingSql = (kind: AnnounceKind): string =>
  "SELECT email, token, lang FROM interest WHERE id IN (" +
  `SELECT MIN(id) FROM interest WHERE unsubscribed_at IS NULL AND ${SCOPE[kind]} GROUP BY email HAVING MAX(notice_at) IS NULL) ` +
  "AND email > ?1 ORDER BY email LIMIT ?2";

export const countWaitingSql = (kind: AnnounceKind): string =>
  "SELECT COUNT(*) AS n FROM (SELECT email FROM interest WHERE unsubscribed_at IS NULL " +
  `AND ${SCOPE[kind]} GROUP BY email HAVING MAX(notice_at) IS NULL)`;

export const countSentSql = (kind: AnnounceKind): string =>
  `SELECT COUNT(DISTINCT email) AS n FROM interest WHERE notice_at IS NOT NULL AND ${SCOPE[kind]}`;

// The claim: every live row of the address and the kind marked, in one
// statement that holds only while none of those rows is.
export const claimSql = (kind: AnnounceKind): string =>
  `UPDATE interest SET notice_at = ?1 WHERE email = ?2 AND unsubscribed_at IS NULL AND ${SCOPE[kind]} ` +
  `AND NOT EXISTS (SELECT 1 FROM interest x WHERE x.email = ?2 AND x.${SCOPE[kind]} AND x.notice_at IS NOT NULL)`;

export const releaseSql = (kind: AnnounceKind): string =>
  `UPDATE interest SET notice_at = NULL WHERE email = ?1 AND notice_at = ?2 AND ${SCOPE[kind]}`;

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

type Waiting = { email: string; token: string; lang: string };

export type AnnounceCounts = { waiting: number; sent: number };

export async function announceCounts(env: Env, kind: AnnounceKind = "accounts"): Promise<AnnounceCounts> {
  const [waiting, sent] = await env.DB.batch<{ n: number }>([env.DB.prepare(countWaitingSql(kind)), env.DB.prepare(countSentSql(kind))]);
  return { waiting: Number(waiting.results?.[0]?.n ?? 0), sent: Number(sent.results?.[0]?.n ?? 0) };
}

// A database made before notice_at (pipeline/schema.sql) answers this until
// the column is added.
export const missingColumn = (e: unknown): boolean => /no such column/i.test(String((e as { message?: unknown })?.message ?? e));

async function accountHolders(env: Env, emails: string[]): Promise<Set<string>> {
  const res = await env.ACCOUNTS!.prepare(`SELECT email FROM users WHERE status = 'active' AND email IN (${marks(emails.length)})`)
    .bind(...emails).all<{ email: string }>();
  return new Set((res.results ?? []).map((r) => r.email));
}

// The lists the accounts-open message names: the Ultra card's row is not one.
async function listsOf(env: Env, emails: string[]): Promise<Map<string, string[]>> {
  const res = await env.DB.prepare(
    `SELECT email, label FROM interest WHERE unsubscribed_at IS NULL AND ${SCOPE.accounts} AND email IN (${marks(emails.length)}) ORDER BY email, id`,
  ).bind(...emails).all<{ email: string; label: string }>();
  const out = new Map<string, string[]>();
  for (const r of res.results ?? []) out.set(r.email, [...(out.get(r.email) ?? []), r.label]);
  return out;
}

// -- the message -------------------------------------------------------------------------------

// The site the links point at, where the shell's wordmarks load from and its
// header links: the origin of the message's first link, which announceLinks
// and ultraLinks build on the run's base.
const siteOf = (url: string): string => new URL(url).origin;

export type AnnounceLinks = { signIn: string; stop: string };

// The two links on the site in the address's language. base is the site's
// address (the request's own origin on a local run).
export function announceLinks(base: string, lang: Lang, token: string): AnnounceLinks {
  const fr = lang === "fr";
  return { signIn: `${base}/account/sign-in${fr ? "?lang=fr" : ""}`, stop: `${base}/interest/stop?t=${token}${fr ? "&lang=fr" : ""}` };
}

// The labels are the site's own (interestFilter wrote them), in the language
// of the form each list was saved from. List-Unsubscribe goes with an https
// stop link only, as Email Sending takes no other. The HTML part: the lead,
// the lists, the saved-search line, the sign-in page as the button, the
// only-message line with the link off the lists, and the shell's footer with
// why it came; the preheader is the saved-search line.
export function accountsOpenMessage(lang: Lang, to: string, labels: readonly string[], links: AnnounceLinks): MailMessage & { headers: Record<string, string> } {
  const shown = labels.slice(0, LISTS_SHOWN);
  const rest = labels.length - shown.length;
  const more = rest > 0 ? tn(lang, "announce.lists_more_one", "announce.lists_more_many", rest, { n: rest }) : null;
  const signIn = t(lang, "account.sign_in");
  const stop = t(lang, "announce.stop_link");
  const tagline = `${t(lang, "site.name")} · ${t(lang, "site.tagline")}`;
  const link = (label: string, url: string) => t(lang, "digest.text_link", { label, url });
  const text = [
    t(lang, "announce.lead"),
    [t(lang, "announce.lists"), ...shown.map((l) => `- ${l}`), ...(more ? [more] : [])].join("\n"),
    t(lang, "announce.saved"),
    link(signIn, links.signIn),
    `${t(lang, "announce.only")}\n${link(stop, links.stop)}`,
    `${t(lang, "announce.why")}\n${tagline}\n${CONTACT_EMAIL}\n`,
  ].join("\n\n");
  const subject = t(lang, "announce.subject");
  const body =
    para(escapeHtml(t(lang, "announce.lead"))) +
    para(escapeHtml(t(lang, "announce.lists"))) +
    list(shown) +
    (more ? para(escapeHtml(more)) : "") +
    para(escapeHtml(t(lang, "announce.saved"))) +
    button(links.signIn, signIn) +
    para(`${escapeHtml(t(lang, "announce.only"))} ${mutedLink(links.stop, stop)}`, true);
  const html = shell({
    lang, site: siteOf(links.signIn), subject, preheader: t(lang, "announce.saved"), body, why: escapeHtml(t(lang, "announce.why")),
  });
  const headers = links.stop.startsWith("https://") ? deliveryHeaders(links.stop) : {};
  return { to, subject, text, html, lang, headers };
}

export type UltraLinks = { plans: string; stop: string };

// The Ultra message's two links: the plans page and the link off the lists.
export function ultraLinks(base: string, lang: Lang, token: string): UltraLinks {
  const fr = lang === "fr";
  return { plans: `${base}/pro${fr ? "?lang=fr" : ""}`, stop: `${base}/interest/stop?t=${token}${fr ? "&lang=fr" : ""}` };
}

// The Ultra message: Ultra is open, the address asked to be told, the plans
// page as the button, the only-message line with the link off the lists, and
// the shell's footer with why it came; the preheader is the asked-to-be-told
// line. Every line is the site's own; nothing in it was typed by a visitor.
export function ultraOpenMessage(lang: Lang, to: string, links: UltraLinks): MailMessage & { headers: Record<string, string> } {
  const plans = t(lang, "announce.ultra_plans");
  const stop = t(lang, "announce.stop_link");
  const tagline = `${t(lang, "site.name")} · ${t(lang, "site.tagline")}`;
  const link = (label: string, url: string) => t(lang, "digest.text_link", { label, url });
  const text = [
    t(lang, "announce.ultra_lead"),
    t(lang, "announce.ultra_asked"),
    link(plans, links.plans),
    `${t(lang, "announce.ultra_only")}\n${link(stop, links.stop)}`,
    `${t(lang, "announce.ultra_why")}\n${tagline}\n${CONTACT_EMAIL}\n`,
  ].join("\n\n");
  const subject = t(lang, "announce.ultra_subject");
  const body =
    para(escapeHtml(t(lang, "announce.ultra_lead"))) +
    para(escapeHtml(t(lang, "announce.ultra_asked"))) +
    button(links.plans, plans) +
    para(`${escapeHtml(t(lang, "announce.ultra_only"))} ${mutedLink(links.stop, stop)}`, true);
  const html = shell({
    lang, site: siteOf(links.plans), subject, preheader: t(lang, "announce.ultra_asked"), body, why: escapeHtml(t(lang, "announce.ultra_why")),
  });
  const headers = links.stop.startsWith("https://") ? deliveryHeaders(links.stop) : {};
  return { to, subject, text, html, lang, headers };
}

// -- the run -------------------------------------------------------------------------------------

export interface AnnounceReport {
  sent: number;
  // Refused by the mail service for that address alone; it waits for the next run.
  failed: number;
  // Passed over: the address holds an active account (the accounts-open message only).
  accounts: number;
  // The limit code that ended the run, if one did.
  stopped: string | null;
  // Addresses that have not had it after the run, those holding an account included.
  left: number;
}

// One run of a kind's message: at most ANNOUNCE_MAX messages (max, which the
// tests lower). base is where the links point; requestUrl is the console
// request's, which picks the sender (sender.ts). A database fault is thrown
// to the console, which shows its 503 page; the addresses already sent keep
// their marks.
export async function runAnnouncement(
  env: Env, base: string, requestUrl: string, now = new Date(), max = ANNOUNCE_MAX, kind: AnnounceKind = "accounts",
): Promise<AnnounceReport> {
  const report: AnnounceReport = { sent: 0, failed: 0, accounts: 0, stopped: null, left: 0 };
  const at = now.toISOString();
  const ultra = kind === "ultra";
  let cursor = "";
  pages: while (report.sent + report.failed < max) {
    const waiting = (await env.DB.prepare(waitingSql(kind)).bind(cursor, PAGE_SIZE).all<Waiting>()).results ?? [];
    if (!waiting.length) break;
    cursor = waiting[waiting.length - 1].email;
    const emails = waiting.map((w) => w.email);
    // The Ultra message names no list and passes over no account holder, so it reads neither.
    const [holders, lists] = ultra
      ? [new Set<string>(), new Map<string, string[]>()]
      : await Promise.all([accountHolders(env, emails), listsOf(env, emails)]);
    for (const w of waiting) {
      if (holders.has(w.email)) {
        report.accounts++;
        continue;
      }
      if (report.sent + report.failed >= max) break pages;
      const claimed = await env.DB.prepare(claimSql(kind)).bind(at, w.email).run();
      // Another run has it, or the address left the lists since the page was read.
      if (!claimed.meta?.changes) continue;
      const lang: Lang = w.lang === "fr" ? "fr" : "en";
      const message = ultra
        ? ultraOpenMessage(lang, w.email, ultraLinks(base, lang, w.token))
        : accountsOpenMessage(lang, w.email, lists.get(w.email) ?? [], announceLinks(base, lang, w.token));
      const result = await sendWithHeaders(env, requestUrl, message);
      if (result.sent) {
        report.sent++;
        continue;
      }
      await env.DB.prepare(releaseSql(kind)).bind(w.email, at).run();
      if (result.code && STOP_CODES.has(result.code)) {
        report.stopped = result.code;
        break pages;
      }
      report.failed++;
    }
    if (waiting.length < PAGE_SIZE) break;
  }
  report.left = (await announceCounts(env, kind)).waiting;
  return report;
}

// -- leaving the lists: /interest/stop ---------------------------------------------------------------

const TOKEN_RE = /^[0-9a-f]{32}$/;
const LABELS_MAX = 25;

type StopTarget = { email: string; live: boolean; lists: { kind: string; label: string }[] };

// The address a token belongs to, and its lists while it is on them; null
// for a token that matches no row.
async function stopTarget(env: Env, token: string): Promise<StopTarget | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = await env.DB.prepare("SELECT email, unsubscribed_at FROM interest WHERE token = ? LIMIT 1").bind(token)
    .first<{ email: string; unsubscribed_at: string | null }>();
  if (!row) return null;
  if (row.unsubscribed_at) return { email: row.email, live: false, lists: [] };
  const res = await env.DB.prepare(`SELECT kind, label FROM interest WHERE email = ? AND unsubscribed_at IS NULL ORDER BY id LIMIT ${LABELS_MAX}`)
    .bind(row.email).all<{ kind: string; label: string }>();
  return { email: row.email, live: true, lists: res.results ?? [] };
}

// A list as the page names it: its label, but the Ultra card's row (whose
// label is the plan's name alone) says what it is for.
const listName = (lang: Lang, list: { kind: string; label: string }) => (list.kind === ULTRA_KIND ? t(lang, "interest.ultra_listed") : list.label);

// Every row of the address: unsubscribed (the time kept where one was
// already set) and the address replaced, so the rows still count in the
// nightly's totals and prove nothing about whose they were. The rows of one
// address differ in kind or filter, so one replacement keeps them unique.
export async function removeAddress(env: Env, email: string, now = new Date()): Promise<void> {
  const tomb = `removed:${await sha256Hex(`${randomHex(32)}\n${email}`)}`;
  await env.DB.prepare("UPDATE interest SET unsubscribed_at = COALESCE(unsubscribed_at, ?1), email = ?2 WHERE email = ?3")
    .bind(now.toISOString(), tomb, email).run();
}

async function stopPage(c: Context<AppEnv>, title: string, body: unknown, status = 200): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  const res = await page(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats?.data_as_of ?? null}
      seo={{ path: "/interest/stop", description: t(lang, "announce.stop_title"), noindex: true }}>
      {body as any}
    </Layout>,
    status,
  );
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

function unavailable(c: Context<AppEnv>, e: unknown): Promise<Response> {
  console.error(`interest stop: ${String(e).slice(0, 120)}`);
  const lang = c.get("lang");
  return stopPage(c, t(lang, "announce.stop_title"),
    <PageHead lang={lang} title={t(lang, "announce.stop_title")} lead={t(lang, "form.err_unavailable")} />, 503);
}

function stopView(lang: Lang, token: string, target: StopTarget) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "announce.stop_title")} lead={t(lang, target.live ? "announce.stop_lead" : "announce.stopped_lead")} />
      {target.live ? (
        <Panel title={t(lang, "announce.stop_panel")} class="panel-form">
          <ul class="account-list">{target.lists.map((l) => <li>{listName(lang, l)}</li>)}</ul>
          <form method="post" action="/interest/stop" class="stack">
            <input type="hidden" name="t" value={token} />
            <input type="hidden" name="lang" value={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "announce.stop_button")}</button>
          </form>
        </Panel>
      ) : null}
    </>
  );
}

// GET /interest/stop?t=: the lists and a button; changes nothing.
export async function interestStopPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const token = c.req.query("t") ?? "";
  let target: StopTarget | null;
  try {
    target = await stopTarget(c.env, token);
  } catch (e) {
    return unavailable(c, e);
  }
  if (!target) return c.notFound();
  return stopPage(c, t(lang, target.live ? "announce.stop_title" : "announce.stopped_title"), stopView(lang, token, target));
}

// POST /interest/stop: the button's form, or a mail client's one-click post
// (the body List-Unsubscribe=One-Click, the token in the address), which
// comes from the mail provider's servers with no Origin of the site: the
// token is the proof, and it can only take that one address off.
export async function interestStopPost(c: Context<AppEnv>): Promise<Response> {
  const form = await readForm(c);
  if (!form.ok) return c.text(t(c.get("lang"), "form.rejected"), form.status);
  const fields = form.fields;
  if (fields.lang === "en" || fields.lang === "fr") c.set("lang", fields.lang);
  const lang = c.get("lang");
  const token = (typeof fields.t === "string" ? fields.t.trim() : "") || (c.req.query("t") ?? "");
  const oneClick = fields["List-Unsubscribe"] === "One-Click";
  let target: StopTarget | null;
  try {
    target = await stopTarget(c.env, token);
    if (target?.live) await removeAddress(c.env, target.email);
  } catch (e) {
    return unavailable(c, e);
  }
  if (!target) return c.notFound();
  if (oneClick) {
    c.header("Cache-Control", "no-store");
    return c.text(t(lang, "announce.stopped_one_click"), 200);
  }
  return stopPage(c, t(lang, "announce.stopped_title"),
    <PageHead lang={lang} title={t(lang, "announce.stopped_title")} lead={t(lang, "announce.stopped_lead")} />);
}
