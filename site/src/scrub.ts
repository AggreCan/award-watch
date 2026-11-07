// Contact details in text a reader types into a public form. The site keeps
// no contact it does not need (the merge report asks for no email address),
// so an email address or a telephone or fax number written into the text is
// replaced before the row is stored, the same way the export scrubs the
// publishers' prose (pipeline/awardwatch_pipeline/export.py scrub). The
// patterns below are that function's, with Python's Unicode \w written out,
// since \w in a JavaScript pattern matches ASCII only.
//
// A number counts as a telephone number only when it is written as one:
// three, three and four digits with a separator between the groups, with or
// without a leading 1 or +1 and an extension. A bare run of digits is left
// alone (a contract number, a business number), except ten digits straight
// after a telephone or fax label.

import type { Lang } from "./i18n";

export const CONTACT_REMOVED: Record<Lang, string> = { en: "[contact removed]", fr: "[coordonnées retirées]" };

const W = "[\\p{L}\\p{N}_]";
const EMAIL_RE = new RegExp(`[\\p{L}\\p{N}_.+%'-]+\\s?@\\s?[\\p{L}\\p{N}_-]+(?:\\.[\\p{L}\\p{N}_-]+)+`, "gu");
// Not joined to a letter, a digit, a "+", a hyphen, or a decimal ("49.613 555 0100" is a coordinate).
const PHONE_START = `(?<![\\p{L}\\p{N}_+\\-])(?<!\\d\\.)`;
// Not followed by another digit, or by a decimal point, comma or hyphen and a digit ("400-013-4490-41" is a part number).
const PHONE_END = `(?!\\d)(?![.,\\-]\\d)`;
const EXTENSION = `(?:\\s*,?\\s*(?:ext\\.?|extension|x|poste|p\\.)\\s*\\d{1,6})?`;
const PHONE_RE = new RegExp(
  PHONE_START + `(?:\\+\\s?1[\\s.\\-]?|1[\\s.\\-])?` + `(?:\\(\\s?\\d{3}\\s?\\)\\s?|\\d{3}[ .\\-])` + `\\d{3}[ .\\-]\\d{4}` + EXTENSION + PHONE_END,
  "giu",
);
const LABELLED_PHONE_RE = new RegExp(
  `(?<!${W})(?<label>(?:tel|t[eé]l|phone|t[eé]l[eé]phone|telephone|fax|t[eé]l[eé]copieur|t[eé]l[eé]c|cell|mobile)` +
    `\\.?\\s*(?:[:#.]\\s*)?)(?:\\+?1)?\\d{10}` + EXTENSION + `(?!${W})`,
  "giu",
);
// An @ the address pattern did not take still goes; one standing alone between spaces is not an address.
const STRAY_AT_RE = /(?<=\S)@|@(?=\S)/g;

export function scrubContacts(text: string, lang: Lang = "en"): string {
  if (!text) return text;
  const mark = CONTACT_REMOVED[lang === "fr" ? "fr" : "en"];
  let out = text.replace(EMAIL_RE, mark).replace(PHONE_RE, mark);
  out = out.replace(LABELLED_PHONE_RE, (...args) => `${(args[args.length - 1] as { label: string }).label}${mark}`);
  return out.replace(STRAY_AT_RE, mark);
}
