"""Matching notices: what an organization's own records hold, as the "matching" block of its profile.

A signed-in account that names its organization sees the open tender notices ranked by what each has in
common with that organization's records (site/public/fit.js holds the rules and the points; the Methodology
page states them; docs/accounts.md, Matching notices). The site scores at request time; this module counts,
once a night, the organization's side of it from the rows its profile already reads
(export_static._profile_tables), so the count costs one loop over rows in memory and no new file.

The block (export_static.profile writes it as "matching"):

  fy         [first, last]: the MATCH_YEARS federal fiscal years ending with the data date's
  n          the records counted per source, [award notices, PSPC contract history, published contracts]
  coded      the award notices and history records among them with a UNSPSC code in one of the 57 segments,
             [awards, history]: the site ranks notices only when one source holds MATCH_MIN of them
  newest     the latest date among the counted records (null when only an instrument is held)
  classes    [code, awards, history]: each record once in each class (6 digits) its codes reach, CLASSES_MAX
  families   the same by family (4 digits), FAMILIES_MAX
  segments   the same by segment (2 digits), every one
  buyers     [buyer id, awards, history, contracts]: listed buyers only, BUYERS_MAX
  provinces  [code, awards, history]: the union of a record's stated and derived provinces, each once a record
  types      [notice type as published in English, awards, history], a blank type skipped, TYPES_MAX
  held       [instrument type code, segment, instruments]: the standing offers and supply arrangements the
             organization holds (an active holder row), one per instrument whatever its regions

Every list runs by the larger of its source counts, then its key. No figure adds two sources: a rule that
reads a count takes the largest count of one source (CLAUDE.md "Counting money").

Which records count:

* An award notice or a history record is the export's own row (x_awards, x_history: one per contract, at its
  newest version, linked to no organization when its supplier is withheld, so a withheld supplier never
  counts). Its date is the award_day rule (records_db.NOTICE_DAY): the award date, or the publication date
  when the award date falls after the data date. A history record counts under its client department and
  under its contracting entity (PSPC), once when they are the same buyer: a notice names the contracting
  entity, and the department is who the work was for.
* A published contract counts in n and buyers only (it carries no UNSPSC code, province or notice type),
  dated by its contract date. An amendment row (instrument type A, or an amendment value set and not zero)
  is not a contract of its own and is not counted.
* Grants and lobbying reports are never read: neither says what work an organization does.

An organization with no counted record and no instrument held has no block. stats.json carries
"matching_fy" beside it, the window the night's export counted, so the site can tell an organization
with nothing in the window from a file written before the block existed.
"""

from __future__ import annotations

import json
import re
import sqlite3
from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Mapping
from typing import Any

from .normalize import PROVINCE_CODES
from .sources import sosa

MATCH_YEARS = 5
CLASSES_MAX = 40
FAMILIES_MAX = 20
BUYERS_MAX = 25
# The notice types CanadaBuys uses are a dozen at most; this bound only stops a runaway file.
TYPES_MAX = 20

_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
_BUYER_ID = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

Row = Mapping[str, Any]


def fiscal_year(day: object) -> int | None:
    """The federal fiscal year of an ISO date, by the calendar year it starts in (records_db.fiscal's rule)."""
    m = _DAY.match(str(day or ""))
    if not m:
        return None
    year, month = int(m.group(1)), int(m.group(2))
    if not 1 <= month <= 12:
        return None
    return year if month >= 4 else year - 1


def window(as_of: str) -> tuple[int, int]:
    """The first and last fiscal year counted: MATCH_YEARS of them, ending with the data date's."""
    last = fiscal_year(as_of)
    if last is None:
        raise ValueError(f"{as_of!r} is not a date")
    return last - MATCH_YEARS + 1, last


def _day(value: object) -> str | None:
    text = str(value or "")
    return text[:10] if _DAY.match(text) else None


def record_day(r: Row, as_of: str) -> str | None:
    """An award notice's or history record's date by the award_day rule (export_static.award_day)."""
    awarded = _day(r["awarded"])
    if awarded is not None and awarded > as_of:
        return _day(r["published"])
    return awarded


def _list(text: object) -> list[str]:
    if text is None or text == "":
        return []
    try:
        value = json.loads(text) if isinstance(text, str) else text
    except ValueError:
        return []
    return [str(v) for v in value if v is not None] if isinstance(value, list) else []


def levels(codes: object, segments: Collection[str]) -> tuple[set[str], set[str], set[str]]:
    """The classes, families and segments a record's codes reach (the space-separated codes of x_awards and
    x_history): a code counts only within the 57 segments, as rec_classes reads it."""
    classes: set[str] = set()
    families: set[str] = set()
    segs: set[str] = set()
    for code in str(codes or "").split():
        if not code[:2].isdigit() or code[:2] not in segments:
            continue
        segs.add(code[:2])
        if len(code) >= 4 and code[:4].isdigit():
            families.add(code[:4])
        if len(code) >= 6 and code[:6].isdigit():
            classes.add(code[:6])
    return classes, families, segs


def is_amendment(r: Row) -> bool:
    """A published contract row that amends another (the counting rule in CLAUDE.md "Counting money")."""
    return r["instrument_type"] == "A" or (r["amendment_value"] is not None and r["amendment_value"] != 0)


def _buyer(value: object) -> str | None:
    return value if isinstance(value, str) and _BUYER_ID.match(value) and len(value) <= 80 else None


def _ranked(cells: Mapping[str, list[int]], cap: int | None) -> list[list]:
    """[key, *counts] rows by the largest count of one source, then the key; cap rows at most."""
    rows = sorted(cells.items(), key=lambda kv: (-max(kv[1]), kv[0]))
    return [[key, *counts] for key, counts in (rows if cap is None else rows[:cap])]


def matching_block(awards: Iterable[Row], history: Iterable[Row], contracts: Iterable[Row], held: list[list] | None, *,
                   as_of: str, segments: Collection[str], link: Callable[[str | None], str | None]) -> dict | None:
    """The block for one organization, or None when nothing is counted and nothing is held.

    awards and history are its x_awards and x_history rows (with codes, provinces, provinces_derived,
    notice_type_en and, on history, client_id); contracts its published contract rows; held its rows of
    held_instruments. segments are the 57 UNSPSC segment codes; link maps a buyer id to the listed buyer id
    a record links to, or None (export_static.Model.link)."""
    first, last = window(as_of)
    n = [0, 0, 0]
    coded = [0, 0]
    newest: str | None = None
    classes: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    families: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    segs: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    buyers: dict[str, list[int]] = defaultdict(lambda: [0, 0, 0])
    provinces: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    types: dict[str, list[int]] = defaultdict(lambda: [0, 0])

    def counted(day: str | None) -> bool:
        nonlocal newest
        fy = fiscal_year(day)
        if fy is None or not first <= fy <= last:
            return False
        newest = day if newest is None or day > newest else newest
        return True

    for source, rows in enumerate((awards, history)):
        for r in rows:
            if not counted(record_day(r, as_of)):
                continue
            n[source] += 1
            c, f, s = levels(r["codes"], segments)
            if s:
                coded[source] += 1
            for table, keys in ((classes, c), (families, f), (segs, s)):
                for key in keys:
                    table[key][source] += 1
            # A history record under its client and its contracting entity, once when they are one buyer.
            named = {link(_buyer(r["buyer_id"]))}
            if source == 1:
                named.add(link(_buyer(r["client_id"])))
            for bid in named - {None}:
                buyers[bid][source] += 1
            for code in set(_list(r["provinces"])) | set(_list(r["provinces_derived"])):
                if code in PROVINCE_CODES:
                    provinces[code][source] += 1
            kind = str(r["notice_type_en"] or "").strip()
            if kind:
                types[kind][source] += 1
    for r in contracts:
        if is_amendment(r) or not counted(_day(r["contract_date"])):
            continue
        n[2] += 1
        bid = link(_buyer(r["buyer_id"]))
        if bid:
            buyers[bid][2] += 1
    if not any(n) and not held:
        return None
    return {
        "fy": [first, last], "n": n, "coded": coded, "newest": newest,
        "classes": _ranked(classes, CLASSES_MAX), "families": _ranked(families, FAMILIES_MAX), "segments": _ranked(segs, None),
        "buyers": _ranked(buyers, BUYERS_MAX), "provinces": _ranked(provinces, None), "types": _ranked(types, TYPES_MAX),
        "held": held or [],
    }


def held_instruments(conn: sqlite3.Connection) -> dict[str, list[list]]:
    """Per organization, the standing offers and supply arrangements it holds now (an active holder row), as
    [type code, segment, instruments]: one per instrument whatever the regions it holds it in, counted in each
    segment the instrument carries (sosa.type_code, sosa.segments_of, as sosa_export reads them). By type,
    then segment."""
    cells: dict[str, dict[tuple[str, str], set[str]]] = defaultdict(lambda: defaultdict(set))
    for r in conn.execute(
            "SELECT DISTINCT h.organization_id AS oid, i.agreement_number AS a, i.type_en AS type_en, i.segments AS segments "
            "FROM sosa_holders h JOIN sosa_instruments i ON i.agreement_number = h.agreement_number "
            "WHERE h.lost_on IS NULL AND h.organization_id IS NOT NULL"):
        kind = sosa.type_code(r["type_en"])
        for seg in sosa.segments_of(r["segments"]):
            cells[r["oid"]][(kind, seg)].add(r["a"])
    return {oid: [[kind, seg, len(held)] for (kind, seg), held in sorted(by.items())] for oid, by in cells.items()}
