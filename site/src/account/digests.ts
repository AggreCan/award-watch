// The delivery messages of phase 2, built from design/email (build.py and
// its digest and expiring templates, approved by the operator): the saved
// search's new tender notices, the contracts that entered a radar window,
// and, in the same shell, the records counts that rose for an organization,
// a buyer or a segment (with a segment's new tender notices). Each message
// has an HTML part laid out the way that design lays it out (a 600 px column
// of tables, every style inline, the two hosted wordmarks, dark rules under a
// media query) and a plain-text part shaped like its .txt files. Every string
// is in the dictionary, in the saved search's language.
//
// Nothing here reads a file or a database: deliveries.ts hands over the rows
// it chose and the links it made, so the messages can be tested on their own.

import { addDays, closingParts } from "../../public/closing.js";
import { closingTime } from "../closing";
import { CATEGORIES, PROVINCES, SEGMENTS } from "../constants";
import { type ExpiringRow, type TenderRow, publishedReference } from "../data";
import { categoryLabel, fmtInt, fmtMoney, pick, provinceName, segmentShort, sourceLabel, t, tn, type Key, type Lang } from "../i18n";
import { CONTACT_EMAIL } from "../pages/docs";
import { type ExpiringQuery, contractReference, sitePath } from "../pages/expiring";
import { CODE_RE } from "../pages/tenders";
import { fiscalLabel } from "../records_db";
import type { RecordsKind, Rise } from "./records_deliveries";
import type { EventKind, EventRow, Listed, WatchKind } from "./watch_events";
import type { MailMessage } from "./sender";

// A message and the headers it goes out with (List-Unsubscribe and its
// one-click partner, RFC 8058).
export type DigestMessage = MailMessage & { headers: Record<string, string> };

export type Cadence = "daily" | "weekly";

interface DigestBase {
  lang: Lang;
  to: string;
  // The site's address with no trailing slash ("https://awardwatch.ca").
  site: string;
  // The saved search's label, written by the site in the search's language.
  label: string;
  // The saved search's page, path and query, as interestFilter rebuilt it.
  params: string;
  cadence: Cadence;
  // The data date the message reports on.
  dataDate: string;
  // The stop link for this search (/account/stop?s=...&t=...).
  stopUrl: string;
  // How many records matched; rows holds the first ROWS_MAX (deliveries.ts).
  total: number;
}

export interface TenderDigest extends DigestBase {
  rows: readonly TenderRow[];
  // The day the items start after: the previous delivery's data date, or
  // where a first delivery's span begins.
  since: string;
}

export interface ExpiringDigest extends DigestBase {
  rows: readonly ExpiringRow[];
  // The window's length in months (3, 6, 12).
  months: number;
  query: ExpiringQuery;
}

// -- helpers ----------------------------------------------------------------------

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// A link on the site in the message's language: the language middleware
// reads ?lang=, so a French reader lands on the French page.
export function siteLink(site: string, path: string, lang: Lang): string {
  if (lang !== "fr") return `${site}${path}`;
  return `${site}${path}${path.includes("?") ? "&" : "?"}lang=fr`;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

// A key's text with one slot filled by markup: the text is escaped first, so
// only the markup given is markup. A function as the replacement, so a "$"
// in a label is never read as a pattern.
const SLOT = "\u0001";
function withMarkup(text: (slot: string) => string, markup: string): string {
  return escapeHtml(text(SLOT)).replace(SLOT, () => markup);
}

// A title cut for the preheader, on a word where one is near.
function short(title: string, max = 70): string {
  if (title.length <= max) return title;
  const cut = title.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// The preview line a client shows beside the subject: the first two titles,
// then how many more.
function preheader(lang: Lang, titles: string[], total: number): string {
  const first = titles.slice(0, 2).map((x) => short(x)).join(", ");
  const rest = total - Math.min(2, titles.length);
  if (rest <= 0) return `${first}.`;
  return tn(lang, "digest.pre_more_one", "digest.pre_more_many", rest, { first, n: fmtInt(rest, lang) });
}

// -- the shell (design/email/build.py) -----------------------------------------------------

const C = {
  page: "#f8fafc", panel: "#ffffff", head: "#eef2f7", border: "#e2e8f0", border2: "#cbd5e1",
  ink: "#0f172a", ink2: "#334155", muted: "#5b6b80", accent: "#0f7b4f", amber: "#b45309",
};
const FONT = "'Inter', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// Overrides for a dark client, under the media query Apple Mail and iOS
// honour; Gmail inverts on its own and the palette survives it.
const DARK_CSS = [
  ".bg{background:#0b1220!important}",
  ".card{background:#111a2b!important;border-color:#243044!important}",
  ".ink, .ink a{color:#e5edf7!important}",
  ".ink2{color:#c7d2e0!important}",
  ".muted, .muted a{color:#8da0b8!important}",
  ".band{background:#17233a!important;border-color:#2b3a52!important}",
  ".rule{border-color:#243044!important}",
  ".btn{background:#e5edf7!important}",
  ".btn a{color:#0f172a!important}",
  ".chip{border-color:#3b4a63!important;color:#c7d2e0!important}",
  ".logo-light{display:none!important}",
  ".logo-dark{display:block!important}",
].join("");

const HEAD_CSS = `
  body{margin:0;padding:0;background:${C.page};}
  table{border-collapse:collapse;}
  img{border:0;outline:none;text-decoration:none;}
  @media (prefers-color-scheme: dark){ ${DARK_CSS} }
  @media only screen and (max-width:620px){ .wrap{width:100%!important;} .pad{padding-left:18px!important;padding-right:18px!important;} }
`;

// The two hosted wordmarks at 2x, 142 by 20 CSS pixels: ink on a baked white
// ground for light clients and for the Gmail apps (which darken the page and
// leave images alone), light ink on a transparent ground for the clients that
// honour the dark query. The site's name is the fallback text.
function wordmark(site: string): string {
  return `<a href="${escapeHtml(site)}" style="text-decoration:none;">` +
    `<img class="logo-light" src="${escapeHtml(site)}/brand/wordmark.png" width="142" height="20" alt="Award Watch" ` +
    `style="display:block;border:0;width:142px;height:20px;font:700 18px ${FONT};color:${C.ink};">` +
    `<img class="logo-dark" src="${escapeHtml(site)}/brand/wordmark-dark.png" width="142" height="20" alt="Award Watch" ` +
    `style="display:none;border:0;width:142px;height:20px;font:700 18px ${FONT};color:#e5edf7;"></a>`;
}

function shell(o: { lang: Lang; site: string; subject: string; preheader: string; body: string; why: string }): string {
  const host = new URL(o.site).host;
  const home = siteLink(o.site, "/", o.lang);
  const tagline = `${escapeHtml(t(o.lang, "site.name"))} · ${escapeHtml(t(o.lang, "site.tagline"))}`;
  return `<!DOCTYPE html>
<html lang="${o.lang}">
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
      <td class="logo" style="vertical-align:middle;color:${C.ink};">${wordmark(o.site)}</td>
      <td align="right" class="muted" style="vertical-align:middle;font:13px/1 ${FONT};color:${C.muted};"><a href="${escapeHtml(home)}" style="color:${C.muted};text-decoration:none;">${escapeHtml(host)}</a></td>
    </tr></table>
  </td></tr>
  <tr><td class="pad" style="padding:24px 28px 8px 28px;">${o.body}</td></tr>
  <tr><td class="pad rule" style="padding:14px 28px 20px 28px;border-top:1px solid ${C.border};">
    <p class="muted" style="margin:0 0 6px 0;font:12px/1.5 ${FONT};color:${C.muted};">${o.why}</p>
    <p class="muted" style="margin:0;font:12px/1.5 ${FONT};color:${C.muted};">${tagline} · <a href="mailto:${CONTACT_EMAIL}" style="color:${C.muted};">${CONTACT_EMAIL}</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

function h1(text: string): string {
  return `<h1 class="ink" style="margin:0 0 12px 0;font:700 20px/1.3 ${FONT};color:${C.ink};">${escapeHtml(text)}</h1>`;
}

// A part's heading inside one message (the records digest's two parts).
function h2(text: string): string {
  return `<h2 class="ink" style="margin:18px 0 6px 0;font:700 16px/1.3 ${FONT};color:${C.ink};">${escapeHtml(text)}</h2>`;
}

// html is markup already escaped.
function para(html: string, muted = false): string {
  const cls = muted ? "muted" : "ink2";
  const size = muted ? 13 : 15;
  return `<p class="${cls}" style="margin:0 0 14px 0;font:${size}px/1.5 ${FONT};color:${muted ? C.muted : C.ink2};">${html}</p>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px 0;"><tr>
  <td class="btn" style="background:${C.ink};"><a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 18px;font:600 14px/1 ${FONT};color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a></td>
</tr></table>`;
}

function chip(text: string): string {
  return `<span class="chip" style="display:inline-block;border:1px solid ${C.border2};padding:1px 6px;` +
    `font:12px/1.4 ${FONT};color:${C.ink2};white-space:nowrap;">${escapeHtml(text)}</span>`;
}

const amber = (html: string) => `<span style="color:${C.amber};font-weight:600;">${html}</span>`;

// One row: the title as a link, then two lines (markup already escaped).
function row(title: string, href: string, line2: string, line3: string, first: boolean): string {
  const border = first ? "" : `border-top:1px solid ${C.border};`;
  return `<tr><td class="rule" style="padding:12px 0;${border}">
  <a class="ink" href="${escapeHtml(href)}" style="font:600 15px/1.4 ${FONT};color:${C.ink};text-decoration:none;">${escapeHtml(title)}</a>
  <div class="ink2" style="margin-top:3px;font:13px/1.5 ${FONT};color:${C.ink2};">${line2}</div>
  <div class="muted" style="margin-top:2px;font:13px/1.5 ${FONT};color:${C.muted};">${line3}</div>
</td></tr>`;
}

const rows = (items: string[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 10px 0;">${items.join("")}</table>`;

// "And 12 more on the site", linking the saved search's page, when the
// message lists fewer rows than matched.
function moreLine(lang: Lang, shown: number, total: number, href: string): { html: string; text: string } | null {
  const rest = total - shown;
  if (rest <= 0) return null;
  const label = tn(lang, "digest.more_one", "digest.more_many", rest, { n: fmtInt(rest, lang) });
  return {
    html: para(`<a href="${escapeHtml(href)}" style="color:${C.ink2};">${escapeHtml(label)}</a>`),
    text: t(lang, "digest.text_link", { label, url: href }),
  };
}

// The footer's first line: why the message came, the saved searches, and
// the stop link for this search alone.
function why(o: DigestBase): { html: string; text: string } {
  const searches = siteLink(o.site, "/account/searches", o.lang);
  const reason = t(o.lang, o.cadence === "daily" ? "digest.why_daily" : "digest.why_weekly");
  const link = (href: string, key: Key) => `<a href="${escapeHtml(href)}" style="color:${C.muted};">${escapeHtml(t(o.lang, key))}</a>`;
  return {
    html: `${escapeHtml(reason)} ${link(searches, "digest.searches_link")} · ${link(o.stopUrl, "digest.stop_link")}`,
    text: [
      reason,
      t(o.lang, "digest.text_link", { label: t(o.lang, "digest.text_searches"), url: searches }),
      t(o.lang, "digest.text_link", { label: t(o.lang, "digest.stop_link"), url: o.stopUrl }),
    ].join("\n"),
  };
}

function textFooter(lang: Lang): string {
  return `${t(lang, "site.name")} · ${t(lang, "site.tagline")}\n${CONTACT_EMAIL}\n`;
}

// List-Unsubscribe names the contact address and the stop link; the second
// header lets a mail client turn the delivery off with one POST to that link
// (RFC 8058), without opening a page.
export function deliveryHeaders(stopUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<mailto:${CONTACT_EMAIL}>, <${stopUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// -- tender notices -----------------------------------------------------------------------

// What the subject names of a tender search, in the message's language: the
// saved filter's values, every value of a key that repeats (the email lists
// chooser saves category, segment and province once per value), each one
// checked against the codes the site knows so nothing else reaches a
// subject; the buyer, notice type and method by the names a matching row
// carries. The words of a title search are never quoted; the scope says
// words were searched. Only names are read here: which notices match is
// readTenderQuery's and filterTenders' alone.
const TENDER_SCOPE_BASE = "https://scope.invalid";

export function tenderScope(lang: Lang, params: string, rows: readonly TenderRow[]): string {
  const sp = new URL(params, TENDER_SCOPE_BASE).searchParams;
  const all = (key: string, known: (v: string) => boolean) => [...new Set(sp.getAll(key).map((v) => v.trim()).filter(known))];
  const r = rows[0];
  const parts: string[] = [];
  if ((sp.get("q") ?? "").trim()) parts.push(t(lang, "digest.scope_words"));
  const categories = all("category", (v) => (CATEGORIES as readonly string[]).includes(v));
  if (categories.length) parts.push(categories.map((v) => categoryLabel(lang, v)).join(", "));
  const segments = all("segment", (v) => v in SEGMENTS);
  if (segments.length) parts.push(segments.map((v) => `${v} ${segmentShort(lang, v)}`).join(", "));
  const code = (sp.get("code") ?? "").trim();
  if (CODE_RE.test(code)) parts.push(t(lang, "digest.scope_code", { code }));
  const provinces = all("province", (v) => (PROVINCES as readonly string[]).includes(v));
  if (provinces.length) parts.push(provinces.map((v) => provinceName(lang, v)).join(", "));
  // Every row matched these filters, so the first row's names are theirs.
  const named = (key: string, name: string | null) => {
    if (r && sp.get(key) && name) parts.push(name);
  };
  named("buyer", r ? pick(lang, r.buyer_en, r.buyer_fr) : null);
  named("type", r ? pick(lang, r.notice_type_en, r.notice_type_fr) : null);
  named("method", r ? pick(lang, r.method_en, r.method_fr) : null);
  return parts.join(" · ");
}

// Days left from the data date as the design writes them ("closes in 3
// days"), amber within 7 days; null for a value that is not a date.
export const AMBER_DAYS = 7;

function timeLeft(lang: Lang, closing: string | null, dataDate: string): { text: string; days: number } | null {
  const p = closingParts(closing);
  if (!p) return null;
  const days = dayDiff(p.day, dataDate);
  if (days < 0) return null;
  if (days === 0) {
    const time = closingTime(closing, lang);
    return { text: time ? t(lang, "countdown.today_at", { time }) : t(lang, "digest.closes_today"), days };
  }
  return { text: days === 1 ? t(lang, "countdown.in_day") : t(lang, "countdown.in_days", { n: days }), days };
}

function closesText(lang: Lang, closing: string | null): string | null {
  const p = closingParts(closing);
  if (!p) return null;
  const time = closingTime(closing, lang);
  return time ? t(lang, "digest.closes", { day: p.day, time }) : t(lang, "digest.closes_day", { day: p.day });
}

const MAX_CHIPS = 3;

// The notice's page on the site; references sit in URLs in lower case.
const tenderLink = (o: { site: string; lang: Lang }, r: TenderRow) => siteLink(o.site, `/tenders/${r.reference.toLowerCase()}`, o.lang);

function tenderLines(lang: Lang, r: TenderRow, dataDate: string) {
  const title = pick(lang, r.title_en, r.title_fr) ?? publishedReference(r);
  const buyer = pick(lang, r.buyer_en, r.buyer_fr) ?? t(lang, "common.not_stated");
  const where = r.provinces.length ? r.provinces.map((p) => provinceName(lang, p)).join(", ") : t(lang, "common.national");
  const closes = closesText(lang, r.closing);
  const left = timeLeft(lang, r.closing, dataDate);
  const chips = r.segments.slice(0, MAX_CHIPS).map((code) => `${code} ${segmentShort(lang, code)}`);
  return { title, line2: `${buyer} · ${where}`, closes, left, chips };
}

export function tenderDigest(o: TenderDigest): DigestMessage {
  const { lang } = o;
  const n = o.total;
  const scope = tenderScope(lang, o.params, o.rows);
  const subject = scope
    ? tn(lang, "digest.tenders_subject_one", "digest.tenders_subject_many", n, { n: fmtInt(n, lang), scope })
    : tn(lang, "digest.tenders_subject_all_one", "digest.tenders_subject_all_many", n, { n: fmtInt(n, lang) });
  const since = o.since === addDays(o.dataDate, -1) ? t(lang, "digest.since_yesterday") : t(lang, "digest.since_day", { date: o.since });
  const intro = (label: string) =>
    tn(lang, "digest.tenders_intro_one", "digest.tenders_intro_many", n, { n: fmtInt(n, lang), since, label, date: o.dataDate });
  const page = siteLink(o.site, o.params, lang);
  const more = moreLine(lang, o.rows.length, n, page);
  const footer = why(o);

  const htmlRows = o.rows.map((r, i) => {
    const l = tenderLines(lang, r, o.dataDate);
    const leftHtml = l.left ? (l.left.days <= AMBER_DAYS ? amber(escapeHtml(l.left.text)) : escapeHtml(l.left.text)) : "";
    const line3 = [l.closes ? escapeHtml(l.closes) : "", leftHtml].filter(Boolean).join(" · ") +
      (l.chips.length ? ` &nbsp;${l.chips.map(chip).join(" ")}` : "");
    return row(l.title, tenderLink(o, r), escapeHtml(l.line2), line3, i === 0);
  });
  const body = h1(t(lang, "digest.tenders_title")) +
    para(withMarkup(intro, `<b>${escapeHtml(o.label)}</b>`)) +
    rows(htmlRows) +
    (more?.html ?? "") +
    button(page, t(lang, "digest.tenders_button")) +
    para(escapeHtml(t(lang, "digest.tenders_note")), true);
  const pre = preheader(lang, o.rows.map((r) => pick(lang, r.title_en, r.title_fr) ?? publishedReference(r)), n);
  const html = shell({ lang, site: o.site, subject, preheader: pre, body, why: footer.html });

  const textRows = o.rows.map((r) => {
    const l = tenderLines(lang, r, o.dataDate);
    const when = [l.closes, l.left?.text].filter(Boolean).join(", ");
    const third = [when, l.chips.join(", ")].filter(Boolean).join(" · ");
    return `- ${l.title}\n  ${l.line2}\n  ${third}\n  ${tenderLink(o, r)}`;
  });
  const text = [
    t(lang, "digest.tenders_title"),
    intro(o.label),
    textRows.join("\n\n"),
    ...(more ? [more.text] : []),
    t(lang, "digest.text_link", { label: t(lang, "digest.tenders_button"), url: page }),
    t(lang, "digest.tenders_note"),
    `${footer.text}\n${textFooter(lang)}`,
  ].join("\n\n");
  return { to: o.to, subject, text, html, lang, headers: deliveryHeaders(o.stopUrl) };
}

// -- contracts entering a window ------------------------------------------------------------

// What the subject names of a radar search: the buyer (named as the rows
// name it, since every row matched it) and the segment.
export function expiringScope(lang: Lang, q: ExpiringQuery, rows: readonly ExpiringRow[]): string {
  const parts: string[] = [];
  const r = rows[0];
  if (q.buyer) parts.push((r && pick(lang, r.buyer_en, r.buyer_fr)) ?? q.buyer);
  if (q.segment) parts.push(`${q.segment} ${segmentShort(lang, q.segment)}`);
  return parts.join(" · ");
}

const KIND_KEY: Record<ExpiringRow["kind"], Key> = {
  award: "expiring.kind_award", history: "expiring.kind_history", contract: "expiring.kind_contract",
};

// The site's own page for the row, as the radar links it (sitePath). A
// published contract's page needs its department ("owner_org:reference"); a
// row without one gets the government's contracts search instead, which
// sitePath returns as a full address, so only a path takes the site.
function contractLink(o: { site: string; lang: Lang }, r: ExpiringRow): string {
  const path = sitePath(r);
  return path.startsWith("/") ? siteLink(o.site, path, o.lang) : path;
}

function contractLines(lang: Lang, r: ExpiringRow) {
  const title = pick(lang, r.title_en, r.title_fr) ?? contractReference(r);
  const supplier = r.supplier_withheld ? t(lang, "expiring.withheld") : r.organization ?? t(lang, "common.not_stated");
  const buyer = pick(lang, r.buyer_en, r.buyer_fr) ?? t(lang, "common.not_stated");
  const value = r.value === null ? t(lang, "common.not_stated") : fmtMoney(r.value, lang, r.currency);
  const line3 = [t(lang, "digest.ends", { date: r.end.slice(0, 10) }), value, t(lang, KIND_KEY[r.kind])].join(" · ");
  return { title, line2: `${supplier} · ${buyer}`, line3 };
}

export function expiringDigest(o: ExpiringDigest): DigestMessage {
  const { lang } = o;
  const n = o.total;
  const scope = expiringScope(lang, o.query, o.rows);
  const subject = scope
    ? tn(lang, "digest.expiring_subject_one", "digest.expiring_subject_many", n, { n: fmtInt(n, lang), months: o.months, scope })
    : tn(lang, "digest.expiring_subject_all_one", "digest.expiring_subject_all_many", n, { n: fmtInt(n, lang), months: o.months });
  const cadence = t(lang, o.cadence === "daily" ? "digest.cadence_daily" : "digest.cadence_weekly");
  const intro = (label: string) =>
    tn(lang, "digest.expiring_intro_one", "digest.expiring_intro_many", n, { n: fmtInt(n, lang), months: o.months, label, cadence, date: o.dataDate });
  const page = siteLink(o.site, o.params, lang);
  const more = moreLine(lang, o.rows.length, n, page);
  const footer = why(o);

  const htmlRows = o.rows.map((r, i) => {
    const l = contractLines(lang, r);
    return row(l.title, contractLink(o, r), escapeHtml(l.line2), escapeHtml(l.line3), i === 0);
  });
  const body = h1(t(lang, "digest.expiring_title", { n: o.months })) +
    para(withMarkup(intro, `<b>${escapeHtml(o.label)}</b>`)) +
    rows(htmlRows) +
    (more?.html ?? "") +
    button(page, t(lang, "digest.expiring_button")) +
    para(escapeHtml(t(lang, "digest.expiring_note")), true);
  const pre = preheader(lang, o.rows.map((r) => pick(lang, r.title_en, r.title_fr) ?? contractReference(r)), n);
  const html = shell({ lang, site: o.site, subject, preheader: pre, body, why: footer.html });

  const textRows = o.rows.map((r) => {
    const l = contractLines(lang, r);
    return `- ${l.title}\n  ${l.line2}\n  ${l.line3}\n  ${contractLink(o, r)}`;
  });
  const text = [
    t(lang, "digest.expiring_title", { n: o.months }),
    intro(o.label),
    textRows.join("\n\n"),
    ...(more ? [more.text] : []),
    t(lang, "digest.text_link", { label: t(lang, "digest.expiring_button"), url: page }),
    t(lang, "digest.expiring_note"),
    `${footer.text}\n${textFooter(lang)}`,
  ].join("\n\n");
  return { to: o.to, subject, text, html, lang, headers: deliveryHeaders(o.stopUrl) };
}

// -- records counts: an organization, a buyer, a segment -----------------------------------------

export interface RecordsDigest extends DigestBase {
  kind: RecordsKind;
  // Who or what the search follows, in the message's language: the
  // organization's or the buyer's name, or "43 IT and telecom".
  name: string;
  // The counts that rose (records_deliveries.ts rises), at most ROWS_MAX.
  rows: readonly Rise[];
  // Records added across every source and year.
  more: number;
  // The data date of the counts compared with.
  since: string;
  // A segment's new tender notices since tenderSince (deliveries.ts
  // tenderItems), at most ROWS_MAX; empty for the other kinds.
  tenders: readonly TenderRow[];
  tenderTotal: number;
  tenderSince: string;
}

const RECORDS_TITLE: Record<RecordsKind, Key> = {
  organization: "digest.records_title_organization", buyer: "digest.records_title_buyer", segment: "digest.records_title_segment",
};
const RECORDS_BUTTON: Record<RecordsKind, Key> = {
  organization: "digest.records_button_organization", buyer: "digest.records_button_buyer", segment: "digest.records_button_segment",
};

const sinceText = (lang: Lang, since: string, dataDate: string) =>
  since === addDays(dataDate, -1) ? t(lang, "digest.since_yesterday") : t(lang, "digest.since_day", { date: since });

// A source and fiscal year as the analytics view of the same entity names
// them; the row's title links that view on the source.
function riseLines(lang: Lang, r: Rise) {
  return {
    title: `${sourceLabel(lang, r.src)}, ${fiscalLabel(lang, r.fy)}`,
    line2: t(lang, "digest.records_row", { more: fmtInt(r.more, lang), n: fmtInt(r.n, lang) }),
    line3: r.cents === null ? t(lang, "digest.records_no_value") : t(lang, "digest.records_value", { value: fmtMoney(r.cents / 100, lang) }),
  };
}

const analyticsLink = (o: { site: string; lang: Lang; params: string }, r: Rise) =>
  siteLink(o.site, `${o.params}/analytics?source=${r.src}`, o.lang);

export function recordsDigest(o: RecordsDigest): DigestMessage {
  const { lang } = o;
  const what: string[] = [];
  if (o.tenderTotal) {
    what.push(tn(lang, "digest.tenders_subject_all_one", "digest.tenders_subject_all_many", o.tenderTotal, { n: fmtInt(o.tenderTotal, lang) }));
  }
  if (o.more) what.push(tn(lang, "digest.records_subject_one", "digest.records_subject_many", o.more, { n: fmtInt(o.more, lang) }));
  const subject = t(lang, "digest.records_subject", { what: what.join(", "), scope: o.name });
  const title = t(lang, RECORDS_TITLE[o.kind], { name: o.name });
  const lead = (label: string) => t(lang, "digest.records_lead", { label, date: o.dataDate });
  const page = siteLink(o.site, o.params, lang);
  const footer = why(o);
  const html: string[] = [h1(title), para(withMarkup(lead, `<b>${escapeHtml(o.label)}</b>`))];
  const text: string[] = [title, lead(o.label)];

  if (o.tenderTotal) {
    const intro = tn(lang, "digest.records_tenders_one", "digest.records_tenders_many", o.tenderTotal, {
      n: fmtInt(o.tenderTotal, lang), since: sinceText(lang, o.tenderSince, o.dataDate),
    });
    const list = siteLink(o.site, `/tenders?segment=${o.params.slice("/segments/".length)}`, lang);
    const more = moreLine(lang, o.tenders.length, o.tenderTotal, list);
    html.push(h2(t(lang, "digest.tenders_title")), para(escapeHtml(intro)), rows(o.tenders.map((r, i) => {
      const l = tenderLines(lang, r, o.dataDate);
      const leftHtml = l.left ? (l.left.days <= AMBER_DAYS ? amber(escapeHtml(l.left.text)) : escapeHtml(l.left.text)) : "";
      return row(l.title, tenderLink(o, r), escapeHtml(l.line2), [l.closes ? escapeHtml(l.closes) : "", leftHtml].filter(Boolean).join(" · "), i === 0);
    })), more?.html ?? "");
    text.push(t(lang, "digest.tenders_title"), intro, o.tenders.map((r) => {
      const l = tenderLines(lang, r, o.dataDate);
      return `- ${l.title}\n  ${l.line2}\n  ${[l.closes, l.left?.text].filter(Boolean).join(", ")}\n  ${tenderLink(o, r)}`;
    }).join("\n\n"), ...(more ? [more.text] : []));
  }

  if (o.more) {
    const intro = tn(lang, "digest.records_more_one", "digest.records_more_many", o.more, {
      n: fmtInt(o.more, lang), since: sinceText(lang, o.since, o.dataDate),
    });
    html.push(h2(t(lang, "digest.records_counted")), para(escapeHtml(intro)), rows(o.rows.map((r, i) => {
      const l = riseLines(lang, r);
      return row(l.title, analyticsLink(o, r), escapeHtml(l.line2), escapeHtml(l.line3), i === 0);
    })));
    text.push(t(lang, "digest.records_counted"), intro, o.rows.map((r) => {
      const l = riseLines(lang, r);
      return `- ${l.title}\n  ${l.line2}\n  ${l.line3}\n  ${analyticsLink(o, r)}`;
    }).join("\n\n"));
  }

  const label = t(lang, RECORDS_BUTTON[o.kind]);
  html.push(button(page, label), para(escapeHtml(t(lang, "digest.records_note")), true));
  text.push(t(lang, "digest.text_link", { label, url: page }), t(lang, "digest.records_note"), `${footer.text}\n${textFooter(lang)}`);
  const titles = [
    ...o.tenders.map((r) => pick(lang, r.title_en, r.title_fr) ?? publishedReference(r)),
    ...o.rows.map((r) => riseLines(lang, r).title),
  ];
  return {
    to: o.to, subject, lang, headers: deliveryHeaders(o.stopUrl), text: text.join("\n\n"),
    html: shell({ lang, site: o.site, subject, preheader: preheader(lang, titles, titles.length), body: html.join(""), why: footer.html }),
  };
}

// -- watches: one message per account (watch_mail.ts) ----------------------------------------

// One watch's part of the message: its page, and its events by kind in the
// watch's order, each kind with how many in all and the newest rows
// (watch_mail.ts keeps the rows of the whole message to ROWS_MAX).
export interface WatchGroup {
  kind: WatchKind;
  label: string;
  // The watch's page, a path on the site.
  path: string;
  events: Listed;
}

export interface WatchDigest {
  lang: Lang;
  to: string;
  site: string;
  dataDate: string;
  // The stop link of the account's watch mail (/account/stop?w=...&t=...).
  stopUrl: string;
  groups: readonly WatchGroup[];
  // Events in all, past the rows listed.
  total: number;
  // How many pages the account follows, the lead's "of the 9 pages you follow".
  watched: number;
  // A block the message opens with, before the watches (opening below).
  opening?: DigestOpening | null;
}

// The block a watch message opens with: the "Your organization" block
// (org_claim.ts orgWeekOpening), a heading and its lines, each a fact with
// its link. A message with the block and no watch event carries the block
// alone, under the block's own subject.
export interface DigestOpening {
  subject: string;
  heading: string;
  lines: readonly { text: string; url: string }[];
}

function openingHtml(o: DigestOpening): string[] {
  return [h2(o.heading), ...o.lines.map((l) => para(`<a href="${escapeHtml(l.url)}" style="color:${C.ink2};">${escapeHtml(l.text)}</a>`))];
}

function openingText(o: DigestOpening): string {
  return [o.heading, ...o.lines.map((l) => `  ${l.text} · ${l.url}`)].join("\n");
}

export const WATCH_KIND_KEY: Readonly<Record<WatchKind, Key>> = {
  organization: "watches.kind_organization", buyer: "watches.kind_buyer", contract: "watches.kind_contract", tender: "watches.kind_tender",
};
export const EVENT_KEY: Readonly<Record<EventKind, Key>> = {
  award: "watches.ev_award", grant: "watches.ev_grant", amended: "watches.ev_amended", cancelled: "watches.ev_cancelled",
  ends_12m: "watches.ev_ends_12m", ends_6m: "watches.ev_ends_6m", ended: "watches.ev_ended", notice: "watches.ev_notice",
  notice_amended: "watches.ev_notice_amended", notice_closed: "watches.ev_notice_closed", notice_cancelled: "watches.ev_notice_cancelled",
  notice_awarded: "watches.ev_notice_awarded",
};

// An event's three lines, as the message and the watches page write them:
// the title; what happened, with its figures (an amendment's value before
// and after, its change and an end date that moved; a closing that moved; a
// notice's winner); the data date it was first seen, and the account's other
// watches the same event reached.
export function watchEventLines(lang: Lang, r: EventRow): { title: string; line2: string; line3: string } {
  const money = (cents: number) => fmtMoney(cents / 100, lang);
  const day = (v: string | null) => (v ? v.slice(0, 10) : null);
  const what: string[] = [t(lang, EVENT_KEY[r.kind])];
  const value = () => (r.cents !== null ? what.push(t(lang, "watches.line_value", { value: money(r.cents) })) : 0);
  if (r.kind === "award" || r.kind === "grant") {
    value();
    if (r.endd) what.push(t(lang, "watches.line_ends", { date: r.endd }));
  } else if (r.kind === "amended") {
    if (r.cents !== null && r.ocents !== null) {
      what.push(t(lang, "watches.line_was", { value: money(r.cents), was: money(r.ocents), change: valueChange(lang, r.ocents, r.cents) }));
    } else value();
    if (r.oendd && r.endd) what.push(t(lang, "watches.line_end_moved", { from: r.oendd, to: r.endd }));
    if (r.namd) what.push(t(lang, "watches.line_amendment", { n: fmtInt(r.namd, lang) }));
  } else if (r.kind === "cancelled") {
    if (r.ocents !== null) what.push(t(lang, "watches.line_value_before", { value: money(r.ocents) }));
  } else if (r.kind === "ends_12m" || r.kind === "ends_6m" || r.kind === "ended") {
    if (r.endd) what.push(t(lang, r.kind === "ended" ? "watches.line_ended" : "watches.line_ends", { date: r.endd }));
    value();
    if (r.other) what.push(r.other);
  } else if (r.kind === "notice") {
    if (r.closing) what.push(t(lang, "watches.line_closes", { date: day(r.closing)! }));
  } else if (r.kind === "notice_amended") {
    if (r.oclosing && r.closing) what.push(t(lang, "watches.line_closing_moved", { from: day(r.oclosing)!, to: day(r.closing)! }));
    else if (r.other) what.push(t(lang, "watches.line_title_changed"));
    else if (r.namd) what.push(t(lang, "watches.line_amendment", { n: fmtInt(r.namd, lang) }));
  } else if (r.kind === "notice_closed") {
    if (r.closing) what.push(t(lang, "watches.line_closed", { date: day(r.closing)! }));
  } else if (r.kind === "notice_awarded") {
    what.push(r.other ? t(lang, "watches.line_awarded", { name: r.other }) : t(lang, "watches.line_withheld"));
    value();
  }
  const when = [t(lang, "watches.line_found", { date: r.day })];
  if (r.also?.length) when.push(t(lang, "watches.also", { labels: r.also.join(", ") }));
  return { title: pick(lang, r.title, r.title_fr) ?? t(lang, "common.not_stated"), line2: what.join(" · "), line3: when.join(" · ") };
}

// An amendment's change in dollars and in percent of the value before:
// "+$148,000, +123%" ("+148 000 $, +123 %"); the percent left out when the
// value before was not above zero.
export function valueChange(lang: Lang, was: number, now: number): string {
  const diff = now - was;
  const sign = diff < 0 ? "-" : "+";
  const parts = [`${sign}${fmtMoney(Math.abs(diff) / 100, lang)}`];
  if (was > 0) parts.push(`${sign}${Math.round((Math.abs(diff) / was) * 100)}${lang === "fr" ? "\u00a0%" : "%"}`);
  return parts.join(", ");
}

// "Contract amended: 3 more on the page", after a kind's rows when it has more.
export function watchMoreText(lang: Lang, kind: EventKind, rest: number): string {
  return tn(lang, "watches.more_one", "watches.more_many", rest, { kind: t(lang, EVENT_KEY[kind]), n: fmtInt(rest, lang) });
}

export function watchDigest(o: WatchDigest): DigestMessage {
  const { lang } = o;
  const open = o.opening ?? null;
  const alone = open !== null && o.groups.length === 0;
  const labels = o.groups.slice(0, 2).map((g) => g.label).join(", ");
  const subject = alone ? open.subject
    : tn(lang, "watches.digest_subject_one", "watches.digest_subject_many", o.total, { n: fmtInt(o.total, lang), labels });
  const title = t(lang, "watches.digest_title");
  const lead = tn(lang, "watches.digest_lead_one", "watches.digest_lead_many", o.total, {
    n: fmtInt(o.total, lang), w: fmtInt(o.groups.length, lang), all: fmtInt(o.watched, lang), date: o.dataDate,
  });
  const page = siteLink(o.site, "/account/watches", lang);
  const html: string[] = [...(open ? openingHtml(open) : []), ...(alone ? [] : [h1(title), para(escapeHtml(lead))])];
  const text: string[] = [...(open ? [openingText(open)] : []), ...(alone ? [] : [title, lead])];
  for (const g of o.groups) {
    const href = siteLink(o.site, g.path, lang);
    const n = g.events.reduce((sum, e) => sum + e.n, 0);
    const head = `${g.label} · ${t(lang, WATCH_KIND_KEY[g.kind])}`;
    const count = tn(lang, "watches.count_one", "watches.count_many", n, { n: fmtInt(n, lang) });
    html.push(h2(head), para(`<a href="${escapeHtml(href)}" style="color:${C.ink2};">${escapeHtml(count)}</a>`));
    const lines: string[] = [`${head}\n${t(lang, "digest.text_link", { label: count, url: href })}`];
    for (const e of g.events) {
      if (e.rows.length) {
        html.push(rows(e.rows.map((r, i) => {
          const l = watchEventLines(lang, r);
          return row(l.title, siteLink(o.site, r.path, lang), escapeHtml(l.line2), escapeHtml(l.line3), i === 0);
        })));
        for (const r of e.rows) {
          const l = watchEventLines(lang, r);
          lines.push(`- ${l.title}\n  ${l.line2}\n  ${l.line3}\n  ${siteLink(o.site, r.path, lang)}`);
        }
      }
      const rest = e.n - e.rows.length;
      if (rest > 0) {
        const more = watchMoreText(lang, e.kind, rest);
        html.push(para(`<a href="${escapeHtml(href)}" style="color:${C.ink2};">${escapeHtml(more)}</a>`));
        lines.push(t(lang, "digest.text_link", { label: more, url: href }));
      }
    }
    text.push(lines.join("\n\n"));
  }
  html.push(button(page, t(lang, "watches.digest_button")), para(escapeHtml(t(lang, "watches.digest_note")), true));
  const why = t(lang, "watches.digest_why");
  const link = (href: string, key: Key) => `<a href="${escapeHtml(href)}" style="color:${C.muted};">${escapeHtml(t(lang, key))}</a>`;
  const whyText = [
    why,
    t(lang, "digest.text_link", { label: t(lang, "watches.digest_link"), url: page }),
    t(lang, "digest.text_link", { label: t(lang, "watches.digest_stop"), url: o.stopUrl }),
  ].join("\n");
  text.push(t(lang, "digest.text_link", { label: t(lang, "watches.digest_button"), url: page }), t(lang, "watches.digest_note"),
    `${whyText}\n${textFooter(lang)}`);
  // The first facts in words ("Kerr Wood Leidal · Contract amended"), then how many more.
  const facts = alone ? (open.lines.length ? open.lines.map((l) => l.text) : [open.heading])
    : o.groups.flatMap((g) => g.events.map((e) => `${g.label} · ${t(lang, EVENT_KEY[e.kind])}`));
  const pre = preheader(lang, facts, facts.length);
  return {
    to: o.to, subject, lang, headers: deliveryHeaders(o.stopUrl), text: text.join("\n\n"),
    html: shell({
      lang, site: o.site, subject, preheader: pre, body: html.join(""),
      why: `${escapeHtml(why)} ${link(page, "watches.digest_link")} · ${link(o.stopUrl, "watches.digest_stop")}`,
    }),
  };
}
