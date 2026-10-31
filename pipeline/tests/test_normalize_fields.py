"""The field helpers the CanadaBuys and proactive-publication loaders share, and the person
test as it reads supplier names."""

import pytest

from awardwatch_pipeline.normalize import (
    has_legal_form, norm_name,
    award_status, competitive, competitive_code, country_code, iso_datetime, money, org_id, region_provinces,
    slugify, squash, star_list, tender_status,
)
from awardwatch_pipeline.sources import matching
from awardwatch_pipeline.sources.matching import is_person_name, is_placeholder


def test_star_list():
    assert star_list("*Canada\n*Ontario (except NCR)\n*Petawawa") == ["Canada", "Ontario (except NCR)", "Petawawa"]
    assert star_list("*a\r\n*b") == ["a", "b"]
    assert star_list("Lowest Price") == ["Lowest Price"]
    assert star_list("*Manufacturing   technology\nresearch") == ["Manufacturing technology research"]
    assert star_list("*a\n*\n* b ") == ["a", "b"]
    assert star_list("") == [] and star_list(None) == [] and star_list("  \n ") == []


@pytest.mark.parametrize("regions, provinces", [
    (["National Capital Region (NCR)"], ["ON", "QC"]),
    (["Région de la capitale nationale (RCN)"], ["ON", "QC"]),
    (["Canada", "Ontario (except NCR)", "Petawawa"], ["ON"]),
    (["Québec (sauf RCN)", "Colombie-Britannique"], ["BC", "QC"]),
    (["Nunavut Territory", "Territoire du Nunavut", "Yukon", "Territoires du Nord-Ouest"], ["NT", "NU", "YT"]),
    (["Nova Scotia", "Nouvelle-Écosse", "Prince Edward Island", "Île-du-Prince-Édouard"], ["NS", "PE"]),
    (["Newfoundland and Labrador", "Terre-Neuve-et-Labrador", "New Brunswick"], ["NB", "NL"]),
    (["Dundurn", "Saskatchewan"], ["SK"]),
    (["Canada"], []),
    (["", "  ", "Ottawa", "Montréal", "United States of America", "World", "Capitale-Nationale (Québec)"], []),
    ([], []),
])
def test_region_provinces(regions, provinces):
    assert region_provinces(regions) == provinces


def test_competitive_from_the_method():
    assert competitive("Competitive - Open bidding") == 1
    assert competitive("Competitive - Selective tendering") == 1
    assert competitive("Competitive - Traditional") == 1
    assert competitive("Non-competitive") == 0
    assert competitive("Advance contract award notice") == 0
    assert competitive("Préavis d'adjudication de contrat") == 0
    assert competitive("Concurrentiel - Appel d'offres ouvert") == 1
    assert competitive("") is None and competitive(None) is None and competitive("Not Applicable") is None


def test_competitive_from_the_solicitation_code():
    assert [competitive_code(c) for c in ("TN", "AC", "OB", "TC", "ST", " tn ", "", None, "XX")] == \
        [0, 0, 1, 1, 1, 0, None, None, None]


def test_statuses():
    assert [tender_status(s) for s in ("Open", "Ouvert", "Expired", "Expiré", "Cancelled", "Annulé", "Awarded",
                                       "Attribué", "", None, "Pending")] == \
        ["open", "open", "expired", "expired", "cancelled", "cancelled", "awarded", "awarded", "unknown", "unknown",
         "unknown"]
    assert [award_status(s) for s in ("Active", "Actif", "Expired", "Expiré", "Cancelled", "Annulé", "", "Open")] == \
        ["active", "active", "expired", "expired", "cancelled", "cancelled", "unknown", "unknown"]


@pytest.mark.parametrize("raw, code", [
    ("CA", "CA"), ("Canada", "CA"), ("CANADA", "CA"), ("Canada ", "CA"), ("canada", "CA"), ("CAN", "CA"),
    ("US", "US"), ("USA", "US"), ("United States", "US"), ("U.S.A.", "US"), ("United States of America", "US"),
    ("GB", "GB"), ("no", "NO"), ("GB-ENG", "GB"),
    ("United Kingdom", None), ("Ireland", None), ("", None), (None, None), ("DEU", None),
])
def test_country_code(raw, code):
    assert country_code(raw) == code


def test_money():
    assert money("1234.50") == 1234.5
    assert money("$1,234.50") == 1234.5
    assert money(" 0.00 ") == 0.0
    assert money("-17476.20") == -17476.2
    assert money("(100.00)") == -100.0
    assert money(12) == 12.0
    for blank in ("", "  ", None, "nan", "inf", "-inf", "abc", True):
        assert money(blank) is None, blank


def test_iso_datetime_keeps_the_value_as_published():
    assert iso_datetime("2026-11-16T14:00:00") == "2026-11-16T14:00:00"
    assert iso_datetime("2026-11-16T14:00") == "2026-11-16T14:00"
    assert iso_datetime("2026-11-16 14:00:00") == "2026-11-16T14:00:00"
    assert iso_datetime("2026-11-16T14:00:00Z") == "2026-11-16T14:00:00Z"
    assert iso_datetime("2026-11-16T14:00:00-05:00") == "2026-11-16T14:00:00-05:00"
    assert iso_datetime("2026-11-16") == "2026-11-16"
    assert iso_datetime("") is None and iso_datetime(None) is None and iso_datetime("16/11/2026") is None


def test_org_id_slugify_squash():
    assert org_id("simex defence") == org_id("simex defence") != org_id("simex defense")
    assert org_id("simex defence").startswith("org-") and len(org_id("x")) == 14
    assert slugify("Department of National Defence") == "department-of-national-defence"
    assert slugify("Société du Vieux-Port de Montréal") == "societe-du-vieux-port-de-montreal"
    assert squash("  a \n b\t") == "a b" and squash(None) == ""


# The operator's policy: a name is a private individual's only when it has no
# connector, at most three words, no digit, no legal form and no business word.
@pytest.mark.parametrize("name", [
    "Kongsberg Defence and Aerospace AS", "Rio Tinto Fer et Titane", "Simex Defence Inc", "Donna Cona Inc.",
    "Asokan Business Interiors",
])
def test_the_policy_cases_that_are_kept(name):
    assert is_person_name(name) is False


@pytest.mark.parametrize("name", ["John Smith", "Smith, John A."])
def test_the_policy_cases_that_are_withheld(name):
    assert is_person_name(name) is True


def test_a_connector_always_means_a_business():
    # The choice the policy makes: a connector joins the names in a firm's
    # ("Ernst & Young"), so two people named together are kept as well. A
    # person read as a business costs a published name; the policy accepts
    # that cost for these names rather than withhold the many firms built the
    # same way.
    for name in ("Jean Tremblay et Marie Roy", "Tom Walsh and Erin Walsh", "Ernst & Young", "Turner & Townsend"):
        assert is_person_name(name) is False, name


def test_more_than_three_words_is_a_business():
    assert is_person_name("Maria Clara Santos") is True
    assert is_person_name("Maria Clara Santos Pereira") is False
    # Two people written with a comma are each within the limit, so both are
    # withheld; a connector would have made it a firm (the test above).
    assert is_person_name("Priya Sandhu, Arjun Sandhu") is True


def test_cased_company_forms_strip_only_as_written():
    # "AS", "AB", "Oy", "SpA" are company forms only when written as such; in
    # their ordinary case they are words of the name and stay.
    assert norm_name("Kongsberg Defence and Aerospace AS") == "kongsberg defence aerospace"
    assert norm_name("Fincantieri S.p.A.") == "fincantieri"
    assert norm_name("ICEYE Oy") == "iceye"
    assert norm_name("Saab AB") == "saab"
    assert norm_name("Nordik Spa") == "nordik spa"
    assert norm_name("Prairie Ag") == "prairie ag"
    assert norm_name("Heinz Walz GmbH") == "heinz walz"
    assert has_legal_form("Saab AB") and has_legal_form("ICEYE Oy")
    assert not has_legal_form("Nordik Spa")


@pytest.mark.parametrize("name", [
    "Leavitt Machinery", "Polytechnique Montréal", "Bell Mobility", "Toromont Material Handling", "Heinz Walz GmbH",
    "ICEYE Oy", "Elsevier B. V.", "Bruhn NewTech A/S", "SIA \"STONEWIN\"", "Provencher_Roy", "Valor BPS",
    "SIMEX DEFENCE", "Esri Canada Limited", "Automation Toronto", "Hatch", "Agent 99 Studio",
])
def test_supplier_names_that_are_businesses(name):
    assert is_person_name(name) is False


@pytest.mark.parametrize("name", [
    "Ana Ferreira", "Dr. Ana Ferreira", "FERREIRA, ANA", "Ana Ferreira dba Little Steps Consulting",
    "Owen Mercer o/a Mercer Translation Services",
])
def test_supplier_names_that_are_people(name):
    assert is_person_name(name) is True


def test_the_list_of_names_the_test_reads_wrongly(tmp_path, monkeypatch):
    listed = tmp_path / "not_persons.csv"
    listed.write_text("# names that are firms\nmodest tree\nWords Your Way\n", encoding="utf-8")
    monkeypatch.setattr(matching, "NOT_PERSONS_PATH", listed)
    matching.not_persons.cache_clear()
    try:
        assert matching.not_persons() == {"modest tree", "words your way"}
        assert is_person_name("Modest Tree") is False and is_person_name("MODEST TREE") is False
        assert is_person_name("Owen Mercer") is True
    finally:
        matching.not_persons.cache_clear()


def test_the_committed_list_reads():
    assert isinstance(matching.not_persons(), frozenset)


def test_withheld_names_are_counted_and_the_first_are_listed_for_review(tmp_path):
    drops = matching.PersonDrops(limit=2)
    for name in ("Owen Mercer", "Ana Ferreira", "Owen Mercer", "John Smith"):
        drops.add(name)
    path = tmp_path / "review" / "awards-persons.txt"
    line = drops.write(path, what="CanadaBuys awards", stamp="2026-10-31T00:00:00Z")
    assert line.startswith("4 rows (3 names) read as private individuals") and "Owen Mercer" not in line
    listed = [l for l in path.read_text(encoding="utf-8").splitlines() if not l.startswith("#")]
    assert listed == ["Owen Mercer", "Ana Ferreira"]
    assert matching.PersonDrops().write(path, what="x", stamp="t") is None and not path.exists()


def test_placeholders_are_neither_a_person_nor_a_name():
    for raw in ("NA : None", "N/A", "n/a", "None", "NA", "-", "unknown"):
        assert is_placeholder(raw) and not is_person_name(raw), raw
    assert not is_placeholder("NAV Canada") and not is_placeholder("Nana Foods")
