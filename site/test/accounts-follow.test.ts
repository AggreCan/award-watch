// Follow by address (src/account/watch_pages.tsx WatchControl, routes.tsx
// POST /account/sign-in and /account/check, watch_events.ts followOf;
// docs/accounts.md, Watches): a reader not signed in types an address on the
// page itself; the post carries next and follow, the code form and the mailed
// link carry them on, and the page is followed once the address has proved
// itself, by the link or by the code, for the account that address signs in
// to, within its plan's cap, audited as coming with the sign-in. An invalid
// follow is dropped and the sign-in goes on; a fault in the watch step never
// fails the sign-in; a GET adds nothing; a post that carries follow without a
// page's headers sends nothing; errors land on the sign-in page with what was
// typed. Every expected line is written out here, never read back from the
// code under test.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADD_WATCH_SQL } from "../src/account/watches";
import { FOLLOW_MAX, followOf } from "../src/account/watch_events";
import { CODES_PER_HOUR, FOLLOW_CODES_PER_HOUR, FOLLOW_CODES_SQL } from "../src/account/signin";
import {
  ACCOUNTS, decode, get, lastMail, nbsp, newEmail, offEnv, onEnv, post, sessionCookie, signIn, useAccountsDb, userId,
} from "./accounts-helpers";
import { testEnv } from "./assets";

useAccountsDb();

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const ORG = "org-a000000001"; // the fixtures' profile
const BUYER = "pwgsc-tpsgc";
const TENDER = "cb-100-10000001"; // open at the fixtures' clock
const AWARD = "cb-400-40000004";

// The four kinds of page the control sits on, signed out: the path, the
// follow value the form carries and whether Follow is the page's filled button.
const PAGES = [
  { path: `/organizations/${ORG}`, follow: `organization:${ORG}`, primary: true },
  { path: `/buyers/${BUYER}`, follow: `buyer:${BUYER}`, primary: false },
  { path: `/tenders/${TENDER}`, follow: `tender:tender:${TENDER}`, primary: false },
  { path: `/awards/${AWARD}`, follow: `contract:award:${AWARD}`, primary: true },
];

const text = async (res: Response) => nbsp(decode(await res.text())).replace(/’/g, "'");

const FORM_RE = /<form method="post" action="\/account\/sign-in" class="watch-control watch-signin">[\s\S]*?<\/form>/;

// The page's own Follow form, as a browser would post it: every hidden field,
// the honeypot left empty and the typed address.
function formFields(html: string, email: string): Record<string, string> {
  const form = FORM_RE.exec(html)?.[0] ?? "";
  const fields: Record<string, string> = {};
  for (const m of form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g)) fields[m[1]] = decode(m[2]);
  return { ...fields, email, website: "" };
}

async function pageForm(path: string, email: string): Promise<Record<string, string>> {
  return formFields(await (await get(path)).text(), email);
}

type WatchRow = { kind: string; target: string; segment: string; label: string };
const watchesOf = async (user: string): Promise<WatchRow[]> =>
  (await ACCOUNTS.prepare("SELECT kind, target, segment, label FROM watches WHERE user_id = ? ORDER BY created_at, id").bind(user)
    .all<WatchRow>()).results ?? [];
const addedAudit = async (user: string): Promise<(string | null)[]> =>
  ((await ACCOUNTS.prepare("SELECT detail FROM audit WHERE user_id = ? AND event = 'watch_added' ORDER BY id").bind(user)
    .all<{ detail: string | null }>()).results ?? []).map((r) => r.detail);

let seq = 0;
async function watch(user: string, kind: string, target: string): Promise<void> {
  await ACCOUNTS.prepare(
    "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) " +
    "VALUES (?, ?, ?, ?, '', ?, 'award', 'daily', ?, NULL)",
  ).bind((0xf0000000 + ++seq).toString(16).padStart(32, "0"), user, kind, target, target, new Date(Date.now() - 60_000 + seq).toISOString()).run();
}

const mailOf = async (email: string) => {
  const mail = await lastMail(email);
  return { mail, code: /([0-9]{6})/.exec(mail?.text ?? "")?.[1] ?? "", link: /http:\/\/localhost\/account\/check\?[^\s"]+/.exec(mail?.text ?? "")?.[0] ?? "" };
};

afterEach(() => {
  vi.restoreAllMocks();
});

// -- the control ------------------------------------------------------------------------------

describe("the Follow control for a reader not signed in", () => {
  it("is a form posting the address, the honeypot, the language, the page and what to follow, on all four kinds of page", async () => {
    for (const p of PAGES) {
      const html = await (await get(p.path)).text();
      const form = FORM_RE.exec(html)?.[0] ?? "";
      expect(form, p.path).toBe(
        '<form method="post" action="/account/sign-in" class="watch-control watch-signin">' +
        '<input type="hidden" name="lang" value="en"/>' +
        `<input type="hidden" name="next" value="${p.path}"/>` +
        `<input type="hidden" name="follow" value="${p.follow}"/>` +
        '<label class="watch-email"><span class="visually-hidden">Email address</span>' +
        '<input name="email" type="email" required="" maxlength="254" autocomplete="email" spellcheck="false" placeholder="Your email address"/></label>' +
        '<div class="hp"><label>Leave this field empty<input name="website" type="text" tabindex="-1" autocomplete="off"/></label></div>' +
        `<button type="submit" class="${p.primary ? "btn btn-primary" : "btn"}">Follow</button>` +
        '<span class="muted small">Free, with no password. The site sends a sign-in link to that address; once you sign in, ' +
        "this page&#39;s events show on your watches page: a new award, an amendment, an end date near, a new or closed notice.</span>" +
        "</form>",
      );
      // No Follow link to the sign-in page any more (a briefing's Subscribe and the Pro notes keep theirs), no
      // segment choice, no Pro chip in the control, one filled button on the page.
      expect(html, p.path).not.toMatch(/<a href="\/account\/sign-in\?next=[^"]*" class="btn(?: btn-primary)?">Follow<\/a>/);
      expect(form, p.path).not.toContain("<select");
      expect(form, p.path).not.toContain("pro-tag");
      expect(html.match(/class="btn btn-primary"/g), p.path).toHaveLength(1);
      expect(form, p.path).not.toContain(EM_DASH);
      expect(form, p.path).not.toContain(EN_DASH);
      // The value the form carries reads back as one watch on the page.
      expect(followOf(p.follow), p.path).not.toBeNull();
    }
  });

  it("reads in French on a French page", async () => {
    const html = await text(await get(`/organizations/${ORG}?lang=fr`));
    const form = FORM_RE.exec(html)?.[0] ?? "";
    expect(form).toContain('<input type="hidden" name="lang" value="fr"/>');
    expect(form).toContain('<span class="visually-hidden">Adresse courriel</span>');
    expect(form).toContain('placeholder="Votre adresse courriel"');
    expect(form).toContain("<label>Laissez ce champ vide<input");
    expect(form).toContain('<button type="submit" class="btn btn-primary">Suivre</button>');
    expect(form).toContain(
      "Gratuit, sans mot de passe. Le site envoie un lien de connexion à cette adresse; après la connexion, les événements de cette page " +
      "s'affichent sur votre page des suivis : une nouvelle attribution, une modification, une fin proche, un avis nouveau ou fermé.",
    );
    expect(form).not.toContain("Follow");
    expect(form).not.toContain(EM_DASH);
    expect(form).not.toContain(EN_DASH);
  });

  it("stays the same for every reader not signed in, so the page keeps its public cache", async () => {
    const a = await get(`/organizations/${ORG}`);
    const b = await get(`/organizations/${ORG}`);
    expect(a.headers.get("cache-control")).toBe("public, max-age=300");
    expect(FORM_RE.exec(await a.text())?.[0]).toBe(FORM_RE.exec(await b.text())?.[0]);
  });

  it("leaves a signed-in reader's control as it was", async () => {
    const cookie = await signIn(newEmail("f-in"));
    for (const p of PAGES) {
      const html = await (await get(p.path, { cookie })).text();
      expect(html, p.path).toContain('<form method="post" action="/account/watches" class="watch-control">');
      expect(html, p.path).not.toContain("watch-signin");
      expect(html, p.path).not.toContain('name="follow"');
    }
    const buyer = await (await get(`/buyers/${BUYER}`, { cookie })).text();
    expect(buyer).toContain('<select name="segment" aria-label="Follow"><option value="">The whole buyer</option>');
  });

  it("is not there while the switch is off", async () => {
    for (const p of PAGES) {
      const html = await (await get(p.path, { env: offEnv() })).text();
      expect(html, p.path).not.toContain("watch-signin");
      expect(html, p.path).not.toContain("/account");
      expect(html, p.path).not.toContain('name="follow"');
    }
  });
});

// -- reading follow -------------------------------------------------------------------------------

describe("the follow value", () => {
  it("reads only one watch on a page the site writes, by the watch post's rules", () => {
    expect(followOf(`organization:${ORG}`)).toEqual({ kind: "organization", target: ORG });
    expect(followOf(`buyer:${BUYER}`)).toEqual({ kind: "buyer", target: BUYER });
    expect(followOf("tender:tender:CB-100-1")).toEqual({ kind: "tender", target: "tender:cb-100-1" });
    expect(followOf("contract:contract:dnd-mdn:23240-220799/001/IM")).toEqual({ kind: "contract", target: "contract:dnd-mdn:23240-220799/001/IM" });
    for (const bad of [
      "", "organization", `:${ORG}`, `segment:43`, "organization:ORG-1", `organization:${ORG}x`, `buyer:${BUYER}:43`, "tender:cb-100-1",
      "contract:dnd-mdn:C-1", `organization:${ORG}\n`, `organization ${ORG}`, `Organization:${ORG}`, `contract:contract:dnd-mdn:${"x".repeat(FOLLOW_MAX)}`,
      "__proto__:x", "constructor:x",
    ]) {
      expect(followOf(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(followOf(undefined)).toBeNull();
    expect(followOf(null)).toBeNull();
  });
});

// -- the whole path ---------------------------------------------------------------------------------

describe("following with the sign-in", () => {
  it("by the link: the code page and the link carry follow, the page is followed once and the audit says so", async () => {
    const email = newEmail("f-link");
    const res = await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email));
    expect(res.status).toBe(200);
    const page = await text(res);
    expect(page).toContain("<h1>Check Your Email</h1>");
    expect(page).toContain('<p class="muted small">Signing in also follows the page where you pressed Follow.</p>');
    expect(page).toContain(`<input type="hidden" name="next" value="/organizations/${ORG}"/>`);
    expect(page).toContain(`<input type="hidden" name="follow" value="organization:${ORG}"/>`);
    const { mail, link } = await mailOf(email);
    expect(mail?.text).toContain(`&next=%2Forganizations%2F${ORG}&follow=organization%3A${ORG}`);
    // Opening the link changes nothing; its page carries follow to its button.
    const opened = await get(link.replace("http://localhost", ""));
    expect(opened.status).toBe(200);
    const linkPage = await text(opened);
    expect(linkPage).toContain(`<input type="hidden" name="follow" value="organization:${ORG}"/>`);
    expect(linkPage).toContain("Signing in also follows the page where you pressed Follow.");
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").bind(email).first("n")).toBe(0);
    const token = /name="token" value="([^"]+)"/.exec(linkPage)?.[1] ?? "";
    const done = await post("/account/check", { lang: "en", token, next: `/organizations/${ORG}`, follow: `organization:${ORG}` });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/organizations/${ORG}`);
    const cookie = sessionCookie(done);
    expect(cookie).toMatch(/^__Host-aw_session=/);
    const id = await userId(email);
    const rows = await watchesOf(id);
    expect(rows).toEqual([{ kind: "organization", target: ORG, segment: "", label: rows[0]?.label }]);
    expect(rows[0].label.length).toBeGreaterThan(0);
    expect(await addedAudit(id)).toEqual(["organization at sign-in"]);
    // Back on the page: Following.
    const back = await (await get(`/organizations/${ORG}`, { cookie })).text();
    expect(back).toContain('<a href="/account/watches" class="btn watch-on">Following</a>');
    expect(back).not.toContain("watch-signin");
  });

  it("by the code, in French, on a buyer's page: the whole buyer, once, whatever the next sign-in carries", async () => {
    const email = newEmail("f-code");
    const fields = await pageForm(`/buyers/${BUYER}?lang=fr`, email);
    expect(fields).toMatchObject({ lang: "fr", next: `/buyers/${BUYER}`, follow: `buyer:${BUYER}` });
    const res = await post("/account/sign-in", fields);
    const page = await text(res);
    expect(page).toContain("En vous connectant, vous suivrez aussi la page où vous avez appuyé sur Suivre.");
    expect(page).not.toContain(EM_DASH);
    const { mail, code } = await mailOf(email);
    expect(mail?.lang).toBe("fr");
    expect(mail?.text).toContain(`&lang=fr&next=%2Fbuyers%2F${BUYER}&follow=buyer%3A${BUYER}`);
    const done = await post("/account/check", { lang: "fr", email, code, sent: "1", next: `/buyers/${BUYER}`, follow: `buyer:${BUYER}` });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/buyers/${BUYER}`);
    const id = await userId(email);
    expect((await watchesOf(id)).map((w) => [w.kind, w.target, w.segment])).toEqual([["buyer", BUYER, ""]]);
    // A second sign-in from the same form: already followed, nothing added, nothing audited.
    const again = await post("/account/sign-in", fields);
    expect(again.status).toBe(200);
    const second = await mailOf(email);
    expect((await post("/account/check", { lang: "fr", email, code: second.code, sent: "1", next: `/buyers/${BUYER}`, follow: `buyer:${BUYER}` })).status).toBe(303);
    expect(await watchesOf(id)).toHaveLength(1);
    expect(await addedAudit(id)).toEqual(["buyer at sign-in"]);
    const back = await text(await get(`/buyers/${BUYER}?lang=fr`, { cookie: sessionCookie(done) }));
    expect(back).toContain('class="btn watch-on">Suivi</a>');
  });

  it("follows a tender notice and an award notice by their own targets", async () => {
    for (const p of PAGES.filter((x) => x.path.startsWith("/tenders/") || x.path.startsWith("/awards/"))) {
      const email = newEmail("f-record");
      await post("/account/sign-in", await pageForm(p.path, email));
      const { code } = await mailOf(email);
      const done = await post("/account/check", { email, code, sent: "1", next: p.path, follow: p.follow });
      expect(done.headers.get("location"), p.path).toBe(p.path);
      const id = await userId(email);
      expect((await watchesOf(id)).map((w) => `${w.kind}:${w.target}`), p.path).toEqual([p.follow]);
      expect(await addedAudit(id), p.path).toEqual([`${p.follow.split(":")[0]} at sign-in`]);
    }
  });

  it("keeps follow through a mistyped code, then follows on the right one", async () => {
    const email = newEmail("f-typo");
    await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email));
    const { code } = await mailOf(email);
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await post("/account/check", { email, code: wrong, sent: "1", next: `/organizations/${ORG}`, follow: `organization:${ORG}` });
    expect(bad.status).toBe(400);
    const html = await text(bad);
    expect(html).toContain(`<input type="hidden" name="next" value="/organizations/${ORG}"/>`);
    expect(html).toContain(`<input type="hidden" name="follow" value="organization:${ORG}"/>`);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM watches w JOIN users u ON u.id = w.user_id WHERE u.email = ?").bind(email).first("n")).toBe(0);
    const done = await post("/account/check", { email, code, sent: "1", next: `/organizations/${ORG}`, follow: `organization:${ORG}` });
    expect(done.status).toBe(303);
    expect(await watchesOf(await userId(email))).toHaveLength(1);
  });

  it("adds the watch to the account the address signs in to, never to the session the browser held before", async () => {
    const before = newEmail("f-before");
    const cookie = await signIn(before);
    const email = newEmail("f-after");
    await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email), { cookie });
    const { code } = await mailOf(email);
    const done = await post("/account/check", { email, code, sent: "1", next: `/organizations/${ORG}`, follow: `organization:${ORG}` }, { cookie });
    expect(done.status).toBe(303);
    expect(await watchesOf(await userId(before))).toEqual([]);
    expect(await watchesOf(await userId(email))).toHaveLength(1);
  });

  it("drops an invalid follow without a word, and the sign-in goes on as before", async () => {
    for (const follow of ["segment:43", "organization:ORG-1", `buyer:${BUYER}:43`, "contract:dnd-mdn:C-1", `organization:${ORG}\u0000`, "x".repeat(400)]) {
      const email = newEmail("f-bad");
      const res = await post("/account/sign-in", { lang: "en", email, next: `/organizations/${ORG}`, follow, website: "" });
      expect(res.status, follow).toBe(200);
      const page = await res.text();
      expect(page, follow).not.toContain('name="follow"');
      expect(page, follow).not.toContain("Signing in also follows");
      const { mail, code } = await mailOf(email);
      expect(mail?.text, follow).not.toContain("follow=");
      const done = await post("/account/check", { email, code, sent: "1", next: `/organizations/${ORG}`, follow });
      expect(done.status, follow).toBe(303);
      expect(done.headers.get("location"), follow).toBe(`/organizations/${ORG}`);
      expect(await watchesOf(await userId(email)), follow).toEqual([]);
    }
  });

  it("adds nothing for a well-formed page the data does not hold, and still signs in", async () => {
    const email = newEmail("f-gone");
    const follow = "organization:org-0ffffffff0";
    expect(followOf(follow)).not.toBeNull();
    await post("/account/sign-in", { lang: "en", email, next: `/organizations/${ORG}`, follow, website: "" });
    const { code } = await mailOf(email);
    const done = await post("/account/check", { email, code, sent: "1", next: `/organizations/${ORG}`, follow });
    expect(done.status).toBe(303);
    expect(await watchesOf(await userId(email))).toEqual([]);
  });

  it("at the plan's cap signs in and adds nothing; the page then shows the cap", async () => {
    const email = newEmail("f-cap");
    await signIn(email);
    const id = await userId(email);
    for (const t of ["org-a000000002", "org-a000000003", "org-a000000004"]) await watch(id, "organization", t);
    await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email));
    const { code } = await mailOf(email);
    const done = await post("/account/check", { email, code, sent: "1", next: `/organizations/${ORG}`, follow: `organization:${ORG}` });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/organizations/${ORG}`);
    expect((await watchesOf(id)).map((w) => w.target)).toEqual(["org-a000000002", "org-a000000003", "org-a000000004"]);
    expect(await addedAudit(id)).toEqual([]);
    const back = await text(await get(`/organizations/${ORG}`, { cookie: sessionCookie(done) }));
    expect(back).toContain("This account follows 3 of 3 pages. Pro follows up to 25 and sends their events by email.");
  });

  it("never fails the sign-in when the watch step fails, and logs no detail", async () => {
    const email = newEmail("f-fault");
    await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email));
    const { code } = await mailOf(email);
    const failing = {
      prepare(sql: string) {
        if (sql === ADD_WATCH_SQL) throw new Error("D1_ERROR: no such table: watches: SQLITE_ERROR");
        return ACCOUNTS.prepare(sql);
      },
      batch: (s: D1PreparedStatement[]) => ACCOUNTS.batch(s),
    } as unknown as D1Database;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const done = await post("/account/check", { email, code, sent: "1", next: `/organizations/${ORG}`, follow: `organization:${ORG}` },
      { env: onEnv({ ACCOUNTS: failing }) });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe(`/organizations/${ORG}`);
    expect(sessionCookie(done)).toMatch(/^__Host-aw_session=/);
    expect(await watchesOf(await userId(email))).toEqual([]);
    const lines = errors.mock.calls.map((c) => c.join(" "));
    expect(lines).toContain("account sign-in: the page named by Follow was not followed");
    for (const line of lines) expect(line).not.toContain(email);
  });

  it("adds nothing on a GET: the sign-in page and the link only carry follow", async () => {
    const email = newEmail("f-get");
    const cookie = await signIn(email);
    const id = await userId(email);
    // Signed in, the sign-in page goes back to the page, which offers its own Follow form.
    const signedIn = await get(`/account/sign-in?next=%2Forganizations%2F${ORG}&follow=organization%3A${ORG}`, { cookie });
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get("location")).toBe(`/organizations/${ORG}`);
    const other = newEmail("f-get2");
    await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, other));
    const { link } = await mailOf(other);
    expect((await get(link.replace("http://localhost", ""))).status).toBe(200);
    expect(await watchesOf(id)).toEqual([]);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").bind(other).first("n")).toBe(0);
  });
});

// -- the sign-in page and errors ------------------------------------------------------------------

describe("the sign-in page with follow", () => {
  it("carries follow from an old link or a no-form fallback, and drops an invalid one", async () => {
    const page = await text(await get(`/account/sign-in?next=%2Forganizations%2F${ORG}&follow=organization%3A${ORG}`));
    expect(page).toContain(`<input type="hidden" name="next" value="/organizations/${ORG}"/>`);
    expect(page).toContain(`<input type="hidden" name="follow" value="organization:${ORG}"/>`);
    expect(page).toContain("Signing in also follows the page where you pressed Follow.");
    const fr = await text(await get(`/account/sign-in?lang=fr&next=%2Forganizations%2F${ORG}&follow=organization%3A${ORG}`));
    expect(fr).toContain("En vous connectant, vous suivrez aussi la page où vous avez appuyé sur Suivre.");
    expect(fr).not.toContain(EM_DASH);
    const bad = await text(await get(`/account/sign-in?next=%2Forganizations%2F${ORG}&follow=segment%3A43`));
    expect(bad).not.toContain('name="follow"');
    expect(bad).not.toContain("Signing in also follows");
    // Its own post follows as the page's form does.
    const email = newEmail("f-page");
    const res = await post("/account/sign-in", { lang: "en", email, next: `/organizations/${ORG}`, follow: `organization:${ORG}` });
    expect(res.status).toBe(200);
    expect((await mailOf(email)).mail?.text).toContain(`&follow=organization%3A${ORG}`);
  });

  it("answers the inline form's errors on the sign-in page with the existing lines, the address, next and follow kept", async () => {
    const keeps = (html: string, typed: string) => {
      expect(html).toContain("<h1>Sign In</h1>");
      expect(html).toContain(`value="${typed}"`);
      expect(html).toContain(`<input type="hidden" name="next" value="/organizations/${ORG}"/>`);
      expect(html).toContain(`<input type="hidden" name="follow" value="organization:${ORG}"/>`);
    };
    const form = (email: string) => pageForm(`/organizations/${ORG}`, email);
    const incomplete = await post("/account/sign-in", await form("not-an-address"));
    expect(incomplete.status).toBe(400);
    const a = await text(incomplete);
    expect(a).toContain("Enter a complete email address.");
    keeps(a, "not-an-address");
    const trapped = newEmail("f-trap");
    const trap = await post("/account/sign-in", { ...(await form(trapped)), website: "spam.example" });
    expect(trap.status).toBe(400);
    const b = await text(trap);
    expect(b).toContain("The form could not be sent. Try again.");
    keeps(b, trapped);
    expect(await lastMail(trapped)).toBeNull();
    const busy = newEmail("f-limit");
    for (let i = 0; i < CODES_PER_HOUR; i++) expect((await post("/account/sign-in", await form(busy))).status).toBe(200);
    const limited = await post("/account/sign-in", await form(busy));
    expect(limited.status).toBe(429);
    const c = await text(limited);
    expect(c).toContain("This address has asked for 5 codes in the last hour.");
    keeps(c, busy);
    const unsent = newEmail("f-unsent");
    const stub = await post("/account/sign-in", await form(unsent), { env: onEnv({ MAIL_SENDER: undefined }) });
    expect(stub.status).toBe(503);
    const d = await text(stub);
    expect(d).toContain("The message could not be sent. Sign-in by email is not available yet; try again later.");
    keeps(d, unsent);
  });
});

// -- the hour's ceiling on Follow posts --------------------------------------------------------------------

describe("the hour's ceiling on sign-in messages asked for through a Follow form", () => {
  const FOLLOW_ROWS = "event = 'code_requested' AND detail = 'follow'";
  const clear = () => ACCOUNTS.prepare(`DELETE FROM audit WHERE ${FOLLOW_ROWS}`).run();
  const seed = async (n: number, at: Date) => {
    const row = ACCOUNTS.prepare("INSERT INTO audit (user_id, event, at, detail) VALUES (NULL, 'code_requested', ?, 'follow')");
    for (let i = 0; i < n; i += 50) await ACCOUNTS.batch(Array.from({ length: Math.min(50, n - i) }, () => row.bind(at.toISOString())));
  };
  const marked = async () => ACCOUNTS.prepare(`SELECT COUNT(*) AS n FROM audit WHERE ${FOLLOW_ROWS}`).first<number>("n");

  it("marks a Follow form's request in the audit, and the sign-in page's own request not", async () => {
    await clear();
    await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, newEmail("f-mark")));
    expect(await marked()).toBe(1);
    await post("/account/sign-in", { lang: "en", email: newEmail("f-plain") });
    expect(await marked()).toBe(1);
    await clear();
  });

  it("past it, sends nothing and answers the sign-in page, in French too; that page's own post still sends", async () => {
    await clear();
    await seed(FOLLOW_CODES_PER_HOUR, new Date(Date.now() - 60_000));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const email = newEmail("f-ceiling");
      const res = await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email));
      expect(res.status).toBe(200);
      const html = await text(res);
      expect(html).toContain("<h1>Sign In</h1>");
      expect(html).toContain(`value="${email}"`);
      expect(html).toContain(`<input type="hidden" name="next" value="/organizations/${ORG}"/>`);
      expect(html).not.toContain('name="follow"');
      expect(html).toContain('<p class="account-notice" role="status">To follow that page, sign in here, then press Follow on it.</p>');
      expect(await lastMail(email)).toBeNull();
      expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM magic_codes WHERE email = ?").bind(email).first("n")).toBe(0);
      expect(await marked()).toBe(FOLLOW_CODES_PER_HOUR);
      expect(log.mock.calls.map((c) => c.join(" "))).toContain("account sign-in: the hour's Follow requests are spent, answered with the sign-in page");
      const fr = await text(await post("/account/sign-in", { ...(await pageForm(`/organizations/${ORG}`, newEmail("f-plafond"))), lang: "fr" }));
      expect(fr).toContain("Pour suivre cette page, connectez-vous ici, puis appuyez sur Suivre sur la page.");
      // The sign-in page's own post carries no follow and is held to no ceiling.
      const again = await post("/account/sign-in", { lang: "en", email, next: `/organizations/${ORG}` });
      expect(again.status).toBe(200);
      expect(await lastMail(email)).not.toBeNull();
    } finally {
      await clear();
    }
  });

  it("counts the last hour only, and one request under the ceiling goes through", async () => {
    await clear();
    await seed(FOLLOW_CODES_PER_HOUR, new Date(Date.now() - 61 * 60_000));
    await seed(FOLLOW_CODES_PER_HOUR - 1, new Date(Date.now() - 60_000));
    try {
      const email = newEmail("f-under");
      await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email));
      expect(await lastMail(email)).not.toBeNull();
      // That request was the hour's last.
      const next = newEmail("f-over");
      await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, next));
      expect(await lastMail(next)).toBeNull();
    } finally {
      await clear();
    }
  });

  it("lets the post through when the count cannot be read", async () => {
    await clear();
    const failing = {
      prepare(sql: string) {
        if (sql === FOLLOW_CODES_SQL) throw new Error("D1_ERROR: no such table: audit: SQLITE_ERROR");
        return ACCOUNTS.prepare(sql);
      },
      batch: (s: D1PreparedStatement[]) => ACCOUNTS.batch(s),
    } as unknown as D1Database;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const email = newEmail("f-uncounted");
    const res = await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email), { env: onEnv({ ACCOUNTS: failing }) });
    expect(res.status).toBe(200);
    expect(await lastMail(email)).not.toBeNull();
    expect(errors.mock.calls.map((c) => c.join(" "))).toContain("account sign-in: the hour's Follow requests not counted, let through");
    await clear();
  });
});

// -- the guard against scripts ---------------------------------------------------------------------------

describe("a post that carries follow without a page's headers", () => {
  it("sends nothing and answers the sign-in page with the address kept and the follow dropped", async () => {
    const email = newEmail("f-script");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email), { origin: null });
    expect(res.status).toBe(200);
    const html = await text(res);
    expect(html).toContain("<h1>Sign In</h1>");
    expect(html).toContain(`value="${email}"`);
    expect(html).toContain(`<input type="hidden" name="next" value="/organizations/${ORG}"/>`);
    expect(html).not.toContain('name="follow"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('<p class="account-notice" role="status">To follow that page, sign in here, then press Follow on it.</p>');
    expect(await lastMail(email)).toBeNull();
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM magic_codes WHERE email = ?").bind(email).first("n")).toBe(0);
    expect(log.mock.calls.map((c) => c.join(" "))).toContain("account sign-in: a Follow post without a page's headers, answered with the sign-in page");
    // That page's own post, without follow, signs in as before, headers or not.
    const again = await post("/account/sign-in", { lang: "en", email, next: `/organizations/${ORG}` }, { origin: null });
    expect(again.status).toBe(200);
    expect(await lastMail(email)).not.toBeNull();
  });

  it("goes through on any one of the headers a browser sends from the site's page, and not on another site's", async () => {
    const cases: [Record<string, string>, boolean][] = [
      [{ "sec-fetch-site": "same-origin" }, true],
      [{ referer: `http://localhost/organizations/${ORG}` }, true],
      [{ "sec-fetch-site": "cross-site" }, false],
      [{ "sec-fetch-site": "none" }, false],
      [{ referer: "https://elsewhere.example/" }, false],
    ];
    for (const [headers, sent] of cases) {
      const email = newEmail("f-headers");
      const res = await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email), { origin: null, headers });
      expect(res.status, JSON.stringify(headers)).toBe(200);
      expect(!!(await lastMail(email)), JSON.stringify(headers)).toBe(sent);
    }
    // The site's Origin, as the helper sends it: through.
    const email = newEmail("f-origin");
    await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, email));
    expect(await lastMail(email)).not.toBeNull();
    // Another site's Origin is refused before anything, follow or not.
    expect((await post("/account/sign-in", await pageForm(`/organizations/${ORG}`, newEmail("f-evil")), { origin: "https://evil.example" })).status).toBe(403);
  });

  it("keeps a sign-in post without follow exactly as before, with no headers at all", async () => {
    const email = newEmail("f-plain");
    const res = await post("/account/sign-in", { email }, { origin: null });
    expect(res.status).toBe(200);
    expect(await text(res)).toContain("<h1>Check Your Email</h1>");
    expect(await lastMail(email)).not.toBeNull();
  });
});

// -- the switch -------------------------------------------------------------------------------------------

describe("with the switch off", () => {
  it("answers the sign-in post with the site's 404, follow or not", async () => {
    const res = await post("/account/sign-in", { email: newEmail("f-off"), follow: `organization:${ORG}` }, { env: testEnv() });
    expect(res.status).toBe(404);
  });
});
