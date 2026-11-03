// The /account routes, mounted by index.tsx. While the switch is off every one
// of them answers the site's own 404 before anything is read. While it is on:
//
//   GET  /account/sign-in              the address form (a session goes to /account)
//   POST /account/sign-in              makes a code and a link, sends them; the same page for any address
//   GET  /account/check                the code form; with ?token= the link's confirm button
//   POST /account/check                a code (with the address) or the link's token; starts the session
//   GET  /account                      the overview                                   (session)
//   POST /account/sign-out             this browser, or every browser (scope=all)     (session, CSRF)
//   GET  /account/searches             saved searches, the alerts form's rows to add  (session)
//   POST /account/searches             add from a page address                        (session, CSRF)
//   POST /account/searches/import      add the alerts form's rows                     (session, CSRF)
//   POST /account/searches/:id         email delivery                                 (session, CSRF)
//   POST /account/searches/:id/delete  remove one                                     (session, CSRF)
//   GET  /account/keys                 API keys                                       (session)
//   POST /account/keys                 create one, shown once                         (session, CSRF, plan)
//   POST /account/keys/:id/revoke      revoke one                                     (session, CSRF)
//   GET  /account/delete               what deleting removes                          (session)
//   POST /account/delete               delete, after cancelling a subscription        (session, CSRF)
//   GET  /account/stop?s=&t=           a delivery's stop page, from its message       (the link's secret)
//   POST /account/stop?s=&t=           turn that delivery off; also RFC 8058 one-click (the link's secret)
//   GET  /account/billing              the plan, the prices or the subscription       (session)
//   POST /account/billing/checkout     to the payment service's checkout              (session, CSRF)
//   POST /account/billing/portal       to the payment service's portal                (session, CSRF)
//   POST /account/billing/webhook      the payment service's notices                  (signature only)
//
// Every POST but the stop link's and the webhook's (which Stripe sends,
// signed; billing.tsx) is refused with a 403 when its Origin names another
// site (or "null"); a client that sends no Origin is let through, as
// interest.tsx does, since a browser always sends one with a form post. The
// two sign-in posts are capped per address by AUTH_LIMIT (limits.ts); the
// codes per address are capped in the database (signin.ts). Every response is
// no-store and noindex. The site's referrer policy already keeps a link's
// token off any request to another site.

import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { isOwnAddress } from "../api";
import { readForm } from "../body";
import type { AppEnv } from "../env";
import { t, type Key, type Lang } from "../i18n";
import { EMAIL_MAX, interestFilter, kindOfPath, normalizeEmail } from "../pages/interest";
import { deviceClass } from "../views";
import { KEY_NAME_MAX, createKey, listKeys, revokeKey } from "./api_keys";
import { audit } from "./audit";
import { billingLine, billingPage, billingWebhook, endForDeletion, openPortal, startCheckout } from "./billing";
import { allowed } from "./entitlements";
import {
  accountPage, codeView, deleteView, deletedView, keysView, linkView, overviewView, searchesView, signInView, stopView, stoppedView,
  unavailableView,
} from "./pages";
import {
  addSearch, capFor, deleteSearch, importInterest, isDelivery, lastDeliveries, listSearches, pendingInterest, setDelivery,
} from "./searches";
import { randomHex, sameHash, sha256Hex, ipHash } from "./secrets";
import { isLocalHost, senderFor, signInMessage } from "./sender";
import {
  type Account, type UaClass, SESSION_COOKIE, clearSessionCookie, csrfValid, markSignedOut, readSession, revokeAllSessions,
  revokeSession, startSession,
} from "./session";
import { CODE_MINUTES, CODES_PER_HOUR, CODE_TRIES, type Checked, checkCode, checkLink, findOrCreateUser, issueCode, sweep } from "./signin";
import { accountsEnabled } from "./switch";

export const account = new Hono<AppEnv>();

account.use("*", async (c, next) => {
  if (!accountsEnabled(c.env)) return c.notFound();
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
});

// -- shared steps --------------------------------------------------------------------

const CONTROL_RE = /[\u0000-\u001F\u007F]/g;

function clean(fields: Record<string, string>, key: string, max: number): string {
  const v = fields[key];
  return (typeof v === "string" ? v : "").replace(CONTROL_RE, "").trim().slice(0, max);
}

// The body of a POST from the site's own pages, or the refusal.
async function postFields(c: Context<AppEnv>): Promise<Record<string, string> | Response> {
  const origin = c.req.header("origin");
  if (origin !== undefined && !isOwnAddress(origin, c.req.url)) return c.text(t(c.get("lang"), "form.rejected"), 403);
  const form = await readForm(c);
  if (!form.ok) return c.text(t(c.get("lang"), "form.rejected"), form.status);
  const asked = form.fields.lang;
  if (asked === "en" || asked === "fr") c.set("lang", asked);
  return form.fields;
}

function unavailable(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  return accountPage(c, t(lang, "account.unavailable_title"), unavailableView(lang), 503);
}

// The signed-in account, or the answer for a request without one: the
// sign-in page (cookie cleared) when the session does not stand, the 503
// page when the database cannot say.
async function signedIn(c: Context<AppEnv>): Promise<Account | Response> {
  const read = await readSession(c, { touch: true });
  if (read.state === "ok") return read.account;
  if (read.state === "unavailable") return unavailable(c);
  if (getCookie(c, SESSION_COOKIE)) clearSessionCookie(c);
  return c.redirect("/account/sign-in", 303);
}

// A POST that needs the session: the Origin, then the session, then the CSRF
// value the page's form carried.
async function signedInPost(c: Context<AppEnv>): Promise<{ account: Account; fields: Record<string, string> } | Response> {
  const fields = await postFields(c);
  if (fields instanceof Response) return fields;
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  if (!csrfValid(who, fields.csrf)) return c.text(t(c.get("lang"), "form.rejected"), 403);
  return { account: who, fields };
}

// Any database fault inside a handler ends on the 503 page, never a 500.
async function guarded(c: Context<AppEnv>, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    console.error(`account: ${String(e).slice(0, 120)}`);
    return unavailable(c);
  }
}

function uaClass(c: Context<AppEnv>): UaClass | null {
  return deviceClass(c.req.header("user-agent"), c.req.header("sec-ch-ua-mobile")) || null;
}

// Where the message's link and its wordmark images point: the request's own
// origin on a local run, the site's address otherwise.
function siteBase(c: Context<AppEnv>): string {
  if (isLocalHost(c.req.url) || !c.env.SITE_URL) return new URL(c.req.url).origin;
  return c.env.SITE_URL.replace(/\/+$/, "");
}

// -- sign-in ----------------------------------------------------------------------------

account.get("/sign-in", async (c) => {
  const lang = c.get("lang");
  if ((await readSession(c)).state === "ok") return c.redirect("/account", 303);
  const m = c.req.query("m");
  const notice = m === "out" ? t(lang, "account.msg_signed_out") : m === "out_all" ? t(lang, "account.msg_signed_out_all") : null;
  return accountPage(c, t(lang, "account.sign_in_title"), signInView(lang, { notice }));
});

account.post("/sign-in", async (c) => {
  const fields = await postFields(c);
  if (fields instanceof Response) return fields;
  const lang = c.get("lang");
  const typed = clean(fields, "email", EMAIL_MAX + 50);
  const again = (errors: Key[], status: number, limitN?: number) =>
    accountPage(c, t(lang, "account.sign_in_title"), signInView(lang, { errors, email: typed.slice(0, EMAIL_MAX), limitN }), status);
  if (clean(fields, "website", 10)) return again(["interest.err_rejected"], 400);
  const email = normalizeEmail(typed);
  if (!email) return again(["interest.err_email"], 400);
  return guarded(c, async () => {
    const now = new Date();
    await sweep(c.env, now);
    const issued = await issueCode(c.env, email, await ipHash(c.env.VIEWS_SALT_KEY, c.req.header("cf-connecting-ip"), now), now);
    if (issued === "limited") {
      await audit(c.env, null, "code_limited", null, now);
      return again(["account.err_limited"], 429, CODES_PER_HOUR);
    }
    await audit(c.env, issued.userId, "code_requested", null, now);
    const base = siteBase(c);
    const link = `${base}/account/check?token=${issued.token}${lang === "fr" ? "&lang=fr" : ""}`;
    const sent = await senderFor(c.env, c.req.url)
      .send(signInMessage(lang, email, issued.code, link, CODE_MINUTES, base))
      .catch(() => ({ sent: false, reason: "failed" }) as const);
    if (!sent.sent) {
      if (sent.reason === "failed") await audit(c.env, issued.userId, "mail_failed", null, now);
      return again([sent.reason === "not_configured" ? "account.err_not_sent" : "account.err_send_failed"], 503);
    }
    return accountPage(c, t(lang, "account.check_title"), codeView(lang, { email, sent: true }));
  });
});

const TOKEN_RE = /^[0-9a-f]{32}\.[0-9a-f]{64}$/;

// The link is not used here: the page holds a button that posts it.
account.get("/check", async (c) => {
  const lang = c.get("lang");
  const token = c.req.query("token");
  if (token !== undefined) {
    const ok = TOKEN_RE.test(token);
    return accountPage(c, t(lang, "account.link_title"), linkView(lang, ok ? token : "", ok ? undefined : ["account.err_stale"]), ok ? 200 : 400);
  }
  return accountPage(c, t(lang, "account.enter_title"), codeView(lang));
});

const CHECK_ERROR: Record<Exclude<Checked, { ok: true }>["reason"], Key> = {
  wrong: "account.err_code", locked: "account.err_locked", stale: "account.err_stale",
};

account.post("/check", async (c) => {
  const fields = await postFields(c);
  if (fields instanceof Response) return fields;
  const lang = c.get("lang");
  const token = clean(fields, "token", 200);
  const typed = clean(fields, "email", EMAIL_MAX + 50);
  const sentForm = clean(fields, "sent", 1) === "1";
  return guarded(c, async () => {
    const now = new Date();
    let checked: Checked;
    let email: string | null = null;
    if (token) {
      checked = await checkLink(c.env, token, now);
    } else {
      email = normalizeEmail(typed);
      checked = email ? await checkCode(c.env, email, clean(fields, "code", 20).replace(/\s+/g, ""), now) : { ok: false, reason: "wrong", left: CODE_TRIES };
    }
    if (!checked.ok) {
      // The third and fourth wrong codes of the hour say how many tries are left.
      const left = checked.reason === "wrong" ? checked.left : null;
      const errors: Key[] = [left === 2 ? "account.err_code_two" : left === 1 ? "account.err_code_one" : CHECK_ERROR[checked.reason]];
      if (token) return accountPage(c, t(lang, "account.link_title"), linkView(lang, "", errors), 400);
      const title = t(lang, sentForm ? "account.check_title" : "account.enter_title");
      return accountPage(c, title, codeView(lang, { email: email ?? typed.slice(0, EMAIL_MAX), sent: sentForm && !!email, errors }), 400);
    }
    const user = await findOrCreateUser(c.env, checked.email, lang, now);
    if (user.created) await audit(c.env, user.id, "user_created", null, now);
    // The session this browser held until now (the same account or another)
    // ends here rather than living on unseen until its 30 days run out: its
    // cookie is about to be replaced.
    const before = await readSession(c);
    if (before.state === "ok") {
      await revokeSession(c.env, before.account.sessionId, now);
      await audit(c.env, before.account.userId, "signed_out", "replaced", now);
    }
    await startSession(c, user.id, uaClass(c), now);
    await audit(c.env, user.id, "signed_in", token ? "link" : "code", now);
    const pending = await pendingInterest(c.env, checked.email, user.id).catch(() => []);
    return c.redirect(pending.length ? "/account/searches" : "/account", 303);
  });
});

account.post("/sign-out", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  return guarded(c, async () => {
    const all = fields.scope === "all";
    if (all) await revokeAllSessions(c.env, who.userId);
    else await revokeSession(c.env, who.sessionId);
    await audit(c.env, who.userId, all ? "signed_out_everywhere" : "signed_out");
    clearSessionCookie(c);
    markSignedOut(c);
    return c.redirect(`/account/sign-in?m=${all ? "out_all" : "out"}`, 303);
  });
});

// -- the overview ------------------------------------------------------------------------------

account.get("/", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  const lang = c.get("lang");
  return guarded(c, async () => {
    const counts = await c.env.ACCOUNTS!.prepare(
      "SELECT (SELECT COUNT(*) FROM sessions WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > ?2) AS sessions, " +
      "(SELECT COUNT(*) FROM saved_searches WHERE user_id = ?1) AS searches, " +
      "(SELECT COUNT(*) FROM api_keys WHERE user_id = ?1 AND revoked_at IS NULL) AS keys",
    ).bind(who.userId, new Date().toISOString()).first<{ sessions: number; searches: number; keys: number }>();
    return accountPage(c, t(lang, "account.title"), overviewView(lang, who, {
      sessions: counts?.sessions ?? 0, searches: counts?.searches ?? 0, cap: capFor(who), keys: counts?.keys ?? 0,
    }, {
      billing: await billingLine(c.env, who.userId),
      // Stripe's checkout returns here; the plan changes when its notice lands, often a moment later.
      notice: c.req.query("billing") === "done" ? t(lang, "billing.msg_done") : null,
    }));
  });
});

// -- saved searches ------------------------------------------------------------------------------

const SEARCH_NOTICE: Record<string, Key> = {
  added: "account.msg_added", exists: "account.msg_exists", deleted: "account.msg_deleted", changed: "account.msg_changed",
  imported: "account.msg_imported", imported_some: "account.msg_imported_some", pro: "account.deliver_pro",
};

// A stored label is in the language of the page it was saved from; the page
// shows each one rebuilt in its own language, the stored label when the
// filter no longer rebuilds (a name the data no longer holds).
async function labelIn(c: Context<AppEnv>, lang: Lang, row: { kind: string; params: string; label: string; lang: string }): Promise<string> {
  if (row.lang === lang) return row.label;
  const rebuilt = await interestFilter(c.env, lang, row.kind, row.params).catch(() => null);
  return rebuilt?.label ?? row.label;
}

async function searchesPage(c: Context<AppEnv>, who: Account, extra: { errors?: Key[]; url?: string; status?: number } = {}) {
  const lang = c.get("lang");
  const [stored, waiting, last] = await Promise.all([
    listSearches(c.env, who.userId), pendingInterest(c.env, who.email, who.userId), lastDeliveries(c.env, who.userId),
  ]);
  const searches = await Promise.all(stored.map(async (s) => ({ ...s, label: await labelIn(c, lang, s), last: last.get(s.id) ?? null })));
  const pending = await Promise.all(waiting.map(async (r) => ({ ...r, label: await labelIn(c, lang, r) })));
  const cap = capFor(who);
  const m = c.req.query("m") ?? "";
  const notice = m === "cap"
    ? t(lang, who.plan === "free" ? "account.cap_free" : "account.cap_pro", { cap })
    : SEARCH_NOTICE[m] ? t(lang, SEARCH_NOTICE[m]) : null;
  return accountPage(c, t(lang, "account.searches_title"),
    searchesView(lang, who, { searches, cap, pending, notice, errors: extra.errors, url: extra.url }), extra.status ?? 200);
}

account.get("/searches", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => searchesPage(c, who));
});

// A page address as the user pasted it: a path on the site, or a full
// address on the site's host. Anything else is not a page to save.
function sitePath(raw: string, requestUrl: string): string | null {
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    return isOwnAddress(url.origin, requestUrl) ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

account.post("/searches", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const lang = c.get("lang");
  const raw = clean(fields, "url", 2100);
  return guarded(c, async () => {
    const path = sitePath(raw, c.req.url);
    const kind = path ? kindOfPath(path.split("?")[0]) : null;
    const filter = path && kind ? await interestFilter(c.env, lang, kind, path) : null;
    if (!filter) return searchesPage(c, who, { errors: ["account.err_url"], url: raw, status: 400 });
    const result = await addSearch(c.env, who, filter, lang);
    if (result === "added") await audit(c.env, who.userId, "search_added", filter.kind);
    return c.redirect(`/account/searches?m=${result === "added" ? "added" : result}`, 303);
  });
});

account.post("/searches/import", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    const { imported, left } = await importInterest(c.env, who);
    await audit(c.env, who.userId, "searches_imported", `${imported} added, ${left} left`);
    return c.redirect(`/account/searches?m=${left ? "imported_some" : "imported"}`, 303);
  });
});

account.post("/searches/:id/delete", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    if (await deleteSearch(c.env, who.userId, c.req.param("id") ?? "")) await audit(c.env, who.userId, "search_deleted");
    return c.redirect("/account/searches?m=deleted", 303);
  });
});

account.post("/searches/:id", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const deliver = fields.deliver;
  if (!isDelivery(deliver)) return c.text(t(c.get("lang"), "form.rejected"), 400);
  if (deliver !== "off" && !allowed(who, "delivery")) return c.redirect("/account/searches?m=pro", 303);
  return guarded(c, async () => {
    // Nothing changes for a search of a kind that cannot be delivered yet (searches.ts).
    if (!(await setDelivery(c.env, who.userId, c.req.param("id") ?? "", deliver))) return c.redirect("/account/searches", 303);
    await audit(c.env, who.userId, "search_changed", deliver);
    return c.redirect("/account/searches?m=changed", 303);
  });
});

// -- stopping a delivery from its message ------------------------------------------------------

// Each message carries a stop link, /account/stop?s=<search id>&t=<secret>,
// in its footer and in its List-Unsubscribe header (deliveries.ts). The
// secret is the credential, so no session is asked for; the GET only shows
// the page (a mail scanner that opens the link changes nothing), and a POST
// turns the delivery off. A mail client's one-click POST (RFC 8058, the body
// List-Unsubscribe=One-Click) comes from the mail provider's servers with no
// page and no Origin of the site, so neither is asked for: a post from
// anywhere that holds the secret may turn that one delivery off, and no
// more. A link that matches nothing is the site's 404.
const STOP_VALUE_RE = /^[0-9a-f]{32}$/;

type StopRow = { id: string; user_id: string; kind: string; params: string; label: string; lang: string; deliver: string; secret: string };

async function stopTarget(c: Context<AppEnv>, searchId: string, secret: string): Promise<StopRow | null> {
  if (!STOP_VALUE_RE.test(searchId) || !STOP_VALUE_RE.test(secret)) return null;
  const row = await c.env.ACCOUNTS!.prepare(
    "SELECT s.id, s.user_id, s.kind, s.params, s.label, s.lang, s.deliver, k.secret FROM delivery_tokens k " +
    "JOIN saved_searches s ON s.id = k.search_id JOIN users u ON u.id = s.user_id WHERE k.search_id = ? AND u.status = 'active'",
  ).bind(searchId).first<StopRow>();
  return row && sameHash(row.secret, secret) ? row : null;
}

account.get("/stop", async (c) => {
  const lang = c.get("lang");
  const searchId = c.req.query("s") ?? "";
  const secret = c.req.query("t") ?? "";
  return guarded(c, async () => {
    const row = await stopTarget(c, searchId, secret);
    if (!row) return c.notFound();
    return accountPage(c, t(lang, "account.stop_title"),
      stopView(lang, { searchId, secret, label: await labelIn(c, lang, row), off: row.deliver === "off" }));
  });
});

account.post("/stop", async (c) => {
  const form = await readForm(c);
  if (!form.ok) return c.text(t(c.get("lang"), "form.rejected"), form.status);
  const fields = form.fields;
  if (fields.lang === "en" || fields.lang === "fr") c.set("lang", fields.lang);
  const lang = c.get("lang");
  const searchId = clean(fields, "s", 64) || (c.req.query("s") ?? "");
  const secret = clean(fields, "t", 64) || (c.req.query("t") ?? "");
  const oneClick = fields["List-Unsubscribe"] === "One-Click";
  return guarded(c, async () => {
    const row = await stopTarget(c, searchId, secret);
    if (!row) return c.notFound();
    if (row.deliver !== "off") {
      await c.env.ACCOUNTS!.prepare("UPDATE saved_searches SET deliver = 'off' WHERE id = ?").bind(row.id).run();
      await audit(c.env, row.user_id, "delivery_stopped", oneClick ? "one_click" : "link");
    }
    if (oneClick) return c.text(t(lang, "account.stopped_one_click"), 200);
    return accountPage(c, t(lang, "account.stopped_title"), stoppedView(lang, await labelIn(c, lang, row)));
  });
});

// -- API keys ----------------------------------------------------------------------------------------

async function keysPage(c: Context<AppEnv>, who: Account, extra: { created?: string; errors?: Key[]; status?: number } = {}) {
  const lang = c.get("lang");
  const keys = await listKeys(c.env, who.userId);
  const notice = c.req.query("m") === "revoked" && !extra.created ? t(lang, "account.msg_key_revoked") : null;
  return accountPage(c, t(lang, "account.keys_title"),
    keysView(lang, who, { keys, created: extra.created, notice, errors: extra.errors }), extra.status ?? 200);
}

account.get("/keys", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => keysPage(c, who));
});

// The new key is in this response's body and nowhere else: no redirect, no
// cache, never in an address.
account.post("/keys", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  return guarded(c, async () => {
    if (!allowed(who, "api")) {
      await audit(c.env, who.userId, "key_refused", "plan");
      return keysPage(c, who, { status: 403 });
    }
    const name = clean(fields, "name", KEY_NAME_MAX);
    if (!name) return keysPage(c, who, { errors: ["account.err_key_name"], status: 400 });
    const made = await createKey(c.env, who.userId, name);
    if (made === "limit") return keysPage(c, who, { status: 409 });
    await audit(c.env, who.userId, "key_created", made.prefix);
    return keysPage(c, who, { created: made.key });
  });
});

account.post("/keys/:id/revoke", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who } = post;
  return guarded(c, async () => {
    if (await revokeKey(c.env, who.userId, c.req.param("id") ?? "")) await audit(c.env, who.userId, "key_revoked");
    return c.redirect("/account/keys?m=revoked", 303);
  });
});

// -- deletion ----------------------------------------------------------------------------------------

account.get("/delete", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  const lang = c.get("lang");
  return accountPage(c, t(lang, "account.delete_title"), deleteView(lang, who));
});

// The user row stays, marked deleted, its email replaced by "deleted:" and
// SHA-256 of a random salt and the address, the salt thrown away: the row
// cannot be matched to the address, and the address can sign up afresh.
// Sessions are revoked; saved searches (with their stop links and delivery
// rows), keys and sign-in requests are deleted; so are the address's rows in
// the alerts form's table. The entitlement rows stay, tied to the id alone,
// as the record of what was granted.
export async function deleteAccount(c: Context<AppEnv>, who: Account, now = new Date()): Promise<void> {
  const db = c.env.ACCOUNTS!;
  const at = now.toISOString();
  const tomb = `deleted:${await sha256Hex(`${randomHex(32)}\n${who.email}`)}`;
  await db.batch([
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(at, who.userId),
    db.prepare("DELETE FROM delivery_tokens WHERE search_id IN (SELECT id FROM saved_searches WHERE user_id = ?)").bind(who.userId),
    db.prepare("DELETE FROM deliveries WHERE saved_search_id IN (SELECT id FROM saved_searches WHERE user_id = ?)").bind(who.userId),
    db.prepare("DELETE FROM saved_searches WHERE user_id = ?").bind(who.userId),
    db.prepare("DELETE FROM api_keys WHERE user_id = ?").bind(who.userId),
    db.prepare("DELETE FROM magic_codes WHERE user_id = ? OR email = ?").bind(who.userId, who.email),
    db.prepare("DELETE FROM code_misses WHERE email = ?").bind(who.email),
    db.prepare(
      "UPDATE users SET email = ?, status = 'deleted', deleted_at = ?, last_seen_at = NULL, plan = 'free', plan_until = NULL WHERE id = ?",
    ).bind(tomb, at, who.userId),
  ]);
  try {
    await c.env.DB.prepare("DELETE FROM interest WHERE email = ?").bind(who.email).run();
  } catch {
    console.error("account deletion: alert requests not removed");
  }
  await audit(c.env, who.userId, "deleted", null, now);
}

account.post("/delete", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  const { account: who, fields } = post;
  const lang = c.get("lang");
  if (fields.confirm !== "yes") return accountPage(c, t(lang, "account.delete_title"), deleteView(lang, who, ["account.err_confirm"]), 400);
  return guarded(c, async () => {
    // A deleted account must not be charged again: its subscription is cancelled first, or nothing is deleted.
    if (!(await endForDeletion(c.env, who.userId))) {
      return accountPage(c, t(lang, "account.delete_title"), deleteView(lang, who, ["billing.err_delete"]), 503);
    }
    await deleteAccount(c, who);
    await revokeAllSessions(c.env, who.userId);
    clearSessionCookie(c);
    markSignedOut(c);
    return accountPage(c, t(lang, "account.deleted_title"), deletedView(lang));
  });
});

// -- billing (billing.tsx) ------------------------------------------------------------------

account.get("/billing", async (c) => {
  const who = await signedIn(c);
  if (who instanceof Response) return who;
  return guarded(c, () => billingPage(c, who));
});

account.post("/billing/checkout", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  return guarded(c, () => startCheckout(c, post.account, post.fields, siteBase(c)));
});

account.post("/billing/portal", async (c) => {
  const post = await signedInPost(c);
  if (post instanceof Response) return post;
  return guarded(c, () => openPortal(c, post.account, siteBase(c)));
});

// Stripe posts here: no session, no Origin, no form; the signature decides.
account.post("/billing/webhook", (c) => billingWebhook(c));
