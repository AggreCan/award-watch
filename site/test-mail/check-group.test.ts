// The live mail check's grouped message (src/account/mail_check.ts, docs/mail.md "The live mail check"): the
// twelfth template, sent to the operator's test inbox so that a grouped message's long List-Unsubscribe header
// passes through Email Sending before a subscriber's message depends on it. Eight sample searches of mixed
// kinds, each section's stop link naming zeros as the other templates' do, and the message's own stop link
// built by groupStopPath for 100 members (an account's most), so the header is as long as a full Ultra
// account's would be; the link leads nowhere: the route answers 404 and changes no row.
import { describe, expect, it } from "vitest";
import { MAIL_CHECK_LISTS, MAIL_CHECK_MARK, MAIL_CHECK_TEMPLATES, mailCheckMessages } from "../src/account/mail_check";
import { decode, nbsp, newEmail, nextIp, onEnv, useAccountsDb, ACCOUNTS } from "../test/accounts-helpers";
import { app } from "../src/index";
import { SAMPLE_ADDRESS, SITE } from "../test/mail-fixtures";
import { checkMessage, shapeOf, viaLogSender } from "./checks";

useAccountsDb();

const LANGS = ["en", "fr"] as const;
const ZERO = "0".repeat(32);
// Email Sending's limit on a custom header's value, and RFC 5322's on a line, written out here
// (developers.cloudflare.com/email-service/reference/headers/; a URI inside List-Unsubscribe is never folded).
const HEADER_VALUE_MAX = 2048;
const LINE_MAX = 998;
// 100 tags of 8 base64url characters (src/account/group_stop.ts).
const GROUP_LINK_RE = new RegExp(`^${SITE.replace(/\./g, "\\.")}/account/stop\\?g=${ZERO}&t=[A-Za-z0-9_-]{800}(?:&lang=fr)?$`);

async function grouped(lang: "en" | "fr", to = newEmail(`check-group-${lang}`)) {
  const all = await mailCheckMessages(lang, to, SITE, new Date("2026-11-09T16:00:00Z"), SAMPLE_ADDRESS);
  const found = all.find((m) => (m.template as string) === "group");
  expect(found, "the grouped template").toBeDefined();
  return found!.message;
}

const headings = (html: string) => [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((x) => decode(x[1]));
const groupLinkOf = (headers: Record<string, string>) => /<(https:[^>]*\/account\/stop\?g=[^>]*)>$/.exec(headers["List-Unsubscribe"] ?? "")?.[1] ?? null;

describe("the live check's grouped message", () => {
  it("is the twelfth template, a list delivery", () => {
    expect(MAIL_CHECK_TEMPLATES).toContain("group");
    expect(MAIL_CHECK_TEMPLATES).toHaveLength(12);
    expect(MAIL_CHECK_LISTS.has("group" as never)).toBe(true);
  });

  it.each(LANGS)("carries eight searches of mixed kinds under the mark, held to the checks every message is held to (%s)", async (lang) => {
    const m = await grouped(lang);
    expect(m.subject.startsWith(`${MAIL_CHECK_MARK} `)).toBe(true);
    expect(headings(m.html)).toHaveLength(8);
    // Tender notices, contracts ending, and the records of a segment, an organization and a buyer.
    for (const path of ["/tenders", "/expiring/", "/segments/43", "/organizations/", "/buyers/"]) expect(m.text).toContain(`${SITE}${path}`);
    checkMessage(await viaLogSender(m), shapeOf("group", `mail check group (${lang})`, SITE), lang);
  });

  it.each(LANGS)("names a stop link as long as a full account's, under the header's limits, that leads nowhere (%s)", async (lang) => {
    const m = await grouped(lang);
    const link = groupLinkOf(m.headers);
    expect(link).toMatch(GROUP_LINK_RE);
    const value = m.headers["List-Unsubscribe"];
    expect(value).toBe(`<mailto:contact@awardwatch.ca>, <${link}>`);
    expect(new TextEncoder().encode(value).length).toBeGreaterThan(900);
    expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(HEADER_VALUE_MAX);
    expect(`List-Unsubscribe: ${value}`.length).toBeLessThanOrEqual(LINE_MAX);
    expect(m.text).toContain(link!);
    // Each section's own stop link names zeros, as the other templates' do.
    const own = (m.text.match(/https:\/\/\S+\/account\/stop\?s=\S+/g) ?? []);
    expect(own).toHaveLength(8);
    for (const stop of own) {
      const params = new URL(stop).searchParams;
      expect([params.get("s"), params.get("t")]).toEqual([ZERO, ZERO]);
    }
    // The link leads nowhere: the site's 404 on a GET, a form's POST and a mail client's one-click POST, and no row changes.
    const user = crypto.randomUUID().replace(/-/g, "");
    const search = crypto.randomUUID().replace(/-/g, "");
    await ACCOUNTS.batch([
      ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active')").bind(user, newEmail("check-group-row")),
      ACCOUNTS.prepare("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', '/tenders', 'Sample', 'en', '2026-01-01T00:00:00.000Z', 'daily')")
        .bind(search, user),
      ACCOUNTS.prepare("INSERT INTO delivery_tokens (search_id, secret, created_at) VALUES (?, ?, '2026-01-01T00:00:00.000Z')").bind(search, ZERO),
    ]);
    const rows = async () => (await ACCOUNTS.prepare("SELECT id, deliver, last_delivered_at FROM saved_searches ORDER BY id").all()).results;
    const audits = async () => (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM audit WHERE event = 'delivery_stopped'").first<{ n: number }>())?.n;
    const before = await rows();
    const stopped = await audits();
    const u = new URL(link!);
    const path = `${u.pathname}${u.search}`;
    const post = (body: string) => app.request(path, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp() }, body,
    }, onEnv());
    expect((await app.request(path, { headers: { "cf-connecting-ip": nextIp() } }, onEnv())).status).toBe(404);
    expect((await post("List-Unsubscribe=One-Click")).status).toBe(404);
    expect((await post(new URLSearchParams({ g: ZERO, t: u.searchParams.get("t")!, lang }).toString())).status).toBe(404);
    expect(await rows()).toEqual(before);
    expect(await audits()).toBe(stopped);
    expect(nbsp(m.text)).not.toContain("undefined");
  });
});
