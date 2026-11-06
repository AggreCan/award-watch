// The one-event calendar files, for every reader and whatever the accounts
// switch says: /tenders/<reference>.ics with the notice's closing, and
// /awards/<reference>.ics, /history/<reference>.ics and
// /contracts/<department>/<reference>.ics with the contract's end
// (src/calendar.ts writes them). They hold public data and nothing about the
// reader, so they are cached for an hour by anyone; each counts against the
// per-address download cap (limits.ts). The notice and contract pages link
// them beside the closing or the end date while it is still to come; the
// file itself answers for any notice or contract the data holds, a
// cancelled one marked STATUS:CANCELLED, so a reader who imported it before
// can take the file again and see the change.

import type { Context } from "hono";
import { ICS_TYPE, calendarBase, contractEvent, detailFacts, noticeEvent, writeCalendar, type CalEvent } from "../calendar";
import { BUYER_ID_RE, REFERENCE_RE, loadContract, loadStats, loadTender } from "../data";
import type { AppEnv } from "../env";
import { pick, t, type Lang } from "../i18n";
import { noDataPage, todayOf } from "../layout";
import { dollars, num } from "../records_db";
import { readPublishedContract } from "../records_tables";
import { REF_MAX } from "./published";
import { contractPath } from "./shared";

// The files' addresses, for the links beside the dates: the page's language
// rides in the address, so one address always gives one language and the
// hour's cache never hands a French file to an English page.
const langQuery = (lang: Lang) => (lang === "fr" ? "?lang=fr" : "");
export const tenderIcsPath = (reference: string, lang: Lang) => `/tenders/${reference.toLowerCase()}.ics${langQuery(lang)}`;
export const contractIcsPath = (kind: "award" | "history", reference: string, lang: Lang) =>
  `/${kind === "award" ? "awards" : "history"}/${reference.toLowerCase()}.ics${langQuery(lang)}`;
export const publishedIcsPath = (dept: string, reference: string, lang: Lang) => `${contractPath(dept, reference)}.ics${langQuery(lang)}`;

// The file's name when saved: the reference's safe characters.
const fileName = (s: string) => `${s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 120) || "award-watch"}.ics`;

function icsFile(c: Context<AppEnv>, event: CalEvent, dataAsOf: string | null, name: string): Response {
  c.header("Content-Type", ICS_TYPE);
  c.header("Cache-Control", "public, max-age=3600");
  c.header("Content-Disposition", `attachment; filename="${fileName(name)}"`);
  return c.body(writeCalendar({ lang: c.get("lang"), events: [event], dataDate: todayOf(dataAsOf) }));
}

const withoutIcs = (file: string) => file.replace(/\.ics$/, "");

export async function tenderIcs(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const raw = withoutIcs(c.req.param("file") ?? "");
  if (!REFERENCE_RE.test(raw)) return c.notFound();
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "tender.title");
  const d = await loadTender(c.env, raw);
  if (!d) return c.notFound();
  // A notice's segments are its codes' first two digits, as the list rows carry them.
  const segments = [...new Set(d.codes.map((x) => x.code.slice(0, 2)))].sort();
  const event = noticeEvent(lang, { ...d, segments, cancelled: d.status === "cancelled" }, calendarBase(c.env, c.req.url));
  return event ? icsFile(c, event, stats.data_as_of, d.reference) : c.notFound();
}

export async function contractIcs(c: Context<AppEnv>, kind: "award" | "history"): Promise<Response> {
  const lang = c.get("lang");
  const raw = withoutIcs(c.req.param("file") ?? "");
  if (!REFERENCE_RE.test(raw)) return c.notFound();
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, kind === "award" ? "contract.title_award" : "contract.title_history");
  const d = await loadContract(c.env, kind, raw);
  const facts = d ? detailFacts(lang, d) : null;
  const event = facts ? contractEvent(lang, facts, calendarBase(c.env, c.req.url)) : null;
  return event && d ? icsFile(c, event, stats.data_as_of, d.reference) : c.notFound();
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

// A published contract, from the records database as its page reads it
// (pages/published.tsx): the holder, the department, the counted value and
// the end of this row; its amendments are the other rows of the same
// contract.
export async function publishedContractIcs(c: Context<AppEnv>): Promise<Response> {
  const lang = c.get("lang");
  const dept = (c.req.param("dept") ?? "").toLowerCase();
  const ref = withoutIcs(c.req.param("file") ?? "");
  if (!BUYER_ID_RE.test(dept) || dept.length > 80 || !ref || ref.length > REF_MAX || CONTROL_RE.test(ref)) return c.notFound();
  const stats = await loadStats(c.env);
  if (!stats) return noDataPage(c, "published.title");
  const read = await readPublishedContract(c.env, dept, ref);
  if (read.state !== "ready") {
    c.header("Retry-After", "3600");
    c.header("Cache-Control", "no-store");
    return c.text(t(lang, read.state === "loading" ? "published.loading" : "published.unavailable"), 503);
  }
  const rows = read.rows[0] ?? [];
  const d = rows.find((r) => num(r.self) === 1);
  const end = d ? str(d.endd) : null;
  if (!d || !end) return c.notFound();
  const description = pick(lang, str(d.desc_en), str(d.desc_fr));
  const event = contractEvent(lang, {
    kind: "contract",
    reference: `${dept}:${ref}`,
    path: contractPath(dept, ref),
    holder: num(d.wh) === 1 ? t(lang, "expiring.withheld") : str(d.org_name) ?? t(lang, "common.not_stated"),
    buyer: pick(lang, str(d.buyer_en), str(d.buyer_fr)) ?? dept,
    title: description ? description.split("\n")[0].slice(0, 200) : ref,
    end,
    start: str(d.start),
    value: dollars(d.counted),
    currency: "CAD",
    amendments: rows.filter((r) => num(r.self) !== 1).length,
    growth: null,
  }, calendarBase(c.env, c.req.url));
  return event ? icsFile(c, event, stats.data_as_of, `${dept}-${ref}`) : c.notFound();
}
