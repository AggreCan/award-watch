// The home page's Canada map: the tender notices by province, one layer at
// a time. New today (the notices first seen on the data date), Open (every
// open notice) and Closing within 7 days come from stats.json "map" (pipeline
// export_static.province_map); Same day, while the accounts switch is on,
// from sameDayMapCounts (src/pages/intraday.tsx), its count shown to every
// reader as a tease of the Pro page.
//
// No framework and no request of its own: every layer's fills, labels and
// figures are in the markup, and the stylesheet shows the layer the
// wrapper's data-layer names. public/canada-map.js only sets that attribute
// and the buttons' aria-pressed; without it the first layer stays shown. The
// outlines (src/canada_map.ts) are drawn once in the SVG's defs and each
// layer places them with <use>, so the paths are not repeated per layer.
//
// A layer is drawn in three passes. First the fills, each on its step of the
// ramp and fading a little from its top to its foot, as a chart's bar does
// (operator, 2026-11-11: flat fills looked off beside the charts). The fade
// is the step's gradient in the defs, over the province's own box, and the
// stylesheet sets its strength (.cmap-foot): the foot stays nearer its own
// step than the one below it, so a fade is never read as the next step down.
// A province with no notice stays flat. Then the land borders, a gap in the panel's ground between two
// neighbours, so two provinces on one step are still two shapes (operator,
// 2026-11-11); a coast gets no gap, so no island is thinned by one. Then each
// province's outline again, clear: it is what the pointer meets, so it holds
// the link and the tip, and its ink edge under the pointer is whole, since
// neither a neighbour's fill nor the gap lies over it.
//
// Each province links to its list with the layer's filter and national=0, so
// the list holds the notices its count counts: /tenders/new for the new
// ones, /tenders and /tenders?closing=7 for the open and the closing ones,
// /tenders/same-day for the same-day ones for a Pro reader, and the plain
// /tenders/same-day (its free view carries the Pro card) for anyone else.
// The SVG is hidden from assistive technology and its links from the tab
// order: the table beside it carries the same figures and links, sortable,
// and is all a phone shows (the map is hidden below 700 px). Each province
// carries its tip as its <title>: its name over the layer's count of it,
// worded as the layer's caption words the national one (public/tooltip.js
// shows it in the site's box, src/chart.tsx).

import type { FC } from "hono/jsx";
import { tipText, useTips } from "../chart";
import {
  INSET_BORDERS, INSET_EXTENT, INSET_FRAME, INSET_PATHS, MAP_BORDERS, MAP_HEIGHT, MAP_LABELS, MAP_PATHS, MAP_WIDTH, type MaritimeProvince,
} from "../canada_map";
import { type Column, Table, minWidths } from "../columns";
import { CLOSING_SOON_DAYS, PROVINCES } from "../constants";
import type { ProvinceCounts, StatsMapLayer } from "../data";
import { fmtInt, numberLocale, provinceName, t, tj, tn, type Lang } from "../i18n";
import type { PlaceQuery } from "../places";
import { Panel } from "../layout";
import { ProTag } from "../pro";
import { SAME_DAY_PATH, sameDayHref } from "./same_day";
import { newDayHref, readTenderQuery, tenderQueryString } from "./tenders";

type Province = (typeof PROVINCES)[number];

export const MAP_LAYERS = ["new_today", "open", "closing_7d", "same_day"] as const;
export type MapLayerId = (typeof MAP_LAYERS)[number];

export interface MapLayer {
  id: MapLayerId;
  label: string;
  // The line over the legend: the layer's notices.
  caption: string;
  // A count of the layer's notices in the caption's words, for a province's tip.
  count: (n: number) => string;
  counts: ProvinceCounts;
  href: (code: Province) => string;
  pro: boolean;
}

// The fills: a province with no notice, then MAP_STEPS steps of one hue
// (the --map-* tokens) on a square-root scale of the layer's largest count,
// so one notice and a few hundred both show.
export const MAP_STEPS = 4;

export function mapStep(n: number, top: number): number {
  if (n <= 0 || top <= 0) return 0;
  // The first step s with sqrt(n / top) <= s / MAP_STEPS, in whole numbers so a boundary never rounds.
  for (let s = 1; s < MAP_STEPS; s++) if (MAP_STEPS * MAP_STEPS * n <= top * s * s) return s;
  return MAP_STEPS;
}

// The counts each step covers for a layer whose largest is top: a step no
// count can reach is left out, so the legend shows nothing the map cannot.
export function stepRanges(top: number): { step: number; lo: number; hi: number }[] {
  const out: { step: number; lo: number; hi: number }[] = [];
  let lo = 1;
  for (let s = 1; s <= MAP_STEPS && lo <= top; s++) {
    const hi = s === MAP_STEPS ? top : Math.floor((top * s * s) / (MAP_STEPS * MAP_STEPS));
    if (hi >= lo) {
      out.push({ step: s, lo, hi });
      lo = hi + 1;
    }
  }
  return out;
}

const countOf = (counts: ProvinceCounts, code: string): number => counts.provinces[code] ?? 0;
const topOf = (counts: ProvinceCounts): number => Math.max(0, ...PROVINCES.map((p) => countOf(counts, p)));

// The tender list with nothing but a province, from which each layer's link adds its own filter.
const BLANK = readTenderQuery(new URL("https://awardwatch.ca/tenders"));
const placeOf = (code: Province): PlaceQuery => ({ province: [code], national: false, derived: true });

// The layers to draw, in the buttons' order. sameDay: the same-day counts,
// null for no such layer (the accounts switch off, or the rows unread);
// proSameDay: whether this reader's plan opens the same-day list, which
// decides where that layer's links lead. today: the data date, the newest
// day of /tenders/new.
export function mapLayers(lang: Lang, map: Record<StatsMapLayer, ProvinceCounts>, sameDay: ProvinceCounts | null,
  proSameDay: boolean, today: string): MapLayer[] {
  const newToday = (n: number) => tn(lang, "map.caption_new_today_one", "map.caption_new_today_many", n, { n: fmtInt(n, lang) });
  const open = (n: number) => tn(lang, "map.caption_open_one", "map.caption_open_many", n, { n: fmtInt(n, lang) });
  const closing = (n: number) => tn(lang, "map.caption_closing_one", "map.caption_closing_many", n, { n: fmtInt(n, lang), days: CLOSING_SOON_DAYS });
  const layers: MapLayer[] = [
    {
      id: "new_today", label: t(lang, "map.layer_new_today"), counts: map.new_today, pro: false,
      caption: newToday(map.new_today.n), count: newToday,
      href: (code) => newDayHref(today, today, placeOf(code)),
    },
    {
      id: "open", label: t(lang, "map.layer_open"), counts: map.open, pro: false,
      caption: open(map.open.n), count: open,
      href: (code) => `/tenders${tenderQueryString({ ...BLANK, ...placeOf(code) })}`,
    },
    {
      id: "closing_7d", label: t(lang, "map.layer_closing", { n: CLOSING_SOON_DAYS }), counts: map.closing_7d, pro: false,
      caption: closing(map.closing_7d.n), count: closing,
      href: (code) => `/tenders${tenderQueryString({ ...BLANK, ...placeOf(code), closing: String(CLOSING_SOON_DAYS) })}`,
    },
  ];
  if (sameDay) {
    const posted = (n: number) => tn(lang, "intraday.heading_one", "intraday.heading_many", n, { n: fmtInt(n, lang) });
    layers.push({
      id: "same_day", label: t(lang, "map.layer_same_day"), counts: sameDay, pro: true,
      caption: posted(sameDay.n), count: posted,
      href: (code) => (proSameDay ? sameDayHref(placeOf(code)) : SAME_DAY_PATH),
    });
  }
  return layers;
}

// The layer shown first: the new notices, or the open ones on a day none was first seen.
export function firstLayer(layers: readonly MapLayer[]): MapLayerId {
  return layers[0].counts.n > 0 ? layers[0].id : "open";
}

// Statistics Canada's page for the boundary files the outlines come from.
const BOUNDARY_URL: Record<Lang, string> = {
  en: "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm",
  fr: "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-fra.cfm",
};

const MARITIMES: readonly MaritimeProvince[] = ["NB", "NS", "PE"];
// The two lines of a label sit around its point: the code above, the count below.
const LABEL_UP = 2;
const LABEL_LINE = 22;

// The steps that fade: every one but the province with no notice.
const FADED = Array.from({ length: MAP_STEPS }, (_, i) => i + 1);
const fadeId = (step: number) => `cm-fade-${step}`;

// A province's fill on one layer, on its step of the ramp. A step with a
// notice names its gradient, with the plain colour after it for a browser
// that cannot resolve it (the class alone gives the same colour).
const Fill: FC<{ layer: MapLayer; code: Province; def: string; top: number }> = ({ layer, code, def, top }) => {
  const step = mapStep(countOf(layer.counts, code), top);
  return <use href={`#${def}`} class={`cmap-s${step}`} style={step > 0 ? `fill:url(#${fadeId(step)}) var(--map-${step})` : undefined}></use>;
};

// A province's outline over the fills and the gap: a link to its list when it
// has a notice, and its tip, the province's name over the layer's count.
const Hit: FC<{ lang: Lang; layer: MapLayer; code: Province; def: string }> = ({ lang, layer, code, def }) => {
  const n = countOf(layer.counts, code);
  const shape = (
    <use href={`#${def}`} class="cmap-hit">
      <title>{tipText(provinceName(lang, code), [layer.count(n)])}</title>
    </use>
  );
  return n > 0 ? <a href={layer.href(code)} tabindex={-1}>{shape}</a> : shape;
};

const Label: FC<{ lang: Lang; layer: MapLayer; code: Province }> = ({ lang, layer, code }) => {
  const { x, y } = MAP_LABELS[code];
  return (
    <text class="cmap-label" x={x} y={y - LABEL_UP}>
      {code}
      <tspan class="cmap-count" x={x} dy={LABEL_LINE}>{fmtInt(countOf(layer.counts, code), lang)}</tspan>
    </text>
  );
};

export const CanadaMapPanel: FC<{ lang: Lang; layers: readonly MapLayer[] }> = ({ lang, layers }) => {
  useTips();
  const shown = firstLayer(layers);
  const tops = new Map(layers.map((l) => [l.id, topOf(l.counts)]));
  const main = PROVINCES.filter((p) => !MAP_LABELS[p].inset);
  const inset = PROVINCES.filter((p) => MAP_LABELS[p].inset);
  const byName = [...PROVINCES].sort((a, b) => provinceName(lang, a).localeCompare(provinceName(lang, b), numberLocale(lang)));
  const provinceHead = t(lang, "col.province");
  const cols: Column[] = [{ kind: "main", label: provinceHead }, ...layers.map((l): Column => ({ kind: "count", label: l.label }))];
  return (
    <Panel title={t(lang, "map.heading")} class="cmap-panel"
      foot={<p>{tj(lang, "map.source", { link: <a href={BOUNDARY_URL[lang]}>{t(lang, "map.source_link")}</a> })}</p>}>
      {/* Beside the map, the table keeps the least width of its columns. */}
      <div class="cmap" id="canada-map" data-layer={shown} style={`--cmap-list-min:${minWidths(cols).all}px`}>
        <div class="cmap-figure" data-tip="">
          <div class="cmap-toggles" role="group" aria-label={t(lang, "map.layers")}>
            {layers.map((l) => (
              <button type="button" class="btn" data-map-layer={l.id} aria-pressed={l.id === shown ? "true" : "false"}>
                {l.label}
                {l.pro ? <ProTag lang={lang} /> : null}
              </button>
            ))}
          </div>
          {layers.map((l) => <p class="cmap-caption" data-for={l.id}>{l.caption}</p>)}
          <svg class="cmap-svg" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} aria-hidden="true" focusable="false">
            <defs>
              {PROVINCES.map((p) => <path id={`cm-${p}`} d={MAP_PATHS[p]} />)}
              {MARITIMES.map((p) => <path id={`cmi-${p}`} d={INSET_PATHS[p]} />)}
              <path id="cm-borders" d={MAP_BORDERS} />
              <path id="cmi-borders" d={INSET_BORDERS} />
              {FADED.map((s) => (
                <linearGradient id={fadeId(s)} class={`cmap-f${s}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0"></stop>
                  <stop offset="1" class="cmap-foot"></stop>
                </linearGradient>
              ))}
            </defs>
            {layers.map((l) => (
              <g class="cmap-layer" data-for={l.id}>
                {PROVINCES.map((p) => <Fill layer={l} code={p} def={`cm-${p}`} top={tops.get(l.id)!} />)}
                <use href="#cm-borders" class="cmap-borders"></use>
                {PROVINCES.map((p) => <Hit lang={lang} layer={l} code={p} def={`cm-${p}`} />)}
                {main.map((p) => <Label lang={lang} layer={l} code={p} />)}
              </g>
            ))}
            {/* Where the inset's provinces lie, then the inset over the Arctic islands. */}
            <rect class="cmap-extent" x={INSET_EXTENT.x} y={INSET_EXTENT.y} width={INSET_EXTENT.w} height={INSET_EXTENT.h} />
            <rect class="cmap-inset" x={INSET_FRAME.x} y={INSET_FRAME.y} width={INSET_FRAME.w} height={INSET_FRAME.h} />
            {layers.map((l) => (
              <g class="cmap-layer" data-for={l.id}>
                {MARITIMES.map((p) => <Fill layer={l} code={p} def={`cmi-${p}`} top={tops.get(l.id)!} />)}
                <use href="#cmi-borders" class="cmap-borders"></use>
                {MARITIMES.map((p) => <Hit lang={lang} layer={l} code={p} def={`cmi-${p}`} />)}
                {inset.map((p) => <Label lang={lang} layer={l} code={p} />)}
              </g>
            ))}
          </svg>
          {layers.map((l) => (
            <div class="cmap-key" data-for={l.id}>
              <p class="cmap-national">{t(lang, "map.national", { n: fmtInt(l.counts.not_stated, lang) })}</p>
              <ul class="cmap-legend" aria-label={t(lang, "map.legend")}>
                <li><span class="cmap-sw cmap-s0"></span>{fmtInt(0, lang)}</li>
                {stepRanges(tops.get(l.id)!).map((r) => (
                  <li>
                    <span class={`cmap-sw cmap-s${r.step}`}></span>
                    {r.lo === r.hi ? fmtInt(r.lo, lang) : t(lang, "map.range", { lo: fmtInt(r.lo, lang), hi: fmtInt(r.hi, lang) })}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div class="cmap-list">
          <div class="table-wrap">
            <Table class="cmap-table" cols={cols}>
              <tbody>
                {byName.map((p) => (
                  <tr>
                    <td data-label={provinceHead}>{provinceName(lang, p)}</td>
                    {layers.map((l) => {
                      const n = countOf(l.counts, p);
                      return <td data-label={l.label} class="num">{n > 0 ? <a href={l.href(p)}>{fmtInt(n, lang)}</a> : fmtInt(0, lang)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
              {/* Its own body, so a sort of the provinces leaves it last. */}
              <tbody class="cmap-national-row">
                <tr>
                  <td data-label={provinceHead}>{t(lang, "common.national")}</td>
                  {layers.map((l) => <td data-label={l.label} class="num">{fmtInt(l.counts.not_stated, lang)}</td>)}
                </tr>
              </tbody>
            </Table>
          </div>
        </div>
      </div>
      <p class="cmap-note">
        {t(lang, "map.several")}{" "}
        {tj(lang, "map.derived", { methodology: <a href="/methodology#places">{t(lang, "nav.methodology")}</a> })}
        {layers.some((l) => l.id === "same_day") ? <>{" "}{t(lang, "map.same_day_stated")}</> : null}
      </p>
      <script src="/canada-map.js" defer></script>
    </Panel>
  );
};
