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
# et Titane"); a name carrying one is never read as two people.
CONNECTOR_RE = re.compile(r"&|\band\b|\bet\b", re.I)
NOT_PERSONS_PATH = config.PACKAGE_DATA / "not_persons.csv"
GIVEN_NAMES_PATH = config.PACKAGE_DATA / "given_names.txt"
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
        if _short(word):
            return True
        key = given_name_key(word)
        if key in names or key.split("-")[0] in names:
            return True
    return any(len(re.sub(r"[^\w]", "", w)) == 1 for w in words)


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

    Every one of these must hold, so that a firm is not withheld for lacking
    a legal form:

    * not a placeholder, and not on the list in data/not_persons.csv;
    * no connector ("&", "and", "et") anywhere in the name;
    * at most PERSON_MAX_WORDS words once the legal part is normalized, and
      no digit;
    * no legal form (normalize.LEGAL_SUFFIXES, which holds the forms used
      abroad, or FOREIGN_LEGAL_FORMS as the last word), no business word, no
      acronym, no underscore or quotation mark;
    * household.reads_as_person reads the legal part as a person;
    * and the legal part carries a given name (carries_given_name): without
      one, "Eastern Partitions" and "Surrey Place" read as people.
    """
    text = first_language(name)
    if not text or is_placeholder(text) or CONNECTOR_RE.search(text):
        return False
    legal = split_trade_name(text)[0]
    if norm_name(text) in not_persons() or re.search(r'[\d_"“”]', legal) or has_legal_form(legal):
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

    def write(self, path: Path, *, what: str, stamp: str, withheld: str = "supplier withheld") -> str | None:
        """Write (or, with nothing withheld, remove) the review list; returns the notice line.

        withheld says what was withheld in the source's own terms ("vendor
        withheld", "recipient withheld", "client withheld").
        """
        if not self.rows:
            path.unlink(missing_ok=True)
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        header = [
            f"# {what}: names the person test read as private individuals, run of {stamp}.",
            f"# {self.rows} rows, {len(self.seen)} names; the first {len(self.names)} are listed. Their records were",
            "# stored with the name withheld. A firm listed here belongs in awardwatch_pipeline/data/not_persons.csv",
            "# (its normalized name). This file is for the operator: no step exports, logs or uploads it.",
        ]
        path.write_text("\n".join(header + self.names) + "\n", encoding="utf-8")
        try:
            shown = path.relative_to(config.REPO_ROOT).as_posix()
        except ValueError:
            shown = str(path)
        return (f"{self.rows} rows ({len(self.seen)} names) read as private individuals, {withheld}; "
                f"the first {len(self.names)} names are listed for review in {shown}")


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
