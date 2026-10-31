"""organizations.upsert and organizations.recompute: names, places, counters and the money rules.

Each total below is worked by hand from CLAUDE.md "Counting money"; the
records are inserted directly so every rule has one row that exercises it.
"""

import pytest

from awardwatch_pipeline import organizations
from awardwatch_pipeline.normalize import business_number, norm_name, org_id

T1, T2, T3 = "2026-10-31T00:00:00Z", "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"


def award(conn, ref, amd, name, *, total=None, amount=None, currency="CAD", status="active", awarded="2025-01-01",
          table="awards", org="auto", country="CA", province="ON", city="Ottawa", postal="K1A 0B1"):
    oid = organizations.upsert(conn, name, source="awards" if table == "awards" else "history", country=country,
                               province=province, city=city, postal_code=postal) if org == "auto" else org
    key = organizations.place_key(country, province, city, postal)
    conn.execute(
        f"INSERT INTO {table} (reference, amendment, supplier_raw, supplier_country, supplier_province, supplier_city, "
        "supplier_postal, organization_id, amount, total_value, currency, status, awarded, source_file, first_seen, "
        "last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'f', '2026-10-31', '2026-10-31')",
        (ref, amd, name, key[0] or None, key[1] or None, key[2] or None, key[3] or None, oid, amount, total,
         currency, status, awarded),
    )
    return oid


def contract(conn, ref, name, *, instrument, value=None, original=None, amendment=None, day="2025-06-01"):
    oid = organizations.upsert(conn, name, source="contracts", country="CA", postal_code="K1A 0B1")
    conn.execute(
        "INSERT INTO contracts (owner_org, reference, vendor_raw, vendor_postal, vendor_country, value, original_value, "
        "amendment_value, instrument_type, contract_date, organization_id, loaded_at) "
        "VALUES ('dept-x', ?, ?, 'K1A 0B1', 'CA', ?, ?, ?, ?, ?, ?, ?)",
        (ref, name, value, original, amendment, instrument, day, oid, T1),
    )
    return oid


def grant(conn, owner, ref, amd, name, value, *, bn=None, start="2024-04-01", org="auto"):
    oid = organizations.upsert(conn, name, source="grants", country="CA", province="ON", city="Ottawa",
                               postal_code="K1A 0B1") if org == "auto" else org
    conn.execute(
        "INSERT INTO grants (owner_org, reference, amendment, legal_name, business_number, value, start, country, "
        "province, city, postal_code, organization_id, loaded_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'CA', 'ON', 'Ottawa', 'K1A 0B1', ?, ?)",
        (owner, ref, amd, name, bn, value, start, oid, T1),
    )
    return oid


NAME = "Northwind Systems Inc."


@pytest.fixture
def northwind(conn):
    # Awards: one contract per reference, valued on its newest amendment.
    award(conn, "A1", 0, NAME, total=100, amount=100, awarded="2024-05-01")
    award(conn, "A1", 1, NAME, total=150, amount=50, awarded="2024-05-01")       # newest total, positive: 150
    award(conn, "A2", 0, NAME, total=0, amount=40, currency="")                 # blank currency is CAD; amount: 40
    award(conn, "A3", 0, NAME, total=500, amount=500)
    award(conn, "A3", 1, NAME, total=500, amount=0, status="cancelled")         # cancelled: 0
    award(conn, "A4", 0, NAME, total=1000, amount=1000, currency="USD")         # another currency: left out
    award(conn, "A5", 0, NAME, total=-5, amount=7)                              # total not positive: amount 7
    oid = award(conn, "A6", 0, NAME, total=20, amount=20, awarded="2025-09-30")
    award(conn, "A6", 1, None, total=30, amount=10, org=None)                   # newest names no supplier: still X, 30
    # Contract history, the same rules.
    award(conn, "H1", 0, NAME, total=1000, amount=1000, table="contract_history", awarded="2023-07-01")
    award(conn, "H1", 2, NAME, total=1200, amount=200, table="contract_history")  # 1200
    award(conn, "H2", 0, NAME, total=0, amount=300, currency=None, table="contract_history")  # 300
    award(conn, "H3", 0, NAME, total=50, amount=50, currency="EUR", table="contract_history")  # left out
    # Published contracts: each row's own value.
    contract(conn, "C1", NAME, instrument="C", value=1000, original=1000, amendment=0)       # original: 1000
    contract(conn, "C2", NAME, instrument="A", value=1250, original=1000, amendment=250)     # amendment: 250
    contract(conn, "C3", NAME, instrument="C", value=500)                                    # contract value: 500
    contract(conn, "C4", NAME, instrument="A", value=900, original=1000, amendment=-100)     # amendment: -100
    contract(conn, "C5", NAME, instrument="SOSA", value=500, original=400, amendment=100,    # amendment set: 100
             day="2026-10-01")
    # Grants: one agreement per department and reference, on the highest amendment.
    grant(conn, "dept-x", "G1", 0, NAME, 10000)
    grant(conn, "dept-x", "G1", 1, NAME, 12000)                                 # 12000
    grant(conn, "dept-y", "G1", 0, NAME, 5000)                                  # another department: 5000
    grant(conn, "dept-x", "G2", 0, NAME, 2500, start="2019-04-01")              # 2500
    for i, day in enumerate(("2025-01-10", "2025-02-11")):
        conn.execute("INSERT INTO lobbying_communications (comm_number, client_raw, organization_id, comm_date, "
                     "loaded_at) VALUES (?, ?, ?, ?, ?)", (f"L{i}", NAME, oid, day, T1))
    conn.commit()
    return oid


def test_each_total_follows_its_source_rule(conn, northwind):
    organizations.recompute(conn, now=T1)
    row = conn.execute("SELECT * FROM organizations WHERE id = ?", (northwind,)).fetchone()
    assert (row["n_awards"], row["total_awards"]) == (6, 150 + 40 + 0 + 7 + 30)
    assert (row["n_history"], row["total_history"]) == (3, 1200 + 300)
    assert (row["n_contracts"], row["total_contracts"]) == (5, 1000 + 250 + 500 - 100 + 100)
    assert (row["n_grants"], row["total_grants"]) == (3, 12000 + 5000 + 2500)
    assert row["n_lobbying"] == 2
    assert (row["first_seen"], row["last_seen"]) == ("2019-04-01", "2026-10-01")


def test_an_organization_with_only_other_currencies_has_no_total(conn):
    oid = award(conn, "U1", 0, "Faraway Instruments Inc.", total=900, amount=900, currency="USD")
    organizations.recompute(conn, now=T1)
    row = conn.execute("SELECT n_awards, total_awards FROM organizations WHERE id = ?", (oid,)).fetchone()
    assert tuple(row) == (1, None)


def test_the_display_name_is_the_spelling_seen_most_often_and_never_an_operating_name(conn):
    for i in range(4):
        oid = award(conn, f"S{i}", 0, "ACME WIDGETS LTD")
    for i in range(2):
        award(conn, f"T{i}", 0, "Acme Widgets Ltd.")
    award(conn, "H0", 0, "Acme Widgets Ltd.", table="contract_history")
    organizations.recompute(conn, now=T1)
    assert conn.execute("SELECT display_name FROM organizations WHERE id = ?", (oid,)).fetchone()[0] == "ACME WIDGETS LTD"
    # Four and four: the spelling in mixed case.
    award(conn, "H1", 0, "Acme Widgets Ltd.", table="contract_history")
    organizations.recompute(conn, now=T2)
    assert conn.execute("SELECT display_name FROM organizations WHERE id = ?", (oid,)).fetchone()[0] == "Acme Widgets Ltd."

    zed = award(conn, "Z0", 0, "Zed Holdings Ltd. o/a Zippy Courier Services")
    award(conn, "Z1", 0, "Zed Holdings Ltd. o/a Zippy Courier Services")
    award(conn, "Z2", 0, "Zed Holdings Ltd.")
    conn.execute("INSERT INTO organization_names (organization_id, raw_name, source, n) VALUES (?, 'Zippy Courier Services', "
                 "'registry', 10)", (zed,))
    organizations.recompute(conn, now=T3)
    names = dict(conn.execute("SELECT raw_name, SUM(n) FROM organization_names WHERE organization_id = ? GROUP BY 1",
                              (zed,)))
    assert names == {"Zed Holdings Ltd. o/a Zippy Courier Services": 2, "Zippy Courier Services": 12, "Zed Holdings Ltd.": 1}
    assert conn.execute("SELECT display_name FROM organizations WHERE id = ?", (zed,)).fetchone()[0] == \
        "Zed Holdings Ltd. o/a Zippy Courier Services"


def test_the_place_is_the_one_seen_most_often_and_the_province_canadian(conn):
    name = "Placeholder Analytics Corp."
    for i in range(4):
        oid = award(conn, f"U{i}", 0, name, country="US", province="Texas", city="Austin", postal="78701")
    for i in range(3):
        award(conn, f"O{i}", 0, name, country="Canada", province="Ontario", city="OTTAWA", postal="K1A0B1")
    for i in range(2):
        award(conn, f"T{i}", 0, name, country="CA", province="ON", city="Toronto", postal="M5V 1J1")
    award(conn, "Q0", 0, name, country="CA", province="QC", city="Gatineau", postal="J8X 1A1")
    organizations.recompute(conn, now=T1)
    row = conn.execute("SELECT country, province, city, postal_code FROM organizations WHERE id = ?", (oid,)).fetchone()
    # Canada 6 against the United States 4; Ontario 5 against Quebec 1; Ottawa the most frequent address there.
    assert tuple(row) == ("CA", "ON", "Ottawa", "K1A 0B1")
    places = {tuple(r[:4]): r[4] for r in conn.execute(
        "SELECT country, province, city, postal_code, n FROM organization_places WHERE organization_id = ?", (oid,))}
    assert places[("CA", "ON", "Ottawa", "K1A 0B1")] == 3 and places[("US", "", "Austin", "78701")] == 4


def test_the_business_number_needs_every_valid_one_to_agree(conn):
    good, other = "835752437", "837253251"
    assert business_number(good) == good and business_number(other) == other and business_number("123456789") is None
    agreed = grant(conn, "d", "B1", 0, "Agreeable Foods Ltd.", 1, bn=good)
    grant(conn, "d", "B2", 0, "Agreeable Foods Ltd.", 1, bn=good + "RC0001")
    grant(conn, "d", "B3", 0, "Agreeable Foods Ltd.", 1, bn="123456789")     # fails the check digit: ignored
    split = grant(conn, "d", "B4", 0, "Divided Foods Ltd.", 1, bn=good)
    grant(conn, "d", "B5", 0, "Divided Foods Ltd.", 1, bn=other)
    organizations.recompute(conn, now=T1)
    numbers = dict(conn.execute("SELECT id, business_number FROM organizations"))
    assert numbers[agreed] == good and numbers[split] is None


def test_a_row_is_written_only_when_a_value_changed(conn, northwind):
    first = organizations.recompute(conn, now=T1)
    assert first["updated"] == first["organizations"]
    second = organizations.recompute(conn, now=T2)
    assert second["updated"] == 0
    assert {r[0] for r in conn.execute("SELECT updated_at FROM organizations")} == {T1}
    other = award(conn, "N1", 0, "Other Systems Inc.")
    award(conn, "A7", 0, NAME, total=10, amount=10)
    third = organizations.recompute(conn, now=T3)
    assert third["updated"] == 2
    stamps = dict(conn.execute("SELECT id, updated_at FROM organizations"))
    assert stamps[northwind] == T3 and stamps[other] == T3


def test_counts_are_rebuilt_from_the_records(conn):
    oid = award(conn, "R1", 0, "Rebuilt Metals Ltd.")
    # A loader that counted a version twice, or a source rewritten whole, leaves counts too high.
    organizations.upsert(conn, "Rebuilt Metals Ltd.", source="awards", province="ON", city="Ottawa",
                         postal_code="K1A 0B1")
    organizations.recompute(conn, now=T1)
    assert conn.execute("SELECT n FROM organization_names WHERE organization_id = ?", (oid,)).fetchone()[0] == 1
    assert conn.execute("SELECT n FROM organization_places WHERE organization_id = ?", (oid,)).fetchone()[0] == 1


def test_an_organization_no_record_points_to_is_removed(conn):
    ghost = organizations.upsert(conn, "Ghost Logistics Inc.", source="awards", province="ON")
    conn.execute("INSERT INTO registry_checks (organization_id, registry, checked_at) VALUES (?, 'x', ?)", (ghost, T1))
    kept = award(conn, "K1", 0, "Kept Logistics Inc.")
    result = organizations.recompute(conn, now=T1)
    assert result["removed"] == 1
    ids = {r[0] for r in conn.execute("SELECT id FROM organizations")}
    assert ids == {kept}
    for table in ("organization_names", "organization_places", "registry_checks"):
        assert conn.execute(f"SELECT 1 FROM {table} WHERE organization_id = ?", (ghost,)).fetchone() is None


def test_upsert_refuses_people_placeholders_and_blanks_and_splits_the_operating_name(conn):
    assert organizations.upsert(conn, "Ana Ferreira", source="awards") is None
    assert organizations.upsert(conn, "N/A", source="awards") is None
    assert organizations.upsert(conn, "  ", source="awards") is None
    assert organizations.upsert(conn, "Owen Mercer o/a Mercer Translation", source="awards") is None
    oid = organizations.upsert(conn, "Zed Holdings Ltd. o/a Zippy Courier Services", source="awards", country="Canada",
                               province="Quebec", city="GATINEAU", postal_code="j8x1a1", now=T1)
    assert oid == org_id(norm_name("Zed Holdings Ltd."))
    row = conn.execute("SELECT display_name, country, province, city, postal_code, updated_at FROM organizations").fetchone()
    assert tuple(row) == ("Zed Holdings Ltd. o/a Zippy Courier Services", "CA", "QC", "Gatineau", "J8X 1A1", T1)
    names = dict(conn.execute("SELECT raw_name, n FROM organization_names"))
    assert names == {"Zed Holdings Ltd. o/a Zippy Courier Services": 1, "Zippy Courier Services": 1}
    # An operating name that reads as a person is not kept.
    organizations.upsert(conn, "Zed Holdings Ltd. o/a Ana Ferreira", source="awards")
    assert "Ana Ferreira" not in {r[0] for r in conn.execute("SELECT raw_name FROM organization_names")}


def test_the_stage_logs_one_row(conn, northwind):
    organizations.run(conn, now=T1)
    rows = conn.execute("SELECT source, rows_in, rows_new, ok FROM sources_log").fetchall()
    assert [tuple(r) for r in rows] == [("organizations", 1, 1, 1)]
