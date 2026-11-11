"""The profile's "matching" block (profile_matching.py): the counts the site ranks open notices by for an
account that names its organization. Per-source counts never summed, the fiscal window and its edges, the
award_day rule, a class counted once a record, published-contract amendments left out, a history record
under its client and PSPC, withheld suppliers absent, caps and order, held instruments by type and segment,
no block for nothing in the window, and the same block from the same rows in any order. The expected
figures are worked out by hand from the rows written here.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from awardwatch_pipeline import export_static as es
from awardwatch_pipeline import profile_matching as pm
from export_seed import ACME, FOREIGN, NORTH, STAMP, TODAY, seed

SEGMENTS = {"43", "72", "77", "80", "81", "82"}
LISTED = {"pwgsc-tpsgc", "dnd-mdn", "dfo-mpo"}
AS_OF = "2026-11-11"  # fiscal 2026-27, so the window is 2022-23 to 2026-27


def link(bid):
    return bid if bid in LISTED else None


def award(awarded="2025-06-01", *, published=None, codes="81101503", buyer="dfo-mpo", provinces=("NS",), derived=(),
          kind="Request for Proposal", client=None):
    return {"awarded": awarded, "published": published or awarded, "codes": codes, "buyer_id": buyer, "client_id": client,
            "provinces": json.dumps(list(provinces)), "provinces_derived": json.dumps(list(derived)) if derived else None,
            "notice_type_en": kind}


def contract(day="2025-06-01", *, buyer="dfo-mpo", kind="C", amendment=None):
    return {"contract_date": day, "buyer_id": buyer, "instrument_type": kind, "amendment_value": amendment}


def block(awards=(), history=(), contracts=(), held=None, as_of=AS_OF):
    return pm.matching_block(list(awards), list(history), list(contracts), held, as_of=as_of, segments=SEGMENTS, link=link)


# -- the window and the date of a record --------------------------------------------------


def test_the_window_is_five_fiscal_years_ending_with_the_data_dates():
    assert pm.MATCH_YEARS == 5
    assert pm.window("2026-11-11") == (2022, 2026)
    # The year moves on April 1.
    assert pm.window("2027-03-31") == (2022, 2026)
    assert pm.window("2027-04-01") == (2023, 2027)


def test_the_window_edges_by_fiscal_year():
    b = block([award("2022-03-31"), award("2022-04-01"), award("2026-11-11")])
    # 2022-03-31 is fiscal 2021-22, outside; 2022-04-01 opens 2022-23.
    assert b["fy"] == [2022, 2026]
    assert b["n"] == [2, 0, 0]
    assert b["newest"] == "2026-11-11"


def test_an_award_date_after_the_data_date_reads_as_the_publication_date():
    # The contract's end date typed in the award-date field: the record stands at its publication date.
    inside = award("2030-01-01", published="2025-05-05")
    outside = award("2031-01-01", published="2021-05-05")
    b = block([inside, outside])
    assert b["n"] == [1, 0, 0]
    assert b["newest"] == "2025-05-05"
    assert pm.record_day(inside, AS_OF) == "2025-05-05"
    # An award date up to the data date is left alone; a record with no date is not counted.
    assert pm.record_day(award("2026-11-11", published="2026-11-12"), AS_OF) == "2026-11-11"
    assert block([award(None, published="2025-01-01")]) is None


# -- what a record counts in ---------------------------------------------------------------


def test_each_source_is_counted_apart_and_never_summed():
    b = block(
        [award(), award(), award(buyer="pwgsc-tpsgc")],
        [award(buyer="pwgsc-tpsgc", client="dfo-mpo")],
        [contract(), contract(), contract(), contract(), contract(buyer="dnd-mdn")],
    )
    assert b["n"] == [3, 1, 5]
    assert b["classes"] == [["811015", 3, 1]]
    # By the largest count of one source, then the id: National Defence's 1 published contract ties PSPC's 1.
    assert b["buyers"] == [["dfo-mpo", 2, 1, 4], ["dnd-mdn", 0, 0, 1], ["pwgsc-tpsgc", 1, 1, 0]]


def test_a_record_with_two_codes_in_one_class_counts_once_in_the_class_family_and_segment():
    b = block([award(codes="81101503 81101505 81101701 43211509")])
    assert b["classes"] == [["432115", 1, 0], ["811015", 1, 0], ["811017", 1, 0]]
    assert b["families"] == [["4321", 1, 0], ["8110", 1, 0]]
    assert b["segments"] == [["43", 1, 0], ["81", 1, 0]]
    assert b["coded"] == [1, 0]


def test_a_code_outside_the_segments_is_not_read_and_a_record_without_one_is_not_coded():
    # Segment 99 is not one of the segments; "8211" reaches a family and its segment only.
    b = block([award(codes="99101503"), award(codes="8211"), award(codes=None)])
    assert b["n"] == [3, 0, 0]
    assert b["coded"] == [1, 0]
    assert b["classes"] == []
    assert b["families"] == [["8211", 1, 0]]
    assert b["segments"] == [["82", 1, 0]]


def test_published_contract_amendments_are_not_counted():
    b = block(contracts=[contract(), contract(kind="A"), contract(amendment=500.0), contract(amendment=0)])
    # The original and the row whose amendment value is zero are contracts of their own.
    assert b["n"] == [0, 0, 2]
    assert b["buyers"] == [["dfo-mpo", 0, 0, 2]]
    # Published contracts carry no codes, provinces or notice types.
    assert b["classes"] == b["provinces"] == b["types"] == []
    assert b["coded"] == [0, 0]


def test_a_history_record_counts_under_its_client_and_pspc_once_when_they_are_one_buyer():
    b = block(history=[
        award(buyer="pwgsc-tpsgc", client="dfo-mpo"),
        award(buyer="pwgsc-tpsgc", client=None),
        award(buyer="pwgsc-tpsgc", client="pwgsc-tpsgc"),
        # A client the site lists no page for counts under PSPC alone.
        award(buyer="pwgsc-tpsgc", client="not-listed"),
    ])
    assert b["n"] == [0, 4, 0]
    assert b["buyers"] == [["pwgsc-tpsgc", 0, 4, 0], ["dfo-mpo", 0, 1, 0]]


def test_an_award_counts_under_its_buyer_only_and_an_unlisted_buyer_not_at_all():
    b = block([award(buyer="dfo-mpo", client="dnd-mdn"), award(buyer="not-listed"), award(buyer=None)])
    assert b["buyers"] == [["dfo-mpo", 1, 0, 0]]


def test_provinces_are_the_union_of_stated_and_derived_each_once_a_record():
    b = block([award(provinces=("NS", "NB"), derived=("NS",)), award(provinces=(), derived=("NL",)),
               award(provinces=("FD", "NS"))])
    assert b["provinces"] == [["NS", 2, 0], ["NB", 1, 0], ["NL", 1, 0]]


def test_notice_types_as_published_a_blank_skipped():
    b = block([award(kind="Request for Proposal"), award(kind="Request for Proposal"), award(kind="  "), award(kind=None)],
              [award(kind="Directed Contract")])
    assert b["types"] == [["Request for Proposal", 2, 0], ["Directed Contract", 0, 1]]


def test_caps_and_order_by_the_larger_count_then_the_code():
    rows = []
    for i in range(45):
        # Class 8000ii: one record each, and three more in 800044 and two in 800001, so they lead.
        rows.append(award(codes=f"8000{i:02d}01"))
    rows += [award(codes="80004401")] * 3 + [award(codes="80000101")] * 2
    hist = [award(codes="80000201")] * 4
    b = block(rows, hist)
    assert len(b["classes"]) == pm.CLASSES_MAX == 40
    # 800044 has 4 award notices; 800002 has 1 award notice and 4 history records: the larger of the two.
    assert b["classes"][:3] == [["800002", 1, 4], ["800044", 4, 0], ["800001", 3, 0]]
    # Then the classes of one record by code: 800000, 800003 to 800038 fill the forty.
    assert b["classes"][3] == ["800000", 1, 0]
    assert b["classes"][-1] == ["800038", 1, 0]
    assert b["families"] == [["8000", 50, 4]]
    assert pm.FAMILIES_MAX == 20 and pm.BUYERS_MAX == 25
    many = block([award(buyer=f"buyer-{i:02d}") for i in range(30)])
    # Only listed buyers: none of these is.
    assert many["buyers"] == []
    wide = pm.matching_block([award(buyer=f"buyer-{i:02d}") for i in range(30)], [], [], None, as_of=AS_OF,
                             segments=SEGMENTS, link=lambda b: b)
    assert [b[0] for b in wide["buyers"]] == [f"buyer-{i:02d}" for i in range(25)]


def test_no_block_for_nothing_in_the_window_and_a_block_for_an_instrument_alone():
    assert block([award("2019-05-05")], [award("2018-01-01")], [contract("2020-01-01")]) is None
    assert block() is None
    held = [["SA", "81", 1]]
    b = block(held=held)
    assert b == {"fy": [2022, 2026], "n": [0, 0, 0], "coded": [0, 0], "newest": None, "classes": [], "families": [],
                 "segments": [], "buyers": [], "provinces": [], "types": [], "held": held}


def test_the_same_rows_in_any_order_give_the_same_block():
    rows = [award(codes=c, buyer=b, provinces=(p,), kind=k) for c, b, p, k in (
        ("81101503", "dfo-mpo", "NS", "Request for Proposal"), ("77101505", "dnd-mdn", "NB", "Directed Contract"),
        ("80101604", "pwgsc-tpsgc", "NL", "Request for Standing Offer"), ("81101510", "dfo-mpo", "NS", "Request for Proposal"))]
    contracts = [contract(buyer=b) for b in ("dfo-mpo", "dnd-mdn", "dfo-mpo")]
    first = block(rows, rows[:2], contracts)
    for seed_ in range(5):
        shuffled = rows[:]
        random.Random(seed_).shuffle(shuffled)
        assert block(shuffled, list(reversed(rows[:2])), list(reversed(contracts))) == first
    assert json.dumps(first, sort_keys=True) == json.dumps(block(rows, rows[:2], contracts), sort_keys=True)


# -- through the export ---------------------------------------------------------------------


def profile_of(out: Path, oid: str) -> dict:
    return json.loads((out / "profiles" / f"{oid[4:7]}.json").read_text(encoding="utf-8"))[oid]


def instrument(conn, number, type_en, segments, holders):
    conn.execute("INSERT INTO sosa_instruments (agreement_number, type_en, segments, n_holders, first_seen, last_seen) "
                 "VALUES (?, ?, ?, ?, ?, ?)", (number, type_en, json.dumps(segments), len(holders), STAMP[:10], STAMP[:10]))
    for oid, region, lost in holders:
        conn.execute("INSERT INTO sosa_holders (agreement_number, supplier_norm, delivery_point_code, supplier_raw, organization_id, "
                     "first_seen, last_seen, lost_on) VALUES (?, ?, ?, 'Holder', ?, ?, ?, ?)",
                     (number, f"holder-{oid}", region, oid, STAMP[:10], STAMP[:10], lost))


def test_the_export_writes_the_block_from_every_row_of_a_profile(conn, tmp_path):
    ids = seed(conn)
    acme, north = ids[ACME], ids[NORTH]
    # A supply arrangement held in two regions (one instrument), a regional master standing offer, and one lost.
    instrument(conn, "E60ZT-SA-1", "Supply Arrangement", ["81", "72"], [(acme, "ON", None), (acme, "QC", None)])
    instrument(conn, "E60ZT-RMSO-2", "Regional Master Standing Offer (RMSO)", ["81"], [(acme, "ON", None)])
    instrument(conn, "E60ZT-SA-3", "Supply Arrangement", ["43"], [(acme, "ON", "2026-10-01")])
    conn.execute("UPDATE awards SET notice_type_en = 'Request for Proposal' WHERE reference = 'AW-1'")
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url="https://awardwatch.example")
    # The seed's data date is 2026-10-31, fiscal 2026-27. Acme: AW-1 (2026-03-02, segment 72, National Defence,
    # Ontario), the slash reference (2024-04-04, segment 81, PSPC, Ontario) and H-1 (PSPC history for National
    # Defence, 2026-06-01, no code, no province).
    assert profile_of(out, acme)["matching"] == {
        "fy": [2022, 2026], "n": [2, 1, 0], "coded": [2, 0], "newest": "2026-06-01",
        "classes": [["721015", 1, 0], ["811115", 1, 0]], "families": [["7210", 1, 0], ["8111", 1, 0]],
        "segments": [["72", 1, 0], ["81", 1, 0]],
        "buyers": [["dnd-mdn", 1, 1, 0], ["pwgsc-tpsgc", 1, 1, 0]],
        "provinces": [["ON", 2, 0]], "types": [["Request for Proposal", 1, 0]],
        "held": [["RMSO", "81", 1], ["SA", "72", 1], ["SA", "81", 1]],
    }
    # Northern: AW-2 and the cancelled AW-3 (a record all the same), the published contract C-1; C-2 amends it.
    nb = profile_of(out, north)["matching"]
    assert nb["n"] == [2, 0, 1]
    assert nb["buyers"] == [["pwgsc-tpsgc", 2, 0, 0], ["dnd-mdn", 0, 0, 1]]
    assert nb["newest"] == "2026-10-20"
    # The grant and the lobbying report are never read: Northern's grant is with National Defence, counted nowhere.
    assert nb["held"] == []
    # The foreign supplier's notice (2025-02-01) is in the window like any other.
    assert profile_of(out, ids[FOREIGN])["matching"]["n"] == [1, 0, 0]
    # The withheld supplier's award notice and history record count for no organization.
    shards = [json.loads(p.read_text(encoding="utf-8")) for p in (out / "profiles").glob("*.json")]
    blocks = [p["matching"] for shard in shards for p in shard.values() if "matching" in p]
    assert sum(b["n"][0] for b in blocks) == 5  # AW-1, the slash reference, AW-2, AW-3, AW-4; AW-5 is withheld
    assert sum(b["n"][1] for b in blocks) == 1  # H-1; H-2 is withheld
    # The window the blocks count, in stats.json.
    assert json.loads((out / "stats.json").read_text(encoding="utf-8"))["matching_fy"] == [2022, 2026]


def test_a_profile_with_nothing_in_the_window_has_no_block(conn, tmp_path):
    ids = seed(conn)
    # Move Acme's records before fiscal 2022-23.
    conn.execute("UPDATE awards SET awarded = '2019-05-05', published = '2019-05-05' WHERE organization_id = ?", (ids[ACME],))
    conn.execute("UPDATE contract_history SET awarded = '2019-05-05', published = '2019-05-05' WHERE organization_id = ?", (ids[ACME],))
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=TODAY, base_url="https://awardwatch.example")
    assert "matching" not in profile_of(out, ids[ACME])
    assert "matching" in profile_of(out, ids[NORTH])
