"""The records database: its rows, and the nightly sync that keeps it current.

The records database (D1 `awardwatch-records`, binding RECORDS, schema in
pipeline/records_schema.sql, docs/analytics.md) answers the site's analytics
views. It holds one row per counted record of the four money sources, as
indicators.RECORDS counts them (an award notice or a PSPC history contract by
reference, valued on its newest amendment; a published contract row; a grant
or contribution agreement on its highest amendment), reduced to integers: the
source, the federal fiscal year and quarter, the buyer, the organization, the
UNSPSC segment, the counted value in cents and why a value is not counted,
whether the record was competitive and the method's code; for award notices
and history also the first version's value and the count of later versions
(the amendment growth); and the reference and a short title the
largest-records tables link and show. Beside them go the names the top lists
show (rec_orgs, rec_buyers), the summary tables the first charts and the free
views read (rec_buyer_quarters, rec_segment_years), the average and median
values read from summary rows rather than computed at request time
(rec_buyer_years, and three columns of rec_segment_years), and the contracts
ending in each of the next eight fiscal quarters by the radar's rules
(rec_due). Grants whose recipient reads as a person are left out entirely.

Three more tables serve the record tables, the earlier awards on a tender,
the per-organization feeds and the radar's filters (site/src/records_tables.ts):
rec_details (each record's date, reference and title beside its figures),
rec_classes (the UNSPSC classes of each notice and history record) and
rec_expiring (the radar's 12-month window, read from the static export's
window files so the site's two views of the radar cannot disagree). Beside
the last, rec_expiring_prov holds each window row's provinces, stated and
derived (places.py), one row each, for the radar's province filter: a table
of its own, because a column added to rec_expiring reaches D1 only through
a full reload.

A record's date (records.fy and fq, rec_details.day, rec_classes.day) is its
award date for an award notice or a history record, its contract date for a
published contract and its start for a grant; an award notice or history
record whose award date falls after the data date takes its publication date
instead (NOTICE_DAY), because in every such row seen the award date is the
contract's end date entered in the award-date field. The fiscal-year counts
and the record tables' newest order then place it when it appeared.

Two serve the page of each published contract (/contracts/<department>/
<reference>, site/src/pages/published.tsx): rec_contracts (every field the
page shows of a published contract row) and rec_gsin (the names of the GSIN
codes those rows carry). The asset count is why these live here rather than
in static shards: a page per published contract would be 1.3 million files.
Beside them, rec_contract_indigenous holds the two Indigenous business fields
of the rows that report a set-aside under the Procurement Strategy for
Indigenous Business or an Indigenous business outside one: a table of its
own, because a column added to rec_contracts reaches D1 only through a full
reload, and a row only where a field says so, so the table stays small.

One more, rec_events, holds what the watches follow (site/src/account/
watch_events.ts): what happened tonight to an organization, a buyer, a
single record or a tender notice, derived by derive_events from the
night's differences and the previous night's state (docs/analytics.md,
"Events"), kept 90 data dates; an organization's standing offers and supply
arrangements gained and lost come from the sosa stage's own comparison
(sosa_events).
Two serve the page of each standing offer or supply arrangement
(/instruments/<agreement>, site/src/pages/instruments.tsx): rec_instruments
(the instrument, its call-ups from the published contracts as JSON) and
rec_holders (its active holders whose names are shown; a holder withheld as a
person is only counted, in rec_instruments.nw). Their rows come from the sosa
tables (sosa_export.instrument_rows and holder_rows).

The sync is the search sync's (search_db.py) with three changes, because the
records table is about a hundred times larger:

* tonight's rows are built into temporary tables and compared with the
  ledger (records_ledger) in SQL, so the three million keys never sit in a
  Python dict;
* the differences are staged in records_staged rather than written into the
  manifest, which would run to a hundred megabytes on a first load; the
  manifest carries a plan number that records-synced holds against the
  stage;
* a full reload sets rec_meta.state to 'loading' in its first batch, and the
  night's finish.sql, applied only after the counts read back matched, sets
  it to 'ready' with the data date, so a page never shows half a load.

A full reload is made on an empty ledger, when asked (`records-sync --full`)
and after a count read back disagreed, but not within RELOAD_MIN_DAYS of the
last one: a full load of the twelve tables writes about 25 million rows. It is
also made, whatever the days, when the tables changed form (LAYOUT differs
from the one the last full load recorded): D1 creates a table only when it is
missing, so the new columns reach it only by dropping the old tables.

No value here comes from a visitor, and each is written as a literal no
content can break out of (search_db.sql_literal).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import re
import secrets
import sqlite3
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import quote

from . import config, expiring, organizations, sosa_export
from .db import connect, get_meta, now_iso, set_meta, today_iso
from .export import scrub
from .export_static import BUYER_ID_RE, NEW_LAG_DAYS, ORG_ID_RE, RefMap, read_segments
from .indicators import RULES_VERSION
from .normalize import PROVINCE_CODES, closing_day, indigenous_outside_psib, psib_set_aside, tender_status_on
from .search_db import (
    MAX_BATCH_BYTES, MAX_BATCH_STATEMENTS, MAX_KEYS_PER_DELETE, MAX_STATEMENT_BYTES, _BatchWriter, _grouped, sql_literal,
)
from .sources import sosa

log = logging.getLogger(__name__)

SCHEMA_PATH = config.REPO_ROOT / "pipeline" / "records_schema.sql"


@dataclass(frozen=True)
class Table:
    code: int                   # the ledger's t: never renumbered, or every ledger row of the table is lost
    name: str                   # the D1 table
    key: str                    # its INTEGER PRIMARY KEY
    columns: tuple[str, ...]    # every other column the sync writes, in the order the hash reads them

    @property
    def written(self) -> tuple[str, ...]:
        return (self.key, *self.columns)


# Changing a column list or its order changes every hash of that table, which
# resends each of its rows once; a column added to a table D1 already holds
# also needs LAYOUT raised, so the next sync drops and recreates the tables.
RECORDS = Table(1, "records", "k", ("src", "fy", "fq", "bid", "oid", "sid", "extra", "cents", "vnote", "comp", "meth",
                                    "ocents", "namd", "ref", "title"))
ORGS = Table(2, "rec_orgs", "oid", ("name",))
BUYERS = Table(3, "rec_buyers", "bid", ("id", "name_en", "name_fr"))
BUYER_QUARTERS = Table(4, "rec_buyer_quarters", "k", ("bid", "src", "fy", "fq", "n", "cents", "n_no_value"))
SEGMENT_YEARS = Table(5, "rec_segment_years", "k", ("sid", "src", "fy", "n", "cents", "n_no_value", "n_buyers", "n_orgs",
                                                    "n_pos", "pos", "med"))
BUYER_YEARS = Table(6, "rec_buyer_years", "k", ("bid", "src", "fy", "n_pos", "pos", "med"))
DUE = Table(7, "rec_due", "k", ("bid", "sid", "fy", "fq", "n", "cents", "n_no_value"))
DETAILS = Table(8, "rec_details", "k", ("src", "day", "bid", "oid", "cents", "vnote", "comp", "meth", "ref", "title_en", "title_fr"))
CLASSES = Table(9, "rec_classes", "k", ("rk", "cls", "bid", "day"))
EXPIRING = Table(10, "rec_expiring", "k", ("endd", "oid", "buyer", "client", "segs", "kind", "comp", "cad", "cents", "nv", "so",
                                          "m31", "j"))
CONTRACTS = Table(11, "rec_contracts", "k", ("dept", "ref", "pid", "bid", "oid", "wh", "cdate", "start", "endd", "value", "orig",
                                            "amend", "proc", "comp", "ctype", "gsin", "agr", "trade", "ltr", "inst", "period",
                                            "bids", "so_no", "desc_en", "desc_fr", "com_en", "com_fr"))
GSIN = Table(12, "rec_gsin", "k", ("code", "desc_en", "desc_fr"))
# The events the watches follow, filled by derive_events from records_events.
EVENTS = Table(13, "rec_events", "k", ("day", "kind", "src", "oid", "buyer", "sid", "ref", "cents", "ocents", "endd", "oendd",
                                       "closing", "oclosing", "namd", "title", "title_fr", "other", "other_fr", "horizon", "more",
                                       "path"))
INSTRUMENTS = Table(14, "rec_instruments", "k", ("agr", "type_en", "type_fr", "desc_en", "desc_fr", "gsin", "gsin_en", "gsin_fr",
                                                 "user_en", "user_fr", "buyer", "start", "expiry", "segs", "tref", "n", "nw",
                                                 "seen", "last", "calls"))
HOLDERS = Table(15, "rec_holders", "k", ("ik", "oid", "name", "op", "region", "region_en", "region_fr", "seen"))
# One row per radar row and province: k is the row's rec_expiring.k, so the
# table needs a key of its own for the ledger (pk), which the site never reads.
EXPIRING_PROV = Table(16, "rec_expiring_prov", "pk", ("k", "prov", "derived"))
# A published contract row's Indigenous business fields, keyed as its rec_contracts row (published_indigenous_rows).
CONTRACT_INDIGENOUS = Table(17, "rec_contract_indigenous", "k", ("psib", "ib"))
# The holder's record of a radar row (lines.py, lines_rows), keyed as its rec_expiring row.
LINES = Table(18, "rec_lines", "k", ("sk", "j"))
TABLES = (RECORDS, ORGS, BUYERS, BUYER_QUARTERS, SEGMENT_YEARS, BUYER_YEARS, DUE, DETAILS, CLASSES, EXPIRING, CONTRACTS, GSIN,
          EVENTS, INSTRUMENTS, HOLDERS, EXPIRING_PROV, CONTRACT_INDIGENOUS, LINES)
BY_CODE = {t.code: t for t in TABLES}

# The form of the tables in records_schema.sql. 1: phase 1 (no meta row says
# so); 2: the amendment, reference and title columns, the median columns and
# rec_buyer_years, rec_due. Recorded in meta (META_LAYOUT) by the full load
# that wrote it; a sync that finds another reloads in full by itself. The
# tables added beside them (rec_details to rec_gsin, then rec_events, rec_instruments, rec_holders,
# rec_expiring_prov, rec_contract_indigenous and rec_lines) leave it at 2: no table D1 holds changed form, the
# nightly schema creates a missing table, and its rows are all new to the ledger, so the ordinary changes fill
# it. A column added to any of the eighteen raises it.
LAYOUT = 2

# The source numbers the site's records_db.ts SOURCE_NUMBER repeats.
SOURCES = {"awards": 1, "history": 2, "contracts": 3, "grants": 4}

# Why a record's value is not in its cents (records.vnote).
COUNTED, NO_VALUE, OTHER_CURRENCY, FLAGGED = 0, 1, 2, 3

# A records row is about 90 bytes of SQL without its title, so a statement
# holds more of them than a search row; the byte cap (MAX_STATEMENT_BYTES)
# cuts a statement of long titles first.
MAX_ROWS_PER_UPSERT = 500
# The title the largest-records tables show, and the longest reference kept
# (a longer one would make a wrong link, so it is left out).
TITLE_CHARS = 120
REF_CHARS = 120
# The fiscal quarters rec_due covers, the data date's first.
DUE_QUARTERS = 8
# A full load of all twelve tables writes about 25 million rows, half of the
# 50 million a month the paid plan includes, so one forced by a count that
# disagreed waits this long after the last.
RELOAD_MIN_DAYS = 28

META_RELOAD = "records_reload_due"      # the date records-check found a count disagreeing
META_FULL_AT = "records_full_at"        # the date the last full reload was written
META_PLAN = "records_plan"              # the plan number of the stage records-synced may record
META_LAYOUT = "records_layout"          # the LAYOUT of the last full load D1 received
MANIFEST = "manifest.json"
BATCH_LIST = "batches.txt"
FINISH = "finish.sql"                   # applied after the count check: state ready, the data date
OUTCOME = "last_outcome.txt"            # under data/out/records, read by `nightly status`

COMMANDS = ("records-sync", "records-check", "records-synced")

_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


# -- keys, numbers and hashes --------------------------------------------------


def key_of(text: str) -> int:
    """A signed 64-bit key from a record's own key ('award:<reference>'), as SQLite stores an INTEGER."""
    return int.from_bytes(hashlib.blake2b(text.encode("utf-8"), digest_size=8).digest(), "big", signed=True)


def buyer_number(buyer_id: str) -> int:
    """A buyer's number: 40 bits, so the site reads it back exactly as a JavaScript number."""
    return int.from_bytes(hashlib.blake2b(f"buyer:{buyer_id}".encode("utf-8"), digest_size=5).digest(), "big")


def org_number(org_id: object) -> int | None:
    """An organization id's ten hex digits as a number (org-00000000ff is 255); None for anything else.

    The site turns it back into the id (records_db.ts orgId), so no table maps the two.
    """
    return int(org_id[4:], 16) if isinstance(org_id, str) and ORG_ID_RE.match(org_id) else None


def org_id(number: int) -> str:
    return f"org-{number:010x}"


def row_hash(table: Table, values: Sequence) -> int:
    """A signed 64-bit BLAKE2b over the row's columns (without its key), as the ledger stores it.

    JSON keeps None, "" and 0 apart, so the hash changes exactly when a value does.
    """
    payload = json.dumps([table.name, *values], ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return int.from_bytes(hashlib.blake2b(payload.encode("utf-8"), digest_size=8).digest(), "big", signed=True)


def fiscal(day: object) -> tuple[int | None, int | None]:
    """The federal fiscal year (by the calendar year it starts in) and quarter of an ISO date.

    April 1 2025 to March 31 2026 is 2025 (2025-26); April to June is quarter 1,
    January to March quarter 4. (None, None) without a usable date.
    """
    m = _DAY.match(str(day or ""))
    if not m:
        return None, None
    year, month = int(m.group(1)), int(m.group(2))
    if not 1 <= month <= 12:
        return None, None
    return (year if month >= 4 else year - 1), (month - 4) % 12 // 3 + 1


def cents_of(value: object) -> int | None:
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    v = float(value)
    return round(v * 100) if math.isfinite(v) else None


# The published contracts' solicitation procedure codes (TBS guide), which
# the CanadaBuys procurement methods map onto.
METHOD_CODES = ("OB", "TC", "ST", "TN", "AC")


def method_code(method: object) -> str | None:
    """The TBS two-letter code of a CanadaBuys procurement method or a published contract's procedure.

    "Competitive - Open bidding" is OB, "- Traditional" TC, "- Selective
    tendering" ST, "Non-competitive" TN and "Advance contract award notice"
    AC; a published contract's code is taken as it stands. Anything else
    (another competitive method, a blank) is None; whether the record was
    competitive is records.comp, read by normalize.competitive.
    """
    text = re.sub(r"\s+", " ", str(method or "")).strip()
    if text.upper() in METHOD_CODES:
        return text.upper()
    low = text.casefold()
    if low.startswith(("non-competitive", "non competitive")):
        return "TN"
    if low.startswith("advance contract award"):
        return "AC"
    if low.startswith("competitive"):
        for words, code in (("open bidding", "OB"), ("traditional", "TC"), ("selective tendering", "ST")):
            if words in low:
                return code
    return None


# -- the rows ------------------------------------------------------------------

# One statement per source: one row per counted record with its key, the
# record's organization and buyer as indicators.RECORDS reads them, its date,
# the counted value (NULL when another currency, not published or flagged) and
# the three reasons apart, competitiveness, the method, the newest version's
# UNSPSC codes and whether the party is withheld; then what the amendment
# growth and the largest-records tables read: whether the contract is
# cancelled, its versions and its first version's value (award notices and
# history, by expiring.py's rule: the total value when positive, else the
# amount), the reference and the two titles.
_A = organizations


# The date an award notice or history record is counted and listed under: its
# award date, or its publication date when the award date falls after the
# data date. In every such row seen the award date is the contract's end
# date entered in the award-date field; the data date is bound as :as_of when
# the statement runs (record_rows, text_rows), and NULL keeps the award date.
NOTICE_DAY = "CASE WHEN substr(awarded, 1, 10) > :as_of THEN published ELSE awarded END"


def _notice_sql(kind: str, table: str, codes: str, buyer: str) -> str:
    return (
        f"WITH newest AS ({_A._newest_by_reference(table, ('reference',))}) "
        f"SELECT '{kind}:' || reference AS key, org, {buyer} AS buyer, {NOTICE_DAY} AS day, {_A.award_value(kind)} AS v, "
        f"{_A.AWARD_NO_VALUE} AS nv, {_A.award_flagged(kind)} AS flagged, UPPER(TRIM(COALESCE(currency, ''))) AS cur, "
        "competitive AS comp, method_en AS method, "
        f"(SELECT group_concat(c.unspsc, ' ') FROM {codes} c WHERE c.reference = newest.reference "
        "AND c.amendment = newest.amendment) AS codes, supplier_withheld AS withheld, "
        "COALESCE(status, '') = 'cancelled' AS cancelled, "
        f"(SELECT COUNT(*) FROM {table} z WHERE z.reference = newest.reference) AS versions, "
        f"(SELECT CASE WHEN z.total_value > 0 THEN z.total_value ELSE z.amount END FROM {table} z "
        "WHERE z.reference = newest.reference ORDER BY z.amendment LIMIT 1) AS ov, "
        "reference AS ref, title_en AS t_en, title_fr AS t_fr FROM newest"
    )


RECORD_SQL = {
    "awards": _notice_sql("award", "awards", "award_codes", "buyer_id"),
    "history": _notice_sql("history", "contract_history", "history_codes", "COALESCE(client_id, buyer_id)"),
    "contracts": (
        "SELECT 'contract:' || owner_org || ':' || reference AS key, organization_id AS org, buyer_id AS buyer, "
        f"contract_date AS day, {_A.CONTRACT_CHECKED} AS v, {_A.CONTRACT_NO_VALUE} AS nv, {_A.CONTRACT_FLAGGED} AS flagged, "
        "'' AS cur, competitive AS comp, solicitation_procedure AS method, NULL AS codes, vendor_withheld AS withheld, "
        "0 AS cancelled, NULL AS versions, NULL AS ov, owner_org || ':' || reference AS ref, description_en AS t_en, "
        "description_fr AS t_fr FROM contracts"
    ),
    "grants": (
        f"WITH newest AS ({_A._newest_by_reference('grants', ('owner_org', 'reference'))}) "
        "SELECT 'grant:' || owner_org || ':' || reference AS key, org, buyer_id AS buyer, start AS day, value AS v, "
        f"{_A.GRANT_NO_VALUE} AS nv, 0 AS flagged, '' AS cur, NULL AS comp, NULL AS method, NULL AS codes, "
        "recipient_withheld AS withheld, 0 AS cancelled, NULL AS versions, NULL AS ov, "
        "owner_org || ':' || reference AS ref, title_en AS t_en, title_fr AS t_fr FROM newest"
    ),
}

# The sources whose versions are numbered, so whose values can grow through amendments.
AMENDED_SOURCES = ("awards", "history")
_SPACES = re.compile(r"\s+")


def title_of(en: object, fr: object) -> str | None:
    """The title a largest-records table shows: the English one, else the French, with every email address and
    telephone number scrubbed first (a cut could split one the scrub would no longer see), whitespace folded,
    cut at a word boundary within TITLE_CHARS with an ellipsis."""
    for text, lang in ((en, "en"), (fr, "fr")):
        if isinstance(text, str) and text.strip():
            clean = _SPACES.sub(" ", str(scrub(text, lang))).strip()
            if len(clean) <= TITLE_CHARS:
                return clean
            cut = clean[:TITLE_CHARS]
            space = cut.rfind(" ")
            return (cut[:space] if space > TITLE_CHARS // 2 else cut[:TITLE_CHARS - 1]).rstrip(" ,;:.") + "…"
    return None


def value_note(v: object, nv: object, flagged: object, cur: object) -> int:
    if flagged:
        return FLAGGED
    if cur not in (None, "", "CAD"):
        return OTHER_CURRENCY
    if v is None or nv:
        return NO_VALUE
    return COUNTED


class _Counts:
    def __init__(self) -> None:
        self.grants_withheld = 0
        self.buyers: dict[int, str] = {}
        self.bad_buyers = 0

    def bid(self, buyer: object) -> int | None:
        """A buyer id's number, kept for rec_buyers; None (counted when the record names something else) otherwise."""
        if isinstance(buyer, str) and BUYER_ID_RE.match(buyer) and len(buyer) <= 80:
            number = buyer_number(buyer)
            seen = self.buyers.setdefault(number, buyer)
            if seen != buyer:
                raise ValueError(f"buyers {seen!r} and {buyer!r} have the same number; change buyer_number")
            return number
        if buyer is not None:
            self.bad_buyers += 1
        return None


def ref_maps(conn: sqlite3.Connection) -> dict[str, RefMap]:
    """The URL forms of the award and history references, as the site serves their pages."""
    return {"awards": RefMap(conn, "awards"), "history": RefMap(conn, "contract_history")}


def record_rows(conn: sqlite3.Connection, counts: _Counts | None = None,
                refs: dict[str, RefMap] | None = None, *, as_of: str | None = None) -> Iterator[tuple]:
    """Every row of the records table, values in RECORDS.written order (the key first).

    as_of is the data date: an award notice or history record whose award
    date falls after it takes its fiscal year and quarter from its
    publication date (NOTICE_DAY); None keeps every award date.

    A notice whose codes reach several of the 57 segments gives its row under
    the lowest, then one row with extra = 1 under each other (each with the
    reference and title, so a segment's largest records can show them). A
    grant whose recipient is withheld (a person) gives none;
    counts.grants_withheld says how many were left out. An award or history
    reference is written in the URL form its page has (export_static.RefMap),
    or NULL when the site serves no page for it.
    """
    tally = counts or _Counts()
    segments = set(read_segments())
    refs = refs if refs is not None else ref_maps(conn)
    for source, sql in RECORD_SQL.items():
        src = SOURCES[source]
        # The statements without :as_of ignore it (sqlite3 reads only the names a statement holds).
        for r in conn.execute(sql, {"as_of": as_of}):
            if source == "grants" and r["withheld"]:
                tally.grants_withheld += 1
                continue
            fy, fq = fiscal(r["day"])
            bid = tally.bid(r["buyer"])
            oid = None if r["withheld"] else org_number(r["org"])
            vnote = value_note(r["v"], r["nv"], r["flagged"], r["cur"])
            cents = cents_of(r["v"]) if vnote == COUNTED else None
            comp = r["comp"] if r["comp"] in (0, 1) else None
            meth = method_code(r["method"])
            ocents = namd = None
            if source in AMENDED_SOURCES:
                namd = max((r["versions"] or 1) - 1, 0)
                # A cancelled contract's zero is a status, so it never reads as a fall in value.
                if cents is not None and not r["cancelled"]:
                    ocents = cents_of(r["ov"])
            ref = refs[source].get(r["ref"]) if source in refs else r["ref"]
            if ref is not None and len(ref) > REF_CHARS:
                ref = None
            title = title_of(r["t_en"], r["t_fr"])
            sids = sorted({int(c[:2]) for c in str(r["codes"] or "").split() if c[:2] in segments})
            for i, sid in enumerate(sids or [None]):
                key = r["key"] if i == 0 else f"{r['key']}#{sid}"
                yield (key_of(key), src, fy, fq, bid, oid, sid, 1 if i else 0, cents, vnote, comp, meth, ocents, namd,
                       ref, title)


# -- the text beside the figures (rec_details, rec_classes) ---------------------

# The same records as RECORD_SQL, keyed the same way, with what a table of
# records shows: the date the fiscal year is read from, the reference, the
# title and the newest version's UNSPSC codes. Kept apart from RECORD_SQL so
# the figures' rows and their hashes stay as they are.
TEXT_SQL = {
    "awards": (
        f"WITH newest AS ({_A._newest_by_reference('awards', ('reference',))}) "
        f"SELECT 'award:' || reference AS key, reference AS ref, {NOTICE_DAY} AS day, title_en, title_fr, "
        "(SELECT group_concat(c.unspsc, ' ') FROM award_codes c WHERE c.reference = newest.reference "
        "AND c.amendment = newest.amendment) AS codes FROM newest"
    ),
    "history": (
        f"WITH newest AS ({_A._newest_by_reference('contract_history', ('reference',))}) "
        f"SELECT 'history:' || reference AS key, reference AS ref, {NOTICE_DAY} AS day, title_en, title_fr, "
        "(SELECT group_concat(c.unspsc, ' ') FROM history_codes c WHERE c.reference = newest.reference "
        "AND c.amendment = newest.amendment) AS codes FROM newest"
    ),
    "contracts": (
        "SELECT 'contract:' || owner_org || ':' || reference AS key, owner_org || ':' || reference AS ref, "
        "contract_date AS day, description_en AS title_en, description_fr AS title_fr, NULL AS codes FROM contracts"
    ),
    "grants": (
        f"WITH newest AS ({_A._newest_by_reference('grants', ('owner_org', 'reference'))}) "
        "SELECT 'grant:' || owner_org || ':' || reference AS key, owner_org || ':' || reference AS ref, start AS day, "
        "COALESCE(NULLIF(TRIM(title_en), ''), program_en) AS title_en, COALESCE(NULLIF(TRIM(title_fr), ''), program_fr) AS title_fr, "
        "NULL AS codes FROM newest"
    ),
}

# A title longer than this is cut: the tables show a line or two of it, and
# the cap keeps a row and its upsert statement small.
TITLE_MAX = 200
# The sources whose rows carry UNSPSC codes, and so classes.
CLASS_SOURCES = (SOURCES["awards"], SOURCES["history"])


def day_of(value: object) -> str | None:
    """The ISO date at the start of a date or datetime, or None when it is not one."""
    m = _DAY.match(str(value or ""))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return None


def title_text(value: object, lang: str) -> str | None:
    """A publisher's title as the exports print it: scrubbed of addresses and numbers, one line, capped."""
    text = re.sub(r"\s+", " ", str(scrub(value, lang) or "")).strip()
    if len(text) > TITLE_MAX:
        text = text[:TITLE_MAX - 1].rstrip() + "…"
    return text or None


def text_rows(conn: sqlite3.Connection, segments: set[str] | None = None,
              refs: dict[str, RefMap] | None = None, *, as_of: str | None = None) -> Iterator[tuple]:
    """(key, day, ref, title_en, title_fr, classes) for every record that has a date.

    The day of an award notice or history record is NOTICE_DAY with as_of
    bound, as in record_rows, so the record tables' newest order and the
    fiscal year the site reads from the day agree with the figures.

    An award or history reference takes its URL form (the site's /awards/ and
    /history/ addresses) by the decision records.ref follows
    (export_static.RefMap). One whose URL form another reference took first,
    or that has none, has no page here: it is written as ":" and the
    reference as published, the "<department>:<reference>" shape with no
    department, so the tables print it unlinked. NULL would say the same, but
    D1 created the column NOT NULL and only a LAYOUT change recreates it. The
    classes are the newest version's distinct six-digit UNSPSC classes within
    the 57 segments, space-separated.
    """
    segments = segments if segments is not None else set(read_segments())
    refs = refs if refs is not None else ref_maps(conn)
    for source, sql in TEXT_SQL.items():
        for r in conn.execute(sql, {"as_of": as_of}):
            day = day_of(r["day"])
            if day is None:
                continue
            if source in refs:
                ref = refs[source].get(r["ref"]) or f":{r['ref'] or ''}"[:200]
            else:
                ref = str(r["ref"])[:200]
            if not ref:
                continue
            classes = sorted({c[:6] for c in str(r["codes"] or "").split() if len(c) >= 6 and c[:6].isdigit() and c[:2] in segments})
            yield (key_of(r["key"]), day, ref, title_text(r["title_en"], "en"), title_text(r["title_fr"], "fr"),
                   " ".join(classes) or None)


# -- the radar's window (rec_expiring) ----------------------------------------------

EXPIRING_KINDS = {"award": SOURCES["awards"], "history": SOURCES["history"], "contract": SOURCES["contracts"]}
# CanadaBuys' instrument types, and the published contracts' "Standing offer
# or supply arrangement": the rule the site's standingOffer() applies.
_STANDING = re.compile(r"^(standing offer|supply arrangement)", re.IGNORECASE)


def expiring_rows(static_dir: Path) -> Iterator[tuple]:
    """The rows of the static export's 12-month window (expiring/12m/<n>.json), as rec_expiring holds them.

    No window index (the radar was not written tonight) gives no rows, as the
    site then has no radar to show; an index naming a page that is missing or
    is not a list is an export that cannot be trusted, and stops the sync.
    """
    folder = static_dir / "expiring" / "12m"
    try:
        index = json.loads((folder / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    pages = index.get("pages") if isinstance(index, dict) else None
    if not isinstance(pages, int) or isinstance(pages, bool) or pages < 0:
        return
    for n in range(1, pages + 1):
        rows = json.loads((folder / f"{n}.json").read_text(encoding="utf-8"))
        if not isinstance(rows, list):
            raise ValueError(f"expiring/12m/{n}.json is not a list of rows")
        for r in rows:
            row = expiring_row(r)
            if row is not None:
                yield row


def expiring_row(r: object) -> tuple | None:
    """One window row in EXPIRING.written order, or None for a row without a kind, a reference or an end date."""
    if not isinstance(r, dict) or r.get("kind") not in EXPIRING_KINDS or not isinstance(r.get("reference"), str):
        return None
    end = day_of(r.get("end"))
    if end is None:
        return None

    def buyer(v: object) -> str | None:
        return v if isinstance(v, str) and BUYER_ID_RE.match(v) and len(v) <= 80 else None

    segments = sorted({s for s in r.get("segments") or [] if isinstance(s, str) and re.fullmatch(r"\d{2}", s)})
    currency = str(r.get("currency") or "").strip().upper()
    cad = cents_of(r.get("value")) if currency in ("", "CAD") else None
    comp = r.get("competitive")
    comp = 1 if comp in (True, 1) else 0 if comp in (False, 0) else None
    kept = {k: v for k, v in r.items() if k != "days_left"}
    return (
        key_of(f"expiring:{r['kind']}:{r['reference']}"), end, None if r.get("supplier_withheld") else org_number(r.get("organization_id")),
        buyer(r.get("buyer_id")), buyer(r.get("client_buyer_id")), f" {' '.join(segments)} " if segments else "",
        EXPIRING_KINDS[r["kind"]], comp, cad, None if r.get("value_flag") else cad, 1 if r.get("value") is None else 0,
        1 if _STANDING.match(str(r.get("instrument_en") or "").strip()) else 0, 1 if end[5:10] == "03-31" else 0,
        json.dumps(kept, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False),
    )


def _province_set(value: object) -> set[str]:
    return {p for p in value if isinstance(p, str) and p in PROVINCE_CODES} if isinstance(value, list) else set()


def expiring_province_rows(window: Iterable[tuple]) -> Iterator[tuple]:
    """rec_expiring_prov's rows for rec_expiring's (expiring_row's tuples), in EXPIRING_PROV.written order.

    Read from the row's own JSON (its last column), so the filter and the row
    shown can never disagree: one row per province the row states
    (provinces, derived 0) and per province derived from its other fields
    (provinces_derived, derived 1). A code that is not one of the thirteen
    provinces and territories is left out, and a derived code the row also
    states is the stated one.
    """
    for row in window:
        k, data = row[0], json.loads(row[-1])
        stated = _province_set(data.get("provinces"))
        derived = _province_set(data.get("provinces_derived")) - stated
        for prov in sorted(stated | derived):
            yield key_of(f"expiring-prov:{k}:{prov}"), k, prov, 1 if prov in derived else 0


def lines_rows(conn: sqlite3.Connection, window: Iterable[tuple], tally: dict | None = None) -> Iterator[tuple]:
    """rec_lines's rows for rec_expiring's (expiring_row's tuples), in LINES.written order.

    Each window row whose holder's record the lines stage wrote (expiring_lines, by the row's own key: its kind and
    its reference as published) gives one row: the window row's key, so a page joins it on rec_expiring's key, and
    sk, its kind and reference in the site's URL form, in lower case, which the record pages ask by. Two rows whose
    sk would be the same (two published references differing only in case) keep the first by key and count the
    other in tally["lines_same_key"], since rec_lines_sk is unique. A night whose lines stage wrote nothing gives
    no rows, and the table empties with it.
    """
    left = tally if tally is not None else {}
    left.setdefault("lines_same_key", 0)
    held = dict(conn.execute("SELECT source_key, j FROM expiring_lines"))
    if not held:
        return
    seen: set[str] = set()
    for row in sorted(window, key=lambda r: r[0]):
        data = json.loads(row[-1])
        kind, ref = data.get("kind"), data.get("reference")
        j = held.get(f"{kind}:{data.get('reference_published') or ref}")
        if j is None or not isinstance(ref, str):
            continue
        sk = f"{kind}:{ref.lower()}"
        if sk in seen:
            left["lines_same_key"] += 1
            continue
        seen.add(sk)
        yield row[0], sk, j


# -- the published contracts' pages (rec_contracts, rec_gsin, rec_contract_indigenous) --

# One row per row of the contracts table, keyed as its records row is
# ('contract:<owner_org>:<reference>'), so the page reads the counted value
# from records by the same key. Everything the page shows of the row and
# nothing more: loaded_at changes every week for every row, so it stays out
# (the page names the file's last read from stats.json), and the contact
# columns were never stored.
PUBLISHED_SQL = (
    "SELECT owner_org, reference, NULLIF(TRIM(procurement_id), '') AS pid, buyer_id, organization_id, vendor_withheld, "
    "contract_date, period_start, delivery_date, value, original_value, amendment_value, solicitation_procedure, competitive, "
    "commodity_type, commodity_code, agreement_type, trade_agreement, limited_tendering_reason, instrument_type, "
    "reporting_period, number_of_bids, standing_offer_number, description_en, description_fr, comments_en, comments_fr "
    "FROM contracts"
)
# The site's address takes a reference of at most this many characters (pages/published.tsx REF_MAX).
REF_MAX = 200
# A code, a code list or a short field longer than this is cut.
SHORT_MAX = 120
# The loader cuts the description and comments at 600 characters (sources/contracts.TEXT_MAX); this holds them to it.
LONG_MAX = 600
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
# What no SQL literal can carry (a NUL) or no page should print, line breaks aside.
_STRAY = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _short(value: object, limit: int = SHORT_MAX) -> str | None:
    text = re.sub(r"\s+", " ", _STRAY.sub(" ", str(value or ""))).strip()
    return text[:limit].rstrip() or None


def _codes(value: object) -> str | None:
    """A JSON list of codes as the loader stores it (code_list) as "CA, CL", or the text as given when it is not one."""
    try:
        items = json.loads(value) if isinstance(value, str) else None
    except ValueError:
        items = None
    if isinstance(items, list):
        return _short(", ".join(str(i) for i in items if str(i).strip()))
    return _short(value)


def _long(value: object, lang: str) -> str | None:
    """A description or comment as the page prints it: scrubbed as the exports are, line breaks kept, capped."""
    text = _STRAY.sub(" ", str(scrub(value, lang) or "").replace("\r\n", "\n").replace("\r", "\n")).strip()
    return text[:LONG_MAX].rstrip() or None


def _addressable(dept: str, ref: str) -> bool:
    """Whether the site can address a published contract: a department that is a buyer id, and a reference of
    at most REF_MAX characters with no control character."""
    return bool(BUYER_ID_RE.match(dept)) and len(dept) <= 80 and bool(ref) and len(ref) <= REF_MAX and not _CONTROL.search(ref)


def published_rows(conn: sqlite3.Connection, tally: dict | None = None) -> Iterator[tuple]:
    """Every published contract row in CONTRACTS.written order.

    A row the site cannot address (a department that is not a buyer id, a
    reference longer than REF_MAX or holding a control character) is left
    out and counted in tally["contracts_unaddressable"].
    """
    left = tally if tally is not None else {}
    left.setdefault("contracts_unaddressable", 0)
    for r in conn.execute(PUBLISHED_SQL):
        dept, ref = str(r["owner_org"] or ""), str(r["reference"] or "")
        if not _addressable(dept, ref):
            left["contracts_unaddressable"] += 1
            continue
        buyer = r["buyer_id"]
        bid = buyer_number(buyer) if isinstance(buyer, str) and BUYER_ID_RE.match(buyer) and len(buyer) <= 80 else None
        withheld = 1 if r["vendor_withheld"] else 0
        comp = r["competitive"] if r["competitive"] in (0, 1) else None
        bids = r["number_of_bids"]
        bids = bids if isinstance(bids, int) and not isinstance(bids, bool) and bids >= 0 else None
        yield (
            key_of(f"contract:{dept}:{ref}"), dept, ref, _short(r["pid"], REF_MAX), bid,
            None if withheld else org_number(r["organization_id"]), withheld,
            day_of(r["contract_date"]), day_of(r["period_start"]), day_of(r["delivery_date"]),
            cents_of(r["value"]), cents_of(r["original_value"]), cents_of(r["amendment_value"]),
            _short(r["solicitation_procedure"], 8), comp, _short(r["commodity_type"], 8), _short(r["commodity_code"], 20),
            _short(r["agreement_type"], 40), _codes(r["trade_agreement"]), _codes(r["limited_tendering_reason"]),
            _short(r["instrument_type"], 8), _short(r["reporting_period"], 20), bids, _short(r["standing_offer_number"]),
            _long(r["description_en"], "en"), _long(r["description_fr"], "fr"), _long(r["comments_en"], "en"),
            _long(r["comments_fr"], "fr"),
        )


# The rows whose Indigenous business fields could say something; published_indigenous_rows reads each field.
INDIGENOUS_SQL = (
    "SELECT owner_org, reference, indigenous_business, indigenous_business_excluding_psib FROM contracts "
    "WHERE vendor_withheld = 0 AND (COALESCE(TRIM(indigenous_business), '') != '' "
    "OR COALESCE(TRIM(indigenous_business_excluding_psib), '') != '')"
)


def published_indigenous_rows(conn: sqlite3.Connection) -> Iterator[tuple]:
    """rec_contract_indigenous's rows, in CONTRACT_INDIGENOUS.written order: one per published contract row the
    site can address whose indigenous_business is a set-aside under the Procurement Strategy for Indigenous
    Business (psib MS or VS, normalize.psib_set_aside) or whose indigenous_business_excluding_psib says yes (ib
    1), keyed as its rec_contracts row. NA, N and a blank write no row. A vendor withheld as a person has none:
    the marks say something about the person.
    """
    for r in conn.execute(INDIGENOUS_SQL):
        dept, ref = str(r["owner_org"] or ""), str(r["reference"] or "")
        if not _addressable(dept, ref):
            continue
        psib = psib_set_aside(r["indigenous_business"])
        ib = 1 if indigenous_outside_psib(r["indigenous_business_excluding_psib"]) else 0
        if psib or ib:
            yield key_of(f"contract:{dept}:{ref}"), psib, ib


def gsin_rows(conn: sqlite3.Connection, codes: set[str]) -> Iterator[tuple]:
    """The names of the GSIN codes the published contracts carry, in GSIN.written order."""
    for code, en, fr in conn.execute("SELECT code, desc_en, desc_fr FROM gsin_codes ORDER BY code"):
        if code in codes:
            yield (key_of(f"gsin:{code}"), code, _short(en, 200), _short(fr, 200))


# -- tonight's rows, in temporary tables ----------------------------------------


def _now(table: Table) -> str:
    return f"records_now_{table.code}"


def value_figures(conn: sqlite3.Connection, columns: str, where: str) -> dict[tuple, tuple[int, int, int]]:
    """(count, sum, median) of the counted values above zero in tonight's records, per group of columns.

    The median of an even count is the mean of the two middle values, its
    half cent dropped. Read in one ordered pass, so no group's values are
    held beyond its own.
    """
    out: dict[tuple, tuple[int, int, int]] = {}
    group: tuple | None = None
    values: list[int] = []

    def close() -> None:
        if group is not None and values:
            n, mid = len(values), len(values) // 2
            out[group] = (n, sum(values), values[mid] if n % 2 else (values[mid - 1] + values[mid]) // 2)

    for row in conn.execute(f"SELECT {columns}, cents FROM temp.{_now(RECORDS)} WHERE {where} AND cents > 0 "
                            f"ORDER BY {columns}, cents"):
        here = tuple(row)
        if here[:-1] != group:
            close()
            group, values = here[:-1], []
        values.append(here[-1])
    close()
    return out


def add_quarters(fy: int, fq: int, n: int) -> tuple[int, int]:
    at = fy * 4 + fq - 1 + n
    return at // 4, at % 4 + 1


def quarter_end(fy: int, fq: int) -> date:
    """The last day of a fiscal quarter: June 30, September 30, December 31, then March 31 of the next year."""
    month = 4 + 3 * fq                                  # the month after the quarter, counted from January of fy
    return date(fy + (month - 1) // 12, (month - 1) % 12 + 1, 1) - timedelta(days=1)


def due_rows(conn: sqlite3.Connection, day: date, tally: _Counts) -> Iterator[tuple]:
    """rec_due's rows: the contracts ending from day to the end of the DUE_QUARTERS-th fiscal quarter, by the radar's
    own candidates and duplicate rule (expiring.py), counted per buyer and per segment by the quarter their end date
    falls in.

    The value added is the radar's counted value (Canadian dollars, not flagged); n_no_value counts the contracts
    whose source published none. The buyer is the radar row's, which the radar's buyer filter reads, so a quarter
    links to the window that lists the same contracts.
    """
    fy, fq = fiscal(day.isoformat())
    if fy is None or fq is None:
        return
    last = quarter_end(*add_quarters(fy, fq, DUE_QUARTERS - 1))
    first_day, last_day = day.isoformat(), last.isoformat()
    names = expiring._Names(conn)
    kept, _, _ = expiring.dedupe({
        "award": expiring.notice_candidates(conn, "award", names, first_day, last_day, day),
        "history": expiring.notice_candidates(conn, "history", names, first_day, last_day, day),
        "contract": expiring.contract_candidates(conn, names, first_day, last_day, day),
    })
    segments = set(read_segments())
    groups: dict[tuple, list] = {}
    for c in kept:
        row = c.row
        efy, efq = fiscal(row["end"])
        if efy is None:
            continue
        value = row["value"]
        counted = cents_of(value) if row["currency"] in (None, "CAD") and not row["value_flag"] else None
        keys = [("s", int(code)) for code in json.loads(row["segments"] or "[]") if code in segments]
        bid = tally.bid(row["buyer_id"])
        if bid is not None:
            keys.insert(0, ("b", bid))
        for kind, number in keys:
            cell = groups.setdefault((kind, number, efy, efq), [0, None, 0])
            cell[0] += 1
            if counted is not None:
                cell[1] = (cell[1] or 0) + counted
            if value is None:
                cell[2] += 1
    for (kind, number, y, q), (n, cents, no_value) in sorted(groups.items()):
        yield (key_of(f"due:{kind}:{number}:{y}:{q}"), number if kind == "b" else None, number if kind == "s" else None,
               y, q, n, cents, no_value)


def build(conn: sqlite3.Connection, today: date | None = None, static_dir: Path | None = None) -> dict:
    """Fill a temporary table per D1 table with tonight's rows and their hashes; return what was left out.

    today is the data date the contracts ending are counted from (the radar's day),
    and the one an award date after it is read against (NOTICE_DAY).
    static_dir is the static export (default data/out/static), whose 12-month
    radar window becomes rec_expiring and rec_expiring_prov, and with the lines
    stage's expiring_lines, rec_lines.
    """
    day = today or date.fromisoformat(today_iso()[:10])
    as_of = day.isoformat()
    for t in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS temp.{_now(t)}")
        conn.execute(f"CREATE TEMP TABLE {_now(t)} ({t.key} INTEGER PRIMARY KEY, {', '.join(t.columns)}, h INTEGER NOT NULL)")
    counts = _Counts()
    marks = ", ".join("?" * (len(RECORDS.written) + 1))
    # One map for records.ref and rec_details.ref, so a record table never
    # links a page the records row says the record does not have.
    refs = ref_maps(conn)

    def hashed(rows: Iterator[tuple]) -> Iterator[tuple]:
        for row in rows:
            yield (*row, row_hash(RECORDS, row[1:]))

    try:
        conn.executemany(f"INSERT INTO temp.{_now(RECORDS)} VALUES ({marks})",
                         hashed(record_rows(conn, counts, refs, as_of=as_of)))
    except sqlite3.IntegrityError:
        raise ValueError("two records have the same key; key_of needs more bits") from None

    def fill(table: Table, rows: Iterator[tuple]) -> None:
        marks = ", ".join("?" * (len(table.written) + 1))
        conn.executemany(f"INSERT INTO temp.{_now(table)} VALUES ({marks})", ((*r, row_hash(table, r[1:])) for r in rows))

    now = _now(RECORDS)
    fill(BUYER_QUARTERS, (
        (key_of(f"bq:{b}:{s}:{y}:{q}"), b, s, y, q, n, c, nv) for b, s, y, q, n, c, nv in conn.execute(
            f"SELECT bid, src, fy, fq, COUNT(*), SUM(cents), SUM(CASE WHEN vnote = {NO_VALUE} THEN 1 ELSE 0 END) "
            f"FROM temp.{now} WHERE extra = 0 AND bid IS NOT NULL AND fy IS NOT NULL GROUP BY bid, src, fy, fq").fetchall()))
    # The median and average of each segment year count every row, extra or
    # not, as its other figures do; a buyer's, the rows with extra = 0.
    seg_values = value_figures(conn, "sid, src, fy", "sid IS NOT NULL AND fy IS NOT NULL")
    fill(SEGMENT_YEARS, (
        (key_of(f"sy:{g}:{s}:{y}"), g, s, y, n, c, nv, nb, no, *seg_values.get((g, s, y), (0, None, None)))
        for g, s, y, n, c, nv, nb, no in conn.execute(
            f"SELECT sid, src, fy, COUNT(*), SUM(cents), SUM(CASE WHEN vnote = {NO_VALUE} THEN 1 ELSE 0 END), "
            f"COUNT(DISTINCT bid), COUNT(DISTINCT oid) FROM temp.{now} WHERE sid IS NOT NULL AND fy IS NOT NULL "
            "GROUP BY sid, src, fy").fetchall()))
    fill(BUYER_YEARS, (
        (key_of(f"by:{b}:{s}:{y}"), b, s, y, n, pos, med) for (b, s, y), (n, pos, med) in sorted(
            value_figures(conn, "bid, src, fy", "extra = 0 AND bid IS NOT NULL AND fy IS NOT NULL").items())))
    # Before the buyers' names, so a buyer named only by a contract ending has its row in rec_buyers.
    fill(DUE, due_rows(conn, day, counts))
    named = {r[0] for r in conn.execute(f"SELECT DISTINCT oid FROM temp.{now} WHERE oid IS NOT NULL")}
    orgs = []
    for oid_text, name in conn.execute("SELECT id, display_name FROM organizations"):
        number = org_number(oid_text)
        if number in named:
            orgs.append((number, re.sub(r"\s+", " ", name or "").strip() or oid_text))
            named.discard(number)
    # A record naming an organization the table lacks (it cannot, through the
    # foreign key) would still show its id rather than nothing.
    orgs.extend((number, org_id(number)) for number in sorted(named))
    fill(ORGS, iter(orgs))
    names = {r[0]: (r[1], r[2]) for r in conn.execute("SELECT id, name_en, name_fr FROM buyers")}
    buyers = []
    for bid, text in sorted(counts.buyers.items()):
        en, fr = names.get(text, (None, None))
        buyers.append((bid, text, en or text, fr))
    fill(BUYERS, iter(buyers))

    # The text beside each record's figures, joined to tonight's row of the
    # record by its key, so the copied figures are the charts' own. A record
    # with no date, or naming neither a buyer nor an organization, is in no
    # table a page reads, and is left out.
    conn.execute("DROP TABLE IF EXISTS temp.records_text_now")
    conn.execute("CREATE TEMP TABLE records_text_now (k INTEGER PRIMARY KEY, day TEXT, ref TEXT, title_en TEXT, title_fr TEXT, "
                 "classes TEXT)")
    try:
        conn.executemany("INSERT INTO temp.records_text_now VALUES (?, ?, ?, ?, ?, ?)",
                         text_rows(conn, refs=refs, as_of=as_of))
    except sqlite3.IntegrityError:
        raise ValueError("two records have the same key; key_of needs more bits") from None
    joined = (f"FROM temp.{now} r JOIN temp.records_text_now t ON t.k = r.k WHERE r.extra = 0 "
              "AND (r.bid IS NOT NULL OR r.oid IS NOT NULL)")
    fill(DETAILS, (tuple(r) for r in conn.execute(
        f"SELECT r.k, r.src, t.day, r.bid, r.oid, r.cents, r.vnote, r.comp, r.meth, t.ref, t.title_en, t.title_fr {joined}")))
    sources = ", ".join(str(s) for s in CLASS_SOURCES)
    fill(CLASSES, (
        (key_of(f"class:{k}:{cls}"), k, int(cls), bid, day) for k, bid, day, classes in conn.execute(
            f"SELECT r.k, r.bid, t.day, t.classes {joined} AND r.bid IS NOT NULL AND r.src IN ({sources}) "
            "AND t.classes IS NOT NULL")
        for cls in classes.split()))
    conn.execute("DROP TABLE IF EXISTS temp.records_text_now")
    window = list(expiring_rows(static_dir or config.OUT_DIR / "static"))
    if len({r[0] for r in window}) != len(window):
        raise ValueError("two rows of the radar's window have the same kind and reference")
    fill(EXPIRING, iter(window))
    fill(EXPIRING_PROV, expiring_province_rows(window))

    # The published contracts' pages, and the names of the GSIN codes they carry.
    left_out = {"grants_withheld": counts.grants_withheld, "bad_buyers": counts.bad_buyers}
    # The holder's record of each window row the lines stage counted (lines.py).
    fill(LINES, lines_rows(conn, window, left_out))
    try:
        fill(CONTRACTS, published_rows(conn, left_out))
    except sqlite3.IntegrityError:
        raise ValueError("two published contracts have the same key; key_of needs more bits") from None
    codes = {r[0] for r in conn.execute(f"SELECT DISTINCT gsin FROM temp.{_now(CONTRACTS)} WHERE gsin IS NOT NULL")}
    fill(GSIN, gsin_rows(conn, codes))
    fill(CONTRACT_INDIGENOUS, published_indigenous_rows(conn))

    # The standing offers and supply arrangements' pages.
    tenders = RefMap(conn, "tenders")
    try:
        fill(INSTRUMENTS, sosa_export.instrument_rows(conn, key_of, org_number, tenders.get))
        fill(HOLDERS, sosa_export.holder_rows(conn, key_of, org_number))
    except sqlite3.IntegrityError:
        raise ValueError("two instruments or holders have the same key; key_of needs more bits") from None
    return left_out


# -- the events the watches follow (rec_events) ------------------------------------

EVENT_KINDS = ("award", "grant", "amended", "cancelled", "ends_12m", "ends_6m", "ended", "notice", "notice_amended",
               "notice_closed", "notice_cancelled", "notice_awarded", "instrument_gained", "instrument_lost",
               "instrument_expires_6m")
# How long an event is kept, here and in D1: the watches page reads the last
# 30 data dates, a weekly message 7, and a night whose apply failed is sent later.
EVENT_DAYS = 90
# The most days one night's events reach back when nights were missed; the
# watch mail reaches back as far (deliveries.ts SPAN_DAYS_MAX).
EVENT_SPAN_DAYS = 7
# The lines a contract's end date crosses, in days from the data date: the
# radar's 12- and 6-month windows (expiring.WINDOWS); the event's horizon.
EVENT_LINES = (("ends_12m", dict(expiring.WINDOWS)["12m"]), ("ends_6m", dict(expiring.WINDOWS)["6m"]))
# The sources whose amendments are events: award notices and PSPC history (a
# version after the first, a counted value that rose, an end date that moved)
# and the published contracts (a row joining a contract already known, or a
# row whose value rose or whose end date moved).
AMENDED_EVENT_SOURCES = (SOURCES["awards"], SOURCES["history"], SOURCES["contracts"])
_VERSIONED = (SOURCES["awards"], SOURCES["history"])
TENDER_SRC = 5
# The rows of one published contract (its versions: the department and
# procurement_id they share) an event about it is written for, so a watch on
# any version's page sees it; the page lists as many (records_tables.ts
# CONTRACT_VERSIONS_MAX).
EVENT_GROUP_ROWS = 50
# The rows one organization or buyer keeps of one kind on one data date, the
# largest values first; the rest become one count row (more) the mail and the
# page turn into "212 more, see the page".
EVENT_SUBJECT_DAY_MAX = 100
# records_event_state.src of a tender notice open on the data date.
NOTICE_STATE = 0
# The sosa stage's event kinds (sosa_events.kind) and the kinds they become here.
INSTRUMENT_EVENTS = {sosa.GAINED: "instrument_gained", sosa.LOST: "instrument_lost"}
# The one line an instrument's expiry crosses: 6 months only, since many
# instruments run for years and a 12-month line would list most of them.
INSTRUMENT_LINE = dict(expiring.WINDOWS)["6m"]
# The longest "type · regions" an instrument's row carries.
INSTRUMENT_OTHER_CHARS = 300
META_EVENTS_AT = "records_events_at"      # the data date the events were last derived for
META_EVENTS_PREV = "records_events_prev"  # the one before it: the previous night's
_URI_SAFE = "-_.!~*'()"                  # what encodeURIComponent leaves as it is
_COLUMNS = EVENTS.written


def _plus(day: str, n: int) -> str:
    return (date.fromisoformat(day) + timedelta(days=n)).isoformat()


def contract_path(dept: str, ref: str) -> str:
    """A published contract's page, as the site's contractPath writes it."""
    return f"/contracts/{quote(dept, safe=_URI_SAFE)}/{quote(ref, safe=_URI_SAFE)}"


def record_ref(src: object, ref: object) -> str | None:
    """An event's ref, the key a watch on a single record follows: 'award:<reference in URL form>',
    'history:<...>', 'contract:<department>:<reference>', 'grant:<department>:<reference>'; None without one."""
    if not isinstance(ref, str) or not ref:
        return None
    if src == SOURCES["awards"] and ":" not in ref:
        return f"award:{ref.lower()}"
    if src == SOURCES["history"] and ":" not in ref:
        return f"history:{ref.lower()}"
    if src in (SOURCES["contracts"], SOURCES["grants"]) and ":" in ref:
        return f"{'contract' if src == SOURCES['contracts'] else 'grant'}:{ref}"
    return None


def event_path(src: object, ref: object, oid: object, buyer: object) -> str | None:
    """The page an event's line links: the record's own (an award notice, a PSPC record, a published contract), else
    its organization's, else its buyer's; None when there is none. A grant has no page here: its organization's."""
    if src in (SOURCES["awards"], SOURCES["history"]) and isinstance(ref, str) and ref and ":" not in ref:
        return f"/{'awards' if src == SOURCES['awards'] else 'history'}/{ref.lower()}"
    if src == SOURCES["contracts"] and isinstance(ref, str) and ":" in ref:
        dept, reference = ref.split(":", 1)
        if dept and reference:
            return contract_path(dept, reference)
    if isinstance(oid, int):
        return f"/organizations/{org_id(oid)}"
    if isinstance(buyer, str) and buyer:
        return f"/buyers/{buyer}"
    return None


def _buyer_id(value: object) -> str | None:
    return value if isinstance(value, str) and BUYER_ID_RE.match(value) and len(value) <= 80 else None


def _seg(codes: object, segments: set[str]) -> int | None:
    found = sorted({c[:2] for c in str(codes or "").split() if c[:2] in segments})
    return int(found[0]) if found else None


class _Found:
    """Tonight's rows, by what they are about, before the cap and the insert."""

    def __init__(self, as_of: str) -> None:
        self.as_of = as_of
        self.rows: list[dict] = []
        self.counts = {kind: 0 for kind in EVENT_KINDS}

    def add(self, identity: str, kind: str, *, ref: str | None, path: str | None, **fields) -> None:
        if ref is None or path is None:
            return
        row = {c: None for c in _COLUMNS}
        row.update(fields, k=key_of(f"event:{identity}"), day=self.as_of, kind=kind, ref=ref, path=path)
        for c in ("endd", "oendd"):
            row[c] = day_of(row[c])
        self.rows.append(row)
        self.counts[kind] += 1


def derive_events(conn: sqlite3.Connection, as_of: str) -> dict[str, int]:
    """Tonight's events into records_events, the state they were compared with replaced by tonight's, the rows older
    than EVENT_DAYS dropped, and what is left as tonight's rec_events (its temporary table, for the stage).

    Called by sync after build, while tonight's rows sit in the temporary tables. The rules are docs/analytics.md
    "Events"; lo is the previous night's data date (at most EVENT_SPAN_DAYS back; None on the first night, which
    writes no amendment, cancellation, end date or closing, having nothing to compare with).

    Each row's key hashes what it is about (not its day), so a night derived twice, or a night whose apply failed and
    whose records are new to the ledger again, writes nothing new and keeps the day it was first found on. A data date
    earlier than the last one derived derives nothing. Returns how many of each kind were found tonight, and how many
    subjects went past the per-day cap ("capped").
    """
    at_before = get_meta(conn, META_EVENTS_AT) or None
    found = _Found(as_of)
    capped = 0
    if at_before is None or at_before <= as_of:
        prev = (get_meta(conn, META_EVENTS_PREV) or None) if at_before == as_of else at_before
        lo = max(prev, _plus(as_of, -EVENT_SPAN_DAYS)) if prev else None
        segments = set(read_segments())
        _fill_ends(conn)
        joined = _published_events(conn, found)
        _record_events(conn, found, joined)
        if lo is not None and lo < as_of:
            _crossing_events(conn, found, lo, as_of, segments)
            _ended_events(conn, found, lo, as_of)
        opened = _notice_events(conn, found, lo or _plus(as_of, -1), as_of, segments, compare=lo is not None)
        _replace_state(conn, opened)
        _instrument_events(conn, found, lo, as_of)
        rows, capped = _capped(found.rows)
        conn.executemany(f"INSERT OR IGNORE INTO records_events ({', '.join(_COLUMNS)}) VALUES ({', '.join('?' * len(_COLUMNS))})",
                         [tuple(r[c] for c in _COLUMNS) for r in rows])
        conn.execute("DELETE FROM records_events WHERE day <= ?", (_plus(as_of, -EVENT_DAYS),))
        if at_before != as_of:
            set_meta(conn, META_EVENTS_PREV, at_before or "")
            set_meta(conn, META_EVENTS_AT, as_of)
        conn.execute("DROP TABLE IF EXISTS temp.records_ends_now")
    now = f"temp.{_now(EVENTS)}"
    conn.execute(f"DELETE FROM {now}")
    conn.executemany(f"INSERT INTO {now} VALUES ({', '.join('?' * (len(_COLUMNS) + 1))})", (
        (*r, row_hash(EVENTS, r[1:])) for r in map(tuple, conn.execute(f"SELECT {', '.join(_COLUMNS)} FROM records_events ORDER BY k"))))
    return {**found.counts, "capped": capped}


def _capped(rows: list[dict]) -> tuple[list[dict], int]:
    """At most EVENT_SUBJECT_DAY_MAX rows of one kind for one organization or buyer, the largest values first; past
    that the row loses that subject (it still serves a watch on the record itself) and one count row says how many."""
    out = list(rows)
    capped = 0
    for column in ("oid", "buyer"):
        groups: dict[tuple, list[dict]] = {}
        for r in out:
            if r[column] is not None and r["more"] is None:
                groups.setdefault((r["kind"], r[column]), []).append(r)
        for (kind, subject), members in sorted(groups.items(), key=lambda kv: (kv[0][0], str(kv[0][1]))):
            if len(members) <= EVENT_SUBJECT_DAY_MAX:
                continue
            capped += 1
            members.sort(key=lambda r: (-(r["cents"] or 0), r["k"]))
            for r in members[EVENT_SUBJECT_DAY_MAX:]:
                r[column] = None
            row = {c: None for c in _COLUMNS}
            page = f"/organizations/{org_id(subject)}" if column == "oid" else f"/buyers/{subject}"
            row.update(k=key_of(f"event:count:{members[0]['day']}:{kind}:{column}:{subject}"), day=members[0]["day"], kind=kind,
                       ref=f"count:{kind}:{subject}", path=page, more=len(members) - EVENT_SUBJECT_DAY_MAX, **{column: subject})
            out.append(row)
    return out, capped


def _fill_ends(conn: sqlite3.Connection) -> None:
    """temp.records_ends_now: each award notice's and PSPC history record's newest end date and whether that version
    is cancelled, each grant's end, keyed as its records row, so the events read them by key."""
    conn.execute("DROP TABLE IF EXISTS temp.records_ends_now")
    conn.execute("CREATE TEMP TABLE records_ends_now (k INTEGER PRIMARY KEY, endd TEXT, cancelled INTEGER NOT NULL)")

    def rows() -> Iterator[tuple]:
        for kind, table in (("award", "awards"), ("history", "contract_history")):
            for r in conn.execute(f"WITH newest AS ({_A._newest_by_reference(table, ('reference',))}) "
                                  'SELECT reference, "end" AS endd, COALESCE(status, \'\') = \'cancelled\' AS cancelled FROM newest'):
                yield key_of(f"{kind}:{r['reference']}"), day_of(r["endd"]), 1 if r["cancelled"] else 0
        for r in conn.execute(f"WITH newest AS ({_A._newest_by_reference('grants', ('owner_org', 'reference'))}) "
                              'SELECT owner_org, reference, "end" AS endd FROM newest'):
            yield key_of(f"grant:{r['owner_org']}:{r['reference']}"), day_of(r["endd"]), 0

    conn.executemany("INSERT OR REPLACE INTO temp.records_ends_now VALUES (?, ?, ?)", rows())
    conn.execute(f"INSERT OR REPLACE INTO temp.records_ends_now SELECT k, endd, 0 FROM temp.{_now(CONTRACTS)}")


def _group(conn: sqlite3.Connection, dept: str, pid: object, k: int, ref: str, known: bool) -> list[tuple[int, str]]:
    """The rows of one published contract (a department and procurement_id; a row with none stands alone), oldest
    first, at most EVENT_GROUP_ROWS; with known, only the rows of the previous night's state."""
    if pid is None:
        return [(k, ref)]
    join = "JOIN records_event_state s ON s.k = o.k " if known else ""
    return [(r[0], r[1]) for r in conn.execute(
        f"SELECT o.k, o.ref FROM temp.{_now(CONTRACTS)} o {join}WHERE o.dept = ? AND o.pid = ? ORDER BY o.cdate, o.ref LIMIT ?",
        (dept, pid, EVENT_GROUP_ROWS))]


def _published_events(conn: sqlite3.Connection, found: _Found) -> set[int]:
    """amended, for the published contracts; returns the rows new tonight that joined a contract already known."""
    c, buyers = f"temp.{_now(CONTRACTS)}", f"temp.{_now(BUYERS)}"
    conn.execute(f"CREATE INDEX IF NOT EXISTS temp.{_now(CONTRACTS)}_group ON {_now(CONTRACTS)} (dept, pid)")
    conn.execute(f"CREATE INDEX IF NOT EXISTS temp.{_now(CONTRACTS)}_ref ON {_now(CONTRACTS)} (dept, ref)")
    src = SOURCES["contracts"]

    def fan(identity: str, r: sqlite3.Row, targets: list[tuple[int, str]], ocents: object, oendd: object) -> None:
        for i, (tk, tref) in enumerate(targets):
            found.add(f"{identity}:{tk}", "amended", ref=f"contract:{r['dept']}:{tref}", path=contract_path(r["dept"], r["ref"]),
                      src=src, oid=r["oid"] if i == 0 else None, buyer=r["buyer"] if i == 0 else None, cents=r["value"],
                      ocents=ocents, endd=r["endd"], oendd=oendd, title=title_of(r["desc_en"], None),
                      title_fr=title_of(r["desc_fr"], None))

    head = (f"SELECT c.k, c.dept, c.ref, c.pid, c.oid, b.id AS buyer, c.value, c.endd, c.desc_en, c.desc_fr, c.cdate FROM {c} c "
            f"LEFT JOIN {buyers} b ON b.bid = c.bid ")
    # A row whose value as published rose, or whose end date moved, since the previous night.
    for r in conn.execute(
            head.replace("c.cdate FROM", "c.cdate, s.cents AS ocents, s.endd AS oendd FROM") +
            "JOIN records_event_state s ON s.k = c.k AND s.src = ? "
            "WHERE c.value > s.cents OR (c.endd IS NOT NULL AND s.endd IS NOT NULL AND c.endd <> s.endd) ORDER BY c.k", (src,)).fetchall():
        fan(f"amended:{r['k']}:{r['value']}:{r['endd']}", r, _group(conn, r["dept"], r["pid"], r["k"], r["ref"], False), r["ocents"],
            r["oendd"] if r["oendd"] and r["endd"] and r["oendd"] != r["endd"] else None)
    # A row new tonight joining a contract the previous night knew: the contract gained a version.
    joined: set[int] = set()
    for r in conn.execute(
            head + "WHERE c.pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM records_event_state s WHERE s.k = c.k) "
            f"AND EXISTS (SELECT 1 FROM {c} o JOIN records_event_state s ON s.k = o.k WHERE o.dept = c.dept AND o.pid = c.pid) "
            "ORDER BY c.k").fetchall():
        joined.add(r["k"])
        before = conn.execute(
            f"SELECT o.value, o.endd FROM {c} o JOIN records_event_state s ON s.k = o.k WHERE o.dept = ? AND o.pid = ? "
            "ORDER BY o.cdate DESC, o.ref DESC LIMIT 1", (r["dept"], r["pid"])).fetchone()
        fan(f"amended:{r['k']}", r, _group(conn, r["dept"], r["pid"], r["k"], r["ref"], True), before[0],
            before[1] if before[1] and r["endd"] and before[1] != r["endd"] else None)
    return joined


def _record_events(conn: sqlite3.Connection, found: _Found, joined: set[int]) -> None:
    """award and grant, for the records new to the ledger; amended and cancelled, for the award notices and PSPC
    history against the state."""
    n, buyers, details = f"temp.{_now(RECORDS)}", f"temp.{_now(BUYERS)}", f"temp.{_now(DETAILS)}"
    columns = ("n.k, n.src, n.oid, b.id AS buyer, n.sid, n.cents, n.namd, n.ref, COALESCE(d.title_en, n.title) AS title_en, "
               "d.title_fr, d.day, e.endd, e.cancelled")
    joins = (f"FROM {n} n LEFT JOIN {buyers} b ON b.bid = n.bid LEFT JOIN {details} d ON d.k = n.k "
             "LEFT JOIN temp.records_ends_now e ON e.k = n.k ")
    if conn.execute("SELECT EXISTS (SELECT 1 FROM records_ledger WHERE t = ?)", (RECORDS.code,)).fetchone()[0]:
        for r in conn.execute(
                f"SELECT {columns} {joins}WHERE n.extra = 0 AND (n.oid IS NOT NULL OR n.bid IS NOT NULL) "
                "AND NOT EXISTS (SELECT 1 FROM records_ledger l WHERE l.t = ? AND l.k = n.k) ORDER BY n.k", (RECORDS.code,)).fetchall():
            if r["k"] in joined:
                continue
            kind = "grant" if r["src"] == SOURCES["grants"] else "award"
            found.add(f"award:{r['k']}", kind, ref=record_ref(r["src"], r["ref"]), path=event_path(r["src"], r["ref"], r["oid"], r["buyer"]),
                      src=r["src"], oid=r["oid"], buyer=r["buyer"], sid=r["sid"], cents=r["cents"], endd=r["endd"],
                      title=title_of(r["title_en"], None), title_fr=title_of(r["title_fr"], None))
    versioned = ", ".join(str(v) for v in _VERSIONED)
    for r in conn.execute(
            f"SELECT {columns}, s.cents AS ocents, s.n AS onamd, s.endd AS oendd {joins}"
            "JOIN records_event_state s ON s.k = n.k AND s.src = n.src "
            f"WHERE n.extra = 0 AND n.src IN ({versioned}) AND (n.oid IS NOT NULL OR n.bid IS NOT NULL) "
            "AND (n.namd > s.n OR n.cents > s.cents OR (e.endd IS NOT NULL AND s.endd IS NOT NULL AND e.endd <> s.endd)) "
            "ORDER BY n.k").fetchall():
        kind = "cancelled" if r["cancelled"] and r["namd"] > (r["onamd"] or 0) else "amended"
        found.add(f"{kind}:{r['k']}:{r['namd']}:{r['cents']}:{r['endd']}", kind, ref=record_ref(r["src"], r["ref"]),
                  path=event_path(r["src"], r["ref"], r["oid"], r["buyer"]), src=r["src"], oid=r["oid"], buyer=r["buyer"],
                  sid=r["sid"], cents=None if kind == "cancelled" else r["cents"], ocents=r["ocents"], endd=r["endd"],
                  oendd=r["oendd"] if r["oendd"] and r["endd"] and r["oendd"] != r["endd"] else None, namd=r["namd"], title=title_of(r["title_en"], None),
                  title_fr=title_of(r["title_fr"], None))


def _crossing_events(conn: sqlite3.Connection, found: _Found, lo: str, as_of: str, segments: set[str]) -> None:
    """ends_12m and ends_6m, from tonight's radar window."""
    kinds = {number: name for name, number in EXPIRING_KINDS.items()}
    for kind, days in EVENT_LINES:
        for r in conn.execute(
                f"SELECT k, endd, oid, buyer, kind, segs, cad, j FROM temp.{_now(EXPIRING)} WHERE endd > ? AND endd <= ? ORDER BY k",
                (_plus(lo, days), _plus(as_of, days))).fetchall():
            row = json.loads(r["j"])
            reference = str(row.get("reference") or "")
            common = dict(src=r["kind"], cents=r["cad"], endd=r["endd"], horizon=days, sid=_seg(r["segs"], segments),
                          title=title_of(row.get("title_en"), None), title_fr=title_of(row.get("title_fr"), None),
                          other=row.get("organization"))
            identity = f"{kind}:{r['k']}:{r['endd']}"
            if kinds.get(r["kind"]) != "contract":
                found.add(identity, kind, ref=record_ref(r["kind"], reference), oid=r["oid"], buyer=r["buyer"],
                          path=event_path(r["kind"], reference, r["oid"], r["buyer"]), **common)
                continue
            dept, _, ref = reference.partition(":")
            if not dept or not ref:
                continue
            own = conn.execute(f"SELECT k, pid FROM temp.{_now(CONTRACTS)} WHERE dept = ? AND ref = ?", (dept, ref)).fetchone()
            targets = _group(conn, dept, own["pid"], own["k"], ref, False) if own else [(0, ref)]
            for i, (tk, tref) in enumerate(targets):
                found.add(f"{identity}:{tk}", kind, ref=f"contract:{dept}:{tref}", path=contract_path(dept, ref),
                          oid=r["oid"] if i == 0 else None, buyer=r["buyer"] if i == 0 else None, **common)


def _ended_events(conn: sqlite3.Connection, found: _Found, lo: str, as_of: str) -> None:
    """ended: the radar's own candidates (newest version's end date, not cancelled, each contract once across the
    three sources) whose end date is on or after lo and before as_of: the last day in force passed since the
    previous night."""
    names = expiring._Names(conn)
    first, last = lo, _plus(as_of, -1)
    day = date.fromisoformat(as_of)
    kept, _, _ = expiring.dedupe({
        "award": expiring.notice_candidates(conn, "award", names, first, last, day),
        "history": expiring.notice_candidates(conn, "history", names, first, last, day),
        "contract": expiring.contract_candidates(conn, names, first, last, day),
    })
    urls = ref_maps(conn)
    for cand in sorted(kept, key=lambda x: x.source_key):
        row = cand.row
        src = EXPIRING_KINDS[cand.kind]
        if cand.kind == "contract":
            ref = cand.reference
        else:
            ref = urls["awards" if cand.kind == "award" else "history"].get(cand.reference)
        oid = None if row.get("supplier_withheld") else org_number(row.get("organization_id"))
        buyer = _buyer_id(row.get("buyer_id"))
        currency = str(row.get("currency") or "").upper()
        found.add(f"ended:{cand.source_key}:{row['end']}", "ended", ref=record_ref(src, ref), path=event_path(src, ref, oid, buyer),
                  src=src, oid=oid, buyer=buyer, cents=cents_of(row.get("value")) if currency in ("", "CAD") else None,
                  endd=row["end"], title=title_of(row.get("title_en"), None), title_fr=title_of(row.get("title_fr"), None),
                  other=row.get("organization"))


def _notice_events(conn: sqlite3.Connection, found: _Found, lo: str, as_of: str, segments: set[str], *, compare: bool) -> list[int]:
    """notice and notice_amended, for the versions first seen after lo; notice_closed and notice_cancelled, against the
    state; notice_awarded, for the award notices first seen after lo whose solicitation is a notice's. Returns the keys
    of the notices open on as_of, tonight's state."""
    urls = RefMap(conn, "tenders")
    first, last = _plus(lo, 1), _plus(as_of, 1)
    newest = ("SELECT t.reference, t.amendment, t.title_en, t.title_fr, t.buyer_id, t.closing, t.published, t.status, "
              "(SELECT MIN(z.first_seen) FROM tenders z WHERE z.reference = t.reference) AS first_sight, "
              "(SELECT group_concat(c.unspsc, ' ') FROM tender_codes c WHERE c.reference = t.reference AND c.amendment = t.amendment) AS codes, "
              "(SELECT p.closing FROM tenders p WHERE p.reference = t.reference AND p.amendment < t.amendment ORDER BY p.amendment DESC LIMIT 1) AS oclosing, "
              "(SELECT p.title_en FROM tenders p WHERE p.reference = t.reference AND p.amendment < t.amendment ORDER BY p.amendment DESC LIMIT 1) AS otitle "
              "FROM tenders t WHERE t.amendment = (SELECT MAX(y.amendment) FROM tenders y WHERE y.reference = t.reference)")
    for r in conn.execute(newest + " AND t.reference IN (SELECT reference FROM tenders WHERE first_seen >= ? AND first_seen < ?) "
                          "ORDER BY t.reference", (first, last)).fetchall():
        url = urls.get(r["reference"])
        if url is None:
            continue
        sight = day_of(r["first_sight"]) or as_of
        buyer = _buyer_id(r["buyer_id"])
        common = dict(src=TENDER_SRC, sid=_seg(r["codes"], segments), closing=r["closing"], title=title_of(r["title_en"], None),
                      title_fr=title_of(r["title_fr"], None), namd=r["amendment"])
        if sight >= first:
            published = day_of(r["published"])
            if buyer is None or (published is not None and published < _plus(sight, -NEW_LAG_DAYS)):
                continue
            found.add(f"notice:{r['reference']}", "notice", ref=f"tender:{url.lower()}", path=f"/tenders/{url.lower()}", buyer=buyer, **common)
        else:
            moved = r["oclosing"] if r["oclosing"] != r["closing"] else None
            retitled = r["otitle"] if (r["otitle"] or "") != (r["title_en"] or "") else None
            found.add(f"notice_amended:{r['reference']}:{r['amendment']}", "notice_amended", ref=f"tender:{url.lower()}",
                      path=f"/tenders/{url.lower()}", buyer=buyer, oclosing=moved, other=title_of(retitled, None), **common)
    open_before = {k for (k,) in conn.execute("SELECT k FROM records_event_state WHERE src = ?", (NOTICE_STATE,))}
    opened: list[int] = []
    for r in conn.execute(newest + " ORDER BY t.reference").fetchall():
        k = key_of(f"notice:{r['reference']}")
        status = tender_status_on(r["status"], r["closing"], as_of)
        if status == "open":
            opened.append(k)
        elif compare and k in open_before and (url := urls.get(r["reference"])) is not None:
            kind = "notice_cancelled" if status == "cancelled" else "notice_closed"
            found.add(f"{kind}:{r['reference']}", kind, ref=f"tender:{url.lower()}", path=f"/tenders/{url.lower()}", src=TENDER_SRC,
                      closing=r["closing"], title=title_of(r["title_en"], None), title_fr=title_of(r["title_fr"], None))
    # An award notice first seen tonight whose solicitation a notice carries: the notice was awarded, to its supplier.
    conn.execute("DROP TABLE IF EXISTS temp.records_solicitations")
    conn.execute("CREATE TEMP TABLE records_solicitations AS SELECT UPPER(TRIM(solicitation)) AS sol, MIN(reference) AS reference "
                 "FROM tenders WHERE solicitation IS NOT NULL AND TRIM(solicitation) <> '' GROUP BY UPPER(TRIM(solicitation))")
    conn.execute("CREATE INDEX temp.records_solicitations_sol ON records_solicitations (sol)")
    seen: set[str] = set()
    for r in conn.execute(
            "SELECT a.reference, a.solicitation, a.supplier_withheld, o.display_name AS winner, s.reference AS tender, "
            "CASE WHEN a.total_value > 0 THEN a.total_value ELSE a.amount END AS v, a.currency FROM awards a JOIN records_solicitations s ON s.sol = UPPER(TRIM(a.solicitation)) "
            "LEFT JOIN organizations o ON o.id = a.organization_id WHERE a.amendment = 0 AND a.first_seen >= ? AND a.first_seen < ? "
            "ORDER BY s.reference, a.reference", (first, last)).fetchall():
        url = urls.get(r["tender"])
        if url is None or r["tender"] in seen:
            continue
        seen.add(r["tender"])
        currency = str(r["currency"] or "").upper()
        found.add(f"notice_awarded:{r['tender']}", "notice_awarded", ref=f"tender:{url.lower()}", path=f"/tenders/{url.lower()}",
                  src=TENDER_SRC, other=None if r["supplier_withheld"] else r["winner"],
                  cents=cents_of(r["v"]) if currency in ("", "CAD") else None,
                  title=title_of(conn.execute("SELECT title_en FROM tenders WHERE reference = ? ORDER BY amendment DESC LIMIT 1",
                                              (r["tender"],)).fetchone()[0], None))
    conn.execute("DROP TABLE IF EXISTS temp.records_solicitations")
    return opened


def _instrument_other(kind: object, places: list[str]) -> str | None:
    """'Regional Master Standing Offer · British Columbia': the agreement type and the regions' names."""
    parts = [p for p in (re.sub(r"\s+", " ", str(kind or "")).strip(), ", ".join(places)) if p]
    return sosa_export.short(" · ".join(parts), INSTRUMENT_OTHER_CHARS) if parts else None


def _instrument_events(conn: sqlite3.Connection, found: _Found, lo: str | None, as_of: str) -> None:
    """instrument_gained and instrument_lost, from sosa_events: the sosa stage compares each week's file with the
    last one applied and writes neither on its first file (nor a loss before its second), so this step only carries
    its rows over, each once. A row is read while it is younger than EVENT_DAYS and taken when records_events does
    not hold it yet: its day is the file's publication date, which can be earlier than the previous night (a held
    file released later), so the previous night's date cannot select them. instrument_expires_6m: an active
    instrument whose expiry is after lo plus INSTRUMENT_LINE days and on or before the data date plus them, once per
    holder organization. Rows name the organization (oid), ref 'sosa:<agreement>', the expiry (endd), the
    description (title), the type and region (other), and link the instrument's page."""
    info = {r["agreement_number"]: r for r in conn.execute(
        "SELECT agreement_number, type_en, type_fr, description_en, description_fr, expiry FROM sosa_instruments")}
    known = {k for (k,) in conn.execute(
        f"SELECT k FROM records_events WHERE kind IN ({', '.join('?' * len(INSTRUMENT_EVENTS))})", tuple(INSTRUMENT_EVENTS.values()))}

    def add(identity: str, kind: str, agreement: str, number: int, endd: object, en: list[str], fr: list[str], **more) -> None:
        inst = info.get(agreement)
        # The type's names, not the acronym the file writes ("NISO"), so the watch mail reads in either language.
        type_en, type_fr = sosa.type_names(inst["type_en"], inst["type_fr"]) if inst else (None, None)
        found.add(identity, kind, ref=f"sosa:{agreement}", path=sosa_export.instrument_path(agreement), oid=number,
                  endd=endd or (inst["expiry"] if inst else None),
                  title=title_of(inst["description_en"], None) if inst else None,
                  title_fr=title_of(inst["description_fr"], None) if inst else None,
                  other=_instrument_other(type_en, [sosa.unquote(x) for x in en]),
                  other_fr=_instrument_other(type_fr, [sosa.unquote(x) for x in fr]), **more)

    marks = ", ".join("?" * len(INSTRUMENT_EVENTS))
    for r in conn.execute(
            "SELECT e.kind, e.day, e.ref, e.oid, e.region, e.endd, "
            "(SELECT h.delivery_point_en FROM sosa_holders h WHERE h.agreement_number = substr(e.ref, 6) "
            "AND h.delivery_point_code = e.region AND h.organization_id = e.oid LIMIT 1) AS region_en, "
            "(SELECT h.delivery_point_fr FROM sosa_holders h WHERE h.agreement_number = substr(e.ref, 6) "
            "AND h.delivery_point_code = e.region AND h.organization_id = e.oid LIMIT 1) AS region_fr "
            f"FROM sosa_events e WHERE e.kind IN ({marks}) AND e.day > ? ORDER BY e.id",
            (*INSTRUMENT_EVENTS, _plus(as_of, -EVENT_DAYS))).fetchall():
        kind = INSTRUMENT_EVENTS[r["kind"]]
        agreement = str(r["ref"])[len("sosa:"):]
        number = org_number(r["oid"])
        identity = f"{kind}:{r['ref']}:{r['oid']}:{r['region']}:{r['day']}"
        if number is None or not sosa_export.addressable(agreement) or key_of(f"event:{identity}") in known:
            continue
        en = r["region_en"] or r["region"]
        add(identity, kind, agreement, number, r["endd"], [en], [r["region_fr"] or en])
    if lo is None or lo >= as_of:
        return
    held: dict[tuple[str, str], tuple[str, list[str], list[str]]] = {}
    for r in conn.execute(
            "SELECT h.agreement_number AS agreement, h.organization_id AS oid, h.delivery_point_code AS region, "
            "h.delivery_point_en AS en, h.delivery_point_fr AS fr, i.expiry FROM sosa_holders h "
            "JOIN sosa_instruments i ON i.agreement_number = h.agreement_number "
            "WHERE h.lost_on IS NULL AND h.organization_id IS NOT NULL AND i.expiry > ? AND i.expiry <= ? "
            "ORDER BY h.agreement_number, h.organization_id, h.delivery_point_code",
            (_plus(lo, INSTRUMENT_LINE), _plus(as_of, INSTRUMENT_LINE))):
        expiry, en, fr = held.setdefault((r["agreement"], r["oid"]), (r["expiry"], [], []))
        name_en = r["en"] or r["region"]
        if name_en and name_en not in en:
            en.append(name_en)
            fr.append(r["fr"] or name_en)
    for (agreement, oid), (expiry, en, fr) in held.items():
        number = org_number(oid)
        if number is None or not sosa_export.addressable(agreement):
            continue
        add(f"instrument_expires_6m:{agreement}:{oid}:{expiry}", "instrument_expires_6m", agreement, number, expiry, en, fr,
            horizon=INSTRUMENT_LINE)


def _replace_state(conn: sqlite3.Connection, opened: list[int]) -> None:
    """records_event_state := tonight's award notices and PSPC history records (versions, value, end date), published
    contract rows (value and end date as published) and open notices."""
    conn.execute("DELETE FROM records_event_state")
    versioned = ", ".join(str(v) for v in _VERSIONED)
    conn.execute(f"INSERT OR REPLACE INTO records_event_state (k, src, n, cents, endd) SELECT n.k, n.src, n.namd, n.cents, e.endd "
                 f"FROM temp.{_now(RECORDS)} n LEFT JOIN temp.records_ends_now e ON e.k = n.k WHERE n.extra = 0 AND n.src IN ({versioned})")
    conn.execute(f"INSERT OR REPLACE INTO records_event_state (k, src, n, cents, endd) SELECT k, ?, NULL, value, endd "
                 f"FROM temp.{_now(CONTRACTS)}", (SOURCES["contracts"],))
    conn.executemany("INSERT OR REPLACE INTO records_event_state (k, src, n, cents) VALUES (?, ?, 1, NULL)",
                     ((k, NOTICE_STATE) for k in opened))


# -- the plan --------------------------------------------------------------------


def _days_between(earlier: str, later: str) -> int | None:
    try:
        return (date.fromisoformat(later[:10]) - date.fromisoformat(earlier[:10])).days
    except ValueError:
        return None


def full_reason(conn: sqlite3.Connection, *, requested: bool = False, ledger_empty: bool = False,
                today: str | None = None) -> str:
    """Why tonight's sync is a full reload, or "" when it is not."""
    if requested:
        return "requested"
    # Tables of another form take no upsert of this one's columns, so the wait
    # between full loads does not apply: without the reload every night fails.
    # A database whose loads predate the meta row holds layout 1.
    layout = get_meta(conn, META_LAYOUT) or "1"
    if layout != str(LAYOUT):
        return "first load (the ledger is empty)" if ledger_empty else \
            f"the records tables changed form (layout {layout} to {LAYOUT})"
    due = get_meta(conn, META_RELOAD)
    if ledger_empty:
        why = "first load (the ledger is empty)"
    elif due:
        why = f"the row counts read back from D1 disagreed on {due}"
    else:
        return ""
    last = get_meta(conn, META_FULL_AT)
    days = _days_between(last, today or today_iso()) if last else None
    return why if days is None or days >= RELOAD_MIN_DAYS else ""


def stage(conn: sqlite3.Connection, reason: str) -> dict[str, dict[str, int]]:
    """records_staged := tonight's differences from the ledger (all of tonight's rows on a full reload).

    A row is staged with its hash when its key is new or its hash changed, and
    with a NULL hash (a delete) when the ledger holds its key and tonight does
    not. Returns the upserts and deletes per table and the rows each table
    holds afterwards.
    """
    conn.execute("DELETE FROM records_staged")
    out = {"upserts": {}, "deletes": {}, "expected": {}}
    for t in TABLES:
        now = f"temp.{_now(t)}"
        if reason:
            conn.execute(f"INSERT INTO records_staged (t, k, h) SELECT ?, {t.key}, h FROM {now}", (t.code,))
        else:
            conn.execute(
                f"INSERT INTO records_staged (t, k, h) SELECT ?, n.{t.key}, n.h FROM {now} n "
                "WHERE NOT EXISTS (SELECT 1 FROM records_ledger l WHERE l.t = ? AND l.k = n." + t.key + " AND l.h = n.h)",
                (t.code, t.code))
            conn.execute(
                f"INSERT INTO records_staged (t, k, h) SELECT l.t, l.k, NULL FROM records_ledger l WHERE l.t = ? "
                f"AND NOT EXISTS (SELECT 1 FROM {now} n WHERE n.{t.key} = l.k)", (t.code,))
        up, down = conn.execute(
            "SELECT COALESCE(SUM(h IS NOT NULL), 0), COALESCE(SUM(h IS NULL), 0) FROM records_staged WHERE t = ?",
            (t.code,)).fetchone()
        out["upserts"][t.name] = up
        out["deletes"][t.name] = down
        out["expected"][t.name] = conn.execute(f"SELECT COUNT(*) FROM {now}").fetchone()[0]
    return out


# -- the batch files ---------------------------------------------------------------


def upsert_statements(table: Table, rows, *, max_rows: int = MAX_ROWS_PER_UPSERT,
                      max_bytes: int = MAX_STATEMENT_BYTES) -> Iterator[str]:
    """The rows (values in table.written order) as multi-row upserts by key, each within max_rows and max_bytes.

    No table here has a trigger, but the upsert keeps the search sync's form:
    a row applied twice reads the same.
    """
    head = f"INSERT INTO {table.name} ({', '.join(table.written)}) VALUES "
    tail = f" ON CONFLICT ({table.key}) DO UPDATE SET {', '.join(f'{c} = excluded.{c}' for c in table.columns)};"

    def render(values: Sequence) -> str:
        if len(values) != len(table.written):
            raise ValueError(f"a {table.name} row has {len(table.written)} values, not {len(values)}")
        parts = []
        for column, value in zip(table.written, values):
            try:
                parts.append(sql_literal(value))
            except (ValueError, TypeError) as exc:
                raise ValueError(f"{table.name} row {values[0]!r}, column {column}: {exc}") from None
        return "(" + ", ".join(parts) + ")"

    return _grouped(rows, render, head, tail, max_rows, max_bytes, lambda v: f"{table.name} row {v[0]!r}")


def delete_statements(table: Table, keys, *, max_keys: int = MAX_KEYS_PER_DELETE,
                      max_bytes: int = MAX_STATEMENT_BYTES) -> Iterator[str]:
    return _grouped(keys, sql_literal, f"DELETE FROM {table.name} WHERE {table.key} IN (", ");", max_keys, max_bytes,
                    lambda k: f"{table.name} delete {k!r}")


def reset_sql(schema_path: Path | None = None) -> str:
    """The first batch of a full reload: drop the tables (their indexes go with them, at no per-row cost),
    create them again from records_schema.sql, and mark the database as loading until finish.sql."""
    drops = "".join(f"DROP TABLE IF EXISTS {t.name};\n" for t in TABLES)
    return ("-- Full reload: drop the records tables and create them again from records_schema.sql.\n" + drops
            + (schema_path or SCHEMA_PATH).read_text(encoding="utf-8")
            + "\nINSERT INTO rec_meta (key, value) VALUES ('state', 'loading') "
              "ON CONFLICT (key) DO UPDATE SET value = excluded.value;\n")


def finish_sql(as_of: str) -> str:
    """What the workflow applies after the count check: the database is ready and describes as_of."""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of):
        raise ValueError(f"{as_of!r} is not a date")
    return ("INSERT INTO rec_meta (key, value) VALUES ('state', 'ready'), ('as_of', " + sql_literal(as_of) + "), "
            "('rules', " + sql_literal(str(RULES_VERSION)) + ") ON CONFLICT (key) DO UPDATE SET value = excluded.value;\n")


def write_batches(conn: sqlite3.Connection, out_dir: Path, *, full: bool, max_bytes: int = MAX_BATCH_BYTES,
                  max_statements: int = MAX_BATCH_STATEMENTS, max_rows_per_upsert: int = MAX_ROWS_PER_UPSERT,
                  max_keys_per_delete: int = MAX_KEYS_PER_DELETE, max_statement_bytes: int = MAX_STATEMENT_BYTES,
                  schema_path: Path | None = None) -> _BatchWriter:
    """The staged rows as batch files: the reset of a full reload alone first, then the deletes, then the upserts."""
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("batch-*.sql"):
        old.unlink()
    writer = _BatchWriter(out_dir, max_bytes, max_statements)
    if full:
        writer.add(reset_sql(schema_path), "the reset batch")
        writer.flush()
    for t in TABLES:
        keys = (r[0] for r in conn.execute("SELECT k FROM records_staged WHERE t = ? AND h IS NULL ORDER BY k", (t.code,)))
        for statement in delete_statements(t, keys, max_keys=max_keys_per_delete, max_bytes=max_statement_bytes):
            writer.add(statement, f"a {t.name} delete")
    for t in TABLES:
        rows = (tuple(r) for r in conn.execute(
            f"SELECT {', '.join(f'n.{c}' for c in t.written)} FROM records_staged s JOIN temp.{_now(t)} n "
            f"ON n.{t.key} = s.k WHERE s.t = ? AND s.h IS NOT NULL ORDER BY s.k", (t.code,)))
        for statement in upsert_statements(t, rows, max_rows=max_rows_per_upsert, max_bytes=max_statement_bytes):
            writer.add(statement, f"a {t.name} upsert")
    writer.flush()
    return writer


def sync(conn: sqlite3.Connection, out_dir: Path | None = None, *, full: bool = False, today: str | None = None,
         static_dir: Path | None = None) -> dict:
    """Build, stage and write tonight's sync (the records-sync command); return the manifest.

    The ledger is not touched. The manifest, written last and in one step,
    names a plan number that records-synced holds against the stage.
    """
    out = out_dir or (config.OUT_DIR / "records")
    out.mkdir(parents=True, exist_ok=True)
    # Last night's files must not outlive a plan that fails tonight.
    for name in (MANIFEST, BATCH_LIST, FINISH):
        (out / name).unlink(missing_ok=True)
    as_of = (get_meta(conn, "data_as_of") or today or today_iso())[:10]
    finish = finish_sql(as_of)
    left_out = build(conn, date.fromisoformat(as_of), static_dir)
    events = derive_events(conn, as_of)
    ledger_empty = conn.execute("SELECT NOT EXISTS (SELECT 1 FROM records_ledger)").fetchone()[0] == 1
    reason = full_reason(conn, requested=full, ledger_empty=ledger_empty, today=today)
    staged = stage(conn, reason)
    plan = secrets.token_hex(8)
    set_meta(conn, META_PLAN, plan)
    if reason:
        set_meta(conn, META_FULL_AT, today or today_iso())
    conn.commit()
    writer = write_batches(conn, out, full=bool(reason))
    (out / FINISH).write_text(finish, encoding="utf-8")
    for t in TABLES:
        conn.execute(f"DROP TABLE IF EXISTS temp.{_now(t)}")
    manifest = {
        "generated_at": now_iso(),
        "plan": plan,
        "full": bool(reason),
        "reason": reason,
        # The form of the tables a full reload creates; records-synced keeps it (META_LAYOUT).
        "layout": LAYOUT,
        "as_of": as_of,
        "batches": writer.files,
        "bytes": writer.bytes,
        "statements": writer.statements,
        **staged,
        "expected_total": sum(staged["expected"].values()),
        "left_out": left_out,
        "events": events,
    }
    (out / BATCH_LIST).write_text("".join(f"{name}\n" for name in writer.files), encoding="utf-8")
    partial = out / (MANIFEST + ".partial")
    partial.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    partial.replace(out / MANIFEST)
    return manifest


# -- after the apply -----------------------------------------------------------------

# The statement the workflow runs for the count check: one count per table,
# each named as the table.
COUNT_SQL = "SELECT " + ", ".join(f"(SELECT COUNT(*) FROM {t.name}) AS {t.name}" for t in TABLES)


def read_manifest(path: Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("batches"), list) \
            or not isinstance(manifest.get("expected"), dict) or not isinstance(manifest.get("plan"), str):
        raise ValueError(f"{path} is not a records sync manifest")
    return manifest


def expected_counts(manifest: dict) -> dict[str, int]:
    expected = manifest.get("expected")
    if not isinstance(expected, dict) or set(expected) != {t.name for t in TABLES}:
        raise ValueError("the manifest names no row count for each records table")
    return {t.name: int(expected[t.name]) for t in TABLES}


def parse_counts(text: str) -> dict[str, int]:
    """The row counts in Wrangler's JSON answer to COUNT_SQL, by table (anything printed before the list skipped)."""
    start = text.find("[")
    if start < 0:
        raise ValueError("no JSON list in the count answer")
    data, _ = json.JSONDecoder().raw_decode(text, start)
    try:
        row = data[0]["results"][0]
        counts = {t.name: row[t.name] for t in TABLES}
    except (KeyError, IndexError, TypeError) as exc:
        raise ValueError(f"the count answer is not the shape COUNT_SQL returns ({type(exc).__name__})") from None
    for name, value in counts.items():
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError(f"the count answer gives {value!r} rows for {name}")
    return counts


def count_check(expected: dict[str, int], actual: dict[str, int]) -> str | None:
    """None when D1 holds the expected number of rows in each table, otherwise what disagrees."""
    wrong = [f"{name} holds {actual.get(name)} rows where the manifest expects {n}"
             for name, n in sorted(expected.items()) if actual.get(name) != n]
    return "; ".join(wrong) or None


def record_sync(conn: sqlite3.Connection, manifest: dict) -> dict[str, int]:
    """Move the staged entries into the ledger, once D1 holds every batch.

    The manifest's plan number must be the stage's (a manifest from another
    night, or planned against another database, records nothing), and the
    ledger must then hold exactly the manifest's expected total. A full
    reload replaces the whole ledger and records the form of the tables it
    created (META_LAYOUT). The stage is emptied, the sync logged in
    records_sync, and a reload asked for earlier is no longer due.
    """
    if manifest.get("plan") != get_meta(conn, META_PLAN):
        raise ValueError("the manifest's plan is not the one staged in this database; nothing recorded")
    expected = int(manifest["expected_total"])
    summary = {k: manifest.get(k) for k in ("generated_at", "full", "reason", "layout", "as_of", "bytes", "statements",
                                            "upserts", "deletes", "expected")}
    summary["batches"] = len(manifest.get("batches") or [])
    try:
        if manifest.get("full"):
            conn.execute("DELETE FROM records_ledger")
        upserts = conn.execute(
            "INSERT INTO records_ledger (t, k, h) SELECT t, k, h FROM records_staged WHERE h IS NOT NULL "
            "ON CONFLICT (t, k) DO UPDATE SET h = excluded.h").rowcount
        deletes = conn.execute(
            "DELETE FROM records_ledger WHERE EXISTS (SELECT 1 FROM records_staged s WHERE s.h IS NULL "
            "AND s.t = records_ledger.t AND s.k = records_ledger.k)").rowcount
        held = conn.execute("SELECT COUNT(*) FROM records_ledger").fetchone()[0]
        if held != expected:
            raise ValueError(f"the ledger would hold {held} rows where the manifest expects {expected}")
        conn.execute("DELETE FROM records_staged")
        conn.execute("DELETE FROM meta WHERE key IN (?, ?)", (META_RELOAD, META_PLAN))
        if manifest.get("full") and isinstance(manifest.get("layout"), int):
            set_meta(conn, META_LAYOUT, manifest["layout"])
        conn.execute("INSERT INTO records_sync (run_at, manifest, rows, full) VALUES (?, ?, ?, ?)",
                     (now_iso(), json.dumps(summary, separators=(",", ":"), sort_keys=True), held,
                      1 if manifest.get("full") else 0))
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    return {"recorded": upserts, "removed": deletes, "ledger": held}


def request_reload(conn: sqlite3.Connection, when: str | None = None) -> None:
    """Note that a count disagreed, so a coming sync reloads in full (see full_reason)."""
    set_meta(conn, META_RELOAD, when or today_iso())
    conn.commit()


# -- the commands ------------------------------------------------------------------


def add_parsers(sub: argparse._SubParsersAction) -> None:
    """records-sync writes the batches, the workflow applies them with Wrangler and
    reads the row counts back, records-check compares them, the workflow applies
    finish.sql, and only then records-synced records the ledger (docs/analytics.md)."""
    rs = sub.add_parser("records-sync", help="write the records database's changed rows as SQL batches and a manifest")
    rs.add_argument("--db", default=None, help="SQLite path (default data/awardwatch.sqlite)")
    rs.add_argument("--out", default=None, help="folder for the batches and manifest.json (default data/out/records)")
    rs.add_argument("--full", action="store_true", help="a full reload: drop and recreate the tables, then send every row")
    rs.add_argument("--static", default=None,
                    help="the static export, for the radar's 12-month window (default data/out/static)")
    rc = sub.add_parser("records-check", help="compare the row counts read back from D1 with the manifest")
    rc.add_argument("--manifest", required=True)
    rc.add_argument("--counts", required=True, help="Wrangler's --json answer to the count statement (COUNT_SQL)")
    rc.add_argument("--db", default=None,
                    help="SQLite path; when given, a mismatch is noted there so a coming sync reloads in full")
    rd = sub.add_parser("records-synced", help="record the staged ledger entries of a manifest whose batches were applied")
    rd.add_argument("--db", default=None, help="SQLite path (default data/awardwatch.sqlite)")
    rd.add_argument("--manifest", required=True)


def _outcome(outcome: str) -> None:
    out = config.OUT_DIR / "records"
    out.mkdir(parents=True, exist_ok=True)
    (out / OUTCOME).write_text(outcome + "\n", encoding="utf-8")


def command(args: argparse.Namespace) -> int:
    """Run one of COMMANDS. 0 on success; 1 when the counts disagree."""
    if args.command == "records-check":
        return _check(args)
    # "failed" first, replaced only by records-synced, so a night that stops
    # anywhere in between reads as failed in the run status.
    if args.command == "records-sync":
        _outcome("failed")
    conn = connect(args.db)
    try:
        if args.command == "records-sync":
            manifest = sync(conn, Path(args.out) if args.out else None, full=args.full,
                            static_dir=Path(args.static) if args.static else None)
            kind = f"full reload ({manifest['reason']})" if manifest["full"] else "changes only"
            summary = (f"records-sync: {kind}: upserts {manifest['upserts']}, deletes {manifest['deletes']}, "
                       f"{len(manifest['batches'])} batches, {manifest['bytes']} bytes, {manifest['statements']} "
                       f"statements, rows expected afterwards {manifest['expected']}, left out {manifest['left_out']}, "
                       f"events tonight {manifest['events']}")
            log.info("%s", summary)
            print(summary)
            return 0
        manifest = read_manifest(Path(args.manifest))
        counts = record_sync(conn, manifest)
        outcome = "synced" if manifest["batches"] else "nothing to send"
        log.info("records-synced: %s, ledger %s", outcome, counts)
        _outcome(outcome)
        return 0
    finally:
        conn.close()


def _check(args: argparse.Namespace) -> int:
    manifest = read_manifest(Path(args.manifest))
    actual = parse_counts(Path(args.counts).read_text(encoding="utf-8"))
    problem = count_check(expected_counts(manifest), actual)
    if problem is None:
        print(f"records-check: {actual}, as the manifest expects")
        return 0
    log.error("records-check: %s", problem)
    if args.db:
        conn = connect(args.db)
        try:
            request_reload(conn)
        finally:
            conn.close()
    return 1
