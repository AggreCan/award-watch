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
import { C, MONO, button, escapeHtml, h1, para, shell } from "./mail_html";

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
// shape check keeps anything else out too. bugs.tsx logs its failures by it.
export function errorTag(e: unknown): string {
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
// In the site's one mail shell (mail_html.ts), as design/email's sign-in
// template lays it out: the heading, the lead, the code in a ruled band, the
// button carrying the link, the note for a reader who did not ask, and the
// footer with the reason. A change here belongs in design/email/build.py too,
// so the review sheet (design/email/prototypes.html) keeps showing what is
// sent.

// The code in a ruled band, large and in a monospace face so no digit is
// taken for another; the label makes a screen reader read it digit by digit
// rather than as a number.
function codeBand(code: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0;"><tr>
  <td class="band" align="center" style="background:${C.head};border:1px solid ${C.border2};padding:18px;">
    <span class="ink" role="text" aria-label="${escapeHtml(code.split("").join(" "))}" style="font:700 32px/1 ${MONO};letter-spacing:0.2em;color:${C.ink};font-variant-numeric:tabular-nums;">${escapeHtml(code)}</span>
  </td>
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
    h1(title),
    para(escapeHtml(t(lang, "account.mail_lead", { minutes }))),
    codeBand(code),
    button(link, t(lang, "account.mail_button")),
    para(escapeHtml(notAsked), true),
  ].join("");
  const html = shell({ lang, site, subject, preheader: t(lang, "account.mail_preheader"), body, why: escapeHtml(why) });
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

// -- the address-change notice ------------------------------------------------
//
// Sent by the operator console when it changes an account's address
// (admin.tsx), in the account's language, in the mail shell: what changed,
// the sign-in page as the button, and the contact address for a reader who
// did not ask. It names no other address. base is the site's address, where
// the link and the shell's wordmarks point. The preheader is the body itself;
// the footer has no reason line, since the operator's change is the reason.
export function addressNotice(lang: Lang, to: string, base: string): MailMessage {
  const link = `${base}/account/sign-in${lang === "fr" ? "?lang=fr" : ""}`;
  const body = t(lang, "admin.mail_body");
  const signIn = t(lang, "admin.mail_sign_in", { link });
  const contact = t(lang, "admin.mail_contact", { contact: CONTACT_EMAIL });
  const subject = t(lang, "admin.mail_subject");
  const html = shell({
    lang, site: base, subject, preheader: body, why: "",
    body: para(escapeHtml(body)) + button(link, t(lang, "account.sign_in")) + para(escapeHtml(contact), true),
  });
  return { to, subject, text: `${body}\n\n${signIn}\n\n${contact}\n`, html, lang };
}
