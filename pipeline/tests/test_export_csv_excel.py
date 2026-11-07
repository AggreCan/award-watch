"""The CSV downloads open cleanly in a spreadsheet: a UTF-8 byte-order mark, list fields as plain values,
the sums computed on the bytes written, and the few award dates before 2012 in one file."""

import csv
import hashlib
import re
from datetime import date

from awardwatch_pipeline import export
from export_seed import TODAY, seed


def read(path):
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def test_every_csv_round_trips_through_the_csv_module_with_utf_8_sig(conn, tmp_path):
    ids = seed(conn)
    # A retired id, so the alias map has a row like every other file.
    conn.execute("INSERT INTO organization_aliases (old_id, new_id, normalize_version, created_at, reason, note) "
                 "VALUES ('org-00000000aa', ?, 1, '2026-11-02T00:00:00Z', 'seed', 'former')", (next(iter(ids.values())),))
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
    export.export_csv(conn, out, today=TODAY)
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


def test_award_dates_after_the_data_year_share_one_file_and_every_file_is_offered(conn, tmp_path):
    """A date after the data date's year is a typing error too ("2040"); those rows share one file named for
    the data year, and SHA256SUMS lists only names the Data page offers (site/src/pages/data.tsx)."""
    seed(conn)
    for ref, day in (("LATE-1", "2027-03-01"), ("LATE-2", "2040-01-15"), ("OLD-1", "2011-12-31")):
        conn.execute("INSERT INTO awards (reference, amendment, awarded, published, amount, currency, status, "
                     "source_file, first_seen, last_seen) VALUES (?, 0, ?, ?, 10, 'CAD', 'active', 'f', ?, ?)",
                     (ref, day, day, day, day))
    out = tmp_path / "csv"
    counts = export.export_csv(conn, out, today=date(2026, 11, 2))
    names = sorted(p.name for p in out.iterdir())
    assert "awards-after-2026.csv" in names and "awards-2027.csv" not in names and "awards-2040.csv" not in names
    assert [r["reference"] for r in read(out / "awards-after-2026.csv")] == ["LATE-1", "LATE-2"]
    assert counts["awards-before-2012.csv"] == 1
    # The names site/src/pages/data.tsx offers (DOWNLOADS and YEARLY_DOWNLOAD).
    offered = re.compile(r"^(open-tenders|organizations|organization-aliases|buyers|expiring-3m|expiring-12m)\.csv$|"
                         r"^(awards|history|contracts|grants)-(\d{4}|before-\d{4}|after-\d{4}|undated)(-[2-9])?\.csv$")
    sums = [line.split("  ")[1] for line in (out / "SHA256SUMS").read_text(encoding="utf-8").splitlines()]
    assert sums and all(offered.match(n) for n in sums)
    assert all(int(m.group(1)) <= 2026 for n in sums if (m := re.match(r"^awards-(\d{4})\.csv$", n)))
