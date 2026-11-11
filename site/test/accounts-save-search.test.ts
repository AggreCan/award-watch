// Save this search (src/account/search_control.tsx): the control on a tender
// list, a list of contracts ending and a segment page, for a signed-in reader
// only, and the press, which is the searches page's own Add a Search post
// (routes.tsx POST /account/searches) with next, the page to return to. On the
// tender list and a window the control is the toolbar's last row and its
// fields ride in a form of their own after the toolbar; under the head of a
// segment page and the contracts ending overview it is one line. An
// organization's and a buyer's pages keep Follow alone. The saved
// state, the cap in figures for Free (the searches page's gate note) and in
// a line of its own for Pro, one search a filter, the refusals, the return
// address, both languages, and nothing at all signed out, with the switch off
// or when the accounts database cannot be read. Every expected line is written
// out here, never read back from the code under test.
import { describe, expect, it } from "vitest";
import tendersJs from "../public/tenders.js?raw";
import { SAVE_FORM_ID } from "../src/account/search_control";
import { ACCOUNTS, csrf, decode, get, grantPro, nbsp, newEmail, offEnv, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const ORG = "org-a000000001";
const BUYER = "pwgsc-tpsgc";

// The tender list with two filters and an order, which a saved search leaves out.
const LIST = "/tenders?segment=82&province=BC&sort=published";
const LIST_PARAMS = "/tenders?province=BC&segment=82";
// The saved state's line, beside it in both places.
const MANAGE = '<span class="muted small" data-save="saved"><a href="/account/searches">Manage your saved searches</a></span>';
const LIST_LABEL = "New tender notices matching UNSPSC segment: 82 Editorial and Design and Graphic and Fine Art Services; " +
  "Province of delivery: British Columbia";

const text = (html: string) => nbsp(decode(html)).replace(/’/g, "'");
const html = async (path: string, cookie?: string, env?: object) => (await get(path, { cookie, env })).text();
const primaries = (page: string) => page.match(/class="[^"]*\bbtn-primary\b[^"]*"/g) ?? [];

// The control's own markup: the toolbar's row, or the line under the head.
const rowOf = (page: string) => /<div class="toolbar-row save-search" data-save-search="">[\s\S]*?<\/div>(?:<\/div>)?(?=<\/form>)/.exec(page)?.[0] ?? "";
const lineOf = (page: string) => /<(form|div) (?:method="post" action="\/account\/searches" )?class="save-search">[\s\S]*?<\/\1>/.exec(page)?.[0] ?? "";

// The hidden fields a press posts, as the browser sends them.
function fieldsOf(page: string): Record<string, string> {
  const form = /<form method="post" action="\/account\/searches"[^>]*>([\s\S]*?)<\/form>/.exec(page)?.[1] ?? "";
  return Object.fromEntries([...form.matchAll(/<input type="hidden" name="([a-z]+)" value="([^"]*)"\/>/g)].map((m) => [m[1], decode(m[2])]));
}

type Row = { kind: string; params: string; label: string; lang: string; deliver: string };
const rows = async (email: string) =>
  ((await ACCOUNTS.prepare("SELECT kind, params, label, lang, deliver FROM saved_searches WHERE user_id = ? ORDER BY created_at, id")
    .bind(await userId(email)).all<Row>()).results ?? []);
const added = async (email: string) =>
  ((await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = 'search_added' ORDER BY id").bind(await userId(email))
    .all<{ detail: string }>()).results ?? []).map((r) => r.detail);

// Searches stored straight into the table, so a test starts at the figure it means.
async function hold(email: string, n: number): Promise<void> {
  const id = await userId(email);
  for (let i = 0; i < n; i++) {
    await ACCOUNTS.prepare("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'segment', ?, ?, 'en', ?, 'off')")
      .bind(crypto.randomUUID(), id, `/segments/${String(10 + i)}`, `Segment ${10 + i}`, new Date().toISOString()).run();
  }
}

const press = (fields: Record<string, string>, cookie: string, o: { origin?: string } = {}) => post("/account/searches", fields, { cookie, ...o });

describe("the control", () => {
  it("is the tender list's last toolbar row, flat, its fields in a form of their own after the toolbar", async () => {
    const email = newEmail("save-list");
    const cookie = await signIn(email);
    const page = await html(LIST, cookie);
    expect(rowOf(page)).toBe(
      '<div class="toolbar-row save-search" data-save-search="">' +
      '<button type="submit" form="save-search" class="btn" data-save="new">Save this search</button></div>',
    );
    // Inside the filters' form, after its chips; the fields' form follows the toolbar.
    expect(page).toContain(`${rowOf(page)}</form><form method="post" action="/account/searches" id="save-search" class="save-search-form">`);
    expect(fieldsOf(page)).toEqual({ csrf: await csrf(cookie), lang: "en", url: LIST, next: LIST });
    // Apply stays the list's one filled button.
    expect(primaries(page)).toEqual(['class="btn btn-primary"']);
    expect(page).toContain('class="btn btn-primary" id="tender-apply"');
  });

  it("is a window of contracts ending's last toolbar row, its address the request's own", async () => {
    const cookie = await signIn(newEmail("save-window"));
    const path = "/expiring/3m?segment=82&page=1";
    const page = await html(path, cookie);
    expect(rowOf(page)).toBe(
      '<div class="toolbar-row save-search" data-save-search="">' +
      '<button type="submit" form="save-search" class="btn" data-save="new">Save this search</button></div>',
    );
    expect(fieldsOf(page)).toMatchObject({ url: path, next: path });
    expect(primaries(page)).toHaveLength(1);
  });

  it("is one line under the head of a segment and the contracts ending overview, with what it saves", async () => {
    const cookie = await signIn(newEmail("save-line"));
    const token = await csrf(cookie);
    const cases: [string, string, string][] = [
      ["/segments/82", "/segments/82", "New tender notices and award notices in segment 82 Editorial and Design and Graphic and Fine Art Services"],
      ["/expiring", "/expiring", "Contracts now within 3 months of their end for every buyer and segment"],
    ];
    for (const [path, url, label] of cases) {
      const page = await html(path, cookie);
      expect(text(lineOf(page)), path).toBe(
        '<form method="post" action="/account/searches" class="save-search">' +
        `<input type="hidden" name="csrf" value="${token}"/><input type="hidden" name="lang" value="en"/>` +
        `<input type="hidden" name="url" value="${url}"/><input type="hidden" name="next" value="${path}"/>` +
        `<button type="submit" class="btn">Save this search</button><span class="muted small">${label}</span></form>`,
      );
      // In the head's text, under the lead.
      const head = /<header class="page-head">[\s\S]*?<\/header>/.exec(page)?.[0] ?? "";
      expect(head, path).toContain(lineOf(page));
      // Each page keeps its own filled button (a segment's open notices) or none.
      expect(primaries(page).length, path).toBeLessThanOrEqual(1);
      expect(page, path).not.toContain('class="btn btn-primary">Save this search');
      expect(page, path).not.toContain(EM_DASH);
      expect(page, path).not.toContain(EN_DASH);
    }
  });

  it("is left off an organization's and a buyer's page, which keep Follow as their one control", async () => {
    const email = newEmail("save-follow");
    const cookie = await signIn(email);
    // Signed in, on Free and on Pro, and with the page's search saved by pasting its address.
    await press({ csrf: await csrf(cookie), url: `/buyers/${BUYER}` }, cookie);
    expect((await rows(email)).map((r) => r.params)).toEqual([`/buyers/${BUYER}`]);
    for (const plan of ["free", "pro"]) {
      if (plan === "pro") await grantPro(email);
      for (const path of [`/organizations/${ORG}`, `/buyers/${BUYER}`, `/organizations/${ORG}?lang=fr`, `/buyers/${BUYER}?lang=fr`]) {
        const page = await html(path, cookie);
        expect(page, `${plan} ${path}`).toContain('class="watch-control"');
        expect(page, `${plan} ${path}`).not.toContain("save-search");
        expect(page, `${plan} ${path}`).not.toContain('action="/account/searches"');
        expect(page, `${plan} ${path}`).not.toMatch(/Save this search|Enregistrer cette recherche|Search saved|Recherche enregistrée/);
      }
    }
    expect(await html(`/organizations/${ORG}`, cookie)).toContain('<button type="submit" class="btn btn-primary">Follow</button>');
  });

  it("keeps the page private: it carries the session's CSRF value", async () => {
    const cookie = await signIn(newEmail("save-private"));
    for (const path of [LIST, "/segments/82"]) {
      const res = await get(path, { cookie });
      expect(res.headers.get("cache-control"), path).toBe("private, no-store");
    }
  });

  it("shows nothing to a reader not signed in, with the switch off, or when the accounts database cannot be read", async () => {
    const email = newEmail("save-none");
    const cookie = await signIn(email);
    const pages = [LIST, "/expiring/3m?segment=82", "/expiring", "/segments/82"];
    for (const path of pages) {
      for (const [what, page] of [
        ["signed out", await html(path)],
        ["switch off", await html(path, cookie, offEnv())],
        ["switch off, signed out", await html(path, undefined, offEnv())],
      ] as const) {
        expect(page, `${path} ${what}`).not.toContain("save-search");
        expect(page, `${path} ${what}`).not.toContain('action="/account/searches"');
      }
    }
    // The database down: the shell keeps the session this browser had, the control is left out.
    await html(LIST, cookie);
    const down = { prepare: () => { throw new Error("D1 down"); }, batch: () => { throw new Error("D1 down"); } } as unknown as D1Database;
    const outage = await get(LIST, { cookie, env: onEnv({ ACCOUNTS: down }) });
    expect(outage.status).toBe(200);
    const body = decode(await outage.text());
    expect(body).toContain(`<span class="rail-label">${email}</span>`);
    expect(body).not.toContain("save-search");
    // The session read, the control's own statement failing: the page stands without it.
    const failing = new Proxy(ACCOUNTS, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (sql.includes("EXISTS (SELECT 1 FROM saved_searches")) throw new Error("D1 down");
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    for (const path of [LIST, "/segments/82"]) {
      const res = await get(path, { cookie, env: onEnv({ ACCOUNTS: failing }) });
      expect(res.status, path).toBe(200);
      const page = decode(await res.text());
      expect(page, path).toContain(`<span class="rail-label">${email}</span>`);
      expect(page, path).not.toContain("save-search");
    }
  });
});

describe("a press", () => {
  it("saves the tender list's filter once, returns to the same view, which then reads saved", async () => {
    const email = newEmail("save-press");
    const cookie = await signIn(email);
    const fields = fieldsOf(await html(LIST, cookie));
    const res = await press(fields, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(LIST);
    expect(await rows(email)).toEqual([{ kind: "tenders", params: LIST_PARAMS, label: LIST_LABEL, lang: "en", deliver: "off" }]);
    expect(await added(email)).toEqual(["tenders on its page"]);
    // Back on the page: the saved state and its line, both leading to the saved searches; the button waits hidden for tenders.js.
    const back = await html(LIST, cookie);
    expect(rowOf(back)).toBe(
      '<div class="toolbar-row save-search" data-save-search="">' +
      '<a href="/account/searches" class="btn watch-on" data-save="saved">Search saved</a>' + MANAGE +
      '<button type="submit" form="save-search" class="btn" data-save="new" hidden="">Save this search</button></div>',
    );
    expect(primaries(back)).toEqual(['class="btn btn-primary"']);
    // The same filter written another way, or in another order, is the same saved search.
    expect(rowOf(await html("/tenders?province=BC&segment=82&closing=7", cookie))).toContain("Search saved");
    expect(rowOf(await html("/tenders?segment=82", cookie))).not.toContain("Search saved");
    // A second press saves nothing more and answers the same.
    const again = await press(fields, cookie);
    expect(again.status).toBe(303);
    expect(again.headers.get("location")).toBe(LIST);
    expect(await rows(email)).toHaveLength(1);
    expect(await added(email)).toEqual(["tenders on its page"]);
    // The searches page lists it with the label the site wrote.
    expect(text(await html("/account/searches", cookie))).toContain(`<a href="${LIST_PARAMS}">${LIST_LABEL}</a>`);
  });

  it("saves a segment, the overview's 3-month list and a window, each line then reading saved", async () => {
    const email = newEmail("save-each");
    const cookie = await signIn(email);
    for (const path of ["/segments/82", "/expiring", "/expiring/3m?segment=82"]) {
      const res = await press(fieldsOf(await html(path, cookie)), cookie);
      expect(res.headers.get("location"), path).toBe(path);
    }
    expect((await rows(email)).map((r) => [r.kind, r.params])).toEqual([
      ["segment", "/segments/82"], ["expiring", "/expiring/3m"], ["expiring", "/expiring/3m?segment=82"],
    ]);
    for (const path of ["/segments/82", "/expiring"]) {
      const line = lineOf(await html(path, cookie));
      expect(line, path).toBe(`<div class="save-search"><a href="/account/searches" class="btn watch-on" data-save="saved">Search saved</a>${MANAGE}</div>`);
    }
    // The overview's list is the 3-month window's: its own page reads saved too.
    expect(rowOf(await html("/expiring/3m", cookie))).toContain("Search saved");
    // A search saved by pasting reads saved on its page too, and the audit tells the two apart.
    const other = newEmail("save-paste");
    const pasted = await signIn(other);
    await press({ csrf: await csrf(pasted), url: "/segments/82" }, pasted);
    expect(lineOf(await html("/segments/82", pasted))).toContain("Search saved");
    expect(await added(other)).toEqual(["segment"]);
  });

  it("follows the page's language, there and back", async () => {
    const email = newEmail("save-fr");
    const cookie = await signIn(email);
    // A line under a head, before the presses below bring the account to its cap.
    const line = text(lineOf(await html("/expiring?lang=fr", cookie)));
    expect(line).toContain('<button type="submit" class="btn">Enregistrer cette recherche</button>');
    expect(line).toContain("Contrats désormais à moins de 3 mois de leur fin pour tous les acheteurs et segments");
    const page = await html("/tenders?segment=82&lang=fr", cookie);
    expect(rowOf(page)).toContain('<button type="submit" form="save-search" class="btn" data-save="new">Enregistrer cette recherche</button>');
    const fields = fieldsOf(page);
    expect(fields).toMatchObject({ lang: "fr", url: "/tenders?segment=82&lang=fr", next: "/tenders?segment=82&lang=fr" });
    expect((await press(fields, cookie)).headers.get("location")).toBe("/tenders?segment=82&lang=fr");
    // An address without the language gets it back, so the page answers in French without the cookie.
    const plain = await press({ ...fields, url: "/segments/82", next: "/segments/82" }, cookie);
    expect(plain.headers.get("location")).toBe("/segments/82?lang=fr");
    expect((await press({ ...fields, url: "/tenders?segment=43", next: "/tenders?segment=43#list" }, cookie)).headers.get("location"))
      .toBe("/tenders?segment=43&lang=fr#list");
    const stored = await rows(email);
    expect(stored.map((r) => [r.params, r.lang])).toEqual([["/tenders?segment=82", "fr"], ["/segments/82", "fr"], ["/tenders?segment=43", "fr"]]);
    expect(text(stored[0].label)).toBe("Nouveaux avis d'appel d'offres correspondant à Segment UNSPSC : 82 Services de rédaction, de design, de graphisme et de beaux-arts");
    expect(rowOf(await html("/tenders?segment=82&lang=fr", cookie))).toContain(
      '<a href="/account/searches" class="btn watch-on" data-save="saved">Recherche enregistrée</a>',
    );
    expect(text(lineOf(await html("/segments/82?lang=fr", cookie)))).toBe(
      '<div class="save-search"><a href="/account/searches" class="btn watch-on" data-save="saved">Recherche enregistrée</a>' +
      '<span class="muted small" data-save="saved"><a href="/account/searches">Gérer vos recherches enregistrées</a></span></div>',
    );
    for (const path of ["/tenders?segment=82&lang=fr", "/segments/82?lang=fr"]) {
      const fr = await html(path, cookie);
      expect(fr, path).not.toContain(EM_DASH);
      expect(fr, path).not.toContain(EN_DASH);
      expect(fr, path).not.toContain("Save this search");
    }
  });
});

describe("the cap", () => {
  it("shows a Free account at 3 the figures and the plans, with the Pro chip, and a press there saves nothing", async () => {
    const email = newEmail("save-cap");
    const cookie = await signIn(email);
    // The weekly briefings share the cap (searches.ts addSearch): one search, one briefing, then the list's press.
    await hold(email, 1);
    await ACCOUNTS.prepare("INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'segment', '43', '', 'x', 'en', ?, 'off')")
      .bind(crypto.randomUUID(), await userId(email), new Date().toISOString()).run();
    expect((await press(fieldsOf(await html(LIST, cookie)), cookie)).headers.get("location")).toBe(LIST);
    const NOTE = "This account holds 3 of 3 saved searches. Pro holds up to 25 and sends them by email, daily or weekly. Plans and prices";
    // Another view of the list: the cap in place of the button.
    const OTHER = "/tenders?segment=43";
    const row = rowOf(await html(OTHER, cookie));
    expect(row).not.toContain("<button");
    expect(row).toContain('<div data-save="new"><p class="pro-note"><span class="pro-tag">');
    expect(row).toContain('<a href="/account/billing">Plans and prices</a></p></div>');
    expect(text(row.replace(/<[^>]+>/g, ""))).toBe(`Pro (paid plan)${NOTE}`);
    expect(row).not.toMatch(/\bmore\b|unlimited/i);
    // The view saved already still reads saved, the cap waiting hidden for tenders.js.
    const saved = rowOf(await html(LIST, cookie));
    expect(saved).toContain(`<a href="/account/searches" class="btn watch-on" data-save="saved">Search saved</a>${MANAGE}<div data-save="new" hidden=""><p class="pro-note">`);
    // Under a head: the same note, no button.
    const line = lineOf(await html("/segments/82", cookie));
    expect(line.startsWith('<div class="save-search"><p class="pro-note">')).toBe(true);
    expect(line).not.toContain("<button");
    expect(text(line.replace(/<[^>]+>/g, ""))).toBe(`Pro (paid plan)${NOTE}`);
    // A press anyway (a page open from before) adds nothing and goes back to the page, which shows the cap.
    const res = await press({ csrf: await csrf(cookie), lang: "en", url: OTHER, next: OTHER }, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(OTHER);
    expect(await rows(email)).toHaveLength(2);
    expect(await added(email)).toEqual(["tenders on its page"]);
  });

  it("tells a Pro account at 25 its figure and the saved searches, naming no plan", async () => {
    const email = newEmail("save-pro");
    const cookie = await signIn(email);
    await grantPro(email);
    expect(rowOf(await html(LIST, cookie))).toContain(">Save this search</button>");
    await hold(email, 25);
    for (const [path, find] of [[LIST, rowOf], ["/segments/82", lineOf]] as const) {
      const part = find(await html(path, cookie));
      expect(part, path).toContain(
        '<p class="muted small">This account holds 25 saved searches, the most an account keeps. <a href="/account/searches">Manage your saved searches</a></p>',
      );
      expect(part, path).not.toContain("<button");
      expect(part, path).not.toMatch(/\bPro\b|pro-tag|\/account\/billing|\/pro\b|\bmore\b|unlimited/i);
    }
    const fr = text(rowOf(await html("/tenders?lang=fr", cookie)));
    expect(fr).toContain("Ce compte a 25 recherches enregistrées, le maximum qu'un compte conserve. <a href=\"/account/searches\">Gérer vos recherches enregistrées</a>");
    expect((await press({ csrf: await csrf(cookie), lang: "en", url: LIST, next: LIST }, cookie)).headers.get("location")).toBe(LIST);
    expect(await rows(email)).toHaveLength(25);
  });

  it("reads in French for Free", async () => {
    const email = newEmail("save-cap-fr");
    const cookie = await signIn(email);
    await hold(email, 3);
    const row = text(rowOf(await html("/tenders?lang=fr", cookie)).replace(/<[^>]+>/g, ""));
    expect(row).toBe(
      "Pro (forfait payant)Recherches enregistrées de ce compte : 3 sur 3. Pro en conserve jusqu'à 25 et les envoie par courriel, " +
      "chaque jour ou chaque semaine. Forfaits et prix",
    );
  });
});

describe("what a press is refused", () => {
  it("an address that is not a page with a filter, answered with the searches page's own line", async () => {
    const email = newEmail("save-bad");
    const cookie = await signIn(email);
    const token = await csrf(cookie);
    for (const url of ["/tenders/new", "https://evil.example/tenders?segment=82", "//evil.example/tenders", "/buyers/no-such-buyer", "/segments/99", "/account/searches"]) {
      const res = await press({ csrf: token, lang: "en", url, next: "/tenders" }, cookie);
      expect(res.status, url).toBe(400);
      expect(res.headers.get("location"), url).toBeNull();
      expect(decode(await res.text()), url).toContain("That address is not a page with a filter to save.");
    }
    expect(await rows(email)).toEqual([]);
  });

  it("a post without the session's CSRF value, with another one, from another site, or without a session", async () => {
    const email = newEmail("save-csrf");
    const cookie = await signIn(email);
    const fields = fieldsOf(await html(LIST, cookie));
    const { csrf: _token, ...rest } = fields;
    expect((await press(rest, cookie)).status).toBe(403);
    expect((await press({ ...fields, csrf: "0".repeat(32) }, cookie)).status).toBe(403);
    expect((await press(fields, await signIn(newEmail("save-other")))).status).toBe(403);
    expect((await press(fields, cookie, { origin: "https://evil.example" })).status).toBe(403);
    const out = await post("/account/searches", fields);
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/account/sign-in");
    expect(await rows(email)).toEqual([]);
  });

  it("a return address off the site, which is dropped for the filter's own page; the search is saved", async () => {
    const email = newEmail("save-next");
    const cookie = await signIn(email);
    const token = await csrf(cookie);
    const unsafe = ["//evil.example/x", "https://evil.example/tenders", "/\\evil.example", "/account/sign-in?next=/x", "/x\u0001y", `/tenders?q=${"a".repeat(300)}`, ""];
    for (const next of unsafe) {
      const res = await press({ csrf: token, lang: "en", url: "/tenders?segment=82&sort=published", next }, cookie);
      expect(res.status, next).toBe(303);
      expect(res.headers.get("location"), next).toBe("/tenders?segment=82");
    }
    expect((await rows(email)).map((r) => r.params)).toEqual(["/tenders?segment=82"]);
  });
});

describe("the searches page and the script", () => {
  it("says on Add a Search which pages save their own filter", async () => {
    const cookie = await signIn(newEmail("save-note"));
    expect(text(await html("/account/searches", cookie))).toContain(
      "The filter is saved as the page shows it. On a tender list, a list of contracts ending or a segment page, Save this search does the same " +
        "without the address.",
    );
    expect(text(await html("/account/searches?lang=fr", cookie))).toContain(
      "Le filtre est enregistré tel que la page l'affiche. Sur une liste d'appels d'offres, une liste de contrats prenant fin ou une page de " +
        "segment, Enregistrer cette recherche fait de même sans l'adresse.",
    );
  });

  it("reads in tenders.js the form and the states the row renders, and writes no markup", () => {
    expect(SAVE_FORM_ID).toBe("save-search");
    expect(tendersJs).toContain(`document.getElementById("${SAVE_FORM_ID}")`);
    expect(tendersJs).toContain('document.querySelector("[data-save-search]")');
    expect(tendersJs).toContain(`querySelectorAll('[data-save="saved"]')`);
    expect(tendersJs).toContain(`querySelectorAll('[data-save="new"]')`);
    expect(tendersJs).toContain('["url", "next"].forEach');
    // After every draw, once the address is written.
    expect(tendersJs).toMatch(/history\.replaceState\(null, "", url\);\n {4}\} catch \(e\) \{[^\n]*\}\n {4}followSave\(url\);/);
    expect(tendersJs).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
    expect(tendersJs).not.toContain(EM_DASH);
  });
});
