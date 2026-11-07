"""The grants stage: every organizational agreement version, individuals left out, persons withheld, the weekly rewrite.

The fixture is the first 30 rows of grants.csv (2026-10-31). Edited for the
rules under test: one agreement turned into a grant to an individual (type P)
and one into a for-profit recipient named as a person (both names invented),
one recipient and city written in both languages, an invented recipient
with a business number and an operating name, a foreign-currency
amendment, and a city carrying its province.
"""

import csv

import pytest

from conftest import FakeResponse
from awardwatch_pipeline import config, organizations
from awardwatch_pipeline.db import get_meta
from awardwatch_pipeline.normalize import norm_name, org_id
from awardwatch_pipeline.sources import grants
from awardwatch_pipeline.sources.contracts import LayoutError

csv.field_size_limit(2**31 - 1)
DAY1 = "2026-10-31T01:00:00Z"
FIXTURE = "grants_head.csv"


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


def versions(conn):
    return {(r["reference"], r["amendment"]): dict(r) for r in conn.execute("SELECT * FROM grants")}


def test_one_row_per_version_with_its_fields(conn, fixtures):
    stats = grants.load_file(conn, fixtures / FIXTURE, now=DAY1)
    assert (stats.rows, stats.stored, stats.dropped, stats.withheld, stats.skipped) == (30, 29, 1, 1, 0)
    rows = versions(conn)
    # Every amendment is its own row; the reference is kept as published.
    assert {a for (ref, a) in rows if ref == "199-2020-2021-Q4-CSGC17320623"} == {0, 2}
    assert ("199-2019-2020-Q4- CSGC16725277", 0) in rows
    carleton = rows[("199-2019-2020-Q4- CSGC16725277", 0)]
    assert {k: carleton[k] for k in ("owner_org", "agreement_type", "recipient_type", "legal_name", "country",
                                     "province", "city", "postal_code", "value", "start", "end", "buyer_id",
                                     "recipient_withheld", "loaded_at")} == {
        "owner_org": "casdo-ocena", "agreement_type": "G", "recipient_type": "S",
        "legal_name": "Carleton University", "country": "CA", "province": "ON", "city": "Ottawa",
        "postal_code": "K1S 5B6", "value": 478593.0, "start": "2020-03-24", "end": "2021-03-29",
        "buyer_id": "casdo-ocena", "recipient_withheld": 0, "loaded_at": DAY1,
    }
    assert carleton["organization_id"] == org_id(norm_name("Carleton University"))
    assert carleton["program_en"] and carleton["program_fr"] and carleton["title_en"]
    # A field in both languages keeps its first part; the province comes from the city.
    ubc = rows[("199-2020-2021-Q4-CSGC17322173", 0)]
    assert (ubc["legal_name"], ubc["city"], ubc["province"], ubc["postal_code"]) == \
        ("University of British Columbia", "Vancouver", "BC", "V6T 1Z3")
    assert (ubc["riding_en"], ubc["riding_fr"], ubc["riding_number"]) == ("Vancouver Quadra", "Vancouver Quadra", "59039")
    # An older row writes the province into the city.
    headingley = rows[("199-2020-2021-Q4-CSGC17324302", 0)]
    assert (headingley["city"], headingley["province"], headingley["postal_code"]) == ("Headingley", "MB", "R4H 1A1")
    # The business number on both versions; the foreign currency on the amendment.
    harbour = [rows[("199-2020-2021-Q4-CSGC17320318", a)] for a in (0, 1)]
    assert [d["business_number"] for d in harbour] == ["837253251", "837253251"]
    assert [d["operating_name"] for d in harbour] == ["Harbourview Institute"] * 2
    neil = rows[("199-2020-2021-Q4-CSGC17319997", 1)]
    assert (neil["value"], neil["fx_type"], neil["fx_value"], neil["naics"], neil["amendment_date"]) == \
        (702500.0, "USD", 500000.0, "8133", "2022-05-04")
    # Accents survive the read.
    assert rows[("199-2020-2021-Q4-CSGC17323502", 0)]["legal_name"].startswith("Réseau québécois")


def test_recipients_become_organizations_with_the_operating_name_as_a_second_spelling(conn, fixtures):
    grants.load_file(conn, fixtures / FIXTURE, now=DAY1)
    cnib = org_id(norm_name("Canadian National Institute for the Blind"))
    assert conn.execute("SELECT COUNT(*) FROM grants WHERE organization_id = ?", (cnib,)).fetchone()[0] == 3
    harbour = org_id(norm_name("Harbourview Accessibility Institute"))

    def names():
        return {(r[0], r[1]): r[2] for r in conn.execute(
            "SELECT raw_name, source, n FROM organization_names WHERE organization_id = ?", (harbour,))}

    expected = {("Harbourview Accessibility Institute", "grants"): 2, ("Harbourview Institute", "grants:operating"): 2}
    assert names() == expected
    # The nightly rebuild reads the operating name back from the grants table: it stays, counted once per row.
    organizations.recompute(conn, now=DAY1)
    assert names() == expected
    assert conn.execute("SELECT display_name FROM organizations WHERE id = ?", (harbour,)).fetchone()[0] == \
        "Harbourview Accessibility Institute"
    # An operating name that repeats the legal name is not stored as a second spelling.
    assert conn.execute("SELECT COUNT(*) FROM grants WHERE operating_name = legal_name").fetchone()[0] == 0
    places = {tuple(r) for r in conn.execute("SELECT country, province, city, postal_code FROM organization_places "
                                             "WHERE organization_id = ?", (harbour,))}
    assert places == {("CA", "NS", "Halifax", "B3H 4R2")}
    buyer = conn.execute("SELECT name_en, name_fr FROM buyers WHERE id = 'casdo-ocena'").fetchone()
    assert tuple(buyer) == ("Accessibility Standards Canada", "Normes d’accessibilité Canada")


def test_individuals_are_left_out_and_a_person_named_recipient_is_withheld(conn, fixtures):
    grants.load_file(conn, fixtures / FIXTURE, now=DAY1)
    rows = versions(conn)
    # Type P: nothing of the row is stored.
    assert not any(ref == "199-2020-2021-Q4-CSGC17323627" for ref, _ in rows)
    # Named as a person under another type: the agreement stays, the recipient is withheld.
    row = rows[("199-2020-2021-Q4-CSGC17320680", 0)]
    assert {k: row[k] for k in ("legal_name", "operating_name", "business_number", "city", "postal_code",
                                "organization_id", "recipient_withheld")} == {
        "legal_name": None, "operating_name": None, "business_number": None, "city": None, "postal_code": None,
        "organization_id": None, "recipient_withheld": 1,
    }
    assert (row["recipient_type"], row["country"], row["province"], row["value"], row["buyer_id"]) == \
        ("F", "CA", "ON", 519594.0, "casdo-ocena")
    for name in ("Penhaligon", "Ashdale"):
        for table, column in (("organizations", "display_name"), ("organization_names", "raw_name"),
                              ("grants", "legal_name"), ("grants", "operating_name")):
            assert conn.execute(f"SELECT 1 FROM {table} WHERE {column} LIKE ?", (f"%{name}%",)).fetchone() is None


def test_narrative_fields_are_cut_and_the_table_is_rewritten_whole(conn, fixtures, tmp_path):
    header, rows = read_csv(fixtures / FIXTURE)
    grants.load_file(conn, fixtures / FIXTURE, now=DAY1)
    rows[0]["description_en"] = "d" * 900
    rows[0]["agreement_title_fr"] = "t" * 601
    stats = grants.load_file(conn, write_csv(tmp_path / "g.csv", header, rows[:2]), now="2026-11-07T01:00:00Z")
    assert stats.stored == 2 and len(versions(conn)) == 2
    first = versions(conn)[("199-2019-2020-Q4- CSGC16725277", 0)]
    assert (len(first["description_en"]), len(first["title_fr"])) == (600, 600)


def test_a_changed_layout_is_refused_and_keeps_the_previous_rows(conn, fixtures, tmp_path):
    grants.load_file(conn, fixtures / FIXTURE, now=DAY1)
    before = versions(conn)
    header, rows = read_csv(fixtures / FIXTURE)
    header = [h for h in header if h != "agreement_value"]
    rows = [{k: v for k, v in r.items() if k != "agreement_value"} for r in rows]
    with pytest.raises(LayoutError, match="agreement_value"):
        grants.load_file(conn, write_csv(tmp_path / "g.csv", header, rows), now="2026-11-07T01:00:00Z")
    assert versions(conn) == before


def test_the_stage_counts_individuals_and_withheld_rows_and_lists_only_the_withheld(conn, fixtures, tmp_path,
                                                                                   out_dir):
    samples = tmp_path / "s"
    samples.mkdir()
    (samples / "grants-head.csv").write_bytes((fixtures / FIXTURE).read_bytes())
    result = grants.run(conn, None, now=DAY1, samples=samples)
    assert result.state == "read"
    log = conn.execute("SELECT detail, rows_in, rows_new, excluded, ok, notice FROM sources_log").fetchone()
    assert (log["rows_in"], log["rows_new"], log["excluded"], log["ok"]) == (30, 29, 2, 1)
    assert log["detail"] == "read rows=30 stored=29 withheld=1 dropped_individuals=1 duplicates=0 skipped=0 redacted=0"
    assert "recipient withheld" in log["notice"]
    review = out_dir / "review" / "grants-persons.txt"
    assert [line for line in review.read_text(encoding="utf-8").splitlines() if not line.startswith("#")] == \
        ["Daniel Ashdale"]
    for name in ("Ashdale", "Penhaligon"):
        assert name not in log["notice"] and name not in log["detail"]


def test_the_six_shapes_of_person_test_7_are_withheld_and_counted(conn, fixtures, tmp_path, out_dir):
    """Each shape that passed the person test before version 7 (test_matching.SIX_PATTERNS, invented names),
    written as the recipient of a for-profit agreement: withheld, counted with the other withheld rows,
    listed for review, and found nowhere in the database."""
    from test_matching import SIX_PATTERNS

    header, rows = read_csv(fixtures / FIXTURE)
    template = next(r for r in rows if r["ref_number"] == "199-2020-2021-Q4-CSGC17320680")
    for i, name in enumerate(SIX_PATTERNS.values()):
        rows.append({**template, "ref_number": f"199-2020-2021-Q4-TEST{i:04d}", "recipient_legal_name": name,
                     "recipient_operating_name": "", "recipient_business_number": ""})
    samples = tmp_path / "s"
    samples.mkdir()
    write_csv(samples / "grants-head.csv", header, rows)
    assert grants.run(conn, None, now=DAY1, samples=samples).state == "read"
    n = len(SIX_PATTERNS)
    log = conn.execute("SELECT detail, rows_in, excluded FROM sources_log").fetchone()
    assert (log["rows_in"], log["excluded"]) == (30 + n, 2 + n)
    assert f"stored={29 + n} withheld={1 + n} dropped_individuals=1" in log["detail"]
    review = out_dir / "review" / "grants-persons.txt"
    listed = [line for line in review.read_text(encoding="utf-8").splitlines() if not line.startswith("#")]
    assert listed == ["Daniel Ashdale", *SIX_PATTERNS.values()]
    for word in ("Quentaro", "Brisavel", "Tolmandre", "Ostrevik", "Pellivant", "Corrabin", "Zorblax"):
        for table, column in (("organizations", "display_name"), ("organization_names", "raw_name"),
                              ("grants", "legal_name")):
            assert conn.execute(f"SELECT 1 FROM {table} WHERE {column} LIKE ?", (f"%{word}%",)).fetchone() is None
        assert word not in log["detail"]


def test_the_bracketed_firm_switch_files_the_agreement_under_the_firm(conn, fixtures, tmp_path, monkeypatch):
    from awardwatch_pipeline.sources import matching

    monkeypatch.setattr(matching, "PERSON_WITH_FIRM", "firm")
    header, rows = read_csv(fixtures / FIXTURE)
    template = next(r for r in rows if r["ref_number"] == "199-2020-2021-Q4-CSGC17320680")
    row = {**template, "ref_number": "199-2020-2021-Q4-TESTFIRM", "recipient_operating_name": "",
           "recipient_business_number": "", "recipient_legal_name": "Quentaro, Laura (Zorblax Holdings Ltd.)",
           "description_en": "Laura Quentaro will lead the project for Zorblax Holdings."}
    stats = grants.load_file(conn, write_csv(tmp_path / "g.csv", header, [row]), now=DAY1)
    assert (stats.stored, stats.withheld, stats.redacted) == (1, 0, 1)
    got = versions(conn)[("199-2020-2021-Q4-TESTFIRM", 0)]
    assert (got["legal_name"], got["recipient_withheld"]) == ("Zorblax Holdings Ltd.", 0)
    assert got["organization_id"] == org_id(norm_name("Zorblax Holdings Ltd."))
    assert got["description_en"] == "[name withheld] will lead the project for Zorblax Holdings."
    assert conn.execute("SELECT 1 FROM organization_names WHERE raw_name LIKE '%Quentaro%'").fetchone() is None


def test_the_file_is_checked_weekly(conn, fixtures, fake_client, tmp_path):
    body = (fixtures / FIXTURE).read_bytes()
    stamped = {"Last-Modified": "Fri, 30 Oct 2026 02:00:00 GMT", "ETag": '"g1"'}
    client = fake_client({config.GRANTS_URL: FakeResponse(200, body, stamped)})
    assert grants.run(conn, client, now="2026-10-31T00:00:00Z", work_dir=tmp_path).state == "read"
    assert grants.CHECK_EVERY_DAYS == 7 and get_meta(conn, "grants_loaded_at") == "2026-10-31T00:00:00Z"
    assert grants.run(conn, client, now="2026-11-03T00:00:00Z", work_dir=tmp_path).state == "not due"
    client.fake_session.mapping[config.GRANTS_URL] = FakeResponse(304)
    assert grants.run(conn, client, now="2026-11-07T00:00:00Z", work_dir=tmp_path).state == "unchanged"
    calls = client.fake_session.calls
    assert len(calls) == 2 and calls[1][1]["If-Modified-Since"] == stamped["Last-Modified"]
    assert calls[1][1]["User-Agent"] == config.USER_AGENT
    assert not list(tmp_path.glob("*.csv"))
    assert len(versions(conn)) == 29
