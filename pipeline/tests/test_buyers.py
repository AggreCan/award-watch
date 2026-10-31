"""Buyers: CKAN organizations, the seed, and how a source's spelling resolves to one buyer."""

import json

import pytest

from conftest import FakeResponse
from pmw_pipeline import config
from pmw_pipeline.db import get_meta
from pmw_pipeline.sources import buyers

NOW = "2026-10-31T00:00:00Z"


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


def load(conn):
    for org in ORGS:
        buyers.upsert_ckan(conn, org, now=NOW)
    conn.commit()


def test_a_ckan_organization_becomes_a_buyer_with_its_titles(conn):
    load(conn)
    row = conn.execute("SELECT * FROM buyers WHERE id = 'ec'").fetchone()
    assert (row["name_en"], row["name_fr"], row["acronym_en"], row["acronym_fr"], row["ckan_org"],
            row["department_number"]) == ("Environment and Climate Change Canada",
                                          "Environnement et Changement climatique Canada", "ECCC", "ECCC", "ec", "99")
    names = {r[0] for r in conn.execute("SELECT raw_name FROM buyer_names WHERE buyer_id = 'ec' AND source = 'ckan'")}
    assert names == {"Environment and Climate Change Canada", "Environnement et Changement climatique Canada"}


def test_the_acronym_in_trailing_parentheses_joins_a_spelling_to_its_buyer(conn):
    load(conn)
    assert buyers.resolve(conn, "Department of the Environment (ECCC )", "Ministère de l’Environnement (ECCC)") == "ec"
    assert buyers.resolve(conn, "Department of Fisheries and Oceans (DFO)") == "dfo-mpo"
    # The French acronym narrows an English one two buyers share, or stands in for a missing English one.
    assert buyers.resolve(conn, "Federal Agency X (FA)", "Agence fédérale X (AS)") == "aaa-two"
    assert buyers.resolve(conn, "", "Ministère des Pêches et des Océans (MPO)") == "dfo-mpo"
    # Every spelling is recorded, so the next row finds it directly.
    mapped = dict(conn.execute("SELECT raw_name, buyer_id FROM buyer_names WHERE source = 'canadabuys'"))
    assert mapped["Department of the Environment (ECCC )"] == "ec"
    assert mapped["Ministère de l’Environnement (ECCC)"] == "ec"
    assert buyers.take_notices(conn) == []


def test_a_title_without_its_acronym_joins_too(conn):
    load(conn)
    assert buyers.resolve(conn, "Shared Services Canada", "Services partagés Canada") == "ssc-spc"
    assert buyers.resolve(conn, "Shared Services Canada (SSC)", "Services partagés Canada (SPC)") == "ssc-spc"


def test_an_ambiguous_acronym_does_not_guess(conn):
    load(conn)
    bid = buyers.resolve(conn, "Fictional Authority (FA)")
    assert bid == "fictional-authority"
    assert buyers.take_notices(conn) == ["buyer fictional-authority made for 'Fictional Authority (FA)'"]


def test_the_seed_wins_over_the_acronym(conn, tmp_path):
    load(conn)
    rows = buyers.read_seed(seed_file(tmp_path, [
        "Department of the Environment (ECCC),canadabuys,parks-twin,Somewhere Else,Ailleurs,SE,AI",
        ",canadabuys,crown-only,Crown Only Corporation,Société couronne seule,,",
    ]))
    buyers.load_seed(conn, rows, now=NOW)
    assert buyers.resolve(conn, "Department of the Environment (ECCC)") == "parks-twin"
    crown = conn.execute("SELECT name_en, name_fr, ckan_org FROM buyers WHERE id = 'crown-only'").fetchone()
    assert tuple(crown) == ("Crown Only Corporation", "Société couronne seule", None)
    # The seed only fills what CKAN left blank.
    buyers.load_seed(conn, buyers.read_seed(seed_file(tmp_path, [
        "Fisheries,canadabuys,dfo-mpo,Fish,Poisson,F,P"])), now=NOW)
    assert conn.execute("SELECT name_en, acronym_en FROM buyers WHERE id = 'dfo-mpo'").fetchone()[:] == \
        ("Fisheries and Oceans Canada", "DFO")


def seed_file(tmp_path, lines):
    path = tmp_path / "buyers.csv"
    path.write_text("# a comment\n" + ",".join(buyers.SEED_COLUMNS) + "\n" + "\n".join(lines) + "\n", encoding="utf-8")
    return path


def test_the_committed_seed_reads_and_maps_the_two_largest_buyers(conn):
    rows = buyers.read_seed()
    assert rows and all(set(r) == set(buyers.SEED_COLUMNS) for r in rows)
    buyers.load_seed(conn, rows, now=NOW)
    assert buyers.resolve(conn, "Department of Public Works and Government Services (PSPC)",
                          " Ministère des Travaux publics et des Services gouvernementaux (SPAC)") == "pwgsc-tpsgc"
    assert buyers.resolve(conn, "Department of National Defence (DND)") == "dnd-mdn"
    assert buyers.resolve(conn, "Export Development Canada - EDC") == "export-development-canada"
    assert buyers.take_notices(conn) == []


def test_an_unmapped_spelling_makes_a_slug_buyer_once_with_a_notice(conn):
    first = buyers.resolve(conn, "Canadian Army (CA)", "Armée canadienne (AC)", now=NOW)
    assert first == "canadian-army"
    row = conn.execute("SELECT name_en, name_fr, acronym_en, acronym_fr, ckan_org FROM buyers WHERE id = ?",
                       (first,)).fetchone()
    assert tuple(row) == ("Canadian Army", "Armée canadienne", "CA", "AC", None)
    assert buyers.take_notices(conn) == ["buyer canadian-army made for 'Canadian Army (CA)'"]
    assert buyers.resolve(conn, "Canadian Army (CA)", "Armée canadienne (AC)") == "canadian-army"
    assert buyers.take_notices(conn) == []
    assert buyers.resolve(conn, "", "") is None and buyers.resolve(conn, "N/A") is None


def test_split_acronym():
    assert buyers.split_acronym("Department of the Environment (ECCC )") == ("Department of the Environment", "ECCC")
    assert buyers.split_acronym("Canada Revenue Agency - (Administered Activities) (CRA)") == \
        ("Canada Revenue Agency - (Administered Activities)", "CRA")
    assert buyers.split_acronym("Export Development Canada - EDC") == ("Export Development Canada", "EDC")
    assert buyers.split_acronym("Shared Services Canada") == ("Shared Services Canada", None)


def test_owner_org_is_the_buyer_id(conn):
    title = "Accessibility Standards Canada | Normes d’accessibilité Canada"
    assert buyers.for_owner_org(conn, "casdo-ocena", title) == "casdo-ocena"
    row = conn.execute("SELECT name_en, name_fr, ckan_org FROM buyers WHERE id = 'casdo-ocena'").fetchone()
    assert tuple(row) == ("Accessibility Standards Canada", "Normes d’accessibilité Canada", "casdo-ocena")
    load(conn)
    # One CKAN already listed keeps its own titles.
    assert buyers.for_owner_org(conn, "ec", "Something | Autre chose") == "ec"
    assert conn.execute("SELECT name_en FROM buyers WHERE id = 'ec'").fetchone()[0] == \
        "Environment and Climate Change Canada"


def ckan_mapping(orgs):
    mapping = {config.CKAN_ORGANIZATION_LIST: json.dumps({"success": True, "result": [o["name"] for o in orgs]}).encode()}
    for org in orgs:
        mapping[config.CKAN_ORGANIZATION_SHOW.format(name=org["name"])] = \
            json.dumps({"success": True, "result": org}).encode()
    return mapping


def test_the_stage_loads_ckan_monthly_and_moves_records_off_a_buyer_made_before(conn, fake_client, monkeypatch):
    monkeypatch.setattr(buyers, "SEED_PATH", config.PACKAGE_DATA / "no-such-seed.csv")
    # A night without CKAN made a slug buyer, and an award points at it.
    made = buyers.resolve(conn, "Department of Fisheries and Oceans (DFO)", "Ministère des Pêches et des Océans (MPO)")
    assert made == "department-of-fisheries-and-oceans"
    conn.execute("INSERT INTO awards (reference, amendment, buyer_id, source_file, first_seen, last_seen) "
                 "VALUES ('r1', 0, ?, 'f', '2026-10-30', '2026-10-30')", (made,))
    conn.commit()

    client = fake_client(ckan_mapping(ORGS))
    result = buyers.run(conn, client, now=NOW)
    assert result["ckan"] == len(ORGS) and result["merged"] == 1
    assert len(client.fake_session.calls) == 1 + len(ORGS)
    assert get_meta(conn, buyers.META_LOADED) == NOW
    assert conn.execute("SELECT buyer_id FROM awards").fetchone()[0] == "dfo-mpo"
    assert conn.execute("SELECT 1 FROM buyers WHERE id = ?", (made,)).fetchone() is None
    assert conn.execute("SELECT buyer_id FROM buyer_names WHERE raw_name = 'Department of Fisheries and Oceans (DFO)'"
                        ).fetchone()[0] == "dfo-mpo"
    log = conn.execute("SELECT source, ok, notice FROM sources_log").fetchone()
    assert log["source"] == "buyers" and log["ok"] == 1 and "department-of-fisheries-and-oceans -> dfo-mpo" in log["notice"]

    # Within the month nothing is asked again.
    buyers.run(conn, client, now="2026-11-20T00:00:00Z")
    assert len(client.fake_session.calls) == 1 + len(ORGS)


def test_a_failed_organization_is_a_notice_and_the_load_is_tried_again(conn, fake_client, monkeypatch):
    monkeypatch.setattr(buyers, "SEED_PATH", config.PACKAGE_DATA / "no-such-seed.csv")
    mapping = ckan_mapping(ORGS)
    del mapping[config.CKAN_ORGANIZATION_SHOW.format(name="dfo-mpo")]
    buyers.run(conn, fake_client(mapping), now=NOW)
    assert get_meta(conn, buyers.META_LOADED) is None
    assert "dfo-mpo" in conn.execute("SELECT notice FROM sources_log").fetchone()[0]


def test_a_samples_run_makes_no_request(conn, fake_client):
    client = fake_client({})
    buyers.run(conn, client, now=NOW, offline=True)
    assert client.fake_session.calls == []
    assert conn.execute("SELECT 1 FROM buyers WHERE id = 'pwgsc-tpsgc'").fetchone() is not None


@pytest.mark.parametrize("bad", [FakeResponse(200, b'{"success": false}')])
def test_an_unusable_organization_list_fails_the_stage(conn, fake_client, bad):
    with pytest.raises(ValueError):
        buyers.load_ckan(conn, fake_client({config.CKAN_ORGANIZATION_LIST: bad}), now=NOW)
