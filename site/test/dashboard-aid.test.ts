// More Kinds of Tile (src/account/dashboard.tsx; docs/accounts.md, Dashboard):
// the kinds of tile an Ultra account cannot add yet, each with the one step
// that gives it what the tile shows and a link to the page where that is
// done. Inside Add a Tile on every view of the page (the page has no edit
// mode; there the analytics line is left out, Add a Tile's Analytics group
// saying it already), and under the starting layout's tiles too, so a first
// visit finds it; each line goes once the account holds what its kind needs, and the
// list goes once none is left; the briefings' and the claims' lines only
// while their tables are on the database; none while nothing can be added
// (a full dashboard, or no table to keep a tile in); nothing read for it
// (the statements and the static files of a page view counted against the
// figures measured with the grid's two reads, before the list); every link
// answers for the account.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ACCOUNTS, PRO_SALE, csrf, decode, get, grantUltra, nbsp, newEmail, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { applySql, splitSql } from "./setup";
import { misfits } from "./table-fit";
import { type Holdings, moreKinds } from "../src/account/dashboard";
import accountsSchema from "../accounts_schema.sql?raw";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const DAY = "2026-10-31";
const A1 = "org-a000000001";

// The records database empty but ready at the data date, so the starting layout's tiles read.
beforeAll(async () => {
  await applySql(RECORDS, SCHEMA);
  await RECORDS.prepare("INSERT OR REPLACE INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(DAY).run();
});

// The switch on, Pro's variables (Ultra off sale: the dashboard is the account's by its grant).
const off = (extra: Record<string, unknown> = {}) => onEnv({ ...PRO_SALE, ...extra });

// The fixtures hold the 3-month window alone; the site publishes all three, and the radar's line opens the 12-month one.
const WINDOWS = makeFakeAssets({}, {
  "expiring/12m/index.json": { ...(FILES["expiring/3m/index.json"] as object), window: "12m" }, "expiring/12m/1.json": FILES["expiring/3m/1.json"],
});

const norm = (s: string) => nbsp(s).replace(/’/g, "'");
const text = async (res: Response) => norm(decode(await res.text()));
const mainOf = (html: string) => html.slice(html.indexOf("<main"), html.indexOf("</main>"));

type Reader = { email: string; id: string; cookie: string; csrf: string };

async function reader(tag: string): Promise<Reader> {
  const email = newEmail(tag);
  const cookie = await signIn(email, { env: off() });
  await grantUltra(email);
  return { email, id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env: off() }) };
}

const open = (r: Reader, path = "/account/dashboard", e: object = off()) => get(path, { cookie: r.cookie, env: e });
const send = (r: Reader, path: string, fields: Record<string, string> = {}) => post(path, { csrf: r.csrf, ...fields }, { cookie: r.cookie, env: off() });

type List = { title: string; lines: string[]; at: number };
const linesOf = (ul: string) => [...ul.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => x[1]);
// The list inside Add a Tile, from a page's main element; null when it is not drawn.
const ADDER_RE = /<p class="dash-adder-head">([^<]*)<\/p><ul class="muted">([\s\S]*?)<\/ul><\/div><\/details>/;
function moreOf(html: string): List | null {
  const main = mainOf(html);
  const m = ADDER_RE.exec(main);
  if (!m) return main.includes("dash-adder-head") ? { title: "(malformed)", lines: [], at: -1 } : null;
  return { title: m[1], lines: linesOf(m[2]), at: m.index };
}
// The panel under the starting layout's tiles; null when it is not drawn.
const PANEL_RE = /<section class="panel panel-form dash-more"><div class="panel-head"><h2>([^<]*)<\/h2><\/div><ul class="muted">([\s\S]*?)<\/ul><\/section>/;
function panelOf(html: string): List | null {
  const main = mainOf(html);
  const m = PANEL_RE.exec(main);
  if (!m) return main.includes("dash-more") ? { title: "(malformed)", lines: [], at: -1 } : null;
  return { title: m[1], lines: linesOf(m[2]), at: m.index };
}

// Each line in PANEL_KINDS order, in both languages, with the page it links to.
type Line = { name: string; href: string; en: string; fr: string };
const line = (name: string, href: string, en: [string, string, string], fr: [string, string, string]): Line => ({
  name, href, en: `${en[0]}<a href="${href}">${en[1]}</a>${en[2]}`, fr: `${fr[0]}<a href="${href}">${fr[1]}</a>${fr[2]}`,
});
const LINES: Line[] = [
  line("tenders", "/tenders",
    ["A tender search's open notices: save a search on the ", "tender list", "."],
    ["Les avis ouverts d'une recherche d'appels d'offres : enregistrez une recherche sur la ", "liste des appels d'offres", "."]),
  line("radar", "/expiring/12m",
    ["A filtered list of contracts ending: save a search on a ", "list of contracts ending", "."],
    ["Une liste filtrée de contrats prenant fin : enregistrez une recherche sur une ", "liste de contrats prenant fin", "."]),
  line("records", "/account/searches",
    ["An organization's, a buyer's or a segment's records: paste the address of its page into Add a Search on ", "your saved searches", "."],
    ["Les dossiers d'une organisation, d'un acheteur ou d'un segment : collez l'adresse de sa page dans Ajouter une recherche, sur ", "vos recherches enregistrées", "."]),
  line("view", "/analytics",
    ["A table or chart of an analytics view: open a view from ", "Analytics", " and choose Add to dashboard on it."],
    ["Un tableau ou un graphique d'une vue d'analyse : ouvrez une vue depuis ", "Analyses", " et choisissez Ajouter au tableau de bord sur celui-ci."]),
  line("briefing", "/segments",
    ["A weekly briefing, this week so far: save a briefing on a ", "segment's page", " or a buyer's page."],
    ["Un bulletin hebdomadaire, semaine en cours : enregistrez un bulletin sur la ", "page d'un segment", " ou celle d'un acheteur."]),
  line("org", "/account/organization",
    ["Your organization's figures and matching notices: ", "choose your organization", "."],
    ["Les chiffres de votre organisation et les avis correspondants : ", "choisissez votre organisation", "."]),
  line("api", "/account/keys",
    ["API requests today: create a key on the ", "API Keys", " page."],
    ["Les requêtes à l'API aujourd'hui : créez une clé sur la page ", "Clés d'API", "."]),
];
const TITLE = { en: "More Kinds of Tile", fr: "Autres genres de tuiles" };
const all = (lang: "en" | "fr", but: readonly string[] = []) => LINES.filter((l) => !but.includes(l.name)).map((l) => l[lang]);
// The lines inside Add a Tile: all but the analytics line, which its Analytics group says.
const inAdd = (lang: "en" | "fr", but: readonly string[] = []) => all(lang, [...but, "view"]);

// What gives an account each kind's need, by the pages' own posts (a saved view as its page stores it).
const VIEW = "/buyers/pwgsc-tpsgc/analytics?source=awards&years=5";
const MEET: Record<string, (r: Reader) => Promise<unknown>> = {
  tenders: (r) => send(r, "/account/searches", { url: "/tenders?segment=82" }),
  radar: (r) => send(r, "/account/searches", { url: "/expiring/12m?buyer=pwgsc-tpsgc" }),
  records: (r) => send(r, "/account/searches", { url: `/organizations/${A1}` }),
  view: (r) => ACCOUNTS.prepare(
    "INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at) VALUES (?, ?, 'buyer', ?, 'Fleet', 'en', 'off', ?)",
  ).bind(crypto.randomUUID().replace(/-/g, ""), r.id, VIEW, new Date().toISOString()).run(),
  briefing: (r) => send(r, "/account/briefings", { kind: "segment", subject: "81" }),
  org: (r) => send(r, "/account/organization", { org: A1 }),
  api: (r) => send(r, "/account/keys", { name: "Reports" }),
};

// Tables taken off the database for the length of fn, then made again from accounts_schema.sql with their rows put
// back: the database before the operator applied that part of the schema.
async function without<T>(tables: readonly string[], fn: () => Promise<T>): Promise<T> {
  const kept = new Map<string, Record<string, unknown>[]>();
  for (const table of tables) kept.set(table, (await ACCOUNTS.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>()).results ?? []);
  for (const table of tables) await ACCOUNTS.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  try {
    return await fn();
  } finally {
    const own = new RegExp(`\\b(?:TABLE IF NOT EXISTS|ON) (?:${tables.join("|")})\\b`);
    await ACCOUNTS.batch(splitSql(accountsSchema).filter((s) => own.test(s)).map((s) => ACCOUNTS.prepare(s)));
    for (const table of [...tables].reverse()) {
      for (const row of kept.get(table) ?? []) {
        const cols = Object.keys(row);
        await ACCOUNTS.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
          .bind(...cols.map((c) => row[c])).run();
      }
    }
  }
}

// =====================================================================================

describe("an Ultra account holding nothing", () => {
  it("sees every line with its link inside Add a Tile and under the starting layout's tiles, in both languages", async () => {
    const r = await reader("aid-none");
    for (const lang of ["en", "fr"] as const) {
      const html = await text(await open(r, `/account/dashboard${lang === "fr" ? "?lang=fr" : ""}`));
      const main = mainOf(html);
      const more = moreOf(html);
      expect(more, lang).not.toBeNull();
      expect(more!.title).toBe(TITLE[lang]);
      expect(more!.lines).toEqual(inAdd(lang));
      // Add a Tile's Analytics group says what the analytics line says, with its link.
      expect(mainOf(html)).toContain(`<p class="dash-adder-part" id="dash-add-analytics">${lang === "fr" ? "Analyses" : "Analytics"}</p>`);
      expect(mainOf(html)).toMatch(/<p class="muted small">[^<]*<a href="\/analytics">(Analytics|Analyses)<\/a>\.<\/p>/);
      const panel = panelOf(html);
      expect(panel!.title).toBe(TITLE[lang]);
      expect(panel!.lines).toEqual(all(lang));
      // After the starting layout's tiles, never above them.
      expect(panel!.at).toBeGreaterThan(main.lastIndexOf('<section class="panel dash-tile'));
      // The lists' links are plain links: Add a Tile stays the page's one filled button.
      expect(main.match(/btn-primary/g)).toHaveLength(1);
      expect(html).not.toContain(EM_DASH);
      expect(html).not.toContain(EN_DASH);
      expect(misfits(html)).toEqual([]);
    }
  });

  it("follows every link to a page that answers for the account", async () => {
    const r = await reader("aid-links");
    // The starting layout's list, which holds every line.
    const more = panelOf(await text(await open(r)));
    const hrefs = [...(more?.lines ?? []).join("").matchAll(/<a href="([^"]+)">/g)].map((m) => m[1]);
    expect(hrefs).toEqual(LINES.map((l) => l.href));
    for (const href of hrefs) {
      for (const lang of ["en", "fr"] as const) {
        const res = await open(r, lang === "fr" ? `${href}${href.includes("?") ? "&" : "?"}lang=fr` : href, off({ ASSETS: WINDOWS }));
        expect(res.status, `${href} ${lang}`).toBe(200);
        await res.body?.cancel();
      }
    }
  });

  it("finds the same lines at the old edit address, which is the same page", async () => {
    const r = await reader("aid-edit");
    for (const lang of ["en", "fr"] as const) {
      const html = await text(await open(r, `/account/dashboard?edit=1${lang === "fr" ? "&lang=fr" : ""}`));
      expect(moreOf(html)?.lines, lang).toEqual(inAdd(lang));
      expect(mainOf(html).match(/btn-primary/g)).toHaveLength(1);
      expect(misfits(html)).toEqual([]);
    }
  });
});

describe("each line", () => {
  // One account a kind: the line goes once the account holds what it needs, and the others stay.
  for (const l of LINES) {
    it(`goes once the account holds what ${l.name} needs`, async () => {
      const r = await reader(`aid-${l.name}`);
      await MEET[l.name](r);
      for (const lang of ["en", "fr"] as const) {
        const html = await text(await open(r, `/account/dashboard${lang === "fr" ? "?lang=fr" : ""}`));
        expect(moreOf(html)?.lines, lang).toEqual(inAdd(lang, [l.name]));
        expect(panelOf(html)?.lines, lang).toEqual(all(lang, [l.name]));
      }
    });
  }

  it("of the analytics views goes with a view or an analytics table on the dashboard, added from the view's own page", async () => {
    const r = await reader("aid-view-tile");
    const res = await send(r, "/account/dashboard/panels", { kind: "view", ref: VIEW });
    expect(res.headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#tile-[0-9a-f]{32}$/);
    expect(moreOf(await text(await open(r)))?.lines).toEqual(inAdd("en"));
    // The list's own rule, the starting layout's panel being gone once a tile is added: a view's or a table's tile on the
    // dashboard takes the analytics line away.
    const none = { searches: [], briefings: [], claim: null, watches: [], keys: [], views: [], panels: [], absent: {} } as unknown as Holdings;
    expect(moreKinds(none, "ultra").map((l) => l.kinds[0])).toContain("view");
    for (const kind of ["view", "analytic"] as const) expect(moreKinds(none, "ultra", [{ kind }]).map((l) => l.kinds[0]), kind).not.toContain("view");
  });

  it("of the API stays while every key is revoked", async () => {
    const r = await reader("aid-revoked");
    await MEET.api(r);
    const key = (await ACCOUNTS.prepare("SELECT id FROM api_keys WHERE user_id = ?").bind(r.id).first<{ id: string }>())!.id;
    expect(moreOf(await text(await open(r)))?.lines).toEqual(inAdd("en", ["api"]));
    await send(r, `/account/keys/${key}/revoke`);
    expect(moreOf(await text(await open(r)))?.lines).toEqual(inAdd("en"));
  });

  it("of the briefings and of the organization shows only while its table is on the database", async () => {
    const r = await reader("aid-tables");
    await without(["briefings"], async () => {
      expect(moreOf(await text(await open(r)))?.lines).toEqual(inAdd("en", ["briefing"]));
    });
    await without(["org_claims"], async () => {
      expect(moreOf(await text(await open(r)))?.lines).toEqual(inAdd("en", ["org"]));
    });
    expect(moreOf(await text(await open(r)))?.lines).toEqual(inAdd("en"));
  });
});

describe("an account holding everything", () => {
  it("sees no list, in either language", async () => {
    const r = await reader("aid-all");
    for (const name of Object.keys(MEET)) await MEET[name](r);
    for (const path of ["/account/dashboard", "/account/dashboard?lang=fr"]) {
      const html = await text(await open(r, path));
      expect(moreOf(html), path).toBeNull();
      expect(panelOf(html), path).toBeNull();
      expect(html, path).not.toContain(TITLE.en);
      expect(html, path).not.toContain(TITLE.fr);
    }
  });
});

describe("where the list shows", () => {
  it("on an emptied dashboard, inside Add a Tile, which is open", async () => {
    const r = await reader("aid-emptied");
    // The first removal writes the starting layout (the watches, the 3-month list) and removes the second; then the first.
    await send(r, "/account/dashboard/tiles/s1/delete");
    const left = (await ACCOUNTS.prepare("SELECT id FROM dashboard_tiles WHERE user_id = ?").bind(r.id).all<{ id: string }>()).results ?? [];
    expect(left).toHaveLength(1);
    await send(r, `/account/dashboard/tiles/${left[0].id}/delete`);
    for (const lang of ["en", "fr"] as const) {
      const html = await text(await open(r, `/account/dashboard${lang === "fr" ? "?lang=fr" : ""}`));
      const main = mainOf(html);
      expect(main).not.toContain('<section class="panel dash-tile');
      expect(main).toContain('<details class="dash-adder" id="dash-add" open="">');
      expect(moreOf(html)?.lines, lang).toEqual(inAdd(lang));
      expect(panelOf(html), lang).toBeNull();
    }
  });

  it("on a dashboard the reader arranged, inside Add a Tile only, and not while the dashboard is full or nothing can be kept", async () => {
    const r = await reader("aid-settled");
    // A change writes the layout: the dashboard is the reader's own from then on.
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" });
    for (const path of ["/account/dashboard", "/account/dashboard?lang=fr"]) {
      const html = await text(await open(r, path));
      expect(moreOf(html)?.lines, path).toEqual(inAdd(path.includes("fr") ? "fr" : "en"));
      expect(panelOf(html), path).toBeNull();
    }
    // The plan's figure of tiles (24): nothing more can be added, so nothing is listed; one removed, the list is back.
    const at = new Date().toISOString();
    const board = (await ACCOUNTS.prepare("SELECT id FROM dashboards WHERE user_id = ?").bind(r.id).first<{ id: string }>())!.id;
    const fill = ["radar:12m", ...Array.from({ length: 20 }, (_, i) => `tenders:${String(i).padStart(32, "a")}`)];
    await ACCOUNTS.batch(fill.map((p, i) => ACCOUNTS.prepare(
      "INSERT INTO dashboard_tiles (id, dashboard_id, user_id, kind, ref, opts, x, y, w, h, created_at) VALUES (?, ?, ?, ?, ?, '', 0, ?, 12, 9, ?)",
    ).bind(crypto.randomUUID().replace(/-/g, ""), board, r.id, p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1), 100 + 10 * i, at)));
    const rows = (await ACCOUNTS.prepare("SELECT id FROM dashboard_tiles WHERE user_id = ? ORDER BY y").bind(r.id).all<{ id: string }>()).results ?? [];
    expect(rows).toHaveLength(24);
    const full = await text(await open(r));
    expect(full).toContain("The dashboard holds its 24 tiles.");
    expect(moreOf(full)).toBeNull();
    await send(r, `/account/dashboard/tiles/${rows[23].id}/delete`);
    expect(moreOf(await text(await open(r)))?.lines).toEqual(inAdd("en"));
    // Without the grid's tables a tile still goes into the panels' table, so the list shows; without that too, none.
    const fresh = await reader("aid-unsaved");
    await without(["dashboard_tiles", "dashboards"], async () => {
      expect(moreOf(await text(await open(fresh)))?.lines).toEqual(inAdd("en"));
    });
    await without(["dashboard_tiles", "dashboards", "dashboard_panels"], async () => {
      expect(moreOf(await text(await open(fresh)))).toBeNull();
      expect(panelOf(await text(await open(fresh)))).toBeNull();
    });
  });
});

// The statements a page view prepares on every database binding and the static files it fetches, the view
// read once before so the session and the parsed files are as a reader's second view finds them.
function watched(): { e: Record<string, unknown>; statements: string[]; files: string[] } {
  const base = off() as Record<string, unknown>;
  const statements: string[] = [];
  const files: string[] = [];
  const e: Record<string, unknown> = { ...base };
  for (const [name, v] of Object.entries(base)) {
    if (!v || typeof v !== "object" || typeof (v as D1Database).prepare !== "function" || typeof (v as D1Database).batch !== "function") continue;
    e[name] = new Proxy(v, {
      get(target, prop) {
        if (prop === "prepare") return (sql: string) => (statements.push(`${name} ${sql}`), (target as D1Database).prepare(sql));
        const x = Reflect.get(target, prop);
        return typeof x === "function" ? x.bind(target) : x;
      },
    });
  }
  const assets = base.ASSETS as Fetcher;
  e.ASSETS = { fetch: (input: RequestInfo | URL, init?: RequestInit) => (files.push(String(input instanceof Request ? input.url : input)), assets.fetch(input as never, init)) };
  return { e, statements, files };
}

// Measured on the page before the list was added (the starting layout and an emptied dashboard), then with the
// grid's two reads of the account's dashboard and its tiles (one batch, two statements) on every view.
const BEFORE = {
  starter: { statements: 12 + 2, files: 5 },
  emptied: { statements: 9 + 2, files: 5 },
};

describe("a page view", () => {
  it("prepares no statement and fetches no file more than the page did before the list", async () => {
    const r = await reader("aid-count");
    const count = async (path: string) => {
      await open(r, path);
      const w = watched();
      const html = await text(await open(r, path, w.e));
      return { statements: w.statements.length, files: w.files.length, html };
    };
    const starter = await count("/account/dashboard");
    await send(r, "/account/dashboard/tiles/s1/delete");
    const left = (await ACCOUNTS.prepare("SELECT id FROM dashboard_tiles WHERE user_id = ?").bind(r.id).all<{ id: string }>()).results ?? [];
    await send(r, `/account/dashboard/tiles/${left[0].id}/delete`);
    const emptied = await count("/account/dashboard");
    expect({ statements: starter.statements, files: starter.files }).toEqual(BEFORE.starter);
    expect({ statements: emptied.statements, files: emptied.files }).toEqual(BEFORE.emptied);
    // And each drew the list.
    for (const v of [starter, emptied]) expect(moreOf(v.html)?.lines).toEqual(inAdd("en"));
  });
});
