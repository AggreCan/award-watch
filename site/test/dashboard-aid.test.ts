// More Kinds of Panel (src/account/dashboard.tsx; docs/accounts.md, Dashboard):
// the kinds of panel an Ultra account cannot add yet, each with the one step
// that gives it what the panel shows and a link to the page where that is
// done. Seen on the starting layout and the emptied dashboard without the edit
// mode, under Add a Panel in edit mode, and not on a dashboard the reader has
// arranged outside it; each line goes once the account holds what its kind
// needs, and the panel goes once none is left; the briefings' and the claims'
// lines only while their tables are on the database; nothing read for it (the
// statements and the static files of a page view counted against the figures
// measured before it was added); every link answers for the account.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ACCOUNTS, PRO_SALE, csrf, decode, get, grantUltra, nbsp, newEmail, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { applySql, splitSql } from "./setup";
import { misfits } from "./table-fit";
import accountsSchema from "../accounts_schema.sql?raw";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const DAY = "2026-10-31";
const A1 = "org-a000000001";

// The records database empty but ready at the data date, so the starting layout's panels read.
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

// The panel, its heading and its lines, from a page's main element; null when it is not drawn.
const MORE_RE = /<section class="panel panel-form dash-more"><div class="panel-head"><h2>([^<]*)<\/h2><\/div><ul class="muted">([\s\S]*?)<\/ul><\/section>/;
function moreOf(html: string): { title: string; lines: string[]; at: number } | null {
  const main = mainOf(html);
  const m = MORE_RE.exec(main);
  if (!m) return main.includes("dash-more") ? { title: "(malformed)", lines: [], at: -1 } : null;
  return { title: m[1], lines: [...m[2].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((x) => x[1]), at: m.index };
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
    ["A chart from an analytics view: open a view from ", "Analytics", " and choose Add to dashboard."],
    ["Un graphique d'une vue d'analyse : ouvrez une vue depuis ", "Analyses", " et choisissez Ajouter au tableau de bord."]),
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
const TITLE = { en: "More Kinds of Panel", fr: "Autres genres de panneaux" };
const all = (lang: "en" | "fr", but: readonly string[] = []) => LINES.filter((l) => !but.includes(l.name)).map((l) => l[lang]);

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

// A table taken off the database for the length of fn, then made again from accounts_schema.sql with its rows put
// back: the database before the operator applied that part of the schema.
async function without<T>(table: string, fn: () => Promise<T>): Promise<T> {
  const kept = (await ACCOUNTS.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>()).results ?? [];
  await ACCOUNTS.prepare(`DROP TABLE IF EXISTS ${table}`).run();
  try {
    return await fn();
  } finally {
    const own = new RegExp(`\\b(?:TABLE IF NOT EXISTS|ON) ${table}\\b`);
    await ACCOUNTS.batch(splitSql(accountsSchema).filter((s) => own.test(s)).map((s) => ACCOUNTS.prepare(s)));
    for (const row of kept) {
      const cols = Object.keys(row);
      await ACCOUNTS.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`)
        .bind(...cols.map((c) => row[c])).run();
    }
  }
}

// =====================================================================================

describe("an Ultra account holding nothing", () => {
  it("sees every line with its link on the starting layout, in both languages, without the edit mode", async () => {
    const r = await reader("aid-none");
    for (const lang of ["en", "fr"] as const) {
      const html = await text(await open(r, `/account/dashboard${lang === "fr" ? "?lang=fr" : ""}`));
      const main = mainOf(html);
      const more = moreOf(html);
      expect(more, lang).not.toBeNull();
      expect(more!.title).toBe(TITLE[lang]);
      expect(more!.lines).toEqual(all(lang));
      // After the starting layout's panels, never above them; no Add a Panel outside the edit mode.
      expect(more!.at).toBeGreaterThan(main.lastIndexOf('<section class="panel dash-panel'));
      expect(main).not.toContain('id="dash-add"');
      // The list's links are plain links: the view keeps no filled button.
      expect(main).not.toContain("btn-primary");
      expect(html).not.toContain(EM_DASH);
      expect(html).not.toContain(EN_DASH);
      expect(misfits(html)).toEqual([]);
    }
  });

  it("follows every link to a page that answers for the account", async () => {
    const r = await reader("aid-links");
    const more = moreOf(await text(await open(r)));
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

  it("finds the same lines under Add a Panel in edit mode", async () => {
    const r = await reader("aid-edit");
    for (const lang of ["en", "fr"] as const) {
      const html = await text(await open(r, `/account/dashboard?edit=1${lang === "fr" ? "&lang=fr" : ""}`));
      const main = mainOf(html);
      const more = moreOf(html);
      expect(more?.lines, lang).toEqual(all(lang));
      expect(more!.at).toBeGreaterThan(main.indexOf('id="dash-add"'));
      // Add a Panel's Add is still the page's one filled button.
      expect(main.match(/btn-primary/g)).toHaveLength(1);
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
        const q = lang === "fr" ? "?lang=fr" : "";
        expect(moreOf(await text(await open(r, `/account/dashboard${q}`)))?.lines, lang).toEqual(all(lang, [l.name]));
        expect(moreOf(await text(await open(r, `/account/dashboard?edit=1${q ? "&lang=fr" : ""}`)))?.lines, lang).toEqual(all(lang, [l.name]));
      }
    });
  }

  it("of the analytics views goes with a view on the dashboard, added from the view's own page", async () => {
    const r = await reader("aid-view-panel");
    const res = await send(r, "/account/dashboard/panels", { kind: "view", ref: VIEW });
    expect(res.headers.get("location")).toMatch(/^\/account\/dashboard\?m=added#panel-[0-9a-f]{32}$/);
    expect(moreOf(await text(await open(r, "/account/dashboard?edit=1")))?.lines).toEqual(all("en", ["view"]));
  });

  it("of the API stays while every key is revoked", async () => {
    const r = await reader("aid-revoked");
    await MEET.api(r);
    const key = (await ACCOUNTS.prepare("SELECT id FROM api_keys WHERE user_id = ?").bind(r.id).first<{ id: string }>())!.id;
    expect(moreOf(await text(await open(r)))?.lines).toEqual(all("en", ["api"]));
    await send(r, `/account/keys/${key}/revoke`);
    expect(moreOf(await text(await open(r)))?.lines).toEqual(all("en"));
  });

  it("of the briefings and of the organization shows only while its table is on the database", async () => {
    const r = await reader("aid-tables");
    await without("briefings", async () => {
      expect(moreOf(await text(await open(r)))?.lines).toEqual(all("en", ["briefing"]));
    });
    await without("org_claims", async () => {
      expect(moreOf(await text(await open(r)))?.lines).toEqual(all("en", ["org"]));
    });
    expect(moreOf(await text(await open(r)))?.lines).toEqual(all("en"));
  });
});

describe("an account holding everything", () => {
  it("sees no list, on the starting layout or in edit mode, in either language", async () => {
    const r = await reader("aid-all");
    for (const name of Object.keys(MEET)) await MEET[name](r);
    for (const path of ["/account/dashboard", "/account/dashboard?edit=1", "/account/dashboard?lang=fr", "/account/dashboard?edit=1&lang=fr"]) {
      const html = await text(await open(r, path));
      expect(moreOf(html), path).toBeNull();
      expect(html, path).not.toContain(TITLE.en);
      expect(html, path).not.toContain(TITLE.fr);
    }
  });
});

describe("where the list shows", () => {
  it("on an emptied dashboard, under Add a Panel, without the edit mode", async () => {
    const r = await reader("aid-emptied");
    // The first removal writes the starting layout (the watches, the 3-month list) and removes the second; then the first.
    await send(r, "/account/dashboard/panels/s1/delete");
    const left = (await ACCOUNTS.prepare("SELECT id FROM dashboard_panels WHERE user_id = ? AND kind <> 'layout'").bind(r.id).all<{ id: string }>()).results ?? [];
    expect(left).toHaveLength(1);
    await send(r, `/account/dashboard/panels/${left[0].id}/delete`);
    for (const lang of ["en", "fr"] as const) {
      const html = await text(await open(r, `/account/dashboard${lang === "fr" ? "?lang=fr" : ""}`));
      const main = mainOf(html);
      expect(main).not.toContain('<section class="panel dash-panel');
      expect(main).toContain('id="dash-add"');
      const more = moreOf(html);
      expect(more?.lines, lang).toEqual(all(lang));
      expect(more!.at).toBeGreaterThan(main.indexOf('id="dash-add"'));
    }
  });

  it("on a dashboard the reader arranged, in edit mode only, and not while the dashboard is full or cannot be saved", async () => {
    const r = await reader("aid-settled");
    // A change writes the layout: the dashboard is the reader's own from then on.
    await send(r, "/account/dashboard/panels", { kind: "radar", ref: "6m" });
    expect(moreOf(await text(await open(r)))).toBeNull();
    expect(moreOf(await text(await open(r, "/account/dashboard?lang=fr")))).toBeNull();
    expect(moreOf(await text(await open(r, "/account/dashboard?edit=1")))?.lines).toEqual(all("en"));
    expect(moreOf(await text(await open(r, "/account/dashboard?edit=1&lang=fr")))?.lines).toEqual(all("fr"));
    // Twelve panels: nothing more can be added, so nothing is listed; one removed, the list is back.
    const at = new Date().toISOString();
    const fill = ["radar:12m", ...Array.from({ length: 8 }, (_, i) => `tenders:${String(i).padStart(32, "a")}`)];
    await ACCOUNTS.batch(fill.map((p, i) => ACCOUNTS.prepare(
      "INSERT INTO dashboard_panels (id, user_id, kind, ref, pos, wide, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)",
    ).bind(crypto.randomUUID().replace(/-/g, ""), r.id, p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1), 10 + i, at)));
    const rows = (await ACCOUNTS.prepare("SELECT id FROM dashboard_panels WHERE user_id = ? AND kind <> 'layout' ORDER BY pos").bind(r.id).all<{ id: string }>()).results ?? [];
    expect(rows).toHaveLength(12);
    const full = await text(await open(r, "/account/dashboard?edit=1"));
    expect(full).toContain("The dashboard holds its 12 panels.");
    expect(moreOf(full)).toBeNull();
    await send(r, `/account/dashboard/panels/${rows[11].id}/delete`, { from: "edit" });
    expect(moreOf(await text(await open(r, "/account/dashboard?edit=1")))?.lines).toEqual(all("en"));
    // Without the dashboard's table no panel can be added: no list on the starting layout or in edit mode.
    const fresh = await reader("aid-unsaved");
    await without("dashboard_panels", async () => {
      expect(moreOf(await text(await open(fresh)))).toBeNull();
      expect(moreOf(await text(await open(fresh, "/account/dashboard?edit=1")))).toBeNull();
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

// Measured on the page before the list was added (the starting layout, its edit mode, an emptied dashboard).
const BEFORE = {
  starter: { statements: 12, files: 5 },
  edit: { statements: 12, files: 5 },
  emptied: { statements: 9, files: 5 },
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
    const edit = await count("/account/dashboard?edit=1");
    await send(r, "/account/dashboard/panels/s1/delete");
    const left = (await ACCOUNTS.prepare("SELECT id FROM dashboard_panels WHERE user_id = ? AND kind <> 'layout'").bind(r.id).all<{ id: string }>()).results ?? [];
    await send(r, `/account/dashboard/panels/${left[0].id}/delete`);
    const emptied = await count("/account/dashboard");
    expect({ statements: starter.statements, files: starter.files }).toEqual(BEFORE.starter);
    expect({ statements: edit.statements, files: edit.files }).toEqual(BEFORE.edit);
    expect({ statements: emptied.statements, files: emptied.files }).toEqual(BEFORE.emptied);
    // And each of the three drew the list.
    for (const v of [starter, edit, emptied]) expect(moreOf(v.html)?.lines).toEqual(all("en"));
  });
});
