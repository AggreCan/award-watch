// What the keyed API (src/api_keyed.ts) offers, apart from its routes: the
// endpoints with their parameters, the page sizes and one key's limits. The
// Data page's API section (pages/keyed_api.tsx) and the keys page
// (account/pages.tsx) read them from here, so neither imports the routes
// and a test holds this list to the routes the sub-app registers.

import type { Key } from "./i18n";

// One key's limits. An ordinary script (a nightly mirror of the open notices,
// at most a few pages of 100; the day's new notices; the three radar
// windows, about 250 pages at 12 months; the records of a few hundred
// organizations) makes a few thousand requests a day, in bursts that 600 a
// minute leaves room for. At 20,000 a day a key makes at most 600,000
// requests a month, against the 10 million the Workers plan includes.
// KEY_PER_MINUTE is the KEY_LIMIT binding's limit in wrangler.jsonc (a test
// holds the two equal); the per-address API cap (API_LIMIT, 60 a minute)
// applies to every request as well.
export const KEY_PER_MINUTE = 600;
export const KEY_PER_DAY = 20_000;

// A list answers PAGE_ROWS rows a page; the hosted search keeps its own 50
// (src/search_db.ts, PAGE_SIZE). The static lists end where their files do,
// so LIST_PAGES_MAX only bounds the number a request may name. A records page
// past RECORD_PAGES_MAX is a 400: deeper reads belong to the CSV files on the
// Data page. A records page reads at most RECORD_PAGES_MAX * PAGE_ROWS + 1
// rows of one index range, plus the further-segment rows it passes over, so
// a key spending its whole day on the deepest pages reads about 100 million
// rows: some 3 billion in a month, an eighth of the 25 billion D1 includes.
export const PAGE_ROWS = 100;
export const LIST_PAGES_MAX = 10_000;
export const RECORD_PAGES_MAX = 50;
// The free text of /tenders/open's q, as the tender list's own box takes it.
export const OPEN_Q_MAX = 100;

export type KeyedEndpoint = { path: string; text: Key; params: readonly string[] };

// In the order the Data page and the keys page list them. path is written
// as the documentation shows it; the routes' own patterns are in
// src/api_keyed.ts.
export const KEYED_ENDPOINTS: readonly KeyedEndpoint[] = [
  {
    path: "/api/v1/tenders/open", text: "keyed.ep_open",
    params: ["category", "segment", "province", "national", "derived", "code", "buyer", "type", "method", "closing", "q", "sort", "page"],
  },
  { path: "/api/v1/tenders/new", text: "keyed.ep_new", params: ["day", "page"] },
  { path: "/api/v1/expiring/{3m|6m|12m}", text: "keyed.ep_expiring", params: ["page"] },
  { path: "/api/v1/search", text: "keyed.ep_search", params: ["q", "page"] },
  { path: "/api/v1/organizations/{id}/records", text: "keyed.ep_org_records", params: ["source", "year", "page"] },
  { path: "/api/v1/buyers/{id}/records", text: "keyed.ep_buyer_records", params: ["source", "year", "page"] },
  { path: "/api/v1/me", text: "keyed.ep_me", params: [] },
];

// Each parameter's meaning, in the order the Data page lists them.
export const KEYED_PARAMS: readonly [string, Key][] = [
  ["category", "keyed.p_category"],
  ["segment", "keyed.p_segment"],
  ["province", "keyed.p_province"],
  ["national", "keyed.p_national"],
  ["derived", "keyed.p_derived"],
  ["code", "keyed.p_code"],
  ["buyer", "keyed.p_buyer"],
  ["type", "keyed.p_type"],
  ["method", "keyed.p_method"],
  ["closing", "keyed.p_closing"],
  ["q", "keyed.p_q"],
  ["sort", "keyed.p_sort"],
  ["day", "keyed.p_day"],
  ["source", "keyed.p_source"],
  ["year", "keyed.p_year"],
  ["page", "keyed.p_page"],
];
