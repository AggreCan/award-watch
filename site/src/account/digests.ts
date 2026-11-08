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
import { type Clock, closesLine, closingText, closingTime } from "../closing";
import { CATEGORIES, PROVINCES, SEGMENTS } from "../constants";
import { type ExpiringRow, type TenderRow, publishedReference } from "../data";
import { categoryLabel, fmtInt, fmtMoney, fmtMoneyShort, pick, provinceName, segmentShort, sourceLabel, t, tn, type Key, type Lang } from "../i18n";
import { instrumentPath, instrumentQueryString } from "../instruments";
import { CONTACT_EMAIL } from "../pages/docs";
import { type ExpiringQuery, contractReference, growthPct, sitePath } from "../pages/expiring";
import { provincesText } from "../pages/shared";
import { CODE_RE } from "../pages/tenders";
import { fiscalLabel } from "../records_db";
import type { BriefingData, BriefingSubject, Quarter } from "./briefings";
import type { RecordsKind, Rise } from "./records_deliveries";
import { type EventKind, type EventRow, INSTRUMENT_REF, type Listed, type WatchKind, isInstrumentKind } from "./watch_events";
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

// A subject stays under SUBJECT_MAX characters, the live check's mark
// included (mail_check.ts): an inbox cuts a longer one wherever it likes, so
// one that would reach it is cut here, on a word, with an ellipsis. Only a
// long scope, label or name gets that far (a search saved with many
// provinces, a buyer's long name); the mail suite holds every message to it.
export const SUBJECT_MAX = 100;
export const fitSubject = (subject: string): string => short(subject, SUBJECT_MAX - 2);

// A subject that lists counts (the briefing's, the records digest's) names as
// many as fit under SUBJECT_MAX, the last ones left out first, rather than
// cutting one in the middle; one that does not fit even with the first count
// alone is cut as fitSubject cuts. The message itself carries every count.
export function fitCounts(parts: readonly string[], subject: (shown: readonly string[]) => string): string {
  for (let k = parts.length; k > 1; k--) {
    const s = subject(parts.slice(0, k));
    if (s.length < SUBJECT_MAX) return s;
  }
  return fitSubject(subject(parts.slice(0, 1)));
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
  // The stated provinces, then the derived ones marked, as the tender list shows them.
  const where = provincesText(lang, r.provinces, r.provinces_derived);
  const closes = closesText(lang, r.closing);
  const left = timeLeft(lang, r.closing, dataDate);
  const chips = r.segments.slice(0, MAX_CHIPS).map((code) => `${code} ${segmentShort(lang, code)}`);
  return { title, line2: `${buyer} · ${where}`, closes, left, chips };
}

export function tenderDigest(o: TenderDigest): DigestMessage {
  const { lang } = o;
  const n = o.total;
  const scope = tenderScope(lang, o.params, o.rows);
  const subject = fitSubject(scope
    ? tn(lang, "digest.tenders_subject_one", "digest.tenders_subject_many", n, { n: fmtInt(n, lang), scope })
    : tn(lang, "digest.tenders_subject_all_one", "digest.tenders_subject_all_many", n, { n: fmtInt(n, lang) }));
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
  const subject = fitSubject(scope
    ? tn(lang, "digest.expiring_subject_one", "digest.expiring_subject_many", n, { n: fmtInt(n, lang), months: o.months, scope })
    : tn(lang, "digest.expiring_subject_all_one", "digest.expiring_subject_all_many", n, { n: fmtInt(n, lang), months: o.months }));
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
  const subject = fitCounts(what, (shown) => t(lang, "digest.records_subject", { what: shown.join(", "), scope: o.name }));
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
  // The send time, for the time left on each notice's closing (watchEventLines).
  clock?: Clock;
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
  notice_awarded: "watches.ev_notice_awarded", instrument_gained: "watches.ev_instrument_gained",
  instrument_lost: "watches.ev_instrument_lost", instrument_expires_6m: "watches.ev_instrument_expires_6m",
};

// An event's three lines, as the message and the watches page write them:
// the title; what happened, with its figures (an amendment's value before
// and after, its change and an end date that moved; a closing that moved; a
// notice's winner; a standing offer's type and region, description, expiry
// and holders, under its agreement number); the data date it was first seen,
// and the account's other watches the same event reached. With a clock (the
// message, at its send time), a new or amended notice's row also says the
// time left by the tender page's rule (noticeTimeLeft), and names its date
// as the closing date so the two do not both open with "Closes".
export function watchEventLines(lang: Lang, r: EventRow, clock?: Clock): { title: string; line2: string; line3: string } {
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
    if (r.closing) what.push(t(lang, clock ? "watches.line_closing_date" : "watches.line_closes", { date: day(r.closing)! }));
  } else if (r.kind === "notice_amended") {
    if (r.oclosing && r.closing) what.push(t(lang, "watches.line_closing_moved", { from: day(r.oclosing)!, to: day(r.closing)! }));
    else if (r.other) what.push(t(lang, "watches.line_title_changed"));
    else if (r.namd) what.push(t(lang, "watches.line_amendment", { n: fmtInt(r.namd, lang) }));
  }
  if (clock && r.closing && (r.kind === "notice" || r.kind === "notice_amended")) {
    const left = noticeTimeLeft(lang, r.closing, clock);
    if (left) what.push(left);
  }
  if (r.kind === "notice_closed") {
    if (r.closing) what.push(t(lang, "watches.line_closed", { date: day(r.closing)! }));
  } else if (r.kind === "notice_awarded") {
    what.push(r.other ? t(lang, "watches.line_awarded", { name: r.other }) : t(lang, "watches.line_withheld"));
    value();
  }
  const instrument = isInstrumentKind(r.kind) && r.ref.startsWith(INSTRUMENT_REF) ? r.ref.slice(INSTRUMENT_REF.length) : null;
  if (instrument !== null) {
    // The agreement number is the title, as a reader quotes it; its type and
    // region, its description, its expiry and its holders follow.
    for (const part of [pick(lang, r.other, r.other_fr), pick(lang, r.title, r.title_fr)]) if (part) what.push(part);
    if (r.endd) what.push(t(lang, "watches.line_expires", { date: r.endd }));
    if (typeof r.holders === "number") {
      what.push(tn(lang, "watches.line_holders_one", "watches.line_holders_many", r.holders, { n: fmtInt(r.holders, lang) }));
    }
  }
  const when = [t(lang, "watches.line_found", { date: r.day })];
  if (r.also?.length) when.push(t(lang, "watches.also", { labels: r.also.join(", ") }));
  const title = instrument ?? pick(lang, r.title, r.title_fr) ?? t(lang, "common.not_stated");
  return { title, line2: what.join(" · "), line3: when.join(" · ") };
}

// The time left on a notice's closing at the clock, as the tender page's
// documents line words it (closing.ts closesLine, the notice taken as open:
// a cancelled or awarded one is a row of its own kind): "Closes in 20 days",
// "Closes today at 14:00 ET", "Closes today", "Closing date passed". A closing
// with a date and no time that is not today reads as that date alone, which
// the row already gives, so it adds nothing.
export function noticeTimeLeft(lang: Lang, closing: string, clock: Clock): string | null {
  const line = closesLine("open", closing, clock, lang);
  return line === t(lang, "tender.lead_closes", { date: closingText(closing, lang) }) ? null : line;
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
  const subject = fitSubject(alone ? open.subject
    : tn(lang, "watches.digest_subject_one", "watches.digest_subject_many", o.total, { n: fmtInt(o.total, lang), labels }));
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
          const l = watchEventLines(lang, r, o.clock);
          return row(l.title, siteLink(o.site, r.path, lang), escapeHtml(l.line2), escapeHtml(l.line3), i === 0);
        })));
        for (const r of e.rows) {
          const l = watchEventLines(lang, r, o.clock);
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

// -- weekly briefings: one segment or one buyer (briefings.ts) -----------------------------------

// One message per briefing, in the briefing's language: the week's new
// notices, the awards with their winners and each source's figures (nothing
// added across sources), the contracts ending next fiscal quarter with their
// holders and the ones new to the list this week, the notable amendments, the
// fiscal year's largest records, and the standing offers and supply
// arrangements ending within 6 months with their holders; each section
// SECTION_ROWS rows at most (briefings.ts), then a line with how many more or
// the list on the site. The public sample
// (/pro/briefing-sample) renders the same parts with no recipient and no
// footer of its own.
export interface BriefingDigest {
  lang: Lang;
  to: string;
  site: string;
  // The briefing's stop link (/account/stop?b=...&t=...).
  stopUrl: string;
  briefing: BriefingSubject;
  // "81 Engineering", a buyer's name, or a buyer narrowed to a segment.
  name: string;
  data: BriefingData;
}

const BRIEFING_MONTHS: Readonly<Record<number, Key>> = {
  1: "briefing.months_1", 2: "briefing.months_2", 3: "briefing.months_3", 4: "briefing.months_4",
};
// records.src and rec_events.src to the radar's word for one record, and to the source's name.
const RECORD_KIND: Readonly<Record<number, Key>> = { 1: "expiring.kind_award", 2: "expiring.kind_history", 3: "expiring.kind_contract" };
const RECORD_SOURCE: Readonly<Record<number, string>> = { 1: "awards", 2: "history", 3: "contracts" };

// "Q4 2026-27" ("T4 2026-2027") and "January to March 2027".
export const quarterName = (lang: Lang, q: Pick<Quarter, "fy" | "fq">): string =>
  t(lang, "briefing.quarter", { q: q.fq, fy: fiscalLabel(lang, q.fy) });
export const quarterMonths = (lang: Lang, q: Pick<Quarter, "fy" | "fq">): string =>
  t(lang, BRIEFING_MONTHS[q.fq], { year: q.fq === 4 ? q.fy + 1 : q.fy });

// "310, $364,414,137 (69 without a value)": a count, its counted value when
// there is one, and how many have none.
function briefingFigures(lang: Lang, n: number, cents: number | null, nv: number): string {
  let s = fmtInt(n, lang);
  if (cents !== null) s += `, ${fmtMoney(cents / 100, lang)}`;
  if (nv) s += ` (${t(lang, "briefing.nv", { n: fmtInt(nv, lang) })})`;
  return s;
}

// A row of the briefing: the title (a link when the record has a page) and one line.
function briefingRow(title: string, href: string | null, line: string, first: boolean): string {
  const border = first ? "" : `border-top:1px solid ${C.border};`;
  const head = href
    ? `<a class="ink" href="${escapeHtml(href)}" style="font:600 15px/1.4 ${FONT};color:${C.ink};text-decoration:none;">${escapeHtml(title)}</a>`
    : `<span class="ink" style="font:600 15px/1.4 ${FONT};color:${C.ink};">${escapeHtml(title)}</span>`;
  return `<tr><td class="rule" style="padding:10px 0;${border}">${head}` +
    `<div class="ink2" style="margin-top:3px;font:13px/1.5 ${FONT};color:${C.ink2};">${line}</div></td></tr>`;
}

type BriefingLine = { title: string; href: string | null; line: string; lineHtml: string };

export type BriefingParts = { subject: string; preheader: string; body: string; text: string };

// The message's parts: its subject, preview line, the body inside the shell
// (HTML) and the plain-text part without its footer.
export function briefingParts(o: Pick<BriefingDigest, "lang" | "site" | "briefing" | "name" | "data">): BriefingParts {
  const { lang, data: d, briefing: b } = o;
  const link = (path: string) => siteLink(o.site, path, lang);
  const segment = b.kind === "segment";
  const narrowed = b.kind === "buyer" && !!b.segment;
  const n = (v: number) => fmtInt(v, lang);
  const title = (en: string | null, fr: string | null) => pick(lang, en, fr) ?? t(lang, "common.not_stated");
  const buyerName = (en: string | null, fr: string | null) => pick(lang, en, fr) ?? t(lang, "common.not_stated");
  const segmentName = (sid: number) => `${String(sid).padStart(2, "0")} ${segmentShort(lang, String(sid).padStart(2, "0"))}`;
  const recordValue = (cents: number | null) => (cents === null ? t(lang, "briefing.no_value") : fmtMoney(cents / 100, lang));
  const html: string[] = [];
  const text: string[] = [];
  const quarter = d.ending.quarter;
  const qName = quarterName(lang, quarter);
  const qMonths = quarterMonths(lang, quarter);

  // Where each section's rest is on the site.
  const seg = segment ? b.subject : b.segment;
  const noticesPage = segment ? `/tenders?segment=${b.subject}` : `/tenders?buyer=${b.subject}${seg ? `&segment=${seg}` : ""}`;
  const recordsPage = segment ? `/segments/${b.subject}` : `/buyers/${b.subject}/records`;
  const radarPage = segment ? `/expiring/6m?segment=${b.subject}` : `/expiring/6m?buyer=${b.subject}${seg ? `&segment=${seg}` : ""}`;
  const analyticsPage = segment ? `/segments/${b.subject}/analytics` : `/buyers/${b.subject}/analytics`;

  const joined = (parts: (string | null)[]) => parts.filter((x): x is string => !!x);
  const plain = (parts: (string | null)[]) => {
    const kept = joined(parts);
    return { line: kept.join(" · "), lineHtml: kept.map(escapeHtml).join(" · ") };
  };
  // A section: its heading, its lines of figures, its rows, then the rest's
  // line; the plain text keeps a section's lines together. A row's plain text
  // is its title, its line and its link on three lines ("rows"), or the title
  // and the line on one: with no link ("line", the largest records, which
  // the analytics view follows), or with the link under it ("line+link", the
  // instruments, whose title is the number a reader quotes).
  type Layout = "rows" | "line" | "line+link";
  const section = (heading: string, notes: string[], lines: BriefingLine[], rest: number, restPath: string | null, layout: Layout = "rows") => {
    const block: string[] = [heading, ...notes];
    html.push(h2(heading), ...notes.map((x) => para(escapeHtml(x))));
    if (lines.length) html.push(rows(lines.map((l, i) => briefingRow(l.title, l.href ? link(l.href) : null, l.lineHtml, i === 0))));
    for (const l of lines) {
      const url = l.href ? `\n  ${link(l.href)}` : "";
      block.push(layout === "rows" ? `- ${l.title}\n  ${l.line}${url}` : `- ${l.title} · ${l.line}${layout === "line+link" ? url : ""}`);
    }
    if (rest > 0 && restPath) {
      const label = tn(lang, "briefing.more_one", "briefing.more_many", rest, { n: n(rest) });
      html.push(para(`<a href="${escapeHtml(link(restPath))}" style="color:${C.ink2};">${escapeHtml(label)}</a>`));
      block.push(t(lang, "digest.text_link", { label, url: link(restPath) }));
    }
    text.push(block.join("\n"));
  };
  // A last line of the section just written (a link, the quarter's turn).
  const tail = (lineText: string, lineHtml: string) => {
    html.push(lineHtml);
    text[text.length - 1] += `\n${lineText}`;
  };
  const linkLine = (label: string, path: string) =>
    tail(t(lang, "digest.text_link", { label, url: link(path) }), para(`<a href="${escapeHtml(link(path))}" style="color:${C.ink2};">${escapeHtml(label)}</a>`));

  const heading = t(lang, "briefing.title", { name: o.name, date: d.dataDate });
  const span = t(lang, "briefing.span", { first: addDays(d.start, 1), last: d.dataDate });
  html.push(h1(heading), para(escapeHtml(span), true));
  text.push(`${heading}\n${span}`);

  // 1. New notices, soonest closing first, with the time left (amber within AMBER_DAYS).
  section(
    d.notices.n ? t(lang, "briefing.notices_head", { n: n(d.notices.n) }) : t(lang, "briefing.notices_none"), [],
    d.notices.rows.map((r) => {
      const closes = closesText(lang, r.closing);
      const left = timeLeft(lang, r.closing, d.dataDate);
      const buyer = segment ? buyerName(r.buyer_en, r.buyer_fr) : null;
      const when = joined([closes, left?.text ?? null]).join(", ");
      const whenHtml = joined([closes ? escapeHtml(closes) : null,
        left ? (left.days <= AMBER_DAYS ? amber(escapeHtml(left.text)) : escapeHtml(left.text)) : null]).join(", ");
      return {
        title: title(r.title, r.title_fr), href: r.path, line: joined([buyer, when || null]).join(" · "),
        lineHtml: joined([buyer ? escapeHtml(buyer) : null, whenHtml || null]).join(" · "),
      };
    }),
    d.notices.n - d.notices.rows.length, noticesPage,
  );

  // 2. Awards, the largest first, each source's figures on a line of its own.
  const counted = d.awards.sources.filter((x) => x.src === null).reduce((sum, x) => sum + x.n, 0);
  section(
    d.awards.n ? t(lang, "briefing.awards_head", { n: n(d.awards.n) }) : t(lang, "briefing.awards_none"),
    d.awards.sources.map((x) => (x.src !== null && RECORD_SOURCE[x.src]
      ? t(lang, "briefing.source_line", { source: sourceLabel(lang, RECORD_SOURCE[x.src]), figures: briefingFigures(lang, x.n, x.cents, x.nv) })
      : t(lang, "briefing.uncounted", { n: n(x.n) }))),
    d.awards.rows.map((r) => ({
      title: title(r.title, r.title_fr), href: r.path,
      ...plain([
        r.org ?? t(lang, "briefing.withheld"),
        segment ? buyerName(r.buyer_en, r.buyer_fr) : !narrowed && r.sid !== null ? segmentName(r.sid) : null,
        recordValue(r.cents), r.src !== null && RECORD_KIND[r.src] ? t(lang, RECORD_KIND[r.src]) : null,
      ]),
    })),
    d.awards.n - counted - d.awards.rows.length, recordsPage,
  );

  // 3. The contracts ending next fiscal quarter, the largest first, those new to the list marked.
  section(
    d.ending.n
      ? t(lang, "briefing.ending_head", { quarter: qName, months: qMonths, figures: briefingFigures(lang, d.ending.n, d.ending.cents, d.ending.nv) })
      : t(lang, "briefing.ending_none", { quarter: qName, months: qMonths }),
    d.ending.n && d.ending.fresh ? [t(lang, "briefing.ending_fresh", { n: n(d.ending.fresh) })] : [],
    d.ending.rows.map(({ row: r, fresh }) => {
      const path = sitePath(r);
      const holder = r.supplier_withheld ? t(lang, "expiring.withheld") : r.organization ?? t(lang, "common.not_stated");
      const amended = r.n_amendments > 0
        ? tn(lang, "expiring.amendments_one", "expiring.amendments_many", r.n_amendments, { n: n(r.n_amendments) }) +
          (r.value_growth === null ? "" : `, ${growthPct(lang, r.value_growth)}`)
        : null;
      const kept = joined([
        holder, segment ? buyerName(r.buyer_en, r.buyer_fr) : null, t(lang, "briefing.ends", { date: r.end.slice(0, 10) }),
        r.value === null ? t(lang, "common.not_stated") : fmtMoney(r.value, lang, r.currency), amended,
      ]);
      const mark = fresh ? t(lang, "briefing.fresh") : null;
      return {
        title: pick(lang, r.title_en, r.title_fr) ?? contractReference(r), href: path.startsWith("/") ? path : null,
        line: joined([...kept, mark]).join(" · "),
        lineHtml: [...kept.map(escapeHtml), ...(mark ? [amber(escapeHtml(mark))] : [])].join(" · "),
      };
    }),
    0, null,
  );
  if (d.ending.n) linkLine(t(lang, "briefing.radar_link"), radarPage);
  if (d.turn) {
    const turn = t(lang, "briefing.turn", { date: d.turn.on, quarter: quarterName(lang, d.turn.quarter), months: quarterMonths(lang, d.turn.quarter) });
    tail(turn, para(escapeHtml(turn), true));
  }

  // 4. Notable amendments, the largest change first.
  section(
    d.amended.n ? t(lang, "briefing.amended_head", { n: n(d.amended.n) }) : t(lang, "briefing.amended_none"), [],
    d.amended.rows.map((r) => ({
      title: title(r.title, r.title_fr), href: r.path,
      ...plain([
        r.org ?? t(lang, "briefing.withheld"), segment ? buyerName(r.buyer_en, r.buyer_fr) : null,
        r.cents !== null && r.ocents !== null
          ? t(lang, "watches.line_was", {
            value: fmtMoney(r.cents / 100, lang), was: fmtMoney(r.ocents / 100, lang), change: valueChange(lang, r.ocents, r.cents),
          })
          : null,
        r.oendd && r.endd ? t(lang, "watches.line_end_moved", { from: r.oendd.slice(0, 10), to: r.endd.slice(0, 10) }) : null,
      ]),
    })),
    d.amended.n - d.amended.rows.length, recordsPage,
  );

  // 5. The fiscal year's largest records, one line each.
  const fy = fiscalLabel(lang, d.largest.fy);
  section(
    d.largest.rows.length ? t(lang, "briefing.largest_head", { fy, n: n(d.largest.rows.length) }) : t(lang, "briefing.largest_none", { fy }), [],
    d.largest.rows.map((r) => ({
      title: title(r.title, r.title_fr), href: r.path,
      ...plain([
        r.org ?? t(lang, "briefing.withheld"), segment ? buyerName(r.buyer_en, r.buyer_fr) : null, fmtMoney(r.cents / 100, lang), r.day,
        RECORD_KIND[r.src] ? t(lang, RECORD_KIND[r.src]) : null,
      ]),
    })),
    0, null, "line",
  );
  const analytics = t(lang, segment ? "briefing.analytics_segment" : "briefing.analytics_buyer");
  linkLine(analytics, analyticsPage);

  // 6. The standing offers and supply arrangements ending within 6 months,
  // the soonest first, with their holders. The end user is named on a
  // segment briefing only: on a buyer's it is the buyer. The rest are on the
  // instruments index with the same filters, which counts the same rows.
  const instrumentsPage = `/instruments${instrumentQueryString({
    type: "", region: "", segment: seg, commodity: "", user: segment ? "" : b.subject, within: d.instruments.within, sort: "",
  })}`;
  section(
    d.instruments.n ? t(lang, "briefing.instruments_head", { n: n(d.instruments.n) }) : t(lang, "briefing.instruments_none"), [],
    d.instruments.rows.map((r) => ({
      title: r.agr, href: instrumentPath(r.agr),
      ...plain([
        pick(lang, r.type_en, r.type_fr), pick(lang, r.desc_en, r.desc_fr), segment ? pick(lang, r.user_en, r.user_fr) : null,
        t(lang, "watches.line_expires", { date: r.expiry }),
        tn(lang, "watches.line_holders_one", "watches.line_holders_many", r.n, { n: n(r.n) }),
      ]),
    })),
    0, null, "line+link",
  );
  if (d.instruments.n) {
    linkLine(tn(lang, "briefing.instruments_all_one", "briefing.instruments_all_many", d.instruments.n, { n: n(d.instruments.n) }), instrumentsPage);
  }

  const note = joined([
    t(lang, "briefing.note"), segment ? t(lang, "briefing.note_segment") : null, narrowed ? t(lang, "briefing.note_narrowed") : null,
  ]).join(" ");
  html.push(para(escapeHtml(note), true));
  text.push(note);

  // The subject names the week's counts that are not zero and the quarter's.
  const what = joined([
    d.notices.n ? tn(lang, "briefing.subj_notices_one", "briefing.subj_notices_many", d.notices.n, { n: n(d.notices.n) }) : null,
    d.awards.n ? tn(lang, "briefing.subj_awards_one", "briefing.subj_awards_many", d.awards.n, { n: n(d.awards.n) }) : null,
    d.ending.n ? tn(lang, "briefing.subj_ending_one", "briefing.subj_ending_many", d.ending.n, { n: n(d.ending.n) }) : null,
  ]);
  if (!what.length && d.amended.n) what.push(tn(lang, "briefing.subj_amended_one", "briefing.subj_amended_many", d.amended.n, { n: n(d.amended.n) }));
  const subject = fitCounts(what, (shown) => t(lang, "briefing.subject", { name: o.name, what: shown.join(", ") }));
  const total = d.ending.cents === null ? t(lang, "briefing.no_total") : fmtMoneyShort(d.ending.cents / 100, lang);
  const preheader = joined([
    d.awards.n ? t(lang, "briefing.pre_awards", { n: n(d.awards.n) }) : null,
    d.ending.n
      ? tn(lang, "briefing.pre_quarter_one", "briefing.pre_quarter_many", d.ending.n, { quarter: qName, n: n(d.ending.n), total, fresh: n(d.ending.fresh) })
      : t(lang, "briefing.pre_quarter_none", { quarter: qName }),
  ]).join(" ");
  return { subject, preheader, body: html.join(""), text: text.join("\n\n") };
}

export function briefingDigest(o: BriefingDigest): DigestMessage {
  const { lang } = o;
  const parts = briefingParts(o);
  const searches = siteLink(o.site, "/account/searches", lang);
  const why = t(lang, "briefing.why");
  const link = (href: string, key: Key) => `<a href="${escapeHtml(href)}" style="color:${C.muted};">${escapeHtml(t(lang, key))}</a>`;
  const whyText = [
    why,
    t(lang, "digest.text_link", { label: t(lang, "briefing.searches_link"), url: searches }),
    t(lang, "digest.text_link", { label: t(lang, "briefing.stop_link"), url: o.stopUrl }),
  ].join("\n");
  return {
    to: o.to, subject: parts.subject, lang, headers: deliveryHeaders(o.stopUrl), text: `${parts.text}\n\n${whyText}\n${textFooter(lang)}`,
    html: shell({
      lang, site: o.site, subject: parts.subject, preheader: parts.preheader, body: parts.body,
      why: `${escapeHtml(why)} ${link(searches, "briefing.searches_link")} · ${link(o.stopUrl, "briefing.stop_link")}`,
    }),
  };
}
