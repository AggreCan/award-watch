"""The radar's duplicate rule across buyers: an award notice naming PSPC and the department's own published
contract are one contract; the kept row names the client department; the pairs go to a review list; the
export carries the client and the flag."""

import csv
import io
import json
from datetime import date, timedelta

import pytest

from awardwatch_pipeline import export, export_static, expiring, organizations

TODAY = date(2026, 10, 31)
STAMP = "2026-10-31T01:00:00Z"
END = (TODAY + timedelta(days=61)).isoformat()
JV = "WCG International Consultants Ltd.; Lifemark Health Corp IN JOINT VENTURE"


@pytest.fixture
def db(conn):
    for bid, en, fr in (("pwgsc-tpsgc", "Public Services and Procurement Canada", "Services publics et Approvisionnement Canada"),
                        ("vac-acc", "Veterans Affairs Canada", "Anciens Combattants Canada"),
                        ("dnd-mdn", "National Defence", "Défense nationale")):
        conn.execute("INSERT INTO buyers (id, name_en, name_fr, updated_at) VALUES (?, ?, ?, ?)", (bid, en, fr, STAMP))
    conn.executemany("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, 'canadabuys', ?)",
                     [("Department of Veterans Affairs (VAC)", "vac-acc"),
                      ("Department of National Defence (DND)", "dnd-mdn")])
    return conn


def award(conn, ref, supplier, *, value, end=END, end_users=None, number=None):
    oid = organizations.upsert(conn, supplier, source="awards")
    conn.execute(
        'INSERT INTO awards (reference, amendment, contract_number, amount, total_value, currency, status, "end", '
        "supplier_raw, organization_id, buyer_id, end_users_en, source_file, first_seen, last_seen) "
        "VALUES (?, 0, ?, ?, ?, 'CAD', 'active', ?, ?, ?, 'pwgsc-tpsgc', ?, 'f', ?, ?)",
        (ref, number, value, value, end, supplier, oid, json.dumps(end_users) if end_users else None,
         TODAY.isoformat(), TODAY.isoformat()))
    return oid


def contract(conn, ref, vendor, *, value, owner="vac-acc", end=END, procurement_id=None):
    conn.execute(
        "INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, buyer_id, contract_date, "
        "delivery_date, value, original_value, instrument_type, organization_id, loaded_at) "
        "VALUES (?, ?, ?, ?, ?, '2021-06-29', ?, ?, ?, 'C', ?, ?)",
        (owner, ref, procurement_id, vendor, owner, end, value, value,
         organizations.upsert(conn, vendor, source="contracts"), STAMP))


def radar(conn, tmp_path):
    counts = expiring.compute(conn, today=TODAY, now=STAMP, review_dir=tmp_path)
    return counts, {r["source_key"]: r for r in conn.execute("SELECT * FROM expiring_contracts")}


def test_the_same_contract_under_two_buyers_and_a_dollar_apart_is_listed_once(db, tmp_path):
    # The award notice names PSPC; Veterans Affairs publishes the same contract a dollar apart.
    oid = award(db, "51019-184018-001-STJ", JV, value=693_501_465.63, number="51019-184018/001/STJ",
                end_users=["Department of Veterans Affairs (VAC)"])
    contract(db, "C-2021-2022-Q1-00071", JV, value=693_501_466.63, procurement_id="51019-184018")
    # A true second contract: same organization and end date, values 5% apart.
    contract(db, "C-OTHER", JV, value=693_501_465.63 * 1.05, procurement_id="51019-999999")
    counts, rows = radar(db, tmp_path)
    assert counts["dropped_match"] == 1 and counts["dropped_number"] == 0
    assert sorted(rows) == ["award:51019-184018-001-STJ", "contract:vac-acc:C-OTHER"]
    kept = rows["award:51019-184018-001-STJ"]
    assert kept["buyer_id"] == "pwgsc-tpsgc" and kept["organization_id"] == oid
    assert (kept["client_buyer_id"], kept["client_buyer_name"], kept["client_buyer_name_fr"]) == \
        ("vac-acc", "Veterans Affairs Canada", "Anciens Combattants Canada")
    review = (tmp_path / expiring.REVIEW_FILE).read_text(encoding="utf-8").splitlines()
    assert review[-1].split("\t") == ["match", "contract:vac-acc:C-2021-2022-Q1-00071", "vac-acc", END, "693501466.63",
                                      "award:51019-184018-001-STJ", "pwgsc-tpsgc", END, "693501465.63", oid]


def test_the_client_is_the_rows_own_without_a_duplicate(db, tmp_path):
    award(db, "AW-DND", "Northern Boots Ltd.", value=50_000.0, end_users=["Department of National Defence (DND)"])
    award(db, "AW-RAW", "Southern Boots Ltd.", value=60_000.0, end_users=["A Unit No Source Has Named"])
    contract(db, "C-SELF", "Eastern Boots Ltd.", value=70_000.0, owner="dnd-mdn")
    _, rows = radar(db, tmp_path)
    assert rows["award:AW-DND"]["client_buyer_id"] == "dnd-mdn"
    assert (rows["award:AW-RAW"]["client_buyer_id"], rows["award:AW-RAW"]["client_buyer_name"]) == \
        (None, "A Unit No Source Has Named")
    assert rows["contract:dnd-mdn:C-SELF"]["client_buyer_id"] == "dnd-mdn"
    assert not (tmp_path / expiring.REVIEW_FILE).exists()


def test_the_export_carries_the_client_and_the_flag(db, tmp_path):
    award(db, "51019-184018-001-STJ", JV, value=693_501_465.63, end_users=["Department of Veterans Affairs (VAC)"])
    contract(db, "C-2021-2022-Q1-00071", JV, value=693_501_466.63)
    award(db, "FLAGGED", "Flagged Supplier Ltd.", value=1_000.0)
    db.execute("INSERT INTO value_flags (kind, key, rule, computed_at) VALUES ('award', 'FLAGGED', 'total_vs_amount', ?)",
               (STAMP,))
    organizations.recompute(db, now=STAMP)
    expiring.compute(db, today=TODAY, now=STAMP, review_dir=tmp_path)
    out = tmp_path / "static"
    export_static.export_static(db, out, today=TODAY, base_url="https://awardwatch.example")
    rows = {r["reference"]: r for r in json.loads((out / "expiring" / "12m" / "1.json").read_text(encoding="utf-8"))}
    row = rows["51019-184018-001-STJ"]
    assert (row["client_buyer_id"], row["client_buyer_name"]) == ("vac-acc", "Veterans Affairs Canada")
    assert rows["FLAGGED"]["value_flag"] == "check" and "value_flag" not in row
    index = json.loads((out / "expiring" / "index.json").read_text(encoding="utf-8"))
    # The flagged value is shown on its row and added to no total.
    assert index["windows"][0]["total"] == 693_501_465.63 and index["windows"][0]["n_no_value"] == 0
    export.export_csv(db, tmp_path / "csv")
    text = (tmp_path / "csv" / "expiring-12m.csv").read_text(encoding="utf-8-sig")
    csv_rows = {r["reference"]: r for r in csv.DictReader(io.StringIO(text))}
    assert csv_rows["51019-184018-001-STJ"]["client_buyer_id"] == "vac-acc"
    assert csv_rows["FLAGGED"]["value_flag"] == "check"
