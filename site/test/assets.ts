// A stand-in for the static assets binding: serves the JSON fixtures under
// /data/ the way the deployed Worker reads the pipeline's export, plus the
// two crawler files from public/.
import { env } from "cloudflare:test";
import llms from "../public/llms.txt?raw";
import robots from "../public/robots.txt?raw";
import aliases from "./fixtures/aliases-a00.json";
import awards2026Page1 from "./fixtures/awards-2026-1.json";
import awards2026Page2 from "./fixtures/awards-2026-2.json";
import awards2026 from "./fixtures/awards-2026-index.json";
import awardsRecent from "./fixtures/awards-recent.json";
import buyer from "./fixtures/buyer-pwgsc-tpsgc.json";
import buyers from "./fixtures/buyers-index.json";
import buyerAliases from "./fixtures/buyers-aliases.json";
import categories from "./fixtures/categories-index.json";
import category82 from "./fixtures/category-82.json";
import contracts from "./fixtures/contracts-637.json";
import contractsConverted from "./fixtures/contracts-557.json";
import expiring3mPage1 from "./fixtures/expiring-3m-1.json";
import expiring3m from "./fixtures/expiring-3m-index.json";
import expiringIndex from "./fixtures/expiring-index.json";
import feedCanadaTenders from "./fixtures/feed-canada-tenders.xml?raw";
import directory from "./fixtures/directory-index.json";
import directoryOn1 from "./fixtures/directory-on-1.json";
import directoryOn from "./fixtures/directory-on-index.json";
import directoryYt from "./fixtures/directory-yt-index.json";
import feeds from "./fixtures/feeds-index.json";
import profiles from "./fixtures/profiles-a00.json";
import rankings2026 from "./fixtures/rankings-2026.json";
import rankingsAll from "./fixtures/rankings-all.json";
import sitemapPart from "./fixtures/sitemap-1.xml?raw";
import sitemapIndex from "./fixtures/sitemap-index.xml?raw";
import stats from "./fixtures/stats.json";
import tenderShard from "./fixtures/tenders-20a.json";
import tenderConverted from "./fixtures/tenders-f3d.json";
import newDay from "./fixtures/tenders-new-2026-10-31.json";
import openTenders from "./fixtures/tenders-open.json";
import openFirst from "./fixtures/tenders-open-first.json";

// Served as written rather than as JSON: the sitemaps and a feed under
// /data/, and the crawler files at the root.
const TEXT_FILES: Record<string, [string, string]> = {
  "data/sitemaps/index.xml": [sitemapIndex, "application/xml"],
  "data/sitemaps/sitemap-1.xml": [sitemapPart, "application/xml"],
  "data/feeds/canada/tenders.xml": [feedCanadaTenders, "application/atom+xml"],
  "robots.txt": [robots, "text/plain; charset=utf-8"],
  "llms.txt": [llms, "text/plain; charset=utf-8"],
};

// Paths under /data/, as the export writes them (CLAUDE.md "Static export
// layout"). The shard names are the SHA-1 prefixes of the fixtures' lower-cased
// references (tenders/20a: cb-100-10000001 and cb-200-20005019;
// contracts/637: cb-400-40000004 and W8472-000633) and the profile ids'
// characters 5 to 7 (profiles/a00).
export const FILES: Record<string, unknown> = {
  "stats.json": stats,
  // The full list is the browser's (public/tenders.js); the page renders from the first file.
  "tenders/open.json": openTenders,
  "tenders/open-first.json": openFirst,
  "tenders/new/2026-10-31.json": newDay,
  "tenders/20a.json": tenderShard,
  "contracts/637.json": contracts,
  // References written URL-safe by the export, with the published form beside
  // them: tender en578-123456-a-1 (EN578-123456/A:1) and award and history
  // 23240-220799-001-im (23240-220799/001/IM).
  "tenders/f3d.json": tenderConverted,
  "contracts/557.json": contractsConverted,
  "awards/recent.json": awardsRecent,
  // A year in pages of 500 rows; the fixture's pages are small, two of them.
  "awards/2026/index.json": awards2026,
  "awards/2026/1.json": awards2026Page1,
  "awards/2026/2.json": awards2026Page2,
  "profiles/a00.json": profiles,
  "aliases/a0.json": aliases,
  "directory/index.json": directory,
  "directory/on/index.json": directoryOn,
  "directory/on/1.json": directoryOn1,
  "directory/yt/index.json": directoryYt,
  "buyers/index.json": buyers,
  "buyers/pwgsc-tpsgc.json": buyer,
  // Buyer ids that moved: old id to new.
  "buyers/aliases.json": buyerAliases,
  "categories/index.json": categories,
  "categories/82.json": category82,
  "rankings/all.json": rankingsAll,
  "rankings/2026.json": rankings2026,
  "feeds/index.json": feeds,
  // The contracts ending soon: the index and the 3-month window, one page.
  // The 6- and 12-month windows are not published here, so they read as
  // missing.
  "expiring/index.json": expiringIndex,
  "expiring/3m/index.json": expiring3m,
  "expiring/3m/1.json": expiring3mPage1,
};

// The assets binding sends a strong ETag that changes with the file's
// content, and loadJson keeps parsed files by it. The fake derives its ETag
// from the body in the same way, so a fixture a test changes gets a new one.
export async function contentEtag(body: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  return `"${[...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
}

// The fixtures above, each with its content's ETag. A path named in etags
// gets that ETag instead, or none when it is null. overrides replaces or
// adds files by their path under /data/ (undefined removes one).
export function makeFakeAssets(etags: Record<string, string | null> = {}, overrides: Record<string, unknown> = {}): Fetcher {
  const files: Record<string, unknown> = { ...FILES, ...overrides };
  const respond = async (body: string, path: string, type: string) => {
    const etag = path in etags ? etags[path] : await contentEtag(body);
    return new Response(body, { headers: { "content-type": type, ...(etag === null ? {} : { etag }) } });
  };
  return {
    fetch: async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const full = new URL(url).pathname.replace(/^\//, "");
      const text = TEXT_FILES[full];
      if (text !== undefined) return respond(text[0], full, text[1]);
      if (!full.startsWith("data/")) return new Response("not found", { status: 404 });
      const path = full.slice("data/".length);
      const file = files[path];
      if (file === undefined) return new Response("not found", { status: 404 });
      return respond(typeof file === "string" ? file : JSON.stringify(file), path, "application/json");
    },
  } as unknown as Fetcher;
}

export const fakeAssets = makeFakeAssets();

export const emptyAssets = {
  fetch: async () => new Response("not found", { status: 404 }),
} as unknown as Fetcher;

// The fixtures without the files named: a page whose file is missing answers "not published".
export function assetsWithout(...paths: string[]): Fetcher {
  return makeFakeAssets({}, Object.fromEntries(paths.map((p) => [p, undefined])));
}

export function testEnv(assets: Fetcher = fakeAssets) {
  return { ...(env as object), ASSETS: assets } as typeof env & { ASSETS: Fetcher };
}
