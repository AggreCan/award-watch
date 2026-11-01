"""The CSV downloads: the file names the site serves, SHA256SUMS, nothing private, and a stale year removed."""

import csv
import hashlib
import io
import re

import pytest

from awardwatch_pipeline import export
from export_seed import (CONTACT_EMAIL, CONTACT_NAME, PERSON, PERSON_STREET, PROSE_EMAIL, SERVANT, SUPPLIER_STREET,
                         seed)


def rows(path):
    return list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8-sig"))))


def test_the_downloads_and_their_sums(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    counts = export.run(conn, out)
    names = sorted(p.name for p in out.iterdir())
    assert names == ["SHA256SUMS", "awards-2024.csv", "awards-2025.csv", "awards-2026.csv", "buyers.csv",
                     "expiring-12m.csv", "history-2026.csv", "open-tenders.csv", "organizations.csv"]
    assert all(export.YEAR_RE.match(n) for n in names if n.startswith(("awards-", "history-")))
    assert counts["open-tenders.csv"] == 4 and counts["awards-2026.csv"] == 4 and counts["organizations.csv"] == 3
    sums = (out / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
    assert len(sums) == len(names) - 1
    for line in sums:
        digest, name = line.split("  ")
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest
    assert not list(out.glob("*.partial"))
    log = conn.execute("SELECT source, rows_new FROM sources_log").fetchall()
    assert [tuple(r) for r in log] == [("export_csv", 8)]


def test_nothing_private_goes_in_a_file(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    export.export_csv(conn, out)
    text = "".join(p.read_text(encoding="utf-8") for p in out.glob("*.csv"))
    for secret in (PERSON, PERSON_STREET, CONTACT_NAME, CONTACT_EMAIL, SERVANT, SUPPLIER_STREET):
        assert secret not in text
    withheld = next(r for r in rows(out / "awards-2026.csv") if r["reference"] == "AW-5")
    assert withheld["supplier"] == "" and withheld["supplier_withheld"] == "1" and withheld["organization_id"] == ""
    header = (out / "open-tenders.csv").read_text(encoding="utf-8-sig").splitlines()[0]
    assert "contact" not in header and header.startswith("reference,amendment,")


def test_a_year_with_no_rows_left_is_removed_and_files_are_rewritten_whole(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    export.export_csv(conn, out)
    before = (out / "buyers.csv").read_bytes()
    conn.execute("UPDATE awards SET awarded = '2026-01-01', published = '2026-01-02' WHERE awarded LIKE '2024%'")
    export.export_csv(conn, out)
    assert not (out / "awards-2024.csv").exists()
    assert "awards-2024.csv" not in (out / "SHA256SUMS").read_text(encoding="utf-8")
    assert (out / "buyers.csv").read_bytes() == before


@pytest.mark.parametrize("text", [
    "Questions to generic.inbox@tpsgc-pwgsc.gc.ca.",
    "Questions to someone @ tpsgc-pwgsc.gc.ca",
    "Call 613-555-0142", "Call (819) 555 0123", "Call +1 819 555 0123", "Call +1 (819) 555-0124 ext. 12",
    "Fax: 6135550199", "Toll free 1-800-555-0100", "Tel. 613.555.0199 poste 2345", "Number 12345678901234",
])
def test_the_scrub_takes_every_address_and_number_form(text):
    for lang, mark in (("en", "[contact removed]"), ("fr", "[coordonnées retirées]")):
        out = export.scrub(text, lang)
        assert mark in out and "@" not in out and not re.search(r"\d{7,}", out.replace("-", "").replace(" ", "")), out


@pytest.mark.parametrize("text", [
    "Snow removal, 2026-10-31 to 2027-03-31", "Value $1,234,567.89", "Contract W8486-123456/001/XX",
    "Item 12345678 qty 100", "Postal code K1A 0B1",
])
def test_the_scrub_leaves_dates_amounts_and_short_numbers(text):
    assert export.scrub(text) == text


def test_csv_prose_is_scrubbed_in_its_own_language(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    export.export_csv(conn, out)
    text = "".join(p.read_text(encoding="utf-8") for p in out.glob("*.csv"))
    assert "@" not in text and PROSE_EMAIL not in text
    aw2 = next(r for r in rows(out / "awards-2026.csv") if r["reference"] == "AW-2")
    assert aw2["title_en"] == "Award AW-2"
    radar = rows(out / "expiring-12m.csv")
    assert [r["reference"] for r in radar][:2] == ["AW-5", "AW-2"] and radar[0]["supplier_withheld"] == "1"
    assert radar[0]["organization_id"] == "" and len(radar) == 6
