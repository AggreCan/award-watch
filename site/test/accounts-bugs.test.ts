// Bug reports, the Pro form under the account (src/account/bugs.tsx): the
// notice a Free account sees, the form with the page the reader came from,
// the stored row, the message to the operator through the ALERTS binding
// (a fake that keeps what it is handed), the audit row, the cap of five a
// day, the guards every account post has, the overview row and the footer
// link, and the rows going with the account and after 180 days.
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUG_REPORTS_PER_DAY, BUG_SUBJECT, bugMail, pagePath } from "../src/account/bugs";
import { BUG_REPORT_DAYS, sweep } from "../src/account/signin";
import { app } from "../src/index";
import { bucketFor } from "../src/limits";
import { testEnv } from "./assets";
import {
  ACCOUNTS, csrf, decode, get, grantPro, nbsp, newEmail, nextIp, onEnv, post, signIn, useAccountsDb, userId,
} from "./accounts-helpers";

useAccountsDb();

const INBOX = "inbox@example.invalid";
const FROM = "alerts@awardwatch.ca";

type Handed = { from: string; to: string; raw: string };

// A stand-in for the ALERTS binding: it keeps each message it is handed and,
// with an error, throws it after. EmailMessage has no public reader for its
// text; the local runtime keeps it under "EmailMessage::raw", which is what
// a test can read.
function fakeAlerts(error?: unknown) {
  const handed: Handed[] = [];
  const binding = {
    async send(message: { from: string; to: string }) {
      handed.push({ from: message.from, to: message.to, raw: (message as unknown as Record<string, string>)["EmailMessage::raw"] });
      if (error !== undefined) throw error;
    },
  } as unknown as SendEmail;
  return { handed, binding };
}

// The switch on with the daily check's sending path configured.
const alertsEnv = (binding: SendEmail, extra: Record<string, unknown> = {}) =>
  onEnv({ ALERTS: binding, ALERT_EMAIL: INBOX, ALERT_FROM: FROM, ...extra });

// The headers, and the body decoded from base64.
function readMail(raw: string): { headers: string[]; body: string } {
  const at = raw.indexOf("\r\n\r\n");
  const bytes = Uint8Array.from(atob(raw.slice(at + 4).replace(/\r\n/g, "")), (ch) => ch.charCodeAt(0));
  return { headers: raw.slice(0, at).split("\r\n"), body: new TextDecoder().decode(bytes) };
}

async function proReader(tag = "bugs"): Promise<{ email: string; cookie: string; token: string; id: string }> {
  const email = newEmail(tag);
  const cookie = await signIn(email);
  await grantPro(email);
  return { email, cookie, token: await csrf(cookie), id: await userId(email) };
}

type Row = { id: string; user_id: string; page: string | null; text: string; expected: string | null; created_at: string };

async function reports(id: string): Promise<Row[]> {
  return (await ACCOUNTS.prepare("SELECT * FROM bug_reports WHERE user_id = ? ORDER BY created_at, id").bind(id).all<Row>()).results ?? [];
}

async function audits(id: string): Promise<{ event: string; detail: string | null }[]> {
  return (await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE user_id = ? AND event = 'bug_reported' ORDER BY id")
    .bind(id).all<{ event: string; detail: string | null }>()).results ?? [];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the bug report page", () => {
  it("tells a Free account the form is part of Pro, with the billing link, and refuses its post", async () => {
    const email = newEmail("bugs-free");
    const cookie = await signIn(email);
    const res = await get("/account/bug", { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = decode(await res.text());
    expect(html).toContain("<h1>Report a Bug</h1>");
    expect(html).toContain("Bug reports are part of Pro, the site's paid plan.");
    expect(html).toContain('<a href="/account/billing">Plans and prices</a>');
    expect(html).not.toContain('name="text"');
    // The billing page lists the form among what Pro includes.
    const billing = decode(await (await get("/account/billing", { cookie })).text());
    expect(billing).toContain("<li>A form under the account to report a bug. No reply is promised; fixes show up on the site.</li>");
    const billingFr = nbsp(decode(await (await get("/account/billing?lang=fr", { cookie })).text()));
    expect(billingFr).toContain("<li>Un formulaire dans le compte pour signaler un bogue. Aucune réponse n’est promise; les correctifs apparaissent sur le site.</li>");
    const { handed, binding } = fakeAlerts();
    const refused = await post("/account/bug", { csrf: await csrf(cookie), text: "The list is empty." }, { cookie, env: alertsEnv(binding) });
    expect(refused.status).toBe(403);
    expect(decode(await refused.text())).toContain("Bug reports are part of Pro, the site's paid plan.");
    expect(await reports(await userId(email))).toEqual([]);
    expect(handed).toEqual([]);
  });

  it("shows a Pro account the form, the page it came from filled in, and the no-reply line", async () => {
    const { cookie } = await proReader();
    const res = await get("/account/bug", { cookie, headers: { referer: "http://localhost/tenders?segment=82" } });
    expect(res.status).toBe(200);
    const html = decode(await res.text());
    expect(html).toContain('<form method="post" action="/account/bug" class="stack">');
    expect(html).toMatch(/<input name="page" type="text" maxlength="300"[^>]* value="\/tenders\?segment=82"/);
    expect(html).toContain('<textarea name="text" rows="6" required="" maxlength="2000">');
    expect(html).toContain('<textarea name="expected" rows="3" maxlength="1000">');
    expect(html).toContain("No reply is promised. Fixes show up on the site.");
    expect(html).toContain(`The report is kept for ${BUG_REPORT_DAYS} days with the account and sent to the site's inbox without your email address.`);
    expect(html).toContain('<a href="/corrections">corrections page</a>');
    const french = nbsp(decode(await (await get("/account/bug?lang=fr", { cookie })).text()));
    expect(french).toContain("<h1>Signaler un bogue</h1>");
    expect(french).toContain("Aucune réponse n’est promise. Les correctifs apparaissent sur le site.");
  });

  it("fills in the page only from the site's own address, without a query under /account", async () => {
    const { cookie } = await proReader();
    const prefill = async (referer?: string) => {
      const html = decode(await (await get("/account/bug", { cookie, headers: referer ? { referer } : {} })).text());
      return /<input name="page"[^>]* value="([^"]*)"/.exec(html)?.[1];
    };
    expect(await prefill("https://awardwatch.ca/expiring/12m?buyer=pwgsc-tpsgc")).toBe("/expiring/12m?buyer=pwgsc-tpsgc");
    expect(await prefill("https://evil.example/tenders")).toBe("");
    expect(await prefill()).toBe("");
    // A stop link's secret or a sign-in token never reaches the form.
    expect(await prefill(`http://localhost/account/stop?s=${"a".repeat(32)}&t=${"b".repeat(32)}`)).toBe("/account/stop");
    expect(await prefill("http://localhost/account/check?token=x")).toBe("/account/check");
    expect(await prefill("http://localhost/account/bug")).toBe("");
    expect(await prefill(`http://localhost/tenders?q=${"x".repeat(300)}`)).toBe("");
  });

  it("is noindex and sends a signed-out reader to sign in", async () => {
    const { cookie } = await proReader();
    const page = await get("/account/bug", { cookie });
    expect(page.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await page.text()).toContain('<meta name="robots" content="noindex"/>');
    const out = await get("/account/bug");
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/account/sign-in");
    const posted = await post("/account/bug", { text: "x" });
    expect(posted.status).toBe(303);
    expect(posted.headers.get("location")).toBe("/account/sign-in");
  });
});

describe("filing a report", () => {
  it("stores the row, sends the operator the report with the plan and the user id but never the address, and writes the audit row", async () => {
    const { email, cookie, token, id } = await proReader("bugs-file");
    const { handed, binding } = fakeAlerts();
    const res = await post("/account/bug", {
      csrf: token,
      page: "https://awardwatch.ca/expiring/12m?buyer=pwgsc-tpsgc",
      text: "The 12-month list stops at page 3.\r\nPage 4 is empty, même en français.",
      expected: "Every page of the list.",
    }, { cookie, env: alertsEnv(binding) });
    expect(res.status).toBe(200);
    const html = decode(await res.text());
    expect(html).toContain("<h1>Report Received</h1>");
    expect(html).toContain("Thank you. The report was received.");
    expect(html).toContain("No reply is promised. Fixes show up on the site.");

    const [row, ...more] = await reports(id);
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      user_id: id, page: "/expiring/12m?buyer=pwgsc-tpsgc",
      text: "The 12-month list stops at page 3.\nPage 4 is empty, même en français.", expected: "Every page of the list.",
    });
    expect(row.id).toMatch(/^[0-9a-f]{32}$/);
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    expect(handed).toHaveLength(1);
    const [mail] = handed;
    expect(mail.from).toBe(FROM);
    expect(mail.to).toBe(INBOX);
    expect(typeof mail.raw).toBe("string");
    const { headers, body } = readMail(mail.raw);
    expect(headers).toContain(`Subject: ${BUG_SUBJECT}`);
    expect(BUG_SUBJECT).toBe("Bug report from a Pro account");
    expect(headers).toContain(`From: Award Watch <${FROM}>`);
    expect(headers).toContain(`To: ${INBOX}`);
    expect(headers).toContain("Content-Transfer-Encoding: base64");
    expect(body).toContain(`Bug report ${row.id}`);
    expect(body).toContain("Page: /expiring/12m?buyer=pwgsc-tpsgc");
    expect(body).toContain("Plan: pro");
    expect(body).toContain(`User id: ${id}`);
    expect(body).toContain("What happened:\r\nThe 12-month list stops at page 3.\r\nPage 4 is empty, même en français.");
    expect(body).toContain("What was expected:\r\nEvery page of the list.");
    // The account's address is nowhere in the message.
    expect(mail.raw).not.toContain(email);
    expect(body).not.toContain(email);
    expect(body).not.toContain("@");

    expect(await audits(id)).toEqual([{ event: "bug_reported", detail: "sent" }]);
  });

  it("keeps the report when the message cannot be sent, logging the error's code alone", async () => {
    const { id, cookie, token } = await proReader("bugs-fail");
    const log = vi.spyOn(console, "log");
    const refusal = Object.assign(new Error(`destination ${INBOX} not verified`), { code: "E_SENDER_NOT_VERIFIED" });
    const { handed, binding } = fakeAlerts(refusal);
    const res = await post("/account/bug", { csrf: token, text: "The feed shows yesterday." }, { cookie, env: alertsEnv(binding) });
    expect(res.status).toBe(200);
    expect(handed).toHaveLength(1);
    expect((await reports(id)).map((r) => r.text)).toEqual(["The feed shows yesterday."]);
    expect(await audits(id)).toEqual([{ event: "bug_reported", detail: "failed" }]);
    const lines = log.mock.calls.map((call) => call.join(" "));
    expect(lines).toContain("bug report: not sent (E_SENDER_NOT_VERIFIED)");
    for (const line of lines) expect(line).not.toContain("@");
  });

  it("keeps the report when no sending path is configured, and touches no binding", async () => {
    const { id, cookie, token } = await proReader("bugs-unset");
    const { handed, binding } = fakeAlerts();
    const res = await post("/account/bug", { csrf: token, text: "The chart is blank." }, { cookie, env: alertsEnv(binding, { ALERT_EMAIL: "" }) });
    expect(res.status).toBe(200);
    expect(handed).toEqual([]);
    expect(await reports(id)).toHaveLength(1);
    expect(await audits(id)).toEqual([{ event: "bug_reported", detail: "not_configured" }]);
  });

  it("refuses a sixth report in 24 hours with the form, the message and what was typed, 429", async () => {
    const { id, cookie, token } = await proReader("bugs-cap");
    const { handed, binding } = fakeAlerts();
    const env = alertsEnv(binding);
    for (let n = 1; n <= BUG_REPORTS_PER_DAY; n++) {
      expect((await post("/account/bug", { csrf: token, text: `Report ${n}` }, { cookie, env })).status, `report ${n}`).toBe(200);
    }
    const sixth = await post("/account/bug", { csrf: token, page: "/awards", text: "Report 6", expected: "A row" }, { cookie, env });
    expect(sixth.status).toBe(429);
    const html = decode(await sixth.text());
    expect(html).toContain("This account has sent 5 bug reports in the last 24 hours, the most a day allows. Try again later.");
    expect(html).toContain(">Report 6</textarea>");
    expect(html).toContain(">A row</textarea>");
    expect(html).toMatch(/<input name="page"[^>]* value="\/awards"/);
    expect(await reports(id)).toHaveLength(BUG_REPORTS_PER_DAY);
    expect(handed).toHaveLength(BUG_REPORTS_PER_DAY);
    expect(await audits(id)).toHaveLength(BUG_REPORTS_PER_DAY);
    // Reports older than 24 hours no longer count.
    const yesterday = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await ACCOUNTS.prepare("UPDATE bug_reports SET created_at = ? WHERE user_id = ?").bind(yesterday, id).run();
    expect((await post("/account/bug", { csrf: token, text: "Report 6" }, { cookie, env })).status).toBe(200);
    expect(await reports(id)).toHaveLength(BUG_REPORTS_PER_DAY + 1);
  });

  it("holds the cap against reports sent at the same moment", async () => {
    const { id, cookie, token } = await proReader("bugs-burst");
    const { binding } = fakeAlerts();
    const env = alertsEnv(binding);
    const answers = await Promise.all(
      Array.from({ length: 8 }, (_, n) => post("/account/bug", { csrf: token, text: `Burst ${n}` }, { cookie, env })),
    );
    expect(answers.filter((r) => r.status === 200)).toHaveLength(BUG_REPORTS_PER_DAY);
    expect(answers.filter((r) => r.status === 429)).toHaveLength(8 - BUG_REPORTS_PER_DAY);
    expect(await reports(id)).toHaveLength(BUG_REPORTS_PER_DAY);
  });

  it("asks for what happened and for a page on this site, and keeps the lengths", async () => {
    const { id, cookie, token } = await proReader("bugs-fields");
    const { handed, binding } = fakeAlerts();
    const env = alertsEnv(binding);
    const empty = await post("/account/bug", { csrf: token, text: "  \r\n " }, { cookie, env });
    expect(empty.status).toBe(400);
    expect(decode(await empty.text())).toContain("Describe what happened.");
    for (const page of ["https://evil.example/tenders", "//evil.example/tenders", "/\\evil.example/tenders", "javascript:alert(1)", "tenders",
      `/tenders?q=${"x".repeat(300)}`]) {
      const res = await post("/account/bug", { csrf: token, page, text: "Something broke." }, { cookie, env });
      expect(res.status, page).toBe(400);
      expect(decode(await res.text()), page).toContain("The page address must be a page on this site, at most 300 characters.");
    }
    expect(await reports(id)).toEqual([]);
    expect(handed).toEqual([]);
    // No page is fine; a page under /account keeps its path alone; the text
    // and the expectation are cut at their lengths, line breaks counted once.
    await post("/account/bug", {
      csrf: token, page: `/account/stop?s=${"a".repeat(32)}&t=${"b".repeat(32)}`, text: `${"a\r\n".repeat(700)}${"z".repeat(1000)}`,
      expected: "e".repeat(1500),
    }, { cookie, env });
    await post("/account/bug", { csrf: token, page: "", text: "No page." }, { cookie, env });
    const [first, second] = await reports(id);
    expect(first.page).toBe("/account/stop");
    expect(first.text).toHaveLength(2000);
    expect(first.text).not.toContain("\r");
    expect(first.expected).toHaveLength(1000);
    expect(second).toMatchObject({ page: null, text: "No page.", expected: null });
  });

  it("counts with the other forms against FORM_LIMIT while the switch is on, as a page while it is off, and answers 429 when spent", async () => {
    expect(bucketFor("POST", "/account/bug")).toBe("form");
    expect(bucketFor("GET", "/account/bug")).toBe("page");
    const { id, cookie, token } = await proReader("bugs-limit");
    const keys: string[] = [];
    const keeper = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } as unknown as RateLimit;
    const ip = nextIp();
    await post("/account/bug", { csrf: token, text: "Counted." }, { cookie, ip, env: onEnv({ PAGE_LIMIT: keeper, FORM_LIMIT: keeper }) });
    expect(keys).toEqual([`form:${ip}`]);
    // Off, the path is an unknown one, counted as pages are, as before the form existed.
    keys.length = 0;
    await post("/account/bug", { csrf: token, text: "Off." }, { cookie, ip, env: { ...testEnv(), PAGE_LIMIT: keeper, FORM_LIMIT: keeper } });
    expect(keys).toEqual([`page:${ip}`]);
    const spent = { limit: async () => ({ success: false }) } as unknown as RateLimit;
    const res = await post("/account/bug", { csrf: token, text: "Refused." }, { cookie, env: onEnv({ FORM_LIMIT: spent }) });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.text()).toContain("Too many requests from this address.");
    expect((await reports(id)).map((r) => r.text)).toEqual(["Counted."]);
  });
});

describe("the guards", () => {
  it("refuse a post without the session's CSRF value or from another site, storing and sending nothing", async () => {
    const { id, cookie, token } = await proReader("bugs-guards");
    const { handed, binding } = fakeAlerts();
    const env = alertsEnv(binding);
    for (const [fields, origin] of [
      [{ text: "No CSRF." }, undefined],
      [{ csrf: "0".repeat(32), text: "Wrong CSRF." }, undefined],
      [{ csrf: token, text: "Another site." }, "https://evil.example"],
      [{ csrf: token, text: "Null origin." }, "null"],
    ] as [Record<string, string>, string | undefined][]) {
      const res = await post("/account/bug", fields, { cookie, env, origin });
      expect(res.status, fields.text).toBe(403);
      expect(await res.text(), fields.text).toBe("The form could not be read.");
    }
    expect(await reports(id)).toEqual([]);
    expect(handed).toEqual([]);
  });

  it("with the switch off, answer the site's own 404, reading neither the accounts database nor the alerts binding", async () => {
    const { cookie } = await proReader("bugs-off");
    const used: string[] = [];
    const trap = <T,>(name: string) => new Proxy({}, { get(_t, prop) { used.push(`${name}.${String(prop)}`); throw new Error(`${name} read`); } }) as T;
    const env = { ...testEnv(), ACCOUNTS: trap<D1Database>("ACCOUNTS"), ALERTS: trap<SendEmail>("ALERTS"), ALERT_EMAIL: INBOX };
    const notFound = await (await app.request("/nothing-here", { headers: { "cf-connecting-ip": nextIp(), "sec-fetch-mode": "navigate" } }, env)).text();
    for (const method of ["GET", "POST"]) {
      const headers: Record<string, string> = { "cf-connecting-ip": nextIp(), "sec-fetch-mode": "navigate", cookie };
      const init: RequestInit = { method, headers };
      if (method === "POST") {
        headers["content-type"] = "application/x-www-form-urlencoded";
        headers.origin = "http://localhost";
        init.body = new URLSearchParams({ text: "Off." }).toString();
      }
      const res = await app.request("/account/bug", init, env);
      expect(res.status, method).toBe(404);
      expect(await res.text(), method).toBe(notFound);
    }
    expect(used).toEqual([]);
  });
});

describe("where the form is linked", () => {
  const footerLink = '<a href="/account/bug">Report a bug</a>';

  it("on the overview and in the footer for a signed-in Pro reader, in both languages", async () => {
    const { cookie } = await proReader("bugs-links");
    const overview = decode(await (await get("/account", { cookie })).text());
    expect(overview).toContain(`<dt>Bug reports</dt><dd>${footerLink}</dd>`);
    for (const path of ["/", "/tenders", "/organizations/org-a000000001"]) {
      const html = decode(await (await get(path, { cookie })).text());
      const footer = html.slice(html.indexOf('<footer class="site-footer">'));
      expect(footer, path).toContain(`<a href="/corrections">Report a correction</a>${footerLink}<a href="/cite">`);
    }
    expect(await (await get("/?lang=fr", { cookie })).text()).toContain('<a href="/account/bug">Signaler un bogue</a>');
  });

  it("on a Free account's overview with the Pro chip, leading to the notice", async () => {
    const email = newEmail("bugs-freerow");
    const cookie = await signIn(email);
    for (const [lang, field, link, hidden] of [
      ["en", "Bug reports", "Report a bug", "(paid plan)"], ["fr", "Rapports de bogue", "Signaler un bogue", "(forfait payant)"],
    ] as const) {
      const overview = nbsp(decode(await (await get(`/account?lang=${lang}`, { cookie })).text()));
      const row = new RegExp(`<dt>${field}</dt><dd><a href="/account/bug">${link} <span class="pro-tag"><svg [^>]*><path [^>]*></path></svg>Pro<span class="visually-hidden"> \\${hidden.slice(0, -1)}\\)</span></span></a></dd>`);
      expect(overview, lang).toMatch(row);
    }
  });

  it("nowhere else for a Free reader, a signed-out reader, or anyone while the switch is off", async () => {
    const email = newEmail("bugs-nolinks");
    const cookie = await signIn(email);
    for (const path of ["/", "/tenders"]) {
      expect(await (await get(path, { cookie })).text(), path).not.toContain("/account/bug");
      expect(await (await get(path)).text(), path).not.toContain("/account/bug");
    }
    // A Pro session sent back while the switch is off changes nothing.
    await grantPro(email);
    expect(await (await get("/", { cookie })).text()).toContain(footerLink);
    expect(await (await get("/", { cookie, env: testEnv() })).text()).not.toContain("/account/bug");
  });
});

describe("keeping", () => {
  it("removes an account's reports when the account is deleted, and the delete page says so", async () => {
    const { id, cookie, token } = await proReader("bugs-delete");
    const { binding } = fakeAlerts();
    for (const text of ["One.", "Two."]) await post("/account/bug", { csrf: token, text }, { cookie, env: alertsEnv(binding) });
    expect(await reports(id)).toHaveLength(2);
    expect(decode(await (await get("/account/delete", { cookie })).text())).toContain("<li>Every bug report sent from the account.</li>");
    const res = await post("/account/delete", { csrf: token, confirm: "yes" }, { cookie });
    expect(res.status).toBe(200);
    expect(await reports(id)).toEqual([]);
  });

  it(`sweeps reports after ${BUG_REPORT_DAYS} days with the other sweeps`, async () => {
    const { id } = await proReader("bugs-sweep");
    const now = new Date();
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
    for (const [rid, at] of [["a".repeat(32), daysAgo(BUG_REPORT_DAYS + 1)], ["b".repeat(32), daysAgo(BUG_REPORT_DAYS - 1)]]) {
      await ACCOUNTS.prepare("INSERT INTO bug_reports (id, user_id, page, text, expected, created_at) VALUES (?, ?, NULL, 'old', NULL, ?)")
        .bind(rid, id, at).run();
    }
    await sweep(onEnv() as never, now);
    expect((await reports(id)).map((r) => r.id)).toEqual(["b".repeat(32)]);
  });

  it("is named on the privacy page while accounts are open", async () => {
    const privacy = decode(await (await get("/privacy")).text());
    expect(privacy).toContain(`A bug report sent from a Pro account keeps the page address and what was typed into the form for ${BUG_REPORT_DAYS} days`);
  });
});

describe("the message and the page address, alone", () => {
  const report = {
    id: "c".repeat(32), userId: "d".repeat(32), plan: "pro", lang: "fr" as const, page: null,
    text: `Line one\nBcc: someone@example.com\n${"x".repeat(1500)}`, expected: null,
  };

  it("keep every typed value out of the headers, in base64 lines of at most 76 characters", () => {
    const raw = bugMail(FROM, INBOX, report, new Date("2026-11-03T12:00:00Z"));
    const { headers, body } = readMail(raw);
    expect(headers).toEqual([
      `From: Award Watch <${FROM}>`, `To: ${INBOX}`, `Subject: ${BUG_SUBJECT}`, "Date: Tue, 03 Nov 2026 12:00:00 GMT", "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64",
    ]);
    for (const line of raw.slice(raw.indexOf("\r\n\r\n") + 4).split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(body).toContain("Page: (none given)");
    expect(body).toContain("What was expected:\r\n(none given)");
    expect(body).toContain("Language: fr");
    expect(body).toContain("received 2026-11-03T12:00 UTC");
  });

  it("read a path or an address on the site's host as a path, and nothing else", () => {
    const at = "https://awardwatch.ca/account/bug";
    expect(pagePath("/tenders?segment=82", at)).toBe("/tenders?segment=82");
    expect(pagePath("https://awardwatch.ca/awards/2026#top", at)).toBe("/awards/2026");
    expect(pagePath("https://www.awardwatch.ca/buyers", at)).toBe("/buyers");
    expect(pagePath("/account/check?token=abc", at)).toBe("/account/check");
    expect(pagePath("/Account/stop?t=abc", at)).toBe("/Account/stop");
    expect(pagePath("https://evil.example/", at)).toBeNull();
    expect(pagePath("//evil.example/", at)).toBeNull();
    expect(pagePath("ftp://awardwatch.ca/", at)).toBeNull();
    expect(pagePath(`/${"p".repeat(300)}`, at)).toBeNull();
    expect(pagePath(`/${"p".repeat(299)}`, at)).toHaveLength(300);
  });
});
