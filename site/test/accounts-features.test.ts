// Saved searches (with the import from the alerts form's table), API keys
// and the unmounted requireApiKey middleware, entitlements and plans, and
// deletion, against the local accounts database with the switch on.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { apiKeyOf, forgetKeys, requireApiKey } from "../src/account/api_keys";
import { RULES, allowed, lastKnownPlan, planFor, planFromRows, type EntitlementRow } from "../src/account/entitlements";
import { paymentSource } from "../src/account/payments";
import { sha256Hex } from "../src/account/secrets";
import { forgetSessions, planOfRequest } from "../src/account/session";
import type { AppEnv } from "../src/env";
import {
  ACCOUNTS, DB, MANUAL_GRANT_SQL, csrf, decode, get, grantPro, nbsp, newEmail, nextIp, onEnv, post, sessionCookie, signIn, useAccountsDb, userId,
} from "./accounts-helpers";

useAccountsDb();

const searches = async (email: string) =>
  ((await ACCOUNTS.prepare("SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at, id").bind(await userId(email)).all<Record<string, string>>()).results ?? []);

async function addInterest(email: string, kind: string, params: string, label: string): Promise<void> {
  await DB.prepare("INSERT INTO interest (email, kind, params, label, lang, created_at, token) VALUES (?, ?, ?, ?, 'en', ?, ?)")
    .bind(email, kind, params, label, new Date().toISOString(), "f".repeat(32)).run();
}

describe("saved searches", () => {
  it("are added from a page address, rebuilt and labelled by the site, never as pasted", async () => {
    const email = newEmail();
    const cookie = await signIn(email);
    const token = await csrf(cookie, "/account/searches");
    const res = await post("/account/searches", { csrf: token, url: "https://awardwatch.ca/tenders?segment=82&page=3&lang=fr&sort=published" }, { cookie });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account/searches?m=added");
    const [row] = await searches(email);
    expect(row).toMatchObject({
      kind: "tenders", params: "/tenders?segment=82", deliver: "off", lang: "en",
      label: "New tender notices matching UNSPSC segment: 82 Editorial and Design and Graphic and Fine Art Services",
    });
    // A path works too, and the same filter twice is noted, not stored twice.
    await post("/account/searches", { csrf: token, url: "/organizations/org-a000000001" }, { cookie });
    const dup = await post("/account/searches", { csrf: token, url: "http://localhost/organizations/org-a000000001" }, { cookie });
    expect(dup.headers.get("location")).toBe("/account/searches?m=exists");
    expect(await searches(email)).toHaveLength(2);
    const page = decode(await (await get("/account/searches?m=exists", { cookie })).text());
    expect(page).toContain("That search is already saved.");
    expect(page).toContain('<a href="/organizations/org-a000000001">When Exemplar Translation Services Inc. is named on a new award, contract or grant</a>');
    expect(page).toContain('<span class="panel-count">2 of 3</span>');
  });

  it("show each label in the page's language, whatever language it was saved in", async () => {
    const email = newEmail();
    const cookie = await signIn(email);
    await post("/account/searches", { csrf: await csrf(cookie, "/account/searches"), url: "/segments/82" }, { cookie });
    expect((await searches(email))[0].lang).toBe("en");
    const french = decode(await (await get("/account/searches?lang=fr", { cookie })).text()).replace(/[  ]/g, " ");
    expect(french).toContain("Nouveaux avis d’appel d’offres et d’attribution dans le segment 82 Services de rédaction, de design, de graphisme et de beaux-arts");
    expect(french).not.toContain("New tender notices and award notices in segment 82");
  });

  it("refuse an address on another site or a page with no filter", async () => {
    const email = newEmail();
    const cookie = await signIn(email);
    const token = await csrf(cookie, "/account/searches");
    for (const url of ["https://evil.example/tenders?segment=82", "/about", "javascript:alert(1)", "//evil.example/tenders"]) {
      const res = await post("/account/searches", { csrf: token, url }, { cookie });
      expect(res.status, url).toBe(400);
      expect(await res.text(), url).toContain("That address is not a page with a filter to save.");
    }
    expect(await searches(email)).toHaveLength(0);
  });

  it("stop at the plan's cap: 3 on Free, 25 on Pro", async () => {
    expect(RULES.free.saved_searches).toBe(3);
    expect(RULES.pro.saved_searches).toBe(25);
    const email = newEmail();
    const cookie = await signIn(email);
    const token = await csrf(cookie, "/account/searches");
    const urls = ["/tenders", "/expiring", "/segments/82", "/buyers/pwgsc-tpsgc"];
    const locations: (string | null)[] = [];
    for (const url of urls) locations.push((await post("/account/searches", { csrf: token, url }, { cookie })).headers.get("location"));
    expect(locations).toEqual(["/account/searches?m=added", "/account/searches?m=added", "/account/searches?m=added", "/account/searches?m=cap"]);
    expect(await searches(email)).toHaveLength(3);
    const full = await (await get("/account/searches?m=cap", { cookie })).text();
    expect(full).toContain("The Free plan keeps up to 3 saved searches.");
    expect(full).not.toContain('name="url"');
    await grantPro(email);
    expect((await post("/account/searches", { csrf: token, url: "/buyers/pwgsc-tpsgc" }, { cookie })).headers.get("location")).toBe("/account/searches?m=added");
    expect(await searches(email)).toHaveLength(4);
  });

  it("change delivery on Pro only, and are deleted by their owner only", async () => {
    const email = newEmail();
    const cookie = await signIn(email);
    const token = await csrf(cookie, "/account/searches");
    // A tender list: a kind the delivery job serves (a segment page is not one yet).
    await post("/account/searches", { csrf: token, url: "/tenders?segment=82" }, { cookie });
    const [row] = await searches(email);
    const free = await post(`/account/searches/${row.id}`, { csrf: token, deliver: "weekly" }, { cookie });
    expect(free.headers.get("location")).toBe("/account/searches?m=pro");
    expect((await searches(email))[0].deliver).toBe("off");
    expect((await post(`/account/searches/${row.id}`, { csrf: token, deliver: "hourly" }, { cookie })).status).toBe(400);
    await grantPro(email);
    expect((await post(`/account/searches/${row.id}`, { csrf: token, deliver: "weekly" }, { cookie })).headers.get("location")).toBe("/account/searches?m=changed");
    expect((await searches(email))[0].deliver).toBe("weekly");
    // Another user's post names the id and changes nothing.
    const intruder = await signIn(newEmail("intruder"));
    const theirs = await csrf(intruder, "/account/searches");
    await post(`/account/searches/${row.id}/delete`, { csrf: theirs }, { cookie: intruder });
    expect(await searches(email)).toHaveLength(1);
    expect((await post(`/account/searches/${row.id}/delete`, { csrf: token }, { cookie })).headers.get("location")).toBe("/account/searches?m=deleted");
    expect(await searches(email)).toHaveLength(0);
  });
});

describe("the alerts form's rows", () => {
  it("are offered after sign-in and added in one step, then marked confirmed", async () => {
    const email = newEmail("interest");
    await addInterest(email, "tenders", "/tenders?segment=82", "New tender notices matching UNSPSC segment: 82 Editorial and Design and Graphic and Fine Art Services");
    await addInterest(email, "buyer", "/buyers/pwgsc-tpsgc", "New award notices and contracts from Public Services and Procurement Canada");
    // An unsubscribed row and a row the form could not have written are left alone.
    await addInterest(email, "segment", "/segments/43", "segment 43");
    await DB.prepare("UPDATE interest SET unsubscribed_at = ? WHERE email = ? AND params = '/segments/43'").bind(new Date().toISOString(), email).run();
    await addInterest(email, "buyer", "/tenders", "mismatched");
    const { code } = await (async () => {
      await post("/account/sign-in", { email });
      const mail = await ACCOUNTS.prepare("SELECT text FROM sent_mail WHERE to_addr = ? ORDER BY id DESC LIMIT 1").bind(email).first<{ text: string }>();
      return { code: /([0-9]{6})/.exec(mail!.text)![1] };
    })();
    const res = await post("/account/check", { email, code, sent: "1" });
    expect(res.headers.get("location")).toBe("/account/searches");
    const cookie = sessionCookie(res);
    const page = decode(await (await get("/account/searches", { cookie })).text());
    expect(page).toContain("From Your Alert Requests");
    expect(page).toContain("New award notices and contracts from Public Services and Procurement Canada");
    expect(page).not.toContain("mismatched");
    expect(page).not.toContain("segment 43");
    const done = await post("/account/searches/import", { csrf: await csrf(cookie, "/account/searches") }, { cookie });
    expect(done.headers.get("location")).toBe("/account/searches?m=imported");
    expect((await searches(email)).map((s) => s.params).sort()).toEqual(["/buyers/pwgsc-tpsgc", "/tenders?segment=82"]);
    const rows = (await DB.prepare("SELECT params, confirmed_at FROM interest WHERE email = ? ORDER BY id").bind(email).all<{ params: string; confirmed_at: string | null }>()).results!;
    expect(rows.filter((r) => r.confirmed_at).map((r) => r.params).sort()).toEqual(["/buyers/pwgsc-tpsgc", "/tenders?segment=82"]);
    // Nothing left to offer.
    expect(await (await get("/account/searches", { cookie })).text()).not.toContain("From Your Alert Requests");
  });

  it("stop at the plan's cap and say some were left", async () => {
    const email = newEmail("many");
    for (const p of ["/segments/82", "/segments/43", "/tenders", "/expiring/3m"]) await addInterest(email, p.startsWith("/segments") ? "segment" : p === "/tenders" ? "tenders" : "expiring", p, `label ${p}`);
    const cookie = await signIn(email);
    const res = await post("/account/searches/import", { csrf: await csrf(cookie, "/account/searches") }, { cookie });
    expect(res.headers.get("location")).toBe("/account/searches?m=imported_some");
    expect(await searches(email)).toHaveLength(3);
    const confirmed = await DB.prepare("SELECT COUNT(*) AS n FROM interest WHERE email = ? AND confirmed_at IS NOT NULL").bind(email).first<{ n: number }>();
    expect(confirmed?.n).toBe(3);
  });

  it("include the lists the Email lists page saved together, each label rebuilt in the page's language", async () => {
    const email = newEmail("lists");
    const res = await post("/interest", [
      ["place", "lists"], ["lang", "en"], ["website", ""], ["list", "tenders"], ["list", "matching"], ["list", "expiring"],
      ["category", "GD"], ["category", "SRV"], ["segment", "82"], ["segment", "43"], ["province", "QC"], ["national", "0"], ["email", email],
    ], { env: onEnv() });
    expect(res.status).toBe(200);
    const filtered = "/tenders?category=GD&category=SRV&national=0&province=QC&segment=43&segment=82";
    const cookie = await signIn(email);
    const french = nbsp(decode(await (await get("/account/searches?lang=fr", { cookie })).text()));
    expect(french).toContain(
      "Nouveaux avis d’appel d’offres correspondant à Catégorie : Biens ou Services; " +
      "Segment UNSPSC : 43 Technologies de l’information, radiodiffusion et télécommunications ou 82 Services de rédaction, de design, de graphisme et de beaux-arts; " +
      "Province de livraison : Québec; Tout le Canada ou non indiqué : exclus",
    );
    expect(french).toContain("Contrats qui entrent dans la période de 3 mois pour tous les acheteurs et segments");
    const done = await post("/account/searches/import", { csrf: await csrf(cookie, "/account/searches") }, { cookie });
    expect(done.headers.get("location")).toBe("/account/searches?m=imported");
    const saved = await searches(email);
    expect(saved.map((s) => [s.kind, s.params]).sort()).toEqual([["expiring", "/expiring/3m"], ["tenders", "/tenders"], ["tenders", filtered]]);
    expect(saved.find((s) => s.params === filtered)?.label).toBe(
      "New tender notices matching Category: Goods or Services; " +
      "UNSPSC segment: 43 Information Technology Broadcasting and Telecommunications or 82 Editorial and Design and Graphic and Fine Art Services; " +
      "Province of delivery: Quebec; Canada-wide or not stated: left out",
    );
    const confirmed = await DB.prepare("SELECT COUNT(*) AS n FROM interest WHERE email = ? AND confirmed_at IS NOT NULL").bind(email).first<{ n: number }>();
    expect(confirmed?.n).toBe(3);
  });

  it("leave the alerts form working as before with the switch on", async () => {
    const email = newEmail("form");
    const res = await post("/interest", { email, kind: "segment", params: "/segments/82", lang: "en", website: "" }, { env: onEnv() });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    const row = await DB.prepare("SELECT kind, params, confirmed_at FROM interest WHERE email = ?").bind(email).first();
    expect(row).toEqual({ kind: "segment", params: "/segments/82", confirmed_at: null });
  });
});

describe("API keys", () => {
  it("need the Pro plan", async () => {
    const email = newEmail();
    const cookie = await signIn(email);
    const page = await (await get("/account/keys", { cookie })).text();
    expect(page).toContain("API keys come with the Pro plan.");
    expect(page).not.toContain('action="/account/keys"');
    const res = await post("/account/keys", { csrf: await csrf(cookie), name: "Sync" }, { cookie });
    expect(res.status).toBe(403);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?").bind(await userId(email)).first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("are shown once, stored as a hash with an 8-character prefix, listed and revoked", async () => {
    const email = newEmail();
    const cookie = await signIn(email);
    await grantPro(email);
    const token = await csrf(cookie);
    const res = await post("/account/keys", { csrf: token, name: "Nightly sync" }, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    const key = /<pre class="cite-block account-key">(aw_[0-9a-f]{8}_[0-9a-f]{64})<\/pre>/.exec(html)?.[1] ?? "";
    expect(key).not.toBe("");
    const row = await ACCOUNTS.prepare("SELECT * FROM api_keys WHERE user_id = ?").bind(await userId(email)).first<Record<string, string | null>>();
    expect(row?.key_hash).toBe(await sha256Hex(key));
    expect(row?.prefix).toBe(key.slice(3, 11));
    expect(JSON.stringify(row)).not.toContain(key.slice(12));
    const list = await (await get("/account/keys", { cookie })).text();
    expect(list).not.toContain(key);
    expect(list).toContain(`aw_${row!.prefix}`);
    expect(list).toContain("Nightly sync");
    const revoked = await post(`/account/keys/${row!.id}/revoke`, { csrf: token }, { cookie });
    expect(revoked.headers.get("location")).toBe("/account/keys?m=revoked");
    expect((await ACCOUNTS.prepare("SELECT revoked_at FROM api_keys WHERE id = ?").bind(row!.id).first<{ revoked_at: string | null }>())?.revoked_at).not.toBeNull();
    expect(await (await get("/account/keys?m=revoked", { cookie })).text()).toContain("The key is revoked.");
  });

  it("stop at 5 live keys", async () => {
    const email = newEmail();
    const cookie = await signIn(email);
    await grantPro(email);
    const token = await csrf(cookie);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post("/account/keys", { csrf: token, name: `k${i}` }, { cookie })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 409]);
  });
});

describe("requireApiKey", () => {
  // Mounted on a test app here; the site's own use, under /api/v1, is test/api-keyed.test.ts.
  const probe = new Hono<AppEnv>();
  probe.get("/probe", requireApiKey(), (c) => c.json({ holder: apiKeyOf(c) ?? null }));
  const call = (env: object, headers: Record<string, string> = {}) => probe.request("/probe", { headers }, env);

  async function proKey(): Promise<{ email: string; key: string }> {
    const email = newEmail("key");
    const cookie = await signIn(email);
    await grantPro(email);
    const html = await (await post("/account/keys", { csrf: await csrf(cookie), name: "probe" }, { cookie })).text();
    return { email, key: /(aw_[0-9a-f]{8}_[0-9a-f]{64})/.exec(html)![1] };
  }

  it("lets a live key of a Pro account through, by either header", async () => {
    const { email, key } = await proKey();
    const both: Record<string, string>[] = [{ authorization: `Bearer ${key}` }, { "x-api-key": key }];
    for (const headers of both) {
      const res = await call(onEnv(), headers);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { holder: { userId: string } }).holder.userId).toBe(await userId(email));
    }
    const used = await ACCOUNTS.prepare("SELECT last_used_at FROM api_keys WHERE prefix = ?").bind(key.slice(3, 11)).first<{ last_used_at: string | null }>();
    expect(used?.last_used_at).not.toBeNull();
  });

  it("refuses a missing, malformed, unknown or revoked key with a 401", async () => {
    const { key } = await proKey();
    const missing = await call(onEnv());
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toContain("Bearer");
    expect((await call(onEnv(), { authorization: "Bearer nope" })).status).toBe(401);
    // The right prefix with another secret.
    const unknown = `${key.slice(0, 12)}${key.slice(12).startsWith("0") ? "1" : "0"}${key.slice(13)}`;
    expect((await call(onEnv(), { authorization: `Bearer ${unknown}` })).status).toBe(401);
    await ACCOUNTS.prepare("UPDATE api_keys SET revoked_at = ? WHERE prefix = ?").bind(new Date().toISOString(), key.slice(3, 11)).run();
    expect((await call(onEnv(), { authorization: `Bearer ${key}` })).status).toBe(401);
  });

  it("stops a key at once when its account's entitlement is revoked (403)", async () => {
    const { email, key } = await proKey();
    expect((await call(onEnv(), { authorization: `Bearer ${key}` })).status).toBe(200);
    await ACCOUNTS.prepare("UPDATE entitlements SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), await userId(email)).run();
    const res = await call(onEnv(), { authorization: `Bearer ${key}` });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "The plan of the key's account does not include the API." });
  });

  it("when the database cannot be read, keeps a key this instance verified and answers 503 for any other", async () => {
    const { email, key } = await proKey();
    const broken = { prepare: () => { throw new Error("D1 down"); } } as unknown as D1Database;
    // Never checked here: a key of the right shape proves nothing (test/hardening.test.ts has the rest).
    forgetKeys();
    const unseen = await call(onEnv({ ACCOUNTS: broken }), { authorization: `Bearer ${key}` });
    expect(unseen.status).toBe(503);
    // Checked once with the database up: the last known answer, marked stale.
    expect((await call(onEnv(), { authorization: `Bearer ${key}` })).status).toBe(200);
    const res = await call(onEnv({ ACCOUNTS: broken }), { authorization: `Bearer ${key}` });
    expect(res.status).toBe(200);
    const holder = ((await res.json()) as { holder: { userId: string; stale?: boolean } }).holder;
    expect(holder.userId).toBe(await userId(email));
    expect(holder.stale).toBe(true);
  });

  it("gates nothing while the switch is off, and the site's own API asks for no key", async () => {
    const res = await call(onEnv({ ACCOUNTS_ENABLED: "false" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ holder: null });
    const api = await get("/api/stats", { env: onEnv() });
    expect(api.status).toBe(200);
  });
});

describe("entitlements", () => {
  const row = (id: string, plan: string, starts: string, ends: string | null, created: string, revoked: string | null = null): EntitlementRow =>
    ({ id, plan, starts_at: starts, ends_at: ends, created_at: created, revoked_at: revoked });
  const at = (iso: string) => new Date(iso);

  it("planFor: the latest recorded row whose window holds the moment wins; none means free", () => {
    const rows = [
      row("a", "pro", "2026-01-01T00:00:00.000Z", "2027-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      row("b", "free", "2026-06-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z", "2026-05-15T00:00:00.000Z"),
      row("c", "pro", "2026-09-01T00:00:00.000Z", null, "2026-08-20T00:00:00.000Z", "2026-08-21T00:00:00.000Z"),
    ];
    expect(planFromRows(rows, at("2025-12-31T00:00:00.000Z"))).toEqual({ plan: "free", until: null });
    expect(planFromRows(rows, at("2026-03-01T00:00:00.000Z"))).toEqual({ plan: "pro", until: "2027-01-01T00:00:00.000Z" });
    // b overlaps a and was recorded later: the downgrade holds for its window.
    expect(planFromRows(rows, at("2026-06-15T00:00:00.000Z"))).toEqual({ plan: "free", until: "2026-07-01T00:00:00.000Z" });
    expect(planFromRows(rows, at("2026-07-01T00:00:00.000Z"))).toEqual({ plan: "pro", until: "2027-01-01T00:00:00.000Z" });
    // c is revoked: it never counts.
    expect(planFromRows(rows, at("2027-02-01T00:00:00.000Z"))).toEqual({ plan: "free", until: null });
    // Two rows recorded in the same instant order by id; an unknown plan is ignored.
    const tie = [row("x", "free", "2026-01-01T00:00:00.000Z", null, "2026-01-01T00:00:00.000Z"), row("y", "pro", "2026-01-01T00:00:00.000Z", null, "2026-01-01T00:00:00.000Z"), row("z", "gold", "2026-01-01T00:00:00.000Z", null, "2027-01-01T00:00:00.000Z")];
    expect(planFromRows(tie, at("2026-02-01T00:00:00.000Z")).plan).toBe("pro");
  });

  it("allowed: features by plan", () => {
    expect(allowed({ plan: "free" }, "saved_searches", 2)).toBe(true);
    expect(allowed({ plan: "free" }, "saved_searches", 3)).toBe(false);
    expect(allowed({ plan: "pro" }, "saved_searches", 24)).toBe(true);
    expect(allowed({ plan: "pro" }, "saved_searches", 25)).toBe(false);
    for (const f of ["delivery", "api", "export_filtered", "intraday"] as const) {
      expect(allowed({ plan: "free" }, f)).toBe(false);
      expect(allowed({ plan: "pro" }, f)).toBe(true);
      expect(allowed(null, f)).toBe(false);
    }
  });

  it("the documented manual grant makes an account Pro, its revocation stops it at once, and the cache follows", async () => {
    const email = newEmail("grant");
    const cookie = await signIn(email);
    expect(await (await get("/account", { cookie })).text()).toContain("<dd>Free</dd>");
    await ACCOUNTS.prepare(MANUAL_GRANT_SQL).bind("2027-06-30T00:00:00.000Z", email).run();
    expect(await (await get("/account", { cookie })).text()).toContain("<dd>Pro, until 2027-06-30</dd>");
    const id = await userId(email);
    expect(await ACCOUNTS.prepare("SELECT plan, plan_until FROM users WHERE id = ?").bind(id).first()).toEqual({ plan: "pro", plan_until: "2027-06-30T00:00:00.000Z" });
    expect(await ACCOUNTS.prepare("SELECT source FROM entitlements WHERE user_id = ?").bind(id).first()).toEqual({ source: "manual" });
    await ACCOUNTS.prepare("UPDATE entitlements SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), id).run();
    expect(await (await get("/account", { cookie })).text()).toContain("<dd>Free</dd>");
    expect(await ACCOUNTS.prepare("SELECT plan FROM users WHERE id = ?").bind(id).first()).toEqual({ plan: "free" });
  });

  it("fail open to an outage: the last known plan answers while its end is ahead", async () => {
    const broken = { prepare: () => { throw new Error("D1 down"); } } as unknown as D1Database;
    const env = onEnv({ ACCOUNTS: broken }) as never;
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(await planFor(env, { id: "u", plan: "pro", plan_until: future })).toEqual({ plan: "pro", until: future, source: "last_known" });
    expect(await planFor(env, { id: "u", plan: "pro", plan_until: null })).toEqual({ plan: "pro", until: null, source: "last_known" });
    expect(lastKnownPlan({ id: "u", plan: "pro", plan_until: past }, new Date())).toEqual({ plan: "free", until: null });
  });

  it("keep a signed-in browser on its last known state through an outage, and show the 503 page for what needs the database", async () => {
    const email = newEmail("outage");
    const cookie = await signIn(email);
    expect((await get("/account", { cookie })).status).toBe(200);
    const broken = { prepare: () => { throw new Error("D1 down"); }, batch: () => { throw new Error("D1 down"); } } as unknown as D1Database;
    const page = await get("/tenders", { cookie, env: onEnv({ ACCOUNTS: broken }) });
    expect(page.status).toBe(200);
    expect(decode(await page.text())).toContain(`<span class="rail-label">${email}</span>`);
    const account = await get("/account", { cookie, env: onEnv({ ACCOUNTS: broken }) });
    expect(account.status).toBe(503);
    expect(await account.text()).toContain("The account service cannot be reached just now. Nothing was changed.");
    // A session the database says is revoked stops, whatever this isolate saw before.
    await ACCOUNTS.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), await userId(email)).run();
    expect((await get("/account", { cookie })).status).toBe(303);
    expect(await (await get("/tenders", { cookie, env: onEnv({ ACCOUNTS: broken }) })).text()).not.toContain(email);
  });

  it("take no payment without Stripe's keys: the source is the stub and /account/billing says so (accounts-billing.test.ts has the rest)", async () => {
    const source = paymentSource(onEnv() as never);
    expect(source.kind).toBe("stub");
    expect(source.available()).toBe(false);
    expect(await source.checkoutUrl({
      userId: "u", email: "u@example.com", interval: "monthly", lang: "en", customerId: null, successUrl: "/", cancelUrl: "/",
    })).toBeNull();
    expect(await source.readNotice(new Request("https://x.invalid/", { method: "POST", body: "{}" }))).toEqual({ ok: false });
    const cookie = await signIn(newEmail());
    expect(await (await get("/account/billing", { cookie })).text()).toContain("Paying for Pro is not available yet.");
    expect((await post("/account/billing", {}, { cookie })).status).toBe(404);
  });
});

describe("deletion", () => {
  it("asks for the box to be ticked", async () => {
    const email = newEmail();
    const cookie = await signIn(email);
    const res = await post("/account/delete", { csrf: await csrf(cookie) }, { cookie });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Tick the box to confirm.");
    expect((await ACCOUNTS.prepare("SELECT status FROM users WHERE email = ?").bind(email).first())).toEqual({ status: "active" });
  });

  it("removes searches, keys, codes and alert requests, signs out everywhere, and leaves a row that names no address", async () => {
    const email = newEmail("leaving");
    const cookie = await signIn(email);
    const other = await signIn(email);
    const id = await userId(email);
    await grantPro(email);
    const token = await csrf(cookie);
    await post("/account/searches", { csrf: token, url: "/segments/82" }, { cookie });
    await post("/account/keys", { csrf: token, name: "k" }, { cookie });
    await addInterest(email, "segment", "/segments/43", "label");
    const res = await post("/account/delete", { csrf: token, confirm: "yes" }, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().join("\n")).toMatch(/__Host-aw_session=;.*Max-Age=0/);
    const html = await res.text();
    expect(html).toContain("<h1>Account Deleted</h1>");
    expect(html).not.toContain(email);
    const user = await ACCOUNTS.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<Record<string, string | null>>();
    expect(user?.status).toBe("deleted");
    expect(user?.deleted_at).not.toBeNull();
    expect(user?.email).toMatch(/^deleted:[0-9a-f]{64}$/);
    expect(user?.email).not.toContain(await sha256Hex(email));
    expect(JSON.stringify(user)).not.toContain(email);
    for (const table of ["saved_searches", "api_keys"]) {
      expect(await ACCOUNTS.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(id).first(), table).toEqual({ n: 0 });
    }
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM magic_codes WHERE email = ? OR user_id = ?").bind(email, id).first()).toEqual({ n: 0 });
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL").bind(id).first()).toEqual({ n: 0 });
    expect(await DB.prepare("SELECT COUNT(*) AS n FROM interest WHERE email = ?").bind(email).first()).toEqual({ n: 0 });
    const audit = await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE user_id = ?").bind(id).all<{ event: string; detail: string | null }>();
    expect(audit.results?.map((a) => a.event)).toContain("deleted");
    for (const a of audit.results ?? []) expect(a.detail ?? "").not.toContain("@");
    for (const c of [cookie, other]) expect((await get("/account", { cookie: c })).status).toBe(303);
    // The address can sign up again, as a new account.
    await signIn(email);
    expect(await userId(email)).not.toBe(id);
  });
});

describe("the account pages", () => {
  it("are noindex and never cached", async () => {
    const cookie = await signIn(newEmail());
    for (const path of ["/account", "/account/searches", "/account/keys", "/account/delete", "/account/sign-in", "/account/check"]) {
      const res = await get(path, { cookie: path.endsWith("sign-in") ? undefined : cookie, ip: nextIp() });
      expect(res.status, path).toBe(200);
      expect(res.headers.get("cache-control"), path).toBe("no-store");
      expect(res.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
      expect(await res.text(), path).toContain('<meta name="robots" content="noindex"/>');
    }
  });
});

describe("planOfRequest", () => {
  // Any page can ask; this probe stands in for one.
  const probe = new Hono<AppEnv>();
  probe.get("/plan", async (c) => c.text(await planOfRequest(c)));
  const ask = async (env: object, cookie?: string) => (await probe.request("/plan", { headers: cookie ? { cookie } : {} }, env)).text();

  function trap() {
    const used: string[] = [];
    const db = new Proxy({}, { get(_t, prop) { used.push(String(prop)); throw new Error("read"); } }) as D1Database;
    return { used, db };
  }

  it("answers pro for a session whose plan is Pro, and gates intraday by it", async () => {
    const email = newEmail("plan");
    const cookie = await signIn(email);
    expect(await ask(onEnv(), cookie)).toBe("free");
    await grantPro(email);
    expect(await ask(onEnv(), cookie)).toBe("pro");
    expect(allowed({ plan: "pro" }, "intraday")).toBe(true);
    expect(allowed({ plan: "free" }, "intraday")).toBe(false);
  });

  it("answers free while the switch is off, reading nothing, even with a Pro session cookie", async () => {
    const email = newEmail("plan-off");
    const cookie = await signIn(email);
    await grantPro(email);
    const { used, db } = trap();
    expect(await ask(onEnv({ ACCOUNTS_ENABLED: "false", ACCOUNTS: db }), cookie)).toBe("free");
    expect(await ask({ ...onEnv({ ACCOUNTS: db }), ACCOUNTS_ENABLED: undefined }, cookie)).toBe("free");
    expect(used).toEqual([]);
  });

  it("answers free without a session cookie, or with one that does not stand, reading nothing without one", async () => {
    const { used, db } = trap();
    expect(await ask(onEnv({ ACCOUNTS: db }))).toBe("free");
    expect(await ask(onEnv({ ACCOUNTS: db }), "lang=fr")).toBe("free");
    expect(used).toEqual([]);
    expect(await ask(onEnv(), `__Host-aw_session=${"a".repeat(32)}.${"b".repeat(64)}`)).toBe("free");
    expect(await ask(onEnv(), "__Host-aw_session=junk")).toBe("free");
    const email = newEmail("plan-revoked");
    const cookie = await signIn(email);
    await grantPro(email);
    await ACCOUNTS.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?").bind(new Date().toISOString(), await userId(email)).run();
    expect(await ask(onEnv(), cookie)).toBe("free");
  });

  it("answers free on an accounts-database fault, never throwing, unless this instance verified the session before it", async () => {
    const email = newEmail("plan-fault");
    const cookie = await signIn(email);
    await grantPro(email);
    expect(await ask(onEnv(), cookie)).toBe("pro");
    const broken = { prepare: () => { throw new Error("D1 down"); }, batch: () => { throw new Error("D1 down"); } } as unknown as D1Database;
    // Verified before the outage: the last known plan, as readSession keeps it.
    expect(await ask(onEnv({ ACCOUNTS: broken }), cookie)).toBe("pro");
    // Nothing verified on this instance: the free view.
    forgetSessions();
    expect(await ask(onEnv({ ACCOUNTS: broken }), cookie)).toBe("free");
    const rejecting = { prepare: () => ({ bind: () => ({ first: () => Promise.reject(new Error("D1 down")) }) }) } as unknown as D1Database;
    expect(await ask(onEnv({ ACCOUNTS: rejecting }), cookie)).toBe("free");
  });
});
