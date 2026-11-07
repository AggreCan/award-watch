"""The sosa stage: PSPC's weekly file of standing offers and supply arrangements, its holders and their history.

The fixture is six rows under the data dictionary's headers, every name
invented: a regional master standing offer held by two firms (one of them in
two regions) and by a person, a supply arrangement held by a firm with no
profile, and a national master standing offer whose solicitation stem the
notices below share. Each test writes the weeks it needs from it.
"""

import csv
import json
import re
import sqlite3
from pathlib import Path

import pytest

from awardwatch_pipeline import cli, organizations, records_db, sosa_export
from awardwatch_pipeline.db import get_meta
from awardwatch_pipeline.normalize import norm_name, org_id
from awardwatch_pipeline.sources import sosa
from awardwatch_pipeline.sources.contracts import LayoutError
from conftest import FakeResponse

REPO = Path(__file__).resolve().parents[2]
FIXTURE = "sosa_head.csv"
NOW = "2026-10-31T01:00:00Z"
DAY = "2026-10-31"
RMSO = "E60ZT-120002/001/ZT"
SA = "E60ZT-120003/001/ZT"
NMSO = "EZ899-250380/001/ZM"
EXEMPLAR = "Exemplar Environmental Consulting Ltd."
COASTAL = "Coastal Geomatics Limited"
NORTHERN = "Northern Survey Inc."


def oid(name: str) -> str:
    return org_id(norm_name(name))


def read_csv(path: Path) -> tuple[list[str], list[dict]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        return list(reader.fieldnames or []), list(reader)


def week(fixtures: Path, tmp_path: Path, published: str, *, drop=lambda r: False, add: tuple[dict, ...] = (),
         rows: list[dict] | None = None) -> Path:
    """The fixture as published on another date, rows dropped or added."""
    header, base = read_csv(fixtures / FIXTURE)
    out = [{**r, "date-file-published": published} for r in (rows if rows is not None else base) if not drop(r)]
    out += [{**base[0], **extra, "date-file-published": published} for extra in add]
    path = tmp_path / f"sosa-{published}-{len(out)}.csv"
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=header, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(out)
    return path


def profiles(conn: sqlite3.Connection, *names: str) -> None:
    for name in names:
        organizations.upsert(conn, name, source="awards", now=NOW)
    conn.commit()


def holders(conn: sqlite3.Connection) -> dict[tuple, dict]:
    return {(r["agreement_number"], r["supplier_raw"] or r["supplier_norm"][:7], r["delivery_point_code"]): dict(r)
            for r in conn.execute("SELECT * FROM sosa_holders")}


def apply_week(conn, path: Path, today: str = DAY) -> sosa.LoadResult:
    result = sosa.load_file(conn, path, today=today)
    sosa.upkeep(conn, today)
    return result


def events(conn) -> list[tuple]:
    return [tuple(r) for r in conn.execute("SELECT kind, day, ref, oid, region, endd, why FROM sosa_events ORDER BY id")]


# -- the columns and the key ------------------------------------------------------------


def test_the_dictionarys_columns_map_onto_the_instruments_and_holders(conn, fixtures):
    profiles(conn, EXEMPLAR, COASTAL)
    result = apply_week(conn, fixtures / FIXTURE)
    assert (result.state, result.published, result.rows, result.holders, result.instruments, result.withheld) == (
        "applied", "2026-10-30", 6, 6, 3, 1)
    inst = dict(conn.execute("SELECT * FROM sosa_instruments WHERE agreement_number = ?", (RMSO,)).fetchone())
    assert {k: inst[k] for k in ("type_en", "type_fr", "description_en", "description_fr", "commodity", "commodity_en",
                                 "commodity_fr", "end_user_en", "end_user_fr", "start", "expiry", "first_seen",
                                 "last_seen", "n_holders", "n_holders_withheld", "expiry_changes")} == {
        "type_en": "Regional Master Standing Offer", "type_fr": "Offre à commandes principale régionale",
        "description_en": "Environmental consulting services",
        "description_fr": "Services d'experts-conseils en environnement", "commodity": "R109C",
        "commodity_en": "Environmental consulting services",
        "commodity_fr": "Services d'experts-conseils en environnement",
        "end_user_en": "Public Services and Procurement Canada",
        "end_user_fr": "Services publics et Approvisionnement Canada", "start": "2024-04-01", "expiry": "2028-03-31",
        "first_seen": "2026-10-30", "last_seen": "2026-10-30", "n_holders": 3, "n_holders_withheld": 1,
        "expiry_changes": 0,
    }
    rows = holders(conn)
    bc = rows[(RMSO, EXEMPLAR, "BC")]
    # The ISO 3166-2 code loses its CA- prefix; the region's names travel beside it.
    assert {k: bc[k] for k in ("supplier_norm", "operating_name", "standardized_name", "delivery_point_en",
                               "delivery_point_fr", "organization_id", "supplier_withheld", "first_seen",
                               "missing_files", "lost_on")} == {
        "supplier_norm": norm_name(EXEMPLAR), "operating_name": "Exemplar Enviro",
        "standardized_name": "EXEMPLAR ENVIRONMENTAL CONSULTING", "delivery_point_en": "British Columbia",
        "delivery_point_fr": "Colombie-Britannique", "organization_id": oid(EXEMPLAR), "supplier_withheld": 0,
        "first_seen": "2026-10-30", "missing_files": 0, "lost_on": None,
    }
    # A firm with no profile is kept unlinked: the stage never creates an organization.
    assert rows[(SA, NORTHERN, "NA")]["organization_id"] is None
    assert conn.execute("SELECT COUNT(*) FROM organizations WHERE id = ?", (oid(NORTHERN),)).fetchone()[0] == 0
    assert sosa.type_code("Regional Master Standing Offer") == "RMSO" and sosa.type_code("Supply Arrangement") == "SA"
    assert sosa.type_code("National Master Standing Offer") == "NMSO" and sosa.type_code("Something new") == "OTHER"


def test_the_key_is_the_agreement_the_legal_name_and_the_region(conn, fixtures, tmp_path):
    header, base = read_csv(fixtures / FIXTURE)
    # The same supplier, instrument and region twice in one file is one row; a spelling that normalizes
    # alike is the same holder.
    twice = week(fixtures, tmp_path, "2026-10-30", add=({"supplier-legal-name": "EXEMPLAR ENVIRONMENTAL CONSULTING LTD"},))
    apply_week(conn, twice)
    keys = {(r[0], r[1], r[2]) for r in conn.execute(
        "SELECT agreement_number, supplier_norm, delivery_point_code FROM sosa_holders")}
    assert len(keys) == 6
    assert (RMSO, norm_name(EXEMPLAR), "BC") in keys and (RMSO, norm_name(EXEMPLAR), "AB") in keys
    # Two regions, one holder: the instrument counts suppliers, and a profile counts agreement numbers.
    assert conn.execute("SELECT n_holders FROM sosa_instruments WHERE agreement_number = ?", (RMSO,)).fetchone()[0] == 3
    assert sosa.stem(RMSO) == "e60zt-120002" and sosa.stem(" ez899-250380 /A") == "ez899-250380"
    assert sosa.stem("AB-1/2") is None
    assert sosa.fold(" e60zt-120002 / 001 / zt") == sosa.fold(RMSO)
    assert sosa.region_code("CA-qc") == "QC" and sosa.region_code("NC") == "NC" and sosa.region_code("") == ""


def test_a_person_is_withheld_counted_and_never_stored(conn, fixtures, tmp_path, out_dir):
    profiles(conn, EXEMPLAR)
    client = None
    samples = tmp_path / "samples"
    samples.mkdir()
    (samples / sosa.SPEC.sample_name).write_bytes((fixtures / FIXTURE).read_bytes())
    result = sosa.run(conn, client, now=NOW, samples=samples)
    person = [r for r in holders(conn).values() if r["supplier_withheld"]]
    assert len(person) == 1
    row = person[0]
    assert row["supplier_norm"].startswith("person:") and row["supplier_raw"] is None
    assert row["operating_name"] is None and row["standardized_name"] is None and row["organization_id"] is None
    # No column of any table the stage writes holds the name.
    dump = "\n".join(str(tuple(r)) for t in ("sosa_holders", "sosa_instruments", "sosa_events", "sosa_callups", "meta")
                     for r in conn.execute(f"SELECT * FROM {t}"))
    assert "Doucette" not in dump and "doucette" not in dump.casefold()
    # The count is kept, the review list (never published) has the name, the log only the count.
    assert conn.execute("SELECT n_holders_withheld FROM sosa_instruments WHERE agreement_number = ?", (RMSO,)).fetchone()[0] == 1
    assert "Jane Doucette" in (out_dir / "review" / "sosa-persons.txt").read_text(encoding="utf-8")
    log = conn.execute("SELECT detail, notice FROM sources_log WHERE source = 'sosa'").fetchone()
    assert "Doucette" not in (log["detail"] + (log["notice"] or "")) and "withheld=1" in log["detail"]
    assert result.load is not None and result.load.withheld == 1
    # Nor does it reach the records database or the static files.
    rows = list(sosa_export.holder_rows(conn, records_db.key_of, records_db.org_number))
    assert len(rows) == 5 and "Doucette" not in json.dumps(rows)
    assert "Doucette" not in json.dumps(sosa_export.index_doc(conn, DAY)) + json.dumps(sosa_export.organization_parts(conn))


# -- gains and losses -----------------------------------------------------------------


def test_a_row_absent_once_is_not_lost_and_absent_twice_is(conn, fixtures, tmp_path):
    profiles(conn, EXEMPLAR, COASTAL)
    apply_week(conn, fixtures / FIXTURE)
    no_coastal = lambda r: r["supplier-legal-name"] == COASTAL  # noqa: E731
    apply_week(conn, week(fixtures, tmp_path, "2026-11-06", drop=no_coastal), "2026-11-07")
    row = holders(conn)[(RMSO, COASTAL, "BC")]
    assert (row["missing_files"], row["lost_on"], row["last_seen"]) == (1, None, "2026-10-30")
    assert conn.execute("SELECT n_holders FROM sosa_instruments WHERE agreement_number = ?", (RMSO,)).fetchone()[0] == 3
    apply_week(conn, week(fixtures, tmp_path, "2026-11-13", drop=no_coastal), "2026-11-14")
    row = holders(conn)[(RMSO, COASTAL, "BC")]
    assert (row["missing_files"], row["lost_on"], row["lost_why"]) == (2, "2026-11-13", "absent")
    assert conn.execute("SELECT n_holders FROM sosa_instruments WHERE agreement_number = ?", (RMSO,)).fetchone()[0] == 2
    assert events(conn) == [(13, "2026-11-13", f"sosa:{RMSO}", oid(COASTAL), "BC", "2028-03-31", "absent")]
    # The organization it lapsed from lists it under "no longer held".
    part = sosa_export.organization_parts(conn)[oid(COASTAL)]
    assert part["n"] == 0 and [r["agreement"] for r in part["lapsed"]] == [RMSO]
    assert part["lapsed"][0]["lost_on"] == "2026-11-13"
    # Back in a later file: held again, no new event; a row missing once and back resets its count.
    apply_week(conn, week(fixtures, tmp_path, "2026-11-20"), "2026-11-21")
    row = holders(conn)[(RMSO, COASTAL, "BC")]
    assert (row["missing_files"], row["lost_on"], row["last_seen"]) == (0, None, "2026-11-20")
    assert len(events(conn)) == 1


def test_an_expiry_that_passed_is_a_loss(conn, fixtures, tmp_path):
    profiles(conn, EXEMPLAR, NORTHERN)
    apply_week(conn, fixtures / FIXTURE)
    # One file only: the loss is marked but no event is written (lost events start after the second file).
    sosa.upkeep(conn, "2027-01-01")
    row = holders(conn)[(SA, NORTHERN, "NA")]
    assert (row["lost_on"], row["lost_why"]) == ("2027-01-01", "expired")
    assert events(conn) == []
    assert SA not in {r["agreement_number"] for r in sosa.active_instruments(conn)}


def test_an_expiry_passing_after_the_second_file_is_reported(conn, fixtures, tmp_path):
    profiles(conn, EXEMPLAR, NORTHERN)
    apply_week(conn, fixtures / FIXTURE)
    apply_week(conn, week(fixtures, tmp_path, "2026-11-06"), "2026-11-07")
    sosa.upkeep(conn, "2027-01-01")
    assert events(conn) == [(13, "2027-01-01", f"sosa:{SA}", oid(NORTHERN), "NA", "2026-12-31", "expired")]
    # A lost row is kept LOST_KEEP_DAYS days, then deleted with an instrument left without rows.
    sosa.upkeep(conn, "2027-04-02")
    assert (SA, NORTHERN, "NA") not in holders(conn)
    assert conn.execute("SELECT COUNT(*) FROM sosa_instruments WHERE agreement_number = ?", (SA,)).fetchone()[0] == 0


def test_the_first_load_writes_no_gained_events_and_the_second_does(conn, fixtures, tmp_path):
    profiles(conn, EXEMPLAR, COASTAL)
    first = apply_week(conn, fixtures / FIXTURE)
    assert first.gained == 0 and events(conn) == []
    assert get_meta(conn, sosa.META_FIRST) == "2026-10-30"
    second = apply_week(conn, week(fixtures, tmp_path, "2026-11-06", add=(
        {"supplier-legal-name": COASTAL, "delivery-point-code": "CA-AB", "delivery-point_en": "Alberta"},
        # A firm with no profile gains too, but no organization can watch it, so it has no event.
        {"supplier-legal-name": "Unlisted Labs Corp.", "delivery-point-code": "CA-AB"},
    )), "2026-11-07")
    assert second.gained == 2
    assert events(conn) == [(12, "2026-11-06", f"sosa:{RMSO}", oid(COASTAL), "AB", "2028-03-31", None)]
    # The file applied again changes nothing.
    again = sosa.load_file(conn, week(fixtures, tmp_path, "2026-11-06", add=(
        {"supplier-legal-name": COASTAL, "delivery-point-code": "CA-AB"},)), today="2026-11-08")
    assert again.state == "same publication" and len(events(conn)) == 1


def test_a_moved_expiry_is_counted_for_the_calendar(conn, fixtures, tmp_path):
    apply_week(conn, fixtures / FIXTURE)
    header, base = read_csv(fixtures / FIXTURE)
    moved = [{**r, "expiry-date": "2029-03-31"} if r["agreement-number"] == RMSO else r for r in base]
    apply_week(conn, week(fixtures, tmp_path, "2026-11-06", rows=moved), "2026-11-07")
    row = conn.execute("SELECT expiry, expiry_changes FROM sosa_instruments WHERE agreement_number = ?", (RMSO,)).fetchone()
    assert tuple(row) == ("2029-03-31", 1)


def test_a_fall_of_more_than_thirty_percent_is_held_and_marks_nothing_lost(conn, fixtures, tmp_path, monkeypatch):
    profiles(conn, EXEMPLAR, COASTAL)
    apply_week(conn, fixtures / FIXTURE)
    before = holders(conn)
    short = week(fixtures, tmp_path, "2026-11-06", drop=lambda r: r["agreement-number"] == RMSO)
    result = apply_week(conn, short, "2026-11-07")
    assert result.state == "held" and (result.holders, result.previous_rows) == (2, 6)
    assert holders(conn) == before
    assert get_meta(conn, sosa.META_HELD) == "2026-11-06" and get_meta(conn, sosa.META_PUBLISHED) == "2026-10-30"
    # Released by the operator: the same file is applied.
    release = tmp_path / "release.txt"
    release.write_text("2026-11-06\n", encoding="utf-8")
    result = sosa.load_file(conn, short, today="2026-11-08", release_path=release)
    assert result.state == "applied" and get_meta(conn, sosa.META_HELD) is None
    assert holders(conn)[(RMSO, COASTAL, "BC")]["missing_files"] == 1


def test_a_file_without_a_required_column_is_refused(conn, fixtures, tmp_path):
    header, base = read_csv(fixtures / FIXTURE)
    path = tmp_path / "bad.csv"
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=[h for h in header if h != "supplier-legal-name"], extrasaction="ignore")
        writer.writeheader()
        writer.writerows(base)
    with pytest.raises(LayoutError, match="supplier-legal-name"):
        sosa.load_file(conn, path, today=DAY)


# -- the joins ------------------------------------------------------------------------


def notice(conn, table: str, ref: str, sol: str | None, published: str, codes: tuple[str, ...], number: str | None = None):
    if table == "tenders":
        conn.execute("INSERT INTO tenders (reference, amendment, solicitation, published, source_file, first_seen, last_seen) "
                     "VALUES (?, 0, ?, ?, 'f.csv', ?, ?)", (ref, sol, published, published, published))
        conn.executemany("INSERT INTO tender_codes (reference, amendment, unspsc) VALUES (?, 0, ?)", [(ref, c) for c in codes])
    else:
        conn.execute("INSERT INTO awards (reference, amendment, solicitation, contract_number, published, source_file, "
                     "first_seen, last_seen) VALUES (?, 0, ?, ?, ?, 'f.csv', ?, ?)", (ref, sol, number, published, published, published))
        conn.executemany("INSERT INTO award_codes (reference, amendment, unspsc) VALUES (?, 0, ?)", [(ref, c) for c in codes])


def test_the_stem_join_to_the_notices_sets_segments_and_the_tender_reference(conn, fixtures):
    notice(conn, "tenders", "cb-100-1", "EZ899-250380/A", "2024-01-10", ("80111600",))
    notice(conn, "tenders", "cb-100-2", "ez899-250380 /B", "2025-03-01", ("80111620",))
    notice(conn, "awards", "cb-400-1", None, "2025-06-01", ("43211500", "99999999"), number="EZ899-250380/001/ZM")
    # A notice of another solicitation shares nothing.
    notice(conn, "tenders", "cb-100-3", "EZ899-250381/A", "2025-03-01", ("72101500",))
    conn.commit()
    apply_week(conn, fixtures / FIXTURE)
    rows = {r["agreement_number"]: r for r in conn.execute("SELECT * FROM sosa_instruments")}
    assert json.loads(rows[NMSO]["segments"]) == ["43", "80"]
    # The newest tender notice of the stem is the one the instrument page links.
    assert (rows[NMSO]["solicitation"], rows[NMSO]["tender_reference"]) == ("ez899-250380", "cb-100-2")
    # No notice shares the others' stems: no segment, listed under "no segment".
    assert rows[RMSO]["segments"] is None and rows[RMSO]["tender_reference"] is None
    by_stem = sosa_export.tender_instruments(conn)
    assert [i["agreement"] for i in by_stem["ez899-250380"]] == [NMSO]


def contract(conn, ref: str, number: str | None, vendor: str | None, day: str, value: float, withheld: int = 0):
    conn.execute("INSERT INTO contracts (owner_org, reference, vendor_raw, vendor_withheld, contract_date, value, original_value, "
                 "instrument_type, standing_offer_number, organization_id, loaded_at) VALUES ('dnd-mdn', ?, ?, ?, ?, ?, ?, 'C', ?, ?, ?)",
                 (ref, vendor, withheld, day, value, value, number, oid(vendor) if vendor else None, NOW))


def test_call_ups_are_the_published_contracts_naming_the_folded_number(conn, fixtures):
    profiles(conn, EXEMPLAR, COASTAL, "Other Firm Inc.")
    contract(conn, "C-1", "e60zt-120002/001/zt", EXEMPLAR, "2026-05-01", 120_000)
    contract(conn, "C-2", " E60ZT-120002 / 001 / ZT", EXEMPLAR, "2019-05-01", 30_000.5)
    contract(conn, "C-3", "E60ZT-120002/001/ZT", "Other Firm Inc.", "2025-07-01", 10_000)
    contract(conn, "C-4", "E60ZT-120002/001/ZT", None, "2025-07-01", 5_000, withheld=1)
    # Before the ten fiscal years (2017-18 is the first), another instrument, no number at all.
    contract(conn, "C-5", "E60ZT-120002/001/ZT", EXEMPLAR, "2017-03-31", 999)
    contract(conn, "C-6", "E60ZT-120003/001/ZT", COASTAL, "2026-05-01", 7)
    contract(conn, "C-7", None, COASTAL, "2026-05-01", 7)
    conn.commit()
    apply_week(conn, fixtures / FIXTURE)
    calls = {(r[0], r[1]): tuple(r[2:]) for r in conn.execute(
        "SELECT agreement_number, organization_id, n, value, n_no_value FROM sosa_callups")}
    assert calls == {
        (RMSO, oid(EXEMPLAR)): (2, 150_000.5, 0),
        # A vendor that holds no row on the instrument, or a person, counts under the instrument alone.
        (RMSO, ""): (2, 15_000, 0),
        (SA, ""): (1, 7, 0),
    }
    assert sosa.fiscal_start("2026-10-31", 10) == "2017-04-01" and sosa.fiscal_start("2027-02-01", 10) == "2017-04-01"
    # The records row carries them in cents, the holders' first.
    rows = {r[1]: r for r in sosa_export.instrument_rows(conn, records_db.key_of, records_db.org_number, lambda ref: ref)}
    assert json.loads(rows[RMSO][-1]) == [[records_db.org_number(oid(EXEMPLAR)), 2, 15_000_050, 0], [None, 2, 1_500_000, 0]]


# -- the stage ------------------------------------------------------------------------


def test_the_stage_reads_the_file_with_the_shared_machinery_and_a_failure_keeps_the_rows(conn, fixtures, fake_client, tmp_path):
    profiles(conn, EXEMPLAR)
    body = (fixtures / FIXTURE).read_bytes()
    client = fake_client({sosa.SPEC.url: FakeResponse(200, body, {"ETag": '"v1"'})}, max_attempts=1)
    result = sosa.run(conn, client, now=NOW, work_dir=tmp_path)
    assert result.state == "read" and result.load.state == "applied"
    log = conn.execute("SELECT ok, detail FROM sources_log WHERE source = 'sosa'").fetchone()
    assert log["ok"] == 1 and log["detail"].startswith("read published=2026-10-30 file_rows=6 file=applied instruments=3")
    assert "resolved=3" in log["detail"] and "with_segments=0" in log["detail"]
    assert get_meta(conn, "sosa:etag") == '"v1"'
    # Within the hours between checks the file is not asked for.
    assert sosa.run(conn, client, now="2026-10-31T10:00:00Z", work_dir=tmp_path).state == "not due"
    before = holders(conn)
    # A host that fails: the rows stand, nothing counts as absent, and the stage fails so the run status says so.
    broken = fake_client({sosa.SPEC.url: FakeResponse(404)}, max_attempts=1)
    with pytest.raises(Exception, match="404"):
        sosa.run(conn, broken, now="2026-11-07T01:00:00Z", work_dir=tmp_path)
    assert holders(conn) == before
    assert sosa.stage_outcome(conn) == "ok"  # the failure's row is the CLI's (cli._stage), written after this raises


def test_a_held_file_is_read_again_until_it_is_released(conn, fixtures, fake_client, tmp_path):
    body = (fixtures / FIXTURE).read_bytes()
    first = fake_client({sosa.SPEC.url: body}, max_attempts=1)
    sosa.run(conn, first, now=NOW, work_dir=tmp_path)
    short = week(fixtures, tmp_path, "2026-11-06", drop=lambda r: r["agreement-number"] == RMSO).read_bytes()
    second = fake_client({sosa.SPEC.url: short}, max_attempts=1)
    result = sosa.run(conn, second, now="2026-11-07T01:00:00Z", work_dir=tmp_path)
    assert result.state.startswith("held:") and "held for review" in " ".join(result.notices)
    # The copy is forgotten, so tomorrow's run reads it again rather than calling it unchanged.
    assert get_meta(conn, "sosa:sha256") is None and get_meta(conn, sosa.SPEC.loaded_key) is None
    assert sosa.stage_outcome(conn) == "held"


def test_the_stage_runs_after_the_organizations_stage(conn):
    assert cli.STAGES.index("sosa") == cli.STAGES.index("organizations") + 1
    assert cli.STAGES.index("sosa") > cli.STAGES.index("history")


# -- what the site reads ----------------------------------------------------------------


def test_the_export_and_the_records_rows(conn, fixtures):
    profiles(conn, EXEMPLAR, COASTAL)
    notice(conn, "awards", "cb-400-1", "EZ899-250380/A", "2025-06-01", ("43211500",))
    conn.execute("INSERT INTO buyers (id, name_en, name_fr, updated_at) VALUES ('pwgsc-tpsgc', "
                 "'Public Services and Procurement Canada', 'Services publics et Approvisionnement Canada', ?)", (NOW,))
    conn.commit()
    apply_week(conn, fixtures / FIXTURE)
    doc = sosa_export.index_doc(conn, DAY)
    assert (doc["published"], doc["as_of"]) == ("2026-10-30", DAY)
    # Soonest expiry first.
    assert [r["agreement"] for r in doc["rows"]] == [SA, NMSO, RMSO]
    rmso = doc["rows"][2]
    assert {k: rmso[k] for k in ("type", "regions", "segments", "n_holders", "n_holders_withheld", "end_user")} == {
        "type": "RMSO", "regions": ["AB", "BC"], "segments": [], "n_holders": 3, "n_holders_withheld": 1,
        "end_user": "pwgsc-tpsgc"}
    assert doc["end_users"]["pwgsc-tpsgc"]["buyer_id"] == "pwgsc-tpsgc"
    assert doc["rows"][0]["end_user"] == "n:all-government-departments"
    assert doc["types"]["SA"] == {"en": "Supply arrangement", "fr": "Arrangement en matière d'approvisionnement"}
    assert rmso["commodity"] == ["R109C"] and doc["commodities"]["R109C"]["en"] == "Environmental consulting services"
    part = sosa_export.organization_parts(conn)[oid(EXEMPLAR)]
    assert part["n"] == 2 and [(r["agreement"], r["regions"]) for r in part["rows"]] == [(NMSO, ["NC"]), (RMSO, ["AB", "BC"])]
    assert sosa_export.segment_holders(conn)["43"] == {
        "n": 1, "rows": [{"id": oid(EXEMPLAR), "name": EXEMPLAR, "n": 1, "soonest": "2027-06-30"}]}
    buyer = sosa_export.buyer_holders(conn)["pwgsc-tpsgc"]
    assert [(r["id"], r["n"], r["soonest"]) for r in buyer["rows"]] == [(oid(EXEMPLAR), 2, "2027-06-30"), (oid(COASTAL), 1, "2028-03-31")]
    assert sosa_export.instrument_path(RMSO) == "/instruments/E60ZT-120002%2F001%2FZT"
    assert ("/instruments/E60ZT-120002%2F001%2FZT", "2026-10-30") in sosa_export.sitemap_entries(conn, DAY)
    # The records rows, in the column order the sync writes.
    rows = list(sosa_export.instrument_rows(conn, records_db.key_of, records_db.org_number, lambda ref: ref))
    assert all(len(r) == len(records_db.INSTRUMENTS.written) for r in rows) and len(rows) == 3
    by = {r[1]: dict(zip(records_db.INSTRUMENTS.written, r)) for r in rows}
    assert {k: by[NMSO][k] for k in ("segs", "n", "nw", "buyer", "seen", "last")} == {
        "segs": " 43 ", "n": 1, "nw": 0, "buyer": "pwgsc-tpsgc", "seen": "2026-10-30", "last": "2026-10-30"}
    hrows = list(sosa_export.holder_rows(conn, records_db.key_of, records_db.org_number))
    assert all(len(r) == len(records_db.HOLDERS.written) for r in hrows)
    assert {r[1] for r in hrows} <= {by[a]["k"] for a in by}


# -- the layout of the current file --------------------------------------------------------
# The file as published in 2026 departs from the data
# dictionary: the type is its acronym, the commodity column holds UNSPSC
# codes and the descriptions their names, each in literal quotes, and the
# delivery point codes include CA, RCNNCR and countries. The review of
# 2026-11-07 found every row of /instruments typed "NISO", the codes printed
# in their quotes and the region filter in raw codes. The rows below copy
# that layout; every name is invented.

NISO = "CW0000001"
NMSO_LIVE = "CW0000002"
OTHER_LIVE = "CW0000003"
MARINE_EN = '"25111900 - Marine craft systems and subassemblies; 81100000 - Professional engineering services"'
MARINE_FR = '"25111900 - Systèmes et sous-ensembles pour embarcations; 81100000 - Services d\'ingénierie professionnelle"'


def live_week(fixtures: Path, tmp_path: Path) -> Path:
    _, base = read_csv(fixtures / FIXTURE)
    first = {**base[0], "supplier-operating-name": "", "supplier-standardized-name": ""}
    niso = {**first, "agreement-number": NISO, "agreement-type_en": "NISO", "agreement-type_fr": "OCIN",
            "commodity": '"25111900; 81100000"', "commodity-description_en": MARINE_EN, "commodity-description_fr": MARINE_FR,
            "sosa-description_en": "Marine engine monitoring parts and service", "sosa-description_fr": ""}
    nmso = {**first, "agreement-number": NMSO_LIVE, "agreement-type_en": '"NMSO"', "agreement-type_fr": "OCPN",
            "supplier-legal-name": COASTAL, "commodity": '"43230000"', "commodity-description_en": '"43230000 - Software"',
            "commodity-description_fr": '"43230000 - Logiciels"'}
    other = {**first, "agreement-number": OTHER_LIVE, "agreement-type_en": "Framework agreement",
             "agreement-type_fr": "Accord-cadre", "commodity": "", "commodity-description_en": "", "commodity-description_fr": "",
             "delivery-point-code": "CA-ON", "delivery-point_en": "Ontario", "delivery-point_fr": "Ontario"}
    rows = [
        {**niso, "delivery-point-code": "RCN-NCR", "delivery-point_en": '"National Capital Region"',
         "delivery-point_fr": "Région de la capitale nationale"},
        {**niso, "delivery-point-code": "CA-BC", "delivery-point_en": "British Columbia", "delivery-point_fr": "Colombie-Britannique"},
        {**nmso, "delivery-point-code": "CA", "delivery-point_en": "Canada", "delivery-point_fr": "Canada"},
        {**nmso, "delivery-point-code": "US", "delivery-point_en": "United States", "delivery-point_fr": "États-Unis"},
        other,
    ]
    return week(fixtures, tmp_path, "2026-10-30", rows=rows)


def test_the_current_files_acronyms_quotes_and_region_codes_reach_the_site_as_names(conn, fixtures, tmp_path):
    profiles(conn, EXEMPLAR, COASTAL)
    apply_week(conn, live_week(fixtures, tmp_path))
    # The stage keeps the codes clean and whole, the names without the file's quotes.
    inst = conn.execute("SELECT type_en, commodity, commodity_en FROM sosa_instruments WHERE agreement_number = ?", (NISO,)).fetchone()
    assert tuple(inst) == ("NISO", "25111900; 81100000", MARINE_EN.strip('"'))
    rows = holders(conn)
    assert rows[(NISO, EXEMPLAR, "RCNNCR")]["delivery_point_en"] == "National Capital Region"
    assert {k[2] for k in rows if k[0] == NMSO_LIVE} == {"CA", "US"}

    doc = sosa_export.index_doc(conn, DAY)
    by = {r["agreement"]: r for r in doc["rows"]}
    # Each type is its own code, named in both languages; a type the stage does not know keeps the file's words.
    assert [by[a]["type"] for a in (NISO, NMSO_LIVE, OTHER_LIVE)] == ["NISO", "NMSO", "OTHER"]
    assert doc["types"] == {"NISO": {"en": "National individual standing offer", "fr": "Offre à commandes individuelle nationale"},
                            "NMSO": {"en": "National master standing offer", "fr": "Offre à commandes principale et nationale"}}
    assert (by[OTHER_LIVE]["type_en"], by[OTHER_LIVE]["type_fr"]) == ("Framework agreement", "Accord-cadre")
    assert "type_en" not in by[NISO]
    # The commodity is the list of codes, each named once; no value keeps a quote.
    assert by[NISO]["commodity"] == ["25111900", "81100000"] and by[OTHER_LIVE]["commodity"] == []
    assert doc["commodities"]["81100000"] == {"en": "Professional engineering services", "fr": "Services d'ingénierie professionnelle"}
    assert doc["commodities"]["43230000"] == {"en": "Software", "fr": "Logiciels"}
    # The file's own name for each delivery point code, for the codes the site does not name itself.
    assert doc["region_names"]["RCNNCR"] == {"en": "National Capital Region", "fr": "Région de la capitale nationale"}
    assert doc["region_names"]["US"] == {"en": "United States", "fr": "États-Unis"}
    assert doc["region_names"]["CA"] == {"en": "Canada", "fr": "Canada"}
    assert sorted(by[NISO]["regions"]) == ["BC", "RCNNCR"]
    shown = json.dumps({k: doc[k] for k in ("types", "commodities", "region_names")}, ensure_ascii=False)
    assert '\\"' not in shown and not any('"' in c for r in doc["rows"] for c in r["commodity"])

    # The profile and the records rows carry the names too, and the records row the codes and their names.
    part = sosa_export.organization_parts(conn)[oid(EXEMPLAR)]
    assert {r["agreement"]: r["type_en"] for r in part["rows"]}[NISO] == "National individual standing offer"
    rec = {r[1]: dict(zip(records_db.INSTRUMENTS.written, r))
           for r in sosa_export.instrument_rows(conn, records_db.key_of, records_db.org_number, lambda ref: ref)}
    assert {k: rec[NISO][k] for k in ("type_en", "type_fr", "gsin", "gsin_en", "gsin_fr")} == {
        "type_en": "National individual standing offer", "type_fr": "Offre à commandes individuelle nationale",
        "gsin": "25111900; 81100000",
        "gsin_en": "25111900 - Marine craft systems and subassemblies; 81100000 - Professional engineering services",
        "gsin_fr": "25111900 - Systèmes et sous-ensembles pour embarcations; 81100000 - Services d'ingénierie professionnelle"}
    assert (rec[OTHER_LIVE]["type_en"], rec[OTHER_LIVE]["gsin"]) == ("Framework agreement", None)


def test_the_type_commodity_and_quote_rules():
    assert [sosa.type_code(t) for t in ("NISO", '"RMSO"', "Supply Arrangement (SA)", "National Individual Standing Offer",
                                         "Regional Master Standing Offer", "Standing offer", "")] == [
        "NISO", "RMSO", "SA", "NISO", "RMSO", "OTHER", "OTHER"]
    assert sosa.type_names("RISO", None) == sosa.TYPES["RISO"]
    assert sosa.type_names('"Framework agreement"', "Accord-cadre") == ("Framework agreement", "Accord-cadre")
    assert sosa.unquote(' "National Capital Region" ') == "National Capital Region"
    assert sosa.commodity_codes('"43230000; 81112200"') == ["43230000", "81112200"]
    assert sosa.commodity_codes("N7010") == ["N7010"] and sosa.commodity_codes(None) == []
    # A value cut short (the stage once kept 40 characters) loses the empty piece, not a code.
    assert sosa.commodity_codes('"39121000; 41100000; 41110000; 41120000;') == ["39121000", "41100000", "41110000", "41120000"]
    # A semicolon inside a name stays in it; a lone code's plain description is its name.
    assert sosa.commodity_names(["11111111", "22222222"], '"11111111 - Nuts; bolts; 22222222 - Washers"') == {
        "11111111": "Nuts; bolts", "22222222": "Washers"}
    assert sosa.commodity_names(["R109C"], "Environmental consulting services") == {"R109C": "Environmental consulting services"}
    assert sosa.commodity_names(["11111111", "22222222"], "Hardware") == {}


def test_a_commodity_stored_in_the_files_quotes_reads_clean_tonight(conn, fixtures):
    """The file is applied once a week: the codes stored before the stage cleaned them read clean from the next export."""
    apply_week(conn, fixtures / FIXTURE)
    conn.execute("UPDATE sosa_instruments SET commodity = ?, commodity_en = ? WHERE agreement_number = ?",
                 ('"39121000; 41100000; 41110000; 41120000;', '"39121000 - Power conditioning equipment; 41100000 - Laboratory '
                  'and scientific equipment"', RMSO))
    conn.commit()
    doc = sosa_export.index_doc(conn, DAY)
    rmso = {r["agreement"]: r for r in doc["rows"]}[RMSO]
    assert rmso["commodity"] == ["39121000", "41100000", "41110000", "41120000"]
    assert doc["commodities"]["41100000"]["en"] == "Laboratory and scientific equipment"
    assert doc["commodities"]["41110000"] == {"en": None, "fr": None}


def test_the_records_sync_carries_the_instruments(conn, fixtures, tmp_path):
    apply_week(conn, fixtures / FIXTURE)
    manifest = records_db.sync(conn, tmp_path / "records", today=DAY, static_dir=tmp_path / "static")
    assert manifest["expected"]["rec_instruments"] == 3 and manifest["expected"]["rec_holders"] == 5
    db = sqlite3.connect(":memory:")
    db.executescript(records_db.SCHEMA_PATH.read_text(encoding="utf-8"))
    for name in manifest["batches"]:
        db.executescript((tmp_path / "records" / name).read_text(encoding="utf-8"))
    assert db.execute("SELECT agr, n, nw FROM rec_instruments WHERE agr = ?", (RMSO,)).fetchone() == (RMSO, 3, 1)
    assert db.execute("SELECT COUNT(*) FROM rec_holders h JOIN rec_instruments i ON i.k = h.ik WHERE i.agr = ?",
                      (RMSO,)).fetchone()[0] == 3


def test_the_site_names_only_the_tables_and_columns_the_records_schema_creates():
    db = sqlite3.connect(":memory:")
    db.executescript(records_db.SCHEMA_PATH.read_text(encoding="utf-8"))
    ts = (REPO / "site" / "src" / "instruments.ts").read_text(encoding="utf-8")
    columns = {t: {r[1] for r in db.execute(f"PRAGMA table_info({t})")} for t in ("rec_instruments", "rec_holders", "rec_meta")}
    for table in set(re.findall(r"\b(?:FROM|JOIN) (rec_\w+)\b", ts)):
        assert table in columns, table
    aliases = {"i": "rec_instruments", "h": "rec_holders"}
    for alias, column in set(re.findall(r"\b([ih])\.([a-z_]+)\b", ts)):
        assert column in columns[aliases[alias]], f"{alias}.{column}"
