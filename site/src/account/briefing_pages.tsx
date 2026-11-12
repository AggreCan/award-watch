// The weekly briefings' pages (docs/accounts.md, Weekly briefings): the
// Subscribe control on a segment page and a buyer page, the briefings panel
// of the searches page, the stop page of a message, the console's figures,
// and the public sample at /pro/briefing-sample with its message's frame.
//
// The control reads the session the page's shell already read (readSession
// keeps one answer per request) and, for a signed-in reader, one statement on
// the accounts database. While the switch is off it renders nothing and the
// sample is the site's 404, so the public pages keep every byte. The sample
// reads no session at all: the page and its message's frame are the same for
// every reader, cached public for an hour, and each reads the records
// database once (one batch).

import type { Context, Next } from "hono";
import type { FC } from "hono/jsx";
import { addDays } from "../../public/closing.js";
import { SEGMENT_CODES } from "../constants";
import { loadStats } from "../data";
import type { AppEnv } from "../env";
import { fmtInt, segmentShort, t, tj, tn, type Key, type Lang } from "../i18n";
import { Layout, PageHead, Panel, publicPage, todayOf } from "../layout";
import { ProNote } from "../pro";
import {
  type Briefing, type BriefingData, type BriefingKind, type BriefingOverview, type BriefingRun, type BriefingSubject, WEEK_DAYS, briefValue,
  briefingName, briefingPath, briefingState, readBriefing, sharedCap,
} from "./briefings";
import { AddToDashboard } from "./dashboard_add";
import { holdsDashboard } from "./dashboard_rule";
import { briefingDigest, briefingParts } from "./digests";
import { allowed } from "./entitlements";
import { FONT, type MailScheme, escapeHtml, siteLink } from "./mail_html";
import { mailSender } from "./sender";
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
//
// The page shows this week's briefing for SAMPLE_SEGMENT as an inbox shows
// it: who it is from, the subject and the preview line above a reading pane,
// and in the pane the whole message a subscriber is sent, in a frame of its
// own (the message route below), in a light inbox or a dark one. A frame
// follows the browser's scheme and not the site's theme switch, so each
// scheme is its own document with that scheme forced; the page offers the
// two as tabs and starts on the scheme the site is showing (the stylesheet
// picks the frame from the theme, as it picks every colour; with script,
// public/briefing-sample.js switches in place and sizes each frame to its
// message). The same for every reader: no session is read, nothing about the
// reader is kept, and each answer reads the records database once (one
// batch). A records database that cannot answer gives one line, 503, never
// stored, on the page and in the frame alike.

export const SAMPLE_PATH = "/pro/briefing-sample";
// The message's own document, by scheme: SAMPLE_MESSAGE_PATH/light, /dark.
export const SAMPLE_MESSAGE_PATH = `${SAMPLE_PATH}/message`;
// The segment the sample is built for: 81, Engineering, the specification's example.
export const SAMPLE_SEGMENT = "81";
// Where the sample's stop link leads: a subscriber's message carries
// /account/stop with the briefing's secret, which turns that briefing off;
// the sample has no briefing to stop, so the link opens the page that says
// what the email lists are, in the message's language.
export const SAMPLE_STOP_PATH = "/alerts";
const SCHEMES: readonly MailScheme[] = ["light", "dark"];
const SCHEME_KEY: Record<MailScheme, Key> = { light: "briefing.sample_light", dark: "briefing.sample_dark" };
const FRAME_KEY: Record<MailScheme, Key> = { light: "briefing.sample_frame_light", dark: "briefing.sample_frame_dark" };

// What the frame may do: show the site's own document, which the page reads
// to size it (allow-same-origin; the document runs no script, by this list
// and by its policy), and open its links in a new tab that is an ordinary
// page (allow-popups and allow-popups-to-escape-sandbox). No script, no form,
// no navigation of the page around it.
export const SAMPLE_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

// The message route's policy, in place of the site's: nothing but the
// message's own inline styles and the site's wordmarks, no script at all,
// framed by the site's own pages only.
export const SAMPLE_FRAME_CSP = [
  "default-src 'none'", "img-src 'self'", "style-src 'unsafe-inline'", "base-uri 'self'", "form-action 'none'", "frame-ancestors 'self'",
].join("; ");

// Registered before the site's own headers (index.tsx siteMiddleware), so it
// runs after them: an answer of the message route replaces the site's policy
// and frame option with its own and is kept out of search results. Every other
// answer, a 404 or a 429 at the same address included, keeps the site's.
export async function sampleFrameHeaders(c: Context<AppEnv>, next: Next): Promise<void> {
  await next();
  if (!c.get("mailFrame")) return;
  c.res.headers.set("Content-Security-Policy", SAMPLE_FRAME_CSP);
  c.res.headers.set("X-Frame-Options", "SAMEORIGIN");
  c.res.headers.set("X-Robots-Tag", "noindex");
}

type SampleRead = { lang: Lang; dataAsOf: string | null; site: string; subject: BriefingSubject; name: string; data: BriefingData | null };

// This week's briefing for SAMPLE_SEGMENT, read by the same reader as a
// subscriber's, from the seven data dates ending with the site's data date.
// site is the request's own origin, which is SITE_URL on the site itself.
async function sampleRead(c: Context<AppEnv>): Promise<SampleRead> {
  const lang = c.get("lang");
  const stats = await loadStats(c.env).catch(() => null);
  const subject: BriefingSubject = { kind: "segment", subject: SAMPLE_SEGMENT, segment: "" };
  const dataDate = stats?.data_as_of ? todayOf(stats.data_as_of) : null;
  const read = dataDate ? await readBriefing(c.env, subject, dataDate, addDays(dataDate, -WEEK_DAYS)) : null;
  return {
    lang, dataAsOf: stats?.data_as_of ?? null, site: new URL(c.req.url).origin, subject, name: briefingName(lang, subject, ""),
    data: read?.state === "ready" ? read.data : null,
  };
}

const schemeOf = (v: string | undefined): MailScheme | null => (v === "light" || v === "dark" ? v : null);

// The frame's address: the French message for a French page whatever the
// cookie says, as the mail's own links carry the language.
const frameSrc = (lang: Lang, scheme: MailScheme) => `${SAMPLE_MESSAGE_PATH}/${scheme}${lang === "fr" ? "?lang=fr" : ""}`;

export async function briefingSamplePage(c: Context<AppEnv>): Promise<Response> {
  if (!accountsEnabled(c.env)) return c.notFound();
  const s = await sampleRead(c);
  const { lang } = s;
  const parts = s.data ? briefingParts({ lang, site: s.site, briefing: s.subject, name: s.name, data: s.data }) : null;
  // ?scheme= names the inbox (the tabs' links); without it the site's theme does.
  const scheme = schemeOf(c.req.query("scheme"));
  const from = mailSender(c.env);
  const title = t(lang, "briefing.sample_title");
  return publicPage(
    c,
    <Layout lang={lang} title={title} dataAsOf={s.dataAsOf}
      seo={{ path: SAMPLE_PATH, description: t(lang, "briefing.sample_description") }}
      head={parts ? <script src="/briefing-sample.js" defer></script> : null}>
      <PageHead lang={lang} title={title} lead={t(lang, "briefing.sample_lead", { name: s.name })}
        actions={<a href="/pro" class="btn">{t(lang, "billing.panel_pro")}</a>} />
      {parts ? (
        <section class="panel inbox" data-scheme={scheme ?? "auto"} aria-labelledby="inbox-title">
          <div class="panel-head">
            <h2 id="inbox-title">{t(lang, "briefing.sample_message")}</h2>
            <div class="panel-tools">
              <nav class="tabs tabs-small" aria-label={t(lang, "briefing.sample_schemes")}>
                {SCHEMES.map((k) => (
                  <a href={`${SAMPLE_PATH}?scheme=${k}`} class={`inbox-tab-${k}`} data-scheme={k} aria-current={scheme === k ? "page" : undefined}>
                    {t(lang, SCHEME_KEY[k])}
                  </a>
                ))}
              </nav>
            </div>
          </div>
          {/* The inbox's line for the message: the sender, the subject, then the preview line. */}
          <dl class="inbox-head">
            <dt class="visually-hidden">{t(lang, "briefing.sample_from")}</dt>
            <dd class="inbox-from"><strong>{from.name}</strong>{from.address ? <>{" "}<span class="inbox-address">{`<${from.address}>`}</span></> : null}</dd>
            <dt class="visually-hidden">{t(lang, "briefing.sample_subject")}</dt>
            <dd class="inbox-subject">{parts.subject}</dd>
            <dt class="visually-hidden">{t(lang, "briefing.sample_preheader")}</dt>
            <dd class="inbox-preview">{parts.preheader}</dd>
          </dl>
          {SCHEMES.map((k) => (
            <iframe class={`inbox-frame inbox-${k}`} src={frameSrc(lang, k)} title={t(lang, FRAME_KEY[k])} sandbox={SAMPLE_SANDBOX}
              loading="lazy"></iframe>
          ))}
          <div class="panel-foot">
            <p>{tj(lang, "briefing.sample_note", {
              stop: t(lang, "briefing.stop_link"), lists: <a href={SAMPLE_STOP_PATH}>{t(lang, "alerts.title")}</a>,
            })}</p>
          </div>
        </section>
      ) : (
        <Panel title={t(lang, "briefing.sample_message")}>
          <p>{t(lang, "briefing.sample_unavailable")}</p>
        </Panel>
      )}
    </Layout>,
    parts ? 200 : 503,
  );
}

// The message itself, as a subscriber's message carries it (digests.ts
// briefingDigest, the shell of mail_html.ts), in the scheme the address
// names; the site's 404 for any other scheme and while the switch is off.
// Two things differ from a subscriber's message, both in the shell's view:
// the scheme is forced and the links open a new tab. One differs in the
// footer: the stop link is SAMPLE_STOP_PATH, carrying no briefing and no
// secret. Public and cached as the page is; a records database that cannot
// answer gives one line, 503, never stored.
export async function briefingSampleMessage(c: Context<AppEnv>): Promise<Response> {
  if (!accountsEnabled(c.env)) return c.notFound();
  const scheme = schemeOf(c.req.param("scheme"));
  if (!scheme) return c.notFound();
  const s = await sampleRead(c);
  c.set("mailFrame", true);
  if (!s.data) {
    c.header("Cache-Control", "no-store");
    return c.html(unavailableMessage(s.lang, scheme), 503);
  }
  const message = briefingDigest({
    lang: s.lang, to: "", site: s.site, stopUrl: siteLink(s.site, SAMPLE_STOP_PATH, s.lang), briefing: s.subject, name: s.name, data: s.data,
    view: { scheme },
  });
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(message.html);
}

// The frame's one line while the records database cannot answer, in the frame's scheme.
function unavailableMessage(lang: Lang, scheme: MailScheme): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="${scheme}">
<title>${escapeHtml(t(lang, "briefing.sample_title"))}</title>
</head>
<body style="margin:16px;font:14px/1.5 ${FONT};">
<p>${escapeHtml(t(lang, "briefing.sample_unavailable"))}</p>
</body>
</html>
`;
}

// The Pro page's and the email lists page's line linking the sample.
export const SampleLine: FC<{ lang: Lang; text: Key; link: Key }> = ({ lang, text, link }) => (
  <>{tj(lang, text, { link: <a href={SAMPLE_PATH}>{t(lang, link)}</a> })}</>
);
