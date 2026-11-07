"""match_key.py: the key the spelling rule joins on, the steps it records, and every guard.

Each guard has the pair of spellings it must keep apart: the false merges an
earlier form of the key made on the 2026-11-01 samples (the farm and firm
names here are invented in the same shapes, except the public institutions
and the two Bell companies the analysis named).
"""

import pytest

from awardwatch_pipeline.match_key import distinctive, edit_distance, match_key, strip_places


def key(name):
    k = match_key(name)
    return k.key if k else None


def steps(name):
    return set(match_key(name).steps)


@pytest.mark.parametrize("a, b, step", [
    ("GLIMMERPOST LTD", "GLIMMER POST LTD.", None),                                       # spacing (a group's step)
    ("Quillfeather Cnslt.Ltd.", "Quillfeather Consulting Ltd.", "abbreviation"),
    ("Vantorel Canada Limited/Vantorel Canada Limitée", "VANTOREL CANADA LTD", "both languages"),
    ("Corvane Limited (Power Systems)", "Corvane Limited", "words after the form"),
    ("BRIGHTMOOR LLP-CHARTERED ACCOUNTANTS", "Brightmoor LLP", "words after the form"),
    ("Brightmoor LLP, T4348", "Brightmoor LLP", "vendor code"),
    ("TALLOWAY CANADA INC. (445245)", "Talloway Canada Inc.", "vendor code"),
    ("Pellucid Water Systems Inc. (PWS)", "Pellucid Water Systems Inc.", "acronym"),
    ("Orrinwood Co-operative Ltd.", "ORRINWOOD COOPERATIVE LIMITED", None),             # "co-" is no company form
])
def test_spellings_of_one_organization_share_a_key(a, b, step):
    assert key(a) is not None and key(a) == key(b)
    if step:
        assert step in steps(a) and step not in steps(b)


@pytest.mark.parametrize("a, b", [
    # A joint venture, or a list of two companies, is a party of its own.
    ("IPSS Holdings Inc., Servicewell Inc.", "IPSS Holdings Inc."),
    ("Colliers Grove Inc. Tireefacility Solutions Inc. In Joint Venture", "Colliers Grove Inc."),
    ("Marrow Systems Ltd. and Pallet Consulting Inc.", "Pallet Consulting Inc."),
    # A legal form followed by "of" stays in the name.
    ("AC NIELSEN COMPANY OF CANADA", "ACNIELSEN COMPANY"),
    # A bracket after a name with no legal form stays (each division is its own corporation).
    ("COMMISSIONAIRES (NOVA SCOTIA DIVISION)", "COMMISSIONAIRES"),
    # A year in brackets is a successor company.
    ("WILDERNESS ROTORS (2009) LTD.", "WILDERNESS ROTORS LTD"),
    # A bracketed acronym is dropped only when it starts like the name.
    ("UNITED STATES DEPARTMENT OF THE NAVY (NAVICP)", "UNITED STATES DEPARTMENT OF THE NAVY (NAVAIR)"),
    # An operating name never makes a key.
    ("1019837 ONTARIO INC O/A DYNAMIC TEMPS CONSULTANTS", "DYNAMIC TEMPS CONSULTANTS"),
    # Quebec farms one letter apart are two farms.
    ("Ferme Duvalor inc.", "Ferme Duvalon inc."),
    # Bell Canada and Bell Textron share a first word, not a name.
    ("Bell Canada", "Bell Textron Canada Limited"),
    # A bracket before the legal form is part of the name.
    ("Thermo Quill Scientific (Mississauga) Inc.", "Thermo Quill Scientific Inc."),
])
def test_the_guards_keep_these_pairs_apart(a, b):
    assert key(a) != key(b)


@pytest.mark.parametrize("name", [
    "University of Toronto", "University of Ottawa", "City of Ottawa",                     # place words only
    "Canadian Services Ltd.", "Western Holdings Inc.",                                     # generic words only
    "Northwind Foods Limited Partnership Canada", "Pim Consortium",                       # a party of its own
    "IPSS Holdings Inc., Servicewell Inc.",
])
def test_no_key_without_a_distinctive_word_or_for_a_party_of_its_own(name):
    assert match_key(name) is None


def test_the_universities_never_meet_by_their_place_words():
    # The rejected place-stripping rule put twelve universities into one; the key gives none of them a key.
    names = ["University of Toronto", "University of Ottawa", "University of Calgary", "University of Manitoba"]
    assert {key(n) for n in names} == {None}


def test_the_key_is_the_first_party_without_its_form():
    k = match_key("Vantorel Canada Limited/Vantorel Canada Limitée")
    assert (k.key, k.words) == ("vantorelcanada", ("vantorel", "canada"))
    assert key("Enterprise Car Rental Canada Company") == key("Enterprise Car Rental Canada Limited")
    assert key("1234567 Ontario Inc.") == "1234567ontario"  # a company number of five digits or more is distinctive


def test_distinctive_words_strip_places_and_the_edit_distance():
    assert distinctive("glimmerpost") and distinctive("12345")
    assert not any(distinctive(w) for w in ("the", "canada", "ottawa", "services", "inc", "ab", "1234", "division"))
    assert strip_places(("cofomo", "ottawa")) == ("cofomo",)
    assert strip_places(("chicken", "farmers", "of", "ontario")) == ("chicken", "farmers")
    assert edit_distance("keplercommunicatons", "keplercommunications") == 1
    assert edit_distance("abcd", "abdc") == 1                 # a transposition counts one
    assert edit_distance("adirondak", "adirondack") == 1
    assert edit_distance("unisourcetechnology", "unisourcetechnologies") is None  # three edits
