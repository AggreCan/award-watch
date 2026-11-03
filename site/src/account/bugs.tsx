// Bug reports, a Pro feature (bug_reports in entitlements.ts): a form under
// the account that stores what went wrong on a page and sends it to the
// operator's inbox. routes.tsx mounts the two routes behind the guards every
// account route has: the switch, the session, and Origin and CSRF on the
// post; limits.ts counts the post with the forms (FORM_LIMIT). The site
// offers self-service and no support line, so the page promises no reply;
// fixes show up on the site.
//
// A report keeps the page (a path on the site), what happened and what was
// expected, as typed, with the user id and the time. Five per user in any
// 24 hours, counted inside the insert so posts sent together cannot pass
// the cap. Rows go after BUG_REPORT_DAYS (signin.ts, sweep) and with the
// account (routes.tsx, deleteAccount).
//
// The message takes the daily check's path (watchdog.ts): the ALERTS binding,
// from ALERT_FROM to ALERT_EMAIL, a destination verified in the zone's Email
// Routing. MAIL, the readers' sender, is not used. The message carries the
// report, the plan and the user id, never the account's address. A message
// that cannot be sent leaves the report stored, a log line with the binding's
// error code alone, and the outcome in the audit row's detail.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { isOwnAddress } from "../api";
import type { AppEnv, Env } from "../env";
import { t, tj, type Key, type Lang } from "../i18n";
import { PageHead, Panel } from "../layout";
import { audit } from "./audit";
import { allowed } from "./entitlements";
import { accountPage } from "./pages";
import { newId } from "./secrets";
import { errorTag } from "./sender";
import type { Account } from "./session";
import { BUG_REPORT_DAYS } from "./signin";

export const BUG_PAGE_MAX = 300;
export const BUG_TEXT_MAX = 2000;
export const BUG_EXPECTED_MAX = 1000;
export const BUG_REPORTS_PER_DAY = 5;
export const BUG_SUBJECT = "Bug report from a Pro account";
const DAY_MS = 86_400_000;
// What a pasted full address may run to before it is read as a path.
const PAGE_TYPED_MAX = 2100;

// Control characters other than tab and line breaks carry nothing a report
// needs. A browser sends a textarea's line breaks as CRLF, which would count
// each one twice against the length, so they become LF first.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function typed(fields: Record<string, string>, key: string, max: number): string {
  const v = fields[key];
  return (typeof v === "string" ? v : "").replace(/\r\n?/g, "\n").replace(CONTROL_RE, "").trim().slice(0, max);
}

const PATH_BASE = "https://path.invalid";

// A page address as a path on the site: a path, or a full address on the
// site's own host, kept as its path and query. Under /account the path is
// kept alone, in any case of letters, since a query there can hold a secret
// (a sign-in link's token, a delivery's stop link). Null for anything else,
// or past BUG_PAGE_MAX.
export function pagePath(raw: string, requestUrl: string): string | null {
  let url: URL;
  try {
    if (raw.startsWith("/")) {
      url = new URL(raw, PATH_BASE);
      // "//host" and "/\host" read as another host.
      if (url.origin !== PATH_BASE) return null;
    } else {
      url = new URL(raw);
      if (!isOwnAddress(url.href, requestUrl)) return null;
    }
  } catch {
    return null;
  }
  const lower = url.pathname.toLowerCase();
  const account = lower === "/account" || lower.startsWith("/account/");
  const path = account ? url.pathname : `${url.pathname}${url.search}`;
  return path.length <= BUG_PAGE_MAX ? path : null;
}

// The page the reader came from, when the browser says it was one of the
// site's own (the referrer policy keeps the full address on the site's
// pages); empty otherwise, and for the form itself.
function refererPage(c: Context<AppEnv>): string {
  const referer = c.req.header("referer");
  if (!referer || !isOwnAddress(referer, c.req.url)) return "";
  const path = pagePath(referer, c.req.url);
  return path && path !== "/account/bug" ? path : "";
}

// -- the pages -----------------------------------------------------------------------

type Values = { page: string; text: string; expected: string };

const AccountButton: FC<{ lang: Lang }> = ({ lang }) => <a href="/account" class="btn">{t(lang, "account.title")}</a>;

const Corrections: FC<{ lang: Lang }> = ({ lang }) => (
  <p class="muted small">{tj(lang, "bugs.corrections", { form: <a href="/corrections">{t(lang, "bugs.corrections_link")}</a> })}</p>
);

// A Free account: what the form is part of, and the billing page's link.
export function proView(lang: Lang) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "bugs.title")} actions={<AccountButton lang={lang} />} />
      <Panel title={t(lang, "bugs.pro_title")}>
        <p>{t(lang, "bugs.pro_text")}</p>
        <p><a href="/account/billing">{t(lang, "billing.link_plans")}</a></p>
        <Corrections lang={lang} />
      </Panel>
    </>
  );
}

export function formView(lang: Lang, account: Account, values: Values, errors: Key[] = []) {
  const vars = { n: BUG_REPORTS_PER_DAY, max: BUG_PAGE_MAX };
  return (
    <>
      <PageHead lang={lang} title={t(lang, "bugs.title")} lead={t(lang, "bugs.lead")} actions={<AccountButton lang={lang} />}>
        <p class="page-note">{t(lang, "bugs.no_reply")}</p>
      </PageHead>
      <Panel title={t(lang, "bugs.panel")} class="panel-form">
        {errors.length ? <ul class="errors" role="alert">{errors.map((e) => <li>{t(lang, e, vars)}</li>)}</ul> : null}
        <form method="post" action="/account/bug" class="stack">
          <input type="hidden" name="csrf" value={account.csrf} />
          <input type="hidden" name="lang" value={lang} />
          <label>
            {t(lang, "bugs.page")}
            <input name="page" type="text" maxlength={BUG_PAGE_MAX} spellcheck={false} autocomplete="off"
              placeholder="/tenders?segment=43" value={values.page} />
            <span class="muted small">{t(lang, "bugs.page_note")}</span>
          </label>
          <label>
            {t(lang, "bugs.text")}
            <textarea name="text" rows={6} required maxlength={BUG_TEXT_MAX}>{values.text}</textarea>
          </label>
          <label>
            {t(lang, "bugs.expected")}
            <textarea name="expected" rows={3} maxlength={BUG_EXPECTED_MAX}>{values.expected}</textarea>
          </label>
          <button type="submit" class="btn btn-primary">{t(lang, "bugs.send")}</button>
        </form>
        <p class="muted small">{t(lang, "bugs.kept", { days: BUG_REPORT_DAYS })}</p>
        <Corrections lang={lang} />
      </Panel>
    </>
  );
}

export function sentView(lang: Lang) {
  return (
    <PageHead lang={lang} title={t(lang, "bugs.sent_title")} lead={t(lang, "bugs.sent_lead")} actions={<AccountButton lang={lang} />}>
      <p class="page-note">{t(lang, "bugs.no_reply")}</p>
    </PageHead>
  );
}

// -- storing and sending -------------------------------------------------------------

export type BugReport = { id: string; userId: string; plan: string; lang: Lang; page: string | null; text: string; expected: string | null };

// One insert, held to BUG_REPORTS_PER_DAY in the 24 hours before it inside
// the statement. False when the cap is reached.
async function store(env: Env, r: BugReport, now: Date): Promise<boolean> {
  const res = await env.ACCOUNTS!.prepare(
    "INSERT INTO bug_reports (id, user_id, page, text, expected, created_at) " +
    "SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM bug_reports WHERE user_id = ? AND created_at > ?) < ?",
  ).bind(
    r.id, r.userId, r.page, r.text, r.expected, now.toISOString(), r.userId, new Date(now.getTime() - DAY_MS).toISOString(), BUG_REPORTS_PER_DAY,
  ).run();
  return (res.meta?.changes ?? 0) === 1;
}

// Base64 in lines of 76: a report may hold accented letters and a line of
// 2,000 characters, longer than a line of mail may be.
function base64Lines(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return (btoa(binary).match(/.{1,76}/g) ?? []).join("\r\n");
}

// The message to the operator, plain text, in the shape of the daily check's
// (watchdog.ts buildEmail). The subject is fixed; every value a user typed
// sits in the body, so none can reach a header.
export function bugMail(from: string, to: string, r: BugReport, now: Date): string {
  const none = "(none given)";
  const body = [
    `Bug report ${r.id}, received ${now.toISOString().slice(0, 16)} UTC.`,
    "",
    `Page: ${r.page ?? none}`,
    `Plan: ${r.plan}`,
    `User id: ${r.userId}`,
    `Language: ${r.lang}`,
    "",
    "What happened:",
    r.text,
    "",
    "What was expected:",
    r.expected ?? none,
    "",
    "This message is sent by the site's bug report form. The report is also kept in the accounts database (bug_reports).",
  ].join("\n").replace(/\n/g, "\r\n");
  return [
    `From: Award Watch <${from}>`,
    `To: ${to}`,
    `Subject: ${BUG_SUBJECT}`,
    `Date: ${now.toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(body),
  ].join("\r\n");
}

export type Sent = "sent" | "failed" | "not_configured";

async function sendToOperator(env: Env, r: BugReport, now: Date): Promise<Sent> {
  const to = (env.ALERT_EMAIL ?? "").trim();
  const from = (env.ALERT_FROM ?? "").trim();
  if (!env.ALERTS || !to || !from) {
    console.log("bug report: not sent, no email binding or address configured");
    return "not_configured";
  }
  try {
    const { EmailMessage } = await import("cloudflare:email");
    await env.ALERTS.send(new EmailMessage(from, to, bugMail(from, to, r, now)));
    return "sent";
  } catch (e) {
    console.log(`bug report: not sent (${errorTag(e)})`);
    return "failed";
  }
}

// -- the routes' handlers (routes.tsx) -----------------------------------------------

export function bugPage(c: Context<AppEnv>, who: Account): Promise<Response> {
  const lang = c.get("lang");
  if (!allowed(who, "bug_reports")) return accountPage(c, t(lang, "bugs.title"), proView(lang));
  return accountPage(c, t(lang, "bugs.title"), formView(lang, who, { page: refererPage(c), text: "", expected: "" }));
}

export async function fileBug(c: Context<AppEnv>, who: Account, fields: Record<string, string>): Promise<Response> {
  const lang = c.get("lang");
  if (!allowed(who, "bug_reports")) return accountPage(c, t(lang, "bugs.title"), proView(lang), 403);
  const typedPage = typed(fields, "page", PAGE_TYPED_MAX);
  const values: Values = { page: typedPage, text: typed(fields, "text", BUG_TEXT_MAX), expected: typed(fields, "expected", BUG_EXPECTED_MAX) };
  const page = typedPage ? pagePath(typedPage, c.req.url) : null;
  const errors: Key[] = [];
  if (typedPage && !page) errors.push("bugs.err_page");
  if (!values.text) errors.push("bugs.err_text");
  if (errors.length) return accountPage(c, t(lang, "bugs.title"), formView(lang, who, values, errors), 400);
  const now = new Date();
  const report: BugReport = {
    id: newId(), userId: who.userId, plan: who.plan, lang, page, text: values.text, expected: values.expected || null,
  };
  if (!(await store(c.env, report, now))) {
    return accountPage(c, t(lang, "bugs.title"), formView(lang, who, values, ["bugs.err_limited"]), 429);
  }
  const sent = await sendToOperator(c.env, report, now);
  await audit(c.env, who.userId, "bug_reported", sent, now);
  return accountPage(c, t(lang, "bugs.sent_title"), sentView(lang));
}
