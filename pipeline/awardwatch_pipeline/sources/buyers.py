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
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import sqlite3
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
REFRESH_DAYS = 30
# Shorter than the refresh, so a refresh revalidates every cached answer while
# a run retried the same day reads them from the cache.
CACHE_S = 25 * 86400
META_LOADED = "buyers_loaded_at"
# When the CKAN organization list was last read, whether or not every
# organization_show answered (the Data page shows it).
META_READ = "buyers:read_at"
# Spellings matched against titles and acronyms, never resolved by them.
TITLE_SOURCES = ("ckan", "seed")

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

# Every column that points at a buyer, for moving records when a buyer made
# by rule 4 turns out to be another.
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


# ---------------------------------------------------------------------------
# The key index: every CKAN title and seed name by its key (tier "known"), and
# every buyer rule 6 made by its names' keys (tier "made"). A temporary table,
# so it lives with the connection; built again when the buyers or their names
# change.
# ---------------------------------------------------------------------------

def _index_stamp(conn: sqlite3.Connection) -> str:
    known = conn.execute("SELECT COUNT(*), COALESCE(SUM(length(raw_name) + length(buyer_id)), 0) FROM buyer_names "
                         "WHERE source IN ('ckan', 'seed')").fetchone()
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
        "SELECT raw_name, buyer_id FROM buyer_names WHERE source IN ('ckan', 'seed')")}
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
    en, fr = ("" if matching.is_placeholder(en) else en), ("" if matching.is_placeholder(fr) else fr)
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
        conn.execute(
            "INSERT INTO buyers (id, name_en, name_fr, acronym_en, acronym_fr, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO NOTHING",
            (bid, name_en, name_fr, acronym_en, acronym_fr, now or now_iso()),
        )
        _note(conn, f"buyer {bid} made for '{en or fr}'")
    _record(conn, bid, source, en, fr)
    return bid


def for_owner_org(conn: sqlite3.Connection, owner_org: str, title: str | None, *, now: str | None = None) -> str:
    """The buyer of a proactive-publication row: its owner_org is the open.canada.ca organization name.

    Created from the "English | French" title when CKAN did not list it (a
    run without CKAN, or an organization created since the last load).
    """
    bid = squash(owner_org)
    if conn.execute("SELECT 1 FROM buyers WHERE id = ?", (bid,)).fetchone():
        return bid
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
    seed) is noted, so reresolve moves that buyer's records with it. Each
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


def reresolve(conn: sqlite3.Connection, seed_ids: set[str], *, now: str | None = None) -> list[str]:
    """Resolve again the spellings that went to a buyer made by rule 6, and move its records when it is now another.

    A made buyer is one with no CKAN organization that the seed does not
    name. When every spelling of it now resolves to one other buyer, its
    records move there and it is deleted. When every spelling of it now reads
    as no institution (non_institution), its records keep their raw spellings
    and point at no buyer, and it is deleted. When they split, the records
    stay and are resolved again as their files are read again. Each buyer
    deleted for another goes into buyer_aliases.
    """
    made = {r[0] for r in conn.execute("SELECT id FROM buyers WHERE ckan_org IS NULL")} - seed_ids
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS buyer_seed_moves (old TEXT NOT NULL, new TEXT NOT NULL)")
    moves = conn.execute("SELECT old, new FROM buyer_seed_moves ORDER BY rowid").fetchall()
    conn.execute("DELETE FROM buyer_seed_moves")
    if not made:
        return []
    forget_keys(conn)
    targets: dict[str, set[str]] = {}
    for old, new in moves:
        if old in made and new != old:
            targets.setdefault(old, set()).add(new)
    dropped: set[str] = set()
    for raw, source, old in conn.execute(
        "SELECT raw_name, source, buyer_id FROM buyer_names WHERE source NOT IN ('ckan', 'seed')"
    ).fetchall():
        if old not in made:
            continue
        new = _match(conn, raw, "", made)
        if new and new != old:
            conn.execute("UPDATE buyer_names SET buyer_id = ? WHERE raw_name = ? AND source = ?", (new, raw, source))
            targets.setdefault(old, set()).add(new)
        elif new is None and non_institution(raw):
            conn.execute("DELETE FROM buyer_names WHERE raw_name = ? AND source = ?", (raw, source))
            dropped.add(old)
    merged = []
    for old in sorted(set(targets) | dropped):
        left = conn.execute("SELECT COUNT(*) FROM buyer_names WHERE buyer_id = ?", (old,)).fetchone()[0]
        news = targets.get(old, set())
        if left or len(news) > 1 or (news and old in dropped):
            continue
        new = next(iter(news)) if news else None
        for table, column in BUYER_COLUMNS:
            conn.execute(f"UPDATE {table} SET {column} = ? WHERE {column} = ?", (new, old))
        _replace_in_lobbying(conn, old, new)
        for table, column in DERIVED_BUYER_COLUMNS:
            conn.execute(f"DELETE FROM {table} WHERE {column} = ?", (old,))
        conn.execute("DELETE FROM buyers WHERE id = ?", (old,))
        if new:
            _alias(conn, old, new, "merged", now)
        merged.append(f"{old} -> {new or 'no buyer'}")
    forget_keys(conn)
    conn.commit()
    return merged


def _alias(conn: sqlite3.Connection, old: str, new: str, reason: str, now: str | None) -> None:
    conn.execute(
        "INSERT INTO buyer_aliases (old_id, new_id, reason, updated_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(old_id) DO UPDATE SET new_id = excluded.new_id, reason = excluded.reason, "
        "updated_at = excluded.updated_at",
        (old, new, reason, now or now_iso()),
    )


def refresh_aliases(conn: sqlite3.Connection, *, now: str | None = None) -> int:
    """buyer_aliases as the buyers stage leaves it: the moves of every night (reresolve), the seed's
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
        offline: bool = False) -> dict[str, int]:
    """The buyers stage: CKAN organizations when due, then the seed, then the spellings made before either."""
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
    merged = reresolve(conn, seed_ids, now=stamp)
    if merged:
        notices.append("buyers merged: " + ", ".join(merged))
    aliases = refresh_aliases(conn, now=stamp)
    if loaded:
        notices += _seed_review(conn, seed_ids, set(loaded))
    total = conn.execute("SELECT COUNT(*) FROM buyers").fetchone()[0]
    last = get_meta(conn, META_LOADED) or "never"
    log_run(conn, "buyers",
            detail=f"buyers={total} ckan_loaded={len(loaded)} seed_rows={len(seed)} merged={len(merged)} "
                   f"aliases={aliases} ckan_last_loaded={last}",
            rows_in=total, rows_new=max(total - before, 0), notice=" | ".join(notices) or None)
    return {"buyers": total, "ckan": len(loaded), "seed": len(seed), "merged": len(merged)}
