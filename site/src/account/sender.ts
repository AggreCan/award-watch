// The mail sender for sign-in messages (and, in phase 2, saved-search
// deliveries). Callers build a MailMessage and call send(); which sender
// answers is decided here alone, so no caller knows how mail leaves.
//
//   log       development and tests: the message goes to the sent_mail table
//             of the local accounts database (seed/accounts_dev.sql), or to
//             the console when the table is missing. Chosen only when
//             MAIL_SENDER is "log" AND the request came to a local host, so a
//             variable set by mistake on the account cannot write a code to a
//             table or a log there.
//   provider  Cloudflare Email Sending through the Worker's MAIL binding,
//             from MAIL_FROM on the domain onboarded for it
//             (docs/accounts.md). No third-party service and no key: the
//             binding is the credential.
//   stub      production while the MAIL binding or MAIL_FROM is missing:
//             records the attempt in the audit trail (no address, no code)
//             and answers not sent, and the page says the message could not
//             be sent.

import type { Env } from "../env";
import { t, type Lang } from "../i18n";
import { CONTACT_EMAIL } from "../pages/docs";
import { SITE_ORIGIN } from "../seo";
import { audit } from "./audit";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  lang: Lang;
}

export type SendResult = { sent: true } | { sent: false; reason: "not_configured" | "failed" };

export interface Sender {
  readonly kind: "log" | "stub" | "provider";
  send(message: MailMessage): Promise<SendResult>;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocalHost(requestUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(requestUrl).hostname);
  } catch {
    return false;
  }
}

export function logSender(env: Env): Sender {
  return {
    kind: "log",
    async send(m) {
      try {
        await env.ACCOUNTS!.prepare(
          "INSERT INTO sent_mail (to_addr, subject, text, html, lang, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(m.to, m.subject, m.text, m.html, m.lang, new Date().toISOString()).run();
      } catch {
        console.log(`[log sender] to ${m.to}: ${m.subject}\n${m.text}`);
      }
      return { sent: true };
    },
  };
}

export function stubSender(env: Env): Sender {
  return {
    kind: "stub",
    async send() {
      await audit(env, null, "mail_not_sent", "stub");
      return { sent: false, reason: "not_configured" };
    },
  };
}

const FROM_NAME = "Award Watch";

// What a failed send leaves in the log: the binding's error code
// (E_SENDER_NOT_VERIFIED, E_DAILY_LIMIT_EXCEEDED, ...) or the error's name.
// Never the message text, which can quote the recipient's address; the
// shape check keeps anything else out too.
function errorTag(e: unknown): string {
  if (e && typeof e === "object") {
    for (const field of ["code", "name"] as const) {
      const value = (e as Record<string, unknown>)[field];
      if (typeof value === "string" && /^[A-Za-z0-9_]{1,64}$/.test(value)) return value;
    }
  }
  return "unknown";
}

// Null when the binding or the sending address is missing, so the stub
// answers. A reply goes to the contact address the site's documents print
// rather than to the sending address. Auto-Submitted marks the message as
// machine-sent, so mail servers send no out-of-office reply to it.
export function providerSender(env: Env): Sender | null {
  const mail = env.MAIL;
  const from = env.MAIL_FROM?.trim();
  if (!mail || !from) return null;
  return {
    kind: "provider",
    async send(m) {
      try {
        await mail.send({
          from: { email: from, name: FROM_NAME },
          to: m.to,
          replyTo: CONTACT_EMAIL,
          subject: m.subject,
          text: m.text,
          html: m.html,
          headers: { "Auto-Submitted": "auto-generated" },
        });
        return { sent: true };
      } catch (e) {
        console.log(`[mail] not sent: ${errorTag(e)}`);
        return { sent: false, reason: "failed" };
      }
    },
  };
}

export function senderFor(env: Env, requestUrl: string): Sender {
  if (env.MAIL_SENDER === "log" && isLocalHost(requestUrl)) return logSender(env);
  return providerSender(env) ?? stubSender(env);
}

// -- the sign-in message ------------------------------------------------------
//
// The markup is design/email's sign-in template, the one the review sheet
// (design/email/build.py) shows: a 600 px column of tables with every style
// inline, since some clients drop <style> for some senders; no web font,
// since most clients ignore one and loading it is a third-party request; and
// no image but the two hosted wordmarks, since Gmail strips SVG. The <style>
// block holds only what cannot be inline: the dark-mode overrides that Apple
// Mail and iOS Mail honour (Gmail inverts colours on its own, and the palette
// survives that) and the narrow-screen padding. A change here belongs in
// design/email/build.py too, so the sheet keeps showing what is sent.

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const FONT = "'Inter', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const C = {
  page: "#f8fafc", panel: "#ffffff", head: "#eef2f7", border: "#e2e8f0", border2: "#cbd5e1",
  ink: "#0f172a", ink2: "#334155", muted: "#5b6b80", accent: "#0f7b4f", darkInk: "#e5edf7",
} as const;

// The chip rule has no use in the sign-in message; it stays so the phase-2
// digests can share this block unchanged.
const DARK_RULES: [string, string][] = [
  [".bg", "background:#0b1220!important"],
  [".card", "background:#111a2b!important;border-color:#243044!important"],
  [".ink, .ink a", `color:${C.darkInk}!important`],
  [".ink2", "color:#c7d2e0!important"],
  [".muted, .muted a", "color:#8da0b8!important"],
  [".band", "background:#17233a!important;border-color:#2b3a52!important"],
  [".rule", "border-color:#243044!important"],
  [".btn", `background:${C.darkInk}!important`],
  [".btn a", `color:${C.ink}!important`],
  [".chip", "border-color:#3b4a63!important;color:#c7d2e0!important"],
  [".logo-light", "display:none!important"],
  [".logo-dark", "display:block!important"],
];

const HEAD_CSS = `
  body{margin:0;padding:0;background:${C.page};}
  table{border-collapse:collapse;}
  img{border:0;outline:none;text-decoration:none;}
  @media (prefers-color-scheme: dark){ ${DARK_RULES.map(([sel, rule]) => `${sel}{${rule}}`).join("")} }
  @media only screen and (max-width:620px){ .wrap{width:100%!important;} .pad{padding-left:18px!important;padding-right:18px!important;} }
`;

// Two PNGs at 2x of 142 by 20 CSS pixels, served from the site's /brand/
// (written by brand/make_wordmark_png.py), with the name as the text a client
// that shows no images prints instead. The light one is ink on a baked white
// ground, so a client that darkens the page and leaves images alone (the
// Gmail apps) still shows it as a white tab; the dark one is light ink on a
// transparent ground, swapped in by the clients that honour the dark query.
// Both arguments arrive escaped.
function wordmark(site: string, name: string): string {
  const img = (cls: string, file: string, display: string, color: string) =>
    `<img class="${cls}" src="${site}/brand/${file}" width="142" height="20" alt="${name}" ` +
    `style="display:${display};border:0;width:142px;height:20px;font:700 18px ${FONT};color:${color};">`;
  return `<a href="${site}" style="text-decoration:none;">` +
    img("logo-light", "wordmark.png", "block", C.ink) + img("logo-dark", "wordmark-dark.png", "none", C.darkInk) + "</a>";
}

interface Shell {
  lang: Lang;
  site: string;
  subject: string;
  preheader: string;
  body: string;
  why: string;
  tagline: string;
}

// Every value but body (markup built from escaped parts) is escaped here.
// The preheader is the line an inbox lists after the subject; the message
// itself hides it.
function shell(o: Shell): string {
  const site = escapeHtml(o.site);
  const home = escapeHtml(o.lang === "fr" ? `${o.site}/?lang=fr` : o.site);
  const host = escapeHtml(o.site.replace(/^https?:\/\//, ""));
  const contact = escapeHtml(CONTACT_EMAIL);
  return `<!DOCTYPE html>
<html lang="${escapeHtml(o.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(o.subject)}</title>
<style>${HEAD_CSS}</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${C.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="wrap card" style="width:600px;max-width:600px;background:${C.panel};border:1px solid ${C.border};">
  <tr><td class="pad" style="padding:18px 28px 14px 28px;border-bottom:2px solid ${C.accent};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="logo" style="vertical-align:middle;color:${C.ink};">${wordmark(site, escapeHtml(t(o.lang, "site.name")))}</td>
      <td align="right" class="muted" style="vertical-align:middle;font:13px/1 ${FONT};color:${C.muted};"><a href="${home}" style="color:${C.muted};text-decoration:none;">${host}</a></td>
    </tr></table>
  </td></tr>
  <tr><td class="pad" style="padding:24px 28px 8px 28px;">${o.body}</td></tr>
  <tr><td class="pad rule" style="padding:14px 28px 20px 28px;border-top:1px solid ${C.border};">
    <p class="muted" style="margin:0 0 6px 0;font:12px/1.5 ${FONT};color:${C.muted};">${escapeHtml(o.why)}</p>
    <p class="muted" style="margin:0;font:12px/1.5 ${FONT};color:${C.muted};">${escapeHtml(o.tagline)} · <a href="mailto:${contact}" style="color:${C.muted};">${contact}</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

function heading(text: string): string {
  return `<h1 class="ink" style="margin:0 0 12px 0;font:700 20px/1.3 ${FONT};color:${C.ink};">${escapeHtml(text)}</h1>`;
}

function para(text: string, cls: "ink2" | "muted", size: number): string {
  return `<p class="${cls}" style="margin:0 0 14px 0;font:${size}px/1.5 ${FONT};color:${C[cls]};">${escapeHtml(text)}</p>`;
}

// The code in a ruled band; the label makes a screen reader read it digit by
// digit rather than as a number.
function codeBand(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;"><tr>
  <td class="band" align="center" style="background:${C.head};border:1px solid ${C.border2};padding:18px;">
    <span class="ink" role="text" aria-label="${escapeHtml(code.split("").join(" "))}" style="font:700 30px/1 ${FONT};letter-spacing:0.22em;color:${C.ink};font-variant-numeric:tabular-nums;">${escapeHtml(code)}</span>
  </td>
</tr></table>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px 0;"><tr>
  <td class="btn" style="background:${C.ink};"><a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 18px;font:600 14px/1 ${FONT};color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a></td>
</tr></table>`;
}

// The code and the link, in the language of the page the request came from.
// The subject and the preheader carry neither, so a notification preview
// shows no code. site is where the wordmarks and the header link point: the
// link's own base, so a local run shows its own images.
export function signInMessage(
  lang: Lang, to: string, code: string, link: string, minutes: number, site: string = SITE_ORIGIN,
): MailMessage {
  const subject = t(lang, "account.mail_subject");
  const title = t(lang, "account.mail_heading");
  const notAsked = t(lang, "account.mail_not_asked");
  const why = t(lang, "account.mail_why");
  const tagline = `${t(lang, "site.name")} · ${t(lang, "site.tagline")}`;
  const body = [
    heading(title),
    para(t(lang, "account.mail_lead", { minutes }), "ink2", 15),
    codeBand(code),
    button(link, t(lang, "account.mail_button")),
    para(notAsked, "muted", 13),
  ].join("");
  const html = shell({ lang, site, subject, preheader: t(lang, "account.mail_preheader"), body, why, tagline });
  const text = [
    title, "",
    code, "",
    t(lang, "account.mail_text_link"), link, "",
    t(lang, "account.mail_text_expiry", { minutes }), "",
    notAsked, "",
    why, tagline, CONTACT_EMAIL, "",
  ].join("\n");
  return { to, subject, text, html, lang };
}
