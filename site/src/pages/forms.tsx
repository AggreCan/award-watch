import type { Context } from "hono";
import { html } from "hono/html";
import { isOwnAddress } from "../api";
import { ORG_ID_RE, loadProfile, loadStats } from "../data";
import { readForm } from "../body";
import type { AppEnv } from "../env";
import { t, tj, type Key } from "../i18n";
import { Layout, PageHead, Panel, page } from "../layout";
import { canonicalUrl, pageSeo, respondFormSeo } from "../seo";
import { retiredIdRedirect } from "./organization";

// The two forms write the only tables the site's database holds
// (organization_responses, corrections in pipeline/schema.sql). A row is
// stored unpublished; the operator publishes it after review. The contact
// field is optional and never shown.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TEXT_MAX = 5000;
const CONTACT_MAX = 200;
const PAGE_MAX = 300;

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
          {t(lang, "form.contact")}
          <input name="contact" type="email" maxlength={CONTACT_MAX} value={values.contact ?? ""} />
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
  if (contact && !EMAIL_RE.test(contact)) errors.push("form.err_contact");
  const profile = await loadProfile(c.env, id);
  // 308, not 301: a browser repeats a 308 as a POST with the same body, so a
  // statement typed on a form for a retired id is not lost.
  if (!profile) return (await retiredIdRedirect(c, id, "/respond", 308)) ?? c.notFound();
  if (errors.length) return respondForm(c, errors, { text, contact });
  try {
    await c.env.DB.prepare(
      "INSERT INTO organization_responses (organization_id, text, contact, submitted_at, published) VALUES (?, ?, ?, ?, 0)",
    ).bind(id, text, contact || null, new Date().toISOString()).run();
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
  const organization = (c.req.query("organization") ?? values.organization ?? "").slice(0, 20);
  return page(
    c,
    <Layout lang={lang} title={t(lang, "form.correct_title")} dataAsOf={await dataAsOf(c)} seo={pageSeo("corrections", lang)}>
      <PageHead lang={lang} title={t(lang, "form.correct_title")} lead={t(lang, "form.correct_intro")} />
      <Panel title={t(lang, "footer.corrections")} class="panel-form">
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
