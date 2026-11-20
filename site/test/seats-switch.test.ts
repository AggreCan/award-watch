// The seats' switch (SEATS in wrangler.jsonc, src/account/seats.ts seatsOn; the seats design's 9.1). While it is
// off, and while it is on but the seats table is not on the database, every page a reader opens is byte for byte
// what main drew before slice C (test/seats-switch-today.ts, captured from these fixtures on main and never
// rebuilt here): signed out, Free, Pro and Ultra, Ultra off sale and on sale, the table present and absent.
// Every address under /account/seats and /account/seat is the site's 404, the same answer as an address the
// accounts module does not know, with nothing read beyond that answer's own reads; the invitation's post writes
// nothing and sends nothing; the limiter counts the seats' addresses as pages. With the switch on, a reader who
// neither holds a seat nor gives one reads every page as before, and an Ultra account's pages gain only the
// Seats row on the overview and the Seats link on the billing page.
import { afterEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { ACCOUNTS, csrf, nextIp, onEnv, post, useAccountsDb, withoutSeats } from "./accounts-helpers";
import { ENVS, type EnvName, READERS, type Reader, type Seen, emailOf, makeReaders, pagesOf, seen, shortHash } from "./seats-switch-fixtures";
import { TODAY } from "./seats-switch-today";

useAccountsDb();

afterEach(() => {
  vi.restoreAllMocks();
});

let cookies: Record<Reader, string | undefined> | null = null;
async function readers(): Promise<Record<Reader, string | undefined>> {
  if (!cookies) {
    cookies = await makeReaders();
    // A first read of each signed-in reader brings its cached plan up to date, as the capture did.
    for (const reader of READERS) if (cookies[reader]) await seen("/account", ENVS.base(), cookies[reader]);
  }
  return cookies;
}

// An environment with the seats' variable as given: "off" (as wrangler.jsonc ships it), "on", or absent (as before slice C).
function withSeats(env: object, value: "off" | "on" | null): object {
  const out = { ...env } as Record<string, unknown>;
  if (value === null) delete out.SEATS;
  else out.SEATS = value;
  return out;
}

// Every page of every reader, against the capture.
async function everyPage(value: "off" | "on" | null): Promise<Map<string, Seen>> {
  const c = await readers();
  const out = new Map<string, Seen>();
  for (const name of Object.keys(ENVS) as EnvName[]) {
    for (const reader of READERS) {
      for (const path of pagesOf(reader)) out.set(`${name} ${reader} ${path}`, await seen(path, withSeats(ENVS[name](), value), c[reader]));
    }
  }
  return out;
}

const SEATS_ROUTES: [string, string][] = [
  ["GET", "/account/seats"], ["GET", "/account/seats?lang=fr"], ["POST", "/account/seats/invite"],
  ["GET", `/account/seats/join?i=${"a".repeat(32)}&t=${"b".repeat(64)}`], ["POST", "/account/seats/join"],
  ["POST", `/account/seats/${"a".repeat(32)}/cancel`], ["GET", `/account/seats/${"a".repeat(32)}/remove`],
  ["POST", `/account/seats/${"a".repeat(32)}/remove`], ["GET", "/account/seat/leave"], ["POST", "/account/seat/leave"],
  ["GET", "/account/seats/anything"], ["GET", "/account/seat"],
];

// The accounts database with every statement prepared on it written down.
function recording(): { db: D1Database; sent: string[] } {
  const sent: string[] = [];
  const native = new WeakMap<object, D1PreparedStatement>();
  const db = new Proxy(ACCOUNTS, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          sent.push(sql);
          const stmt = target.prepare(sql);
          const wrapped = new Proxy(stmt, { get: (s, p) => { const v = Reflect.get(s, p); return typeof v === "function" ? v.bind(s) : v; } });
          native.set(wrapped, stmt);
          return wrapped;
        };
      }
      if (prop === "batch") return (stmts: D1PreparedStatement[]) => target.batch(stmts.map((s) => native.get(s) ?? s));
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { db: db as D1Database, sent };
}

async function request(method: string, path: string, env: object, cookie?: string, fields: Record<string, string> = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": nextIp(), "sec-fetch-mode": "navigate" };
  if (cookie) headers.cookie = cookie;
  const init: RequestInit = { method, headers };
  if (method === "POST") {
    headers["content-type"] = "application/x-www-form-urlencoded";
    headers.origin = "http://localhost";
    init.body = new URLSearchParams(fields).toString();
  }
  const res = await app.request(path, init, env);
  return { status: res.status, cache: res.headers.get("cache-control"), robots: res.headers.get("x-robots-tag"), body: await res.text() };
}

const counts = async () => {
  const one = async (sql: string) => Number((await ACCOUNTS.prepare(sql).first<{ n: number }>())?.n ?? 0);
  return {
    seats: await one("SELECT COUNT(*) AS n FROM seats"), mail: await one("SELECT COUNT(*) AS n FROM sent_mail"),
    runs: await one("SELECT COUNT(*) AS n FROM delivery_runs"), audit: await one("SELECT COUNT(*) AS n FROM audit WHERE event LIKE 'seat_%'"),
  };
};

describe("with the switch off", () => {
  it("draws every page, every reader, Ultra off sale and on sale, byte for byte as main drew it, the table present and absent", { timeout: 180_000 }, async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const value of ["off", null] as const) {
      for (const [key, page] of await everyPage(value)) expect(page, `${value ?? "absent"} ${key}`).toEqual(TODAY[key]);
    }
    await withoutSeats(async () => {
      // Without the table the switch reads as off even when it says on.
      for (const value of ["off", "on"] as const) {
        for (const [key, page] of await everyPage(value)) expect(page, `${value}, no table, ${key}`).toEqual(TODAY[key]);
      }
    });
    expect(Object.keys(TODAY)).toHaveLength(122);
  });

  it("answers every seats address with the site's 404, as an address the module does not know, reading nothing more", { timeout: 60_000 }, async () => {
    const c = await readers();
    for (const value of ["off", null] as const) {
      for (const cookie of [undefined, c.ultra, c.free]) {
        for (const [method, path] of SEATS_ROUTES) {
          // The unknown address's 404, in the same language.
          const known = recording();
          const notFound = await request("GET", `/account/nothing-here${path.endsWith("lang=fr") ? "?lang=fr" : ""}`,
            withSeats(onEnv({ ACCOUNTS: known.db }), value), cookie);
          expect(notFound.status).toBe(404);
          const r = recording();
          const res = await request(method, path, withSeats(onEnv({ ACCOUNTS: r.db }), value), cookie, { csrf: "0".repeat(32), email: "someone@example.com" });
          expect(res, `${value} ${method} ${path}`).toEqual(notFound);
          // The same statements as the unknown address's 404 (its rail reads the session), never one that names the seats alone.
          expect([...r.sent].sort(), `${value} ${method} ${path}`).toEqual([...known.sent].sort());
          expect(r.sent, `${method} ${path}`).not.toContain("SELECT 1 AS x FROM seats LIMIT 1");
        }
      }
    }
  });

  it("writes nothing and sends nothing for an invitation posted from an Ultra account's own page", async () => {
    const c = await readers();
    const env = onEnv();
    const token = await csrf(c.ultra!, "/account", { env });
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const before = await counts();
    const res = await post("/account/seats/invite", { csrf: token, email: "invited-off@example.com", message_lang: "en" }, { cookie: c.ultra, env });
    expect(res.status).toBe(404);
    expect(await counts()).toEqual(before);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sent_mail WHERE to_addr = ?").bind("invited-off@example.com").first()).toEqual({ n: 0 });
  });

  it("counts the seats' addresses as pages, and in their own buckets only while it is on", async () => {
    const keys: string[] = [];
    const keeper = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } as unknown as RateLimit;
    const limiters = { PAGE_LIMIT: keeper, FORM_LIMIT: keeper, EDIT_LIMIT: keeper, STOP_LIMIT: keeper };
    const ip = "203.0.113.201";
    const send = (method: string, path: string, env: object) => app.request(path, {
      method, headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": ip, origin: "http://localhost" },
      ...(method === "POST" ? { body: "" } : {}),
    }, env);
    const cases: [string, string, string][] = [
      ["POST", "/account/seats/invite", "form"], ["POST", "/account/seats/join", "form"], ["GET", "/account/seats/join", "stop"],
      ["POST", `/account/seats/${"a".repeat(32)}/cancel`, "edit"], ["POST", `/account/seats/${"a".repeat(32)}/remove`, "edit"],
      ["POST", "/account/seat/leave", "edit"], ["GET", "/account/seats", "page"],
    ];
    for (const [method, path, bucket] of cases) {
      for (const [value, want] of [["off", "page"], [null, "page"], ["on", bucket]] as const) {
        keys.length = 0;
        await send(method, path, withSeats({ ...onEnv(), ...limiters }, value));
        expect(keys, `${value} ${method} ${path}`).toEqual([`${want}:${ip}`]);
      }
    }
  });
});

describe("with the switch on and the table there", () => {
  it("leaves every page of a reader who gives and holds no seat as main drew it; an Ultra account gains the Seats row and link alone", { timeout: 120_000 }, async () => {
    const pages = await everyPage("on");
    const c = await readers();
    for (const [key, page] of pages) {
      const [name, reader, path] = key.split(" ");
      const changed = reader === "ultra" && /^\/account(?:\?lang=fr)?$|^\/account\/billing/.test(path);
      if (!changed) {
        expect(page, key).toEqual(TODAY[key]);
        continue;
      }
      // The page with the seats' piece taken out is the page main drew.
      const res = await app.request(path, { headers: { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp(), cookie: c.ultra! } },
        withSeats(ENVS[name as EnvName](), "on"));
      const body = await res.text();
      const fr = path.includes("lang=fr");
      const row = fr
        ? '<dt>Sièges</dt><dd><a href="/account/seats">1 siège sur 5</a></dd>'
        : '<dt>Seats</dt><dd><a href="/account/seats">1 of 5 seats</a></dd>';
      const link = `<a href="/account/seats" class="btn">${fr ? "Sièges" : "Seats"}</a>`;
      const piece = path.startsWith("/account/billing") ? link : row;
      expect(body, key).toContain(piece);
      expect(body.split(piece), key).toHaveLength(2);
      expect({ ...page, body: await shortHash(body.replace(piece, "")) }, key).toEqual(TODAY[key]);
    }
    expect(emailOf("ultra")).toContain("@example.com");
  });
});
