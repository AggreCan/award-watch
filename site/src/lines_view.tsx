// The holder's record on the radar's window pages (src/pages/expiring.tsx):
// the mark under a holder's name, and what the list says under its table.
// A mark is the label and its figure, never the label alone; a reader not
// signed in sees one line saying signed-in readers see the records, the same
// for everyone, so a shared cache can keep the page. The record's panel on a
// contract's page is src/pages/holders.tsx.

import type { FC } from "hono/jsx";
import { AdvisoryDisclaimer } from "./fit";
import { fmtInt, t, tj, tn, type Key, type Lang } from "./i18n";
import { type Band, LINE_YEARS, type LineRecord, lineLabel } from "./lines";

export const BAND_KEY: Readonly<Record<Band, Key>> = { run: "line.band_run", earlier: "line.band_earlier", none: "line.band_none" };

// The label's figure in words: "7 back to back", "8 earlier"; none for no earlier record, whose label is its figure.
export function shortFigure(lang: Lang, band: Band, n: number): string | null {
  if (band === "run") return t(lang, "line.short_run", { n: fmtInt(n, lang) });
  if (band === "earlier") return tn(lang, "line.short_earlier_one", "line.short_earlier_many", n, { n: fmtInt(n, lang) });
  return null;
}

// The mark under a holder's name on a radar row: "Long run · 7 back to back",
// "No earlier record", with "similar name" after it when the line lists one.
// Null when the record has no label (no kind of work in any source).
export function markText(lang: Lang, j: LineRecord): string | null {
  const label = lineLabel(j);
  if (!label) return null;
  const parts = [t(lang, BAND_KEY[label.band]), shortFigure(lang, label.band, label.figure), j.sim.length ? t(lang, "line.short_similar") : null];
  return parts.filter((p): p is string => p !== null).join(" · ");
}

// The line it takes in the supplier cell, after a break, so the column's
// sort (public/sort.js reads a cell up to its first break) stays the name's.
export const RadarMark: FC<{ text: string }> = ({ text }) => (
  <>
    <br />
    <span class="muted small line-mark">{text}</span>
  </>
);

// What a window's list knows of its rows' records. off: the accounts switch
// is off, and nothing is said. signed_out: one line, with a way to sign in.
// absent: the records database holds no rec_lines yet (the nightly has not
// run the stage), and the page reads as it did. unavailable: the database
// could not answer. ready: the marks by row key; pending when the rows the
// plan covers have no record yet.
export type RadarLines =
  | { state: "off" | "signed_out" | "absent" | "unavailable" }
  | { state: "ready"; marks: ReadonlyMap<string, string>; pending: boolean };

export const RadarLineNotes: FC<{ lang: Lang; lines: RadarLines }> = ({ lang, lines }) => {
  switch (lines.state) {
    case "signed_out":
      return (
        <p class="muted small line-signin">
          {tj(lang, "line.signed_out", { signin: <a href="/account/sign-in">{t(lang, "account.sign_in")}</a> })}
        </p>
      );
    case "unavailable":
      return <p class="muted small">{t(lang, "line.unavailable")}</p>;
    case "ready":
      if (lines.marks.size) {
        return (
          <>
            <p class="muted small">{t(lang, "line.legend", { years: fmtInt(LINE_YEARS, lang) })}</p>
            <AdvisoryDisclaimer lang={lang} kind="line" />
            <p class="muted small">{t(lang, "data.credit")}</p>
          </>
        );
      }
      return lines.pending ? <p class="muted small">{t(lang, "line.pending")}</p> : null;
    default:
      return null;
  }
};
