"""Buyers: the federal institutions that publish tenders, award contracts and make grants.

One row per institution. The id is the open.canada.ca organization name
(dnd-mdn, pwgsc-tpsgc) when the institution has one; the 353 organizations
come from CKAN's organization_list and one organization_show each, cached and
refreshed when the last load is 30 days old. Each gives the English and
French titles (title_translated), the acronyms (shortform) and the
department number.

CanadaBuys names an institution its own way, with the acronym in trailing
parentheses ("Department of National Defence (DND)"), under a former name
("Public Works and Government Services Canada"), with a region or a branch
after it ("Defence Construction Canada - Atlantic Region"), or not at all (a
contracting officer's name, an address, "Contract Administrator"). resolve
maps a spelling to a buyer, in this order:

1. a spelling already in buyer_names (the seed, CKAN's titles, or an earlier
   resolution of the same spelling);
2. the spelling, with or without its acronym, equal to a CKAN or seed title;
3. the acronym matched to one buyer's English acronym (or, failing that, the
   French acronym to one buyer's French acronym);
4. the spelling's key (name_key: case, accents, punctuation, articles and the
   "Department of" and "Ministère de" wrappers left out) equal to the key of
   one CKAN title or seed name, the seed's spellings included, which is how a
   former name the seed lists matches every way of writing it. The spelling is
   tried as written, then without what follows an "Attn" or "c/o", then each
   part between separators (" - ", "/", ", "), then without its last words
   (a region, a base); an acronym standing alone is matched like rule 3;
5. a spelling that names no institution (non_institution: a person's name, a
   single word, a job title, a street address, an attention line) gets no
   buyer: resolve returns None, the record keeps the spelling in its raw
   columns and counts under no buyer, and the spelling is listed for review
   (take_rejects) in the stage's review file, never in the log;
6. otherwise the buyer an earlier rule 6 made for the same key, or a new buyer
   with a slug of the English name and no CKAN organization, listed in the
   stage's notices so the seed can be extended.

Every spelling is recorded in buyer_names with the buyer it resolved to, so
the mapping can be reviewed. The curated seed awardwatch_pipeline/data/buyers.csv
covers the spellings that do not line up (former names, no acronym, or a
Crown corporation that is not a CKAN organization). A spelling resolved by
rule 6 before CKAN was loaded, or before the seed covered it, is resolved
again on the next buyers stage, and its records follow it to the right buyer
(or to no buyer, when it names no institution).

Aliases. The second curated seed, awardwatch_pipeline/data/buyer_aliases.csv,
lists the names of a buyer that no rule above ties to it by itself: former
names with the department that carries their work today (Revenue Canada and
the Canada Revenue Agency, HRSDC and ESDC), the ways CanadaBuys writes
National Defence, the legal name "Parks Canada Agency", and the registry's
placeholder "Other (Specify)" (a blank buyer_id: no buyer). Each row has a
note (former, spelling, acronym, part, placeholder) and a reason. Its names
are titles to the resolver (TITLE_SOURCES, source 'alias' in buyer_names), so
rules 2 and 4 match them as written and by key in every source; a placeholder
is read as no name at all (is_placeholder_name).

Merges (merge, every buyers stage, after CKAN, the seed and the aliases, in
one transaction). One institution under two buyer ids splits the totals a
reader quotes, so the stage joins them, by rules a fresh checkout reproduces
from CKAN and the two seeds:

1. alias: a buyer whose own English or French name is an alias of another
   buyer (by key) is that buyer: a buyer made for "Revenue Canada", the CKAN
   organization "Status of Women Canada".
2. ckan_twin: CKAN organizations whose English titles have one key, and whose
   French titles agree where both have one, are one buyer (CKAN lists the
   Transportation Appeal Tribunal of Canada as tatc and as tatc-tatc). The
   survivor is the survivor of the night before, then a buyer the seeds
   name, then one with a department number, then the one with more records,
   then the shorter id.
3. name: a buyer made by rule 6 (no CKAN organization, not in buyers.csv)
   whose own name now resolves by rules 2 to 4 to a CKAN or seed buyer is
   that buyer, even when one of its spellings resolves to nothing by itself
   (the French half of a pair). One whose spellings resolve to a third buyer
   is listed for review instead: a wrong merge is worse than a missing one.
4. spellings: a made buyer whose every spelling now resolves to one other
   buyer is that buyer.
5. no_institution: a made buyer whose every spelling reads as no institution
   (non_institution, a placeholder) is deleted and its records keep no buyer.

Each spelling of a made buyer is also re-pointed by itself (rule 1 then
finds the right buyer on the next load). A merge moves the buyer_id of every
row of every source (BUYER_COLUMNS, the lobbying reports' buyer_ids), its
names in buyer_names, and drops its derived rows; the retired id becomes a
buyer_aliases row (with its names, which the live buyer's page lists), so
its page, its API path and its analytics redirect. Every merge, and every
made buyer left as it is, is written to data/out/review/buyer-merges.txt;
the run's notices name the merges that are new tonight.

Institutions. A buyer with no CKAN organization that only the lobbying
registry names (Members of the House of Commons, offices of Parliament) has
kind 'institution' (refresh_kinds): the buyers list shows it apart from the
departments, agencies and Crown corporations that publish tenders and
contracts.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

from .. import config
from ..db import get_meta, hours_since, log_run, now_iso, set_meta
from ..http import FetchError, PoliteClient
from ..normalize import fold_accents, has_legal_form, slugify, squash
from . import matching

log = logging.getLogger(__name__)

SEED_PATH = config.PACKAGE_DATA / "buyers.csv"
SEED_COLUMNS = ("raw_name", "source", "buyer_id", "name_en", "name_fr", "acronym_en", "acronym_fr")
ALIAS_PATH = config.PACKAGE_DATA / "buyer_aliases.csv"
ALIAS_COLUMNS = ("alias", "buyer_id", "note", "why")
ALIAS_NOTES = ("former", "spelling", "acronym", "part", "placeholder")
REFRESH_DAYS = 30
# Shorter than the refresh, so a refresh revalidates every cached answer while
# a run retried the same day reads them from the cache.
CACHE_S = 25 * 86400
META_LOADED = "buyers_loaded_at"
# When the CKAN organization list was last read, whether or not every
# organization_show answered (the Data page shows it).
META_READ = "buyers:read_at"
# Names matched against as titles (rules 2 and 4), never a spelling a record
# carries: CKAN's titles, the seed's names, the alias seed's names.
TITLE_SOURCES = ("ckan", "seed", "alias")
# Why a buyer was merged into another (buyer_aliases.reason), in the order the rules apply.
MERGE_REASONS = ("alias", "ckan_twin", "name", "spellings", "no_institution")
REVIEW_FILE = "buyer-merges.txt"
# buyers.kind of a buyer that only the lobbying registry names (refresh_kinds).
INSTITUTION = "institution"

# The ids an earlier seed gave Crown corporations that CKAN lists under its
# own organization (the seed points at CKAN's since 2026-11): aliases, so a
# link to the old buyer page is sent on (refresh_aliases).
SEED_REPOINTED = {
    "business-development-bank-of-canada": "bdc",
    "export-development-canada": "edc",
    "farm-credit-canada": "fcc-fac",
    "canada-post-corporation": "cpc-scp",
    "marine-atlantic": "mai",
    "bank-of-canada": "bc",
    "telefilm-canada": "tf",
    "parc-downsview-park": "pdp",
}

# Every column that points at a buyer, for moving records when merge retires
# a buyer into another (or into none).
BUYER_COLUMNS = (
    ("tenders", "buyer_id"), ("awards", "buyer_id"), ("contract_history", "buyer_id"),
    ("contract_history", "client_id"), ("contracts", "buyer_id"), ("grants", "buyer_id"),
)
# The derived tables that also point at a buyer (foreign keys), rebuilt whole by a
# later stage every night: their rows for a buyer being deleted are dropped, not
# moved, so the delete passes the foreign-key check on a database restored from
# the night before. A test holds these two lists equal to the schema's references.
DERIVED_BUYER_COLUMNS = (("buyer_years", "buyer_id"),)

_PAREN_ACRONYM_RE = re.compile(r"\(([^()]{1,30})\)\s*$")
# "Export Development Canada - EDC"
_DASH_ACRONYM_RE = re.compile(r"\s+-\s+([A-Z][A-Za-z0-9&.]{1,11})\s*$")


def split_acronym(raw: object) -> tuple[str, str | None]:
    """'Department of the Environment (ECCC )' -> ('Department of the Environment', 'ECCC')."""
    text = squash(raw)
    m = _PAREN_ACRONYM_RE.search(text) or _DASH_ACRONYM_RE.search(text)
    if not m:
        return text, None
    acronym = re.sub(r"\s+", "", m.group(1))
    name = text[:m.start()].rstrip(" -")
    return (name or text), (acronym or None)


def _acronym_key(text: object) -> str:
    return re.sub(r"[\s.]", "", str(text or "")).casefold()


# ---------------------------------------------------------------------------
# Reading a spelling: its key, the forms tried, and whether it names an institution
# ---------------------------------------------------------------------------

# Left out of a key: articles and "of", "and" in both languages, and the
# company forms a Crown corporation's title carries ("Atomic Energy of Canada
# Ltd" is "Atomic Energy of Canada Limited").
_KEY_STOP = frozenset({"the", "of", "and", "et", "de", "du", "des", "la", "le", "les", "l", "d", "a", "au", "aux",
                       "inc", "incorporated", "ltd", "limited", "ltee", "limitee"})
# A department with and without its wrapper is one key ("Department of
# National Defence", "National Defence", "Ministère de la Défense nationale",
# "Fisheries and Oceans Canada", "Department of Fisheries and Oceans"), and
# "Canada" is left out wherever it stands: nearly every federal name carries
# it, written in or left out ("Treasury Board of Canada Secretariat",
# "Treasury Board Secretariat").
_KEY_LEADING = frozenset({"department", "dept", "departement", "ministere", "ministry", "minister", "ministre"})
_KEY_TRAILING = frozenset({"department", "dept", "departement", "ministere"})
_KEY_SPELLING = {"defense": "defence", "center": "centre"}
# Separators between a name and a region, a branch or a second institution: a
# slash, a semicolon, a bar, an en or em dash, a hyphen with a space beside it.
# A comma followed by a space separates less ("Innovation, Science and
# Economic Development Canada" is one name), so its parts are tried after.
_SEPARATOR_RE = re.compile(r"\s*[|/;\u2013\u2014]\s*|\s+-\s*|\s*-\s+")
_COMMA_RE = re.compile(r"\s*,\s+")
_PARENS_RE = re.compile(r"\([^()]*\)")
# "Attn: <name>", "c/o <name>", "à l'attention de <name>": what follows names a person.
_ATTENTION = r"(?:attn\b\.?|attention\b|c\s*/\s*o\b|care\s+of\b|[\u00e0a]\s+l['\u2019]\s*attention\b)"
_ATTENTION_RE = re.compile(r"(?:^|(?<=[\s,;:(\-]))" + _ATTENTION, re.IGNORECASE)
_ATTENTION_LINE_RE = re.compile(r"^\W*" + _ATTENTION, re.IGNORECASE)
# "Auditor General of Canada, Office of the": the wrapper written last.
_INVERTED_RE = re.compile(
    r"^(?P<name>.+?),\s*(?P<head>(?:the\s+)?(?:office|department|ministry)\s+of(?:\s+the)?|the)\s*$", re.IGNORECASE)
_ACRONYM_TOKEN_RE = re.compile(r"^[A-Za-z][A-Za-z0-9&.\-]{1,14}$")


def name_key(text: object) -> str:
    """'Department of the Environment', 'ENVIRONMENT CANADA' -> 'environment': how names are compared.

    Accents folded, case and punctuation dropped, the words of _KEY_STOP left
    out with "Canada", a leading "Department", "Ministère" or "Minister" and
    a trailing "Department" removed, and "defense" read as "defence".
    """
    folded = fold_accents(squash(text)).casefold()
    words = [_KEY_SPELLING.get(w, w) for w in re.sub(r"[\W_]+", " ", folded).split()
             if w not in _KEY_STOP and w != "canada"]
    while words and words[0] in _KEY_LEADING:
        words.pop(0)
    while words and words[-1] in _KEY_TRAILING:
        words.pop()
    return " ".join(words)


def _acronym_like(token: str) -> bool:
    return bool(_ACRONYM_TOKEN_RE.match(token)) and sum(c.isupper() for c in token) >= 2


def spelling_forms(text: object) -> list[str]:
    """The forms of a spelling resolve tries, most complete first, without repeats.

    The spelling; its wrapper moved to the front when written last; the part
    before an attention marker; each part between separators, then each part
    between commas; and each of those without its last words, down to two
    words or an acronym ("DND Petawawa" -> "DND").
    """
    full = squash(text)
    bases = [full]
    inverted = _INVERTED_RE.match(full)
    if inverted:
        bases.append(f"{inverted.group('head')} {inverted.group('name')}")
    attention = _ATTENTION_RE.search(full)
    if attention and attention.start() > 0:
        bases.append(full[:attention.start()].rstrip(" ,;:-("))
    parts: list[str] = []
    for base in bases:
        parts += [squash(p) for p in _SEPARATOR_RE.split(base) if squash(p)]
    pieces = [squash(c) for part in [*bases, *parts] for c in _COMMA_RE.split(part) if squash(c)]
    out: list[str] = []
    for form in bases + parts + pieces:
        if form[:4].casefold() == "the ":
            form = form[4:]
        words = _PARENS_RE.sub(" ", form).split()
        out.append(form)
        for n in range(len(words) - 1, 0, -1):
            if n >= 2 or _acronym_like(words[0]):
                out.append(" ".join(words[:n]))
    return list(dict.fromkeys(f for f in out if f))


# Words that mark an institution or a part of one: a spelling of two or three
# words with none of these is read as a person's name (non_institution), on
# top of matching.is_person_name, which leaves out names its given-name list
# does not know.
INSTITUTION_WORDS = frozenset({
    "canada", "canadian", "canadien", "canadienne", "government", "gouvernement", "federal", "federale",
    "national", "nationale", "royal", "royale", "department", "departement", "dept", "ministry", "ministere",
    "minister", "ministre", "office", "bureau", "agency", "agence", "service", "services", "council", "conseil",
    "commission", "commissioner", "commissariat", "board", "centre", "center", "institute", "institut", "program",
    "programme", "general", "generale", "secretariat", "directorate", "direction", "director", "directeur",
    "branch", "division", "sector", "secteur", "unit", "unite", "group", "groupe", "team", "equipe",
    "procurement", "approvisionnement", "acquisition", "acquisitions", "contracts", "contracting", "contrats",
    "leasing", "materiel", "material", "headquarters", "hq", "region", "regional", "college", "academy",
    "museum", "musee", "library", "bibliotheque", "archives", "court", "cour", "tribunal", "corporation",
    "company", "bank", "banque", "authority", "administration", "port", "park", "parks", "parc", "parcs",
    "house", "senate", "senat", "parliament", "parlement", "parliamentary", "police", "defence", "defense",
    "forces", "force", "army", "armee", "navy", "marine", "air", "wing", "escadre", "base", "garrison",
    "command", "commandement", "military", "militaire", "regiment", "squadron", "fleet", "coast", "guard",
    "garde", "health", "sante", "research", "recherche", "science", "sciences", "development", "developpement",
    "affairs", "affaires", "foreign", "international", "trade", "commerce", "finance", "finances", "revenue",
    "revenu", "justice", "transport", "transports", "environment", "environnement", "energy", "energie",
    "fisheries", "peches", "oceans", "agriculture", "industry", "industrie", "innovation", "heritage",
    "patrimoine", "immigration", "citizenship", "citoyennete", "refugee", "refugees", "employment", "emploi",
    "labour", "travail", "statistics", "statistique", "elections", "safety", "securite", "security",
    "intelligence", "correctional", "correctionnel", "veterans", "translation", "traduction", "receiver",
    "embassy", "ambassade", "consulate", "consulat", "mission", "logistics", "logistique", "systems",
    "operations", "support", "facility", "facilities", "depot", "workshop", "station", "laboratory",
    "laboratoire", "project", "projet", "projects", "school", "ecole", "university", "universite", "ombudsman",
    "registry", "greffe", "secretary", "secretaire", "province", "provincial", "territory", "territorial",
    "public", "publics", "works", "network", "reseau", "foundation", "fondation", "fund", "fonds",
})
# A job title: role words, and the words a title is made of around them.
_JOB_ROLES = frozenset({
    "administrator", "officer", "manager", "specialist", "agent", "agente", "clerk", "coordinator",
    "co-ordinator", "coordonnateur", "coordonnatrice", "assistant", "assistante", "adjoint", "adjointe", "buyer",
    "analyst", "analyste", "advisor", "adviser", "conseiller", "conseillere", "consultant", "representative",
    "supervisor", "technician", "gestionnaire", "commis", "acheteur", "acheteuse", "responsable",
})
_JOB_WORDS = _JOB_ROLES | frozenset({
    "contract", "contracts", "contracting", "procurement", "purchasing", "supply", "supplies", "leasing",
    "senior", "junior", "principal", "principale", "lead", "materiel", "material", "acquisition", "acquisitions",
    "real", "property", "financial", "administrative", "technical", "project", "projects", "approvisionnement",
    "approvisionnements", "contrats", "achats", "location", "chef", "en", "de", "des", "du", "la", "of", "the",
    "and", "et", "aux", "a",
})
_STREET_WORDS = frozenset({
    "street", "st", "avenue", "ave", "av", "road", "rd", "boulevard", "blvd", "boul", "drive", "dr", "promenade",
    "passage", "rue", "chemin", "ch", "place", "pl", "lane", "ln", "way", "crescent", "cres", "court", "ct",
    "parkway", "pkwy", "highway", "hwy", "route", "rte", "building", "bldg", "batiment", "suite", "floor",
    "etage", "terrace", "circle", "square", "trail", "quai", "cote", "montee", "rang", "allee", "impasse",
    "voie", "sentier", "carre", "croissant", "autoroute", "po", "box", "cp", "case", "postale",
})
# Words that say "the government" without naming any part of it.
_GENERIC_WORDS = frozenset({"government", "gouvernement", "federal", "federale", "fed", "gov", "govt", "gouv", "t",
                            "gc", "canada", "canadian", "test", "public", "crown"})
_STREET_NUMBER_RE = re.compile(r"^\s*\d+[A-Za-z]?(?:[-\u2013]\d+)?\s")
_NAME_WORD_RE = re.compile(r"[^\W\d_]+(?:['\u2019.\-][^\W\d_]+)*\.?")


def _folded_words(text: str) -> list[str]:
    return re.sub(r"[^\w\s-]|_", " ", fold_accents(text).casefold()).split()


def _reads_as_person(text: str) -> bool:
    """matching.is_person_name, or two or three name words with no institution word, acronym or legal form."""
    if matching.is_person_name(text):
        return True
    words = text.split()
    if not 2 <= len(words) <= 3 or has_legal_form(text):
        return False
    if any(not _NAME_WORD_RE.fullmatch(w) for w in words):
        return False
    if text.isupper():
        # "KATIE MCKEEVER" is a name; "VIA HFR" and "RCAF AWC" are acronyms.
        if any(len(w.rstrip(".")) <= 4 for w in words):
            return False
    elif any(len(w.rstrip(".")) >= 2 and w.rstrip(".").isupper() for w in words):
        return False
    elif not text.islower() and not all(w[0].isupper() for w in words):
        return False  # "Raw buyer": a name is written in one case throughout
    folded = [fold_accents(w).casefold().strip(".") for w in words]
    return not any(w in INSTITUTION_WORDS or w in _KEY_STOP or w in _JOB_WORDS for w in folded)


def non_institution(text: object) -> str | None:
    """Why a spelling no rule matched names no institution, or None when it may name one.

    A person's name (matching.is_person_name, or two or three name words with
    no institution word), a single word, a job title ("Contract
    Administrator"), a street address (a number then a street word), an
    attention line ("Attn: ...", "c/o ...", "À l'attention de : ..."), or
    words that name the government as a whole ("Government of Canada").
    """
    raw = squash(text)
    if not raw:
        return None
    if _ATTENTION_LINE_RE.match(raw):
        return "attention line"
    words = _folded_words(raw)
    if _STREET_NUMBER_RE.match(raw) and any(w in _STREET_WORDS for w in words):
        return "street address"
    parts = [p for p in _SEPARATOR_RE.split(raw) if p]
    if len(raw.split()) == 1 and (len(parts) == 1 or max(len(p) for p in parts) < 3):
        return "single word"
    if words and all(w in _JOB_WORDS for w in words) and any(w in _JOB_ROLES for w in words):
        return "job title"
    if all(w in _GENERIC_WORDS for w in name_key(raw).split()) or not name_key(raw):
        return "no institution named"
    if _reads_as_person(raw):
        return "person"
    return None


# The reasons that make a spelling unfit to publish: it names or locates a person.
PRIVATE_REASONS = frozenset({"person", "attention line", "street address"})


@lru_cache(maxsize=8192)
def public_spelling(text: str | None) -> str | None:
    """A raw buyer spelling fit to show where a record names no buyer, or None.

    None for a blank and for a spelling that names or locates a person
    (non_institution: a person's name, an attention line, a street address),
    which the exports never print; any other spelling is shown as written,
    with runs of white space made one.
    """
    raw = squash(text)
    if not raw:
        return None
    return None if non_institution(raw) in PRIVATE_REASONS else raw


_EMAIL_RE = re.compile(r"\S@\S")
_PHONE_RE = re.compile(r"\d[\d\s().-]{6,}\d")


@lru_cache(maxsize=8192)
def shown_spelling(text: str | None) -> str | None:
    """A buyer's spelling fit to list on its page ("Also appears as"), or None.

    Stricter than public_spelling, because the page lists a spelling as a
    name of the institution: none that names or locates a person anywhere in
    it (an attention line after the name, a part between separators that
    reads as a person's name), and none with an email address or a telephone
    number.
    """
    raw = public_spelling(text)
    if raw is None or _ATTENTION_RE.search(raw) or _EMAIL_RE.search(raw) or _PHONE_RE.search(raw):
        return None
    parts = [squash(p) for p in _SEPARATOR_RE.split(raw) for p in _COMMA_RE.split(p) if squash(p)]
    if any(non_institution(p) in PRIVATE_REASONS for p in parts):
        return None
    return raw


# ---------------------------------------------------------------------------
# The alias seed (awardwatch_pipeline/data/buyer_aliases.csv)
# ---------------------------------------------------------------------------

def read_aliases(path: Path | None = None) -> list[dict[str, str]]:
    """The alias seed's rows ('#' lines are comments).

    A row that breaks the file's rules raises ValueError, so a bad edit fails
    the buyers stage rather than merging the wrong buyers: a note outside
    ALIAS_NOTES, a placeholder with a buyer or a buyer-less row that is not a
    placeholder, a row with no reason, and one name (by key) given two buyers.
    """
    src = path or ALIAS_PATH
    if not src.exists():
        return []
    lines = [line for line in src.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#")]
    rows: list[dict[str, str]] = []
    targets: dict[str, str] = {}
    for rec in csv.DictReader(io.StringIO("\n".join(lines))):
        row = {k: squash(rec.get(k)) for k in ALIAS_COLUMNS}
        if not row["alias"]:
            continue
        where = f"{src.name}: {row['alias']!r}"
        if row["note"] not in ALIAS_NOTES:
            raise ValueError(f"{where}: the note {row['note']!r} is not one of {', '.join(ALIAS_NOTES)}")
        if (row["note"] == "placeholder") == bool(row["buyer_id"]):
            raise ValueError(f"{where}: a placeholder names no buyer, and every other row names one")
        if not row["why"]:
            raise ValueError(f"{where}: every row says why")
        key = name_key(row["alias"])
        if not key:
            raise ValueError(f"{where}: the name has no key (buyers.name_key)")
        if targets.setdefault(key, row["buyer_id"]) != row["buyer_id"]:
            raise ValueError(f"{where}: the name is given to {targets[key] or 'no buyer'} on another row")
        rows.append(row)
    return rows


@lru_cache(maxsize=4)
def _placeholder_keys(path: str) -> frozenset[str]:
    return frozenset(name_key(r["alias"]) for r in read_aliases(Path(path)) if not r["buyer_id"])


def is_placeholder_name(text: object) -> bool:
    """A source's way of naming no institution: matching.is_placeholder's blanks ("N/A", "TBD"), or a
    placeholder row of the alias seed ("Other (Specify)", the lobbying registry's choice for an
    institution not on its list), however it is written."""
    if matching.is_placeholder(text):
        return True
    raw = squash(text)
    return bool(raw) and name_key(raw) in _placeholder_keys(str(ALIAS_PATH))


# ---------------------------------------------------------------------------
# The key index: every CKAN title and seed name by its key (tier "known"), and
# every buyer rule 6 made by its names' keys (tier "made"). A temporary table,
# so it lives with the connection; built again when the buyers or their names
# change.
# ---------------------------------------------------------------------------

def _titles_in() -> str:
    """The SQL list of TITLE_SOURCES, for a query that names them (they are constants, never input)."""
    return ", ".join(f"'{s}'" for s in TITLE_SOURCES)


def _index_stamp(conn: sqlite3.Connection) -> str:
    known = conn.execute("SELECT COUNT(*), COALESCE(SUM(length(raw_name) + length(buyer_id)), 0) FROM buyer_names "
                         f"WHERE source IN ({_titles_in()})").fetchone()
    every = conn.execute("SELECT COUNT(*), COALESCE(SUM(length(id) + length(name_en)), 0) FROM buyers").fetchone()
    return f"{known[0]}:{known[1]}:{every[0]}:{every[1]}"


def forget_keys(conn: sqlite3.Connection) -> None:
    """Drop the key index; the next lookup builds it again."""
    conn.execute("DROP TABLE IF EXISTS temp.buyer_keys")
    conn.execute("DROP TABLE IF EXISTS temp.buyer_keys_stamp")


def _ensure_keys(conn: sqlite3.Connection) -> None:
    stamp = _index_stamp(conn)
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS buyer_keys_stamp (stamp TEXT)")
    row = conn.execute("SELECT stamp FROM temp.buyer_keys_stamp").fetchone()
    if row is not None and row[0] == stamp:
        return
    conn.execute("DROP TABLE IF EXISTS temp.buyer_keys")
    conn.execute("CREATE TEMP TABLE buyer_keys (key TEXT NOT NULL, buyer_id TEXT NOT NULL, tier TEXT NOT NULL)")
    rows = {(name_key(raw), bid, "known") for raw, bid in conn.execute(
        f"SELECT raw_name, buyer_id FROM buyer_names WHERE source IN ({_titles_in()})")}
    # An acronym of more than one word is a name ("FedDev Ontario", "VIA Rail"):
    # one word alone is matched as an acronym (_by_bare_acronym), where the
    # English and French acronyms tell apart the buyers that share one.
    for bid, a_en, a_fr in conn.execute("SELECT id, acronym_en, acronym_fr FROM buyers WHERE ckan_org IS NOT NULL"):
        rows.update((name_key(a), bid, "known") for a in (a_en, a_fr) if a and " " in a.strip())
    seed_ids = {r[0] for r in conn.execute("SELECT DISTINCT buyer_id FROM buyer_names WHERE source = 'seed'")}
    for bid, en, fr in conn.execute("SELECT id, name_en, name_fr FROM buyers WHERE ckan_org IS NULL"):
        if bid not in seed_ids:
            rows.update((name_key(n), bid, "made") for n in (en, fr) if n)
    conn.executemany("INSERT INTO temp.buyer_keys (key, buyer_id, tier) VALUES (?, ?, ?)", [r for r in rows if r[0]])
    conn.execute("CREATE INDEX IF NOT EXISTS temp.buyer_keys_key ON buyer_keys(key, tier)")
    conn.execute("DELETE FROM temp.buyer_keys_stamp")
    conn.execute("INSERT INTO temp.buyer_keys_stamp (stamp) VALUES (?)", (stamp,))


def key_index(conn: sqlite3.Connection) -> list[tuple[str, str, str]]:
    """The key index as (key, buyer_id, tier) rows, built first if it is stale: what rules 4 and 6 match
    against, for the same-day refresh's lookup (intraday.py), which resolves without the database."""
    _ensure_keys(conn)
    return [tuple(r) for r in conn.execute("SELECT key, buyer_id, tier FROM temp.buyer_keys ORDER BY key, buyer_id, tier")]


def _keyed(conn: sqlite3.Connection, key: str, tier: str, exclude: set[str]) -> str | None:
    if not key:
        return None
    _ensure_keys(conn)
    hits = {r[0] for r in conn.execute("SELECT DISTINCT buyer_id FROM temp.buyer_keys WHERE key = ? AND tier = ?",
                                       (key, tier))} - exclude
    return hits.pop() if len(hits) == 1 else None


def _by_key(conn: sqlite3.Connection, form: str, exclude: set[str]) -> str | None:
    """Rule 4 for one form: its key, without its bracketed words and with them, equal to one known name's key."""
    for key in dict.fromkeys((name_key(_PARENS_RE.sub(" ", form)), name_key(form))):
        hit = _keyed(conn, key, "known", exclude)
        if hit:
            return hit
    return None


def _by_bare_acronym(conn: sqlite3.Connection, form: str, exclude: set[str]) -> str | None:
    """An acronym standing alone ("DND", "RCMP-GRC", "NRCan"), matched as an English then a French acronym."""
    if " " in form or not _acronym_like(form.replace("-", "")):
        return None
    for part in [form, *form.split("-")]:
        if part and _acronym_like(part):
            hit = _by_acronym(conn, part, None, exclude) or _by_acronym(conn, None, part, exclude)
            if hit:
                return hit
    return None


def _note(conn: sqlite3.Connection, text: str) -> None:
    # A temporary table: per connection, gone when it closes, and rolled back
    # with the stage that created the buyer.
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS buyer_notices (text TEXT NOT NULL)")
    conn.execute("INSERT INTO buyer_notices (text) VALUES (?)", (text,))


def take_notices(conn: sqlite3.Connection) -> list[str]:
    """The buyers resolve created since the last call, as notice lines; the list is then emptied."""
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS buyer_notices (text TEXT NOT NULL)")
    lines = [r[0] for r in conn.execute("SELECT text FROM buyer_notices ORDER BY rowid")]
    conn.execute("DELETE FROM buyer_notices")
    return lines


def _reject(conn: sqlite3.Connection, raw: str, reason: str) -> None:
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS buyer_rejects (raw TEXT NOT NULL, reason TEXT NOT NULL)")
    conn.execute("INSERT INTO buyer_rejects (raw, reason) VALUES (?, ?)", (raw, reason))


def take_rejects(conn: sqlite3.Connection) -> list[tuple[str, str]]:
    """The spellings resolve read as no institution since the last call, as (reason, spelling) without
    repeats, in the order first met; the list is then emptied. People's names may be among them: they go
    to the stage's review file, never to the log."""
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS buyer_rejects (raw TEXT NOT NULL, reason TEXT NOT NULL)")
    rows = [(r[1], r[0]) for r in conn.execute("SELECT raw, reason FROM buyer_rejects ORDER BY rowid")]
    conn.execute("DELETE FROM buyer_rejects")
    return list(dict.fromkeys(rows))


def _record(conn: sqlite3.Connection, buyer_id: str, source: str, *names: str) -> None:
    conn.executemany(
        "INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, ?, ?) ON CONFLICT(raw_name, source) DO NOTHING",
        [(name, source, buyer_id) for name in names if name],
    )


def _lookup(conn: sqlite3.Connection, names: list[str], source: str) -> str | None:
    for name in names:
        row = conn.execute("SELECT buyer_id FROM buyer_names WHERE raw_name = ? AND source = ?",
                           (name, source)).fetchone()
        if row:
            return row[0]
    return None


def _by_title(conn: sqlite3.Connection, names: list[str], exclude: set[str]) -> str | None:
    marks = ",".join("?" * len(TITLE_SOURCES))
    for name in names:
        for candidate in dict.fromkeys((name, split_acronym(name)[0])):
            hits = {r[0] for r in conn.execute(
                f"SELECT buyer_id FROM buyer_names WHERE raw_name = ? COLLATE NOCASE AND source IN ({marks})",
                (candidate, *TITLE_SOURCES),
            )} - exclude
            if len(hits) == 1:
                return hits.pop()
    return None


def _by_acronym(conn: sqlite3.Connection, acronym_en: str | None, acronym_fr: str | None,
                exclude: set[str]) -> str | None:
    en, fr = _acronym_key(acronym_en), _acronym_key(acronym_fr)
    if not en and not fr:
        return None
    en_hits: set[str] = set()
    fr_hits: set[str] = set()
    for bid, a_en, a_fr in conn.execute(
        "SELECT id, acronym_en, acronym_fr FROM buyers WHERE acronym_en IS NOT NULL OR acronym_fr IS NOT NULL"
    ):
        if bid in exclude:
            continue
        if en and _acronym_key(a_en) == en:
            en_hits.add(bid)
        if fr and _acronym_key(a_fr) == fr:
            fr_hits.add(bid)
    if len(en_hits) == 1:
        return en_hits.pop()
    if en_hits and fr_hits and len(en_hits & fr_hits) == 1:
        return (en_hits & fr_hits).pop()
    if not en_hits and len(fr_hits) == 1:
        return fr_hits.pop()
    return None


def _match(conn: sqlite3.Connection, en: str, fr: str, exclude: set[str] | None = None) -> str | None:
    """Rules 2, 3 and 4 of the module docstring."""
    skip = exclude or set()
    names = [n for n in (en, fr) if n]
    hit = _by_title(conn, names, skip) or _by_acronym(
        conn, split_acronym(en)[1] if en else None, split_acronym(fr)[1] if fr else None, skip)
    if hit:
        return hit
    # The acronym in brackets is a name of its own too ("(ECCC)", "(DLP 7)"),
    # which the seed may list as a former or a unit's acronym.
    for name in [*names, *(_PARENS_RE.search(n).group(0)[1:-1] for n in names if _PARENS_RE.search(n))]:
        for form in spelling_forms(name):
            hit = _by_key(conn, form, skip) or _by_bare_acronym(conn, form, skip)
            if hit:
                return hit
    return None


def resolve(
    conn: sqlite3.Connection,
    raw_en: str | None,
    raw_fr: str | None = None,
    *,
    source: str = "canadabuys",
    now: str | None = None,
) -> str | None:
    """The buyer a source's spelling of an institution names; None when both spellings are blank."""
    en, fr = (squash(raw) for raw in (raw_en, raw_fr))
    # A placeholder ("N/A", the registry's "Other (Specify)") names nothing, so it counts as blank.
    en, fr = ("" if is_placeholder_name(en) else en), ("" if is_placeholder_name(fr) else fr)
    if not en and not fr:
        return None
    hit = _lookup(conn, [n for n in (en, fr) if n], source) or _match(conn, en, fr)
    if hit:
        _record(conn, hit, source, en, fr)
        return hit
    reason = non_institution(en or fr)
    if reason:
        _reject(conn, en or fr, reason)
        return None
    name_en, acronym_en = split_acronym(en or fr)
    name_fr, acronym_fr = split_acronym(fr) if fr else (None, None)
    # Rule 6: "Senate", "The Senate of Canada" and "SENATE OF CANADA" are one buyer.
    bid = _keyed(conn, name_key(_PARENS_RE.sub(" ", en or fr)), "made", set())
    if bid is None:
        bid = slugify(name_en) or slugify(name_fr) or "buyer"
        # An institution only the lobbying registry names is listed apart from the
        # departments from the start (refresh_kinds keeps it so each night).
        kind = INSTITUTION if source == "lobbying" else None
        conn.execute(
            "INSERT INTO buyers (id, name_en, name_fr, acronym_en, acronym_fr, kind, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            (bid, name_en, name_fr, acronym_en, acronym_fr, kind, now or now_iso()),
        )
        _note(conn, f"buyer {bid} made for '{en or fr}'")
    _record(conn, bid, source, en, fr)
    return bid


def for_owner_org(conn: sqlite3.Connection, owner_org: str, title: str | None, *, now: str | None = None) -> str:
    """The buyer of a proactive-publication row: its owner_org is the open.canada.ca organization name.

    Created from the "English | French" title when CKAN did not list it (a
    run without CKAN, or an organization created since the last load). An
    organization the buyers stage merged into another (a CKAN twin, a former
    name) gives the buyer it went to, so a reload of the publications never
    makes the retired buyer again.
    """
    bid = squash(owner_org)
    if conn.execute("SELECT 1 FROM buyers WHERE id = ?", (bid,)).fetchone():
        return bid
    moved = conn.execute("SELECT a.new_id FROM buyer_aliases a JOIN buyers b ON b.id = a.new_id WHERE a.old_id = ?",
                         (bid,)).fetchone()
    if moved:
        return moved[0]
    parts = [squash(p) for p in str(title or "").split("|")]
    name_en = parts[0] if parts and parts[0] else bid
    name_fr = parts[1] if len(parts) > 1 and parts[1] else None
    conn.execute(
        "INSERT INTO buyers (id, name_en, name_fr, ckan_org, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
        (bid, name_en, name_fr, bid, now or now_iso()),
    )
    _record(conn, bid, "ckan", name_en, name_fr or "")
    # Listed like a buyer resolve makes: CKAN not listing an organization the
    # publications name is worth a look (a run without CKAN, or a new one).
    _note(conn, f"buyer {bid} made for '{name_en}' (not among the CKAN organizations loaded)")
    return bid


# ---------------------------------------------------------------------------
# Loading: CKAN organizations and the seed
# ---------------------------------------------------------------------------

def _pair(value: object) -> tuple[str | None, str | None]:
    """CKAN's bilingual fields arrive as {"en": .., "fr": ..} or as "English | French"."""
    if isinstance(value, dict):
        return squash(value.get("en")) or None, squash(value.get("fr")) or None
    parts = [squash(p) for p in str(value or "").split("|")]
    return (parts[0] or None) if parts else None, (parts[1] or None) if len(parts) > 1 else None


def upsert_ckan(conn: sqlite3.Connection, org: dict, *, now: str) -> str | None:
    """Write one organization_show result as a buyer; returns the id, None when it has no name."""
    bid = squash(org.get("name"))
    if not bid:
        return None
    title_en, title_fr = _pair(org.get("title_translated"))
    plain_en, plain_fr = _pair(org.get("title"))
    name_en = title_en or plain_en or bid
    name_fr = title_fr or plain_fr
    acronym_en, acronym_fr = _pair(org.get("shortform"))
    number = squash(org.get("department_number")) or None
    values = (name_en, name_fr, acronym_en, acronym_fr, bid, number)
    row = conn.execute("SELECT name_en, name_fr, acronym_en, acronym_fr, ckan_org, department_number FROM buyers "
                       "WHERE id = ?", (bid,)).fetchone()
    if row is None:
        conn.execute("INSERT INTO buyers (id, name_en, name_fr, acronym_en, acronym_fr, ckan_org, department_number, "
                     "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (bid, *values, now))
    elif tuple(row) != values:
        conn.execute("UPDATE buyers SET name_en = ?, name_fr = ?, acronym_en = ?, acronym_fr = ?, ckan_org = ?, "
                     "department_number = ?, updated_at = ? WHERE id = ?", (*values, now, bid))
    conn.executemany(
        "INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, 'ckan', ?) "
        "ON CONFLICT(raw_name, source) DO UPDATE SET buyer_id = excluded.buyer_id",
        [(name, bid) for name in (name_en, name_fr) if name],
    )
    forget_keys(conn)
    return bid


def load_ckan(conn: sqlite3.Connection, client: PoliteClient, *, now: str) -> tuple[list[str], list[str]]:
    """organization_list, then organization_show per name; returns (ids loaded, names that failed)."""
    listing = client.get_json(config.CKAN_ORGANIZATION_LIST, cache=True, max_age_s=CACHE_S)
    if not listing.get("success") or not isinstance(listing.get("result"), list):
        raise ValueError("organization_list did not answer with a list of names")
    loaded: list[str] = []
    failed: list[str] = []
    for name in listing["result"]:
        url = config.CKAN_ORGANIZATION_SHOW.format(name=quote(str(name), safe=""))
        try:
            answer = client.get_json(url, cache=True, max_age_s=CACHE_S)
        except (FetchError, ValueError) as exc:
            log.warning("organization_show %s: %s", name, exc)
            failed.append(str(name))
            continue
        bid = upsert_ckan(conn, answer.get("result") or {}, now=now) if answer.get("success") else None
        if bid:
            loaded.append(bid)
        else:
            failed.append(str(name))
    conn.commit()
    return loaded, failed


def read_seed(path: Path | None = None) -> list[dict[str, str]]:
    """The seed's rows; lines starting with '#' are comments."""
    src = path or SEED_PATH
    if not src.exists():
        return []
    lines = [line for line in src.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#")]
    rows = []
    for rec in csv.DictReader(io.StringIO("\n".join(lines))):
        row = {k: squash(rec.get(k)) for k in SEED_COLUMNS}
        if row["buyer_id"]:
            rows.append(row)
    return rows


def load_seed(conn: sqlite3.Connection, rows: list[dict[str, str]], *, now: str) -> int:
    """Create the seed's buyers where missing (filling blanks, never overwriting CKAN's values) and map its spellings.

    A seed mapping wins over any earlier resolution of the same spelling; a
    spelling it takes from a buyer made by rule 6 (or named by an earlier
    seed) is noted, so merge moves that buyer's records with it. Each
    spelling is also kept as a seed name, so rule 4 matches it however it is
    written ("PWGSC", "Public Works & Government Services Canada (PWGSC)"),
    and the seed names are the current file's alone.
    """
    conn.execute("DELETE FROM buyer_names WHERE source = 'seed'")
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS buyer_seed_moves (old TEXT NOT NULL, new TEXT NOT NULL)")
    for row in rows:
        conn.execute(
            "INSERT INTO buyers (id, name_en, name_fr, acronym_en, acronym_fr, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET name_fr = COALESCE(buyers.name_fr, excluded.name_fr), "
            "acronym_en = COALESCE(buyers.acronym_en, excluded.acronym_en), "
            "acronym_fr = COALESCE(buyers.acronym_fr, excluded.acronym_fr)",
            (row["buyer_id"], row["name_en"] or row["buyer_id"], row["name_fr"] or None, row["acronym_en"] or None,
             row["acronym_fr"] or None, now),
        )
        names = [n for n in (row["name_en"], row["name_fr"]) if n]
        conn.executemany(
            "INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, 'seed', ?) ON CONFLICT DO NOTHING",
            [(n, row["buyer_id"]) for n in names],
        )
        if row["raw_name"]:
            source = row["source"] or "canadabuys"
            before = conn.execute("SELECT buyer_id FROM buyer_names WHERE raw_name = ? AND source = ?",
                                  (row["raw_name"], source)).fetchone()
            if before is not None and before[0] != row["buyer_id"]:
                conn.execute("INSERT INTO buyer_seed_moves (old, new) VALUES (?, ?)", (before[0], row["buyer_id"]))
            conn.executemany(
                "INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, ?, ?) "
                "ON CONFLICT(raw_name, source) DO UPDATE SET buyer_id = excluded.buyer_id",
                [(row["raw_name"], source, row["buyer_id"]), (row["raw_name"], "seed", row["buyer_id"])],
            )
    forget_keys(conn)
    conn.commit()
    return len(rows)


def load_aliases(conn: sqlite3.Connection, rows: list[dict[str, str]]) -> list[str]:
    """Map the alias seed's names (source 'alias' in buyer_names), each to its buyer; returns the rows not applied.

    The alias names are titles to the resolver (TITLE_SOURCES): matched as
    written (rule 2) and by key (rule 4), never as a spelling a record
    carries, and they are the current file's alone. A row whose buyer is not
    in the database (a CKAN organization not loaded, as on a samples run) is
    left out tonight and listed in the review file. Placeholder rows map
    nothing here: is_placeholder_name reads them.
    """
    conn.execute("DELETE FROM buyer_names WHERE source = 'alias'")
    live = {r[0] for r in conn.execute("SELECT id FROM buyers")}
    unapplied: list[str] = []
    for row in rows:
        if not row["buyer_id"]:
            continue
        if row["buyer_id"] not in live:
            unapplied.append(f"{row['alias']}\t{row['buyer_id']}\tno buyer {row['buyer_id']} in the database tonight")
            continue
        conn.execute("INSERT INTO buyer_names (raw_name, source, buyer_id) VALUES (?, 'alias', ?) "
                     "ON CONFLICT(raw_name, source) DO UPDATE SET buyer_id = excluded.buyer_id",
                     (row["alias"], row["buyer_id"]))
    forget_keys(conn)
    return unapplied


# ---------------------------------------------------------------------------
# Merges: one institution under two buyer ids becomes one buyer
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class BuyerMerge:
    old: str
    new: str | None             # None: the buyer named no institution, so its records keep no buyer
    reason: str                 # MERGE_REASONS
    evidence: str               # the alias row, the shared title, the name or the spellings that decided it
    name_en: str | None         # the retired buyer's names, which the live buyer's page lists
    name_fr: str | None


@dataclass
class MergeOutcome:
    merges: list[BuyerMerge] = field(default_factory=list)
    review: list[str] = field(default_factory=list)      # made buyers left as they are, one line each
    unapplied: list[str] = field(default_factory=list)   # alias rows naming no buyer in the database
    moved: int = 0                                       # record rows re-pointed

    def new_since(self, previous: dict[str, str]) -> list[BuyerMerge]:
        """The merges that were not already in buyer_aliases with the same target."""
        return [m for m in self.merges if m.new is None or previous.get(m.old) != m.new]


def merge(conn: sqlite3.Connection, seed_ids: set[str], *, now: str | None = None,
          aliases: list[dict[str, str]] | None = None) -> MergeOutcome:
    """The night's buyer merges (the module docstring's rules 1 to 5), applied in one transaction.

    seed_ids are the buyers buyers.csv defines; aliases the alias seed's
    rows (read_aliases). Returns what was merged and what was left for
    review; the caller writes the review file.
    """
    stamp = now or now_iso()
    outcome = MergeOutcome()
    try:
        forget_keys(conn)
        rows = {r["id"]: r for r in conn.execute(
            "SELECT id, name_en, name_fr, ckan_org, department_number FROM buyers")}
        ckan = {bid for bid, r in rows.items() if r["ckan_org"]}
        made = set(rows) - ckan - seed_ids
        alias_rows = aliases or []
        earlier = {r[0] for r in conn.execute("SELECT DISTINCT new_id FROM buyer_aliases")}
        named = seed_ids | {a["buyer_id"] for a in alias_rows if a["buyer_id"]}
        chosen: dict[str, tuple[str | None, str, str]] = {}
        records = _RecordCounts(conn)
        _by_alias(rows, alias_rows, chosen)
        outcome.review += _ckan_twins(conn, rows, ckan, chosen, earlier, named, records)
        outcome.review += _made(conn, rows, made, chosen, records)
        final = _follow(chosen)
        outcome.merges = [BuyerMerge(old, new, reason, evidence, rows[old]["name_en"], rows[old]["name_fr"])
                          for old, (new, reason, evidence) in sorted(final.items())]
        outcome.moved = _apply(conn, outcome.merges, stamp)
        forget_keys(conn)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return outcome


def _by_alias(rows: dict[str, sqlite3.Row], aliases: list[dict[str, str]],
              chosen: dict[str, tuple[str | None, str, str]]) -> None:
    """Rule 1: a buyer whose own English or French name is, by key, an alias of another buyer."""
    by_key: dict[str, dict[str, str]] = {}
    for a in aliases:
        if a["buyer_id"] and a["buyer_id"] in rows:
            by_key.setdefault(name_key(a["alias"]), a)
    for bid in sorted(rows):
        r = rows[bid]
        for name in (r["name_en"], r["name_fr"]):
            a = by_key.get(name_key(name)) if name else None
            if a is not None and a["buyer_id"] != bid:
                chosen[bid] = (a["buyer_id"], "alias", f"{a['note']}: {a['alias']} ({a['why']})")
                break


class _RecordCounts:
    """Each buyer's record rows across BUYER_COLUMNS, read in one pass the first time one is asked: the
    contract history's buyer_id has no index, and a night may ask about dozens of buyers."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.counts: dict[str, int] | None = None

    def __call__(self, bid: str) -> int:
        if self.counts is None:
            self.counts = defaultdict(int)
            for table, column in BUYER_COLUMNS:
                for b, n in self.conn.execute(
                        f"SELECT {column}, COUNT(*) FROM {table} WHERE {column} IS NOT NULL GROUP BY {column}"):
                    self.counts[b] += n
        return self.counts.get(bid, 0)


def _ckan_twins(conn: sqlite3.Connection, rows: dict[str, sqlite3.Row], ckan: set[str],
                chosen: dict[str, tuple[str | None, str, str]], earlier: set[str], named: set[str],
                records: _RecordCounts) -> list[str]:
    """Rule 2: CKAN organizations whose English titles share a key and whose French titles agree where both
    have one. Returns the review lines of those whose French titles disagree."""
    groups: dict[str, list[str]] = defaultdict(list)
    for bid in sorted(ckan - set(chosen)):
        key = name_key(rows[bid]["name_en"])
        if key:
            groups[key].append(bid)
    review: list[str] = []
    for key, members in sorted(groups.items()):
        if len(members) < 2:
            continue
        counts = {b: records(b) for b in members}
        survivor = min(members, key=lambda b: (b not in earlier, b not in named, not rows[b]["department_number"],
                                               -counts[b], len(b), b))
        fr = name_key(rows[survivor]["name_fr"]) if rows[survivor]["name_fr"] else ""
        for b in members:
            if b == survivor:
                continue
            other = name_key(rows[b]["name_fr"]) if rows[b]["name_fr"] else ""
            if fr and other and fr != other:
                review.append(f"{b}\t{rows[b]['name_en']}\t{counts[b]}\tthe English title of {survivor}, "
                              f"another French title ({rows[b]['name_fr']} / {rows[survivor]['name_fr']})")
                continue
            chosen[b] = (survivor, "ckan_twin", f"CKAN title as {survivor}: {rows[b]['name_en']}")
    return review


def _made(conn: sqlite3.Connection, rows: dict[str, sqlite3.Row], made: set[str],
          chosen: dict[str, tuple[str | None, str, str]], records: _RecordCounts) -> list[str]:
    """Rules 3 to 5, for the buyers made by rule 6 that rule 1 left; re-points each of their spellings by
    itself on the way. Returns the review lines of those left as they are."""
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS buyer_seed_moves (old TEXT NOT NULL, new TEXT NOT NULL)")
    moves: dict[str, set[str]] = defaultdict(set)
    for old, new in conn.execute("SELECT old, new FROM buyer_seed_moves ORDER BY rowid").fetchall():
        if old != new:
            moves[old].add(new)
    conn.execute("DELETE FROM buyer_seed_moves")
    review: list[str] = []
    marks = _titles_in()
    for bid in sorted(made - set(chosen)):
        r = rows[bid]
        spellings = conn.execute(f"SELECT raw_name, source FROM buyer_names WHERE buyer_id = ? AND source NOT IN ({marks})",
                                 (bid,)).fetchall()
        # A seed row that took a spelling from this buyer said where it goes.
        to: set[str] = set(moves.get(bid, set()))
        left: list[str] = []
        none = 0
        for raw, source in spellings:
            new = _match(conn, raw, "", made)
            if new:
                conn.execute("UPDATE buyer_names SET buyer_id = ? WHERE raw_name = ? AND source = ?", (new, raw, source))
                to.add(new)
            elif non_institution(raw) or is_placeholder_name(raw):
                conn.execute("DELETE FROM buyer_names WHERE raw_name = ? AND source = ?", (raw, source))
                none += 1
            else:
                left.append(raw)
        target = _match(conn, r["name_en"] or "", r["name_fr"] or "", made)
        if target and to <= {target}:
            chosen[bid] = (target, "name", f"its name {r['name_en']!r} is {target}'s")
        elif target:
            review.append(f"{bid}\t{r['name_en']}\t{records(bid)}\tits name is {target}'s but its "
                          f"spellings name {', '.join(sorted(to - {target}))}")
        elif len(to) == 1 and not left and not none:
            shown = "; ".join(raw for raw, _ in spellings)
            chosen[bid] = (next(iter(to)), "spellings", f"every spelling: {shown[:300]}")
        elif not to and not left and (none or not records(bid)):
            chosen[bid] = (None, "no_institution",
                           "every spelling reads as no institution" if none else "no spelling and no record left")
        else:
            if to:
                why = f"its spellings name {', '.join(sorted(to))} and others nothing"
            elif left and all(source == "lobbying" for _, source in spellings):
                why = "only the lobbying registry names it: kept as an institution; a buyer_aliases.csv row merges it"
            elif left:
                why = "no CKAN or seed name matches it; a row of buyers.csv or buyer_aliases.csv places it"
            else:
                why = "records but no spelling left; a row of buyer_aliases.csv with its name places it"
            review.append(f"{bid}\t{r['name_en']}\t{records(bid)}\t{why}")
    return review


def _follow(chosen: dict[str, tuple[str | None, str, str]]) -> dict[str, tuple[str | None, str, str]]:
    """Each merge with its target followed to the buyer that stays (a target merged in turn); a loop merges none
    of its members."""
    final: dict[str, tuple[str | None, str, str]] = {}
    for old, (new, reason, evidence) in chosen.items():
        seen = {old}
        target = new
        while target is not None and target in chosen and target not in seen:
            seen.add(target)
            target = chosen[target][0]
        if target is not None and target in seen:
            continue
        final[old] = (target, reason, evidence)
    return final


def _apply(conn: sqlite3.Connection, merges: list[BuyerMerge], stamp: str) -> int:
    """Move every row of every source off the merged buyers, re-point their names, drop their derived rows and
    the buyers themselves, and keep each retired id as an alias. Returns the record rows moved."""
    if not merges:
        return 0
    conn.execute("DROP TABLE IF EXISTS temp.buyer_merge_map")
    conn.execute("CREATE TEMP TABLE buyer_merge_map (old TEXT PRIMARY KEY, new TEXT)")
    conn.executemany("INSERT INTO temp.buyer_merge_map (old, new) VALUES (?, ?)", [(m.old, m.new) for m in merges])
    moved = 0
    for table, column in BUYER_COLUMNS:
        moved += conn.execute(
            f"UPDATE {table} SET {column} = (SELECT m.new FROM temp.buyer_merge_map m WHERE m.old = {table}.{column}) "
            f"WHERE {column} IN (SELECT old FROM temp.buyer_merge_map)").rowcount
    for m in merges:
        _replace_in_lobbying(conn, m.old, m.new)
        if m.new:
            conn.execute("UPDATE buyer_names SET buyer_id = ? WHERE buyer_id = ?", (m.new, m.old))
        else:
            conn.execute("DELETE FROM buyer_names WHERE buyer_id = ?", (m.old,))
        for table, column in DERIVED_BUYER_COLUMNS:
            conn.execute(f"DELETE FROM {table} WHERE {column} = ?", (m.old,))
        conn.execute("DELETE FROM buyers WHERE id = ?", (m.old,))
        if m.new:
            _alias(conn, m.old, m.new, m.reason, stamp, m.name_en, m.name_fr)
        else:
            conn.execute("DELETE FROM buyer_aliases WHERE old_id = ?", (m.old,))
    conn.execute("DROP TABLE temp.buyer_merge_map")
    return moved


def _alias(conn: sqlite3.Connection, old: str, new: str, reason: str, now: str | None,
           name_en: str | None = None, name_fr: str | None = None) -> None:
    conn.execute(
        "INSERT INTO buyer_aliases (old_id, new_id, reason, updated_at, name_en, name_fr) VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(old_id) DO UPDATE SET new_id = excluded.new_id, reason = excluded.reason, "
        "updated_at = excluded.updated_at, name_en = COALESCE(excluded.name_en, buyer_aliases.name_en), "
        "name_fr = COALESCE(excluded.name_fr, buyer_aliases.name_fr)",
        (old, new, reason, now or now_iso(), name_en, name_fr),
    )


def refresh_aliases(conn: sqlite3.Connection, *, now: str | None = None) -> int:
    """buyer_aliases as the buyers stage leaves it: the merges of every night (merge), the seed's
    re-pointed ids (SEED_REPOINTED), each followed to the live buyer it ends at.

    An alias whose old id is a buyer again, or whose chain ends at no buyer or
    loops, is dropped rather than sending a visitor to a missing page.
    Returns the aliases kept.
    """
    stamp = now or now_iso()
    live = {r[0] for r in conn.execute("SELECT id FROM buyers")}
    for old, new in SEED_REPOINTED.items():
        if old not in live:
            row = conn.execute("SELECT new_id FROM buyer_aliases WHERE old_id = ?", (old,)).fetchone()
            if row is None or row[0] != new:
                _alias(conn, old, new, "seed", stamp)
    step = {r[0]: r[1] for r in conn.execute("SELECT old_id, new_id FROM buyer_aliases")}
    for old, target in step.items():
        seen = {old}
        while target not in live and target in step and target not in seen:
            seen.add(target)
            target = step[target]
        if old in live or target not in live or target == old:
            conn.execute("DELETE FROM buyer_aliases WHERE old_id = ?", (old,))
        elif target != step[old]:
            conn.execute("UPDATE buyer_aliases SET new_id = ?, updated_at = ? WHERE old_id = ?", (target, stamp, old))
    conn.commit()
    return conn.execute("SELECT COUNT(*) FROM buyer_aliases").fetchone()[0]


def _replace_in_lobbying(conn: sqlite3.Connection, old: str, new: str | None) -> None:
    """Each lobbying report's buyer_ids with old replaced by new, or left out when new is None."""
    for comm, ids in conn.execute("SELECT comm_number, buyer_ids FROM lobbying_communications WHERE buyer_ids LIKE ?",
                                  (f'%"{old}"%',)).fetchall():
        try:
            items = json.loads(ids)
        except ValueError:
            continue
        if not isinstance(items, list):
            continue
        out = list(dict.fromkeys(new if i == old else i for i in items if i != old or new))
        conn.execute("UPDATE lobbying_communications SET buyer_ids = ? WHERE comm_number = ?",
                     (json.dumps(out, ensure_ascii=False) if out else None, comm))


def refresh_kinds(conn: sqlite3.Connection) -> int:
    """kind 'institution' for each buyer with no CKAN organization that only the lobbying registry names
    (every spelling it has is a lobbying one, apart from the seeds' names); kind cleared from one that a
    record source names since. Returns the institutions."""
    titles = _titles_in()
    only_lobbying = (
        "ckan_org IS NULL "
        "AND EXISTS (SELECT 1 FROM buyer_names n WHERE n.buyer_id = buyers.id AND n.source = 'lobbying') "
        f"AND NOT EXISTS (SELECT 1 FROM buyer_names n WHERE n.buyer_id = buyers.id AND n.source NOT IN ('lobbying', {titles}))"
    )
    conn.execute(f"UPDATE buyers SET kind = '{INSTITUTION}' WHERE kind IS NOT '{INSTITUTION}' AND {only_lobbying}")
    conn.execute(f"UPDATE buyers SET kind = NULL WHERE kind = '{INSTITUTION}' AND NOT ({only_lobbying})")
    conn.commit()
    return conn.execute(f"SELECT COUNT(*) FROM buyers WHERE kind = '{INSTITUTION}'").fetchone()[0]


def write_review(conn: sqlite3.Connection, outcome: MergeOutcome, path: Path, *, stamp: str) -> str | None:
    """Write (or, with nothing to list, remove) the operator's list of buyer merges; returns its path as shown.

    Every retired id in buyer_aliases (the merges of every night, with their
    reason), tonight's buyers retired with no buyer, the made buyers left as
    they are, and the alias rows not applied. No step publishes it.
    """
    aliases = conn.execute(
        "SELECT a.old_id, a.new_id, a.reason, a.name_en, a.updated_at, b.name_en AS to_name FROM buyer_aliases a "
        "LEFT JOIN buyers b ON b.id = a.new_id ORDER BY a.new_id, a.old_id").fetchall()
    retired = [m for m in outcome.merges if m.new is None]
    if not aliases and not retired and not outcome.review and not outcome.unapplied:
        path.unlink(missing_ok=True)
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Buyer merges, run of {stamp}: {len(aliases)} retired buyer ids, each sent on to the buyer that holds "
        f"its records; {len(outcome.merges)} merged tonight. For the operator: no step publishes this file.",
        "# Reasons: alias (buyer_aliases.csv names it), ckan_twin (CKAN lists one institution twice), name (a made "
        "buyer's own name is another's), spellings (every spelling is another's), seed (an id buyers.csv used to give).",
        "# A wrong merge is undone by fixing the row of awardwatch_pipeline/data/buyer_aliases.csv or buyers.csv that "
        "caused it; a made buyer is placed by adding one.",
        "# reason\told_id\told_name\tnew_id\tnew_name\tsince",
    ]
    lines += ["\t".join((r["reason"] or "", r["old_id"], r["name_en"] or "", r["new_id"], r["to_name"] or "",
                         (r["updated_at"] or "")[:10])) for r in aliases]
    if retired:
        lines += [f"# Retired tonight with no buyer: {len(retired)} (every spelling names no institution; the records "
                  "keep their spellings)", "# old_id\told_name\twhy"]
        lines += [f"{m.old}\t{m.name_en or ''}\t{m.evidence}" for m in retired]
    if outcome.review:
        lines += [f"# Not merged, for review: {len(outcome.review)} buyers", "# id\tname\trecords\twhy"]
        lines += sorted(outcome.review)
    if outcome.unapplied:
        lines += [f"# Alias rows not applied tonight: {len(outcome.unapplied)}", "# alias\tbuyer_id\twhy"]
        lines += outcome.unapplied
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        return path.relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def _seed_review(conn: sqlite3.Connection, seed_ids: set[str], ckan_ids: set[str]) -> list[str]:
    """Seed buyers outside CKAN whose acronym or name a CKAN organization also has: worth a look."""
    lines = []
    for bid in sorted(seed_ids - ckan_ids):
        row = conn.execute("SELECT name_en, acronym_en FROM buyers WHERE id = ?", (bid,)).fetchone()
        if row is None:
            continue
        twin = _by_acronym(conn, row["acronym_en"], None, {bid} | (seed_ids - ckan_ids)) \
            or _by_title(conn, [row["name_en"]], {bid} | (seed_ids - ckan_ids))
        if twin:
            lines.append(f"seed buyer {bid} may be the CKAN organization {twin}")
    return lines


def run(conn: sqlite3.Connection, client: PoliteClient | None, *, now: str | None = None,
        offline: bool = False, review_dir: Path | None = None) -> dict[str, int]:
    """The buyers stage: CKAN organizations when due, then the seed and the aliases, then the night's merges."""
    stamp = now or now_iso()
    before = conn.execute("SELECT COUNT(*) FROM buyers").fetchone()[0]
    notices: list[str] = []
    loaded: list[str] = []
    if offline or client is None:
        notices.append("open.canada.ca organizations not loaded (samples run)")
    else:
        age = hours_since(conn, META_LOADED, now=stamp)
        if age is None or age >= REFRESH_DAYS * 24:
            loaded, failed = load_ckan(conn, client, now=stamp)
            set_meta(conn, META_READ, stamp)
            conn.commit()
            if failed:
                notices.append(f"organization_show failed for {len(failed)}: {', '.join(failed[:10])}")
            else:
                set_meta(conn, META_LOADED, stamp)
                conn.commit()
    seed = read_seed()
    seed_ids = {row["buyer_id"] for row in seed}
    load_seed(conn, seed, now=stamp)
    alias_rows = read_aliases()
    unapplied = load_aliases(conn, alias_rows)
    previous = dict(conn.execute("SELECT old_id, new_id FROM buyer_aliases").fetchall())
    outcome = merge(conn, seed_ids, now=stamp, aliases=alias_rows)
    outcome.unapplied = unapplied
    aliases = refresh_aliases(conn, now=stamp)
    institutions = refresh_kinds(conn)
    shown = write_review(conn, outcome, (review_dir or config.OUT_DIR / "review") / REVIEW_FILE, stamp=stamp)
    new = outcome.new_since(previous)
    if new:
        listed = ", ".join(f"{m.old} -> {m.new or 'no buyer'} ({m.reason})" for m in new)
        notices.append(f"buyers merged: {listed}" + (f"; every merge is listed in {shown}" if shown else ""))
    if loaded:
        notices += _seed_review(conn, seed_ids, set(loaded))
    total = conn.execute("SELECT COUNT(*) FROM buyers").fetchone()[0]
    last = get_meta(conn, META_LOADED) or "never"
    log_run(conn, "buyers",
            detail=f"buyers={total} ckan_loaded={len(loaded)} seed_rows={len(seed)} alias_rows={len(alias_rows)} "
                   f"merged={len(outcome.merges)} merged_new={len(new)} review={len(outcome.review)} "
                   f"aliases={aliases} institutions={institutions} ckan_last_loaded={last}",
            rows_in=total, rows_new=max(total - before, 0), notice=" | ".join(notices) or None)
    return {"buyers": total, "ckan": len(loaded), "seed": len(seed), "merged": len(outcome.merges),
            "merged_new": len(new), "review": len(outcome.review), "institutions": institutions}
