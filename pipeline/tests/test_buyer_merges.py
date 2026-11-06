"""Buyer merges: one institution under one buyer id, whatever spelling, former name or CKAN twin it came in under.

The adversarial buyer's walkthrough of 2026-11-05 found National Defence under
five buyer ids, "Parks Canada" beside "Parks Canada Agency", and the lobbying
load's 27 made institutions, one of them a buyer "other" for the registry's
"Other (Specify)". These tests hold the rules of sources/buyers.merge, the
alias seed (awardwatch_pipeline/data/buyer_aliases.csv), the totals and the
records database after a merge, the export's redirects and "Also appears as"
names, and the search rows.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from awardwatch_pipeline import expiring, indicators, intraday, organizations
from awardwatch_pipeline import export_static as es
from awardwatch_pipeline import records_db as rd
from awardwatch_pipeline import search_db as sd
from awardwatch_pipeline.db import set_meta
from awardwatch_pipeline.sources import buyers, lobbying
from export_seed import NORTH, STAMP, TODAY, award, seed, tender

BASE = "https://awardwatch.example"
NOW = "2026-11-06T12:30:00Z"
LATER = "2026-11-07T12:30:00Z"


def ckan(conn: sqlite3.Connection, bid: str, en: str, fr: str, a_en: str, a_fr: str, number: str | None = "1") -> None:
    buyers.upsert_ckan(conn, {"name": bid, "title_translated": {"en": en, "fr": fr},
                              "shortform": {"en": a_en, "fr": a_fr}, "department_number": number}, now=STAMP)


def made(conn: sqlite3.Connection, bid: str, en: str, fr: str | None, spellings: list[tuple[str, str]],
         kind: str | None = None) -> None:
    """A buyer an earlier night made by rule 6, with the spellings it was recorded under."""
    conn.execute("INSERT INTO buyers (id, name_en, name_fr, kind, updated_at) VALUES (?, ?, ?, ?, ?)",
                 (bid, en, fr, kind, STAMP))
    conn.executemany("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, ?, ?)",
                     [(raw, source, bid) for raw, source in spellings])


def history(conn: sqlite3.Connection, ref: str, client: str, raw: str, value: float) -> None:
    conn.execute(
        "INSERT INTO contract_history (reference, amendment, title_en, awarded, amount, total_value, currency, status, "
        "competitive, supplier_raw, organization_id, buyer_id, client_id, client_raw_en, source_file, first_seen, "
        "last_seen) VALUES (?, 0, 'Services', '2026-06-01', ?, ?, 'CAD', 'active', 1, ?, ?, 'pwgsc-tpsgc', ?, ?, "
        "'history.csv', ?, ?)",
        (ref, value, value, NORTH, organizations.upsert(conn, NORTH, source="history"), client, raw, STAMP, STAMP))


def contract(conn: sqlite3.Connection, owner: str, ref: str, value: float) -> None:
    conn.execute(
        "INSERT INTO contracts (owner_org, reference, procurement_id, vendor_raw, buyer_id, contract_date, value, "
        "original_value, description_en, solicitation_procedure, competitive, instrument_type, organization_id, "
        "loaded_at) VALUES (?, ?, ?, ?, ?, '2025-11-12', ?, ?, 'Hearing room', 'TC', 1, 'C', ?, ?)",
        (owner, ref, f"P-{ref}", NORTH, owner, value, value, organizations.upsert(conn, NORTH, source="contracts"), STAMP))


def grant(conn: sqlite3.Connection, owner: str, ref: str, value: float) -> None:
    conn.execute(
        "INSERT INTO grants (owner_org, reference, amendment, agreement_type, recipient_type, legal_name, country, "
        "province, city, program_en, title_en, value, start, end, buyer_id, organization_id, loaded_at) "
        "VALUES (?, ?, 0, 'G', 'N', ?, 'CA', 'ON', 'Ottawa', 'Research', 'Study', ?, '2026-04-01', '2027-03-31', ?, ?, ?)",
        (owner, ref, NORTH, value, owner, organizations.upsert(conn, NORTH, source="grants"), STAMP))


def lobbying_report(conn: sqlite3.Connection, comm: str, ids: list[str], institutions: list[str]) -> None:
    conn.execute("INSERT INTO lobbying_communications (comm_number, comm_date, institutions, buyer_ids, loaded_at) "
                 "VALUES (?, '2026-05-05', ?, ?, ?)", (comm, json.dumps(institutions), json.dumps(ids), STAMP))


# The buyer ids the walkthrough's state retires, and where each goes.
RETIRED = {
    "department-of-national-defense": "dnd-mdn",
    "national-defense-headquarters": "dnd-mdn",
    "parks-canada-agency": "pc",
    "revenue-canada": "cra-arc",
    "tatc-tatc": "tatc",
}


@pytest.fixture
def walk(conn):
    """The export seed (dnd-mdn and pwgsc-tpsgc with records in every source) plus what the walkthrough saw: made
    buyers for two more spellings of National Defence, for Parks Canada's legal name and for a former name, a CKAN
    organization listed twice, the registry's junk "other" and an institution only the registry names."""
    seed(conn)
    set_meta(conn, "data_as_of", TODAY.isoformat())
    ckan(conn, "pc", "Parks Canada", "Parcs Canada", "PC", "PC")
    ckan(conn, "cra-arc", "Canada Revenue Agency", "Agence du revenu du Canada", "CRA", "ARC")
    ckan(conn, "tatc", "Transportation Appeal Tribunal of Canada", "Tribunal d'appel des transports du Canada",
         "TATC", "TATC", "96")
    ckan(conn, "tatc-tatc", "Transportation Appeal Tribunal of Canada", "Tribunal d'appel des transports du Canada",
         "TATC", "TATC", None)
    made(conn, "department-of-national-defense", "Department of National Defense", None,
         [("Department of National Defense", "canadabuys")])
    # The French half of the pair resolves to nothing by itself, which kept the old rule from merging it.
    made(conn, "national-defense-headquarters", "National Defense Headquarters", "QG Défense nationale",
         [("National Defense Headquarters", "canadabuys"), ("QG Défense nationale", "canadabuys")])
    made(conn, "parks-canada-agency", "Parks Canada Agency", "Agence Parcs Canada",
         [("Parks Canada Agency", "canadabuys"), ("Agence Parcs Canada", "canadabuys")])
    made(conn, "revenue-canada", "Revenue Canada", None, [("Revenue Canada", "lobbying")])
    made(conn, "other", "Other", None, [("Other (Specify)", "lobbying")])
    made(conn, "members-of-the-house-of-commons", "Members of the House of Commons", None,
         [("Members of the House of Commons", "lobbying")])
    made(conn, "office-of-the-senate-ethics-officer", "Office of the Senate Ethics Officer", None,
         [("Office of the Senate Ethics Officer", "lobbying")])

    award(conn, "AW-D1", 0, NORTH, value=500_000.0, buyer="department-of-national-defense")
    award(conn, "AW-D2", 0, NORTH, value=30_000.0, buyer="national-defense-headquarters", awarded="2025-08-01")
    conn.execute("UPDATE awards SET buyer_raw_en = 'Department of National Defense' WHERE reference = 'AW-D1'")
    conn.execute("UPDATE awards SET buyer_raw_en = 'National Defense Headquarters', buyer_raw_fr = 'QG Défense nationale' "
                 "WHERE reference = 'AW-D2'")
    history(conn, "H-D1", "department-of-national-defense", "Department of National Defense", 70_000.0)
    tender(conn, "cb-900-9", 0, title="Hangar roof", buyer="department-of-national-defense", closing="2026-11-20T14:00:00")
    award(conn, "AW-P0", 0, NORTH, value=1_000.0, buyer="pc")
    award(conn, "AW-P1", 0, NORTH, value=57_100_000.0, buyer="parks-canada-agency")
    conn.execute("UPDATE awards SET buyer_raw_en = 'Parks Canada Agency' WHERE reference = 'AW-P1'")
    award(conn, "AW-R1", 0, NORTH, value=2_000.0, buyer="cra-arc")
    # The twin CKAN lists without a department number holds published contracts and grants.
    contract(conn, "tatc", "T-1", 20_000.0)
    contract(conn, "tatc-tatc", "T-2", 45_000.0)
    grant(conn, "tatc-tatc", "TG-1", 8_000.0)
    lobbying_report(conn, "L-2", ["other", "dnd-mdn"], ["Other (Specify)", "National Defence"])
    lobbying_report(conn, "L-3", ["revenue-canada"], ["Revenue Canada"])
    lobbying_report(conn, "L-4", ["members-of-the-house-of-commons"], ["Members of the House of Commons"])
    conn.commit()
    organizations.recompute(conn, now=STAMP)
    indicators.compute(conn, now=STAMP)
    expiring.compute(conn, today=TODAY, now=STAMP)
    conn.commit()
    return conn


def night(conn: sqlite3.Connection, now: str = NOW, **kwargs) -> dict[str, int]:
    """The buyers stage and the stages after it that rebuild what the export reads."""
    result = buyers.run(conn, None, now=now, offline=True, **kwargs)
    organizations.recompute(conn, now=now)
    indicators.compute(conn, now=now)
    expiring.compute(conn, today=TODAY, now=now)
    conn.commit()
    return result


# -- the alias seed ------------------------------------------------------------------------


def test_the_committed_alias_seed_keeps_its_rules():
    rows = buyers.read_aliases()
    assert rows and all(set(r) == set(buyers.ALIAS_COLUMNS) for r in rows)
    by_alias = {r["alias"]: r for r in rows}
    for alias, target in (("Department of National Defense", "dnd-mdn"), ("National Defense Headquarters", "dnd-mdn"),
                          ("DND", "dnd-mdn"), ("Parks Canada Agency", "pc"), ("Agence Parcs Canada", "pc")):
        assert by_alias[alias]["buyer_id"] == target, alias
    for alias, target in (("Revenue Canada", "cra-arc"), ("HRSDC", "esdc-edsc"),
                          ("Human Resources and Skills Development Canada", "esdc-edsc")):
        assert (by_alias[alias]["buyer_id"], by_alias[alias]["note"]) == (target, "former"), alias
    assert {r["alias"] for r in rows if r["note"] == "placeholder"} == {"Other (Specify)", "Autre (Préciser)"}
    # Every row says why; no line of the file carries an em-dash.
    assert all(r["why"] for r in rows)
    assert chr(0x2014) not in buyers.ALIAS_PATH.read_text(encoding="utf-8")


@pytest.mark.parametrize("line, message", [
    ("Some Name,dnd-mdn,nickname,a reason", "is not one of"),
    ("Other Thing,dnd-mdn,placeholder,a reason", "a placeholder names no buyer"),
    ("Other Thing,,former,a reason", "a placeholder names no buyer"),
    ("Some Name,dnd-mdn,spelling,", "every row says why"),
])
def test_a_bad_alias_row_stops_the_stage(tmp_path, line, message):
    path = tmp_path / "aliases.csv"
    path.write_text("# comment\nalias,buyer_id,note,why\n" + line + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        buyers.read_aliases(path)


def test_one_name_given_two_buyers_stops_the_stage(tmp_path):
    path = tmp_path / "aliases.csv"
    path.write_text("alias,buyer_id,note,why\nDepartment of X,x-one,spelling,one\nX Department,x-two,spelling,two\n",
                    encoding="utf-8")
    with pytest.raises(ValueError, match="given to x-one"):
        buyers.read_aliases(path)


def test_the_registrys_other_choice_names_no_buyer_in_any_source(conn):
    for spelling in ("Other (Specify)", "OTHER (SPECIFY)", "Autre (Préciser)", "autre (preciser)"):
        assert buyers.is_placeholder_name(spelling), spelling
        assert buyers.resolve(conn, spelling, source="lobbying") is None
        assert intraday.BuyerLookup().resolve(spelling) is None
    assert buyers.take_notices(conn) == [] and buyers.take_rejects(conn) == []
    assert conn.execute("SELECT COUNT(*) FROM buyers").fetchone()[0] == 0
    for text in ("Other", "Other (Specify)", "Autre (Préciser)", "other (specify) / autre (préciser)",
                 "Other (Specify)|Autre (Préciser)"):
        assert lobbying.is_other_institution(text), text
    assert not lobbying.is_other_institution("Other Transaction Authority")


def test_a_report_naming_other_specify_makes_no_buyer_and_the_institution_beside_it_counts(conn, fixtures, tmp_path):
    from test_lobbying import fixture_files, make_zip
    buyers.load_seed(conn, buyers.read_seed(), now=STAMP)
    files = fixture_files(fixtures)
    files["Communication_DpohExport.csv"] += (
        "500003,Ito,Kei,Analyst,,,Other (Specify)\n"
        "500003,Ito,Kei,Analyst,,Revenue Canada,Autre (Préciser)\n").encode("utf-8")
    lobbying.load_zip(conn, make_zip(tmp_path / "c.zip", files), now=STAMP)
    row = conn.execute("SELECT institutions, buyer_ids, dpoh FROM lobbying_communications WHERE comm_number = '500003'"
                       ).fetchone()
    assert "Other (Specify)" not in json.loads(row["institutions"])
    assert "Revenue Canada" in json.loads(row["institutions"])
    assert conn.execute("SELECT 1 FROM buyers WHERE id IN ('other', 'autre')").fetchone() is None
    # Revenue Canada's successor is not in this database, so the registry's name makes an institution.
    assert conn.execute("SELECT kind FROM buyers WHERE id = 'revenue-canada'").fetchone()[0] == buyers.INSTITUTION


# -- the merges ----------------------------------------------------------------------------


def test_the_walkthroughs_duplicates_become_one_buyer_each(walk, tmp_path):
    conn = walk
    result = night(conn, review_dir=tmp_path / "review")
    live = {r[0] for r in conn.execute("SELECT id FROM buyers")}
    assert not live & (set(RETIRED) | {"other"})
    aliases = {r["old_id"]: (r["new_id"], r["reason"]) for r in conn.execute("SELECT * FROM buyer_aliases")}
    assert {old: aliases[old] for old in RETIRED} == {
        "department-of-national-defense": ("dnd-mdn", "alias"),
        "national-defense-headquarters": ("dnd-mdn", "alias"),
        "parks-canada-agency": ("pc", "alias"),
        "revenue-canada": ("cra-arc", "alias"),
        # The twin with the department number stays.
        "tatc-tatc": ("tatc", "ckan_twin"),
    }
    assert "other" not in aliases  # it named no institution: retired with no page to send anyone to
    assert result["merged"] == len(RETIRED) + 1
    # Every source's rows moved, the radar's included.
    assert {r[0]: r[1] for r in conn.execute("SELECT reference, buyer_id FROM awards WHERE reference IN "
                                             "('AW-D1', 'AW-D2', 'AW-P1')")} == \
        {"AW-D1": "dnd-mdn", "AW-D2": "dnd-mdn", "AW-P1": "pc"}
    assert conn.execute("SELECT client_id FROM contract_history WHERE reference = 'H-D1'").fetchone()[0] == "dnd-mdn"
    assert conn.execute("SELECT buyer_id FROM tenders WHERE reference = 'cb-900-9'").fetchone()[0] == "dnd-mdn"
    assert {r[0] for r in conn.execute("SELECT buyer_id FROM contracts WHERE reference IN ('T-1', 'T-2')")} == {"tatc"}
    assert conn.execute("SELECT buyer_id FROM grants WHERE reference = 'TG-1'").fetchone()[0] == "tatc"
    assert not conn.execute(f"SELECT 1 FROM expiring_contracts WHERE buyer_id IN ({','.join('?' * len(RETIRED))})",
                            list(RETIRED)).fetchall()
    ids = {r[0]: json.loads(r[1]) for r in conn.execute("SELECT comm_number, buyer_ids FROM lobbying_communications "
                                                        "WHERE buyer_ids IS NOT NULL")}
    assert ids["L-2"] == ["dnd-mdn"] and ids["L-3"] == ["cra-arc"]
    # Each spelling now finds the one buyer directly, the French half that resolved nothing by itself included.
    for spelling, bid in (("QG Défense nationale", "dnd-mdn"), ("Agence Parcs Canada", "pc"),
                          ("Department of National Defense", "dnd-mdn")):
        assert buyers.resolve(conn, spelling) == bid, spelling
    assert buyers.take_notices(conn) == []
    # The institutions only the registry names stay, listed apart, with their reports counted; buyers.csv
    # gives the House of Commons members their French name.
    row = conn.execute("SELECT kind, n_lobbying, name_fr FROM buyers WHERE id = 'members-of-the-house-of-commons'"
                       ).fetchone()
    assert tuple(row) == (buyers.INSTITUTION, 1, "Députés de la Chambre des communes")
    assert result["institutions"] == 2
    notice = conn.execute("SELECT notice FROM sources_log WHERE source = 'buyers' ORDER BY id DESC").fetchone()[0]
    assert "parks-canada-agency -> pc (alias)" in notice and "other -> no buyer (no_institution)" in notice
    review = (tmp_path / "review" / buyers.REVIEW_FILE).read_text(encoding="utf-8")
    assert "alias\tparks-canada-agency\tParks Canada Agency\tpc\tParks Canada" in review
    assert "ckan_twin\ttatc-tatc" in review
    assert "office-of-the-senate-ethics-officer\tOffice of the Senate Ethics Officer\t0\tonly the lobbying registry" \
        in review


def test_a_second_night_changes_nothing_and_says_nothing(walk, tmp_path):
    conn = walk
    night(conn, review_dir=tmp_path)
    before = {t: conn.execute(f"SELECT * FROM {t} ORDER BY 1, 2").fetchall()
              for t in ("buyers", "buyer_aliases", "buyer_names")}
    result = night(conn, LATER, review_dir=tmp_path)
    assert result["merged"] == 0 and result["merged_new"] == 0
    after = {t: conn.execute(f"SELECT * FROM {t} ORDER BY 1, 2").fetchall() for t in ("buyer_aliases", "buyer_names")}
    assert [tuple(r) for r in after["buyer_names"]] == [tuple(r) for r in before["buyer_names"]]
    assert {r[0]: r[1] for r in after["buyer_aliases"]} == {r[0]: r[1] for r in before["buyer_aliases"]}
    notice = conn.execute("SELECT notice FROM sources_log WHERE source = 'buyers' ORDER BY id DESC").fetchone()[0] or ""
    assert "buyers merged" not in notice


def test_a_ckan_refresh_brings_a_twin_back_and_the_stage_retires_it_again_quietly(walk, tmp_path):
    conn = walk
    night(conn, review_dir=tmp_path)
    # The monthly CKAN load writes both organizations again; the published contracts are read again too.
    ckan(conn, "tatc-tatc", "Transportation Appeal Tribunal of Canada", "Tribunal d'appel des transports du Canada",
         "TATC", "TATC", None)
    assert buyers.for_owner_org(conn, "tatc-tatc", "Transportation Appeal Tribunal of Canada | Tribunal") == "tatc-tatc"
    conn.commit()
    result = night(conn, LATER, review_dir=tmp_path)
    assert result["merged"] == 1 and result["merged_new"] == 0
    assert conn.execute("SELECT 1 FROM buyers WHERE id = 'tatc-tatc'").fetchone() is None
    # Between nights, a publication naming the retired organization goes to the survivor, never to a new buyer.
    assert buyers.for_owner_org(conn, "tatc-tatc", "Transportation Appeal Tribunal of Canada | Tribunal") == "tatc"
    assert conn.execute("SELECT 1 FROM buyers WHERE id = 'tatc-tatc'").fetchone() is None


def test_a_former_name_ckan_lists_as_its_own_organization_joins_its_successor(conn, tmp_path):
    ckan(conn, "wage", "Women and Gender Equality Canada", "Femmes et Égalité des genres Canada", "WAGE", "FEGC")
    ckan(conn, "swc-cfc", "Status of Women Canada", "Condition féminine Canada", "SWC", "CFC")
    contract(conn, "swc-cfc", "S-1", 12_000.0)
    conn.commit()
    buyers.run(conn, None, now=NOW, offline=True, review_dir=tmp_path)
    assert conn.execute("SELECT buyer_id FROM contracts").fetchone()[0] == "wage"
    assert dict(conn.execute("SELECT old_id, reason FROM buyer_aliases WHERE old_id = 'swc-cfc'")) == {"swc-cfc": "alias"}
    assert buyers.resolve(conn, "Status of Women Canada (SWC)") == "wage"
    assert buyers.for_owner_org(conn, "swc-cfc", "Status of Women Canada | Condition féminine Canada") == "wage"


def test_a_made_buyer_whose_spellings_name_a_third_buyer_waits_for_review(conn, tmp_path):
    ckan(conn, "dnd-mdn", "National Defence", "Défense nationale", "DND", "MDN")
    ckan(conn, "dfo-mpo", "Fisheries and Oceans Canada", "Pêches et Océans Canada", "DFO", "MPO")
    made(conn, "defence-and-oceans", "National Defence Fisheries", None,
         [("National Defence Fisheries", "canadabuys"), ("Department of Fisheries and Oceans", "canadabuys")])
    conn.execute("INSERT INTO awards (reference, amendment, buyer_id, source_file, first_seen, last_seen) "
                 "VALUES ('M-1', 0, 'defence-and-oceans', 'f', ?, ?)", (STAMP, STAMP))
    conn.commit()
    result = buyers.run(conn, None, now=NOW, offline=True, review_dir=tmp_path)
    assert result["merged"] == 0 and result["review"] == 1
    assert conn.execute("SELECT buyer_id FROM awards").fetchone()[0] == "defence-and-oceans"
    # The spelling that names another buyer is re-pointed by itself all the same.
    assert buyers.resolve(conn, "Department of Fisheries and Oceans") == "dfo-mpo"
    review = (tmp_path / buyers.REVIEW_FILE).read_text(encoding="utf-8")
    assert "defence-and-oceans\tNational Defence Fisheries\t1\tits name is dnd-mdn's but its spellings name dfo-mpo" \
        in review


def test_an_institution_a_record_source_names_is_a_department_again(conn, tmp_path):
    made(conn, "leaders-debates-commission", "Leaders' Debates Commission", None,
         [("Leaders' Debates Commission", "lobbying")], kind=None)
    conn.commit()
    buyers.run(conn, None, now=NOW, offline=True, review_dir=tmp_path)
    assert conn.execute("SELECT kind FROM buyers WHERE id = 'leaders-debates-commission'").fetchone()[0] == "institution"
    assert buyers.resolve(conn, "LEADERS DEBATES COMMISSION", source="canadabuys") == "leaders-debates-commission"
    buyers.run(conn, None, now=LATER, offline=True, review_dir=tmp_path)
    assert conn.execute("SELECT kind FROM buyers WHERE id = 'leaders-debates-commission'").fetchone()[0] is None


# -- totals and the records database -------------------------------------------------------


FIGURES = ("n_tenders", "n_awards", "n_history", "n_contracts", "n_grants", "total_awards", "total_contracts",
           "total_grants")


def test_totals_after_the_merge_equal_the_sum_of_the_parts(walk, tmp_path):
    conn = walk
    groups: dict[str, list[str]] = {}
    for old, new in RETIRED.items():
        groups.setdefault(new, [new]).append(old)
    before = {r["id"]: r for r in conn.execute(f"SELECT id, {', '.join(FIGURES)} FROM buyers")}
    cents_before: dict[int, int] = {}
    for row in rd.record_rows(conn):
        if row[4] is not None and row[8] is not None and not row[7]:
            cents_before[row[4]] = cents_before.get(row[4], 0) + row[8]
    night(conn, review_dir=tmp_path)
    after = {r["id"]: r for r in conn.execute(f"SELECT id, {', '.join(FIGURES)} FROM buyers")}
    for survivor, parts in groups.items():
        for figure in FIGURES:
            values = [before[p][figure] for p in parts if before[p][figure] is not None]
            expected = round(sum(values), 2) if values else (0 if figure.startswith("n_") else None)
            assert after[survivor][figure] == expected, (survivor, figure)
    # The records database's rows: the survivor's number holds the cents of every part; no retired number is left.
    cents_after: dict[int, int] = {}
    bids = set()
    for row in rd.record_rows(conn):
        bids.add(row[4])
        if row[4] is not None and row[8] is not None and not row[7]:
            cents_after[row[4]] = cents_after.get(row[4], 0) + row[8]
    for survivor, parts in groups.items():
        assert cents_after.get(rd.buyer_number(survivor), 0) == \
            sum(cents_before.get(rd.buyer_number(p), 0) for p in parts), survivor
    assert not bids & {rd.buyer_number(old) for old in RETIRED}


def d1() -> sqlite3.Connection:
    """A stand-in for the records database in D1."""
    db = sqlite3.connect(":memory:")
    db.executescript(rd.SCHEMA_PATH.read_text(encoding="utf-8"))
    return db


def records_night(conn: sqlite3.Connection, out: Path, db: sqlite3.Connection) -> dict:
    """records-sync, the apply, the count check, finish.sql and records-synced, as the workflow runs them."""
    manifest = rd.sync(conn, out)
    for name in manifest["batches"]:
        db.executescript((out / name).read_text(encoding="utf-8"))
    db.commit()
    actual = dict(zip((t.name for t in rd.TABLES), db.execute(rd.COUNT_SQL).fetchone()))
    assert rd.count_check(rd.expected_counts(manifest), actual) is None
    db.executescript((out / rd.FINISH).read_text(encoding="utf-8"))
    rd.record_sync(conn, manifest)
    return manifest


def test_the_records_sync_resends_the_moved_rows_under_the_surviving_number(walk, tmp_path):
    conn = walk
    db = d1()
    out = tmp_path / "records"
    records_night(conn, out, db)
    moved = {rd.buyer_number(old) for old in RETIRED}
    sent_before = db.execute(f"SELECT COUNT(*) FROM records WHERE bid IN ({','.join('?' * len(moved))})",
                             sorted(moved)).fetchone()[0]
    survivors = sorted({rd.buyer_number(new) for new in RETIRED.values()})
    total_before = db.execute(f"SELECT SUM(cents) FROM records WHERE extra = 0 AND bid IN "
                              f"({','.join('?' * (len(moved) + len(survivors)))})", [*sorted(moved), *survivors]).fetchone()[0]
    assert sent_before >= 5
    named = db.execute(f"SELECT COUNT(*) FROM rec_buyers WHERE bid IN ({','.join('?' * len(moved))})",
                       sorted(moved)).fetchone()[0]
    assert named == 4  # revenue-canada is named only by lobbying reports, which are not records

    night(conn, review_dir=tmp_path / "review")
    manifest = records_night(conn, out, db)
    assert not manifest["full"]
    # Each moved record is sent again with the survivor's number, and the retired names leave rec_buyers.
    assert manifest["upserts"]["records"] >= sent_before
    assert manifest["deletes"]["rec_buyers"] == named
    for table in ("records", "rec_buyers", "rec_buyer_quarters", "rec_buyer_years", "rec_due", "rec_details",
                  "rec_classes", "rec_contracts"):
        left = db.execute(f"SELECT COUNT(*) FROM {table} WHERE bid IN ({','.join('?' * len(moved))})",
                          sorted(moved)).fetchone()[0]
        assert left == 0, table
    total_after = db.execute(f"SELECT SUM(cents) FROM records WHERE extra = 0 AND bid IN "
                             f"({','.join('?' * len(survivors))})", survivors).fetchone()[0]
    assert total_after == total_before
    assert db.execute("SELECT id FROM rec_buyers WHERE bid = ?", (rd.buyer_number("pc"),)).fetchone() == ("pc",)


# -- the export and the search rows --------------------------------------------------------


@pytest.fixture
def exported(walk, tmp_path):
    night(walk, review_dir=tmp_path / "review")
    # A spelling a record carries that names a person in its attention line is never listed as a name.
    walk.execute("UPDATE awards SET buyer_raw_en = 'Department of National Defence Attn: Pat Doe' "
                 "WHERE reference = 'AW-1'")
    walk.commit()
    static = tmp_path / "static"
    es.export_static(walk, static, today=TODAY, base_url=BASE)
    return walk, static


def read(static: Path, rel: str):
    return json.loads((static / rel).read_text(encoding="utf-8"))


def test_the_buyer_pages_list_the_names_each_buyer_also_appears_under(exported):
    _, static = exported
    dnd = read(static, "buyers/dnd-mdn.json")
    names = {a["name"]: a["note"] for a in dnd["aliases"]}
    assert {"Department of National Defense", "National Defense Headquarters", "QG Défense nationale"} <= set(names)
    # Its own name and acronyms are not repeated, and nothing that names a person is listed.
    assert not {"National Defence", "DND", "MDN"} & set(names)
    assert not any("Pat Doe" in n for n in names)
    assert len(dnd["aliases"]) <= es.BUYER_ALIASES
    cra = {a["name"]: a["note"] for a in read(static, "buyers/cra-arc.json")["aliases"]}
    assert cra["Revenue Canada"] == "former"
    pc = {a["name"] for a in read(static, "buyers/pc.json")["aliases"]}
    assert {"Parks Canada Agency", "Agence Parcs Canada"} <= pc


def test_the_index_lists_institutions_apart_and_retired_ids_only_redirect(exported):
    _, static = exported
    index = {b["id"]: b for b in read(static, "buyers/index.json")["buyers"]}
    house = index["members-of-the-house-of-commons"]
    assert (house["kind"], house["n_lobbying"]) == ("institution", 1)
    assert index["dnd-mdn"]["kind"] != "institution" and index["dnd-mdn"]["n_lobbying"] == 1
    assert not set(RETIRED) & set(index) and "other" not in index
    assert read(static, "buyers/aliases.json")["aliases"] == {old: new for old, new in sorted(RETIRED.items())}
    for old in RETIRED:
        assert not (static / "buyers" / f"{old}.json").exists()
    sitemap = "".join(p.read_text(encoding="utf-8") for p in (static / "sitemaps").glob("sitemap-*.xml"))
    assert "/buyers/dnd-mdn<" in sitemap
    assert not any(f"/buyers/{old}<" in sitemap for old in [*RETIRED, "other"])


def search_db() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.executescript(sd.SCHEMA_PATH.read_text(encoding="utf-8"))
    return db


def test_searching_an_alias_finds_the_one_buyer(exported, tmp_path):
    conn, static = exported
    rows = {r["id"]: r for r in sd.buyer_rows(conn, static)}
    alt = rows["dnd-mdn"]["alt"].split("\n")
    # The reviewed aliases come before the spellings the records carry (a retired id that folds like
    # one of them, department-of-national-defense, is the same words to the index and is left out).
    assert alt.index("Department of National Defense") < alt.index("QG Défense nationale")
    out = tmp_path / "search"
    db = search_db()
    manifest = sd.sync(conn, out, static_dir=static)
    for name in manifest["batches"]:
        db.executescript((out / name).read_text(encoding="utf-8"))

    def found(expr: str) -> set[str]:
        return {r[0] for r in db.execute("SELECT b.id FROM search_buyers b WHERE b.rid IN "
                                         "(SELECT rowid FROM search_buyers_fts WHERE search_buyers_fts MATCH ?)", (expr,))}

    assert found('"dnd"') == {"dnd-mdn"}
    assert found('"parks" "canada"') == {"pc"}
    assert found('"parks" "agency"') == {"pc"}
    assert found('"revenue" "canada"') >= {"cra-arc"} and "revenue-canada" not in found('"revenue" "canada"')


def test_the_buyers_csv_carries_the_kind_and_the_lobbying_count(exported):
    """buyers.csv in the downloads carries the kind and the lobbying count beside the figures."""
    conn, _ = exported
    from awardwatch_pipeline.export import BUYERS, register_functions
    register_functions(conn)
    cols = [d[0] for d in conn.execute(BUYERS, {"as_of": TODAY.isoformat()}).description]
    assert {"kind", "n_lobbying"} <= set(cols)
