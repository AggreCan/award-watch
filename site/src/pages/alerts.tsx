// /alerts, the Email lists page: a chooser where a reader joins one list or
// several with one address, what the alerts will cover, and where the
// one-list form sits on the other pages. Laid out like the Methodology page.
// Nothing is sent yet; the chooser stores one row of the interest table per
// list chosen, built by interestFilter (pages/interest.tsx) exactly as the
// block on the list's own page would build it.
//
// The lists: every new tender notice; the new notices matching any mix of
// category, UNSPSC segment and province of delivery (one list, saved as the
// tenders page's address for that view); the contracts entering the 3-month
// window of contracts ending soon. No interest kind covers every new award
// notice, so none is offered here; a buyer's or a segment's list, which
// carries award notices, is saved from that page.
//
// The chooser posts to /interest with place=lists (index.tsx hands such a
// post to listsSubmit). Without a script the answer is this page with the
// chooser in its new state; with public/interest.js it is the chooser's block
// alone, which takes the place of the one on the page.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { PROVINCES, SEGMENTS, SEGMENT_CODES } from "../constants";
import { loadOpenFirst, loadStats } from "../data";
import type { AppEnv, Env } from "../env";
import { categoryLabel, fmtInt, provinceName, segmentLabel, t, tj, type Key, type Lang } from "../i18n";
import { Layout, PageHead, page } from "../layout";
import { pageSeo } from "../seo";
import {
  EMAIL_MAX, INSERT_INTEREST, type InterestFilter, type InterestPost, LIST_CATEGORIES, field, interestFilter, newToken, normalizeEmail,
} from "./interest";
import { tenderOptions } from "./tenders";

export const LISTS = ["tenders", "matching", "expiring"] as const;
export type ListName = (typeof LISTS)[number];

// What the chooser holds: the lists ticked and the filters of the matching
// list. national is the tenders page's "Include Canada-wide or not stated"
// box, on unless unticked.
export interface ListsChoice {
  lists: ListName[];
  category: string[];
  segment: string[];
  province: string[];
  national: boolean;
}

const NOTHING: ListsChoice = { lists: [], category: [], segment: [], province: [], national: true };

// The choice as posted: a list or a value the page does not offer is
// dropped, and each is kept once, in the page's order. The box posts
// national=0 from a hidden field and national=1 when ticked, as on the
// tenders page.
export function readListsChoice(values: Record<string, string[]>): ListsChoice {
  const asked = (key: string) => new Set((values[key] ?? []).map((v) => v.trim().toUpperCase()));
  const keep = (key: string, allowed: readonly string[]) => {
    const set = asked(key);
    return allowed.filter((v) => set.has(v));
  };
  const lists = new Set((values.list ?? []).map((v) => v.trim()));
  const national = values.national ?? [];
  return {
    lists: LISTS.filter((l) => lists.has(l)),
    category: keep("category", LIST_CATEGORIES),
    segment: keep("segment", SEGMENT_CODES),
    province: keep("province", PROVINCES),
    national: national.length === 0 || national.includes("1"),
  };
}

// The tenders page's address for the filters chosen; "/tenders" when none is.
export function matchingPath(choice: ListsChoice): string {
  const p = new URLSearchParams();
  for (const v of choice.category) p.append("category", v);
  for (const v of choice.segment) p.append("segment", v);
  for (const v of choice.province) p.append("province", v);
  if (choice.province.length && !choice.national) p.append("national", "0");
  const query = p.toString();
  return query ? `/tenders?${query}` : "/tenders";
}

const LIST_PATH: Record<ListName, (choice: ListsChoice) => [kind: string, path: string]> = {
  tenders: () => ["tenders", "/tenders"],
  matching: (choice) => ["tenders", matchingPath(choice)],
  // As the block on /expiring saves it.
  expiring: () => ["expiring", "/expiring"],
};

// The filters a post saves, one per list ticked, in the page's order. The
// matching list with no filter is every new tender notice, saved once.
export async function listFilters(env: Env, lang: Lang, choice: ListsChoice): Promise<InterestFilter[]> {
  const out: InterestFilter[] = [];
  for (const name of choice.lists) {
    const [kind, path] = LIST_PATH[name](choice);
    const filter = await interestFilter(env, lang, kind, path);
    if (filter && !out.some((f) => f.kind === filter.kind && f.params === filter.params)) out.push(filter);
  }
  return out;
}

// -- the chooser ---------------------------------------------------------------

type Choice = { value: string; label: string; n?: number };

// The two fixed lists' names, as their rows will carry them, and the
// segments and provinces the tenders page offers (every one, without
// counts, when the open notices cannot be read).
type ChooserData = { tenders: string; expiring: string; segments: Choice[]; provinces: Choice[] };

async function chooserData(env: Env, lang: Lang): Promise<ChooserData> {
  const [open, tenders, expiring] = await Promise.all([
    loadOpenFirst(env).catch(() => null),
    interestFilter(env, lang, "tenders", "/tenders"),
    interestFilter(env, lang, "expiring", "/expiring"),
  ]);
  const opts = open ? tenderOptions(open.facets, lang) : null;
  return {
    tenders: tenders?.label ?? t(lang, "interest.label_tenders_all"),
    expiring: expiring?.label ?? t(lang, "interest.label_expiring", { n: 3, scope: t(lang, "interest.scope_all") }),
    segments: (opts?.segment ?? SEGMENT_CODES.map((v) => ({ value: v, label: `${v} ${segmentLabel(lang, v)}` })))
      .filter((o) => o.value in SEGMENTS),
    provinces: (opts?.province ?? PROVINCES.map((v) => ({ value: v, label: provinceName(lang, v) })))
      .filter((o) => (PROVINCES as readonly string[]).includes(o.value)),
  };
}

export type ListsState = { choice?: ListsChoice; email?: string; errors?: Key[]; saved?: InterestFilter[] };

// The block: error lines, then the chooser, or the lists saved once it has
// gone through; the note on what the address is for stays under either.
// After an error the chooser comes back as it was sent.
export const ListsBody: FC<{ lang: Lang; data: ChooserData } & ListsState> = ({ lang, data, choice = NOTHING, email, errors = [], saved }) => {
  const ticked = (name: ListName) => choice.lists.includes(name);
  // A row per option: up to ten of the segments (about fifty in a full list), and every province, so none
  // of the thirteen hides below its box.
  const rows = (n: number, most: number) => Math.min(most, Math.max(4, n));
  const option = (o: Choice, chosen: readonly string[]) => (
    <option value={o.value} selected={chosen.includes(o.value)}>{o.n === undefined ? o.label : `${o.label} (${fmtInt(o.n, lang)})`}</option>
  );
  // interest.js puts the cursor on the first box when no list was ticked.
  const focusList = errors.includes("lists.err_none") ? "" : undefined;
  return (
    <div class="interest-body lists-body" data-interest="">
      {errors.map((e) => <p class="interest-error" role="alert">{t(lang, e)}</p>)}
      {saved ? (
        <div class="interest-done" role="status">
          <p>{t(lang, "lists.done", { email: email ?? "" })}</p>
          <ul class="lists-saved">{saved.map((f) => <li>{f.label}</li>)}</ul>
        </div>
      ) : (
        <form method="post" action="/interest" class="lists-form" data-interest-form="" data-lists="">
          <input type="hidden" name="place" value="lists" />
          <input type="hidden" name="lang" value={lang} />
          <fieldset class="lists">
            <legend class="visually-hidden">{t(lang, "lists.legend")}</legend>
            <div class="list">
              <label class="check list-check">
                <input type="checkbox" name="list" value="tenders" checked={ticked("tenders")} data-focus={focusList} />
                <span>{data.tenders}</span>
              </label>
            </div>
            <div class="list">
              <label class="check list-check">
                <input type="checkbox" name="list" value="matching" checked={ticked("matching")} />
                <span>{t(lang, "lists.matching")}</span>
              </label>
              <div class="list-filters" data-list-filters="">
                <fieldset class="list-categories">
                  <legend class="field-label">{t(lang, "tenders.filter_category")}</legend>
                  <div class="list-boxes">
                    {LIST_CATEGORIES.map((v) => (
                      <label class="check">
                        <input type="checkbox" name="category" value={v} checked={choice.category.includes(v)} />
                        <span>{categoryLabel(lang, v)}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label class="field list-segments">
                  <span class="field-label">{t(lang, "tenders.filter_segment")}</span>
                  <select name="segment" multiple size={rows(data.segments.length, 10)}>{data.segments.map((o) => option(o, choice.segment))}</select>
                </label>
                <div class="list-province">
                  <label class="field">
                    <span class="field-label">{t(lang, "tenders.filter_province")}</span>
                    <select name="province" multiple size={rows(data.provinces.length, PROVINCES.length)}>{data.provinces.map((o) => option(o, choice.province))}</select>
                  </label>
                  <label class="check">
                    <input type="hidden" name="national" value="0" />
                    <input type="checkbox" name="national" value="1" checked={choice.national} />
                    <span>{t(lang, "tenders.include_national")}</span>
                  </label>
                </div>
                <p class="list-hint">{t(lang, "lists.hint_none")} <span class="list-keys">{t(lang, "lists.hint_keys")}</span></p>
              </div>
            </div>
            <div class="list">
              <label class="check list-check">
                <input type="checkbox" name="list" value="expiring" checked={ticked("expiring")} />
                <span>{data.expiring}</span>
              </label>
            </div>
          </fieldset>
          <div class="hp"><label>{t(lang, "form.honeypot")}<input name="website" type="text" tabindex={-1} autocomplete="off" /></label></div>
          {/* The alerts form's line: the same field, button and pinning rule as every page's block. */}
          <div class="interest-form">
            <label class="field interest-field">
              <span class="field-label">{t(lang, "interest.email")}</span>
              <input name="email" type="email" required maxlength={EMAIL_MAX} autocomplete="email" spellcheck={false} value={email ?? ""} />
            </label>
            <button type="submit" class="btn btn-primary">{t(lang, "lists.submit")}</button>
          </div>
        </form>
      )}
      <p class="interest-note">{tj(lang, "interest.note", { privacy: <a href="/privacy#interest">{t(lang, "footer.privacy")}</a> })}</p>
    </div>
  );
};

// -- the page --------------------------------------------------------------------

async function alertsView(c: Context<AppEnv>, state: ListsState, status: 200 | 400 | 503): Promise<Response> {
  const lang = c.get("lang");
  const [stats, data] = await Promise.all([loadStats(c.env).catch(() => null), chooserData(c.env, lang)]);
  const link = (href: string, key: Key) => <a href={href}>{t(lang, key)}</a>;
  return page(
    c,
    <Layout lang={lang} title={t(lang, "alerts.title")} dataAsOf={stats?.data_as_of ?? null} active="/alerts" seo={pageSeo("alerts", lang)}>
      <PageHead lang={lang} title={t(lang, "alerts.title")} lead={t(lang, "alerts.lead")} />
      {/* A few short sections: no contents box. The chooser is the page's action, so it comes first. */}
      <div class="doc-layout doc-alone">
        <div class="doc">

          <h2 id="register">{t(lang, "lists.title")}</h2>
          <p>{t(lang, "alerts.register_intro")}</p>
          <ListsBody lang={lang} data={data} {...state} />

          <h2 id="cover">{t(lang, "alerts.toc_cover")}</h2>
          <p>{t(lang, "alerts.cover_intro")}</p>
          <ul>
            <li>{t(lang, "alerts.cover_tenders")}</li>
            <li>{t(lang, "alerts.cover_expiring")}</li>
            <li>{t(lang, "alerts.cover_organizations")}</li>
            <li>{t(lang, "alerts.cover_buyers")}</li>
          </ul>

          <h2 id="now">{t(lang, "alerts.toc_now")}</h2>
          <p>{t(lang, "alerts.now")}</p>
          <p>{tj(lang, "alerts.privacy", { privacy: link("/privacy#interest", "footer.privacy") })}</p>

          <h2 id="where">{t(lang, "alerts.toc_where")}</h2>
          <ul>
            <li>{tj(lang, "alerts.where_tenders", { link: link("/tenders", "rail.open") })}</li>
            <li>{tj(lang, "alerts.where_expiring", { link: link("/expiring", "alerts.link_expiring") })}</li>
            <li>{tj(lang, "alerts.where_profiles", { link: link("/organizations", "alerts.link_profiles") })}</li>
            <li>{tj(lang, "alerts.where_more", { buyers: link("/buyers", "alerts.link_buyers"), segments: link("/segments", "alerts.link_segments") })}</li>
          </ul>
        </div>
      </div>
      <script src="/interest.js" defer></script>
    </Layout>,
    status,
  );
}

export async function alertsPage(c: Context<AppEnv>): Promise<Response> {
  return alertsView(c, {}, 200);
}

// The answer to a chooser post: the block alone for interest.js, else the
// page around it. Never cached.
async function listsAnswer(c: Context<AppEnv>, post: InterestPost, state: ListsState, status: 200 | 400 | 503): Promise<Response> {
  if (post.fragment) {
    const data = await chooserData(c.env, c.get("lang"));
    c.header("Cache-Control", "no-store");
    c.header("X-Interest-Fragment", "1");
    return c.html(<ListsBody lang={c.get("lang")} data={data} {...state} />, status);
  }
  const res = await alertsView(c, state, status);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

// The chooser's post. A filled honeypot, no list ticked or an address that
// does not check out answers with the chooser as sent and a line for each
// fault, 400. Otherwise one row per list goes in as one batch, with the
// interest block's own de-duplication: a list the address is on already
// stores nothing and answers the same.
export async function listsSubmit(c: Context<AppEnv>, post: InterestPost): Promise<Response> {
  const lang = c.get("lang");
  const choice = readListsChoice(post.values);
  const typed = field(post.body, "email", EMAIL_MAX + 50);
  if (field(post.body, "website", 10)) {
    return listsAnswer(c, post, { choice, email: typed.slice(0, EMAIL_MAX), errors: ["interest.err_rejected"] }, 400);
  }
  const filters = await listFilters(c.env, lang, choice);
  const email = normalizeEmail(typed);
  const errors: Key[] = [];
  if (!filters.length) errors.push("lists.err_none");
  if (!email) errors.push("interest.err_email");
  if (errors.length || !email) return listsAnswer(c, post, { choice, email: typed.slice(0, EMAIL_MAX), errors }, 400);
  try {
    const insert = c.env.DB.prepare(INSERT_INTEREST);
    const now = new Date().toISOString();
    await c.env.DB.batch(filters.map((f) => insert.bind(email, f.kind, f.params, f.label, lang, now, newToken())));
  } catch (e) {
    console.error(`interest not stored: ${String(e).slice(0, 200)}`);
    return listsAnswer(c, post, { choice, email, errors: ["form.err_unavailable"] }, 503);
  }
  // The answer names the address and every list saved, so a mistyped address or a wrong box shows.
  return listsAnswer(c, post, { choice, email, saved: filters }, 200);
}
