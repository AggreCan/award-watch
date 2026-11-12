// The one shell every message the site sends to a reader is laid out in
// (docs/mail.md, "The shell"): the sign-in code, the saved-search
// deliveries, the records counts, the watch mail, the weekly briefing, the
// accounts-open and Ultra messages and the address-change notice. Built from
// design/email (build.py and its templates, approved by the operator): a
// 600 px column of tables with every style inline, since some clients drop
// <style> for some senders; no web font, since most clients ignore one and
// loading it is a third-party request; no image but the two hosted
// wordmarks, since Gmail strips SVG. The <style> block holds only what cannot
// be inline: the dark-mode overrides that Apple Mail and iOS Mail honour
// (Gmail inverts colours on its own, and the palette survives that) and the
// narrow-screen padding.
//
// Every message has the same parts in the same order: the hidden preheader
// (the line an inbox lists after the subject), the header (the wordmark
// linking the site, the host name linking the home page), the body, and the
// muted footer (why the message came, with its links, then the tagline and
// the contact address). The builders here are the body's pieces: the
// heading, the paragraph, the list, the button (one a message at most), the
// links. A change here belongs in design/email/build.py too, so the review
// sheet keeps showing what is sent; the mail suite (site/test-mail/) holds
// every message to the header and the footer.
//
// No image but the wordmarks and no address that differs per reader: every
// message loads the same two files from the site, so nothing here can tell
// who opened a message.

import { t, type Lang } from "../i18n";
import { CONTACT_EMAIL } from "../pages/docs";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// A link on the site in the message's language: the language middleware
// reads ?lang=, so a French reader lands on the French page.
export function siteLink(site: string, path: string, lang: Lang): string {
  if (lang !== "fr") return `${site}${path}`;
  return `${site}${path}${path.includes("?") ? "&" : "?"}lang=fr`;
}

export const C = {
  page: "#f8fafc", panel: "#ffffff", head: "#eef2f7", border: "#e2e8f0", border2: "#cbd5e1",
  ink: "#0f172a", ink2: "#334155", muted: "#5b6b80", accent: "#0f7b4f", amber: "#b45309",
};
export const FONT = "'Inter', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
// For what a reader copies or types character by character (the sign-in code).
export const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace";

// Overrides for a dark client, under the media query Apple Mail and iOS
// honour; Gmail inverts on its own and the palette survives it. A link
// carries its own inline colour, which a rule on the paragraph around it
// does not reach, so each text class names its links too (a paragraph
// link kept the light ink on the dark card until 2026-11-10); the mail
// suite holds every coloured link in every message to one of these rules.
const DARK_CSS = [
  ".bg{background:#0b1220!important}",
  ".card{background:#111a2b!important;border-color:#243044!important}",
  ".ink, .ink a{color:#e5edf7!important}",
  ".ink2, .ink2 a{color:#c7d2e0!important}",
  ".muted, .muted a{color:#8da0b8!important}",
  ".band{background:#17233a!important;border-color:#2b3a52!important}",
  ".rule{border-color:#243044!important}",
  ".btn{background:#e5edf7!important}",
  ".btn a{color:#0f172a!important}",
  ".chip{border-color:#3b4a63!important;color:#c7d2e0!important}",
  ".logo-light{display:none!important}",
  ".logo-dark{display:block!important}",
].join("");

// A client's reading of a message, light or dark, for the site's own view of
// one in a frame (MailView below).
export type MailScheme = "light" | "dark";

// The dark rules' line of the head: under the query, as every message that
// is sent carries them; for a view in a frame, the scheme forced, the rules
// applied as they stand (dark) or left out (light).
function darkRules(scheme?: MailScheme): string {
  if (scheme === "light") return "";
  return scheme === "dark" ? `\n  ${DARK_CSS}` : `\n  @media (prefers-color-scheme: dark){ ${DARK_CSS} }`;
}

const headCss = (scheme?: MailScheme) => `
  body{margin:0;padding:0;background:${C.page};}
  table{border-collapse:collapse;}
  img{border:0;outline:none;text-decoration:none;}${darkRules(scheme)}
  @media only screen and (max-width:620px){ .wrap{width:100%!important;} .pad{padding-left:18px!important;padding-right:18px!important;} }
`;
const HEAD_CSS = headCss();

// The two hosted wordmarks at 2x, 142 by 20 CSS pixels, served from the
// site's /brand/ (written by brand/make_wordmark_png.py): ink on a baked
// white ground for light clients and for the Gmail apps (which darken the
// page and leave images alone), light ink on a transparent ground for the
// clients that honour the dark query. The site's name is the text a client
// that shows no images prints instead.
function wordmark(site: string, name: string): string {
  return `<a href="${escapeHtml(site)}" style="text-decoration:none;">` +
    `<img class="logo-light" src="${escapeHtml(site)}/brand/wordmark.png" width="142" height="20" alt="${escapeHtml(name)}" ` +
    `style="display:block;border:0;width:142px;height:20px;font:700 18px ${FONT};color:${C.ink};">` +
    `<img class="logo-dark" src="${escapeHtml(site)}/brand/wordmark-dark.png" width="142" height="20" alt="${escapeHtml(name)}" ` +
    `style="display:none;border:0;width:142px;height:20px;font:700 18px ${FONT};color:#e5edf7;"></a>`;
}

// The host name the header prints, "awardwatch.ca" (or "localhost:8787" on a
// local run).
function hostOf(site: string): string {
  try {
    return new URL(site).host;
  } catch {
    return site.replace(/^https?:\/\//, "");
  }
}

export interface Shell {
  lang: Lang;
  // The site's address with no trailing slash: where the wordmarks load from
  // and the header links (the request's own origin on a local run).
  site: string;
  subject: string;
  // One line, escaped here.
  preheader: string;
  // Markup built from escaped parts.
  body: string;
  // The footer's first line, markup built from escaped parts (whyLine); empty
  // for a message with no reason line (the address-change notice).
  why: string;
  // Absent for every message that is sent. The public sample of the weekly
  // briefing (briefing_pages.tsx) shows its message in a frame on the site:
  // the same document with the reader's scheme forced, since a frame follows
  // the browser's scheme rather than the page's theme, and its links opening
  // a new tab, as a webmail client opens them, never inside the frame.
  view?: MailView;
}

export type MailView = { scheme: MailScheme };

export function shell(o: Shell): string {
  const host = hostOf(o.site);
  const home = siteLink(o.site, "/", o.lang);
  const tagline = `${escapeHtml(t(o.lang, "site.name"))} · ${escapeHtml(t(o.lang, "site.tagline"))}`;
  const why = o.why ? `\n    <p class="muted" style="margin:0 0 6px 0;font:12px/1.5 ${FONT};color:${C.muted};">${o.why}</p>` : "";
  const schemes = o.view ? o.view.scheme : "light dark";
  const base = o.view ? `\n<base target="_blank">` : "";
  return `<!DOCTYPE html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${schemes}">
<meta name="supported-color-schemes" content="${schemes}">
<title>${escapeHtml(o.subject)}</title>${base}
<style>${o.view ? headCss(o.view.scheme) : HEAD_CSS}</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${C.page};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${C.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" class="wrap card" style="width:600px;max-width:600px;background:${C.panel};border:1px solid ${C.border};">
  <tr><td class="pad" style="padding:18px 28px 14px 28px;border-bottom:2px solid ${C.accent};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="logo" style="vertical-align:middle;color:${C.ink};">${wordmark(o.site, t(o.lang, "site.name"))}</td>
      <td align="right" class="muted" style="vertical-align:middle;font:13px/1 ${FONT};color:${C.muted};"><a href="${escapeHtml(home)}" style="color:${C.muted};text-decoration:none;">${escapeHtml(host)}</a></td>
    </tr></table>
  </td></tr>
  <tr><td class="pad" style="padding:24px 28px 8px 28px;">${o.body}</td></tr>
  <tr><td class="pad rule" style="padding:14px 28px 20px 28px;border-top:1px solid ${C.border};">${why}
    <p class="muted" style="margin:0;font:12px/1.5 ${FONT};color:${C.muted};">${tagline} · <a href="mailto:${CONTACT_EMAIL}" style="color:${C.muted};">${CONTACT_EMAIL}</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

// The text part's last two lines: the tagline and the contact address.
export function textFooter(lang: Lang): string {
  return `${t(lang, "site.name")} · ${t(lang, "site.tagline")}\n${CONTACT_EMAIL}\n`;
}

// -- the body's pieces -------------------------------------------------------------------

export function h1(text: string): string {
  return `<h1 class="ink" style="margin:0 0 12px 0;font:700 20px/1.3 ${FONT};color:${C.ink};">${escapeHtml(text)}</h1>`;
}

// A part's heading inside one message (the records digest's two parts).
export function h2(text: string): string {
  return `<h2 class="ink" style="margin:18px 0 6px 0;font:700 16px/1.3 ${FONT};color:${C.ink};">${escapeHtml(text)}</h2>`;
}

// html is markup already escaped. A muted paragraph is the smaller note
// under a message's button, and the line with a list message's stop link.
export function para(html: string, muted = false): string {
  const cls = muted ? "muted" : "ink2";
  const size = muted ? 13 : 15;
  return `<p class="${cls}" style="margin:0 0 14px 0;font:${size}px/1.5 ${FONT};color:${muted ? C.muted : C.ink2};">${html}</p>`;
}

// A bulleted list of plain lines (the accounts-open message's lists), each
// item styled itself, since some clients drop what a list would inherit.
export function list(items: readonly string[]): string {
  const li = (s: string) => `<li class="ink2" style="margin:0 0 4px 0;font:15px/1.5 ${FONT};color:${C.ink2};">${escapeHtml(s)}</li>`;
  return `<ul style="margin:0 0 14px 0;padding:0 0 0 22px;">${items.map(li).join("")}</ul>`;
}

// The message's one call to act on: dark ink, square, no image.
export function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px 0;"><tr>
  <td class="btn" style="background:${C.ink};"><a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 18px;font:600 14px/1 ${FONT};color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a></td>
</tr></table>`;
}

// A link inside a body paragraph.
export function inkLink(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${C.ink2};">${escapeHtml(label)}</a>`;
}

// A link inside a muted line (the footer, a stop link's line).
export function mutedLink(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${C.muted};">${escapeHtml(label)}</a>`;
}

// The footer's first line: why the message came, then its links (the page
// that manages it, the stop link) after a dot each.
export function whyLine(reason: string, links: readonly { href: string; label: string }[] = []): string {
  if (!links.length) return escapeHtml(reason);
  return `${escapeHtml(reason)} ${links.map((l) => mutedLink(l.href, l.label)).join(" · ")}`;
}
