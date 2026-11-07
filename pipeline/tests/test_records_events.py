"""The events the watches follow (records_db.derive_events, rec_events; docs/analytics.md "Events"): each rule
against a previous night set up by hand, through the whole night as the workflow runs it (records-sync, the apply to
a SQLite stand-in for D1, the count check, finish.sql, records-synced), so the rows D1 ends with are checked too.
Every expected value is written out from the seed and the changes below, never read back from the code under test."""

from __future__ import annotations

import csv
import json
import sqlite3
from pathlib import Path

import pytest

from awardwatch_pipeline import organizations
from awardwatch_pipeline import records_db as rd
from awardwatch_pipeline.db import set_meta
from awardwatch_pipeline.normalize import norm_name, org_id
from awardwatch_pipeline.sources import sosa
from export_seed import ACME, NORTH, award, seed

SHOWN = ("day", "kind", "src", "oid", "buyer", "sid", "ref", "cents", "ocents", "endd", "oendd", "closing", "oclosing", "namd",
         "title", "other", "horizon", "more", "path")


@pytest.fixture
def world(conn, tmp_path):
    ids = seed(conn)
    return {"conn": conn, "ids": ids, "db": _d1(), "out": tmp_path / "records", "static": tmp_path / "static"}


def _d1() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.executescript(rd.SCHEMA_PATH.read_text(encoding="utf-8"))
    return db


def night(w: dict, day: str, *, apply: bool = True) -> dict:
    """One night at data date `day`; with apply False the batches never reach D1 and nothing is recorded."""
    conn, db, out = w["conn"], w["db"], w["out"]
    set_meta(conn, "data_as_of", day)
    conn.commit()
    manifest = rd.sync(conn, out, today=day, static_dir=w["static"])
    if not apply:
        return manifest
    for name in manifest["batches"]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    counts = dict(zip((t.name for t in rd.TABLES), db.execute(rd.COUNT_SQL).fetchone()))
    assert rd.count_check(rd.expected_counts(manifest), counts) is None
    db.executescript((out / rd.FINISH).read_text(encoding="utf-8"))
    rd.record_sync(conn, manifest)
    return manifest


def in_d1(w: dict, kind: str) -> list[dict]:
    rows = w["db"].execute(f"SELECT {', '.join(SHOWN)} FROM rec_events WHERE kind = ? ORDER BY day, ref, more", (kind,)).fetchall()
    return [{k: v for k, v in zip(SHOWN, r) if v is not None} for r in rows]


def local(w: dict, kind: str) -> list[dict]:
    rows = w["conn"].execute(f"SELECT {', '.join(SHOWN)} FROM records_events WHERE kind = ? ORDER BY day, ref, more", (kind,)).fetchall()
    return [{k: v for k, v in zip(SHOWN, r) if v is not None} for r in rows]


def window(w: dict, rows: list[dict]) -> None:
    """The radar's 12-month window as the static export writes it."""
    folder = w["static"] / "expiring" / "12m"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "index.json").write_text(json.dumps({"window": "12m", "pages": 1, "rows": len(rows), "total": None}), encoding="utf-8")
    (folder / "1.json").write_text(json.dumps(rows), encoding="utf-8")


def oid(w: dict, name: str) -> int:
    return rd.org_number(w["ids"][name])


# -- award won ----------------------------------------------------------------------------


def test_a_record_new_to_the_ledger_is_an_award_event_once_and_none_on_a_first_load(world):
    w = world
    first = night(w, "2026-10-31")
    assert first["full"] and local(w, "award") == []
    award(w["conn"], "AW-9", 0, ACME, value=40_000.0, buyer="dnd-mdn", awarded="2026-10-30", published="2026-10-31",
          first_seen="2026-11-01")
    w["conn"].execute("UPDATE awards SET \"end\" = '2027-04-30' WHERE reference = 'AW-9'")
    w["conn"].commit()
    second = night(w, "2026-11-01")
    expected = [{"day": "2026-11-01", "kind": "award", "src": 1, "oid": oid(w, ACME), "buyer": "dnd-mdn", "sid": 81, "ref": "award:aw-9",
                 "cents": 4_000_000, "endd": "2027-04-30", "title": "Award AW-9", "path": "/awards/aw-9"}]
    assert local(w, "award") == expected and in_d1(w, "award") == expected
    assert second["events"]["award"] == 1 and second["upserts"]["rec_events"] == 1
    third = night(w, "2026-11-02")
    assert third["events"]["award"] == 0 and in_d1(w, "award") == expected


def test_a_night_derived_twice_or_whose_apply_failed_keeps_one_event_on_its_first_day(world):
    w = world
    night(w, "2026-10-31")
    award(w["conn"], "AW-9", 0, ACME, value=40_000.0, buyer="dnd-mdn", awarded="2026-10-30", first_seen="2026-11-01")
    w["conn"].commit()
    night(w, "2026-11-01", apply=False)
    night(w, "2026-11-01", apply=False)
    night(w, "2026-11-02")
    assert [r["day"] for r in in_d1(w, "award")] == ["2026-11-01"]
    assert night(w, "2026-11-02")["upserts"]["rec_events"] == 0


def test_more_than_100_of_a_kind_for_one_subject_keep_the_largest_and_a_count_row(world):
    w = world
    night(w, "2026-10-31")
    for i in range(102):
        award(w["conn"], f"AW-B{i:03d}", 0, ACME, value=1_000.0 + i, buyer="dnd-mdn", awarded="2026-10-30", first_seen="2026-11-01")
    w["conn"].commit()
    manifest = night(w, "2026-11-01")
    rows = in_d1(w, "award")
    assert len([r for r in rows if r.get("buyer") == "dnd-mdn" and "more" not in r]) == 100
    assert len([r for r in rows if r.get("oid") == oid(w, ACME) and "more" not in r]) == 100
    # The two smallest lost both subjects and still serve a watch on the record itself.
    small = [r for r in rows if "more" not in r and "buyer" not in r]
    assert sorted(r["ref"] for r in small) == ["award:aw-b000", "award:aw-b001"]
    counts = [r for r in rows if "more" in r]
    assert sorted(counts, key=lambda r: r["path"]) == [
        {"day": "2026-11-01", "kind": "award", "buyer": "dnd-mdn", "ref": "count:award:dnd-mdn", "more": 2, "path": "/buyers/dnd-mdn"},
        {"day": "2026-11-01", "kind": "award", "oid": oid(w, ACME), "ref": f"count:award:{oid(w, ACME)}", "more": 2,
         "path": f"/organizations/{w['ids'][ACME]}"},
    ]
    assert manifest["events"]["capped"] == 2


# -- amended, cancelled ------------------------------------------------------------------------


def _history_version(w: dict, amendment: int, total: int, end: str, status: str = "active") -> None:
    w["conn"].execute(
        "INSERT INTO contract_history (reference, amendment, procurement_number, title_en, awarded, published, amount, total_value, "
        "currency, status, competitive, supplier_raw, organization_id, buyer_id, client_id, \"end\", source_file, first_seen, last_seen) "
        "SELECT reference, ?, procurement_number, title_en, awarded, published, amount, ?, currency, ?, competitive, supplier_raw, "
        "organization_id, buyer_id, client_id, ?, source_file, '2026-11-01', '2026-11-01' FROM contract_history "
        "WHERE reference = 'H-1' AND amendment = 0", (amendment, total, status, end))
    w["conn"].commit()


def test_a_history_record_with_a_new_version_is_amended_with_its_value_and_end_before_and_after(world):
    w = world
    night(w, "2026-10-31")
    _history_version(w, 1, 360000, "2028-01-20")
    night(w, "2026-11-01")
    assert in_d1(w, "amended") == [{
        "day": "2026-11-01", "kind": "amended", "src": 2, "oid": oid(w, ACME), "buyer": "dnd-mdn", "ref": "history:h-1",
        "cents": 36_000_000, "ocents": 30_000_000, "endd": "2028-01-20", "oendd": "2027-01-20", "namd": 1, "title": "Boots",
        "path": "/history/h-1"}]
    assert in_d1(w, "award") == []


def test_a_cancelling_version_is_cancelled_with_the_value_before_never_a_fall_to_zero(world):
    w = world
    night(w, "2026-10-31")
    _history_version(w, 1, 300000, "2027-01-20", status="cancelled")
    night(w, "2026-11-01")
    assert in_d1(w, "amended") == []
    assert [(r["ref"], r["ocents"], r.get("cents")) for r in in_d1(w, "cancelled")] == [("history:h-1", 30_000_000, None)]


def test_an_award_notice_with_a_new_version_is_amended_too(world):
    w = world
    night(w, "2026-10-31")
    award(w["conn"], "AW-1", 2, ACME, value=1_500_000.0, buyer="dnd-mdn", codes=("72101500",), competitive=0, awarded="2026-03-02",
          first_seen="2026-11-01")
    w["conn"].commit()
    night(w, "2026-11-01")
    assert [(r["ref"], r["sid"], r["cents"], r["ocents"], r["namd"]) for r in in_d1(w, "amended")] == [
        ("award:aw-1", 72, 150_000_000, 125_000_000, 2)]


def test_a_published_row_joining_a_known_contract_is_amended_on_every_version_and_names_its_parties_once(world):
    w = world
    night(w, "2026-10-31")
    north = w["ids"][NORTH]
    w["conn"].execute(
        "INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, buyer_id, contract_date, delivery_date, value, "
        "amendment_value, description_en, solicitation_procedure, competitive, instrument_type, organization_id, loaded_at) "
        "VALUES ('dnd-mdn', 'C-3', 'PROC-1', 'Northern Translation Ltd', 'dnd-mdn', '2026-10-20', '2027-09-30', 150000, 20000, "
        "'Translation, more', 'TN', 0, 'A', ?, '2026-11-01T01:00:00Z')", (north,))
    w["conn"].commit()
    night(w, "2026-11-01")
    # The newest version the previous night knew (C-2: 130,000, ending 2027-03-31) is the before.
    common = {"day": "2026-11-01", "kind": "amended", "src": 3, "cents": 15_000_000, "ocents": 13_000_000, "endd": "2027-09-30",
              "oendd": "2027-03-31", "title": "Translation, more", "path": "/contracts/dnd-mdn/C-3"}
    assert in_d1(w, "amended") == [
        {**common, "oid": rd.org_number(north), "buyer": "dnd-mdn", "ref": "contract:dnd-mdn:C-1"},
        {**common, "ref": "contract:dnd-mdn:C-2"},
    ]
    assert in_d1(w, "award") == []


def test_a_published_value_that_rose_or_an_end_that_moved_in_place_is_amended(world):
    w = world
    night(w, "2026-10-31")
    w["conn"].execute("UPDATE contracts SET value = 110000 WHERE reference = 'C-1'")
    w["conn"].execute("UPDATE contracts SET delivery_date = '2027-06-30' WHERE reference = 'C-2'")
    w["conn"].commit()
    night(w, "2026-11-01")
    rows = [(r["ref"], "oid" in r, r["cents"], r["ocents"], r.get("oendd"), r["path"]) for r in in_d1(w, "amended")]
    assert sorted(rows) == sorted([
        ("contract:dnd-mdn:C-1", True, 11_000_000, 10_000_000, None, "/contracts/dnd-mdn/C-1"),
        ("contract:dnd-mdn:C-2", False, 11_000_000, 10_000_000, None, "/contracts/dnd-mdn/C-1"),
        ("contract:dnd-mdn:C-1", True, 13_000_000, 13_000_000, "2027-03-31", "/contracts/dnd-mdn/C-2"),
        ("contract:dnd-mdn:C-2", False, 13_000_000, 13_000_000, "2027-03-31", "/contracts/dnd-mdn/C-2"),
    ])
    w["conn"].execute("UPDATE contracts SET value = 90000 WHERE reference = 'C-1'")
    w["conn"].commit()
    assert night(w, "2026-11-02")["events"]["amended"] == 0


# -- ends within 12 and 6 months, ended ---------------------------------------------------------


def _radar(w: dict) -> None:
    base = {"title_fr": None, "buyer_id": "dnd-mdn", "currency": "CAD", "segments": []}
    window(w, [
        # 2026-11-01 + 365 days, 2026-11-03 + 365 days, 2026-11-01 + 182 days.
        {**base, "kind": "award", "reference": "AW-1", "title_en": "Award AW-1", "end": "2027-11-01",
         "organization_id": w["ids"][ACME], "organization": ACME, "value": 1_250_000.0, "segments": ["72"]},
        {**base, "kind": "award", "reference": "AW-2", "title_en": "Award AW-2", "end": "2027-11-03",
         "organization_id": w["ids"][NORTH], "value": 250_000.0},
        {**base, "kind": "contract", "reference": "dnd-mdn:C-2", "title_en": "Translation", "end": "2027-05-02",
         "organization_id": w["ids"][NORTH], "value": 230_000.0},
    ])


def test_each_end_date_crosses_the_12_and_the_6_month_lines_once(world):
    w = world
    _radar(w)
    first = night(w, "2026-10-31")
    assert first["events"]["ends_12m"] == first["events"]["ends_6m"] == 0
    night(w, "2026-11-01")
    assert in_d1(w, "ends_12m") == [{"day": "2026-11-01", "kind": "ends_12m", "src": 1, "oid": oid(w, ACME), "buyer": "dnd-mdn",
                                     "sid": 72, "ref": "award:aw-1", "cents": 125_000_000, "endd": "2027-11-01", "title": "Award AW-1",
                                     "other": ACME, "horizon": 365, "path": "/awards/aw-1"}]
    six = in_d1(w, "ends_6m")
    assert [(r["ref"], "oid" in r, r["horizon"], r["endd"], r["path"]) for r in six] == [
        ("contract:dnd-mdn:C-1", True, 182, "2027-05-02", "/contracts/dnd-mdn/C-2"),
        ("contract:dnd-mdn:C-2", False, 182, "2027-05-02", "/contracts/dnd-mdn/C-2")]
    assert night(w, "2026-11-02")["events"]["ends_12m"] == 0
    night(w, "2026-11-03")
    assert [r["day"] for r in in_d1(w, "ends_12m")] == ["2026-11-01", "2026-11-03"]
    assert in_d1(w, "ends_6m") == six


def test_missed_nights_are_covered_from_the_last_one_derived(world):
    w = world
    _radar(w)
    night(w, "2026-10-31")
    third = night(w, "2026-11-03")
    assert (third["events"]["ends_12m"], third["events"]["ends_6m"]) == (2, 2)


def test_a_contract_whose_last_day_passed_is_ended_once(world):
    w = world
    night(w, "2026-10-31")
    w["conn"].execute("UPDATE awards SET \"end\" = '2026-10-31' WHERE reference = 'AW-2'")
    w["conn"].commit()
    night(w, "2026-11-01")
    assert [(r["ref"], r["endd"], r["oid"], r["buyer"], r["path"]) for r in in_d1(w, "ended")] == [
        ("award:aw-2", "2026-10-31", oid(w, NORTH), "pwgsc-tpsgc", "/awards/aw-2")]
    assert night(w, "2026-11-02")["events"]["ended"] == 0


# -- tender notices ------------------------------------------------------------------------------


def test_notices_by_buyer_their_amendments_their_award_and_their_closing(world):
    w = world
    night(w, "2026-10-31")
    assert [(r["buyer"], r["ref"], r.get("sid")) for r in in_d1(w, "notice")] == [
        ("dnd-mdn", "tender:cb-200-2", 72), ("pwgsc-tpsgc", "tender:ssc-26-00035339-t", 43)]
    # What moved in the amendment: the closing, from the version before, and the title.
    assert in_d1(w, "notice_amended") == [{
        "day": "2026-10-31", "kind": "notice_amended", "src": 5, "buyer": "pwgsc-tpsgc", "sid": 81, "ref": "tender:cb-100-1",
        "closing": "2026-11-20T14:00:00", "oclosing": "2026-11-05T14:00:00", "namd": 1, "title": "Translation services, amended",
        "other": "Translation services", "path": "/tenders/cb-100-1"}]
    # AW-2, first seen tonight, carries the solicitation of cb-100-1 (sol-1, SOL-1): awarded, with its winner.
    assert [(r["ref"], r["other"], r["cents"]) for r in in_d1(w, "notice_awarded")] == [("tender:cb-100-1", NORTH, 25_000_000)]
    night(w, "2026-11-04")
    assert [(r["ref"], r["closing"]) for r in in_d1(w, "notice_closed")] == [("tender:cb-200-2", "2026-11-03T14:00:00")]
    assert night(w, "2026-11-05")["events"]["notice_closed"] == 0


def test_a_notice_cancelled_is_its_own_kind(world):
    w = world
    night(w, "2026-10-31")
    w["conn"].execute("UPDATE tenders SET status = 'cancelled' WHERE reference = 'cb-100-1'")
    w["conn"].commit()
    night(w, "2026-11-01")
    assert [r["ref"] for r in in_d1(w, "notice_cancelled")] == ["tender:cb-100-1"]
    assert in_d1(w, "notice_closed") == []


# -- the 90 data dates kept --------------------------------------------------------------------


def test_events_older_than_90_days_are_dropped_here_and_in_d1(world):
    w = world
    insert = "INSERT INTO records_events (k, day, kind, src, oid, buyer, ref, title, path) VALUES (?, ?, 'award', 1, 1, 'dnd-mdn', ?, 'Old', ?)"
    # 2026-10-31 less 90 days is 2 August: that day goes, the 3rd stays.
    assert rd.EVENT_DAYS == 90
    w["conn"].executemany(insert, [(rd.key_of("old:1"), "2026-08-02", "award:old-1", "/awards/old-1"),
                                   (rd.key_of("old:2"), "2026-08-03", "award:old-2", "/awards/old-2")])
    w["conn"].commit()
    night(w, "2026-10-31")
    assert [r["day"] for r in in_d1(w, "award")] == ["2026-08-03"]
    nxt = night(w, "2026-11-01")
    assert in_d1(w, "award") == [] and local(w, "award") == []
    assert nxt["deletes"]["rec_events"] == 1


def test_a_data_date_before_the_last_one_derives_nothing_and_keeps_the_rows(world):
    w = world
    night(w, "2026-11-01")
    held = in_d1(w, "notice")
    back = night(w, "2026-10-31")
    assert sum(v for k, v in back["events"].items() if k != "capped") == 0 and back["deletes"]["rec_events"] == 0
    assert in_d1(w, "notice") == held


# -- standing offers and supply arrangements ----------------------------------------------------

RMSO = "E60ZT-120002/001/ZT"
RMSO_PATH = "/instruments/E60ZT-120002%2F001%2FZT"
EXEMPLAR = "Exemplar Environmental Consulting Ltd."
COASTAL = "Coastal Geomatics Limited"
INSTRUMENT_KINDS = ("instrument_gained", "instrument_lost", "instrument_expires_6m")
SOSA_SHOWN = ("day", "kind", "oid", "ref", "endd", "title", "title_fr", "other", "other_fr", "horizon", "more", "path")


def sosa_rows(w: dict, kind: str) -> list[dict]:
    rows = w["db"].execute(f"SELECT {', '.join(SOSA_SHOWN)} FROM rec_events WHERE kind = ? ORDER BY day, ref, oid, other, more",
                           (kind,)).fetchall()
    return [{k: v for k, v in zip(SOSA_SHOWN, r) if v is not None} for r in rows]


def sosa_week(fixtures: Path, tmp_path: Path, published: str, *, drop=lambda r: False, add: tuple[dict, ...] = ()) -> Path:
    """sosa_head.csv (test_sosa.py's fixture) as published on another date, rows dropped or added."""
    with (fixtures / "sosa_head.csv").open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        header, base = list(reader.fieldnames or []), list(reader)
    rows = [{**r, "date-file-published": published} for r in base if not drop(r)]
    rows += [{**base[0], **extra, "date-file-published": published} for extra in add]
    path = tmp_path / f"sosa-{published}-{len(rows)}.csv"
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows)
    return path


def sosa_file(w: dict, path: Path, today: str) -> None:
    sosa.load_file(w["conn"], path, today=today)
    sosa.upkeep(w["conn"], today)


def holder(name: str) -> int:
    return rd.org_number(org_id(norm_name(name)))


@pytest.fixture
def holders_world(world):
    for name in (EXEMPLAR, COASTAL):
        organizations.upsert(world["conn"], name, source="awards", now="2026-10-30T01:00:00Z")
    world["conn"].commit()
    return world


def test_a_gained_or_lost_instrument_is_its_holders_event_once_and_the_first_file_gives_none(holders_world, fixtures, tmp_path):
    w = holders_world
    night(w, "2026-10-30")
    # The first file: every row is new, and none is an event.
    sosa_file(w, fixtures / "sosa_head.csv", "2026-10-31")
    first = night(w, "2026-10-31")
    assert [first["events"][k] for k in INSTRUMENT_KINDS] == [0, 0, 0]
    assert all(sosa_rows(w, k) == [] for k in INSTRUMENT_KINDS)
    # The second file, published 2026-11-06, reaches the pipeline only after the night of the 7th: Coastal gained
    # the offer in Alberta, and a firm with no profile gained one too (no organization can follow it).
    night(w, "2026-11-07")
    extra = ({"supplier-legal-name": COASTAL, "delivery-point-code": "CA-AB", "delivery-point_en": "Alberta", "delivery-point_fr": "Alberta"},
             {"supplier-legal-name": "Unlisted Labs Corp.", "delivery-point-code": "CA-AB"})
    sosa_file(w, sosa_week(fixtures, tmp_path, "2026-11-06", add=extra), "2026-11-08")
    second = night(w, "2026-11-08")
    gained = [{"day": "2026-11-08", "kind": "instrument_gained", "oid": holder(COASTAL), "ref": f"sosa:{RMSO}", "endd": "2028-03-31",
               "title": "Environmental consulting services", "title_fr": "Services d'experts-conseils en environnement",
               "other": "Regional master standing offer · Alberta", "other_fr": "Offre à commandes principale régionale · Alberta",
               "path": RMSO_PATH}]
    assert sosa_rows(w, "instrument_gained") == gained and second["events"]["instrument_gained"] == 1
    assert night(w, "2026-11-09")["events"]["instrument_gained"] == 0 and sosa_rows(w, "instrument_gained") == gained
    # Coastal's British Columbia row is absent from two files in a row: no longer held there, once.
    no_coastal_bc = lambda r: r["supplier-legal-name"] == COASTAL and r["delivery-point-code"] == "CA-BC"  # noqa: E731
    sosa_file(w, sosa_week(fixtures, tmp_path, "2026-11-13", drop=no_coastal_bc, add=extra), "2026-11-14")
    assert night(w, "2026-11-14")["events"]["instrument_lost"] == 0
    sosa_file(w, sosa_week(fixtures, tmp_path, "2026-11-20", drop=no_coastal_bc, add=extra), "2026-11-21")
    third = night(w, "2026-11-21")
    assert sosa_rows(w, "instrument_lost") == [{
        "day": "2026-11-21", "kind": "instrument_lost", "oid": holder(COASTAL), "ref": f"sosa:{RMSO}", "endd": "2028-03-31",
        "title": "Environmental consulting services", "title_fr": "Services d'experts-conseils en environnement",
        "other": "Regional master standing offer · British Columbia",
        "other_fr": "Offre à commandes principale régionale · Colombie-Britannique", "path": RMSO_PATH}]
    assert third["events"]["instrument_lost"] == 1 and night(w, "2026-11-22")["events"]["instrument_lost"] == 0
    # The pipeline's copies agree with D1's.
    assert [r["day"] for r in local(w, "instrument_gained")] == ["2026-11-08"]


def test_an_instruments_expiry_crosses_the_6_month_line_once_per_holder_and_never_the_12_month_one(holders_world, fixtures):
    w = holders_world
    sosa_file(w, fixtures / "sosa_head.csv", "2026-10-31")
    night(w, "2026-10-31")
    # 2026-11-01 + 182 days is 2027-05-02; 2026-11-01 + 365 days is 2027-11-01.
    w["conn"].execute("UPDATE sosa_instruments SET expiry = '2027-05-02' WHERE agreement_number = ?", (RMSO,))
    w["conn"].execute("UPDATE sosa_instruments SET expiry = '2027-11-01' WHERE agreement_number = 'EZ899-250380/001/ZM'")
    w["conn"].commit()
    crossed = night(w, "2026-11-01")
    common = {"day": "2026-11-01", "kind": "instrument_expires_6m", "ref": f"sosa:{RMSO}", "endd": "2027-05-02",
              "title": "Environmental consulting services", "title_fr": "Services d'experts-conseils en environnement",
              "horizon": 182, "path": RMSO_PATH}
    # Exemplar holds it in two regions and gets one event naming both; the person withheld gets none.
    expected = sorted([
        {**common, "oid": holder(EXEMPLAR), "other": "Regional master standing offer · Alberta, British Columbia",
         "other_fr": "Offre à commandes principale régionale · Alberta, Colombie-Britannique"},
        {**common, "oid": holder(COASTAL), "other": "Regional master standing offer · British Columbia",
         "other_fr": "Offre à commandes principale régionale · Colombie-Britannique"},
    ], key=lambda r: (r["oid"], r["other"]))
    assert sorted(sosa_rows(w, "instrument_expires_6m"), key=lambda r: (r["oid"], r["other"])) == expected
    assert crossed["events"]["instrument_expires_6m"] == 2
    assert night(w, "2026-11-02")["events"]["instrument_expires_6m"] == 0
    assert rd.INSTRUMENT_LINE == 182


def test_an_instrument_event_names_the_type_the_current_file_writes_as_an_acronym(holders_world, fixtures):
    """The file as published in 2026 writes "RMSO" and wraps some names in quotes; the watch
    mail's line names the type and the regions in each language all the same."""
    w = holders_world
    sosa_file(w, fixtures / "sosa_head.csv", "2026-10-31")
    night(w, "2026-10-31")
    w["conn"].execute("UPDATE sosa_instruments SET type_en = 'RMSO', type_fr = 'OCPR', expiry = '2027-05-02' WHERE agreement_number = ?",
                      (RMSO,))
    w["conn"].execute("UPDATE sosa_holders SET delivery_point_en = '\"British Columbia\"' WHERE delivery_point_code = 'BC'")
    w["conn"].commit()
    night(w, "2026-11-01")
    lines = {(r["other"], r["other_fr"]) for r in sosa_rows(w, "instrument_expires_6m")}
    assert lines == {
        ("Regional master standing offer · Alberta, British Columbia", "Offre à commandes principale régionale · Alberta, Colombie-Britannique"),
        ("Regional master standing offer · British Columbia", "Offre à commandes principale régionale · Colombie-Britannique")}


def test_more_than_100_instrument_events_for_one_organization_keep_100_and_a_count_row(world):
    w = world
    night(w, "2026-10-31")
    acme = w["ids"][ACME]
    w["conn"].executemany(
        "INSERT INTO sosa_events (day, kind, ref, oid, region, endd) VALUES ('2026-10-30', 12, ?, ?, 'BC', '2028-03-31')",
        [(f"sosa:CAP-{i:03d}/001/ZT", acme) for i in range(101)])
    w["conn"].commit()
    manifest = night(w, "2026-11-01")
    rows = sosa_rows(w, "instrument_gained")
    assert len([r for r in rows if r.get("oid") == oid(w, ACME) and "more" not in r]) == 100
    assert [r for r in rows if "more" in r] == [{"day": "2026-11-01", "kind": "instrument_gained", "oid": oid(w, ACME),
                                                "ref": f"count:instrument_gained:{oid(w, ACME)}", "more": 1,
                                                "path": f"/organizations/{acme}"}]
    # An instrument the stage no longer describes still links its page, with the region's code.
    first = next(r for r in rows if r["ref"] == "sosa:CAP-000/001/ZT")
    assert (first["path"], first["other"], first["endd"]) == ("/instruments/CAP-000%2F001%2FZT", "BC", "2028-03-31")
    assert manifest["events"]["instrument_gained"] == 101 and manifest["events"]["capped"] == 1


# -- refs and paths ------------------------------------------------------------------------------


def test_the_refs_and_paths_are_the_keys_and_pages_the_site_reads():
    assert rd.contract_path("dnd-mdn", "23240-220799/001/IM") == "/contracts/dnd-mdn/23240-220799%2F001%2FIM"
    assert rd.contract_path("dnd-mdn", "A b(c)'!") == "/contracts/dnd-mdn/A%20b(c)'!"
    assert rd.record_ref(1, "AW-1") == "award:aw-1" and rd.record_ref(2, "H-1") == "history:h-1"
    assert rd.record_ref(3, "dnd-mdn:C-1") == "contract:dnd-mdn:C-1" and rd.record_ref(4, "dnd-mdn:G-1") == "grant:dnd-mdn:G-1"
    assert rd.record_ref(1, None) is None and rd.record_ref(1, ":AW-1") is None
    assert rd.event_path(1, "AW-1", None, None) == "/awards/aw-1"
    assert rd.event_path(1, None, 255, "dnd-mdn") == "/organizations/org-00000000ff"
    assert rd.event_path(4, "dnd-mdn:G-1", None, "dnd-mdn") == "/buyers/dnd-mdn"


def test_the_event_kinds_are_the_sites():
    site = (Path(__file__).resolve().parents[2] / "site" / "src" / "account" / "watch_events.ts").read_text(encoding="utf-8")
    kinds = site.split("export const EVENT_KINDS = [", 1)[1].split("]", 1)[0]
    assert tuple(k.strip().strip('"') for k in kinds.split(",") if k.strip()) == rd.EVENT_KINDS
