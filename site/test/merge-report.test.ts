// The "Report a wrong merge" button and its report (operator ruling of
// 2026-11-07): the button on every profile, the corrections page with the
// merge kind preselected (/corrections?merge=<id>), the row it stores in the
// forms database (kind 'merge', the name, the note, no contact), the scrub of
// contact details, the per-address form cap, the thank-you page, the
// operator console's list, and the store on a database without the columns.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { app } from "../src/index";
import { MERGE_MARKER, MERGE_NAME_MAX, MERGE_NOTE_MAX } from "../src/pages/forms";
import { CONTACT_REMOVED, scrubContacts } from "../src/scrub";
import { decode, get as accountGet, nbsp, newEmail, onEnv, signIn, useAccountsDb } from "./accounts-helpers";
import { testEnv } from "./assets";

useAccountsDb();

const DB = (env as unknown as { DB: D1Database }).DB;
const EM_DASH = String.fromCharCode(0x2014);
const ID = "org-a000000001";
const OTHER = "org-a000000002";
const RETIRED = "org-a00000000f"; // aliases/a0.json sends it to org-a000000001

// Each post from its own address unless a test means the cap to trip.
let address = 1;
const nextIp = () => `192.0.2.${address++}`;
const post = (fields: Record<string, string>, o: { ip?: string; lang?: "fr" } = {}) =>
  app.request(
    `/corrections${o.lang ? `?lang=${o.lang}` : ""}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": o.ip ?? nextIp() },
      body: new URLSearchParams(fields).toString(),
    },
    testEnv(),
  );
const page = async (path: string) => nbsp(decode(await (await app.request(path, {}, testEnv())).text()));
const lastRow = () => DB.prepare("SELECT * FROM corrections ORDER BY id DESC LIMIT 1").first<Record<string, unknown>>();
const report = (name: string, note = "", id = ID) => ({ kind: "merge", merge: id, name, note });

describe("the button on a profile", () => {
  it("opens the merge report for the profile, in both languages, for every reader", async () => {
    const en = await page(`/organizations/${ID}`);
    expect(en).toContain(`<a href="/corrections?merge=${ID}" class="btn" rel="nofollow">Report a wrong merge</a>`);
    // The head's actions hold it beside the correction link.
    const actions = /<div class="page-actions">([\s\S]*?)<\/div>/.exec(en)?.[1] ?? "";
    expect(actions).toContain("Report a wrong merge");
    expect(actions).toContain("Report a correction");
    const fr = await page(`/organizations/${OTHER}?lang=fr`);
    expect(fr).toContain(`<a href="/corrections?merge=${OTHER}" class="btn" rel="nofollow">Signaler une fusion erronée</a>`);
    // Signed in or not, the same button: the switch on, no session.
    const on = nbsp(decode(await (await app.request(`/organizations/${ID}`, {}, onEnv())).text()));
    expect(on).toContain("Report a wrong merge");
    expect(en).not.toContain(EM_DASH);
    expect(fr).not.toContain(EM_DASH);
  });

  it("sits with the page's upkeep, after the reader's own actions, in a fold a phone starts closed", async () => {
    const on = nbsp(decode(await (await app.request(`/organizations/${ID}`, {}, onEnv())).text()));
    const head = /<header class="page-head">[\s\S]*?<\/header>/.exec(on)?.[0] ?? "";
    // The reader's own actions first, then one fold with the four upkeep links in it.
    const row = head.slice(head.indexOf('<div class="page-actions">'));
    const at = (text: string) => row.indexOf(text);
    const order = ['id="watch-toggle"', ">Analytics<", ">Record table</a>",
      '<details class="phone-fold actions-fold" open="" data-phone-closed=""><summary class="btn">More actions</summary><div class="actions-more">',
      ">Respond as this organization</a>", ">Report a correction</a>", ">Report a wrong merge</a>", ">Records feed</a></div></details>"];
    for (const text of order) expect(at(text), text).toBeGreaterThan(-1);
    expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b));
    // The script that closes the fold below 700 px is on the page, once.
    expect(on.match(/<script src="\/pager\.js" defer=""><\/script>/g)).toHaveLength(1);
    const fr = await page(`/organizations/${ID}?lang=fr`);
    expect(fr).toContain('<summary class="btn">Autres actions</summary>');
  });
});

describe("the merge report's form", () => {
  it("names the profile, carries its id read-only, asks which name and an optional note, and no email address", async () => {
    const res = await app.request(`/corrections?merge=${ID}`, {}, testEnv());
    expect(res.status).toBe(200);
    const html = nbsp(decode(await res.text()));
    expect(html).toContain("<h1>Report a Wrong Merge</h1>");
    expect(html).toContain(`<a href="/organizations/${ID}">Exemplar Translation Services Inc.</a> joins records published under more than one name.`);
    expect(html).toContain('<input type="hidden" name="kind" value="merge"/>');
    expect(html).toContain(`<input name="merge" type="text" class="mono" readonly="" value="${ID}"/>`);
    expect(html).toContain(`<input name="name" type="text" required="" maxlength="${MERGE_NAME_MAX}" list="merge-names" autocomplete="off" value=""/>`);
    expect(html).toContain(`<textarea name="note" rows="4" maxlength="${MERGE_NOTE_MAX}"></textarea>`);
    // The names the profile records are offered under the field.
    expect(html).toContain('<datalist id="merge-names"><option value="Exemplar Translation Services Inc."></option><option value="EXEMPLAR TRANSLATION SERVICES INC"></option></datalist>');
    expect(html).toContain("No email address is asked for, and no account is needed.");
    expect(html).not.toContain('name="contact"');
    expect(html).not.toContain('type="email"');
    // The plain form is one link away; the page is not indexed.
    expect(html).toContain('To report another error, use the <a href="/corrections">corrections form</a>.');
    expect(html).toContain('<meta name="robots" content="noindex"');
    expect(html).not.toContain(EM_DASH);
  });

  it("reads in French", async () => {
    const html = await page(`/corrections?merge=${ID}&lang=fr`);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("<h1>Signaler une fusion erronée</h1>");
    expect(html).toContain("Quel nom n’a pas sa place ici?");
    expect(html).toContain("Note (facultative)");
    expect(html).toContain("Aucune adresse courriel n’est demandée, et aucun compte n’est nécessaire.");
    expect(html).toContain("Envoyer le signalement");
    for (const english of ["Report a Wrong Merge", "Which name", "Send the report", "Report a Correction"]) expect(html).not.toContain(english);
    expect(html).not.toContain(EM_DASH);
  });

  it("sends a retired id to the live profile's form, and shows the plain form for an id with no profile", async () => {
    const moved = await app.request(`/corrections?merge=${RETIRED}&lang=fr&x=1`, {}, testEnv());
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe(`/corrections?merge=${ID}&lang=fr`);
    for (const id of ["org-ffffffffff", "not-an-id", "ORG-A000000001", ""]) {
      const res = await app.request(`/corrections?merge=${encodeURIComponent(id)}`, {}, testEnv());
      expect(res.status, id).toBe(200);
      const html = await res.text();
      expect(html, id).toContain("<h1>Report a Correction</h1>");
      expect(html, id).not.toContain('name="kind"');
    }
  });
});

describe("a merge report", () => {
  it("is stored unpublished with kind merge, the profile, the name and the note, and no contact", async () => {
    const res = await post(report("EXEMPLAR TRANSLATION SERVICES INC", "That name is a different firm in Moncton."));
    expect(res.status).toBe(200);
    const html = nbsp(decode(await res.text()));
    expect(html).toContain("<h1>Thank You</h1>");
    expect(html).toContain("The report was received. The profile stays as it is until the report is reviewed.");
    expect(html).toContain(`<a href="/organizations/${ID}" class="btn">`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const row = await lastRow();
    expect(row).toMatchObject({
      kind: "merge", organization_id: ID, page: `/organizations/${ID}`, name: "EXEMPLAR TRANSLATION SERVICES INC",
      text: "That name is a different firm in Moncton.", contact: null, published: 0,
    });
    expect(String(row?.submitted_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Unpublished, it never shows on the profile.
    expect(await page(`/organizations/${ID}`)).not.toContain("different firm in Moncton");
  });

  it("needs no note, keeps the name on one line and cuts both texts to their limits", async () => {
    expect((await post(report("  Sample\nHarbour   Marine  "))).status).toBe(200);
    expect(await lastRow()).toMatchObject({ kind: "merge", name: "Sample Harbour Marine", text: "" });
    expect((await post(report("x".repeat(MERGE_NAME_MAX + 50), "y".repeat(MERGE_NOTE_MAX + 50)))).status).toBe(200);
    const row = await lastRow();
    expect(String(row?.name).length).toBe(MERGE_NAME_MAX);
    expect(String(row?.text).length).toBe(MERGE_NOTE_MAX);
  });

  it("files a report on a retired id under the live profile", async () => {
    expect((await post(report("Old Name Ltd.", "", RETIRED))).status).toBe(200);
    expect(await lastRow()).toMatchObject({ organization_id: ID, page: `/organizations/${ID}`, name: "Old Name Ltd." });
  });

  it("removes email addresses and telephone numbers from the name and the note before storing them", async () => {
    const res = await post(report(
      "Sample Ltd. (write to sales@sample.example.invalid)",
      "Their office: (613) 555-0187 ext 12, fax 6135550199, or desk@sample.example.invalid. Contract W8484-199273 stays.",
    ));
    expect(res.status).toBe(200);
    const row = await lastRow();
    expect(row?.name).toBe("Sample Ltd. (write to [contact removed])");
    expect(row?.text).toBe("Their office: [contact removed], fax [contact removed], or [contact removed]. Contract W8484-199273 stays.");
    // In the reader's language.
    expect((await post(report("Un nom, tél. 613-555-0142"), { lang: "fr" })).status).toBe(200);
    expect((await lastRow())?.name).toBe("Un nom, tél. [coordonnées retirées]");
  });

  it("asks again, keeping what was typed, when the name is missing; refuses the honeypot and an id with no profile", async () => {
    const before = (await DB.prepare("SELECT COUNT(*) AS n FROM corrections").first<{ n: number }>())?.n ?? 0;
    const empty = await post(report(" ", "A note without a name."));
    expect(empty.status).toBe(400);
    const html = nbsp(decode(await empty.text()));
    expect(html).toContain("Write the name that does not belong on this profile.");
    expect(html).toContain(`readonly="" value="${ID}"`);
    expect(html).toContain(">A note without a name.</textarea>");
    const fr = await post(report(""), { lang: "fr" });
    expect(nbsp(decode(await fr.text()))).toContain("Écrivez le nom qui n’a pas sa place dans ce profil.");
    const bot = await post({ ...report("A Name Inc."), website: "http://spam.example" });
    expect(bot.status).toBe(400);
    const nowhere = await post(report("A Name Inc.", "", "org-ffffffffff"));
    expect(nowhere.status).toBe(400);
    expect(nbsp(decode(await nowhere.text()))).toContain("The profile in the report was not found.");
    expect((await DB.prepare("SELECT COUNT(*) AS n FROM corrections").first<{ n: number }>())?.n).toBe(before);
  });

  it("thanks in French", async () => {
    const res = await post(report("Nom Erroné Ltée"), { lang: "fr" });
    expect(res.status).toBe(200);
    const html = nbsp(decode(await res.text()));
    expect(html).toContain("<h1>Merci</h1>");
    expect(html).toContain("Le signalement a été reçu. Le profil reste tel quel jusqu’à son examen.");
    expect(html).not.toContain(EM_DASH);
  });

  it("counts under the form cap of five posts a minute from one address, the plain form's own", async () => {
    expect((env as unknown as { FORM_LIMIT?: unknown }).FORM_LIMIT, "the FORM_LIMIT binding of wrangler.jsonc").toBeTruthy();
    const ip = "192.0.2.250";
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await post(report(`Name ${i} Inc.`), { ip })).status);
    statuses.push((await post({ page: `/organizations/${ID}`, text: "The city on this profile is out of date." }, { ip })).status);
    statuses.push((await post(report("Name 5 Inc."), { ip })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    // The form itself still opens; another address still posts.
    expect((await app.request(`/corrections?merge=${ID}`, { headers: { "cf-connecting-ip": ip } }, testEnv())).status).toBe(200);
    expect((await post(report("Name 6 Inc."))).status).toBe(200);
  });

  it("is kept as a marked correction on a database made before the kind and name columns", async () => {
    await DB.prepare("ALTER TABLE corrections RENAME TO corrections_with_kind").run();
    try {
      await DB.prepare(
        "CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT, page TEXT, text TEXT NOT NULL, contact TEXT, submitted_at TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0)",
      ).run();
      const res = await post(report("Old Spelling Inc.", "Another firm."));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("The report was received.");
      const row = await lastRow();
      expect(row).toMatchObject({ organization_id: ID, page: `/organizations/${ID}`, text: `${MERGE_MARKER} Old Spelling Inc.\nAnother firm.`, contact: null });
      expect(row).not.toHaveProperty("kind");
    } finally {
      await DB.prepare("DROP TABLE IF EXISTS corrections").run();
      await DB.prepare("ALTER TABLE corrections_with_kind RENAME TO corrections").run();
    }
  });
});

describe("a profile's public corrections log", () => {
  const corrections = (html: string) => html.slice(html.indexOf('<h2 id="corrections">'), html.indexOf("</section>", html.indexOf('<h2 id="corrections">')));
  const insert = (text: string, kind: string | null, at: string) => (kind
    ? DB.prepare("INSERT INTO corrections (organization_id, page, text, contact, submitted_at, published, kind, name) VALUES (?, ?, ?, NULL, ?, 1, ?, ?)")
      .bind(OTHER, `/organizations/${OTHER}`, text, at, kind, kind === "merge" ? "Some Other Firm Ltd." : null)
    : DB.prepare("INSERT INTO corrections (organization_id, page, text, contact, submitted_at, published) VALUES (?, ?, ?, NULL, ?, 1)")
      .bind(OTHER, `/organizations/${OTHER}`, text, at));

  it("leaves out merge reports, published or not, and the marked ones a database without the kind column kept", async () => {
    await DB.batch([
      insert("The city on this profile was corrected.", "correction", "2026-10-20T10:00:00.000Z"),
      insert("Published merge note, never on the page.", "merge", "2026-10-21T10:00:00.000Z"),
      insert(`${MERGE_MARKER} Marked Name Inc.\nKept before the columns.`, "correction", "2026-10-22T10:00:00.000Z"),
    ]);
    const log = corrections(await page(`/organizations/${OTHER}`));
    expect(log).toContain("The city on this profile was corrected.");
    expect(log).toContain("Received 2026-10-20");
    expect(log).not.toContain("Published merge note");
    expect(log).not.toContain(MERGE_MARKER);
    expect(log).not.toContain("Marked Name Inc.");
    expect(log).not.toContain("Some Other Firm");
  });

  it("reads the log without the kind column on a database made before it, the marked rows still left out", async () => {
    await DB.prepare("ALTER TABLE corrections RENAME TO corrections_with_kind").run();
    try {
      await DB.prepare(
        "CREATE TABLE corrections (id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT, page TEXT, text TEXT NOT NULL, contact TEXT, submitted_at TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0)",
      ).run();
      await DB.batch([
        insert("An older database's correction.", null, "2026-10-23T10:00:00.000Z"),
        insert(`${MERGE_MARKER} Older Marked Ltd.`, null, "2026-10-24T10:00:00.000Z"),
      ]);
      const html = await page(`/organizations/${OTHER}`);
      const log = corrections(html);
      expect(log).toContain("An older database's correction.");
      expect(log).not.toContain("Older Marked Ltd.");
      // The responses read in the same batch still come back.
      expect(html).toContain('<h2 id="responses">');
    } finally {
      await DB.prepare("DROP TABLE IF EXISTS corrections").run();
      await DB.prepare("ALTER TABLE corrections_with_kind RENAME TO corrections").run();
    }
  });
});

describe("the operator console", () => {
  it("lists merge reports and corrections with the profile linked, newest first, in both languages", async () => {
    await post(report("Console Listed Name Ltd.", "Seen in the console <b>note</b>."));
    await post({ page: "cb-200-20005019", text: "The region of delivery is wrong for this one." });
    const email = newEmail("op");
    const opEnv = onEnv({ OPERATOR_EMAILS: email });
    const cookie = await signIn(email, { env: opEnv });
    const res = await accountGet("/admin", { cookie, env: opEnv });
    expect(res.status).toBe(200);
    const raw = await res.text();
    // The reader's text is escaped, never markup.
    expect(raw).toContain("Seen in the console &lt;b&gt;note&lt;/b&gt;.");
    const html = nbsp(decode(raw));
    const panel = html.slice(html.indexOf("Corrections and Merge Reports"));
    const table = panel.slice(0, panel.indexOf("</table>"));
    expect(table).toContain('<td data-label="Kind">Wrong merge</td>');
    expect(table).toContain(`<td data-label="Profile"><a href="/organizations/${ID}" class="mono">${ID}</a></td>`);
    expect(table).toContain("Name: Console Listed Name Ltd.");
    expect(table).toContain('<td data-label="Kind">Correction</td>');
    expect(table).toContain("The region of delivery is wrong for this one.");
    expect(table).toContain('<td data-label="Published">No</td>');
    // Newest first: the correction posted after the report comes before it.
    expect(table.indexOf("The region of delivery is wrong")).toBeLessThan(table.indexOf("Console Listed Name Ltd."));
    expect(html).not.toContain(EM_DASH);
    const fr = nbsp(decode(await (await accountGet("/admin?lang=fr", { cookie, env: opEnv })).text()));
    expect(fr).toContain("Corrections et signalements de fusion");
    expect(fr).toContain("Fusion erronée");
    expect(fr).toContain("Nom : Console Listed Name Ltd.");
    expect(fr).not.toContain("Corrections and Merge Reports");
  });

  it("stays a 404 for anyone else", async () => {
    const res = await accountGet("/admin", { env: onEnv({ OPERATOR_EMAILS: "someone@example.com" }) });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Merge Reports");
  });
});

describe("the contact scrub", () => {
  it("takes every address and telephone form the export's scrub takes", () => {
    for (const text of [
      "Questions to generic.inbox@tpsgc-pwgsc.gc.ca.", "Questions to someone @ tpsgc-pwgsc.gc.ca", "Write to someone@ministry",
      "Call 613-555-0142", "Call (819) 555 0123", "Call +1 819 555 0123", "Call +1 (819) 555-0124 ext. 12",
      "Fax: 6135550199", "Toll free 1-800-555-0100", "Tel. 613.555.0199 poste 2345",
    ]) {
      for (const lang of ["en", "fr"] as const) {
        const out = scrubContacts(text, lang);
        expect(out, text).toContain(CONTACT_REMOVED[lang]);
        expect(out, text).not.toContain("@");
        expect(/\d{7,}/.test(out.replace(/[- ]/g, "")), out).toBe(false);
      }
    }
    expect(scrubContacts("Téléphone : 613-555-0100", "fr")).toBe("Téléphone : [coordonnées retirées]");
  });

  it("leaves references, coordinates, times and numbers that are not telephones", () => {
    for (const text of [
      "Snow removal, 2026-10-31 to 2027-03-31", "Value $1,234,567.89", "Contract W8486-123456/001/XX", "Item 12345678 qty 100",
      "Postal code K1A 0B1", "49.0601, -125.7227", "Bids are due January 23 2026 @ 2:00PM EST. Failure to", "W8484-199273",
      "WS5176912673", "Part No.: 400-013-4490-41, NCAGE: U1068", "closing at 14:00 EST, 2026-01-23", "ProServices SA – 1000309024 ONTARIO INC",
    ]) {
      expect(scrubContacts(text), text).toBe(text);
    }
  });
});
