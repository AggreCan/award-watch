// The landing page's Ultra card form (src/pages/landing.tsx UltraBox and
// ultraSubmit): its post to /interest with kind=ultra, kept as one row of the
// interest table with no filter and the plan's name as the label, answered
// with the card's thanks line as the landing page or, for public/interest.js,
// as the block alone; refused as the other kinds refuse a bad address, the
// honeypot and another site's page; refused outright with the switch off,
// when the card does not exist. Then every other reader of the table: the
// account's import passes the row over, the Email lists page offers no such
// list, the link off the lists names it for what it is, the privacy page says
// what it is for, and the nightly's count of alert sign-ups leaves it out.
// test/landing.test.ts holds the form's markup; test/accounts-announce.test.ts
// the Ultra message that reads these rows.
import { describe, expect, it } from "vitest";
import nightly from "../../.github/workflows/nightly.yml?raw";
import { importInterest, pendingInterest } from "../src/account/searches";
import { app } from "../src/index";
import { ULTRA_KIND, ULTRA_PARAMS } from "../src/pages/interest";
import { ACCOUNTS, DB, decode, get, nbsp, newEmail, offEnv, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);

const ultra = (email: string, o: { lang?: string; website?: string; headers?: Record<string, string>; env?: object; origin?: string | null } = {}) =>
  post("/interest", { kind: "ultra", lang: o.lang ?? "en", website: o.website ?? "", email }, { headers: o.headers, env: o.env, origin: o.origin });
const fragment = { "x-interest-fragment": "1" };

type Row = Record<string, unknown>;
const rows = async (email: string): Promise<Row[]> =>
  ((await DB.prepare("SELECT * FROM interest WHERE email = ? ORDER BY id").bind(email).all()).results ?? []) as Row[];

// The card's block in a page or a fragment.
const box = (html: string) => /<div class="lp-ultra" data-interest="">[\s\S]*?(?:<\/form><\/div>|<\/div><\/div>)/.exec(html)?.[0] ?? "(no block)";

describe("the Ultra card's post", () => {
  it("keeps the address as one row of kind ultra, no filter and the plan's name, and answers the landing page with the thanks line in the form's place", async () => {
    const res = await ultra("  Ultra.Reader@Example.CA ");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    const html = decode(await res.text());
    // The landing page, its card in the new state; no field left to fill on it.
    expect(html).toContain('<body class="lp">');
    expect(html).toContain('<div class="lp-plan lp-plan-ultra" id="ultra">');
    expect(box(html)).toBe(
      '<div class="lp-ultra" data-interest=""><div class="lp-ultra-done" role="status">' +
      '<p class="lp-ultra-thanks">We will write to you when Ultra opens.</p>' +
      '<p class="lp-ultra-noted">Address noted: ultra.reader@example.ca</p></div></div>',
    );
    expect(html).not.toContain('name="email"');
    // The page answers at /interest, so its language switch names "/" outright.
    expect(html).toContain('<a href="/?lang=fr" class="lang-toggle" rel="nofollow">Français</a>');
    const [row, ...more] = await rows("ultra.reader@example.ca");
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({
      kind: ULTRA_KIND, params: ULTRA_PARAMS, label: "Ultra", lang: "en", confirmed_at: null, unsubscribed_at: null, notice_at: null,
    });
    expect(ULTRA_KIND).toBe("ultra");
    expect(ULTRA_PARAMS).toBe("");
    expect(row.token).toMatch(/^[0-9a-f]{32}$/);
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("answers in French from a French form, with the same fixed label", async () => {
    const email = newEmail("ultra-fr");
    const res = await ultra(email, { lang: "fr" });
    expect(res.status).toBe(200);
    const html = nbsp(decode(await res.text()));
    expect(html).toContain('<html lang="fr">');
    expect(box(html)).toContain('<p class="lp-ultra-thanks">Nous vous écrirons à l’ouverture d’Ultra.</p>');
    expect(box(html)).toContain(`<p class="lp-ultra-noted">Adresse notée : ${email}</p>`);
    expect(html).toContain('<a href="/?lang=en" class="lang-toggle" rel="nofollow">English</a>');
    const [row] = await rows(email);
    expect(row).toMatchObject({ kind: "ultra", params: "", label: "Ultra", lang: "fr" });
  });

  it("answers the script with the card's block alone, which carries the form again on an error", async () => {
    const email = newEmail("ultra-script");
    const ok = await ultra(email, { headers: fragment });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("x-interest-fragment")).toBe("1");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const html = await ok.text();
    expect(html.startsWith('<div class="lp-ultra" data-interest="">')).toBe(true);
    expect(html).not.toContain("<html");
    expect(html).toBe(
      '<div class="lp-ultra" data-interest=""><div class="lp-ultra-done" role="status">' +
      `<p class="lp-ultra-thanks">We will write to you when Ultra opens.</p><p class="lp-ultra-noted">Address noted: ${email}</p></div></div>`,
    );
    expect(await rows(email)).toHaveLength(1);
    const fr = nbsp(await (await ultra(newEmail("ultra-script-fr"), { lang: "fr", headers: fragment })).text());
    expect(fr).toContain("Nous vous écrirons à l’ouverture d’Ultra.");
    const bad = await ultra("nope", { headers: fragment });
    expect(bad.status).toBe(400);
    expect(bad.headers.get("x-interest-fragment")).toBe("1");
    const again = await bad.text();
    expect(again.startsWith('<div class="lp-ultra" data-interest=""><p class="lp-ultra-error interest-error" role="alert">Enter a complete email address.</p>')).toBe(true);
    expect(again).toContain('<form method="post" action="/interest#ultra" class="lp-ultra-form" data-interest-form="">');
    expect(again).toContain('value="nope"');
  });

  it("answers a second post of the same address the same, and stores nothing new", async () => {
    const email = newEmail("ultra-twice");
    expect((await ultra(email)).status).toBe(200);
    const again = await ultra(` ${email.toUpperCase()} `, { headers: fragment });
    expect(again.status).toBe(200);
    expect(await again.text()).toContain("We will write to you when Ultra opens.");
    expect(await rows(email)).toHaveLength(1);
  });

  it("refuses the honeypot and a bad address with the lines the other forms use, keeping what was typed, and stores nothing", async () => {
    const bot = await ultra("bot.ultra@example.ca", { website: "http://spam.example" });
    expect(bot.status).toBe(400);
    const botPage = await bot.text();
    expect(box(botPage)).toContain('<p class="lp-ultra-error interest-error" role="alert">The form could not be sent. Try again.</p>');
    expect(await rows("bot.ultra@example.ca")).toHaveLength(0);
    for (const email of ["not-an-email", "a@b", "two@@example.ca", "dots..here@example.ca", `${"x".repeat(250)}@example.ca`, ""]) {
      const bad = await ultra(email);
      expect(bad.status, email).toBe(400);
      expect(bad.headers.get("cache-control"), email).toBe("no-store");
      const page = await bad.text();
      // The landing page again, the card's form back with its line and the address as typed.
      expect(page, email).toContain('<body class="lp">');
      const block = box(page);
      expect(block, email).toContain('<p class="lp-ultra-error interest-error" role="alert">Enter a complete email address.</p>');
      expect(block, email).toContain('name="email"');
    }
    expect(box(await (await ultra("two@@example.ca")).text())).toContain('value="two@@example.ca"');
    for (const email of ["not-an-email", "two@@example.ca", "dots..here@example.ca"]) expect(await rows(email), email).toHaveLength(0);
    const fr = nbsp(await (await ultra("nope", { lang: "fr" })).text());
    expect(fr).toContain("Entrez une adresse courriel complète.");
  });

  it("refuses a post from another site's page and a body that is not a form, as every interest post is refused", async () => {
    for (const origin of ["https://evil.example", "null"]) {
      const cross = await ultra("cross.ultra@example.ca", { origin });
      expect(cross.status, origin).toBe(403);
      expect(await cross.text()).toBe("The form could not be read.");
    }
    expect(await rows("cross.ultra@example.ca")).toHaveLength(0);
    // The site's own page, by its public address or the request's own, and a client that sends no Origin.
    for (const [origin, email] of [["https://awardwatch.ca", newEmail("own")], ["http://localhost", newEmail("local")], [null, newEmail("none")]] as const) {
      expect((await ultra(email, { origin })).status, String(origin)).toBe(200);
      expect(await rows(email), String(origin)).toHaveLength(1);
    }
    const json = await app.request("/interest", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.249" },
      body: JSON.stringify({ kind: "ultra", email: "json.ultra@example.ca" }),
    }, onEnv());
    expect(json.status).toBe(400);
    expect(await rows("json.ultra@example.ca")).toHaveLength(0);
  });

  it("is refused as unreadable with the switch off, when the card does not exist, and stores nothing", async () => {
    for (const headers of [{}, fragment]) {
      const res = await ultra("off.ultra@example.ca", { env: offEnv(), headers });
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("The form could not be read.");
    }
    expect(await rows("off.ultra@example.ca")).toHaveLength(0);
  });

  it("keeps what was typed and asks to try again when the database cannot take the row", async () => {
    const broken = onEnv({ DB: { prepare: () => { throw new Error("D1 is down"); } } });
    const res = await ultra("later.ultra@example.ca", { env: broken });
    expect(res.status).toBe(503);
    const block = box(await res.text());
    expect(block).toContain("The message could not be saved just now. Try again in a moment.");
    expect(block).toContain('value="later.ultra@example.ca"');
    const script = await ultra("later.ultra@example.ca", { env: broken, headers: fragment });
    expect(script.status).toBe(503);
    expect((await script.text()).startsWith('<div class="lp-ultra" data-interest="">')).toBe(true);
  });

  it("writes no em-dash in any answer, in either language", async () => {
    for (const lang of ["en", "fr"]) {
      for (const email of [newEmail(`dash-${lang}`), "nope"]) {
        for (const headers of [{}, fragment]) {
          expect(await (await ultra(email, { lang, headers })).text()).not.toContain(EM_DASH);
        }
      }
    }
  });
});

describe("the readers of the interest table", () => {
  it("leave the Ultra row out of the account's import: never offered, never saved, never marked confirmed", async () => {
    const email = newEmail("ultra-import");
    expect((await ultra(email)).status).toBe(200);
    expect((await post("/interest", { email, kind: "segment", params: "/segments/82", lang: "en", website: "" })).status).toBe(200);
    const cookie = await signIn(email);
    const id = await userId(email);
    const env = onEnv() as never;
    expect((await pendingInterest(env, email, id)).map((r) => r.kind)).toEqual(["segment"]);
    const page = decode(await (await get("/account/searches", { cookie })).text());
    expect(page).toContain("From Your Alert Requests");
    expect(page).not.toContain("Ultra: we will write");
    expect(await importInterest(env, { userId: id, email, plan: "free" })).toEqual({ imported: 1, left: 0 });
    const saved = (await ACCOUNTS.prepare("SELECT kind, params FROM saved_searches WHERE user_id = ?").bind(id).all()).results;
    expect(saved).toEqual([{ kind: "segment", params: "/segments/82" }]);
    const marked = await rows(email);
    expect(marked.map((r) => [r.kind, r.confirmed_at === null])).toEqual([["ultra", true], ["segment", false]]);
    // Nothing is left to offer, and the Ultra row stays for its message.
    expect(await pendingInterest(env, email, id)).toEqual([]);
    expect(await importInterest(env, { userId: id, email, plan: "free" })).toEqual({ imported: 0, left: 0 });
  });

  it("send an address with only the Ultra row to the account page after sign-in, not to the import", async () => {
    const email = newEmail("ultra-only");
    expect((await ultra(email)).status).toBe(200);
    expect((await post("/account/sign-in", { email })).status).toBe(200);
    const mail = await ACCOUNTS.prepare("SELECT text FROM sent_mail WHERE to_addr = ? ORDER BY id DESC LIMIT 1").bind(email).first<{ text: string }>();
    const code = /([0-9]{6})/.exec(mail!.text)![1];
    const res = await post("/account/check", { email, code, sent: "1" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account");
    expect(await pendingInterest(onEnv() as never, email, await userId(email))).toEqual([]);
  });

  it("offer no Ultra list on the Email lists page, whose chooser drops one posted", async () => {
    const page = await (await get("/alerts")).text();
    expect(page).not.toMatch(/value="ultra"/);
    expect(page).not.toContain("lp-ultra");
    const email = newEmail("lists-ultra");
    const res = await post("/interest", [["place", "lists"], ["lang", "en"], ["website", ""], ["national", "0"], ["list", "ultra"], ["email", email]]);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('<p class="interest-error" role="alert">Choose at least one list.</p>');
    expect(await rows(email)).toHaveLength(0);
  });

  it("name the Ultra row for what it is on the page that takes an address off the lists, and take it off with the rest", async () => {
    const email = newEmail("ultra-stop");
    expect((await post("/interest", { email, kind: "tenders", params: "/tenders", lang: "en", website: "" })).status).toBe(200);
    expect((await ultra(email)).status).toBe(200);
    const [, ultraRow] = await rows(email);
    const token = String(ultraRow.token);
    const en = decode(await (await get(`/interest/stop?t=${token}`)).text());
    expect(en).toContain('<ul class="account-list"><li>Every new tender notice</li><li>Ultra: we will write when it opens</li></ul>');
    const fr = nbsp(decode(await (await get(`/interest/stop?t=${token}&lang=fr`)).text()));
    expect(fr).toContain("<li>Ultra : nous écrirons à son ouverture</li>");
    expect((await post("/interest/stop", { t: token })).status).toBe(200);
    expect(await rows(email)).toEqual([]);
  });

  it("say on the privacy page, while the card exists, what an Ultra address is kept for", async () => {
    const on = decode(await (await get("/privacy", { env: onEnv() })).text());
    expect(on).toContain(
      "The Ultra card among the plans on the home page keeps an address the same way, with the plan's name in place of a filter. " +
      "That address gets one message when Ultra opens, with the same link to unsubscribe, and the row stores when it went.",
    );
    const fr = nbsp(decode(await (await get("/privacy?lang=fr", { env: onEnv() })).text()));
    expect(fr).toContain("Cette adresse reçoit un seul message à l’ouverture d’Ultra, avec le même lien de désabonnement");
    const off = await (await get("/privacy", { env: offEnv() })).text();
    expect(off).not.toContain("Ultra");
  });

  it("leave the Ultra rows out of the nightly run's count of alert sign-ups", async () => {
    const step = nightly.slice(nightly.indexOf("- name: Count the alert sign-ups"));
    const query = /--command "([^"]+)"/.exec(step)?.[1] ?? "";
    expect(query).toBe("SELECT COUNT(*) AS n, SUM(unsubscribed_at IS NULL) AS live FROM interest WHERE kind <> 'ultra'");
    const count = async () => (await DB.prepare(query).first<{ n: number; live: number }>())!;
    const before = await count();
    expect((await ultra(newEmail("uncounted"))).status).toBe(200);
    expect((await count()).n).toBe(before.n);
    expect((await post("/interest", { email: newEmail("counted"), kind: "tenders", params: "/tenders", lang: "en", website: "" })).status).toBe(200);
    expect((await count()).n).toBe(before.n + 1);
  });
});
