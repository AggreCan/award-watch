"""The person test's given-name requirement and its exceptions, placeholders, and the review list's wording.

The firms and people below are spellings from the 2026-10-31 samples that
the person test once read wrongly or must keep reading as people; every
other name is invented ("Zorblax Quentaro" carries a given name on no list).
"""

import pytest

from awardwatch_pipeline.sources import matching

FIRMS = ["Eastern Partitions", "Pantheon Platform", "Plain Language Wizardry", "Accessibility Now", "Surrey Place",
         "Pizzey Ingredients", "Manitoba Agriculture", "Suncrest Hutterian Brethren"]
PEOPLE = ["Richard Tremblay", "Beauchemin, Mario", "Ms. Dawn Streutker", "Bart Nelson", "Taghreed ZuhairAl-Zubaidi",
          "Al-Zubaidi, Taghreed Zuhairal"]


@pytest.mark.parametrize("name", FIRMS)
def test_a_firm_without_a_given_name_is_kept(name):
    assert matching.is_person_name(name) is False
    assert matching.business_name(name) == name


@pytest.mark.parametrize("name", PEOPLE)
def test_a_person_is_withheld(name):
    assert matching.is_person_name(name) is True
    assert matching.business_name(name) is None


@pytest.mark.parametrize("name, person", [
    ("Zorblax Quentaro", False),            # no given name on the list
    ("Laura Quentaro", True),               # the first word is one
    ("LAURA QUENTARO", True),
    ("Marie-Zorblax Quentaro", True),       # the first part of a compound given name
    ("Hélène Quentaro", True),              # accents fold
    ("Doug Quentaro", True),                # a short form no birth register holds
    ("Quentaro, Laura Zorblax", True),      # "Last, First"
])
def test_the_given_name_is_the_first_word_or_the_one_after_the_comma(name, person):
    assert matching.is_person_name(name) is person


@pytest.mark.parametrize("name", [
    "Mr. Zorblax Quentaro", "Mme Zorblax Quentaro", "M. Zorblax Quentaro", "Me Zorblax Quentaro",
    "Dr Zorblax Quentaro",                          # a courtesy title, whatever the list says
    "Quentaro, Zorblax", "Quentaro, Zorblax Pim",   # "Last, First" in two or three words
    "Zorblax Al-Quentaro", "Zorblax El-Quentaro",   # the Arabic article joined to a surname
    "J. Quentaro", "J.R. Quentaro", "W.Zorblax Quentaro", "Zorblax Q. Quentaro", "Ed Quentaro",  # initials, two letters
])
def test_the_exceptions_read_as_people_whatever_the_list_says(name):
    assert matching.is_person_name(name) is True


def test_the_other_conditions_still_come_first():
    # A business word, a legal form or a connector makes a firm, title or not.
    for name in ("Dr. Laura Dental", "Laura Quentaro Inc.", "Laura & Zorblax Quentaro", "Mr. Quentaro Consulting"):
        assert matching.is_person_name(name) is False, name


def test_without_the_list_every_name_that_passes_the_rest_is_a_person(monkeypatch):
    monkeypatch.setattr(matching, "given_names", lambda path=None: frozenset())
    assert matching.is_person_name("Eastern Partitions") is True
    assert matching.is_person_name("Zorblax Quentaro") is True


def test_the_list_is_folded_and_names_its_sources():
    text = matching.GIVEN_NAMES_PATH.read_text(encoding="utf-8")
    header = [line for line in text.splitlines() if line.startswith("#")]
    assert any("INSEE" in line for line in header) and any("Retraite Québec" in line for line in header)
    assert any("Social Security" in line for line in header)  # used or, when refused, named as not used
    names = matching.given_names()
    assert len(names) > 5000
    assert {"richard", "mario", "bart", "laura", "helene", "jean-pierre"} <= names
    assert all(n == matching.given_name_key(n) and len(n.replace("-", "")) > 2 for n in names)
    assert not names & matching.PUBLIC_BUSINESS_WORDS
    assert matching.given_name_key("D'Arcy") == "darcy" and matching.given_name_key("JEAN-PIERRE") == "jean-pierre"


@pytest.mark.parametrize("name", [
    "Request for Proposal", "REQUEST FOR PROPOSALS", "Request for Standing Offer", "RFP", "Various", "Multiple",
    "Multiple vendors", "See attached.", "To be determined", "TBD", "***", " - ", "N/A", "NA : None",
])
def test_placeholders_are_no_name(name):
    assert matching.is_placeholder(name) is True
    assert matching.is_person_name(name) is False
    assert matching.business_name(name) is None


def test_a_name_that_only_starts_like_a_placeholder_is_a_name():
    for name in ("Various Artists Collective Ltd.", "Multiple Sclerosis Society of Canada", "RFP Solutions Inc."):
        assert matching.is_placeholder(name) is False
        assert matching.business_name(name) == name


def test_the_review_list_says_what_was_withheld(tmp_path):
    drops = matching.PersonDrops()
    drops.add("Laura Quentaro")
    notice = drops.write(tmp_path / "x.txt", what="Test", stamp="2026-10-31T00:00:00Z", withheld="recipient withheld")
    assert notice.startswith("1 rows (1 names) read as private individuals, recipient withheld; ")
    default = drops.write(tmp_path / "y.txt", what="Test", stamp="2026-10-31T00:00:00Z")
    assert "supplier withheld" in default
