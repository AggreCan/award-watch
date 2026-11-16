// With no seat row, nothing any reader sees depends on the seats table
// (docs/accounts.md, Seats): every public page signed out, and every public
// and account page a signed-in Free, Pro and Ultra account sees, is byte for
// byte the same with the table present and empty and with it absent (the
// database before the operator applies the schema). No seat row is written in
// this file; test/seats.test.ts has the seats themselves.
import { afterEach, expect, it, vi } from "vitest";
import { app } from "../src/index";
import { ACCOUNTS, grantPro, grantUltra, newEmail, nextIp, onEnv, signIn, useAccountsDb, withoutSeats } from "./accounts-helpers";

useAccountsDb();

afterEach(() => {
  vi.restoreAllMocks();
});

const PUBLIC = [
  "/", "/?lang=fr", "/pro", "/pro?lang=fr", "/terms", "/terms?lang=fr", "/privacy", "/privacy?lang=fr", "/tenders", "/tenders/same-day",
  "/expiring/3m", "/data", "/organizations/org-a000000001",
];
const ACCOUNT_PAGES = [
  "/account", "/account?lang=fr", "/account/billing", "/account/billing?lang=fr", "/account/searches", "/account/watches", "/account/keys",
  "/account/api", "/account/matches", "/account/organization", "/account/views", "/account/dashboard", "/account/bug", "/account/delete",
];

// A page as a reader gets it: its status, its caching and every byte of its body.
async function page(path: string, cookie?: string) {
  const headers: Record<string, string> = { "sec-fetch-mode": "navigate", "cf-connecting-ip": nextIp() };
  if (cookie) headers.cookie = cookie;
  const res = await app.request(path, { headers }, onEnv());
  return { status: res.status, cache: res.headers.get("cache-control"), body: await res.text() };
}

it("reads every page byte for byte the same with the seats table present and empty and with it absent", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const free = await signIn(newEmail("same-free"));
  const proEmail = newEmail("same-pro");
  const pro = await signIn(proEmail);
  await grantPro(proEmail);
  const ultraEmail = newEmail("same-ultra");
  const ultra = await signIn(ultraEmail);
  await grantUltra(ultraEmail);
  expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM seats").first()).toEqual({ n: 0 });
  const readers: [string, string | undefined, string[]][] = [
    ["signed out", undefined, PUBLIC], ["free", free, [...PUBLIC, ...ACCOUNT_PAGES]], ["pro", pro, [...PUBLIC, ...ACCOUNT_PAGES]],
    ["ultra", ultra, [...PUBLIC, ...ACCOUNT_PAGES]],
  ];
  // The first read of each account brings its cached plan up to date; the pages held are the ones after it.
  for (const [, cookie] of readers) if (cookie) await page("/account", cookie);
  const seen = new Map<string, Awaited<ReturnType<typeof page>>>();
  for (const [who, cookie, paths] of readers) for (const path of paths) seen.set(`${who} ${path}`, await page(path, cookie));
  // The plan reaches the pages it should, so a plan read that fell to Free would show here.
  expect(seen.get("ultra /account")?.body).toContain("<dd>Ultra, no end date</dd>");
  expect(seen.get("pro /account")?.body).toContain("<dd>Pro, no end date</dd>");
  await withoutSeats(async () => {
    for (const [who, cookie, paths] of readers) {
      for (const path of paths) expect(await page(path, cookie), `${who} ${path}`).toEqual(seen.get(`${who} ${path}`));
    }
  });
  for (const [key, p] of seen) expect(p.status, key).toBeLessThan(500);
});
