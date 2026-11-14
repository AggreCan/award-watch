"""May follow: for each open tender notice, the earlier contracts of the same buyer it may follow, chosen by the
lines stage beside the holders' records (lines.py) and kept in tender_follows (docs/accounts.md "May follow").

The rules, which the Methodology page states in its own words while the site shows the panel (FOLLOWS_PANEL);
site/src/lines.ts holds the same constants and tests/test_lines.py holds the two equal:

* An open notice is a notice's newest version whose status on the data date is open
  (normalize.tender_status_on). Its buyers are its buyer and the client department it names first among its end
  users (expiring._Names.end_user). A record may follow it only when the record's buyer, by the record's own
  source's rule (lines.Rec.buyer), is one of the two.
* The records compared are the award notices, PSPC history records and published contracts dated in the
  LINE_YEARS fiscal years ending with the data date's, on or before the day the notice was published: a record
  awarded after a notice appeared is not one it was written to follow, and the awards a long-open notice gives
  while it stays open are its own results. Cancelled notices are left out, and so are standing offers and supply
  arrangements themselves (the notice page lists an instrument's current holders): their call-ups are contracts and
  stay in.
* Number match: the record carries the notice's solicitation number, or the notice's title or description names one
  of the record's numbers (an award notice's solicitation and contract number, a history record's solicitation,
  contract and procurement numbers, a published contract's reference and procurement id), each folded as
  expiring.contract_number folds it (upper case, letters and digits, NUMBER_MIN of them at least). Left out: the
  notice's own numbers (its solicitation, the part of it before the first "/", its reference), the numbers of
  standing offers and supply arrangements (a notice issued against one names it, and so do its every call-up), and
  a number that the buyer's earlier records of more than one organization carry, which is a call's, a list's or a
  placeholder and no one contract's. The last was set on the development copy: read over its award notices as if
  they were open, the awards of one call number (WS4001912488, five organizations) matched each other by number
  with no title word in common, and same-solicitation matches made 115 of the 136 notices' closest; with the rule,
  8 of 41.
* Text match: the record shares a UNSPSC class with the notice (a family when the notice carries none); the share
  of distinct title words in common, shared over all, is at least FOLLOW_MIN; and the record ends between
  FOLLOW_BEFORE_DAYS before and FOLLOW_AFTER_DAYS after the notice's expected start, or its publication date when
  it states none. Title words: four letters or more, no digit, outside STOP; a title is read in English, else in
  French. A published contract carries no UNSPSC code, so it follows by number only.
* Degrees: a number match; a close text match from FOLLOW_CLOSE of the words; a partial one from FOLLOW_MIN.
  Order: number matches first, then the share of words, then the end nearest the start, then the record's key. One
  contract published in two sources (the radar's twins: a contract number in common, or the same organization
  ending within expiring.END_DAYS) is kept once, the first in that order. FOLLOW_MAX are kept.
* Each kept record carries its own holder's record (lines.own_figures): its source's line of the same buyer and
  kind of work, counted by the same code as a radar row's, so a contract that has ended has one too. A record whose
  supplier is withheld as a person is kept, named by no one and given no record.

Cost (docs/accounts.md "May follow"): the records that could match are found before the stage's one pass over
each source, by SQL over the records ending near some open notice's start and coded in some open notice's class,
and over the number columns of the records of the open notices' buyers; the pass then fills their lines with the
radar's. Matching reads, for each notice, only the records indexed under its buyers and classes (by_cell) and its
numbers (by_number), never every record.

tender_follows.j is what the site reads (rec_follows.j, records_db.follows_rows). It names records and
organizations, never a reader.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from bisect import bisect_left, bisect_right
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta
from fractions import Fraction

from . import expiring
from .export_static import RefMap
from .normalize import tender_status_on
from .records_db import org_number, title_text
from .sources.canadabuys_rows import UNMARKED_DESCRIPTION_MAX

# The constants of the rules; site/src/lines.ts holds the same values (tests/test_lines.py compares them). Each is
# to be confirmed on production data (the review file) before the site shows the panel.
FOLLOW_MIN = 0.5
FOLLOW_CLOSE = 0.75
FOLLOW_BEFORE_DAYS = 180
FOLLOW_AFTER_DAYS = 120
FOLLOW_MAX = 3
J_VERSION = 1

NUMBER, CLOSE, PARTIAL = "number", "close", "partial"
REVIEW_SAMPLE = 100


class FollowsFailed(RuntimeError):
    """May follow failed after the holders' records were written: the stage reads as failed, and tender_follows keeps
    the night before's rows."""

# The words "Earlier awards like this one" leaves out (site/src/pages/backbone.tsx STOP; a test holds the copy
# equal), then the words every notice of a kind repeats.
SITE_STOP = frozenset({
    "the", "and", "for", "with", "from", "services", "service", "des", "les", "pour", "avec", "dans", "une", "aux", "sur",
    "par", "this", "that",
})
STOP = SITE_STOP | frozenset({
    "contract", "contrat", "supply", "fourniture", "request", "demande", "requirement", "besoin", "against", "arrangement",
    "approvisionnement", "canada", "national",
})

_WORD = re.compile(r"[^\W_]+")
# A number as a text writes it: letters and digits, single separators between them ("W8486-207442/001/ZF").
_TOKEN = re.compile(r"[A-Za-z0-9]+(?:[-/._][A-Za-z0-9]+)*")
# The common separators a number field holds, dropped in SQL before the exact fold in Python; a number holding any
# other character is not found by the SQL and so not matched (none seen in the files).
_SQL_SEPARATORS = (" ", "-", "/", ".", "_")
# An instrument's own row: CanadaBuys' instrument types (records_db._STANDING's rule), a published row's codes.
_STANDING_TYPE = re.compile(r"^\s*(standing offer|supply arrangement)", re.IGNORECASE)
_STANDING_CODES = frozenset({"SO", "SA", "SOSA"})


def title_words(text: object) -> frozenset[str]:
    """The words of a title a match compares: four letters or more, lower case, accents kept, no digit, not in STOP."""
    return frozenset(w for w in _WORD.findall(str(text or "").lower())
                     if len(w) >= 4 and w not in STOP and not any(ch.isdigit() for ch in w))


def words_of(en: object, fr: object) -> frozenset[str]:
    """A title's words in one language: English, else French."""
    return title_words(en if str(en or "").strip() else fr)


def fold(raw: object) -> str | None:
    return expiring.contract_number(raw)


def stem_fold(raw: object) -> str | None:
    """The part of a number before its first "/", folded: what a standing offer's or an RFSO's numbers share."""
    return fold(str(raw or "").split("/", 1)[0])


def named_numbers(text: object, cut: bool) -> list[str]:
    """The numbers a text names, as it writes them: tokens holding a digit whose fold has NUMBER_MIN characters.
    cut: the text is the start of a longer one, so a token running to its end may be a number cut short and is not
    read (a whole-word cut keeps it whole, but a text stored before the cut was marked was cut mid-word)."""
    text = str(text or "")
    out = []
    for m in _TOKEN.finditer(text):
        token = m.group(0)
        if cut and m.end() == len(text):
            continue
        if any(ch.isdigit() for ch in token) and fold(token):
            out.append(token)
    return out


def _was_cut(text: object, cut: object) -> bool:
    if not text:
        return False
    if cut is None:
        return len(str(text)) >= UNMARKED_DESCRIPTION_MAX
    return cut != 0


def _sql_fold(column: str) -> str:
    expr = column
    for ch in _SQL_SEPARATORS:
        expr = f"replace({expr}, '{ch}', '')"
    return f"upper({expr})"


def _day(text: object) -> date | None:
    try:
        return date.fromisoformat(str(text or "")[:10])
    except ValueError:
        return None


# -- the open notices -----------------------------------------------------------------

@dataclass(frozen=True)
class Notice:
    ref: str                       # the reference as stored
    tref: str                      # its URL form in lower case, the tender page's
    title_en: str | None
    title_fr: str | None
    buyer: str | None
    client: str | None             # the buyer of the first end user, when a source used that spelling for one
    level: str | None              # class, family or None
    keys: frozenset[str]
    words: frozenset[str]
    sol: str | None                # the solicitation, folded; None when it is a framework's or too short
    named: frozenset[str]          # the numbers its text names, folded, its own and the frameworks' left out
    start: date                    # the expected start, else the publication
    from_start: bool
    published: str                 # the day it was published (else first seen): no record dated after it follows

    @property
    def buyers(self) -> tuple[str, ...]:
        return tuple(dict.fromkeys(b for b in (self.buyer, self.client) if b))


OPEN_SQL = (
    "SELECT n.reference, n.solicitation, n.title_en, n.title_fr, n.description_en, n.description_fr, n.description_en_cut, "
    "n.description_fr_cut, n.published, n.start_expected, n.status, n.closing, n.buyer_id, n.end_users_en, n.end_users_fr, "
    "(SELECT MIN(z.first_seen) FROM tenders z WHERE z.reference = n.reference) AS first_sight, "
    "(SELECT group_concat(c.unspsc, ' ') FROM tender_codes c WHERE c.reference = n.reference AND c.amendment = n.amendment) AS codes "
    "FROM tenders n WHERE n.status = 'open' AND n.amendment = (SELECT MAX(z.amendment) FROM tenders z WHERE z.reference = n.reference) "
    "ORDER BY n.reference"
)


def open_notices(conn: sqlite3.Connection, as_of: str, names: expiring._Names, segments: set[str],
                 frameworks: set[str], refs: RefMap) -> list[Notice]:
    """The notices open on the data date, as the matcher reads them; a notice the site serves no page for is left out."""
    from .lines import CLASS, FAMILY, unspsc_keys

    out = []
    for r in conn.execute(OPEN_SQL):
        if tender_status_on(r["status"], r["closing"], as_of) != "open":
            continue
        url = refs.get(r["reference"])
        if not url:
            continue
        classes, families = unspsc_keys(r["codes"], segments)
        level, keys = (CLASS, classes) if classes else (FAMILY, families) if families else (None, frozenset())
        published = (_day(r["published"]) or _day(r["first_sight"]) or _day(as_of)).isoformat()
        start = _day(r["start_expected"])
        own = {n for n in (fold(r["solicitation"]), stem_fold(r["solicitation"]), fold(r["reference"])) if n}
        named = set()
        for text, cut in ((r["title_en"], 0), (r["title_fr"], 0), (r["description_en"], r["description_en_cut"]),
                          (r["description_fr"], r["description_fr_cut"])):
            for token in named_numbers(text, _was_cut(text, cut)):
                named.add(fold(token))
        sol = fold(r["solicitation"])
        out.append(Notice(
            ref=r["reference"], tref=url.lower(), title_en=r["title_en"], title_fr=r["title_fr"], buyer=r["buyer_id"],
            client=names.end_user(r["end_users_en"], r["end_users_fr"])[0], level=level, keys=keys,
            words=words_of(r["title_en"], r["title_fr"]), sol=None if sol in frameworks else sol,
            named=frozenset(named - own - frameworks), start=start or date.fromisoformat(published),
            from_start=start is not None, published=published))
    return out


# -- the records that may follow ---------------------------------------------------------

@dataclass(eq=False)
class Cand:
    """A record that may follow an open notice: its Rec as the lines count it, and what a match reads."""
    rec: object                    # lines.Rec
    ref: str                       # the site's form: an award's or history record's URL reference, '<dept>:<ref>'
    title_en: str | None
    title_fr: str | None
    numbers: dict[str, str]        # folded -> as the record publishes it
    twins: frozenset[str]          # the numbers the radar's duplicate rule compares
    standing: bool
    withheld: bool
    versions: int
    _words: frozenset[str] | None = field(default=None, repr=False)

    @property
    def words(self) -> frozenset[str]:
        if self._words is None:
            self._words = words_of(self.title_en, self.title_fr)
        return self._words


# The columns a candidate adds to a notice's Rec (lines._Notices extra).
_NOTICE_EXTRA = {
    "awards": (", title_en, title_fr, solicitation, contract_number, NULL AS procurement_number, instrument_type_en, "
               "(SELECT COUNT(*) FROM awards v WHERE v.reference = newest.reference) AS versions"),
    "contract_history": (", title_en, title_fr, solicitation, contract_number, procurement_number, instrument_type_en, "
                         "(SELECT COUNT(*) FROM contract_history v WHERE v.reference = newest.reference) AS versions"),
}


def _numbers(*raws: object) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in raws:
        n = fold(raw)
        if n and n not in out:
            out[n] = str(raw).strip()
    return out


class Finder:
    """The records that may follow the open notices, read by the reference sets the SQL below finds."""

    def __init__(self, conn: sqlite3.Connection, as_of: str, names: expiring._Names, segments: set[str],
                 first_day: str, last_day: str):
        from . import lines

        self.conn, self.as_of, self.first_day, self.last_day = conn, as_of, first_day, last_day
        self.notices = {src: lines._Notices(conn, src, names, segments, as_of, extra=_NOTICE_EXTRA[table])
                        for src, table in ((lines.AWARDS, "awards"), (lines.HISTORY, "contract_history"))}
        self.awards = RefMap(conn, "awards")
        self.history = RefMap(conn, "contract_history")

    def _temp(self, name: str, values: Iterable) -> None:
        self.conn.execute(f"DROP TABLE IF EXISTS temp.{name}")
        self.conn.execute(f"CREATE TEMP TABLE {name} (v TEXT PRIMARY KEY)")
        self.conn.executemany(f"INSERT OR IGNORE INTO temp.{name} VALUES (?)", ((v,) for v in values))

    def _drop(self, *names: str) -> None:
        for name in names:
            self.conn.execute(f"DROP TABLE IF EXISTS temp.{name}")

    def references(self, notices: list[Notice]) -> tuple[set[str], set[str], set[tuple[str, str]]]:
        """The award, history and published references that could match some notice: by text (ending near a start,
        coded in a class or family a notice carries) or by number (carrying a number a notice seeks, of one of the
        notices' buyers)."""
        conn = self.conn
        starts = [n.start for n in notices if n.level]
        awards: set[str] = set()
        history: set[str] = set()
        contracts: set[tuple[str, str]] = set()
        self._temp("follow_buyers", {b for n in notices for b in n.buyers})
        if starts:
            lo = (min(starts) - timedelta(days=FOLLOW_BEFORE_DAYS)).isoformat()
            hi = (max(starts) + timedelta(days=FOLLOW_AFTER_DAYS)).isoformat()
            self._temp("follow_classes", {k for n in notices if n.level == "class" for k in n.keys})
            self._temp("follow_families", {k for n in notices if n.level == "family" for k in n.keys})
            coded = ("(substr(c.unspsc, 1, 6) IN (SELECT v FROM temp.follow_classes) "
                     "OR substr(c.unspsc, 1, 4) IN (SELECT v FROM temp.follow_families))")
            awards.update(r[0] for r in conn.execute(
                "SELECT DISTINCT a.reference FROM awards a WHERE substr(a.\"end\", 1, 10) BETWEEN ? AND ? AND EXISTS "
                f"(SELECT 1 FROM award_codes c WHERE c.reference = a.reference AND {coded})", (lo, hi)))
            history.update(r[0] for r in conn.execute(
                "SELECT DISTINCT h.reference FROM contract_history h WHERE substr(h.\"end\", 1, 10) BETWEEN ? AND ? "
                "AND COALESCE(h.client_id, h.buyer_id) IN (SELECT v FROM temp.follow_buyers) AND EXISTS "
                f"(SELECT 1 FROM history_codes c WHERE c.reference = h.reference AND {coded})", (lo, hi)))
            self._drop("follow_classes", "follow_families")
        sought = {n.sol for n in notices if n.sol} | {x for n in notices for x in n.named}
        if sought:
            self._temp("follow_numbers", sought)
            within = "(awarded >= :first OR published >= :first)"
            match = lambda *cols: " OR ".join(f"{_sql_fold(c)} IN (SELECT v FROM temp.follow_numbers)" for c in cols)  # noqa: E731
            awards.update(r[0] for r in conn.execute(
                f"SELECT DISTINCT reference FROM awards WHERE {within} AND ({match('solicitation', 'contract_number')})",
                {"first": self.first_day}))
            history.update(r[0] for r in conn.execute(
                f"SELECT DISTINCT reference FROM contract_history WHERE {within} AND COALESCE(client_id, buyer_id) IN "
                f"(SELECT v FROM temp.follow_buyers) AND ({match('solicitation', 'contract_number', 'procurement_number')})",
                {"first": self.first_day}))
            # Through idx_contracts_buyer: the notices' buyers' rows of the ten years, not the whole table.
            contracts.update((r[0], r[1]) for r in conn.execute(
                "SELECT owner_org, reference FROM contracts WHERE buyer_id IN (SELECT v FROM temp.follow_buyers) "
                f"AND contract_date >= ? AND ({match('reference', 'procurement_id')})", (self.first_day,)))
            self._drop("follow_numbers")
        self._drop("follow_buyers")
        return awards, history, contracts

    def read(self, awards: set[str], history: set[str], contracts: set[tuple[str, str]]) -> list[Cand]:
        from . import lines

        out: list[Cand] = []
        for src, refs, urls in ((lines.AWARDS, awards, self.awards), (lines.HISTORY, history, self.history)):
            for rec, r in self.notices[src].wanted_rows(refs):
                ref = urls.get(r["reference"]) or f":{r['reference']}"
                out.append(Cand(
                    rec, ref, r["title_en"], r["title_fr"],
                    _numbers(r["solicitation"], r["contract_number"], r["procurement_number"]),
                    frozenset(n for n in (fold(r["contract_number"]), fold(r["procurement_number"])) if n),
                    bool(_STANDING_TYPE.match(str(r["instrument_type_en"] or ""))), bool(r["wh"]), r["versions"] or 1))
        for rows in lines.contract_groups(self.conn, contracts, lines._CONTRACT_COLUMNS + ", description_en, description_fr, "
                                          "instrument_type").values():
            newest = rows[-1]
            kinds = {str(r["instrument_type"] or "").strip().upper() for r in rows} - {"A", ""}
            pids = [r["gk"][2:] for r in rows[:1] if r["gk"].startswith("p:")]
            out.append(Cand(
                lines.contract_rec(rows), f"{newest['owner_org']}:{newest['reference']}", newest["description_en"],
                newest["description_fr"], _numbers(*pids, *(r["reference"] for r in rows)),
                frozenset(n for n in (fold(pids[0]) if pids else None, fold(newest["reference"])) if n),
                bool(kinds) and kinds <= _STANDING_CODES, bool(newest["vendor_withheld"]), len(rows)))
        return out


def frameworks(conn: sqlite3.Connection) -> set[str]:
    """The numbers of standing offers and supply arrangements, folded, whole and before their first "/": an
    instrument's own rows (CanadaBuys' types, a published row's SO, SA or SOSA), the standing offers the published
    call-ups name, and the instruments of the standing offers file."""
    out: set[str] = set()

    def add(*raws: object) -> None:
        for raw in raws:
            for n in (fold(raw), stem_fold(raw)):
                if n:
                    out.add(n)

    for table, cols in (("awards", "solicitation, contract_number"),
                        ("contract_history", "solicitation, contract_number, procurement_number")):
        for row in conn.execute(f"SELECT DISTINCT {cols} FROM {table} WHERE instrument_type_en LIKE 'standing offer%' "
                                "OR instrument_type_en LIKE 'supply arrangement%'"):
            add(*row)
    for (raw,) in conn.execute("SELECT DISTINCT standing_offer_number FROM contracts WHERE standing_offer_number IS NOT NULL"):
        add(raw)
    for row in conn.execute("SELECT DISTINCT reference, procurement_id FROM contracts WHERE upper(trim(instrument_type)) "
                            "IN ('SO', 'SA', 'SOSA')"):
        add(*row)
    for (raw,) in conn.execute("SELECT agreement_number FROM sosa_instruments"):
        add(raw)
    return out


# -- the match ----------------------------------------------------------------------------

@dataclass(frozen=True)
class Match:
    cand: Cand
    degree: str
    sol: str | None                # the record's number equal to the notice's solicitation, as the record has it
    num: str | None                # the record's number the notice names, as the record has it
    buyer: str
    client: bool                   # matched through the notice's client department, not its buyer
    level: str | None
    codes: tuple[str, ...]         # the classes or families shared
    shared: int
    all: int
    days: int | None               # the record's end less the notice's start (or publication)

    def order(self) -> tuple:
        share = Fraction(self.shared, self.all) if self.all else Fraction(0)
        return (0 if self.degree == NUMBER else 1, -share, abs(self.days) if self.days is not None else 1 << 30,
                self.cand.rec.key)


@dataclass
class Chosen:
    """What the matcher chose: the notices read and each one's kept matches, closest first."""
    notices: list[Notice]
    kept: dict[str, list[Match]]
    counts: dict[str, int]


class Index:
    """The candidates by (buyer, level, key), each list in order of end so a notice reads only the records ending in
    its own window, and by (buyer, folded number): all one notice reads."""

    def __init__(self, cands: Iterable[Cand], first_day: str, last_day: str):
        cells: dict[tuple[str, str, str], list[Cand]] = defaultdict(list)
        self.by_number: dict[tuple[str, str], list[Cand]] = defaultdict(list)
        for c in cands:
            rec = c.rec
            if c.standing or not rec.buyer or rec.day is None or not first_day <= rec.day <= last_day:
                continue
            if rec.end:
                for k in rec.classes:
                    cells[(rec.buyer, "class", k)].append(c)
                for k in rec.families:
                    cells[(rec.buyer, "family", k)].append(c)
            for n in c.numbers:
                self.by_number[(rec.buyer, n)].append(c)
        self.by_cell = {k: sorted(v, key=lambda c: (c.rec.end, c.rec.key)) for k, v in cells.items()}
        self.ends = {k: [c.rec.end for c in v] for k, v in self.by_cell.items()}

    def ending(self, cell: tuple[str, str, str], lo: str, hi: str) -> list[Cand]:
        """The cell's records ending from lo to hi, both included."""
        ends = self.ends.get(cell)
        if not ends:
            return []
        return self.by_cell[cell][bisect_left(ends, lo):bisect_right(ends, hi)]


def _same_contract(a: Cand, b: Cand) -> bool:
    """The radar's duplicate rule across two sources: a contract number in common, or the same organization ending
    within END_DAYS of each other (the value, which the rule also compares, is not read here)."""
    if a.rec.src == b.rec.src:
        return False
    if a.twins & b.twins:
        return True
    if not a.rec.org or a.rec.org != b.rec.org or not a.rec.end or not b.rec.end:
        return False
    return abs((date.fromisoformat(a.rec.end) - date.fromisoformat(b.rec.end)).days) <= expiring.END_DAYS


def match_notice(n: Notice, index: Index) -> tuple[list[Match], int]:
    """The notice's matches, closest first, FOLLOW_MAX at most, twins kept once; and how many matched in all."""
    seen: dict[int, Match] = {}
    lo = (n.start - timedelta(days=FOLLOW_BEFORE_DAYS)).isoformat()
    hi = (n.start + timedelta(days=FOLLOW_AFTER_DAYS)).isoformat()

    def consider(c: Cand, buyer: str, sol: str | None, num: str | None) -> None:
        rec = c.rec
        if rec.day > n.published:
            return
        level = n.level
        codes = tuple(sorted((rec.classes if level == "class" else rec.families) & n.keys)) if level else ()
        days = (date.fromisoformat(rec.end) - n.start).days if rec.end else None
        if not (sol or num) and not (codes and days is not None and -FOLLOW_BEFORE_DAYS <= days <= FOLLOW_AFTER_DAYS):
            return
        theirs = c.words
        shared = len(n.words & theirs)
        every = len(n.words | theirs)
        if sol or num:
            degree = NUMBER
        elif every and shared >= FOLLOW_MIN * every:
            degree = CLOSE if shared >= FOLLOW_CLOSE * every else PARTIAL
        else:
            return
        m = Match(c, degree, sol, num, buyer, buyer != n.buyer, level, codes, shared, every, days)
        old = seen.get(id(c))
        if old is None or m.order() < old.order():
            seen[id(c)] = m

    def one_holder(holders: list[Cand]) -> bool:
        # A number the earlier records of two organizations carry is a call's, a list's or a placeholder, no one
        # contract's (twins of one contract share their organization; the withheld count as one).
        return len({c.rec.org or "" for c in holders if c.rec.day <= n.published}) <= 1

    for buyer in n.buyers:
        if n.sol:
            holders = index.by_number.get((buyer, n.sol), [])
            if one_holder(holders):
                for c in holders:
                    consider(c, buyer, c.numbers[n.sol], None)
        for x in sorted(n.named):
            holders = index.by_number.get((buyer, x), [])
            if one_holder(holders):
                for c in holders:
                    consider(c, buyer, None, c.numbers[x])
        if n.level and n.words:
            for k in sorted(n.keys):
                for c in index.ending((buyer, n.level, k), lo, hi):
                    consider(c, buyer, None, None)
    ranked = sorted(seen.values(), key=Match.order)
    kept: list[Match] = []
    for m in ranked:
        if len(kept) == FOLLOW_MAX:
            break
        if any(_same_contract(k.cand, m.cand) for k in kept):
            continue
        kept.append(m)
    return kept, len(ranked)


def choose(conn: sqlite3.Connection, *, as_of: str, first_day: str, last_day: str, names: expiring._Names,
           segments: set[str]) -> Chosen:
    """The open notices and, for each, the records kept (before the stage's pass over the sources, so the pass fills
    the kept records' lines too)."""
    fw = frameworks(conn)
    notices = open_notices(conn, as_of, names, segments, fw, RefMap(conn, "tenders"))
    finder = Finder(conn, as_of, names, segments, first_day, last_day)
    cands = finder.read(*finder.references(notices)) if notices else []
    index = Index(cands, first_day, last_day)
    kept: dict[str, list[Match]] = {}
    counts = {"open": len(notices), "candidates": len(cands), "matched": 0, "number": 0, "close": 0, "partial": 0,
              "kept": 0, "beyond_max": 0}
    for n in notices:
        ms, every = match_notice(n, index)
        if ms:
            kept[n.tref] = ms
            counts["matched"] += 1
            counts[ms[0].degree] += 1
            counts["kept"] += len(ms)
            counts["beyond_max"] += max(every - len(ms), 0)
    return Chosen(notices, kept, counts)


# -- the rows ------------------------------------------------------------------------------

def follow_j(n: Notice, m: Match, line: dict | None) -> dict:
    c, rec = m.cand, m.cand.rec
    return {
        "v": J_VERSION, "src": rec.src, "ref": c.ref, "t": [title_text(c.title_en, "en"), title_text(c.title_fr, "fr")],
        "oid": None if c.withheld else org_number(rec.org), "wh": 1 if c.withheld else 0, "end": rec.end,
        "deg": m.degree, "sol": m.sol, "num": m.num, "buyer": m.buyer, "client": 1 if m.client else 0,
        "lvl": m.level if m.codes else None, "code": list(m.codes), "words": [m.shared, m.all], "days": m.days,
        "from": "start" if n.from_start else "pub", "line": line,
    }


def rows(chosen: Chosen, record_of: Callable[[Match], dict | None], stamp: str) -> list[tuple[str, int, str, str]]:
    """tender_follows' rows: (reference, rank, j, computed_at), rank 1 the closest."""
    out = []
    by_ref = {n.tref: n for n in chosen.notices}
    for tref in sorted(chosen.kept):
        for rank, m in enumerate(chosen.kept[tref], start=1):
            j = follow_j(by_ref[tref], m, record_of(m))
            out.append((tref, rank, json.dumps(j, ensure_ascii=False, separators=(",", ":"), sort_keys=True), stamp))
    return out


def write(conn: sqlite3.Connection, table_rows: list[tuple]) -> None:
    """Rebuild tender_follows whole in one transaction: a fault leaves the night before's rows."""
    try:
        conn.execute("DELETE FROM tender_follows")
        conn.executemany("INSERT INTO tender_follows (reference, rank, j, computed_at) VALUES (?, ?, ?, ?)", table_rows)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


# -- the review file's section ---------------------------------------------------------------

def _sample_order(key: str) -> bytes:
    return hashlib.blake2b(key.encode("utf-8"), digest_size=8).digest()


def _title(en: object, fr: object) -> str:
    """A title for the review, scrubbed of contacts as the records database's are, on one line."""
    return (title_text(en, "en") or title_text(fr, "fr") or "")[:160]


def review(chosen: Chosen, name_of: Callable[[str], str], labels: dict[tuple[str, int], str]) -> list[str]:
    """The may-follow section of the holders' review file: the counts, then the closest match of REVIEW_SAMPLE
    notices that have one, sampled by a hash of their reference, with both titles, the degree, the shares and the
    dates. labels holds each kept record's holder's label by (notice, rank)."""
    c = chosen.counts
    by_ref = {n.tref: n for n in chosen.notices}
    sampled = sorted(chosen.kept, key=lambda tref: _sample_order(tref))[:REVIEW_SAMPLE]
    out = ["", f"## May follow: {c['open']} open notices, {c['matched']} with a match kept (by the closest: {c['number']} "
           f"number, {c['close']} close, {c['partial']} partial), {c['kept']} kept in all, {c['beyond_max']} more matched "
           f"past {FOLLOW_MAX}; {c['candidates']} records read. Rules: title words from {FOLLOW_MIN:.0%}, close from "
           f"{FOLLOW_CLOSE:.0%}; ending from {FOLLOW_BEFORE_DAYS} days before the start to {FOLLOW_AFTER_DAYS} after it. "
           f"{len(sampled)} notices sampled, the closest match of each.",
           "# notice\tnotice_title\tbuyer\tstart (s expected, p published)\tdegree\trecord\trecord_title\tholder\t"
           "matched\twords\tends\tdays\tholder's label"]
    for tref in sampled:
        n, m = by_ref[tref], chosen.kept[tref][0]
        rec = m.cand.rec
        how = (f"solicitation {m.sol}" if m.sol else f"named {m.num}" if m.num else
               f"{m.level} {','.join(m.codes)}") + (" via client" if m.client else "")
        out.append("\t".join([
            n.ref, _title(n.title_en, n.title_fr), m.buyer, f"{n.start.isoformat()} {'s' if n.from_start else 'p'}",
            m.degree, rec.key, _title(m.cand.title_en, m.cand.title_fr),
            "withheld" if m.cand.withheld else name_of(rec.org) if rec.org else "", how, f"{m.shared}/{m.all}",
            rec.end or "", "" if m.days is None else str(m.days), labels.get((tref, 1), ""),
        ]))
    return out
