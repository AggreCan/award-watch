// A briefing saved by the sign-in (src/account/briefing_pages.tsx
// BriefingPanel, routes.tsx GET and POST /account/sign-in and
// /account/check, briefings.ts briefOf; docs/accounts.md, Weekly briefings):
// a reader not signed in presses Save this briefing on a segment or buyer
// page, which links to the sign-in page with next and brief; the sign-in
// form, the code form and the mailed link carry them on, and the briefing is
// saved once the address has proved itself, by the link or by the code, for
// the account that address signs in to, by the briefing post's own steps (the
// shared cap, one briefing of a subject, the email off on Free), audited as
// coming with the sign-in. An invalid brief is dropped and the sign-in goes
// on; a fault in the briefing step never fails the sign-in; a GET adds
// nothing; a post that carries brief without a page's headers, or past the
// hour's ceiling it shares with Follow, sends nothing. Every expected line is
// written out here, never read back from the code under test.
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRIEF_MAX, briefOf } from "../src/account/briefings";
import { addSearch } from "../src/account/searches";
import { FOLLOW_CODES_PER_HOUR } from "../src/account/signin";
import {
  ACCOUNTS, decode, get, grantPro, lastMail, nbsp, newEmail, offEnv, onEnv, post, sessionCookie, signIn, useAccountsDb, userId,
} from "./accounts-helpers";
import { testEnv } from "./assets";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const BUYER = "pwgsc-tpsgc"; // the fixtures' buyer
const SEGMENT = "82";

const text = async (res: Response) => nbsp(decode(await res.text())).replace(/’/g, "'");

// The two pages the control sits on, signed out: the path, the brief value
// the link carries and the link as the page writes it.
const PAGES = [
  {
    path: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}`,
    href: `/account/sign-in?next=%2Fsegments%2F${SEGMENT}&amp;brief=segment%3A${SEGMENT}`,
  },
  { path: `/buyers/${BUYER}`, brief: `buyer:${BUYER}`, href: `/account/sign-in?next=%2Fbuyers%2F${BUYER}&amp;brief=buyer%3A${BUYER}` },
];

const NOTE_EN = "Signing in also saves the weekly briefing of the page where you pressed Save this briefing.";
const NOTE_FR = "En vous connectant, vous enregistrerez aussi le bulletin hebdomadaire de la page où vous avez appuyé sur Enregistrer ce bulletin.";
const AFTER_EN = "To save that briefing, sign in here, then press Save this briefing on its page.";
const AFTER_FR = "Pour enregistrer ce bulletin, connectez-vous ici, puis appuyez sur Enregistrer ce bulletin sur sa page.";

const SIGN_IN_FORM_RE = /<form method="post" action="\/account\/sign-in" class="stack">[\s\S]*?<\/form>/;

// The sign-in page's own form, as a browser would post it: every hidden field,
// the honeypot left empty and the typed address.
function formFields(html: string, email: string): Record<string, string> {
  const form = SIGN_IN_FORM_RE.exec(html)?.[0] ?? "";
  const fields: Record<string, string> = {};
  for (const m of form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g)) fields[m[1]] = decode(m[2]);
  return { ...fields, email, website: "" };
}

// The page's Save this briefing link followed to the sign-in page, and that page's form filled in.
async function linkForm(path: string, email: string): Promise<Record<string, string>> {
  const html = await (await get(path)).text();
  const href = /<a href="(\/account\/sign-in\?next=[^"]*)" class="btn">(?:Save this briefing|Enregistrer ce bulletin)<\/a>/.exec(html)?.[1] ?? "";
  return formFields(await (await get(decode(href))).text(), email);
}

type BriefRow = { kind: string; subject: string; segment: string; label: string; lang: string; deliver: string };
const briefingsOf = async (user: string): Promise<BriefRow[]> =>
  (await ACCOUNTS.prepare("SELECT kind, subject, segment, label, lang, deliver FROM briefings WHERE user_id = ? ORDER BY created_at, id")
    .bind(user).all<BriefRow>()).results ?? [];
const addedAudit = async (user: string): Promise<(string | null)[]> =>
  ((await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = 'briefing_added' ORDER BY id").bind(user)
    .all<{ detail: string | null }>()).results ?? []).map((r) => r.detail);

const mailOf = async (email: string) => {
  const mail = await lastMail(email);
  return { mail, code: /([0-9]{6})/.exec(mail?.text ?? "")?.[1] ?? "", link: /http:\/\/localhost\/account\/check\?[^\s"]+/.exec(mail?.text ?? "")?.[0] ?? "" };
};

afterEach(() => {
  vi.restoreAllMocks();
});

// -- the link on the public pages ---------------------------------------------------------------

describe("the Save this briefing link for a reader not signed in", () => {
  it("carries the page and the briefing, on a segment page and a buyer page, and the panel is otherwise as it was", async () => {
    for (const p of PAGES) {
      const html = await (await get(p.path)).text();
      const panel = /<section class="panel briefing">[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
      const lead = p.path.startsWith("/segments/")
        ? "One email each Monday about this segment: the week&#39;s new notices"
        : "One email each Monday about this buyer, or one of its segments: the week&#39;s new notices";
      expect(panel, p.path).toBe(
        '<section class="panel briefing"><div class="panel-head"><h2>Weekly Briefing</h2>' +
        '<div class="panel-tools"><a href="/pro/briefing-sample">This week&#39;s sample</a></div></div>' +
        `<p>${lead}, the awards with their winners and values, the contracts ending next fiscal quarter with their holders, ` +
        "the notable amendments, the fiscal year&#39;s largest records and the standing offers and supply arrangements ending within 6 months.</p>" +
        `<div class="briefing-control"><a href="${p.href}" class="btn">Save this briefing</a>` +
        '<span class="muted small">Saved to your account on sign-in; signing in makes an account if there is none.</span></div>' +
        '<p class="pro-note"><span class="pro-tag"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
        '<path d="M3 6.2 6 2h4l3 4.2L8 14.5z"></path></svg>Pro<span class="visually-hidden"> (paid plan)</span></span>' +
        'Email delivery is part of Pro. <a href="/account/sign-in?next=/account/billing">Subscribe to Pro</a></p></section>',
      );
      // The briefing is named in that one link and nowhere else on the page; no filled button is added.
      expect(html.split("brief=").length - 1, p.path).toBe(1);
      expect(html.split('name="brief"').length - 1, p.path).toBe(0);
      expect((html.match(/class="btn btn-primary"/g) ?? []).length, p.path).toBeLessThanOrEqual(1);
      expect(panel, p.path).not.toContain(EM_DASH);
      expect(panel, p.path).not.toContain(EN_DASH);
      // The value the link carries reads back as one briefing of the page.
      expect(briefOf(p.brief), p.path).not.toBeNull();
    }
  });

  it("is the same link on a French page, beside the French button", async () => {
    for (const p of PAGES) {
      const html = await text(await get(`${p.path}?lang=fr`));
      expect(html, p.path).toContain(`<a href="${decode(p.href)}" class="btn">Enregistrer ce bulletin</a>`);
    }
  });

  it("stays the same for every reader not signed in, so the page keeps its public cache", async () => {
    for (const p of PAGES) {
      const a = await get(p.path);
      const b = await get(p.path);
      expect(a.headers.get("cache-control"), p.path).toBe("public, max-age=300");
      expect(b.headers.get("cache-control"), p.path).toBe("public, max-age=300");
      expect(await a.text(), p.path).toBe(await b.text());
    }
  });

  it("leaves a signed-in reader's control as it was", async () => {
    const cookie = await signIn(newEmail("b-in"));
    for (const p of PAGES) {
      const html = await (await get(p.path, { cookie })).text();
      expect(html, p.path).toContain('<form method="post" action="/account/briefings" class="briefing-control">');
      expect(html, p.path).not.toContain("brief=");
    }
  });

  it("is not there while the switch is off", async () => {
    for (const p of PAGES) {
      const html = await (await get(p.path, { env: offEnv() })).text();
      expect(html, p.path).not.toContain('class="panel briefing"');
      expect(html, p.path).not.toContain("brief=");
      expect(html, p.path).not.toContain("/account/sign-in");
    }
  });
});

// -- reading brief ------------------------------------------------------------------------------------

describe("the brief value", () => {
  it("reads only one briefing of a page the site writes, by the briefing post's rules", () => {
    expect(briefOf(`segment:${SEGMENT}`)).toEqual({ kind: "segment", subject: SEGMENT });
    expect(briefOf(`buyer:${BUYER}`)).toEqual({ kind: "buyer", subject: BUYER });
    for (const bad of [
      "", "segment", `:${SEGMENT}`, "segment:", "segment:99", "segment:8", "segment:082", `Segment:${SEGMENT}`, `segment ${SEGMENT}`,
      `segment:${SEGMENT}\n`, `segment:${SEGMENT}\u0000`, `buyer:${BUYER}:81`, "buyer:PWGSC-TPSGC", "buyer:-x", `buyer:${"a".repeat(81)}`,
      "organization:org-a000000001", `buyer:${"a".repeat(BRIEF_MAX)}`, "__proto__:x", "constructor:x", "x".repeat(400),
    ]) {
      expect(briefOf(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(briefOf(undefined)).toBeNull();
    expect(briefOf(null)).toBeNull();
  });
});

// -- the whole path -------------------------------------------------------------------------------------

describe("saving a briefing with the sign-in", () => {
  it("by the link, on Free: each page carries brief, the briefing is saved once with its email off, and the audit says so", async () => {
    const email = newEmail("b-link");
    const fields = await linkForm(`/segments/${SEGMENT}`, email);
    expect(fields).toEqual({ lang: "en", next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}`, email, website: "" });
    const signInPage = await text(await get(`/account/sign-in?next=%2Fsegments%2F${SEGMENT}&brief=segment%3A${SEGMENT}`));
    expect(signInPage).toContain(`<p class="muted small">${NOTE_EN}</p>`);
    const res = await post("/account/sign-in", fields);
    expect(res.status).toBe(200);
    const page = await text(res);
    expect(page).toContain("<h1>Check Your Email</h1>");
    expect(page).toContain(`<p class="muted small">${NOTE_EN}</p>`);
    expect(page).toContain(`<input type="hidden" name="next" value="/segments/${SEGMENT}"/>`);
    expect(page).toContain(`<input type="hidden" name="brief" value="segment:${SEGMENT}"/>`);
    const { mail, link } = await mailOf(email);
    expect(mail?.text).toContain(`&next=%2Fsegments%2F${SEGMENT}&brief=segment%3A${SEGMENT}`);
    // Opening the link changes nothing; its page carries brief to its button.
    const opened = await get(link.replace("http://localhost", ""));
    expect(opened.status).toBe(200);
    const linkPage = await text(opened);
    expect(linkPage).toContain(`<input type="hidden" name="brief" value="segment:${SEGMENT}"/>`);
    expect(linkPage).toContain(NOTE_EN);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").bind(email).first("n")).toBe(0);
    const token = /name="token" value="([^"]+)"/.exec(linkPage)?.[1] ?? "";
    const done = await post("/account/check", { lang: "en", token, next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}` });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/segments/${SEGMENT}`);
    const cookie = sessionCookie(done);
    expect(cookie).toMatch(/^__Host-aw_session=/);
    const id = await userId(email);
    expect(await briefingsOf(id)).toEqual([
      { kind: "segment", subject: SEGMENT, segment: "", label: "82 Editorial and design", lang: "en", deliver: "off" },
    ]);
    expect(await addedAudit(id)).toEqual(["segment at sign-in"]);
    // Back on the page: saved.
    const back = await (await get(`/segments/${SEGMENT}`, { cookie })).text();
    expect(back).toContain('<a href="/account/searches#briefings" class="btn watch-on">Briefing saved</a>');
    expect(back).not.toContain("brief=");
  });

  it("by the code, in French, on a buyer page, on Pro: the whole buyer, weekly, once, whatever the next sign-in carries", async () => {
    const email = newEmail("b-code");
    await signIn(email);
    await grantPro(email);
    const id = await userId(email);
    const fields = await linkForm(`/buyers/${BUYER}?lang=fr`, email);
    expect(fields).toMatchObject({ next: `/buyers/${BUYER}`, brief: `buyer:${BUYER}` });
    // The link names no language; the reader's own carries it (here the address, in a browser the cookie).
    const signInPage = await text(await get(`/account/sign-in?lang=fr&next=%2Fbuyers%2F${BUYER}&brief=buyer%3A${BUYER}`));
    expect(signInPage).toContain(`<p class="muted small">${NOTE_FR}</p>`);
    expect(signInPage).not.toContain(EM_DASH);
    expect(signInPage).not.toContain(EN_DASH);
    const frFields = formFields(await (await get(`/account/sign-in?lang=fr&next=%2Fbuyers%2F${BUYER}&brief=buyer%3A${BUYER}`)).text(), email);
    expect(frFields).toEqual({ lang: "fr", next: `/buyers/${BUYER}`, brief: `buyer:${BUYER}`, email, website: "" });
    const res = await post("/account/sign-in", frFields);
    expect(await text(res)).toContain(NOTE_FR);
    const { mail, code } = await mailOf(email);
    expect(mail?.lang).toBe("fr");
    expect(mail?.text).toContain(`&lang=fr&next=%2Fbuyers%2F${BUYER}&brief=buyer%3A${BUYER}`);
    const done = await post("/account/check", { lang: "fr", email, code, sent: "1", next: `/buyers/${BUYER}`, brief: `buyer:${BUYER}` });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/buyers/${BUYER}`);
    expect(await briefingsOf(id)).toEqual([
      { kind: "buyer", subject: BUYER, segment: "", label: "Services publics et Approvisionnement Canada", lang: "fr", deliver: "weekly" },
    ]);
    expect(await addedAudit(id)).toEqual(["buyer at sign-in"]);
    // A second sign-in from the same link: saved already, nothing added, nothing audited.
    expect((await post("/account/sign-in", frFields)).status).toBe(200);
    const second = await mailOf(email);
    expect((await post("/account/check", { lang: "fr", email, code: second.code, sent: "1", next: `/buyers/${BUYER}`, brief: `buyer:${BUYER}` })).status)
      .toBe(303);
    expect(await briefingsOf(id)).toHaveLength(1);
    expect(await addedAudit(id)).toEqual(["buyer at sign-in"]);
    const back = await text(await get(`/buyers/${BUYER}?lang=fr`, { cookie: sessionCookie(done) }));
    expect(back).toContain('class="btn watch-on">Bulletin enregistré</a>');
  });

  it("keeps a briefing the account saved already as it is: a narrowed one stays, and the whole buyer is added beside it", async () => {
    const email = newEmail("b-exists");
    await signIn(email);
    const id = await userId(email);
    await ACCOUNTS.prepare(
      "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'segment', ?, '', 'Old label', 'en', ?, 'off')",
    ).bind("e".repeat(32), id, SEGMENT, new Date(Date.now() - 60_000).toISOString()).run();
    await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, email));
    const { code } = await mailOf(email);
    const done = await post("/account/check", { email, code, sent: "1", next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}` });
    expect(done.status).toBe(303);
    expect(await briefingsOf(id)).toEqual([{ kind: "segment", subject: SEGMENT, segment: "", label: "Old label", lang: "en", deliver: "off" }]);
    expect(await addedAudit(id)).toEqual([]);
    // A buyer narrowed to a segment is another briefing: the link's whole buyer is added beside it, as the post adds it.
    await ACCOUNTS.prepare(
      "INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver) VALUES (?, ?, 'buyer', ?, '81', 'Narrowed', 'en', ?, 'off')",
    ).bind("f".repeat(32), id, BUYER, new Date(Date.now() - 30_000).toISOString()).run();
    await post("/account/sign-in", await linkForm(`/buyers/${BUYER}`, email));
    const again = await mailOf(email);
    expect((await post("/account/check", { email, code: again.code, sent: "1", next: `/buyers/${BUYER}`, brief: `buyer:${BUYER}` })).status).toBe(303);
    expect((await briefingsOf(id)).map((b) => [b.kind, b.subject, b.segment])).toEqual([
      ["segment", SEGMENT, ""], ["buyer", BUYER, "81"], ["buyer", BUYER, ""],
    ]);
    expect(await addedAudit(id)).toEqual(["buyer at sign-in"]);
  });

  it("at the shared cap signs in and adds nothing; the page then shows the cap", async () => {
    const email = newEmail("b-cap");
    await signIn(email);
    const id = await userId(email);
    for (const n of [1, 2, 3]) {
      expect(await addSearch(env as never, { userId: id, plan: "free" }, { kind: "tenders", params: `/tenders?segment=4${n}`, label: `Search ${n}` }, "en"))
        .toBe("added");
    }
    await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, email));
    const { code } = await mailOf(email);
    const done = await post("/account/check", { email, code, sent: "1", next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}` });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/segments/${SEGMENT}`);
    expect(await briefingsOf(id)).toEqual([]);
    expect(await addedAudit(id)).toEqual([]);
    const back = await text(await get(`/segments/${SEGMENT}`, { cookie: sessionCookie(done) }));
    expect(back).toContain("Your account holds 3 saved searches and briefings, its cap of 3.");
  });

  it("keeps brief through a mistyped code, then saves on the right one", async () => {
    const email = newEmail("b-typo");
    await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, email));
    const { code } = await mailOf(email);
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await post("/account/check", { email, code: wrong, sent: "1", next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}` });
    expect(bad.status).toBe(400);
    const html = await text(bad);
    expect(html).toContain(`<input type="hidden" name="brief" value="segment:${SEGMENT}"/>`);
    expect(html).toContain(NOTE_EN);
    const done = await post("/account/check", { email, code, sent: "1", next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}` });
    expect(done.status).toBe(303);
    expect(await briefingsOf(await userId(email))).toHaveLength(1);
  });

  it("adds the briefing to the account the address signs in to, never to the session the browser held before", async () => {
    const before = newEmail("b-before");
    const cookie = await signIn(before);
    const email = newEmail("b-after");
    await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, email), { cookie });
    const { code } = await mailOf(email);
    const done = await post("/account/check", { email, code, sent: "1", next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}` }, { cookie });
    expect(done.status).toBe(303);
    expect(await briefingsOf(await userId(before))).toEqual([]);
    expect(await briefingsOf(await userId(email))).toHaveLength(1);
  });

  it("drops an invalid brief without a word, and the sign-in goes on as before", async () => {
    for (const brief of ["segment:99", `buyer:${BUYER}:81`, "organization:org-a000000001", `segment:${SEGMENT}\u0000`, "x".repeat(400)]) {
      const email = newEmail("b-bad");
      const res = await post("/account/sign-in", { lang: "en", email, next: `/segments/${SEGMENT}`, brief, website: "" });
      expect(res.status, brief).toBe(200);
      const page = await res.text();
      expect(page, brief).not.toContain('name="brief"');
      expect(page, brief).not.toContain("Signing in also saves");
      const { mail, code } = await mailOf(email);
      expect(mail?.text, brief).not.toContain("brief=");
      const done = await post("/account/check", { email, code, sent: "1", next: `/segments/${SEGMENT}`, brief });
      expect(done.status, brief).toBe(303);
      expect(done.headers.get("location"), brief).toBe(`/segments/${SEGMENT}`);
      expect(await briefingsOf(await userId(email)), brief).toEqual([]);
    }
  });

  it("adds nothing for a well-formed buyer the data does not hold, and still signs in", async () => {
    const email = newEmail("b-gone");
    const brief = "buyer:no-such-buyer";
    expect(briefOf(brief)).not.toBeNull();
    await post("/account/sign-in", { lang: "en", email, next: `/segments/${SEGMENT}`, brief, website: "" });
    const { code } = await mailOf(email);
    const done = await post("/account/check", { email, code, sent: "1", next: `/segments/${SEGMENT}`, brief });
    expect(done.status).toBe(303);
    expect(await briefingsOf(await userId(email))).toEqual([]);
  });

  it("never fails the sign-in when the briefing step fails, and logs no detail", async () => {
    const email = newEmail("b-fault");
    await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, email));
    const { code } = await mailOf(email);
    const failing = {
      prepare(sql: string) {
        if (sql.startsWith("INSERT INTO briefings")) throw new Error("D1_ERROR: no such table: briefings: SQLITE_ERROR");
        return ACCOUNTS.prepare(sql);
      },
      batch: (s: D1PreparedStatement[]) => ACCOUNTS.batch(s),
    } as unknown as D1Database;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const done = await post("/account/check", { email, code, sent: "1", next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}` },
      { env: onEnv({ ACCOUNTS: failing }) });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/segments/${SEGMENT}`);
    expect(sessionCookie(done)).toMatch(/^__Host-aw_session=/);
    expect(await briefingsOf(await userId(email))).toEqual([]);
    const lines = errors.mock.calls.map((c) => c.join(" "));
    expect(lines).toContain("account sign-in: the briefing named by Save this briefing was not saved");
    for (const line of lines) expect(line).not.toContain(email);
  });

  it("adds nothing on a GET: the sign-in page and the link only carry brief", async () => {
    const email = newEmail("b-get");
    const cookie = await signIn(email);
    const id = await userId(email);
    // Signed in, the sign-in page goes back to the page, which offers its own form.
    const signedIn = await get(`/account/sign-in?next=%2Fsegments%2F${SEGMENT}&brief=segment%3A${SEGMENT}`, { cookie });
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get("location")).toBe(`/segments/${SEGMENT}`);
    const other = newEmail("b-get2");
    await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, other));
    const { link } = await mailOf(other);
    expect((await get(link.replace("http://localhost", ""))).status).toBe(200);
    expect(await briefingsOf(id)).toEqual([]);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").bind(other).first("n")).toBe(0);
  });
});

// -- the sign-in pages ---------------------------------------------------------------------------------

describe("the sign-in pages with brief", () => {
  const NOTE_HTML = `<p class="muted small">${NOTE_EN}</p>`;
  const FIELD_HTML = `<input type="hidden" name="brief" value="segment:${SEGMENT}"/>`;

  it("differ from the same pages without brief by the line and the field alone, and by the new code link's brief", async () => {
    const plain = await (await get(`/account/sign-in?next=%2Fsegments%2F${SEGMENT}`)).text();
    const carried = await (await get(`/account/sign-in?next=%2Fsegments%2F${SEGMENT}&brief=segment%3A${SEGMENT}`)).text();
    expect(carried.split(NOTE_HTML).length - 1).toBe(1);
    expect(carried.split(FIELD_HTML).length - 1).toBe(1);
    expect(carried.replace(NOTE_HTML, "").replace(FIELD_HTML, "")).toBe(plain);
    // The code page, after a request made without and with brief for the same address.
    const email = newEmail("b-same");
    const codePlain = await (await post("/account/sign-in", { lang: "en", email, next: `/segments/${SEGMENT}` })).text();
    const codeCarried = await (await post("/account/sign-in", { lang: "en", email, next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}` })).text();
    expect(codeCarried.replace(NOTE_HTML, "").replace(FIELD_HTML, "").replace(`&amp;brief=segment%3A${SEGMENT}"`, '"')).toBe(codePlain);
    // A page with a brief that does not read is the page without one.
    expect(await (await get(`/account/sign-in?next=%2Fsegments%2F${SEGMENT}&brief=segment%3A99`)).text()).toBe(plain);
  });

  it("answers the form's errors on the sign-in page with the existing lines, the address, next and brief kept", async () => {
    const keeps = (html: string, typed: string) => {
      expect(html).toContain("<h1>Sign In</h1>");
      expect(html).toContain(`value="${typed}"`);
      expect(html).toContain(`<input type="hidden" name="next" value="/segments/${SEGMENT}"/>`);
      expect(html).toContain(FIELD_HTML);
      expect(html).toContain(NOTE_EN);
    };
    const incomplete = await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, "not-an-address"));
    expect(incomplete.status).toBe(400);
    const a = await text(incomplete);
    expect(a).toContain("Enter a complete email address.");
    keeps(a, "not-an-address");
    const trapped = newEmail("b-trap");
    const trap = await post("/account/sign-in", { ...(await linkForm(`/segments/${SEGMENT}`, trapped)), website: "spam.example" });
    expect(trap.status).toBe(400);
    keeps(await text(trap), trapped);
    expect(await lastMail(trapped)).toBeNull();
  });
});

describe("Ask for a new code with brief", () => {
  const AGAIN = `/account/sign-in?next=${encodeURIComponent(`/segments/${SEGMENT}`)}&amp;brief=${encodeURIComponent(`segment:${SEGMENT}`)}`;

  it("keeps the page and the briefing, on the code page, after a mistyped code and on a link gone stale", async () => {
    const email = newEmail("b-again");
    const sent = await (await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, email))).text();
    expect(sent).toContain(`<a href="${AGAIN}">`);
    const wrong = await (await post("/account/check", { email, code: "000000", sent: "1", next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}` })).text();
    expect(wrong).toContain(`<a href="${AGAIN}">`);
    const stale = `${"0".repeat(32)}.${"0".repeat(64)}`;
    const posted = await post("/account/check", { token: stale, next: `/segments/${SEGMENT}`, brief: `segment:${SEGMENT}` });
    expect(posted.status).toBe(400);
    expect(await posted.text()).toContain(`<a href="${AGAIN}" class="btn">`);
    const opened = await (await get(`/account/check?token=nonsense&next=%2Fsegments%2F${SEGMENT}&brief=segment%3A${SEGMENT}`)).text();
    expect(opened).toContain(`<a href="${AGAIN}" class="btn">`);
    // The page it leads to carries both on.
    const page = await (await get(AGAIN.replace("&amp;", "&"))).text();
    expect(page).toContain(`<input type="hidden" name="brief" value="segment:${SEGMENT}"/>`);
  });
});

// -- brief and follow together --------------------------------------------------------------------------

describe("a sign-in that carries both follow and brief", () => {
  it("carries both, notes both, and adds a watch and a briefing, each by its own steps; the request is marked once", async () => {
    const both = `/account/sign-in?next=%2Fbuyers%2F${BUYER}&follow=buyer%3A${BUYER}&brief=buyer%3A${BUYER}`;
    const html = await text(await get(both));
    expect(html).toContain('<p class="muted small">Signing in also follows the page where you pressed Follow.</p>' +
      `<p class="muted small">${NOTE_EN}</p>`);
    expect(html).toContain(`<input type="hidden" name="next" value="/buyers/${BUYER}"/><input type="hidden" name="follow" value="buyer:${BUYER}"/>` +
      `<input type="hidden" name="brief" value="buyer:${BUYER}"/>`);
    await ACCOUNTS.prepare("DELETE FROM audit WHERE event = 'code_requested' AND detail IN ('follow', 'brief')").run();
    const email = newEmail("b-both");
    await post("/account/sign-in", formFields(await (await get(both)).text(), email));
    const marked = await ACCOUNTS.prepare("SELECT detail FROM audit WHERE event = 'code_requested' AND detail IN ('follow', 'brief')")
      .all<{ detail: string }>();
    expect((marked.results ?? []).map((r) => r.detail)).toEqual(["follow"]);
    const { mail, code } = await mailOf(email);
    expect(mail?.text).toContain(`&next=%2Fbuyers%2F${BUYER}&follow=buyer%3A${BUYER}&brief=buyer%3A${BUYER}`);
    const done = await post("/account/check", { email, code, sent: "1", next: `/buyers/${BUYER}`, follow: `buyer:${BUYER}`, brief: `buyer:${BUYER}` });
    expect(done.status).toBe(303);
    const id = await userId(email);
    expect(await ACCOUNTS.prepare("SELECT kind, target FROM watches WHERE user_id = ?").bind(id).all().then((r) => r.results))
      .toEqual([{ kind: "buyer", target: BUYER }]);
    expect((await briefingsOf(id)).map((b) => [b.kind, b.subject, b.segment])).toEqual([["buyer", BUYER, ""]]);
    await ACCOUNTS.prepare("DELETE FROM audit WHERE event = 'code_requested' AND detail IN ('follow', 'brief')").run();
  });

  it("drops both when the post comes without a page's headers, and says how to do each after signing in", async () => {
    const email = newEmail("b-both-script");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post("/account/sign-in",
      { lang: "en", email, next: `/buyers/${BUYER}`, follow: `buyer:${BUYER}`, brief: `buyer:${BUYER}` }, { origin: null });
    expect(res.status).toBe(200);
    const html = await text(res);
    expect(html).toContain(`<p class="account-notice" role="status">To follow that page, sign in here, then press Follow on it. ${AFTER_EN}</p>`);
    expect(html).not.toContain('name="follow"');
    expect(html).not.toContain('name="brief"');
    expect(await lastMail(email)).toBeNull();
    expect(log.mock.calls.map((c) => c.join(" "))).toContain("account sign-in: a Follow post without a page's headers, answered with the sign-in page");
  });
});

// -- the hour's ceiling, shared with Follow -------------------------------------------------------------

describe("the hour's ceiling on sign-in messages, which a briefing's request shares with Follow", () => {
  const MARKED = "event = 'code_requested' AND detail IN ('follow', 'brief')";
  const clear = () => ACCOUNTS.prepare(`DELETE FROM audit WHERE ${MARKED}`).run();
  const seed = async (n: number, at: Date, detail: string) => {
    const row = ACCOUNTS.prepare("INSERT INTO audit (user_id, event, at, detail) VALUES (NULL, 'code_requested', ?, ?)");
    for (let i = 0; i < n; i += 50) await ACCOUNTS.batch(Array.from({ length: Math.min(50, n - i) }, () => row.bind(at.toISOString(), detail)));
  };
  const count = async (detail: string) =>
    ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM audit WHERE event = 'code_requested' AND detail = ?").bind(detail).first<number>("n");

  it("marks a request carrying a briefing with the detail brief, and the sign-in page's own request not", async () => {
    await clear();
    await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, newEmail("b-mark")));
    expect(await count("brief")).toBe(1);
    await post("/account/sign-in", { lang: "en", email: newEmail("b-plain"), next: `/segments/${SEGMENT}` });
    expect(await count("brief")).toBe(1);
    expect(await count("follow")).toBe(0);
    await clear();
  });

  it("past it (counted from Follow's requests too), sends nothing and answers the sign-in page, in French too; that page's own post still sends", async () => {
    await clear();
    await seed(FOLLOW_CODES_PER_HOUR, new Date(Date.now() - 60_000), "follow");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const email = newEmail("b-ceiling");
      const res = await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, email));
      expect(res.status).toBe(200);
      const html = await text(res);
      expect(html).toContain("<h1>Sign In</h1>");
      expect(html).toContain(`value="${email}"`);
      expect(html).toContain(`<input type="hidden" name="next" value="/segments/${SEGMENT}"/>`);
      expect(html).not.toContain('name="brief"');
      expect(html).not.toContain(NOTE_EN);
      expect(html).toContain(`<p class="account-notice" role="status">${AFTER_EN}</p>`);
      expect(await lastMail(email)).toBeNull();
      expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM magic_codes WHERE email = ?").bind(email).first("n")).toBe(0);
      expect(await count("brief")).toBe(0);
      expect(log.mock.calls.map((c) => c.join(" ")))
        .toContain("account sign-in: the hour's Follow and briefing requests are spent, answered with the sign-in page");
      const fr = await text(await post("/account/sign-in", { ...(await linkForm(`/segments/${SEGMENT}`, newEmail("b-plafond"))), lang: "fr" }));
      expect(fr).toContain(AFTER_FR);
      // The sign-in page's own post carries no brief and is held to no ceiling.
      const again = await post("/account/sign-in", { lang: "en", email, next: `/segments/${SEGMENT}` });
      expect(again.status).toBe(200);
      expect(await lastMail(email)).not.toBeNull();
    } finally {
      await clear();
    }
  });

  it("counts the briefings' requests against Follow's posts too, in the last hour only", async () => {
    await clear();
    await seed(FOLLOW_CODES_PER_HOUR, new Date(Date.now() - 61 * 60_000), "brief");
    await seed(FOLLOW_CODES_PER_HOUR - 1, new Date(Date.now() - 60_000), "brief");
    try {
      const email = newEmail("b-under");
      await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, email));
      expect(await lastMail(email)).not.toBeNull();
      // That request was the hour's last: a Follow form's post is answered with the sign-in page.
      const next = newEmail("b-over");
      const follow = await post("/account/sign-in", { lang: "en", email: next, next: `/buyers/${BUYER}`, follow: `buyer:${BUYER}`, website: "" });
      expect(follow.status).toBe(200);
      expect(await text(follow)).toContain("To follow that page, sign in here, then press Follow on it.");
      expect(await lastMail(next)).toBeNull();
    } finally {
      await clear();
    }
  });
});

// -- the guard against scripts --------------------------------------------------------------------------------

describe("a post that carries brief without a page's headers", () => {
  it("sends nothing and answers the sign-in page with the address kept and the brief dropped", async () => {
    const email = newEmail("b-script");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, email), { origin: null });
    expect(res.status).toBe(200);
    const html = await text(res);
    expect(html).toContain("<h1>Sign In</h1>");
    expect(html).toContain(`value="${email}"`);
    expect(html).toContain(`<input type="hidden" name="next" value="/segments/${SEGMENT}"/>`);
    expect(html).not.toContain('name="brief"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain(`<p class="account-notice" role="status">${AFTER_EN}</p>`);
    expect(await lastMail(email)).toBeNull();
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM magic_codes WHERE email = ?").bind(email).first("n")).toBe(0);
    expect(log.mock.calls.map((c) => c.join(" "))).toContain("account sign-in: a briefing post without a page's headers, answered with the sign-in page");
    // That page's own post, without brief, signs in as before, headers or not.
    const again = await post("/account/sign-in", { lang: "en", email, next: `/segments/${SEGMENT}` }, { origin: null });
    expect(again.status).toBe(200);
    expect(await lastMail(email)).not.toBeNull();
  });

  it("goes through on any one of the headers a browser sends from the site's page, and not on another site's", async () => {
    const cases: [Record<string, string>, boolean][] = [
      [{ "sec-fetch-site": "same-origin" }, true],
      [{ referer: `http://localhost/account/sign-in?next=%2Fsegments%2F${SEGMENT}&brief=segment%3A${SEGMENT}` }, true],
      [{ "sec-fetch-site": "cross-site" }, false],
      [{ "sec-fetch-site": "none" }, false],
      [{ referer: "https://elsewhere.example/" }, false],
    ];
    for (const [headers, sent] of cases) {
      const email = newEmail("b-headers");
      const res = await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, email), { origin: null, headers });
      expect(res.status, JSON.stringify(headers)).toBe(200);
      expect(!!(await lastMail(email)), JSON.stringify(headers)).toBe(sent);
    }
    // Another site's Origin is refused before anything, brief or not.
    expect((await post("/account/sign-in", await linkForm(`/segments/${SEGMENT}`, newEmail("b-evil")), { origin: "https://evil.example" })).status)
      .toBe(403);
  });
});

// -- the switch --------------------------------------------------------------------------------------------------

describe("with the switch off", () => {
  it("answers the sign-in page and its post with the site's 404, brief or not", async () => {
    expect((await get(`/account/sign-in?next=%2Fsegments%2F${SEGMENT}&brief=segment%3A${SEGMENT}`, { env: testEnv() })).status).toBe(404);
    const res = await post("/account/sign-in", { email: newEmail("b-off"), brief: `segment:${SEGMENT}` }, { env: testEnv() });
    expect(res.status).toBe(404);
    expect((await post("/account/check", { email: newEmail("b-off2"), code: "123456", brief: `segment:${SEGMENT}` }, { env: testEnv() })).status)
      .toBe(404);
  });
});
