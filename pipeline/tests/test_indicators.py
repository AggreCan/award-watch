"""The indicators stage: yearly figures per organization and per buyer, buyer counters and totals, code counts.

Every expected figure below is worked by hand from CLAUDE.md "Counting money";
the records are inserted directly so each rule has a row that exercises it
(an amendment, a cancelled notice, another currency, a record with no date,
a withheld supplier). The last test runs the whole pipeline on the samples
and checks the yearly figures against the organizations' all-time totals.
"""

import zipfile

import pytest

from awardwatch_pipeline import cli, indicators, organizations
from awardwatch_pipeline.normalize import norm_name, org_id

T1, T2 = "2026-10-31T00:00:00Z", "2026-11-01T00:00:00Z"
ALPHA, BETA = "Alpha Systems Inc.", "Beta Works Ltd."


def org(conn, name):
    return organizations.upsert(conn, name, source="awards", country="CA", province="ON")


def award(conn, ref, amd, oid, buyer, *, total=None, amount=None, currency="CAD", status="active", awarded=None,
          comp=None, table="awards", client=None):
    extra = ", client_id" if table == "contract_history" else ""
    conn.execute(
        f"INSERT INTO {table} (reference, amendment, organization_id, buyer_id, total_value, amount, currency, status, "
        f"awarded, competitive, source_file, first_seen, last_seen{extra}) "
        f"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'f', '2026-10-31', '2026-10-31'{', ?' if extra else ''})",
        (ref, amd, oid, buyer, total, amount, currency, status, awarded, comp, *([client] if extra else [])),
    )


def contract(conn, ref, oid, buyer, *, instrument, value=None, original=None, amendment=None, day=None, comp=None):
    conn.execute(
        "INSERT INTO contracts (owner_org, reference, organization_id, buyer_id, instrument_type, value, original_value, "
        "amendment_value, contract_date, competitive, vendor_withheld, loaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (buyer, ref, oid, buyer, instrument, value, original, amendment, day, comp, 0 if oid else 1, T1),
    )


def grant(conn, owner, ref, amd, oid, value, start):
    conn.execute(
        "INSERT INTO grants (owner_org, reference, amendment, organization_id, buyer_id, value, start, loaded_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (owner, ref, amd, oid, owner, value, start, T1),
    )


@pytest.fixture
def records(conn):
    for bid in ("dept-a", "dept-b", "dept-c", "pwgsc-tpsgc", "dnd-mdn"):
        conn.execute("INSERT INTO buyers (id, name_en, updated_at) VALUES (?, ?, ?)", (bid, bid, T1))
    a, b = org(conn, ALPHA), org(conn, BETA)

    # Award notices: one contract per reference, valued on its newest amendment.
    award(conn, "AW1", 0, a, "dnd-mdn", total=100, amount=100, awarded="2024-03-01", comp=1)
    award(conn, "AW1", 1, a, "dnd-mdn", total=150, amount=50, awarded="2024-03-01", comp=1)    # amendment: 150
    award(conn, "AW2", 0, a, "dnd-mdn", total=0, amount=40, currency="", awarded="2024-07-01", comp=0)  # 40
    award(conn, "AW3", 0, a, "dnd-mdn", total=500, amount=500, awarded="2024-05-01", comp=0)
    award(conn, "AW3", 1, a, "dnd-mdn", total=500, amount=0, status="cancelled", awarded="2024-05-01", comp=0)  # 0
    award(conn, "AW4", 0, a, "dnd-mdn", total=1000, amount=1000, currency="USD", awarded="2024-09-01", comp=1)  # out
    award(conn, "AW5", 0, b, "pwgsc-tpsgc", total=300, amount=300, awarded="2025-01-15")       # unstated: 300
    award(conn, "AW6", 0, a, "dnd-mdn", total=70, amount=70)                                  # no award date: 70

    # Contract history: the buyer is the client department, PSPC when none is named.
    hist = {"table": "contract_history"}
    award(conn, "H1", 0, b, "pwgsc-tpsgc", total=1000, amount=1000, awarded="2023-06-01", comp=1, client="dnd-mdn", **hist)
    award(conn, "H1", 2, b, "pwgsc-tpsgc", total=1200, amount=200, awarded="2023-06-01", comp=1, client="dnd-mdn",
          **hist)                                                                                   # 1200
    award(conn, "H2", 0, b, "pwgsc-tpsgc", total=0, amount=300, currency=None, awarded="2023-08-01", comp=0, **hist)
    award(conn, "H3", 0, b, "pwgsc-tpsgc", total=50, amount=50, currency="EUR", awarded="2023-09-01", comp=0,
          client="dnd-mdn", **hist)                                                                 # left out

    # Published contracts: each row's own value.
    contract(conn, "C1", a, "dept-a", instrument="C", value=1000, original=1000, amendment=0, day="2025-06-01", comp=1)
    contract(conn, "C2", a, "dept-a", instrument="A", value=1250, original=1000, amendment=250, day="2025-08-01",
             comp=1)                                                                                # 250
    contract(conn, "C3", a, "dept-a", instrument="C", value=500, day="2025-09-01", comp=0)        # 500
    contract(conn, "C4", a, "dept-a", instrument="A", value=900, original=1000, amendment=-100, day="2026-01-10",
             comp=0)                                                                                # -100
    contract(conn, "C5", b, "dept-b", instrument="SOSA", value=500, original=400, amendment=100, day="2025-02-01")  # 100
    contract(conn, "C6", None, "dept-a", instrument="C", value=2000, original=2000, day="2025-03-01", comp=0)  # withheld

    # Grants: one agreement per department and reference, on the highest amendment.
    grant(conn, "dept-a", "G1", 0, a, 10000, "2024-04-01")
    grant(conn, "dept-a", "G1", 1, a, 12000, "2024-04-01")                                        # 12000
    grant(conn, "dept-b", "G1", 0, a, 5000, "2024-06-01")                                         # another department
    grant(conn, "dept-a", "G2", 0, b, 2500, "2019-04-01")
    grant(conn, "dept-a", "G3", 0, None, 800, "2024-05-01")                                       # withheld recipient

    # Tender notices count once per reference, under the newest version's buyer.
    for ref, amd, buyer in (("T1", 0, "dnd-mdn"), ("T1", 1, "dnd-mdn"), ("T2", 0, "pwgsc-tpsgc"), ("T3", 0, "dnd-mdn")):
        conn.execute("INSERT INTO tenders (reference, amendment, buyer_id, source_file, first_seen, last_seen) "
                     "VALUES (?, ?, ?, 'f', '2026-10-31', '2026-10-31')", (ref, amd, buyer))
    conn.commit()
    return a, b


def years(conn, table, key):
    return {(r[0], r[1], r[2]): tuple(r)[3:] for r in conn.execute(
        f"SELECT {key}, year, source, n, total, n_non_competitive, total_non_competitive"
        f"{', n_organizations' if table == 'buyer_years' else ''} FROM {table}")}


def test_organization_years_follow_each_source_rule(conn, records):
    a, b = records
    result = indicators.compute(conn, now=T1)
    assert years(conn, "organization_years", "organization_id") == {
        # awards 2024: AW1 150 + AW2 40 + AW3 cancelled 0 + AW4 USD left out = 190, 4 contracts;
        # non-competitive AW2 and AW3: 2, 40 + 0.
        (a, 2024, "awards"): (4, 190.0, 2, 40.0),
        (b, 2025, "awards"): (1, 300.0, 0, None),
        # history 2023: H1 1200 + H2 300 (no currency is CAD) + H3 EUR left out; non-competitive H2, H3.
        (b, 2023, "history"): (3, 1500.0, 2, 300.0),
        # contracts 2025: C1 1000 + C2 250 + C3 500; 2026: C4 -100.
        (a, 2025, "contracts"): (3, 1750.0, 1, 500.0),
        (a, 2026, "contracts"): (1, -100.0, 1, -100.0),
        (b, 2025, "contracts"): (1, 100.0, 0, None),
        # grants 2024: G1 at dept-a 12000 + G1 at dept-b 5000; grants have no non-competitive figures.
        (a, 2024, "grants"): (2, 17000.0, None, None),
        (b, 2019, "grants"): (1, 2500.0, None, None),
    }
    # AW6 has no award date: in no yearly row, and said so.
    assert result["no_year_awards"] == 1 and result["no_year_contracts"] == 0


def test_buyer_years_and_buyer_totals(conn, records):
    indicators.compute(conn, now=T1)
    assert years(conn, "buyer_years", "buyer_id") == {
        ("dnd-mdn", 2024, "awards"): (4, 190.0, 2, 40.0, 1),
        ("pwgsc-tpsgc", 2025, "awards"): (1, 300.0, 0, None, 1),
        # H1 and H3 were for DND (H3 in euros: counted, not added); H2 named no client, so PSPC.
        ("dnd-mdn", 2023, "history"): (2, 1200.0, 1, None, 1),
        ("pwgsc-tpsgc", 2023, "history"): (1, 300.0, 1, 300.0, 1),
        # The withheld vendor's C6 counts for the department and adds no organization.
        ("dept-a", 2025, "contracts"): (4, 3750.0, 2, 2500.0, 1),
        ("dept-a", 2026, "contracts"): (1, -100.0, 1, -100.0, 1),
        ("dept-b", 2025, "contracts"): (1, 100.0, 0, None, 1),
        ("dept-a", 2024, "grants"): (2, 12800.0, None, None, 1),
        ("dept-a", 2019, "grants"): (1, 2500.0, None, None, 1),
        ("dept-b", 2024, "grants"): (1, 5000.0, None, None, 1),
    }
    got = {r["id"]: tuple(r)[1:] for r in conn.execute(
        "SELECT id, n_tenders, n_awards, n_history, n_contracts, n_grants, total_awards, total_contracts, total_grants "
        "FROM buyers")}
    assert got == {
        # DND: tenders T1 and T3; awards AW1-AW4 and AW6 (190 + 70); history H1 and H3.
        "dnd-mdn": (2, 5, 2, 0, 0, 260.0, None, None),
        "pwgsc-tpsgc": (1, 1, 1, 0, 0, 300.0, None, None),
        "dept-a": (0, 0, 0, 5, 3, None, 3650.0, 15300.0),
        "dept-b": (0, 0, 0, 1, 1, None, 100.0, 5000.0),
        "dept-c": (0, 0, 0, 0, 0, None, None, None),
    }


def test_a_rebuild_with_nothing_changed_writes_no_buyer_and_the_same_rows(conn, records):
    first = indicators.compute(conn, now=T1)
    snapshot = years(conn, "organization_years", "organization_id"), years(conn, "buyer_years", "buyer_id")
    assert first["buyers_updated"] == 4  # dept-c has nothing, so nothing changed for it
    second = indicators.compute(conn, now=T2)
    assert second["buyers_updated"] == 0
    assert (years(conn, "organization_years", "organization_id"), years(conn, "buyer_years", "buyer_id")) == snapshot
    assert {r[0] for r in conn.execute("SELECT updated_at FROM buyers")} == {T1}


def test_yearly_totals_add_up_to_the_all_time_totals_except_records_without_a_date(conn, records):
    a, b = records
    organizations.recompute(conn, now=T1)
    indicators.compute(conn, now=T1)
    for oid in (a, b):
        row = conn.execute("SELECT * FROM organizations WHERE id = ?", (oid,)).fetchone()
        for source in ("awards", "history", "contracts", "grants"):
            summed = conn.execute("SELECT SUM(n), SUM(total) FROM organization_years WHERE organization_id = ? "
                                  "AND source = ?", (oid, source)).fetchone()
            n, total = row[f"n_{source}"], row[f"total_{source}"]
            if oid == a and source == "awards":
                n, total = n - 1, total - 70  # AW6, which has no award date
            assert ((summed[0] or 0), summed[1]) == (n, total), (oid, source)


def test_code_counts_are_recounted(conn, records):
    conn.executemany("INSERT INTO unspsc_codes (code, level, n) VALUES (?, ?, 99)",
                     [("81", 1), ("8111", 2), ("811118", 3), ("81111801", 4), ("43", 1)])
    conn.executemany("INSERT INTO gsin_codes (code, n) VALUES (?, 99)", [("N7030",), ("R019BF",), ("X1",)])
    conn.executemany("INSERT INTO tender_codes (reference, amendment, unspsc) VALUES (?, ?, ?)",
                     [("T1", 0, "8111"), ("T1", 1, "811118")])
    conn.execute("INSERT INTO award_codes (reference, amendment, unspsc) VALUES ('AW1', 0, '81111801')")
    conn.execute("UPDATE tenders SET gsin = '[\"N7030\"]' WHERE reference = 'T1' AND amendment = 0")
    conn.execute("UPDATE awards SET gsin = '[\"N7030\", \"R019BF\"]' WHERE reference = 'AW1' AND amendment = 0")
    indicators.compute(conn, now=T1)
    # 81 and 8111: T1 v0, T1 v1 and AW1 v0; 811118: T1 v1 and AW1 v0; the commodity: AW1 v0.
    assert dict(conn.execute("SELECT code, n FROM unspsc_codes")) == \
        {"81": 3, "8111": 3, "811118": 2, "81111801": 1, "43": 0}
    assert dict(conn.execute("SELECT code, n FROM gsin_codes")) == {"N7030": 2, "R019BF": 1, "X1": 0}


def test_the_stage_logs_one_row(conn, records):
    indicators.run(conn, now=T1)
    row = conn.execute("SELECT source, ok, rows_in, rows_new, detail FROM sources_log").fetchone()
    # Records: 6 award contracts, 3 history contracts, 6 published contracts, 4 agreements.
    assert (row["source"], row["ok"], row["rows_in"]) == ("indicators", 1, 19)
    assert row["rows_new"] == 8 + 10
    assert row["detail"].endswith("without_year: awards 1")


def test_a_samples_run_loads_every_source_and_its_years_agree_with_the_profiles(conn, fixtures, tmp_path, monkeypatch):
    for fixture, sample in (("canadabuys_tenders_new.csv", "newTenderNotice.csv"),
                            ("canadabuys_awards.csv", "2026-2027-awardNotice.csv"),
                            ("canadabuys_history.csv", "2026-2027-contractHistory.csv"),
                            ("contracts_head.csv", "contracts-head.csv"), ("grants_head.csv", "grants-head.csv")):
        (tmp_path / sample).write_bytes((fixtures / fixture).read_bytes())
    with zipfile.ZipFile(tmp_path / "communications_ocl_cal.zip", "w") as zf:
        for path in sorted((fixtures / "lobbying").glob("*.csv")):
            zf.write(path, path.name)

    def no_network(*args, **kwargs):
        raise AssertionError("a samples run made a request")

    monkeypatch.setattr(cli, "PoliteClient", no_network)
    assert cli.run(conn, [], samples=tmp_path) == 0
    log = {r["source"]: r for r in conn.execute("SELECT * FROM sources_log")}
    assert [r[0] for r in conn.execute("SELECT source FROM sources_log ORDER BY id")] == cli.STAGES
    assert log["contracts"]["detail"].startswith("read rows=30 stored=30")
    assert log["grants"]["detail"].startswith("read rows=30 stored=29")
    assert log["lobbying"]["detail"].startswith("read ")
    assert log["indicators"]["ok"] == 1
    # The organizations stage ran after the loaders: a vendor seen only in the published contracts has its counts.
    csa = conn.execute("SELECT n_contracts FROM organizations WHERE id = ?", (org_id(norm_name("CSA Group")),)).fetchone()
    assert csa[0] == 4
    # Every organization's yearly totals add up to its all-time total, source by source.
    for source in ("awards", "history", "contracts", "grants"):
        off = conn.execute(
            f"SELECT o.id FROM organizations o LEFT JOIN (SELECT organization_id, SUM(n) n, SUM(total) t "
            f"FROM organization_years WHERE source = ? GROUP BY organization_id) y ON y.organization_id = o.id "
            f"WHERE COALESCE(y.n, 0) != o.n_{source} OR ABS(COALESCE(y.t, 0) - COALESCE(o.total_{source}, 0)) > 0.01",
            (source,),
        ).fetchall()
        assert off == [], source
    assert conn.execute("SELECT COUNT(*) FROM organization_years WHERE source = 'contracts'").fetchone()[0] > 0
    assert conn.execute("SELECT COUNT(*) FROM buyer_years WHERE source = 'grants'").fetchone()[0] > 0


def test_the_non_competitive_share_by_value_is_over_positive_values(conn, records):
    """A published contract's amendment can lower a value (C4: -100); a share of the net total ran below zero
    on a profile (-10 percent). organization_years keeps the positive values apart, and how many records were
    below zero, so the share is taken over positive values only."""
    a, b = records
    contract(conn, "C7", a, "dept-a", instrument="C", value=400, day="2026-02-01", comp=0)
    conn.commit()
    indicators.compute(conn, now=T1)
    rows = {(r[0], r[1], r[2]): tuple(r)[3:] for r in conn.execute(
        "SELECT organization_id, year, source, total, total_non_competitive, total_positive, "
        "total_non_competitive_positive, n_negative FROM organization_years")}
    # 2026: C4 -100 (non-competitive) and C7 400 (non-competitive): net 300, positive 400, one record below zero.
    assert rows[(a, 2026, "contracts")] == (300.0, 300.0, 400.0, 400.0, 1)
    # 2025: nothing below zero, so the positive figures are the totals.
    assert rows[(a, 2025, "contracts")] == (1750.0, 500.0, 1750.0, 500.0, 0)
    # Grants carry no competitive flag.
    assert rows[(a, 2024, "grants")][3] is None
