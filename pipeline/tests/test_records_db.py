"""The records database's sync (records_db.py, docs/analytics.md): the rows against the
counting rules (independently of the sync, through the figures the buyer pages already
show), the fiscal years, the segment rows, the people left out, the ledger and the
stage, the batches applied to a real SQLite database built from records_schema.sql,
the count check, the three commands, the workflow step and its drift guards."""

from __future__ import annotations

import json
import math
import re
import sqlite3
import statistics
from pathlib import Path

import pytest

from awardwatch_pipeline import cli, config, export_static, nightly, resilience
from awardwatch_pipeline import records_db as rd
from awardwatch_pipeline.db import connect, get_meta, set_meta
from export_seed import ACME, NORTH, PROSE_EMAIL, PROSE_PHONES, SLASH_REF, STAMP, award, seed

REPO = Path(__file__).resolve().parents[2]
WORKFLOW = REPO / ".github" / "workflows" / "nightly.yml"
WRANGLER = REPO / "site" / "wrangler.jsonc"


@pytest.fixture
def seeded(conn):
    ids = seed(conn)
    # The export writes the data date; finish.sql carries it to D1.
    set_meta(conn, "data_as_of", "2026-10-31")
    return conn, ids


def d1() -> sqlite3.Connection:
    """A stand-in for the D1 database: SQLite with the records schema applied."""
    db = sqlite3.connect(":memory:")
    db.executescript(rd.SCHEMA_PATH.read_text(encoding="utf-8"))
    return db


def apply(db: sqlite3.Connection, out: Path, manifest: dict) -> None:
    for name in manifest["batches"]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    db.commit()


def counts(db: sqlite3.Connection) -> dict[str, int]:
    return dict(zip((t.name for t in rd.TABLES), db.execute(rd.COUNT_SQL).fetchone()))


def night(conn: sqlite3.Connection, out: Path, db: sqlite3.Connection, **kwargs) -> dict:
    """records-sync, the apply, the count check, finish.sql and records-synced, as the workflow runs them."""
    manifest = rd.sync(conn, out, **kwargs)
    apply(db, out, manifest)
    assert rd.count_check(rd.expected_counts(manifest), counts(db)) is None
    db.executescript((out / rd.FINISH).read_text(encoding="utf-8"))
    rd.record_sync(conn, manifest)
    return manifest


def rows_by_key(conn: sqlite3.Connection) -> dict[int, tuple]:
    return {r[0]: r for r in rd.record_rows(conn)}


# -- keys, numbers and fiscal years ----------------------------------------------


def test_fiscal_years_run_april_to_march_named_by_their_first_year():
    assert rd.fiscal("2025-04-01") == (2025, 1)
    assert rd.fiscal("2025-06-30") == (2025, 1)
    assert rd.fiscal("2025-07-01") == (2025, 2)
    assert rd.fiscal("2025-12-31T23:59:00") == (2025, 3)
    assert rd.fiscal("2026-01-01") == (2025, 4)
    assert rd.fiscal("2026-03-31") == (2025, 4)
    for blank in (None, "", "2026", "31/03/2026", "2026-13-01"):
        assert rd.fiscal(blank) == (None, None), blank


def test_numbers_read_back_and_fit_where_they_go():
    assert rd.org_number("org-00000000ff") == 255 and rd.org_id(255) == "org-00000000ff"
    assert rd.org_number("org-ffffffffff") == 2 ** 40 - 1 < 2 ** 53
    for bad in (None, "org-FFFFFFFFFF", "org-123", "dnd-mdn", 7):
        assert rd.org_number(bad) is None, bad
    # 40 bits, so the site's JavaScript reads a buyer's number exactly.
    assert 0 <= rd.buyer_number("dnd-mdn") < 2 ** 40 and rd.buyer_number("dnd-mdn") != rd.buyer_number("pwgsc-tpsgc")
    key = rd.key_of("award:AW-1")
    assert -(2 ** 63) <= key < 2 ** 63 and key == rd.key_of("award:AW-1") != rd.key_of("award:AW-1#72")


def test_methods_become_the_tbs_codes():
    assert rd.method_code("Competitive - Open bidding") == "OB"
    assert rd.method_code("Competitive - Selective tendering") == "ST"
    assert rd.method_code("Competitive - Traditional") == "TC"
    assert rd.method_code("Non-competitive") == "TN"
    assert rd.method_code("Advance contract award notice") == "AC"
    assert rd.method_code("tn") == "TN" and rd.method_code(" OB ") == "OB"
    for none in (None, "", "Competitive - Limited tendering", "XX"):
        assert rd.method_code(none) is None, none


# -- the rows against the counting rules -------------------------------------------


def test_each_record_counts_once_with_the_buyer_pages_figures(seeded):
    """Independent of the sync: every buyer and source adds up to the yearly figures
    indicators.compute wrote for the buyer pages (calendar years there, fiscal here, so
    the whole span is compared), counted once whatever its segments."""
    conn, _ = seeded
    names = {rd.buyer_number(b): b for (b,) in conn.execute("SELECT id FROM buyers")}
    mine: dict[tuple[str, str], list] = {}
    for _k, src, _fy, _fq, bid, _oid, _sid, extra, cents, *_rest in rd.record_rows(conn):
        if extra:
            continue
        cell = mine.setdefault((names[bid], {v: k for k, v in rd.SOURCES.items()}[src]), [0, None])
        cell[0] += 1
        if cents is not None:
            cell[1] = (cell[1] or 0) + cents
    theirs = {(b, s): [n, round(t * 100) if t is not None else None] for b, s, n, t in conn.execute(
        "SELECT buyer_id, source, SUM(n), SUM(total) FROM buyer_years GROUP BY buyer_id, source")}
    assert mine == theirs and theirs


def test_values_are_cents_and_the_reason_a_value_is_left_out(seeded):
    conn, ids = seeded
    by = rows_by_key(conn)
    award = lambda ref: by[rd.key_of(f"award:{ref}")]  # noqa: E731
    cents, vnote = 8, 9
    # The newest amendment's total; a cancelled notice counts zero; another currency is left out.
    assert (award("AW-1")[cents], award("AW-1")[vnote]) == (125_000_000, rd.COUNTED)
    assert (award("AW-3")[cents], award("AW-3")[vnote]) == (0, rd.COUNTED)
    assert (award("AW-4")[cents], award("AW-4")[vnote]) == (None, rd.OTHER_CURRENCY)
    # A published contract row's own value: the amendment row adds its amendment.
    contract = by[rd.key_of("contract:dnd-mdn:C-2")]
    assert contract[cents] == 3_000_000 and contract[10:12] == (0, "TN")
    # A value flagged for checking, and one the source did not publish.
    conn.execute("INSERT INTO value_flags (kind, key, rule, computed_at) VALUES ('award', 'AW-2', 'other_source', ?)", (STAMP,))
    conn.execute("UPDATE awards SET amount = NULL, total_value = NULL WHERE reference = 'AW-1'")
    by = rows_by_key(conn)
    assert (award("AW-2")[cents], award("AW-2")[vnote]) == (None, rd.FLAGGED)
    assert (award("AW-1")[cents], award("AW-1")[vnote]) == (None, rd.NO_VALUE)
    # The organization's number reads back as its id.
    assert rd.org_id(award("AW-2")[5]) == ids[NORTH] and rd.org_id(award("AW-1")[5]) == ids[ACME]


def test_history_counts_under_its_client_and_a_withheld_supplier_names_no_one(seeded):
    conn, _ = seeded
    by = rows_by_key(conn)
    for ref in ("H-1", "H-2"):
        assert by[rd.key_of(f"history:{ref}")][4] == rd.buyer_number("dnd-mdn"), ref
    assert by[rd.key_of("history:H-2")][5] is None
    assert by[rd.key_of("award:AW-5")][5] is None


def test_a_notice_counts_once_and_in_each_of_its_segments(seeded):
    conn, _ = seeded
    conn.execute("INSERT INTO award_codes (reference, amendment, unspsc) VALUES ('AW-1', 1, '43211500'), "
                 "('AW-1', 1, '72101599'), ('AW-1', 1, '99999999')")
    rows = [r for r in rd.record_rows(conn) if r[0] in (rd.key_of("award:AW-1"), rd.key_of("award:AW-1#72"),
                                                        rd.key_of("award:AW-1#43"))]
    # Its own row under the lowest segment, one extra row for the other; a code outside the 57 segments is no segment.
    assert sorted((r[6], r[7]) for r in rows) == [(43, 0), (72, 1)]
    assert {r[8] for r in rows} == {125_000_000}
    # Published contracts and grants carry no segment.
    assert all(r[6] is None for r in rd.record_rows(conn) if r[1] in (3, 4))


def test_grants_to_people_are_never_in_the_database(seeded):
    conn, _ = seeded
    conn.execute(
        "INSERT INTO grants (owner_org, reference, amendment, agreement_type, recipient_type, recipient_withheld, value, "
        "start, buyer_id, loaded_at) VALUES ('dnd-mdn', 'G-P', 0, 'G', 'O', 1, 5000, '2026-05-01', 'dnd-mdn', ?)", (STAMP,))
    tally = rd._Counts()
    keys = {r[0] for r in rd.record_rows(conn, tally)}
    assert rd.key_of("grant:dnd-mdn:G-P") not in keys and rd.key_of("grant:dnd-mdn:G-1") in keys
    assert tally.grants_withheld == 1


# Positions of the phase 2 columns in a records row (RECORDS.written).
OCENTS, NAMD, REF, TITLE = (rd.RECORDS.written.index(c) for c in ("ocents", "namd", "ref", "title"))


def test_amendments_compare_the_first_version_with_the_newest(seeded):
    conn, _ = seeded
    by = rows_by_key(conn)
    row = lambda key: by[rd.key_of(key)]  # noqa: E731
    # AW-1 was amended once: 1,000,000 as first awarded, 1,250,000 as last amended.
    assert (row("award:AW-1")[OCENTS], row("award:AW-1")[8], row("award:AW-1")[NAMD]) == (100_000_000, 125_000_000, 1)
    # An unamended notice: its one version on both sides.
    assert (row("award:AW-2")[OCENTS], row("award:AW-2")[8], row("award:AW-2")[NAMD]) == (25_000_000, 25_000_000, 0)
    # A cancelled contract (its zero is a status) and one in another currency are not compared.
    assert (row("award:AW-3")[OCENTS], row("award:AW-3")[8]) == (None, 0)
    assert row("award:AW-4")[OCENTS] is None
    assert (row("history:H-1")[OCENTS], row("history:H-1")[NAMD]) == (30_000_000, 0)
    # Published contracts and grants carry no numbered versions.
    for key in ("contract:dnd-mdn:C-1", "grant:dnd-mdn:G-1"):
        assert (row(key)[OCENTS], row(key)[NAMD]) == (None, None), key


def test_references_and_titles_are_what_the_pages_link_and_show(seeded):
    conn, _ = seeded
    by = rows_by_key(conn)
    row = lambda key: by[rd.key_of(key)]  # noqa: E731
    assert (row("award:AW-1")[REF], row("award:AW-1")[TITLE]) == ("AW-1", "Award AW-1")
    assert (row("history:H-1")[REF], row("history:H-1")[TITLE]) == ("H-1", "Boots")
    # A reference the site cannot take in a URL as published is written in the form its page has.
    assert row(f"award:{SLASH_REF}")[REF] == export_static.url_reference(SLASH_REF) != SLASH_REF
    # A published contract and a grant: department and reference; the description or the title, contacts scrubbed.
    contract = row("contract:dnd-mdn:C-1")
    assert contract[REF] == "dnd-mdn:C-1" and contract[TITLE].startswith("Translation. Fax")
    assert not any(phone in contract[TITLE] for phone in PROSE_PHONES) and "555" not in contract[TITLE]
    assert (row("grant:dnd-mdn:G-1")[REF], row("grant:dnd-mdn:G-1")[TITLE]) == ("dnd-mdn:G-1", "Study")
    # The English title, else the French; cut at a word within 120 characters; none for blanks.
    assert rd.title_of(None, "Bottes") == "Bottes" and rd.title_of("  ", "") is None
    long = rd.title_of("Supply of " + "very " * 40 + "large boots", None)
    assert len(long) <= rd.TITLE_CHARS and long.endswith("very…")
    assert rd.title_of(f"Write to {PROSE_EMAIL} today", None) == "Write to [contact removed] today"
    assert rd.title_of(None, f"Écrire à {PROSE_EMAIL}") == "Écrire à [coordonnées retirées]"


def _median(values: list[int]) -> int:
    """The median the summary rows keep, worked out apart from records_db: the middle value, or the floor of the
    mean of the two middle values."""
    return math.floor(statistics.median(values))


def test_average_and_median_rows_hold_what_the_records_give(seeded, tmp_path):
    conn, _ = seeded
    db = d1()
    night(conn, tmp_path / "records", db)
    rows = list(rd.record_rows(conn))
    # Every buyer, source and fiscal year with a counted value above zero, records with extra = 0.
    groups: dict[tuple, list[int]] = {}
    for r in rows:
        if r[7] == 0 and r[4] is not None and r[2] is not None and (r[8] or 0) > 0:
            groups.setdefault((r[4], r[1], r[2]), []).append(r[8])
    want = {g: (len(v), sum(v), _median(v)) for g, v in groups.items()}
    got = {(b, s, y): (n, pos, med) for b, s, y, n, pos, med in db.execute(
        "SELECT bid, src, fy, n_pos, pos, med FROM rec_buyer_years")}
    assert got == want and want
    # National Defence's published contracts of 2025-26: two values, so the mean of the two.
    dnd = (rd.buyer_number("dnd-mdn"), rd.SOURCES["contracts"], 2025)
    assert got[dnd] == (2, 13_000_000, 6_500_000)
    # Each segment year counts every row, extra or not.
    seg: dict[tuple, list[int]] = {}
    for r in rows:
        if r[6] is not None and r[2] is not None and (r[8] or 0) > 0:
            seg.setdefault((r[6], r[1], r[2]), []).append(r[8])
    for sid, src, fy, n_pos, pos, med in db.execute("SELECT sid, src, fy, n_pos, pos, med FROM rec_segment_years"):
        values = seg.get((sid, src, fy), [])
        assert (n_pos, pos, med) == ((len(values), sum(values), _median(values)) if values else (0, None, None))


def test_contracts_ending_follow_the_radar_quarter_by_quarter(seeded, tmp_path):
    conn, _ = seeded
    # A notice ending after the radar's twelve months, inside the eighth quarter (2028-07 to 2028-09).
    award(conn, "AW-9", 0, NORTH, value=70_000.0, awarded="2026-09-01", codes=("43211500",))
    conn.execute("UPDATE awards SET \"end\" = '2028-09-30' WHERE reference = 'AW-9'")
    # And one a day past it, which no quarter takes.
    award(conn, "AW-10", 0, NORTH, value=80_000.0, awarded="2026-09-01")
    conn.execute("UPDATE awards SET \"end\" = '2028-10-01' WHERE reference = 'AW-10'")
    db = d1()
    night(conn, tmp_path / "records", db)
    due = {(b, s, y, q): (n, c, nv) for b, s, y, q, n, c, nv in db.execute(
        "SELECT bid, sid, fy, fq, n, cents, n_no_value FROM rec_due")}
    assert all(2026 * 4 + 2 <= y * 4 + q - 1 <= 2026 * 4 + 2 + 7 for _, _, y, q in due)
    # The four quarters inside the radar's twelve months hold exactly the radar's rows, per buyer, independently
    # of rec_due's own pass: the table expiring.compute wrote for the seed.
    radar: dict[tuple, list] = {}
    for buyer, end, value, currency, flag in conn.execute(
            "SELECT buyer_id, \"end\", value, currency, value_flag FROM expiring_contracts"):
        y, q = rd.fiscal(end)
        if y * 4 + q > 2027 * 4 + 2:
            continue
        cell = radar.setdefault((rd.buyer_number(buyer), None, y, q), [0, None, 0])
        cell[0] += 1
        if value is not None and currency in (None, "CAD") and not flag:
            cell[1] = (cell[1] or 0) + round(value * 100)
        cell[2] += value is None
    mine = {k: list(v) for k, v in due.items() if k[0] is not None and k[2] * 4 + k[3] <= 2027 * 4 + 2}
    assert mine == radar and radar
    # Past the radar: the notice ending on the eighth quarter's last day, under its buyer and its segment.
    pspc = rd.buyer_number("pwgsc-tpsgc")
    assert due[(pspc, None, 2028, 2)] == (1, 7_000_000, 0)
    assert due[(None, 43, 2028, 2)] == (1, 7_000_000, 0)
    assert not any(k[2] * 4 + k[3] > 2028 * 4 + 2 for k in due)
    # Every buyer a quarter names has its name in rec_buyers.
    named = {b for (b,) in db.execute("SELECT bid FROM rec_buyers")}
    assert {k[0] for k in due if k[0] is not None} <= named
    # The fiscal quarters' last days.
    assert [rd.quarter_end(2026, q).isoformat() for q in (1, 2, 3, 4)] == ["2026-06-30", "2026-09-30", "2026-12-31",
                                                                           "2027-03-31"]
    assert rd.add_quarters(2026, 3, 7) == (2028, 2)


# -- the sync ------------------------------------------------------------------------


def test_the_first_sync_loads_everything_and_the_next_sends_only_changes(seeded, tmp_path):
    conn, ids = seeded
    out = tmp_path / "records"
    db = d1()
    first = night(conn, out, db)
    assert first["full"] and first["reason"].startswith("first load")
    assert counts(db) == first["expected"] and first["expected"]["records"] == 11
    assert dict(db.execute("SELECT key, value FROM rec_meta")) == {"state": "ready", "as_of": "2026-10-31", "rules": "2"}
    # The summary tables hold what the records add up to.
    assert db.execute("SELECT SUM(n), SUM(cents) FROM rec_buyer_quarters").fetchone() == \
        db.execute("SELECT COUNT(*), SUM(cents) FROM records WHERE extra = 0 AND bid IS NOT NULL AND fy IS NOT NULL").fetchone()
    assert db.execute("SELECT name FROM rec_orgs WHERE oid = ?", (rd.org_number(ids[ACME]),)).fetchone() == (ACME,)
    assert db.execute("SELECT id, name_fr FROM rec_buyers WHERE bid = ?", (rd.buyer_number("dnd-mdn"),)).fetchone() == \
        ("dnd-mdn", "Défense nationale")
    assert conn.execute("SELECT COUNT(*) FROM records_ledger").fetchone()[0] == first["expected_total"]
    assert conn.execute("SELECT COUNT(*) FROM records_staged").fetchone()[0] == 0

    second = night(conn, out, db)
    assert not second["full"] and second["batches"] == [] and sum(second["upserts"].values()) == 0

    # One value changes and one record goes: one row and the sums around it are sent, one row is deleted.
    conn.execute("UPDATE contracts SET amendment_value = 40000 WHERE reference = 'C-2'")
    conn.execute("DELETE FROM grants WHERE reference = 'G-1'")
    third = night(conn, out, db)
    assert third["upserts"]["records"] == 1 and third["deletes"]["records"] == 1
    assert third["upserts"]["rec_buyer_quarters"] == 1 and third["deletes"]["rec_buyer_quarters"] == 1
    assert db.execute("SELECT cents FROM records WHERE k = ?", (rd.key_of("contract:dnd-mdn:C-2"),)).fetchone() == (4_000_000,)
    assert db.execute("SELECT COUNT(*) FROM records WHERE src = 4").fetchone() == (0,)
    assert counts(db) == third["expected"]


def test_batches_applied_twice_change_nothing(seeded, tmp_path):
    conn, _ = seeded
    out = tmp_path / "records"
    db = d1()
    manifest = rd.sync(conn, out)
    apply(db, out, manifest)
    before = [db.execute(f"SELECT * FROM {t.name} ORDER BY 1").fetchall() for t in rd.TABLES]
    # A full reload's batch starts from scratch, so applying it again must leave the same rows.
    apply(db, out, manifest)
    assert [db.execute(f"SELECT * FROM {t.name} ORDER BY 1").fetchall() for t in rd.TABLES] == before
    # The upserts alone, applied again, change nothing either.
    for name in manifest["batches"][1:]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    assert [db.execute(f"SELECT * FROM {t.name} ORDER BY 1").fetchall() for t in rd.TABLES] == before


def test_a_full_reload_marks_the_database_loading_until_finish(seeded, tmp_path):
    conn, _ = seeded
    out = tmp_path / "records"
    db = d1()
    night(conn, out, db)
    manifest = rd.sync(conn, out, full=True)
    assert manifest["full"] and manifest["reason"] == "requested"
    db.executescript((out / manifest["batches"][0]).read_text(encoding="utf-8"))
    assert db.execute("SELECT value FROM rec_meta WHERE key = 'state'").fetchone() == ("loading",)
    assert counts(db)["records"] == 0
    for name in manifest["batches"][1:]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    db.executescript((out / rd.FINISH).read_text(encoding="utf-8"))
    assert db.execute("SELECT value FROM rec_meta WHERE key = 'state'").fetchone() == ("ready",)
    rd.record_sync(conn, manifest)
    assert conn.execute("SELECT COUNT(*) FROM records_ledger").fetchone()[0] == manifest["expected_total"]


def test_a_full_reload_after_a_count_mismatch_waits_its_days(conn):
    assert rd.full_reason(conn, ledger_empty=True, today="2026-11-01").startswith("first load")
    set_meta(conn, rd.META_LAYOUT, rd.LAYOUT)
    set_meta(conn, rd.META_FULL_AT, "2026-11-01")
    rd.request_reload(conn, "2026-11-10")
    assert rd.full_reason(conn, today="2026-11-10") == ""
    assert rd.full_reason(conn, today="2026-11-29").startswith("the row counts read back")
    assert rd.full_reason(conn, requested=True, today="2026-11-02") == "requested"


def test_tables_of_another_form_reload_in_full_whatever_the_days(seeded, tmp_path):
    """A database last loaded by phase 1 (no layout recorded) holds tables without the new columns: the next sync
    drops and recreates them the day after a full load, and records the form, so the night after sends changes."""
    conn, _ = seeded
    out = tmp_path / "records"
    db = d1()
    night(conn, out, db)
    assert get_meta(conn, rd.META_LAYOUT) == str(rd.LAYOUT)
    # As a phase 1 night would leave it: a full load yesterday, no layout in meta.
    conn.execute("DELETE FROM meta WHERE key = ?", (rd.META_LAYOUT,))
    set_meta(conn, rd.META_FULL_AT, "2026-11-03")
    assert rd.full_reason(conn, today="2026-11-04") == f"the records tables changed form (layout 1 to {rd.LAYOUT})"
    reload = rd.sync(conn, out, today="2026-11-04")
    assert reload["full"] and reload["layout"] == rd.LAYOUT
    assert "DROP TABLE IF EXISTS records;" in (out / reload["batches"][0]).read_text(encoding="utf-8")
    # A reload that never finished records nothing, so the next night reloads again.
    assert rd.full_reason(conn, today="2026-11-05").startswith("the records tables changed form")
    apply(db, out, reload)
    rd.record_sync(conn, reload)
    assert get_meta(conn, rd.META_LAYOUT) == str(rd.LAYOUT) and rd.full_reason(conn, today="2026-11-05") == ""
    # The other way round is the same: a recorded form other than the code's.
    set_meta(conn, rd.META_LAYOUT, rd.LAYOUT + 1)
    assert rd.full_reason(conn, ledger_empty=True).startswith("first load")


def test_the_ledger_records_only_the_plan_it_staged(seeded, tmp_path):
    conn, _ = seeded
    out = tmp_path / "records"
    old = rd.sync(conn, out)
    rd.sync(conn, out)
    with pytest.raises(ValueError, match="not the one staged"):
        rd.record_sync(conn, old)
    assert conn.execute("SELECT COUNT(*) FROM records_ledger").fetchone()[0] == 0


def test_statements_and_batches_respect_their_caps(seeded, tmp_path):
    conn, _ = seeded
    out = tmp_path / "records"
    rd.build(conn)
    rd.stage(conn, "requested")
    # Every row staged, without the reset batch (whose schema is one statement of its own). A
    # published contract's row, with its 27 columns named twice, is the widest statement.
    writer = rd.write_batches(conn, out, full=False, max_bytes=3_000, max_rows_per_upsert=3, max_statement_bytes=1_500)
    assert len(writer.files) > 3
    for name in writer.files:
        data = (out / name).read_bytes()
        assert len(data) <= 3_000
        for statement in data.decode("utf-8").splitlines():
            assert len(statement.encode("utf-8")) <= 1_500 and statement.count("), (") <= 2
    with pytest.raises(ValueError, match="NUL"):
        list(rd.upsert_statements(rd.ORGS, [(1, "A\x00B")]))
    with pytest.raises(ValueError, match="not a date"):
        rd.finish_sql("2026-11-04'); DROP TABLE records; --")


def test_the_schema_applies_twice_unchanged_and_names_only_its_tables():
    db = d1()
    db.executescript(rd.SCHEMA_PATH.read_text(encoding="utf-8"))
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert tables == {t.name for t in rd.TABLES} | {"rec_meta"}
    # Every table the sync writes has the columns it writes.
    for t in rd.TABLES:
        assert [r[1] for r in db.execute(f"PRAGMA table_info({t.name})")] == list(t.written), t.name


# -- the commands and the run ------------------------------------------------------------


def test_the_parser_names_the_three_commands():
    parser = cli.build_parser()
    args = parser.parse_args(["records-sync", "--db", "x.sqlite", "--full"])
    assert args.command == "records-sync" and args.full
    assert parser.parse_args(["records-check", "--manifest", "m", "--counts", "c"]).db is None
    assert parser.parse_args(["records-synced", "--manifest", "m"]).command == "records-synced"


def test_the_commands_run_a_night_end_to_end(tmp_path):
    path = tmp_path / "awardwatch.sqlite"
    conn = connect(path)
    seed(conn)
    set_meta(conn, "data_as_of", "2026-10-31")
    conn.commit()
    conn.close()
    out = tmp_path / "records"
    outcome = config.OUT_DIR / "records" / rd.OUTCOME
    db = d1()

    assert cli.main(["records-sync", "--db", str(path), "--out", str(out)]) == 0
    assert outcome.read_text() == "failed\n"
    manifest = json.loads((out / rd.MANIFEST).read_text(encoding="utf-8"))
    for name in (out / rd.BATCH_LIST).read_text().split():
        db.executescript((out / name).read_text(encoding="utf-8"))

    wrong = tmp_path / "wrong.json"
    answer = counts(db)
    wrong.write_text(json.dumps([{"results": [{**answer, "records": answer["records"] - 1}], "success": True}]))
    assert cli.main(["records-check", "--manifest", str(out / rd.MANIFEST), "--counts", str(wrong), "--db", str(path)]) == 1
    conn = connect(path)
    assert get_meta(conn, rd.META_RELOAD)
    conn.close()

    right = tmp_path / "count.json"
    right.write_text("Wrangler says hello\n" + json.dumps([{"results": [answer], "success": True}]))
    assert cli.main(["records-check", "--manifest", str(out / rd.MANIFEST), "--counts", str(right)]) == 0
    assert cli.main(["records-synced", "--db", str(path), "--manifest", str(out / rd.MANIFEST)]) == 0
    assert outcome.read_text() == "synced\n"
    conn = connect(path)
    assert conn.execute("SELECT COUNT(*) FROM records_ledger").fetchone()[0] == manifest["expected_total"]
    assert get_meta(conn, rd.META_RELOAD) is None and get_meta(conn, rd.META_PLAN) is None
    log_rows = conn.execute("SELECT rows, full FROM records_sync").fetchall()
    assert [tuple(r) for r in log_rows] == [(manifest["expected_total"], 1)]
    conn.close()

    # The next night: nothing to send, though finish.sql still moves the data date.
    assert cli.main(["records-sync", "--db", str(path), "--out", str(out)]) == 0
    assert json.loads((out / rd.MANIFEST).read_text())["batches"] == []
    assert "('as_of', '2026-10-31')" in (out / rd.FINISH).read_text()
    assert cli.main(["records-synced", "--db", str(path), "--manifest", str(out / rd.MANIFEST)]) == 0
    assert outcome.read_text() == "nothing to send\n"

    # A sync that cannot read the database stops with exit 2 and leaves "failed", and no manifest.
    (tmp_path / "broken.sqlite").write_bytes(b"not a database")
    assert cli.main(["records-sync", "--db", str(tmp_path / "broken.sqlite"), "--out", str(out)]) == 2
    assert outcome.read_text() == "failed\n"


@pytest.mark.parametrize(("value", "item", "notice"), [
    ("failed", True, False), ("synced", False, False), ("nothing to send", False, False), ("no database", False, True),
])
def test_the_outcome_reaches_the_status_and_only_a_failure_needs_attention(tmp_path, value, item, notice):
    db = tmp_path / "awardwatch.sqlite"
    connect(db).close()
    started = tmp_path / "started.txt"
    started.write_text("2026-11-01T00:00:00Z")
    outcome = tmp_path / "records" / rd.OUTCOME
    outcome.parent.mkdir()
    outcome.write_text(value + "\n")
    out = tmp_path / "status.json"
    assert nightly.main(["status", "--db", str(db), "--started-file", str(started), "--records-outcome", str(outcome),
                         "--step", "deploy=success", "--out", str(out)]) == 0
    status = json.loads(out.read_text())
    assert status["records_sync"] == value and status["ok"] is True
    assert ("Records database sync: failed (sent again next run)" in resilience.attention_items(status)) is item
    assert any(n["source"] == "records_sync" for n in status["notices"]) is notice


# -- the workflow and the drift guards ----------------------------------------------------


def step(text: str, name: str) -> str:
    return text.split(f"- name: {name}", 1)[1].split("\n      - ", 1)[0]


def test_the_workflow_syncs_the_records_database_before_the_save_and_never_holds_the_deploy_back():
    text = WORKFLOW.read_text(encoding="utf-8")
    names = [line.strip()[len("- name: "):] for line in text.splitlines() if line.strip().startswith("- name: ")]
    at = names.index("Sync the records database")
    assert names[at - 1] == "Sync the search database" and names[at + 1] == "Bundle the static data for the site"
    assert at < names.index("Deploy the Worker with the new data as assets") < names.index("Save the database to R2")
    sync = step(text, "Sync the records database")
    assert "id: records" in sync and "continue-on-error: true" in sync and "timeout-minutes: 300" in sync
    assert "steps.verify.outputs.export_ok == 'true' && steps.verify.outputs.db_ok == 'true'" in sync
    # The placeholder first (no database: a notice, nothing sent), then plan, schema, batches, counts, check,
    # finish and ledger, in that order.
    order = [
        "if grep -q '\"database_id\": \"00000000-0000-0000-0000-000000000000\"' wrangler.jsonc; then",
        "printf 'no database\\n' > \"$out/last_outcome.txt\"",
        'awardwatch_pipeline records-sync --db ../data/awardwatch.sqlite --static ../data/out/static --out "$out"',
        '"$WRANGLER" d1 execute awardwatch-records --remote --yes --file ../pipeline/records_schema.sql',
        'for batch in $(cat "$out/batches.txt"); do',
        '"$WRANGLER" d1 execute awardwatch-records --remote --yes --file "$out/$batch"',
        f'"$WRANGLER" d1 execute awardwatch-records --remote --json --command "{rd.COUNT_SQL}" > "$out/count.json"',
        'records-check --db ../data/awardwatch.sqlite --manifest "$out/manifest.json" --counts "$out/count.json"',
        '"$WRANGLER" d1 execute awardwatch-records --remote --yes --file "$out/finish.sql"',
        'records-synced --db ../data/awardwatch.sqlite --manifest "$out/manifest.json"',
    ]
    places = [sync.index(line) for line in order]
    assert places == sorted(places)
    for name in ("Bundle the static data for the site", "Deploy the Worker with the new data as assets",
                 "Save the database to R2"):
        assert "steps.records." not in step(text, name), name
    assert "--records-outcome data/out/records/last_outcome.txt" in step(text, "Write the run status")
    assert 'echo "Records database: $(cat data/out/records/last_outcome.txt)"' in step(
        text, "Record the run so the schedule stays enabled")


def test_the_binding_the_site_reads_is_the_database_the_step_writes():
    wrangler = WRANGLER.read_text(encoding="utf-8")
    binding = re.search(r'"binding": "RECORDS",\s*"database_name": "([a-z-]+)",\s*"database_id": "([0-9a-f-]{36})"', wrangler)
    assert binding and binding.group(1) == "awardwatch-records"
    # Either the placeholder the step looks for or a real id; never another database's.
    others = set(re.findall(r'"database_id": "([0-9a-f-]{36})"', wrangler)) - {binding.group(2)}
    assert binding.group(2) not in others and len(others) == 3
    text = WORKFLOW.read_text(encoding="utf-8")
    assert text.count("d1 execute awardwatch-records") == 4
    # The local database gets the schema with the others.
    scripts = json.loads((REPO / "site" / "package.json").read_text(encoding="utf-8"))["scripts"]
    assert "wrangler d1 execute awardwatch-records --local --file=../pipeline/records_schema.sql" in scripts["db:local"]


def test_the_site_reads_the_numbers_the_sync_writes():
    ts = "\n".join((REPO / "site" / "src" / name).read_text(encoding="utf-8") for name in ("records_db.ts", "records_tables.ts"))
    numbers = re.search(r"export const SOURCE_NUMBER[^=]*=\s*\{([^}]*)\}", ts)
    assert numbers and dict(re.findall(r"(\w+): (\d)", numbers.group(1))) == {k: str(v) for k, v in rd.SOURCES.items()}
    # Every table and column the site names is one the schema creates.
    db = d1()
    columns = {t: {r[1] for r in db.execute(f"PRAGMA table_info({t})")} for t in [t.name for t in rd.TABLES] + ["rec_meta"]}
    for table in set(re.findall(r"\b(?:FROM|JOIN) (rec_\w+|records)\b", ts)):
        assert table in columns, table
    # The columns the record statements name by alias (c.dept, d.day, ...) are each in the alias's table.
    aliases = {"c": "rec_contracts", "d": "rec_details", "b": "rec_buyers", "o": "rec_orgs", "g": "rec_gsin", "r": "records"}
    tables_ts = (REPO / "site" / "src" / "records_tables.ts").read_text(encoding="utf-8")
    for alias, column in set(re.findall(r"\b([cdbogr])\.([a-z_]+)\b", tables_ts)):
        if alias == "c" and column in ("rk", "cls", "bid", "day") and "rec_classes c" in tables_ts:
            assert column in columns["rec_classes"] | columns["rec_contracts"], column
            continue
        assert column in columns[aliases[alias]], f"{alias}.{column}"
    # The radar's kind numbers are the sources' (pages/expiring.tsx KIND_NUMBER).
    expiring_ts = (REPO / "site" / "src" / "pages" / "expiring.tsx").read_text(encoding="utf-8")
    kinds = re.search(r"KIND_NUMBER[^=]*=\s*\{([^}]*)\}", expiring_ts)
    assert kinds and dict(re.findall(r"(\w+): (\d)", kinds.group(1))) == {k: str(v) for k, v in rd.EXPIRING_KINDS.items()}


# -- the published contracts' pages ---------------------------------------------------

def test_each_published_contract_has_a_page_row_scrubbed_grouped_and_keyed_as_its_record(seeded, tmp_path):
    conn, _ = seeded
    conn.execute("UPDATE contracts SET commodity_type = 'S', commodity_code = 'R019BF', trade_agreement = '[\"CA\", \"WT\"]', "
                 "number_of_bids = 3, comments_fr = 'Écrire à agent@example.gc.ca' WHERE reference = 'C-2'")
    conn.execute("INSERT INTO gsin_codes (code, desc_en, desc_fr) VALUES ('R019BF', 'Translation services', "
                 "'Services de traduction'), ('Z999', 'Not used', NULL)")
    # A department that is not a buyer id, and a reference with a control character: no address takes them.
    conn.execute("INSERT INTO contracts (owner_org, reference, loaded_at) VALUES ('Not An Id', 'Z-1', '2026-11-01')")
    conn.execute("INSERT INTO contracts (owner_org, reference, loaded_at) VALUES ('dnd-mdn', 'Z\x072', '2026-11-01')")
    out = tmp_path / "records"
    db = d1()
    manifest = night(conn, out, db)
    assert manifest["left_out"]["contracts_unaddressable"] == 2
    assert manifest["expected"]["rec_contracts"] == 2 and manifest["expected"]["rec_gsin"] == 1
    cols = ("dept", "ref", "pid", "oid", "wh", "cdate", "endd", "value", "orig", "amend", "proc", "comp", "ctype", "gsin",
            "trade", "inst", "period", "bids", "desc_en", "com_fr")
    rows = {r[1]: dict(zip(cols, r)) for r in db.execute(f"SELECT {', '.join(cols)} FROM rec_contracts ORDER BY ref")}
    org = conn.execute("SELECT organization_id FROM contracts WHERE reference = 'C-1'").fetchone()[0]
    assert rows["C-1"] | {"desc_en": None} == {
        "dept": "dnd-mdn", "ref": "C-1", "pid": "PROC-1", "oid": rd.org_number(org), "wh": 0, "cdate": "2025-11-12",
        "endd": "2027-03-31", "value": 10_000_000, "orig": 10_000_000, "amend": None, "proc": "TN", "comp": 0, "ctype": None,
        "gsin": None, "trade": None, "inst": "C", "period": "2025-2026-Q3", "bids": None, "desc_en": None, "com_fr": None,
    }
    # The exports' scrub: a telephone or fax number and an email address never reach the page.
    assert "555" not in rows["C-1"]["desc_en"] and rows["C-1"]["desc_en"].startswith("Translation.")
    assert "@" not in rows["C-2"]["com_fr"] and rows["C-2"]["com_fr"].startswith("Écrire à")
    assert (rows["C-2"]["value"], rows["C-2"]["amend"], rows["C-2"]["trade"], rows["C-2"]["bids"]) == (13_000_000, 3_000_000, "CA, WT", 3)
    # One contract's rows share the department and procurement_id; the key is the record's, so the counted value joins.
    assert db.execute("SELECT r.cents FROM rec_contracts c JOIN records r ON r.k = c.k WHERE c.ref = 'C-2'").fetchone() == (3_000_000,)
    assert db.execute("SELECT code, desc_fr FROM rec_gsin").fetchall() == [("R019BF", "Services de traduction")]
    # Nothing changed, nothing sent: no field that moves every week (loaded_at) is in the row.
    conn.execute("UPDATE contracts SET loaded_at = '2026-11-08'")
    assert night(conn, out, db)["batches"] == []



# -- the record tables, the earlier awards and the radar's window -----------------------

def test_the_record_tables_rows_carry_each_counted_records_date_reference_and_title(seeded, tmp_path):
    conn, _ = seeded
    db = d1()
    night(conn, tmp_path / "records", db)
    # One row per counted record with a date and a party, its figures the records row's own.
    assert db.execute(
        "SELECT COUNT(*) FROM rec_details d LEFT JOIN records r ON r.k = d.k AND r.extra = 0 WHERE r.k IS NULL OR r.src != d.src "
        "OR r.cents IS NOT d.cents OR r.bid IS NOT d.bid OR r.oid IS NOT d.oid OR r.comp IS NOT d.comp OR r.meth IS NOT d.meth "
        "OR r.vnote != d.vnote").fetchone() == (0,)
    assert db.execute("SELECT COUNT(*) FROM rec_details").fetchone() == db.execute(
        "SELECT COUNT(*) FROM records WHERE extra = 0 AND fy IS NOT NULL AND (bid IS NOT NULL OR oid IS NOT NULL)").fetchone()
    # A published contract by department and reference, its title scrubbed as the exports are.
    day, title = db.execute("SELECT day, title_en FROM rec_details WHERE ref = 'dnd-mdn:C-1'").fetchone()
    assert day == "2025-11-12" and title.startswith("Translation.") and "555" not in title
    # An award reference the site cannot take as it is goes in its URL form.
    from awardwatch_pipeline.export_static import url_reference
    from export_seed import SLASH_REF
    if conn.execute("SELECT 1 FROM awards WHERE reference = ?", (SLASH_REF,)).fetchone():
        assert db.execute("SELECT COUNT(*) FROM rec_details WHERE ref = ?", (url_reference(SLASH_REF),)).fetchone() == (1,)
    # Every class is a six-digit UNSPSC class of a notice or history record that names a buyer, dated as it is.
    assert db.execute("SELECT COUNT(*) FROM rec_classes").fetchone()[0] > 0
    assert db.execute(
        "SELECT COUNT(*) FROM rec_classes c LEFT JOIN rec_details d ON d.k = c.rk WHERE d.k IS NULL OR d.src NOT IN (1, 2) "
        "OR c.cls < 100000 OR c.cls > 999999 OR c.bid IS NOT d.bid OR c.day != d.day").fetchone() == (0,)


def _window(static: Path, rows: object, pages: object = 1) -> None:
    folder = static / "expiring" / "12m"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "index.json").write_text(json.dumps({"window": "12m", "pages": pages, "rows": 3, "total": None}), encoding="utf-8")
    (folder / "1.json").write_text(json.dumps(rows), encoding="utf-8")


def test_the_radars_window_is_read_from_the_static_export_without_its_day_count(seeded, tmp_path):
    conn, ids = seeded
    static = tmp_path / "static"
    base = {"title_en": "T", "title_fr": None, "organization": None, "buyer_en": None, "buyer_fr": None, "start": None, "days_left": 9,
            "method_en": None, "method_fr": None, "instrument_fr": None, "n_amendments": 0, "value_growth": None, "provinces": []}
    _window(static, [
        {**base, "kind": "contract", "reference": "dnd-mdn:C-1", "end": "2027-03-31", "organization_id": ids[NORTH], "buyer_id": "dnd-mdn",
         "client_buyer_id": "dnd-mdn", "value": 130000.0, "currency": None, "competitive": 0, "instrument_en": "Standing offer",
         "segments": []},
        {**base, "kind": "award", "reference": "AW-9", "end": "2026-12-15", "organization_id": None, "supplier_withheld": True,
         "buyer_id": "pwgsc-tpsgc", "value": 5000.0, "currency": "USD", "competitive": True, "instrument_en": "Contract",
         "segments": ["82", "43"], "value_flag": None},
        {**base, "kind": "award", "reference": None, "end": "2026-12-15"},
    ])
    db = d1()
    manifest = night(conn, tmp_path / "records", db, static_dir=static)
    assert manifest["expected"]["rec_expiring"] == 2
    rows = {json.loads(j)["reference"]: (endd, oid, buyer, client, segs, kind, comp, cad, cents, nv, so, m31, json.loads(j))
            for endd, oid, buyer, client, segs, kind, comp, cad, cents, nv, so, m31, j in db.execute(
                "SELECT endd, oid, buyer, client, segs, kind, comp, cad, cents, nv, so, m31, j FROM rec_expiring")}
    contract = rows["dnd-mdn:C-1"]
    assert contract[:12] == ("2027-03-31", rd.org_number(ids[NORTH]), "dnd-mdn", "dnd-mdn", "", 3, 0, 13_000_000, 13_000_000, 0, 1, 1)
    assert "days_left" not in contract[12]
    award = rows["AW-9"]
    # Another currency has no Canadian value to add or band; a withheld supplier names no one; segments between spaces.
    assert award[:12] == ("2026-12-15", None, "pwgsc-tpsgc", None, " 43 82 ", 1, 1, None, None, 0, 0, 0)
    # A day count that moves every night changes nothing sent.
    _window(static, [{**r[12], "days_left": 1} for r in rows.values()])
    assert night(conn, tmp_path / "records", db, static_dir=static)["upserts"]["rec_expiring"] == 0
    # A window index naming a page that is not a list stops the sync.
    _window(static, {"rows": []})
    with pytest.raises(ValueError, match="not a list"):
        rd.sync(conn, tmp_path / "records", static_dir=static)
