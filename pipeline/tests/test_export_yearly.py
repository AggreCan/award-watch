"""The yearly downloads of published contracts and grants: one row per version as published, nothing private,
every row in exactly one file, the year read through the date's index, and a year past the size cap in parts."""

import csv
import hashlib
from datetime import date

import pytest

from awardwatch_pipeline import export
from export_seed import NORTH, PERSON, SERVANT, SUPPLIER_POSTAL, TODAY, seed


def read(path):
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def contract(conn, ref, day, *, vendor=NORTH, withheld=False, value=1_000.0):
    conn.execute(
        "INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, vendor_postal, vendor_withheld, "
        "buyer_id, buyer_name_raw, contract_date, value, original_value, description_en, instrument_type, loaded_at) "
        "VALUES ('dnd-mdn', ?, ?, ?, ?, ?, 'dnd-mdn', NULL, ?, ?, ?, 'Work', 'C', '2026-10-31T01:00:00Z')",
        (ref, f"P-{ref}", None if withheld else vendor, None if withheld else SUPPLIER_POSTAL, 1 if withheld else 0,
         day, value, value))


def grant(conn, ref, start, *, legal=NORTH, withheld=False):
    conn.execute(
        "INSERT INTO grants (owner_org, reference, amendment, agreement_type, legal_name, postal_code, "
        "recipient_withheld, city, value, start, buyer_id, loaded_at) "
        "VALUES ('dnd-mdn', ?, 0, 'G', ?, ?, ?, ?, 500, ?, 'dnd-mdn', '2026-10-31T01:00:00Z')",
        (ref, None if withheld else legal, None if withheld else SUPPLIER_POSTAL, 1 if withheld else 0,
         None if withheld else "Ottawa", start))


def test_published_contracts_and_grants_by_year_as_published_and_nothing_private(conn, tmp_path):
    seed(conn)
    contract(conn, "C-9", "2025-03-01", withheld=True)
    grant(conn, "G-9", "2026-05-01", withheld=True)
    conn.commit()
    out = tmp_path / "csv"
    counts = export.export_csv(conn, out, today=TODAY)
    contracts, grants = read(out / "contracts-2025.csv"), read(out / "grants-2026.csv")
    # One row per published row: the original, its amendment and the third contract; each grant amendment.
    assert [r["reference"] for r in contracts] == ["C-1", "C-2", "C-9"] and counts["contracts-2025.csv"] == 3
    assert [(r["reference"], r["amendment"]) for r in grants] == [("G-1", "0"), ("G-1", "1"), ("G-9", "0")]
    c2 = next(r for r in contracts if r["reference"] == "C-2")
    assert (c2["contract_value"], c2["amendment_value"], c2["original_value"]) == ("130000.00", "30000.00", "")
    assert c2["vendor"] == NORTH and c2["organization"] and c2["buyer_name_en"] == "National Defence"
    assert c2["competitive"] == "0" and c2["solicitation_procedure"] == "TN" and "value_flag" in c2
    withheld = next(r for r in contracts if r["reference"] == "C-9")
    assert withheld["vendor"] == "" and withheld["vendor_withheld"] == "1" and withheld["organization_id"] == ""
    g9 = next(r for r in grants if r["reference"] == "G-9")
    assert g9["legal_name"] == "" and g9["recipient_withheld"] == "1" and g9["city"] == ""
    # No postal code, street or public servant's name in any column, and no column that would hold one.
    for path in (out / "contracts-2025.csv", out / "grants-2026.csv"):
        text = path.read_text(encoding="utf-8-sig")
        header = text.splitlines()[0].split(",")
        assert not {"vendor_postal", "postal_code", "buyer_name", "buyer_name_raw"} & set(header), path.name
        for secret in (SUPPLIER_POSTAL, SERVANT, PERSON):
            assert secret not in text, (path.name, secret)
    # The publisher's prose is scrubbed of contact details, as in every other file.
    c1 = next(r for r in contracts if r["reference"] == "C-1")
    assert c1["description_en"] == "Translation. Fax [contact removed]"


def test_every_row_is_in_exactly_one_file_and_every_name_is_one_the_site_serves(conn, tmp_path):
    seed(conn)
    for ref, day in (("C-OLD", "2003-06-30"), ("C-LATE", "2031-01-01"), ("C-NONE", None), ("C-TEXT", "n/a"),
                     ("C-SLASH", "2024/05/01")):
        contract(conn, ref, day)
    for ref, day in (("G-OLD", "1999-04-01"), ("G-NONE", None)):
        grant(conn, ref, day)
    conn.commit()
    out = tmp_path / "csv"
    counts = export.export_csv(conn, out, today=date(2026, 11, 2))
    names = sorted(n for n in counts if n.startswith(("contracts-", "grants-")))
    assert names == ["contracts-2024.csv", "contracts-2025.csv", "contracts-after-2026.csv", "contracts-before-2004.csv",
                     "contracts-undated.csv", "grants-2026.csv", "grants-before-2005.csv", "grants-undated.csv"]
    assert all(export.YEAR_RE.match(n) for n in names)
    for prefix, table in (("contracts", "contracts"), ("grants", "grants"), ("awards", "awards"),
                          ("history", "contract_history")):
        listed = [r["reference"] for n in counts if n.startswith(f"{prefix}-") for r in read(out / n)]
        assert len(listed) == conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], prefix
    assert [r["reference"] for r in read(out / "contracts-undated.csv")] == ["C-NONE", "C-TEXT"]
    assert [r["reference"] for r in read(out / "contracts-2024.csv")] == ["C-SLASH"]
    assert [r["reference"] for r in read(out / "contracts-before-2004.csv")] == ["C-OLD"]
    sums = (out / "SHA256SUMS").read_text(encoding="utf-8")
    assert all(f"  {n}\n" in sums for n in names)


@pytest.mark.parametrize("prefix,index", [("contracts", "idx_contracts_date"), ("grants", "idx_grants_start")])
def test_a_year_is_read_through_the_date_index(conn, prefix, index):
    """A year's file is a range on the date, which the index serves; a test on substr() would read the whole
    table once a year, two dozen times a night."""
    plan = " ".join(r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + export._yearly_query(prefix), ("2024", "2025")))
    assert index in plan, plan


def test_a_year_past_the_size_cap_goes_on_in_numbered_parts(conn, tmp_path, monkeypatch):
    seed(conn)
    for i in range(7):
        contract(conn, f"C-P{i}", "2025-06-01")
    conn.commit()
    monkeypatch.setattr(export, "CSV_PART_BYTES", 600)
    monkeypatch.setattr(export, "PART_CHECK_ROWS", 2)
    out = tmp_path / "csv"
    counts = export.export_csv(conn, out, today=TODAY)
    # In the order written: the year's file, then -2, -3 and on.
    parts = [n for n in counts if n.startswith("contracts-2025")]
    assert parts[0] == "contracts-2025.csv" and len(parts) > 1 and all(export.YEAR_RE.match(n) for n in parts)
    assert parts[1:] == [f"contracts-2025-{i}.csv" for i in range(2, len(parts) + 1)]
    seen = []
    for name in parts:
        raw = (out / name).read_bytes()
        assert raw.startswith(b"\xef\xbb\xbf") and raw[3:].startswith(b"owner_org,reference,"), name
        rows = read(out / name)
        assert len(rows) == counts[name] and rows, name
        seen += [r["reference"] for r in rows]
    assert seen == sorted(seen) and len(seen) == 9
    sums = dict(reversed(line.split("  ")) for line in (out / "SHA256SUMS").read_text(encoding="utf-8").splitlines())
    assert all(sums[n] == hashlib.sha256((out / n).read_bytes()).hexdigest() for n in parts)
    # A part that would be the tenth stops the export rather than write a name the site does not serve.
    monkeypatch.setattr(export, "CSV_PART_BYTES", 1)
    monkeypatch.setattr(export, "PART_CHECK_ROWS", 1)
    for i in range(7, 12):
        contract(conn, f"C-P{i}", "2025-06-01")
    with pytest.raises(ValueError, match="more than 9 parts"):
        export.export_csv(conn, tmp_path / "cap", today=TODAY)
