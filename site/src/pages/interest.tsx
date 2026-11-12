// The "Get alerts by email" block: a request for an email list, kept in the
// forms database (the interest table of pipeline/schema.sql). Nothing is sent
// from here. Email delivery is part of Pro once accounts open, and an account
// made with the same address is offered the request as a saved search
// (src/account/searches.ts, importInterest), so the block's note says both.
//
// The block saves the filter of the page it sits on. A page hands it the kind
// and the path and query it answered; interestFilter keeps only the filter
// keys the kind allows, checks each value the way the page reads it, sorts the
// keys, leaves the language out, and writes the label from the same values
// and the names the data holds. The POST rebuilds both from the hidden fields
// the same way, so neither the saved filter nor its label is ever stored as
// received. Words typed into the title search stay in the saved filter; the
// label names the search without quoting it, so no text a visitor typed can
// reach a message the site sends later.
//
// Without a script the form posts and the answer is a page of its own with the
// block in its new state. public/interest.js posts it with fetch and the
// x-interest-fragment header instead, and the answer is the block alone,
// which takes the place of the one on the page.
//
// The Email lists page (pages/alerts.tsx) posts to the same address with
// several lists at once; its handler reads the post with readInterestPost
// and builds each list through interestFilter, so both forms save the same
// rows.
//
// The landing page's Ultra card (pages/landing.tsx, ultraSubmit) posts here
// too, with the kind ULTRA_KIND: a row of the same table holding the address,
// no filter and the plan's name as the label. It is not a saved search, so
// it stays out of INTEREST_KINDS: the account's import passes it over
// (account/searches.ts), the accounts-open message leaves it out and the
// Ultra message reads it alone (account/announce.tsx).

import type { Context } from "hono";
import { type FC, useContext } from "hono/jsx";
import { allowed } from "../account/entitlements";
import { accountsEnabled } from "../account/switch";
import { isOwnAddress } from "../api";
import { readForm } from "../body";
import { SEGMENTS } from "../constants";
import {
  type ExpiringWindow, type FacetCount, loadBuyers, loadExpiringIndex, loadOpenFirst, loadProfile, loadStats,
} from "../data";
import type { AppEnv, Env } from "../env";
import { categoryLabel, pick, provinceName, segmentLabel, sourceLabel, t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, RailContext, page } from "../layout";
import { clip } from "../seo";
import { BAND_LABEL, COMPETITIVE_LABEL, KIND_SOURCE, readExpiringQuery } from "./expiring";
import { orList } from "./shared";
import { CATEGORY_ORDER, readTenderQuery } from "./tenders";

// The kinds a page's block saves, each a filter an account can keep as a saved search.
export const INTEREST_KINDS = ["tenders", "expiring", "organization", "buyer", "segment"] as const;
export type InterestKind = (typeof INTEREST_KINDS)[number];

// The Ultra card's waiting list: its kind, and its params, which hold no filter.
export const ULTRA_KIND = "ultra";
export const ULTRA_PARAMS = "";

export interface InterestFilter {
  kind: InterestKind;
  // The page's path and the allowed filter keys, sorted, with no language.
  params: string;
  // What the filter means, in the page's language.
  label: string;
}

// The filter keys each list allows, in the order its chips name them.
export const TENDER_KEYS = ["q", "category", "segment", "province", "buyer", "type", "method"] as const;
export const EXPIRING_KEYS = ["buyer", "segment", "competitive", "value", "kind"] as const;

export const EMAIL_MAX = 254;
const PARAMS_MAX = 2000;
const LABEL_MAX = 1000;
const WINDOW_N: Record<ExpiringWindow, number> = { "3m": 3, "6m": 6, "12m": 12 };

// An address a mail system will take: an unquoted local part and a domain of
// letters, digits and hyphens with a real top-level label (punycode
// included). Checked after trimming and lower-casing.
const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return null;
  const local = email.slice(0, email.indexOf("@"));
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  return email;
}

// -- the saved filter and its label -------------------------------------------

const BASE = "https://interest.invalid";

// A path on the site with its query, or null for anything else (another host,
// a scheme, a path too long to be one of the site's).
function readPath(raw: string): URL | null {
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.length > PARAMS_MAX) return null;
  try {
    const url = new URL(raw, BASE);
    return url.origin === BASE ? url : null;
  } catch {
    return null;
  }
}

export function kindOfPath(path: string): InterestKind | null {
  if (path === "/tenders") return "tenders";
  if (path === "/expiring" || /^\/expiring\/(?:3m|6m|12m)$/.test(path)) return "expiring";
  if (/^\/organizations\/org-[0-9a-f]{10}$/.test(path)) return "organization";
  if (/^\/buyers\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path) && path.length <= 88) return "buyer";
  if (/^\/segments\/[0-9]{2}$/.test(path)) return "segment";
  return null;
}

// The path with the pairs kept, keys sorted.
function canonical(path: string, pairs: [string, string][]): string {
  const sorted = [...pairs].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(sorted).toString();
  return query ? `${path}?${query}` : path;
}

const pair = (lang: Lang, name: Key, value: string) => t(lang, "interest.pair", { name: t(lang, name), value });

type Names = { en?: string | null; fr?: string | null };

// A buyer's name from the buyers' index, else from the list that carries it;
// null when neither names it, and the buyer is left out of the filter.
async function buyerName(env: Env, lang: Lang, id: string, fallback?: Names): Promise<string | null> {
  const index = await loadBuyers(env).catch(() => null);
  const b = index?.buyers.find((x) => x.id === id);
  if (b) return pick(lang, b.name_en, b.name_fr) ?? b.name_en;
  return fallback ? pick(lang, fallback.en, fallback.fr) : null;
}

// The title search as kept: control characters out, runs of space as one.
function searchWords(q: string): string {
  return q.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

// The categories the Email lists page offers, in the tenders page's order
// (which names services related to goods last; the page leaves it out).
export const LIST_CATEGORIES = CATEGORY_ORDER.slice(0, 3);

async function tendersFilter(env: Env, lang: Lang, url: URL): Promise<InterestFilter> {
  const q = readTenderQuery(url);
  // The open notices' facets name a buyer, a notice type or a method; a list asking none of them reads no file.
  const facets = q.buyer || q.type || q.method ? (await loadOpenFirst(env).catch(() => null))?.facets : undefined;
  const facet = (list: readonly FacetCount[] | undefined, value: string) => list?.find((f) => f.value === value);
  const pairs: [string, string][] = [];
  const named: string[] = [];
  const words = searchWords(q.q);
  if (words) pairs.push(["q", words]);
  // Category, segment and province may each hold several values, as the
  // tenders page reads them (once each, in its fixed order), so the same
  // choice always saves the same filter; a notice matches any one of them.
  const { category: categories, segment: segments, province: provinces } = q;
  if (categories.length) {
    for (const v of categories) pairs.push(["category", v]);
    named.push(pair(lang, "tenders.filter_category", orList(lang, categories.map((v) => categoryLabel(lang, v)))));
  }
  if (segments.length) {
    for (const v of segments) pairs.push(["segment", v]);
    named.push(pair(lang, "tenders.filter_segment", orList(lang, segments.map((v) => `${v} ${segmentLabel(lang, v)}`))));
  }
  if (q.code) {
    pairs.push(["code", q.code]);
    named.push(pair(lang, "tenders.filter_code", q.code));
  }
  if (provinces.length) {
    for (const v of provinces) pairs.push(["province", v]);
    named.push(pair(lang, "tenders.filter_province", orList(lang, provinces.map((v) => provinceName(lang, v)))));
    // With the box unticked, the notices that name no province are out, and
    // the label says so: two lists never share a label with different filters.
    if (!q.national) {
      pairs.push(["national", "0"]);
      named.push(t(lang, "interest.national_out"));
    }
    if (!q.derived) {
      pairs.push(["derived", "0"]);
      named.push(t(lang, "interest.derived_out"));
    }
  }
  if (q.buyer) {
    const name = await buyerName(env, lang, q.buyer, facet(facets?.buyer, q.buyer));
    if (name) {
      pairs.push(["buyer", q.buyer]);
      named.push(pair(lang, "tenders.filter_buyer", name));
    }
  }
  // A notice type or method is kept only when the open notices carry it: the
  // values are free text in the source, and the names come from the facets.
  for (const [key, list, label] of [
    ["type", facets?.notice_type, "tenders.filter_type"], ["method", facets?.method, "tenders.filter_method"],
  ] as const) {
    const value = q[key];
    const f = value ? facet(list, value) : undefined;
    if (f) {
      pairs.push([key, f.value]);
      named.push(pair(lang, label, pick(lang, f.en, f.fr) ?? f.value));
    }
  }
  const filters = named.join("; ");
  const label = words
    ? (named.length ? t(lang, "interest.label_tenders_words_filters", { filters }) : t(lang, "interest.label_tenders_words"))
    : (named.length ? t(lang, "interest.label_tenders", { filters }) : t(lang, "interest.label_tenders_all"));
  return { kind: "tenders", params: canonical("/tenders", pairs), label };
}

// /expiring shows the 3-month list first, so its filter is that window's.
async function expiringFilter(env: Env, lang: Lang, url: URL): Promise<InterestFilter> {
  const window = (/^\/expiring\/(3m|6m|12m)$/.exec(url.pathname)?.[1] ?? "3m") as ExpiringWindow;
  const q = readExpiringQuery(url);
  const pairs: [string, string][] = [];
  const extras: string[] = [];
  let buyer: string | null = null;
  let segment: string | null = null;
  if (q.buyer) {
    const row = (await loadExpiringIndex(env).catch(() => null))?.by_buyer.find((b) => b.buyer_id === q.buyer);
    buyer = await buyerName(env, lang, q.buyer, row ? { en: row.buyer_en, fr: row.buyer_fr } : undefined);
    if (buyer) pairs.push(["buyer", q.buyer]);
  }
  if (q.segment && q.segment in SEGMENTS) {
    segment = `${q.segment} ${segmentLabel(lang, q.segment)}`;
    pairs.push(["segment", q.segment]);
  }
  // The province, and its derived provinces left out when the box was
  // unticked, as the tender list's filter saves them.
  if (q.province) {
    pairs.push(["province", q.province]);
    extras.push(pair(lang, "col.province", provinceName(lang, q.province)));
    if (!q.derived) {
      pairs.push(["derived", "0"]);
      extras.push(t(lang, "interest.derived_out"));
    }
  }
  if (q.competitive) {
    pairs.push(["competitive", q.competitive]);
    extras.push(pair(lang, "col.method", t(lang, COMPETITIVE_LABEL[q.competitive])));
  }
  if (q.value) {
    pairs.push(["value", q.value]);
    extras.push(pair(lang, "expiring.filter_value", t(lang, BAND_LABEL[q.value])));
  }
  if (q.kind) {
    pairs.push(["kind", q.kind]);
    extras.push(pair(lang, "col.source", sourceLabel(lang, KIND_SOURCE[q.kind])));
  }
  for (const [key, label] of [["fye", "expiring.chip_fye"], ["sosa", "expiring.chip_sosa"]] as const) {
    if (q[key]) continue;
    pairs.push([key, "0"]);
    extras.push(pair(lang, label, t(lang, "expiring.chip_left_out")));
  }
  const scope = buyer && segment
    ? t(lang, "interest.scope_both", { buyer, segment })
    : buyer ? t(lang, "interest.scope_buyer", { buyer })
    : segment ? t(lang, "interest.scope_segment", { segment })
    : t(lang, "interest.scope_all");
  const base = t(lang, "interest.label_expiring", { n: WINDOW_N[window], scope });
  return { kind: "expiring", params: canonical(`/expiring/${window}`, pairs), label: extras.length ? `${base} (${extras.join("; ")})` : base };
}

// The filter a page's block saves, or null when the path is not one the kind
// covers or names nothing the data holds. known.name is the organization's or
// the buyer's name when the page has it already, so the page reads no file twice.
export async function interestFilter(
  env: Env, lang: Lang, kind: string, raw: string, known: { name?: string } = {},
): Promise<InterestFilter | null> {
  const url = readPath(raw);
  if (!url) return null;
  const found = kindOfPath(url.pathname);
  if (!found || found !== kind) return null;
  let filter: InterestFilter | null = null;
  if (found === "tenders") filter = await tendersFilter(env, lang, url);
  else if (found === "expiring") filter = await expiringFilter(env, lang, url);
  else if (found === "organization") {
    const id = url.pathname.slice("/organizations/".length);
    const name = known.name ?? (await loadProfile(env, id).catch(() => null))?.organization.display_name;
    if (name) filter = { kind: found, params: `/organizations/${id}`, label: t(lang, "interest.label_organization", { organization: name }) };
  } else if (found === "buyer") {
    const id = url.pathname.slice("/buyers/".length);
    const name = known.name ?? (await buyerName(env, lang, id));
    if (name) filter = { kind: found, params: `/buyers/${id}`, label: t(lang, "interest.label_buyer", { buyer: name }) };
  } else {
    const code = url.pathname.slice("/segments/".length);
    if (code in SEGMENTS) {
      filter = { kind: found, params: `/segments/${code}`, label: t(lang, "interest.label_segment", { segment: `${code} ${segmentLabel(lang, code)}` }) };
    }
  }
  // A label past the cap (a long run of segments) is cut at a word, with an ellipsis.
  return filter ? { ...filter, label: clip(filter.label, LABEL_MAX) } : null;
}

// -- the block ----------------------------------------------------------------

// The block follows a page's list, so its button is the secondary one; the
// Email lists page, whose form is the page's action, has its own chooser.
export type InterestState = { done?: boolean; error?: Key; email?: string };

// On /tenders the list's script changes the address as the filters change;
// interest.js then saves the address shown and words the label from these.
const FOLLOW_KEYS = [...TENDER_KEYS].sort().join(" ");

// The part that changes: the label, the form or the line that says it was
// noted, an error line, and the note on what the address is for.
// The label as the end of a sentence ("for every new tender notice"): its
// first letter lowered, as every label starts with a common word.
function labelInSentence(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

export const InterestBody: FC<{ lang: Lang; filter: InterestFilter; on?: boolean } & InterestState> = ({ lang, filter, on, done, error, email }) => {
  const follow = filter.kind === "tenders";
  return (
    <div class="interest-body" data-interest="">
      <p class="interest-label">{filter.label}</p>
      {error ? <p class="interest-error" role="alert">{t(lang, error)}</p> : null}
      {done ? (
        <p class="interest-done" role="status">{t(lang, "interest.done", { email: email ?? "", label: labelInSentence(filter.label) })}</p>
      ) : (
        <form method="post" action="/interest" class="interest-form" data-interest-form=""
          data-follow={follow ? "" : undefined} data-keys={follow ? FOLLOW_KEYS : undefined}
          data-label-all={follow ? t(lang, "interest.label_tenders_all") : undefined}
          data-label-some={follow ? t(lang, "interest.follow_some") : undefined}>
          <input type="hidden" name="kind" value={filter.kind} />
          <input type="hidden" name="params" value={filter.params} />
          <input type="hidden" name="lang" value={lang} />
          <div class="hp"><label>{t(lang, "form.honeypot")}<input name="website" type="text" tabindex={-1} autocomplete="off" /></label></div>
          <label class="field interest-field">
            <span class="field-label">{t(lang, "interest.email")}</span>
            <input name="email" type="email" required maxlength={EMAIL_MAX} autocomplete="email" spellcheck={false} value={email ?? ""} />
          </label>
          <button type="submit" class="btn">{t(lang, "interest.submit")}</button>
        </form>
      )}
      <p class="interest-note">{tj(lang, "interest.note", { privacy: <a href="/privacy#interest">{t(lang, "footer.privacy")}</a> })}</p>
      {/* With the accounts switch on, the line that offers the plan (operator, 2026-11-07); its own class, so the
          switch guards strip it (test/accounts-switch.test.ts, test/radar-gate.test.ts) and the chip rule stays (none here). */}
      {on ? <p class="interest-pro">{t(lang, "interest.pro_line")} <a href="/account/sign-in?next=/account/billing">{t(lang, "expiring.pro_sign_in")}</a></p> : null}
      {/* A profile's head offers the watchlist too; the two differ in where the list is kept. */}
      {filter.kind === "organization" ? <p class="interest-note">{t(lang, "interest.watch_note")}</p> : null}
    </div>
  );
};

// The block as a page shows it: a panel under its head band, the link to the
// page that explains alerts, and the script that keeps the reader on the page.
export const InterestPanel: FC<{ lang: Lang; filter: InterestFilter | null } & InterestState> = ({ lang, filter, ...state }) => {
  // Offered with the switch on, to a reader whose plan lacks delivery (a Pro or Ultra reader has it already).
  const shell = useContext(RailContext);
  const plan = shell?.account?.plan ?? null;
  const on = (shell?.accountsOn ?? false) && !(plan && allowed({ plan }, "delivery"));
  return filter ? (
    <>
      <Panel title={t(lang, "interest.title")} class="interest" tools={<a href="/alerts">{t(lang, "interest.about")}</a>}>
        <InterestBody lang={lang} filter={filter} on={on} {...state} />
      </Panel>
      <script src="/interest.js" defer></script>
    </>
  ) : null;
};

// -- the post -----------------------------------------------------------------

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function field(body: Record<string, string>, key: string, max: number): string {
  const v = body[key];
  return (typeof v === "string" ? v : "").replace(CONTROL_RE, "").trim().slice(0, max);
}

// One row per address and filter; the same pair again stores nothing.
export const INSERT_INTEREST =
  "INSERT INTO interest (email, kind, params, label, lang, created_at, token) VALUES (?, ?, ?, ?, ?, ?, ?) " +
  "ON CONFLICT (email, kind, params) DO NOTHING";

// 32 hex characters from the platform's random source.
export function newToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// The block alone for interest.js, or a page holding it. Never cached.
async function answer(
  c: Context<AppEnv>, filter: InterestFilter, state: InterestState, status: 200 | 400 | 503, fragment: boolean,
): Promise<Response> {
  const lang = c.get("lang");
  if (fragment) {
    c.header("Cache-Control", "no-store");
    c.header("X-Interest-Fragment", "1");
    return c.html(<InterestBody lang={lang} filter={filter} on={accountsEnabled(c.env)} {...state} />, status);
  }
  const stats = await loadStats(c.env).catch(() => null);
  const res = await page(
    c,
    <Layout lang={lang} title={t(lang, "interest.title")} dataAsOf={stats?.data_as_of ?? null}>
      <PageHead lang={lang} title={t(lang, "interest.title")}
        actions={<a href={filter.params} class="btn">{t(lang, "interest.back")}</a>} />
      <InterestPanel lang={lang} filter={filter} {...state} />
    </Layout>,
    status,
  );
  res.headers.set("Cache-Control", "no-store");
  return res;
}

// A post to /interest as read: the first value of each field, every value of
// a field sent more than once, where the form sat ("lists" from the Email
// lists page's chooser, nothing from a page's block), and whether
// interest.js sent it and wants the block alone.
export type InterestPost = {
  body: Record<string, string>; values: Record<string, string[]>; place: string; fragment: boolean;
};

// POST /interest, read once for both forms (index.tsx hands it on by its
// place). A post from another site's page (its Origin names another host, or
// "null") is refused before the body is read; a client that sends no Origin
// is let through, as a browser on the site's own page always sends one. The
// form's language becomes the request's.
export async function readInterestPost(c: Context<AppEnv>): Promise<InterestPost | Response> {
  const origin = c.req.header("origin");
  if (origin !== undefined && !isOwnAddress(origin, c.req.url)) return c.text(t(c.get("lang"), "form.rejected"), 403);
  const form = await readForm(c);
  if (!form.ok) return c.text(t(c.get("lang"), "form.rejected"), form.status);
  const body = form.fields;
  const asked = field(body, "lang", 2);
  if (asked === "en" || asked === "fr") c.set("lang", asked);
  return { body, values: form.values, place: field(body, "place", 10), fragment: c.req.header("x-interest-fragment") === "1" };
}

// The post of a page's block: one filter. A filter that does not rebuild is
// refused as unreadable; a filled honeypot or an address that does not check
// out gets a line in the block. A second post of the same address and filter
// answers the same and stores nothing.
export async function interestSubmit(c: Context<AppEnv>, post: InterestPost): Promise<Response> {
  const { body, fragment } = post;
  const lang = c.get("lang");
  const filter = await interestFilter(c.env, lang, field(body, "kind", 20), field(body, "params", PARAMS_MAX));
  if (!filter) return c.text(t(lang, "form.rejected"), 400);
  const typed = field(body, "email", EMAIL_MAX + 50);
  if (field(body, "website", 10)) return answer(c, filter, { error: "interest.err_rejected", email: typed.slice(0, EMAIL_MAX) }, 400, fragment);
  const email = normalizeEmail(typed);
  if (!email) return answer(c, filter, { error: "interest.err_email", email: typed.slice(0, EMAIL_MAX) }, 400, fragment);
  try {
    await c.env.DB.prepare(INSERT_INTEREST).bind(email, filter.kind, filter.params, filter.label, lang, new Date().toISOString(), newToken()).run();
  } catch (e) {
    console.error(`interest not stored: ${String(e).slice(0, 200)}`);
    return answer(c, filter, { error: "form.err_unavailable", email }, 503, fragment);
  }
  // The line that says it was noted repeats the address and the filter, so a mistyped address shows.
  return answer(c, filter, { done: true, email }, 200, fragment);
}
