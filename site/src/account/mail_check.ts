// The live mail check (docs/mail.md): one real message of each template the
// site sends, to the operator's test inbox (MAIL_TEST_TO) and to no other
// address. The console's POST /admin/mail-check runs it (admin.tsx), from an
// operator's session or from the mail-check workflow's token
// (.github/workflows/mail-check.yml, mailCheckTokenAdmits below).
//
// Every message is the site's own template filled with fixed sample rows:
// nothing is read from a file or a database, so a check proves the path a
// message takes out of the Worker and never depends on the night's data.
// Each goes through the path a reader's message takes (deliveries.ts
// sendWithHeaders: the sender sender.ts senderFor picks, with the
// List-Unsubscribe pair a list message carries), so a refusal here is the
// refusal a reader's message would meet. The subject starts with
// MAIL_CHECK_MARK, a fixed tag in both languages, so the message is never
// taken for a reader's and an inbox rule can file it. The stop links name an
// id and a secret of zeros, which match no row: a click, or a mail client's
// one-click post, changes nothing.
//
// The recipient is MAIL_TEST_TO alone: the builders are handed it, the run
// sets it again on each message before the send, and nothing here reads an
// address from a database. The JSON the route answers names templates and
// results only, never the address.

import { addDays } from "../../public/closing.js";
import { clockAt } from "../closing";
import type { ExpiringRow, TenderRow } from "../data";
import type { Env } from "../env";
import { segmentShort, t, type Lang } from "../i18n";
import { readExpiringQuery } from "../pages/expiring";
import { normalizeEmail } from "../pages/interest";
import { fiscalYearOf } from "../records_db";
import { accessRequired, accessVerified } from "./admin_access";
import { operatorEmails } from "./admin_ops";
import { accountsOpenMessage, announceLinks, ultraLinks, ultraOpenMessage } from "./announce";
import { type BriefingData, type BriefingSubject, INSTRUMENT_WITHIN, briefingName, nextQuarter, quarterTurn } from "./briefings";
import { sendWithHeaders } from "./deliveries";
import { briefingDigest, expiringDigest, fitSubject, recordsDigest, siteLink, tenderDigest, watchDigest, weeklyDigest } from "./digests";
import { matchDigestBlock } from "./fit_mail";
import { sameHash, sha256Hex } from "./secrets";
import { type MailMessage, type Sender, addressNotice, senderFor, signInMessage } from "./sender";
import { CODE_MINUTES } from "./signin";
import { accountsEnabled } from "./switch";
import { mailAddress } from "./weekly";

// The tag every subject starts with. Not translated: it is a fixed marker for
// the operator's inbox, the same in both languages.
export const MAIL_CHECK_MARK = "[mail check]";

// One message of each template, in this order. Two cadences of the
// saved-search delivery are covered by its two kinds (the tender notices
// daily, the contracts ending weekly), since the footer's reason is the only
// part the cadence changes.
export const MAIL_CHECK_TEMPLATES = [
  "sign_in", "tenders_daily", "expiring_weekly", "records", "watch", "briefing", "weekly", "accounts_open", "ultra_open", "address_notice",
] as const;
export type MailCheckTemplate = (typeof MAIL_CHECK_TEMPLATES)[number];

// The messages a list or watch delivery sends: each carries a stop link, the
// reason it came, and List-Unsubscribe with an https stop link.
export const MAIL_CHECK_LISTS: ReadonlySet<MailCheckTemplate> = new Set([
  "tenders_daily", "expiring_weekly", "records", "watch", "briefing", "weekly", "accounts_open", "ultra_open",
]);

// The reason the weekly email's template reports when MAIL_ADDRESS is unset:
// the message must carry the mailing address, so it is not built or sent.
export const NO_MAIL_ADDRESS = "no_mail_address";

// The token the workflow sends is a random value of at least this many
// characters; a shorter MAIL_CHECK_TOKEN on the Worker admits nothing.
export const MAIL_CHECK_TOKEN_MIN = 32;

export type MailCheckOutcome = "sent" | "refused" | "stubbed";
// reason: the sender's reason when the message did not go (the binding's
// error code, "failed" without one, or "not_configured" for the stub).
export type MailCheckResult = { template: MailCheckTemplate; result: MailCheckOutcome; reason: string | null };
export type MailCheckRun = { sender: Sender["kind"]; results: MailCheckResult[] };
export type MailCheckMessage = { template: MailCheckTemplate; message: MailMessage & { headers: Record<string, string> } };

// The test inbox, normalized as sign-in normalizes an address; null when
// MAIL_TEST_TO is unset or is not an address a mail system takes.
export function mailCheckTo(env: Pick<Env, "MAIL_TEST_TO">): string | null {
  return normalizeEmail(env.MAIL_TEST_TO ?? "");
}

// -- the sample rows -------------------------------------------------------------------------

// An id and a secret that no row holds (ids and secrets are 32 random hex
// characters), so every stop link and token below leads nowhere.
const ZERO = "0".repeat(32);

const BUYER = { buyer_id: "pwgsc-tpsgc", buyer_en: "Public Services and Procurement Canada", buyer_fr: "Services publics et Approvisionnement Canada" };

function sampleTender(reference: string, day: string, closingIn: number, o: Partial<TenderRow> = {}): TenderRow {
  return {
    reference, amendment: 0, title_en: "Snow removal at a federal building (sample)", title_fr: "Déneigement d'un immeuble fédéral (exemple)",
    ...BUYER, published: day, closing: `${addDays(day, closingIn)}T14:00:00`, category: ["SRV"],
    notice_type_en: "Request for Proposal", notice_type_fr: "Demande de propositions", method_en: "Competitive - Open bidding",
    method_fr: "Concurrentielle - Appel d'offres ouvert", segments: ["72"], provinces: ["ON"], first_seen: day, status: "open", ...o,
  };
}

function sampleContract(kind: ExpiringRow["kind"], reference: string, end: string, o: Partial<ExpiringRow> = {}): ExpiringRow {
  return {
    kind, reference, title_en: "Translation services (sample)", title_fr: "Services de traduction (exemple)", organization_id: null,
    organization: "Sample Translation Services Inc.", ...BUYER, start: "2025-04-01", end, days_left: 0, value: 188_345, currency: "CAD",
    competitive: 1, method_en: null, method_fr: null, instrument_en: "Contract", instrument_fr: "Contrat", n_amendments: 0, value_growth: 0,
    tender_reference: null, segments: ["80"], provinces: ["ON"], ...o,
  };
}

// The briefing's week for segment 81, every section with a row, ending on the
// data date. Exported for the mail suite, which widens a section past its cap.
export function mailCheckBriefingData(day: string): BriefingData {
  const quarter = nextQuarter(day);
  const award = {
    ref: "cb-000-00000021", src: 1, day, cents: 48_500_000, title: "Bridge inspection (sample)", title_fr: "Inspection de ponts (exemple)",
    path: "/awards/cb-000-00000021", sid: 81, org: "Sample Engineering Ltd.", ...BUYER,
  };
  return {
    asOf: day, dataDate: day, start: addDays(day, -7),
    notices: {
      n: 2,
      rows: [{
        ref: "cb-000-00000020", day, closing: `${addDays(day, 6)}T14:00:00`, title: "Geotechnical survey (sample)",
        title_fr: "Étude géotechnique (exemple)", path: "/tenders/cb-000-00000020", buyer_en: BUYER.buyer_en, buyer_fr: BUYER.buyer_fr,
      }],
    },
    awards: { n: 1, sources: [{ src: 1, n: 1, cents: 48_500_000, nv: 0 }], rows: [award] },
    ending: {
      quarter, n: 1, cents: 30_000_000, nv: 0, fresh: 1,
      rows: [{ row: sampleContract("award", "cb-000-00000022", quarter.first, { title_en: "Design review (sample)", title_fr: "Examen de conception (exemple)", organization: "Sample Engineering Ltd.", value: 300_000, segments: ["81"] }), fresh: true }],
    },
    amended: {
      n: 1,
      rows: [{ ...award, ref: "cb-000-00000023", path: "/awards/cb-000-00000023", cents: 60_000_000, ocents: 40_000_000, endd: addDays(day, 400), oendd: addDays(day, 200) }],
    },
    largest: { fy: fiscalYearOf(day), rows: [{ ...award, src: 1, cents: 48_500_000, path: "/awards/cb-000-00000021" }] },
    instruments: {
      within: INSTRUMENT_WITHIN, n: 1,
      rows: [{
        agr: "E0000-000000", type_en: "Standing offer", type_fr: "Offre à commandes", desc_en: "Engineering services (sample)",
        desc_fr: "Services d'ingénierie (exemple)", user_en: BUYER.buyer_en, user_fr: BUYER.buyer_fr, expiry: addDays(day, 120), n: 3,
      }],
    },
    turn: quarterTurn(day),
  };
}

// The matching notices block for a Free account (fit_mail.ts), from four
// sample matches, so it lists RULES.free.match_mail and counts the rest.
export function mailCheckMatches(lang: Lang, site: string, day: string) {
  const work = { part: "work" as const, kind: "class" as const, key: "721015", counts: [5, 2], points: 45 };
  const matches = [95, 80, 60, 45].map((points, i) => ({
    row: sampleTender(`cb-000-0000003${i}`, day, 10 + i, {
      title_en: `Building maintenance services (sample ${i + 1})`, title_fr: `Services d'entretien de bâtiments (exemple ${i + 1})`,
    }),
    score: { points, band: points >= 60 ? "close" as const : "partial" as const, coded: true, reasons: [work] },
  }));
  return matchDigestBlock(lang, site, { plan: "free", name: "Sample Engineering Ltd.", matches, levels: null });
}

// -- the messages ------------------------------------------------------------------------------

// One message of each template, in lang, to `to`, its links on `site` (no
// trailing slash), the rows dated from now's UTC date. The subjects carry the
// mark and stay under SUBJECT_MAX with it (digests.ts fitSubject). Exported for the mail suite (site/test-mail/), which checks these
// before the route ever sends them. address is the sender's mailing address
// (weekly.ts mailAddress); without one the weekly email is left out, as the
// delivery run leaves it unsent.
export function mailCheckMessages(lang: Lang, to: string, site: string, now: Date = new Date(), address: string | null = null): MailCheckMessage[] {
  const day = now.toISOString().slice(0, 10);
  const yesterday = addDays(day, -1);
  const link = (path: string) => siteLink(site, path, lang);
  const segment43 = `43 ${segmentShort(lang, "43")}`;
  const build: Record<MailCheckTemplate, () => (MailMessage & { headers?: Record<string, string> }) | null> = {
    sign_in: () => signInMessage(lang, to, "000000", `${site}/account/check?token=${ZERO}.${ZERO}${ZERO}${lang === "fr" ? "&lang=fr" : ""}`,
      CODE_MINUTES, site),
    tenders_daily: () => tenderDigest({
      lang, to, site, label: t(lang, "interest.label_tenders_all"), params: "/tenders", cadence: "daily", dataDate: day,
      stopUrl: link(`/account/stop?s=${ZERO}&t=${ZERO}`), total: 3, since: yesterday,
      rows: [
        sampleTender("cb-000-00000001", day, 5),
        sampleTender("cb-000-00000002", day, 20, {
          title_en: "Roof repairs (sample)", title_fr: "Réparation de toitures (exemple)", segments: ["72", "30"], provinces: ["NS"],
        }),
      ],
    }),
    expiring_weekly: () => expiringDigest({
      lang, to, site, label: t(lang, "interest.label_expiring", { n: 3, scope: t(lang, "interest.scope_all") }), params: "/expiring/3m",
      cadence: "weekly", dataDate: day, stopUrl: link(`/account/stop?s=${ZERO}&t=${ZERO}`), total: 2, months: 3,
      query: readExpiringQuery(new URL("/expiring/3m", site)),
      rows: [
        sampleContract("award", "cb-000-00000003", addDays(day, 80)),
        sampleContract("history", "W0000-000003", addDays(day, 60), { organization: "Sample Linguistics Ltd.", value: 90_476 }),
      ],
    }),
    records: () => recordsDigest({
      lang, to, site, label: t(lang, "interest.label_segment", { segment: segment43 }), params: "/segments/43", cadence: "daily",
      dataDate: day, stopUrl: link(`/account/stop?s=${ZERO}&t=${ZERO}`), total: 4, kind: "segment", name: segment43,
      rows: [
        { src: "awards", fy: fiscalYearOf(day), more: 2, n: 14, cents: 125_000_000 },
        { src: "history", fy: fiscalYearOf(day), more: 1, n: 5, cents: null },
      ],
      more: 3, since: yesterday, tenderTotal: 1, tenderSince: yesterday,
      tenders: [sampleTender("cb-000-00000010", day, 12, {
        title_en: "Network equipment (sample)", title_fr: "Équipement réseau (exemple)", segments: ["43"], category: ["GD"],
      })],
    }),
    watch: () => watchDigest({
      lang, to, site, dataDate: day, stopUrl: link(`/account/stop?w=${ZERO}&t=${ZERO}`), total: 3, watched: 4, clock: clockAt(now.getTime()),
      groups: [{
        kind: "organization", label: "Sample Engineering Ltd.", path: "/account/watches",
        events: [
          {
            kind: "award", n: 1,
            rows: [{
              day, kind: "award", src: 1, ref: "award:cb-000-00000004", cents: 48_500_000, ocents: null, endd: addDays(day, 365), oendd: null,
              closing: null, oclosing: null, namd: null, title: "Bridge inspection (sample)", title_fr: "Inspection de ponts (exemple)",
              other: null, horizon: null, path: "/awards/cb-000-00000004",
            }],
          },
          {
            kind: "amended", n: 2,
            rows: [{
              day, kind: "amended", src: 2, ref: "history:w0000-000005", cents: 30_000_000, ocents: 20_000_000, endd: addDays(day, 300),
              oendd: addDays(day, 120), closing: null, oclosing: null, namd: 2, title: "Design review (sample)",
              title_fr: "Examen de conception (exemple)", other: null, horizon: null, path: "/history/w0000-000005",
            }],
          },
        ],
      }],
    }),
    briefing: () => {
      const briefing: BriefingSubject = { kind: "segment", subject: "81", segment: "" };
      return briefingDigest({
        lang, to, site, stopUrl: link(`/account/stop?b=${ZERO}&t=${ZERO}`), briefing, name: briefingName(lang, briefing, ""),
        data: mailCheckBriefingData(day),
      });
    },
    // The form most accounts get: one that follows nothing, on Free, the site's week in figures, with the
    // week's matching notices of an account that names its organization, so the inbox shows the block.
    // The notices' figure has two digits so the French subject keeps its matches' count whole beside the mark.
    weekly: () => address === null ? null : weeklyDigest({
      lang, to, site, dataDate: day, address, stopUrl: link(`/account/stop?e=${ZERO}&t=${ZERO}`),
      watches: { groups: [], total: 0, watched: 0 }, figures: { notices: 41, closing: 263, awards: 187, ending: 1250 }, pro: false,
      matches: mailCheckMatches(lang, site, day),
    }),
    accounts_open: () => accountsOpenMessage(lang, to, [t(lang, "interest.label_tenders_all")], announceLinks(site, lang, ZERO)),
    ultra_open: () => ultraOpenMessage(lang, to, ultraLinks(site, lang, ZERO)),
    address_notice: () => addressNotice(lang, to, site),
  };
  return MAIL_CHECK_TEMPLATES.flatMap((template) => {
    const m = build[template]();
    return m ? [{ template, message: { ...m, to, subject: fitSubject(`${MAIL_CHECK_MARK} ${m.subject}`), headers: m.headers ?? {} } }] : [];
  });
}

// -- the run ----------------------------------------------------------------------------------

// Sends each message to `to` through the sender requestUrl picks (the
// binding on the site, the log outbox on a local run with MAIL_SENDER=log,
// the stub when the binding or MAIL_FROM is missing), one after another, and
// reports each. A refusal does not stop the run: the next template is tried,
// so the report shows which templates the mail service takes. Without
// MAIL_ADDRESS the weekly email is reported stubbed, with NO_MAIL_ADDRESS,
// and nothing is sent for it.
export async function runMailCheck(
  env: Env, requestUrl: string, o: { to: string; site: string; lang: Lang; now?: Date },
): Promise<MailCheckRun> {
  const sender = senderFor(env, requestUrl).kind;
  const results: MailCheckResult[] = [];
  const messages = mailCheckMessages(o.lang, o.to, o.site, o.now ?? new Date(), mailAddress(env));
  for (const template of MAIL_CHECK_TEMPLATES) {
    const message = messages.find((m) => m.template === template)?.message;
    if (!message) {
      results.push({ template, result: "stubbed", reason: NO_MAIL_ADDRESS });
      continue;
    }
    const sent = await sendWithHeaders(env, requestUrl, { ...message, to: o.to });
    if (sent.sent) results.push({ template, result: "sent", reason: null });
    else if (sender === "stub") results.push({ template, result: "stubbed", reason: "not_configured" });
    else results.push({ template, result: "refused", reason: sent.code ?? "failed" });
  }
  return { sender, results };
}

// -- the workflow's token -----------------------------------------------------------------------

const BEARER_RE = /^Bearer ([\x21-\x7e]{1,512})$/;

// Whether a request carries the mail-check workflow's token: the accounts
// switch on and OPERATOR_EMAILS set (the console's own first two
// conditions), MAIL_CHECK_TOKEN set on the Worker and at least
// MAIL_CHECK_TOKEN_MIN characters long, an Authorization header "Bearer
// <token>" equal to it, and, while Access guards /admin (ACCESS_AUD set), a
// token Access signed for the request (the workflow passes Access with a
// service token). The two values are hashed before the comparison, so it
// runs over two strings of one length in time that does not depend on where
// they differ. Never logged.
export async function mailCheckTokenAdmits(env: Env, headers: Headers, now: Date = new Date()): Promise<boolean> {
  if (!accountsEnabled(env) || !operatorEmails(env).size) return false;
  const expected = env.MAIL_CHECK_TOKEN?.trim() ?? "";
  if (expected.length < MAIL_CHECK_TOKEN_MIN) return false;
  const given = BEARER_RE.exec(headers.get("authorization")?.trim() ?? "")?.[1];
  if (!given) return false;
  if (!sameHash(await sha256Hex(given), await sha256Hex(expected))) return false;
  return accessRequired(env) ? accessVerified(env, headers, now) : true;
}
