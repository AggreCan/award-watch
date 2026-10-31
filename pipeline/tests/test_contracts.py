"""The contracts stage: the published contracts over $10,000, the withheld vendor, the whole-table rewrite and the weekly check.

The fixture is the first 30 rows of contracts.csv (2026-10-31) with buyer_name
blank; one vendor is replaced by an invented person's name, one row carries
lists of trade agreements and limited-tendering reasons, one a vendor abroad.
"""

import csv
import json

import pytest

from conftest import FakeResponse
from awardwatch_pipeline import cli, config, organizations
from awardwatch_pipeline.db import get_meta
from awardwatch_pipeline.normalize import norm_name, org_id
from awardwatch_pipeline.sources import buyers, contracts

csv.field_size_limit(2**31 - 1)
DAY1 = "2026-10-31T01:00:00Z"
FIXTURE = "contracts_head.csv"
URL = config.CONTRACTS_URL


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        return reader.fieldnames, list(reader)


def write_csv(path, header, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)
    return path


def by_ref(conn):
    return {r["reference"]: dict(r) for r in conn.execute("SELECT * FROM contracts")}


# -- loading -------------------------------------------------------------------


def test_every_row_is_kept_with_its_fields(conn, fixtures):
    stats = contracts.load_file(conn, fixtures / FIXTURE, now=DAY1)
    assert (stats.rows, stats.stored, stats.withheld, stats.skipped, stats.missing) == (30, 30, 1, 0, [])
    rows = by_ref(conn)
    first = rows["C-2019-2020-Q4-1"]
    assert first == {
        "owner_org": "casdo-ocena", "reference": "C-2019-2020-Q4-1", "procurement_id": "P2000002",
        "vendor_raw": "Simzer Design Inc.", "vendor_postal": None, "vendor_country": "CA", "vendor_withheld": 0,
        "buyer_id": "casdo-ocena", "buyer_name_raw": None, "contracting_entity": None,
        "contract_date": "2020-02-26", "period_start": "2019-11-15", "delivery_date": "2020-05-30",
        "value": 38900.25, "original_value": 15255.0, "amendment_value": 23645.25, "economic_object": "0351",
        "description_en": "Communications professional services not elsewhere specified",
        "description_fr": "Services professionnels de communications non specifies ailleurs",
        "comments_en": "Increase contract by $23,645", "comments_fr": "Augmentation du contrat de 23 645 $",
        "commodity_type": "S", "commodity_code": "T005", "agreement_type": "0", "trade_agreement": None,
        "land_claims": None, "solicitation_procedure": "TN", "competitive": 0,
        "limited_tendering_reason": '["85"]', "trade_agreement_exceptions": "00", "indigenous_business": None,
        "indigenous_business_excluding_psib": "N", "intellectual_property": "A3",
        "potential_commercial_exploitation": "N", "former_public_servant": "N", "standing_offer_number": None,
        "instrument_type": "A", "ministers_office": "N", "number_of_bids": None, "article_6_exceptions": None,
        "award_criteria": None, "socioeconomic_indicator": None, "reporting_period": "2019-2020-Q4",
        "organization_id": org_id(norm_name("Simzer Design Inc.")), "loaded_at": DAY1,
    }
    # Lists split on commas; bids as a number; open bidding is competitive.
    listed = rows["C-2020-2021-Q4-00004"]
    assert json.loads(listed["trade_agreement"]) == ["CA", "CL", "KR"]
    assert json.loads(listed["limited_tendering_reason"]) == ["71", "74"]
    assert (listed["number_of_bids"], listed["competitive"]) == (3, 1)
    # The postal area as published, and a vendor abroad.
    assert (rows["C-2020-2021-Q3-00001"]["vendor_postal"], rows["C-2020-2021-Q3-00001"]["vendor_country"]) == ("K1R", "CA")
    assert (rows["C-2020-2021-Q4-00005"]["vendor_postal"], rows["C-2020-2021-Q4-00005"]["vendor_country"]) == ("20001", "US")


def test_vendors_and_the_department_are_joined(conn, fixtures):
    contracts.load_file(conn, fixtures / FIXTURE, now=DAY1)
    simzer = org_id(norm_name("Simzer Design Inc."))
    assert conn.execute("SELECT COUNT(*) FROM contracts WHERE organization_id = ?", (simzer,)).fetchone()[0] == 5
    assert dict(conn.execute("SELECT raw_name, n FROM organization_names WHERE organization_id = ? AND source = "
                             "'contracts'", (simzer,))) == {"Simzer Design Inc.": 5}
    csa = org_id(norm_name("CSA Group"))
    assert conn.execute("SELECT COUNT(*) FROM contracts WHERE organization_id = ?", (csa,)).fetchone()[0] == 4
    # The reporting department is the buyer, created from its "English | French" title.
    buyer = conn.execute("SELECT name_en, name_fr, ckan_org FROM buyers WHERE id = 'casdo-ocena'").fetchone()
    assert tuple(buyer) == ("Accessibility Standards Canada", "Normes d’accessibilité Canada", "casdo-ocena")
    assert {r[0] for r in conn.execute("SELECT DISTINCT buyer_id FROM contracts")} == {"casdo-ocena"}


def test_a_vendor_named_as_a_person_keeps_the_record_and_withholds_the_vendor(conn, fixtures):
    contracts.load_file(conn, fixtures / FIXTURE, now=DAY1)
    row = by_ref(conn)["C-2020-2021-Q4-00013"]
    assert (row["vendor_raw"], row["vendor_postal"], row["organization_id"], row["vendor_withheld"]) == \
        (None, None, None, 1)
    # The spending record stays: department, value, date, country.
    assert (row["buyer_id"], row["value"], row["contract_date"], row["vendor_country"]) == \
        ("casdo-ocena", 33900.0, "2021-02-12", "CA")
    for table, column in (("organizations", "display_name"), ("organization_names", "raw_name"),
                          ("contracts", "vendor_raw")):
        assert conn.execute(f"SELECT 1 FROM {table} WHERE {column} LIKE '%Holloway%'").fetchone() is None


def test_a_placeholder_vendor_keeps_the_row_with_no_vendor(conn, fixtures):
    stats = contracts.load_file(conn, fixtures / FIXTURE, now=DAY1)
    row = by_ref(conn)["C-2020-2021-Q4-00012"]  # "Request for Proposal" where the vendor goes
    assert (row["vendor_raw"], row["organization_id"], row["vendor_withheld"], row["value"]) == (None, None, 0, 28250.0)
    assert stats.withheld == 1  # the placeholder is no person
    assert conn.execute("SELECT 1 FROM organization_names WHERE raw_name LIKE 'Request%'").fetchone() is None


def test_a_department_not_among_the_ckan_organizations_is_made_and_listed(conn):
    assert buyers.for_owner_org(conn, "xyz-abc", "Example Agency | Agence exemple", now=DAY1) == "xyz-abc"
    assert buyers.take_notices(conn) == ["buyer xyz-abc made for 'Example Agency' (not among the CKAN organizations loaded)"]
    assert buyers.for_owner_org(conn, "xyz-abc", "Example Agency | Agence exemple", now=DAY1) == "xyz-abc"
    assert buyers.take_notices(conn) == []


def test_the_buyer_name_is_never_stored_and_text_is_cut_at_600(conn, fixtures, tmp_path):
    header, rows = read_csv(fixtures / FIXTURE)
    for row in rows:
        row["buyer_name"] = "Invented Buyer"
    rows[0]["description_en"] = "x" * 700
    rows[0]["comments_fr"] = "y" * 650
    contracts.load_file(conn, write_csv(tmp_path / "c.csv", header, rows), now=DAY1)
    assert conn.execute("SELECT COUNT(*) FROM contracts WHERE buyer_name_raw IS NOT NULL").fetchone()[0] == 0
    first = by_ref(conn)["C-2019-2020-Q4-1"]
    assert (len(first["description_en"]), len(first["comments_fr"])) == (600, 600)


# -- the table is rewritten whole, or not at all -------------------------------


def test_each_load_rewrites_the_table_whole_and_a_repeated_key_keeps_the_last_row(conn, fixtures, tmp_path):
    header, rows = read_csv(fixtures / FIXTURE)
    contracts.load_file(conn, fixtures / FIXTURE, now=DAY1)
    again = [dict(rows[0], contract_value="1.00"), dict(rows[0], contract_value="2.00"), rows[1], rows[2]]
    stats = contracts.load_file(conn, write_csv(tmp_path / "c.csv", header, again), now="2026-11-07T01:00:00Z")
    assert (stats.rows, stats.written, stats.stored) == (4, 4, 3)
    assert sorted(by_ref(conn)) == ["C-2019-2020-Q4-1", "C-2019-2020-Q4-2", "C-2019-2020-Q4-3"]
    assert by_ref(conn)["C-2019-2020-Q4-1"]["value"] == 2.0


def test_a_changed_layout_is_refused_before_anything_is_written(conn, fixtures, tmp_path):
    contracts.load_file(conn, fixtures / FIXTURE, now=DAY1)
    before = by_ref(conn)
    header, rows = read_csv(fixtures / FIXTURE)
    header = [h for h in header if h != "contract_value"]
    rows = [{k: v for k, v in r.items() if k != "contract_value"} for r in rows][:3]
    with pytest.raises(contracts.LayoutError, match="contract_value"):
        contracts.load_file(conn, write_csv(tmp_path / "c.csv", header, rows), now="2026-11-07T01:00:00Z")
    assert by_ref(conn) == before


def test_a_failure_part_way_keeps_the_previous_rows_and_fails_the_stage(conn, fixtures, tmp_path, monkeypatch):
    contracts.load_file(conn, fixtures / FIXTURE, now=DAY1)
    before = by_ref(conn)
    orgs_before = conn.execute("SELECT COUNT(*) FROM organizations").fetchone()[0]
    header, rows = read_csv(fixtures / FIXTURE)
    samples = tmp_path / "s"
    samples.mkdir()
    write_csv(samples / "contracts-head.csv", header, [dict(r, vendor_name=f"Other Vendor {i} Inc.")
                                                      for i, r in enumerate(rows)])
    real, calls = organizations.upsert, []

    def flaky(*args, **kwargs):
        calls.append(1)
        if len(calls) == 10:
            raise RuntimeError("disk gone")
        return real(*args, **kwargs)

    monkeypatch.setattr(organizations, "upsert", flaky)
    ok = cli._stage(conn, "contracts", lambda: contracts.run(conn, None, now="2026-11-07T01:00:00Z", samples=samples))
    assert ok is False
    assert by_ref(conn) == before
    assert conn.execute("SELECT COUNT(*) FROM organizations").fetchone()[0] == orgs_before
    log = conn.execute("SELECT ok, detail FROM sources_log WHERE source = 'contracts'").fetchone()
    assert tuple(log) == (0, "RuntimeError: disk gone")


# -- the stage: samples, review list, weekly check -----------------------------


def test_samples_read_the_head_and_skip_its_cut_last_line(conn, fixtures, tmp_path, out_dir):
    samples = tmp_path / "s"
    samples.mkdir()
    body = (fixtures / FIXTURE).read_bytes()
    # Cut inside the last row's last field: the row has every column, the title is cut short.
    (samples / "contracts-head.csv").write_bytes(body[:-12])
    result = contracts.run(conn, None, now=DAY1, samples=samples)
    assert result.state == "read"
    assert (result.stats.rows, result.stats.stored, result.stats.skipped) == (30, 29, 1)
    assert "C-2020-2021-Q4-00019" not in by_ref(conn)
    # The same sample again is not parsed again.
    assert contracts.run(conn, None, now="2026-11-01T01:00:00Z", samples=samples).state == "unchanged"
    # Nothing in a samples run touches the weekly check of the real file.
    assert get_meta(conn, "contracts_loaded_at") is None


def test_the_stage_lists_withheld_names_for_review_and_logs_only_the_count(conn, fixtures, tmp_path, out_dir):
    samples = tmp_path / "s"
    samples.mkdir()
    (samples / "contracts-head.csv").write_bytes((fixtures / FIXTURE).read_bytes())
    contracts.run(conn, None, now=DAY1, samples=samples)
    review = out_dir / "review" / "contracts-persons.txt"
    assert [line for line in review.read_text(encoding="utf-8").splitlines() if not line.startswith("#")] == \
        ["Laura Holloway"]
    log = conn.execute("SELECT detail, rows_in, rows_new, excluded, ok, notice FROM sources_log").fetchone()
    assert (log["rows_in"], log["rows_new"], log["excluded"], log["ok"]) == (30, 30, 1, 1)
    assert log["detail"] == "read rows=30 stored=30 withheld=1 duplicates=0 skipped=0"
    assert "1 rows (1 names) read as private individuals, vendor withheld" in log["notice"]
    assert "Holloway" not in log["notice"] and "Holloway" not in log["detail"]
    # No CKAN in a samples run: the department is made from its title, and listed.
    assert "buyer casdo-ocena made for 'Accessibility Standards Canada'" in log["notice"]


def test_a_samples_run_without_the_sample_is_a_notice(conn, tmp_path):
    result = contracts.run(conn, None, now=DAY1, samples=tmp_path)
    assert result.state == "no sample"
    log = conn.execute("SELECT ok, detail, notice FROM sources_log").fetchone()
    assert (log["ok"], log["detail"]) == (1, "no sample") and "contracts-head.csv" in log["notice"]


def test_the_file_is_checked_weekly_with_its_validators(conn, fixtures, fake_client, tmp_path):
    body = (fixtures / FIXTURE).read_bytes()
    header, rows = read_csv(fixtures / FIXTURE)
    v1 = {"Last-Modified": "Fri, 30 Oct 2026 02:00:00 GMT", "ETag": '"c1"'}
    client = fake_client({URL: FakeResponse(200, body, v1)})
    work = tmp_path / "work"

    def run(now):
        return contracts.run(conn, client, now=now, work_dir=work)

    assert run("2026-10-31T00:00:00Z").state == "read"
    assert get_meta(conn, "contracts_loaded_at") == "2026-10-31T00:00:00Z"
    assert get_meta(conn, "contracts:last_modified") == v1["Last-Modified"]
    assert get_meta(conn, "contracts:etag") == '"c1"' and get_meta(conn, "contracts:sha256")
    assert not any(work.iterdir())  # the download is deleted after the load
    calls = client.fake_session.calls

    # Six days later: not due, no request.
    assert run("2026-11-06T23:59:00Z").state == "not due" and len(calls) == 1
    # A week later: a conditional request; 304 keeps the table and restarts the week.
    client.fake_session.mapping[URL] = FakeResponse(304)
    assert run("2026-11-07T00:00:00Z").state == "unchanged" and len(calls) == 2
    assert calls[1][1]["If-None-Match"] == '"c1"' and calls[1][1]["If-Modified-Since"] == v1["Last-Modified"]
    assert get_meta(conn, "contracts_loaded_at") == "2026-11-07T00:00:00Z"
    # Regenerated upstream with the same bytes: the checksum stops the parse.
    v2 = {"Last-Modified": "Sat, 14 Nov 2026 02:00:00 GMT", "ETag": '"c2"'}
    client.fake_session.mapping[URL] = FakeResponse(200, body, v2)
    assert run("2026-11-14T00:00:00Z").state == "unchanged"
    assert {r[0] for r in conn.execute("SELECT DISTINCT loaded_at FROM contracts")} == {"2026-10-31T00:00:00Z"}
    assert get_meta(conn, "contracts:last_modified") == v2["Last-Modified"]
    # New content: read and rewritten.
    changed = dict(rows[0], contract_value="99.00")
    client.fake_session.mapping[URL] = FakeResponse(200, write_csv(tmp_path / "n.csv", header, [changed]).read_bytes(),
                                                    {"Last-Modified": "Sat, 21 Nov 2026 02:00:00 GMT"})
    assert run("2026-11-21T00:00:00Z").state == "read"
    assert [(r["reference"], r["value"]) for r in conn.execute("SELECT reference, value FROM contracts")] == \
        [("C-2019-2020-Q4-1", 99.0)]
    log = [tuple(r) for r in conn.execute("SELECT detail, ok FROM sources_log ORDER BY id")]
    assert [d.split(" ")[0] for d, _ in log] == ["read", "not", "unchanged", "unchanged", "read"]
    assert all(ok == 1 for _, ok in log)


def test_a_copy_refused_for_its_layout_is_not_downloaded_again_until_it_changes(conn, fixtures, fake_client, tmp_path):
    header, rows = read_csv(fixtures / FIXTURE)
    good = (fixtures / FIXTURE).read_bytes()
    bad_header = [h for h in header if h != "owner_org"]
    bad = write_csv(tmp_path / "bad.csv", bad_header, [{k: v for k, v in r.items() if k != "owner_org"}
                                                       for r in rows]).read_bytes()
    client = fake_client({URL: FakeResponse(200, good, {"Last-Modified": "Fri, 30 Oct 2026 02:00:00 GMT"})})
    contracts.run(conn, client, now="2026-10-31T00:00:00Z", work_dir=tmp_path / "w")
    before = by_ref(conn)

    stamped = {"Last-Modified": "Sat, 07 Nov 2026 02:00:00 GMT"}
    client.fake_session.mapping[URL] = FakeResponse(200, bad, stamped)
    with pytest.raises(contracts.LayoutError, match="owner_org"):
        contracts.run(conn, client, now="2026-11-07T03:00:00Z", work_dir=tmp_path / "w")
    assert by_ref(conn) == before
    # The retry the same day sends the refused copy's validators; a 304 fails again without a download.
    client.fake_session.mapping[URL] = FakeResponse(304)
    with pytest.raises(contracts.LayoutError, match="has not changed"):
        contracts.run(conn, client, now="2026-11-07T06:00:00Z", work_dir=tmp_path / "w")
    assert client.fake_session.calls[-1][1]["If-Modified-Since"] == stamped["Last-Modified"]
    # The copy loaded before comes back: nothing to parse, and the refusal is over.
    client.fake_session.mapping[URL] = FakeResponse(200, good, {"Last-Modified": "Sun, 08 Nov 2026 02:00:00 GMT"})
    assert contracts.run(conn, client, now="2026-11-08T00:00:00Z", work_dir=tmp_path / "w").state == "unchanged"
    assert get_meta(conn, "contracts:rejected") is None and get_meta(conn, "contracts:rejected_sha256") is None
    # A week on, a 304 is plain "unchanged" again.
    client.fake_session.mapping[URL] = FakeResponse(304)
    assert contracts.run(conn, client, now="2026-11-15T00:00:00Z", work_dir=tmp_path / "w").state == "unchanged"
    oks = [r[0] for r in conn.execute("SELECT ok FROM sources_log WHERE source = 'contracts' ORDER BY id")]
    assert oks == [1, 1, 1]  # the two refusals raised: the run's _stage logs those
