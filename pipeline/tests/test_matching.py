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


def test_a_new_person_test_makes_every_loader_read_its_files_again(conn):
    from datetime import datetime, timezone

    from awardwatch_pipeline import config
    from awardwatch_pipeline.db import get_meta, set_meta
    from awardwatch_pipeline.sources import canadabuys

    skip_keys = [f"canadabuys:{config.AWARDS_FY_FILE.format(fy='2026-2027')}:{item}"
                 for item in ("sha256", "etag", "last_modified", "read_at")]
    skip_keys += [f"{stage}:{item}" for stage in ("contracts", "grants", "lobbying")
                  for item in ("sha256", "etag", "last_modified", "rejected", "seed_sha256", "archive_sha256")]
    skip_keys += ["contracts_loaded_at", "grants_loaded_at", "lobbying_loaded_at"]
    for key in skip_keys:
        set_meta(conn, key, "x")
    set_meta(conn, "lobbying:refused_until", "2026-11-08")  # a refusal is still honoured
    set_meta(conn, "lobbying:file_date", "2026-11-02T06:25:12")  # an older copy is still never read
    set_meta(conn, matching.PERSON_TEST_KEY, str(matching.PERSON_TEST_VERSION - 1))
    conn.execute("INSERT INTO awards (reference, amendment, source_file, first_seen, last_seen) "
                 "VALUES ('r', 0, 'f', '2026-10-24', '2026-10-24')")
    conn.commit()
    night = datetime(2026, 11, 1, 1, tzinfo=timezone.utc)

    assert matching.refresh_person_test(conn) is True
    assert [k for k in skip_keys if get_meta(conn, k) is not None] == []
    assert get_meta(conn, "lobbying:refused_until") == "2026-11-08"
    assert get_meta(conn, "lobbying:file_date") == "2026-11-02T06:25:12"
    assert get_meta(conn, matching.PERSON_TEST_KEY) == str(matching.PERSON_TEST_VERSION)
    # The legacy file, read only on a first load otherwise, is planned again, and so is the complete file.
    assert [f.kind for f in canadabuys.plan(conn, "awards", night)] == ["legacy", "complete", "fy"]
    # Once the version is stored, nothing more is cleared.
    set_meta(conn, "contracts:sha256", "y")
    assert matching.refresh_person_test(conn) is False
    assert get_meta(conn, "contracts:sha256") == "y"



# The six shapes that passed the person test before version 7, with invented names (the given names are on
# the list, the surnames on none). Each was a private individual published under a firm's profile.
SIX_PATTERNS = {
    "person (firm with a legal form)": "Quentaro, Laura (Zorblax Holdings Ltd.)",
    "person (s/n farm)": "Marie Brisavel (s/n Ferme Brisavel)",
    "person s/n farm, no bracket": "Marie Brisavel s/n Ferme du Ruisseau",
    "person (farm)": "Paul Tolmandre (Ferme Tolmandre)",
    "person (o/a name with and)": "Anne Ostrevik (o/a Ostrevik and Daughters Catering)",
    "people listed with slashes": "Laura Quentaro/Marie Brisavel/Paul Tolmandre/Anne Ostrevik/Louis Dunmarrow",
    "SURNAME GIVEN GIVEN": "PELLIVANT LOUIS MARIE",
    "Given and Given Surname": "Laura and Paul Corrabin",
    "Given et Given Surname": "Marie et Louis Corrabin",
}


@pytest.mark.parametrize("name", SIX_PATTERNS.values(), ids=SIX_PATTERNS.keys())
def test_the_six_shapes_that_used_to_pass_are_withheld(name):
    assert matching.is_person_name(name) is True
    assert matching.business_name(name) is None


@pytest.mark.parametrize("name", [
    "9123-4567 Québec inc. s/n Ferme Brisavel",     # a numbered company trading as a farm
    "Thermo Quill Scientific (Mississauga) Inc.",    # a bracket before the legal form
    "Pellucid Water Systems Inc. (PWS)",             # a firm with its acronym
    "Morgan Corker Varnholt (MCV)",                  # surnames of a firm, its acronym in brackets
    "Rose and Thistle Pub",                          # "and" between a given name and a firm's words
    "Varnholt & Corrabin",                           # two surnames joined: a firm
    "FERBLANTERIE LOUIS MARIE",                      # a trade written before the owner's name
    "Zorblax Holdings Ltd./Corrabin Foods Inc.",     # two firms with a slash
    "Zorblax A/S",                                   # a form written with its slash
])
def test_the_new_readings_leave_these_firms_alone(name):
    assert matching.is_person_name(name) is False


def test_the_legal_part_is_read_before_s_n_and_without_a_bracket_that_ends_the_name():
    assert matching.person_legal_part("Marie Brisavel (s/n Ferme Brisavel)") == "Marie Brisavel"
    assert matching.person_legal_part("Marie Brisavel S/N Ferme du Ruisseau") == "Marie Brisavel"
    assert matching.person_legal_part("Quentaro, Laura (Zorblax Holdings Ltd.)") == "Quentaro, Laura"
    assert matching.person_legal_part("Anne Ostrevik (o/a Ostrevik and Daughters)") == "Anne Ostrevik"
    # An acronym or a number in the bracket stays, as before.
    assert matching.person_legal_part("Morgan Corker Varnholt (MCV)") == "Morgan Corker Varnholt (MCV)"
    # norm_name does not split on "s/n" (that would move ids): the identity is unchanged.
    from awardwatch_pipeline.normalize import norm_name
    assert norm_name("9123-4567 Québec inc. s/n Ferme Brisavel") == "9123 4567 quebec inc sn ferme brisavel"


def test_a_withheld_name_of_each_new_shape_is_taken_out_of_free_text():
    assert matching.redact("Paid to Paul Corrabin and to Laura Corrabin", ["Laura and Paul Corrabin"]) == \
        ("Paid to [name withheld] and to [name withheld]", 2)
    assert matching.redact("Louis Marie Pellivant, owner", ["PELLIVANT LOUIS MARIE"])[1] == 1
    assert matching.redact("Laura Quentaro of Zorblax Holdings Ltd.", ["Quentaro, Laura (Zorblax Holdings Ltd.)"]) == \
        ("[name withheld] of Zorblax Holdings Ltd.", 1)
    assert matching.redact("Marie Brisavel, Ferme Brisavel", ["Marie Brisavel (s/n Ferme Brisavel)"]) == \
        ("[name withheld], Ferme Brisavel", 1)


def test_the_bracketed_firm_switch(monkeypatch, conn):
    from awardwatch_pipeline.db import get_meta
    name = SIX_PATTERNS["person (firm with a legal form)"]
    # The default withholds the whole name: nothing is filed under the firm.
    assert matching.PERSON_WITH_FIRM == "withhold"
    assert matching.filed_name(name) == (name, None)
    assert matching.person_test_stamp() == str(matching.PERSON_TEST_VERSION)
    assert matching.person_with_firm(name) == ("Quentaro, Laura", "Zorblax Holdings Ltd.")
    assert matching.refresh_person_test(conn) is True and matching.refresh_person_test(conn) is False
    # The one-line switch files the record under the firm and hands back the person to take out of its text.
    monkeypatch.setattr(matching, "PERSON_WITH_FIRM", "firm")
    assert matching.filed_name(name) == ("Zorblax Holdings Ltd.", "Quentaro, Laura")
    assert matching.is_person_name(name) is True  # the whole string still names the person
    # A farm or trade name without a legal form is no firm to file under: still withheld whole.
    farm = SIX_PATTERNS["person (farm)"]
    assert matching.filed_name(farm) == (farm, None)
    # Flipping it changes the stored version, so the next run reads every file again.
    assert matching.person_test_stamp() == f"{matching.PERSON_TEST_VERSION}-firm"
    assert matching.refresh_person_test(conn) is True
    assert get_meta(conn, matching.PERSON_TEST_KEY) == f"{matching.PERSON_TEST_VERSION}-firm"


def test_a_name_that_carries_an_email_address_is_withheld():
    from awardwatch_pipeline.sources import matching
    for name in ("labanalyzer@example.invalid", "Canada@softreseller.example.invalid", "sbuyer@example.invalid",
                 "Le_petit_traiteur@example.invalid",
                 "Ionicon Analytk Gesellschaft m.b.H. Eduard-Bodem-Gasse 3 6020 Innsbruck Austria office@example.invalid"):
        assert matching.is_person_name(name), name
        assert matching.business_name(name) is None
    # An at sign that is no address leaves the name to the rest of the test.
    assert not matching.is_person_name("Smith @ Home Renovations Ltd")
