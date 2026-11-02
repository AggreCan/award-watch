import type { Context } from "hono";
import { type Column, Table } from "../columns";
import { loadJson, loadStats } from "../data";
import type { AppEnv } from "../env";
import { numberLocale, pick, provinceName, segmentLabel, t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, page } from "../layout";
import { SITE_ORIGIN, pageSeo } from "../seo";

// The pipeline writes the feeds as static files under /data/feeds/ (feeds.py).
// A reader's poll passes through the Worker only to be counted (index.tsx
// serves the file from the assets binding with a short cache). This page
// reads only the small index of what was written: scoped feeds come and go
// with the data, the two national feeds are always there. The feeds of
// contracts ending soon (event "expiring", national, per buyer and per
// segment) are listed when the index names them.

export const FEED_EVENTS = ["tenders", "awards"] as const;
export const EXPIRING_EVENT = "expiring";
export type FeedEvent = (typeof FEED_EVENTS)[number] | typeof EXPIRING_EVENT;
const INDEX_EVENTS: readonly FeedEvent[] = [...FEED_EVENTS, EXPIRING_EVENT];
type ScopeKind = "canada" | "segment" | "prov" | "buyer";

export interface FeedRow {
  scope: ScopeKind;
  key: string;
  name_en?: string | null;
  name_fr?: string | null;
  event: FeedEvent;
  path: string;
  entries: number;
  updated: string | null;
}

export interface FeedIndex {
  as_of: string;
  max_entries: number;
  feeds: FeedRow[];
}

const EVENT_KEY: Record<FeedEvent, Key> = { tenders: "feeds.ev.tenders", awards: "feeds.ev.awards", expiring: "feeds.ev.expiring" };
const ABOUT_KEY: Record<FeedEvent, Key> = {
  tenders: "feeds.about.tenders", awards: "feeds.about.awards", expiring: "feeds.about.expiring",
};
const SCOPES: readonly ScopeKind[] = ["canada", "segment", "prov", "buyer"];

export const nationalFeedPath = (event: FeedEvent) => `feeds/canada/${event}.xml`;

// Atom autodiscovery for the national feeds, for a page's head (home, tenders, awards, feeds).
export const FeedLinks = ({ lang }: { lang: Lang }) => (
  <>
    {FEED_EVENTS.map((e) => (
      <link rel="alternate" type="application/atom+xml" title={t(lang, "feeds.link_title", { event: t(lang, EVENT_KEY[e]) })} href={`/data/${nationalFeedPath(e)}`} />
    ))}
  </>
);

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// A missing or malformed index reads as "no scoped feeds yet", never an error.
export async function loadFeedIndex(c: Context<AppEnv>): Promise<FeedIndex | null> {
  const index = await loadJson<FeedIndex>(c.env, "feeds/index.json").catch(() => null);
  if (!isObject(index) || !Array.isArray(index.feeds)) return null;
  const feeds = index.feeds.filter(
    (f): f is FeedRow => isObject(f) && typeof f.path === "string" && /^feeds\/[A-Za-z0-9/_-]+\.xml$/.test(f.path)
      && INDEX_EVENTS.includes(f.event as FeedEvent) && typeof f.key === "string" && SCOPES.includes(f.scope as ScopeKind),
  );
  return { ...index, feeds };
}

const Address = ({ path }: { path: string }) => (
  <a href={`/data/${path}`} class="mono" style="overflow-wrap:anywhere">{`${SITE_ORIGIN}/data/${path}`}</a>
);

export async function feedsPage(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  const index = await loadFeedIndex(c);
  const feeds = index?.feeds ?? [];
  const label = (f: FeedRow): string => {
    if (f.scope === "segment") return `${f.key} ${segmentLabel(lang, f.key)}`;
    if (f.scope === "prov") return provinceName(lang, f.key.toUpperCase());
    return pick(lang, f.name_en ?? null, f.name_fr ?? null) ?? f.key;
  };
  // The expiring feeds appear wherever the index has any: in the list of
  // kinds, as a national row, and as a column of the scopes that carry them.
  const expiring = feeds.filter((f) => f.event === EXPIRING_EVENT);
  const kinds: readonly FeedEvent[] = expiring.length ? INDEX_EVENTS : FEED_EVENTS;
  const nationalExpiring = expiring.find((f) => f.scope === "canada");
  const segmentCount = new Set(feeds.filter((f) => f.scope === "segment").map((f) => f.key)).size;

  // One table per scope kind: a row per scope, a column per event.
  const ScopeTable = ({ kind, head }: { kind: ScopeKind; head: Key }) => {
    const byKey = new Map<string, Map<FeedEvent, FeedRow>>();
    for (const f of feeds.filter((x) => x.scope === kind)) {
      if (!byKey.has(f.key)) byKey.set(f.key, new Map());
      byKey.get(f.key)!.set(f.event, f);
    }
    const firsts = [...byKey.values()].map((m) => [...m.values()][0]);
    firsts.sort(kind === "segment" ? (a, b) => a.key.localeCompare(b.key) : (a, b) => label(a).localeCompare(label(b), numberLocale(lang)));
    if (!index) return <p class="muted">{t(lang, "feeds.none_yet")}</p>;
    if (firsts.length === 0) return <p class="muted">{t(lang, "feeds.none_scope")}</p>;
    const events: readonly FeedEvent[] = expiring.some((f) => f.scope === kind) ? INDEX_EVENTS : FEED_EVENTS;
    return (
      <div class="table-wrap bordered">
        <Table cols={[
          { kind: "main", label: t(lang, head) },
          ...events.map((e): Column => ({ kind: "label", label: t(lang, EVENT_KEY[e]) })),
        ]}>
          <tbody>
            {firsts.map((first) => {
              const name = label(first);
              const cells = byKey.get(first.key)!;
              return (
                <tr>
                  <td data-label={t(lang, head)}>{name}</td>
                  {events.map((e) => {
                    const f = cells.get(e);
                    return (
                      <td data-label={t(lang, EVENT_KEY[e])}>
                        {f ? (
                          <a href={`/data/${f.path}`} class="mono" aria-label={t(lang, "feeds.cell_aria", { scope: name, event: t(lang, EVENT_KEY[e]) })}>
                            {f.path.split("/").pop()}
                          </a>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    );
  };

  const pattern = (folder: string) => (
    <p class="muted small">
      {tj(lang, "feeds.pattern", { pattern: <span class="mono" style="overflow-wrap:anywhere">{`${SITE_ORIGIN}/data/feeds/${folder}/<feed>.xml`}</span> })}
    </p>
  );

  const toc: [string, Key][] = [
    ["kinds", "feeds.toc_kinds"],
    ["canada", "feeds.toc_canada"],
    ["segment", "feeds.toc_segment"],
    ["province", "feeds.toc_prov"],
    ["buyer", "feeds.toc_buyer"],
    ["subscribe", "feeds.toc_subscribe"],
  ];

  return page(
    c,
    <Layout lang={lang} title={t(lang, "feeds.title")} dataAsOf={stats?.data_as_of ?? null} active="/feeds" head={<FeedLinks lang={lang} />} seo={pageSeo("feeds", lang)}>
      <PageHead lang={lang} title={t(lang, "feeds.title")} lead={t(lang, expiring.length ? "feeds.lead_expiring" : "feeds.lead", { n: index?.max_entries ?? 50 })} />
      <div class="doc-layout">
        <nav class="toc" aria-label={t(lang, "toc.label")}>
          <span class="toc-title">{t(lang, "toc.title")}</span>
          {toc.map(([id, key]) => <a href={`#${id}`}>{t(lang, key)}</a>)}
        </nav>
        <div class="doc">
          <h2 id="kinds">{t(lang, "feeds.toc_kinds")}</h2>
          <ul>
            {kinds.map((e) => (
              <li id={e === EXPIRING_EVENT ? "expiring" : undefined}>
                <strong>{t(lang, EVENT_KEY[e])}</strong>{lang === "fr" ? "\u202f: " : ": "}{t(lang, ABOUT_KEY[e])}
              </li>
            ))}
          </ul>

          <h2 id="canada">{t(lang, "feeds.toc_canada")}</h2>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "text", label: t(lang, "feeds.col_feed") },
              { kind: "main", label: t(lang, "feeds.col_address") },
            ]}>
              <tbody>
                {FEED_EVENTS.map((e) => (
                  <tr>
                    <td data-label={t(lang, "feeds.col_feed")}>{t(lang, EVENT_KEY[e])}</td>
                    <td data-label={t(lang, "feeds.col_address")}><Address path={nationalFeedPath(e)} /></td>
                  </tr>
                ))}
                {nationalExpiring ? (
                  <tr>
                    <td data-label={t(lang, "feeds.col_feed")}>{t(lang, EVENT_KEY.expiring)}</td>
                    <td data-label={t(lang, "feeds.col_address")}><Address path={nationalExpiring.path} /></td>
                  </tr>
                ) : null}
              </tbody>
            </Table>
          </div>

          <h2 id="segment">{t(lang, "feeds.toc_segment")}</h2>
          {pattern("segment/<nn>")}
          {/* 57 rows: on a phone the table starts folded (public/pager.js
              closes it there); elsewhere, and without the script, it is open. */}
          {segmentCount ? (
            <details class="phone-fold" open data-phone-closed="">
              <summary class="btn">{t(lang, "feeds.segments_show", { n: segmentCount })}</summary>
              <ScopeTable kind="segment" head="col.segment" />
            </details>
          ) : <ScopeTable kind="segment" head="col.segment" />}

          <h2 id="province">{t(lang, "feeds.toc_prov")}</h2>
          {pattern("prov/<code>")}
          <ScopeTable kind="prov" head="col.province" />

          <h2 id="buyer">{t(lang, "feeds.toc_buyer")}</h2>
          {pattern("buyer/<id>")}
          <ScopeTable kind="buyer" head="col.buyer" />

          <h2 id="subscribe">{t(lang, "feeds.toc_subscribe")}</h2>
          <p>{t(lang, "feeds.privacy")}</p>
          <ul>
            <li>{t(lang, "feeds.sub_reader")}</li>
            <li>{tj(lang, "feeds.sub_slack", { command: <span class="mono id">/feed subscribe</span> })}</li>
            <li>{t(lang, "feeds.sub_email")}</li>
          </ul>
          <p>{tj(lang, "feeds.watch_note", { watchlist: <a href="/watchlist">{t(lang, "feeds.watch_link")}</a> })}</p>
        </div>
      </div>
      <script src="/pager.js" defer></script>
    </Layout>,
  );
}
