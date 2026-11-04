// The accounts-open message (src/account/announce.tsx, the /admin/announce
// pages in admin.tsx) and the link it carries off the email lists
// (/interest/stop), against the local forms and accounts databases. The
// console runs with the log sender, so each message lands in the development
// outbox (sent_mail); the runs that test the binding's path call
// runAnnouncement with a fake MAIL binding that records what it is handed.
//
// Other tests in this file leave addresses on the lists, and a run takes
// every address waiting, so each check reads its own addresses' rows and
// messages; a run that must start from an empty queue drains it first.
import { describe, expect, it, vi } from "vitest";
import { ANNOUNCE_MAX, PAGE_SIZE, accountsOpenMessage, announceLinks, runAnnouncement } from "../src/account/announce";
import { bucketFor } from "../src/limits";
import { INSERT_INTEREST, newToken } from "../src/pages/interest";
import { ACCOUNTS, DB, csrf, decode, get, lastMail, nbsp, newEmail, offEnv, onEnv, post, signIn, useAccountsDb, userId } from "./accounts-helpers";

useAccountsDb();

const SITE = "https://awardwatch.ca";
const LOCAL = "http://localhost";
const EM_DASH = String.fromCharCode(0x2014);

// -- the people and their lists ------------------------------------------------------------------

type Operator = { email: string; id: string; cookie: string; csrf: string; env: Record<string, unknown> };

async function operator(): Promise<Operator> {
  const email = newEmail("op");
  const env = onEnv({ OPERATOR_EMAILS: email });
  const cookie = await signIn(email, { env });
  return { email, id: await userId(email), cookie, csrf: await csrf(cookie, "/account", { env }), env };
}

const LISTS: Record<string, [kind: string, params: string, en: string, fr: string]> = {
  all: ["tenders", "/tenders", "Every new tender notice", "Chaque nouvel avis d'appel d'offres"],
  radar: ["expiring", "/expiring/3m?fye=0&sosa=0", "Contracts entering the 3-month window for every buyer and segment",
    "Contrats qui entrent dans la période de 3 mois pour tous les acheteurs et segments"],
  segment: ["segment", "/segments/43", "New tender notices and award notices in segment 43 Information Technology",
    "Nouveaux avis d'appel d'offres et d'attribution dans le segment 43 Technologies de l'information"],
};

let clock = 0;

// One row per list for the address, in the language given; the tokens in row order.
async function signUp(email: string, lists: (keyof typeof LISTS)[], lang: "en" | "fr" = "en"): Promise<string[]> {
  const tokens: string[] = [];
  for (const name of lists) {
    const [kind, params, en, fr] = LISTS[name];
    const token = newToken();
    const at = new Date(Date.UTC(2026, 9, 1) + ++clock * 1000).toISOString();
    await DB.prepare(INSERT_INTEREST).bind(email, kind, params, lang === "fr" ? fr : en, lang, at, token).run();
    tokens.push(token);
  }
  return tokens;
}

type Row = { email: string; notice_at: string | null; unsubscribed_at: string | null; token: string };
const rowsOf = async (email: string) =>
  (await DB.prepare("SELECT email, notice_at, unsubscribed_at, token FROM interest WHERE email = ? ORDER BY id").bind(email).all<Row>()).results ?? [];
const rowsByToken = async (token: string) =>
  (await DB.prepare("SELECT email, notice_at, unsubscribed_at, token FROM interest WHERE token = ?").bind(token).all<Row>()).results ?? [];

const outbox = async (to: string) =>
  (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM sent_mail WHERE to_addr = ?").bind(to).first<{ n: number }>())?.n ?? 0;

async function holdAccount(email: string): Promise<void> {
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active')")
    .bind(newToken(), email).run();
}

type Handed = { to: string; subject: string; text?: string; html?: string; headers?: Record<string, string>; from?: unknown };

function fakeMail(fail: (to: string) => unknown = () => undefined) {
  const handed: Handed[] = [];
  const binding = {
    async send(message: Handed) {
      handed.push(message);
      const error = fail(message.to);
      if (error !== undefined) throw error;
      return { messageId: "<test@awardwatch.ca>" };
    },
  } as unknown as SendEmail;
  return { handed, binding, to: (email: string) => handed.filter((m) => m.to === email) };
}

const refused = (code: string) => Object.assign(new Error("refused"), { code });

// The site's own binding path: no log sender, a request that is not local.
const bindingEnv = (mail: SendEmail) => onEnv({ MAIL: mail, MAIL_FROM: "alerts@awardwatch.ca", MAIL_SENDER: undefined });
const runBinding = (mail: SendEmail, max?: number) =>
  runAnnouncement(bindingEnv(mail) as never, SITE, `${SITE}/admin/announce`, new Date(), max);

// Every address waiting gets its message through the outbox, so the next run starts from an empty queue.
async function drain(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const r = await runAnnouncement(onEnv() as never, LOCAL, `${LOCAL}/admin/announce`);
    if (r.sent + r.failed === 0) return;
  }
}

const text = async (res: Response) => nbsp(decode(await res.text()));

// -- the console ------------------------------------------------------------------------------------

describe("the console's page", () => {
  it("shows the counts, what a run does, the form and the message in both languages", async () => {
    const op = await operator();
    await signUp(newEmail("page"), ["all"]);
    const res = await get("/admin/announce", { cookie: op.cookie, env: op.env });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await text(res);
    expect(html).toContain("Accounts-Open Message");
    expect(html).toContain(`At most ${ANNOUNCE_MAX} a run; run it again to go on.`);
    expect(html).toMatch(/Addresses that have not had it: [1-9]/);
    expect(html).toContain("Each address is marked when its message goes, so no run sends it twice.");
    expect(html).toContain('<form method="post" action="/admin/announce" class="stack">');
    expect(html).toContain(`Send up to ${ANNOUNCE_MAX} messages`);
    expect(html).toContain("Award Watch accounts are open");
    expect(html).toContain("Les comptes Award Watch sont ouverts");
    expect(html).toContain(`${LOCAL}/interest/stop?t=${"0".repeat(32)}&lang=fr`);
    // The overview links it.
    expect(await text(await get("/admin", { cookie: op.cookie, env: op.env }))).toContain('<a href="/admin/announce" class="btn">Accounts-open message</a>');
  });

  it("offers no form when mail cannot leave, or before notice_at is on the forms database", async () => {
    const op = await operator();
    const stub = await text(await get("/admin/announce", { cookie: op.cookie, env: { ...op.env, MAIL_SENDER: undefined } }));
    expect(stub).toContain("Mail cannot be sent from here: the MAIL binding or MAIL_FROM is missing.");
    expect(stub).not.toContain('action="/admin/announce"');
    const old = { batch: async () => { throw new Error("D1_ERROR: no such column: notice_at: SQLITE_ERROR"); }, prepare: (s: string) => DB.prepare(s) };
    const before = await text(await get("/admin/announce", { cookie: op.cookie, env: { ...op.env, DB: old } }));
    expect(before).toContain("The interest table has no notice_at column yet.");
    expect(before).not.toContain('action="/admin/announce"');
    const res = await post("/admin/announce", { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: { ...op.env, DB: old } });
    expect(res.status).toBe(400);
  });

  it("sends nothing without the box ticked, the CSRF value or the site's Origin", async () => {
    const op = await operator();
    const email = newEmail("unticked");
    await signUp(email, ["all"]);
    expect((await post("/admin/announce", { csrf: op.csrf }, { cookie: op.cookie, env: op.env })).status).toBe(400);
    expect((await post("/admin/announce", { csrf: "0".repeat(32), confirm: "yes" }, { cookie: op.cookie, env: op.env })).status).toBe(403);
    expect((await post("/admin/announce", { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: op.env, origin: null })).status).toBe(403);
    expect(await outbox(email)).toBe(0);
    expect((await rowsOf(email)).every((r) => r.notice_at === null)).toBe(true);
  });
});

describe("a run from the console", () => {
  it("sends one plain message to each address without an account, in its language, marks it, and writes the audit row", async () => {
    const op = await operator();
    const en = newEmail("open-en");
    const fr = newEmail("open-fr");
    const holder = newEmail("open-holder");
    const left = newEmail("open-left");
    const [enFirst] = await signUp(en, ["all", "radar"]);
    const [frFirst] = await signUp(fr, ["segment"], "fr");
    await signUp(holder, ["all"]);
    await holdAccount(holder);
    await signUp(left, ["all"]);
    await DB.prepare("UPDATE interest SET unsubscribed_at = ? WHERE email = ?").bind(new Date().toISOString(), left).run();

    const res = await post("/admin/announce", { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: op.env });
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!, LOCAL);
    expect(location.pathname).toBe("/admin/announce");
    expect(location.searchParams.get("m")).toBe("done");
    expect(Number(location.searchParams.get("sent"))).toBeGreaterThanOrEqual(2);
    expect(Number(location.searchParams.get("accounts"))).toBeGreaterThanOrEqual(1);
    const after = await text(await get(`${location.pathname}${location.search}`, { cookie: op.cookie, env: op.env }));
    expect(after).toMatch(/Messages sent: [0-9]+\. Not sent: 0\. Passed over, holding an account: [0-9]+\. Addresses that have not had it: [0-9]+\./);

    const m = (await lastMail(en))!;
    expect(m.subject).toBe("Award Watch accounts are open");
    expect(m.lang).toBe("en");
    expect(m.text.startsWith([
      "Accounts are open on Award Watch.",
      "This address is signed up for these email lists:\n- Every new tender notice\n- Contracts entering the 3-month window for every buyer and segment",
      "Sign in with this address and each list is offered to the account as a saved search. Email delivery of a saved search is part of the Pro plan.",
      `Sign in: ${LOCAL}/account/sign-in`,
      `This is the only message about these lists.\nTake this address off the lists: ${LOCAL}/interest/stop?t=${enFirst}`,
      "You receive this because the address was entered on the site's email lists form.\nAward Watch · ",
    ].join("\n\n"))).toBe(true);
    expect(m.text).toMatch(/\ncontact@awardwatch\.ca\n$/);
    expect(m.html).toContain(`<a href="${LOCAL}/interest/stop?t=${enFirst}">Take this address off the lists</a>`);
    expect(m.html).toContain("<li>Every new tender notice</li>");
    for (const part of [m.subject, m.text, m.html]) expect(part).not.toContain(EM_DASH);

    const f = (await lastMail(fr))!;
    expect(nbsp(f.subject)).toBe("Les comptes Award Watch sont ouverts");
    expect(f.lang).toBe("fr");
    expect(nbsp(f.text)).toContain("Cette adresse est inscrite à ces listes de diffusion :\n- Nouveaux avis d'appel d'offres et d'attribution dans le segment 43");
    expect(nbsp(f.text)).toContain(`Se connecter : ${LOCAL}/account/sign-in?lang=fr`);
    expect(nbsp(f.text)).toContain(`Retirer cette adresse des listes : ${LOCAL}/interest/stop?t=${frFirst}&lang=fr`);

    expect(await lastMail(holder)).toBeNull();
    expect(await lastMail(left)).toBeNull();
    expect((await rowsOf(en)).map((r) => r.notice_at)).toEqual([expect.any(String), expect.any(String)]);
    expect((await rowsOf(fr))[0].notice_at).not.toBeNull();
    expect((await rowsOf(holder))[0].notice_at).toBeNull();

    const audit = await ACCOUNTS.prepare("SELECT user_id, detail FROM audit WHERE event = 'operator_announced' ORDER BY id DESC LIMIT 1")
      .first<{ user_id: string | null; detail: string }>();
    expect(audit?.user_id).toBeNull();
    expect(audit?.detail).toMatch(new RegExp(`^by ${op.id}, [0-9]+ sent, 0 not sent, [0-9]+ holding an account, [0-9]+ left$`));
    expect(audit?.detail).not.toContain("@");

    // The next run sends none of them again.
    expect((await post("/admin/announce", { csrf: op.csrf, confirm: "yes" }, { cookie: op.cookie, env: op.env })).status).toBe(303);
    expect(await outbox(en)).toBe(1);
    expect(await outbox(fr)).toBe(1);
    // A list the address joins later does not bring the message back.
    await signUp(en, ["segment"]);
    await drain();
    expect(await outbox(en)).toBe(1);
  });
});

describe("the run", () => {
  it("holds to its cap and goes on in the next run", async () => {
    await drain();
    const three = [newEmail("cap"), newEmail("cap"), newEmail("cap")];
    for (const email of three) await signUp(email, ["all"]);
    const first = await runAnnouncement(onEnv() as never, LOCAL, `${LOCAL}/admin/announce`, new Date(), 2);
    expect(first.sent).toBe(2);
    expect(first.left).toBeGreaterThanOrEqual(1);
    const marked = async () => (await Promise.all(three.map(async (e) => (await rowsOf(e))[0].notice_at !== null))).filter(Boolean).length;
    expect(await marked()).toBe(2);
    const second = await runAnnouncement(onEnv() as never, LOCAL, `${LOCAL}/admin/announce`, new Date(), 2);
    expect(second.sent).toBe(1);
    expect(await marked()).toBe(3);
    expect(ANNOUNCE_MAX).toBe(300);
    expect(PAGE_SIZE).toBeLessThanOrEqual(50);
  });

  it("goes through the binding with the headers, stops at a daily limit, and gives the address back", async () => {
    await drain();
    const email = newEmail("binding");
    const [token] = await signUp(email, ["all"]);
    const spent = fakeMail(() => refused("E_DAILY_LIMIT_EXCEEDED"));
    const stopped = await runBinding(spent.binding);
    expect(stopped.stopped).toBe("E_DAILY_LIMIT_EXCEEDED");
    expect(stopped.sent).toBe(0);
    expect(spent.handed).toHaveLength(1);
    expect((await rowsOf(email))[0].notice_at).toBeNull();
    // A refusal for that address alone: counted, given back, tried again next run.
    const suppressed = fakeMail(() => refused("E_RECIPIENT_SUPPRESSED"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const failed = await runBinding(suppressed.binding);
    expect(failed).toMatchObject({ sent: 0, failed: 1, stopped: null });
    expect((await rowsOf(email))[0].notice_at).toBeNull();
    const ok = fakeMail();
    expect((await runBinding(ok.binding)).sent).toBe(1);
    const [m] = ok.to(email);
    expect(m.from).toEqual({ email: "alerts@awardwatch.ca", name: "Award Watch" });
    expect(m.headers?.["List-Unsubscribe"]).toBe(`<mailto:contact@awardwatch.ca>, <${SITE}/interest/stop?t=${token}>`);
    expect(m.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(m.headers?.["Auto-Submitted"]).toBe("auto-generated");
    expect((await rowsOf(email))[0].notice_at).not.toBeNull();
  });

  it("sends an address once when two runs meet", async () => {
    await drain();
    const email = newEmail("twice");
    await signUp(email, ["all", "radar"]);
    const mail = fakeMail();
    await Promise.all([runBinding(mail.binding), runBinding(mail.binding)]);
    expect(mail.to(email)).toHaveLength(1);
  });
});

describe("the message", () => {
  it("names at most ten lists, escapes what it quotes, and keeps an http link out of List-Unsubscribe", () => {
    const labels = Array.from({ length: 12 }, (_, i) => `List <${i}> & more`);
    const m = accountsOpenMessage("en", "reader@example.com", labels, announceLinks(LOCAL, "en", "a".repeat(32)));
    expect(m.text.match(/^- /gm)).toHaveLength(10);
    expect(m.text).toContain("\nAnd 2 more.");
    expect(m.html).toContain("<li>List &lt;0&gt; &amp; more</li>");
    expect(m.html).not.toContain("<0>");
    expect(m.headers).toEqual({});
    const fr = accountsOpenMessage("fr", "lecteur@example.com", labels.slice(0, 11), announceLinks(SITE, "fr", "b".repeat(32)));
    expect(fr.text).toContain("Et 1 autre.");
    expect(fr.headers["List-Unsubscribe"]).toBe(`<mailto:contact@awardwatch.ca>, <${SITE}/interest/stop?t=${"b".repeat(32)}&lang=fr>`);
  });
});

// -- leaving the lists ---------------------------------------------------------------------------------

describe("the link off the lists", () => {
  it("shows the address's lists and a button on GET, and changes nothing", async () => {
    const email = newEmail("leave-get");
    const [token] = await signUp(email, ["all", "segment"]);
    const res = await get(`/interest/stop?t=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const html = await text(res);
    expect(html).toContain("Leave the Email Lists");
    expect(html).toContain("<li>Every new tender notice</li>");
    expect(html).toContain("<li>New tender notices and award notices in segment 43 Information Technology</li>");
    expect(html).toContain(`name="t" value="${token}"`);
    expect(html).not.toContain(email);
    expect((await rowsOf(email)).every((r) => r.unsubscribed_at === null)).toBe(true);
  });

  it("takes the address off on POST: every row unsubscribed and the address replaced", async () => {
    const email = newEmail("leave-post");
    const [, second] = await signUp(email, ["all", "radar"]);
    // Either row's token takes the whole address off.
    const res = await post("/interest/stop", { t: second, lang: "fr" });
    expect(res.status).toBe(200);
    expect(await text(res)).toContain("Adresse retirée");
    expect(await rowsOf(email)).toEqual([]);
    const [row] = await rowsByToken(second);
    expect(row.email).toMatch(/^removed:[0-9a-f]{64}$/);
    expect(row.unsubscribed_at).not.toBeNull();
    // The link again: the page says so, with no button.
    const again = await text(await get(`/interest/stop?t=${second}`));
    expect(again).toContain("Address Removed");
    expect(again).not.toContain('action="/interest/stop"');
    // The address is no longer waiting for the message, nor offered at sign-in.
    const cookie = await signIn(email);
    expect(await text(await get("/account/searches", { cookie }))).not.toContain('action="/account/searches/import"');
  });

  it("takes the address off on a mail client's one-click POST, with no page and no Origin, whatever the switch", async () => {
    const email = newEmail("leave-oneclick");
    const [token] = await signUp(email, ["all"]);
    const res = await post(`/interest/stop?t=${token}`, { "List-Unsubscribe": "One-Click" }, { origin: null, env: offEnv() });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("The address is off the email lists.");
    expect(await rowsOf(email)).toEqual([]);
  });

  it("answers the site's 404 for a token that matches nothing or is not one", async () => {
    for (const t of ["f".repeat(32), "nope", "", "F".repeat(32)]) {
      expect((await get(`/interest/stop?t=${t}`)).status, t).toBe(404);
      expect((await post("/interest/stop", { t })).status, t).toBe(404);
    }
  });

  it("counts against the stop links' limit", () => {
    expect(bucketFor("GET", "/interest/stop")).toBe("stop");
    expect(bucketFor("POST", "/interest/stop")).toBe("stop");
  });
});
