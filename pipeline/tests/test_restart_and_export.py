"""A database from an earlier schema opens without a migration step, and a failed
export never leaves a half-written tree for the deploy."""

import json
import sqlite3

import pytest

from awardwatch_pipeline import config, export, export_static, organizations
from awardwatch_pipeline.db import add_missing_columns, connect
from export_seed import TODAY, seed

NOW = "2026-10-17T00:00:00Z"
NEWER_TABLES = ["directory_pages", "organization_aliases", "buyer_years"]


def previous_version(path):
    """A database as an earlier schema left it: a few tables missing, a column dropped."""
    conn = connect(path)
    oid = organizations.upsert(conn, "Acme Supply Ltd", source="awards", province="BC", city="Abbotsford", now=NOW)
    conn.execute("INSERT INTO awards (reference, amendment, supplier_raw, organization_id, source_file, first_seen, "
                 "last_seen) VALUES ('A-1', 0, 'Acme Supply Ltd', ?, 'f', '2026-10-17', '2026-10-17')", (oid,))
    conn.execute("DROP INDEX idx_org_prov")
    conn.execute("ALTER TABLE organizations DROP COLUMN business_number")
    for table in NEWER_TABLES:
        conn.execute(f"DROP TABLE {table}")
    conn.commit()
    conn.close()
    return oid


def test_a_database_from_the_previous_schema_is_brought_up_to_date_without_data_loss(tmp_path):
    db = tmp_path / "old.sqlite"
    oid = previous_version(db)
    conn = connect(db)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert set(NEWER_TABLES) <= tables
    assert "business_number" in {r[1] for r in conn.execute("PRAGMA table_info(organizations)")}
    assert conn.execute("SELECT name FROM sqlite_master WHERE name = 'idx_org_prov'").fetchone() is not None
    row = conn.execute("SELECT display_name, city FROM organizations WHERE id = ?", (oid,)).fetchone()
    assert (row["display_name"], row["city"]) == ("Acme Supply Ltd", "Abbotsford")
    assert conn.execute("SELECT COUNT(*) FROM awards").fetchone()[0] == 1
    # Opening again changes nothing.
    assert add_missing_columns(conn, config.SCHEMA_PATH.read_text(encoding="utf-8")) == []
    conn.close()


def test_a_not_null_column_with_a_default_is_added_with_it(tmp_path):
    conn = sqlite3.connect(tmp_path / "x.sqlite")
    conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)")
    conn.execute("INSERT INTO t (a) VALUES ('kept')")
    added = add_missing_columns(conn, "CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, a TEXT, "
                                      "n INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL);")
    assert added == ["t.n", "t.note"]
    assert conn.execute("SELECT a, n, note FROM t").fetchone() == ("kept", 0, None)


def test_a_failed_export_keeps_the_previous_tree(conn, tmp_path, monkeypatch):
    seed(conn)
    out = tmp_path / "static"
    out.mkdir()
    (out / "stats.json").write_text('{"previous": true}', encoding="utf-8")

    def broken(*args, **kwargs):
        raise RuntimeError("disk full")

    monkeypatch.setattr(export_static, "write_profiles", broken)
    with pytest.raises(RuntimeError):
        export_static.export_static(conn, out, today=TODAY)
    assert json.loads((out / "stats.json").read_text(encoding="utf-8")) == {"previous": True}
    assert not (tmp_path / "static.partial").exists()
    # The temporary tables went with the failure, so the next export starts clean.
    assert conn.execute("SELECT COUNT(*) FROM sqlite_temp_master WHERE type = 'table'").fetchone()[0] == 0
    monkeypatch.undo()
    export_static.export_static(conn, out, today=TODAY)
    assert "counts" in json.loads((out / "stats.json").read_text(encoding="utf-8"))
    assert not (tmp_path / "static.partial").exists()


def test_a_value_json_cannot_carry_stops_the_export_instead_of_publishing_it(conn, tmp_path):
    seed(conn)
    conn.execute("UPDATE awards SET total_value = ? WHERE reference = 'AW-2'", (float("inf"),))
    with pytest.raises(ValueError):
        export_static.export_static(conn, tmp_path / "static", today=TODAY)
    assert not (tmp_path / "static").exists() and not (tmp_path / "static.partial").exists()


def test_csv_files_are_replaced_whole(conn, tmp_path):
    seed(conn)
    out = tmp_path / "csv"
    export.export_csv(conn, out)
    names = sorted(p.name for p in out.iterdir())
    assert names and all(n.endswith(".csv") or n == "SHA256SUMS" for n in names)
