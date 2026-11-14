// /guides and /guides/<slug>: plain explanations of the federal records the
// site reads, on the Methodology page's document layout. The text is
// src/guides.ts's, English and French side by side; this file only draws it.
// The frame's words (the index's lead, the checked line, the sources' head)
// are the dictionary's. docs/guides.md says how to add a guide.
//
// A guide that declares an action ends, before its sources, on the email list
// it is about: the lists' own form (pages/interest.tsx InterestBody), posting
// where it posts on the list pages, under a band of the document with the
// guide's sentence. Its line offering Pro is left out, as a guide links no
// account page. The form is drawn for a reader not signed in while the
// accounts switch is on, the same for every such reader; with the switch off,
// or for a signed-in reader, a guide is as it was. The plain lists read no
// file; a list of one notice type reads the open notices' facets, as the
// tender list's own form does, to name the type.
//
// A figure (docs/guides.md, Figures) is a capture of one of the site's own
// pages, rendered from sample records: both themes' pictures, the stylesheet
// showing the one of the reader's theme, each with the phone file at the
// phone breakpoint, lazy-loaded with their sizes so nothing shifts and the
// hidden theme's file is never fetched. The numbered marks are drawn by the
// page over the image, in percent of it, so they take the theme and stay
// sharp; they are hidden from screen readers, and the legend under the image
// says each mark's sentence as page text.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { readSession } from "../account/session";
import { accountsEnabled } from "../account/switch";
import { Table, type Column } from "../columns";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { GUIDE_FIGURES } from "../guide_figures.gen";
import { GUIDES, guideBySlug, type Block, type Both, type Cell, type Figure, type FigureShot, type Guide, type Text } from "../guides";
import { fmtMoney, frTypography, t, type Lang } from "../i18n";
import { Layout, PageHead, lowerRedirect, notFoundPage, page } from "../layout";
import { guideSeo, pageSeo } from "../seo";
import { InterestBody, interestFilter } from "./interest";

// A guide's words in the reader's language. French takes the dictionary's
// typography, and a no-break space inside a grouped figure ("10 000 $"), so
// a figure never breaks across lines.
export function guideText(lang: Lang, b: Both): string {
  if (lang !== "fr") return b.en;
  return frTypography(b.fr).replace(/(\d) (?=\d{3}(?!\d))/g, "$1 ");
}

// Running text with its {slot} links drawn in, as tj() draws a dictionary string.
const Inline: FC<{ lang: Lang; text: Text }> = ({ lang, text }) => {
  const s = guideText(lang, text);
  const out: unknown[] = [];
  let last = 0;
  for (const m of s.matchAll(/\{(\w+)\}/g)) {
    const at = m.index ?? 0;
    if (at > last) out.push(s.slice(last, at));
    const link = text.links?.[m[1]];
    out.push(link ? <a href={link.href}>{guideText(lang, link.text)}</a> : m[0]);
    last = at + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return <>{out}</>;
};

const cellText = (lang: Lang, c: Cell): string => ("money" in c ? fmtMoney(c.money, lang) : guideText(lang, c));

export const FIGURE_WIDTHS = ["wide", "phone"] as const;
export const FIGURE_THEMES = ["light", "dark"] as const;
export type FigureWidth = (typeof FIGURE_WIDTHS)[number];
export type FigureTheme = (typeof FIGURE_THEMES)[number];
// The phone files' breakpoint, the stylesheet's (max-width: 699px).
export const FIGURE_PHONE_MEDIA = "(max-width: 699px)";

// One image of a figure, as scripts/make-guide-figures.mjs names it: static, so it never reaches the Worker.
export function figureFile(slug: string, id: string, lang: Lang, width: FigureWidth, theme: FigureTheme): string {
  return `/figures/guides/${slug}/${id}.${lang}.${width}.${theme}.webp`;
}

// A mark's box in percent of the image, its number in its corner.
const Marks: FC<{ shot: FigureShot; width: FigureWidth }> = ({ shot, width }) => (
  <div class={`fig-marks fig-marks-${width}`} aria-hidden="true">
    {shot.boxes.map(([x, y, w, h], i) => (
      <span class="fig-mark" style={`left:${x}%;top:${y}%;width:${w}%;height:${h}%`}><span class="fig-num">{i + 1}</span></span>
    ))}
  </div>
);

// A figure the tool has not measured yet draws nothing (the tests ask for every one).
const GuideFigure: FC<{ lang: Lang; slug: string; figure: Figure }> = ({ lang, slug, figure }) => {
  const measured = GUIDE_FIGURES[figure.id];
  if (!measured || measured.slug !== slug) return null;
  const shots = measured[lang];
  const alt = guideText(lang, figure.alt);
  const picture = (theme: FigureTheme) => (
    <picture class={`fig-${theme}`}>
      <source media={FIGURE_PHONE_MEDIA} srcset={figureFile(slug, figure.id, lang, "phone", theme)} width={shots.phone.width} height={shots.phone.height} />
      <img src={figureFile(slug, figure.id, lang, "wide", theme)} width={shots.wide.width} height={shots.wide.height} alt={alt}
        loading="lazy" decoding="async" />
    </picture>
  );
  // Never wider than the capture: each image's own width, the phone one's at the phone breakpoint.
  return (
    <figure class="guide-figure" id={`figure-${figure.id}`}>
      <div class="fig-frame" style={`--fig-wide:${shots.wide.width}px;--fig-phone:${shots.phone.width}px`}>
        {picture("light")}
        {picture("dark")}
        <Marks shot={shots.wide} width="wide" />
        <Marks shot={shots.phone} width="phone" />
      </div>
      <figcaption>
        <ol class="fig-legend">{figure.callouts.map((c) => <li><Inline lang={lang} text={c.text} /></li>)}</ol>
        <p class="fig-caption">{guideText(lang, figure.caption)} {t(lang, "guides.figure_sample")}</p>
      </figcaption>
    </figure>
  );
};

const GuideBlock: FC<{ lang: Lang; slug: string; block: Block }> = ({ lang, slug, block }) => {
  switch (block.kind) {
    case "figure":
      return <GuideFigure lang={lang} slug={slug} figure={block} />;
    case "p":
      return <p><Inline lang={lang} text={block.text} /></p>;
    case "list":
      return <ul>{block.items.map((i) => <li><Inline lang={lang} text={i} /></li>)}</ul>;
    case "terms":
      return (
        <dl class="terms">
          {block.items.map((i) => (
            <>
              <dt>{guideText(lang, i.term)}</dt>
              <dd><Inline lang={lang} text={i.text} /></dd>
            </>
          ))}
        </dl>
      );
    case "table": {
      const cols: Column[] = block.cols.map((c) => ({ kind: c.kind, label: guideText(lang, c.label), rest: c.rest }));
      // A table of a few rows read in their own order: no sorting.
      return (
        <div class="table-wrap">
          <Table sorting="none" cols={cols}>
            <tbody>
              {block.rows.map((row) => (
                <tr>
                  {row.map((cell, i) => (
                    <td data-label={String(cols[i].label)} class={"money" in cell ? "num" : undefined}>{cellText(lang, cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      );
    }
  }
};

// A reader not signed in while the accounts switch is on: the one a guide's
// email list is drawn for. A signed-in reader's guide is as it was. The shell
// reads the session anyway (one answer a request), and nothing is read while
// the switch is off.
async function signedOut(c: Context<AppEnv>): Promise<boolean> {
  if (!accountsEnabled(c.env)) return false;
  return (await readSession(c).catch(() => ({ state: "unavailable" }) as const)).state !== "ok";
}

export function guidePath(g: Guide): string {
  return `/guides/${g.slug}`;
}

// The index: every guide, its summary and the day it was last checked.
export async function guidesIndex(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "nav.guides")} dataAsOf={stats?.data_as_of ?? null} active="/guides" seo={pageSeo("guides", lang)}>
      <PageHead lang={lang} title={t(lang, "nav.guides")} lead={t(lang, "guides.lead")} />
      <div class="doc-layout doc-alone">
        <div class="doc">
          {GUIDES.map((g) => (
            <>
              <h3><a href={guidePath(g)}>{guideText(lang, g.title)}</a></h3>
              <p>{guideText(lang, g.summary)} <span class="muted small">{t(lang, "guides.checked", { date: g.checked })}</span></p>
            </>
          ))}
        </div>
      </div>
    </Layout>,
  );
}

// One guide: its sections with their contents box, then the official pages
// it was read from, the day it was checked and the line that the sources govern.
export async function guidePage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const raw = c.req.param("slug") ?? "";
  const g = guideBySlug(raw.toLowerCase());
  const stats = await loadStats(c.env).catch(() => null);
  const dataAsOf = stats?.data_as_of ?? null;
  if (!g) return notFoundPage(c, dataAsOf, "guides.not_found", "/guides", "guides.back");
  const moved = lowerRedirect(c, guidePath(g));
  if (moved) return moved;
  const title = guideText(lang, g.title);
  const list = g.action && (await signedOut(c))
    ? await interestFilter(c.env, lang, g.action.list.kind, g.action.list.path).catch(() => null)
    : null;
  const crumbs = [
    { name: t(lang, "common.home"), path: "/" },
    { name: t(lang, "nav.guides"), path: "/guides" },
    { name: title },
  ];
  return page(
    c,
    <Layout lang={lang} title={title} dataAsOf={dataAsOf} active="/guides" seo={guideSeo(g, lang, crumbs)}>
      <PageHead lang={lang} title={title} lead={guideText(lang, g.summary)} crumbs={crumbs}>
        <p class="page-note">{t(lang, "guides.checked", { date: g.checked })}</p>
      </PageHead>
      <div class="doc-layout">
        <nav class="toc" aria-label={t(lang, "toc.label")}>
          <span class="toc-title">{t(lang, "toc.title")}</span>
          {g.sections.map((s) => <a href={`#${s.id}`}>{guideText(lang, s.title)}</a>)}
          <a href="#sources">{t(lang, "guides.sources")}</a>
        </nav>
        <div class="doc">
          {g.sections.map((s) => (
            <>
              <h2 id={s.id}>{guideText(lang, s.title)}</h2>
              {s.blocks.map((b) => <GuideBlock lang={lang} slug={g.slug} block={b} />)}
            </>
          ))}
          {list && g.action ? (
            <>
              <h2>{t(lang, "interest.title")}</h2>
              <p>{guideText(lang, g.action.text)} <a href="/alerts">{t(lang, "interest.about")}</a></p>
              <InterestBody lang={lang} filter={list} on={false} />
              <script src="/interest.js" defer></script>
            </>
          ) : null}
          <h2 id="sources">{t(lang, "guides.sources")}</h2>
          <p>{t(lang, "guides.sources_intro")}</p>
          <ol class="sources">
            {g.sources.map((s) => {
              // The page that was read: the French one where it was, else the English one, named as such for a French reader.
              const french = lang === "fr" ? s.fr : undefined;
              const url = french?.url ?? s.url;
              const title = french ? frTypography(french.title) : t(lang, "guides.english_page", { title: s.title });
              return (
                <li>
                  <a href={url} rel="noopener">{title}</a>. {guideText(lang, s.publisher)}.{" "}
                  <span class="muted small">{url}</span>
                </li>
              );
            })}
          </ol>
          <p>{t(lang, "guides.checked", { date: g.checked })}</p>
          <p>{t(lang, "guides.govern")}</p>
        </div>
      </div>
    </Layout>,
  );
}
