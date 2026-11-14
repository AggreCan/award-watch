// Three readers of the records backbone (src/records_tables.ts) that sit on
// pages built from the static export:
//
// - EarlierAwards, on an open tender: the buyer's earlier records sharing a
//   UNSPSC class with the notice, ranked by the words their titles share with
//   its title, ten of them, for every reader.
// - Incumbents, on a buyer page and a segment page: who holds the contracts
//   ending within 12 months (the radar's window), by value. Once the accounts
//   switch is on, a reader without Pro's radar_depth sees the first three
//   and the word on what Pro adds.
// - orgFeed, /data/feeds/organizations/<id>.xml: the newest 50 records
//   naming an organization as Atom, cached an hour, in the feed bucket.
//
// Each reads one statement beside the state row; a records database that
// cannot answer leaves the panel out (the page stands) or answers the feed
// with 503.

import type { Context } from "hono";
import type { FC } from "hono/jsx";
import { railAccount } from "../account/session";
import { accountsEnabled } from "../account/switch";
import { Table } from "../columns";
import { SEGMENT_CODES } from "../constants";
import { ORG_ID_RE, loadProfile, loadStats, type TenderDetail } from "../data";
import type { AppEnv, Env } from "../env";
import { fmtInt, fmtMoney, pick, sourceLabel, t, tn, type Lang } from "../i18n";
import { Panel, addDays, todayOf } from "../layout";
import { allowsRadarDepth, requestPlan } from "../plan";
import { ProNote } from "../pro";
import { MAX_YEARS, dollars, fiscalYearOf, num, orgIdOf, orgNumber } from "../records_db";
import {
  EARLIER_CLASSES_MAX, EARLIER_SHOWN, INCUMBENTS_MAX, type Read, type Row, readEarlierAwards, readFollows, readIncumbents, readOrgFeed,
} from "../records_tables";
import { SITE_ORIGIN } from "../seo";
import { money } from "./shared";
import { recordHref, recordTitle, shownReference } from "./records";

const SOURCE_OF: Record<number, "awards" | "history" | "contracts" | "grants"> = { 1: "awards", 2: "history", 3: "contracts", 4: "grants" };
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const firstDay = (today: string): string => `${fiscalYearOf(today) - MAX_YEARS + 1}-04-01`;

// -- earlier awards on a tender ---------------------------------------------------------

// The six-digit UNSPSC classes of a notice's codes, within the 57 segments.
export function tenderClasses(codes: readonly { code: string }[]): number[] {
  const out = new Set<number>();
  for (const { code } of codes) {
    if (/^\d{6}/.test(code) && SEGMENT_CODES.includes(code.slice(0, 2))) out.add(Number(code.slice(0, 6)));
  }
  return [...out].sort((a, b) => a - b).slice(0, EARLIER_CLASSES_MAX);
}

const STOP = new Set([
  "the", "and", "for", "with", "from", "services", "service", "des", "les", "pour", "avec", "dans", "une", "aux", "sur", "par", "this", "that",
]);
// The words of a title that say what it is about: four letters or more, lower case, accents kept.
export function titleWords(text: string | null): Set<string> {
  return new Set((text ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOP.has(w)));
}

// The pool ranked by the words a record's title shares with the tender's
// (either language), then the classes it shares, then the newest.
export function nearestTitles(rows: Row[], en: string | null, fr: string | null): Row[] {
  const mine = new Set([...titleWords(en), ...titleWords(fr)]);
  const score = (r: Row) => {
    const theirs = new Set([...titleWords(str(r.title_en)), ...titleWords(str(r.title_fr))]);
    let n = 0;
    for (const w of theirs) if (mine.has(w)) n++;
    return n;
  };
  return rows
    .map((r) => ({ r, s: score(r), shared: num(r.shared) ?? 0, day: String(r.day ?? "") }))
    .sort((a, b) => b.s - a.s || b.shared - a.shared || (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .slice(0, EARLIER_SHOWN)
    .map((x) => x.r);
}

export type Earlier = { state: "ready"; rows: Row[] } | { state: "unavailable" } | null;

// What a read of rec_follows left (pages/follows.tsx reads it): null when
// none was asked for; noFollows when the database holds no rec_follows yet.
export type FollowsRead = (Read & { noFollows?: true }) | null;

// The earlier awards: null when the notice is not open or names no buyer or
// class; otherwise the rows or "unavailable". tref, the notice's reference in
// lower case, asks for the earlier contracts it may follow too (a signed-in
// reader while FOLLOWS_PANEL is "on"): in the same batch, or in a batch of
// their own when the notice reads no earlier awards. Without it the page
// reads exactly what it read before may follow.
export async function loadEarlierAwards(
  env: Env, d: TenderDetail, open: boolean, today: string, tref?: string,
): Promise<{ earlier: Earlier; follows: FollowsRead }> {
  const classes = tenderClasses(d.codes);
  if (!open) return { earlier: null, follows: null };
  if (!d.buyer_id || !classes.length) return { earlier: null, follows: tref === undefined ? null : await readFollows(env, tref) };
  const read = await readEarlierAwards(env, d.buyer_id, firstDay(today), classes, tref);
  const earlier: Earlier = read.state !== "ready" ? { state: "unavailable" }
    : { state: "ready", rows: nearestTitles(read.rows[0] ?? [], d.title_en, d.title_fr) };
  if (tref === undefined) return { earlier, follows: null };
  if (read.state !== "ready") return { earlier, follows: read };
  return { earlier, follows: read.noFollows ? read : { ...read, rows: [read.rows[1] ?? []] } };
}

export const EarlierAwards: FC<{ lang: Lang; earlier: Earlier }> = ({ lang, earlier }) => {
  if (!earlier) return null;
  return (
    <Panel title={t(lang, "earlier.heading")} count={earlier.state === "ready" ? fmtInt(earlier.rows.length, lang) : undefined}>
      {earlier.state !== "ready" ? (
        <p class="muted">{t(lang, "earlier.unavailable")}</p>
      ) : earlier.rows.length ? (
        <>
          <p class="muted small">{t(lang, "earlier.note", { n: EARLIER_SHOWN, years: MAX_YEARS })}</p>
          <div class="table-wrap bordered">
            <Table cols={[
              { kind: "date", label: t(lang, "col.awarded") },
              { kind: "main", label: t(lang, "col.contract") },
              { kind: "org", label: t(lang, "col.supplier") },
              { kind: "value", label: t(lang, "col.value") },
            ]}>
              <tbody>
                {earlier.rows.map((r) => {
                  const src = num(r.src) ?? 0;
                  const ref = String(r.ref ?? "");
                  const href = recordHref(src, ref);
                  const title = recordTitle(lang, r, ref);
                  const oid = num(r.oid);
                  const v = dollars(r.cents);
                  return (
                    <tr>
                      <td data-label={t(lang, "col.awarded")} class="mono">{str(r.day) ?? ""}</td>
                      <td data-label={t(lang, "col.contract")} class="lead-cell">
                        {/* A record with no page here (records.tsx recordHref) shows its reference instead. */}
                        {href ? <a href={href}>{title}</a> : title}
                        <br />{href ? null : <><span class="mono id muted">{shownReference(ref)}</span> </>}
                        <span class="muted small">{SOURCE_OF[src] ? sourceLabel(lang, SOURCE_OF[src]) : ""}</span>
                      </td>
                      <td data-label={t(lang, "col.supplier")}>
                        {oid === null ? <span class="muted">{t(lang, "common.not_stated")}</span>
                          : <a href={`/organizations/${orgIdOf(oid)}`}>{str(r.org_name) ?? orgIdOf(oid)}</a>}
                      </td>
                      <td data-label={t(lang, "col.value")} class="mono num">{v === null ? t(lang, "common.not_stated") : money(lang, v)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        </>
      ) : (
        <p class="muted">{t(lang, "earlier.none", { years: MAX_YEARS })}</p>
      )}
    </Panel>
  );
};

// -- the incumbents of a buyer or a segment ------------------------------------------------

// The rows a reader without Pro sees once the accounts switch is on.
export const INCUMBENTS_TEASE = 3;

export type Incumbents =
  | { state: "ready"; rows: Row[]; nOrgs: number; locked: boolean; signedIn: boolean; filter: string }
  | { state: "unavailable" };

// filter: the radar's query that lists one organization's rows of this buyer or segment.
export async function loadIncumbents(c: Context<AppEnv>, kind: "buyer" | "segment", key: string, today: string): Promise<Incumbents> {
  const read = await readIncumbents(c.env, kind, key, today, addDays(today, 365));
  if (read.state !== "ready") return { state: "unavailable" };
  const locked = accountsEnabled(c.env) && !allowsRadarDepth(await requestPlan(c));
  const signedIn = locked ? !!(await railAccount(c).catch(() => undefined))?.email : false;
  const rows = read.rows[0] ?? [];
  return {
    state: "ready", rows: locked ? rows.slice(0, INCUMBENTS_TEASE) : rows, nOrgs: num(rows[0]?.n_orgs) ?? 0, locked, signedIn,
    filter: kind === "buyer" ? `buyer=${key}` : `segment=${key}`,
  };
}

export const IncumbentsPanel: FC<{ lang: Lang; inc: Incumbents }> = ({ lang, inc }) => {
  if (inc.state !== "ready") {
    return <Panel id="incumbents" title={t(lang, "incumbents.heading")}><p class="muted">{t(lang, "incumbents.unavailable")}</p></Panel>;
  }
  return (
    <Panel id="incumbents" title={t(lang, "incumbents.heading")} count={fmtInt(inc.nOrgs, lang)}>
      {inc.rows.length === 0 ? (
        <p class="muted">{t(lang, "incumbents.none")}</p>
      ) : (
        <>
          <p class="muted small">{tn(lang, "incumbents.note_one", "incumbents.note_many", inc.nOrgs, { n: fmtInt(inc.nOrgs, lang), max: INCUMBENTS_MAX })}</p>
          <div class="table-wrap bordered">
            <Table restack={false} class="compact" cols={[
              { kind: "main", label: t(lang, "col.supplier") },
              { kind: "count", label: t(lang, "expiring.col_contracts") },
              { kind: "total", label: t(lang, "col.value") },
              { kind: "date", label: t(lang, "incumbents.soonest") },
            ]}>
              <tbody>
                {inc.rows.map((r) => {
                  const id = orgIdOf(num(r.oid) ?? 0);
                  const v = dollars(r.cents);
                  return (
                    <tr>
                      <td data-label={t(lang, "col.supplier")}><a href={`/organizations/${id}`}>{str(r.name) ?? id}</a></td>
                      <td data-label={t(lang, "expiring.col_contracts")} class="mono num">
                        <a href={`/expiring/12m?${inc.filter}&supplier=${id}`} rel="nofollow">{fmtInt(num(r.n), lang)}</a>
                      </td>
                      <td data-label={t(lang, "col.value")} class="mono num">{v === null ? t(lang, "common.not_stated") : money(lang, v)}</td>
                      <td data-label={t(lang, "incumbents.soonest")} class="mono">{str(r.soonest) ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          {inc.locked && inc.nOrgs > inc.rows.length ? (
            <ProNote lang={lang}>
              {/* Pro's list keeps the largest INCUMBENTS_MAX, so it lists them all only up to that many. */}
              {t(lang, inc.nOrgs > INCUMBENTS_MAX ? "incumbents.pro_capped" : "incumbents.pro", {
                n: INCUMBENTS_TEASE, all: fmtInt(inc.nOrgs, lang), max: INCUMBENTS_MAX,
              })}{" "}
              <a href={inc.signedIn ? "/account/billing" : "/account/sign-in"}>{t(lang, inc.signedIn ? "analytics.pro_billing" : "analytics.pro_sign_in")}</a>
            </ProNote>
          ) : null}
        </>
      )}
    </Panel>
  );
};

// -- an organization's feed ------------------------------------------------------------------

const FEED_CACHE_SECONDS = 3600;
const TAG = "tag:awardwatch.ca,2026:";

const xml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const both = (en: string, fr: string): string => (en === fr ? en : `${en} / ${fr}`);

export async function orgFeed(c: Context<AppEnv>): Promise<Response> {
  const file = c.req.param("file") ?? "";
  const id = file.replace(/\.xml$/, "");
  const oid = ORG_ID_RE.test(id) ? orgNumber(id) : null;
  if (oid === null) return c.notFound();
  // Kept an hour by the edge's cache, so a poller's requests cost no D1 read in between.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(`${SITE_ORIGIN}/data/feeds/organizations/${id}.xml`);
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) return hit;
  const profile = await loadProfile(c.env, id);
  if (!profile) return c.notFound();
  const today = todayOf((await loadStats(c.env))?.data_as_of);
  const read = await readOrgFeed(c.env, oid, firstDay(today));
  if (read.state !== "ready") {
    c.header("Retry-After", "3600");
    c.header("Cache-Control", "no-store");
    return c.body(null, 503);
  }
  const name = profile.organization.display_name;
  const page = `${SITE_ORIGIN}/organizations/${id}`;
  const entries = (read.rows[0] ?? []).map((r) => {
    const src = num(r.src) ?? 0;
    const ref = String(r.ref ?? "");
    const href = recordHref(src, ref);
    const link = href?.startsWith("/") ? `${SITE_ORIGIN}${href}` : href;
    const title = (() => {
      const en = str(r.title_en);
      const fr = str(r.title_fr);
      return en && fr ? both(en, fr) : en ?? fr ?? (shownReference(ref) || both(t("en", "common.not_stated"), t("fr", "common.not_stated")));
    })();
    const v = dollars(r.cents);
    const buyer = str(r.buyer_en) ?? str(r.buyer_id) ?? t("en", "common.not_stated");
    const source = SOURCE_OF[src];
    const summary = both(
      [source ? sourceLabel("en", source) : "", buyer, v === null ? t("en", "common.not_stated") : fmtMoney(v, "en")].filter(Boolean).join(" · "),
      [source ? sourceLabel("fr", source) : "", str(r.buyer_fr) ?? buyer, v === null ? t("fr", "common.not_stated") : fmtMoney(v, "fr")].filter(Boolean).join(" · "),
    );
    const day = str(r.day) ?? today;
    // A record with no page here (records.tsx recordHref) has no link, and
    // Atom then asks for content: the summary with the reference as text.
    const rest = link
      ? `    <link rel="alternate" type="text/html" href="${xml(link)}"/>\n    <summary>${xml(summary)}</summary>\n`
      : `    <summary>${xml(summary)}</summary>\n    <content type="text">${xml(`${summary} · ${shownReference(ref)}`)}</content>\n`;
    return `  <entry>\n    <id>${xml(`${TAG}records/${src}/${ref}`)}</id>\n    <title>${xml(title)}</title>\n    <updated>${day}T00:00:00Z</updated>\n` +
      `${rest}  </entry>\n`;
  });
  const updated = (read.asOf ?? today) + "T00:00:00Z";
  const body = '<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n' +
    `  <id>${xml(`${TAG}feeds/organizations/${id}`)}</id>\n` +
    `  <title>${xml(`Award Watch: ${both(t("en", "orgfeed.title"), t("fr", "orgfeed.title"))}, ${name}`)}</title>\n` +
    `  <subtitle>${xml(both(t("en", "orgfeed.subtitle"), t("fr", "orgfeed.subtitle")))}</subtitle>\n` +
    `  <updated>${updated}</updated>\n` +
    `  <link rel="self" type="application/atom+xml" href="${SITE_ORIGIN}/data/feeds/organizations/${id}.xml"/>\n` +
    `  <link rel="alternate" type="text/html" href="${page}"/>\n` +
    `  <author><name>Award Watch</name><uri>${SITE_ORIGIN}/</uri></author>\n` +
    entries.join("") + "</feed>\n";
  const res = new Response(body, {
    headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": `public, max-age=${FEED_CACHE_SECONDS}` },
  });
  if (cache) {
    const put = cache.put(key, res.clone()).catch(() => undefined);
    try {
      c.executionCtx.waitUntil(put);
    } catch {
      await put; // no execution context (a test's request): store it before answering
    }
  }
  return res;
}
