// The watches' pages: the Watch control on an organization, a buyer, a
// published contract and an open tender notice page; /account/watches, each
// watch with its last 14 days of events, what it follows and its email
// cadence, and the watches' calendar feed; and the watch mail's stop page.
// docs/accounts.md, Watches and Calendar feeds.
//
// The control reads the session the page's shell already read (readSession
// keeps one answer per request) and, for a signed-in reader, one statement on
// the accounts database. While the switch is off it renders nothing, so the
// pages keep every byte; a page that names a signed-in reader is private and
// never stored by a cache (layout.tsx page()).

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { SEGMENT_CODES } from "../constants";
import type { AppEnv } from "../env";
import { fmtInt, segmentShort, t, tn, type Key, type Lang } from "../i18n";
import { PageHead, Panel } from "../layout";
import { ProNote, ProTag } from "../pro";
import { EVENT_KEY, WATCH_KIND_KEY, watchEventLines, watchMoreText } from "./digests";
import { WATCH_MAX, allowed, watchCap } from "./entitlements";
import { FEEDS_MAX } from "./feeds";
import { type CalendarRow, FeedCell } from "./pages";
import { type Account, readSession } from "./session";
import { accountsEnabled } from "./switch";
import {
  type EventsRead, type WatchKind, KINDS_FOR, closedOn, foundKey, listed, watchPath,
} from "./watch_events";
import { watchLabel } from "./watch_mail";
import { type MailRow, type Watch, watchState } from "./watches";

// -- the control on the pages -------------------------------------------------------------

export type ControlState =
  | { at: "out"; next: string }
  | { at: "in"; account: Account; id: string | null; segment: string; n: number; cap: number; mail: boolean };

// What the control shows for this request: null while the switch is off, when
// the accounts database cannot say, or when it cannot be read.
export async function watchControl(c: Context<AppEnv>, kind: WatchKind, target: string): Promise<ControlState | null> {
  if (!accountsEnabled(c.env)) return null;
  const read = await readSession(c).catch(() => ({ state: "unavailable" }) as const);
  if (read.state === "unavailable") return null;
  if (read.state !== "ok") return { at: "out", next: watchPath(kind, target) };
  try {
    const s = await watchState(c.env, read.account.userId, kind, target);
    return {
      at: "in", account: read.account, id: s.id, segment: s.segment, n: s.n, cap: watchCap(read.account.plan),
      mail: allowed(read.account, "watch_mail"),
    };
  } catch {
    return null;
  }
}

// The Follow button and one line under the page's head. A reader not signed
// in gets the sign-in page, which returns here (?next); a followed page reads
// "Following" and leads to the watches page; a Free account at its cap sees
// the cap with the Pro chip. A buyer's button comes with a choice: the whole
// buyer, or one UNSPSC segment of it.
export const WatchControl: FC<{ lang: Lang; state: ControlState | null; kind: WatchKind; target: string }> = ({ lang, state, kind, target }) => {
  if (!state) return null;
  if (state.at === "out") {
    return (
      <div class="watch-control">
        <a href={`/account/sign-in?next=${encodeURIComponent(state.next)}`} class="btn">{t(lang, "watches.button")}</a>
        <span class="muted small">{t(lang, "watches.control_out")}</span>
      </div>
    );
  }
  const note = t(lang, state.mail ? "watches.control_pro" : "watches.control_free");
  if (state.id) {
    return (
      <div class="watch-control">
        <a href="/account/watches" class="btn watch-on">
          {t(lang, "watches.watching")}{state.segment ? ` · ${state.segment} ${segmentShort(lang, state.segment)}` : ""}
        </a>
        <span class="muted small">{note} <a href="/account/watches">{t(lang, "watches.manage")}</a></span>
      </div>
    );
  }
  if (state.n >= state.cap) {
    return state.mail ? (
      <p class="watch-control muted small">
        {t(lang, "watches.control_cap_pro", { cap: fmtInt(state.cap, lang) })} <a href="/account/watches">{t(lang, "watches.manage")}</a>
      </p>
    ) : (
      <ProNote lang={lang}>
        {t(lang, "watches.cap_free", { n: fmtInt(state.n, lang), cap: fmtInt(state.cap, lang), max: fmtInt(WATCH_MAX, lang) })}{" "}
        <a href="/account/billing">{t(lang, "billing.link_plans")}</a>
      </ProNote>
    );
  }
  return (
    <form method="post" action="/account/watches" class="watch-control">
      <input type="hidden" name="csrf" value={state.account.csrf} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="lang" value={lang} />
      {kind === "buyer" ? (
        <select name="segment" aria-label={t(lang, "watches.segment_label")}>
          <option value="">{t(lang, "watches.segment_all")}</option>
          {SEGMENT_CODES.map((code) => <option value={code}>{`${code} ${segmentShort(lang, code)}`}</option>)}
        </select>
      ) : null}
      <button type="submit" class="btn">{t(lang, "watches.button")}</button>
      <span class="muted small">{note}{kind === "buyer" ? ` ${t(lang, "watches.segment_note")}` : ""}</span>
    </form>
  );
};

// -- /account/watches -------------------------------------------------------------------------------

const Csrf: FC<{ account: Account }> = ({ account }) => <input type="hidden" name="csrf" value={account.csrf} />;

const stamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

const MailLine: FC<{ lang: Lang; mail: MailRow | null }> = ({ lang, mail }) => {
  if (!mail?.last_at || !mail.last_status) return <p class="muted small">{t(lang, "watches.last_none")}</p>;
  const time = stamp(mail.last_at);
  const n = mail.last_items ?? 0;
  const line = mail.last_status === "sent"
    ? tn(lang, "watches.last_sent_one", "watches.last_sent_many", n, { time, n: fmtInt(n, lang) })
    : mail.last_status === "empty" ? t(lang, "watches.last_empty", { time }) : t(lang, "watches.last_failed", { time });
  return <p class="muted small">{line}</p>;
};

// A watch's events over the days read, the kinds it follows only: the newest
// of each kind, then how many more, linking its page.
const Events: FC<{ lang: Lang; w: Watch; read: EventsRead | null; days: ReadonlySet<string> }> = ({ lang, w, read, days }) => {
  if (!read || read.state !== "ready") return <p class="muted small">{t(lang, "watches.events_unread")}</p>;
  const found = read.found.get(foundKey(w));
  const events = listed(found, w.events, w.kind, days);
  const closed = w.kind === "tender" && closedOn(found) !== null;
  if (!events.length) return <p class="muted small">{t(lang, closed ? "watches.closed_note" : "watches.events_none")}</p>;
  return (
    <>
      <ul class="watch-events">
        {events.flatMap((e) => [
          ...e.rows.map((r) => {
            const l = watchEventLines(lang, r);
            return <li><a href={r.path}>{l.title}</a><br /><span class="muted small">{l.line2} · {l.line3}</span></li>;
          }),
          ...(e.n > e.rows.length ? [<li class="muted small"><a href={watchPath(w.kind, w.target)}>{watchMoreText(lang, e.kind, e.n - e.rows.length)}</a></li>] : []),
        ])}
      </ul>
      {closed ? <p class="muted small">{t(lang, "watches.closed_note")}</p> : null}
    </>
  );
};

// The newest day any event of the watch was found on, among the days read.
function lastEvent(read: EventsRead | null, w: Watch): string | null {
  if (!read || read.state !== "ready") return null;
  const found = read.found.get(foundKey(w));
  let last: string | null = null;
  for (const [kind, byDay] of found?.counts ?? []) {
    if (!w.events.includes(kind)) continue;
    for (const day of byDay.keys()) if (!last || day > last) last = day;
  }
  return last;
}

// The watches' calendar feed (feeds.ts, kind "watchlist"): the feed's cell
// when it has one, and whether the account holds as many feeds as it can.
export type WatchCalendar = { feed: CalendarRow["feed"]; full: boolean };

// For a Free account the Pro chip and one line; for Pro the feed's cell
// (pages.tsx FeedCell, as the searches page shows its feeds) or the button
// that makes it, what it lists, and how to subscribe.
const CalendarPanel: FC<{ lang: Lang; account: Account; calendar: WatchCalendar }> = ({ lang, account, calendar }) => {
  if (!allowed(account, "delivery")) {
    return (
      <Panel title={t(lang, "calfeed.panel_watch")} id="calendar" tools={<ProTag lang={lang} />}>
        <ProNote lang={lang}>{t(lang, "calfeed.watch_gate")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></ProNote>
      </Panel>
    );
  }
  return (
    <Panel title={t(lang, "calfeed.panel_watch")} id="calendar"
      foot={<>
        <p>{t(lang, "calfeed.route_google")}</p>
        <p>{t(lang, "calfeed.route_outlook")}</p>
        <p>{t(lang, "calfeed.route_apple")}</p>
        <p>{t(lang, "calfeed.refresh")}</p>
      </>}>
      <p>{t(lang, "calfeed.watch_lead")}</p>
      <p class="muted small">{t(lang, "calfeed.watch_horizon")}</p>
      {calendar.feed ? <FeedCell lang={lang} account={account} feed={calendar.feed} /> : calendar.full ? (
        <p class="muted small">{t(lang, "calfeed.cap", { n: fmtInt(FEEDS_MAX, lang) })}</p>
      ) : (
        <form method="post" action="/account/calendar" class="account-inline">
          <Csrf account={account} />
          <input type="hidden" name="kind" value="watchlist" />
          <button type="submit" class="btn">{t(lang, "calfeed.make")}</button>
        </form>
      )}
      <p class="muted small">{t(lang, "calfeed.privacy")}</p>
      <script src="/calendar.js" defer></script>
    </Panel>
  );
};

export function watchesView(
  lang: Lang, account: Account,
  state: {
    watches: Watch[]; read: EventsRead | null; days: readonly string[]; mail: MailRow | null; notice?: string | null;
    moved?: number; merged?: number; calendar?: WatchCalendar | null;
  },
) {
  const { watches } = state;
  const canMail = allowed(account, "watch_mail");
  const cap = watchCap(account.plan);
  const days = new Set(state.days);
  const capLine = canMail
    ? <p>{t(lang, "watches.cap_pro", { cap: fmtInt(cap, lang) })}</p>
    : (
      <ProNote lang={lang}>
        {t(lang, "watches.cap_free", { n: fmtInt(watches.length, lang), cap: fmtInt(cap, lang), max: fmtInt(WATCH_MAX, lang) })}{" "}
        <a href="/account/billing">{t(lang, "billing.link_plans")}</a>
      </ProNote>
    );
  return (
    <>
      <PageHead lang={lang} title={t(lang, "watches.title")} lead={t(lang, "watches.lead")}
        actions={<a href="/account" class="btn">{t(lang, "account.title")}</a>} />
      {state.notice ? <p class="account-notice" role="status">{state.notice}</p> : null}
      {state.moved ? <p class="account-notice" role="status">{t(lang, "watches.moved_note", { n: fmtInt(state.moved, lang) })}</p> : null}
      {state.merged ? <p class="account-notice" role="status">{t(lang, "watches.merged_note", { n: fmtInt(state.merged, lang) })}</p> : null}
      <Panel title={t(lang, "watches.panel_mail")} class="panel-form">
        {canMail ? (
          <>
            <p>{t(lang, "watches.mail_text")}</p>
            <form method="post" action="/account/watches/mail" class="account-inline">
              <Csrf account={account} />
              <select name="mail" aria-label={t(lang, "watches.mail_label")}>
                <option value="on" selected={state.mail?.mail !== "off"}>{t(lang, "watches.mail_on")}</option>
                <option value="off" selected={state.mail?.mail === "off"}>{t(lang, "watches.mail_off")}</option>
              </select>
              <button type="submit" class="btn">{t(lang, "watches.save")}</button>
            </form>
            <MailLine lang={lang} mail={state.mail} />
          </>
        ) : (
          <ProNote lang={lang}>{t(lang, "watches.mail_gate")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></ProNote>
        )}
      </Panel>
      <Panel title={t(lang, "watches.panel")} count={t(lang, "watches.n", { n: fmtInt(watches.length, lang), cap: fmtInt(cap, lang) })}
        foot={capLine}>
        {watches.length ? (
          <div class="table-wrap">
            <table class="restack watch-table">
              <thead>
                <tr>
                  <th>{t(lang, "watches.col_watch")}</th><th>{t(lang, "watches.col_events")}</th>
                  <th>{t(lang, "watches.col_settings")}</th><th>{t(lang, "watches.col_remove")}</th>
                </tr>
              </thead>
              <tbody>
                {watches.map((w) => {
                  const last = lastEvent(state.read, w);
                  return (
                    <tr>
                      <td data-label={t(lang, "watches.col_watch")}>
                        <a href={watchPath(w.kind, w.target)}>{watchLabel(lang, w)}</a>
                        <br /><span class="muted small">{t(lang, WATCH_KIND_KEY[w.kind])}</span>
                        {last ? <><br /><span class="muted small mono">{t(lang, "watches.last_event", { date: last })}</span></> : null}
                      </td>
                      <td data-label={t(lang, "watches.col_events")}><Events lang={lang} w={w} read={state.read} days={days} /></td>
                      <td data-label={t(lang, "watches.col_settings")}>
                        <form method="post" action={`/account/watches/${w.id}`} class="watch-settings">
                          <Csrf account={account} />
                          {KINDS_FOR[w.kind].map((k) => (
                            <label class="account-check">
                              <input type="checkbox" name={`ev_${k}`} value="1" checked={w.events.includes(k)} />
                              <span>{t(lang, EVENT_KEY[k] as Key)}</span>
                            </label>
                          ))}
                          {canMail ? (
                            <label>
                              {t(lang, "watches.cadence_label")}
                              <select name="cadence">
                                <option value="daily" selected={w.cadence === "daily"}>{t(lang, "watches.cadence_daily")}</option>
                                <option value="weekly" selected={w.cadence === "weekly"}>{t(lang, "watches.cadence_weekly")}</option>
                              </select>
                            </label>
                          ) : <input type="hidden" name="cadence" value={w.cadence} />}
                          <button type="submit" class="btn">{t(lang, "watches.save")}</button>
                        </form>
                      </td>
                      <td data-label={t(lang, "watches.col_remove")}>
                        <form method="post" action={`/account/watches/${w.id}/delete`} class="account-inline">
                          <Csrf account={account} />
                          <button type="submit" class="btn-link">{t(lang, "watches.remove")}</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p class="muted">{t(lang, "watches.none")}</p>
        )}
        {watches.length ? <p class="muted small">{t(lang, "watches.add_note")}</p> : null}
      </Panel>
      {state.calendar ? <CalendarPanel lang={lang} account={account} calendar={state.calendar} /> : null}
    </>
  );
}

// -- the watch mail's stop link ---------------------------------------------------------------

export function watchStopView(lang: Lang, state: { userId: string; secret: string; off: boolean }) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "watches.stop_title")} lead={t(lang, "watches.stop_lead")} />
      <Panel title={t(lang, "watches.panel_mail")} class="panel-form">
        {state.off ? (
          <p>{t(lang, "watches.stop_already")}</p>
        ) : (
          <form method="post" action="/account/stop" class="stack">
            <input type="hidden" name="w" value={state.userId} />
            <input type="hidden" name="t" value={state.secret} />
            <input type="hidden" name="lang" value={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "watches.stop_button")}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

export function watchStoppedView(lang: Lang) {
  return (
    <PageHead lang={lang} title={t(lang, "watches.stopped_title")} lead={t(lang, "watches.stopped_lead")}
      actions={<a href="/account/watches" class="btn">{t(lang, "watches.title")}</a>} />
  );
}
