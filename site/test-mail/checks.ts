// The checks every message the site sends is held to (docs/mail.md), shared
// by the mail suite's files. A message is checked as it leaves through the
// log sender (sender.ts logSender: the development outbox, the sent_mail
// table), the sender a local run uses, so what is checked is what a sender
// was handed.
//
// The two parts are compared in both directions. The text part's lines,
// split at " · " and ", " with their links taken out, must each be found in
// the HTML part's visible text; the HTML part's visible text, split the same
// way and at every element, must each be found in the text part. A few lines
// are worded for one part by design (the sign-in message's lead beside its
// button, the text part's "Saved searches and delivery" line, the shell's
// tagline in the address-change notice, whose text part ends on its contact
// line); a shape names them by their dictionary keys, so the exception holds
// in both languages and nothing else slips through it. The web links must be
// the same set in both parts, the header's link to the home page aside (the
// text part has no header), and an address the HTML part links with mailto:
// is written out in the text part.
//
// Every message is laid out in the one shell (src/account/mail_html.ts): its
// HTML part must carry the shell's header (the wordmark linking the site) and
// its footer (the tagline and the contact address), a preheader, at most one
// button, and no image but the two wordmarks, which are the same two files
// for every reader.
//
// A client that honours the dark query (Apple Mail, iOS Mail) recolours the
// classes the shell names, and a link keeps its own inline colour unless a
// rule names the link itself. So every link that carries a colour must be
// reached by a dark rule: its own class recoloured, or a rule for the links
// inside a class around it. A paragraph link once kept the light ink on the
// dark card and could not be read.
//
// A section's heading sits in its band (mail_html.ts h2), in capitals by its
// style; the HTML part's visible text reads it in capitals, as the reader
// sees it, and the text part must write it so. Each band is held, in the
// light colours inline and in the dark rules, to its words at HEADING_MIN on
// the band, the band at BAND_MIN against the card, and its edge, the
// header's emerald, at EDGE_MIN against the card; and its heading free to
// wrap inside it on a phone.
import { expect } from "vitest";
import { sendWithHeaders } from "../src/account/deliveries";
import { deliveryHeaders, siteLink } from "../src/account/digests";
import type { MailMessage } from "../src/account/sender";
import { CODE_MINUTES } from "../src/account/signin";
import { t, type Key, type Lang } from "../src/i18n";
import { CONTACT_EMAIL } from "../src/pages/docs";
import { decode, lastMail, nbsp, onEnv } from "../test/accounts-helpers";

export const LOCAL = "http://localhost";
// A subject must stay under this many characters, the mark of the live check included.
export const SUBJECT_MAX = 100;
// The only addresses a message may name: the site's two role addresses.
export const ROLE_ADDRESSES: ReadonlySet<string> = new Set([CONTACT_EMAIL, "alerts@awardwatch.ca"]);
const EM_DASH = String.fromCharCode(0x2014);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const STOP_RE = /\/(?:account|interest)\/stop\?/;

export type Sent = MailMessage & { headers?: Record<string, string> };

// What a message is, for the checks.
export interface Shape {
  // The name the failures quote.
  name: string;
  // Where its links point, no trailing slash.
  site: string;
  // A list or watch delivery: a stop link in both parts, the reason line, and
  // List-Unsubscribe while the stop link is https.
  list: boolean;
  // The reason the message came, in both parts; null for a message without one.
  why: Key | null;
  // The page that manages the delivery, a path on the site, in both parts.
  manage?: string | null;
  // Lines worded for one part by design, as dictionary keys and their values.
  onePart?: readonly (readonly [Key, Record<string, string | number>?])[];
}

// -- the dark rules and the links -----------------------------------------------------------------

// The dark query's rules, read from the message itself.
function darkBlock(html: string): string {
  const at = html.indexOf("@media (prefers-color-scheme: dark){");
  return at < 0 ? "" : html.slice(at, html.indexOf("@media only screen", at));
}

// The selectors the dark query recolours.
export function darkColoured(html: string): Set<string> {
  const out = new Set<string>();
  for (const [, selectors, rule] of darkBlock(html).matchAll(/([.a-z0-9 ,-]+)\{([^}]*)\}/g)) {
    if (!/(?:^|;)color:/.test(rule)) continue;
    for (const s of selectors.split(",")) out.add(s.trim());
  }
  return out;
}

// A style's declarations by property, "!important" off.
function declarations(style: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of style.split(";")) {
    const at = part.indexOf(":");
    if (at > 0) out.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).replace(/!important/i, "").trim());
  }
  return out;
}

// The dark query's declarations by selector.
function darkDeclarations(html: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const [, selectors, rule] of darkBlock(html).matchAll(/([.a-z0-9 ,-]+)\{([^}]*)\}/g)) {
    for (const s of selectors.split(",")) out.set(s.trim(), declarations(rule));
  }
  return out;
}

// -- the section bands ----------------------------------------------------------------------------

// WCAG 2 contrast of two #rrggbb colours.
const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// A heading's words on its band, as body text (WCAG 1.4.3); the band against
// the card, a step the eye finds (the site's panel head is 1.26 on the light
// panel); the edge against the card, as a boundary (WCAG 1.4.11).
export const HEADING_MIN = 4.5;
export const BAND_MIN = 1.2;
export const EDGE_MIN = 3;

const HEX_RE = /#[0-9a-f]{6}\b/i;
const attrOf = (attrs: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(attrs)?.[1] ?? "";
const classesOf = (attrs: string) => attrOf(attrs, "class").split(/\s+/).filter(Boolean);
const hexOf = (v: string | undefined) => (v ? HEX_RE.exec(v)?.[0].toLowerCase() ?? null : null);

// What a dark client gives an element: the first of its classes with a dark rule for the property.
function darkOf(dark: Map<string, Map<string, string>>, classes: string[], prop: string): string | null {
  for (const c of classes) {
    const v = hexOf(dark.get(`.${c}`)?.get(prop));
    if (v) return v;
  }
  return null;
}

// What is wrong with the message's section bands, one line each; none when
// every h2 is the first thing in its band and each band holds in both schemes.
export function bandProblems(html: string): string[] {
  const body = html.slice(html.indexOf("<body"));
  const dark = darkDeclarations(html);
  const card = { light: hexOf(declarations(attrOf(/<table\b[^>]*class="wrap card"[^>]*>/.exec(body)?.[0] ?? "", "style")).get("background")),
    dark: hexOf(dark.get(".card")?.get("background")) };
  const emerald = hexOf(/border-bottom:2px solid (#[0-9a-f]{6})/.exec(body)?.[1]);
  const out: string[] = [];
  if (!card.light || !card.dark || !emerald) return ["the shell's card or header rule is not found"];
  const bands = [...body.matchAll(/<td\b([^>]*)><h2\b([^>]*)>([^<]*)<\/h2>/g)];
  const heads = (body.match(/<h2\b/g) ?? []).length;
  if (bands.length !== heads) out.push(`${heads - bands.length} of ${heads} headings not the first thing in a cell`);
  for (const [, td, h, words] of bands) {
    const name = `"${words}"`;
    const style = declarations(attrOf(td, "style"));
    const ground = hexOf(style.get("background"));
    const bgcolor = hexOf(attrOf(td, "bgcolor"));
    const face = declarations(attrOf(h, "style"));
    const ink = hexOf(face.get("color"));
    const edge = hexOf(style.get("border-left"));
    // On a phone a long heading wraps inside its band.
    if (face.get("white-space") === "nowrap" || face.get("word-break") !== "break-word") out.push(`${name}: the heading cannot wrap inside its band`);
    if (!ground || !bgcolor || ground !== bgcolor) {
      out.push(`${name}: the band's bgcolor (${bgcolor}) and its inline ground (${ground}) differ or are missing`);
      continue;
    }
    if (!ink) out.push(`${name}: no inline colour on the heading`);
    else if (contrast(ink, ground) < HEADING_MIN) out.push(`${name}: light, the heading at ${contrast(ink, ground).toFixed(2)} on its band`);
    if (contrast(ground, card.light) < BAND_MIN) out.push(`${name}: light, the band at ${contrast(ground, card.light).toFixed(2)} on the card`);
    if (edge !== emerald) out.push(`${name}: the edge (${edge}) is not the header's emerald (${emerald})`);
    else if (contrast(edge, card.light) < EDGE_MIN) out.push(`${name}: light, the edge at ${contrast(edge, card.light).toFixed(2)} on the card`);
    const darkGround = darkOf(dark, classesOf(td), "background");
    const darkInk = darkOf(dark, classesOf(h), "color");
    const darkEdge = darkOf(dark, classesOf(td), "border-color") ?? edge;
    if (!darkGround || !darkInk) {
      out.push(`${name}: no dark rule for the band's ground (${darkGround}) or the heading's words (${darkInk})`);
      continue;
    }
    if (contrast(darkInk, darkGround) < HEADING_MIN) out.push(`${name}: dark, the heading at ${contrast(darkInk, darkGround).toFixed(2)} on its band`);
    if (contrast(darkGround, card.dark) < BAND_MIN) out.push(`${name}: dark, the band at ${contrast(darkGround, card.dark).toFixed(2)} on the card`);
    if (darkEdge && contrast(darkEdge, card.dark) < EDGE_MIN) out.push(`${name}: dark, the edge at ${contrast(darkEdge, card.dark).toFixed(2)} on the card`);
  }
  return out;
}

// The coloured links no dark rule reaches, each as its opening tag. A link
// with no colour of its own (the wordmark's) takes the colour around it.
export function linksLeftLight(html: string): string[] {
  const dark = darkColoured(html);
  const body = html.slice(html.indexOf("<body"));
  const VOID = new Set(["img", "br", "meta", "link", "hr", "input"]);
  const open: string[][] = [];
  const left: string[] = [];
  for (const [tag, close, name, attrs] of body.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/gi)) {
    const el = name.toLowerCase();
    if (VOID.has(el)) continue;
    if (close) { open.pop(); continue; }
    const classes = (/\sclass="([^"]*)"/.exec(attrs)?.[1] ?? "").split(/\s+/).filter(Boolean);
    if (el === "a" && /\sstyle="(?:[^"]*;)?\s*color:/.test(attrs)) {
      const own = classes.some((c) => dark.has(`.${c}`));
      const around = open.flat().some((c) => dark.has(`.${c} a`));
      if (!own && !around) left.push(tag);
    }
    open.push(classes);
  }
  return left;
}

// -- reading the two parts ----------------------------------------------------------------------

const BLOCK = "p|h1|h2|div|td|tr|li|ul|ol|table|body|html|title";
const INLINE = "a|span|b";

// The words of an element whose style sets them in capitals (a section's
// heading), in capitals as the reader sees them; an entity is left whole.
const capitals = (html: string, lang: Lang) =>
  html.replace(/(<([a-z0-9]+)\b[^>]*\sstyle="[^"]*text-transform:uppercase[^"]*"[^>]*>)([^<]*)(<\/\2>)/gi,
    (_all, open: string, _tag: string, words: string, close: string) =>
      open + words.replace(/&[^;\s]*;|[^&]+/g, (s) => (s.startsWith("&") ? s : s.toLocaleUpperCase(lang))) + close);

// The HTML part's visible text: the head and the hidden preheader left out,
// images (the wordmarks' alternative text) left out, the words a style sets
// in capitals in capitals, a line break at every block element and, when
// fine, at every inline one too.
function visible(html: string, fine: boolean, lang: Lang): string {
  const tags = fine ? `${BLOCK}|${INLINE}` : BLOCK;
  return decode(capitals(html, lang)
    .replace(/<head>[\s\S]*?<\/head>/i, "")
    .replace(/<div style="display:none;[^"]*">[\s\S]*?<\/div>/i, "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(new RegExp(`</?(?:${tags})\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " "));
}

const LINK_RE = /(?:https?:\/\/|mailto:)\S+/g;

// -- the shell ---------------------------------------------------------------------------------------

// The header's wordmark: a link to the site around the light wordmark.
export const shellHeader = (site: string) =>
  `<a href="${site}" style="text-decoration:none;"><img class="logo-light" src="${site}/brand/wordmark.png"`;

// The footer's last line, the tagline then the contact address, as the HTML
// part reads once its entities are decoded.
export const shellFooter = (lang: Lang) =>
  `${t(lang, "site.name")} · ${t(lang, "site.tagline")} · <a href="mailto:${CONTACT_EMAIL}" style="color:#5b6b80;">${CONTACT_EMAIL}</a></p>`;

const PREHEADER_RE = /<div style="display:none;[^"]*">([^<]*)<\/div>/;
const imagesIn = (html: string) => [...html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/g)].map((m) => decode(m[1]));
const buttonsIn = (html: string) => (html.match(/<td class="btn"/g) ?? []).length;

// A part's lines cut into the pieces compared: at line ends, " · " and ", ",
// links out, list dashes and a closing colon off, spaces collapsed; pieces
// with no letter or digit dropped.
export function pieces(text: string): string[] {
  return nbsp(text).split("\n")
    .flatMap((line) => line.replace(LINK_RE, " ").split(/ · |, /))
    .map((s) => s.replace(/\s+/g, " ").trim().replace(/^[-·,]\s*/, "").replace(/\s*[:·,]$/, "").trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// A part as running lines, links out and spaces collapsed, for finding a piece of the other part in it.
const flow = (text: string) => nbsp(text).replace(LINK_RE, " ").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).join("\n");

// The links of each part. The header's two links to the home page (the
// wordmark and the host name) are the HTML part's alone.
const hrefs = (html: string) => [...html.matchAll(/\shref="([^"]*)"/g)].map((m) => decode(m[1]));

export function htmlLinks(html: string, site: string, lang: Lang): Set<string> {
  const home = new Set([site, `${site}/`, siteLink(site, "/", lang)]);
  return new Set(hrefs(html).filter((u) => /^https?:\/\//.test(u) && !home.has(u)));
}

export function textLinks(text: string): Set<string> {
  return new Set(text.match(/https?:\/\/\S+/g) ?? []);
}

// Every address a message names, in its subject, its text, its HTML and its links.
export function addressesIn(m: Sent): string[] {
  return [...new Set([m.subject, m.text, decode(m.html)].flatMap((s) => s.match(EMAIL_RE) ?? []))];
}

// -- the checks ------------------------------------------------------------------------------------

export function checkMessage(m: Sent, shape: Shape, lang: Lang, o: { others?: readonly string[] } = {}): void {
  const what = `${shape.name} (${lang})`;

  // The subject: present, one line, under SUBJECT_MAX characters.
  expect(m.subject.trim(), `${what}: subject`).not.toBe("");
  expect(m.subject, `${what}: subject on one line`).not.toMatch(/[\r\n]/);
  expect([...m.subject].length, `${what}: subject length`).toBeLessThan(SUBJECT_MAX);
  expect(m.lang, what).toBe(lang);
  expect(m.html, what).toMatch(new RegExp(`<html lang="${lang}"`, "i"));

  // The shell: its header and its footer, a preheader, one button at most, no
  // image but the two wordmarks (Gmail's Promotions tab weighs images and
  // buttons, and an image that differs per reader would tell who opened it).
  expect(m.html.includes(shellHeader(shape.site)), `${what}: the shell's header`).toBe(true);
  expect(decode(m.html).includes(shellFooter(lang)), `${what}: the shell's footer`).toBe(true);
  expect(PREHEADER_RE.exec(m.html)?.[1].trim(), `${what}: the preheader`).toBeTruthy();
  expect(buttonsIn(m.html), `${what}: one button at most`).toBeLessThanOrEqual(1);
  expect(imagesIn(m.html), `${what}: no image but the wordmarks`).toEqual([`${shape.site}/brand/wordmark.png`, `${shape.site}/brand/wordmark-dark.png`]);

  // Every coloured link is reached by a rule of the dark query.
  expect(linksLeftLight(m.html), `${what}: links a dark client leaves in the light ink`).toEqual([]);

  // Every section heading in its band, which holds in the light colours and the dark rules.
  expect(bandProblems(m.html), `${what}: the section bands`).toEqual([]);

  // No em-dash anywhere.
  for (const [part, s] of [["subject", m.subject], ["text", m.text], ["html", m.html]] as const) {
    expect(s.includes(EM_DASH), `${what}: an em-dash in the ${part}`).toBe(false);
  }

  // No address but the site's role addresses: never the reader's own, never another reader's.
  for (const address of addressesIn(m)) expect(ROLE_ADDRESSES.has(address), `${what}: names ${address}`).toBe(true);
  for (const other of o.others ?? []) {
    expect(`${m.subject}\n${m.text}\n${decode(m.html)}`.includes(other), `${what}: names another reader`).toBe(false);
  }

  // The same links in both parts; nothing but web and mail links; the contact address in both or neither.
  const inHtml = htmlLinks(m.html, shape.site, lang);
  const inText = textLinks(m.text);
  expect([...inText].sort(), `${what}: the links`).toEqual([...inHtml].sort());
  for (const href of hrefs(m.html)) {
    expect(/^(?:https?:\/\/|mailto:)/.test(href), `${what}: link ${href}`).toBe(true);
    if (href.startsWith("mailto:")) expect(m.text.includes(href.slice("mailto:".length)), `${what}: ${href} in the text part`).toBe(true);
  }
  expect(m.text.includes(CONTACT_EMAIL), `${what}: the contact address`).toBe(visible(m.html, false, lang).includes(CONTACT_EMAIL));

  // The same lines in both parts, each direction.
  const host = new URL(shape.site).host;
  const skip = new Set((shape.onePart ?? []).flatMap(([key, vars]) => pieces(t(lang, key, vars))));
  const textFlow = flow(m.text);
  const htmlFlow = flow(visible(m.html, false, lang));
  for (const piece of pieces(visible(m.html, true, lang))) {
    if (piece === host || skip.has(piece)) continue;
    expect(textFlow.includes(piece), `${what}: the HTML part's "${piece}" is not in the text part`).toBe(true);
  }
  for (const piece of pieces(m.text)) {
    if (skip.has(piece)) continue;
    expect(htmlFlow.includes(piece), `${what}: the text part's "${piece}" is not in the HTML part`).toBe(true);
  }

  // The reason the message came, in both parts.
  if (shape.why) {
    const why = nbsp(t(lang, shape.why));
    expect(textFlow.includes(why), `${what}: the reason line in the text part`).toBe(true);
    expect(htmlFlow.includes(why), `${what}: the reason line in the HTML part`).toBe(true);
  }

  // A list or watch delivery: its stop link in both parts (the link sets are
  // equal), the page that manages it, and List-Unsubscribe while the link is https.
  const stops = [...inHtml].filter((u) => STOP_RE.test(u));
  const headers = m.headers ?? {};
  if (shape.list) {
    expect(stops, `${what}: one stop link`).toHaveLength(1);
    const stop = stops[0];
    if (stop.startsWith("https://")) expect(headers, `${what}: List-Unsubscribe`).toEqual(deliveryHeaders(stop));
    else expect(headers["List-Unsubscribe"], `${what}: no List-Unsubscribe for an http link`).toBeUndefined();
    if (shape.manage) {
      const manage = siteLink(shape.site, shape.manage, lang);
      expect(inHtml.has(manage) && inText.has(manage), `${what}: the manage link ${manage}`).toBe(true);
    }
  } else {
    expect(stops, `${what}: no stop link`).toEqual([]);
    expect(headers["List-Unsubscribe"], `${what}: no List-Unsubscribe`).toBeUndefined();
  }
}

// The message handed to the log sender through the path the jobs use
// (deliveries.ts sendWithHeaders, on a local host with MAIL_SENDER=log), then
// read back from the outbox: what was stored is what was built.
export async function viaLogSender(m: Sent): Promise<Sent> {
  const sent = await sendWithHeaders(onEnv() as never, `${LOCAL}/test-mail`, { ...m, headers: m.headers ?? {} });
  expect(sent).toEqual({ sent: true, code: null });
  const row = await lastMail(m.to);
  expect(row).toEqual({ to_addr: m.to, subject: m.subject, text: m.text, html: m.html, lang: m.lang });
  return m;
}

// Each kind of message: what it is, for checkMessage. The cadence of a
// saved-search delivery changes its reason line only.
export const SHAPES = {
  sign_in: {
    list: false, why: "account.mail_why",
    onePart: [["account.mail_lead", { minutes: CODE_MINUTES }], ["account.mail_button"], ["account.mail_text_link"]],
  },
  digest_daily: { list: true, why: "digest.why_daily", manage: "/account/searches", onePart: [["digest.text_searches"]] },
  digest_weekly: { list: true, why: "digest.why_weekly", manage: "/account/searches", onePart: [["digest.text_searches"]] },
  watch: { list: true, why: "watches.digest_why", manage: "/account/watches" },
  briefing: { list: true, why: "briefing.why", manage: "/account/searches" },
  weekly: { list: true, why: "weekly.why", manage: "/account" },
  accounts_open: { list: true, why: "announce.why", manage: null },
  ultra_open: { list: true, why: "announce.ultra_why", manage: null },
  // The shell's footer prints the tagline; the notice's text part, which
  // ends on the contact line, does not.
  address_notice: { list: false, why: null, onePart: [["account.sign_in"], ["admin.mail_sign_in", { link: "" }], ["site.tagline"]] },
} as const satisfies Record<string, Omit<Shape, "name" | "site">>;

export const shapeOf = (kind: keyof typeof SHAPES, name: string, site: string): Shape => ({ ...SHAPES[kind], name, site });
