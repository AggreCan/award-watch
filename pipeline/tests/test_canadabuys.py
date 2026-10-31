"""The CanadaBuys stages: loading, codes and provinces, suppliers, tender statuses, and which files a night reads.

The fixtures are rows of the 2026-10-31 files with the government contacts
replaced; one award row and one history row carry an invented person's name.
"""

import csv
import json
from datetime import date, datetime, timezone

import pytest

from conftest import FakeResponse
from awardwatch_pipeline import config, organizations
from awardwatch_pipeline.db import get_meta, set_meta
from awardwatch_pipeline.normalize import org_id
from awardwatch_pipeline.sources import buyers, canadabuys

csv.field_size_limit(2**31 - 1)
DAY1 = "2026-10-30T01:00:00Z"
DAY2 = "2026-10-31T01:00:00Z"
FILES = {"tenders": "canadabuys_tenders_new.csv", "awards": "canadabuys_awards.csv", "history": "canadabuys_history.csv"}


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        return reader.fieldnames, list(reader)


def write_csv(path, header, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header, quoting=csv.QUOTE_ALL, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return path


def as_bytes(header, rows, tmp_path, name="x.csv"):
    return write_csv(tmp_path / name, header, rows).read_bytes()


@pytest.fixture
def seeded(conn):
    buyers.load_seed(conn, buyers.read_seed(), now=DAY1)
    return conn


def table_rows(conn, table):
    return {(r["reference"], r["amendment"]): dict(r) for r in conn.execute(f"SELECT * FROM {table}")}


# -- loading -------------------------------------------------------------------


@pytest.mark.parametrize("stage", ["tenders", "awards", "history"])
def test_a_second_sight_moves_last_seen_and_nothing_else(conn, fixtures, stage):
    path = fixtures / FILES[stage]
    first = canadabuys.load_file(conn, stage, path, "first.csv", now=DAY1)
    assert first.rows > 0 and first.new == len(table_rows(conn, canadabuys.TABLES[stage]))
    before = table_rows(conn, canadabuys.TABLES[stage])
    names_before = conn.execute("SELECT * FROM organization_names ORDER BY 1, 2, 3").fetchall()

    second = canadabuys.load_file(conn, stage, path, "first.csv", now=DAY2)
    assert second.rows == first.rows and second.new == 0
    after = table_rows(conn, canadabuys.TABLES[stage])
    assert after.keys() == before.keys()
    for key, row in after.items():
        assert row["first_seen"] == "2026-10-30" and row["last_seen"] == "2026-10-31"
        assert {k: v for k, v in row.items() if k != "last_seen"} == \
            {k: v for k, v in before[key].items() if k != "last_seen"}
    # A version seen again is not counted again for its organization.
    assert conn.execute("SELECT * FROM organization_names ORDER BY 1, 2, 3").fetchall() == names_before


def test_a_new_amendment_is_a_new_row_and_source_file_follows_the_last_read(conn, fixtures, tmp_path):
    header, rows = read_csv(fixtures / FILES["tenders"])
    canadabuys.load_file(conn, "tenders", fixtures / FILES["tenders"], "new.csv", now=DAY1)
    amended = dict(rows[0], **{"amendmentNumber-numeroModification": "001", "title-titre-eng": "Amended title"})
    stats = canadabuys.load_file(conn, "tenders", write_csv(tmp_path / "a.csv", header, [amended]), "open.csv", now=DAY2)
    assert stats.new == 1
    versions = conn.execute("SELECT amendment, title_en, source_file, first_seen FROM tenders WHERE reference = ? "
                            "ORDER BY amendment", (rows[0]["referenceNumber-numeroReference"],)).fetchall()
    assert [tuple(v) for v in versions] == [
        (0, rows[0]["title-titre-eng"], "new.csv", "2026-10-30"),
        (1, "Amended title", "open.csv", "2026-10-31"),
    ]


def test_tender_fields_codes_and_provinces(conn, fixtures):
    canadabuys.seed_segments(conn)
    canadabuys.load_file(conn, "tenders", fixtures / FILES["tenders"], "new.csv", now=DAY1)
    canadabuys.recount_codes(conn)
    t = conn.execute("SELECT * FROM tenders WHERE reference = 'cb-418-22395949'").fetchone()
    assert json.loads(t["provinces"]) == ["ON", "QC"]
    assert json.loads(t["regions_delivery_en"]) == ["National Capital Region (NCR)"]
    assert t["status"] == "open" and t["published"] == "2026-10-30"
    assert t["closing"] and len(t["closing"]) == 19 and "T" in t["closing"]
    assert json.loads(t["category"])[0] in ("SRV", "GD", "CNST")
    assert t["contact_email"] == "contact@example.invalid"  # kept for the operator, never exported
    provinces = dict(conn.execute("SELECT reference, provinces FROM tenders"))
    assert json.loads(provinces["cb-613-77108420"]) == ["SK"]          # Dundurn, Saskatchewan
    assert provinces["cb-438-11905524"] is None                        # Remote Offsite, Canada
    assert json.loads(provinces["cb-746-37313616"]) == ["ON"]          # Ontario (except NCR), Petawawa

    codes = {r[0] for r in conn.execute("SELECT unspsc FROM tender_codes WHERE reference = 'cb-85-75674174'")}
    assert codes == {"4110", "411017", "411018", "411019", "4112"}
    levels = dict(conn.execute("SELECT code, level FROM unspsc_codes WHERE code IN ('41', '4110', '411017', '80101507')"))
    assert levels == {"41": 1, "4110": 2, "411017": 3, "80101507": 4}
    segment = conn.execute("SELECT desc_en, desc_fr, n FROM unspsc_codes WHERE code = '41'").fetchone()
    assert segment["desc_en"] == "Laboratory and Measuring and Observing and Testing Equipment"
    assert segment["desc_fr"]
    # Two notices carry codes under segment 41 (one of them five).
    assert segment["n"] == 2
    assert conn.execute("SELECT n FROM unspsc_codes WHERE code = '4110'").fetchone()[0] == 2
    commodity = conn.execute("SELECT desc_en FROM unspsc_codes WHERE code = '80101507'").fetchone()[0]
    assert commodity  # the description the file gives, kept by position
    gsin = {r["code"]: r for r in conn.execute("SELECT * FROM gsin_codes")}
    assert gsin["N7030"]["desc_en"] == "ADP Software" and gsin["N7030"]["n"] == 1


def test_the_segment_seed_has_the_57_segments_in_both_languages(conn):
    assert canadabuys.seed_segments(conn) == 57
    rows = conn.execute("SELECT code, level, desc_en, desc_fr FROM unspsc_codes").fetchall()
    assert len(rows) == 57 and all(len(r[0]) == 2 and r[1] == 1 and r[2] and r[3] for r in rows)


def test_unspsc_code_trimming():
    assert canadabuys.unspsc_code("*81110000") == "8111"
    assert canadabuys.unspsc_code("81000000") == "81"
    assert canadabuys.unspsc_code("80101507") == "80101507"
    assert canadabuys.unspsc_code("81141900") == "811419"
    assert canadabuys.unspsc_code("") is None and canadabuys.unspsc_code("123") is None
    assert canadabuys.unspsc_code("00000000") is None


def test_the_supplier_becomes_one_organization_across_spellings(conn, seeded, fixtures):
    stats = canadabuys.load_file(conn, "awards", fixtures / FILES["awards"], "fy.csv", now=DAY1)
    simex = org_id("simex defence")
    refs = {r[0] for r in conn.execute("SELECT reference FROM awards WHERE organization_id = ?", (simex,))}
    assert len(refs) == 5
    names = dict(conn.execute("SELECT raw_name, n FROM organization_names WHERE organization_id = ?", (simex,)))
    assert names == {"Simex Defence Inc": 1, "Simex Defence Inc.": 2, "SIMEX Defence Inc.": 1, "SIMEX DEFENCE INC": 1}
    # 'Quebec' and 'QC' are one place.
    places = conn.execute("SELECT country, province, city, postal_code, n FROM organization_places "
                          "WHERE organization_id = ?", (simex,)).fetchall()
    assert [tuple(p) for p in places] == [("CA", "QC", "Pointe-Claire", "H9R 1A6", 5)]
    award = conn.execute("SELECT * FROM awards WHERE reference = 'cb-617-35031912'").fetchone()
    assert (award["amount"], award["total_value"], award["supplier_province"], award["supplier_country"]) == \
        (-17476.2, 1052445.72, "QC", "CA")
    assert award["buyer_id"] == "dnd-mdn" and award["buyer_raw_en"] == "Department of National Defence (DND)"
    # A supplier abroad keeps its country and no province.
    us = conn.execute("SELECT supplier_country, supplier_province FROM awards WHERE reference = 'cb-397-14536562'").fetchone()
    assert tuple(us) == ("US", None)
    # "N/A" is no supplier: the award stays, with no organization.
    na = conn.execute("SELECT supplier_raw, organization_id FROM awards WHERE reference = 'cb-811-70742970'").fetchone()
    assert tuple(na) == (None, None)
    assert stats.excluded == 1


WITHHELD = ("supplier_raw", "supplier_street", "supplier_city", "supplier_postal", "organization_id")


def test_a_supplier_named_as_a_person_keeps_the_record_and_withholds_the_supplier(conn, fixtures, tmp_path):
    stats = canadabuys.load_file(conn, "awards", fixtures / FILES["awards"], "fy.csv", now=DAY1)
    assert stats.excluded == 1
    award = conn.execute("SELECT * FROM awards WHERE reference = 'cb-000-00000001'").fetchone()
    assert all(award[c] is None for c in WITHHELD) and award["supplier_withheld"] == 1
    # The spending record itself stays: buyer, title, amount, dates, codes.
    assert award["buyer_raw_en"] and award["title_en"] and award["awarded"] and award["supplier_country"] == "CA"
    assert conn.execute("SELECT COUNT(*) FROM award_codes WHERE reference = 'cb-000-00000001'").fetchone()[0] >= 0
    assert conn.execute("SELECT COUNT(*) FROM awards WHERE supplier_withheld = 0").fetchone()[0] == stats.rows - 1
    for table, column in (("organizations", "display_name"), ("organization_names", "raw_name")):
        assert conn.execute(f"SELECT 1 FROM {table} WHERE {column} LIKE '%Ferreira%'").fetchone() is None
    assert conn.execute("SELECT 1 FROM awards WHERE supplier_street LIKE '%Example Street%'").fetchone() is None

    history = canadabuys.load_file(conn, "history", fixtures / FILES["history"], "fy.csv", now=DAY1)
    assert history.excluded == 1
    row = conn.execute("SELECT * FROM contract_history WHERE reference = 'CW0000001'").fetchone()
    assert all(row[c] is None for c in WITHHELD) and row["supplier_withheld"] == 1
    assert row["supplier_operating"] is None and row["supplier_standardized"] is None and row["total_value"]

    # A version stored under a business name that now reads as a person is overwritten the same way.
    header, rows = read_csv(fixtures / FILES["awards"])
    row = dict(next(r for r in rows if r["referenceNumber-numeroReference"] == "cb-537-68386900"))
    row["supplierLegalName-nomLegalFournisseur-eng"] = "Owen Mercer"
    again = canadabuys.load_file(conn, "awards", write_csv(tmp_path / "p.csv", header, [row]), "fy.csv", now=DAY2)
    assert again.excluded == 1
    award = conn.execute("SELECT * FROM awards WHERE reference = 'cb-537-68386900'").fetchone()
    assert all(award[c] is None for c in WITHHELD) and award["supplier_withheld"] == 1


def test_the_stage_lists_withheld_names_for_review_and_logs_only_the_count(conn, fixtures, tmp_path, out_dir):
    (tmp_path / "s").mkdir()
    (tmp_path / "s" / "2026-2027-awardNotice.csv").write_bytes((fixtures / FILES["awards"]).read_bytes())
    canadabuys.run(conn, None, "awards", now=DAY1, samples=tmp_path / "s")
    review = out_dir / "review" / "awards-persons.txt"
    assert [l for l in review.read_text(encoding="utf-8").splitlines() if not l.startswith("#")] == ["Ana Ferreira"]
    log = conn.execute("SELECT detail, excluded, notice FROM sources_log WHERE source = 'awards'").fetchone()
    assert log["excluded"] == 1 and "withheld=1" in log["detail"]
    assert "1 rows (1 names) read as private individuals" in log["notice"]
    assert "Ferreira" not in log["notice"] and "Ferreira" not in log["detail"]


def test_history_rows_keep_the_client_and_resolve_it_from_the_english_list(conn, seeded, fixtures):
    canadabuys.load_file(conn, "history", fixtures / FILES["history"], "fy.csv", now=DAY1)
    versions = conn.execute("SELECT amendment, buyer_id, client_id, organization_id FROM contract_history "
                            "WHERE reference = 'CW2446091' ORDER BY amendment").fetchall()
    assert [v[0] for v in versions] == [0, 1, 2]
    assert {v["buyer_id"] for v in versions} == {"pwgsc-tpsgc"} and {v["client_id"] for v in versions} == {"dnd-mdn"}
    # English "Canadian Coast Guard / DND", French in the other order: the client is the Coast Guard.
    row = conn.execute("SELECT client_id, client_raw_en FROM contract_history WHERE reference = 'CW2439364'").fetchone()
    assert row["client_id"] == "canadian-coast-guard"
    assert row["client_raw_en"].startswith("Canadian Coast Guard (CCG) / ")
    assert conn.execute("SELECT buyer_id FROM buyer_names WHERE raw_name = 'Canadian Coast Guard (CCG)'").fetchone()[0] \
        == "canadian-coast-guard"
    # The titles and the contracting entity's spelling are kept.
    first = conn.execute("SELECT title_en, title_fr, buyer_raw_en, buyer_raw_fr, supplier_withheld FROM contract_history "
                         "WHERE reference = 'CW2446091' AND amendment = 0").fetchone()
    assert first["title_en"] and first["title_fr"] and first["supplier_withheld"] == 0
    assert first["buyer_raw_en"] == "Department of Public Works and Government Services (PSPC)"
    assert first["buyer_raw_fr"] == "Ministère des Travaux publics et des Services gouvernementaux (SPAC)"


def test_a_file_without_its_key_columns_is_refused(conn, tmp_path):
    path = tmp_path / "x.csv"
    path.write_text('"title-titre-eng","something"\n"a","b"\n', encoding="utf-8")
    with pytest.raises(ValueError, match="layout changed"):
        canadabuys.load_file(conn, "awards", path, "x.csv", now=DAY1)


# -- tender statuses -----------------------------------------------------------


def test_open_tenders_missing_from_the_open_file_expire_once_closed(conn, fixtures):
    canadabuys.load_file(conn, "tenders", fixtures / FILES["tenders"], "new.csv", now=DAY1)
    closing = dict(conn.execute("SELECT reference, closing FROM tenders"))
    now = "2026-11-18T00:00:00Z"
    in_open_file = {ref for ref in sorted(closing)[:8]}
    expired = canadabuys.expire_closed(conn, in_open_file, now)
    status = dict(conn.execute("SELECT reference, status FROM tenders"))
    for ref, close in closing.items():
        passed = close is not None and close < "2026-11-18T00:00:00"
        want = "expired" if passed and ref not in in_open_file else "open"
        assert status[ref] == want, (ref, close)
    assert expired == sum(1 for ref, c in closing.items() if c and c < "2026-11-18" and ref not in in_open_file)
    assert expired > 0


def test_a_date_alone_closes_at_the_end_of_its_day():
    assert canadabuys._passed("2026-11-16", "2026-11-16T23:00:00Z") is False
    assert canadabuys._passed("2026-11-16", "2026-11-17T00:00:00Z") is True
    assert canadabuys._passed("2026-11-16T14:00", "2026-11-16T14:00:01Z") is True


def test_the_stage_reads_complete_then_new_then_open_and_derives_statuses(conn, fixtures, fake_client, tmp_path):
    header, rows = read_csv(fixtures / FILES["tenders"])
    by_ref = {r["referenceNumber-numeroReference"]: r for r in rows}
    refs = sorted(by_ref)
    cancelled, awarded = refs[0], refs[1]
    complete = []
    for r in rows:
        r = dict(r)
        if r["referenceNumber-numeroReference"] == cancelled:
            r.update({"tenderStatus-appelOffresStatut-eng": "Cancelled", "tenderStatus-appelOffresStatut-fra": "Annulé"})
        if r["referenceNumber-numeroReference"] == awarded:
            r.update({"tenderStatus-appelOffresStatut-eng": "Awarded", "tenderStatus-appelOffresStatut-fra": "Attribué"})
        complete.append(r)
    still_open = set(refs[2:10])
    files = canadabuys.files_for("tenders", date(2026, 11, 18))
    client = fake_client({
        files["complete"].url: as_bytes(header, complete, tmp_path, "c.csv"),
        files["new"].url: as_bytes(header, [by_ref[r] for r in refs[2:5]], tmp_path, "n.csv"),
        files["open"].url: as_bytes(header, [by_ref[r] for r in sorted(still_open)], tmp_path, "o.csv"),
    })
    stats = canadabuys.run(conn, client, "tenders", now="2026-11-18T00:00:00Z", work_dir=tmp_path / "work")
    assert stats.read == [files["complete"].name, files["new"].name, files["open"].name]
    status = dict(conn.execute("SELECT reference, status FROM tenders"))
    closing = dict(conn.execute("SELECT reference, closing FROM tenders"))
    assert status[cancelled] == "cancelled" and status[awarded] == "awarded"
    for ref in refs[2:]:
        passed = closing[ref] < "2026-11-18T00:00:00"
        assert status[ref] == ("expired" if passed and ref not in still_open else "open"), ref
    assert stats.expired > 0
    # The downloads are deleted after the load.
    assert not any((tmp_path / "work").iterdir())
    log = conn.execute("SELECT source, rows_in, rows_new, ok FROM sources_log").fetchone()
    assert tuple(log) == ("tenders", len(rows) + 3 + len(still_open), len(rows), 1)


# -- which files a night reads -------------------------------------------------


def test_fiscal_year_names():
    assert canadabuys.fiscal_year(date(2026, 10, 31)) == "2026-2027"
    assert canadabuys.fiscal_year(date(2027, 3, 31)) == "2026-2027"
    assert canadabuys.fiscal_year(date(2027, 4, 1)) == "2027-2028"
    assert canadabuys.files_for("awards", date(2026, 10, 31))["fy"].url == \
        "https://canadabuys.canada.ca/opendata/pub/2026-2027-awardNotice-avisAttribution.csv"
    assert canadabuys.files_for("history", date(2027, 4, 2))["fy"].name == "2027-2028-contractHistory-contratsOctroyes.csv"


def kinds(conn, stage, when):
    return [f.kind for f in canadabuys.plan(conn, stage, when)]


def test_the_first_load_reads_the_complete_and_legacy_files(conn):
    now = datetime(2026, 10, 31, 1, tzinfo=timezone.utc)
    assert kinds(conn, "tenders", now) == ["complete", "new", "open"]
    assert kinds(conn, "awards", now) == ["legacy", "complete", "fy"]
    assert kinds(conn, "history", now) == ["legacy", "complete", "fy"]


def test_later_nights_read_the_complete_file_again_once_the_copy_read_is_a_week_old(conn):
    conn.execute("INSERT INTO awards (reference, amendment, source_file, first_seen, last_seen) "
                 "VALUES ('r', 0, 'f', '2026-10-24', '2026-10-24')")
    complete = config.AWARDS_COMPLETE_FILE
    set_meta(conn, f"canadabuys:{complete}:last_modified", "Sat, 24 Oct 2026 02:00:00 GMT")
    assert kinds(conn, "awards", datetime(2026, 10, 30, 1, tzinfo=timezone.utc)) == ["fy"]
    assert kinds(conn, "awards", datetime(2026, 10, 31, 1, 59, tzinfo=timezone.utc)) == ["fy"]
    assert kinds(conn, "awards", datetime(2026, 10, 31, 2, 0, tzinfo=timezone.utc)) == ["complete", "fy"]
    # With no Last-Modified recorded, the time it was read decides.
    conn.execute("DELETE FROM meta")
    set_meta(conn, f"canadabuys:{complete}:read_at", "2026-10-29T00:00:00Z")
    assert kinds(conn, "awards", datetime(2026, 10, 31, tzinfo=timezone.utc)) == ["fy"]
    assert kinds(conn, "awards", datetime(2026, 11, 5, tzinfo=timezone.utc)) == ["complete", "fy"]


def test_conditional_requests_and_checksums_keep_an_unchanged_file_from_being_read_again(conn, fixtures, fake_client,
                                                                                         tmp_path):
    body = (fixtures / FILES["history"]).read_bytes()
    files = canadabuys.files_for("history", date(2026, 10, 31))
    stamped = {"Last-Modified": "Fri, 30 Oct 2026 02:00:00 GMT", "ETag": '"v1"'}
    client = fake_client({
        files["legacy"].url: FakeResponse(200, body, stamped),
        files["complete"].url: FakeResponse(200, body, stamped),
        files["fy"].url: FakeResponse(200, body, stamped),
    })
    first = canadabuys.run(conn, client, "history", now=DAY2, work_dir=tmp_path)
    # Each file is compared with its own last copy: the first night reads all three.
    assert first.read == [files["legacy"].name, files["complete"].name, files["fy"].name]
    assert first.new == 28 and first.excluded == 3  # the same person row in each of the three files
    assert get_meta(conn, f"canadabuys:{files['fy'].name}:etag") == '"v1"'
    assert get_meta(conn, f"canadabuys:{files['fy'].name}:last_modified") == "Fri, 30 Oct 2026 02:00:00 GMT"
    assert get_meta(conn, f"canadabuys:{files['fy'].name}:sha256")

    # The next night: the fiscal-year file is asked for with its validators and has not moved.
    client.fake_session.mapping[files["fy"].url] = FakeResponse(304)
    calls = len(client.fake_session.calls)
    second = canadabuys.run(conn, client, "history", now="2026-11-01T01:00:00Z", work_dir=tmp_path)
    assert second.read == [] and second.unchanged == [files["fy"].name]
    sent = client.fake_session.calls[calls:]
    assert [url for url, _ in sent] == [files["fy"].url]
    assert sent[0][1]["If-None-Match"] == '"v1"'
    assert sent[0][1]["If-Modified-Since"] == "Fri, 30 Oct 2026 02:00:00 GMT"

    # A host that sends the same bytes again: the checksum stops the parse.
    client.fake_session.mapping[files["fy"].url] = FakeResponse(200, body, stamped)
    third = canadabuys.run(conn, client, "history", now="2026-11-02T01:00:00Z", work_dir=tmp_path)
    assert third.read == [] and third.unchanged == [files["fy"].name]
    assert not list(tmp_path.glob("*.csv"))


def test_a_fiscal_year_file_not_published_yet_is_a_notice(conn, fake_client, tmp_path):
    conn.execute("INSERT INTO awards (reference, amendment, source_file, first_seen, last_seen) "
                 "VALUES ('r', 0, 'f', '2027-03-31', '2027-03-31')")
    set_meta(conn, f"canadabuys:{config.AWARDS_COMPLETE_FILE}:read_at", "2027-03-31T00:00:00Z")
    stats = canadabuys.run(conn, fake_client({}), "awards", now="2027-04-01T01:00:00Z", work_dir=tmp_path)
    assert stats.notices == ["2027-2028-awardNotice-avisAttribution.csv is not published yet"]
    row = conn.execute("SELECT ok, notice FROM sources_log WHERE source = 'awards'").fetchone()
    assert row["ok"] == 1 and "not published yet" in row["notice"]


def test_samples_stand_in_for_the_files_under_their_names(conn, fixtures, tmp_path):
    for stage, sample in (("tenders", "newTenderNotice.csv"), ("awards", "2026-2027-awardNotice.csv"),
                          ("history", "2026-2027-contractHistory.csv")):
        (tmp_path / sample).write_bytes((fixtures / FILES[stage]).read_bytes())
    found = {stage: [(f.kind, f.name) for f, _ in canadabuys.sample_files(stage, tmp_path)] for stage in canadabuys.STAGES}
    assert found == {
        "tenders": [("new", config.TENDERS_NEW_FILE)],
        "awards": [("fy", "2026-2027-awardNotice-avisAttribution.csv")],
        "history": [("fy", "2026-2027-contractHistory-contratsOctroyes.csv")],
    }
    stats = canadabuys.run(conn, None, "awards", now=DAY1, samples=tmp_path)
    assert stats.read == ["2026-2027-awardNotice-avisAttribution.csv"]
    assert conn.execute("SELECT DISTINCT source_file FROM awards").fetchall()[0][0] == \
        "2026-2027-awardNotice-avisAttribution.csv"
    # Read again unchanged: the checksum keeps it from being parsed twice.
    assert canadabuys.run(conn, None, "awards", now=DAY2, samples=tmp_path).unchanged == \
        ["2026-2027-awardNotice-avisAttribution.csv"]
    assert (tmp_path / "2026-2027-awardNotice.csv").exists()


def test_organizations_upsert_place_key():
    assert organizations.place_key("Canada ", "Quebec", "MONTREAL", "h9r1a6") == ("CA", "QC", "Montreal", "H9R 1A6")
    assert organizations.place_key(None, None, "St. John's", "A1C 5M2") == ("CA", "NL", "St. John's", "A1C 5M2")
    assert organizations.place_key("USA", "Texas", "Austin", "78701") == ("US", "", "Austin", "78701")
    assert organizations.place_key(None, None, None, None) == ("", "", "", "")
