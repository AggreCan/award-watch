// Message fixtures shared by the delivery tests (accounts-deliveries.test.ts)
// and the mail suite (test-mail/, docs/mail.md), and the fake MAIL binding the
// delivery and console tests hand messages to: tender notices and contracts
// as the published files hold them, the radar's contracts R1 to R5, and the
// inputs of a tender digest and a radar digest in each language, on the
// fixtures' data date, and the week's matching notices block. Nothing here
// touches a database.
import { rankNotices } from "../public/fit.js";
import type { DigestMatches, WatchGroup } from "../src/account/digests";
import type { Plan } from "../src/account/entitlements";
import { matchDigestBlock } from "../src/account/fit_mail";
import type { ExpiringRow, TenderRow } from "../src/data";
import { readExpiringQuery } from "../src/pages/expiring";

export const SITE = "https://awardwatch.ca";
export const DAY = "2026-10-31"; // the fixtures' data date, and TEST_NOW's UTC date

export function tender(reference: string, over: Partial<TenderRow> = {}): TenderRow {
  return {
    reference, amendment: 0, title_en: `Notice ${reference}`, title_fr: `Avis ${reference}`, buyer_id: "dfo-mpo",
    buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada", published: DAY, closing: "2026-11-26T14:00:00",
    category: ["SRV"], notice_type_en: "Request for Proposal", notice_type_fr: "Demande de propositions",
    method_en: "Competitive - Open bidding", method_fr: "Concurrentielle - Appel d'offres ouvert", segments: ["72"], provinces: ["BC"],
    first_seen: DAY, status: "open", ...over,
  };
}

export function contract(kind: ExpiringRow["kind"], reference: string, end: string, over: Partial<ExpiringRow> = {}): ExpiringRow {
  return {
    kind, reference, title_en: `Contract ${reference}`, title_fr: `Contrat ${reference}`, organization_id: "org-b000000001",
    organization: "Marathon Targets Inc.", buyer_id: "dnd-mdn", buyer_en: "National Defence", buyer_fr: "Défense nationale",
    start: "2025-01-01", end, days_left: 0, value: 188345, currency: "CAD", competitive: 1, method_en: null, method_fr: null,
    instrument_en: "Contract", instrument_fr: "Contrat", n_amendments: 0, value_growth: 0, tender_reference: null,
    segments: ["46"], provinces: ["ON"], ...over,
  };
}

// The radar's 3-month window, soonest end first. From the data date
// 2026-10-31 the window reaches 2027-01-30; a day earlier it reached
// 2027-01-29, a week earlier 2027-01-23.
export const R1 = contract("award", "cb-500-50000001", "2027-01-30", { title_en: "Robotics targets" });
export const R2 = contract("history", "W8486-091235", "2027-01-29", { organization: "JHT Defense Inc.", value: 90476 });
export const R3 = contract("contract", "dnd-mdn:C-2026-0099", "2027-01-25", { organization: null, organization_id: null, supplier_withheld: true, value: null });
export const R4 = contract("award", "cb-500-50000004", "2026-12-15");
export const R5 = contract("award", "cb-500-50000005", "2027-01-30", { buyer_id: "pwgsc-tpsgc", buyer_en: "Public Services and Procurement Canada" });

export const STOP = `${SITE}/account/stop?s=${"a".repeat(32)}&t=${"b".repeat(32)}`;
export const TENDER_ROWS = [
  tender("cb-746-37313616", { title_en: "Solenoid Procurement", title_fr: "Achat de solénoïdes", buyer_en: "National Defence", buyer_fr: "Défense nationale", provinces: ["ON"], closing: "2026-11-03T14:00:00", segments: ["31"] }),
  tender("cb-106-83883729", { title_en: "Power Distribution Upgrade", title_fr: "Mise à niveau de la distribution électrique", closing: "2026-11-16T14:00:00" }),
];

export function tenderInput(lang: "en" | "fr") {
  return {
    lang, to: "reader@example.com", site: SITE, label: lang === "en" ? "New tender notices matching Province: British Columbia" : "Nouveaux avis",
    params: "/tenders?province=BC&segment=72", cadence: "daily" as const, dataDate: DAY, stopUrl: lang === "fr" ? `${STOP}&lang=fr` : STOP, total: 3,
    rows: TENDER_ROWS, since: "2026-10-30",
  };
}

export function expiringInput(lang: "en" | "fr") {
  return {
    lang, to: "reader@example.com", site: SITE, label: "Contracts entering the 3-month window for National Defence",
    params: "/expiring/3m?buyer=dnd-mdn", cadence: "weekly" as const, dataDate: DAY, stopUrl: STOP, total: 3,
    rows: [R1, R2, R3], months: 3, query: readExpiringQuery(new URL(`${SITE}/expiring/3m?buyer=dnd-mdn`)),
  };
}

// The weekly email (src/account/weekly.ts, digests.ts weeklyDigest): a
// made-up mailing address for its footer (the real one is the Worker secret
// MAIL_ADDRESS and is never in the repository), its stop link, the site's
// week in figures, and the watches with news, as watch_mail.ts groupsFor
// hands them over (the message names counts, not rows).
export const SAMPLE_ADDRESS = "100 Sample Street, Exampletown ON A0A 0A0";
export const WEEKLY_STOP = `${SITE}/account/stop?e=${"c".repeat(32)}&t=${"d".repeat(32)}`;
export const WEEK_FIGURES = { notices: 412, closing: 263, awards: 187, ending: 1250 };

export function weeklyGroups(lang: "en" | "fr"): WatchGroup[] {
  return [
    {
      kind: "organization", label: "Sample Engineering Ltd.", path: "/organizations/org-a000000001",
      events: [{ kind: "award", n: 2, rows: [] }, { kind: "amended", n: 1, rows: [] }],
    },
    {
      kind: "buyer", label: lang === "fr" ? "Pêches et Océans Canada" : "Fisheries and Oceans Canada", path: "/buyers/dfo-mpo",
      events: [{ kind: "notice", n: 4, rows: [] }],
    },
    {
      kind: "tender", label: lang === "fr" ? "Levé hydrographique (exemple)" : "Hydrographic survey (sample)", path: "/tenders/cb-100-10000001",
      events: [{ kind: "notice_amended", n: 1, rows: [] }],
    },
  ];
}

// A weekly email's input: with the watches' news, or (none) the site's week for an account that follows `watched` pages.
export function weeklyInput(lang: "en" | "fr", o: { news?: boolean; watched?: number; pro?: boolean } = {}) {
  const groups = o.news === false ? [] : weeklyGroups(lang);
  return {
    lang, to: "reader@example.com", site: SITE, dataDate: DAY, address: SAMPLE_ADDRESS, stopUrl: lang === "fr" ? `${WEEKLY_STOP}&lang=fr` : WEEKLY_STOP,
    watches: { groups, total: groups.reduce((n, g) => n + g.events.reduce((m, e) => m + e.n, 0), 0), watched: o.watched ?? (groups.length ? 4 : 0) },
    figures: WEEK_FIGURES, pro: o.pro ?? false,
  };
}

// The week's matching notices (src/account/fit_mail.ts), as fitDigestBlock
// builds them for a plan: an organization whose records share the class
// 821118 with n of the week's notices, each a close match, ranked by
// public/fit.js and drawn in lang. The class is named by its code alone, as
// it is when the levels file does not read.
export const MATCH_NAME = "Exemplar Translation Services Inc.";
export const MATCH_BLOCK = {
  fy: [2022, 2026] as [number, number], n: [7, 3, 12] as [number, number, number], coded: [7, 3] as [number, number], newest: "2026-09-30",
  classes: [["821118", 5, 2]] as [string, number, number][], families: [["8211", 5, 2]] as [string, number, number][],
  segments: [["82", 5, 2]] as [string, number, number][], buyers: [["pwgsc-tpsgc", 4, 3, 0]] as [string, number, number, number][],
  provinces: [["ON", 6, 2]] as [string, number, number][], types: [["Request for Proposal", 5, 1]] as [string, number, number][],
  held: [] as [string, string, number][],
};

export function matchesInput(lang: "en" | "fr", plan: Plan, n: number): DigestMatches {
  const rows = Array.from({ length: n }, (_, i) => tender(`cb-910-${String(i).padStart(8, "0")}`, {
    title_en: `Translation services ${i + 1} (sample)`, title_fr: `Services de traduction ${i + 1} (exemple)`, buyer_id: "pwgsc-tpsgc",
    buyer_en: "Public Services and Procurement Canada", buyer_fr: "Services publics et Approvisionnement Canada", codes: ["82111800"],
    segments: ["82"], provinces: ["ON"], closing: "2026-11-20T14:00:00", first_seen: "2026-10-30",
  }));
  const { matches } = rankNotices(MATCH_BLOCK, rows, "ON");
  return matchDigestBlock(lang, SITE, { plan, name: MATCH_NAME, matches, levels: null })!;
}

// A saved view's message (src/account/digests.ts viewDigest), as view_mail.ts
// hands it over: a buyer's published contracts over five fiscal years, the
// last counted to date, and its largest records of that year, one with no
// page of its own and one whose supplier the record does not name.
export const VIEW_STOP = `${SITE}/account/stop?v=${"e".repeat(32)}&t=${"f".repeat(32)}`;

export function viewInput(lang: "en" | "fr") {
  return {
    lang, to: "reader@example.com", site: SITE, stopUrl: lang === "fr" ? `${VIEW_STOP}&lang=fr` : VIEW_STOP, cadence: "weekly" as const,
    name: lang === "fr" ? "Défense nationale, contrats publiés" : "National Defence, published contracts",
    address: "/buyers/dnd-mdn/analytics?source=contracts&years=5", csv: "/buyers/dnd-mdn/analytics/quarters.csv?source=contracts&years=5",
    source: "contracts", first: 2022, last: 2026, current: 2026, dataDate: DAY,
    years: [
      { fy: 2022, n: 410, cents: 91_200_000_000 }, { fy: 2023, n: 388, cents: 84_550_000_000 }, { fy: 2024, n: 402, cents: 99_000_000_000 },
      { fy: 2025, n: 377, cents: 102_340_000_000 }, { fy: 2026, n: 151, cents: null },
    ],
    largest: [
      { src: 3, ref: "dnd-mdn:C-2026-0001", title: "Fleet maintenance (sample)", cents: 4_500_000_000, party: "Marathon Targets Inc.", path: "/contracts/dnd-mdn/C-2026-0001" },
      { src: 3, ref: "dnd-mdn:C-2026-0002", title: null, cents: 1_250_000_000, party: null, path: null },
    ],
  };
}

export type Handed = {
  from: unknown; to: string; replyTo?: unknown; subject: string; text?: string; html?: string; headers?: Record<string, string>;
};

// A binding that keeps what it is handed; fail(to) names an error to throw for an address.
export function fakeMail(fail: (to: string) => unknown = () => undefined) {
  const handed: Handed[] = [];
  const binding = {
    async send(message: Handed) {
      handed.push(message);
      const error = fail(message.to);
      if (error !== undefined) throw error;
      return { messageId: "<test@awardwatch.ca>" };
    },
  } as unknown as SendEmail;
  return { handed, binding, to: (email: string) => handed.filter((m) => m.to === email) };
}
