"""The hosted search sync (search_db.py): the rows, the hash and the diff against
the ledger, the statement and batch caps, the literals, the batches applied to
a real SQLite database built from search_schema.sql (its full-text indexes and
triggers included), the count check and the three commands."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from awardwatch_pipeline import cli, config, organizations
from awardwatch_pipeline import export_static as es
from awardwatch_pipeline import search_db as sd
from awardwatch_pipeline.db import connect, get_meta, set_meta
from export_seed import ACME, FOREIGN, NORTH, STAMP, TODAY, award, seed

BASE = "https://awardwatch.example"
BN = "123456782"          # passes the check digit
OTHER_BN = "876543216"
ACME_SPELLING = "Acme Defense Systems Corporation"


def _seed(conn: sqlite3.Connection, static: Path) -> dict[str, str]:
    ids = seed(conn)
    # A second spelling, a business number on two sources and the buyers'
    # other spellings, as the loaders would leave them.
    conn.execute("INSERT INTO organization_names (organization_id, raw_name, source, n) VALUES (?, ?, 'awards', 3)",
                 (ids[ACME], ACME_SPELLING))
    conn.execute("INSERT INTO organization_names (organization_id, raw_name, source, n) VALUES (?, ?, 'awards', 1)",
                 (ids[ACME], "ACME DEFENCE INC."))
    conn.execute("UPDATE grants SET business_number = ? WHERE legal_name = ?", (BN + "RC0001", NORTH))
    conn.execute("INSERT INTO federal_corporations (number, legal_name, norm_name, source_url, business_number) "
                 "VALUES ('1234567', ?, 'northern translation', 'https://example.org', ?)", (NORTH, OTHER_BN))
    conn.execute("INSERT INTO registry_matches (organization_id, registry, registry_id, grade, checked_at) "
                 "VALUES (?, 'corporations_canada', '1234567', 'exact', ?)", (ids[NORTH], STAMP))
    conn.executemany("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, ?, ?)", [
        ("Department of National Defence (DND)", "canadabuys", "dnd-mdn"),
        ("NATIONAL DEFENCE", "ckan", "dnd-mdn"),
        ("Public Works and Government Services Canada", "seed", "pwgsc-tpsgc"),
    ])
    conn.commit()
    es.export_static(conn, static, today=TODAY, base_url=BASE)
    return ids


@pytest.fixture
def seeded(conn, tmp_path):
    static = tmp_path / "static"
    ids = _seed(conn, static)
    return conn, static, ids


def d1() -> sqlite3.Connection:
    """A stand-in for the D1 database: SQLite with the search schema applied."""
    db = sqlite3.connect(":memory:")
    db.executescript(sd.SCHEMA_PATH.read_text(encoding="utf-8"))
    return db


def apply(db: sqlite3.Connection, out: Path, manifest: dict) -> None:
    for name in manifest["batches"]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    db.commit()


def counts(db: sqlite3.Connection) -> dict[str, int]:
    row = db.execute(sd.COUNT_SQL).fetchone()
    return {"search_orgs": row[0], "search_buyers": row[1]}


def match(db: sqlite3.Connection, table: str, expr: str) -> set[str]:
    return {r[0] for r in db.execute(
        f"SELECT t.id FROM {table} t WHERE t.rid IN (SELECT rowid FROM {table}_fts WHERE {table}_fts MATCH ?)", (expr,))}


def sync_once(conn: sqlite3.Connection, static: Path, out: Path, db: sqlite3.Connection, **kwargs) -> dict:
    """search-sync, the apply, the count check and search-synced, as the workflow runs them."""
    manifest = sd.sync(conn, out, static_dir=static, **kwargs)
    apply(db, out, manifest)
    assert sd.count_check(sd.expected_counts(manifest), counts(db)) is None
    sd.record_sync(conn, manifest)
    return manifest


# -- the rows ----------------------------------------------------------------


def test_fold_is_the_sites_fold():
    assert sd.fold("Ferme Éloïse Québec Inc.") == "ferme eloise quebec inc"
    assert sd.fold("O'Brien & Sons, Ltd.") == "o brien sons ltd"
    assert sd.fold("  IBM_Canada  ") == "ibm canada"
    assert sd.fold(None) == "" and sd.fold("--") == ""


def test_spellings_drop_what_folds_alike_and_stop_at_the_caps():
    assert sd.spelling_list("Acme Inc.", ["ACME INC", "Acme  Holdings\nGroup", "acme holdings group", "", "Other"]) == [
        "Acme Holdings Group", "Other"]
    many = [f"Name {i}" for i in range(100)]
    assert len(sd.spelling_list("X", many)) == sd.MAX_SPELLINGS
    assert sd.spelling_list("X", ["a" * 30, "b" * 30, "c" * 30], max_chars=70) == ["a" * 30, "b" * 30]


def test_organization_rows_carry_the_names_numbers_and_figures(seeded):
    conn, _, ids = seeded
    rows = list(sd.org_rows(conn))
    assert [r["id"] for r in rows] == sorted(ids.values())
    by = {r["id"]: r for r in rows}
    acme = by[ids[ACME]]
    # The display name, then the other spelling; "ACME DEFENCE INC." folds like the display name and is left out.
    assert (acme["name"], acme["alt"], acme["folds"]) == ("Acme Defence Inc.", ACME_SPELLING, "acme defence inc")
    assert acme["prov"] == "ON" and acme["city"] == "Ottawa"
    assert acme["n_records"] == acme["n_awards"] + acme["n_history"] + acme["n_contracts"] + acme["n_grants"] + acme["n_lobbying"] == 4
    profile = conn.execute("SELECT total_awards, total_history FROM organizations WHERE id = ?", (ids[ACME],)).fetchone()
    assert (acme["total_awards"], acme["total_history"]) == (profile[0], profile[1])
    # The grants' number and the exact registry match's, the nine digits only.
    assert by[ids[NORTH]]["bn"] == f"{BN} {OTHER_BN}"
    assert by[ids[FOREIGN]]["prov"] == "XX"


def test_a_probable_registry_match_gives_no_number(seeded):
    conn, _, ids = seeded
    conn.execute("UPDATE registry_matches SET grade = 'probable'")
    assert {r["id"]: r["bn"] for r in sd.org_rows(conn)}[ids[NORTH]] == BN


def test_an_alias_name_finds_its_target(seeded):
    conn, _, ids = seeded
    conn.execute("INSERT INTO organization_aliases (old_id, new_id, normalize_version, created_at) "
                 "VALUES ('org-0000000001', ?, 1, ?)", (ids[ACME], STAMP))
    # The table as it is carries no name, so the alias adds none.
    assert {r["id"]: r["alt"] for r in sd.org_rows(conn)}[ids[ACME]] == ACME_SPELLING
    # Once it carries one, the name sits beside the live organization's
    # spellings, through a chain of retired ids too.
    conn.execute("ALTER TABLE organization_aliases ADD COLUMN name TEXT")
    conn.execute("UPDATE organization_aliases SET name = 'Big Acme Holdings' WHERE old_id = 'org-0000000001'")
    conn.execute("INSERT INTO organization_aliases (old_id, new_id, normalize_version, created_at, name) "
                 "VALUES ('org-0000000002', 'org-0000000001', 1, ?, 'Acme Group Old Name')", (STAMP,))
    alt = {r["id"]: r["alt"] for r in sd.org_rows(conn)}[ids[ACME]].split("\n")
    assert alt == [ACME_SPELLING, "Big Acme Holdings", "Acme Group Old Name"]


def test_a_merged_organizations_spelling_finds_the_survivor(seeded, tmp_path):
    conn, static, ids = seeded
    # A second profile for the same business, then a merge as merges.py
    # makes one: its records move to the survivor, its id becomes an alias,
    # and the nightly recompute rebuilds the names from the records.
    old = organizations.upsert(conn, "Acme Def. Sys. (Canada)", source="awards")
    award(conn, "AW-9", 0, "Acme Def. Sys. (Canada)", value=10_000.0, awarded="2026-01-05")
    conn.execute("UPDATE awards SET organization_id = ? WHERE organization_id = ?", (ids[ACME], old))
    conn.execute("INSERT INTO organization_aliases (old_id, new_id, normalize_version, created_at) VALUES (?, ?, 1, ?)",
                 (old, ids[ACME], STAMP))
    organizations.recompute(conn, now=STAMP)
    rows = {r["id"]: r for r in sd.org_rows(conn)}
    assert old not in rows
    assert "Acme Def. Sys. (Canada)" in rows[ids[ACME]]["alt"].split("\n")
    db = d1()
    sync_once(conn, static, tmp_path / "search", db)
    assert match(db, "search_orgs", '"def" "sys" "canada"') == {ids[ACME]}


def test_a_retired_buyer_id_finds_the_buyer_it_leads_to(seeded, tmp_path):
    conn, static, _ = seeded
    (static / "buyers" / "aliases.json").write_text(json.dumps({"aliases": {
        "department-of-national-defence": "dnd-mdn", "public-works-government-services": "pwgsc-tpsgc",
        "Not An Id": "dnd-mdn", "dnd-mdn": "dnd-mdn"}}), encoding="utf-8")
    rows = {r["id"]: r for r in sd.buyer_rows(conn, static)}
    # After the acronyms, before the other spellings; a malformed or circular entry adds nothing.
    assert rows["dnd-mdn"]["alt"].split("\n") == ["DND", "department-of-national-defence", "Department of National Defence (DND)"]
    assert "public-works-government-services" in rows["pwgsc-tpsgc"]["alt"].split("\n")
    db = d1()
    sync_once(conn, static, tmp_path / "search", db)
    assert match(db, "search_buyers", '"public" "works" "government"') == {"pwgsc-tpsgc"}
    (static / "buyers" / "aliases.json").write_text('{"aliases": []}', encoding="utf-8")
    with pytest.raises(ValueError, match="holds no aliases object"):
        list(sd.buyer_rows(conn, static))


def test_buyer_rows_are_the_buyers_with_a_page(seeded):
    conn, static, _ = seeded
    rows = {r["id"]: r for r in sd.buyer_rows(conn, static)}
    # never-buys names no record, so it has no page and no row.
    assert sorted(rows) == ["dnd-mdn", "pwgsc-tpsgc"]
    dnd = rows["dnd-mdn"]
    assert (dnd["name"], dnd["name_fr"], dnd["acronym_en"]) == ("National Defence", "Défense nationale", "DND")
    # Acronyms and the other spellings; the French name has a column of its
    # own, and "NATIONAL DEFENCE" folds like the English name.
    assert dnd["alt"].split("\n") == ["DND", "Department of National Defence (DND)"]
    assert dnd["folds"].split("\n") == ["national defence", "defense nationale", "dnd"]
    index = {b["id"]: b for b in json.loads((static / "buyers" / "index.json").read_text(encoding="utf-8"))["buyers"]}
    for key in ("n_tenders", "n_open_tenders", "n_awards", "n_history", "total_awards", "total_history", "total_grants"):
        assert dnd[key] == index["dnd-mdn"][key], key
    assert "Public Works and Government Services Canada" in rows["pwgsc-tpsgc"]["alt"].split("\n")


def test_a_missing_buyer_index_stops_the_sync(conn, tmp_path):
    seed(conn)
    with pytest.raises(FileNotFoundError):
        list(sd.buyer_rows(conn, tmp_path / "nowhere"))


def test_the_hash_changes_exactly_when_a_value_does(seeded):
    conn, _, ids = seeded
    row = next(r for r in sd.org_rows(conn) if r["id"] == ids[ACME])
    h = sd.row_hash(sd.ORGS, row)
    assert len(h) == 16 and h == sd.row_hash(sd.ORGS, dict(row))
    for column, value in (("n_awards", row["n_awards"] + 1), ("city", None), ("city", ""), ("alt", row["alt"] + " "),
                          ("total_grants", 0), ("total_grants", 0.01)):
        changed = {**row, column: value}
        assert sd.row_hash(sd.ORGS, changed) != h, (column, value)
    assert sd.row_hash(sd.ORGS, {**row, "city": None}) != sd.row_hash(sd.ORGS, {**row, "city": ""})


# -- the plan ----------------------------------------------------------------


def test_the_first_sync_is_a_full_reload_and_the_next_sends_only_changes(seeded, tmp_path):
    conn, static, ids = seeded
    db = d1()
    out = tmp_path / "search"
    first = sync_once(conn, static, out, db)
    assert first["full"] and first["reason"] == "first load (the ledger is empty)"
    assert first["upserts"] == {"search_orgs": 3, "search_buyers": 2} == first["expected"]
    assert first["deletes"] == {"search_orgs": 0, "search_buyers": 0}
    assert get_meta(conn, sd.META_FULL_AT)
    assert conn.execute("SELECT COUNT(*) FROM search_ledger").fetchone()[0] == 5

    # Nothing changed: nothing to send, no batch at all.
    plan = sd.plan_sync(conn, static)
    assert not plan.full and plan.upserts == {"search_orgs": [], "search_buyers": []}
    assert plan.deletes == {"search_orgs": [], "search_buyers": []} and plan.record == [] and plan.forget == []
    assert sd.write_batches(plan, out)["batches"] == []

    # One count changed: that row only.
    conn.execute("UPDATE organizations SET n_lobbying = n_lobbying + 1 WHERE id = ?", (ids[NORTH],))
    plan = sd.plan_sync(conn, static)
    assert [v[0] for v in plan.upserts["search_orgs"]] == [ids[NORTH]] and plan.upserts["search_buyers"] == []
    assert [key for key, _ in plan.record] == [f"o:{ids[NORTH]}"]

    # Keys the ledger holds and tonight's rows lack are deleted from their
    # table; a key of no known table only leaves the ledger.
    conn.executemany("INSERT INTO search_ledger (key, hash) VALUES (?, 'x')",
                     [("o:org-ffffffffff",), ("b:gone-buyer",), ("z:what",)])
    plan = sd.plan_sync(conn, static)
    assert plan.deletes == {"search_orgs": ["org-ffffffffff"], "search_buyers": ["gone-buyer"]}
    assert plan.forget == ["b:gone-buyer", "o:org-ffffffffff", "z:what"] and plan.left_out == 1
    assert plan.totals == {"search_orgs": 3, "search_buyers": 2}


def test_a_full_reload_is_asked_for_and_spaced_out(conn):
    assert sd.full_reason(conn, requested=True) == "requested"
    assert sd.full_reason(conn, ledger_empty=True, today="2026-11-01") == "first load (the ledger is empty)"
    assert sd.full_reason(conn, today="2026-11-01") == ""
    set_meta(conn, sd.META_RELOAD, "2026-11-02")
    assert sd.full_reason(conn, today="2026-11-03") == "the row counts read back from D1 disagreed on 2026-11-02"
    # Not within RELOAD_MIN_DAYS of the last one, unless asked for.
    set_meta(conn, sd.META_FULL_AT, "2026-10-30")
    assert sd.full_reason(conn, today="2026-11-03") == ""
    assert sd.full_reason(conn, ledger_empty=True, today="2026-11-03") == ""
    assert sd.full_reason(conn, requested=True, today="2026-11-03") == "requested"
    assert sd.full_reason(conn, today="2026-11-06") != ""


# -- statements and batches --------------------------------------------------


def _org_values(i: int, name: str = "Name") -> tuple:
    row = {c: 0 for c in sd.ORGS.columns}
    row.update(id=f"org-{i:010x}", name=f"{name} {i}", alt="", bn="", folds=f"name {i}", prov="ON", city=None,
               total_awards=None, total_history=None, total_contracts=None, total_grants=None)
    return tuple(row[c] for c in sd.ORGS.columns) + (sd.row_hash(sd.ORGS, row),)


def test_statements_respect_the_row_and_byte_caps():
    rows = [_org_values(i) for i in range(7)]
    statements = list(sd.upsert_statements(sd.ORGS, rows, max_rows=3))
    assert [s.count("'org-") for s in statements] == [3, 3, 1]
    assert all(s.startswith("INSERT INTO search_orgs (id, name,") and s.endswith(
        "WHERE search_orgs.hash IS NOT excluded.hash;") for s in statements)
    assert "ON CONFLICT (id) DO UPDATE SET name = excluded.name" in statements[0] and "rid" not in statements[0]
    one = len(next(sd.upsert_statements(sd.ORGS, rows[:1])).encode())
    # Room for one row and a little more: one row to a statement.
    by_bytes = list(sd.upsert_statements(sd.ORGS, rows, max_bytes=one + 20))
    assert len(by_bytes) == 7 and all(len(s.encode()) <= one + 20 for s in by_bytes)
    # Room for two rows and the ", " between them (the rows here are all one length).
    row = len(sd.row_tuple(sd.ORGS, rows[0]).encode())
    two = list(sd.upsert_statements(sd.ORGS, rows, max_bytes=one + row + 2))
    assert [s.count("'org-") for s in two] == [2, 2, 2, 1]
    huge = _org_values(9, name="x" * 70_000)
    with pytest.raises(ValueError, match="search_orgs row 'org-0000000009'.*over the 65536-byte statement limit"):
        list(sd.upsert_statements(sd.ORGS, [huge]))
    deletes = list(sd.delete_statements(sd.BUYERS, [f"b-{i}" for i in range(7)], max_keys=3))
    assert deletes[0] == "DELETE FROM search_buyers WHERE id IN ('b-0', 'b-1', 'b-2');" and len(deletes) == 3


def test_batches_respect_the_file_caps_and_the_manifest_comes_last(seeded, tmp_path):
    conn, static, _ = seeded
    plan = sd.plan_sync(conn, static)
    out = tmp_path / "search"
    (out).mkdir()
    (out / "batch-0099.sql").write_text("left over")
    manifest = sd.write_batches(plan, out, max_bytes=8_000, max_statements=2, max_rows_per_upsert=1)
    files = sorted(p.name for p in out.glob("batch-*.sql"))
    assert files == manifest["batches"] and "batch-0099.sql" not in files and len(files) > 2
    assert (out / sd.BATCH_LIST).read_text() == "".join(f"{f}\n" for f in files)
    assert not (out / (sd.MANIFEST + ".partial")).exists()
    # The reset is a batch of its own and comes first.
    reset = (out / files[0]).read_text(encoding="utf-8")
    assert reset.startswith("-- Full reload") and "DROP TABLE IF EXISTS search_orgs_fts;" in reset
    assert "CREATE TABLE IF NOT EXISTS search_buyers" in reset and "INSERT INTO" not in reset.split("CREATE TRIGGER")[0]
    for name in files[1:]:
        body = (out / name).read_bytes()
        assert len(body) <= 8_000 and body.count(b";\n") <= 2
    # The reset counts as one statement; every other ends a line with ";".
    assert manifest["statements"] == 1 + sum((out / f).read_bytes().count(b";\n") for f in files[1:])
    assert manifest["bytes"] == sum((out / f).stat().st_size for f in files)
    assert manifest["record"]["upserts"] == [list(e) for e in plan.record]
    # A plan with nothing in it writes no batch and an empty list.
    empty = sd.SyncPlan(upserts={"search_orgs": [], "search_buyers": []}, deletes={"search_orgs": [], "search_buyers": []},
                        record=[], forget=[], totals={"search_orgs": 3, "search_buyers": 2})
    assert sd.write_batches(empty, out)["batches"] == [] and (out / sd.BATCH_LIST).read_text() == ""
    assert not list(out.glob("batch-*.sql"))


def test_literals_cannot_break_out_of_a_string():
    assert sd.sql_literal("O'Brien'); DROP TABLE search_orgs; --") == "'O''Brien''); DROP TABLE search_orgs; --'"
    assert sd.sql_literal(None) == "NULL" and sd.sql_literal(True) == "1" and sd.sql_literal(7) == "7"
    assert sd.sql_literal(0.1) == "0.1" and sd.sql_literal("a\nb") == "'a\nb'"
    for bad in ("nul\x00here", float("nan"), float("inf"), 2 ** 64):
        with pytest.raises(ValueError):
            sd.sql_literal(bad)
    with pytest.raises(TypeError):
        sd.sql_literal(b"bytes")
    db = d1()
    hostile = "x'); DELETE FROM search_orgs; --\n\"quoted\" \\ ; 'é"
    db.execute(f"SELECT {sd.sql_literal(hostile)}")
    assert db.execute(f"SELECT {sd.sql_literal(hostile)}").fetchone()[0] == hostile


# -- applied to the schema -------------------------------------------------------


def test_the_schema_applies_twice_unchanged():
    db = d1()
    before = db.execute("SELECT type, name, sql FROM sqlite_master ORDER BY name").fetchall()
    db.executescript(sd.SCHEMA_PATH.read_text(encoding="utf-8"))
    assert db.execute("SELECT type, name, sql FROM sqlite_master ORDER BY name").fetchall() == before
    names = {r[1] for r in before}
    assert {"search_orgs", "search_buyers", "search_orgs_fts", "search_buyers_fts", "search_orgs_au"} <= names


def test_batches_fill_the_indexes_and_a_second_apply_changes_nothing(seeded, tmp_path):
    conn, static, ids = seeded
    db = d1()
    out = tmp_path / "search"
    manifest = sync_once(conn, static, out, db)
    assert counts(db) == {"search_orgs": 3, "search_buyers": 2}
    assert match(db, "search_orgs", '"acme"*') == {ids[ACME]}
    assert match(db, "search_orgs", '"defense" "systems"') == {ids[ACME]}
    assert match(db, "search_orgs", f'"{BN}"') == {ids[NORTH]}
    assert match(db, "search_buyers", '"defense"') == {"dnd-mdn"}
    assert match(db, "search_buyers", '"pwgsc"') == set() and match(db, "search_buyers", '"works"') == {"pwgsc-tpsgc"}
    # Every statement gives the same result applied twice.
    apply(db, out, manifest)
    assert counts(db) == {"search_orgs": 3, "search_buyers": 2}
    assert match(db, "search_orgs", '"acme"*') == {ids[ACME]}


def test_a_rename_and_a_removal_reach_the_full_text_index(seeded, tmp_path):
    conn, static, ids = seeded
    db = d1()
    out = tmp_path / "search"
    sync_once(conn, static, out, db)
    conn.execute("UPDATE organizations SET display_name = 'Acme Renamed Inc.' WHERE id = ?", (ids[ACME],))
    index = json.loads((static / "buyers" / "index.json").read_text(encoding="utf-8"))
    index["buyers"] = [b for b in index["buyers"] if b["id"] != "dnd-mdn"]
    (static / "buyers" / "index.json").write_text(json.dumps(index), encoding="utf-8")
    manifest = sync_once(conn, static, out, db)
    assert not manifest["full"] and manifest["upserts"] == {"search_orgs": 1, "search_buyers": 0}
    assert manifest["deletes"] == {"search_orgs": 0, "search_buyers": 1}
    assert match(db, "search_orgs", 'name : "renamed"') == {ids[ACME]}
    assert match(db, "search_orgs", 'name : "defence"') == set()
    # The old display name is still one of its spellings, so it still finds it.
    assert match(db, "search_orgs", '"acme" "defence"') == {ids[ACME]}
    assert match(db, "search_buyers", '"defence"') == set() and counts(db)["search_buyers"] == 1
    assert db.execute("SELECT COUNT(*) FROM search_buyers_fts WHERE search_buyers_fts MATCH '\"dnd\"'").fetchone()[0] == 0
    ledger = {k for (k,) in conn.execute("SELECT key FROM search_ledger")}
    assert "b:dnd-mdn" not in ledger and len(ledger) == 4


# -- the count check and the ledger ------------------------------------------------


def test_the_count_answer_is_read_from_wranglers_json():
    answer = '[{"results":[{"orgs":373261,"buyers":412}],"success":true,"meta":{"rows_read":373673}}]'
    assert sd.parse_counts(answer) == {"search_orgs": 373261, "search_buyers": 412}
    assert sd.parse_counts("A notice first\n" + answer + "\n") == {"search_orgs": 373261, "search_buyers": 412}
    for bad in ("", "not json", "[]", '[{"results":[]}]', '[{"results":[{"orgs":1}]}]',
                '[{"results":[{"orgs":-1,"buyers":2}]}]', '[{"results":[{"orgs":"1","buyers":2}]}]'):
        with pytest.raises(ValueError):
            sd.parse_counts(bad)
    assert sd.count_check({"search_orgs": 3, "search_buyers": 2}, {"search_orgs": 3, "search_buyers": 2}) is None
    assert sd.count_check({"search_orgs": 3, "search_buyers": 2}, {"search_orgs": 3, "search_buyers": 1}) == (
        "search_buyers holds 1 rows where the manifest expects 2")


def test_the_ledger_refuses_a_manifest_planned_against_another(seeded, tmp_path):
    conn, static, _ = seeded
    manifest = sd.sync(conn, tmp_path / "search", static_dir=static)
    manifest["expected_total"] += 1
    with pytest.raises(ValueError, match="was not planned against this database's ledger"):
        sd.record_sync(conn, manifest)
    assert conn.execute("SELECT COUNT(*) FROM search_ledger").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM search_sync").fetchone()[0] == 0
    with pytest.raises(ValueError, match="no ledger entries"):
        sd.record_sync(conn, {"expected_total": 0})


# -- the commands ----------------------------------------------------------------


def test_the_parser_names_the_three_commands():
    parser = cli.build_parser()
    args = parser.parse_args(["search-sync", "--db", "x.sqlite", "--full"])
    assert args.command == "search-sync" and args.full and args.static is None
    assert parser.parse_args(["search-check", "--manifest", "m", "--counts", "c"]).db is None
    assert parser.parse_args(["search-synced", "--manifest", "m"]).command == "search-synced"


def test_the_commands_run_a_night_end_to_end(tmp_path):
    path = tmp_path / "awardwatch.sqlite"
    static = tmp_path / "static"
    conn = connect(path)
    _seed(conn, static)
    conn.close()
    out = tmp_path / "search"
    outcome = config.OUT_DIR / "search" / sd.OUTCOME
    db = d1()

    assert cli.main(["search-sync", "--db", str(path), "--static", str(static), "--out", str(out)]) == 0
    # "failed" until search-synced replaces it.
    assert outcome.read_text() == "failed\n"
    manifest = json.loads((out / sd.MANIFEST).read_text(encoding="utf-8"))
    assert manifest["full"] and manifest["expected"] == {"search_orgs": 3, "search_buyers": 2}
    for name in (out / sd.BATCH_LIST).read_text().split():
        db.executescript((out / name).read_text(encoding="utf-8"))

    # A count that disagrees exits 1 and asks for a full reload.
    wrong = tmp_path / "wrong.json"
    wrong.write_text('[{"results":[{"orgs":2,"buyers":2}],"success":true}]')
    assert cli.main(["search-check", "--manifest", str(out / sd.MANIFEST), "--counts", str(wrong), "--db", str(path)]) == 1
    conn = connect(path)
    assert get_meta(conn, sd.META_RELOAD)
    conn.close()

    right = tmp_path / "count.json"
    right.write_text(json.dumps([{"results": [dict(zip(("orgs", "buyers"), db.execute(sd.COUNT_SQL).fetchone()))]}]))
    assert cli.main(["search-check", "--manifest", str(out / sd.MANIFEST), "--counts", str(right)]) == 0
    assert cli.main(["search-synced", "--db", str(path), "--manifest", str(out / sd.MANIFEST)]) == 0
    assert outcome.read_text() == "synced\n"
    conn = connect(path)
    assert conn.execute("SELECT COUNT(*) FROM search_ledger").fetchone()[0] == 5
    # The recorded count cleared the reload the wrong one asked for.
    assert get_meta(conn, sd.META_RELOAD) is None
    log_rows = conn.execute("SELECT rows, full, manifest FROM search_sync").fetchall()
    assert [(r[0], r[1]) for r in log_rows] == [(5, 1)] and "record" not in json.loads(log_rows[0][2])
    conn.close()

    # The next night: nothing changed, nothing sent.
    assert cli.main(["search-sync", "--db", str(path), "--static", str(static), "--out", str(out)]) == 0
    assert json.loads((out / sd.MANIFEST).read_text())["batches"] == []
    assert cli.main(["search-synced", "--db", str(path), "--manifest", str(out / sd.MANIFEST)]) == 0
    assert outcome.read_text() == "nothing to send\n"

    # A sync that cannot read the export stops with exit 2 and leaves "failed".
    assert cli.main(["search-sync", "--db", str(path), "--static", str(tmp_path / "none"), "--out", str(out)]) == 2
    assert outcome.read_text() == "failed\n"
    # Last night's manifest is gone, so nothing later can apply or record it.
    assert not (out / sd.MANIFEST).exists() and not (out / sd.BATCH_LIST).exists()


def test_a_failed_sync_is_an_item_needing_attention_and_leaves_the_run_ok(tmp_path):
    from awardwatch_pipeline import nightly, resilience

    db = tmp_path / "awardwatch.sqlite"
    connect(db).close()
    started = tmp_path / "started.txt"
    started.write_text("2026-11-01T00:00:00Z")
    outcome = tmp_path / "search" / sd.OUTCOME
    outcome.parent.mkdir()
    for value, item in (("failed", True), ("synced", False), ("nothing to send", False)):
        outcome.write_text(value + "\n")
        out = tmp_path / "status.json"
        assert nightly.main(["status", "--db", str(db), "--started-file", str(started), "--search-outcome", str(outcome),
                             "--step", "deploy=success", "--out", str(out)]) == 0
        status = json.loads(out.read_text())
        # Reported beside the stages, never as one, so the refresh itself stays ok.
        assert status["search_sync"] == value and status["ok"] is True
        items = resilience.attention_items(status)
        assert ("Search database sync: failed (sent again next run)" in items) is item
