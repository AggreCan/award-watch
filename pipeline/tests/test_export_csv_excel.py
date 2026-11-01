"""The CSV downloads open cleanly in a spreadsheet: a UTF-8 byte-order mark, list fields as plain values,
the sums computed on the bytes written, and the few award dates before 2012 in one file."""

import csv
import hashlib

from awardwatch_pipeline import export
from export_seed import seed


def read(path):
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def test_every_csv_round_trips_through_the_csv_module_with_utf_8_sig(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    export.export_csv(conn, out)
    for path in out.glob("*.csv"):
        assert path.read_bytes().startswith(b"\xef\xbb\xbf"), path.name
        rows = read(path)
        assert rows and not any(k.startswith("﻿") for k in rows[0]), path.name
    buyers = {r["id"]: r for r in read(out / "buyers.csv")}
    assert buyers["dnd-mdn"]["name_fr"] == "Défense nationale"
    sums = dict(reversed(line.split("  ")) for line in (out / "SHA256SUMS").read_text(encoding="utf-8").splitlines())
    assert all(hashlib.sha256((out / name).read_bytes()).hexdigest() == digest for name, digest in sums.items())


def test_a_list_field_is_its_values_joined_by_a_semicolon(conn, tmp_path):
    seed(conn)
    conn.execute("UPDATE tenders SET provinces = '[\"SK\", \"MB\"]', category = '[\"SRV\"]' WHERE reference = 'cb-200-2'")
    out = tmp_path / "csv"
    export.export_csv(conn, out)
    tender = next(r for r in read(out / "open-tenders.csv") if r["reference"] == "cb-200-2")
    assert (tender["provinces"], tender["category"]) == ("SK; MB", "SRV")
    radar = next(r for r in read(out / "expiring-12m.csv") if r["reference"] == "AW-1")
    assert radar["segments"] == "72" and radar["provinces"] == "ON"
    text = "".join(p.read_text(encoding="utf-8-sig") for p in out.glob("*.csv"))
    assert '["' not in text
    # Text that is not a JSON list of strings is written as it is.
    assert export._flat("[Amended] Snow removal") == "[Amended] Snow removal" and export._flat("[1, 2]") == "[1, 2]"
    assert export._flat("[]") == ""


def test_award_dates_before_2012_share_one_file(conn, tmp_path):
    seed(conn)
    for ref, day in (("OLD-1", "1996-05-01"), ("OLD-2", "2011-12-31")):
        conn.execute("INSERT INTO awards (reference, amendment, awarded, published, amount, currency, status, "
                     "source_file, first_seen, last_seen) VALUES (?, 0, ?, ?, 10, 'CAD', 'active', 'f', ?, ?)",
                     (ref, day, day, day, day))
    out = tmp_path / "csv"
    (out).mkdir()
    (out / "awards-1996.csv").write_text("left from an earlier night\n", encoding="utf-8")
    counts = export.export_csv(conn, out)
    names = sorted(p.name for p in out.iterdir())
    assert "awards-before-2012.csv" in names and "awards-1996.csv" not in names and "awards-2011.csv" not in names
    assert counts["awards-before-2012.csv"] == 2
    assert [r["reference"] for r in read(out / "awards-before-2012.csv")] == ["OLD-1", "OLD-2"]
    assert all(export.YEAR_RE.match(n) for n in names if n.startswith(("awards-", "history-")))
    sums = (out / "SHA256SUMS").read_text(encoding="utf-8")
    assert "awards-before-2012.csv" in sums and "awards-1996.csv" not in sums
