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

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// The code and the link, in the language of the page the request came from.
// The subject carries neither, so a notification preview shows no code.
export function signInMessage(lang: Lang, to: string, code: string, link: string, minutes: number): MailMessage {
  const lines = [
    t(lang, "account.mail_code", { code }),
    t(lang, "account.mail_link"),
    link,
    t(lang, "account.mail_expiry", { minutes }),
    t(lang, "account.mail_ignore"),
  ];
  const html = [
    `<p>${escapeHtml(t(lang, "account.mail_code", { code: "" })).trim()} <strong style="font-size:20px;letter-spacing:2px">${code}</strong></p>`,
    `<p>${escapeHtml(t(lang, "account.mail_link"))}<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    `<p>${escapeHtml(t(lang, "account.mail_expiry", { minutes }))}</p>`,
    `<p>${escapeHtml(t(lang, "account.mail_ignore"))}</p>`,
  ].join("\n");
  return { to, subject: t(lang, "account.mail_subject"), text: lines.join("\n\n"), html, lang };
}
