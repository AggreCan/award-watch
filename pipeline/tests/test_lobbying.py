"""The lobbying stage: the communication reports zip, columns found at run time, and a refusal honoured.

The registry's file could not be seen when this was written (the host
refused the requests), so the fixture is constructed: three CSVs in the shape
of the registry's exports (a primary file, office holders, subject matters)
under tests/fixtures/lobbying, zipped by the tests. Every name in it is
invented. One report replaces an earlier one, one client is named as a
person, one office holder's institution is given as "Other", and one
office-holder row names a report the primary file lacks.
"""

import json
import zipfile

import pytest

from conftest import FakeResponse
from awardwatch_pipeline import cli, config
from awardwatch_pipeline.db import get_meta
from awardwatch_pipeline.normalize import norm_name, org_id
from awardwatch_pipeline.sources import buyers, lobbying
from awardwatch_pipeline.sources.contracts import LayoutError

DAY1 = "2026-10-31T01:00:00Z"
URL = config.LOBBYING_URL


def make_zip(path, files: dict[str, bytes]):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return path


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
    assert json.loads(rows["500002"]["buyer_ids"]) == ["farm-credit-canada"]
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
    assert result.state == "refused: HTTP 403" and len(calls) == 1
    # One plain request under the project's named user agent: no retry, no other identity.
    assert calls[0][1]["User-Agent"] == config.USER_AGENT and calls[0][1]["User-Agent"].startswith("AwardWatch/")
    log = conn.execute("SELECT ok, notice FROM sources_log ORDER BY id DESC").fetchone()
    assert tuple(log) == (1, "lobbying: the registry refused the download (403); not retried until 2026-11-08")
    assert reports(conn) == kept

    for day in ("2026-11-02T00:00:00Z", "2026-11-07T23:59:00Z"):
        assert run(day).state == "held: refused on 2026-11-01"
    assert len(calls) == 1
    held = conn.execute("SELECT ok, notice FROM sources_log ORDER BY id DESC").fetchone()
    assert tuple(held) == (1, "lobbying: the registry refused the download (403); not retried until 2026-11-08")

    # Seven days on, it asks once more; the host now answers with the file.
    body = make_zip(tmp_path / "n.zip", fixture_files(fixtures)).read_bytes()
    client.fake_session.mapping[URL] = FakeResponse(200, body, {"Last-Modified": "Sat, 07 Nov 2026 10:00:00 GMT"})
    result = run("2026-11-08T00:00:00Z")
    assert len(calls) == 2 and result.state == "read"
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
