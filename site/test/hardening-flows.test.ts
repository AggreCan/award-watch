// The second hardening pass, on the first week of a paid account (W1 to
// W12) and on what each plan's lines promise (F1 to F9), as the operator
// ruled on them: each finding built has its regression test here, written
// to fail on the code as it stood. Every expected line is written out here,
// never read back from the code under test.
import { describe, expect, it } from "vitest";
import calendarJs from "../public/calendar.js?raw";
import tendersJs from "../public/tenders.js?raw";
import wranglerConfig from "../wrangler.jsonc?raw";
import * as dashboard from "../src/account/dashboard";
import { t } from "../src/i18n";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { PLAN_LINE_MAX, PLAN_ROWS, planLine } from "../src/pro";
import {
  ACCOUNTS, PRO_SALE, csrf, decode, get, grantPro, grantUltra, lastMail, nbsp, newEmail, nextIp, onEnv, post, requestCode, sessionCookie, signIn,
  ultraEnv, useAccountsDb, userId,
} from "./accounts-helpers";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const ORG = "org-a000000001";
const SEGMENT = "82";

const norm = (s: string) => nbsp(decode(s)).replace(/’/g, "'");
const html = async (res: Response) => norm(await res.text());
const page = async (path: string, cookie?: string, env?: object) => html(await get(path, { cookie, env }));
const mainOf = (s: string) => s.slice(s.indexOf("<main"), s.indexOf("</main>"));

// Ultra off sale (Pro's variables alone) and on sale; the switch on in both.
const offSale = (extra: Record<string, unknown> = {}) => onEnv({ ...PRO_SALE, ...extra });

type Reader = { email: string; id: string; cookie: string; csrf: string };

async function reader(tag: string, plan: "free" | "pro" | "ultra" = "free"): Promise<Reader> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  if (plan === "pro") await grantPro(email);
  if (plan === "ultra") await grantUltra(email);
  return { email, id: await userId(email), cookie, csrf: await csrf(cookie) };
}

const send = (r: Reader, path: string, fields: Record<string, string> = {}, env: object = offSale(), headers: Record<string, string> = {}) =>
  post(path, { csrf: r.csrf, ...fields }, { cookie: r.cookie, env, headers });

// Rows stored straight into the tables, so a test starts at the figure it means.
async function holdSearches(id: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await ACCOUNTS.prepare("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'segment', ?, ?, 'en', ?, 'off')")
      .bind(crypto.randomUUID().replace(/-/g, ""), id, `/segments/${String(10 + i)}`, `Segment ${10 + i}`, new Date().toISOString()).run();
  }
}
async function holdBriefings(id: string, n: number, deliver = "off"): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const bid = crypto.randomUUID().replace(/-/g, "");
    ids.push(bid);
    await ACCOUNTS.prepare(
      "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'segment', ?, '', ?, 'en', ?, ?)",
    ).bind(bid, id, i === 0 ? SEGMENT : String(40 + i), `Segment ${i}`, new Date().toISOString(), deliver).run();
  }
  return ids;
}
async function holdWatches(id: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await ACCOUNTS.prepare(
      "INSERT INTO watches (id, user_id, kind, target, segment, label, events, created_at) VALUES (?, ?, 'organization', ?, '', ?, 'award', ?)",
    ).bind(crypto.randomUUID().replace(/-/g, ""), id, `org-b${String(i).padStart(9, "0")}`, `Organization ${i}`, new Date().toISOString()).run();
  }
}

// =========================================================================================
// W1: a session is extended by any page a signed-in reader opens
// =========================================================================================

const sessionIdOf = (cookie: string) => /__Host-aw_session=([0-9a-f]{32})/.exec(cookie)![1];
const sessionSet = (res: Response) => res.headers.getSetCookie().filter((c) => c.startsWith("__Host-aw_session="));

// Last used two hours ago, a day left: the next page that reads it is due to extend it.
async function staleSession(cookie: string): Promise<void> {
  await ACCOUNTS.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
    .bind(new Date(Date.now() - 2 * 3_600_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString(), sessionIdOf(cookie)).run();
}
async function daysLeft(cookie: string): Promise<number> {
  const row = await ACCOUNTS.prepare("SELECT expires_at FROM sessions WHERE id = ?").bind(sessionIdOf(cookie)).first<{ expires_at: string }>();
  return (Date.parse(row!.expires_at) - Date.now()) / 86_400_000;
}

describe("W1: a session extended by the pages a signed-in reader opens", () => {
  it("is extended from a public list, the app home and the dashboard while Ultra is off sale, at most once an hour, the answer private", async () => {
    const r = await reader("w1-pages", "ultra");
    const env = offSale();
    for (const path of ["/tenders", "/", "/account/dashboard"]) {
      await staleSession(r.cookie);
      // "/" through the app itself, where a signed-in reader gets the app home.
      const res = path === "/"
        ? await app.request("/", { headers: { cookie: r.cookie, "cf-connecting-ip": nextIp(), "sec-fetch-mode": "navigate" } }, env as never)
        : await get(path, { cookie: r.cookie, env });
      expect(res.status, path).toBe(200);
      const set = sessionSet(res);
      expect(set, path).toHaveLength(1);
      expect(set[0], path).toContain(`${r.cookie};`);
      expect(set[0], path).toContain("Max-Age=2592000");
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
      expect(await daysLeft(r.cookie), path).toBeGreaterThan(29);
      // Within the hour no page writes it again.
      const again = await get("/methodology", { cookie: r.cookie, env });
      expect(sessionSet(again), path).toEqual([]);
    }
  });

  it("carries the cookie on a 304, whose tag is the page's own", async () => {
    const r = await reader("w1-304");
    const first = await get("/methodology", { cookie: r.cookie });
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\//);
    await staleSession(r.cookie);
    const res = await get("/methodology", { cookie: r.cookie, headers: { "if-none-match": etag } });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
    expect(sessionSet(res)).toHaveLength(1);
    expect(sessionSet(res)[0]).toContain("Max-Age=2592000");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("leaves the cookie a sign-in or a sign-out sets alone", async () => {
    const email = newEmail("w1-replace");
    const a = await signIn(email);
    await staleSession(a);
    const { code } = await requestCode(email);
    const res = await post("/account/check", { email, code, sent: "1" }, { cookie: a });
    expect(res.status).toBe(303);
    const set = sessionSet(res);
    expect(set).toHaveLength(1);
    expect(set[0]).not.toContain(a);
    const b = sessionCookie(res);
    await staleSession(b);
    const out = await post("/account/sign-out", { csrf: await csrf(b) }, { cookie: b });
    expect(sessionSet(out)).toHaveLength(1);
    expect(sessionSet(out)[0]).toMatch(/^__Host-aw_session=;.*Max-Age=0/);
  });
});

// =========================================================================================
// W2: the dashboard's and the saved views' own bucket, and a refusal a browser can read
// =========================================================================================

// A limiter that allows `limit` requests a key, and counts them.
function counting(limit: number) {
  const keys: string[] = [];
  const limiter = {
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: keys.filter((k) => k === key).length <= limit };
    },
  } as unknown as RateLimit;
  return { keys, limiter };
}
const spent = { limit: async () => ({ success: false }) } as unknown as RateLimit;
const NAV = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "sec-fetch-mode": "navigate" };

const panelRows = async (id: string) =>
  ((await ACCOUNTS.prepare("SELECT id, kind, ref FROM dashboard_panels WHERE user_id = ? ORDER BY pos, created_at, id").bind(id)
    .all<{ id: string; kind: string; ref: string }>()).results ?? []).filter((r) => (dashboard.PANEL_KINDS as readonly string[]).includes(r.kind));

describe("W2: the dashboard's and the saved views' posts, and a refusal a browser can read", () => {
  it("count in a bucket of their own, 60 a minute, in the next namespace", () => {
    const id = "a".repeat(32);
    for (const path of [
      "/account/dashboard/panels", `/account/dashboard/panels/${id}/move`, `/account/dashboard/panels/${id}/width`, `/account/dashboard/panels/${id}/delete`,
      "/account/views", `/account/views/${id}`, `/account/views/${id}/delete`,
    ]) expect(bucketFor("POST", path), path).toBe("edit");
    for (const path of ["/account/bug", "/account/billing/portal", "/corrections"]) expect(bucketFor("POST", path), path).toBe("form");
    expect(wranglerConfig).toContain('{ "name": "EDIT_LIMIT", "namespace_id": "2012", "simple": { "limit": 60, "period": 60 } }');
    const ids = [...wranglerConfig.matchAll(/"namespace_id": "(\d+)"/g)].map((m) => Number(m[1]));
    // 2012 was the next namespace when the bucket landed; PAID_DOWNLOAD_LIMIT took 2013 after it (recs-caps.test.ts).
    expect(ids.filter((id) => id === 2012)).toEqual([2012]);
    expect(Math.max(...ids.filter((id) => id !== 2013))).toBe(2012);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("let an Ultra account move a panel seven times in a minute, then send a form from the same address", async () => {
    const r = await reader("w2-moves", "ultra");
    const form = counting(5);
    const edit = counting(60);
    const ip = nextIp();
    const env = offSale({ FORM_LIMIT: form.limiter, EDIT_LIMIT: edit.limiter });
    const go = (path: string, fields: Record<string, string>) => post(path, { csrf: r.csrf, ...fields }, { cookie: r.cookie, env, ip });
    expect((await go("/account/dashboard/panels/s1/move", { dir: "up", from: "edit" })).status).toBe(303);
    const moved = (await panelRows(r.id))[0].id;
    for (let i = 0; i < 6; i++) {
      const res = await go(`/account/dashboard/panels/${moved}/move`, { dir: i % 2 ? "up" : "down", from: "edit" });
      expect(res.status, `move ${i + 2}`).toBe(303);
    }
    expect(edit.keys).toHaveLength(7);
    expect(form.keys).toEqual([]);
    expect((await go("/account/bug", { text: "After seven moves." })).status).toBe(200);
  });

  it("answer a refused browser's form post with a page in the site's shell, in its language, with its status, Retry-After and a way back", async () => {
    const r = await reader("w2-page", "pro");
    const refused = (headers: Record<string, string>, cookie = r.cookie) =>
      post("/account/bug", { csrf: r.csrf, text: "Refused." }, { cookie, env: onEnv({ FORM_LIMIT: spent }), headers });
    const res = await refused({ ...NAV, referer: "http://localhost/account/bug" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await html(res);
    expect(body).toContain('<header class="topbar">');
    expect(body).toContain("<h1>Too Many Requests</h1>");
    expect(body).toContain("Too many requests from this address. Wait a minute and try again.");
    expect(body).toContain('<a href="/account/bug">Back to the page</a>');
    expect(body).toContain('<meta name="robots" content="noindex"/>');
    // In French, from the reader's language.
    const fr = await html(await refused({ ...NAV, referer: "http://localhost/account/bug?lang=fr" }, `${r.cookie}; lang=fr`));
    expect(fr).toContain("<h1>Trop de requêtes</h1>");
    expect(fr).toContain("Trop de requêtes depuis cette adresse. Attendez une minute et réessayez.");
    expect(fr).toContain('<a href="/account/bug?lang=fr">Retour à la page</a>');
    for (const s of [body, fr]) {
      expect(s).not.toContain(EM_DASH);
      expect(s).not.toContain(EN_DASH);
    }
    // No referring page of the site's own: the account page.
    for (const referer of [undefined, "https://evil.example/account/bug", "http://localhost//evil.example/x", "http://localhost/account/sign-in?next=/x"]) {
      const other = await html(await refused(referer ? { ...NAV, referer } : NAV));
      expect(other, referer).toContain('<a href="/account">Back to the page</a>');
    }
    // A request that is not a browser's navigation keeps the text answer.
    const plain = await refused({});
    expect(plain.status).toBe(429);
    expect(plain.headers.get("content-type")).toContain("text/plain");
    expect(await plain.text()).toBe("Too many requests from this address. Wait a minute and try again.");
  });

  it("answer a refused page the same way, and a script's request with the text", async () => {
    const env = onEnv({ PAGE_LIMIT: spent });
    const res = await get("/tenders", { env, headers: { ...NAV, referer: "http://localhost/tenders?segment=82" } });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await html(res)).toContain('<a href="/tenders?segment=82">Back to the page</a>');
    const script = await app.request("/tenders", { headers: { "cf-connecting-ip": nextIp() } }, env as never);
    expect(script.status).toBe(429);
    expect(script.headers.get("content-type")).toContain("text/plain");
  });

  it("return a move, an add and a removal to the panel's own place on the page", async () => {
    const r = await reader("w2-anchor", "ultra");
    const move = await send(r, "/account/dashboard/panels/s1/move", { dir: "up", from: "edit" });
    const rows = await panelRows(r.id);
    expect(rows.map((x) => `${x.kind}:${x.ref}`)).toEqual(["radar:3m", "watches:"]);
    expect(move.headers.get("location")).toBe(`/account/dashboard?edit=1#panel-${rows[0].id}`);
    const width = await send(r, `/account/dashboard/panels/${rows[1].id}/width`, { wide: "0" });
    expect(width.headers.get("location")).toBe(`/account/dashboard#panel-${rows[1].id}`);
    const add = await send(r, "/account/dashboard/panels", { panel: "radar:6m", from: "edit" });
    const after = await panelRows(r.id);
    expect(after.map((x) => `${x.kind}:${x.ref}`)).toEqual(["radar:3m", "watches:", "radar:6m"]);
    expect(add.headers.get("location")).toBe(`/account/dashboard?edit=1&m=added#panel-${after[2].id}`);
    // Added already: the panel the account holds.
    expect((await send(r, "/account/dashboard/panels", { panel: "radar:6m", from: "edit" })).headers.get("location"))
      .toBe(`/account/dashboard?edit=1&m=exists#panel-${after[2].id}`);
    // A removal: the panel that took its place, or the one before the last.
    const middle = await send(r, `/account/dashboard/panels/${after[1].id}/delete`, { from: "edit" });
    expect(middle.headers.get("location")).toBe(`/account/dashboard?edit=1#panel-${after[2].id}`);
    const last = await send(r, `/account/dashboard/panels/${after[2].id}/delete`, { from: "edit" });
    expect(last.headers.get("location")).toBe(`/account/dashboard?edit=1#panel-${after[0].id}`);
    // The French page's address says so, before the place.
    const fr = await send(r, `/account/dashboard/panels/${after[0].id}/width`, { wide: "0", lang: "fr" });
    expect(fr.headers.get("location")).toBe(`/account/dashboard?lang=fr#panel-${after[0].id}`);
  });
});

// =========================================================================================
// W4: an emptied dashboard stays empty
// =========================================================================================

describe("W4: an emptied dashboard", () => {
  it("stays empty and offers Add a Panel, and its next panel comes alone", async () => {
    const r = await reader("w4-empty", "ultra");
    await send(r, "/account/dashboard/panels/s0/delete", { from: "edit" });
    const left = await panelRows(r.id);
    expect(left.map((x) => `${x.kind}:${x.ref}`)).toEqual(["radar:3m"]);
    const emptied = await send(r, `/account/dashboard/panels/${left[0].id}/delete`, { from: "edit" });
    expect(emptied.headers.get("location")).toBe("/account/dashboard?edit=1#dash-add");
    for (const path of ["/account/dashboard", "/account/dashboard?edit=1"]) {
      const main = mainOf(await page(path, r.cookie, offSale()));
      expect(main, path).not.toContain(t("en", "dash.starter"));
      expect(main, path).not.toContain("dash-panel");
      expect(main, path).toContain('id="dash-add"');
      expect(main, path).toContain(">Add a Panel</h2>");
      expect(main, path).toContain('<option value="radar:6m">');
    }
    expect((await send(r, "/account/dashboard/panels", { panel: "radar:6m" })).status).toBe(303);
    expect((await panelRows(r.id)).map((x) => `${x.kind}:${x.ref}`)).toEqual(["radar:6m"]);
    expect(mainOf(await page("/account/dashboard", r.cookie, offSale()))).not.toContain(t("en", "dash.starter"));
  });

  it("keeps its marker out of every count: the plan's figure, the panels shown and the rows a move reorders", async () => {
    const r = await reader("w4-marker", "ultra");
    await ACCOUNTS.prepare("INSERT INTO dashboard_panels (id, user_id, kind, ref, pos, wide, created_at) VALUES (?, ?, 'layout', '', -1, 1, ?)")
      .bind(crypto.randomUUID().replace(/-/g, ""), r.id, new Date().toISOString()).run();
    // A figure of 1: the marker does not take the one place.
    const res = await ACCOUNTS.prepare(dashboard.ADD_PANEL_SQL)
      .bind(crypto.randomUUID().replace(/-/g, ""), r.id, "radar", "6m", 1, new Date().toISOString(), 1, 2).run();
    expect(res.meta?.changes).toBe(1);
    expect((await ACCOUNTS.prepare("SELECT pos FROM dashboard_panels WHERE user_id = ? AND kind = 'radar'").bind(r.id).first<{ pos: number }>())?.pos).toBe(0);
    const main = mainOf(await page("/account/dashboard?edit=1", r.cookie, offSale()));
    expect(main).toContain("1 of 12 panels");
    expect(main.match(/class="panel dash-panel/g)).toHaveLength(1);
    expect(dashboard.LAYOUT_MARKER).toBe("layout");
    expect((dashboard.PANEL_KINDS as readonly string[]).includes(dashboard.LAYOUT_MARKER)).toBe(false);
  });
});

// =========================================================================================
// W5 with F1, and F3: one count of saved searches and briefings, and the cap lines
// =========================================================================================

describe("F1 and W5: one count of the saved searches and briefings", () => {
  it("reads 3 of 3 on a Free account's overview holding one search and two briefings, with no Save step left to offer", async () => {
    const r = await reader("f1-free");
    await holdSearches(r.id, 1);
    await holdBriefings(r.id, 2);
    const main = mainOf(await page("/account", r.cookie));
    expect(main).toContain('<a href="/account/searches">Saved searches and briefings</a><span class="num">3 of 3</span>');
    expect(main).not.toContain(t("en", "account.start_search"));
    const fr = mainOf(await page("/account?lang=fr", r.cookie));
    expect(fr).toContain('<a href="/account/searches">Recherches enregistrées et bulletins</a><span class="num">3 sur 3</span>');
  });

  it("reads 25 of 25 on a Pro account holding 20 searches and 5 briefings, on the overview, the searches page and Save this search", async () => {
    const r = await reader("f1-pro", "pro");
    await holdSearches(r.id, 20);
    await holdBriefings(r.id, 5);
    expect(mainOf(await page("/account", r.cookie))).toContain('<span class="num">25 of 25</span>');
    const searches = mainOf(await page("/account/searches", r.cookie));
    expect(searches).toContain("25 of 25");
    const LINE = "This account holds 25 of 25 saved searches and briefings, the most an account keeps.";
    expect(searches).toContain(`<p>${LINE}</p>`);
    for (const path of ["/tenders?segment=82", "/segments/82"]) {
      expect(await page(path, r.cookie), path).toContain(`<p class="muted small">${LINE} <a href="/account/searches">Manage your saved searches</a></p>`);
    }
    expect(await page("/tenders?segment=82&lang=fr", r.cookie)).toContain(
      "Recherches enregistrées et bulletins de ce compte : 25 sur 25, le maximum qu'un compte conserve. " +
      '<a href="/account/searches">Gérer vos recherches enregistrées</a>',
    );
    // The post is refused, and its notice says the same.
    const res = await send(r, "/account/searches", { url: "/tenders?segment=43" }, onEnv());
    expect(res.headers.get("location")).toBe("/account/searches?m=cap");
    expect(mainOf(await page("/account/searches?m=cap", r.cookie))).toContain(`<p class="account-notice" role="status">${LINE}</p>`);
  });

  it("names saved searches and briefings together in the plan rows and the Pro page's answers, each plan's own figure, in both languages", () => {
    const row = PLAN_ROWS.find((x) => x.free?.key === "plans.free_searches")!;
    expect(planLine("en", row.free!)).toBe("3 saved searches and briefings, on the site");
    expect(planLine("en", row.pro!)).toBe("25 saved searches and briefings, by email");
    expect(planLine("en", row.ultra)).toBe("100 saved searches and briefings, by email");
    expect(planLine("fr", row.free!)).toBe("3 recherches et bulletins, sur le site");
    expect(planLine("fr", row.ultra)).toBe("100 recherches et bulletins, par courriel");
    for (const lang of ["en", "fr"] as const) {
      for (const w of [row.free!, row.pro!, row.ultra]) expect(planLine(lang, w).length).toBeLessThanOrEqual(PLAN_LINE_MAX);
    }
    expect(t("en", "propage.a_alerts", { n: "25" })).toContain("Pro keeps up to 25 saved searches and briefings together.");
    expect(norm(t("fr", "propage.a_alerts", { n: "25" }))).toContain("Pro conserve jusqu'à 25 recherches et bulletins au total.");
    expect(t("en", "propage.ultra_text", { searches: "100", watches: "100", years: "10", day: "50,000", panels: "12" })).toContain("100 saved searches and briefings by email");
    expect(t("fr", "propage.ultra_text", { searches: "100", watches: "100", years: "10", day: "50 000", panels: "12" })).toContain("100 recherches et bulletins par courriel");
  });
});

describe("F3: a Pro account at its cap while Ultra is on sale", () => {
  it("is told what it holds, its plan's figure and Ultra's, on Save this search and the searches page", async () => {
    const r = await reader("f3-search", "pro");
    await holdSearches(r.id, 20);
    await holdBriefings(r.id, 5);
    const LINE = "This account holds 25 of 25 saved searches and briefings. Ultra holds up to 100.";
    expect(await page("/tenders?segment=82", r.cookie, ultraEnv())).toContain(
      `<p class="muted small">${LINE} <a href="/account/searches">Manage your saved searches</a></p>`,
    );
    expect(await page("/tenders?segment=82&lang=fr", r.cookie, ultraEnv())).toContain(
      "Recherches enregistrées et bulletins de ce compte : 25 sur 25. Ultra en conserve jusqu'à 100.",
    );
    const searches = mainOf(await page("/account/searches?m=cap", r.cookie, ultraEnv()));
    expect(searches).toContain(`<p class="account-notice" role="status">${LINE}</p>`);
    expect(searches).not.toContain("the most an account keeps");
  });

  it("is told what it follows, its plan's figure and Ultra's, on Follow and the watches page; Ultra off sale, the most an account keeps", async () => {
    const r = await reader("f3-watch", "pro");
    await holdWatches(r.id, 25);
    const on = await page(`/organizations/${ORG}`, r.cookie, ultraEnv());
    expect(on).toContain("This account follows 25 of 25 pages. Ultra follows up to 100.");
    expect(mainOf(await page("/account/watches?m=cap", r.cookie, ultraEnv())))
      .toContain('<p class="account-notice" role="status">This account follows 25 of 25 pages. Ultra follows up to 100.</p>');
    const off = await page(`/organizations/${ORG}`, r.cookie, offSale());
    expect(off).toContain("This account follows 25 of 25 pages, the most an account keeps.");
    expect(await page(`/organizations/${ORG}?lang=fr`, r.cookie, offSale())).toContain("Pages suivies par ce compte : 25 sur 25, le maximum qu'un compte conserve.");
  });
});

// =========================================================================================
// F2: an item saved with its email off says so where a plan with delivery sees it
// =========================================================================================

describe("F2: a saved search or briefing whose email is off, shown to a plan that sends it", () => {
  it("says so under Search saved on a list, with the control that turns it on and returns to the list", async () => {
    const r = await reader("f2-search", "pro");
    const LIST = "/tenders?segment=82";
    await send(r, "/account/searches", { url: LIST, next: LIST, lang: "en" }, onEnv());
    const id = (await ACCOUNTS.prepare("SELECT id FROM saved_searches WHERE user_id = ?").bind(r.id).first<{ id: string }>())!.id;
    const list = await page(LIST, r.cookie);
    expect(list).toContain(">Search saved</a>");
    expect(list).toContain('<span class="muted small" data-save="saved">Its email is off. ');
    expect(list).toContain(`<button type="submit" form="save-search" formaction="/account/searches/${id}" name="deliver" value="daily" class="btn-link">Email it daily</button>`);
    expect(list).toContain(`formaction="/account/searches/${id}" name="deliver" value="weekly" class="btn-link">Email it weekly</button>`);
    expect(await page(`${LIST}&lang=fr`, r.cookie)).toContain("Son envoi par courriel est désactivé. ");
    // The press: the delivery saved, and back to the list.
    const res = await send(r, `/account/searches/${id}`, { deliver: "daily", next: LIST, url: LIST, lang: "en" }, onEnv());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(LIST);
    expect((await ACCOUNTS.prepare("SELECT deliver FROM saved_searches WHERE id = ?").bind(id).first<{ deliver: string }>())?.deliver).toBe("daily");
    expect(await page(LIST, r.cookie)).not.toContain("Its email is off.");
    // Under a head (a segment page): the same line in a form of its own.
    await send(r, "/account/searches", { url: "/segments/82", next: "/segments/82", lang: "en" }, onEnv());
    const seg = (await ACCOUNTS.prepare("SELECT id FROM saved_searches WHERE user_id = ? AND params = '/segments/82'").bind(r.id).first<{ id: string }>())!.id;
    expect(await page("/segments/82", r.cookie)).toContain(
      `<form method="post" action="/account/searches/${seg}" class="save-mail"><input type="hidden" name="csrf" value="${r.csrf}"/>`,
    );
  });

  it("says nothing of email to a Free account, whose plan sends none", async () => {
    const r = await reader("f2-free");
    await send(r, "/account/searches", { url: "/tenders?segment=82", next: "/tenders?segment=82", lang: "en" }, onEnv());
    const list = await page("/tenders?segment=82", r.cookie);
    expect(list).toContain(">Search saved</a>");
    expect(list).not.toContain("Its email is off.");
  });

  it("says so under Briefing saved on its page, with the control that turns the weekly email on and returns to the page", async () => {
    const r = await reader("f2-brief", "pro");
    const [id] = await holdBriefings(r.id, 1);
    const seg = await page(`/segments/${SEGMENT}`, r.cookie);
    expect(seg).toContain(">Briefing saved</a>");
    expect(seg).toContain(
      `<form method="post" action="/account/briefings/${id}" class="briefing-mail"><input type="hidden" name="csrf" value="${r.csrf}"/>` +
      `<input type="hidden" name="deliver" value="weekly"/><input type="hidden" name="next" value="/segments/${SEGMENT}"/>` +
      '<span class="muted small">Its weekly email is off.</span> <button type="submit" class="btn-link">Turn it on</button></form>',
    );
    const res = await send(r, `/account/briefings/${id}`, { deliver: "weekly", next: `/segments/${SEGMENT}` }, onEnv());
    expect(res.headers.get("location")).toBe(`/segments/${SEGMENT}`);
    expect((await ACCOUNTS.prepare("SELECT deliver FROM briefings WHERE id = ?").bind(id).first<{ deliver: string }>())?.deliver).toBe("weekly");
    expect(await page(`/segments/${SEGMENT}`, r.cookie)).not.toContain("Its weekly email is off.");
    // A Free account's saved briefing: the Pro note, as before, and no such line.
    const free = await reader("f2-brief-free");
    await holdBriefings(free.id, 1);
    expect(await page(`/segments/${SEGMENT}`, free.cookie)).not.toContain("Its weekly email is off.");
  });

  it("says so on the searches page, for each search and briefing whose email is off", async () => {
    const r = await reader("f2-lists", "pro");
    await holdSearches(r.id, 1);
    await holdBriefings(r.id, 1);
    const main = mainOf(await page("/account/searches", r.cookie));
    expect(main).toContain('<p class="muted small">Its email is off.</p>');
    expect(main).toContain('<p class="muted small">Its weekly email is off.</p>');
  });
});

// =========================================================================================
// F6: Follow reads the account's own watch mail
// =========================================================================================

describe("F6: the Follow control on a Pro account whose watch mail is off", () => {
  it("says the events show on the watches page, not that they come by email", async () => {
    const r = await reader("f6", "pro");
    await ACCOUNTS.prepare("INSERT INTO watch_mail (user_id, mail, created_at) VALUES (?, 'off', ?)").bind(r.id, new Date().toISOString()).run();
    const off = await page(`/organizations/${ORG}`, r.cookie);
    expect(off).toContain("Its events show on your watches page.");
    expect(off).not.toContain("come by email");
    await ACCOUNTS.prepare("UPDATE watch_mail SET mail = 'on' WHERE user_id = ?").bind(r.id).run();
    expect(await page(`/organizations/${ORG}`, r.cookie)).toContain("Its events show on your watches page and come by email.");
  });
});

// =========================================================================================
// F9: the privacy page's Payments section while Ultra is on sale
// =========================================================================================

describe("F9: the privacy page's Payments section", () => {
  it("names Pro and Ultra while Ultra is on sale, and Pro alone before", async () => {
    const on = await page("/privacy", undefined, ultraEnv());
    expect(on).toContain("Pro and Ultra are paid for on Stripe's own pages");
    expect(on).toContain("Pro and Ultra are sold through Link");
    expect(await page("/privacy?lang=fr", undefined, ultraEnv())).toContain("Pro et Ultra se paient sur les pages de Stripe");
    const before = await page("/privacy", undefined, offSale());
    expect(before).toContain("Pro is paid for on Stripe's own pages");
    expect(before).not.toContain("Pro and Ultra are paid");
  });
});

// =========================================================================================
// W6: the language of the account's mail
// =========================================================================================

describe("W6: the language of the account's mail", () => {
  it("is shown on the overview with a control that switches it", async () => {
    const r = await reader("w6-show");
    const before = mainOf(await page("/account", r.cookie));
    expect(before).toContain("<dt>Email language</dt>");
    expect(before).toContain('<form method="post" action="/account/mail-language" class="account-inline">');
    expect(before).toContain('<input type="hidden" name="mail_lang" value="fr"/><span>English</span><button type="submit" class="btn-link">Switch to French</button>');
    const res = await send(r, "/account/mail-language", { mail_lang: "fr" }, onEnv());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account?m=mail_lang");
    expect((await ACCOUNTS.prepare("SELECT lang FROM users WHERE id = ?").bind(r.id).first<{ lang: string }>())?.lang).toBe("fr");
    const after = mainOf(await page("/account?m=mail_lang", r.cookie));
    expect(after).toContain('<p class="account-notice" role="status">The email language is saved.</p>');
    expect(after).toContain('<input type="hidden" name="mail_lang" value="en"/><span>French</span><button type="submit" class="btn-link">Switch to English</button>');
    const fr = mainOf(await page("/account?lang=fr", r.cookie));
    expect(fr).toContain("<dt>Langue des courriels</dt>");
    expect(fr).toContain("<span>Français</span><button type=\"submit\" class=\"btn-link\">Passer à l'anglais</button>");
    // Neither another value nor a post without the CSRF value changes it.
    expect((await send(r, "/account/mail-language", { mail_lang: "de" }, onEnv())).status).toBe(400);
    expect((await post("/account/mail-language", { csrf: "0".repeat(32), mail_lang: "en" }, { cookie: r.cookie })).status).toBe(403);
    expect((await ACCOUNTS.prepare("SELECT lang FROM users WHERE id = ?").bind(r.id).first<{ lang: string }>())?.lang).toBe("fr");
  });

  it("is set by the sign-in that makes the account, and kept by each sign-in after", async () => {
    const email = newEmail("w6-signin");
    const first = await requestCode(email);
    expect((await post("/account/check", { email, code: first.code, sent: "1", lang: "fr" })).status).toBe(303);
    const lang = async () => (await ACCOUNTS.prepare("SELECT lang FROM users WHERE email = ?").bind(email).first<{ lang: string }>())?.lang;
    expect(await lang()).toBe("fr");
    const second = await requestCode(email);
    expect((await post("/account/check", { email, code: second.code, sent: "1", lang: "en" })).status).toBe(303);
    expect(await lang()).toBe("fr");
  });
});

// =========================================================================================
// W8: the language toggle keeps the rest of the query
// =========================================================================================

const toggleOf = (s: string) => decode(/<a href="([^"]*)" class="lang-toggle"/.exec(s)?.[1] ?? "");

describe("W8: the language toggle", () => {
  it("keeps the emailed link's token, next and follow, and changes only lang", async () => {
    const token = `${"a".repeat(32)}.${"b".repeat(64)}`;
    const res = await get(`/account/check?token=${token}&next=%2Ftenders&follow=${encodeURIComponent(`organization:${ORG}`)}`);
    const href = toggleOf(await res.text());
    expect(href.startsWith("?")).toBe(true);
    const q = new URLSearchParams(href.slice(1));
    expect(q.get("token")).toBe(token);
    expect(q.get("next")).toBe("/tenders");
    expect(q.get("follow")).toBe(`organization:${ORG}`);
    expect(q.get("lang")).toBe("fr");
  });

  it("keeps a list's filters and the sign-in page's next, and turns French back to English", async () => {
    expect(toggleOf(await (await get("/tenders?segment=82&province=BC&lang=fr")).text())).toBe("?segment=82&province=BC&lang=en");
    expect(toggleOf(await (await get("/account/sign-in?next=%2Ftenders%3Fsegment%3D82")).text())).toBe("?next=%2Ftenders%3Fsegment%3D82&lang=fr");
    // With no query, as before.
    expect(toggleOf(await (await get("/methodology")).text())).toBe("?lang=fr");
  });

  it("follows the list's address as the tender list's script rewrites it", () => {
    expect(tendersJs).toContain('document.querySelector("a.lang-toggle")');
    expect(tendersJs).toContain('q.set("lang", want)');
  });
});

// =========================================================================================
// W9 (a): a form sent with an earlier sign-in's CSRF value
// =========================================================================================

describe("W9 (a): a form sent under an earlier sign-in", () => {
  it("gets a page in the site's shell with a line and a link to reload the page the form was on, 403 kept", async () => {
    const email = newEmail("w9");
    const a = await signIn(email);
    await grantPro(email);
    const csrfA = await csrf(a);
    // Signed in again in the same browser: A's tabs keep A's value.
    const { code } = await requestCode(email);
    const b = sessionCookie(await post("/account/check", { email, code, sent: "1" }, { cookie: a }));
    const res = await post("/account/bug", { csrf: csrfA, text: "Typed before." }, { cookie: b, headers: { ...NAV, referer: "http://localhost/account/bug" } });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await html(res);
    expect(body).toContain('<header class="topbar">');
    expect(mainOf(body)).toContain(
      '<p class="account-notice" role="status">This form was opened under an earlier sign-in, and nothing was sent. <a href="/account/bug">Reload the page</a></p>',
    );
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM bug_reports WHERE user_id = ?").bind(await userId(email)).first<{ n: number }>())?.n).toBe(0);
    const fr = await html(await post("/account/bug", { csrf: csrfA, text: "x", lang: "fr" }, { cookie: b, headers: { ...NAV, referer: "http://localhost/tenders?segment=82&lang=fr" } }));
    expect(fr).toContain("Ce formulaire a été ouvert lors d'une connexion antérieure, et rien n'a été envoyé. <a href=\"/tenders?segment=82&lang=fr\">Recharger la page</a>");
    // No page of the site's own to return to: the account page.
    expect(await html(await post("/account/bug", { csrf: csrfA, text: "x" }, { cookie: b, headers: { referer: "https://evil.example/" } })))
      .toContain('<a href="/account">Reload the page</a>');
  });
});

// =========================================================================================
// W10: a reloaded post creates nothing new
// =========================================================================================

describe("W10: a reloaded post", () => {
  it("makes no second live key of the same name, saying a key of that name exists", async () => {
    const r = await reader("w10-key", "pro");
    const live = async () => (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL").bind(r.id).first<{ n: number }>())?.n;
    const first = await send(r, "/account/keys", { name: "Nightly sync" }, onEnv());
    expect(first.status).toBe(200);
    const made = await html(first);
    expect(made).toMatch(/<pre class="cite-block account-key">aw_[0-9a-f]{8}_[0-9a-f]{64}<\/pre>/);
    const again = await send(r, "/account/keys", { name: "Nightly sync" }, onEnv());
    expect(await live()).toBe(1);
    expect(again.status).toBe(409);
    const body = await html(again);
    expect(body).toContain("<li>A key of that name already exists. No new key was made.</li>");
    expect(body).not.toContain("account-key\">aw_");
    // The same copy control the calendar address has.
    expect(made).toContain('<div class="copy-block" data-copy="Copy" data-copied="Copied"><pre class="cite-block account-key">');
    expect(made).toContain('<script src="/calendar.js" defer=""></script>');
    expect(calendarJs).toContain("div.copy-block");
    expect(await html(await send(r, "/account/keys?lang=fr", { name: "Nightly sync", lang: "fr" }, onEnv())))
      .toContain("<li>Une clé de ce nom existe déjà. Aucune nouvelle clé n'a été créée.</li>");
    // Revoked, the name is free again.
    const keyId = (await ACCOUNTS.prepare("SELECT id FROM api_keys WHERE user_id = ?").bind(r.id).first<{ id: string }>())!.id;
    await send(r, `/account/keys/${keyId}/revoke`, {}, onEnv());
    expect((await send(r, "/account/keys", { name: "Nightly sync" }, onEnv())).status).toBe(200);
    expect(await live()).toBe(1);
  });

  it("stores and sends an identical bug report from the same account once in ten minutes, and says it was sent", async () => {
    const r = await reader("w10-bug", "pro");
    const rows = async () => (await ACCOUNTS.prepare("SELECT id, created_at FROM bug_reports WHERE user_id = ? ORDER BY created_at").bind(r.id)
      .all<{ id: string; created_at: string }>()).results ?? [];
    const sent = async () => (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM audit WHERE user_id = ? AND event = 'bug_reported'").bind(r.id).first<{ n: number }>())?.n;
    const fields = { page: "/tenders?segment=82", text: "The list shows nothing.", expected: "Rows." };
    for (let i = 0; i < 2; i++) {
      const res = await send(r, "/account/bug", fields, onEnv());
      expect(res.status, `post ${i + 1}`).toBe(200);
      expect(await html(res)).toContain(`<h1>${t("en", "bugs.sent_title")}</h1>`);
    }
    expect(await rows()).toHaveLength(1);
    expect(await sent()).toBe(1);
    // Another report is its own.
    await send(r, "/account/bug", { ...fields, expected: "Some rows." }, onEnv());
    expect(await rows()).toHaveLength(2);
    // Ten minutes on, the same report is a new one.
    await ACCOUNTS.prepare("UPDATE bug_reports SET created_at = ? WHERE user_id = ?").bind(new Date(Date.now() - 11 * 60_000).toISOString(), r.id).run();
    await send(r, "/account/bug", fields, onEnv());
    expect(await rows()).toHaveLength(3);
    expect(await sent()).toBe(3);
  });
});

// =========================================================================================
// W11: the per-address figure beside the per-key one
// =========================================================================================

describe("W11: the keyed API's limits as the keys page and /me state them", () => {
  it("name the 60 requests a minute per address beside the 600 per key, in both languages", async () => {
    const r = await reader("w11", "pro");
    const made = await html(await send(r, "/account/keys", { name: "Script" }, onEnv()));
    const key = /(aw_[0-9a-f]{8}_[0-9a-f]{64})/.exec(made)![1];
    expect(await page("/account/keys", r.cookie)).toContain(
      "Requests are counted by UTC day. Each key may make 20,000 a day and 600 a minute, and each address 60 a minute.",
    );
    expect(await page("/account/keys?lang=fr", r.cookie)).toContain(
      "Les requêtes sont comptées par jour UTC. Chaque clé peut en faire 20 000 par jour et 600 par minute, et chaque adresse 60 par minute.",
    );
    const me = await (await app.request("/api/v1/me", { headers: { authorization: `Bearer ${key}`, "cf-connecting-ip": nextIp() } }, onEnv() as never)).json() as {
      limits: Record<string, number>;
    };
    expect(me.limits).toEqual({ per_minute: 600, per_day: 20_000, per_minute_per_address: 60 });
  });
});

// =========================================================================================
// W12: a pasted code with spaces
// =========================================================================================

describe("W12: the code field", () => {
  it("takes a pasted code with spaces around or inside it", async () => {
    for (const path of ["/account/check"]) {
      const body = await (await get(path)).text();
      const input = /<input name="code"[^>]*>/.exec(body)![0];
      const maxlength = /maxlength="(\d+)"/.exec(input)?.[1];
      if (maxlength) expect(Number(maxlength)).toBeGreaterThanOrEqual(20);
      const pattern = decode(/pattern="([^"]*)"/.exec(input)![1]);
      const re = new RegExp(`^(?:${pattern})$`, "v");
      for (const ok of ["123456", "123 456", " 123456 ", "1 2 3 4 5 6"]) expect(re.test(ok), ok).toBe(true);
      for (const no of ["12345", "1234567", "12a456", ""]) expect(re.test(no), no).toBe(false);
    }
    // And the server signs in with it.
    const email = newEmail("w12");
    const { code } = await requestCode(email);
    const res = await post("/account/check", { email, code: ` ${code.slice(0, 3)} ${code.slice(3)} `, sent: "1" });
    expect(res.status).toBe(303);
    expect(await lastMail(email)).not.toBeNull();
  });
});
