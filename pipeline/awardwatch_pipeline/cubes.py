"""The analytics builder's cubes: each buyer's and segment's figures by source and fiscal year, and each province of
delivery's, counted ahead of the request (docs/analytics.md, "The builder's cubes").

A stage of its own after lines (cli.STAGES) with its own log row, so a fault here leaves the radar, the lines and the
export standing. It reads records_db.record_rows, the rows the records sync sends as records, into a temporary table,
so a figure here is the one the fixed analytics views read for the same buyer, segment, source and fiscal year, and
aggregates them into the pipeline tables cube_bs and cube_place, rebuilt whole in one transaction with the data date
they describe (meta cubes_as_of): a failure rolls back to last night's rows, which the sync then sends unchanged.

* cube_bs: one row per buyer (bid), segment (sid), source and fiscal year with a record. bid 0 is every buyer, the
  records that name none included. sid 0 is every segment and reads each record once (the rows with extra = 0),
  whether it has a segment or not; a segment reads every row of the segment, extra or not, so a notice whose codes
  reach two segments counts in each, as the segment views count it. Published contracts and grants carry no segment,
  so they have sid 0 rows only.
* cube_place: award notices and history only, by province of delivery: the stated and derived provinces of the
  newest version, as the radar's province filter reads them (records_db.expiring_province_rows), or '' when none is
  named; one row per province for a buyer (sid 0), a segment (bid 0) or every record (both 0). A notice naming two
  provinces counts in each, so provinces are never added together; the same cell of cube_bs counts it once.

The columns, each with the statement of site/src/records_db.ts it agrees with, are listed in docs/analytics.md. A
record whose fiscal year is unknown is in no cell, as it is in no view. A supplier withheld as a person counts in every
total and never as an organization (n_orgs and top1 to top10 read named organizations only); a grant to a person is not
in records at all. The log row holds counts and seconds, never a name.

A guard raises before anything is written when the cubes would hold more than CUBE_ROWS_MAX rows between them.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, timezone

from . import records_db as rd
from .db import log_run, set_meta
from .organizations import _newest_by_reference
from .places import _list

log = logging.getLogger(__name__)

# The most rows the two cubes may hold together. The design sized them at 70,000 to 195,000 on the production data of
# November 2026; a night past this has met data the sizing did not foresee, and keeps last night's rows rather than
# send the new ones to D1.
CUBE_ROWS_MAX = 400_000
# top1, top5 and top10: the organizations with the largest values each adds.
TOP = (1, 5, 10)
# The sources whose versions are numbered, so whose values can grow through amendments.
AMENDED = tuple(rd.SOURCES[s] for s in rd.AMENDED_SOURCES)
# The sources whose notices name regions of delivery, and their kinds as the records' own keys spell them.
PLACED = {"awards": ("award", rd.SOURCES["awards"]), "contract_history": ("history", rd.SOURCES["history"])}
# The amended records whose first and last values are compared (records_db.ts COMPARED).
COMPARED = "namd > 0 AND ocents > 0 AND cents IS NOT NULL"

# Temporary tables: tonight's records rows with the key of the record each belongs to (rk); each award notice's and
# history record's provinces, one row each; the notice rows once per province; and the two cubes before the guard.
ROWS, PLACES, PLACE_ROWS = "cube_rows", "cube_places", "cube_place_rows"
NEW = {rd.CUBE_BS.name: "cube_bs_new", rd.CUBE_PLACE.name: "cube_place_new"}
TEMP = (ROWS, PLACES, PLACE_ROWS, *NEW.values())
# The columns of a records row the cubes read, in RECORDS.written order.
ROW_COLUMNS = ("k", "src", "fy", "bid", "oid", "sid", "extra", "cents", "vnote", "comp", "ocents", "namd")


class CubesTooLarge(RuntimeError):
    """The cubes would hold more than CUBE_ROWS_MAX rows; nothing was written."""


@dataclass(frozen=True)
class Kind:
    """One kind of cell: the columns its cells group by (a column left out is 0 in the cell: every buyer, every
    segment) and the rows of records each cell reads, as the views of that subject read them."""
    name: str
    group: tuple[str, ...]
    where: str


# A buyer in one segment: the buyer's rows in the segment, extra or not (records_db.ts BUYER_SEGMENTS_SQL); a buyer:
# each record once (rec_buyer_quarters, rec_buyer_years, BUYER_COMPETITION_SQL, BUYER_SUPPLIERS_SQL,
# BUYER_GROWTH_SQL); a segment: every row of the segment, extra or not (rec_segment_years, SEGMENT_WINNERS_SQL,
# SEGMENT_BUYERS_SQL); every record: each record once.
BS_KINDS = (
    Kind("buyer_segment", ("bid", "sid"), "bid IS NOT NULL AND sid IS NOT NULL"),
    Kind("buyer", ("bid",), "bid IS NOT NULL AND extra = 0"),
    Kind("segment", ("sid",), "sid IS NOT NULL"),
    Kind("all", (), "extra = 0"),
)
# The province cube has no cell of a buyer in a segment.
PLACE_KINDS = BS_KINDS[1:]


def _prefix(kind: Kind) -> str:
    return "".join(f"{c}, " for c in kind.group)


def _cell(kind: Kind, group: tuple) -> tuple[int, int]:
    """(bid, sid) of a cell from the values it is grouped by."""
    values = dict(zip(kind.group, group))
    return values.get("bid", 0), values.get("sid", 0)


def provinces_of(stated: object, derived: object) -> list[str]:
    """The provinces and territories a notice's two stored lists name, by the radar's province filter's rule: stated
    and derived together, a code that is not one of the thirteen left out, sorted, each once."""
    return sorted(rd._province_set(_list(stated)) | rd._province_set(_list(derived)))


def drop(conn: sqlite3.Connection) -> None:
    for name in TEMP:
        conn.execute(f"DROP TABLE IF EXISTS temp.{name}")


# -- tonight's rows ---------------------------------------------------------------------


def load(conn: sqlite3.Connection, as_of: str) -> int:
    """temp.cube_rows := records_db.record_rows with the data date bound, as the sync builds records, with rk, the key
    of the record a row belongs to (its own for a row with extra = 0, which record_rows yields just before the record's
    rows for its further segments); temp.cube_places := each award notice's and history record's provinces; temp.
    cube_place_rows := the notice rows with a fiscal year, once per province. Returns the records rows read."""
    drop(conn)
    conn.execute(f"CREATE TEMP TABLE {ROWS} (k INTEGER PRIMARY KEY, rk INTEGER NOT NULL, src INTEGER, fy INTEGER, bid INTEGER, "
                 "oid INTEGER, sid INTEGER, extra INTEGER, cents INTEGER, vnote INTEGER, comp INTEGER, ocents INTEGER, namd INTEGER)")
    at = [rd.RECORDS.written.index(c) for c in ROW_COLUMNS]
    extra_at = rd.RECORDS.written.index("extra")
    read = 0

    def rows() -> Iterator[tuple]:
        nonlocal read
        own = None
        for r in rd.record_rows(conn, as_of=as_of):
            read += 1
            if not r[extra_at]:
                own = r[0]
            elif own is None:
                raise ValueError("a record's row for a further segment came before its own row")
            k, *rest = (r[i] for i in at)
            yield (k, own, *rest)

    try:
        conn.executemany(f"INSERT INTO temp.{ROWS} VALUES ({', '.join('?' * (len(ROW_COLUMNS) + 1))})", rows())
    except sqlite3.IntegrityError:
        raise ValueError("two records have the same key; key_of needs more bits") from None
    # 0 stands for every buyer, so no buyer may have it as its number (a 40-bit hash: one in a trillion).
    if conn.execute(f"SELECT EXISTS (SELECT 1 FROM temp.{ROWS} WHERE bid = 0)").fetchone()[0]:
        raise ValueError("a buyer's number is 0, which the cubes keep for every buyer; change buyer_number")

    conn.execute(f"CREATE TEMP TABLE {PLACES} (rk INTEGER NOT NULL, prov TEXT NOT NULL, PRIMARY KEY (rk, prov))")

    def places() -> Iterator[tuple]:
        for table, (kind, _) in PLACED.items():
            for r in conn.execute(f"WITH newest AS ({_newest_by_reference(table, ('reference',))}) "
                                  "SELECT reference, provinces, provinces_derived FROM newest"):
                rk = rd.key_of(f"{kind}:{r['reference']}")
                for prov in provinces_of(r["provinces"], r["provinces_derived"]) or [""]:
                    yield rk, prov

    conn.executemany(f"INSERT INTO temp.{PLACES} VALUES (?, ?)", places())
    sources = ", ".join(str(src) for _, src in PLACED.values())
    conn.execute(f"CREATE TEMP TABLE {PLACE_ROWS} AS SELECT r.src AS src, r.fy AS fy, r.bid AS bid, r.sid AS sid, "
                 "r.extra AS extra, r.cents AS cents, r.comp AS comp, COALESCE(p.prov, '') AS prov "
                 f"FROM temp.{ROWS} r LEFT JOIN temp.{PLACES} p ON p.rk = r.rk WHERE r.src IN ({sources}) AND r.fy IS NOT NULL")
    return read


# -- the cells --------------------------------------------------------------------------


def bs_rows(conn: sqlite3.Connection, counts: dict[str, int]) -> Iterator[tuple]:
    """cube_bs's rows in CUBE_BS.written order, kind by kind; counts gets each kind's cells."""
    table = f"temp.{ROWS}"
    for kind in BS_KINDS:
        g = _prefix(kind)
        where = f"fy IS NOT NULL AND {kind.where}"
        # n_pos, pos and med by the code that writes rec_buyer_years and rec_segment_years.
        values = rd.value_figures(conn, f"{g}src, fy", where, table)
        # The organizations with the largest values, ordered as BUYER_SUPPLIERS_SQL and SEGMENT_WINNERS_SQL order them
        # (value, then records, then number; no value last), each held value added with none as 0, as the buyer
        # view's shares add them.
        tops = {tuple(r[:-len(TOP)]): tuple(r[-len(TOP):]) for r in conn.execute(
            f"SELECT {g}src, fy, {', '.join(f'SUM(CASE WHEN rn <= {t} THEN COALESCE(c, 0) END)' for t in TOP)} FROM ("
            f"SELECT {g}src, fy, c, ROW_NUMBER() OVER (PARTITION BY {g}src, fy ORDER BY c DESC, n DESC, oid) AS rn FROM ("
            f"SELECT {g}src, fy, oid, COUNT(*) AS n, SUM(cents) AS c FROM {table} WHERE {where} AND oid IS NOT NULL "
            f"GROUP BY {g}src, fy, oid)) WHERE rn <= {max(TOP)} GROUP BY {g}src, fy")}
        cells = 0
        for r in conn.execute(
                f"SELECT {g}src, fy, COUNT(*), SUM(cents), SUM(CASE WHEN vnote = {rd.NO_VALUE} THEN 1 ELSE 0 END), "
                "SUM(CASE WHEN comp = 0 THEN 1 ELSE 0 END), SUM(CASE WHEN comp IS NULL THEN 1 ELSE 0 END), "
                "SUM(CASE WHEN comp = 0 AND cents > 0 THEN cents END), SUM(CASE WHEN comp IS NULL AND cents > 0 THEN cents END), "
                f"SUM(CASE WHEN namd > 0 THEN 1 ELSE 0 END), SUM(CASE WHEN {COMPARED} THEN 1 ELSE 0 END), "
                f"SUM(CASE WHEN {COMPARED} AND cents > ocents THEN 1 ELSE 0 END), SUM(CASE WHEN {COMPARED} THEN ocents END), "
                f"SUM(CASE WHEN {COMPARED} THEN cents END), COUNT(DISTINCT oid) FROM {table} WHERE {where} "
                f"GROUP BY {g}src, fy"):
            at = len(kind.group)
            group, (src, fy) = tuple(r[:at]), tuple(r[at:at + 2])
            n, cents, no_value, nc, unstated, pos_nc, pos_unstated, amended, compared, grew, first, last, orgs = tuple(r[at + 2:])
            n_pos, pos, med = values.get((*group, src, fy), (0, None, None))
            if src not in AMENDED:
                amended = compared = grew = first = last = None
            bid, sid = _cell(kind, group)
            cells += 1
            yield (rd.key_of(f"bs:{bid}:{sid}:{src}:{fy}"), bid, sid, src, fy, n, cents, no_value, nc, unstated, n_pos, pos,
                   pos_nc, pos_unstated, med, amended, compared, grew, first, last, orgs,
                   *tops.get((*group, src, fy), (None,) * len(TOP)))
        counts[kind.name] = cells


def place_rows(conn: sqlite3.Connection, counts: dict[str, int]) -> Iterator[tuple]:
    """cube_place's rows in CUBE_PLACE.written order, kind by kind; counts gets each kind's cells."""
    table = f"temp.{PLACE_ROWS}"
    for kind in PLACE_KINDS:
        g = _prefix(kind)
        values = rd.value_figures(conn, f"{g}prov, src, fy", kind.where, table)
        cells = 0
        for r in conn.execute(
                f"SELECT {g}prov, src, fy, COUNT(*), SUM(cents), SUM(CASE WHEN comp = 0 THEN 1 ELSE 0 END) FROM {table} "
                f"WHERE {kind.where} GROUP BY {g}prov, src, fy"):
            at = len(kind.group)
            group, (prov, src, fy), (n, cents, nc) = tuple(r[:at]), tuple(r[at:at + 3]), tuple(r[at + 3:])
            n_pos, pos, med = values.get((*group, prov, src, fy), (0, None, None))
            bid, sid = _cell(kind, group)
            cells += 1
            yield rd.key_of(f"pl:{bid}:{sid}:{prov}:{src}:{fy}"), bid, sid, prov, src, fy, n, cents, nc, n_pos, pos, med
        counts[f"place_{kind.name}"] = cells


# -- the stage --------------------------------------------------------------------------


def compute(conn: sqlite3.Connection, *, today: date | None = None) -> dict[str, int]:
    """Rebuild cube_bs and cube_place whole, with meta cubes_as_of, in one transaction; returns the counts.

    today is the data date the records are counted against (records_db.NOTICE_DAY): the run's UTC date, the one the
    export records as data_as_of after this stage and the records sync binds. Raises CubesTooLarge, writing nothing,
    when the two would hold more than CUBE_ROWS_MAX rows.
    """
    started = time.monotonic()
    as_of = (today or datetime.now(timezone.utc).date()).isoformat()
    counts: dict[str, int] = {}
    try:
        counts["records"] = load(conn, as_of)
        for cube, rows in ((rd.CUBE_BS, bs_rows(conn, counts)), (rd.CUBE_PLACE, place_rows(conn, counts))):
            conn.execute(f"CREATE TEMP TABLE {NEW[cube.name]} ({cube.key} INTEGER PRIMARY KEY, {', '.join(cube.columns)})")
            try:
                conn.executemany(f"INSERT INTO temp.{NEW[cube.name]} VALUES ({', '.join('?' * len(cube.written))})", rows)
            except sqlite3.IntegrityError:
                raise ValueError(f"two cells of {cube.name} have the same key; key_of needs more bits") from None
            counts[cube.name] = conn.execute(f"SELECT COUNT(*) FROM temp.{NEW[cube.name]}").fetchone()[0]
        counts["rows"] = counts[rd.CUBE_BS.name] + counts[rd.CUBE_PLACE.name]
        if counts["rows"] > CUBE_ROWS_MAX:
            raise CubesTooLarge(f"the cubes would hold {counts['rows']} rows ({rd.CUBE_BS.name} {counts[rd.CUBE_BS.name]}, "
                                f"{rd.CUBE_PLACE.name} {counts[rd.CUBE_PLACE.name]}), more than CUBE_ROWS_MAX "
                                f"({CUBE_ROWS_MAX}); last night's rows are kept")
        # Rebuilt whole in one transaction: a fault leaves last night's rows and their data date, never half a cube.
        for cube in (rd.CUBE_BS, rd.CUBE_PLACE):
            columns = ", ".join(cube.written)
            conn.execute(f"DELETE FROM {cube.name}")
            conn.execute(f"INSERT INTO {cube.name} ({columns}) SELECT {columns} FROM temp.{NEW[cube.name]}")
        set_meta(conn, rd.META_CUBES_AS_OF, as_of)
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        drop(conn)
    counts["seconds"] = round(time.monotonic() - started)
    return counts


def run(conn: sqlite3.Connection, *, today: date | None = None) -> dict[str, int]:
    """The cubes stage: its own log row, after the lines stage's, with the counts and the seconds; no notice and no
    name (the cells are numbers of public records)."""
    counts = compute(conn, today=today)
    log.info("cubes: %s", counts)
    log_run(conn, "cubes", detail=" ".join(f"{k}={v}" for k, v in counts.items()), rows_in=counts["records"],
            rows_new=counts["rows"])
    return counts
