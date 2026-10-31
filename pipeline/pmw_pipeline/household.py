"""Does a name read as one or two private people? The person test every source shares.

Private individuals are never stored (rule 3 of the project): a supplier,
recipient or lobbying client whose name reads as a person is dropped before
anything is written. sources/matching.is_person_name applies this test to the
legal part of a name.

A name reads as a person when it has two to four name words (particles and
honorifics aside), or splits on ", ; / & ( ) + and et" into two or three
parts that each do, and carries no legal form, no number, no trade-name
marker and no business word. The test errs toward dropping: a sole
proprietorship named only by its owner is left out, and costs one record; a
person read as a business would be published.

The word lists were first built for names that carry a household occupation,
where the choice is between a person and a care business; each word in them
marks a business in public records too. sources/matching.py adds the words
supplier names need.
"""

from __future__ import annotations

import re

from .exclusions import BUSINESS_TOKENS, name_words
from .normalize import LEGAL_SUFFIXES, fold_accents, has_legal_form, is_numbered_company, split_trade_name

# Words that mark a business. exclusions.BUSINESS_TOKENS is the base, less
# the words that are also common names or name particles: a person called
# White, West or de Vries must still read as a person. "and" and "et" join two
# people here, so they are not business words.
NAME_LIKE_WORDS = {
    "and", "et", "de", "du", "des", "la", "le",
    "white", "black", "green", "red", "blue", "golden", "best", "house", "lodge",
    "barber", "glass", "steel", "fish", "honey", "berry", "marine", "temple",
    "church", "west", "east", "north", "south",
}

# Home care agencies, care homes, co-operatives, societies, health
# authorities, First Nations, municipalities, agencies and the like. "law" is
# a business word here because firms appear as "<surname> Law"; the public
# records test (sources/matching.PUBLIC_BUSINESS_WORDS) takes it out.
CARE_SECTOR_WORDS = {
    "care", "caring", "carehome", "caregiver", "caregivers", "nanny", "nannies",
    "childcare", "homecare", "homemakers", "home", "healthcare", "nursing",
    "nurse", "nurses", "rehab", "support", "supports", "supportive", "assistance",
    "assisted", "living", "lifestyles", "senior", "seniors", "retirement",
    "residence", "residences", "residential", "resthome", "manor", "estate",
    "estates", "villa", "village", "community", "communities", "resources",
    "agency", "employment", "personnel", "immigration", "institute", "ministry",
    "cooperative", "coop", "solidarite", "aide", "soutien", "domicile", "foyer",
    "development", "law", "legal", "special", "needs", "independence",
    "independent", "families", "nation", "nations", "county", "municipality",
    "city", "district", "government", "authority", "ciusss", "cisss", "program",
    "programs", "concierge", "lodging", "hotels", "entertainment", "parenting",
    "facility", "facilities", "relations", "supply", "retreat", "glamping",
    "comfort", "staff",
    # Child care and placement businesses, in both languages.
    "dayhome", "dayhomes", "preschool", "montessori", "playschool", "kids",
    "children", "placement", "recruitment", "recruiting", "garderie",
    "garderies", "cpe", "agence", "gestion", "ressource", "ressources",
    "habitation", "soins", "sante", "accueil", "accueils", "entretien",
    "menage", "chateau", "manoir",
}


def _key(word: str) -> str:
    """'Ltée' -> 'ltee', 'S.E.N.C' -> 'senc', "O'Neil" -> 'oneil': the form words are compared in."""
    return re.sub(r"['’.]", "", fold_accents(word.casefold()))


BUSINESS_WORDS = frozenset({_key(w) for w in BUSINESS_TOKENS} - NAME_LIKE_WORDS | CARE_SECTOR_WORDS)
LEGAL_WORDS = frozenset(LEGAL_SUFFIXES)

# Words that join a name without being one: particles and honorifics. They
# neither count toward the two to four words nor mark a business.
NAME_PARTICLES = {
    "de", "da", "das", "do", "dos", "du", "del", "della", "di", "van", "von", "der",
    "den", "ter", "ten", "la", "le", "st", "ste", "bin", "binti", "ibn", "al", "el",
    "y", "mr", "mrs", "ms", "miss", "dr", "mme", "mlle",
}

# A household sometimes describes itself next to the name ("Private
# Childcare/Reyes Family"); the description is set aside before the name is
# read, and "family" or "famille" counts as a name word.
HOUSEHOLD_PHRASE_RE = re.compile(
    r"\bprivate (?:child ?care|household|home|residence|family)\b|\b(?:household|particulier|menage prive)\b",
    re.I,
)
# What joins two people in one name: "A, B", "A and B", "A & B", "A / B",
# "A (B)".
PERSON_SEPARATOR_RE = re.compile(r"\s*(?:[,;/&()+]|\band\b|\bet\b)\s*", re.I)


def _person_shape(words: list[str]) -> bool:
    """Two to four name words besides particles, at least one longer than an initial."""
    counted = [w for w in words if _key(w) not in NAME_PARTICLES]
    if not 2 <= len(counted) <= 4:
        return False
    return any(len(_key(w)) >= 2 for w in counted)


def reads_as_person(name: str | None, *, business_words: frozenset[str] = BUSINESS_WORDS) -> bool:
    """True when a name reads as one or two people and not as a business.

    It reads some short trade names ("Silo Films") as people; that costs one
    record, where a person read as a business would be published. The
    public-record sources (sources/matching.py) pass a smaller set of business
    words for the same reason.
    """
    if not name or not name.strip():
        return False
    text = re.sub(r"\s+", " ", fold_accents(name)).strip()
    if is_numbered_company(text) or has_legal_form(text) or re.search(r"[\d@#]", text):
        return False
    # "John Smith o/a Smith Farms": a trade name means a business.
    if split_trade_name(text)[1] is not None:
        return False
    text = HOUSEHOLD_PHRASE_RE.sub(" ", text)
    words = name_words(text)
    keys = [_key(w) for w in words]
    if not keys or any(k in LEGAL_WORDS or k in business_words for k in keys):
        return False
    if _person_shape([w for w, k in zip(words, keys) if k not in {"and", "et"}]):
        return True
    # Two people of two or three words each ("Maria Clara Santos, Jose Luis
    # Santos") run past four words; read each side as its own person.
    parts = [p for p in PERSON_SEPARATOR_RE.split(text) if name_words(p)]
    return 2 <= len(parts) <= 3 and all(_person_shape(name_words(p)) for p in parts)
