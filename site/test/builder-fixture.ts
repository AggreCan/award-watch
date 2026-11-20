// The analytics builder's records (test/builder.test.ts): a small records
// database filled as the nightly sync fills it, the views' summary tables made
// with the pipeline's own GROUP BY, and the builder's cubes counted here, in
// this file, from the same rows by the rules docs/analytics.md gives them
// ("The builder's cubes"), never by the site's code. A cube's figure the page
// shows is then checked against a figure worked out here and against the
// analytics view's own page.
import { env } from "cloudflare:test";
import { orgNumber } from "../src/records_db";
import { applySql } from "./setup";

export const RECORDS = (env as unknown as { RECORDS: D1Database }).RECORDS;
const SCHEMA = (env as unknown as { RECORDS_SCHEMA_SQL: string }).RECORDS_SCHEMA_SQL;

export const PSPC = 101;
export const DND = 102;
export const DFO = 103;
export const BUYER_IDS: Record<number, string> = { [PSPC]: "pwgsc-tpsgc", [DND]: "dnd-mdn", [DFO]: "dfo-mpo" };
// The first is one the profile fixtures hold (profiles-a00.json), so its analytics view has a page to compare with.
export const ORGS = ["org-a000000001", ...Array.from({ length: 6 }, (_, i) => `org-e00000000${i + 2}`)];
export const ORG_NAMES: Record<string, string> = Object.fromEntries(ORGS.map((id, i) => [id, `Builder Org ${i + 1} Ltd.`]));
export const oid = (id: string) => orgNumber(id) as number;

export interface Rec {
  k: number; rk: number; src: number; fy: number; fq: number; bid: number | null; oid: number | null; sid: number | null; extra: 0 | 1;
  cents: number | null; vnote: number; comp: number | null; meth: string | null; ocents: number | null; namd: number | null; ref: string;
}
export const RECS: Rec[] = [];
// The provinces of each record (by its own key, rk), as cube_place reads them; none named is ''.
export const PROVS = new Map<number, string[]>();

let keys = 0;
// One record: its own row, then a row for each further segment (extra = 1), as records_db.record_rows yields them.
function rec(r: Partial<Rec> & Pick<Rec, "src" | "fy" | "fq">, segments: number[] = [], provinces: string[] = []): void {
  const k = ++keys;
  const placed = r.src === 1 || r.src === 2;
  const base: Rec = {
    k, rk: k, bid: PSPC, oid: null, sid: segments[0] ?? null, extra: 0, cents: null, vnote: 0, comp: 1, meth: "OB",
    ocents: null, namd: placed ? 0 : null, ref: `B-${k}`, ...r,
  };
  if (placed && base.ocents === null && r.ocents === undefined) base.ocents = base.cents;
  RECS.push(base);
  for (const sid of segments.slice(1)) RECS.push({ ...base, k: ++keys, rk: k, sid, extra: 1 });
  if (placed) PROVS.set(k, provinces);
}

// PSPC contract history (2), 2022-23 to 2026-27: seven organizations in segment 82, the first two also reaching 43,
// one quarter each a year; a supplier withheld as a person; a value not published; a method not stated; an
// amended contract that grew and one that shrank.
for (let fy = 2022; fy <= 2026; fy++) {
  ORGS.forEach((id, i) => {
    const cents = (8 - i) * 1_000_000 * 100 + fy * 100;
    const segments = i < 2 ? [82, 43] : [82];
    const provinces = i === 0 ? ["ON", "QC"] : i === 1 ? ["BC"] : i === 2 ? [] : ["ON"];
    rec({ src: 2, fy, fq: (i % 4) + 1, oid: oid(id), cents, comp: i === 3 ? 0 : 1, meth: i === 3 ? "TN" : "OB" }, segments, provinces);
  });
  rec({ src: 2, fy, fq: 2, cents: 2_500_000_00, comp: 0, meth: "TN" }, [82], ["ON"]);
  rec({ src: 2, fy, fq: 3, oid: oid(ORGS[4]), cents: null, vnote: 1, comp: null, meth: null }, [82], ["QC"]);
}
rec({ src: 2, fy: 2025, fq: 1, oid: oid(ORGS[0]), cents: 12_000_000_00, ocents: 10_000_000_00, namd: 2 }, [82], ["ON"]);
rec({ src: 2, fy: 2025, fq: 4, oid: oid(ORGS[1]), cents: 4_000_000_00, ocents: 5_000_000_00, namd: 1 }, [43], ["BC"]);
// Fisheries and Oceans (award notices, 1), segment 82 and 43, three organizations.
for (let fy = 2024; fy <= 2026; fy++) {
  rec({ src: 1, fy, fq: 2, bid: DFO, oid: oid(ORGS[0]), cents: 3_000_000_00 + fy }, [82], ["NS"]);
  rec({ src: 1, fy, fq: 3, bid: DFO, oid: oid(ORGS[5]), cents: 1_000_000_00 + fy, comp: 0, meth: "AC" }, [43], ["NS", "NL"]);
  rec({ src: 1, fy, fq: 4, bid: DFO, oid: oid(ORGS[6]), cents: 500_000_00, comp: null, meth: null }, [], []);
}
// PSPC award notices (1) too, so a set of two buyers has two panels in the same source.
for (let fy = 2024; fy <= 2026; fy++) rec({ src: 1, fy, fq: 1, oid: oid(ORGS[2]), cents: 7_000_000_00 }, [82], ["ON"]);
// National Defence: published contracts (3) and a grant (4), no segment.
for (let fy = 2025; fy <= 2026; fy++) rec({ src: 3, fy, fq: 3, bid: DND, oid: oid(ORGS[0]), cents: 1_234_500, comp: 0, meth: "TN", ref: `dnd-mdn:PC-${fy}` });
rec({ src: 4, fy: 2026, fq: 1, bid: DND, oid: oid(ORGS[1]), cents: 4_000_000, comp: null, meth: null, ref: "dnd-mdn:GR-1" });

// -- the cubes, counted here ---------------------------------------------------------------------

// The median records_db.value_figures keeps: the middle value, or the floor of the mean of the two middle values.
export function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.floor((v[mid - 1] + v[mid]) / 2);
}

const sumOrNull = (vs: (number | null)[]) => {
  const xs = vs.filter((v): v is number => v !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
};

export type Cell = Record<string, number | null>;

// A cell's figures from its rows (docs/analytics.md, "The columns of cube_bs").
export function cellOf(rows: Rec[]): Cell {
  const pos = rows.filter((r) => (r.cents ?? 0) > 0);
  const amended = rows[0] && (rows[0].src === 1 || rows[0].src === 2);
  const compared = rows.filter((r) => (r.namd ?? 0) > 0 && (r.ocents ?? 0) > 0 && r.cents !== null);
  const byOrg = new Map<number, Rec[]>();
  for (const r of rows) if (r.oid !== null) byOrg.set(r.oid, [...(byOrg.get(r.oid) ?? []), r]);
  const ranked = [...byOrg].map(([o, rs]) => ({ o, n: rs.length, c: sumOrNull(rs.map((r) => r.cents)) }))
    .sort((a, b) => (b.c ?? -Infinity) - (a.c ?? -Infinity) || b.n - a.n || a.o - b.o);
  const top = (k: number) => (ranked.length ? ranked.slice(0, k).reduce((s, x) => s + (x.c ?? 0), 0) : null);
  return {
    n: rows.length, cents: sumOrNull(rows.map((r) => r.cents)), n_no_value: rows.filter((r) => r.vnote === 1).length,
    n_nc: rows.filter((r) => r.comp === 0).length, n_unstated: rows.filter((r) => r.comp === null).length,
    n_pos: pos.length, pos: sumOrNull(pos.map((r) => r.cents)), pos_nc: sumOrNull(pos.filter((r) => r.comp === 0).map((r) => r.cents)),
    pos_unstated: sumOrNull(pos.filter((r) => r.comp === null).map((r) => r.cents)), med: pos.length ? median(pos.map((r) => r.cents as number)) : null,
    n_amended: amended ? rows.filter((r) => (r.namd ?? 0) > 0).length : null, n_compared: amended ? compared.length : null,
    n_grew: amended ? compared.filter((r) => (r.cents as number) > (r.ocents as number)).length : null,
    first_cents: amended ? sumOrNull(compared.map((r) => r.ocents)) : null, last_cents: amended ? sumOrNull(compared.map((r) => r.cents)) : null,
    n_orgs: byOrg.size, top1: top(1), top5: top(5), top10: top(10),
  };
}

const groupBy = <T,>(rows: T[], key: (r: T) => string | null): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k !== null) out.set(k, [...(out.get(k) ?? []), r]);
  }
  return out;
};

// cube_bs: a buyer in a segment (every row of both), a buyer (each record once), a segment (every row), every record (each once).
export function cubeBs(): { bid: number; sid: number; src: number; fy: number; cell: Cell }[] {
  const kinds: [(r: Rec) => boolean, (r: Rec) => [number, number]][] = [
    [(r) => r.bid !== null && r.sid !== null, (r) => [r.bid as number, r.sid as number]],
    [(r) => r.bid !== null && r.extra === 0, (r) => [r.bid as number, 0]],
    [(r) => r.sid !== null, (r) => [0, r.sid as number]],
    [(r) => r.extra === 0, () => [0, 0]],
  ];
  return kinds.flatMap(([take, cell]) => [...groupBy(RECS.filter(take), (r) => [...cell(r), r.src, r.fy].join(":"))]
    .map(([k, rows]) => {
      const [bid, sid, src, fy] = k.split(":").map(Number);
      return { bid, sid, src, fy, cell: cellOf(rows) };
    }));
}

// cube_place: award notices and history, each row once per province it names ('' for none), for a buyer (sid 0), a
// segment (bid 0) or every record.
export function cubePlace(): { bid: number; sid: number; prov: string; src: number; fy: number; cell: Cell }[] {
  const rows = RECS.filter((r) => r.src === 1 || r.src === 2).flatMap((r) => {
    const provs = PROVS.get(r.rk) ?? [];
    return (provs.length ? provs : [""]).map((prov) => ({ r, prov }));
  });
  const kinds: [(x: { r: Rec }) => boolean, (r: Rec) => [number, number]][] = [
    [({ r }) => r.bid !== null && r.extra === 0, (r) => [r.bid as number, 0]],
    [({ r }) => r.sid !== null, (r) => [0, r.sid as number]],
    [({ r }) => r.extra === 0, () => [0, 0]],
  ];
  return kinds.flatMap(([take, cell]) => [...groupBy(rows.filter(take), ({ r, prov }) => [...cell(r), prov, r.src, r.fy].join(":"))]
    .map(([k, list]) => {
      const [bid, sid, prov, src, fy] = k.split(":");
      return { bid: Number(bid), sid: Number(sid), prov, src: Number(src), fy: Number(fy), cell: cellOf(list.map((x) => x.r)) };
    }));
}

// The contracts ending (rec_due, records_db.due_rows for the data date 2026-10-31, 2026-27 Q3) and the radar's
// twelve months (rec_expiring): PSPC's in segment 82 and 43, DFO's in 82.
export const DUE = [
  { bid: PSPC, sid: null, fy: 2026, fq: 3, n: 2, cents: 7_500_000_00, nv: 0 },
  { bid: PSPC, sid: null, fy: 2027, fq: 1, n: 3, cents: 1_250_000_00, nv: 1 },
  { bid: DFO, sid: null, fy: 2026, fq: 4, n: 1, cents: 100_000_00, nv: 0 },
  { bid: null, sid: 82, fy: 2026, fq: 4, n: 4, cents: 2_000_000_00, nv: 0 },
  { bid: null, sid: 43, fy: 2027, fq: 2, n: 1, cents: 50_000_00, nv: 0 },
];
export const EXPIRING = [
  { endd: "2026-11-15", buyer: "pwgsc-tpsgc", segs: " 82 43 ", cents: 3_000_000_00, nv: 0 },
  { endd: "2027-01-20", buyer: "pwgsc-tpsgc", segs: " 82 ", cents: 1_000_000_00, nv: 0 },
  { endd: "2027-05-01", buyer: "pwgsc-tpsgc", segs: " 82 ", cents: null, nv: 1 },
  { endd: "2027-09-30", buyer: "pwgsc-tpsgc", segs: " 82 ", cents: 900_00, nv: 0 },
  { endd: "2026-12-01", buyer: "dfo-mpo", segs: " 82 ", cents: 2_000_000_00, nv: 0 },
];

// The whole database, as the sync leaves it; cubes false leaves the builder's three tables out (a database the
// nightly has not given them yet), cubeDate null leaves cube_meta empty.
export async function seedBuilder(o: { state?: string; cubes?: boolean; cubeDate?: string | null } = {}): Promise<void> {
  const { state = "ready", cubes = true, cubeDate = "2026-10-30" } = o;
  await applySql(RECORDS, SCHEMA);
  const tables = ["records", "rec_orgs", "rec_buyers", "rec_buyer_quarters", "rec_segment_years", "rec_buyer_years", "rec_due", "rec_expiring", "rec_meta"];
  await RECORDS.batch(tables.map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  if (!cubes) await RECORDS.batch(["cube_bs", "cube_place", "cube_meta"].map((t) => RECORDS.prepare(`DROP TABLE IF EXISTS ${t}`)));
  else await RECORDS.batch(["cube_bs", "cube_place", "cube_meta"].map((t) => RECORDS.prepare(`DELETE FROM ${t}`)));
  const insert = "INSERT INTO records (k, src, fy, fq, bid, oid, sid, extra, cents, vnote, comp, meth, ocents, namd, ref, title) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  for (let i = 0; i < RECS.length; i += 50) {
    await RECORDS.batch(RECS.slice(i, i + 50).map((r) => RECORDS.prepare(insert)
      .bind(r.k, r.src, r.fy, r.fq, r.bid, r.oid, r.sid, r.extra, r.cents, r.vnote, r.comp, r.meth, r.ocents, r.namd, r.ref, `Record ${r.rk}`)));
  }
  const buyerYears = [...groupBy(RECS.filter((r) => r.extra === 0 && r.bid !== null), (r) => `${r.bid}:${r.src}:${r.fy}`)]
    .map(([k, rows]) => [k.split(":").map(Number), cellOf(rows)] as const).filter(([, c]) => (c.n_pos ?? 0) > 0);
  const segmentYears = [...groupBy(RECS.filter((r) => r.sid !== null), (r) => `${r.sid}:${r.src}:${r.fy}`)]
    .map(([k, rows]) => [k.split(":").map(Number), cellOf(rows), new Set(rows.map((r) => r.bid)).size] as const);
  const stmts: D1PreparedStatement[] = [
    ...ORGS.map((id) => RECORDS.prepare("INSERT INTO rec_orgs (oid, name) VALUES (?, ?)").bind(oid(id), ORG_NAMES[id])),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'pwgsc-tpsgc', 'Public Services and Procurement Canada', 'Services publics et Approvisionnement Canada')").bind(PSPC),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dnd-mdn', 'National Defence', 'Défense nationale')").bind(DND),
    RECORDS.prepare("INSERT INTO rec_buyers (bid, id, name_en, name_fr) VALUES (?, 'dfo-mpo', 'Fisheries and Oceans Canada', 'Pêches et Océans Canada')").bind(DFO),
    RECORDS.prepare("INSERT INTO rec_buyer_quarters (bid, src, fy, fq, n, cents, n_no_value) SELECT bid, src, fy, fq, COUNT(*), SUM(cents), " +
      "SUM(CASE WHEN vnote = 1 THEN 1 ELSE 0 END) FROM records WHERE extra = 0 AND bid IS NOT NULL AND fy IS NOT NULL GROUP BY bid, src, fy, fq"),
    ...segmentYears.map(([[sid, src, fy], c, buyers]) => RECORDS.prepare(
      "INSERT INTO rec_segment_years (sid, src, fy, n, cents, n_no_value, n_buyers, n_orgs, n_pos, pos, med) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(sid, src, fy, c.n, c.cents, c.n_no_value, buyers, c.n_orgs, c.n_pos, c.pos, c.med)),
    ...buyerYears.map(([[bid, src, fy], c]) =>
      RECORDS.prepare("INSERT INTO rec_buyer_years (bid, src, fy, n_pos, pos, med) VALUES (?, ?, ?, ?, ?, ?)").bind(bid, src, fy, c.n_pos, c.pos, c.med)),
    ...DUE.map((d) => RECORDS.prepare("INSERT INTO rec_due (bid, sid, fy, fq, n, cents, n_no_value) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(d.bid, d.sid, d.fy, d.fq, d.n, d.cents, d.nv)),
    ...EXPIRING.map((e, i) => RECORDS.prepare("INSERT INTO rec_expiring (k, endd, oid, buyer, client, segs, kind, comp, cad, cents, nv, so, m31, j) " +
      "VALUES (?, ?, NULL, ?, NULL, ?, 2, 1, ?, ?, ?, 0, 0, '{}')").bind(9000 + i, e.endd, e.buyer, e.segs, e.cents, e.cents, e.nv)),
    RECORDS.prepare("INSERT INTO rec_meta (key, value) VALUES ('state', ?), ('as_of', '2026-10-31'), ('rules', '2')").bind(state),
  ];
  if (cubes) {
    const cols = ["n", "cents", "n_no_value", "n_nc", "n_unstated", "n_pos", "pos", "pos_nc", "pos_unstated", "med", "n_amended", "n_compared", "n_grew",
      "first_cents", "last_cents", "n_orgs", "top1", "top5", "top10"];
    let k = 0;
    for (const x of cubeBs()) {
      stmts.push(RECORDS.prepare(`INSERT INTO cube_bs (k, bid, sid, src, fy, ${cols.join(", ")}) VALUES (?, ?, ?, ?, ?, ${cols.map(() => "?").join(", ")})`)
        .bind(++k, x.bid, x.sid, x.src, x.fy, ...cols.map((c) => x.cell[c] ?? null)));
    }
    const pcols = ["n", "cents", "n_nc", "n_pos", "pos", "med"];
    for (const x of cubePlace()) {
      stmts.push(RECORDS.prepare(`INSERT INTO cube_place (k, bid, sid, prov, src, fy, ${pcols.join(", ")}) VALUES (?, ?, ?, ?, ?, ?, ${pcols.map(() => "?").join(", ")})`)
        .bind(++k, x.bid, x.sid, x.prov, x.src, x.fy, ...pcols.map((c) => x.cell[c] ?? null)));
    }
    if (cubeDate) stmts.push(RECORDS.prepare("INSERT INTO cube_meta (k, as_of) VALUES (1, ?)").bind(cubeDate));
  }
  for (let i = 0; i < stmts.length; i += 80) await RECORDS.batch(stmts.slice(i, i + 80));
}
