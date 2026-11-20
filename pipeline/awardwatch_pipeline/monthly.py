"""The monthly record: each complete calendar month of federal procurement in figures (/monthly).

Why: the site's record pages are many and alike. A month's figures, rebuilt every night and dated by the data date,
make a page a reader can cite and come back to. Every figure is a count, a sum, a share or a list of the notices as
CanadaBuys published them; nothing here judges a buyer or a supplier.

Output tree (under data/out/static), written by the export's "monthly" section (export_static._write_static):

  monthly/index.json       {as_of, months: [{month, tenders, awards, awards_value}], feed}: the months the record
                           holds, newest first, each with its three headline figures; feed, the record's Atom feed
                           ("feeds/canada/monthly.xml"), only when it was written tonight
  monthly/<YYYY-MM>.json   one month: {as_of, month, tenders: {...}, awards: {...}} (build and its helpers below;
                           site/src/data.ts MonthFigures names every field)
  feeds/canada/monthly.xml the record's Atom feed, one entry a month (feeds.write_monthly_feed; write_all and
                           write_feed say in what order and what a fault leaves)

as_of, the data date, is the only date of the run in either file, at the top level, where the sitemap's digest of a
page leaves it out (export_static._digest): a month whose figures a night left as they were keeps its lastmod. The
months before and after one, which its page links, are read from the index by the site, not written into the month.

Which months. A month is complete once the data date is past its last day; the month under way has no page. The
record holds the last MONTHS complete months that both sources hold in full (held). CanadaBuys' complete tender file
lists every notice since 2022-08-08 and the award notices reach back to the legacy 2012-2022 file
(sources/canadabuys.py), so HELD_FROM names each source's first whole month; and a source holds a month only when it
has a notice published on or before the month's first day, so a database that has not read its files yet holds none.
A comparison with the month before or the same month a year earlier is given only when that month is held too.

Which date puts a notice in a month: its publication date as CanadaBuys states it (publicationDate), the earliest
among the versions the database holds, date part only (the files give a date with no time). A notice published on
the last day of a month is in that month; one published on the first day is in the next. A notice with no
publication date is in no month. Award notices are placed by publication too, not by award date: an award notice
appears days, weeks or months after the award it records, so a month by award date would keep filling for months,
and an award date after the data date is the contract's end date typed in the wrong field (export_static). Every
other field is the notice's newest version, as on its own page.

What the record leaves out, and why (the page says so too):
- the published contracts over $10,000 (proactive disclosure): departments report them by quarter, weeks or months
  after the quarter ends, so a calendar month of them keeps growing long after it ends;
- amendments: the files list a notice at its newest version, so a notice amended twice between two reads keeps only
  the last, and a notice read in the first load holds one version: no count of a month's amendments can be held to
  the source;
- PSPC's contract history: a second record of contracts that award notices also report, placed by award.

The counting rules, the site's own (organizations.award_value, normalize.competitive):
- tenders: every notice published in the month, whatever its status since. A buyer counts the notices it published
  (a notice whose buyer names no institution is in no buyer's row); a segment counts the notices with a code in it (a
  notice in two segments counts in each, one with no code in none); the methods are the source's own words. Days
  open: the closing date less the publication date, over the notices that state both, the closing on or after the
  publication.
- award notices: every notice published in the month. The total adds each notice's value in Canadian dollars by the
  counting rules (a cancelled contract counts zero); a value the source did not publish is in no total
  (n_no_value), nor is one in another currency or one flagged for checking (n_not_counted). Non-competitive: the
  source's method "Non-competitive" or an advance contract award notice (competitive 0); by number over every notice
  of the month, by value over the positive counted values. The largest are ranked by that counted value, ties by
  reference. A supplier is an organization a notice names; a notice whose supplier is withheld as a private
  individual names none. A supplier is new in the month when no award notice published before it names it.

Deterministic: rows sorted with their ties broken by id, code, method or reference.
"""

from __future__ import annotations

import json
import logging
import statistics
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # export_static imports this module; the names below are read at call time.
    from .export_static import Model

log = logging.getLogger(__name__)

# The complete months the record holds, newest first.
MONTHS = 12
# Rows in each ranked list.
TOP = 10
# Each source's first whole calendar month in the files the stages read (sources/canadabuys.py): the complete tender
# file lists every notice since 2022-08-08; the award notices go back to the legacy 2012-2022 file, and 2013 is the
# first year that file holds whole whatever day of 2012 it starts on.
HELD_FROM = {"tenders": "2022-09", "awards": "2013-01"}
TABLES = {"tenders": "tenders", "awards": "awards"}

# A publication date as the loaders store it: ISO, its date part first.
_DAY_GLOB = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*"


def add_months(month: str, n: int) -> str:
    """'2026-01' and -1 gives '2025-12'."""
    year, mon = divmod(int(month[:4]) * 12 + int(month[5:7]) - 1 + n, 12)
    return f"{year:04d}-{mon + 1:02d}"


def first_day(month: str) -> str:
    return f"{month}-01"


def first_published(conn: Any, source: str) -> str | None:
    """The earliest publication date any notice of the source carries, or None when it holds none."""
    row = conn.execute(f"SELECT MIN(substr(published, 1, 10)) FROM {TABLES[source]} WHERE published GLOB ?",
                       (_DAY_GLOB,)).fetchone()
    return row[0] if row and row[0] else None


class Held:
    """Which months each source holds in full."""

    def __init__(self, conn: Any) -> None:
        self.first = {s: first_published(conn, s) for s in TABLES}

    def __call__(self, source: str, month: str) -> bool:
        first = self.first[source]
        return month >= HELD_FROM[source] and first is not None and first <= first_day(month)


def record_months(conn: Any, as_of: str, held: Held | None = None) -> list[str]:
    """The months the record holds, newest first: the complete months before the data date's (at most MONTHS of
    them) that both sources hold in full."""
    held = held or Held(conn)
    current = as_of[:7]
    out = []
    for back in range(1, MONTHS + 1):
        month = add_months(current, -back)
        if held("tenders", month) and held("awards", month):
            out.append(month)
    return out


# -- the rows ---------------------------------------------------------------------------------------------------------


def _published(table: str) -> str:
    """Each notice's first publication date: the earliest among its versions."""
    return (f"SELECT reference, MIN(substr(published, 1, 10)) AS pub FROM {table} WHERE published GLOB '{_DAY_GLOB}' "
            "GROUP BY reference")


def _tender_rows(m: Model, since: str) -> list[Any]:
    return m.conn.execute(
        f"WITH f AS ({_published('tenders')}) SELECT f.pub, t.reference, t.buyer_id, t.buyer_raw_en, t.buyer_raw_fr, "
        "t.codes, t.method_en, t.method_fr, t.closing FROM f JOIN x_tenders t ON t.reference = f.reference "
        "WHERE f.pub >= ? ORDER BY t.reference", (since,)).fetchall()


def _award_rows(m: Model, since: str) -> list[Any]:
    return m.conn.execute(
        f"WITH f AS ({_published('awards')}) SELECT f.pub, a.* FROM f JOIN x_awards a ON a.reference = f.reference "
        "WHERE f.pub >= ? ORDER BY a.reference", (since,)).fetchall()


def _first_months(m: Model) -> dict[str, str]:
    """Each organization's first month in the award notices: the month of the earliest first publication among the
    notices attributed to it (x_awards, the export's attribution)."""
    rows = m.conn.execute(
        f"WITH f AS ({_published('awards')}) SELECT a.org, MIN(f.pub) FROM f JOIN x_awards a ON a.reference = f.reference "
        "WHERE a.org IS NOT NULL GROUP BY a.org")
    return {oid: pub[:7] for oid, pub in rows if pub}


# -- one month --------------------------------------------------------------------------------------------------------


def _total(values: list[float]) -> float | None:
    return round(sum(values), 2) if values else None


def _ranked_buyers(m: Model, rows: list[Any], value: bool) -> tuple[list[dict], int]:
    """The TOP buyers: by notices, or by counted value (then notices); ties by id. Returns them and the notices
    whose buyer names no institution."""
    from .export_static import _buyer_id

    groups: dict[str, list[Any]] = defaultdict(list)
    no_buyer = 0
    for r in rows:
        bid = _buyer_id(r["buyer_id"])
        if bid is None:
            no_buyer += 1
        else:
            groups[bid].append(r)
    out = []
    for bid, items in groups.items():
        first = items[0]
        en, fr = m.buyer_names(bid, first["buyer_raw_en"], first["buyer_raw_fr"])
        row: dict[str, Any] = {"id": m.link(bid), "key": bid, "en": en, "fr": fr, "n": len(items)}
        if value:
            row["value"] = _total([r["v"] for r in items if r["v"] is not None])
            row["n_no_value"] = sum(r["nv"] or 0 for r in items)
        out.append(row)
    if value:
        out.sort(key=lambda b: (b["value"] is None, -(b["value"] or 0), -b["n"], b["key"]))
    else:
        out.sort(key=lambda b: (-b["n"], b["key"]))
    top = out[:TOP]
    for b in top:
        del b["key"]
    return top, no_buyer


def _tenders(m: Model, rows: list[Any]) -> dict:
    from .export_static import _day

    segments: Counter = Counter()
    no_segment = 0
    methods: dict[str | None, list[Any]] = defaultdict(list)
    days: list[int] = []
    for r in rows:
        codes = m.segments_of(r["codes"])
        segments.update(codes)
        no_segment += not codes
        en = (r["method_en"] or "").strip() or None
        methods[en].append(r)
        closing = _day(r["closing"])
        if closing:
            span = (date.fromisoformat(closing) - date.fromisoformat(r["pub"])).days
            if span >= 0:
                days.append(span)
    buyers, no_buyer = _ranked_buyers(m, rows, value=False)
    method_rows = []
    for en, items in methods.items():
        frs = sorted({(r["method_fr"] or "").strip() for r in items} - {""})
        method_rows.append({"en": en, "fr": frs[0] if en and frs else None, "n": len(items)})
    method_rows.sort(key=lambda r: (r["en"] is None, -r["n"], r["en"] or ""))
    median = statistics.median(days) if days else None
    return {
        "n": len(rows),
        "buyers": buyers,
        "n_no_buyer": no_buyer,
        "segments": [{"code": code, "n": n} for code, n in sorted(segments.items(), key=lambda kv: (-kv[1], kv[0]))[:TOP]],
        "n_no_segment": no_segment,
        "methods": method_rows,
        "days_open": {"median": None if median is None else (int(median) if median == int(median) else median),
                      "n": len(days)},
    }


def _awards(m: Model, rows: list[Any], month: str, first_months: dict[str, str]) -> dict:
    from .export_static import award_row

    counted = [r["v"] for r in rows if r["v"] is not None]
    positive = [r for r in rows if r["v"] is not None and r["v"] > 0]
    largest = []
    for r in sorted((r for r in rows if r["v"] is not None), key=lambda r: (-r["v"], r["reference"])):
        if len(largest) == TOP:
            break
        if row := award_row(m, "awards", r):
            row["published"] = r["pub"]
            largest.append(row)
    buyers, no_buyer = _ranked_buyers(m, rows, value=True)
    suppliers = {oid for r in rows if (oid := m.org(r["org"])[0])}
    return {
        "n": len(rows),
        "value": _total(counted),
        "n_no_value": sum(r["nv"] or 0 for r in rows),
        "n_not_counted": sum(1 for r in rows if r["v"] is None and not r["nv"]),
        "n_nc": sum(1 for r in rows if r["competitive"] == 0),
        "n_unstated": sum(1 for r in rows if r["competitive"] is None),
        "pos": _total([r["v"] for r in positive]),
        "pos_nc": _total([r["v"] for r in positive if r["competitive"] == 0]),
        "largest": largest,
        "buyers": buyers,
        "n_no_buyer": no_buyer,
        "suppliers": len(suppliers),
        "suppliers_new": sum(1 for oid in suppliers if first_months.get(oid) == month),
    }


def build(m: Model) -> tuple[list[str], dict[str, dict], dict]:
    """(the months newest first, each month's file, the index) for the export's data date."""
    held = Held(m.conn)
    months = record_months(m.conn, m.as_of, held)
    if not months:
        return [], {}, {"as_of": m.as_of, "months": []}
    # The oldest month a page compares with: the year before the record's oldest.
    since = first_day(add_months(months[-1], -12))
    tenders: dict[str, list[Any]] = defaultdict(list)
    for r in _tender_rows(m, since):
        tenders[r["pub"][:7]].append(r)
    awards: dict[str, list[Any]] = defaultdict(list)
    for r in _award_rows(m, since):
        awards[r["pub"][:7]].append(r)
    firsts = _first_months(m)

    def tender_figure(month: str) -> dict | None:
        return {"month": month, "n": len(tenders[month])} if held("tenders", month) else None

    def award_figure(month: str) -> dict | None:
        if not held("awards", month):
            return None
        rows = awards[month]
        return {"month": month, "n": len(rows), "value": _total([r["v"] for r in rows if r["v"] is not None]),
                "n_no_value": sum(r["nv"] or 0 for r in rows)}

    docs: dict[str, dict] = {}
    for month in months:
        t = _tenders(m, tenders[month])
        t["before"], t["year_before"] = tender_figure(add_months(month, -1)), tender_figure(add_months(month, -12))
        a = _awards(m, awards[month], month, firsts)
        a["before"], a["year_before"] = award_figure(add_months(month, -1)), award_figure(add_months(month, -12))
        docs[month] = {"as_of": m.as_of, "month": month, "tenders": t, "awards": a}
    index = {"as_of": m.as_of, "months": [
        {"month": mo, "tenders": docs[mo]["tenders"]["n"], "awards": docs[mo]["awards"]["n"],
         "awards_value": docs[mo]["awards"]["value"]} for mo in months]}
    return months, docs, index


def write_all(m: Model, out: Path, *, base_url: str | None = None) -> dict[str, int]:
    """Write each month's file, the record's feed and monthly/index.json under out, in that order; returns counts
    for the run log.

    The feed comes after the months' files, whose digests date its entries, and before the index, which names it
    only when it was written. A fault in the feed costs nothing else (write_feed). A fault writing the index after
    the feed removes the feed again, so nothing announces a record whose index is missing; the export logs that as
    export_monthly, the section's fault."""
    from .export_static import _dump
    from .feeds import MONTHLY_FEED

    months, docs, index = build(m)
    largest = 0
    for month in months:
        largest = max(largest, _dump(out / "monthly" / f"{month}.json", docs[month]))
    counts = {"monthly_months": len(months), "monthly_largest_bytes": largest}
    feed = write_feed(m, out, months, index, base_url) if months else {}
    if feed:
        index["feed"] = MONTHLY_FEED
        counts.update(feed)
    try:
        _dump(out / "monthly" / "index.json", index)
    except BaseException:
        (out / MONTHLY_FEED).unlink(missing_ok=True)
        raise
    return counts


def write_feed(m: Model, out: Path, months: list[str], index: dict, base_url: str | None) -> dict[str, int]:
    """The record's Atom feed (feeds.write_monthly_feed) from the index's rows, each month dated as the sitemap
    dates its page: the digest of the month's file, read against the page_dates ledger without writing it
    (export_static.ledger_dates; the sitemap writes the ledger at the end of the export with the same digests), so
    the feed and the sitemap give a month the same date. Returns its counts, or {} when it failed: the fault is
    logged as the stage export_monthly_feed, a file it left part written is removed, and no other file of the
    export is touched (the feeds section's files were written before this section, and the record's own files
    stand)."""
    from . import feeds
    from .db import log_run
    from .export_static import ledger_dates

    try:
        dates, _ = ledger_dates(m.conn, page_digests(out, months), m.as_of)
        return feeds.write_monthly_feed(out, index["months"], dates, base_url=base_url)
    except Exception as exc:
        log.exception("export: the monthly record's feed failed")
        (out / feeds.MONTHLY_FEED).unlink(missing_ok=True)
        log_run(m.conn, "export_monthly_feed", detail=f"{type(exc).__name__}: {exc}"[:900], ok=False)
        return {}


def months_written(out: Path) -> list[str]:
    """The months tonight's index lists, newest first (read back from the file, which the sitemap dates)."""
    path = out / "monthly" / "index.json"
    if not path.is_file():
        return []
    doc = json.loads(path.read_bytes())
    return [r["month"] for r in doc.get("months") or [] if isinstance(r, dict) and isinstance(r.get("month"), str)]


def page_files(month: str) -> tuple[str, ...]:
    """The export file a month's page shows, for its lastmod (export_static._site_page_digests)."""
    return (f"monthly/{month}.json",)


def page_digests(out: Path, months: list[str]) -> dict[str, str]:
    """The digest of each month's page by its address, the one the page_dates ledger keeps: read by the sitemap
    (export_static._site_page_digests) and by the feed (write_feed), so both date a month from the same digest."""
    from .export_static import _digest

    return {f"/monthly/{month}": _digest(out, page_files(month)) for month in months}
