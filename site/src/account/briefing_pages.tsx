// The weekly briefings' pages (docs/accounts.md, Weekly briefings): the
// Subscribe control on a segment page and a buyer page, the briefings panel
// of the searches page, the stop page of a message, the console's figures,
// and the public sample at /pro/briefing-sample.
//
// The control reads the session the page's shell already read (readSession
// keeps one answer per request) and, for a signed-in reader, one statement on
// the accounts database. While the switch is off it renders nothing and the
// sample is the site's 404, so the public pages keep every byte. The sample
// reads no session at all: it is the same page for every reader, cached
// public for an hour, and it reads the records database once (one batch).

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { addDays } from "../../public/closing.js";
import { SEGMENT_CODES } from "../constants";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, segmentShort, t, tj, tn, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, publicPage, todayOf } from "../layout";
import { ProNote } from "../pro";
import {
  type Briefing, type BriefingKind, type BriefingOverview, type BriefingRun, type BriefingSubject, WEEK_DAYS, briefValue, briefingName,
  briefingPath, briefingState, readBriefing, sharedCap,
} from "./briefings";
import { AddToDashboard } from "./dashboard_add";
import { holdsDashboard } from "./dashboard_rule";
import { briefingParts } from "./digests";
import { allowed } from "./entitlements";
import { type Account, readSession } from "./session";
import { accountsEnabled } from "./switch";

const Csrf: FC<{ account: Account }> = ({ account }) => <input type="hidden" name="csrf" value={account.csrf} />;

const stamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

// A briefing's name in the page's language: a segment's rebuilt, a buyer's as the site wrote it.
export const briefingLabel = (lang: Lang, b: Pick<Briefing, "kind" | "subject" | "segment" | "label" | "lang">): string =>
  b.kind === "segment" ? briefingName(lang, b, "") : b.label;

// -- the control on a segment page and a buyer page -----------------------------------------------

export type BriefingControlState =
  | { at: "out"; next: string }
  | { at: "in"; account: Account; id: string | null; segment: string; n: number; cap: number; pro: boolean };

// What the control shows for this request: null while the switch is off, when
// the accounts database cannot say, or before the briefings table exists.
export async function briefingControl(c: Context<AppEnv>, kind: BriefingKind, subject: string): Promise<BriefingControlState | null> {
  if (!accountsEnabled(c.env)) return null;
  const read = await readSession(c).catch(() => ({ state: "unavailable" }) as const);
  if (read.state === "unavailable") return null;
  if (read.state !== "ok") return { at: "out", next: briefingPath({ kind, subject }) };
  try {
    const s = await briefingState(c.env, read.account.userId, kind, subject);
    if (!s) return null;
    return {
      at: "in", account: read.account, id: s.id, segment: s.segment, n: s.n, cap: sharedCap(read.account.plan),
      pro: allowed(read.account, "delivery"),
    };
  } catch {
    return null;
  }
}

// The panel beside "Email Lists": what the briefing holds, the sample, and the
// way to subscribe. Signed out: the sign-in page, which returns here (?next)
// and saves this briefing once the address has proved itself (?brief, the
// whole buyer on a buyer page; routes.tsx). The link is the same for every
// reader not signed in, so the page keeps its public cache.
// Free: the button saves the briefing with its email off, and the Pro chip
// says the weekly email is Pro's. Pro: saved with the email on, weekly. A
// buyer's button comes with a choice of the whole buyer or one segment.
export const BriefingPanel: FC<{ lang: Lang; state: BriefingControlState | null; kind: BriefingKind; subject: string }> = (
  { lang, state, kind, subject },
) => {
  if (!state) return null;
  let body: unknown;
  if (state.at === "out") {
    const signInHref = `/account/sign-in?next=${encodeURIComponent(state.next)}&brief=${encodeURIComponent(briefValue(kind, subject))}`;
    // The weekly email is Pro's: the line under the button says so and offers the plan (operator, 2026-11-07).
    body = (
      <>
        <div class="briefing-control">
          <a href={signInHref} class="btn">{t(lang, "briefing.subscribe")}</a>
          <span class="muted small">{t(lang, "briefing.control_out")}</span>
        </div>
        <ProNote lang={lang}>{t(lang, "interest.pro_line")} <a href="/account/sign-in?next=/account/billing">{t(lang, "expiring.pro_sign_in")}</a></ProNote>
      </>
    );
  } else if (state.id) {
    body = (
      <div class="briefing-control">
        <a href="/account/searches#briefings" class="btn watch-on">
          {t(lang, "briefing.subscribed")}{state.segment ? ` · ${state.segment} ${segmentShort(lang, state.segment)}` : ""}
        </a>
        <span class="muted small"><a href="/account/searches#briefings">{t(lang, "briefing.manage")}</a></span>
      </div>
    );
  } else if (state.n >= state.cap) {
    body = (
      <p class="muted small">
        {t(lang, "briefing.control_cap", { n: fmtInt(state.n, lang), cap: fmtInt(state.cap, lang) })}{" "}
        <a href="/account/searches">{t(lang, "briefing.manage")}</a>
      </p>
    );
  } else {
    body = (
      <>
        <form method="post" action="/account/briefings" class="briefing-control">
          <Csrf account={state.account} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="subject" value={subject} />
          <input type="hidden" name="lang" value={lang} />
          {kind === "buyer" ? (
            <select name="segment" aria-label={t(lang, "briefing.segment_label")}>
              <option value="">{t(lang, "briefing.segment_all")}</option>
              {SEGMENT_CODES.map((code) => <option value={code}>{`${code} ${segmentShort(lang, code)}`}</option>)}
            </select>
          ) : null}
          <button type="submit" class="btn">{t(lang, "briefing.subscribe")}</button>
          {state.pro ? <span class="muted small">{t(lang, "briefing.control_pro")}</span> : null}
        </form>
        {state.pro ? null : (
          <ProNote lang={lang}>{t(lang, "briefing.control_free")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></ProNote>
        )}
      </>
    );
  }
  return (
    <Panel title={t(lang, "briefing.panel")} class="briefing" tools={<a href="/pro/briefing-sample">{t(lang, "briefing.sample_link")}</a>}>
      <p>{t(lang, kind === "segment" ? "briefing.lead_segment" : "briefing.lead_buyer")}</p>
      {body as any}
    </Panel>
  );
};

// -- the searches page ------------------------------------------------------------------------------

const RunLine: FC<{ lang: Lang; run: BriefingRun | null; deliver: string }> = ({ lang, run, deliver }) => {
  if (!run) return deliver === "off" ? null : <p class="muted small">{t(lang, "briefing.last_none")}</p>;
  const time = stamp(run.sent_at);
  const line = run.status === "sent"
    ? tn(lang, "briefing.last_sent_one", "briefing.last_sent_many", run.items, { time, n: fmtInt(run.items, lang) })
    : run.status === "empty" ? t(lang, "briefing.last_empty", { time }) : t(lang, "briefing.last_failed", { time });
  return <p class="muted small">{line}</p>;
};

const DELIVER_KEY: Record<string, Key> = { weekly: "account.deliver_weekly", off: "account.deliver_off" };

// Each briefing with its delivery (weekly or off on Pro; off with the Pro
// chip on Free), its newest run and a remove button.
export const BriefingsPanel: FC<{ lang: Lang; account: Account; briefings: (Briefing & { last: BriefingRun | null })[] }> = (
  { lang, account, briefings },
) => {
  const pro = allowed(account, "delivery");
  const dash = holdsDashboard(account.plan);
  return (
    <Panel title={t(lang, "briefing.list_title")} id="briefings" count={fmtInt(briefings.length, lang)}
      tools={<a href="/pro/briefing-sample">{t(lang, "briefing.sample_link")}</a>}>
      <p class="muted small">{t(lang, "briefing.list_lead")}</p>
      {briefings.length ? (
        <div class="table-wrap">
          <table class="restack">
            <thead>
              <tr><th>{t(lang, "briefing.col")}</th><th>{t(lang, "account.col_delivery")}</th><th>{t(lang, "account.col_remove")}</th></tr>
            </thead>
            <tbody>
              {briefings.map((b) => (
                <tr>
                  {/* An Ultra account adds a briefing to its dashboard from its row (dashboard.tsx). */}
                  {dash ? (
                    <td data-label={t(lang, "briefing.col")}>
                      <a href={briefingPath(b)}>{briefingLabel(lang, b)}</a>
                      <AddToDashboard lang={lang} account={account} kind="briefing" panelRef={b.id} />
                    </td>
                  ) : <td data-label={t(lang, "briefing.col")}><a href={briefingPath(b)}>{briefingLabel(lang, b)}</a></td>}
                  <td data-label={t(lang, "account.col_delivery")}>
                    {pro ? (
                      <>
                        <form method="post" action={`/account/briefings/${b.id}`} class="account-inline">
                          <Csrf account={account} />
                          <select name="deliver" aria-label={t(lang, "account.col_delivery")}>
                            {(["weekly", "off"] as const).map((d) => <option value={d} selected={d === b.deliver}>{t(lang, DELIVER_KEY[d])}</option>)}
                          </select>
                          <button type="submit" class="btn">{t(lang, "account.deliver_save")}</button>
                        </form>
                        <RunLine lang={lang} run={b.last} deliver={b.deliver} />
                      </>
                    ) : (
                      <>
                        <ProNote lang={lang}>{t(lang, "account.deliver_gate")} <a href="/account/billing">{t(lang, "billing.link_plans")}</a></ProNote>
                        {b.last ? <RunLine lang={lang} run={b.last} deliver={b.deliver} /> : null}
                      </>
                    )}
                  </td>
                  <td data-label={t(lang, "account.col_remove")}>
                    <form method="post" action={`/account/briefings/${b.id}/delete`} class="account-inline">
                      <Csrf account={account} />
                      <button type="submit" class="btn-link">{t(lang, "account.delete")}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p class="muted">{t(lang, "briefing.none")}</p>}
    </Panel>
  );
};

// -- the stop link of a message ---------------------------------------------------------------------

export function briefingStopView(lang: Lang, state: { id: string; secret: string; label: string; off: boolean }) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "briefing.stop_title")} lead={t(lang, "briefing.stop_lead")} />
      <Panel title={t(lang, "briefing.panel")} class="panel-form">
        <p><strong>{state.label}</strong></p>
        {state.off ? (
          <p>{t(lang, "briefing.stop_already")}</p>
        ) : (
          <form method="post" action="/account/stop" class="stack">
            <input type="hidden" name="b" value={state.id} />
            <input type="hidden" name="t" value={state.secret} />
            <input type="hidden" name="lang" value={lang} />
            <button type="submit" class="btn btn-primary">{t(lang, "briefing.stop_button")}</button>
          </form>
        )}
      </Panel>
    </>
  );
}

export function briefingStoppedView(lang: Lang, label: string) {
  return (
    <>
      <PageHead lang={lang} title={t(lang, "briefing.stopped_title")} lead={t(lang, "briefing.stopped_lead")}
        actions={<a href="/account/searches#briefings" class="btn">{t(lang, "account.searches_title")}</a>} />
      <Panel title={t(lang, "briefing.panel")}>
        <p><strong>{label}</strong></p>
      </Panel>
    </>
  );
}

// -- the console ------------------------------------------------------------------------------------

const KIND_KEY: Record<string, Key> = { segment: "briefing.kind_segment", buyer: "briefing.kind_buyer" };

// The overview's panel: briefings by kind and delivery, and the week's runs.
export const BriefingsOverviewPanel: FC<{ lang: Lang; ov: BriefingOverview | null }> = ({ lang, ov }) => {
  if (!ov) return null;
  const runs = (status: string) => fmtInt(ov.week.find((r) => r.status === status)?.n ?? 0, lang);
  const word = (keys: Record<string, Key>, v: string) => (keys[v] ? t(lang, keys[v]) : v);
  return (
    <Panel title={t(lang, "briefing.admin_panel")}>
      <dl class="wide">
        {ov.byKind.map((k) => (
          <>
            <dt>{t(lang, "briefing.admin_kind", { kind: word(KIND_KEY, k.kind), deliver: word(DELIVER_KEY, k.deliver) })}</dt>
            <dd>{fmtInt(k.n, lang)}</dd>
          </>
        ))}
        {ov.byKind.length ? null : <><dt>{t(lang, "briefing.admin_panel")}</dt><dd>{t(lang, "briefing.admin_none")}</dd></>}
        <dt>{t(lang, "briefing.admin_runs", { n: 7 })}</dt>
        <dd>{t(lang, "briefing.admin_runs_value", { sent: runs("sent"), empty: runs("empty"), failed: runs("failed") })}</dd>
      </dl>
    </Panel>
  );
};

const runWord = (lang: Lang, r: BriefingRun) =>
  r.status === "sent" ? t(lang, "admin.d_sent", { n: fmtInt(r.items, lang) }) : r.status === "empty" ? t(lang, "admin.d_empty") : t(lang, "admin.d_failed");

// The user page's panels: the account's briefings, then its newest runs.
export const BriefingsUserPanels: FC<{
  lang: Lang; detail: { briefings: (Briefing & { last: BriefingRun | null })[]; runs: (BriefingRun & { label: string })[] } | null;
}> = ({ lang, detail }) => {
  if (!detail) return null;
  return (
    <>
      <Panel title={t(lang, "briefing.admin_panel")} count={fmtInt(detail.briefings.length, lang)}>
        {detail.briefings.length ? (
          <div class="table-wrap">
            <table class="restack">
              <thead>
                <tr>
                  <th>{t(lang, "briefing.col")}</th><th>{t(lang, "admin.col_kind")}</th><th>{t(lang, "admin.col_delivery")}</th>
                  <th>{t(lang, "admin.col_created")}</th><th>{t(lang, "admin.col_last")}</th>
                </tr>
              </thead>
              <tbody>
                {detail.briefings.map((b) => (
                  <tr>
                    <td><a href={briefingPath(b)}>{b.label}</a></td>
                    <td><span class="mono">{b.segment ? `${b.kind} ${b.segment}` : b.kind}</span></td>
                    <td>{t(lang, DELIVER_KEY[b.deliver])}</td>
                    <td><span class="mono">{b.created_at.slice(0, 10)}</span></td>
                    <td>{b.last ? `${stamp(b.last.sent_at)}, ${runWord(lang, b.last)}` : t(lang, "admin.never")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p class="muted">{t(lang, "briefing.admin_none")}</p>}
      </Panel>
      <Panel title={t(lang, "briefing.admin_runs_title")} count={fmtInt(detail.runs.length, lang)}>
        {detail.runs.length ? (
          <div class="table-wrap">
            <table class="restack">
              <thead><tr><th>{t(lang, "admin.col_time")}</th><th>{t(lang, "briefing.col")}</th><th>{t(lang, "admin.col_state")}</th></tr></thead>
              <tbody>
                {detail.runs.map((r) => (
                  <tr><td><span class="mono">{stamp(r.sent_at)}</span></td><td>{r.label}</td><td>{runWord(lang, r)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p class="muted">{t(lang, "admin.deliveries_none")}</p>}
      </Panel>
    </>
  );
};

// -- the public sample (/pro/briefing-sample) -------------------------------------------------------

export const SAMPLE_PATH = "/pro/briefing-sample";
// The segment the sample is built for: 81, Engineering, the specification's example.
export const SAMPLE_SEGMENT = "81";

// This week's briefing for SAMPLE_SEGMENT, built by the same reader and the
// same message as a subscriber's, from the seven data dates ending with the
// site's data date. The same for every reader: no session is read and
// nothing about the reader is kept. A records database that cannot answer
// gives the page's shell with one line, never stored.
export async function briefingSamplePage(c: Context<AppEnv>): Promise<Response> {
  if (!accountsEnabled(c.env)) return c.notFound();
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  const subject: BriefingSubject = { kind: "segment", subject: SAMPLE_SEGMENT, segment: "" };
  const name = briefingName(lang, subject, "");
  const dataDate = stats?.data_as_of ? todayOf(stats.data_as_of) : null;
  const read = dataDate ? await readBriefing(c.env, subject, dataDate, addDays(dataDate, -WEEK_DAYS)) : null;
  const parts = read?.state === "ready"
    ? briefingParts({ lang, site: new URL(c.req.url).origin, briefing: subject, name, data: read.data })
    : null;
  const title = t(lang, "briefing.sample_title");
  return publicPage(
    c,
    <Layout lang={lang} title={title} dataAsOf={stats?.data_as_of ?? null}
      seo={{ path: SAMPLE_PATH, description: t(lang, "briefing.sample_description") }}>
      <PageHead lang={lang} title={title} lead={t(lang, "briefing.sample_lead", { name })}
        actions={<a href="/pro" class="btn">{t(lang, "billing.panel_pro")}</a>} />
      {parts ? (
        <Panel title={t(lang, "briefing.sample_message")}>
          <dl class="wide">
            <dt>{t(lang, "briefing.sample_subject")}</dt><dd>{parts.subject}</dd>
            <dt>{t(lang, "briefing.sample_preheader")}</dt><dd>{parts.preheader}</dd>
          </dl>
          {/* The message's own markup, as the mail carries it: every value in it was escaped where it was written (digests.ts). */}
          <div class="briefing-sample" dangerouslySetInnerHTML={{ __html: parts.body }}></div>
        </Panel>
      ) : (
        <Panel title={t(lang, "briefing.sample_message")}>
          <p>{t(lang, "briefing.sample_unavailable")}</p>
        </Panel>
      )}
    </Layout>,
    parts ? 200 : 503,
  );
}

// The Pro page's and the email lists page's line linking the sample.
export const SampleLine: FC<{ lang: Lang; text: Key; link: Key }> = ({ lang, text, link }) => (
  <>{tj(lang, text, { link: <a href={SAMPLE_PATH}>{t(lang, link)}</a> })}</>
);
