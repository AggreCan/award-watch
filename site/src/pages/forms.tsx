import type { Context } from "hono";
import { html } from "hono/html";
import { isOwnAddress } from "../api";
import { ORG_ID_RE, loadAlias, loadProfile, loadStats } from "../data";
import { readForm } from "../body";
import type { AppEnv, Env } from "../env";
import { t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, page } from "../layout";
import { scrubContacts } from "../scrub";
import { canonicalUrl, pageSeo, respondFormSeo, type Seo } from "../seo";
import { retiredIdRedirect } from "./organization";

// The two forms write the only tables the site's database holds
// (organization_responses, corrections in pipeline/schema.sql). A row is
// stored unpublished; the operator publishes it after review. The contact
// field is never shown. It is required on the response form, since a
// statement is published only once the site has confirmed it through that
// address, and optional on the corrections form.
//
// The corrections page also takes a wrong merge report (operator ruling of
// 2026-11-07): /corrections?merge=<id>, opened from the button on every
// profile, names the profile and asks which name does not belong on it. It
// is a row of the corrections table with kind "merge", the name in its own
// column and the note in text; it asks for no email address, and the name
// and the note are scrubbed of contact details before they are stored. It
// posts to /corrections like the plain form, so the same per-address cap
// applies (limits.ts, "form").

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TEXT_MAX = 5000;
const CONTACT_MAX = 200;
const PAGE_MAX = 300;
export const MERGE_NAME_MAX = 300;
export const MERGE_NOTE_MAX = 1000;
// The datalist under the name field offers the names the profile records.
const MERGE_NAMES_SHOWN = 10;

// Control characters other than tab and line breaks (a null byte included)
// carry no meaning in a statement and are dropped before anything is stored.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function field(body: Record<string, unknown>, key: string, max: number): string {
  const v = body[key];
  return (typeof v === "string" ? v : "").replace(CONTROL_RE, "").trim().slice(0, max);
}

// When the database cannot take the row the form is shown again with what
// was typed and a line asking to try again.
const UNAVAILABLE: Key[] = ["form.err_unavailable"];

async function dataAsOf(c: Context<AppEnv>): Promise<string | null> {
  const stats = await loadStats(c.env);
  return stats?.data_as_of ?? null;
}

// Validation messages are dictionary keys, rendered in the reader's language.
export async function respondForm(
  c: Context<AppEnv>, errors: Key[] = [], values: Record<string, string> = {}, status?: number,
): Promise<Response> {
  const lang = c.get("lang");
  const id = c.req.param("id") ?? "";
  const profile = await loadProfile(c.env, id);
  if (!profile) return (await retiredIdRedirect(c, id, "/respond")) ?? c.notFound();
  const name = profile.organization.display_name;
  return page(
    c,
    <Layout lang={lang} title={t(lang, "form.respond_title")} dataAsOf={await dataAsOf(c)} seo={respondFormSeo(profile, lang)}>
      <PageHead lang={lang} title={t(lang, "form.respond_title")}
        lead={tj(lang, "form.respond_intro", { organization: <a href={`/organizations/${id}`}>{name}</a> })}>
        <p class="page-note">{t(lang, "form.respond_review")}</p>
      </PageHead>
      <Panel title={t(lang, "form.statement")} class="panel-form">
      {errors.length ? <ul class="errors">{errors.map((e) => <li>{t(lang, e)}</li>)}</ul> : null}
      <form method="post" action={`/organizations/${id}/respond`} class="stack">
        <label>{t(lang, "form.statement")}<textarea name="text" rows={8} required maxlength={TEXT_MAX}>{values.text ?? ""}</textarea></label>
        <label>
          {t(lang, "form.contact_required")}
          <input name="contact" type="email" required maxlength={CONTACT_MAX} autocomplete="email" value={values.contact ?? ""} />
          <span class="muted small">{t(lang, "form.contact_note")}</span>
        </label>
        <div class="hp"><label>{t(lang, "form.honeypot")}<input name="website" type="text" tabindex={-1} autocomplete="off" /></label></div>
        <button type="submit" class="btn btn-primary">{t(lang, "form.submit_statement")}</button>
      </form>
      </Panel>
    </Layout>,
    status ?? (errors.length ? 400 : 200),
  );
}

// The form's GET answers a browser only. Every current browser sends
// Sec-Fetch-Mode with a navigation, whatever site the link sat on, and an
// older one still sends the profile's address as Referer when the form is
// opened from it. A plain HTTP client sends neither, and scrapers that ignore
// robots.txt fetch forms like these by the tens of thousands. The refusal
// reads no data file. Both headers can be forged, so this keeps off the
// casual scraper only; the per-address page limit stays the brake. The POST
// is not checked, since a refusal there would throw away what was typed. The
// corrections form is linked from outside the site and stays open to any client.
export async function respondPage(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const headers = c.req.raw.headers;
  if (ORG_ID_RE.test(id) && !headers.has("sec-fetch-mode") && !isOwnAddress(headers.get("referer"), c.req.url)) {
    const lang = c.get("lang");
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Sec-Fetch-Mode, Referer");
    return c.text(t(lang, "form.browser_only", { url: canonicalUrl(`/organizations/${id}`, lang) }), 403);
  }
  return respondForm(c);
}

export async function respondSubmit(c: Context<AppEnv>): Promise<Response> {
  const id = c.req.param("id") ?? "";
  const form = await readForm(c);
  if (!form.ok) return c.text(t(c.get("lang"), "form.rejected"), form.status);
  const body = form.fields;
  if (field(body, "website", 10)) return c.text(t(c.get("lang"), "form.rejected"), 400);
  const text = field(body, "text", TEXT_MAX);
  const contact = field(body, "contact", CONTACT_MAX);
  const errors: Key[] = [];
  if (text.length < 20) errors.push("form.err_statement");
  if (!contact) errors.push("form.err_contact_missing");
  else if (!EMAIL_RE.test(contact)) errors.push("form.err_contact");
  const profile = await loadProfile(c.env, id);
  // 308, not 301: a browser repeats a 308 as a POST with the same body, so a
  // statement typed on a form for a retired id is not lost.
  if (!profile) return (await retiredIdRedirect(c, id, "/respond", 308)) ?? c.notFound();
  if (errors.length) return respondForm(c, errors, { text, contact });
  try {
    await c.env.DB.prepare(
      "INSERT INTO organization_responses (organization_id, text, contact, submitted_at, published) VALUES (?, ?, ?, ?, 0)",
    ).bind(id, text, contact, new Date().toISOString()).run();
  } catch (e) {
    console.error(`response not stored: ${String(e).slice(0, 200)}`);
    return respondForm(c, UNAVAILABLE, { text, contact }, 503);
  }
  return thanks(c, "form.thanks_statement", `/organizations/${id}`);
}

export async function correctionsForm(
  c: Context<AppEnv>, errors: Key[] = [], values: Record<string, string> = {}, status?: number,
): Promise<Response> {
  const lang = c.get("lang");
  // ?merge= with an id that has a profile opens the merge report; any other
  // value falls through to the plain form, which stays open to every client.
  const merge = c.req.query("merge");
  if (merge !== undefined && !errors.length) {
    const shown = await mergeForm(c, merge.slice(0, 20));
    if (shown) return shown;
  }
  const organization = (c.req.query("organization") ?? values.organization ?? "").slice(0, 20);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "form.correct_title")} dataAsOf={await dataAsOf(c)} seo={pageSeo("corrections", lang)}>
      <PageHead lang={lang} title={t(lang, "form.correct_title")} lead={t(lang, "form.correct_intro")} />
      <Panel title={t(lang, "form.correct_panel")} class="panel-form">
      {errors.length ? <ul class="errors">{errors.map((e) => <li>{t(lang, e)}</li>)}</ul> : null}
      <form method="post" action="/corrections" class="stack">
        <label>
          {t(lang, "form.page")}
          <input name="page" type="text" required maxlength={PAGE_MAX} placeholder={t(lang, "form.page_placeholder")} value={values.page ?? ""} />
        </label>
        <input type="hidden" name="organization" value={organization} />
        <label>{t(lang, "form.what_wrong")}<textarea name="text" rows={6} required maxlength={TEXT_MAX}>{values.text ?? ""}</textarea></label>
        <label>
          {t(lang, "form.contact")}
          <input name="contact" type="email" maxlength={CONTACT_MAX} value={values.contact ?? ""} />
          <span class="muted small">{t(lang, "form.contact_note")}</span>
        </label>
        <div class="hp"><label>{t(lang, "form.honeypot")}<input name="website" type="text" tabindex={-1} autocomplete="off" /></label></div>
        <button type="submit" class="btn btn-primary">{t(lang, "form.send_correction")}</button>
      </form>
      </Panel>
    </Layout>,
    status ?? (errors.length ? 400 : 200),
  );
}

export async function correctionsSubmit(c: Context<AppEnv>): Promise<Response> {
  const form = await readForm(c);
  if (!form.ok) return c.text(t(c.get("lang"), "form.rejected"), form.status);
  const body = form.fields;
  if (field(body, "website", 10)) return c.text(t(c.get("lang"), "form.rejected"), 400);
  if (field(body, "kind", 20) === "merge") return mergeSubmit(c, body);
  const pageRef = field(body, "page", PAGE_MAX);
  const text = field(body, "text", TEXT_MAX);
  const contact = field(body, "contact", CONTACT_MAX);
  const organizationRaw = field(body, "organization", 20);
  const errors: Key[] = [];
  if (pageRef.length < 3) errors.push("form.err_page");
  if (text.length < 10) errors.push("form.err_request");
  if (contact && !EMAIL_RE.test(contact)) errors.push("form.err_contact");
  if (errors.length) return correctionsForm(c, errors, { page: pageRef, text, contact, organization: organizationRaw });
  // The organization is recorded only when it names a profile that exists,
  // from the hidden field or an id pasted into the page field.
  let organizationId: string | null = null;
  const candidate = organizationRaw || (/org-[0-9a-f]{10}/.exec(pageRef)?.[0] ?? "");
  if (candidate && ORG_ID_RE.test(candidate) && (await loadProfile(c.env, candidate))) organizationId = candidate;
  try {
    await c.env.DB.prepare(
      "INSERT INTO corrections (organization_id, page, text, contact, submitted_at, published) VALUES (?, ?, ?, ?, ?, 0)",
    ).bind(organizationId, pageRef, text, contact || null, new Date().toISOString()).run();
  } catch (e) {
    console.error(`correction not stored: ${String(e).slice(0, 200)}`);
    return correctionsForm(c, UNAVAILABLE, { page: pageRef, text, contact, organization: organizationRaw }, 503);
  }
  return thanks(c, "form.thanks_correction", organizationId ? `/organizations/${organizationId}` : "/");
}

// -- the wrong merge report ------------------------------------------------------------

// The profile a report names: the id as given when it has a profile, else
// the id a retired one now points to (a link from before a merge moved it).
async function mergeTarget(env: Env, id: string): Promise<{ id: string; name: string; names: string[] } | null> {
  if (!ORG_ID_RE.test(id)) return null;
  let profile = await loadProfile(env, id);
  if (!profile) {
    const live = await loadAlias(env, id);
    profile = live ? await loadProfile(env, live) : null;
  }
  if (!profile) return null;
  const o = profile.organization;
  const names = [...new Set([o.display_name, ...profile.names.map((n) => n.name)])].slice(0, MERGE_NAMES_SHOWN);
  return { id: o.id, name: o.display_name, names };
}

// Not indexed: robots.txt keeps crawlers off /corrections?merge= anyway, and
// the form is one profile's.
function mergeSeo(lang: Lang): Seo {
  const base = pageSeo("corrections", lang);
  return { path: base.path, description: base.description, noindex: true };
}

// The merge report's form, or null when the id names no profile. A retired
// id redirects to the form for the profile that took its records.
async function mergeForm(
  c: Context<AppEnv>, id: string, errors: Key[] = [], values: Record<string, string> = {}, status?: number,
): Promise<Response | null> {
  const lang = c.get("lang");
  const target = await mergeTarget(c.env, id);
  if (!target) return null;
  if (target.id !== id && !errors.length) {
    const asked = c.req.query("lang");
    c.header("Cache-Control", "public, max-age=300");
    return c.redirect(`/corrections?merge=${target.id}${asked === "en" || asked === "fr" ? `&lang=${asked}` : ""}`, 301);
  }
  return page(
    c,
    <Layout lang={lang} title={t(lang, "merge.title")} dataAsOf={await dataAsOf(c)} seo={mergeSeo(lang)}>
      <PageHead lang={lang} title={t(lang, "merge.title")}
        lead={tj(lang, "merge.intro", { organization: <a href={`/organizations/${target.id}`}>{target.name}</a> })}>
        <p class="page-note">{t(lang, "merge.no_email")}</p>
      </PageHead>
      <Panel title={t(lang, "merge.panel")} class="panel-form"
        foot={tj(lang, "merge.other", { form: <a href="/corrections">{t(lang, "merge.other_link")}</a> })}>
      {errors.length ? <ul class="errors">{errors.map((e) => <li>{t(lang, e)}</li>)}</ul> : null}
      <form method="post" action="/corrections" class="stack">
        <input type="hidden" name="kind" value="merge" />
        <label>
          {t(lang, "merge.profile")}
          <input name="merge" type="text" class="mono" readonly value={target.id} />
        </label>
        <label>
          {t(lang, "merge.name")}
          <input name="name" type="text" required maxlength={MERGE_NAME_MAX} list="merge-names" autocomplete="off" value={values.name ?? ""} />
          <span class="muted small">{t(lang, "merge.name_hint")}</span>
        </label>
        <datalist id="merge-names">{target.names.map((n) => <option value={n} />)}</datalist>
        <label>
          {t(lang, "merge.note")}
          <textarea name="note" rows={4} maxlength={MERGE_NOTE_MAX}>{values.note ?? ""}</textarea>
          <span class="muted small">{t(lang, "merge.note_hint")}</span>
        </label>
        <div class="hp"><label>{t(lang, "form.honeypot")}<input name="website" type="text" tabindex={-1} autocomplete="off" /></label></div>
        <button type="submit" class="btn btn-primary">{t(lang, "merge.send")}</button>
      </form>
      </Panel>
    </Layout>,
    status ?? (errors.length ? 400 : 200),
  );
}

// A database made before the kind and name columns (pipeline/schema.sql)
// answers one of these until the statements in docs/site-deploy.md have run.
const missingColumn = (e: unknown): boolean =>
  /no such column|has no column named/i.test(String((e as { message?: unknown })?.message ?? e));

// On a database without the two columns a report is still kept rather than
// refused (a deploy can land before the operator's ALTER TABLE): one plain
// correction row whose text starts with this marker, then the name.
export const MERGE_MARKER = "[merge]";

async function mergeSubmit(c: Context<AppEnv>, body: Record<string, unknown>): Promise<Response> {
  const lang = c.get("lang");
  // The name is one line whatever a client sends, and both texts lose any
  // contact detail before they are kept; the scrub's mark can lengthen a
  // text, so each is cut to its limit again after it.
  const name = scrubContacts(field(body, "name", MERGE_NAME_MAX).replace(/\s+/g, " "), lang).slice(0, MERGE_NAME_MAX);
  const note = scrubContacts(field(body, "note", MERGE_NOTE_MAX).replace(/\r\n?/g, "\n"), lang).slice(0, MERGE_NOTE_MAX);
  const target = await mergeTarget(c.env, field(body, "merge", 20));
  if (!target) return correctionsForm(c, ["merge.err_profile"], {}, 400);
  if (name.length < 2) return (await mergeForm(c, target.id, ["merge.err_name"], { name, note }, 400))!;
  const pagePath = `/organizations/${target.id}`;
  const at = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      "INSERT INTO corrections (organization_id, page, text, contact, submitted_at, published, kind, name) VALUES (?, ?, ?, NULL, ?, 0, 'merge', ?)",
    ).bind(target.id, pagePath, note, at, name).run();
  } catch (e) {
    let fault: unknown = e;
    if (missingColumn(e)) {
      try {
        await c.env.DB.prepare(
          "INSERT INTO corrections (organization_id, page, text, contact, submitted_at, published) VALUES (?, ?, ?, NULL, ?, 0)",
        ).bind(target.id, pagePath, `${MERGE_MARKER} ${name}${note ? `\n${note}` : ""}`, at).run();
        fault = null;
      } catch (e2) {
        fault = e2;
      }
    }
    if (fault) {
      console.error(`merge report not stored: ${String(fault).slice(0, 200)}`);
      return (await mergeForm(c, target.id, UNAVAILABLE, { name, note }, 503))!;
    }
  }
  return thanks(c, "merge.thanks", pagePath);
}

// -- the operator console's list ---------------------------------------------------------

export type CorrectionKind = "correction" | "merge";
export type CorrectionListRow = {
  id: number; kind: CorrectionKind; organization_id: string | null; page: string | null; name: string | null;
  text: string; submitted_at: string; published: number;
};

// The newest corrections and merge reports for the operator console
// (account/admin.tsx). The forms database is not the accounts database: a
// fault in it leaves the panel out (null) rather than failing the console,
// and a database without the kind and name columns lists every row as a
// correction (a report stored then carries MERGE_MARKER in its text).
export async function latestCorrections(env: Env, n: number): Promise<CorrectionListRow[] | null> {
  if (!env.DB) return null;
  const cols = "id, organization_id, page, text, submitted_at, published";
  const order = "ORDER BY submitted_at DESC, id DESC LIMIT ?";
  try {
    try {
      const res = await env.DB.prepare(`SELECT ${cols}, kind, name FROM corrections ${order}`).bind(n).all<CorrectionListRow>();
      return (res.results ?? []).map((r) => ({ ...r, kind: r.kind === "merge" ? "merge" : "correction" }));
    } catch (e) {
      if (!missingColumn(e)) throw e;
      const res = await env.DB.prepare(`SELECT ${cols} FROM corrections ${order}`).bind(n).all<Omit<CorrectionListRow, "kind" | "name">>();
      return (res.results ?? []).map((r) => ({ ...r, kind: "correction" as const, name: null }));
    }
  } catch (e) {
    console.error(`corrections list: ${String(e).slice(0, 120)}`);
    return null;
  }
}

// -- a profile's public corrections log ---------------------------------------------------

// The published rows a profile lists under "Corrections". A merge report is
// left out even when published: it names a business the reader says does
// not belong on the profile, which the operator reviews and the nightly's
// merge rules act on; the profile is not the place to print it. A database
// without the kind column (published_corrections_old) keeps a report as a
// correction whose text starts with MERGE_MARKER, so the marker leaves it out
// too, there and after the ALTER TABLE gives those rows the default kind.
export interface PublishedCorrection { submitted_at: string; page: string | null; text: string }
export const PUBLISHED_CORRECTIONS_SQL =
  "SELECT submitted_at, page, text FROM corrections WHERE organization_id = ? AND published = 1 AND kind <> 'merge' ORDER BY submitted_at DESC";
export const PUBLISHED_CORRECTIONS_OLD_SQL =
  "SELECT submitted_at, page, text FROM corrections WHERE organization_id = ? AND published = 1 ORDER BY submitted_at DESC";

export function publicCorrections(rows: readonly Record<string, unknown>[]): PublishedCorrection[] {
  return rows
    .filter((r) => typeof r.text === "string" && !r.text.startsWith(MERGE_MARKER) && typeof r.submitted_at === "string")
    .map((r) => ({ submitted_at: r.submitted_at as string, page: typeof r.page === "string" ? r.page : null, text: r.text as string }));
}

// Whether a statement failed for want of the kind column, so the caller reads again without it.
export const correctionsColumnMissing = missingColumn;

async function thanks(c: Context<AppEnv>, message: Key, back: string): Promise<Response> {
  const lang = c.get("lang");
  c.header("Cache-Control", "no-store");
  return c.html(
    html`<!doctype html>${(
      <Layout lang={lang} title={t(lang, "form.thanks")} dataAsOf={await dataAsOf(c)}>
        <PageHead lang={lang} title={t(lang, "form.thanks")} lead={t(lang, message)} actions={<a href={back} class="btn">{t(lang, "common.back")}</a>} />
      </Layout>
    ) as any}`,
  );
}
