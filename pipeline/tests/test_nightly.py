"""The workflow's restore decision, its checks before deploy and save, the backup in parts, and the status file."""

import gzip
import hashlib
import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from datetime import datetime, timezone

import pytest

from awardwatch_pipeline import nightly, organizations, resilience
from awardwatch_pipeline.db import connect, log_run

NOW = "2026-10-18T00:00:00Z"


def make_db(path, organizations_n=3, tenders=2):
    """A database built from the schema: suppliers and open tenders."""
    conn = connect(path)
    for i in range(organizations_n):
        organizations.upsert(conn, f"Supplier {i} Ltd", source="awards", province="BC", now=NOW)
    for i in range(tenders):
        conn.execute(
            "INSERT INTO tenders (reference, amendment, title_en, status, source_file, first_seen, last_seen) "
            "VALUES (?, 0, 'Snow removal', 'open', 'new.csv', ?, ?)",
            (f"cb-100-{i:08d}", NOW[:10], NOW[:10]),
        )
    conn.commit()
    conn.close()


def download(folder, key, *, body=None, exit_code=0, log=""):
    folder.mkdir(parents=True, exist_ok=True)
    if body is not None:
        (folder / key).write_bytes(body)
    (folder / f"{key}.exit").write_text(str(exit_code), encoding="utf-8")
    (folder / f"{key}.log").write_text(log, encoding="utf-8")


def gz_of(path) -> bytes:
    return gzip.compress(path.read_bytes())


MISSING = 'Downloading "awardwatch.sqlite.gz"\n✘ [ERROR] The specified key does not exist.\n'


def download_set(folder, key, gz: bytes, part_bytes: int, *, skip_manifest_check=False):
    """Lay out a set of parts and its manifest as the workflow's fetch_set leaves them."""
    src = folder.parent / f"{key}.whole"
    folder.mkdir(parents=True, exist_ok=True)
    src.write_bytes(gz)
    names = nightly.split_parts(src, folder, key, part_bytes)
    for name in [*names, key + nightly.PARTS_SUFFIX]:
        (folder / f"{name}.exit").write_text("0", encoding="utf-8")
        (folder / f"{name}.log").write_text("", encoding="utf-8")
    src.unlink()
    return names


# -- restore ------------------------------------------------------------------


def test_first_run_starts_empty_only_when_no_backup_exists(tmp_path):
    folder = tmp_path / "restore"
    download(folder, nightly.BACKUP, body=b"", exit_code=1, log=MISSING)
    download(folder, nightly.PREVIOUS, exit_code=1, log=MISSING)
    ok, source, message, counts = nightly.restore(folder, tmp_path / "awardwatch.sqlite")
    assert (ok, source) == (True, "none") and "first run" in message
    assert not (tmp_path / "awardwatch.sqlite").exists()


def test_first_run_with_both_manifests_and_files_missing(tmp_path):
    folder = tmp_path / "restore"
    for key in (nightly.BACKUP, nightly.PREVIOUS):
        download(folder, key + nightly.PARTS_SUFFIX, exit_code=1, log=MISSING)
        download(folder, key, exit_code=1, log=MISSING)
    ok, source, message, _ = nightly.restore(folder, tmp_path / "awardwatch.sqlite")
    assert (ok, source) == (True, "none") and "first run" in message


def test_an_outage_stops_the_run_instead_of_starting_empty(tmp_path):
    folder = tmp_path / "restore"
    download(folder, nightly.BACKUP, exit_code=1, log="✘ [ERROR] A request to the Cloudflare API failed. (503)")
    download(folder, nightly.PREVIOUS, exit_code=1, log=MISSING)
    ok, source, message, _ = nightly.restore(folder, tmp_path / "awardwatch.sqlite")
    assert not ok and "download failed" in message and "503" in message


def test_a_manifest_that_failed_to_download_never_falls_back_to_the_single_file(tmp_path):
    src = tmp_path / "src.sqlite"
    make_db(src)
    folder = tmp_path / "restore"
    download(folder, nightly.BACKUP + nightly.PARTS_SUFFIX, exit_code=1, log="[ERROR] (503)")
    download(folder, nightly.BACKUP, body=gz_of(src))
    download(folder, nightly.PREVIOUS, exit_code=1, log=MISSING)
    ok, _, message, _ = nightly.restore(folder, tmp_path / "awardwatch.sqlite")
    assert not ok and "manifest: download failed" in message


def test_a_good_single_file_backup_is_restored_with_its_counts(tmp_path):
    src = tmp_path / "src.sqlite"
    make_db(src)
    folder = tmp_path / "restore"
    download(folder, nightly.BACKUP + nightly.PARTS_SUFFIX, exit_code=1, log=MISSING)
    download(folder, nightly.BACKUP, body=gz_of(src))
    download(folder, nightly.PREVIOUS, exit_code=1, log=MISSING)
    ok, source, _, counts = nightly.restore(folder, tmp_path / "awardwatch.sqlite")
    assert (ok, source) == (True, "backup")
    assert counts["organizations"] == 3 and counts["tenders"] == 2


def test_a_backup_in_parts_is_joined_and_restored(tmp_path):
    src = tmp_path / "src.sqlite"
    make_db(src, organizations_n=40, tenders=30)
    gz = gz_of(src)
    folder = tmp_path / "restore"
    names = download_set(folder, nightly.BACKUP, gz, part_bytes=max(len(gz) // 4, 1))
    assert len(names) >= 4 and names[0] == "awardwatch.sqlite.gz.000"
    download(folder, nightly.PREVIOUS, exit_code=1, log=MISSING)
    ok, source, _, counts = nightly.restore(folder, tmp_path / "awardwatch.sqlite")
    assert (ok, source) == (True, "backup")
    assert counts["organizations"] == 40 and counts["tenders"] == 30
    # The joined gzip is left where the save step's prev-set reads it.
    assert (folder / nightly.BACKUP).read_bytes() == gz


def test_a_tampered_part_falls_back_to_the_previous_set(tmp_path):
    src = tmp_path / "src.sqlite"
    make_db(src, organizations_n=20)
    gz = gz_of(src)
    folder = tmp_path / "restore"
    names = download_set(folder, nightly.BACKUP, gz, part_bytes=max(len(gz) // 3, 1))
    part = folder / names[1]
    data = bytearray(part.read_bytes())
    data[0] ^= 0xFF
    part.write_bytes(bytes(data))
    state, detail = nightly._candidate(folder, nightly.BACKUP)
    assert state == "unusable" and detail == f"{names[1]} does not match its manifest (an upload stopped part way?)"
    download_set(folder, nightly.PREVIOUS, gz, part_bytes=max(len(gz) // 2, 1))
    ok, source, _, counts = nightly.restore(folder, tmp_path / "awardwatch.sqlite")
    assert (ok, source) == (True, "previous") and counts["organizations"] == 20


def test_a_missing_part_makes_the_set_unusable(tmp_path):
    src = tmp_path / "src.sqlite"
    make_db(src)
    gz = gz_of(src)
    folder = tmp_path / "restore"
    names = download_set(folder, nightly.BACKUP, gz, part_bytes=max(len(gz) // 3, 1))
    (folder / names[-1]).unlink()
    (folder / f"{names[-1]}.exit").write_text("1", encoding="utf-8")
    (folder / f"{names[-1]}.log").write_text(MISSING, encoding="utf-8")
    assert nightly._candidate(folder, nightly.BACKUP) == ("unusable", f"{names[-1]} is listed but not in R2")
    download(folder, nightly.PREVIOUS, exit_code=1, log=MISSING)
    ok, _, message, _ = nightly.restore(folder, tmp_path / "awardwatch.sqlite")
    # R2 answered for both, the newest set is damaged, and no weekly source is
    # given (no token): the run stops rather than starting empty.
    assert not ok and "is listed but not in R2" in message


def test_a_part_whose_download_failed_leaves_the_set_unknown(tmp_path):
    src = tmp_path / "src.sqlite"
    make_db(src)
    gz = gz_of(src)
    folder = tmp_path / "restore"
    names = download_set(folder, nightly.BACKUP, gz, part_bytes=max(len(gz) // 2, 1))
    (folder / f"{names[0]}.exit").write_text("1", encoding="utf-8")
    (folder / f"{names[0]}.log").write_text("[ERROR] (524)", encoding="utf-8")
    state, detail = nightly._candidate(folder, nightly.BACKUP)
    assert state == "failed" and "524" in detail


def test_a_manifest_naming_something_else_is_unusable(tmp_path):
    folder = tmp_path / "restore"
    folder.mkdir()
    sha = "0" * 64
    for text in (f"{sha}  ../../etc/passwd\n", f"{sha}  awardwatch.sqlite.gz.001\n", "not a manifest\n", ""):
        download(folder, nightly.BACKUP + nightly.PARTS_SUFFIX, body=text.encode() or b"\n")
        state, _ = nightly._candidate(folder, nightly.BACKUP)
        assert state == "unusable", text


@pytest.mark.parametrize("damage", ["truncated", "not gzip", "not sqlite"])
def test_a_damaged_backup_falls_back_to_the_previous_one(tmp_path, damage):
    src = tmp_path / "src.sqlite"
    make_db(src)
    good = gz_of(src)
    bad = {"truncated": good[: len(good) // 2], "not gzip": b"<html>oops</html>", "not sqlite": gzip.compress(b"x" * 5000)}[damage]
    folder = tmp_path / "restore"
    download(folder, nightly.BACKUP, body=bad)
    download(folder, nightly.PREVIOUS, body=good)
    ok, source, _, _ = nightly.restore(folder, tmp_path / "awardwatch.sqlite")
    assert (ok, source) == (True, "previous")


def test_both_backups_damaged_stops_the_run(tmp_path):
    folder = tmp_path / "restore"
    download(folder, nightly.BACKUP, body=b"\x1f\x8b broken")
    download(folder, nightly.PREVIOUS, body=b"\x1f\x8b broken")
    ok, _, message, _ = nightly.restore(folder, tmp_path / "awardwatch.sqlite")
    assert not ok and "gzip" in message
    assert not (tmp_path / "awardwatch.sqlite").exists()


def test_restore_command_writes_its_record_and_exit_code(tmp_path):
    folder = tmp_path / "restore"
    download(folder, nightly.BACKUP, exit_code=1, log="network unreachable")
    download(folder, nightly.PREVIOUS, exit_code=1, log=MISSING)
    out = tmp_path / "restore.json"
    assert nightly.main(["restore", "--dir", str(folder), "--db", str(tmp_path / "awardwatch.sqlite"), "--out", str(out)]) == 1
    assert json.loads(out.read_text())["source"] == "none"


# -- verify -------------------------------------------------------------------


def write_export(static, organizations_n=3, mtime=None):
    (static / "tenders").mkdir(parents=True)
    (static / "profiles").mkdir()
    (static / "sitemaps").mkdir()
    (static / "stats.json").write_text(json.dumps({"data_as_of": "2026-10-18",
                                                   "counts": {"organizations": organizations_n, "tenders_open": 2}}))
    (static / "tenders" / "open.json").write_text("[]")
    (static / "profiles" / "a00.json").write_text("{}")
    (static / "sitemaps" / "index.xml").write_text("<sitemapindex/>")
    if mtime is not None:
        os.utime(static / "stats.json", (mtime, mtime))


def test_a_sound_database_and_export_pass(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    make_db(db)
    write_export(tmp_path / "static")
    result = nightly.verify(db, tmp_path / "static", time.time() - 60, {"organizations": 3, "tenders": 2})
    assert result["db_ok"] and result["export_ok"] and result["problems"] == []


def test_a_database_that_lost_rows_is_not_saved(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    make_db(db, organizations_n=3, tenders=1)
    problems, _ = nightly.check_db(db, {"organizations": 3, "tenders": 2})
    assert problems == ["tenders fell from 2 to 1 rows"]
    empty = tmp_path / "empty.sqlite"
    connect(empty).close()
    problems, _ = nightly.check_db(empty, {"organizations": 90000, "tenders": 40000, "awards": 120000})
    assert len(problems) == 3


def test_contracts_and_grants_may_shrink_by_less_than_half(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    make_db(db)
    conn = connect(db)
    conn.executemany("INSERT INTO contracts (owner_org, reference, loaded_at) VALUES ('dnd-mdn', ?, ?)",
                     [(f"C-{i}", NOW) for i in range(60)])
    conn.commit()
    conn.close()
    assert nightly.check_db(db, {"contracts": 100})[0] == []
    assert nightly.check_db(db, {"contracts": 121})[0] == ["contracts fell from 121 to 60 rows"]


def test_a_missing_or_corrupt_database_is_not_saved(tmp_path):
    assert nightly.check_db(tmp_path / "nope.sqlite")[0] == ["the database file is missing or empty"]
    bad = tmp_path / "bad.sqlite"
    bad.write_bytes(b"SQLite format 3\x00" + b"\x00" * 50 + b"garbage" * 500)
    problems, _ = nightly.check_db(bad)
    assert problems and ("integrity" in problems[0] or "cannot be read" in problems[0])


def test_an_export_left_from_an_earlier_run_or_shrunk_is_not_deployed(tmp_path):
    static = tmp_path / "static"
    write_export(static, mtime=time.time() - 86400)
    assert "left over from an earlier run" in nightly.check_export(static, time.time())[0]
    assert nightly.check_export(tmp_path / "none", None) == ["no export was written"]
    shrunk = tmp_path / "shrunk"
    write_export(shrunk, organizations_n=10)
    assert "down from 90000" in " ".join(nightly.check_export(shrunk, None, before_organizations=90000))
    # None at all after a night that had some.
    gone = tmp_path / "gone"
    write_export(gone, organizations_n=0)
    assert "counts 0 organizations, down from 3" in " ".join(nightly.check_export(gone, None, before_organizations=3))


def test_no_organizations_is_allowed_only_when_the_restored_database_had_none(tmp_path):
    first = tmp_path / "first"
    write_export(first, organizations_n=0)
    (first / "profiles" / "a00.json").unlink()
    assert nightly.check_export(first, None, before_organizations=0) == []
    # With organizations counted, profiles must exist.
    write_export(tmp_path / "some", organizations_n=5)
    (tmp_path / "some" / "profiles" / "a00.json").unlink()
    assert nightly.check_export(tmp_path / "some", None) == ["no profile files were written"]


def test_an_export_without_its_required_files_is_not_deployed(tmp_path):
    static = tmp_path / "static"
    write_export(static)
    (static / "stats.json").write_text(json.dumps({"data_as_of": None, "counts": {"organizations": "3"}}))
    problems = nightly.check_export(static, None)
    assert "stats.json has no data date" in problems and "stats.json has no organization count" in problems
    (static / "stats.json").write_text(json.dumps({"data_as_of": "2026-10-18", "counts": {}}))
    assert any("stats.json cannot be read" in p for p in nightly.check_export(static, None))
    write_export(tmp_path / "b")
    (tmp_path / "b" / "tenders" / "open.json").write_text("{}")
    (tmp_path / "b" / "sitemaps" / "index.xml").unlink()
    assert nightly.check_export(tmp_path / "b", None) == ["tenders/open.json has the wrong shape",
                                                          "sitemaps/index.xml is missing"]
    write_export(tmp_path / "c")
    (tmp_path / "c" / "stats.json").unlink()
    assert nightly.check_export(tmp_path / "c", None) == ["stats.json is missing"]


def test_a_truncated_file_or_too_many_files_is_not_deployed(tmp_path, monkeypatch):
    static = tmp_path / "static"
    write_export(static)
    (static / "tenders" / "open.json").write_text('[{"reference":')
    assert any("tenders/open.json cannot be read" in p for p in nightly.check_export(static, None))
    monkeypatch.setattr(nightly, "MAX_FILES", 3)
    assert any("more than the 3" in p for p in nightly.check_export(static, None))


def test_the_file_count_and_size_limits(tmp_path, monkeypatch):
    assert nightly.MAX_FILES == 19_000 and nightly.MAX_FILE_BYTES == 25 * 1024 * 1024
    static = tmp_path / "static"
    write_export(static)
    for i in range(3):
        (static / "tenders" / f"{i:03x}.json").write_text("{}")
    assert nightly.check_export(static, None) == []
    monkeypatch.setattr(nightly, "MAX_FILES", 6)
    assert nightly.check_export(static, None) == ["7 files, more than the 6 a deploy can carry"]
    monkeypatch.setattr(nightly, "MAX_FILES", 19_000)
    monkeypatch.setattr(nightly, "MAX_FILE_BYTES", 150)
    (static / "tenders" / "big.json").write_text("[" + "0," * 100 + "0]")
    assert nightly.check_export(static, None) == ["1 files over 25 MiB, first tenders/big.json"]


def test_verify_command_writes_outputs_for_the_workflow(tmp_path, monkeypatch):
    db = tmp_path / "awardwatch.sqlite"
    make_db(db)
    write_export(tmp_path / "static")
    started = tmp_path / "run_started.txt"
    started.write_text(datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    restore = tmp_path / "restore.json"
    restore.write_text(json.dumps({"source": "backup", "counts": {"organizations": 3}}))
    gh = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(gh))
    out = tmp_path / "verify.json"
    assert nightly.main(["verify", "--db", str(db), "--static", str(tmp_path / "static"), "--started-file", str(started),
                         "--restore", str(restore), "--out", str(out)]) == 0
    assert gh.read_text() == "db_ok=true\nexport_ok=true\n"
    # With the export missing, the database is still saved and nothing is deployed.
    gh.unlink()
    assert nightly.main(["verify", "--db", str(db), "--static", str(tmp_path / "gone"), "--out", str(out)]) == 0
    assert gh.read_text() == "db_ok=true\nexport_ok=false\n"


# -- status -------------------------------------------------------------------


def test_status_lists_the_run_rows_failed_steps_and_checks(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    make_db(db)
    conn = connect(db)
    log_run(conn, "tenders", detail="read=new rows=10")
    log_run(conn, "awards", detail="HTTPError: 503", ok=False)
    conn.close()
    status = nightly.run_status(db, "2000-01-01T00:00:00Z", {"problems": ["stats.json has no organization count"]},
                                {"restore": "success", "pipeline": "failure", "deploy": "skipped", "save_db": "cancelled"})
    sources = [(s["source"], s["ok"]) for s in status["stages"]]
    assert ("workflow pipeline", False) in sources and ("workflow save_db", False) in sources
    assert ("tenders", True) in sources and ("awards", False) in sources and ("checks", False) in sources
    assert status["ok"] is False


def test_status_is_written_even_when_nothing_ran(tmp_path):
    status = nightly.run_status(tmp_path / "missing.sqlite", None, None, {"restore": "failure"})
    assert status["stages"] == [{"source": "workflow restore", "ok": False, "detail": nightly.STEP_DETAIL["restore"]}]
    assert status["ok"] is False
    out = tmp_path / "status.json"
    assert nightly.main(["status", "--db", str(tmp_path / "missing.sqlite"), "--started-file", str(tmp_path / "nope"),
                         "--verify", str(tmp_path / "nope"), "--step", "restore=failure", "--step", "pipeline=skipped",
                         "--out", str(out)]) == 0
    written = json.loads(out.read_text())
    assert written["ok"] is False and written["run_at"]
    # The status writer never creates a database where there was none.
    assert not (tmp_path / "missing.sqlite").exists()


def test_status_has_exactly_the_fields_the_site_and_the_gate_read(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    make_db(db)
    status = nightly.run_status(db, "2000-01-01T00:00:00Z", {"problems": []}, {"deploy": "success"})
    assert set(status) == {"run_at", "stages", "steps", "search_sync", "views_rollup", "search_console",
                           "views_report", "indexnow", "interest", "restore", "smoke", "smoke_detail",
                           "version_before", "rollback", "deploy_rolled_back", "checks", "notices", "ok"}
    # No outcome file: the search database step did not run. The site's check reads the field.
    assert status["search_sync"] == "not run" and status["ok"] is True


def test_status_carries_the_notices_and_they_never_fail_the_run(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    make_db(db)
    conn = connect(db)
    log_run(conn, "contracts", detail="not built", notice="the contracts stage is not built yet")
    log_run(conn, "buyers", detail="ok", notice="unmapped spelling A | unmapped spelling B")
    conn.close()
    status = nightly.run_status(db, "2000-01-01T00:00:00Z", {"problems": []}, {"deploy": "success"})
    assert status["notices"] == [
        {"source": "contracts", "detail": "the contracts stage is not built yet"},
        {"source": "buyers", "detail": "unmapped spelling A"},
        {"source": "buyers", "detail": "unmapped spelling B"},
    ]
    assert status["ok"] is True


# Wrangler's answer to the workflow's count, as `d1 execute --remote --json` prints it.
INTEREST_ANSWER = Path(__file__).parent / "fixtures" / "d1_interest_count.json"


def test_status_carries_the_alert_sign_ups_from_the_d1_answer(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    make_db(db)
    out = tmp_path / "status.json"
    assert nightly.main(["status", "--db", str(db), "--interest", str(INTEREST_ANSWER), "--out", str(out)]) == 0
    status = json.loads(out.read_text(encoding="utf-8"))
    assert status["interest"] == {"n": 12, "live": 11}
    assert status["notices"] == []
    # Text Wrangler prints before its JSON is skipped.
    noisy = tmp_path / "noisy.json"
    noisy.write_text("Executing on remote database award-watch:\n" + INTEREST_ANSWER.read_text(encoding="utf-8"),
                     encoding="utf-8")
    assert nightly.read_interest(str(noisy)) == {"n": 12, "live": 11}


def test_an_unread_count_is_a_notice_never_an_item_needing_attention(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    make_db(db)
    garbled = tmp_path / "count.json"
    garbled.write_text("[ERROR] no such table: interest", encoding="utf-8")
    for path in (garbled, tmp_path / "missing.json"):
        out = tmp_path / "status.json"
        assert nightly.main(["status", "--db", str(db), "--started-file", str(tmp_path / "none"),
                             "--interest", str(path), "--step", "deploy=success", "--out", str(out)]) == 0
        status = json.loads(out.read_text(encoding="utf-8"))
        assert status["interest"] == {"n": None, "live": None}
        assert {"source": "interest", "detail": nightly.INTEREST_NOTICE} in status["notices"]
        assert resilience.attention_items({**status, "stages": []}) == []
        assert any(item.startswith("interest: the alert sign-ups were not counted") for item in resilience.notice_items(status))
    # A status written without the count step (a run before it existed) says nothing about it.
    quiet = nightly.run_status(db, "2000-01-01T00:00:00Z", {"problems": []}, {"deploy": "success"})
    assert quiet["interest"] == {"n": None, "live": None} and quiet["notices"] == [] and quiet["ok"] is True


@pytest.mark.parametrize("answer, counts", [
    ([{"results": [{"n": 0, "live": None}], "success": True}], {"n": 0, "live": 0}),  # SUM over no rows is null
    ([{"results": [{"n": 3, "live": 3}], "success": True}], {"n": 3, "live": 3}),
    ({"results": [{"n": 5, "live": 2}]}, {"n": 5, "live": 2}),
    ([{"results": [{"n": 2, "live": 3}], "success": True}], None),  # more live than rows
    ([{"results": [{"n": 2, "live": None}], "success": True}], None),
    ([{"results": [{"n": True, "live": 1}], "success": True}], None),
    ([{"results": [{"n": -1, "live": 0}], "success": True}], None),
    ([{"results": [{"n": 2, "live": 1}], "success": False}], None),
    ([{"results": [], "success": True}], None),
    ([{"results": [{"n": 1, "live": 1}]}, {"results": [{"n": 1, "live": 1}]}], None),
    ({"error": "no such table: interest"}, None),
])
def test_interest_counts_read_only_the_two_numbers_of_one_answer(answer, counts):
    assert nightly.interest_counts(answer) == counts


def test_a_clean_night_reports_ok(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    make_db(db)
    conn = connect(db)
    log_run(conn, "export", detail="static {}")
    conn.close()
    status = nightly.run_status(db, "2000-01-01T00:00:00Z", {"problems": []},
                                {"restore": "success", "pipeline": "success", "deploy": "success"})
    assert status["ok"] is True and [s["source"] for s in status["stages"]] == ["export"]


# -- pack ---------------------------------------------------------------------


def seed_for_pack(path, n=300):
    """A database built from the schema, with rows in tables the indexes cover."""
    make_db(path, organizations_n=n, tenders=n // 3)
    conn = connect(path)
    ids = [r[0] for r in conn.execute("SELECT id FROM organizations ORDER BY id")]
    conn.executemany(
        "INSERT INTO awards (reference, amendment, title_en, awarded, amount, organization_id, source_file, "
        "first_seen, last_seen) VALUES (?, 0, 'Consulting services', '2026-09-01', 12500.5, ?, 'fy.csv', ?, ?)",
        [(f"cb-200-{i:08d}", oid, NOW[:10], NOW[:10]) for i, oid in enumerate(ids)],
    )
    conn.commit()
    conn.close()


def counts_of(path) -> dict[str, int]:
    conn = sqlite3.connect(str(path))
    try:
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
        return {t: conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
    finally:
        conn.close()


def indexes_of(path) -> tuple[set[str], set[str]]:
    """(secondary indexes, automatic indexes of keys and UNIQUE constraints)."""
    conn = sqlite3.connect(str(path))
    try:
        rows = conn.execute("SELECT name, sql FROM sqlite_master WHERE type = 'index'").fetchall()
    finally:
        conn.close()
    return {n for n, sql in rows if sql}, {n for n, sql in rows if not sql}


def gunzip_to(src, dest):
    dest.write_bytes(gzip.decompress(src.read_bytes()))
    return dest


def joined(folder, base) -> bytes:
    entries = nightly.read_manifest(folder / (base + nightly.PARTS_SUFFIX), base)
    return b"".join((folder / name).read_bytes() for _, name in entries)


def test_the_schema_names_its_secondary_indexes_once_each():
    names = nightly.schema_indexes()
    assert len(names) == len(set(names)) >= 30
    assert {"idx_org_norm", "idx_awards_org", "idx_tenders_published", "idx_grants_bn"} <= set(names)


def test_split_parts_writes_numbered_parts_and_a_manifest(tmp_path):
    src = tmp_path / "x.gz"
    src.write_bytes(bytes(range(256)) * 10)  # 2,560 bytes
    names = nightly.split_parts(src, tmp_path / "out", "awardwatch.sqlite.gz", 1000)
    assert names == ["awardwatch.sqlite.gz.000", "awardwatch.sqlite.gz.001", "awardwatch.sqlite.gz.002"]
    assert [(tmp_path / "out" / n).stat().st_size for n in names] == [1000, 1000, 560]
    manifest = (tmp_path / "out" / "awardwatch.sqlite.gz.parts").read_text(encoding="utf-8")
    assert manifest == "".join(
        f"{hashlib.sha256((tmp_path / 'out' / n).read_bytes()).hexdigest()}  {n}\n" for n in names)
    assert joined(tmp_path / "out", "awardwatch.sqlite.gz") == src.read_bytes()
    # A file ending on a part boundary has no empty last part; a smaller set
    # replaces a larger one without leftovers.
    src.write_bytes(b"a" * 2000)
    names = nightly.split_parts(src, tmp_path / "out", "awardwatch.sqlite.gz", 1000)
    assert names == ["awardwatch.sqlite.gz.000", "awardwatch.sqlite.gz.001"]
    assert sorted(p.name for p in (tmp_path / "out").iterdir()) == [*names, "awardwatch.sqlite.gz.parts"]
    # One part is still a set: the site's daily check heads .000.
    src.write_bytes(b"small")
    assert nightly.split_parts(src, tmp_path / "one", "awardwatch.sqlite.gz", 1000) == ["awardwatch.sqlite.gz.000"]


def test_pack_drops_the_secondary_indexes_and_a_restored_copy_gets_them_back(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    seed_for_pack(db)
    # A write the job's time limit cut off before a checkpoint: committed, but
    # only in the write-ahead log beside the file.
    writer = connect(db)
    writer.execute("PRAGMA wal_autocheckpoint = 0")
    organizations.upsert(writer, "Late Writer Ltd", source="awards", province="AB", now=NOW)
    writer.commit()
    try:
        before = counts_of(db)
        secondary, automatic = indexes_of(db)
        assert len(secondary) == len(nightly.schema_indexes()) and automatic
        # A gzip of the file alone would lose the late row.
        (tmp_path / "alone.gz").write_bytes(gz_of(db))
        alone = counts_of(gunzip_to(tmp_path / "alone.gz", tmp_path / "alone.sqlite"))
        assert alone["organizations"] == before["organizations"] - 1

        out = tmp_path / "out" / "awardwatch.sqlite.gz"
        ok, message, sizes = nightly.pack(db, out)
    finally:
        writer.close()
    assert ok, message
    assert f"{len(secondary)} secondary indexes" in message and "in 1 part of at most 250 MiB" in message
    assert sizes["copy"] < sizes["db"] + sizes["wal"] and 0 < sizes["gz"] < sizes["copy"] and sizes["parts"] == 1
    # The whole gzip, one part and the manifest; the working copy is gone.
    assert sorted(p.name for p in out.parent.iterdir()) == [
        "awardwatch.sqlite.gz", "awardwatch.sqlite.gz.000", "awardwatch.sqlite.gz.parts"]
    assert joined(out.parent, out.name) == out.read_bytes()

    restored = gunzip_to(out, tmp_path / "restored.sqlite")
    packed_secondary, packed_automatic = indexes_of(restored)
    assert packed_secondary == set() and packed_automatic == automatic
    conn = sqlite3.connect(str(restored))
    assert [r[0] for r in conn.execute("PRAGMA quick_check")] == ["ok"]
    conn.close()
    assert counts_of(restored) == before
    # The pipeline's first open re-applies schema.sql, which builds every index again.
    connect(restored).close()
    assert indexes_of(restored) == (secondary, automatic)
    assert counts_of(restored) == before


def test_pack_and_restore_round_trip_in_several_parts(tmp_path):
    db = tmp_path / "awardwatch.sqlite"
    seed_for_pack(db, n=200)
    before = counts_of(db)
    out = tmp_path / "out" / "awardwatch.sqlite.gz"
    assert nightly.main(["pack", "--db", str(db), "--out", str(out), "--part-mib", "0.005"]) == 0
    parts = sorted(out.parent.glob("awardwatch.sqlite.gz.[0-9][0-9][0-9]"))
    assert len(parts) >= 3 and all(p.stat().st_size <= int(0.005 * 1024 * 1024) for p in parts)
    # The workflow's restore folder: every part and the manifest, each with its exit code.
    folder = tmp_path / "restore"
    folder.mkdir()
    for p in [*parts, out.parent / "awardwatch.sqlite.gz.parts"]:
        download(folder, p.name, body=p.read_bytes())
    download(folder, nightly.PREVIOUS + nightly.PARTS_SUFFIX, exit_code=1, log=MISSING)
    download(folder, nightly.PREVIOUS, exit_code=1, log=MISSING)
    target = tmp_path / "restored.sqlite"
    ok, source, _, counts = nightly.restore(folder, target)
    assert (ok, source) == (True, "backup") and counts["organizations"] == 200
    connect(target).close()
    assert counts_of(target) == before

    # The save step re-splits the restored set under the previous name.
    prev = tmp_path / "prev"
    assert nightly.main(["prev-set", "--dir", str(folder), "--out-dir", str(prev), "--part-mib", "0.005"]) == 0
    assert joined(prev, nightly.PREVIOUS) == out.read_bytes()
    assert all(nightly.NIGHTLY_PART_RE.match(p.name) for p in prev.glob("*.[0-9][0-9][0-9]"))
    assert nightly.main(["prev-set", "--dir", str(tmp_path / "empty"), "--out-dir", str(prev)]) == 1

    # The weekly snapshot's set, under its own name.
    weekly = tmp_path / "weekly"
    assert nightly.main(["split", "--src", str(out), "--base", "db-slot-3.sqlite.gz", "--out-dir", str(weekly),
                         "--part-mib", "0.005"]) == 0
    assert joined(weekly, "db-slot-3.sqlite.gz") == out.read_bytes()


def test_pack_stops_on_a_missing_damaged_or_failing_database(tmp_path, monkeypatch):
    out = tmp_path / "out" / "awardwatch.sqlite.gz"
    ok, message, _ = nightly.pack(tmp_path / "nope.sqlite", out)
    assert not ok and "missing or empty" in message
    # The pack never creates a database where there was none.
    assert not (tmp_path / "nope.sqlite").exists() and not out.exists()

    bad = tmp_path / "bad.sqlite"
    bad.write_bytes(b"SQLite format 3\x00" + b"\x00" * 50 + b"garbage" * 500)
    ok, message, _ = nightly.pack(bad, out)
    assert not ok and "could not be packed" in message and not out.exists()
    assert nightly.main(["pack", "--db", str(bad), "--out", str(out)]) == 1

    # Anything but "ok" from the copy's check stops the pack.
    db = tmp_path / "awardwatch.sqlite"
    seed_for_pack(db, n=10)
    real = sqlite3.connect

    class Checked:
        def __init__(self, conn):
            self.conn = conn

        def execute(self, sql, *args):
            if sql.startswith("PRAGMA quick_check"):
                return iter([("*** in database main *** Page 7: btreeInitPage() returns error code 11",)])
            return self.conn.execute(sql, *args)

        def __getattr__(self, name):
            return getattr(self.conn, name)

    monkeypatch.setattr(nightly.sqlite3, "connect", lambda *a, **k: Checked(real(*a, **k)))
    ok, message, _ = nightly.pack(db, out)
    assert not ok and "failed its integrity check" in message and "btreeInitPage" in message
    assert list(out.parent.iterdir()) == []


BUNDLE = "static.tar.gz"


def split_bundle(tmp_path, size=20_000):
    """A stand-in for static.tar.gz, split by the command the save step runs
    (parts of 0.005 MiB, so four of them), in the folder the site-only deploy
    downloads the set into."""
    src = tmp_path / BUNDLE
    src.write_bytes(b"".join(hashlib.sha256(str(i).encode()).digest() for i in range(size // 32 + 1))[:size])
    work = tmp_path / "work"
    assert nightly.main(["split", "--src", str(src), "--base", BUNDLE, "--out-dir", str(work), "--part-mib", "0.005"]) == 0
    return src, work


def join_bundle(work, out=None):
    out = out or work / BUNDLE
    return nightly.main(["join", "--dir", str(work), "--base", BUNDLE, "--out", str(out)]), out


def test_split_then_join_reproduces_the_bundle_byte_for_byte(tmp_path, caplog):
    caplog.set_level(logging.INFO, logger="awardwatch_pipeline.nightly")
    src, work = split_bundle(tmp_path)
    assert sorted(p.name for p in work.iterdir()) == [f"{BUNDLE}.{n:03d}" for n in range(4)] + [f"{BUNDLE}.parts"]
    code, out = join_bundle(work)
    assert code == 0
    assert out.read_bytes() == src.read_bytes()
    assert f"join: 4 part(s) of {BUNDLE} joined into {out}" in caplog.text
    # Nothing is left beside it but the set it came from.
    assert sorted(p.name for p in work.iterdir()) == [BUNDLE] + [f"{BUNDLE}.{n:03d}" for n in range(4)] + [f"{BUNDLE}.parts"]
    # A folder that does not exist yet is made for the joined file.
    code, elsewhere = join_bundle(work, tmp_path / "unpack" / BUNDLE)
    assert code == 0 and elsewhere.read_bytes() == src.read_bytes()


def test_join_refuses_a_tampered_part_and_leaves_nothing(tmp_path, caplog):
    _, work = split_bundle(tmp_path)
    part = work / f"{BUNDLE}.002"
    data = bytearray(part.read_bytes())
    data[-1] ^= 0xFF
    part.write_bytes(bytes(data))
    # A file already at --out (an earlier try) must not survive a failed join.
    (work / BUNDLE).write_bytes(b"left from an earlier try")
    code, out = join_bundle(work)
    assert code == 1
    assert f"join: {BUNDLE}.002 does not match its manifest (an upload stopped part way?)" in caplog.text
    assert not out.exists() and not (work / f"{BUNDLE}.joining").exists()


def test_join_fails_when_a_listed_part_is_missing(tmp_path, caplog):
    _, work = split_bundle(tmp_path)
    (work / f"{BUNDLE}.003").unlink()
    code, out = join_bundle(work)
    assert code == 1
    assert f"join: {BUNDLE}.003 is missing" in caplog.text
    assert not out.exists() and not (work / f"{BUNDLE}.joining").exists()


@pytest.mark.parametrize("manifest, reason", [
    (None, "static.tar.gz.parts is missing"),
    (f"{'0' * 64}  ../../etc/passwd\n", "static.tar.gz.parts names '../../etc/passwd' where static.tar.gz.000 belongs"),
    (f"{'0' * 64}  {BUNDLE}.001\n", "static.tar.gz.parts names 'static.tar.gz.001' where static.tar.gz.000 belongs"),
    ("not a manifest\n", "static.tar.gz.parts has a line that does not read"),
    ("", "static.tar.gz.parts lists no part"),
])
def test_join_fails_when_the_manifest_is_missing_or_does_not_read(tmp_path, caplog, manifest, reason):
    _, work = split_bundle(tmp_path)
    if manifest is None:
        (work / f"{BUNDLE}.parts").unlink()
    else:
        (work / f"{BUNDLE}.parts").write_text(manifest, encoding="utf-8")
    code, out = join_bundle(work)
    assert code == 1 and reason in caplog.text
    assert not out.exists()


# -- the workflow's text ------------------------------------------------------

WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "nightly.yml"


def step(text: str, name: str) -> str:
    return text.split(f"- name: {name}", 1)[1].split("\n      - ", 1)[0]


def test_the_workflow_carries_the_project_identity_and_no_other_site():
    text = WORKFLOW.read_text(encoding="utf-8")
    record = step(text, "Record the run so the schedule stays enabled")
    assert 'git config user.name "Award Watch"' in record and 'git config user.email "ops@awardwatch.invalid"' in record
    assert 'TZ=UTC git commit -m "refresh: $(date -u +%Y-%m-%d)"' in record
    assert text.count("${AWARDWATCH_SITE_URL:-https://awardwatch.ca}") == 2
    # No social posting or deposit steps, no mirror of source files.
    for gone in ("bsky", "bluesky", "zenodo", "x_post", "x_api", "mirror", chr(0x2014)):
        assert gone not in text.lower(), gone


def test_the_workflow_syncs_the_search_database_before_the_deploy_and_never_holds_it_back():
    from awardwatch_pipeline import search_db

    text = WORKFLOW.read_text(encoding="utf-8")
    names = [line.strip()[len("- name: "):] for line in text.splitlines() if line.strip().startswith("- name: ")]
    at = names.index("Sync the search database")
    assert names[at - 1] == "Check the database and the export" and names[at + 1] == "Bundle the static data for the site"
    assert at < names.index("Deploy the Worker with the new data as assets") < names.index("Save the database to R2")
    sync = step(text, "Sync the search database")
    assert "id: search" in sync and "continue-on-error: true" in sync and "timeout-minutes: 60" in sync
    assert "steps.verify.outputs.export_ok == 'true' && steps.verify.outputs.db_ok == 'true'" in sync
    # In this order: plan, schema, every batch in batches.txt, the counts, the check, the ledger.
    order = [
        "awardwatch_pipeline search-sync --db ../data/awardwatch.sqlite --static ../data/out/static --out \"$out\"",
        '"$WRANGLER" d1 execute awardwatch-search --remote --yes --file ../pipeline/search_schema.sql',
        'for batch in $(cat "$out/batches.txt"); do',
        '"$WRANGLER" d1 execute awardwatch-search --remote --yes --file "$out/$batch"',
        f'"$WRANGLER" d1 execute awardwatch-search --remote --json --command "{search_db.COUNT_SQL}" > "$out/count.json"',
        'search-check --db ../data/awardwatch.sqlite --manifest "$out/manifest.json" --counts "$out/count.json"',
        'search-synced --db ../data/awardwatch.sqlite --manifest "$out/manifest.json"',
    ]
    places = [sync.index(line) for line in order]
    assert places == sorted(places)
    # The deploy and the steps before it never wait on the sync.
    for name in ("Bundle the static data for the site", "Deploy the Worker with the new data as assets",
                 "Save the database to R2"):
        assert "steps.search." not in step(text, name), name
    # The run status and the record read its outcome.
    assert "--search-outcome data/out/search/last_outcome.txt" in step(text, "Write the run status")
    assert 'echo "Search database: $(cat data/out/search/last_outcome.txt)"' in step(
        text, "Record the run so the schedule stays enabled")
    # The binding the site reads is the database the step writes.
    wrangler = (WORKFLOW.parents[2] / "site" / "wrangler.jsonc").read_text(encoding="utf-8")
    assert '"binding": "SEARCH"' in wrangler and '"database_name": "awardwatch-search"' in wrangler


def test_the_workflow_moves_the_backup_in_parts():
    text = WORKFLOW.read_text(encoding="utf-8")
    restore = step(text, "Restore the database from R2")
    # The part names a manifest may lead the restore to are the nightly sets' only.
    assert r"grep -E '^awardwatch\.sqlite(\.prev)?\.gz\.[0-9]{3}$'" in restore
    assert "fetch_set awardwatch.sqlite.gz\n" in restore and "fetch_set awardwatch.sqlite.prev.gz\n" in restore
    save = step(text, "Save the database to R2")
    assert "nightly pack --db data/awardwatch.sqlite --out data/out/awardwatch.sqlite.gz" in save
    assert "nightly prev-set --dir data/restore --out-dir data/out/prev" in save
    # Parts first, the manifest last, the previous set before the new one.
    put_set = save.split("put_set() {", 1)[1].split("\n          }", 1)[0]
    assert put_set.index('put "$BUCKET/$part"') < put_set.index('put "$BUCKET/$base.parts"')
    assert save.index("put_set data/out/prev awardwatch.sqlite.prev.gz") < save.index("put_set data/out awardwatch.sqlite.gz")
    weekly = step(text, "Weekly snapshot (Sundays UTC, kept eight weeks)")
    assert "nightly split --src ../data/out/awardwatch.sqlite.gz" in weekly and "d1 export award-watch" in weekly


def test_the_workflow_saves_the_bundle_in_parts():
    text = WORKFLOW.read_text(encoding="utf-8")
    save = step(text, "Save the public files to R2")
    split = "nightly split --src data/out/static.tar.gz --base static.tar.gz --out-dir data/out/bundle"
    assert split in save
    # The parts in the manifest's order, then the manifest, in one loop that a
    # failed upload ends, so the manifest never goes up without all its parts.
    loop = "for name in $(awk '{print $2}' data/out/bundle/static.tar.gz.parts) static.tar.gz.parts; do"
    assert loop in save
    body = save.split(loop, 1)[1].split("\n            done", 1)[0]
    assert 'put "$BUCKET/$name" "data/out/bundle/$name"' in body
    assert 'failed="$failed $name"' in body and "break" in body
    assert save.index(split) < save.index(loop) < save.index('put "$BUCKET/downloads/')
    # The whole archive is never uploaded as one object (Wrangler refuses it).
    assert '"$BUCKET/static.tar.gz"' not in text


def test_the_workflow_counts_the_alert_sign_ups_and_never_fails_on_them():
    text = WORKFLOW.read_text(encoding="utf-8")
    count = step(text, "Count the alert sign-ups")
    query = ('"$WRANGLER" d1 execute award-watch --remote --json --command '
             '"SELECT COUNT(*) AS n, SUM(unsubscribed_at IS NULL) AS live FROM interest"')
    assert query in count
    # Two numbers leave D1 and nothing else: no column of an address or a filter is named.
    assert "email" not in count and "params" not in count and "label" not in count
    assert "continue-on-error: true" in count and "if: ${{ !cancelled() }}" in count
    assert "working-directory: site" in count and 'mv "$out/answer.json" "$out/count.json"' in count
    # After the audience roll-up, before the monthly report that reads it.
    names = [line.strip()[len("- name: "):] for line in text.splitlines() if line.strip().startswith("- name: ")]
    at = names.index("Count the alert sign-ups")
    assert names[at - 1] == "Roll up the audience counts (only when CLOUDFLARE_ANALYTICS_TOKEN is set)"
    assert at < names.index("Write the monthly audience report (the first run of a month)") < names.index("Write the run status")
    assert "--interest data/out/interest/count.json" in step(text, "Write the run status")
    assert "--interest data/out/interest/count.json" in step(text, "Write the monthly audience report (the first run of a month)")
    # The weekly D1 export takes the whole forms database, the interest table with it.
    assert '"$WRANGLER" d1 export award-watch --remote --output ../data/out/d1.sql' in step(
        text, "Weekly snapshot (Sundays UTC, kept eight weeks)")


def test_the_review_files_go_to_the_private_prefix_and_nowhere_else():
    text = WORKFLOW.read_text(encoding="utf-8")
    code = [line for line in text.splitlines() if not line.lstrip().startswith("#")]
    mentions = [line.strip() for line in code if "review" in line and "views-report" not in line]
    assert mentions == [
        "- name: Save the review files to R2 (private)",
        "id: review",
        "for f in data/out/review/*.txt; do",
        '"$WRANGLER" r2 object put --remote "$BUCKET/review/$(basename "$f")" --file "$f" > /dev/null',
    ]
    # The bundle is the static folder alone.
    assert "tar -czf data/out/static.tar.gz -C data/out static" in step(text, "Bundle the static data for the site")
