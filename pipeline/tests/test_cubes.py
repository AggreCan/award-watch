"""The analytics builder's cubes (cubes.py, docs/analytics.md "The builder's cubes"): every cell of both cubes, every
column, against a direct computation over the records the records database holds; the summary rows the fixed views
read; one source a row; a notice in two segments and two provinces counted in each and once in the totals; medians and
the largest organizations' values per fiscal year; a supplier withheld as a person in every total and never an
organization; the guard; the same rows from two runs and nothing sent the second night; a changed record changing only
its own cells and their rollups; a failure that leaves last night's rows; the stage's log row; and the tables' way to
the records database, with its count check and the indexes the builder's statements will read through. The names,
references and amounts are made up; every date is the fixture's."""

from __future__ import annotations

import json
import math
import re
import sqlite3
import statistics
from collections import defaultdict
from datetime import timedelta
from pathlib import Path

import pytest

from awardwatch_pipeline import cli, cubes, organizations
from awardwatch_pipeline import records_db as rd
from awardwatch_pipeline.db import get_meta, set_meta
from awardwatch_pipeline.normalize import PROVINCE_CODES
from export_seed import ACME, DAY, FOREIGN, NORTH, STAMP, TODAY, award, seed

PSPC, DND, NEVER = "pwgsc-tpsgc", "dnd-mdn", "never-buys"
WORDS = ("Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo", "Lima")
SUPPLIER = {w: f"{w} Widgets Inc." for w in WORDS}
BS = rd.CUBE_BS.columns
PLACE = rd.CUBE_PLACE.columns
FIGURES = BS[4:]
PLACE_FIGURES = PLACE[5:]
RECORD_COLUMNS = ("k", "src", "fy", "bid", "oid", "sid", "extra", "cents", "vnote", "comp", "ocents", "namd")


# -- the fixture --------------------------------------------------------------------------


def places(conn: sqlite3.Connection, table: str, ref: str, stated: list[str], derived: list[str] | None) -> None:
    conn.execute(f"UPDATE {table} SET provinces = ?, provinces_derived = ? WHERE reference = ?",
                 (json.dumps(stated), json.dumps(derived) if derived else None, ref))


def history(conn: sqlite3.Connection, ref: str, amendment: int, supplier: str | None, *, value: float | None, awarded: str,
            client: str | None = DND, codes: tuple[str, ...] = ("72101500",), competitive: int | None = 1,
            currency: str = "CAD", stated: tuple[str, ...] = (), derived: tuple[str, ...] = ()) -> None:
    """One version of a PSPC contract history record (buyer PSPC, client as given); supplier None is withheld."""
    oid = None if supplier is None else organizations.upsert(conn, supplier, source="history")
    conn.execute(
        "INSERT INTO contract_history (reference, amendment, title_en, awarded, published, amount, total_value, currency, "
        "status, competitive, supplier_raw, organization_id, supplier_withheld, buyer_id, client_id, provinces, "
        "provinces_derived, source_file, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, "
        "?, ?, 'history.csv', ?, ?)",
        (ref, amendment, f"Record {ref}", awarded, awarded, value, value, currency, competitive, supplier, oid,
         1 if supplier is None else 0, PSPC, client, json.dumps(list(stated)), json.dumps(list(derived)) if derived else None,
         DAY, DAY))
    conn.executemany("INSERT INTO history_codes (reference, amendment, unspsc) VALUES (?, ?, ?)",
                     [(ref, amendment, c) for c in codes])


def published(conn: sqlite3.Connection, ref: str, supplier: str | None, *, value: float | None, day: str, comp: int | None = 1,
              proc: str | None = "OB", amendment: float | None = None) -> None:
    """One published contract row of National Defence; supplier None is withheld; an amendment row carries its own value."""
    oid = None if supplier is None else organizations.upsert(conn, supplier, source="contracts")
    conn.execute(
        "INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, vendor_withheld, buyer_id, contract_date, "
        "value, original_value, amendment_value, solicitation_procedure, competitive, instrument_type, organization_id, "
        "loaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (DND, ref, f"P-{ref}", supplier, 1 if supplier is None else 0, DND, day, value, value if amendment is None else None,
         amendment, proc, comp, "C" if amendment is None else "A", oid, STAMP))


def grant(conn: sqlite3.Connection, ref: str, recipient: str | None, *, value: float | None, start: str) -> None:
    """One agreement of PSPC; recipient None is a person, withheld."""
    oid = None if recipient is None else organizations.upsert(conn, recipient, source="grants")
    conn.execute(
        "INSERT INTO grants (owner_org, reference, amendment, agreement_type, recipient_type, legal_name, recipient_withheld, "
        "value, start, buyer_id, organization_id, loaded_at) VALUES (?, ?, 0, 'G', ?, ?, ?, ?, ?, ?, ?, ?)",
        (PSPC, ref, "P" if recipient is None else "N", recipient, 1 if recipient is None else 0, value, start, PSPC, oid, STAMP))


def build_fixture(conn: sqlite3.Connection) -> None:
    """The export seed and, beside it, the cases the cubes must count."""
    seed(conn)
    set_meta(conn, "data_as_of", DAY)
    # 2024-25, PSPC, segment 81: twelve organizations, so the ten largest leave some out. Charlie and Delta are level
    # on value, Delta ahead on records; Lima published no value and ranks last; Echo's method is not stated; a supplier
    # withheld as a person holds more than any of them. The seed adds Acme (5,000) and Overseas Optics (euros).
    values = {"Alpha": 12_000.0, "Bravo": 11_000.0, "Charlie": 10_000.0, "Echo": 9_000.0, "Foxtrot": 8_000.0, "Golf": 7_000.0,
              "Hotel": 6_000.0, "India": 5_000.0, "Juliet": 4_000.0, "Kilo": 3_000.0}
    for word, value in values.items():
        award(conn, f"AW-{word}", 0, SUPPLIER[word], value=value, awarded="2024-06-01", competitive=None if word == "Echo" else 1)
    award(conn, "AW-Delta-1", 0, SUPPLIER["Delta"], value=5_000.0, awarded="2024-06-03")
    award(conn, "AW-Delta-2", 0, SUPPLIER["Delta"], value=5_000.0, awarded="2024-06-04")
    award(conn, "AW-Lima", 0, SUPPLIER["Lima"], value=None, awarded="2024-06-05")
    award(conn, "AW-PERSON", 0, None, value=50_000.0, withheld=True, awarded="2024-07-01")
    # 2025-26, PSPC, segment 81: Bravo holds the most that year.
    award(conn, "AW-Bravo-25", 0, SUPPLIER["Bravo"], value=30_000.0, awarded="2025-06-01")
    award(conn, "AW-Alpha-25", 0, SUPPLIER["Alpha"], value=10_000.0, awarded="2025-07-01")
    award(conn, "AW-Alpha-26", 0, SUPPLIER["Alpha"], value=2_000.0, awarded="2025-08-01")
    # National Defence, 2025-26: a notice in two segments (43 and 72) and three provinces (two stated, one derived).
    award(conn, "AW-TWO", 0, NORTH, value=40_000.0, buyer=DND, codes=("43211500", "72101500"), competitive=0, awarded="2025-10-01")
    places(conn, "awards", "AW-TWO", ["ON", "QC"], ["BC"])
    # Amendments: a value that fell, and a first value of zero (amended, never compared).
    award(conn, "AW-FELL", 0, ACME, value=60_000.0, buyer=DND, codes=("72101500",), awarded="2025-11-01")
    award(conn, "AW-FELL", 1, ACME, value=45_000.0, buyer=DND, codes=("72101500",), awarded="2025-11-01")
    award(conn, "AW-ZERO", 0, NORTH, value=0.0, buyer=DND, codes=("72101500",), awarded="2025-12-01")
    award(conn, "AW-ZERO", 1, NORTH, value=10_000.0, buyer=DND, codes=("72101500",), awarded="2025-12-01")
    # 2026-27, PSPC: an award date after the data date (the publication date counts), a notice placed only by a derived
    # province, one placed nowhere, one naming a code that is no province, one flagged, one in another currency.
    award(conn, "AW-FUTURE", 0, ACME, value=8_000.0, awarded="2029-08-31", published="2026-08-31")
    places(conn, "awards", "AW-FUTURE", [], ["NU"])
    award(conn, "AW-NOWHERE", 0, ACME, value=3_000.0, awarded="2026-05-01")
    places(conn, "awards", "AW-NOWHERE", [], None)
    award(conn, "AW-ODD", 0, NORTH, value=1_000.0, awarded="2026-05-02")
    places(conn, "awards", "AW-ODD", ["XX", "YT"], ["ZZ"])
    award(conn, "AW-FLAG", 0, NORTH, value=9_000.0, awarded="2026-05-03")
    conn.execute("INSERT INTO value_flags (kind, key, rule, computed_at) VALUES ('award', 'AW-FLAG', 'other_source', ?)", (STAMP,))
    award(conn, "AW-USD", 0, FOREIGN, value=7_000.0, currency="USD", awarded="2026-05-04")
    # No date at all: no fiscal year, so no cell, under a buyer with no other record.
    award(conn, "AW-NODATE", 0, ACME, value=1_000.0, buyer=NEVER, awarded=None, published=None)
    # History, 2025-26: two segments placed by derived provinces and amended down; no client (PSPC's own), method not
    # stated; another currency; a supplier withheld as a person.
    history(conn, "H-TWO", 0, NORTH, value=100_000.0, awarded="2025-09-01", codes=("43211500", "81111500"), derived=("NS", "PE"))
    history(conn, "H-TWO", 1, NORTH, value=80_000.0, awarded="2025-09-01", codes=("43211500", "81111500"), derived=("NS", "PE"))
    history(conn, "H-OWN", 0, ACME, value=20_000.0, awarded="2025-09-02", client=None, competitive=None, stated=("BC",))
    history(conn, "H-USD", 0, FOREIGN, value=5_000.0, awarded="2025-09-03", currency="USD")
    history(conn, "H-PERSON", 0, None, value=20_000.0, awarded="2025-09-04")
    # The only record of segment 25 that year: a supplier withheld as a person, so its cells name no organization.
    history(conn, "H-ALONE", 0, None, value=6_000.0, awarded="2025-09-05", codes=("25101500",))
    # Published contracts, National Defence, 2025-26: an amendment that lowers the value, no value, a person, no method.
    published(conn, "C-NEG", NORTH, value=95_000.0, day="2025-08-01", comp=0, proc="TN", amendment=-5_000.0)
    published(conn, "C-NOVAL", FOREIGN, value=None, day="2025-09-01")
    published(conn, "C-PERSON", None, value=9_000.0, day="2025-10-01")
    published(conn, "C-UNSTATED", ACME, value=12_000.0, day="2025-11-01", comp=None, proc=None)
    # Grants, PSPC, 2025-26: one with no value; one to a person, which is in no table at all.
    grant(conn, "G-2", ACME, value=20_000.0, start="2025-05-01")
    grant(conn, "G-NOVAL", NORTH, value=None, start="2025-06-01")
    grant(conn, "G-PERSON", None, value=4_000.0, start="2025-07-01")
    conn.commit()


@pytest.fixture
def rich(conn):
    build_fixture(conn)
    return conn


# -- the records database's stand-in and the night, as test_records_db.py runs them ----------------------


def d1() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.executescript(rd.SCHEMA_PATH.read_text(encoding="utf-8"))
    return db


def counts(db: sqlite3.Connection) -> dict[str, int]:
    return dict(zip((t.name for t in rd.TABLES), db.execute(rd.COUNT_SQL).fetchone()))


def night(conn: sqlite3.Connection, out: Path, db: sqlite3.Connection) -> dict:
    """records-sync, the apply, the count check, finish.sql and records-synced, as the workflow runs them."""
    manifest = rd.sync(conn, out, today=DAY)
    for name in manifest["batches"]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    db.commit()
    assert rd.count_check(rd.expected_counts(manifest), counts(db)) is None
    db.executescript((out / rd.FINISH).read_text(encoding="utf-8"))
    rd.record_sync(conn, manifest)
    return manifest


def pipeline_rows(conn: sqlite3.Connection) -> tuple[list, list]:
    return ([tuple(r) for r in conn.execute("SELECT * FROM cube_bs ORDER BY k")],
            [tuple(r) for r in conn.execute("SELECT * FROM cube_place ORDER BY k")])


def cube(db: sqlite3.Connection, table: rd.Table, width: int) -> dict[tuple, dict]:
    """A cube's rows by cell (the first width columns), each checked against its key."""
    out = {}
    for row in db.execute(f"SELECT {', '.join(table.written)} FROM {table.name}"):
        cell, values = tuple(row[1:width + 1]), dict(zip(table.columns, row[1:]))
        assert row[0] == rd.key_of(f"{'bs' if table is rd.CUBE_BS else 'pl'}:{':'.join(str(v) for v in cell)}"), cell
        out[cell] = values
    return out


# -- the direct computation, apart from cubes.py ------------------------------------------------


def _sum(values) -> int | None:
    values = list(values)
    return sum(values) if values else None


def figures(rows: list[dict], src: int) -> dict:
    """Every column of a cube_bs cell from its records, as the views' statements define each."""
    pos = [r["cents"] for r in rows if r["cents"] is not None and r["cents"] > 0]
    out = {
        "n": len(rows),
        "cents": _sum(r["cents"] for r in rows if r["cents"] is not None),
        "n_no_value": sum(r["vnote"] == rd.NO_VALUE for r in rows),
        "n_nc": sum(r["comp"] == 0 for r in rows),
        "n_unstated": sum(r["comp"] is None for r in rows),
        "n_pos": len(pos),
        "pos": _sum(pos),
        "pos_nc": _sum(r["cents"] for r in rows if r["comp"] == 0 and (r["cents"] or 0) > 0),
        "pos_unstated": _sum(r["cents"] for r in rows if r["comp"] is None and (r["cents"] or 0) > 0),
        # The middle value, or the floor of the mean of the two middle values.
        "med": math.floor(statistics.median(pos)) if pos else None,
    }
    if src in (rd.SOURCES["awards"], rd.SOURCES["history"]):
        compared = [r for r in rows if (r["namd"] or 0) > 0 and (r["ocents"] or 0) > 0 and r["cents"] is not None]
        out.update(n_amended=sum((r["namd"] or 0) > 0 for r in rows), n_compared=len(compared),
                   n_grew=sum(r["cents"] > r["ocents"] for r in compared), first_cents=_sum(r["ocents"] for r in compared),
                   last_cents=_sum(r["cents"] for r in compared))
    else:
        out.update(n_amended=None, n_compared=None, n_grew=None, first_cents=None, last_cents=None)
    held: dict[int, list] = {}
    for r in rows:
        if r["oid"] is not None:
            n, c = held.get(r["oid"], (0, None))
            held[r["oid"]] = (n + 1, c if r["cents"] is None else (c or 0) + r["cents"])
    # The suppliers' order: value (none last), then records, then number; a value of none adds nothing.
    ranked = sorted(held.items(), key=lambda kv: (kv[1][1] is None, -(kv[1][1] or 0), -kv[1][0], kv[0]))
    out["n_orgs"] = len(held)
    for t in (1, 5, 10):
        out[f"top{t}"] = sum(c or 0 for _, (_, c) in ranked[:t]) if ranked else None
    return out


def records_of(db: sqlite3.Connection) -> list[dict]:
    return [dict(zip(RECORD_COLUMNS, r)) for r in db.execute(f"SELECT {', '.join(RECORD_COLUMNS)} FROM records")]


def direct_bs(records: list[dict]) -> dict[tuple, dict]:
    cells: dict[tuple, list] = defaultdict(list)
    for r in records:
        if r["fy"] is None:
            continue
        at = (r["src"], r["fy"])
        if r["bid"] is not None and r["sid"] is not None:
            cells[(r["bid"], r["sid"], *at)].append(r)
        if r["bid"] is not None and r["extra"] == 0:
            cells[(r["bid"], 0, *at)].append(r)
        if r["sid"] is not None:
            cells[(0, r["sid"], *at)].append(r)
        if r["extra"] == 0:
            cells[(0, 0, *at)].append(r)
    return {cell: figures(rows, cell[2]) for cell, rows in cells.items()}


def owners(conn: sqlite3.Connection) -> dict[int, tuple[str, str]]:
    """Every key a notice's rows can carry (its own, and one for each further segment), with its table and reference."""
    out = {}
    for kind, table in (("award", "awards"), ("history", "contract_history")):
        for (ref,) in conn.execute(f"SELECT DISTINCT reference FROM {table}"):
            out[rd.key_of(f"{kind}:{ref}")] = (table, ref)
            for sid in range(10, 100):
                out[rd.key_of(f"{kind}:{ref}#{sid}")] = (table, ref)
    return out


def provinces(conn: sqlite3.Connection) -> dict[tuple[str, str], list[str]]:
    """The newest version's stated and derived provinces, the thirteen codes only, '' for none."""
    out = {}
    for table in ("awards", "contract_history"):
        for ref, stated, derived in conn.execute(
                f"SELECT a.reference, a.provinces, a.provinces_derived FROM {table} a "
                f"WHERE a.amendment = (SELECT MAX(b.amendment) FROM {table} b WHERE b.reference = a.reference)"):
            codes = set(json.loads(stated or "[]")) | set(json.loads(derived or "[]"))
            out[(table, ref)] = sorted(codes & PROVINCE_CODES) or [""]
    return out


def direct_place(conn: sqlite3.Connection, records: list[dict]) -> dict[tuple, dict]:
    owner, provs = owners(conn), provinces(conn)
    cells: dict[tuple, list] = defaultdict(list)
    for r in records:
        if r["fy"] is None or r["src"] not in (rd.SOURCES["awards"], rd.SOURCES["history"]):
            continue
        for prov in provs[owner[r["k"]]]:
            at = (prov, r["src"], r["fy"])
            if r["bid"] is not None and r["extra"] == 0:
                cells[(r["bid"], 0, *at)].append(r)
            if r["sid"] is not None:
                cells[(0, r["sid"], *at)].append(r)
            if r["extra"] == 0:
                cells[(0, 0, *at)].append(r)
    return {cell: {c: f[c] for c in PLACE_FIGURES} for cell, rows in cells.items() for f in [figures(rows, cell[3])]}


@pytest.fixture
def synced(rich, tmp_path):
    """The stage run on the fixture and its night: the pipeline database and the records database's stand-in."""
    cubes.run(rich, today=TODAY)
    db = d1()
    night(rich, tmp_path / "records", db)
    return rich, db


# -- each cell against the records ------------------------------------------------------------


def test_each_cell_of_both_cubes_equals_a_direct_computation_over_the_records(synced):
    conn, db = synced
    records = records_of(db)
    got, want = cube(db, rd.CUBE_BS, 4), direct_bs(records)
    assert set(got) == set(want)
    for cell, columns in want.items():
        assert {c: got[cell][c] for c in FIGURES} == columns, cell
    places_got, places_want = cube(db, rd.CUBE_PLACE, 5), direct_place(conn, records)
    assert set(places_got) == set(places_want)
    for cell, columns in places_want.items():
        assert {c: places_got[cell][c] for c in PLACE_FIGURES} == columns, cell
    # The fixture reaches what the columns are for: more than ten organizations in a cell, an even count of values,
    # a value not published, a negative value, a method not stated, a value that fell, a province derived, none named.
    assert max(v["n_orgs"] for v in got.values()) > 10
    assert any(v["n_pos"] % 2 == 0 and v["n_pos"] for v in got.values())
    assert any(v["n_no_value"] for v in got.values()) and any((r["cents"] or 0) < 0 for r in records)
    assert any(v["pos"] is not None and v["cents"] is not None and v["pos"] > v["cents"] for v in got.values())
    assert any(v["n_unstated"] and v["src"] != rd.SOURCES["grants"] for v in got.values())
    assert any(v["n_compared"] and v["n_grew"] < v["n_compared"] for v in got.values())
    assert {"", "NU", "NS", "PE", "YT"} <= {cell[2] for cell in places_got} and "XX" not in {cell[2] for cell in places_got}


def test_the_cubes_hold_the_figures_the_views_summary_rows_hold(synced):
    """A buyer's cells (sid 0) and a segment's (bid 0) against the rows the fixed views read: rec_buyer_quarters
    added over the year, rec_buyer_years, and rec_segment_years."""
    _, db = synced
    got = cube(db, rd.CUBE_BS, 4)
    quarters = {(b, s, y): (n, c, nv) for b, s, y, n, c, nv in db.execute(
        "SELECT bid, src, fy, SUM(n), SUM(cents), SUM(n_no_value) FROM rec_buyer_quarters GROUP BY bid, src, fy")}
    buyers = {(b, s, y): v for (b, sid, s, y), v in got.items() if b and not sid}
    assert {k: (v["n"], v["cents"], v["n_no_value"]) for k, v in buyers.items()} == quarters
    values = {(b, s, y): (n, pos, med) for b, s, y, n, pos, med in db.execute("SELECT bid, src, fy, n_pos, pos, med FROM rec_buyer_years")}
    assert {k: (v["n_pos"], v["pos"], v["med"]) for k, v in buyers.items() if v["n_pos"]} == values
    segments = {(sid, s, y): v for (b, sid, s, y), v in got.items() if sid and not b}
    years = {(g, s, y): (n, c, nv, no, npos, pos, med) for g, s, y, n, c, nv, no, npos, pos, med in db.execute(
        "SELECT sid, src, fy, n, cents, n_no_value, n_orgs, n_pos, pos, med FROM rec_segment_years")}
    assert {k: tuple(v[c] for c in ("n", "cents", "n_no_value", "n_orgs", "n_pos", "pos", "med")) for k, v in segments.items()} == years


def test_one_source_a_row_and_never_two_added(synced):
    _, db = synced
    got = cube(db, rd.CUBE_BS, 4)
    assert {cell[2] for cell in got} == set(rd.SOURCES.values())
    # National Defence in 2025-26 has award notices and published contracts: a row for each, each its own source's.
    dnd = rd.buyer_number(DND)
    sums = dict(db.execute("SELECT src, SUM(cents) FROM records WHERE bid = ? AND fy = 2025 AND extra = 0 GROUP BY src", (dnd,)))
    assert len(sums) >= 2
    for src, cents in sums.items():
        assert got[(dnd, 0, src, 2025)]["cents"] == cents
    # Published contracts and grants carry no segment and number no versions.
    for cell, v in got.items():
        if cell[2] in (rd.SOURCES["contracts"], rd.SOURCES["grants"]):
            assert cell[1] == 0 and {v[c] for c in ("n_amended", "n_compared", "n_grew", "first_cents", "last_cents")} == {None}, cell
    assert {cell[3] for cell in cube(db, rd.CUBE_PLACE, 5)} == {rd.SOURCES["awards"], rd.SOURCES["history"]}


def test_a_notice_in_two_segments_and_three_provinces_counts_in_each_and_once_in_the_totals(synced):
    _, db = synced
    got, place = cube(db, rd.CUBE_BS, 4), cube(db, rd.CUBE_PLACE, 5)
    dnd, award_src = rd.buyer_number(DND), rd.SOURCES["awards"]
    # AW-TWO (40,000, segments 43 and 72, ON and QC stated, BC derived) beside AW-1, AW-FELL and AW-ZERO (segment 72).
    assert got[(dnd, 43, award_src, 2025)]["n"] == 1 and got[(dnd, 43, award_src, 2025)]["cents"] == 4_000_000
    assert got[(dnd, 72, award_src, 2025)]["n"] == 4
    assert got[(dnd, 0, award_src, 2025)]["n"] == 4
    # The segments' rows together count the notice twice; the buyer's row (sid 0) counts it once.
    assert sum(got[(dnd, s, award_src, 2025)]["n"] for s in (43, 72)) == got[(dnd, 0, award_src, 2025)]["n"] + 1
    # The three others name Ontario alone; AW-TWO counts in Ontario with them, and alone in Quebec and British Columbia.
    assert place[(dnd, 0, "ON", award_src, 2025)]["n"] == 4
    for prov in ("BC", "QC"):
        assert (place[(dnd, 0, prov, award_src, 2025)]["n"], place[(dnd, 0, prov, award_src, 2025)]["cents"]) == (1, 4_000_000)
    for prov in ("BC", "ON", "QC"):
        assert (place[(0, 43, prov, award_src, 2025)]["n"], place[(0, 43, prov, award_src, 2025)]["cents"]) == (1, 4_000_000)
    # Its three provinces count it three times; cube_bs's same cell, the figure across provinces, once.
    assert sum(place[(0, 43, p, award_src, 2025)]["n"] for p in ("BC", "ON", "QC")) == 3 == 3 * got[(0, 43, award_src, 2025)]["n"]
    # History: H-TWO in 43 and 81, placed only by its derived provinces; H-USD, H-PERSON and H-ALONE name none.
    history = rd.SOURCES["history"]
    assert place[(0, 81, "NS", history, 2025)]["n"] == place[(0, 81, "PE", history, 2025)]["n"] == 1
    assert place[(0, 0, "", history, 2025)]["n"] == 3


def test_medians_and_the_largest_organizations_values_are_per_fiscal_year(synced):
    _, db = synced
    got = cube(db, rd.CUBE_BS, 4)
    pspc, award_src = rd.buyer_number(PSPC), rd.SOURCES["awards"]
    by_year = {fy: [c for (c,) in db.execute(
        "SELECT cents FROM records WHERE bid = ? AND src = ? AND fy = ? AND extra = 0 AND cents > 0", (pspc, award_src, fy))]
        for fy in (2024, 2025)}
    for fy, values in by_year.items():
        assert got[(pspc, 0, award_src, fy)]["med"] == math.floor(statistics.median(values)), fy
    # No row spans years: the median of both years together is neither year's.
    both = math.floor(statistics.median(by_year[2024] + by_year[2025]))
    assert both not in {got[(pspc, 0, award_src, fy)]["med"] for fy in (2024, 2025)}
    # The largest organization of 2024-25 is Alpha (12,000), of 2025-26 Bravo (30,000).
    assert got[(pspc, 0, award_src, 2024)]["top1"] == 1_200_000
    assert got[(pspc, 0, award_src, 2025)]["top1"] == 3_000_000
    assert {cell[3] for cell in got} <= set(range(2000, 2030)) and None not in {cell[3] for cell in got}


def test_the_largest_organizations_rank_as_the_suppliers_list_and_a_person_is_never_one(synced):
    """PSPC's award notices of 2024-25 in segment 81: twelve made-up organizations, Acme and Overseas Optics (euros, no
    counted value), and a supplier withheld as a person holding 50,000, more than any organization."""
    _, db = synced
    got = cube(db, rd.CUBE_BS, 4)
    cell = got[(rd.buyer_number(PSPC), 81, rd.SOURCES["awards"], 2024)]
    # Sixteen records, every one in the totals: the person's 50,000 included, the euros and Lima's blank not.
    assert (cell["n"], cell["cents"], cell["n_no_value"], cell["n_unstated"]) == (16, 14_000_000, 1, 1)
    # Fourteen organizations: the person is none of them.
    assert cell["n_orgs"] == 14
    # Alpha 12,000; then Bravo 11,000, Delta 10,000 in two records, Charlie 10,000, Echo 9,000; down to India and Acme,
    # level at 5,000. Overseas Optics and Lima, with no counted value, rank last and add nothing.
    assert (cell["top1"], cell["top5"], cell["top10"]) == (1_200_000, 5_200_000, 8_300_000)
    # National Defence's history in segment 72: H-USD (Overseas Optics, no counted value) and H-PERSON (20,000). The
    # organization holds no counted value, so the largest hold 0, as the buyer view adds them.
    none_counted = got[(rd.buyer_number(DND), 72, rd.SOURCES["history"], 2025)]
    assert (none_counted["n"], none_counted["cents"], none_counted["n_orgs"]) == (2, 2_000_000, 1)
    assert (none_counted["top1"], none_counted["top5"], none_counted["top10"]) == (0, 0, 0)
    # Segment 25 holds only H-ALONE, a person's: no organization, so none of the three.
    alone = got[(0, 25, rd.SOURCES["history"], 2025)]
    assert (alone["n"], alone["cents"], alone["n_orgs"], alone["top1"], alone["top5"], alone["top10"]) == \
        (1, 600_000, 0, None, None, None)


def test_a_record_with_no_fiscal_year_is_in_no_cell(synced):
    _, db = synced
    never = rd.buyer_number(NEVER)
    assert db.execute("SELECT COUNT(*) FROM records WHERE bid = ? AND fy IS NULL", (never,)).fetchone() == (1,)
    assert db.execute("SELECT COUNT(*) FROM cube_bs WHERE bid = ?", (never,)).fetchone() == (0,)
    assert db.execute("SELECT COUNT(*) FROM cube_bs WHERE fy IS NULL").fetchone() == (0,)


# -- the stage ---------------------------------------------------------------------------------


def test_two_runs_give_the_same_rows_and_the_second_night_sends_nothing(rich, tmp_path):
    first = cubes.run(rich, today=TODAY)
    before = pipeline_rows(rich)
    assert before[0] and before[1] and first["rows"] == len(before[0]) + len(before[1])
    db = d1()
    out = tmp_path / "records"
    night(rich, out, db)
    second = cubes.run(rich, today=TODAY)
    assert pipeline_rows(rich) == before
    assert {k: v for k, v in second.items() if k != "seconds"} == {k: v for k, v in first.items() if k != "seconds"}
    manifest = night(rich, out, db)
    assert manifest["batches"] == [] and not manifest["full"]


def test_a_changed_record_changes_only_its_own_cells_and_their_rollups(rich, tmp_path):
    cubes.run(rich, today=TODAY)
    db = d1()
    out = tmp_path / "records"
    night(rich, out, db)
    before_bs, before_place = (dict((r[0], r) for r in rows) for rows in pipeline_rows(rich))
    rich.execute("UPDATE awards SET amount = 41000, total_value = 41000 WHERE reference = 'AW-TWO'")
    rich.commit()
    cubes.run(rich, today=TODAY)
    after_bs, after_place = (dict((r[0], r) for r in rows) for rows in pipeline_rows(rich))
    assert set(after_bs) == set(before_bs) and set(after_place) == set(before_place)
    dnd, award_src = rd.buyer_number(DND), rd.SOURCES["awards"]
    # Its buyer in each of its segments, its buyer, its two segments and every record: six cells of cube_bs.
    mine = {rd.key_of(f"bs:{b}:{s}:{award_src}:2025") for b, s in ((dnd, 43), (dnd, 72), (dnd, 0), (0, 43), (0, 72), (0, 0))}
    assert {k for k in after_bs if after_bs[k] != before_bs[k]} == mine
    # Its buyer, its two segments and every record, in each of its three provinces: twelve cells of cube_place.
    places_mine = {rd.key_of(f"pl:{b}:{s}:{p}:{award_src}:2025") for b, s in ((dnd, 0), (0, 43), (0, 72), (0, 0))
                   for p in ("BC", "ON", "QC")}
    assert {k for k in after_place if after_place[k] != before_place[k]} == places_mine
    manifest = night(rich, out, db)
    assert (manifest["upserts"]["cube_bs"], manifest["upserts"]["cube_place"], manifest["upserts"]["cube_meta"]) == (6, 12, 0)
    assert (manifest["deletes"]["cube_bs"], manifest["deletes"]["cube_place"]) == (0, 0)
    assert db.execute("SELECT cents FROM cube_bs WHERE bid = ? AND sid = 43 AND src = 1 AND fy = 2025", (dnd,)).fetchone() == (4_100_000,)


def test_the_guard_raises_before_anything_is_written(rich, monkeypatch):
    assert cubes.CUBE_ROWS_MAX == 400_000
    first = cubes.run(rich, today=TODAY)
    before, as_of = pipeline_rows(rich), get_meta(rich, rd.META_CUBES_AS_OF)
    monkeypatch.setattr(cubes, "CUBE_ROWS_MAX", first["rows"] - 1)
    statements: list[str] = []
    rich.set_trace_callback(statements.append)
    with pytest.raises(cubes.CubesTooLarge, match=r"would hold \d+ rows .*more than CUBE_ROWS_MAX"):
        cubes.compute(rich, today=TODAY + timedelta(days=1))
    rich.set_trace_callback(None)
    assert statements and not [s for s in statements if re.match(r"\s*(DELETE FROM|INSERT INTO) (main\.)?cube_(bs|place)\b", s)]
    assert pipeline_rows(rich) == before and get_meta(rich, rd.META_CUBES_AS_OF) == as_of
    # Through the stage runner: a failed log row, and the stages after it still run.
    assert cli._stage(rich, "cubes", lambda: cubes.run(rich, today=TODAY + timedelta(days=1))) is False
    row = rich.execute("SELECT ok, detail FROM sources_log WHERE source = 'cubes' ORDER BY id DESC").fetchone()
    assert row["ok"] == 0 and row["detail"].startswith("CubesTooLarge: the cubes would hold")
    # Exactly at the limit is within it, and the same trace sees the writes.
    monkeypatch.setattr(cubes, "CUBE_ROWS_MAX", first["rows"])
    statements.clear()
    rich.set_trace_callback(statements.append)
    assert cubes.compute(rich, today=TODAY)["rows"] == first["rows"]
    rich.set_trace_callback(None)
    assert len([s for s in statements if re.match(r"\s*(DELETE FROM|INSERT INTO) (main\.)?cube_(bs|place)\b", s)]) == 4


def test_a_failure_mid_stage_leaves_last_nights_rows(rich):
    cubes.run(rich, today=TODAY)
    before, as_of = pipeline_rows(rich), get_meta(rich, rd.META_CUBES_AS_OF)
    # Tonight cube_bs differs (a record changed), and the write of cube_place fails after cube_bs was written.
    rich.execute("UPDATE awards SET amount = 41000, total_value = 41000 WHERE reference = 'AW-TWO'")
    rich.commit()
    rich.execute("CREATE TEMP TRIGGER cube_place_fault BEFORE INSERT ON main.cube_place BEGIN SELECT RAISE(ABORT, 'disk full'); END")
    assert cli._stage(rich, "cubes", lambda: cubes.run(rich, today=TODAY + timedelta(days=1))) is False
    assert pipeline_rows(rich) == before and get_meta(rich, rd.META_CUBES_AS_OF) == as_of == TODAY.isoformat()
    row = rich.execute("SELECT ok, detail FROM sources_log WHERE source = 'cubes' ORDER BY id DESC").fetchone()
    assert row["ok"] == 0 and "disk full" in row["detail"]
    # No temporary table is left behind for the sync or the next night.
    assert not rich.execute("SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name LIKE 'cube%'").fetchall()
    rich.execute("DROP TRIGGER temp.cube_place_fault")
    assert cubes.run(rich, today=TODAY + timedelta(days=1))["rows"] and pipeline_rows(rich) != before


def test_the_stage_logs_its_own_row_with_counts_and_seconds_and_no_name(rich):
    counts_ = cubes.run(rich, today=TODAY)
    row = rich.execute("SELECT source, ok, detail, rows_in, rows_new, notice FROM sources_log WHERE source = 'cubes'").fetchone()
    assert (row["source"], row["ok"], row["notice"]) == ("cubes", 1, None)
    assert re.fullmatch(r"(?:[a-z_]+=\d+ )+seconds=\d+", row["detail"]), row["detail"]
    assert row["rows_in"] == counts_["records"] == sum(1 for _ in rd.record_rows(rich, as_of=DAY))
    assert row["rows_new"] == counts_["rows"] == counts_["cube_bs"] + counts_["cube_place"]
    assert sum(counts_[k] for k in ("buyer_segment", "buyer", "segment", "all")) == counts_["cube_bs"]
    assert sum(counts_[k] for k in ("place_buyer", "place_segment", "place_all")) == counts_["cube_place"]
    names = [r[0] for r in rich.execute("SELECT display_name FROM organizations UNION SELECT name_en FROM buyers UNION SELECT id FROM buyers")]
    assert names and not [n for n in names if n.lower() in row["detail"].lower()]
    assert get_meta(rich, rd.META_CUBES_AS_OF) == TODAY.isoformat()


def test_the_stage_runs_after_lines_and_before_the_export():
    assert cli.STAGES.index("lines") + 1 == cli.STAGES.index("cubes") == cli.STAGES.index("export") - 1


# -- the way to the records database -----------------------------------------------------------


def test_the_cubes_reach_the_records_database_through_the_sync_with_no_full_reload(rich, tmp_path):
    """A records database loaded before the cubes existed gets them as ordinary changes: new tables, rows all new to
    the ledger, LAYOUT as it was; the count check covers them, and the data date rides in cube_meta."""
    db = d1()
    out = tmp_path / "records"
    first = night(rich, out, db)
    assert first["full"] and first["expected"]["cube_bs"] == first["expected"]["cube_meta"] == 0
    counts_ = cubes.run(rich, today=TODAY)
    second = night(rich, out, db)
    assert not second["full"] and rd.LAYOUT == 2
    assert (second["upserts"]["cube_bs"], second["upserts"]["cube_place"], second["upserts"]["cube_meta"]) == \
        (counts_["cube_bs"], counts_["cube_place"], 1)
    assert sum(v for k, v in second["upserts"].items() if not k.startswith("cube_")) == 0
    assert counts(db)["cube_bs"] == counts_["cube_bs"] and counts(db)["cube_place"] == counts_["cube_place"]
    bs, place = pipeline_rows(rich)
    assert [tuple(r) for r in db.execute("SELECT * FROM cube_bs ORDER BY k")] == bs
    assert [tuple(r) for r in db.execute("SELECT * FROM cube_place ORDER BY k")] == place
    assert db.execute("SELECT k, as_of FROM cube_meta").fetchall() == [(1, TODAY.isoformat())]
    # The tables, their numbers and the count statement; the workflow's copy is held to it in test_records_db.py.
    assert (rd.CUBE_BS.code, rd.CUBE_PLACE.code, rd.CUBE_META.code) == (21, 22, 23)
    assert rd.BY_CODE[20] is rd.CONTRACT_EXCEPTION and len({t.code for t in rd.TABLES}) == len(rd.TABLES)
    for name in ("cube_bs", "cube_place", "cube_meta"):
        assert f"(SELECT COUNT(*) FROM {name}) AS {name}" in rd.COUNT_SQL
    # A count read back short is a mismatch like any other table's.
    short = {**counts(db), "cube_place": counts(db)["cube_place"] - 1}
    assert "cube_place holds" in rd.count_check(rd.expected_counts(second), short)


def test_the_builders_statements_read_the_cubes_through_their_indexes():
    db = d1()

    def plan(sql: str, *binds) -> str:
        return " | ".join(r[3] for r in db.execute("EXPLAIN QUERY PLAN " + sql, binds))

    # A buyer's years (sid 0): either index seeks all four columns.
    years = plan("SELECT fy, n, cents FROM cube_bs WHERE bid = ? AND src = ? AND sid = 0 AND fy BETWEEN ? AND ? ORDER BY fy "
                 "LIMIT 20", 1, 1, 2006, 2025)
    assert "SEARCH cube_bs USING INDEX" in years and "bid=?" in years and "sid=?" in years and "SCAN" not in years, years
    # A buyer's segments in one year, and a segment's buyers in one year.
    buyer = plan("SELECT sid, n, cents FROM cube_bs WHERE bid = ? AND src = ? AND sid <> 0 AND fy = ? ORDER BY cents DESC "
                 "LIMIT 58", 1, 1, 2025)
    assert "USING INDEX cube_bs_buyer (bid=? AND src=?" in buyer and "SCAN cube_bs" not in buyer, buyer
    segment = plan("SELECT bid, n, cents FROM cube_bs WHERE sid = ? AND src = ? AND bid <> 0 AND fy = ? ORDER BY cents DESC "
                   "LIMIT 10", 43, 1, 2025)
    assert "USING INDEX cube_bs_segment (sid=? AND src=?" in segment and "SCAN cube_bs" not in segment, segment
    for column, index in (("bid", "cube_place_buyer"), ("sid", "cube_place_segment")):
        sql = f"SELECT prov, n, cents FROM cube_place WHERE {column} = ? AND src = ? AND fy = ? LIMIT 14"
        assert f"USING INDEX {index}" in plan(sql, 1, 1, 2025), plan(sql, 1, 1, 2025)
