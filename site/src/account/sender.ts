// The mail sender for sign-in messages (and, in phase 2, saved-search
// deliveries). Callers build a MailMessage and call send(); which sender
// answers is decided here alone, so a provider slots in without touching a
// caller.
//
//   log       development and tests: the message goes to the sent_mail table
//             of the local accounts database (seed/accounts_dev.sql), or to
//             the console when the table is missing. Chosen only when
//             MAIL_SENDER is "log" AND the request came to a local host, so a
//             variable set by mistake on the account cannot write a code to a
//             table or a log there.
//   stub      production until a provider exists: records the attempt in
//             the audit trail (no address, no code) and answers not sent,
//             and the page says the message could not be sent.
//   provider  an HTTP API that takes a key (the Worker secret MAIL_API_KEY)
//             and sends from a verified domain (MAIL_FROM). providerSender()
//             returns null until one is written; docs/accounts.md lists the
//             operator's steps.

import type { Env } from "../env";
import { t, type Lang } from "../i18n";
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

// The provider goes here: a Sender whose send() posts the message to the
// provider's HTTP API with env.MAIL_API_KEY, from env.MAIL_FROM, answers
// { sent: true } on the provider's acceptance and { sent: false, reason:
// "failed" } otherwise (logging the status, never the message). Until one is
// written this returns null and the stub answers.
export function providerSender(env: Env): Sender | null {
  if (!env.MAIL_API_KEY || !env.MAIL_FROM) return null;
  return null;
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
