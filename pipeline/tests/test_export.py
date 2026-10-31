"""The CSV downloads: the file names the site serves, SHA256SUMS, nothing private, and a stale year removed."""

import csv
import hashlib
import io

from awardwatch_pipeline import export
from export_seed import CONTACT_EMAIL, CONTACT_NAME, PERSON, PERSON_STREET, SERVANT, SUPPLIER_STREET, seed


def rows(path):
    return list(csv.DictReader(io.StringIO(path.read_text(encoding="utf-8"))))


def test_the_downloads_and_their_sums(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    counts = export.run(conn, out)
    names = sorted(p.name for p in out.iterdir())
    assert names == ["SHA256SUMS", "awards-2024.csv", "awards-2025.csv", "awards-2026.csv", "buyers.csv",
                     "history-2026.csv", "open-tenders.csv", "organizations.csv"]
    assert all(export.YEAR_RE.match(n) for n in names if n.startswith(("awards-", "history-")))
    assert counts["open-tenders.csv"] == 4 and counts["awards-2026.csv"] == 4 and counts["organizations.csv"] == 3
    sums = (out / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
    assert len(sums) == len(names) - 1
    for line in sums:
        digest, name = line.split("  ")
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest
    assert not list(out.glob("*.partial"))
    log = conn.execute("SELECT source, rows_new FROM sources_log").fetchall()
    assert [tuple(r) for r in log] == [("export_csv", 7)]


def test_nothing_private_goes_in_a_file(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    export.export_csv(conn, out)
    text = "".join(p.read_text(encoding="utf-8") for p in out.glob("*.csv"))
    for secret in (PERSON, PERSON_STREET, CONTACT_NAME, CONTACT_EMAIL, SERVANT, SUPPLIER_STREET):
        assert secret not in text
    withheld = next(r for r in rows(out / "awards-2026.csv") if r["reference"] == "AW-5")
    assert withheld["supplier"] == "" and withheld["supplier_withheld"] == "1" and withheld["organization_id"] == ""
    header = (out / "open-tenders.csv").read_text(encoding="utf-8").splitlines()[0]
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
