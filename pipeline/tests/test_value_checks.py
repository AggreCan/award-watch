"""value_checks.py and the values a source did not publish: the three rules that flag a value, a flagged
value kept on its record and left out of every total, and a missing value kept NULL (never $0) from the
loader to the totals, the JSON and the CSV."""

import csv
import io
import json

import pytest

from awardwatch_pipeline import export, export_static, indicators, organizations, value_checks
from awardwatch_pipeline.sources import canadabuys

T1 = "2026-10-31T00:00:00Z"


def award(conn, ref, name, *, amount, total=None, currency="CAD", number=None, country="CA", status="active",
          awarded="2025-03-01", table="awards", amendment=0, buyer=None):
    oid = organizations.upsert(conn, name, source="awards" if table == "awards" else "history", country=country)
    conn.execute(
        f"INSERT INTO {table} (reference, amendment, contract_number, supplier_raw, supplier_country, organization_id, "
        "amount, total_value, currency, status, awarded, buyer_id, source_file, first_seen, last_seen) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'f', '2026-10-31', '2026-10-31')",
        (ref, amendment, number, name, country, oid, amount, total, currency, status, awarded, buyer))
    return oid


def contract(conn, ref, name, *, value, procurement_id=None, owner="dfatd-maecd"):
    oid = organizations.upsert(conn, name, source="contracts", country="CA")
    conn.execute("INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, value, original_value, "
                 "instrument_type, contract_date, organization_id, loaded_at) "
                 "VALUES (?, ?, ?, ?, ?, ?, 'C', '2017-04-24', ?, ?)",
                 (owner, ref, procurement_id, name, value, value, oid, T1))
    return oid


def flags(conn):
    return {(r[0], r[1]): r[2] for r in conn.execute("SELECT kind, key, rule FROM value_flags")}


def test_a_value_ten_times_another_sources_for_the_same_contract_is_flagged(conn, tmp_path):
    padf = award(conn, "PW-15-00693450-780220", "Pan American Development Foundation", amount=3_674_807_000.0,
                 number="7063142")
    contract(conn, "C-2017-2018-Q1-00860", "Pan American Development Foundation", value=3_674_808.0,
             procurement_id="5007063142")
    # Same contract number, history at a value nine times smaller: no flag.
    award(conn, "W-NINE", "Ninefold Supply Ltd.", amount=900_000.0, number="W1234-567890/001/XX")
    award(conn, "W-NINE", "Ninefold Supply Ltd.", amount=100_000.0, number="W1234-567890/001/XX",
          table="contract_history")
    # The same number under another organization proves nothing.
    award(conn, "W-OTHER", "Someone Else Inc.", amount=50_000_000.0, number="W9999-000001/001/ZZ")
    award(conn, "W-OTHER", "A Different Firm Inc.", amount=50_000.0, number="W9999-000001/001/ZZ",
          table="contract_history")
    result = organizations.run(conn, now=T1, review_dir=tmp_path)
    assert flags(conn) == {("award", "PW-15-00693450-780220"): "other_source"}
    assert result["value_flags"] == 1
    # The value stays on the record; no total adds it.
    row = conn.execute("SELECT amount FROM awards WHERE reference = 'PW-15-00693450-780220'").fetchone()
    assert row[0] == 3_674_807_000.0
    org = conn.execute("SELECT n_awards, total_awards, total_contracts FROM organizations WHERE id = ?", (padf,)).fetchone()
    assert tuple(org) == (1, None, 3_674_808.0)
    review = (tmp_path / value_checks.REVIEW_FILE).read_text(encoding="utf-8")
    assert "award\tPW-15-00693450-780220\t" in review and "against contract dfatd-maecd:5007063142" in review


def test_a_total_a_hundred_times_the_largest_amount_is_flagged(conn, tmp_path):
    award(conn, "EW038-210277-001-EDM", "Alberta Boilers Safety Association", amount=475_632.83,
          total=1_161_390_376.0)
    award(conn, "EW038-210277-001-EDM", "Alberta Boilers Safety Association", amount=475_632.83,
          total=1_161_390_376.0, table="contract_history")
    # An amendment's small amount against the contract's total is not the rule: the largest amount is compared.
    award(conn, "AMENDED", "Amended Services Ltd.", amount=1_000_000.0, total=1_000_000.0)
    award(conn, "AMENDED", "Amended Services Ltd.", amount=5_000.0, total=1_200_000.0, amendment=1)
    # An amount of cents is the error there, not the total.
    award(conn, "W8485-02KK80/001/SSC", "L3Harris MAS", amount=0.02, total=1_237_175_249.02)
    organizations.run(conn, now=T1, review_dir=tmp_path)
    assert flags(conn) == {("award", "EW038-210277-001-EDM"): "total_vs_amount",
                           ("history", "EW038-210277-001-EDM"): "total_vs_amount"}


def test_a_value_with_no_currency_from_a_supplier_abroad_is_flagged(conn, tmp_path):
    award(conn, "W8484-199273-001-LP", "TERROU-BI SA", amount=776_580_000.0, currency=None, country="SN",
          number="W8484-199273/001/LP")
    award(conn, "W8484-199273-001-LP", "TERROU-BI SA", amount=1_863_792.0, total=3_727_584.0, country="SN",
          number="W8484-199273/001/LP", table="contract_history")
    award(conn, "HOME", "Canadian Supplier Inc.", amount=10_000.0, currency=None, country="CA")
    award(conn, "ABROAD-EUR", "Foreign Supplier GmbH", amount=10_000.0, currency="EUR", country="DE")
    organizations.run(conn, now=T1, review_dir=tmp_path)
    assert flags(conn) == {("award", "W8484-199273-001-LP"): "other_source,currency_abroad"}


def test_a_flagged_value_is_exported_with_its_flag_and_left_out_of_rankings(conn, tmp_path):
    big = award(conn, "EW038-210277-001-EDM", "Alberta Boilers Safety Association", amount=475_632.83,
                total=1_161_390_376.0, awarded="2026-02-01")
    small = award(conn, "PLAIN", "Plain Supplier Ltd.", amount=20_000.0, awarded="2026-03-01")
    organizations.run(conn, now=T1, review_dir=tmp_path)
    indicators.compute(conn, now=T1)
    out = tmp_path / "static"
    from datetime import date
    export_static.export_static(conn, out, today=date(2026, 10, 31), base_url="https://awardwatch.example")
    profile = json.loads((out / "profiles" / f"{big[4:7]}.json").read_text(encoding="utf-8"))[big]
    row = profile["awards"][0]
    assert row["value"] == 1_161_390_376.0 and row["value_flag"] == "check"
    assert profile["value_check"] == {"awards": 1} and profile["organization"]["total_awards"] is None
    ranking = json.loads((out / "rankings" / "all.json").read_text(encoding="utf-8"))["sources"]["awards"]
    assert [r["id"] for r in ranking["by_value"]] == [small]
    shard = export_static.reference_shard("ew038-210277-001-edm")
    detail = json.loads((out / "contracts" / f"{shard}.json").read_text(encoding="utf-8"))["award:ew038-210277-001-edm"]
    assert detail["value_flag"] == "check"


def test_the_loader_and_the_nightly_check_keep_a_value_not_published_null():
    rec: dict = {}
    values = {"amount": "0.00", "total_value": "0.00"}
    canadabuys._contract(None, lambda f: values.get(f, ""), rec)
    assert rec["amount"] is None and rec["total_value"] is None
    values = {"amount": "0.00", "total_value": "500.00"}
    canadabuys._contract(None, lambda f: values.get(f, ""), rec)
    assert rec["amount"] == 0.0 and rec["total_value"] == 500.0


@pytest.fixture
def unpublished(conn):
    oid = award(conn, "SO-1", "Standing Offer Holder Inc.", amount=0.0, total=0.0, awarded="2026-05-01")
    award(conn, "C-1", "Standing Offer Holder Inc.", amount=40_000.0, awarded="2026-06-01")
    award(conn, "C-2", "Standing Offer Holder Inc.", amount=0.0, total=500.0, awarded="2026-06-02")
    award(conn, "X-1", "Standing Offer Holder Inc.", amount=None, total=None, status="cancelled", awarded="2026-06-03")
    return oid


def test_a_value_not_published_is_null_and_counted_beside_the_total(conn, tmp_path, unpublished):
    oid = unpublished
    organizations.run(conn, now=T1, review_dir=tmp_path)
    assert conn.execute("SELECT amount, total_value FROM awards WHERE reference = 'SO-1'").fetchone()[:] == (None, None)
    row = conn.execute("SELECT n_awards, total_awards, n_awards_no_value FROM organizations WHERE id = ?", (oid,)).fetchone()
    # A cancelled contract counts zero (the source's own rule) and is not a missing value.
    assert tuple(row) == (4, 40_500.0, 1)
    indicators.compute(conn, now=T1)
    year = conn.execute("SELECT n, total, n_no_value FROM organization_years WHERE organization_id = ? AND year = 2026",
                        (oid,)).fetchone()
    assert tuple(year) == (4, 40_500.0, 1)


def test_a_value_not_published_is_null_in_the_json_and_empty_in_the_csv(conn, tmp_path, unpublished):
    from datetime import date

    oid = unpublished
    organizations.run(conn, now=T1, review_dir=tmp_path)
    indicators.compute(conn, now=T1)
    out = tmp_path / "static"
    export_static.export_static(conn, out, today=date(2026, 10, 31), base_url="https://awardwatch.example")
    profile = json.loads((out / "profiles" / f"{oid[4:7]}.json").read_text(encoding="utf-8"))[oid]
    by_ref = {r["reference"]: r for r in profile["awards"]}
    assert by_ref["SO-1"]["value"] is None and by_ref["C-2"]["value"] == 500.0 and by_ref["X-1"]["value"] == 0
    assert profile["organization"]["n_awards_no_value"] == 1
    assert [(y["year"], y["n"], y["total"], y["n_no_value"]) for y in profile["years"]] == [(2026, 4, 40_500.0, 1)]
    top = json.loads((out / "stats.json").read_text(encoding="utf-8"))["top_organizations_year"][0]
    assert (top["id"], top["total"], top["n_no_value"]) == (oid, 40_500.0, 1)
    csv_out = tmp_path / "csv"
    export.export_csv(conn, csv_out)
    rows = list(csv.DictReader(io.StringIO((csv_out / "awards-2026.csv").read_text(encoding="utf-8-sig"))))
    so = next(r for r in rows if r["reference"] == "SO-1")
    assert so["amount"] == "" and so["total_value"] == ""
    org_row = next(csv.DictReader(io.StringIO((csv_out / "organizations.csv").read_text(encoding="utf-8-sig"))))
    assert (org_row["total_awards"], org_row["n_awards_no_value"]) == ("40500.00", "1")
