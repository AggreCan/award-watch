"""The same-day refresh (intraday.py): the row parser it shares with the nightly loader, the buyer lookup
and its resolution, the SQL batch and its idempotence, the run row, the prune, the fetch, and the workflow.

The fixture is the 2026-10-30 new notices file the loader tests read (25 notices, three of them published
and amended the same day, so listed at amendment 1 or 2 with no amendment 0)."""

from __future__ import annotations

import csv
import gzip
import json
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from conftest import FakeResponse
from awardwatch_pipeline import export_static as es
from awardwatch_pipeline import intraday, search_db
from awardwatch_pipeline.db import connect
from awardwatch_pipeline.normalize import squash, to_int
from awardwatch_pipeline.sources import buyers, canadabuys, canadabuys_rows

csv.field_size_limit(2**31 - 1)
NEW = "canadabuys_tenders_new.csv"
AMENDMENT = canadabuys_rows.COLUMNS["tenders"]["amendment"]
REFERENCE = canadabuys_rows.COLUMNS["tenders"]["reference"]
TITLE = canadabuys_rows.COLUMNS["tenders"]["title_en"]
STATUS = canadabuys_rows.COLUMNS["tenders"]["status"]
DAY = "2026-10-30T12:30:00Z"
SEEN = datetime(2026, 10, 30, 15, 45, tzinfo=timezone.utc)
REPO = Path(__file__).resolve().parents[2]
SCHEMA = REPO / "pipeline" / "intraday_schema.sql"
WORKFLOW = REPO / ".github" / "workflows" / "intraday.yml"
BASE = "https://awardwatch.example"
# The three notices of the fixture published and amended on 2026-10-30.
AMENDED = {"cb-29-37893161": 1, "cb-3-34869181": 2, "cb-189-51083224": 1}


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        return reader.fieldnames, list(reader)


def write_csv(path, header, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header, quoting=csv.QUOTE_ALL, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    return path


def d1():
    """A stand-in for the D1 tables: SQLite with pipeline/intraday_schema.sql, as the operator applies it."""
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA.read_text(encoding="utf-8"))
    return db


def stored(db):
    return [dict(r) for r in db.execute(f"SELECT * FROM {intraday.TABLE} ORDER BY reference, amendment")]


def wrangler_answer(db, sql=intraday.STATE_SQL):
    """What `wrangler d1 execute --json --command` prints for sql, run against the stand-in (after a notice
    of the kind Wrangler sometimes prints first, brackets included)."""
    rows = [dict(r) for r in db.execute(sql)]
    return "[WARNING] a notice Wrangler printed first\n" + json.dumps([{"results": rows, "success": True, "meta": {}}])


def run_batch(tmp_path, csv_path, db, now, lookup=None, name="out"):
    """One changed cut, as the workflow runs it: the state from D1, the refresh, the batch applied."""
    state = intraday.read_state(wrangler_answer(db))
    out = tmp_path / name
    summary = intraday.refresh(csv_path, lookup, state, out, now=now)
    db.executescript((out / "batch.sql").read_text(encoding="utf-8"))
    return summary, out


# -- the parser the nightly loader and the refresh share ----------------------------------------


@pytest.mark.parametrize("amended", [True, False], ids=["with amendments", "without amendments"])
def test_the_shared_parser_reads_a_notice_as_the_loader_stores_it(conn, fixtures, tmp_path, amended):
    header, rows = read_csv(fixtures / NEW)
    if not amended:
        rows = [r for r in rows if r[AMENDMENT] == "000"]
    assert any(r[AMENDMENT] != "000" for r in rows) is amended
    path = write_csv(tmp_path / "new.csv", header, rows)
    canadabuys.load_file(conn, "tenders", path, "new.csv", now=DAY)
    table = {(r["reference"], r["amendment"]): dict(r) for r in conn.execute("SELECT * FROM tenders")}
    codes = defaultdict(set)
    for r in conn.execute("SELECT reference, amendment, unspsc FROM tender_codes"):
        codes[(r[0], r[1])].add(r[2])
    seen = 0
    with canadabuys_rows.open_csv(path) as fh:
        missing, getters = canadabuys_rows.rows(fh, "tenders", "new.csv")
        assert missing == []
        for get in getters:
            key = (squash(get("reference")), to_int(get("amendment")) or 0)
            row = table[key]
            rec, unspsc, gsins = canadabuys_rows.common_fields(get)
            fields = {**rec, **canadabuys_rows.tender_fields(get, row["buyer_id"])}
            assert {k: row[k] for k in fields} == fields, key
            assert {c for c, _, _ in unspsc} == codes[key], key
            assert [g for g, _, _ in gsins] == (json.loads(row["gsin"]) if row["gsin"] else []), key
            seen += 1
    assert seen == len(rows) == len(table)
    amendments = {ref: amd for ref, amd in table if amd}
    assert amendments == (AMENDED if amended else {})
    # The loader still offers the names other modules and tests import from it.
    assert canadabuys.COLUMNS is canadabuys_rows.COLUMNS and canadabuys.unspsc_code("*81110000") == "8111"


def test_a_file_without_its_key_columns_is_refused_by_both_readers(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text('"title-titre-eng"\n"x"\n', encoding="utf-8")
    with canadabuys_rows.open_csv(path) as fh, pytest.raises(ValueError, match="the layout changed"):
        canadabuys_rows.rows(fh, "tenders", "bad.csv")
    with pytest.raises(ValueError, match="the layout changed"):
        intraday.read_notices(path, intraday.BuyerLookup(), "2026-10-30T15:45:00Z", segments=[])


# -- a refresh row is the open list's row ----------------------------------------------------------


def exported(conn, fixtures, tmp_path):
    """The fixture loaded the way the nightly loads it, and exported for the data date 2026-10-30."""
    buyers.load_seed(conn, buyers.read_seed(), now=DAY)
    canadabuys.load_file(conn, "tenders", fixtures / NEW, "new.csv", now=DAY)
    conn.commit()
    out = tmp_path / "static"
    es.export_static(conn, out, today=date(2026, 10, 30), base_url=BASE)
    return out


def test_a_refresh_row_is_the_row_the_export_lists_for_the_same_notice(conn, fixtures, tmp_path):
    out = exported(conn, fixtures, tmp_path)
    open_rows = {r["reference"]: r for r in json.loads((out / "tenders" / "open.json").read_text(encoding="utf-8"))}
    listed, as_of = intraday.read_listed(out)
    assert as_of == "2026-10-30" and listed
    lookup = intraday.BuyerLookup(intraday.build_lookup(conn, listed, as_of))
    parsed = intraday.read_notices(fixtures / NEW, lookup, "2026-10-30T15:45:00Z")
    assert (parsed.read, parsed.skipped, parsed.closed, parsed.unresolved) == (25, 0, [], 0)
    assert {r["reference"] for r in parsed.rows} == set(open_rows)
    for row in parsed.rows:
        want = open_rows[row["reference"]]
        assert row["amendment"] == want["amendment"]
        assert row["reference_published"] == want.get("reference_published")
        for k in ("title_en", "title_fr", "published", "closing", "notice_type_en", "notice_type_fr", "method_en",
                  "method_fr", "excerpt_en", "excerpt_fr"):
            assert row[k] == want[k], (row["reference"], k)
        for k in ("category", "segments", "provinces", "codes"):
            assert json.loads(row[k]) == want[k], (row["reference"], k)
        assert (row["buyer_id"], row["buyer_name"], row["buyer_name_fr"]) == (want["buyer_id"], want["buyer_en"],
                                                                             want["buyer_fr"])
        assert row["seen_at"] == "2026-10-30T15:45:00Z"
    # A reference a URL cannot carry travels in its URL form with the published one beside it.
    ssc = next(r for r in parsed.rows if r["reference_published"] == "SSC-26-00035339:T")
    assert ssc["reference"] == "SSC-26-00035339-T"
    assert {r["reference"]: r["amendment"] for r in parsed.rows if r["amendment"]} == AMENDED


# -- the buyer lookup ------------------------------------------------------------------------------


def ckan_org(name, en, fr, short_en, short_fr, number="1"):
    return {"name": name, "title": f"{en} | {fr}", "title_translated": {"en": en, "fr": fr},
            "shortform": {"en": short_en, "fr": short_fr}, "department_number": number}


ORGS = [
    ckan_org("ec", "Environment and Climate Change Canada", "Environnement et Changement climatique Canada",
             "ECCC", "ECCC", "99"),
    ckan_org("dfo-mpo", "Fisheries and Oceans Canada", "Pêches et Océans Canada", "DFO", "MPO", "120"),
    ckan_org("ssc-spc", "Shared Services Canada", "Services partagés Canada", "SSC", "SPC", "92"),
    # Two organizations share an English acronym; the French one tells them apart.
    ckan_org("aaa-one", "First Agency", "Première agence", "FA", "PA"),
    ckan_org("aaa-two", "Further Authority", "Autorité suivante", "FA", "AS"),
]
# Spellings a night resolved before the lookup was written: rule 1 finds them again, and the made buyers
# give rule 6 its keys.
EARLIER = [
    ("Fictional Authority (FA)", ""),
    ("Department of Fisheries and Oceans (DFO)", "Ministère des Pêches et des Océans (MPO)"),
    ("Brand New Office of Examples", ""),
]
# Spellings the lookup has never seen, each through a different rule.
PROBES = [
    ("Department of the Environment (ECCC )", "Ministère de l’Environnement (ECCC)"),
    ("Department of Fisheries and Oceans", ""),
    ("FISHERIES AND OCEANS CANADA", ""),
    ("Federal Agency X (FA)", "Agence fédérale X (AS)"),
    ("", "Ministère des Pêches et des Océans (MPO)"),
    ("Shared Services Canada - Gatineau Data Centre", ""),
    ("SSC", ""),
    ("SSC-SPC", ""),
    ("THE FICTIONAL AUTHORITY", ""),
    ("Fictional Authority (FA)", ""),
    ("Brand New Office of Examples - Region 2", ""),
    ("Brand new office of examples", ""),
    ("Auditor General of Canada, Office of the", ""),
    ("Shared Services Canada Attn: Jane Doe", ""),
    ("John Smith", ""),
    ("Contract Administrator", ""),
    ("Attn: Jane Doe", ""),
    ("123 Main Street", ""),
    ("Government of Canada", ""),
    ("N/A", ""),
    ("", ""),
    ("Wholly Unknown Bureau of Testing", ""),
    ("Department of National Defence (DND)", "Ministère de la Défense nationale (MDN)"),
    ("DND Petawawa", ""),
    ("Public Works and Government Services Canada", ""),
    ("Royal Canadian Mounted Police (RCMP)", "Gendarmerie royale du Canada (GRC)"),
    ("Canadian Coast Guard", "Garde côtière canadienne"),
]


def fixture_spellings(fixtures):
    _, rows = read_csv(fixtures / NEW)
    cols = canadabuys_rows.COLUMNS["tenders"]
    return sorted({(r[cols["buyer_en"]], r[cols["buyer_fr"]]) for r in rows})


def test_the_lookup_resolves_every_spelling_as_the_buyers_stage_does(conn, fixtures):
    for org in ORGS:
        buyers.upsert_ckan(conn, org, now=DAY)
    buyers.load_seed(conn, buyers.read_seed(), now=DAY)
    for en, fr in EARLIER:
        buyers.resolve(conn, en, fr, now=DAY)
    conn.commit()
    lookup = intraday.BuyerLookup(intraday.build_lookup(conn, {}, "2026-10-30"))
    existing = {r[0] for r in conn.execute("SELECT id FROM buyers")}
    hits = 0
    for en, fr in PROBES + fixture_spellings(fixtures):
        # The stage's answer, undone after: resolve records the spelling and may make a buyer.
        conn.execute("SAVEPOINT probe")
        try:
            want = buyers.resolve(conn, en, fr, now=DAY)
        finally:
            conn.execute("ROLLBACK TO probe")
            conn.execute("RELEASE probe")
        # Where the stage would make a buyer, the refresh resolves to none.
        want = want if want in existing else None
        assert lookup.resolve(en, fr) == want, (en, fr)
        hits += want is not None
    assert hits >= 15
    # Some answers spelled out: an acronym (rule 3), a key (rule 4), a title in another case (rule 2), the
    # French acronym telling two buyers apart, a buyer made the night before (rule 6), and no buyer for a
    # person, a job title or an address.
    assert lookup.resolve("Department of the Environment (ECCC )") == "ec"
    assert lookup.resolve("Department of Fisheries and Oceans") == "dfo-mpo"
    assert lookup.resolve("FISHERIES AND OCEANS CANADA") == "dfo-mpo"
    assert lookup.resolve("Federal Agency X (FA)", "Agence fédérale X (AS)") == "aaa-two"
    assert lookup.resolve("THE FICTIONAL AUTHORITY") == "fictional-authority"
    for nobody in ("John Smith", "Contract Administrator", "Attn: Jane Doe", "123 Main Street", "N/A"):
        assert lookup.resolve(nobody) is None, nobody


def test_a_row_links_only_a_listed_buyer_and_never_shows_a_persons_name(conn):
    for org in ORGS:
        buyers.upsert_ckan(conn, org, now=DAY)
    conn.commit()
    listed = {"dfo-mpo": ("Fisheries and Oceans Canada", "Pêches et Océans Canada")}
    lookup = intraday.BuyerLookup(intraday.build_lookup(conn, listed, "2026-10-30"))
    assert lookup.buyer("Department of Fisheries and Oceans (DFO)", "Ministère des Pêches et des Océans (MPO)") == (
        "dfo-mpo", "Fisheries and Oceans Canada", "Pêches et Océans Canada")
    # A buyer the export does not list: no link, the spellings as published.
    assert lookup.buyer("Shared Services Canada (SSC)", "Services partagés Canada (SPC)") == (
        None, "Shared Services Canada (SSC)", "Services partagés Canada (SPC)")
    # A miss keeps its spelling; one that names or locates a person is left out.
    assert lookup.buyer("Wholly  Unknown Bureau of Testing", "") == (None, "Wholly Unknown Bureau of Testing", None)
    assert lookup.buyer("Attn: Jane Doe", "Jane Doe") == (None, None, None)
    assert lookup.buyer("", "") == (None, None, None)


def test_the_lookup_file_round_trips_is_deterministic_and_small(conn, fixtures, tmp_path):
    db_path = tmp_path / "awardwatch.sqlite"
    db = connect(db_path)
    out = exported(db, fixtures, tmp_path)
    db.close()
    first, second = tmp_path / "a" / "lookup.json.gz", tmp_path / "b" / "lookup.json.gz"
    for path in (first, second):
        assert intraday.main(["lookup", "--db", str(db_path), "--static", str(out), "--out", str(path)]) == 0
    assert first.read_bytes() == second.read_bytes()
    # The seed and one day's spellings; the full database adds a few thousand spellings.
    assert first.stat().st_size < 32 * 1024
    lookup, state = intraday.BuyerLookup.read(first)
    assert state == "read" and lookup.as_of == "2026-10-30"
    listed = json.loads((out / "buyers" / "index.json").read_text(encoding="utf-8"))["buyers"]
    assert set(lookup.labels) == {b["id"] for b in listed}
    data = json.loads(gzip.decompress(first.read_bytes()))
    assert data["version"] == intraday.LOOKUP_VERSION
    assert set(data) == {"version", "as_of", "spellings", "titles", "acronyms_en", "acronyms_fr", "keys", "made",
                         "buyers"}
    # A lookup that is missing, unreadable or of another version is an empty one: buyers as published.
    assert intraday.BuyerLookup.read(tmp_path / "none.json.gz")[1] == "missing"
    (tmp_path / "bad.json.gz").write_bytes(b"not gzip")
    assert intraday.BuyerLookup.read(tmp_path / "bad.json.gz")[1] == "unreadable"
    (tmp_path / "v2.json.gz").write_bytes(gzip.compress(json.dumps({**data, "version": 2}).encode()))
    other, state = intraday.BuyerLookup.read(tmp_path / "v2.json.gz")
    assert state == "unreadable" and other.labels == {} and other.spellings == {}


# -- the SQL batch ------------------------------------------------------------------------------------


def test_a_batch_applied_twice_leaves_the_same_rows(fixtures, tmp_path):
    db = d1()
    summary, out = run_batch(tmp_path, fixtures / NEW, db, SEEN)
    first = stored(db)
    assert len(first) == 25 and summary["rows_new"] == 25 and summary["rows_updated"] == 0
    assert summary["lookup"] == "missing" and summary["statements"] == 1
    db.executescript((out / "batch.sql").read_text(encoding="utf-8"))
    assert stored(db) == first
    assert {r["seen_at"] for r in first} == {"2026-10-30T15:45:00Z"}
    assert all(r["buyer_id"] is None and r["buyer_name"] for r in first)
    row = next(r for r in first if r["reference"] == "cb-418-22395949")
    assert json.loads(row["provinces"]) == ["ON", "QC"] and json.loads(row["category"])[0] in ("SRV", "GD", "CNST")
    assert row["closing"] == "2026-11-26T14:00:00" and row["published"] == "2026-10-30"
    # The contacts never reach a row.
    text = json.dumps(first)
    assert "contact@example.invalid" not in text


def test_a_later_cut_keeps_when_a_version_was_first_read_and_refreshes_the_rest(fixtures, tmp_path):
    db = d1()
    run_batch(tmp_path, fixtures / NEW, db, SEEN)
    header, rows = read_csv(fixtures / NEW)
    rows[0] = {**rows[0], TITLE: "Retitled by the publisher"}
    later_notice = {**rows[1], REFERENCE: "cb-999-99999999", AMENDMENT: "000"}
    amended = {**rows[2], AMENDMENT: "001", TITLE: "Amended the same afternoon"}
    path = write_csv(tmp_path / "later.csv", header, rows + [later_notice, amended])
    summary, _ = run_batch(tmp_path, path, db, SEEN + timedelta(hours=2), name="later")
    assert (summary["rows_new"], summary["rows_updated"]) == (2, 25)
    after = {(r["reference"], r["amendment"]): r for r in stored(db)}
    assert len(after) == 27
    ref0 = squash(rows[0][REFERENCE])
    assert after[(ref0, 0)]["title_en"] == "Retitled by the publisher"
    assert after[(ref0, 0)]["seen_at"] == "2026-10-30T15:45:00Z"
    assert after[("cb-999-99999999", 0)]["seen_at"] == "2026-10-30T17:45:00Z"
    # The amendment is a version of its own beside the one read first.
    ref2 = squash(rows[2][REFERENCE])
    assert after[(ref2, 1)]["title_en"] == "Amended the same afternoon" and (ref2, 0) in after


def test_a_notice_no_longer_open_is_deleted_with_all_its_versions(fixtures, tmp_path):
    db = d1()
    run_batch(tmp_path, fixtures / NEW, db, SEEN)
    header, rows = read_csv(fixtures / NEW)
    cancelled = {**rows[0], AMENDMENT: "001", STATUS: "Cancelled"}
    path = write_csv(tmp_path / "later.csv", header, rows + [cancelled])
    summary, out = run_batch(tmp_path, path, db, SEEN + timedelta(hours=2), name="later")
    ref0 = squash(rows[0][REFERENCE])
    assert summary["closed"] == 1 and summary["rows_written"] == 24
    assert (out / "batch.sql").read_text(encoding="utf-8").startswith(f"DELETE FROM intraday_tenders WHERE reference IN ('{ref0}');")
    assert ref0 not in {r["reference"] for r in stored(db)} and len(stored(db)) == 24


def test_no_text_in_a_notice_can_break_out_of_its_literal(fixtures, tmp_path):
    header, rows = read_csv(fixtures / NEW)
    payload = "Snow'); DROP TABLE intraday_runs; --\nline two; DELETE FROM intraday_tenders;"
    rows = [{**rows[0], TITLE: payload}]
    db = d1()
    run_batch(tmp_path, write_csv(tmp_path / "x.csv", header, rows), db, SEEN)
    (row,) = stored(db)
    assert row["title_en"] == squash(payload)
    assert db.execute("SELECT COUNT(*) FROM intraday_runs").fetchone()[0] == 0


def test_the_statements_stay_within_the_caps(fixtures, tmp_path):
    header, rows = read_csv(fixtures / NEW)
    many = [{**rows[i % len(rows)], REFERENCE: f"cb-1-{i:08d}"} for i in range(260)]
    parsed = intraday.read_notices(write_csv(tmp_path / "many.csv", header, many), intraday.BuyerLookup(),
                                   "2026-10-30T15:45:00Z", segments=es.read_segments())
    statements = intraday.batch_sql(parsed)
    assert len(statements) == 6
    assert all(len(s.encode("utf-8")) <= intraday.MAX_STATEMENT_BYTES for s in statements)
    small = intraday.upsert_statements(parsed.rows, max_bytes=8 * 1024)
    assert len(small) > 6 and all(len(s.encode("utf-8")) <= 8 * 1024 for s in small)
    db = d1()
    db.executescript("\n".join(statements))
    assert db.execute("SELECT COUNT(*) FROM intraday_tenders").fetchone()[0] == 260


def test_the_refresh_command_writes_the_batch_and_says_how_many_statements(fixtures, tmp_path, monkeypatch):
    db = d1()
    state = tmp_path / "state.json"
    state.write_text(wrangler_answer(db), encoding="utf-8")
    outputs = tmp_path / "github_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(outputs))
    out = tmp_path / "out"
    assert intraday.main(["refresh", "--csv", str(fixtures / NEW), "--lookup", str(tmp_path / "none.json.gz"),
                          "--state", str(state), "--out", str(out), "--now", "2026-10-30T15:45:00Z"]) == 0
    assert outputs.read_text(encoding="utf-8") == "statements=1\n"
    summary = json.loads((out / "refresh.json").read_text(encoding="utf-8"))
    assert summary["rows_read"] == 25 and summary["lookup"] == "missing"
    # An empty cut (the header alone) writes an empty batch, which the workflow does not apply.
    header, _ = read_csv(fixtures / NEW)
    outputs.write_text("", encoding="utf-8")
    assert intraday.main(["refresh", "--csv", str(write_csv(tmp_path / "empty.csv", header, [])), "--state", str(state),
                          "--out", str(tmp_path / "empty")]) == 0
    assert outputs.read_text(encoding="utf-8") == "statements=0\n"
    assert (tmp_path / "empty" / "batch.sql").read_bytes() == b""


# -- the state, the run row and the prune ------------------------------------------------------------


STEPS_UNCHANGED = {"fetch": "success", "lookup": "skipped", "refresh": "skipped", "apply": "skipped"}
STEPS_APPLIED = {"fetch": "success", "lookup": "success", "refresh": "success", "apply": "success"}


def test_the_run_row_says_what_happened():
    unchanged = {"changed": False, "status": 304, "etag": '"e1"', "last_modified": "Mon, 02 Nov 2026 03:15:06 GMT"}
    row = intraday.run_row("7-1", "2026-11-02T03:45:30Z", unchanged, None, STEPS_UNCHANGED)
    assert (row["ok"], row["rows_read"], row["file_etag"]) == (1, 0, '"e1"')
    assert row["detail"] == "unchanged since the last run (304)"
    changed = {"changed": True, "status": 200, "etag": '"e2"', "last_modified": "Mon, 02 Nov 2026 13:15:06 GMT"}
    summary = {"rows_read": 30, "rows_new": 5, "rows_updated": 25, "closed": 1, "skipped": 0, "unresolved": 2,
               "lookup": "read", "lookup_as_of": "2026-11-02", "statements": 2}
    row = intraday.run_row("8-1", "2026-11-02T13:45:30Z", changed, summary, STEPS_APPLIED)
    assert (row["ok"], row["rows_read"], row["rows_new"], row["rows_updated"]) == (1, 30, 5, 25)
    assert row["detail"] == ("30 rows read: 5 new, 25 read again, 1 no longer open, 0 without a reference; "
                             "2 with a buyer as published (no listed buyer); lookup 2026-11-02")
    # Nothing to apply is a run that went through.
    empty = {**summary, "rows_read": 0, "rows_new": 0, "rows_updated": 0, "statements": 0}
    assert intraday.run_row("9-1", "x", changed, empty, {**STEPS_APPLIED, "apply": "skipped"})["ok"] == 1
    # A failed step: ok 0 and its name, so the next run fetches the file again.
    failed = intraday.run_row("10-1", "x", changed, summary, {**STEPS_APPLIED, "apply": "failure"})
    assert failed["ok"] == 0 and failed["detail"] == "failed at apply; the next run fetches the file again"
    no_refresh = intraday.run_row("11-1", "x", changed, None, {**STEPS_APPLIED, "refresh": "failure", "apply": "skipped"})
    assert no_refresh["ok"] == 0 and no_refresh["detail"].startswith("failed at refresh")
    no_fetch = intraday.run_row("12-1", "x", None, None, {**STEPS_APPLIED, "fetch": "failure"})
    assert no_fetch["ok"] == 0 and no_fetch["detail"] == "the new notices file could not be fetched"
    no_lookup = intraday.run_row("13-1", "x", changed, None, {**STEPS_APPLIED, "lookup": "failure", "refresh": "skipped"})
    assert no_lookup["detail"].startswith("failed at lookup")


def test_the_next_run_sends_the_validators_of_the_newest_run_that_went_through(tmp_path):
    db = d1()
    assert intraday.read_state(wrangler_answer(db)) == intraday.State()
    good = intraday.run_row("1-1", "2026-11-02T11:45:30Z", {"changed": True, "etag": '"good"', "last_modified": "L1"},
                            {"rows_read": 3, "rows_new": 3, "rows_updated": 0, "statements": 1}, STEPS_APPLIED)
    bad = intraday.run_row("2-1", "2026-11-02T13:45:30Z", {"changed": True, "etag": '"bad"', "last_modified": "L2"},
                           {"rows_read": 4, "statements": 1}, {**STEPS_APPLIED, "apply": "failure"})
    for row in (good, bad, good):
        db.executescript(intraday.run_sql(row))
    assert db.execute("SELECT COUNT(*) FROM intraday_runs").fetchone()[0] == 2
    db.execute("INSERT INTO intraday_tenders (reference, amendment, seen_at) VALUES ('cb-1', 0, 'x'), ('cb-1', 2, 'x')")
    state = intraday.read_state(wrangler_answer(db))
    assert (state.etag, state.last_modified, state.keys) == ('"good"', "L1", {("cb-1", 0), ("cb-1", 2)})
    with pytest.raises(ValueError):
        intraday.read_state("wrangler: authentication error")


def test_the_record_command_writes_one_upsert(tmp_path):
    fetched = tmp_path / "fetch.json"
    fetched.write_text(json.dumps({"changed": False, "status": 304, "etag": '"e"', "last_modified": "L"}), encoding="utf-8")
    out = tmp_path / "run.sql"
    assert intraday.main(["record", "--run-id", "41-2", "--fetch", str(fetched), "--refresh", str(tmp_path / "none.json"),
                          "--step", "fetch=success", "--step", "lookup=skipped", "--step", "refresh=skipped",
                          "--step", "apply=skipped", "--out", str(out), "--now", "2026-11-02T03:45:30Z"]) == 0
    db = d1()
    db.executescript(out.read_text(encoding="utf-8"))
    db.executescript(out.read_text(encoding="utf-8"))
    (row,) = [dict(r) for r in db.execute("SELECT * FROM intraday_runs")]
    assert row == {"id": "41-2", "at": "2026-11-02T03:45:30Z", "file_last_modified": "L", "file_etag": '"e"',
                   "rows_read": 0, "rows_new": 0, "rows_updated": 0, "ok": 1,
                   "detail": "unchanged since the last run (304)"}


def test_the_prune_deletes_rows_first_read_more_than_two_days_ago(tmp_path):
    db = d1()
    now = datetime(2026, 11, 2, 12, 40, tzinfo=timezone.utc)
    for ref, seen in (("old", now - timedelta(days=2, minutes=1)), ("kept", now - timedelta(days=1, hours=23))):
        db.execute("INSERT INTO intraday_tenders (reference, amendment, seen_at) VALUES (?, 0, ?)", (ref, intraday.stamp(seen)))
    for rid, at in (("r-old", now - timedelta(days=31)), ("r-kept", now - timedelta(days=29))):
        db.execute("INSERT INTO intraday_runs (id, at, ok) VALUES (?, ?, 1)", (rid, intraday.stamp(at)))
    out = tmp_path / "prune.sql"
    assert intraday.main(["prune", "--out", str(out), "--now", "2026-11-02T12:40:00Z"]) == 0
    db.executescript(out.read_text(encoding="utf-8"))
    assert [r[0] for r in db.execute("SELECT reference FROM intraday_tenders")] == ["kept"]
    assert [r[0] for r in db.execute("SELECT id FROM intraday_runs")] == ["r-kept"]
    assert out.read_text(encoding="utf-8") == (
        "DELETE FROM intraday_tenders WHERE seen_at < '2026-10-31T12:40:00Z';\n"
        "DELETE FROM intraday_runs WHERE at < '2026-10-03T12:40:00Z';\n")


# -- the fetch ---------------------------------------------------------------------------------------------


def test_the_fetch_is_conditional_and_a_304_downloads_nothing(fake_client, tmp_path, fixtures):
    client = fake_client({intraday.NEW_URL: FakeResponse(304)})
    state = intraday.State(etag='"e1"', last_modified="Mon, 02 Nov 2026 03:15:06 GMT")
    got = intraday.fetch(client, state, tmp_path)
    assert got == {"changed": False, "status": 304, "etag": '"e1"', "last_modified": "Mon, 02 Nov 2026 03:15:06 GMT",
                   "size": 0}
    assert not (tmp_path / intraday.CSV_NAME).exists()
    (url, headers), = client.fake_session.calls
    assert url == "https://canadabuys.canada.ca/opendata/pub/newTenderNotice-nouvelAvisAppelOffres.csv"
    assert headers["If-None-Match"] == '"e1"' and headers["If-Modified-Since"] == "Mon, 02 Nov 2026 03:15:06 GMT"
    assert headers["User-Agent"].startswith("AwardWatch/")
    body = (fixtures / NEW).read_bytes()
    client = fake_client({intraday.NEW_URL: FakeResponse(200, body, {"ETag": '"e2"', "Last-Modified": "L2"})})
    got = intraday.fetch(client, intraday.State(), tmp_path)
    assert got == {"changed": True, "status": 200, "etag": '"e2"', "last_modified": "L2", "size": len(body)}
    assert (tmp_path / intraday.CSV_NAME).read_bytes() == body
    (_, headers), = client.fake_session.calls
    assert "If-None-Match" not in headers and "If-Modified-Since" not in headers


# -- the search sync and the schema --------------------------------------------------------------------


def test_the_search_sync_never_names_the_intraday_tables():
    reset = search_db.reset_sql()
    for name in intraday.TABLES:
        assert name not in reset, name
    assert not {t.name for t in search_db.TABLES} & set(intraday.TABLES)
    assert "intraday" not in search_db.SCHEMA_PATH.read_text(encoding="utf-8")


def test_the_schema_only_creates_and_matches_what_the_refresh_writes():
    sql = "\n".join(line.split("--", 1)[0] for line in SCHEMA.read_text(encoding="utf-8").splitlines())
    statements = [s.strip() for s in sql.split(";") if s.strip()]
    assert all(re.match(r"CREATE (TABLE|INDEX) IF NOT EXISTS ", s) for s in statements), statements
    db = d1()
    assert tuple(r[1] for r in db.execute(f"PRAGMA table_info({intraday.TABLE})")) == intraday.COLUMNS
    assert tuple(r[1] for r in db.execute(f"PRAGMA table_info({intraday.RUNS})")) == intraday.RUN_COLUMNS
    # Applied twice, it changes nothing.
    db.executescript(SCHEMA.read_text(encoding="utf-8"))


# -- the workflow ----------------------------------------------------------------------------------------


def step(text: str, name: str) -> str:
    return text.split(f"- name: {name}", 1)[1].split("\n      - ", 1)[0]


def cron_hours(expr: str) -> set[int]:
    minute, hours, *_ = expr.split()
    assert minute == "45"
    span, _, every = hours.partition("/")
    first, _, last = span.partition("-")
    return set(range(int(first), int(last or first) + 1, int(every or 1)))


def test_the_workflow_runs_after_every_cut_in_both_halves_of_the_year():
    text = WORKFLOW.read_text(encoding="utf-8")
    crons = re.findall(r'- cron: "([^"]+)"', text)
    assert crons == ["45 11-23/2 * * *", "45 1-3/2 * * *"]
    hours = set().union(*(cron_hours(c) for c in crons))
    # The cuts, 06:15 to 22:15 Ottawa time every two hours, in UTC: +5 h in winter, +4 h in summer.
    for offset, wait in ((5, 30), (4, 90)):
        for local in range(6, 23, 2):
            cut = (local + offset) * 60 + 15
            run = cut + wait
            assert (run // 60) % 24 in hours and run % 60 == 45, (offset, local)
    assert "workflow_dispatch:" in text


def test_the_workflow_has_its_own_group_a_short_timeout_and_no_database():
    text = WORKFLOW.read_text(encoding="utf-8")
    code = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    assert "concurrency:\n  group: intraday\n  cancel-in-progress: false" in text
    assert "group: nightly" not in code
    assert "timeout-minutes: 10" in code and code.count("timeout-minutes:") == 1
    assert "permissions:\n  contents: read\n" in text and "write" not in code.split("jobs:", 1)[0].split("permissions:", 1)[1]
    # No restore, no database, no backup, no status, no deploy, no commit.
    for absent in ("restore", "awardwatch.sqlite", "nightly ", "status.json", "wrangler deploy", "git ", "r2 object put",
                   "secrets.CLOUDFLARE_SITE_DEPLOY_TOKEN", "GH_TOKEN"):
        assert absent not in code, absent
    assert set(re.findall(r"secrets\.([A-Z_]+)", code)) == {"CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"}
    assert chr(0x2014) not in text


def test_every_r2_and_d1_command_reaches_the_remote_store():
    text = WORKFLOW.read_text(encoding="utf-8")
    commands = [line.strip() for line in text.splitlines()
                if not line.lstrip().startswith("#") and re.search(r"\b(r2 object|d1 execute)\b", line)]
    assert len(commands) == 4
    for line in commands:
        # The site's pinned Wrangler, and the remote store.
        assert re.search(r'"\$WRANGLER" (r2 object get|d1 execute) ', line) and " --remote " in line, line
    assert "npx wrangler" not in text


def test_the_workflow_runs_the_steps_in_order_on_the_right_conditions():
    text = WORKFLOW.read_text(encoding="utf-8")
    names = [line.strip()[len("- name: "):] for line in text.splitlines() if line.strip().startswith("- name: ")]
    order = ["Install the pipeline", "Install the site's tools", "Read the last run from the search database",
             "Fetch the new notices file when it changed", "Fetch the buyer lookup from R2",
             "Parse the notices and write the upserts", "Apply the upserts to the search database", "Record the run"]
    assert [n for n in names if n in order] == order
    state = step(text, "Read the last run from the search database")
    assert f'"$WRANGLER" d1 execute awardwatch-search --remote --json --command "{intraday.STATE_SQL}" > "$OUT/state.json"' in state
    assert "working-directory: site" in state
    fetch = step(text, "Fetch the new notices file when it changed")
    assert 'python -m awardwatch_pipeline.intraday fetch --state "$OUT/state.json" --out "$OUT"' in fetch
    # The state read's own outcome, not the job's state: after a read that failed under continue-on-error the job
    # is still a success, and nothing after the read may run.
    assert "if: ${{ steps.gate.outputs.active == 'true' && steps.state.outcome == 'success' }}" in fetch
    lookup = step(text, "Fetch the buyer lookup from R2")
    assert "if: ${{ steps.gate.outputs.active == 'true' && steps.fetch.outputs.changed == 'true' }}" in lookup
    assert f'r2 object get --remote "$BUCKET/{intraday.LOOKUP_KEY}" --file "$OUT/lookup.json.gz"' in lookup
    assert 'grep -qi "specified key does not exist"' in lookup
    refresh = step(text, "Parse the notices and write the upserts")
    assert "if: ${{ steps.gate.outputs.active == 'true' && steps.fetch.outputs.changed == 'true' }}" in refresh
    assert "python -m awardwatch_pipeline.intraday refresh --csv \"$OUT/new.csv\" --lookup \"$OUT/lookup.json.gz\"" in refresh
    apply = step(text, "Apply the upserts to the search database")
    # The parse's own outcome, not the job's state: after a parse that failed under continue-on-error the job is
    # still a success, and a missing or partial batch must not be applied.
    assert ("steps.fetch.outputs.changed == 'true' && steps.refresh.outcome == 'success' "
            "&& steps.refresh.outputs.statements != '0'") in apply
    assert '"$WRANGLER" d1 execute awardwatch-search --remote --yes --file "$OUT/batch.sql"' in apply
    record = step(text, "Record the run")
    assert "if: ${{ !cancelled() && steps.gate.outputs.active == 'true' && steps.state.outcome == 'success' }}" in record
    # By outcome: a step that failed under continue-on-error has the conclusion "success".
    for name in ("fetch", "lookup", "refresh", "apply"):
        assert f'--step "{name}=${{{{ steps.{name}.outcome }}}}"' in record, name
    assert ".conclusion" not in text
    assert record.index("intraday record") < record.index('--file "$OUT/run.sql"')
    assert "RUN_ID: ${{ github.run_id }}-${{ github.run_attempt }}" in record


# -- a failed cut is a row, not a red run; the gate on the paid plan -------------------------------------


def steps_of(text: str) -> list[dict[str, str]]:
    """The job's steps in order, each as its own keys (name or uses, id, if, continue-on-error), read at the
    step's indentation so a comment or a line of a run block never counts."""
    body = text.split("\n    steps:\n", 1)[1]
    out = []
    for chunk in ("\n" + body).split("\n      - ")[1:]:
        first, *rest = chunk.splitlines()
        key, _, value = first.partition(": ")
        keys = {key: value}
        for line in rest:
            m = re.match(r"^        ([a-z-]+): (.+)$", line)
            if m:
                keys[m.group(1)] = m.group(2)
        out.append(keys)
    return out


STATUS_CHECKS = ("!cancelled()", "always()", "success()")


def holds(condition: str | None, job: dict) -> bool:
    """A step's condition as GitHub evaluates the forms this workflow uses: terms joined by &&, each a status
    check or steps.<id>.outcome or steps.<id>.outputs.<name> compared with == or != to a quoted text. With no
    status check in it (or no condition), GitHub puts success() in front: no earlier step failed outside
    continue-on-error. A form outside these fails the test, so the evaluator is extended rather than misread."""
    if not condition:
        return not job["failed"]
    assert condition.startswith("${{ ") and condition.endswith(" }}"), condition
    terms = [t.strip() for t in condition[4:-3].split("&&")]
    if not any(t in STATUS_CHECKS for t in terms):
        terms.insert(0, "success()")
    for term in terms:
        if term in ("!cancelled()", "always()"):
            continue
        if term == "success()":
            if job["failed"]:
                return False
            continue
        m = re.fullmatch(r"steps\.(\w+)\.(outcome|outputs\.(\w+)) (==|!=) '([^']*)'", term)
        assert m, term
        sid, what, output, op, want = m.groups()
        have = job["outcomes"].get(sid, "") if what == "outcome" else job["outputs"].get(sid, {}).get(output, "")
        if (have == want) != (op == "=="):
            return False
    return True


def simulate(text: str, *, fail: tuple[str, ...] = (), active: bool = True, changed: str = "true",
             statements: str = "2") -> dict:
    """One run of the job: which steps run, each id's outcome, and whether the job ends red. A step in fail
    (by id or name) fails; a step that succeeds sets the outputs the job reads (the gate's active, the fetch's
    changed, the parse's statement count). A step that fails sets none, as the commands write theirs last."""
    job = {"failed": False, "outcomes": {}, "outputs": {}, "ran": []}
    sets = {"gate": {"active": "true"} if active else {}, "fetch": {"changed": changed},
            "refresh": {"statements": statements}}
    for s in steps_of(text):
        label, sid = s.get("name") or s.get("uses"), s.get("id")
        if not holds(s.get("if"), job):
            if sid:
                job["outcomes"][sid] = "skipped"
            continue
        job["ran"].append(label)
        failed = sid in fail or label in fail
        if sid:
            job["outcomes"][sid] = "failure" if failed else "success"
            if not failed:
                job["outputs"][sid] = sets.get(sid, {})
        if failed and s.get("continue-on-error") != "true":
            job["failed"] = True
    return job


def recorded(job: dict) -> dict | None:
    """The run row the record step writes for a simulated run, or None when it did not run."""
    if "Record the run" not in job["ran"]:
        return None
    o = job["outcomes"]
    fetched = {"changed": job["outputs"]["fetch"]["changed"] == "true", "etag": '"e"', "last_modified": "L"} \
        if o.get("fetch") == "success" else None
    refreshed = {"rows_read": 3, "rows_new": 1, "rows_updated": 2,
                 "statements": int(job["outputs"]["refresh"]["statements"])} if o.get("refresh") == "success" else None
    steps = {name: o.get(name, "") for name in ("fetch", "lookup", "refresh", "apply")}
    return intraday.run_row("1-1", "2026-11-03T13:45:30Z", fetched, refreshed, steps)


def test_a_failed_cut_is_a_row_and_the_run_stays_green():
    text = WORKFLOW.read_text(encoding="utf-8")
    flagged = [s.get("id") or s.get("name") or s.get("uses") for s in steps_of(text) if s.get("continue-on-error") == "true"]
    assert flagged == ["state", "fetch", "lookup", "refresh", "apply"]
    clean = simulate(text)
    assert not clean["failed"] and recorded(clean)["ok"] == 1
    # Each of the four steps failing: green, the record still runs, ok 0 and the step named; the steps that
    # need the failed one's output are skipped, the batch is never applied after a failed parse.
    for name, detail, skipped in (
        ("fetch", "the new notices file could not be fetched", {"lookup", "refresh", "apply"}),
        ("lookup", "failed at lookup; the next run fetches the file again", set()),
        ("refresh", "failed at refresh; the next run fetches the file again", {"apply"}),
        ("apply", "failed at apply; the next run fetches the file again", set()),
    ):
        job = simulate(text, fail=(name,))
        assert not job["failed"], name
        assert {k for k, v in job["outcomes"].items() if v == "skipped"} == skipped, name
        row = recorded(job)
        assert row is not None and (row["ok"], row["detail"]) == (0, detail), name
    # An unchanged file and an empty cut go through with nothing to apply.
    for kw in ({"changed": "false"}, {"statements": "0"}):
        job = simulate(text, **kw)
        assert not job["failed"] and job["outcomes"]["apply"] == "skipped" and recorded(job)["ok"] == 1, kw
    # The search database unreadable (down, or its binding wrong): green with no row, and nothing after the state
    # read runs, the record included (a run that cannot read D1 cannot write its row there either).
    labels = [s.get("name") or s.get("uses") for s in steps_of(text)]
    after = labels[labels.index("Read the last run from the search database") + 1:]
    job = simulate(text, fail=("state",))
    assert not job["failed"] and recorded(job) is None
    assert job["ran"] == labels[:len(labels) - len(after)] and not set(job["ran"]) & set(after)
    assert {job["outcomes"][sid] for sid in ("fetch", "lookup", "refresh", "apply")} == {"skipped"}
    # Red only when the run cannot run at all, and then no row: an install, the checkout, the secrets.
    for name in ("Install the pipeline", "Install the site's tools", "actions/checkout@v4",
                 "Check that the Cloudflare secrets exist"):
        job = simulate(text, fail=(name,))
        assert job["failed"] and recorded(job) is None, name
    # A record that cannot be written is red too: it is the one place the failure would show.
    assert simulate(text, fail=("Record the run",))["failed"]


def test_the_refresh_runs_only_while_a_paid_plan_is_live():
    text = WORKFLOW.read_text(encoding="utf-8")
    steps = steps_of(text)
    labels = [s.get("name") or s.get("uses") for s in steps]
    # Right after the secrets check (missing secrets stay a red run; read by the gate they would look like no
    # plan), before the checkout and the installs, so a run for nobody costs seconds.
    assert labels[:3] == ["Check that the Cloudflare secrets exist", "Check for a live paid plan", "actions/checkout@v4"]
    assert steps[1]["id"] == "gate" and "if" not in steps[1] and "continue-on-error" not in steps[1]
    for s in steps[2:]:
        assert (s.get("if") or "").startswith("${{ ") and "steps.gate.outputs.active == 'true'" in s["if"], s
    # No live plan, or a count that cannot be read (the gate writes no output either way): green, no row.
    idle = simulate(text, active=False)
    assert idle["ran"] == labels[:2] and not idle["failed"] and recorded(idle) is None
    gate = step(text, "Check for a live paid plan")
    code = "\n".join(line for line in gate.splitlines() if not line.lstrip().startswith("#"))
    # The accounts database by the ACCOUNTS binding's id, through the D1 REST API with curl (no Wrangler yet).
    wrangler = (REPO / "site" / "wrangler.jsonc").read_text(encoding="utf-8")
    binding = re.search(r'"binding": "ACCOUNTS",\s*"database_name": "awardwatch-accounts",\s*"database_id": "([0-9a-f-]+)"',
                        wrangler)
    assert binding and f"      ACCOUNTS_DATABASE_ID: {binding.group(1)}\n" in text
    assert ('"https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$ACCOUNTS_DATABASE_ID/query"'
            in code)
    assert '-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"' in code and "curl -s " in code and "WRANGLER" not in code
    # The statement is the site's LIVE_PRO_SQL, planFromRows' window rule, word for word.
    ts = (REPO / "site" / "src" / "account" / "entitlements.ts").read_text(encoding="utf-8")
    live = re.search(r'export const LIVE_PRO_SQL =\s*"([^"]+)";', ts)
    assert live and live.group(1) == ("SELECT COUNT(*) AS n FROM entitlements WHERE plan = 'pro' AND revoked_at IS NULL "
                                      "AND starts_at <= ?1 AND (ends_at IS NULL OR ends_at > ?1)")
    assert f'LIVE_PRO_SQL: "{live.group(1)}"' in gate
    # The one parameter, the current UTC instant as toISOString writes it, since the rows' times compare as text.
    assert "at=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" in code
    assert """jq -cn --arg sql "$LIVE_PRO_SQL" --arg at "$at" '{sql: $sql, params: [$at]}'""" in code
    # A count above zero is the only way on; the step itself never fails, and the count is never printed (the
    # run logs of a public repository are public).
    assert code.count('echo "active=true" >> "$GITHUB_OUTPUT"') == 2 and "exit 1" not in code
    assert not re.search(r"echo [^\n]*\$\{?n\b", code) and "cat " not in code
    assert code.index('elif [ "$n" = "0" ]; then') < code.rindex('echo "active=true" >> "$GITHUB_OUTPUT"')
    # A manual run can force it: a boolean input, off by default, read before the request.
    dispatch = text.split("  workflow_dispatch:\n", 1)[1].split("\n\n", 1)[0]
    assert dispatch.startswith("    inputs:\n      force:\n") and "type: boolean" in dispatch and "default: false" in dispatch
    assert "FORCE: ${{ inputs.force }}" in gate
    assert code.index('if [ "$FORCE" = "true" ]; then') < code.index('echo "active=true" >> "$GITHUB_OUTPUT"') \
        < code.index("curl -s ")
