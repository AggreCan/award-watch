// The same-day notices (src/intraday.ts, src/pages/intraday.tsx, src/plan.ts):
// the D1 rows as list rows, the merge against what the nightly published, the
// free page untouched (no D1 call, no extra file, the same bytes), the paid
// band on /tenders and /tenders/new in both languages, and the free view
// when D1 fails. The rows live in a real local D1 with
// pipeline/intraday_schema.sql applied, as the operator applies it.
//
// requestPlan answers "free" in the code until the accounts module lands, so
// the paid tests set the plan through a module mock; every other test file
// sees the real one. The Worker's modules are loaded before this file's mock
// is registered, so the app is imported afresh after the registry is reset.
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TenderRow } from "../src/data";
import { INTRADAY_SQL, MAX_ROWS, type IntradayRow, loadIntraday, mergeIntraday, toIntradayRow } from "../src/intraday";
import { INTRADAY } from "../src/plan";
import { tenderColumns } from "../src/pages/shared";
import { headClass } from "../src/columns";
import { fakeAssets, makeFakeAssets, testEnv } from "./assets";
import { applySql } from "./setup";

const plan = vi.hoisted(() => ({ value: "free" as "free" | "pro" }));
vi.mock("../src/plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/plan")>();
  return { ...actual, requestPlan: async () => plan.value };
});

const SEARCH = (env as unknown as { SEARCH: D1Database }).SEARCH;
const SCHEMA = (env as unknown as { INTRADAY_SCHEMA_SQL: string }).INTRADAY_SCHEMA_SQL;
const DATA_DATE = "2026-10-31";

let address = 0;
const get = (path: string, e: object = testEnv()) =>
  app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": `198.19.7.${(address++ % 250) + 1}` } }, e);
const html = async (path: string, e: object = testEnv()) => (await get(path, e)).text();
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const EM_DASH = String.fromCharCode(0x2014);
const BAND = /<section class="panel intraday">[\s\S]*?<\/section>/;

type Seed = Partial<Record<string, string | number | null>> & { reference: string; amendment: number; seen_at: string };

// The rows as the pipeline writes them (intraday.py): lists as JSON text, the
// buyer's names beside its id or the spelling as published without one.
const ROWS: Seed[] = [
  {
    reference: "cb-900-90000001", amendment: 0, seen_at: "2026-10-31T15:45:10Z", published: "2026-10-31",
    closing: "2026-11-20T14:00:00", title_en: "Same-day snow removal, regional depot", title_fr: "Déneigement du jour, dépôt régional",
    buyer_id: "pwgsc-tpsgc", buyer_name: "Public Services and Procurement Canada",
    buyer_name_fr: "Services publics et Approvisionnement Canada", category: '["SRV"]', segments: '["72"]',
    provinces: '["NS"]', codes: '["7210"]', notice_type_en: "Request for Proposal", notice_type_fr: "Demande de proposition",
  },
  {
    // An unresolved buyer: the spelling as published and no link.
    reference: "SSC-26-00099999-T", reference_published: "SSC-26-00099999:T", amendment: 0, seen_at: "2026-10-31T13:45:05Z",
    published: null, closing: "2026-11-09T14:00:00", title_en: "Server racks for five sheds", title_fr: "Bâtis de serveurs pour cinq hangars",
    buyer_id: null, buyer_name: "Some Base Supply Office", buyer_name_fr: null, provinces: '["MB"]',
  },
  // cb-100-10000001 is listed at amendment 1 (open-first.json): amendment 2 replaces it in the band.
  {
    reference: "cb-100-10000001", amendment: 2, seen_at: "2026-10-31T13:45:05Z", published: "2026-10-20",
    closing: "2026-11-04T14:00:00", title_en: "Translation services for regional offices", title_fr: "Services de traduction pour les bureaux régionaux",
    buyer_id: "pwgsc-tpsgc", buyer_name: "Public Services and Procurement Canada", buyer_name_fr: "Services publics et Approvisionnement Canada",
  },
  // Already listed at the same amendment (tenders/new/2026-10-31.json and open-first.json): left out.
  { reference: "cb-200-20005019", amendment: 0, seen_at: "2026-10-31T11:45:00Z", title_en: "Listed already, same version" },
  // Listed at a higher amendment than this one: left out.
  { reference: "cb-100-10000001", amendment: 0, seen_at: "2026-10-31T11:45:00Z", title_en: "An older version" },
  // Read before the data date: the nightly's list holds what came before, so the query leaves it out.
  { reference: "cb-800-80000001", amendment: 0, seen_at: "2026-10-30T23:45:00Z", title_en: "Read before the data date" },
];

const COLUMNS = ["reference", "reference_published", "amendment", "seen_at", "published", "closing", "title_en", "title_fr",
  "buyer_id", "buyer_name", "buyer_name_fr", "category", "notice_type_en", "notice_type_fr", "method_en", "method_fr",
  "segments", "provinces", "codes", "excerpt_en", "excerpt_fr"];

async function seed(rows: Seed[] = ROWS): Promise<void> {
  await applySql(SEARCH, SCHEMA);
  await SEARCH.prepare("DELETE FROM intraday_tenders").run();
  const sql = `INSERT INTO intraday_tenders (${COLUMNS.join(", ")}) VALUES (${COLUMNS.map(() => "?").join(", ")})`;
  await SEARCH.batch(rows.map((r) => SEARCH.prepare(sql).bind(...COLUMNS.map((c) => {
    const v = r[c];
    return v === undefined ? (["category", "segments", "provinces", "codes"].includes(c) ? "[]" : null) : v;
  }))));
}

let app: (typeof import("../src/index"))["app"];

beforeAll(async () => {
  vi.resetModules();
  ({ app } = await import("../src/index"));
  await seed();
});
beforeEach(() => { plan.value = "free"; });

// A D1 binding that records every use and refuses it.
function watchedDb(): { db: D1Database; calls: string[] } {
  const calls: string[] = [];
  const db = new Proxy({}, {
    get(_t, prop) {
      calls.push(String(prop));
      return () => { throw new Error("D1 was used"); };
    },
  }) as unknown as D1Database;
  return { db, calls };
}

// The assets binding, noting each path asked for.
function watchedAssets(): { assets: Fetcher; paths: string[] } {
  const paths: string[] = [];
  const assets = {
    fetch: async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      paths.push(new URL(url).pathname);
      return fakeAssets.fetch(input as RequestInfo);
    },
  } as unknown as Fetcher;
  return { assets, paths };
}

const row = (over: Partial<IntradayRow>): IntradayRow => ({
  reference: "cb-1", amendment: 0, title_en: null, title_fr: null, buyer_id: null, buyer_en: null, buyer_fr: null,
  published: null, closing: null, category: [], notice_type_en: null, notice_type_fr: null, method_en: null,
  method_fr: null, segments: [], provinces: [], first_seen: "2026-10-31", seen_at: "2026-10-31T13:45:00Z", ...over,
});
const listed = (reference: string, amendment: number): TenderRow => ({ ...row({ reference, amendment }) });

describe("the rows", () => {
  it("maps a D1 row to a list row with the time it was first read", () => {
    const r = toIntradayRow({
      reference: "SSC-26-00099999-T", reference_published: "SSC-26-00099999:T", amendment: 1, seen_at: "2026-10-31T13:45:05Z",
      published: "2026-10-31", closing: "2026-11-09T14:00:00", title_en: "Racks", title_fr: "Bâtis", buyer_id: "ssc-spc",
      buyer_name: "Shared Services Canada", buyer_name_fr: "Services partagés Canada", category: '["GD","XX"]',
      notice_type_en: "Request for Proposal", notice_type_fr: "Demande de proposition", method_en: null, method_fr: null,
      segments: '["43","99","4"]', provinces: '["MB","ZZ"]', codes: '["4321","43211501","x"]', excerpt_en: "Racks for sheds",
      excerpt_fr: null,
    });
    expect(r).toEqual({
      reference: "SSC-26-00099999-T", reference_published: "SSC-26-00099999:T", amendment: 1, seen_at: "2026-10-31T13:45:05Z",
      first_seen: "2026-10-31", published: "2026-10-31", closing: "2026-11-09T14:00:00", title_en: "Racks", title_fr: "Bâtis",
      buyer_id: "ssc-spc", buyer_en: "Shared Services Canada", buyer_fr: "Services partagés Canada", category: ["GD"],
      notice_type_en: "Request for Proposal", notice_type_fr: "Demande de proposition", method_en: null, method_fr: null,
      segments: ["43"], provinces: ["MB"], codes: ["4321", "43211501"], excerpt_en: "Racks for sheds", excerpt_fr: null,
    });
  });

  it("leaves out a row whose key or time does not read, and a buyer id that is not one", () => {
    const good = { reference: "cb-1", amendment: 0, seen_at: "2026-10-31T13:45:05Z" };
    expect(toIntradayRow(good)).not.toBeNull();
    for (const bad of [{ reference: "bad ref/1" }, { reference: "" }, { amendment: -1 }, { amendment: 1.5 }, { amendment: "0" },
      { seen_at: "2026-10-31" }, { seen_at: null }]) {
      expect(toIntradayRow({ ...good, ...bad }), JSON.stringify(bad)).toBeNull();
    }
    const odd = toIntradayRow({ ...good, buyer_id: "../admin", reference_published: "cb-1", category: "not json", segments: "{}" })!;
    expect([odd.buyer_id, odd.reference_published, odd.category, odd.segments]).toEqual([null, undefined, [], []]);
  });

  it("reads the rows first read on or after the data date, newest first, through one constant statement", async () => {
    const rows = await loadIntraday(SEARCH, DATA_DATE);
    expect(rows.map((r) => `${r.reference}/${r.amendment}`)).toEqual([
      "cb-900-90000001/0", "SSC-26-00099999-T/0", "cb-100-10000001/2", "cb-100-10000001/0", "cb-200-20005019/0",
    ]);
    expect(await loadIntraday(SEARCH, "not a date")).toEqual([]);
    expect(INTRADAY_SQL).toMatch(/WHERE seen_at >= \? ORDER BY seen_at DESC, reference, amendment DESC LIMIT \?$/);
    expect(MAX_ROWS).toBe(500);
    expect(INTRADAY).toBe("intraday");
  });
});

describe("the merge", () => {
  it("shows a notice the list lacks as new and a later amendment as amended, and leaves out the rest", () => {
    const open = [listed("cb-100", 1), listed("cb-200", 0), listed("CB-300", 3)];
    const merged = mergeIntraday(open, [
      row({ reference: "cb-900", seen_at: "2026-10-31T15:45:00Z" }),
      row({ reference: "cb-100", amendment: 2, seen_at: "2026-10-31T13:45:00Z" }),
      row({ reference: "cb-200", amendment: 0 }),
      row({ reference: "cb-300", amendment: 2 }),
      row({ reference: "cb-300", amendment: 3 }),
    ]);
    expect(merged.map((r) => [r.reference, r.amendment, r.intraday])).toEqual([["cb-900", 0, "new"], ["cb-100", 2, "amended"]]);
  });

  it("keeps the newest version read of each notice and orders the band newest first", () => {
    const merged = mergeIntraday([], [
      row({ reference: "cb-b", amendment: 0, seen_at: "2026-10-31T11:45:00Z" }),
      row({ reference: "cb-a", amendment: 0, seen_at: "2026-10-31T11:45:00Z" }),
      row({ reference: "cb-b", amendment: 1, seen_at: "2026-10-31T17:45:00Z" }),
      row({ reference: "cb-c", amendment: 0, seen_at: "2026-10-31T13:45:00Z" }),
    ]);
    expect(merged.map((r) => `${r.reference}/${r.amendment}/${r.intraday}`)).toEqual(["cb-b/1/new", "cb-c/0/new", "cb-a/0/new"]);
    expect(mergeIntraday([listed("cb-a", 0)], [])).toEqual([]);
  });
});

describe("a free request", () => {
  it("makes no D1 call and reads no file for the band", async () => {
    for (const path of ["/tenders", "/tenders/new", "/tenders?lang=fr", "/tenders/new?lang=fr"]) {
      const { db, calls } = watchedDb();
      const { assets, paths } = watchedAssets();
      const res = await get(path, { ...testEnv(assets), SEARCH: db });
      expect(res.status, path).toBe(200);
      expect(calls, path).toEqual([]);
      if (path.startsWith("/tenders?") || path === "/tenders") expect(paths, path).not.toContain(`/data/tenders/new/${DATA_DATE}.json`);
    }
  });

  it("gets the same bytes whatever D1 holds or does", async () => {
    for (const path of ["/tenders", "/tenders/new", "/tenders?lang=fr", "/tenders/new?lang=fr"]) {
      const withRows = await html(path);
      expect(withRows, path).not.toContain("intraday");
      expect(await html(path, { ...testEnv(), SEARCH: undefined }), path).toBe(withRows);
      expect(await html(path, { ...testEnv(), SEARCH: watchedDb().db }), path).toBe(withRows);
    }
  });
});

describe("a paid request", () => {
  it("draws the band above the list on /tenders, in the list's columns", async () => {
    plan.value = "pro";
    const page = await html("/tenders");
    const band = BAND.exec(page)?.[0] ?? "";
    expect(band).toContain('<h2>3 notices posted since this morning&#39;s refresh</h2>');
    expect(page.indexOf(band)).toBeLessThan(page.indexOf('<div class="split" id="tender-split">'));
    // The heads and widths of the table below.
    // The band is whole on the page, so its heads sort it there.
    for (const col of tenderColumns("en")) expect(band).toContain(`<th class="${headClass(col)}"><button type="button" class="th-sort">${col.label}</button></th>`);
    expect(band.match(/<tr data-intraday="(new|amended)">/g)).toEqual([
      '<tr data-intraday="new">', '<tr data-intraday="new">', '<tr data-intraday="amended">',
    ]);
    expect(band).toContain('<span class="tag">same day</span>');
    expect(band).toContain('<span class="tag">amended today</span>');
    // The title opens the notice on CanadaBuys (the site has no page for it until the nightly).
    expect(band).toContain('<a href="https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-900-90000001" rel="noopener">Same-day snow removal, regional depot</a>');
    expect(band).toContain('<a href="https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/ssc-26-00099999t" rel="noopener">');
    expect(band).toContain('<span class="mono id muted">SSC-26-00099999:T</span>');
    // A listed buyer links its page; an unresolved one shows the name as published, no link.
    expect(band).toContain('<a href="/buyers/pwgsc-tpsgc">Public Services and Procurement Canada</a>');
    expect(band).toContain('<td data-label="Buyer" class="c-buyer">Some Base Supply Office<span class="split-only md-only muted small">');
    // Left out: the version already listed, the older amendment, the row read before the data date.
    for (const gone of ["Listed already, same version", "An older version", "Read before the data date"]) expect(page).not.toContain(gone);
    // The rest of the page is the free page.
    plan.value = "free";
    expect(page.replace(band, "")).toBe(await html("/tenders"));
  });

  it("draws the band in French", async () => {
    plan.value = "pro";
    const band = nbsp(BAND.exec(await html("/tenders?lang=fr"))?.[0] ?? "");
    expect(band).toContain("<h2>3 avis publiés depuis la mise à jour de ce matin</h2>");
    expect(band).toContain('<span class="tag">le jour même</span>');
    expect(band).toContain('<span class="tag">modifié aujourd’hui</span>');
    expect(band).toContain("Lus sur AchatsCanada toutes les deux heures.");
    expect(band).toContain('<a href="https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/cb-900-90000001" rel="noopener">Déneigement du jour, dépôt régional</a>');
    expect(band).toContain('<a href="/buyers/pwgsc-tpsgc">Services publics et Approvisionnement Canada</a>');
    // A buyer with no French spelling shows the English one.
    expect(band).toContain("Some Base Supply Office");
    expect(band).not.toContain(EM_DASH);
  });

  it("draws the band on the newest day of /tenders/new only", async () => {
    plan.value = "pro";
    const page = await html("/tenders/new");
    const band = BAND.exec(page)?.[0] ?? "";
    expect(band).toContain("3 notices posted since this morning&#39;s refresh");
    expect(page.indexOf(band)).toBeLessThan(page.indexOf("<h2>First Seen on 2026-10-31</h2>"));
    const fr = nbsp(await html("/tenders/new?lang=fr"));
    expect(fr).toContain("3 avis publiés depuis la mise à jour de ce matin");
    expect(await html("/tenders/new?day=2026-10-30")).not.toContain("intraday");
  });

  it("runs the countdown on /tenders/new for the band's closing-soon rows when the day's list has none", async () => {
    // The day's list empty: only the band (cb-100-10000001 at amendment 2 closes on 2026-11-04) is closing soon.
    const quiet = testEnv(makeFakeAssets({}, { [`tenders/new/${DATA_DATE}.json`]: [] }));
    expect(await html("/tenders/new", quiet)).not.toContain("/countdown.js");
    plan.value = "pro";
    const page = await html("/tenders/new", quiet);
    expect(BAND.exec(page)?.[0] ?? "").toContain('data-closes="2026-11-04T19:00:00Z"');
    expect(page).toContain('<script type="module" src="/countdown.js"></script>');
  });

  it("says one notice in the singular", async () => {
    plan.value = "pro";
    await seed([ROWS[0]]);
    try {
      expect(await html("/tenders")).toContain("<h2>1 notice posted since this morning&#39;s refresh</h2>");
      expect(nbsp(await html("/tenders?lang=fr"))).toContain("<h2>1 avis publié depuis la mise à jour de ce matin</h2>");
    } finally {
      await seed();
    }
  });

  it("shows no band when nothing is new since the nightly", async () => {
    plan.value = "pro";
    await seed(ROWS.slice(3));
    try {
      expect(await html("/tenders")).not.toContain("intraday");
    } finally {
      await seed();
    }
  });

  it("gets the free view, and no error, when D1 is missing or fails", async () => {
    const free = await html("/tenders");
    const freeNew = await html("/tenders/new");
    plan.value = "pro";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      prepare: () => ({ bind: () => ({ all: async () => { throw new Error("D1_ERROR: no such table: intraday_tenders: SQLITE_ERROR"); } }) }),
    };
    try {
      for (const search of [undefined, failing, watchedDb().db]) {
        const e = { ...testEnv(), SEARCH: search };
        const res = await get("/tenders", e);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(free);
        expect(await html("/tenders/new", e)).toBe(freeNew);
      }
      expect(error.mock.calls.flat().join(" ")).toContain("intraday: query failed (SQLITE_ERROR, no such table)");
    } finally {
      error.mockRestore();
    }
  });
});

// The top bar's sub-daily timer (src/refresh.tsx): a page drawn from the
// same-day notices carries the last cut's stamp (the newest run that went
// through, intraday_runs), and reads a cut as under way from its scheduled
// time until a later run is in. The tests' clock is 16:00 UTC, so the 15:45
// cut is the last one due.
describe("the sub-daily timer on a page with the band", () => {
  const sameDay = (page: string) =>
    /<a class="refresh"[^>]*data-refresh-key="same_day"[^>]*>[\s\S]*?<span class="refresh-left">((?:[^<]|<span class="refresh-(?:short|full)">[^<]*<\/span>)*)<\/span>/.exec(page);
  const addRun = (id: string, at: string, ok: number) =>
    SEARCH.prepare("INSERT INTO intraday_runs (id, at, ok) VALUES (?, ?, ?)").bind(`timer-${id}`, at, ok).run();

  it("counts down once the cut is in, and reads it under way while it is not, in both languages", async () => {
    try {
      await addRun("in", "2026-10-31T15:52:10Z", 1);
      plan.value = "pro";
      const done = sameDay(await html("/tenders"));
      expect(done?.[0]).toContain('data-refresh-key="same_day" data-data-at="2026-10-31T15:52:10Z"');
      expect(done?.[1]).toBe("1h 45m");
      // The 15:45 run failed: the newest run that went through is the 13:45 cut's.
      await SEARCH.prepare("DELETE FROM intraday_runs WHERE id LIKE 'timer-%'").run();
      await addRun("old", "2026-10-31T13:51:00Z", 1);
      await addRun("failed", "2026-10-31T15:53:00Z", 0);
      const en = sameDay(await html("/tenders"));
      expect(en?.[0]).toContain('data-data-at="2026-10-31T13:51:00Z"');
      expect(en?.[1]).toBe('<span class="refresh-short">Since 15:45</span><span class="refresh-full">Under way since 15:45</span>');
      const fr = sameDay(await html("/tenders/new?lang=fr"));
      expect(nbsp(fr?.[1] ?? "")).toBe('<span class="refresh-short">Depuis 15:45</span><span class="refresh-full">En cours depuis 15:45</span>');
      expect(fr?.[1]).not.toContain(EM_DASH);
      // A free reader's page shows no same-day notice, so its timer has no stamp and counts down as before.
      plan.value = "free";
      const free = sameDay(await html("/tenders"));
      expect(free?.[0]).not.toContain("data-data-at");
      expect(free?.[1]).toBe("1h 45m");
    } finally {
      await SEARCH.prepare("DELETE FROM intraday_runs WHERE id LIKE 'timer-%'").run();
    }
  });
});
