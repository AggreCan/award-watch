import pytest

from pmw_pipeline.exclusions import BUSINESS_TOKENS, looks_like_person, name_words


@pytest.mark.parametrize("name", [
    "Luigi Gallo",
    "Nidhi Dua",
    "Jia Ji Liu",
    "Manoj K. Talwar",
    "Jane Smith",
    "Mary Ann Jones",
])
def test_two_or_three_plain_words_look_like_a_person(name):
    assert looks_like_person(name) is True


@pytest.mark.parametrize("name", [
    "Amazing Prices",
    "Bolivar Farms",
    "HananTransport",
    "Harveys/Swiss Chalet",
    "Arseno",
    "IV CROWNS GROUP CORP.",
    "Les Pavillons LaSalle",
    "PinkCloud Cleaning & Home Services",
    "Restaurant St-Hubert Sept-Îles",
    "Tremel Greenhouses",
    "S & S Orchards Ltd",
    "Edsa Mini Mart",
])
def test_a_business_marker_or_shape_does_not(name):
    assert looks_like_person(name) is False


def test_looks_like_person_edge_cases():
    assert looks_like_person("") is False
    assert looks_like_person(None) is False
    assert looks_like_person("A B C D") is False
    assert looks_like_person("15243921 CANADA INC.") is False


def test_name_words_keep_apostrophes_dots_and_hyphens_inside_a_word():
    assert name_words("Marie-Claude O'Neil, J.R.") == ["Marie-Claude", "O'Neil", "J.R"]
    assert "inc" in BUSINESS_TOKENS and "ltée" in BUSINESS_TOKENS
