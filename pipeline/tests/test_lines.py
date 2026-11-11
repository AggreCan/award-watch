"""The holder's record (lines.py): the line by source, buyer and kind of work, each source counted apart; the
kind of work by class, then family, then none; the client rule of each source; the fiscal window's edges; the
held count with the row itself; back to back at the 120-day gap and the 60-day overlap; call-ups against one
standing offer; the design's four worked examples to the figure, on rows shaped as the development copy holds
them (the names are made up); withheld suppliers; similar names, listed apart; amendments and a moved end;
cancelled notices and published amendment rows; the same j on a second night; the stage's own log row and a
failure that leaves last night's rows; the review file; and the constants the site's lines.ts repeats."""

from __future__ import annotations

import json
import re
from datetime import date, timedelta
from pathlib import Path

import pytest

from awardwatch_pipeline import cli, expiring, lines, organizations
from awardwatch_pipeline.records_db import org_number

REPO = Path(__file__).resolve().parents[2]
TODAY = date(2026, 11, 1)
STAMP = "2026-11-01T12:00:00Z"
TRIBUNALS, DEFENCE, PSPC, HEALTH = "atssc-scdata", "dnd-mdn", "pwgsc-tpsgc", "hc-sc"


@pytest.fixture
def db(conn):
    for bid, en in ((TRIBUNALS, "Administrative Tribunals Support Service of Canada"), (DEFENCE, "National Defence"),
                    (PSPC, "Public Services and Procurement Canada"), (HEALTH, "Health Canada")):
        conn.execute("INSERT INTO buyers (id, name_en, name_fr, updated_at) VALUES (?, ?, ?, ?)", (bid, en, f"{en} (fr)", STAMP))
    conn.execute("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES ('Health Canada', 'canadabuys', ?)", (HEALTH,))
    return conn


def org(conn, name: str, source: str = "contracts") -> str:
    return organizations.upsert(conn, name, source=source)


def notice(conn, ref, holder, *, start, end, codes=("40141600",), buyer=DEFENCE, table="awards", amendment=0, comp=1,
           method="Competitive - Traditional", status="active", awarded=None, withheld=False, client=None, end_users=None,
           value=100_000.0):
    """One version of an award notice (table awards) or a PSPC history record (table contract_history)."""
    source = "awards" if table == "awards" else "history"
    oid = None if withheld else org(conn, holder, source)
    extra_cols, extra_vals = "", ()
    if table == "contract_history":
        extra_cols, extra_vals = ", client_id", (client,)
    else:
        extra_cols, extra_vals = ", end_users_en", (json.dumps(end_users) if end_users else None,)
    conn.execute(
        f'INSERT INTO {table} (reference, amendment, title_en, awarded, published, start, "end", amount, total_value, currency, '
        f"status, competitive, method_en, supplier_raw, organization_id, supplier_withheld, buyer_id, source_file, first_seen, "
        f"last_seen{extra_cols}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CAD', ?, ?, ?, ?, ?, ?, ?, 'f', ?, ?, ?)",
        (ref, amendment, f"Title {ref}", awarded or start, awarded or start, start, end, value, value, status, comp, method,
         None if withheld else holder, oid, 1 if withheld else 0, buyer, STAMP, STAMP, *extra_vals))
    codes_table = "award_codes" if table == "awards" else "history_codes"
    conn.executemany(f"INSERT INTO {codes_table} (reference, amendment, unspsc) VALUES (?, ?, ?)", [(ref, amendment, c) for c in codes])
    return oid


def published(conn, ref, holder, *, start, end, code="D317", buyer=TRIBUNALS, proc="TN", bids=None, so=None, pid=None, date_=None,
              inst="C", withheld=False, value=50_000.0):
    """One row of a published contract; rows sharing a procurement_id are one contract."""
    comp = {"TN": 0, "AC": 0, "OB": 1, "TC": 1, "ST": 1}.get(proc)
    conn.execute(
        "INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, vendor_withheld, buyer_id, contract_date, period_start, "
        "delivery_date, value, original_value, commodity_code, solicitation_procedure, competitive, number_of_bids, standing_offer_number, "
        "instrument_type, organization_id, loaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (buyer, ref, pid or f"P-{ref}", None if withheld else holder, 1 if withheld else 0, buyer, date_ or start, start, end, value, value,
         code, proc, comp, bids, so, inst, None if withheld else org(conn, holder), STAMP))


def night(conn, tmp_path, today=TODAY):
    expiring.compute(conn, today=today, now=STAMP, review_dir=tmp_path / "review")
    counts = lines.compute(conn, today=today, now=STAMP, review_dir=tmp_path / "review")
    return counts, {k: json.loads(j) for k, j in conn.execute("SELECT source_key, j FROM expiring_lines")}


def entry(j: dict, src: int) -> dict:
    return next(e for e in j["s"] if e["src"] == src)


def yearly(conn, holder, years, *, code="D317", buyer=TRIBUNALS, so=None, prefix="Y"):
    """Contracts of one holder from April 1 to March 31 of each year given, back to back."""
    for y in years:
        published(conn, f"{prefix}-{holder[:3]}-{y}", holder, start=f"{y}-04-01", end=f"{y + 1}-03-31", code=code, buyer=buyer,
                  bids=1 if y >= 2022 else None, so=so(y) if callable(so) else so, date_=f"{y}-03-20")


def others(conn, n_contracts: int, n_suppliers: int, *, code, buyer=TRIBUNALS, start="2020-06-01", end="2021-05-31"):
    for i in range(n_contracts):
        published(conn, f"O-{code}-{i}", f"Other Supplier {code} {i % n_suppliers} Ltd", start=start, end=end, code=code, buyer=buyer,
                  proc="OB")


# -- the design's worked examples (section 3.4), on rows shaped as the development copy holds them ------------------

def test_example_a_a_run_of_published_contracts_and_the_standing_offer_rule(db, tmp_path):
    """Seven yearly contracts of one holder with one buyer in group D317, each starting the day after the last ends,
    the first in 2018; the line holds 37 contracts from 8 suppliers. As the copy publishes them, the last two are
    call-ups against one standing offer, so the rule of section 2.1 stops the run at 1 and the label is Earlier
    records, 6 earlier; without the standing offer numbers the same rows run 7 back to back, as section 3.4 counts
    them. The operator chooses between the two (the report says so)."""
    holder = "Example Legal Publishing Inc."
    # The 2018 contract runs three years, in three rows of one procurement_id (an original and two amendments).
    published(db, "C-2017-2018-Q4-00047", holder, start="2018-04-01", end="2019-03-31", pid="8036099", date_="2018-04-01")
    published(db, "C-2018-2019-Q4-00019", holder, start="2018-04-01", end="2020-03-31", pid="8036099", date_="2018-04-01", inst="A")
    published(db, "C-2019-2020-Q4-00011", holder, start="2018-04-01", end="2021-03-31", pid="8036099", date_="2018-04-01", inst="A")
    # One dated before the ten fiscal years (2015), which the line leaves out.
    published(db, "C-2015-2016-Q1-00039", holder, start="2015-04-01", end="2018-03-31", pid="4021150130", date_="2015-04-01", proc="TC")
    sos = {2021: None, 2022: "E60PI-18RFRN/006/PI", 2023: "E60PI-18RFRN/006/PI", 2024: "CW2242009-ACM_171964234",
           2025: "CW2242009-ACM-171964234", 2026: "CW2242009-ACM-171964234"}
    yearly(db, holder, range(2021, 2027), so=sos.get)
    # Another kind of work with the same buyer: not in the line.
    published(db, "C-2026-2027-Q2-00012", holder, start="2026-08-10", end="2027-03-31", code="7610")
    others(db, 30, 7, code="D317")
    db.commit()
    key = f"contract:{TRIBUNALS}:Y-Exa-2026"
    _, rows = night(db, tmp_path)
    j = rows[key]
    e = entry(j, 3)
    assert {k: e[k] for k in ("lvl", "key", "held", "first", "total", "others", "c", "nc", "u")} == {
        "lvl": "code", "key": ["D317"], "held": 7, "first": "2018-04-01", "total": 37, "others": 7, "c": 0, "nc": 7, "u": 0}
    assert j["own"] == {"comp": 0, "meth": "TN", "bids": 1, "amd": 0, "growth": 0.0, "end0": "2027-03-31", "end": "2027-03-31"}
    assert j["buyer"] == TRIBUNALS and j["fy"] == [2017, 2026] and j["sim"] == []
    # As published: the 2025-26 and 2026-27 contracts are call-ups against one standing offer.
    assert e["run"] == 1 and lines.label(j) == ("earlier", 6, 3)
    # Without the standing offer numbers: 7 back to back, a long run.
    db.execute("UPDATE contracts SET standing_offer_number = NULL")
    db.commit()
    j = night(db, tmp_path)[1][key]
    assert entry(j, 3)["run"] == 7 and lines.label(j) == ("run", 7, 3)


def test_example_b_concurrent_award_notices_are_earlier_records_never_back_to_back(db, tmp_path):
    """Eight earlier award notices of one holder with National Defence in class 401416, every one still running
    when the ninth starts: 8 earlier, run 1; 43 in the line, 17 other suppliers."""
    holder = "Example Valve Supply Inc."
    notice(db, "cb-188-1434012", holder, start="2026-09-08", end="2027-05-14", codes=("40141600", "40141608"))
    for i in range(8):
        notice(db, f"cb-188-{i}", holder, start=(date(2026, 4, 27) + timedelta(days=14 * i)).isoformat(),
               end=(date(2027, 5, 1) + timedelta(days=50 * i)).isoformat(), codes=("40141600",))
    for i in range(34):
        notice(db, f"cb-900-{i}", f"Valve Rival {i % 17} Inc.", start="2026-05-01", end="2027-06-30", codes=("40141600",))
    db.commit()
    _, rows = night(db, tmp_path)
    j = rows["award:cb-188-1434012"]
    e = entry(j, 1)
    assert (e["lvl"], e["key"], e["held"], e["run"], e["first"], e["total"], e["others"], e["c"]) == (
        "class", ["401416"], 9, 1, "2026-04-27", 43, 17, 9)
    assert j["own"]["meth"] == "TC" and j["own"]["bids"] is None
    assert lines.label(j) == ("earlier", 8, 1)


def test_example_c_a_split_profile_is_listed_under_its_own_name_and_never_added(db, tmp_path):
    """The holder's name is cut at 35 characters on its own profile; nine earlier contracts of the same kind with the
    same buyer sit under the full name. The holder's own figures: held 1, no earlier record; the full name is listed
    apart with its 9, the last starting 2024-04-01."""
    full = "THE EXAMPLE CORPS OF GUARD SERVICES OF CANADA"
    cut = full[:35]
    assert org(db, full) != org(db, cut)
    published(db, "C-2026-2027-Q1-00011", cut, start="2026-04-01", end="2027-03-31", code="K105", bids=1)
    for i, y in enumerate(range(2017, 2025)):
        published(db, f"K-{y}", full, start=f"{y}-04-01", end=f"{y + 1}-03-31", code="K105", proc="OB" if i == 0 else "TN")
    published(db, "K-2024-B", full, start="2024-04-01", end="2025-03-31", code="K105")
    db.commit()
    _, rows = night(db, tmp_path)
    j = rows[f"contract:{TRIBUNALS}:C-2026-2027-Q1-00011"]
    e = entry(j, 3)
    assert (e["held"], e["run"], e["total"], e["others"]) == (1, 1, 10, 1)
    assert j["sim"] == [[org(db, full), full, 3, 9, "2024-04-01"]]
    assert lines.label(j) == ("none", 0, None)


def test_example_d_no_earlier_record_with_the_contracts_own_method_and_bids(db, tmp_path):
    holder = "Example Audiovisual Inc."
    published(db, "C-2026-2027-Q2-00006", holder, start="2026-09-28", end="2026-12-31", code="T009", proc="ST", bids=4)
    others(db, 8, 6, code="T009")
    db.commit()
    j = night(db, tmp_path)[1][f"contract:{TRIBUNALS}:C-2026-2027-Q2-00006"]
    e = entry(j, 3)
    assert (e["held"], e["total"], e["others"], e["c"]) == (1, 9, 6, 1)
    assert (j["own"]["comp"], j["own"]["meth"], j["own"]["bids"]) == (1, "ST", 4)
    assert lines.label(j) == ("none", 0, None)


# -- the rules ---------------------------------------------------------------------------------------------

def test_each_source_is_counted_apart_and_the_label_takes_the_largest_of_one(db, tmp_path):
    """An award notice kept on the radar, its PSPC history twin dropped against it by contract number: each source
    counts its own line, and the label is the larger of the two, never their sum."""
    holder = "Twin Source Ltd"
    notice(db, "AW-T", holder, start="2026-04-01", end="2027-03-31", buyer=HEALTH)
    notice(db, "AW-T0", holder, start="2024-04-01", end="2025-01-31", buyer=HEALTH)
    notice(db, "H-T", holder, start="2026-04-01", end="2027-03-31", table="contract_history", buyer=PSPC, client=HEALTH)
    notice(db, "H-T0", holder, start="2023-04-01", end="2023-12-31", table="contract_history", buyer=PSPC, client=HEALTH)
    notice(db, "H-T1", holder, start="2022-04-01", end="2022-12-31", table="contract_history", buyer=PSPC, client=HEALTH)
    db.execute("UPDATE awards SET contract_number = 'W1234-567890' WHERE reference = 'AW-T'")
    db.execute("UPDATE contract_history SET contract_number = 'W1234-567890' WHERE reference = 'H-T'")
    db.commit()
    _, rows = night(db, tmp_path)
    assert "history:H-T" not in rows and tuple(db.execute("SELECT trigger FROM expiring_twins WHERE source_key = 'award:AW-T' "
                                                          "AND twin_key = 'history:H-T'").fetchone()) == ("number",)
    j = rows["award:AW-T"]
    assert [(e["src"], e["held"]) for e in j["s"]] == [(1, 2), (2, 3)]
    assert lines.label(j) == ("earlier", 2, 2)


def test_the_kind_of_work_is_the_class_then_the_family_then_none(db, tmp_path):
    assert lines.unspsc_keys("43211500 43210000 43000000 99999999 4321", {"43"}) == (frozenset({"432115"}), frozenset({"4321"}))
    assert lines.commodity_key(" r019bf ") == "R019" and lines.commodity_key("D3-1") is None and lines.commodity_key(None) is None
    notice(db, "AW-CLASS", "Class Holder Inc.", start="2026-04-01", end="2027-03-31", codes=("43211500",))
    notice(db, "AW-CLASS-0", "Class Holder Inc.", start="2025-04-01", end="2025-06-30", codes=("43211500", "43211600"))
    # A family-level code alone: the line is the family, and a record coded deeper in it shares the family.
    notice(db, "AW-FAMILY", "Family Holder Inc.", start="2026-04-01", end="2027-03-31", codes=("43210000",))
    notice(db, "AW-FAMILY-0", "Family Holder Inc.", start="2025-04-01", end="2025-06-30", codes=("43219900",))
    notice(db, "AW-SEGMENT", "Segment Holder Inc.", start="2026-04-01", end="2027-03-31", codes=("43000000",))
    db.commit()
    _, rows = night(db, tmp_path)
    assert [(e["lvl"], e["key"], e["held"]) for e in rows["award:AW-CLASS"]["s"]] == [("class", ["432115"], 2)]
    assert [(e["lvl"], e["key"], e["held"]) for e in rows["award:AW-FAMILY"]["s"]] == [("family", ["4321"], 2)]
    # A segment alone gives no kind of work: the row has a record and no label.
    assert rows["award:AW-SEGMENT"]["s"] == [] and lines.label(rows["award:AW-SEGMENT"]) == (None, None, None)


def test_each_source_names_the_buyer_by_its_own_rule(db, tmp_path):
    holder = "Client Rule Inc."
    # An award notice contracted by PSPC for Health Canada (its first end user, a spelling buyer_names knows).
    notice(db, "AW-C", holder, start="2026-04-01", end="2027-03-31", buyer=PSPC, end_users=["Health Canada", "Elsewhere"])
    notice(db, "AW-C0", holder, start="2025-04-01", end="2025-08-31", buyer=HEALTH)
    # PSPC's own award to the holder, with no end user: another line.
    notice(db, "AW-P0", holder, start="2025-04-01", end="2025-08-31", buyer=PSPC)
    # A history record names its client in client_id, and PSPC when it names none.
    # (Its end apart from the award notice's, so the radar's duplicate rule keeps both.)
    notice(db, "H-C", holder, table="contract_history", start="2026-04-01", end="2027-02-26", buyer=PSPC, client=HEALTH)
    notice(db, "H-C0", holder, table="contract_history", start="2024-04-01", end="2024-09-30", buyer=PSPC, client=HEALTH)
    notice(db, "H-P0", holder, table="contract_history", start="2024-04-01", end="2024-09-30", buyer=PSPC)
    db.commit()
    _, rows = night(db, tmp_path)
    assert rows["award:AW-C"]["buyer"] == HEALTH and entry(rows["award:AW-C"], 1)["held"] == 2
    assert rows["history:H-C"]["buyer"] == HEALTH and entry(rows["history:H-C"], 2)["held"] == 2


def test_the_window_is_the_ten_fiscal_years_ending_with_the_data_dates(db, tmp_path):
    assert lines.window(TODAY) == (2017, 2026, "2017-04-01", "2027-03-31")
    assert lines.window(date(2027, 4, 1))[:2] == (2018, 2027)
    holder = "Window Edge Ltd"
    published(db, "W-R", holder, start="2026-04-01", end="2027-03-31", code="R019")
    published(db, "W-IN", holder, start="2017-04-01", end="2017-12-31", code="R019", date_="2017-04-01")
    published(db, "W-OUT", holder, start="2017-03-31", end="2017-12-31", code="R019", date_="2017-03-31")
    db.commit()
    e = entry(night(db, tmp_path)[1][f"contract:{TRIBUNALS}:W-R"], 3)
    assert (e["held"], e["first"], e["total"]) == (2, "2017-04-01", 2)


def test_held_counts_the_row_itself_and_never_a_later_contract(db, tmp_path):
    holder = "Held Count Ltd"
    published(db, "H-R", holder, start="2026-04-01", end="2027-03-31", code="R019")
    # Starts after the row: in the line's total, not held.
    published(db, "H-LATER", holder, start="2026-06-01", end="2027-05-31", code="R019")
    db.commit()
    e = entry(night(db, tmp_path)[1][f"contract:{TRIBUNALS}:H-R"], 3)
    assert (e["held"], e["run"], e["total"], e["others"]) == (1, 1, 2, 0)


@pytest.mark.parametrize(("gap", "run"), [(120, 2), (121, 1), (-60, 2), (-61, 1)])
def test_back_to_back_is_a_start_within_120_days_after_an_end_or_60_days_before_it(db, tmp_path, gap, run):
    holder = "Gap Measure Ltd"
    start = date(2026, 4, 1)
    published(db, "G-R", holder, start=start.isoformat(), end="2027-03-31", code="R019")
    published(db, "G-0", holder, start="2025-01-01", end=(start - timedelta(days=gap)).isoformat(), code="R019")
    db.commit()
    e = entry(night(db, tmp_path)[1][f"contract:{TRIBUNALS}:G-R"], 3)
    assert (e["held"], e["run"]) == (2, run)


def test_two_call_ups_against_one_standing_offer_never_run(db, tmp_path):
    holder = "Call Up Ltd"
    yearly(db, holder, range(2023, 2027), code="R019", so=lambda y: "EN578-123456/001" if y >= 2025 else None, prefix="SO")
    db.commit()
    # 2026 and 2025 share the standing offer: the run stops at once, though 2024 and 2023 run back to back.
    e = entry(night(db, tmp_path)[1][f"contract:{TRIBUNALS}:SO-Cal-2026"], 3)
    assert (e["held"], e["run"]) == (4, 1)
    db.execute("UPDATE contracts SET standing_offer_number = 'EN578-999999/001' WHERE reference = 'SO-Cal-2025'")
    db.commit()
    assert entry(night(db, tmp_path)[1][f"contract:{TRIBUNALS}:SO-Cal-2026"], 3)["run"] == 4


def test_a_withheld_supplier_gets_no_record_and_counts_only_in_a_total(db, tmp_path):
    notice(db, "AW-W", "Jane Q Sample", start="2026-04-01", end="2027-03-31", withheld=True)
    notice(db, "AW-N", "Named Holder Inc.", start="2026-04-01", end="2027-03-31")
    notice(db, "AW-W0", "Jane Q Sample", start="2025-04-01", end="2025-06-30", withheld=True)
    db.commit()
    counts, rows = night(db, tmp_path)
    assert "award:AW-W" not in rows and counts["withheld"] == 1
    e = entry(rows["award:AW-N"], 1)
    # The two withheld records are in the line's total, neither is another named supplier.
    assert (e["held"], e["total"], e["others"]) == (1, 3, 0)
    assert "Jane" not in json.dumps(rows)


def test_similar_names_by_prefix_match_key_and_family_are_listed_apart(db, tmp_path):
    holder = "Northern Lights Engineering Consultants Inc."
    published(db, "S-R", holder, start="2026-04-01", end="2027-03-31", code="C211")
    # The same first 20 characters of the normalized name, another match key.
    published(db, "S-P", "Northern Lights Engineering Group", start="2024-04-01", end="2025-03-31", code="C211")
    # The same match key (the spaces left out), another first 20 characters.
    published(db, "S-K", "NorthernLights Engineering Consultants Inc.", start="2023-04-01", end="2024-03-31", code="C211")
    # A corporate family in common, nothing else.
    sister = "Aurora Field Services Ltd"
    published(db, "S-F", sister, start="2022-04-01", end="2023-03-31", code="C211")
    # Unrelated, and one similar name with nothing before the row: neither listed.
    published(db, "S-X", "Different Firm Ltd", start="2022-04-01", end="2023-03-31", code="C211")
    published(db, "S-L", "Northern Lights Engineering Partners", start="2026-06-01", end="2027-05-31", code="C211")
    for name in (holder, sister):
        db.execute("INSERT INTO organization_families (family, organization_id, note, source) VALUES ('Northern Lights', ?, "
                   "'subsidiary', 'name')", (org(db, name),))
    db.commit()
    j = night(db, tmp_path)[1][f"contract:{TRIBUNALS}:S-R"]
    assert {name: (src, n, last) for _, name, src, n, last in j["sim"]} == {
        "Northern Lights Engineering Group": (3, 1, "2024-04-01"),
        "NorthernLights Engineering Consultants Inc.": (3, 1, "2023-04-01"),
        sister: (3, 1, "2022-04-01"),
    }
    assert [s[0] for s in j["sim"]] == sorted(s[0] for s in j["sim"])
    # Listed apart: the holder's own figures are its own, and the label too.
    e = entry(j, 3)
    assert (e["held"], e["total"], e["others"]) == (1, 6, 5) and lines.label(j) == ("none", 0, None)


def test_amendments_and_a_moved_end_are_the_rows_own(db, tmp_path):
    holder = "Amended Ltd"
    notice(db, "AW-A", holder, start="2025-04-01", end="2026-03-31", value=100_000.0)
    notice(db, "AW-A", holder, start="2025-04-01", end="2027-03-31", value=150_000.0, amendment=1)
    db.commit()
    own = night(db, tmp_path)[1]["award:AW-A"]["own"]
    assert (own["amd"], own["growth"], own["end0"], own["end"]) == (1, 0.5, "2026-03-31", "2027-03-31")


def test_cancelled_notices_and_published_amendment_rows_are_left_out(db, tmp_path):
    holder = "Left Out Ltd"
    notice(db, "AW-L", holder, start="2026-04-01", end="2027-03-31")
    notice(db, "AW-L0", holder, start="2025-04-01", end="2025-06-30", status="cancelled")
    published(db, "P-L", holder, start="2026-04-01", end="2027-03-31", code="R019", pid="PID-L")
    published(db, "P-L0", holder, start="2024-04-01", end="2025-03-31", code="R019", pid="PID-0")
    published(db, "P-L0-A1", holder, start="2024-04-01", end="2025-06-30", code="R019", pid="PID-0", inst="A", date_="2025-01-15")
    db.commit()
    _, rows = night(db, tmp_path)
    assert entry(rows["award:AW-L"], 1)["held"] == 1
    e = entry(rows[f"contract:{TRIBUNALS}:P-L"], 3)
    assert (e["held"], e["total"]) == (2, 2)


def test_a_second_night_writes_the_same_j(db, tmp_path):
    test_example_c_a_split_profile_is_listed_under_its_own_name_and_never_added(db, tmp_path)
    first = dict(db.execute("SELECT source_key, j FROM expiring_lines"))
    second = dict(night(db, tmp_path)[1])
    assert {k: json.loads(v) for k, v in first.items()} == second
    again = dict(db.execute("SELECT source_key, j FROM expiring_lines"))
    assert again == first and all("days_left" not in v for v in again.values())


def test_the_stage_logs_its_own_row_and_a_failure_leaves_last_nights_rows(db, tmp_path, monkeypatch):
    test_example_d_no_earlier_record_with_the_contracts_own_method_and_bids(db, tmp_path)
    before = db.execute("SELECT source_key, j, computed_at FROM expiring_lines ORDER BY source_key").fetchall()
    assert before
    counts = lines.run(db, today=TODAY, now=STAMP, review_dir=tmp_path / "review")
    row = db.execute("SELECT source, ok, detail, notice FROM sources_log WHERE source = 'lines'").fetchone()
    assert (row["source"], row["ok"], row["notice"]) == ("lines", 1, None)
    assert f"rows={counts['rows']}" in row["detail"] and "none=" in row["detail"]
    # Every radar row twice: the insert fails half way, and the night keeps last night's table whole.
    monkeypatch.setattr(lines, "RADAR_SQL", lines.RADAR_SQL.replace(" ORDER BY source_key", "")
                        + " UNION ALL " + lines.RADAR_SQL.replace(" ORDER BY source_key", ""))
    assert cli._stage(db, "lines", lambda: lines.run(db, today=TODAY, now="2026-11-02T12:00:00Z", review_dir=tmp_path / "review")) is False
    assert db.execute("SELECT source_key, j, computed_at FROM expiring_lines ORDER BY source_key").fetchall() == before
    failed = db.execute("SELECT ok FROM sources_log WHERE source = 'lines' ORDER BY id DESC").fetchone()
    assert failed["ok"] == 0
    # The stage runs after the radar and before the export.
    assert cli.STAGES.index("expiring") + 1 == cli.STAGES.index("lines") < cli.STAGES.index("export")


def test_the_review_file_counts_the_labels_samples_them_and_lists_every_similar_name(db, tmp_path):
    test_example_c_a_split_profile_is_listed_under_its_own_name_and_never_added(db, tmp_path)
    text = (tmp_path / "review" / lines.REVIEW_FILE).read_bytes()
    assert b"\r" not in text
    body = text.decode("utf-8")
    assert "## Labels by the row's own source and window" in body and "## Similar names: 1 pairs, every one" in body
    assert re.search(r"^contract\t12m\t0\t0\t1\t0$", body, re.M), body
    assert "THE EXAMPLE CORPS OF GUARD SERVICES" in body
    for word in ("account", "email", "@"):
        assert word not in body.replace("no account or reader", ""), word


def test_the_constants_are_the_sites():
    ts = (REPO / "site" / "src" / "lines.ts").read_text(encoding="utf-8")
    for name in ("LINE_YEARS", "RUN_GAP_DAYS", "RUN_OVERLAP_DAYS", "LONG_RUN", "CODE_CHARS", "SIMILAR_PREFIX"):
        found = re.search(rf"export const {name} = (\d+);", ts)
        assert found and int(found.group(1)) == getattr(lines, name), name
    assert lines.J_VERSION == int(re.search(r"export const J_VERSION = (\d+);", ts).group(1))


def test_the_label_rule():
    s = lambda src, held, run, lvl="code": {"src": src, "held": held, "run": run, "lvl": lvl}  # noqa: E731
    assert lines.label({"s": [s(1, 3, 2), s(3, 3, 3)]}) == ("run", 3, 3)
    assert lines.label({"s": [s(1, 3, 2), s(3, 2, 2)]}) == ("earlier", 2, 1)
    assert lines.label({"s": [s(1, 1, 1), s(2, 1, 1)]}) == ("none", 0, None)
    assert lines.label({"s": []}) == (None, None, None)
    assert org_number("org-00000000ff") == 255
