"""families.py and the profile's family block: corporate families from a curated seed, members side by side with
their own figures and never a combined one. Invented firm names, apart from the committed seed's brands."""

import json
import logging
from collections import Counter
from datetime import date

import pytest

from awardwatch_pipeline import cli, export_static, families, merges, organizations
from awardwatch_pipeline.normalize import norm_name, org_id
from test_merges import contract

T1 = "2026-11-16T12:40:00Z"


@pytest.fixture
def seed(tmp_path, monkeypatch):
    path = tmp_path / "organization_families.csv"
    monkeypatch.setattr(families, "SEED_PATH", path)
    # The merges' own seed is left empty, so only the rules merge.
    aliases = tmp_path / "organization_aliases.csv"
    aliases.write_text("from_norm,to_norm,reason,note\n", encoding="utf-8")
    monkeypatch.setattr(merges, "SEED_PATH", aliases)

    def write(*rows: tuple[str, str, str, str]) -> None:
        path.write_text("# a comment\nfamily,member_norm,note,source\n" + "".join(",".join(r) + "\n" for r in rows),
                        encoding="utf-8")

    return write


def members(conn):
    return {(r[0], r[1], r[2]) for r in conn.execute("SELECT family, organization_id, note FROM organization_families")}


def test_the_committed_seed_reads_with_a_source_and_a_known_note_on_every_row():
    rows, bad = families.read_seed()
    assert bad == []
    assert all(r.note in families.NOTES and r.source for r in rows)
    assert Counter(r.family for r in rows) == {"Stantec": 4, "Tetra Tech": 2, "McElhanney": 2}
    assert Counter(r.note for r in rows) == {"subsidiary": 7, "joint venture": 1}
    # Each member's normalized name begins with its brand; no member is in two families.
    assert all(r.member_norm.startswith(r.family.casefold()) for r in rows)
    assert len({r.member_norm for r in rows}) == len(rows)
    header = families.SEED_PATH.read_text(encoding="utf-8")
    assert "family,member_norm,note,source" in header and "subsidiary | affiliate | joint venture" in header
    assert chr(0x2014) not in header


def test_the_stage_writes_the_members_and_skips_what_it_cannot_use(conn, tmp_path, seed, caplog):
    brightmoor = contract(conn, "B1", "Brightmoor Engineering Ltd.")
    contract(conn, "B2", "Brightmoor Engineering Ltd.")
    arch = contract(conn, "B3", "Brightmoor Architecture Ltd.")
    jv = contract(conn, "B4", "BRIGHTMOOR ENGINEERING LTD., Harlowe Inc., IN JOINT VENTURE")
    other = contract(conn, "O1", "Quillfeather Holdings Inc.")
    seed(("Brightmoor", "brightmoor engineering", "subsidiary", "name"),
         ("Brightmoor", "Brightmoor Architecture Ltd.", "subsidiary", "https://example.invalid/annual-report"),
         ("Brightmoor", "brightmoor engineering ltd harlowe inc in joint venture", "joint venture", "name"),
         ("Brightmoor", "brightmoor surveys", "subsidiary", "name"),             # no such organization
         ("Brightmoor", "quillfeather holdings", "parent", "name"),             # a note outside NOTES
         ("Brightmoor", "quillfeather holdings", "affiliate", ""),              # no source
         ("Quillfeather", "brightmoor architecture", "affiliate", "name"))      # already in a family
    organizations.run(conn, now=T1, review_dir=tmp_path / "review")
    with caplog.at_level(logging.INFO, logger="awardwatch_pipeline.families"):
        result = families.run(conn)
    assert members(conn) == {("Brightmoor", brightmoor, "subsidiary"), ("Brightmoor", arch, "subsidiary"),
                             ("Brightmoor", jv, "joint venture")}
    assert result == {"families": 1, "members": 3, "skipped": 4}
    logged = caplog.text
    assert "brightmoor surveys: names no organization with records" in logged
    assert "the note 'parent' is not one of subsidiary, affiliate, joint venture" in logged
    assert "quillfeather holdings: no source" in logged
    assert "brightmoor architecture: already a member of Brightmoor" in logged
    assert other not in {m[1] for m in members(conn)}
    row = conn.execute("SELECT detail, ok FROM sources_log WHERE source = 'families'").fetchone()
    assert (row["detail"], row["ok"]) == ("families=1 members=3 skipped=4", 1)
    # Rebuilt whole: a row taken out of the seed is gone the next night.
    seed(("Brightmoor", "brightmoor engineering", "subsidiary", "name"))
    families.run(conn)
    assert members(conn) == {("Brightmoor", brightmoor, "subsidiary")}


def test_a_member_merged_away_counts_as_the_organization_that_took_its_records(conn, tmp_path, seed):
    full = contract(conn, "S1", "Brightmoor Consulting Ltd.")
    contract(conn, "S2", "Brightmoor Consulting Ltd.")
    short = contract(conn, "S3", "Brightmoor Cnslt.Ltd.")
    seed(("Brightmoor", "brightmoor cnslt", "subsidiary", "name"),
         ("Brightmoor", "brightmoor consulting", "subsidiary", "name"))
    organizations.run(conn, now=T1, review_dir=tmp_path / "review")
    assert conn.execute("SELECT new_id FROM organization_aliases WHERE old_id = ?", (short,)).fetchone()[0] == full
    families.run(conn)
    assert members(conn) == {("Brightmoor", full, "subsidiary")}


def test_the_stage_runs_after_the_merges():
    assert cli.STAGES.index("families") > cli.STAGES.index("organizations")
    assert cli.STAGES.index("families") < cli.STAGES.index("export")


def profile_of(out, oid):
    return json.loads((out / "profiles" / f"{export_static.shard_key(oid)}.json").read_text(encoding="utf-8"))[oid]


def test_each_member_profile_lists_the_family_side_by_side_and_never_a_combined_figure(conn, tmp_path, seed,
                                                                                       monkeypatch):
    big = contract(conn, "B1", "Brightmoor Engineering Ltd.", value=500_000.0)
    contract(conn, "B2", "Brightmoor Engineering Ltd.", value=250_000.0)
    contract(conn, "B3", "Brightmoor Engineering Ltd.", value=1_000.0)
    arch = contract(conn, "B4", "Brightmoor Architecture Ltd.", value=40_000.0)
    contract(conn, "B5", "Brightmoor Architecture Ltd.", value=2_000.0)
    jv = contract(conn, "B6", "BRIGHTMOOR ENGINEERING LTD., Harlowe Inc., IN JOINT VENTURE", value=9_000_000.0)
    loner = contract(conn, "L1", "Quillfeather Holdings Inc.")
    seed(("Brightmoor", "brightmoor engineering", "subsidiary", "name"),
         ("Brightmoor", "brightmoor architecture", "subsidiary", "name"),
         ("Brightmoor", "brightmoor engineering ltd harlowe inc in joint venture", "joint venture", "name"))
    organizations.run(conn, now=T1, review_dir=tmp_path / "review")
    families.run(conn)
    out = tmp_path / "static"
    export_static.export_static(conn, out, csv_dir=tmp_path / "no-csv")
    expected = {"name": "Brightmoor", "members": [
        {"id": big, "display_name": "Brightmoor Engineering Ltd.", "n_records": 3, "note": "subsidiary"},
        {"id": arch, "display_name": "Brightmoor Architecture Ltd.", "n_records": 2, "note": "subsidiary"},
        {"id": jv, "display_name": "BRIGHTMOOR ENGINEERING LTD., Harlowe Inc., IN JOINT VENTURE", "n_records": 1,
         "note": "joint venture"}]}
    for oid in (big, arch, jv):
        p = profile_of(out, oid)
        assert p["family"] == expected
        # Each profile keeps its own figures; the family block adds nothing up: no field beyond these.
        assert set(p["family"]) == {"name", "members"}
        assert all(set(m) == {"id", "display_name", "n_records", "note"} for m in p["family"]["members"])
    assert profile_of(out, big)["organization"]["total_contracts"] == 751_000.0
    assert "family" not in profile_of(out, loner)
    # At most FAMILY_MEMBERS listed, by records; a member past the cap still finds itself, last.
    monkeypatch.setattr(export_static, "FAMILY_MEMBERS", 2)
    blocks = export_static.profile_families(conn, export_static.Model(conn, date(2026, 11, 16)))
    export_static.drop_temp(conn)
    assert [m["id"] for m in blocks[big]["members"]] == [big, arch]
    assert [m["id"] for m in blocks[jv]["members"]] == [big, jv]


def test_the_seed_normalizes_a_name_typed_as_published(tmp_path):
    path = tmp_path / "f.csv"
    path.write_text("family,member_norm,note,source\nBrightmoor,Brightmoor Architecture Ltd.,Subsidiary,name\n",
                    encoding="utf-8")
    [row], bad = families.read_seed(path)
    assert (row.member_norm, row.note, bad) == ("brightmoor architecture", "subsidiary", [])
    assert org_id(row.member_norm) == org_id(norm_name("BRIGHTMOOR ARCHITECTURE LTD"))
