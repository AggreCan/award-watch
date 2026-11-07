"""Standing offers and supply arrangements: the sosa stage.

Source: PSPC's "Standing Offers and Supply Arrangements" open data, dataset
f5c8a5a0-354d-455a-99ab-8276aa38032e (config.SOSA_URL: about 4 MB on
2026-10-30), described by its data dictionary (config.SOSA_DICTIONARY_URL),
Open Government Licence - Canada. The file lists the instruments active on
the day it was published ("Active Standing Offers and Supply Arrangements"),
one row per supplier, instrument and delivery point. It keeps no history, so
the history is what sosa_instruments and sosa_holders keep of each week's
file.

Cadence. The file is published weekly. The stage asks every night with a
conditional request (contracts.refresh, the machinery of the contracts and
grants stages; no stand-in copy is named, so a refusal fails the stage) and
applies a file only when its date-file-published differs from the one last
applied, so most nights change nothing. Whatever the file did, the nightly
upkeep runs: the holders' organizations are resolved again, the instruments
whose expiry passed lose their holders, the notices are joined again, and the
call-ups are counted again from the published contracts.

Rules (pro-features section 5, docs/sosa.md):

* A holder row is one supplier on one instrument in one region, keyed by the
  agreement number, the normalized legal name and the delivery point code.
* A legal name that reads as a person (matching.is_person_name, the rule the
  award notices use) is withheld: no name is stored, the key carries a hash
  of the normalized name so the row is the same row next week, and the row
  is counted. An operating name is kept only beside a legal name that is.
* The organization is resolved, never created: the id organizations.upsert
  would give the name, sent on by organization_aliases when a merge retired
  it, and kept only when that organization exists. A holder whose name names
  no profile stays unlinked.
* Gained: a row whose first_seen is the file's publication date, after the
  first file loaded (the first load writes no gained events, or every
  organization would gain everything it holds at once). Lost: absent from
  LOST_AFTER_FILES files in a row (one file's absence is not a loss: a weekly
  extract can drop a row and restore it), or its instrument's expiry passed.
  A lost row is kept LOST_KEEP_DAYS days, marked, then deleted.
* A file whose holder rows fall by more than HOLD_FALL from the last file
  applied is held for review and nothing is marked lost; the operator
  releases it by writing its publication date to config.SOSA_RELEASE.
* A download or a parse that fails leaves every row as it was: last_seen does
  not move and a missing file is not an absence.

The events (kind 12 gained, 13 no longer held) go to sosa_events, one row per
organization, instrument and region; the records sync carries each one once
into rec_events as instrument_gained or instrument_lost
(records_db.derive_events), where the organization watches read them.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
from collections import Counter, defaultdict
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlsplit

from .. import config, organizations
from ..db import get_meta, log_run, now_iso, set_meta
from ..http import FetchError, PoliteClient
from ..normalize import NORMALIZE_VERSION, iso_date, norm_name, squash
from . import matching
from .contracts import LayoutError, LoadStats, WeeklyFile, csv_rows, refresh

log = logging.getLogger(__name__)

# Asked every night (20 hours, so a run that starts a little earlier than the
# night before still asks); applied only when the publication date moved.
CHECK_HOURS = 20
SPEC = WeeklyFile("sosa", config.SOSA_URL, "sosa.csv", "sosa-head.csv", check_every_days=CHECK_HOURS / 24)  # type: ignore[arg-type]

# The data dictionary's columns. The first set is what a holder row and its
# key need: a file without one is refused before anything is written.
REQUIRED = (
    "agreement-number", "agreement-type_en", "agreement-type_fr", "award-date", "expiry-date", "date-file-published",
    "delivery-point-code", "supplier-legal-name",
)
OPTIONAL = (
    "commodity", "commodity-description_en", "commodity-description_fr", "delivery-point_en", "delivery-point_fr",
    "end-user-entity_en", "end-user-entity_fr", "sosa-description_en", "sosa-description_fr",
    "supplier-operating-name", "supplier-standardized-name",
)

GAINED, LOST = 12, 13
LOST_AFTER_FILES = 2
LOST_KEEP_DAYS = 90
EVENT_KEEP_DAYS = 400
HOLD_FALL = 0.30
# A stem shorter than this (letters and digits) would join unrelated notices.
STEM_MIN = 6
CALLUP_YEARS = 10
TEXT_MAX = 600
# The holder key depends on the name rules and the person test: when either
# changes, the next file is applied quietly (no events) so a re-keyed row is
# not reported as one lost and one gained.
KEYS_VERSION = f"{NORMALIZE_VERSION}.{matching.person_test_stamp()}"

META_PUBLISHED = "sosa:published"        # the publication date of the file applied last
META_ROWS = "sosa:rows"                  # its holder rows, which the hold rule compares
META_FIRST = "sosa:first_load"           # the publication date of the first file applied
META_KEYS = "sosa:keys"                  # KEYS_VERSION when that file was applied
META_HELD = "sosa:held"                  # the publication date of a file held for review
META_FILE_ROWS = "sosa:file_rows"        # data rows in the file applied last
META_FILES = "sosa:files"                # how many publications have been applied

# The instrument types the dictionary names, by the words that tell them apart.
TYPE_CODES = (
    ("supply arrangement", "SA"), ("national master", "NMSO"), ("departmental individual", "DISO"),
    ("regional individual", "RISO"), ("regional master", "RMSO"),
)
# Delivery point codes beside the provinces and territories: foreign, national, national capital.
OTHER_REGIONS = ("FD", "NA", "NC")


# ---------------------------------------------------------------------------
# Small rules
# ---------------------------------------------------------------------------

def fold(number: object) -> str:
    """An agreement or standing offer number as two sources are compared: spaces dropped, case folded."""
    return re.sub(r"\s+", "", str(number or "")).casefold()


def stem(number: object) -> str | None:
    """The part of an agreement or solicitation number before its first "/", folded (EZ899-250380/001/ZM ->
    ez899-250380): what an RFSO's notices and the instruments it issued share. None when too short to join on."""
    text = fold(str(number or "").split("/", 1)[0])
    return text if len(re.sub(r"[^0-9a-z]", "", text)) >= STEM_MIN else None


def type_code(type_en: object) -> str:
    """SA, NMSO, DISO, RISO, RMSO, or OTHER for a type the dictionary does not name."""
    text = squash(type_en).casefold()
    for words, code in TYPE_CODES:
        if words in text:
            return code
    return "OTHER"


def region_code(raw: object) -> str:
    """'CA-BC' or 'bc' -> 'BC'; FD, NA and NC as given; '' when blank. Letters and digits only, at most 8."""
    text = re.sub(r"\s+", "", squash(raw)).upper()
    if text.startswith("CA-"):
        text = text[3:]
    return re.sub(r"[^A-Z0-9]", "", text)[:8]


def person_key(norm: str) -> str:
    """The key of a withheld holder: a hash of its normalized name, which identifies the row and holds no name."""
    return "person:" + hashlib.blake2b(norm.encode("utf-8"), digest_size=8, person=b"sosa-holder").hexdigest()


def fiscal_start(day: str, years: int) -> str:
    """The first day of the federal fiscal year years - 1 before the one day falls in (April 1)."""
    d = date.fromisoformat(day[:10])
    fy = d.year if d.month >= 4 else d.year - 1
    return f"{fy - (years - 1)}-04-01"


def _text(value: object, limit: int = TEXT_MAX) -> str | None:
    return squash(value)[:limit].rstrip() or None


class Resolver:
    """The organization a holder's legal name names, never a new one (module docstring)."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        from ..export_static import resolve_aliases  # the export imports this module's readers
        self.live = {r[0] for r in conn.execute("SELECT id FROM organizations")}
        self.aliases = resolve_aliases(conn)

    def __call__(self, raw: str | None) -> str | None:
        from ..migrate import new_id
        oid, text = new_id(raw)
        if oid is None or text is None or organizations.is_not_organization(norm_name(text)):
            return None
        if oid in self.live:
            return oid
        return self.aliases.get(oid)


# ---------------------------------------------------------------------------
# Reading the file
# ---------------------------------------------------------------------------

@dataclass
class Instrument:
    agreement: str
    type_en: str | None
    type_fr: str | None
    description_en: str | None
    description_fr: str | None
    commodity: str | None
    commodity_en: str | None
    commodity_fr: str | None
    end_user_en: str | None
    end_user_fr: str | None
    start: str | None
    expiry: str | None


@dataclass
class Holding:
    agreement: str
    norm: str
    region: str
    raw: str | None
    operating: str | None
    standardized: str | None
    region_en: str | None
    region_fr: str | None
    withheld: bool


@dataclass
class Parsed:
    published: str | None = None
    instruments: dict[str, Instrument] = field(default_factory=dict)
    holdings: dict[tuple[str, str, str], Holding] = field(default_factory=dict)


@dataclass
class LoadResult:
    state: str = ""                  # applied | applied quietly | same publication | held
    published: str | None = None
    rows: int = 0                    # data rows read
    holders: int = 0                 # holder rows (keys) in the file
    instruments: int = 0
    withheld: int = 0                # holder rows withheld as persons
    skipped: int = 0                 # rows without an agreement number or a name, or cut short
    gained: int = 0
    lost: int = 0
    previous_rows: int = 0
    missing: list[str] = field(default_factory=list)

    @property
    def held(self) -> bool:
        return self.state == "held"


def read_file(path: Path, drops: matching.PersonDrops, result: LoadResult, *, partial_tail: bool = False) -> Parsed:
    """Every row of the file, grouped into instruments and holder rows. Raises LayoutError before reading a row
    when a required column is missing."""
    stats = LoadStats()
    parsed = Parsed()
    published: Counter = Counter()
    with csv_rows(path, REQUIRED, OPTIONAL, path.name, stats, partial_tail=partial_tail) as getters:
        for get in getters:
            agreement = squash(get("agreement-number"))
            legal = matching.filed_name(matching.first_language(get("supplier-legal-name")))[0] or ""
            if not agreement or not legal or matching.is_placeholder(legal):
                result.skipped += 1
                continue
            day = iso_date(get("date-file-published"))
            if day:
                published[day] += 1
            if agreement not in parsed.instruments:
                parsed.instruments[agreement] = Instrument(
                    agreement=agreement,
                    type_en=_text(get("agreement-type_en"), 200), type_fr=_text(get("agreement-type_fr"), 200),
                    description_en=_text(get("sosa-description_en")), description_fr=_text(get("sosa-description_fr")),
                    commodity=_text(get("commodity"), 40),
                    commodity_en=_text(get("commodity-description_en"), 300),
                    commodity_fr=_text(get("commodity-description_fr"), 300),
                    end_user_en=_text(get("end-user-entity_en"), 300), end_user_fr=_text(get("end-user-entity_fr"), 300),
                    start=iso_date(get("award-date")), expiry=iso_date(get("expiry-date")),
                )
            else:
                inst = parsed.instruments[agreement]
                # Rows of one instrument repeat its fields; a later expiry wins, a blank never replaces a value.
                expiry = iso_date(get("expiry-date"))
                if expiry and (inst.expiry is None or expiry > inst.expiry):
                    inst.expiry = expiry
            withheld = matching.is_person_name(legal)
            norm = norm_name(legal)
            if not norm:
                result.skipped += 1
                continue
            region = region_code(get("delivery-point-code"))
            if withheld:
                drops.add(legal)
                key = (agreement, person_key(norm), region)
                holding = Holding(agreement, key[1], region, None, None, None, _text(get("delivery-point_en"), 200),
                                  _text(get("delivery-point_fr"), 200), True)
            else:
                operating = _text(get("supplier-operating-name"), 300)
                if operating and matching.is_person_name(operating):
                    operating = None
                key = (agreement, norm, region)
                holding = Holding(agreement, norm, region, _text(legal, 300), operating,
                                  _text(get("supplier-standardized-name"), 300), _text(get("delivery-point_en"), 200),
                                  _text(get("delivery-point_fr"), 200), False)
            parsed.holdings[key] = holding
    result.rows = stats.rows
    result.skipped += stats.skipped
    result.missing = stats.missing
    # Every row of one file carries the same date; the most common one wins if a row disagrees.
    parsed.published = published.most_common(1)[0][0] if published else None
    result.published = parsed.published
    result.holders = len(parsed.holdings)
    result.instruments = len(parsed.instruments)
    result.withheld = sum(1 for h in parsed.holdings.values() if h.withheld)
    return parsed


def released(path: Path | None = None) -> str | None:
    """The publication date the operator released from a hold (config.SOSA_RELEASE), or None."""
    p = path or config.SOSA_RELEASE
    try:
        text = p.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return text[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text[:10]) else None


# ---------------------------------------------------------------------------
# Applying a file
# ---------------------------------------------------------------------------

def losses_reported(conn: sqlite3.Connection) -> bool:
    """Lost events start after the second file: before it, nothing was ever held that a reader was told of."""
    return int(get_meta(conn, META_FILES) or 0) >= 2


def _event(conn: sqlite3.Connection, kind: int, day: str, agreement: str, oid: str, region: str,
           endd: str | None, why: str | None = None) -> None:
    conn.execute("INSERT OR IGNORE INTO sosa_events (day, kind, ref, oid, region, endd, why) VALUES (?, ?, ?, ?, ?, ?, ?)",
                 (day, kind, f"sosa:{agreement}", oid, region, endd, why))


def _rekey(conn: sqlite3.Connection) -> int:
    """After a change to the name rules: each named row moves to the key its stored name now gives, so its
    first_seen survives. A withheld row holds no name to key again; the quiet load replaces it."""
    moved = 0
    rows = conn.execute("SELECT rowid, agreement_number, supplier_norm, delivery_point_code, supplier_raw FROM sosa_holders "
                        "WHERE supplier_raw IS NOT NULL").fetchall()
    for rowid, agreement, old, region, raw in rows:
        text = matching.first_language(raw)
        norm = norm_name(text)
        if not norm:
            continue
        new = person_key(norm) if matching.is_person_name(text) else norm
        if new == old:
            continue
        taken = conn.execute("SELECT 1 FROM sosa_holders WHERE agreement_number = ? AND supplier_norm = ? "
                             "AND delivery_point_code = ?", (agreement, new, region)).fetchone()
        if taken:
            conn.execute("DELETE FROM sosa_holders WHERE rowid = ?", (rowid,))
        elif new.startswith("person:"):
            conn.execute("UPDATE sosa_holders SET supplier_norm = ?, supplier_raw = NULL, operating_name = NULL, "
                         "standardized_name = NULL, organization_id = NULL, supplier_withheld = 1 WHERE rowid = ?",
                         (new, rowid))
        else:
            conn.execute("UPDATE sosa_holders SET supplier_norm = ? WHERE rowid = ?", (new, rowid))
        moved += 1
    return moved


def apply(conn: sqlite3.Connection, parsed: Parsed, result: LoadResult, *, today: str, quiet: bool = False) -> None:
    """Write one file's instruments and holders into the tables, with their events, in one transaction.

    quiet: the keys changed form since the last file (KEYS_VERSION). Rows are
    moved to their new keys first; a row the file lacks after that is
    deleted rather than counted absent, and no event is written.
    """
    day = parsed.published or today
    first_load = get_meta(conn, META_FIRST)
    events = first_load is not None and not quiet
    resolve = Resolver(conn)
    try:
        if quiet:
            _rekey(conn)
        for inst in parsed.instruments.values():
            prev = conn.execute("SELECT expiry FROM sosa_instruments WHERE agreement_number = ?", (inst.agreement,)).fetchone()
            values = (inst.type_en, inst.type_fr, inst.description_en, inst.description_fr, inst.commodity, inst.commodity_en,
                      inst.commodity_fr, inst.end_user_en, inst.end_user_fr, inst.start, inst.expiry)
            if prev is None:
                conn.execute(
                    "INSERT INTO sosa_instruments (agreement_number, type_en, type_fr, description_en, description_fr, commodity, "
                    "commodity_en, commodity_fr, end_user_en, end_user_fr, start, expiry, first_seen, last_seen) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (inst.agreement, *values, day, day))
            else:
                moved = 1 if prev[0] is not None and inst.expiry is not None and prev[0] != inst.expiry else 0
                conn.execute(
                    "UPDATE sosa_instruments SET type_en = ?, type_fr = ?, description_en = ?, description_fr = ?, commodity = ?, "
                    "commodity_en = ?, commodity_fr = ?, end_user_en = ?, end_user_fr = ?, start = ?, expiry = ?, last_seen = ?, "
                    "expiry_changes = expiry_changes + ? WHERE agreement_number = ?", (*values, day, moved, inst.agreement))
        existing = {(r[0], r[1], r[2]): r for r in conn.execute(
            "SELECT agreement_number, supplier_norm, delivery_point_code, organization_id, missing_files, lost_on, lost_why "
            "FROM sosa_holders")}
        for key, h in parsed.holdings.items():
            inst = parsed.instruments[h.agreement]
            oid = None if h.withheld else resolve(h.raw)
            expired = inst.expiry is not None and inst.expiry < today
            row = existing.get(key)
            if row is not None:
                # Back in the file: a row lost by absence, or by an expiry the file has since moved, is held again.
                restore = row[5] is not None and not expired
                conn.execute(
                    "UPDATE sosa_holders SET supplier_raw = ?, operating_name = ?, standardized_name = ?, delivery_point_en = ?, "
                    "delivery_point_fr = ?, organization_id = ?, supplier_withheld = ?, last_seen = ?, missing_files = 0, "
                    "lost_on = CASE WHEN ? THEN NULL ELSE lost_on END, lost_why = CASE WHEN ? THEN NULL ELSE lost_why END "
                    "WHERE agreement_number = ? AND supplier_norm = ? AND delivery_point_code = ?",
                    (h.raw, h.operating, h.standardized, h.region_en, h.region_fr, oid, 1 if h.withheld else 0, day,
                     1 if restore else 0, 1 if restore else 0, *key))
                continue
            conn.execute(
                "INSERT INTO sosa_holders (agreement_number, supplier_norm, delivery_point_code, supplier_raw, operating_name, "
                "standardized_name, delivery_point_en, delivery_point_fr, organization_id, supplier_withheld, first_seen, last_seen) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (*key, h.raw, h.operating, h.standardized, h.region_en, h.region_fr, oid, 1 if h.withheld else 0, day, day))
            if first_load is not None and not quiet:
                result.gained += 1
            if events and oid and not expired:
                _event(conn, GAINED, day, h.agreement, oid, h.region, inst.expiry)
        for key, row in existing.items():
            if key in parsed.holdings or row[5] is not None:
                continue
            if quiet:
                conn.execute("DELETE FROM sosa_holders WHERE agreement_number = ? AND supplier_norm = ? "
                             "AND delivery_point_code = ?", key)
                continue
            missing = row[4] + 1
            if missing >= LOST_AFTER_FILES:
                conn.execute("UPDATE sosa_holders SET missing_files = ?, lost_on = ?, lost_why = 'absent' "
                             "WHERE agreement_number = ? AND supplier_norm = ? AND delivery_point_code = ?", (missing, day, *key))
                result.lost += 1
                if row[3] and losses_reported(conn):
                    expiry = conn.execute("SELECT expiry FROM sosa_instruments WHERE agreement_number = ?", (key[0],)).fetchone()
                    _event(conn, LOST, day, key[0], row[3], key[2], expiry[0] if expiry else None, "absent")
            else:
                conn.execute("UPDATE sosa_holders SET missing_files = ? WHERE agreement_number = ? AND supplier_norm = ? "
                             "AND delivery_point_code = ?", (missing, *key))
        set_meta(conn, META_PUBLISHED, day)
        set_meta(conn, META_ROWS, len(parsed.holdings))
        set_meta(conn, META_FILE_ROWS, result.rows)
        set_meta(conn, META_KEYS, KEYS_VERSION)
        set_meta(conn, META_FILES, int(get_meta(conn, META_FILES) or 0) + 1)
        if first_load is None:
            set_meta(conn, META_FIRST, day)
        conn.execute("DELETE FROM meta WHERE key = ?", (META_HELD,))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def load_file(conn: sqlite3.Connection, path: Path, *, today: str, drops: matching.PersonDrops | None = None,
              partial_tail: bool = False, release_path: Path | None = None) -> LoadResult:
    """Read one copy of the file and apply it unless it repeats the last publication or is held for review."""
    result = LoadResult()
    parsed = read_file(path, drops if drops is not None else matching.PersonDrops(), result, partial_tail=partial_tail)
    if not parsed.holdings:
        raise LayoutError(f"{path.name} holds no holder rows; the previous rows are kept")
    quiet = get_meta(conn, META_KEYS) not in (None, KEYS_VERSION)
    last = get_meta(conn, META_PUBLISHED)
    if parsed.published and parsed.published == last and not quiet:
        result.state = "same publication"
        return result
    previous = int(get_meta(conn, META_ROWS) or 0)
    result.previous_rows = previous
    if previous and len(parsed.holdings) < previous * (1 - HOLD_FALL) and released(release_path) != parsed.published:
        # A file that lost this many rows at once is more likely a broken
        # extract than a week of lapses; nothing is marked lost until the
        # operator has looked.
        set_meta(conn, META_HELD, parsed.published or today)
        conn.commit()
        result.state = "held"
        return result
    apply(conn, parsed, result, today=today, quiet=quiet)
    result.state = "applied quietly" if quiet else "applied"
    log.info("sosa: %d rows, %d holder rows, %d instruments, %d withheld, %d gained, %d lost", result.rows,
             result.holders, result.instruments, result.withheld, result.gained, result.lost)
    return result


# ---------------------------------------------------------------------------
# The nightly upkeep
# ---------------------------------------------------------------------------

@dataclass
class Upkeep:
    relinked: int = 0
    expired: int = 0
    purged: int = 0
    instruments: int = 0             # active instruments
    holders: int = 0                 # active holder rows
    resolved: int = 0                # of them linked to a profile
    withheld: int = 0
    with_segments: int = 0
    with_tender: int = 0
    callups: int = 0
    gained_week: int = 0
    lost_week: int = 0


def _relink(conn: sqlite3.Connection) -> int:
    resolve = Resolver(conn)
    changed = []
    for rowid, raw, current in conn.execute("SELECT rowid, supplier_raw, organization_id FROM sosa_holders "
                                             "WHERE supplier_withheld = 0 AND supplier_raw IS NOT NULL"):
        oid = resolve(raw)
        if oid != current:
            changed.append((oid, rowid))
    conn.executemany("UPDATE sosa_holders SET organization_id = ? WHERE rowid = ?", changed)
    return len(changed)


def _expire(conn: sqlite3.Connection, today: str) -> int:
    """Holders of an instrument whose expiry passed are lost on the day the stage sees it."""
    rows = conn.execute(
        "SELECT h.agreement_number, h.supplier_norm, h.delivery_point_code, h.organization_id, i.expiry FROM sosa_holders h "
        "JOIN sosa_instruments i ON i.agreement_number = h.agreement_number "
        "WHERE h.lost_on IS NULL AND i.expiry IS NOT NULL AND i.expiry < ?", (today,)).fetchall()
    events = losses_reported(conn)
    for agreement, norm, region, oid, expiry in rows:
        conn.execute("UPDATE sosa_holders SET lost_on = ?, lost_why = 'expired' WHERE agreement_number = ? "
                     "AND supplier_norm = ? AND delivery_point_code = ?", (today, agreement, norm, region))
        if events and oid:
            _event(conn, LOST, today, agreement, oid, region, expiry, "expired")
    return len(rows)


def _purge(conn: sqlite3.Connection, today: str) -> int:
    cutoff = (date.fromisoformat(today) - timedelta(days=LOST_KEEP_DAYS)).isoformat()
    gone = conn.execute("DELETE FROM sosa_holders WHERE lost_on IS NOT NULL AND lost_on < ?", (cutoff,)).rowcount
    conn.execute("DELETE FROM sosa_instruments WHERE NOT EXISTS (SELECT 1 FROM sosa_holders h "
                 "WHERE h.agreement_number = sosa_instruments.agreement_number)")
    events_cutoff = (date.fromisoformat(today) - timedelta(days=EVENT_KEEP_DAYS)).isoformat()
    conn.execute("DELETE FROM sosa_events WHERE day < ?", (events_cutoff,))
    return gone


def _counts(conn: sqlite3.Connection) -> None:
    conn.execute(
        "UPDATE sosa_instruments SET "
        "n_holders = (SELECT COUNT(DISTINCT supplier_norm) FROM sosa_holders h WHERE h.agreement_number = "
        "sosa_instruments.agreement_number AND h.lost_on IS NULL), "
        "n_holders_withheld = (SELECT COUNT(DISTINCT supplier_norm) FROM sosa_holders h WHERE h.agreement_number = "
        "sosa_instruments.agreement_number AND h.lost_on IS NULL AND h.supplier_withheld = 1)")


def _segments_known() -> set[str]:
    from ..export_static import read_segments
    return set(read_segments())


def link_notices(conn: sqlite3.Connection) -> int:
    """Each instrument's stem, the UNSPSC segments of the award and tender notices that share it, and the newest
    tender notice among them (tender_reference). An instrument no notice shares a stem with has no segment."""
    known = _segments_known()
    stems = {a: stem(a) for (a,) in conn.execute("SELECT agreement_number FROM sosa_instruments")}
    wanted = {s for s in stems.values() if s}
    tenders: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for ref, sol, published in conn.execute(
            "SELECT reference, solicitation, MAX(published) FROM tenders WHERE solicitation IS NOT NULL GROUP BY reference, solicitation"):
        s = stem(sol)
        if s in wanted:
            tenders[s].append((published or "", ref))
    awards: dict[str, set[str]] = defaultdict(set)
    for ref, sol, number in conn.execute("SELECT DISTINCT reference, solicitation, contract_number FROM awards "
                                         "WHERE solicitation IS NOT NULL OR contract_number IS NOT NULL"):
        for value in (sol, number):
            s = stem(value)
            if s in wanted:
                awards[s].add(ref)
    segs: dict[tuple[str, str], set[str]] = defaultdict(set)
    for table, refs in (("tender_codes", {r for rows in tenders.values() for _, r in rows}),
                        ("award_codes", {r for refs in awards.values() for r in refs})):
        ordered = sorted(refs)
        for i in range(0, len(ordered), 500):
            chunk = ordered[i:i + 500]
            marks = ", ".join("?" * len(chunk))
            for ref, code in conn.execute(f"SELECT reference, unspsc FROM {table} WHERE reference IN ({marks})", chunk):
                if str(code)[:2] in known:
                    segs[(table, ref)].add(str(code)[:2])
    updates = []
    for agreement, s in stems.items():
        found: set[str] = set()
        tender = None
        if s:
            for _, ref in tenders.get(s, []):
                found |= segs.get(("tender_codes", ref), set())
            for ref in awards.get(s, set()):
                found |= segs.get(("award_codes", ref), set())
            if tenders.get(s):
                tender = max(tenders[s])[1]
        updates.append((s, json.dumps(sorted(found)) if found else None, tender, agreement))
    conn.executemany("UPDATE sosa_instruments SET solicitation = ?, segments = ?, tender_reference = ? "
                     "WHERE agreement_number = ?", updates)
    return sum(1 for u in updates if u[1])


def link_end_users(conn: sqlite3.Connection) -> None:
    """The buyer a source has named with the end user's spelling (as the radar names an award's end user)."""
    spellings: dict[str, str] = {}
    for raw, bid in conn.execute("SELECT raw_name, buyer_id FROM buyer_names ORDER BY raw_name, source"):
        spellings.setdefault(str(raw).strip().casefold(), bid)
    for bid, en, fr in conn.execute("SELECT id, name_en, name_fr FROM buyers ORDER BY id"):
        for name in (en, fr):
            if name:
                spellings.setdefault(str(name).strip().casefold(), bid)
    rows = conn.execute("SELECT agreement_number, end_user_en, end_user_fr FROM sosa_instruments").fetchall()
    conn.executemany("UPDATE sosa_instruments SET end_user_buyer_id = ? WHERE agreement_number = ?", [
        (spellings.get((en or "").strip().casefold()) or spellings.get((fr or "").strip().casefold()), a)
        for a, en, fr in rows])


def count_callups(conn: sqlite3.Connection, today: str) -> int:
    """sosa_callups: the published contract rows naming each instrument in their standing_offer_number over
    CALLUP_YEARS fiscal years, by the holder organization that is the vendor ('' for any other vendor)."""
    first = fiscal_start(today, CALLUP_YEARS)
    by_fold = {fold(a): a for (a,) in conn.execute("SELECT agreement_number FROM sosa_instruments")}
    holders: dict[str, set[str]] = defaultdict(set)
    for a, oid in conn.execute("SELECT DISTINCT agreement_number, organization_id FROM sosa_holders "
                               "WHERE organization_id IS NOT NULL"):
        holders[a].add(oid)
    cells: dict[tuple[str, str], list] = {}
    for number, oid, withheld, value in conn.execute(
            f"SELECT standing_offer_number, organization_id, vendor_withheld, {organizations.CONTRACT_CHECKED} "
            "FROM contracts WHERE standing_offer_number IS NOT NULL AND standing_offer_number != '' AND contract_date >= ?",
            (first,)):
        agreement = by_fold.get(fold(number))
        if agreement is None:
            continue
        who = oid if oid and not withheld and oid in holders[agreement] else ""
        cell = cells.setdefault((agreement, who), [0, None, 0])
        cell[0] += 1
        if value is None:
            cell[2] += 1
        else:
            cell[1] = (cell[1] or 0) + value
    conn.execute("DELETE FROM sosa_callups")
    conn.executemany("INSERT INTO sosa_callups (agreement_number, organization_id, n, value, n_no_value) VALUES (?, ?, ?, ?, ?)",
                     [(a, o, n, v, nv) for (a, o), (n, v, nv) in sorted(cells.items())])
    return sum(c[0] for c in cells.values())


def upkeep(conn: sqlite3.Connection, today: str) -> Upkeep:
    """What runs every night whatever the file did; one transaction."""
    out = Upkeep()
    try:
        out.relinked = _relink(conn)
        out.expired = _expire(conn, today)
        out.purged = _purge(conn, today)
        _counts(conn)
        link_end_users(conn)
        out.with_segments = link_notices(conn)
        out.callups = count_callups(conn, today)
        week = (date.fromisoformat(today) - timedelta(days=6)).isoformat()
        first = get_meta(conn, META_FIRST)
        out.instruments, out.with_tender = conn.execute(
            "SELECT COUNT(*), SUM(tender_reference IS NOT NULL) FROM sosa_instruments WHERE n_holders > 0").fetchone()
        out.with_tender = out.with_tender or 0
        out.holders, out.resolved, out.withheld = (v or 0 for v in conn.execute(
            "SELECT COUNT(*), SUM(organization_id IS NOT NULL), SUM(supplier_withheld) FROM sosa_holders "
            "WHERE lost_on IS NULL").fetchone())
        out.gained_week = conn.execute("SELECT COUNT(*) FROM sosa_holders WHERE first_seen >= ? AND first_seen > ?",
                                       (week, first or "9999")).fetchone()[0]
        out.lost_week = conn.execute("SELECT COUNT(*) FROM sosa_holders WHERE lost_on >= ?", (week,)).fetchone()[0]
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return out


# ---------------------------------------------------------------------------
# The stage
# ---------------------------------------------------------------------------

@dataclass
class SosaResult:
    state: str = ""                  # read | unchanged | not due | no sample | held: ... | failed
    load: LoadResult | None = None
    upkeep: Upkeep | None = None
    notices: list[str] = field(default_factory=list)

    def detail(self, conn: sqlite3.Connection) -> str:
        u = self.upkeep or Upkeep()
        parts = [self.state, f"published={get_meta(conn, META_PUBLISHED) or 'none'}",
                 f"file_rows={get_meta(conn, META_FILE_ROWS) or 0}"]
        if self.load is not None and self.load.state:
            parts.append(f"file={self.load.state.replace(' ', '_')}")
        parts += [f"instruments={u.instruments}", f"holders={u.holders}", f"resolved={u.resolved}",
                  f"withheld={u.withheld}", f"with_segments={u.with_segments}", f"callups={u.callups}",
                  f"gained_week={u.gained_week}", f"lost_week={u.lost_week}"]
        if get_meta(conn, META_HELD):
            parts.append(f"held={get_meta(conn, META_HELD)}")
        return " ".join(parts)


def _force_reread(conn: sqlite3.Connection) -> None:
    """The keys changed form: the file is read again tonight even if it has not changed (KEYS_VERSION)."""
    if get_meta(conn, META_PUBLISHED) and get_meta(conn, META_KEYS) not in (None, KEYS_VERSION):
        _forget_copy(conn)


def _forget_copy(conn: sqlite3.Connection) -> None:
    """Drop what lets refresh skip the file, so the next run downloads and reads it again."""
    conn.executemany("DELETE FROM meta WHERE key = ?", [(SPEC.key(k),) for k in ("sha256", "etag", "last_modified")]
                     + [(SPEC.loaded_key,)])
    conn.commit()


def _trust_intermediate(client: PoliteClient, pem_path: Path | None = None) -> bool:
    path = pem_path or config.SOSA_CA_PEM
    try:
        pem = path.read_text(encoding="ascii")
    except OSError:
        return False
    if "BEGIN CERTIFICATE" not in pem:
        return False
    client.trust_intermediate(urlsplit(SPEC.url).hostname or "", pem)
    return True


def run(conn: sqlite3.Connection, client: PoliteClient | None, *, now: str | None = None,
        samples: Path | None = None, work_dir: Path | None = None, review_dir: Path | None = None) -> SosaResult:
    """The sosa stage: apply a new publication of the file, then the nightly upkeep, then one log row.

    A download or parse that fails still runs the upkeep (the previous rows
    stand, nothing counts as absent) and then raises, so the run status
    carries the stage as failed and the daily check mails it.
    """
    stamp = now or now_iso()
    today = stamp[:10]
    result = SosaResult()
    drops = matching.PersonDrops()
    _force_reread(conn)
    trusted = _trust_intermediate(client) if client is not None and samples is None else False
    failure: BaseException | None = None
    try:
        result.state, result.load = refresh(
            conn, client, SPEC,
            lambda path: load_file(conn, path, today=today, drops=drops, partial_tail=samples is not None),
            stamp=stamp, samples=samples, work_dir=work_dir,
        )
    except Exception as exc:  # noqa: BLE001 - re-raised below, after the upkeep the previous rows still need
        conn.rollback()
        failure = exc
        result.state = "failed"
        if "CERTIFICATE_VERIFY_FAILED" in str(exc) and not trusted:
            failure = FetchError(f"the certificate of {urlsplit(SPEC.url).hostname} did not verify; place the intermediate "
                                 f"that issued it in awardwatch_pipeline/data/{config.SOSA_CA_PEM.name} (docs/sosa.md)",
                                 status=getattr(exc, "status", None))
    if result.load is not None and result.load.held:
        # The copy must be read again until it is released or replaced.
        _forget_copy(conn)
        result.state = f"held: {result.load.holders} holder rows against {result.load.previous_rows}"
        result.notices.append(
            f"sosa: the file published {result.load.published} holds {result.load.holders} holder rows against "
            f"{result.load.previous_rows} last time (more than {int(HOLD_FALL * 100)} percent fewer); held for review, "
            f"nothing marked lost. Release it by writing {result.load.published} to "
            f"awardwatch_pipeline/data/{config.SOSA_RELEASE.name}")
    result.upkeep = upkeep(conn, today)
    if result.load is not None:
        review = drops.write((review_dir or config.OUT_DIR / "review") / "sosa-persons.txt",
                             what="Standing offers and supply arrangements", stamp=stamp, withheld="holder withheld")
        if review:
            result.notices.append(review)
        if result.load.missing:
            result.notices.append(f"{SPEC.file_name} lacks {', '.join(result.load.missing)}")
        if result.load.skipped:
            result.notices.append(f"sosa: {result.load.skipped} rows without an agreement number or a name were skipped")
    if samples is not None and result.state == "no sample":
        result.notices.append(f"no {SPEC.sample_name} in the samples folder (samples run)")
    if failure is not None:
        # The figures still reach the run log through the notice; the failure is the stage's row.
        log.warning("sosa: %s", result.detail(conn))
        raise failure
    load = result.load
    log_run(conn, "sosa", detail=result.detail(conn)[:900], rows_in=load.rows if load else 0,
            rows_new=load.gained if load else 0, excluded=load.withheld if load else 0,
            notice=" | ".join(result.notices) or None)
    return result


# ---------------------------------------------------------------------------
# Readers for the export and the records database
# ---------------------------------------------------------------------------

def stage_outcome(conn: sqlite3.Connection) -> str:
    """ok, held or failed: the last sosa row of the run log ("none" before the stage ever ran)."""
    row = conn.execute("SELECT ok, detail FROM sources_log WHERE source = 'sosa' ORDER BY id DESC LIMIT 1").fetchone()
    if row is None:
        return "none"
    if not row[0]:
        return "failed"
    return "held" if get_meta(conn, META_HELD) else "ok"


def active_instruments(conn: sqlite3.Connection) -> Iterator[sqlite3.Row]:
    """The instruments with at least one active holder, soonest expiry first."""
    return conn.execute("SELECT * FROM sosa_instruments WHERE n_holders > 0 ORDER BY expiry IS NULL, expiry, agreement_number")


def segments_of(raw: object) -> list[str]:
    try:
        items = json.loads(raw) if isinstance(raw, str) and raw else []
    except ValueError:
        return []
    return [s for s in items if isinstance(s, str) and re.fullmatch(r"\d{2}", s)] if isinstance(items, list) else []
