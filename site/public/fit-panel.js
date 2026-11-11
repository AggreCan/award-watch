/* Matching notices in a short list: the panel over /tenders and the one on
   /account/organization (src/account/fit_panels.tsx).

   The rows are public/fit.js's ranking of the open notices against the
   claimed organization's matching block, the closest first, as
   /account/matches lists them: the first PANEL_ROWS, each with its band and
   title, then a line with its buyer, its closing day and its first reason
   (the work in common, which every listed match has) without points. The
   words come from the page's data: the block, the organization's name and
   province, the strings and the titles of the block's segments.

   On /tenders, public/tenders.js loads this module only when the page
   carries that data (#fit-data, a signed-in reader whose account names its
   organization) and hands it the list it fetched; the server never parses
   the full list for that page. The families' and classes' names come from
   /data/tenders/open-levels.json, read once. On the organization page the
   Worker calls panelRows itself with the same data, so the two read alike,
   and test/fit-panels.test.ts holds their words to /account/matches' (src/fit.tsx).
   Everything is drawn with textContent, and nothing runs on import. */
import { closingParts, closingPassed } from "./closing.js";
import { rankNotices } from "./fit.js";

// The matches a short list shows, whatever the plan (docs/accounts.md, Matching notices).
export const PANEL_ROWS = 5;

// Each source's count, in the order of the block's count lists, as src/fit.tsx countsText writes them.
const SOURCE_COUNTS = [
  ["orgclaim.week_awards_one", "orgclaim.week_awards_many"],
  ["orgclaim.week_history_one", "orgclaim.week_history_many"],
  ["orgclaim.week_contracts_one", "orgclaim.week_contracts_many"],
];
// The reason a listed match leads with: the work in common.
const WORK_KEY = { class: "fit.r_class", family: "fit.r_family", segment: "fit.r_segment" };

/**
 * @typedef {{ code: string, en?: string | null, fr?: string | null }} Level
 * @typedef {{
 *   lang: "en" | "fr", locale: string, id: string, name: string, home: string | null,
 *   block: import("./fit.js").MatchBlock, strings: Record<string, string>, segments: Record<string, string>
 * }} PanelData
 * @typedef {{ band: string, title: string, href: string, detail: string }} PanelRow
 */

/** The words of the page's data: a string by its key with its {slots} filled, a count's form, a figure. @param {PanelData} data */
export function wordsOf(data) {
  const strings = data.strings || {};
  /** @type {Intl.NumberFormat | null} */
  let format = null;
  try {
    format = new Intl.NumberFormat(data.locale);
  } catch {
    format = null;
  }
  /** @param {string} key @param {Record<string, string | number>} [vars] */
  const tx = (key, vars) => {
    const s = strings[key];
    if (s == null) return key;
    return vars ? s.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m)) : s;
  };
  // English takes the singular for 1 only, French for 0 and 1 (src/i18n.ts tn).
  /** @param {string} one @param {string} many @param {number} n @param {Record<string, string | number>} [vars] */
  const txn = (one, many, n, vars) => tx((data.lang === "fr" ? Math.abs(n) < 2 : n === 1) ? one : many, vars);
  /** @param {number} n */
  const num = (n) => (format ? format.format(n) : String(n));
  return { tx, txn, num };
}

/** A field in the page's language, the other language's when it is empty (src/i18n.ts pick). */
function pick(/** @type {string} */ lang, /** @type {string | null | undefined} */ en, /** @type {string | null | undefined} */ fr) {
  const mine = lang === "fr" ? fr : en;
  const other = lang === "fr" ? en : fr;
  return mine && String(mine).trim() ? mine : other && String(other).trim() ? other : null;
}

/** @param {ReturnType<typeof wordsOf>} w @param {readonly number[]} counts */
function countsText(w, counts) {
  /** @param {number} n @param {number} i */
  const part = (n, i) => w.txn(SOURCE_COUNTS[i][0], SOURCE_COUNTS[i][1], n, { n: w.num(n) });
  const parts = counts.slice(0, SOURCE_COUNTS.length).map((n, i) => (n > 0 ? part(n, i) : null)).filter((s) => s !== null);
  return parts.length ? parts.join(", ") : part(0, 0);
}

/**
 * A level's code with its name, as src/fit.tsx levelText writes it: a segment's title, a family's or class's
 * name as the open notices give it, the code alone when no notice named it.
 * @param {PanelData} data @param {string} code @param {readonly Level[] | null | undefined} levels
 */
function levelText(data, code, levels) {
  if (code.length === 2) return data.segments && data.segments[code] ? `${code} ${data.segments[code]}` : code;
  const level = (levels || []).find((l) => l && l.code === code);
  const name = level ? pick(data.lang, level.en, level.fr) : null;
  return name ? `${code} ${name}` : code;
}

/**
 * The first PANEL_ROWS matches among the notices given, closest first, and how many matched in all. The
 * notices are the ones still open: the caller leaves out those whose closing time has passed, by its own clock.
 * @param {PanelData} data
 * @param {readonly (import("./fit.js").FitNotice & { reference: string, reference_published?: string, closing?: string | null,
 *   title_en?: string | null, title_fr?: string | null, buyer_en?: string | null, buyer_fr?: string | null })[]} rows
 * @param {readonly Level[] | null | undefined} levels
 * @returns {{ total: number, rows: PanelRow[] }}
 */
export function panelRows(data, rows, levels) {
  const w = wordsOf(data);
  const { matches } = rankNotices(data.block, rows, data.home);
  return {
    total: matches.length,
    rows: matches.slice(0, PANEL_ROWS).map(({ row, score }) => {
      const work = score.reasons[0];
      const key = work ? WORK_KEY[/** @type {keyof typeof WORK_KEY} */ (work.kind)] : undefined;
      const reason = work && key ? w.tx(key, { code: levelText(data, work.key ?? "", levels), counts: countsText(w, work.counts) }) : null;
      const day = closingParts(row.closing)?.day ?? null;
      return {
        // A list carries close and partial matches only (fit.js LISTED_BANDS).
        band: w.tx(score.band === "close" ? "fit.band_close" : "fit.band_partial"),
        title: pick(data.lang, row.title_en, row.title_fr) ?? (row.reference_published || row.reference),
        href: `/tenders/${encodeURIComponent(row.reference.toLowerCase())}`,
        detail: [pick(data.lang, row.buyer_en, row.buyer_fr) ?? w.tx("common.not_stated"), day ? w.tx("tender.lead_closes", { date: day }) : null, reason]
          .filter(Boolean).join(" · "),
      };
    }),
  };
}

// -- the panel on /tenders ------------------------------------------------------------------

/** @param {string} tag @param {string | null} [cls] @param {string | null} [text] */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * The panel the page carries, or null when it carries none: the loading line now, then draw(rows) with the
 * open notices public/tenders.js fetched (null when they could not be read). The names of families and
 * classes are read meanwhile; without them a reason names its code alone, as the server's do.
 */
export function startPanel() {
  const box = document.getElementById("fit-rows");
  const all = document.getElementById("fit-all");
  /** @type {PanelData | null} */
  let data = null;
  try {
    data = JSON.parse(document.getElementById("fit-data")?.textContent ?? "null");
  } catch {
    data = null;
  }
  if (!box || !data || !data.block) return null;
  const page = data;
  const w = wordsOf(page);
  /** @param {string} text */
  const say = (text) => {
    box.textContent = "";
    box.appendChild(el("p", "muted small", text));
  };
  say(w.tx("tenders.loading"));
  /** @type {Promise<Level[] | null>} */
  const levels = fetch("/data/tenders/open-levels.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => (v && Array.isArray(v.levels) ? v.levels : null))
    .catch(() => null);
  /** @param {{ total: number, rows: PanelRow[] }} out */
  const show = (out) => {
    box.textContent = "";
    if (out.rows.length) {
      const list = el("ol", "statement-list");
      for (const r of out.rows) {
        const li = el("li");
        li.appendChild(el("strong", null, r.band));
        li.appendChild(document.createTextNode(" "));
        const a = /** @type {HTMLAnchorElement} */ (el("a", null, r.title));
        a.href = r.href;
        li.appendChild(a);
        li.appendChild(el("br"));
        li.appendChild(el("span", "muted small", r.detail));
        list.appendChild(li);
      }
      box.appendChild(list);
    } else {
      box.appendChild(el("p", null, w.tx("fit.tenders_none", { name: page.name })));
    }
    if (all) {
      if (out.total) all.textContent = w.txn("fit.tenders_all_one", "fit.tenders_all_many", out.total, { n: w.num(out.total) });
      all.hidden = false;
    }
  };
  return {
    /** @param {readonly any[] | null} rows */
    draw(rows) {
      if (!rows) {
        say(w.tx("fit.unavailable"));
        return;
      }
      const now = Date.now();
      const open = rows.filter((r) => !closingPassed(r.closing, now));
      levels.then((lv) => show(panelRows(page, open, lv)));
    },
  };
}
