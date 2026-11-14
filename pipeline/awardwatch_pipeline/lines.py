"""The holder's record: for each contract on the radar, the holder's contracts of the same kind with the same buyer,
rebuilt whole after the expiring stage (docs/accounts.md "Holder's record").

A line is the same kind of work with the same buyer. The rules, which the Methodology page states in its own
words; site/src/lines.ts holds the same constants and tests/test_lines.py holds the two equal:

* The buyer is the radar row's client department (expiring.clients), else its own buyer. In each source a
  record's buyer is, for an award notice, its first end user matched to a buyer through buyer_names, else its
  buyer; for a PSPC contract history record, its client, else its buyer; for a published contract, its
  department.
* The kind of work is, for an award notice or a history record, the newest version's UNSPSC classes (a code's
  first six digits within the 57 segments; a code whose class digits are 00 is not one), else its families (four
  digits, likewise); for a published contract, the first CODE_CHARS letters and digits of its commodity code. A
  record with neither has no kind of work, and a row with none in any source gets no label.
* A row is counted in each source that holds it: its own, and the source of each row the duplicate rule dropped
  against it (expiring_twins) when the same organization holds that row. In each source the line is the source's
  records dated in the LINE_YEARS fiscal years ending with the data date's, whose buyer is the row's and which
  share a kind of work with the row's record in that source at the same level; cancelled notices are left out,
  and a published contract counts once per department and procurement_id, its amendment rows never as contracts
  of their own. The row's own record is always in its line. Sources are never added together.
* Held: the holder's records in the line that start on or before the row's record, the row's included; the
  first is the earliest start among them. Back to back: from the row's record, the holder's record that started
  before it and ends latest between RUN_GAP_DAYS before its start and RUN_OVERLAP_DAYS after it, then the same
  from that one, until none qualifies; two call-ups against the same standing offer never qualify. The run is 1
  plus the steps taken.
* The line in all: its records whoever held them (a supplier withheld as a person counted, never named), and how
  many other named organizations held some. How the held records were awarded: competitive, non-competitive and
  not stated, as the source records each.
* Similar names: other organizations in the line whose display name has the holder's match key
  (match_key.match_key), whose normalized name shares its first SIMILAR_PREFIX characters with the holder's, or
  which sit in one of the holder's corporate families; each is listed with its own records that start on or
  before the row's, and never added to the holder's. An opening that more than SIMILAR_GROUP_MAX holders of the
  line share is a common phrase (the harbour authorities') and lists no one; a record lists SIM_MAX names at most.

A row whose holder is withheld as a person, or not named, gets no record; nor does one with no buyer.

j is what the site reads (rec_lines.j, sent by records_db.py): the window's fiscal years, the buyer, the holder's
number, one entry per source with a kind of work, the row's own method, bids and amendments, and the similar
names. It carries no days_left, so a row goes to D1 again only when its figures change.

The review file (data/out/review/holder-lines.txt, for the operator; the workflow saves it to R2's private
review/ prefix with the other review files) gives the labels' counts by source and window, 50 rows of each label
sampled by a hash of their key, every similar-name pair, and the openings left out as common with their lines. It
names organizations and records, never an account or a reader.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
import time
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import config, expiring
from .db import log_run, now_iso
from .export_static import read_segments
from .match_key import match_key
from .organizations import _newest_by_reference
from .records_db import fiscal, method_code, org_number, title_text

log = logging.getLogger(__name__)

# The constants of the rules; site/src/lines.ts holds the same values (tests/test_lines.py compares them). Each is
# to be confirmed on production data after the first night (the review file), so each is written here once.
LINE_YEARS = 10
RUN_GAP_DAYS = 120
RUN_OVERLAP_DAYS = 60
LONG_RUN = 3
CODE_CHARS = 4
SIMILAR_PREFIX = 20
# An opening that more holders of one line share than this is a common phrase ("Harbour Authority of ..."), not one
# organization's spellings, and lists no one in that line. Set from the first production night (2026-11-13): the
# largest groups by opening were 163 harbour authorities, 21 administrations portuaires and 15 John Howard
# societies, each a body of its own; the largest that was one organization's spellings and divisions had 11.
SIMILAR_GROUP_MAX = 12
# The most similar names one record lists, those with the most records first. The site refuses a record with more
# (SIM_MAX in site/src/lines.ts), so a large corporate family cannot cost a row its record.
SIM_MAX = 50

# records.src, the numbers the site reads.
AWARDS, HISTORY, CONTRACTS = 1, 2, 3
KIND_SRC = {"award": AWARDS, "history": HISTORY, "contract": CONTRACTS}
CLASS, FAMILY, CODE = "class", "family", "code"
J_VERSION = 1
REVIEW_FILE = "holder-lines.txt"
REVIEW_SAMPLE = 50
COLUMNS = ("source_key", "j", "computed_at")


@dataclass(frozen=True)
class Rec:
    """One record of a source as a line counts it."""
    key: str                      # 'award:<reference>', 'history:<reference>', 'contract:<owner_org>:<group key>'
    src: int
    org: str | None               # None when withheld or not named
    buyer: str | None             # the record's buyer by its source's rule
    day: str | None               # the date it is dated by (the fiscal window)
    start: str | None             # its start, else its day
    end: str | None
    comp: int | None
    so: str | None                # a published call-up's standing offer number
    classes: frozenset[str]
    families: frozenset[str]
    code: str | None              # a published contract's first CODE_CHARS characters
    meth: str | None = None       # the TBS code, read for the row's own record
    bids: int | None = None
    end0: str | None = None       # the first version's end, read for the row's own record

    def kinds(self) -> tuple[str | None, frozenset[str]]:
        """(level, keys) of the record's kind of work: class, else family, else none; a published contract's code."""
        if self.src == CONTRACTS:
            return (CODE, frozenset([self.code])) if self.code else (None, frozenset())
        if self.classes:
            return CLASS, self.classes
        if self.families:
            return FAMILY, self.families
        return None, frozenset()

    def at(self, level: str) -> frozenset[str]:
        if level == CLASS:
            return self.classes
        if level == FAMILY:
            return self.families
        return frozenset([self.code]) if self.code else frozenset()


# -- the kind of work ----------------------------------------------------------------

def unspsc_keys(codes: object, segments: set[str]) -> tuple[frozenset[str], frozenset[str]]:
    """The classes and families of a version's UNSPSC codes, within the 57 segments.

    A class is a code's first six digits when its class digits (the fifth and sixth) are not 00: 43211500 gives
    432115, while 43210000 is a family's code and gives no class. A family is the first four digits when its
    family digits are not 00.
    """
    classes, families = set(), set()
    for code in str(codes or "").split():
        if not code.isdigit() or code[:2] not in segments:
            continue
        if len(code) >= 6 and code[4:6] != "00":
            classes.add(code[:6])
        if len(code) >= 4 and code[2:4] != "00":
            families.add(code[:4])
    return frozenset(classes), frozenset(families)


def commodity_key(code: object) -> str | None:
    """A published contract's kind of work: the first CODE_CHARS letters and digits of its commodity code, upper case."""
    text = re.sub(r"[^A-Z0-9]", "", str(code or "").upper())
    return text[:CODE_CHARS] if len(text) >= CODE_CHARS else None


def _day(text: object) -> str | None:
    try:
        return date.fromisoformat(str(text or "")[:10]).isoformat()
    except ValueError:
        return None


# -- the sources ---------------------------------------------------------------------

class _Notices:
    """Award notices or history records at their newest version as Recs, the buyer read by the source's rule.

    The date a record is dated by is the records database's (records_db.NOTICE_DAY): the award date, or the
    publication date when the award date falls after the data date.
    """

    def __init__(self, conn: sqlite3.Connection, src: int, names: expiring._Names, segments: set[str], as_of: str):
        self.conn, self.src, self.names, self.segments, self.as_of = conn, src, names, segments, as_of
        self.kind = "award" if src == AWARDS else "history"
        table, codes = ("awards", "award_codes") if src == AWARDS else ("contract_history", "history_codes")
        # An award notice's buyer is its first end user's when buyer_names knows the spelling (rec() reads it);
        # a history record names its client in client_id.
        buyer = ("buyer_id AS buyer, end_users_en, end_users_fr" if src == AWARDS
                 else "COALESCE(client_id, buyer_id) AS buyer, NULL AS end_users_en, NULL AS end_users_fr")
        self.base = (
            f"WITH newest AS ({_newest_by_reference(table, ('reference',))}) "
            f"SELECT reference, org, supplier_withheld AS wh, {buyer}, "
            "CASE WHEN substr(awarded, 1, 10) > :as_of THEN published ELSE awarded END AS day, start, "
            "substr(\"end\", 1, 10) AS endd, competitive, method_en, COALESCE(status, '') = 'cancelled' AS cancelled, "
            f"(SELECT group_concat(c.unspsc, ' ') FROM {codes} c WHERE c.reference = newest.reference "
            "AND c.amendment = newest.amendment) AS codes, "
            f"(SELECT substr(z.\"end\", 1, 10) FROM {table} z WHERE z.reference = newest.reference ORDER BY z.amendment "
            "LIMIT 1) AS end0 FROM newest"
        )

    def rec(self, r: sqlite3.Row) -> Rec | None:
        if r["cancelled"]:
            return None
        buyer = r["buyer"]
        if self.src == AWARDS:
            buyer = self.names.end_user(r["end_users_en"], r["end_users_fr"])[0] or buyer
        day = _day(r["day"])
        classes, families = unspsc_keys(r["codes"], self.segments)
        return Rec(f"{self.kind}:{r['reference']}", self.src, None if r["wh"] else r["org"], buyer, day,
                   _day(r["start"]) or day, _day(r["endd"]), r["competitive"] if r["competitive"] in (0, 1) else None,
                   None, classes, families, None, method_code(r["method_en"]), None, _day(r["end0"]))

    def wanted(self, refs: set[str]) -> dict[str, Rec]:
        """The records a night's rows name, by key."""
        if not refs:
            return {}
        self.conn.execute("DROP TABLE IF EXISTS temp.lines_want")
        self.conn.execute("CREATE TEMP TABLE lines_want (ref TEXT PRIMARY KEY)")
        self.conn.executemany("INSERT OR IGNORE INTO temp.lines_want VALUES (?)", ((r,) for r in refs))
        out = {}
        for r in self.conn.execute(f"{self.base} WHERE reference IN (SELECT ref FROM temp.lines_want)", {"as_of": self.as_of}):
            rec = self.rec(r)
            if rec is not None:
                out[rec.key] = rec
        self.conn.execute("DROP TABLE IF EXISTS temp.lines_want")
        return out

    def scan(self) -> Iterator[Rec]:
        for r in self.conn.execute(self.base, {"as_of": self.as_of}):
            rec = self.rec(r)
            if rec is not None:
                yield rec


# A published contract's rows, grouped as the radar groups them: by department and procurement_id, a row with none
# standing alone; oldest first within a group.
def _gk(t: str = "") -> str:
    return (f"CASE WHEN {t}procurement_id IS NOT NULL AND TRIM({t}procurement_id) != '' THEN 'p:' || {t}procurement_id "
            f"ELSE 'r:' || {t}reference END")


_GK = _gk()
_CONTRACT_COLUMNS = (f"owner_org, reference, {_GK} AS gk, contract_date, period_start, substr(delivery_date, 1, 10) AS endd, "
                     "organization_id, vendor_withheld, buyer_id, commodity_code, solicitation_procedure, competitive, "
                     "number_of_bids, standing_offer_number")
_ORDER = "ORDER BY owner_org, gk, contract_date, reference"


def _stated(rows: list[sqlite3.Row], column: str):
    """The column's value on the newest row of a group that fills it (rows oldest first)."""
    for r in reversed(rows):
        v = r[column]
        if v is not None and str(v).strip() != "":
            return v
    return None


def contract_rec(rows: list[sqlite3.Row]) -> Rec:
    """A published contract's rows (one department and group, oldest first) as one Rec: its organization, end and
    competitiveness from the newest row, as the radar reads them; its date and start from the earliest; its code,
    procedure, bids and standing offer from the newest row that fills each; its first end from the oldest row."""
    newest, first = rows[-1], rows[0]
    day = min((d for d in (_day(r["contract_date"]) for r in rows) if d), default=None)
    start = min((d for d in (_day(r["period_start"]) for r in rows) if d), default=None) or day
    bids = _stated(rows, "number_of_bids")
    so = _stated(rows, "standing_offer_number")
    return Rec(
        f"contract:{newest['owner_org']}:{newest['gk']}", CONTRACTS,
        None if newest["vendor_withheld"] else newest["organization_id"], newest["buyer_id"], day, start,
        _day(newest["endd"]), newest["competitive"] if newest["competitive"] in (0, 1) else None,
        re.sub(r"\s+", "", str(so).upper()) or None if so is not None else None, frozenset(), frozenset(),
        commodity_key(_stated(rows, "commodity_code")), method_code(_stated(rows, "solicitation_procedure")),
        bids if isinstance(bids, int) and not isinstance(bids, bool) and bids >= 0 else None, _day(first["endd"]))


def _groups(cursor: Iterable[sqlite3.Row]) -> Iterator[list[sqlite3.Row]]:
    """Consecutive rows of one department and group key."""
    group: list[sqlite3.Row] = []
    at = None
    for r in cursor:
        here = (r["owner_org"], r["gk"])
        if here != at and group:
            yield group
            group = []
        at = here
        group.append(r)
    if group:
        yield group


def contracts_wanted(conn: sqlite3.Connection, rows: set[tuple[str, str]]) -> dict[str, Rec]:
    """The published contracts a night's rows name ((owner_org, reference) of a group's newest row), as Recs keyed
    by the radar's own key ('contract:<owner_org>:<reference>')."""
    if not rows:
        return {}
    conn.execute("DROP TABLE IF EXISTS temp.lines_want_rows")
    conn.execute("CREATE TEMP TABLE lines_want_rows (owner_org TEXT, reference TEXT, PRIMARY KEY (owner_org, reference))")
    conn.executemany("INSERT OR IGNORE INTO temp.lines_want_rows VALUES (?, ?)", rows)
    groups = {(r[0], r[1]): r[2] for r in conn.execute(
        f"SELECT c.owner_org, c.reference, {_gk('c.')} FROM contracts c JOIN temp.lines_want_rows w "
        "ON w.owner_org = c.owner_org AND w.reference = c.reference")}
    conn.execute("DROP TABLE IF EXISTS temp.lines_want_groups")
    conn.execute("CREATE TEMP TABLE lines_want_groups (k TEXT PRIMARY KEY)")
    conn.executemany("INSERT OR IGNORE INTO temp.lines_want_groups VALUES (?)", ((f"{o}\x1f{g}",) for (o, _), g in groups.items()))
    recs = {(g[0]["owner_org"], g[0]["gk"]): contract_rec(g) for g in _groups(conn.execute(
        f"SELECT * FROM (SELECT {_CONTRACT_COLUMNS} FROM contracts) WHERE owner_org || char(31) || gk IN "
        f"(SELECT k FROM temp.lines_want_groups) {_ORDER}"))}
    for t in ("lines_want_rows", "lines_want_groups"):
        conn.execute(f"DROP TABLE IF EXISTS temp.{t}")
    return {f"contract:{o}:{ref}": recs[(o, g)] for (o, ref), g in groups.items() if (o, g) in recs}


def contracts_scan(conn: sqlite3.Connection) -> Iterator[Rec]:
    for group in _groups(conn.execute(f"SELECT {_CONTRACT_COLUMNS} FROM contracts {_ORDER}")):
        yield contract_rec(group)


# -- the organizations: names and similar names ------------------------------------------

# What an opening's key starts with in the index of similar names (the match key's is "k", a family's "f").
_PREFIX_KEY = "p\x1f"

class _Orgs:
    """Display names, normalized names, match keys and corporate families, read once; match keys computed when first
    asked for."""

    def __init__(self, conn: sqlite3.Connection):
        self.rows = {r[0]: (r[1] or r[0], r[2] or "") for r in conn.execute("SELECT id, display_name, norm_name FROM organizations")}
        self.families: dict[str, frozenset[str]] = {}
        held: dict[str, set[str]] = defaultdict(set)
        for family, oid in conn.execute("SELECT family, organization_id FROM organization_families"):
            held[oid].add(family)
        self.families = {oid: frozenset(f) for oid, f in held.items()}
        self.keys: dict[str, tuple[str, ...]] = {}

    def name(self, oid: str) -> str:
        return self.rows.get(oid, (oid, ""))[0]

    def similar_keys(self, oid: str) -> tuple[str, ...]:
        """What two organizations of similar names share one of: ('k', match key), ('p', the normalized name's first
        SIMILAR_PREFIX characters, when it has that many) or ('f', a corporate family)."""
        got = self.keys.get(oid)
        if got is None:
            name, norm = self.rows.get(oid, (oid, ""))
            key = match_key(name)
            out = [f"k\x1f{key.key}"] if key else []
            if len(norm) >= SIMILAR_PREFIX:
                out.append(f"{_PREFIX_KEY}{norm[:SIMILAR_PREFIX]}")
            out += [f"f\x1f{f}" for f in sorted(self.families.get(oid, ()))]
            got = self.keys[oid] = tuple(out)
        return got


class Line:
    """The records of one line (one source, buyer, level and kind of work), indexed by organization and by what
    similar names share."""

    def __init__(self, recs: Iterable[Rec], orgs: _Orgs):
        self.recs: dict[str, Rec] = {}
        for x in recs:
            self.recs.setdefault(x.key, x)
        self.by_org: dict[str, list[Rec]] = defaultdict(list)
        for x in self.recs.values():
            if x.org:
                self.by_org[x.org].append(x)
        self.similar: dict[str, set[str]] = defaultdict(set)
        for o in self.by_org:
            for k in orgs.similar_keys(o):
                self.similar[k].add(o)
        # The openings too many holders of this line share (SIMILAR_GROUP_MAX): each is taken out of the index, and
        # kept here with its holders for the review file.
        self.common: dict[str, frozenset[str]] = {}
        for k in [k for k, held in self.similar.items() if k.startswith(_PREFIX_KEY) and len(held) > SIMILAR_GROUP_MAX]:
            self.common[k[len(_PREFIX_KEY):]] = frozenset(self.similar.pop(k))


def _back_to_back(held: list[Rec], own: Rec) -> int:
    """1 plus the steps back from own through the holder's records, each the one ending latest between RUN_GAP_DAYS
    before the current one's start and RUN_OVERLAP_DAYS after it, started before it, and not a call-up against the
    same standing offer."""
    run, cur, used = 1, own, {own.key}
    while cur.start is not None:
        at = date.fromisoformat(cur.start)
        lo = (at - timedelta(days=RUN_GAP_DAYS)).isoformat()
        hi = (at + timedelta(days=RUN_OVERLAP_DAYS)).isoformat()
        cands = [p for p in held if p.key not in used and p.start is not None and p.start < cur.start and p.end is not None
                 and lo <= p.end <= hi and not (p.so and cur.so and p.so == cur.so)]
        if not cands:
            break
        cur = max(cands, key=lambda p: (p.end, p.start, p.key))
        used.add(cur.key)
        run += 1
    return run


def source_figures(own: Rec, org: str, line: Line, orgs: _Orgs) -> tuple[dict, list[list]]:
    """What one source gives for a row: its record own, held by org, in its line (own counted whether or not the
    line holds it). Returns the source's entry and its similar-name rows."""
    level, keys = own.kinds()
    mine = line.by_org.get(org, [])
    held = [x for x in mine if x.start is not None and own.start is not None and x.start <= own.start and x.key != own.key]
    held.append(own)
    starts = [x.start for x in held if x.start]
    entry = {
        "src": own.src, "lvl": level, "key": sorted(keys), "held": len(held), "run": _back_to_back(held, own),
        "first": min(starts) if starts else None, "total": len(line.recs) + (0 if own.key in line.recs else 1),
        "others": len(line.by_org) - (1 if org in line.by_org else 0),
        "c": sum(1 for x in held if x.comp == 1), "nc": sum(1 for x in held if x.comp == 0),
        "u": sum(1 for x in held if x.comp is None),
    }
    sim: list[list] = []
    others = {o for k in orgs.similar_keys(org) for o in line.similar.get(k, ()) if o != org}
    for other in sorted(others):
        theirs = [x.start for x in line.by_org[other] if x.start and own.start and x.start <= own.start]
        if theirs:
            sim.append([other, orgs.name(other), own.src, len(theirs), max(theirs)])
    return entry, sim


def label(j: dict) -> tuple[str | None, int | None, int | None]:
    """A record's label, the figure beside it and the source that decided it, as site/src/lines.ts reads them: "run"
    (LONG_RUN or more back to back in one source: the longest run), "earlier" (at least one earlier record in one
    source: the most), "none" (none in any source with a kind of work), or None when no source has one."""
    s = [e for e in j.get("s") or [] if e.get("lvl")]
    if not s:
        return None, None, None
    best = max(s, key=lambda e: (e["run"], -e["src"]))
    if best["run"] >= LONG_RUN:
        return "run", best["run"], best["src"]
    best = max(s, key=lambda e: (e["held"] - 1, -e["src"]))
    if best["held"] - 1 >= 1:
        return "earlier", best["held"] - 1, best["src"]
    return "none", 0, None


# -- the night -----------------------------------------------------------------------------

def window(as_of: date) -> tuple[int, int, str, str]:
    """The LINE_YEARS fiscal years ending with the data date's: the first and last, and their first and last day."""
    fy_last = fiscal(as_of.isoformat())[0] or as_of.year
    fy_first = fy_last - LINE_YEARS + 1
    return fy_first, fy_last, f"{fy_first}-04-01", f"{fy_last + 1}-03-31"


def compute(conn: sqlite3.Connection, *, today: date | None = None, now: str | None = None,
            review_dir: Path | None = None) -> dict[str, int]:
    """Rebuild expiring_lines from expiring_contracts and expiring_twins; returns the counts."""
    return _build(conn, today=today, now=now, review_dir=review_dir)[0]


RADAR_SQL = ("SELECT source_key, kind, reference, organization_id, organization, supplier_withheld, buyer_id, client_buyer_id, "
             "\"end\", competitive, n_amendments, value_growth, title_en, title_fr FROM expiring_contracts ORDER BY source_key")


def _build(conn: sqlite3.Connection, *, today: date | None, now: str | None,
           review_dir: Path | None) -> tuple[dict[str, int], str | None]:
    started = time.monotonic()
    # The radar's own day (expiring.py, and the export after it): the run's UTC date.
    as_of = today or datetime.now(timezone.utc).date()
    stamp = now or now_iso()
    fy_first, fy_last, first_day, last_day = window(as_of)
    segments = set(read_segments())
    orgs = _Orgs(conn)
    radar = conn.execute(RADAR_SQL).fetchall()
    twins: dict[str, list[str]] = defaultdict(list)
    for kept, twin in conn.execute("SELECT source_key, twin_key FROM expiring_twins ORDER BY source_key, twin_key"):
        twins[kept].append(twin)
    counts = {"rows": 0, "withheld": 0, "no_buyer": 0, "run": 0, "earlier": 0, "none": 0, "uncoded": 0, "similar": 0,
              "common": 0, "sim_cut": 0}

    # The records each row is counted by, its own and its twins', read first, so the night knows the lines to fill.
    named = [r for r in radar if r["organization_id"] and not r["supplier_withheld"]]
    counts["withheld"] = len(radar) - len(named)
    want: dict[int, set] = {AWARDS: set(), HISTORY: set(), CONTRACTS: set()}
    for r in named:
        for key in [r["source_key"], *twins.get(r["source_key"], [])]:
            kind, _, ref = key.partition(":")
            if kind == "contract":
                dept, _, cref = ref.partition(":")
                want[CONTRACTS].add((dept, cref))
            elif kind in KIND_SRC:
                want[KIND_SRC[kind]].add(ref)
    names = expiring._Names(conn)
    notices = {src: _Notices(conn, src, names, segments, as_of.isoformat()) for src in (AWARDS, HISTORY)}
    found: dict[str, Rec] = {}
    for src in (AWARDS, HISTORY):
        found.update(notices[src].wanted(want[src]))
    found.update(contracts_wanted(conn, want[CONTRACTS]))

    # Each row's record in each source (held by its holder), and the cells (source, buyer, level, key) its lines read.
    plans: dict[str, tuple[str, dict[int, Rec]]] = {}
    needed: set[tuple[int, str, str, str]] = set()
    for r in named:
        buyer = r["client_buyer_id"] or r["buyer_id"]
        if not buyer:
            counts["no_buyer"] += 1
            continue
        mine: dict[int, Rec] = {}
        for key in [r["source_key"], *twins.get(r["source_key"], [])]:
            rec = found.get(key)
            if rec is None or rec.org != r["organization_id"] or rec.src in mine:
                continue
            mine[rec.src] = rec
            level, keys = rec.kinds()
            needed.update((rec.src, buyer, level, k) for k in keys if level)
        plans[r["source_key"]] = (buyer, mine)

    # One pass over each source: a record dated in the window is kept only where a line reads it.
    pools: dict[tuple[int, str, str, str], list[Rec]] = defaultdict(list)
    buyers = {(src, b) for src, b, _, _ in needed}

    def keep(rec: Rec) -> None:
        if (rec.src, rec.buyer) not in buyers or rec.day is None or not first_day <= rec.day <= last_day:
            return
        for level in ((CODE,) if rec.src == CONTRACTS else (CLASS, FAMILY)):
            for k in rec.at(level):
                cell = (rec.src, rec.buyer, level, k)
                if cell in needed:
                    pools[cell].append(rec)

    for src in (AWARDS, HISTORY):
        for rec in notices[src].scan():
            keep(rec)
    for rec in contracts_scan(conn):
        keep(rec)

    lines: dict[tuple, Line] = {}
    rows, reviewed = [], []
    for r in radar:
        plan = plans.get(r["source_key"])
        if plan is None:
            continue
        buyer, mine = plan
        entries, sims = [], []
        for src in sorted(mine):
            own = mine[src]
            level, keys = own.kinds()
            if not level:
                continue
            at = (src, buyer, level, keys)
            if at not in lines:
                lines[at] = Line((x for k in sorted(keys) for x in pools.get((src, buyer, level, k), ())), orgs)
            entry, sim = source_figures(own, r["organization_id"], lines[at], orgs)
            entries.append(entry)
            sims += sim
        if len(sims) > SIM_MAX:
            # The most records first, then the latest start; what is kept stays in the order it was listed in.
            order = sorted(range(len(sims)), key=lambda i: sims[i][4], reverse=True)
            order.sort(key=lambda i: -sims[i][3])
            sims = [sims[i] for i in sorted(order[:SIM_MAX])]
            counts["sim_cut"] += 1
        own = mine.get(KIND_SRC[r["kind"]])
        j = {
            "v": J_VERSION, "fy": [fy_first, fy_last], "buyer": buyer, "oid": org_number(r["organization_id"]),
            "s": entries,
            "own": {
                "comp": r["competitive"] if r["competitive"] in (0, 1) else None,
                "meth": own.meth if own else None, "bids": own.bids if own else None, "amd": r["n_amendments"] or 0,
                "growth": None if r["value_growth"] is None else round(float(r["value_growth"]), 4),
                "end0": (own.end0 if own else None) or r["end"], "end": r["end"],
            },
            "sim": sims,
        }
        band, figure, decided = label(j)
        counts[band or "uncoded"] += 1
        counts["similar"] += len(sims)
        rows.append((r["source_key"], json.dumps(j, ensure_ascii=False, separators=(",", ":"), sort_keys=True), stamp))
        reviewed.append((r, j, band, figure, decided))
    counts["rows"] = len(rows)
    # The openings left out of the similar names, one row per line that has one, for the review file.
    common = [(src, buyer, level, ",".join(sorted(keys)), opening, sorted(orgs.name(o) for o in held))
              for (src, buyer, level, keys), line in lines.items() for opening, held in line.common.items()]
    counts["common"] = len(common)
    # Rebuilt whole in one transaction: a fault leaves last night's rows as they were, never half a table.
    try:
        conn.execute("DELETE FROM expiring_lines")
        conn.executemany(f"INSERT INTO expiring_lines ({', '.join(COLUMNS)}) VALUES (?, ?, ?)", rows)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    counts["seconds"] = round(time.monotonic() - started)
    shown = write_review(reviewed, as_of, (review_dir or config.OUT_DIR / "review") / REVIEW_FILE, stamp=stamp,
                         common=common)
    return counts, shown


# -- the review file --------------------------------------------------------------------

def _sample_order(key: str) -> bytes:
    return hashlib.blake2b(key.encode("utf-8"), digest_size=8).digest()


BANDS = ("run", "earlier", "none", "no label")


COMMON_SHOWN = 4


def write_review(reviewed: list, as_of: date, path: Path, *, stamp: str, common: Iterable[tuple] = ()) -> str | None:
    """Write the operator's review of tonight's records (or remove the file when there are none); returns where.
    common is the openings left out of the similar names: (src, buyer, level, keys, opening, the holders' names)."""
    if not reviewed:
        path.unlink(missing_ok=True)
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    table: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
    by_band: dict[str, list] = defaultdict(list)
    pairs = []
    for r, j, band, figure, decided in reviewed:
        end = _day(r["end"])
        left = (date.fromisoformat(end) - as_of).days if end else None
        inside = [name for name, d in expiring.WINDOWS if left is not None and 0 <= left <= d]
        for name in inside:
            table[(r["kind"], name)][band or "no label"] += 1
        by_band[band or "no label"].append((r, j, figure, decided, inside[0] if inside else ""))
        for oid, name, src, n, last in j["sim"]:
            pairs.append((r["organization_id"], r["organization"] or "", oid, name, src, n, last, r["source_key"]))
    out = [f"# Holder's record, run of {stamp}, data date {as_of.isoformat()}: {len(reviewed)} radar rows with a named holder. "
           f"Rules: {LINE_YEARS} fiscal years; back to back from {RUN_GAP_DAYS} days before a start to {RUN_OVERLAP_DAYS} "
           f"after it; long run from {LONG_RUN}; published codes cut at {CODE_CHARS} characters; similar names from "
           f"{SIMILAR_PREFIX}, an opening shared by more than {SIMILAR_GROUP_MAX} holders of a line left out, "
           f"{SIM_MAX} names a record at most. For the operator: no step publishes this file, and it holds no account "
           f"or reader.",
           "", "## Labels by the row's own source and window (each window counts the rows ending within it)",
           "# source\twindow\t" + "\t".join(BANDS)]
    for kind in ("award", "history", "contract"):
        for name, _ in expiring.WINDOWS:
            cell = table.get((kind, name), {})
            out.append("\t".join([kind, name, *(str(cell.get(b, 0)) for b in BANDS)]))
    for band in BANDS:
        rows = sorted(by_band.get(band, []), key=lambda x: _sample_order(x[0]["source_key"]))[:REVIEW_SAMPLE]
        out += ["", f"## {band}: {len(by_band.get(band, []))} rows, {len(rows)} sampled",
                "# source_key\twindow\tholder\tbuyer\tfigure\tdecided_by\tper source: src lvl keys held run first total "
                "others c nc u\ttitle"]
        for r, j, figure, decided, inside in rows:
            per = "; ".join(f"{e['src']} {e['lvl']} {','.join(e['key'])} {e['held']} {e['run']} {e['first']} {e['total']} "
                            f"{e['others']} {e['c']} {e['nc']} {e['u']}" for e in j["s"])
            # Scrubbed of contacts as the records database's titles are.
            title = (title_text(r["title_en"], "en") or title_text(r["title_fr"], "fr") or "")[:120]
            out.append("\t".join([r["source_key"], inside, r["organization"] or "", j["buyer"] or "",
                                  "" if figure is None else str(figure), "" if decided is None else str(decided), per, title]))
    out += ["", f"## Similar names: {len(pairs)} pairs, every one",
            "# holder_id\tholder\tsimilar_id\tsimilar\tsrc\tcontracts\tlast_start\tsource_key"]
    out += ["\t".join(str(x) for x in p) for p in sorted(pairs, key=lambda p: (p[0], p[2], p[4], p[7]))]
    shared = sorted(common, key=lambda c: (-len(c[5]), c[4], c[0], c[1] or "", c[2], c[3]))
    out += ["", f"## Common openings: {len(shared)} in their lines, each left out of the similar names there",
            "# opening\tholders\tsrc\tbuyer\tlvl\tkeys\tthe first names"]
    out += ["\t".join([opening, str(len(names)), str(src), buyer or "", level, keys, "; ".join(names[:COMMON_SHOWN])])
            for src, buyer, level, keys, opening, names in shared]
    path.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    try:
        return path.relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def run(conn: sqlite3.Connection, *, today: date | None = None, now: str | None = None,
        review_dir: Path | None = None) -> dict[str, int]:
    """The lines stage. Its own log row, after the expiring stage's, so a fault here leaves the radar standing, and
    no notice: the counts in the row's detail are counts of public records, the review file is the operator's."""
    counts, _ = _build(conn, today=today, now=now, review_dir=review_dir)
    log.info("lines: %s", counts)
    log_run(conn, "lines", detail=" ".join(f"{k}={v}" for k, v in counts.items()), rows_in=counts["rows"],
            rows_new=counts["rows"])
    return counts
