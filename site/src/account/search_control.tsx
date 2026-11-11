// The Save this search control: on a tender list, a list of contracts ending
// (a window, or the overview's 3-month list) and a segment page, one press
// saves the page's filter to the signed-in account and returns to the page.
// An organization's and a buyer's addresses are saved searches too
// (pages/interest.tsx kindOfPath), but their pages keep Follow as their one
// control, since the two would ask a reader the same thing there; their saved
// search is made with Add a Search on the searches page. The post is the searches
// page's own Add a Search (routes.tsx POST /account/searches, the same
// validation, caps, duplicate rule and audit event), with next, the page to
// return to. docs/accounts.md, Saved searches.
//
// The control reads the session the page's shell already read (readSession
// keeps one answer per request) and one statement on the accounts database.
// It renders only for a signed-in reader, so its CSRF value only ever reaches
// a page the layout makes private (layout.tsx page()). While the switch is
// off, for a reader not signed in, and when the accounts database cannot be
// read, it renders nothing and the page keeps every byte.
//
// Two places: a line under the page's head (a segment, the contracts ending
// overview), and a row of a list's filter
// toolbar (the tender list, a window of contracts ending). The toolbar is
// itself the filters' form, so the row's button submits a form of its own
// placed after the toolbar (SaveSearchForm) by its form attribute. On the
// tender list the filters change in the browser: public/tenders.js keeps
// that form's address on the view shown, and shows the saved state only for
// the view the page was served with, the button (or the cap) for any other.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import type { AppEnv } from "../env";
import { fmtInt, t, type Lang } from "../i18n";
import type { InterestFilter } from "../pages/interest";
import { ProNote } from "../pro";
import { SAVED_SEARCH_MAX, allowed } from "./entitlements";
import { capFor, searchState } from "./searches";
import { type Account, readSession } from "./session";
import { accountsEnabled } from "./switch";

// The detached form's id on a toolbar page; tenders.js reads it by this id.
export const SAVE_FORM_ID = "save-search";

export type SaveState = {
  account: Account;
  // The address the post saves, as the page hands it to interestFilter, and
  // the request's own path and query, the page the post returns to.
  url: string; next: string;
  // The filter's label in the page's language, as the email list's block shows it.
  label: string;
  saved: boolean; n: number; cap: number; pro: boolean;
};

// What the control shows for this request: null while the switch is off, for
// a page whose filter does not rebuild, for a reader not signed in, and when
// the accounts database cannot say or cannot be read.
export async function saveControl(c: Context<AppEnv>, filter: InterestFilter | null, url: string): Promise<SaveState | null> {
  if (!accountsEnabled(c.env) || !filter) return null;
  const read = await readSession(c).catch(() => ({ state: "unavailable" }) as const);
  if (read.state !== "ok") return null;
  try {
    const s = await searchState(c.env, read.account.userId, filter);
    const here = new URL(c.req.url);
    return {
      account: read.account, url, next: `${here.pathname}${here.search}`, label: filter.label, saved: s.saved, n: s.n,
      cap: capFor(read.account), pro: allowed(read.account, "delivery"),
    };
  } catch {
    return null;
  }
}

const full = (s: SaveState) => s.n >= s.cap;

const Fields: FC<{ lang: Lang; state: SaveState }> = ({ lang, state }) => (
  <>
    <input type="hidden" name="csrf" value={state.account.csrf} />
    <input type="hidden" name="lang" value={lang} />
    <input type="hidden" name="url" value={state.url} />
    <input type="hidden" name="next" value={state.next} />
  </>
);

// The saved state, as a saved briefing reads: never a filled button, and
// with its line, both leading to the saved searches.
const Manage: FC<{ lang: Lang }> = ({ lang }) => <a href="/account/searches">{t(lang, "account.save_manage")}</a>;
const Saved: FC<{ lang: Lang }> = ({ lang }) => (
  <>
    <a href="/account/searches" class="btn watch-on" data-save="saved">{t(lang, "account.save_saved")}</a>
    <span class="muted small" data-save="saved"><Manage lang={lang} /></span>
  </>
);

// At the cap: a Free account gets the searches page's own gate note (pages.tsx
// CapNote, with the Pro chip, as the watches' cap does); Pro its own figure
// and the searches page, no plan named.
const Cap: FC<{ lang: Lang; state: SaveState }> = ({ lang, state }) => state.pro ? (
  <p class="muted small">
    {t(lang, "account.save_cap_pro", { cap: fmtInt(state.cap, lang) })} <Manage lang={lang} />
  </p>
) : (
  <ProNote lang={lang}>
    {t(lang, "account.cap_note", { n: fmtInt(state.n, lang), cap: fmtInt(state.cap, lang), max: fmtInt(SAVED_SEARCH_MAX, lang) })}{" "}
    <a href="/account/billing">{t(lang, "billing.link_plans")}</a>
  </ProNote>
);

// The line under a page's head: the button (a flat one: each of these pages
// keeps its filled button on its own first action) with the filter's label
// beside it, so the reader sees what a press keeps; the saved state; or the cap.
export const SaveSearchLine: FC<{ lang: Lang; state: SaveState | null }> = ({ lang, state }) => {
  if (!state) return null;
  if (state.saved) return <div class="save-search"><Saved lang={lang} /></div>;
  if (full(state)) return <div class="save-search"><Cap lang={lang} state={state} /></div>;
  return (
    <form method="post" action="/account/searches" class="save-search">
      <Fields lang={lang} state={state} />
      <button type="submit" class="btn">{t(lang, "account.save_button")}</button>
      <span class="muted small">{state.label}</span>
    </form>
  );
};

// The row at the foot of a list's filter toolbar, outside the phone's fold so
// it shows at every width. Saved, the button (or the cap) waits hidden beside
// the saved state, for tenders.js to show once the view is another; without
// the script the view never changes in the page, so neither is needed then.
export const SaveSearchRow: FC<{ lang: Lang; state: SaveState | null }> = ({ lang, state }) => {
  if (!state) return null;
  const other = full(state)
    ? <div data-save="new" hidden={state.saved}><Cap lang={lang} state={state} /></div>
    : <button type="submit" form={SAVE_FORM_ID} class="btn" data-save="new" hidden={state.saved}>{t(lang, "account.save_button")}</button>;
  return (
    <div class="toolbar-row save-search" data-save-search="">
      {state.saved ? <Saved lang={lang} /> : null}
      {other}
    </div>
  );
};

// The row's own form, after the toolbar's: the fields the post carries.
export const SaveSearchForm: FC<{ lang: Lang; state: SaveState | null }> = ({ lang, state }) =>
  state ? <form method="post" action="/account/searches" id={SAVE_FORM_ID} class="save-search-form"><Fields lang={lang} state={state} /></form> : null;
