"""The lobbying stage: the communication reports zip, columns found at run time, and a refusal honoured.

The registry's file could not be seen when this was written (the host
refused the requests), so the fixture is constructed: three CSVs in the shape
of the registry's exports (a primary file, office holders, subject matters)
under tests/fixtures/lobbying, zipped by the tests. Every name in it is
invented. One report replaces an earlier one, one client is named as a
person, one office holder's institution is given as "Other", and one
office-holder row names a report the primary file lacks.

The copies read while the host refuses are the same fixture: the seed (the
operator's own download) zipped into config.SEEDS_DIR, which conftest points
at a temporary folder, and the Internet Archive's capture served by the fake
session at its replay address. Every zip carries a fixed internal date, since
the newer primary file decides between copies.
"""

import hashlib
import io
import json
import zipfile

import pytest

from conftest import FakeResponse
from awardwatch_pipeline import cli, config
from awardwatch_pipeline.db import get_meta
from awardwatch_pipeline.normalize import norm_name, org_id
from awardwatch_pipeline.sources import buyers, lobbying
from awardwatch_pipeline.sources.contracts import LayoutError, sha256

DAY1 = "2026-10-31T01:00:00Z"
URL = config.LOBBYING_URL
INDEX = config.LOBBYING_ARCHIVE_INDEX
# The internal date of every zip a test makes unless it names another.
OCT30 = (2026, 10, 30, 6, 25, 12)


def make_zip(path, files: dict[str, bytes], when=OCT30):
    with zipfile.ZipFile(path, "w") as zf:
        for name, data in files.items():
            zf.writestr(zipfile.ZipInfo(name, date_time=when), data, compress_type=zipfile.ZIP_DEFLATED)
    return path


def asked(calls, url=URL):
    """The headers of each request made to one address."""
    return [headers for called, headers in calls if called == url]


def fixture_files(fixtures) -> dict[str, bytes]:
    return {p.name: p.read_bytes() for p in sorted((fixtures / "lobbying").glob("*.csv"))}


@pytest.fixture
def seeded(conn):
    buyers.load_seed(conn, buyers.read_seed(), now=DAY1)
    return conn


def reports(conn):
    return {r["comm_number"]: dict(r) for r in conn.execute("SELECT * FROM lobbying_communications")}


def test_reports_load_with_their_client_institutions_office_holders_and_subjects(seeded, fixtures, tmp_path):
    conn = seeded
    stats = lobbying.load_zip(conn, make_zip(tmp_path / "c.zip", fixture_files(fixtures)), now=DAY1)
    assert (stats.reports, stats.stored, stats.superseded, stats.withheld, stats.orphans, stats.missing) == \
        (6, 5, 1, 1, 1, [])
    rows = reports(conn)
    assert sorted(rows) == ["500001", "500002", "500003", "500006", "500007"]  # 500005 was replaced by 500006
    northwind = org_id(norm_name("Northwind Seed Growers Ltd."))
    first = rows["500001"]
    assert {k: first[k] for k in ("registration_number", "registrant_number", "comm_date", "registrant_raw",
                                  "client_raw", "client_withheld", "organization_id", "loaded_at")} == {
        "registration_number": None, "registrant_number": "900001", "comm_date": "2026-09-15",
        "registrant_raw": "Avery Quill", "client_raw": "Northwind Seed Growers Ltd.", "client_withheld": 0,
        "organization_id": northwind, "loaded_at": DAY1,
    }
    assert json.loads(first["institutions"]) == ["Department of National Defence (DND)", "House of Commons"]
    # DND by its acronym; the House of Commons is no buyer yet, so one is made and listed.
    assert json.loads(first["buyer_ids"]) == ["dnd-mdn", "house-of-commons"]
    assert json.loads(first["dpoh"]) == [
        {"name": "Mara Lindqvist", "title": "Director General", "institution": "Department of National Defence (DND)"},
        {"name": "Theo Brannigan", "title": "Member of Parliament", "institution": "House of Commons"},
    ]
    assert json.loads(first["subject_matters"]) == ["Agriculture", "Defence"]
    assert buyers.take_notices(conn) == ["buyer house-of-commons made for 'House of Commons'"]
    # An institution given as "Other" is the one named beside it.
    assert json.loads(rows["500002"]["buyer_ids"]) == ["fcc-fac"]
    # The same office holder twice on one report is one entry; another spelling of the client is the same organization.
    assert len(json.loads(rows["500006"]["dpoh"])) == 1 and rows["500006"]["organization_id"] == northwind
    # A client named only in French.
    assert rows["500007"]["client_raw"] == "Coopérative Hollow Creek" and rows["500007"]["dpoh"] is None
    names = dict(conn.execute("SELECT raw_name, n FROM organization_names WHERE organization_id = ? "
                              "AND source = 'lobbying'", (northwind,)))
    assert names == {"Northwind Seed Growers Ltd.": 1, "Northwind Seed Growers Ltd": 1}


def test_a_client_named_as_a_person_is_withheld(seeded, fixtures, tmp_path):
    conn = seeded
    lobbying.load_zip(conn, make_zip(tmp_path / "c.zip", fixture_files(fixtures)), now=DAY1)
    row = reports(conn)["500003"]
    assert (row["client_raw"], row["organization_id"], row["client_withheld"]) == (None, None, 1)
    # The report itself stays, with the office holder in their public role.
    assert row["comm_date"] == "2026-09-22" and json.loads(row["buyer_ids"]) == ["dnd-mdn"]
    for table, column in (("organizations", "display_name"), ("organization_names", "raw_name")):
        assert conn.execute(f"SELECT 1 FROM {table} WHERE {column} LIKE '%Ashdale%'").fetchone() is None


def test_columns_are_found_in_another_layout_and_another_encoding(conn, tmp_path):
    combined = (
        "Communication Number,Communication Date,Client Name,Registrant Name,DPOH Name,DPOH Title,"
        "Government Institution,Subject Matter\r\n"
        "A-1,2026-08-03,Société Frontenac Ltée,Avery Quill,Mara Lindqvist,Director General,Transport Canada (TC),"
        "Transportation\r\n"
        "A-1,2026-08-03,Société Frontenac Ltée,Avery Quill,Theo Brannigan,Member of Parliament,House of Commons,"
        "Infrastructure\r\n"
    ).encode("cp1252")
    stats = lobbying.load_zip(conn, make_zip(tmp_path / "c.zip", {"export/all.csv": combined}), now=DAY1)
    assert (stats.reports, stats.stored, stats.files) == (1, 1, ["export/all.csv"])
    row = reports(conn)["A-1"]
    assert (row["client_raw"], row["registrant_raw"], row["comm_date"]) == \
        ("Société Frontenac Ltée", "Avery Quill", "2026-08-03")
    assert json.loads(row["subject_matters"]) == ["Transportation", "Infrastructure"]
    assert [d["name"] for d in json.loads(row["dpoh"])] == ["Mara Lindqvist", "Theo Brannigan"]
    assert lobbying.find_columns(["﻿COMLOG_ID", "PREV_COMLOG_ID_PRECEDNT", "COMM_DATE",
                                  "EN_CLIENT_ORG_CORP_NM_AN", "CLIENT_ORG_CORP_NUM"]) == \
        {"comm": 0, "previous": 1, "date": 2, "client_en": 3}


def test_a_zip_without_a_report_file_is_refused_and_keeps_the_previous_rows(seeded, fixtures, tmp_path):
    conn = seeded
    lobbying.load_zip(conn, make_zip(tmp_path / "c.zip", fixture_files(fixtures)), now=DAY1)
    before = reports(conn)
    with pytest.raises(LayoutError, match="layout changed"):
        lobbying.load_zip(conn, make_zip(tmp_path / "x.zip", {"readme.csv": b"a,b\r\n1,2\r\n"}), now=DAY1)
    with pytest.raises(LayoutError, match="no CSV"):
        lobbying.load_zip(conn, make_zip(tmp_path / "y.zip", {"readme.txt": b"nothing"}), now=DAY1)
    assert reports(conn) == before


def test_each_load_rewrites_the_table_whole(seeded, fixtures, tmp_path):
    conn = seeded
    files = fixture_files(fixtures)
    lobbying.load_zip(conn, make_zip(tmp_path / "c.zip", files), now=DAY1)
    primary = files["Communication_PrimaryExport.csv"].decode("utf-8").splitlines()
    files["Communication_PrimaryExport.csv"] = "\n".join(primary[:1] + primary[2:3]).encode("utf-8")
    stats = lobbying.load_zip(conn, make_zip(tmp_path / "d.zip", files), now="2026-11-07T01:00:00Z")
    assert stats.stored == 1 and sorted(reports(conn)) == ["500002"]


# -- the stage: a refusal is honoured ------------------------------------------


def test_a_refusal_is_a_notice_and_is_not_asked_again_for_seven_days(seeded, fixtures, fake_client, tmp_path):
    conn = seeded
    lobbying.load_zip(conn, make_zip(tmp_path / "c.zip", fixture_files(fixtures)), now=DAY1)
    kept = reports(conn)
    client = fake_client({URL: FakeResponse(403)})
    calls = client.fake_session.calls

    def run(now):
        return lobbying.run(conn, client, now=now, work_dir=tmp_path / "w")

    result = run("2026-11-01T00:00:00Z")
    assert result.state == "refused: HTTP 403" and len(asked(calls)) == 1
    # One plain request under the project's named user agent: no retry, no other identity. With no
    # copy at hand, one query to the Internet Archive's index (which has nothing here), as itself too.
    assert len(asked(calls, INDEX)) == 1 and len(calls) == 2
    assert {headers["User-Agent"] for _, headers in calls} == {config.USER_AGENT}
    assert config.USER_AGENT.startswith("AwardWatch/")
    log = conn.execute("SELECT ok, notice FROM sources_log ORDER BY id DESC").fetchone()
    assert tuple(log) == (1, "lobbying: the registry refused the download (403); not retried until 2026-11-08")
    assert reports(conn) == kept

    for day in ("2026-11-02T00:00:00Z", "2026-11-07T23:59:00Z"):
        assert run(day).state == "held: refused on 2026-11-01"
    assert len(calls) == 2
    held = conn.execute("SELECT ok, notice FROM sources_log ORDER BY id DESC").fetchone()
    assert tuple(held) == (1, "lobbying: the registry refused the download (403); not retried until 2026-11-08")

    # Seven days on, it asks once more; the host now answers with the file.
    body = make_zip(tmp_path / "n.zip", fixture_files(fixtures)).read_bytes()
    client.fake_session.mapping[URL] = FakeResponse(200, body, {"Last-Modified": "Sat, 07 Nov 2026 10:00:00 GMT"})
    result = run("2026-11-08T00:00:00Z")
    assert len(asked(calls)) == 2 and result.state == "read"
    # The host answered, so neither copy was looked for.
    assert len(asked(calls, INDEX)) == 1
    assert get_meta(conn, "lobbying:refused_until") is None
    assert get_meta(conn, "lobbying_loaded_at") == "2026-11-08T00:00:00Z"
    assert not list((tmp_path / "w").iterdir())
    assert all(r[0] == 1 for r in conn.execute("SELECT ok FROM sources_log"))


def test_a_missing_file_is_a_notice_that_names_the_status(conn, fake_client, tmp_path):
    lobbying.run(conn, fake_client({}), now=DAY1, work_dir=tmp_path)
    log = conn.execute("SELECT ok, notice FROM sources_log").fetchone()
    assert tuple(log) == (1, "lobbying: the registry answered 404 (the file's address may have changed); "
                             "not retried until 2026-11-07")


def test_a_server_error_fails_the_stage_and_sets_no_hold(conn, fake_client, tmp_path):
    client = fake_client({URL: FakeResponse(503)})
    ok = cli._stage(conn, "lobbying", lambda: lobbying.run(conn, client, now=DAY1, work_dir=tmp_path))
    assert ok is False
    assert conn.execute("SELECT ok FROM sources_log WHERE source = 'lobbying'").fetchone()[0] == 0
    assert get_meta(conn, "lobbying:refused_until") is None


def test_samples_read_a_zip_under_the_file_name_or_note_its_absence(seeded, fixtures, tmp_path, out_dir):
    conn = seeded
    assert lobbying.run(conn, None, now=DAY1, samples=tmp_path).state == "no sample"
    assert "not downloaded (samples run)" in conn.execute("SELECT notice FROM sources_log").fetchone()[0]
    make_zip(tmp_path / "communications_ocl_cal.zip", fixture_files(fixtures))
    result = lobbying.run(conn, None, now=DAY1, samples=tmp_path)
    assert result.state == "read" and result.stats.stored == 5
    log = conn.execute("SELECT rows_in, rows_new, excluded, notice FROM sources_log ORDER BY id DESC").fetchone()
    assert (log["rows_in"], log["rows_new"], log["excluded"]) == (6, 5, 1)
    assert "client withheld" in log["notice"] and "Ashdale" not in log["notice"]
    assert "1 office-holder or subject rows name a report the primary file lacks" in log["notice"]
    review = out_dir / "review" / "lobbying-persons.txt"
    assert [line for line in review.read_text(encoding="utf-8").splitlines() if not line.startswith("#")] == \
        ["Daniel Ashdale"]


# -- the copies read while the host refuses: the seed and the archive's capture ----------------

OCT20 = (2026, 10, 20, 6, 25, 12)
NOV2 = (2026, 11, 2, 6, 25, 12)
NOV6 = (2026, 11, 6, 6, 25, 12)
NOV16 = (2026, 11, 16, 6, 25, 12)
CAPTURED = "20261103120000"


def seed_zip(fixtures, files=None, when=OCT30):
    """The operator's copy where the workflow puts it (config.SEEDS_DIR, a temporary folder here)."""
    config.SEEDS_DIR.mkdir(parents=True, exist_ok=True)
    return make_zip(config.SEEDS_DIR / lobbying.SPEC.file_name,
                    fixture_files(fixtures) if files is None else files, when)


def one_report(fixtures):
    """The fixture with one report left (500002), as another copy of the file."""
    files = fixture_files(fixtures)
    primary = files["Communication_PrimaryExport.csv"].decode("utf-8").splitlines()
    files["Communication_PrimaryExport.csv"] = "\n".join(primary[:1] + primary[2:3]).encode("utf-8")
    return files


def zipped(tmp_path, files, when=OCT30, name="copy.zip"):
    return make_zip(tmp_path / name, files, when).read_bytes()


def capture_url(timestamp=CAPTURED):
    return config.LOBBYING_ARCHIVE_CAPTURE.format(timestamp=timestamp)


def index_answer(*timestamps):
    """The archive's index answering output=json: the field names, then one row per capture."""
    rows = [["timestamp", "digest", "length"]] + [[t, f"DIGEST{t}", "7969505"] for t in timestamps]
    return FakeResponse(200, json.dumps(rows).encode("utf-8"))


def damaged(data: bytes) -> bytes:
    """The zip with one byte of its primary file's compressed data changed, as a copy damaged on the way."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        info = zf.getinfo("Communication_PrimaryExport.csv")
    at = info.header_offset + 30 + len(info.filename.encode("utf-8")) + len(info.extra) + info.compress_size // 2
    return data[:at] + bytes([data[at] ^ 0xFF]) + data[at + 1:]


def last_log(conn):
    return conn.execute("SELECT ok, detail, notice FROM sources_log WHERE source = 'lobbying' "
                        "ORDER BY id DESC").fetchone()


def loaded_at(conn):
    return {r[0] for r in conn.execute("SELECT DISTINCT loaded_at FROM lobbying_communications")}


@pytest.mark.parametrize("status", [401, 403])
def test_a_refusal_with_a_seed_copy_reads_the_copy_on_the_weekly_cadence(seeded, fixtures, fake_client, tmp_path,
                                                                        status):
    conn = seeded
    seed = seed_zip(fixtures)
    digest = sha256(seed)
    client = fake_client({URL: FakeResponse(status)})
    calls = client.fake_session.calls

    def run(now):
        return lobbying.run(conn, client, now=now, work_dir=tmp_path / "w")

    # The host is asked first; its refusal sends the stage to the copy (the archive has no capture here).
    result = run("2026-11-01T00:00:00Z")
    assert result.state == "read (seed)" and result.stats.stored == 5
    assert (len(asked(calls)), len(asked(calls, INDEX)), len(calls)) == (1, 1, 2)
    log = last_log(conn)
    assert log["ok"] == 1 and log["detail"].startswith("read (seed) files=Communication_DpohExport.csv,")
    # The notice names the copy and the start of its checksum in place of the refusal; no hold is set.
    assert log["notice"].split(" | ")[0] == f"lobbying: read from the seed copy {seed} (sha256 {digest[:12]})"
    assert "refused" not in log["notice"] and get_meta(conn, "lobbying:refused_until") is None
    assert get_meta(conn, "lobbying:seed_sha256") == digest
    assert get_meta(conn, "lobbying:file_date") == "2026-10-30T06:25:12"
    assert get_meta(conn, "lobbying_loaded_at") == "2026-11-01T00:00:00Z"
    assert seed.is_file() and not list((tmp_path / "w").iterdir())

    # Six days on: not due, no request.
    assert run("2026-11-07T23:59:00Z").state == "not due" and len(calls) == 2
    # A week on the host is asked again and refuses again; the copy has not changed, so it is not parsed.
    result = run("2026-11-08T00:00:00Z")
    assert result.state == "unchanged (seed)" and result.stats is None
    assert (len(asked(calls)), len(asked(calls, INDEX)), len(calls)) == (2, 2, 4)
    assert loaded_at(conn) == {"2026-11-01T00:00:00Z"}
    log = last_log(conn)
    assert (log["ok"], log["detail"]) == (1, "unchanged (seed)")
    assert log["notice"] == f"lobbying: the seed copy {seed} (sha256 {digest[:12]}) is unchanged; its rows stay"
    assert get_meta(conn, "lobbying_loaded_at") == "2026-11-08T00:00:00Z" and seed.is_file()


def test_a_seed_copy_added_during_a_hold_is_read_when_the_hold_ends(seeded, fixtures, fake_client, tmp_path):
    conn = seeded
    client = fake_client({URL: FakeResponse(403)})
    calls = client.fake_session.calls

    def run(now):
        return lobbying.run(conn, client, now=now, work_dir=tmp_path / "w")

    assert run("2026-11-01T00:00:00Z").state == "refused: HTTP 403"
    seed_zip(fixtures)
    # The hold governs when the host is asked; the copy waits for it.
    assert run("2026-11-04T00:00:00Z").state == "held: refused on 2026-11-01" and len(calls) == 2
    assert reports(conn) == {}
    result = run("2026-11-08T00:00:00Z")
    assert result.state == "read (seed)" and len(asked(calls)) == 2 and len(reports(conn)) == 5
    assert get_meta(conn, "lobbying:refused_until") is None


def test_the_live_file_takes_over_the_day_the_host_answers_and_no_older_copy_is_read_after(seeded, fixtures,
                                                                                           fake_client, tmp_path):
    conn = seeded
    seed = seed_zip(fixtures)
    client = fake_client({URL: FakeResponse(403)})
    calls = client.fake_session.calls

    def run(now):
        return lobbying.run(conn, client, now=now, work_dir=tmp_path / "w")

    assert run("2026-11-01T00:00:00Z").state == "read (seed)"
    assert sorted(reports(conn)) == ["500001", "500002", "500003", "500006", "500007"]
    # A week on the host answers with a later file: it is read and replaces the copy's rows, and no
    # other copy is looked for.
    live = zipped(tmp_path, one_report(fixtures), NOV6)
    client.fake_session.mapping[URL] = FakeResponse(200, live, {"Last-Modified": "Fri, 06 Nov 2026 10:00:00 GMT"})
    result = run("2026-11-08T00:00:00Z")
    assert result.state == "read" and sorted(reports(conn)) == ["500002"]
    assert len(asked(calls, INDEX)) == 1
    assert "seed copy" not in (last_log(conn)["notice"] or "")
    assert get_meta(conn, "lobbying:seed_sha256") is None
    assert get_meta(conn, "lobbying:file_date") == "2026-11-06T06:25:12"
    # The host refuses again. The seed and the archive's newest capture (taken before the live file was
    # written, so not even downloaded) are older than the rows: the refusal is recorded and honoured as
    # with no copy at all, and the rows stay.
    client.fake_session.mapping[URL] = FakeResponse(403)
    client.fake_session.mapping[INDEX] = index_answer("20261104000000")
    result = run("2026-11-15T00:00:00Z")
    assert result.state == "refused: HTTP 403" and sorted(reports(conn)) == ["500002"]
    assert asked(calls, capture_url("20261104000000")) == []
    assert get_meta(conn, "lobbying:refused_until") == "2026-11-22" and seed.is_file()


def test_after_a_seed_read_the_host_sends_the_whole_file_and_the_same_bytes_are_not_parsed(seeded, fixtures,
                                                                                         fake_client, tmp_path):
    conn = seeded
    older = zipped(tmp_path, one_report(fixtures), OCT20)
    client = fake_client({URL: FakeResponse(200, older, {"ETag": '"l0"'})})
    calls = client.fake_session.calls

    def run(now):
        return lobbying.run(conn, client, now=now, work_dir=tmp_path / "w")

    assert run("2026-10-25T00:00:00Z").state == "read"
    seed = seed_zip(fixtures)
    client.fake_session.mapping[URL] = FakeResponse(403)
    assert run("2026-11-01T00:00:00Z").state == "read (seed)" and len(reports(conn)) == 5
    assert asked(calls)[-1]["If-None-Match"] == '"l0"'
    # The table holds the copy's rows, so the older live copy's validators are gone: no 304 can keep them.
    assert get_meta(conn, "lobbying:etag") is None
    client.fake_session.mapping[URL] = FakeResponse(200, seed.read_bytes(), {"ETag": '"l1"'})
    result = run("2026-11-08T00:00:00Z")
    assert "If-None-Match" not in asked(calls)[-1]
    # The live file holds the copy's bytes: nothing to parse, and the live file is the source from now on.
    assert result.state == "unchanged" and result.stats is None and loaded_at(conn) == {"2026-11-01T00:00:00Z"}
    assert get_meta(conn, "lobbying:seed_sha256") is None and get_meta(conn, "lobbying:etag") == '"l1"'


@pytest.mark.parametrize("files, reason", [({"readme.csv": b"a,b\r\n1,2\r\n"}, "the layout changed"),
                                           (None, "is not a zip")])
def test_a_seed_copy_that_fails_its_layout_fails_the_stage_and_keeps_the_rows(seeded, fixtures, fake_client,
                                                                            tmp_path, files, reason):
    conn = seeded
    lobbying.load_zip(conn, make_zip(tmp_path / "c.zip", fixture_files(fixtures)), now=DAY1)
    before = reports(conn)
    if files is None:
        config.SEEDS_DIR.mkdir(parents=True)
        seed = config.SEEDS_DIR / lobbying.SPEC.file_name
        seed.write_bytes(b"<html>Access denied</html>")
    else:
        seed = seed_zip(fixtures, files)
    client = fake_client({URL: FakeResponse(403)})
    ok = cli._stage(conn, "lobbying",
                    lambda: lobbying.run(conn, client, now="2026-11-01T00:00:00Z", work_dir=tmp_path / "w"))
    assert ok is False
    log = last_log(conn)
    assert log["ok"] == 0 and log["detail"].startswith(
        f"LayoutError: the seed copy {seed} (sha256 {sha256(seed)[:12]}): ")
    assert reason in log["detail"]
    assert reports(conn) == before and seed.is_file()
    # No week is counted and no hold is set: the next run asks the host and tries the copy again.
    for key in ("lobbying:seed_sha256", "lobbying_loaded_at", "lobbying:refused_until"):
        assert get_meta(conn, key) is None, key


def test_a_moved_address_is_not_covered_by_a_copy(seeded, fixtures, fake_client, tmp_path):
    seed_zip(fixtures)
    client = fake_client({INDEX: index_answer(CAPTURED)})
    result = lobbying.run(seeded, client, now=DAY1, work_dir=tmp_path / "w")
    assert result.state == "refused: HTTP 404" and reports(seeded) == {}
    assert asked(client.fake_session.calls, INDEX) == []


def test_a_newer_capture_is_read_in_place_of_the_seed_and_not_fetched_again_while_unchanged(seeded, fixtures,
                                                                                         fake_client, tmp_path):
    conn = seeded
    seed = seed_zip(fixtures)
    capture = zipped(tmp_path, one_report(fixtures), NOV2)
    digest = hashlib.sha256(capture).hexdigest()
    # The index lists an older capture too; the newest is taken whatever the order.
    client = fake_client({URL: FakeResponse(403), INDEX: index_answer(CAPTURED, "20261020000000"),
                          capture_url(): capture})
    calls = client.fake_session.calls

    def run(now):
        return lobbying.run(conn, client, now=now, work_dir=tmp_path / "w")

    # The capture's primary file (2 November) is newer than the seed's (30 October): the capture is read.
    result = run("2026-11-08T00:00:00Z")
    assert result.state == f"read (archive {CAPTURED})" and sorted(reports(conn)) == ["500002"]
    assert last_log(conn)["notice"].split(" | ")[0] == \
        f"lobbying: read from the Internet Archive's capture {CAPTURED} (sha256 {digest[:12]})"
    assert get_meta(conn, "lobbying:archive_sha256") == digest and get_meta(conn, "lobbying:seed_sha256") is None
    assert get_meta(conn, "lobbying:file_date") == "2026-11-02T06:25:12"
    # The host first, then the index, then the newest capture's original bytes, each once, as the pipeline.
    assert [url for url, _ in calls] == [URL, INDEX, capture_url()]
    assert {headers["User-Agent"] for _, headers in calls} == {config.USER_AGENT}
    # The capture is deleted with the stage; the seed is kept.
    assert not list((tmp_path / "w").iterdir()) and seed.is_file()

    # A week on: the same newest capture, whose rows the table holds, is not downloaded again.
    result = run("2026-11-15T00:00:00Z")
    assert result.state == "unchanged (archive)" and result.stats is None
    assert [url for url, _ in calls[3:]] == [URL, INDEX]
    assert last_log(conn)["notice"] == \
        f"lobbying: the Internet Archive's capture {CAPTURED} (sha256 {digest[:12]}) is unchanged; its rows stay"

    # The operator puts a later copy in R2: it is newer than the capture, which is not downloaded.
    seed = seed_zip(fixtures, when=NOV16)
    result = run("2026-11-22T00:00:00Z")
    assert result.state == "read (seed)" and len(reports(conn)) == 5
    assert [url for url, _ in calls[5:]] == [URL, INDEX]
    assert get_meta(conn, "lobbying:archive_sha256") is None and get_meta(conn, "lobbying:seed_sha256") == sha256(seed)

    # Nothing went to the archive but a read of its index and the replay of a capture it holds.
    assert {url for url, _ in calls if "archive.org" in url} == {INDEX, capture_url()}
    assert INDEX.startswith("https://web.archive.org/cdx/search/cdx?url=lobbycanada.gc.ca/")
    assert capture_url() == f"https://web.archive.org/web/{CAPTURED}id_/{URL}"


@pytest.mark.parametrize("captured, written, downloaded", [
    ("20261020000000", OCT20, False),  # taken before the seed was written: not even downloaded
    ("20261101000000", OCT30, True),   # the seed's own file: a tie keeps the seed
    ("20261101000000", OCT20, True),   # taken later, of an older file
])
def test_a_capture_no_newer_than_the_seed_leaves_the_seed(seeded, fixtures, fake_client, tmp_path, captured,
                                                          written, downloaded):
    conn = seeded
    seed = seed_zip(fixtures)
    client = fake_client({URL: FakeResponse(403), INDEX: index_answer(captured),
                          capture_url(captured): zipped(tmp_path, one_report(fixtures), written)})
    result = lobbying.run(conn, client, now="2026-11-08T00:00:00Z", work_dir=tmp_path / "w")
    assert result.state == "read (seed)" and len(reports(conn)) == 5
    assert len(asked(client.fake_session.calls, capture_url(captured))) == int(downloaded)
    assert get_meta(conn, "lobbying:archive_sha256") is None and get_meta(conn, "lobbying:seed_sha256") == sha256(seed)
    assert not list((tmp_path / "w").iterdir())


@pytest.mark.parametrize("answers", [
    {INDEX: FakeResponse(500)},
    {INDEX: FakeResponse(200, b"<html>Service unavailable</html>")},
    {INDEX: FakeResponse(200, b"[]")},
    {INDEX: FakeResponse(200, b'[["timestamp", "digest", "length"]]')},
    {INDEX: FakeResponse(200, b'{"error": "bad request"}')},
    {INDEX: index_answer(CAPTURED)},
    {INDEX: index_answer(CAPTURED), capture_url(): FakeResponse(503)},
], ids=["index 500", "index page", "no capture", "header only", "index object", "capture 404", "capture 503"])
def test_an_index_or_a_capture_that_fails_leaves_the_seed(seeded, fixtures, fake_client, tmp_path, answers):
    conn = seeded
    seed_zip(fixtures)
    client = fake_client({URL: FakeResponse(403), **answers})
    ok = cli._stage(conn, "lobbying",
                    lambda: lobbying.run(conn, client, now="2026-11-08T00:00:00Z", work_dir=tmp_path / "w"))
    assert ok is True
    assert last_log(conn)["detail"].startswith("read (seed) ") and len(reports(conn)) == 5
    for key in ("lobbying:archive_capture", "lobbying:archive_refused", "lobbying:archive_sha256"):
        assert get_meta(conn, key) is None, key
    assert not list((tmp_path / "w").iterdir())


@pytest.mark.parametrize("kind, reason", [("page", "is not a zip"), ("other", "the layout changed"),
                                          ("damaged", "is damaged")])
def test_a_capture_that_fails_the_zip_checks_is_passed_over_for_the_seed_once(seeded, fixtures, fake_client,
                                                                             tmp_path, kind, reason):
    conn = seeded
    seed_zip(fixtures)
    body = {
        "page": b"<html>Wayback Machine</html>",
        "other": zipped(tmp_path, {"readme.csv": b"a,b\r\n1,2\r\n"}, NOV2),
        "damaged": damaged(zipped(tmp_path, one_report(fixtures), NOV2)),
    }[kind]
    client = fake_client({URL: FakeResponse(403), INDEX: index_answer(CAPTURED), capture_url(): body})
    calls = client.fake_session.calls

    def run(now):
        return lobbying.run(conn, client, now=now, work_dir=tmp_path / "w")

    assert run("2026-11-08T00:00:00Z").state == "read (seed)" and len(reports(conn)) == 5
    notices = last_log(conn)["notice"].split(" | ")
    assert notices[0].startswith(f"lobbying: the Internet Archive's capture {CAPTURED} was not read: ")
    assert reason in notices[0] and notices[1].startswith("lobbying: read from the seed copy ")
    assert not list((tmp_path / "w").iterdir())
    # A week on the index names the same capture: it is not downloaded again.
    assert run("2026-11-15T00:00:00Z").state == "unchanged (seed)"
    assert len(asked(calls, capture_url())) == 1


def test_with_no_seed_the_capture_is_read_and_an_older_seed_never_replaces_its_rows(seeded, fixtures, fake_client,
                                                                                    tmp_path):
    conn = seeded
    client = fake_client({URL: FakeResponse(403), INDEX: index_answer(CAPTURED),
                          capture_url(): zipped(tmp_path, one_report(fixtures), NOV2)})

    def run(now):
        return lobbying.run(conn, client, now=now, work_dir=tmp_path / "w")

    assert run("2026-11-08T00:00:00Z").state == f"read (archive {CAPTURED})"
    # An older copy arrives as the seed and the archive's index stops answering: the rows the table holds
    # are newer than the seed, so the refusal stands and they stay.
    seed_zip(fixtures)
    client.fake_session.mapping[INDEX] = FakeResponse(503)
    result = run("2026-11-15T00:00:00Z")
    assert result.state == "refused: HTTP 403" and sorted(reports(conn)) == ["500002"]
    assert get_meta(conn, "lobbying:archive_sha256") is not None
    # When the hold ends the host answers: the live file replaces the capture's rows.
    client.fake_session.mapping[URL] = FakeResponse(200, zipped(tmp_path, fixture_files(fixtures), NOV6))
    assert run("2026-11-22T00:00:00Z").state == "read" and len(reports(conn)) == 5
    assert get_meta(conn, "lobbying:archive_sha256") is None
    assert get_meta(conn, "lobbying:file_date") == "2026-11-06T06:25:12"
