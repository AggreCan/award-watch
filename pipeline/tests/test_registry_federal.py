import hashlib

from pmw_pipeline import organizations
from pmw_pipeline.db import get_meta, set_meta
from pmw_pipeline.sources import registry_federal

HEADER = (
    "﻿Corporation number,Business number (BN),Corporate name - form 1,Corporate name - form 2,Governing legislation,"
    "Status,Status Detail,Anniversary date,Year of last annual filing,Date of last annual meeting,Street,Street 2,"
    "City/town,Province/territory,Country,Postal code,Minimum number of directors,Maximum number of directors\r\n"
)
ACTIVE = HEADER + (
    "8660115,835752437,MINDANGLER CAPITAL INC.,,Canada Business Corporations Act,Active,,2013-10-10,2025,2023-10-10,"
    "515 Legget Drive,Suite 800,Ottawa,ON,CA,K2K 3G4,1,12\r\n"
    "9000001,,PINKCLOUD SERVICES LTD.,,Canada Business Corporations Act,Active,,2026-06-22,,,,,Squamish,BC,CA,V8B 0A1,1,3\r\n"
    "9000002,,PINKCLOUD SERVICES LTD.,,Canada Business Corporations Act,Active,,2015-01-05,,,,,Calgary,AB,CA,T2P 1J9,1,3\r\n"
)
INACTIVE = HEADER + (
    "7286139,837253251,7286139 CANADA LTD.,,Canada Business Corporations Act,Inactive,Inactive - Amalgamated,2009-11-26,"
    "2025,2025-11-26,\"45, Queen Street\",,Sherbrooke,QC,CA,J1M 1J2,1,10\r\n"
)


def test_parse_extract_fields():
    rows = registry_federal.parse_extract(ACTIVE.encode("utf-8"), "u")
    assert rows[0][:3] == ("8660115", "MINDANGLER CAPITAL INC.", "mindangler capital")
    assert rows[0][3:8] == ("Active", "2013-10-10", "Ottawa", "ON", "K2K 3G4")


def test_load_and_match(conn, fake_client):
    mapping = {registry_federal.URLS[0]: ACTIVE.encode("utf-8"), registry_federal.URLS[1]: INACTIVE.encode("utf-8")}
    client = fake_client(mapping)
    stamp = "2026-10-12T00:00:00Z"
    ont = organizations.upsert(conn, "Mindangler Capital Inc", source="awards", province="ON", now=stamp)
    pink = organizations.upsert(conn, "PinkCloud Services", source="awards", province="BC", postal_code="V0N 1H0",
                                now=stamp)
    numbered = organizations.upsert(conn, "7286139 Canada Ltd.", source="history", province="AB", now=stamp)
    organizations.upsert(conn, "No Such Company", source="awards", province="NS", now=stamp)

    assert registry_federal.run(conn, client, now="2026-10-12T00:00:00Z") == 3
    assert conn.execute("SELECT COUNT(*) FROM federal_corporations").fetchone()[0] == 4
    rows = {r["organization_id"]: r for r in conn.execute("SELECT * FROM registry_matches WHERE registry = 'corporations_canada'")}
    assert rows[ont]["grade"] == "exact" and rows[ont]["registered_on"] == "2013-10-10" and rows[ont]["entity_type"] == "CBCA"
    # Two corporations share the name; the one in a province the organization's records name wins.
    assert rows[pink]["registry_id"] == "9000001" and rows[pink]["grade"] == "exact"
    assert rows[numbered]["grade"] == "probable" and rows[numbered]["status"] == "Inactive"
    assert conn.execute("SELECT COUNT(*) FROM registry_checks WHERE registry = 'corporations_canada'").fetchone()[0] == 4
    log = conn.execute("SELECT source, detail, ok FROM sources_log ORDER BY id DESC").fetchone()
    assert log["source"] == "registry" and log["detail"].startswith("corporations_canada:") and log["ok"] == 1

    # Unchanged files are not reloaded.
    calls_before = len(client.fake_session.calls)
    registry_federal.run(conn, client, now="2026-10-13T00:00:00Z")
    assert get_meta(conn, "federal_extract_sha:corporations-active-cbca-en.csv")
    assert conn.execute("SELECT COUNT(*) FROM federal_corporations").fetchone()[0] == 4
    assert len(client.fake_session.calls) == calls_before


def test_the_business_number_is_kept_and_a_file_read_by_the_older_parser_is_read_again(conn, fake_client):
    mapping = {registry_federal.URLS[0]: ACTIVE.encode("utf-8"), registry_federal.URLS[1]: INACTIVE.encode("utf-8")}
    registry_federal.run(conn, fake_client(mapping), now="2026-10-12T00:00:00Z")
    numbers = dict(conn.execute("SELECT number, business_number FROM federal_corporations"))
    assert numbers == {"8660115": "835752437", "9000001": None, "9000002": None, "7286139": "837253251"}
    # A database loaded before the number was read holds the bare checksum: the
    # unchanged file is read again once, and then not again.
    conn.execute("UPDATE federal_corporations SET business_number = NULL")
    key = "federal_extract_sha:corporations-active-cbca-en.csv"
    set_meta(conn, key, hashlib.sha256(ACTIVE.encode("utf-8")).hexdigest())
    conn.commit()
    assert registry_federal.load_extract(conn, fake_client(mapping)) == 3
    assert conn.execute("SELECT business_number FROM federal_corporations WHERE number = '8660115'").fetchone()[0] == "835752437"
    assert get_meta(conn, key).endswith(":v2")
    assert registry_federal.load_extract(conn, fake_client(mapping)) == 0


def test_any_place_on_the_records_can_make_the_grade_exact(conn, fake_client):
    mapping = {registry_federal.URLS[0]: ACTIVE.encode("utf-8"), registry_federal.URLS[1]: INACTIVE.encode("utf-8")}
    # Mostly seen in Ontario, once at the Squamish address the corporation is registered at.
    for _ in range(3):
        pink = organizations.upsert(conn, "PinkCloud Services Ltd.", source="awards", province="ON")
    organizations.upsert(conn, "PINKCLOUD SERVICES LTD", source="history", city="Squamish", postal_code="V8B 0A1")
    # Seen only abroad: the name agrees, nothing else does.
    abroad = organizations.upsert(conn, "Mindangler Capital Inc.", source="awards", country="US", province="Texas")
    registry_federal.run(conn, fake_client(mapping), now="2026-10-12T00:00:00Z")
    rows = {r["organization_id"]: r for r in conn.execute("SELECT * FROM registry_matches")}
    assert rows[pink]["registry_id"] == "9000001" and rows[pink]["grade"] == "exact"
    assert rows[abroad]["grade"] == "probable"


def test_a_samples_run_matches_without_downloading(conn, fake_client):
    client = fake_client({})
    registry_federal.run(conn, client, download=False, now="2026-10-12T00:00:00Z")
    assert client.fake_session.calls == []
    notice = conn.execute("SELECT notice FROM sources_log WHERE source = 'registry'").fetchone()[0]
    assert "not downloaded" in notice
