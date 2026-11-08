// References as published and their URL-safe form. About 2.5 percent of award
// and history references hold "/" or ":" ("23240-220799/001/IM"); the export
// writes a URL-safe form in `reference`, which keys the site's own URLs and
// shards, and the reference as published in `reference_published`, which the
// pages show and the CanadaBuys links use. A plain reference has no
// `reference_published` and serves both purposes.
import { describe, expect, it } from "vitest";
import tendersJs from "../public/tenders.js?raw";
import { app } from "../src/index";
import { homeRequest } from "./home";
import { type TenderRow, publishedReference } from "../src/data";
import { contractReference, expiringRecordUrl } from "../src/pages/expiring";
import { filterTenders, readTenderQuery } from "../src/pages/tenders";
import { FILES, makeFakeAssets, testClock, testEnv } from "./assets";
import contracts557 from "./fixtures/contracts-557.json";
import tenderShard from "./fixtures/tenders-f3d.json";

let address = 0;
const get = (path: string, env = testEnv()) =>
  homeRequest(path, { headers: { "cf-connecting-ip": `198.51.100.${(address++ % 250) + 1}` } }, env);
const text = async (path: string, env = testEnv()) => (await get(path, env)).text();

const CONVERTED_TENDER = (tenderShard as Record<string, any>)["en578-123456-a-1"];
const CONVERTED_AWARD = (contracts557 as Record<string, any>)["award:23240-220799-001-im"];

// A list row for each converted record, as the export writes them.
const tenderRow: TenderRow = {
  reference: "en578-123456-a-1", reference_published: "EN578-123456/A:1", amendment: 0,
  title_en: CONVERTED_TENDER.title_en, title_fr: CONVERTED_TENDER.title_fr, buyer_id: "dfo-mpo",
  buyer_en: "Fisheries and Oceans Canada", buyer_fr: "Pêches et Océans Canada", published: "2026-10-31",
  closing: "2026-11-26T14:00:00", category: ["SRV"], notice_type_en: null, notice_type_fr: null, method_en: null,
  method_fr: null, segments: ["15"], provinces: ["BC"], first_seen: "2026-10-31",
};
const awardRow = {
  reference: "23240-220799-001-im", reference_published: "23240-220799/001/IM", title_en: "Marine fuel, call-up 1",
  title_fr: "Carburant marin, commande subséquente 1", organization_id: null, organization: "Coastal Fuel Supply Ltd.",
  buyer_id: "pwgsc-tpsgc", buyer_en: "Public Services and Procurement Canada", buyer_fr: "Services publics et Approvisionnement Canada",
  awarded: "2026-07-04", value: 120000, currency: "CAD", competitive: 1, instrument_en: null, instrument_fr: null,
  segments: ["15"], provinces: ["BC"],
};
const statsWith = (extra: object) =>
  testEnv(makeFakeAssets({}, { "stats.json": { ...(FILES["stats.json"] as object), ...extra } }));

describe("a converted tender notice", () => {
  it("is found by its URL-safe reference and shows the reference as published", async () => {
    const res = await get("/tenders/en578-123456-a-1");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<p class="page-note"><span class="mono">EN578-123456/A:1</span>');
    expect(html).toContain("/ EN578-123456/A:1</nav>");
    expect(html).toContain('<link rel="canonical" href="https://awardwatch.ca/tenders/en578-123456-a-1"');
    // The notice link is built from the reference as published.
    // CanadaBuys drops the colon from the address (EN578-123456/A:1).
    expect(html).toContain('href="https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/en578-123456/a1"');
    expect(html).not.toContain("tender-notice/en578-123456-a-1");
    const fr = await text("/tenders/en578-123456-a-1?lang=fr");
    expect(fr).toContain('href="https://achatscanada.canada.ca/fr/occasions-de-marche/appels-d-offres/en578-123456/a1"');
    // A related award keeps the site's own link and shows nothing else.
    expect(html).toContain('<a href="/awards/23240-220799-001-im">Marine fuel, call-up 1</a>');
    const moved = await get("/tenders/EN578-123456-A-1");
    expect(moved.status).toBe(301);
    expect(moved.headers.get("location")).toBe("/tenders/en578-123456-a-1");
  });

  it("carries the reference as published in the API", async () => {
    const body = (await (await get("/api/tenders/en578-123456-a-1")).json()) as Record<string, unknown>;
    expect(body.reference).toBe("en578-123456-a-1");
    expect(body.reference_published).toBe("EN578-123456/A:1");
  });

  it("matches the text filter on either form, as the script does", () => {
    const q = (s: string) => readTenderQuery(new URL(`https://x/tenders${s}`));
    expect(filterTenders([tenderRow], q("?q=A:1"), testClock)).toHaveLength(1);
    expect(filterTenders([tenderRow], q("?q=123456-a-1"), testClock)).toHaveLength(1);
    expect(tendersJs).toContain("r.reference_published");
  });
});

describe("a converted award and contract history record", () => {
  it("shows the award under its reference as published and links CanadaBuys with it", async () => {
    const html = await text("/awards/23240-220799-001-im");
    expect(html).toContain('<p class="page-note"><span class="mono">23240-220799/001/IM</span>');
    expect(html).toContain('href="https://canadabuys.canada.ca/en/tender-opportunities/award-notice/23240-220799/001/im"');
    expect(html).toContain('<a href="/tenders/en578-123456-a-1" class="btn">Open the tender notice</a>');
    const fr = await text("/awards/23240-220799-001-im?lang=fr");
    expect(fr).toContain('href="https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/23240-220799/001/im"');
  });

  it("shows the history record under its reference as published", async () => {
    const res = await get("/history/23240-220799-001-im");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<p class="page-note"><span class="mono">23240-220799/001/IM</span>');
    expect(html).toContain('<link rel="canonical" href="https://awardwatch.ca/history/23240-220799-001-im"');
    expect(html).toContain("PSPC contract history record 23240-220799/001/IM:");
  });

  it("lists converted rows under their reference as published, linked to the site's own pages", async () => {
    const env = statsWith({ recent_awards: [awardRow], new_tenders: [tenderRow] });
    const html = await text("/", env);
    expect(html).toContain('<a href="/awards/23240-220799-001-im">Marine fuel, call-up 1</a><br/><span class="mono id muted">23240-220799/001/IM</span>');
    expect(html).toContain('<a href="/tenders/en578-123456-a-1">Standing offer for marine fuel, west coast</a><br/><span class="mono id muted">EN578-123456/A:1</span>');
  });
});

describe("plain references", () => {
  it("serve both purposes when no published form is given", async () => {
    expect(publishedReference({ reference: "cb-100-10000001" })).toBe("cb-100-10000001");
    expect(publishedReference({ reference: "x-1", reference_published: "X/1" })).toBe("X/1");
    const html = await text("/tenders/cb-100-10000001");
    expect(html).toContain('<p class="page-note"><span class="mono">cb-100-10000001</span>');
    expect(html).toContain('href="https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/cb-100-10000001"');
    const award = await text("/awards/cb-400-40000004");
    expect(award).toContain('<p class="page-note"><span class="mono">cb-400-40000004</span>');
    expect(award).toContain('href="https://canadabuys.canada.ca/en/tender-opportunities/award-notice/cb-400-40000004"');
  });
});

describe("a reference as published that does not read", () => {
  it("makes its record unreadable, never a broken link", async () => {
    for (const bad of ["", "x".repeat(201), 5, null]) {
      const shard = { "en578-123456-a-1": { ...CONVERTED_TENDER, reference_published: bad } };
      const env = testEnv(makeFakeAssets({}, { "tenders/f3d.json": shard }));
      expect((await get("/tenders/en578-123456-a-1", env)).status, JSON.stringify(bad)).toBe(404);
      const contract = { "award:23240-220799-001-im": { ...CONVERTED_AWARD, reference_published: bad } };
      const env2 = testEnv(makeFakeAssets({}, { "contracts/557.json": contract }));
      expect((await get("/awards/23240-220799-001-im", env2)).status, JSON.stringify(bad)).toBe(404);
      // A list row that does not read empties its list, as any other bad row does.
      const home = await text("/", statsWith({ new_tenders: [{ ...tenderRow, reference_published: bad }] }));
      expect(home).toContain("No new notice in the last refresh.");
    }
  });
});

describe("expiring-contract rows", () => {
  it("show and link an award or history row by its reference as published", () => {
    const award = { kind: "award" as const, reference: "23240-220799-001-im", reference_published: "23240-220799/001/IM" };
    expect(contractReference(award)).toBe("23240-220799/001/IM");
    expect(expiringRecordUrl(award, "en")).toBe("https://canadabuys.canada.ca/en/tender-opportunities/award-notice/23240-220799/001/im");
    expect(expiringRecordUrl(award, "fr")).toBe("https://achatscanada.canada.ca/fr/occasions-de-marche/avis-d-attribution/23240-220799/001/im");
    const plain = { kind: "award" as const, reference: "cb-400-40000004" };
    expect(contractReference(plain)).toBe("cb-400-40000004");
    expect(contractReference({ kind: "contract", reference: "dfo-mpo:C-1" })).toBe("C-1");
  });
});
