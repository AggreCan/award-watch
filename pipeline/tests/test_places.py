"""Provinces stated and derived (places.py): the tables a text is read through, the rule that picks the field,
the columns the loaders write, the sweep that derives the stored rows again, the radar's land claims, and the
export and feeds that carry the derived codes apart from the stated ones."""

import json
from datetime import date, timedelta

import pytest

from awardwatch_pipeline import expiring, export_static, feeds, organizations, places
from awardwatch_pipeline.db import get_meta
from awardwatch_pipeline.normalize import PROVINCE_CODES, PROVINCES, fold_accents, region_provinces
from awardwatch_pipeline.sources import canadabuys_rows

# ISO 3166-2:CA, without the CA- prefix: the thirteen codes every table maps to.
ISO_3166_2_CA = {"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"}
# The names each province and territory has in the region lists, in English and in French.
NAMES = {
    "AB": ("Alberta", "Alberta"), "BC": ("British Columbia", "Colombie-Britannique"), "MB": ("Manitoba", "Manitoba"),
    "NB": ("New Brunswick", "Nouveau-Brunswick"), "NL": ("Newfoundland and Labrador", "Terre-Neuve-et-Labrador"),
    "NS": ("Nova Scotia", "Nouvelle-Écosse"), "NT": ("Northwest Territories", "Territoires du Nord-Ouest"),
    "NU": ("Nunavut Territory", "Territoire du Nunavut"), "ON": ("Ontario (except NCR)", "Ontario (sauf RCN)"),
    "PE": ("Prince Edward Island", "Île-du-Prince-Édouard"), "QC": ("Quebec (except NCR)", "Québec (sauf RCN)"),
    "SK": ("Saskatchewan", "Saskatchewan"), "YT": ("Yukon", "Yukon"),
}
# The TBS schema's land_claims choices (recombinant-published-schema/contracts.json).
TBS_LAND_CLAIMS = {"CH", "CT", "EM", "FN", "GW", "IF", "JN", "KD", "KF", "LI", "LS", "MF", "NA", "NF", "NI", "NQ", "NU",
                   "SD", "SF", "TA", "TF", "TH", "TK", "TL", "TT", "VG", "YA"}


def fold(s):
    return fold_accents(s.casefold())


# -- the tables -------------------------------------------------------------------------

def test_every_table_maps_to_the_iso_codes():
    assert PROVINCE_CODES == ISO_3166_2_CA
    assert set(PROVINCES.values()) == ISO_3166_2_CA
    assert set(places.CITIES) == ISO_3166_2_CA
    assert set(places.CITY_SPELLINGS.values()) <= ISO_3166_2_CA
    assert {p for codes in places.LAND_CLAIMS.values() for p in codes} <= ISO_3166_2_CA


@pytest.mark.parametrize("code", sorted(ISO_3166_2_CA))
def test_each_province_reads_in_both_languages_and_by_its_code(code):
    en, fr = NAMES[code]
    assert region_provinces([en]) == [code] and region_provinces([fr]) == [code]
    assert region_provinces([f"*{en.upper()}"]) == [code]


def test_no_city_name_sits_under_two_provinces_and_the_three_the_list_doubles_are_left_out():
    seen: dict[str, str] = {}
    for code, names in places.CITIES.items():
        assert list(names) == sorted(names, key=fold), code
        for name in names:
            assert seen.setdefault(fold(name), code) == code, name
    for name in places.TWO_PROVINCES:
        assert fold(name) not in seen
        assert places.city_provinces([name]) == []


@pytest.mark.parametrize(("item", "code"), [
    ("Esquimalt", "BC"), ("Victoria", "BC"), ("Kingston", "ON"), ("Petawawa", "ON"), ("Ottawa", "ON"),
    ("Gatineau", "QC"), ("Montréal", "QC"), ("MONTREAL", "QC"), ("*Saint John", "NB"), ("St. John's", "NL"),
    ("Charlottetown", "PE"), ("Charlottetown (Labrador)", "NL"), ("YellowKnife", "NT"), ("Iqaluit", "NU"),
    ("Whitehorse", "YT"), ("Dundurn", "SK"), ("Cold Lake", "AB"), ("Churchill", "MB"), ("Halifax", "NS"),
    ("Les Îles-de-la-Madelein", "QC"), ("Les Iles-de-la-Madeleine", "QC"), ("Outaouais", "QC"),
])
def test_a_city_of_the_location_list_gives_its_province(item, code):
    assert places.city_provinces([item]) == [code]


@pytest.mark.parametrize("item", [
    "Esquimalt, BC", "CFB Esquimalt", "Vancouver Island", "Esquimalt Harbour", "Burlington", "Windsor", "Cornwall",
    "Canada", "World", "Remote Offsite", "Indigenous Lands", "Unspecified", "Washington", "London, UK", "",
])
def test_anything_else_gives_nothing(item):
    # Exact names only: no part of a longer text, no guess.
    assert places.city_provinces([item]) == []


def test_land_claims_codes_are_the_tbs_choices_and_read_as_their_areas():
    assert set(places.LAND_CLAIMS) <= TBS_LAND_CLAIMS
    assert TBS_LAND_CLAIMS - set(places.LAND_CLAIMS) == {"NA", "EM", "NI"}
    assert places.land_claim_provinces("NU") == ["NU"]
    assert places.land_claim_provinces("nu, if") == ["NT", "NU", "YT"]
    assert places.land_claim_provinces("JN") == ["QC"] and places.land_claim_provinces("TF") == ["BC"]
    for none in ("NA", "EM", "NI", "", None, "Nunavut"):
        assert places.land_claim_provinces(none) == []


# -- Defence Construction Canada's regional offices -------------------------------------

DCC_OFFICE_REGIONS = {
    "Defence Construction Canada - Pacific Region": ["BC"],
    "Defence Construction Canada - Western Region": ["AB", "MB", "SK"],
    "Defence Construction Canada - Ontario Region": ["ON"],
    "Defence Construction Canada - National Capital Region": ["ON", "QC"],
    "Defence Construction Canada - Atlantic Region": ["NB", "NL", "NS", "PE"],
}


def test_the_dcc_table_is_its_five_regional_offices_as_the_files_write_them():
    assert {k: list(v) for k, v in places.DCC_OFFICES.items()} == DCC_OFFICE_REGIONS
    assert places.DCC_BUYER_ID == "dcc-cdc"
    for name, codes in DCC_OFFICE_REGIONS.items():
        assert places.dcc_office_provinces("dcc-cdc", name) == codes
        # The French column repeats the English name; either column places it.
        assert places.dcc_office_provinces("dcc-cdc", None, name) == codes


@pytest.mark.parametrize("name", [
    "Defence Construction Canada / Construction de Défense Canada", "Defence Construction Canada - Ottawa, ON",
    "Defence Construction Canada", "defence construction canada - pacific region", "Pacific Region", "", None,
])
def test_a_dcc_name_that_carries_no_region_gives_nothing(name):
    assert places.dcc_office_provinces("dcc-cdc", name) == []


@pytest.mark.parametrize("buyer", ["pwgsc-tpsgc", "dnd-mdn", "caf-facdnd", "dfo-mpo", None, "", "DCC-CDC"])
def test_no_other_buyers_office_is_ever_read(buyer):
    # The very names DCC uses, and another department's regional office, give nothing under any other buyer id.
    for name in (*DCC_OFFICE_REGIONS, "Public Works and Government Services Canada - Pacific Region",
                 "Fisheries and Oceans Canada - Pacific Region"):
        assert places.dcc_office_provinces(buyer, name) == []
    get = getter("tenders", {"reference": "cb-x", "amendment": "0",
                             "buyer_en": "Defence Construction Canada - Pacific Region"})
    rec = canadabuys_rows.tender_fields(get, buyer)
    assert (rec["provinces_derived"], rec["provinces_from"]) == (None, None)


def test_a_dcc_notice_takes_its_offices_region_only_when_nothing_else_places_it():
    office = places.dcc_office_provinces("dcc-cdc", "Defence Construction Canada - Pacific Region")
    assert places.derive([], [], office) == ([], ["BC"], "dcc_office")
    assert places.derive(["Unspecified"], None, office) == ([], ["BC"], "dcc_office")
    # A stated province, a city, the regions of opportunity, or a stated "Canada" come first.
    assert places.derive(["Alberta"], [], office) == (["AB"], [], None)
    assert places.derive(["Edmonton"], [], office) == ([], ["AB"], "delivery")
    assert places.derive([], ["Nova Scotia"], office) == ([], ["NS"], "opportunity")
    assert places.derive(["Canada"], [], office) == ([], [], None)
    get = getter("tenders", {"reference": "MX-1", "amendment": "0",
                             "buyer_en": "Defence Construction Canada - Western Region",
                             "buyer_fr": "Defence Construction Canada - Western Region"})
    rec = canadabuys_rows.tender_fields(get, "dcc-cdc")
    assert (rec["provinces"], rec["provinces_derived"], rec["provinces_from"]) == (None, '["AB", "MB", "SK"]',
                                                                                   "dcc_office")


def test_the_sweep_reads_a_dcc_notices_office_and_no_other_buyers(conn):
    for ref, buyer in (("MX-DCC", "dcc-cdc"), ("PW-OTHER", "pwgsc-tpsgc")):
        conn.execute("INSERT INTO buyers (id, name_en, name_fr, updated_at) VALUES (?, ?, ?, 's')", (buyer, buyer, buyer))
        conn.execute(
            "INSERT INTO tenders (reference, amendment, buyer_id, buyer_raw_en, buyer_raw_fr, source_file, first_seen, "
            "last_seen) VALUES (?, 0, ?, 'Defence Construction Canada - Atlantic Region', "
            "'Defence Construction Canada - Atlantic Region', 'f', 'd', 'd')", (ref, buyer))
    places.sweep(conn)
    rows = {r[0]: tuple(r[1:]) for r in conn.execute("SELECT reference, provinces_derived, provinces_from FROM tenders")}
    assert rows == {"MX-DCC": ('["NB", "NL", "NS", "PE"]', "dcc_office"), "PW-OTHER": (None, None)}


# -- the rule ---------------------------------------------------------------------------

@pytest.mark.parametrize(("delivery", "opportunity", "want"), [
    # A city in the delivery regions, with "Canada" beside it (the location list's parent) or alone.
    (["Canada", "Esquimalt"], ["Canada"], ([], ["BC"], "delivery")),
    (["Esquimalt"], None, ([], ["BC"], "delivery")),
    # A city in another province than the one stated adds that province; one in the same adds nothing.
    (["British Columbia", "Edmonton"], None, (["BC"], ["AB"], "delivery")),
    (["British Columbia", "Vancouver", "Canada"], None, (["BC"], [], None)),
    # The National Capital Region is stated as both; Ottawa then adds nothing.
    (["National Capital Region (NCR)", "Ottawa"], None, (["ON", "QC"], [], None)),
    # The regions of opportunity are read only when the delivery regions name nothing.
    ([], ["British Columbia"], ([], ["BC"], "opportunity")),
    (["Unspecified"], ["Kelowna"], ([], ["BC"], "opportunity")),
    (["Non spécifiée"], ["National Capital Region (NCR)"], ([], ["ON", "QC"], "opportunity")),
    (["Canada"], ["British Columbia"], ([], [], None)),
    (["World"], ["Nova Scotia"], ([], [], None)),
    ([], ["Canada", "World"], ([], [], None)),
    # Award notices and history records have no regions of opportunity.
    ([], None, ([], [], None)),
    (["Canada"], None, ([], [], None)),
])
def test_derive(delivery, opportunity, want):
    assert places.derive(delivery, opportunity) == want


def test_fields_are_json_lists_and_the_field_name():
    assert places.fields(["Canada", "Esquimalt"]) == {"provinces": None, "provinces_derived": '["BC"]',
                                                      "provinces_from": "delivery"}
    assert places.fields(["Ontario (except NCR)"]) == {"provinces": '["ON"]', "provinces_derived": None,
                                                       "provinces_from": None}


# -- the loaders' columns ---------------------------------------------------------------

def getter(stage, values):
    columns = canadabuys_rows.COLUMNS[stage]
    row = {columns[k]: v for k, v in values.items()}
    return lambda f: (row.get(columns[f]) or "").strip()


def test_a_tender_reads_its_city_then_its_regions_of_opportunity():
    get = getter("tenders", {"reference": "cb-1", "amendment": "0", "regions_delivery_en": "*Canada\n*Esquimalt",
                             "regions_delivery_fr": "*Canada\n*Esquimalt", "regions_opportunity_en": "*Canada"})
    rec, _, _ = canadabuys_rows.common_fields(get)
    rec.update(canadabuys_rows.tender_fields(get, None))
    assert (rec["provinces"], rec["provinces_derived"], rec["provinces_from"]) == (None, '["BC"]', "delivery")
    get = getter("tenders", {"reference": "cb-2", "amendment": "0", "regions_opportunity_en": "*British Columbia",
                             "regions_opportunity_fr": "*Colombie-Britannique"})
    rec, _, _ = canadabuys_rows.common_fields(get)
    assert (rec["provinces"], rec["provinces_derived"]) == (None, None)
    rec.update(canadabuys_rows.tender_fields(get, None))
    assert (rec["provinces"], rec["provinces_derived"], rec["provinces_from"]) == (None, '["BC"]', "opportunity")


def test_an_award_reads_its_delivery_regions_only():
    get = getter("awards", {"reference": "a-1", "amendment": "0", "regions_delivery_en": "*Petawawa"})
    rec, _, _ = canadabuys_rows.common_fields(get)
    assert (rec["provinces"], rec["provinces_derived"], rec["provinces_from"]) == (None, '["ON"]', "delivery")


# -- the sweep --------------------------------------------------------------------------

def _tender(conn, ref, delivery, opportunity=None, provinces=None):
    conn.execute(
        "INSERT INTO tenders (reference, amendment, regions_delivery_en, regions_opportunity_en, provinces, source_file, "
        "first_seen, last_seen) VALUES (?, 0, ?, ?, ?, 'f', '2026-11-01', '2026-11-01')",
        (ref, json.dumps(delivery) if delivery else None, json.dumps(opportunity) if opportunity else None, provinces))


def test_the_sweep_derives_the_stored_rows_once_per_version(conn):
    _tender(conn, "T-CITY", ["Canada", "Esquimalt"])
    _tender(conn, "T-OPP", None, ["Nova Scotia"])
    _tender(conn, "T-STATED", ["Alberta"], provinces='["AB"]')
    conn.execute("INSERT INTO awards (reference, amendment, regions_delivery_en, source_file, first_seen, last_seen) "
                 "VALUES ('A-1', 0, '[\"Yellowknife\"]', 'f', 'd', 'd')")
    conn.commit()
    assert get_meta(conn, places.META_KEY) is None
    counts = places.ensure_current(conn)
    assert counts["tenders_changed"] == 2 and counts["awards_changed"] == 1 and counts["contract_history_changed"] == 0
    rows = {r[0]: tuple(r[1:]) for r in conn.execute(
        "SELECT reference, provinces, provinces_derived, provinces_from FROM tenders")}
    assert rows == {"T-CITY": (None, '["BC"]', "delivery"), "T-OPP": (None, '["NS"]', "opportunity"),
                    "T-STATED": ('["AB"]', None, None)}
    assert conn.execute("SELECT provinces_derived FROM awards").fetchone()[0] == '["NT"]'
    assert get_meta(conn, places.META_KEY) == str(places.PLACES_VERSION)
    assert [tuple(r) for r in conn.execute("SELECT source, rows_in FROM sources_log")] == [("places", 3)]
    # Current: nothing runs, nothing is logged.
    assert places.ensure_current(conn) is None
    assert conn.execute("SELECT COUNT(*) FROM sources_log").fetchone()[0] == 1


def test_a_new_database_takes_the_version_without_a_log_row(conn):
    assert places.ensure_current(conn) == {f"{t}_{k}": 0 for t, *_ in places.TABLES for k in ("changed", "derived")}
    assert conn.execute("SELECT COUNT(*) FROM sources_log").fetchone()[0] == 0


# -- the radar, the export, the feeds --------------------------------------------------

TODAY = date(2026, 11, 6)


def test_the_radar_carries_a_notices_derived_provinces_and_a_published_contracts_land_claims(conn):
    end = (TODAY + timedelta(days=30)).isoformat()
    org = organizations.upsert(conn, "Acme Ltd", source="awards")
    conn.execute(
        'INSERT INTO awards (reference, amendment, total_value, amount, currency, status, "end", supplier_raw, '
        "organization_id, provinces, provinces_derived, provinces_from, source_file, first_seen, last_seen) "
        "VALUES ('AW-1', 0, 5, 5, 'CAD', 'active', ?, 'Acme Ltd', ?, NULL, '[\"BC\"]', 'delivery', 'f', 'd', 'd')",
        (end, org))
    for ref, claims in (("C-NU", "NU"), ("C-NA", "NA")):
        conn.execute(
            "INSERT INTO contracts (owner_org, reference, vendor_raw, contract_date, delivery_date, value, land_claims, "
            "instrument_type, organization_id, loaded_at) VALUES ('dept', ?, ?, '2026-01-01', ?, 9, ?, 'C', ?, 's')",
            (ref, f"Vendor {ref}", end, claims, organizations.upsert(conn, f"Vendor {ref}", source="contracts")))
    expiring.compute(conn, today=TODAY, now="2026-11-06T01:00:00Z")
    rows = {r["source_key"]: r for r in conn.execute("SELECT * FROM expiring_contracts")}
    assert (rows["award:AW-1"]["provinces"], rows["award:AW-1"]["provinces_derived"],
            rows["award:AW-1"]["provinces_from"]) == ("[]", '["BC"]', "delivery")
    assert (rows["contract:dept:C-NU"]["provinces_derived"], rows["contract:dept:C-NU"]["provinces_from"]) == (
        '["NU"]', "land_claims")
    assert (rows["contract:dept:C-NA"]["provinces_derived"], rows["contract:dept:C-NA"]["provinces_from"]) == (None, None)


def test_the_export_writes_derived_codes_apart_and_only_where_there_are_some():
    row = {"provinces": ["ON"]}
    export_static._places(row, {"provinces_derived": '["AB", "ON"]', "provinces_from": "delivery"})
    assert row == {"provinces": ["ON"], "provinces_derived": ["AB"], "provinces_from": "delivery"}
    row = {"provinces": []}
    export_static._places(row, {"provinces_derived": None, "provinces_from": None})
    assert row == {"provinces": []}


def test_the_province_facet_counts_stated_or_derived():
    base = {"category": [], "segments": [], "buyer_id": None, "notice_type_en": None, "notice_type_fr": None,
            "method_en": None, "method_fr": None}
    rows = [{**base, "provinces": ["BC"]}, {**base, "provinces": [], "provinces_derived": ["BC"]},
            {**base, "provinces": ["ON"], "provinces_derived": ["AB"]}, {**base, "provinces": []}]
    facets = {f["value"]: f["n"] for f in export_static.tender_facets(rows)["province"]}
    assert facets == {"BC": 2, "ON": 1, "AB": 1}


def test_a_province_feed_takes_the_notices_derived_to_it(conn):
    conn.execute(
        "INSERT INTO tenders (reference, amendment, title_en, published, closing, provinces, provinces_derived, "
        "provinces_from, source_file, first_seen, last_seen) VALUES ('cb-9-1', 0, 'Jetty repair', '2026-11-05', "
        "'2026-12-01T14:00:00', NULL, '[\"BC\"]', 'delivery', 'f', '2026-11-05', '2026-11-05')")
    entries = feeds.tender_entries(conn, feeds._Lookups(conn), "2026-10-01", 50, today=TODAY)
    keys = {(s.kind, s.key) for e in entries for s in e.scopes}
    assert ("prov", "BC") in keys
