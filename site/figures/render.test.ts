// The pages the guides' figures are captured from (docs/guides.md, Figures),
// rendered by the Worker from the sample records in this folder, never from
// real ones: tenders.json and contracts.json (served as the detail shards the
// pages read, each record in the shard its reference hashes to), data/ (the
// other files under /data/, at their paths) and records.sql (the records
// database). The clock is the samples' data date at noon, Eastern time, and
// the accounts switch is off, so no page shows an account control.
//
// Run by scripts/make-guide-figures.mjs (`npm run figures`) through
// vitest.figures.config.ts; the default suite never takes this folder. A test
// inside workerd cannot write a file, so it writes each page to the console
// in base64 lines, "@@FIG <name> <i> <n> <base64>", which the config sends to
// the tool's file. The first item, "manifest", says what each page is: the
// figures with their guide, page, region and targets, then each page and
// guide page by language.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { referenceShard } from "../src/data";
import { GUIDES, guideFigures } from "../src/guides";
import { app } from "../src/index";
import { applySql } from "../test/setup";
import contracts from "./contracts.json";
import tenders from "./tenders.json";
import recordsSql from "./records.sql?raw";

// The samples' data date (data/stats.json) at noon in Ottawa.
const NOW = "2026-11-13T17:00:00Z";
const FILES = import.meta.glob("./data/**/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

// The detail shards, built from the records the way the export writes them.
async function shards(records: Record<string, unknown>, prefix: string, keyRef: (key: string) => string): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const [key, record] of Object.entries(records)) {
    const path = `${prefix}/${await referenceShard(keyRef(key))}.json`;
    out.set(path, { ...(out.get(path) ?? {}), [key]: record });
  }
  return out;
}

async function sampleAssets(): Promise<Fetcher> {
  const served = new Map<string, unknown>(Object.entries(FILES).map(([p, v]) => [p.slice("./data/".length), v]));
  for (const [p, v] of await shards(tenders, "tenders", (k) => k)) served.set(p, v);
  for (const [p, v] of await shards(contracts, "contracts", (k) => k.slice(k.indexOf(":") + 1))) served.set(p, v);
  return {
    fetch: async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname.replace(/^\/data\//, "");
      const file = served.get(path);
      if (file === undefined) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(file), { headers: { "content-type": "application/json", etag: `"${path.length}-${JSON.stringify(file).length}"` } });
    },
  } as unknown as Fetcher;
}

// One item to the tool, cut into lines the console carries whole.
function emit(name: string, text: string): void {
  const bytes = new TextEncoder().encode(text);
  const size = 6000;
  const n = Math.max(1, Math.ceil(bytes.length / size));
  for (let i = 0; i < n; i++) {
    let s = "";
    for (const b of bytes.subarray(i * size, (i + 1) * size)) s += String.fromCharCode(b);
    console.log(`@@FIG ${name} ${i} ${n} ${btoa(s)}`);
  }
}

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
beforeAll(async () => {
  await applySql(RECORDS, RECORDS_SCHEMA);
  await applySql(RECORDS, recordsSql);
});

const withLang = (path: string, lang: "en" | "fr") => (lang === "en" ? path : `${path}${path.includes("?") ? "&" : "?"}lang=fr`);

describe("the guides' figures", () => {
  it("render every page a figure is captured from, and every guide that holds one, in both languages", async () => {
    const assets = await sampleAssets();
    const pageEnv = { ...(env as object), ASSETS: assets, NOW, ACCOUNTS_ENABLED: "false" };
    const figures = guideFigures();
    const pages = [...new Set(figures.map((f) => f.figure.shot.page))];
    const guides = GUIDES.filter((g) => figures.some((f) => f.slug === g.slug)).map((g) => `/guides/${g.slug}`);
    const items: { name: string; path: string; lang: "en" | "fr"; kind: "page" | "guide" }[] = [];
    for (const [kind, list] of [["page", pages], ["guide", guides]] as const) {
      for (const path of list) for (const lang of ["en", "fr"] as const) items.push({ name: `p${items.length}`, path: withLang(path, lang), lang, kind });
    }
    emit("manifest", JSON.stringify({
      figures: figures.map(({ slug, figure }) => ({
        id: figure.id, slug, page: figure.shot.page, region: figure.shot.region, targets: figure.callouts.map((c) => c.target),
      })),
      items,
    }));
    for (const item of items) {
      const res = await app.request(item.path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": "192.0.2.10" } }, pageEnv);
      expect(res.status, item.path).toBe(200);
      emit(item.name, await res.text());
    }
  });
});
