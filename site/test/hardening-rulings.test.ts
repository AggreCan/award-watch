// The operator's rulings on the first hardening pass, each with its test:
// five wrong codes an hour per address (L3), no invocation logs (L2), no
// real addresses in the pipeline's tests (L4), a sign-in that ends the
// session it replaces (L5), Vary: Cookie while the switch is on (N1),
// robots.txt closing /account (N2), the __Host- cookie (N3), and a
// remembered session trusted through an outage for an hour at most (N8).
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiKeyOf, forgetKeys, requireApiKey } from "../src/account/api_keys";
import { OUTAGE_TRUST_MS, SESSION_COOKIE, forgetSessions } from "../src/account/session";
import { CODE_TRIES, sweep } from "../src/account/signin";
import type { AppEnv } from "../src/env";
import { app } from "../src/index";
import robotsTxt from "../public/robots.txt?raw";
import wranglerConfig from "../wrangler.jsonc?raw";
import {
  ACCOUNTS, csrf, decode, get, grantPro, lastMail, newEmail, nextIp, offEnv, onEnv, post, requestCode, sessionCookie, signIn,
  useAccountsDb, userId,
} from "./accounts-helpers";
import { testEnv } from "./assets";

useAccountsDb();

afterEach(() => {
  vi.useRealTimers();
});

const misses = async (email: string) =>
  (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM code_misses WHERE email = ?").bind(email).first<{ n: number }>())?.n ?? 0;
const wrongFor = (code: string) => (code === "000000" ? "111111" : "000000");
const text = async (res: Response) => decode(await res.text()).replace(/’/g, "'");

const PLAIN = "That code does not match. Check the message and try again.";
const TWO = "That code does not match. Two tries remain this hour.";
const ONE = "That code does not match. One try remains this hour.";
const LOCKED = "Too many wrong codes for this address. Try again in an hour.";

// =========================================================================================
// L3: five wrong codes an hour per address
// =========================================================================================

describe("wrong codes, five an hour per address", () => {
  it("count across every request of the address, warn after the third and the fourth, and lock after the fifth", async () => {
    const email = newEmail("l3-count");
    const first = await requestCode(email);
    const pages: string[] = [];
    for (let i = 0; i < 2; i++) pages.push(await text(await post("/account/check", { email, code: wrongFor(first.code), sent: "1" })));
    // A second request: its code is new, the count is not.
    const second = await requestCode(email);
    for (let i = 0; i < 3; i++) pages.push(await text(await post("/account/check", { email, code: wrongFor(second.code), sent: "1" })));
    expect(pages.map((p) => [PLAIN, TWO, ONE, LOCKED].find((m) => p.includes(m)))).toEqual([PLAIN, PLAIN, TWO, ONE, LOCKED]);
    expect(await misses(email)).toBe(CODE_TRIES);
    // Locked: the right code and the link both answer the lock, and nothing is used up.
    for (const res of [await post("/account/check", { email, code: second.code, sent: "1" }), await post("/account/check", { token: second.token })]) {
      expect(res.status).toBe(400);
      expect(await text(res)).toContain(LOCKED);
      expect(sessionCookie(res)).toBe("");
    }
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM magic_codes WHERE email = ? AND used_at IS NOT NULL").bind(email).first<{ n: number }>())?.n).toBe(0);
    expect(await misses(email)).toBe(CODE_TRIES);
  });

  it("in French: the two warnings and the lock", async () => {
    const email = newEmail("l3-fr");
    const { code } = await requestCode(email, { headers: {} });
    const pages: string[] = [];
    for (let i = 0; i < CODE_TRIES; i++) {
      pages.push(await text(await post("/account/check", { email, code: wrongFor(code), sent: "1", lang: "fr" })));
    }
    expect(pages[2]).toContain("Ce code ne correspond pas. Il reste deux essais pour cette heure.");
    expect(pages[3]).toContain("Ce code ne correspond pas. Il reste un essai pour cette heure.");
    expect(pages[4]).toContain("Trop de codes erronés pour cette adresse. Réessayez dans une heure.");
    for (const p of pages) expect(p).not.toContain(String.fromCharCode(0x2014));
  });

  it("keep the lock through a new request, which is accepted and answered as any other, its code refused", async () => {
    const email = newEmail("l3-new");
    const { code } = await requestCode(email);
    for (let i = 0; i < CODE_TRIES; i++) await post("/account/check", { email, code: wrongFor(code), sent: "1" });
    // The answer to a request says nothing of the lock: the same page as for a fresh address.
    const fresh = newEmail("l3-fresh");
    const answers = await Promise.all([email, fresh].map(async (e) => {
      const res = await post("/account/sign-in", { email: e });
      return { status: res.status, body: (await res.text()).split(e).join("EMAIL") };
    }));
    expect(answers[0]).toEqual(answers[1]);
    const mail = await lastMail(email);
    const newCode = /([0-9]{6})/.exec(mail?.text ?? "")![1];
    const res = await post("/account/check", { email, code: newCode, sent: "1" });
    expect(res.status).toBe(400);
    expect(await text(res)).toContain(LOCKED);
    expect(await misses(email)).toBe(CODE_TRIES);
  });

  it("end when the hour has passed since the wrong tries", async () => {
    const email = newEmail("l3-hour");
    const first = await requestCode(email);
    for (let i = 0; i < CODE_TRIES; i++) await post("/account/check", { email, code: wrongFor(first.code), sent: "1" });
    // A code asked for during the lock is refused while it lasts.
    const later = await requestCode(email);
    expect(await text(await post("/account/check", { email, code: later.code, sent: "1" }))).toContain(LOCKED);
    // One of the five an hour and a minute old: one try is back, and that code signs in.
    await ACCOUNTS.prepare("UPDATE code_misses SET at = ? WHERE id IN (SELECT id FROM code_misses WHERE email = ? ORDER BY at LIMIT 1)")
      .bind(new Date(Date.now() - 61 * 60_000).toISOString(), email).run();
    const res = await post("/account/check", { email, code: later.code, sent: "1" });
    expect(res.status).toBe(303);
    expect(sessionCookie(res)).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
  });

  it("hold at five under a burst sent at once, from many addresses", async () => {
    const email = newEmail("l3-burst");
    const { code } = await requestCode(email);
    const res = await Promise.all(Array.from({ length: 20 }, () => post("/account/check", { email, code: wrongFor(code) }, { ip: nextIp() })));
    expect(res.every((r) => r.status === 400)).toBe(true);
    expect(await misses(email)).toBe(CODE_TRIES);
    expect(await text(await post("/account/check", { email, code }))).toContain(LOCKED);
  });

  it("leave nothing counted for a right code or a check with nothing live, and go with the sweep and the account", async () => {
    const email = newEmail("l3-clean");
    const { code } = await requestCode(email);
    await post("/account/check", { email, code: wrongFor(code), sent: "1" });
    expect(await misses(email)).toBe(1);
    const res = await post("/account/check", { email, code, sent: "1" });
    expect(res.status).toBe(303);
    expect(await misses(email)).toBe(1);
    // Nothing live now: an answer of "expired", and no try counted.
    expect(await text(await post("/account/check", { email, code: "123456", sent: "1" }))).toContain("has expired or was already used");
    expect(await misses(email)).toBe(1);
    const cookie = sessionCookie(res);
    expect((await post("/account/delete", { csrf: await csrf(cookie), confirm: "yes" }, { cookie })).status).toBe(200);
    expect(await misses(email)).toBe(0);
    // The sweep removes rows past a day.
    const old = newEmail("l3-old");
    await ACCOUNTS.prepare("INSERT INTO code_misses (id, email, at) VALUES (lower(hex(randomblob(16))), ?, ?)")
      .bind(old, new Date(Date.now() - 2 * 86_400_000).toISOString()).run();
    await sweep(onEnv() as never);
    expect(await misses(old)).toBe(0);
  });
});

// =========================================================================================
// L5: a sign-in ends the session it replaces
// =========================================================================================

describe("signing in on a browser that holds a session", () => {
  it("revokes that session, for another account or the same one, before the new one starts", async () => {
    const a = newEmail("l5-a");
    const b = newEmail("l5-b");
    const cookieA = await signIn(a);
    // B signs in on the browser that holds A's cookie.
    const { code } = await requestCode(b, { cookie: cookieA });
    const res = await post("/account/check", { email: b, code, sent: "1" }, { cookie: cookieA });
    expect(res.status).toBe(303);
    const cookieB = sessionCookie(res);
    expect(cookieB).not.toBe(cookieA);
    expect((await get("/account", { cookie: cookieA })).status).toBe(303);
    expect((await get("/account", { cookie: cookieB })).status).toBe(200);
    const aId = await userId(a);
    expect((await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL").bind(aId).first<{ n: number }>())?.n).toBe(0);
    expect((await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = 'signed_out' ORDER BY id DESC").bind(aId).first<{ detail: string }>())?.detail).toBe("replaced");
    // The same account again: the older session ends too.
    const again = await requestCode(b, { cookie: cookieB });
    const res2 = await post("/account/check", { email: b, code: again.code, sent: "1" }, { cookie: cookieB });
    expect(res2.status).toBe(303);
    expect((await get("/account", { cookie: cookieB })).status).toBe(303);
    expect((await get("/account", { cookie: sessionCookie(res2) })).status).toBe(200);
  });

  it("leaves every other session alone, and signs in as usual with a cookie that does not stand", async () => {
    const a = newEmail("l5-other");
    const elsewhere = await signIn(a);
    const forged = `${SESSION_COOKIE}=${"a".repeat(32)}.${"b".repeat(64)}`;
    const { code } = await requestCode(a);
    const res = await post("/account/check", { email: a, code, sent: "1" }, { cookie: forged });
    expect(res.status).toBe(303);
    expect((await get("/account", { cookie: elsewhere })).status).toBe(200);
  });
});

// =========================================================================================
// N8: a remembered session through an outage, for an hour at most
// =========================================================================================

const broken = {
  prepare: () => { throw new Error("D1_ERROR: database unavailable"); },
  batch: () => { throw new Error("D1_ERROR: database unavailable"); },
} as unknown as D1Database;

describe("a session through an outage", () => {
  it("answers from what this isolate verified for an hour after the verification, and is unavailable after it", async () => {
    forgetSessions();
    const email = newEmail("n8");
    const cookie = await signIn(email);
    await grantPro(email);
    expect((await get("/account", { cookie })).status).toBe(200);
    const down = onEnv({ ACCOUNTS: broken });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const verifiedAt = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(verifiedAt + OUTAGE_TRUST_MS - 60_000);
      expect(decode(await (await get("/tenders", { cookie, env: down })).text())).toContain(`<span class="rail-label">${email}</span>`);
      vi.setSystemTime(verifiedAt + OUTAGE_TRUST_MS + 60_000);
      const page = decode(await (await get("/tenders", { cookie, env: down })).text());
      expect(page).not.toContain(email);
      expect(page).toContain('href="/account/sign-in"');
      expect((await get("/account", { cookie, env: down })).status).toBe(503);
    } finally {
      vi.useRealTimers();
      quiet.mockRestore();
    }
    expect(OUTAGE_TRUST_MS).toBe(60 * 60 * 1000);
  });

  it("holds an API key to the same hour", async () => {
    forgetKeys();
    const email = newEmail("n8-key");
    const cookie = await signIn(email);
    await grantPro(email);
    const html = await (await post("/account/keys", { csrf: await csrf(cookie), name: "n8" }, { cookie })).text();
    const key = /(aw_[0-9a-f]{8}_[0-9a-f]{64})/.exec(html)![1];
    const probe = new Hono<AppEnv>();
    probe.get("/probe", requireApiKey(), (c) => c.json({ holder: apiKeyOf(c) ?? null }));
    const call = (e: object) => probe.request("/probe", { headers: { authorization: `Bearer ${key}` } }, e);
    expect((await call(onEnv())).status).toBe(200);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const verifiedAt = Date.now();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(verifiedAt + OUTAGE_TRUST_MS - 60_000);
      expect((await call(onEnv({ ACCOUNTS: broken }))).status).toBe(200);
      vi.setSystemTime(verifiedAt + OUTAGE_TRUST_MS + 60_000);
      expect((await call(onEnv({ ACCOUNTS: broken }))).status).toBe(503);
    } finally {
      vi.useRealTimers();
      quiet.mockRestore();
    }
  });
});

// =========================================================================================
// N1, N2, N3: headers, robots and the cookie
// =========================================================================================

const PAGES = ["/", "/tenders", "/tenders/new", "/organizations/org-a000000001", "/search?q=exemplar", "/alerts", "/privacy", "/nothing-here"];

async function headersOf(path: string, env: object, extra: Record<string, string> = {}) {
  const res = await app.request(path, { headers: { "cf-connecting-ip": nextIp(), "sec-fetch-mode": "navigate", ...extra } }, env);
  return { status: res.status, headers: [...res.headers.entries()].sort(), body: await res.text() };
}

describe("Vary: Cookie", () => {
  it("is on every HTML page, once, while the switch is on, signed in or not, and on a 304", async () => {
    const cookie = await signIn(newEmail("n1"));
    for (const path of PAGES) {
      for (const c of [undefined, cookie]) {
        const res = await app.request(path, { headers: { "cf-connecting-ip": nextIp(), ...(c ? { cookie: c } : {}) } }, onEnv());
        expect(res.headers.get("vary"), `${path} ${c ? "signed in" : "signed out"}`).toBe("Cookie");
      }
    }
    const first = await app.request("/tenders", { headers: { "cf-connecting-ip": nextIp() } }, onEnv());
    const again = await app.request("/tenders", { headers: { "cf-connecting-ip": nextIp(), "if-none-match": first.headers.get("etag")! } }, onEnv());
    expect([again.status, again.headers.get("vary")]).toEqual([304, "Cookie"]);
  });

  it("is absent while the switch is off: every page byte for byte and header for header as without the module", async () => {
    const bare = { ...testEnv() } as Record<string, unknown>;
    for (const k of ["ACCOUNTS", "ACCOUNTS_ENABLED", "MAIL", "MAIL_FROM"]) delete bare[k];
    for (const path of PAGES) {
      const off = await headersOf(path, offEnv());
      expect(off, path).toEqual(await headersOf(path, bare));
      expect(off.headers.find(([k]) => k === "vary"), path).toBeUndefined();
    }
  });
});

describe("robots.txt", () => {
  it("closes /account to every crawler group that is otherwise open, whatever the switch", async () => {
    const groups = robotsTxt.split(/\n\s*\n/).filter((g) => /^User-agent:/m.test(g));
    const open = groups.filter((g) => /^Allow: \/$/m.test(g));
    expect(open.map((g) => /^User-agent: (.+)$/m.exec(g)![1])).toEqual(["*", "bingbot"]);
    for (const g of open) expect(g.split("\n")).toContain("Disallow: /account");
    for (const env of [offEnv(), onEnv()]) {
      expect(await (await app.request("/robots.txt", {}, env)).text()).toBe(robotsTxt);
    }
  });
});

describe("the session cookie", () => {
  it("is __Host-aw_session: Secure, Path=/, no Domain, as the prefix requires; the name without the prefix is no one", async () => {
    expect(SESSION_COOKIE).toBe("__Host-aw_session");
    const email = newEmail("n3");
    const { code } = await requestCode(email);
    const res = await post("/account/check", { email, code, sent: "1" });
    const set = res.headers.getSetCookie().find((s) => s.startsWith("__Host-aw_session="))!;
    const parts = set.split("; ");
    for (const part of ["Secure", "Path=/", "HttpOnly", "SameSite=Lax"]) expect(parts).toContain(part);
    expect(set.toLowerCase()).not.toContain("domain=");
    const value = set.split(";")[0].slice("__Host-aw_session=".length);
    expect((await get("/account", { cookie: `__Host-aw_session=${value}` })).status).toBe(200);
    expect((await get("/account", { cookie: `aw_session=${value}` })).status).toBe(303);
  });
});

// =========================================================================================
// L2 and L4: logs and the pipeline's tests
// =========================================================================================

describe("logs and test data", () => {
  it("keep Workers invocation logs off and the console lines on", () => {
    const block = /"observability":\s*\{[\s\S]*?\n {2}\}/.exec(wranglerConfig)?.[0] ?? "";
    expect(block).toContain('"enabled": true');
    expect(block).toContain('"logs": { "invocation_logs": false }');
  });

  it("put no real address in the pipeline files that carried them: every one is on example.invalid", () => {
    const files = import.meta.glob([
      "../../pipeline/tests/fixtures/canadabuys_tenders_new.csv", "../../pipeline/tests/fixtures/canadabuys_awards.csv",
      "../../pipeline/tests/test_matching.py", "../../pipeline/tests/test_canadabuys.py", "../../pipeline/tests/test_contracts.py",
      "../../pipeline/awardwatch_pipeline/sources/matching.py",
    ], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.keys(files)).toHaveLength(6);
    for (const [file, text] of Object.entries(files)) {
      const addresses = text.match(/[\w.+%'-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
      for (const a of addresses) expect(a.endsWith("example.invalid"), `${file}: ${a.replace(/^[^@]+/, "...")}`).toBe(true);
    }
  });
});
