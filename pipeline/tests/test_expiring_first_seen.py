"""The day the site first saw a radar row's contract, and each window's list of the rows first seen lately.

A saved search of the radar mails the contracts that entered its window since
its last delivery: those whose end date came inside it, and those the site
first saw while they already ended inside it (a new award notice, a month's
contract history, a week's published contracts). The second kind is read from
expiring_contracts.first_seen (expiring.py), carried for published contracts
by contracts.first_seen (sources/contracts.py), and exported as each window's
list of new rows (export_static, expiring/<window>/new/<n>.json). The night
the field first appears and a night the records are loaded again from nothing
list nothing as new."""

import csv
import json
from datetime import date, timedelta

import pytest

from awardwatch_pipeline import expiring, organizations
from awardwatch_pipeline import export_static as es
from awardwatch_pipeline.db import get_meta
from awardwatch_pipeline.sources import contracts

csv.field_size_limit(2**31 - 1)

TODAY = date(2026, 11, 14)
LOAD = "2026-10-01"  # the night the record tables were first loaded


def day(n: int) -> str:
    return (TODAY + timedelta(days=n)).isoformat()


@pytest.fixture
def db(conn):
    for bid in ("pwgsc-tpsgc", "dnd-mdn"):
        conn.execute("INSERT INTO buyers (id, name_en, name_fr, updated_at) VALUES (?, ?, ?, ?)",
                     (bid, f"{bid} en", f"{bid} fr", "2026-10-01T00:00:00Z"))
    return conn


def award(conn, ref, *, end, seen, amendment=0, value=None, supplier=None, number=None):
    supplier = supplier or f"Supplier {ref} Ltd"
    value = value if value is not None else 100_000.0 + len(ref)
    org = organizations.upsert(conn, supplier, source="awards")
    conn.execute(
        'INSERT INTO awards (reference, amendment, contract_number, title_en, title_fr, amount, total_value, currency, '
        'status, start, "end", supplier_raw, organization_id, buyer_id, source_file, first_seen, last_seen) '
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'CAD', 'active', '2026-01-01', ?, ?, ?, 'pwgsc-tpsgc', 'f', ?, ?)",
        (ref, amendment, number, f"Title {ref}", f"Titre {ref}", value, value, end, supplier, org, seen, seen))


def history(conn, ref, *, end, seen, value=200_000.0):
    supplier = f"Supplier {ref} Ltd"
    org = organizations.upsert(conn, supplier, source="history")
    conn.execute(
        'INSERT INTO contract_history (reference, amendment, amount, total_value, currency, status, "end", supplier_raw, '
        "organization_id, buyer_id, client_id, source_file, first_seen, last_seen) "
        "VALUES (?, 0, ?, ?, 'CAD', 'active', ?, ?, ?, 'pwgsc-tpsgc', 'dnd-mdn', 'f', ?, ?)",
        (ref, value, value, end, supplier, org, seen, seen))


def contract(conn, ref, *, end, seen, value=None, procurement_id=None, date_="2026-01-01", vendor=None):
    vendor = vendor or f"Vendor {ref} Ltd"
    value = value if value is not None else 50_000.0 + len(ref)
    conn.execute(
        "INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, buyer_id, contract_date, delivery_date, "
        "value, original_value, instrument_type, organization_id, loaded_at, first_seen) "
        "VALUES ('dnd-mdn', ?, ?, ?, 'dnd-mdn', ?, ?, ?, ?, 'C', ?, '2026-10-01T00:00:00Z', ?)",
        (ref, procurement_id, vendor, date_, end, value, value, organizations.upsert(conn, vendor, source="contracts"),
         seen))


def build(conn, today=TODAY):
    expiring.compute(conn, today=today, now=f"{today.isoformat()}T13:00:00Z")
    return {r["source_key"]: r for r in conn.execute("SELECT * FROM expiring_contracts")}


def seen_of(rows):
    return {k: r["first_seen"] for k, r in rows.items()}


# -- where the day comes from ----------------------------------------------------------------


def test_a_notice_first_seen_since_the_radar_began_carries_its_day(db):
    award(db, "OLD", end=day(30), seen=LOAD)
    history(db, "H-OLD", end=day(60), seen=LOAD)
    build(db, TODAY - timedelta(days=1))
    # Tonight: a new award notice and a new history record, both ending inside the 3-month window, and an
    # amendment to a notice the site has held since the first load.
    award(db, "NEW", end=day(40), seen=TODAY.isoformat())
    history(db, "H-NEW", end=day(50), seen=TODAY.isoformat())
    award(db, "AMENDED", end=day(400), seen=LOAD)
    award(db, "AMENDED", amendment=1, end=day(45), seen=TODAY.isoformat())
    rows = build(db)
    assert seen_of(rows) == {"award:OLD": None, "history:H-OLD": None, "award:NEW": TODAY.isoformat(),
                             "history:H-NEW": TODAY.isoformat(), "award:AMENDED": None}


def test_a_published_contract_takes_its_group_s_first_day_and_none_while_a_row_is_unknown(db):
    contract(db, "C-OLD", end=day(20), seen=None)
    build(db, TODAY - timedelta(days=3))
    contract(db, "C-NEW", end=day(20), seen=TODAY.isoformat())
    # A row stored before the column (unknown) and an amendment new tonight: the contract is not new.
    contract(db, "C-P1-A", end=day(30), seen=None, procurement_id="P-1", date_="2026-01-01")
    contract(db, "C-P1-B", end=day(31), seen=TODAY.isoformat(), procurement_id="P-1", date_="2026-03-01")
    # Two rows both seen since the radar began: the group's first day.
    contract(db, "C-P2-A", end=day(60), seen=day(-2), procurement_id="P-2", date_="2026-01-01")
    contract(db, "C-P2-B", end=day(61), seen=TODAY.isoformat(), procurement_id="P-2", date_="2026-03-01")
    rows = build(db)
    assert seen_of(rows) == {"contract:dnd-mdn:C-OLD": None, "contract:dnd-mdn:C-NEW": TODAY.isoformat(),
                             "contract:dnd-mdn:C-P1-B": None, "contract:dnd-mdn:C-P2-B": day(-2)}


def test_the_records_the_duplicate_rule_dropped_count_too(db):
    award(db, "OLD", end=day(90), seen=LOAD)
    build(db, TODAY - timedelta(days=5))
    # A new award notice for a contract the department published long ago: the site knew the contract.
    award(db, "AW-KNOWN", end=day(40), seen=TODAY.isoformat(), number="W1111-0001")
    contract(db, "C-KNOWN", end=day(40), seen=None, procurement_id="W1111-0001")
    # A new award notice whose published contract the site first saw three days ago: that day.
    award(db, "AW-BOTH", end=day(70), seen=TODAY.isoformat(), number="W2222-0002")
    contract(db, "C-BOTH", end=day(70), seen=day(-3), procurement_id="W2222-0002")
    rows = build(db)
    assert set(rows) == {"award:OLD", "award:AW-KNOWN", "award:AW-BOTH"}
    assert seen_of(rows) == {"award:OLD": None, "award:AW-KNOWN": None, "award:AW-BOTH": day(-3)}


# -- the first night, and records loaded again --------------------------------------------------


def test_the_first_night_lists_nothing_as_new_and_the_next_night_does(db):
    award(db, "OLD", end=day(30), seen=LOAD)
    build(db, TODAY - timedelta(days=1))
    # The radar as it stood before this field: rows built, no day recorded for when it began.
    db.execute("DELETE FROM meta WHERE key = ?", (expiring.SEEN_FROM_KEY,))
    db.execute("UPDATE expiring_contracts SET first_seen = NULL")
    db.commit()
    award(db, "TONIGHT", end=day(40), seen=TODAY.isoformat())
    rows = build(db)
    assert seen_of(rows) == {"award:OLD": None, "award:TONIGHT": None}
    assert get_meta(db, expiring.SEEN_FROM_KEY) == TODAY.isoformat()
    award(db, "NEXT", end=day(41), seen=day(1))
    rows = build(db, TODAY + timedelta(days=1))
    assert seen_of(rows) == {"award:OLD": None, "award:TONIGHT": None, "award:NEXT": day(1)}
    assert get_meta(db, expiring.SEEN_FROM_KEY) == TODAY.isoformat()


def test_a_database_loaded_from_nothing_lists_nothing_as_new(db):
    # The first night of an empty database: every record first seen tonight, nothing of it news (a
    # published contract loaded into an empty table has no day at all).
    history(db, "H-1", end=day(60), seen=TODAY.isoformat())
    history(db, "H-1B", end=day(62), seen=TODAY.isoformat())
    contract(db, "C-1", end=day(90), seen=None)
    assert set(seen_of(build(db)).values()) == {None}
    # The award notices' first load failed that night and ran the next: their table's first night, not
    # news, while a history record first seen that night is.
    award(db, "A-1", end=day(35), seen=day(1))
    award(db, "A-2", end=day(36), seen=day(1))
    history(db, "H-2", end=day(61), seen=day(1))
    rows = build(db, TODAY + timedelta(days=1))
    assert seen_of(rows) == {"award:A-1": None, "award:A-2": None, "history:H-1": None, "history:H-1B": None,
                             "history:H-2": day(1), "contract:dnd-mdn:C-1": None}


def test_a_radar_rebuilt_from_an_empty_table_begins_again(db):
    award(db, "OLD", end=day(30), seen=LOAD)
    build(db, TODAY - timedelta(days=2))
    db.execute("DELETE FROM expiring_contracts")
    db.commit()
    award(db, "TONIGHT", end=day(40), seen=TODAY.isoformat())
    rows = build(db)
    assert rows["award:TONIGHT"]["first_seen"] is None
    assert get_meta(db, expiring.SEEN_FROM_KEY) == TODAY.isoformat()


def test_a_window_mostly_new_is_held_back_as_a_reload(db, monkeypatch):
    monkeypatch.setattr(expiring, "NEW_FLOOR", 2)
    award(db, "OLD", end=day(30), seen=LOAD)
    award(db, "OLD-12M", end=day(300), seen=LOAD)
    build(db, TODAY - timedelta(days=1))
    for n in range(3):
        award(db, f"NEW-{n}", end=day(40 + n), seen=TODAY.isoformat())
    counts = expiring.run(db, today=TODAY, now=f"{TODAY.isoformat()}T13:00:00Z")
    rows = {r["source_key"]: r for r in db.execute("SELECT * FROM expiring_contracts")}
    assert set(seen_of(rows).values()) == {None}
    assert counts["first_seen_held"] == 3 and counts["first_seen_today"] == 0
    assert get_meta(db, expiring.SEEN_FROM_KEY) == TODAY.isoformat()
    notice = db.execute("SELECT notice FROM sources_log WHERE source = 'expiring' ORDER BY rowid DESC").fetchone()[0]
    assert "3 of the 4 rows of the 3m window" in notice and "none is mailed as new" in notice
    # Below the floor, or half the window or less, the days stand.
    monkeypatch.setattr(expiring, "NEW_FLOOR", 500)
    award(db, "NEW-NEXT", end=day(50), seen=day(1))
    rows = build(db, TODAY + timedelta(days=1))
    assert rows["award:NEW-NEXT"]["first_seen"] == day(1)


# -- the published contracts' own first day ------------------------------------------------------


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


def first_seen_by_ref(conn):
    return {r["reference"]: r["first_seen"] for r in conn.execute("SELECT reference, first_seen FROM contracts")}


def test_a_published_contract_keeps_the_day_its_row_first_appeared_across_rewrites(conn, fixtures, tmp_path):
    header, rows = read_csv(fixtures / "contracts_head.csv")
    # Loaded into an empty table: the first load, nothing in it news.
    contracts.load_file(conn, fixtures / "contracts_head.csv", now="2026-10-31T13:00:00Z")
    assert set(first_seen_by_ref(conn).values()) == {None}
    first = dict(rows[0], reference_number="C-NEW-WEEK-2")
    week2 = write_csv(tmp_path / "week2.csv", header, rows[1:] + [first])
    contracts.load_file(conn, week2, now="2026-11-07T13:00:00Z")
    seen = first_seen_by_ref(conn)
    assert seen.pop("C-NEW-WEEK-2") == "2026-11-07" and set(seen.values()) == {None}
    assert rows[0]["reference_number"] not in seen
    second = dict(rows[1], reference_number="C-NEW-WEEK-3")
    week3 = write_csv(tmp_path / "week3.csv", header, rows[1:] + [first, second])
    contracts.load_file(conn, week3, now="2026-11-14T13:00:00Z")
    seen = first_seen_by_ref(conn)
    assert (seen.pop("C-NEW-WEEK-2"), seen.pop("C-NEW-WEEK-3")) == ("2026-11-07", "2026-11-14")
    assert set(seen.values()) == {None} and len(seen) == len(rows) - 1


def test_a_load_that_fails_keeps_the_days(conn, fixtures, tmp_path):
    header, rows = read_csv(fixtures / "contracts_head.csv")
    contracts.load_file(conn, fixtures / "contracts_head.csv", now="2026-10-31T13:00:00Z")
    extra = write_csv(tmp_path / "week2.csv", header, rows + [dict(rows[0], reference_number="C-NEW")])
    contracts.load_file(conn, extra, now="2026-11-07T13:00:00Z")
    before = first_seen_by_ref(conn)
    empty = write_csv(tmp_path / "empty.csv", header, [])
    with pytest.raises(contracts.LayoutError):
        contracts.load_file(conn, empty, now="2026-11-14T13:00:00Z")
    assert first_seen_by_ref(conn) == before and before["C-NEW"] == "2026-11-07"


# -- the window's list of new rows ---------------------------------------------------------------


def export_radar(conn, tmp_path, today=TODAY):
    out = tmp_path / "static"
    counts = es.write_expiring(es.Model(conn, today), out)
    return out, counts


def load(out, rel):
    return json.loads((out / rel).read_text(encoding="utf-8"))


def test_each_window_lists_its_rows_first_seen_in_the_last_seven_days(db, tmp_path):
    for ref, end in (("OLD-3M", 10), ("OLD-6M", 120), ("OLD-12M", 250)):
        award(db, ref, end=day(end), seen=LOAD)
    build(db, TODAY - timedelta(days=10))
    award(db, "N-3M", end=day(40), seen=TODAY.isoformat())
    award(db, "N-6M", end=day(150), seen=day(-3))
    award(db, "N-12M", end=day(300), seen=TODAY.isoformat())
    # First seen eight days before the data date: outside every delivery's reach.
    award(db, "N-OLDER", end=day(20), seen=day(-7))
    rows = build(db)
    assert rows["award:N-OLDER"]["first_seen"] == day(-7)
    out, counts = export_radar(db, tmp_path)
    refs = {w: [(r["reference"], r["seen"]) for n in range(1, load(out, f"expiring/{w}/index.json")["new_pages"] + 1)
                for r in load(out, f"expiring/{w}/new/{n}.json")] for w in ("3m", "6m", "12m")}
    assert refs == {
        "3m": [("N-3M", TODAY.isoformat())],
        "6m": [("N-3M", TODAY.isoformat()), ("N-6M", day(-3))],
        "12m": [("N-3M", TODAY.isoformat()), ("N-12M", TODAY.isoformat()), ("N-6M", day(-3))],
    }
    for w, n in (("3m", 1), ("6m", 2), ("12m", 3)):
        index = load(out, f"expiring/{w}/index.json")
        assert (index["new_pages"], index["new_rows"]) == (1, n) and counts[f"expiring_{w}_new"] == n
        # The window's own pages are as before: no row carries the day.
        assert all("seen" not in r for p in range(1, index["pages"] + 1) for r in load(out, f"expiring/{w}/{p}.json"))
    # A new row is the window's row with the day beside it.
    page = load(out, "expiring/12m/1.json")
    listed = next(r for r in page if r["reference"] == "N-12M")
    assert load(out, "expiring/12m/new/1.json")[1] == {**listed, "seen": TODAY.isoformat()}


def test_the_list_is_paged_and_a_window_with_none_writes_no_page(db, tmp_path, monkeypatch):
    monkeypatch.setattr(es, "EXPIRING_PAGE", 2)
    award(db, "OLD", end=day(300), seen=LOAD)
    build(db, TODAY - timedelta(days=10))
    for n, seen in enumerate((TODAY.isoformat(), day(-1), day(-2))):
        award(db, f"N-{n}", end=day(200 + n), seen=seen)
    build(db)
    out, _ = export_radar(db, tmp_path)
    index = load(out, "expiring/12m/index.json")
    assert (index["new_pages"], index["new_rows"]) == (2, 3)
    assert [r["reference"] for r in load(out, "expiring/12m/new/1.json")] == ["N-0", "N-1"]
    assert [r["reference"] for r in load(out, "expiring/12m/new/2.json")] == ["N-2"]
    for w in ("3m", "6m"):
        assert load(out, f"expiring/{w}/index.json")["new_pages"] == 0
        assert not (out / "expiring" / w / "new").exists()
