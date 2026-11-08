// Message fixtures shared by the delivery tests (accounts-deliveries.test.ts)
// and the mail suite (test-mail/, docs/mail.md), and the fake MAIL binding the
// delivery and console tests hand messages to: tender notices and contracts
// as the published files hold them, the radar's contracts R1 to R5, and the
// inputs of a tender digest and a radar digest in each language, on the
// fixtures' data date. Nothing here touches a database.
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
