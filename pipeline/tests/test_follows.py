"""May follow (follows.py, run by the lines stage): each match path (the same solicitation, a number the notice
names, a text match), the numbers left out (the notice's own, the frameworks', a number two organizations carry),
the words rule on the design's pairs (the CCGS Tully and anomaly-detection pairs rejected, the THS example kept with
7 of 8 words), the timing window's edges, the order and the cap, a record awarded after the notice, standing offers,
twins, the client department, the candidate's own holder's record by the same code (its similar names held by
SIMILAR_GROUP_MAX and SIM_MAX), a withheld holder, a long or cut description, a fault that leaves the holders'
records written, the same j on a second night, the review file's section, and the stop list the site's repeats.
The names are made up."""

from __future__ import annotations

import json
import re
from datetime import date, timedelta
from pathlib import Path

import pytest

from awardwatch_pipeline import cli, expiring, follows, lines
from awardwatch_pipeline.records_db import org_number
from test_lines import DEFENCE, HEALTH, PLACES, PSPC, STAMP, TODAY, TRIBUNALS, notice, org, published

REPO = Path(__file__).resolve().parents[2]
START = date(2026, 11, 23)
THS = "NPP S6057491 - THS SA - Three (3) Computer Application Support. Temporary Help Services against the Supply " \
      "Arrangement for the National Capital Region (NCR)."


@pytest.fixture
def db(conn):
    for bid, en in ((TRIBUNALS, "Administrative Tribunals Support Service of Canada"), (DEFENCE, "National Defence"),
                    (PSPC, "Public Services and Procurement Canada"), (HEALTH, "Health Canada")):
        conn.execute("INSERT INTO buyers (id, name_en, name_fr, updated_at) VALUES (?, ?, ?, ?)", (bid, en, f"{en} (fr)", STAMP))
    conn.execute("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES ('Health Canada', 'canadabuys', ?)", (HEALTH,))
    return conn


def tender(conn, ref, title, *, sol=None, buyer=DEFENCE, codes=("80111600",), published_on="2026-10-30",
           start: str | None = START.isoformat(), closing="2026-11-23T14:00:00", status="open", description=None, cut=0,
           end_users=None, amendment=0):
    conn.execute(
        "INSERT INTO tenders (reference, amendment, solicitation, title_en, published, closing, start_expected, status, buyer_id, "
        "end_users_en, description_en, description_en_cut, source_file, first_seen, last_seen) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'f', ?, ?)",
        (ref, amendment, sol, title, published_on, closing, start, status, buyer, json.dumps(end_users) if end_users else None,
         description, cut if description else None, published_on, published_on))
    conn.executemany("INSERT INTO tender_codes (reference, amendment, unspsc) VALUES (?, ?, ?)", [(ref, amendment, c) for c in codes])


def titled(conn, ref, title, *, table="awards", **columns):
    sets = ", ".join(f"{k} = ?" for k in ("title_en", *columns))
    conn.execute(f"UPDATE {table} SET {sets} WHERE reference = ?", (title, *columns.values(), ref))


def night(conn, tmp_path, today=TODAY):
    expiring.compute(conn, today=today, now=STAMP, review_dir=tmp_path / "review")
    counts = lines.compute(conn, today=today, now=STAMP, review_dir=tmp_path / "review")
    out: dict[str, list[dict]] = {}
    for ref, rank, j in conn.execute("SELECT reference, rank, j FROM tender_follows ORDER BY reference, rank"):
        assert rank == len(out.get(ref, [])) + 1
        out.setdefault(ref, []).append(json.loads(j))
    return counts, out


def ths(conn):
    """The design's worked example (section 4.3): the notice, and three earlier THS contracts of the same buyer and
    class, two ending 88 days after its expected start, one 31 days before it."""
    tender(conn, "cb-935-21285129", THS, sol="S6057491")
    for ref, holder, start, end, words in (
        ("cb-725-74465042", "Example Recruitment & Technology Inc.", "2025-11-17", "2026-10-23", "One (1) Computer Application Support"),
        ("cb-691-38891244", "Example Information Technology Consulting Inc.", "2026-03-23", "2027-02-19", "One (1) Computer Website Support"),
        ("cb-648-6250154", "Example Canada Inc", "2026-03-23", "2027-02-19", "One (1) Computer Website Support"),
    ):
        notice(conn, ref, holder, start=start, end=end, codes=("80111600",), buyer=DEFENCE, method="Competitive - Selective tendering")
        titled(conn, ref, f"NPP S5678424 - THS SA - {words}. Temporary Help Services against the Supply Arrangement for the "
                          "National Capital Region (NCR).")
    # The first holder's other contract in the line, overlapping it: earlier records, run 1.
    notice(conn, "cb-700-1", "Example Recruitment & Technology Inc.", start="2025-11-17", end="2026-11-16", codes=("80111600",),
           buyer=DEFENCE)
    conn.commit()


# -- the three paths -------------------------------------------------------------------------------------

def test_the_worked_example_keeps_the_three_with_their_words_dates_and_records(db, tmp_path):
    ths(db)
    counts, rows = night(db, tmp_path)
    kept = rows["cb-935-21285129"]
    assert [(j["ref"], j["deg"], j["words"], j["end"], j["days"]) for j in kept] == [
        ("cb-725-74465042", "close", [7, 8], "2026-10-23", -31),
        ("cb-648-6250154", "partial", [6, 9], "2027-02-19", 88),
        ("cb-691-38891244", "partial", [6, 9], "2027-02-19", 88),
    ]
    first = kept[0]
    assert (first["src"], first["buyer"], first["client"], first["lvl"], first["code"], first["from"]) == (1, DEFENCE, 0, "class", ["801116"], "start")
    assert first["sol"] is None and first["num"] is None and first["wh"] == 0
    assert first["oid"] == org_number(org(db, "Example Recruitment & Technology Inc."))
    # Its own holder's record, by the line's code: 2 held with this buyer in the class, overlapping, so run 1.
    line = first["line"]
    assert lines.label(line) == ("earlier", 1, 1)
    assert (line["s"][0]["held"], line["s"][0]["run"], line["s"][0]["first"], line["buyer"]) == (2, 1, "2025-11-17", DEFENCE)
    assert line["own"]["meth"] == "ST" and line["own"]["end"] == "2026-10-23" and line["fy"] == [2017, 2026]
    assert (counts["follow_open"], counts["follow_matched"], counts["follow_kept"], counts["follow_close"]) == (1, 1, 3, 1)


def test_the_same_solicitation_and_a_number_the_notice_names_are_number_matches_first(db, tmp_path):
    tender(db, "cb-1-1", "Snow removal, Parrtown", sol="21201-27-5551031", codes=("72102900",),
           description="This requirement follows contract 21201-26-4440001, now ending. See W8486-999999/A for the form.")
    # Carries the notice's solicitation: an earlier round under the same number, long before the start.
    notice(db, "AW-SOL", "Snowplough North Ltd", start="2023-12-01", end="2024-03-31", codes=("72102900",), awarded="2023-11-01")
    titled(db, "AW-SOL", "Winter maintenance", solicitation="21201-27/5551031")
    # The number the description names, as this record's contract number; a text that shares nothing.
    notice(db, "AW-NAMED", "Snowplough South Ltd", start="2025-12-01", end="2026-04-30", codes=("43211500",))
    titled(db, "AW-NAMED", "Parking lot service", contract_number="21201-26-4440001")
    # Shares the class and the words, ending near the start: a text match, ranked after the numbers.
    notice(db, "AW-TEXT", "Snowplough East Ltd", start="2025-12-01", end="2026-12-15", codes=("72102900",))
    titled(db, "AW-TEXT", "Snow removal Parrtown")
    db.commit()
    kept = night(db, tmp_path)[1]["cb-1-1"]
    assert [(j["ref"], j["deg"], j["sol"], j["num"]) for j in kept] == [
        ("AW-NAMED", "number", None, "21201-26-4440001"),
        ("AW-SOL", "number", "21201-27/5551031", None),
        ("AW-TEXT", "close", None, None),
    ]
    # The number matches show their other facts: the solicitation's shares the class, the named one nothing.
    assert (kept[1]["lvl"], kept[1]["code"], kept[0]["lvl"], kept[0]["code"], kept[0]["words"]) == ("class", ["721029"], None, [], [0, 4])


def test_the_notices_own_numbers_the_frameworks_and_a_number_two_organizations_carry_are_left_out(db, tmp_path):
    tender(db, "cb-2-2", "Valve parts", sol="W8482-275139/A", codes=("40141600",), description=(
        "Solicitation W8482-275139/A (cb-2-2) is issued against standing offer E60PV-18VALV/001/PV and supply arrangement "
        "EN578-172870. The earlier part numbers 4000-7700 and 4000-7701 do not apply."))
    # Its own solicitation on an earlier round: the same-solicitation path. The part of it before the "/" is its own
    # number too, so a record carrying only that is not named by it.
    notice(db, "AW-SAME", "Valve Works Ltd", start="2025-01-01", end="2025-06-30", codes=("43211500",))
    titled(db, "AW-SAME", "Gaskets", solicitation="W8482-275139/A")
    notice(db, "AW-OWN", "Valve Works Ltd", start="2025-01-01", end="2025-06-30", codes=("43211500",))
    titled(db, "AW-OWN", "Gaskets", contract_number="W8482-275139")
    # A call-up of the standing offer the notice names, and a contract under the supply arrangement.
    published(db, "C-SO-1", "Valve Works Ltd", start="2025-01-01", end="2025-06-30", buyer=DEFENCE, code="N4820",
              so="E60PV-18VALV/001/PV", pid="E60PV-18VALV")
    notice(db, "AW-SA", "Valve Partners Inc", start="2025-01-01", end="2025-06-30", codes=("43211500",))
    titled(db, "AW-SA", "Arrangement", solicitation="EN578-172870", instrument_type_en="Supply Arrangement")
    notice(db, "AW-UNDER", "Valve Partners Inc", start="2025-02-01", end="2025-06-30", codes=("43211500",))
    titled(db, "AW-UNDER", "Call-up", solicitation="EN578-172870", instrument_type_en="Contract against SA")
    # A number two organizations' records carry: a part number, no one contract's.
    for ref, holder in (("AW-P1", "Valve Works Ltd"), ("AW-P2", "Valve Partners Inc")):
        notice(db, ref, holder, start="2025-01-01", end="2025-06-30", codes=("43211500",))
        titled(db, ref, "Parts", contract_number="4000-7700")
    # One organization's: kept.
    notice(db, "AW-P3", "Valve Works Ltd", start="2025-01-01", end="2025-06-30", codes=("43211500",))
    titled(db, "AW-P3", "Parts", contract_number="4000-7701")
    db.commit()
    kept = night(db, tmp_path)[1]["cb-2-2"]
    # Valve parts against Parts: 1 of 2 words; Gaskets: none.
    assert [(j["ref"], j["deg"], j["sol"], j["num"]) for j in kept] == [
        ("AW-P3", "number", None, "4000-7701"),
        ("AW-SAME", "number", "W8482-275139/A", None),
    ]
    # A token holding a digit whose fold has NUMBER_MIN characters; "cb-2-2" folds to four.
    assert follows.named_numbers("W8482-275139/A (cb-2-2) and 4000-7700, 12 3456.", False) == ["W8482-275139/A", "4000-7700"]


def test_a_solicitation_the_records_of_two_organizations_carry_matches_no_one_by_number(db, tmp_path):
    tender(db, "cb-3-3", "Innovation call, phase 2", sol="WS4001912488", codes=("81141900",))
    for ref, holder, title in (("AW-C1", "Alpha Labs Inc", "User licence"), ("AW-C2", "Beta Labs Inc", "Wake detection")):
        notice(db, ref, holder, start="2025-04-01", end="2026-03-31", codes=("43211500",))
        titled(db, ref, title, solicitation="WS4001912488")
    db.commit()
    assert "cb-3-3" not in night(db, tmp_path)[1]


# -- the words and the window ----------------------------------------------------------------------------

def test_the_words_rule_rejects_the_tully_and_anomaly_pairs_and_keeps_the_ths_example():
    tully = follows.title_words("F7049-260131 - CCGS Tully - Oil Purifiers")
    sewage = follows.title_words("CCGS Tully - Sewage Treatment Plant Parts")
    assert (len(tully & sewage), len(tully | sewage)) == (2, 7) and len(tully & sewage) < follows.FOLLOW_MIN * len(tully | sewage)
    anomaly = follows.title_words("Weak magnetic anomaly detection for defence and security")
    wakes = follows.title_words("AS195 - Non-acoustic detection of underwater vehicle wakes")
    assert len(anomaly & wakes) == 1 and len(anomaly & wakes) < follows.FOLLOW_MIN * len(anomaly | wakes)
    one = follows.title_words("NPP S5678424 - THS SA - One (1) Computer Application Support. Temporary Help Services against "
                              "the Supply Arrangement for the National Capital Region (NCR).")
    three = follows.title_words(THS)
    assert (len(one & three), len(one | three)) == (7, 8)
    # Four letters or more, no digit, the stop words out; English, else French.
    assert follows.title_words("The 2026 Contract for X-ray Rental, rental") == frozenset({"rental"})
    assert follows.words_of("", "Services de déneigement") == frozenset({"déneigement"})


def test_the_rejected_pairs_are_not_kept_on_a_night(db, tmp_path):
    tender(db, "cb-4-4", "F7049-260131 - CCGS Tully - Oil Purifiers", codes=("25111900",), start=None)
    notice(db, "AW-TULLY", "Marine Parts Ltd", start="2026-04-01", end="2026-11-30", codes=("25111900",))
    titled(db, "AW-TULLY", "CCGS Tully - Sewage Treatment Plant Parts")
    tender(db, "cb-5-5", "Weak magnetic anomaly detection for defence and security", codes=("81141900",), buyer=PSPC)
    notice(db, "AW-WAKE", "Sensor Lab Ltd", start="2026-04-01", end="2026-11-30", codes=("81141900",), buyer=PSPC)
    titled(db, "AW-WAKE", "AS195 - Non-acoustic detection of underwater vehicle wakes")
    db.commit()
    assert night(db, tmp_path)[1] == {}


@pytest.mark.parametrize(("days", "kept"), [(-180, True), (-181, False), (120, True), (121, False)])
def test_a_text_match_ends_from_180_days_before_the_start_to_120_after(db, tmp_path, days, kept):
    tender(db, "cb-6-6", "Snow removal Parrtown", codes=("72102900",))
    end = (START + timedelta(days=days)).isoformat()
    notice(db, "AW-EDGE", "Snowplough Ltd", start="2025-10-01", end=end, codes=("72102900",))
    titled(db, "AW-EDGE", "Snow removal Parrtown")
    db.commit()
    rows = night(db, tmp_path)[1]
    assert ("cb-6-6" in rows) is kept
    if kept:
        assert rows["cb-6-6"][0]["days"] == days


def test_without_an_expected_start_the_window_is_read_from_the_publication(db, tmp_path):
    tender(db, "cb-7-7", "Snow removal Parrtown", codes=("72102900",), start=None, published_on="2026-10-01")
    notice(db, "AW-PUB", "Snowplough Ltd", start="2025-10-01", end="2027-01-29", codes=("72102900",))
    titled(db, "AW-PUB", "Snow removal Parrtown")
    db.commit()
    j = night(db, tmp_path)[1]["cb-7-7"][0]
    assert (j["from"], j["days"]) == ("pub", 120)


def test_a_family_is_compared_when_the_notice_carries_no_class(db, tmp_path):
    tender(db, "cb-8-8", "Snow removal Parrtown", codes=("72100000",))
    notice(db, "AW-FAM", "Snowplough Ltd", start="2025-10-01", end="2026-12-01", codes=("72102900",))
    titled(db, "AW-FAM", "Snow removal Parrtown")
    db.commit()
    j = night(db, tmp_path)[1]["cb-8-8"][0]
    assert (j["lvl"], j["code"]) == ("family", ["7210"])


# -- the order, the cap and what is left out ------------------------------------------------------------

def test_number_matches_first_then_the_share_of_words_then_the_end_nearest_the_start_and_three_kept(db, tmp_path):
    tender(db, "cb-9-9", "Snow removal Parrtown North Yard", sol="SNOW-2026-0001", codes=("72102900",))
    for ref, holder, title, end in (
        ("AW-A", "Plough A Ltd", "Snow removal Parrtown North", "2026-12-23"),        # 4 of 5, 30 days after
        ("AW-B", "Plough B Ltd", "Snow removal Parrtown North Yard", "2027-02-21"),   # 5 of 5, 90 days after
        ("AW-C", "Plough C Ltd", "Snow removal Parrtown North Yard", "2026-11-13"),   # 5 of 5, 10 days before
        ("AW-D", "Plough D Ltd", "Snow removal Parrtown Yard", "2026-11-23"),         # 4 of 5, on the start
    ):
        notice(db, ref, holder, start="2025-11-01", end=end, codes=("72102900",))
        titled(db, ref, title)
    notice(db, "AW-N", "Plough N Ltd", start="2024-11-01", end="2025-03-31", codes=("43211500",))
    titled(db, "AW-N", "Grounds", solicitation="SNOW-2026-0001")
    db.commit()
    counts, rows = night(db, tmp_path)
    assert [j["ref"] for j in rows["cb-9-9"]] == ["AW-N", "AW-C", "AW-B"]
    assert counts["follow_beyond_max"] == 2 and follows.FOLLOW_MAX == 3


def test_a_record_awarded_after_the_notice_appeared_a_standing_offer_and_a_cancelled_notice_are_left_out(db, tmp_path):
    tender(db, "cb-10-10", "Snow removal Parrtown", codes=("72102900",), published_on="2026-10-30")
    notice(db, "AW-LATE", "Plough Late Ltd", start="2026-11-01", end="2026-12-31", codes=("72102900",), awarded="2026-10-31")
    titled(db, "AW-LATE", "Snow removal Parrtown")
    notice(db, "AW-SO", "Plough Offer Ltd", start="2025-11-01", end="2026-12-31", codes=("72102900",))
    titled(db, "AW-SO", "Snow removal Parrtown", instrument_type_en="Standing Offer")
    notice(db, "AW-GONE", "Plough Gone Ltd", start="2025-11-01", end="2026-12-31", codes=("72102900",), status="cancelled")
    titled(db, "AW-GONE", "Snow removal Parrtown")
    db.commit()
    assert night(db, tmp_path)[1] == {}


def test_one_contract_in_two_sources_is_kept_once_and_a_client_department_matches(db, tmp_path):
    # Contracted by PSPC for Health Canada, the department its first end user names.
    tender(db, "cb-11-11", "Laboratory cleaning", buyer=PSPC, end_users=["Health Canada"], codes=("76111500",))
    notice(db, "AW-T", "Clean Labs Ltd", start="2025-12-01", end="2026-12-31", codes=("76111500",), buyer=HEALTH)
    titled(db, "AW-T", "Laboratory cleaning", contract_number="CW2400001")
    notice(db, "H-T", "Clean Labs Ltd", start="2025-12-01", end="2027-01-01", codes=("76111500",), table="contract_history",
           buyer=PSPC, client=HEALTH)
    titled(db, "H-T", "Laboratory cleaning", table="contract_history", contract_number="CW2400001")
    db.commit()
    kept = night(db, tmp_path)[1]["cb-11-11"]
    assert [(j["ref"], j["buyer"], j["client"]) for j in kept] == [("AW-T", HEALTH, 1)]


def test_a_closed_notice_is_not_matched(db, tmp_path):
    tender(db, "cb-12-12", "Snow removal Parrtown", codes=("72102900",), closing="2026-10-31T14:00:00")
    notice(db, "AW-S", "Plough Ltd", start="2025-11-01", end="2026-12-31", codes=("72102900",))
    titled(db, "AW-S", "Snow removal Parrtown")
    db.commit()
    counts, rows = night(db, tmp_path)
    assert rows == {} and counts["follow_open"] == 0


def test_a_withheld_holder_is_kept_named_by_no_one_and_given_no_record(db, tmp_path):
    tender(db, "cb-13-13", "Snow removal Parrtown", codes=("72102900",))
    notice(db, "AW-W", "Jane Q Sample", start="2025-11-01", end="2026-12-31", codes=("72102900",), withheld=True)
    titled(db, "AW-W", "Snow removal Parrtown")
    db.commit()
    j = night(db, tmp_path)[1]["cb-13-13"][0]
    assert (j["wh"], j["oid"], j["line"]) == (1, None, None)
    assert "Jane" not in json.dumps(j)


# -- the candidate's own record ---------------------------------------------------------------------------

def test_a_kept_records_line_holds_the_common_opening_rule_and_the_similar_names_cap(db, tmp_path):
    """Its record is a radar row's: thirteen harbour authorities in its line list no one, and a corporate family of
    more members than SIM_MAX is held to SIM_MAX."""
    tender(db, "cb-14-14", "Harbour dredging Alma", codes=("72141000",), buyer=TRIBUNALS)
    for i, place in enumerate(PLACES[1:]):
        notice(db, f"HA-{i}", f"Harbour Authority of {place}", start="2023-04-01", end="2024-03-31", codes=("72141000",),
               buyer=TRIBUNALS)
    notice(db, "HA-R", f"Harbour Authority of {PLACES[0]}", start="2025-12-01", end="2026-12-31", codes=("72141000",),
           buyer=TRIBUNALS)
    titled(db, "HA-R", "Harbour dredging Alma")
    tender(db, "cb-15-15", "Bridge inspection Borealis", codes=("72141100",), buyer=TRIBUNALS)
    holder, members = "Borealis Holdings Ltd", [f"Unit {i:02d} Works" for i in range(lines.SIM_MAX + 3)]
    for i, name in enumerate(members):
        notice(db, f"F-{i}", name, start="2023-04-01", end="2024-03-31", codes=("72141100",), buyer=TRIBUNALS)
    notice(db, "F-R", holder, start="2025-12-01", end="2026-12-31", codes=("72141100",), buyer=TRIBUNALS)
    titled(db, "F-R", "Bridge inspection Borealis")
    for name in (holder, *members):
        db.execute("INSERT INTO organization_families (family, organization_id, note, source) VALUES ('Borealis', ?, "
                   "'subsidiary', 'name')", (org(db, name, "awards"),))
    db.commit()
    counts, rows = night(db, tmp_path)
    harbour = rows["cb-14-14"][0]["line"]
    assert harbour["sim"] == [] and harbour["s"][0]["others"] == 12
    family = rows["cb-15-15"][0]["line"]
    assert len(family["sim"]) == lines.SIM_MAX and counts["follow_sim_cut"] == 1
    assert [s[0] for s in family["sim"]] == sorted(s[0] for s in family["sim"])


# -- the texts ------------------------------------------------------------------------------------------

def test_a_long_description_is_read_whole_and_a_cut_ones_last_token_is_not():
    filler = ("Lorem ipsum dolor sit amet, consectetur adipiscing elit. " * 200)[:9_960]
    text = f"{filler} Replaces W8486-207442/001/ZF"
    assert len(text) <= 10_000
    assert follows.named_numbers(text, cut=False)[-1] == "W8486-207442/001/ZF"
    assert "W8486-207442/001/ZF" not in follows.named_numbers(text, cut=True)
    assert follows.named_numbers(text + ".", cut=True)[-1] == "W8486-207442/001/ZF"
    # A whole-word cut (description_en_cut N > 0), a text stored whole (0), one stored before the mark (NULL, 600).
    assert follows._was_cut("x" * 10, 10_000) and not follows._was_cut("x" * 10, 0)
    assert follows._was_cut("x" * 600, None) and not follows._was_cut("x" * 599, None)


def test_a_number_named_near_the_end_of_a_long_description_matches(db, tmp_path):
    filler = ("Lorem ipsum dolor sit amet, consectetur adipiscing elit. " * 200)[:9_950]
    tender(db, "cb-16-16", "Gaskets", codes=("31401500",), description=f"{filler} Follows W8486-207442/001/ZF.", cut=10_000)
    notice(db, "AW-LONG", "Gasket Ltd", start="2024-04-01", end="2025-03-31", codes=("43211500",))
    titled(db, "AW-LONG", "Seals", contract_number="W8486-207442/001/ZF")
    db.commit()
    assert night(db, tmp_path)[1]["cb-16-16"][0]["num"] == "W8486-207442/001/ZF"


# -- the stage -----------------------------------------------------------------------------------------

def test_a_second_night_writes_the_same_j(db, tmp_path):
    ths(db)
    first = night(db, tmp_path)[1]
    stored = db.execute("SELECT reference, rank, j FROM tender_follows ORDER BY 1, 2").fetchall()
    assert night(db, tmp_path)[1] == first
    assert db.execute("SELECT reference, rank, j FROM tender_follows ORDER BY 1, 2").fetchall() == stored


def test_a_fault_in_may_follow_leaves_the_holders_records_written_and_last_nights_follows(db, tmp_path, monkeypatch):
    ths(db)
    published(db, "D-1", "Example Audiovisual Inc.", start="2026-09-28", end="2026-12-31", code="T009", proc="ST", bids=4)
    db.commit()
    night(db, tmp_path)
    before = db.execute("SELECT * FROM tender_follows ORDER BY 1, 2").fetchall()
    assert before
    db.execute("DELETE FROM expiring_lines")
    db.commit()

    def broken(*args, **kwargs):
        raise RuntimeError("bad night")

    monkeypatch.setattr(follows, "write", broken)
    with pytest.raises(follows.FollowsFailed, match="the holders' records were written"):
        lines.compute(db, today=TODAY, now="2026-11-02T12:00:00Z", review_dir=tmp_path / "review")
    assert db.execute("SELECT COUNT(*) FROM expiring_lines").fetchone()[0] > 0
    assert db.execute("SELECT * FROM tender_follows ORDER BY 1, 2").fetchall() == before
    # Before the pass too: the records are still written, and the stage reads as failed.
    monkeypatch.setattr(follows, "choose", broken)
    db.execute("DELETE FROM expiring_lines")
    db.commit()
    assert cli._stage(db, "lines", lambda: lines.run(db, today=TODAY, now=STAMP, review_dir=tmp_path / "review")) is False
    assert db.execute("SELECT COUNT(*) FROM expiring_lines").fetchone()[0] > 0
    assert db.execute("SELECT ok FROM sources_log WHERE source = 'lines' ORDER BY id DESC").fetchone()["ok"] == 0


def test_the_review_file_lists_the_closest_match_of_the_sampled_notices(db, tmp_path):
    ths(db)
    counts, _ = night(db, tmp_path)
    text = (tmp_path / "review" / lines.REVIEW_FILE).read_bytes()
    assert b"\r" not in text
    body = text.decode("utf-8")
    assert "## May follow: 1 open notices, 1 with a match kept (by the closest: 0 number, 1 close, 0 partial), 3 kept in all" in body
    row = next(x for x in body.split("\n") if x.startswith("cb-935-21285129\t"))
    assert row.split("\t")[3:] == [
        "2026-11-23 s", "close", "award:cb-725-74465042",
        "NPP S5678424 - THS SA - One (1) Computer Application Support. Temporary Help Services against the Supply Arrangement "
        "for the National Capital Region (NCR).",
        "Example Recruitment & Technology Inc.", "class 801116", "7/8", "2026-10-23", "-31", "earlier 1"]
    for word in ("account", "email", "@"):
        assert word not in body.replace("no account or reader", ""), word


def test_the_stop_words_are_the_earlier_awards_panels():
    tsx = (REPO / "site" / "src" / "pages" / "backbone.tsx").read_text(encoding="utf-8")
    words = re.search(r"const STOP = new Set\(\[([^\]]*)\]\)", tsx).group(1)
    assert set(re.findall(r'"([^"]+)"', words)) == follows.SITE_STOP
