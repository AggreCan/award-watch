"""The person test (household.reads_as_person): a name of one or two people, and not a business.

Every name here is invented.
"""

import pytest

from awardwatch_pipeline.household import reads_as_person


@pytest.mark.parametrize("name", [
    "Ana Ferreira",
    "Walter Ian Penner",
    "Owen T Mercer",
    "J.R. Okafor",
    "NADIA OKONKWO",
    "lucia de la vega",
    "Santos, Maria",
    "Priya Sandhu, Arjun Sandhu",
    "Maria Clara Santos, Jose Luis Santos",
    "Tom Walsh and Erin Walsh",
    "Grace Mwangi (Peter Mwangi)",
    "Private Childcare/Reyes Family",
    # Surnames that are also words on the business list.
    "Mary White",
    "Daniel West",
])
def test_one_or_two_people_read_as_a_person(name):
    assert reads_as_person(name) is True


@pytest.mark.parametrize("name", [
    # Businesses named after their owner.
    "Penner Farms",
    "John Penner Farms Ltd.",
    "Harjit Gill Trucking",
    "Gill Transport Inc",
    "Rosa Lima Consulting Services",
    "Okafor Law",
    "Ana Ferreira o/a Little Steps Dayhome",
    "Ana Ferreira Childcare",
    "Maple Grove Seniors Society",
    "Sunrise Home Care Ltd.",
    "Bright Path Health Services",
    "Coopérative de solidarité de services à domicile de Laval",
    "CIUSSS de l'Estrie",
    "Aide chez soi Rive-Nord",
    "Corporation of the County of Lanark",
    "Cedar River First Nation",
    "1234567 Ontario Inc.",
    "9123-4567 Québec inc.",
    "Home sweet home",
    "Maple Grove Care Centre",
    "Penner Family Services Association",
])
def test_a_business_does_not(name):
    assert reads_as_person(name) is False


def test_names_that_are_not_names():
    for name in (None, "", "   ", "A B", "Ana", "Ana Maria Clara Lucia Santos", "Ana Ferreira #2", "Ana@Ferreira Care"):
        assert reads_as_person(name) is False, name


def test_the_business_words_can_be_narrowed():
    from awardwatch_pipeline.household import BUSINESS_WORDS

    assert reads_as_person("Okafor Law") is False
    assert reads_as_person("Okafor Law", business_words=BUSINESS_WORDS - {"law"}) is True
