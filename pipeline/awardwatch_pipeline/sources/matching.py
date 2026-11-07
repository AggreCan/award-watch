"""Shared rules for reading names and places off public records and joining them to organizations.

Every supplier, recipient and lobbying client is merged into one
`organizations` row on its normalized legal name (organizations.upsert). The
helpers here decide what a record's name and place are before that happens,
and grade a join where a record has to be matched to an organization by name
and place rather than by its own name (the corporate registries):

* exact: the record's legal name normalizes to the organization's name and the
  record's place key agrees with a place on the organization's own records
  (the postal code, the postal area or the city, depending on the source);
* probable: the legal name agrees and only the province does, or a name the
  record operates under agrees together with the place key.

A name alone never makes a graded match, and a name that is one word or made
only of generic business words ("Sunrise", "West Coast Services") needs the
place key, since a province holds many businesses called that.

Private individuals are never stored (rule 3 of the project): when a
record's name reads as a person (is_person_name), the name and everything that
locates the person are withheld before anything is written, only the count is
logged, and an operating name that reads as a person is not kept. The test is
conservative on purpose: a firm withheld as a person disappears from the
site, so a name is a person's only when nothing in it says otherwise.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from .. import config
from ..exclusions import BUSINESS_TOKENS
from ..household import BUSINESS_WORDS, CARE_SECTOR_WORDS, reads_as_person
from ..normalize import (
    POSTAL_PROVINCE, POSTAL_RE, PROVINCE_CODES, fold_accents, format_postal, has_legal_form, norm_legal,
    norm_name, province_code, split_trade_name,
)

EXACT = "exact"
PROBABLE = "probable"
GRADE_RANK = {EXACT: 0, PROBABLE: 1}



def _key(word: str) -> str:
    return re.sub(r"['’.]", "", fold_accents(word.casefold()))


# Words naming what a firm sells or does, in English and French, added from
# the supplier names of the CanadaBuys award and contract-history files of
# 2026-27 that the household word lists read as people ("Leavitt Machinery",
# "Asokan Business Interiors", "Polytechnique Montréal"). None is a common
# given name or surname; words that are ("Power", "Bird", "Ford", "Crystal")
# are left out, so "J.D. Power" is still dropped.
SUPPLIER_WORDS = {
    "business", "interiors", "interior", "machinery", "machines", "enclosures", "leasing", "lease", "rental",
    "rentals", "supplies", "supplier", "suppliers", "diesel", "turbine", "turbines", "air", "movement",
    "electromagnetics", "electronics", "robotics", "robotique", "maritime", "marine", "boats", "boat",
    "aerospace", "aeronautics", "aeronautique", "aviation", "research", "recherche", "workplace", "drycleaners",
    "societe", "anonyme", "micro", "defence", "defense", "material", "materials", "handling", "trailers",
    "trailer", "truck", "trucks", "toy", "toys", "valve", "valves", "office", "bureau", "sales", "architecture",
    "architectes", "architects", "mobility", "communication", "communications", "transit", "elevator",
    "elevators", "consortium", "coentreprise", "geomatics", "geosystems", "geospatial", "polytechnique",
    "polytechnic", "formation", "control", "controls", "engineering", "ingenierie", "ingenieria", "band",
    "council", "biosciences", "bioscience", "biotools", "scientific", "laboratory", "laboratories",
    "laboratoire", "photonics", "equipment", "equipements", "equipos", "dynamics", "impression", "consoles",
    "restoration", "economic", "advisors", "advisory", "indigenous", "ordnance", "tactical", "tailoring",
    "alterations", "products", "instruments", "data", "institut", "innovant", "vehicule", "expediting",
    "kinetics", "lighting", "dentaire", "experts", "aerostructure", "intelligence", "telematics", "discovery",
    "production", "campus", "radiator", "adventures", "cameras", "propellers", "plomberie", "translation",
    "translations", "traduction", "traductions", "professional", "metals", "securite", "windows", "doors",
    "films", "landscape", "cleanroom", "drones", "trade", "banking", "music", "alliance", "gamification",
    "e-learning", "upfitting", "factory", "outlet", "solution", "ventures", "industriales", "manutencion",
    "senales", "maritimas", "internatioanl", "commissionaires", "committee", "university", "universite",
    "trappers", "hunters", "coop", "co-operative", "cooperative", "sciences", "science", "analytics",
    "aircraft", "avionics", "optics", "networks", "network", "telecom", "satellite", "drilling", "surveys",
    "survey", "environmental", "environnement", "conseil", "conseils", "technique", "techniques", "medical",
    "medica", "pharma", "diagnostics", "printing", "imprimerie", "fuels", "fuel", "petroleum", "chemicals",
    "hydraulics", "pneumatics", "fabricating", "welding", "electrique", "mecanique", "toiture", "renovation",
    "renovations", "installations", "instalaciones", "precision", "aero", "associates", "associes", "ass",
    "sandwiches", "quest", "domes", "informatics", "automation", "originals", "airport", "electronique",
    "naval", "chantier", "demand", "atmospheric", "measurements", "clean", "images", "vision", "inference",
    "joint", "venture", "integrators", "analyst", "analysts", "protech", "couvreur", "idees", "western",
    "profil", "team", "drain", "flight", "usa", "america", "americas", "iberia", "toronto", "ottawa",
    "montreal", "calgary", "edmonton", "vancouver", "winnipeg", "gatineau", "mississauga", "saskatoon",
    "fer", "titane", "acier", "bois", "metal", "metaux", "courier", "couriers",
    # Quebec trades written before the owner's name ("FERBLANTERIE <GIVEN> <SURNAME>"),
    # which the capitals-surname-first reading would take for a person.
    "ferblanterie", "ebenisterie", "menuiserie", "maconnerie", "debosselage", "boucherie", "quincaillerie",
    "pharmacie", "entreprise", "distribution", "distributions", "peinture", "electricien", "excavation",
    "excavations", "toitures", "vitrerie", "climatisation", "chauffage", "soudure", "usinage", "atelier",
    "ateliers", "serrurerie", "arpentage", "carrosserie",
}
# Company forms abroad that normalize.LEGAL_SUFFIXES leaves out (it strips
# its forms from every name; these are only read here, as a name's last word).
FOREIGN_LEGAL_FORMS = {
    "sa", "as", "sas", "sasu", "sl", "slu", "bv", "nv", "gmbh", "ag", "se", "oy", "oyj", "ab", "aps", "zrt",
    "srl", "sarl", "spa", "sia", "kft", "sro", "pty", "pte", "bhd", "kk", "lda", "ltda", "cv", "jv", "gp",
    "reg", "doo", "ou", "uab", "asa",
}

# household.BUSINESS_WORDS reads "law" as a firm. In public records it is a
# surname as often ("John A Smith, Ann Law" received a grant as two people),
# and a person read as a business would be published.
PUBLIC_BUSINESS_WORDS = (BUSINESS_WORDS - {"law"}) | {_key(w) for w in SUPPLIER_WORDS}
# The most words a person's name may have once normalized: "Smith, John A." is
# three; a longer name is read as a firm's.
PERSON_MAX_WORDS = 3
# "&", "and", "et" join the names in a firm's ("Ernst & Young", "Rio Tinto Fer
# et Titane"); a legal part carrying one is read as two people only in the
# shape "<Given> and <Given> <Surname>" (COUPLE_RE).
CONNECTOR_RE = re.compile(r"&|\band\b|\bet\b", re.I)
# "<Given> and <Given> <Surname>": two people sharing a surname. Both given
# names must be on the list, so "Rose and Thistle Pub" stays a firm.
COUPLE_RE = re.compile(r"^\s*([^\W\d_][^\W\d_'’-]*)\s+(?:and|et|&)\s+([^\W\d_].*?)\s*$", re.I)
# "s/n" (sous le nom), the marker Quebec farm and sole-proprietor filings put
# before a trade name ("<Given> <Surname> (s/n Ferme X)"). The person test
# reads the part before it, as it does before the markers normalize knows (o/a,
# d/b/a, faisant affaire sous). norm_name does not split on it: that would move
# the ids of the firms that write it (a NORMALIZE_VERSION change).
SOUS_LE_NOM_RE = re.compile(r"(?<![\w.])s\s*/\s*n(?!\w)", re.I)
# A bracketed group that ends a name: "<person> (<farm or firm>)". The bracket
# is the name the person trades under or works for, and its words do not make
# the person's name a business's.
TRAILING_BRACKET_RE = re.compile(r"^(?P<head>.*?[^\W_].*?)\s*\((?P<inner>[^()]*)\)[\s.,;:]*$")
BRACKET_KEPT_RE = re.compile(r"^\s*(?:[A-Z]{2,8}|.*\d.*)\s*$")
NOT_PERSONS_PATH = config.PACKAGE_DATA / "not_persons.csv"
GIVEN_NAMES_PATH = config.PACKAGE_DATA / "given_names.txt"
# Raised whenever is_person_name reads a name differently (its rules, the
# given-name list, not_persons.csv) or a withheld row keeps something else
# (5: the name is also taken out of the row's free text; 6: a name that carries
# an email address is withheld too; 7: the legal part alone is read, before
# "s/n" and without a bracket that ends the name, a list of people split by
# slashes is read person by person, "<Given> and <Given> <Surname>" and
# "<SURNAME> <GIVEN> <GIVEN>" read as people), so that the next run reads
# every file again and recomputes the withheld rows (refresh_person_test).
PERSON_TEST_VERSION = 7
# What becomes of "<person> (<firm with a legal form>)", a record filed under a
# person's name with the firm they own or work for in brackets ("<Surname>,
# <Given> (<Firm> Ltd.)"). "withhold" (the default until the operator decides):
# the whole name is withheld, the firm with it. "firm": the record is filed
# under the bracketed firm (filed_name) and the person's name is taken out of
# its free text. Changing this line is the whole switch: the stored person
# test version carries it (person_test_stamp), so the next run reads every
# file again under the new choice.
PERSON_WITH_FIRM = "withhold"
# An email address written in a name field ("labanalyzer@example.invalid",
# "Canada@softreseller.example.invalid"): a contact detail, often a person's, withheld like a
# person's name.
EMAIL_IN_NAME_RE = re.compile(r"[\w.+%'-]+@[\w-]+(?:\.[\w-]+)+")
PERSON_TEST_KEY = "person_test_version"
# The meta keys that let a loader skip a file: checksums (a stand-in copy's
# too), the validators of its conditional request, and the weekly check. A
# refused lobbying download keeps its hold (lobbying:refused_*): a new person
# test is no reason to ask again. The date of the lobbying copy loaded last
# (lobbying:file_date) stays too: an older copy is still never read.
SKIP_KEY_PATTERNS = (
    "canadabuys:%:sha256", "canadabuys:%:etag", "canadabuys:%:last_modified", "canadabuys:%:read_at",
    *(f"{stage}:{item}" for stage in ("contracts", "grants", "lobbying")
      for item in ("sha256", "etag", "last_modified", "read_at", "rejected", "rejected_sha256", "seed_sha256",
                   "archive_sha256")),
    "contracts_loaded_at", "grants_loaded_at", "lobbying_loaded_at",
)
# The CanadaBuys stages whose legacy file is to be read again (canadabuys.plan
# reads a legacy file only on a first load otherwise).
REREAD_LEGACY_KEY = "canadabuys:reread_legacy"
# What sources write for "no name" or for no one supplier. Treated as a blank:
# never a business, never a person, never in a review list.
PLACEHOLDER_RE = re.compile(r"^\s*(?:n\s*/?\s*a|none|null|unknown|nil|-+|\.+)(?:\s*:\s*(?:n\s*/?\s*a|none))?\s*$",
                            re.I)
# The same, compared as lower-case words with the punctuation dropped.
PLACEHOLDER_PHRASES = frozenset({
    "request for proposal", "request for proposals", "request for standing offer", "request for standing offers",
    "rfp", "various", "various vendors", "various suppliers", "multiple", "multiple vendors", "multiple suppliers",
    "see attached", "to be determined", "tbd",
})
# Courtesy titles, compared without their dot. "M." (monsieur) counts only
# with its dot, since a bare "M" is an initial.
HONORIFICS = frozenset({"mr", "mrs", "ms", "miss", "mme", "mlle", "dr", "me"})
# The Arabic article joined to a surname ("Al-Zubaidi", "El-Khoury").
ARTICLE_RE = re.compile(r"(?:al|el)-[^\W\d_]", re.I)

# Words that name a kind of business, a place or a quality rather than one
# business. A name made only of these is common: "Canadian Farms", "West
# Coast Services", "Golden Group".
GENERIC_WORDS = frozenset(
    re.sub(r"[^\w]", "", fold_accents(w).casefold())
    for w in BUSINESS_TOKENS | CARE_SECTOR_WORDS | {
        "enterprise", "holding", "trading", "sales", "supply", "supplies", "products", "equipment", "agencies",
        "contracting", "contractor", "trucking", "transportation", "carrier", "lines", "freight", "farming",
        "ventures", "acres", "valley", "river", "mountain", "lake", "creek", "hills", "country", "city",
        "northern", "southern", "eastern", "western", "central", "united", "american", "general", "star",
        "sun", "sunrise", "sunset", "eagle", "maple", "pine", "oak", "cedar", "rose", "diamond", "silver",
        "metro", "urban", "alpine", "summit", "pioneer", "heritage", "family", "friends", "brothers",
    }
)


def first_language(text: object) -> str:
    """'Blue Buoy Foods Limited|Blue Buoy Foods Limited' -> 'Blue Buoy Foods Limited'.

    Some disclosures write a field in both languages joined by '|'; the first
    part is kept, with runs of white space made one.
    """
    return re.sub(r"\s+", " ", str(text or "").split("|", 1)[0]).strip()


def is_placeholder(name: object) -> bool:
    """'NA : None', 'N/A', 'TBD', 'Request for Proposal', '***': a source's way of leaving the name out."""
    text = str(name or "")
    if PLACEHOLDER_RE.match(text):
        return True
    if text.strip() and not re.search(r"[^\W_]", text):
        return True  # punctuation only
    return " ".join(re.findall(r"[a-z0-9]+", fold_accents(text).casefold())) in PLACEHOLDER_PHRASES


def refresh_person_test(conn: sqlite3.Connection) -> bool:
    """At the start of a run: when the person test changed, make every loader read its files again.

    The rows withheld under the previous test hold no name to test again, so
    the files are the only way to recompute them. Clears the keys that let a
    loader skip a file (SKIP_KEY_PATTERNS), marks the CanadaBuys legacy files
    for one more read, and stores PERSON_TEST_VERSION. True when it did so.
    """
    stored = conn.execute("SELECT value FROM meta WHERE key = ?", (PERSON_TEST_KEY,)).fetchone()
    if stored is not None and stored[0] == person_test_stamp():
        return False
    for pattern in SKIP_KEY_PATTERNS:
        conn.execute("DELETE FROM meta WHERE key LIKE ?", (pattern,))
    conn.executemany(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [(REREAD_LEGACY_KEY, "awards,history"), (PERSON_TEST_KEY, person_test_stamp())],
    )
    conn.commit()
    return True


def person_test_stamp() -> str:
    """What refresh_person_test stores: PERSON_TEST_VERSION, marked when PERSON_WITH_FIRM is not the default."""
    return str(PERSON_TEST_VERSION) if PERSON_WITH_FIRM == "withhold" else f"{PERSON_TEST_VERSION}-firm"


# What a withheld name becomes in the free text of its own record.
NAME_WITHHELD = {"en": "[name withheld]", "fr": "[nom retiré]"}
_HONORIFIC_RE = r"(?:(?:mr|mrs|ms|miss|mme|mlle|dr|me)\.?|m\.)"


def _person_words(part: str) -> list[str]:
    words = part.split()
    while words and _is_honorific(words[0]):
        words.pop(0)
    return words


def _people(name: str) -> list[tuple[list[str], list[str]]]:
    """The people a withheld name holds, each as (given names, surname).

    Read from the part the person test reads (person_legal_part), so a firm or
    farm in brackets or after a trade-name marker is not taken for a name.
    """
    text = first_language(name)
    out: list[tuple[list[str], list[str]]] = []
    for part in re.split(r"[;/]", person_legal_part(text) or text):
        if "," in part:
            last, first = (_person_words(p) for p in part.split(",", 1))
            if len(last) >= 2 and len(first) >= 2:
                # "Priya Sandhu, Arjun Sandhu": two people, each written first name first.
                out += [(last[:-1], last[-1:]), (first[:-1], first[-1:])]
            elif last and first:
                out.append((first, last))
            continue
        words = _person_words(part)
        if len(words) >= 4 and words[1].casefold() in ("and", "et", "&"):
            # "<Given> and <Given> <Surname>": each given name with the surname.
            out += [(words[:1], words[-1:]), (words[2:-1], words[-1:])]
        elif len(words) >= 2:
            out.append((words[:-1], words[-1:]))
            if len(words) == 3 and part.upper() == part:
                # "<SURNAME> <GIVEN> <GIVEN>": the free text may write it given names first.
                out.append((words[1:], words[:1]))
    return out


@lru_cache(maxsize=4096)
def name_pattern(name: str) -> re.Pattern[str] | None:
    """The ways a record's free text may write a withheld name: "First Last" and "Last, First",
    with or without a courtesy title, in any case; None when the name holds no first and last name."""
    variants: list[str] = []
    for given, last in _people(name):
        g = r"\s+".join(re.escape(w) for w in given)
        s = r"\s+".join(re.escape(w) for w in last)
        variants += [rf"{g}\s+{s}", rf"{s}\s*,\s*{g}"]
    if not variants:
        return None
    alternatives = "|".join(sorted(set(variants), key=len, reverse=True))
    return re.compile(rf"(?<!\w)(?:{_HONORIFIC_RE}\s*)?(?:{alternatives})(?!\w)", re.I)


def redact(text: str | None, names: list[str] | tuple[str, ...], *, french: bool = False) -> tuple[str | None, int]:
    """text with every withheld name in it replaced, and how many replacements were made."""
    if not text:
        return text, 0
    count = 0
    for name in names:
        pattern = name_pattern(name) if name else None
        if pattern is not None:
            text, n = pattern.subn(NAME_WITHHELD["fr" if french else "en"], text)
            count += n
    return text, count


def given_name_key(word: object) -> str:
    """'Hélène' -> 'helene', "D'Arcy" -> 'darcy', 'JEAN-PIERRE' -> 'jean-pierre': how given names are compared."""
    return re.sub(r"[^a-z-]", "", fold_accents(str(word or "")).casefold()).strip("-")


@lru_cache(maxsize=1)
def given_names(path: Path | None = None) -> frozenset[str]:
    """The given names in data/given_names.txt (built by scripts/build_given_names.py)."""
    src = path or GIVEN_NAMES_PATH
    if not src.exists():
        return frozenset()
    lines = (line.strip() for line in src.read_text(encoding="utf-8").splitlines())
    return frozenset(line for line in lines if line and not line.startswith("#"))


def _is_honorific(token: str) -> bool:
    folded = fold_accents(token).casefold()
    return folded == "m." or folded.rstrip(".") in HONORIFICS


def _short(token: str) -> bool:
    """An initial ("J.", "J.R.", "W.Bruce" written without its space) or a name of two letters,
    which the given-name list leaves out."""
    return len(re.sub(r"[^\w]", "", token)) <= 2 or bool(re.match(r"[^\W\d_]\.", token))


def carries_given_name(legal: str) -> bool:
    """The last condition of is_person_name: the name has a person's given name where one is written.

    The given name is the first word, or the word after the comma of
    "Last, First". It must be on the list in data/given_names.txt, or be an
    initial or a name of two letters (the list leaves those out, and "J.
    Smith" is a person). Whatever the list says, a name is a person's when it
    carries a courtesy title (Mr, Mrs, Ms, Mme, M., Dr, Me), when it is
    written "Last, First" in two or three words, or when it carries the
    Arabic article joined to a surname (Al-, El-). With no list at all, every
    name that passed the other conditions is a person's, as before the list.
    """
    names = given_names()
    if not names:
        return True
    tokens = re.findall(r"[^\s,;/()]+|,", legal)
    words = [t for t in tokens if t != "," and re.search(r"[^\W\d_]", t)]
    if not words:
        return False
    if any(_is_honorific(w) for w in words) or ARTICLE_RE.search(legal):
        return True
    candidates = [words[0]]
    if "," in tokens:
        after = [t for t in tokens[tokens.index(",") + 1:] if t != ","]
        if after and tokens.index(",") > 0:
            if 2 <= len(words) <= 3:
                return True
            candidates.append(after[0])
    for word in candidates:
        if _short(word) or _listed_given_name(word):
            return True
    # "<SURNAME> <GIVEN> <GIVEN>": some files write a person surname first, in
    # capitals and without the comma. Read so only when both words after the
    # first are given names, since few firms' names end in two.
    if ("," not in tokens and len(words) == 3 and legal == legal.upper()
            and all(_listed_given_name(w) for w in words[1:])):
        return True
    return any(len(re.sub(r"[^\w]", "", w)) == 1 for w in words)


def _listed_given_name(word: str) -> bool:
    """The word, or the first part of a compound one, is on the given-name list (any word, with no list)."""
    names = given_names()
    if not names:
        return True
    key = given_name_key(word)
    return key in names or key.split("-")[0] in names


@lru_cache(maxsize=1)
def not_persons(path: Path | None = None) -> frozenset[str]:
    """The normalized names the person test reads wrongly, one per line in data/not_persons.csv."""
    src = path or NOT_PERSONS_PATH
    if not src.exists():
        return frozenset()
    lines = (line.strip() for line in src.read_text(encoding="utf-8").splitlines())
    return frozenset(norm_name(line) for line in lines if line and not line.startswith("#"))


def is_person_name(name: object) -> bool:
    """True when a record's name is to be read as a private individual's.

    A name that carries an email address is withheld whatever else it says
    (EMAIL_IN_NAME_RE): the address is a contact detail, which is never
    published, and often a person's own. Otherwise every one of these must
    hold, so that a firm is not withheld for lacking a legal form:

    * not a placeholder, and not on the list in data/not_persons.csv;
    * no connector ("&", "and", "et") in the legal part, except in the shape
      "<Given> and <Given> <Surname>" (COUPLE_RE);
    * at most PERSON_MAX_WORDS words once the legal part is normalized, and
      no digit;
    * no legal form (normalize.LEGAL_SUFFIXES, which holds the forms used
      abroad, or FOREIGN_LEGAL_FORMS as the last word), no business word, no
      acronym, no underscore or quotation mark;
    * household.reads_as_person reads the legal part as a person;
    * and the legal part carries a given name (carries_given_name): without
      one, "Eastern Partitions" and "Surrey Place" read as people.

    The legal part is person_legal_part: the name before a trade-name marker
    ("s/n" included) and without a bracketed group that ends it, so "<Given>
    <Surname> (s/n Ferme X)", "<Given> <Surname> (o/a X and Y)" and "<Surname>,
    <Given> (<Firm> Ltd.)" are read on the person's name alone and withheld
    whole (PERSON_WITH_FIRM). A list of people split by slashes or semicolons
    is withheld when every part reads as a person.
    """
    if EMAIL_IN_NAME_RE.search(str(name or "")):
        return True
    text = first_language(name)
    if not text or is_placeholder(text) or norm_name(text) in not_persons():
        return False
    legal = person_legal_part(text)
    if not legal:
        return False
    # People listed with slashes or semicolons, as many as there are: each part
    # is read on its own (the whole-name test below stops at three).
    parts = [p.strip() for p in re.split(r"[/;]", legal) if p.strip()]
    if len(parts) > 1 and all(_reads_as_one(p) for p in parts):
        return True
    return _reads_as_one(legal)


def person_legal_part(text: str) -> str:
    """The part of a name the person test reads: the legal part before a trade-name marker
    (normalize.split_trade_name, and "s/n"), without a bracketed group that ends it."""
    legal = split_trade_name(text)[0]
    marker = SOUS_LE_NOM_RE.search(legal)
    if marker and re.search(r"[^\W_]", legal[:marker.start()]):
        legal = legal[:marker.start()].rstrip(" ,;:-(/\\").strip()
    bracket = TRAILING_BRACKET_RE.match(legal)
    # An acronym or a number in the bracket stays, as before: "Morgan Corker
    # Varnholt (MCV)" is a firm by its acronym, "<name> (2009)" by its year.
    if bracket and not BRACKET_KEPT_RE.match(bracket.group("inner")):
        legal = bracket.group("head").rstrip(" ,;:-/\\").strip()
    return legal


def person_with_firm(name: object) -> tuple[str, str] | None:
    """(person, firm) when a name is a person's followed by a bracketed firm with a legal form."""
    text = first_language(name)
    bracket = TRAILING_BRACKET_RE.match(split_trade_name(text)[0]) if text else None
    if not bracket:
        return None
    firm = bracket.group("inner").strip()
    person = person_legal_part(text)
    if not has_legal_form(firm) or not person or not is_person_name(person):
        return None
    return person, firm


def filed_name(name: str | None) -> tuple[str | None, str | None]:
    """(the name a record is filed under, a person's name taken out of it, or None).

    Under PERSON_WITH_FIRM = "firm", "<person> (<firm with a legal form>)" is
    filed under the firm, and the person comes back for the caller to take out
    of the record's free text. Otherwise the name is unchanged and the person
    test withholds it whole.
    """
    if PERSON_WITH_FIRM != "firm" or not name:
        return name, None
    split = person_with_firm(name)
    return (split[1], split[0]) if split else (name, None)


def _couple(legal: str) -> bool:
    """"<Given> and <Given> <Surname>", both given names on the list."""
    m = COUPLE_RE.match(legal)
    if not m or CONNECTOR_RE.search(m.group(2)):
        return False
    rest = m.group(2)
    words = rest.split()
    return (2 <= len(words) <= 3 and _listed_given_name(m.group(1)) and _listed_given_name(words[0])
            and _reads_as_one(rest))


def _reads_as_one(legal: str) -> bool:
    """The test on a legal part: one person, or two or three written in one name."""
    if CONNECTOR_RE.search(legal):
        return _couple(legal)
    if re.search(r'[\d_"“”]', legal) or has_legal_form(legal):
        return False
    # The word limit applies to each person named: "Priya Sandhu, Arjun
    # Sandhu" is two people, "Smith, John A." one written surname first.
    parts = [p for p in re.split(r"[,;/]", legal) if p.strip()]
    segments = parts if 1 < len(parts) <= 3 else [legal]
    if any(len(norm_legal(s).split()) > PERSON_MAX_WORDS for s in segments):
        return False
    words = re.findall(r"[^\W\d_]+", fold_accents(legal).casefold())
    if words and words[-1] in FOREIGN_LEGAL_FORMS:
        return False
    # "BPS", "CDC", "WZMH": a word of three letters or more with no vowel is
    # an acronym, never a given name or a surname.
    if any(len(w) >= 3 and not re.search(r"[aeiouy]", w) for w in words):
        return False
    # "A/S", "B. V.", "S.A. de C.V.": a form written with its slash, dots and spaces.
    if re.search(r"(?:^|\s)(?:a/s|b\.\s*v|s\.\s*a|s\.\s*l|n\.\s*v|s\.\s*r\.\s*l|s\.\s*a\.\s*s)\.?\s*$",
                 legal, re.I):
        return False
    return reads_as_person(legal, business_words=PUBLIC_BUSINESS_WORDS) and carries_given_name(legal)


@dataclass
class PersonDrops:
    """The names a stage's person test withheld: every row counted, the first names kept for review.

    Rule 3 keeps the names out of the run log, which the run status and
    LAST_RUN.md publish; write() puts the review list in a file under
    data/out/review that no step exports or uploads, and the log row says
    how many there were and where the list is.
    """

    limit: int = 50
    rows: int = 0
    names: list[str] = field(default_factory=list)
    seen: set[str] = field(default_factory=set)

    def add(self, name: str) -> None:
        self.rows += 1
        if name not in self.seen:
            self.seen.add(name)
            if len(self.names) < self.limit:
                self.names.append(name)

    def write(self, path: Path, *, what: str, stamp: str, withheld: str = "supplier withheld",
              buyers: Sequence[tuple[str, str]] = (), buyer_rows: int | None = None) -> str | None:
        """Write (or, with nothing to list, remove) the review list; returns the notice line.

        withheld says what was withheld in the source's own terms ("vendor
        withheld", "recipient withheld", "client withheld"). buyers are the
        buyer spellings that name no institution (sources/buyers.take_rejects,
        as (reason, spelling)), listed after the names in a section of their
        own; buyer_rows is how many rows carry them, when the stage counts them.
        """
        if not self.rows and not buyers:
            path.unlink(missing_ok=True)
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        lines: list[str] = []
        if self.rows:
            lines += [
                f"# {what}: names the person test read as private individuals or as email addresses, "
                f"run of {stamp}.",
                f"# {self.rows} rows, {len(self.seen)} names; the first {len(self.names)} are listed. Their records "
                "were",
                "# stored with the name withheld. A firm listed here belongs in awardwatch_pipeline/data/not_persons.csv",
                "# (its normalized name). This file is for the operator: no step exports, logs or uploads it.",
                *self.names,
            ]
        on_rows = f" on {buyer_rows} rows" if buyer_rows is not None else ""
        if buyers:
            lines += [
                f"# {what}: buyer spellings that name no institution (sources/buyers.non_institution), run of {stamp}.",
                f"# {len(buyers)} spellings{on_rows}. The records keep the spelling in their raw columns",
                "# and count under no buyer. A spelling that names an institution belongs in",
                "# awardwatch_pipeline/data/buyers.csv. One per line: the reason, a tab, the spelling. This file is for",
                "# the operator: no step exports, logs or uploads it.",
                *(f"{reason}\t{spelling}" for reason, spelling in buyers),
            ]
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
        try:
            shown = path.relative_to(config.REPO_ROOT).as_posix()
        except ValueError:
            shown = str(path)
        parts = []
        if self.rows:
            parts.append(f"{self.rows} rows ({len(self.seen)} names) read as private individuals, {withheld}; "
                         f"the first {len(self.names)} names are listed for review in {shown}")
        if buyers:
            parts.append(f"{len(buyers)} buyer spellings{on_rows} name no institution and count under "
                         f"no buyer; listed for review in {shown}")
        return "; ".join(parts)


def business_name(name: object) -> str | None:
    """A name fit to store: None when blank, a placeholder, or a name that reads as a person."""
    text = first_language(name)
    return text if text and not is_placeholder(text) and not is_person_name(text) else None


def is_common_name(norm: str) -> bool:
    """A normalized name too common to match on the province alone."""
    tokens = norm.split()
    if not tokens:
        return True
    # A numbered company, or a name carrying a number, is specific.
    if any(ch.isdigit() for ch in norm):
        return False
    if len(tokens) == 1:
        return True
    return all(t in GENERIC_WORDS for t in tokens)


def postal_code(raw: object) -> str | None:
    """'V4G0A2', '\\nv4g 0a2' -> 'V4G 0A2'; None when the text holds no Canadian postal code."""
    m = POSTAL_RE.search(str(raw or ""))
    return format_postal(m.group(1), m.group(2)) if m else None


def province_of(raw: object, postal: str | None) -> str | None:
    """A two-letter province from the record, else from its postal code's first letter."""
    code = province_code(first_language(raw)) if raw else None
    if code in PROVINCE_CODES:
        return code
    return POSTAL_PROVINCE.get(postal[0]) if postal else None


def fold_city(raw: object) -> str:
    """'ST. ALBERT', 'Saint-Albert' and 'St Albert' all read 'st albert'."""
    text = re.sub(r"[^\w\s]", " ", fold_accents(first_language(raw)).casefold()).replace("_", " ")
    words = {"saint": "st", "sainte": "ste"}
    return " ".join(words.get(w, w) for w in text.split())


def grade(kind: str, strong: bool, weak: bool, norm: str) -> str | None:
    """The grade of one record for one organization, or None for no match.

    kind is 'legal' when the record's legal name agrees and 'other' when a
    name it operates under does; strong is the place key agreeing, weak the
    province alone.
    """
    if kind == "legal":
        if strong:
            return EXACT
        return PROBABLE if weak and not is_common_name(norm) else None
    return PROBABLE if strong and not is_common_name(norm) else None


@dataclass
class Places:
    """The places on an organization's own records (organization_places), plus its main province."""

    province: str | None = None
    provinces: set[str] = field(default_factory=set)
    postals: set[str] = field(default_factory=set)
    cities: set[str] = field(default_factory=set)

    @property
    def areas(self) -> set[str]:
        return {p[:3] for p in self.postals}

    def add(self, city: object, postal: object, province: object = None) -> None:
        code = postal_code(postal)
        if code:
            self.postals.add(code)
        folded = fold_city(city)
        if folded:
            self.cities.add(folded)
        if province in PROVINCE_CODES:
            self.provinces.add(str(province))


def organization_places(conn: sqlite3.Connection, ids: set[str] | list[str]) -> dict[str, Places]:
    """The places seen on each organization's records, read from organizations and organization_places."""
    out: dict[str, Places] = {}
    ordered = sorted(set(ids))
    for i in range(0, len(ordered), 500):
        chunk = ordered[i:i + 500]
        marks = ",".join("?" * len(chunk))
        for r in conn.execute(f"SELECT id, province, city, postal_code FROM organizations WHERE id IN ({marks})",
                              chunk):
            places = out.setdefault(r[0], Places())
            places.province = r[1]
            places.add(r[2], r[3], r[1])
        for r in conn.execute(
            f"SELECT organization_id, province, city, postal_code FROM organization_places "
            f"WHERE organization_id IN ({marks})", chunk,
        ):
            out.setdefault(r[0], Places()).add(r[2], r[3], r[1])
    return out


def organization_names(conn: sqlite3.Connection, province: str | None = None) -> set[str]:
    """Every normalized organization name, or those with a record in one province: what a load keeps."""
    if province is None:
        return {r[0] for r in conn.execute("SELECT DISTINCT norm_name FROM organizations WHERE norm_name != ''")}
    return {r[0] for r in conn.execute(
        "SELECT DISTINCT o.norm_name FROM organizations o WHERE o.norm_name != '' AND (o.province = ? OR EXISTS "
        "(SELECT 1 FROM organization_places p WHERE p.organization_id = o.id AND p.province = ?))",
        (province, province),
    )}
