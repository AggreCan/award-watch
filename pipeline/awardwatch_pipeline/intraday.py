"""The same-day tender notices: the intraday refresh between two nightly runs.

CanadaBuys regenerates newTenderNotice-nouvelAvisAppelOffres.csv, the day's
new notices so far, every two hours from 06:15 to 22:15 Ottawa time; the
nightly reads it once, at 12:30 UTC. .github/workflows/intraday.yml reads it
again after each cut and writes what it holds to the hosted search database
(D1 awardwatch-search, binding SEARCH), table intraday_tenders (schema
pipeline/intraday_schema.sql), where the site's paid view reads it
(site/src/intraday.ts). docs/intraday.md is the operator's account.

The job runs without the SQLite database: no restore, a minute of runner
time. What it needs of the database the nightly leaves in R2 as one small
file, intraday/lookup.json.gz. The commands:

  lookup   (the nightly, with the database) write that file: every spelling
           the buyers stage has resolved, the titles, acronyms and keys its
           rules match against, the listed buyers' names, and the data date.
  fetch    (the intraday job) the new notices file, with a conditional
           request carrying the validators of the last run that went through
           (read from intraday_runs by STATE_SQL). A 304 ends the run: the
           record command writes a run row of zero rows.
  refresh  (the intraday job) parse the file with the nightly loader's own
           column map and normalizers (sources/canadabuys_rows.py), resolve
           each contracting entity through the lookup (BuyerLookup), and
           write the SQL batch: one upsert per version keyed (reference,
           amendment), so a batch applied twice leaves the same rows, and a
           delete for a notice whose newest version in the file is no longer
           open (cancelled, awarded, expired). A column added to the table
           after the operator first applied the schema (ADDED) is written
           only once the live table has it, read just before with
           COLUMNS_SQL.
  record   (the intraday job, last) the run row in intraday_runs: when, the
           file's validators, the rows read, new and read again, ok, and a
           detail line saying what happened or which step failed.
  prune    (the nightly) delete the rows first read more than KEEP_DAYS ago
           and the run rows older than RUNS_KEPT_DAYS.

Buyers. BuyerLookup resolves a spelling by the rules and the normalization of
buyers.resolve (rule 1, a spelling already resolved; rules 2 to 4, titles,
acronyms and keys; rule 5, a spelling that names no institution; rule 6, a
buyer already made for the same key) and never makes a buyer. A spelling that
resolves to a buyer the export lists gets its id and names; any other keeps
its own spelling with no id, unless it names or locates a person
(buyers.public_spelling), and the nightly reconciles it the next morning.
Without a lookup (none in R2 yet, or one that cannot be read) every buyer
stays as published; the next changed cut writes every row of the day again,
so a lookup that arrives later reaches them.

seen_at is when the job first read a version and never changes after: the
file is cumulative over the day, so each changed cut lists the day's earlier
notices again, and their fields are refreshed while seen_at stays.

Nothing here names a contact: the file's contact columns are read by the
shared parser and dropped, and titles and excerpts pass through the export's
contact scrub (export.scrub), as every exported free-text field does.
"""

from __future__ import annotations

import argparse
import gzip
import json
import logging
import os
import string
import sys
from collections import defaultdict
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from . import config
from .export import scrub
from .export_static import BUYER_ID_RE, excerpt, full_codes, read_segments, url_reference
from .normalize import squash, to_int
from .search_db import sql_literal
from .sources import buyers, canadabuys_rows

log = logging.getLogger(__name__)

NEW_FILE = config.TENDERS_NEW_FILE
NEW_URL = config.CANADABUYS_BASE + NEW_FILE
# The file is 5 KB to 170 KB; a minute covers a slow host.
TIMEOUT_S = 60
# Where the downloaded file goes under the job's folder.
CSV_NAME = "new.csv"
# The lookup's key in the R2 bucket (the nightly puts it, the intraday job gets it).
LOOKUP_KEY = "intraday/lookup.json.gz"
LOOKUP_VERSION = 1
KEEP_DAYS = 2
RUNS_KEPT_DAYS = 30

TABLE = "intraday_tenders"
RUNS = "intraday_runs"
TABLES = (TABLE, RUNS)
# Every column the refresh writes, in pipeline/intraday_schema.sql's order.
COLUMNS = (
    "reference", "reference_published", "amendment", "seen_at", "published", "closing", "title_en", "title_fr",
    "buyer_id", "buyer_name", "buyer_name_fr", "category", "notice_type_en", "notice_type_fr", "method_en",
    "method_fr", "segments", "provinces", "codes", "excerpt_en", "excerpt_fr", "provinces_derived",
)
# The columns added to intraday_tenders after the operator first applied the
# schema; each reaches the live table only through the statement the schema
# file's comment names, run by hand. Until then the refresh leaves it out of
# its upserts (written_columns), so a cut is never refused for a column the
# table does not have yet.
ADDED = ("provinces_derived",)
# The table's columns as D1 holds them, read before the parse (the workflow
# runs exactly this text; pipeline/tests/test_intraday.py holds the two equal).
COLUMNS_SQL = f"PRAGMA table_info({TABLE})"
# Kept as first written when a version is read again: its key, and when it was first read.
KEPT = ("reference", "amendment", "seen_at")
RUN_COLUMNS = ("id", "at", "file_last_modified", "file_etag", "rows_read", "rows_new", "rows_updated", "ok", "detail")
# A notice whose newest version in the file has another status is no longer open: its rows go.
OPEN_STATUSES = frozenset({"open", "unknown"})
# D1 refuses a statement over 100 KB; the search sync's statements stay under the same cap.
MAX_ROWS_PER_UPSERT = 50
MAX_STATEMENT_BYTES = 64 * 1024
MAX_KEYS_PER_DELETE = 200

# What the job reads from D1 before it fetches: the validators of the newest
# run that went through, and every version the table holds (to count the
# new ones). One statement, so one Wrangler call; the workflow runs exactly
# this text (pipeline/tests/test_intraday.py holds the two equal).
STATE_SQL = (
    "SELECT 'run' AS kind, file_last_modified AS a, file_etag AS b FROM (SELECT file_last_modified, file_etag "
    "FROM intraday_runs WHERE ok = 1 AND (file_last_modified IS NOT NULL OR file_etag IS NOT NULL) "
    "ORDER BY at DESC LIMIT 1) UNION ALL SELECT 'row' AS kind, reference AS a, amendment AS b FROM intraday_tenders"
)

STAMP = "%Y-%m-%dT%H:%M:%SZ"


def stamp(when: datetime) -> str:
    return when.astimezone(timezone.utc).strftime(STAMP)


# -- the buyer lookup ----------------------------------------------------------------

# SQLite's NOCASE, which rule 2 compares titles with, folds A to Z and nothing else.
_ASCII_LOWER = str.maketrans(string.ascii_uppercase, string.ascii_lowercase)


def nocase(text: str) -> str:
    return text.translate(_ASCII_LOWER)


def _sets_to_lists(groups: dict[str, set[str]]) -> dict[str, list[str]]:
    return {k: sorted(v) for k, v in sorted(groups.items()) if k}


def read_listed(static_dir: Path) -> tuple[dict[str, tuple[str | None, str | None]], str | None]:
    """The listed buyers' names by id (buyers/index.json, the buyers with a page) and the data date
    (stats.json), from the export the night just deployed."""
    from .search_db import read_buyer_index

    listed: dict[str, tuple[str | None, str | None]] = {}
    for b in read_buyer_index(static_dir):
        bid = b.get("id")
        if isinstance(bid, str) and BUYER_ID_RE.match(bid) and len(bid) <= 80:
            en, fr = b.get("name_en"), b.get("name_fr")
            listed[bid] = (en if isinstance(en, str) else None, fr if isinstance(fr, str) else None)
    as_of = None
    stats = static_dir / "stats.json"
    if stats.exists():
        value = json.loads(stats.read_text(encoding="utf-8")).get("data_as_of")
        as_of = value if isinstance(value, str) else None
    return listed, as_of


def build_lookup(conn: Any, listed: dict[str, tuple[str | None, str | None]], as_of: str | None) -> dict:
    """What BuyerLookup needs to resolve a spelling as buyers.resolve would, read from the database.

    spellings: every CanadaBuys spelling in buyer_names and its buyer (rule 1);
    titles: the CKAN and seed spellings, folded as SQLite's NOCASE folds them,
    with their buyers (rule 2); acronyms_en and acronyms_fr: each acronym key
    and the buyers carrying it (rule 3); keys and made: the key index's two
    tiers (rules 4 and 6); buyers: the listed buyers' English and French
    names, the only ids the site links. Every map keeps all the buyers a key
    names, because a rule matches only when there is exactly one.
    """
    spellings = {raw: bid for raw, bid in conn.execute(
        "SELECT raw_name, buyer_id FROM buyer_names WHERE source = 'canadabuys' ORDER BY raw_name")}
    marks = ",".join("?" * len(buyers.TITLE_SOURCES))
    titles: dict[str, set[str]] = defaultdict(set)
    for raw, bid in conn.execute(f"SELECT raw_name, buyer_id FROM buyer_names WHERE source IN ({marks})",
                                 buyers.TITLE_SOURCES):
        titles[nocase(raw)].add(bid)
    acronyms_en: dict[str, set[str]] = defaultdict(set)
    acronyms_fr: dict[str, set[str]] = defaultdict(set)
    for bid, a_en, a_fr in conn.execute(
            "SELECT id, acronym_en, acronym_fr FROM buyers WHERE acronym_en IS NOT NULL OR acronym_fr IS NOT NULL"):
        acronyms_en[buyers._acronym_key(a_en)].add(bid)
        acronyms_fr[buyers._acronym_key(a_fr)].add(bid)
    keys: dict[str, set[str]] = defaultdict(set)
    made: dict[str, set[str]] = defaultdict(set)
    for key, bid, tier in buyers.key_index(conn):
        (keys if tier == "known" else made)[key].add(bid)
    return {
        "version": LOOKUP_VERSION,
        "as_of": as_of,
        "spellings": spellings,
        "titles": _sets_to_lists(titles),
        "acronyms_en": _sets_to_lists(acronyms_en),
        "acronyms_fr": _sets_to_lists(acronyms_fr),
        "keys": _sets_to_lists(keys),
        "made": _sets_to_lists(made),
        "buyers": {bid: [en, fr] for bid, (en, fr) in sorted(listed.items())},
    }


def write_lookup(lookup: dict, out: Path) -> int:
    """The lookup as gzipped JSON (sorted keys, no timestamp in the gzip header, so equal lookups are equal
    bytes); returns the size written."""
    data = json.dumps(lookup, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(gzip.compress(data, mtime=0))
    return out.stat().st_size


def _one(ids: Sequence[str] | None) -> str | None:
    return ids[0] if ids and len(ids) == 1 else None


def _text(value: object) -> str | None:
    return squash(value) or None


class BuyerLookup:
    """Resolves a contracting entity's spelling the way buyers.resolve does, from the lookup file alone.

    The rules run in buyers.resolve's order over the same normalization
    (name_key, spelling_forms, split_acronym, the acronym key, non_institution);
    where the database would make a buyer (rule 6, no buyer for the key yet)
    this resolves to none.
    """

    def __init__(self, data: dict | None = None) -> None:
        d = data if isinstance(data, dict) else {}

        def str_map(name: str) -> dict[str, str]:
            value = d.get(name)
            return {k: v for k, v in value.items() if isinstance(k, str) and isinstance(v, str)} \
                if isinstance(value, dict) else {}

        def list_map(name: str) -> dict[str, list[str]]:
            value = d.get(name)
            if not isinstance(value, dict):
                return {}
            return {k: [x for x in v if isinstance(x, str)] for k, v in value.items()
                    if isinstance(k, str) and isinstance(v, list)}

        as_of = d.get("as_of")
        self.as_of: str | None = as_of if isinstance(as_of, str) else None
        self.spellings = str_map("spellings")
        self.titles = list_map("titles")
        self.acronyms_en = list_map("acronyms_en")
        self.acronyms_fr = list_map("acronyms_fr")
        self.keys = list_map("keys")
        self.made = list_map("made")
        raw = d.get("buyers")
        self.labels: dict[str, tuple[str | None, str | None]] = {}
        if isinstance(raw, dict):
            for bid, names in raw.items():
                if isinstance(bid, str) and BUYER_ID_RE.match(bid) and isinstance(names, list) and len(names) == 2:
                    self.labels[bid] = tuple(n if isinstance(n, str) else None for n in names)  # type: ignore[assignment]

    @classmethod
    def read(cls, path: Path | None) -> tuple[BuyerLookup, str]:
        """The lookup in a file and how it went: "read", "missing" (no file) or "unreadable" (a file that is
        not this version's gzipped JSON). Either of the last two gives an empty lookup."""
        if path is None or not path.is_file():
            return cls(), "missing"
        try:
            data = json.loads(gzip.decompress(path.read_bytes()).decode("utf-8"))
        except (OSError, EOFError, UnicodeDecodeError, ValueError):
            return cls(), "unreadable"
        if not isinstance(data, dict) or data.get("version") != LOOKUP_VERSION:
            return cls(), "unreadable"
        return cls(data), "read"

    # -- buyers.resolve's rules, over the maps ---------------------------------------

    def resolve(self, raw_en: object, raw_fr: object = None) -> str | None:
        """The buyer id buyers.resolve gives the spelling, or None where it gives none or would make one."""
        en, fr = squash(raw_en), squash(raw_fr)
        en, fr = ("" if buyers.is_placeholder_name(en) else en), ("" if buyers.is_placeholder_name(fr) else fr)
        if not en and not fr:
            return None
        for name in (en, fr):
            if name and name in self.spellings:
                return self.spellings[name]
        hit = self._match(en, fr)
        if hit:
            return hit
        if buyers.non_institution(en or fr):
            return None
        key = buyers.name_key(buyers._PARENS_RE.sub(" ", en or fr))
        return _one(self.made.get(key)) if key else None

    def _match(self, en: str, fr: str) -> str | None:
        names = [n for n in (en, fr) if n]
        hit = self._by_title(names) or self._by_acronym(
            buyers.split_acronym(en)[1] if en else None, buyers.split_acronym(fr)[1] if fr else None)
        if hit:
            return hit
        bracketed = [m.group(0)[1:-1] for n in names if (m := buyers._PARENS_RE.search(n))]
        for name in [*names, *bracketed]:
            for form in buyers.spelling_forms(name):
                hit = self._by_key(form) or self._by_bare_acronym(form)
                if hit:
                    return hit
        return None

    def _by_title(self, names: list[str]) -> str | None:
        for name in names:
            for candidate in dict.fromkeys((name, buyers.split_acronym(name)[0])):
                hit = _one(self.titles.get(nocase(candidate)))
                if hit:
                    return hit
        return None

    def _by_acronym(self, acronym_en: str | None, acronym_fr: str | None) -> str | None:
        en, fr = buyers._acronym_key(acronym_en), buyers._acronym_key(acronym_fr)
        if not en and not fr:
            return None
        en_hits = set(self.acronyms_en.get(en, ())) if en else set()
        fr_hits = set(self.acronyms_fr.get(fr, ())) if fr else set()
        if len(en_hits) == 1:
            return en_hits.pop()
        if en_hits and fr_hits and len(en_hits & fr_hits) == 1:
            return (en_hits & fr_hits).pop()
        if not en_hits and len(fr_hits) == 1:
            return fr_hits.pop()
        return None

    def _by_key(self, form: str) -> str | None:
        for key in dict.fromkeys((buyers.name_key(buyers._PARENS_RE.sub(" ", form)), buyers.name_key(form))):
            hit = _one(self.keys.get(key)) if key else None
            if hit:
                return hit
        return None

    def _by_bare_acronym(self, form: str) -> str | None:
        if " " in form or not buyers._acronym_like(form.replace("-", "")):
            return None
        for part in [form, *form.split("-")]:
            if part and buyers._acronym_like(part):
                hit = self._by_acronym(part, None) or self._by_acronym(None, part)
                if hit:
                    return hit
        return None

    # -- what a row shows --------------------------------------------------------------

    def buyer(self, raw_en: object, raw_fr: object) -> tuple[str | None, str | None, str | None]:
        """(id, English name, French name) as a list row shows the contracting entity: a listed buyer's id
        and names, else no id and the spellings as published, a spelling that names or locates a person
        left out (buyers.public_spelling, as the export does)."""
        return self.label(self.resolve(raw_en, raw_fr), raw_en, raw_fr)

    def label(self, bid: str | None, raw_en: object, raw_fr: object) -> tuple[str | None, str | None, str | None]:
        """buyer() for a spelling already resolved to bid."""
        if bid is not None and bid in self.labels:
            en, fr = self.labels[bid]
            return bid, en, fr
        return None, buyers.public_spelling(_text(raw_en)), buyers.public_spelling(_text(raw_fr))


# -- what D1 holds before a run -----------------------------------------------------------


@dataclass
class State:
    """The validators of the last run that went through, and the versions intraday_tenders holds."""

    etag: str | None = None
    last_modified: str | None = None
    keys: set[tuple[str, int]] = field(default_factory=set)


def parse_wrangler_json(text: str) -> list[dict]:
    """The rows of the first result in Wrangler's answer to `d1 execute --json --command` (a list with one
    result per statement, its rows under "results"); text before the list (a notice Wrangler printed
    first, which may hold a bracket of its own) is skipped. Anything else raises ValueError."""
    data: Any = None
    start = text.find("[")
    while start >= 0 and not isinstance(data, list):
        try:
            data, _ = json.JSONDecoder().raw_decode(text, start)
        except ValueError:
            data = None
        start = text.find("[", start + 1)
    if not isinstance(data, list) or not data or not isinstance(data[0], dict) or data[0].get("success") is False:
        raise ValueError("Wrangler's answer holds no result")
    rows = data[0].get("results")
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        raise ValueError("Wrangler's answer holds no rows")
    return rows


def read_state(text: str) -> State:
    """State from Wrangler's answer to STATE_SQL."""
    state = State()
    for row in parse_wrangler_json(text):
        if row.get("kind") == "run":
            a, b = row.get("a"), row.get("b")
            state.last_modified = a if isinstance(a, str) and a else None
            state.etag = b if isinstance(b, str) and b else None
        elif row.get("kind") == "row" and isinstance(row.get("a"), str) and isinstance(row.get("b"), int):
            state.keys.add((row["a"], row["b"]))
    return state


# -- fetch ------------------------------------------------------------------------------------


def fetch(client: Any, state: State, out_dir: Path) -> dict:
    """Download the new notices file into out_dir when it changed since the last run that went through.

    Returns what the record command writes: changed, the HTTP status, the
    file's validators (on a 304, the ones sent, which still describe it) and
    the size. The client (http.PoliteClient: the named user agent, retries,
    one request a second) raises on a 404 or a host that keeps failing.
    """
    got = client.download_if_changed(NEW_URL, out_dir / CSV_NAME, etag=state.etag, last_modified=state.last_modified,
                                     timeout=TIMEOUT_S)
    if got is None:
        return {"changed": False, "status": 304, "etag": state.etag, "last_modified": state.last_modified, "size": 0}
    return {"changed": True, "status": 200, "etag": got.etag, "last_modified": got.last_modified, "size": got.size}


# -- refresh ----------------------------------------------------------------------------------


@dataclass
class Parsed:
    """One read of the file: the versions to write, the notices no longer open, and the counts."""

    rows: list[dict] = field(default_factory=list)
    closed: list[str] = field(default_factory=list)
    read: int = 0
    skipped: int = 0
    unresolved: int = 0
    missing: list[str] = field(default_factory=list)


def _list_text(value: object) -> str:
    """A JSON list column as the D1 table stores it: compact JSON text, "[]" when empty."""
    items: list[str] = []
    if isinstance(value, str) and value:
        loaded = json.loads(value)
        items = [str(x) for x in loaded if x is not None and str(x).strip()] if isinstance(loaded, list) else []
    elif isinstance(value, list):
        items = [str(x) for x in value]
    return json.dumps(items, ensure_ascii=False, separators=(",", ":"))


def notice_row(get: canadabuys_rows.Getter, lookup: BuyerLookup, seen_at: str,
               segments: Iterable[str]) -> tuple[dict, str] | None:
    """One version as an intraday_tenders row, with its status; None for a row without a usable reference.

    The fields are the export's list fields (export_static.tender_row with
    words): the URL form of the reference and the published one beside it
    when they differ, titles and excerpts scrubbed of contacts, the segments
    and the full codes from the trimmed UNSPSC codes, the provinces the
    regions of delivery state, and beside them the provinces derived as the
    nightly loader derives them (canadabuys_rows.tender_fields, places.py:
    a city of delivery, the regions of opportunity, a Defence Construction
    Canada regional office), never one of the stated ones.
    """
    published_ref = squash(get("reference"))
    ref = url_reference(published_ref)
    if not ref:
        return None
    rec, codes, _ = canadabuys_rows.common_fields(get)
    # The buyer first: the regional office is read only for the buyer the nightly resolves the spelling to.
    resolved = lookup.resolve(canadabuys_rows.text(get("buyer_en")), canadabuys_rows.text(get("buyer_fr")))
    tender = canadabuys_rows.tender_fields(get, resolved)
    buyer_id, buyer_en, buyer_fr = lookup.label(resolved, tender["buyer_raw_en"], tender["buyer_raw_fr"])
    trimmed = [c for c, _, _ in codes]
    known = set(segments)
    row = {
        "reference": ref,
        "reference_published": published_ref if published_ref != ref else None,
        "amendment": to_int(get("amendment")) or 0,
        "seen_at": seen_at,
        "published": rec["published"],
        "closing": tender["closing"],
        "title_en": scrub(rec["title_en"], "en"),
        "title_fr": scrub(rec["title_fr"], "fr"),
        "buyer_id": buyer_id,
        "buyer_name": buyer_en,
        "buyer_name_fr": buyer_fr,
        "category": _list_text(rec["category"]),
        "notice_type_en": rec["notice_type_en"],
        "notice_type_fr": rec["notice_type_fr"],
        "method_en": rec["method_en"],
        "method_fr": rec["method_fr"],
        "segments": _list_text(sorted({c[:2] for c in trimmed if c[:2] in known})),
        "provinces": _list_text(tender["provinces"]),
        "codes": _list_text(full_codes(" ".join(trimmed))),
        "excerpt_en": excerpt(rec["description_en"], "en"),
        "excerpt_fr": excerpt(rec["description_fr"], "fr"),
        "provinces_derived": _list_text(tender["provinces_derived"]),
    }
    return row, str(tender["status"])


def read_notices(path: Path, lookup: BuyerLookup, seen_at: str, *,
                 segments: Iterable[str] | None = None) -> Parsed:
    """The file's versions as rows. A version listed twice is kept once (the first). A notice whose newest
    version is no longer open is written as a delete instead of its rows."""
    seg = set(segments if segments is not None else read_segments())
    out = Parsed()
    versions: dict[tuple[str, int], tuple[dict, str]] = {}
    with canadabuys_rows.open_csv(path) as fh:
        out.missing, getters = canadabuys_rows.rows(fh, "tenders", NEW_FILE)
        for get in getters:
            out.read += 1
            got = notice_row(get, lookup, seen_at, seg)
            if got is None:
                out.skipped += 1
                continue
            row, status = got
            key = (row["reference"], row["amendment"])
            if key in versions:
                continue
            versions[key] = (row, status)
            if row["buyer_id"] is None and (row["buyer_name"] or row["buyer_name_fr"]):
                out.unresolved += 1
    newest: dict[str, tuple[int, str]] = {}
    for (ref, amendment), (_, status) in versions.items():
        if ref not in newest or amendment > newest[ref][0]:
            newest[ref] = (amendment, status)
    out.closed = sorted(ref for ref, (_, status) in newest.items() if status not in OPEN_STATUSES)
    gone = set(out.closed)
    out.rows = [row for (ref, _), (row, _) in versions.items() if ref not in gone]
    return out


def _chunks(items: Sequence[str], head: str, tail: str, max_items: int, max_bytes: int) -> Iterator[str]:
    """head + items joined by ", " + tail, in as few statements as the caps allow."""
    fixed = len(head.encode("utf-8")) + len(tail.encode("utf-8"))
    chunk: list[str] = []
    size = fixed
    for item in items:
        n = len(item.encode("utf-8"))
        if fixed + n > max_bytes:
            raise ValueError(f"one row of {fixed + n} bytes is over the {max_bytes}-byte statement limit")
        if chunk and (len(chunk) >= max_items or size + 2 + n > max_bytes):
            yield head + ", ".join(chunk) + tail
            chunk, size = [], fixed
        size += (2 if chunk else 0) + n
        chunk.append(item)
    if chunk:
        yield head + ", ".join(chunk) + tail


def upsert_statements(rows: Sequence[dict], *, max_rows: int = MAX_ROWS_PER_UPSERT,
                      max_bytes: int = MAX_STATEMENT_BYTES, columns: Sequence[str] = COLUMNS) -> list[str]:
    """The rows as multi-row upserts of the given columns (written_columns). A version already there keeps its
    key and seen_at and takes every other field from the file, so applying the same statements twice leaves the
    same rows."""
    head = f"INSERT INTO {TABLE} ({', '.join(columns)}) VALUES "
    sets = ", ".join(f"{c} = excluded.{c}" for c in columns if c not in KEPT)
    tail = f" ON CONFLICT (reference, amendment) DO UPDATE SET {sets};"
    tuples = ["(" + ", ".join(sql_literal(row[c]) for c in columns) + ")" for row in rows]
    return list(_chunks(tuples, head, tail, max_rows, max_bytes))


def read_columns(text: str) -> set[str] | None:
    """The column names in Wrangler's answer to COLUMNS_SQL; None for an answer that holds none."""
    try:
        rows = parse_wrangler_json(text)
    except ValueError:
        return None
    return {r["name"] for r in rows if isinstance(r.get("name"), str)} or None


def written_columns(have: set[str] | None) -> tuple[str, ...]:
    """The columns a batch writes: every one of COLUMNS the live table has. An ADDED column the table lacks, or
    every ADDED column when its columns could not be read (have None), is left out; the other columns are the
    ones the operator applied first, which every live table has."""
    return tuple(c for c in COLUMNS if c not in ADDED or (have is not None and c in have))


def delete_statements(references: Sequence[str], *, max_keys: int = MAX_KEYS_PER_DELETE,
                      max_bytes: int = MAX_STATEMENT_BYTES) -> list[str]:
    return list(_chunks([sql_literal(r) for r in references], f"DELETE FROM {TABLE} WHERE reference IN (", ");",
                        max_keys, max_bytes))


def batch_sql(parsed: Parsed, columns: Sequence[str] = COLUMNS) -> list[str]:
    """The statements of one run: the deletes, then the upserts."""
    return delete_statements(parsed.closed) + upsert_statements(parsed.rows, columns=columns)


def refresh(csv_path: Path, lookup_path: Path | None, state: State, out_dir: Path, *,
            now: datetime | None = None, columns: tuple[str, ...] = COLUMNS, columns_state: str = "current") -> dict:
    """Parse the file, write batch.sql (empty when there is nothing to write) and refresh.json; return the
    summary refresh.json holds. columns are the ones the batch writes (written_columns); columns_state says
    how they were found ("read" from D1, "unread", or "current": the schema file's, unasked)."""
    lookup, lookup_state = BuyerLookup.read(lookup_path)
    seen_at = stamp(now or datetime.now(timezone.utc))
    parsed = read_notices(csv_path, lookup, seen_at)
    statements = batch_sql(parsed, columns)
    out_dir.mkdir(parents=True, exist_ok=True)
    # Bytes, not text mode: Windows would write a newline inside a title as CRLF and change the value.
    (out_dir / "batch.sql").write_bytes("".join(s + "\n" for s in statements).encode("utf-8"))
    new = sum(1 for r in parsed.rows if (r["reference"], r["amendment"]) not in state.keys)
    summary = {
        "seen_at": seen_at,
        "rows_read": parsed.read,
        "rows_written": len(parsed.rows),
        "rows_new": new,
        "rows_updated": len(parsed.rows) - new,
        "closed": len(parsed.closed),
        "skipped": parsed.skipped,
        "unresolved": parsed.unresolved,
        "missing_columns": parsed.missing,
        "lookup": lookup_state,
        "lookup_as_of": lookup.as_of,
        "statements": len(statements),
        "derived": sum(1 for r in parsed.rows if r["provinces_derived"] != "[]"),
        "columns": columns_state,
        "left_out": [c for c in COLUMNS if c not in columns],
    }
    (out_dir / "refresh.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    return summary


# -- record ---------------------------------------------------------------------------------


def run_row(run_id: str, at: str, fetched: dict | None, refreshed: dict | None, steps: dict[str, str]) -> dict:
    """The run's row in intraday_runs.

    ok when the file was fetched and either had not changed or was parsed and
    applied (or held nothing to apply). Only an ok row's validators are sent
    with the next request, so a run that failed after its download is
    downloaded and applied again by the next one.
    """
    f = fetched if isinstance(fetched, dict) else {}
    r = refreshed if isinstance(refreshed, dict) else {}
    row: dict[str, Any] = {
        "id": run_id, "at": at,
        "file_last_modified": f.get("last_modified") if isinstance(f.get("last_modified"), str) else None,
        "file_etag": f.get("etag") if isinstance(f.get("etag"), str) else None,
        "rows_read": 0, "rows_new": 0, "rows_updated": 0, "ok": 0,
    }
    failed = [name for name in ("fetch", "lookup", "refresh", "apply") if steps.get(name) in ("failure", "cancelled")]
    if steps.get("fetch") != "success" or not f:
        row["detail"] = "the new notices file could not be fetched"
        return row
    if not f.get("changed"):
        row.update(ok=1, detail="unchanged since the last run (304)")
        return row
    for key in ("rows_read", "rows_new", "rows_updated"):
        value = r.get(key)
        row[key] = value if isinstance(value, int) and value >= 0 else 0
    applied = steps.get("apply") == "success" or (steps.get("apply") == "skipped" and r.get("statements") == 0)
    if not failed and steps.get("refresh") == "success" and applied and r:
        row["ok"] = 1
        lookup = r.get("lookup_as_of") if r.get("lookup") == "read" else f"{r.get('lookup')}, buyers as published"
        row["detail"] = (f"{row['rows_read']} rows read: {row['rows_new']} new, {row['rows_updated']} read again, "
                         f"{r.get('closed', 0)} no longer open, {r.get('skipped', 0)} without a reference; "
                         f"{r.get('unresolved', 0)} with a buyer as published (no listed buyer); lookup {lookup}")
        left = r.get("left_out")
        if isinstance(left, list) and left and all(isinstance(c, str) for c in left):
            why = "the table's columns could not be read" if r.get("columns") == "unread" else "not in the table yet"
            row["detail"] += f"; {', '.join(left)} not written ({why})"
    else:
        step = failed[0] if failed else ("refresh" if steps.get("refresh") != "success" else "apply")
        row["detail"] = f"failed at {step}; the next run fetches the file again"
    return row


def run_sql(row: dict) -> str:
    """The run row as an upsert on its id, so a record applied twice leaves one row."""
    sets = ", ".join(f"{c} = excluded.{c}" for c in RUN_COLUMNS if c != "id")
    values = ", ".join(sql_literal(row.get(c)) for c in RUN_COLUMNS)
    return f"INSERT INTO {RUNS} ({', '.join(RUN_COLUMNS)}) VALUES ({values}) ON CONFLICT (id) DO UPDATE SET {sets};\n"


# -- prune ----------------------------------------------------------------------------------


def prune_sql(now: datetime) -> str:
    """Delete the versions first read more than KEEP_DAYS ago (the site shows only those read since the
    nightly's data date) and the run rows older than RUNS_KEPT_DAYS."""
    rows_before = stamp(now - timedelta(days=KEEP_DAYS))
    runs_before = stamp(now - timedelta(days=RUNS_KEPT_DAYS))
    return (f"DELETE FROM {TABLE} WHERE seen_at < {sql_literal(rows_before)};\n"
            f"DELETE FROM {RUNS} WHERE at < {sql_literal(runs_before)};\n")


# -- command line --------------------------------------------------------------------------------


def _output(**pairs: str) -> None:
    """Step outputs for the workflow's conditions, when run inside one."""
    target = os.environ.get("GITHUB_OUTPUT")
    if not target:
        return
    with open(target, "a", encoding="utf-8") as fh:
        for name, value in pairs.items():
            fh.write(f"{name}={value}\n")


def _read_json(path: str | None) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8")) if path and Path(path).is_file() else None
    except (OSError, ValueError):
        return None


def _now(value: str | None) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    when = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return when if when.tzinfo else when.replace(tzinfo=timezone.utc)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="awardwatch_pipeline.intraday")
    sub = parser.add_subparsers(dest="command", required=True)
    lk = sub.add_parser("lookup", help="write the buyer lookup the intraday job resolves spellings with")
    lk.add_argument("--db", required=True)
    lk.add_argument("--static", required=True, help="the night's export, for buyers/index.json and stats.json")
    lk.add_argument("--out", required=True, help="the gzipped JSON to write")
    ft = sub.add_parser("fetch", help="download the new notices file when it changed since the last run")
    ft.add_argument("--state", required=True, help="Wrangler's --json answer to STATE_SQL")
    ft.add_argument("--out", required=True, help="the job's folder (new.csv and fetch.json)")
    rf = sub.add_parser("refresh", help="parse the file and write the SQL batch")
    rf.add_argument("--csv", required=True)
    rf.add_argument("--lookup", default=None, help="the lookup from R2; missing means buyers as published")
    rf.add_argument("--state", required=True, help="Wrangler's --json answer to STATE_SQL")
    rf.add_argument("--out", required=True, help="the job's folder (batch.sql and refresh.json)")
    rf.add_argument("--columns", default=None,
                    help="Wrangler's --json answer to COLUMNS_SQL; when given, a column added since (ADDED) is written "
                         "only if it lists it, and a missing or unreadable answer leaves the added columns out")
    rf.add_argument("--now", default=None, help="the run's time (ISO), for tests")
    rc = sub.add_parser("record", help="write the run's row in intraday_runs")
    rc.add_argument("--run-id", required=True)
    rc.add_argument("--fetch", default=None, help="fetch.json")
    rc.add_argument("--refresh", default=None, help="refresh.json")
    rc.add_argument("--step", action="append", default=[], help="name=outcome of a workflow step")
    rc.add_argument("--out", required=True, help="the SQL file to write")
    rc.add_argument("--now", default=None, help="the run's time (ISO), for tests")
    pr = sub.add_parser("prune", help="write the SQL that deletes rows older than two days")
    pr.add_argument("--out", required=True)
    pr.add_argument("--now", default=None, help="the time to count back from (ISO), for tests")
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args(argv)
    handlers = {"lookup": _lookup, "fetch": _fetch, "refresh": _refresh, "record": _record, "prune": _prune}
    return handlers[args.command](args)


def _lookup(args: argparse.Namespace) -> int:
    from .db import connect

    listed, as_of = read_listed(Path(args.static))
    conn = connect(args.db)
    try:
        lookup = build_lookup(conn, listed, as_of)
    finally:
        conn.close()
    size = write_lookup(lookup, Path(args.out))
    log.info("lookup: %d spellings, %d listed buyers, data date %s, %d bytes", len(lookup["spellings"]),
             len(lookup["buyers"]), as_of, size)
    return 0


def _fetch(args: argparse.Namespace) -> int:
    from .http import PoliteClient

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    state = read_state(Path(args.state).read_text(encoding="utf-8"))
    (out / CSV_NAME).unlink(missing_ok=True)
    result = fetch(PoliteClient(cache_dir=out / "cache"), state, out)
    (out / "fetch.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    _output(changed="true" if result["changed"] else "false")
    log.info("fetch: %s", f"changed, {result['size']} bytes" if result["changed"] else "unchanged (304)")
    return 0


def _refresh(args: argparse.Namespace) -> int:
    state = read_state(Path(args.state).read_text(encoding="utf-8"))
    columns, columns_state = COLUMNS, "current"
    if args.columns is not None:
        path = Path(args.columns)
        have = read_columns(path.read_text(encoding="utf-8")) if path.is_file() else None
        columns, columns_state = written_columns(have), "read" if have is not None else "unread"
    summary = refresh(Path(args.csv), Path(args.lookup) if args.lookup else None, state, Path(args.out),
                      now=_now(args.now), columns=columns, columns_state=columns_state)
    _output(statements=str(summary["statements"]))
    log.info("refresh: %s", json.dumps(summary))
    if summary["missing_columns"]:
        log.warning("refresh: the file lacks %s", ", ".join(summary["missing_columns"]))
    if summary["left_out"]:
        log.warning("refresh: %s not written (%s)", ", ".join(summary["left_out"]),
                    "the table's columns could not be read" if columns_state == "unread" else "not in the table yet")
    return 0


def _record(args: argparse.Namespace) -> int:
    steps = dict(item.split("=", 1) for item in args.step if "=" in item)
    row = run_row(args.run_id, stamp(_now(args.now)), _read_json(args.fetch), _read_json(args.refresh), steps)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(run_sql(row).encode("utf-8"))
    log.info("record: ok=%s %s", row["ok"], row["detail"])
    return 0


def _prune(args: argparse.Namespace) -> int:
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(prune_sql(_now(args.now)).encode("utf-8"))
    log.info("prune: rows first read before %s go", stamp(_now(args.now) - timedelta(days=KEEP_DAYS)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
