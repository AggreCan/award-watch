// The weekly email (src/account/weekly.ts, digests.ts weeklyDigest, the
// sign-in pages and the account page in pages.tsx, routes.tsx; docs/accounts.md,
// Weekly email): the box on the sign-in form, never ticked by the site; the
// choice carried through the sign-in by the code and by the link and recorded
// only once the address has proved itself, never failing the sign-in; the
// account page's control; the message with and without the watches' news, in
// English and in French, byte for byte; the run's day, once a week, its
// ceiling, a deleted, blocked or newly enrolled account, a refusal, a sending
// limit, the records database behind, the unset mailing address; the
// unsubscribe link by a POST and by one click; the table missing, which leaves
// the feature out whole; and the switch off. Every expected line is written
// out here, never read back from the code under test.
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import accountsSchema from "../accounts_schema.sql?raw";
import { runDeliveries } from "../src/account/deliveries";
import { deliveryHeaders, weeklyDigest } from "../src/account/digests";
import { KINDS_FOR } from "../src/account/watch_events";
import { WEEKLY_DUE_SQL, WEEKLY_RUN_MAX, WEEK_AWARDS_SQL, mailAddress } from "../src/account/weekly";
import {
  ACCOUNTS, csrf, decode, get, lastMail, nbsp, newEmail, offEnv, onEnv, post, sessionCookie, signIn, useAccountsDb, userId,
} from "./accounts-helpers";
import { FILES, makeFakeAssets } from "./assets";
import { SAMPLE_ADDRESS, fakeMail, tender, weeklyInput } from "./mail-fixtures";
import { applySql, splitSql } from "./setup";

useAccountsDb();

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const RECORDS_SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const SITE = "https://awardwatch.ca";
const FROM = "alerts@awardwatch.ca";
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const D = "2026-11-02"; // a Monday, the week's opening day
const ORG = "org-e000000001";
const ORG_NUMBER = 0xe000000001;

const text = async (res: Response) => nbsp(decode(await res.text())).replace(/’/g, "'");

const LABEL_EN = "Send me the weekly email: each Monday, what changed on the pages I follow, or the week on the site in figures. " +
  "Each message has a link to unsubscribe.";
const LABEL_FR = "Envoyez-moi le courriel hebdomadaire : chaque lundi, ce qui a changé sur les pages que je suis, ou la semaine du site en " +
  "chiffres. Chaque message contient un lien de désabonnement.";
const BOX_HTML = `<label class="account-check"><input type="checkbox" name="weekly" value="1"/><span>${LABEL_EN}</span></label>`;
const NOTE_EN = "Signing in also turns on the weekly email.";
const NOTE_FR = "En vous connectant, vous activerez aussi le courriel hebdomadaire.";
const FIELD_HTML = '<input type="hidden" name="weekly" value="1"/>';

type Row = { mail: string; via: string; on_at: string; off_at: string | null; last_week: string | null; last_status: string | null; failed_week: string | null };
const rowOf = (user: string) =>
  ACCOUNTS.prepare("SELECT mail, via, on_at, off_at, last_week, last_status, failed_week FROM weekly_mail WHERE user_id = ?").bind(user).first<Row>();
const audits = async (user: string) =>
  ((await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE user_id = ? AND event LIKE 'weekly_%' ORDER BY id").bind(user)
    .all<{ event: string; detail: string | null }>()).results ?? []).map((r) => `${r.event} ${r.detail}`);

// The table taken off the database for the length of fn, then made again
// from accounts_schema.sql: the database as it stands before the operator
// applies the schema.
const WEEKLY_SCHEMA = splitSql(accountsSchema).filter((s) => s.includes("weekly_mail"));
async function withoutTable<T>(fn: () => Promise<T>): Promise<T> {
  await ACCOUNTS.prepare("DROP TABLE IF EXISTS weekly_mail").run();
  try {
    return await fn();
  } finally {
    await ACCOUNTS.batch(WEEKLY_SCHEMA.map((s) => ACCOUNTS.prepare(s)));
  }
}

// The sign-in page's own form as a browser posts it: its hidden fields, the address, the box as given.
function formOf(html: string, email: string, tick: boolean): Record<string, string> {
  const form = /<form method="post" action="\/account\/sign-in" class="stack">[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
  const fields: Record<string, string> = {};
  for (const m of form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"\/>/g)) fields[m[1]] = decode(m[2]);
  return { ...fields, email, website: "", ...(tick ? { weekly: "1" } : {}) };
}

const mailOf = async (email: string) => {
  const mail = await lastMail(email);
  return { mail, code: /([0-9]{6})/.exec(mail?.text ?? "")?.[1] ?? "", link: /http:\/\/localhost\/account\/check\?[^\s"]+/.exec(mail?.text ?? "")?.[0] ?? "" };
};

// -- the box on the sign-in form ---------------------------------------------------------------------

describe("the sign-in form's box", () => {
  it("is there, never ticked, in English and in French, and the page has one filled button", async () => {
    const html = await (await get("/account/sign-in")).text();
    expect(decode(html)).toContain(BOX_HTML.replace(/&#39;/g, "'"));
    expect(html).not.toMatch(/name="weekly"[^>]*checked/);
    expect(html.match(/class="btn btn-primary"/g)).toHaveLength(1);
    expect(html).not.toContain(EM_DASH);
    expect(html).not.toContain(EN_DASH);
    const fr = await text(await get("/account/sign-in?lang=fr"));
    expect(fr).toContain(`<span>${LABEL_FR.replace(/’/g, "'")}</span>`);
    // A ticked post answered with an error shows the box again, unticked: the site never ticks it.
    const bad = await post("/account/sign-in", { email: "not-an-address", weekly: "1", website: "" });
    expect(bad.status).toBe(400);
    const again = await bad.text();
    expect(again).toContain('<input type="checkbox" name="weekly" value="1"/>');
    expect(again).not.toContain(FIELD_HTML);
    // An address cannot tick it for anyone: the page reads no weekly= from its address.
    expect(await (await get("/account/sign-in?weekly=1")).text()).toBe(html);
  });

  // With the box goes its line in the list of what a free account gives (account/pages.tsx FreePanel): the
  // list names the weekly email only while the form offers it.
  const FREE_LINE = /<li><svg class="plan-mark"[^>]*><path [^>]*><\/path><\/svg><span>The weekly email, each Monday<\/span><\/li>/;

  it("is, with its line in the free account's list, the page's only difference from the page without the table", async () => {
    const withTable = await (await get("/account/sign-in?next=%2Ftenders")).text();
    const without = await withoutTable(async () => (await get("/account/sign-in?next=%2Ftenders")).text());
    expect(withTable.split('name="weekly"').length - 1).toBe(1);
    expect(withTable).toMatch(FREE_LINE);
    expect(without).not.toContain('name="weekly"');
    expect(without).not.toContain("weekly email");
    expect(decode(withTable).replace(BOX_HTML, "").replace(FREE_LINE, "")).toBe(decode(without));
  });
});

// -- turning it on with the sign-in ------------------------------------------------------------------

describe("turning the weekly email on with the sign-in", () => {
  it("by the link: the code page and the link carry it, nothing is kept before the address proves itself, then it is on", async () => {
    const email = newEmail("w-link");
    const fields = formOf(await (await get("/account/sign-in")).text(), email, true);
    const res = await post("/account/sign-in", fields);
    expect(res.status).toBe(200);
    const page = await text(res);
    expect(page).toContain(`<p class="muted small">${NOTE_EN}</p>`);
    expect(page).toContain(FIELD_HTML);
    const { mail, link } = await mailOf(email);
    expect(mail?.text).toMatch(/\/account\/check\?token=[0-9a-f.]+&weekly=1(?:\s|$)/);
    const opened = await text(await get(link.replace("http://localhost", "")));
    expect(opened).toContain(NOTE_EN);
    expect(opened).toContain(FIELD_HTML);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").bind(email).first("n")).toBe(0);
    const token = /name="token" value="([^"]+)"/.exec(opened)?.[1] ?? "";
    const done = await post("/account/check", { lang: "en", token, weekly: "1" });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/account");
    const id = await userId(email);
    expect(await rowOf(id)).toMatchObject({ mail: "on", via: "sign_in", off_at: null, last_week: null });
    expect(await audits(id)).toEqual(["weekly_on at sign-in"]);
    // The overview says so.
    const overview = await text(await get("/account", { cookie: sessionCookie(done) }));
    expect(overview).toContain("<dt>Weekly email</dt>");
    expect(overview).toMatch(/<input type="hidden" name="mail" value="off"\/><span>On<\/span><button type="submit" class="btn-link">Turn off<\/button>/);
  });

  it("by the code, in French, with the page to return to kept, and through a mistyped code", async () => {
    const email = newEmail("w-code");
    const fields = formOf(await (await get("/account/sign-in?lang=fr&next=%2Ftenders")).text(), email, true);
    expect(fields).toMatchObject({ lang: "fr", next: "/tenders", weekly: "1" });
    const page = await text(await post("/account/sign-in", fields));
    expect(page).toContain(NOTE_FR.replace(/’/g, "'"));
    const { mail, code } = await mailOf(email);
    expect(mail?.lang).toBe("fr");
    expect(mail?.text).toContain("&lang=fr&next=%2Ftenders&weekly=1");
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await post("/account/check", { lang: "fr", email, code: wrong, sent: "1", next: "/tenders", weekly: "1" });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain(FIELD_HTML);
    const done = await post("/account/check", { lang: "fr", email, code, sent: "1", next: "/tenders", weekly: "1" });
    expect(done.status).toBe(303);
    expect(done.headers.get("location")).toBe("/tenders");
    expect(await rowOf(await userId(email))).toMatchObject({ mail: "on", via: "sign_in" });
  });

  it("enrols no one who did not tick it: an account signed in without the box has no row", async () => {
    const email = newEmail("w-none");
    await signIn(email);
    expect(await rowOf(await userId(email))).toBeNull();
    // A link or a code post that names weekly without the box's request still enrols only by the owner's own sign-in.
    expect(await audits(await userId(email))).toEqual([]);
  });

  it("turns an email that was turned off back on, and leaves one that is on as it is", async () => {
    const email = newEmail("w-again");
    await signIn(email);
    const id = await userId(email);
    await ACCOUNTS.prepare("INSERT INTO weekly_mail (user_id, mail, via, on_at, off_at, created_at) VALUES (?, 'off', 'account', ?, ?, ?)")
      .bind(id, "2026-10-01T00:00:00.000Z", "2026-10-05T00:00:00.000Z", "2026-10-01T00:00:00.000Z").run();
    const sign = async () => {
      await post("/account/sign-in", { email, weekly: "1", website: "" });
      const { code } = await mailOf(email);
      expect((await post("/account/check", { email, code, sent: "1", weekly: "1" })).status).toBe(303);
    };
    await sign();
    const on = await rowOf(id);
    expect(on).toMatchObject({ mail: "on", via: "sign_in", off_at: null });
    expect(on!.on_at > "2026-10-05").toBe(true);
    await sign();
    expect(await rowOf(id)).toEqual(on);
    expect(await audits(id)).toEqual(["weekly_on at sign-in"]);
  });

  it("never fails the sign-in when the step fails, and logs no address", async () => {
    const email = newEmail("w-fault");
    await post("/account/sign-in", { email, weekly: "1", website: "" });
    const { code } = await mailOf(email);
    const failing = {
      prepare(sql: string) {
        if (sql.startsWith("INSERT INTO weekly_mail")) throw new Error("D1_ERROR: database is locked: SQLITE_BUSY");
        return ACCOUNTS.prepare(sql);
      },
      batch: (s: D1PreparedStatement[]) => ACCOUNTS.batch(s),
    } as unknown as D1Database;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const done = await post("/account/check", { email, code, sent: "1", weekly: "1" }, { env: onEnv({ ACCOUNTS: failing }) });
      expect(done.status).toBe(303);
      expect(sessionCookie(done)).toMatch(/^__Host-aw_session=/);
      expect(await rowOf(await userId(email))).toBeNull();
      const lines = errors.mock.calls.map((c) => c.join(" "));
      expect(lines).toContain("account sign-in: the weekly email was not turned on");
      for (const line of lines) expect(line).not.toContain(email);
    } finally {
      errors.mockRestore();
    }
  });

  it("adds nothing on a GET: the link's page only carries the tick", async () => {
    const email = newEmail("w-get");
    await post("/account/sign-in", { email, weekly: "1", website: "" });
    const { link } = await mailOf(email);
    expect((await get(link.replace("http://localhost", ""))).status).toBe(200);
    expect(await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM users WHERE email = ?").bind(email).first("n")).toBe(0);
  });

  it("with the table missing, offers no box, carries no tick, and signs in as before", async () => {
    await withoutTable(async () => {
      const email = newEmail("w-missing");
      const page = await post("/account/sign-in", { email, weekly: "1", website: "" });
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).not.toContain('name="weekly"');
      expect(html).not.toContain(NOTE_EN);
      const { mail, code } = await mailOf(email);
      expect(mail?.text).not.toContain("weekly=1");
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const done = await post("/account/check", { email, code, sent: "1", weekly: "1" });
        expect(done.status).toBe(303);
        expect(errors).not.toHaveBeenCalled();
        const overview = await (await get("/account", { cookie: sessionCookie(done) })).text();
        expect(overview).not.toContain("Weekly email");
        expect(overview).not.toContain("/account/weekly");
        const token = await csrf(sessionCookie(done));
        const posted = await post("/account/weekly", { csrf: token, mail: "on" }, { cookie: sessionCookie(done) });
        expect(posted.status).toBe(303);
        expect(posted.headers.get("location")).toBe("/account");
      } finally {
        errors.mockRestore();
      }
    });
  });
});

// -- the account page's control ------------------------------------------------------------------------

describe("the account page's control", () => {
  it("turns the email on and off, says so, records where, and keeps the page's one filled button", async () => {
    const email = newEmail("w-page");
    const cookie = await signIn(email);
    const id = await userId(email);
    const before = await text(await get("/account", { cookie }));
    expect(before).toMatch(
      /<dt>Weekly email<\/dt><dd><form method="post" action="\/account\/weekly" class="account-inline"><input type="hidden" name="csrf" value="[0-9a-f]{32}"\/>/,
    );
    expect(before).toContain('<input type="hidden" name="mail" value="on"/><span>Off</span><button type="submit" class="btn-link">Turn on</button></form>' +
      '<span class="kv-note">Each Monday: what changed on the pages you follow, or the week on the site in figures.</span></dd>');
    expect((before.match(/class="btn btn-primary"/g) ?? []).length).toBeLessThanOrEqual(1);
    const token = await csrf(cookie);
    const on = await post("/account/weekly", { csrf: token, mail: "on" }, { cookie });
    expect(on.status).toBe(303);
    expect(on.headers.get("location")).toBe("/account?m=weekly_on");
    expect(await text(await get("/account?m=weekly_on", { cookie })))
      .toContain('<p class="account-notice" role="status">The weekly email is on. The first one goes out on the first Monday after today.</p>');
    expect(await rowOf(id)).toMatchObject({ mail: "on", via: "account", off_at: null });
    // Posting on again changes nothing and audits nothing.
    await post("/account/weekly", { csrf: token, mail: "on" }, { cookie });
    const off = await post("/account/weekly", { csrf: token, mail: "off" }, { cookie });
    expect(off.headers.get("location")).toBe("/account?m=weekly_off");
    expect(await rowOf(id)).toMatchObject({ mail: "off", via: "account" });
    expect((await rowOf(id))!.off_at).not.toBeNull();
    expect(await audits(id)).toEqual(["weekly_on account", "weekly_off account"]);
    const fr = await text(await get("/account?lang=fr&m=weekly_off", { cookie }));
    expect(fr).toContain("<dt>Courriel hebdomadaire</dt>");
    expect(fr).toContain("<span>Désactivé</span><button type=\"submit\" class=\"btn-link\">Activer</button>");
    expect(fr).toContain("Le courriel hebdomadaire est désactivé.");
    // A value that is neither, or a post without the CSRF value, is refused.
    expect((await post("/account/weekly", { csrf: token, mail: "yes" }, { cookie })).status).toBe(400);
    expect((await post("/account/weekly", { csrf: "0".repeat(32), mail: "on" }, { cookie })).status).toBe(403);
    expect((await rowOf(id))!.mail).toBe("off");
  });

  it("is listed among what deleting the account removes, and goes with the account", async () => {
    const email = newEmail("w-delete");
    const cookie = await signIn(email);
    const id = await userId(email);
    const token = await csrf(cookie);
    await post("/account/weekly", { csrf: token, mail: "on" }, { cookie });
    expect(await text(await get("/account/delete", { cookie }))).toContain("<li>The weekly email setting.</li>");
    const res = await post("/account/delete", { csrf: token, confirm: "yes" }, { cookie });
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toBeNull();
  });
});

// -- the message -------------------------------------------------------------------------------------------

const STOP_LINK = `${SITE}/account/stop?e=${"c".repeat(32)}&t=${"d".repeat(32)}`;

const WATCH_EN = `Your Week on Award Watch
Data dates 2026-10-25 to 2026-10-31.

8 updates on 3 of the 4 pages you follow.

- Sample Engineering Ltd. · Organization
  New award or contract: 2, Contract amended: 1
  ${SITE}/organizations/org-a000000001

- Fisheries and Oceans Canada · Buyer
  New tender notice: 4
  ${SITE}/buyers/dfo-mpo

- Hydrographic survey (sample) · Tender notice
  Tender notice amended: 1
  ${SITE}/tenders/cb-100-10000001

Open your watches: ${SITE}/account/watches

Free: 3 watches and 3 saved searches, on the site. Pro: 25 watches and 25 saved searches, each change by email.
Plans and prices: ${SITE}/pro

You receive this because you turned on the weekly email for your account.
Your account: ${SITE}/account
Unsubscribe: ${STOP_LINK}
Sent by Award Watch, 100 Sample Street, Exampletown ON A0A 0A0.
Award Watch · Federal tenders, awards, contracts and grants, by organization.
contact@awardwatch.ca
`;

const SITE_EN = `The Week on Award Watch
Data dates 2026-10-25 to 2026-10-31.

Follow an organization, a buyer, a contract or a tender notice from its page, and this email lists what changes on it.

412 new tender notices: ${SITE}/tenders/new
263 notices closing within 7 days: ${SITE}/tenders?closing=7
187 new award notices: ${SITE}/awards
1,250 contracts ending within 3 months: ${SITE}/expiring/3m

Free: 3 watches and 3 saved searches, on the site. Pro: 25 watches and 25 saved searches, each change by email.
Plans and prices: ${SITE}/pro

You receive this because you turned on the weekly email for your account.
Your account: ${SITE}/account
Unsubscribe: ${STOP_LINK}
Sent by Award Watch, 100 Sample Street, Exampletown ON A0A 0A0.
Award Watch · Federal tenders, awards, contracts and grants, by organization.
contact@awardwatch.ca
`;

const FR = (path: string) => `${SITE}${path}${path.includes("?") ? "&" : "?"}lang=fr`;

const WATCH_FR = `Votre semaine sur Award Watch
Dates des données : du 2026-10-25 au 2026-10-31.

8 nouveautés sur 3 des 4 pages que vous suivez.

- Sample Engineering Ltd. · Organisation
  Nouvelle attribution ou nouveau contrat : 2, Contrat modifié : 1
  ${FR("/organizations/org-a000000001")}

- Pêches et Océans Canada · Acheteur
  Nouvel appel d'offres : 4
  ${FR("/buyers/dfo-mpo")}

- Levé hydrographique (exemple) · Appel d'offres
  Appel d'offres modifié : 1
  ${FR("/tenders/cb-100-10000001")}

Ouvrir vos suivis : ${FR("/account/watches")}

Gratuit : 3 suivis et 3 recherches enregistrées, sur le site. Pro : 25 suivis et 25 recherches enregistrées, chaque changement par courriel.
Forfaits et prix : ${FR("/pro")}

Vous recevez ce message parce que vous avez activé le courriel hebdomadaire de votre compte.
Votre compte : ${FR("/account")}
Se désabonner : ${STOP_LINK}&lang=fr
Envoyé par Award Watch, 100 Sample Street, Exampletown ON A0A 0A0.
Award Watch · Appels d'offres, attributions, contrats et subventions du fédéral, par organisation.
contact@awardwatch.ca
`;

const SITE_FR = `La semaine sur Award Watch
Dates des données : du 2026-10-25 au 2026-10-31.

Suivez une organisation, un acheteur, un contrat ou un appel d'offres à partir de sa page, et ce courriel indiquera ce qui y change.

412 nouveaux avis d'appel d'offres : ${FR("/tenders/new")}
263 appels d'offres qui se clôturent d'ici 7 jours : ${FR("/tenders?closing=7")}
187 nouveaux avis d'attribution : ${FR("/awards")}
1 250 contrats prenant fin d'ici 3 mois : ${FR("/expiring/3m")}

Gratuit : 3 suivis et 3 recherches enregistrées, sur le site. Pro : 25 suivis et 25 recherches enregistrées, chaque changement par courriel.
Forfaits et prix : ${FR("/pro")}

Vous recevez ce message parce que vous avez activé le courriel hebdomadaire de votre compte.
Votre compte : ${FR("/account")}
Se désabonner : ${STOP_LINK}&lang=fr
Envoyé par Award Watch, 100 Sample Street, Exampletown ON A0A 0A0.
Award Watch · Appels d'offres, attributions, contrats et subventions du fédéral, par organisation.
contact@awardwatch.ca
`;

const plain = (s: string) => nbsp(s).replace(/’/g, "'");

describe("the message", () => {
  it("lists the watches' news, line by line, in English and in French, with no em-dash", () => {
    const en = weeklyDigest(weeklyInput("en"));
    expect(en.subject).toBe("Your week: 8 updates on what you follow");
    expect(en.text).toBe(WATCH_EN);
    const fr = weeklyDigest(weeklyInput("fr"));
    expect(plain(fr.subject)).toBe("Votre semaine : 8 nouveautés sur ce que vous suivez");
    expect(plain(fr.text)).toBe(WATCH_FR);
    for (const m of [en, fr]) {
      for (const part of [m.subject, m.text, m.html]) {
        expect(part).not.toContain(EM_DASH);
        expect(part).not.toContain(EN_DASH);
      }
      expect(m.headers).toEqual(deliveryHeaders(m.lang === "fr" ? `${STOP_LINK}&lang=fr` : STOP_LINK));
      // The sender's line sits under the reason, in the footer.
      expect(decode(m.html)).toMatch(/<br>(Sent by|Envoyé par) Award Watch, 100 Sample Street, Exampletown ON A0A 0A0\.<\/p>/);
    }
  });

  it("gives the site's week in figures to an account that follows nothing, in English and in French", () => {
    const en = weeklyDigest(weeklyInput("en", { news: false }));
    expect(en.subject).toBe("The week on Award Watch: 412 new tender notices");
    expect(en.text).toBe(SITE_EN);
    expect(en.html).toContain(
      ">412 new tender notices, 263 notices closing within 7 days, 187 new award notices, 1,250 contracts ending within 3 months.</div>",
    );
    const fr = weeklyDigest(weeklyInput("fr", { news: false }));
    expect(plain(fr.subject)).toBe("La semaine sur Award Watch : 412 nouveaux avis d'appel d'offres");
    expect(plain(fr.text)).toBe(SITE_FR);
  });

  it("says nothing changed on the pages followed, linking them, when they had no news; one page in the singular", () => {
    expect(weeklyDigest(weeklyInput("en", { news: false, watched: 3 })).text)
      .toContain(`Nothing changed this week on the 3 pages you follow: ${SITE}/account/watches\n\n412 new tender notices`);
    expect(weeklyDigest(weeklyInput("en", { news: false, watched: 1 })).text).toContain("Nothing changed this week on the page you follow: ");
    expect(plain(weeklyDigest(weeklyInput("fr", { news: false, watched: 3 })).text))
      .toContain("Rien n'a changé cette semaine sur les 3 pages que vous suivez : ");
    // One page followed, with news: the lead names that page alone.
    const one = weeklyInput("en");
    expect(weeklyDigest({ ...one, watches: { ...one.watches, groups: one.watches.groups.slice(0, 1), total: 3, watched: 1 } }).text)
      .toContain("\n\n3 updates on the page you follow.\n\n");
  });

  it("leaves the line on Pro out for a Pro account, and a figure that did not read out of the list and the subject", () => {
    for (const news of [true, false]) {
      const m = weeklyDigest(weeklyInput("en", { news, pro: true }));
      expect(m.text).not.toContain("Pro: 25");
      expect(m.text).not.toContain("/pro");
    }
    const partial = weeklyDigest({ ...weeklyInput("en", { news: false }), figures: { notices: null, closing: 1, awards: 0, ending: null } });
    expect(partial.subject).toBe("The week on Award Watch, to 2026-10-31");
    expect(partial.text).toContain(`\n\n1 notice closing within 7 days: ${SITE}/tenders?closing=7\n0 new award notices: ${SITE}/awards\n\n`);
    expect(partial.text).not.toContain("tenders/new");
    expect(partial.text).not.toContain("expiring");
  });
});

// -- the run -------------------------------------------------------------------------------------------------

const ev = (r: Record<string, unknown>) => ({
  src: null, oid: null, buyer: null, sid: null, cents: null, ocents: null, endd: null, oendd: null, closing: null, title: null, title_fr: null,
  other: null, more: null, ...r,
});

async function insert(db: D1Database, table: string, rows: Record<string, unknown>[]): Promise<void> {
  await db.batch(rows.map((r) => {
    const cols = Object.keys(r);
    return db.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...cols.map((c) => r[c] ?? null));
  }));
}

// The records database at a data date: two award notices new in the week of
// 2026-11-02, with a history record, an award notice before the week and a
// count row beside them that the figure leaves out; the watched
// organization's award and amendment.
async function seedRecords(asOf: string): Promise<void> {
  await applySql(RECORDS, RECORDS_SCHEMA);
  await RECORDS.batch(["rec_events", "rec_meta", "rec_instruments"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  await RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', ?), ('rules', '2')").bind(asOf).run();
  await insert(RECORDS, "rec_events", [
    ev({ k: 1, day: "2026-10-28", kind: "award", src: 1, oid: ORG_NUMBER, cents: 5_000_000, title: "Bridge inspection", ref: "award:aw-1", path: "/awards/aw-1" }),
    ev({ k: 2, day: "2026-11-01", kind: "award", src: 1, buyer: "dnd-mdn", title: "Field kit", ref: "award:aw-2", path: "/awards/aw-2" }),
    ev({ k: 3, day: "2026-11-02", kind: "award", src: 2, buyer: "dnd-mdn", title: "History record", ref: "history:h-1", path: "/history/h-1" }),
    ev({ k: 4, day: "2026-10-26", kind: "award", src: 1, buyer: "dnd-mdn", title: "Before the week", ref: "award:aw-0", path: "/awards/aw-0" }),
    ev({ k: 5, day: "2026-11-01", kind: "award", buyer: "dnd-mdn", more: 3, ref: "count:award:dnd-mdn", path: "/buyers/dnd-mdn" }),
    ev({ k: 6, day: "2026-10-30", kind: "amended", src: 1, oid: ORG_NUMBER, cents: 9_000_000, ocents: 5_000_000, title: "Bridge inspection",
      ref: "award:aw-1", path: "/awards/aw-1" }),
  ]);
}

// The week's new-notice files: four notices, one of them on two days.
const NEW_DAYS: Record<string, unknown> = {
  "tenders/new/2026-10-27.json": [tender("cb-1"), tender("cb-2")], "tenders/new/2026-10-28.json": [], "tenders/new/2026-10-29.json": [],
  "tenders/new/2026-10-30.json": [tender("cb-3")], "tenders/new/2026-10-31.json": [], "tenders/new/2026-11-01.json": [],
  "tenders/new/2026-11-02.json": [tender("cb-2"), tender("cb-4")],
};

const jobEnv = (mail: SendEmail, day: string, extra: Record<string, unknown> = {}) => onEnv({
  ASSETS: makeFakeAssets({}, { ...NEW_DAYS, "stats.json": { ...(FILES["stats.json"] as object), data_as_of: day } }),
  NOW: `${day}T16:00:00Z`, MAIL: mail, MAIL_FROM: FROM, MAIL_SENDER: undefined, MAIL_ADDRESS: SAMPLE_ADDRESS, ...extra,
});

let seq = 0;
const nextId = () => (0xc0000000 + ++seq).toString(16).padStart(32, "0");

// An account and its weekly row, turned on before the run's week unless on says otherwise.
async function enrolled(email: string, o: { lang?: string; on?: string; mail?: string; status?: string; lastWeek?: string | null } = {}): Promise<string> {
  const id = nextId();
  await ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', ?, ?)")
    .bind(id, email, o.lang ?? "en", o.status ?? "active").run();
  await ACCOUNTS.prepare("INSERT INTO weekly_mail (user_id, mail, via, on_at, created_at, last_week) VALUES (?, ?, 'sign_in', ?, ?, ?)")
    .bind(id, o.mail ?? "on", o.on ?? "2026-10-20T09:00:00.000Z", o.on ?? "2026-10-20T09:00:00.000Z", o.lastWeek ?? null).run();
  return id;
}

async function watchOrg(user: string): Promise<void> {
  await ACCOUNTS.prepare(
    "INSERT INTO watches (id, user_id, kind, target, segment, label, events, cadence, created_at, last_sent_day) VALUES (?, ?, 'organization', ?, '', ?, ?, 'daily', ?, NULL)",
  ).bind(nextId(), user, ORG, "Sample Engineering Ltd.", KINDS_FOR.organization.join(","), "2026-10-01T00:00:00.000Z").run();
}

const clean = () => ACCOUNTS.prepare("DELETE FROM weekly_mail").run();
const logLines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => c.join(" ")).join("\n");

describe("the run", () => {
  it("reads only through its indexes and ends each statement in its bound", async () => {
    await seedRecords(D);
    const plan = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${WEEK_AWARDS_SQL}`).bind("2026-10-26", D).all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    expect(plan.some((s) => /rec_events USING (COVERING )?INDEX rec_events_day/.test(s)), plan.join("\n")).toBe(true);
    expect(WEEK_AWARDS_SQL).toMatch(/LIMIT 1$/);
    expect(WEEKLY_DUE_SQL).toMatch(/LIMIT \?2$/);
    const due = ((await ACCOUNTS.prepare(`EXPLAIN QUERY PLAN ${WEEKLY_DUE_SQL}`).bind(D, 10).all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    expect(due.some((s) => /m USING INDEX idx_weekly_mail_due/.test(s)), due.join("\n")).toBe(true);
  });

  it("sends each account due one message on the week's opening day, in its language, the watches' news or the site's week, and none twice", async () => {
    await clean();
    await seedRecords(D);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const mail = fakeMail();
      const site = newEmail("w-run-site");
      const watcher = newEmail("w-run-watch");
      const french = newEmail("w-run-fr");
      const today = newEmail("w-run-today");
      const off = newEmail("w-run-off");
      const deleted = newEmail("w-run-deleted");
      const blocked = newEmail("w-run-blocked");
      const siteId = await enrolled(site);
      const watcherId = await enrolled(watcher);
      await watchOrg(watcherId);
      await enrolled(french, { lang: "fr" });
      await enrolled(today, { on: `${D}T10:00:00.000Z` });
      await enrolled(off, { mail: "off" });
      await enrolled(deleted, { status: "deleted" });
      const blockedId = await enrolled(blocked);
      await ACCOUNTS.prepare("INSERT INTO account_blocks (user_id, reason, created_at, by_user_id) VALUES (?, 'test', '2026-10-01T12:00:00.000Z', ?)")
        .bind(blockedId, blockedId).run();

      const report = await runDeliveries(jobEnv(mail.binding, D));
      expect(report.outcome).toBe("done");
      expect(report.weekly).toEqual({ sent: 3, failed: 0, waiting: 0, records: null });
      expect(mail.handed.map((m) => m.to).sort()).toEqual([french, site, watcher].sort());
      const [s] = mail.to(site);
      expect(s.subject).toBe("The week on Award Watch: 4 new tender notices");
      for (const line of [
        "4 new tender notices: https://awardwatch.ca/tenders/new", "1 notice closing within 7 days: https://awardwatch.ca/tenders?closing=7",
        "2 new award notices: https://awardwatch.ca/awards", "3 contracts ending within 3 months: https://awardwatch.ca/expiring/3m",
        "Data dates 2026-10-27 to 2026-11-02.",
      ]) expect(s.text).toContain(line);
      const secret = (await ACCOUNTS.prepare("SELECT secret FROM weekly_mail WHERE user_id = ?").bind(siteId).first<{ secret: string }>())!.secret;
      expect(secret).toMatch(/^[0-9a-f]{32}$/);
      const stop = `${SITE}/account/stop?e=${siteId}&t=${secret}`;
      expect(s.headers).toMatchObject(deliveryHeaders(stop));
      expect(s.text).toContain(`Unsubscribe: ${stop}`);
      const [w] = mail.to(watcher);
      expect(w.subject).toBe("Your week: 2 updates on what you follow");
      expect(w.text).toContain("- Sample Engineering Ltd. · Organization\n  New award or contract: 1, Contract amended: 1\n  https://awardwatch.ca/organizations/org-e000000001");
      expect(plain(mail.to(french)[0].subject)).toBe("La semaine sur Award Watch : 4 nouveaux avis d'appel d'offres");
      expect(await rowOf(siteId)).toMatchObject({ last_week: D, last_status: "sent" });
      expect(logLines(log)).toContain(`[deliveries] ${D}: `);
      expect(logLines(log)).toContain("weekly email: 3 sent, 0 failed");
      for (const address of [site, watcher, french]) expect(logLines(log)).not.toContain(address);

      // The same day again, then Thursday: nothing more.
      await runDeliveries(jobEnv(mail.binding, D));
      await seedRecords("2026-11-05");
      await runDeliveries(jobEnv(mail.binding, "2026-11-05"));
      expect(mail.handed).toHaveLength(3);
      // The next Monday: the next one, and the account turned on last Monday gets its first.
      await seedRecords("2026-11-09");
      const next = await runDeliveries(jobEnv(mail.binding, "2026-11-09"));
      expect(next.weekly?.sent).toBe(4);
      expect(mail.to(today)).toHaveLength(1);
      expect(mail.to(site)).toHaveLength(2);
      // That week's new-notice files are not published here: the figure and the subject's count are left out.
      expect(mail.to(site)[1].subject).toBe("The week on Award Watch, to 2026-11-09");
      expect(mail.to(off)).toEqual([]);
      expect(mail.to(deleted)).toEqual([]);
      expect(mail.to(blocked)).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  it("sends a week whose Monday run did not go on the next data date of the same week", async () => {
    await clean();
    await seedRecords("2026-11-03");
    const mail = fakeMail();
    const email = newEmail("w-late");
    const id = await enrolled(email, { lastWeek: "2026-10-26" });
    const report = await runDeliveries(jobEnv(mail.binding, "2026-11-03"));
    expect(report.weekly?.sent).toBe(1);
    expect(await rowOf(id)).toMatchObject({ last_week: D, last_status: "sent" });
  });

  it(`stops at its ceiling of ${WEEKLY_RUN_MAX} messages a run, and the next hour sends the rest`, async () => {
    await clean();
    await seedRecords(D);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const mail = fakeMail();
      const tag = `w-cap-${Date.now().toString(36)}`;
      for (let i = 0; i < WEEKLY_RUN_MAX + 5; i++) await enrolled(`${tag}-${i}@example.com`, { on: `2026-10-20T09:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0")}Z` });
      const first = await runDeliveries(jobEnv(mail.binding, D));
      expect(first.outcome).toBe("capped");
      expect(first.weekly).toEqual({ sent: WEEKLY_RUN_MAX, failed: 0, waiting: 0, records: null });
      expect(mail.handed).toHaveLength(WEEKLY_RUN_MAX);
      expect(logLines(log)).toContain(`stopped at the weekly email's cap of ${WEEKLY_RUN_MAX} messages, the next hour goes on`);
      const second = await runDeliveries(jobEnv(mail.binding, D));
      expect(second.weekly?.sent).toBe(5);
      expect(new Set(mail.handed.map((m) => m.to)).size).toBe(WEEKLY_RUN_MAX + 5);
    } finally {
      log.mockRestore();
    }
  });

  it("marks a refused message's week and waits for the next week; a sending limit stops the run with nothing marked", async () => {
    await clean();
    await seedRecords(D);
    const refused = newEmail("w-refused");
    const limited = newEmail("w-limited");
    const refusedId = await enrolled(refused);
    const limitedId = await enrolled(limited, { on: "2026-10-21T09:00:00.000Z" });
    const mail = fakeMail((to) => to === refused ? Object.assign(new Error("refused"), { code: "E_RECIPIENT_SUPPRESSED" })
      : to === limited ? Object.assign(new Error("limit"), { code: "E_DAILY_LIMIT_EXCEEDED" }) : undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = await runDeliveries(jobEnv(mail.binding, D));
      expect(report.outcome).toBe("limited");
      expect(report.weekly).toMatchObject({ sent: 0, failed: 1 });
      expect(await rowOf(refusedId)).toMatchObject({ last_week: null, last_status: "failed", failed_week: D });
      expect(await rowOf(limitedId)).toMatchObject({ last_week: null, last_status: null, failed_week: null });
      // The next hour: the refused account waits for next week, the limited one is tried again.
      const good = fakeMail();
      await runDeliveries(jobEnv(good.binding, D));
      expect(good.to(refused)).toEqual([]);
      expect(good.to(limited)).toHaveLength(1);
      await seedRecords("2026-11-09");
      await runDeliveries(jobEnv(good.binding, "2026-11-09"));
      expect(good.to(refused)).toHaveLength(1);
    } finally {
      log.mockRestore();
    }
  });

  it("sends nothing without MAIL_ADDRESS, says so on the run's line, and fails nothing", async () => {
    await clean();
    await seedRecords(D);
    const email = newEmail("w-no-address");
    const id = await enrolled(email);
    const mail = fakeMail();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const value of [undefined, "", "   ", " . "]) {
        expect(mailAddress({ MAIL_ADDRESS: value })).toBeNull();
        const report = await runDeliveries(jobEnv(mail.binding, D, { MAIL_ADDRESS: value }));
        expect(report.outcome).toBe("done");
        expect(report.weekly).toEqual({ sent: 0, failed: 0, waiting: 1, records: "no_address" });
      }
      expect(mail.handed).toEqual([]);
      expect(await rowOf(id)).toMatchObject({ last_week: null, last_status: null });
      expect(logLines(log)).toContain(
        "weekly email: 0 sent, 0 failed, 1 waiting: MAIL_ADDRESS is not set, so no weekly email can carry the mailing address",
      );
      // The address is printed on one line, without its closing period.
      expect(mailAddress({ MAIL_ADDRESS: "  100 Sample Street,\n Exampletown ON  A0A 0A0. " })).toBe("100 Sample Street, Exampletown ON A0A 0A0");
    } finally {
      log.mockRestore();
    }
  });

  it("waits, unclaimed, while the records database is behind the data date", async () => {
    await clean();
    await seedRecords("2026-11-01");
    const email = newEmail("w-stale");
    const id = await enrolled(email);
    const mail = fakeMail();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = await runDeliveries(jobEnv(mail.binding, D));
      expect(report.weekly).toEqual({ sent: 0, failed: 0, waiting: 1, records: "stale" });
      expect(mail.handed).toEqual([]);
      expect((await rowOf(id))!.last_week).toBeNull();
    } finally {
      log.mockRestore();
    }
  });

  it("with the table missing, reads nothing of it and says nothing of it: the run's line is the line without the feature", async () => {
    await seedRecords(D);
    const mail = fakeMail();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const report = await withoutTable(() => runDeliveries(jobEnv(mail.binding, D)));
      expect(report.outcome).toBe("done");
      expect(report.weekly).toBeNull();
      expect(mail.handed).toEqual([]);
      expect(logLines(log)).not.toContain("weekly");
    } finally {
      log.mockRestore();
    }
  });
});

// -- unsubscribing -------------------------------------------------------------------------------------------

describe("the unsubscribe link", () => {
  const SECRET = "e".repeat(32);
  const withSecret = async (email: string) => {
    const id = await enrolled(email);
    await ACCOUNTS.prepare("UPDATE weekly_mail SET secret = ? WHERE user_id = ?").bind(SECRET, id).run();
    return id;
  };

  it("shows one button on a GET and changes nothing; a POST turns the email off and says so; a wrong secret is the site's 404", async () => {
    const id = await withSecret(newEmail("w-stop"));
    const page = await get(`/account/stop?e=${id}&t=${SECRET}`);
    expect(page.status).toBe(200);
    const html = await text(page);
    expect(html).toContain("<h1>Unsubscribe from the Weekly Email</h1>");
    expect(html).toContain(`<input type="hidden" name="e" value="${id}"/><input type="hidden" name="t" value="${SECRET}"/>`);
    expect((await rowOf(id))!.mail).toBe("on");
    expect((await get(`/account/stop?e=${id}&t=${"f".repeat(32)}`)).status).toBe(404);
    expect((await get(`/account/stop?e=nothing&t=${SECRET}`)).status).toBe(404);
    const done = await post("/account/stop", { e: id, t: SECRET, lang: "en" }, { origin: null });
    expect(done.status).toBe(200);
    expect(await text(done)).toContain("<h1>Weekly Email Off</h1>");
    expect(await rowOf(id)).toMatchObject({ mail: "off" });
    expect(await audits(id)).toEqual(["weekly_stopped link"]);
    // Already off: the page says so and offers no button.
    const again = await text(await get(`/account/stop?e=${id}&t=${SECRET}&lang=fr`));
    expect(again).toContain("Le courriel hebdomadaire est déjà désactivé.");
    expect(again).not.toContain('name="e"');
  });

  it("turns the email off on a mail client's one-click post, once, and stops the next run", async () => {
    await clean();
    await seedRecords(D);
    const email = newEmail("w-one-click");
    const id = await withSecret(email);
    const res = await post("/account/stop", { e: id, t: SECRET, "List-Unsubscribe": "One-Click" }, { origin: null });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("The weekly email is off.");
    expect((await post("/account/stop", { e: id, t: SECRET, "List-Unsubscribe": "One-Click" }, { origin: null })).status).toBe(200);
    expect(await audits(id)).toEqual(["weekly_stopped one_click"]);
    const mail = fakeMail();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runDeliveries(jobEnv(mail.binding, D));
    } finally {
      log.mockRestore();
    }
    expect(mail.to(email)).toEqual([]);
  });

  it("is the site's 404 while the table is missing, and for a deleted account", async () => {
    const id = await withSecret(newEmail("w-stop-missing"));
    await withoutTable(async () => {
      expect((await get(`/account/stop?e=${id}&t=${SECRET}`)).status).toBe(404);
      expect((await post("/account/stop", { e: id, t: SECRET, "List-Unsubscribe": "One-Click" }, { origin: null })).status).toBe(404);
    });
    const gone = await withSecret(newEmail("w-stop-deleted"));
    await ACCOUNTS.prepare("UPDATE users SET status = 'deleted' WHERE id = ?").bind(gone).run();
    expect((await get(`/account/stop?e=${gone}&t=${SECRET}`)).status).toBe(404);
  });
});

// -- the switch ----------------------------------------------------------------------------------------------

describe("with the switch off", () => {
  it("answers the control, the unsubscribe link and the sign-in with the site's 404, and the run sends nothing", async () => {
    const id = nextId();
    expect((await post("/account/weekly", { mail: "on" }, { env: offEnv() })).status).toBe(404);
    expect((await get(`/account/stop?e=${id}&t=${"e".repeat(32)}`, { env: offEnv() })).status).toBe(404);
    expect((await post("/account/sign-in", { email: newEmail("w-off"), weekly: "1" }, { env: offEnv() })).status).toBe(404);
    const mail = fakeMail();
    const report = await runDeliveries({ ...jobEnv(mail.binding, D), ACCOUNTS_ENABLED: "false" } as never);
    expect(report.outcome).toBe("off");
    expect(mail.handed).toEqual([]);
    expect(await (await get("/privacy", { env: offEnv() })).text()).not.toContain("weekly email");
  });

  it("says on the privacy page, while it is on, what the weekly email keeps", async () => {
    const html = await text(await get("/privacy"));
    expect(html).toContain("The weekly email goes only to an account that turned it on, on the sign-in form or the account page; " +
      "no account is enrolled otherwise.");
    const fr = await text(await get("/privacy?lang=fr"));
    expect(fr).toContain("Le courriel hebdomadaire n'est envoyé qu'à un compte qui l'a activé");
  });
});
