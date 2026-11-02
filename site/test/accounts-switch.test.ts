// The accounts switch (ACCOUNTS_ENABLED, src/account/switch.ts). Off, as
// wrangler.jsonc ships it: every /account route is the site's own 404, no
// public page links to an account or changes in any byte, the sign-in posts
// count as pages, the API keys gate nothing, and the accounts database is
// never read (a binding that records and throws on any use proves it). On:
// the routes answer and the rail gains one item.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { testEnv } from "./assets";
import { get, newEmail, nextIp, onEnv, post, signIn, useAccountsDb } from "./accounts-helpers";

useAccountsDb();

const PUBLIC_PAGES = [
  "/", "/tenders", "/tenders?segment=82", "/awards", "/expiring", "/organizations", "/organizations/org-a000000001",
  "/buyers/pwgsc-tpsgc", "/segments/82", "/alerts", "/watchlist", "/about", "/terms", "/privacy", "/data", "/corrections",
  "/nothing-here", "/?lang=fr", "/privacy?lang=fr",
];

const ACCOUNT_ROUTES: [string, string][] = [
  ["GET", "/account"], ["GET", "/account/sign-in"], ["GET", "/account/check"], ["GET", "/account/check?token=x"],
  ["GET", "/account/searches"], ["GET", "/account/keys"], ["GET", "/account/delete"], ["GET", "/account/billing"],
  ["POST", "/account/sign-in"], ["POST", "/account/check"], ["POST", "/account/sign-out"], ["POST", "/account/searches"],
  ["POST", "/account/searches/import"], ["POST", "/account/keys"], ["POST", "/account/delete"],
];

// A database binding that notes every use and throws.
function trap() {
  const used: string[] = [];
  const db = new Proxy({}, {
    get(_t, prop) {
      used.push(String(prop));
      throw new Error("the accounts database was read while the switch is off");
    },
  }) as D1Database;
  return { used, db };
}

async function render(path: string, env: object, cookie?: string) {
  const headers: Record<string, string> = { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() };
  if (cookie) headers.cookie = cookie;
  const res = await app.request(path, { headers }, env);
  return { status: res.status, cache: res.headers.get("cache-control"), cookies: res.headers.getSetCookie(), body: await res.text() };
}

describe("with the switch off", () => {
  it("answers every account route with the site's own 404 page, reading nothing", async () => {
    const { used, db } = trap();
    const env = { ...testEnv(), ACCOUNTS: db };
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
  });

  it("leaves every public page byte for byte as it is without the accounts module's bindings, even with a session cookie", async () => {
    // A real session, made while the switch is on, sent back while it is off.
    const cookie = await signIn(newEmail("cookie"));
    const { used, db } = trap();
    const off = { ...testEnv(), ACCOUNTS: db };
    const bare = { ...testEnv() } as Record<string, unknown>;
    delete bare.ACCOUNTS;
    delete bare.ACCOUNTS_ENABLED;
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
  });

  it("keeps the rail's lists at two items and the privacy page's 'No Accounts'", async () => {
    const home = (await render("/", testEnv())).body;
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
  it("opens the routes and adds one item to the rail, and nothing else on a public page", async () => {
    expect((await get("/account/sign-in")).status).toBe(200);
    for (const path of ["/", "/tenders", "/organizations/org-a000000001", "/nothing-here"]) {
      const on = await render(path, onEnv());
      const off = await render(path, testEnv());
      expect(on.status, path).toBe(off.status);
      expect(on.cache, path).toBe(off.cache);
      const item = '<li><a class="rail-item rail-account" href="/account/sign-in"><span class="rail-label">Sign in</span></a></li>';
      expect(on.body, path).toContain(item);
      expect(on.body.replace(item, ""), path).toBe(off.body);
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
