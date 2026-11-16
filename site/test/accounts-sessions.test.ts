// The browser cap and the Signed-In Browsers panel (src/account/session.ts
// SESSIONS_MAX, startSession, revokeOtherSession, lookup's ended; routes.tsx
// signedIn, POST /account/sessions/:id/sign-out; pages.tsx SessionsPanel;
// privacy.tsx), against the local accounts database with the switch on and
// the log sender. The cap's batch runs here on the local D1 as session.ts
// writes it.
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/env";
import { fmtInt, t, type Key } from "../src/i18n";
import { bucketFor } from "../src/limits";
import { AUDIT_DAYS } from "../src/account/audit";
import { SESSIONS_MAX, SESSION_CAP_SQL, startSession } from "../src/account/session";
import { ACCOUNT_STRINGS } from "../src/account/strings";
import {
  ACCOUNTS, csrf, decode, get, nbsp, newEmail, onEnv, post, requestCode, sessionCookie, signIn, useAccountsDb, userId,
} from "./accounts-helpers";

useAccountsDb();

const UA = {
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  mobile: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1",
  tablet: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/604.1",
};
const as = (ua: keyof typeof UA) => ({ headers: { "user-agent": UA[ua] } });

const idOf = (cookie: string) => /__Host-aw_session=([0-9a-f]{32})/.exec(cookie)![1];
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const cap = fmtInt(SESSIONS_MAX, "en");
const read = async (res: Response) => nbsp(decode(await res.text()));

async function liveIds(email: string): Promise<string[]> {
  const rows = await ACCOUNTS.prepare("SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY id")
    .bind(await userId(email), new Date().toISOString()).all<{ id: string }>();
  return (rows.results ?? []).map((r) => r.id).sort();
}

async function auditOf(email: string): Promise<{ event: string; detail: string | null }[]> {
  const rows = await ACCOUNTS.prepare("SELECT event, detail FROM audit WHERE user_id = ? ORDER BY id").bind(await userId(email)).all<{ event: string; detail: string | null }>();
  return rows.results ?? [];
}

// Three browsers signed in, each then given a last use: the middle one signed
// in is the one used least recently, so the cap is seen to follow last use and
// not the order of signing in. Nothing reads a session before the fourth
// sign-in, so no read moves a last use.
async function threeBrowsers(tag: string) {
  const email = newEmail(tag);
  const a = await signIn(email, as("desktop"));
  const b = await signIn(email, as("mobile"));
  const c = await signIn(email, as("tablet"));
  const set = ACCOUNTS.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?");
  await ACCOUNTS.batch([set.bind(ago(2), idOf(a)), set.bind(ago(5), idOf(b)), set.bind(ago(1), idOf(c))]);
  return { email, a, b, c };
}

// The fourth sign-in, from a fresh browser.
async function fourth(email: string, fields: Record<string, string> = {}) {
  const { code } = await requestCode(email, as("desktop"));
  return post("/account/check", { email, code, sent: "1", ...fields }, as("desktop"));
}

describe("the browser cap", () => {
  it("runs as one batch on D1: the insert and the update that keeps the most recently used", () => {
    expect(SESSIONS_MAX).toBe(3);
    expect(SESSION_CAP_SQL).toContain("id NOT IN (SELECT id FROM sessions WHERE user_id = ?2 AND revoked_at IS NULL AND expires_at > ?1");
    expect(SESSION_CAP_SQL).toContain("ORDER BY id = ?4 DESC, last_seen_at DESC, created_at DESC, id DESC LIMIT ?3)");
  });

  it("keeps the session it hands out even when the others were stamped later by another clock", async () => {
    const { email, a, b, c } = await threeBrowsers("cap-skew");
    // All three a few minutes ahead of the request's clock, b the least ahead.
    const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
    const set = ACCOUNTS.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?");
    await ACCOUNTS.batch([set.bind(ahead(3), idOf(a)), set.bind(ahead(1), idOf(b)), set.bind(ahead(2), idOf(c))]);
    const res = await fourth(email);
    const d = sessionCookie(res);
    expect(await liveIds(email)).toEqual([idOf(a), idOf(c), idOf(d)].sort());
    expect((await get("/account", { cookie: d })).status).toBe(200);
    expect((await get("/account", { cookie: b })).headers.get("location")).toBe("/account/sign-in?m=ended");
  });

  it("ends the session used least recently at the fourth sign-in, leaves 3, and says so on the overview", async () => {
    const { email, a, b, c } = await threeBrowsers("cap");
    const res = await fourth(email);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account?m=capped");
    const d = sessionCookie(res);
    expect(await liveIds(email)).toEqual([idOf(a), idOf(c), idOf(d)].sort());
    const ended = await ACCOUNTS.prepare("SELECT revoked_at FROM sessions WHERE id = ?").bind(idOf(b)).first<{ revoked_at: string | null }>();
    expect(ended?.revoked_at).not.toBeNull();
    // One audit row with the count, beside the sign-in's own.
    const rows = await auditOf(email);
    expect(rows.filter((r) => r.event === "signed_out")).toEqual([{ event: "signed_out", detail: "cap 1" }]);
    const page = await read(await get("/account?m=capped", { cookie: d }));
    expect(page).toContain(`<p class="account-notice" role="status">${t("en", "account.msg_capped", { cap })}</p>`);
    expect(page).toContain("This account was signed in on 3 browsers already, so the one used least recently was signed out.");
    expect(page).toContain(`<dt>Signed-in browsers</dt><dd>3 of ${cap} browsers</dd>`);
  });

  it("keeps a sign-in with a page to return to on that page, and a sign-in under the cap on its usual way", async () => {
    const { email } = await threeBrowsers("cap-next");
    const res = await fourth(email, { next: "/account/keys" });
    expect(res.headers.get("location")).toBe("/account/keys");
    expect((await auditOf(email)).filter((r) => r.event === "signed_out")).toEqual([{ event: "signed_out", detail: "cap 1" }]);
    expect(await liveIds(email)).toHaveLength(SESSIONS_MAX);
    // Under the cap nothing ends and no line is added.
    const other = newEmail("cap-under");
    await signIn(other);
    const { code } = await requestCode(other);
    const second = await post("/account/check", { email: other, code, sent: "1" });
    expect(second.headers.get("location")).toBe("/account");
    expect((await auditOf(other)).some((r) => r.event === "signed_out")).toBe(false);
    expect(await liveIds(other)).toHaveLength(2);
  });

  it("leaves at most 3 when sign-ins land at the same moment", async () => {
    const email = newEmail("cap-race");
    await signIn(email);
    const user = await userId(email);
    const mini = new Hono<AppEnv>();
    mini.post("/start", async (c) => c.json({ ended: await startSession(c, user, "desktop") }));
    const answers = await Promise.all(Array.from({ length: 6 }, () => mini.request("/start", { method: "POST" }, onEnv())));
    const ended = await Promise.all(answers.map(async (r) => ((await r.json()) as { ended: number }).ended));
    expect(await liveIds(email)).toHaveLength(SESSIONS_MAX);
    // Seven sessions made, three kept: every one past the cap was ended exactly once.
    expect(ended.reduce((s, n) => s + n, 0)).toBe(7 - SESSIONS_MAX);
    // Two at once on top of three live ones: still three.
    const two = await Promise.all([0, 1].map(() => mini.request("/start", { method: "POST" }, onEnv())));
    expect(two.every((r) => r.status === 200)).toBe(true);
    expect(await liveIds(email)).toHaveLength(SESSIONS_MAX);
  });

  it("writes an audit detail with the count and nothing else: no session id, no address", async () => {
    const { email } = await threeBrowsers("cap-audit");
    await fourth(email);
    const ids = ((await ACCOUNTS.prepare("SELECT id FROM sessions WHERE user_id = ?").bind(await userId(email)).all<{ id: string }>()).results ?? [])
      .map((r) => r.id);
    expect(ids.length).toBe(4);
    for (const row of await auditOf(email)) {
      const detail = row.detail ?? "";
      expect(detail).not.toContain("@");
      expect(detail).not.toContain(email.split("@")[0]);
      for (const id of ids) expect(detail).not.toContain(id);
      if (row.event === "signed_out") expect(detail).toMatch(/^cap [0-9]+$/);
    }
  });
});

describe("a browser the cap signed out", () => {
  it("goes from its next account page to sign in, with the line and the page it asked for", async () => {
    const { email, b } = await threeBrowsers("ended");
    await fourth(email);
    const page = await get("/account/searches?m=added", { cookie: b });
    expect(page.status).toBe(303);
    const to = page.headers.get("location")!;
    expect(to).toBe(`/account/sign-in?m=ended&next=${encodeURIComponent("/account/searches?m=added")}`);
    expect(page.headers.getSetCookie().join("\n")).toMatch(/__Host-aw_session=;.*Max-Age=0/);
    // The overview carries no page; a form's press neither.
    expect((await get("/account", { cookie: b })).headers.get("location")).toBe("/account/sign-in?m=ended");
    const press = await post("/account/sign-out", { csrf: "0".repeat(32) }, { cookie: b });
    expect(press.headers.get("location")).toBe("/account/sign-in?m=ended");
    // The sign-in page says why, keeps the page, and offers the form.
    const form = await read(await get(to));
    expect(form).toContain(`<p class="account-notice" role="status">${t("en", "account.msg_ended", { cap })}</p>`);
    expect(form).toContain("This browser was signed out. That happens when the account signs out from another browser, or signs in on more than 3 browsers. Sign in again to continue.");
    expect(form).toContain('<input type="hidden" name="next" value="/account/searches?m=added"/>');
    const fr = await read(await get("/account/sign-in?m=ended&lang=fr"));
    expect(fr).toContain(nbsp(t("fr", "account.msg_ended", { cap: fmtInt(SESSIONS_MAX, "fr") })));
    expect(fr).toContain("Ce navigateur a été déconnecté. Cela se produit quand le compte se déconnecte depuis un autre navigateur ou se connecte dans plus de 3 navigateurs.");
  });

  it("is told only with the cookie's own secret: the id with another secret reads as any unknown session", async () => {
    const { email, b } = await threeBrowsers("ended-forged");
    await fourth(email);
    const forged = `__Host-aw_session=${idOf(b)}.${"0".repeat(64)}`;
    expect((await get("/account/keys", { cookie: forged })).headers.get("location")).toBe(`/account/sign-in?next=${encodeURIComponent("/account/keys")}`);
    expect((await get("/account", { cookie: forged })).headers.get("location")).toBe("/account/sign-in");
    // A session that ran out is not one another browser ended.
    const lapsed = newEmail("ended-lapsed");
    const cookie = await signIn(lapsed);
    await ACCOUNTS.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").bind(ago(1), idOf(cookie)).run();
    expect((await get("/account", { cookie })).headers.get("location")).toBe("/account/sign-in");
  });

  it("reads as signed out on a public page, the page a reader without a session gets", async () => {
    const { email, b } = await threeBrowsers("ended-public");
    await fourth(email);
    const out = await get("/tenders");
    const ended = await get("/tenders", { cookie: b });
    expect(ended.status).toBe(200);
    const body = await ended.text();
    expect(body).toBe(await out.text());
    expect(body).toContain('<a class="rail-item rail-account" href="/account/sign-in"><span class="rail-label">Sign in</span></a>');
    expect(body).not.toContain(email);
    expect(ended.headers.get("cache-control")).toBe(out.headers.get("cache-control"));
  });
});

// The Signed-In Browsers panel of the overview, cut out of the page.
const panelOf = (html: string) => /<section class="panel"><div class="panel-head"><h2 id="browsers">[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";

describe("the Signed-In Browsers panel", () => {
  async function twoAccounts(tag: string) {
    const email = newEmail(tag);
    const a1 = await signIn(email, as("desktop"));
    const a2 = await signIn(email, as("mobile"));
    // A third ended and a fourth run out, neither listed.
    const a3 = await signIn(email, as("tablet"));
    await ACCOUNTS.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), idOf(a3)).run();
    const user = await userId(email);
    const lapsedId = crypto.randomUUID().replace(/-/g, "");
    await ACCOUNTS.prepare(
      "INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at, ua_class) VALUES (?, ?, 'h', ?, ?, ?, 'desktop')",
    ).bind(lapsedId, user, ago(800), ago(790), ago(70)).run();
    const other = newEmail(`${tag}-other`);
    const b1 = await signIn(other, as("desktop"));
    return { email, other, a1, a2, a3, lapsedId, b1 };
  }

  it("lists only the account's own live sessions, marks this browser, and counts them against the cap", async () => {
    const s = await twoAccounts("panel");
    const html = await read(await get("/account", { cookie: s.a1 }));
    expect(html).toContain(`<dt>Signed-in browsers</dt><dd>2 of ${cap} browsers</dd>`);
    const panel = panelOf(html);
    expect(panel).toContain('<h2 id="browsers">Signed-In Browsers</h2>');
    expect(panel.match(/<tr>/g)).toHaveLength(3); // the head's row and two sessions
    expect(panel).toContain(`action="/account/sessions/${idOf(s.a2)}/sign-out"`);
    expect(panel.match(/action="\/account\/sessions\//g)).toHaveLength(1);
    for (const id of [idOf(s.a1), idOf(s.a3), s.lapsedId, idOf(s.b1)]) expect(html, id).not.toContain(id);
    expect(panel.match(/This browser/g)).toHaveLength(1);
    expect(panel).toContain("<td>Desktop</td>");
    expect(panel).toContain("<td>Mobile</td>");
    expect(panel).not.toContain("Tablet");
    expect(panel).toMatch(/<td data-label="Signed in" class="mono">\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC<\/td>/);
    expect(panel).toMatch(/aria-label="Sign out \(Mobile, signed in \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC, last used \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\)">Sign out<\/button>/);
    expect(panel).toContain(`<p class="muted small">${t("en", "account.sessions_rule", { cap })}</p>`);
    // Flat controls: no filled button in the panel; Sign out everywhere stays below it.
    expect(panel).not.toContain("btn-primary");
    expect(panel).toContain('class="btn-link"');
    expect(html.indexOf('<h2 id="browsers">')).toBeLessThan(html.indexOf("Sign out everywhere"));
    expect(html).toContain('<input type="hidden" name="scope" value="all"/>');
    // The other account sees its own one browser.
    const theirs = panelOf(await read(await get("/account", { cookie: s.b1 })));
    expect(theirs.match(/<tr>/g)).toHaveLength(2);
    expect(theirs).not.toContain("action=");
    for (const id of [idOf(s.a1), idOf(s.a2)]) expect(theirs).not.toContain(id);
  });

  it("signs out another of the account's browsers from its row, and that browser reads it as ended", async () => {
    const s = await twoAccounts("panel-out");
    const res = await post(`/account/sessions/${idOf(s.a2)}/sign-out`, { csrf: await csrf(s.a1) }, { cookie: s.a1 });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/account?m=session_out");
    expect(res.headers.getSetCookie().some((c) => c.startsWith("__Host-aw_session=;"))).toBe(false);
    expect(await liveIds(s.email)).toEqual([idOf(s.a1)]);
    const page = await read(await get("/account?m=session_out", { cookie: s.a1 }));
    expect(page).toContain(`<p class="account-notice" role="status">The browser was signed out.</p>`);
    expect(page).toContain(`<dd>1 of ${cap} browsers</dd>`);
    expect((await get("/account", { cookie: s.a2 })).headers.get("location")).toBe("/account/sign-in?m=ended");
    expect((await auditOf(s.email)).filter((r) => r.event === "signed_out")).toEqual([{ event: "signed_out", detail: "other browser" }]);
  });

  it("answers another account's session, an unknown one, a malformed one and this browser's own alike, and ends none", async () => {
    const s = await twoAccounts("panel-idor");
    const token = await csrf(s.a1);
    const before = (await auditOf(s.email)).length;
    const theirsBefore = (await auditOf(s.other)).length;
    const answers = [];
    for (const id of [idOf(s.b1), "f".repeat(32), "not-a-session", idOf(s.a1), idOf(s.a3)]) {
      const res = await post(`/account/sessions/${id}/sign-out`, { csrf: token }, { cookie: s.a1 });
      answers.push({ status: res.status, location: res.headers.get("location"), cookies: res.headers.getSetCookie(), body: await res.text() });
    }
    for (const a of answers) expect(a).toEqual(answers[0]);
    expect(answers[0]).toEqual({ status: 303, location: "/account?m=session_out", cookies: [], body: "" });
    expect(await liveIds(s.other)).toEqual([idOf(s.b1)]);
    expect(await liveIds(s.email)).toEqual([idOf(s.a1), idOf(s.a2)].sort());
    expect((await get("/account", { cookie: s.b1 })).status).toBe(200);
    expect((await auditOf(s.email)).length).toBe(before);
    expect((await auditOf(s.other)).length).toBe(theirsBefore);
  });

  it("refuses the post without the page's CSRF value or from another site, and ends nothing", async () => {
    const s = await twoAccounts("panel-csrf");
    const path = `/account/sessions/${idOf(s.a2)}/sign-out`;
    expect((await post(path, {}, { cookie: s.a1 })).status).toBe(403);
    expect((await post(path, { csrf: "0".repeat(32) }, { cookie: s.a1 })).status).toBe(403);
    // The other browser's own value is not this one's.
    expect((await post(path, { csrf: await csrf(s.b1) }, { cookie: s.a1 })).status).toBe(403);
    expect((await post(path, { csrf: await csrf(s.a1) }, { cookie: s.a1, origin: "https://evil.example" })).status).toBe(403);
    expect((await post(path, { csrf: await csrf(s.a1) }, { cookie: s.a1, origin: "null" })).status).toBe(403);
    // Signed out, it goes to sign in.
    const out = await post(path, { csrf: await csrf(s.a1) });
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/account/sign-in");
    expect(await liveIds(s.email)).toEqual([idOf(s.a1), idOf(s.a2)].sort());
  });

  it("counts the post in the edit bucket", () => {
    expect(bucketFor("POST", `/account/sessions/${"a".repeat(32)}/sign-out`)).toBe("edit");
    expect(bucketFor("GET", `/account/sessions/${"a".repeat(32)}/sign-out`)).toBe("page");
    expect(bucketFor("POST", "/account/sessions/a/b/sign-out")).toBe("page");
  });
});

const NEW_KEYS = [
  "account.sessions_title", "account.sessions_count", "account.sessions_rule", "account.session_col_device", "account.session_col_start",
  "account.session_row", "account.session_this", "account.session_out", "account.msg_session_out", "account.msg_capped", "account.msg_ended",
  "account.privacy_sessions",
] as const;
// The en dash and the em dash, by code point, so this file holds neither.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
// The strings that state the cap: each takes it as {cap}, never as a figure of its own.
const CAP_KEYS = ["account.sessions_count", "account.sessions_rule", "account.msg_capped", "account.msg_ended", "account.privacy_sessions"] as const;

describe("the figures and the words", () => {
  it("read the cap from SESSIONS_MAX in the row, the panel, the lines and the privacy sentence", async () => {
    for (const key of CAP_KEYS) {
      for (const lang of ["en", "fr"] as const) {
        const s = ACCOUNT_STRINGS[key][lang];
        expect(s, `${key} ${lang}`).toContain("{cap}");
        expect(s, `${key} ${lang}`).not.toMatch(/[0-9]/);
      }
    }
    const privacy = await read(await get("/privacy"));
    expect(privacy).toContain(t("en", "account.privacy_sessions", { cap, days: fmtInt(AUDIT_DAYS, "en") }));
    expect(privacy).toContain(
      "An account stays signed in on at most 3 browsers; signing in on another signs out the one used least recently. Each signed-in browser keeps its device class (desktop, phone or tablet) and when it signed in and was last used, for 90 days after it ends.",
    );
    const fr = await read(await get("/privacy?lang=fr"));
    expect(fr).toContain(nbsp(t("fr", "account.privacy_sessions", { cap: fmtInt(SESSIONS_MAX, "fr"), days: fmtInt(AUDIT_DAYS, "fr") })));
    // While accounts are closed the privacy page says nothing of browsers signed in.
    const closed = await read(await get("/privacy", { env: { ...onEnv(), ACCOUNTS_ENABLED: "false" } }));
    expect(closed).not.toContain("signed in on at most");
  });

  it("are in English and French, the French its own, with no dash of either kind", () => {
    for (const key of NEW_KEYS) {
      const { en, fr } = ACCOUNT_STRINGS[key];
      expect(en.trim(), key).not.toBe("");
      expect(fr.trim(), key).not.toBe("");
      expect(fr, key).not.toBe(en);
      for (const s of [en, fr]) expect(s, key).not.toMatch(DASHES);
    }
  });

  it("draw the overview, the notices and the panel in French", async () => {
    const email = newEmail("panel-fr");
    const a = await signIn(email, as("desktop"));
    await signIn(email, as("mobile"));
    const html = await read(await get("/account?lang=fr&m=capped", { cookie: a }));
    const tr = (key: Key, vars?: Record<string, string>) => nbsp(t("fr", key, vars));
    expect(html).toContain(`<dd>${tr("account.sessions_count", { n: "2", cap })}</dd>`);
    expect(html).toContain("2 navigateurs sur 3");
    expect(html).toContain(tr("account.msg_capped", { cap }));
    const panel = panelOf(html);
    expect(panel).toContain('<h2 id="browsers">Navigateurs connectés</h2>');
    expect(panel).toContain("<th>Appareil</th><th>Connexion</th><th>Dernière utilisation</th>");
    expect(panel).toContain("<td>Ordinateur</td>");
    expect(panel).toContain("<td>Téléphone</td>");
    expect(panel).toContain("<span>Ce navigateur</span>");
    expect(panel).toMatch(/aria-label="Déconnecter \(Téléphone, connecté le [^"]+ UTC, dernière utilisation le [^"]+ UTC\)">Déconnecter<\/button>/);
    expect(panel).toContain(tr("account.sessions_rule", { cap }));
    expect(html).not.toMatch(DASHES);
    const out = await read(await get("/account?lang=fr&m=session_out", { cookie: a }));
    expect(out).toContain("Le navigateur a été déconnecté.");
  });
});
