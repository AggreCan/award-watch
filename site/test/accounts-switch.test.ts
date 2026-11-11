// The accounts switch (ACCOUNTS_ENABLED, src/account/switch.ts). Off, as
// vitest.config.ts holds it under test: every /account route is the site's own 404, no
// public page links to an account or changes in any byte, the sign-in posts
// count as pages, the API keys gate nothing, and neither the accounts
// database nor the mail binding is read (bindings that record and throw on
// any use prove it). On:
// the routes answer and the rail gains one item.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { makeFakeAssets, testEnv } from "./assets";
import { get, grantPro, newEmail, nextIp, onEnv, post, signIn, useAccountsDb } from "./accounts-helpers";
import { LANDING_SWITCH_PIECES, homeRequest, landingCore } from "./home";

useAccountsDb();

const PUBLIC_PAGES = [
  "/", "/overview", "/overview?lang=fr", "/tenders", "/tenders?segment=82", "/awards", "/expiring", "/organizations", "/organizations/org-a000000001",
  "/buyers/pwgsc-tpsgc", "/segments/82", "/alerts", "/watchlist", "/about", "/terms", "/privacy", "/data", "/corrections",
  "/nothing-here", "/?lang=fr", "/privacy?lang=fr",
  // A notice's and a contract's pages carry their calendar file's link whatever the switch (pages/ics.ts).
  "/tenders/cb-200-20005019", "/awards/cb-400-40000004",
  // The pages a search is saved from (account/search_control.tsx), filtered and not.
  "/tenders?segment=82&province=BC&sort=published", "/expiring/3m", "/expiring/3m?segment=82", "/tenders?lang=fr",
];

const ACCOUNT_ROUTES: [string, string][] = [
  ["GET", "/account"], ["GET", "/account/sign-in"], ["GET", "/account/check"], ["GET", "/account/check?token=x"],
  ["GET", "/account/searches"], ["GET", "/account/keys"], ["GET", "/account/delete"], ["GET", "/account/billing"],
  ["POST", "/account/sign-in"], ["POST", "/account/check"], ["POST", "/account/sign-out"], ["POST", "/account/searches"],
  ["POST", "/account/searches/import"], ["POST", "/account/keys"], ["POST", "/account/delete"],
  // The keys' usage page (account/api_usage_page.tsx).
  ["GET", "/account/api"],
  ["GET", `/account/stop?s=${"a".repeat(32)}&t=${"b".repeat(32)}`], ["POST", "/account/stop"],
  // Calendar feeds (account/feeds.ts): every address under /account/calendar.
  ["GET", `/account/calendar/${"a".repeat(32)}.ics?t=${"b".repeat(32)}`], ["POST", "/account/calendar"],
  ["POST", `/account/calendar/${"a".repeat(32)}/rotate`], ["POST", `/account/calendar/${"a".repeat(32)}/delete`],
  // Your organization (account/org_claim.ts, org_pages.tsx): the page, its posts and its files.
  ["GET", "/account/organization"], ["GET", "/account/organization?q=exemplar"], ["POST", "/account/organization"],
  ["POST", "/account/organization/compare"], ["POST", "/account/organization/compare/remove"], ["POST", "/account/organization/segment"],
  ["POST", "/account/organization/delete"], ["GET", "/account/organization/years.csv"],
];

// A binding that notes every use and throws: the accounts database, or the
// mail binding.
function trap<T>(what = "the accounts database") {
  const used: string[] = [];
  const binding = new Proxy({}, {
    get(_t, prop) {
      used.push(String(prop));
      throw new Error(`${what} was read while the switch is off`);
    },
  }) as T;
  return { used, binding };
}

// home: "/" answered by the app home (test/home.ts) rather than the landing page.
async function render(path: string, env: object, cookie?: string, home = false) {
  const headers: Record<string, string> = { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() };
  if (cookie) headers.cookie = cookie;
  const res = await (home ? homeRequest : app.request.bind(app))(path, { headers }, env);
  return { status: res.status, cache: res.headers.get("cache-control"), cookies: res.headers.getSetCookie(), body: await res.text() };
}

describe("with the switch off", () => {
  it("answers every account route with the site's own 404 page, reading nothing", async () => {
    const { used, binding: db } = trap<D1Database>();
    const mail = trap<SendEmail>("the mail binding");
    const env = { ...testEnv(), ACCOUNTS: db, MAIL: mail.binding };
    const notFound = (await render("/nothing-here", env)).body;
    for (const [method, path] of ACCOUNT_ROUTES) {
      const init: RequestInit = { method, headers: { "cf-connecting-ip": nextIp(), "sec-fetch-mode": "navigate" } };
      if (method === "POST") {
        init.headers = { ...(init.headers as Record<string, string>), "content-type": "application/x-www-form-urlencoded", origin: "http://localhost" };
        init.body = new URLSearchParams({ email: newEmail("off") }).toString();
      }
      const res = await app.request(path, init, env);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.headers.get("x-robots-tag"), path).toBeNull();
      expect(await res.text(), `${method} ${path}`).toBe(notFound);
    }
    expect(used).toEqual([]);
    expect(mail.used).toEqual([]);
  });

  it("leaves every public page byte for byte as it is without the accounts module's bindings, even with a session cookie", async () => {
    // A real session, made while the switch is on, sent back while it is off.
    const cookie = await signIn(newEmail("cookie"));
    const { used, binding: db } = trap<D1Database>();
    const mail = trap<SendEmail>("the mail binding");
    const off = { ...testEnv(), ACCOUNTS: db, MAIL: mail.binding };
    const bare = { ...testEnv() } as Record<string, unknown>;
    delete bare.ACCOUNTS;
    delete bare.ACCOUNTS_ENABLED;
    delete bare.MAIL;
    delete bare.MAIL_FROM;
    for (const path of PUBLIC_PAGES) {
      const a = await render(path, off);
      const b = await render(path, bare);
      const c = await render(path, off, cookie);
      expect(a, path).toEqual(b);
      expect(c, path).toEqual(b);
      expect(a.body, path).not.toContain("/account");
      expect(a.body, path).not.toContain("aw_session");
      expect(a.body, path).not.toContain("rail-account");
    }
    expect(used).toEqual([]);
    expect(mail.used).toEqual([]);
  });

  it("answers the weekly briefing's sample with the site's 404, reading neither database (account/briefing_pages.tsx)", async () => {
    const { used, binding: db } = trap<D1Database>();
    const records = trap<D1Database>("the records database");
    const env = { ...testEnv(), ACCOUNTS: db, RECORDS: records.binding };
    const notFound = (await render("/nothing-here", env)).body;
    const sample = await render("/pro/briefing-sample", env);
    expect(sample.status).toBe(404);
    expect(sample.body).toBe(notFound);
    expect(used).toEqual([]);
    expect(records.used).toEqual([]);
  });

  it("keeps the rail's lists at two items and the privacy page's 'No Accounts'", async () => {
    const home = (await render("/", testEnv(), undefined, true)).body;
    const lists = home.slice(home.indexOf('id="rail-lists"'), home.indexOf("</nav>"));
    expect(lists.match(/<li>/g)).toHaveLength(2);
    const privacy = (await render("/privacy", testEnv())).body;
    expect(privacy).toContain('<h2 id="accounts">No Accounts</h2>');
    expect(privacy).toContain("The site has no accounts and no sign-in.");
  });

  it("counts the sign-in posts as pages, not against the sign-in cap", async () => {
    const keys: string[] = [];
    const keeper = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } as unknown as RateLimit;
    const ip = "203.0.113.200";
    const send = (env: object) => app.request("/account/sign-in", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": ip, origin: "http://localhost" },
      body: new URLSearchParams({ email: newEmail("cap") }).toString(),
    }, env);
    await send({ ...testEnv(), PAGE_LIMIT: keeper, AUTH_LIMIT: keeper });
    expect(keys).toEqual([`page:${ip}`]);
    keys.length = 0;
    await send({ ...onEnv(), PAGE_LIMIT: keeper, AUTH_LIMIT: keeper });
    expect(keys).toEqual([`auth:${ip}`]);
  });
});

describe("with the switch on", () => {
  // Besides the account item, the switch brings the Pro marks (src/pro.tsx):
  // the chip on the rail's Pro entries, the rail's same-day and Analytics
  // entries, the gate note in the tender list's head, the footer's link to
  // the analytics index, and on a profile the link to its analytics view,
  // marked Pro (nothing a free reader is offered is hidden; operator's
  // ruling of 2026-11-03, docs/analytics.md); and the links to the
  // Pro page, in the footer and as the home page's email line (docs/seo.md).
  // Nothing else changes.
  const CHIP = / ?<span class="pro-tag">[\s\S]*?<\/span><\/span>/g;
  const SAME_DAY_ITEM = /<li><a class="rail-item rail-child" href="\/tenders\/same-day">[\s\S]*?<\/a><\/li>/;
  // The index of the analytics views (pages/analytics_index.tsx), in the rail's Browse group.
  const ANALYTICS_ITEM = /<li><a class="rail-item" href="\/analytics">[\s\S]*?<\/a><\/li>/;
  const NOTE = /<p class="pro-note">[\s\S]*?<\/p>/;
  // The line under an email-list form that offers the plan, with the switch on (pages/interest.tsx).
  const INTEREST_PRO = /<p class="interest-pro">[\s\S]*?<\/p>/g;
  const ANALYTICS = /<a href="\/organizations\/org-a000000001\/analytics" class="btn" rel="nofollow">Analytics<\/a>/;
  const FOOTER_PRO = '<a href="/pro">Pro plan</a>';
  // The footer's link to the analytics index, which stands in for the rail's Browse item on a phone.
  const FOOTER_ANALYTICS = '<a href="/analytics">Analytics</a>';
  const HOME_PRO = /<li class="home-do-pro">[\s\S]*?<\/li>/;
  // The home head's first button: the email alerts while Pro exists, the Atom feeds while it does not.
  const HOME_BUTTON = '<a href="/pro" class="btn">Email alerts with Pro</a>';
  const HOME_FEEDS = '<a href="/feeds" class="btn">Atom feeds</a>';
  // The Follow control under a profile's head (account/watch_pages.tsx): for a reader not signed in, a form that
  // posts an address to the sign-in with the page and what to follow, Follow the profile's one filled button.
  const FOLLOW = new RegExp(
    '<form method="post" action="/account/sign-in" class="watch-control watch-signin">' +
    '<input type="hidden" name="lang" value="en"/><input type="hidden" name="next" value="/organizations/org-a000000001"/>' +
    '<input type="hidden" name="follow" value="organization:org-a000000001"/>' +
    '<label class="watch-email"><span class="visually-hidden">Email address</span><input name="email" type="email" [^>]*/></label>' +
    '<div class="hp"><label>Leave this field empty<input name="website" type="text" tabindex="-1" autocomplete="off"/></label></div>' +
    '<button type="submit" class="btn btn-primary">Follow</button><span class="muted small">[^<]*</span></form>',
  );

  it("opens the routes and adds the account item, the Pro marks and a profile's analytics link, and nothing else on a public page", async () => {
    expect((await get("/account/sign-in")).status).toBe(200);
    // The app home: "/" here through test/home.ts, and at its own address /overview through the app itself.
    const appHome = (path: string) => path === "/" || path === "/overview";
    for (const path of ["/", "/overview", "/tenders", "/organizations/org-a000000001", "/nothing-here"]) {
      const on = await render(path, onEnv(), undefined, true);
      const off = await render(path, testEnv(), undefined, true);
      expect(on.status, path).toBe(off.status);
      expect(on.cache, path).toBe(off.cache);
      const item = '<li><a class="rail-item rail-account" href="/account/sign-in"><span class="rail-label">Sign in</span></a></li>';
      expect(on.body, path).toContain(item);
      const rail = /<nav class="rail"[\s\S]*?<\/nav>/.exec(on.body)?.[0] ?? "";
      expect(rail.match(/class="pro-tag"/g), path).toHaveLength(5);
      expect(rail, path).toMatch(SAME_DAY_ITEM);
      expect(rail, path).toMatch(ANALYTICS_ITEM);
      expect(NOTE.test(on.body), path).toBe(path === "/tenders");
      // The top bar's same-day timer leads to the tease while the switch is on and to the list while it is off.
      expect(on.body, path).toContain(FOOTER_PRO);
      expect(on.body, path).toContain(FOOTER_ANALYTICS);
      expect(HOME_PRO.test(on.body), path).toBe(appHome(path));
      expect(on.body.includes(HOME_BUTTON), path).toBe(appHome(path));
      expect(FOLLOW.test(on.body), path).toBe(path.startsWith("/organizations/"));
      const stripped = on.body.replace(item, "").replace(CHIP, "").replace(SAME_DAY_ITEM, "").replace(ANALYTICS_ITEM, "").replace(NOTE, "").replace(INTEREST_PRO, "")
        .replace(FOOTER_PRO, "").replace(FOOTER_ANALYTICS, "").replace(HOME_PRO, "").replace(FOLLOW, "").replace(HOME_BUTTON, HOME_FEEDS)
        .replace('<a class="refresh" href="/tenders/same-day"', '<a class="refresh" href="/tenders"');
      expect(ANALYTICS.test(stripped), path).toBe(path.startsWith("/organizations/"));
      expect(off.body, path).not.toContain("pro-tag");
      expect(off.body, path).not.toContain("/analytics");
      expect(stripped.replace(ANALYTICS, ""), path).toBe(off.body);
    }
  });

  // The landing page, "/" for a reader not signed in (src/pages/landing.tsx):
  // the switch brings its plan cards, its three Pro lines and the hero's note
  // on accounts, the sign-in and the links to Pro and Analytics, the free
  // account behind Track tenders free (the Atom feeds while off), the watch
  // sentence, the profile shot's Follow and Analytics buttons, Pro's line in
  // the third step and the footer's two links (test/home.ts
  // LANDING_SWITCH_PIECES). Nothing else changes.
  it("adds to the landing page its enumerated pieces and nothing else", async () => {
    for (const path of ["/", "/?lang=fr"]) {
      const on = await render(path, onEnv());
      const off = await render(path, testEnv());
      expect(on.status, path).toBe(200);
      expect(on.cache, path).toBe(off.cache);
      for (const piece of LANDING_SWITCH_PIECES.filter((p) => p.onOnly)) {
        expect(on.body.match(piece.re), `${path} ${piece.what}`).not.toBeNull();
        expect(off.body.match(piece.re), `${path} ${piece.what}`).toBeNull();
      }
      expect(off.body, path).not.toContain("pro-tag");
      expect(off.body, path).not.toContain("/account");
      expect(landingCore(on.body), path).toBe(landingCore(off.body));
    }
  });

  // Save this search (account/search_control.tsx) renders for a signed-in
  // reader only: the pages that carry it gain nothing from it without a
  // session, or with a cookie that names none (the loop above holds /tenders
  // to the byte).
  it("adds no Save this search to a page that carries it, for a reader without a session", async () => {
    const stale = "__Host-aw_session=" + "a".repeat(32) + "." + "b".repeat(64);
    for (const path of ["/tenders?segment=82", "/expiring", "/expiring/3m?segment=82", "/segments/82"]) {
      for (const cookie of [undefined, stale]) {
        const on = await render(path, onEnv(), cookie);
        expect(on.status, path).toBe(200);
        expect(on.body, path).not.toContain("save-search");
        expect(on.body, path).not.toContain('action="/account/searches"');
        expect(on.body, path).not.toContain('name="csrf"');
      }
    }
  });

  it("says on the privacy page what an account keeps", async () => {
    const privacy = (await render("/privacy", onEnv())).body;
    expect(privacy).toContain('<h2 id="accounts">Accounts</h2>');
    expect(privacy).toContain("There are no passwords.");
    expect(privacy).not.toContain("The site has no accounts and no sign-in.");
  });

  it("answers an account route the switch does not know with the site's 404", async () => {
    const res = await get("/account/nothing");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Page Not Found");
    expect((await post("/account/billing", {})).status).toBe(404);
  });
});

describe("the plan subscript after the wordmark", () => {
  it("names the signed-in reader's plan, free or pro, in both languages, and nothing while signed out", async () => {
    const email = newEmail("badge");
    const cookie = await signIn(email);
    expect((await render("/", onEnv(), cookie)).body).toContain('<span class="brand-plan brand-plan-free">free</span>');
    expect((await render("/?lang=fr", onEnv(), cookie)).body).toContain('<span class="brand-plan brand-plan-free">gratuit</span>');
    await grantPro(email);
    const pro = (await render("/", onEnv(), cookie)).body;
    expect(pro).toContain('<span class="brand-plan brand-plan-pro">pro</span>');
    expect(pro).not.toContain("brand-plan-free");
    expect((await render("/", onEnv())).body).not.toContain("brand-plan");
  });
});

// The standing offers and supply arrangements (pages/instruments.tsx): with
// the switch off their pages are the same whatever the accounts module's
// bindings hold, carry no Pro mark, and their two CSV files are the site's
// 404 without the accounts database being read.
describe("the standing offers' pages with the switch off", () => {
  it("are byte for byte the same without the accounts module's bindings, and their files are the 404", async () => {
    const index = {
      as_of: "2026-10-31", published: "2026-10-30", status: "ok", source: "https://sosa.canadabuys.canada.ca/", types: {}, commodities: {},
      end_users: {}, rows: [{ agreement: "E60ZT-120002/001/ZT", type: "RMSO", description_en: "Environmental consulting services",
        description_fr: null, commodity: [], end_user: null, regions: ["BC"], segments: [], start: null, expiry: "2028-03-31", n_holders: 2,
        n_holders_withheld: 0 }],
    };
    const assets = makeFakeAssets({}, { "instruments/index.json": index });
    const { used, binding: db } = trap<D1Database>();
    const off = { ...testEnv(assets), ACCOUNTS: db };
    const bare = { ...testEnv(assets) } as Record<string, unknown>;
    delete bare.ACCOUNTS;
    delete bare.ACCOUNTS_ENABLED;
    for (const path of ["/instruments", "/instruments?region=BC", "/instruments?lang=fr"]) {
      const a = await render(path, off);
      expect(a, path).toEqual(await render(path, bare));
      expect(a.status, path).toBe(200);
      expect(a.body, path).not.toContain("pro-tag");
      expect(a.body, path).not.toContain("rows.csv");
    }
    for (const path of ["/instruments/rows.csv", "/instruments/E60ZT-120002%2F001%2FZT/holders.csv"]) {
      expect((await render(path, off)).status, path).toBe(404);
    }
    expect(used).toEqual([]);
  });
});
