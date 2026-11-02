"""Buyers: CKAN organizations, the seed, and how a source's spelling resolves to one buyer."""

import json
import re

import pytest

from conftest import FakeResponse
from awardwatch_pipeline import config
from awardwatch_pipeline.db import get_meta
from awardwatch_pipeline.sources import buyers

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
    assert buyers.resolve(conn, "Export Development Canada - EDC") == "edc"
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


# -- spellings the night of 2026-11-01 could not map (404 on the tenders stage, 22 on awards, 52 on history) ---

# The CKAN organizations those spellings belong to, as organization_show describes them (2026-11-01).
REAL_ORGS = [
    ckan_org("pwgsc-tpsgc", "Public Services and Procurement Canada", "Services publics et Approvisionnement Canada",
             "PWGSC", "TPSGC"),
    ckan_org("dnd-mdn", "National Defence", "Défense nationale", "DND", "MDN"),
    ckan_org("caf-facdnd", "Canadian Forces", "Forces canadiennes", "CAF", "FACDND"),
    ckan_org("dcc-cdc", "Defence Construction Canada", "Construction de Défense Canada", "DCC", "CDC"),
    ckan_org("dfatd-maecd", "Global Affairs Canada", "Affaires mondiales Canada", "DFATD", "MAECD"),
    ckan_org("cic", "Immigration, Refugees and Citizenship Canada", "Immigration, Réfugiés et Citoyenneté Canada",
             "CIC", "CIC"),
    ckan_org("ic", "Innovation, Science and Economic Development Canada",
             "Innovation, Sciences et Développement économique Canada", "IC", "IC"),
    ckan_org("ec", "Environment and Climate Change Canada", "Environnement et Changement climatique Canada", "EC", "EC"),
    ckan_org("aandc-aadnc", "Crown-Indigenous Relations and Northern Affairs Canada",
             "Relations Couronne-Autochtones et Affaires du Nord Canada", "CIRNAC", "RCAANC"),
    ckan_org("cer-rec", "Canada Energy Regulator", "La Régie de l’énergie du Canada", "CER", "REC"),
    ckan_org("tbs-sct", "Treasury Board of Canada Secretariat", "Secrétariat du Conseil du Trésor du Canada", "TBS", "SCT"),
    ckan_org("tb-ct", "Treasury Board", "Conseil du Trésor", "TB", "CT"),
    ckan_org("infc", "Department of Housing, Infrastructure and Communities",
             "Ministère du Logement, de l’Infrastructure et des Collectivités", "INFC", "INFC"),
    ckan_org("feddevontario", "Federal Economic Development Agency for Southern Ontario",
             "Agence fédérale de développement économique pour le Sud de l'Ontario", "FedDev Ontario", "FedDev Ontario"),
    ckan_org("edc", "Export Development Canada", "Exportation et développement Canada", "EDC", "EDC"),
    ckan_org("csc-scc", "Correctional Service of Canada", "Service correctionnel du Canada", "CSC", "SCC"),
    ckan_org("rcmp-grc", "Royal Canadian Mounted Police", "Gendarmerie royale du Canada", "RCMP", "GRC"),
]


@pytest.fixture
def real(conn):
    for org in REAL_ORGS:
        buyers.upsert_ckan(conn, org, now=NOW)
    buyers.load_seed(conn, buyers.read_seed(), now=NOW)
    buyers.take_notices(conn)
    return conn


@pytest.mark.parametrize("expected, spellings", [
    ("pwgsc-tpsgc", ["Public Works and Government Services Canada", "Public Works and Government Services Canada.",
                     "Travaux publics et Services gouvernementaux Canada", "PWGSC", "PSPC", "Group, PSPC",
                     "Public Works & Government Services Canada (PWGSC)",
                     "Public Works and Government Services Canada - Bid Receiving Unit",
                     "Public Works and Government Services Canada Attn: Matt MacDonald, Senior Leasing Officer",
                     "PWGSC - Departmental Acquisitions Services"]),
    ("dnd-mdn", ["Department of National Defence", "Department Of National Defence", "DEPARTMENT OF NATIONAL DEFENCE",
                 "Department of National Defense", "Departement National Defense", "National Defence Canada",
                 "Ministère de la défense nationale", "Department of National Defence Headquarters", "DND",
                 "DND Petawawa", "DND / CAF", "Department of National Defence, Combat Training Centre",
                 "Department of National Defence / Government of Canada", "DGAEPM", "ADM(Mat)/DGLEPM/DLP 5-3-4-1",
                 "Director Land Procurement 7 (DLP 7)", "Minister of National Defense Petawawa"]),
    ("dcc-cdc", ["Defence Construction Canada - Atlantic Region", "Defence Construction Canada - Ontario Region",
                 "Defence Construction Canada - National Capital Region", "Defence Construction Canada - Ottawa, ON",
                 "Defence Construction Canada / Construction de Défense Canada"]),
    ("dfatd-maecd", ["Department of Foreign Affairs, Trade and Development (GAC)",
                     "Foreign Affairs, Trade And Development (Department Of)", "Foreign Affairs, Trade and Development Canada",
                     "FOREIGN AFFAIRS, TRADE AND DEVELOPMENT CANADA", "DFATD", "DFAIT",
                     "Canadian International Development Agency", "Embassy of Canada to China in Beijing"]),
    ("cic", ["Department of Citizenship & Immigration (IRCC)", "Citizenship and Immigration Canada", "IRCC",
             "Immigration, Refugee and Citizenship Canada"]),
    ("ic", ["Department of Industry (ISED)", "Industry Canada", "ISED", "INNOV, SCI AND ECON DEVT CAN",
            "CRC - Innovation, Science & Economic Development",
            "Spectrum and Telecommunications Sector - Innovation, Science and Economic Development Canada"]),
    ("ec", ["Department of the Environment (ECCC )", "Environment Canada", "ECCC",
            "Environment and Climate Change Canada Procurement & Contracting Division"]),
    ("aandc-aadnc", ["Aboriginal Affairs & Northern Development Canada", "Indian and Northern Affairs Canada",
                     "INDIGENOUS AND NORTHERN AFFAIRS CANADA", "Department Crown-Indigenous Relations and Northern Affairs Canada"]),
    ("cer-rec", ["National Energy Board", "Canadian Energy Regulator"]),
    ("tbs-sct", ["Treasury Board of Canada", "Treasury Board Secretariat", "TBS",
                 "Treasury Board of Canada Secretariat / Government of Canada"]),
    ("infc", ["Office of Infrastructure of Canada", "Infrastructure Canada",
              "Housing, Infrastructure and Communities Canada"]),
    ("feddevontario", ["FedDev Ontario"]),
    ("edc", ["Export Development Canada", "Export Development Canada (EDC)", "EXPORT DEVELOPMENT CANADA (EDC)"]),
    ("csc-scc", ["Correctional Service Canada", "Correctional Service Canada - RHQ", "Correctional Services of Canada",
                 "Regional Headquarters - Atlantic", "CORCAN"]),
    ("rcmp-grc", ["RCMP", "RCMP-GRC", "The Royal Canadian Mounted Police", "RCMP Procurement and Contracting Services.",
                  "Royal Canadian Mounted Police, CMB Procurement & Contracting, NW Region", 'RCMP "E" Division HQ']),
    ("caf-facdnd", ["Canadian Army (CA)", "Royal Canadian Navy (RCN)", "RCAF Aerospace Warfare Center",
                    "Canadian Forces Recruiting Group", "3CSU"]),
])
def test_former_names_acronyms_and_sub_units_resolve_to_the_institution(real, expected, spellings):
    for spelling in spellings:
        assert buyers.resolve(real, spelling) == expected, spelling
    assert buyers.take_notices(real) == [] and buyers.take_rejects(real) == []


def test_name_keys_leave_out_wrappers_case_accents_and_canada():
    key = buyers.name_key
    assert key("Department of National Defence") == key("National Defence") == key("NATIONAL DEFENCE CANADA") \
        == "national defence"
    assert key("Ministère de la Défense nationale") == key("Défense nationale") == "defence nationale"
    assert key("Treasury Board of Canada Secretariat") == key("Treasury Board Secretariat")
    assert key("Fisheries & Oceans Canada") == key("Department of Fisheries and Oceans")
    assert key("Atomic Energy of Canada Ltd") == key("Atomic Energy of Canada Limited")
    forms = buyers.spelling_forms("Defence Construction Canada - Atlantic Region")
    assert forms[0] == "Defence Construction Canada - Atlantic Region" and "Defence Construction Canada" in forms
    assert "Public Works Canada" in buyers.spelling_forms("Public Works Canada Attn: Pat Doe, Leasing Officer")
    assert "Office of the Auditor General of Canada" in buyers.spelling_forms("Auditor General of Canada, Office of the")


@pytest.mark.parametrize("reason, spelling", [
    ("person", "Adam Cheung"), ("person", "Amber Hupper"), ("person", "Bev Martin"), ("person", "Aarondeep Maan"),
    ("person", "KATIE MCKEEVER"), ("person", "carol rahal"), ("person", "PehSan Chuah"),
    ("single word", "a"), ("single word", "Canada"), ("single word", "Abdillahi"), ("single word", "N/D"),
    ("job title", "Contract Administrator"), ("job title", "Senior Leasing Officer"),
    ("job title", "Procurement Officer"),
    ("street address", "200 Promenade Portage"), ("street address", "3 Passage du Chien-d'Or"),
    ("street address", "202 WORKSHOP DEPOT BLDG 10 SOUTH COMMERCIAL RECEPTION"),
    ("attention line", "À l'attention de : Matt MacDonald"), ("attention line", "Attn: Matt MacDonald"),
    ("attention line", "c/o Pat Doe"),
    ("no institution named", "Government of Canada"), ("no institution named", "fed gov't"),
])
def test_a_spelling_that_names_no_institution_gets_no_buyer_and_is_listed_for_review(real, reason, spelling):
    before = real.execute("SELECT COUNT(*) FROM buyers").fetchone()[0]
    assert buyers.non_institution(spelling) == reason
    assert buyers.resolve(real, spelling, spelling) is None
    assert buyers.take_rejects(real) == [(reason, spelling)]
    assert buyers.take_notices(real) == []
    assert real.execute("SELECT COUNT(*) FROM buyers").fetchone()[0] == before
    assert real.execute("SELECT 1 FROM buyer_names WHERE raw_name = ?", (spelling,)).fetchone() is None


@pytest.mark.parametrize("spelling", [
    "Senate of Canada", "Canadian Coast Guard", "Translation Bureau", "Governor General", "Canada Lands Company",
    "Leaders' Debates Commission", "St Lawrence Seaway Management Corporation", "Canadian Army (CA)", "2 Wing",
    "3rd Canadian Support Unit", "Regional Headquarters - Pacific", "Thales Canada Inc.", "Combat Training Centre",
    "VIA HFR", "RCAF AWC", "DGLEPM/DLP", "Raw buyer",
])
def test_an_institution_or_a_unit_is_never_read_as_a_person(spelling):
    assert buyers.non_institution(spelling) is None


def test_institutions_no_rule_places_are_made_once_per_key(real):
    assert buyers.resolve(real, "Leaders' Debates Commission") == "leaders-debates-commission"
    # The same name written another way is the same made buyer, not another.
    assert buyers.resolve(real, "LEADERS DEBATES COMMISSION") == "leaders-debates-commission"
    assert buyers.resolve(real, "The Leaders' Debates Commission of Canada") == "leaders-debates-commission"
    assert buyers.take_notices(real) == ["buyer leaders-debates-commission made for 'Leaders' Debates Commission'"]


def test_the_buyers_stage_moves_records_off_buyers_made_for_former_names_and_people(real):
    """What the night of 2026-11-01 left: slug buyers for a former name, a misspelt department, a person, and
    a Crown corporation the old seed named under its own id. The next buyers stage moves their records to the
    institution, or to no buyer for the person, and deletes them."""
    conn = real
    made = {
        "public-works-and-government-services-canada": ["Public Works and Government Services Canada",
                                                        "Travaux publics et Services gouvernementaux Canada"],
        "department-of-national-defence": ["Department of National Defence", "Ministère de la défense nationale"],
        "adam-cheung": ["Adam Cheung"],
        "export-development-canada": ["Export Development Canada - EDC"],
    }
    for bid, names in made.items():
        conn.execute("INSERT INTO buyers (id, name_en, updated_at) VALUES (?, ?, ?)", (bid, names[0], NOW))
        conn.executemany("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, 'canadabuys', ?) "
                         "ON CONFLICT(raw_name, source) DO UPDATE SET buyer_id = excluded.buyer_id",
                         [(n, bid) for n in names])
    for ref, bid, raw in (("A1", "public-works-and-government-services-canada", "Public Works and Government Services Canada"),
                          ("A2", "adam-cheung", "Adam Cheung"), ("A3", "export-development-canada", "Export Development Canada - EDC")):
        conn.execute("INSERT INTO awards (reference, amendment, buyer_id, buyer_raw_en, source_file, first_seen, last_seen) "
                     "VALUES (?, 0, ?, ?, 'f', '2026-10-30', '2026-10-30')", (ref, bid, raw))
    conn.execute("INSERT INTO contract_history (reference, amendment, buyer_id, client_id, client_raw_en, source_file, "
                 "first_seen, last_seen) VALUES ('H1', 0, 'public-works-and-government-services-canada', "
                 "'department-of-national-defence', 'Department of National Defence', 'f', '2026-10-30', '2026-10-30')")
    conn.execute("INSERT INTO lobbying_communications (comm_number, buyer_ids, loaded_at) VALUES ('L1', ?, ?)",
                 ('["adam-cheung", "department-of-national-defence", "dnd-mdn"]', NOW))
    # Last night's derived rows (the indicators stage rebuilds them): they point at the made buyers and
    # would stop the delete on a restored database (the foreign-key failure of the 2026-11-01 22:22 run).
    conn.executemany("INSERT INTO buyer_years (buyer_id, year, source, n, total) VALUES (?, 2026, 'awards', 1, 10.0)",
                     [(bid,) for bid in made])
    conn.commit()

    result = buyers.run(conn, None, now=NOW, offline=True)
    assert result["merged"] == 4
    awards = {r["reference"]: (r["buyer_id"], r["buyer_raw_en"]) for r in conn.execute("SELECT * FROM awards")}
    assert awards == {"A1": ("pwgsc-tpsgc", "Public Works and Government Services Canada"),
                      "A2": (None, "Adam Cheung"), "A3": ("edc", "Export Development Canada - EDC")}
    history = conn.execute("SELECT buyer_id, client_id FROM contract_history").fetchone()
    assert tuple(history) == ("pwgsc-tpsgc", "dnd-mdn")
    assert json.loads(conn.execute("SELECT buyer_ids FROM lobbying_communications").fetchone()[0]) == ["dnd-mdn"]
    assert not conn.execute(f"SELECT 1 FROM buyers WHERE id IN ({','.join('?' * len(made))})", list(made)).fetchall()
    assert not conn.execute(f"SELECT 1 FROM buyer_years WHERE buyer_id IN ({','.join('?' * len(made))})",
                            list(made)).fetchall()
    assert conn.execute("SELECT 1 FROM buyer_names WHERE raw_name = 'Adam Cheung'").fetchone() is None
    notice = conn.execute("SELECT notice FROM sources_log WHERE source = 'buyers'").fetchone()[0]
    assert "adam-cheung -> no buyer" in notice and "public-works-and-government-services-canada -> pwgsc-tpsgc" in notice
    assert "export-development-canada -> edc" in notice


def test_the_stage_records_when_it_read_the_organization_list(conn, fake_client, monkeypatch):
    monkeypatch.setattr(buyers, "SEED_PATH", config.PACKAGE_DATA / "no-such-seed.csv")
    mapping = ckan_mapping(ORGS)
    del mapping[config.CKAN_ORGANIZATION_SHOW.format(name="dfo-mpo")]
    buyers.run(conn, fake_client(mapping), now=NOW)
    # One organization failed, so the monthly load is due again, but the list was read.
    assert get_meta(conn, buyers.META_LOADED) is None and get_meta(conn, buyers.META_READ) == NOW


def test_every_buyer_retired_for_another_is_kept_as_an_alias_to_the_live_buyer(real):
    """Old buyer pages answered 404 once their records moved. The buyers stage keeps every move (and the
    seed's re-pointed Crown-corporation ids) in buyer_aliases, chains followed to a live buyer."""
    conn = real
    for bid, name in (("public-works-and-government-services-canada", "Public Works and Government Services Canada"),
                      ("adam-cheung", "Adam Cheung")):
        conn.execute("INSERT INTO buyers (id, name_en, updated_at) VALUES (?, ?, ?)", (bid, name, NOW))
        conn.execute("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, 'canadabuys', ?) "
                     "ON CONFLICT(raw_name, source) DO UPDATE SET buyer_id = excluded.buyer_id", (name, bid))
    # Aliases left by earlier nights: a chain, one leading nowhere, one whose old id is a buyer again.
    conn.executemany("INSERT INTO buyer_aliases (old_id, new_id, reason, updated_at) VALUES (?, ?, 'merged', ?)", [
        ("older-pspc-id", "public-works-and-government-services-canada", "2026-10-01T00:00:00Z"),
        ("gone-id", "no-such-buyer", "2026-10-01T00:00:00Z"),
        ("dnd-mdn", "pwgsc-tpsgc", "2026-10-01T00:00:00Z"),
    ])
    conn.commit()
    buyers.run(conn, None, now=NOW, offline=True)
    aliases = {r["old_id"]: (r["new_id"], r["reason"]) for r in conn.execute("SELECT * FROM buyer_aliases")}
    assert aliases["public-works-and-government-services-canada"] == ("pwgsc-tpsgc", "merged")
    assert aliases["older-pspc-id"][0] == "pwgsc-tpsgc"
    assert aliases["export-development-canada"] == ("edc", "seed") and aliases["telefilm-canada"] == ("tf", "seed")
    # No alias for a buyer that went to no buyer (a person), none leading nowhere, none for a live id.
    assert "adam-cheung" not in aliases and "gone-id" not in aliases and "dnd-mdn" not in aliases
    assert all(conn.execute("SELECT 1 FROM buyers WHERE id = ?", (new,)).fetchone() for new, _ in aliases.values())
    assert "aliases=" in conn.execute("SELECT detail FROM sources_log WHERE source = 'buyers'").fetchone()[0]
    # A second night keeps them.
    buyers.run(conn, None, now="2026-11-02T00:00:00Z", offline=True)
    assert conn.execute("SELECT new_id FROM buyer_aliases WHERE old_id = 'public-works-and-government-services-canada'"
                        ).fetchone()[0] == "pwgsc-tpsgc"


def test_every_schema_reference_to_a_buyer_is_moved_or_dropped_when_a_buyer_is_deleted():
    """A column that points at buyers(id) and is on neither list makes the delete in reresolve fail the
    foreign-key check on a database that carries rows from the night before."""
    table, found = None, set()
    for line in config.SCHEMA_PATH.read_text(encoding="utf-8").splitlines():
        m = re.match(r"CREATE TABLE IF NOT EXISTS (\w+)", line)
        if m:
            table = m.group(1)
        m = re.match(r"\s+(\w+) TEXT(?: NOT NULL)? REFERENCES buyers\(id\)", line)
        if m and table:
            found.add((table, m.group(1)))
    covered = set(buyers.BUYER_COLUMNS) | set(buyers.DERIVED_BUYER_COLUMNS) | {("buyer_names", "buyer_id")}
    assert found == covered


def test_the_tribunals_support_service_is_one_buyer_and_its_made_duplicates_go(real):
    """The buyers list showed "Administrative Tribunals Support Service of Canada" twice (2026-11-02): the
    acronyms alone and the French name with a typographic apostrophe had made buyers of their own. The seed
    maps those spellings to the CKAN id, atssc-scdata; the made ids (atssc on the live site,
    administrative-tribunals-support-service-of-canada on a dev load) move their records there and go."""
    conn = real
    buyers.upsert_ckan(conn, ckan_org("atssc-scdata", "Administrative Tribunals Support Service of Canada",
                                      "Service canadien d'appui aux tribunaux administratifs", "ATSSC", "SCDATA"), now=NOW)
    made = {"atssc": ["ATSSC", "SCDATA"],
            "administrative-tribunals-support-service-of-canada": ["Service canadien d’appui aux tribunaux administratifs (SCDATA)"]}
    for bid, names in made.items():
        conn.execute("INSERT INTO buyers (id, name_en, updated_at) VALUES (?, ?, ?)",
                     (bid, "Administrative Tribunals Support Service of Canada", NOW))
        conn.executemany("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, 'canadabuys', ?) "
                         "ON CONFLICT(raw_name, source) DO UPDATE SET buyer_id = excluded.buyer_id",
                         [(n, bid) for n in names])
    conn.execute("INSERT INTO awards (reference, amendment, buyer_id, buyer_raw_en, source_file, first_seen, last_seen) "
                 "VALUES ('T1', 0, 'atssc', 'ATSSC', 'f', '2026-10-30', '2026-10-30')")
    conn.commit()
    buyers.run(conn, None, now=NOW, offline=True)
    assert conn.execute("SELECT buyer_id FROM awards WHERE reference = 'T1'").fetchone()[0] == "atssc-scdata"
    assert not conn.execute("SELECT 1 FROM buyers WHERE id IN ('atssc', 'administrative-tribunals-support-service-of-canada')").fetchall()
    for spelling in ("ATSSC", "SCDATA", "Service canadien d’appui aux tribunaux administratifs (SCDATA)",
                     "Administrative Tribunals Support Service of Canada (ATSSC)"):
        assert buyers.resolve(conn, spelling) == "atssc-scdata", spelling
    named = conn.execute("SELECT COUNT(*) FROM buyers WHERE name_en = 'Administrative Tribunals Support Service of Canada'")
    assert named.fetchone()[0] == 1
    # The old buyer pages redirect.
    aliases = dict(conn.execute("SELECT old_id, new_id FROM buyer_aliases").fetchall())
    assert aliases.get("atssc") == "atssc-scdata"
