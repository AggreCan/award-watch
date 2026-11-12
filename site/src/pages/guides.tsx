// /guides and /guides/<slug>: plain explanations of the federal records the
// site reads, on the Methodology page's document layout. The text is
// src/guides.ts's, English and French side by side; this file only draws it.
// The frame's words (the index's lead, the checked line, the sources' head)
// are the dictionary's. docs/guides.md says how to add a guide.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { Table, type Column } from "../columns";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { GUIDES, guideBySlug, type Block, type Both, type Cell, type Guide, type Text } from "../guides";
import { fmtMoney, frTypography, t, type Lang } from "../i18n";
import { Layout, PageHead, lowerRedirect, notFoundPage, page } from "../layout";
import { guideSeo, pageSeo } from "../seo";

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

const GuideBlock: FC<{ lang: Lang; block: Block }> = ({ lang, block }) => {
  switch (block.kind) {
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
              {s.blocks.map((b) => <GuideBlock lang={lang} block={b} />)}
            </>
          ))}
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
