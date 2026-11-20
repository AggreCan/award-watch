// The live mail check's grouped messages (src/account/mail_check.ts, docs/mail.md "The live mail check"): several
// saved searches, briefings or saved views in one message, sent to the operator's test inbox so that a grouped
// message's long List-Unsubscribe header passes through Email Sending before a subscriber's message depends on it.
// Eight sample items of mixed kinds, each section's stop link naming zeros as the other templates' do, and the
// message's own stop link built by groupStopPath for an account's most items of the kind (100 searches or briefings,
// 50 views), so the header is as long as a full Ultra account's would be; the link leads nowhere: the route answers
// 404 and changes no row.
import { describe, expect, it } from "vitest";
import { SAVED_VIEW_MAX } from "../src/account/entitlements";
import { GROUP_TAGS_MAX } from "../src/account/group_stop";
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

// Each grouped template: its link's parameter, an account's most items of its kind (one tag of 8 base64url
// characters each, src/account/group_stop.ts), each section's own parameter, and the paths its sections link.
const KINDS = [
  { template: "group", param: "g", own: "s", tags: GROUP_TAGS_MAX, paths: ["/tenders", "/expiring/", "/segments/43", "/organizations/", "/buyers/"] },
  { template: "briefing_group", param: "gb", own: "b", tags: GROUP_TAGS_MAX, paths: ["/segments/81", "/segments/43", "/buyers/pwgsc-tpsgc"] },
  { template: "view_group", param: "gv", own: "v", tags: SAVED_VIEW_MAX, paths: ["/segments/81/analytics", "/buyers/pwgsc-tpsgc/analytics"] },
] as const;

async function grouped(template: string, lang: "en" | "fr", to = newEmail(`check-group-${lang}`)) {
  const all = await mailCheckMessages(lang, to, SITE, new Date("2026-11-09T16:00:00Z"), SAMPLE_ADDRESS);
  const found = all.find((m) => (m.template as string) === template);
  expect(found, template).toBeDefined();
  return found!.message;
}

const headings = (html: string) => [...html.matchAll(/<h2\b[^>]*>([^<]*)<\/h2>/g)].map((x) => decode(x[1]));
const groupLinkOf = (headers: Record<string, string>, param: string) =>
  new RegExp(`<(https:[^>]*\\/account\\/stop\\?${param}=[^>]*)>$`).exec(headers["List-Unsubscribe"] ?? "")?.[1] ?? null;

describe("the live check's grouped messages", () => {
  it("are three of the fifteen templates, each a list delivery", () => {
    expect(MAIL_CHECK_TEMPLATES).toHaveLength(15);
    for (const k of KINDS) {
      expect(MAIL_CHECK_TEMPLATES, k.template).toContain(k.template);
      expect(MAIL_CHECK_LISTS.has(k.template as never), k.template).toBe(true);
    }
  });

  for (const k of KINDS) {
    it.each(LANGS)(`${k.template}: carries eight items of mixed kinds under the mark, held to the checks every message is held to (%s)`, async (lang) => {
      const m = await grouped(k.template, lang);
      expect(m.subject.startsWith(`${MAIL_CHECK_MARK} `)).toBe(true);
      expect(headings(m.html)).toHaveLength(8);
      for (const path of k.paths) expect(m.text).toContain(`${SITE}${path}`);
      checkMessage(await viaLogSender(m), shapeOf(k.template, `mail check ${k.template} (${lang})`, SITE), lang);
    });

    it.each(LANGS)(`${k.template}: names a stop link as long as a full account's, under the header's limits, that leads nowhere (%s)`, async (lang) => {
      const m = await grouped(k.template, lang);
      const link = groupLinkOf(m.headers, k.param);
      expect(link).toMatch(new RegExp(`^${SITE.replace(/\./g, "\\.")}/account/stop\\?${k.param}=${ZERO}&t=[A-Za-z0-9_-]{${k.tags * 8}}(?:&lang=fr)?$`));
      const value = m.headers["List-Unsubscribe"];
      expect(value).toBe(`<mailto:contact@awardwatch.ca>, <${link}>`);
      expect(new TextEncoder().encode(value).length).toBeGreaterThan(k.tags * 8);
      expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(HEADER_VALUE_MAX);
      expect(`List-Unsubscribe: ${value}`.length).toBeLessThanOrEqual(LINE_MAX);
      expect(m.text).toContain(link!);
      // Each section's own stop link names zeros, as the other templates' do.
      const own = (m.text.match(new RegExp(`https:\\/\\/\\S+\\/account\\/stop\\?${k.own}=\\S+`, "g")) ?? []);
      expect(own).toHaveLength(8);
      for (const stop of own) {
        const params = new URL(stop).searchParams;
        expect([params.get(k.own), params.get("t")]).toEqual([ZERO, ZERO]);
      }
      // The link leads nowhere: the site's 404 on a GET, a form's POST and a mail client's one-click POST, and no row changes.
      const user = crypto.randomUUID().replace(/-/g, "");
      const item = crypto.randomUUID().replace(/-/g, "");
      await ACCOUNTS.batch([
        ACCOUNTS.prepare("INSERT INTO users (id, email, created_at, lang, status) VALUES (?, ?, '2026-01-01T00:00:00.000Z', 'en', 'active')").bind(user, newEmail("check-group-row")),
        ACCOUNTS.prepare("INSERT INTO saved_searches (id, user_id, kind, params, label, lang, created_at, deliver) VALUES (?, ?, 'tenders', '/tenders', 'Sample', 'en', '2026-01-01T00:00:00.000Z', 'daily')")
          .bind(item, user),
        ACCOUNTS.prepare("INSERT INTO delivery_tokens (search_id, secret, created_at) VALUES (?, ?, '2026-01-01T00:00:00.000Z')").bind(item, ZERO),
        ACCOUNTS.prepare("INSERT INTO briefings (id, user_id, kind, subject, segment, label, lang, created_at, deliver, secret) VALUES (?, ?, 'segment', '81', '', 'Sample', 'en', '2026-01-01T00:00:00.000Z', 'weekly', ?)")
          .bind(item, user, ZERO),
        ACCOUNTS.prepare("INSERT INTO saved_views (id, user_id, kind, address, name, lang, deliver, created_at, secret) VALUES (?, ?, 'segment', '/segments/81/analytics', 'Sample', 'en', 'weekly', '2026-01-01T00:00:00.000Z', ?)")
          .bind(item, user, ZERO),
      ]);
      const rows = async () => (await ACCOUNTS.batch([
        ACCOUNTS.prepare("SELECT id, deliver, last_delivered_at FROM saved_searches ORDER BY id"), ACCOUNTS.prepare("SELECT id, deliver FROM briefings ORDER BY id"),
        ACCOUNTS.prepare("SELECT id, deliver FROM saved_views ORDER BY id"),
      ])).map((r) => r.results);
      const audits = async () => (await ACCOUNTS.prepare("SELECT COUNT(*) AS n FROM audit WHERE event IN ('delivery_stopped', 'briefing_stopped', 'view_stopped')")
        .first<{ n: number }>())?.n;
      const before = await rows();
      const stopped = await audits();
      const u = new URL(link!);
      const path = `${u.pathname}${u.search}`;
      const post = (body: string) => app.request(path, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": nextIp() }, body,
      }, onEnv());
      expect((await app.request(path, { headers: { "cf-connecting-ip": nextIp() } }, onEnv())).status).toBe(404);
      expect((await post("List-Unsubscribe=One-Click")).status).toBe(404);
      expect((await post(new URLSearchParams({ [k.param]: ZERO, t: u.searchParams.get("t")!, lang }).toString())).status).toBe(404);
      expect(await rows()).toEqual(before);
      expect(await audits()).toBe(stopped);
      expect(nbsp(m.text)).not.toContain("undefined");
    });
  }
});
