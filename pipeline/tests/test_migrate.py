"""The identity migration: on a change to the name rules every record moves to the id its spelling
now gives, retired ids leave aliases the export follows, and a second run changes nothing."""

import json

from awardwatch_pipeline import cli, export_static, migrate, organizations
from awardwatch_pipeline.db import get_meta, set_meta
from awardwatch_pipeline.normalize import NORMALIZE_VERSION, norm_name, org_id

NOW = "2026-10-31T00:00:00Z"
OLD_A = "org-aaaaaaaaaa"
OLD_B = "org-bbbbbbbbbb"


def legacy(conn):
    """Records filed under ids an earlier rule set made: two spellings of one firm under two ids,
    one of them also on a published contract, and a withheld row that stays as it is."""
    for oid, name in ((OLD_A, "Acme Ltd."), (OLD_B, "ACME LIMITED")):
        conn.execute("INSERT INTO organizations (id, display_name, norm_name, updated_at) VALUES (?, ?, ?, ?)",
                     (oid, name, "old " + name.lower(), NOW))
    for ref, oid, name in (("A-1", OLD_A, "Acme Ltd."), ("A-2", OLD_B, "ACME LIMITED"), ("A-3", OLD_B, "ACME LIMITED")):
        conn.execute("INSERT INTO awards (reference, amendment, supplier_raw, organization_id, awarded, total_value, "
                     "source_file, first_seen, last_seen) VALUES (?, 0, ?, ?, '2026-01-01', 10, 'f', ?, ?)",
                     (ref, name, oid, NOW[:10], NOW[:10]))
    conn.execute("INSERT INTO awards (reference, amendment, supplier_raw, supplier_withheld, source_file, first_seen, "
                 "last_seen) VALUES ('A-9', 0, NULL, 1, 'f', ?, ?)", (NOW[:10], NOW[:10]))
    conn.execute("INSERT INTO contracts (owner_org, reference, vendor_raw, organization_id, loaded_at) "
                 "VALUES ('dnd-mdn', 'C-1', 'Acme Ltd.', ?, ?)", (OLD_A, NOW))
    conn.execute("INSERT INTO registry_matches (organization_id, registry, registry_id, grade, checked_at) "
                 "VALUES (?, 'corporations_canada', '123', 'exact', ?)", (OLD_A, NOW))
    # An alias an earlier migration wrote now points at an id this one retires.
    conn.execute("INSERT INTO organization_aliases (old_id, new_id, normalize_version, created_at) "
                 "VALUES ('org-cccccccccc', ?, 1, ?)", (OLD_B, NOW))
    set_meta(conn, migrate.META_KEY, NORMALIZE_VERSION - 1)
    conn.commit()


def test_records_move_to_the_new_id_and_retired_ids_become_aliases(conn, tmp_path):
    legacy(conn)
    new = org_id(norm_name("Acme Ltd."))
    assert new == org_id(norm_name("ACME LIMITED"))
    report = migrate.ensure_current(conn, now=NOW)
    assert report.rows_moved == 4 and report.ids_retired == 2 and report.aliases_moved == 1
    assert {r[0] for r in conn.execute("SELECT organization_id FROM awards WHERE supplier_withheld = 0")} == {new}
    assert conn.execute("SELECT organization_id FROM awards WHERE reference = 'A-9'").fetchone()[0] is None
    assert conn.execute("SELECT organization_id FROM contracts").fetchone()[0] == new
    org = conn.execute("SELECT display_name, n_awards, n_contracts FROM organizations WHERE id = ?", (new,)).fetchone()
    # Two rows each: the tie goes to the spelling in mixed case.
    assert tuple(org) == ("Acme Ltd.", 3, 1)
    # The old ids are gone with their registry rows; the registry stage checks the new one.
    assert conn.execute("SELECT COUNT(*) FROM organizations WHERE id IN (?, ?)", (OLD_A, OLD_B)).fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM registry_matches").fetchone()[0] == 0
    aliases = dict(conn.execute("SELECT old_id, new_id FROM organization_aliases"))
    assert aliases == {OLD_A: new, OLD_B: new, "org-cccccccccc": new}
    assert get_meta(conn, migrate.META_KEY) == str(NORMALIZE_VERSION)
    log = conn.execute("SELECT source, rows_new FROM sources_log").fetchall()
    assert [tuple(r) for r in log] == [("migrate", 4)]

    out = tmp_path / "static"
    export_static.write_aliases(conn, out)
    shard = json.loads((out / "aliases" / "aaa.json").read_text(encoding="utf-8"))
    assert shard == {OLD_A: new}
    assert export_static.resolve_aliases(conn)["org-cccccccccc"] == new


def test_a_second_run_changes_nothing(conn):
    legacy(conn)
    migrate.ensure_current(conn, now=NOW)
    before = conn.execute("SELECT id, updated_at FROM organizations ORDER BY id").fetchall()
    assert migrate.ensure_current(conn, now="2026-11-01T00:00:00Z") is None
    set_meta(conn, migrate.META_KEY, NORMALIZE_VERSION - 1)
    report = migrate.migrate(conn, now="2026-11-01T00:00:00Z")
    assert report.rows_moved == 0 and report.ids_retired == 0
    assert [tuple(r) for r in conn.execute("SELECT id, updated_at FROM organizations ORDER BY id")] == \
        [tuple(r) for r in before]


def test_a_new_database_only_records_the_version(conn):
    assert migrate.ensure_current(conn) is None
    assert get_meta(conn, migrate.META_KEY) == str(NORMALIZE_VERSION)
    assert conn.execute("SELECT COUNT(*) FROM sources_log").fetchone()[0] == 0


def test_a_database_with_no_version_key_is_checked_and_left_alone_when_current(conn):
    oid = organizations.upsert(conn, "Current Ltd", source="awards", now=NOW)
    conn.execute("INSERT INTO awards (reference, amendment, supplier_raw, organization_id, source_file, first_seen, "
                 "last_seen) VALUES ('A-1', 0, 'Current Ltd', ?, 'f', ?, ?)", (oid, NOW[:10], NOW[:10]))
    conn.commit()
    report = migrate.ensure_current(conn, now=NOW)
    assert report.rows_moved == 0 and report.ids_retired == 0
    assert conn.execute("SELECT COUNT(*) FROM organization_aliases").fetchone()[0] == 0


def test_the_run_command_migrates_before_any_stage(conn, monkeypatch):
    legacy(conn)
    calls = []
    runners = {stage: (lambda s=stage: calls.append(s)) for stage in cli.STAGES}
    monkeypatch.setattr(cli, "stage_runners", lambda conn, client, samples: runners)
    assert cli.run(conn, ["export"], samples=object()) == 0
    assert calls == ["export"]
    assert get_meta(conn, migrate.META_KEY) == str(NORMALIZE_VERSION)
