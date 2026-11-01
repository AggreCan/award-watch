"""The expiring-contracts radar: the window boundaries, the duplicate rule with each of its triggers,
value_growth, the matched tender, a withheld supplier, the night a row entered the 3-month window,
and the feed that lists each contract once."""

import xml.etree.ElementTree as ET
from datetime import date, timedelta

import pytest

from awardwatch_pipeline import expiring, feeds, organizations

TODAY = date(2026, 10, 31)
STAMP = "2026-10-31T01:00:00Z"
A = "{http://www.w3.org/2005/Atom}"


def day(n: int) -> str:
    return (TODAY + timedelta(days=n)).isoformat()


@pytest.fixture
def db(conn):
    for bid in ("pwgsc-tpsgc", "dnd-mdn", "other-buyer"):
        conn.execute("INSERT INTO buyers (id, name_en, name_fr, updated_at) VALUES (?, ?, ?, ?)",
                     (bid, f"{bid} en", f"{bid} fr", STAMP))
    return conn


def award(conn, ref, *, end, value=100_000.0, amendment=0, amount=None, supplier="Acme Ltd", status="active",
          number=None, solicitation=None, buyer="pwgsc-tpsgc", withheld=False, currency="CAD"):
    org = None if withheld else organizations.upsert(conn, supplier, source="awards")
    conn.execute(
        'INSERT INTO awards (reference, amendment, contract_number, solicitation, title_en, title_fr, amount, '
        'total_value, currency, status, start, "end", supplier_raw, organization_id, supplier_withheld, buyer_id, '
        "source_file, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01', ?, ?, ?, ?, ?, 'f', ?, ?)",
        (ref, amendment, number, solicitation, f"Title {ref}", f"Titre {ref}", amount if amount is not None else value,
         value, currency, status, end, None if withheld else supplier, org, 1 if withheld else 0, buyer,
         TODAY.isoformat(), TODAY.isoformat()))
    return org


def history(conn, ref, *, end, value, supplier="Acme Ltd", client="dnd-mdn", number=None):
    org = organizations.upsert(conn, supplier, source="history")
    conn.execute(
        'INSERT INTO contract_history (reference, amendment, contract_number, amount, total_value, currency, status, '
        '"end", supplier_raw, organization_id, buyer_id, client_id, source_file, first_seen, last_seen) '
        "VALUES (?, 0, ?, ?, ?, 'CAD', 'active', ?, ?, ?, 'pwgsc-tpsgc', ?, 'f', ?, ?)",
        (ref, number, value, value, end, supplier, org, client, TODAY.isoformat(), TODAY.isoformat()))


def contract(conn, ref, *, end, value, vendor="Acme Ltd", buyer="pwgsc-tpsgc", procurement_id=None, kind="C",
             original=None, amendment=None, date_="2026-01-01"):
    conn.execute(
        "INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, buyer_id, contract_date, delivery_date, "
        "value, original_value, amendment_value, instrument_type, organization_id, loaded_at) "
        "VALUES ('dept', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (ref, procurement_id, vendor, buyer, date_, end, value, original, amendment, kind,
         organizations.upsert(conn, vendor, source="contracts"), STAMP))


def radar(conn, today=TODAY):
    counts = expiring.compute(conn, today=today, now=STAMP)
    return counts, {r["source_key"]: r for r in conn.execute("SELECT * FROM expiring_contracts")}


def test_the_windows_run_from_the_data_date_to_365_days(db):
    for ref, n in (("ENDS-TODAY", 0), ("D91", 91), ("D92", 92), ("D182", 182), ("D183", 183), ("D365", 365),
                   ("D366", 366), ("ENDED", -1)):
        award(db, ref, end=day(n), number=f"NUMBER-{ref}")
    award(db, "CANCELLED", end=day(10), status="cancelled")
    counts, rows = radar(db)
    assert sorted(rows) == ["award:D182", "award:D183", "award:D365", "award:D91", "award:D92", "award:ENDS-TODAY"]
    assert (counts["window_3m"], counts["window_6m"], counts["window_12m"]) == (2, 4, 6)
    assert rows["award:ENDS-TODAY"]["days_left"] == 0 and rows["award:D365"]["days_left"] == 365
    assert [n for n, _ in expiring.WINDOWS] == ["3m", "6m", "12m"] and [d for _, d in expiring.WINDOWS] == [91, 182, 365]


def test_a_later_source_with_a_kept_contract_number_is_dropped(db):
    award(db, "AW-1", end=day(40), number="W8486-24ABCD/001/XX")
    history(db, "H-1", end=day(200), value=5.0, supplier="Someone Else Inc", number="w8486-24abcd/001/xx")
    contract(db, "C-1", end=day(300), value=7.0, vendor="Third Party Ltd", procurement_id="W848624ABCD001XX")
    contract(db, "C-2", end=day(300), value=7.0, vendor="Third Party Ltd", procurement_id="1")
    counts, rows = radar(db)
    assert sorted(rows) == ["award:AW-1", "contract:dept:C-2"]
    assert counts["dropped_number"] == 2 and counts["dropped_match"] == 0
    assert rows["award:AW-1"]["contract_number"] == "W848624ABCD001XX"


def test_a_later_source_matching_organization_buyer_end_and_value_is_dropped(db):
    award(db, "AW-1", end=day(100), value=100_000.0)
    # History names the client department; PSPC is its buyer as well, and the award notice's.
    history(db, "H-SAME", end=day(103), value=100_999.0)
    history(db, "H-FOUR-DAYS", end=day(104), value=100_000.0)
    history(db, "H-TWO-PERCENT", end=day(100), value=102_000.0)
    history(db, "H-OTHER-ORG", end=day(100), value=100_000.0, supplier="Other Org Ltd")
    contract(db, "C-SAME", end=day(98), value=99_500.0)
    contract(db, "C-OTHER-BUYER", end=day(100), value=100_000.0, buyer="other-buyer")
    counts, rows = radar(db)
    assert counts["dropped_match"] == 2 and counts["dropped_number"] == 0
    assert "history:H-SAME" not in rows and "contract:dept:C-SAME" not in rows
    assert {"history:H-FOUR-DAYS", "history:H-TWO-PERCENT", "history:H-OTHER-ORG", "contract:dept:C-OTHER-BUYER"} <= set(rows)


def test_rows_of_one_source_are_never_dropped_against_each_other(db):
    award(db, "AW-1", end=day(50), number="SAME-NUMBER")
    award(db, "AW-2", end=day(50), number="SAME-NUMBER")
    history(db, "H-1", end=day(60), value=1.0, number="H-NUMBER")
    history(db, "H-2", end=day(60), value=1.0, number="H-NUMBER")
    _, rows = radar(db)
    assert sorted(rows) == ["award:AW-1", "award:AW-2", "history:H-1", "history:H-2"]


def test_value_growth_with_and_without_an_original_amount(db):
    award(db, "GREW", end=day(30), value=100.0)
    award(db, "GREW", amendment=1, end=day(30), value=150.0)
    db.execute("INSERT INTO awards (reference, amendment, amount, total_value, status, \"end\", buyer_id, source_file, "
               "first_seen, last_seen) VALUES ('NO-ORIGINAL', 0, NULL, NULL, 'active', ?, 'pwgsc-tpsgc', 'f', ?, ?)",
               (day(30), TODAY.isoformat(), TODAY.isoformat()))
    award(db, "NO-ORIGINAL", amendment=1, end=day(30), value=150.0)
    award(db, "UNAMENDED", end=day(30), value=80.0, amount=50.0)
    contract(db, "C-1", end=day(200), value=100.0, original=100.0, procurement_id="P-1", date_="2026-01-01",
             vendor="Contract Co")
    contract(db, "C-2", end=day(210), value=130.0, amendment=30.0, kind="A", procurement_id="P-1", date_="2026-03-01",
             vendor="Contract Co")
    _, rows = radar(db)
    assert (rows["award:GREW"]["value_growth"], rows["award:GREW"]["n_amendments"]) == (0.5, 1)
    assert rows["award:NO-ORIGINAL"]["value_growth"] is None and rows["award:NO-ORIGINAL"]["value"] == 150.0
    # Options in the total value are not growth: the original is valued the same way as the newest.
    assert rows["award:UNAMENDED"]["value_growth"] == 0.0 and rows["award:UNAMENDED"]["n_amendments"] == 0
    group = rows["contract:dept:C-2"]
    assert (group["value"], group["value_growth"], group["n_amendments"], group["end"]) == (130.0, 0.3, 1, day(210))
    assert group["instrument_en"] == "Contract" and group["currency"] == "CAD"


def test_the_tender_reference_is_the_matched_notice_never_the_solicitation(db):
    db.execute("INSERT INTO tenders (reference, amendment, solicitation, status, source_file, first_seen, last_seen) "
               "VALUES ('cb-9-1', 0, 'SOL-9', 'expired', 'f', ?, ?)", (TODAY.isoformat(), TODAY.isoformat()))
    award(db, "MATCHED", end=day(20), solicitation=" sol-9 ")
    award(db, "UNMATCHED", end=day(20), solicitation="NO-SUCH-TENDER", supplier="Other Ltd")
    _, rows = radar(db)
    assert rows["award:MATCHED"]["tender_reference"] == "cb-9-1"
    assert rows["award:UNMATCHED"]["tender_reference"] is None


def test_a_withheld_supplier_stays_withheld(db):
    award(db, "PERSON", end=day(20), withheld=True)
    _, rows = radar(db)
    row = rows["award:PERSON"]
    assert row["organization_id"] is None and row["organization"] is None and row["supplier_withheld"] == 1


def test_a_row_keeps_the_night_it_entered_the_three_month_window(db):
    award(db, "SOON", end=day(50))
    award(db, "LATER", end=day(120), supplier="Later Ltd")
    counts, rows = radar(db)
    assert rows["award:SOON"]["entered_3m"] == TODAY.isoformat() and rows["award:LATER"]["entered_3m"] is None
    assert counts["entered_3m"] == 1
    later = TODAY + timedelta(days=30)
    counts, rows = radar(db, later)
    assert rows["award:SOON"]["entered_3m"] == TODAY.isoformat()
    assert rows["award:LATER"]["entered_3m"] == later.isoformat() and counts["entered_3m"] == 1
    counts, again = radar(db, later)
    assert counts["entered_3m"] == 0 and {k: r["entered_3m"] for k, r in again.items()} == \
        {k: r["entered_3m"] for k, r in rows.items()}


def test_the_feed_lists_each_contract_once_on_the_night_it_entered(db, tmp_path):
    award(db, "SOON", end=day(50))
    award(db, "LATER", end=day(120), supplier="Later Ltd", buyer="dnd-mdn")
    expiring.compute(db, today=TODAY, now=STAMP)
    feeds.write_feeds(db, tmp_path / "a", today=TODAY, base_url="https://awardwatch.example")
    later = TODAY + timedelta(days=30)
    expiring.compute(db, today=later, now=STAMP)
    feeds.write_feeds(db, tmp_path / "b", today=later, base_url="https://awardwatch.example")
    feeds.write_feeds(db, tmp_path / "c", today=later, base_url="https://awardwatch.example")

    def ids(folder, rel="feeds/canada/expiring.xml"):
        root = ET.parse(folder / rel).getroot()
        return [(e.findtext(f"{A}id"), e.findtext(f"{A}updated")) for e in root.findall(f"{A}entry")]

    first, second = ids(tmp_path / "a"), ids(tmp_path / "b")
    assert first == [("tag:awardwatch.ca,2026:expiring/award/soon/2026-10-31", "2026-10-31T00:00:00Z")]
    # The earlier entry keeps its id and date; the new one comes first.
    assert second == [("tag:awardwatch.ca,2026:expiring/award/later/2026-11-30", "2026-11-30T00:00:00Z"), first[0]]
    assert (tmp_path / "b" / "feeds" / "canada" / "expiring.xml").read_bytes() == \
        (tmp_path / "c" / "feeds" / "canada" / "expiring.xml").read_bytes()
    assert ids(tmp_path / "b", "feeds/buyer/dnd-mdn/expiring.xml")[0][0].endswith("/award/later/2026-11-30")
    text = (tmp_path / "b" / "feeds" / "canada" / "expiring.xml").read_text(encoding="utf-8")
    assert "Ends on 2027-02-28. Later Ltd. Buyer: dnd-mdn en. Value $100,000.00." in text
    assert "days" not in text.split("<entry>", 1)[1]


def test_the_stage_logs_one_row(db):
    award(db, "SOON", end=day(50))
    counts = expiring.run(db, today=TODAY, now=STAMP)
    log = db.execute("SELECT source, rows_in, rows_new, ok FROM sources_log").fetchall()
    assert [tuple(r) for r in log] == [("expiring", 1, 1, 1)] and counts["kept"] == 1
