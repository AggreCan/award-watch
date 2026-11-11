"""Two fields the sources give that the site now shows, each as its source states it:

* the supplier's employees on PSPC's contract history (supplierEmployeeCount): a count, or a size band
  of the CanadaBuys data dictionary on older records (normalize.employee_count), on a history record's
  detail (supplier_employees) and on the profile as its newest record's figure (employees);
* the published contracts' Indigenous business fields (indigenous_business,
  indigenous_business_excluding_psib): the radar's mark (expiring.py, export_static.expiring_row) and the
  published contract page's table, rec_contract_indigenous (records_db.py).

A supplier or vendor withheld as a person carries neither, anywhere."""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, timedelta
from pathlib import Path

import pytest

from awardwatch_pipeline import expiring, organizations
from awardwatch_pipeline import export_static as es
from awardwatch_pipeline import records_db as rd
from awardwatch_pipeline.db import set_meta
from awardwatch_pipeline.normalize import (
    EMPLOYEE_BANDS, INDIGENOUS_MARKS, employee_count, indigenous_mark, indigenous_outside_psib, psib_set_aside,
)
from export_seed import ACME, NORTH, PERSON_STREET, STAMP, TODAY, seed

REPO = Path(__file__).resolve().parents[2]
BASE = "https://awardwatch.example"


# -- the fields as read ---------------------------------------------------------------------


@pytest.mark.parametrize("raw, code", [
    ("180", "180"), (" 0012 ", "12"), ("1,200", "1200"), ("0", "0"), ("9999999", "9999999"),
    ("50 to 99 employees", "50-99"), ("500  to  999 employees", "500-999"), ("Self-employed", "self"),
    ("5000 employees and over", "5000+"), ("1 TO 4 EMPLOYEES", "1-4"), ("1000 to 1499 employees", "1000-1499"),
    ("UNKNOWN", None), ("unknown", None), ("INCONNU", None), ("", None), (None, None), ("12345678", None),
    ("1.5", None), ("-3", None), ("²", None), ("about 40", None), ("50 � 99 employ�s", None),
])
def test_the_employees_are_a_count_or_a_dictionary_band(raw, code):
    assert employee_count(raw) == code


def test_every_dictionary_band_has_a_code_the_site_reads():
    # The thirteen bands of the CanadaBuys data dictionary (achatscanada-canadabuys-dd.xml), UNKNOWN aside.
    assert len(EMPLOYEE_BANDS) == 13 and len(set(EMPLOYEE_BANDS.values())) == 13
    data_ts = (REPO / "site" / "src" / "data.ts").read_text(encoding="utf-8")
    listed = re.search(r"export const EMPLOYEE_BANDS = \[([^\]]*)\]", data_ts)
    assert listed and re.findall(r'"([^"]+)"', listed.group(1)) == list(EMPLOYEE_BANDS.values())


@pytest.mark.parametrize("set_aside, outside, mark", [
    ("MS", "N", "MS"), ("vs", "", "VS"), (" VS ", None, "VS"), ("NA", "Y", "IB"), (None, "Yes", "IB"), ("", "oui", "IB"),
    ("NA", "N", None), (None, None, None), ("", "No", None), ("XX", "Non", None), ("MS", "Y", "MS"),
])
def test_the_indigenous_business_fields_give_one_mark(set_aside, outside, mark):
    assert indigenous_mark(set_aside, outside) == mark
    assert psib_set_aside(set_aside) == (mark if mark in ("MS", "VS") else None)
    assert indigenous_outside_psib(outside) == (str(outside or "").strip().upper() in ("Y", "YES", "OUI"))


def test_the_site_reads_every_mark_the_export_writes():
    data_ts = (REPO / "site" / "src" / "data.ts").read_text(encoding="utf-8")
    listed = re.search(r"export const INDIGENOUS_MARKS = \[([^\]]*)\]", data_ts)
    assert listed and tuple(re.findall(r'"([^"]+)"', listed.group(1))) == INDIGENOUS_MARKS


# -- the supplier's employees in the export ------------------------------------------------


def history(conn, ref, amendment, *, employees, awarded="2024-01-10", org=None, withheld=False, supplier=ACME):
    conn.execute(
        "INSERT INTO contract_history (reference, amendment, title_en, awarded, published, amount, total_value, currency, "
        "status, supplier_raw, supplier_street, supplier_employee_count, organization_id, supplier_withheld, buyer_id, "
        "client_id, source_file, first_seen, last_seen) VALUES (?, ?, 'Survey', ?, ?, 1000, 1000, 'CAD', 'active', ?, ?, "
        "?, ?, ?, 'pwgsc-tpsgc', 'dnd-mdn', 'history.csv', ?, ?)",
        (ref, amendment, awarded, awarded, None if withheld else supplier, PERSON_STREET if withheld else None, employees,
         None if withheld else org, 1 if withheld else 0, STAMP[:10], STAMP[:10]))


def export(conn, tmp_path) -> Path:
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url=BASE)
    return out


def detail(out: Path, ref: str) -> dict:
    key = ref.lower()
    return json.loads((out / "contracts" / f"{es.reference_shard(key)}.json").read_text(encoding="utf-8"))[f"history:{key}"]


def profile_of(out: Path, oid: str) -> dict:
    return json.loads((out / "profiles" / f"{oid[4:7]}.json").read_text(encoding="utf-8"))[oid]


def test_a_history_record_carries_its_newest_stated_employees_and_a_withheld_supplier_none(conn, tmp_path):
    ids = seed(conn)
    acme = ids[ACME]
    # H-1 (the seed's, awarded 2026-06-01): a count. H-3: a band, then a blank and UNKNOWN on later versions.
    conn.execute("UPDATE contract_history SET supplier_employee_count = '180' WHERE reference = 'H-1'")
    history(conn, "H-3", 0, employees="50 to 99 employees", org=acme)
    history(conn, "H-3", 1, employees="", org=acme)
    history(conn, "H-3", 2, employees="UNKNOWN", org=acme)
    # H-4: a supplier withheld as a person, whose count is never exported.
    history(conn, "H-4", 0, employees="1", withheld=True)
    conn.commit()
    out = export(conn, tmp_path)
    assert detail(out, "H-1")["supplier_employees"] == "180"
    assert detail(out, "H-3")["supplier_employees"] == "50-99"
    h4 = detail(out, "H-4")
    assert h4["supplier_withheld"] is True and "supplier_employees" not in h4
    # The seed's withheld record H-2 states none either.
    assert "supplier_employees" not in detail(out, "H-2")
    # The profile's figure: its newest record that gives one, its award date and reference.
    assert profile_of(out, acme)["employees"] == {"value": "180", "awarded": "2026-06-01", "reference": "H-1"}


def test_the_profile_falls_back_to_an_older_record_and_carries_nothing_without_one(conn, tmp_path):
    ids = seed(conn)
    history(conn, "H-3", 0, employees="Self-employed", awarded="2023-03-03", org=ids[ACME])
    conn.commit()
    out = export(conn, tmp_path)
    assert "supplier_employees" not in detail(out, "H-1")
    assert profile_of(out, ids[ACME])["employees"] == {"value": "self", "awarded": "2023-03-03", "reference": "H-3"}
    # An organization with no history record states nothing.
    assert "employees" not in profile_of(out, ids[NORTH])


def test_a_figure_on_a_withheld_record_never_reaches_a_profile(conn, tmp_path):
    ids = seed(conn)
    # The newest version withholds the supplier: the record names no organization, so no profile takes its figure.
    history(conn, "H-5", 0, employees="25", org=ids[ACME])
    history(conn, "H-5", 1, employees="25", withheld=True)
    conn.commit()
    out = export(conn, tmp_path)
    assert "employees" not in profile_of(out, ids[ACME])
    assert "supplier_employees" not in detail(out, "H-5")


# -- the Indigenous business mark on the radar --------------------------------------------

def day(n: int) -> str:
    return (TODAY + timedelta(days=n)).isoformat()


@pytest.fixture
def radar_db(conn):
    for bid in ("pwgsc-tpsgc", "dept"):
        conn.execute("INSERT INTO buyers (id, name_en, name_fr, updated_at) VALUES (?, ?, ?, ?)", (bid, f"{bid} en", f"{bid} fr", STAMP))
    return conn


def contract(conn, ref, *, end, set_aside=None, outside=None, procurement_id=None, vendor="Acme Ltd", withheld=False,
             date_="2026-01-01", kind="C", value=100_000.0):
    conn.execute(
        "INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, vendor_withheld, buyer_id, contract_date, "
        "delivery_date, value, original_value, instrument_type, indigenous_business, indigenous_business_excluding_psib, "
        "organization_id, loaded_at) VALUES ('dept', ?, ?, ?, ?, 'dept', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (ref, procurement_id, None if withheld else vendor, 1 if withheld else 0, date_, end, value, value, kind, set_aside,
         outside, None if withheld else organizations.upsert(conn, vendor, source="contracts"), STAMP))


def award_row(conn, ref, *, end, number, supplier="Acme Ltd", withheld=False, value=100_000.0):
    conn.execute(
        'INSERT INTO awards (reference, amendment, contract_number, amount, total_value, currency, status, "end", supplier_raw, '
        "organization_id, supplier_withheld, buyer_id, source_file, first_seen, last_seen) "
        "VALUES (?, 0, ?, ?, ?, 'CAD', 'active', ?, ?, ?, ?, 'pwgsc-tpsgc', 'f', ?, ?)",
        (ref, number, value, value, end, None if withheld else supplier,
         None if withheld else organizations.upsert(conn, supplier, source="awards"), 1 if withheld else 0, STAMP[:10], STAMP[:10]))


def radar(conn) -> dict[str, sqlite3.Row]:
    expiring.compute(conn, today=TODAY, now=STAMP)
    return {r["source_key"]: r for r in conn.execute("SELECT * FROM expiring_contracts")}


def test_a_published_contract_carries_its_groups_newest_stated_mark(radar_db):
    # A group whose amendment leaves the fields blank keeps its original's set-aside.
    contract(radar_db, "C-1", end=day(30), set_aside="VS", outside="N", procurement_id="P-1", date_="2026-01-01")
    contract(radar_db, "C-2", end=day(60), procurement_id="P-1", date_="2026-03-01", kind="A")
    contract(radar_db, "C-3", end=day(40), set_aside="NA", outside="Y", vendor="Second Ltd")
    contract(radar_db, "C-4", end=day(50), set_aside="NA", outside="N", vendor="Third Ltd")
    # A person's contract: its row is kept, with no mark.
    contract(radar_db, "C-5", end=day(70), set_aside="MS", outside="N", withheld=True)
    # A newer row that states NA after an older MS: the newest statement is the mark.
    contract(radar_db, "C-6", end=day(80), set_aside="MS", procurement_id="P-6", date_="2026-01-01", vendor="Sixth Ltd")
    contract(radar_db, "C-7", end=day(80), set_aside="NA", outside="N", procurement_id="P-6", date_="2026-02-01", kind="A",
             vendor="Sixth Ltd")
    rows = radar(radar_db)
    assert rows["contract:dept:C-2"]["indigenous"] == "VS"
    assert rows["contract:dept:C-3"]["indigenous"] == "IB"
    assert rows["contract:dept:C-4"]["indigenous"] is None
    assert rows["contract:dept:C-5"]["indigenous"] is None and rows["contract:dept:C-5"]["supplier_withheld"] == 1
    assert rows["contract:dept:C-7"]["indigenous"] is None


def test_a_row_kept_from_another_source_takes_the_mark_of_the_published_contract_dropped_against_it(radar_db):
    award_row(radar_db, "AW-1", end=day(30), number="W8486-24ABCD/001/XX")
    contract(radar_db, "C-1", end=day(30), set_aside="MS", outside="N", procurement_id="W8486-24ABCD/001/XX")
    # A withheld award notice takes no mark, whatever its twin says.
    award_row(radar_db, "AW-2", end=day(45), number="W8486-24WXYZ/001/XX", withheld=True)
    contract(radar_db, "C-2", end=day(45), set_aside="NA", outside="Y", procurement_id="W8486-24WXYZ/001/XX")
    rows = radar(radar_db)
    assert "contract:dept:C-1" not in rows and rows["award:AW-1"]["indigenous"] == "MS"
    assert "contract:dept:C-2" not in rows and rows["award:AW-2"]["indigenous"] is None


def test_the_window_files_carry_the_mark_only_where_it_is_set(conn, tmp_path):
    seed(conn)
    # The seed's published contracts (C-1 and its amendment C-2, PROC-1) end within 12 months.
    conn.execute("UPDATE contracts SET indigenous_business = 'MS', indigenous_business_excluding_psib = 'N' WHERE reference = 'C-1'")
    expiring.compute(conn, today=TODAY, now=STAMP)
    conn.commit()
    out = export(conn, tmp_path)
    meta = json.loads((out / "expiring" / "12m" / "index.json").read_text(encoding="utf-8"))
    rows = [r for n in range(1, meta["pages"] + 1)
            for r in json.loads((out / "expiring" / "12m" / f"{n}.json").read_text(encoding="utf-8"))]
    marked = [r for r in rows if "indigenous" in r]
    assert [(r["kind"], r["reference"], r["indigenous"]) for r in marked] == [("contract", "dnd-mdn:C-2", "MS")]
    # rec_expiring keeps the row as the file holds it, the mark with it.
    window = list(rd.expiring_rows(out))
    assert sum('"indigenous":"MS"' in r[-1] for r in window) == 1


# -- the published contract page's table ---------------------------------------------------


def d1() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.executescript(rd.SCHEMA_PATH.read_text(encoding="utf-8"))
    return db


def night(conn: sqlite3.Connection, out: Path, db: sqlite3.Connection) -> dict:
    manifest = rd.sync(conn, out)
    for name in manifest["batches"]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    db.commit()
    counts = dict(zip((t.name for t in rd.TABLES), db.execute(rd.COUNT_SQL).fetchone()))
    assert rd.count_check(rd.expected_counts(manifest), counts) is None
    db.executescript((out / rd.FINISH).read_text(encoding="utf-8"))
    rd.record_sync(conn, manifest)
    return manifest


def test_the_page_table_holds_the_rows_that_report_a_set_aside_or_an_indigenous_business(conn, tmp_path):
    seed(conn)
    set_meta(conn, "data_as_of", TODAY.isoformat())
    conn.execute("UPDATE contracts SET indigenous_business = 'MS', indigenous_business_excluding_psib = 'N' WHERE reference = 'C-1'")
    conn.execute("UPDATE contracts SET indigenous_business = 'NA', indigenous_business_excluding_psib = 'Y' WHERE reference = 'C-2'")
    rows = [("C-3", "NA", "N", 0), ("C-4", None, None, 0), ("C-5", "vs", "No", 0), ("C-6", "MS", "Y", 1)]
    for ref, set_aside, outside, withheld in rows:
        conn.execute(
            "INSERT INTO contracts (owner_org, reference, vendor_raw, vendor_withheld, buyer_id, contract_date, value, "
            "indigenous_business, indigenous_business_excluding_psib, loaded_at) VALUES ('dnd-mdn', ?, ?, ?, 'dnd-mdn', "
            "'2025-12-01', 50000, ?, ?, ?)", (ref, None if withheld else NORTH, withheld, set_aside, outside, STAMP))
    # A row the site cannot address has no page, so no row here either.
    conn.execute("INSERT INTO contracts (owner_org, reference, indigenous_business, loaded_at) VALUES ('Not An Id', 'Z-1', 'MS', ?)",
                 (STAMP,))
    conn.commit()
    out = tmp_path / "records"
    db = d1()
    manifest = night(conn, out, db)
    assert manifest["expected"]["rec_contract_indigenous"] == 3
    held = {r[0]: r[1:] for r in db.execute(
        "SELECT c.ref, i.psib, i.ib FROM rec_contract_indigenous i JOIN rec_contracts c ON c.k = i.k ORDER BY c.ref")}
    assert held == {"C-1": ("MS", 0), "C-2": (None, 1), "C-5": ("VS", 0)}
    # Keyed as the page's row, through the unique index the page reads.
    plan = " ".join(str(r[-1]) for r in db.execute(
        "EXPLAIN QUERY PLAN SELECT i.psib, i.ib FROM rec_contracts c JOIN rec_contract_indigenous i ON i.k = c.k "
        "WHERE c.dept = ? AND c.ref = ? LIMIT 1", ("dnd-mdn", "C-1")))
    assert "rec_contracts_ref" in plan and "SCAN" not in plan, plan
    # Nothing changed, nothing sent; a field that changes sends its row, and one that stops saying so deletes it.
    assert night(conn, out, db)["batches"] == []
    conn.execute("UPDATE contracts SET indigenous_business = 'VS' WHERE reference = 'C-1'")
    conn.execute("UPDATE contracts SET indigenous_business_excluding_psib = 'N' WHERE reference = 'C-2'")
    conn.commit()
    manifest = night(conn, out, db)
    assert (manifest["upserts"]["rec_contract_indigenous"], manifest["deletes"]["rec_contract_indigenous"]) == (1, 1)
    held = {r[0]: r[1:] for r in db.execute(
        "SELECT c.ref, i.psib, i.ib FROM rec_contract_indigenous i JOIN rec_contracts c ON c.k = i.k ORDER BY c.ref")}
    assert held == {"C-1": ("VS", 0), "C-5": ("VS", 0)}


def test_a_new_table_needs_no_full_reload():
    # The table is added beside rec_contracts, so the layout a full reload records stays as it was.
    assert rd.LAYOUT == 2
    assert rd.CONTRACT_INDIGENOUS.code == 17 and rd.BY_CODE[17] is rd.CONTRACT_INDIGENOUS
    assert len({t.code for t in rd.TABLES}) == len(rd.TABLES)
