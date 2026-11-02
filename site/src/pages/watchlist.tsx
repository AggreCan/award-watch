import type { Context } from "hono";
import { type ColumnKind, REST_CLASS, type Rest, Table, restClass } from "../columns";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { clientStrings, numberLocale, t, tj, type Key, type Lang } from "../i18n";
import { ClientData, Layout, PageHead, Panel, page } from "../layout";
import { pageSeo } from "../seo";

// The watchlist lives in the visitor's browser (localStorage) and nowhere
// else. The server sends a shell that reads as a document with scripts off;
// public/watchlist.js fills the table from the same profile shards the
// profile pages read (/data/profiles/<abc>.json), served as static files.

// The most organizations one browser can watch: each costs a shard fetch on load.
export const WATCH_MAX = 100;

// Every string watchlist.js draws, handed over in the page's JSON block.
export const WATCHLIST_CLIENT_KEYS: readonly Key[] = [
  "col.organization", "source.awards", "source.history", "source.contracts", "source.grants", "source.lobbying",
  "watch.col_latest", "watch.col_new", "watch.col_manage", "watch.remove", "watch.remove_aria",
  "watch.loading", "watch.count_one", "watch.count_many", "watch.last_visit", "watch.first_visit",
  "watch.nothing_new", "watch.added_since",
  "watch.new_awards_one", "watch.new_awards_many", "watch.new_history_one", "watch.new_history_many",
  "watch.new_contracts_one", "watch.new_contracts_many", "watch.new_grants_one", "watch.new_grants_many",
  "watch.new_lobbying_one", "watch.new_lobbying_many",
  "watch.missing", "watch.load_failed", "watch.no_storage",
  "watch.export_empty", "watch.import_one", "watch.import_many", "watch.import_known", "watch.import_none",
  "watch.import_full",
];

// Each source's head is its name over the count (the tally kind, on one
// line), and the new records since the last visit, counted by source, take
// the same width. The
// table is wider than a window below 1920 px can hold, so the
// columns the rows use least rest first (src/columns.tsx), lobbying (not
// loaded yet) and the latest record below 1920 px, grants below 1600,
// contract history below 1440, published contracts below 1280. A row whose
// cell spans columns keeps one cell for each resting column, here and in
// public/watchlist.js, so a hidden column never shifts the cells after it.
const COLUMNS: [Key, ColumnKind, Rest?, string?][] = [
  ["col.organization", "main"], ["source.awards", "tally", undefined, "num"], ["source.history", "tally", "lg", "num"],
  ["source.contracts", "tally", "md", "num"], ["source.grants", "tally", "xl", "num"], ["source.lobbying", "tally", "xxl", "num"],
  ["watch.col_latest", "date", "xxl"], ["watch.col_new", "tally"], ["watch.col_manage", "label"],
];

// The rest class of each column the script draws, by its label key.
export const WATCH_RESTS: Record<string, string> = Object.fromEntries(
  COLUMNS.filter(([, , rest]) => rest).map(([key, , rest]) => [key, REST_CLASS[rest as Rest]]),
);

export function watchlistClientData(lang: Lang) {
  return { lang, locale: numberLocale(lang), max: WATCH_MAX, strings: clientStrings(lang, WATCHLIST_CLIENT_KEYS), rests: WATCH_RESTS };
}

export async function watchlistPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "watch.title")} dataAsOf={stats?.data_as_of ?? null} active="/watchlist" seo={pageSeo("watchlist", lang)}>
      <PageHead lang={lang} title={t(lang, "watch.title")} lead={t(lang, "watch.lead")}>
        <p class="page-note">{t(lang, "watch.privacy")}</p>
        <p class="page-note">{t(lang, "watch.records_note")} {t(lang, "watch.limit_note", { max: WATCH_MAX })}</p>
      </PageHead>

      <Panel title={t(lang, "watch.panel")} tools={<span id="watch-status" aria-live="polite"></span>}>
      <div class="table-wrap bordered" id="watchlist" data-max={String(WATCH_MAX)}>
        <Table cols={COLUMNS.map(([k, kind, rest, cls]) => ({ kind, label: t(lang, k), rest, class: cls }))}>
          <tbody id="watch-rows">
            <tr>
              <td colspan={2} class="muted" id="watch-empty">
                {tj(lang, "watch.empty", { directory: <a href="/organizations">{t(lang, "watch.directory_link")}</a> })}
                <noscript> {t(lang, "watch.noscript")}</noscript>
              </td>
              {COLUMNS.slice(2, 7).map(([, , rest]) => <td class={restClass(rest)}></td>)}
              <td colspan={2}></td>
            </tr>
          </tbody>
        </Table>
      </div>
      </Panel>

      <div id="watch-move" hidden>
        <Panel title={t(lang, "watch.move_h")}>
        <p>{t(lang, "watch.move_text")}</p>
        <div class="stack">
          <p>
            <button type="button" class="btn" id="watch-export">{t(lang, "watch.export")}</button>
          </p>
          {/* hidden sits on a plain div: .stack label sets display, which would override it */}
          <div id="watch-code-box" hidden>
            <label>
              {t(lang, "watch.export_label")}
              <textarea id="watch-code" rows={3} readonly spellcheck={false}></textarea>
            </label>
          </div>
          <label>
            {t(lang, "watch.import_label")}
            <textarea id="watch-import-text" rows={3} spellcheck={false}></textarea>
          </label>
          <button type="button" class="btn btn-primary" id="watch-import">{t(lang, "watch.import")}</button>
          <p id="watch-move-status" class="muted" aria-live="polite"></p>
        </div>
        </Panel>
      </div>
      <ClientData id="i18n" data={watchlistClientData(lang)} />
    </Layout>,
  );
}
