// Two fields the sources give that the pages now show, each as its source
// states it:
//
// - the supplier's employees on PSPC's contract history
//   (supplierEmployeeCount): a count, or one of the CanadaBuys data
//   dictionary's size bands on older records; on the history record's page,
//   and on the profile as the figure on its newest record that gives one,
//   dated by that contract;
// - the published contracts' two Indigenous business fields
//   (indigenous_business, indigenous_business_excluding_psib): on the
//   published contract's page (rec_contract_indigenous), and as a tag on a
//   radar row.
//
// A supplier or vendor withheld as a person shows neither. A file or a
// records database from before the fields reads as it did.
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { EMPLOYEE_BANDS, indigenousMark, isEmployees, profileEmployees, supplierEmployees } from "../src/data";
import { app } from "../src/index";
import { PUBLISHED_INDIGENOUS_SQL, TABLE_SQL } from "../src/records_tables";
import { contractPath, employeesText } from "../src/pages/shared";
import contracts from "./fixtures/contracts-637.json";
import expiring3m from "./fixtures/expiring-3m-1.json";
import profiles from "./fixtures/profiles-a00.json";
import { FILES, makeFakeAssets, testEnv } from "./assets";
import { applySql } from "./setup";

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
const nbsp = (s: string) => s.replace(/[  ]/g, " ");
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const read = async (path: string, e: object) => decode(nbsp(await (await app.request(path, {}, e)).text()));

// -- the supplier's employees -------------------------------------------------------

const HISTORY = "history:W8472-000633";
const HISTORY_PATH = "/history/w8472-000633";
const ORG = "org-a000000002";

// The history shard with the record's field set to value (undefined leaves it out).
function historyWith(fields: Record<string, unknown>) {
  const shard = structuredClone(contracts) as Record<string, Record<string, unknown>>;
  Object.assign(shard[HISTORY], fields);
  return testEnv(makeFakeAssets({}, { "contracts/637.json": shard }));
}

function profileWith(employees: unknown) {
  const shard = structuredClone(profiles) as Record<string, Record<string, unknown>>;
  shard[ORG].employees = employees;
  return testEnv(makeFakeAssets({}, { "profiles/a00.json": shard }));
}

describe("the supplier's employees", () => {
  it("reads a count or a dictionary band, and nothing else", () => {
    expect(EMPLOYEE_BANDS).toHaveLength(13);
    for (const ok of ["0", "1", "180", "9999999", ...EMPLOYEE_BANDS]) expect(isEmployees(ok), ok).toBe(true);
    for (const bad of ["", "12345678", "-1", "1.5", "UNKNOWN", "50 to 99 employees", "5000-", "1-9", null, 180, undefined]) {
      expect(isEmployees(bad), String(bad)).toBe(false);
    }
    expect(supplierEmployees({ supplier_employees: "180" })).toBe("180");
    expect(supplierEmployees({ supplier_employees: "180", supplier_withheld: true })).toBeNull();
    expect(supplierEmployees({})).toBeNull();
  });

  it("writes a count and each band in both languages, with the language's digit grouping", () => {
    expect(employeesText("en", "180")).toBe("180");
    expect(nbsp(employeesText("en", "2500"))).toBe("2,500");
    expect(employeesText("en", "self")).toBe("Self-employed");
    expect(employeesText("fr", "self")).toBe("Travailleur autonome");
    expect(employeesText("en", "50-99")).toBe("50 to 99");
    expect(employeesText("fr", "50-99")).toBe("50 à 99");
    expect(nbsp(employeesText("en", "1000-1499"))).toBe("1,000 to 1,499");
    expect(nbsp(employeesText("fr", "1000-1499"))).toBe("1 000 à 1 499");
    expect(nbsp(employeesText("en", "5000+"))).toBe("5,000 and over");
    expect(nbsp(employeesText("fr", "5000+"))).toBe("5 000 et plus");
  });

  it("show on a history record, after the supplier's location, with what the figure is", async () => {
    const html = await read(HISTORY_PATH, historyWith({ supplier_employees: "180" }));
    expect(html).toContain("<dt>Supplier location</dt><dd>Victoria, British Columbia</dd><dt>Supplier's employees</dt><dd>180</dd>");
    expect(html).toContain("as PSPC's contract history gives it for this contract (a count, or a size band in older records).");
    const fr = await read(`${HISTORY_PATH}?lang=fr`, historyWith({ supplier_employees: "1000-1499" }));
    expect(fr).toContain("<dt>Employés du fournisseur</dt><dd>1 000 à 1 499</dd>");
    expect(fr).toContain("tel que l’historique des contrats de SPAC l’indique pour ce contrat");
    expect((await read(HISTORY_PATH, historyWith({ supplier_employees: "self" })))).toContain("<dd>Self-employed</dd>");
    for (const page of [html, fr]) {
      expect(page).not.toContain(EM_DASH);
      expect(page).not.toContain(EN_DASH);
    }
  });

  it("show nothing for a record that gives none, a value of another shape, or a supplier withheld as a person", async () => {
    for (const fields of [{}, { supplier_employees: "lots" }, { supplier_employees: 180 },
      { supplier_employees: "180", supplier_withheld: true, supplier: null, organization_id: null }]) {
      const res = await app.request(HISTORY_PATH, {}, historyWith(fields));
      expect(res.status, JSON.stringify(fields)).toBe(200);
      const html = decode(nbsp(await res.text()));
      expect(html, JSON.stringify(fields)).not.toContain("Supplier's employees");
      expect(html, JSON.stringify(fields)).not.toContain("as PSPC's contract history gives it");
    }
    // The fixture as committed, written before the field.
    expect(await read(HISTORY_PATH, testEnv())).not.toContain("Supplier's employees");
  });

  it("give the profile its newest figure, dated by that contract and linked to its record", async () => {
    const figure = { value: "180", awarded: "2025-06-01", reference: "W8472-000633" };
    expect(profileEmployees({ employees: figure })).toEqual(figure);
    const html = await read(`/organizations/${ORG}`, profileWith(figure));
    expect(html).toContain(
      `<p class="page-note">Employees: 180, as PSPC's contract history gives it for the <a href="${HISTORY_PATH}">contract awarded 2025-06-01</a>.</p>`,
    );
    const fr = await read(`/organizations/${ORG}?lang=fr`, profileWith({ ...figure, value: "50-99" }));
    expect(fr).toContain(`Employés : 50 à 99, selon l’historique des contrats de SPAC pour le <a href="${HISTORY_PATH}">contrat attribué le 2025-06-01</a>.`);
    expect(await read(`/organizations/${ORG}`, profileWith({ ...figure, value: "5000+" }))).toContain("Employees: 5,000 and over, as");
  });

  it("leave the profile as it was without the field or with one of another shape", async () => {
    const plain = await read(`/organizations/${ORG}`, testEnv());
    expect(plain).not.toContain("Employees:");
    for (const bad of [null, "180", { value: "180" }, { value: "180", awarded: "2025-06", reference: "W8472-000633" },
      { value: "UNKNOWN", awarded: "2025-06-01", reference: "W8472-000633" }, { value: "180", awarded: "2025-06-01", reference: "a/b" }]) {
      expect(profileEmployees({ employees: bad }), JSON.stringify(bad)).toBeNull();
      const res = await app.request(`/organizations/${ORG}`, {}, profileWith(bad));
      expect(res.status, JSON.stringify(bad)).toBe(200);
      expect(await res.text(), JSON.stringify(bad)).not.toContain("Employees:");
    }
  });
});

// -- the Indigenous business marks on the radar --------------------------------------

const RADAR_CONTRACT = "dnd-mdn:C-2026-0042";
const RADAR_HISTORY = "W8472-000777";

function radarWith(marks: Record<string, unknown>) {
  const rows = (structuredClone(expiring3m) as Record<string, unknown>[]).map((r) =>
    String(r.reference) in marks ? { ...r, indigenous: marks[String(r.reference)] } : r);
  return testEnv(makeFakeAssets({}, { "expiring/3m/1.json": rows }));
}

// The lead cell of the radar row whose title is given.
function leadCell(html: string, title: string): string {
  const at = html.indexOf(`>${title}</a>`);
  expect(at, title).toBeGreaterThan(0);
  return html.slice(html.lastIndexOf("<td", at), html.indexOf("</td>", at));
}

describe("the Indigenous business marks on a radar row", () => {
  it("read MS, VS and IB, and none for anything else or a supplier withheld as a person", () => {
    expect(indigenousMark({ indigenous: "MS" })).toBe("MS");
    expect(indigenousMark({ indigenous: "VS" })).toBe("VS");
    expect(indigenousMark({ indigenous: "IB" })).toBe("IB");
    for (const v of [undefined, null, "", "NA", "ms", "Y", 1]) expect(indigenousMark({ indigenous: v }), String(v)).toBeNull();
    expect(indigenousMark({ indigenous: "MS", supplier_withheld: true })).toBeNull();
  });

  it("tag the row in the source's terms, beside the radar's other tags", async () => {
    const html = await read("/expiring/3m", radarWith({ [RADAR_CONTRACT]: "MS" }));
    const cell = leadCell(html, "Satellite communications terminal maintenance");
    expect(cell).toContain('<span class="tag" title="As the department reported it in its published contracts">PSIB: Mandatory Set-Aside</span>');
    const vs = leadCell(await read("/expiring/3m", radarWith({ [RADAR_CONTRACT]: "VS" })), "Satellite communications terminal maintenance");
    expect(vs).toContain(">PSIB: Voluntary Set-Aside</span>");
    const ib = leadCell(await read("/expiring/3m", radarWith({ [RADAR_CONTRACT]: "IB" })), "Satellite communications terminal maintenance");
    expect(ib).toContain(">Indigenous business, outside PSIB</span>");
    const fr = await read("/expiring/3m?lang=fr", radarWith({ [RADAR_CONTRACT]: "MS" }));
    expect(fr).toContain('title="Tel que le ministère l’a déclaré dans ses contrats publiés">SAEA : Contrat réservé obligatoire</span>');
    const frIb = await read("/expiring/3m?lang=fr", radarWith({ [RADAR_CONTRACT]: "IB" }));
    expect(frIb).toContain(">Entreprise autochtone, hors SAEA</span>");
    for (const page of [html, fr]) {
      expect(page).not.toContain(EM_DASH);
      expect(page).not.toContain(EN_DASH);
    }
  });

  it("tag nothing on a row without a mark, with another value, or whose supplier is withheld", async () => {
    const html = await read("/expiring/3m", radarWith({ [RADAR_CONTRACT]: "Y", [RADAR_HISTORY]: "MS" }));
    expect(html).not.toContain("PSIB");
    expect(html).not.toContain("Indigenous Business");
    // The window file as committed, written before the field, reads as it did.
    const plain = await read("/expiring/3m", testEnv());
    expect(plain).not.toContain("PSIB");
    expect(FILES["expiring/3m/1.json"]).toBe(expiring3m);
  });
});

// -- the Indigenous business fields on a published contract's page ------------------

const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;
const DFO = 104;
interface Published { k: number; ref: string; wh: 0 | 1; psib?: string | null; ib?: 0 | 1 }
const PUBLISHED: Published[] = [
  { k: 5001, ref: "IND-MS-1", wh: 0, psib: "MS", ib: 0 },
  { k: 5002, ref: "IND-VS-1", wh: 0, psib: "VS", ib: 0 },
  { k: 5003, ref: "IND-IB-1", wh: 0, psib: null, ib: 1 },
  { k: 5004, ref: "IND-NONE-1", wh: 0 },
  // A person's contract: whatever a row says, the page shows neither field.
  { k: 5005, ref: "IND-PERSON-1", wh: 1, psib: "MS", ib: 1 },
];

const INDIGENOUS_DDL = [
  "CREATE TABLE IF NOT EXISTS rec_contract_indigenous (k INTEGER PRIMARY KEY, psib TEXT, ib INTEGER NOT NULL DEFAULT 0)",
];

async function seedPublished(): Promise<void> {
  await applySql(RECORDS, SCHEMA);
  for (const sql of INDIGENOUS_DDL) await RECORDS.prepare(sql).run();
  await RECORDS.batch([
    RECORDS.prepare("DELETE FROM rec_contract_indigenous"),
    RECORDS.prepare("DELETE FROM rec_contracts WHERE dept = 'dfo-mpo'"),
    RECORDS.prepare("INSERT OR REPLACE INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dfo-mpo', 'Fisheries and Oceans Canada', 'Pêches et Océans Canada')").bind(DFO),
    RECORDS.prepare("INSERT OR REPLACE INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', '2026-10-31'), ('rules', '2')"),
    ...PUBLISHED.map((c) => RECORDS.prepare(
      "INSERT INTO rec_contracts (k, dept, ref, pid, bid, oid, wh, cdate, start, endd, value, orig, amend, proc, comp, ctype, gsin, agr, trade, ltr, " +
      "inst, period, bids, so_no, desc_en, desc_fr, com_en, com_fr) VALUES (?, 'dfo-mpo', ?, NULL, ?, NULL, ?, '2026-05-01', '2026-05-01', " +
      "'2027-03-31', 5000000, 5000000, NULL, 'OB', 1, 'S', NULL, NULL, NULL, NULL, 'C', '2026-2027-Q1', 3, NULL, ?, NULL, NULL, NULL)",
    ).bind(c.k, c.ref, DFO, c.wh, `Harbour dredging ${c.ref}`)),
    ...PUBLISHED.filter((c) => c.psib !== undefined).map((c) =>
      RECORDS.prepare("INSERT INTO rec_contract_indigenous (k, psib, ib) VALUES (?, ?, ?)").bind(c.k, c.psib ?? null, c.ib ?? 0)),
  ]);
}

beforeAll(() => seedPublished());

// A D1 binding that counts the batches it runs and their statements.
function counting(db: D1Database): { binding: D1Database; batches: number[] } {
  const batches: number[] = [];
  const binding = {
    prepare: (sql: string) => db.prepare(sql),
    batch: (statements: D1PreparedStatement[]) => {
      batches.push(statements.length);
      return db.batch(statements);
    },
  } as unknown as D1Database;
  return { binding, batches };
}

const contractPage = (ref: string, lang = "", e: object = testEnv()) =>
  read(`${contractPath("dfo-mpo", ref)}${lang ? `?lang=${lang}` : ""}`, e);

describe("the Indigenous business fields on a published contract's page", () => {
  it("show a set-aside under the Procurement Strategy for Indigenous Business, code and term, with its note, from the page's one batch", async () => {
    const { binding, batches } = counting(RECORDS);
    const html = await contractPage("IND-MS-1", "", { ...testEnv(), RECORDS: binding });
    expect(batches).toEqual([3]);
    expect(html).toContain('<dt>Procurement Strategy for Indigenous Business</dt><dd><span class="mono">MS</span> Mandatory Set-Aside</dd>');
    expect(html).toContain("The department reported a set-aside for Indigenous businesses under the Procurement Strategy for Indigenous Business (PSIB) on this contract.");
    expect(html).not.toContain("Indigenous Business excluding PSIB");
    expect(await contractPage("IND-VS-1")).toContain('<span class="mono">VS</span> Voluntary Set-Aside</dd>');
    const fr = await contractPage("IND-MS-1", "fr");
    expect(fr).toContain("<dt>Stratégie d’approvisionnement auprès des entreprises autochtones</dt><dd><span class=\"mono\">MS</span> Contrat réservé obligatoire</dd>");
    expect(fr).toContain("Le ministère a déclaré pour ce contrat un marché réservé aux entreprises autochtones");
    for (const page of [html, fr]) {
      expect(page).not.toContain(EM_DASH);
      expect(page).not.toContain(EN_DASH);
    }
  });

  it("show an Indigenous business outside a set-aside as the source names it", async () => {
    const html = await contractPage("IND-IB-1");
    expect(html).toContain("<dt>Indigenous Business excluding PSIB</dt><dd>Yes</dd>");
    expect(html).toContain("The department reported this contract as awarded to an Indigenous business outside a PSIB set-aside.");
    expect(html).not.toContain("<dt>Procurement Strategy for Indigenous Business</dt>");
    const fr = await contractPage("IND-IB-1", "fr");
    expect(fr).toContain("<dt>Entreprises autochtones excluant le marché réservé en vertu de la SAEA</dt><dd>Oui</dd>");
  });

  it("show neither on a contract that reports neither, nor on a person's contract", async () => {
    for (const ref of ["IND-NONE-1", "IND-PERSON-1"]) {
      const html = await contractPage(ref);
      expect(html, ref).toContain(`Harbour dredging ${ref}`);
      expect(html, ref).not.toContain("Indigenous Business");
      expect(html, ref).not.toContain("Set-Aside");
    }
    expect(await contractPage("IND-PERSON-1")).toContain("Individual, name withheld");
  });

  it("reads the row through the unique index and the table's key, bounded", async () => {
    expect(TABLE_SQL).toContain(PUBLISHED_INDIGENOUS_SQL);
    expect(PUBLISHED_INDIGENOUS_SQL).toMatch(/LIMIT 1$/);
    const steps = ((await RECORDS.prepare(`EXPLAIN QUERY PLAN ${PUBLISHED_INDIGENOUS_SQL}`).bind("dfo-mpo", "IND-MS-1").all()).results ?? [])
      .map((r) => String((r as { detail?: unknown }).detail));
    const text = steps.join("\n");
    expect(steps.filter((s) => /^SCAN /.test(s)), text).toEqual([]);
    expect(text).toContain("rec_contracts_ref");
    expect(text).toMatch(/SEARCH i USING INTEGER PRIMARY KEY/);
  });

  it("reads again without the table on a records database the nightly has not given it yet", async () => {
    await RECORDS.prepare("DROP TABLE rec_contract_indigenous").run();
    try {
      const { binding, batches } = counting(RECORDS);
      const res = await app.request(contractPath("dfo-mpo", "IND-MS-1"), {}, { ...testEnv(), RECORDS: binding });
      expect(res.status).toBe(200);
      const html = decode(nbsp(await res.text()));
      expect(html).toContain("Harbour dredging IND-MS-1");
      expect(html).not.toContain("Procurement Strategy for Indigenous Business");
      // The batch with the table's statement fails, and the page reads again without it.
      expect(batches).toEqual([3, 2]);
    } finally {
      await seedPublished();
    }
  });
});
