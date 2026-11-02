// Sign-in by a code sent to the address, sessions and sign-out
// (src/account/signin.ts, session.ts, routes.tsx), against the local
// accounts database with the switch on and the log sender.
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { CODE_TRIES, CODES_PER_HOUR, codeHash } from "../src/account/signin";
import { sha256Hex } from "../src/account/secrets";
import { isLocalHost, senderFor } from "../src/account/sender";
import {
  ACCOUNTS, csrf, decode, get, lastMail, nbsp, newEmail, nextIp, onEnv, post, requestCode, sessionCookie, signIn, useAccountsDb, userId,
} from "./accounts-helpers";

useAccountsDb();

type CodeRow = { id: string; user_id: string | null; email: string; code_hash: string; link_hash: string; created_at: string; expires_at: string; used_at: string | null; attempts: number; ip_hash: string | null };

async function codeRows(email: string): Promise<CodeRow[]> {
  return ((await ACCOUNTS.prepare("SELECT * FROM magic_codes WHERE email = ? ORDER BY created_at").bind(email).all<CodeRow>()).results ?? []);
}

describe("the sign-in request", () => {
  it("stores one request with hashed code and link, 15 minutes, and sends both in the page's language", async () => {
    const email = newEmail();
    const res = await post("/account/sign-in", { email: `  ${email.toUpperCase()} `, lang: "en" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("aw_session="))).toBe(false);
    const html = await res.text();
    expect(html).toContain("<h1>Check Your Email</h1>");
    expect(html).toContain(`If <strong>${email}</strong> can receive mail`);
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    const mail = await lastMail(email);
    expect(mail?.subject).toBe("Your sign-in code for Award Watch");
    expect(mail?.subject).not.toMatch(/[0-9]{6}/);
    const { code, token } = { code: /([0-9]{6})/.exec(mail!.text)![1], token: /token=([0-9a-f.]+)/.exec(mail!.text)![1] };
    expect(mail?.text).toContain(`http://localhost/account/check?token=${token}`);
    const [row] = await codeRows(email);
    expect(row.user_id).toBeNull();
    expect(row.code_hash).toBe(await codeHash(row.id, code));
    expect(row.link_hash).toBe(await sha256Hex(token.split(".")[1]));
    expect(token.split(".")[0]).toBe(row.id);
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(15 * 60_000);
    expect(row.ip_hash).toBeNull();
    // Neither the code nor the link's secret is anywhere in the row.
    expect(JSON.stringify(row)).not.toContain(code);
    expect(JSON.stringify(row)).not.toContain(token.split(".")[1]);
  });

  it("keeps a daily-salted hash of the address, never the address, when the salt secret is set", async () => {
    const email = newEmail();
    await post("/account/sign-in", { email }, { ip: "203.0.113.77", env: onEnv({ VIEWS_SALT_KEY: "test-secret" }) });
    const [row] = await codeRows(email);
    expect(row.ip_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(row)).not.toContain("203.0.113.77");
  });

  it("answers the same page for an address with an account and one without", async () => {
    const known = newEmail("known");
    await signIn(known);
    const unknown = newEmail("unknown");
    const a = await post("/account/sign-in", { email: known });
    const b = await post("/account/sign-in", { email: unknown });
    expect(a.status).toBe(b.status);
    const strip = (html: string, email: string) => html.split(email).join("EMAIL");
    expect(strip(await a.text(), known)).toBe(strip(await b.text(), unknown));
    expect((await codeRows(unknown))[0].user_id).toBeNull();
    expect((await codeRows(known)).at(-1)?.user_id).toBe(await userId(known));
  });

  it("refuses a filled honeypot and an incomplete address, storing nothing", async () => {
    const email = newEmail();
    const trap = await post("/account/sign-in", { email, website: "spam.example" });
    expect(trap.status).toBe(400);
    expect(await trap.text()).toContain("The form could not be sent. Try again.");
    const bad = await post("/account/sign-in", { email: "not-an-address" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Enter a complete email address.");
    expect(await codeRows(email)).toHaveLength(0);
  });

  it("refuses a post from another site's page before reading it", async () => {
    const email = newEmail();
    for (const origin of ["https://evil.example", "null"]) {
      const res = await post("/account/sign-in", { email }, { origin });
      expect(res.status).toBe(403);
    }
    expect(await codeRows(email)).toHaveLength(0);
    // A client that sends no Origin (not a browser) is let through.
    expect((await post("/account/sign-in", { email }, { origin: null })).status).toBe(200);
  });

  it("allows 5 requests an hour per address, then says to wait", async () => {
    const email = newEmail();
    for (let i = 0; i < CODES_PER_HOUR; i++) expect((await post("/account/sign-in", { email })).status).toBe(200);
    const res = await post("/account/sign-in", { email });
    expect(res.status).toBe(429);
    expect(await res.text()).toContain("This address has asked for 5 codes in the last hour.");
    expect(await codeRows(email)).toHaveLength(CODES_PER_HOUR);
  });

  it("caps sign-in posts at 5 a minute per address with AUTH_LIMIT", async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post("/account/sign-in", { email: newEmail() }, { ip })).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    expect(bucketFor("POST", "/account/sign-in")).toBe("auth");
    expect(bucketFor("POST", "/account/check")).toBe("auth");
    expect(bucketFor("GET", "/account/sign-in")).toBe("page");
    expect(bucketFor("POST", "/account/searches")).toBe("page");
  });
});

describe("the sender", () => {
  it("uses the log outbox only on a local host with MAIL_SENDER=log, else the stub", () => {
    const env = onEnv() as never;
    expect(isLocalHost("http://localhost:8787/account/sign-in")).toBe(true);
    expect(isLocalHost("https://awardwatch.ca/account/sign-in")).toBe(false);
    expect(senderFor(env, "http://localhost/account/sign-in").kind).toBe("log");
    expect(senderFor(env, "https://awardwatch.ca/account/sign-in").kind).toBe("stub");
    expect(senderFor({ ...(env as object), MAIL_SENDER: undefined } as never, "http://localhost/").kind).toBe("stub");
    // A key alone does not invent a provider: the stub answers until one is written.
    expect(senderFor({ ...(env as object), MAIL_SENDER: undefined, MAIL_API_KEY: "k", MAIL_FROM: "a@b.c" } as never, "http://localhost/").kind).toBe("stub");
  });

  it("with the stub, records the attempt without the address and says the message could not be sent", async () => {
    const email = newEmail("stub");
    const before = await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM audit WHERE event = 'mail_not_sent'").first<{ n: number }>();
    const res = await post("/account/sign-in", { email }, { env: onEnv({ MAIL_SENDER: undefined }) });
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("The message could not be sent. Sign-in by email is not available yet; try again later.");
    expect(await lastMail(email)).toBeNull();
    const after = await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM audit WHERE event = 'mail_not_sent'").first<{ n: number }>();
    expect((after?.n ?? 0) - (before?.n ?? 0)).toBe(1);
    const audit = await ACCOUNTS.prepare("SELECT detail FROM audit ORDER BY id DESC LIMIT 20").all<{ detail: string | null }>();
    for (const row of audit.results ?? []) expect(row.detail ?? "").not.toContain("@");
  });
});

describe("the code", () => {
  it("signs in with the right code: creates the user, the session and the cookie", async () => {
    const email = newEmail();
    const { code } = await requestCode(email);
    const res = await post("/account/check", { email, code, sent: "1", lang: "fr" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account");
    const set = res.headers.getSetCookie().find((c) => c.startsWith("aw_session="))!;
    expect(set).toMatch(/^aw_session=[0-9a-f]{32}\.[0-9a-f]{64};/);
    expect(set).toContain("Max-Age=2592000");
    expect(set).toContain("Path=/");
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Secure");
    expect(set).toContain("SameSite=Lax");
    const user = await ACCOUNTS.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<Record<string, string>>();
    expect(user).toMatchObject({ status: "active", plan: "free", lang: "fr" });
    const [, id, secret] = /^aw_session=([0-9a-f]{32})\.([0-9a-f]{64})/.exec(set)!;
    const session = await ACCOUNTS.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<Record<string, string | null>>();
    expect(session?.user_id).toBe(user!.id);
    expect(session?.token_hash).toBe(await sha256Hex(secret));
    expect(JSON.stringify(session)).not.toContain(secret);
    expect(Date.parse(session!.expires_at!) - Date.parse(session!.created_at!)).toBe(30 * 86_400_000);
    // The request now belongs to the user, and is used.
    const [row] = await codeRows(email);
    expect(row.user_id).toBe(user!.id);
    expect(row.used_at).not.toBeNull();
    // The cookie opens the account page.
    const page = await get("/account", { cookie: sessionCookie(res) });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`Signed in as ${email}.`);
  });

  it("refuses a wrong code and counts it", async () => {
    const email = newEmail();
    const { code } = await requestCode(email);
    const wrong = code === "000000" ? "111111" : "000000";
    const res = await post("/account/check", { email, code: wrong, sent: "1" });
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await res.text()).toContain("That code does not match. Check the message and try again.");
    expect((await codeRows(email))[0].attempts).toBe(1);
    // The right code still works afterwards.
    expect((await post("/account/check", { email, code, sent: "1" })).status).toBe(303);
  });

  it("refuses an expired code", async () => {
    const email = newEmail();
    const { code } = await requestCode(email);
    await ACCOUNTS.prepare("UPDATE magic_codes SET expires_at = ? WHERE email = ?").bind(new Date(Date.now() - 1000).toISOString(), email).run();
    const res = await post("/account/check", { email, code, sent: "1" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("This code or link has expired or was already used. Ask for a new one.");
    expect(sessionCookie(res)).toBe("");
  });

  it("refuses a code used once already, and every other open code of the address with it", async () => {
    const email = newEmail();
    const first = await requestCode(email);
    const second = await requestCode(email);
    expect((await post("/account/check", { email, code: second.code, sent: "1" })).status).toBe(303);
    for (const code of [second.code, first.code]) {
      const res = await post("/account/check", { email, code, sent: "1" });
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("has expired or was already used");
    }
  });

  it("locks a request after 5 wrong codes, so even the right one then fails", async () => {
    const email = newEmail();
    const { code } = await requestCode(email);
    const wrong = code === "123456" ? "654321" : "123456";
    const texts: string[] = [];
    for (let i = 0; i < CODE_TRIES; i++) texts.push(await (await post("/account/check", { email, code: wrong, sent: "1" })).text());
    expect(texts[3]).toContain("That code does not match.");
    expect(texts[4]).toContain("Too many wrong codes. Ask for a new one.");
    const res = await post("/account/check", { email, code, sent: "1" });
    expect(res.status).toBe(400);
    expect(sessionCookie(res)).toBe("");
    expect((await codeRows(email))[0].attempts).toBe(CODE_TRIES);
  });

  it("takes a code typed on the bare form with the address", async () => {
    const email = newEmail();
    const form = await (await get("/account/check")).text();
    expect(form).toContain("<h1>Enter Your Code</h1>");
    expect(form).toContain('name="email" type="email"');
    const { code } = await requestCode(email);
    expect((await post("/account/check", { email, code })).status).toBe(303);
  });
});

describe("the link", () => {
  it("shows a button on GET and uses nothing; the POST signs in once", async () => {
    const email = newEmail();
    const { token } = await requestCode(email);
    const page = await get(`/account/check?token=${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.getSetCookie().some((c) => c.startsWith("aw_session="))).toBe(false);
    expect(await page.text()).toContain(`<input type="hidden" name="token" value="${token}"/>`);
    expect((await codeRows(email))[0].used_at).toBeNull();
    const res = await post("/account/check", { token });
    expect(res.status).toBe(303);
    expect(sessionCookie(res)).toMatch(/^aw_session=/);
    const again = await post("/account/check", { token });
    expect(again.status).toBe(400);
    expect(await again.text()).toContain("has expired or was already used");
  });

  it("refuses a link whose secret is wrong and counts the try", async () => {
    const email = newEmail();
    const { token } = await requestCode(email);
    const forged = `${token.split(".")[0]}.${"0".repeat(64)}`;
    const res = await post("/account/check", { token: forged });
    expect(res.status).toBe(400);
    expect((await codeRows(email))[0].attempts).toBe(1);
    expect((await get("/account/check?token=junk")).status).toBe(400);
  });
});

describe("sessions", () => {
  it("send a page without a session to the sign-in form", async () => {
    for (const path of ["/account", "/account/searches", "/account/keys", "/account/delete"]) {
      const res = await get(path);
      expect(res.status, path).toBe(303);
      expect(res.headers.get("location"), path).toBe("/account/sign-in");
    }
    const forged = await get("/account", { cookie: `aw_session=${"a".repeat(32)}.${"b".repeat(64)}` });
    expect(forged.status).toBe(303);
    expect(forged.headers.getSetCookie().join("\n")).toMatch(/aw_session=;.*Max-Age=0/);
  });

  it("end at their expiry or revocation, and extend on use", async () => {
    const email = newEmail();
    const cookie = await signIn(email);
    const id = /aw_session=([0-9a-f]{32})/.exec(cookie)![1];
    // Last used two hours ago: the visit extends the session and re-sends the cookie.
    const twoHours = new Date(Date.now() - 2 * 3_600_000).toISOString();
    await ACCOUNTS.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?")
      .bind(twoHours, new Date(Date.now() + 86_400_000).toISOString(), id).run();
    const res = await get("/account", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().find((c) => c.startsWith("aw_session="))).toContain("Max-Age=2592000");
    const row = await ACCOUNTS.prepare("SELECT expires_at FROM sessions WHERE id = ?").bind(id).first<{ expires_at: string }>();
    expect(Date.parse(row!.expires_at) - Date.now()).toBeGreaterThan(29 * 86_400_000);
    // Expired.
    await ACCOUNTS.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(new Date(Date.now() - 1000).toISOString(), id).run();
    expect((await get("/account", { cookie })).status).toBe(303);
    // A fresh one, revoked.
    const other = await signIn(email);
    await ACCOUNTS.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), /aw_session=([0-9a-f]{32})/.exec(other)![1]).run();
    expect((await get("/account", { cookie: other })).status).toBe(303);
  });

  it("sign out on this browser, or everywhere", async () => {
    const email = newEmail();
    const a = await signIn(email);
    const b = await signIn(email);
    const c = await signIn(email);
    const one = await post("/account/sign-out", { csrf: await csrf(a) }, { cookie: a });
    expect(one.status).toBe(303);
    expect(one.headers.get("location")).toBe("/account/sign-in?m=out");
    expect(one.headers.getSetCookie().join("\n")).toMatch(/aw_session=;.*Max-Age=0/);
    expect((await get("/account", { cookie: a })).status).toBe(303);
    expect((await get("/account", { cookie: b })).status).toBe(200);
    const all = await post("/account/sign-out", { csrf: await csrf(b), scope: "all" }, { cookie: b });
    expect(all.headers.get("location")).toBe("/account/sign-in?m=out_all");
    expect((await get("/account", { cookie: b })).status).toBe(303);
    expect((await get("/account", { cookie: c })).status).toBe(303);
    const live = await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL").bind(await userId(email)).first<{ n: number }>();
    expect(live?.n).toBe(0);
    expect(nbsp(await (await get("/account/sign-in?m=out_all")).text())).toContain("Every browser is signed out.");
  });

  it("refuse a signed-in post without the page's CSRF value or from another site", async () => {
    const cookie = await signIn(newEmail());
    expect((await post("/account/sign-out", {}, { cookie })).status).toBe(403);
    expect((await post("/account/sign-out", { csrf: "0".repeat(32) }, { cookie })).status).toBe(403);
    expect((await post("/account/sign-out", { csrf: await csrf(cookie) }, { cookie, origin: "https://evil.example" })).status).toBe(403);
    expect((await get("/account", { cookie })).status).toBe(200);
  });

  it("show the signed-in address in the rail of every page, never stored by a shared cache", async () => {
    const email = newEmail();
    const cookie = await signIn(email);
    const res = await get("/tenders", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const html = decode(await res.text());
    expect(html).toContain(`<a class="rail-item rail-account" href="/account"><span class="rail-label">${email}</span></a>`);
    const out = await get("/tenders");
    expect(out.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await out.text()).toContain('<a class="rail-item rail-account" href="/account/sign-in"><span class="rail-label">Sign in</span></a>');
  });

  it("send a signed-in visitor from the sign-in form to the account", async () => {
    const cookie = await signIn(newEmail());
    const res = await get("/account/sign-in", { cookie });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account");
  });
});

describe("the account pages in French", () => {
  it("carry no English and no em-dash", async () => {
    const cookie = await signIn(newEmail());
    for (const path of ["/account/sign-in?lang=fr", "/account/check?lang=fr", "/account?lang=fr", "/account/searches?lang=fr", "/account/keys?lang=fr", "/account/delete?lang=fr"]) {
      const html = nbsp(await (await get(path, { cookie: path.startsWith("/account/sign-in") || path.startsWith("/account/check") ? undefined : cookie })).text());
      expect(html, path).toContain('<html lang="fr">');
      for (const english of ["Sign In", "Saved Searches", "API Keys", "Your Account", "Delete the Account", "Enter Your Code"]) {
        expect(html, `${path}: ${english}`).not.toContain(`<h1>${english}</h1>`);
      }
      expect(html, path).not.toContain(String.fromCharCode(0x2014));
      const visible = html.replace(/<script type="application\/(?:ld\+)?json"[^>]*>[\s\S]*?<\/script>/g, "").replace(/ pattern="[^"]*"/g, "");
      expect(visible, path).not.toMatch(/\{\w+\}/);
    }
    const french = nbsp(await (await get("/account/sign-in?lang=fr")).text());
    expect(french).toContain("<h1>Connexion</h1>");
    expect(french).toContain("Envoyer le code");
  });

  it("send the message in the language of the page", async () => {
    const email = newEmail();
    await post("/account/sign-in", { email, lang: "fr" });
    const mail = await lastMail(email);
    expect(mail?.lang).toBe("fr");
    expect(nbsp(mail!.text)).toMatch(/^Votre code de connexion : [0-9]{6}/);
    expect(mail?.text).toMatch(/token=[0-9a-f.]+&lang=fr/);
    expect(mail?.html).not.toContain("<script");
  });
});

// The app answers the request URL it was given; a request to the site's own
// host goes to the stub even with MAIL_SENDER=log.
describe("a request to the site's host", () => {
  it("never reaches the log outbox", async () => {
    const email = newEmail("prod");
    const res = await app.request("https://awardwatch.ca/account/sign-in", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp(), origin: "https://awardwatch.ca" },
      body: new URLSearchParams({ email }).toString(),
    }, onEnv());
    expect(res.status).toBe(503);
    expect(await lastMail(email)).toBeNull();
  });
});
